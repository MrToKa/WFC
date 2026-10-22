import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BARRIER_MULTIPART_PLANNER_PROFILE as profile } from '../barrier-plan.mjs';
import { barrierCanonicalJson, validateBarrierFrameObservation } from '../barrier-capture.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE } from '../barrier-multipart-protocol.mjs';
import { createBarrierMultipartProducer, createBarrierPackedProducer, observeMultipartFrame, BARRIER_MULTIPART_PRODUCER_LIMITS as L } from '../barrier-producer.mjs';

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha256 = async value => createHash('sha256').update(value).digest('hex');
class Matrix {
  constructor() { this.elements = new Float64Array(16); this.identity(); }
  identity() { this.elements.fill(0); for (let i = 0; i < 4; i++) this.elements[i * 5] = 1; return this; }
  makeScale(x, y, z) { this.identity(); this.elements[0] = x; this.elements[5] = y; this.elements[10] = z; return this; }
  copy(other) { this.elements.set(other.elements); return this; }
  multiply(other) { const a = this.elements, b = other.elements, result = new Float64Array(16);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) result[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1]
      + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    this.elements.set(result); return this; }
}
const geometry = () => ({ attributes: { position: { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), itemSize: 3, normalized: false } }, ib: new Uint16Array([0, 1, 2, 1, 3, 2]) });
function fixture({ selected = [3, 10], mesh = geometry(), oneFragment = false } = {}) {
  const nodes = [1, 3, 4, 10, 11], byId = new Map(nodes.map((value, index) => [value, index]));
  const children = new Map([[1, [3, 10]], [3, [4]], [4, []], [10, [11]], [11, []]]), parents = new Map([[1, 1], [3, 1], [4, 3], [10, 1], [11, 10]]);
  const own = new Map([[4, [0]], [11, oneFragment ? [] : [1]]]), rawNodes = new Int32Array(nodes.length * 6);
  for (const [index, value] of nodes.entries()) rawNodes[index * 6] = value;
  const tree = { nodeAccess: { nodes: rawNodes, getNumNodes: () => nodes.length }, getRootId: () => 1, getNodeIndex: value => byId.get(value),
    getNodeParentId: value => parents.get(value), enumNodeChildren: (value, visit) => (children.get(value) ?? []).forEach(child => visit(child)),
    enumNodeFragments: (value, visit) => (own.get(value) ?? []).forEach(fragment => visit(fragment)) };
  const worlds = [new Matrix(), new Matrix()]; worlds[1].elements[12] = 10;
  const list = { getCount: () => oneFragment ? 1 : 2, getGeometry: () => mesh,
    getOriginalWorldMatrix: (fragment, result) => result.copy(worlds[fragment]), getWorldMatrix: (fragment, result) => result.copy(worlds[fragment]),
    isFragVisible() { throw Error('Hidden/Ghost display state is not a manual barrier filter.'); } };
  const model = { getFragmentList: () => list, getObjectTree: yes => yes(tree), getUnitScale: () => 1, getUnitString: () => 'm',
    getUpVector: () => ({ x: 0, y: 0, z: 1 }), getGlobalOffset: () => ({ x: 0, y: 0, z: 0 }), getModelTransform: () => null, getPlacementTransform: () => null };
  globalThis.LMV_VIEWER_VERSION = '7.130.0';
  globalThis.Autodesk = { Viewing: { Private: { LmvMatrix4: Matrix,
    getVertexCount: geo => geo.vb ? geo.vb.length / geo.vbstride : geo.attributes.position.array.length / geo.attributes.position.itemSize,
    getIndicesCount: geo => { const indices = geo.ib ?? geo.indices ?? geo.index?.array;
      return indices ? geo.groups?.length ? geo.groups.reduce((sum, group) => sum + group.count, 0) : indices.length
        : geo.attributes.position.array.length / geo.attributes.position.itemSize; },
    makeReadPositionFunc: geo => { const array = geo.vb ?? geo.attributes.position.array, stride = geo.vb ? geo.vbstride : geo.attributes.position.itemSize, offset = geo.vblayout?.position.offset ?? 0;
      return (index, out) => { out.x = array[index * stride + offset]; out.y = array[index * stride + offset + 1]; out.z = array[index * stride + offset + 2]; }; },
  } } };
  let current = true;
  const scope = { schemaVersion: 'wfc.pf.barrier-multipart-scope.v2', modelScope: { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64),
    selectionRevision: '1', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' }, modelLoadId: id(4),
  selectedParents: selected.map((dbId, index) => ({ selectionId: id(10 + index), dbId, kind: 'obstacle' })), geometryPolicy: profile.geometryPolicy };
  const viewer = { model }, stored = new Map(), events = [], progress = [];
  const readPages = async function* (kind) { for (const page of stored.get(kind) ?? []) yield structuredClone(page); };
  async function options(extra = {}) { return { scope, profile, loadId: id(4), isCurrent: () => current, sha256, producerProfile: BARRIER_MULTIPART_PRODUCER_PROFILE,
    frameObservation: await observeMultipartFrame(viewer, scope.modelScope, { loadId: id(4), isCurrent: () => current, sha256 }),
    readPages, onProgress: value => progress.push(value), ...extra }; }
  async function consume(extra = {}, after) { const result = createBarrierMultipartProducer(viewer, await options(extra));
    for await (const event of result) { events.push(event); if (event.kind === 'page') { if (!stored.has(event.page.kind)) stored.set(event.page.kind, []); stored.get(event.page.kind).push(structuredClone(event.page)); }
      if (after) await after(event); } return events; }
  async function consumePacked(extra = {}, after) { const result = createBarrierPackedProducer(viewer, await options({ packedContext: { intentId: id(100), contextSha256: 'c'.repeat(64) }, ...extra }));
    for await (const event of result) { events.push(event); if (event.kind === 'page') { if (!stored.has(event.page.kind)) stored.set(event.page.kind, []); stored.get(event.page.kind).push(structuredClone(event.page)); }
      if (after) await after(event); } return events; }
  return { viewer, model, tree, list, children, parents, own, mesh, worlds, scope, stored, events, progress, options, consume, consumePacked, setCurrent: value => { current = value; } };
}
const records = (fixture, kind) => (fixture.stored.get(kind) ?? []).flatMap(page => page.records);
const planSeal = fixture => fixture.events.find(event => event.kind === 'seal' && event.seal.kind === 'plan')?.seal;
async function expectedIndexHash(values, domain) {
  const manifest = { encoding: 'uint32-little-endian', values: values.length }, prefix = { schemaVersion: 'sha256-bounded-chunk-chain-v1', domain, manifest };
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer); values.forEach((value, index) => view.setUint32(index * 4, value, true));
  let previous = await sha256(new TextEncoder().encode(barrierCanonicalJson(prefix)));
  previous = await sha256(new TextEncoder().encode(barrierCanonicalJson({ schemaVersion: prefix.schemaVersion, domain, previous, segmentOrdinal: 0, offset: 0,
    bytes: bytes.byteLength, sha256: await sha256(bytes), chunkOrdinal: 0 })));
  return sha256(new TextEncoder().encode(barrierCanonicalJson({ ...prefix, previous, totalBytes: bytes.byteLength, chunks: 1, segmentCount: 1 })));
}

test('pre-admission frame observation reads no hierarchy or geometry and pins physical binary64 metadata', async () => {
  const f = fixture(); f.model.getObjectTree = () => { throw Error('No tree read for frame.'); }; f.model.getFragmentList = () => { throw Error('No geometry read for frame.'); };
  const observation = await observeMultipartFrame(f.viewer, f.scope.modelScope, { loadId: id(4), isCurrent: () => true, sha256 });
  assert.equal(validateBarrierFrameObservation(observation), true); assert.equal(observation.loadId, id(4)); assert.equal(observation.sdkVersion, '7.130.0');
});
test('two exact parents produce bounded four-stream pages and seals, shared geometry stays separate physical occurrences', async () => {
  const f = fixture(); await f.consume(); assert.deepEqual(f.events.filter(event => event.kind === 'seal').map(event => event.seal.kind), ['nodes', 'fragments', 'geometry-ranges', 'plan']);
  const fragments = records(f, 'fragments'); assert.equal(fragments.length, 2); assert.equal(fragments[0].sourceGeometrySha256, fragments[1].sourceGeometrySha256);
  assert.notEqual(fragments[0].transformSha256, fragments[1].transformSha256); assert.deepEqual(fragments.map(row => row.ownerDbId), [4, 11]);
  assert.deepEqual(fragments.map(row => row.membershipMask), ['0'.repeat(31) + '1', '0'.repeat(31) + '2']);
  assert.equal(planSeal(f).authority, 'none'); assert.equal(planSeal(f).qualification, 'NOT_MEASURED');
  assert.ok(f.progress[0].lookupBytes <= L.lookupBytes); assert.ok(f.progress[0].metadataBytes <= L.metadataBytes);
  assert.ok(f.events.every(event => event.kind !== 'page' || event.page.records.length <= 512 && Buffer.byteLength(JSON.stringify(event.page)) <= 262144));
});
test('nested selected parent overlap unions membership and never duplicates one physical occurrence', async () => {
  const f = fixture({ selected: [3, 4, 10] }); await f.consume(); const fragments = records(f, 'fragments');
  assert.equal(fragments.length, 2); assert.equal(fragments[0].membershipMask, '0'.repeat(31) + '3'); assert.equal(fragments[1].membershipMask, '0'.repeat(31) + '4');
});
test('manual whole-parent barriers include hidden or Ghost geometry without calling display filtering APIs', async () => {
  const f = fixture(); f.tree.isNodeHidden = () => true; f.tree.isNodeOff = () => true; f.model.visibilityManager = { getVisibility() { throw Error('No appearance mutation/read.'); } };
  await f.consume(); assert.equal(records(f, 'fragments').length, 2); assert.equal(BARRIER_MULTIPART_PRODUCER_PROFILE.visibility, 'selected-scope-includes-hidden-geometry-v1');
});
test('rendered group order and baseVertex mapping preserve gaps rather than invent unused IB triangles', async () => {
  const mesh = geometry(); mesh.attributes.position.array = new Float32Array(21).map((_, index) => index % 3 === 0 ? index : 0);
  mesh.ib = new Uint16Array([0, 1, 2, 4, 5, 6, 0, 1, 2]); mesh.groups = [{ start: 6, count: 3, index: 3 }, { start: 0, count: 3, index: 0 }];
  const f = fixture({ selected: [3], oneFragment: true, mesh }); await f.consume(); const [range] = records(f, 'geometry-ranges');
  assert.equal(range.triangleCount, 2); assert.equal(range.sourceIndicesSha256, await expectedIndexHash([3, 4, 5, 0, 1, 2], 'sdk7130-rendered-original-indices-v1'));
  assert.notEqual(range.sourceIndicesSha256, await expectedIndexHash([0, 1, 2, 4, 5, 6, 0, 1, 2], 'sdk7130-rendered-original-indices-v1'));
});
test('overlapping, incomplete and invalid groups refuse before fragment seal', async () => {
  for (const groups of [[{ start: 0, count: 6, index: 0 }, { start: 3, count: 3, index: 0 }], [{ start: 1, count: 3, index: 0 }], [{ start: 0, count: 9, index: 0 }]]) {
    const f = fixture(); f.mesh.groups = groups; await assert.rejects(f.consume(), error => /^BARRIER_MULTIPART_GROUP_/.test(error.code)); assert.equal(planSeal(f), undefined);
  }
});
test('interleaved and nonindexed original positions use the pinned random reader without full coordinate arrays', async () => {
  const mesh = { attributes: {}, vb: new Float32Array([99, 0, 0, 0, 88, 99, 1, 0, 0, 88, 99, 0, 1, 0, 88]), vbstride: 5,
    vblayout: { position: { offset: 1, itemSize: 3, bytesPerItem: 4 } }, ib: new Uint32Array([0, 1, 2]) };
  const first = fixture({ selected: [3], oneFragment: true, mesh }); await first.consume(); assert.equal(records(first, 'geometry-ranges')[0].referencedVertexCount, 3);
  const plain = geometry(); delete plain.ib; plain.attributes.position.array = plain.attributes.position.array.subarray(0, 9);
  const second = fixture({ selected: [3], oneFragment: true, mesh: plain }); await second.consume(); assert.equal(records(second, 'geometry-ranges')[0].triangleCount, 1);
});
test('source-byte and original-transform signed zero change the explicit versioned identities', async () => {
  const first = fixture({ selected: [3], oneFragment: true }); await first.consume(); const firstFragment = records(first, 'fragments')[0];
  const second = fixture({ selected: [3], oneFragment: true }); second.mesh.attributes.position.array[0] = -0; second.worlds[0].elements[12] = -0;
  await second.consume(); const secondFragment = records(second, 'fragments')[0];
  assert.notEqual(firstFragment.sourceGeometrySha256, secondFragment.sourceGeometrySha256); assert.notEqual(firstFragment.transformSha256, secondFragment.transformSha256);
  assert.equal(BARRIER_MULTIPART_PRODUCER_PROFILE.geometryDigest, 'sha256-bounded-chunk-chain-v1');
});
test('a single source fragment larger than a part is split into contiguous bounded original ranges', { timeout: 120000 }, async () => {
  const vertices = 600003, mesh = { attributes: { position: { array: new Float32Array(vertices * 3), itemSize: 3 } } };
  const f = fixture({ selected: [3], oneFragment: true, mesh }); await f.consume(); const ranges = records(f, 'geometry-ranges');
  assert.ok(ranges.length > 1); let end = 0; for (const range of ranges) { assert.equal(range.triangleStart, end); end += range.triangleCount;
    assert.ok(range.triangleCount <= 250000 && range.referencedVertexCount <= 500000); }
  assert.equal(end, vertices / 3); assert.equal(planSeal(f).totals.triangles, vertices / 3);
});
test('unknown or nontriangle physical occurrences are explicit and cannot seal a partial inventory', async () => {
  for (const primitive of ['lines', 'points', 'unknown', 'unavailable']) {
    const f = fixture({ selected: [3], oneFragment: true }); if (primitive === 'unavailable') f.list.getGeometry = () => null;
    else f.mesh[primitive === 'lines' ? 'isLines' : primitive === 'points' ? 'isPoints' : 'is2d'] = true;
    await assert.rejects(f.consume(), { code: 'BARRIER_MULTIPART_PRIMITIVE_' + primitive.toUpperCase() });
    assert.equal(records(f, 'fragments')[0].primitive, primitive); assert.equal(f.events.some(event => event.kind === 'seal' && event.seal.kind === 'fragments'), false);
  }
});
test('invalid indices, nonfinite vertices and animation are refused without a final plan seal', async () => {
  const invalid = fixture({ selected: [3], oneFragment: true }); invalid.mesh.ib[0] = 99; await assert.rejects(invalid.consume(), { code: 'BARRIER_MULTIPART_INDEX_INVALID' });
  const finite = fixture({ selected: [3], oneFragment: true }); finite.mesh.attributes.position.array[0] = Infinity; await assert.rejects(finite.consume(), { code: 'BARRIER_MULTIPART_VERTEX_INVALID' });
  const animated = fixture({ selected: [3], oneFragment: true }); animated.list.getWorldMatrix = (_id, matrix) => { matrix.identity(); matrix.elements[12] = 9; };
  await assert.rejects(animated.consume(), { code: 'BARRIER_MULTIPART_TRANSFORM_CHANGED' }); assert.equal(planSeal(invalid), undefined); assert.equal(planSeal(finite), undefined);
});
test('SDK indexing metadata is bounded before lookup allocation and hierarchy cycles/conflicting owners refuse', async () => {
  const big = fixture(); big.tree.nodeAccess.getNumNodes = () => 1048577; await assert.rejects(big.consume()); assert.equal(big.progress.length, 0);
  const cycle = fixture(); cycle.children.set(4, [3]); cycle.parents.set(3, 4); await assert.rejects(cycle.consume(), { code: 'BARRIER_MULTIPART_HIERARCHY_INVALID' });
  const owner = fixture(); owner.own.set(3, [0]); await assert.rejects(owner.consume(), { code: 'BARRIER_MULTIPART_FRAGMENT_OWNER_INVALID' });
});
test('mutable SDK source and final hierarchy/frame changes cannot complete despite earlier staged pages', async () => {
  const source = fixture(); await assert.rejects(source.consume({}, event => { if (event.kind === 'seal' && event.seal.kind === 'fragments') source.mesh.attributes.position.array[0] = 9; }), { code: 'BARRIER_MULTIPART_GEOMETRY_CHANGED' });
  const hierarchy = fixture(); await assert.rejects(hierarchy.consume({}, event => { if (event.kind === 'seal' && event.seal.kind === 'geometry-ranges') hierarchy.own.set(4, []); }), { code: 'BARRIER_MULTIPART_HIERARCHY_CHANGED' });
  const changedFrame = fixture(); await assert.rejects(changedFrame.consume({}, event => { if (event.kind === 'seal' && event.seal.kind === 'geometry-ranges') changedFrame.model.getUnitScale = () => 2; }), { code: 'BARRIER_MULTIPART_FRAME_CHANGED' });
  assert.equal(planSeal(source), undefined); assert.equal(planSeal(hierarchy), undefined); assert.equal(planSeal(changedFrame), undefined);
});
test('a missing reverse child edge cannot seal even when its parent accessor and own physical fragments remain unchanged', async () => {
  const f = fixture();
  await assert.rejects(f.consume({}, event => {
    if (event.kind === 'seal' && event.seal.kind === 'geometry-ranges') f.children.set(3, []);
  }), { code: 'BARRIER_MULTIPART_HIERARCHY_CHANGED' });
  assert.equal(f.parents.get(4), 3); assert.deepEqual(f.own.get(4), [0]);
  assert.ok(f.events.some(event => event.kind === 'page' && event.page.kind === 'plan'));
  assert.equal(planSeal(f), undefined);
});
test('cancellation rejects stalled frame SHA, tree callback and page replay without admitting a terminal seal', async () => {
  const f = fixture(), abort = new AbortController(); let resolve;
  const pending = observeMultipartFrame(f.viewer, f.scope.modelScope, { loadId: id(4), isCurrent: () => true, signal: abort.signal, sha256: () => new Promise(yes => { resolve = yes; }) });
  await new Promise(yes => setImmediate(yes)); abort.abort(); await assert.rejects(pending, { name: 'AbortError' }); resolve('a'.repeat(64));
  const tree = fixture(), treeAbort = new AbortController(), opts = await tree.options({ signal: treeAbort.signal }); tree.model.getObjectTree = () => {};
  const iterator = createBarrierMultipartProducer(tree.viewer, opts), next = iterator.next(); await new Promise(yes => setImmediate(yes)); treeAbort.abort(); await assert.rejects(next, { name: 'AbortError' });
  const replay = fixture(), replayAbort = new AbortController(); let stalled = false;
  await assert.rejects(replay.consume({ signal: replayAbort.signal, readPages: () => ({ [Symbol.asyncIterator]() { return { next: () => { stalled = true; queueMicrotask(() => replayAbort.abort()); return new Promise(() => {}); } }; } }) }), { name: 'AbortError' });
  assert.equal(stalled, true); assert.equal(planSeal(replay), undefined);
});
test('one yielded item provides backpressure and model/context loss prevents further pages or a seal', async () => {
  const f = fixture(), iterator = createBarrierMultipartProducer(f.viewer, await f.options()); const first = await iterator.next();
  assert.equal(first.value.kind, 'page'); assert.equal(first.value.page.kind, 'nodes'); assert.equal(f.stored.size, 0);
  f.setCurrent(false); await assert.rejects(iterator.next(), { code: 'BARRIER_MULTIPART_MODEL_CHANGED' });
  const stale = fixture(), observation = await stale.options(); observation.scope = { ...observation.scope, modelLoadId: id(999) };
  await assert.rejects(async () => { for await (const _event of createBarrierMultipartProducer(stale.viewer, observation)) assert.fail(); });
});
test('foreign or tampered stored-page replay is refused and the admitted job deadline is never reset', async () => {
  const f = fixture(); await assert.rejects(f.consume({ readPages: async function* (kind) { for (const page of f.stored.get(kind) ?? []) yield { ...page, scopeSha256: 'f'.repeat(64) }; } }), { code: 'BARRIER_MULTIPART_REPLAY_CHANGED' });
  const expired = fixture(), opts = await expired.options(); opts.startedAt = Date.now() - L.milliseconds;
  await assert.rejects(async () => { for await (const _event of createBarrierMultipartProducer(expired.viewer, opts)) assert.fail(); }, { code: 'BARRIER_MULTIPART_PRODUCER_DEADLINE' });
});

const unpack = part => { const view = new DataView(part.bytes.buffer, part.bytes.byteOffset, part.bytes.byteLength), descriptorBytes = view.getUint32(12, true);
  return { descriptor: JSON.parse(new TextDecoder().decode(part.bytes.subarray(32, 32 + descriptorBytes))), view, offset: 32 + descriptorBytes }; };
test('packed wrapper continues the same scene after plan acknowledgement and preserves physical instances', async () => {
  const f = fixture(); let trees = 0; const original = f.model.getObjectTree; f.model.getObjectTree = callback => { trees++; return original(callback); };
  await f.consumePacked(); const parts = f.events.filter(event => event.kind === 'part'); assert.equal(trees, 1); assert.equal(parts.length, planSeal(f).totals.parts);
  const decoded = unpack(parts[0]); assert.equal(decoded.descriptor.roots.plan, planSeal(f).sealSha256); assert.equal(decoded.descriptor.ranges.length, 2);
  assert.equal(decoded.descriptor.sdkSourceBytesVerified, false); assert.equal(decoded.descriptor.contextSha256, 'c'.repeat(64));
  assert.equal(f.events.findIndex(e => e.kind === 'part') > f.events.findIndex(e => e.kind === 'seal' && e.seal.kind === 'plan'), true);
  const first = decoded.offset, second = first + 384 + 28 * 4 + 12 * 2;
  assert.equal(decoded.view.getFloat64(first + 12 * 8, true), 0); assert.equal(decoded.view.getFloat64(second + 12 * 8, true), 10);
  assert.equal(f.progress.at(-1).phase, 'parts'); assert.equal(f.progress.at(-1).loaded, parts.length);
});
test('packed original mapping retains rendered group order, baseVertex gaps and local signed zero', async () => {
  const mesh = geometry(); mesh.attributes.position.array = new Float32Array(21); mesh.attributes.position.array[0] = -0;
  for (let i = 1; i < 7; i++) mesh.attributes.position.array[i * 3] = i;
  mesh.ib = new Uint16Array([0, 1, 2, 4, 5, 6, 0, 1, 2]); mesh.groups = [{ start: 6, count: 3, index: 3 }, { start: 0, count: 3, index: 0 }];
  const f = fixture({ selected: [3], oneFragment: true, mesh }); await f.consumePacked(); const part = f.events.find(e => e.kind === 'part'), decoded = unpack(part);
  const offset = decoded.offset + 384, ids = Array.from({ length: 6 }, (_, i) => decoded.view.getUint32(offset + i * 4, true)); assert.deepEqual(ids, [0, 1, 2, 3, 4, 5]);
  assert.equal(Object.is(decoded.view.getFloat64(offset + 24, true), -0), true);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => decoded.view.getUint32(part.bytes.length - 24 + i * 4, true)), [3, 4, 5, 0, 1, 2]);
});
test('multiple packed bookends preserve maximum owner dbId and reject duplicated final fragments', async () => {
  const f = fixture({ selected: [3], oneFragment: true }), ids = [1, 3, 2147483647]; f.children.clear(); f.parents.clear(); f.own.clear();
  f.children.set(1, [3]); f.children.set(3, [2147483647]); f.children.set(2147483647, []); f.parents.set(1, 1); f.parents.set(3, 1); f.parents.set(2147483647, 3); f.own.set(2147483647, [0]);
  f.tree.nodeAccess.nodes = new Int32Array(ids.length * 6); ids.forEach((id, i) => { f.tree.nodeAccess.nodes[i * 6] = id; });
  f.tree.nodeAccess.getNumNodes = () => ids.length; f.tree.getNodeIndex = value => ids.indexOf(value);
  await f.consumePacked(); assert.equal(records(f, 'fragments')[0].ownerDbId, 2147483647); assert.equal(f.events.filter(e => e.kind === 'part').length, 1);
  const duplicate = fixture(); await assert.rejects(duplicate.consumePacked({}, event => { if (event.kind === 'seal' && event.seal.kind === 'plan') duplicate.own.set(4, [0, 0]); }), { code: 'BARRIER_MULTIPART_HIERARCHY_CHANGED' });
  assert.equal(duplicate.events.some(e => e.kind === 'part'), false);
});
test('combined owner and final witness budget refuses before scene lookup allocations', async () => {
  const f = fixture(), count = 1048576; f.tree.nodeAccess.getNumNodes = () => count; f.tree.nodeAccess.nodes = new Int32Array(count * 6); f.list.getCount = () => count;
  await assert.rejects(f.consumePacked(), { code: 'BARRIER_MULTIPART_METADATA_LIMIT' }); assert.equal(f.progress.length, 0);
});
test('plan-seal backpressure performs no payload reads and known source/frame mutations refuse', async () => {
  const f = fixture(), iterator = createBarrierPackedProducer(f.viewer, await f.options({ packedContext: { intentId: id(100), contextSha256: 'c'.repeat(64) } }));
  for (;;) { const { value, done } = await iterator.next(); assert.equal(done, false);
    if (value.kind === 'page') { if (!f.stored.has(value.page.kind)) f.stored.set(value.page.kind, []); f.stored.get(value.page.kind).push(structuredClone(value.page)); }
    if (value.kind === 'seal' && value.seal.kind === 'plan') break; }
  f.mesh.attributes.position.array[0] = 4; await assert.rejects(iterator.next(), { code: 'BARRIER_MULTIPART_GEOMETRY_CHANGED' });
  const changed = fixture(); await assert.rejects(changed.consumePacked({}, event => { if (event.kind === 'seal' && event.seal.kind === 'plan') changed.model.getGlobalOffset = () => ({ x: 1, y: 0, z: 0 }); }), { code: 'BARRIER_MULTIPART_FRAME_CHANGED' });
  assert.equal(changed.events.some(e => e.kind === 'part'), false);
});
test('packed range source and transform bookends reject mutation while raw hashing is awaiting', async () => {
  const f = fixture({ selected: [3], oneFragment: true }); let afterPlan = false, mutated = false;
  await assert.rejects(f.consumePacked({ sha256: async value => { if (afterPlan && !mutated && value.byteLength === f.mesh.attributes.position.array.byteLength) { mutated = true; f.mesh.attributes.position.array[0] = 8; } return sha256(value); } },
    event => { if (event.kind === 'seal' && event.seal.kind === 'plan') afterPlan = true; }), { code: 'BARRIER_MULTIPART_GEOMETRY_CHANGED' });
  assert.equal(mutated, true); assert.equal(f.events.some(e => e.kind === 'part'), false);
});
test('after the last acknowledged part, final frame or hierarchy failure still refuses completion', async () => {
  for (const stage of ['frame', 'hierarchy']) {
    const f = fixture({ selected: [3], oneFragment: true });
    await assert.rejects(f.consumePacked({}, event => {
      if (event.kind !== 'part') return;
      if (stage === 'frame') f.model.getGlobalOffset = () => ({ x: 1, y: 0, z: 0 });
      else f.own.set(4, [0, 0]);
    }), { code: stage === 'frame' ? 'BARRIER_MULTIPART_FRAME_CHANGED' : 'BARRIER_MULTIPART_HIERARCHY_CHANGED' });
    assert.equal(f.events.filter(event => event.kind === 'part').length, planSeal(f).totals.parts);
    // A transport may already hold every part. Those receipts cannot prove
    // that these final producer bookends succeeded or authorize publication.
  }
});
test('packed cancellation after plan cannot reset deadline or emit a late part', async () => {
  const f = fixture(), abort = new AbortController(); await assert.rejects(f.consumePacked({ signal: abort.signal }, event => { if (event.kind === 'seal' && event.seal.kind === 'plan') abort.abort(); }), { name: 'AbortError' });
  assert.equal(f.events.some(e => e.kind === 'part'), false);
});
test('one large nonindexed source continues its exact rendered cursor across acknowledged packed parts', { timeout: 120000 }, async () => {
  const vertices = 240003, mesh = { attributes: { position: { array: new Float32Array(vertices * 3), itemSize: 3 } } };
  const f = fixture({ selected: [3], oneFragment: true, mesh }); await f.consumePacked(); const parts = f.events.filter(e => e.kind === 'part');
  assert.ok(parts.length > 1); assert.equal(parts.length, planSeal(f).totals.parts); let triangles = 0, rangeOrdinal = 0;
  for (const part of parts) { const { descriptor, view, offset } = unpack(part); assert.equal(descriptor.partIndex, part.partIndex); let at = offset;
    for (const range of descriptor.ranges) { assert.equal(range.rangeOrdinal, rangeOrdinal++); assert.equal(range.triangleStart, triangles);
      assert.equal(view.getUint32(at + 384, true), triangles * 3); triangles += range.triangleCount; at += 384 + 28 * range.referencedVertexCount + 12 * range.triangleCount; }
    assert.equal(at, part.bytes.length); }
  assert.equal(triangles, vertices / 3); assert.equal(f.progress.at(-1).loaded, parts.length);
});
