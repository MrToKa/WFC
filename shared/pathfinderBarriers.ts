import { z } from 'zod';
import { canonicalPurposeJson, policyHashSchema, policyRevisionSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';

export const BARRIER_CAPTURE_VERSION = 'wfc.pf.barrier-capture.v1' as const;
export const BARRIER_SNAPSHOT_VERSION = 'wfc.pf.barrier-snapshot.v1' as const;
export const BARRIER_ROUTING_POLICY = 'wfc.pf.registered-triangle-barriers.v1' as const;
export const BARRIER_COLLISION_VERSION = 'wfc.pf.triangle-centreline-collision.v1' as const;

/** Declared refusal ceilings, NOT measured capacity. B1/B2 must qualify them under the 512 MiB session budget.
 * Mesh blobs are separate from the runner's 1 MiB control message. Numeric tolerance is not cable clearance. */
export const BARRIER_LIMITS = Object.freeze({
  selectedParents: 128, fragments: 8192, computationalMeshes: 256, vertices: 500_000, triangles: 250_000,
  captureBytes: 32 * 1024 ** 2, meshBlobBytes: 32 * 1024 ** 2, snapshotBytes: 64 * 1024 ** 2,
  manifestBytes: 256 * 1024, controlBytes: 64 * 1024, bvhNodes: 500_000,
  buildWork: 40_000_000, queryWork: 2_000_000, buildMilliseconds: 60_000, queryMilliseconds: 10_000,
  routeSegments: 200_000, diagnostics: 64, coordinateMagnitudeMetres: 1_000_000_000,
} as const);

const hash = policyHashSchema, uuid = policyUuidSchema, revision = policyRevisionSchema;
const text = z.string().min(1).max(2048).refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  && [...value].every(character => character.length !== 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff));
const reason = z.string().max(96).regex(/^[A-Z][A-Z0-9_]{0,95}$(?![\s\S])/);
const coordinate = z.number().finite().min(-BARRIER_LIMITS.coordinateMagnitudeMetres).max(BARRIER_LIMITS.coordinateMagnitudeMetres);
const nonnegativeCount = (maximum: number) => z.number().int().nonnegative().max(maximum);
const fragmentId = nonnegativeCount(2147483647);
const objectId = z.string().max(16).regex(/^dbid:(?:0|[1-9][0-9]*)$(?![\s\S])/)
  .refine(value => Number(value.slice(5)) <= 2147483647);
const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
const bytes = (value: unknown) => new TextEncoder().encode(canonicalPurposeJson(value)).byteLength;
export const barrierPointSchema = z.tuple([coordinate, coordinate, coordinate]);
export const barrierBoundsSchema = z.object({ minimum: barrierPointSchema, maximum: barrierPointSchema }).strict()
  .refine(value => value.minimum.every((number, index) => number <= value.maximum[index]), 'Bounds must be ordered.');

/** A conversion/frame-local identity. Neither dbId nor a name is a durable cross-revision mapping. */
export const barrierModelScopeSchema = z.object({
  projectId: uuid, modelVersionId: uuid, contentFingerprint: hash, selectionRevision: revision,
  captureFrameId: uuid, captureFrameSha256: hash, coordinateFrame: z.literal('canonical-world-metres'),
}).strict();
export const barrierSelectedParentSchema = z.object({
  selectionId: uuid, kind: z.enum(['wall', 'partition', 'floor', 'ceiling']),
  objectId, dbId: nonnegativeCount(2147483647), externalId: text.nullable(), name: text,
  identityBasis: z.literal('version-local-only'), inclusion: z.literal('own-and-all-descendant-fragments'),
}).strict().refine(value => value.objectId === `dbid:${value.dbId}`, 'Selected parent identity differs from its dbId.');
const selectedParents = z.array(barrierSelectedParentSchema).max(BARRIER_LIMITS.selectedParents)
  .refine(values => unique(values.map(value => value.selectionId)) && unique(values.map(value => value.objectId)), 'Selected parent identities must be unique.');

const affineMatrix = z.array(coordinate).length(16).refine(value => value[3] === 0 && value[7] === 0 && value[11] === 0 && value[15] === 1
  && (value[0] * (value[5] * value[10] - value[9] * value[6]) - value[4] * (value[1] * value[10] - value[9] * value[2])
    + value[8] * (value[1] * value[6] - value[5] * value[2])) !== 0,
  'Use a finite nonsingular affine column-major source-to-world matrix.');
export const barrierFragmentSourceSchema = z.object({
  fragmentId, ownerObjectId: objectId,
  parentSelectionIds: z.array(uuid).min(1).max(BARRIER_LIMITS.selectedParents).refine(unique),
  sourceUnits: text.refine(value => value.length <= 64, 'Source units exceed their text bound.'), metresPerSourceUnit: z.number().finite().positive().max(1_000_000),
  sourceToWorldMetres: affineMatrix, transformSha256: hash,
}).strict();

/** Original indexed triangles in canonical metres; never replace them with the enclosing box.
 * Schema checks are structural only. They do not certify topology, complete SDK enumeration or free space. */
export const barrierCapturedFragmentSchema = z.object({
  source: barrierFragmentSourceSchema, bounds: barrierBoundsSchema,
  verticesMetres: z.array(barrierPointSchema).min(3).max(BARRIER_LIMITS.vertices),
  triangleIndices: z.array(nonnegativeCount(BARRIER_LIMITS.vertices - 1)).min(3).max(BARRIER_LIMITS.triangles * 3),
}).strict().superRefine((value, context) => {
  if (value.triangleIndices.length % 3 !== 0 || value.triangleIndices.some(index => index >= value.verticesMetres.length))
    context.addIssue({ code: 'custom', message: 'Each indexed triangle must reference three existing vertices.' });
  for (let at = 0; at + 2 < value.triangleIndices.length; at += 3) {
    if (!unique(value.triangleIndices.slice(at, at + 3))) {
      context.addIssue({ code: 'custom', message: 'A triangle cannot repeat a vertex index.' }); break;
    }
  }
  if (value.verticesMetres.some(point => point.some((number, index) => number < value.bounds.minimum[index] || number > value.bounds.maximum[index])))
    context.addIssue({ code: 'custom', message: 'Broad-phase bounds must contain every supplied vertex.' });
});

/** Untrusted capture observation, deliberately no ready/verified/actor/path fields. A complete observation
 * still requires the B2 protected capture producer and B1 server-side geometric qualification. */
export const barrierCaptureSchema = z.object({
  schemaVersion: z.literal(BARRIER_CAPTURE_VERSION), captureId: uuid, scope: barrierModelScopeSchema,
  selectedParents: selectedParents.refine(values => values.length > 0),
  fragments: z.array(barrierCapturedFragmentSchema).max(BARRIER_LIMITS.fragments),
  observation: z.object({
    state: z.enum(['reported-complete', 'partial']), verification: z.literal('unverified'),
    enumeratedFragmentIds: z.array(fragmentId).max(BARRIER_LIMITS.fragments).refine(unique),
    unavailableFragmentIds: z.array(fragmentId).max(BARRIER_LIMITS.fragments).refine(unique),
    enumerationSha256: hash,
  }).strict(),
}).strict().superRefine((value, context) => {
  const ids = value.fragments.map(fragment => fragment.source.fragmentId), parents = new Set(value.selectedParents.map(parent => parent.selectionId));
  const observed = value.observation, enumerated = new Set(observed.enumeratedFragmentIds), unavailable = new Set(observed.unavailableFragmentIds);
  if (!unique(ids) || ids.some(id => !enumerated.has(id) || unavailable.has(id)) || [...unavailable].some(id => !enumerated.has(id))
    || ids.length + unavailable.size !== enumerated.size
    || value.fragments.some(fragment => fragment.source.parentSelectionIds.some(id => !parents.has(id))))
    context.addIssue({ code: 'custom', message: 'Capture fragment identities and parent membership must close over this observation.' });
  if (observed.state === 'reported-complete' && (!ids.length || unavailable.size !== 0
    || value.selectedParents.some(parent => !value.fragments.some(fragment => fragment.source.parentSelectionIds.includes(parent.selectionId)))))
    context.addIssue({ code: 'custom', message: 'Reported completeness requires available geometry for every selected parent.' });
  if (value.fragments.reduce((sum, fragment) => sum + fragment.verticesMetres.length, 0) > BARRIER_LIMITS.vertices
    || value.fragments.reduce((sum, fragment) => sum + fragment.triangleIndices.length / 3, 0) > BARRIER_LIMITS.triangles
    || bytes(value) > BARRIER_LIMITS.captureBytes)
    context.addIssue({ code: 'custom', message: 'The complete capture exceeds its declared aggregate budget.' });
});

/** Opaque server-owned content reference; filesystem paths and URLs are not wire inputs. */
export const barrierMeshBlobSchema = z.object({
  blobId: uuid, sha256: hash, bytes: z.number().int().positive().max(BARRIER_LIMITS.meshBlobBytes),
}).strict();
const meshSummary = z.object({
  source: barrierFragmentSourceSchema, bounds: barrierBoundsSchema, mesh: barrierMeshBlobSchema,
  vertices: z.number().int().min(3).max(BARRIER_LIMITS.vertices), triangles: z.number().int().positive().max(BARRIER_LIMITS.triangles),
}).strict();

/** A server-produced manifest. Parsing verifies its shape, never the authenticity of producer assertions.
 * Only B2 publication may create it after inspecting the real captured triangles and selection closure. */
export const barrierSnapshotSchema = z.object({
  schemaVersion: z.literal(BARRIER_SNAPSHOT_VERSION), snapshotId: uuid, scope: barrierModelScopeSchema,
  registryRevision: revision, contentSha256: hash, selectedParents,
  capture: z.object({ captureId: uuid, payloadSha256: hash }).strict().nullable(),
  geometry: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('mesh-set'), fragments: z.array(meshSummary).min(1).max(BARRIER_LIMITS.fragments),
      verification: z.object({ producerVersion: z.literal('wfc.pf.barrier-verifier.v1'),
        selectionClosure: z.literal('complete-selected-scope'), topology: z.literal('qualified-closed-consistent-two-manifold'),
        selfIntersection: z.literal('bounded-verification-passed'),
        computationalMeshes: z.number().int().positive().max(BARRIER_LIMITS.computationalMeshes),
        verifiedCaptureSha256: hash, verificationSha256: hash }).strict(),
    }).strict(),
    z.object({ mode: z.literal('explicit-empty'), declarationId: uuid,
      declaration: z.literal('administrator-declared-no-selected-barriers'), reason: text }).strict(),
  ]),
  coverage: z.literal('registered-selected-objects-only'), engineeringAccepted: z.literal(false),
}).strict().superRefine((value, context) => {
  if (value.geometry.mode === 'explicit-empty') {
    if (value.selectedParents.length !== 0 || value.capture !== null)
      context.addIssue({ code: 'custom', message: 'An explicitly empty scope cannot carry selected geometry or a synthetic capture.' });
  } else {
    const fragments = value.geometry.fragments, parents = new Set(value.selectedParents.map(parent => parent.selectionId));
    if (!value.capture || value.capture.payloadSha256 !== value.geometry.verification.verifiedCaptureSha256 || !parents.size
      || !unique(fragments.map(fragment => fragment.source.fragmentId))
      || fragments.some(fragment => fragment.source.parentSelectionIds.some(id => !parents.has(id)))
      || value.selectedParents.some(parent => !fragments.some(fragment => fragment.source.parentSelectionIds.includes(parent.selectionId))))
      context.addIssue({ code: 'custom', message: 'Verified manifest must retain its exact capture and all unique parent/fragment membership.' });
    if (fragments.reduce((sum, fragment) => sum + fragment.vertices, 0) > BARRIER_LIMITS.vertices
      || fragments.reduce((sum, fragment) => sum + fragment.triangles, 0) > BARRIER_LIMITS.triangles
      || fragments.reduce((sum, fragment) => sum + fragment.mesh.bytes, 0) > BARRIER_LIMITS.snapshotBytes)
      context.addIssue({ code: 'custom', message: 'The manifest exceeds its declared aggregate geometry budget.' });
  }
  if (bytes(value) > BARRIER_LIMITS.manifestBytes) context.addIssue({ code: 'custom', message: 'The barrier manifest exceeds its byte budget.' });
});
export const barrierSnapshotReferenceSchema = z.object({
  snapshotId: uuid, scope: barrierModelScopeSchema, registryRevision: revision, contentSha256: hash, mode: z.enum(['mesh-set', 'explicit-empty']),
}).strict();

/** Fresh request only. Historical policy/hash readers below intentionally have NO defaults. */
export const barrierAdmissionPolicySchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-admission-policy.v1'), drillThroughWalls: z.boolean().default(false),
}).strict();
export const barrierRoutingPolicySchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-routing-policy.v1'), policyVersion: z.literal(BARRIER_ROUTING_POLICY),
  drillThroughWalls: z.boolean(), collisionVersion: z.literal(BARRIER_COLLISION_VERSION),
  numericToleranceMetres: z.number().finite().min(1e-9).max(1e-3),
  physicalClearance: z.object({ mode: z.literal('centreline-only'), radiusMetres: z.literal(0),
    diameterSource: z.literal('not-qualified') }).strict(),
}).strict();

export const barrierRegistrySchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-registry.v1'), scope: barrierModelScopeSchema, registryRevision: revision,
  state: z.enum(['unconfigured', 'capturing', 'partial', 'ready', 'stale', 'invalid']),
  // Ready may carry informational diagnostics; its authority still comes from the exact published reference.
  selectedParents, snapshot: barrierSnapshotReferenceSchema.nullable(), reasonCodes: z.array(reason).max(BARRIER_LIMITS.diagnostics).refine(unique),
}).strict().superRefine((value, context) => {
  if (value.state === 'ready' && (!value.snapshot || value.snapshot.registryRevision !== value.registryRevision
    || canonicalPurposeJson(value.snapshot.scope) !== canonicalPurposeJson(value.scope)
    || (value.snapshot.mode === 'mesh-set') !== (value.selectedParents.length > 0)))
    context.addIssue({ code: 'custom', message: 'Only an exact published snapshot can make the current selected scope ready.' });
  if (value.state === 'unconfigured' && (value.snapshot !== null || value.selectedParents.length > 0)
    || ['capturing', 'partial', 'invalid'].includes(value.state) && value.snapshot !== null)
    context.addIssue({ code: 'custom', message: 'An incomplete/unconfigured state cannot claim a published current snapshot.' });
  if (value.state !== 'ready' && !value.reasonCodes.length)
    context.addIssue({ code: 'custom', message: 'Unavailable registry state requires an explicit reason.' });
});

export const barrierCaptureCommandSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-capture-command.v1'), scope: barrierModelScopeSchema,
  expectedRegistryRevision: revision, idempotencyKey: uuid,
  selectedParents: selectedParents.refine(values => values.length > 0),
}).strict().refine(value => bytes(value) <= BARRIER_LIMITS.controlBytes, 'Barrier capture command exceeds its control-message budget.');
export const barrierRegistryCommandSchema = z.discriminatedUnion('action', [
  z.object({ schemaVersion: z.literal('wfc.pf.barrier-registry-command.v1'), action: z.literal('remove'), scope: barrierModelScopeSchema,
    expectedRegistryRevision: revision, idempotencyKey: uuid, selectionIds: z.array(uuid).min(1).max(BARRIER_LIMITS.selectedParents).refine(unique) }).strict(),
  z.object({ schemaVersion: z.literal('wfc.pf.barrier-registry-command.v1'), action: z.literal('declare-empty'), scope: barrierModelScopeSchema,
    expectedRegistryRevision: revision, idempotencyKey: uuid, reason: text }).strict(),
]);

export const barrierCalculationBindingSchema = z.object({
  scope: barrierModelScopeSchema, registryRevision: revision, snapshot: barrierSnapshotReferenceSchema.nullable(),
  policy: barrierRoutingPolicySchema, policySha256: hash,
}).strict().refine(value => value.snapshot === null || value.snapshot.registryRevision === value.registryRevision
  && canonicalPurposeJson(value.snapshot.scope) === canonicalPurposeJson(value.scope),
  'Calculation binding must name the exact model/frame and registry revision.');
export const barrierCheckProofSchema = z.object({
  schemaVersion: z.literal('wfc.pf.barrier-check-proof.v1'), binding: barrierCalculationBindingSchema,
  routeSha256: hash, status: z.enum(['clear-selected-scope', 'blocked', 'bypassed', 'unavailable', 'no-barriers-declared']),
  /** A one-point route is one degenerate segment/point-occupancy query, never an unchecked empty route. */
  routePointCount: z.number().int().positive().max(BARRIER_LIMITS.routeSegments + 1),
  totalSegments: z.number().int().positive().max(BARRIER_LIMITS.routeSegments), checkedSegments: nonnegativeCount(BARRIER_LIMITS.routeSegments),
  blocking: z.object({ selectionId: uuid, fragmentId, segmentIndex: nonnegativeCount(BARRIER_LIMITS.routeSegments - 1),
    pointMetres: barrierPointSchema }).strict().nullable(),
  reasonCode: reason, coverage: z.literal('registered-selected-objects-only'), engineeringAccepted: z.literal(false),
}).strict().superRefine((value, context) => {
  const { policy, snapshot } = value.binding;
  if (value.totalSegments !== Math.max(1, value.routePointCount - 1) || value.checkedSegments > value.totalSegments
    || value.blocking && value.blocking.segmentIndex >= value.totalSegments)
    context.addIssue({ code: 'custom', message: 'Collision progress cannot exceed the exact route.' });
  if (value.status === 'clear-selected-scope' && (policy.drillThroughWalls || snapshot?.mode !== 'mesh-set'
    || value.checkedSegments !== value.totalSegments || value.blocking !== null || value.reasonCode !== 'REGISTERED_SCOPE_CLEAR'))
    context.addIssue({ code: 'custom', message: 'A clear result requires all segments checked against a published mesh scope.' });
  if (value.status === 'blocked' && (policy.drillThroughWalls || snapshot?.mode !== 'mesh-set' || !value.blocking
    || value.checkedSegments === 0 || value.reasonCode !== 'REGISTERED_BARRIER_INTERSECTION'))
    context.addIssue({ code: 'custom', message: 'A blocked result must identify an actual checked intersection.' });
  if (value.status === 'bypassed' && (!policy.drillThroughWalls || value.checkedSegments !== 0 || value.blocking !== null
    || value.reasonCode !== 'EXPLICIT_DRILLING_BYPASS'))
    context.addIssue({ code: 'custom', message: 'Drilling is an explicit bypass, never a clear certificate.' });
  if (value.status === 'no-barriers-declared' && (policy.drillThroughWalls || snapshot?.mode !== 'explicit-empty'
    || value.checkedSegments !== 0 || value.blocking !== null || value.reasonCode !== 'EXPLICIT_EMPTY_SCOPE'))
    context.addIssue({ code: 'custom', message: 'An empty declaration is distinct from a geometric wall check.' });
  if (value.status === 'unavailable' && (value.checkedSegments !== 0 || value.blocking !== null
    || ['REGISTERED_SCOPE_CLEAR', 'REGISTERED_BARRIER_INTERSECTION', 'EXPLICIT_DRILLING_BYPASS', 'EXPLICIT_EMPTY_SCOPE'].includes(value.reasonCode)))
    context.addIssue({ code: 'custom', message: 'Unavailable evidence cannot imply a checked or bypassed scope.' });
});

export type BarrierModelScope = z.infer<typeof barrierModelScopeSchema>;
export type BarrierCapture = z.infer<typeof barrierCaptureSchema>;
export type BarrierSnapshot = z.infer<typeof barrierSnapshotSchema>;
export type BarrierRegistry = z.infer<typeof barrierRegistrySchema>;
export type BarrierRoutingPolicy = z.infer<typeof barrierRoutingPolicySchema>;
export type BarrierCalculationBinding = z.infer<typeof barrierCalculationBindingSchema>;
export type BarrierCheckProof = z.infer<typeof barrierCheckProofSchema>;

export function barrierSnapshotHashInput(snapshot: BarrierSnapshot): unknown {
  const { contentSha256: _digest, ...body } = barrierSnapshotSchema.parse(snapshot); return body;
}
export const barrierCanonicalJson = canonicalPurposeJson;

/** Integrity only: persisted producer authority and real geometry qualification are separate checks. */
export function verifyBarrierSnapshot(value: unknown, hashCanonicalString: (value: string) => string): value is BarrierSnapshot {
  const parsed = barrierSnapshotSchema.safeParse(value); if (!parsed.success) return false;
  try { return hashCanonicalString(canonicalPurposeJson(barrierSnapshotHashInput(parsed.data))) === parsed.data.contentSha256; }
  catch { return false; }
}

/** Exact currentness/hash comparison only. This does NOT certify collision math, topology or server authority. */
export function verifyBarrierCheckProof(value: unknown, expected: { binding: BarrierCalculationBinding; routeSha256: string },
  hashCanonicalString: (value: string) => string): value is BarrierCheckProof {
  const proof = barrierCheckProofSchema.safeParse(value), binding = barrierCalculationBindingSchema.safeParse(expected.binding);
  if (!proof.success || !binding.success || !hash.safeParse(expected.routeSha256).success) return false;
  try {
    return hashCanonicalString(canonicalPurposeJson(binding.data.policy)) === binding.data.policySha256
      && canonicalPurposeJson(proof.data.binding) === canonicalPurposeJson(binding.data)
      && proof.data.routeSha256 === expected.routeSha256;
  } catch { return false; }
}
