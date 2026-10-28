import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BARRIER_PACKED_GEOMETRY_FORMAT, barrierPackedDescriptorBytes, barrierPackedDescriptorHashInput,
  barrierPackedExpectedPartSchema, barrierPackedExpectedRangeSchema, barrierPackedMeasureDescriptor,
  barrierPackedPartContextSchema, barrierPackedPartDescriptorSchema, barrierPackedPartValidationReportSchema,
  barrierPackedRangeBinaryBytes, barrierPackedRangeDescriptorSchema,
  type BarrierPackedPartContext, type BarrierPackedPartDescriptor, type BarrierPackedRangeDescriptor,
} from './pathfinderBarrierPackedGeometry.js';
import {
  BARRIER_MULTIPART_PROFILE, barrierMultipartCanonicalBytes, barrierMultipartRangeBytes, barrierMultipartRangeHashInput,
  type BarrierMultipartFragment, type BarrierMultipartGeometryRange,
} from './pathfinderBarrierMultipart.js';

const id = (n: number) => `b13d0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const h = (digit = 'a') => digit.repeat(64);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const rowHash = (row: BarrierMultipartGeometryRange) => digest(barrierMultipartCanonicalBytes(barrierMultipartRangeHashInput(row)));
function context(): BarrierPackedPartContext {
  return { schemaVersion: 'wfc.pf.barrier-packed-part.v1', codecVersion: 'wfc.pf.barrier-packed-mesh.v1',
    intentId: id(1), contextSha256: h(), scopeSha256: h('b'), profileSha256: h('c'), frameSha256: h('d'),
    producerProfile: { schemaVersion: 'wfc.pf.barrier-multipart-producer.v2', sdkVersion: '7.130.0',
      triangleOrder: 'sdk7130-rendered-triangle-order-v1', geometryDigest: 'sha256-bounded-chunk-chain-v1',
      visibility: 'selected-scope-includes-hidden-geometry-v1' },
    roots: { nodes: h('1'), fragments: h('2'), 'geometry-ranges': h('3'), plan: h('4') },
    partIndex: 0, sourceGeometryProvenance: 'protected-producer-reported', sdkSourceBytesVerified: false };
}
function range(changes: Partial<BarrierMultipartGeometryRange> = {}): BarrierMultipartGeometryRange {
  return { fragmentOrdinal: 0, triangleStart: 0, triangleCount: 1, referencedVertexCount: 3,
    sourceVertexIdsSha256: h('5'), sourceIndicesSha256: h('6'), sourceGeometrySha256: h('7'), transformSha256: h('8'),
    membershipMask: '0'.repeat(31) + '1', ...changes };
}
function packedRange(row = range(), ordinal = 0): BarrierPackedRangeDescriptor {
  return { ...row, rangeOrdinal: ordinal, rangeSha256: rowHash(row) };
}
function descriptor(rows = [packedRange()]): BarrierPackedPartDescriptor { return { ...context(), ranges: rows }; }
function fragment(changes: Partial<BarrierMultipartFragment> = {}): BarrierMultipartFragment {
  return { fragmentId: 10, ownerNodeOrdinal: 0, ownerDbId: 3, primitive: 'triangles', membershipMask: range().membershipMask,
    sourceGeometrySha256: range().sourceGeometrySha256, transformSha256: range().transformSha256,
    sourceVertexCount: 3, sourceTriangleCount: 1, ...changes };
}
function expected(row = range(), source = fragment()) {
  return { placement: { partIndex: 0, rangeOrdinal: 0, fragmentOrdinal: row.fragmentOrdinal, triangleStart: row.triangleStart,
    triangleCount: row.triangleCount, referencedVertexCount: row.referencedVertexCount, rangeSha256: rowHash(row),
    plannedEncodedBytesUpperBound: barrierMultipartRangeBytes(row.referencedVertexCount, row.triangleCount) }, range: row, fragment: source };
}

describe('packed local geometry contracts without global or SDK-source authority', () => {
  it('freezes the portable header and preserves all existing planning and staging ceilings', () => {
    expect(Object.isFrozen(BARRIER_PACKED_GEOMETRY_FORMAT)).toBe(true);
    expect(Object.isFrozen(BARRIER_PACKED_GEOMETRY_FORMAT.limits)).toBe(true);
    expect(BARRIER_PACKED_GEOMETRY_FORMAT).toMatchObject({ magic: 'WFCPFBP1', version: 1, headerBytes: 32,
      byteOrder: 'little-endian', sdkSourceBytesVerified: false });
    const { limits } = BARRIER_PACKED_GEOMETRY_FORMAT;
    expect([limits.bytes, limits.fragmentRefs, limits.vertices, limits.triangles]).toEqual([
      BARRIER_MULTIPART_PROFILE.part.bytes, BARRIER_MULTIPART_PROFILE.part.fragmentRefs,
      BARRIER_MULTIPART_PROFILE.part.vertices, BARRIER_MULTIPART_PROFILE.part.triangles]);
    expect(BARRIER_MULTIPART_PROFILE.byteEnvelope.encoding).toBe('nameless-json-upper-bound.v2');
  });

  it('measures exact binary and canonical ASCII descriptor bytes separately from the conservative bound', () => {
    const value = descriptor(), layout = barrierPackedMeasureDescriptor(value), bytes = barrierPackedDescriptorBytes(value);
    expect(barrierPackedPartDescriptorSchema.parse(value)).toEqual(value);
    expect(layout).toEqual({ headerBytes: 32, descriptorBytes: bytes.byteLength, binaryBytes: 480,
      totalBytes: 32 + bytes.byteLength + 480, rangeCount: 1, fragmentRefs: 1, vertices: 3, triangles: 1,
      plannedEncodedBytesUpperBound: 8192 + 4096 + 128 * 3 + 48 });
    expect(bytes).toEqual(barrierMultipartCanonicalBytes(value));
    expect(bytes.every(byte => byte <= 0x7f)).toBe(true);
    expect(new TextDecoder().decode(bytes).startsWith('{"codecVersion":')).toBe(true);
    expect(layout.totalBytes).toBeLessThan(layout.plannedEncodedBytesUpperBound);
  });

  it('retains the B13a range hash and uses a distinct portable descriptor hash domain', () => {
    const value = descriptor(), before = structuredClone(value);
    const { rangeOrdinal: _ordinal, rangeSha256, ...original } = value.ranges[0];
    expect(rangeSha256).toBe(rowHash(original));
    const input = barrierPackedDescriptorHashInput(value);
    expect(input).toEqual({ domain: 'wfc.pf.barrier-packed-mesh.v1/descriptor', value });
    expect(digest(barrierMultipartCanonicalBytes(input))).not.toBe(digest(barrierPackedDescriptorBytes(value)));
    expect(digest(barrierMultipartCanonicalBytes(barrierPackedDescriptorHashInput({ ...value, contextSha256: h('f') }))))
      .not.toBe(digest(barrierMultipartCanonicalBytes(input)));
    expect(value).toEqual(before);
  });

  it('binds exact context and all four non-null roots, with no caller URL, path, readiness or permission', () => {
    expect(barrierPackedPartContextSchema.parse(context())).toEqual(context());
    for (const field of ['url', 'path', 'ready', 'canApply', 'drillThroughWalls'])
      expect(barrierPackedPartDescriptorSchema.safeParse({ ...descriptor(), [field]: true }).success).toBe(false);
    for (const root of ['nodes', 'fragments', 'geometry-ranges', 'plan'])
      expect(barrierPackedPartContextSchema.safeParse({ ...context(), roots: { ...context().roots, [root]: null } }).success).toBe(false);
    expect(barrierPackedPartContextSchema.safeParse({ ...context(), producerProfile: { ...context().producerProfile, visibility: 'visible-only' } }).success).toBe(false);
    expect(barrierPackedPartContextSchema.safeParse({ ...context(), sdkSourceBytesVerified: true }).success).toBe(false);
    expect(barrierPackedPartContextSchema.safeParse({ ...context(), sourceGeometryProvenance: 'independently-verified' }).success).toBe(false);
  });

  it('refuses floating metadata, signed zero, changed versions and an out-of-bounds original range', () => {
    for (const value of [-0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 1048576])
      expect(barrierPackedPartContextSchema.safeParse({ ...context(), partIndex: value }).success).toBe(false);
    expect(barrierPackedPartDescriptorSchema.safeParse({ ...descriptor(), codecVersion: 'unknown' }).success).toBe(false);
    expect(barrierPackedRangeDescriptorSchema.safeParse(packedRange(range({ referencedVertexCount: 2 }))).success).toBe(false);
    expect(barrierPackedRangeDescriptorSchema.safeParse(packedRange(range({ triangleStart: 4294967295 }))).success).toBe(false);
    expect(barrierPackedRangeDescriptorSchema.safeParse({ ...packedRange(), name: 'not-metadata' }).success).toBe(false);
  });

  it('permits a continuation from a preceding part but refuses gaps, repeats, reversal and skipped fragments', () => {
    const first = packedRange(range({ fragmentOrdinal: 7, triangleStart: 100 }), 140);
    const second = packedRange(range({ fragmentOrdinal: 7, triangleStart: 101 }), 141);
    const third = packedRange(range({ fragmentOrdinal: 8 }), 142);
    expect(barrierPackedMeasureDescriptor(descriptor([first, second, third]))).toMatchObject({ rangeCount: 3, fragmentRefs: 2, vertices: 9, triangles: 3 });
    for (const changed of [{ ...second, rangeOrdinal: 140 }, { ...second, rangeOrdinal: 142 }, { ...second, triangleStart: 102 },
      { ...second, fragmentOrdinal: 6 }, { ...third, fragmentOrdinal: 9 }, { ...third, triangleStart: 1 }]) {
      const rows = 'fragmentOrdinal' in changed && changed.rangeOrdinal === 142 ? [first, second, changed] : [first, changed];
      expect(barrierPackedPartDescriptorSchema.safeParse(descriptor(rows)).success).toBe(false);
    }
  });

  it('independently retains the exact total triangle ceiling without using it as an encoded byte estimate', () => {
    const first = packedRange(range({ triangleCount: 125000 }), 0);
    const second = packedRange(range({ triangleStart: 125000, triangleCount: 125000 }), 1);
    const exact = barrierPackedMeasureDescriptor(descriptor([first, second]));
    expect(exact.triangles).toBe(250000);
    expect(exact.totalBytes).toBeLessThan(33554432);
    expect(barrierPackedPartDescriptorSchema.safeParse(descriptor([first, { ...second, triangleCount: 125001 }])).success).toBe(false);
  });

  it('refuses descriptor-count and conservative byte overflow before accepting a large packed part', () => {
    const rows = Array.from({ length: 7500 }, (_, ordinal) => packedRange(range({ triangleStart: ordinal }), ordinal));
    expect(barrierPackedPartDescriptorSchema.safeParse(descriptor(rows)).success).toBe(false);
    expect(barrierPackedPartDescriptorSchema.safeParse(descriptor(Array.from({ length: 8193 }, () => packedRange()))).success).toBe(false);
    expect(() => barrierPackedRangeBinaryBytes(Number.MAX_SAFE_INTEGER, 1)).toThrow('BARRIER_PACKED_RANGE_COUNTS');
    expect(() => barrierPackedRangeBinaryBytes(3, -0)).toThrow('BARRIER_PACKED_RANGE_COUNTS');
  });

  it('retains independently supplied source bounds and physical occurrence metadata in expected tuples', () => {
    const value = expected(); expect(barrierPackedExpectedRangeSchema.parse(value)).toEqual(value);
    for (const changed of [
      { ...value, fragment: fragment({ primitive: 'unknown' }) },
      { ...value, fragment: fragment({ sourceVertexCount: 2 }) },
      { ...value, fragment: fragment({ sourceTriangleCount: 0 }) },
      { ...value, fragment: fragment({ transformSha256: h('f') }) },
      { ...value, fragment: fragment({ membershipMask: '0'.repeat(31) + '2' }) },
      { ...value, placement: { ...value.placement, triangleStart: 1 } },
    ]) expect(barrierPackedExpectedRangeSchema.safeParse(changed).success).toBe(false);
    // Fragment IDs and owners come from the trusted page; sharing source bytes
    // does not collapse distinct physical occurrences into one object.
    expect(barrierPackedExpectedRangeSchema.parse(expected(range(), fragment({ fragmentId: 20, ownerDbId: 10, ownerNodeOrdinal: 1 }))).fragment.fragmentId).toBe(20);
  });

  it('keeps the expected prefix small and rejects invented catalogs or impossible nonempty plan bounds', () => {
    const value = { context: context(), rangeCount: 1, plannedEncodedBytesUpperBound: 12720 };
    expect(barrierPackedExpectedPartSchema.parse(value)).toEqual(value);
    expect(barrierPackedExpectedPartSchema.safeParse({ ...value, ranges: [expected()] }).success).toBe(false);
    expect(barrierPackedExpectedPartSchema.safeParse({ ...value, plannedEncodedBytesUpperBound: 12719 }).success).toBe(false);
    expect(barrierPackedExpectedPartSchema.safeParse({ ...value, rangeCount: 0 }).success).toBe(false);
  });

  it('permits only a bounded separate structural report with explicit unverified SDK-source provenance', () => {
    const layout = barrierPackedMeasureDescriptor(descriptor());
    const value = { schemaVersion: 'wfc.pf.barrier-packed-validation.v1', context: context(), descriptorSha256: h(), payloadSha256: h('f'),
      counts: { ranges: 1, fragmentRefs: 1, vertices: 3, triangles: 1, bytes: layout.totalBytes }, geometryValidation: 'STRUCTURAL_ONLY',
      qualification: 'NOT_MEASURED', authority: 'none', sourceGeometryProvenance: 'protected-producer-reported', sdkSourceBytesVerified: false };
    expect(barrierPackedPartValidationReportSchema.parse(value)).toEqual(value);
    for (const changed of [{ ...value, authority: 'routing' }, { ...value, sdkSourceBytesVerified: true },
      { ...value, geometryValidation: 'CLOSED_SOLID' }, { ...value, ready: true }, { ...value, collisionClear: true },
      { ...value, counts: { ...value.counts, ranges: 2 } }, { ...value, counts: { ...value.counts, bytes: 512 } }])
      expect(barrierPackedPartValidationReportSchema.safeParse(changed).success).toBe(false);
  });
});
