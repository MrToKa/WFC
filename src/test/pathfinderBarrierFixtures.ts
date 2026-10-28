import { createHash } from 'node:crypto';
import { barrierCanonicalJson } from '../../shared/pathfinderBarriers';
import { barrierAdmissionIntentSchema, type BarrierAdmissionIntent } from '../../shared/pathfinderBarrierAdmission';
import { BARRIER_RUNTIME_PROFILE, barrierExecutionSchema, barrierRouteHashInput, createBarrierRuntimePolicy } from '../../shared/pathfinderBarrierRuntime';
import { BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS, ENGINE_IDENTITY_VERSION, barrierEngineIdentitySchema } from '../../shared/pathfinderEngineIdentity';
import { barrierWriteEvidenceSchema } from '../../shared/pathfinderBarrierWrites';

/** Synthetic registered-empty scope only; no actual model or engineering acceptance. */
export function barrierCalculationFixture(id: (value: number) => string, drillThroughWalls = false,
  points: [number, number, number][] = [[0, 0, 0], [10, 0, 0]], inputIntent?: BarrierAdmissionIntent) {
  const digest = (value: unknown) => createHash('sha256').update(barrierCanonicalJson(value)).digest('hex');
  const scope = inputIntent?.scope ?? { projectId: id(1), modelVersionId: id(8), contentFingerprint: 'a'.repeat(64), selectionRevision: '1',
    captureFrameId: id(90), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  const snapshot = inputIntent?.expectedSnapshot ?? { snapshotId: id(91), scope, registryRevision: '1', contentSha256: 'c'.repeat(64), mode: 'explicit-empty' as const };
  const policy = createBarrierRuntimePolicy(drillThroughWalls), binding = { scope, registryRevision: snapshot.registryRevision, snapshot, policy, policySha256: digest(policy) };
  const routeSha256 = digest(barrierRouteHashInput(points));
  const context = { schemaVersion: 'wfc.pf.barrier-runtime.v1', binding, profile: structuredClone(BARRIER_RUNTIME_PROFILE), profileSha256: digest(BARRIER_RUNTIME_PROFILE),
    storage: { intentId: id(92), manifest: { blobId: id(93), sha256: 'd'.repeat(64), bytes: 1000 }, capture: null } };
  const [from, to] = [points[0], points.at(-1)!], distance = Math.sqrt(from.reduce((total, value, at) => total + (value - to[at]) ** 2, 0));
  const barriers = barrierExecutionSchema.parse({ schemaVersion: 'wfc.pf.barrier-execution.v1', context,
    proof: { schemaVersion: 'wfc.pf.barrier-check-proof.v2', binding, routeSha256,
      status: drillThroughWalls ? 'bypassed' : 'no-barriers-declared', routePointCount: points.length, totalSegments: Math.max(1, points.length - 1), checkedSegments: 0,
      blocking: null, failedSegmentIndex: null, reasonCode: drillThroughWalls ? 'EXPLICIT_DRILLING_BYPASS' : 'EXPLICIT_EMPTY_SCOPE',
      coverage: 'registered-selected-objects-only', engineeringAccepted: false },
    directSecondary: { schemaVersion: 'wfc.pf.constrained-direct-secondary.v2', policyVersion: 'nearest-eligible-tray-or-registered-barriers.v2',
      distanceDecision: { schemaVersion: 'wfc.pf.direct-secondary.v1', policyVersion: 'nearest-eligible-tray-or.v1', coordinateFrame: 'canonical-world-metres',
        mode: 'tray-network', fromPoint: from, toPoint: to, distanceMeters: distance, nearestFromMeters: 0, nearestToMeters: 0, eligibleTrays: 1, comparison: null },
      binding, directRouteSha256: routeSha256, mode: 'tray-network', directCheck: null, reasonCode: 'DISTANCE_NOT_QUALIFIED' },
    diagnostics: { status: drillThroughWalls ? 'bypassed' : 'no-barriers-declared', reasonCode: 'LEGACY_PAIR_CLEAR', searchComplete: true, candidatesTruncated: false,
      pairAttempts: 1, collisionQueries: 0, work: '12', plannerAttempts: 0, straightPairAttempts: 1, localEdgeChecks: 0, localPhaseUsed: false, straightPhaseTruncated: false },
    connectors: { from: null, to: null }, qualification: null });
  const body = { schemaVersion: 'wfc.pf.engine-identity.v2', version: ENGINE_IDENTITY_VERSION, runnerSha256: 'a'.repeat(64), modelModuleSha256: 'b'.repeat(64),
    coreModuleSha256: 'c'.repeat(64), adapterModuleSha256: 'd'.repeat(64), derivationSha256: 'e'.repeat(64), barriersModuleSha256: 'f'.repeat(64),
    barrierVerifierModuleSha256: '1'.repeat(64), policyVersions: BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS };
  const engineIdentity = barrierEngineIdentitySchema.parse({ ...body, contentSha256: digest(body) });
  const preferences = { secondaryDistanceMeters: 2, preferVerticalApproach: true, barrierRouting: barrierAdmissionIntentSchema.parse({
    schemaVersion: 'wfc.pf.barrier-admission-intent.v1', scope, expectedRegistryRevision: snapshot.registryRevision, expectedSnapshot: snapshot, drillThroughWalls }) };
  const evidence = (cableId: string) => barrierWriteEvidenceSchema.parse({ schemaVersion: 'wfc.pf.barrier-write-evidence.v1', dependencyVersion: 'pathfinder.dependencies.v8',
    responseVersion: 'pathfinder.model.response.v3', projectId: id(1), cableId, dependencySha256: 'c'.repeat(64), engineIdentitySha256: engineIdentity.contentSha256,
    engineResultSha256: 'e'.repeat(64), contextSha256: digest(context), executionSha256: digest(barriers), routeSha256, policySha256: binding.policySha256,
    profileSha256: context.profileSha256, registryRevision: snapshot.registryRevision, snapshotId: snapshot.snapshotId, snapshotSha256: snapshot.contentSha256, drillThroughWalls,
    status: drillThroughWalls ? 'bypassed' : 'no-barriers-declared' });
  return { barriers, engineIdentity, preferences, evidence };
}
