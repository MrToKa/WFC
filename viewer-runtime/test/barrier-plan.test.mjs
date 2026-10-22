import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BARRIER_MULTIPART_PLANNER_PROFILE as profile, barrierPlanCanonical, barrierPlanHash,
  barrierRangePlannedBytes, planBarrierFragmentSplitHints, planBarrierMultipart } from '../barrier-plan.mjs';

const sha256 = async bytes => createHash('sha256').update(bytes).digest('hex');
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`, H = 'a'.repeat(64), T = 'b'.repeat(64);
const scope = () => ({ schemaVersion: 'wfc.pf.barrier-multipart-scope.v2', modelScope: { projectId: id(1), modelVersionId: id(2), contentFingerprint: H,
  selectionRevision: '1', captureFrameId: id(3), captureFrameSha256: T, coordinateFrame: 'canonical-world-metres' }, modelLoadId: id(4),
selectedParents: [{ selectionId: id(5), dbId: 3, kind: 'obstacle' }, { selectionId: id(6), dbId: 10, kind: 'obstacle' }], geometryPolicy: 'original-triangles-structural-only.v2' });
const mask = n => n.toString(16).padStart(32, '0');
const fragment = (fragmentId, ownerNodeOrdinal = 0, ownerDbId = 3, membershipMask = mask(1)) => ({ fragmentId, ownerNodeOrdinal, ownerDbId, membershipMask,
  primitive: 'triangles', sourceGeometrySha256: H, transformSha256: T, sourceVertexCount: 3, sourceTriangleCount: 1 });
const range = (fragmentOrdinal, overrides = {}) => ({ fragmentOrdinal, triangleStart: 0, triangleCount: 1, referencedVertexCount: 3,
  sourceVertexIdsSha256: 'c'.repeat(64), sourceIndicesSha256: 'd'.repeat(64), sourceGeometrySha256: H, transformSha256: T, membershipMask: mask(fragmentOrdinal ? 2 : 1), ...overrides });
const domainHash = (domain, value) => barrierPlanHash(domain, value, sha256);
const omit = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

async function stream(kind, rows, scopeSha256, profileSha256, totals, pageSize = 512) {
  const pages = []; let previousPageSha256 = null;
  for (let start = 0; start < rows.length; start += pageSize) {
    const body = { schemaVersion: 'wfc.pf.barrier-multipart-page.v2', kind, scopeSha256, profileSha256,
      index: pages.length, firstOrdinal: start, previousPageSha256, records: structuredClone(rows.slice(start, start + pageSize)) };
    const page = { ...body, pageSha256: await domainHash('page', body) }; pages.push(page); previousPageSha256 = page.pageSha256;
  }
  const body = { schemaVersion: 'wfc.pf.barrier-multipart-seal.v2', kind, scopeSha256, profileSha256,
    pageCount: pages.length, recordCount: rows.length, tailPageSha256: previousPageSha256, totals };
  return { pages, seal: { ...body, sealSha256: await domainHash('seal', body) } };
}
async function fixture(changes = {}, pageSize = 512) {
  const selected = changes.scope ?? scope(), scopeSha256 = await domainHash('scope', selected), profileSha256 = await domainHash('profile', profile);
  const nodes = changes.nodes ?? [{ dbId: 3, membershipMask: mask(1) }, { dbId: 10, membershipMask: mask(2) }];
  const fragments = changes.fragments ?? [fragment(0), fragment(1, 1, 10, mask(2))];
  const ranges = changes.ranges ?? [range(0), range(1)];
  const ns = await stream('nodes', nodes, scopeSha256, profileSha256, { nodes: nodes.length }, pageSize);
  const fs = await stream('fragments', fragments, scopeSha256, profileSha256, { fragments: fragments.length,
    sourceVertices: fragments.reduce((n, row) => n + row.sourceVertexCount, 0), sourceTriangles: fragments.reduce((n, row) => n + row.sourceTriangleCount, 0),
    unavailable: fragments.filter(row => ['unknown', 'unavailable'].includes(row.primitive)).length, nonTriangle: fragments.filter(row => ['lines', 'points'].includes(row.primitive)).length }, pageSize);
  const rs = await stream('geometry-ranges', ranges, scopeSha256, profileSha256, { ranges: ranges.length,
    referencedVertices: ranges.reduce((n, row) => n + row.referencedVertexCount, 0), triangles: ranges.reduce((n, row) => n + row.triangleCount, 0) }, pageSize);
  return { scope: selected, profile: structuredClone(profile), nodeSeal: ns.seal, fragmentSeal: fs.seal, rangeSeal: rs.seal,
    nodePages: ns.pages, fragmentPages: fs.pages, geometryRangePages: rs.pages, sha256 };
}
async function collect(options) { const events = []; for await (const event of planBarrierMultipart(options)) events.push(event); return events; }
async function singleFixture(changes) { const selected = scope(); selected.selectedParents.pop(); return fixture({ scope: selected, nodes: [{ dbId: 3, membershipMask: mask(1) }], ...changes }); }
const placements = events => events.filter(event => event.kind === 'plan-page').flatMap(event => event.page.records);
const finalSeal = events => events.at(-1).seal;
async function refuseWithoutSeal(options, expected) {
  const events = []; await assert.rejects(async () => { for await (const event of planBarrierMultipart(options)) events.push(event); }, expected);
  assert.equal(events.some(event => event.kind === 'plan-seal'), false); return events;
}

test('two complete selected parents produce deterministic draft pages and only structural no-authority seals', async () => {
  const f = await fixture(), first = await collect(f), second = await collect(f);
  assert.deepEqual(first, second); assert.equal(placements(first).length, 2); const seal = finalSeal(first);
  assert.equal(seal.authority, 'none'); assert.equal(seal.qualification, 'NOT_MEASURED'); assert.equal(seal.totals.triangles, 2);
  assert.equal(seal.totals.plannedEncodedBytesUpperBound, profile.byteEnvelope.partHeader + 2 * barrierRangePlannedBytes(3, 1));
  assert.equal(await domainHash('seal', omit(seal, 'sealSha256')), seal.sealSha256);
  assert.doesNotMatch(JSON.stringify(first), /"(?:ready|qualified|collisionClear|canApply|drillThroughWalls|snapshotId)"/);
});
test('input page partition changes its sealed input identity but not deterministic packing', async () => {
  const a = await collect(await fixture({}, 1)), b = await collect(await fixture({}, 512));
  assert.deepEqual(placements(a), placements(b)); assert.notEqual(finalSeal(a).sealSha256, finalSeal(b).sealSha256);
});
test('overlapping parents retain exact union membership and shared source geometry retains both occurrences', async () => {
  const nodes = [{ dbId: 3, membershipMask: mask(1) }, { dbId: 10, membershipMask: mask(3) }];
  const f = await fixture({ nodes, fragments: [fragment(0, 1, 10, mask(3)), fragment(1, 1, 10, mask(3))], ranges: [range(0, { membershipMask: mask(3) }), range(1, { membershipMask: mask(3) })] });
  assert.equal(finalSeal(await collect(f)).totals.ranges, 2);
  await refuseWithoutSeal(await fixture({ fragments: [fragment(0), fragment(0, 1, 10, mask(2))] }), { code: 'BARRIER_PLAN_DUPLICATE_FRAGMENT' });
});
test('unknown owners, foreign owner ordinals and unused membership bits refuse', async () => {
  for (const bad of [{ ownerNodeOrdinal: 2 }, { ownerDbId: 10 }, { ownerNodeOrdinal: 1 }, { membershipMask: mask(2) }, { membershipMask: mask(4) }]) {
    const f = await fixture({ fragments: [{ ...fragment(0), ...bad }, fragment(1, 1, 10, mask(2))] });
    await refuseWithoutSeal(f);
  }
});
test('every selected parent needs a physical triangle occurrence even when its node exists', async () => {
  await refuseWithoutSeal(await fixture({ fragments: [fragment(0)], ranges: [range(0)] }), { code: 'BARRIER_PLAN_COVERAGE' });
  for (const referencedVertexCount of [1, 2]) await refuseWithoutSeal(await singleFixture({ fragments: [fragment(0)], ranges: [range(0, { referencedVertexCount })] }), { code: 'BARRIER_PLAN_RANGE' });
});
test('each original triangle range must exactly cover its physical source in order', async () => {
  const source = { ...fragment(0), sourceVertexCount: 6, sourceTriangleCount: 4 };
  for (const ranges of [[range(0, { triangleStart: 1, triangleCount: 3 })], [range(0, { triangleCount: 2 }), range(0, { triangleStart: 1, triangleCount: 2 })],
    [range(0, { triangleCount: 2 })], [range(1, { triangleCount: 4 })], [range(0, { triangleCount: 2 }), range(0, { triangleStart: 2, triangleCount: 3 })]])
    await refuseWithoutSeal(await fixture({ fragments: [source], ranges }), { code: 'BARRIER_PLAN_COVERAGE' });
});
test('one oversized physical fragment is represented by sealed ordered original ranges', async () => {
  const sourceTriangles = 800000, hints = [...planBarrierFragmentSplitHints({ sourceVertices: 1000000, sourceTriangles, profile })];
  assert.ok(hints.length > 1); assert.equal(hints.reduce((n, row) => n + row.triangleCount, 0), sourceTriangles);
  const ranges = hints.map(row => range(0, { triangleStart: row.triangleStart, triangleCount: row.triangleCount, referencedVertexCount: row.referencedVertexCountUpperBound }));
  const output = await collect(await singleFixture({ fragments: [{ ...fragment(0), sourceVertexCount: 1000000, sourceTriangleCount: sourceTriangles }], ranges }));
  assert.equal(finalSeal(output).totals.triangles, sourceTriangles); assert.ok(finalSeal(output).totals.parts > 1);
  assert.ok(hints.every(row => row.admitted === false && row.authority === 'none' && row.qualification === 'NOT_MEASURED'));
  const bad = await fixture({ fragments: [{ ...fragment(0), sourceVertexCount: 1000000, sourceTriangleCount: sourceTriangles }], ranges: [range(0, { triangleCount: sourceTriangles, referencedVertexCount: 1000000 })] });
  await refuseWithoutSeal(bad, { code: 'BARRIER_PLAN_REFINEMENT_REQUIRED' });
});
test('sealed atomic byte bound equality fits and one additional triangle requires a fresh refined inventory', async () => {
  // 8192+4096+128*201286+48*162032 = 33554432 exactly.
  const vertices = 201286, triangles = 162032;
  assert.equal(profile.byteEnvelope.partHeader + barrierRangePlannedBytes(vertices, triangles), profile.part.bytes);
  const source = { ...fragment(0), sourceVertexCount: vertices, sourceTriangleCount: triangles };
  const exact = await collect(await singleFixture({ fragments: [source], ranges: [range(0, { triangleCount: triangles, referencedVertexCount: vertices })] }));
  assert.equal(finalSeal(exact).totals.plannedEncodedBytesUpperBound, profile.part.bytes);
  await refuseWithoutSeal(await fixture({ fragments: [{ ...source, sourceTriangleCount: triangles + 1 }], ranges: [range(0, { triangleCount: triangles + 1, referencedVertexCount: vertices })] }), { code: 'BARRIER_PLAN_REFINEMENT_REQUIRED' });
});
test('classified nontriangle and unavailable occurrences are refused explicitly, never silently skipped', async () => {
  for (const primitive of ['lines', 'points', 'unknown', 'unavailable']) {
    const f = await fixture({ fragments: [{ ...fragment(0), primitive, sourceTriangleCount: 0 }, fragment(1, 1, 10, mask(2))], ranges: [range(1)] });
    await refuseWithoutSeal(f, { code: 'BARRIER_PLAN_PRIMITIVE_UNRESOLVED' });
  }
});
test('tampered, missing, replayed, reordered and foreign pages cannot yield a final seal', async () => {
  for (const mutate of [f => { f.nodePages[0].records[0].dbId++; }, f => { f.nodePages = []; }, f => { f.fragmentPages.push(f.fragmentPages[0]); },
    f => { f.geometryRangePages[0].index++; }, f => { f.geometryRangePages[0].scopeSha256 = 'f'.repeat(64); }, f => { f.nodeSeal.pageCount++; },
    f => { f.rangeSeal.totals.triangles++; }, f => { f.nodePages[0].ready = true; }]) { const f = await fixture(); mutate(f); await refuseWithoutSeal(f); }
});
test('caller page and control mutation during asynchronous hashing cannot change the detached inputs', async () => {
  const f = await fixture(), original = await collect(f); let once = false;
  const output = await collect({ ...f, sha256: async bytes => { if (!once) { once = true; f.scope.modelLoadId = id(99); f.profile.part.bytes++; f.nodeSeal.recordCount++; } return sha256(bytes); } });
  assert.deepEqual(output, original);
  const next = await fixture(); let mutated = false;
  const pageResult = await collect({ ...next, sha256: async bytes => { if (!mutated && new TextDecoder().decode(bytes).includes('"kind":"nodes"') && new TextDecoder().decode(bytes).includes('"records"')) { mutated = true; next.nodePages[0].records[0].dbId = 99; } return sha256(bytes); } });
  assert.equal(finalSeal(pageResult).totals.ranges, 2);
});
test('cancellation interrupts a stalled source or hash and never emits a seal', async () => {
  const f = await fixture(), controller = new AbortController();
  const stalled = { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: () => new Promise(() => {}) }; } };
  const promise = refuseWithoutSeal({ ...f, nodePages: stalled, signal: controller.signal }, { name: 'AbortError' }); setTimeout(() => controller.abort(), 5); await promise;
  const next = new AbortController(); let releaseHash;
  const hashPromise = refuseWithoutSeal({ ...f, sha256: () => new Promise(resolve => { releaseHash = resolve; }), signal: next.signal }, { name: 'AbortError' });
  setTimeout(() => next.abort(), 5); await hashPromise; releaseHash('0'.repeat(64)); await Promise.resolve();
});
test('a late coverage mismatch after draft output and cancellation after final input never seal', async () => {
  const fragments = Array.from({ length: 513 }, (_, index) => fragment(index)), ranges = fragments.map((_row, index) => range(index, { membershipMask: mask(1) }));
  const f = await singleFixture({ fragments, ranges }); f.rangeSeal.totals.triangles++; f.rangeSeal.sealSha256 = await domainHash('seal', omit(f.rangeSeal, 'sealSha256'));
  const drafts = await refuseWithoutSeal(f, { code: 'BARRIER_PLAN_COVERAGE' }); assert.ok(drafts.some(row => row.kind === 'plan-page'));
  const controller = new AbortController(), complete = await fixture(); const events = [];
  await assert.rejects(async () => { for await (const event of planBarrierMultipart({ ...complete, signal: controller.signal })) { events.push(event); if (event.kind === 'plan-page') controller.abort(); } }, { name: 'AbortError' });
  assert.equal(events.some(row => row.kind === 'plan-seal'), false);
});
test('scope, membership and refined source roots change the structural plan identity', async () => {
  const base = finalSeal(await collect(await fixture())).sealSha256;
  const changedScope = scope(); changedScope.modelScope.captureFrameSha256 = 'f'.repeat(64);
  assert.notEqual(finalSeal(await collect(await fixture({ scope: changedScope }))).sealSha256, base);
  const changed = await fixture({ nodes: [{ dbId: 3, membershipMask: mask(3) }, { dbId: 10, membershipMask: mask(2) }],
    fragments: [fragment(0, 0, 3, mask(3)), fragment(1, 1, 10, mask(2))], ranges: [range(0, { membershipMask: mask(3) }), range(1)] });
  assert.notEqual(finalSeal(await collect(changed)).sealSha256, base);
  const refined = await singleFixture({ fragments: [{ ...fragment(0), sourceTriangleCount: 2 }], ranges: [range(0, { triangleCount: 2 })] });
  const split = await singleFixture({ fragments: [{ ...fragment(0), sourceTriangleCount: 2 }], ranges: [range(0), range(0, { triangleStart: 1 })] });
  assert.notEqual(finalSeal(await collect(refined)).sealSha256, finalSeal(await collect(split)).sealSha256);
});
test('safe arithmetic and strict metadata reject overflow, signed zero, sparse arrays and authority injection', async () => {
  assert.throws(() => barrierRangePlannedBytes(Number.MAX_SAFE_INTEGER, 1), { code: 'BARRIER_PLAN_ARITHMETIC' });
  for (const input of [{ value: -0 }, { value: Infinity }, { value: undefined }, new Date(), Array(1), { get value() { throw Error('PRIVATE'); } }]) assert.throws(() => barrierPlanCanonical(input));
  const f = await fixture(); f.profile.part.fragments = 8193; await refuseWithoutSeal(f, { code: 'BARRIER_PLAN_PROFILE' });
  const other = await fixture(); other.scope.ready = true; await refuseWithoutSeal(other, { code: 'BARRIER_PLAN_SCOPE' });
});

// Counts match the retained groups, but all identities/geometry facts here are synthetic.
test('synthetic 620831-occurrence planning streams bounded pages and measures its own control scope', { timeout: 180000 }, async t => {
  const selected = scope(), nodeCount = 382523, fragmentCount = 620831, splitNode = 321834;
  selected.selectedParents[1].dbId = splitNode + 10;
  const scopeSha256 = await domainHash('scope', selected), profileSha256 = await domainHash('profile', profile);
  let livePages = 0, maximumLivePages = 0, maximumRows = 0, observedRss = process.memoryUsage().rss, samples = 0;
  const sample = () => { samples++; observedRss = Math.max(observedRss, process.memoryUsage().rss); };
  function record(kind, index) {
    if (kind === 'nodes') return { dbId: index === 0 ? 3 : index === 1 ? 10 : index + 10, membershipMask: mask(index < splitNode ? 1 : 2) };
    const owner = index % nodeCount, membershipMask = mask(owner < splitNode ? 1 : 2);
    if (kind === 'fragments') return fragment(index, owner, owner === 0 ? 3 : owner === 1 ? 10 : owner + 10, membershipMask);
    return range(index, { membershipMask });
  }
  async function* pages(kind, count) {
    let previousPageSha256 = null, index = 0;
    for (let start = 0; start < count; start += 512) {
      const rows = Array.from({ length: Math.min(512, count - start) }, (_value, at) => record(kind, start + at));
      const body = { schemaVersion: 'wfc.pf.barrier-multipart-page.v2', kind, scopeSha256, profileSha256, index: index++, firstOrdinal: start, previousPageSha256, records: rows };
      const page = { ...body, pageSha256: await domainHash('page', body) }; previousPageSha256 = page.pageSha256;
      livePages++; maximumLivePages = Math.max(maximumLivePages, livePages); maximumRows = Math.max(maximumRows, rows.length); sample();
      try { yield page; } finally { livePages--; }
    }
  }
  async function seal(kind, count, totals) { let pageCount = 0, tailPageSha256; for await (const page of pages(kind, count)) { pageCount++; tailPageSha256 = page.pageSha256; }
    const body = { schemaVersion: 'wfc.pf.barrier-multipart-seal.v2', kind, scopeSha256, profileSha256, pageCount, recordCount: count, tailPageSha256, totals };
    return { ...body, sealSha256: await domainHash('seal', body) }; }
  const nodeSeal = await seal('nodes', nodeCount, { nodes: nodeCount }), fragmentSeal = await seal('fragments', fragmentCount,
    { fragments: fragmentCount, sourceVertices: fragmentCount * 3, sourceTriangles: fragmentCount, unavailable: 0, nonTriangle: 0 });
  const rangeSeal = await seal('geometry-ranges', fragmentCount, { ranges: fragmentCount, referencedVertices: fragmentCount * 3, triangles: fragmentCount });
  let rows = 0, outputPages = 0, result = null, part = -1, partRefs = 0, partVertices = 0, partTriangles = 0, partBytes = 8192;
  const checkPart = () => { assert.ok(partRefs <= 8192); assert.ok(partVertices <= 500000); assert.ok(partTriangles <= 250000); assert.ok(partBytes <= 33554432); };
  const began = performance.now();
  for await (const event of planBarrierMultipart({ scope: selected, profile, nodeSeal, fragmentSeal, rangeSeal,
    nodePages: pages('nodes', nodeCount), fragmentPages: pages('fragments', fragmentCount), geometryRangePages: pages('geometry-ranges', fragmentCount), sha256 })) {
    sample(); if (event.kind === 'plan-page') { outputPages++; assert.ok(event.page.records.length <= 512);
      for (const row of event.page.records) { assert.equal(row.rangeOrdinal, rows); assert.equal(row.fragmentOrdinal, rows); assert.equal(row.triangleStart, 0); assert.equal(row.triangleCount, 1);
        if (row.partIndex !== part) { checkPart(); assert.equal(row.partIndex, part + 1); part = row.partIndex; partRefs = partVertices = partTriangles = 0; partBytes = 8192; }
        partRefs++; partVertices += row.referencedVertexCount; partTriangles += row.triangleCount;
        partBytes += 4096 + 128 * row.referencedVertexCount + 48 * row.triangleCount; rows++;
      }
    } else result = event.seal;
  }
  checkPart();
  assert.equal(rows, fragmentCount); assert.equal(result.totals.triangles, fragmentCount); assert.equal(result.totals.ranges, fragmentCount);
  assert.equal(result.authority, 'none'); assert.equal(maximumRows, 512); assert.ok(maximumLivePages <= 2); assert.equal(livePages, 0);
  t.diagnostic(JSON.stringify({ scope: 'synthetic-structural-count-control-only', nodes: nodeCount, physicalOccurrences: fragmentCount,
    originalTriangles: fragmentCount, nodeLookupBytes: nodeCount * 20, maximumInputPageRows: maximumRows, maximumOriginalInputPages: maximumLivePages,
    outputPages, parts: result.totals.parts, elapsedMilliseconds: Math.round(performance.now() - began), sampledMaximumRssBytes: observedRss,
    rssSampleCount: samples, qualification: 'NOT_MEASURED', actualGeometry: 'NOT_RUN' }));
});
