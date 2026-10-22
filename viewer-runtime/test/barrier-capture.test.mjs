import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { captureSelectedBarriers, createBarrierCaptureAssembler, validateBarrierCaptureRequest,
  validateBarrierCaptureEvent, validateBarrierFrameObservation, barrierCanonicalJson, BARRIER_CAPTURE_VIEWER_LIMITS } from '../barrier-capture.mjs';

const id = number => `${String(number).padStart(8, '0')}-1111-4111-8111-111111111111`;
const loadId = id(4), sha = value => createHash('sha256').update(barrierCanonicalJson(value)).digest('hex');
const selected = (dbId = 2, selection = 5, name = 'Wall parent') => ({ selectionId: id(selection), kind: 'wall', objectId: 'dbid:' + dbId,
  dbId, externalId: null, name, identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' });
const request = (selectedParents = [selected()]) => ({ captureId: id(1), scope: { projectId: id(2), modelVersionId: id(3),
  contentFingerprint: 'a'.repeat(64), selectionRevision: '7', captureFrameId: id(6), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' }, selectedParents });
class Matrix {
  constructor(binary64) { this.elements = binary64 ? new Float64Array(16) : new Float32Array(16); this.makeScale(1, 1, 1); }
  makeScale(x, y, z) { this.elements.fill(0); this.elements[0] = x; this.elements[5] = y; this.elements[10] = z; this.elements[15] = 1; return this; }
  copy(other) { this.elements.set(other.elements); return this; }
  multiply(other) {
    const a = Array.from(this.elements), b = other.elements;
    for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) this.elements[column * 4 + row] = a[row] * b[column * 4]
      + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
    return this;
  }
}
function fixture(options = {}) {
  const names = new Map([[1, 'Plant'], [2, 'Wall parent'], [3, 'Nested frame'], [4, 'Unselected equipment']]);
  const parents = new Map([[1, 0], [2, 1], [3, 2], [4, 1]]), children = new Map([[1, [2, 4]], [2, [3]], [3, []], [4, []]]);
  const own = new Map([[1, []], [2, [0]], [3, [1]], [4, [2]]]);
  const geometries = new Map([0, 1, 2].map(value => [value, { vertices: [[0, 0, 0], [1000, 0, 0], [0, 1000, 0]], indices: [0, 1, 2] }]));
  const world = new Map([0, 1, 2].map(value => { const matrix = new Matrix(true); matrix.elements[12] = .123456789 + value; return [value, matrix]; }));
  const originalWorld = new Map([...world].map(([id, value]) => [id, new Matrix(true).copy(value)]));
  let scale = .001, offset = [100000000.125, 0, 0], up = [0, 0, 1], geometryCalls = 0;
  const tree = { getRootId: () => 1, getNodeName: id => names.get(id), getNodeParentId: id => parents.get(id),
    enumNodeChildren(id, visit, recursive) { assert.equal(recursive, false); for (const child of children.get(id) ?? []) visit(child); },
    enumNodeFragments(id, visit, recursive) { assert.equal(recursive, false); for (const fragment of own.get(id) ?? []) visit(fragment); },
    isNodeHidden() { throw new Error('Physical barrier capture must not read display hiding.'); }, isNodeOff() { throw new Error('Physical barrier capture must not read display off flags.'); } };
  const fragments = { getCount: () => 3, getGeometry(id) { geometryCalls++; options.onGeometry?.({ id, geometryCalls, geometries, world, children, own }); return geometries.get(id); },
    getWorldMatrix(id, into) { into.copy(world.get(id)); if (options.modelTransform) { const modelMatrix = new Matrix(true).copy(options.modelTransform); into.copy(modelMatrix.multiply(into)); } },
    getOriginalWorldMatrix(id, into) { into.copy(originalWorld.get(id)); }, isFragVisible() { throw new Error('Physical barrier capture must not depend on display visibility.'); } };
  const model = { getObjectTree: success => options.hangTree ? undefined : success(tree), getFragmentList: () => fragments, getUnitScale: () => scale,
    getUnitString: () => 'mm', getUpVector: () => up, getGlobalOffset: () => offset,
    getModelTransform: () => options.modelTransform ?? null, getPlacementTransform: () => options.placementTransform ?? null,
    getBulkProperties: (ids, properties, success) => { assert.equal(properties.ignoreHidden, false); assert.equal(properties.needsExternalId, true); success(ids.map(dbId => ({ dbId, externalId: 'external-' + dbId, properties: [] }))); } };
  const viewer = { model, isolate() { throw new Error('Capture must not isolate.'); }, clearSelection() { throw new Error('Capture must not change selection.'); } };
  globalThis.Autodesk = { Viewing: { Private: { LmvMatrix4: options.Matrix ?? Matrix,
    enumMeshVertices(geometry, visit) { geometry.vertices.forEach((point, index) => visit({ x: point[0], y: point[1], z: point[2] }, null, null, index)); options.afterVertices?.({ geometry, children, own, world }); },
    enumMeshTriangles(geometry, visit) { for (let i = 0; i < geometry.indices.length; i += 3) visit(null, null, null, ...geometry.indices.slice(i, i + 3)); },
  } } };
  globalThis.LMV_VIEWER_VERSION = '7.130.0';
  return { viewer, model, tree, fragments, names, parents, children, own, geometries, world, originalWorld, setScale(value) { scale = value; }, setOffset(value) { offset = value; }, setUp(value) { up = value; } };
}
async function collect(f = fixture(), input = request(), options = {}) {
  const assembler = createBarrierCaptureAssembler({ expectedRequest: input, loadId }), events = [];
  for await (const event of captureSelectedBarriers(f.viewer, input, { loadId, ...options })) { events.push(structuredClone(event)); assembler.accept(event); }
  return { ...await assembler.finish(), events, fixture: f };
}
const rejectCapture = async (f, input = request(), options = {}, pattern) => assert.rejects(async () => {
  for await (const _event of captureSelectedBarriers(f.viewer, input, { loadId, ...options })) { /* Consume without publishing. */ }
}, pattern);
function wideFixture(childCount) {
  const f = fixture(), ids = Array.from({ length: childCount }, (_, index) => index + 10);
  f.children.set(2, ids); f.own.set(3, []);
  for (const id of ids) { f.parents.set(id, 2); f.names.set(id, 'Physical hierarchy'); f.children.set(id, []); f.own.set(id, []); }
  return f;
}

test('selected parent retains its own and all descendant original triangle fragments', async () => {
  const result = await collect(); assert.deepEqual(result.capture.fragments.map(item => item.source.fragmentId), [0, 1]);
  assert.deepEqual(result.capture.fragments.map(item => item.source.ownerObjectId), ['dbid:2', 'dbid:3']);
  assert.deepEqual(result.capture.selectedParents, request().selectedParents);
  for (const item of result.capture.fragments) assert.deepEqual(item.triangleIndices, [0, 1, 2]);
  assert.equal(result.capture.observation.state, 'reported-complete'); assert.equal(result.capture.observation.verification, 'unverified');
  assert.equal(result.frameObservation.contentFingerprint, request().scope.contentFingerprint); assert.equal(result.frameObservation.loadId, loadId);
});
test('a wide parent below the unchanged closure ceiling counts pending siblings once', async () => {
  const childCount = Math.floor(BARRIER_CAPTURE_VIEWER_LIMITS.closureObjects / 2) + 1, f = wideFixture(childCount);
  let childReads = 0; const readChildren = f.tree.enumNodeChildren;
  f.tree.enumNodeChildren = (id, visit, recursive) => { if (id >= 10) childReads++; return readChildren(id, visit, recursive); };
  const result = await collect(f);
  assert.equal(result.capture.fragments.length, 1); assert.equal(result.capture.fragments[0].source.ownerObjectId, 'dbid:2');
  assert.deepEqual(result.capture.fragments[0].triangleIndices, [0, 1, 2]);
  assert.equal(result.capture.observation.state, 'reported-complete'); assert.equal(childReads, childCount * 2, 'Every child is enumerated and checked again before completion');
  assert.ok(childCount + 1 < BARRIER_CAPTURE_VIEWER_LIMITS.closureObjects);
});
test('a genuinely oversized pending hierarchy still refuses before a complete capture', async () => {
  const f = wideFixture(BARRIER_CAPTURE_VIEWER_LIMITS.closureObjects + 1), events = [];
  await assert.rejects(async () => { for await (const event of captureSelectedBarriers(f.viewer, request(), { loadId })) events.push(event.type); }, { code: 'BARRIER_CAPTURE_HIERARCHY_LIMIT' });
  assert.deepEqual(events, ['metadata']);
});

test('an explicit generic obstacle parent retains all original descendant geometry and its classification', async () => {
  const f = fixture(); f.names.set(2, 'Mixed obstacle group');
  const input = request([{ ...selected(2, 5, 'Mixed obstacle group'), kind: 'obstacle' }]);
  const result = await collect(f, input);
  assert.deepEqual(result.capture.selectedParents, input.selectedParents);
  assert.deepEqual(result.capture.fragments.map(item => item.source.fragmentId), [0, 1]);
  for (const fragment of result.capture.fragments) assert.deepEqual(fragment.triangleIndices, [0, 1, 2]);
  assert.equal(result.capture.observation.verification, 'unverified');
});

test('existing structural kinds remain supported while undeclared obstacle kinds are refused', () => {
  for (const kind of ['wall', 'partition', 'floor', 'ceiling'])
    assert.equal(validateBarrierCaptureRequest(request([{ ...selected(), kind }])), true);
  for (const kind of ['pipe', 'tank', 'mixed', 'Obstacle', '', 'unknown'])
    assert.equal(validateBarrierCaptureRequest(request([{ ...selected(), kind }])), false);
});
test('overlapping parent selections deduplicate physical meshes and retain every selection membership', async () => {
  const input = request([selected(), selected(3, 7, 'Nested frame')]), result = await collect(fixture(), input);
  assert.equal(result.capture.fragments.length, 2); assert.deepEqual(result.capture.fragments[1].source.parentSelectionIds, [id(5), id(7)]);
});
test('display-hidden physical geometry is included without display or appearance API dependencies', async () => {
  const result = await collect(); assert.equal(result.capture.fragments.length, 2);
});
test('binary64 transform applies fragment placement and model scale/global offset exactly once', async () => {
  const f = fixture(), result = await collect(f), fragment = result.capture.fragments[0];
  const expected = 100000000.125 * .001 + .123456789 * .001;
  assert.ok(Math.abs(fragment.verticesMetres[0][0] - expected) < 1e-10);
  assert.ok(Math.abs(fragment.verticesMetres[1][0] - (expected + 1)) < 1e-10);
  assert.equal(fragment.source.metresPerSourceUnit, .001); assert.equal(fragment.source.sourceUnits, 'mm');
  assert.equal(fragment.source.sourceToWorldMetres[12], expected); assert.equal(fragment.source.transformSha256, sha(fragment.source.sourceToWorldMetres));
});
test('root/model placement is observed but never multiplied for a second time', async () => {
  const placement = new Matrix(true); placement.elements[12] = 75;
  const first = await collect(fixture()), second = await collect(fixture({ modelTransform: placement, placementTransform: placement }));
  for (let index = 0; index < 3; index++) assert.ok(Math.abs(second.capture.fragments[0].verticesMetres[index][0] - first.capture.fragments[0].verticesMetres[index][0] - .075) < 1e-10);
  assert.equal(second.frameObservation.modelTransform[12], 75); assert.equal(second.frameObservation.placementTransform[12], 75);
});
test('animated or exploded fragment transforms refuse instead of moving physical barriers', async () => {
  const f = fixture(); f.world.get(0).elements[12] += 10; await rejectCapture(f, request(), {}, { code: 'BARRIER_CAPTURE_FRAME_UNSUPPORTED' });
});
test('missing original physical fragment matrix API refuses', async () => {
  const f = fixture(); delete f.fragments.getOriginalWorldMatrix; await rejectCapture(f);
});
test('original physical transform changed during capture refuses', async () => {
  const f = fixture(); let changed = false; const read = f.fragments.getGeometry;
  f.fragments.getGeometry = id => { const result = read(id); if (!changed) { changed = true; f.originalWorld.get(0).elements[12] += 10; } return result; };
  await rejectCapture(f);
});
test('connected frame opening retains all original triangles and does not fabricate a bounding box mesh', async () => {
  const f = fixture(), outer = [[-2, -2], [2, -2], [2, 2], [-2, 2]], inner = [[-.6, -.8], [.6, -.8], [.6, .8], [-.6, .8]], vertices = [], indices = [];
  for (const x of [0, .2]) vertices.push(...outer.map(([y, z]) => [x, y, z]), ...inner.map(([y, z]) => [x, y, z]));
  const quad = (a, b, c, d) => indices.push(a, b, c, a, c, d);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(i, 4 + i, 4 + j, j); quad(8 + i, 8 + j, 12 + j, 12 + i); quad(i, j, 8 + j, 8 + i); quad(4 + i, 12 + i, 12 + j, 4 + j); }
  f.geometries.set(0, { vertices, indices }); f.own.set(3, []); const result = await collect(f);
  assert.equal(result.capture.fragments[0].verticesMetres.length, 16); assert.deepEqual(result.capture.fragments[0].triangleIndices, indices);
  assert.equal(indices.length / 3, 32); assert.equal(result.capture.fragments.length, 1);
});
test('empty selected parent cannot produce an empty complete barrier scope', async () => { const f = fixture(); f.own.set(2, []); f.own.set(3, []); await rejectCapture(f, request(), {}, { code: 'BARRIER_CAPTURE_GEOMETRY_NOT_READY' }); });
test('nonresident selected mesh refuses instead of declaring a partial scope complete', async () => { const f = fixture(); f.geometries.delete(1); await rejectCapture(f, request(), {}, { code: 'BARRIER_CAPTURE_GEOMETRY_NOT_READY' }); });
test('nontriangle fragments refuse rather than silently disappearing', async () => { const f = fixture(); f.geometries.get(1).isLines = true; await rejectCapture(f, request(), {}, { code: 'BARRIER_CAPTURE_UNSUPPORTED_PRIMITIVE' }); });
test('invalid original triangle index refuses', async () => { const f = fixture(); f.geometries.get(1).indices = [0, 1, 99]; await rejectCapture(f); });
test('repeated triangle index refuses', async () => { const f = fixture(); f.geometries.get(1).indices = [0, 1, 1]; await rejectCapture(f); });
test('nonfinite original vertex refuses', async () => { const f = fixture(); f.geometries.get(1).vertices[0][0] = NaN; await rejectCapture(f); });
test('nonfinite and singular fragment world matrices refuse', async () => {
  for (const value of [NaN, 0]) { const f = fixture(); f.world.get(0).elements[0] = value; await rejectCapture(f); }
});
test('binary32 SDK matrices are refused', async () => { class FloatMatrix extends Matrix { constructor() { super(false); } } await rejectCapture(fixture({ Matrix: FloatMatrix })); });
test('unsupported up axis and missing/nonfinite global offset refuse', async () => {
  for (const value of [[1, 0, 0], [0, 0, NaN]]) { const f = fixture(); f.setUp(value); await rejectCapture(f); }
  for (const value of [null, [Infinity, 0, 0]]) { const f = fixture(); f.setOffset(value); await rejectCapture(f); }
});
test('invalid returned model transform refuses rather than becoming unavailable/null', async () => { await rejectCapture(fixture({ modelTransform: { elements: [NaN] } })); });
test('cross-tree selected parent and stale selected name refuse', async () => {
  const f = fixture(); f.parents.set(2, 99); await rejectCapture(f); await rejectCapture(fixture(), request([selected(2, 5, 'Other name')]));
});
test('provided external identity is checked against bounded actual SDK properties', async () => {
  const input = request(); input.selectedParents[0].externalId = 'external-2'; assert.equal((await collect(fixture(), input)).capture.selectedParents[0].externalId, 'external-2');
  input.selectedParents[0].externalId = 'different'; await rejectCapture(fixture(), input);
  const f = fixture(); f.model.getBulkProperties = (_ids, _properties, success) => success([]); await rejectCapture(f, input);
});
test('cyclic or repeated children refuse', async () => { for (const values of [[2], [3, 3]]) { const f = fixture(); f.children.set(2, values); await rejectCapture(f); } });
test('conflicting fragment owners refuse while overlapping selected roots are allowed', async () => { const f = fixture(); f.own.set(3, [0]); await rejectCapture(f); });
test('selected geometry mutation before completion refuses', async () => {
  let changed = false; const f = fixture({ afterVertices({ world }) { if (!changed) { changed = true; world.get(0).elements[12] += 10; } } }); await rejectCapture(f);
});
test('selected hierarchy mutation before completion refuses', async () => {
  let changed = false; const f = fixture({ afterVertices({ children }) { if (!changed) { changed = true; children.set(2, []); } } }); await rejectCapture(f);
});
test('model replacement invalidates capture even before the next SDK read', async () => {
  const f = fixture(), iterator = captureSelectedBarriers(f.viewer, request(), { loadId }); assert.equal((await iterator.next()).value.type, 'metadata'); f.viewer.model = {};
  await assert.rejects(iterator.next(), { code: 'BARRIER_CAPTURE_MODEL_CHANGED' });
});
test('already cancelled and callback-wait cancellation never complete', async () => {
  const cancelled = new AbortController(); cancelled.abort(); await rejectCapture(fixture(), request(), { signal: cancelled.signal });
  const f = fixture({ hangTree: true }), controller = new AbortController(), iterator = captureSelectedBarriers(f.viewer, request(), { loadId, signal: controller.signal });
  const pending = iterator.next(); controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
});
test('expired capture and bounded event count refuse without a terminal complete event', async () => {
  await rejectCapture(fixture(), request(), { startedAt: Date.now() - BARRIER_CAPTURE_VIEWER_LIMITS.milliseconds }, { code: 'BARRIER_CAPTURE_DEADLINE' });
  const f = fixture(); f.geometries.get(0).vertices = Array.from({ length: 3000 }, (_, index) => [index, index / 7, index / 3]);
  await rejectCapture(f, request(), { eventLimit: 3 }, { code: 'BARRIER_CAPTURE_PAYLOAD_LIMIT' });
});
test('an excessive vertex index has a bounded vertex-limit reason without changing the ceiling', async () => {
  const f = fixture(); globalThis.Autodesk.Viewing.Private.enumMeshVertices = (_geometry, visit) => visit({ x: 0, y: 0, z: 0 }, null, null, BARRIER_CAPTURE_VIEWER_LIMITS.vertices);
  await rejectCapture(f, request(), {}, { code: 'BARRIER_CAPTURE_VERTEX_LIMIT' });
});
test('sparse SDK vertex callback indices refuse', async () => {
  const f = fixture(); globalThis.Autodesk.Viewing.Private.enumMeshVertices = (_geometry, visit) => { visit({ x: 0, y: 0, z: 0 }, null, null, 0); visit({ x: 1, y: 1, z: 0 }, null, null, 2); }; await rejectCapture(f);
});
test('aggregate selected fragment count refuses before retaining a partial mesh set', async () => {
  const f = fixture(); f.fragments.getCount = () => BARRIER_CAPTURE_VIEWER_LIMITS.fragments + 1;
  f.own.set(2, Array.from({ length: BARRIER_CAPTURE_VIEWER_LIMITS.fragments + 1 }, (_, index) => index));
  await rejectCapture(f, request(), {}, { code: 'BARRIER_CAPTURE_FRAGMENT_LIMIT' });
});
test('aggregate original triangle count refuses without truncating original indices', async () => {
  const f = fixture(); globalThis.Autodesk.Viewing.Private.enumMeshTriangles = (_geometry, visit) => {
    for (let index = 0; index <= BARRIER_CAPTURE_VIEWER_LIMITS.triangles; index++) visit(null, null, null, 0, 1, 2);
  }; await rejectCapture(f, request(), {}, { code: 'BARRIER_CAPTURE_TRIANGLE_LIMIT' });
});
test('capture refusals carry a safe fixed reason without parent names or raw SDK errors', async () => {
  const f = fixture(); f.names.set(2, 'PRIVATE-MODEL-NAME');
  await assert.rejects(async () => { for await (const _event of captureSelectedBarriers(f.viewer, request(), { loadId })) { /* no publication */ } }, error => error.code === 'BARRIER_CAPTURE_MODEL_CHANGED' && !error.message.includes('PRIVATE-MODEL-NAME'));
  const next = fixture(); next.model.getObjectTree = () => { throw Error('PRIVATE-SDK-FAILURE'); };
  await assert.rejects(async () => { for await (const _event of captureSelectedBarriers(next.viewer, request(), { loadId })) { /* no publication */ } }, error => error.code === 'BARRIER_CAPTURE_GEOMETRY_NOT_READY' && !error.message.includes('PRIVATE-SDK-FAILURE'));
});
test('input identities are strict and accessor claims are rejected', () => {
  const input = request(); assert.equal(validateBarrierCaptureRequest(input), true);
  for (const mutate of [value => { value.extra = true; }, value => { value.scope.selectionRevision = '9223372036854775808'; },
    value => { value.selectedParents[0].objectId = 'dbid:3'; }, value => { value.selectedParents.push(value.selectedParents[0]); },
    value => { value.selectedParents[0].name = '\ud800'; }]) { const value = structuredClone(input); mutate(value); assert.equal(validateBarrierCaptureRequest(value), false); }
  const accessor = { ...input }; Object.defineProperty(accessor, 'captureId', { get() { throw new Error('Do not read.'); }, enumerable: true }); assert.equal(validateBarrierCaptureRequest(accessor), false);
});
test('metadata observation has a separate actual frame hash and no verification assertion', async () => {
  const result = await collect(), observed = result.frameObservation, { contentSha256, ...body } = observed;
  assert.equal(contentSha256, sha(body)); assert.notEqual(contentSha256, request().scope.captureFrameSha256);
  assert.equal(Object.hasOwn(observed, 'verified'), false); assert.equal(validateBarrierFrameObservation(observed), true);
});
test('caller request mutation after metadata cannot alter the detached capture scope', async () => {
  const f = fixture(), input = request(), original = structuredClone(input), assembler = createBarrierCaptureAssembler({ expectedRequest: original, loadId }); let once = false;
  for await (const event of captureSelectedBarriers(f.viewer, input, { loadId })) { assembler.accept(event); if (!once) { once = true; input.selectedParents[0].name = 'Changed caller'; input.scope.selectionRevision = '999'; } }
  assert.deepEqual((await assembler.finish()).capture.selectedParents, original.selectedParents);
});
test('missing, reordered, duplicate, cross-load and cross-model event streams cannot assemble', async () => {
  const { events } = await collect();
  for (const mutate of [values => { values.shift(); }, values => { values.splice(1, 0, values[1]); }, values => { values[1].partIndex++; },
    values => { values[0].scope.modelVersionId = id(99); }, values => { values[0].frameObservation.loadId = id(99); }, values => { values[0].captureId = id(99); },
    values => { values[0].frameObservation.verified = true; }]) {
    const assembler = createBarrierCaptureAssembler({ expectedRequest: request(), loadId }), copy = structuredClone(events); mutate(copy);
    assert.throws(() => copy.forEach(event => assembler.accept(event))); await assert.rejects(assembler.finish());
  }
});
test('missing final event and incomplete text cannot publish a capture', async () => {
  const { events } = await collect(); const assembler = createBarrierCaptureAssembler({ expectedRequest: request(), loadId });
  events.slice(0, -1).forEach(event => assembler.accept(event)); await assert.rejects(assembler.finish());
});
test('capture, frame, transform and enumeration hash forgery refuses', async () => {
  const { events } = await collect();
  for (const change of ['capture', 'frame', 'transform', 'enumeration']) {
    const copy = structuredClone(events), assembler = createBarrierCaptureAssembler({ expectedRequest: request(), loadId });
    if (change === 'capture') copy.at(-1).captureSha256 = 'f'.repeat(64);
    else if (change === 'frame') copy[0].frameObservation.globalOffsetMetres[0]++;
    else {
      const capture = JSON.parse(copy.filter(event => event.type === 'capture-part').map(event => event.text).join(''));
      if (change === 'transform') capture.fragments[0].source.transformSha256 = 'f'.repeat(64); else capture.observation.enumerationSha256 = 'f'.repeat(64);
      const body = barrierCanonicalJson(capture); copy.splice(1, copy.length - 2, { type: 'capture-part', captureId: request().captureId, partIndex: 0, final: true, text: body }); copy.at(-1).captureSha256 = sha(capture);
    }
    copy.forEach(event => assembler.accept(event)); await assert.rejects(assembler.finish());
  }
});
test('canonical JSON rejects duplicate capture keys and unexpected ready assertions', async () => {
  const { events } = await collect();
  for (const change of ['duplicate', 'ready']) {
    const copy = structuredClone(events), assembler = createBarrierCaptureAssembler({ expectedRequest: request(), loadId });
    const capture = JSON.parse(copy.filter(event => event.type === 'capture-part').map(event => event.text).join(''));
    if (change === 'ready') capture.ready = true;
    const canonical = barrierCanonicalJson(capture), body = change === 'duplicate' ? '{"captureId":"' + capture.captureId + '",' + canonical.slice(1) : canonical;
    copy.splice(1, copy.length - 2, { type: 'capture-part', captureId: request().captureId, partIndex: 0, final: true, text: body }); copy.at(-1).captureSha256 = sha(capture);
    copy.forEach(event => assembler.accept(event)); await assert.rejects(assembler.finish());
  }
});
test('adaptive Unicode text parts stay within transport limit and preserve complete names', async () => {
  const f = fixture(), name = '🧱'.repeat(800); f.names.set(2, name); const input = request([selected(2, 5, name)]);
  f.geometries.get(0).vertices = Array.from({ length: 1500 }, (_, index) => [index / 3, index / 7, index / 11]);
  const result = await collect(f, input); assert.equal(result.capture.selectedParents[0].name, name); assert.ok(result.events.filter(event => event.type === 'capture-part').length > 1);
  for (const event of result.events) { assert.equal(validateBarrierCaptureEvent(event), true); assert.ok(Buffer.byteLength(barrierCanonicalJson(event)) <= BARRIER_CAPTURE_VIEWER_LIMITS.eventBytes); }
});
