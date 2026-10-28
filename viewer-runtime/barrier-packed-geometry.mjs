// Local bounded encoding only. Neither these bytes nor their hashes grant collision authority.
import { BARRIER_MULTIPART_PLANNER_PROFILE as P, barrierPlanHash } from './barrier-plan.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE } from './barrier-multipart-protocol.mjs';
import { barrierCanonicalJson, validateBarrierFrameObservation } from './barrier-capture.mjs';

export const BARRIER_PACKED_GEOMETRY_FORMAT = Object.freeze({ schemaVersion: 'wfc.pf.barrier-packed-format.v1', magic: 'WFCPFBP1', version: 1, headerBytes: 32,
  codecVersion: 'wfc.pf.barrier-packed-mesh.v1', byteOrder: 'little-endian', descriptorEncoding: 'canonical-ascii-json-v1',
  coordinateEncoding: 'finite-binary64-preserve-signed-zero', triangleOrder: 'sdk7130-rendered-triangle-order-v1', geometryDigest: 'sha256-bounded-chunk-chain-v1',
  sourceGeometryProvenance: 'protected-producer-reported', sdkSourceBytesVerified: false,
  limits: Object.freeze({ ranges: 8192, baseBytes: 8192, rangeDescriptorBytes: 4096, bytes: 33554432, fragmentRefs: 8192, vertices: 500000, triangles: 250000, chunkBytes: 262144 }) });
const F = BARRIER_PACKED_GEOMETRY_FORMAT, utf8 = new TextEncoder(), chunkBytes = 262144;
const fail = (code = 'BARRIER_PACKED_INVALID') => { throw Object.assign(new Error(code), { code }); };
const need = (value, code) => { if (!value) fail(code); };
const uint = (n, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && !Object.is(n, -0) && n >= 0 && n <= max;
const hash = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && value.length === 36 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const mask = value => typeof value === 'string' && value.length === 32 && /^[a-f0-9]{32}$/.test(value) && BigInt('0x' + value) > 0n;
const exact = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === fields.length
  && fields.every(key => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value'); });
const denseArray = (value, maximum) => Array.isArray(value) && value.length <= maximum && Reflect.ownKeys(value).length === value.length + 1
  && Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
    .every(descriptor => descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value'));
const add = (a, b) => { need(uint(a) && uint(b) && a <= Number.MAX_SAFE_INTEGER - b, 'BARRIER_PACKED_BOUNDS'); return a + b; };
const mul = (a, b) => { need(uint(a) && uint(b) && (!b || a <= Math.floor(Number.MAX_SAFE_INTEGER / b)), 'BARRIER_PACKED_BOUNDS'); return a * b; };
const check = signal => { if (signal?.aborted) throw new DOMException('Packed encoding cancelled.', 'AbortError'); };
async function abortable(work, signal) {
  check(signal); if (!signal) return work(); let abort;
  const stopped = new Promise((_resolve, reject) => { abort = () => reject(new DOMException('Packed encoding cancelled.', 'AbortError')); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([Promise.resolve().then(() => { check(signal); return work(); }), stopped]); } finally { signal.removeEventListener('abort', abort); }
}
// Unlike page canonicalization, a descriptor may span several bounded pages.
// Count before concatenation and reject accessors/foreign numeric/string encodings.
function canonical(value, maximum = P.part.bytes) {
  let bytes = 0; const pieces = [], seen = new Set();
  const put = text => { bytes = add(bytes, text.length); need(bytes <= maximum, 'BARRIER_PACKED_BOUNDS'); pieces.push(text); };
  const visit = (item, depth = 0) => {
    need(depth <= 24); if (item === false) return put('false');
    if (typeof item === 'number') { need(uint(item)); return put(String(item)); }
    if (typeof item === 'string') { need(item.length <= 256 && /^[\x20-\x7e]*$(?![\s\S])/.test(item) && !/["\\]/.test(item)); return put('"' + item + '"'); }
    need(item && typeof item === 'object' && !seen.has(item)); seen.add(item);
    if (Array.isArray(item)) { need(denseArray(item, 8192)); put('['); for (let i = 0; i < item.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(item, String(i)); need(descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')); if (i) put(','); visit(descriptor.value, depth + 1); } put(']'); }
    else { need([Object.prototype, null].includes(Object.getPrototypeOf(item))); const keys = Reflect.ownKeys(item); need(keys.length <= 24 && keys.every(key => typeof key === 'string')); keys.sort(); put('{');
      for (let i = 0; i < keys.length; i++) { const key = keys[i], descriptor = Object.getOwnPropertyDescriptor(item, key);
        need(/^[A-Za-z0-9-]+$(?![\s\S])/.test(key) && descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')); if (i) put(','); put('"' + key + '":'); visit(descriptor.value, depth + 1); } put('}'); }
    seen.delete(item);
  }; visit(value); return pieces.join('');
}
const copyJson = value => JSON.parse(canonical(value));
const rangeFields = ['fragmentOrdinal', 'triangleStart', 'triangleCount', 'referencedVertexCount', 'sourceVertexIdsSha256', 'sourceIndicesSha256', 'sourceGeometrySha256', 'transformSha256', 'membershipMask'];
const placementFields = ['partIndex', 'rangeOrdinal', 'fragmentOrdinal', 'triangleStart', 'triangleCount', 'referencedVertexCount', 'rangeSha256', 'plannedEncodedBytesUpperBound'];
const fragmentFields = ['fragmentId', 'ownerNodeOrdinal', 'ownerDbId', 'membershipMask', 'primitive', 'sourceGeometrySha256', 'transformSha256', 'sourceVertexCount', 'sourceTriangleCount'];
const contextFields = ['schemaVersion', 'codecVersion', 'intentId', 'contextSha256', 'scopeSha256', 'profileSha256', 'frameSha256', 'producerProfile', 'roots', 'partIndex', 'sourceGeometryProvenance', 'sdkSourceBytesVerified'];
const frameFields = ['schemaVersion', 'projectId', 'modelVersionId', 'contentFingerprint', 'loadId', 'sdkVersion', 'matrixPrecision', 'coordinateFrame', 'sourceUnits',
  'metresPerDisplayUnit', 'upVector', 'globalOffsetDisplayUnits', 'globalOffsetMetres', 'displayToWorldMetres', 'modelTransform', 'placementTransform', 'contentSha256'];
function detachedFrame(input) {
  need(exact(input, frameFields) && ['projectId', 'modelVersionId', 'loadId'].every(key => uuid(input[key]))
    && hash(input.contentFingerprint) && hash(input.contentSha256), 'BARRIER_PACKED_FRAME');
  for (const key of ['upVector', 'globalOffsetDisplayUnits', 'globalOffsetMetres', 'displayToWorldMetres', 'modelTransform', 'placementTransform']) {
    const array = input[key]; if (array === null && ['modelTransform', 'placementTransform'].includes(key)) continue;
    need(Array.isArray(array) && array.length === (['upVector', 'globalOffsetDisplayUnits', 'globalOffsetMetres'].includes(key) ? 3 : 16)
      && Reflect.ownKeys(array).length === array.length + 1, 'BARRIER_PACKED_FRAME');
    for (let i = 0; i < array.length; i++) { const descriptor = Object.getOwnPropertyDescriptor(array, String(i));
      need(descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'number' && Number.isFinite(descriptor.value), 'BARRIER_PACKED_FRAME'); }
  }
  need(validateBarrierFrameObservation(input), 'BARRIER_PACKED_FRAME'); return JSON.parse(barrierCanonicalJson(input));
}
function contextValid(context) {
  need(exact(context, contextFields) && context.schemaVersion === 'wfc.pf.barrier-packed-part.v1' && context.codecVersion === F.codecVersion
    && uuid(context.intentId) && ['contextSha256', 'scopeSha256', 'profileSha256', 'frameSha256'].every(key => hash(context[key]))
    && canonical(context.producerProfile) === canonical(BARRIER_MULTIPART_PRODUCER_PROFILE)
    && exact(context.roots, ['nodes', 'fragments', 'geometry-ranges', 'plan']) && Object.values(context.roots).every(hash)
    && uint(context.partIndex, P.limits.parts - 1) && context.sourceGeometryProvenance === 'protected-producer-reported' && context.sdkSourceBytesVerified === false);
}
export function barrierPackedRangeBinaryBytes(vertices, triangles) {
  need(uint(vertices, P.part.vertices) && vertices >= 3 && uint(triangles, P.part.triangles) && triangles > 0 && vertices <= triangles * 3);
  return add(384, add(mul(28, vertices), mul(12, triangles)));
}
function descriptorInfo(input) {
  need(exact(input, [...contextFields, 'ranges']) && denseArray(input.ranges, 8192) && input.ranges.length > 0);
  const { ranges, ...context } = input; contextValid(context);
  need(F.headerBytes + canonical({ ...context, ranges: [] }).length <= P.byteEnvelope.partHeader, 'BARRIER_PACKED_BOUNDS');
  let vertices = 0, triangles = 0, binaryBytes = 0, planned = P.byteEnvelope.partHeader, fragmentRefs = 0, previous = null;
  for (let index = 0; index < ranges.length; index++) {
    const row = Object.getOwnPropertyDescriptor(ranges, String(index)).value;
    need(exact(row, [...rangeFields, 'rangeOrdinal', 'rangeSha256']) && uint(row.rangeOrdinal, P.limits.ranges - 1) && hash(row.rangeSha256)
      && uint(row.fragmentOrdinal, P.limits.fragments - 1) && uint(row.triangleStart, P.limits.sourceCount)
      && uint(row.triangleCount, P.part.triangles) && row.triangleCount > 0 && uint(row.referencedVertexCount, P.part.vertices) && row.referencedVertexCount >= 3
      && ['sourceVertexIdsSha256', 'sourceIndicesSha256', 'sourceGeometrySha256', 'transformSha256'].every(key => hash(row[key])) && mask(row.membershipMask));
    need(canonical(row).length + 1 <= P.byteEnvelope.rangeDescriptor, 'BARRIER_PACKED_BOUNDS');
    if (previous) need(row.rangeOrdinal === previous.rangeOrdinal + 1 && (row.fragmentOrdinal === previous.fragmentOrdinal
      ? row.triangleStart === previous.triangleStart + previous.triangleCount : row.fragmentOrdinal === previous.fragmentOrdinal + 1 && row.triangleStart === 0));
    if (!previous || previous.fragmentOrdinal !== row.fragmentOrdinal) fragmentRefs++; previous = row;
    vertices = add(vertices, row.referencedVertexCount); triangles = add(triangles, row.triangleCount);
    binaryBytes = add(binaryBytes, barrierPackedRangeBinaryBytes(row.referencedVertexCount, row.triangleCount));
    planned = add(planned, add(P.byteEnvelope.rangeDescriptor, add(mul(128, row.referencedVertexCount), mul(48, row.triangleCount))));
  }
  need(vertices <= P.part.vertices && triangles <= P.part.triangles && planned <= P.part.bytes, 'BARRIER_PACKED_BOUNDS');
  const bytes = utf8.encode(canonical(input)), totalBytes = add(F.headerBytes, add(bytes.byteLength, binaryBytes));
  need(totalBytes <= planned && totalBytes <= P.part.bytes, 'BARRIER_PACKED_BOUNDS');
  return { context, bytes, totalBytes, planned, vertices, triangles, fragmentRefs };
}
export const barrierPackedDescriptorBytes = descriptor => descriptorInfo(descriptor).bytes;
export const barrierPackedDescriptorHashInput = descriptor => { descriptorInfo(descriptor); return { domain: F.codecVersion + '/descriptor', value: copyJson(descriptor) }; };
export function barrierPackedMeasureDescriptor(descriptor) { const info = descriptorInfo(descriptor); return { headerBytes: F.headerBytes, descriptorBytes: info.bytes.byteLength, binaryBytes: info.totalBytes - F.headerBytes - info.bytes.byteLength,
  totalBytes: info.totalBytes, plannedEncodedBytesUpperBound: info.planned, vertices: info.vertices, triangles: info.triangles, rangeCount: descriptor.ranges.length, fragmentRefs: info.fragmentRefs }; }
function expectedValid(expected, descriptor) {
  need(Array.isArray(expected) && expected.length === descriptor.ranges.length && expected.length <= 8192); let previous = null;
  for (let index = 0; index < expected.length; index++) {
    const entry = expected[index], row = descriptor.ranges[index]; need(exact(entry, ['placement', 'range', 'fragment']));
    const { placement: p, range: r, fragment: f } = entry;
    need(exact(p, placementFields) && exact(r, rangeFields) && exact(f, fragmentFields)
      && uint(f.fragmentId, 2147483647) && uint(f.ownerNodeOrdinal, P.limits.nodes - 1) && uint(f.ownerDbId, 2147483647)
      && f.primitive === 'triangles' && uint(f.sourceVertexCount, P.limits.sourceCount) && f.sourceVertexCount >= 3 && uint(f.sourceTriangleCount, P.limits.sourceCount) && f.sourceTriangleCount > 0
      && f.sourceGeometrySha256 === r.sourceGeometrySha256 && f.transformSha256 === r.transformSha256 && f.membershipMask === r.membershipMask
      && p.partIndex === descriptor.partIndex && p.rangeOrdinal === row.rangeOrdinal && p.rangeSha256 === row.rangeSha256
      && ['fragmentOrdinal', 'triangleStart', 'triangleCount', 'referencedVertexCount'].every(key => p[key] === r[key])
      && canonical({ ...r, rangeOrdinal: p.rangeOrdinal, rangeSha256: p.rangeSha256 }) === canonical(row)
      && p.plannedEncodedBytesUpperBound === P.byteEnvelope.rangeDescriptor + 128 * r.referencedVertexCount + 48 * r.triangleCount
      && add(r.triangleStart, r.triangleCount) <= f.sourceTriangleCount && r.referencedVertexCount <= Math.min(f.sourceVertexCount, r.triangleCount * 3));
    if (previous) need(p.rangeOrdinal === previous.placement.rangeOrdinal + 1 && (r.fragmentOrdinal === previous.range.fragmentOrdinal
      ? f.fragmentId === previous.fragment.fragmentId && r.triangleStart === previous.range.triangleStart + previous.range.triangleCount
      : r.fragmentOrdinal === previous.range.fragmentOrdinal + 1 && f.fragmentId > previous.fragment.fragmentId && r.triangleStart === 0
        && previous.range.triangleStart + previous.range.triangleCount === previous.fragment.sourceTriangleCount));
    previous = entry;
  }
}
const matrixValid = m => m.length === 16 && m.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9) && m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1
  && m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]) !== 0;
function product(a, b) { const out = new Float64Array(16); for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++)
  out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3]; return out; }
function binary(numbers, width) { const bytes = new Uint8Array(numbers.length * width), view = new DataView(bytes.buffer); for (let i = 0; i < numbers.length; i++) width === 4 ? view.setUint32(i * 4, numbers[i], true) : view.setFloat64(i * 8, numbers[i], true); return bytes; }
async function chain(digest, domain, manifest, segments, signal) {
  const prefix = { schemaVersion: 'sha256-bounded-chunk-chain-v1', domain, manifest }; let previous = await digest(utf8.encode(barrierCanonicalJson(prefix))), totalBytes = 0, chunks = 0, segmentCount = 0;
  for (const bytes of segments) { check(signal); const segmentOrdinal = segmentCount++; need(bytes.byteLength <= chunkBytes);
    if (bytes.byteLength) { const sha256 = await digest(bytes); totalBytes += bytes.byteLength;
      previous = await digest(utf8.encode(barrierCanonicalJson({ schemaVersion: prefix.schemaVersion, domain, previous, segmentOrdinal, offset: 0, bytes: bytes.byteLength, sha256, chunkOrdinal: chunks++ }))); } }
  return digest(utf8.encode(barrierCanonicalJson({ ...prefix, previous, totalBytes, chunks, segmentCount })));
}
function* integerSegments(numbers) { for (let first = 0; first < numbers.length; first += chunkBytes / 4) yield binary(numbers.subarray(first, Math.min(first + chunkBytes / 4, numbers.length)), 4); }
function ownRange(value, row) {
  const fields = ['sourceVertexIds', 'localVertices', 'originalIndices', 'originalTransform', 'worldTransform', 'canonicalTransform']; need(exact(value, fields));
  for (const key of fields) { const type = ['sourceVertexIds', 'originalIndices'].includes(key) ? Uint32Array : Float64Array;
    const length = key === 'sourceVertexIds' ? row.referencedVertexCount : key === 'localVertices' ? row.referencedVertexCount * 3 : key === 'originalIndices' ? row.triangleCount * 3 : 16;
    need(value[key] instanceof type && value[key].length === length, 'BARRIER_PACKED_RANGE_ARRAYS'); }
  // Detach synchronously before any digest await; caller mutation cannot alter output.
  return Object.fromEntries(fields.map(key => [key, value[key].slice()]));
}
function find(ids, value) { let lo = 0, hi = ids.length - 1; while (lo <= hi) { const mid = (lo + hi) >>> 1; if (ids[mid] === value) return mid; if (ids[mid] < value) lo = mid + 1; else hi = mid - 1; } return -1; }
/** All expected metadata is detached before the first await. readRange returns
 * only bounded owned arrays; no SDK objects, arrays or callbacks are serialized. */
export async function encodeBarrierPackedPart({ descriptor: input, expectedRanges: expectedInput, frameObservation: frameInput, readRange, signal, sha256 }) {
  check(signal); need(typeof readRange === 'function'); const info = descriptorInfo(input), descriptor = copyJson(input), expected = copyJson(expectedInput);
  expectedValid(expected, descriptor); const observation = detachedFrame(frameInput);
  need(validateBarrierFrameObservation(observation) && observation.contentSha256 === descriptor.frameSha256, 'BARRIER_PACKED_FRAME');
  const digest = async bytes => { check(signal); need(bytes instanceof Uint8Array && bytes.byteLength <= chunkBytes); const copy = bytes.slice();
    const result = await abortable(() => sha256 ? sha256(copy) : globalThis.crypto.subtle.digest('SHA-256', copy).then(v => [...new Uint8Array(v)].map(n => n.toString(16).padStart(2, '0')).join('')), signal);
    check(signal); need(hash(result)); return result; };
  const { contentSha256, ...frameBody } = observation;
  need(await digest(utf8.encode(barrierCanonicalJson(frameBody))) === contentSha256, 'BARRIER_PACKED_FRAME');
  for (let i = 0; i < expected.length; i++) need(await barrierPlanHash('range', expected[i].range, sha256, signal) === descriptor.ranges[i].rangeSha256, 'BARRIER_PACKED_RANGE_HASH');
  const output = new Uint8Array(info.totalBytes), header = new DataView(output.buffer); output.set(utf8.encode(F.magic));
  header.setUint32(8, F.version, true); header.setUint32(12, info.bytes.byteLength, true); header.setUint32(16, output.byteLength, true); header.setUint32(20, expected.length, true); output.set(info.bytes, F.headerBytes);
  let offset = F.headerBytes + info.bytes.byteLength;
  for (let index = 0; index < expected.length; index++) {
    check(signal); const entry = expected[index], row = descriptor.ranges[index];
    const arrays = ownRange(await abortable(() => readRange(copyJson(entry.range), copyJson(entry.placement), copyJson(entry.fragment)), signal), row);
    const { sourceVertexIds: ids, localVertices: xyz, originalIndices: original, originalTransform, worldTransform, canonicalTransform } = arrays;
    need(matrixValid(originalTransform) && matrixValid(worldTransform) && matrixValid(canonicalTransform), 'BARRIER_PACKED_MATRIX');
    const world = observation.modelTransform === null ? originalTransform : product(observation.modelTransform, originalTransform), canonicalWorld = product(observation.displayToWorldMetres, worldTransform);
    need(worldTransform.every((n, i) => Object.is(n, world[i])) && canonicalTransform.every((n, i) => Object.is(n, canonicalWorld[i])), 'BARRIER_PACKED_MATRIX');
    for (let i = 0; i < ids.length; i++) need(ids[i] < entry.fragment.sourceVertexCount && (i === 0 || ids[i] > ids[i - 1]), 'BARRIER_PACKED_VERTEX_IDS');
    for (let i = 0; i < xyz.length; i += 3) {
      need([xyz[i], xyz[i + 1], xyz[i + 2]].every(n => Number.isFinite(n) && Math.abs(n) <= 1e12), 'BARRIER_PACKED_VERTEX');
      for (let axis = 0; axis < 3; axis++) { const m = canonicalTransform, n = m[axis] * xyz[i] + m[4 + axis] * xyz[i + 1] + m[8 + axis] * xyz[i + 2] + m[12 + axis]; need(Number.isFinite(n) && Math.abs(n) <= 1e9, 'BARRIER_PACKED_VERTEX'); }
    }
    const remapped = new Uint32Array(original.length), seen = new Uint8Array(Math.ceil(ids.length / 8)); let used = 0;
    for (let i = 0; i < original.length; i += 3) {
      need(original[i] !== original[i + 1] && original[i] !== original[i + 2] && original[i + 1] !== original[i + 2], 'BARRIER_PACKED_TRIANGLE');
      for (let j = 0; j < 3; j++) { const local = find(ids, original[i + j]); need(local >= 0, 'BARRIER_PACKED_VERTEX_IDS'); remapped[i + j] = local;
        const bit = 1 << (local & 7); if (!(seen[local >>> 3] & bit)) { seen[local >>> 3] |= bit; used++; } }
    }
    need(used === ids.length, 'BARRIER_PACKED_UNUSED_VERTEX');
    need(await chain(digest, 'sdk7130-ordered-original-vertex-ids-v1', { encoding: 'uint32-little-endian', values: ids.length }, integerSegments(ids), signal) === row.sourceVertexIdsSha256
      && await chain(digest, 'sdk7130-rendered-original-indices-v1', { encoding: 'uint32-little-endian', values: original.length }, integerSegments(original), signal) === row.sourceIndicesSha256, 'BARRIER_PACKED_INDEX_HASH');
    need(await chain(digest, 'sdk7130-canonical-transform-v1', { scopeSha256: descriptor.scopeSha256, frameSha256: descriptor.frameSha256,
      encoding: 'binary64-little-endian-preserve-signed-zero', segments: ['original', 'world', 'canonical'] }, [binary(originalTransform, 8), binary(worldTransform, 8), binary(canonicalTransform, 8)], signal) === row.transformSha256, 'BARRIER_PACKED_TRANSFORM_HASH');
    for (const [data, width] of [[originalTransform, 8], [worldTransform, 8], [canonicalTransform, 8], [ids, 4], [xyz, 8], [remapped, 4]]) {
      for (let i = 0; i < data.length; i++) { width === 4 ? header.setUint32(offset, data[i], true) : header.setFloat64(offset, data[i], true); offset += width; }
    }
    check(signal);
  }
  need(offset === output.byteLength, 'BARRIER_PACKED_BOUNDS'); check(signal); return output;
}
