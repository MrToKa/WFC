import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BARRIER_LIMITS, barrierAdmissionPolicySchema, barrierCalculationBindingSchema, barrierCanonicalJson, barrierCaptureCommandSchema,
  barrierCaptureSchema, barrierCheckProofSchema, barrierRegistryCommandSchema, barrierRegistrySchema, barrierRoutingPolicySchema,
  barrierSnapshotReferenceSchema, barrierSnapshotSchema } from './pathfinderBarriers.js';
import { barrierAdmissionIntentSchema } from './pathfinderBarrierAdmission.js';
import { barrierCheckProofV2Schema, constrainedDirectSecondaryDecisionSchema } from './pathfinderBarrierDecisions.js';
import { barrierExecutionSchema, barrierRouteHashInput, barrierRuntimeContextSchema, barrierRuntimeProfileSchema } from './pathfinderBarrierRuntime.js';
import { barrierEngineIdentitySchema, BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS, ENGINE_IDENTITY_VERSION } from './pathfinderEngineIdentity.js';
import { barrierWriteEvidenceSchema } from './pathfinderBarrierWrites.js';
import { barrierPublicationReceiptSchema } from './pathfinderBarrierOutcomes.js';
import * as mixed from './pathfinderBarrierMixed.js';

const id = (n: number) => `b9000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const h = (c = 'a') => c.repeat(64);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => hash(barrierCanonicalJson(value));
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const scope = () => ({ projectId: id(1), modelVersionId: id(2), contentFingerprint: h(), selectionRevision: '3',
  captureFrameId: id(3), captureFrameSha256: h('b'), coordinateFrame: 'canonical-world-metres' as const });
const parent = () => ({ selectionId: id(4), kind: 'floor' as const, objectId: 'dbid:7', dbId: 7, externalId: null, name: 'Original floor',
  identityBasis: 'version-local-only' as const, inclusion: 'own-and-all-descendant-fragments' as const });
const source = () => ({ fragmentId: 9, ownerObjectId: 'dbid:7', parentSelectionIds: [id(4)], sourceUnits: 'm', metresPerSourceUnit: 1,
  sourceToWorldMetres: [...matrix], transformSha256: digest(matrix) });
function capture() { return { schemaVersion: 'wfc.pf.barrier-capture.v1' as const, captureId: id(8), scope: scope(), selectedParents: [parent()],
  fragments: [{ source: source(), bounds: { minimum: [0, 0, 0], maximum: [1, 1, 0] }, verticesMetres: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangleIndices: [0, 1, 2] }],
  observation: { state: 'reported-complete' as const, verification: 'unverified' as const, enumeratedFragmentIds: [9], unavailableFragmentIds: [], enumerationSha256: h('c') } }; }
function member() { return { componentId: 'component-0', kind: 'original-surface' as const, fragmentIds: [9], parentSelectionIds: [id(4)], triangleCount: 1,
  sourceMembershipSha256: digest(mixed.mixedBarrierComponentMembershipHashInput({ captureSha256: digest(capture()), componentId: 'component-0', kind: 'original-surface',
    triangles: [{ fragmentId: 9, localTriangleIndex: 0, originalVertexIndices: [0, 1, 2], ownerObjectId: 'dbid:7', parentSelectionIds: [id(4)] }] })) }; }
function evidence(): mixed.MixedBarrierVerifierEvidence { return { captureId: id(8), scope: scope(), originalSurfaceComponents: 1, qualifiedClosedSolidComponents: 0,
  fragmentCount: 1, vertexCount: 3, triangleCount: 1, originalGeometrySha256: h('d'), verificationSha256: h('e'), numericToleranceMetres: 1e-7,
  componentMemberships: [member()], inputSchemaVersion: 'wfc.pf.barrier-capture.v1', policyVersion: mixed.MIXED_BARRIER_POLICY,
  coverage: 'provided-fragments-only', geometryProvenance: 'capture-bound-provided-original-triangles', sdkCoverageVerified: false,
  sdkSourceBytesVerified: false, currentFrameVerified: false, engineeringAccepted: false, ownTerminalExemptionsSupported: false, authority: 'none' }; }
function receipt() { return { schemaVersion: 'wfc.pf.barrier-mixed-verification-result.v2', producerVersion: mixed.MIXED_BARRIER_VERIFIER_VERSION,
  status: 'geometry-qualified', captureSha256: digest(capture()), evidence: evidence(), diagnostics: [] }; }
function snapshot(): mixed.MixedBarrierSnapshot {
  const value = { schemaVersion: 'wfc.pf.barrier-snapshot.v2', geometryPolicy: mixed.MIXED_BARRIER_POLICY, snapshotId: id(10), scope: scope(), registryRevision: '5', contentSha256: h(), selectedParents: [parent()],
    capture: { captureId: id(8), payloadSha256: digest(capture()) }, geometry: { mode: 'mixed-mesh-set', fragments: [{ source: source(), bounds: { minimum: [0, 0, 0], maximum: [1, 1, 0] },
      mesh: { blobId: id(11), sha256: h('f'), bytes: 200 }, vertices: 3, triangles: 1 }], verification: { producerVersion: mixed.MIXED_BARRIER_VERIFIER_VERSION,
      geometryPolicy: mixed.MIXED_BARRIER_POLICY, selectionClosure: 'complete-selected-scope', verifiedCaptureSha256: digest(capture()), originalGeometrySha256: h('d'), verificationSha256: h('e'),
      componentMemberships: [member()], engineeringAccepted: false, ownTerminalExemptionsSupported: false, authority: 'none' } },
    coverage: 'registered-selected-objects-only', engineeringAccepted: false, ownTerminalExemptionsSupported: false, authority: 'none' };
  const parsed = mixed.mixedBarrierSnapshotSchema.parse(value); parsed.contentSha256 = digest(mixed.mixedBarrierSnapshotHashInput(parsed)); return parsed;
}
function reference(): mixed.MixedBarrierSnapshotReference { const value = snapshot(); return { schemaVersion: 'wfc.pf.barrier-snapshot-reference.v2', geometryPolicy: mixed.MIXED_BARRIER_POLICY,
  snapshotId: value.snapshotId, scope: value.scope, registryRevision: value.registryRevision, contentSha256: value.contentSha256, mode: value.geometry.mode }; }
function context(drill = false): mixed.MixedBarrierRuntimeContext {
  const policy = mixed.createMixedBarrierRuntimePolicy(drill);
  return { schemaVersion: 'wfc.pf.barrier-runtime.v2', binding: { schemaVersion: 'wfc.pf.barrier-calculation-binding.v2', scope: scope(), registryRevision: '5', snapshot: reference(), policy, policySha256: digest(policy) },
    profile: structuredClone(mixed.MIXED_BARRIER_RUNTIME_PROFILE), profileSha256: digest(mixed.MIXED_BARRIER_RUNTIME_PROFILE),
    storage: { intentId: id(8), manifest: { blobId: id(12), sha256: h('1'), bytes: 1000 }, capture: { blobId: id(13), sha256: digest(capture()), bytes: 2000 } } };
}
const points = [[0, 0, 1], [1, 0, 1]];
function proof(): mixed.MixedBarrierCheckProof { return { schemaVersion: 'wfc.pf.barrier-mixed-check-proof.v2', binding: context().binding,
  routeSha256: digest(barrierRouteHashInput(points)), status: 'clear-selected-scope', routePointCount: 2, totalSegments: 1, checkedSegments: 1,
  blocking: null, failedSegmentIndex: null, reasonCode: 'REGISTERED_SCOPE_CLEAR', domain: mixed.MIXED_BARRIER_QUERY_DOMAIN,
  coverage: 'registered-selected-objects-only', globalModelCoverageVerified: false, physicalCableRadiusChecked: false,
  engineeringAccepted: false, ownTerminalExemptionsSupported: false, authority: 'none' }; }
function execution(): mixed.MixedBarrierExecution { return { schemaVersion: 'wfc.pf.barrier-execution.v2', context: context(), proof: proof(), directSecondary: null,
  diagnostics: { status: 'clear', reasonCode: 'REGISTERED_SCOPE_CLEAR', searchComplete: true, candidatesTruncated: false, pairAttempts: 1, collisionQueries: 1, work: '1',
    plannerAttempts: 0, straightPairAttempts: 1, localEdgeChecks: 0, localPhaseUsed: false, straightPhaseTruncated: false }, connectors: { from: null, to: null },
  qualification: { captureSha256: digest(capture()), evidence: evidence() }, engineeringAccepted: false, ownTerminalExemptionsSupported: false, authority: 'none' }; }
function direct() { return { schemaVersion: 'wfc.pf.mixed-constrained-direct-secondary.v2', binding: context().binding, directRouteSha256: proof().routeSha256,
  distanceDecision: { schemaVersion: 'wfc.pf.direct-secondary.v1', policyVersion: 'nearest-eligible-tray-or.v1', coordinateFrame: 'canonical-world-metres', mode: 'direct-secondary',
    fromPoint: points[0], toPoint: points[1], distanceMeters: 1, nearestFromMeters: 2, nearestToMeters: 3, eligibleTrays: 1, comparison: 'both' },
  mode: 'direct-secondary', directCheck: proof(), reasonCode: 'DIRECT_SECONDARY_CLEAR' }; }
function identity() { const body = { schemaVersion: 'wfc.pf.engine-identity.v3', version: ENGINE_IDENTITY_VERSION,
  runnerSha256: h(), modelModuleSha256: h('b'), coreModuleSha256: h('c'), adapterModuleSha256: h('d'), derivationSha256: h('e'), barriersModuleSha256: h('f'), barrierVerifierModuleSha256: h('1'),
  policyVersions: { ...BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS, projection: 'wfc.pf.model-runner-v3-mixed-barrier-projection.v1', barriers: mixed.MIXED_BARRIER_COLLISION_VERSION,
    qualification: mixed.MIXED_BARRIER_VERIFIER_VERSION, runtimeProfile: mixed.MIXED_BARRIER_RUNTIME_PROFILE.schemaVersion, geometryPolicy: mixed.MIXED_BARRIER_POLICY } };
  return { ...body, contentSha256: digest(body) }; }
function writeEvidence() { return { schemaVersion: 'wfc.pf.barrier-write-evidence.v2', dependencyVersion: 'pathfinder.dependencies.v8', responseVersion: 'pathfinder.model.response.v3',
  projectId: id(1), cableId: id(14), dependencySha256: h(), engineIdentitySha256: identity().contentSha256, engineResultSha256: h('b'), contextSha256: digest(context()), executionSha256: digest(execution()),
  routeSha256: proof().routeSha256, policySha256: context().binding.policySha256, profileSha256: context().profileSha256, registryRevision: '5', snapshotId: id(10), snapshotSha256: reference().contentSha256,
  drillThroughWalls: false, status: 'clear', geometryPolicy: mixed.MIXED_BARRIER_POLICY, ownTerminalExemptionsSupported: false }; }

describe('explicit additive inter-tray maneuver profile', () => {
  const openingContext = () => mixed.mixedBarrierRuntimeContextSchema.parse({ ...context(),
    profile: structuredClone(mixed.MIXED_BARRIER_OPENING_RUNTIME_PROFILE), profileSha256: digest(mixed.MIXED_BARRIER_OPENING_RUNTIME_PROFILE) });
  const openingIdentity = () => {
    const { contentSha256: _old, ...old } = identity();
    const body = { ...old, policyVersions: { ...old.policyVersions,
      runtimeProfile: mixed.MIXED_BARRIER_OPENING_RUNTIME_PROFILE.schemaVersion, interTrayManeuvers: mixed.INTER_TRAY_OPENING_MANEUVER_POLICY } };
    return { ...body, contentSha256: digest(body) };
  };
  it('retains old profile bytes and requires the exact independently versioned opt-in object', () => {
    const old = structuredClone(mixed.MIXED_BARRIER_RUNTIME_PROFILE), current = mixed.MIXED_BARRIER_OPENING_RUNTIME_PROFILE;
    expect(mixed.mixedBarrierRuntimeProfileSchema.parse(old)).toEqual(old);
    expect(mixed.mixedBarrierRuntimeProfileSchema.safeParse(current).success).toBe(false);
    expect(mixed.mixedBarrierOpeningRuntimeProfileSchema.safeParse(old).success).toBe(false);
    expect(mixed.mixedBarrierOpeningRuntimeProfileSchema.parse(current)).toEqual(current);
    expect(current.qualification).toEqual(old.qualification); expect(current.kernel).toEqual(old.kernel);
    expect(current.routing).toEqual(old.routing); expect(current.localConnectors).toEqual(old.localConnectors);
    expect(Object.isFrozen(current.interTrayManeuvers)).toBe(true); expect(Object.isFrozen(current.interTrayManeuvers.radiiMetres)).toBe(true);
    expect(mixed.MIXED_BARRIER_RUNTIME_PROFILE).toEqual(old);
  });
  it.each([
    { maximumOffsetMetres: 0.1000000001 }, { radiiMetres: [0.1, 0.05] }, { radiiMetres: [0.05, 0.1, 0.15] },
    { maximumEdgeAttempts: 65 }, { candidateCount: 53 }, { directionVersion: 'caller-supplied' },
    { domain: 'all-tray-edges' }, { selection: 'force-reference-route' }, { policyVersion: 'unreviewed.v9' }, { ignoreBarrier: true },
  ])('rejects changed fixed maneuver policy even with a freshly recomputed context digest: %j', changed => {
    const value = openingContext();
    const profile = { ...value.profile, interTrayManeuvers: { ...mixed.INTER_TRAY_MANEUVERS_PROFILE, ...changed } };
    expect(mixed.verifyMixedBarrierRuntimeContext({ ...value, profile, profileSha256: digest(profile) }, hash)).toBe(false);
  });
  it('retains profile hash/current execution equality rather than upgrading a historical result', () => {
    const current = openingContext(), result = { ...execution(), context: current };
    expect(mixed.verifyMixedBarrierRuntimeContext(current, hash)).toBe(true);
    expect(mixed.verifyMixedBarrierRuntimeContext({ ...current, profileSha256: context().profileSha256 }, hash)).toBe(false);
    expect(mixed.verifyMixedBarrierExecutionRoute(result, { context: current, points,
      componentMemberships: evidence().componentMemberships, qualificationEvidence: evidence() }, hash)).toBe(true);
    expect(mixed.verifyMixedBarrierExecutionRoute(execution(), { context: current, points,
      componentMemberships: evidence().componentMemberships, qualificationEvidence: evidence() }, hash)).toBe(false);
  });
  it('requires the exact runtime-version and maneuver-policy identity pair while preserving the old pair', () => {
    expect(mixed.verifyMixedBarrierEngineIdentity(identity(), hash)).toBe(true);
    const current = openingIdentity(); expect(mixed.verifyMixedBarrierEngineIdentity(current, hash)).toBe(true);
    const missing = structuredClone(current); delete (missing.policyVersions as Record<string, unknown>).interTrayManeuvers;
    expect(mixed.mixedBarrierEngineIdentitySchema.safeParse(missing).success).toBe(false);
    expect(mixed.mixedBarrierEngineIdentitySchema.safeParse({ ...identity(), policyVersions: current.policyVersions }).success).toBe(true);
    expect(mixed.mixedBarrierEngineIdentitySchema.safeParse({ ...current, policyVersions: {
      ...current.policyVersions, runtimeProfile: mixed.MIXED_BARRIER_RUNTIME_PROFILE.schemaVersion } }).success).toBe(false);
    expect(mixed.mixedBarrierEngineIdentitySchema.safeParse({ ...current, policyVersions: {
      ...current.policyVersions, interTrayManeuvers: 'unreviewed.v9' } }).success).toBe(false);
    expect(mixed.verifyMixedBarrierEngineIdentity({ ...current, contentSha256: identity().contentSha256 }, hash)).toBe(false);
  });
});

describe('additive mixed lane cannot reinterpret legacy retained contracts', () => {
  const command = () => ({ schemaVersion: 'wfc.pf.barrier-capture-command.v2', geometryPolicy: mixed.MIXED_BARRIER_POLICY, scope: scope(), expectedRegistryRevision: '5', idempotencyKey: id(15), selectedParents: [parent()] });
  const registry = () => ({ schemaVersion: 'wfc.pf.barrier-registry.v2', geometryPolicy: mixed.MIXED_BARRIER_POLICY, scope: scope(), registryRevision: '5', state: 'ready', selectedParents: [parent()], snapshot: reference(), reasonCodes: [] });
  const admission = () => ({ schemaVersion: 'wfc.pf.barrier-admission-intent.v2', geometryPolicy: mixed.MIXED_BARRIER_POLICY, scope: scope(), expectedRegistryRevision: '5', expectedSnapshot: reference(), drillThroughWalls: false });
  it.each([
    ['capture command', mixed.mixedBarrierCaptureCommandSchema, barrierCaptureCommandSchema, command],
    ['registry', mixed.mixedBarrierRegistrySchema, barrierRegistrySchema, registry],
    ['snapshot', mixed.mixedBarrierSnapshotSchema, barrierSnapshotSchema, snapshot],
    ['snapshot reference', mixed.mixedBarrierSnapshotReferenceSchema, barrierSnapshotReferenceSchema, reference],
    ['admission', mixed.mixedBarrierAdmissionIntentSchema, barrierAdmissionIntentSchema, admission],
    ['routing policy', mixed.mixedBarrierRoutingPolicySchema, barrierRoutingPolicySchema, () => mixed.createMixedBarrierRuntimePolicy(false)],
    ['binding', mixed.mixedBarrierCalculationBindingSchema, barrierCalculationBindingSchema, () => context().binding],
    ['profile', mixed.mixedBarrierRuntimeProfileSchema, barrierRuntimeProfileSchema, () => mixed.MIXED_BARRIER_RUNTIME_PROFILE],
    ['runtime', mixed.mixedBarrierRuntimeContextSchema, barrierRuntimeContextSchema, context],
    ['proof', mixed.mixedBarrierCheckProofSchema, barrierCheckProofSchema, proof],
    ['direct decision', mixed.mixedBarrierDirectSecondarySchema, constrainedDirectSecondaryDecisionSchema, direct],
    ['existing shell proof', mixed.mixedBarrierCheckProofSchema, barrierCheckProofV2Schema, proof],
    ['execution', mixed.mixedBarrierExecutionSchema, barrierExecutionSchema, execution],
    ['write evidence', mixed.mixedBarrierWriteEvidenceSchema, barrierWriteEvidenceSchema, writeEvidence],
    ['engine identity', mixed.mixedBarrierEngineIdentitySchema, barrierEngineIdentitySchema, identity],
    ['publication receipt', mixed.mixedBarrierPublicationReceiptSchema, barrierPublicationReceiptSchema, () => ({ schemaVersion: 'wfc.pf.barrier-publication-receipt.v2', snapshot: reference(), duplicate: false })],
    ['fresh admission policy', mixed.mixedBarrierAdmissionPolicySchema, barrierAdmissionPolicySchema, () => ({ schemaVersion: 'wfc.pf.barrier-admission-policy.v2', geometryPolicy: mixed.MIXED_BARRIER_POLICY, drillThroughWalls: false })],
    ['registry command', mixed.mixedBarrierRegistryCommandSchema, barrierRegistryCommandSchema, () => ({ schemaVersion: 'wfc.pf.barrier-registry-command.v2', geometryPolicy: mixed.MIXED_BARRIER_POLICY, action: 'remove', scope: scope(), expectedRegistryRevision: '5', idempotencyKey: id(15), selectionIds: [id(4)] })],
  ] as const)('new %s parses only in its explicit new lane', (_name, current, old, make) => {
    const value = make(); expect(current.safeParse(value).success).toBe(true); expect(old.safeParse(value).success).toBe(false);
    expect(current.safeParse({ ...value, unreviewedAuthority: true }).success).toBe(false);
  });
  it('preserves capture.v1 observations but refuses an old pending command as mixed input', () => {
    expect(barrierCaptureSchema.safeParse(capture()).success).toBe(true);
    const { geometryPolicy: _policy, ...legacy } = command(); legacy.schemaVersion = 'wfc.pf.barrier-capture-command.v1';
    expect(barrierCaptureCommandSchema.safeParse(legacy).success).toBe(true); expect(mixed.mixedBarrierCaptureCommandSchema.safeParse(legacy).success).toBe(false);
    expect(mixed.mixedBarrierCaptureCommandSchema.safeParse({ ...command(), geometryPolicy: 'wfc.pf.registered-triangle-barriers.v1' }).success).toBe(false);
  });
});

describe('exact original membership and bounded pure mixed receipt', () => {
  it('matches the independently reproducible canonical integer/string projection and detaches source data', () => {
    const input = { captureSha256: h(), componentId: 'component-0', kind: 'original-surface' as const,
      triangles: [{ fragmentId: 9, localTriangleIndex: 0, originalVertexIndices: [0, 1, 2] as [number, number, number], ownerObjectId: 'dbid:7', parentSelectionIds: [id(4)] }] };
    const value = mixed.mixedBarrierComponentMembershipHashInput(input);
    expect(barrierCanonicalJson(value)).toBe('{"domain":"wfc.pf.mixed-original-component-membership.v2","value":{"captureSha256":"' + h() + '","componentId":"component-0","kind":"original-surface","triangles":[{"fragmentId":9,"localTriangleIndex":0,"originalVertexIndices":[0,1,2],"ownerObjectId":"dbid:7","parentSelectionIds":["' + id(4) + '"]}]}}');
    const before = structuredClone(value); input.triangles[0].originalVertexIndices[0] = 7; expect(value).toEqual(before);
  });
  it('does not hash away original winding, ownership, kind, parent or capture changes', () => {
    const base = { captureSha256: h(), componentId: 'component-0', kind: 'original-surface' as const,
      triangles: [{ fragmentId: 9, localTriangleIndex: 0, originalVertexIndices: [0, 1, 2] as [number, number, number], ownerObjectId: 'dbid:7', parentSelectionIds: [id(4)] }] };
    const wanted = digest(mixed.mixedBarrierComponentMembershipHashInput(base));
    for (const changed of [{ ...base, captureSha256: h('b') }, { ...base, kind: 'qualified-closed-solid' as const },
      { ...base, triangles: [{ ...base.triangles[0], originalVertexIndices: [0, 2, 1] as [number, number, number] }] },
      { ...base, triangles: [{ ...base.triangles[0], ownerObjectId: 'dbid:8' }] }, { ...base, triangles: [{ ...base.triangles[0], parentSelectionIds: [id(5)] }] }])
      expect(digest(mixed.mixedBarrierComponentMembershipHashInput(changed))).not.toBe(wanted);
    expect(() => mixed.mixedBarrierComponentMembershipHashInput({ ...base, triangles: [base.triangles[0], base.triangles[0]] })).toThrow();
  });
  it('sorts hash projection rows and parents but requires emitted component membership to be canonical', () => {
    const first = { fragmentId: 1, localTriangleIndex: 0, originalVertexIndices: [0, 1, 2] as [number, number, number], ownerObjectId: 'dbid:7', parentSelectionIds: [id(4), id(5)] };
    const last = { ...first, fragmentId: 9, parentSelectionIds: [id(5), id(4)] };
    const input = { captureSha256: h(), componentId: 'component-0', kind: 'original-surface' as const, triangles: [last, first] };
    const sorted = mixed.mixedBarrierComponentMembershipHashInput(input);
    expect(sorted.value.triangles.map(row => row.fragmentId)).toEqual([1, 9]);
    expect(sorted.value.triangles[1].parentSelectionIds).toEqual([id(4), id(5)]);
    expect(mixed.mixedBarrierComponentMembershipSchema.safeParse({ ...member(), fragmentIds: [9, 1] }).success).toBe(false);
    expect(mixed.mixedBarrierComponentMembershipSchema.safeParse({ ...member(), parentSelectionIds: [id(5), id(4)] }).success).toBe(false);
  });
  it('refuses an excessive materialized hash projection before cloning triangle rows', () => {
    const row = { fragmentId: 9, localTriangleIndex: 0, originalVertexIndices: [0, 1, 2] as [number, number, number], ownerObjectId: 'dbid:7', parentSelectionIds: [id(4)] };
    expect(() => mixed.mixedBarrierComponentMembershipHashInput({ captureSha256: h(), componentId: 'component-0', kind: 'original-surface',
      triangles: Array.from({ length: 65000 }, () => row) })).toThrow('MIXED_MEMBERSHIP_PROJECTION_LIMIT');
  });
  it('keeps explicit open-surface and qualified-solid counts and all false authority flags', () => {
    expect(mixed.mixedBarrierVerifierReceiptSchema.safeParse(receipt()).success).toBe(true);
    for (const key of ['sdkCoverageVerified', 'sdkSourceBytesVerified', 'currentFrameVerified', 'engineeringAccepted', 'ownTerminalExemptionsSupported']) {
      const value = receipt(); (value.evidence as unknown as Record<string, unknown>)[key] = true; expect(mixed.mixedBarrierVerifierReceiptSchema.safeParse(value).success).toBe(false);
    }
    for (const patch of [{ originalSurfaceComponents: 0 }, { qualifiedClosedSolidComponents: 1 }, { triangleCount: 2 }, { fragmentCount: 2 }, { authority: 'ready' }])
      expect(mixed.mixedBarrierVerifierReceiptSchema.safeParse({ ...receipt(), evidence: { ...evidence(), ...patch } }).success).toBe(false);
  });
  it('refuses an oversized original membership receipt without truncating or raising limits', () => {
    const value = receipt(); value.evidence.componentMemberships = Array.from({ length: 20 }, (_, at) => ({ ...member(), componentId: 'component-' + at, parentSelectionIds: Array.from({ length: 128 }, (_, n) => id(100 + n)) }));
    value.evidence.originalSurfaceComponents = 20; value.evidence.triangleCount = 20;
    expect(new TextEncoder().encode(barrierCanonicalJson(value)).length).toBeGreaterThan(BARRIER_LIMITS.controlBytes);
    expect(mixed.mixedBarrierVerifierReceiptSchema.safeParse(value).success).toBe(false);
    expect(mixed.mixedBarrierVerifierReceiptSchema.safeParse({ ...receipt(), status: 'refused', evidence: null }).success).toBe(true);
  });
});

describe('scope, frozen limits, final route and original evidence stay exact', () => {
  it('checks snapshot hashes and refuses changed or invented original parent membership', () => {
    expect(mixed.verifyMixedBarrierSnapshot(snapshot(), hash)).toBe(true);
    const changed = snapshot(); changed.contentSha256 = h(); expect(mixed.verifyMixedBarrierSnapshot(changed, hash)).toBe(false);
    const foreign = snapshot(); if (foreign.geometry.mode !== 'mixed-mesh-set') throw Error('fixture'); foreign.geometry.verification.componentMemberships[0].fragmentIds = [99];
    expect(mixed.mixedBarrierSnapshotSchema.safeParse(foreign).success).toBe(false);
  });
  it('keeps exact profile and policy hashes, explicit drilling and no physical-radius/terminal override', () => {
    expect(mixed.verifyMixedBarrierRuntimeContext(context(), hash)).toBe(true);
    const altered = context(); altered.profileSha256 = h(); expect(mixed.verifyMixedBarrierRuntimeContext(altered, hash)).toBe(false);
    const raw = structuredClone(context()) as unknown as { profile: { kernel: { maximumBvhNodes: number } }; profileSha256: string };
    raw.profile.kernel.maximumBvhNodes++; raw.profileSha256 = digest(raw.profile); expect(mixed.mixedBarrierRuntimeContextSchema.safeParse(raw).success).toBe(false);
    const drill = context(); drill.binding.policy.drillThroughWalls = true; expect(mixed.verifyMixedBarrierRuntimeContext(drill, hash)).toBe(false);
    drill.binding.policySha256 = digest(drill.binding.policy); expect(mixed.verifyMixedBarrierRuntimeContext(drill, hash)).toBe(true);
    expect(() => mixed.createMixedBarrierRuntimePolicy(undefined as unknown as boolean)).toThrow();
    expect(mixed.mixedBarrierRoutingPolicySchema.safeParse({ ...mixed.createMixedBarrierRuntimePolicy(false), ownTerminalExemptionsSupported: true }).success).toBe(false);
  });
  it('rejects a foreign model/frame or registry reference in a current binding', () => {
    for (const key of ['projectId', 'modelVersionId', 'captureFrameId']) { const value = context(); if (!value.binding.snapshot) throw Error('fixture'); (value.binding.snapshot.scope as unknown as Record<string, unknown>)[key] = id(99); expect(mixed.mixedBarrierRuntimeContextSchema.safeParse(value).success).toBe(false); }
    const value = context(); if (!value.binding.snapshot) throw Error('fixture'); value.binding.snapshot.registryRevision = '6'; expect(mixed.mixedBarrierRuntimeContextSchema.safeParse(value).success).toBe(false);
  });
  it('does not silently drop stale/invalid mixed registrations even when drilling is chosen', () => {
    const registry = { schemaVersion: 'wfc.pf.barrier-registry.v2', geometryPolicy: mixed.MIXED_BARRIER_POLICY, scope: scope(), registryRevision: '5', state: 'ready', selectedParents: [parent()], snapshot: reference(), reasonCodes: [] };
    expect(mixed.createMixedBarrierAdmissionIntent(registry, false)).not.toBeNull();
    expect(mixed.createMixedBarrierAdmissionIntent({ ...registry, state: 'stale', reasonCodes: ['STALE_SCOPE'] }, true)).toBeNull();
    expect(mixed.sameMixedBarrierAdmissionIntent(mixed.createMixedBarrierAdmissionIntent(registry, false), mixed.createMixedBarrierAdmissionIntent(registry, true))).toBe(false);
    expect(mixed.sameMixedBarrierAdmissionIntent(undefined, undefined)).toBe(true); expect(mixed.sameMixedBarrierAdmissionIntent(null, null)).toBe(false);
  });
  it('keeps an explicit empty publication separate from unchecked drilling', () => {
    const empty = mixed.mixedBarrierSnapshotSchema.parse({ ...snapshot(), selectedParents: [], capture: null,
      geometry: { mode: 'explicit-empty', declarationId: id(20), declaration: 'administrator-declared-no-selected-barriers', reason: 'No selected barriers' } });
    const runtime = context(); runtime.binding.snapshot = { ...reference(), mode: 'explicit-empty' }; if (!runtime.storage) throw Error('fixture'); runtime.storage.capture = null;
    expect(mixed.mixedBarrierRuntimeContextSchema.safeParse(runtime).success).toBe(true);
    const checked = proof(); checked.binding = runtime.binding; checked.status = 'no-barriers-declared'; checked.reasonCode = 'EXPLICIT_EMPTY_SCOPE'; checked.checkedSegments = 0;
    expect(mixed.mixedBarrierCheckProofSchema.safeParse(checked).success).toBe(true); expect(empty.geometry.mode).toBe('explicit-empty');
    const bypass = context(true); bypass.binding.snapshot = null; bypass.storage = null;
    expect(mixed.mixedBarrierRuntimeContextSchema.safeParse(bypass).success).toBe(true);
    const bypassProof = proof(); bypassProof.binding = bypass.binding; bypassProof.status = 'bypassed'; bypassProof.reasonCode = 'EXPLICIT_DRILLING_BYPASS'; bypassProof.checkedSegments = 0;
    expect(mixed.mixedBarrierCheckProofSchema.safeParse(bypassProof).success).toBe(true);
    expect(mixed.mixedBarrierCheckProofSchema.safeParse({ ...bypassProof, status: 'clear-selected-scope', reasonCode: 'REGISTERED_SCOPE_CLEAR', checkedSegments: 1 }).success).toBe(false);
  });
  it('validates only the explicit bypass outcome without qualifying stored mixed geometry', () => {
    const value = execution(); value.context = context(true); value.qualification = null;
    if (!value.proof) throw Error('fixture'); value.proof.binding = value.context.binding; value.proof.status = 'bypassed';
    value.proof.reasonCode = 'EXPLICIT_DRILLING_BYPASS'; value.proof.checkedSegments = 0;
    value.diagnostics.status = 'bypassed'; value.diagnostics.reasonCode = 'EXPLICIT_DRILLING_BYPASS';
    expect(mixed.verifyMixedBarrierExecutionRoute(value, { context: value.context, points, componentMemberships: [], qualificationEvidence: null }, hash)).toBe(true);
    const invalidDirect = direct(); invalidDirect.binding = value.context.binding; invalidDirect.directCheck.binding = value.context.binding;
    invalidDirect.directCheck.status = 'unavailable'; invalidDirect.directCheck.reasonCode = 'BARRIER_NOT_AVAILABLE'; invalidDirect.directCheck.checkedSegments = 0;
    invalidDirect.mode = 'tray-network'; invalidDirect.reasonCode = 'DIRECT_SECONDARY_UNAVAILABLE_TRAY_FALLBACK';
    expect(mixed.mixedBarrierDirectSecondarySchema.safeParse(invalidDirect).success).toBe(false);
  });
  it('requires every ordered final route check and complete trusted original evidence', () => {
    const value = execution(), expected = { context: context(), points, componentMemberships: [member()], qualificationEvidence: evidence() };
    expect(mixed.verifyMixedBarrierExecutionRoute(value, expected, hash)).toBe(true);
    const partial = execution(); if (!partial.proof) throw Error('fixture'); partial.proof.checkedSegments = 0; expect(mixed.mixedBarrierExecutionSchema.safeParse(partial).success).toBe(false);
    expect(mixed.verifyMixedBarrierExecutionRoute(value, { ...expected, points: [...points].reverse() }, hash)).toBe(false);
    expect(mixed.verifyMixedBarrierExecutionRoute(value, { ...expected, componentMemberships: [] }, hash)).toBe(false);
    const tampered = execution(); if (!tampered.qualification) throw Error('fixture'); tampered.qualification.evidence.originalGeometrySha256 = h('9'); expect(mixed.verifyMixedBarrierExecutionRoute(tampered, expected, hash)).toBe(false);
    const noQualification = execution(); noQualification.qualification = null; expect(mixed.mixedBarrierExecutionSchema.safeParse(noQualification).success).toBe(false);
  });
  it('distinguishes original-surface contact from closed-solid occupancy without claiming a point', () => {
    const blocked = proof(); blocked.status = 'blocked'; blocked.reasonCode = 'REGISTERED_BARRIER_INTERSECTION'; blocked.blocking = { ...member(), segmentIndex: 0, reason: 'original-surface-contact', surfaceWitness: null };
    expect(mixed.verifyMixedBarrierCheckProof(blocked, { binding: context().binding, routeSha256: blocked.routeSha256, routePointCount: 2, componentMemberships: [member()] }, hash)).toBe(true);
    const foreign = { ...member(), sourceMembershipSha256: h('9') }; expect(mixed.verifyMixedBarrierCheckProof(blocked, { binding: context().binding, routeSha256: blocked.routeSha256, routePointCount: 2, componentMemberships: [foreign] }, hash)).toBe(false);
    expect(mixed.mixedBarrierCheckProofSchema.safeParse({ ...blocked, blocking: { ...blocked.blocking, reason: 'qualified-solid-contact-or-containment' } }).success).toBe(false);
    expect(mixed.mixedBarrierCheckProofSchema.safeParse({ ...blocked, blocking: { ...blocked.blocking, surfaceWitness: [0, 0, 0] } }).success).toBe(false);
  });
  it('retains old outer dependency/response envelopes with a new exact inner identity/evidence', () => {
    expect(mixed.mixedBarrierWriteEvidenceSchema.safeParse(writeEvidence()).success).toBe(true); expect(mixed.verifyMixedBarrierEngineIdentity(identity(), hash)).toBe(true);
    const changed = identity(); changed.contentSha256 = h(); expect(mixed.verifyMixedBarrierEngineIdentity(changed, hash)).toBe(false);
    expect(mixed.mixedBarrierWriteEvidenceSchema.safeParse({ ...writeEvidence(), dependencyVersion: 'pathfinder.dependencies.v9' }).success).toBe(false);
    expect(mixed.mixedBarrierWriteEvidenceSchema.safeParse({ ...writeEvidence(), drillThroughWalls: true }).success).toBe(false);
  });
  it('does not coerce malformed work or reinterpret old direct proof decisions', () => {
    for (const work of ['bad', '-1', '01', '9223372036854775808']) { const value = execution(); value.diagnostics.work = work; expect(mixed.mixedBarrierExecutionSchema.safeParse(value).success).toBe(false); }
    expect(constrainedDirectSecondaryDecisionSchema.safeParse({ schemaVersion: 'wfc.pf.mixed-constrained-direct-secondary.v2' }).success).toBe(false);
    const nonfinite = context(); nonfinite.binding.policy.numericToleranceMetres = Infinity;
    expect(mixed.mixedBarrierRuntimeContextSchema.safeParse(nonfinite).success).toBe(false);
    const invalidSnapshot = snapshot(); if (invalidSnapshot.geometry.mode !== 'mixed-mesh-set') throw Error('fixture'); invalidSnapshot.geometry.fragments[0].bounds.maximum[0] = Infinity;
    expect(mixed.mixedBarrierSnapshotSchema.safeParse(invalidSnapshot).success).toBe(false);
  });
  it('keeps the original strict distance decision and exact mixed proof for direct SECONDARY', () => {
    expect(mixed.mixedBarrierDirectSecondarySchema.safeParse(direct()).success).toBe(true);
    const changed = direct(); changed.directCheck.routeSha256 = h(); expect(mixed.mixedBarrierDirectSecondarySchema.safeParse(changed).success).toBe(false);
    const skipped = direct(); skipped.directCheck.checkedSegments = 0; expect(mixed.mixedBarrierDirectSecondarySchema.safeParse(skipped).success).toBe(false);
    const unavailable = direct(); unavailable.distanceDecision.nearestFromMeters = 1; unavailable.distanceDecision.nearestToMeters = 1;
    expect(mixed.mixedBarrierDirectSecondarySchema.safeParse(unavailable).success).toBe(false);
  });
});
