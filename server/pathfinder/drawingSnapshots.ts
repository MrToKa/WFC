import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { canonicalPurposeJson, normalizeCatalogKey, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { DEFAULT_DRAWING_MODES } from '../../shared/pathfinderDrawingPolicy.js';
import { drawingSettingsWriteSchema, drawingProjectSchema, trayDrawingDataSchema, trayDrawingOverrideSchema, trayDrawingResponseSchema, trayDrawingSnapshotSchema, drawingInputHashInput, drawingSettingsHashInput, drawingContentHashInput, type DrawingSettingsWrite, type TrayDrawingResponse, type TrayDrawingSnapshot } from '../../shared/trayDrawingSnapshot.js';
import { drawingRoutingContainsTray, makeTrayDrawingInput, trayDrawingDiagnostics as drawingDiagnostics } from '../../shared/trayDrawingInputs.js';
import { computeTrayDrawing } from '../../shared/trayDrawing/index.js';
import { ensureProjectExists } from '../services/projectService.js';
import { mapProjectRow } from '../models/project.js';
import { mapTrayRow, type TrayRow } from '../models/tray.js';
import { mapCableRow, type CableWithTypeRow } from '../models/cable.js';
import { mapMaterialTrayRow, type MaterialTrayRow } from '../models/materialTray.js';
import { mapMaterialSupportRow, type MaterialSupportRow } from '../models/materialSupport.js';
import { mapMaterialLoadCurveRow, mapMaterialLoadCurvePointRow, type MaterialLoadCurveRow, type MaterialLoadCurvePointRow } from '../models/materialLoadCurve.js';
import { mapCableTypeRow, type CableTypeRow } from '../models/cableType.js';
import { readDrawingPolicy } from './drawingPolicy.js';
import { readPurposePolicyState } from './policySchema.js';
import type { DrawingAuthority } from './drawingAccess.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';

export const drawingDigest = (value: unknown): string => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const fail = (code: string, status = 409, message = 'The tray drawing is unavailable. Refresh its inputs.') => { throw new PathFinderError(code, status, message); };
const MAX_BYTES = 32 * 1024 * 1024;
export { drawingDiagnostics };
export const DRAWING_SNAPSHOT_SQL = `
ALTER TABLE pf_catalog_snapshots ADD COLUMN IF NOT EXISTS proof_projection_version text NOT NULL DEFAULT 'pathfinder.local-catalog-source.v1';
CREATE TABLE IF NOT EXISTS pf_tray_drawing_settings(
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,tray_id uuid NOT NULL REFERENCES trays(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),value jsonb,PRIMARY KEY(project_id,tray_id)
);
CREATE TABLE IF NOT EXISTS pf_tray_drawing_settings_history(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,tray_id uuid NOT NULL,
 actor_id uuid NOT NULL,login_id uuid NOT NULL,idempotency_key uuid NOT NULL,request_sha256 text NOT NULL,request_body jsonb NOT NULL,
 previous_value jsonb,value jsonb,revision bigint NOT NULL,drawing_input_revision bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,tray_id,actor_id,idempotency_key),UNIQUE(project_id,tray_id,revision)
);
CREATE TABLE IF NOT EXISTS pf_tray_drawing_snapshots(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,tray_id uuid NOT NULL,
 content_sha256 text NOT NULL,payload jsonb NOT NULL CHECK(octet_length(payload::text)<=33554432),source_facts jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,tray_id,content_sha256)
);
CREATE OR REPLACE FUNCTION pf_drawing_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Drawing snapshots and history are immutable';END $$;
DROP TRIGGER IF EXISTS pf_drawing_snapshot_immutable ON pf_tray_drawing_snapshots;
CREATE TRIGGER pf_drawing_snapshot_immutable BEFORE UPDATE OR DELETE ON pf_tray_drawing_snapshots FOR EACH ROW EXECUTE FUNCTION pf_drawing_snapshot_immutable();
DROP TRIGGER IF EXISTS pf_drawing_settings_history_immutable ON pf_tray_drawing_settings_history;
CREATE TRIGGER pf_drawing_settings_history_immutable BEFORE UPDATE OR DELETE ON pf_tray_drawing_settings_history FOR EACH ROW EXECUTE FUNCTION pf_drawing_snapshot_immutable();
`;
export async function initializeDrawingSnapshotSchema(pool: Pool): Promise<void> {
  const c = await pool.connect();
  try { await c.query('BEGIN'); await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-purpose-policy-schema-v1'))"); await c.query(DRAWING_SNAPSHOT_SQL); await c.query('COMMIT'); }
  catch (error) { await c.query('ROLLBACK').catch(() => undefined); throw error; } finally { c.release(); }
}

async function collectDrawingSources(c: PoolClient, projectId: string, trayId: string) {
  const projectRow = await ensureProjectExists(projectId, c);
  if (!projectRow) return fail('PROJECT_NOT_FOUND', 404);
  const trayRow = (await c.query<TrayRow>('SELECT * FROM trays WHERE project_id=$1 AND id=$2', [projectId, trayId])).rows[0];
  if (!trayRow) return fail('TRAY_NOT_FOUND', 404, 'The tray is unavailable.');
  const project = mapProjectRow(projectRow), tray = mapTrayRow(trayRow);
  const projectTrays = (await c.query<TrayRow>('SELECT * FROM trays WHERE project_id=$1 ORDER BY name,id LIMIT 100001', [projectId])).rows;
  if (projectTrays.length > 100000) return fail('DRAWING_INPUT_LIMIT', 413);
  const reportTrays = projectTrays.map(mapTrayRow);
  const rows = (await c.query<CableWithTypeRow>(`SELECT c.*,ct.name AS type_name,ct.purpose AS type_purpose,ct.diameter_mm AS type_diameter_mm,ct.weight_kg_per_m AS type_weight_kg_per_m
    FROM cables c JOIN cable_types ct ON ct.id=c.cable_type_id AND ct.project_id=c.project_id WHERE c.project_id=$1 ORDER BY c.cable_id,c.id LIMIT 100001`, [projectId])).rows;
  if (rows.length > 100000) return fail('DRAWING_INPUT_LIMIT', 413);
  const cables = rows.map(mapCableRow), trayCables = cables.filter(v => drawingRoutingContainsTray(v.routing, tray.name));
  const materials = (await c.query<MaterialTrayRow>(`SELECT m.*,l.name AS load_curve_name FROM material_trays m LEFT JOIN material_load_curves l ON l.id=m.load_curve_id
    WHERE lower(trim(m.tray_type))=lower(trim($1)) ORDER BY m.id LIMIT 2`, [tray.type ?? ''])).rows;
  if (materials.length > 1) return fail('DRAWING_MATERIAL_AMBIGUOUS', 409, 'Resolve duplicate material tray types before drawing.');
  // Selected source metadata only; image downloads retain their existing authorization.
  const materialTrays = materials.map(mapMaterialTrayRow);
  const typeRows = (await c.query<CableTypeRow>('SELECT * FROM cable_types WHERE project_id=$1 ORDER BY name,id LIMIT 100001', [projectId])).rows;
  const supportRows = (await c.query<MaterialSupportRow>('SELECT s.* FROM material_supports s WHERE s.id IN(SELECT support_id FROM project_support_distances WHERE project_id=$1) ORDER BY s.id LIMIT 10001', [projectId])).rows;
  if (typeRows.length > 100000 || supportRows.length > 10000) return fail('DRAWING_INPUT_LIMIT', 413);
  const curveId = materials[0]?.load_curve_id;
  const curveRows = curveId ? (await c.query<MaterialLoadCurveRow>('SELECT * FROM material_load_curves WHERE id=$1', [curveId])).rows : [];
  const points = curveId ? (await c.query<MaterialLoadCurvePointRow>('SELECT * FROM material_load_curve_points WHERE load_curve_id=$1 ORDER BY point_order,id LIMIT 100001', [curveId])).rows : [];
  if (points.length > 100000) return fail('DRAWING_INPUT_LIMIT', 413);
  const cableTypes = typeRows.map(mapCableTypeRow), materialSupports = supportRows.map(v => ({ ...mapMaterialSupportRow(v), imageTemplateId: null, imageTemplateFileName: null, imageTemplateContentType: null }));
  const loadCurves = curveRows.map(row => mapMaterialLoadCurveRow(row, points.map(mapMaterialLoadCurvePointRow)));
  // Exact source rows bind report inputs too. Generated output files are excluded unless
  // explicitly referenced as a source/template, which makes them source dependencies again.
  const sources = (await c.query<{ facts: unknown }>(`SELECT jsonb_build_object(
    'project',to_jsonb(p), 'tray',to_jsonb(t), 'material',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM material_trays m WHERE lower(trim(m.tray_type))=lower(trim(t.tray_type))),'[]'::jsonb),
    'supports',COALESCE((SELECT jsonb_agg(to_jsonb(d)||jsonb_build_object('support',to_jsonb(s)) ORDER BY d.tray_type) FROM project_support_distances d LEFT JOIN material_supports s ON s.id=d.support_id WHERE d.project_id=p.id),'[]'::jsonb),
    'curves',COALESCE((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('points',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.point_order,x.id) FROM material_load_curve_points x WHERE x.load_curve_id=l.id),'[]'::jsonb)) ORDER BY l.id) FROM material_load_curves l WHERE l.id IN(SELECT load_curve_id FROM material_trays WHERE lower(trim(tray_type))=lower(trim(t.tray_type)))),'[]'::jsonb),
    'reportFiles',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM project_files f WHERE f.id IN(SELECT project_file_id FROM project_tray_purpose_templates WHERE project_id=p.id)),'[]'::jsonb),
    'imageTemplates',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM template_files f WHERE f.id IN(SELECT image_template_id FROM material_trays WHERE lower(trim(tray_type))=lower(trim(t.tray_type)))),'[]'::jsonb)
  ) AS facts FROM projects p JOIN trays t ON t.project_id=p.id WHERE p.id=$1 AND t.id=$2`, [projectId, trayId])).rows[0]?.facts;
  return { data: { project, tray, reportTrays, cables, trayCables, materialTrays, cableTypes, materialSupports, loadCurves }, sources };
}

/** Caller owns drawingAccessTransaction and the project/state lock. Never opens a pool read. */
export async function readTrayDrawingSnapshot(c: PoolClient, projectId: string, trayId: string, authority: DrawingAuthority): Promise<TrayDrawingResponse> {
  if (!policyUuidSchema.safeParse(trayId).success) return fail('INVALID_DRAWING_TRAY', 400);
  const state = await readPurposePolicyState(c, projectId, { lock: true });
  const { data, sources } = await collectDrawingSources(c, projectId, trayId);
  const policy = await readDrawingPolicy(c, projectId);
  const row = (await c.query<{ revision: string; value: unknown }>('SELECT revision::text,value FROM pf_tray_drawing_settings WHERE project_id=$1 AND tray_id=$2', [projectId, trayId])).rows[0];
  const override = { revision: row?.revision ?? '0', value: row?.value ?? null };
  const purposeKey = data.tray.purpose == null ? null : normalizeCatalogKey(data.tray.purpose) || null;
  const categoryModes = policy.rules.find(rule => rule.purposeKey === purposeKey)?.categoryModes ?? { ...DEFAULT_DRAWING_MODES };
  // Validate server inputs before the potentially expensive layout calculation.
  const validated = trayDrawingDataSchema.parse(data);
  const settings = trayDrawingOverrideSchema.parse(override);
  const layout = computeTrayDrawing(makeTrayDrawingInput(validated, settings.value, categoryModes));
  const { diagnostics, blocked } = drawingDiagnostics(validated, layout);
  const sourceSha256 = drawingDigest(sources);
  const inputSha256 = drawingDigest(drawingInputHashInput(validated, sourceSha256)), settingsSha256 = drawingDigest(drawingSettingsHashInput(settings, categoryModes));
  const partial = { schemaVersion: 'pathfinder.tray-drawing-snapshot.v1' as const, projectId, projectTrayId: trayId,
    catalogRevision: state.catalogRevision, drawingPolicyRevision: state.drawingPolicyRevision, drawingInputRevision: state.drawingInputRevision,
    layoutAlgorithmVersion: 'wfc-tray-placement-v2' as const, purposeKey, categoryModes, legacySidePolicyVersion: 'wfc-tray-sides-v1' as const, settingsSha256, inputSha256,
    orderedCableIds: validated.trayCables.map(v => v.id), state: blocked ? 'blocked' as const : diagnostics.length ? 'diagnostic' as const : 'ready' as const, diagnostics };
  const contentSha256 = drawingDigest(drawingContentHashInput(partial, layout));
  const existing = (await c.query<{ id: string; payload: unknown; source_facts: unknown }>('SELECT id,payload,source_facts FROM pf_tray_drawing_snapshots WHERE project_id=$1 AND tray_id=$2 AND content_sha256=$3', [projectId, trayId, contentSha256])).rows[0];
  const snapshotId = existing?.id ?? randomUUID();
  const snapshot = trayDrawingSnapshotSchema.parse({ ...partial, snapshotId, contentSha256 });
  const immutable = { schemaVersion: 'pathfinder.tray-drawing-response.v1' as const, snapshot, data: validated, override: settings, sourceSha256, layout };
  if (Buffer.byteLength(canonicalPurposeJson(immutable)) > MAX_BYTES) return fail('DRAWING_RESPONSE_LIMIT', 413);
  if (existing) {
    if (drawingDigest(existing.payload) !== drawingDigest(immutable) || drawingDigest(existing.source_facts) !== drawingDigest(sources)) return fail('DRAWING_SNAPSHOT_INTEGRITY');
  } else {
    const count = Number((await c.query<{ count: string }>('SELECT count(*)::text FROM pf_tray_drawing_snapshots WHERE project_id=$1 AND tray_id=$2', [projectId, trayId])).rows[0].count);
    if (count >= 4096) return fail('DRAWING_RETENTION_LIMIT', 413, 'Archive old drawing snapshots before preparing more.');
    await c.query('INSERT INTO pf_tray_drawing_snapshots(id,project_id,tray_id,content_sha256,payload,source_facts) VALUES($1,$2,$3,$4,$5,$6)', [snapshotId, projectId, trayId, contentSha256, immutable, sources]);
  }
  return trayDrawingResponseSchema.parse({ ...immutable, permissions: { canEdit: authority.canEdit } });
}

export async function saveTrayDrawingSettings(c: PoolClient, projectId: string, trayId: string, who: JobPrincipal, input: DrawingSettingsWrite, authority: DrawingAuthority): Promise<TrayDrawingResponse> {
  if (!authority.canEdit) return fail('DRAWING_EDIT_REQUIRED', 403);
  const command = drawingSettingsWriteSchema.parse(input), requestSha = drawingDigest(command);
  const state = await readPurposePolicyState(c, projectId, { lock: true });
  const replay = (await c.query<{ request_sha256: string; request_body: unknown }>('SELECT request_sha256,request_body FROM pf_tray_drawing_settings_history WHERE project_id=$1 AND tray_id=$2 AND actor_id=$3 AND idempotency_key=$4', [projectId, trayId, who.userId, command.idempotencyKey])).rows[0];
  if (replay) {
    if (replay.request_sha256 !== requestSha || drawingDigest(replay.request_body) !== requestSha) return fail('IDEMPOTENCY_CONFLICT');
    return readTrayDrawingSnapshot(c, projectId, trayId, authority);
  }
  if (!(await c.query('SELECT id FROM trays WHERE project_id=$1 AND id=$2', [projectId, trayId])).rows.length) return fail('TRAY_NOT_FOUND', 404);
  const before = (await c.query<{ revision: string; value: unknown }>('SELECT revision::text,value FROM pf_tray_drawing_settings WHERE project_id=$1 AND tray_id=$2 FOR UPDATE', [projectId, trayId])).rows[0];
  const current = before?.revision ?? '0';
  if (command.expectedDrawingInputRevision !== state.drawingInputRevision || command.expectedRevision !== current) return fail('DRAWING_SETTINGS_STALE', 409, 'The drawing inputs changed. Refresh before saving.');
  if (BigInt(current) === 9223372036854775807n || BigInt(state.drawingInputRevision) === 9223372036854775807n) return fail('DRAWING_REVISION_LIMIT');
  const next = (BigInt(current) + 1n).toString(), nextInput = (BigInt(state.drawingInputRevision) + 1n).toString();
  await c.query('INSERT INTO pf_tray_drawing_settings(project_id,tray_id,revision,value) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,tray_id) DO UPDATE SET revision=excluded.revision,value=excluded.value', [projectId, trayId, next, command.value]);
  await c.query("SELECT pf_catalog_bump($1,false,true,'tray-drawing-settings')", [projectId]);
  await c.query('INSERT INTO pf_tray_drawing_settings_history(id,project_id,tray_id,actor_id,login_id,idempotency_key,request_sha256,request_body,previous_value,value,revision,drawing_input_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [randomUUID(), projectId, trayId, who.userId, who.loginId, command.idempotencyKey, requestSha, command, before?.value ?? null, command.value, next, nextInput]);
  return readTrayDrawingSnapshot(c, projectId, trayId, authority);
}

export async function assertCurrentDrawingSnapshot(c: PoolClient, projectId: string, trayId: string, snapshotId: string, expectedHash: string, authority: DrawingAuthority): Promise<TrayDrawingResponse> {
  const current = await readTrayDrawingSnapshot(c, projectId, trayId, authority);
  if (current.snapshot.snapshotId !== snapshotId || current.snapshot.contentSha256 !== expectedHash) return fail('DRAWING_SNAPSHOT_STALE', 409, 'The drawing changed. Refresh before exporting.');
  if (current.snapshot.state === 'blocked') return fail('DRAWING_SNAPSHOT_BLOCKED', 409, 'Resolve the drawing diagnostics before exporting.');
  return current;
}

/** Bounded XLSX metadata calculation, under the SAME authority/state transaction.
 * Uses the strict layout engine without storing hundreds of duplicate full-input
 * snapshots. No client free-space claims and no silent partial output. */
export async function readProjectDrawingFreeSpace(c: PoolClient, projectId: string) {
  const state = await readPurposePolicyState(c, projectId, { lock: true });
  const policy = await readDrawingPolicy(c, projectId);
  const ids = (await c.query<{ id: string }>('SELECT id FROM trays WHERE project_id=$1 ORDER BY name,id LIMIT 2001', [projectId])).rows;
  if (ids.length > 2000) return fail('DRAWING_EXPORT_TRAY_LIMIT', 413, 'Export at most 2000 trays in one request.');
  const deadline = Date.now() + 30000, freeSpaceByTrayId: Record<string, number | null> = {};
  const provenance: Array<{ trayId: string; layoutSha256: string; inputSha256: string; state: string }> = [];
  const trays = [];
  let project: TrayDrawingResponse['data']['project'] | undefined, commands = 0, memberships = 0;
  for (const row of ids) {
    if (Date.now() > deadline) return fail('DRAWING_EXPORT_DEADLINE', 413, 'The export exceeded its calculation budget. Use a smaller tray set.');
    const captured = await collectDrawingSources(c, projectId, row.id), data = trayDrawingDataSchema.parse(captured.data);
    project ??= data.project; trays.push(data.tray);
    const overrideRow = (await c.query<{ value: unknown }>('SELECT value FROM pf_tray_drawing_settings WHERE project_id=$1 AND tray_id=$2', [projectId, row.id])).rows[0];
    const value = trayDrawingOverrideSchema.shape.value.parse(overrideRow?.value ?? null);
    const purpose = data.tray.purpose ? normalizeCatalogKey(data.tray.purpose) : null;
    const modes = policy.rules.find(v => v.purposeKey === purpose)?.categoryModes ?? { ...DEFAULT_DRAWING_MODES };
    const layout = computeTrayDrawing(makeTrayDrawingInput(data, value, modes)), { blocked } = drawingDiagnostics(data, layout);
    commands += layout.commands.length; memberships += data.trayCables.length;
    if (commands > 2_000_000 || memberships > 500_000) return fail('DRAWING_EXPORT_CAPACITY_LIMIT', 413);
    // Retain the existing Type A/MV free-space exclusion in both UI and XLSX.
    const excluded = data.tray.purpose?.trim().toLowerCase() === 'type a (pink color) for mv cables';
    const summary = layout.summary, width = data.tray.widthMm;
    const occupied = summary ? data.project.cableLayout.considerBundleSpacingAsFree ? summary.occupiedWidthWithoutBundleSpacingMm : summary.occupiedWidthWithBundleSpacingMm : null;
    freeSpaceByTrayId[row.id] = blocked || excluded || !width || occupied === null ? null : Math.max(0, (width - occupied) / width * 100);
    provenance.push({ trayId: row.id, layoutSha256: drawingDigest(layout), inputSha256: drawingDigest(drawingInputHashInput(data, drawingDigest(captured.sources))), state: blocked ? 'blocked' : 'ready' });
  }
  if (!project) { const p = await ensureProjectExists(projectId, c); if (!p) return fail('PROJECT_NOT_FOUND', 404); project = drawingProjectSchema.parse(mapProjectRow(p)); }
  return { project, trays, freeSpaceByTrayId, provenance, revisions: { catalogRevision: state.catalogRevision, drawingPolicyRevision: state.drawingPolicyRevision, drawingInputRevision: state.drawingInputRevision }, layoutAlgorithmVersion: 'wfc-tray-placement-v2' };
}
