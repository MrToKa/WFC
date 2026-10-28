import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { drawingExportReceiptSchema, drawingExportWriteSchema, type DrawingExportWrite } from '../../shared/trayDrawingSnapshot.js';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { drawingAccessTransaction } from './drawingAccess.js';
import { assertCurrentDrawingSnapshot, drawingDigest } from './drawingSnapshots.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { uploadObject, getObjectStream, getProjectBucket } from '../services/objectStorageService.js';

type ExportFile = { kind: 'bundles' | 'load-curve' | 'report'; id: string; objectKey: string; fileName: string; contentType: string; sizeBytes: number; sha256: string };
type Stage = { exportId: string; files: ExportFile[] };
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'The drawing export is unavailable. Refresh its inputs or retry the same export.'); };
const bytesHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function validateDrawingExportStage(stage: Stage, projectId: string, rowId: string, files: Array<Omit<ExportFile, 'id' | 'objectKey'>>): void {
  const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
  if (!exact(stage, ['exportId', 'files']) || stage.exportId !== rowId || !policyUuidSchema.safeParse(rowId).success || !policyUuidSchema.safeParse(projectId).success || !Array.isArray(stage.files) || stage.files.length !== 3 || !Array.isArray(files) || files.length !== 3 || stage.files.some(f => !exact(f, ['kind', 'id', 'objectKey', 'fileName', 'contentType', 'sizeBytes', 'sha256'])) || new Set(stage.files.map(f => f.id)).size !== 3 || new Set(stage.files.map(f => f.kind)).size !== 3) return fail('DRAWING_EXPORT_STAGE_INTEGRITY');
  for (const file of stage.files) {
    const expected = files.find(f => f.kind === file.kind), prefix = `projects/${projectId}/drawing-exports/${stage.exportId}/${file.kind}-`;
    if (!expected || !policyUuidSchema.safeParse(file.id).success || typeof file.objectKey !== 'string' || !file.objectKey.startsWith(prefix) || !policyUuidSchema.safeParse(file.objectKey.slice(prefix.length)).success || file.fileName !== expected.fileName || file.contentType !== expected.contentType || file.sizeBytes !== expected.sizeBytes || file.sha256 !== expected.sha256) return fail('DRAWING_EXPORT_STAGE_INTEGRITY');
  }
}
export const DRAWING_EXPORT_SQL = `
CREATE TABLE IF NOT EXISTS pf_drawing_exports(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,tray_id uuid NOT NULL,actor_id uuid NOT NULL,login_id uuid NOT NULL,
 idempotency_key uuid NOT NULL,request_sha256 text NOT NULL,snapshot_id uuid NOT NULL REFERENCES pf_tray_drawing_snapshots(id),
 content_sha256 text NOT NULL,stage jsonb NOT NULL,receipt jsonb,created_at timestamptz NOT NULL DEFAULT now(),committed_at timestamptz,
 UNIQUE(project_id,tray_id,actor_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS pf_drawing_generated_files(
 file_id uuid PRIMARY KEY REFERENCES project_files(id) ON DELETE CASCADE,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pf_drawing_export_files(
 export_id uuid NOT NULL REFERENCES pf_drawing_exports(id) ON DELETE CASCADE,kind text NOT NULL,file_id uuid NOT NULL,
 object_key text NOT NULL,content_sha256 text NOT NULL,size_bytes bigint NOT NULL,PRIMARY KEY(export_id,kind)
);
CREATE OR REPLACE FUNCTION pf_drawing_export_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
 IF TG_OP='UPDATE' AND OLD.receipt IS NULL AND NEW.receipt IS NOT NULL AND
  (to_jsonb(OLD)-ARRAY['receipt','committed_at'])=(to_jsonb(NEW)-ARRAY['receipt','committed_at']) THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'Drawing export provenance is immutable';END $$;
DROP TRIGGER IF EXISTS pf_drawing_export_record_guard ON pf_drawing_exports;
CREATE TRIGGER pf_drawing_export_record_guard BEFORE UPDATE OR DELETE ON pf_drawing_exports FOR EACH ROW EXECUTE FUNCTION pf_drawing_export_record_guard();
`;
export async function initializeDrawingExportSchema(pool: Pool): Promise<void> {
  const c = await pool.connect();
  try { await c.query('BEGIN'); await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-purpose-policy-schema-v1'))"); await c.query(DRAWING_EXPORT_SQL); await c.query('COMMIT'); }
  catch (error) { await c.query('ROLLBACK').catch(() => undefined); throw error; } finally { c.release(); }
}
export function decodeDrawingExport(input: DrawingExportWrite): { command: DrawingExportWrite; files: Array<Omit<ExportFile, 'id' | 'objectKey'> & { bytes: Buffer }>; requestSha256: string } {
  const command = drawingExportWriteSchema.parse(input);
  const files = command.files.map(file => {
    const bytes = Buffer.from(file.base64, 'base64');
    if (bytes.toString('base64') !== file.base64 || bytes.length < 4 || bytes.length > 25 * 1024 * 1024) return fail('DRAWING_EXPORT_FILE_LIMIT', 413);
    const report = file.kind === 'report';
    const validType = report ? file.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && /\.docx$/i.test(file.fileName) && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))
      : file.contentType === 'image/jpeg' && /\.jpe?g$/i.test(file.fileName) && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        || !report && file.contentType === 'image/png' && /\.png$/i.test(file.fileName) && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!validType) return fail('DRAWING_EXPORT_CONTENT_INVALID', 400);
    return { kind: file.kind, fileName: file.fileName, contentType: file.contentType, sizeBytes: bytes.length, sha256: bytesHash(bytes), bytes };
  });
  if (files.reduce((n, f) => n + f.sizeBytes, 0) > 64 * 1024 * 1024) return fail('DRAWING_EXPORT_TOTAL_LIMIT', 413);
  const requestSha256 = drawingDigest({ ...command, files: files.map(({ bytes: _bytes, ...file }) => file) });
  return { command, files, requestSha256 };
}
async function verifyUploaded(file: ExportFile): Promise<void> {
  const stream = await getObjectStream(getProjectBucket(), file.objectKey), digest = createHash('sha256'); let bytes = 0;
  for await (const raw of stream) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); bytes += chunk.length;
    if (bytes > file.sizeBytes) { stream.destroy(); return fail('DRAWING_EXPORT_OBJECT_INTEGRITY'); }
    digest.update(chunk);
  }
  if (bytes !== file.sizeBytes || digest.digest('hex') !== file.sha256) return fail('DRAWING_EXPORT_OBJECT_INTEGRITY');
}
type Row = { id: string; request_sha256: string; stage: Stage; receipt: unknown | null };
async function prior(c: PoolClient, projectId: string, trayId: string, who: JobPrincipal, key: string): Promise<Row | undefined> {
  return (await c.query<Row>('SELECT id,request_sha256,stage,receipt FROM pf_drawing_exports WHERE project_id=$1 AND tray_id=$2 AND actor_id=$3 AND idempotency_key=$4 FOR UPDATE', [projectId, trayId, who.userId, key])).rows[0];
}

/** Objects are journalled before upload. Unknown commit outcomes retain their objects;
 * retry reconciles the exact command rather than deleting possibly committed files. */
export async function exportTrayDrawing(pool: Pool, projectId: string, trayId: string, who: JobPrincipal, raw: DrawingExportWrite) {
  const { command, files, requestSha256 } = decodeDrawingExport(raw);
  const planned = await drawingAccessTransaction(pool, projectId, who, async (c, authority) => {
    const existing = await prior(c, projectId, trayId, who, command.idempotencyKey);
    if (existing) {
      if (existing.request_sha256 !== requestSha256) return fail('IDEMPOTENCY_CONFLICT');
      validateDrawingExportStage(existing.stage, projectId, existing.id, files);
      if (existing.receipt) return { receipt: drawingExportReceiptSchema.parse(existing.receipt), stage: existing.stage };
      await assertCurrentDrawingSnapshot(c, projectId, trayId, command.snapshotId, command.expectedContentSha256, authority);
      return { receipt: null, stage: existing.stage };
    }
    await assertCurrentDrawingSnapshot(c, projectId, trayId, command.snapshotId, command.expectedContentSha256, authority);
    const exportId = randomUUID();
    const stage: Stage = { exportId, files: files.map(({ bytes: _bytes, ...file }) => ({ ...file, id: randomUUID(), objectKey: `projects/${projectId}/drawing-exports/${exportId}/${file.kind}-${randomUUID()}` })) };
    validateDrawingExportStage(stage, projectId, exportId, files);
    await c.query('INSERT INTO pf_drawing_exports(id,project_id,tray_id,actor_id,login_id,idempotency_key,request_sha256,snapshot_id,content_sha256,stage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [exportId, projectId, trayId, who.userId, who.loginId, command.idempotencyKey, requestSha256, command.snapshotId, command.expectedContentSha256, stage]);
    return { receipt: null, stage };
  }, { edit: true });
  if (planned.receipt) return { ...planned.receipt, duplicate: true };
  for (const file of planned.stage.files) {
    const bytes = files.find(v => v.kind === file.kind)?.bytes;
    if (!bytes || bytesHash(bytes) !== file.sha256 || bytes.length !== file.sizeBytes) return fail('DRAWING_EXPORT_STAGE_INTEGRITY');
    await uploadObject({ bucket: getProjectBucket(), objectKey: file.objectKey, data: bytes, size: bytes.length, contentType: file.contentType, metadata: { 'drawing-sha256': file.sha256, 'drawing-export': planned.stage.exportId } });
    await verifyUploaded(file);
  }
  return drawingAccessTransaction(pool, projectId, who, async (c, authority) => {
    const existing = await prior(c, projectId, trayId, who, command.idempotencyKey);
    if (!existing || existing.request_sha256 !== requestSha256 || drawingDigest(existing.stage) !== drawingDigest(planned.stage)) return fail('DRAWING_EXPORT_STAGE_INTEGRITY');
    if (existing.receipt) return { ...drawingExportReceiptSchema.parse(existing.receipt), duplicate: true };
    // Legacy file writers take their row/table locks before the drawing-state
    // trigger. Serialize this small metadata commit in the same order, including
    // absent filename slots, before taking the state snapshot lock. Uploads and
    // byte verification have already finished outside this transaction.
    await c.query('LOCK TABLE project_files,project_file_versions IN SHARE ROW EXCLUSIVE MODE');
    await assertCurrentDrawingSnapshot(c, projectId, trayId, command.snapshotId, command.expectedContentSha256, authority);
    // Output records and file versions commit together and do not become source
    // dependencies merely because a generated report was saved.
    await c.query("SELECT set_config('wfc.drawing_export_id',$1,true)", [planned.stage.exportId]);
    const saved = [];
    for (const file of planned.stage.files) {
      const old = (await c.query<{ id: string; generated: boolean }>('SELECT f.id,EXISTS(SELECT 1 FROM pf_drawing_generated_files g WHERE g.file_id=f.id) AS generated FROM project_files f WHERE f.project_id=$1 AND lower(f.file_name)=lower($2) FOR UPDATE', [projectId, file.fileName])).rows[0];
      if (old && (!old.generated || (await c.query('SELECT 1 FROM project_tray_purpose_templates WHERE project_file_id=$1', [old.id])).rows.length)) return fail('DRAWING_SOURCE_FILE_CONFLICT');
      if (old) {
        const owner = (await c.query<{ tray_id: string; kind: string }>('SELECT e.tray_id,f.kind FROM pf_drawing_export_files f JOIN pf_drawing_exports e ON e.id=f.export_id WHERE f.file_id=$1 AND e.committed_at IS NOT NULL ORDER BY e.committed_at DESC,e.id DESC LIMIT 1', [old.id])).rows[0];
        if (!owner || owner.tray_id !== trayId || owner.kind !== file.kind) return fail('DRAWING_OUTPUT_SCOPE_CONFLICT');
      }
      const fileId = old?.id ?? file.id;
      if (old) {
        await c.query(`INSERT INTO project_file_versions(id,project_file_id,version_number,object_key,file_name,content_type,size_bytes,uploaded_by)
          SELECT $1,f.id,COALESCE((SELECT max(version_number) FROM project_file_versions WHERE project_file_id=f.id),0)+1,f.object_key,f.file_name,f.content_type,f.size_bytes,f.uploaded_by FROM project_files f WHERE f.id=$2`, [randomUUID(), fileId]);
        await c.query('UPDATE project_files SET object_key=$1,file_name=$2,content_type=$3,size_bytes=$4,uploaded_by=$5,uploaded_at=now() WHERE id=$6', [file.objectKey, file.fileName, file.contentType, file.sizeBytes, who.userId, fileId]);
      } else {
        await c.query('INSERT INTO project_files(id,project_id,object_key,file_name,content_type,size_bytes,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [fileId, projectId, file.objectKey, file.fileName, file.contentType, file.sizeBytes, who.userId]);
        await c.query('INSERT INTO pf_drawing_generated_files(file_id,project_id) VALUES($1,$2)', [fileId, projectId]);
      }
      await c.query('INSERT INTO pf_drawing_export_files(export_id,kind,file_id,object_key,content_sha256,size_bytes) VALUES($1,$2,$3,$4,$5,$6)', [planned.stage.exportId, file.kind, fileId, file.objectKey, file.sha256, file.sizeBytes]);
      saved.push({ kind: file.kind, id: fileId, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.sizeBytes, sha256: file.sha256 });
    }
    const receipt = drawingExportReceiptSchema.parse({ schemaVersion: 'pathfinder.tray-drawing-export.v1', projectId, projectTrayId: trayId, snapshotId: command.snapshotId, contentSha256: command.expectedContentSha256, exportId: planned.stage.exportId, duplicate: false, files: saved });
    await c.query('UPDATE pf_drawing_exports SET receipt=$1,committed_at=now() WHERE id=$2 AND receipt IS NULL', [receipt, planned.stage.exportId]);
    return receipt;
  }, { edit: true });
}
