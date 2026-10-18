import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { captureSelectedModel, createModelCaptureAssembler, MODEL_CAPTURE_LIMITS } from '../model-capture.mjs';

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
function fixture({ ambiguous = true, nonfinite = false, indices = [0, 1, 2], emptyEndpoint = false, malformedParent = false, worldOffset = 0.125, rawOffset = 100000000.123 } = {}) {
  const names = new Map([[1, 'Plant'], [2, 'TRAY-01'], [3, 'Straight tray'], [4, 'Pump object'], [5, 'Second pump'], [6, 'Unicode equipment']]);
  const parents = new Map([[1, 0], [2, 1], [3, malformedParent ? 3 : 2], [4, 1], [5, 1], [6, 1]]);
  const children = new Map([[1, [2, 4, 5, 6]], [2, [3]], [3, []], [4, []], [5, []], [6, []]]);
  const properties = new Map([[4, [{ displayCategory: 'Equipment', displayName: 'Equipment Tag', displayValue: 'P-001' }]], [5, ambiguous ? [{ displayCategory: 'Equipment', displayName: 'Tag', displayValue: 'p-001' }] : []], [6, [{ displayCategory: 'Equipment', displayName: 'Location', displayValue: 'cafe\u0301' }]]]);
  const tree = { getRootId: () => 1, getNodeName: id => names.get(id), getNodeParentId: id => parents.get(id), getChildCount: id => children.get(id).length,
    enumNodeChildren(id, visit, recursive) { if (recursive && id === 1) visit(1); for (const child of children.get(id)) { if (visit(child)) return; if (recursive) this.enumNodeChildren(child, visit, true); } },
    enumNodeFragments(id, visit) { if (id === 3) visit(0); if ([4, 5, 6].includes(id) && !(emptyEndpoint && id === 4)) visit(id); },
    getNodeBox(id, box) { if (id === 4 && emptyEndpoint) box.set([2000, 3000, 4000, 2100, 3100, 4100]); },
  };
  const geometry = { vertices: [[0, 0, 0], [1000, 0, 0], [0, 1000, nonfinite ? NaN : 0]], indices };
  const fragments = { getGeometry: () => geometry, getWorldMatrix(_id, value) { value.makeScale(1, 1, 1); value.elements[12] = worldOffset; }, getOriginalWorldMatrix(_id, value) { value.makeScale(1, 1, 1); }, getWorldBounds(id, value) { value.min = new Vector(2000 + id, 3000, 4000); value.max = new Vector(2100 + id, 3100, 4100); } };
  const model = { getObjectTree: success => success(tree), getFragmentList: () => fragments, getUnitScale: () => 0.001, getUnitString: () => 'mm', getUpVector: () => [0, 0, 1], getGlobalOffset: () => new Vector(rawOffset, 0, 0), getData: () => ({}), getBulkProperties: (ids, _options, success) => success(ids.map(dbId => ({ dbId, externalId: 'external-' + dbId, properties: properties.get(dbId) ?? [] }))), getExternalIdMapping: success => success(Object.fromEntries([...names.keys()].map(id => ['external-' + id, id]))) };
  globalThis.Autodesk = { Viewing: { Private: { LmvMatrix4: Matrix, enumMeshVertices: (geo, visit) => geo.vertices.forEach((value, index) => visit(new Vector(...value), null, null, index)), enumMeshTriangles: (geo, visit) => { for (let index = 0; index < geo.indices.length; index += 3) visit(null, null, null, ...geo.indices.slice(index, index + 3)); } } } };
  globalThis.THREE = { Vector3: Vector, Box3: Box }; globalThis.LMV_VIEWER_VERSION = '7.130.0';
  return { model, tree, properties };
}
async function collect(options = {}, input = request) { const value = fixture(options), events = [], assembler = createModelCaptureAssembler(); for await (const event of captureSelectedModel({ model: value.model }, input)) { events.push(event); assembler.accept(event); } return { snapshot: assembler.finish(), summary: assembler.summary(), events, ...value }; }

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
test('synthetic SDK capture crosses strict C# SnapshotReader and model-worker boundary', async () => {
  const { snapshot } = await collect(), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), scratch = path.join(root, 'pathfinder-engine/.scratch/protected-capture-interop-' + randomUUID()), snapshotId = randomUUID();
  await fs.mkdir(path.join(scratch, 'snapshots'), { recursive: true }); const bytes = Buffer.from(JSON.stringify(snapshot)); await fs.writeFile(path.join(scratch, 'snapshots', snapshotId + '.json'), bytes, { flag: 'wx' });
  const input = { schemaVersion: 'pathfinder.model.runner.v1', requestId: randomUUID(), operation: 'prepare', projectId: snapshot.model.projectId, modelVersionId: snapshot.model.modelVersionId, snapshotId, snapshotSha256: createHash('sha256').update(bytes).digest('hex'), timeoutMilliseconds: 30000 };
  const result = spawnSync('dotnet', [path.join(root, 'pathfinder-engine/tools/PathFinder.ModelRunner/bin/Release/net9.0/PathFinder.ModelRunner.dll')], { cwd: root, windowsHide: true, input: JSON.stringify(input), encoding: 'utf8', timeout: 40000, maxBuffer: 8 * 1024 ** 2, env: { ...process.env, PF_ROOT: scratch, DOTNET_CLI_HOME: path.join(root, 'pathfinder-engine/.dotnet-home'), DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false' } });
  assert.equal(result.status, 0, result.stderr); const response = JSON.parse(result.stdout); assert.equal(response.status, 'prepared', result.stdout); assert.equal(response.engineeringAccepted, false); assert.equal(response.prepared.segmentCount, 1);
});
