import { createHash } from 'node:crypto';

const HASH = /^[a-f0-9]{64}$(?![\s\S])/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$(?![\s\S])/;
const COLUMNS = Object.freeze({ viewer_resource_sessions: ['revoked_at', 'revoke_reason'], viewer_login_bindings: ['revoked_at'], pf_installation_state: ['installation_epoch', 'updated_at'] });
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const fail = () => { throw Object.assign(new Error('RESTORE_FENCING_DELTA_INVALID'), { code: 'RESTORE_FENCING_DELTA_INVALID' }); };
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
const same = (a, b) => canonical(a) === canonical(b);
function inventory(value, refuse = fail) {
  const version2 = value?.schemaVersion === 2;
  if (!plain(value) || ![1, 2].includes(value.schemaVersion) || value.command !== 'inventory' || value.status !== 'PASS' || !Array.isArray(value.tables) || value.tables.length > 500) refuse();
  if (version2 && (!exact(value, ['schemaVersion', 'command', 'status', 'algorithm', 'moduleSha256', 'tables', 'businessSha256', 'registrySha256']) ||
    value.algorithm !== 'wfc.pf.raw-table-legacy-fence.v1' || !HASH.test(value.moduleSha256 ?? ''))) refuse();
  const map = new Map(); let previous = '';
  for (const row of value.tables) {
    if (!exact(row, ['table', 'rows', 'sha256', 'transientSessions', ...(version2 ? ['hashBasis'] : [])]) || typeof row.table !== 'string' || !/^[a-z0-9_]+$(?![\s\S])/.test(row.table) || row.table <= previous || !count(row.rows) || typeof row.sha256 !== 'string' || !HASH.test(row.sha256) ||
      row.transientSessions !== ['viewer_resource_sessions', 'viewer_login_bindings'].includes(row.table)) refuse();
    if (version2 && (row.table.length > 63 || row.hashBasis !== (Object.hasOwn(COLUMNS, row.table) ? 'legacy-canonical-json-array.v1' : 'postgresql-jsonb-text-framed.v1'))) refuse();
    previous = row.table; map.set(row.table, row);
  }
  if (value.businessSha256 !== hash(value.tables.filter(row => !row.transientSessions)) || value.registrySha256 !== hash(value.tables.filter(row => row.table.startsWith('model_') || row.table === 'project_model_selections'))) refuse();
  return map;
}
/** Validates only the declared envelope and aggregate pins, never the database.
 * V2 is explicitly mixed-basis: three bounded historical fence projections,
 * raw PostgreSQL text for every other table. It is not a V1 compatibility cast. */
export function validateInventoryEnvelope(value) {
  inventory(value, () => { throw Object.assign(Error('RESTORE_INVENTORY_INVALID'), { code: 'RESTORE_INVENTORY_INVALID' }); });
  return value;
}
function sameInventoryAlgorithm(before, after, refuse = fail) {
  if (before.schemaVersion !== after.schemaVersion || before.schemaVersion === 2 &&
    (before.algorithm !== after.algorithm || before.moduleSha256 !== after.moduleSha256)) refuse();
}
const pin = value => exact(value, ['rows', 'sha256']) && count(value.rows) && HASH.test(value.sha256 ?? '');

/** Source archive to restored database, BEFORE the intentional fencing mutation.
 * Authentication rows are part of this exact closure despite their exclusion
 * from the historical business hash. This cannot qualify a fencing delta. */
export function validateRestoredInventory(sourceInventory, restoredInventory) {
  const refuse = () => { throw Object.assign(new Error('RESTORE_INVENTORY_MISMATCH'), { code: 'RESTORE_INVENTORY_MISMATCH' }); };
  const source = inventory(sourceInventory, refuse), restored = inventory(restoredInventory, refuse);
  sameInventoryAlgorithm(sourceInventory, restoredInventory, refuse);
  if (!source.has('viewer_resource_sessions') || !source.has('viewer_login_bindings') || source.size !== restored.size) refuse();
  for (const [table, original] of source) if (!same(original, restored.get(table))) refuse();
  return Object.freeze({ schemaVersion: sourceInventory.schemaVersion === 2 ? 'wfc.restore-inventory-validation.v2' : 'wfc.restore-inventory-validation.v1', status: 'PASS', tablesChecked: source.size,
    authenticationTablesChecked: 2, fullInventorySha256: hash(sourceInventory.tables),
    ...(sourceInventory.schemaVersion === 2 ? { inventoryAlgorithm: sourceInventory.algorithm, moduleSha256: sourceInventory.moduleSha256 } : {}) });
}

/** Full table closure, with only exact pins from the trusted same-transaction
 * fencing helper qualified. No table, column or business hash is ignored. */
export function validateRestoreFencing(beforeInventory, afterInventory, receipt, targetId) {
  if (!UUID.test(targetId ?? '') || receipt?.schemaVersion !== 1 || receipt.command !== 'fence-restored' || receipt.status !== 'PASS' || receipt.targetId !== targetId ||
    receipt.activeRestoredBindings !== 0 || receipt.loginRowsDeleted !== 0 || receipt.requiresFreshJwtSigningSecret !== true || !count(receipt.sessionsRevoked) || !count(receipt.durableLoginTombstones)) fail();
  const before = inventory(beforeInventory), after = inventory(afterInventory), delta = receipt.fencingDelta;
  sameInventoryAlgorithm(beforeInventory, afterInventory);
  if (before.size !== after.size || !exact(delta, ['schemaVersion', 'targetId', 'tables', 'installation']) || delta.schemaVersion !== 'wfc.restore-fencing-delta.v1' || delta.targetId !== targetId || !Array.isArray(delta.tables)) fail();
  const installation = delta.installation;
  if (!exact(installation, ['present', 'rotated', 'previousEpoch', 'currentEpoch', 'fencedActiveLeases', 'fencedQuarantinedLeases', 'leaseRowsUnchanged']) ||
    installation.leaseRowsUnchanged !== true || !count(installation.fencedActiveLeases) || !count(installation.fencedQuarantinedLeases)) fail();
  const hasInstallation = before.has('pf_installation_state');
  if (hasInstallation !== before.has('pf_calculation_grant_leases') || installation.present !== hasInstallation) fail();
  if (hasInstallation) {
    // Restore readers handle a fresh owned target. An uncertain prior COMMIT is
    // retained for explicit recovery, never silently accepted as a new restore.
    if (installation.rotated !== true || !UUID.test(installation.previousEpoch ?? '') || installation.previousEpoch === targetId || installation.currentEpoch !== targetId ||
      installation.fencedActiveLeases + installation.fencedQuarantinedLeases > before.get('pf_calculation_grant_leases').rows) fail();
  } else if (installation.rotated !== false || installation.previousEpoch !== null || installation.currentEpoch !== null || installation.fencedActiveLeases || installation.fencedQuarantinedLeases) fail();
  const expected = new Set(['viewer_resource_sessions', 'viewer_login_bindings', ...(hasInstallation ? ['pf_installation_state'] : [])]), proofs = new Map();
  if (delta.tables.length !== expected.size) fail();
  for (const proof of delta.tables) {
    if (!exact(proof, ['table', 'before', 'after', 'allowedColumns', 'protectedSha256', 'changedRows']) || !expected.has(proof.table) || proofs.has(proof.table) ||
      !pin(proof.before) || !pin(proof.after) || proof.before.rows !== proof.after.rows || !count(proof.changedRows) || proof.changedRows > proof.before.rows ||
      !HASH.test(proof.protectedSha256 ?? '') || !same(proof.allowedColumns, COLUMNS[proof.table]) || (proof.changedRows === 0) !== (proof.before.sha256 === proof.after.sha256)) fail();
    const old = before.get(proof.table), fresh = after.get(proof.table);
    if (!old || !fresh || !same(proof.before, { rows: old.rows, sha256: old.sha256 }) || !same(proof.after, { rows: fresh.rows, sha256: fresh.sha256 })) fail();
    const changed = proof.table === 'viewer_resource_sessions' ? receipt.sessionsRevoked : proof.table === 'viewer_login_bindings' ? receipt.durableLoginTombstones : 1;
    if (proof.changedRows !== changed || proof.table === 'pf_installation_state' && proof.before.rows !== 1) fail();
    proofs.set(proof.table, proof);
  }
  for (const [table, old] of before) {
    const fresh = after.get(table); if (!fresh || old.transientSessions !== fresh.transientSessions || !proofs.has(table) && !same(old, fresh)) fail();
  }
  if (beforeInventory.registrySha256 !== afterInventory.registrySha256) fail();
  return Object.freeze({ schemaVersion: beforeInventory.schemaVersion === 2 ? 'wfc.restore-fencing-validation.v2' : 'wfc.restore-fencing-validation.v1', status: 'PASS', targetId, tablesChecked: before.size,
    qualifiedTables: proofs.size, installationEpochRotated: hasInstallation, unjoinedLeaseRowsPreserved: true,
    ...(beforeInventory.schemaVersion === 2 ? { inventoryAlgorithm: beforeInventory.algorithm, moduleSha256: beforeInventory.moduleSha256 } : {}) });
}
