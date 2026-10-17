import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';
import { ModelRegistryError } from './errors.js';
import type {
  ImportRecord, ImportState, ModelFailure, ModelHealth, ModelSource, PortableManifest,
  SelectionRecord, StorageOwnership, VerificationReport, VersionRecord,
} from './types.js';
export { toImportDto, toVersionDto } from './types.js';

type Row = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shaPattern = /^[0-9a-f]{64}$/;
const terminal = new Set<ImportState>(['complete', 'failed']);
function uuid(value: string): string {
  if (!uuidPattern.test(value)) throw new ModelRegistryError('INVALID_IMPORT_REQUEST');
  return value.toLowerCase();
}
function number(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new ModelRegistryError('REGISTRY_FAILURE', 500);
  return result;
}
function date(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
function nullableDate(value: unknown): string | null { return value == null ? null : date(value); }
function importRecord(row: Row): ImportRecord {
  return {
    id: String(row.id), projectId: String(row.project_id), requestedBy: String(row.requested_by),
    idempotencyKey: String(row.idempotency_key), archiveSha256: String(row.archive_sha256),
    expectedBytes: row.expected_bytes == null ? null : number(row.expected_bytes), ownerToken: String(row.owner_token),
    receivedBytes: number(row.received_bytes), state: row.state as ImportState,
    modelVersionId: row.model_version_id == null ? null : String(row.model_version_id),
    failure: row.failure as ModelFailure | null, verificationReport: row.verification_report as VerificationReport | null,
    duplicate: row.duplicate === true, cleanedAt: nullableDate(row.cleaned_at), stagingCleanedAt: nullableDate(row.staging_cleaned_at),
    createdAt: date(row.created_at), updatedAt: date(row.updated_at),
  };
}
function versionRecord(row: Row): VersionRecord {
  return {
    id: String(row.id), projectId: String(row.project_id), packageId: String(row.package_id),
    contentFingerprint: String(row.content_fingerprint), label: String(row.label), source: row.source as ModelSource,
    schemaVersion: 1, supportProfile: row.support_profile as PortableManifest['supportProfile'], format: 'svf',
    sdkVersion: '7.130.0', entrypoint: row.entrypoint as PortableManifest['entrypoint'], preparedAt: date(row.prepared_at),
    importedAt: nullableDate(row.imported_at), importedBy: String(row.imported_by), state: row.state as VersionRecord['state'],
    health: row.health as ModelHealth, resourceCount: number(row.resource_count), totalBytes: number(row.total_bytes),
    validationReportId: row.validation_report_id == null ? null : String(row.validation_report_id),
    failure: row.failure as ModelFailure | null, manifest: row.manifest as PortableManifest,
    storagePrefix: String(row.storage_prefix), ownerImportId: String(row.owner_import_id),
  };
}
function ownershipRecord(row: Row): StorageOwnership {
  return {
    importId: String(row.import_id), projectId: String(row.project_id), modelVersionId: String(row.model_version_id),
    storagePrefix: String(row.storage_prefix), ownerToken: String(row.owner_token), published: row.published === true,
    cleanedAt: nullableDate(row.cleaned_at), createdAt: date(row.created_at),
  };
}
function selectionRecord(row: Row): SelectionRecord {
  return {
    projectId: String(row.project_id), activeModelVersionId: row.active_model_version_id == null ? null : String(row.active_model_version_id),
    selectionRevision: number(row.selection_revision), updatedAt: date(row.updated_at),
  };
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* A failed COMMIT remains ambiguous; caller reconciles. */ }
    throw error;
  } finally { client.release(); }
}

async function lockProject(client: PoolClient, projectId: string): Promise<void> {
  const result = await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [uuid(projectId)]);
  if (!result.rows.length) throw new ModelRegistryError('PROJECT_NOT_FOUND', 404);
}
async function ownedJob(client: PoolClient, job: ImportRecord): Promise<ImportRecord> {
  const result = await client.query<Row>('SELECT * FROM model_import_jobs WHERE id=$1 AND project_id=$2 FOR UPDATE', [job.id, job.projectId]);
  if (!result.rows[0]) throw new ModelRegistryError('IMPORT_NOT_FOUND', 404);
  const current = importRecord(result.rows[0]);
  if (current.ownerToken !== job.ownerToken) throw new ModelRegistryError('IMPORT_FENCED', 409);
  return current;
}
function verifiedReport(job: ImportRecord, report: VerificationReport): void {
  const checks = ['portableManifest', 'safeArchive', 'rawInventory', 'fingerprint', 'supportedProfile', 'nestedReferences'] as const;
  const manifest = report?.manifest;
  if (report?.status !== 'PASS' || report.operation !== 'verify' || report.reportSchemaVersion !== 1 ||
      !manifest || !report.package || !Array.isArray(manifest.resources) || !Array.isArray(report.resources) ||
      !manifest.source || !shaPattern.test(manifest.source.sha256) || !Number.isSafeInteger(manifest.source.bytes) || manifest.source.bytes < 0 ||
      !['observed-local-file','captured-at-conversion'].includes(manifest.source.identityBasis) ||
      checks.some(key => report.checks?.[key] !== 'PASS') ||
      manifest.schemaVersion !== 1 || manifest.supportProfile !== 'svf-local-7.130.0-v1' ||
      manifest.format !== 'svf' || manifest.sdkVersion !== '7.130.0' || manifest.entrypoint !== 'resources/output/0/0.svf' ||
      !uuidPattern.test(manifest.packageId) || !shaPattern.test(manifest.contentFingerprint) ||
      manifest.packageId !== report.package.packageId || manifest.contentFingerprint !== report.contentFingerprint ||
      report.package.sha256 !== job.archiveSha256 || report.package.bytes !== job.receivedBytes ||
      (job.expectedBytes !== null && report.package.bytes !== job.expectedBytes) ||
      report.resourceCount !== manifest.resources.length || report.resourceCount !== report.resources.length ||
      report.totalRawBytes !== manifest.resources.reduce((sum, resource) => sum + resource.bytes, 0) ||
      report.resources.some((resource, index) => resource.path !== manifest.resources[index].path ||
        resource.bytes !== manifest.resources[index].bytes || resource.sha256 !== manifest.resources[index].sha256 ||
        resource.verifiedSha256 !== resource.sha256)) {
    throw new ModelRegistryError('VERIFICATION_FAILED', 422);
  }
}
function sameProvenance(source: ModelSource, other: ModelSource): boolean {
  return source.sha256 === other.sha256 && source.bytes === other.bytes && source.identityBasis === other.identityBasis;
}

function importLockKeys(importId: string): number[] {
  const bytes = createHash('sha256').update(uuid(importId)).digest();
  return [bytes.readInt32BE(0), bytes.readInt32BE(4)];
}
function heldLock(client: PoolClient, keys: number[]): { release(): Promise<void> } {
  let released = false;
  return { async release() {
    if (released) return;
    released = true;
    try { await client.query('SELECT pg_advisory_unlock($1::integer,$2::integer)', keys); }
    catch (error) { client.release(true); throw error; }
    client.release();
  } };
}
async function requireCurrentEditor(client: PoolClient, job: Pick<ImportRecord, 'projectId' | 'requestedBy'>): Promise<void> {
  const user = (await client.query<{ is_admin: boolean; role: string }>(
    'SELECT is_admin,role FROM users WHERE id=$1 FOR SHARE', [job.requestedBy])).rows[0];
  if (user?.is_admin) return;
  if (user?.role === 'engineer') {
    const access = await client.query('SELECT 1 FROM user_project_access WHERE user_id=$1 AND project_id=$2 FOR SHARE', [job.requestedBy,job.projectId]);
    if (access.rows.length) return;
  }
  throw new ModelRegistryError('IMPORT_ACCESS_REVOKED', 403);
}

export function createModelRegistryRepository(pool: Pool) {
  return {
    async findImportByRequest(input: { projectId: string; requestedBy: string; idempotencyKey: string; archiveSha256: string; expectedBytes: number | null }): Promise<ImportRecord | null> {
      const projectId = uuid(input.projectId), requestedBy = uuid(input.requestedBy), idempotencyKey = uuid(input.idempotencyKey);
      if (!shaPattern.test(input.archiveSha256) || (input.expectedBytes !== null &&
        (!Number.isSafeInteger(input.expectedBytes) || input.expectedBytes < 0 || input.expectedBytes > 2147483648))) {
        throw new ModelRegistryError('INVALID_IMPORT_REQUEST');
      }
      const result = await pool.query<Row>('SELECT * FROM model_import_jobs WHERE project_id=$1 AND requested_by=$2 AND idempotency_key=$3', [projectId,requestedBy,idempotencyKey]);
      if (!result.rows[0]) return null;
      const job = importRecord(result.rows[0]);
      if (job.archiveSha256 !== input.archiveSha256 || job.expectedBytes !== input.expectedBytes) throw new ModelRegistryError('IDEMPOTENCY_CONFLICT', 409);
      return job;
    },

    async beginImport(input: { projectId: string; requestedBy: string; idempotencyKey: string; archiveSha256: string; expectedBytes: number | null }): Promise<{ job: ImportRecord; duplicate: boolean; lock?: { release(): Promise<void> } }> {
      const projectId = uuid(input.projectId), requestedBy = uuid(input.requestedBy), idempotencyKey = uuid(input.idempotencyKey);
      if (!shaPattern.test(input.archiveSha256) || (input.expectedBytes !== null &&
        (!Number.isSafeInteger(input.expectedBytes) || input.expectedBytes < 0 || input.expectedBytes > 2147483648))) {
        throw new ModelRegistryError('INVALID_IMPORT_REQUEST');
      }
      const client = await pool.connect();
      let retained = false;
      try {
        await client.query('BEGIN');
        await lockProject(client, projectId);
        const inserted = await client.query<Row>(`INSERT INTO model_import_jobs
          (id,project_id,requested_by,idempotency_key,archive_sha256,expected_bytes,owner_token,state)
          VALUES($1,$2,$3,$4,$5,$6,$7,'receiving') ON CONFLICT(project_id,requested_by,idempotency_key) DO NOTHING RETURNING *`,
        [randomUUID(), projectId, requestedBy, idempotencyKey, input.archiveSha256, input.expectedBytes, randomUUID()]);
        const row = inserted.rows[0] ?? (await client.query<Row>(
          'SELECT * FROM model_import_jobs WHERE project_id=$1 AND requested_by=$2 AND idempotency_key=$3 FOR UPDATE',
          [projectId, requestedBy, idempotencyKey])).rows[0];
        const job = importRecord(row);
        if (job.archiveSha256 !== input.archiveSha256 || job.expectedBytes !== input.expectedBytes) throw new ModelRegistryError('IDEMPOTENCY_CONFLICT', 409);
        let lock: { release(): Promise<void> } | undefined;
        if (inserted.rows.length) {
          const keys = importLockKeys(job.id);
          const acquired = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS locked', keys);
          if (!acquired.rows[0]?.locked) throw new ModelRegistryError('IMPORT_BUSY', 503);
          lock = heldLock(client, keys);
        }
        await client.query('COMMIT');
        retained = lock !== undefined;
        return { job, duplicate: inserted.rows.length === 0, ...(lock ? { lock } : {}) };
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* COMMIT uncertainty is reconciled by the worker recovery. */ }
        client.release(true);
        retained = true;
        throw error;
      } finally { if (!retained) client.release(); }
    },

    async tryLockImport(importId: string): Promise<{ release(): Promise<void> } | null> {
      const keys = importLockKeys(importId);
      const client = await pool.connect();
      try {
        const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1::integer,$2::integer) AS locked', keys);
        if (!result.rows[0]?.locked) { client.release(); return null; }
      } catch (error) { client.release(true); throw error; }
      return heldLock(client, keys);
    },

    async getImport(projectId: string, importId: string): Promise<ImportRecord | null> {
      const result = await pool.query<Row>('SELECT * FROM model_import_jobs WHERE project_id=$1 AND id=$2', [uuid(projectId), uuid(importId)]);
      return result.rows[0] ? importRecord(result.rows[0]) : null;
    },

    async updateProgress(job: ImportRecord, state: ImportState, receivedBytes?: number): Promise<ImportRecord> {
      if (!['receiving','validating','staging'].includes(state) || (receivedBytes !== undefined &&
        (!Number.isSafeInteger(receivedBytes) || receivedBytes < 0 || receivedBytes > 2147483648))) throw new ModelRegistryError('INVALID_IMPORT_REQUEST');
      return transaction(pool, async client => {
        await lockProject(client, job.projectId);
        const current = await ownedJob(client, job);
        const order: Partial<Record<ImportState, number>> = { receiving: 0, staging: 1, validating: 2 };
        if (terminal.has(current.state) || current.state === 'publishing' || (order[state] ?? -1) < (order[current.state] ?? 99) ||
          (receivedBytes !== undefined &&
          (receivedBytes < current.receivedBytes || (current.expectedBytes !== null && receivedBytes > current.expectedBytes)))) {
          throw new ModelRegistryError('IMPORT_STATE_CONFLICT', 409);
        }
        const result = await client.query<Row>('UPDATE model_import_jobs SET state=$1,received_bytes=$2,updated_at=NOW() WHERE id=$3 RETURNING *',
          [state, receivedBytes ?? current.receivedBytes, current.id]);
        return importRecord(result.rows[0]);
      });
    },

    async reserve(job: ImportRecord, report: VerificationReport): Promise<
      { kind: 'reserved'; version: VersionRecord; ownership: StorageOwnership } |
      { kind: 'duplicate'; version: VersionRecord } | { kind: 'busy'; importId: string }> {
      return transaction(pool, async client => {
        await lockProject(client, job.projectId);
        const current = await ownedJob(client, job);
        if (current.state !== 'validating') throw new ModelRegistryError('IMPORT_STATE_CONFLICT', 409);
        verifiedReport(current, report);
        const manifest = report.manifest;
        await client.query(`INSERT INTO model_package_identities(package_id,content_fingerprint,support_profile,source_sha256,source_bytes,source_identity_basis)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [manifest.packageId, manifest.contentFingerprint,
          manifest.supportProfile, manifest.source.sha256, manifest.source.bytes, manifest.source.identityBasis]);
        const identity = (await client.query<Row>('SELECT * FROM model_package_identities WHERE package_id=$1 FOR UPDATE', [manifest.packageId])).rows[0];
        if (identity.content_fingerprint !== manifest.contentFingerprint || identity.support_profile !== manifest.supportProfile ||
          identity.source_sha256 !== manifest.source.sha256 || number(identity.source_bytes) !== manifest.source.bytes ||
          identity.source_identity_basis !== manifest.source.identityBasis) throw new ModelRegistryError('PACKAGE_ID_CONFLICT', 409);
        const existing = (await client.query<Row>("SELECT * FROM model_versions WHERE project_id=$1 AND content_fingerprint=$2 AND state='ready' FOR UPDATE",
          [current.projectId, manifest.contentFingerprint])).rows[0];
        if (existing) {
          const version = versionRecord(existing);
          if (!sameProvenance(version.source, manifest.source)) throw new ModelRegistryError('PROVENANCE_CONFLICT', 409);
          await client.query(`INSERT INTO model_package_aliases(project_id,package_id,model_version_id) VALUES($1,$2,$3)
            ON CONFLICT(project_id,package_id) DO NOTHING`, [current.projectId, manifest.packageId, version.id]);
          await client.query(`UPDATE model_import_jobs SET state='complete',model_version_id=$1,verification_report=$2,duplicate=TRUE,updated_at=NOW() WHERE id=$3`,
            [version.id, report, current.id]);
          return { kind: 'duplicate', version };
        }
        const reservation = (await client.query<Row>('SELECT * FROM model_content_reservations WHERE project_id=$1 AND content_fingerprint=$2 FOR UPDATE',
          [current.projectId, manifest.contentFingerprint])).rows[0];
        if (reservation) {
          const owner = (await client.query<Row>('SELECT * FROM model_import_jobs WHERE id=$1', [reservation.import_id])).rows[0];
          if (owner && !terminal.has(owner.state as ImportState)) return { kind: 'busy', importId: String(reservation.import_id) };
          throw new ModelRegistryError('IMPORT_STATE_CONFLICT', 409);
        }
        const id = randomUUID();
        const prefix = `projects/${current.projectId}/versions/${id}/`;
        await client.query(`INSERT INTO model_versions(id,project_id,package_id,content_fingerprint,label,source,schema_version,support_profile,format,sdk_version,entrypoint,prepared_at,imported_by,state,health,resource_count,total_bytes,manifest,storage_prefix,owner_import_id)
          VALUES($1,$2,$3,$4,$5,$6,1,$7,'svf','7.130.0',$8,$9,$10,'staging','unchecked',$11,$12,$13,$14,$15)`,
        [id,current.projectId,manifest.packageId,manifest.contentFingerprint,manifest.label,manifest.source,manifest.supportProfile,manifest.entrypoint,
          manifest.preparedAt,current.requestedBy,report.resourceCount,report.totalRawBytes,manifest,prefix,current.id]);
        const versionRow = (await client.query<Row>("UPDATE model_versions SET state='validating' WHERE id=$1 RETURNING *", [id])).rows[0];
        await client.query(`INSERT INTO model_content_reservations(project_id,content_fingerprint,import_id,model_version_id,owner_token) VALUES($1,$2,$3,$4,$5)`,
          [current.projectId,manifest.contentFingerprint,current.id,id,current.ownerToken]);
        const ownership = (await client.query<Row>(`INSERT INTO model_storage_ownership(import_id,project_id,model_version_id,storage_prefix,owner_token)
          VALUES($1,$2,$3,$4,$5) RETURNING *`, [current.id,current.projectId,id,prefix,current.ownerToken])).rows[0];
        await client.query("UPDATE model_import_jobs SET model_version_id=$1,verification_report=$2,updated_at=NOW() WHERE id=$3", [id,report,current.id]);
        return { kind: 'reserved', version: versionRecord(versionRow), ownership: ownershipRecord(ownership) };
      });
    },

    async markPublishing(job: ImportRecord): Promise<ImportRecord> {
      return transaction(pool, async client => {
        await lockProject(client, job.projectId);
        const current = await ownedJob(client, job);
        if (current.state !== 'validating' || !current.modelVersionId) throw new ModelRegistryError('IMPORT_STATE_CONFLICT', 409);
        const result = await client.query<Row>("UPDATE model_import_jobs SET state='publishing',updated_at=NOW() WHERE id=$1 RETURNING *", [current.id]);
        return importRecord(result.rows[0]);
      });
    },

    async publish(job: ImportRecord, version: VersionRecord, report: VerificationReport, readback: { resourceCount: number; totalBytes: number }): Promise<VersionRecord> {
      return transaction(pool, async client => {
        await lockProject(client, job.projectId);
        const current = await ownedJob(client, job);
        if (current.state !== 'publishing' || current.modelVersionId !== version.id) throw new ModelRegistryError('IMPORT_STATE_CONFLICT', 409);
        await requireCurrentEditor(client, current);
        verifiedReport(current, report);
        const row = (await client.query<Row>('SELECT * FROM model_versions WHERE id=$1 AND project_id=$2 FOR UPDATE', [version.id,current.projectId])).rows[0];
        const ownership = (await client.query<Row>('SELECT * FROM model_storage_ownership WHERE import_id=$1 FOR UPDATE', [current.id])).rows[0];
        const reservation = (await client.query<Row>('SELECT * FROM model_content_reservations WHERE project_id=$1 AND content_fingerprint=$2 FOR UPDATE',
          [current.projectId,report.contentFingerprint])).rows[0];
        if (!row || row.owner_import_id !== current.id || row.state !== 'validating' || !ownership || ownership.owner_token !== current.ownerToken ||
          ownership.model_version_id !== version.id || ownership.published || ownership.cleaned_at || !reservation ||
          reservation.import_id !== current.id || reservation.owner_token !== current.ownerToken || reservation.model_version_id !== version.id ||
          row.content_fingerprint !== report.contentFingerprint || !isDeepStrictEqual(row.manifest, report.manifest)) {
          throw new ModelRegistryError('IMPORT_FENCED', 409);
        }
        if (readback.resourceCount !== report.resourceCount || readback.totalBytes !== report.totalRawBytes) throw new ModelRegistryError('STORAGE_READBACK_FAILED', 422);
        const reportId = randomUUID();
        const receipt = { resourceCount: readback.resourceCount, totalBytes: readback.totalBytes, algorithm: 'SHA-256', status: 'PASS', verifiedAt: new Date().toISOString() };
        await client.query('INSERT INTO model_validation_reports(id,report,storage_readback) VALUES($1,$2,$3)', [reportId,report,receipt]);
        const result = await client.query<Row>(`UPDATE model_versions SET state='ready',health='healthy',imported_at=NOW(),validation_report_id=$1
          WHERE id=$2 RETURNING *`, [reportId,version.id]);
        await client.query('INSERT INTO model_package_aliases(project_id,package_id,model_version_id) VALUES($1,$2,$3)', [current.projectId,report.manifest.packageId,version.id]);
        await client.query("UPDATE model_import_jobs SET state='complete',verification_report=$1,updated_at=NOW() WHERE id=$2", [report,current.id]);
        await client.query('UPDATE model_storage_ownership SET published=TRUE WHERE import_id=$1', [current.id]);
        await client.query('DELETE FROM model_content_reservations WHERE project_id=$1 AND import_id=$2', [current.projectId,current.id]);
        return versionRecord(result.rows[0]);
      });
    },

    async reconcile(importId: string): Promise<{ published: boolean; ownership: StorageOwnership | null; job: ImportRecord | null }> {
      return transaction(pool, async client => {
        const owner = (await client.query<Row>('SELECT * FROM model_storage_ownership WHERE import_id=$1 FOR UPDATE', [uuid(importId)])).rows[0];
        const row = (await client.query<Row>('SELECT * FROM model_import_jobs WHERE id=$1', [importId])).rows[0];
        return { published: owner?.published === true, ownership: owner ? ownershipRecord(owner) : null, job: row ? importRecord(row) : null };
      });
    },

    async failImport(job: ImportRecord, failure: ModelFailure): Promise<ImportRecord | null> {
      const safe = new ModelRegistryError(failure.code, 422);
      return transaction(pool, async client => {
        // A deleted project leaves only the retained ownership record for controlled cleanup.
        const project = await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [job.projectId]);
        if (!project.rows.length) return null;
        const current = await ownedJob(client, job);
        if (current.state === 'complete' || current.state === 'failed') return current;
        const sanitized = { code: safe.code, message: safe.message };
        if (current.modelVersionId) await client.query("UPDATE model_versions SET state='failed',failure=$1 WHERE id=$2 AND owner_import_id=$3 AND state <> 'ready'", [sanitized,current.modelVersionId,current.id]);
        await client.query('DELETE FROM model_content_reservations WHERE project_id=$1 AND import_id=$2 AND owner_token=$3', [current.projectId,current.id,current.ownerToken]);
        const result = await client.query<Row>("UPDATE model_import_jobs SET state='failed',failure=$1,updated_at=NOW() WHERE id=$2 RETURNING *", [sanitized,current.id]);
        return importRecord(result.rows[0]);
      });
    },

    async markCleaned(importId: string, ownerToken?: string): Promise<void> {
      await transaction(pool, async client => {
        const values = [uuid(importId),ownerToken === undefined ? null : uuid(ownerToken)];
        await client.query('UPDATE model_storage_ownership SET cleaned_at=NOW() WHERE import_id=$1 AND published=FALSE AND cleaned_at IS NULL AND ($2::uuid IS NULL OR owner_token=$2)', values);
        await client.query("UPDATE model_import_jobs SET cleaned_at=NOW() WHERE id=$1 AND state='failed' AND cleaned_at IS NULL AND ($2::uuid IS NULL OR owner_token=$2)", values);
      });
    },

    async markStagingCleaned(importId: string, ownerToken: string): Promise<void> {
      await pool.query("UPDATE model_import_jobs SET staging_cleaned_at=NOW() WHERE id=$1 AND owner_token=$2 AND state IN ('complete','failed') AND staging_cleaned_at IS NULL", [uuid(importId),uuid(ownerToken)]);
    },

    async listRecoverableImports(): Promise<ImportRecord[]> {
      const result = await pool.query<Row>("SELECT * FROM model_import_jobs WHERE staging_cleaned_at IS NULL OR (state <> 'complete' AND cleaned_at IS NULL) ORDER BY updated_at,id LIMIT 100");
      return result.rows.map(importRecord);
    },

    async listUnpublishedOwnership(): Promise<StorageOwnership[]> {
      const result = await pool.query<Row>('SELECT * FROM model_storage_ownership WHERE published=FALSE AND cleaned_at IS NULL ORDER BY created_at,import_id');
      return result.rows.map(ownershipRecord);
    },

    async listVersions(projectId: string): Promise<{ versions: VersionRecord[]; selection: SelectionRecord }> {
      return transaction(pool, async client => {
        const selected = await client.query<Row>('SELECT * FROM project_model_selections WHERE project_id=$1', [uuid(projectId)]);
        if (!selected.rows[0]) throw new ModelRegistryError('PROJECT_NOT_FOUND', 404);
        const result = await client.query<Row>("SELECT * FROM model_versions WHERE project_id=$1 AND state='ready' ORDER BY imported_at,id", [projectId]);
        return { versions: result.rows.map(versionRecord), selection: selectionRecord(selected.rows[0]) };
      });
    },

    async getVersion(projectId: string, id: string): Promise<VersionRecord | null> {
      const result = await pool.query<Row>('SELECT * FROM model_versions WHERE project_id=$1 AND id=$2', [uuid(projectId),uuid(id)]);
      return result.rows[0] ? versionRecord(result.rows[0]) : null;
    },

    async selectModel(projectId: string, id: string | null, expectedRevision: number, requestedBy: string): Promise<SelectionRecord> {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new ModelRegistryError('INVALID_IMPORT_REQUEST');
      const actor = uuid(requestedBy);
      return transaction(pool, async client => {
        await lockProject(client, projectId);
        await requireCurrentEditor(client, { projectId, requestedBy: actor });
        const selection = (await client.query<Row>('SELECT * FROM project_model_selections WHERE project_id=$1 FOR UPDATE', [projectId])).rows[0];
        if (!selection || number(selection.selection_revision) !== expectedRevision) throw new ModelRegistryError('SELECTION_CONFLICT', 409);
        if (id !== null) {
          const version = (await client.query<Row>("SELECT id FROM model_versions WHERE project_id=$1 AND id=$2 AND state='ready' AND health='healthy' FOR UPDATE", [projectId,uuid(id)])).rows[0];
          if (!version) throw new ModelRegistryError('MODEL_NOT_SELECTABLE', 409);
        }
        const result = await client.query<Row>('UPDATE project_model_selections SET active_model_version_id=$1,selection_revision=selection_revision+1,updated_at=NOW() WHERE project_id=$2 RETURNING *', [id,projectId]);
        return selectionRecord(result.rows[0]);
      });
    },

    async setHealth(projectId: string, id: string, health: 'healthy' | 'unavailable'): Promise<VersionRecord | null> {
      if (!['healthy','unavailable'].includes(health)) throw new ModelRegistryError('INVALID_IMPORT_REQUEST');
      return transaction(pool, async client => {
        await lockProject(client, projectId);
        const result = await client.query<Row>("UPDATE model_versions SET health=$1 WHERE project_id=$2 AND id=$3 AND state='ready' RETURNING *", [health,projectId,uuid(id)]);
        return result.rows[0] ? versionRecord(result.rows[0]) : null;
      });
    },
  };
}

export type ModelRegistryRepository = ReturnType<typeof createModelRegistryRepository>;
