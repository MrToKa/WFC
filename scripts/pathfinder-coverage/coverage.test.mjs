import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { runAudit, safePath } from './audit.mjs';
import { retainedManifest } from './retained.mjs';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const scratch = path.join(sourceRoot, 'pathfinder-engine', '.scratch', `coverage-controls-${randomUUID()}`);
await fs.mkdir(scratch, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const project = '11111111-1111-4111-8111-111111111111', model = '22222222-2222-4222-8222-222222222222', artifact = '33333333-3333-4333-8333-333333333333', location = '44444444-4444-4444-8444-444444444444', cable = '55555555-5555-4555-8555-555555555555';
const fingerprint = 'a'.repeat(64);
const bounds = { minimum: [0, 0, 0], maximum: [1, 1, 1] };
const rawObject = (id, parent, name, fragments = []) => ({ id: `dbid:${id}`, dbId: id, parentId: parent === null ? null : `dbid:${parent}`, name, childCount: id === 1 ? 2 : 0, externalIds: [`ext-${id}`], fragmentIds: fragments, nativeHidden: null, planningVisibilityEvidence: 'Display visibility is not native visibility.', displayHidden: false, displayOff: false });
const selectedObject = (id, name, role, fragments = []) => ({ id: `dbid:${id}`, parentId: id === 1 ? null : 'dbid:1', externalId: `ext-${id}`, dbId: id, name, geometryRole: role, leafToRootNames: id === 1 ? [name] : [name, 'Root'], properties: [], nativeHidden: false, planningExcluded: false, categoryAssignmentSource: role === 'routing-leaf' ? 'explicit-planning' : 'unassigned', allowedCategories: role === 'routing-leaf' ? ['Control'] : [], bounds, fragments });

async function fixture(mutate = () => {}) {
  const root = path.join(scratch, randomUUID()); await fs.mkdir(path.join(root, 'input'), { recursive: true }); await fs.mkdir(path.join(root, 'code')); await fs.mkdir(path.join(root, 'out'));
  const part = { schemaVersion: 'pathfinder.converted.inventory-part.v1', captureId: 'test-capture', offset: 0, objects: [rawObject(1, null, 'Root'), rawObject(2, 1, 'Leaf /001', [0]), rawObject(3, 1, 'Equipment /002', [1])] };
  const receipt = { schemaVersion: 'pathfinder.converted.inventory.v1', captureId: 'test-capture', inventoryComplete: true, geometryComplete: false, propertiesComplete: false, objectCount: 3, sdkFragmentCount: 2, fragmentAssociations: 2, externalIdentityObjectCount: 3,
    package: { packageId: artifact, contentFingerprint: fingerprint, packageSha256: 'b'.repeat(64), source: { sha256: 'c'.repeat(64) } },
    metadata: { distanceUnit: 'm', metresPerDisplayUnit: 1, upVector: [0, 0, 1], globalOffsetMetres: [0, 0, 0], displayToWorldMetres: identity, sourceToWorldMetres: identity, placementTransform: identity, modelTransform: null }, parts: [] };
  const fragment = id => ({ id: `fragment:${id}`, vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangleIndices: [0, 1, 2], fragmentToWorldMetres: identity, transformAlreadyApplied: true });
  const snapshot = { schemaVersion: 'pathfinder.model.snapshot.v1', model: { projectId: project, modelVersionId: model, contentSha256: fingerprint },
    coordinates: { vertexFrame: 'canonical-world-metres', sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: identity, globalOffsetMetres: [0, 0, 0], displayToWorldMetres: identity },
    capture: { adapterVersion: 'fixture-only', sourceKind: 'converted', inventoryComplete: true, geometryComplete: false, unitsVerified: false, transformsVerified: false, planningVisibilityKnown: true, sourceLinkVerified: false, evidenceSha256: [] },
    objects: [selectedObject(1, 'Root', 'hierarchy'), { ...selectedObject(2, 'Leaf /001', 'routing-leaf', [fragment(0)]), routeBoundaryId: 'dbid:1' }, selectedObject(3, 'Equipment /002', 'object', [fragment(1)])] };
  const metadata = { schemaVersion: 'pathfinder.coverage.retained-metadata.v1', cables: [{ id: cable, project_id: project, from_location: ' qa-001 ', to_location: 'QA-001', mto: 'Control' }], locations: [{ id: location, project_id: project, name: 'QA-001', revision: '1' }], aliases: [{ project_id: project, normalized_alias: 'QA-001', display_alias: 'QA-001', location_id: location }],
    bindings: [{ project_id: project, location_id: location, model_version_id: model, artifact_id: artifact, revision: '1', point: [2, 3, 4], object_id: null, external_id: null, source: 'manual', derivation: 'manual-world-point', coordinate_frame: 'canonical-world-metres', confirmed_at: '2026-10-18T00:00:00Z' }], selection: [{ project_id: project, active_model_version_id: model, selection_revision: '1', content_fingerprint: fingerprint, state: 'ready', health: 'healthy' }] };
  await mutate({ part, receipt, snapshot, metadata });
  const write = async (relative, value) => { const bytes = Buffer.from(JSON.stringify(value)); await fs.writeFile(path.join(root, relative), bytes); return { path: relative, sha256: hash(bytes) }; };
  const partInput = await write('input/test-capture-0000.json', part); receipt.parts = [{ name: 'test-capture-0000.json', bytes: (await fs.stat(path.join(root, partInput.path))).size, sha256: partInput.sha256 }];
  const manifest = { schemaVersion: 'pathfinder.coverage.input.v1', label: 'Isolated integrity control', inventory: await write('input/receipt.json', receipt), snapshot: { ...await write('input/snapshot.json', snapshot), artifactId: artifact, projectId: project, modelVersionId: model, contentSha256: fingerprint }, metadata: await write('input/metadata.json', metadata), productionMatching: { ...retainedManifest.productionMatching, path: 'code/matching.js', errorsPath: 'code/errors.js' } };
  await fs.copyFile(path.join(sourceRoot, retainedManifest.productionMatching.path), path.join(root, 'code/matching.js')); await fs.copyFile(path.join(sourceRoot, retainedManifest.productionMatching.errorsPath), path.join(root, 'code/errors.js'));
  return { root, manifest, receipt, part, snapshot, metadata };
}

async function audit(f, expected = null) {
  const output = 'out/receipt.json', result = await runAudit({ root: f.root, manifest: f.manifest, output });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root, output), 'utf8')), result, 'Detailed receipt must exist before the caller assesses failure.');
  if (expected) { assert.equal(result.status, 'FAIL'); assert.equal(result.failure.code, expected); }
  else { assert.equal(result.status, 'PASS_WITH_GAPS', JSON.stringify(result.failure)); assert.equal(result.technicalIntegrity, 'PASS'); }
  return result;
}

test('valid small hierarchy joins exact mesh/identities; manual point resolves absent name and both ends reuse one location', async () => {
  const f = await fixture(), before = await fs.readFile(path.join(f.root, 'input/snapshot.json')), r = await audit(f);
  assert.equal(r.inventory.objects, 3); assert.equal(r.hierarchy.maximumDepth, 2); assert.equal(r.selected.roles['routing-leaf'], 1);
  assert.equal(r.endpoints.endpoints[0].rawInventoryName.status, 'missing'); assert.equal(r.endpoints.endpoints[0].recordedRegistry.status, 'matched');
  assert.equal(r.endpoints.endpoints[0].recordedRegistry.source, 'manual'); assert.equal(r.endpoints.repeatedEndpointKeys.length, 1); assert.equal(r.endpoints.repeatedEndpointKeys[0].sameRecordedLocation, true);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'input/snapshot.json')), before); assert.equal(r.engineeringAcceptance, 'NOT_PERFORMED_USER_REVIEW_REQUIRED');
});

for (const [label, mutate, code] of [
  ['offset discontinuity', f => { f.part.offset = 1; }, 'PART_OFFSET_OR_SCHEMA'],
  ['duplicate IDs', f => { f.part.objects[2] = structuredClone(f.part.objects[1]); }, 'DUPLICATE_OBJECT_ID'],
  ['orphan parent', f => { f.part.objects[2].parentId = 'dbid:99'; }, 'ORPHAN_OBJECT'],
  ['cycle even when another root exists', f => { f.part.objects[0].childCount = 0; f.part.objects[1].parentId = 'dbid:3'; f.part.objects[1].childCount = 1; f.part.objects[2].parentId = 'dbid:2'; f.part.objects[2].childCount = 1; }, 'HIERARCHY_CYCLE'],
  ['child count mismatch', f => { f.part.objects[0].childCount = 1; }, 'CHILD_COUNT_MISMATCH'],
  ['out of range fragment', f => { f.part.objects[2].fragmentIds = [2]; }, 'FRAGMENT_RANGE'],
  ['fragment associated twice', f => { f.part.objects[2].fragmentIds = [0]; }, 'DUPLICATE_FRAGMENT'],
  ['incorrect declared total', f => { f.receipt.objectCount = 4; }, 'INVENTORY_COUNT_MISMATCH'],
  ['selected cross-model identity', f => { f.snapshot.model.modelVersionId = artifact; }, 'SNAPSHOT_IDENTITY'],
  ['selected name drift', f => { f.snapshot.objects[1].name += ' drift'; }, 'SELECTED_IDENTITY_JOIN'],
  ['selected external identity drift', f => { f.snapshot.objects[1].externalId = 'wrong'; }, 'SELECTED_EXTERNAL_JOIN'],
  ['selected ancestry drift', f => { f.snapshot.objects[1].leafToRootNames[1] = 'other'; }, 'SELECTED_ANCESTOR_NAMES'],
  ['route boundary outside ancestor chain', f => { f.snapshot.objects[1].routeBoundaryId = 'dbid:3'; }, 'ROUTE_BOUNDARY_NOT_ANCESTOR'],
  ['selected fragment belongs to other object', f => { f.snapshot.objects[1].fragments[0].id = 'fragment:1'; }, 'SELECTED_FRAGMENT_JOIN'],
  ['mesh triangle references missing vertex', f => { f.snapshot.objects[1].fragments[0].triangleIndices[0] = 10; }, 'SNAPSHOT_MESH'],
  ['fragment transform not already applied', f => { f.snapshot.objects[1].fragments[0].transformAlreadyApplied = false; }, 'SNAPSHOT_FRAGMENT_TRANSFORM'],
  ['missing category assignment evidence', f => { delete f.snapshot.objects[1].categoryAssignmentSource; }, 'SNAPSHOT_CATEGORY_EVIDENCE'],
  ['invented category assignment evidence', f => { f.snapshot.objects[1].categoryAssignmentSource = 'guessed-by-name'; }, 'SNAPSHOT_CATEGORY_EVIDENCE'],
  ['canonical vertex outside supplied world bounds', f => { f.snapshot.objects[1].fragments[0].vertices[0][0] = 2; }, 'SNAPSHOT_VERTEX_OUTSIDE_BOUNDS'],
  ['display offset mismatch', f => { f.snapshot.coordinates.globalOffsetMetres = [1, 0, 0]; }, 'TRANSFORM_INCONSISTENCY'],
  ['project-scoped alias join', f => { f.metadata.aliases[0].project_id = artifact; }, 'CROSS_PROJECT_ALIAS'],
  ['project-scoped binding join', f => { f.metadata.bindings[0].project_id = artifact; }, 'CROSS_PROJECT_BINDING'],
  ['alias normalization mismatch', f => { f.metadata.aliases[0].normalized_alias = 'QA001'; }, 'ALIAS_NORMALIZATION'],
  ['binding canonical frame guard', f => { f.metadata.bindings[0].coordinate_frame = 'display-local'; }, 'BINDING_SCHEMA'],
  ['binding invalid point', f => { f.metadata.bindings[0].point[0] = 1e12; }, 'BINDING_SCHEMA'],
  ['metadata active content mismatch', f => { f.metadata.selection[0].content_fingerprint = 'f'.repeat(64); }, 'METADATA_SELECTED_IDENTITY'],
]) test(`reject ${label} and persist exact failure`, async () => { await audit(await fixture(mutate), code); });

test('hash mismatch writes expected/actual hash and preserves input bytes', async () => { const f = await fixture(); f.manifest.inventory.sha256 = '0'.repeat(64); const before = await fs.readFile(path.join(f.root, 'input/receipt.json')); const r = await audit(f, 'INPUT_HASH'); assert.equal(r.failure.detail.expectedSha256, '0'.repeat(64)); assert.equal(r.failure.detail.actualSha256, hash(before)); assert.deepEqual(await fs.readFile(path.join(f.root, 'input/receipt.json')), before); });
test('traversal input is rejected and a fresh failure receipt is retained', async () => { const f = await fixture(); f.manifest.inventory.path = '../outside.json'; await audit(f, 'UNSAFE_PATH'); });
test('unapproved executable matching hash never executes', async () => { const f = await fixture(); f.manifest.productionMatching.sha256 = '0'.repeat(64); await audit(f, 'UNAPPROVED_MATCHING_CODE'); });
test('duplicate JSON members are rejected and their failure retained', async () => { const f = await fixture(); const bytes = Buffer.from('{"schemaVersion":"x","schemaVersion":"y"}'); await fs.writeFile(path.join(f.root, 'input/receipt.json'), bytes); f.manifest.inventory.sha256 = hash(bytes); await audit(f, 'OUTPUT_DUPLICATE_MEMBER'); });
test('existing output is never overwritten', async () => { const f = await fixture(); await fs.writeFile(path.join(f.root, 'out/receipt.json'), 'sentinel'); await assert.rejects(runAudit({ root: f.root, manifest: f.manifest, output: 'out/receipt.json' }), { code: 'OUTPUT_EXISTS' }); assert.equal(await fs.readFile(path.join(f.root, 'out/receipt.json'), 'utf8'), 'sentinel'); });
test('symlink or junction ancestors are rejected before input access', async () => { const f = await fixture(); await fs.symlink(path.join(f.root, 'input'), path.join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); f.manifest.inventory.path = 'linked/receipt.json'; await audit(f, 'LINK_FORBIDDEN'); });
test('absolute input path is rejected', async () => { const f = await fixture(); await assert.rejects(safePath(f.root, path.join(f.root, 'input/receipt.json')), { code: 'UNSAFE_PATH' }); });
test('stale model and stale artifact cannot be reported as current manual bindings', async () => { const f = await fixture(x => { x.metadata.bindings[0].artifact_id = model; }); const r = await audit(f); assert.equal(r.endpoints.endpoints[0].recordedRegistry.status, 'stale'); assert.equal(r.endpoints.endpoints[0].recordedRegistry.assessment, 'stale-against-selected-artifact'); });
test('punctuation and leading zeroes survive actual production normalization', async () => { const f = await fixture(x => { x.metadata.cables[0].to_location = 'QA001'; }); const r = await audit(f); assert.equal(r.endpoints.endpoints[0].recordedRegistry.status, 'matched'); assert.equal(r.endpoints.endpoints[1].recordedRegistry.status, 'missing'); assert.notEqual(r.endpoints.endpoints[0].normalizedTextSha256, r.endpoints.endpoints[1].normalizedTextSha256); });
test('actual production NFC normalization joins composed and decomposed text', async () => { const f = await fixture(x => { x.metadata.cables[0].from_location = 'e\u0301-001'; x.metadata.locations[0].name = 'É-001'; x.metadata.aliases[0].display_alias = 'é-001'; x.metadata.aliases[0].normalized_alias = 'É-001'; }); const r = await audit(f); assert.equal(r.endpoints.endpoints[0].recordedRegistry.status, 'matched'); });
test('shared cable matching excludes routing leaf; standalone fallback may use it', async () => { const f = await fixture(x => { x.metadata.cables[0].from_location = 'Leaf /001'; }); const r = await audit(f); assert.equal(r.endpoints.endpoints[0].rawInventoryName.status, 'unique'); assert.equal(r.endpoints.endpoints[0].selectedSharedAutomaticCandidates.count, 0); assert.equal(r.endpoints.endpoints[0].selectedStandalonePathCandidates.count, 1); });
test('other project remains unmatched to real inventory even with identical content fingerprint', async () => {
  const f = await fixture(x => { const other = artifact; x.metadata.selection.push({ ...x.metadata.selection[0], project_id: other }); x.metadata.cables.push({ ...x.metadata.cables[0], id: model, project_id: other }); });
  const r = await audit(f); assert.equal(r.endpoints.otherProjectCables, 1); assert.equal(r.endpoints.endpoints[2].rawInventoryName.status, 'NOT_RUN'); assert.equal(r.endpoints.endpoints[2].recordedRegistry.status, 'missing');
});

test('sparse maximum dbId is audited arithmetically without scanning two billion values', async () => {
  const f = await fixture(x => { x.part.objects[2].dbId = 2147483647; x.part.objects[2].id = 'dbid:2147483647'; x.snapshot.objects[2].dbId = 2147483647; x.snapshot.objects[2].id = 'dbid:2147483647'; });
  const started = performance.now(), r = await audit(f); assert.ok(performance.now() - started < 3000); assert.equal(r.inventory.maximumDbId, 2147483647); assert.equal(r.inventory.missingDbIdsWithinOneToMaxDeclaredMappingOrObserved, 2147483644); assert.deepEqual(r.inventory.missingDbIdExamples.slice(0, 3), [3, 4, 5]);
});
test('oversize valid row-budget output persists compact FAIL instead of losing its receipt', async () => {
  const f = await fixture(x => { const row = x.metadata.cables[0]; x.metadata.cables = Array.from({ length: 1400 }, () => ({ ...row, id: randomUUID() })); });
  const r = await audit(f, 'RECEIPT_OUTPUT_LIMIT'); assert.equal(r.failure.phase, 'receipt-serialization'); assert.equal(r.failure.detail.endpointRows, 2800); assert.ok((await fs.stat(path.join(f.root, 'out/receipt.json'))).size < 2 * 1024 ** 2);
});
test('unbound known location has unknown matching state when live ambiguity records are absent', async () => { const f = await fixture(x => { x.metadata.bindings = []; }); const r = await audit(f); assert.equal(r.endpoints.endpoints[0].recordedRegistry.status, 'unknown-unbound-matching-state'); assert.equal(r.endpoints.endpoints[0].recordedRegistry.productionResultWithOmittedMatchingRows, 'missing'); });
test('unlisted additional capture part is rejected instead of being silently skipped', async () => { const f = await fixture(); await fs.copyFile(path.join(f.root, 'input/test-capture-0000.json'), path.join(f.root, 'input/test-capture-0001.json')); await audit(f, 'PART_FILE_SET'); });

test.after(async () => { await fs.writeFile(path.join(scratch, 'test-output-root.json'), JSON.stringify({ schemaVersion: 'pathfinder.coverage.controls-work.v1', path: scratch, generatedAt: new Date().toISOString(), note: 'Owned compact control inputs and detailed per-control failure receipts retained. No production, frozen, or denied paths were touched.' }, null, 2)); });
