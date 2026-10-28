import test from 'node:test';
import assert from 'node:assert/strict';
import { auditTables, comparePreservation, collectPreservation, buildPreservationProgram, compareStoragePreservation } from './preservation-lib.mjs';

const row = (id, value = '1.00000000000000001') => ({ key: '["' + id + '"]', row_text: '{"id":"' + id + '","n":' + value + '}' });
const snapshot = groups => ({ schemaVersion: 'wfc.pf.catalog-preservation.v1', status: 'PASS', identity: { database: 'wfc_pathfinder_local', address: '172.29.0.2', port: 5432, ro: 'on' }, groups, expected: {} });
test('audit coverage extends existing 27 groups with catalog tables and refuses altered keys/injection', () => {
  const tables = auditTables([{ name: 'trays', keyColumns: ['id'] }, { name: 'project_tray_purpose_templates', keyColumns: ['project_id', 'purpose'] }]);
  assert.equal(Object.keys(tables).length, 29); assert.deepEqual(tables.cables, ['id']);
  assert.throws(() => auditTables([{ name: 'cables', keyColumns: ['project_id'] }]), /KEY_CONFLICT/);
  assert.throws(() => auditTables([{ name: 'trays; DELETE', keyColumns: ['id'] }]), /AUDIT_TABLE/);
});
test('raw numeric and bigint precision changes are detected independently of Number decoding', () => {
  for (const [a, b] of [['1.00000000000000001', '1.00000000000000002'], ['9007199254740992', '9007199254740993'], ['null', '0']]) {
    const before = snapshot({ cables: [row('a', a)] }), after = snapshot({ cables: [row('a', b)] });
    assert.equal(comparePreservation(before, after).status, 'FAIL');
  }
});
test('only exact planned additions and CAS enrichments are accepted', () => {
  const before = snapshot({ cable_types: [row('old', 'null')], cables: [row('cable')], trays: [] });
  const after = snapshot({ cable_types: [row('old', '0')], cables: [row('cable')], trays: [row('new')] });
  after.expected = { cable_types: [{ ...row('old', '0'), action: 'enrich' }], trays: [{ ...row('new'), action: 'insert' }] };
  assert.equal(comparePreservation(before, after).status, 'PASS');
  assert.equal(comparePreservation(before, after).tables.cable_types.enriched, 1);
  after.groups.cables = [row('cable', '0')]; assert.equal(comparePreservation(before, after).status, 'FAIL');
});
test('changed reuse, deleted rows, foreign additions and incomplete plans fail', () => {
  const before = snapshot({ trays: [row('old')] });
  for (const rows of [[], [row('old'), row('foreign')], [row('old', '0')]]) assert.equal(comparePreservation(before, snapshot({ trays: rows })).status, 'FAIL');
  const after = snapshot({ trays: [row('old')] }); after.expected.trays = [{ ...row('missing'), action: 'insert' }]; assert.equal(comparePreservation(before, after).status, 'FAIL');
  after.expected.trays = [{ ...row('old', '0'), action: 'reuse' }]; assert.equal(comparePreservation(before, after).status, 'FAIL');
});
test('exact replay is accepted and duplicate keys/refused snapshots cannot pass', () => {
  const before = snapshot({ trays: [row('a')] }), after = snapshot({ trays: [row('a')] });
  after.expected.trays = [{ ...row('a'), action: 'insert' }]; assert.equal(comparePreservation(before, after).status, 'PASS');
  after.groups.trays.push(row('a')); assert.throws(() => comparePreservation(before, after), /DUPLICATE/);
  after.status = 'FAIL'; assert.throws(() => comparePreservation(before, after), /SNAPSHOT/);
});
test('wrong database address, group set or read-only mode cannot be compared', () => {
  const before = snapshot({ cables: [] });
  for (const change of [x => { x.identity.address = '127.0.0.1'; }, x => { x.identity.ro = 'off'; }, x => { x.groups.trays = []; }]) {
    const after = structuredClone(before); change(after); assert.throws(() => comparePreservation(before, after));
  }
});
test('an expected change outside the audited tables is refused', () => {
  const before = snapshot({ trays: [] }), after = snapshot({ trays: [] });
  after.expected.foreign = []; assert.throws(() => comparePreservation(before, after), /UNCOVERED_EXPECTATION/);
});
test('late connection errors during COMMIT and successful end cannot produce PASS', async () => {
  for (const phase of ['commit', 'end']) {
    let onError; const client = {
      on(event, callback) { if (event === 'error') onError = callback; }, async connect() {},
      async end() { if (phase === 'end') onError(Error('lost')); },
      async query(sql) {
        if (sql.startsWith('SELECT current_database')) return { rows: [{ database: 'wfc_pathfinder_local', address: '172.29.0.2', port: 5432, ro: 'on' }] };
        if (sql.includes('AS jobs')) return { rows: [{ jobs: '0', imports: '0' }] };
        if (sql.startsWith('SELECT count')) return { rows: [{ rows: '0', bytes: '0' }] };
        if (sql === 'COMMIT' && phase === 'commit') onError(Error('lost'));
        return { rows: [] };
      }
    };
    const target = { owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46', project: 'wfc-pathfinder-local-0cba87606e9b', port: 5191, projectId: '1af0f807-7653-40ea-8391-7eea6c54e7d4', serverAddress: '172.29.0.2' };
    const result = await collectPreservation({ target, tables: auditTables([]) }, { client });
    assert.equal(result.status, 'FAIL'); assert.equal(result.error, 'CATALOG_AUDIT_CONNECTION_LOST');
  }
});
test('serialized helper has finite watchdog before input access and projection is read-only on failure', async () => {
  const program = buildPreservationProgram(); assert.ok(program.indexOf('setTimeout') < program.indexOf('globalThis.__wfcPfR1Input')); assert.ok(!program.includes('INSERT INTO'));
  const statements = [], client = { on() {}, async connect() {}, async end() {}, async query(sql) { statements.push(sql); if (sql.startsWith('SELECT current_database')) return { rows: [{ database: 'wrong', address: '172.29.0.2', port: 5432, ro: 'on' }] }; return { rows: [] }; } };
  const target = { owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46', project: 'wfc-pathfinder-local-0cba87606e9b', port: 5191, projectId: '1af0f807-7653-40ea-8391-7eea6c54e7d4', serverAddress: '172.29.0.2' };
  const result = await collectPreservation({ target, tables: auditTables([]) }, { client });
  assert.equal(result.status, 'FAIL'); assert.equal(result.error, 'CATALOG_AUDIT_IDENTITY');
  assert.ok(statements.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')); assert.ok(statements.includes('ROLLBACK')); assert.ok(!statements.includes('COMMIT'));
});
test('storage audit accepts only planned file additions and preserves all current model objects', () => {
  const inventory = () => ({ schemaVersion: 'wfc.pf.catalog-storage-inventory.v1', groups: Object.fromEntries(['model', 'project', 'template'].map(k => [k, { bucket: k, rows: [] }])) });
  const before = inventory(), after = inventory(), file = { table: 'project_files', targetObjectKey: 'owned/new', bytes: 7, sha256: 'a'.repeat(64), readbackSha256: 'a'.repeat(64) };
  before.groups.model.rows.push({ key: 'model', bytes: 200000000, etag: 'old', lastModified: 'date' }); after.groups.model.rows = structuredClone(before.groups.model.rows);
  after.groups.project.rows.push({ key: 'owned/new', bytes: 7, etag: 'new', lastModified: 'date' });
  assert.equal(compareStoragePreservation(before, after, [file]).status, 'PASS');
  assert.equal(compareStoragePreservation(before, after).status, 'FAIL');
  after.groups.model.rows[0].etag = 'changed'; assert.equal(compareStoragePreservation(before, after, [file]).status, 'FAIL');
});
test('missing files, wrong byte counts/readback and duplicate object keys refuse storage audit', () => {
  const before = { schemaVersion: 'wfc.pf.catalog-storage-inventory.v1', groups: Object.fromEntries(['model', 'project', 'template'].map(k => [k, { bucket: k, rows: [] }])) };
  const after = structuredClone(before), file = { table: 'template_files', targetObjectKey: 'new', bytes: 0, sha256: 'a'.repeat(64), readbackSha256: 'a'.repeat(64) };
  assert.equal(compareStoragePreservation(before, after, [file]).status, 'FAIL');
  after.groups.template.rows = [{ key: 'new', bytes: 1, etag: 'e', lastModified: 'date' }]; assert.equal(compareStoragePreservation(before, after, [file]).status, 'FAIL');
  file.bytes = 1; file.readbackSha256 = 'b'.repeat(64); assert.equal(compareStoragePreservation(before, after, [file]).status, 'FAIL');
  after.groups.template.rows.push({ ...after.groups.template.rows[0] }); assert.throws(() => compareStoragePreservation(before, after, [file]), /ROWS/);
});
test('project drawing projection sends two unchanged raw rows to fixed four-field PostgreSQL merge', async () => {
  const sourceId = '0c0007c9-d73f-4d13-bc87-601c544727b7', targetId = '1af0f807-7653-40ea-8391-7eea6c54e7d4';
  const source = '{"id":"' + sourceId + '","support_distance":"1.00000000000000001","cable_layout_settings":{"precision":9007199254740993},"secondary_tray_length":"999"}', baseline = '{"id":"' + targetId + '","support_distance":null,"secondary_tray_length":7}';
  const desired = '{"id":"' + targetId + '","support_distance":1.00000000000000001,"secondary_tray_length":7}';
  const run = async (sourceRowText, baselineRowText) => {
    const queries = [], client = { on() {}, async connect() {}, async end() {}, async query(sql, parameters) {
      queries.push({ sql, parameters });
      if (sql.startsWith('SELECT current_database')) return { rows: [{ database: 'wfc_pathfinder_local', address: '172.29.0.2', port: 5432, ro: 'on' }] };
      if (sql.includes('AS jobs')) return { rows: [{ jobs: '0', imports: '0' }] };
      if (sql.startsWith('SELECT count')) return { rows: [{ rows: '0', bytes: '0' }] };
      if (sql.includes('jsonb_populate_record(NULL::projects')) return { rows: [{ key: '["' + targetId + '"]', row_text: desired }] };
      return { rows: [] };
    } };
    const target = { owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46', project: 'wfc-pathfinder-local-0cba87606e9b', port: 5191, projectId: targetId, serverAddress: '172.29.0.2' };
    const result = await collectPreservation({ target, tables: auditTables([]), expectations: [{ table: 'projects', kind: 'project-drawing', sourceRowText, baselineRowText, overrides: {}, action: 'enrich' }] }, { client });
    return { result, queries };
  };
  const { result, queries } = await run(source, baseline); assert.equal(result.status, 'PASS');
  const query = queries.find(q => q.sql.includes('jsonb_populate_record(NULL::projects'));
  assert.deepEqual(query.parameters, [baseline, source]);
  assert.ok(!query.sql.includes("'secondary_tray_length'")); assert.ok(!query.sql.includes("'updated_at'"));
  assert.equal(result.expected.projects[0].row_text, desired);
  const before = snapshot({ projects: [{ key: '["' + targetId + '"]', row_text: baseline }] }), after = snapshot({ projects: [{ key: '["' + targetId + '"]', row_text: desired }] });
  after.expected = result.expected; assert.equal(comparePreservation(before, after).status, 'PASS');
  after.groups.projects[0].row_text = desired.replace('"secondary_tray_length":7', '"secondary_tray_length":999'); assert.equal(comparePreservation(before, after).status, 'FAIL');
  assert.equal((await run(source.replace(sourceId, targetId), baseline)).result.status, 'FAIL');
  assert.equal((await run(source, baseline.replace(targetId, sourceId))).result.status, 'FAIL');
});
