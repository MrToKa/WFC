import { createHash } from 'node:crypto';
import { SOURCE, DATA_IMAGES } from './binding.mjs';

export const LIMITS = Object.freeze({ rowsPerTable: 100000, totalRows: 300000, objectsPerBucket: 20000, totalObjects: 30000, rawBytes: 64 * 1024 ** 2, diffBytes: 128 * 1024 ** 2, rowBytes: 4 * 1024 ** 2, helperMilliseconds: 120000, hostMilliseconds: 130000, totalMilliseconds: 300000, manifestBytes: 2 * 1024 ** 2 });
export const TABLE_KEYS = Object.freeze({
  projects: ['id'], cable_types: ['id'], cables: ['id'], project_model_selections: ['project_id'],
  model_package_identities: ['package_id'], model_validation_reports: ['id'], model_import_jobs: ['id'], model_versions: ['id'], model_content_reservations: ['project_id', 'content_fingerprint'], model_package_aliases: ['project_id', 'package_id'], model_storage_ownership: ['import_id'],
  pf_project_state: ['project_id'], pf_locations: ['id'], pf_location_aliases: ['project_id', 'normalized_alias'], pf_artifacts: ['id'], pf_model_objects: ['project_id', 'artifact_id', 'object_id'], pf_location_bindings: ['project_id', 'location_id', 'model_version_id'], pf_location_matches: ['project_id', 'location_id', 'model_version_id'], pf_location_events: ['id'], pf_jobs: ['id'], pf_job_items: ['project_id', 'job_id', 'cable_id'], pf_proposals: ['id'], pf_lookup_results: ['project_id', 'job_id'], pf_synthetic_projects: ['project_id'], pf_synthetic_proofs: ['project_id', 'artifact_id'], pf_reviews: ['id'], pf_apply_receipts: ['id'],
});
export const TABLES = Object.freeze(Object.keys(TABLE_KEYS));
export const AUTH = Object.freeze(['viewer_login_bindings', 'viewer_resource_sessions']);
export const BUCKETS = Object.freeze(['pf-local-models', 'pf-local-project-files', 'pf-local-template-files']);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, SHA = /^[a-f0-9]{64}$/;
export const fail = code => { throw Object.assign(Error(code), { code }); };
const requireThat = (ok, code) => { if (!ok) fail(code); };
export const hash = bytes => createHash('sha256').update(typeof bytes === 'string' || bytes instanceof Uint8Array ? bytes : JSON.stringify(bytes)).digest('hex');
export const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
export function equalTimestamp(a, b) {
  const normalize = value => {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value ?? '');
    if (!match) return null; const base = Date.parse(match[1] + match[3]);
    return Number.isFinite(base) ? new Date(base).toISOString().slice(0, 19) + '.' + (match[2] ?? '').padEnd(6, '0') : null;
  };
  const first = normalize(a); return first !== null && first === normalize(b);
}
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === [...names].sort().join();
const integer = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const decimalInteger = value => typeof value === 'string' && /^(?:0|[1-9][0-9]{0,15})$/.test(value) && Number.isSafeInteger(Number(value));
const timestamp = value => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const order = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)); // PostgreSQL COLLATE "C" UTF8 order.
const sortedUnique = (rows, key) => rows.every((row, index) => index === 0 || order(rows[index - 1][key], row[key]) < 0);
function parseRow(text) { try { const row = JSON.parse(text); requireThat(row && typeof row === 'object' && !Array.isArray(row), 'RECOVERY_ROW_JSON'); return row; } catch { fail('RECOVERY_ROW_JSON'); } }

export function validateCaptureBinding(binding) {
  requireThat(binding && ['source', 'target'].includes(binding.kind) && UUID.test(binding.owner ?? '') && typeof binding.runtime === 'string' && typeof binding.project === 'string' && binding.apiImage === SOURCE.apiImage && binding.webImage === SOURCE.webImage && ['apiId', 'pgId', 'webId', 'minioId'].every(key => SHA.test(binding[key] ?? '')) && binding.pgImage === DATA_IMAGES.postgres && binding.minioImage === DATA_IMAGES.minio && typeof binding.pgAddress === 'string' && binding.pgAddress.length <= 45, 'RECOVERY_AUDIT_BINDING');
  if (binding.kind === 'source') requireThat(binding.owner === SOURCE.owner && binding.project === SOURCE.project && binding.port === 5191 && binding.runtime === SOURCE.runtime && binding.backupId === null, 'RECOVERY_AUDIT_SOURCE');
  else requireThat(binding.owner !== SOURCE.owner && binding.project !== SOURCE.project && /^wfc-pathfinder-local-[a-f0-9]{12}$/.test(binding.project) && binding.port === 5192 && /^pathfinder-engine\/\.scratch\/copied-recovery-target-[a-f0-9-]{36}$/.test(binding.runtime) && UUID.test(binding.backupId ?? ''), 'RECOVERY_AUDIT_TARGET');
  return binding;
}
export function validateSnapshot(snapshot) {
  requireThat(snapshot?.schemaVersion === 'pathfinder.copied-recovery.snapshot.v1' && snapshot.status === 'PASS' && snapshot.projection === 'lossless-postgresql-jsonb-text', 'RECOVERY_AUDIT_SNAPSHOT');
  validateCaptureBinding(snapshot.capture);
  requireThat(snapshot.identity?.database === 'wfc_pathfinder_local' && snapshot.identity.address === snapshot.capture.pgAddress && snapshot.identity.port === 5432 && snapshot.identity.readOnly === true, 'RECOVERY_AUDIT_DATABASE');
  const p = snapshot.precisionControl;
  requireThat(p?.numericDecodedEqual === true && p.bigintDecodedEqual === true && p.numericTextA === '1.00000000000000001' && p.numericTextB === '1.00000000000000002' && p.bigintTextA === '9007199254740992' && p.bigintTextB === '9007199254740993', 'RECOVERY_AUDIT_PRECISION');
  requireThat(exact(snapshot.groups, TABLES) && exact(snapshot.auth, AUTH) && exact(snapshot.storage, BUCKETS), 'RECOVERY_AUDIT_GROUPS');
  let totalRows = 0;
  for (const table of [...TABLES, ...AUTH]) {
    const rows = (AUTH.includes(table) ? snapshot.auth : snapshot.groups)[table];
    requireThat(Array.isArray(rows) && rows.length <= LIMITS.rowsPerTable && (totalRows += rows.length) <= LIMITS.totalRows, 'RECOVERY_AUDIT_ROW_BUDGET');
    for (const row of rows) {
      requireThat(row && typeof row.key === 'string' && row.key.length > 0 && row.key.length <= 4096 && typeof row.row_text === 'string' && Buffer.byteLength(row.row_text) <= LIMITS.rowBytes, 'RECOVERY_AUDIT_ROW_SCHEMA');
      // Parsing checks syntax only. Business comparisons always use the original string.
      parseRow(row.row_text);
      if (AUTH.includes(table)) validateAuthRow(table, row);
      else requireThat(exact(row, ['key', 'row_text']), 'RECOVERY_AUDIT_ROW_SCHEMA');
    }
    requireThat(sortedUnique(rows, 'key'), 'RECOVERY_AUDIT_ROW_ORDER');
  }
  let objectCount = 0;
  for (const bucket of BUCKETS) {
    const rows = snapshot.storage[bucket];
    requireThat(Array.isArray(rows) && rows.length <= LIMITS.objectsPerBucket && (objectCount += rows.length) <= LIMITS.totalObjects && sortedUnique(rows, 'key'), 'RECOVERY_AUDIT_STORAGE_BUDGET');
    for (const row of rows) requireThat(exact(row, ['key', 'size', 'etag', 'lastModified', 'metadata']) && typeof row.key === 'string' && row.key.length > 0 && row.key.length <= 2048 && decimalInteger(row.size) && typeof row.etag === 'string' && row.etag.length <= 256 && (row.lastModified === null || timestamp(row.lastModified)) && row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) && Buffer.byteLength(JSON.stringify(row.metadata)) <= 16384 && Object.entries(row.metadata).every(([key, value]) => key.length <= 512 && typeof value === 'string' && value.length <= 4096), 'RECOVERY_AUDIT_STORAGE_SCHEMA');
  }
  for (const phase of ['before', 'after']) requireThat(snapshot.quiescence?.[phase]?.activePathfinderJobs === '0' && snapshot.quiescence[phase].activeModelImports === '0', 'RECOVERY_AUDIT_BUSY');
  requireThat(snapshot.copiedProject?.projectId === SOURCE.projectId && snapshot.copiedProject.modelVersionId === SOURCE.modelVersionId && snapshot.copiedProject.fingerprint === SOURCE.fingerprint && snapshot.copiedProject.cables === '2140' && snapshot.copiedProject.types === '50' && snapshot.copiedProject.selectionRevision === '1' && snapshot.copiedProject.syntheticMarkers === '0', 'RECOVERY_AUDIT_COPIED_PROJECT');
  requireThat(Buffer.byteLength(JSON.stringify(snapshot)) <= LIMITS.rawBytes, 'RECOVERY_AUDIT_RAW_BUDGET');
  return snapshot;
}

const AUTH_FIELDS = Object.freeze({ viewer_login_bindings: ['login_id', 'user_id', 'expires_at', 'revoked_at', 'created_at'], viewer_resource_sessions: ['id', 'user_id', 'login_id', 'project_id', 'model_version_id', 'load_id', 'selection_revision', 'secret_hash', 'created_at', 'expires_at', 'absolute_expires_at', 'revoked_at', 'revoke_reason'] });
export function validateAuthRow(table, captured) {
  requireThat(AUTH.includes(table) && exact(captured, ['key', 'row_text', 'immutable_text', 'revoked_at', 'revoke_reason']), 'RECOVERY_AUTH_SCHEMA');
  const row = parseRow(captured.row_text), resource = table === 'viewer_resource_sessions';
  requireThat(exact(row, AUTH_FIELDS[table]) && captured.key === row[resource ? 'id' : 'login_id'] && UUID.test(captured.key), 'RECOVERY_AUTH_SCHEMA');
  for (const key of resource ? ['id', 'user_id', 'login_id', 'project_id', 'model_version_id', 'load_id'] : ['login_id', 'user_id']) requireThat(UUID.test(row[key] ?? ''), 'RECOVERY_AUTH_SCHEMA');
  for (const key of resource ? ['created_at', 'expires_at', 'absolute_expires_at'] : ['created_at', 'expires_at']) requireThat(timestamp(row[key]), 'RECOVERY_AUTH_SCHEMA');
  requireThat(row.revoked_at === captured.revoked_at && (row.revoked_at === null || timestamp(row.revoked_at)), 'RECOVERY_AUTH_SCHEMA');
  if (resource) requireThat(integer(row.selection_revision, 2147483647) && SHA.test(row.secret_hash ?? '') && row.revoke_reason === captured.revoke_reason && (row.revoked_at === null ? row.revoke_reason === null : ['logout', 'closed', 'selection', 'access', 'unavailable'].includes(row.revoke_reason)), 'RECOVERY_AUTH_SCHEMA');
  else requireThat(captured.revoke_reason === null, 'RECOVERY_AUTH_SCHEMA');
  const immutable = { ...row }; delete immutable.revoked_at; if (resource) delete immutable.revoke_reason;
  requireThat(typeof captured.immutable_text === 'string' && Buffer.byteLength(captured.immutable_text) <= LIMITS.rowBytes && canonical(parseRow(captured.immutable_text)) === canonical(immutable), 'RECOVERY_AUTH_PROJECTION');
  return captured;
}
export function validateAllowedAuth(value, target) {
  const fields = ['schemaVersion', 'target', 'actorId', 'loginId', 'sessionId', 'loadId', 'projectId', 'modelVersionId', 'loginExpiresAt', 'sessionExpiresAt', 'sessionAbsoluteExpiresAt', 'secretSha256'];
  requireThat(exact(value, fields) && value.schemaVersion === 'pathfinder.copied-recovery.allowed-auth.v1' && target.kind === 'target' && exact(value.target, ['owner', 'runtime', 'project', 'port', 'backupId']) && ['owner', 'runtime', 'project', 'port', 'backupId'].every(key => value.target[key] === target[key]), 'RECOVERY_AUTH_METADATA_BINDING');
  requireThat(['actorId', 'loginId', 'sessionId', 'loadId'].every(key => UUID.test(value[key] ?? '')) && value.projectId === SOURCE.projectId && value.modelVersionId === SOURCE.modelVersionId && SHA.test(value.secretSha256 ?? '') && ['loginExpiresAt', 'sessionExpiresAt', 'sessionAbsoluteExpiresAt'].every(key => timestamp(value[key])) && Date.parse(value.sessionExpiresAt) <= Date.parse(value.sessionAbsoluteExpiresAt), 'RECOVERY_AUTH_METADATA_SCHEMA');
  return value;
}

export function compareBindings(before, after, comparison) {
  validateCaptureBinding(before); validateCaptureBinding(after);
  requireThat(['exact', 'restore-fence', 'owned-auth', 'business-only'].includes(comparison), 'RECOVERY_AUDIT_COMPARISON');
  if (comparison === 'restore-fence') {
    requireThat(before.kind === 'source' && after.kind === 'target' && before.owner !== after.owner && before.project !== after.project && before.runtime !== after.runtime && before.port === 5191 && after.port === 5192 && ['apiId', 'webId', 'pgId', 'minioId'].every(key => before[key] !== after[key]), 'RECOVERY_AUDIT_RESTORE_BINDING');
  } else {
    const same = ['kind', 'owner', 'project', 'runtime', 'port', 'backupId', 'apiId', 'webId', 'pgId', 'minioId', 'apiImage', 'webImage', 'pgImage', 'minioImage'];
    const sameRuntime = same.every(key => before[key] === after[key]);
    const crossRestore = comparison === 'business-only' && before.kind === 'source' && after.kind === 'target' && before.owner !== after.owner && before.project !== after.project && before.runtime !== after.runtime && ['apiId', 'webId', 'pgId', 'minioId'].every(key => before[key] !== after[key]);
    requireThat(sameRuntime || crossRestore, 'RECOVERY_AUDIT_EXACT_BINDING');
    if (comparison === 'owned-auth') requireThat(before.kind === 'target' && after.kind === 'target', 'RECOVERY_AUDIT_OWNED_AUTH_BINDING');
  }
  requireThat(['apiImage', 'webImage', 'pgImage', 'minioImage'].every(key => before[key] === after[key]), 'RECOVERY_AUDIT_IMAGE_CHANGED');
}
function diffRows(before, after, equality) {
  const old = new Map(before.map(row => [row.key, row])), current = new Map(after.map(row => [row.key, row]));
  const missing = before.filter(row => !current.has(row.key)), added = after.filter(row => !old.has(row.key)), changed = []; let unchanged = 0;
  for (const row of before) { const next = current.get(row.key); if (!next) continue; if (equality(row, next)) unchanged++; else changed.push({ key: row.key, before: row, after: next }); }
  return { before: before.length, after: after.length, unchanged, missing, added, changed };
}
function authEqual(table, before, after) {
  if (before.row_text === after.row_text) return { allowed: before.revoked_at !== null, changed: false };
  if (before.revoked_at !== null || after.revoked_at === null || !timestamp(after.revoked_at) || before.immutable_text !== after.immutable_text) return { allowed: false, changed: true };
  return { allowed: table === 'viewer_login_bindings' || before.revoke_reason === null && after.revoke_reason === 'logout', changed: true };
}
export function compareSnapshots(before, after, { comparison = 'exact', allowedAuth } = {}) {
  validateSnapshot(before); validateSnapshot(after); compareBindings(before.capture, after.capture, comparison);
  if (comparison === 'owned-auth') validateAllowedAuth(allowedAuth, after.capture);
  const detail = { schemaVersion: 'pathfinder.copied-recovery.difference.v1', comparison, groups: {}, auth: {}, storage: {}, failures: [], authentication: comparison === 'business-only' ? 'NOT_CHECKED' : 'PASS' };
  for (const table of TABLES) { const difference = diffRows(before.groups[table], after.groups[table], (a, b) => a.row_text === b.row_text); detail.groups[table] = difference; if (difference.missing.length || difference.added.length || difference.changed.length) detail.failures.push('ROWS_' + table); }
  for (const table of AUTH) {
    const difference = diffRows(before.auth[table], after.auth[table], (a, b) => a.row_text === b.row_text); detail.auth[table] = difference;
    if (comparison === 'business-only') continue;
    if (comparison === 'exact') { if (difference.missing.length || difference.added.length || difference.changed.length) detail.failures.push('AUTH_' + table); }
    else if (comparison === 'owned-auth') {
      const added = difference.added, expectedId = table === 'viewer_login_bindings' ? allowedAuth.loginId : allowedAuth.sessionId;
      let allowed = difference.missing.length === 0 && difference.changed.length === 0 && added.length === 1 && added[0].key === expectedId;
      if (allowed) {
        const row = parseRow(added[0].row_text);
        allowed = row.user_id === allowedAuth.actorId && row.revoked_at === null && (table === 'viewer_login_bindings' ? equalTimestamp(row.expires_at, allowedAuth.loginExpiresAt) : row.login_id === allowedAuth.loginId && row.project_id === SOURCE.projectId && row.model_version_id === SOURCE.modelVersionId && row.selection_revision === 1 && row.revoke_reason === null && row.load_id === allowedAuth.loadId && row.secret_hash === allowedAuth.secretSha256 && equalTimestamp(row.expires_at, allowedAuth.sessionExpiresAt) && equalTimestamp(row.absolute_expires_at, allowedAuth.sessionAbsoluteExpiresAt));
      }
      if (!allowed) detail.failures.push('AUTH_OWNED_ADDITION_' + table);
    }
    else {
      const current = new Map(after.auth[table].map(row => [row.key, row]));
      const outcomes = before.auth[table].map(row => { const next = current.get(row.key); return next ? { key: row.key, ...authEqual(table, row, next) } : { key: row.key, allowed: false, changed: true }; });
      detail.auth[table].tombstones = { retained: outcomes.length, newlyRevoked: outcomes.filter(value => value.changed && value.allowed).length, alreadyRevoked: outcomes.filter(value => !value.changed && value.allowed).length, rejected: outcomes.filter(value => !value.allowed).map(value => value.key) };
      if (difference.missing.length || difference.added.length || outcomes.some(value => !value.allowed)) detail.failures.push('AUTH_FENCE_' + table);
    }
  }
  for (const bucket of BUCKETS) { const difference = diffRows(before.storage[bucket], after.storage[bucket], (a, b) => canonical(a) === canonical(b)); detail.storage[bucket] = difference; if (difference.missing.length || difference.added.length || difference.changed.length) detail.failures.push('STORAGE_' + bucket); }
  requireThat(Buffer.byteLength(JSON.stringify(detail)) <= LIMITS.diffBytes, 'RECOVERY_AUDIT_DIFF_BUDGET');
  detail.status = detail.failures.length === 0 ? 'PASS' : 'FAIL'; return detail;
}
export function summarize(snapshot, comparison) {
  const groups = value => Object.fromEntries(Object.entries(value).map(([name, rows]) => [name, { count: rows.length, sha256: hash(rows) }]));
  const compact = difference => Object.fromEntries(Object.entries(difference).map(([name, value]) => [name, { before: value.before, after: value.after, unchanged: value.unchanged, missing: value.missing.length, added: value.added.length, changed: value.changed.length, ...(value.tombstones ? { tombstones: { retained: value.tombstones.retained, newlyRevoked: value.tombstones.newlyRevoked, alreadyRevoked: value.tombstones.alreadyRevoked, rejected: value.tombstones.rejected.length } } : {}) }]));
  return { groups: groups(snapshot.groups), auth: groups(snapshot.auth), storage: groups(snapshot.storage), precisionControl: snapshot.precisionControl, quiescence: snapshot.quiescence, ...(comparison ? { comparison: { status: comparison.status, authentication: comparison.authentication, failures: comparison.failures, groups: compact(comparison.groups), auth: compact(comparison.auth), storage: compact(comparison.storage) } } : {}) };
}
