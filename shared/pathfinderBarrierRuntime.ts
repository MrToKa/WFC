import { z } from 'zod';
import { BARRIER_COLLISION_VERSION, BARRIER_LIMITS, BARRIER_ROUTING_POLICY, barrierCalculationBindingSchema,
  barrierCanonicalJson, barrierPointSchema, type BarrierCalculationBinding } from './pathfinderBarriers.js';
import { policyHashSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';
import { barrierCheckProofV2Schema, barrierComputationalMembershipSchema, constrainedDirectSecondaryDecisionSchema,
  verifyBarrierCheckProofV2 } from './pathfinderBarrierDecisions.js';

/** Immutable server-owned computation profile. A changed limit/algorithm gets a new
 * version and hash; it is never a mutable project allowance or capacity claim. */
export const BARRIER_RUNTIME_PROFILE = Object.freeze({
  schemaVersion: 'wfc.pf.barrier-runtime-profile.v1',
  routeHashVersion: 'wfc.pf.route-binary64-le.v1',
  qualification: Object.freeze({ producerVersion: 'wfc.pf.barrier-verifier.v1', maximumBytes: BARRIER_LIMITS.captureBytes,
    maximumFragments: 8192, maximumParents: 128, maximumComputationalMeshes: 256, maximumVertices: 500000,
    maximumTriangles: 250000, maximumWork: 40000000, maximumMilliseconds: 60000, numericToleranceMetres: 1e-7 }),
  kernel: Object.freeze({ collisionVersion: BARRIER_COLLISION_VERSION, maximumBvhNodes: 500000,
    maximumQueryWork: 2000000, maximumQueryMilliseconds: 10000, maximumEstimatedBytes: 134217728,
    bvhLeafSize: 8, maximumCoordinateMagnitudeMetres: 1000000000 }),
  routing: Object.freeze({ policyVersion: 'wfc.pf.constrained-tray-routing.v1', candidateRankingVersion: 'wfc.pf.accessible-piece-projections.v1',
    maxCandidatesPerEnd: 16, maxPairs: 64, maxCollisionQueries: 100000, maxWork: 20000000, timeoutMilliseconds: 30000,
    maxInputTrays: 4096, maxInputPieces: 50000, maxGraphNodes: 100000, maxGraphConnections: 300000 }),
  localConnectors: Object.freeze({ policyVersion: 'wfc.pf.local-connector-lattice.v1', approachVersion: 'wfc.pf.local-approach-routing.v1',
    domainVersion: 'endpoint-tray-aabb-with-profile-padding.v1', stepMeters: 0.25, paddingMeters: 1, maxAxisSpanMeters: 20,
    maxNodes: 4096, maxEdgeChecks: 16384, maxPlans: 8, maxStraightPairs: 8 }),
} as const);

/** Literal profile parsing prevents a caller changing a limit while retaining its
 * implementation label. Only a deliberate new profile can extend this contract. */
function literalObject<T extends Record<string, string | number>>(value: T) {
  return z.object(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, z.literal(entry)])) as { [K in keyof T]: z.ZodLiteral<T[K]> }).strict();
}
export const barrierRuntimeProfileSchema = z.object({
  schemaVersion: z.literal(BARRIER_RUNTIME_PROFILE.schemaVersion), routeHashVersion: z.literal(BARRIER_RUNTIME_PROFILE.routeHashVersion),
  qualification: literalObject(BARRIER_RUNTIME_PROFILE.qualification), kernel: literalObject(BARRIER_RUNTIME_PROFILE.kernel),
  routing: literalObject(BARRIER_RUNTIME_PROFILE.routing), localConnectors: literalObject(BARRIER_RUNTIME_PROFILE.localConnectors),
}).strict();
export type BarrierRuntimeProfile = z.infer<typeof barrierRuntimeProfileSchema>;
const blob = z.object({ blobId: policyUuidSchema, sha256: policyHashSchema, bytes: z.number().int().positive().max(BARRIER_LIMITS.captureBytes) }).strict();
export const barrierRuntimeContextSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-runtime.v1'), binding: barrierCalculationBindingSchema,
  profile: barrierRuntimeProfileSchema, profileSha256: policyHashSchema,
  storage: z.object({ intentId: policyUuidSchema, manifest: blob, capture: blob.nullable() }).strict().nullable(),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  const snapshot = value.binding.snapshot;
  if (!snapshot) {
    if (!value.binding.policy.drillThroughWalls || value.storage !== null) issue('An unpublished scope permits only explicit bypass with no fabricated stored geometry.');
  } else if (!value.storage || value.storage.manifest.bytes > BARRIER_LIMITS.manifestBytes
    || (snapshot.mode === 'mesh-set') !== (value.storage.capture !== null)) issue('Exact published manifests require the corresponding bounded original capture reference.');
  if (value.binding.policy.numericToleranceMetres !== value.profile.qualification.numericToleranceMetres)
    issue('The runtime profile and collision binding must use the same numerical contact policy.');
  try {
    if (new TextEncoder().encode(barrierCanonicalJson(value)).byteLength > BARRIER_LIMITS.controlBytes) issue('The runtime context exceeds its small control-message budget.');
  } catch { issue('The runtime context must contain finite canonical values.'); }
});
export type BarrierRuntimeContext = z.infer<typeof barrierRuntimeContextSchema>;

const canonicalWork = (value: string) => /^(?:0|[1-9][0-9]*)(?![\s\S])/.test(value) && value.length <= 19 && BigInt(value) <= 9223372036854775807n;
const work = z.string().max(19).refine(canonicalWork);
const reasonCode = z.string().min(1).max(96).regex(/^[A-Z][A-Z0-9_]{0,95}$(?![\s\S])/);
const boundedCount = (maximum: number) => z.number().int().nonnegative().max(maximum);
const connectorPlanSchema = z.object({ policyVersion: z.literal(BARRIER_RUNTIME_PROFILE.localConnectors.policyVersion),
  status: z.enum(['clear', 'blocked', 'indeterminate', 'search-incomplete']), reasonCode,
  points: z.array(barrierPointSchema).max(BARRIER_LIMITS.routeSegments + 1), lengthMeters: z.number().finite().nonnegative(),
  directDistanceMeters: z.number().finite().nonnegative(), isDetour: z.boolean(), searchComplete: z.boolean(),
  domain: z.object({ minimum: barrierPointSchema, maximum: barrierPointSchema, stepMeters: z.literal(0.25) }).strict()
    .refine(value => value.minimum.every((coordinate, index) => coordinate <= value.maximum[index])),
  edgeChecks: boundedCount(16384), queries: boundedCount(100000), work,
}).strict();
export const barrierExecutionSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-execution.v1'), context: barrierRuntimeContextSchema,
  proof: barrierCheckProofV2Schema.nullable(), directSecondary: constrainedDirectSecondaryDecisionSchema.nullable(),
  diagnostics: z.object({ status: z.enum(['clear', 'blocked', 'indeterminate', 'search-incomplete', 'bypassed', 'unavailable', 'no-barriers-declared']),
    reasonCode, searchComplete: z.boolean(), candidatesTruncated: z.boolean(), pairAttempts: boundedCount(64), collisionQueries: boundedCount(100000), work,
    plannerAttempts: boundedCount(8), straightPairAttempts: boundedCount(64), localEdgeChecks: boundedCount(16384),
    localPhaseUsed: z.boolean(), straightPhaseTruncated: z.boolean(),
  }).strict(), connectors: z.object({ from: connectorPlanSchema.nullable(), to: connectorPlanSchema.nullable() }).strict(),
  qualification: z.object({ captureSha256: policyHashSchema, pureVerificationSha256: policyHashSchema, decompositionSha256: policyHashSchema,
    computationalMemberships: z.array(barrierComputationalMembershipSchema).min(1).max(BARRIER_LIMITS.computationalMeshes)
      .refine(values => new Set(values.map(value => value.computationalMeshId)).size === values.length),
  }).strict().nullable(),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (value.proof && barrierCanonicalJson(value.proof.binding) !== barrierCanonicalJson(value.context.binding)
    || value.directSecondary && barrierCanonicalJson(value.directSecondary.binding) !== barrierCanonicalJson(value.context.binding))
    issue('Every check and direct decision must retain the exact admitted context.');
  if (value.qualification && value.qualification.captureSha256 !== value.context.storage?.capture?.sha256)
    issue('Qualification must describe the exact original stored capture.');
  const successful = ['clear', 'bypassed', 'no-barriers-declared'].includes(value.diagnostics.status);
  const expected = { clear: 'clear-selected-scope', bypassed: 'bypassed', 'no-barriers-declared': 'no-barriers-declared' } as const;
  if (successful && (!value.proof || value.proof.status !== expected[value.diagnostics.status as keyof typeof expected]
    || !canonicalWork(value.diagnostics.work) || BigInt(value.diagnostics.work) > BigInt(BARRIER_RUNTIME_PROFILE.routing.maxWork)))
    issue('Successful computation needs its exact final-route proof and bounded work; candidate exhaustion is a separate diagnostic.');
  const proofDiagnostics = { 'clear-selected-scope': 'clear', blocked: 'blocked', indeterminate: 'indeterminate', bypassed: 'bypassed', unavailable: 'unavailable', 'no-barriers-declared': 'no-barriers-declared' } as const;
  if (value.proof && proofDiagnostics[value.proof.status] !== value.diagnostics.status)
    issue('Final-check diagnostics and proof must describe the same exact outcome.');
  if ((value.proof?.status === 'clear-selected-scope' || value.proof?.status === 'blocked' || value.proof?.status === 'indeterminate') && !value.qualification)
    issue('Physical checks require actual capture qualification and honest computational membership.');
  for (const plan of [value.connectors.from, value.connectors.to]) {
    if (plan && (plan.status !== 'clear' || plan.points.length < 1 || !plan.searchComplete))
      issue('Retained successful connectors cannot be partial or unresolved.');
  }
});
export type BarrierExecution = z.infer<typeof barrierExecutionSchema>;

/** Integrity/currentness guard; the trusted runner still owns collision math. */
export function verifyBarrierExecutionRoute(value: unknown, expected: { context: BarrierRuntimeContext; points: readonly (readonly number[])[] },
  hashCanonicalString: (value: string) => string): value is BarrierExecution {
  const parsed = barrierExecutionSchema.safeParse(value);
  if (!parsed.success || !parsed.data.proof || !['clear', 'bypassed', 'no-barriers-declared'].includes(parsed.data.diagnostics.status)
    || barrierCanonicalJson(parsed.data.context) !== barrierCanonicalJson(expected.context)
    || !verifyBarrierRuntimeContext(parsed.data.context, hashCanonicalString)) return false;
  try {
    return verifyBarrierCheckProofV2(parsed.data.proof, { binding: expected.context.binding,
      routeSha256: hashCanonicalString(barrierCanonicalJson(barrierRouteHashInput(expected.points))), routePointCount: expected.points.length,
      computationalMemberships: parsed.data.qualification?.computationalMemberships ?? [] }, hashCanonicalString);
  } catch { return false; }
}

export function createBarrierRuntimePolicy(drillThroughWalls: boolean): BarrierCalculationBinding['policy'] {
  if (typeof drillThroughWalls !== 'boolean') throw new Error('An explicit drilling choice is required.');
  return { schemaVersion: 'wfc.pf.barrier-routing-policy.v1', policyVersion: BARRIER_ROUTING_POLICY, drillThroughWalls,
    collisionVersion: BARRIER_COLLISION_VERSION, numericToleranceMetres: BARRIER_RUNTIME_PROFILE.qualification.numericToleranceMetres,
    physicalClearance: { mode: 'centreline-only', radiusMetres: 0, diameterSource: 'not-qualified' } };
}
export function verifyBarrierRuntimeContext(value: unknown, hashCanonicalString: (value: string) => string): value is BarrierRuntimeContext {
  const parsed = barrierRuntimeContextSchema.safeParse(value);
  try { return parsed.success && hashCanonicalString(barrierCanonicalJson(parsed.data.profile)) === parsed.data.profileSha256
    && hashCanonicalString(barrierCanonicalJson(parsed.data.binding.policy)) === parsed.data.binding.policySha256; }
  catch { return false; }
}

/** IEEE754 bits avoid .NET/JavaScript exponent formatting differences. Signed
 * zero alone is canonicalized because JSON/JSONB stores both as zero. Other bits,
 * point order and count remain exact. This hashes a route, never validates it. */
export function barrierRouteHashInput(points: readonly (readonly number[])[]): { schemaVersion: 'wfc.pf.route-binary64-le.v1'; pointBits: string[][] } {
  if (!Array.isArray(points) || points.length < 1 || points.length > BARRIER_LIMITS.routeSegments + 1) throw new Error('Invalid exact route point count.');
  const bytes = new Uint8Array(8), view = new DataView(bytes.buffer);
  const pointBits: string[][] = [];
  for (let at = 0; at < points.length; at++) {
    const point = points[at];
    barrierPointSchema.parse(point);
    pointBits.push(point.map((value: number) => { view.setFloat64(0, value === 0 ? 0 : value, true); return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(''); }));
  }
  return { schemaVersion: 'wfc.pf.route-binary64-le.v1', pointBits };
}
