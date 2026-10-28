import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { EXPECTED, LIMITS, PROPERTIES, METADATA_FORMAT, PROBE_PROGRAM, validateContainers, validateProbe, validateBinding, validateSnapshot, validateSqlIdentity, validateProjectIdentity, projectionHashes, readSourceDatabase, buildReadProgram, buildIdentityProgram, buildProjectIdentityProgram, guardedProgram, canonical, sha256 } from './source-lib.mjs';
import { safePath, writeExclusive, runCommand, persistCapture, compareProjections } from './source-copy.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const clone = value => structuredClone(value);
const containers = () => [EXPECTED.backend, EXPECTED.postgres].map(e => ({ id: e.id, name: e.name, image: e.image, running: true, startedAt: e.startedAt,
  workingDirectory: '/app', user: 'node', networks: { [e.network]: { NetworkID: e.networkId, IPAddress: e.address } }, ports: e === EXPECTED.postgres ? { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5434' }, { HostIp: '::', HostPort: '5434' }] } : { '4000/tcp': null }, extraHosts: [] }));
const probe = () => ({ schemaVersion: 'pathfinder.current-inputs.endpoint-probe.v1', host: EXPECTED.endpoint.host, port: '5434', database: 'wfc_app', addresses: [{ address: '192.168.65.254', family: 4 }, { address: 'fdc4:f303:9324::254', family: 6 }], pgVersion: '8.16.3', parserVersion: '2.9.1', dbConnected: false });
const binding = () => ({ schemaVersion: 'pathfinder.current-inputs.binding.v1', ownerId: ID, containers: containers(), endpoint: probe(), source: { revision: EXPECTED.revision, branch: 'main', clean: true } });
const snapshot = (phase = 'copy') => ({ schemaVersion: 'pathfinder.current-inputs.snapshot.v1',
  project: { id: EXPECTED.projectId, projectNumber: EXPECTED.projectNumber, name: EXPECTED.projectName, secondaryTrayLength: '0.000', endConnectionLength: null, additionalBendingPercent: '12.50' },
  selection: { activeModelVersionId: ID, selectionRevision: '2147483647' },
  model: { id: ID, projectId: EXPECTED.projectId, contentFingerprint: EXPECTED.contentFingerprint, packageId: OTHER, supportProfile: 'svf-local-7.130.0-v1', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', state: 'ready', health: 'healthy', propertyResources: clone(PROPERTIES) },
  cables: [{ id: OTHER, projectId: EXPECTED.projectId, cableId: 1, tag: null, fromLocation: '  /A.001  ', toLocation: null, mto: 'Unknown/raw MTO', cableTypeId: ID, revision: null, updatedAt: '2026-10-18 14:30:15.123456+00', typeName: 'Cable Type', typeProjectId: EXPECTED.projectId }],
  source: { backendId: EXPECTED.backend.id, postgresId: EXPECTED.postgres.id, revision: EXPECTED.revision, databaseHost: EXPECTED.endpoint.host, databasePort: '5434', database: 'wfc_app' },
  transaction: { phase, database: 'wfc_app', serverAddress: '172.17.0.2', serverPort: 5432, readOnly: 'on', defaultReadOnly: 'on', isolation: 'repeatable read', snapshot: '10:20:', capturedAt: '2026-10-18 14:30:15.123456+00' } });
const config = () => ({ endpoint: EXPECTED.endpoint, projectId: EXPECTED.projectId, projectName: EXPECTED.projectName, projectNumber: EXPECTED.projectNumber, contentFingerprint: EXPECTED.contentFingerprint, backendId: EXPECTED.backend.id, postgresId: EXPECTED.postgres.id, revision: EXPECTED.revision, properties: PROPERTIES, rows: LIMITS.rows, outputBytes: LIMITS.outputBytes, phase: 'copy' });

function fakeDatabase({ change, throwAt, endFails = false, emitAt, identityOnly = false, projectIdentityOnly = false, uri = 'postgres://fixture_user:fixture_secret@host.docker.internal:5434/wfc_app', parsed } = {}) {
  const data = snapshot(), calls = [], state = { calls, constructed: 0, ended: false, connection: null, activeErrorListenerAtEnd: false };
  const pg = { Client: class extends EventEmitter {
    constructor(options) { super(); state.constructed++; state.connection = options; }
    async connect() { calls.push({ sql: 'CONNECT' }); }
    async query(sql, params) {
      calls.push({ sql, params });
      if (emitAt && sql.includes(emitAt)) this.emit('error', new Error('private transport contents'));
      if (throwAt && sql.includes(throwAt)) throw new Error('postgres://fixture_user:fixture_secret@host/private');
      let rows = [];
      if (sql.includes('pg_current_snapshot')) rows = [{ ...data.transaction, rawServerAddress: data.transaction.serverAddress + '/32' }];
      else if (sql.includes('FROM projects ')) rows = sql.includes('secondary_tray_length') ? [data.project] : [{ id: data.project.id, projectNumber: data.project.projectNumber, name: data.project.name }];
      else if (sql.includes('FROM project_model_selections ')) rows = [data.selection];
      else if (sql.includes('FROM model_versions ')) rows = [data.model];
      else if (sql.includes('FROM (SELECT c.tag')) rows = [{ count: 1, bytes: '3000' }];
      else if (sql.includes('FROM cables c')) rows = data.cables;
      if (change) rows = change(sql, rows) ?? rows;
      return { rows };
    }
    async end() { state.activeErrorListenerAtEnd = this.listenerCount('error') > 0; this.emit('error', new Error('private close contents')); state.ended = true; if (endFails) throw new Error('secret close'); }
  } };
  const parse = () => parsed ?? { host: 'host.docker.internal', port: '5434', database: 'wfc_app', user: 'fixture_user', password: 'fixture_secret', options: '-c default_transaction_read_only=off', query_timeout: 0, connectionTimeoutMillis: 0 };
  return { state, run: () => readSourceDatabase(identityOnly ? { endpoint: EXPECTED.endpoint, identityOnly: true } : projectIdentityOnly ? { endpoint: EXPECTED.endpoint, projectIdentityOnly: true, projectId: EXPECTED.projectId } : config(), { pg, parse, uri }) };
}
const rejectsCode = (fn, code) => assert.throws(fn, error => error.code === code);

test('closed container and Desktop endpoint binding accepts only observed identities', () => {
  assert.equal(validateContainers(containers()).length, 2); assert.equal(validateProbe(probe()).dbConnected, false); validateBinding(binding());
  for (const mutate of [x => { x[0].id = 'a'.repeat(64); }, x => { x[1].image = 'sha256:' + 'a'.repeat(64); }, x => { x[0].startedAt = 'changed'; }]) { const x = containers(); mutate(x); rejectsCode(() => validateContainers(x), 'SOURCE_CONTAINER_IDENTITY'); }
  const extraNetwork = containers(); extraNetwork[0].networks.other = {}; rejectsCode(() => validateContainers(extraNetwork), 'SOURCE_CONTAINER_NETWORK');
  const wrongPort = containers(); wrongPort[1].ports['5432/tcp'][0].HostPort = '5432'; rejectsCode(() => validateContainers(wrongPort), 'SOURCE_PUBLISHED_PORT');
  const wrongIp = containers(); wrongIp[1].networks.bridge.IPAddress = '172.17.0.3'; rejectsCode(() => validateContainers(wrongIp), 'SOURCE_CONTAINER_NETWORK');
  for (const key of ['host', 'port', 'database']) { const x = probe(); x[key] = 'different'; rejectsCode(() => validateProbe(x), 'SOURCE_ENDPOINT'); }
  const wrongDns = probe(); wrongDns.addresses[0].address = '127.0.0.1'; rejectsCode(() => validateProbe(wrongDns), 'SOURCE_DESKTOP_DNS');
});

test('snapshot preserves actual nulls, raw MTO, decimal strings and microseconds without category substitution', () => {
  const x = snapshot(); validateSnapshot(x, 'copy'); assert.equal(x.project.secondaryTrayLength, '0.000'); assert.equal(x.project.endConnectionLength, null); assert.equal(x.cables[0].mto, 'Unknown/raw MTO'); assert.equal(x.cables[0].updatedAt, '2026-10-18 14:30:15.123456+00');
  Object.assign(x.cables[0], { cableTypeId: null, typeName: null, typeProjectId: null }); validateSnapshot(x, 'copy');
  x.model.packageId = '33333333-3333-4333-8333-333333333333'; validateSnapshot(x, 'copy');
});
for (const [label, mutate, code] of [
  ['foreign project', x => { x.project.id = ID; }, 'SOURCE_PROJECT_IDENTITY'],
  ['wrong named project', x => { x.project.name = 'Different project'; }, 'SOURCE_PROJECT_IDENTITY'],
  ['omitted project year', x => { x.project.name = 'HPU Aalborg'; }, 'SOURCE_PROJECT_IDENTITY'],
  ['different project number', x => { x.project.projectNumber = 'P230039 / H.7500063'; }, 'SOURCE_PROJECT_IDENTITY'],
  ['numeric allowance transport', x => { x.project.secondaryTrayLength = 0; }, 'SOURCE_DECIMAL_TRANSPORT'],
  ['invalid revision', x => { x.selection.selectionRevision = '2147483648'; }, 'SOURCE_SELECTION'],
  ['wrong converted fingerprint', x => { x.model.contentFingerprint = 'a'.repeat(64); }, 'SOURCE_MODEL_IDENTITY'],
  ['resource bytes changed', x => { x.model.propertyResources[0].bytes++; }, 'SOURCE_PROPERTY_RESOURCE_BINDING'],
  ['extra resource', x => { x.model.propertyResources.push(x.model.propertyResources[0]); }, 'SOURCE_PROPERTY_RESOURCE_BINDING'],
  ['foreign type', x => { x.cables[0].typeProjectId = ID; }, 'SOURCE_CABLE_TYPE_OWNER'],
  ['dangling type', x => { x.cables[0].typeProjectId = null; x.cables[0].typeName = null; }, 'SOURCE_CABLE_TYPE_OWNER'],
  ['duplicate cable', x => { x.cables.push(clone(x.cables[0])); }, 'SOURCE_CABLE_IDENTITY'],
  ['write enabled', x => { x.transaction.readOnly = 'off'; }, 'SOURCE_TRANSACTION_IDENTITY'],
  ['wrong SQL server', x => { x.transaction.serverAddress = '127.0.0.1'; }, 'SOURCE_TRANSACTION_IDENTITY'],
]) test(`snapshot refuses ${label}`, () => { const x = snapshot(); mutate(x); rejectsCode(() => validateSnapshot(x, 'copy'), code); });

test('raw Client has final RO options and validates SQL identity before fixed parameterized project reads', async () => {
  const { state, run } = fakeDatabase(); const result = await run(); validateSnapshot(result, 'copy');
  assert.equal(state.constructed, 1); assert.equal('connectionString' in state.connection, false);
  assert.equal(state.connection.connectionTimeoutMillis, 5000); assert.equal(state.connection.query_timeout, 20000); assert.match(state.connection.options, /default_transaction_read_only=on/); assert.match(state.connection.options, /statement_timeout=15000/);
  assert.equal(state.calls[1].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const identity = state.calls.findIndex(x => x.sql.includes('pg_current_snapshot')), project = state.calls.findIndex(x => x.sql.includes('FROM projects ')); assert.ok(identity < project);
  assert.deepEqual(state.calls[project].params, [EXPECTED.projectId]);
  assert.ok(state.calls.findIndex(x => x.sql.includes('FROM (SELECT c.tag')) < state.calls.findIndex(x => x.sql.includes('c.updated_at::text')));
  assert.ok(state.calls.filter(x => x.sql.includes('LEFT JOIN cable_types')).every(x => x.sql.includes('ct.id=c.cable_type_id AND ct.project_id=c.project_id')));
  assert.equal(state.calls.at(-1).sql, 'COMMIT'); assert.equal(state.ended, true); assert.equal(state.activeErrorListenerAtEnd, true);
});
for (const [name, change, code, forbidden] of [
  ['read-only', (sql, rows) => sql.includes('pg_current_snapshot') ? [{ ...rows[0], readOnly: 'off' }] : rows, 'SOURCE_SQL_SERVER_IDENTITY', 'FROM projects'],
  ['server identity', (sql, rows) => sql.includes('pg_current_snapshot') ? [{ ...rows[0], serverPort: 5434 }] : rows, 'SOURCE_SQL_SERVER_IDENTITY', 'FROM projects'],
  ['project name', (sql, rows) => sql.includes('FROM projects') ? [{ ...rows[0], name: 'Different' }] : rows, 'SOURCE_PROJECT_IDENTITY', 'FROM project_model_selections'],
  ['omitted project year', (sql, rows) => sql.includes('FROM projects') ? [{ ...rows[0], name: 'HPU Aalborg' }] : rows, 'SOURCE_PROJECT_IDENTITY', 'FROM project_model_selections'],
  ['different project number', (sql, rows) => sql.includes('FROM projects') ? [{ ...rows[0], projectNumber: 'P230039 / H.7500063' }] : rows, 'SOURCE_PROJECT_IDENTITY', 'FROM project_model_selections'],
  ['model resources', (sql, rows) => sql.includes('FROM model_versions') ? [{ ...rows[0], propertyResources: [] }] : rows, 'SOURCE_PROPERTY_RESOURCE_BINDING', 'FROM cables'],
  ['row cap', (sql, rows) => sql.includes('FROM (SELECT c.tag') ? [{ count: 100001, bytes: '3000' }] : rows, 'SOURCE_CABLE_BUDGET', 'c.updated_at::text'],
  ['byte cap', (sql, rows) => sql.includes('FROM (SELECT c.tag') ? [{ count: 1, bytes: String(LIMITS.outputBytes) }] : rows, 'SOURCE_CABLE_BYTE_BUDGET', 'c.updated_at::text'],
  ['type owner', (sql, rows) => sql.includes('c.updated_at::text') ? [{ ...rows[0], typeProjectId: ID }] : rows, 'SOURCE_CABLE_TYPE_OWNER', 'COMMIT'],
]) test(`database refuses ${name} before subsequent reads and rolls back`, async () => {
  const { state, run } = fakeDatabase({ change }); const result = await run(); assert.equal(result.code, code); assert.equal(result.status, 'FAIL'); assert.ok(!state.calls.some(x => x.sql.includes(forbidden))); assert.equal(state.calls.at(-1).sql, 'ROLLBACK'); assert.equal(state.ended, true);
});
for (const [label, options, code] of [
  ['alternate host', { uri: 'postgres://fixture_user:fixture_secret@localhost:5434/wfc_app' }, 'SOURCE_CONNECTION_ENDPOINT'],
  ['URI startup override', { uri: 'postgres://fixture_user:fixture_secret@host.docker.internal:5434/wfc_app?options=write' }, 'SOURCE_CONNECTION_PARAMETERS'],
  ['URI socket host', { uri: 'postgres://fixture_user:fixture_secret@host.docker.internal:5434/wfc_app?host=%2Ftmp' }, 'SOURCE_CONNECTION_PARAMETERS'],
  ['recursive parser URI', { parsed: { host: 'host.docker.internal', port: '5434', database: 'wfc_app', connectionString: 'private' } }, 'SOURCE_PARSED_ENDPOINT'],
  ['TLS filename indirection', { uri: 'postgres://fixture_user:fixture_secret@host.docker.internal:5434/wfc_app?sslcert=/private' }, 'SOURCE_CONNECTION_PARAMETERS'],
]) test(`configuration refuses ${label} before constructing a Client`, async () => { const { state, run } = fakeDatabase(options); const result = await run(); assert.equal(result.code, code); assert.equal(state.constructed, 0); assert.ok(!JSON.stringify(result).includes('fixture_secret')); });

test('query errors and duplicate transport/end errors remain sanitized while retaining listener through close', async () => {
  const a = fakeDatabase({ throwAt: 'FROM projects', endFails: true }); const result = await a.run(); assert.equal(result.code, 'SOURCE_DATABASE_READ_FAILED'); assert.equal(result.closeFailed, true); assert.ok(!JSON.stringify(result).includes('secret')); assert.equal(a.state.activeErrorListenerAtEnd, true);
  const b = fakeDatabase({ emitAt: 'pg_current_snapshot' }); assert.equal((await b.run()).code, 'SOURCE_SQL_SERVER_IDENTITY');
});

test('metadata projection and generated query never export credentials or import application bootstrap', () => {
  assert.ok(!METADATA_FORMAT.includes('.Config.Env')); assert.ok(!METADATA_FORMAT.includes('Database')); assert.ok(!PROBE_PROGRAM.includes('new pg.Client'));
  const program = buildReadProgram(binding(), 'copy'); assert.match(program, /35000/); assert.match(PROBE_PROGRAM, /7000/); assert.match(program, /updated_at::text/); assert.ok(!program.includes('fixture_secret')); assert.ok(!/import\(['"](?:\.\/|.*server\/)/.test(program)); assert.ok(!program.includes('connectionString:')); rejectsCode(() => buildReadProgram(binding(), 'unexpected'), 'SOURCE_PHASE');
});

test('identity-only mode returns only whitelisted metadata and never issues business SELECTs', async () => {
  const db = fakeDatabase({ identityOnly: true });
  const result = await db.run(); validateSqlIdentity(result);
  assert.equal(result.identity.rawServerAddress, '172.17.0.2/32'); assert.equal(result.identity.canonicalServerAddress, '172.17.0.2');
  assert.equal(db.state.calls.filter(x => x.sql.trim().startsWith('SELECT ')).length, 1);
  assert.ok(!db.state.calls.some(x => /FROM (projects|project_model_selections|model_versions|cables)/.test(x.sql)));
  assert.equal(db.state.calls.at(-1).sql, 'COMMIT'); assert.equal(db.state.activeErrorListenerAtEnd, true); assert.equal(db.state.ended, true);
  assert.ok(!JSON.stringify(result).includes('fixture_secret')); assert.ok(!('snapshot' in result.identity)); assert.ok(!('project' in result));
  const program = buildIdentityProgram(binding()); assert.match(program, /"identityOnly":true/); assert.ok(!program.includes(EXPECTED.projectId)); assert.match(program, /35000/);
});
test('copy accepts the observed PostgreSQL raw inet /32 plus exact SQL host address', async () => {
  const db = fakeDatabase(); const result = await db.run(); validateSnapshot(result, 'copy');
  const sql = db.state.calls.find(x => x.sql.includes('pg_current_snapshot')).sql;
  assert.match(sql, /inet_server_addr\(\)::text AS "rawServerAddress"/); assert.match(sql, /host\(inet_server_addr\(\)\) AS "serverAddress"/);
  assert.equal(result.transaction.rawServerAddress, '172.17.0.2/32'); assert.equal(result.transaction.serverAddress, '172.17.0.2');
});
test('canonical SQL host mismatch remains refused before business reads even if raw address matches', async () => {
  const db = fakeDatabase({ change: (sql, rows) => sql.includes('pg_current_snapshot') ? [{ ...rows[0], rawServerAddress: '172.17.0.2/32', serverAddress: '172.17.0.3' }] : rows });
  assert.equal((await db.run()).code, 'SOURCE_SQL_SERVER_IDENTITY'); assert.ok(!db.state.calls.some(x => x.sql.includes('FROM projects')));
});
test('identity observation refuses extra or malformed metadata fields', () => {
  const result = { schemaVersion: 'pathfinder.current-inputs.sql-identity.v1', status: 'OBSERVED', identity: { rawServerAddress: null, canonicalServerAddress: null, serverPort: null, database: 'fixture', readOnly: 'on', defaultReadOnly: 'on', isolation: 'repeatable read', transportError: false } };
  validateSqlIdentity(result); const extra = clone(result); extra.identity.user = 'unwanted'; rejectsCode(() => validateSqlIdentity(extra), 'SOURCE_IDENTITY_FIELDS');
  const malformed = clone(result); malformed.identity.serverPort = '5432'; rejectsCode(() => validateSqlIdentity(malformed), 'SOURCE_IDENTITY_FIELDS');
});

test('project identity diagnostic reads only id/number/name after exact endpoint guard with fixed bounded search', async () => {
  const db = fakeDatabase({ projectIdentityOnly: true }); const result = await db.run(); validateProjectIdentity(result);
  const select = db.state.calls.filter(x => x.sql.trim().startsWith('SELECT ')); assert.equal(select.length, 3);
  assert.ok(select[0].sql.includes('pg_current_snapshot'));
  assert.equal(select[1].sql, 'SELECT id,project_number AS "projectNumber",name FROM projects WHERE id=$1::uuid LIMIT 2'); assert.deepEqual(select[1].params, [EXPECTED.projectId]);
  assert.match(select[2].sql, /ORDER BY project_number,id LIMIT 11$/); assert.deepEqual(select[2].params, ['%Aalborg%', '%HPU%']);
  assert.ok(!select.slice(1).some(x => /secondary_tray_length|end_connection_length|bending|model|cables|customer/.test(x.sql)));
  assert.equal(db.state.calls.at(-1).sql, 'COMMIT'); assert.equal(db.state.ended, true); assert.equal(result.discoveryOverflow, false);
  assert.match(buildProjectIdentityProgram(binding()), /"projectIdentityOnly":true/);
});
test('project identity diagnostic refuses a different SQL host before even project metadata reads', async () => {
  const db = fakeDatabase({ projectIdentityOnly: true, change: (sql, rows) => sql.includes('pg_current_snapshot') ? [{ ...rows[0], serverAddress: '172.17.0.3' }] : rows });
  assert.equal((await db.run()).code, 'SOURCE_SQL_SERVER_IDENTITY'); assert.ok(!db.state.calls.some(x => x.sql.includes('FROM projects')));
});
test('project discovery cap preserves the eleven observed rows before validation refuses overflow', async () => {
  const db = fakeDatabase({ projectIdentityOnly: true, change: (sql, rows) => sql.includes('ILIKE') ? Array.from({ length: 11 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, projectNumber: 'fixture', name: 'fixture' })) : rows });
  const result = await db.run(); assert.equal(result.status, 'OBSERVED'); assert.equal(result.discoveryRows.length, 11); assert.equal(result.discoveryOverflow, true); rejectsCode(() => validateProjectIdentity(result), 'SOURCE_PROJECT_DISCOVERY_LIMIT');
});
test('project/model guard failures retain only selected private identity diagnostics', async () => {
  const a = fakeDatabase({ change: (sql, rows) => sql.includes('secondary_tray_length') ? [{ ...rows[0], name: 'Observed different name' }] : rows });
  const projectFailure = await a.run(); assert.equal(projectFailure.code, 'SOURCE_PROJECT_IDENTITY'); assert.deepEqual(Object.keys(projectFailure.observation.rows[0]).sort(), ['id', 'name', 'projectNumber']); assert.equal(projectFailure.observation.rows[0].name, 'Observed different name');
  assert.ok(!JSON.stringify(projectFailure).includes('secondaryTrayLength'));
  const b = fakeDatabase({ change: (sql, rows) => sql.includes('FROM model_versions') ? [{ ...rows[0], contentFingerprint: 'a'.repeat(64) }] : rows });
  const modelFailure = await b.run(); assert.equal(modelFailure.code, 'SOURCE_MODEL_IDENTITY'); assert.deepEqual(Object.keys(modelFailure.observation.rows[0]).sort(), ['contentFingerprint', 'health', 'id', 'packageId', 'projectId', 'propertyResources', 'state']); assert.ok(!b.state.calls.some(x => x.sql.includes('FROM cables')));
});

test('actual no-DB child watchdog bounds a hung operation and emits only sanitized JSON', async () => {
  const start = performance.now(); const run = await runCommand(process.execPath, ['--input-type=module'], { input: guardedProgram("await new Promise(()=>{});", 50), timeout: 3000 });
  assert.equal(run.exitCode, 2); assert.equal(run.stderrBytes, 0); assert.equal(JSON.parse(run.stdout).code, 'SOURCE_IN_CONTAINER_DEADLINE'); assert.ok(performance.now() - start < 3000);
});
test('actual no-DB watchdog bounds an awaited write callback that never completes', async () => {
  const run = await runCommand(process.execPath, ['--input-type=module'], { input: guardedProgram("const sink={write(_text,_done){}};await new Promise(resolve=>sink.write('fixture',resolve));", 75), timeout: 3000 }); assert.equal(run.exitCode, 2); assert.equal(JSON.parse(run.stdout).phase, 'deadline');
});

test('before/copy/after comparison catches settings, insertion, deletion and edits without mutating rows', () => {
  const capture = () => ({ snapshot: snapshot() }); const base = [capture(), capture(), capture()]; assert.equal(compareProjections(base).status, 'PASS');
  for (const mutate of [x => { x.project.secondaryTrayLength = '999'; }, x => { x.cables[0].fromLocation = 'changed'; }, x => { x.cables = []; }, x => { x.cables.push({ ...x.cables[0], id: ID, cableId: 2 }); }]) { const x = clone(base); mutate(x[2].snapshot); assert.equal(compareProjections(x).status, 'FAIL_EXTERNAL_OR_UNEXPLAINED_CHANGE'); }
  assert.equal(projectionHashes(base[0].snapshot).cables.count, 1); assert.equal(base[0].snapshot.cables[0].fromLocation, '  /A.001  ');
});

test('exclusive durable captures persist raw bytes and detailed failure before an assertion', async () => {
  const relative = `pathfinder-engine/.scratch/current-inputs-controls-${randomUUID()}`; await fs.mkdir(path.join(ROOT, relative));
  const run = { exitCode: 0, signal: null, error: null, stderrBytes: 0, stderrSha256: sha256(''), stdout: Buffer.from(JSON.stringify(snapshot('before'))) };
  const good = await persistCapture(ROOT, relative, 'before', run); assert.equal(good.raw.sha256, sha256(run.stdout));
  const bad = { ...run, exitCode: 2, stdout: Buffer.from(JSON.stringify({ schemaVersion: 'pathfinder.current-inputs.source-error.v1', status: 'FAIL', code: 'SOURCE_SQL_SERVER_IDENTITY' })) };
  await assert.rejects(persistCapture(ROOT, relative, 'copy', bad), error => error.code === 'SOURCE_SQL_SERVER_IDENTITY' && !!error.capture.raw);
  assert.equal(await fs.readFile(path.join(ROOT, relative, 'copy.private.json'), 'utf8'), bad.stdout.toString());
  assert.equal(JSON.parse(await fs.readFile(path.join(ROOT, relative, 'copy-capture.private.json'))).failure.code, 'SOURCE_SQL_SERVER_IDENTITY');
  await assert.rejects(writeExclusive(ROOT, `${relative}/copy.private.json`, 'overwrite'), error => error.code === 'SOURCE_OUTPUT_EXISTS');
  for (const relativePath of ['../outside', '/absolute', 'C:/absolute', `${relative}/../bad`, 'bad\\path']) await assert.rejects(safePath(ROOT, relativePath, 'new'), error => error.code === 'SOURCE_PATH_INVALID');
  const privateReceipt = { schemaVersion: 'pathfinder.current-inputs.controls-private.v1', work: relative, status: 'PASS', retained: 'Raw success and failure controls retained as proof; no original DB access.' }; await writeExclusive(ROOT, `${relative}/receipt.json`, privateReceipt);
});
