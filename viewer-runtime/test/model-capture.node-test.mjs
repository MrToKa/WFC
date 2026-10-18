import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { captureSelectedModel, createModelCaptureAssembler, MODEL_CAPTURE_LIMITS } from '../model-capture.mjs';
import { planModelCaptureInput } from '../capture-input.mjs';

class Matrix {
  constructor(double = false) { this.elements = double ? new Float64Array(16) : new Float32Array(16); this.makeScale(1, 1, 1); }
  makeScale(x, y, z) { this.elements.fill(0); this.elements[0] = x; this.elements[5] = y; this.elements[10] = z; this.elements[15] = 1; return this; }
  copy(other) { this.elements.set(other.elements); return this; }
  multiply(other) { const a = Array.from(this.elements), b = other.elements; for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) this.elements[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3]; return this; }
  determinant() { return this.elements[0] * this.elements[5] * this.elements[10]; }
}
class Vector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  applyMatrix4(matrix) { const a = matrix.elements, { x, y, z } = this; this.x = a[0] * x + a[4] * y + a[8] * z + a[12]; this.y = a[1] * x + a[5] * y + a[9] * z + a[13]; this.z = a[2] * x + a[6] * y + a[10] * z + a[14]; return this; }
}
class Box { constructor() { this.min = new Vector(Infinity, Infinity, Infinity); this.max = new Vector(-Infinity, -Infinity, -Infinity); } isEmpty() { return this.min.x > this.max.x; } }
const request = { captureId: '11111111-1111-4111-8111-111111111111', projectId: '22222222-2222-4222-8222-222222222222', modelVersionId: '33333333-3333-4333-8333-333333333333', contentFingerprint: 'a'.repeat(64), routeCodes: ['/TRAY-01'], allowedCategories: ['LV', 'Control'], equipmentNames: [' P-001 ', 'MISSING', 'café'] };
function fixture({ ambiguous = true, nonfinite = false, indices = [0, 1, 2], emptyEndpoint = false, malformedParent = false, worldOffset = 0.125, rawOffset = 100000000.123, lookupNames = false, hiddenIds = [], offIds = [], hiddenFragments = [] } = {}) {
  const names = new Map([[1, 'Plant'], [2, 'TRAY-01'], [3, 'Straight tray'], [4, 'Pump object'], [5, 'Second pump'], [6, 'Unicode equipment']]);
  if (lookupNames) { names.set(2, 'Imported /BC001'); names.set(3, 'FTUBE /BC001/123'); }
  const parents = new Map([[1, 0], [2, 1], [3, malformedParent ? 3 : 2], [4, 1], [5, 1], [6, 1]]);
  const children = new Map([[1, [2, 4, 5, 6]], [2, [3]], [3, []], [4, []], [5, []], [6, []]]);
  const properties = new Map([[4, [{ displayCategory: 'Equipment', displayName: 'Equipment Tag', displayValue: 'P-001' }]], [5, ambiguous ? [{ displayCategory: 'Equipment', displayName: 'Tag', displayValue: 'p-001' }] : []], [6, [{ displayCategory: 'Equipment', displayName: 'Location', displayValue: 'cafe\u0301' }]]]);
  const tree = { getRootId: () => 1, getNodeName: id => names.get(id), getNodeParentId: id => parents.get(id), getChildCount: id => children.get(id).length,
    isNodeHidden: id => hiddenIds.includes(id), isNodeOff: id => offIds.includes(id),
    enumNodeChildren(id, visit, recursive) { if (recursive && id === 1) visit(1); for (const child of children.get(id)) { if (visit(child)) return; if (recursive) this.enumNodeChildren(child, visit, true); } },
    enumNodeFragments(id, visit) { if (id === 3) visit(0); if ([4, 5, 6].includes(id) && !(emptyEndpoint && id === 4)) visit(id); },
    getNodeBox(id, box) { if (id === 4 && emptyEndpoint) box.set([2000, 3000, 4000, 2100, 3100, 4100]); },
  };
  const geometry = { vertices: [[0, 0, 0], [1000, 0, 0], [0, 1000, nonfinite ? NaN : 0]], indices };
  const fragments = { isFragVisible: id => !hiddenFragments.includes(id), getGeometry: () => geometry, getWorldMatrix(_id, value) { value.makeScale(1, 1, 1); value.elements[12] = worldOffset; }, getOriginalWorldMatrix(_id, value) { value.makeScale(1, 1, 1); }, getWorldBounds(id, value) { value.min = new Vector(2000 + id, 3000, 4000); value.max = new Vector(2100 + id, 3100, 4100); } };
  const model = { getObjectTree: success => success(tree), getFragmentList: () => fragments, getUnitScale: () => 0.001, getUnitString: () => 'mm', getUpVector: () => [0, 0, 1], getGlobalOffset: () => new Vector(rawOffset, 0, 0), getData: () => ({}), getBulkProperties: (ids, _options, success) => success(ids.map(dbId => ({ dbId, externalId: 'external-' + dbId, properties: properties.get(dbId) ?? [] }))), getExternalIdMapping: success => success(Object.fromEntries([...names.keys()].map(id => ['external-' + id, id]))) };
  globalThis.Autodesk = { Viewing: { Private: { LmvMatrix4: Matrix, enumMeshVertices: (geo, visit) => geo.vertices.forEach((value, index) => visit(new Vector(...value), null, null, index)), enumMeshTriangles: (geo, visit) => { for (let index = 0; index < geo.indices.length; index += 3) visit(null, null, null, ...geo.indices.slice(index, index + 3)); } } } };
  globalThis.THREE = { Vector3: Vector, Box3: Box }; globalThis.LMV_VIEWER_VERSION = '7.130.0';
  return { model, tree, properties };
}
async function collect(options = {}, input = request) { const value = fixture(options), events = [], assembler = createModelCaptureAssembler(); for await (const event of captureSelectedModel({ model: value.model }, input)) { events.push(event); assembler.accept(event); } return { snapshot: assembler.finish(), summary: assembler.summary(), events, ...value }; }
const ruleRequest = rules => { const { routeCodes: _codes, allowedCategories: _categories, ...identity } = request; return { ...identity, equipmentNames: [], routeRules: rules }; };
const rule = (objectIds, allowedCategories, id = '44444444-4444-4444-8444-444444444444') => ({ id, objectIds, allowedCategories });
const lookupRequest = (lookupRouteCodes = ['/BC001']) => { const { routeCodes: _codes, allowedCategories: _categories, ...identity } = request; return { ...identity, equipmentNames: [], lookupRouteCodes }; };
async function stagedRequest(equipmentNames) {
  const source = { routeRules: [rule([2], ['LV'])], equipmentNames };
  const p = await planModelCaptureInput(source, { captureId: request.captureId, envelopeIdentity: { instanceId: '99999999-9999-4999-8999-999999999999', projectId: request.projectId, modelVersionId: request.modelVersionId, loadId: '88888888-8888-4888-8888-888888888888' } });
  return { p, input: { ...request, routeCodes: undefined, allowedCategories: undefined, ...p.request, inputScope: p.descriptor } };
}
test('staged1527 names produce one bounded computational snapshot with durable scope and actual scan closure', async () => {
  const { input, p } = await stagedRequest(['P-001', ...Array.from({ length: 1526 }, (_, i) => 'UNMATCHED-' + i)]), f = fixture(), events = [], assembler = createModelCaptureAssembler({ eventLimit: 3000 - 1 - p.chunks.length }), requestedBatches = [];
  const original = f.model.getBulkProperties; f.model.getBulkProperties = (...args) => { requestedBatches.push([...args[0]]); return original(...args); };
  for await (const e of captureSelectedModel({ model: f.model }, input, { eventLimit: 3000 - 1 - p.chunks.length })) { events.push(e); assembler.accept(e); }
  const snapshot = assembler.finish(), summary = assembler.summary(); assert.equal(snapshot.capture.inputScope.equipmentNameCount, 1527); assert.deepEqual(snapshot.capture.inputScope.propertyScan, { indexedObjectCount: 6, attemptedObjectCount: 6, returnedObjectCount: 6, omittedObjectCount: 0, complete: true }); assert.deepEqual(summary.scope.equipmentNames, p.request.equipmentNames); assert.deepEqual(summary.scope.inputScope, snapshot.capture.inputScope); assert.equal(requestedBatches.filter(batch => batch.length === 6).length, 1); assert.ok(requestedBatches.slice(1).every(batch => batch.every(id => id === 1 || id === 2))); assert.ok(events.length + 1 + p.chunks.length <= 3000); assert.equal(snapshot.capture.geometryComplete, false);
});
test('irrelevant omitted SDK rows retain geometry but make absence and unique-candidate status unknown', async () => {
  const { input } = await stagedRequest(['P-001', 'NOT-FOUND']), f = fixture(), original = f.model.getBulkProperties, assembler = createModelCaptureAssembler();
  f.model.getBulkProperties = (ids, options, success) => original(ids, options, rows => success(rows.filter(row => row.dbId !== 5)));
  for await (const e of captureSelectedModel({ model: f.model }, input)) assembler.accept(e);
  const snapshot = assembler.finish(), summary = assembler.summary(); assert.equal(snapshot.capture.inputScope.propertyScan.omittedObjectCount, 1); assert.equal(snapshot.capture.inputScope.propertyScan.complete, false); assert.equal(summary.scope.fullPropertyScan, false); assert.equal(summary.equipmentMatches.find(x => x.name === 'P-001').status, 'unknown'); assert.equal(summary.equipmentMatches.find(x => x.name === 'NOT-FOUND').status, 'unknown'); assert.ok(summary.diagnostics.some(x => x.code === 'incomplete_sdk_property_scan')); assert.ok(snapshot.objects.some(o => o.geometryRole === 'routing-leaf'));
});
test('staged request hash and inherited deadline are checked before any SDK read', async () => {
  const { input } = await stagedRequest(['P-001']), f = fixture(); let reads = 0; f.model.getObjectTree = () => { reads++; };
  for (const [bad, options] of [[{ ...input, inputScope: { ...input.inputScope, scopeSha256: 'a'.repeat(64) } }, {}], [input, { startedAt: Date.now() - 300001 }]]) await assert.rejects(async () => { for await (const _e of captureSelectedModel({ model: f.model }, bad, options)) { /* no partial metadata */ } }, /digest mismatch|deadline/);
  assert.equal(reads, 0);
});
test('generator and assembler honor the reduced shared response budget without truncation', async () => {
  const { input } = await stagedRequest(['P-001']), f = fixture(), assembler = createModelCaptureAssembler({ eventLimit: 1 }), generator = captureSelectedModel({ model: f.model }, input, { eventLimit: 1 }); const first = await generator.next(); assembler.accept(first.value); await assert.rejects(() => generator.next(), /bounded bridge budget/); assert.throws(() => assembler.finish(), /not complete/); assert.throws(() => assembler.accept(first.value), /over-budget/); assert.throws(() => createModelCaptureAssembler({ eventLimit: 3001 }), /budget/);
});
test('assembler rejects forged finalized scope scan counts and descriptor hashes', async () => {
  const { input } = await stagedRequest(['P-001']), f = fixture(), events = []; for await (const e of captureSelectedModel({ model: f.model }, input)) events.push(e);
  for (const change of [s => { s.scope.inputScope.propertyScan.complete = false; }, s => { s.scope.inputScope.equipmentNamesSha256 = 'f'.repeat(64); }, s => { s.scope.equipmentNames = []; }]) {
    const assembler = createModelCaptureAssembler(), changed = structuredClone(events), parts = changed.filter(e => e.type === 'summary-part'); assert.equal(parts.length, 1); const summary = JSON.parse(parts[0].text); change(summary); parts[0].text = JSON.stringify(summary); assert.throws(() => changed.forEach(e => assembler.accept(e)), /scope closure/);
  }
});

test('independent lookup broadly discovers qualified names without JS owner parsing or planning assignments', async () => {
  const { snapshot, summary } = await collect({ lookupNames: true }, lookupRequest());
  assert.equal(snapshot.capture.adapterVersion, 'wfc.protected-lookup-capture.v1'); assert.deepEqual(snapshot.capture.lookupRouteCodes, ['/BC001']);
  const leaf = snapshot.objects.find(object => object.dbId === 3);
  assert.equal(leaf.routeBoundaryId, undefined); assert.equal(leaf.routeName, undefined); assert.equal(leaf.shapeName, undefined);
  assert.equal(leaf.categoryAssignmentSource, 'lookup-all-categories'); assert.deepEqual(leaf.allowedCategories, ['MV', 'LV', 'Control']);
  assert.deepEqual(leaf.leafToRootNames, ['FTUBE /BC001/123', 'Imported /BC001', 'Plant']);
  assert.equal(leaf.nativeHidden, null); assert.equal(snapshot.capture.planningVisibilityKnown, false);
  assert.equal(summary.scope.kind, 'independent-lookup-network'); assert.match(summary.scope.visibility, /native-unknown/);
});
test('independent lookup excludes hidden ancestors, off nodes and invisible fragment geometry without fabricating native proof', async () => {
  for (const options of [{ hiddenIds: [2] }, { hiddenIds: [3] }, { offIds: [1] }, { hiddenFragments: [0] }])
    await assert.rejects(() => collect({ lookupNames: true, ...options }, lookupRequest()), { code: 'LOOKUP_GEOMETRY_NOT_FOUND' });
  await assert.rejects(() => collect({ lookupNames: true }, lookupRequest(['/MISSING'])), { code: 'LOOKUP_GEOMETRY_NOT_FOUND' });
});
test('independent lookup requires visibility support and exclusive canonical C# planned scope', async () => {
  const value = fixture({ lookupNames: true }); delete value.tree.isNodeHidden;
  await assert.rejects(async () => { for await (const _event of captureSelectedModel({ model: value.model }, lookupRequest())) { /* no partial result */ } }, /visibility cannot be established/);
  for (const bad of [{ ...lookupRequest(), routeCodes: ['BC001'] }, { ...lookupRequest(), routeRules: [rule([2], ['MV'])] }, { ...lookupRequest(), equipmentNames: ['P-001'] }, lookupRequest(['bc001']), lookupRequest(['/SECONDARY']), lookupRequest(Array(101).fill('/BC001'))])
    await assert.rejects(() => collect({ lookupNames: true }, bad), /Independent lookup/);
});
test('lookup capture retains cancellation and model identity fences', async () => {
  const value = fixture({ lookupNames: true }), controller = new AbortController(), viewer = { model: value.model };
  const iterator = captureSelectedModel(viewer, lookupRequest(), { signal: controller.signal }); await iterator.next(); controller.abort();
  await assert.rejects(() => iterator.next(), { name: 'AbortError' });
  const other = captureSelectedModel(viewer, lookupRequest()); await other.next(); viewer.model = {};
  await assert.rejects(() => other.next(), /model changed/);
});
test('lookup refuses partially visible physical meshes rather than changing the fitting geometry', async () => {
  const value = fixture({ lookupNames: true, hiddenFragments: [1] }), original = value.tree.enumNodeFragments;
  value.tree.enumNodeFragments = (id, visit) => { original.call(value.tree, id, visit); if (id === 3) visit(1); };
  await assert.rejects(async () => { for await (const _event of captureSelectedModel({ model: value.model }, lookupRequest())) { /* no partial snapshot */ } }, /partially visible fragment geometry/);
});

test('ordered route selections recursively capture deepest geometry with the latest overlapping categories and exact selected root boundary', async () => {
  const { snapshot, summary } = await collect({}, ruleRequest([rule([2], ['MV']), rule([3], ['Control'], '55555555-5555-4555-8555-555555555555')]));
  const leaf = snapshot.objects.find(object => object.dbId === 3);
  assert.deepEqual(leaf.allowedCategories, ['Control']); assert.equal(leaf.routeBoundaryId, 'dbid:3'); assert.equal(leaf.routeName, undefined); assert.equal(leaf.shapeName, undefined);
  assert.deepEqual(leaf.leafToRootNames, ['Straight tray', 'TRAY-01', 'Plant']); assert.equal(summary.scope.routeRules.length, 2);
  assert.equal(snapshot.objects.find(object => object.dbId === 2).geometryRole, 'hierarchy');
});
test('empty category overlap explicitly excludes a leaf and never falls back to another category or model', async () => {
  await assert.rejects(() => collect({}, ruleRequest([rule([2], ['LV']), rule([3], [], '55555555-5555-4555-8555-555555555555')])), /No physical routing leaves/);
  const { snapshot, summary } = await collect({}, ruleRequest([rule([2, 4], ['MV']), rule([3], [], '55555555-5555-4555-8555-555555555555')]));
  assert.equal(snapshot.objects.some(object => object.dbId === 3), false); assert.deepEqual(snapshot.objects.find(object => object.dbId === 4).allowedCategories, ['MV']);
  assert.ok(summary.diagnostics.some(item => item.code === 'route_rule_excluded' && item.objectId === 'dbid:3'));
});
test('rule selection refuses absent roots, mixed contracts, invalid categories and duplicate rule identities', async () => {
  await assert.rejects(() => collect({}, ruleRequest([rule([99], ['LV'])])), /current model inventory/);
  await assert.rejects(() => collect({}, { ...request, routeRules: [rule([2], ['LV'])] }), /ordered route rules/);
  await assert.rejects(() => collect({}, ruleRequest([rule([2], ['Instrumentation'])])), /ordered route rules/);
  await assert.rejects(() => collect({}, ruleRequest([rule([2], ['MV']), rule([3], ['LV'])])), /ordered route rules/);
});
test('assembler refuses forged nonancestor selected root boundaries', async () => {
  const { events } = await collect({}, ruleRequest([rule([2], ['LV'])])), bad = structuredClone(events), packet = bad.find(event => event.type === 'object-part' && event.objectId === 'dbid:3');
  const object = JSON.parse(packet.text); object.routeBoundaryId = 'dbid:99'; packet.text = JSON.stringify(object);
  const assembler = createModelCaptureAssembler(); assert.throws(() => bad.forEach(event => assembler.accept(event)), /not an ancestor/);
});

test('selected actual-shaped SDK capture retains binary64 transforms and physical leaves only', async () => {
  const { snapshot, summary, events } = await collect();
  assert.equal(snapshot.capture.sourceKind, 'converted'); assert.equal(snapshot.capture.inventoryComplete, false); assert.equal(snapshot.capture.unitsVerified, false); assert.equal(snapshot.capture.transformsVerified, false); assert.equal(snapshot.capture.planningVisibilityKnown, false); assert.equal(snapshot.capture.sourceLinkVerified, false);
  const tray = snapshot.objects.find(value => value.dbId === 3), root = snapshot.objects.find(value => value.dbId === 1), owner = snapshot.objects.find(value => value.dbId === 2);
  assert.equal(tray.geometryRole, 'routing-leaf'); assert.equal(tray.routeName, '/TRAY-01'); assert.deepEqual(tray.allowedCategories, ['LV', 'Control']);
  assert.equal(root.geometryRole, 'hierarchy'); assert.deepEqual(root.fragments, []); assert.deepEqual(owner.fragments, []);
  assert.ok(Math.abs(tray.fragments[0].vertices[0][0] - 100000.000248) < 1e-10);
  assert.notEqual(tray.fragments[0].fragmentToWorldMetres[12], new Float32Array(tray.fragments[0].fragmentToWorldMetres)[12]);
  assert.deepEqual(tray.fragments[0].triangleIndices, [0, 1, 2]); assert.equal(summary.evidence.matrixPrecision, 'binary64');
  for (const event of events) assert.ok(Buffer.byteLength(JSON.stringify(event)) <= MODEL_CAPTURE_LIMITS.eventBytes);
});
test('equipment property matching is exact NFC/trim/case and retains ambiguous and missing candidates', async () => {
  const { summary, snapshot } = await collect();
  assert.deepEqual(summary.equipmentMatches.find(value => value.name === 'P-001').candidateObjectIds, ['dbid:4', 'dbid:5']);
  assert.equal(summary.equipmentMatches.find(value => value.name === 'P-001').status, 'ambiguous');
  assert.equal(summary.equipmentMatches.find(value => value.name === 'MISSING').status, 'missing');
  assert.deepEqual(summary.equipmentMatches.find(value => value.name === 'café').candidateObjectIds, ['dbid:6']);
  assert.equal(snapshot.objects.find(value => value.dbId === 4).geometryRole, 'object');
});
test('geometry-free equipment keeps an actual SDK bound and never becomes a routing tray', async () => {
  const { snapshot, summary } = await collect({ emptyEndpoint: true }); const equipment = snapshot.objects.find(value => value.dbId === 4);
  assert.equal(equipment.geometryRole, 'object'); assert.deepEqual(equipment.fragments, []); assert.equal(equipment.bounds.minimum[2], 4);
  assert.ok(summary.diagnostics.some(value => value.code === 'sdk_node_bounds_without_triangle_geometry'));
});
test('categories require explicit planning selection and unknown categories fail', async () => {
  await assert.rejects(() => collect({}, { ...request, allowedCategories: [] }), /Explicit allowed/);
  await assert.rejects(() => collect({}, { ...request, allowedCategories: ['Instrumentation'] }), /Explicit allowed/);
});
test('NaN mesh coordinates and invalid triangle indices are refused without an incomplete snapshot', async () => {
  await assert.rejects(() => collect({ nonfinite: true }), /finite model coordinate/);
  await assert.rejects(() => collect({ indices: [0, 1, 9] }), /triangle index/);
});
test('canonical geometry beyond the engine and picking1e9 bound is explicitly refused', async () => {
  await assert.rejects(() => collect({ worldOffset: 2e12 }), /coordinate exceeds the1e9 bound/);
});
test('raw millimetre offsets beyond1e9 remain valid when canonical metres fit the engine bound', async () => {
  const { snapshot } = await collect({ rawOffset: 3000000000.123 });
  assert.ok(snapshot.coordinates.globalOffsetMetres[0] > 3000000);
  assert.ok(snapshot.objects.find(value => value.dbId === 3).fragments[0].vertices[0][0] < 1e9);
});
test('cyclic hierarchy is refused', async () => { await assert.rejects(() => collect({ malformedParent: true }), /Cyclic SDK parent/); });
test('cancellation after metadata aborts traversal and model replacement invalidates capture', async () => {
  const value = fixture(), controller = new AbortController(), viewer = { model: value.model }, iterator = captureSelectedModel(viewer, request, { signal: controller.signal });
  assert.equal((await iterator.next()).value.type, 'metadata'); controller.abort(); await assert.rejects(() => iterator.next(), { name: 'AbortError' });
  const second = captureSelectedModel(viewer, { ...request, captureId: '44444444-4444-4444-8444-444444444444' }); await second.next(); viewer.model = {}; await assert.rejects(() => second.next(), /model changed/);
});
test('capture does not touch visibility, colors, selection, navigation or Ghost', async () => {
  const value = fixture(), viewer = { model: value.model }; for (const method of ['showAll', 'isolate', 'fitToView', 'setGhosting', 'setThemingColor', 'select']) viewer[method] = () => assert.fail('Capture must not change display state.');
  for await (const _event of captureSelectedModel(viewer, request)) { /* bounded read-only stream */ }
});
test('assembler rejects stale, duplicate, out-of-order and premature complete events', async () => {
  const { events } = await collect();
  const stale = createModelCaptureAssembler(); stale.accept(events[0]); assert.throws(() => stale.accept({ ...events[1], captureId: '44444444-4444-4444-8444-444444444444' }), /identity changed/);
  const duplicate = createModelCaptureAssembler(); duplicate.accept(events[0]); duplicate.accept(events[1]); assert.throws(() => duplicate.accept(events[1]), /Duplicate|order/);
  const incomplete = createModelCaptureAssembler(); incomplete.accept(events[0]); assert.throws(() => incomplete.finish(), /not complete/); assert.throws(() => incomplete.accept(events.at(-1)), /Incomplete capture/);
});
test('assembler refuses unsupported proof flags, oversized chunks and count tampering', async () => {
  const { events } = await collect(), metadata = structuredClone(events[0]); metadata.snapshotHeader.capture.unitsVerified = true;
  assert.throws(() => createModelCaptureAssembler().accept(metadata), /unsupported proof/);
  const oversized = createModelCaptureAssembler(); oversized.accept(events[0]); assert.throws(() => oversized.accept({ ...events[1], text: 'a'.repeat(25000) }), /over-budget/);
  const counts = createModelCaptureAssembler(); for (const event of events.slice(0, -1)) counts.accept(event); assert.throws(() => counts.accept({ ...events.at(-1), triangleCount: 100 }), /count closure/);
});
test('large escaped Unicode property payloads paginate and reassemble exactly under24KiB', async () => {
  const value = fixture(), original = 'Ω\\"🧭'.repeat(180);
  value.properties.set(3, Array.from({ length: 35 }, (_, index) => ({ displayCategory: 'Synthetic', displayName: 'Value' + index, displayValue: original })));
  const assembler = createModelCaptureAssembler(), packets = [];
  for await (const event of captureSelectedModel({ model: value.model }, request)) { packets.push(event); assembler.accept(event); }
  const objectParts = packets.filter(value => value.type === 'object-part' && value.objectId === 'dbid:3'); assert.ok(objectParts.length > 1);
  assert.equal(assembler.finish().objects.find(value => value.dbId === 3).properties[0].value, original);
  for (const packet of packets) { assert.ok(Buffer.byteLength(JSON.stringify(packet)) <= 24 * 1024); assert.ok(Buffer.byteLength(JSON.stringify({ type: 'CAPTURE_EVENT', eventJson: JSON.stringify(packet) })) < 65536); }
});
test('canonical capture JSON rejects duplicate object members and unexpected object keys', async () => {
  const { events } = await collect(), firstObject = events.find(event => event.type === 'object-part');
  const before = events.slice(0, events.indexOf(firstObject));
  const duplicate = createModelCaptureAssembler(); before.forEach(event => duplicate.accept(event));
  assert.throws(() => duplicate.accept({ ...firstObject, text: firstObject.text.replace('{', '{"name":"Injected duplicate",') }), /not canonical/);
  const extra = createModelCaptureAssembler(); before.forEach(event => extra.accept(event)); const object = JSON.parse(firstObject.text); object.unexpected = true;
  assert.throws(() => extra.accept({ ...firstObject, text: JSON.stringify(object) }), /captured object/);
});
test('legacy, selected-boundary and independent lookup SDK captures cross the strict C# model-worker boundary', async () => {
  const staged = await stagedRequest(['P-001']);
  for (const captureRequest of [request, ruleRequest([rule([2], ['LV'])]), lookupRequest(), staged.input]) {
    const lookup = Boolean(captureRequest.lookupRouteCodes);
    const { snapshot } = await collect({ lookupNames: lookup }, captureRequest), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), scratch = path.join(root, 'pathfinder-engine/.scratch/protected-capture-interop-' + randomUUID()), snapshotId = randomUUID();
    await fs.mkdir(path.join(scratch, 'snapshots'), { recursive: true });
    try {
      const bytes = Buffer.from(JSON.stringify(snapshot)); await fs.writeFile(path.join(scratch, 'snapshots', snapshotId + '.json'), bytes, { flag: 'wx' });
      const input = { schemaVersion: 'pathfinder.model.runner.v1', requestId: randomUUID(), operation: lookup ? 'lookup' : 'prepare', projectId: snapshot.model.projectId, modelVersionId: snapshot.model.modelVersionId, snapshotId, snapshotSha256: createHash('sha256').update(bytes).digest('hex'), timeoutMilliseconds: 30000,
        ...(lookup ? { routeText: '/bc001/SECONDARY/BC001', options: { connectionToleranceMeters: 1, sampleSpacingMeters: .25, secondaryDistanceMeters: 2, preferVerticalApproach: true, maxGraphNodes: 10000, maxGraphConnections: 30000 } } : {}) };
      const result = spawnSync('dotnet', [process.env.PF_MODEL_RUNNER_DLL ?? path.join(root, 'pathfinder-engine/tools/PathFinder.ModelRunner/bin/Release/net9.0/PathFinder.ModelRunner.dll')], { cwd: root, windowsHide: true, input: JSON.stringify(input), encoding: 'utf8', timeout: 40000, maxBuffer: 8 * 1024 ** 2, env: { ...process.env, PF_ROOT: scratch, DOTNET_CLI_HOME: path.join(root, 'pathfinder-engine/.dotnet-home'), DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false' } });
      assert.equal(result.status, 0, result.stderr); const response = JSON.parse(result.stdout); assert.equal(response.status, lookup ? 'calculated' : 'prepared', result.stdout); assert.equal(response.engineeringAccepted, false); assert.equal(response.prepared.segmentCount, 1);
      if (lookup) { assert.equal(response.lookupScope.resolvedLeafCount, 1); assert.equal(response.usedConnectionGapMeters, 1); assert.equal(response.design, null); }
    } finally {
      const owned = path.resolve(root, 'pathfinder-engine/.scratch'); if (path.dirname(scratch) !== owned || !path.basename(scratch).startsWith('protected-capture-interop-')) throw Error('Refusing unexpected test cleanup target.');
      await fs.rm(scratch, { recursive: true, force: false });
    }
  }
});
