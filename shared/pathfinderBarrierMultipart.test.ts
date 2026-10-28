import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BARRIER_MULTIPART_PROFILE, barrierMultipartCanonicalBytes, barrierMultipartCanonicalJson, barrierMultipartCheckedAdd,
  barrierMultipartCheckedMultiply, barrierMultipartDigest, barrierMultipartFragmentPageSchema, barrierMultipartFragmentSchema,
  barrierMultipartFragmentSealSchema, barrierMultipartGeometryRangePageSchema, barrierMultipartGeometryRangeSchema,
  barrierMultipartHashInput, barrierMultipartMaskFits, barrierMultipartNodePageSchema, barrierMultipartNodeSealSchema,
  barrierMultipartPageHashInput, barrierMultipartPlanPageSchema, barrierMultipartPlanRecordSchema, barrierMultipartPlanSealSchema,
  barrierMultipartProfileSchema, barrierMultipartRangeBytes, barrierMultipartRangeHashInput, barrierMultipartRangeSealSchema,
  barrierMultipartScopeSchema, barrierMultipartSealHashInput,
  type BarrierMultipartFragment, type BarrierMultipartGeometryRange, type BarrierMultipartNodePage,
  type BarrierMultipartPlanRecord, type BarrierMultipartScope,
} from './pathfinderBarrierMultipart.js';
import { BARRIER_LIMITS, barrierCaptureSchema, barrierSnapshotSchema } from './pathfinderBarriers.js';

const id = (number: number) => `b1300000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const hashJson = (value: unknown) => digest(barrierMultipartCanonicalBytes(value));
const h = (digit = 'a') => digit.repeat(64);
const membership = (bits = 1n) => bits.toString(16).padStart(32, '0');
function scope(): BarrierMultipartScope {
  return { schemaVersion: 'wfc.pf.barrier-multipart-scope.v2', modelScope: { projectId: id(1), modelVersionId: id(2),
    contentFingerprint: h(), selectionRevision: '3', captureFrameId: id(4), captureFrameSha256: h('b'),
    coordinateFrame: 'canonical-world-metres' }, modelLoadId: id(5),
  selectedParents: [{ selectionId: id(6), dbId: 3, kind: 'wall' }, { selectionId: id(7), dbId: 321837, kind: 'obstacle' }],
  geometryPolicy: 'original-triangles-structural-only.v2' };
}
function nodePage(): BarrierMultipartNodePage {
  const value: BarrierMultipartNodePage = { schemaVersion: 'wfc.pf.barrier-multipart-page.v2', kind: 'nodes',
    scopeSha256: hashJson(barrierMultipartHashInput('scope', scope())), profileSha256: hashJson(barrierMultipartHashInput('profile', BARRIER_MULTIPART_PROFILE)),
    index: 0, firstOrdinal: 0, previousPageSha256: null, records: [{ dbId: 3, membershipMask: membership() }], pageSha256: h() };
  value.pageSha256 = hashJson(barrierMultipartPageHashInput(value)); return value;
}
function fragment(): BarrierMultipartFragment {
  return { fragmentId: 10, ownerNodeOrdinal: 0, ownerDbId: 3, membershipMask: membership(), primitive: 'triangles',
    sourceGeometrySha256: h('c'), transformSha256: h('d'), sourceVertexCount: 4, sourceTriangleCount: 2 };
}
function range(): BarrierMultipartGeometryRange {
  return { fragmentOrdinal: 0, triangleStart: 0, triangleCount: 2, referencedVertexCount: 4,
    sourceVertexIdsSha256: h('e'), sourceIndicesSha256: h('f'), sourceGeometrySha256: h('c'), transformSha256: h('d'), membershipMask: membership() };
}
function placement(): BarrierMultipartPlanRecord {
  return { partIndex: 0, rangeOrdinal: 0, fragmentOrdinal: 0, triangleStart: 0, triangleCount: 2, referencedVertexCount: 4,
    rangeSha256: hashJson(barrierMultipartRangeHashInput(range())), plannedEncodedBytesUpperBound: barrierMultipartRangeBytes(4, 2) };
}
function nodeSeal() {
  return { schemaVersion: 'wfc.pf.barrier-multipart-seal.v2' as const, kind: 'nodes' as const,
    scopeSha256: nodePage().scopeSha256, profileSha256: nodePage().profileSha256, pageCount: 1, recordCount: 1,
    tailPageSha256: nodePage().pageSha256, totals: { nodes: 1 }, sealSha256: h() };
}
function altered<T>(value: T, path: string[], replacement: unknown): T {
  const copy = structuredClone(value); let at = copy as Record<string, unknown>;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string, unknown>;
  at[path.at(-1)!] = replacement; return copy;
}
function leaves(value: object, prefix: string[] = []): Array<{ path: string[]; value: string | number }> {
  return Object.entries(value).flatMap(([key, item]) => typeof item === 'object' && item !== null
    ? leaves(item, [...prefix, key]) : [{ path: [...prefix, key], value: item as string | number }]);
}

describe('isolated unmeasured multipart contracts', () => {
  it('freezes the exact planning limits without modifying deployed v1 ceilings', () => {
    expect(barrierMultipartProfileSchema.parse(BARRIER_MULTIPART_PROFILE)).toEqual(BARRIER_MULTIPART_PROFILE);
    expect(Object.isFrozen(BARRIER_MULTIPART_PROFILE)).toBe(true);
    for (const item of Object.values(BARRIER_MULTIPART_PROFILE)) if (typeof item === 'object') expect(Object.isFrozen(item)).toBe(true);
    expect(BARRIER_MULTIPART_PROFILE.limits.nodes * 20).toBe(BARRIER_MULTIPART_PROFILE.limits.nodeLookupBytes);
    expect(BARRIER_MULTIPART_PROFILE.part).toEqual({ fragmentRefs: BARRIER_LIMITS.fragments, vertices: BARRIER_LIMITS.vertices,
      triangles: BARRIER_LIMITS.triangles, bytes: BARRIER_LIMITS.captureBytes });
    expect(BARRIER_LIMITS.fragments).toBe(8192);
  });
  it.each(leaves(BARRIER_MULTIPART_PROFILE))('rejects a changed literal profile field $path', ({ path, value }) => {
    expect(barrierMultipartProfileSchema.safeParse(altered(BARRIER_MULTIPART_PROFILE, path,
      typeof value === 'number' ? value + 1 : `${value}.changed`)).success).toBe(false);
  });
  it('binds exact load, model, frame, selection and policy without names or authority', () => {
    expect(barrierMultipartScopeSchema.parse(scope())).toEqual(scope());
    for (const key of ['modelLoadId', 'geometryPolicy']) expect(barrierMultipartScopeSchema.safeParse(altered(scope(), [key], null)).success).toBe(false);
    for (const key of ['ready', 'verified', 'drillThroughWalls', 'snapshotId', 'canApply', 'path', 'url'])
      expect(barrierMultipartScopeSchema.safeParse({ ...scope(), [key]: true }).success).toBe(false);
    expect(barrierMultipartScopeSchema.safeParse(altered(scope(), ['selectedParents', '0', 'name'], 'RVM')).success).toBe(false);
  });
  it('rejects reordered/duplicate parents and duplicate selection IDs', () => {
    const value = scope(); value.selectedParents.reverse(); expect(barrierMultipartScopeSchema.safeParse(value).success).toBe(false);
    expect(barrierMultipartScopeSchema.safeParse(altered(scope(), ['selectedParents', '1', 'dbId'], 3)).success).toBe(false);
    expect(barrierMultipartScopeSchema.safeParse(altered(scope(), ['selectedParents', '1', 'selectionId'], id(6))).success).toBe(false);
    expect(barrierMultipartScopeSchema.safeParse({ ...scope(), selectedParents: [] }).success).toBe(false);
  });
  it('retains explicit unsupported/unavailable observations without granting a plan', () => {
    for (const primitive of ['unknown', 'unavailable', 'lines', 'points'] as const) {
      const row = { ...fragment(), primitive, sourceGeometrySha256: null, transformSha256: null, sourceTriangleCount: 0 };
      expect(barrierMultipartFragmentSchema.parse(row).primitive).toBe(primitive);
    }
    expect(barrierMultipartFragmentSchema.safeParse({ ...fragment(), primitive: 'lines' }).success).toBe(false);
    expect(barrierMultipartFragmentSchema.safeParse({ ...fragment(), sourceGeometrySha256: null }).success).toBe(false);
    expect(barrierMultipartFragmentSchema.safeParse({ ...fragment(), sourceVertexCount: 2 }).success).toBe(false);
  });
  it('does not allow v2 planning data to masquerade as a capture or published v1 snapshot', () => {
    expect(barrierCaptureSchema.safeParse(scope()).success).toBe(false);
    expect(barrierSnapshotSchema.safeParse(nodePage()).success).toBe(false);
    expect(barrierMultipartNodePageSchema.safeParse({ ...nodePage(), ready: true }).success).toBe(false);
  });
});

describe('bounded pages, original ranges and structural seals', () => {
  it('retains one physical occurrence and exact original range identities', () => {
    expect(barrierMultipartNodePageSchema.parse(nodePage()).records).toEqual([{ dbId: 3, membershipMask: membership() }]);
    expect(barrierMultipartFragmentPageSchema.parse({ ...nodePage(), kind: 'fragments', records: [fragment()] }).records[0]).toEqual(fragment());
    expect(barrierMultipartGeometryRangePageSchema.parse({ ...nodePage(), kind: 'geometry-ranges', records: [range()] }).records[0]).toEqual(range());
    expect(barrierMultipartPlanPageSchema.parse({ ...nodePage(), kind: 'plan', records: [placement()] }).records[0]).toEqual(placement());
  });
  it('bounds record counts, byte size and first-page/predecessor combinations', () => {
    const value = nodePage(); value.records = Array.from({ length: 512 }, (_, dbId) => ({ dbId, membershipMask: membership() }));
    expect(barrierMultipartNodePageSchema.safeParse(value).success).toBe(true);
    value.records.push({ dbId: 513, membershipMask: membership() }); expect(barrierMultipartNodePageSchema.safeParse(value).success).toBe(false);
    const large = { ...nodePage(), kind: 'geometry-ranges', records: Array.from({ length: 512 }, () => ({ ...range(),
      fragmentOrdinal: 1048575, triangleCount: 4294967295, referencedVertexCount: 4294967295 })) };
    expect(barrierMultipartCanonicalBytes(large).byteLength).toBeGreaterThan(262144);
    expect(barrierMultipartGeometryRangePageSchema.safeParse(large).success).toBe(false);
    for (const changed of [{ previousPageSha256: h() }, { firstOrdinal: 1 }, { index: 1 }, { index: 1, firstOrdinal: 1 }])
      expect(barrierMultipartNodePageSchema.safeParse({ ...nodePage(), ...changed }).success).toBe(false);
    expect(barrierMultipartNodePageSchema.safeParse({ ...nodePage(), index: 1, firstOrdinal: 1, previousPageSha256: h() }).success).toBe(true);
  });
  it('accepts a uint32-scale original fragment split into bounded source ranges', () => {
    const row = { ...range(), triangleStart: 4294967295 - 2 };
    expect(barrierMultipartGeometryRangeSchema.parse(row).triangleStart).toBe(4294967293);
    expect(barrierMultipartGeometryRangeSchema.safeParse({ ...row, triangleCount: 3 }).success).toBe(false);
    expect(barrierMultipartGeometryRangeSchema.safeParse({ ...range(), referencedVertexCount: 7 }).success).toBe(false);
    for (const referencedVertexCount of [1, 2])
      expect(barrierMultipartGeometryRangeSchema.safeParse({ ...range(), referencedVertexCount }).success).toBe(false);
    expect(barrierMultipartGeometryRangeSchema.safeParse({ ...range(), triangleCount: 0 }).success).toBe(false);
    expect(barrierMultipartGeometryRangeSchema.safeParse({ ...range(), parentSelectionIds: [id(6)] }).success).toBe(false);
    expect(barrierMultipartGeometryRangeSchema.safeParse({ ...range(), name: 'large parent' }).success).toBe(false);
  });
  it('enforces conservative placement bytes and reserves the part header', () => {
    expect(barrierMultipartRangeBytes(4, 2)).toBe(4096 + 128 * 4 + 48 * 2);
    expect(barrierMultipartPlanRecordSchema.parse(placement())).toEqual(placement());
    expect(barrierMultipartPlanRecordSchema.safeParse({ ...placement(), plannedEncodedBytesUpperBound: 1 }).success).toBe(false);
    for (const referencedVertexCount of [1, 2]) expect(barrierMultipartPlanRecordSchema.safeParse({ ...placement(), referencedVertexCount,
      plannedEncodedBytesUpperBound: barrierMultipartRangeBytes(referencedVertexCount, 2) }).success).toBe(false);
    const exact = { ...placement(), referencedVertexCount: 187048, triangleCount: 200000,
      plannedEncodedBytesUpperBound: barrierMultipartRangeBytes(187048, 200000) };
    expect(exact.plannedEncodedBytesUpperBound + 8192).toBe(33554432);
    expect(barrierMultipartPlanRecordSchema.safeParse(exact).success).toBe(true);
    expect(barrierMultipartPlanRecordSchema.safeParse({ ...exact, referencedVertexCount: 187049,
      plannedEncodedBytesUpperBound: barrierMultipartRangeBytes(187049, 200000) }).success).toBe(false);
  });
  it('requires exact seal record totals and bounded nonempty page accounting', () => {
    expect(barrierMultipartNodeSealSchema.parse(nodeSeal()).totals.nodes).toBe(1);
    for (const changed of [{ recordCount: 2 }, { pageCount: 2 }, { recordCount: 513, totals: { nodes: 513 } }])
      expect(barrierMultipartNodeSealSchema.safeParse({ ...nodeSeal(), ...changed }).success).toBe(false);
    const fragmentSeal = { ...nodeSeal(), kind: 'fragments', totals: { fragments: 1, sourceVertices: 4, sourceTriangles: 2, unavailable: 0, nonTriangle: 0 } };
    expect(barrierMultipartFragmentSealSchema.safeParse(fragmentSeal).success).toBe(true);
    expect(barrierMultipartFragmentSealSchema.safeParse({ ...fragmentSeal, totals: { ...fragmentSeal.totals, unavailable: 1, nonTriangle: 1 } }).success).toBe(false);
    expect(barrierMultipartRangeSealSchema.safeParse({ ...nodeSeal(), kind: 'geometry-ranges', totals: { ranges: 1, referencedVertices: 4, triangles: 2 } }).success).toBe(true);
    const planSeal = { ...nodeSeal(), kind: 'plan', qualification: 'NOT_MEASURED', authority: 'none', totals: { parts: 1, ranges: 1,
      referencedVertices: 4, triangles: 2, plannedEncodedBytesUpperBound: 8192 + barrierMultipartRangeBytes(4, 2),
      nodeSealSha256: h('b'), fragmentSealSha256: h('c'), rangeSealSha256: h('d') } };
    expect(barrierMultipartPlanSealSchema.safeParse(planSeal).success).toBe(true);
    for (const changed of [{ authority: 'published' }, { qualification: 'PASS' }, { ready: true }, { collisionClear: true }, { drillThroughWalls: true }])
      expect(barrierMultipartPlanSealSchema.safeParse({ ...planSeal, ...changed }).success).toBe(false);
  });
  it('uses exact 128-bit membership and rejects bits outside the selected parent scope', () => {
    expect(barrierMultipartMaskFits(membership(3n), 2)).toBe(true);
    expect(barrierMultipartMaskFits(membership(4n), 2)).toBe(false);
    expect(barrierMultipartMaskFits(membership(1n << 127n), 128)).toBe(true);
    expect(barrierMultipartMaskFits(membership(1n << 127n), 127)).toBe(false);
    for (const value of ['0'.repeat(32), '1', 'A'.repeat(32), membership() + '\n']) expect(barrierMultipartMaskFits(value, 128)).toBe(false);
    for (const count of [0, -1, 129, 1.5, Infinity]) expect(barrierMultipartMaskFits(membership(), count)).toBe(false);
  });
});

describe('domain-separated bounded metadata hashing', () => {
  it('is deterministic for property insertion order while retaining row/array order', () => {
    expect(barrierMultipartCanonicalJson({ z: 2, a: { d: 4, b: 3 } })).toBe('{"a":{"b":3,"d":4},"z":2}');
    expect(barrierMultipartCanonicalJson({ a: [1, 2] })).not.toBe(barrierMultipartCanonicalJson({ a: [2, 1] }));
    expect(hashJson(barrierMultipartHashInput('scope', scope()))).not.toBe(hashJson(barrierMultipartHashInput('profile', scope())));
  });
  it('binds model/load/frame, membership, original triangle indices and range refinement', () => {
    const original = hashJson(barrierMultipartHashInput('scope', scope()));
    for (const path of [['modelLoadId'], ['modelScope', 'modelVersionId'], ['modelScope', 'captureFrameId'], ['selectedParents', '0', 'selectionId']])
      expect(hashJson(barrierMultipartHashInput('scope', altered(scope(), path, id(99))))).not.toBe(original);
    const originalRange = hashJson(barrierMultipartRangeHashInput(range()));
    for (const change of [{ triangleStart: 1 }, { triangleCount: 1 }, { sourceVertexIdsSha256: h('a') },
      { sourceIndicesSha256: h('a') }, { sourceGeometrySha256: h('a') }, { transformSha256: h('a') }, { membershipMask: membership(3n) }])
      expect(hashJson(barrierMultipartRangeHashInput({ ...range(), ...change }))).not.toBe(originalRange);
  });
  it('excludes only its own digest and binds page predecessor and exact tail/input seal fields', () => {
    const page = nodePage(), original = hashJson(barrierMultipartPageHashInput(page));
    expect(hashJson(barrierMultipartPageHashInput({ ...page, pageSha256: h('b') }))).toBe(original);
    for (const change of [{ profileSha256: h('e') }, { scopeSha256: h('e') }, { previousPageSha256: h('e') }, { index: 1 },
      { records: [{ dbId: 4, membershipMask: membership() }] }]) expect(hashJson(barrierMultipartPageHashInput({ ...page, ...change }))).not.toBe(original);
    const seal = nodeSeal(), sealHash = hashJson(barrierMultipartSealHashInput(seal));
    expect(hashJson(barrierMultipartSealHashInput({ ...seal, sealSha256: h('b') }))).toBe(sealHash);
    expect(hashJson(barrierMultipartSealHashInput({ ...seal, tailPageSha256: h('e') }))).not.toBe(sealHash);
  });
  it('supports an injected async SHA provider without Node dependencies in the shared implementation', async () => {
    const input = barrierMultipartHashInput('scope', scope());
    expect(await barrierMultipartDigest('scope', scope(), async bytes => digest(bytes))).toBe(hashJson(input));
    await expect(barrierMultipartDigest('scope', scope(), async () => 'not-a-digest')).rejects.toThrow();
  });
  it('rejects non-JSON, signed-zero, accessors, cycles and excessive depth before hashing', () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    const arrayGetter = Object.defineProperty([1], '0', { get: () => { throw Error('private getter must not execute'); } });
    let nested: unknown = 1; for (let at = 0; at < 33; at++) nested = [nested];
    for (const value of [undefined, NaN, Infinity, -0, 1n, new Date(), new Map(), [undefined], Array(2), cycle,
      { get privateValue() { throw Error('private getter must not execute'); } }, arrayGetter, { value: '\ud800' }, nested])
      expect(() => barrierMultipartCanonicalJson(value)).toThrow('BARRIER_MULTIPART_INVALID_JSON');
    expect(barrierMultipartNodePageSchema.safeParse({ ...nodePage(), firstOrdinal: -0 }).success).toBe(false);
  });
  it('checks all arithmetic before multiplication, summation or allocation', () => {
    expect(barrierMultipartCheckedAdd(Number.MAX_SAFE_INTEGER - 1, 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(barrierMultipartCheckedMultiply(1048576, 20)).toBe(20971520);
    for (const values of [[Number.MAX_SAFE_INTEGER, 1], [-1, 1], [-0, 1], [0.5, 1]])
      expect(() => barrierMultipartCheckedAdd(...values)).toThrow('BARRIER_MULTIPART_ARITHMETIC_LIMIT');
    for (const values of [[Number.MAX_SAFE_INTEGER, 2], [-1, 0], [-0, 0], [Infinity, 0]])
      expect(() => barrierMultipartCheckedMultiply(values[0], values[1])).toThrow('BARRIER_MULTIPART_ARITHMETIC_LIMIT');
    expect(() => barrierMultipartRangeBytes(Number.MAX_SAFE_INTEGER, 1)).toThrow('BARRIER_MULTIPART_ARITHMETIC_LIMIT');
  });
});
