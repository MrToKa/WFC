import { z } from 'zod';
import { barrierModelScopeSchema } from './pathfinderBarriers.js';
import { policyHashSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';

/** Structural planning only. None of these values qualify SDK capacity, geometry,
 * collision clearance, publication, an empty registry, drilling or a cable write. */
export const BARRIER_MULTIPART_VERSION = 'wfc.pf.barrier-multipart.v2' as const;
export const BARRIER_MULTIPART_GEOMETRY_POLICY = 'original-triangles-structural-only.v2' as const;
export const BARRIER_MULTIPART_PROFILE = Object.freeze({
  schemaVersion: 'wfc.pf.barrier-multipart-profile.v2', qualification: 'NOT_MEASURED',
  geometryPolicy: BARRIER_MULTIPART_GEOMETRY_POLICY,
  limits: Object.freeze({ selectedParents: 128, pageBytes: 262144, pageRecords: 512, nodes: 1048576,
    nodeLookupBytes: 20971520, fragments: 1048576, ranges: 16777216, pages: 65536, parts: 1048576, sourceCount: 4294967295 }),
  part: Object.freeze({ fragmentRefs: 8192, vertices: 500000, triangles: 250000, bytes: 33554432 }),
  byteEnvelope: Object.freeze({ partHeader: 8192, rangeDescriptor: 4096, referencedVertex: 128, triangle: 48,
    membershipBits: 128, maxNumericTokenBytes: 32, maxIndexDigits: 10, descriptorBytes: 4096,
    encoding: 'nameless-json-upper-bound.v2', coordinateEncoding: 'finite-binary64-preserve-signed-zero',
    sourceVertexMap: 'ordered-original-uint32' }),
} as const);

const limits = BARRIER_MULTIPART_PROFILE.limits;
const count = (maximum: number = Number.MAX_SAFE_INTEGER) => z.number().int().min(0).max(maximum)
  .refine(value => !Object.is(value, -0), 'Control integers cannot be signed zero.');
const positive = (maximum: number = Number.MAX_SAFE_INTEGER) => count(maximum).refine(value => value > 0);
const hash = policyHashSchema, uuid = policyUuidSchema, dbId = count(2147483647);
const literalObject = <T extends Record<string, string | number>>(value: T) => z.object(Object.fromEntries(
  Object.entries(value).map(([key, item]) => [key, z.literal(item)])) as { [K in keyof T]: z.ZodLiteral<T[K]> }).strict();
export const barrierMultipartProfileSchema = z.object({
  schemaVersion: z.literal(BARRIER_MULTIPART_PROFILE.schemaVersion), qualification: z.literal('NOT_MEASURED'),
  geometryPolicy: z.literal(BARRIER_MULTIPART_GEOMETRY_POLICY), limits: literalObject(BARRIER_MULTIPART_PROFILE.limits),
  part: literalObject(BARRIER_MULTIPART_PROFILE.part), byteEnvelope: literalObject(BARRIER_MULTIPART_PROFILE.byteEnvelope),
}).strict();

const parentSchema = z.object({ selectionId: uuid, dbId,
  kind: z.enum(['wall', 'partition', 'floor', 'ceiling', 'obstacle']) }).strict();
export const barrierMultipartScopeSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-multipart-scope.v2'), modelScope: barrierModelScopeSchema,
  modelLoadId: uuid, selectedParents: z.array(parentSchema).min(1).max(limits.selectedParents),
  geometryPolicy: z.literal(BARRIER_MULTIPART_GEOMETRY_POLICY),
}).strict().superRefine((value, context) => {
  if (value.selectedParents.some((parent, index) => index > 0 && parent.dbId <= value.selectedParents[index - 1].dbId)
    || new Set(value.selectedParents.map(parent => parent.selectionId)).size !== value.selectedParents.length)
    context.addIssue({ code: 'custom', message: 'Parents must have unique identities and strictly ascending dbIds.' });
});

/** Bit i (least significant bit first) means selectedParents[i]. The fixed width
 * prevents full parent UUID/name arrays entering range descriptors. Scope-aware
 * consumers must also reject bits outside their exact selected parent count. */
export const barrierMultipartMembershipMaskSchema = z.string().length(32)
  .regex(/^[a-f0-9]{32}$(?![\s\S])/u).refine(value => value !== '0'.repeat(32));
const mask = barrierMultipartMembershipMaskSchema;
export const barrierMultipartNodeSchema = z.object({ dbId, membershipMask: mask }).strict();
export const barrierMultipartFragmentSchema = z.object({
  fragmentId: dbId, ownerNodeOrdinal: count(limits.nodes - 1), ownerDbId: dbId, membershipMask: mask,
  primitive: z.enum(['triangles', 'lines', 'points', 'unknown', 'unavailable']),
  sourceGeometrySha256: hash.nullable(), transformSha256: hash.nullable(),
  sourceVertexCount: count(limits.sourceCount), sourceTriangleCount: count(limits.sourceCount),
}).strict().superRefine((value, context) => {
  if (value.primitive === 'triangles' && (value.sourceGeometrySha256 === null || value.transformSha256 === null
    || value.sourceVertexCount < 3 || value.sourceTriangleCount < 1))
    context.addIssue({ code: 'custom', message: 'Triangle inventory needs original geometry and transform identities and nonempty counts.' });
  if ((value.primitive === 'lines' || value.primitive === 'points') && value.sourceTriangleCount !== 0)
    context.addIssue({ code: 'custom', message: 'Nontriangle primitives cannot declare triangle geometry.' });
});
export const barrierMultipartGeometryRangeSchema = z.object({
  fragmentOrdinal: count(limits.fragments - 1), triangleStart: count(limits.sourceCount),
  triangleCount: positive(limits.sourceCount), referencedVertexCount: positive(limits.sourceCount),
  sourceVertexIdsSha256: hash, sourceIndicesSha256: hash, sourceGeometrySha256: hash, transformSha256: hash,
  membershipMask: mask,
}).strict().superRefine((value, context) => {
  if (value.triangleStart + value.triangleCount > limits.sourceCount || value.referencedVertexCount < 3
    || value.referencedVertexCount > value.triangleCount * 3)
    context.addIssue({ code: 'custom', message: 'A source range must fit uint32 counts and its referenced vertex bound.' });
});
export const barrierMultipartPlanRecordSchema = z.object({
  partIndex: count(limits.parts - 1), rangeOrdinal: count(limits.ranges - 1), fragmentOrdinal: count(limits.fragments - 1),
  triangleStart: count(limits.sourceCount), triangleCount: positive(BARRIER_MULTIPART_PROFILE.part.triangles),
  referencedVertexCount: positive(BARRIER_MULTIPART_PROFILE.part.vertices), rangeSha256: hash,
  plannedEncodedBytesUpperBound: positive(BARRIER_MULTIPART_PROFILE.part.bytes),
}).strict().superRefine((value, context) => {
  if (value.triangleStart + value.triangleCount > limits.sourceCount || value.referencedVertexCount < 3 || value.referencedVertexCount > value.triangleCount * 3
    || value.plannedEncodedBytesUpperBound !== barrierMultipartRangeBytes(value.referencedVertexCount, value.triangleCount)
    || value.plannedEncodedBytesUpperBound + BARRIER_MULTIPART_PROFILE.byteEnvelope.partHeader > BARRIER_MULTIPART_PROFILE.part.bytes)
    context.addIssue({ code: 'custom', message: 'A placement must retain its source range and declared conservative byte formula.' });
});

const pageBase = z.object({ schemaVersion: z.literal('wfc.pf.barrier-multipart-page.v2'), scopeSha256: hash,
  profileSha256: hash, index: count(limits.pages - 1), firstOrdinal: count(limits.ranges - 1),
  previousPageSha256: hash.nullable(), pageSha256: hash }).strict();
const pageBound = (value: { index: number; firstOrdinal: number; previousPageSha256: string | null }, context: z.RefinementCtx) => {
  if (value.index === 0 ? value.previousPageSha256 !== null || value.firstOrdinal !== 0
    : value.previousPageSha256 === null || value.firstOrdinal === 0)
    context.addIssue({ code: 'custom', message: 'A stream starts at zero with no predecessor; later pages require a predecessor.' });
  try { if (barrierMultipartCanonicalBytes(value).byteLength > limits.pageBytes)
    context.addIssue({ code: 'custom', message: 'A control page exceeds its encoded byte bound.' }); }
  catch { context.addIssue({ code: 'custom', message: 'A control page must be bounded canonical JSON.' }); }
};
export const barrierMultipartNodePageSchema = pageBase.extend({ kind: z.literal('nodes'),
  records: z.array(barrierMultipartNodeSchema).min(1).max(limits.pageRecords) }).strict().superRefine(pageBound);
export const barrierMultipartFragmentPageSchema = pageBase.extend({ kind: z.literal('fragments'),
  records: z.array(barrierMultipartFragmentSchema).min(1).max(limits.pageRecords) }).strict().superRefine(pageBound);
export const barrierMultipartGeometryRangePageSchema = pageBase.extend({ kind: z.literal('geometry-ranges'),
  records: z.array(barrierMultipartGeometryRangeSchema).min(1).max(limits.pageRecords) }).strict().superRefine(pageBound);
export const barrierMultipartPlanPageSchema = pageBase.extend({ kind: z.literal('plan'),
  records: z.array(barrierMultipartPlanRecordSchema).min(1).max(limits.pageRecords) }).strict().superRefine(pageBound);
export const barrierMultipartPageSchema = z.union([barrierMultipartNodePageSchema, barrierMultipartFragmentPageSchema,
  barrierMultipartGeometryRangePageSchema, barrierMultipartPlanPageSchema]);

const sealBase = z.object({ schemaVersion: z.literal('wfc.pf.barrier-multipart-seal.v2'), scopeSha256: hash,
  profileSha256: hash, pageCount: positive(limits.pages), recordCount: positive(limits.ranges),
  tailPageSha256: hash, sealSha256: hash }).strict();
const sealBound = (value: { pageCount: number; recordCount: number }, context: z.RefinementCtx) => {
  if (value.pageCount > value.recordCount || value.recordCount > value.pageCount * limits.pageRecords)
    context.addIssue({ code: 'custom', message: 'Seal pages must account for all nonempty bounded records.' });
};
export const barrierMultipartNodeSealSchema = sealBase.extend({ kind: z.literal('nodes'),
  totals: z.object({ nodes: positive(limits.nodes) }).strict() }).strict().superRefine((value, context) => {
  sealBound(value, context); if (value.recordCount !== value.totals.nodes)
    context.addIssue({ code: 'custom', message: 'Node seal count differs from its record count.' });
});
export const barrierMultipartFragmentSealSchema = sealBase.extend({ kind: z.literal('fragments'),
  totals: z.object({ fragments: positive(limits.fragments), sourceVertices: count(), sourceTriangles: count(),
    unavailable: count(limits.fragments), nonTriangle: count(limits.fragments) }).strict() }).strict().superRefine((value, context) => {
  sealBound(value, context); if (value.recordCount !== value.totals.fragments
    || value.totals.unavailable + value.totals.nonTriangle > value.totals.fragments)
    context.addIssue({ code: 'custom', message: 'Fragment seal classifications and records must reconcile.' });
});
export const barrierMultipartRangeSealSchema = sealBase.extend({ kind: z.literal('geometry-ranges'),
  totals: z.object({ ranges: positive(limits.ranges), referencedVertices: positive(), triangles: positive() }).strict(),
}).strict().superRefine((value, context) => {
  sealBound(value, context); if (value.recordCount !== value.totals.ranges)
    context.addIssue({ code: 'custom', message: 'Range seal count differs from its record count.' });
});
export const barrierMultipartInventorySealSchema = z.union([barrierMultipartNodeSealSchema, barrierMultipartFragmentSealSchema]);
export const barrierMultipartPlanSealSchema = sealBase.extend({ kind: z.literal('plan'),
  qualification: z.literal('NOT_MEASURED'), authority: z.literal('none'),
  totals: z.object({ parts: positive(limits.parts), ranges: positive(limits.ranges), referencedVertices: positive(),
    triangles: positive(), plannedEncodedBytesUpperBound: positive(), nodeSealSha256: hash,
    fragmentSealSha256: hash, rangeSealSha256: hash }).strict(),
}).strict().superRefine((value, context) => {
  sealBound(value, context); if (value.recordCount !== value.totals.ranges || value.totals.parts > value.totals.ranges)
    context.addIssue({ code: 'custom', message: 'A structural seal needs exactly its nonempty planned ranges and parts.' });
});
export const barrierMultipartSealSchema = z.union([barrierMultipartNodeSealSchema, barrierMultipartFragmentSealSchema,
  barrierMultipartRangeSealSchema, barrierMultipartPlanSealSchema]);

export type BarrierMultipartScope = z.infer<typeof barrierMultipartScopeSchema>;
export type BarrierMultipartProfile = z.infer<typeof barrierMultipartProfileSchema>;
export type BarrierMultipartNode = z.infer<typeof barrierMultipartNodeSchema>;
export type BarrierMultipartFragment = z.infer<typeof barrierMultipartFragmentSchema>;
export type BarrierMultipartGeometryRange = z.infer<typeof barrierMultipartGeometryRangeSchema>;
export type BarrierMultipartPlanRecord = z.infer<typeof barrierMultipartPlanRecordSchema>;
export type BarrierMultipartNodePage = z.infer<typeof barrierMultipartNodePageSchema>;
export type BarrierMultipartFragmentPage = z.infer<typeof barrierMultipartFragmentPageSchema>;
export type BarrierMultipartGeometryRangePage = z.infer<typeof barrierMultipartGeometryRangePageSchema>;
export type BarrierMultipartPlanPage = z.infer<typeof barrierMultipartPlanPageSchema>;
export type BarrierMultipartPage = z.infer<typeof barrierMultipartPageSchema>;
export type BarrierMultipartNodeSeal = z.infer<typeof barrierMultipartNodeSealSchema>;
export type BarrierMultipartFragmentSeal = z.infer<typeof barrierMultipartFragmentSealSchema>;
export type BarrierMultipartInventorySeal = z.infer<typeof barrierMultipartInventorySealSchema>;
export type BarrierMultipartRangeSeal = z.infer<typeof barrierMultipartRangeSealSchema>;
export type BarrierMultipartPlanSeal = z.infer<typeof barrierMultipartPlanSealSchema>;
export type BarrierMultipartSeal = z.infer<typeof barrierMultipartSealSchema>;
export type BarrierMultipartHashDomain = 'scope' | 'profile' | 'page' | 'seal' | 'range';
export type BarrierMultipartSha256 = (bytes: Uint8Array) => Promise<string>;

/** Metadata only, never source coordinate serialization. Geometry must retain
 * original IEEE754 bits (including signed zero) in the later qualified codec. */
export function barrierMultipartCanonicalJson(value: unknown): string {
  const active = new Set<object>();
  const encode = (item: unknown, depth: number): string => {
    if (depth > 32) throw new Error('BARRIER_MULTIPART_INVALID_JSON');
    if (item === null || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'string') {
      if ([...item].some(character => character.length === 1 && character.charCodeAt(0) >= 0xd800 && character.charCodeAt(0) <= 0xdfff))
        throw new Error('BARRIER_MULTIPART_INVALID_JSON');
      return JSON.stringify(item);
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0)) throw new Error('BARRIER_MULTIPART_INVALID_JSON');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object' || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(item))
      || active.has(item) || Object.getOwnPropertySymbols(item).length) throw new Error('BARRIER_MULTIPART_INVALID_JSON');
    active.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.keys(item).length !== item.length) throw new Error('BARRIER_MULTIPART_INVALID_JSON');
        const entries: string[] = [];
        for (let index = 0; index < item.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !('value' in descriptor)) throw new Error('BARRIER_MULTIPART_INVALID_JSON');
          entries.push(encode(descriptor.value, depth + 1));
        }
        return '[' + entries.join(',') + ']';
      }
      return '{' + Object.keys(item).sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !('value' in descriptor)) throw new Error('BARRIER_MULTIPART_INVALID_JSON');
        return encode(key, depth + 1) + ':' + encode(descriptor.value, depth + 1);
      }).join(',') + '}';
    } finally { active.delete(item); }
  };
  return encode(value, 0);
}
export function barrierMultipartCanonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(barrierMultipartCanonicalJson(value));
}
export function barrierMultipartHashInput(domain: BarrierMultipartHashDomain, value: unknown): unknown {
  if (!['scope', 'profile', 'page', 'seal', 'range'].includes(domain)) throw new Error('BARRIER_MULTIPART_HASH_DOMAIN');
  return { domain: `${BARRIER_MULTIPART_VERSION}/${domain}`, value };
}
export function barrierMultipartPageHashInput(page: BarrierMultipartPage): unknown {
  const { pageSha256: _hash, ...value } = page; return barrierMultipartHashInput('page', value);
}
export function barrierMultipartSealHashInput(seal: BarrierMultipartSeal): unknown {
  const { sealSha256: _hash, ...value } = seal; return barrierMultipartHashInput('seal', value);
}
export function barrierMultipartRangeHashInput(range: BarrierMultipartGeometryRange): unknown {
  return barrierMultipartHashInput('range', range);
}
export async function barrierMultipartDigest(domain: BarrierMultipartHashDomain, value: unknown,
  sha256?: BarrierMultipartSha256): Promise<string> {
  const input = barrierMultipartCanonicalBytes(barrierMultipartHashInput(domain, value));
  const result = sha256 ? await sha256(input) : [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input as Uint8Array<ArrayBuffer>))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  return hash.parse(result);
}
export function barrierMultipartCheckedAdd(...values: number[]): number {
  let result = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0) || result > Number.MAX_SAFE_INTEGER - value)
      throw new Error('BARRIER_MULTIPART_ARITHMETIC_LIMIT');
    result += value;
  }
  return result;
}
export function barrierMultipartCheckedMultiply(left: number, right: number): number {
  if (![left, right].every(value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0))
    || (right !== 0 && left > Math.floor(Number.MAX_SAFE_INTEGER / right))) throw new Error('BARRIER_MULTIPART_ARITHMETIC_LIMIT');
  return left * right;
}
/** Declared conservative nameless envelope; actual encoded bytes, source remap,
 * transforms and all geometry limits still require independent verification. */
export function barrierMultipartRangeBytes(referencedVertices: number, triangles: number): number {
  const envelope = BARRIER_MULTIPART_PROFILE.byteEnvelope;
  return barrierMultipartCheckedAdd(envelope.rangeDescriptor, barrierMultipartCheckedMultiply(envelope.referencedVertex, referencedVertices),
    barrierMultipartCheckedMultiply(envelope.triangle, triangles));
}
export function barrierMultipartMaskFits(maskValue: string, parentCount: number): boolean {
  if (!barrierMultipartMembershipMaskSchema.safeParse(maskValue).success || !Number.isInteger(parentCount) || parentCount < 1 || parentCount > 128) return false;
  return BigInt('0x' + maskValue) < (1n << BigInt(parentCount));
}
