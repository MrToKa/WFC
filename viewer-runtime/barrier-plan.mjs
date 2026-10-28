// Structural planning only. No SDK, files, network, publication or collision authority.
const VERSION = 'wfc.pf.barrier-multipart-', POLICY = 'original-triangles-structural-only.v2';
export const BARRIER_MULTIPART_PLANNER_PROFILE = Object.freeze({
  schemaVersion: VERSION + 'profile.v2', qualification: 'NOT_MEASURED', geometryPolicy: POLICY,
  limits: Object.freeze({ selectedParents: 128, pageBytes: 262144, pageRecords: 512, nodes: 1048576,
    nodeLookupBytes: 20971520, fragments: 1048576, ranges: 16777216, pages: 65536, parts: 1048576, sourceCount: 4294967295 }),
  part: Object.freeze({ fragmentRefs: 8192, vertices: 500000, triangles: 250000, bytes: 33554432 }),
  byteEnvelope: Object.freeze({ partHeader: 8192, rangeDescriptor: 4096, referencedVertex: 128, triangle: 48,
    membershipBits: 128, maxNumericTokenBytes: 32, maxIndexDigits: 10, descriptorBytes: 4096,
    encoding: 'nameless-json-upper-bound.v2', coordinateEncoding: 'finite-binary64-preserve-signed-zero', sourceVertexMap: 'ordered-original-uint32' }),
});
const P = BARRIER_MULTIPART_PLANNER_PROFILE, encoder = new TextEncoder();
const byteLength = text => /[^\u0000-\u007f]/u.test(text) ? encoder.encode(text).byteLength : text.length;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uint = (value, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= maximum;
const own = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => own(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined);
const fail = (code = 'BARRIER_PLAN_INVALID') => { throw Object.assign(Error(code), { code }); };
const need = (condition, code) => { if (!condition) fail(code); };
const add = (a, b) => { need(uint(a) && uint(b) && a <= Number.MAX_SAFE_INTEGER - b, 'BARRIER_PLAN_ARITHMETIC'); return a + b; };
const multiply = (a, b) => { need(uint(a) && uint(b) && (b === 0 || a <= Math.floor(Number.MAX_SAFE_INTEGER / b)), 'BARRIER_PLAN_ARITHMETIC'); return a * b; };
const check = signal => { if (signal?.aborted) throw new DOMException('Structural planning cancelled.', 'AbortError'); };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
async function abortable(work, signal) {
  check(signal); if (!signal) return work();
  let abort; const stopped = new Promise((_resolve, reject) => { abort = () => reject(new DOMException('Structural planning cancelled.', 'AbortError')); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([Promise.resolve().then(() => { check(signal); return work(); }), stopped]); } finally { signal.removeEventListener('abort', abort); }
}

// Refuse before concatenating an unbounded JSON string. Metadata has no coordinates.
export function barrierPlanCanonical(value, maximumBytes = P.limits.pageBytes) {
  need(uint(maximumBytes) && maximumBytes > 0 && maximumBytes <= P.limits.pageBytes, 'BARRIER_PLAN_BYTES');
  const chunks = [], seen = new Set(); let bytes = 0;
  const append = text => { bytes = add(bytes, byteLength(text)); need(bytes <= maximumBytes, 'BARRIER_PLAN_BYTES'); chunks.push(text); };
  function visit(item, depth) {
    need(depth <= 32, 'BARRIER_PLAN_INVALID');
    if (item === null || typeof item === 'boolean') return append(JSON.stringify(item));
    if (typeof item === 'number') { need(uint(item), 'BARRIER_PLAN_INVALID'); return append(JSON.stringify(item)); }
    if (typeof item === 'string') { need(item.length <= 2048 && !/[\u0000-\u001f\u007f-\u009f]/u.test(item)
      && [...item].every(c => c.length !== 1 || c.charCodeAt(0) < 0xd800 || c.charCodeAt(0) > 0xdfff), 'BARRIER_PLAN_INVALID'); return append(JSON.stringify(item)); }
    need((Array.isArray(item) ? Object.getPrototypeOf(item) === Array.prototype : own(item)) && !seen.has(item)
      && Object.getOwnPropertySymbols(item).length === 0, 'BARRIER_PLAN_INVALID'); seen.add(item);
    if (Array.isArray(item)) {
      need(item.length <= P.part.fragmentRefs && Object.keys(item).length === item.length, 'BARRIER_PLAN_INVALID'); append('[');
      for (let index = 0; index < item.length; index++) { need(Object.hasOwn(item, index) && Object.getOwnPropertyDescriptor(item, index)?.get === undefined, 'BARRIER_PLAN_INVALID'); if (index) append(','); visit(item[index], depth + 1); } append(']');
    } else {
      const keys = Object.keys(item).sort(); need(keys.length <= 32, 'BARRIER_PLAN_INVALID'); append('{');
      for (let index = 0; index < keys.length; index++) { const key = keys[index]; need(key.length <= 96 && Object.getOwnPropertyDescriptor(item, key)?.get === undefined, 'BARRIER_PLAN_INVALID'); if (index) append(','); append(JSON.stringify(key)); append(':'); visit(item[key], depth + 1); } append('}');
    }
    seen.delete(item);
  }
  visit(value, 0); return chunks.join('');
}
const detached = value => JSON.parse(barrierPlanCanonical(value));
const domainValue = (domain, value) => ({ domain: 'wfc.pf.barrier-multipart.v2/' + domain, value });
const stripped = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
export async function barrierPlanHash(domain, value, sha256, signal) {
  check(signal); need(['scope', 'profile', 'page', 'seal', 'range'].includes(domain), 'BARRIER_PLAN_HASH'); const bytes = encoder.encode(barrierPlanCanonical(domainValue(domain, value)));
  const result = await abortable(async () => sha256 ? await sha256(bytes) : [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''), signal);
  check(signal); need(hash(result), 'BARRIER_PLAN_HASH'); return result;
}
function profileValid(profile) { need(barrierPlanCanonical(profile) === barrierPlanCanonical(P), 'BARRIER_PLAN_PROFILE'); }
function scopeValid(scope) {
  need(exact(scope, ['schemaVersion', 'modelScope', 'modelLoadId', 'selectedParents', 'geometryPolicy']) && scope.schemaVersion === VERSION + 'scope.v2'
    && scope.geometryPolicy === POLICY && uuid(scope.modelLoadId), 'BARRIER_PLAN_SCOPE');
  const model = scope.modelScope;
  need(exact(model, ['projectId', 'modelVersionId', 'contentFingerprint', 'selectionRevision', 'captureFrameId', 'captureFrameSha256', 'coordinateFrame'])
    && uuid(model.projectId) && uuid(model.modelVersionId) && hash(model.contentFingerprint) && uuid(model.captureFrameId) && hash(model.captureFrameSha256)
    && typeof model.selectionRevision === 'string' && /^(?:0|[1-9][0-9]{0,18})$/.test(model.selectionRevision)
    && BigInt(model.selectionRevision) <= 9223372036854775807n && model.coordinateFrame === 'canonical-world-metres', 'BARRIER_PLAN_SCOPE');
  need(Array.isArray(scope.selectedParents) && scope.selectedParents.length > 0 && scope.selectedParents.length <= P.limits.selectedParents, 'BARRIER_PLAN_SCOPE');
  const ids = new Set(); let last = -1;
  for (const parent of scope.selectedParents) { need(exact(parent, ['selectionId', 'dbId', 'kind']) && uuid(parent.selectionId) && !ids.has(parent.selectionId)
    && uint(parent.dbId, 2147483647) && parent.dbId > last && ['wall', 'partition', 'floor', 'ceiling', 'obstacle'].includes(parent.kind), 'BARRIER_PLAN_SCOPE'); ids.add(parent.selectionId); last = parent.dbId; }
}
const maskValid = (value, count) => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value) && BigInt('0x' + value) > 0n && BigInt('0x' + value) < (1n << BigInt(count));
const nodeFields = ['dbId', 'membershipMask'];
const fragmentFields = ['fragmentId', 'ownerNodeOrdinal', 'ownerDbId', 'membershipMask', 'primitive', 'sourceGeometrySha256', 'transformSha256', 'sourceVertexCount', 'sourceTriangleCount'];
const rangeFields = ['fragmentOrdinal', 'triangleStart', 'triangleCount', 'referencedVertexCount', 'sourceVertexIdsSha256', 'sourceIndicesSha256', 'sourceGeometrySha256', 'transformSha256', 'membershipMask'];
const totalFields = { nodes: ['nodes'], fragments: ['fragments', 'sourceVertices', 'sourceTriangles', 'unavailable', 'nonTriangle'],
  'geometry-ranges': ['ranges', 'referencedVertices', 'triangles'] };
async function checkedSeal(value, kind, scopeSha256, profileSha256, sha256, signal) {
  const seal = detached(value);
  need(exact(seal, ['schemaVersion', 'kind', 'scopeSha256', 'profileSha256', 'pageCount', 'recordCount', 'tailPageSha256', 'totals', 'sealSha256'])
    && seal.schemaVersion === VERSION + 'seal.v2' && seal.kind === kind && seal.scopeSha256 === scopeSha256 && seal.profileSha256 === profileSha256
    && uint(seal.pageCount, P.limits.pages) && seal.pageCount > 0 && uint(seal.recordCount) && seal.recordCount > 0 && hash(seal.tailPageSha256) && hash(seal.sealSha256)
    && exact(seal.totals, totalFields[kind]) && Object.values(seal.totals).every(n => uint(n)), 'BARRIER_PLAN_SEAL');
  const maximum = kind === 'nodes' ? P.limits.nodes : kind === 'fragments' ? P.limits.fragments : P.limits.ranges;
  need(seal.recordCount >= seal.pageCount && seal.recordCount <= maximum && seal.recordCount <= multiply(seal.pageCount, P.limits.pageRecords), 'BARRIER_PLAN_SEAL');
  need(seal.totals[kind === 'geometry-ranges' ? 'ranges' : kind] === seal.recordCount, 'BARRIER_PLAN_SEAL');
  need(await barrierPlanHash('seal', stripped(seal, 'sealSha256'), sha256, signal) === seal.sealSha256, 'BARRIER_PLAN_HASH'); return seal;
}
function streamCursor(source, seal, scopeSha256, profileSha256, validateRow, sha256, signal) {
  need(source?.[Symbol.asyncIterator] || source?.[Symbol.iterator], 'BARRIER_PLAN_STREAM');
  const iterator = source[Symbol.asyncIterator]?.() ?? source[Symbol.iterator]();
  let page = null, at = 0, pageIndex = 0, ordinal = 0, previous = null, ended = false;
  return {
    async next() {
      check(signal);
      if (page && at < page.records.length) return { row: page.records[at++], ordinal: ordinal++ };
      if (ended) return null;
      page = null;
      const item = await abortable(() => iterator.next(), signal); check(signal);
      if (item.done) { ended = true; page = null; need(pageIndex === seal.pageCount && ordinal === seal.recordCount && previous === seal.tailPageSha256, 'BARRIER_PLAN_COVERAGE'); return null; }
      const candidate = detached(item.value);
      need(exact(candidate, ['schemaVersion', 'kind', 'scopeSha256', 'profileSha256', 'index', 'firstOrdinal', 'previousPageSha256', 'records', 'pageSha256'])
        && candidate.schemaVersion === VERSION + 'page.v2' && candidate.kind === seal.kind && candidate.scopeSha256 === scopeSha256 && candidate.profileSha256 === profileSha256
        && candidate.index === pageIndex && candidate.firstOrdinal === ordinal && candidate.previousPageSha256 === previous && hash(candidate.pageSha256)
        && Array.isArray(candidate.records) && candidate.records.length > 0 && candidate.records.length <= P.limits.pageRecords
        && pageIndex < seal.pageCount && candidate.records.length <= seal.recordCount - ordinal, 'BARRIER_PLAN_PAGE');
      for (const row of candidate.records) validateRow(row);
      need(await barrierPlanHash('page', stripped(candidate, 'pageSha256'), sha256, signal) === candidate.pageSha256, 'BARRIER_PLAN_HASH');
      page = candidate; at = 0; pageIndex++; previous = page.pageSha256;
      return { row: page.records[at++], ordinal: ordinal++ };
    },
    close() { page = null; if (!ended) { try { void Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* Foreign cleanup cannot turn a refused draft into a seal. */ } } },
  };
}
export function barrierRangePlannedBytes(referencedVertices, triangles) {
  return add(P.byteEnvelope.rangeDescriptor, add(multiply(P.byteEnvelope.referencedVertex, referencedVertices), multiply(P.byteEnvelope.triangle, triangles)));
}
/** Counts-only guidance. It is not a sealed range inventory or admitted plan. */
export function* planBarrierFragmentSplitHints({ sourceVertices, sourceTriangles, profile }) {
  profileValid(detached(profile)); need(uint(sourceVertices, P.limits.sourceCount) && sourceVertices >= 3 && uint(sourceTriangles, P.limits.sourceCount) && sourceTriangles > 0, 'BARRIER_PLAN_INVALID');
  let start = 0, count = 0;
  while (start < sourceTriangles) {
    need(++count <= P.limits.ranges, 'BARRIER_PLAN_LIMIT'); let low = 1, high = Math.min(P.part.triangles, sourceTriangles - start), best = 0;
    while (low <= high) { const mid = Math.floor((low + high) / 2), vertices = Math.min(sourceVertices, multiply(3, mid));
      if (vertices <= P.part.vertices && add(P.byteEnvelope.partHeader, barrierRangePlannedBytes(vertices, mid)) <= P.part.bytes) { best = mid; low = mid + 1; } else high = mid - 1; }
    need(best > 0, 'BARRIER_PLAN_REFINEMENT_REQUIRED'); const vertices = Math.min(sourceVertices, multiply(3, best));
    yield { triangleStart: start, triangleCount: best, referencedVertexCountUpperBound: vertices,
      plannedEncodedBytesUpperBound: add(P.byteEnvelope.partHeader, barrierRangePlannedBytes(vertices, best)), admitted: false, authority: 'none', qualification: 'NOT_MEASURED' };
    start = add(start, best);
  }
}

/** Only the terminal seal establishes structural consistency; every page is draft. */
export async function* planBarrierMultipart({ scope: inputScope, profile: inputProfile, nodeSeal: inputNodes, fragmentSeal: inputFragments,
  rangeSeal: inputRanges, nodePages, fragmentPages, geometryRangePages, sha256, signal }) {
  check(signal); const scope = detached(inputScope), profile = detached(inputProfile), originalNodes = detached(inputNodes), originalFragments = detached(inputFragments), originalRanges = detached(inputRanges); scopeValid(scope); profileValid(profile);
  const scopeSha256 = await barrierPlanHash('scope', scope, sha256, signal), profileSha256 = await barrierPlanHash('profile', profile, sha256, signal);
  const nodeSeal = await checkedSeal(originalNodes, 'nodes', scopeSha256, profileSha256, sha256, signal);
  const fragmentSeal = await checkedSeal(originalFragments, 'fragments', scopeSha256, profileSha256, sha256, signal);
  const rangeSeal = await checkedSeal(originalRanges, 'geometry-ranges', scopeSha256, profileSha256, sha256, signal);
  need(multiply(nodeSeal.recordCount, 20) <= P.limits.nodeLookupBytes, 'BARRIER_PLAN_LIMIT');
  // Declared structural bound only; actual planner/geometry capacity is NOT_MEASURED.
  const nodeIds = new Uint32Array(nodeSeal.recordCount), memberships = new Uint32Array(multiply(nodeSeal.recordCount, 4));
  const mask = value => maskValid(value, scope.selectedParents.length);
  const nodeCursor = streamCursor(nodePages, nodeSeal, scopeSha256, profileSha256, row => need(exact(row, nodeFields) && uint(row.dbId, 2147483647) && mask(row.membershipMask), 'BARRIER_PLAN_NODE'), sha256, signal);
  let lastNode = -1, nodeCount = 0;
  const parentMasks = new Map(scope.selectedParents.map((parent, index) => [parent.dbId, 1n << BigInt(index)]));
  const fragmentCursor = streamCursor(fragmentPages, fragmentSeal, scopeSha256, profileSha256, row => need(exact(row, fragmentFields)
    && uint(row.fragmentId, 2147483647) && uint(row.ownerNodeOrdinal, P.limits.nodes - 1) && uint(row.ownerDbId, 2147483647) && mask(row.membershipMask)
    && ['triangles', 'lines', 'points', 'unknown', 'unavailable'].includes(row.primitive) && (row.sourceGeometrySha256 === null || hash(row.sourceGeometrySha256))
    && (row.transformSha256 === null || hash(row.transformSha256)) && uint(row.sourceVertexCount, P.limits.sourceCount) && uint(row.sourceTriangleCount, P.limits.sourceCount)
    && (row.primitive !== 'triangles' || hash(row.sourceGeometrySha256) && hash(row.transformSha256) && row.sourceVertexCount >= 3 && row.sourceTriangleCount > 0), 'BARRIER_PLAN_FRAGMENT'), sha256, signal);
  const rangeCursor = streamCursor(geometryRangePages, rangeSeal, scopeSha256, profileSha256, row => need(exact(row, rangeFields) && uint(row.fragmentOrdinal, P.limits.fragments - 1)
    && uint(row.triangleStart, P.limits.sourceCount) && uint(row.triangleCount, P.limits.sourceCount) && row.triangleCount > 0
    && uint(row.referencedVertexCount, P.limits.sourceCount) && row.referencedVertexCount >= 3 && hash(row.sourceVertexIdsSha256) && hash(row.sourceIndicesSha256)
    && hash(row.sourceGeometrySha256) && hash(row.transformSha256) && mask(row.membershipMask), 'BARRIER_PLAN_RANGE'), sha256, signal);
  let outputRows = [], outputBytes = 0, outputIndex = 0, outputOrdinal = 0, outputPrevious = null;
  const header = () => ({ schemaVersion: VERSION + 'page.v2', kind: 'plan', scopeSha256, profileSha256,
    index: outputIndex, firstOrdinal: outputOrdinal, previousPageSha256: outputPrevious });
  const emptyBytes = () => byteLength(barrierPlanCanonical({ ...header(), records: [], pageSha256: '0'.repeat(64) }));
  const flush = async () => { check(signal); need(outputRows.length > 0 && outputIndex < P.limits.pages, 'BARRIER_PLAN_LIMIT');
    const body = { ...header(), records: outputRows }, pageSha256 = await barrierPlanHash('page', body, sha256, signal), page = { ...body, pageSha256 };
    barrierPlanCanonical(page); outputOrdinal = add(outputOrdinal, outputRows.length); outputIndex++; outputPrevious = pageSha256; outputRows = []; outputBytes = 0; return page; };
  let lastFragment = -1, fragments = 0, sourceVertices = 0, sourceTriangles = 0, ranges = 0, referencedVertices = 0, triangles = 0, fragmentMembership = 0n;
  let partIndex = 0, partRefs = 0, partVertices = 0, partTriangles = 0, partBytes = P.byteEnvelope.partHeader, lastPartFragment = null, plannedBytes = P.byteEnvelope.partHeader;
  try {
    for (let entry; (entry = await nodeCursor.next());) {
      const { row, ordinal } = entry; need(row.dbId > lastNode, 'BARRIER_PLAN_NODE'); lastNode = row.dbId; nodeIds[ordinal] = row.dbId;
      for (let word = 0; word < 4; word++) memberships[ordinal * 4 + word] = Number.parseInt(row.membershipMask.slice(word * 8, word * 8 + 8), 16);
      const parentBit = parentMasks.get(row.dbId); if (parentBit !== undefined) { need((BigInt('0x' + row.membershipMask) & parentBit) !== 0n, 'BARRIER_PLAN_MEMBERSHIP'); parentMasks.delete(row.dbId); }
      if (++nodeCount % 1024 === 0) { await pause(); check(signal); }
    }
    need(nodeCount === nodeSeal.totals.nodes && parentMasks.size === 0, 'BARRIER_PLAN_COVERAGE');
    let nextRange = await rangeCursor.next();
    for (let entry; (entry = await fragmentCursor.next());) {
      const { row: fragment, ordinal } = entry;
      need(fragment.fragmentId > lastFragment, 'BARRIER_PLAN_DUPLICATE_FRAGMENT'); lastFragment = fragment.fragmentId;
      need(fragment.ownerNodeOrdinal < nodeCount && nodeIds[fragment.ownerNodeOrdinal] === fragment.ownerDbId, 'BARRIER_PLAN_OWNER');
      const ownerMask = Array.from(memberships.subarray(fragment.ownerNodeOrdinal * 4, fragment.ownerNodeOrdinal * 4 + 4), word => word.toString(16).padStart(8, '0')).join('');
      need(ownerMask === fragment.membershipMask, 'BARRIER_PLAN_MEMBERSHIP');
      need(fragment.primitive === 'triangles', 'BARRIER_PLAN_PRIMITIVE_UNRESOLVED');
      fragmentMembership |= BigInt('0x' + fragment.membershipMask);
      fragments = add(fragments, 1); sourceVertices = add(sourceVertices, fragment.sourceVertexCount); sourceTriangles = add(sourceTriangles, fragment.sourceTriangleCount);
      let covered = 0;
      while (nextRange && nextRange.row.fragmentOrdinal === ordinal) {
        const { row: range, ordinal: rangeOrdinal } = nextRange;
        need(range.triangleStart === covered && add(covered, range.triangleCount) <= fragment.sourceTriangleCount
          && range.referencedVertexCount <= Math.min(fragment.sourceVertexCount, multiply(3, range.triangleCount)), 'BARRIER_PLAN_COVERAGE');
        need(range.sourceGeometrySha256 === fragment.sourceGeometrySha256 && range.transformSha256 === fragment.transformSha256 && range.membershipMask === fragment.membershipMask, 'BARRIER_PLAN_RANGE');
        const cost = barrierRangePlannedBytes(range.referencedVertexCount, range.triangleCount);
        need(range.referencedVertexCount <= P.part.vertices && range.triangleCount <= P.part.triangles && add(P.byteEnvelope.partHeader, cost) <= P.part.bytes, 'BARRIER_PLAN_REFINEMENT_REQUIRED');
        const newReference = lastPartFragment === ordinal ? 0 : 1;
        if (add(partRefs, newReference) > P.part.fragmentRefs || add(partVertices, range.referencedVertexCount) > P.part.vertices
          || add(partTriangles, range.triangleCount) > P.part.triangles || add(partBytes, cost) > P.part.bytes) {
          need(partRefs > 0 && partIndex + 1 < P.limits.parts, 'BARRIER_PLAN_LIMIT'); partIndex++; partRefs = partVertices = partTriangles = 0;
          partBytes = P.byteEnvelope.partHeader; lastPartFragment = null; plannedBytes = add(plannedBytes, P.byteEnvelope.partHeader);
        }
        partRefs = add(partRefs, lastPartFragment === ordinal ? 0 : 1); lastPartFragment = ordinal;
        partVertices = add(partVertices, range.referencedVertexCount); partTriangles = add(partTriangles, range.triangleCount); partBytes = add(partBytes, cost);
        const row = { partIndex, rangeOrdinal, fragmentOrdinal: ordinal, triangleStart: range.triangleStart, triangleCount: range.triangleCount,
          referencedVertexCount: range.referencedVertexCount, rangeSha256: await barrierPlanHash('range', range, sha256, signal), plannedEncodedBytesUpperBound: cost };
        const rowBytes = byteLength(barrierPlanCanonical(row));
        if (outputRows.length && (outputRows.length === P.limits.pageRecords || add(outputBytes, rowBytes + 1) > P.limits.pageBytes)) yield { kind: 'plan-page', page: await flush() };
        if (!outputRows.length) outputBytes = emptyBytes();
        outputBytes = add(outputBytes, rowBytes + (outputRows.length ? 1 : 0)); need(outputBytes <= P.limits.pageBytes, 'BARRIER_PLAN_BYTES'); outputRows.push(row);
        covered = add(covered, range.triangleCount); ranges = add(ranges, 1); referencedVertices = add(referencedVertices, range.referencedVertexCount);
        triangles = add(triangles, range.triangleCount); plannedBytes = add(plannedBytes, cost);
        if (ranges % 1024 === 0) { await pause(); check(signal); }
        nextRange = await rangeCursor.next();
      }
      need(covered === fragment.sourceTriangleCount && (!nextRange || nextRange.row.fragmentOrdinal > ordinal), 'BARRIER_PLAN_COVERAGE');
    }
    need(nextRange === null, 'BARRIER_PLAN_COVERAGE');
    need(fragmentMembership === (1n << BigInt(scope.selectedParents.length)) - 1n, 'BARRIER_PLAN_COVERAGE');
    need(fragments === fragmentSeal.totals.fragments && sourceVertices === fragmentSeal.totals.sourceVertices && sourceTriangles === fragmentSeal.totals.sourceTriangles
      && fragmentSeal.totals.unavailable === 0 && fragmentSeal.totals.nonTriangle === 0 && ranges === rangeSeal.totals.ranges
      && referencedVertices === rangeSeal.totals.referencedVertices && triangles === rangeSeal.totals.triangles, 'BARRIER_PLAN_COVERAGE');
    if (outputRows.length) yield { kind: 'plan-page', page: await flush() };
    check(signal);
    const body = { schemaVersion: VERSION + 'seal.v2', kind: 'plan', scopeSha256, profileSha256, pageCount: outputIndex, recordCount: ranges,
      tailPageSha256: outputPrevious, totals: { parts: partIndex + 1, ranges, referencedVertices, triangles, plannedEncodedBytesUpperBound: plannedBytes,
        nodeSealSha256: nodeSeal.sealSha256, fragmentSealSha256: fragmentSeal.sealSha256, rangeSealSha256: rangeSeal.sealSha256 }, qualification: 'NOT_MEASURED', authority: 'none' };
    yield { kind: 'plan-seal', seal: { ...body, sealSha256: await barrierPlanHash('seal', body, sha256, signal) } };
  } finally { nodeCursor.close(); fragmentCursor.close(); rangeCursor.close(); }
}
