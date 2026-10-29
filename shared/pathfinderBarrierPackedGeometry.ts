import { z } from 'zod';
import { policyHashSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';
import {
  BARRIER_MULTIPART_PROFILE, barrierMultipartCanonicalBytes, barrierMultipartCheckedAdd,
  barrierMultipartCheckedMultiply, barrierMultipartFragmentSchema, barrierMultipartGeometryRangeSchema,
  barrierMultipartMembershipMaskSchema, barrierMultipartPlanRecordSchema, barrierMultipartRangeBytes,
} from './pathfinderBarrierMultipart.js';

/** Exact local codec only. These ceilings do not establish measured capacity,
 * SDK source-byte verification, topology, collision, publication or write authority. */
export const BARRIER_PACKED_GEOMETRY_FORMAT = Object.freeze({
  schemaVersion: 'wfc.pf.barrier-packed-format.v1', magic: 'WFCPFBP1', version: 1, headerBytes: 32,
  codecVersion: 'wfc.pf.barrier-packed-mesh.v1', byteOrder: 'little-endian',
  descriptorEncoding: 'canonical-ascii-json-v1', coordinateEncoding: 'finite-binary64-preserve-signed-zero',
  triangleOrder: 'sdk7130-rendered-triangle-order-v1', geometryDigest: 'sha256-bounded-chunk-chain-v1',
  sourceGeometryProvenance: 'protected-producer-reported', sdkSourceBytesVerified: false,
  limits: Object.freeze({ ranges: 8192, baseBytes: 8192, rangeDescriptorBytes: 4096,
    bytes: 33554432, fragmentRefs: 8192, vertices: 500000, triangles: 250000, chunkBytes: 262144 }),
} as const);
const F = BARRIER_PACKED_GEOMETRY_FORMAT, P = BARRIER_MULTIPART_PROFILE;
const count = (maximum: number = Number.MAX_SAFE_INTEGER) => z.number().int().min(0).max(maximum)
  .refine(value => !Object.is(value, -0), 'Packed metadata integers cannot be signed zero.');
const positive = (maximum: number = Number.MAX_SAFE_INTEGER) => count(maximum).refine(value => value > 0);
const hash = policyHashSchema;
const producerProfileSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-producer.v2'), sdkVersion: z.literal('7.130.0'),
  triangleOrder: z.literal('sdk7130-rendered-triangle-order-v1'),
  geometryDigest: z.literal('sha256-bounded-chunk-chain-v1'),
  visibility: z.literal('selected-scope-includes-hidden-geometry-v1'),
}).strict();
const rootsSchema = z.object({ nodes: hash, fragments: hash, 'geometry-ranges': hash, plan: hash }).strict();

export const barrierPackedPartContextSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-packed-part.v1'), codecVersion: z.literal(F.codecVersion),
  intentId: policyUuidSchema, contextSha256: hash, scopeSha256: hash, profileSha256: hash, frameSha256: hash,
  producerProfile: producerProfileSchema, roots: rootsSchema, partIndex: count(P.limits.parts - 1),
  sourceGeometryProvenance: z.literal('protected-producer-reported'), sdkSourceBytesVerified: z.literal(false),
}).strict();

/** Original B13a row plus ordinal and its existing B13a range-domain hash.
 * A hash-shaped string is not evidence that its digest has been recomputed. */
export const barrierPackedRangeDescriptorSchema = z.object({
  rangeOrdinal: count(P.limits.ranges - 1), rangeSha256: hash,
  fragmentOrdinal: count(P.limits.fragments - 1), triangleStart: count(P.limits.sourceCount),
  triangleCount: positive(P.part.triangles), referencedVertexCount: positive(P.part.vertices),
  sourceVertexIdsSha256: hash, sourceIndicesSha256: hash, sourceGeometrySha256: hash, transformSha256: hash,
  membershipMask: barrierMultipartMembershipMaskSchema,
}).strict().superRefine((value, context) => {
  const { rangeOrdinal: _ordinal, rangeSha256: _hash, ...row } = value;
  if (!barrierMultipartGeometryRangeSchema.safeParse(row).success)
    context.addIssue({ code: 'custom', message: 'Packed ranges retain the exact B13a geometry-range constraints.' });
});

function asciiBytes(value: unknown): Uint8Array {
  const bytes = barrierMultipartCanonicalBytes(value);
  if (bytes.some(byte => byte > 0x7f)) throw new Error('BARRIER_PACKED_DESCRIPTOR_ASCII');
  return bytes;
}

/** Three16-value binary64 matrices, then V uint32 IDs,3V binary64 coordinates,
 * then3T uint32 local indices. No alignment or optional fields. */
export function barrierPackedRangeBinaryBytes(vertices: number, triangles: number): number {
  if (!Number.isSafeInteger(vertices) || !Number.isSafeInteger(triangles) || Object.is(vertices, -0) || Object.is(triangles, -0)
    || vertices < 3 || vertices > F.limits.vertices || triangles < 1 || triangles > F.limits.triangles || vertices > triangles * 3)
    throw new Error('BARRIER_PACKED_RANGE_COUNTS');
  return barrierMultipartCheckedAdd(384, barrierMultipartCheckedMultiply(28, vertices), barrierMultipartCheckedMultiply(12, triangles));
}

type LayoutInput = z.infer<typeof barrierPackedPartContextSchema> & { ranges: z.infer<typeof barrierPackedRangeDescriptorSchema>[] };
function measure(value: LayoutInput) {
  const { ranges, ...context } = value;
  const baseBytes = barrierMultipartCheckedAdd(F.headerBytes, asciiBytes({ ...context, ranges: [] }).byteLength);
  if (baseBytes > F.limits.baseBytes || ranges.length < 1 || ranges.length > F.limits.ranges)
    throw new Error('BARRIER_PACKED_DESCRIPTOR_LIMIT');
  let vertices = 0, triangles = 0, binaryBytes = 0;
  let plannedEncodedBytesUpperBound: number = P.byteEnvelope.partHeader;
  let fragmentRefs = 0;
  for (let index = 0; index < ranges.length; index++) {
    const row = ranges[index], previous = ranges[index - 1];
    if (asciiBytes(row).byteLength + 1 > F.limits.rangeDescriptorBytes) throw new Error('BARRIER_PACKED_DESCRIPTOR_LIMIT');
    if (previous && (row.rangeOrdinal !== previous.rangeOrdinal + 1 || (row.fragmentOrdinal === previous.fragmentOrdinal
      ? row.triangleStart !== previous.triangleStart + previous.triangleCount
      : row.fragmentOrdinal !== previous.fragmentOrdinal + 1 || row.triangleStart !== 0)))
      throw new Error('BARRIER_PACKED_RANGE_ORDER');
    if (!previous || previous.fragmentOrdinal !== row.fragmentOrdinal) fragmentRefs++;
    vertices = barrierMultipartCheckedAdd(vertices, row.referencedVertexCount);
    triangles = barrierMultipartCheckedAdd(triangles, row.triangleCount);
    binaryBytes = barrierMultipartCheckedAdd(binaryBytes, barrierPackedRangeBinaryBytes(row.referencedVertexCount, row.triangleCount));
    plannedEncodedBytesUpperBound = barrierMultipartCheckedAdd(plannedEncodedBytesUpperBound,
      barrierMultipartRangeBytes(row.referencedVertexCount, row.triangleCount));
  }
  const descriptorBytes = asciiBytes(value).byteLength;
  const totalBytes = barrierMultipartCheckedAdd(F.headerBytes, descriptorBytes, binaryBytes);
  if (vertices > F.limits.vertices || triangles > F.limits.triangles || fragmentRefs > F.limits.fragmentRefs
    || plannedEncodedBytesUpperBound > F.limits.bytes || totalBytes > plannedEncodedBytesUpperBound || totalBytes > F.limits.bytes)
    throw new Error('BARRIER_PACKED_PART_LIMIT');
  return { headerBytes: F.headerBytes, descriptorBytes, binaryBytes, totalBytes, rangeCount: ranges.length,
    fragmentRefs, vertices, triangles, plannedEncodedBytesUpperBound };
}

export const barrierPackedPartDescriptorSchema = barrierPackedPartContextSchema.extend({
  ranges: z.array(barrierPackedRangeDescriptorSchema).min(1).max(F.limits.ranges),
}).strict().superRefine((value, context) => {
  try { measure(value); }
  catch { context.addIssue({ code: 'custom', message: 'Packed part metadata, ordering and exact byte layout must fit the unchanged planning envelope.' }); }
});

/** Supplied from exact sealed trusted pages, not from the parsed part. Each
 * implementation still recomputes digests and matches partIndex/current context. */
export const barrierPackedExpectedRangeSchema = z.object({
  placement: barrierMultipartPlanRecordSchema, range: barrierMultipartGeometryRangeSchema, fragment: barrierMultipartFragmentSchema,
}).strict().superRefine(({ placement, range, fragment }, context) => {
  if (fragment.primitive !== 'triangles' || placement.fragmentOrdinal !== range.fragmentOrdinal
    || placement.triangleStart !== range.triangleStart || placement.triangleCount !== range.triangleCount
    || placement.referencedVertexCount !== range.referencedVertexCount || range.sourceGeometrySha256 !== fragment.sourceGeometrySha256
    || range.transformSha256 !== fragment.transformSha256 || range.membershipMask !== fragment.membershipMask
    || range.referencedVertexCount > fragment.sourceVertexCount || range.triangleStart + range.triangleCount > fragment.sourceTriangleCount)
    context.addIssue({ code: 'custom', message: 'A trusted expected tuple must preserve its exact placement, source counts, identity and membership.' });
});

/** Small prefix only. Exact expected tuples must be consumed in lockstep from
 * separately bounded pages and exhausted, never inferred from payload JSON. */
export const barrierPackedExpectedPartSchema = z.object({
  context: barrierPackedPartContextSchema, rangeCount: positive(F.limits.ranges),
  plannedEncodedBytesUpperBound: positive(F.limits.bytes),
}).strict().superRefine((value, context) => {
  if (value.plannedEncodedBytesUpperBound < P.byteEnvelope.partHeader + value.rangeCount * barrierMultipartRangeBytes(3, 1))
    context.addIssue({ code: 'custom', message: 'A nonempty expected part includes its ranges and header.' });
});

/** Success report shape only, not executable verification or trusted authority.
 * Its two hashes distinguish domain-bound metadata from the whole raw file. */
export const barrierPackedPartValidationReportSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-packed-validation.v1'), context: barrierPackedPartContextSchema,
  descriptorSha256: hash, payloadSha256: hash,
  counts: z.object({ ranges: positive(F.limits.ranges), fragmentRefs: positive(F.limits.fragmentRefs),
    vertices: positive(F.limits.vertices), triangles: positive(F.limits.triangles), bytes: positive(F.limits.bytes) }).strict(),
  geometryValidation: z.literal('STRUCTURAL_ONLY'), qualification: z.literal('NOT_MEASURED'), authority: z.literal('none'),
  sourceGeometryProvenance: z.literal('protected-producer-reported'), sdkSourceBytesVerified: z.literal(false),
}).strict().superRefine((value, context) => {
  const counts = value.counts;
  const binaryBytes = 384 * counts.ranges + 28 * counts.vertices + 12 * counts.triangles;
  const plannedBound = P.byteEnvelope.partHeader + P.byteEnvelope.rangeDescriptor * counts.ranges
    + P.byteEnvelope.referencedVertex * counts.vertices + P.byteEnvelope.triangle * counts.triangles;
  if (counts.fragmentRefs > counts.ranges || counts.vertices < 3 * counts.ranges || counts.triangles < counts.ranges
    || counts.vertices > counts.triangles * 3 || counts.bytes <= F.headerBytes + binaryBytes
    || plannedBound > F.limits.bytes || counts.bytes > plannedBound)
    context.addIssue({ code: 'custom', message: 'A local report retains nonempty bounded counts only.' });
});

export type BarrierPackedPartContext = z.infer<typeof barrierPackedPartContextSchema>;
export type BarrierPackedRangeDescriptor = z.infer<typeof barrierPackedRangeDescriptorSchema>;
export type BarrierPackedPartDescriptor = z.infer<typeof barrierPackedPartDescriptorSchema>;
export type BarrierPackedExpectedRange = z.infer<typeof barrierPackedExpectedRangeSchema>;
export type BarrierPackedExpectedPart = z.infer<typeof barrierPackedExpectedPartSchema>;
export type BarrierPackedPartValidationReport = z.infer<typeof barrierPackedPartValidationReportSchema>;
export type BarrierPackedExpectedFrame = Readonly<{ canonicalBytes: Uint8Array; sha256: string }>;

export function barrierPackedDescriptorBytes(value: BarrierPackedPartDescriptor): Uint8Array {
  return asciiBytes(barrierPackedPartDescriptorSchema.parse(value));
}
export function barrierPackedDescriptorHashInput(value: BarrierPackedPartDescriptor): unknown {
  return { domain: 'wfc.pf.barrier-packed-mesh.v1/descriptor', value: barrierPackedPartDescriptorSchema.parse(value) };
}
export function barrierPackedMeasureDescriptor(value: BarrierPackedPartDescriptor) {
  return measure(barrierPackedPartDescriptorSchema.parse(value));
}
