// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { barrierCanonicalJson } from '../../shared/pathfinderBarriers.js';
import { barrierRouteHashInput, createBarrierRuntimePolicy, type BarrierRuntimeContext, type BarrierExecution } from '../../shared/pathfinderBarrierRuntime.js';
import { createMixedBarrierRuntimePolicy, MIXED_BARRIER_RUNTIME_PROFILE, mixedBarrierRuntimeContextSchema } from '../../shared/pathfinderBarrierMixed.js';
import type { BarrierCheckProofV2 } from '../../shared/pathfinderBarrierDecisions.js';
import type { BarrierAdmissionIntent } from '../../shared/pathfinderBarrierAdmission.js';
import { DIRECT_SECONDARY_POLICY } from '../../shared/pathfinderDirectSecondary.js';
import { syntheticBarrierEngineIdentity, syntheticDrillingRuntime, syntheticEngineIdentity } from './calculationFixtures.js';
import { defaultOptions, engineResponseSchema, type BarrierDependencySnapshot, type CurrentDependencySnapshot,
  type EngineResponse, type ScopedDependencySnapshot } from './jobContracts.js';
import { previewEngineRequest, previewResultDto, type BarrierPreviewDependencies, type HistoricalPreviewDependencies } from './previews.js';
import { buildCableEngineRequest, cableDirectSecondaryPolicy, requireCableEngineStrategy, unavailableBarrierEngineResponse } from './worker.js';

type Point = [number, number, number];
type ProtectedResponse = Extract<EngineResponse, { schemaVersion: 'pathfinder.model.response.v3' }> & {barriers:BarrierExecution};
const id = (n: number) => `b6310000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = (value: unknown) => createHash('sha256').update(barrierCanonicalJson(value)).digest('hex');
const routeHash = (points: Point[]) => digest(barrierRouteHashInput(points));
const fromPoint: Point = [-.1, .75, .1], toPoint: Point = [.3, .75, .1];
const scope = () => ({ projectId: id(1), modelVersionId: id(2), contentFingerprint: 'c'.repeat(64), selectionRevision: '1',
  captureFrameId: id(5), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const });
function intent(context: BarrierRuntimeContext): BarrierAdmissionIntent {
  return { schemaVersion: 'wfc.pf.barrier-admission-intent.v1', scope: structuredClone(context.binding.scope),
    expectedRegistryRevision: context.binding.registryRevision, expectedSnapshot: structuredClone(context.binding.snapshot),
    drillThroughWalls: context.binding.policy.drillThroughWalls };
}
function endpoint(n: number, point: Point) {
  return { locationId: id(n), locationRevision: '2', bindingRevision: '3', point: structuredClone(point), bindingId: id(n + 10),
    bindingContentSha256: 'b'.repeat(64), mode: 'fixed-world' as const, captureFrameId: id(5), qualifiedProjectFrameId: null,
    aggregateId: id(4), projectionSha256: 'd'.repeat(64), sourceObjectRevisionId: null, migrationDecisionId: null };
}
/** Synthetic immutable inputs only; this file performs no SQL, SDK or process work. */
function historical(): CurrentDependencySnapshot {
  return { schemaVersion: 'pathfinder.dependencies.v5', projectId: id(1), cableId: id(8), cableWriteRevision: '4',
    cableInputs: { fromLocation: 'From', toLocation: 'To', mto: 'Control', cableTypeId: id(9) }, registryRevision: '7',
    routing: { catalogRevision: '2', routingContentSha256: 'e'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: 'f'.repeat(64) },
    model: { id: id(2), selectionRevision: '1', contentFingerprint: 'c'.repeat(64) }, artifact: { id: id(3), sha256: 'd'.repeat(64) },
    preparation: { aggregateId: id(4), geometryRevision: '2', captureFrameId: id(5), projectionSha256: 'd'.repeat(64) }, comparison: null,
    settings: { revision: '3', connectionGap: '1', secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '10' },
    options: { ...defaultOptions, connectionToleranceMeters: 1 }, from: endpoint(6, fromPoint), to: endpoint(7, toPoint),
    engineVersion: 'pathfinder-45c24bf5-pf1-modelrunner-v1', engineIdentity: syntheticEngineIdentity() };
}
function scoped(): ScopedDependencySnapshot {
  const { schemaVersion: _version, registryRevision: _registry, ...body } = historical();
  return { ...body, schemaVersion: 'pathfinder.dependencies.v7', endpointResolution: { schemaVersion: 'pathfinder.endpoint-resolution.v1',
    matchingPolicy: 'nfc-trim-uppercase-v1', from: { logicalKey: 'FROM', locationId: id(6) }, to: { logicalKey: 'TO', locationId: id(7) } } };
}
function protectedDependencies(context = syntheticDrillingRuntime(scope())): BarrierDependencySnapshot & {barriers:BarrierRuntimeContext} {
  const { schemaVersion: _version, engineIdentity: _identity, ...body } = scoped();
  return { ...body, schemaVersion: 'pathfinder.dependencies.v8', engineIdentity: syntheticBarrierEngineIdentity(), barriers: context,
    options: { ...body.options, barrierRouting: intent(context) } };
}
function preview(dependencies = protectedDependencies(), reverse = false): BarrierPreviewDependencies & {barriers:BarrierRuntimeContext} {
  const from = { name: 'From', point: dependencies.from.point, source: 'manual-world-point' as const,
    objectId: null, locationId: null, bindingRevision: null, binding: null };
  const to = { ...from, name: 'To', point: dependencies.to.point };
  return { schemaVersion: 'pathfinder.preview.dependencies.v6', engineIdentity: dependencies.engineIdentity,
    comparison: dependencies.comparison, preparation: dependencies.preparation, routing: dependencies.routing,
    projectId: dependencies.projectId, modelVersionId: dependencies.model.id, selectionRevision: dependencies.model.selectionRevision,
    contentFingerprint: dependencies.model.contentFingerprint, artifactId: dependencies.artifact.id, snapshotSha256: dependencies.artifact.sha256,
    registryRevision: '7', settings: dependencies.settings, options: dependencies.options, barriers: dependencies.barriers,
    input: { from: { name: from.name, point: from.point }, to: { name: to.name, point: to.point }, category: 'Control', reverse,
      artifactId: dependencies.artifact.id, expectedSelectionRevision: '1', expectedSettingsRevision: '3', expectedRegistryRevision: '7',
      barrierRouting: dependencies.options.barrierRouting }, from, to, engineVersion: dependencies.engineVersion };
}
function parsed(response: ProtectedResponse): ProtectedResponse {
  const value = engineResponseSchema.parse(response);
  if (value.schemaVersion !== 'pathfinder.model.response.v3' || value.barriers.schemaVersion!=='wfc.pf.barrier-execution.v1') throw new Error('Protected fixture version changed.');
  return {...value,barriers:value.barriers};
}
function unavailable(context: BarrierRuntimeContext): ProtectedResponse {
  return parsed({ schemaVersion: 'pathfinder.model.response.v3', requestId: id(50), status: 'no_path',
    message: 'Synthetic independent qualification refusal.', engineeringAccepted: false,
    barriers: { schemaVersion: 'wfc.pf.barrier-execution.v1', context: structuredClone(context), proof: null, directSecondary: null,
      diagnostics: { status: 'unavailable', reasonCode: 'BARRIER_QUALIFICATION_REFUSED', searchComplete: false, candidatesTruncated: false,
        pairAttempts: 0, collisionQueries: 0, work: '0', plannerAttempts: 0, straightPairAttempts: 0, localEdgeChecks: 0,
        localPhaseUsed: false, straightPhaseTruncated: false }, connectors: { from: null, to: null }, qualification: null } });
}
function meshContext(): BarrierRuntimeContext {
  const context = syntheticDrillingRuntime(scope()), policy = createBarrierRuntimePolicy(false);
  context.binding = { ...context.binding, policy, policySha256: digest(policy), snapshot: { snapshotId: id(21), scope: scope(),
    registryRevision: '1', contentSha256: 'a'.repeat(64), mode: 'mesh-set' } };
  context.storage = { intentId: id(22), manifest: { blobId: id(23), sha256: 'd'.repeat(64), bytes: 2093 },
    capture: { blobId: id(24), sha256: 'e'.repeat(64), bytes: 1820 } };
  return context;
}
const membership = () => ({ computationalMeshId: 'shell:000000', parentSelectionIds: [id(20)], fragmentIds: [11] });
function proof(context: BarrierRuntimeContext, points: Point[], blocked = false): BarrierCheckProofV2 {
  return { schemaVersion: 'wfc.pf.barrier-check-proof.v2', binding: structuredClone(context.binding), routeSha256: routeHash(points),
    status: blocked ? 'blocked' : 'clear-selected-scope', routePointCount: points.length, totalSegments: Math.max(1, points.length - 1),
    checkedSegments: blocked ? 1 : Math.max(1, points.length - 1), blocking: blocked ? { ...membership(), segmentIndex: 0,
      reason: 'surface-or-containment', surfaceWitness: null } : null, failedSegmentIndex: null,
    reasonCode: blocked ? 'REGISTERED_BARRIER_INTERSECTION' : 'REGISTERED_SCOPE_CLEAR',
    coverage: 'registered-selected-objects-only', engineeringAccepted: false };
}
/** Rejected short chord and successful tray polyline are deliberately distinct.
 * Matches independently retained C# B6 shape; no TS routing is computed here. */
function fallback(context: BarrierRuntimeContext): ProtectedResponse {
  const chord: Point[] = [fromPoint, toPoint], points: Point[] = [fromPoint, [-.1, 0, .1], [.3, 0, .1], toPoint];
  return parsed({ schemaVersion: 'pathfinder.model.response.v3', requestId: id(50), status: 'calculated', message: 'Synthetic C# tray fallback.',
    engineeringAccepted: false, effectiveCategory: 'Control', route: { success: true, message: 'Synthetic tray route.', routeText: '/BC001',
      routeCodes: ['/BC001'], segmentIds: ['segment-1'], pathPoints: points.map(([x, y, z]) => ({ x, y, z })), lengthMeters: 1.9,
      fromDistanceMeters: .75, toDistanceMeters: .75, fromRequiresSecondary: false, toRequiresSecondary: false,
      connectionGapCount: 0, connectionGapLengthMeters: 0 },
    design: { lengthBeforePercentageMeters: '6.9', unroundedLengthMeters: '7.59', designLengthMeters: '8' },
    barriers: { schemaVersion: 'wfc.pf.barrier-execution.v1', context: structuredClone(context), proof: proof(context, points),
      directSecondary: { schemaVersion: 'wfc.pf.constrained-direct-secondary.v2', policyVersion: 'nearest-eligible-tray-or-registered-barriers.v2',
        distanceDecision: { schemaVersion: 'wfc.pf.direct-secondary.v1', policyVersion: DIRECT_SECONDARY_POLICY,
          coordinateFrame: 'canonical-world-metres', mode: 'direct-secondary', fromPoint, toPoint, distanceMeters: .4,
          nearestFromMeters: .75, nearestToMeters: .75, eligibleTrays: 1, comparison: 'both' },
        binding: structuredClone(context.binding), directRouteSha256: routeHash(chord), mode: 'tray-network',
        directCheck: proof(context, chord, true), reasonCode: 'DIRECT_SECONDARY_BLOCKED_TRAY_FALLBACK' },
      diagnostics: { status: 'clear', reasonCode: 'SYNTHETIC_CSHARP_RESULT', searchComplete: true, candidatesTruncated: false,
        pairAttempts: 1, collisionQueries: 7, work: '153', plannerAttempts: 0, straightPairAttempts: 1, localEdgeChecks: 0,
        localPhaseUsed: false, straightPhaseTruncated: false }, connectors: { from: null, to: null }, qualification: {
        captureSha256: context.storage!.capture!.sha256, pureVerificationSha256: 'f'.repeat(64), decompositionSha256: '1'.repeat(64),
        computationalMemberships: [membership()] } } });
}

describe('immutable protected worker request projection', () => {
  it('dispatches the exact admitted context and numeric options without sending the smaller authoring intent', () => {
    const dependencies = protectedDependencies(), before = structuredClone(dependencies);
    const request = buildCableEngineRequest(dependencies, id(50), 12000), { barrierRouting: _intent, ...numeric } = dependencies.options;
    expect(request).toEqual({ schemaVersion: 'pathfinder.model.runner.v2', requestId: id(50), operation: 'calculate',
      projectId: id(1), modelVersionId: id(2), snapshotId: id(3), snapshotSha256: 'd'.repeat(64), timeoutMilliseconds: 12000,
      includeLengthLedger: true, barriers: dependencies.barriers, directSecondaryPolicy: DIRECT_SECONDARY_POLICY, category: 'Control',
      from: { x: -.1, y: .75, z: .1 }, to: { x: .3, y: .75, z: .1 }, options: numeric,
      projectSettings: { revision: '3', secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '10' } });
    expect(request.barriers).toBe(dependencies.barriers); expect(request.options).not.toHaveProperty('barrierRouting');
    expect(request).not.toHaveProperty('barrierRouting'); expect(request).not.toHaveProperty('route'); expect(dependencies).toEqual(before);
  });
  it.each(['LV', 'Control', 'Instrumentation'])('explicitly includes the production direct decision policy for %s', category => {
    const dependencies = protectedDependencies(); dependencies.cableInputs.mto = category;
    expect(cableDirectSecondaryPolicy(dependencies)).toBe(DIRECT_SECONDARY_POLICY);
    expect(buildCableEngineRequest(dependencies, id(50), 12000)).toMatchObject({ schemaVersion: 'pathfinder.model.runner.v2',
      category, directSecondaryPolicy: DIRECT_SECONDARY_POLICY });
  });
  it('does not opt MV into direct SECONDARY or claim an MV route was computed', () => {
    const dependencies = protectedDependencies(); dependencies.cableInputs.mto = 'MV';
    expect(cableDirectSecondaryPolicy(dependencies)).toBeNull();
    expect(buildCableEngineRequest(dependencies, id(50), 12000)).not.toHaveProperty('directSecondaryPolicy');
  });
  it('refuses retained design-only execution even when an earlier protected proposal has an exact route and proof', () => {
    const dependencies = protectedDependencies(meshContext()), response = fallback(dependencies.barriers), before = structuredClone(response);
    expect(() => buildCableEngineRequest(dependencies, id(51), 12000, response))
      .toThrowError(expect.objectContaining({ code: 'ENGINE_RETAINED_GEOMETRY_INVALID', status: 502 }));
    expect(response).toEqual(before);
  });
  it('retains historical v5 and scoped v7 execution versions without automatically admitting barriers', () => {
    for (const dependencies of [historical(), scoped()]) {
      const before = structuredClone(dependencies), request = buildCableEngineRequest(dependencies, id(50), 12000);
      expect(request.schemaVersion).toBe('pathfinder.model.runner.v1'); expect(request).not.toHaveProperty('barriers');
      expect(dependencies).toEqual(before);
    }
  });
  it('rejects a typed refusal for a different frozen context before allowing it to pass through the worker', () => {
    const dependencies = protectedDependencies(), response = unavailable(dependencies.barriers);
    expect(() => requireCableEngineStrategy(response, dependencies)).not.toThrow();
    const crossed = protectedDependencies(); crossed.barriers.binding.scope.captureFrameSha256 = '0'.repeat(64);
    expect(() => requireCableEngineStrategy(response, crossed))
      .toThrowError(expect.objectContaining({ code: 'ENGINE_BARRIER_STRATEGY_INVALID', status: 502 }));
  });
  it('never upgrades a historical error response into a protected v8 result', () => {
    const dependencies = protectedDependencies(), response: EngineResponse = { schemaVersion: 'pathfinder.model.response.v1',
      requestId: id(50), status: 'invalid_request', message: 'Historical refusal.', engineeringAccepted: false };
    expect(() => requireCableEngineStrategy(response, dependencies))
      .toThrowError(expect.objectContaining({ code: 'ENGINE_BARRIER_STRATEGY_INVALID' }));
    expect(response.schemaVersion).toBe('pathfinder.model.response.v1'); expect(response).not.toHaveProperty('barriers');
  });
});

describe('barrier admission failure before engine dispatch',()=>{
  it('retains a valid mixed failure with no route, qualification or geometric authority',()=>{
    const policy=createMixedBarrierRuntimePolicy(true);
    const context=mixedBarrierRuntimeContextSchema.parse({schemaVersion:'wfc.pf.barrier-runtime.v2',
      binding:{schemaVersion:'wfc.pf.barrier-calculation-binding.v2',scope:scope(),registryRevision:'0',snapshot:null,policy,policySha256:digest(policy)},
      profile:MIXED_BARRIER_RUNTIME_PROFILE,profileSha256:digest(MIXED_BARRIER_RUNTIME_PROFILE),storage:null});
    const response=unavailableBarrierEngineResponse(id(81),context,'BARRIER_CALCULATION_SCOPE_CHANGED');
    expect(engineResponseSchema.parse(response)).toEqual(response);
    expect(response).toMatchObject({status:'invalid_request',engineeringAccepted:false,barriers:{schemaVersion:'wfc.pf.barrier-execution.v2',
      context,proof:null,qualification:null,engineeringAccepted:false,ownTerminalExemptionsSupported:false,authority:'none',
      diagnostics:{status:'unavailable',collisionQueries:0,work:'0'}}});
    expect(response).not.toHaveProperty('route');expect(response).not.toHaveProperty('design');
  });
  it('preserves the strict legacy failure without mixed authority fields',()=>{
    const response=unavailableBarrierEngineResponse(id(82),syntheticDrillingRuntime(scope()),'BARRIER_CALCULATION_SCOPE_CHANGED');
    expect(engineResponseSchema.parse(response)).toEqual(response);
    if(response.schemaVersion!=='pathfinder.model.response.v3')throw Error('fixture');
    expect(response.barriers.schemaVersion).toBe('wfc.pf.barrier-execution.v1');
    expect(response.barriers).not.toHaveProperty('authority');expect(response.barriers).not.toHaveProperty('ownTerminalExemptionsSupported');
    expect(response).not.toHaveProperty('route');
  });
});

describe('protected standalone preview projection', () => {
  it.each([false, true])('retains exact admitted endpoints and passes reverse=%s to C# without pre-reversing geometry', reverse => {
    const dependencies = preview(protectedDependencies(), reverse), before = structuredClone(dependencies);
    const request = previewEngineRequest(dependencies, id(50), 9000), { barrierRouting: _intent, ...numeric } = dependencies.options;
    expect(request).toMatchObject({ schemaVersion: 'pathfinder.model.runner.v2', requestId: id(50), operation: 'calculate',
      category: 'Control', reverse, barriers: dependencies.barriers, directSecondaryPolicy: DIRECT_SECONDARY_POLICY,
      from: { x: -.1, y: .75, z: .1 }, to: { x: .3, y: .75, z: .1 }, options: numeric, timeoutMilliseconds: 9000 });
    expect(request.barriers).toBe(dependencies.barriers); expect(request.options).not.toHaveProperty('barrierRouting');
    expect(request).not.toHaveProperty('barrierRouting'); expect(dependencies).toEqual(before);
  });
  it.each(['LV', 'Control', 'Instrumentation'] as const)('opts a %s preview into the same explicit constrained decision policy', category => {
    const dependencies = preview(); dependencies.input.category = category;
    expect(previewEngineRequest(dependencies, id(50), 9000).directSecondaryPolicy).toBe(DIRECT_SECONDARY_POLICY);
  });
  it('leaves MV previews outside the direct decision policy', () => {
    const dependencies = preview(); dependencies.input.category = 'MV';
    expect(previewEngineRequest(dependencies, id(50), 9000)).not.toHaveProperty('directSecondaryPolicy');
  });
  it('does not silently upgrade an old v5 preview into the protected execution version', () => {
    const { schemaVersion: _version, engineIdentity: _identity, barriers: _barriers, ...body } = preview();
    const { barrierRouting: _intent, ...options } = body.options, { barrierRouting: _inputIntent, ...input } = body.input;
    const dependencies: HistoricalPreviewDependencies = { ...body, schemaVersion: 'pathfinder.preview.dependencies.v5',
      engineIdentity: syntheticEngineIdentity(), options, input };
    const request = previewEngineRequest(dependencies, id(50), 9000);
    expect(request.schemaVersion).toBe('pathfinder.model.runner.v1'); expect(request).not.toHaveProperty('barriers');
  });
  it.each([false, true])('retains an honest typed refusal and endpoint ordering for reverse=%s without a fabricated route or acceptance', reverse => {
    const dependencies = preview(protectedDependencies(), reverse), response = unavailable(dependencies.barriers), before = structuredClone(response);
    const dto = previewResultDto(response, dependencies, true);
    expect(dto).toMatchObject({ status: 'no_path', engineeringAccepted: false, acceptanceScope: 'standalone-preview', canApply: false,
      stale: true, route: null, design: null, effectiveCategory: null, from: reverse ? dependencies.to : dependencies.from,
      to: reverse ? dependencies.from : dependencies.to, barriers: response.barriers });
    expect(dto).not.toHaveProperty('directSecondary'); expect(response).toEqual(before);
  });
  it('keeps the rejected direct chord inside barrier evidence while displaying the actual tray routing and design', () => {
    const dependencies = preview(protectedDependencies(meshContext())), response = fallback(dependencies.barriers), before = structuredClone(response);
    const dto = previewResultDto(response, dependencies, false);
    expect(response.barriers.directSecondary!.distanceDecision.mode).toBe('direct-secondary');
    expect(dto.barriers!.directSecondary).toMatchObject({ mode: 'tray-network', directCheck: { status: 'blocked' },
      reasonCode: 'DIRECT_SECONDARY_BLOCKED_TRAY_FALLBACK' });
    expect(dto).not.toHaveProperty('directSecondary');
    expect(dto.route).toMatchObject({ routeText: '/BC001', points: [fromPoint, [-.1, 0, .1], [.3, 0, .1], toPoint], objectIds: ['segment-1'] });
    expect(dto.design).toEqual({ lengthBeforePercentageMeters: '6.9', unroundedLengthMeters: '7.59', designLengthMeters: '8' });
    expect(dto.route!.pathPoints).toBeUndefined(); expect(dto.canApply).toBe(false); expect(dto.stale).toBe(false);
    expect(response).toEqual(before);
  });
  it('rejects a legacy preview result and a crossed protected context instead of decorating either as current', () => {
    const dependencies = preview(), response = unavailable(dependencies.barriers);
    const legacy: EngineResponse = { schemaVersion: 'pathfinder.model.response.v1', requestId: id(50), status: 'no_path',
      message: 'Historical result.', engineeringAccepted: false };
    expect(() => previewResultDto(legacy, dependencies, false)).toThrowError(expect.objectContaining({ code: 'ENGINE_BARRIER_STRATEGY_INVALID' }));
    dependencies.barriers.binding.scope.captureFrameSha256 = '0'.repeat(64);
    expect(() => previewResultDto(response, dependencies, false)).toThrowError(expect.objectContaining({ code: 'ENGINE_BARRIER_STRATEGY_INVALID' }));
  });
});
