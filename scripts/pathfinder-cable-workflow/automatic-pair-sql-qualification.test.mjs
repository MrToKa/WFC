import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAutomaticPairSqlFixture, extractAutomaticPairRevisionSql, syntheticCapacityNoPathObservation } from './automatic-pair-sql-qualification.mjs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const owner = 'ce473847-dd7c-4f58-b70e-ed5e7c3c3d81', suffix = owner.replaceAll('-', '');
const directory = path.join(root, 'pathfinder-engine/.scratch/cable-workflow-u7-' + owner), filename = path.join(directory, 'fixture.private.json');
const fixture = () => ({ schemaVersion: 'wfc.pf.u7-chain-fixture.v1', owner, database: 'wfc_pfu7_' + suffix,
  databaseUrl: 'postgresql://pfu7:synthetic-unused-password@127.0.0.1:65432/wfc_pfu7_' + suffix,
  containerName: 'pfu7-pg-' + suffix.slice(0, 12), compiledRoot: path.join(root, 'server/dist'), storageRoot: path.join(directory, 'storage') });

test('automatic-pair qualification accepts only the maintained synthetic U7 identity before any IO', () => {
  assert.equal(validateAutomaticPairSqlFixture(fixture(), filename).directory, directory);
});
for (const kind of ['database', 'host', 'owner', 'container', 'compiled', 'storage', 'options', 'filename', 'port', 'credentials', 'fragment', 'alternate-loopback', 'url-path'])
  test('automatic-pair qualification refuses mismatched ' + kind + ' without any Docker or database operation', () => {
    const value = fixture(); let target = filename;
    if (kind === 'database') value.database = 'wfc_pathfinder_local';
    if (kind === 'host') value.databaseUrl = value.databaseUrl.replace('127.0.0.1', '192.168.0.2');
    if (kind === 'owner') value.owner = '00000000-0000-4000-8000-000000000001';
    if (kind === 'container') value.containerName = 'wfc-app-backend-1';
    if (kind === 'compiled') value.compiledRoot = path.join(root, '../WFC/server/dist');
    if (kind === 'storage') value.storageRoot = path.join(root, 'pathfinder-engine/.scratch/unrelated');
    if (kind === 'options') value.databaseUrl += '?options=-csearch_path=public';
    if (kind === 'filename') target = path.join(directory, 'other.private.json');
    if (kind === 'port') value.databaseUrl = value.databaseUrl.replace(':65432/', ':0/');
    if (kind === 'credentials') value.databaseUrl = value.databaseUrl.replace('pfu7:', 'postgres:');
    if (kind === 'fragment') value.databaseUrl += '#other';
    if (kind === 'alternate-loopback') value.databaseUrl = value.databaseUrl.replace('127.0.0.1', '127.0.0.2');
    if (kind === 'url-path') value.databaseUrl += '/another';
    assert.throws(() => validateAutomaticPairSqlFixture(value, target));
  });

test('revision qualification extracts the exact bounded production revision trigger, without other bootstrap SQL', async () => {
  const source = await fs.readFile(path.join(root, 'server/pathfinder/schema.ts'), 'utf8'), sql = extractAutomaticPairRevisionSql(source);
  assert.ok(sql.startsWith('CREATE OR REPLACE FUNCTION own_cable_write_revision()'));
  assert.ok(sql.includes('OLD.cable_write_revision + 1'));
  assert.ok(sql.trimEnd().endsWith('EXECUTE FUNCTION own_cable_write_revision();'));
  assert.equal(sql.includes('CREATE TABLE'), false); assert.equal(sql.includes('CREATE UNIQUE INDEX'), false);
  for (const bad of ['', source + sql, source.replace('CREATE TRIGGER cable_write_revision_owned BEFORE INSERT OR UPDATE ON cables', 'CREATE TRIGGER other'),
    source.replace("current_setting('wfc.pathfinder_apply',true)='1'", 'true'), source.replace('END $$;', 'END $$; ${unsafe}')])
    assert.throws(() => extractAutomaticPairRevisionSql(bad), { code: 'U7_AUTOMATIC_REVISION_SOURCE' });
});

function capacityInputs() {
  return { dependencies: { schemaVersion: 'pathfinder.dependencies.v8', projectId: owner, cableId: owner,
    settings: { revision: '4', connectionGap: '1' } },
  result: { schemaVersion: 'pathfinder.model.response.v3', calculationMode: 'calculate', status: 'calculated',
    route: { success: true, routeText: '/A' }, design: { designLengthMeters: '7' }, lengthLedger: { synthetic: true },
    barriers: { proof: { synthetic: true }, qualification: { synthetic: true }, directSecondary: { synthetic: true },
      connectors: { from: { synthetic: true }, to: { synthetic: true } }, diagnostics: { status: 'clear', synthetic: true } } } };
}

test('capacity qualification constructs an isolated ON-only no-path observation without success geometry or a length ledger', () => {
  const inputs = capacityInputs(), original = structuredClone(inputs), value = syntheticCapacityNoPathObservation(inputs.dependencies, inputs.result);
  assert.deepEqual(inputs, original);
  assert.deepEqual(value.dependencies.settings.trayCapacity, { enabled: true, minimumFreeSpacePercent: 42,
    tolerancePercentagePoints: 3, layoutSha256: value.dependencies.settings.routingBalance.layoutSha256 });
  assert.match(value.dependencies.settings.routingBalance.layoutSha256, /^[a-f0-9]{64}$/);
  assert.equal(value.result.status, 'no_path'); assert.equal(value.result.calculationMode, 'calculate');
  assert.equal(Object.hasOwn(value.result, 'route'), false); assert.equal(Object.hasOwn(value.result, 'design'), false);
  assert.equal(Object.hasOwn(value.result, 'lengthLedger'), false);
  assert.equal(value.result.barriers.proof, null); assert.equal(value.result.barriers.qualification, null);
  assert.equal(value.result.barriers.directSecondary, null); assert.deepEqual(value.result.barriers.connectors, { from: null, to: null });
  assert.equal(value.result.trayCapacity.restrictionEnabled, true); assert.equal(value.result.trayCapacity.outcome, 'no-capacity');
  assert.deepEqual(value.result.trayCapacity.excludedRouteCodes, ['/A']);
  assert.equal(value.verifiedExclusions.effectiveMinimumFreeSpacePercent, 39); assert.equal(value.verifiedExclusions.trays[0].freeSpacePercent, 20);
  assert.equal(Object.hasOwn(value.verifiedExclusions, 'outcome'), false);
});

test('capacity qualification can construct the intentionally invalid OFF observation for production refusal', () => {
  const inputs = capacityInputs(); inputs.dependencies.settings.trayCapacity = { enabled: true };
  const value = syntheticCapacityNoPathObservation(inputs.dependencies, inputs.result, false);
  assert.equal(Object.hasOwn(value.dependencies.settings, 'trayCapacity'), false);
  assert.equal(value.result.trayCapacity.restrictionEnabled, false); assert.equal(value.verifiedExclusions.restrictionEnabled, false);
  assert.equal(value.result.status, 'no_path'); assert.equal(value.dependencies.settings.trayCapacity, undefined);
  assert.deepEqual(inputs.dependencies.settings.trayCapacity, { enabled: true });
});

for (const kind of ['legacy dependencies', 'failed source', 'design-only source', 'no barrier context', 'nonboolean restriction'])
  test('capacity qualification rejects ' + kind + ' before any IO', () => {
    const inputs = capacityInputs(); let enabled = true;
    if (kind === 'legacy dependencies') inputs.dependencies.schemaVersion = 'pathfinder.dependencies.v7';
    if (kind === 'failed source') inputs.result.route.success = false;
    if (kind === 'design-only source') inputs.result.calculationMode = 'design';
    if (kind === 'no barrier context') delete inputs.result.barriers;
    if (kind === 'nonboolean restriction') enabled = 'true';
    assert.throws(() => syntheticCapacityNoPathObservation(inputs.dependencies, inputs.result, enabled), { code: 'U7_AUTOMATIC_CAPACITY_FIXTURE' });
  });
