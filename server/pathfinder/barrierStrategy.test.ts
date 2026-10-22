// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { barrierCanonicalJson } from '../../shared/pathfinderBarriers.js';
import { BARRIER_RUNTIME_PROFILE, barrierRouteHashInput, createBarrierRuntimePolicy,
  type BarrierExecution, type BarrierRuntimeContext } from '../../shared/pathfinderBarrierRuntime.js';
import type { BarrierCheckProofV2 } from '../../shared/pathfinderBarrierDecisions.js';
import { DIRECT_SECONDARY_POLICY } from '../../shared/pathfinderDirectSecondary.js';
import { MIXED_BARRIER_POLICY, MIXED_BARRIER_QUERY_DOMAIN, MIXED_BARRIER_RUNTIME_PROFILE, createMixedBarrierRuntimePolicy,
  mixedBarrierExecutionSchema, type MixedBarrierRuntimeContext, type MixedBarrierVerifierEvidence, type MixedBarrierCheckProof } from '../../shared/pathfinderBarrierMixed.js';
import { requireBarrierEngineStrategy } from './barrierStrategy.js';
import { engineResponseSchema, type EngineResponse, type EngineRoute } from './jobContracts.js';

type ProtectedResponse = Omit<Extract<EngineResponse, { schemaVersion: 'pathfinder.model.response.v3' }>,'barriers'> & {barriers:BarrierExecution};
type Input = Parameters<typeof requireBarrierEngineStrategy>[1];
type Point = [number, number, number];
const id = (n: number) => `b6300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const routeHash = (points: readonly (readonly number[])[]) => hash(barrierCanonicalJson(barrierRouteHashInput(points)));
const membership = () => ({ computationalMeshId: 'shell:000000', parentSelectionIds: [id(20)], fragmentIds: [11] });
function context(mode: 'mesh-set' | 'explicit-empty' = 'mesh-set', drill = false): BarrierRuntimeContext {
  const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1',
    captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  const policy = createBarrierRuntimePolicy(drill);
  return { schemaVersion: 'wfc.pf.barrier-runtime.v1', binding: { scope, registryRevision: '1', snapshot: { snapshotId: id(4),
    scope: structuredClone(scope), registryRevision: '1', contentSha256: 'c'.repeat(64), mode }, policy, policySha256: hash(barrierCanonicalJson(policy)) },
  profile: structuredClone(BARRIER_RUNTIME_PROFILE), profileSha256: hash(barrierCanonicalJson(BARRIER_RUNTIME_PROFILE)),
  storage: { intentId: id(5), manifest: { blobId: id(6), sha256: 'd'.repeat(64), bytes: 2093 },
    capture: mode === 'mesh-set' ? { blobId: id(7), sha256: 'e'.repeat(64), bytes: 1820 } : null } };
}
function proof(admitted: BarrierRuntimeContext, points: Point[], status: BarrierCheckProofV2['status'] = 'clear-selected-scope'): BarrierCheckProofV2 {
  const reasonCode = { 'clear-selected-scope': 'REGISTERED_SCOPE_CLEAR', blocked: 'REGISTERED_BARRIER_INTERSECTION',
    indeterminate: 'BARRIER_QUERY_INDETERMINATE', bypassed: 'EXPLICIT_DRILLING_BYPASS', unavailable: 'FINAL_CHECK_UNAVAILABLE',
    'no-barriers-declared': 'EXPLICIT_EMPTY_SCOPE' }[status];
  return { schemaVersion: 'wfc.pf.barrier-check-proof.v2', binding: structuredClone(admitted.binding), routeSha256: routeHash(points), status,
    routePointCount: points.length, totalSegments: Math.max(1, points.length - 1),
    checkedSegments: status === 'clear-selected-scope' ? Math.max(1, points.length - 1) : status === 'blocked' ? 1 : 0,
    blocking: status === 'blocked' ? { ...membership(), segmentIndex: 0, reason: 'surface-or-containment', surfaceWitness: null } : null,
    failedSegmentIndex: status === 'indeterminate' ? 0 : null, reasonCode, coverage: 'registered-selected-objects-only', engineeringAccepted: false };
}
function route(points: Point[], lengthMeters: number, fromDistanceMeters: number, toDistanceMeters: number, direct = false): EngineRoute {
  return { success: true, message: 'Synthetic C# transport shape.', routeText: direct ? '/SECONDARY' : '/BC001',
    routeCodes: [direct ? '/SECONDARY' : '/BC001'], segmentIds: direct ? [] : ['segment-1'], pathPoints: points.map(([x, y, z]) => ({ x, y, z })),
    lengthMeters, fromDistanceMeters, toDistanceMeters, fromRequiresSecondary: false, toRequiresSecondary: false,
    connectionGapCount: 0, connectionGapLengthMeters: 0 };
}
type Kind = 'network' | 'blocked-direct' | 'direct' | 'bypassed' | 'empty' | 'reverse-singleton';
/** Minimal synthetic factories follow retained actual B6 C# transport shapes.
 * No runtime-generated payloads or geometrical authority are imported here. */
function result(kind: Kind = 'network'): { response: ProtectedResponse; input: Input } {
  const direct = ['direct', 'bypassed', 'empty', 'reverse-singleton'].includes(kind), blocked = kind === 'blocked-direct';
  const admitted = context(kind === 'empty' ? 'explicit-empty' : 'mesh-set', kind === 'bypassed');
  const from: Point = blocked ? [-.1, .75, .1] : kind === 'reverse-singleton' ? [1e-200, 0, 0] : direct ? [0, 0, 0] : [-1, 0, .1];
  const to: Point = blocked ? [.3, .75, .1] : kind === 'reverse-singleton' ? [0, 0, 0] : direct ? [3, 0, 0] : [3, 0, .1];
  const points: Point[] = blocked ? [from, [-.1, 0, .1], [.3, 0, .1], to]
    : kind === 'reverse-singleton' ? [from] : direct ? [from, to] : [from, [0, 0, .1], to];
  const distance = blocked ? .4 : kind === 'reverse-singleton' ? 0 : direct ? 3 : 4;
  const status = kind === 'bypassed' ? 'bypassed' : kind === 'empty' ? 'no-barriers-declared' : 'clear-selected-scope';
  const check = proof(admitted, points, status);
  const chord: Point[] = distance === 0 ? [from] : [from, to];
  const barriers: BarrierExecution = { schemaVersion: 'wfc.pf.barrier-execution.v1', context: admitted, proof: check,
    directSecondary: { schemaVersion: 'wfc.pf.constrained-direct-secondary.v2', policyVersion: 'nearest-eligible-tray-or-registered-barriers.v2',
      distanceDecision: { schemaVersion: 'wfc.pf.direct-secondary.v1', policyVersion: DIRECT_SECONDARY_POLICY, coordinateFrame: 'canonical-world-metres',
        mode: direct || blocked ? 'direct-secondary' : 'tray-network', fromPoint: from, toPoint: to, distanceMeters: distance,
        nearestFromMeters: blocked ? .75 : direct ? 5 : 1, nearestToMeters: blocked ? .75 : direct ? 5 : 0, eligibleTrays: 1,
        comparison: direct || blocked ? 'both' : null },
      binding: structuredClone(admitted.binding), directRouteSha256: routeHash(chord), mode: direct ? 'direct-secondary' : 'tray-network',
      directCheck: blocked ? proof(admitted, chord, 'blocked') : direct ? structuredClone(check) : null,
      reasonCode: blocked ? 'DIRECT_SECONDARY_BLOCKED_TRAY_FALLBACK' : kind === 'bypassed' ? 'DIRECT_SECONDARY_DRILLING_BYPASS'
        : kind === 'empty' ? 'DIRECT_SECONDARY_EXPLICIT_EMPTY_SCOPE' : direct ? 'DIRECT_SECONDARY_CLEAR' : 'DISTANCE_NOT_QUALIFIED' },
    diagnostics: { status: kind === 'bypassed' ? 'bypassed' : kind === 'empty' ? 'no-barriers-declared' : 'clear', reasonCode: 'SYNTHETIC_CSHARP_RESULT',
      searchComplete: true, candidatesTruncated: false, pairAttempts: 1, collisionQueries: ['bypassed', 'empty'].includes(kind) ? 0 : 7,
      work: '153', plannerAttempts: 0, straightPairAttempts: 1, localEdgeChecks: 0, localPhaseUsed: false, straightPhaseTruncated: false },
    connectors: { from: null, to: null }, qualification: ['bypassed', 'empty'].includes(kind) ? null : { captureSha256: admitted.storage!.capture!.sha256,
      pureVerificationSha256: 'f'.repeat(64), decompositionSha256: '1'.repeat(64), computationalMemberships: [membership()] } };
  const response: ProtectedResponse = { schemaVersion: 'pathfinder.model.response.v3', requestId: id(10), status: 'calculated',
    message: 'Synthetic C# strategy fixture.', engineeringAccepted: false, effectiveCategory: 'Control', barriers,
    route: route(points, blocked ? 1.9 : direct ? distance : 4, direct ? 0 : blocked ? .75 : 1, direct ? 0 : blocked ? .75 : 0, direct),
    ...(blocked ? { design: { lengthBeforePercentageMeters: '6.9', unroundedLengthMeters: '7.59', designLengthMeters: '8' } } : {}) };
  // Underflow-zero direct reversal uses the new exact From singleton as the real
  // C# runner does; the original request is deliberately ordered the other way.
  const input: Input = { context: structuredClone(admitted), category: 'Control',
    fromPoint: kind === 'reverse-singleton' ? to : from, toPoint: kind === 'reverse-singleton' ? from : to,
    ...(kind === 'reverse-singleton' ? { reverse: true } : {}) };
  return { response, input };
}
function parsed(response: ProtectedResponse): ProtectedResponse {
  const value = engineResponseSchema.parse(response);
  if (value.schemaVersion !== 'pathfinder.model.response.v3' || value.barriers.schemaVersion !== 'wfc.pf.barrier-execution.v1') throw new Error('Protected fixture version changed.');
  return {...value,barriers:value.barriers};
}
function rejected(response: EngineResponse, input: Input) {
  expect(() => requireBarrierEngineStrategy(response, input)).toThrowError(expect.objectContaining({ code: 'ENGINE_BARRIER_STRATEGY_INVALID', status: 502 }));
}
function updateRouteProof(response: ProtectedResponse) {
  const points = response.route!.pathPoints.map(point => [point.x, point.y, point.z] as Point);
  response.barriers.proof = proof(response.barriers.context, points);
}
function failure(status: ProtectedResponse['status'] = 'no_path'): { response: ProtectedResponse; input: Input } {
  const value = result(); value.response.status = status; delete value.response.route; delete value.response.effectiveCategory;
  value.response.message = 'Independent barrier qualification refused: OPEN_SHELL';
  value.response.barriers.proof = null; value.response.barriers.directSecondary = null; value.response.barriers.qualification = null;
  value.response.barriers.diagnostics = { status: 'unavailable', reasonCode: status === 'no_path' ? 'BARRIER_QUALIFICATION_REFUSED' : 'RUNTIME_CONTEXT_UNAVAILABLE',
    searchComplete: false, candidatesTruncated: false, pairAttempts: 0, collisionQueries: 0, work: '0', plannerAttempts: 0,
    straightPairAttempts: 0, localEdgeChecks: 0, localPhaseUsed: false, straightPhaseTruncated: false };
  return value;
}
function mixedResult(kind:Kind='network') {
  const base=result(kind),old=base.response.barriers,policy=createMixedBarrierRuntimePolicy(kind==='bypassed');
  const context:MixedBarrierRuntimeContext={schemaVersion:'wfc.pf.barrier-runtime.v2',binding:{...old.context.binding,schemaVersion:'wfc.pf.barrier-calculation-binding.v2',
    policy,policySha256:hash(barrierCanonicalJson(policy)),snapshot:old.context.binding.snapshot?{...old.context.binding.snapshot,
      schemaVersion:'wfc.pf.barrier-snapshot-reference.v2',geometryPolicy:MIXED_BARRIER_POLICY,mode:kind==='empty'?'explicit-empty':'mixed-mesh-set'}:null},
    profile:structuredClone(MIXED_BARRIER_RUNTIME_PROFILE),profileSha256:hash(barrierCanonicalJson(MIXED_BARRIER_RUNTIME_PROFILE)),storage:old.context.storage};
  const member={componentId:'component:000000',kind:'original-surface' as const,parentSelectionIds:[id(20)],fragmentIds:[11],triangleCount:1,sourceMembershipSha256:'2'.repeat(64)};
  // Independent trusted expectation fixture; never read members back from the response.
  const expected:MixedBarrierVerifierEvidence|null=['bypassed','empty'].includes(kind)?null:{captureId:id(5),scope:context.binding.scope,
    originalSurfaceComponents:1,qualifiedClosedSolidComponents:0,fragmentCount:1,vertexCount:3,triangleCount:1,originalGeometrySha256:'3'.repeat(64),verificationSha256:'4'.repeat(64),
    numericToleranceMetres:1e-7,componentMemberships:[member],inputSchemaVersion:'wfc.pf.barrier-capture.v1',policyVersion:MIXED_BARRIER_POLICY,
    coverage:'provided-fragments-only',geometryProvenance:'capture-bound-provided-original-triangles',sdkCoverageVerified:false,sdkSourceBytesVerified:false,currentFrameVerified:false,
    engineeringAccepted:false,ownTerminalExemptionsSupported:false,authority:'none'};
  const check=(value:BarrierCheckProofV2):MixedBarrierCheckProof=>({...value,schemaVersion:'wfc.pf.barrier-mixed-check-proof.v2',binding:context.binding,
    blocking:value.blocking?{...member,segmentIndex:value.blocking.segmentIndex,reason:'original-surface-contact',surfaceWitness:null}:null,
    domain:MIXED_BARRIER_QUERY_DOMAIN,globalModelCoverageVerified:false,physicalCableRadiusChecked:false,ownTerminalExemptionsSupported:false,authority:'none'});
  if(!old.proof||!old.directSecondary)throw Error('fixture');
  const {schemaVersion:_tag,policyVersion:_policy,...direct}=old.directSecondary;
  const execution=mixedBarrierExecutionSchema.parse({...old,schemaVersion:'wfc.pf.barrier-execution.v2',context,proof:check(old.proof),
    directSecondary:{...direct,schemaVersion:'wfc.pf.mixed-constrained-direct-secondary.v2',binding:context.binding,directCheck:direct.directCheck?check(direct.directCheck):null},
    qualification:expected?{captureSha256:context.storage!.capture!.sha256,evidence:structuredClone(expected)}:null,
    engineeringAccepted:false,ownTerminalExemptionsSupported:false,authority:'none'});
  const response=engineResponseSchema.parse({...base.response,barriers:execution});
  const input:Input={...base.input,context,qualification:structuredClone(expected)};
  return {response,input};
}

describe('barrier engine strategy admission after strict transport parsing', () => {
  it.each(['network','blocked-direct','direct','bypassed','empty'] as const)('validates exact mixed %s against a separate trusted qualifier',kind=>{
    const f=mixedResult(kind);expect(()=>requireBarrierEngineStrategy(f.response,f.input)).not.toThrow();
  });
  it.each(['missing-expectation','null-expectation','response-self-members','response-capture','response-pure-hash','wrong-lane'] as const)
    ('refuses mixed %s without trusting response-supplied membership',field=>{
      const f=mixedResult();
      if(field==='missing-expectation')delete f.input.qualification;
      if(field==='null-expectation')f.input.qualification=null;
      if(f.response.schemaVersion!=='pathfinder.model.response.v3'||f.response.barriers.schemaVersion!=='wfc.pf.barrier-execution.v2')throw Error('fixture');
      if(field==='response-self-members')f.response.barriers.qualification!.evidence.componentMemberships[0].sourceMembershipSha256='8'.repeat(64);
      if(field==='response-capture')f.response.barriers.qualification!.captureSha256='8'.repeat(64);
      if(field==='response-pure-hash')f.response.barriers.qualification!.evidence.verificationSha256='8'.repeat(64);
      if(field==='wrong-lane')f.input.context=context();
      rejected(f.response,f.input);
    });
  it('does not attach a mixed qualifier to legacy Strategy inputs',()=>{
    const legacy=result();rejected(legacy.response,{...legacy.input,qualification:null});
  });
  it('preserves a typed mixed pre-computation refusal without claiming a physical check',()=>{
    const f=mixedResult();
    if(f.response.schemaVersion!=='pathfinder.model.response.v3'||f.response.barriers.schemaVersion!=='wfc.pf.barrier-execution.v2')throw Error('fixture');
    f.response.status='no_path';delete f.response.route;delete f.response.effectiveCategory;
    f.response.barriers.qualification=null;f.response.barriers.proof=null;f.response.barriers.directSecondary=null;
    f.response.barriers.diagnostics={...f.response.barriers.diagnostics,status:'unavailable',reasonCode:'BARRIER_QUALIFICATION_REFUSED',searchComplete:false};
    expect(()=>requireBarrierEngineStrategy(f.response,f.input)).not.toThrow();
    const crossed=structuredClone(f.input);crossed.context.storage!.manifest.sha256='8'.repeat(64);rejected(f.response,crossed);
  });
  it.each(['network', 'blocked-direct', 'direct', 'bypassed', 'empty', 'reverse-singleton'] as const)('accepts the exact retained %s computation without changing it', kind => {
    const { response, input } = result(kind), before = structuredClone(response);
    expect(() => requireBarrierEngineStrategy(parsed(response), input)).not.toThrow(); expect(response).toEqual(before);
  });
  it('matches the independently observed C# rejected-chord/final-tray hashes and preserves the actual fallback design', () => {
    const { response, input } = result('blocked-direct');
    expect(response.barriers.proof!.routeSha256).toBe('eff4c5f3ae9806cef2a26a05edf6e3bf6512462d1a885b32d740522f3c3dd1fb');
    expect(response.barriers.directSecondary!.directRouteSha256).toBe('4c65c8a7009c98c8f3e866120ad982e00279ec36f035bc4b5176b1654dffb543');
    requireBarrierEngineStrategy(parsed(response), input);
    expect(response.barriers.directSecondary).toMatchObject({ mode: 'tray-network', directCheck: { status: 'blocked' } });
    expect(response.design?.designLengthMeters).toBe('8'); expect(response.route?.routeText).toBe('/BC001');
  });
  it('matches the C# reversed tiny singleton digest and its one occupancy check', () => {
    const { response, input } = result('reverse-singleton');
    expect(response.barriers.proof).toMatchObject({ routeSha256: '6e024d493837c289790a2fcb146c3de5b1ec3155890b78b116124ef2b89a8a37',
      routePointCount: 1, totalSegments: 1, checkedSegments: 1 });
    requireBarrierEngineStrategy(parsed(response), input); rejected(response, { ...input, reverse: false });
  });
  it('maps Instrumentation to Control while refusing a different effective cable category', () => {
    const { response, input } = result(); expect(() => requireBarrierEngineStrategy(parsed(response), { ...input, category: 'Instrumentation' })).not.toThrow();
    const wrong = structuredClone(response); wrong.effectiveCategory = 'LV'; rejected(parsed(wrong), input);
  });
  it('accepts ordinary reverse only for swapped frozen input endpoints', () => {
    const { response, input } = result('blocked-direct');
    const swapped: Input = { ...input, reverse: true, fromPoint: input.toPoint, toPoint: input.fromPoint };
    expect(() => requireBarrierEngineStrategy(parsed(response), swapped)).not.toThrow();
    rejected(response, { ...input, reverse: true });
  });
  it.each(['project', 'model', 'frame', 'selection', 'registry', 'snapshot', 'manifest-blob', 'capture-blob', 'intent', 'drill', 'profile-digest', 'policy-digest'] as const)
    ('refuses a result collected for another exact %s admission', change => {
      const { response, input } = result(); const expected = input.context;
      if (change === 'project') { expected.binding.scope.projectId = id(98); expected.binding.snapshot!.scope.projectId = id(98); }
      if (change === 'model') { expected.binding.scope.modelVersionId = id(98); expected.binding.snapshot!.scope.modelVersionId = id(98); }
      if (change === 'frame') { expected.binding.scope.captureFrameSha256 = '0'.repeat(64); expected.binding.snapshot!.scope.captureFrameSha256 = '0'.repeat(64); }
      if (change === 'selection') { expected.binding.scope.selectionRevision = '2'; expected.binding.snapshot!.scope.selectionRevision = '2'; }
      if (change === 'registry') { expected.binding.registryRevision = '2'; expected.binding.snapshot!.registryRevision = '2'; }
      if (change === 'snapshot') expected.binding.snapshot!.snapshotId = id(98);
      if (change === 'manifest-blob') expected.storage!.manifest.blobId = id(98);
      if (change === 'capture-blob') expected.storage!.capture!.blobId = id(98);
      if (change === 'intent') expected.storage!.intentId = id(98);
      if (change === 'drill') { expected.binding.policy.drillThroughWalls = true; expected.binding.policySha256 = hash(barrierCanonicalJson(expected.binding.policy)); }
      if (change === 'profile-digest') expected.profileSha256 = '0'.repeat(64);
      if (change === 'policy-digest') expected.binding.policySha256 = '0'.repeat(64);
      rejected(parsed(response), input);
    });
  it.each(['from', 'to'] as const)('refuses a final tray path for another cable %s even after its exact final proof is rehashed', endpoint => {
    const { response, input } = result(); const at = endpoint === 'from' ? 0 : response.route!.pathPoints.length - 1;
    response.route!.pathPoints[at].y += .2; updateRouteProof(response);
    // The distance decision remains bound to this cable. A proof for another
    // endpoint's final polyline must not borrow that otherwise valid decision.
    rejected(parsed(response), input);
  });
  it('preserves legacy zero-distance underflow omission of a final tray endpoint without introducing an epsilon', () => {
    const { response, input } = result();
    input.toPoint = [3, 1e-200, .1]; response.barriers.directSecondary!.distanceDecision.toPoint = input.toPoint;
    response.barriers.directSecondary!.directRouteSha256 = routeHash([input.fromPoint, input.toPoint]);
    expect(() => requireBarrierEngineStrategy(parsed(response), input)).not.toThrow();
    input.toPoint = [3, 1e-150, .1]; response.barriers.directSecondary!.distanceDecision.toPoint = input.toPoint;
    response.barriers.directSecondary!.directRouteSha256 = routeHash([input.fromPoint, input.toPoint]);
    rejected(parsed(response), input);
  });
  it('keeps the successful route proof valid through durable JSON normalization of signed zero', () => {
    const { response, input } = result('direct'); response.route!.pathPoints[0].x = -0; updateRouteProof(response);
    response.barriers.directSecondary!.directRouteSha256 = response.barriers.proof!.routeSha256;
    response.barriers.directSecondary!.directCheck = structuredClone(response.barriers.proof!);
    const durable = JSON.parse(JSON.stringify(response)) as ProtectedResponse;
    expect(Object.is(response.route!.pathPoints[0].x, -0)).toBe(true); expect(Object.is(durable.route!.pathPoints[0].x, -0)).toBe(false);
    expect(routeHash([[-0, 0, 0], [3, 0, 0]])).toBe(routeHash([[0, 0, 0], [3, 0, 0]]));
    expect(() => requireBarrierEngineStrategy(parsed(response), input)).not.toThrow();
    expect(() => requireBarrierEngineStrategy(parsed(durable), input)).not.toThrow();
  });
  it.each(['endpoint', 'chord-hash', 'blocking-membership', 'direct-mode', 'route-metric'] as const)('refuses incompatible constrained direct %s evidence', change => {
    const { response, input } = result('blocked-direct'), decision = response.barriers.directSecondary!;
    if (change === 'endpoint') decision.distanceDecision.fromPoint = [-.1, .85, .1];
    if (change === 'chord-hash') { decision.directRouteSha256 = '0'.repeat(64); decision.directCheck!.routeSha256 = '0'.repeat(64); }
    if (change === 'blocking-membership') decision.directCheck!.blocking!.fragmentIds = [12];
    if (change === 'direct-mode') { decision.mode = 'direct-secondary'; decision.reasonCode = 'DIRECT_SECONDARY_CLEAR'; }
    if (change === 'route-metric') {
      const direct = result('direct'); direct.response.route!.lengthMeters = 4;
      rejected(direct.response, direct.input); return;
    }
    rejected(response, input);
  });
  it('requires the deliberately frozen constrained decision instead of accepting an unopted legacy-compatible non-MV route', () => {
    const { response, input } = result(); response.barriers.directSecondary = null;
    expect(engineResponseSchema.safeParse(response).success).toBe(true); rejected(response, input);
  });
  it.each(['route-points', 'route-digest', 'prefix', 'proof-missing', 'blocked-final', 'capture-digest'] as const)('refuses unsafe successful final %s evidence', change => {
    const { response, input } = result();
    if (change === 'route-points') response.route!.pathPoints[1].z += 1;
    if (change === 'route-digest') response.barriers.proof!.routeSha256 = '0'.repeat(64);
    if (change === 'prefix') response.barriers.proof!.checkedSegments = 1;
    if (change === 'proof-missing') response.barriers.proof = null;
    if (change === 'blocked-final') response.barriers.proof = proof(response.barriers.context, response.route!.pathPoints.map(p => [p.x, p.y, p.z] as Point), 'blocked');
    if (change === 'capture-digest') response.barriers.qualification!.captureSha256 = '0'.repeat(64);
    rejected(response, input);
  });
  it('does not mutate a result or replace its engineering status while refusing it', () => {
    const { response, input } = result(); response.barriers.proof!.routeSha256 = '0'.repeat(64); const before = structuredClone(response);
    rejected(response, input); expect(response).toEqual(before); expect(response.engineeringAccepted).toBe(false);
  });
});

describe('typed protected refusal preservation and historical isolation', () => {
  it.each(['no_path', 'invalid_request', 'deadline_exceeded', 'resource_limit', 'settings_required', 'category_required', 'model_needs_review'] as const)
    ('retains an honest pre-computation %s refusal without requiring an invented category or decision', status => {
      const { response, input } = failure(status), before = structuredClone(response);
      expect(() => requireBarrierEngineStrategy(parsed(response), input)).not.toThrow(); expect(response).toEqual(before);
      expect(response.barriers).toMatchObject({ proof: null, directSecondary: null, diagnostics: { status: 'unavailable' } });
    });
  it.each(['no_path', 'invalid_request', 'deadline_exceeded'] as const)('still rejects crossed context on a typed %s refusal', status => {
    const { response, input } = failure(status); input.context.storage!.manifest.sha256 = '0'.repeat(64); rejected(parsed(response), input);
  });
  it('retains a real constrained no-path search with a distance-qualified rejected direct chord and no fabricated final path', () => {
    const { response, input } = result('blocked-direct'); response.status = 'no_path'; response.route!.success = false;
    response.barriers.proof = null; response.barriers.diagnostics.status = 'search-incomplete'; response.barriers.diagnostics.searchComplete = false;
    expect(() => requireBarrierEngineStrategy(parsed(response), input)).not.toThrow();
  });
  it.each(['calculated', 'no_path', 'invalid_request'] as const)('never upgrades a legacy v1 %s result into the admitted barrier contract', status => {
    const { input } = result(); const legacy: EngineResponse = { schemaVersion: 'pathfinder.model.response.v1', requestId: id(10),
      status, message: 'Historical synthetic result.', engineeringAccepted: false };
    rejected(legacy, input); expect(legacy.schemaVersion).toBe('pathfinder.model.response.v1');
  });
  it('refuses a historical direct-only v2 result despite an otherwise valid direct route', () => {
    const { response, input } = result('direct'); const legacy: EngineResponse = { schemaVersion: 'pathfinder.model.response.v2',
      requestId: response.requestId, status: 'calculated', message: response.message, engineeringAccepted: false,
      effectiveCategory: 'Control', route: response.route, directSecondary: response.barriers.directSecondary!.distanceDecision };
    expect(engineResponseSchema.safeParse(legacy).success).toBe(true); rejected(legacy, input);
  });
  it('does not silently accept an unknown future engine version as legacy or barrier-aware', () => {
    const { response, input } = result(); Object.assign(response, { schemaVersion: 'pathfinder.model.response.v999' });
    expect(engineResponseSchema.safeParse(response).success).toBe(false); rejected(response, input);
  });
});
