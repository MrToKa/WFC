import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  EXPECTED, LIMITS, TABLES, PROJECT_COLUMNS, PROJECT_NUMERIC_TEXT_COLUMNS, SCHEMA_VERSION,
  canonical, fileInventory, validateSourceProjection, sourceProjectionHashes, compareSourceProjections,
  readSourceDatabase, sourceConfig, buildReadProgram,
} from './source-lib.mjs';

const ID = index => '11111111-1111-4111-8111-' + String(index).padStart(12, '0');
const clone = value => structuredClone(value);
const date = '2026-10-19 03:00:00.123456+00';
const containers = () => [EXPECTED.backend, EXPECTED.postgres].map(expected => ({ id: expected.id, name: expected.name, image: expected.image,
  running: true, startedAt: expected.startedAt, workingDirectory: '/app', user: 'node',
  networks: { [expected.network]: { NetworkID: expected.networkId, IPAddress: expected.address } },
  ports: expected === EXPECTED.postgres ? { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5434' }, { HostIp: '::', HostPort: '5434' }] } : {}, extraHosts: [] }));
const binding = () => ({ schemaVersion: 'pathfinder.current-inputs.binding.v1', ownerId: ID(999), containers: containers(),
  endpoint: { schemaVersion: 'pathfinder.current-inputs.endpoint-probe.v1', host: 'host.docker.internal', port: '5434', database: 'wfc_app',
    addresses: [{ address: '192.168.65.254', family: 4 }, { address: 'fdc4:f303:9324::254', family: 6 }], pgVersion: '8.16.3', parserVersion: '2.9.1', dbConnected: false },
  source: { revision: EXPECTED.revision, branch: 'main', clean: true } });
const makeRow = (tableName, id, values = {}) => {
  const table = TABLES.find(table => table.table === tableName), row = Object.fromEntries(table.columns.map(column => [column, null]));
  if ('id' in row) row.id = id;
  for (const column of table.columns.filter(column => column.endsWith('_at'))) row[column] = date;
  for (const column of table.booleanColumns ?? []) row[column] = false;
  for (const column of table.integerColumns ?? []) row[column] = 1;
  for (const column of table.jsonColumns ?? []) row[column] = [];
  Object.assign(row, values);
  return { key: table.keyColumns.map(column => row[column]), rowText: JSON.stringify(row) };
};
function fixture(phase = 'copy') {
  const project = { id: EXPECTED.projectId, project_number: EXPECTED.projectNumber, name: EXPECTED.projectName,
    secondary_tray_length: '0.000', end_connection_length: null, additional_bending_percent: '10.00', support_distance: '9007199254740993.000001',
    support_weight: '0', tray_load_safety_factor: null, cable_layout_settings: { maximumRows: 3 } };
  const groups = Object.fromEntries(TABLES.map(table => [table.table, { keyColumns: table.keyColumns, columns: table.columns, numericTextColumns: table.numericTextColumns, rows: [] }]));
  const put = (table, id, values) => groups[table].rows.push(makeRow(table, id, values));
  put('trays', ID(1), { project_id: project.id, name: '  /Tray-A  ', tray_type: 'Type A', purpose: 'Control ', width_mm: '9007199254740993.000001', height_mm: '0.000', length_mm: null,
    include_grounding_cable: true, grounding_cable_type_id: ID(2), trefoil_clamp_spacing_mm: '600.000' });
  put('cable_types', ID(2), { project_id: project.id, name: 'Cable A', purpose: 'grounding', diameter_mm: '0.12345678901234567890123456789', weight_kg_per_m: null, source_material_cable_type_id: ID(3) });
  put('cable_type_default_materials', ID(4), { cable_type_id: ID(2), name: 'Default material', quantity: '0.000' });
  put('material_cable_types', ID(3), { name: 'Material cable A', diameter_mm: '0.12345678901234567890123456789', unit_price: '0', minimum_order_quantity: '1', order_measurement: 'meters', packaging: 'm' });
  put('material_trays', ID(5), { tray_type: 'Type A', load_curve_id: ID(6), image_template_id: ID(7), unit_price: '0', minimum_order_quantity: '1', order_measurement: 'pcs', packaging: 'pcs' });
  put('material_load_curves', ID(6), { name: 'Curve A', tray_id: ID(5) });
  put('material_load_curve_points', ID(8), { load_curve_id: ID(6), point_order: 0, span_m: '1.0000000000000000000001', load_kn_per_m: '0' });
  put('project_support_distances', null, { project_id: project.id, tray_type: 'Type A', support_distance: null, support_id: ID(9) });
  put('material_supports', ID(9), { support_type: 'Support A', image_template_id: ID(7), unit_price: '0', minimum_order_quantity: '1', order_measurement: 'pcs', packaging: 'pcs' });
  put('material_cable_type_standard_materials', ID(10), { cable_type_id: ID(3), referenced_material_id: ID(11), quantity: '1.000', unit: 'pcs' });
  put('material_tray_standard_materials', ID(12), { tray_id: ID(5), referenced_material_id: ID(11), quantity: '0.125', unit: 'pcs/m' });
  put('material_support_standard_materials', ID(13), { support_id: ID(9), referenced_material_id: ID(11), quantity: '1', unit: 'pcs' });
  put('material_cable_installation_materials', ID(11), { type: 'Installation A', unit_price: '0', minimum_order_quantity: '1', order_measurement: 'pcs', packaging: 'pcs' });
  put('material_cable_installation_materials', ID(14), { type: 'Installation child', unit_price: '0', minimum_order_quantity: '1', order_measurement: 'pcs', packaging: 'pcs' });
  put('material_cable_installation_standard_materials', ID(15), { cable_installation_material_id: ID(11), referenced_material_id: ID(14), quantity: '1.000001', unit: 'pcs' });
  put('project_tray_purpose_templates', null, { project_id: project.id, tray_purpose: 'Control ', project_file_id: ID(16) });
  put('project_files', ID(16), { project_id: project.id, object_key: 'source/project/report.docx', file_name: 'Report.docx', content_type: 'application/word', size_bytes: '9007199254740993', uploaded_by: ID(500) });
  put('project_file_versions', ID(17), { project_file_id: ID(16), object_key: 'source/project/previous.docx', file_name: 'Report.docx', content_type: null, size_bytes: null, uploaded_by: null });
  put('template_files', ID(7), { object_key: 'source/templates/image.png', file_name: 'image.png', content_type: 'image/png', size_bytes: '0', uploaded_by: ID(500) });
  put('template_file_versions', ID(18), { template_id: ID(7), object_key: 'source/templates/old-image.png', file_name: 'image.png', content_type: 'image/png', size_bytes: '1', uploaded_by: null });
  return { schemaVersion: SCHEMA_VERSION, project: { id: project.id, projectNumber: project.project_number, name: project.name, rowText: JSON.stringify(project) }, groups,
    files: fileInventory(groups), source: { backendId: EXPECTED.backend.id, postgresId: EXPECTED.postgres.id, revision: EXPECTED.revision,
      databaseHost: EXPECTED.endpoint.host, databasePort: EXPECTED.endpoint.port, database: EXPECTED.endpoint.database },
    transaction: { database: EXPECTED.endpoint.database, serverAddress: EXPECTED.endpoint.serverAddress, serverPort: EXPECTED.endpoint.serverPort,
      readOnly: 'on', defaultReadOnly: 'on', isolation: 'repeatable read', snapshot: '10:20:', capturedAt: date, phase } };
}
function fakeDatabase({ change, uri = 'postgres://fixture:private-fixture-secret@host.docker.internal:5434/wfc_app', parsed, throwAt, emitAt, endFails = false, emitAtEnd = false, badConfig } = {}) {
  const data = fixture(), calls = [], state = { calls, constructed: 0, ended: false, listenerAtEnd: false, connection: null };
  const pg = { Client: class extends EventEmitter {
    constructor(options) { super(); state.constructed++; state.connection = options; }
    async connect() { calls.push({ sql: 'CONNECT' }); }
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (emitAt && sql.includes(emitAt)) this.emit('error', new Error('private-fixture-secret'));
      if (throwAt && sql.includes(throwAt)) throw new Error('postgres://private-fixture-secret@private');
      let rows = [];
      if (sql.includes('pg_current_snapshot')) { const { phase: _, ...transaction } = data.transaction; rows = [transaction]; }
      else if (sql.includes('FROM projects t')) rows = [{ rowText: data.project.rowText }];
      else {
        const table = /FROM "([a-z_]+)" t WHERE/.exec(sql)?.[1];
        if (table) {
          const entries = data.groups[table].rows;
          rows = sql.startsWith('SELECT count(*)') ? [{ count: String(entries.length), bytes: String(entries.reduce((sum, row) => sum + 1024 + 6 * Buffer.byteLength(row.rowText), 0)),
            maxRowBytes: String(Math.max(0, ...entries.map(row => Buffer.byteLength(row.rowText)))) }] : clone(entries);
        }
      }
      return { rows: change ? change(sql, rows, parameters) ?? rows : rows };
    }
    async end() { state.listenerAtEnd = this.listenerCount('error') > 0; state.ended = true; if (emitAtEnd) this.emit('error', new Error('private close')); if (endFails) throw new Error('private close'); }
  } };
  const parse = () => parsed ?? { host: 'host.docker.internal', port: '5434', database: 'wfc_app', user: 'fixture', password: 'private-fixture-secret', options: '-c default_transaction_read_only=off', query_timeout: 0 };
  const config = sourceConfig(binding(), 'copy'); if (badConfig) badConfig(config);
  return { state, data, run: () => readSourceDatabase(config, { pg, parse, uri }) };
}
const throwsCode = (fn, code) => assert.throws(fn, error => error.code === code);
const replaceRow = (snapshot, table, index, mutate) => { const row = JSON.parse(snapshot.groups[table].rows[index].rowText); mutate(row); snapshot.groups[table].rows[index].rowText = JSON.stringify(row); };

test('closed projection preserves precision pairs, null, zero, raw spelling, microseconds and BIGINT text', () => {
  const snapshot = fixture(); validateSourceProjection(snapshot, 'copy');
  assert.equal(JSON.parse(snapshot.groups.trays.rows[0].rowText).width_mm, '9007199254740993.000001');
  assert.equal(JSON.parse(snapshot.groups.trays.rows[0].rowText).height_mm, '0.000');
  assert.equal(JSON.parse(snapshot.groups.cable_types.rows[0].rowText).weight_kg_per_m, null);
  assert.equal(snapshot.files[0].sizeBytes, '9007199254740993');
  assert.equal(JSON.parse(snapshot.groups.trays.rows[0].rowText).name, '  /Tray-A  ');
  assert.ok(snapshot.groups.trays.rows[0].rowText.includes(date));
  const next = clone(snapshot); replaceRow(next, 'trays', 0, row => { row.width_mm = '9007199254740993.000002'; });
  assert.notEqual(sourceProjectionHashes(snapshot).sha256, sourceProjectionHashes(next).sha256);
});

test('all fixed table columns, typed FKs and source projection phases are hash-bound', () => {
  assert.equal(TABLES.length, 19); assert.equal(PROJECT_COLUMNS.length, 10); assert.equal(PROJECT_NUMERIC_TEXT_COLUMNS.length, 6);
  const before = fixture('before'), copy = fixture('copy'), after = fixture('after');
  after.transaction.snapshot = '21:22:'; after.transaction.capturedAt = '2026-10-19 03:05:00.000001+00';
  assert.equal(compareSourceProjections(before, copy, after).status, 'PASS');
  assert.equal(compareSourceProjections(before, after).status, 'PASS');
  validateSourceProjection(copy, binding());
  replaceRow(after, 'trays', 0, row => { row.purpose = 'Changed'; });
  throwsCode(() => compareSourceProjections(before, copy, after), 'CATALOG_SOURCE_CHANGED');
});

for (const [name, mutate, code] of [
  ['foreign project', snapshot => { replaceRow(snapshot, 'trays', 0, row => { row.project_id = ID(500); }); }, 'CATALOG_FOREIGN_PROJECT'],
  ['duplicate row', snapshot => { snapshot.groups.trays.rows.push(clone(snapshot.groups.trays.rows[0])); }, 'CATALOG_ROW_IDENTITY'],
  ['key mismatch', snapshot => { snapshot.groups.trays.rows[0].key = [ID(99)]; }, 'CATALOG_ROW_IDENTITY'],
  ['number instead of NUMERIC text', snapshot => { replaceRow(snapshot, 'trays', 0, row => { row.width_mm = 100; }); }, 'CATALOG_NUMERIC_TEXT'],
  ['NaN numeric', snapshot => { replaceRow(snapshot, 'trays', 0, row => { row.width_mm = 'NaN'; }); }, 'CATALOG_NUMERIC_TEXT'],
  ['Infinity numeric', snapshot => { replaceRow(snapshot, 'trays', 0, row => { row.width_mm = 'Infinity'; }); }, 'CATALOG_NUMERIC_TEXT'],
  ['dangling grounding type', snapshot => { replaceRow(snapshot, 'trays', 0, row => { row.grounding_cable_type_id = ID(99); }); }, 'CATALOG_DEPENDENCY_MISSING'],
  ['foreign report file', snapshot => { replaceRow(snapshot, 'project_files', 0, row => { row.project_id = ID(99); }); }, 'CATALOG_FOREIGN_PROJECT'],
  ['missing composition child', snapshot => { snapshot.groups.material_cable_installation_materials.rows.pop(); }, 'CATALOG_DEPENDENCY_MISSING'],
  ['missing curve backreference', snapshot => { replaceRow(snapshot, 'material_load_curves', 0, row => { row.tray_id = ID(99); }); }, 'CATALOG_DEPENDENCY_MISSING'],
  ['inventory unrelated key', snapshot => { snapshot.files[0].objectKey = 'arbitrary/private'; }, 'CATALOG_FILE_INVENTORY'],
  ['inventory size number', snapshot => { snapshot.files[0].sizeBytes = 5; }, 'CATALOG_FILE_INVENTORY'],
  ['unknown table', snapshot => { snapshot.groups.users = {}; }, 'CATALOG_SOURCE_GROUPS'],
  ['unknown column', snapshot => { replaceRow(snapshot, 'trays', 0, row => { row.secret = 'x'; }); }, 'CATALOG_ROW_IDENTITY'],
  ['null required type name', snapshot => { replaceRow(snapshot, 'cable_types', 0, row => { row.name = null; }); }, 'CATALOG_REQUIRED_TEXT'],
  ['unreferenced report file header', snapshot => { snapshot.groups.project_tray_purpose_templates.rows = []; snapshot.files = fileInventory(snapshot.groups); }, 'CATALOG_UNREFERENCED_FILE'],
  ['unreferenced material type', snapshot => { replaceRow(snapshot, 'cable_types', 0, row => { row.source_material_cable_type_id = null; }); }, 'CATALOG_UNREFERENCED_DEPENDENCY'],
  ['unreferenced installation material', snapshot => { snapshot.groups.material_cable_installation_standard_materials.rows = []; }, 'CATALOG_UNREFERENCED_DEPENDENCY'],
  ['wrong source provenance', snapshot => { snapshot.source.backendId = 'a'.repeat(64); }, 'CATALOG_SOURCE_PROVENANCE'],
  ['write transaction', snapshot => { snapshot.transaction.readOnly = 'off'; }, 'CATALOG_SOURCE_TRANSACTION'],
]) test(`projection refuses ${name}`, () => { const snapshot = fixture(); mutate(snapshot); throwsCode(() => validateSourceProjection(snapshot), code); });

test('source raw Client pins RO identity before reads, budgets before transfer and closes its listener', async () => {
  const { state, run } = fakeDatabase(); const result = await run(); validateSourceProjection(result, 'copy');
  assert.equal(state.constructed, 1); assert.match(state.connection.options, /default_transaction_read_only=on/);
  assert.equal(state.connection.connectionTimeoutMillis, 5000); assert.equal(state.connection.query_timeout, 20000);
  assert.equal(state.calls[1].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const firstIdentity = state.calls.findIndex(call => call.sql.includes('pg_current_snapshot'));
  assert.ok(firstIdentity < state.calls.findIndex(call => call.sql.includes('FROM projects t')));
  for (const table of TABLES) {
    const indices = state.calls.flatMap((call, index) => call.sql.includes(`FROM "${table.table}" t WHERE`) ? [index] : []);
    assert.equal(indices.length, 2); assert.ok(state.calls[indices[0]].sql.startsWith('SELECT count(*)'));
    const read = state.calls[indices[1]];
    for (const column of table.numericTextColumns) assert.ok(read.sql.includes(`t."${column}"::text`));
    assert.match(read.sql, /LIMIT 100001/); assert.ok(read.parameters);
  }
  assert.equal(state.calls.filter(call => call.sql.includes('pg_current_snapshot')).length, 2);
  assert.equal(state.calls.at(-1).sql, 'COMMIT'); assert.equal(state.ended, true); assert.equal(state.listenerAtEnd, true);
  assert.ok(!state.calls.some(call => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|TRUNCATE)\b/.test(call.sql)));
});

test('only actual dependency seeds and bounded recursive closures are selected', async () => {
  const { state, run } = fakeDatabase(); await run();
  const reads = state.calls.filter(call => call.sql.startsWith('SELECT jsonb_build_array'));
  const materialTray = reads.find(call => call.sql.includes('FROM "material_trays"'));
  assert.match(materialTray.sql, /WITH RECURSIVE required/); assert.match(materialTray.sql, /LOWER\(TRIM\(source_tray.tray_type\)\)/);
  assert.deepEqual(materialTray.parameters, [EXPECTED.projectId]);
  const composition = reads.find(call => call.sql.includes('FROM "material_cable_installation_materials"'));
  assert.match(composition.sql, /WITH RECURSIVE required/); assert.deepEqual(composition.parameters, [[ID(11)]]);
  const report = reads.find(call => call.sql.includes('FROM "project_files"'));
  assert.deepEqual(report.parameters, [EXPECTED.projectId, [ID(16)]]);
  const template = reads.find(call => call.sql.includes('FROM "template_files"'));
  assert.deepEqual(template.parameters, [[ID(7)]]);
});

for (const [name, options, code] of [
  ['alternate host', { uri: 'postgres://fixture:private-fixture-secret@localhost:5434/wfc_app' }, 'CATALOG_CONNECTION_ENDPOINT'],
  ['URI startup override', { uri: 'postgres://fixture:private-fixture-secret@host.docker.internal:5434/wfc_app?options=off' }, 'CATALOG_CONNECTION_PARAMETERS'],
  ['TLS filename indirection', { uri: 'postgres://fixture:private-fixture-secret@host.docker.internal:5434/wfc_app?sslrootcert=/private' }, 'CATALOG_CONNECTION_PARAMETERS'],
  ['recursive parser URI', { parsed: { host: 'host.docker.internal', port: '5434', database: 'wfc_app', connectionString: 'private-fixture-secret' } }, 'CATALOG_PARSED_ENDPOINT'],
  ['scope mutation', { badConfig: config => { config.projectId = ID(99); } }, 'CATALOG_HELPER_SCOPE'],
]) test(`source refuses ${name} before constructing Client`, async () => {
  const { state, run } = fakeDatabase(options); const result = await run();
  assert.equal(result.status, 'FAIL'); assert.equal(result.code, code); assert.equal(state.constructed, 0);
  assert.ok(!JSON.stringify(result).includes('private-fixture-secret'));
});

for (const [name, change, code, forbidden] of [
  ['SQL identity', (sql, rows) => sql.includes('pg_current_snapshot') ? [{ ...rows[0], serverPort: 5434 }] : rows, 'CATALOG_SQL_IDENTITY', 'FROM projects t'],
  ['write setting', (sql, rows) => sql.includes('pg_current_snapshot') ? [{ ...rows[0], readOnly: 'off' }] : rows, 'CATALOG_SQL_IDENTITY', 'FROM projects t'],
  ['project identity', (sql, rows) => sql.includes('FROM projects t') ? [{ rowText: JSON.stringify({ id: ID(99), project_number: EXPECTED.projectNumber, name: EXPECTED.projectName }) }] : rows, 'CATALOG_SOURCE_PROJECT', 'FROM "trays"'],
  ['row overflow', (sql, rows) => sql.startsWith('SELECT count(*)') ? [{ ...rows[0], count: '100001' }] : rows, 'CATALOG_SOURCE_ROW_BUDGET', 'SELECT jsonb_build_array'],
  ['byte overflow', (sql, rows) => sql.startsWith('SELECT count(*)') ? [{ ...rows[0], bytes: String(LIMITS.outputBytes) }] : rows, 'CATALOG_SOURCE_BYTE_BUDGET', 'SELECT jsonb_build_array'],
  ['single-row overflow', (sql, rows) => sql.startsWith('SELECT count(*)') ? [{ ...rows[0], maxRowBytes: String(LIMITS.rowBytes + 1) }] : rows, 'CATALOG_SOURCE_BYTE_BUDGET', 'SELECT jsonb_build_array'],
  ['invalid budget', (sql, rows) => sql.startsWith('SELECT count(*)') ? [{ ...rows[0], count: 1 }] : rows, 'CATALOG_SOURCE_BUDGET_SCHEMA', 'SELECT jsonb_build_array'],
]) test(`source refuses ${name} before subsequent transfer and rolls back`, async () => {
  const { state, run } = fakeDatabase({ change }); const result = await run();
  assert.equal(result.code, code); assert.equal(result.status, 'FAIL'); assert.equal(result.rollbackConfirmed, true);
  assert.ok(!state.calls.some(call => call.sql.includes(forbidden))); assert.equal(state.calls.at(-1).sql, 'ROLLBACK'); assert.equal(state.ended, true);
});

test('count mismatch, query/transport failures and close failures stay sanitized', async () => {
  const mismatch = fakeDatabase({ change: (sql, rows) => sql.startsWith('SELECT jsonb_build_array') ? [] : rows });
  assert.equal((await mismatch.run()).code, 'CATALOG_SOURCE_COUNT_MISMATCH');
  const failed = fakeDatabase({ throwAt: 'FROM "trays"', endFails: true });
  const a = await failed.run(); assert.equal(a.code, 'CATALOG_SOURCE_READ_FAILED'); assert.equal(a.closeFailed, true); assert.equal(failed.state.listenerAtEnd, true);
  const transport = fakeDatabase({ emitAt: 'pg_current_snapshot' }); assert.equal((await transport.run()).code, 'CATALOG_CONNECTION_LOST');
  const late = fakeDatabase({ emitAtEnd: true }); assert.equal((await late.run()).code, 'CATALOG_CONNECTION_LOST');
  assert.ok(!JSON.stringify(a).includes('private-fixture-secret'));
});

test('final SQL identity recheck cannot return a success after changed read-only context', async () => {
  let calls = 0;
  const database = fakeDatabase({ change: (sql, rows) => sql.includes('pg_current_snapshot') && ++calls === 2 ? [{ ...rows[0], defaultReadOnly: 'off' }] : rows });
  const result = await database.run(); assert.equal(result.code, 'CATALOG_SQL_IDENTITY');
  assert.equal(database.state.calls.at(-1).sql, 'ROLLBACK'); assert.equal(database.state.calls.some(call => call.sql === 'COMMIT'), false);
});

test('whole-helper deadline during BEGIN refuses later reads and still cleans up the possible transaction', { concurrency: false }, async () => {
  const originalNow = Date.now; let clock = 0;
  Date.now = () => clock;
  try {
    const database = fakeDatabase({ change: (sql, rows) => { if (sql.startsWith('BEGIN ')) clock = LIMITS.childMilliseconds; return rows; } });
    const result = await database.run();
    assert.equal(result.status, 'FAIL'); assert.equal(result.code, 'CATALOG_SOURCE_DEADLINE'); assert.equal(result.rollbackConfirmed, true);
    assert.equal(database.state.calls.at(-1).sql, 'ROLLBACK'); assert.equal(database.state.ended, true);
    assert.equal(database.state.calls.some(call => call.sql.includes('FROM projects')), false);
  } finally { Date.now = originalNow; }
});

test('generated program has independent pre-read watchdog, only raw pg and closed fixed config', () => {
  const program = buildReadProgram(binding(), 'copy');
  assert.match(program, /__wfcPfR1SourceTimer=setTimeout/); assert.ok(program.indexOf('setTimeout') < program.indexOf('DATABASE_URL'));
  assert.match(program, /35000/); assert.ok(!program.includes('__wfcPfR1GuardTimer'));
  assert.ok(!/import\(['"](?:\.\/|.*server\/)/.test(program)); assert.ok(!program.includes('private-fixture-secret'));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction(program));
  throwsCode(() => buildReadProgram(binding(), 'invalid'), 'CATALOG_SOURCE_PHASE');
  const changed = binding(); changed.containers[0].id = 'a'.repeat(64);
  assert.throws(() => buildReadProgram(changed, 'copy'), error => error.code === 'SOURCE_CONTAINER_IDENTITY');
});
