import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateRestoreFencing, validateRestoredInventory } from './restore-fencing.mjs';
import { ROOT, retire, validateRuntimeRestoreFencingRecord } from '../pathfinder-local/runtime-lib.mjs';

const id = n => `da800000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const bytesHash = value => createHash('sha256').update(value).digest('hex');
const columns = { viewer_resource_sessions: ['revoked_at', 'revoke_reason'], viewer_login_bindings: ['revoked_at'], pf_installation_state: ['installation_epoch', 'updated_at'] };
const pin = rows => ({ rows: rows.length, sha256: hash(rows.map(canonical).sort()) });
function inventory(data) {
  const tables = Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).map(([table, rows]) => ({ table, ...pin(rows), transientSessions: ['viewer_resource_sessions', 'viewer_login_bindings'].includes(table) }));
  return { schemaVersion: 1, command: 'inventory', status: 'PASS', tables,
    businessSha256: hash(tables.filter(row => !row.transientSessions)), registrySha256: hash(tables.filter(row => row.table.startsWith('model_') || row.table === 'project_model_selections')) };
}
function fixture({ grants = true } = {}) {
  const before = { cables: [{ id: id(8), routing: '/SYNTHETIC', designLength: '19', installLength: '17' }],
    model_versions: [{ id: id(7), health: 'healthy', content_fingerprint: 'a'.repeat(64) }],
    viewer_resource_sessions: [{ id: id(5), user_id: id(4), revoked_at: null, revoke_reason: null }],
    viewer_login_bindings: [{ login_id: id(6), user_id: id(4), revoked_at: null }] };
  if (grants) {
    before.pf_installation_state = [{ singleton: true, installation_epoch: id(1), updated_at: '2026-10-18T00:00:00.000001+00:00' }];
    before.pf_calculation_grant_leases = [{ id: id(9), installation_epoch: id(1), state: 'quarantined', closed_at: null, owner_sha256: 'b'.repeat(64) }];
  }
  const after = structuredClone(before); after.viewer_resource_sessions[0].revoked_at = '2026-10-19T00:00:00.000001+00:00'; after.viewer_resource_sessions[0].revoke_reason = 'logout'; after.viewer_login_bindings[0].revoked_at = '2026-10-19T00:00:00.000001+00:00';
  if (grants) { after.pf_installation_state[0].installation_epoch = id(2); after.pf_installation_state[0].updated_at = '2026-10-19T00:00:00.000001+00:00'; }
  const proofs = Object.keys(columns).filter(table => before[table]).map(table => ({ table, before: pin(before[table]), after: pin(after[table]), allowedColumns: columns[table], changedRows: 1,
    protectedSha256: hash(before[table].map(row => canonical(Object.fromEntries(Object.entries(row).filter(([field]) => !columns[table].includes(field))))).sort()) }));
  const receipt = { schemaVersion: 1, command: 'fence-restored', status: 'PASS', targetId: id(2), sessionsRevoked: 1, durableLoginTombstones: 1, activeRestoredBindings: 0, loginRowsDeleted: 0, requiresFreshJwtSigningSecret: true,
    fencingDelta: { schemaVersion: 'wfc.restore-fencing-delta.v1', targetId: id(2), tables: proofs,
      installation: { present: grants, rotated: grants, previousEpoch: grants ? id(1) : null, currentEpoch: grants ? id(2) : null, fencedActiveLeases: 0, fencedQuarantinedLeases: grants ? 1 : 0, leaseRowsUnchanged: true } } };
  return { before, after, receipt, beforeInventory: inventory(before), afterInventory: inventory(after) };
}

test('pre-fence restore proves exact full 122-table closure including both authentication groups', () => {
  const f = fixture(), data = structuredClone(f.before);
  for (let n = 0; n < 116; n++) data['r8_table_' + String(n).padStart(3, '0')] = [{ id: id(100 + n), value: 'Synthetic preserved row ' + n }];
  const source = inventory(data), restored = structuredClone(source), result = validateRestoredInventory(source, restored);
  assert.equal(result.schemaVersion, 'wfc.restore-inventory-validation.v1'); assert.equal(result.status, 'PASS');
  assert.equal(result.tablesChecked, 122); assert.equal(result.authenticationTablesChecked, 2); assert.equal(result.fullInventorySha256, hash(source.tables));
  assert.ok(Object.isFrozen(result)); assert.deepEqual(source, restored);
});
for (const table of ['viewer_resource_sessions', 'viewer_login_bindings']) test('pre-fence equality rejects altered ' + table + ' despite unchanged business and registry hashes', () => {
  const f = fixture(), changed = structuredClone(f.before); changed[table][0].user_id = id(99);
  const restored = inventory(changed);
  assert.equal(restored.businessSha256, f.beforeInventory.businessSha256); assert.equal(restored.registrySha256, f.beforeInventory.registrySha256);
  assert.throws(() => validateRestoredInventory(f.beforeInventory, restored), { code: 'RESTORE_INVENTORY_MISMATCH' });
});
for (const change of ['business-row', 'missing-table', 'extra-table', 'missing-auth-group', 'row-count', 'hash-consistency', 'classification', 'order', 'duplicate', 'over-limit', 'malformed-row', 'nonstring-table'])
  test('pre-fence full inventory refuses ' + change, () => {
    const f = fixture(), changed = structuredClone(f.before); let restored;
    if (change === 'business-row') changed.cables[0].installLength = '18';
    if (change === 'missing-table') delete changed.cables;
    if (change === 'extra-table') changed.unknown_table = [];
    if (change === 'missing-auth-group') delete changed.viewer_login_bindings;
    restored = inventory(changed);
    if (change === 'row-count') restored.tables[0].rows++;
    if (change === 'hash-consistency') restored.businessSha256 = 'c'.repeat(64);
    if (change === 'classification') restored.tables.find(row => row.table === 'pf_installation_state').transientSessions = true;
    if (change === 'order') restored.tables.reverse();
    if (change === 'duplicate') restored.tables.splice(1, 0, structuredClone(restored.tables[0]));
    if (change === 'over-limit') restored.tables = Array.from({ length: 501 }, () => restored.tables[0]);
    if (change === 'malformed-row') restored.tables[0].extra = 'unrecognized';
    if (change === 'nonstring-table') restored.tables[0].table = 123;
    assert.throws(() => validateRestoredInventory(f.beforeInventory, restored), { code: 'RESTORE_INVENTORY_MISMATCH' });
  });
test('pre-fence proof cannot substitute the qualified post-fencing inventory or omit auth groups from both sides', () => {
  const f = fixture(); assert.throws(() => validateRestoredInventory(f.beforeInventory, f.afterInventory), { code: 'RESTORE_INVENTORY_MISMATCH' });
  delete f.before.viewer_login_bindings; delete f.before.viewer_resource_sessions;
  const incomplete = inventory(f.before);
  assert.throws(() => validateRestoredInventory(incomplete, incomplete), { code: 'RESTORE_INVENTORY_MISMATCH' });
});

test('exact restore fencing qualifies only its pinned delta and retains the unjoined lease audit', () => {
  const f = fixture(), receipt = validateRestoreFencing(f.beforeInventory, f.afterInventory, f.receipt, id(2));
  assert.equal(receipt.status, 'PASS'); assert.equal(receipt.tablesChecked, 6); assert.equal(receipt.qualifiedTables, 3); assert.equal(receipt.installationEpochRotated, true);
  assert.notEqual(f.beforeInventory.businessSha256, f.afterInventory.businessSha256); assert.deepEqual(f.before.pf_calculation_grant_leases, f.after.pf_calculation_grant_leases);
});

test('a pre-grant backup uses exact login fencing without inventing an installation or enabling a grant', () => {
  const f = fixture({ grants: false }), receipt = validateRestoreFencing(f.beforeInventory, f.afterInventory, f.receipt, id(2));
  assert.equal(receipt.installationEpochRotated, false); assert.equal(receipt.qualifiedTables, 2); assert.equal(f.beforeInventory.businessSha256, f.afterInventory.businessSha256);
});

for (const change of ['cable', 'model', 'lease', 'extra-table', 'missing-table', 'unreceipted-login-field']) test('full inventory closure rejects ' + change, () => {
  const f = fixture();
  if (change === 'cable') f.after.cables[0].designLength = '20';
  if (change === 'model') f.after.model_versions[0].health = 'unavailable';
  if (change === 'lease') { f.after.pf_calculation_grant_leases[0].state = 'released'; f.after.pf_calculation_grant_leases[0].closed_at = 'false-join'; }
  if (change === 'extra-table') f.after.unknown_table = [];
  if (change === 'missing-table') delete f.after.cables;
  if (change === 'unreceipted-login-field') f.after.viewer_login_bindings[0].user_id = id(10);
  assert.throws(() => validateRestoreFencing(f.beforeInventory, inventory(f.after), f.receipt, id(2)), { code: 'RESTORE_FENCING_DELTA_INVALID' });
});

for (const change of ['target', 'epoch', 'epoch-reused', 'not-rotated', 'unknown-columns', 'before-pin', 'after-pin', 'changed-count', 'missing-proof', 'duplicate-proof', 'unknown-proof-field', 'lease-proof', 'false-status', 'empty-proof']) test('refuses a mismatched fencing receipt: ' + change, () => {
  const f = fixture(), proof = f.receipt.fencingDelta.tables[0];
  if (change === 'target') f.receipt.targetId = id(10);
  if (change === 'epoch') f.receipt.fencingDelta.installation.currentEpoch = id(10);
  if (change === 'epoch-reused') f.receipt.fencingDelta.installation.previousEpoch = id(2);
  if (change === 'not-rotated') f.receipt.fencingDelta.installation.rotated = false;
  if (change === 'unknown-columns') proof.allowedColumns = [...proof.allowedColumns, 'user_id'];
  if (change === 'before-pin') proof.before.sha256 = 'c'.repeat(64);
  if (change === 'after-pin') proof.after.sha256 = 'c'.repeat(64);
  if (change === 'changed-count') proof.changedRows = 0;
  if (change === 'missing-proof') f.receipt.fencingDelta.tables.pop();
  if (change === 'duplicate-proof') f.receipt.fencingDelta.tables[1] = structuredClone(proof);
  if (change === 'unknown-proof-field') proof.ignoreOtherData = true;
  if (change === 'lease-proof') f.receipt.fencingDelta.installation.leaseRowsUnchanged = false;
  if (change === 'false-status') f.receipt.status = 'FAIL';
  if (change === 'empty-proof') delete f.receipt.fencingDelta;
  assert.throws(() => validateRestoreFencing(f.beforeInventory, f.afterInventory, f.receipt, id(2)), { code: 'RESTORE_FENCING_DELTA_INVALID' });
});

test('inventory hash consistency and transient classification cannot hide a control-table change', () => {
  const f = fixture(); f.afterInventory.businessSha256 = f.beforeInventory.businessSha256;
  assert.throws(() => validateRestoreFencing(f.beforeInventory, f.afterInventory, f.receipt, id(2)), { code: 'RESTORE_FENCING_DELTA_INVALID' });
  const g = fixture(); g.afterInventory.tables.find(row => row.table === 'pf_installation_state').transientSessions = true;
  assert.throws(() => validateRestoreFencing(g.beforeInventory, g.afterInventory, g.receipt, id(2)), { code: 'RESTORE_FENCING_DELTA_INVALID' });
});

function runtimeFixture() {
  const f = fixture(), owner = id(2), project = 'wfc-pathfinder-local-abcdef123456', runtime = path.join(ROOT, 'pathfinder-engine/.scratch/restore-fencing-unit');
  const validation = validateRestoreFencing(f.beforeInventory, f.afterInventory, f.receipt, owner);
  const record = { format: 'WFC-PF-RESTORE-FENCING', schemaVersion: 1, owner, project, runtime, port: 5192, backupId: id(11), beforeInventory: f.beforeInventory, afterInventory: f.afterInventory, receipt: f.receipt, validation };
  const raw = Buffer.from(JSON.stringify(record) + '\n'), token = owner.replaceAll('-', '').slice(0, 12);
  const state = { format: 'WFC-PF-LOCAL', schemaVersion: 1, owner, project, runtime, root: ROOT, port: 5192, envSha256: 'f'.repeat(64), tags: { api: `wfc-pathfinder-api:${token}-fixture`, web: `wfc-pathfinder-web:${token}-fixture` },
    status: 'verified-quarantine', restore: { backupId: id(11), inventoriesEqual: false, fencingValidated: true, fencingValidation: validation, fencingRecordSha256: bytesHash(raw) } };
  return { state, raw, record };
}

test('a restore retirement proof is revalidated against exact owner, path, project, port, backup and epoch', () => {
  const f = runtimeFixture(); assert.equal(validateRuntimeRestoreFencingRecord(f.state, f.raw).status, 'PASS');
});
for (const field of ['owner', 'project', 'runtime', 'port', 'backupId']) test('a copied retirement receipt cannot authorize another ' + field, () => {
  const f = runtimeFixture(); f.record[field] = field === 'port' ? 5193 : 'another';
  const raw = Buffer.from(JSON.stringify(f.record)); f.state.restore.fencingRecordSha256 = bytesHash(raw);
  assert.throws(() => validateRuntimeRestoreFencingRecord(f.state, raw), /PF_VERIFIED_RESTORE_FIXTURE_REQUIRED/);
});
test('a loose fencing flag or altered raw receipt is insufficient for retirement', async () => {
  const f = runtimeFixture(); assert.throws(() => validateRuntimeRestoreFencingRecord(f.state, Buffer.from('changed')), /PF_VERIFIED_RESTORE_FIXTURE_REQUIRED/);
  await assert.rejects(retire({ project: f.state.project, port: 5192, status: 'verified-quarantine', restore: { inventoriesEqual: false, fencingValidated: true } }), /PF_VERIFIED_RESTORE_FIXTURE_REQUIRED/);
});
test('the 5191 demonstration remains protected even if it has a historical restore marker', async () => {
  await assert.rejects(retire({ project: 'wfc-pathfinder-local-abcdef123456', port: 5191, status: 'running', restore: { inventoriesEqual: true, fencingValidated: true } }), /PF_VERIFIED_RESTORE_FIXTURE_REQUIRED/);
});
