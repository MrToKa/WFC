// Protected SDK observations only. Pages and seals remain unqualified evidence.
import { BARRIER_MULTIPART_PLANNER_PROFILE as P, barrierPlanCanonical, barrierPlanHash,
  planBarrierFragmentSplitHints, planBarrierMultipart } from './barrier-plan.mjs';
import { barrierCanonicalJson, validateBarrierFrameObservation } from './barrier-capture.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE } from './barrier-multipart-protocol.mjs';

export const BARRIER_MULTIPART_PRODUCER_LIMITS = Object.freeze({ lookupBytes: 20 * 1024 ** 2,
  metadataBytes: 5 * 1024 ** 2, ancestry: 512, chunkBytes: 256 * 1024, milliseconds: 3600000 });
const L = BARRIER_MULTIPART_PRODUCER_LIMITS, encoder = new TextEncoder(), absent = 0xffffffff;
const integer = (n, max = 4294967295) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const fail = (code = 'BARRIER_MULTIPART_PRODUCER_INVALID') => { throw Object.assign(new Error(code), { code }); };
const need = (value, code) => { if (!value) fail(code); };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
function detached(value) { return JSON.parse(barrierPlanCanonical(value)); }
function abortable(operation, signal) {
  if (signal?.aborted) return Promise.reject(new DOMException('Multipart capture cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
    const abort = () => finish(new DOMException('Multipart capture cancelled.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(operation).then(value => finish(null, value), error => finish(error));
  });
}
function execution(viewer, { loadId, isCurrent, signal, startedAt = Date.now(), sha256 } = {}) {
  need(uuid(loadId) && typeof isCurrent === 'function' && Number.isFinite(startedAt) && startedAt <= Date.now());
  const model = viewer?.model;
  const check = () => {
    if (signal?.aborted) throw new DOMException('Multipart capture cancelled.', 'AbortError');
    need(model && viewer.model === model && isCurrent() === true, 'BARRIER_MULTIPART_MODEL_CHANGED');
    need(String(globalThis.LMV_VIEWER_VERSION ?? '') === '7.130.0' && globalThis.Autodesk?.Viewing?.Private === sdk, 'BARRIER_MULTIPART_SDK_UNSUPPORTED');
    need(Date.now() - startedAt < L.milliseconds, 'BARRIER_MULTIPART_PRODUCER_DEADLINE');
  };
  const digest = async bytes => {
    check(); need(bytes instanceof Uint8Array && bytes.byteLength <= L.chunkBytes, 'BARRIER_MULTIPART_CHUNK_LIMIT');
    const copy = Uint8Array.from(bytes);
    const result = await abortable(() => sha256 ? sha256(copy) : globalThis.crypto.subtle.digest('SHA-256', copy)
      .then(value => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('')), signal);
    check(); need(hash(result)); return result;
  };
  const sdk = globalThis.Autodesk?.Viewing?.Private;
  need(String(globalThis.LMV_VIEWER_VERSION ?? '') === '7.130.0' && typeof sdk?.LmvMatrix4 === 'function'
    && typeof sdk.makeReadPositionFunc === 'function' && typeof sdk.getVertexCount === 'function'
    && typeof sdk.getIndicesCount === 'function', 'BARRIER_MULTIPART_SDK_UNSUPPORTED');
  const matrix = () => { const result = new sdk.LmvMatrix4(true);
    need(result.elements instanceof Float64Array && result.elements.length === 16, 'BARRIER_MULTIPART_FRAME_UNSUPPORTED'); return result; };
  check(); return { model, sdk, matrix, check, digest, signal, startedAt, loadId };
}
const values = value => Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : [value?.x, value?.y, value?.z];
const validMatrix = value => Array.isArray(value) && value.length === 16 && value.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9)
  && value[3] === 0 && value[7] === 0 && value[11] === 0 && value[15] === 1
  && value[0] * (value[5] * value[10] - value[9] * value[6]) - value[4] * (value[1] * value[10] - value[9] * value[2])
    + value[8] * (value[1] * value[6] - value[5] * value[2]) !== 0;
async function frame(ctx, descriptor) {
  ctx.check(); const model = ctx.model, scale = model.getUnitScale?.(), sourceUnits = model.getUnitString?.();
  const up = values(model.getUpVector?.()), offset = values(model.getGlobalOffset?.() ?? model.getData?.()?.globalOffset);
  need(typeof sourceUnits === 'string' && sourceUnits.length > 0 && sourceUnits.length <= 64 && Number.isFinite(scale) && scale > 0 && scale <= 1e6
    && up.length === 3 && up.every(Number.isFinite) && Math.abs(up[0]) <= 1e-12 && Math.abs(up[1]) <= 1e-12 && Math.abs(up[2] - 1) <= 1e-12
    && offset.length === 3 && offset.every(n => Number.isFinite(n) && Math.abs(n) <= 1e12), 'BARRIER_MULTIPART_FRAME_UNSUPPORTED');
  const display = ctx.matrix().makeScale(scale, scale, scale); for (let i = 0; i < 3; i++) display.elements[12 + i] = offset[i] * scale;
  const optional = getter => { const value = getter?.call(model); if (value === null || value === undefined) return null;
    const result = Array.from(value.elements ?? []); need(validMatrix(result), 'BARRIER_MULTIPART_FRAME_UNSUPPORTED'); return result; };
  const result = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1', projectId: descriptor.projectId, modelVersionId: descriptor.modelVersionId,
    contentFingerprint: descriptor.contentFingerprint, loadId: ctx.loadId, sdkVersion: '7.130.0', matrixPrecision: 'binary64', coordinateFrame: 'canonical-world-metres',
    sourceUnits, metresPerDisplayUnit: scale, upVector: up, globalOffsetDisplayUnits: offset, globalOffsetMetres: offset.map(n => n * scale),
    displayToWorldMetres: Array.from(display.elements), modelTransform: optional(model.getModelTransform), placementTransform: optional(model.getPlacementTransform) };
  const observation = { ...result, contentSha256: await ctx.digest(encoder.encode(barrierCanonicalJson(result))) };
  need(validateBarrierFrameObservation(observation), 'BARRIER_MULTIPART_FRAME_UNSUPPORTED'); return observation;
}
/** Small pre-admission observation. Never enumerate geometry to read the frame. */
export async function observeMultipartFrame(viewer, descriptor, options) {
  need(uuid(descriptor?.projectId) && uuid(descriptor?.modelVersionId) && hash(descriptor?.contentFingerprint));
  return frame(execution(viewer, options), { ...descriptor });
}
function binary64(numbers) {
  const result = new Uint8Array(numbers.length * 8), view = new DataView(result.buffer);
  for (let i = 0; i < numbers.length; i++) { need(Number.isFinite(numbers[i])); view.setFloat64(i * 8, numbers[i], true); }
  return result;
}
function uint32Bytes(numbers) {
  const result = new Uint8Array(numbers.length * 4), view = new DataView(result.buffer);
  for (let i = 0; i < numbers.length; i++) view.setUint32(i * 4, numbers[i], true); return result;
}
/** Explicit chunk-chain identity, NOT SHA256(raw whole mesh). Every hash input
 * is detached and <=256KiB; no complete fragment byte copy is constructed. */
async function chain(ctx, domain, manifest, segments) {
  const prefix = { schemaVersion: 'sha256-bounded-chunk-chain-v1', domain, manifest };
  let previous = await ctx.digest(encoder.encode(barrierCanonicalJson(prefix))), totalBytes = 0, chunks = 0, segmentCount = 0;
  for await (const segment of segments) {
    ctx.check(); need(segment instanceof Uint8Array); const segmentOrdinal = segmentCount++;
    for (let offset = 0; offset < segment.byteLength; offset += L.chunkBytes) {
      const raw = segment.subarray(offset, Math.min(offset + L.chunkBytes, segment.byteLength));
      const sha256 = await ctx.digest(raw); totalBytes += raw.byteLength;
      need(Number.isSafeInteger(totalBytes)); previous = await ctx.digest(encoder.encode(barrierCanonicalJson({
        schemaVersion: prefix.schemaVersion, domain, previous, segmentOrdinal, offset, bytes: raw.byteLength, sha256, chunkOrdinal: chunks++ })));
    }
  }
  return ctx.digest(encoder.encode(barrierCanonicalJson({ ...prefix, previous, totalBytes, chunks, segmentCount })));
}
const byteView = array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
function search(ids, id) { let low = 0, high = ids.length - 1; while (low <= high) { const mid = (low + high) >>> 1;
  if (ids[mid] === id) return mid; if (ids[mid] < id) low = mid + 1; else high = mid - 1; } return -1; }
function maskAt(words, ordinal) { let result = ''; for (let i = 3; i >= 0; i--) result += words[ordinal * 4 + i].toString(16).padStart(8, '0'); return result; }
function scopeCheck(scope) {
  need(exact(scope, ['schemaVersion', 'modelScope', 'modelLoadId', 'selectedParents', 'geometryPolicy'])
    && exact(scope.modelScope, ['projectId', 'modelVersionId', 'contentFingerprint', 'selectionRevision', 'captureFrameId', 'captureFrameSha256', 'coordinateFrame'])
    && scope.schemaVersion === 'wfc.pf.barrier-multipart-scope.v2' && uuid(scope.modelLoadId)
    && scope.geometryPolicy === P.geometryPolicy && scope.modelScope?.coordinateFrame === 'canonical-world-metres'
    && uuid(scope.modelScope.projectId) && uuid(scope.modelScope.modelVersionId) && hash(scope.modelScope.contentFingerprint)
    && uuid(scope.modelScope.captureFrameId) && hash(scope.modelScope.captureFrameSha256)
    && /^(?:0|[1-9][0-9]{0,18})$/.test(scope.modelScope.selectionRevision) && BigInt(scope.modelScope.selectionRevision) <= 9223372036854775807n
    && Array.isArray(scope.selectedParents) && scope.selectedParents.length > 0 && scope.selectedParents.length <= P.limits.selectedParents);
  const selections = new Set(); let previous = -1;
  for (const parent of scope.selectedParents) { need(exact(parent, ['selectionId', 'dbId', 'kind']) && integer(parent.dbId, 2147483647) && parent.dbId > previous && uuid(parent.selectionId)
    && !selections.has(parent.selectionId) && ['wall', 'partition', 'floor', 'ceiling', 'obstacle'].includes(parent.kind)); previous = parent.dbId; selections.add(parent.selectionId); }
}
async function objectTree(ctx) {
  ctx.check(); return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); ctx.signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
    const abort = () => finish(new DOMException('Multipart capture cancelled.', 'AbortError'));
    const unavailable = () => finish(Object.assign(new Error('BARRIER_MULTIPART_GEOMETRY_UNAVAILABLE'), { code: 'BARRIER_MULTIPART_GEOMETRY_UNAVAILABLE' }));
    const timer = setTimeout(unavailable, Math.min(45000, Math.max(1, L.milliseconds - (Date.now() - ctx.startedAt))));
    ctx.signal?.addEventListener('abort', abort, { once: true });
    try { ctx.model.getObjectTree(value => { try { ctx.check(); finish(null, value); } catch (error) { finish(error); } }, unavailable); }
    catch (error) { finish(error); }
  });
}
async function indexScene(ctx, scope) {
  const tree = await objectTree(ctx); ctx.check(); const list = ctx.model.getFragmentList?.(), count = tree?.nodeAccess?.getNumNodes?.(), fragments = list?.getCount?.();
  need(integer(count, P.limits.nodes) && count > 0 && integer(fragments, P.limits.fragments) && fragments > 0
    && tree.nodeAccess.nodes instanceof Int32Array && tree.nodeAccess.nodes.length >= count * 6
    && ['getRootId', 'getNodeIndex', 'getNodeParentId', 'enumNodeChildren', 'enumNodeFragments'].every(key => typeof tree[key] === 'function')
    && ['getGeometry', 'getOriginalWorldMatrix', 'getWorldMatrix'].every(key => typeof list[key] === 'function'), 'BARRIER_MULTIPART_SDK_UNSUPPORTED');
  need(count * 20 <= L.lookupBytes && fragments * 4 + count <= L.metadataBytes, 'BARRIER_MULTIPART_METADATA_LIMIT');
  const queue = new Uint32Array(count), masks = new Uint32Array(count * 4), owners = new Uint32Array(fragments).fill(absent), witness = new Uint8Array(count);
  const root = tree.getRootId(); need(integer(root, 2147483647)); let length = 0, physicalCount = 0;
  const sdkIndex = id => { const n = tree.getNodeIndex(id); need(integer(n, count - 1) && tree.nodeAccess.nodes[n * 6] === id, 'BARRIER_MULTIPART_HIERARCHY_INVALID'); return n; };
  const ancestry = id => { const seen = new Uint32Array(L.ancestry); let size = 0, current = id;
    for (;;) { ctx.check(); need(integer(current, 2147483647) && size < L.ancestry && !seen.subarray(0, size).includes(current), 'BARRIER_MULTIPART_HIERARCHY_INVALID'); seen[size++] = current;
      if (current === root) return; current = tree.getNodeParentId(current); }
  };
  for (const parent of scope.selectedParents) { sdkIndex(parent.dbId); ancestry(parent.dbId); const n = sdkIndex(parent.dbId);
    if (!(witness[n] & 1)) { need(length < count, 'BARRIER_MULTIPART_METADATA_LIMIT'); queue[length++] = parent.dbId; witness[n] |= 1; } }
  for (let at = 0; at < length; at++) {
    ctx.check(); const id = queue[at];
    tree.enumNodeFragments(id, fragmentId => { ctx.check(); need(integer(fragmentId, fragments - 1) && owners[fragmentId] === absent, 'BARRIER_MULTIPART_FRAGMENT_OWNER_INVALID'); owners[fragmentId] = id; physicalCount++; }, false);
    tree.enumNodeChildren(id, child => { ctx.check(); const n = sdkIndex(child);
      need(child !== id && tree.getNodeParentId(child) === id && !(witness[n] & 2), 'BARRIER_MULTIPART_HIERARCHY_INVALID'); witness[n] |= 2;
      if (!(witness[n] & 1)) { need(length < count, 'BARRIER_MULTIPART_METADATA_LIMIT'); queue[length++] = child; witness[n] |= 1; } return false;
    }, false);
    if (at % 512 === 0) await pause();
  }
  const ids = queue.subarray(0, length); ids.sort(); need(length > 0 && physicalCount > 0, 'BARRIER_MULTIPART_GEOMETRY_UNAVAILABLE');
  const parentBits = new Map(scope.selectedParents.map((parent, index) => [parent.dbId, 1n << BigInt(index)])), stack = new Uint32Array(L.ancestry);
  const readMask = ordinal => BigInt('0x' + maskAt(masks, ordinal));
  for (let at = 0; at < ids.length; at++) {
    if (readMask(at) !== 0n) continue; let current = at, size = 0, inherited = 0n;
    for (;;) { ctx.check(); need(size < L.ancestry && !stack.subarray(0, size).includes(current), 'BARRIER_MULTIPART_HIERARCHY_INVALID');
      if (readMask(current) !== 0n) { inherited = readMask(current); break; } stack[size++] = current;
      const parent = tree.getNodeParentId(ids[current]); current = search(ids, parent); if (current < 0) break;
    }
    while (size) { const ordinal = stack[--size]; inherited |= parentBits.get(ids[ordinal]) ?? 0n; need(inherited !== 0n, 'BARRIER_MULTIPART_HIERARCHY_INVALID');
      for (let word = 0; word < 4; word++) masks[ordinal * 4 + word] = Number((inherited >> BigInt(word * 32)) & 0xffffffffn); }
    if (at % 512 === 0) await pause();
  }
  return { tree, list, ids, masks, owners, physicalCount, count, fragments,
    lookupBytes: queue.byteLength + masks.byteLength, metadataBytes: owners.byteLength + witness.byteLength };
}
function geometryDescription(ctx, scene, fragmentId) {
  ctx.check(); const geometry = scene.list.getGeometry(fragmentId);
  const primitive = !geometry ? 'unavailable' : geometry.isLines ? 'lines' : geometry.isPoints ? 'points' : geometry.is2d ? 'unknown' : 'triangles';
  if (primitive !== 'triangles') return { primitive };
  const vertices = ctx.sdk.getVertexCount(geometry), indices = geometry.ib ?? geometry.indices ?? geometry.index?.array ?? null;
  const position = geometry.vblayout?.position ?? geometry.attributes?.position, source = geometry.vb ?? position?.array;
  need(integer(vertices, P.limits.sourceCount) && vertices >= 3 && ArrayBuffer.isView(source) && !(source instanceof DataView)
    && (indices === null || indices instanceof Uint16Array || indices instanceof Uint32Array), 'BARRIER_MULTIPART_GEOMETRY_INVALID');
  const read = ctx.sdk.makeReadPositionFunc(geometry); need(typeof read === 'function', 'BARRIER_MULTIPART_GEOMETRY_INVALID');
  const groups = indices === null ? null : Array.isArray(geometry.groups) && geometry.groups.length ? geometry.groups : null;
  const groupCount = groups?.length ?? 1;
  need(integer(groupCount) && groupCount > 0 && scene.owners.byteLength + groupCount * 4 <= L.metadataBytes, 'BARRIER_MULTIPART_METADATA_LIMIT');
  const sorted = new Uint32Array(groupCount); let triangles = 0;
  const group = ordinal => {
    if (!groups) return { start: 0, count: indices?.length ?? vertices, index: 0 };
    const descriptor = Object.getOwnPropertyDescriptor(groups, String(ordinal)), value = descriptor?.value;
    need(value && ['start', 'count', 'index'].every(key => Object.getOwnPropertyDescriptor(value, key)?.value !== undefined), 'BARRIER_MULTIPART_GROUP_INVALID');
    return value;
  };
  for (let i = 0; i < groupCount; i++) {
    const item = group(i); need(item && integer(item.start) && integer(item.count) && item.count > 0 && item.start % 3 === 0 && item.count % 3 === 0
      && integer(item.index) && item.start + item.count <= (indices?.length ?? vertices), 'BARRIER_MULTIPART_GROUP_INVALID');
    sorted[i] = i; triangles += item.count / 3; need(integer(triangles, P.limits.sourceCount), 'BARRIER_MULTIPART_GEOMETRY_INVALID');
  }
  sorted.sort((a, b) => group(a).start - group(b).start);
  for (let i = 1; i < sorted.length; i++) need(group(sorted[i]).start >= group(sorted[i - 1]).start + group(sorted[i - 1]).count, 'BARRIER_MULTIPART_GROUP_OVERLAP');
  need(ctx.sdk.getIndicesCount(geometry) === triangles * 3, 'BARRIER_MULTIPART_GEOMETRY_INVALID');
  const layout = {};
  for (const key of Object.keys(position ?? {}).filter(key => key !== 'array')) { const descriptor = Object.getOwnPropertyDescriptor(position, key), value = descriptor?.value;
    need(descriptor && 'value' in descriptor && Object.keys(layout).length < 24 && key.length <= 64
      && (value === null || typeof value === 'boolean' || typeof value === 'string' && value.length <= 128 || Number.isFinite(value)), 'BARRIER_MULTIPART_GEOMETRY_INVALID'); layout[key] = value; }
  const describe = { primitive, geometry, vertices, triangles, indices, source, read, group, groupCount, layout,
    stride: geometry.vb ? geometry.vbstride : position.itemSize ?? 3, sourceType: source.constructor.name, indexType: indices?.constructor.name ?? null };
  return describe;
}
function physicalTransform(ctx, scene, fragmentId, observation) {
  const original = ctx.matrix(), world = ctx.matrix(); scene.list.getOriginalWorldMatrix(fragmentId, original); scene.list.getWorldMatrix(fragmentId, world);
  const expected = observation.modelTransform === null ? ctx.matrix().copy(original) : (() => { const model = ctx.matrix(); model.elements.set(observation.modelTransform); return model.multiply(original); })();
  need(validMatrix(Array.from(original.elements)) && validMatrix(Array.from(world.elements))
    && world.elements.every((n, index) => Object.is(n, expected.elements[index])), 'BARRIER_MULTIPART_TRANSFORM_CHANGED');
  const display = ctx.matrix(); display.elements.set(observation.displayToWorldMetres); const canonical = display.multiply(world);
  need(validMatrix(Array.from(canonical.elements)), 'BARRIER_MULTIPART_FRAME_UNSUPPORTED');
  return { canonical: canonical.elements, original: original.elements, world: world.elements };
}
async function geometryIdentity(ctx, description) {
  async function* segments() {
    yield byteView(description.source); if (description.indices) yield byteView(description.indices);
    const perChunk = Math.floor(L.chunkBytes / 12);
    for (let first = 0; first < description.groupCount; first += perChunk) { const count = Math.min(perChunk, description.groupCount - first), data = new Uint32Array(count * 3);
      for (let i = 0; i < count; i++) { const group = description.group(first + i); data[i * 3] = group.start; data[i * 3 + 1] = group.count; data[i * 3 + 2] = group.index; }
      yield uint32Bytes(data);
    }
  }
  return chain(ctx, 'sdk7130-original-geometry-v1', { triangleOrder: BARRIER_MULTIPART_PRODUCER_PROFILE.triangleOrder,
    sourceVertexCount: description.vertices, sourceTriangleCount: description.triangles, sourceType: description.sourceType,
    indexType: description.indexType, layout: description.layout, stride: description.stride, groupCount: description.groupCount,
    byteOrder: new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 'little-endian' : 'big-endian' }, segments());
}
async function transformIdentity(ctx, transform, observation, scopeSha256) {
  return chain(ctx, 'sdk7130-canonical-transform-v1', { scopeSha256, frameSha256: observation.contentSha256,
    encoding: 'binary64-little-endian-preserve-signed-zero', segments: ['original', 'world', 'canonical'] },
  [binary64(transform.original), binary64(transform.world), binary64(transform.canonical)]);
}
function stream(ctx, kind, scopeSha256, profileSha256) {
  let records = [], index = 0, firstOrdinal = 0, previousPageSha256 = null;
  return {
    async add(row) { records.push(row); return records.length === P.limits.pageRecords ? this.flush() : null; },
    async flush() { if (!records.length) return null; ctx.check(); need(index < P.limits.pages, 'BARRIER_MULTIPART_PAGE_LIMIT');
      const body = { schemaVersion: 'wfc.pf.barrier-multipart-page.v2', kind, scopeSha256, profileSha256, index, firstOrdinal, previousPageSha256, records };
      const page = { ...body, pageSha256: await barrierPlanHash('page', body, ctx.sha256, ctx.signal) };
      need(encoder.encode(barrierPlanCanonical(page)).byteLength <= P.limits.pageBytes, 'BARRIER_MULTIPART_PAGE_LIMIT');
      firstOrdinal += records.length; previousPageSha256 = page.pageSha256; index++; records = []; ctx.check(); return page;
    },
    async seal(totals) { ctx.check(); need(records.length === 0 && firstOrdinal > 0);
      const body = { schemaVersion: 'wfc.pf.barrier-multipart-seal.v2', kind, scopeSha256, profileSha256, pageCount: index, recordCount: firstOrdinal, tailPageSha256: previousPageSha256, totals };
      return { ...body, sealSha256: await barrierPlanHash('seal', body, ctx.sha256, ctx.signal) }; },
  };
}
async function* replayRows(ctx, readPages, kind, seal) {
  let index = 0, ordinal = 0, previous = null;
  const source = readPages(kind), iterator = source?.[Symbol.asyncIterator]?.() ?? source?.[Symbol.iterator]?.();
  need(iterator && typeof iterator.next === 'function');
  try { for (;;) { const item = await abortable(() => iterator.next(), ctx.signal); if (item.done) break;
    ctx.check(); const page = detached(item.value), { pageSha256, ...body } = page;
    need(page.kind === kind && page.scopeSha256 === seal.scopeSha256 && page.profileSha256 === seal.profileSha256 && page.index === index++
      && page.firstOrdinal === ordinal && page.previousPageSha256 === previous && Array.isArray(page.records) && page.records.length > 0 && page.records.length <= P.limits.pageRecords
      && await barrierPlanHash('page', body, ctx.sha256, ctx.signal) === pageSha256, 'BARRIER_MULTIPART_REPLAY_CHANGED');
    for (const row of page.records) { ordinal++; yield row; } previous = pageSha256;
  } } finally { try { void Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* Foreign cleanup cannot authorize completion. */ } }
  need(index === seal.pageCount && ordinal === seal.recordCount && previous === seal.tailPageSha256, 'BARRIER_MULTIPART_REPLAY_CHANGED');
}
async function rangeHash(ctx, domain, data) {
  async function* chunks() { for (let first = 0; first < data.length; first += L.chunkBytes / 4) yield uint32Bytes(data.subarray(first, Math.min(first + L.chunkBytes / 4, data.length))); }
  return chain(ctx, domain, { encoding: 'uint32-little-endian', values: data.length }, chunks());
}
async function finalHierarchy(ctx, scene, scope) {
  const seen = new Uint8Array(scene.count), parentBits = new Map(scope.selectedParents.map((parent, index) => [parent.dbId, 1n << BigInt(index)])); let physical = 0;
  for (let ordinal = 0; ordinal < scene.ids.length; ordinal++) {
    ctx.check(); const id = scene.ids[ordinal]; let current = id, mask = 0n;
    for (let depth = 0;; depth++) { ctx.check(); need(depth < L.ancestry, 'BARRIER_MULTIPART_HIERARCHY_INVALID');
      mask |= parentBits.get(current) ?? 0n;
      if (current === scene.tree.getRootId()) break; current = scene.tree.getNodeParentId(current); need(integer(current, 2147483647), 'BARRIER_MULTIPART_HIERARCHY_CHANGED'); }
    need(mask.toString(16).padStart(32, '0') === maskAt(scene.masks, ordinal), 'BARRIER_MULTIPART_HIERARCHY_CHANGED');
    scene.tree.enumNodeFragments(id, fragmentId => { need(integer(fragmentId, scene.fragments - 1) && scene.owners[fragmentId] === id, 'BARRIER_MULTIPART_HIERARCHY_CHANGED');
      scene.owners[fragmentId] = id | 0x80000000; physical++; }, false);
    scene.tree.enumNodeChildren(id, child => { const index = scene.tree.getNodeIndex(child);
      need(integer(index, scene.count - 1) && scene.tree.nodeAccess.nodes[index * 6] === child && search(scene.ids, child) >= 0
        && scene.tree.getNodeParentId(child) === id && !seen[index], 'BARRIER_MULTIPART_HIERARCHY_CHANGED'); seen[index] = 1; return false; }, false);
    if (ordinal % 512 === 0) await pause();
  }
  need(physical === scene.physicalCount, 'BARRIER_MULTIPART_HIERARCHY_CHANGED');
  for (let ordinal = 0; ordinal < scene.ids.length; ordinal++) {
    ctx.check(); const id = scene.ids[ordinal], parent = scene.tree.getNodeParentId(id);
    if (id !== scene.tree.getRootId() && search(scene.ids, parent) >= 0)
      need(seen[scene.tree.getNodeIndex(id)] === 1, 'BARRIER_MULTIPART_HIERARCHY_CHANGED');
    if (ordinal % 512 === 0) await pause();
  }
}
/** Emits only bounded control evidence. The later codec/geometry qualification
 * stage owns mesh payloads; this producer never publishes a barrier head. */
export async function* createBarrierMultipartProducer(viewer, options) {
  const scope = detached(options?.scope), profile = detached(options?.profile), producerProfile = detached(options?.producerProfile ?? BARRIER_MULTIPART_PRODUCER_PROFILE);
  scopeCheck(scope); need(barrierPlanCanonical(profile) === barrierPlanCanonical(P)
    && barrierPlanCanonical(producerProfile) === barrierPlanCanonical(BARRIER_MULTIPART_PRODUCER_PROFILE) && typeof options.readPages === 'function');
  const readPages = options.readPages, onProgress = options.onProgress ?? (() => {});
  need(typeof onProgress === 'function'); const ctx = execution(viewer, options); ctx.sha256 = options.sha256;
  need(scope.modelLoadId === ctx.loadId); const observation = JSON.parse(barrierCanonicalJson(options.frameObservation));
  need(validateBarrierFrameObservation(observation) && observation.loadId === ctx.loadId && observation.projectId === scope.modelScope.projectId
    && observation.modelVersionId === scope.modelScope.modelVersionId && observation.contentFingerprint === scope.modelScope.contentFingerprint
    && barrierCanonicalJson(await frame(ctx, scope.modelScope)) === barrierCanonicalJson(observation), 'BARRIER_MULTIPART_FRAME_CHANGED');
  const scopeSha256 = await barrierPlanHash('scope', scope, ctx.sha256, ctx.signal), profileSha256 = await barrierPlanHash('profile', profile, ctx.sha256, ctx.signal);
  const scene = await indexScene(ctx, scope), seals = {}, nodeStream = stream(ctx, 'nodes', scopeSha256, profileSha256);
  onProgress({ phase: 'index', nodes: scene.ids.length, fragments: scene.physicalCount, lookupBytes: scene.lookupBytes, metadataBytes: scene.metadataBytes });
  for (let ordinal = 0; ordinal < scene.ids.length; ordinal++) { const page = await nodeStream.add({ dbId: scene.ids[ordinal], membershipMask: maskAt(scene.masks, ordinal) }); if (page) { ctx.check(); yield { kind: 'page', page }; } }
  { const page = await nodeStream.flush(); if (page) yield { kind: 'page', page }; }
  seals.nodes = await nodeStream.seal({ nodes: scene.ids.length }); ctx.check(); yield { kind: 'seal', seal: seals.nodes };
  const fragments = stream(ctx, 'fragments', scopeSha256, profileSha256); let fragmentOrdinal = 0, sourceVertices = 0, sourceTriangles = 0, membership = 0n;
  for (let fragmentId = 0; fragmentId < scene.owners.length; fragmentId++) {
    const owner = scene.owners[fragmentId]; if (owner === absent) continue; ctx.check(); const ordinal = search(scene.ids, owner); need(ordinal >= 0);
    const mask = maskAt(scene.masks, ordinal), geometry = geometryDescription(ctx, scene, fragmentId);
    const row = { fragmentId, ownerNodeOrdinal: ordinal, ownerDbId: owner, membershipMask: mask, primitive: geometry.primitive,
      sourceGeometrySha256: null, transformSha256: null, sourceVertexCount: 0, sourceTriangleCount: 0 };
    if (geometry.primitive === 'triangles') { const transform = physicalTransform(ctx, scene, fragmentId, observation);
      row.sourceGeometrySha256 = await geometryIdentity(ctx, geometry); row.transformSha256 = await transformIdentity(ctx, transform, observation, scopeSha256);
      row.sourceVertexCount = geometry.vertices; row.sourceTriangleCount = geometry.triangles; sourceVertices += geometry.vertices; sourceTriangles += geometry.triangles;
      need(Number.isSafeInteger(sourceVertices) && Number.isSafeInteger(sourceTriangles)); membership |= BigInt('0x' + mask);
    }
    const page = await fragments.add(row); if (page) yield { kind: 'page', page }; fragmentOrdinal++;
    if (geometry.primitive !== 'triangles') { const pending = await fragments.flush(); if (pending) yield { kind: 'page', page: pending }; fail('BARRIER_MULTIPART_PRIMITIVE_' + geometry.primitive.toUpperCase()); }
    if (fragmentOrdinal % 512 === 0) onProgress({ phase: 'fragments', loaded: fragmentOrdinal, total: scene.physicalCount });
    await pause();
  }
  need(membership === (1n << BigInt(scope.selectedParents.length)) - 1n, 'BARRIER_MULTIPART_PARENT_COVERAGE');
  { const page = await fragments.flush(); if (page) yield { kind: 'page', page }; }
  seals.fragments = await fragments.seal({ fragments: fragmentOrdinal, sourceVertices, sourceTriangles, unavailable: 0, nonTriangle: 0 }); ctx.check(); yield { kind: 'seal', seal: seals.fragments };
  const ranges = stream(ctx, 'geometry-ranges', scopeSha256, profileSha256); let rangeOrdinal = 0, referencedVertices = 0, triangles = 0, currentFragment = 0;
  for await (const fragment of replayRows(ctx, readPages, 'fragments', seals.fragments)) {
    const geometry = geometryDescription(ctx, scene, fragment.fragmentId); need(geometry.primitive === 'triangles'
      && geometry.vertices === fragment.sourceVertexCount && geometry.triangles === fragment.sourceTriangleCount
      && await geometryIdentity(ctx, geometry) === fragment.sourceGeometrySha256, 'BARRIER_MULTIPART_GEOMETRY_CHANGED');
    const transform = physicalTransform(ctx, scene, fragment.fragmentId, observation);
    need(await transformIdentity(ctx, transform, observation, scopeSha256) === fragment.transformSha256, 'BARRIER_MULTIPART_TRANSFORM_CHANGED');
    let groupOrdinal = 0, withinGroup = 0;
    for (const hint of planBarrierFragmentSplitHints({ sourceVertices: geometry.vertices, sourceTriangles: geometry.triangles, profile })) {
      ctx.check(); const indices = new Uint32Array(hint.triangleCount * 3);
      for (let i = 0; i < indices.length; i += 3) {
        const group = geometry.group(groupOrdinal), offset = group.start + withinGroup;
        for (let j = 0; j < 3; j++) { const sourceId = geometry.indices ? group.index + geometry.indices[offset + j] : offset + j;
          need(integer(sourceId, geometry.vertices - 1), 'BARRIER_MULTIPART_INDEX_INVALID'); indices[i + j] = sourceId; }
        need(indices[i] !== indices[i + 1] && indices[i] !== indices[i + 2] && indices[i + 1] !== indices[i + 2], 'BARRIER_MULTIPART_INDEX_INVALID');
        withinGroup += 3; if (withinGroup === group.count) { withinGroup = 0; groupOrdinal++; }
        if (i % 12288 === 0) { ctx.check(); await pause(); }
      }
      const vertexIds = indices.slice(); vertexIds.sort(); let unique = 0;
      for (const id of vertexIds) if (unique === 0 || id !== vertexIds[unique - 1]) vertexIds[unique++] = id;
      need(unique >= 3 && unique <= P.part.vertices, 'BARRIER_MULTIPART_RANGE_LIMIT'); const selectedIds = vertexIds.subarray(0, unique), point = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < selectedIds.length; i++) { geometry.read(selectedIds[i], point); const local = [point.x, point.y, point.z];
        need(local.every(n => Number.isFinite(n) && Math.abs(n) <= 1e12), 'BARRIER_MULTIPART_VERTEX_INVALID');
        for (let axis = 0; axis < 3; axis++) { const m = transform.canonical, world = m[axis] * local[0] + m[4 + axis] * local[1] + m[8 + axis] * local[2] + m[12 + axis]; need(Number.isFinite(world) && Math.abs(world) <= 1e9, 'BARRIER_MULTIPART_VERTEX_INVALID'); }
        if (i % 4096 === 0) { ctx.check(); await pause(); }
      }
      const row = { fragmentOrdinal: currentFragment, triangleStart: hint.triangleStart, triangleCount: hint.triangleCount, referencedVertexCount: unique,
        sourceVertexIdsSha256: await rangeHash(ctx, 'sdk7130-ordered-original-vertex-ids-v1', selectedIds), sourceIndicesSha256: await rangeHash(ctx, 'sdk7130-rendered-original-indices-v1', indices),
        sourceGeometrySha256: fragment.sourceGeometrySha256, transformSha256: fragment.transformSha256, membershipMask: fragment.membershipMask };
      referencedVertices += unique; triangles += hint.triangleCount; rangeOrdinal++; need(rangeOrdinal <= P.limits.ranges && Number.isSafeInteger(referencedVertices) && Number.isSafeInteger(triangles));
      const page = await ranges.add(row); if (page) { ctx.check(); yield { kind: 'page', page }; }
      if (rangeOrdinal % 512 === 0) onProgress({ phase: 'geometry-ranges', loaded: rangeOrdinal, fragments: currentFragment });
    }
    need(groupOrdinal === geometry.groupCount && withinGroup === 0 && scene.list.getGeometry(fragment.fragmentId) === geometry.geometry
      && await geometryIdentity(ctx, geometry) === fragment.sourceGeometrySha256
      && await transformIdentity(ctx, physicalTransform(ctx, scene, fragment.fragmentId, observation), observation, scopeSha256) === fragment.transformSha256, 'BARRIER_MULTIPART_GEOMETRY_CHANGED');
    currentFragment++;
  }
  need(currentFragment === fragmentOrdinal && triangles === sourceTriangles, 'BARRIER_MULTIPART_RANGE_COVERAGE');
  { const page = await ranges.flush(); if (page) yield { kind: 'page', page }; }
  seals['geometry-ranges'] = await ranges.seal({ ranges: rangeOrdinal, referencedVertices, triangles }); ctx.check(); yield { kind: 'seal', seal: seals['geometry-ranges'] };
  for await (const event of planBarrierMultipart({ scope, profile, nodeSeal: seals.nodes, fragmentSeal: seals.fragments, rangeSeal: seals['geometry-ranges'],
    nodePages: readPages('nodes'), fragmentPages: readPages('fragments'), geometryRangePages: readPages('geometry-ranges'), sha256: ctx.sha256, signal: ctx.signal })) {
    ctx.check(); if (event.kind === 'plan-page') yield { kind: 'page', page: event.page };
    else { await finalHierarchy(ctx, scene, scope); need(barrierCanonicalJson(await frame(ctx, scope.modelScope)) === barrierCanonicalJson(observation), 'BARRIER_MULTIPART_FRAME_CHANGED');
      ctx.check(); yield { kind: 'seal', seal: event.seal }; }
  }
}
