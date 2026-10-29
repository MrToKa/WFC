import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/pathfinderPreparation';
import { preparationFixture, preparationIds as ids } from '@/test/preparationFixtures';
import { useProjectPreparation } from './useProjectPreparation';
import type { usePathFinder } from './usePathFinder';
import {completedEvidenceFixture,geometryTraceFixture} from '@/test/geometryTraceFixtures';
import {saveCaptureEvidence,createGeometryTrace,fetchGeometryTraces,fetchGeometryTraceManifest,GeometryTraceApiError,
  type GeometryTraceManifest} from '@/api/pathfinderGeometryTrace';
import { bindCompletedCaptureEvidence } from '../../../../viewer-runtime/capture-evidence.mjs';
import type { PathFinderState } from '@/api/pathfinder';
import { PREPARATION_MATCHING_POLICY } from '../../../../viewer-runtime/preparation-input.mjs';
import type { PreparationDiscoveryPage, PreparationDiscoveryRequest } from '../../../../viewer-runtime/preparation-input.mjs';
import type { ProjectPreparationViewer } from './usePathFinder';
import * as discoveryCollection from './collectPreparationDiscovery';
import type { PreparationContext, PreparationDiscovery, PreparationSession } from '../../../../shared/pathfinderPreparation';
type HumanPreparationSession = Extract<PreparationSession, {schemaVersion:'wfc.pf.preparation-session.v1'}>;
vi.mock('../../../../viewer-runtime/capture-evidence.mjs', async original => {
  const actual = await original<typeof import('../../../../viewer-runtime/capture-evidence.mjs')>();
  return { ...actual, bindCompletedCaptureEvidence: vi.fn(actual.bindCompletedCaptureEvidence) };
});
vi.mock('@/api/pathfinderGeometryTrace',async original=>({...await original<typeof import('@/api/pathfinderGeometryTrace')>(),saveCaptureEvidence:vi.fn(),createGeometryTrace:vi.fn(),fetchGeometryTraces:vi.fn(),fetchGeometryTraceManifest:vi.fn()}));
vi.mock('@/api/pathfinderPreparation', async (original) => ({
  ...(await original<typeof api>()),
  fetchPreparationContext: vi.fn(),
  fetchPreparationIndex: vi.fn(),
  fetchPreparationSession: vi.fn(),
  createPreparation: vi.fn(),
  savePreparationResolution: vi.fn(),
  uploadPreparationPart: vi.fn(),
  mutatePreparation: vi.fn(),
}));
function setup() {
  const fixture = preparationFixture();
  vi.mocked(fetchGeometryTraces).mockImplementation(async (projectId, _token, offset = 0) => ({ schemaVersion: 'wfc.pf.geometry-trace-list.v1', projectId, offset, nextOffset: null, traces: [] }));
  vi.mocked(fetchGeometryTraceManifest).mockRejectedValue(new GeometryTraceApiError('GEOMETRY_TRACE_NOT_FOUND', 404, 'No trace', 'refused'));
  vi.mocked(createGeometryTrace).mockRejectedValue(new Error('Unexpected trace creation'));
  vi.mocked(api.fetchPreparationContext).mockResolvedValue(fixture.context);
  vi.mocked(api.fetchPreparationIndex).mockResolvedValue({
    schemaVersion: 'wfc.pf.preparation-index.v1',
    sessions: [
      {
        id: ids.session,
        state: 'planned',
        sessionRevision: '1',
        createdAt: fixture.session.createdAt,
        idempotencyKey: ids.login,
      },
    ],
  });
  vi.mocked(api.fetchPreparationSession).mockResolvedValue(fixture.session);
  const pf = {
    preparationAccess: {
      projectId: ids.project,
      loadedProjectId: ids.project,
      token: 'login',
      isAdmin: true,
    },
    preparationViewerGeneration: 1,
    viewerPhase: 'ready',
    cancelOperation: vi.fn(),
    refresh: vi.fn(),
    reloadViewer: vi.fn(),
    runProjectPreparation: vi.fn(async (_expected, operation) =>
      operation({
        assertCurrent: () => {},
        capture: vi.fn().mockResolvedValue({ snapshot: { synthetic: true },summary:{} }),
      }),
    ),
  } as unknown as ReturnType<typeof usePathFinder>;
  return { ...fixture, pf };
}
beforeEach(() => vi.clearAllMocks());
function withModel(pf: ReturnType<typeof usePathFinder>, scope: ReturnType<typeof preparationFixture>['context']['scope']) {
  const data: PathFinderState = { schemaVersion: 1, projectId: ids.project, registryRevision: scope.locationRegistryRevision,
    activeModel: { modelVersionId: scope.modelVersionId, selectionRevision: scope.selectionRevision, contentFingerprint: scope.contentFingerprint },
    settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '10' },
    cables: [], locations: [], artifacts: [], jobs: [], proposals: [] };
  return { ...pf, data };
}

function automaticSetup() {
  const fixture = setup();
  const store = { context: structuredClone(fixture.context), sessions: new Map<string, PreparationSession>(),
    traces: new Map<string, GeometryTraceManifest>(),
    skippedTrays: [] as Array<{projectTrayId:string;reason:'TRAY_ROOT_MISSING'|'TRAY_ROOT_AMBIGUOUS'}> };
  const discovery: PreparationDiscovery = {
    schemaVersion: 'wfc.pf.discovery-report.v1', modelVersionId: store.context.scope.modelVersionId,
    contentFingerprint: store.context.scope.contentFingerprint, selectionRevision: store.context.scope.selectionRevision,
    matchingPolicyVersion: PREPARATION_MATCHING_POLICY,
    visibilityScope: { schemaVersion: 'wfc.pf.sdk-display-visibility.v1', basis: 'sdk-display-before-pf-appearance', contentSha256: 'a'.repeat(64) },
    endpointScope: { schemaVersion: 'wfc.pf.endpoint-discovery-scope.v1', mode: 'not-requested' },
    complete: true, propertyScan: null, objects: fixture.session.plan.objectManifest,
    trays: [{ projectTrayId: ids.tray, candidateRootObjectIds: ['dbid:1'] }], endpointCandidates: [],
  };
  const discover = vi.spyOn(discoveryCollection, 'collectPreparationDiscovery').mockResolvedValue(discovery);
  const capture = vi.fn().mockResolvedValue({ snapshot: { synthetic: true }, summary: {} });
  vi.mocked(fixture.pf.runProjectPreparation).mockImplementation(async (_scope, operation) => operation({
    assertCurrent: () => {}, capture, discover: vi.fn(), readSelection: vi.fn(), readTrayRootSelection: vi.fn(),
    captureBarriers: vi.fn(), publishBarriers: vi.fn(),
  }));
  const makeSession = (id = crypto.randomUUID()): HumanPreparationSession => ({
    ...structuredClone(fixture.session), id, createdAt: new Date().toISOString(),
    plan: { ...structuredClone(fixture.session.plan), ...store.context.scope, id,
      requestedScope: { ...structuredClone(fixture.session.plan.requestedScope),
        scopeKind: 'server-requested-project-routing-only',
        endpointScope: { schemaVersion: 'wfc.pf.endpoint-discovery-scope.v1', mode: 'not-requested' },
        endpointNames: [...store.context.endpointNames], unresolvedTrayPolicy: 'skip', skippedTrays: [...store.skippedTrays],
        excludedProjectTrayIds: store.skippedTrays.map(tray => tray.projectTrayId),
      } },
  });
  vi.mocked(api.fetchPreparationContext).mockImplementation(async () => structuredClone(store.context));
  vi.mocked(api.fetchPreparationIndex).mockImplementation(async () => ({ schemaVersion: 'wfc.pf.preparation-index.v1',
    sessions: [...store.sessions.values()].reverse().map(session => ({ id: session.id, state: session.state,
      sessionRevision: session.sessionRevision, createdAt: session.createdAt, idempotencyKey: ids.login })) }));
  vi.mocked(api.fetchPreparationSession).mockImplementation(async (_project, _token, id) => {
    const session = store.sessions.get(id); if (!session) throw Error('Unknown fixture session'); return structuredClone(session);
  });
  const createKeys = new Map<string, string>();
  const create = vi.fn(async (_project: string, _token: string, input: api.PreparationCreate) => {
    const previous = createKeys.get(input.idempotencyKey); if (previous) return structuredClone(store.sessions.get(previous)!);
    const session = makeSession(); store.sessions.set(session.id, session); createKeys.set(input.idempotencyKey, session.id); return structuredClone(session);
  });
  vi.mocked(api.createPreparation).mockImplementation(create);
  const commitPart = (sessionId: string) => {
    const session = store.sessions.get(sessionId)!;
    if (session.schemaVersion !== 'wfc.pf.preparation-session.v1') throw Error('Expected a human fixture session');
    const committed = { ...structuredClone(fixture.committed), sessionId, sessionPlanSha256: session.plan.orderedPlanSha256 };
    store.sessions.set(sessionId, { ...session, state: 'collecting', sessionRevision: '2', parts: [committed],
      coverage: { expectedParts: 1, committedParts: 1, requestedScopeComplete: true, missingPartIds: [] } });
    return { schemaVersion: 'wfc.pf.preparation-part-receipt.v1' as const, part: committed, sessionRevision: '2', duplicate: false };
  };
  vi.mocked(api.uploadPreparationPart).mockImplementation(async (_project, _token, sessionId) => commitPart(sessionId));
  const publishSession = (session: PreparationSession) => {
    const aggregateId = crypto.randomUUID(), registryRevision = String(BigInt(store.context.scope.locationRegistryRevision) + 1n);
    const aggregate: NonNullable<PreparationContext['currentAggregate']> = {
      ...store.context.scope, schemaVersion: 'wfc.pf.geometry-aggregate.v1', id: aggregateId, projectId: ids.project, sessionId: session.id,
      artifactId: crypto.randomUUID(), geometryRevision: '1', sourceLocationRegistryRevision: session.plan.locationRegistryRevision,
      locationRegistryRevision: registryRevision, coordinateFrameId: session.plan.coordinateFrameId,
      orderedPlanSha256: session.plan.orderedPlanSha256, orderedScopeSha256: session.plan.requestedScope.scopeSha256,
      partReferences: session.plan.partPlan.map(part => ({ partId: part.partId, partIndex: part.partIndex, payloadSha256: fixture.committed.payloadSha256 })),
      projection: { schemaVersion: 'synthetic', payloadRef: crypto.randomUUID(), sha256: 'a'.repeat(64), bytes: 1 },
      traceIndex: { schemaVersion: 'synthetic', payloadRef: crypto.randomUUID(), sha256: 'b'.repeat(64), bytes: 1 },
      counts: { objects: 1, physicalLeaves: 1, fragments: 1, vertices: 3, triangles: 1 }, requestedScopeComplete: true,
      wholePlantGeometry: false, engineVersion: 'fixture', rulesVersion: 'fixture', diagnostics: [], engineeringAccepted: false,
      nativeParity: 'not-performed', publishedAt: new Date().toISOString(),
    };
    store.context = { ...store.context, scope: { ...store.context.scope, locationRegistryRevision: registryRevision }, currentAggregate: aggregate };
    store.sessions.set(session.id, { ...session, state: 'published', sessionRevision: '3', recovery: null, publishedAggregateId: aggregateId });
    return { schemaVersion: 'wfc.pf.preparation-publication.v1' as const, sessionId: session.id, aggregate, duplicate: false };
  };
  vi.mocked(api.mutatePreparation).mockImplementation(async (_project, _token, sessionId, operation) => {
    if (operation !== 'publish') throw Error('Unexpected fixture cancellation'); return publishSession(store.sessions.get(sessionId)!);
  });
  vi.mocked(api.savePreparationResolution).mockImplementation(async (_project, _token, input) => {
    const revision = String(BigInt(store.context.scope.resolutionRevision) + 1n);
    const resolution = { id: crypto.randomUUID(), projectTrayId: input.projectTrayId, mode: 'roots' as const,
      rootObjectIds: [...input.rootObjectIds], reason: input.reason, actorId: ids.actor, createdAt: new Date().toISOString(), scope: input.expected };
    store.context = { ...store.context, scope: { ...store.context.scope, resolutionRevision: revision },
      resolutions: [...store.context.resolutions.filter(saved => saved.projectTrayId !== input.projectTrayId), resolution] };
    return { schemaVersion: 'wfc.pf.preparation-resolution-receipt.v1', resolutionRevision: revision, resolution, duplicate: false };
  });
  const makeTrace = (aggregate = store.context.currentAggregate!): GeometryTraceManifest => ({
    ...structuredClone(geometryTraceFixture().manifest), id: crypto.randomUUID(), projectId: aggregate.projectId,
    aggregateId: aggregate.id, modelVersionId: aggregate.modelVersionId, sessionId: aggregate.sessionId,
    geometryRevision: aggregate.geometryRevision, captureFrameId: aggregate.coordinateFrameId,
    projection: { payloadRef: aggregate.projection.payloadRef, sha256: aggregate.projection.sha256, bytes: aggregate.projection.bytes },
    counts: { ...geometryTraceFixture().manifest.counts, objects: aggregate.counts.objects, segments: aggregate.counts.physicalLeaves },
  });
  vi.mocked(fetchGeometryTraces).mockImplementation(async (projectId, _token, offset = 0) => ({ schemaVersion: 'wfc.pf.geometry-trace-list.v1',
    projectId, offset, nextOffset: null, traces: [...store.traces.values()].map(({ id, projectId, modelVersionId, aggregateId, geometryRevision, derivationVersion, counts, contentSha256, createdAt }) =>
      ({ id, projectId, modelVersionId, aggregateId, geometryRevision, derivationVersion, counts, contentSha256, createdAt })) }));
  vi.mocked(fetchGeometryTraceManifest).mockImplementation(async (_project, _token, id) => {
    const manifest = [...store.traces.values()].find(trace => trace.id === id); if (!manifest) throw new GeometryTraceApiError('GEOMETRY_TRACE_NOT_FOUND', 404, 'No trace', 'refused');
    return structuredClone(manifest);
  });
  const traceKeys = new Map<string, string>();
  const createTrace = vi.fn(async (_project: string, _token: string, command: Parameters<typeof createGeometryTrace>[2]) => {
    const known = store.traces.get(command.aggregateId);
    if (known) { traceKeys.set(command.idempotencyKey, known.id); return { schemaVersion: 'wfc.pf.geometry-trace-receipt.v1' as const, trace: structuredClone(known), duplicate: true }; }
    const trace = makeTrace(); store.traces.set(trace.aggregateId, trace); traceKeys.set(command.idempotencyKey, trace.id);
    return { schemaVersion: 'wfc.pf.geometry-trace-receipt.v1' as const, trace: structuredClone(trace), duplicate: false };
  });
  vi.mocked(createGeometryTrace).mockImplementation(createTrace);
  return { ...fixture, store, makeSession, publishSession, capture, discover, discovery, create, commitPart, makeTrace, createTrace };
}
describe('project preparation lifecycle', () => {
  it('manual tray discovery does not read endpoint properties or ancestors even with project From/To names', async () => {
    const { pf, context } = setup();
    vi.mocked(api.fetchPreparationContext).mockResolvedValue({ ...context, endpointNames: ['TAG-1'] });
    const discover = vi.fn(async (request: PreparationDiscoveryRequest): Promise<PreparationDiscoveryPage> => ({
      schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: request.mode, rootObjectId: request.rootObjectId,
      names: request.names, cursor: request.cursor, matchingPolicyVersion: PREPARATION_MATCHING_POLICY,
      visibilityScope: { schemaVersion: 'wfc.pf.sdk-display-visibility.v1', basis: 'sdk-display-before-pf-appearance', contentSha256: 'a'.repeat(64) },
      indexedObjectCount: 1, propertyScan: null, nextCursor: null, complete: true,
      objects: [{ objectId: 1, parentId: null, name: 'Tray 01', hasGeometry: true, isPhysicalLeaf: true, orderIndex: 0,
        matchedNames: request.mode === 'names' ? ['Tray 01'] : [] }],
    }));
    vi.mocked(pf.runProjectPreparation).mockImplementation(async (_scope, operation) => operation({ assertCurrent: vi.fn(), discover } as unknown as ProjectPreparationViewer));
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.context).not.toBeNull()); await act(() => result.current.discover());
    expect(result.current.discovery?.complete).toBe(true);
    expect(discover.mock.calls.every(([request]) => request.mode === 'names' || request.mode === 'subtree')).toBe(true);
    expect(result.current.discovery?.propertyScan).toBeNull();
    expect(result.current.notice).toContain('From/To locations are searched separately');
  });
  it('clears an earlier discovery on a failed new attempt, retains its precise last stage, and never freezes partial evidence', async () => {
    const { pf, context, session } = setup(); let fail = false;
    const io: ProjectPreparationViewer = { assertCurrent: () => {}, readSelection: vi.fn(), readTrayRootSelection: vi.fn(),
      capture: vi.fn(), captureBarriers: vi.fn(), publishBarriers: vi.fn(), discover: vi.fn(async (request: PreparationDiscoveryRequest): Promise<PreparationDiscoveryPage> => {
        if (fail && request.mode === 'subtree') throw Object.assign(new Error('No SDK detail'), { code: 'EXTRACTION_FAILED' });
        return { schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: request.mode, rootObjectId: request.rootObjectId,
          names: request.names, cursor: request.cursor, matchingPolicyVersion: PREPARATION_MATCHING_POLICY,
          visibilityScope: { schemaVersion: 'wfc.pf.sdk-display-visibility.v1', basis: 'sdk-display-before-pf-appearance', contentSha256: 'a'.repeat(64) },
          indexedObjectCount: 1, propertyScan: null, nextCursor: null, complete: true,
          objects: [{ objectId: 1, parentId: null, name: 'Tray 01', hasGeometry: true, isPhysicalLeaf: true, orderIndex: 0,
            matchedNames: request.mode === 'names' ? ['Tray 01'] : [] }] };
      }) };
    vi.mocked(pf.runProjectPreparation).mockImplementation(async (_scope, operation) => operation(io));
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.context).not.toBeNull()); await act(() => result.current.discover());
    expect(result.current.discovery?.complete).toBe(true); fail = true; await act(() => result.current.discover());
    expect(result.current.discovery).toBeNull(); expect(result.current.progress).toContain('0 of 1 distinct roots completed');
    expect(result.current.error).toContain('Tray-root discovery stopped at dbid:1 (Tray 01)');
    expect(result.current.error).toContain('EXTRACTION_FAILED'); expect(result.current.error).toContain('published network is unchanged');
    expect(result.current.error).not.toContain('safety limits'); expect(result.current.context).toEqual(context); expect(result.current.session).toEqual(session);
    expect(result.current.busy).toBe(false); expect(result.current.unknown).toBe(false);
    await act(() => result.current.freezePlan());
    expect(api.createPreparation).not.toHaveBeenCalled(); expect(api.uploadPreparationPart).not.toHaveBeenCalled(); expect(api.mutatePreparation).not.toHaveBeenCalled();
  });
  it('defers cold hidden controls until first Routes activation, then retains loaded controls across switches without 3D readiness', async () => {
    const { pf, context } = setup(), cold = { ...pf, viewerPhase: 'error' as const };
    const { result, rerender } = renderHook(({ active }) => useProjectPreparation(cold, active), { initialProps: { active: false } });
    expect(api.fetchPreparationContext).not.toHaveBeenCalled(); expect(api.fetchPreparationIndex).not.toHaveBeenCalled(); expect(api.fetchPreparationSession).not.toHaveBeenCalled();
    rerender({ active: true }); await waitFor(() => expect(result.current.context).toEqual(context));
    expect(api.fetchPreparationContext).toHaveBeenCalledTimes(1); expect(api.fetchPreparationIndex).toHaveBeenCalledTimes(1);
    rerender({ active: false }); expect(result.current.context).toEqual(context); expect(result.current.canMutate).toBe(false);
    rerender({ active: true }); expect(result.current.context).toEqual(context); expect(api.fetchPreparationContext).toHaveBeenCalledTimes(1);
    await act(() => result.current.refresh()); expect(api.fetchPreparationContext).toHaveBeenCalledTimes(2); expect(pf.runProjectPreparation).not.toHaveBeenCalled();
  });
  it('permits explicit hidden refresh and does not repeat its reads on first activation', async () => {
    const { pf } = setup();
    const { result, rerender } = renderHook(({ active }) => useProjectPreparation(pf, active), { initialProps: { active: false } });
    await act(() => result.current.refresh()); expect(result.current.session?.id).toBe(ids.session);
    rerender({ active: true }); expect(api.fetchPreparationContext).toHaveBeenCalledTimes(1); expect(api.fetchPreparationIndex).toHaveBeenCalledTimes(1);
  });
  it('retains the durable exact reconciliation command across tool switches and retries without a ready viewer', async () => {
    const { pf, session } = setup(), command = { schemaVersion: 'wfc.pf.preparation-mutation.v1' as const, expectedSessionRevision: '2', idempotencyKey: ids.login, reason: 'Recover retained validation' };
    vi.mocked(api.fetchPreparationSession).mockResolvedValue({ ...session, state: 'validating', recovery: { command, actorId: ids.actor, loginId: ids.login, expiresAt: '2026-10-21T00:00:00Z' } });
    vi.mocked(api.mutatePreparation).mockRejectedValueOnce(new api.PreparationApiError('PREPARATION_VALIDATION_IN_PROGRESS', 503, 'Validation still running', 'unknown'));
    const cold = { ...pf, viewerPhase: 'error' as const };
    const { result, rerender } = renderHook(({ active }) => useProjectPreparation(cold, active), { initialProps: { active: false } });
    expect(api.fetchPreparationContext).not.toHaveBeenCalled(); rerender({ active: true }); await waitFor(() => expect(result.current.unknown).toBe(true));
    rerender({ active: false }); expect(result.current.publishPending).toBe(true); expect(result.current.unknown).toBe(true);
    await act(() => result.current.retry()); expect(vi.mocked(api.mutatePreparation).mock.calls[0][4]).toBe(command);
    rerender({ active: true }); expect(result.current.unknown).toBe(true); expect(api.fetchPreparationContext).toHaveBeenCalledTimes(1); expect(pf.runProjectPreparation).not.toHaveBeenCalled();
  });
  it('pauses protected collection on leaving Routes while retaining the frozen session for Resume', async () => {
    const { pf } = setup();
    vi.mocked(pf.runProjectPreparation).mockImplementation(async (_scope, operation, signal) => operation({ assertCurrent: () => {}, capture: () => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new DOMException('Paused', 'AbortError')), { once: true });
    }) } as never));
    const { result, rerender } = renderHook(({ active }) => useProjectPreparation(pf, active), { initialProps: { active: true } });
    await waitFor(() => expect(result.current.session).not.toBeNull()); let collecting!: Promise<void>;
    act(() => { collecting = result.current.collect(); }); await waitFor(() => expect(result.current.progress).toContain('Collecting part'));
    const reads = vi.mocked(api.fetchPreparationContext).mock.calls.length; rerender({ active: false }); await act(async () => { await collecting; });
    expect(result.current.session?.id).toBe(ids.session); expect(result.current.notice).toContain('Collection paused'); expect(result.current.unknown).toBe(false);
    expect(api.uploadPreparationPart).not.toHaveBeenCalled(); rerender({ active: true }); expect(result.current.session?.id).toBe(ids.session); expect(api.fetchPreparationContext).toHaveBeenCalledTimes(reads);
  });
  it('resets lazy initialization for a new login and refuses reads after access loss', async () => {
    const { pf } = setup();
    const { result, rerender } = renderHook(({ current, active }) => useProjectPreparation(current, active), { initialProps: { current: pf, active: false } });
    rerender({ current: { ...pf, preparationAccess: { ...pf.preparationAccess, token: 'next-login' } }, active: false });
    expect(api.fetchPreparationContext).not.toHaveBeenCalled();
    const next = { ...pf, preparationAccess: { ...pf.preparationAccess, token: 'next-login' } };
    rerender({ current: next, active: true }); await waitFor(() => expect(result.current.context).not.toBeNull());
    expect(api.fetchPreparationContext).toHaveBeenCalledWith(ids.project, 'next-login', expect.any(AbortSignal));
    rerender({ current: { ...next, preparationAccess: { ...next.preparationAccess, isAdmin: false } }, active: true });
    expect(result.current.enabled).toBe(false); expect(result.current.context).toBeNull(); await act(() => result.current.refresh()); expect(api.fetchPreparationContext).toHaveBeenCalledTimes(1);
  });
  it.each(['context', 'session'] as const)('fences a changed model after the awaited %s read without accepting old control evidence', async stage => {
    const { pf, context, session } = setup(), original = withModel(pf, context.scope);
    let finish!: () => void;
    if (stage === 'context') vi.mocked(api.fetchPreparationContext).mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(context); }));
    else vi.mocked(api.fetchPreparationSession).mockReturnValueOnce(new Promise(resolve => { finish = () => resolve(session); }));
    const { result, rerender } = renderHook(({ current }) => useProjectPreparation(current, true), { initialProps: { current: original } });
    if (stage === 'session') await waitFor(() => expect(api.fetchPreparationSession).toHaveBeenCalled());
    rerender({ current: withModel(pf, { ...context.scope, modelVersionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', selectionRevision: '99', contentFingerprint: 'f'.repeat(64) }) });
    await act(async () => { finish(); }); await waitFor(() => expect(result.current.conflict).toBe(true));
    expect(result.current.context).toBeNull(); expect(result.current.session).toBeNull(); expect(result.current.error).toContain('active model changed');
    expect(result.current.unknown).toBe(false); expect(result.current.canMutate).toBe(false);
  });
  it('keeps an exact unknown mutation through a locally stale display read until authoritative reconciliation', async () => {
    const { pf, context } = setup(), original = withModel(pf, context.scope);
    vi.mocked(api.savePreparationResolution).mockRejectedValueOnce(new TypeError('Lost acknowledgement'))
      .mockRejectedValueOnce(new api.PreparationApiError('PREPARATION_SCOPE_STALE', 409, 'Authoritative stale command refusal', 'refused'));
    const { result, rerender } = renderHook(({ current, active }) => useProjectPreparation(current, active), { initialProps: { current: original, active: true } });
    await waitFor(() => expect(result.current.context).not.toBeNull()); await act(() => result.current.resolve(ids.tray, 'exclude', [], 'Reviewed routing decision'));
    const command = vi.mocked(api.savePreparationResolution).mock.calls[0][2]; expect(result.current.unknown).toBe(true);
    const changed = withModel(pf, { ...context.scope, selectionRevision: '99' }); rerender({ current: changed, active: false });
    await act(() => result.current.refresh()); expect(result.current.conflict).toBe(true); expect(result.current.unknown).toBe(true);
    await act(() => result.current.retry()); expect(vi.mocked(api.savePreparationResolution).mock.calls[1][2]).toBe(command); expect(result.current.unknown).toBe(false);
    expect(result.current.conflict).toBe(true); expect(api.savePreparationResolution).toHaveBeenCalledTimes(2);
  });
  it('does not install old evidence commands after the login changes during hashing', async () => {
    const { pf, committed } = setup(), evidence = await completedEvidenceFixture();
    let finishHash!: (value: typeof evidence) => void;
    vi.mocked(bindCompletedCaptureEvidence).mockImplementationOnce(() => new Promise(resolve => { finishHash = resolve; }));
    vi.mocked(pf.runProjectPreparation).mockImplementation(async (_scope, operation) => operation({ assertCurrent: () => {}, capture: vi.fn().mockResolvedValue({ snapshot: { synthetic: true }, summary: { completedEvidence: evidence } }) } as never));
    vi.mocked(api.uploadPreparationPart).mockResolvedValue({ schemaVersion: 'wfc.pf.preparation-part-receipt.v1', part: committed, sessionRevision: '2', duplicate: false });
    vi.mocked(api.savePreparationResolution).mockResolvedValue({} as never);
    const { result, rerender } = renderHook(({ current }) => useProjectPreparation(current, true), { initialProps: { current: pf } });
    await waitFor(() => expect(result.current.session).not.toBeNull());
    let collecting!: Promise<void>;
    act(() => { collecting = result.current.collect(); });
    await waitFor(() => expect(finishHash).toBeTypeOf('function'));
    rerender({ current: { ...pf, preparationAccess: { ...pf.preparationAccess, token: 'next-login' } } });
    await waitFor(() => expect(result.current.session).not.toBeNull());
    await act(async () => { finishHash(evidence); await collecting; });
    expect(saveCaptureEvidence).not.toHaveBeenCalled();
    await act(() => result.current.resolve(ids.tray, 'reset', [], 'New login command'));
    expect(api.savePreparationResolution).toHaveBeenCalledOnce();
  });
  it('does not erase the new login exact pending command when an older write finishes late', async () => {
    const { pf } = setup();
    let finishOld!: (value: never) => void;
    vi.mocked(api.savePreparationResolution).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockRejectedValueOnce(new TypeError('Lost new login acknowledgement')).mockResolvedValueOnce({} as never);
    const { result, rerender } = renderHook(({ current }) => useProjectPreparation(current, true), { initialProps: { current: pf } });
    await waitFor(() => expect(result.current.session).not.toBeNull());
    let oldWrite!: Promise<void>;
    act(() => { oldWrite = result.current.resolve(ids.tray, 'reset', [], 'Old login command'); });
    await waitFor(() => expect(api.savePreparationResolution).toHaveBeenCalledOnce());
    rerender({ current: { ...pf, preparationAccess: { ...pf.preparationAccess, token: 'next-login' } } });
    await waitFor(() => expect(result.current.session).not.toBeNull());
    await act(() => result.current.resolve(ids.tray, 'reset', [], 'New login command'));
    const pendingBody = vi.mocked(api.savePreparationResolution).mock.calls[1][2];
    expect(result.current.unknown).toBe(true);
    await act(async () => { finishOld({} as never); await oldWrite; });
    await act(() => result.current.retry());
    expect(api.savePreparationResolution).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.savePreparationResolution).mock.calls[2][2]).toBe(pendingBody);
    expect(result.current.unknown).toBe(false);
  });
  it('distinguishes extraction, part upload and evidence wait without reporting completion early', async () => {
    const { pf, session, committed } = setup(), evidence = await completedEvidenceFixture();
    let finishCapture!: (value: never) => void, finishUpload!: (value: never) => void, finishEvidence!: (value: never) => void;
    const capture = vi.fn(() => new Promise((resolve) => { finishCapture = resolve; }));
    vi.mocked(pf.runProjectPreparation).mockImplementation(async (_scope, operation) => operation({
      assertCurrent: () => {}, readSelection: vi.fn(), discover: vi.fn(), capture,
    } as never));
    vi.mocked(api.uploadPreparationPart).mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));
    vi.mocked(saveCaptureEvidence).mockImplementation(() => new Promise((resolve) => { finishEvidence = resolve; }));
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    let collecting!: Promise<void>;
    act(() => { collecting = result.current.collect(); });
    await waitFor(() => expect(result.current.progress).toContain('Collecting part 1 of 1'));
    expect(api.uploadPreparationPart).not.toHaveBeenCalled();
    await act(async () => { finishCapture({ snapshot: { synthetic: true }, summary: { completedEvidence: evidence } } as never); });
    await waitFor(() => expect(result.current.progress).toContain('Uploading part 1 of 1'));
    expect(saveCaptureEvidence).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(true);
    await act(async () => { finishUpload({ schemaVersion: 'wfc.pf.preparation-part-receipt.v1', part: committed, sessionRevision: '2', duplicate: false } as never); });
    await waitFor(() => expect(result.current.progress).toContain('Saving capture evidence for part 1 of 1'));
    await waitFor(() => expect(saveCaptureEvidence).toHaveBeenCalledOnce());
    expect(result.current.busy).toBe(true);
    expect(capture).toHaveBeenCalledOnce();
    vi.mocked(api.fetchPreparationSession).mockResolvedValue({ ...session, state: 'collecting', parts: [committed], coverage: { expectedParts: 1, committedParts: 1, requestedScopeComplete: true, missingPartIds: [] } });
    await act(async () => { finishEvidence({} as never); await collecting; });
    expect(result.current.busy).toBe(false);
    expect(result.current.notice).toContain('Every planned part');
  });
  it('retains completed evidence after a committed part and retries only its exact unknown evidence upload',async()=>{
    const {pf,session,committed}=setup(),evidence=await completedEvidenceFixture();
    vi.mocked(pf.runProjectPreparation).mockImplementation(async(_scope,operation)=>operation({assertCurrent:()=>{},readSelection:vi.fn(),readTrayRootSelection:vi.fn(),discover:vi.fn(),captureBarriers:vi.fn(),publishBarriers:vi.fn(),capture:vi.fn().mockResolvedValue({snapshot:{synthetic:true},summary:{completedEvidence:evidence}})}));
    vi.mocked(api.uploadPreparationPart).mockImplementation(async()=>{vi.mocked(api.fetchPreparationSession).mockResolvedValue({...session,state:'collecting',parts:[committed],coverage:{expectedParts:1,committedParts:1,requestedScopeComplete:true,missingPartIds:[]}});return {schemaVersion:'wfc.pf.preparation-part-receipt.v1',part:committed,sessionRevision:'2',duplicate:false};});
    vi.mocked(saveCaptureEvidence).mockRejectedValueOnce(new TypeError('Lost evidence receipt')).mockResolvedValueOnce({} as never);
    const {result}=renderHook(()=>useProjectPreparation(pf,true));await waitFor(()=>expect(result.current.session).not.toBeNull());await act(()=>result.current.collect());expect(result.current.unknown).toBe(true);
    const first=vi.mocked(saveCaptureEvidence).mock.calls[0];expect(first[6].binding.partPayloadSha256).toBe(committed.payloadSha256);
    await act(()=>result.current.retry());expect(api.uploadPreparationPart).toHaveBeenCalledOnce();expect(vi.mocked(saveCaptureEvidence).mock.calls[1][6]).toBe(first[6]);expect(result.current.unknown).toBe(false);
  });
  it('recovers the durable exact publish command after browser restart', async () => {
    const { pf, session } = setup();
    const command = {
      schemaVersion: 'wfc.pf.preparation-mutation.v1' as const,
      expectedSessionRevision: '2',
      idempotencyKey: ids.login,
      reason: 'Original durable validation',
    };
    vi.mocked(api.fetchPreparationSession).mockResolvedValue({
      ...session,
      state: 'validating',
      recovery: {
        command,
        actorId: ids.actor,
        loginId: ids.login,
        expiresAt: '2026-10-19T23:59:00Z',
      },
    });
    vi.mocked(api.mutatePreparation).mockRejectedValue(
      new api.PreparationApiError(
        'PREPARATION_VALIDATION_IN_PROGRESS',
        503,
        'Still validating',
        'unknown',
      ),
    );
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.unknown).toBe(true));
    await act(() => result.current.retry());
    expect(vi.mocked(api.mutatePreparation).mock.calls[0][4]).toEqual(command);
    expect(result.current.unknown).toBe(true);
  });
  it('can cancel on the server with fresh CAS while publication is awaiting acknowledgement', async () => {
    const { pf, session } = setup();
    let finish!: (value: never) => void;
    vi.mocked(api.mutatePreparation).mockImplementation(async (_project, _token, _id, kind) =>
      kind === 'publish'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { ...session, state: 'cancelled', sessionRevision: '4' },
    );
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    let publishing!: Promise<void>;
    act(() => {
      publishing = result.current.publish('Publish original');
    });
    await waitFor(() => expect(result.current.publishing).toBe(true));
    vi.mocked(api.fetchPreparationSession).mockResolvedValue({
      ...session,
      state: 'validating',
      sessionRevision: '3',
    });
    await act(() => result.current.cancelActive('Stop validation'));
    expect(vi.mocked(api.mutatePreparation).mock.calls[1][4].expectedSessionRevision).toBe('3');
    expect(result.current.session?.state).toBe('cancelled');
    await act(async () => {
      finish({} as never);
      await publishing;
    });
  });
  it('retains exact uncertain command and key while refusing new mutations until explicit retry', async () => {
    const { pf } = setup();
    vi.mocked(api.savePreparationResolution)
      .mockRejectedValueOnce(new TypeError('lost acknowledgement'))
      .mockResolvedValueOnce({} as never);
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.resolve(ids.tray, 'exclude', [], 'Confirmed empty scope'));
    expect(result.current.unknown).toBe(true);
    expect(result.current.canMutate).toBe(false);
    const first = vi.mocked(api.savePreparationResolution).mock.calls[0][2];
    await act(() => result.current.resolve(ids.tray, 'reset', [], 'Different command'));
    expect(api.savePreparationResolution).toHaveBeenCalledTimes(1);
    await act(() => result.current.retry());
    expect(vi.mocked(api.savePreparationResolution).mock.calls[1][2]).toBe(first);
    expect(result.current.unknown).toBe(false);
  });
  it('keeps a confirmed write confirmed when its subsequent status refresh fails', async () => {
    const { pf } = setup();
    vi.mocked(api.savePreparationResolution).mockResolvedValue({} as never);
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.context).not.toBeNull());
    vi.mocked(api.fetchPreparationContext).mockRejectedValueOnce(
      new api.PreparationApiError('READ_FAILED', 503, 'Read unavailable', 'refused'),
    );
    await act(() => result.current.resolve(ids.tray, 'exclude', [], 'Confirmed empty scope'));
    expect(result.current.unknown).toBe(false);
    await act(() => result.current.retry());
    expect(api.savePreparationResolution).toHaveBeenCalledTimes(1);
  });
  it('resumes only missing parts and does not capture already committed geometry', async () => {
    const { pf, session, committed } = setup();
    const complete = {
      ...session,
      state: 'collecting' as const,
      parts: [committed],
      coverage: {
        expectedParts: 1,
        committedParts: 1,
        requestedScopeComplete: true,
        missingPartIds: [],
      },
    };
    vi.mocked(api.fetchPreparationSession).mockResolvedValue(complete);
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    await act(() => result.current.collect());
    expect(api.uploadPreparationPart).not.toHaveBeenCalled();
    expect(result.current.notice).toContain('Every planned part');
  });
  it('discards late reads when the current login identity changes', async () => {
    const { pf, context } = setup();
    let finish!: (value: typeof context) => void;
    vi.mocked(api.fetchPreparationContext).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result, rerender } = renderHook(({ current }) => useProjectPreparation(current, true), {
      initialProps: { current: pf },
    });
    rerender({
      current: {
        ...pf,
        preparationAccess: { ...pf.preparationAccess, token: null, isAdmin: false },
      },
    });
    await act(async () => {
      finish(context);
    });
    expect(result.current.context).toBeNull();
    expect(result.current.enabled).toBe(false);
  });
  it('renews a depleted frame once and resumes the exact missing part', async () => {
    const { pf, session, committed } = setup();
    vi.mocked(pf.runProjectPreparation).mockRejectedValueOnce(
      Object.assign(new Error('Request budget depleted'), { code: 'CAPTURE_RELOAD_REQUIRED' }),
    );
    vi.mocked(pf.reloadViewer).mockImplementation(() => {
      pf.preparationViewerGeneration++;
    });
    vi.mocked(api.uploadPreparationPart).mockImplementation(async () => {
      vi.mocked(api.fetchPreparationSession).mockResolvedValue({
        ...session,
        state: 'collecting',
        parts: [committed],
        coverage: {
          expectedParts: 1,
          committedParts: 1,
          requestedScopeComplete: true,
          missingPartIds: [],
        },
      });
      return {} as never;
    });
    const { result } = renderHook(() => useProjectPreparation(pf, true));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    await act(() => result.current.collect());
    expect(result.current.error).toBeNull();
    expect(pf.reloadViewer).toHaveBeenCalledTimes(1);
    expect(api.uploadPreparationPart).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.uploadPreparationPart).mock.calls[0].slice(2, 4)).toEqual([
      ids.session,
      ids.part,
    ]);
    expect(result.current.error).toBeNull();
  });
});

describe('automatic tray workflow', () => {
  afterEach(() => vi.restoreAllMocks());
  it('finishes a newly published aggregate with verified frame evidence before reporting ready', async () => {
    const f = automaticSetup(); const { result } = renderHook(() => useProjectPreparation(f.pf, true));
    await waitFor(() => expect(result.current.context).not.toBeNull());
    expect(result.current.networkReady).toBe(false); expect(result.current.networkReadinessKey).toBeNull();
    await act(() => result.current.checkTrays());
    expect(createGeometryTrace).toHaveBeenCalledOnce();
    expect(createGeometryTrace).toHaveBeenCalledWith(ids.project, 'login', expect.objectContaining({
      schemaVersion: 'wfc.pf.geometry-trace-create.v1', aggregateId: f.store.context.currentAggregate!.id,
      expectedProjectionSha256: f.store.context.currentAggregate!.projection.sha256,
      derivationVersion: 'wfc.pf.geometry-trace-derivation.v1',
    }), expect.any(AbortSignal));
    expect(vi.mocked(createGeometryTrace).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(api.mutatePreparation).mock.invocationCallOrder[0]);
    expect(result.current.networkReady).toBe(true); expect(result.current.networkReadinessKey).toContain(f.store.traces.get(f.store.context.currentAggregate!.id)!.id);
    expect(result.current.context!.currentAggregate).toEqual(f.store.context.currentAggregate);
  });
  it('repairs a published network without a trace once, without recapturing or republishing its geometry', async () => {
    const f = automaticSetup(), session = f.makeSession(); f.store.sessions.set(session.id, session); f.publishSession(session);
    const aggregate = structuredClone(f.store.context.currentAggregate);
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    expect(result.current.networkReady).toBe(false); expect(createGeometryTrace).not.toHaveBeenCalled();
    await act(() => result.current.checkTrays()); const key = result.current.networkReadinessKey;
    expect(result.current.networkReady).toBe(true); expect(key).not.toBeNull();
    await act(() => result.current.checkTrays());
    expect(result.current.networkReadinessKey).toBe(key); expect(createGeometryTrace).toHaveBeenCalledOnce();
    expect(api.createPreparation).not.toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled(); expect(api.mutatePreparation).not.toHaveBeenCalled();
    expect(f.store.context.currentAggregate).toEqual(aggregate);
  });
  it('verifies an existing trace on initial load and reuses it across endpoint registry changes', async () => {
    const f = automaticSetup(), session = f.makeSession(); f.store.sessions.set(session.id, session); f.publishSession(session);
    const trace = f.makeTrace(); f.store.traces.set(trace.aggregateId, trace);
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.networkReady).toBe(true));
    const key = result.current.networkReadinessKey;
    expect(fetchGeometryTraceManifest).toHaveBeenCalledWith(ids.project, 'login', trace.id, expect.any(AbortSignal));
    expect(createGeometryTrace).not.toHaveBeenCalled();
    f.store.context.scope.locationRegistryRevision = '99';
    await act(() => result.current.checkTrays());
    expect(result.current.networkReady).toBe(true); expect(result.current.networkReadinessKey).toBe(key);
    expect(createGeometryTrace).not.toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled();
    f.store.context.scope.routingPolicyRevision = '99'; await act(() => result.current.refresh());
    expect(result.current.networkReady).toBe(false); expect(result.current.networkReadinessKey).toBeNull();
  });
  it('replays the exact unknown frame command and retains the already published geometry', async () => {
    const f = automaticSetup(), session = f.makeSession(); f.store.sessions.set(session.id, session); f.publishSession(session);
    vi.mocked(createGeometryTrace).mockImplementationOnce(async (project, token, command) => {
      await f.createTrace(project, token, command); throw new GeometryTraceApiError('REQUEST_TIMEOUT', null, 'Lost frame receipt', 'unknown');
    });
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays());
    expect(result.current.unknown).toBe(true); expect(result.current.networkReady).toBe(false);
    const command = vi.mocked(createGeometryTrace).mock.calls[0][2];
    await act(() => result.current.refresh());
    expect(result.current.unknown).toBe(true); expect(result.current.networkReady).toBe(false);
    expect(result.current.networkReadinessKey).toBeNull();
    await act(() => result.current.checkTrays());
    expect(vi.mocked(createGeometryTrace).mock.calls[1][2]).toBe(command);
    expect(result.current.unknown).toBe(false); expect(result.current.networkReady).toBe(true);
    expect(api.createPreparation).not.toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled(); expect(api.mutatePreparation).not.toHaveBeenCalled();
  });
  it('reconstructs the same frame command after remount when its previous receipt is unknown', async () => {
    const f = automaticSetup(), session = f.makeSession(); f.store.sessions.set(session.id, session); f.publishSession(session);
    vi.mocked(createGeometryTrace).mockRejectedValueOnce(new GeometryTraceApiError('REQUEST_TIMEOUT', null, 'Unknown receipt', 'unknown'));
    const first = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(first.result.current.context).not.toBeNull());
    await act(() => first.result.current.checkTrays()); const command = vi.mocked(createGeometryTrace).mock.calls[0][2]; first.unmount();
    const second = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(second.result.current.context).not.toBeNull());
    await act(() => second.result.current.checkTrays());
    expect(vi.mocked(createGeometryTrace).mock.calls[1][2]).toEqual(command);
    expect(second.result.current.networkReady).toBe(true); expect(f.capture).not.toHaveBeenCalled();
  });
  it.each(['model', 'session', 'capture-frame', 'projection', 'object-count', 'manifest-hash'] as const)(
    'does not mark the network ready from a mismatched %s trace', async kind => {
      const f = automaticSetup(), session = f.makeSession(); f.store.sessions.set(session.id, session); f.publishSession(session);
      const trace = f.makeTrace(); f.store.traces.set(trace.aggregateId, trace);
      const altered = structuredClone(trace);
      if (kind === 'model') altered.modelVersionId = crypto.randomUUID();
      if (kind === 'session') altered.sessionId = crypto.randomUUID();
      if (kind === 'capture-frame') altered.captureFrameId = crypto.randomUUID();
      if (kind === 'projection') altered.projection.sha256 = 'f'.repeat(64);
      if (kind === 'object-count') altered.counts.objects++;
      if (kind === 'manifest-hash') altered.contentSha256 = 'f'.repeat(64);
      vi.mocked(fetchGeometryTraceManifest).mockResolvedValue(altered);
      const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(result.current.networkReady).toBe(false); expect(result.current.networkReadinessKey).toBeNull();
      expect(createGeometryTrace).not.toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled();
    },
  );
  it('keeps a missing frame visible when derivation is refused and never creates another preparation', async () => {
    const f = automaticSetup(), session = f.makeSession(); f.store.sessions.set(session.id, session); f.publishSession(session);
    vi.mocked(createGeometryTrace).mockRejectedValueOnce(new GeometryTraceApiError('GEOMETRY_TRACE_BUILD_INVALID', 409, 'Frame derivation refused', 'refused'));
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays());
    expect(result.current.error).toBe('Frame derivation refused'); expect(result.current.unknown).toBe(false);
    expect(result.current.networkReady).toBe(false); expect(result.current.networkReadinessKey).toBeNull();
    expect(result.current.notice ?? '').not.toMatch(/up to date|network updated/i);
    expect(api.createPreparation).not.toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled(); expect(api.mutatePreparation).not.toHaveBeenCalled();
  });
  it('checks, creates, collects and publishes in one operation using fresh return values', async () => {
    const f = automaticSetup(); const { result } = renderHook(() => useProjectPreparation(f.pf, true));
    await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays());
    expect(result.current.error).toBeNull(); expect(result.current.notice).toBe('Tray network updated.');
    expect(f.discover).toHaveBeenCalledOnce(); expect(f.discover.mock.calls[0][3]).toEqual({ skipEquipment: true });
    expect(api.createPreparation).toHaveBeenCalledOnce(); expect(api.createPreparation).toHaveBeenCalledWith(ids.project, 'login',
      expect.objectContaining({ expected: f.context.scope, unresolvedTrayPolicy: 'skip', discovery: f.discovery }), expect.any(AbortSignal));
    expect(f.capture).toHaveBeenCalledOnce(); expect(api.uploadPreparationPart).toHaveBeenCalledOnce();
    expect(api.mutatePreparation).toHaveBeenCalledWith(ids.project, 'login', result.current.session!.id, 'publish',
      expect.objectContaining({ expectedSessionRevision: '2' }), expect.any(AbortSignal));
    expect(result.current.session?.state).toBe('published'); expect(f.pf.refresh).toHaveBeenCalledOnce();
  });
  it('reuses the current published network and its own session instead of a newer unrelated frozen plan', async () => {
    const f = automaticSetup(), published = f.makeSession(); f.store.sessions.set(published.id, published); f.publishSession(published);
    const unrelated = f.makeSession(); unrelated.plan.routingPolicyRevision = '0'; f.store.sessions.set(unrelated.id, unrelated);
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays()); await act(() => result.current.checkTrays());
    expect(result.current.session?.id).toBe(published.id); expect(result.current.notice).toBe('Tray network is up to date.');
    expect(api.createPreparation).not.toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled(); expect(api.mutatePreparation).not.toHaveBeenCalled();
  });
  it('does not rebuild published routing geometry when only From/To location bindings change', async () => {
    const f = automaticSetup(), session = f.makeSession(); f.store.sessions.set(session.id, session); f.publishSession(session);
    f.store.context.scope.locationRegistryRevision = '8';
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays());
    expect(result.current.notice).toBe('Tray network is up to date.'); expect(api.createPreparation).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled(); expect(api.mutatePreparation).not.toHaveBeenCalled();
  });
  it('opts into server skip decisions without writing automatic exclusions and refreshes skipped candidates on later checks', async () => {
    const f = automaticSetup(), missingId = crypto.randomUUID();
    f.store.context.trays.push({ ...f.context.trays[0], projectTrayId: missingId, rawName: 'Missing tray', routeName: '/MISSING' });
    f.store.skippedTrays = [{ projectTrayId: missingId, reason: 'TRAY_ROOT_MISSING' }];
    f.discover.mockResolvedValue({ ...f.discovery, trays: [...f.discovery.trays, { projectTrayId: missingId, candidateRootObjectIds: [] }] });
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays()); await act(() => result.current.checkTrays());
    expect(api.savePreparationResolution).not.toHaveBeenCalled(); expect(api.createPreparation).toHaveBeenCalledOnce();
    expect(f.capture).toHaveBeenCalledOnce(); expect(api.mutatePreparation).toHaveBeenCalledOnce(); expect(f.discover).toHaveBeenCalledTimes(2);
    expect(result.current.session?.plan.requestedScope.skippedTrays).toEqual(f.store.skippedTrays);
  });
  it('immediately saves a selected tray against fresh scope and updates the network without another save action', async () => {
    const f = automaticSetup(); const { result } = renderHook(() => useProjectPreparation(f.pf, true));
    await waitFor(() => expect(result.current.context).not.toBeNull()); await act(() => result.current.assignTray(ids.tray, ['dbid:23', 'dbid:24']));
    expect(api.savePreparationResolution).toHaveBeenCalledWith(ids.project, 'login', expect.objectContaining({ projectTrayId: ids.tray,
      mode: 'roots', rootObjectIds: ['dbid:23', 'dbid:24'], expected: f.context.scope, reason: 'Assigned from the current model selection.' }), expect.any(AbortSignal));
    expect(api.createPreparation).toHaveBeenCalledWith(ids.project, 'login', expect.objectContaining({ expected: expect.objectContaining({ resolutionRevision: '1' }) }), expect.any(AbortSignal));
    expect(result.current.notice).toBe('Tray network updated.'); expect(result.current.context?.resolutions[0].rootObjectIds).toEqual(['dbid:23', 'dbid:24']);
  });
  it('renews same-model stale manual roots serially before discovery while preserving their selected IDs', async () => {
    const f = automaticSetup(), secondId = crypto.randomUUID(); f.store.context.trays.push({ ...f.context.trays[0], projectTrayId: secondId });
    f.store.context.resolutions = [ids.tray, secondId].map((projectTrayId, at) => ({ id: crypto.randomUUID(), projectTrayId, mode: 'roots',
      rootObjectIds: [`dbid:${23 + at}`], reason: 'Original selection', actorId: ids.actor, createdAt: new Date().toISOString(),
      scope: { ...f.context.scope, routingPolicyRevision: '0' } }));
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays());
    expect(api.savePreparationResolution).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.savePreparationResolution).mock.calls.map(call => call[2].expected.resolutionRevision)).toEqual(['0', '1']);
    expect(vi.mocked(api.savePreparationResolution).mock.calls.map(call => call[2].rootObjectIds)).toEqual([['dbid:23'], ['dbid:24']]);
    expect(f.discover.mock.calls[0][0].scope.resolutionRevision).toBe('2'); expect(result.current.notice).toBe('Tray network updated.');
  });
  it('never renews stale manual roots across model revisions and refuses a selection read from the old model', async () => {
    const f = automaticSetup(); f.store.context.resolutions = [{ id: crypto.randomUUID(), projectTrayId: ids.tray, mode: 'roots', rootObjectIds: ['dbid:23'],
      reason: 'Old model', actorId: ids.actor, createdAt: new Date().toISOString(), scope: { ...f.context.scope, selectionRevision: '0' } }];
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays()); expect(api.savePreparationResolution).not.toHaveBeenCalled();
    f.store.context.scope.selectionRevision = '2';
    await act(() => result.current.assignTray(ids.tray, ['dbid:23']));
    expect(api.savePreparationResolution).not.toHaveBeenCalled(); expect(result.current.error).toContain('active model changed');
  });
  it('resumes a current skip-mode session and captures only its missing parts', async () => {
    const f = automaticSetup(), session = f.makeSession(); f.store.sessions.set(session.id, session); f.commitPart(session.id);
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays());
    expect(api.createPreparation).not.toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled(); expect(api.uploadPreparationPart).not.toHaveBeenCalled();
    expect(api.mutatePreparation).toHaveBeenCalledOnce(); expect(result.current.notice).toBe('Tray network updated.');
  });
  it('replaces an expired frozen session with a fresh skip-mode plan', async () => {
    const f = automaticSetup(), expired = f.makeSession(); expired.createdAt = '2026-10-19T00:00:00Z'; f.store.sessions.set(expired.id, expired);
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays());
    expect(api.createPreparation).toHaveBeenCalledOnce(); expect(result.current.session?.id).not.toBe(expired.id); expect(result.current.notice).toBe('Tray network updated.');
  });
  it.each(['ready', 'error', 'no-model'] as const)('handles viewer renewal to %s after a loading data gap without losing committed parts', async phase => {
    const f = automaticSetup(); let pf: ReturnType<typeof usePathFinder> = withModel(f.pf, f.store.context.scope); const readyData = pf.data;
    const parts = Array.from({ length: 4 }, (_, partIndex) => ({ ...structuredClone(f.session.plan.partPlan[0]),
      partId: partIndex === 0 ? ids.part : crypto.randomUUID(), partIndex }));
    vi.mocked(api.createPreparation).mockImplementationOnce(async (projectId, token, input) => {
      const created = await f.create(projectId, token, input);
      if (created.schemaVersion !== 'wfc.pf.preparation-session.v1') throw Error('Expected a human fixture session');
      const session: HumanPreparationSession = { ...created, plan: { ...created.plan, partPlan: parts },
        coverage: { expectedParts: 4, committedParts: 0, requestedScopeComplete: false, missingPartIds: parts.map(part => part.partId) } };
      f.store.sessions.set(session.id, session); return structuredClone(session);
    });
    vi.mocked(api.uploadPreparationPart).mockImplementation(async (_project, _token, sessionId, partId) => {
      const session = f.store.sessions.get(sessionId)!;
      if (session.schemaVersion !== 'wfc.pf.preparation-session.v1') throw Error('Expected a human fixture session');
      const expected = session.plan.partPlan.find(part => part.partId === partId)!;
      const committed = { ...structuredClone(f.committed), sessionId, partId, partIndex: expected.partIndex,
        sessionPlanSha256: session.plan.orderedPlanSha256, scopeSha256: expected.scopeSha256 };
      const committedParts = [...session.parts.filter(part => part.partId !== partId), committed];
      const missingPartIds = parts.filter(part => !committedParts.some(saved => saved.partId === part.partId)).map(part => part.partId);
      const sessionRevision = String(committedParts.length + 1);
      f.store.sessions.set(sessionId, { ...session, state: 'collecting', sessionRevision, parts: committedParts,
        coverage: { expectedParts: 4, committedParts: committedParts.length, requestedScopeComplete: missingPartIds.length === 0, missingPartIds } });
      return { schemaVersion: 'wfc.pf.preparation-part-receipt.v1', part: committed, sessionRevision, duplicate: false };
    });
    let budgetExpired = false;
    f.capture.mockImplementation(async request => {
      if (request.preparationSlice.partId === parts[1].partId && !budgetExpired) {
        budgetExpired = true; throw Object.assign(Error('Renew the viewer budget'), { code: 'CAPTURE_RELOAD_REQUIRED' });
      }
      return { snapshot: { synthetic: true }, summary: {} };
    });
    const { result, rerender } = renderHook(() => useProjectPreparation(pf, true));
    vi.mocked(f.pf.reloadViewer).mockImplementation(() => { pf = { ...pf, data: null, viewerPhase: 'loading', preparationViewerGeneration: -1 }; rerender(); });
    await waitFor(() => expect(result.current.context).not.toBeNull());
    let checking!: Promise<void>; act(() => { checking = result.current.checkTrays(); });
    await waitFor(() => expect(f.pf.reloadViewer).toHaveBeenCalledOnce());
    expect(result.current.busy).toBe(true); expect(result.current.context).not.toBeNull(); expect(result.current.error).toBeNull();
    expect([...f.store.sessions.values()][0].parts.map(part => part.partId)).toEqual([parts[0].partId]);
    act(() => { pf = { ...pf, data: readyData, viewerPhase: phase, preparationViewerGeneration: phase === 'ready' ? 2 : -1 }; rerender(); });
    await act(async () => { await checking; });
    if (phase !== 'ready') {
      expect(result.current.error).toContain('model could not be reloaded'); expect(result.current.error).toContain('Committed parts are retained');
      expect(result.current.busy).toBe(false); expect(api.createPreparation).toHaveBeenCalledOnce(); expect(api.uploadPreparationPart).toHaveBeenCalledOnce();
      expect(api.mutatePreparation).not.toHaveBeenCalled(); expect(f.capture).toHaveBeenCalledTimes(2);
      expect([...f.store.sessions.values()][0].parts.map(part => part.partId)).toEqual([parts[0].partId]); return;
    }
    expect(result.current.error).toBeNull(); expect(result.current.notice).toBe('Tray network updated.');
    expect(api.createPreparation).toHaveBeenCalledOnce(); expect(api.uploadPreparationPart).toHaveBeenCalledTimes(4); expect(api.mutatePreparation).toHaveBeenCalledOnce();
    expect(f.capture.mock.calls.map(([request]) => request.preparationSlice.partId)).toEqual([parts[0].partId, parts[1].partId,
      parts[1].partId, parts[2].partId, parts[3].partId]);
  });
  it('reconciles an unknown part upload with the exact original payload before publishing and never recaptures it', async () => {
    const f = automaticSetup(); vi.mocked(api.uploadPreparationPart).mockImplementationOnce(async (_project, _token, sessionId) => {
      f.commitPart(sessionId); throw new api.PreparationApiError('REQUEST_TIMEOUT', null, 'Lost receipt', 'unknown');
    });
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays()); expect(result.current.unknown).toBe(true); expect(api.mutatePreparation).not.toHaveBeenCalled();
    const first = vi.mocked(api.uploadPreparationPart).mock.calls[0];
    await act(() => result.current.checkTrays());
    const second = vi.mocked(api.uploadPreparationPart).mock.calls[1]; expect(second.slice(2, 5)).toEqual(first.slice(2, 5));
    expect(second[4]).toBe(first[4]); expect(f.capture).toHaveBeenCalledOnce(); expect(api.createPreparation).toHaveBeenCalledOnce();
    expect(result.current.unknown).toBe(false); expect(result.current.notice).toBe('Tray network updated.');
  });
  it('reconciles a durable validation command exactly before attempting any replacement plan', async () => {
    const f = automaticSetup(), session = f.makeSession();
    const command = { schemaVersion: 'wfc.pf.preparation-mutation.v1' as const, expectedSessionRevision: '2', idempotencyKey: crypto.randomUUID(), reason: 'Original validation' };
    f.store.sessions.set(session.id, { ...session, state: 'validating', recovery: { command, expiresAt: '2099-01-01T00:00:00Z', actorId: ids.actor, loginId: ids.login } });
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.unknown).toBe(true));
    await act(() => result.current.checkTrays());
    expect(api.mutatePreparation).toHaveBeenCalledWith(ids.project, 'login', session.id, 'publish', command, expect.any(AbortSignal));
    expect(api.createPreparation).not.toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled(); expect(result.current.notice).toBe('Tray network is up to date.');
  });
  it('reconciles a newer durable validation command before reusing an already-current older network', async () => {
    const f = automaticSetup(), published = f.makeSession(); f.store.sessions.set(published.id, published); f.publishSession(published);
    const validating = f.makeSession(), command = { schemaVersion: 'wfc.pf.preparation-mutation.v1' as const,
      expectedSessionRevision: '2', idempotencyKey: crypto.randomUUID(), reason: 'Original validation' };
    f.store.sessions.set(validating.id, { ...validating, state: 'validating', recovery: { command,
      expiresAt: '2099-01-01T00:00:00Z', actorId: ids.actor, loginId: ids.login } });
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.session?.id).toBe(published.id));
    await act(() => result.current.checkTrays());
    expect(api.mutatePreparation).toHaveBeenCalledWith(ids.project, 'login', validating.id, 'publish', command, expect.any(AbortSignal));
    expect(api.createPreparation).not.toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled(); expect(result.current.session?.id).toBe(validating.id);
    expect(result.current.notice).toBe('Tray network is up to date.');
  });
  it('ignores historical validation from another model when preparing the current revision', async () => {
    const f = automaticSetup(), historical = f.makeSession(); historical.plan.modelVersionId = crypto.randomUUID();
    const command = { schemaVersion: 'wfc.pf.preparation-mutation.v1' as const, expectedSessionRevision: '2',
      idempotencyKey: crypto.randomUUID(), reason: 'Historical validation' };
    f.store.sessions.set(historical.id, { ...historical, state: 'validating', recovery: { command,
      expiresAt: '2099-01-01T00:00:00Z', actorId: ids.actor, loginId: ids.login } });
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    expect(result.current.unknown).toBe(false); await act(() => result.current.checkTrays());
    expect(api.mutatePreparation).toHaveBeenCalledOnce(); expect(vi.mocked(api.mutatePreparation).mock.calls[0][2]).not.toBe(historical.id);
    expect(api.createPreparation).toHaveBeenCalledOnce(); expect(result.current.notice).toBe('Tray network updated.');
  });
  it('continues in the same check after an exact old session command is authoritatively refused as stale', async () => {
    const f = automaticSetup(), expired = f.makeSession(); expired.createdAt = '2026-10-19T00:00:00Z';
    const command = { schemaVersion: 'wfc.pf.preparation-mutation.v1' as const, expectedSessionRevision: '2',
      idempotencyKey: crypto.randomUUID(), reason: 'Expired validation' };
    f.store.sessions.set(expired.id, { ...expired, state: 'validating', recovery: { command,
      expiresAt: '2099-01-01T00:00:00Z', actorId: ids.actor, loginId: ids.login } });
    vi.mocked(api.mutatePreparation).mockImplementationOnce(async () => {
      f.store.sessions.set(expired.id, { ...expired, state: 'stale', recovery: null });
      throw new api.PreparationApiError('PREPARATION_SCOPE_STALE', 409, 'Stale preparation', 'refused');
    });
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.unknown).toBe(true));
    await act(() => result.current.checkTrays());
    expect(api.mutatePreparation).toHaveBeenCalledTimes(2); expect(vi.mocked(api.mutatePreparation).mock.calls[0][4]).toEqual(command);
    expect(api.createPreparation).toHaveBeenCalledOnce(); expect(f.capture).toHaveBeenCalledOnce(); expect(result.current.error).toBeNull();
    expect(result.current.notice).toBe('Tray network updated.');
  });
  it.each(['discovery', 'create', 'capture', 'publish'] as const)('stops on a %s failure without reporting a ready network', async stage => {
    const f = automaticSetup();
    if (stage === 'discovery') f.discover.mockRejectedValueOnce(Error('Discovery failed'));
    if (stage === 'create') vi.mocked(api.createPreparation).mockRejectedValueOnce(new api.PreparationApiError('CREATE_FAILED', 400, 'Create failed', 'refused'));
    if (stage === 'capture') f.capture.mockRejectedValueOnce(Error('Capture failed'));
    if (stage === 'publish') vi.mocked(api.mutatePreparation).mockRejectedValueOnce(new api.PreparationApiError('PUBLISH_FAILED', 400, 'Publish failed', 'refused'));
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays());
    expect(result.current.error).not.toBeNull(); expect(result.current.notice ?? '').not.toMatch(/up to date|network updated/i);
    expect(f.pf.refresh).not.toHaveBeenCalled(); if (stage !== 'publish') expect(api.mutatePreparation).not.toHaveBeenCalled();
  });
  it('does not publish when refreshed coverage still reports a missing part after an upload receipt', async () => {
    const f = automaticSetup(); vi.mocked(api.uploadPreparationPart).mockResolvedValue({ schemaVersion: 'wfc.pf.preparation-part-receipt.v1',
      part: f.committed, sessionRevision: '2', duplicate: false });
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays());
    expect(result.current.error).toContain('incomplete'); expect(api.mutatePreparation).not.toHaveBeenCalled(); expect(result.current.notice).toBeNull();
  });
  it('keeps a confirmed publication confirmed if its status refresh fails and recovers without publishing twice', async () => {
    const f = automaticSetup(); vi.mocked(api.mutatePreparation).mockImplementationOnce(async (_project, _token, sessionId) => {
      const published = f.publishSession(f.store.sessions.get(sessionId)!);
      vi.mocked(api.fetchPreparationContext).mockRejectedValueOnce(new api.PreparationApiError('READ_FAILED', 503, 'Status unavailable', 'refused'));
      return published;
    });
    const { result } = renderHook(() => useProjectPreparation(f.pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays()); expect(result.current.error).toBe('Status unavailable'); expect(result.current.unknown).toBe(false);
    expect(result.current.notice).toBeNull(); await act(() => result.current.checkTrays());
    expect(api.mutatePreparation).toHaveBeenCalledOnce(); expect(f.capture).toHaveBeenCalledOnce(); expect(result.current.notice).toBe('Tray network is up to date.');
  });
  it('pauses from the first automatic read when Routes is left and never starts hidden writes or capture', async () => {
    const f = automaticSetup(); const { result, rerender } = renderHook(({ active }) => useProjectPreparation(f.pf, active), { initialProps: { active: true } });
    await waitFor(() => expect(result.current.context).not.toBeNull());
    let finish!: (context: PreparationContext) => void;
    vi.mocked(api.fetchPreparationContext).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let checking!: Promise<void>; act(() => { checking = result.current.checkTrays(); });
    await waitFor(() => expect(finish).toBeTypeOf('function')); rerender({ active: false });
    await act(async () => { finish(f.store.context); await checking; });
    expect(api.createPreparation).not.toHaveBeenCalled(); expect(api.savePreparationResolution).not.toHaveBeenCalled(); expect(f.capture).not.toHaveBeenCalled();
    const reads = vi.mocked(api.fetchPreparationContext).mock.calls.length;
    await act(() => result.current.checkTrays()); await act(() => result.current.assignTray(ids.tray, ['dbid:23']));
    expect(vi.mocked(api.fetchPreparationContext).mock.calls).toHaveLength(reads);
  });
  it('retires old-model display evidence without losing an exact uncertain upload and checks the new model once', async () => {
    const f = automaticSetup(); let pf = withModel(f.pf, f.store.context.scope);
    vi.mocked(api.uploadPreparationPart).mockImplementationOnce(async (_project, _token, sessionId) => {
      f.commitPart(sessionId); throw new api.PreparationApiError('REQUEST_TIMEOUT', null, 'Lost receipt', 'unknown');
    });
    const { result, rerender } = renderHook(() => useProjectPreparation(pf, true)); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.checkTrays()); expect(result.current.unknown).toBe(true);
    const original = vi.mocked(api.uploadPreparationPart).mock.calls[0];
    f.store.context.scope = { ...f.store.context.scope, modelVersionId: crypto.randomUUID(), contentFingerprint: 'd'.repeat(64), selectionRevision: '2' };
    pf = withModel(f.pf, f.store.context.scope);
    f.discover.mockResolvedValue({ ...f.discovery, modelVersionId: f.store.context.scope.modelVersionId,
      contentFingerprint: f.store.context.scope.contentFingerprint, selectionRevision: f.store.context.scope.selectionRevision });
    rerender(); expect(result.current.notice).toBeNull();
    await waitFor(() => expect(result.current.context?.scope.modelVersionId).toBe(f.store.context.scope.modelVersionId));
    expect(result.current.unknown).toBe(true);
    await act(() => result.current.checkTrays());
    expect(vi.mocked(api.uploadPreparationPart).mock.calls[1].slice(2, 5)).toEqual(original.slice(2, 5));
    expect(api.createPreparation).toHaveBeenCalledTimes(2); expect(f.capture).toHaveBeenCalledTimes(2); expect(result.current.notice).toBe('Tray network updated.');
    await act(() => result.current.checkTrays()); expect(f.capture).toHaveBeenCalledTimes(2);
  });
});
