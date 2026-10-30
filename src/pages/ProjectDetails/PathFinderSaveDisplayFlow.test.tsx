import { useCallback, useEffect, useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderCableWorkspace } from '@/components/pathfinder/PathFinderCableWorkspace';
import type { PathFinderNeedsRoutingListProps } from '@/components/pathfinder/PathFinderNeedsRoutingList';
import type { CableEndpointPairSelectionAccess } from '@/hooks/useCableEndpointPairSelection';
import { fetchPathFinderCableWorkflowDetail } from '@/api/pathfinderCableWorkflow';
import { fetchPathFinderJob, fetchPathFinderProposal, fetchPathFinderState, submitPathFinderCalculation, pathFinderRequest, type PathFinderJob, type PathFinderProposal } from '@/api/pathfinder';
import { fetchProjectModels } from '@/api/projectModels';
import { fetchLocationImpactProgress, LocationImpactApiError } from '@/api/pathfinderLocationImpacts';
import { locationImpactSummarySchema } from '../../../shared/pathfinderLocationImpacts';
import { cableWorkflowRowSchema, type CableWorkflowRow } from '../../../shared/pathfinderCableWorkflow';
import { revisionResultEnvelopeSchema } from '../../../shared/pathfinderRevisionResults';
import { barrierCalculationFixture } from '@/test/pathfinderBarrierFixtures';
import { PathFinderResults, type PathFinderWorkflowCalculationPreferences, type PathFinderWorkflowDisplay,
  type PathFinderWorkflowDisplayRequest, type PathFinderWorkflowReview } from './PathFinderResults';
import { usePathFinder } from './hooks/usePathFinder';
import { proposalEndpointObjectIds } from './pathFinderEndpointVisibility';

const transport = vi.hoisted(() => ({ row: null as CableWorkflowRow | null, impact: null as unknown,
  realProgress: false, realRevisionResults: false, revisionAdmission: null as { id: string; jobId: string; kind: string; generation: null; createdAt: string } | null,
  viewerPath: vi.fn(), viewerClear: vi.fn(),
  view: { camera: { position: [0, 0, 100], target: [0, 0, 0], up: [0, 1, 0] }, pathId: null as string | null },
  save: vi.fn(), refresh: vi.fn(), saved: vi.fn() }));
vi.mock('@/api/pathfinderCableWorkflow', () => ({ fetchPathFinderCableWorkflowDetail: vi.fn() }));
vi.mock('@/api/pathfinder', async original => ({ ...await original<typeof import('@/api/pathfinder')>(), fetchPathFinderJob: vi.fn(),
  fetchPathFinderProposal: vi.fn(), fetchPathFinderState: vi.fn(), submitPathFinderCalculation: vi.fn(), pathFinderRequest: vi.fn() }));
vi.mock('@/api/projectModels', () => ({ fetchProjectModels: vi.fn() }));
vi.mock('@/viewer/ViewerController', () => ({ ViewerController: class {
  constructor(options: { onEvent: (event: { type: string; payload: Record<string, unknown> }) => void }) {
    queueMicrotask(() => options.onEvent({ type: 'MODEL_LOADED', payload: {} }));
  }
  getLoadSnapshot = () => ({ ready: true }); dispose() {} cancelPicking() {}
  clear(reason?: string, options?: { preserveCamera?: boolean }) {
    transport.viewerClear(reason, options); transport.view.pathId = null;
    // Model the SDK reset that caused the regression, including when there was
    // no active path. Clearing appearance must explicitly preserve the camera.
    if (!options?.preserveCamera) transport.view.camera = { position: [0, 0, 100], target: [0, 0, 0], up: [0, 1, 0] };
  }
  async showComputedPath(path: { pathId: string }) {
    const shown = await transport.viewerPath(path);
    if (shown) transport.view.pathId = path.pathId;
    return shown;
  }
} }));
vi.mock('@/api/pathfinderLocationImpacts', async original => ({ ...await original<typeof import('@/api/pathfinderLocationImpacts')>(),
  fetchLocationImpacts: async () => ({ impacts: [] }), fetchLocationImpactProgress: vi.fn() }));
vi.mock('@/hooks/usePathfinderLocationImpactProgress', async original => {
  const actual = await original<typeof import('@/hooks/usePathfinderLocationImpactProgress')>();
  return { usePathfinderLocationImpactProgress: (access: Parameters<typeof actual.usePathfinderLocationImpactProgress>[0]) => {
    // Each test fixes this transport boundary before mounting; hook order never changes within a mounted flow.
    const useProgress = transport.realProgress ? actual.usePathfinderLocationImpactProgress
      : () => ({ impact: transport.impact, error: null, refresh: transport.refresh });
    return useProgress(access);
  } };
});
vi.mock('@/hooks/usePathfinderInitialFillProgress', () => ({ usePathfinderInitialFillProgress: () => ({ progress: null, error: null, refresh: transport.refresh }) }));
vi.mock('@/components/pathfinder/PathFinderNeedsRoutingList', () => ({ cableWorkflowReason: () => 'Synthetic transport result.',
  PathFinderNeedsRoutingList: (props: PathFinderNeedsRoutingListProps) => <button onClick={() => props.onSelect(transport.row!)}>Open test cable</button> }));
// The pair hook has its own HTTP/evidence suites. Here one successful Save
// response is the transport boundary; the real Panel, Workspace and Results
// must hand that acknowledged calculation to each other without another POST.
vi.mock('@/hooks/useCableEndpointPairSelection', async () => {
  const { useState } = await import('react');
  return { useCableEndpointPairSelection: (access: CableEndpointPairSelectionAccess) => {
    const [draft, setDraft] = useState(false);
    const endpoint = (from: boolean) => ({ context: null, draft: from && draft ? { mode: 'fixed-world', point: [3, 2, 3],
      derivation: 'picked-surface-point', displaySdkObjectId: 44 } : null, displaySelection: null, busy: false, error: null,
      notice: null, enabled: true, canSelect: true, selectObject: async () => setDraft(true), refresh: transport.refresh });
    return { from: endpoint(true), to: endpoint(false), pending: null, legacyRecovery: null, busy: false, error: null, notice: null,
      retired: false, enabled: true, canSave: draft, canRetry: false, refresh: transport.refresh,
      save: async () => { await transport.save(); setDraft(false); transport.saved();
        await access.onSaved?.({ cableId: access.cableId, locationImpact: { id: id(20) } } as never,
          { modelVersionId: id(8), selectionRevision: '1', contentFingerprint: 'a'.repeat(64), aggregateId: id(40), artifactId: id(9),
            projectionSha256: 'c'.repeat(64), captureFrameId: id(90), geometryRevision: '1', traceId: id(41) }, access.calculation); return true; } };
  } };
});
// Foreground object lookup is the SDK/HTTP boundary. Exact path identity,
// pending state, current metadata and Show wiring are real component behavior.
vi.mock('./pathFinderEndpointVisibility', async original => ({ ...await original<typeof import('./pathFinderEndpointVisibility')>(),
  proposalEndpointObjectIds: vi.fn(async () => ['dbid:44', 'dbid:45']) }));
vi.mock('./PathFinderRecalculationPanel', () => ({ PathFinderRecalculationPanel: () => null }));
vi.mock('./PathFinderRevisionResults', async original => {
  const actual = await original<typeof import('./PathFinderRevisionResults')>();
  return { PathFinderRevisionResults: (props: Parameters<typeof actual.PathFinderRevisionResults>[0]) => transport.realRevisionResults
    ? <actual.PathFinderRevisionResults {...props} /> : null };
});
vi.mock('./hooks/usePathfinderRevisionResults', () => ({ usePathfinderRevisionResults: () => ({ enabled: true,
  admissions: [], admission: transport.revisionAdmission, page: null, detail: null, admissionsLoading: false, pageLoading: false,
  detailLoading: false, error: null, previousAdmissions: false, previousPage: false, nextAdmissionsCursor: null,
  refresh: transport.refresh, selectAdmission: transport.refresh, previousAdmissionsPage: transport.refresh, nextAdmissions: transport.refresh,
  previousResultsPage: transport.refresh, nextPage: transport.refresh, readDetail: transport.refresh,
}) }));

const id = (n: number) => `d3300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const emptyDisplay: PathFinderWorkflowDisplay = { cableId: null, jobId: null, proposalId: null, proposalHash: null,
  ready: false, visible: false, routing: null, designLength: null };
function fixture(automatic = false) {
  const points: [number, number, number][] = [[1, 2, 3], [2, 2, 3]], facts = barrierCalculationFixture(id, false, points);
  const ready = { status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false,
    candidateObjectIds: [], reasonCode: null, engineeringAccepted: false };
  const initial = cableWorkflowRowSchema.parse({ projectId: id(1), mto: 'Control', cable: { id: id(4), tag: 'Save handoff cable',
    fromLocation: 'FROM', toLocation: 'TO', routing: '/MANUAL-OLD', designLength: '12', installLength: '123', cableWriteRevision: '9' },
    from: ready, to: ready, calculation: { jobId: null, jobStatus: null, itemState: null, outcome: 'not-evaluated', reasonCodes: [],
      errorCode: null, currentness: 'not-evaluated', proposalId: null, proposalHash: null, reviewable: false, acceptedMatchesCurrent: false } });
  const applicability = { schemaVersion: 'wfc.pf.sealed-cable-applicability.v2' as const, dependencyVersion: 'pathfinder.dependencies.v8' as const,
    projectId: id(1), jobId: id(7), cableId: id(4), proposalId: id(3), dependencyHash: 'c'.repeat(64), scope: 'sealed-cable-item' as const };
  const result = revisionResultEnvelopeSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-result.v1', id: id(80), projectId: id(1), admissionId: id(81),
    jobId: id(7), cableId: id(4), proposalId: id(3), proposalHash: 'a'.repeat(64), baselineHash: 'd'.repeat(64), dependencyHash: 'c'.repeat(64),
    engineResultSha256: 'e'.repeat(64), ledgerHash: null, oldModel: null, summary: { calculationMode: 'calculate', newModel: null,
      routeText: '/NEW', rawLengthMeters: 1, designLengthMeters: '7', unroundedMeters: '6.6',
      delta: { rawLengthMeters: null, designLengthMeters: null, unroundedMeters: null, baseline: 'current-values' }, reasonCodes: [] },
    comparisonRef: null, observedEvents: [], lengthLedger: null, physicalChangeProven: false, createdAt: '2026-10-23T12:00:00Z', revisionResultSha256: 'b'.repeat(64) });
  const proposal = { schemaVersion: 'wfc.pf.proposal.v2', id: id(3), projectId: id(1), jobId: id(7), cableId: id(4), status: 'calculated',
    proposalHash: 'a'.repeat(64), revisionResultHash: result.revisionResultSha256, revisionBaselineHash: result.baselineHash, revisionResult: result,
    cableWriteRevision: '9', stale: automatic, canApply: !automatic, synthetic: true, engineeringAccepted: false, acceptanceScope: 'not-accepted',
    compatibilityIssue: null, message: 'Synthetic transport fixture.', engineeringMessage: 'No real geometry acceptance.', itemApplicability: automatic ? null : applicability,
    createdAt: result.createdAt, routingPreferences: facts.preferences, barriers: facts.barriers,
    provenance: { dependencyVersion: 'pathfinder.dependencies.v8', dependencyHash: 'c'.repeat(64), engineIdentity: facts.engineIdentity, automatic: null,
      endpointSources: { from: 'confirmed-shared-location', to: 'confirmed-shared-location' } },
    design: { lengthBeforePercentageMeters: '6', unroundedLengthMeters: '6.6', designLengthMeters: '7' },
    route: { success: true, message: 'Synthetic route.', routeCodes: ['/NEW'], segmentIds: ['dbid:23'], objectIds: ['dbid:23'], points,
      lengthMeters: 1, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false,
      connectionGapCount: 0, connectionGapLengthMeters: 0, routeText: '/NEW' } } as unknown as PathFinderProposal;
  const done = cableWorkflowRowSchema.parse({ ...initial, cable: { ...initial.cable, ...(automatic ? { routing: '/NEW', designLength: '7', cableWriteRevision: '10' } : {}) },
    calculation: { ...initial.calculation, jobId: id(7), jobStatus: 'running', itemState: 'complete', outcome: 'calculated', currentness: 'current',
      proposalId: id(3), proposalHash: 'a'.repeat(64), reviewable: !automatic, acceptedMatchesCurrent: automatic, itemApplicability: automatic ? null : applicability,
      ...(automatic ? { automaticUpdate: { status: 'written', receiptId: id(30), reasonCode: null } } : {}) } });
  const parent: PathFinderJob = { id: id(7), projectId: id(1), status: 'running', total: 13, completed: 1, cancelRequested: false,
    failure: null, attempts: 1, createdAt: result.createdAt, updatedAt: result.createdAt };
  const data = { projectId: id(1), registryRevision: '1', activeModel: { modelVersionId: id(8), selectionRevision: '1', contentFingerprint: 'a'.repeat(64) },
    settings: {}, artifacts: [{ id: id(9) }], cables: [{ ...done.cable, mto: 'Control' }], jobs: [parent], proposals: [], locations: [] };
  const pf = { data, preparationAccess: { projectId: id(1), loadedProjectId: id(1), token: 'transport-only-token', isAdmin: true },
    preparationViewerGeneration: 7, viewerPhase: 'ready', busy: false, refresh: vi.fn(), refreshState: vi.fn(async () => data),
    calculate: vi.fn(), submitCalculation: vi.fn(), action: vi.fn(), clear: vi.fn(), cancelOperation: vi.fn(), cancelPicking: vi.fn(), readSelection: vi.fn(),
    readProposal: vi.fn(async () => proposal), readJob: vi.fn(async () => parent), showPath: vi.fn(async () => true), showLocation: vi.fn(async () => true), reviewProposal: vi.fn() };
  return { initial, done, proposal, parent, pf: pf as unknown as ReturnType<typeof usePathFinder>, preferences: facts.preferences };
}
type Fixture = ReturnType<typeof fixture>;
function Flow({ f, configuration = true }: { f: Fixture; configuration?: boolean }) {
  const [selected, setSelected] = useState<CableWorkflowRow | null>(null), [selectedId, setSelectedId] = useState<string | null>(null);
  const [display, setDisplay] = useState(emptyDisplay), [review, setReview] = useState<PathFinderWorkflowReview | null>(null);
  const [preferences, setPreferences] = useState<PathFinderWorkflowCalculationPreferences | null>(null);
  const [request, setRequest] = useState<PathFinderWorkflowDisplayRequest | null>(null);
  const modelId = f.pf.data?.activeModel.modelVersionId;
  useEffect(() => { setSelected(null); setDisplay(emptyDisplay); }, [modelId]);
  const receive = useCallback((row: CableWorkflowRow) => { setSelected(row); setSelectedId(row.cable.id); }, []);
  const started = useCallback((cableId: string) => { setSelected(null); setDisplay({ ...emptyDisplay, cableId }); setReview(null);
    setRequest(previous => ({ cableId, requestId: (previous?.requestId ?? 0) + 1, action: 'hide' })); }, []);
  const displayChanged = useCallback((value: PathFinderWorkflowDisplay) => setDisplay(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value), []);
  return <>
    <PathFinderCableWorkspace projectId={id(1)} loadedProjectId={id(1)} accountId={id(2)} token="transport-only-token" isAdmin active pf={f.pf}
      preferences={configuration ? f.preferences : null} readPreferences={configuration ? f.preferences : { secondaryDistanceMeters: 17, preferVerticalApproach: false }}
      selectedCableId={selectedId} onSelect={receive} onCalculationStart={started} onCalculationPreferences={setPreferences} display={display} review={review}
      onTogglePath={cableId => setRequest(previous => ({ cableId, requestId: (previous?.requestId ?? 0) + 1, action: display.visible ? 'hide' : 'show' }))} />
    <PathFinderResults pf={f.pf} selectedCableId={selectedId} workflowSelection={selected} accountId={id(2)}
      options={configuration ? f.preferences : null} readPreferences={configuration ? f.preferences : { secondaryDistanceMeters: 17, preferVerticalApproach: false }}
      workflowConfigurationReady={configuration} workflowCalculationPreferences={preferences} workflowDisplayRequest={request}
      onWorkflowDisplayChange={displayChanged} onWorkflowReviewChange={setReview} displayOwned claimViewer={() => () => true} />
  </>;
}
function LiveControllerFlow({ f, previousPath = false }: { f: Fixture; previousPath?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const controller = usePathFinder({ projectId: id(1), loadedProjectId: id(1), token: 'transport-only-token', isAdmin: true,
    container, automaticStatePolling: false });
  return <><div ref={container} />{controller.viewerPhase === 'ready' ? <>
    {previousPath ? <button onClick={() => void controller.showPath({ pathId: id(2), points: f.proposal.route!.points, objectIds: [23] })}>Show previous path</button> : null}
    <Flow f={{ ...f, pf: controller }} />
  </> : null}</>;
}
function wire(f: Fixture, persisted = false) {
  transport.row = persisted ? f.done : f.initial;
  transport.impact = { id: id(20), jobId: id(7), status: 'running', total: 13, completed: 1, reasonCodes: [] };
  vi.mocked(fetchPathFinderJob).mockResolvedValue({ ...f.parent, items: [{ cableId: id(4), state: 'complete', status: 'calculated' }] } as never);
  vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(async () => ({ projectId: id(1), cableId: id(4), contextSha256: 'f'.repeat(64),
    row: persisted || transport.saved.mock.calls.length > 0 ? f.done : f.initial }) as never);
  transport.save.mockResolvedValue(undefined);
}
beforeEach(() => { vi.resetAllMocks(); transport.realProgress = false; transport.realRevisionResults = false; transport.revisionAdmission = null;
  transport.view.camera = { position: [0, 0, 100], target: [0, 0, 0], up: [0, 1, 0] }; transport.view.pathId = null;
  vi.mocked(proposalEndpointObjectIds).mockResolvedValue(['dbid:44', 'dbid:45']);
  sessionStorage.clear(); vi.spyOn(window, 'open').mockReturnValue(null); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); sessionStorage.clear(); });
const button = (name: string) => screen.getByText(name, { selector: 'button' });
describe('real cable popup Workspace → Results → Panel handoff with synthetic transport', () => {
  it.each([false, true])('preserves the camera when Save invalidates a route (previous path shown: %s)', async previouslyShown => {
    const f = fixture(true); wire(f);
    vi.mocked(fetchPathFinderState).mockResolvedValue(f.pf.data!);
    vi.mocked(fetchProjectModels).mockResolvedValue({ selection: { activeModelVersionId: id(8), selectionRevision: 1 },
      versions: [{ id: id(8), health: 'healthy' }] } as never);
    let finishProposal!: (value: PathFinderProposal) => void;
    vi.mocked(fetchPathFinderProposal).mockImplementation(async () => transport.saved.mock.calls.length
      ? new Promise(resolve => { finishProposal = resolve; }) : f.proposal);
    transport.viewerPath.mockResolvedValue(true);
    render(<LiveControllerFlow f={f} previousPath={previouslyShown} />);
    fireEvent.click(await screen.findByText('Open test cable', { selector: 'button' }));
    await screen.findByText('Assign From', { selector: 'button' });
    if (previouslyShown) {
      fireEvent.click(button('Show previous path'));
      await waitFor(() => expect(transport.view.pathId).toBe(id(2)));
    }
    const closeCamera = { position: [52, -6, 9], target: [51, -6, 4], up: [0, 0, 1] };
    transport.view.camera = structuredClone(closeCamera); transport.viewerClear.mockClear();
    fireEvent.click(button('Assign From'));
    await waitFor(() => expect(button('Save')).toBeEnabled()); fireEvent.click(button('Save'));
    await waitFor(() => expect(finishProposal).toBeTypeOf('function'));
    expect(transport.viewerClear).toHaveBeenCalled();
    expect(transport.view.pathId).toBeNull(); expect(transport.view.camera).toEqual(closeCamera);
    expect(button('Show')).toBeDisabled();
    await act(async () => finishProposal(f.proposal));
    await waitFor(() => expect(button('Show')).toBeEnabled());
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/NEW');
    expect(transport.view.camera).toEqual(closeCamera); expect(transport.view.pathId).toBeNull();
    for (const call of transport.viewerClear.mock.calls) expect(call).toEqual(['user', { preserveCamera: true }]);
    expect(transport.save).toHaveBeenCalledOnce(); expect(submitPathFinderCalculation).not.toHaveBeenCalled();
  });
  it('recovers Save display after three serialized cable reads fail while siblings finish, without another calculation', async () => {
    const f = fixture(true); wire(f);
    const bound = (locationId: string) => ({ locationId, bindingRevision: '1', locationRevision: '1', bindingId: id(60),
      bindingContentSha256: 'b'.repeat(64), mode: 'fixed-world' as const, captureFrameId: id(90), qualifiedProjectFrameId: null,
      aggregateId: id(40), projectionSha256: 'c'.repeat(64), sourceObjectRevisionId: null, migrationDecisionId: null, point: [1, 2, 3] as [number, number, number] });
    f.proposal.dependencies = { schemaVersion: 'pathfinder.dependencies.v8', projectId: id(1),
      model: { id: id(8), selectionRevision: '1', contentFingerprint: 'a'.repeat(64) }, artifact: { id: id(9), sha256: 'd'.repeat(64) },
      preparation: { aggregateId: id(40), captureFrameId: id(90), projectionSha256: 'c'.repeat(64) }, from: bound(id(61)), to: bound(id(62)) };
    f.pf.data!.artifacts = [{ ...f.pf.data!.artifacts[0], modelVersionId: id(8), snapshotSha256: 'd'.repeat(64) }];
    let finishProposal!: (value: PathFinderProposal) => void, resultReads = 0;
    vi.mocked(f.pf.readProposal).mockImplementationOnce(() => new Promise(resolve => { finishProposal = resolve; }));
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(async () => {
      if (transport.saved.mock.calls.length && vi.mocked(f.pf.readProposal).mock.calls.length && ++resultReads <= 3)
        throw Object.assign(new Error('Concurrent cable update; retry the read.'), { status: 503 });
      return { projectId: id(1), cableId: id(4), contextSha256: 'f'.repeat(64), row: transport.saved.mock.calls.length ? f.done : f.initial } as never;
    });
    render(<Flow f={f} />); fireEvent.click(button('Open test cable'));
    fireEvent.click(await screen.findByText('Assign From', { selector: 'button' }));
    await waitFor(() => expect(button('Save')).toBeEnabled()); fireEvent.click(button('Save'));
    await waitFor(() => expect(resultReads).toBe(1));
    expect(button('Show')).toBeDisabled();
    await act(async () => finishProposal(f.proposal));
    await waitFor(() => expect(button('Show')).toBeEnabled(), { timeout: 12000 });
    expect(resultReads).toBe(4); expect(screen.getByLabelText('Cable routing')).toHaveValue('/NEW');
    fireEvent.click(button('Show'));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(transport.save).toHaveBeenCalledOnce(); expect(f.pf.submitCalculation).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  }, 18000);
  it('replaces the popup finished-loading message with the terminal display-read reason when recovery is exhausted', async () => {
    const f = fixture(true); wire(f);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(async () => {
      if (transport.saved.mock.calls.length && vi.mocked(f.pf.readProposal).mock.calls.length)
        throw Object.assign(new Error('Concurrent cable update.'), { status: 503 });
      return { projectId: id(1), cableId: id(4), contextSha256: 'f'.repeat(64), row: transport.saved.mock.calls.length ? f.done : f.initial } as never;
    });
    render(<Flow f={f} />); fireEvent.click(button('Open test cable'));
    fireEvent.click(await screen.findByText('Assign From', { selector: 'button' }));
    await waitFor(() => expect(button('Save')).toBeEnabled());
    vi.useFakeTimers(); await act(async () => fireEvent.click(button('Save')));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    const panel = screen.getByRole('dialog', { name: 'Save handoff cable' });
    expect(within(panel).getByText(/after bounded automatic retries/)).toBeVisible();
    expect(within(panel).queryByText(/The calculation finished. Loading and checking/)).toBeNull();
    expect(button('Show')).toBeDisabled(); expect(button('Assign From')).toBeEnabled(); expect(button('Calculate routing')).toBeEnabled();
    expect(transport.save).toHaveBeenCalledOnce(); expect(f.pf.submitCalculation).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it('enables Show after Save through the real controller while optional endpoint highlighting never finishes', async () => {
    const f = fixture(true); wire(f);
    vi.mocked(fetchPathFinderState).mockResolvedValue(f.pf.data!);
    vi.mocked(fetchProjectModels).mockResolvedValue({ selection: { activeModelVersionId: id(8), selectionRevision: 1 },
      versions: [{ id: id(8), health: 'healthy' }] } as never);
    vi.mocked(fetchPathFinderProposal).mockResolvedValue(f.proposal);
    vi.mocked(proposalEndpointObjectIds).mockImplementation(() => new Promise(() => {}));
    transport.viewerPath.mockResolvedValue(true);
    render(<LiveControllerFlow f={f} />);
    fireEvent.click(await screen.findByText('Open test cable', { selector: 'button' }));
    fireEvent.click(await screen.findByText('Assign From', { selector: 'button' }));
    await waitFor(() => expect(button('Save')).toBeEnabled()); fireEvent.click(button('Save'));
    await waitFor(() => expect(button('Show')).toBeEnabled());
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/NEW');
    expect(button('Assign From')).toBeEnabled(); expect(button('Calculate routing')).toBeEnabled();
    const automaticRefreshes = transport.refresh.mock.calls.length;
    fireEvent.click(button('Show'));
    await waitFor(() => expect(transport.viewerPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
    expect(transport.save).toHaveBeenCalledOnce(); expect(submitPathFinderCalculation).not.toHaveBeenCalled();
    expect(pathFinderRequest).not.toHaveBeenCalled(); expect(transport.refresh).toHaveBeenCalledTimes(automaticRefreshes);
  });
  it('isolates Save display hydration from the real revision panel automatic read when the new job is absent from the broad state', async () => {
    const f = fixture(true); wire(f); transport.realRevisionResults = true;
    f.pf.data!.jobs = [];
    vi.mocked(fetchPathFinderState).mockResolvedValue(f.pf.data!);
    vi.mocked(fetchProjectModels).mockResolvedValue({ selection: { activeModelVersionId: id(8), selectionRevision: 1 },
      versions: [{ id: id(8), health: 'healthy' }] } as never);
    vi.mocked(fetchPathFinderProposal).mockResolvedValue(f.proposal);
    let finishDisplay!: (value: PathFinderJob) => void, finishHistory!: (value: PathFinderJob) => void;
    vi.mocked(fetchPathFinderJob).mockResolvedValue(f.parent)
      .mockResolvedValueOnce({ ...f.parent, items: [{ cableId: id(4), state: 'complete', status: 'calculated', message: null }] } as never)
      .mockImplementationOnce(() => new Promise(resolve => { finishDisplay = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishHistory = resolve; }));
    transport.viewerPath.mockResolvedValue(true);
    const view = render(<LiveControllerFlow f={f} />);
    fireEvent.click(await screen.findByText('Open test cable', { selector: 'button' }));
    fireEvent.click(await screen.findByText('Assign From', { selector: 'button' }));
    await waitFor(() => expect(button('Save')).toBeEnabled()); fireEvent.click(button('Save'));
    await waitFor(() => expect(fetchPathFinderJob).toHaveBeenCalledTimes(2));
    const displaySignal = vi.mocked(fetchPathFinderJob).mock.calls[1][3]!;
    expect(displaySignal.aborted).toBe(false); expect(button('Show')).toBeDisabled();
    transport.revisionAdmission = { id: id(81), jobId: id(7), kind: 'location-impact', generation: null, createdAt: f.parent.createdAt };
    view.rerender(<LiveControllerFlow f={f} />);
    await waitFor(() => expect(fetchPathFinderJob).toHaveBeenCalledTimes(3));
    expect(displaySignal.aborted).toBe(false);
    await act(async () => { finishDisplay(f.parent); finishHistory(f.parent); });
    await waitFor(() => expect(button('Show')).toBeEnabled());
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/NEW');
    fireEvent.click(button('Show'));
    await waitFor(() => expect(transport.viewerPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(fetchPathFinderJob).toHaveBeenCalledTimes(3); expect(submitPathFinderCalculation).not.toHaveBeenCalled(); expect(pathFinderRequest).not.toHaveBeenCalled();
    // Startup, acknowledged Save state and settled optional diagnostics only;
    // the user never refreshes or submits another calculation to enable Show.
    expect(fetchPathFinderState).toHaveBeenCalledTimes(3); expect(transport.save).toHaveBeenCalledOnce();
  });
  it('opens the saved exact route after an engine update and supports Show/Hide/Show without calculation or write authority', async () => {
    const f = fixture(true);
    f.parent.status = 'complete'; f.parent.completed = f.parent.total;
    f.done.calculation = { ...f.done.calculation, jobStatus: 'complete', currentness: 'changed',
      acceptedMatchesCurrent: false, reviewable: false, savedExactDisplay: true };
    wire(f, true);
    render(<Flow f={f} />); fireEvent.click(button('Open test cable'));
    await waitFor(() => expect(button('Show')).toBeEnabled(), { timeout: 5000 });
    expect(screen.getByRole('heading', { name: 'Cable list routing' })).toBeVisible();
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/NEW');
    expect(screen.getByText('Cable list design length: 7 m')).toBeVisible();
    expect(screen.getByText('Saved route. Show displays its saved path without recalculating.')).toBeVisible();
    expect(button('Assign From')).toBeEnabled(); expect(button('Calculate routing')).toBeEnabled();
    expect(button('Review proposed routing')).toBeDisabled(); expect(button('Apply reviewed routing')).toBeDisabled();
    fireEvent.click(button('Show'));
    await waitFor(() => expect(button('Hide')).toBeEnabled());
    fireEvent.click(button('Hide'));
    await waitFor(() => expect(button('Show')).toBeEnabled());
    fireEvent.click(button('Show'));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledTimes(2));
    for (const call of vi.mocked(f.pf.showPath).mock.calls) expect(call[0]).toEqual({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] });
    expect(f.done.calculation.currentness).toBe('changed'); expect(f.done.calculation.acceptedMatchesCurrent).toBe(false);
    expect(transport.save).not.toHaveBeenCalled(); expect(f.pf.submitCalculation).not.toHaveBeenCalled();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  }, 12000);
  it('withdraws saved exact Show readiness when an endpoint assignment becomes unsaved', async () => {
    const f = fixture(true); f.parent.status = 'complete'; f.parent.completed = f.parent.total;
    f.done.calculation = { ...f.done.calculation, jobStatus: 'complete', currentness: 'changed', acceptedMatchesCurrent: false,
      reviewable: false, savedExactDisplay: true }; wire(f, true);
    render(<Flow f={f} />); fireEvent.click(button('Open test cable'));
    await waitFor(() => expect(button('Show')).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(button('Assign From'));
    await waitFor(() => expect(button('Save')).toBeEnabled());
    expect(button('Show')).toBeDisabled(); expect(f.pf.showPath).not.toHaveBeenCalled();
    expect(transport.save).not.toHaveBeenCalled(); expect(f.pf.submitCalculation).not.toHaveBeenCalled();
  }, 12000);
  it('shows saved Cable list text immediately while the first exact-result read is still pending', async () => {
    const f = fixture(); wire(f);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(() => new Promise(() => {}));
    const view = render(<Flow f={f} />); fireEvent.click(button('Open test cable'));
    await screen.findByText('Assign From', { selector: 'button' });
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/MANUAL-OLD');
    expect(screen.getByRole('heading', { name: 'Cable list routing' })).toBeVisible();
    expect(screen.getByText('Cable list design length: 12 m')).toBeVisible();
    expect(button('Show')).toBeDisabled();
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(transport.save).not.toHaveBeenCalled();
    expect(f.pf.submitCalculation).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
    view.unmount();
  });
  it('loads an existing exact route on the first open even when its cached list row has no calculation', async () => {
    const f = fixture(true); wire(f);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(4), contextSha256: 'f'.repeat(64), row: f.done } as never);
    vi.mocked(f.pf.refreshState).mockImplementation(() => new Promise(() => {}));
    render(<Flow f={f} />); fireEvent.click(button('Open test cable'));
    await waitFor(() => expect(button('Show')).toBeEnabled(), { timeout: 5000 });
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/NEW');
    expect(screen.getByText('Calculated design length: 7 m')).toBeVisible();
    expect(button('Assign From')).toBeEnabled(); expect(button('Calculate routing')).toBeEnabled();
    fireEvent.click(button('Show'));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(transport.save).not.toHaveBeenCalled(); expect(f.pf.submitCalculation).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  }, 12000);
  it('shows the independently verified recorded result when the list preference hint differs from its policy', async () => {
    const f = fixture(true), recordedPreferences = f.preferences;
    f.preferences = { ...recordedPreferences, secondaryDistanceMeters: 17 }; wire(f, true);
    const changedHint = cableWorkflowRowSchema.parse({ ...f.done, calculation: { ...f.done.calculation,
      currentness: 'changed', acceptedMatchesCurrent: false, itemApplicability: null } });
    transport.row = changedHint;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(async (_project, _token, _cable, query) => ({
      projectId: id(1), cableId: id(4), contextSha256: 'f'.repeat(64),
      row: query?.secondaryDistanceMeters === recordedPreferences.secondaryDistanceMeters ? f.done : changedHint }) as never);
    render(<Flow f={f} />); fireEvent.click(button('Open test cable'));
    await waitFor(() => expect(button('Show')).toBeEnabled(), { timeout: 5000 });
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/NEW');
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledWith(id(1), 'transport-only-token', id(4), recordedPreferences, expect.any(AbortSignal));
    expect(transport.save).not.toHaveBeenCalled(); expect(f.pf.submitCalculation).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  }, 12000);
  it('releases the saved selected result while a broad project refresh remains unresolved', async () => {
    const f = fixture(true); wire(f);
    vi.mocked(f.pf.refreshState).mockImplementation(() => new Promise(() => {}));
    render(<Flow f={f} />); fireEvent.click(button('Open test cable'));
    await screen.findByText('Assign From', { selector: 'button' });
    fireEvent.click(button('Assign From')); await waitFor(() => expect(button('Save')).toBeEnabled());
    fireEvent.click(button('Save'));
    await waitFor(() => expect(button('Show')).toBeEnabled(), { timeout: 5000 });
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/NEW');
    expect(screen.getByText('Calculated design length: 7 m')).toBeVisible();
    expect(button('Assign From')).toBeEnabled(); expect(button('Assign To')).toBeEnabled(); expect(button('Calculate routing')).toBeEnabled();
    expect(f.parent.status).toBe('running'); expect(transport.save).toHaveBeenCalledOnce();
    expect(f.pf.submitCalculation).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
    fireEvent.click(button('Show'));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
  }, 12000);
  it.each([false, true])('Save automatically hydrates the selected path and Show while siblings run (automatic-owned=%s)', async automatic => {
    const f = fixture(automatic); wire(f); render(<Flow f={f} />);
    fireEvent.click(button('Open test cable'));
    await screen.findByText('Assign From', { selector: 'button' });
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/MANUAL-OLD');
    fireEvent.click(button('Assign From'));
    await waitFor(() => expect(button('Save')).toBeEnabled());
    fireEvent.click(button('Save'));
    await waitFor(() => expect(button('Show')).toBeEnabled(), { timeout: 5000 });
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/NEW');
    expect(screen.getByText('Calculated design length: 7 m')).toBeVisible();
    expect(button('Assign From')).toBeEnabled(); expect(button('Assign To')).toBeEnabled();
    expect(button('Calculate routing')).toBeEnabled();
    fireEvent.click(button('Show'));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    if (automatic) expect(screen.queryByText('Review proposed routing', { selector: 'button' })).toBeNull();
    else {
      await waitFor(() => expect(button('Review proposed routing')).toBeEnabled(), { timeout: 5000 });
      expect(button('Apply reviewed routing')).toBeDisabled();
      expect(f.done.cable).toMatchObject({ routing: '/MANUAL-OLD', designLength: '12', cableWriteRevision: '9' });
    }
    expect(transport.save).toHaveBeenCalledOnce(); expect(transport.saved).toHaveBeenCalledOnce();
    expect(f.pf.submitCalculation).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  }, 20000);
  it('opens a persisted result without a local calculation acknowledgement or current new-calculation configuration', async () => {
    const f = fixture(); wire(f, true); render(<Flow f={f} configuration={false} />);
    fireEvent.click(button('Open test cable'));
    await waitFor(() => expect(button('Show')).toBeEnabled(), { timeout: 5000 });
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/NEW');
    fireEvent.click(button('Show'));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledWith(id(1), 'transport-only-token', id(4), f.preferences, expect.any(AbortSignal));
    expect(button('Review proposed routing')).toBeDisabled();
    expect(transport.save).not.toHaveBeenCalled(); expect(f.pf.submitCalculation).not.toHaveBeenCalled();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  }, 12000);
  it('hands off Save to Show with the real impact hook while the main tab is hidden, its popup stays visible and the first progress GET fails', async () => {
    vi.useFakeTimers(); transport.realProgress = true; const f = fixture(true); wire(f);
    const frame = document.createElement('iframe'); document.body.appendChild(frame); const popup = frame.contentWindow!;
    Object.defineProperty(popup, 'closed', { configurable: true, value: false }); popup.focus = vi.fn(); popup.close = vi.fn();
    vi.spyOn(popup.document, 'visibilityState', 'get').mockReturnValue('visible'); vi.mocked(window.open).mockReturnValue(popup);
    let mainVisibility: DocumentVisibilityState = 'visible'; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => mainVisibility);
    const current = { modelVersionId: id(8), selectionRevision: '1', contentFingerprint: 'a'.repeat(64), aggregateId: id(40), artifactId: id(9),
      projectionSha256: 'c'.repeat(64), captureFrameId: id(90), geometryRevision: '1', traceId: id(41) };
    const summary = locationImpactSummarySchema.parse({ id: id(20), projectId: id(1), actorId: id(2), modelVersionId: id(8), selectionRevision: '1',
      contentFingerprint: 'a'.repeat(64), current, calculation: { preferences: f.preferences, timeoutMilliseconds: 120000 }, status: 'collecting', reasonCodes: [],
      eligibleCables: 13, excludedMvCables: 0, blockedCategoryCables: 0, currentTargetCables: 13, completed: 0, total: 13, readyCables: 0,
      blockedCables: 0, jobId: null, createdAt: '2026-10-23T12:00:00.000Z', updatedAt: '2026-10-23T12:00:01.000Z', admittedAt: null,
      authorityExpiresAt: '2026-10-23T12:30:00.000Z', currentAuthority: true, elapsedMilliseconds: 1000, admissionElapsedMilliseconds: null });
    const response = (impact: typeof summary) => ({ schemaVersion: 'wfc.pf.location-impact-progress.v1' as const, projectId: id(1), impact });
    vi.mocked(fetchLocationImpactProgress).mockRejectedValueOnce(new LocationImpactApiError('UNAVAILABLE', 503, 'Temporarily unavailable.'))
      .mockResolvedValueOnce(response(summary)).mockResolvedValue(response({ ...summary, status: 'running', jobId: id(7), completed: 1, readyCables: 1 }));
    const view = render(<Flow f={f} />); const child = within(popup.document.body);
    fireEvent.click(button('Open test cable'));
    await act(async () => { fireEvent.click(child.getByText('Assign From', { selector: 'button' })); });
    await act(async () => { fireEvent.click(child.getByText('Save', { selector: 'button' }));
      mainVisibility = 'hidden'; fireEvent(document, new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(4);
    expect(vi.mocked(fetchLocationImpactProgress).mock.calls.every(call => call[3] === id(20))).toBe(true);
    expect(child.getByLabelText('Cable routing')).toHaveValue('/NEW'); expect(child.getByText('Show', { selector: 'button' })).toBeEnabled();
    expect(child.getByText('Assign From', { selector: 'button' })).toBeEnabled(); expect(child.getByText('Calculate routing', { selector: 'button' })).toBeEnabled();
    await act(async () => { fireEvent.click(child.getByText('Show', { selector: 'button' })); });
    expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] });
    expect(transport.save).toHaveBeenCalledOnce(); expect(transport.saved).toHaveBeenCalledOnce();
    expect(f.pf.submitCalculation).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
    view.unmount(); frame.remove();
  }, 12000);
  it('restores the externally selected persisted result after a model reload without reopening the popup or calculating again', async () => {
    const f = fixture(); wire(f, true); const view = render(<Flow f={f} />);
    fireEvent.click(button('Open test cable'));
    await waitFor(() => expect(button('Show')).toBeEnabled());
    const original = f.pf, priorReads = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls.length;
    f.pf = { ...original, data: null, viewerPhase: 'loading', preparationViewerGeneration: -1 };
    view.rerender(<Flow f={f} />);
    expect(screen.queryByText('Show', { selector: 'button' })).toBeNull();
    f.pf = { ...original, preparationViewerGeneration: 8 }; view.rerender(<Flow f={f} />);
    await screen.findByText('Open selected cable', { selector: 'button' });
    expect(vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls.length).toBeGreaterThan(priorReads);
    expect(screen.queryByText('Show', { selector: 'button' })).toBeNull();
    fireEvent.click(button('Open selected cable'));
    await waitFor(() => expect(button('Show')).toBeEnabled());
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/NEW');
    fireEvent.click(button('Show'));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(transport.save).not.toHaveBeenCalled(); expect(f.pf.submitCalculation).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  }, 12000);
});
