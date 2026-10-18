import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCoordinates, createPathFinderController, createExactPathBatches } from '../pathfinder.mjs';
import { CHANNEL, validateEnvelope, MAX_MESSAGE_BYTES } from '../protocol.mjs';

const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const envelope = (type, payload) => ({ channel: CHANNEL, protocolVersion: 1, instanceId: uuid(1), projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), requestId: uuid(5), type, payload });
function fixture() {
  class Vector3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } set(x, y, z) { Object.assign(this, { x, y, z }); } }
  class Box3 {
    constructor() { this.min = new Vector3(Infinity, Infinity, Infinity); this.max = new Vector3(-Infinity, -Infinity, -Infinity); }
    expandByPoint(point) { for (const axis of ['x', 'y', 'z']) { this.min[axis] = Math.min(this.min[axis], point[axis]); this.max[axis] = Math.max(this.max[axis], point[axis]); } return this; }
    union(box) { this.expandByPoint(box.min); this.expandByPoint(box.max); return this; }
    isEmpty() { return this.min.x > this.max.x; }
  }
  class Geometry { setAttribute(key, value) { this[key] = value; } setIndex(value) { this.index = value; } dispose() { this.disposed = true; } }
  class SphereGeometry extends Geometry { constructor(radius, widthSegments, heightSegments) { super(); Object.assign(this, { radius, widthSegments, heightSegments }); } }
  class Material { constructor(options) { Object.assign(this, options); } dispose() { this.disposed = true; } }
  class Mesh { constructor(geometry, material) { Object.assign(this, { geometry, material, position: new Vector3(), isMesh: true }); } }
  const THREE = { Vector3, Box3, BufferGeometry: Geometry, SphereGeometry, BufferAttribute: class { constructor(array, itemSize) { Object.assign(this, { array, itemSize }); } }, MeshBasicMaterial: Material, Mesh, DoubleSide: 2 };
  const canvas = new EventTarget(); canvas.getBoundingClientRect = () => ({ left: 10, top: 20 });
  const tree = { getRootId: () => 1, getNodeName: id => ({ 1: 'MODEL', 2: '=CAB-001', 3: '=CAB-002' })[id], getNodeParentId: id => id === 1 ? 0 : 1,
    enumNodeChildren(id, fn) { for (const child of [1, 2, 3]) if (fn(child)) break; }, enumNodeFragments(id, fn) { if (id !== 1) fn(id); } };
  const fragments = { getWorldBounds(id, box) { box.expandByPoint(new Vector3(id, 2, 3)); box.expandByPoint(new Vector3(id + 1, 4, 5)); } };
  const model = { getUnitScale: () => 0.001, getUpVector: () => [0, 0, 1], getGlobalOffset: () => ({ x: 1000000.123456, y: -2000000.654321, z: 3000 }),
    getObjectTree: success => success(tree), getExternalIdMapping: success => success({ externalA: 2, externalB: 3 }), getFragmentList: () => fragments,
    getProperties: (id, success) => success({ properties: [{ displayName: 'Tag', displayValue: tree.getNodeName(id) }] }) };
  const meshes = [], viewer = { model, canvas, prefs: { get: () => false }, impl: { fadeMaterial: { opacity: 0.15, variants: [{ opacity: 0.3 }] }, showGhosting: false, toggleGhosting(value) { this.showGhosting = value; }, invalidate() {} },
    overlays: { addScene() {}, removeScene() {}, addMesh(mesh) { meshes.push(mesh); }, removeMesh(mesh) { meshes.splice(meshes.indexOf(mesh), 1); } },
    isolate(ids) { this.isolated = ids; }, setGhosting(value) { this.preference = value; }, clearSelection() {}, navigation: { fitBounds(flag, box) { viewer.fittedBounds = box; } },
    hitTest: () => ({ model, dbId: 2, intersectPoint: { x: 4, y: 5, z: 6 } }) };
  model.visibilityManager = {
    defaultVisible: true, states: [[3, false]],
    getDefaultVisibility() { return this.defaultVisible; }, getVisibility() { return this.states.map(value => [...value]); },
    setAllVisibility(value) { this.defaultVisible = value; this.states = []; },
    setVisibility(defaultVisible, states) { this.defaultVisible = defaultVisible; this.states = states.map(value => [...value]); viewer.isolated = []; },
  };
  const controller = createPathFinderController(viewer, { window: { THREE } });
  return { model, viewer, controller, meshes, canvas };
}

test('canonical coordinates preserve binary64 offset, units, round trip and reject undeclared axes', () => {
  const f = fixture(), coordinates = modelCoordinates(f.model);
  const expected = [(1000000.123456 + 4) * 0.001, (-2000000.654321 + 5) * 0.001, (3000 + 6) * 0.001];
  assert.deepEqual(coordinates.toCanonical([4, 5, 6]), expected);
  assert.ok(coordinates.toDisplay(expected).every((value, i) => Math.abs(value - [4, 5, 6][i]) < 1e-9));
  assert.throws(() => modelCoordinates({ ...f.model, getUpVector: () => [0, 1, 0] }), { code: 'COORDINATES_UNSUPPORTED' });
  assert.throws(() => coordinates.toDisplay([Infinity, 0, 0]), { code: 'COORDINATES_UNSUPPORTED' });
});

test('exact ordered path is rendered without fitting; filled Ghost and all original fades restore', () => {
  const f = fixture(), coordinates = modelCoordinates(f.model), points = [[4, 5, 6], [5, 7, 9], [8, 9, 10]].map(point => coordinates.toCanonical(point));
  f.controller.showPath({ points, objectIds: [2] });
  assert.equal(f.meshes.length, 1); assert.equal(f.meshes[0].material.color, 0xffe600); assert.equal(f.meshes[0].isMesh, true); assert.equal(f.meshes[0].material.depthTest, false);
  const positions = f.meshes[0].geometry.position.array, centre = index => Array.from(positions.slice(index * 3, index * 3 + 3)).map(value => Math.round(value * 1e6) / 1e6);
  assert.deepEqual([centre(16), centre(17), centre(34), centre(35)], [[0, 0, 0], [1, 2, 3], [1, 2, 3], [4, 4, 4]]);
  assert.ok(f.meshes[0].geometry.index.array instanceof Uint16Array); assert.equal(f.meshes[0].geometry.index.array.length, 192);
  assert.deepEqual(f.viewer.isolated, [2]); assert.equal(f.viewer.impl.showGhosting, true); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.025);
  const resource = f.meshes[0]; f.controller.clear(); assert.equal(f.meshes.length, 0);
  assert.equal(resource.geometry.disposed, true); assert.equal(resource.material.disposed, true);
  assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.15); assert.equal(f.viewer.impl.fadeMaterial.variants[0].opacity, 0.3); assert.equal(f.viewer.impl.showGhosting, false); f.controller.dispose();
});

test('merged yellow tubes retain exact segment axes, vertical/reversed order and a bounded Uint16 draw budget', () => {
  const points = [[1000000000, -20, 30], [1000000000, -20, 40], [1000000003, -16, 40], [1000000000, -20, 40]], original = structuredClone(points);
  const result = createExactPathBatches(points, 0.02); assert.deepEqual(points, original); assert.deepEqual(result.origin, points[0]); assert.equal(result.segmentCount, 3); assert.equal(result.markerRadius, null);
  const positions = result.batches[0].positions, indices = result.batches[0].indices;
  for (let segment = 0; segment < 3; segment++) for (let end = 0; end < 2; end++) {
    const centre = points[segment + end].map((value, axis) => value - result.origin[axis]), offset = (segment * 18 + 16 + end) * 3;
    assert.deepEqual(Array.from(positions.slice(offset, offset + 3)), centre);
    for (let ring = 0; ring < 8; ring++) {
      const vertex = Array.from(positions.slice((segment * 18 + end * 8 + ring) * 3, (segment * 18 + end * 8 + ring + 1) * 3));
      assert.ok(Math.abs(Math.hypot(...vertex.map((value, axis) => value - centre[axis])) - 0.02) < 1e-6);
    }
  }
  assert.equal(indices.length, 3 * 96); assert.ok(indices.every(index => index < positions.length / 3));
  const maximum = createExactPathBatches(Array.from({ length: 20000 }, (_, index) => [index, 0, 0]), 0.02);
  assert.equal(maximum.segmentCount, 19999); assert.equal(maximum.batches.length, 10);
  for (const batch of maximum.batches) { assert.ok(batch.indices instanceof Uint16Array); assert.ok(batch.positions.length / 3 <= 36000); assert.ok(batch.indices.every(index => index < batch.positions.length / 3)); }
  assert.throws(() => createExactPathBatches(Array.from({ length: 20001 }, (_, index) => [index, 0, 0]), 0.02), { code: 'PATH_INVALID' });
});

test('native-shaped zero-length one-point path becomes a marker without fabricating a second point or length', () => {
  const f = fixture(), point = modelCoordinates(f.model).toCanonical([4, 5, 6]), supplied = [point], before = structuredClone(supplied);
  const result = f.controller.showPath({ points: supplied, objectIds: [] });
  assert.deepEqual(supplied, before); assert.equal(result.pointCount, 1); assert.equal(f.meshes.length, 1); assert.equal(f.meshes[0].geometry.radius, 20); assert.equal(f.meshes[0].material.color, 0xffe600);
  assert.ok(Math.abs(f.meshes[0].position.x - 4) < 1e-9); assert.ok(f.viewer.fittedBounds.max.x > f.viewer.fittedBounds.min.x);
  assert.ok(validateEnvelope(envelope('BEGIN_COMPUTED_PATH', { pathId: uuid(6), pointCount: 1, objectIds: [] }), 'parent-to-frame'));
  assert.equal(validateEnvelope(envelope('BEGIN_COMPUTED_PATH', { pathId: uuid(6), pointCount: 0, objectIds: [] }), 'parent-to-frame'), null);
  const marker = f.meshes[0]; f.controller.clear(); assert.equal(marker.geometry.disposed, true); assert.equal(marker.material.disposed, true); assert.equal(f.meshes.length, 0); f.controller.dispose();
});

test('a computed path without SDK object IDs ghosts the full context and restores exact prior visibility', () => {
  const f = fixture(), coordinates = modelCoordinates(f.model), manager = f.model.visibilityManager;
  const prior = structuredClone({ defaultVisible: manager.defaultVisible, states: manager.states });
  f.controller.showPath({ points: [[4, 5, 6], [8, 9, 10]].map(point => coordinates.toCanonical(point)), objectIds: [] });
  assert.equal(manager.defaultVisible, false); assert.equal(f.viewer.impl.showGhosting, true); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.025); assert.equal(f.meshes.length, 1);
  f.controller.clear(); assert.deepEqual({ defaultVisible: manager.defaultVisible, states: manager.states }, prior); assert.equal(f.viewer.impl.showGhosting, false); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.15); f.controller.dispose();
});

test('bounded metadata deduplicates SDK root, retains names/identities and marks native visibility unknown', async () => {
  const f = fixture();
  const first = await f.controller.readObjects({ cursor: 0, limit: 1, query: 'CAB' });
  assert.equal(first.objects.length, 1); assert.equal(first.objects[0].objectId, 2); assert.equal(first.objects[0].externalId, 'externalA');
  assert.equal(first.objects[0].nativeVisibility, 'unknown'); assert.equal(first.objects[0].derivation, 'display-aabb-bottom-centre'); assert.equal(first.nextCursor, 2);
  assert.ok(validateEnvelope(envelope('MODEL_OBJECTS', first), 'frame-to-parent'));
  const second = await f.controller.readObjects({ cursor: first.nextCursor, limit: 16, query: 'CAB' });
  assert.equal(second.objects[0].objectId, 3); assert.equal(second.complete, true); f.controller.dispose();
});

test('current model selection returns exact canonical bottom centres without changing the SDK selection', async () => {
  const f = fixture(); f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [2, 3] }];
  const selected = await f.controller.readSelection();
  assert.deepEqual(selected.objects.map(object => object.objectId), [2, 3]);
  assert.deepEqual(selected.objects[0].bottomCentre, modelCoordinates(f.model).toCanonical([2.5, 3, 3]));
  assert.ok(validateEnvelope(envelope('MODEL_SELECTION', selected), 'frame-to-parent'));
  f.viewer.getAggregateSelection = () => [{ model: {}, selection: [2] }];
  await assert.rejects(() => f.controller.readSelection(), { code: 'EXTRACTION_FAILED' });
  f.viewer.getAggregateSelection = () => [{ model: f.model, selection: Array.from({ length: 17 }, (_, index) => index + 1) }];
  await assert.rejects(() => f.controller.readSelection(), { code: 'SELECTION_TOO_LARGE' });
  f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [99] }];
  await assert.rejects(() => f.controller.readSelection(), { code: 'EXTRACTION_FAILED' }); f.controller.dispose();
});

test('path background transparency changes filled Ghost only and Clear restores each original fade', () => {
  const f = fixture(); assert.throws(() => f.controller.setTransparency(50), { code: 'PATH_INVALID' });
  f.controller.showPath({ points: [[0, 0, 0], [1, 0, 0]], objectIds: [2] });
  for (const percent of [0, 40, 100]) {
    f.controller.setTransparency(percent); assert.equal(f.viewer.impl.fadeMaterial.opacity, (100 - percent) / 100);
    assert.equal(f.viewer.impl.fadeMaterial.variants[0].opacity, (100 - percent) / 100);
    assert.equal(f.meshes[0].material.color, 0xffe600); assert.deepEqual(f.viewer.isolated, [2]);
  }
  for (const percent of [-1, 101, 1.5, NaN, '40']) assert.throws(() => f.controller.setTransparency(percent), { code: 'PATH_INVALID' });
  f.controller.clear(); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.15); assert.equal(f.viewer.impl.fadeMaterial.variants[0].opacity, 0.3); f.controller.dispose();
});

test('selection and route-rule protocol payloads are closed, bounded and retain explicit all-category exclusion', () => {
  const rule = { id: uuid(6), objectIds: [2], allowedCategories: [] }, payload = { captureId: uuid(7), routeRules: [rule], equipmentNames: [] };
  assert.ok(validateEnvelope(envelope('READ_SELECTION', {}))); assert.ok(validateEnvelope(envelope('START_MODEL_CAPTURE', payload)));
  for (const changes of [{ routeCodes: ['BC1'] }, { routeRules: [{ ...rule, objectIds: [2, 2] }] }, { routeRules: [{ ...rule, allowedCategories: ['Instrumentation'] }] }, { routeRules: [rule, rule] }, { routeRules: [{ ...rule, objectIds: [0] }] }]) assert.equal(validateEnvelope(envelope('START_MODEL_CAPTURE', { ...payload, ...changes })), null);
  assert.equal(validateEnvelope(envelope('START_MODEL_CAPTURE', { ...payload, routeRules: [{ ...rule, objectIds: Array.from({ length: 512 }, (_, index) => index + 1) }, { ...rule, id: uuid(8) }] })), null);
  assert.ok(validateEnvelope(envelope('SET_PATH_TRANSPARENCY', { routeRequestId: uuid(6), percent: 0 })));
  assert.equal(validateEnvelope(envelope('SET_PATH_TRANSPARENCY', { routeRequestId: uuid(6), percent: 100.1 })), null);
  assert.equal(validateEnvelope({ ...envelope('READ_SELECTION', {}), loadId: null, modelVersionId: null }), null);
});

test('one-shot picking converts only the owned model surface hit and cancellation removes listeners', async () => {
  const f = fixture(), abort = new AbortController();
  const pending = f.controller.pickPoint(abort.signal); abort.abort(); await assert.rejects(pending, { name: 'AbortError' });
  const picked = f.controller.pickPoint();
  for (const type of ['pointerdown', 'click']) {
    const event = new Event(type, { cancelable: true }); Object.assign(event, { button: 0, clientX: 13, clientY: 24 }); f.canvas.dispatchEvent(event);
  }
  assert.deepEqual(await picked, { objectId: 2, point: modelCoordinates(f.model).toCanonical([4, 5, 6]), derivation: 'picked-surface-point' }); f.controller.dispose();
});

test('new protocol payloads reject malformed, nonfinite, oversized and missing load identities', () => {
  const begin = envelope('BEGIN_COMPUTED_PATH', { pathId: uuid(6), pointCount: 2, objectIds: [2] });
  assert.ok(validateEnvelope(begin, 'parent-to-frame'));
  for (const objectIds of [[2, 2], [0], [1.5], Array.from({ length: 513 }, (_, i) => i + 1)]) assert.equal(validateEnvelope({ ...begin, payload: { ...begin.payload, objectIds } }), null);
  assert.equal(validateEnvelope({ ...begin, loadId: null, modelVersionId: null }), null);
  for (const points of [[[NaN, 0, 0]], [[0, Infinity, 0]], [[0, 0]], Array(129).fill([0, 0, 0])]) assert.equal(validateEnvelope(envelope('APPEND_COMPUTED_PATH', { pathId: uuid(6), offset: 0, points })), null);
  const chunk = envelope('APPEND_COMPUTED_PATH', { pathId: uuid(6), offset: 0, points: Array.from({ length: 128 }, () => [-1.1234567890123457e-100, -1.1234567890123457e-100, -1.1234567890123457e-100]) });
  assert.ok(validateEnvelope(chunk)); assert.ok(Buffer.byteLength(JSON.stringify(chunk)) < MAX_MESSAGE_BYTES);
  assert.equal(validateEnvelope(envelope('READ_MODEL_OBJECTS', { cursor: 0, limit: 17, query: '' })), null);
});

test('complete capture envelopes keep escaped non-ASCII text below 64KiB without relaxing global budgets', () => {
  const eventJson = JSON.stringify({ type: 'object-part', captureId: uuid(6), text: 'България\\"\n'.repeat(750) });
  const value = envelope('MODEL_CAPTURE_EVENT', { captureId: uuid(6), index: 1, done: false, eventJson });
  assert.ok(validateEnvelope(value, 'frame-to-parent')); assert.ok(Buffer.byteLength(JSON.stringify(value)) < 65536);
  assert.equal(validateEnvelope(envelope('MODEL_CAPTURE_EVENT', { captureId: uuid(6), index: 1, done: false, eventJson: 'x'.repeat(24577) })), null);
  assert.equal(validateEnvelope(envelope('READ_MODEL_CAPTURE', { captureId: uuid(6), index: 3000 })), null);
});
