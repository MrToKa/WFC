import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { barrierCanonicalJson } from '../barrier-capture.mjs';
import { barrierPlanHash } from '../barrier-plan.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE } from '../barrier-multipart-protocol.mjs';
import { encodeBarrierPackedPart, barrierPackedDescriptorBytes, barrierPackedDescriptorHashInput, barrierPackedMeasureDescriptor,
  barrierPackedRangeBinaryBytes, BARRIER_PACKED_GEOMETRY_FORMAT as F } from '../barrier-packed-geometry.mjs';

const sha256 = async value => createHash('sha256').update(value).digest('hex'), text = new TextEncoder();
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const matrix = () => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const bytes = (array, size) => { const out = new Uint8Array(array.length * size), view = new DataView(out.buffer); for (let i = 0; i < array.length; i++) size === 4 ? view.setUint32(i * size, array[i], true) : view.setFloat64(i * size, array[i], true); return out; };
async function chain(domain, manifest, segments) {
  const prefix = { schemaVersion: 'sha256-bounded-chunk-chain-v1', domain, manifest }; let previous = await sha256(text.encode(barrierCanonicalJson(prefix))), totalBytes = 0, chunks = 0, segmentCount = 0;
  for (const segment of segments) { const segmentOrdinal = segmentCount++;
    for (let offset = 0; offset < segment.length; offset += 262144) { const part = segment.subarray(offset, Math.min(offset + 262144, segment.length)); totalBytes += part.length;
      previous = await sha256(text.encode(barrierCanonicalJson({ schemaVersion: prefix.schemaVersion, domain, previous, segmentOrdinal, offset, bytes: part.length, sha256: await sha256(part), chunkOrdinal: chunks++ }))); }
  }
  return sha256(text.encode(barrierCanonicalJson({ ...prefix, previous, totalBytes, chunks, segmentCount })));
}
async function indexHash(domain, array) { const parts = []; for (let first = 0; first < array.length; first += 65536) parts.push(bytes(array.subarray(first, Math.min(first + 65536, array.length)), 4)); return chain(domain, { encoding: 'uint32-little-endian', values: array.length }, parts); }
async function fixture({ vertices = 3 } = {}) {
  const originalTransform = matrix(), worldTransform = matrix(), canonicalTransform = matrix();
  const sourceVertexIds = Uint32Array.from({ length: vertices }, (_, i) => i), originalIndices = Uint32Array.from(sourceVertexIds), localVertices = new Float64Array(vertices * 3);
  for (let i = 0; i < vertices; i++) localVertices[i * 3] = i / 1000;
  localVertices[0] = -0;
  const arrays = { originalTransform, worldTransform, canonicalTransform, sourceVertexIds, originalIndices, localVertices };
  const scopeSha256 = 'a'.repeat(64), frameBody = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1', projectId: id(1), modelVersionId: id(2), contentFingerprint: 'd'.repeat(64), loadId: id(3),
    sdkVersion: '7.130.0', matrixPrecision: 'binary64', coordinateFrame: 'canonical-world-metres', sourceUnits: 'm', metresPerDisplayUnit: 1, upVector: [0, 0, 1],
    globalOffsetDisplayUnits: [0, 0, 0], globalOffsetMetres: [0, 0, 0], displayToWorldMetres: Array.from(matrix()), modelTransform: null, placementTransform: null };
  const frameObservation = { ...frameBody, contentSha256: await sha256(text.encode(barrierCanonicalJson(frameBody))) };
  const transformSha256 = await chain('sdk7130-canonical-transform-v1', { scopeSha256, frameSha256: frameObservation.contentSha256,
    encoding: 'binary64-little-endian-preserve-signed-zero', segments: ['original', 'world', 'canonical'] }, [bytes(originalTransform, 8), bytes(worldTransform, 8), bytes(canonicalTransform, 8)]);
  const range = { fragmentOrdinal: 0, triangleStart: 0, triangleCount: vertices / 3, referencedVertexCount: vertices,
    sourceVertexIdsSha256: await indexHash('sdk7130-ordered-original-vertex-ids-v1', sourceVertexIds), sourceIndicesSha256: await indexHash('sdk7130-rendered-original-indices-v1', originalIndices),
    sourceGeometrySha256: 'b'.repeat(64), transformSha256, membershipMask: '0'.repeat(31) + '1' };
  const placement = { partIndex: 0, rangeOrdinal: 0, fragmentOrdinal: 0, triangleStart: 0, triangleCount: range.triangleCount, referencedVertexCount: vertices,
    rangeSha256: await barrierPlanHash('range', range, sha256), plannedEncodedBytesUpperBound: 4096 + 128 * vertices + 48 * range.triangleCount };
  const fragment = { fragmentId: 7, ownerNodeOrdinal: 0, ownerDbId: 2147483647, membershipMask: range.membershipMask, primitive: 'triangles', sourceGeometrySha256: range.sourceGeometrySha256,
    transformSha256, sourceVertexCount: vertices, sourceTriangleCount: range.triangleCount };
  const descriptor = { schemaVersion: 'wfc.pf.barrier-packed-part.v1', codecVersion: F.codecVersion, intentId: id(4), contextSha256: 'c'.repeat(64), scopeSha256,
    profileSha256: 'e'.repeat(64), frameSha256: frameObservation.contentSha256, producerProfile: BARRIER_MULTIPART_PRODUCER_PROFILE,
    roots: { nodes: '1'.repeat(64), fragments: '2'.repeat(64), 'geometry-ranges': '3'.repeat(64), plan: '4'.repeat(64) }, partIndex: 0,
    sourceGeometryProvenance: 'protected-producer-reported', sdkSourceBytesVerified: false, ranges: [{ ...range, rangeOrdinal: 0, rangeSha256: placement.rangeSha256 }] };
  const options = { descriptor, expectedRanges: [{ placement, range, fragment }], frameObservation, readRange: async () => arrays, sha256 };
  return { arrays, descriptor, options, range, placement, fragment, frameObservation };
}
function decode(output) { const view = new DataView(output.buffer, output.byteOffset, output.byteLength), size = view.getUint32(12, true); return { view, offset: 32 + size, descriptor: JSON.parse(new TextDecoder().decode(output.subarray(32, 32 + size))) }; }

test('exact layout preserves source signed zero, original IDs and triangle winding with no padding', async () => {
  const f = await fixture(), output = await encodeBarrierPackedPart(f.options), d = decode(output), measured = barrierPackedMeasureDescriptor(f.descriptor);
  assert.equal(new TextDecoder().decode(output.subarray(0, 8)), 'WFCPFBP1'); assert.equal(d.view.getUint32(8, true), 1);
  assert.equal(d.view.getUint32(16, true), output.length); assert.equal(d.view.getUint32(20, true), 1); assert.equal(d.view.getBigUint64(24, true), 0n);
  assert.equal(output.length, measured.totalBytes); assert.equal(measured.binaryBytes, 384 + 28 * 3 + 12);
  assert.equal(Object.is(d.view.getFloat64(d.offset + 384 + 12, true), -0), true);
  assert.deepEqual([0, 1, 2].map(i => d.view.getUint32(d.offset + 384 + i * 4, true)), [0, 1, 2]);
  assert.deepEqual([0, 1, 2].map(i => d.view.getUint32(output.length - 12 + i * 4, true)), [0, 1, 2]);
  assert.equal(d.descriptor.sdkSourceBytesVerified, false); assert.equal(d.descriptor.sourceGeometryProvenance, 'protected-producer-reported');
  assert.deepEqual(output.subarray(32, d.offset), barrierPackedDescriptorBytes(f.descriptor));
  assert.equal(barrierPackedDescriptorHashInput(f.descriptor).domain, 'wfc.pf.barrier-packed-mesh.v1/descriptor');
});
test('ID and original-index chain uses separate uint32 segments beyond65536values', async () => {
  const f = await fixture({ vertices: 65538 }), output = await encodeBarrierPackedPart(f.options); assert.equal(decode(output).descriptor.ranges[0].referencedVertexCount, 65538);
  const wrong = await chain('sdk7130-rendered-original-indices-v1', { encoding: 'uint32-little-endian', values: 65538 }, [bytes(f.arrays.originalIndices, 4)]);
  assert.notEqual(wrong, f.range.sourceIndicesSha256);
});
test('four-product matrix sum preserves all-negative-zero products without an extra positive-zero accumulator', async () => {
  const f = await fixture(), original = f.arrays.originalTransform; original[4] = -0; original[5] = -1; original[6] = -2; original[7] = -0;
  const multiply = (a, b) => Float64Array.from({ length: 16 }, (_, i) => { const row = i % 4, col = Math.floor(i / 4) * 4;
    return a[row] * b[col] + a[4 + row] * b[col + 1] + a[8 + row] * b[col + 2] + a[12 + row] * b[col + 3]; });
  f.frameObservation.modelTransform = Array.from(matrix()); const { contentSha256: _old, ...body } = f.frameObservation;
  f.frameObservation.contentSha256 = await sha256(text.encode(barrierCanonicalJson(body))); f.descriptor.frameSha256 = f.frameObservation.contentSha256;
  f.arrays.worldTransform.set(multiply(matrix(), original)); f.arrays.canonicalTransform.set(multiply(matrix(), f.arrays.worldTransform));
  assert.equal(Object.is(f.arrays.worldTransform[4], -0), true); assert.equal(Object.is(f.arrays.canonicalTransform[4], -0), true);
  const transformHash = await chain('sdk7130-canonical-transform-v1', { scopeSha256: f.descriptor.scopeSha256, frameSha256: f.descriptor.frameSha256,
    encoding: 'binary64-little-endian-preserve-signed-zero', segments: ['original', 'world', 'canonical'] },
  [bytes(original, 8), bytes(f.arrays.worldTransform, 8), bytes(f.arrays.canonicalTransform, 8)]);
  f.range.transformSha256 = transformHash; f.fragment.transformSha256 = transformHash; f.descriptor.ranges[0].transformSha256 = transformHash;
  f.placement.rangeSha256 = await barrierPlanHash('range', f.range, sha256); f.descriptor.ranges[0].rangeSha256 = f.placement.rangeSha256;
  const out = decode(await encodeBarrierPackedPart(f.options)); assert.equal(Object.is(out.view.getFloat64(out.offset + 128 + 32, true), -0), true);
  f.arrays.worldTransform[4] = 0; await assert.rejects(encodeBarrierPackedPart(f.options), { code: 'BARRIER_PACKED_MATRIX' });
});
test('expected context, rows and returned arrays detach before awaited hash mutations', async () => {
  const f = await fixture(); let entered, release, pause = false; const enteredHash = new Promise(yes => { entered = yes; });
  const stalled = new Promise(yes => { release = yes; });
  const pending = encodeBarrierPackedPart({ ...f.options, readRange: async () => { pause = true; return f.arrays; }, sha256: async value => { if (pause) { pause = false; entered(); await stalled; } return sha256(value); } });
  await enteredHash; f.arrays.localVertices[0] = 999; f.arrays.originalIndices[0] = 99; f.descriptor.contextSha256 = 'f'.repeat(64); f.placement.partIndex = 55;
  release(); const output = await pending, d = decode(output); assert.equal(d.descriptor.contextSha256, 'c'.repeat(64)); assert.equal(Object.is(d.view.getFloat64(d.offset + 396, true), -0), true);
});
test('foreign source bounds, placement range hash or provenance cannot supply their own authority', async () => {
  for (const mutate of [f => { f.fragment.sourceVertexCount = 2; }, f => { f.placement.rangeSha256 = '9'.repeat(64); }, f => { f.descriptor.sdkSourceBytesVerified = true; }, f => { f.descriptor.roots.plan = null; }]) {
    const f = await fixture(); mutate(f); let reads = 0; await assert.rejects(encodeBarrierPackedPart({ ...f.options, readRange: () => { reads++; return f.arrays; } })); assert.equal(reads, 0);
  }
});
test('nonminimal vertex map, duplicate IDs, wrong winding and invalid triangle indices refuse', async () => {
  for (const mutate of [f => { f.arrays.sourceVertexIds[1] = 0; }, f => { f.arrays.originalIndices[2] = 0; }, f => { f.arrays.originalIndices[0] = 99; }, f => { f.arrays.originalIndices.reverse(); }]) {
    const f = await fixture(); mutate(f); await assert.rejects(encodeBarrierPackedPart(f.options));
  }
  const f = await fixture({ vertices: 6 }); f.arrays.originalIndices.set([0, 1, 2, 0, 1, 2]); await assert.rejects(encodeBarrierPackedPart(f.options), { code: 'BARRIER_PACKED_UNUSED_VERTEX' });
});
test('NaN, infinity, canonical bounds, affine matrix changes and unchecked frame refuse', async () => {
  for (const mutate of [f => { f.arrays.localVertices[0] = NaN; }, f => { f.arrays.localVertices[0] = Infinity; }, f => { f.arrays.localVertices[0] = 1e10; },
    f => { f.arrays.originalTransform[3] = 1; }, f => { f.arrays.worldTransform[12] = 1; }, f => { f.frameObservation.metresPerDisplayUnit = 2; }]) {
    const f = await fixture(); mutate(f); await assert.rejects(encodeBarrierPackedPart(f.options));
  }
});
test('descriptor rejects unknown properties, negative zero, order gaps and preallocation overflow', async () => {
  for (const mutate of [f => { f.descriptor.extra = 1; }, f => { f.descriptor.partIndex = -0; }, f => { f.descriptor.ranges.push({ ...f.descriptor.ranges[0], rangeOrdinal: 2 }); },
    f => { f.descriptor.ranges[0].referencedVertexCount = 500001; }]) { const f = await fixture(); mutate(f); await assert.rejects(encodeBarrierPackedPart(f.options)); }
  assert.throws(() => barrierPackedRangeBinaryBytes(Number.MAX_SAFE_INTEGER, 1)); assert.throws(() => barrierPackedRangeBinaryBytes(4, 1));
});
test('strict shared-policy UUID/hash/mask lengths and ASCII producer versions reject final newlines before payload reads', async () => {
  for (const mutate of [f => { f.descriptor.intentId += '\n'; }, f => { f.descriptor.contextSha256 += '\n'; }, f => { f.descriptor.roots.plan += '\n'; },
    f => { f.descriptor.ranges[0].sourceIndicesSha256 += '\n'; }, f => { f.descriptor.ranges[0].membershipMask += '\n'; },
    f => { f.descriptor.producerProfile = { ...BARRIER_MULTIPART_PRODUCER_PROFILE, sdkVersion: '7.130.0\n' }; }]) {
    const f = await fixture(); mutate(f); let reads = 0;
    assert.throws(() => barrierPackedDescriptorBytes(f.descriptor));
    await assert.rejects(encodeBarrierPackedPart({ ...f.options, readRange: () => { reads++; return f.arrays; } })); assert.equal(reads, 0);
  }
  const f = await fixture(); f.frameObservation.projectId += '\n'; let reads = 0;
  await assert.rejects(encodeBarrierPackedPart({ ...f.options, readRange: () => { reads++; return f.arrays; } }), { code: 'BARRIER_PACKED_FRAME' }); assert.equal(reads, 0);
});
test('closed JSON records reject symbol/nonenumerable/accessor extras and array extras without invoking getters', async () => {
  for (const mutate of [f => { f.descriptor[Symbol('foreign')] = true; }, f => { Object.defineProperty(f.descriptor.roots, 'foreign', { value: 1 }); },
    f => { f.options.expectedRanges.extra = 1; }, f => { f.options.expectedRanges[0][Symbol('foreign')] = 1; },
    f => { Object.defineProperty(f.descriptor.ranges[0], 'triangleCount', { value: 1, enumerable: false }); },
    f => { f.frameObservation[Symbol('foreign')] = 1; }, f => { f.frameObservation.upVector.extra = 1; }]) {
    const f = await fixture(); mutate(f); let reads = 0; await assert.rejects(encodeBarrierPackedPart({ ...f.options, readRange: () => { reads++; return f.arrays; } })); assert.equal(reads, 0);
  }
  const f = await fixture(); let getterReads = 0; Object.defineProperty(f.descriptor, 'intentId', { enumerable: true, get() { getterReads++; return id(4); } });
  await assert.rejects(encodeBarrierPackedPart(f.options)); assert.equal(getterReads, 0);
  for (const mutate of [(f, invoked) => { const row = f.descriptor.ranges[0]; Object.defineProperty(f.descriptor.ranges, '0', { enumerable: true, get() { invoked(); return row; } }); },
    (f, invoked) => { f.descriptor.ranges[Symbol.iterator] = function* () { invoked(); yield f.descriptor.ranges[0]; }; },
    f => { delete f.descriptor.ranges[0]; }]) {
    const f = await fixture(); let reads = 0, invoked = 0; mutate(f, () => { invoked++; });
    assert.throws(() => barrierPackedDescriptorBytes(f.descriptor));
    await assert.rejects(encodeBarrierPackedPart({ ...f.options, readRange: () => { reads++; return f.arrays; } })); assert.equal(reads, 0); assert.equal(invoked, 0);
  }
});
test('cancellation interrupts stalled read/hash and prevents a late payload', async () => {
  for (const stage of ['read', 'hash']) { const f = await fixture(), abort = new AbortController(); let resolve, entered; const start = new Promise(yes => { entered = yes; });
    const stalled = new Promise(yes => { resolve = yes; }); const pending = encodeBarrierPackedPart({ ...f.options, signal: abort.signal,
      ...(stage === 'read' ? { readRange: () => { entered(); return stalled; } } : { sha256: () => { entered(); return stalled; } }) });
    await start; abort.abort(); await assert.rejects(pending, { name: 'AbortError' }); resolve(stage === 'read' ? f.arrays : 'a'.repeat(64)); }
});
