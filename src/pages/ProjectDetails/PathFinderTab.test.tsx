import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PathFinderTab } from './PathFinderTab';
import { usePathFinder } from './hooks/usePathFinder';
import type { PathFinderLookup, PathFinderProposal, PathFinderPreview, PathFinderState } from '@/api/pathfinder';
import { fetchPathFinderJob, submitAllPathFinderCalculations } from '@/api/pathfinder';
import type { ViewerModelObject } from '../../../viewer-runtime/protocol.mjs';
import { fetchEndpointBinding, fetchEndpointBindingHistory, saveEndpointBinding } from '@/api/pathfinderEndpointBindings';
import { endpointBindingFixture } from '@/test/endpointBindingFixtures';
import { calculationAvailabilitySchema, type CalculationAvailability } from '../../../shared/pathfinderCalculationAvailability';
import type { PathFinderResults, PathFinderWorkflowDisplay } from './PathFinderResults';
import type { PathFinderBarriersPanelProps } from './PathFinderBarriersPanel';
import { barrierCalculationFixture } from '@/test/pathfinderBarrierFixtures';
import { fetchPathFinderCableWorkflowDetail } from '@/api/pathfinderCableWorkflow';
import { cableWorkflowDetailSchema } from '../../../shared/pathfinderCableWorkflowQueries';
import type { PathFinderCableWorkspaceProps } from '@/components/pathfinder/PathFinderCableWorkspace';
import type { ModelLocationMatchPanel } from './ModelLocationMatchPanel';
vi.mock('@/api/pathfinderEndpointBindings', async original => ({ ...await original<typeof import('@/api/pathfinderEndpointBindings')>(), fetchEndpointBinding: vi.fn(), fetchEndpointBindingHistory: vi.fn(), saveEndpointBinding: vi.fn() }));
vi.mock('@/api/pathfinder', async original => ({ ...await original<typeof import('@/api/pathfinder')>(), fetchPathFinderJob: vi.fn(), submitAllPathFinderCalculations: vi.fn() }));

vi.mock('./hooks/usePathFinder', () => ({ usePathFinder: vi.fn() }));
vi.mock('./hooks/useProjectCablePurposes', () => ({ useProjectCablePurposes: () => ({ cablePurposes: ['Control', 'Grounding', 'MV', 'Power', 'VFD'], cablePurposesError: null }) }));
const autoReadCapture = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn() }));
vi.mock('./hooks/usePathfinderAutoLengthRead', () => ({ usePathfinderAutoLengthRead: (input: unknown) => {
  autoReadCapture.read(input); return { view: null, loading: false, error: null, refresh: autoReadCapture.refresh };
} }));
vi.mock('@/api/pathfinderCableWorkflow', () => ({ fetchPathFinderCableWorkflowDetail: vi.fn() }));
vi.mock('./hooks/useRoutingsViewerHeight', () => ({ useRoutingsViewerHeight: () => 720 }));
// Child lifecycle suites own their exact reads, review and recovery. This suite
// checks shared-view composition, callback forwarding and the real bulk control.
const workspaceCapture = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('@/components/pathfinder/PathFinderCableWorkspace', () => ({ PathFinderCableWorkspace: (props: PathFinderCableWorkspaceProps) => {
  workspaceCapture.render(props); return null;
} }));
const resultCapture = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./PathFinderResults', () => ({ PathFinderResults: (props: Parameters<typeof PathFinderResults>[0]) => {
  resultCapture.render(props); return null;
} }));
// These network panels have dedicated contract/authority tests. This suite owns
// Tab tool composition and the real pending-Apply hook, not incidental reads.
vi.mock('./PathFinderCalculationGrantPanel', () => ({ PathFinderCalculationGrantPanel: () => null }));
const modelMatchCapture = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./ModelLocationMatchPanel', () => ({ ModelLocationMatchPanel: (props: Parameters<typeof ModelLocationMatchPanel>[0]) => {
  modelMatchCapture.render(props); return <section aria-label="Model location matching integration"><button disabled={!props.active}>Find and assign From/To</button></section>;
} }));
// Barrier authoring has independent lifecycle tests; composition uses an explicit
// synthetic empty declaration, never inferred real model coverage.
const barrierComposition = vi.hoisted(() => ({ mode: 'ready' as 'ready' | 'missing' | 'unconfigured' | 'dirty' | 'pending', render: vi.fn() }));
vi.mock('./PathFinderBarriersPanel', async () => {
  const { useEffect } = await import('react');
  return { PathFinderBarriersPanel: (props: PathFinderBarriersPanelProps) => {
    barrierComposition.render(props);
    const model = props.pf.data?.activeModel;
    const mode = barrierComposition.mode;
    useEffect(() => {
      if (!props.projectId || !model?.modelVersionId || !model.contentFingerprint) return;
      if (mode === 'missing' || mode === 'pending') {
        props.onStateChange?.({ registry: null, dirty: false, pending: mode === 'pending' }); return;
      }
      const scope = { projectId: props.projectId, modelVersionId: model.modelVersionId, selectionRevision: model.selectionRevision,
        contentFingerprint: model.contentFingerprint, captureFrameId: '88888888-8888-4888-8888-888888888888', captureFrameSha256: 'c'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
      props.onStateChange?.({ registry: { schemaVersion: 'wfc.pf.barrier-registry.v1', scope, registryRevision: '1', state: mode === 'unconfigured' ? 'unconfigured' : 'ready', selectedParents: [],
        snapshot: mode === 'unconfigured' ? null : { snapshotId: '99999999-9999-4999-8999-999999999999', scope, registryRevision: '1', contentSha256: 'd'.repeat(64), mode: 'explicit-empty' }, reasonCodes: [] }, dirty: mode === 'dirty', pending: false });
    }, [props.projectId, props.onStateChange, model, mode]);
    return null;
  } };
});
vi.mock('./PathFinderRecalculationPanel', () => ({ PathFinderRecalculationPanel: () => null }));
const trayPreparationCapture = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./ProjectPreparationPanel', () => ({ ProjectPreparationPanel: (props: Parameters<typeof import('./ProjectPreparationPanel').ProjectPreparationPanel>[0]) => {
  trayPreparationCapture.render(props); return null;
} }));
const projectId = '11111111-1111-4111-8111-111111111111', modelId = '22222222-2222-4222-8222-222222222222', locationId = '33333333-3333-4333-8333-333333333333';
const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bulkJobId = '77777777-7777-4777-8777-777777777777';
function model() {
  const action = vi.fn(async () => null);
  const matched = { status: 'matched' as const, locationId, candidates: [locationId] }, missing = { status: 'missing' as const, locationId: null, candidates: [] };
  return { preparationAccess: {projectId:null,loadedProjectId:null,token:null,isAdmin:false}, preparationViewerGeneration:0, runProjectPreparation:vi.fn(async()=>{throw new Error('Not part of this diagnostic fixture');}), loading: false, busy: false, error: null, viewerPhase: 'ready' as const, viewerMessage: 'The active model is ready.',
    data: { schemaVersion: 1 as const, projectId, registryRevision: '3', activeModel: { modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) },
      settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '4', endConnectionLength: '2', additionalBendingPercent: '5' }, artifacts: [], jobs: [], proposals: [],
      cables: [{ id: '44444444-4444-4444-8444-444444444444', cableId: 1, tag: '=CABLE-1', fromLocation: 'EQ-001', toLocation: 'EQ-002', mto: 'Control', routing: null, designLength: null, installLength: 123, cableWriteRevision: '0', fromMatch: matched, toMatch: missing },
        { id: '55555555-5555-4555-8555-555555555555', cableId: 2, tag: '=CABLE-2', fromLocation: 'EQ-002', toLocation: 'EQ-001', mto: 'Instrumentation', routing: null, designLength: null, installLength: null, cableWriteRevision: '0', fromMatch: missing, toMatch: matched }],
      locations: [{ id: locationId, name: 'EQ-001', aliases: ['Equipment A'], revision: '1', binding: { modelVersionId: modelId, revision: '1', point: [1, 2, 3] as [number, number, number], objectId: 'dbid:23', externalId: 'ext-23', source: 'manual' as const, status: 'confirmed' as const } }] },
    refresh: vi.fn(), refreshState: vi.fn(async () => null), reloadViewer: vi.fn(), action, actionWithoutRefresh: action, matchAll: vi.fn(async () => null), calculate: vi.fn(async () => null), submitCalculation: vi.fn(async () => ({ kind: 'not-submitted' as const, code: 'DIAGNOSTIC_FIXTURE' })), readProposal: vi.fn(async () => null), readJob: vi.fn(async () => null), reviewProposal: vi.fn(async () => null), prepareModel: vi.fn(async () => null), startLookup: vi.fn(async () => null), readLookup: vi.fn(async () => null), startPreview: vi.fn(async () => null), readPreview: vi.fn(async () => null), saveLocation: vi.fn(async () => ({ locationId, registryRevision: '4' })), uploadSnapshot: vi.fn(async () => null),
    pickPoint: vi.fn(async () => ({ objectId: 44, point: [4.5, -6, 7] as [number, number, number], derivation: 'picked-surface-point' as const })), cancelPicking: vi.fn(), cancelOperation: vi.fn(), readObjects: vi.fn(async () => null), readSelection: vi.fn(async () => ({ coordinateFrame: 'world-metres-z-up' as const, metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0] as [number, number, number], objects: [viewerObject(44, 'Tray group A')] })), readTrayRootSelection: vi.fn(async () => null), readObjectGuid: vi.fn(async () => null), showLocation: vi.fn(async () => true), showTray: vi.fn(async () => true), hideTray: vi.fn(async () => true), setPathTransparency: vi.fn(async () => undefined), showPath: vi.fn(async () => null), clear: vi.fn(), zoom: vi.fn() };
}
function viewerObject(objectId: number, name: string): ViewerModelObject { return { objectId, name, parentId: null, externalId: null, bounds: { minimum: [1, 2, 3], maximum: [3, 4, 5] }, bottomCentre: [2, 3, 3], derivation: 'display-aabb-bottom-centre', nativeVisibility: 'unknown', properties: [], propertiesTruncated: false }; }
let pf: ReturnType<typeof model>;
function proposalModel() { return { ...pf, preparationAccess: { projectId, loadedProjectId: projectId, token: 'isolated-test-token', isAdmin: true } }; }
beforeEach(() => { vi.clearAllMocks(); barrierComposition.mode = 'ready'; sessionStorage.clear(); localStorage.clear(); pf = model(); vi.mocked(usePathFinder).mockReturnValue(pf);
  vi.mocked(submitAllPathFinderCalculations).mockResolvedValue({ kind: 'acknowledged', jobId: bulkJobId, registryRevision: '3', duplicate: false });
  vi.mocked(fetchPathFinderJob).mockResolvedValue({ id: bulkJobId, projectId, kind: 'calculate', status: 'complete',
    total: 2, completed: 2, cancelRequested: false, failure: null, attempts: 1,
    createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T12:00:01Z', items: [
      { cableId: pf.data.cables[0].id, state: 'complete', status: 'calculated', message: null,
        automaticUpdate: { status: 'written', receiptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', reasonCode: null } },
      { cableId: pf.data.cables[1].id, state: 'complete', status: 'calculated', message: null },
    ] });
  vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(async (_project, _token, cableId) => {
    const current = vi.mocked(usePathFinder).mock.results.at(-1)?.value as ReturnType<typeof usePathFinder>;
    const cable = current.data!.cables.find(value => value.id === cableId)!, available = { status: 'confirmed-ready', pointAvailable: true,
      source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false };
    return cableWorkflowDetailSchema.parse({ schemaVersion: 'wfc.pf.cable-workflow-detail.v1', projectId, cableId,
      querySha256: 'a'.repeat(64), contextSha256: 'b'.repeat(64), row: { projectId, mto: cable.mto,
        cable: { id: cable.id, tag: cable.tag, fromLocation: cable.fromLocation, toLocation: cable.toLocation, routing: cable.routing,
          designLength: cable.designLength === null ? null : String(cable.designLength), installLength: cable.installLength === null ? null : String(cable.installLength), cableWriteRevision: cable.cableWriteRevision },
        from: available, to: available, calculation: { jobId: null, jobStatus: null, itemState: null, outcome: 'not-evaluated', reasonCodes: [], errorCode: null,
          currentness: 'not-evaluated', proposalId: null, proposalHash: null, reviewable: false, acceptedMatchesCurrent: false } } });
  });
  vi.mocked(fetchEndpointBinding).mockImplementation(async (_project, _token, selectedId) => {
    const f = endpointBindingFixture(), existing = selectedId === locationId;
    return { ...f.context, projectId, locationId: selectedId, current: { ...f.context.current!, modelVersionId: modelId, traceId: null }, location: existing ? { id: locationId, name: 'EQ-001', aliases: ['Equipment A'], revision: '1' } : null, head: existing ? { ...f.binding, projectId, locationId, modelVersionId: modelId, pointProjectMetres: [1, 2, 3] } : null, usage: { fromOccurrences: 1, toOccurrences: 1, distinctCables: 2 } };
  });
  vi.mocked(fetchEndpointBindingHistory).mockResolvedValue({ schemaVersion: 'wfc.pf.endpoint-binding-history.v1', projectId, locationId, bindings: [], nextBeforeRevision: null });
  vi.mocked(saveEndpointBinding).mockImplementation(async (_project, _token, selectedId) => { const f = endpointBindingFixture(); return { ...f.receipt, projectId, locationId: selectedId, binding: { ...f.binding, projectId, locationId: selectedId } }; });
});
const mount = (isAdmin = true) => { const view = render(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin={isAdmin} />); if (isAdmin) {
  for (const label of ['Advanced standalone path', 'Advanced project cables and shared locations']) {
    const summary = screen.getByText(label); (summary.parentElement as HTMLDetailsElement).open = true;
  }
} return view; };
function protectedFixture() {
  const id = (value: number) => value === 1 ? projectId : value === 8 ? modelId : `62000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
  const scope = { projectId, modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64),
    captureFrameId: '88888888-8888-4888-8888-888888888888', captureFrameSha256: 'c'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  return barrierCalculationFixture(id, false, [[1, 2, 3], [4, 5, 6]], { schemaVersion: 'wfc.pf.barrier-admission-intent.v1', scope,
    expectedRegistryRevision: '1', expectedSnapshot: { snapshotId: '99999999-9999-4999-8999-999999999999', scope, registryRevision: '1', contentSha256: 'd'.repeat(64), mode: 'explicit-empty' }, drillThroughWalls: false });
}
function proposal(synthetic: boolean): PathFinderProposal { const fixture = protectedFixture(); return {
  id: '66666666-6666-4666-8666-666666666666', projectId, jobId: '77777777-7777-4777-8777-777777777777', cableId: pf.data.cables[0].id,
  status: 'calculated', proposalHash: 'f'.repeat(64), revisionResultHash: 'e'.repeat(64), revisionBaselineHash: 'd'.repeat(64), cableWriteRevision: '0', stale: false, synthetic, engineeringAccepted: synthetic, acceptanceScope: synthetic ? 'local-synthetic-fixture' : 'unaccepted-model', canApply: synthetic,
  compatibilityIssue: null, routingPreferences: fixture.preferences, barriers: fixture.barriers,
  provenance: { dependencyVersion: 'pathfinder.dependencies.v8', dependencyHash: 'c'.repeat(64), engineIdentity: fixture.engineIdentity, automatic: null,
    endpointSources: { from: 'confirmed-shared-location', to: 'confirmed-shared-location' } },
  message: 'Route calculated.', engineeringMessage: synthetic ? 'Synthetic local demonstration only.' : 'Native engineering verification is pending.', createdAt: '2026-10-18T00:00:00Z',
  design: { lengthBeforePercentageMeters: '20', unroundedLengthMeters: '21', designLengthMeters: '21' },
  route: { success: true, message: 'Route found.', routeText: '/BC1', routeCodes: ['/BC1'], segmentIds: ['dbid:23'], objectIds: ['dbid:23'], points: [[1, 2, 3], [4, 5, 6]], lengthMeters: 18, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 },
}; }
const artifact = (): PathFinderState['artifacts'][number] => ({ id: '99999999-9999-4999-8999-999999999999', modelVersionId: modelId, snapshotSha256: 'a'.repeat(64), objectCount: 2, engineeringAccepted: false, readiness: 'unverified', capture: {}, coordinates: {}, createdAt: '2026-10-18T00:00:00Z' });
function lookup(id: string, reverse = false): PathFinderLookup { return { id, projectId, kind: 'lookup', status: 'complete', total: 1, completed: 1, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:01Z', failure: null, input: { routeText: '/BC1/BC2', reverse },
  result: { status: 'calculated', message: 'Diagnostic lookup complete.', prepared: {}, connectionGap: '1', diagnostics: { geometryLeavesUsed: 2, fallbackBends: 0, fallbackStraights: 0, fallbackClearances: 0 }, engineeringAccepted: false, acceptanceScope: 'diagnostic-lookup', stale: false, design: null, route: { ...proposal(false).route!, routeText: reverse ? '/BC2/BC1' : '/BC1/BC2', points: reverse ? [[4, 5, 6], [1, 2, 3]] : [[1, 2, 3], [4, 5, 6]] } } }; }
function preview(id: string, reverse = false): PathFinderPreview { return { id, projectId, kind: 'preview', status: 'complete', total: 1, completed: 1, cancelRequested: false, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:01Z', failure: null,
  input: { from: { name: 'EQ-001' }, to: { name: 'EQ-002' }, category: 'LV', cablePurpose: 'Power', reverse, secondaryDistanceMeters: 2, preferVerticalApproach: true, artifactId: artifact().id, expectedSelectionRevision: '2', expectedSettingsRevision: '1', expectedRegistryRevision: '3' },
  result: { status: 'calculated', message: 'Standalone route found.', prepared: {}, engineeringAccepted: false, acceptanceScope: 'standalone-preview', canApply: false, stale: false, design: proposal(false).design, settings: pf.data.settings, effectiveCategory: 'LV',
    from: { name: reverse ? 'EQ-002' : 'EQ-001', point: [1, 2, 3], source: 'shared-location', objectId: null, locationId, bindingRevision: '1' }, to: { name: reverse ? 'EQ-001' : 'EQ-002', point: [4, 5, 6], source: 'shared-location', objectId: null, locationId, bindingRevision: '1' }, route: { ...proposal(false).route!, points: reverse ? [[4, 5, 6], [1, 2, 3]] : [[1, 2, 3], [4, 5, 6]] } } }; }

// Fluent's expanded sidebar makes jsdom role/style queries expensive; assertions still use their normal wait budgets.
describe('admin PathFinder interface', { timeout: 60_000 }, () => {
  it('keeps the camera and viewer host through Routes, Path and Path lookup changes', async () => {
    const user = userEvent.setup(); mount();
    const host = screen.getByTestId('pathfinder-model-host');
    pf.clear.mockClear(); pf.cancelOperation.mockClear();
    for (const name of ['Routes', 'Path lookup', 'Path', 'Routes', 'Path']) {
      await user.click(screen.getByRole('tab', { name }));
      expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('pathfinder-model-host')).toBe(host);
    }
    expect(pf.cancelOperation).toHaveBeenCalled(); expect(pf.clear).toHaveBeenCalled();
    expect(pf.clear).not.toHaveBeenCalledWith({ preserveCamera: false });
    expect(pf.reloadViewer).not.toHaveBeenCalled(); expect(pf.zoom).not.toHaveBeenCalled();
  });
  it('resets the camera only for Restore view, while Clear retains the current view', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('tab', { name: 'Path' }));
    pf.clear.mockClear();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(pf.clear).toHaveBeenCalled(); expect(pf.clear).not.toHaveBeenCalledWith({ preserveCamera: false });
    await user.click(screen.getByRole('button', { name: 'Restore view' }));
    expect(pf.clear).toHaveBeenLastCalledWith({ preserveCamera: false });
    expect(pf.reloadViewer).not.toHaveBeenCalled();
  });
  it('keeps one independent From/To action available in Routes and Path and pauses it in lookup', async () => {
    const user = userEvent.setup(), current = proposalModel(); vi.mocked(usePathFinder).mockReturnValue(current);
    render(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />);
    expect(screen.getAllByRole('button', { name: 'Find and assign From/To' })).toHaveLength(1);
    expect(modelMatchCapture.render.mock.calls.at(-1)?.[0]).toMatchObject({ active: true, accountId, pf: { preparationAccess: current.preparationAccess } });
    await user.click(screen.getByRole('tab', { name: 'Routes' }));
    expect(screen.getAllByRole('button', { name: 'Find and assign From/To' })).toHaveLength(1);
    expect(modelMatchCapture.render.mock.calls.at(-1)?.[0].active).toBe(true);
    await user.click(screen.getByRole('tab', { name: 'Path lookup' }));
    expect(screen.queryByRole('button', { name: 'Find and assign From/To' })).not.toBeInTheDocument();
    expect(modelMatchCapture.render.mock.calls.at(-1)?.[0].active).toBe(false);
    expect(current.matchAll).not.toHaveBeenCalled(); expect(current.calculate).not.toHaveBeenCalled();
  });
  it.each(['missing', 'unconfigured', 'dirty', 'pending'] as const)('keeps cable read preferences while %s barriers block calculations with drilling off', async mode => {
    barrierComposition.mode = mode;
    const current = proposalModel(); vi.mocked(usePathFinder).mockReturnValue(current);
    render(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />);
    await waitFor(() => {
      const workspace = workspaceCapture.render.mock.calls.at(-1)?.[0] as PathFinderCableWorkspaceProps;
      expect(workspace).toMatchObject({ active: true, preferences: null,
        readPreferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true } });
      expect(workspace.readPreferences).not.toHaveProperty('barrierRouting');
    });
    expect(screen.getByRole('checkbox', { name: 'Drill through the walls' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeDisabled();
    expect(screen.getByText(mode === 'pending'
      ? 'Wait for the saved barrier command to finish, or use Retry saved command in Barriers if its outcome is unknown.'
      : mode === 'dirty' ? 'Save the obstacle selection in Barriers before calculating.'
        : 'Configure Barriers: save the selected obstacles, or enter an Explicit empty reason and choose Declare no barriers to calculate without obstacle checks.')).toBeVisible();
    expect(current.calculate).not.toHaveBeenCalled(); expect(current.action).not.toHaveBeenCalled();
    expect(current.reviewProposal).not.toHaveBeenCalled(); expect(saveEndpointBinding).not.toHaveBeenCalled();
  });
  it('preserves exact barrier read and calculation preferences when the registry is ready', async () => {
    vi.mocked(usePathFinder).mockReturnValue(proposalModel());
    render(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />);
    await waitFor(() => {
      const workspace = workspaceCapture.render.mock.calls.at(-1)?.[0] as PathFinderCableWorkspaceProps;
      expect(workspace.preferences?.barrierRouting).toMatchObject({ drillThroughWalls: false, expectedRegistryRevision: '1' });
      expect(workspace.readPreferences).toEqual(workspace.preferences);
    });
  });
  it('restores the real bulk control after an unknown barrier command settles', async () => {
    barrierComposition.mode = 'pending';
    const data = { ...pf.data, artifacts: [artifact()] }, current = { ...proposalModel(), data, refreshState: vi.fn(async () => data) };
    vi.mocked(usePathFinder).mockReturnValue(current);
    const props = { projectId, loadedProjectId: projectId, token: 'isolated-test-token', accountId, isAdmin: true };
    const view = render(<PathFinderTab {...props} />), calculate = screen.getByRole('button', { name: 'Recalculate all the cables' });
    await waitFor(() => expect((workspaceCapture.render.mock.calls.at(-1)?.[0] as PathFinderCableWorkspaceProps).preferences).toBeNull());
    expect(calculate).toBeDisabled(); expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
    barrierComposition.mode = 'ready'; view.rerender(<PathFinderTab {...props} />);
    await waitFor(() => expect(calculate).toBeEnabled()); fireEvent.click(calculate);
    await waitFor(() => expect(submitAllPathFinderCalculations).toHaveBeenCalledOnce());
    expect(submitAllPathFinderCalculations).toHaveBeenCalledWith(projectId, 'isolated-test-token', expect.objectContaining({
      force: true, automaticPairPolicy: { schemaVersion: 'wfc.pf.automatic-pair-policy.v1', mode: 'when-both-empty-or-unchanged-automatic' },
      options: expect.objectContaining({ barrierRouting: expect.objectContaining({ drillThroughWalls: false, expectedRegistryRevision: '1' }) }),
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(current.calculate).not.toHaveBeenCalled(); expect(current.action).not.toHaveBeenCalled();
    expect(current.reviewProposal).not.toHaveBeenCalled(); expect(saveEndpointBinding).not.toHaveBeenCalled();
  });
  it('returns a detached cable action to the parent barrier configuration without changing the drilling choice or starting work', async () => {
    barrierComposition.mode = 'missing';
    const current = proposalModel(); vi.mocked(usePathFinder).mockReturnValue(current);
    const focusWindow = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    render(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />);
    const configuration = screen.getByRole('region', { name: 'Routing barrier configuration' });
    const scroll = vi.fn(); Object.defineProperty(configuration, 'scrollIntoView', { configurable: true, value: scroll });
    await waitFor(() => expect((workspaceCapture.render.mock.calls.at(-1)?.[0] as PathFinderCableWorkspaceProps).preferences).toBeNull());
    const workspace = workspaceCapture.render.mock.calls.at(-1)?.[0] as PathFinderCableWorkspaceProps;
    expect(workspace.onConfigureCalculation).toBeTypeOf('function');
    act(() => workspace.onConfigureCalculation?.());
    expect(focusWindow).toHaveBeenCalledOnce(); expect(scroll).toHaveBeenCalledWith({ block: 'start' }); expect(configuration).toHaveFocus();
    expect(screen.getByRole('checkbox', { name: 'Drill through the walls' })).not.toBeChecked();
    expect(current.calculate).not.toHaveBeenCalled(); expect(current.action).not.toHaveBeenCalled(); expect(current.reviewProposal).not.toHaveBeenCalled();
    focusWindow.mockRestore();
  });
  it('passes read-only preferences to the headless result owner when barriers are unavailable', async () => {
    barrierComposition.mode = 'missing'; const user = userEvent.setup(), current = proposalModel(); vi.mocked(usePathFinder).mockReturnValue(current); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1From:/ }));
    const result = resultCapture.render.mock.calls.at(-1)?.[0] as Parameters<typeof PathFinderResults>[0];
    expect(result).toMatchObject({ selectedCableId: pf.data.cables[0].id, options: null,
      readPreferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, workflowConfigurationReady: false });
    expect(result.readPreferences).not.toHaveProperty('barrierRouting');
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Proposal review' })).toBeNull();
    expect(current.calculate).not.toHaveBeenCalled(); expect(current.reviewProposal).not.toHaveBeenCalled(); expect(current.action).not.toHaveBeenCalled();
  });
  it('forwards the headless owner’s exact completed item to the separate ordinary Auto read', async () => {
    const user = userEvent.setup(), detail = proposal(true), current = proposalModel(); vi.mocked(usePathFinder).mockReturnValue(current); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1From:/ }));
    const result = resultCapture.render.mock.calls.at(-1)?.[0] as Parameters<typeof PathFinderResults>[0];
    const item = { projectId, cableId: detail.cableId, jobId: detail.jobId, proposalId: detail.id,
      proposalHash: detail.proposalHash, revisionResultHash: detail.revisionResultHash!, dependencyHash: detail.provenance!.dependencyHash };
    act(() => result.onCalculationCommitted?.(item));
    expect(autoReadCapture.read).toHaveBeenLastCalledWith(expect.objectContaining({ projectId, loadedProjectId: projectId,
      accountId, selectedCableId: detail.cableId, item }));
    expect(current.refresh).not.toHaveBeenCalled(); expect(current.reviewProposal).not.toHaveBeenCalled(); expect(current.action).not.toHaveBeenCalled();
  });
  it('shows automatic point availability independently of saved bindings and filters only missing calculation points', async () => {
    const user = userEvent.setup(), automaticId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const confirmed = calculationAvailabilitySchema.parse({ status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false });
    const automatic = calculationAvailabilitySchema.parse({ status: 'automatic-ready', pointAvailable: true, source: 'automatic-model-candidate', approximate: true, candidateObjectIds: ['dbid:44'], reasonCode: null, engineeringAccepted: false });
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data,
      locations: [{ ...pf.data.locations[0], calculationAvailability: confirmed }, { id: automaticId, name: 'EQ-002', aliases: [], revision: '1', binding: null, calculationAvailability: automatic }],
      cables: [{ ...pf.data.cables[0], toMatch: { status: 'missing', locationId: automaticId, candidates: [] } }, pf.data.cables[1]],
    } }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1From:/ }));
    const selected = within(screen.getByTestId('pathfinder-selected-cable'));
    expect(selected.getByText('To: EQ-002 — Automatic model point (approximate, unconfirmed)')).toBeVisible();
    expect(selected.getByText('To saved binding: missing')).toBeVisible(); expect(selected.getByText('From saved binding: matched')).toBeVisible();
    expect(screen.getByText(/Point availability does not guarantee a route or authorize Apply/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resolve From' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Resolve To' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Resolve To' })); expect(screen.getByRole('textbox', { name: 'Location name' })).toHaveValue('EQ-002');
    await user.click(screen.getByRole('checkbox', { name: 'Without a calculation point' }));
    const list = within(screen.getByRole('list', { name: 'Path Finder cables' }));
    expect(list.queryByRole('button', { name: /=CABLE-1From:/ })).toBeNull(); expect(list.getByRole('button', { name: /=CABLE-2From:/ })).toBeVisible();
    expect(pf.calculate).not.toHaveBeenCalled(); expect(saveEndpointBinding).not.toHaveBeenCalled();
  });
  it('fails closed on absent legacy availability even when old binding labels say matched', async () => {
    const user = userEvent.setup(), matched = pf.data.cables[0].fromMatch;
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, cables: [{ ...pf.data.cables[0], toMatch: matched }] } }); mount();
    await user.click(screen.getByRole('checkbox', { name: 'Without a calculation point' }));
    const row = within(screen.getByRole('list', { name: 'Path Finder cables' })).getByRole('button', { name: /=CABLE-1From:/ });
    expect(row).toHaveTextContent('From: Calculation point not evaluated; To: Calculation point not evaluated');
    expect(row).toHaveTextContent('Saved bindings — From: matched; To: matched');
  });
  it('does not borrow an available point from an ambiguous alias candidate with no unique location ID', async () => {
    const user = userEvent.setup(), availability = calculationAvailabilitySchema.parse({ status: 'automatic-ready', pointAvailable: true, source: 'automatic-model-candidate', approximate: true, candidateObjectIds: ['dbid:44'], reasonCode: null, engineeringAccepted: false });
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data,
      locations: [{ ...pf.data.locations[0], calculationAvailability: availability }],
      cables: [{ ...pf.data.cables[0], fromMatch: { status: 'ambiguous', locationId: null, candidates: [locationId, locationId] }, toMatch: pf.data.cables[0].fromMatch }],
    } }); mount(); await user.click(screen.getByRole('checkbox', { name: 'Without a calculation point' }));
    const row = within(screen.getByRole('list', { name: 'Path Finder cables' })).getByRole('button', { name: /=CABLE-1From:/ });
    expect(row).toHaveTextContent('From: Calculation point not evaluated; To: Automatic model point (approximate, unconfirmed)');
    expect(row).toHaveTextContent('Saved bindings — From: ambiguous; To: matched');
  });
  it('keeps blocked point evidence visible with explicit manual-resolution labels', async () => {
    const user = userEvent.setup();
    const blocked: [CalculationAvailability['status'], string][] = [['missing', 'No model point found'], ['ambiguous', 'Multiple model points; resolve manually'], ['saved-binding-required', 'Saved binding needs confirmation'], ['object-unverified', 'Model point is unverified'], ['preparation-required', 'Current preparation required'], ['not-evaluated', 'Calculation point not evaluated']];
    const locations = blocked.map(([status], index) => ({ id: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, '0')}`, name: 'EQ-' + index, aliases: [], revision: '1', binding: null,
      calculationAvailability: calculationAvailabilitySchema.parse({ status, pointAvailable: false, source: null, approximate: false, candidateObjectIds: [], reasonCode: 'POINT_REVIEW_REQUIRED', engineeringAccepted: false }) }));
    const cables = locations.map((location, index) => ({ ...pf.data.cables[0], id: location.id, cableId: index, tag: '=BLOCKED-' + index, fromMatch: { status: 'missing' as const, locationId: location.id, candidates: [] }, toMatch: { status: 'missing' as const, locationId: location.id, candidates: [] } }));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, locations, cables } }); mount(); await user.click(screen.getByRole('checkbox', { name: 'Without a calculation point' }));
    const list = within(screen.getByRole('list', { name: 'Path Finder cables' })); expect(list.getAllByRole('button')).toHaveLength(blocked.length);
    for (const [index, [, label]] of blocked.entries()) expect(list.getByRole('button', { name: new RegExp('=BLOCKED-' + index + 'From:') })).toHaveTextContent('From: ' + label + '; To: ' + label);
  });
  it('retains an unknown atomic endpoint command across tool changes and locks shared location selection until reconciliation', async () => {
    const user = userEvent.setup(); vi.mocked(saveEndpointBinding).mockRejectedValueOnce(new TypeError('Lost save acknowledgement')); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve From' }));
    await waitFor(() => expect(screen.getByLabelText('Reason for confirmation')).toBeEnabled());
    await user.type(screen.getByLabelText('Reason for confirmation'), 'Reviewed shared point'); await user.click(screen.getByRole('button', { name: 'Confirm shared endpoint' }));
    await screen.findByRole('button', { name: 'Reconcile same save' });
    expect(screen.getByRole('combobox', { name: 'Saved location' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Resolve From' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Resolve To' })).toBeDisabled();
    const command = vi.mocked(saveEndpointBinding).mock.calls[0][3];
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByRole('tab', { name: 'Path' }));
    await user.click(screen.getByRole('button', { name: 'Reconcile same save' }));
    expect(saveEndpointBinding).toHaveBeenCalledTimes(2); expect(vi.mocked(saveEndpointBinding).mock.calls[1][3]).toBe(command);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Saved location' })).toBeEnabled()); expect(pf.saveLocation).not.toHaveBeenCalled();
  });
  it('does not mount any hook or protected frame when administrator access is absent', () => {
    mount(false); expect(screen.getByText('Path Finder is available only to administrators.')).toBeVisible();
    expect(usePathFinder).not.toHaveBeenCalled(); expect(screen.queryByTestId('pathfinder-model-host')).toBeNull();
  });
  it('resolves either cable endpoint using the same saved project location and preserves install length', async () => {
    const user = userEvent.setup();
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, locations: pf.data.locations.map(location => ({ ...location, binding: { ...location.binding, status: 'stale' as const, derivation: 'equipment-bottom-aabb' as const } })) } }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-2/ })); await user.click(screen.getByRole('button', { name: 'Resolve To' }));
    expect(screen.getByRole('textbox', { name: 'Location name' })).toHaveValue('EQ-001'); await waitFor(() => expect(screen.getByRole('textbox', { name: 'Endpoint X in metres' })).toHaveValue('1'));
    await user.type(screen.getByLabelText('Reason for confirmation'), 'Shared current-frame confirmation');
    await user.click(screen.getByRole('button', { name: 'Confirm shared endpoint' }));
    expect(saveEndpointBinding).toHaveBeenCalledWith(projectId, 'isolated-test-token', locationId, expect.objectContaining({ mode: 'fixed-world', location: { name: 'EQ-001', aliases: ['Equipment A'] }, pointProjectMetres: [1, 2, 3] }), expect.any(AbortSignal));
    expect(pf.refresh).toHaveBeenCalled(); expect(pf.saveLocation).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Saved location' })).toHaveValue(locationId);
    expect(pf.data.cables[0].installLength).toBe(123);
  });
  it('requires explicit finite coordinates for a missing endpoint and keeps a pick uncommitted until Save', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve To' }));
    expect(screen.getByRole('textbox', { name: 'Location name' })).toHaveValue('EQ-002'); expect(screen.getByRole('button', { name: 'Confirm shared endpoint' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick surface point in 3D' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Pick surface point in 3D' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Endpoint X in metres' })).toHaveValue('4.5'));
    expect(pf.saveLocation).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Reason for confirmation'), 'Reviewed picked point');
    await user.click(screen.getByRole('button', { name: 'Confirm shared endpoint' }));
    expect(saveEndpointBinding).toHaveBeenCalledWith(projectId, 'isolated-test-token', expect.any(String), expect.objectContaining({ expectedLocationRevision: null, mode: 'fixed-world', pointProjectMetres: [4.5, -6, 7], provenanceObject: null, derivation: 'picked-surface-point', location: { name: 'EQ-002', aliases: [] } }), expect.any(AbortSignal));
  });
  it('manual point edits remove picked object evidence and invalid numbers cannot be saved', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve From' }));
    const x = screen.getByRole('textbox', { name: 'Endpoint X in metres' }); await waitFor(() => expect(x).toBeEnabled()); await user.clear(x); await user.type(x, 'Infinity');
    expect(screen.getByRole('button', { name: 'Confirm shared endpoint' })).toBeDisabled(); await user.clear(x); await user.type(x, '1.25');
    await user.type(screen.getByLabelText('Reason for confirmation'), 'Manual coordinate correction');
    await user.click(screen.getByRole('button', { name: 'Confirm shared endpoint' })); expect(saveEndpointBinding).toHaveBeenCalledWith(projectId, 'isolated-test-token', locationId, expect.objectContaining({ pointProjectMetres: [1.25, 2, 3], provenanceObject: null, derivation: 'manual-world-point' }), expect.any(AbortSignal));
  });
  it('can save a picked point explicitly as coordinates when its object is outside the prepared snapshot', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve To' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick surface point in 3D' })).toBeEnabled()); await user.click(screen.getByRole('button', { name: 'Pick surface point in 3D' }));
    await user.type(screen.getByLabelText('Reason for confirmation'), 'Fixed picked point without object evidence'); await user.click(screen.getByRole('button', { name: 'Confirm shared endpoint' }));
    expect(saveEndpointBinding).toHaveBeenCalledWith(projectId, 'isolated-test-token', expect.any(String), expect.objectContaining({ mode: 'fixed-world', pointProjectMetres: [4.5, -6, 7], provenanceObject: null, derivation: 'picked-surface-point' }), expect.any(AbortSignal));
  });
  it('keeps Routes free of manual capture and import controls', async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole('tab', { name: 'Routes' }));
    expect(screen.queryByText('Advanced model preparation and import')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Routing network codes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prepare selected model network' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Routing barrier configuration', hidden: true })).not.toBeVisible();
    expect(pf.prepareModel).not.toHaveBeenCalled(); expect(pf.uploadSnapshot).not.toHaveBeenCalled();
  });
  it('keeps the tray check and From/To check from changing their shared inputs at the same time', async () => {
    const user = userEvent.setup(); mount(); await user.click(screen.getByRole('tab', { name: 'Routes' }));
    act(() => modelMatchCapture.render.mock.lastCall![0].onBusyChange(true));
    expect(trayPreparationCapture.render.mock.lastCall![0].pf.busy).toBe(true);
    act(() => modelMatchCapture.render.mock.lastCall![0].onBusyChange(false));
    act(() => trayPreparationCapture.render.mock.lastCall![0].onBusyChange(true));
    expect(modelMatchCapture.render.mock.lastCall![0].pf.busy).toBe(true);
  });
  it.each(['loading', 'no-model', 'error'] as const)('keeps model recovery available in Routes while the viewer is %s', async viewerPhase => {
    const user = userEvent.setup();
    const current = { ...pf, viewerPhase } as ReturnType<typeof usePathFinder>;
    vi.mocked(usePathFinder).mockReturnValue(current); mount();
    await user.click(screen.getByRole('tab', { name: 'Routes' }));
    expect(screen.getByRole('button', { name: 'Refresh Path Finder' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Reload model' }));
    expect(current.reloadViewer).toHaveBeenCalledOnce();
    expect(current.calculate).not.toHaveBeenCalled();
    expect(current.prepareModel).not.toHaveBeenCalled();
  });
  it('refreshes obstacles when automatic network verification completes without changing the model', async () => {
    const user = userEvent.setup(); mount(); await user.click(screen.getByRole('tab', { name: 'Routes' }));
    expect(barrierComposition.render.mock.lastCall![0].refreshKey).toBeNull();
    act(() => trayPreparationCapture.render.mock.lastCall![0].onNetworkReady('aggregate-2:verified-trace'));
    expect(barrierComposition.render.mock.lastCall![0].refreshKey).toBe('aggregate-2:verified-trace');
    expect(pf.prepareModel).not.toHaveBeenCalled(); expect(pf.uploadSnapshot).not.toHaveBeenCalled();
  });
  it('links blank endpoints to existing cable editing without inventing location names', async () => {
    const user = userEvent.setup(); vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, cables: [{ ...pf.data.cables[0], fromLocation: null, toLocation: '' }] } }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ }));
    expect(screen.getByRole('link', { name: 'Edit cable endpoints' })).toHaveAttribute('href', `/projects/${projectId}/cables/${pf.data.cables[0].id}`);
    expect(screen.getByRole('button', { name: 'Resolve From' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Resolve To' })).toBeDisabled();
  });
  it('starts one forced background pass from the real bulk control without taking over the selected popup', async () => {
    const user = userEvent.setup(), data = { ...pf.data, artifacts: [artifact()] },
      current = { ...proposalModel(), data, refreshState: vi.fn(async () => data) };
    vi.mocked(usePathFinder).mockReturnValue(current); mount();
    const popup = () => workspaceCapture.render.mock.calls.at(-1)?.[0] as PathFinderCableWorkspaceProps;
    await act(async () => undefined);
    const detail = await fetchPathFinderCableWorkflowDetail(projectId, 'isolated-test-token', data.cables[0].id,
      { secondaryDistanceMeters: 2, preferVerticalApproach: true });
    await act(async () => popup().onSelect(detail.row)); const before = { refreshKey: Number(popup().refreshKey), clear: pf.clear.mock.calls.length };
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Calculate non-MV cables' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Calculate selected cable' })).toBeNull();
    expect(screen.queryByText('Calculation jobs')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Recalculate all the cables' }));
    await waitFor(() => expect(submitAllPathFinderCalculations).toHaveBeenCalledOnce());
    const submitted = vi.mocked(submitAllPathFinderCalculations).mock.calls[0][2];
    expect(submitted).toMatchObject({ force: true, options: { secondaryDistanceMeters: 2, preferVerticalApproach: true,
      barrierRouting: { drillThroughWalls: false } } }); expect(submitted).not.toHaveProperty('cableIds');
    await waitFor(() => expect(fetchPathFinderJob).toHaveBeenCalledWith(projectId, 'isolated-test-token', bulkJobId, expect.any(AbortSignal)));
    await waitFor(() => expect(Number(popup().refreshKey)).toBeGreaterThan(before.refreshKey));
    expect(popup()).toMatchObject({ active: true, selectedCableId: detail.row.cable.id, pf: { busy: false } });
    expect(pf.clear).toHaveBeenCalledTimes(before.clear); expect(current.calculate).not.toHaveBeenCalled();
    expect(current.submitCalculation).not.toHaveBeenCalled(); expect(current.action).not.toHaveBeenCalled();
  });
  it('previews exact ordered lookup and reverse with unchanged cable labels and the read-only project gap', async () => {
    const user = userEvent.setup(), forwardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reverseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const startLookup = vi.fn().mockResolvedValueOnce(forwardId).mockResolvedValueOnce(reverseId), readLookup = vi.fn().mockImplementation(async (id: string) => lookup(id, id === reverseId)), showPath = vi.fn(async () => 'displayed');
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startLookup, readLookup, showPath }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('tab', { name: 'Path lookup' }));
    await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1/BC2'); expect(screen.queryByRole('spinbutton', { name: 'Lookup connection tolerance in metres' })).toBeNull(); expect(screen.getByText('Connection gap: 1 m. Change this in Project Details. Larger values permit larger unmodelled gaps.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('Lookup complete — forward preview');
    expect(startLookup).toHaveBeenNthCalledWith(1, '/BC1/BC2', false); await waitFor(() => expect(showPath).toHaveBeenCalledWith({ pathId: forwardId, points: [[1, 2, 3], [4, 5, 6]], objectIds: [23] }));
    await user.click(screen.getByRole('button', { name: 'Reverse preview' })); await screen.findByText('Lookup complete — reverse preview');
    expect(startLookup).toHaveBeenNthCalledWith(2, '/BC1/BC2', true); await waitFor(() => expect(showPath).toHaveBeenLastCalledWith({ pathId: reverseId, points: [[4, 5, 6], [1, 2, 3]], objectIds: [23] }));
    expect(screen.getByText(/Original cable labels: From EQ-001; To EQ-002/)).toBeVisible(); expect(within(screen.getByRole('region', { name: 'Ordered lookup result' })).queryByRole('button', { name: /Apply/ })).toBeNull(); expect(pf.action).not.toHaveBeenCalled();
  });
  it('retains an outdated lookup without displaying its stale points', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', detail = lookup(id); detail.result!.stale = true;
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startLookup: vi.fn(async () => id), readLookup: vi.fn(async () => detail) }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1/BC2'); await user.click(screen.getByRole('button', { name: 'Show route' }));
    expect(await screen.findByText('The active model or lookup dependencies changed. Run a fresh lookup before displaying it.')).toBeVisible(); expect(pf.showPath).not.toHaveBeenCalled();
  });
  it('offers three keyboard-accessible tools while retaining one protected model host and local drafts', async () => {
    const user = userEvent.setup(); mount(); const host = screen.getByTestId('pathfinder-model-host');
    expect(vi.mocked(usePathFinder).mock.calls.at(-1)?.[0].automaticStatePolling).toBe(false);
    expect(screen.getByRole('tab', { name: 'Path' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location name' })).toBeEnabled()); await user.type(screen.getByRole('textbox', { name: 'Location name' }), 'Draft location');
    await user.type(screen.getByRole('textbox', { name: 'Path From location' }), 'Equipment draft');
    await user.click(screen.getByRole('tab', { name: 'Routes' }));
    expect(screen.getByRole('tabpanel', { name: 'Routes' })).toBeVisible(); expect(screen.queryByRole('textbox', { name: 'Path From location' })).toBeNull();
    screen.getByRole('tab', { name: 'Path' }).focus(); await user.keyboard('{Enter}'); expect(screen.getByRole('tab', { name: 'Path' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Location name' })).toHaveValue(''); expect(screen.getByRole('textbox', { name: 'Path From location' })).toHaveValue('Equipment draft');
    screen.getByRole('tab', { name: 'Path lookup' }).focus(); await user.keyboard('{Enter}');
    expect(screen.getByRole('tabpanel', { name: 'Path lookup' })).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/DRAFT'); await user.click(screen.getByRole('checkbox', { name: 'Reverse route order' }));
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await user.click(screen.getByRole('tab', { name: 'Path lookup' }));
    expect(screen.getByRole('textbox', { name: 'Path Finder ordered route' })).toHaveValue('/DRAFT'); expect(screen.getByRole('checkbox', { name: 'Reverse route order' })).toBeChecked();
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(3);
    expect(screen.getByTestId('pathfinder-model-host')).toBe(host); expect(pf.reloadViewer).not.toHaveBeenCalled(); expect(pf.cancelOperation).toHaveBeenCalled();
  });
  it('delegates Routes preparation to the current project owner without starting a manual capture', async () => {
    const user = userEvent.setup(), current = proposalModel(); vi.mocked(usePathFinder).mockReturnValue(current); mount();
    expect(trayPreparationCapture.render.mock.lastCall![0]).toMatchObject({ active: false });
    await user.click(screen.getByRole('tab', { name: 'Routes' }));
    const preparation = trayPreparationCapture.render.mock.lastCall![0];
    expect(preparation.active).toBe(true); expect(preparation.pf.data).toBe(current.data);
    expect(preparation.pf.preparationAccess).toEqual(current.preparationAccess);
    expect(preparation.pf.runProjectPreparation).toBe(current.runProjectPreparation);
    expect(screen.queryByRole('button', { name: 'Add current selection' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prepare routes from all rules' })).toBeNull();
    expect(pf.prepareModel).not.toHaveBeenCalled(); expect(pf.uploadSnapshot).not.toHaveBeenCalled();
  });
  it('passes recovery and a changed model revision to the existing preparation panel without replacing the viewer', async () => {
    const user = userEvent.setup(), current = proposalModel(); vi.mocked(usePathFinder).mockReturnValue(current); const view = mount();
    const host = screen.getByTestId('pathfinder-model-host'); await user.click(screen.getByRole('tab', { name: 'Routes' }));
    const updated = { ...current, preparationViewerGeneration: 1, data: { ...current.data, activeModel: { ...current.data.activeModel, selectionRevision: '3', contentFingerprint: 'b'.repeat(64) } } };
    vi.mocked(usePathFinder).mockReturnValue(updated);
    await act(async () => view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />));
    expect(trayPreparationCapture.render.mock.lastCall![0]).toMatchObject({ active: true, pf: { preparationViewerGeneration: 1, data: updated.data } });
    expect(screen.getByTestId('pathfinder-model-host')).toBe(host); expect(pf.reloadViewer).not.toHaveBeenCalled();
  });
  it('keeps the preparation owner mounted but inactive while another viewer tool is selected', async () => {
    const user = userEvent.setup(); mount();
    const prepare = () => trayPreparationCapture.render.mock.lastCall![0];
    expect(prepare().active).toBe(false);
    await user.click(screen.getByRole('tab', { name: 'Routes' })); expect(prepare().active).toBe(true);
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); expect(prepare().active).toBe(false);
    expect(modelMatchCapture.render.mock.lastCall![0].active).toBe(false);
    await user.click(screen.getByRole('tab', { name: 'Path' })); expect(prepare().active).toBe(false);
    expect(modelMatchCapture.render.mock.lastCall![0].active).toBe(true);
    expect(pf.runProjectPreparation).not.toHaveBeenCalled();
  });
  it('forwards controller busy state to both preparation owners and the real background action', async () => {
    const current = { ...proposalModel(), busy: true, data: { ...pf.data, artifacts: [artifact()] } };
    vi.mocked(usePathFinder).mockReturnValue(current); const view = mount();
    expect(trayPreparationCapture.render.mock.lastCall![0].pf.busy).toBe(true);
    expect(modelMatchCapture.render.mock.lastCall![0].pf.busy).toBe(true);
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeDisabled();
    vi.mocked(usePathFinder).mockReturnValue({ ...current, busy: false });
    await act(async () => view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />));
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeEnabled();
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
  });
  it('calculates and reverses a standalone path using original endpoint names and current Path preferences', async () => {
    const user = userEvent.setup(), forwardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reverseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const startPreview = vi.fn().mockResolvedValueOnce(forwardId).mockResolvedValueOnce(reverseId), readPreview = vi.fn(async (id: string) => preview(id, id === reverseId)), showPath = vi.fn(async () => 'displayed');
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startPreview, readPreview, showPath }); mount();
    await user.type(screen.getByRole('textbox', { name: 'Path From location' }), 'EQ-001'); await user.type(screen.getByRole('textbox', { name: 'Path To location' }), 'EQ-002'); await user.selectOptions(screen.getByRole('combobox', { name: 'Path cable purpose' }), 'Power'); await user.click(screen.getByRole('button', { name: 'Calculate path' }));
    expect(startPreview).toHaveBeenNthCalledWith(1, expect.objectContaining({ from: { name: 'EQ-001' }, to: { name: 'EQ-002' }, category: 'LV', reverse: false, secondaryDistanceMeters: 2, preferVerticalApproach: true, barrierRouting: expect.objectContaining({ drillThroughWalls: false }) }));
    await screen.findByText('Path calculation complete'); await waitFor(() => expect(showPath).toHaveBeenCalledWith({ pathId: forwardId, points: [[1, 2, 3], [4, 5, 6]], objectIds: [23] }));
    await user.click(screen.getByRole('button', { name: 'Reverse path' })); await screen.findByText(/Original endpoints: From EQ-001; To EQ-002. Reverse preview/);
    expect(startPreview).toHaveBeenLastCalledWith(expect.objectContaining({ from: { name: 'EQ-001' }, to: { name: 'EQ-002' }, category: 'LV', reverse: true }));
    await waitFor(() => expect(showPath).toHaveBeenLastCalledWith({ pathId: reverseId, points: [[4, 5, 6], [1, 2, 3]], objectIds: [23] })); expect(pf.action).not.toHaveBeenCalled();
    expect(within(screen.getByRole('region', { name: 'Standalone path result' })).queryByRole('button', { name: /Apply/ })).toBeNull();
  });
  it('shared Clear removes the displayed standalone notice and result while preserving drafts and preferences without requests', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const startPreview = vi.fn(async () => id), readPreview = vi.fn(async () => preview(id)), showPath = vi.fn(async () => 'displayed');
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startPreview, readPreview, showPath }); mount();
    await user.type(screen.getByRole('textbox', { name: 'Path From location' }), 'EQ-001'); await user.type(screen.getByRole('textbox', { name: 'Path To location' }), 'EQ-002');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Path cable type' }), 'Control');
    const trigger = screen.getByRole('textbox', { name: 'SECONDARY trigger distance in metres' }); await user.clear(trigger); await user.type(trigger, '3');
    await user.click(screen.getByRole('checkbox', { name: 'Prefer vertical approach' })); await user.selectOptions(screen.getByRole('combobox', { name: 'Path cable purpose' }), 'Power'); await user.click(screen.getByRole('button', { name: 'Calculate path' }));
    expect(await screen.findByText('The exact standalone path is displayed. Review its route and length.')).toBeVisible();
    const beforeClear = { start: startPreview.mock.calls.length, read: readPreview.mock.calls.length, calculate: pf.calculate.mock.calls.length, clear: pf.clear.mock.calls.length };
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('The exact standalone path is displayed. Review its route and length.')).toBeNull(); expect(screen.queryByRole('region', { name: 'Standalone path result' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Path From location' })).toHaveValue('EQ-001'); expect(screen.getByRole('textbox', { name: 'Path To location' })).toHaveValue('EQ-002');
    expect(screen.getByRole('combobox', { name: 'Path cable type' })).toHaveValue('Control'); expect(trigger).toHaveValue('3'); expect(screen.getByRole('checkbox', { name: 'Prefer vertical approach' })).not.toBeChecked();
    for (const name of ['Routes', 'Path', 'Path lookup']) expect(screen.getByRole('tab', { name })).toBeVisible(); expect(screen.getByRole('button', { name: 'Calculate path' })).toBeEnabled();
    expect(pf.clear.mock.calls.length).toBeGreaterThan(beforeClear.clear); expect(startPreview).toHaveBeenCalledTimes(beforeClear.start); expect(readPreview).toHaveBeenCalledTimes(beforeClear.read); expect(pf.calculate).toHaveBeenCalledTimes(beforeClear.calculate);
    expect(pf.action).not.toHaveBeenCalled(); expect(pf.reviewProposal).not.toHaveBeenCalled(); expect(pf.saveLocation).not.toHaveBeenCalled(); expect(pf.matchAll).not.toHaveBeenCalled();
  });
  it('shared Clear prevents a late standalone display acknowledgement from restoring its notice or result', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: string) => void;
    const showPath = vi.fn(() => new Promise<string>(resolve => { finish = resolve; })), startPreview = vi.fn(async () => id), readPreview = vi.fn(async () => preview(id));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startPreview, readPreview, showPath }); mount();
    await user.type(screen.getByRole('textbox', { name: 'Path From location' }), 'EQ-001'); await user.type(screen.getByRole('textbox', { name: 'Path To location' }), 'EQ-002'); await user.selectOptions(screen.getByRole('combobox', { name: 'Path cable purpose' }), 'Power'); await user.click(screen.getByRole('button', { name: 'Calculate path' }));
    await waitFor(() => expect(showPath).toHaveBeenCalledOnce()); await user.click(screen.getByRole('button', { name: 'Clear' })); await act(async () => finish('displayed'));
    expect(screen.queryByText('The exact standalone path is displayed. Review its route and length.')).toBeNull(); expect(screen.queryByRole('region', { name: 'Standalone path result' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Path From location' })).toHaveValue('EQ-001'); expect(screen.getByRole('textbox', { name: 'Path To location' })).toHaveValue('EQ-002');
    expect(startPreview).toHaveBeenCalledOnce(); expect(readPreview).toHaveBeenCalledOnce(); expect(pf.action).not.toHaveBeenCalled(); expect(pf.reviewProposal).not.toHaveBeenCalled();
  });
  it('shared Clear removes a completed lookup notice while preserving its route draft without cancellation requests', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const startLookup = vi.fn(async () => id), readLookup = vi.fn(async () => lookup(id));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, startLookup, readLookup, showPath: vi.fn(async () => 'displayed') }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1/BC2'); await user.click(screen.getByRole('button', { name: 'Show route' }));
    expect(await screen.findByText('The exact ordered lookup is displayed.')).toBeVisible(); await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('The exact ordered lookup is displayed.')).toBeNull(); expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull(); expect(screen.getByRole('textbox', { name: 'Path Finder ordered route' })).toHaveValue('/BC1/BC2');
    expect(startLookup).toHaveBeenCalledOnce(); expect(readLookup).toHaveBeenCalledOnce(); expect(pf.action).not.toHaveBeenCalled();
  });
  it('uses one selected equipment object as an endpoint and rejects partial or non-finite manual coordinates', async () => {
    const user = userEvent.setup(); vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] } }); mount();
    await user.click(screen.getByRole('button', { name: 'Use selection as From' })); expect(await screen.findByRole('textbox', { name: 'Path From location' })).toHaveValue('Tray group A');
    await user.type(screen.getByRole('textbox', { name: 'Path To location' }), 'EQ-002'); await user.click(screen.getByText('To coordinates (metres)')); await user.type(screen.getByRole('textbox', { name: 'Path To X in metres' }), 'Infinity');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Path cable purpose' }), 'Power'); expect(screen.getByRole('button', { name: 'Calculate path' })).toBeDisabled(); await user.clear(screen.getByRole('textbox', { name: 'Path To X in metres' })); expect(screen.getByRole('button', { name: 'Calculate path' })).toBeEnabled();
  });
  it('discards a hidden standalone preview response and keeps its endpoint draft', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: PathFinderPreview) => void;
    const readPreview = vi.fn(() => new Promise<PathFinderPreview>(resolve => { finish = resolve; }));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, artifacts: [artifact()] }, startPreview: vi.fn(async () => id), readPreview }); mount();
    await user.type(screen.getByRole('textbox', { name: 'Path From location' }), 'EQ-001'); await user.type(screen.getByRole('textbox', { name: 'Path To location' }), 'EQ-002'); await user.selectOptions(screen.getByRole('combobox', { name: 'Path cable purpose' }), 'Power'); await user.click(screen.getByRole('button', { name: 'Calculate path' })); await waitFor(() => expect(readPreview).toHaveBeenCalled());
    await user.click(screen.getByRole('tab', { name: 'Routes' })); await act(async () => finish(preview(id))); expect(pf.showPath).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: 'Path' })); expect(screen.getByRole('textbox', { name: 'Path From location' })).toHaveValue('EQ-001'); expect(screen.queryByRole('region', { name: 'Standalone path result' })).toBeNull();
  });
  it('forwards changed Path preferences and blocks both calculation tools for invalid trigger values', async () => {
    const user = userEvent.setup(); vi.mocked(usePathFinder).mockReturnValue({ ...proposalModel(), data: { ...pf.data, artifacts: [artifact()] } }); mount();
    const trigger = screen.getByRole('textbox', { name: 'SECONDARY trigger distance in metres' });
    await user.clear(trigger); await user.type(trigger, '3');
    expect(workspaceCapture.render.mock.calls.at(-1)?.[0].readPreferences).toMatchObject({ secondaryDistanceMeters: 3 });
    expect(resultCapture.render.mock.calls.at(-1)?.[0].options).toMatchObject({ secondaryDistanceMeters: 3 });
    await user.clear(trigger); await user.type(trigger, '-1');
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Calculate path' })).toBeDisabled();
    const popup = workspaceCapture.render.mock.calls.at(-1)?.[0] as PathFinderCableWorkspaceProps;
    expect(popup.getCalculationPreferences?.(false)).toBeNull();
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled(); expect(pf.calculate).not.toHaveBeenCalled();
  });
  it('applies draft transparency explicitly and restores the shared view without changing native ghost defaults on load', async () => {
    const user = userEvent.setup(); mount();
    expect(screen.getByRole('textbox', { name: 'Background transparency to apply percent' })).toHaveValue('75');
    expect(pf.setPathTransparency).not.toHaveBeenCalled();
    await act(async () => resultCapture.render.mock.lastCall![0].claimViewer());
    await user.click(screen.getByRole('button', { name: 'Apply transparency' })); expect(pf.setPathTransparency).toHaveBeenCalledWith(75);
    await user.click(screen.getByRole('button', { name: 'Opaque background' })); expect(pf.setPathTransparency).toHaveBeenLastCalledWith(0);
    await user.click(screen.getByRole('button', { name: 'Restore view' })); expect(pf.cancelOperation).toHaveBeenCalled();
    expect(pf.action).not.toHaveBeenCalled(); expect(pf.reviewProposal).not.toHaveBeenCalled();
  });
  it('retains standalone endpoint drafts across project-owned network checks without starting a preview', async () => {
    const user = userEvent.setup(); mount(); await user.type(screen.getByRole('textbox', { name: 'Path From location' }), 'Standalone source');
    await user.type(screen.getByRole('textbox', { name: 'Path To location' }), 'Standalone destination');
    await user.click(screen.getByRole('tab', { name: 'Routes' }));
    await act(async () => trayPreparationCapture.render.mock.lastCall![0].onNetworkReady('network-draft-test'));
    await user.click(screen.getByRole('tab', { name: 'Path' }));
    expect(screen.getByRole('textbox', { name: 'Path From location' })).toHaveValue('Standalone source');
    expect(screen.getByRole('textbox', { name: 'Path To location' })).toHaveValue('Standalone destination');
    expect(pf.startPreview).not.toHaveBeenCalled(); expect(pf.prepareModel).not.toHaveBeenCalled();
  });
  it('blocks bulk, popup and standalone calculation until the obstacle draft is saved', async () => {
    const current = { ...proposalModel(), data: { ...pf.data, artifacts: [artifact()] } };
    barrierComposition.mode = 'dirty'; vi.mocked(usePathFinder).mockReturnValue(current); const view = mount();
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Calculate path' })).toBeDisabled();
    expect(workspaceCapture.render.mock.lastCall![0].preferences).toBeNull();
    expect(resultCapture.render.mock.lastCall![0].calculationBlocker).toBe('Save the obstacle selection in Barriers before calculating.');
    barrierComposition.mode = 'ready';
    await act(async () => view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />));
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeEnabled();
    expect(workspaceCapture.render.mock.lastCall![0].preferences).not.toBeNull();
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled(); expect(pf.actionWithoutRefresh).not.toHaveBeenCalled();
  });
  it('reserves shared preparation inputs while checking the network without marking the popup controller busy', async () => {
    const current = { ...proposalModel(), data: { ...pf.data, artifacts: [artifact()] } }; vi.mocked(usePathFinder).mockReturnValue(current); mount();
    await act(async () => trayPreparationCapture.render.mock.lastCall![0].onBusyChange(true));
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeDisabled();
    expect(modelMatchCapture.render.mock.lastCall![0].pf.busy).toBe(true);
    expect(workspaceCapture.render.mock.lastCall![0].pf.busy).toBe(false);
    await act(async () => trayPreparationCapture.render.mock.lastCall![0].onBusyChange(false));
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeEnabled();
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
  });
  it('cancels point picking and ignores a picked point delivered after switching tools', async () => {
    const user = userEvent.setup(); let finish!: (point: { objectId: number; point: [number, number, number]; derivation: 'picked-surface-point' }) => void;
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, pickPoint: vi.fn(() => new Promise<{ objectId: number; point: [number, number, number]; derivation: 'picked-surface-point' }>(resolve => { finish = resolve; })) }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('button', { name: 'Resolve To' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Pick surface point in 3D' })).toBeEnabled()); await user.click(screen.getByRole('button', { name: 'Pick surface point in 3D' })); await user.click(screen.getByRole('tab', { name: 'Routes' }));
    await act(async () => finish({ objectId: 44, point: [9, 8, 7], derivation: 'picked-surface-point' })); await user.click(screen.getByRole('tab', { name: 'Path' })); expect(screen.getByRole('textbox', { name: 'Endpoint X in metres' })).toHaveValue(''); expect(pf.cancelPicking).toHaveBeenCalled(); expect(pf.saveLocation).not.toHaveBeenCalled();
  });
  it('refreshes obstacle evidence after project preparation without losing the selected cable or starting a calculation', async () => {
    const user = userEvent.setup(); mount(); await user.click(screen.getByRole('button', { name: /=CABLE-1/ }));
    await user.click(screen.getByRole('tab', { name: 'Routes' }));
    await act(async () => trayPreparationCapture.render.mock.lastCall![0].onNetworkReady('new-preparation-proof'));
    expect(barrierComposition.render.mock.lastCall![0].refreshKey).toBe('new-preparation-proof');
    await user.click(screen.getByRole('tab', { name: 'Path' }));
    expect(workspaceCapture.render.mock.lastCall![0].selectedCableId).toBe(pf.data.cables[0].id);
    expect(screen.getByText('Selected: =CABLE-1')).toBeVisible(); expect(pf.calculate).not.toHaveBeenCalled();
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
  });
  it('runs independent Path lookup without a planning snapshot while an obstacle draft blocks cable calculations', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', startLookup = vi.fn(async () => id);
    barrierComposition.mode = 'dirty'; vi.mocked(usePathFinder).mockReturnValue({ ...pf, startLookup, readLookup: vi.fn(async () => lookup(id)), showPath: vi.fn(async () => 'displayed') }); mount();
    expect(screen.getByRole('button', { name: 'Calculate path' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1/BC2');
    expect(screen.getByRole('button', { name: 'Show route' })).toBeEnabled(); await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('Lookup complete — forward preview');
    expect(startLookup).toHaveBeenCalledWith('/BC1/BC2', false); expect(pf.prepareModel).not.toHaveBeenCalled(); expect(pf.uploadSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Apply reviewed result' })).toBeNull();
  });
  it('requires the active ready Viewer for independent lookup', async () => {
    const user = userEvent.setup(); vi.mocked(usePathFinder).mockReturnValue({ ...pf, viewerPhase: 'loading' }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1');
    expect(screen.getByRole('button', { name: 'Show route' })).toBeDisabled(); expect(pf.startLookup).not.toHaveBeenCalled();
  });
  it('clears a displayed lookup on route, reverse and copied-routing edits while preserving drafts', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, cables: [{ ...pf.data.cables[0], routing: '/COPIED' }] }, startLookup: vi.fn(async () => id), readLookup: vi.fn(async () => lookup(id)), showPath: vi.fn(async () => 'displayed') }); mount();
    await user.click(screen.getByRole('button', { name: /=CABLE-1/ })); await user.click(screen.getByRole('tab', { name: 'Path lookup' }));
    const input = screen.getByRole('textbox', { name: 'Path Finder ordered route' }); await user.type(input, '/BC1/BC2'); await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('The exact ordered lookup is displayed.');
    await user.type(input, '/BC3'); expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('The exact ordered lookup is displayed.'); await user.click(screen.getByRole('checkbox', { name: 'Reverse route order' }));
    expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('The exact ordered lookup is displayed.'); await user.click(screen.getByRole('button', { name: 'Use cable routing for lookup' }));
    expect(input).toHaveValue('/COPIED'); expect(screen.getByRole('checkbox', { name: 'Reverse route order' })).toBeChecked(); expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull();
  });
  it('cancels a pending model capture and cancels any late accepted lookup without displaying it', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: string) => void;
    const startLookup = vi.fn(() => new Promise<string>(resolve => { finish = resolve; })); vi.mocked(usePathFinder).mockReturnValue({ ...pf, startLookup }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1'); await user.click(screen.getByRole('button', { name: 'Show route' }));
    expect(screen.getByRole('textbox', { name: 'Path Finder ordered route' })).toBeDisabled(); expect(screen.getByRole('checkbox', { name: 'Reverse route order' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel lookup' })); expect(pf.cancelOperation).toHaveBeenCalled(); await act(async () => finish(id));
    expect(pf.action).toHaveBeenCalledWith(`/jobs/${id}`, undefined, 'DELETE'); expect(pf.readLookup).not.toHaveBeenCalled(); expect(pf.showPath).not.toHaveBeenCalled();
  });
  it('cancels the queued job and ignores its late completed response', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: PathFinderLookup) => void;
    const readLookup = vi.fn(() => new Promise<PathFinderLookup>(resolve => { finish = resolve; }));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, startLookup: vi.fn(async () => id), readLookup }); mount(); await user.click(screen.getByRole('tab', { name: 'Path lookup' }));
    await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1'); await user.click(screen.getByRole('button', { name: 'Show route' })); await waitFor(() => expect(readLookup).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Cancel lookup' })); await act(async () => finish(lookup(id)));
    expect(pf.action).toHaveBeenCalledWith(`/jobs/${id}`, undefined, 'DELETE'); expect(pf.showPath).not.toHaveBeenCalled(); expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull();
  });
  it.each(['tab switch', 'shared Clear', 'project dependency change'])('cancels an acknowledged pending lookup when detached by %s', async detach => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: PathFinderLookup) => void;
    const readLookup = vi.fn(() => new Promise<PathFinderLookup>(resolve => { finish = resolve; }));
    const current = { ...pf, startLookup: vi.fn(async () => id), readLookup }; vi.mocked(usePathFinder).mockReturnValue(current); const view = mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1');
    await user.click(screen.getByRole('button', { name: 'Show route' })); await waitFor(() => expect(readLookup).toHaveBeenCalled());
    if (detach === 'tab switch') await user.click(screen.getByRole('tab', { name: 'Routes' }));
    else if (detach === 'shared Clear') await user.click(screen.getByRole('button', { name: 'Clear' }));
    else {
      vi.mocked(usePathFinder).mockReturnValue({ ...current, data: { ...current.data, settings: { ...current.data.settings, revision: '3' } } });
      view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />);
    }
    expect(pf.action).toHaveBeenCalledTimes(1); expect(pf.action).toHaveBeenCalledWith(`/jobs/${id}`, undefined, 'DELETE');
    await act(async () => finish(lookup(id))); expect(pf.showPath).not.toHaveBeenCalled(); expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull();
  });
  it('shows actual nullable diagnostics and fallback warnings without inventing zero counts', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', detail = lookup(id);
    detail.result!.diagnostics = { geometryLeavesUsed: 12, fallbackBends: 2, fallbackStraights: null, fallbackClearances: 3 };
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, startLookup: vi.fn(async () => id), readLookup: vi.fn(async () => detail), showPath: vi.fn(async () => 'displayed') }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1'); await user.click(screen.getByRole('button', { name: 'Show route' }));
    expect(await screen.findByText('Geometry leaves used: 12')).toBeVisible(); expect(screen.getByText('Prepared geometry fallbacks — bends: 2; straights: Unavailable; clearances: 3')).toBeVisible(); expect(screen.getByText('Connection gap used: 1 m')).toBeVisible();
    expect(screen.getByText('Some prepared geometry diagnostics are unavailable. Missing counts are not assumed to be zero.')).toBeVisible(); expect(screen.getByText('Fallback geometry exists in the prepared lookup network and may be outside the returned route. Review the relevant geometry against the model.')).toBeVisible();
  });
  it('fences a late model capture on a tab switch without losing the ordered-route draft', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; let finish!: (value: string) => void;
    const startLookup = vi.fn(() => new Promise<string>(resolve => { finish = resolve; })); vi.mocked(usePathFinder).mockReturnValue({ ...pf, startLookup }); mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/DRAFT'); await user.click(screen.getByRole('button', { name: 'Show route' }));
    await user.click(screen.getByRole('tab', { name: 'Path' })); await act(async () => finish(id)); expect(pf.action).toHaveBeenCalledWith(`/jobs/${id}`, undefined, 'DELETE'); expect(pf.readLookup).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); expect(screen.getByRole('textbox', { name: 'Path Finder ordered route' })).toHaveValue('/DRAFT'); expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull();
  });
  it('keeps the real background pass drilling off while the independent manual choice is enabled', async () => {
    const user = userEvent.setup(), data = { ...pf.data, artifacts: [artifact()] }, current = { ...proposalModel(), data, refreshState: vi.fn(async () => data) };
    vi.mocked(usePathFinder).mockReturnValue(current); mount();
    const checkbox = screen.getByRole('checkbox', { name: 'Drill through the walls' }); expect(checkbox).not.toBeChecked();
    await user.click(checkbox); expect(checkbox).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Recalculate all the cables' }));
    await waitFor(() => expect(submitAllPathFinderCalculations).toHaveBeenCalledOnce());
    const submitted = vi.mocked(submitAllPathFinderCalculations).mock.calls[0][2];
    expect(submitted).toMatchObject({ options: { barrierRouting: { drillThroughWalls: false, expectedRegistryRevision: '1', expectedSnapshot: { mode: 'explicit-empty' } } } });
    expect((workspaceCapture.render.mock.calls.at(-1)?.[0] as PathFinderCableWorkspaceProps).getCalculationPreferences?.(true)?.barrierRouting?.drillThroughWalls).toBe(true);
    expect(pf.calculate).not.toHaveBeenCalled();
  });
  it('keeps popup calculations and shared-location Save independent of the global manual drilling choice', async () => {
    const user = userEvent.setup(); mount();
    await waitFor(() => expect(workspaceCapture.render.mock.calls.at(-1)?.[0].preferences?.barrierRouting?.drillThroughWalls).toBe(false));
    await user.click(screen.getByRole('checkbox', { name: 'Drill through the walls' }));
    const popup = workspaceCapture.render.mock.calls.at(-1)?.[0] as PathFinderCableWorkspaceProps;
    expect(popup.preferences?.barrierRouting?.drillThroughWalls).toBe(false); expect(popup.readPreferences?.barrierRouting?.drillThroughWalls).toBe(false);
    expect(popup.getCalculationPreferences?.(false)?.barrierRouting?.drillThroughWalls).toBe(false);
    expect(popup.getCalculationPreferences?.(true)?.barrierRouting?.drillThroughWalls).toBe(true);
    expect(pf.calculate).not.toHaveBeenCalled();
  });
  it('invalidates popup calculation metadata while preserving the selected cable after an endpoint Save or Calculate begins', async () => {
    const current = proposalModel(); vi.mocked(usePathFinder).mockReturnValue(current); mount();
    const popup = () => workspaceCapture.render.mock.calls.at(-1)?.[0] as PathFinderCableWorkspaceProps;
    let row!: Awaited<ReturnType<typeof fetchPathFinderCableWorkflowDetail>>['row'];
    await act(async () => { row = (await fetchPathFinderCableWorkflowDetail(projectId, 'isolated-test-token', pf.data.cables[0].id,
      { secondaryDistanceMeters: 2, preferVerticalApproach: true })).row; });
    await act(async () => popup().onSelect(row));
    expect(popup().selectedCableId).toBe(row.cable.id);
    await act(async () => popup().onCalculationStart?.(row.cable.id));
    expect(popup().selectedCableId).toBe(row.cable.id);
    expect(popup().display).toMatchObject({ ready: false, visible: false, routing: null, designLength: null });
    expect(popup().review).toBeNull();
    expect(autoReadCapture.read.mock.calls.at(-1)?.[0]).toMatchObject({ selectedCableId: row.cable.id, item: null });
    expect(current.submitCalculation).not.toHaveBeenCalled(); expect(current.action).not.toHaveBeenCalled();
  });
  it('forwards changing headless display diagnostics while the exact result and readiness remain unchanged', async () => {
    const current = proposalModel(); vi.mocked(usePathFinder).mockReturnValue(current); mount();
    const popup = () => workspaceCapture.render.mock.calls.at(-1)?.[0] as PathFinderCableWorkspaceProps;
    const result = () => resultCapture.render.mock.calls.at(-1)?.[0] as Parameters<typeof PathFinderResults>[0];
    const display: PathFinderWorkflowDisplay = { cableId: pf.data.cables[0].id, jobId: bulkJobId,
      proposalId: '66666666-6666-4666-8666-666666666666', proposalHash: 'f'.repeat(64),
      ready: false, visible: false, routing: null, designLength: null, checking: true, message: 'Checking the exact result.' };
    await act(async () => result().onWorkflowDisplayChange?.(display)); expect(popup().display).toEqual(display);
    const stopped = { ...display, checking: false, message: 'The route check was temporarily unavailable.' };
    await act(async () => result().onWorkflowDisplayChange?.(stopped)); expect(popup().display).toEqual(stopped);
    expect(current.submitCalculation).not.toHaveBeenCalled(); expect(current.action).not.toHaveBeenCalled();
  });
  it.each(['missing', 'dirty', 'pending'] as const)('keeps an unavailable %s barrier configuration blocked for either popup drilling choice', async mode => {
    barrierComposition.mode = mode; mount();
    await waitFor(() => expect(workspaceCapture.render).toHaveBeenCalled());
    const popup = workspaceCapture.render.mock.calls.at(-1)?.[0] as PathFinderCableWorkspaceProps;
    expect(popup.getCalculationPreferences?.(true)).toBeNull(); expect(popup.getCalculationPreferences?.(false)).toBeNull(); expect(popup.preferences).toBeNull();
    expect(pf.calculate).not.toHaveBeenCalled();
  });
  it('starts a changed model selection with drilling off instead of inheriting the previous choice', async () => {
    const user = userEvent.setup(), view = mount();
    await user.click(screen.getByRole('checkbox', { name: 'Drill through the walls' }));
    expect(screen.getByRole('checkbox', { name: 'Drill through the walls' })).toBeChecked();
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, data: { ...pf.data, activeModel: { ...pf.data.activeModel, selectionRevision: '3' } } });
    await act(async () => view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />));
    expect(screen.getByRole('checkbox', { name: 'Drill through the walls' })).not.toBeChecked();
    vi.mocked(usePathFinder).mockReturnValue(pf);
    await act(async () => view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />));
    expect(screen.getByRole('checkbox', { name: 'Drill through the walls' })).not.toBeChecked();
  });
  it('resets drilling after a same-model Viewer reload without reviving a previous enabled choice', async () => {
    const user = userEvent.setup(), view = mount();
    await user.click(screen.getByRole('checkbox', { name: 'Drill through the walls' }));
    vi.mocked(usePathFinder).mockReturnValue({ ...pf, preparationViewerGeneration: 2 });
    await act(async () => view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />));
    expect(screen.getByRole('checkbox', { name: 'Drill through the walls' })).not.toBeChecked();
  });
  it('clears completed lookup display on a project revision change even when the gap value returns unchanged', async () => {
    const user = userEvent.setup(), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const current = { ...pf, startLookup: vi.fn(async () => id), readLookup: vi.fn(async () => lookup(id)), showPath: vi.fn(async () => 'displayed') }; vi.mocked(usePathFinder).mockReturnValue(current); const view = mount();
    await user.click(screen.getByRole('tab', { name: 'Path lookup' })); await user.type(screen.getByRole('textbox', { name: 'Path Finder ordered route' }), '/BC1'); await user.click(screen.getByRole('button', { name: 'Show route' })); await screen.findByText('The exact ordered lookup is displayed.');
    const cleared = pf.clear.mock.calls.length; vi.mocked(usePathFinder).mockReturnValue({ ...current, data: { ...current.data, settings: { ...current.data.settings, revision: '3' } } }); view.rerender(<PathFinderTab projectId={projectId} loadedProjectId={projectId} token="isolated-test-token" accountId={accountId} isAdmin />);
    expect(screen.queryByRole('region', { name: 'Ordered lookup result' })).toBeNull(); expect(pf.clear.mock.calls.length).toBeGreaterThan(cleared); expect(screen.getByRole('textbox', { name: 'Path Finder ordered route' })).toHaveValue('/BC1'); expect(pf.action).not.toHaveBeenCalled();
  });
});
