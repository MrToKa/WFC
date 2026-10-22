import { z } from 'zod';
import { BARRIER_LIMITS, barrierBoundsSchema, barrierCanonicalJson, barrierFragmentSourceSchema, barrierMeshBlobSchema,
  barrierModelScopeSchema, barrierPointSchema, barrierSelectedParentSchema } from './pathfinderBarriers.js';
import { BARRIER_RUNTIME_PROFILE, barrierRouteHashInput } from './pathfinderBarrierRuntime.js';
import { barrierEngineIdentityBodySchema } from './pathfinderEngineIdentity.js';
import { directSecondaryDecisionSchema } from './pathfinderDirectSecondary.js';
import { policyHashSchema as hash, policyRevisionSchema as revision, policyUuidSchema as uuid } from './pathfinderPurposePolicy.js';

/** Additive explicit lane. A v1 capture observation is input, never a v2 policy. */
export const MIXED_BARRIER_POLICY = 'wfc.pf.original-surfaces-and-qualified-solids.v2' as const;
export const MIXED_BARRIER_COLLISION_VERSION = 'wfc.pf.mixed-original-triangle-centreline.v2' as const;
export const MIXED_BARRIER_VERIFIER_VERSION = 'wfc.pf.barrier-mixed-verifier.v2' as const;
export const MIXED_BARRIER_MEMBERSHIP_DOMAIN = 'wfc.pf.mixed-original-component-membership.v2' as const;
export const MIXED_BARRIER_QUERY_DOMAIN = 'provided-original-triangle-surface-contact-and-independently-qualified-closed-solid-occupancy' as const;
const same = (a: unknown, b: unknown) => { try { return barrierCanonicalJson(a) === barrierCanonicalJson(b); } catch { return false; } };
const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
const count = (maximum: number) => z.number().int().nonnegative().max(maximum);
const positive = (maximum: number) => z.number().int().positive().max(maximum);
const fragmentId = count(2147483647);
const objectId = z.string().max(16).regex(/^dbid:(?:0|[1-9][0-9]*)$(?![\s\S])/).refine(value => Number(value.slice(5)) <= 2147483647);
const text = z.string().min(1).max(2048).refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  && [...value].every(character => character.length !== 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff));
const componentId = text.refine(value => value.length <= 256);
const kind = z.enum(['original-surface', 'qualified-closed-solid']);
const reasonCode = z.string().min(1).max(96).regex(/^[A-Z][A-Z0-9_]{0,95}$(?![\s\S])/);
const parents = z.array(barrierSelectedParentSchema).max(BARRIER_LIMITS.selectedParents)
  .refine(values => unique(values.map(value => value.selectionId)) && unique(values.map(value => value.objectId)));
const size = (value: unknown) => { try { return new TextEncoder().encode(barrierCanonicalJson(value)).byteLength; } catch { return Infinity; } };
const issue = (context: z.RefinementCtx, message: string) => context.addIssue({ code: 'custom', message });
const parentIds = z.array(uuid).min(1).max(BARRIER_LIMITS.selectedParents).refine(unique);
const fragmentIds = z.array(fragmentId).min(1).max(BARRIER_LIMITS.fragments).refine(unique);
const tolerance = z.number().finite().min(1e-9).max(1e-3);
const noAuthority = { engineeringAccepted: z.literal(false), ownTerminalExemptionsSupported: z.literal(false), authority: z.literal('none') };

export const mixedBarrierComponentMembershipSchema = z.object({ componentId, kind,
  parentSelectionIds: parentIds.refine(values => values.every((id, index) => index === 0 || values[index - 1] < id)),
  fragmentIds: fragmentIds.refine(values => values.every((id, index) => index === 0 || values[index - 1] < id)),
  triangleCount: positive(BARRIER_LIMITS.triangles), sourceMembershipSha256: hash }).strict();
const memberships = z.array(mixedBarrierComponentMembershipSchema).min(1).max(BARRIER_LIMITS.computationalMeshes)
  .refine(values => unique(values.map(value => value.componentId)));
export type MixedBarrierComponentMembership = z.infer<typeof mixedBarrierComponentMembershipSchema>;
const originalTriangleSchema = z.object({ fragmentId, localTriangleIndex: count(BARRIER_LIMITS.triangles - 1),
  originalVertexIndices: z.tuple([count(BARRIER_LIMITS.vertices - 1), count(BARRIER_LIMITS.vertices - 1), count(BARRIER_LIMITS.vertices - 1)]).refine(unique),
  ownerObjectId: objectId, parentSelectionIds: parentIds }).strict();
const componentHashSourceSchema = z.object({ captureSha256: hash, componentId, kind,
  triangles: z.array(originalTriangleSchema).min(1).max(BARRIER_LIMITS.triangles) }).strict()
  .refine(value => unique(value.triangles.map(row => `${row.fragmentId}:${row.localTriangleIndex}`))
    && new Set(value.triangles.flatMap(row => row.parentSelectionIds)).size <= BARRIER_LIMITS.selectedParents);
/** Canonical identity projection only. Actual retained original triangles and
 * complete source membership must be independently loaded by the trusted producer. */
export function mixedBarrierComponentMembershipHashInput(value: z.input<typeof componentHashSourceSchema>) {
  // This materialized golden/helper projection has a separate memory refusal.
  // The C# producer hashes the same projection incrementally; no capture ceiling
  // or kernel limit is raised or inferred from this helper's successful return.
  if (!Array.isArray(value?.triangles) || value.triangles.length > BARRIER_LIMITS.triangles) throw Error('MIXED_MEMBERSHIP_PROJECTION_LIMIT');
  let upperBytes = 4096;
  for (const row of value.triangles) {
    if (!Array.isArray(row?.parentSelectionIds) || row.parentSelectionIds.length > BARRIER_LIMITS.selectedParents) throw Error('MIXED_MEMBERSHIP_PROJECTION_LIMIT');
    upperBytes += 512 + row.parentSelectionIds.length * 40;
    if (upperBytes > BARRIER_LIMITS.captureBytes) throw Error('MIXED_MEMBERSHIP_PROJECTION_LIMIT');
  }
  const parsed = componentHashSourceSchema.parse(value);
  const triangles = parsed.triangles.map(row => ({ ...row, parentSelectionIds: [...row.parentSelectionIds].sort() }))
    .sort((a, b) => a.fragmentId - b.fragmentId || a.localTriangleIndex - b.localTriangleIndex);
  return { domain: MIXED_BARRIER_MEMBERSHIP_DOMAIN, value: { ...parsed, triangles } };
}

export const mixedBarrierVerifierEvidenceSchema = z.object({ captureId: uuid, scope: barrierModelScopeSchema,
  originalSurfaceComponents: count(BARRIER_LIMITS.computationalMeshes), qualifiedClosedSolidComponents: count(BARRIER_LIMITS.computationalMeshes),
  fragmentCount: positive(BARRIER_LIMITS.fragments), vertexCount: z.number().int().min(3).max(BARRIER_LIMITS.vertices),
  triangleCount: positive(BARRIER_LIMITS.triangles), originalGeometrySha256: hash, verificationSha256: hash, numericToleranceMetres: tolerance,
  componentMemberships: memberships, inputSchemaVersion: z.literal('wfc.pf.barrier-capture.v1'), policyVersion: z.literal(MIXED_BARRIER_POLICY),
  coverage: z.literal('provided-fragments-only'), geometryProvenance: z.literal('capture-bound-provided-original-triangles'),
  sdkCoverageVerified: z.literal(false), sdkSourceBytesVerified: z.literal(false), currentFrameVerified: z.literal(false), ...noAuthority,
}).strict().superRefine((value, context) => {
  if (value.originalSurfaceComponents !== value.componentMemberships.filter(row => row.kind === 'original-surface').length
    || value.qualifiedClosedSolidComponents !== value.componentMemberships.filter(row => row.kind === 'qualified-closed-solid').length
    || value.componentMemberships.reduce((sum, row) => sum + row.triangleCount, 0) !== value.triangleCount
    || new Set(value.componentMemberships.flatMap(row => row.fragmentIds)).size !== value.fragmentCount
    || new Set(value.componentMemberships.flatMap(row => row.parentSelectionIds)).size > BARRIER_LIMITS.selectedParents)
    issue(context, 'Component kinds, original triangle counts and full fragment union must match the exact evidence.');
});
export const mixedBarrierVerifierReceiptSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-mixed-verification-result.v2'),
  producerVersion: z.literal(MIXED_BARRIER_VERIFIER_VERSION), status: z.enum(['geometry-qualified', 'refused']), captureSha256: hash.nullable(),
  evidence: mixedBarrierVerifierEvidenceSchema.nullable(), diagnostics: z.array(z.object({ code: text.refine(value => value.length <= 96), message: z.string().max(2048) }).strict()).max(64),
}).strict().superRefine((value, context) => {
  if (value.status === 'geometry-qualified' ? value.captureSha256 === null || value.evidence === null : value.evidence !== null)
    issue(context, 'Qualified and refused receipts retain distinct exact evidence.');
  if (size(value) > BARRIER_LIMITS.controlBytes) issue(context, 'The bounded receipt cannot be truncated to fit.');
});
export type MixedBarrierVerifierReceipt = z.infer<typeof mixedBarrierVerifierReceiptSchema>;

export const mixedBarrierCaptureCommandSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-capture-command.v2'),
  geometryPolicy: z.literal(MIXED_BARRIER_POLICY), scope: barrierModelScopeSchema, expectedRegistryRevision: revision,
  idempotencyKey: uuid, selectedParents: parents.refine(values => values.length > 0) }).strict().refine(value => size(value) <= BARRIER_LIMITS.controlBytes);
export const mixedBarrierRegistryCommandSchema = z.discriminatedUnion('action', [
  z.object({ schemaVersion: z.literal('wfc.pf.barrier-registry-command.v2'), geometryPolicy: z.literal(MIXED_BARRIER_POLICY), action: z.literal('remove'),
    scope: barrierModelScopeSchema, expectedRegistryRevision: revision, idempotencyKey: uuid, selectionIds: z.array(uuid).min(1).max(BARRIER_LIMITS.selectedParents).refine(unique) }).strict(),
  z.object({ schemaVersion: z.literal('wfc.pf.barrier-registry-command.v2'), geometryPolicy: z.literal(MIXED_BARRIER_POLICY), action: z.literal('declare-empty'),
    scope: barrierModelScopeSchema, expectedRegistryRevision: revision, idempotencyKey: uuid, reason: text }).strict(),
]);
export const mixedBarrierAdmissionPolicySchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-admission-policy.v2'),
  geometryPolicy: z.literal(MIXED_BARRIER_POLICY), drillThroughWalls: z.boolean() }).strict();
const meshSummary = z.object({ source: barrierFragmentSourceSchema, bounds: barrierBoundsSchema, mesh: barrierMeshBlobSchema,
  vertices: z.number().int().min(3).max(BARRIER_LIMITS.vertices), triangles: positive(BARRIER_LIMITS.triangles) }).strict();
const snapshotVerification = z.object({ producerVersion: z.literal(MIXED_BARRIER_VERIFIER_VERSION), geometryPolicy: z.literal(MIXED_BARRIER_POLICY),
  selectionClosure: z.literal('complete-selected-scope'), verifiedCaptureSha256: hash, originalGeometrySha256: hash,
  verificationSha256: hash, componentMemberships: memberships, ...noAuthority }).strict();
export const mixedBarrierSnapshotSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-snapshot.v2'), geometryPolicy: z.literal(MIXED_BARRIER_POLICY),
  snapshotId: uuid, scope: barrierModelScopeSchema, registryRevision: revision, contentSha256: hash, selectedParents: parents,
  capture: z.object({ captureId: uuid, payloadSha256: hash }).strict().nullable(),
  geometry: z.discriminatedUnion('mode', [z.object({ mode: z.literal('mixed-mesh-set'),
    fragments: z.array(meshSummary).min(1).max(BARRIER_LIMITS.fragments), verification: snapshotVerification }).strict(),
  z.object({ mode: z.literal('explicit-empty'), declarationId: uuid, declaration: z.literal('administrator-declared-no-selected-barriers'), reason: text }).strict()]),
  coverage: z.literal('registered-selected-objects-only'), ...noAuthority,
}).strict().superRefine((value, context) => {
  if (value.geometry.mode === 'explicit-empty') {
    if (value.capture !== null || value.selectedParents.length !== 0) issue(context, 'An explicit empty scope has no captured geometry.');
  } else {
    const geometry = value.geometry, fragments = geometry.fragments, ids = new Set(fragments.map(row => row.source.fragmentId));
    const selected = new Set(value.selectedParents.map(row => row.selectionId));
    if (!value.capture || value.capture.payloadSha256 !== geometry.verification.verifiedCaptureSha256 || !selected.size || ids.size !== fragments.length
      || fragments.some(row => row.source.parentSelectionIds.some(id => !selected.has(id)))
      || value.selectedParents.some(parent => !fragments.some(row => row.source.parentSelectionIds.includes(parent.selectionId))))
      issue(context, 'The original capture must close over all exact selected parents and fragments.');
    const members = geometry.verification.componentMemberships;
    if (members.some(row => row.fragmentIds.some(id => !ids.has(id)) || row.parentSelectionIds.some(id => !selected.has(id)))
      || [...ids].some(id => !members.some(row => row.fragmentIds.includes(id)))
      || members.some(row => !same([...new Set(fragments.filter(fragment => row.fragmentIds.includes(fragment.source.fragmentId)).flatMap(fragment => fragment.source.parentSelectionIds))].sort(), [...row.parentSelectionIds].sort()))
      || members.reduce((sum, row) => sum + row.triangleCount, 0) !== fragments.reduce((sum, row) => sum + row.triangles, 0))
      issue(context, 'Original component membership must retain complete fragment and parent coverage without invented members.');
    if (fragments.reduce((sum, row) => sum + row.vertices, 0) > BARRIER_LIMITS.vertices
      || fragments.reduce((sum, row) => sum + row.triangles, 0) > BARRIER_LIMITS.triangles
      || fragments.reduce((sum, row) => sum + row.mesh.bytes, 0) > BARRIER_LIMITS.snapshotBytes)
      issue(context, 'The same aggregate geometry ceilings apply to mixed data.');
  }
  if (size(value) > BARRIER_LIMITS.manifestBytes) issue(context, 'The original complete manifest exceeds its bounded representation.');
});
export type MixedBarrierSnapshot = z.infer<typeof mixedBarrierSnapshotSchema>;
export const mixedBarrierSnapshotReferenceSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-snapshot-reference.v2'),
  geometryPolicy: z.literal(MIXED_BARRIER_POLICY), snapshotId: uuid, scope: barrierModelScopeSchema, registryRevision: revision,
  contentSha256: hash, mode: z.enum(['mixed-mesh-set', 'explicit-empty']) }).strict();
export const mixedBarrierPublicationReceiptSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-publication-receipt.v2'),
  snapshot: mixedBarrierSnapshotReferenceSchema, duplicate: z.boolean() }).strict();
export const mixedBarrierRegistrySchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-registry.v2'), geometryPolicy: z.literal(MIXED_BARRIER_POLICY),
  scope: barrierModelScopeSchema, registryRevision: revision, state: z.enum(['unconfigured', 'capturing', 'partial', 'ready', 'stale', 'invalid']),
  selectedParents: parents, snapshot: mixedBarrierSnapshotReferenceSchema.nullable(), reasonCodes: z.array(reasonCode).max(BARRIER_LIMITS.diagnostics).refine(unique),
}).strict().superRefine((value, context) => {
  if (value.state === 'ready' && (!value.snapshot || value.snapshot.registryRevision !== value.registryRevision || !same(value.snapshot.scope, value.scope)
    || (value.snapshot.mode === 'mixed-mesh-set') !== (value.selectedParents.length > 0))) issue(context, 'Ready requires the exact published mixed reference.');
  if (value.state === 'unconfigured' && (value.snapshot !== null || value.selectedParents.length !== 0)
    || ['capturing', 'partial', 'invalid'].includes(value.state) && value.snapshot !== null) issue(context, 'Incomplete states cannot assert current publication.');
  if (value.state !== 'ready' && value.reasonCodes.length === 0) issue(context, 'Unavailable scope needs an explicit reason.');
});
export const mixedBarrierAdmissionIntentSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-admission-intent.v2'),
  geometryPolicy: z.literal(MIXED_BARRIER_POLICY), scope: barrierModelScopeSchema, expectedRegistryRevision: revision,
  expectedSnapshot: mixedBarrierSnapshotReferenceSchema.nullable(), drillThroughWalls: z.boolean() }).strict().superRefine((value, context) => {
  if (!value.expectedSnapshot ? !value.drillThroughWalls : value.expectedSnapshot.registryRevision !== value.expectedRegistryRevision || !same(value.expectedSnapshot.scope, value.scope))
    issue(context, 'Admission must retain the exact current mixed scope; absence permits only explicit drilling.');
});
export const mixedBarrierRoutingPolicySchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-routing-policy.v2'),
  policyVersion: z.literal(MIXED_BARRIER_POLICY), collisionVersion: z.literal(MIXED_BARRIER_COLLISION_VERSION), drillThroughWalls: z.boolean(),
  numericToleranceMetres: tolerance, physicalClearance: z.object({ mode: z.literal('centreline-only'), radiusMetres: z.literal(0), diameterSource: z.literal('not-qualified') }).strict(),
  ownTerminalExemptionsSupported: z.literal(false) }).strict();
export const mixedBarrierCalculationBindingSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-calculation-binding.v2'),
  scope: barrierModelScopeSchema, registryRevision: revision, snapshot: mixedBarrierSnapshotReferenceSchema.nullable(),
  policy: mixedBarrierRoutingPolicySchema, policySha256: hash }).strict().refine(value => value.snapshot === null || value.snapshot.registryRevision === value.registryRevision && same(value.snapshot.scope, value.scope));
export type MixedBarrierCalculationBinding = z.infer<typeof mixedBarrierCalculationBindingSchema>;

const { maximumComputationalMeshes: _oldCount, ...oldQualification } = BARRIER_RUNTIME_PROFILE.qualification;
export const MIXED_BARRIER_RUNTIME_PROFILE = Object.freeze({ schemaVersion: 'wfc.pf.barrier-runtime-profile.v2', routeHashVersion: BARRIER_RUNTIME_PROFILE.routeHashVersion,
  qualification: Object.freeze({ ...oldQualification, producerVersion: MIXED_BARRIER_VERIFIER_VERSION, geometryPolicy: MIXED_BARRIER_POLICY, maximumComponents: 256 }),
  kernel: Object.freeze({ ...BARRIER_RUNTIME_PROFILE.kernel, collisionVersion: MIXED_BARRIER_COLLISION_VERSION, domain: MIXED_BARRIER_QUERY_DOMAIN, ownTerminalExemptionsSupported: false }),
  routing: BARRIER_RUNTIME_PROFILE.routing, localConnectors: BARRIER_RUNTIME_PROFILE.localConnectors } as const);
function literalObject<T extends Record<string, string | number | boolean>>(value: T) {
  return z.object(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, z.literal(entry)])) as { [K in keyof T]: z.ZodLiteral<T[K]> }).strict();
}
export const mixedBarrierRuntimeProfileSchema = z.object({ schemaVersion: z.literal(MIXED_BARRIER_RUNTIME_PROFILE.schemaVersion),
  routeHashVersion: z.literal(MIXED_BARRIER_RUNTIME_PROFILE.routeHashVersion), qualification: literalObject(MIXED_BARRIER_RUNTIME_PROFILE.qualification),
  kernel: literalObject(MIXED_BARRIER_RUNTIME_PROFILE.kernel), routing: literalObject(MIXED_BARRIER_RUNTIME_PROFILE.routing),
  localConnectors: literalObject(MIXED_BARRIER_RUNTIME_PROFILE.localConnectors) }).strict();

/** Explicit additive search profile. Historical v2 contexts retain their exact
 * profile and default-off algorithm; no collision or qualification limit changes. */
export const INTER_TRAY_OPENING_MANEUVER_POLICY = 'wfc.pf.inter-tray-opening-maneuvers.v1' as const;
export const INTER_TRAY_MANEUVERS_PROFILE = Object.freeze({
  policyVersion: INTER_TRAY_OPENING_MANEUVER_POLICY,
  maximumOffsetMetres: 0.1, radiiMetres: Object.freeze([0.05, 0.1] as const),
  directionVersion: 'normalized-lexicographic-26.v1', maximumEdgeAttempts: 64, candidateCount: 52,
  domain: 'blocked-inter-tray-chords-only', selection: 'legacy-clear-graph-first-lazy-selected-path.v1',
} as const);
export const MIXED_BARRIER_OPENING_RUNTIME_PROFILE = Object.freeze({ ...MIXED_BARRIER_RUNTIME_PROFILE,
  schemaVersion: 'wfc.pf.barrier-runtime-profile.v3', interTrayManeuvers: INTER_TRAY_MANEUVERS_PROFILE } as const);
export const mixedBarrierOpeningRuntimeProfileSchema = mixedBarrierRuntimeProfileSchema.extend({
  schemaVersion: z.literal(MIXED_BARRIER_OPENING_RUNTIME_PROFILE.schemaVersion),
  interTrayManeuvers: z.object({ policyVersion: z.literal(INTER_TRAY_OPENING_MANEUVER_POLICY),
    maximumOffsetMetres: z.literal(0.1), radiiMetres: z.tuple([z.literal(0.05), z.literal(0.1)]),
    directionVersion: z.literal(INTER_TRAY_MANEUVERS_PROFILE.directionVersion), maximumEdgeAttempts: z.literal(64), candidateCount: z.literal(52),
    domain: z.literal(INTER_TRAY_MANEUVERS_PROFILE.domain), selection: z.literal(INTER_TRAY_MANEUVERS_PROFILE.selection),
  }).strict(),
}).strict();
export const mixedBarrierSupportedRuntimeProfileSchema = z.union([mixedBarrierRuntimeProfileSchema, mixedBarrierOpeningRuntimeProfileSchema]);
const blob = z.object({ blobId: uuid, sha256: hash, bytes: positive(BARRIER_LIMITS.captureBytes) }).strict();
export const mixedBarrierRuntimeContextSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-runtime.v2'), binding: mixedBarrierCalculationBindingSchema,
  profile: mixedBarrierSupportedRuntimeProfileSchema, profileSha256: hash,
  storage: z.object({ intentId: uuid, manifest: blob, capture: blob.nullable() }).strict().nullable() }).strict().superRefine((value, context) => {
  const snapshot = value.binding.snapshot;
  if (!snapshot ? !value.binding.policy.drillThroughWalls || value.storage !== null
    : !value.storage || value.storage.manifest.bytes > BARRIER_LIMITS.manifestBytes || (snapshot.mode === 'mixed-mesh-set') !== (value.storage.capture !== null))
    issue(context, 'Mixed runtime must retain bounded exact stored originals, or an explicit unpublished drilling bypass.');
  if (value.binding.policy.numericToleranceMetres !== value.profile.qualification.numericToleranceMetres) issue(context, 'Base numeric policy must match the frozen profile.');
  if (size(value) > BARRIER_LIMITS.controlBytes) issue(context, 'Mixed runtime exceeds its fixed control-message budget.');
});
export type MixedBarrierRuntimeContext = z.infer<typeof mixedBarrierRuntimeContextSchema>;

const blocking = mixedBarrierComponentMembershipSchema.extend({ segmentIndex: count(BARRIER_LIMITS.routeSegments - 1),
  reason: z.enum(['original-surface-contact', 'qualified-solid-contact-or-containment']), surfaceWitness: z.null() }).strict()
  .refine(value => (value.kind === 'original-surface') === (value.reason === 'original-surface-contact'));
export const mixedBarrierCheckProofSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-mixed-check-proof.v2'),
  binding: mixedBarrierCalculationBindingSchema, routeSha256: hash, status: z.enum(['clear-selected-scope', 'blocked', 'indeterminate', 'bypassed', 'unavailable', 'no-barriers-declared']),
  routePointCount: positive(BARRIER_LIMITS.routeSegments + 1), totalSegments: positive(BARRIER_LIMITS.routeSegments), checkedSegments: count(BARRIER_LIMITS.routeSegments),
  blocking: blocking.nullable(), failedSegmentIndex: count(BARRIER_LIMITS.routeSegments - 1).nullable(), reasonCode,
  domain: z.literal(MIXED_BARRIER_QUERY_DOMAIN), coverage: z.literal('registered-selected-objects-only'), globalModelCoverageVerified: z.literal(false),
  physicalCableRadiusChecked: z.literal(false), ...noAuthority,
}).strict().superRefine((value, context) => {
  const { policy, snapshot } = value.binding;
  if (value.totalSegments !== Math.max(1, value.routePointCount - 1) || value.checkedSegments > value.totalSegments
    || value.status !== 'blocked' && value.blocking !== null || value.status !== 'indeterminate' && value.failedSegmentIndex !== null) issue(context, 'Exact ordered checks cannot invent progress or witnesses.');
  if (value.status === 'clear-selected-scope' && (policy.drillThroughWalls || snapshot?.mode !== 'mixed-mesh-set' || value.checkedSegments !== value.totalSegments || value.reasonCode !== 'REGISTERED_SCOPE_CLEAR')) issue(context, 'Clear requires every original surface-contact and qualified-solid occupancy check.');
  if (value.status === 'blocked' && (policy.drillThroughWalls || snapshot?.mode !== 'mixed-mesh-set' || !value.blocking || value.blocking.segmentIndex >= value.totalSegments || value.checkedSegments !== value.blocking.segmentIndex + 1 || value.reasonCode !== 'REGISTERED_BARRIER_INTERSECTION')) issue(context, 'Blocked needs exact component membership and ordered query index.');
  if (value.status === 'indeterminate' && (policy.drillThroughWalls || snapshot?.mode !== 'mixed-mesh-set' || value.failedSegmentIndex === null || value.failedSegmentIndex >= value.totalSegments || value.failedSegmentIndex !== value.checkedSegments || value.reasonCode !== 'BARRIER_QUERY_INDETERMINATE')) issue(context, 'Indeterminate follows the exact conclusive prefix and grants no authority.');
  if (value.status === 'bypassed' && (!policy.drillThroughWalls || value.checkedSegments !== 0 || value.reasonCode !== 'EXPLICIT_DRILLING_BYPASS')) issue(context, 'Explicit drilling is bypassed, never geometrically clear.');
  if (value.status === 'no-barriers-declared' && (policy.drillThroughWalls || snapshot?.mode !== 'explicit-empty' || value.checkedSegments !== 0 || value.reasonCode !== 'EXPLICIT_EMPTY_SCOPE')) issue(context, 'An explicit empty publication is separate from mixed geometry checks.');
  if (value.status === 'unavailable' && (value.checkedSegments !== 0 || ['REGISTERED_SCOPE_CLEAR', 'REGISTERED_BARRIER_INTERSECTION', 'BARRIER_QUERY_INDETERMINATE', 'EXPLICIT_DRILLING_BYPASS', 'EXPLICIT_EMPTY_SCOPE'].includes(value.reasonCode))) issue(context, 'Unavailable cannot claim a physical or bypassed check.');
});
export type MixedBarrierCheckProof = z.infer<typeof mixedBarrierCheckProofSchema>;

export const mixedBarrierDirectSecondarySchema = z.object({ schemaVersion: z.literal('wfc.pf.mixed-constrained-direct-secondary.v2'),
  distanceDecision: directSecondaryDecisionSchema, binding: mixedBarrierCalculationBindingSchema, directRouteSha256: hash,
  mode: z.enum(['direct-secondary', 'tray-network']), directCheck: mixedBarrierCheckProofSchema.nullable(),
  reasonCode: z.enum(['DISTANCE_NOT_QUALIFIED', 'DIRECT_SECONDARY_CLEAR', 'DIRECT_SECONDARY_DRILLING_BYPASS', 'DIRECT_SECONDARY_EXPLICIT_EMPTY_SCOPE',
    'DIRECT_SECONDARY_BLOCKED_TRAY_FALLBACK', 'DIRECT_SECONDARY_INDETERMINATE_TRAY_FALLBACK', 'DIRECT_SECONDARY_UNAVAILABLE_TRAY_FALLBACK']) }).strict().superRefine((value, context) => {
  if (value.distanceDecision.mode !== 'direct-secondary') {
    if (value.mode !== 'tray-network' || value.directCheck !== null || value.reasonCode !== 'DISTANCE_NOT_QUALIFIED') issue(context, 'Distance-ineligible candidates retain the tray attempt.'); return;
  }
  const check = value.directCheck;
  if (!check || !same(check.binding, value.binding) || check.routeSha256 !== value.directRouteSha256 || check.routePointCount !== (value.distanceDecision.distanceMeters === 0 ? 1 : 2)) { issue(context, 'Direct strategy needs exact mixed binding, route and point-count proof.'); return; }
  const choices = { 'clear-selected-scope': ['direct-secondary', 'DIRECT_SECONDARY_CLEAR'], bypassed: ['direct-secondary', 'DIRECT_SECONDARY_DRILLING_BYPASS'],
    'no-barriers-declared': ['direct-secondary', 'DIRECT_SECONDARY_EXPLICIT_EMPTY_SCOPE'], blocked: ['tray-network', 'DIRECT_SECONDARY_BLOCKED_TRAY_FALLBACK'],
    indeterminate: ['tray-network', 'DIRECT_SECONDARY_INDETERMINATE_TRAY_FALLBACK'], unavailable: ['tray-network', 'DIRECT_SECONDARY_UNAVAILABLE_TRAY_FALLBACK'] } as const;
  const [mode, reason] = choices[check.status]; if (value.mode !== mode || value.reasonCode !== reason
    || value.binding.policy.drillThroughWalls && check.status !== 'bypassed') issue(context, 'Blocked/uncertain direct candidates retain a constrained tray fallback; explicit drilling retains a bypassed direct candidate.');
});
const canonicalWork = (value: string) => /^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(value) && value.length <= 19 && BigInt(value) <= 9223372036854775807n;
const work = z.string().max(19).refine(canonicalWork);
const connector = z.object({ policyVersion: z.literal(BARRIER_RUNTIME_PROFILE.localConnectors.policyVersion), status: z.enum(['clear', 'blocked', 'indeterminate', 'search-incomplete']),
  reasonCode, points: z.array(barrierPointSchema).max(BARRIER_LIMITS.routeSegments + 1), lengthMeters: z.number().finite().nonnegative(), directDistanceMeters: z.number().finite().nonnegative(),
  isDetour: z.boolean(), searchComplete: z.boolean(), domain: z.object({ minimum: barrierPointSchema, maximum: barrierPointSchema, stepMeters: z.literal(0.25) }).strict().refine(value => value.minimum.every((coordinate, index) => coordinate <= value.maximum[index])),
  edgeChecks: count(16384), queries: count(100000), work }).strict();
export const mixedBarrierExecutionSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-execution.v2'), context: mixedBarrierRuntimeContextSchema,
  proof: mixedBarrierCheckProofSchema.nullable(), directSecondary: mixedBarrierDirectSecondarySchema.nullable(),
  diagnostics: z.object({ status: z.enum(['clear', 'blocked', 'indeterminate', 'search-incomplete', 'bypassed', 'unavailable', 'no-barriers-declared']), reasonCode,
    searchComplete: z.boolean(), candidatesTruncated: z.boolean(), pairAttempts: count(64), collisionQueries: count(100000), work,
    plannerAttempts: count(8), straightPairAttempts: count(64), localEdgeChecks: count(16384), localPhaseUsed: z.boolean(), straightPhaseTruncated: z.boolean() }).strict(),
  connectors: z.object({ from: connector.nullable(), to: connector.nullable() }).strict(),
  qualification: z.object({ captureSha256: hash, evidence: mixedBarrierVerifierEvidenceSchema }).strict().nullable(), ...noAuthority,
}).strict().superRefine((value, context) => {
  if (value.proof && !same(value.proof.binding, value.context.binding) || value.directSecondary && !same(value.directSecondary.binding, value.context.binding)) issue(context, 'Every result retains its exact admitted mixed binding.');
  if (value.qualification && (value.qualification.captureSha256 !== value.context.storage?.capture?.sha256 || value.qualification.evidence.captureId !== value.context.storage?.intentId
    || !same(value.qualification.evidence.scope, value.context.binding.scope))) issue(context, 'Qualification retains the exact stored capture and model/frame scope.');
  const outcomes = { 'clear-selected-scope': 'clear', blocked: 'blocked', indeterminate: 'indeterminate', bypassed: 'bypassed', unavailable: 'unavailable', 'no-barriers-declared': 'no-barriers-declared' } as const;
  if (value.proof && outcomes[value.proof.status] !== value.diagnostics.status) issue(context, 'Final proof and diagnostics must agree.');
  if (['clear', 'bypassed', 'no-barriers-declared'].includes(value.diagnostics.status) && (!value.proof || !canonicalWork(value.diagnostics.work)
    || BigInt(value.diagnostics.work) > BigInt(BARRIER_RUNTIME_PROFILE.routing.maxWork))) issue(context, 'Success requires its exact final proof within unchanged work bounds.');
  if (value.proof && ['clear-selected-scope', 'blocked', 'indeterminate'].includes(value.proof.status) && !value.qualification) issue(context, 'Physical mixed checks require actual qualification evidence and original membership.');
  if (value.proof?.blocking && value.qualification && !value.qualification.evidence.componentMemberships.some(row => same(row, (() => { const { segmentIndex: _i, reason: _r, surfaceWitness: _w, ...member } = value.proof!.blocking!; return member; })()))) issue(context, 'A blocking component must be an exact original-derived qualification member.');
  for (const plan of [value.connectors.from, value.connectors.to]) if (plan && (plan.status !== 'clear' || plan.points.length < 1 || !plan.searchComplete)) issue(context, 'Retained successful connectors cannot be unresolved or partial.');
});
export type MixedBarrierExecution = z.infer<typeof mixedBarrierExecutionSchema>;

export const mixedBarrierWriteEvidenceSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-write-evidence.v2'),
  dependencyVersion: z.literal('pathfinder.dependencies.v8'), responseVersion: z.literal('pathfinder.model.response.v3'),
  projectId: uuid, cableId: uuid, dependencySha256: hash, engineIdentitySha256: hash, engineResultSha256: hash, contextSha256: hash, executionSha256: hash,
  routeSha256: hash, policySha256: hash, profileSha256: hash, registryRevision: revision, snapshotId: uuid.nullable(), snapshotSha256: hash.nullable(),
  drillThroughWalls: z.boolean(), status: z.enum(['clear', 'bypassed', 'no-barriers-declared']), geometryPolicy: z.literal(MIXED_BARRIER_POLICY), ownTerminalExemptionsSupported: z.literal(false),
}).strict().superRefine((value, context) => {
  if ((value.snapshotId === null) !== (value.snapshotSha256 === null) || (value.status === 'bypassed') !== value.drillThroughWalls || value.status !== 'bypassed' && value.snapshotId === null) issue(context, 'Writes retain an exact publication or explicit drilling bypass; these hashes confer no geometric authority.');
});
const mixedIdentityPolicies = barrierEngineIdentityBodySchema.shape.policyVersions.omit({ projection: true, barriers: true, qualification: true, runtimeProfile: true }).extend({
    projection: z.literal('wfc.pf.model-runner-v3-mixed-barrier-projection.v1'), barriers: z.literal(MIXED_BARRIER_COLLISION_VERSION),
    qualification: z.literal(MIXED_BARRIER_VERIFIER_VERSION), runtimeProfile: z.literal(MIXED_BARRIER_RUNTIME_PROFILE.schemaVersion), geometryPolicy: z.literal(MIXED_BARRIER_POLICY),
  }).strict();
const mixedOpeningIdentityPolicies = mixedIdentityPolicies.extend({ runtimeProfile: z.literal(MIXED_BARRIER_OPENING_RUNTIME_PROFILE.schemaVersion),
  interTrayManeuvers: z.literal(INTER_TRAY_OPENING_MANEUVER_POLICY) }).strict();
const mixedIdentityBody = barrierEngineIdentityBodySchema.omit({ schemaVersion: true, policyVersions: true }).extend({ schemaVersion: z.literal('wfc.pf.engine-identity.v3'),
  policyVersions: z.union([mixedIdentityPolicies, mixedOpeningIdentityPolicies]) }).strict();
export const mixedBarrierEngineIdentityBodySchema = mixedIdentityBody;
export const mixedBarrierEngineIdentitySchema = mixedIdentityBody.extend({ contentSha256: hash }).strict();
export type MixedBarrierCaptureCommand = z.infer<typeof mixedBarrierCaptureCommandSchema>;
export type MixedBarrierSnapshotReference = z.infer<typeof mixedBarrierSnapshotReferenceSchema>;
export type MixedBarrierRegistry = z.infer<typeof mixedBarrierRegistrySchema>;
export type MixedBarrierAdmissionIntent = z.infer<typeof mixedBarrierAdmissionIntentSchema>;
export type MixedBarrierRoutingPolicy = z.infer<typeof mixedBarrierRoutingPolicySchema>;
export type MixedBarrierRuntimeProfile = z.infer<typeof mixedBarrierRuntimeProfileSchema>;
export type MixedBarrierOpeningRuntimeProfile = z.infer<typeof mixedBarrierOpeningRuntimeProfileSchema>;
export type MixedBarrierSupportedRuntimeProfile = z.infer<typeof mixedBarrierSupportedRuntimeProfileSchema>;
export type MixedBarrierVerifierEvidence = z.infer<typeof mixedBarrierVerifierEvidenceSchema>;
export type MixedBarrierWriteEvidence = z.infer<typeof mixedBarrierWriteEvidenceSchema>;
export type MixedBarrierEngineIdentityBody = z.infer<typeof mixedBarrierEngineIdentityBodySchema>;
export type MixedBarrierEngineIdentity = z.infer<typeof mixedBarrierEngineIdentitySchema>;

export function createMixedBarrierAdmissionIntent(registry: unknown, drillThroughWalls: boolean): MixedBarrierAdmissionIntent | null {
  if (typeof drillThroughWalls !== 'boolean') return null;
  const current = mixedBarrierRegistrySchema.safeParse(registry);
  if (!current.success || current.data.state !== 'ready' && !(current.data.state === 'unconfigured' && drillThroughWalls)) return null;
  const value = mixedBarrierAdmissionIntentSchema.safeParse({ schemaVersion: 'wfc.pf.barrier-admission-intent.v2', geometryPolicy: MIXED_BARRIER_POLICY,
    scope: current.data.scope, expectedRegistryRevision: current.data.registryRevision, expectedSnapshot: current.data.snapshot, drillThroughWalls });
  return value.success ? value.data : null;
}
export function sameMixedBarrierAdmissionIntent(left: unknown, right: unknown): boolean {
  if (left === undefined && right === undefined) return true;
  const first = mixedBarrierAdmissionIntentSchema.safeParse(left), last = mixedBarrierAdmissionIntentSchema.safeParse(right);
  return first.success && last.success && same(first.data, last.data);
}

/** No retained policy gets a default. Fresh UI state may separately start false. */
export function createMixedBarrierRuntimePolicy(drillThroughWalls: boolean): MixedBarrierRoutingPolicy {
  if (typeof drillThroughWalls !== 'boolean') throw Error('An explicit drilling choice is required.');
  return { schemaVersion: 'wfc.pf.barrier-routing-policy.v2', policyVersion: MIXED_BARRIER_POLICY, collisionVersion: MIXED_BARRIER_COLLISION_VERSION,
    drillThroughWalls, numericToleranceMetres: MIXED_BARRIER_RUNTIME_PROFILE.qualification.numericToleranceMetres,
    physicalClearance: { mode: 'centreline-only', radiusMetres: 0, diameterSource: 'not-qualified' }, ownTerminalExemptionsSupported: false };
}

export function mixedBarrierSnapshotHashInput(value: MixedBarrierSnapshot) { const { contentSha256: _digest, ...body } = mixedBarrierSnapshotSchema.parse(value); return body; }
export function verifyMixedBarrierSnapshot(value: unknown, hashCanonical: (value: string) => string): value is MixedBarrierSnapshot {
  const parsed = mixedBarrierSnapshotSchema.safeParse(value); try { return parsed.success && hashCanonical(barrierCanonicalJson(mixedBarrierSnapshotHashInput(parsed.data))) === parsed.data.contentSha256; } catch { return false; }
}
export function verifyMixedBarrierRuntimeContext(value: unknown, hashCanonical: (value: string) => string): value is MixedBarrierRuntimeContext {
  const parsed = mixedBarrierRuntimeContextSchema.safeParse(value); try { return parsed.success && hashCanonical(barrierCanonicalJson(parsed.data.profile)) === parsed.data.profileSha256 && hashCanonical(barrierCanonicalJson(parsed.data.binding.policy)) === parsed.data.binding.policySha256; } catch { return false; }
}
export function verifyMixedBarrierCheckProof(value: unknown, expected: { binding: MixedBarrierCalculationBinding; routeSha256: string; routePointCount: number; componentMemberships: readonly MixedBarrierComponentMembership[] }, hashCanonical: (value: string) => string): value is MixedBarrierCheckProof {
  const proof = mixedBarrierCheckProofSchema.safeParse(value), binding = mixedBarrierCalculationBindingSchema.safeParse(expected.binding);
  const members = z.array(mixedBarrierComponentMembershipSchema).max(BARRIER_LIMITS.computationalMeshes).refine(rows => unique(rows.map(row => row.componentId))).safeParse(expected.componentMemberships);
  try { return proof.success && binding.success && members.success && hash.safeParse(expected.routeSha256).success
    && positive(BARRIER_LIMITS.routeSegments + 1).safeParse(expected.routePointCount).success && same(proof.data.binding, binding.data)
    && hashCanonical(barrierCanonicalJson(binding.data.policy)) === binding.data.policySha256 && proof.data.routeSha256 === expected.routeSha256 && proof.data.routePointCount === expected.routePointCount
    && (!['clear-selected-scope', 'blocked', 'indeterminate'].includes(proof.data.status) || members.data.length > 0)
    && (!proof.data.blocking || members.data.some(row => same(row, (() => { const { segmentIndex: _i, reason: _r, surfaceWitness: _w, ...member } = proof.data.blocking!; return member; })()))); } catch { return false; }
}
export function verifyMixedBarrierExecutionRoute(value: unknown, expected: { context: MixedBarrierRuntimeContext; points: readonly (readonly number[])[];
  componentMemberships: readonly MixedBarrierComponentMembership[]; qualificationEvidence: MixedBarrierVerifierEvidence | null }, hashCanonical: (value: string) => string): value is MixedBarrierExecution {
  const parsed = mixedBarrierExecutionSchema.safeParse(value); try { return parsed.success && parsed.data.proof !== null
    && ['clear', 'bypassed', 'no-barriers-declared'].includes(parsed.data.diagnostics.status) && same(parsed.data.context, expected.context)
    && verifyMixedBarrierRuntimeContext(parsed.data.context, hashCanonical)
    && same(parsed.data.qualification?.evidence ?? null, expected.qualificationEvidence)
    && same(parsed.data.qualification?.evidence.componentMemberships ?? [], expected.componentMemberships)
    && verifyMixedBarrierCheckProof(parsed.data.proof, { binding: expected.context.binding, routeSha256: hashCanonical(barrierCanonicalJson(barrierRouteHashInput(expected.points))), routePointCount: expected.points.length, componentMemberships: expected.componentMemberships }, hashCanonical); } catch { return false; }
}
export function verifyMixedBarrierEngineIdentity(value: unknown, hashCanonical: (value: string) => string): value is z.infer<typeof mixedBarrierEngineIdentitySchema> {
  const parsed = mixedBarrierEngineIdentitySchema.safeParse(value); try { if (!parsed.success) return false; const { contentSha256, ...body } = parsed.data; return hashCanonical(barrierCanonicalJson(body)) === contentSha256; } catch { return false; }
}
