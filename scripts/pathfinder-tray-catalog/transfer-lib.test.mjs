import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { TABLES, TRANSFER_TARGET, TRANSFER_LIMITS, PROJECT_DRAWING_COLUMNS, canonical, sha256, createTransferPlan, validateTransferPlan, validateTargetBaseline, transferDatabase, captureTargetBaseline, buildTransferProgram } from './transfer-lib.mjs';
import { EXPECTED, SCHEMA_VERSION, fileInventory, validateSourceProjection } from './source-lib.mjs';

// Entirely synthetic rows and fake Client; no files, credentials or databases are read.
const ID = n => '22222222-2222-4222-8222-' + String(n).padStart(12, '0');
const clone = structuredClone, date = '2026-10-19 04:00:00.123456+00', actorId = ID(9000), owner = ID(9001);
const target = { ...TRANSFER_TARGET, serverAddress: '172.29.0.2' };
const tableSpec = name => TABLES.find(t => t.table === name);
const row = (name, id, facts = {}) => {
  const t = tableSpec(name), value = Object.fromEntries(t.columns.map(k => [k, null]));
  if (t.columns.includes('id')) value.id = id;
  for (const k of t.columns.filter(k => k.endsWith('_at'))) value[k] = date;
  for (const k of t.booleanColumns ?? []) value[k] = false;
  for (const k of t.integerColumns ?? []) value[k] = 1;
  for (const k of t.jsonColumns ?? []) value[k] = [];
  Object.assign(value, facts);
  return { key: t.keyColumns.map(k => value[k]), rowText: canonical(value) };
};
const groups = () => Object.fromEntries(TABLES.map(t => [t.table, { keyColumns: t.keyColumns, columns: t.columns, numericTextColumns: t.numericTextColumns, rows: [] }]));
const modelSelection = () => ({ active_model_version_id: target.modelVersionId, selection_revision: '1', content_fingerprint: target.contentFingerprint, state: 'ready', health: 'healthy' });
function fixture({ files = false } = {}) {
  const sourceGroups = groups(), baselineGroups = groups();
  const project = { id: EXPECTED.projectId, project_number: EXPECTED.projectNumber, name: EXPECTED.projectName, secondary_tray_length: '7', end_connection_length: '5', additional_bending_percent: '10', support_distance: '9007199254740993.000001', support_weight: '0.000', tray_load_safety_factor: '1.00000000000000000000001', cable_layout_settings: { synthetic: true, maximumRows: 3 } };
  const put = (table, id, facts) => sourceGroups[table].rows.push(row(table, id, facts));
  const types = Array.from({ length: 50 }, (_, i) => ({ sourceId: ID(i + 1), id: ID(i + 1001), name: 'Synthetic cable type ' + i }));
  for (const t of types) {
    put('cable_types', t.sourceId, { project_id: project.id, name: t.name, purpose: 'Control', diameter_mm: '9007199254740993.000001', weight_kg_per_m: '0.000', source_material_cable_type_id: ID(100) });
    baselineGroups.cable_types.rows.push(row('cable_types', t.id, { project_id: target.projectId, name: t.name }));
  }
  put('cable_types', ID(51), { project_id: project.id, name: 'Synthetic grounding', purpose: 'grounding', diameter_mm: null, source_material_cable_type_id: null });
  put('trays', ID(60), { project_id: project.id, name: '  /Tray-A  ', tray_type: 'Synthetic type', purpose: ' Control ', width_mm: '9007199254740993.000002', height_mm: '0.000', length_mm: null, include_grounding_cable: true, grounding_cable_type_id: ID(51) });
  put('material_cable_types', ID(100), { name: 'Synthetic material cable', unit_price: '0', minimum_order_quantity: '1' });
  put('material_trays', ID(101), { tray_type: 'Synthetic type', load_curve_id: ID(102), image_template_id: files ? ID(120) : null });
  put('material_load_curves', ID(102), { name: 'Synthetic curve', tray_id: ID(101) });
  put('material_load_curve_points', ID(103), { load_curve_id: ID(102), point_order: 0, span_m: '1.00000000000000000000001', load_kn_per_m: '0' });
  put('material_tray_standard_materials', ID(104), { tray_id: ID(101), referenced_material_id: ID(105), quantity: '0.12500001' });
  put('material_cable_installation_materials', ID(105), { type: 'Synthetic install A' });
  put('material_cable_installation_materials', ID(106), { type: 'Synthetic install B' });
  put('material_cable_installation_standard_materials', ID(107), { cable_installation_material_id: ID(105), referenced_material_id: ID(106), quantity: '1.00000001' });
  put('project_support_distances', null, { project_id: project.id, tray_type: 'Synthetic type', support_distance: null, support_id: null });
  if (files) {
    put('template_files', ID(120), { object_key: 'synthetic/original/image', file_name: 'synthetic.png', size_bytes: '3', uploaded_by: ID(999) });
    put('template_file_versions', ID(121), { template_id: ID(120), object_key: 'synthetic/original/old', file_name: 'synthetic.png', size_bytes: '0', uploaded_by: null });
  }
  const sourceProjection = { schemaVersion: SCHEMA_VERSION, project: { id: project.id, projectNumber: project.project_number, name: project.name, rowText: canonical(project) }, groups: sourceGroups, files: fileInventory(sourceGroups),
    source: { backendId: EXPECTED.backend.id, postgresId: EXPECTED.postgres.id, revision: EXPECTED.revision, databaseHost: EXPECTED.endpoint.host, databasePort: EXPECTED.endpoint.port, database: EXPECTED.endpoint.database },
    transaction: { database: EXPECTED.endpoint.database, serverAddress: EXPECTED.endpoint.serverAddress, serverPort: EXPECTED.endpoint.serverPort, readOnly: 'on', defaultReadOnly: 'on', isolation: 'repeatable read', snapshot: '10:11:', capturedAt: date, phase: 'copy' } };
  validateSourceProjection(sourceProjection);
  const targetBaseline = { schemaVersion: 'wfc.pf.tray-catalog-target-baseline.v1', target: clone(target), actorId, projectRowText: canonical({ id: target.projectId, name: 'Synthetic isolated target', settings: 'unchanged', customer: 'Synthetic customer', secondary_tray_length: '7', end_connection_length: '5', additional_bending_percent: '10', connection_gap: '1', created_at: date, updated_at: date, ...Object.fromEntries(PROJECT_DRAWING_COLUMNS.map(k => [k, null])) }), modelSelection: modelSelection(), groups: baselineGroups,
    transaction: { mode: 'repeatable-read-read-only', status: 'observed', identity: { database: 'wfc_pathfinder_local', address: target.serverAddress, port: 5432, ro: 'on' }, commitConfirmed: true, transportError: false } };
  const entries = sourceProjection.files.map((f, i) => ({ table: f.table, sourceId: f.id, targetId: ID(3000 + i), sourceObjectKey: f.objectKey, targetObjectKey: 'pathfinder-tray-catalog/' + owner + '/' + f.table + '/' + ID(3000 + i), bytes: Number(f.sizeBytes), sha256: sha256('synthetic-' + i), readbackSha256: sha256('synthetic-' + i) }));
  const filePlan = { status: 'PASS', owner, prefix: 'pathfinder-tray-catalog/' + owner + '/', entries, manifestSha256: sha256(canonical({ owner, prefix: 'pathfinder-tray-catalog/' + owner + '/', entries })), receiptSha256: sha256('synthetic-receipt') };
  const input = { sourceProjection, seedPlan: { schemaVersion: 'pathfinder.copied-project.seed-plan.v1', id: target.projectId, source: { projectId: project.id }, types }, targetBaseline, filePlan, actorId,
    sourceRef: { path: 'synthetic/source.private.json', bytes: 100, sha256: sha256('synthetic-source') }, seedRef: { path: 'synthetic/seed.private.json', bytes: 100, sha256: sha256('synthetic-seed') } };
  const allocate = () => { let next = 5000; return () => ID(next++); };
  return { input, plan: () => createTransferPlan(input, { makeUuid: allocate(), now: '2026-10-19T04:00:00.000Z' }) };
}
// Lossless synthetic oracle for the fixed SQL projection; unlike JSON.parse /
// stringify, it retains large JSON numeric tokens while replacing only four
// top-level values. This does not execute SQL or claim PostgreSQL integration.
function rawFields(text) {
  const fields = new Map(); let i = 1;
  while (i < text.length) {
    while (/\s|,/.test(text[i])) i++; if (text[i] === '}') break;
    const keyStart = i++; let escaped = false;
    for (; i < text.length; i++) { if (escaped) escaped = false; else if (text[i] === '\\') escaped = true; else if (text[i] === '"') break; }
    const key = JSON.parse(text.slice(keyStart, ++i)); while (/\s|:/.test(text[i])) i++;
    const start = i; let depth = 0, string = false; escaped = false;
    for (; i < text.length; i++) {
      const c = text[i]; if (string) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') string = false; }
      else if (c === '"') string = true; else if (c === '{' || c === '[') depth++; else if (c === '}' || c === ']') { if (depth === 0) break; depth--; } else if (c === ',' && depth === 0) break;
    }
    fields.set(key, text.slice(start, i).trim());
  }
  return fields;
}
function desiredProjectRaw(before, source) {
  const b = rawFields(before), s = rawFields(source);
  for (const k of PROJECT_DRAWING_COLUMNS) b.set(k, k === 'cable_layout_settings' ? s.get(k) : JSON.parse(s.get(k)));
  return '{' + [...b].sort(([a], [z]) => a < z ? -1 : a > z ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + v).join(',') + '}';
}
class FakeClient extends EventEmitter {
  constructor(baseline, options = {}) { super(); this.baseline = clone(baseline); this.projectRowText = baseline.projectRowText; this.groups = clone(baseline.groups); this.options = options; this.calls = []; this.writes = 0; this.committed = false; }
  async connect() { this.calls.push({ sql: 'CONNECT' }); }
  async query(sql, parameters) {
    this.calls.push({ sql, parameters });
    if (this.options.emitAt && sql.includes(this.options.emitAt)) this.emit('error', new Error('synthetic-private-secret'));
    if (this.options.throwAt && sql.includes(this.options.throwAt)) throw Object.assign(new Error('synthetic-private-secret'), { code: this.options.databaseCode });
    if (sql.startsWith('BEGIN')) { this.backup = clone(this.groups); this.backupProject = this.projectRowText; this.mode = sql.includes('READ WRITE') ? 'apply' : 'readonly'; }
    if (sql === 'ROLLBACK') { this.groups = clone(this.backup); this.projectRowText = this.backupProject; }
    if (sql === 'COMMIT') { this.committed = true; if (this.options.lostCommitAck) throw new Error('synthetic-private-secret'); }
    const marker = /\/\* pf-tray:([^*]+) \*\//.exec(sql)?.[1];
    let rows = [], rowCount = 0;
    if (marker === 'identity') rows = [{ database: 'wfc_pathfinder_local', address: target.serverAddress, port: 5432, ro: this.mode === 'apply' ? 'off' : 'on', ...this.options.identity }];
    if (marker === 'advisory') rows = [{ locked: this.options.locked ?? true }];
    if (marker === 'project' || marker === 'project-final') rows = [{ rowText: this.projectRowText }];
    if (marker === 'project-desired') rows = [{ rowText: desiredProjectRaw(parameters[0], parameters[1]) }];
    if (marker === 'project-drawing') {
      if (this.projectRowText === parameters[2] && !this.options.projectCasFailure) { this.projectRowText = desiredProjectRaw(parameters[2], parameters[0]); this.writes++; rowCount = 1; }
    }
    if (marker === 'admin') rows = [{ id: actorId, is_admin: this.options.admin ?? true }];
    if (marker === 'model') rows = [this.options.model ?? this.baseline.modelSelection];
    if (marker === 'synthetic') rows = this.options.synthetic ? [{}] : [];
    const [operation, table] = marker?.split(':') ?? [];
    if (operation === 'budget') rows = [{ count: String(this.groups[table].rows.length), bytes: String(this.groups[table].rows.reduce((n, e) => n + Buffer.byteLength(e.rowText), 0)), maxRowBytes: String(Math.max(0, ...this.groups[table].rows.map(e => Buffer.byteLength(e.rowText)))), ...this.options.budget }];
    if (operation === 'group') rows = clone(this.groups[table].rows);
    if (operation === 'desired') {
      const value = { ...JSON.parse(parameters[0]), ...JSON.parse(parameters[1]) }, business = clone(value), expected = JSON.parse(parameters[3]);
      for (const k of parameters[2]) { delete business[k]; if (expected) delete expected[k]; }
      rows = [{ desiredRowText: canonical(value), desiredBusinessRowText: canonical(business), expectedBusinessRowText: canonical(expected) }];
    }
    if (operation === 'insert') {
      const value = { ...JSON.parse(parameters[0]), ...JSON.parse(parameters[1]) }, t = tableSpec(table), entry = { key: t.keyColumns.map(k => value[k]), rowText: canonical(value) };
      assert.ok(!this.groups[table].rows.some(e => canonical(e.key) === canonical(entry.key))); this.groups[table].rows.push(entry); this.writes++; rowCount = 1;
    }
    if (operation === 'cycle' || operation === 'enrich') {
      const value = JSON.parse(parameters[0]), t = tableSpec(table), key = t.keyColumns.map(k => value[k]), index = this.groups[table].rows.findIndex(e => canonical(e.key) === canonical(key));
      const expected = operation === 'cycle' ? canonical({ ...value, ...JSON.parse(parameters[1]) }) : parameters[2];
      if (index >= 0 && this.groups[table].rows[index].rowText === expected) { this.groups[table].rows[index].rowText = canonical(value); this.writes++; rowCount = 1; }
      if (this.options.casFailure === operation) rowCount = 0;
    }
    if (this.options.change) ({ rows, rowCount } = this.options.change({ sql, parameters, marker, rows, rowCount, client: this }) ?? { rows, rowCount });
    return { rows, rowCount };
  }
  async end() { this.ended = true; this.listenerAtEnd = this.listenerCount('error') > 0; if (this.options.endFails) throw new Error('synthetic-private-secret'); }
}
const code = (fn, value) => assert.throws(fn, e => e.code === value);
const execute = async (plan, options = {}, mode = 'apply', client = new FakeClient(plan.baseline, options)) => ({ client, result: await transferDatabase({ mode, target, actorId, plan }, { client }) });

test('pure planner preserves NUMERIC string pairs, null, zero and source raw rowText', () => {
  const f = fixture(), plan = f.plan(); validateTransferPlan(plan);
  assert.equal(plan.rows.filter(r => r.action === 'enrich').length, 50);
  const tray = plan.rows.find(r => r.table === 'trays'), type = plan.rows.find(r => r.table === 'cable_types');
  assert.equal(tray.sourceRowText, f.input.sourceProjection.groups.trays.rows[0].rowText);
  assert.equal(JSON.parse(tray.sourceRowText).width_mm, '9007199254740993.000002');
  assert.equal(JSON.parse(type.sourceRowText).diameter_mm, '9007199254740993.000001');
  assert.equal(JSON.parse(type.sourceRowText).weight_kg_per_m, '0.000');
  assert.equal(JSON.parse(tray.sourceRowText).length_mm, null);
  assert.equal(plan.rows.find(r => r.sourceId === ID(51)).action, 'insert');
  assert.ok(plan.rows.every(r => !r.sourceRowText.includes(target.projectId)));
});

test('baseline is scoped readonly, confirms commit and parses as the exact baseline DTO', async () => {
  const { input } = fixture(), client = new FakeClient(input.targetBaseline), actual = await captureTargetBaseline({ target, actorId }, { client });
  validateTargetBaseline(actual); assert.equal(actual.transaction.commitConfirmed, true); assert.equal(client.writes, 0);
  assert.match(client.calls[1].sql, /REPEATABLE READ READ ONLY/); assert.equal(client.calls.at(-1).sql, 'COMMIT');
  for (const t of TABLES) assert.ok(client.calls.findIndex(c => c.sql.includes('budget:' + t.table)) < client.calls.findIndex(c => c.sql.includes('group:' + t.table)));
});

test('one serializable transaction imports dependency closure, only new nullable cycle rows then CAS enriches exactly fifty types', async () => {
  const { client, result } = await execute(fixture().plan()); assert.equal(result.status, 'PASS'); assert.equal(result.operation, 'transferred');
  assert.equal(result.commitConfirmed, true); assert.match(client.calls[1].sql, /SERIALIZABLE READ WRITE/);
  assert.equal(client.calls.filter(c => c.sql.includes('enrich:')).length, 50); assert.ok(client.calls.some(c => c.sql.includes('cycle:')));
  assert.ok(client.calls.some(c => c.sql.includes('LOCK TABLE') && c.sql.includes('SHARE ROW EXCLUSIVE')));
  assert.ok(client.calls.some(c => c.sql.includes('admin') && c.sql.includes('FOR SHARE')));
  assert.ok(client.calls.every(c => !/\b(DELETE|TRUNCATE|ALTER|DROP)\b/.test(c.sql)));
  assert.equal(client.groups.trays.rows.length, 1); assert.equal(client.groups.cable_types.rows.length, 51);
  for (const t of TABLES) for (const n of t.numericTextColumns) assert.ok(client.calls.filter(c => c.sql.includes('desired:' + t.table)).every(c => c.sql.includes('d."' + n + '"::text')));
});

test('same immutable plan replay and readonly reconciliation make no additional writes', async () => {
  const plan = fixture().plan(), first = await execute(plan), writes = first.client.writes;
  const second = await execute(plan, {}, 'apply', first.client); assert.equal(second.result.operation, 'already_transferred'); assert.equal(first.client.writes, writes);
  const third = await execute(plan, {}, 'verify', first.client); assert.equal(third.result.operation, 'already_transferred'); assert.equal(first.client.writes, writes);
});

test('lost COMMIT acknowledgement is unknown and requires same-plan readonly reconciliation', async () => {
  const plan = fixture().plan(), client = new FakeClient(plan.baseline, { lostCommitAck: true });
  // A COMMIT acknowledgement loss cannot be represented as a rollback of already committed data.
  const original = client.query.bind(client); client.query = async (sql, p) => sql === 'ROLLBACK' && client.committed ? { rows: [] } : original(sql, p);
  const first = await execute(plan, {}, 'apply', client); assert.equal(first.result.status, 'FAIL'); assert.equal(first.result.outcome, 'unknown');
  client.options.lostCommitAck = false; const writes = client.writes, second = await execute(plan, {}, 'verify', client);
  assert.equal(second.result.status, 'PASS'); assert.equal(second.result.operation, 'already_transferred'); assert.equal(client.writes, writes);
});

test('staged files bind new IDs/object keys, byte counts, hashes/readback and owned uploader', async () => {
  const f = fixture({ files: true }), plan = f.plan(); const file = plan.rows.find(r => r.table === 'template_files');
  assert.equal(file.targetId, ID(3000)); assert.equal(file.overrides.uploaded_by, actorId); assert.equal(file.overrides.object_key, f.input.filePlan.entries[0].targetObjectKey);
  const result = await execute(plan); assert.equal(result.result.status, 'PASS');
  assert.equal(JSON.parse(result.client.groups.template_files.rows[0].rowText).uploaded_by, actorId);
  assert.equal(JSON.parse(result.client.groups.template_file_versions.rows[0].rowText).template_id, ID(3000));
});

for (const [name, mutate, expected] of [
  ['number NUMERIC', f => { const e = f.input.sourceProjection.groups.trays.rows[0], r = JSON.parse(e.rowText); r.width_mm = 10; e.rowText = canonical(r); }, 'CATALOG_NUMERIC_TEXT'],
  ['non-minimal seeded fact', f => { const e = f.input.targetBaseline.groups.cable_types.rows[0], r = JSON.parse(e.rowText); r.purpose = 'edited'; e.rowText = canonical(r); }, 'TRANSFER_SEED_TYPE_NOT_MINIMAL'],
  ['missing retained seed', f => { f.input.seedPlan.types.pop(); }, 'TRANSFER_SEED_REQUIRED'],
  ['wrong target endpoint', f => { f.input.targetBaseline.target.port = 5190; }, 'TRANSFER_TARGET_SCOPE'],
  ['unconfirmed baseline', f => { f.input.targetBaseline.transaction.commitConfirmed = false; }, 'TRANSFER_BASELINE_UNCONFIRMED'],
  ['wrong actor', f => { f.input.actorId = ID(777); }, 'TRANSFER_SEED_REQUIRED'],
]) test('planner refuses ' + name, () => { const f = fixture(); mutate(f); code(() => f.plan(), expected); });

for (const [name, mutate, expected] of [
  ['unknown column override', p => { p.rows[0].overrides.secret = 'bad'; }, 'TRANSFER_PLAN_MAPPING'],
  ['business override', p => { p.rows[0].overrides.purpose = 'bad'; }, 'TRANSFER_OVERRIDE_SCOPE'],
  ['duplicate source row', p => { p.rows.push(clone(p.rows[0])); }, 'TRANSFER_MAPPING_DUPLICATE'],
  ['missing foreign mapping', p => { p.rows.find(r => r.table === 'trays').overrides.grounding_cable_type_id = ID(777); }, 'TRANSFER_FOREIGN_KEY_MAPPING'],
  ['seed-map duplicate', p => { p.seed.types[1] = clone(p.seed.types[0]); }, 'TRANSFER_ENRICH_SCOPE'],
  ['forged non-minimal expected seed', p => { const r = p.rows.find(r => r.action === 'enrich'), value = JSON.parse(r.targetExpectedRowText); value.diameter_mm = '1'; r.targetExpectedRowText = canonical(value); }, 'TRANSFER_SEED_TYPE_NOT_MINIMAL'],
  ['manifest hash', p => { p.filePlan.manifestSha256 = 'f'.repeat(64); }, 'TRANSFER_FILE_MANIFEST_HASH'],
]) test('strict child plan validation refuses ' + name, () => { const p = fixture().plan(); mutate(p); code(() => validateTransferPlan(p), expected); });

for (const [name, options, expected] of [
  ['foreign database', { identity: { database: 'wfc_app' } }, 'TRANSFER_SQL_IDENTITY'],
  ['original database address', { identity: { address: '172.17.0.2' } }, 'TRANSFER_SQL_IDENTITY'],
  ['readonly identity mismatch', { identity: { ro: 'on' } }, 'TRANSFER_SQL_IDENTITY'],
  ['admin revoked', { admin: false }, 'TRANSFER_ADMIN_REQUIRED'],
  ['project lock busy', { locked: false }, 'TRANSFER_BUSY'],
  ['synthetic marker', { synthetic: true }, 'TRANSFER_SYNTHETIC_PROJECT_REFUSED'],
  ['active model changed', { model: { ...modelSelection(), active_model_version_id: ID(777) } }, 'TRANSFER_MODEL_CHANGED'],
  ['pre-transfer count budget', { budget: { count: '100001' } }, 'TRANSFER_TARGET_PRETRANSFER_BUDGET'],
  ['pre-transfer bytes budget', { budget: { bytes: String(TRANSFER_LIMITS.outputBytes + 1) } }, 'TRANSFER_TARGET_PRETRANSFER_BUDGET'],
  ['CAS failure', { casFailure: 'enrich' }, 'TRANSFER_ENRICH_CAS'],
  ['transport error', { emitAt: 'desired:trays' }, 'TRANSFER_CONNECTION_LOST'],
]) test('transaction refuses ' + name + ' and rolls back without leaking private errors', async () => {
  const plan = fixture().plan(), { client, result } = await execute(plan, options); assert.equal(result.status, 'FAIL'); assert.equal(result.error, expected); assert.equal(result.outcome, 'not_committed');
  assert.deepEqual(client.groups, plan.baseline.groups); assert.ok(client.calls.some(c => c.sql === 'ROLLBACK')); assert.ok(!JSON.stringify(result).includes('synthetic-private-secret'));
});

test('changed or partial target refuses atomically, including unrelated global changes', async () => {
  const plan = fixture().plan(), client = new FakeClient(plan.baseline); client.groups.material_cable_installation_materials.rows.push(row('material_cable_installation_materials', ID(800), { type: 'Unrelated edit' }));
  const { result } = await execute(plan, {}, 'apply', client); assert.equal(result.error, 'TRANSFER_PARTIAL_OR_CHANGED_TARGET'); assert.equal(client.writes, 0);
});

test('readonly verify before final state does not try to repair it', async () => {
  const { client, result } = await execute(fixture().plan(), {}, 'verify'); assert.equal(result.error, 'TRANSFER_VERIFY_NOT_FINAL'); assert.equal(client.writes, 0);
});

test('global unique-name reuse preserves target metadata only when all mapped business facts are exact', async () => {
  const f = fixture(), source = JSON.parse(f.input.sourceProjection.groups.material_load_curves.rows[0].rowText);
  // Parent tray map is not known yet, so use exact same name but mismatched business identity: refuse, never overwrite.
  f.input.targetBaseline.groups.material_load_curves.rows.push(row('material_load_curves', ID(880), { name: source.name, tray_id: null }));
  f.input.targetBaseline.groups.material_load_curve_points.rows.push(row('material_load_curve_points', ID(881), { load_curve_id: ID(880), point_order: 0, span_m: '1.00000000000000000000001', load_kn_per_m: '0' }));
  const plan = f.plan(); assert.equal(plan.rows.find(r => r.table === 'material_load_curves').action, 'reuse');
  const { client, result } = await execute(plan); assert.equal(result.error, 'TRANSFER_GLOBAL_COLLISION'); assert.equal(client.writes, 0);
});

test('exact global reuse retains existing global identity and timestamps without updating it', async () => {
  const f = fixture(), sourceEntry = f.input.sourceProjection.groups.material_load_curves.rows[0], source = JSON.parse(sourceEntry.rowText);
  source.tray_id = null; sourceEntry.rowText = canonical(source);
  const retained = row('material_load_curves', ID(880), { name: source.name, tray_id: null, created_at: '2020-01-01 00:00:00+00', updated_at: '2020-01-02 00:00:00+00' });
  f.input.targetBaseline.groups.material_load_curves.rows.push(retained);
  f.input.targetBaseline.groups.material_load_curve_points.rows.push(row('material_load_curve_points', ID(881), { load_curve_id: ID(880), point_order: 0, span_m: '1.00000000000000000000001', load_kn_per_m: '0' }));
  const p = f.plan(), entry = p.rows.find(r => r.table === 'material_load_curves'); assert.equal(entry.action, 'reuse'); assert.equal(entry.targetId, ID(880));
  const { client, result } = await execute(p); assert.equal(result.status, 'PASS');
  assert.equal(client.groups.material_load_curves.rows[0].rowText, retained.rowText); assert.ok(!client.calls.some(c => c.sql.includes('insert:material_load_curves')));
});

test('existing names with different spelling or business facts refuse rather than overwrite global records', async () => {
  const f = fixture(), source = JSON.parse(f.input.sourceProjection.groups.material_load_curves.rows[0].rowText);
  f.input.targetBaseline.groups.material_load_curves.rows.push(row('material_load_curves', ID(880), { name: source.name.toUpperCase(), tray_id: null }));
  f.input.targetBaseline.groups.material_load_curve_points.rows.push(row('material_load_curve_points', ID(881), { load_curve_id: ID(880), point_order: 0, span_m: '1.00000000000000000000001', load_kn_per_m: '0' }));
  const { client, result } = await execute(f.plan()); assert.equal(result.error, 'TRANSFER_GLOBAL_COLLISION'); assert.equal(client.writes, 0);
});

test('reusing a shared global parent cannot insert defaults or points beneath it', () => {
  const f = fixture(), source = JSON.parse(f.input.sourceProjection.groups.material_load_curves.rows[0].rowText);
  f.input.targetBaseline.groups.material_load_curves.rows.push(row('material_load_curves', ID(880), { name: source.name, tray_id: null }));
  code(() => f.plan(), 'TRANSFER_GLOBAL_CHILD_CLOSURE');
});

test('shared global parent child closure also refuses extra existing children', () => {
  const f = fixture(), sourceEntry = f.input.sourceProjection.groups.material_load_curves.rows[0], source = JSON.parse(sourceEntry.rowText); source.tray_id = null; sourceEntry.rowText = canonical(source);
  f.input.targetBaseline.groups.material_load_curves.rows.push(row('material_load_curves', ID(880), { name: source.name, tray_id: null }));
  f.input.targetBaseline.groups.material_load_curve_points.rows.push(row('material_load_curve_points', ID(881), { load_curve_id: ID(880), point_order: 0, span_m: '1.00000000000000000000001', load_kn_per_m: '0' }));
  f.input.targetBaseline.groups.material_load_curve_points.rows.push(row('material_load_curve_points', ID(882), { load_curve_id: ID(880), point_order: 1, span_m: '2', load_kn_per_m: '1' }));
  code(() => f.plan(), 'TRANSFER_GLOBAL_CHILD_CLOSURE');
});

test('known existing global UUID can be reused only after exact server business equality', async () => {
  const f = fixture(), existing = clone(f.input.sourceProjection.groups.material_cable_types.rows[0]);
  f.input.targetBaseline.groups.material_cable_types.rows.push(existing);
  const p = f.plan(), r = p.rows.find(r => r.table === 'material_cable_types'); assert.equal(r.action, 'reuse'); assert.equal(r.targetId, ID(100));
  const { client, result } = await execute(p); assert.equal(result.status, 'PASS'); assert.equal(client.groups.material_cable_types.rows.length, 1);
});

test('duplicate freshly allocated IDs refuse during pure planning', () => {
  const f = fixture(); code(() => createTransferPlan(f.input, { makeUuid: () => ID(5555) }), 'TRANSFER_UUID_COLLISION');
});

test('postwrite fidelity failure rolls back every inserted/enriched row', async () => {
  const p = fixture().plan(); let firstPostread = true;
  const { client, result } = await execute(p, { change: ({ marker, rows, rowCount, client }) => {
    if (marker === 'group:trays' && client.writes > 0 && firstPostread) { firstPostread = false; return { rows: [], rowCount }; }
    return { rows, rowCount };
  } });
  assert.equal(result.error, 'TRANSFER_FINAL_FIDELITY'); assert.deepEqual(client.groups, p.baseline.groups);
});

test('BEGIN and close failures remain failures with bounded safe output', async () => {
  const p = fixture().plan(), begin = await execute(p, { throwAt: 'BEGIN' }); assert.equal(begin.result.status, 'FAIL'); assert.ok(begin.client.calls.some(c => c.sql === 'ROLLBACK'));
  const close = await execute(p, { endFails: true }); assert.equal(close.result.status, 'FAIL'); assert.equal(close.result.outcome, 'committed'); assert.equal(close.result.error, 'TRANSFER_CLOSE_FAILED');
  assert.ok(!JSON.stringify(close.result).includes('synthetic-private-secret'));
});

test('file readback/hash/key mutation refuses before target construction', () => {
  const f = fixture({ files: true }), p = f.plan(); p.filePlan.entries[0].readbackSha256 = 'f'.repeat(64);
  p.filePlan.manifestSha256 = sha256(canonical({ owner: p.filePlan.owner, prefix: p.filePlan.prefix, entries: p.filePlan.entries }));
  code(() => validateTransferPlan(p), 'TRANSFER_FILE_IDENTITY');
});

test('fixed helper installs bounded watchdog before imports and consumes guarded packet input, never arbitrary identifiers', () => {
  const program = buildTransferProgram(); assert.ok(program.indexOf('setTimeout') < program.indexOf("import('node:crypto')"));
  assert.ok(program.includes('globalThis.__wfcPfR1Input')); assert.ok(!program.includes('for await(const c of process.stdin)'));
  assert.equal(TRANSFER_LIMITS.childMilliseconds, 35000); assert.equal(TRANSFER_LIMITS.hostMilliseconds, 45000);
  assert.equal(TRANSFER_LIMITS.outputBytes, 64 * 1024 ** 2); assert.equal(TRANSFER_LIMITS.planBytes, 80 * 1024 ** 2);
});

test('drawing project scope forwards exact raw source and before projection without JS numeric reconstruction', () => {
  const f = fixture(), p = f.plan(); assert.deepEqual(p.projectDrawing.columns, PROJECT_DRAWING_COLUMNS);
  assert.equal(p.projectDrawing.sourceRowText, f.input.sourceProjection.project.rowText);
  assert.equal(p.projectDrawing.targetExpectedRowText, f.input.targetBaseline.projectRowText);
});

for (const column of PROJECT_DRAWING_COLUMNS) test('drawing preparation refuses non-NULL initial ' + column, () => {
  const f = fixture(), b = JSON.parse(f.input.targetBaseline.projectRowText); b[column] = column === 'cable_layout_settings' ? {} : '0'; f.input.targetBaseline.projectRowText = canonical(b);
  code(() => f.plan(), 'TRANSFER_PROJECT_DRAWING_NOT_INITIAL_NULL');
});

for (const column of PROJECT_DRAWING_COLUMNS) test('drawing preparation refuses missing source ' + column, () => {
  const f = fixture(), s = JSON.parse(f.input.sourceProjection.project.rowText); s[column] = null; f.input.sourceProjection.project.rowText = canonical(s);
  code(() => f.plan(), 'TRANSFER_PROJECT_DRAWING_SOURCE_VALUE');
});

for (const [name, mutate, expected] of [
  ['engineering setting in whitelist', p => { p.projectDrawing.columns.push('secondary_tray_length'); }, 'TRANSFER_PROJECT_DRAWING_SCOPE'],
  ['timestamp in whitelist', p => { p.projectDrawing.columns[0] = 'updated_at'; }, 'TRANSFER_PROJECT_DRAWING_SCOPE'],
  ['missing allowed column', p => { p.projectDrawing.columns.pop(); }, 'TRANSFER_PROJECT_DRAWING_SCOPE'],
  ['extra mutable drawing property', p => { p.projectDrawing.overrides = {}; }, 'TRANSFER_PROJECT_DRAWING_SCOPE'],
  ['other project identity', p => { const s = JSON.parse(p.projectDrawing.sourceRowText); s.id = ID(999); p.projectDrawing.sourceRowText = canonical(s); }, 'TRANSFER_PROJECT_DRAWING_SOURCE'],
  ['unexpected source key', p => { const s = JSON.parse(p.projectDrawing.sourceRowText); s.customer = 'bad'; p.projectDrawing.sourceRowText = canonical(s); }, 'TRANSFER_PROJECT_DRAWING_SOURCE'],
  ['changed full before row', p => { const b = JSON.parse(p.projectDrawing.targetExpectedRowText); b.customer = 'bad'; p.projectDrawing.targetExpectedRowText = canonical(b); }, 'TRANSFER_PROJECT_DRAWING_SCOPE'],
  ['array settings', p => { const s = JSON.parse(p.projectDrawing.sourceRowText); s.cable_layout_settings = []; p.projectDrawing.sourceRowText = canonical(s); }, 'TRANSFER_PROJECT_DRAWING_SOURCE_VALUE'],
  ['NaN drawing NUMERIC', p => { const s = JSON.parse(p.projectDrawing.sourceRowText); s.support_distance = 'NaN'; p.projectDrawing.sourceRowText = canonical(s); }, 'TRANSFER_PROJECT_DRAWING_SOURCE_VALUE'],
  ['Infinity drawing NUMERIC', p => { const s = JSON.parse(p.projectDrawing.sourceRowText); s.support_weight = 'Infinity'; p.projectDrawing.sourceRowText = canonical(s); }, 'TRANSFER_PROJECT_DRAWING_SOURCE_VALUE'],
  ['number drawing NUMERIC', p => { const s = JSON.parse(p.projectDrawing.sourceRowText); s.tray_load_safety_factor = 1; p.projectDrawing.sourceRowText = canonical(s); }, 'TRANSFER_PROJECT_DRAWING_SOURCE_VALUE'],
]) test('drawing child strict validation refuses ' + name, () => { const p = clone(fixture().plan()); mutate(p); code(() => validateTransferPlan(p), expected); });

test('drawing typed raw-source projection retains precision, zero and nested JSON numeric tokens', async () => {
  const f = fixture();
  f.input.sourceProjection.project.rowText = f.input.sourceProjection.project.rowText.replace('"maximumRows":3', '"maximumRows":3,"syntheticLargeDecimal":9007199254740993.000001');
  const p = f.plan(), { client, result } = await execute(p); assert.equal(result.status, 'PASS');
  const fields = rawFields(client.projectRowText); assert.equal(fields.get('support_distance'), '9007199254740993.000001'); assert.equal(fields.get('support_weight'), '0.000');
  assert.ok(fields.get('cable_layout_settings').includes('9007199254740993.000001'));
  const desired = client.calls.find(c => c.sql.includes('project-desired')); assert.equal(desired.parameters[1], p.projectDrawing.sourceRowText);
  assert.match(desired.sql, /jsonb_populate_record\(NULL::projects,\$2::jsonb\)/);
});

test('drawing update changes only four fields and preserves project identity/customer/engineering allowances/model/timestamps', async () => {
  const p = fixture().plan(), before = rawFields(p.baseline.projectRowText), { client, result } = await execute(p); assert.equal(result.status, 'PASS');
  const after = rawFields(client.projectRowText);
  for (const [key, value] of before) if (!PROJECT_DRAWING_COLUMNS.includes(key)) assert.equal(after.get(key), value, key);
  assert.deepEqual(client.baseline.modelSelection, p.baseline.modelSelection);
  const update = client.calls.find(c => c.sql.includes('project-drawing')), set = update.sql.split(' SET ')[1].split(' FROM ')[0];
  assert.deepEqual([...set.matchAll(/"([a-z_]+)"=s\./g)].map(m => m[1]), PROJECT_DRAWING_COLUMNS);
  assert.ok(!set.includes('updated_at')); assert.ok(!set.includes('secondary_tray_length')); assert.ok(!set.includes('connection_gap'));
});

test('drawing write follows dependency rows, then checks full project before committing', async () => {
  const { client, result } = await execute(fixture().plan()); assert.equal(result.status, 'PASS');
  const lastDependency = Math.max(...client.calls.flatMap((c, i) => /pf-tray:(?:insert|enrich|cycle):/.test(c.sql) ? [i] : []));
  const drawing = client.calls.findIndex(c => c.sql.includes('pf-tray:project-drawing')), fidelity = client.calls.findIndex(c => c.sql.includes('pf-tray:project-final'));
  assert.ok(lastDependency < drawing && drawing < fidelity && fidelity < client.calls.findIndex(c => c.sql === 'COMMIT'));
});

test('drawing full-row CAS failure rolls back project and every catalog write atomically', async () => {
  const p = fixture().plan(), { client, result } = await execute(p, { projectCasFailure: true }); assert.equal(result.error, 'TRANSFER_PROJECT_DRAWING_CAS');
  assert.deepEqual(client.groups, p.baseline.groups); assert.equal(client.projectRowText, p.baseline.projectRowText); assert.equal(result.outcome, 'not_committed');
});

test('drawing full-project fidelity refuses a timestamp side effect and rolls back', async () => {
  const p = fixture().plan(), { client, result } = await execute(p, { change: ({ marker, rows, rowCount }) => {
    if (marker === 'project-final') return { rows: [{ rowText: rows[0].rowText.replace(date, '2026-10-20 00:00:00+00') }], rowCount };
    return { rows, rowCount };
  } }); assert.equal(result.error, 'TRANSFER_PROJECT_DRAWING_FIDELITY'); assert.deepEqual(client.groups, p.baseline.groups); assert.equal(client.projectRowText, p.baseline.projectRowText);
});

test('drawing final values with baseline catalog are refused as partial state', async () => {
  const p = fixture().plan(), client = new FakeClient(p.baseline); client.projectRowText = desiredProjectRaw(p.baseline.projectRowText, p.projectDrawing.sourceRowText);
  const { result } = await execute(p, {}, 'apply', client); assert.equal(result.error, 'TRANSFER_PARTIAL_OR_CHANGED_TARGET'); assert.equal(client.writes, 0);
});

test('drawing baseline values with final catalog are refused as partial state', async () => {
  const p = fixture().plan(), first = await execute(p); first.client.projectRowText = p.baseline.projectRowText; const writes = first.client.writes;
  const { result } = await execute(p, {}, 'apply', first.client); assert.equal(result.error, 'TRANSFER_PARTIAL_OR_CHANGED_TARGET'); assert.equal(first.client.writes, writes);
});

test('drawing replay is permitted only with complete final project and catalog', async () => {
  const p = fixture().plan(), first = await execute(p), writes = first.client.writes; const finalProject = first.client.projectRowText;
  const replay = await execute(p, {}, 'verify', first.client); assert.equal(replay.result.status, 'PASS'); assert.equal(replay.result.operation, 'already_transferred');
  assert.equal(first.client.writes, writes); assert.equal(first.client.projectRowText, finalProject); assert.deepEqual(replay.result.projectDrawing.columns, PROJECT_DRAWING_COLUMNS);
});

test('drawing/current admin is checked before deriving or writing any project values', async () => {
  const p = fixture().plan(), { client, result } = await execute(p, { admin: false }); assert.equal(result.error, 'TRANSFER_ADMIN_REQUIRED');
  assert.ok(!client.calls.some(c => c.sql.includes('project-desired') || c.sql.includes('project-drawing'))); assert.equal(client.writes, 0);
});

test('drawing project full-row stale edit to unrelated field refuses before any mutation', async () => {
  const p = fixture().plan(), client = new FakeClient(p.baseline); client.projectRowText = client.projectRowText.replace('Synthetic customer', 'Synthetic later manual edit');
  const { result } = await execute(p, {}, 'apply', client); assert.equal(result.error, 'TRANSFER_PROJECT_OR_MODEL_STALE'); assert.equal(client.writes, 0);
});

test('INSERT desired comparison binds an empty object instead of scalar JSON null', async () => {
  const p = fixture().plan(), { client, result } = await execute(p); assert.equal(result.status, 'PASS');
  for (const r of p.rows) {
    const c = client.calls.find(c => c.sql.includes('pf-tray:desired:' + r.table) && c.parameters[0] === r.sourceRowText);
    assert.equal(c.parameters[3], r.action === 'insert' ? '{}' : r.targetExpectedRowText);
    assert.notEqual(c.parameters[3], 'null');
  }
});

test('database failure exposes only safe SQLSTATE and fixed failing statement tag, retaining it across rollback', async () => {
  const p = fixture().plan(), { result } = await execute(p, { throwAt: 'desired:trays', databaseCode: '22023' });
  assert.equal(result.databaseCode, '22023'); assert.equal(result.statementTag, 'desired:trays'); assert.equal(result.rollbackConfirmed, true);
  assert.equal(result.writesAttempted, false); assert.equal(result.outcome, 'not_committed'); assert.ok(!JSON.stringify(result).includes('synthetic-private-secret'));
});

test('database failure omits unsafe codes and raw SQL/error values', async () => {
  const p = fixture().plan(), { result } = await execute(p, { throwAt: 'desired:trays', databaseCode: 'synthetic-private-secret' });
  assert.equal(result.databaseCode, undefined); assert.equal(result.statementTag, 'desired:trays');
  assert.ok(!JSON.stringify(result).includes('jsonb_populate_record')); assert.ok(!JSON.stringify(result).includes('synthetic-private-secret'));
});
