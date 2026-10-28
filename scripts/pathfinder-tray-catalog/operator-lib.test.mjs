import test from 'node:test';
import assert from 'node:assert/strict';
import { TABLES, EXPECTED, PROJECT_COLUMNS, sourceProjectionHashes } from './source-lib.mjs';
import { validatePlanInputs, validateFileIntent } from './operator-lib.mjs';

function fixture() {
  const p = Object.fromEntries(PROJECT_COLUMNS.map(k => [k, null])); p.id = EXPECTED.projectId; p.name = EXPECTED.projectName; p.project_number = EXPECTED.projectNumber;
  const source = { schemaVersion: 'wfc.pf.catalog-copy-projection.v1', project: { id: p.id, name: p.name, projectNumber: p.project_number, rowText: JSON.stringify(p) }, groups: Object.fromEntries(TABLES.map(t => [t.table, { keyColumns: t.keyColumns, columns: t.columns, numericTextColumns: t.numericTextColumns, rows: [] }])), files: [], source: { backendId: EXPECTED.backend.id, postgresId: EXPECTED.postgres.id, revision: EXPECTED.revision, databaseHost: EXPECTED.endpoint.host, databasePort: EXPECTED.endpoint.port, database: EXPECTED.endpoint.database }, transaction: { database: 'wfc_app', serverAddress: '172.17.0.2', serverPort: 5432, readOnly: 'on', defaultReadOnly: 'on', isolation: 'repeatable read', snapshot: '1:1:', capturedAt: '2026-10-18T21:00:00Z', phase: 'copy' } };
  const tray = Object.fromEntries(TABLES[0].columns.map(k => [k, null])); Object.assign(tray, { id: '12345678-1234-1234-1234-123456789012', project_id: p.id, name: 'T1', change_log: [], include_grounding_cable: false, use_trefoil_clamps: false, created_at: '2026-10-18T21:00:00Z', updated_at: '2026-10-18T21:00:00Z' });
  const entry = { key: [tray.id], rowText: JSON.stringify(tray) }; source.groups.trays.rows = [entry];
  const sourceRef = { path: 'private/source', bytes: 100, sha256: 'a'.repeat(64) }, seedRef = { path: 'private/seed', bytes: 200, sha256: 'b'.repeat(64) }, seed = { types: [{ sourceId: 'old', id: 'new', name: 'type' }] };
  const plan = { source: { ref: sourceRef, projectionSha256: sourceProjectionHashes(source).sha256 }, seed: { ref: seedRef, types: structuredClone(seed.types) }, rows: [{ table: 'trays', sourceKey: entry.key, sourceRowText: entry.rowText }] };
  plan.baseline = { projectRowText: '{"id":"target","support_distance":null}' };
  plan.projectDrawing = { columns: ['support_distance', 'support_weight', 'tray_load_safety_factor', 'cable_layout_settings'], sourceRowText: source.project.rowText, targetExpectedRowText: plan.baseline.projectRowText };
  return { source, sourceRef, seedRef, seed, plan };
}
test('operator independently binds the complete plan source rows, source refs and retained seed map', () => {
  const f = fixture(); assert.equal(validatePlanInputs(f.plan, f.source, f.sourceRef, f.seed, f.seedRef), f.plan);
});
test('omitted, extra or modified source rows cannot hide behind an unchanged source digest', () => {
  for (const mutate of [p => { p.rows = []; }, p => { p.rows.push(structuredClone(p.rows[0])); }, p => { p.rows[0].sourceRowText += ' '; }, p => { p.rows.push({ table: 'unknown', sourceKey: ['x'], sourceRowText: '{}' }); }]) {
    const f = fixture(); mutate(f.plan); assert.throws(() => validatePlanInputs(f.plan, f.source, f.sourceRef, f.seed, f.seedRef), /SOURCE_ROWS|EXTRA_TABLE/);
  }
});
test('source/seed reference substitutions and changed retained UUID mappings refuse execution', () => {
  for (const mutate of [p => { p.source.ref.path = 'elsewhere'; }, p => { p.seed.ref.bytes++; }, p => { p.seed.types[0].id = 'other'; }, p => { p.source.projectionSha256 = '0'.repeat(64); }]) {
    const f = fixture(); f.plan = structuredClone(f.plan); mutate(f.plan); assert.throws(() => validatePlanInputs(f.plan, f.source, f.sourceRef, f.seed, f.seedRef));
  }
});
test('staged intent must exactly match committed manifest keys, identities, bytes and hashes', () => {
  const entry = { table: 'project_files', sourceId: 'a', targetId: 'b', sourceObjectKey: 'old', targetObjectKey: 'owned/b', bytes: 9, sha256: 'a'.repeat(64) }, intent = { owner: 'owner', prefix: 'owned/', entries: [entry] }, manifest = structuredClone(intent);
  assert.equal(validateFileIntent(intent, manifest, 'owner'), intent);
  for (const key of ['table', 'sourceId', 'targetId', 'sourceObjectKey', 'targetObjectKey', 'bytes', 'sha256']) { const changed = structuredClone(intent); changed.entries[0][key] = key === 'bytes' ? 10 : 'changed'; assert.throws(() => validateFileIntent(changed, manifest, 'owner')); }
});
test('project drawing enrichment cannot substitute source, baseline or engineering columns', () => {
  for (const mutate of [p => { p.projectDrawing.sourceRowText += ' '; }, p => { p.projectDrawing.targetExpectedRowText = '{}'; }, p => { p.projectDrawing.columns.push('secondary_tray_length'); }]) {
    const f = fixture(); mutate(f.plan); assert.throws(() => validatePlanInputs(f.plan, f.source, f.sourceRef, f.seed, f.seedRef), /PROJECT_DRAWING/);
  }
});
