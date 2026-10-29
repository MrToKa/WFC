import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXPECTED as SOURCE, PROPERTIES } from '../pathfinder-current-inputs/source-lib.mjs';
import { EXPECTED, SEED_ROOT, LIMITS, validateSeedSource, verifySeedInput, createSeedPlan, validateSeedPlan, validateSeedTarget, seedDatabase, buildSeedProgram } from './seed-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const id = n => 'aaaaaaaa-0000-4000-8000-' + String(n).padStart(12, '0');
const clone = x => structuredClone(x);
function fixture() {
  const project = { id: SOURCE.projectId, projectNumber: SOURCE.projectNumber, name: SOURCE.projectName, secondaryTrayLength: '7.00000000000000001', endConnectionLength: '5', additionalBendingPercent: '10' };
  return { schemaVersion: 'pathfinder.current-inputs.snapshot.v1', project, selection: { activeModelVersionId: id(2), selectionRevision: '1' },
    model: { id: id(2), projectId: project.id, contentFingerprint: SOURCE.contentFingerprint, packageId: id(3), supportProfile: 'svf-local-7.130.0-v1', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', state: 'ready', health: 'healthy', propertyResources: clone(PROPERTIES) },
    cables: Array.from({ length: 2140 }, (_, i) => ({ id: id(10000 + i), projectId: project.id, cableId: i + 1, tag: i === 0 ? null : ' =TEST-' + i + ' ', fromLocation: i === 0 ? null : ' =FROM-' + i + ' ', toLocation: i === 1 ? '' : '=TO-' + i, mto: ['MV', 'LV', 'Control', 'Instrumentation'][i % 4], cableTypeId: id(100 + i % 50), revision: i === 0 ? null : 'A ' + i, updatedAt: '2026-10-18T15:00:00.123456Z', typeName: 'TYPE-' + i % 50, typeProjectId: project.id })),
    source: { backendId: SOURCE.backend.id, postgresId: SOURCE.postgres.id, revision: SOURCE.revision, databaseHost: SOURCE.endpoint.host, databasePort: SOURCE.endpoint.port, database: SOURCE.endpoint.database },
    transaction: { phase: 'copy', readOnly: 'on', defaultReadOnly: 'on', isolation: 'repeatable read', database: SOURCE.endpoint.database, serverAddress: SOURCE.endpoint.serverAddress, serverPort: SOURCE.endpoint.serverPort, snapshot: 'fixture-only', capturedAt: '2026-10-18T15:00:00Z' } };
}
const makePlan = source => { let next = 100000; return createSeedPlan(source, { makeUuid: () => id(next++), now: '2026-10-18T17:00:00Z' }); };
function targetFixture() {
  const state = { root: SEED_ROOT, runtime: path.join(SEED_ROOT, EXPECTED.runtime), owner: EXPECTED.owner, project: EXPECTED.project, port: 5191, images: { api: EXPECTED.apiImage, web: EXPECTED.webImage } }, networkId = 'a'.repeat(64), backend = EXPECTED.project + '_backend';
  const containers = ['api', 'postgres', 'web'].map((role, i) => ({ id: String(i + 1).repeat(64), name: '/' + EXPECTED.project + '-' + role + '-1', image: role === 'postgres' ? EXPECTED.pgImage : EXPECTED[role + 'Image'], startedAt: '2026-10-18T16:00:00Z', running: true,
    labels: { 'wfc.pathfinder.owner': EXPECTED.owner, 'wfc.pathfinder.project': EXPECTED.project, 'wfc.pathfinder.isolated': 'true', 'com.docker.compose.project': EXPECTED.project, 'com.docker.compose.service': role },
    networks: { [backend]: { NetworkID: networkId, IPAddress: '172.30.0.' + (i + 2) }, ...(role === 'web' ? { [EXPECTED.project + '_front']: { NetworkID: 'b'.repeat(64), IPAddress: '172.31.0.2' } } : {}) },
    ports: role === 'web' ? { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '5191' }] } : {},
    mounts: (role === 'api' ? [['staging', '/var/lib/wfc/model-imports'], ['pathfinder', '/var/lib/wfc/pathfinder']] : role === 'postgres' ? [['postgres', '/var/lib/postgresql']] : []).map(([name, Destination]) => ({ Type: 'volume', Name: EXPECTED.project + '_' + name, Destination, RW: true })) }));
  const network = { id: networkId, name: backend, labels: { 'wfc.pathfinder.owner': EXPECTED.owner, 'wfc.pathfinder.project': EXPECTED.project, 'wfc.pathfinder.isolated': 'true' }, internal: true, containers: containers.map(c => c.id) };
  return { state, containers, network };
}

test('retained actual input and final receipt pass exact SHA/model/resource/provenance binding without DB access', () => {
  const bytes = fs.readFileSync(path.join(root, EXPECTED.snapshot.path)), receipt = fs.readFileSync(path.join(root, EXPECTED.receipt.path));
  const value = verifySeedInput(bytes, receipt); assert.equal(value.cables.length, 2140); assert.equal(new Set(value.cables.map(c => c.cableTypeId)).size, 50);
  assert.throws(() => verifySeedInput(Buffer.concat([bytes, Buffer.from(' ')]), receipt), { code: 'SEED_SOURCE_HASH' });
  assert.throws(() => verifySeedInput(bytes, Buffer.concat([receipt, Buffer.from(' ')])), { code: 'SEED_RECEIPT_HASH' });
});
test('fresh plan preserves raw values, decimal bytes and all category values while replacing every UUID', () => {
  const source = fixture(), plan = makePlan(source); assert.equal(plan.types.length, 50); assert.equal(plan.cables.length, 2140);
  assert.equal(plan.newProject.secondaryTrayLength, '7.00000000000000001'); assert.equal(plan.newProject.connectionGap, '1');
  for (let i = 0; i < source.cables.length; i++) { const c = source.cables[i], copied = plan.cables[i]; for (const key of ['tag', 'revision', 'mto', 'fromLocation', 'toLocation', 'cableId']) assert.equal(copied[key], c[key]); assert.notEqual(copied.id, c.id); }
  assert.deepEqual(new Set(plan.cables.map(c => c.mto)), new Set(['MV', 'LV', 'Control', 'Instrumentation']));
  assert.equal(plan.cables[0].tag, null); assert.equal(plan.cables[1].toLocation, ''); assert.equal(Object.hasOwn(plan.cables[0], 'routing'), false);
});
for (const [name, change, code] of [
  ['missing end allowance', s => { s.project.endConnectionLength = null; }, 'SEED_REQUIRED_ALLOWANCE'],
  ['missing percent', s => { s.project.additionalBendingPercent = null; }, 'SEED_REQUIRED_ALLOWANCE'],
  ['locale decimal', s => { s.project.secondaryTrayLength = '7,5'; }, 'SOURCE_DECIMAL_TRANSPORT'],
  ['wrong source project', s => { s.project.id = id(99); }, 'SOURCE_PROJECT_IDENTITY'],
  ['wrong converted fingerprint', s => { s.model.contentFingerprint = 'f'.repeat(64); }, 'SOURCE_MODEL_IDENTITY'],
  ['changed property pin', s => { s.model.propertyResources[0].sha256 = 'f'.repeat(64); }, 'SOURCE_PROPERTY_RESOURCE_BINDING'],
  ['unknown category', s => { s.cables[0].mto = 'Other'; }, 'SEED_CATEGORY_REQUIRED'],
  ['all-null type facts', s => { Object.assign(s.cables[0], { cableTypeId: null, typeName: null, typeProjectId: null }); }, 'SEED_TYPE_REQUIRED'],
  ['foreign joined type', s => { s.cables[0].typeProjectId = id(99); }, 'SOURCE_CABLE_TYPE_OWNER'],
  ['same source type conflicting name', s => { s.cables[50].typeName = 'DIFFERENT'; }, 'SEED_TYPE_CONFLICT'],
  ['duplicate cable id', s => { s.cables[1].id = s.cables[0].id; }, 'SOURCE_CABLE_IDENTITY'],
  ['duplicate cable number', s => { s.cables[1].cableId = s.cables[0].cableId; }, 'SOURCE_CABLE_IDENTITY'],
  ['wrong denominator', s => { s.cables.pop(); }, 'SEED_SOURCE_COUNTS'],
]) test('source refuses ' + name, () => { const source = fixture(); change(source); assert.throws(() => validateSeedSource(source), { code }); });
test('secondary NULL remains NULL without substituting a length', () => { const s = fixture(); s.project.secondaryTrayLength = null; assert.equal(makePlan(s).newProject.secondaryTrayLength, null); });
for (const [name, change, code] of [
  ['source ID reuse', (p, s) => { p.cables[0].id = s.cables[0].id; }, 'SEED_UUID_COLLISION'],
  ['duplicate new IDs', p => { p.cables[1].id = p.cables[0].id; }, 'SEED_UUID_COLLISION'],
  ['foreign target', p => { p.target.port = 5190; }, 'SEED_PLAN_TARGET'],
  ['changed source hash', p => { p.source.snapshot.sha256 = 'f'.repeat(64); }, 'SEED_PLAN_SOURCE'],
  ['invented allowance', p => { p.newProject.endConnectionLength = '999'; }, 'SEED_PLAN_PROJECT'],
  ['changed raw endpoint', p => { p.cables[0].fromLocation = '=INVENTED'; }, 'SEED_PLAN_CABLE'],
  ['new type label', p => { p.types[0].name = 'INVENTED'; }, 'SEED_PLAN_TYPE'],
  ['unexpected plan member', p => { p.synthetic = true; }, 'SEED_PLAN_SCHEMA'],
]) test('private plan refuses ' + name, () => { const s = fixture(), p = makePlan(s); change(p, s); assert.throws(() => validateSeedPlan(p, s), { code }); });
test('UUID generator cannot reuse an existing source ID', () => assert.throws(() => createSeedPlan(fixture(), { makeUuid: () => SOURCE.projectId }), { code: 'SEED_UUID_COLLISION' }));
test('exact target DTO validates a private isolated endpoint', () => { const f = targetFixture(); const actual = validateSeedTarget(f.state, f.containers, f.network); assert.equal(actual.serverAddress, '172.30.0.3'); assert.equal(actual.port, 5191); assert.equal(Object.hasOwn(actual, 'password'), false); });
for (const [name, change] of [
  ['foreign checkout', f => { f.state.root = 'C:/original'; }], ['primary port', f => { f.state.port = 5190; }], ['wrong owner', f => { f.containers[0].labels['wfc.pathfinder.owner'] = id(1); }],
  ['wrong API image', f => { f.containers[0].image = 'sha256:' + 'f'.repeat(64); }], ['foreign volume', f => { f.containers[1].mounts[0].Name = 'original'; }],
  ['public web bind', f => { f.containers[2].ports['80/tcp'][0].HostIp = '0.0.0.0'; }], ['extra API network', f => { f.containers[0].networks.original = {}; }],
  ['unowned backend', f => { f.network.labels['wfc.pathfinder.owner'] = id(1); }], ['external backend', f => { f.network.internal = false; }],
]) test('target refuses ' + name, () => { const f = targetFixture(); change(f); assert.throws(() => validateSeedTarget(f.state, f.containers, f.network)); });

function database(plan, mode, options = {}) {
  const client = new EventEmitter(); client.calls = []; let inserts = 0;
  client.connect = async () => { if (options.connectFail) throw Error('private'); };
  client.end = async () => { if (options.lateError) client.emit('error', Error('late')); if (options.endFail) throw Error('private'); };
  client.query = async (sql, args) => {
    client.calls.push({ sql, args });
    if (sql === 'COMMIT' && options.commitFail) throw Error('private');
    if (sql.startsWith('INSERT INTO')) { inserts++; if (inserts === options.failInsert) throw Error('private'); return { rows: [] }; }
    if (sql.includes('current_database()')) return { rows: [{ database: 'wfc_pathfinder_local', address: options.wrongAddress ? '172.17.0.2' : '172.30.0.3', port: 5432, ro: mode === 'verify' ? 'on' : 'off' }] };
    if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: !options.busy }] };
    if (sql.startsWith('SELECT id,project_number FROM')) return { rows: options.exists ? [{ id: plan.id, project_number: plan.newProject.projectNumber }] : [] };
    if (sql.startsWith('SELECT project_id FROM pf_synthetic_projects')) return { rows: options.synthetic ? [{}] : [] };
    if (sql.startsWith('SELECT lower(name)')) return { rows: options.typeCollision ? [{ name: 'duplicate' }] : [] };
    if (sql.startsWith('SELECT id FROM cable_types')) return { rows: options.rowCollision ? [{}] : [] };
    if (sql.startsWith('SELECT id,project_number AS')) return { rows: [{ ...plan.newProject, ...(options.projectMismatch ? { endConnectionLength: '900' } : {}) }] };
    if (sql.startsWith('SELECT id,name,tag')) return { rows: plan.types.map(t => ({ id: t.id, name: t.name, tag: null, purpose: null, diameter_mm: null, weight_kg_per_m: null, from_location: null, to_location: null, routing: null, material: null, description: null, manufacturer: null, part_no: null, remarks: null, source_material_cable_type_id: null, change_log: [] })) };
    if (sql.startsWith('SELECT id,cable_id AS')) return { rows: plan.cables.map(({ sourceId: _sourceId, ...c }, i) => ({ ...c, routing: options.routingMismatch && i === 0 ? '/WRONG' : null, design_length: null, install_length: null, delivery: null, pull_date: null, connected_from: null, connected_to: null, tested: null, materials_initialized: false, materials_customized: false, change_log: [], cableWriteRevision: '0' })) };
    if (sql.startsWith('SELECT active_model_version_id')) return { rows: [{ active_model_version_id: options.selected ? id(8) : null, revision: '0' }] };
    if (sql.startsWith('SELECT registry_revision')) return { rows: [{ revision: '0' }] };
    if (sql.startsWith('SELECT (SELECT count(*)::text')) return { rows: [{ locations: options.locations ? '1' : '0', versions: '0', jobs: '0', synthetic: '0' }] };
    return { rows: [] };
  };
  return client;
}
test('fresh transactional seed uses bounded parameterized batches and preserves numeric strings/NULL lengths', async () => {
  const p = makePlan(fixture()), c = database(p, 'apply'); const result = await seedDatabase({ plan: p, mode: 'apply', target: { ...p.target, serverAddress: '172.30.0.3' } }, { client: c });
  assert.equal(result.status, 'PASS'); assert.equal(result.operation, 'created'); assert.equal(result.syntheticMarker, false);
  const project = c.calls.find(x => x.sql.startsWith('INSERT INTO projects')); assert.equal(project.args[5], '7.00000000000000001'); assert.equal(project.args[8], '1');
  const cableBatches = c.calls.filter(x => x.sql.startsWith('INSERT INTO cables')); assert.deepEqual(cableBatches.map(x => JSON.parse(x.args[1]).length), [500, 500, 500, 500, 140]);
  assert.ok(cableBatches.every(x => x.sql.includes('NULL,NULL,NULL'))); assert.equal(c.calls.filter(x => /^UPDATE|^DELETE|INSERT INTO pf_synthetic/.test(x.sql)).length, 0);
  assert.equal(c.calls.at(-1).sql, 'COMMIT');
});
test('verify of an exact existing seed is read-only, idempotent and uses no row locks or writes', async () => {
  const p = makePlan(fixture()), c = database(p, 'verify', { exists: true }), r = await seedDatabase({ plan: p, mode: 'verify', target: { ...p.target, serverAddress: '172.30.0.3' } }, { client: c });
  assert.equal(r.status, 'PASS'); assert.equal(r.operation, 'already_seeded'); assert.equal(c.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); assert.ok(c.calls.every(x => !/^INSERT|^UPDATE|^DELETE/.test(x.sql) && !x.sql.includes('FOR SHARE')));
});
for (const [name, options, code] of [
  ['wrong SQL endpoint', { wrongAddress: true }, 'SEED_SQL_IDENTITY'], ['busy project owner', { busy: true }, 'SEED_BUSY'],
  ['synthetic acceptance marker', { synthetic: true }, 'SEED_SYNTHETIC_REFUSED'], ['PostgreSQL folded type collision', { typeCollision: true }, 'SEED_TYPE_NAME_COLLISION'],
  ['existing record UUID collision', { rowCollision: true }, 'SEED_ROW_ID_COLLISION'], ['changed project allowance', { exists: true, projectMismatch: true }, 'SEED_PROJECT_MISMATCH'],
  ['changed cable route', { exists: true, routingMismatch: true }, 'SEED_CABLES_MISMATCH'], ['post-import selection', { exists: true, selected: true }, 'SEED_INITIAL_STATE_MISMATCH'],
  ['unexpected locations', { exists: true, locations: true }, 'SEED_UNEXPECTED_WORKFLOW'],
]) test('database refuses ' + name + ' and rolls back', async () => {
  const p = makePlan(fixture()), c = database(p, 'apply', options), r = await seedDatabase({ plan: p, mode: 'apply', target: { ...p.target, serverAddress: '172.30.0.3' } }, { client: c });
  assert.equal(r.status, 'FAIL'); assert.equal(r.error, code); assert.equal(r.rollbackConfirmed, true); assert.equal(c.calls.some(x => x.sql === 'COMMIT'), false); assert.equal(c.calls.some(x => x.sql.startsWith('INSERT INTO')), false);
});
test('failed middle insert rolls back and returns durable failure facts without private exception messages', async () => {
  const p = makePlan(fixture()), c = database(p, 'apply', { failInsert: 4 }), r = await seedDatabase({ plan: p, mode: 'apply', target: { ...p.target, serverAddress: '172.30.0.3' } }, { client: c });
  assert.equal(r.status, 'FAIL'); assert.equal(r.writesAttempted, true); assert.equal(r.rollbackConfirmed, true); assert.equal(r.outcome, 'not_committed'); assert.equal(JSON.stringify(r).includes('private'), false);
});
test('lost COMMIT acknowledgement remains unknown and must be reconciled by explicit verify', async () => {
  const p = makePlan(fixture()), c = database(p, 'apply', { commitFail: true }), r = await seedDatabase({ plan: p, mode: 'apply', target: { ...p.target, serverAddress: '172.30.0.3' } }, { client: c }); assert.equal(r.status, 'FAIL'); assert.equal(r.commitAttempted, true); assert.equal(r.outcome, 'unknown');
});
for (const options of [{ endFail: true }, { lateError: true }]) test('terminal connection failure cannot become a successful seed receipt: ' + JSON.stringify(options), async () => {
  const p = makePlan(fixture()), c = database(p, 'apply', options), r = await seedDatabase({ plan: p, mode: 'apply', target: { ...p.target, serverAddress: '172.30.0.3' } }, { client: c }); assert.equal(r.status, 'FAIL'); assert.equal(r.commitConfirmed, true); assert.equal(r.outcome, 'committed');
});
test('fixed helper fails a malformed stdin request without pg imports, credentials or application startup', () => {
  const program = buildSeedProgram(); assert.ok(program.length < 30000); assert.ok(program.includes('55000')); assert.ok(program.includes('String.fromCharCode(10)'));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { input: '{}', timeout: 5000, maxBuffer: LIMITS.outputBytes, windowsHide: true });
  assert.equal(result.status, 2); const out = JSON.parse(result.stdout.toString()); assert.equal(out.status, 'FAIL'); assert.equal(out.error, 'SEED_HELPER_FAILURE'); assert.equal(result.stderr.length, 0);
});
test('referenced inner watchdog terminates blocked stdin with an unknown outcome (test-only shortened interval)', async () => {
  const program = buildSeedProgram().replace('},55000);', '},30);');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; const timer = setTimeout(() => { child.kill(); reject(Error('watchdog test timed out')); }, 5000);
    child.stdin.on('error', () => {}); child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    // Keep stdin open; the helper must end itself before any database import.
  });
  assert.equal(result.code, 2); assert.equal(result.stderr, ''); assert.equal(JSON.parse(result.stdout).error, 'SEED_HARD_DEADLINE'); assert.equal(JSON.parse(result.stdout).outcome, 'unknown');
});
