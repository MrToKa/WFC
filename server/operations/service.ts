import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { createModelRegistryRepository } from '../modelRegistry/repository.js';
import { createModelImportService } from '../modelRegistry/importService.js';
import type { ModelResourceReader, ModelStorage } from '../modelRegistry/storage.js';

export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
}
const hash = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');
const SESSION_TABLES = new Set(['viewer_login_bindings', 'viewer_resource_sessions']);
const MAX_ROWS = 1_000_000;
const MAX_OBJECTS = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function inventory(pool: Pool) {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = (await connection.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    if (tables.length > 500) throw Error('INVENTORY_LIMIT');
    const records = [];
    for (const { tablename } of tables) {
      if (!/^[a-z0-9_]+$/.test(tablename)) throw Error('UNSAFE_TABLE');
      const sizes = (await connection.query<{ count: string; json_bytes: string }>('SELECT COUNT(*) AS count,COALESCE(SUM(octet_length(to_jsonb(t)::text)),0) AS json_bytes FROM public."' + tablename + '" t')).rows[0];
      const count = Number(sizes.count);
      if (count > MAX_ROWS || Number(sizes.json_bytes) > 128 * 1024 ** 2) throw Error('INVENTORY_LIMIT');
      const rows = (await connection.query<{ value: unknown }>('SELECT to_jsonb(t) AS value FROM public."' + tablename + '" t')).rows.map(row => canonicalJson(row.value)).sort();
      records.push({ table: tablename, rows: count, sha256: hash(rows), transientSessions: SESSION_TABLES.has(tablename) });
    }
    const pending = (await connection.query("SELECT state,COUNT(*)::integer AS count FROM model_import_jobs GROUP BY state ORDER BY state")).rows;
    const selection = (await connection.query<{ value: unknown }>('SELECT to_jsonb(s) AS value FROM project_model_selections s ORDER BY project_id')).rows.map(row => row.value);
    const models = (await connection.query('SELECT id,project_id,state,health,content_fingerprint,resource_count,total_bytes FROM model_versions ORDER BY project_id,id')).rows;
    await connection.query('COMMIT');
    return { schemaVersion: 1, command: 'inventory', status: 'PASS', tables: records, businessSha256: hash(records.filter(row => !row.transientSessions)), registrySha256: hash(records.filter(row => row.table.startsWith('model_') || row.table === 'project_model_selections')), selection, models, imports: pending, stagingPolicy: 'Capture exact cold staging bytes; retain unfinished jobs for ownership-bounded recovery, never infer publication from objects.' };
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { connection.release(); }
}

async function immutableState(pool: Pool): Promise<string> {
  const versions = (await pool.query("SELECT to_jsonb(v)-'health' AS value FROM model_versions v WHERE state='ready' ORDER BY id")).rows;
  const selection = (await pool.query('SELECT to_jsonb(s) AS value FROM project_model_selections s ORDER BY project_id')).rows;
  return hash({ versions, selection });
}

export async function auditModels(pool: Pool, storage: ModelResourceReader, signal?: AbortSignal) {
  const before = await immutableState(pool);
  const repository = createModelRegistryRepository(pool);
  const identities = (await pool.query<{ id: string; project_id: string }>("SELECT id,project_id FROM model_versions WHERE state='ready' ORDER BY project_id,id")).rows;
  if (identities.length > 1000) throw Error('AUDIT_LIMIT');
  const versions = [];
  for (const identity of identities) {
    const version = await repository.getVersion(identity.project_id, identity.id);
    if (!version || version.state !== 'ready') throw Error('MODEL_CHANGED');
    let resources = 0, bytes = 0, code: string | undefined;
    try {
      const declared = version.manifest.resources;
      if (!Array.isArray(declared) || declared.length !== version.resourceCount || declared.length < 1 || declared.length > MAX_OBJECTS || version.manifest.contentFingerprint !== version.contentFingerprint || declared.reduce((total, entry) => total + entry.bytes, 0) !== version.totalBytes || version.storagePrefix !== `projects/${version.projectId}/versions/${version.id}/`) throw Error('STORAGE_RESOURCE_INVALID');
      const names = new Set<string>();
      for (const resource of declared) {
        if (names.has(resource.path.toLowerCase())) throw Error('STORAGE_RESOURCE_INVALID');
        names.add(resource.path.toLowerCase());
        const verified = await storage.readVerifiedResource(version.storagePrefix, resource, signal);
        try { resources++; bytes += verified.bytes; } finally { await verified.close(); }
      }
      // The successful full readback is the only path that restores healthy.
      if (version.health !== 'healthy') await repository.setHealth(version.projectId, version.id, 'healthy');
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.message : '';
      code = ['STORAGE_INTEGRITY_FAILED', 'STORAGE_RESOURCE_INVALID', 'STORAGE_PREFIX_INVALID'].includes(errorCode) ? errorCode : 'STORAGE_UNAVAILABLE';
      if (code !== 'STORAGE_UNAVAILABLE' && version.health !== 'unavailable') await repository.setHealth(version.projectId, version.id, 'unavailable');
    }
    versions.push({ id: version.id, projectId: version.projectId, contentFingerprint: version.contentFingerprint, status: code ? 'FAIL' : 'PASS', health: code && code !== 'STORAGE_UNAVAILABLE' ? 'unavailable' : code ? version.health : 'healthy', resources, bytes, expectedResources: version.resourceCount, expectedBytes: version.totalBytes, ...(code ? { code } : {}), algorithm: 'SHA-256', basis: 'Existing full raw size/SHA pinned-resource reader; every successful handle closed.' });
  }
  const selectionUnchanged = before === await immutableState(pool);
  if (!selectionUnchanged) throw Error('IMMUTABLE_MODEL_OR_SELECTION_CHANGED');
  return { schemaVersion: 1, command: 'audit-models', status: versions.every(version => version.status === 'PASS') ? 'PASS' : 'FAIL', versions, totals: { versions: versions.length, resources: versions.reduce((sum, version) => sum + version.resources, 0), bytes: versions.reduce((sum, version) => sum + version.bytes, 0) }, selectionUnchanged, immutableReadyMetadataUnchanged: true };
}

export function requireQuarantine(environment: NodeJS.ProcessEnv): string {
  if (environment.WFC_OPS_QUARANTINE !== 'true' || !UUID.test(environment.WFC_OPS_TARGET_ID ?? '')) throw Error('OWNED_QUARANTINE_REQUIRED');
  return environment.WFC_OPS_TARGET_ID!;
}

export async function fenceRestored(pool: Pool, environment: NodeJS.ProcessEnv) {
  const targetId = requireQuarantine(environment), connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query("SELECT pg_advisory_xact_lock(hashtextextended('wfc.operations.restore-fence.v1',0))");
    const sessions = await connection.query("UPDATE viewer_resource_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),revoke_reason=COALESCE(revoke_reason,'logout') WHERE revoked_at IS NULL");
    const logins = await connection.query('UPDATE viewer_login_bindings SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE revoked_at IS NULL');
    const active = Number((await connection.query("SELECT (SELECT COUNT(*) FROM viewer_resource_sessions WHERE revoked_at IS NULL)+(SELECT COUNT(*) FROM viewer_login_bindings WHERE revoked_at IS NULL) AS count")).rows[0].count);
    if (active !== 0) throw Error('RESTORED_SESSIONS_NOT_FENCED');
    await connection.query('COMMIT');
    return { schemaVersion: 1, command: 'fence-restored', status: 'PASS', targetId, sessionsRevoked: sessions.rowCount, durableLoginTombstones: logins.rowCount, activeRestoredBindings: 0, loginRowsDeleted: 0, requiresFreshJwtSigningSecret: true };
  } catch (error) { await connection.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { connection.release(); }
}

export async function recoveryReport(pool: Pool, workRoot: string, storage: ModelStorage, apply: boolean, environment: NodeJS.ProcessEnv) {
  if (apply) requireQuarantine(environment);
  const repository = createModelRegistryRepository(pool);
  const before = await immutableState(pool);
  const jobs = await repository.listRecoverableImports();
  const ownership = (await pool.query('SELECT import_id,project_id,model_version_id,storage_prefix,published,cleaned_at FROM model_storage_ownership ORDER BY import_id')).rows;
  const readyIds = new Set((await pool.query<{ id: string }>("SELECT id FROM model_versions WHERE state='ready'")).rows.map(row => row.id));
  const staging = [];
  let entries: import('node:fs').Dirent[] = [];
  try {
    const stat = await fs.lstat(workRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(workRoot) !== path.resolve(workRoot)) throw Error('UNSAFE_STAGING_ROOT');
    entries = await fs.readdir(workRoot, { withFileTypes: true });
  } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
  if (entries.length > MAX_OBJECTS) throw Error('RECOVERY_LIMIT');
  for (const entry of entries) {
    const job = jobs.find(candidate => candidate.id === entry.name);
    let owned = false;
    if (job && entry.isDirectory() && !entry.isSymbolicLink()) {
      try {
        const markerPath = path.join(workRoot, entry.name, '.owner.json'), stat = await fs.lstat(markerPath);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 1024) {
          const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
          owned = marker.id === job.id && marker.token === job.ownerToken;
        }
      } catch { /* An unproven marker is retained, never repaired. */ }
    }
    staging.push({ name: entry.name, owned, action: owned ? 'eligible-for-existing-owner-bounded-recovery' : 'retain-unproven' });
  }
  if (apply) {
    const service = createModelImportService({ repository, storage, workRoot });
    try { await service.recover(); } finally { await service.close(); }
  }
  if (before !== await immutableState(pool)) throw Error('IMMUTABLE_MODEL_OR_SELECTION_CHANGED');
  const remaining = apply ? await repository.listRecoverableImports() : jobs;
  return { schemaVersion: 1, command: 'recover', status: apply && remaining.length ? 'DEFERRED' : 'PASS', dryRun: !apply, policy: 'retain', pending: jobs.map(job => ({ id: job.id, state: job.state, modelVersionId: job.modelVersionId })), remaining: remaining.map(job => ({ id: job.id, state: job.state, modelVersionId: job.modelVersionId })), staging, storageOwnership: ownership.map(row => ({ ...row, action: row.published ? readyIds.has(row.model_version_id) ? 'retain-published' : 'retain-published-orphan' : 'existing-ownership-bounded-recovery-only' })), publishedResourcesDeleted: 0, immutableReadyMetadataUnchanged: true, selectionUnchanged: true, automaticRetentionDeadline: null };
}
