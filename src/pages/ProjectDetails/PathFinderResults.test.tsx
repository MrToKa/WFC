import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderResults } from './PathFinderResults';
import type { usePathFinder } from './hooks/usePathFinder';
import { proposalEndpointObjectIds } from './pathFinderEndpointVisibility';
import type { PathFinderJob, PathFinderProposal } from '@/api/pathfinder';
import { fetchPathFinderCableWorkflowDetail } from '@/api/pathfinderCableWorkflow';
import { cableWorkflowDetailSchema } from '../../../shared/pathfinderCableWorkflowQueries';
import { revisionResultEnvelopeSchema } from '../../../shared/pathfinderRevisionResults';
vi.mock('@/api/pathfinderCableWorkflow', () => ({ fetchPathFinderCableWorkflowDetail: vi.fn() }));
const mockScope = vi.hoisted(() => ({ initial: null as import('./PathFinderRevisionResults').PathFinderCalculationScope | null }));
vi.mock('./pathFinderEndpointVisibility', async original => ({ ...await original<typeof import('./pathFinderEndpointVisibility')>(), proposalEndpointObjectIds: vi.fn(async () => [] as string[]) }));
vi.mock('./PathFinderRecalculationPanel', () => ({ PathFinderRecalculationPanel: () => <div>Server recalculation status</div> }));
vi.mock('./PathFinderRevisionResults', async () => {
  const { useEffect, useState } = await import('react');
  type Scope = import('./PathFinderRevisionResults').PathFinderCalculationScope;
  return { PathFinderRevisionResults: ({ onOpenProposal, onScopeReadinessChange, onHistorySelection, batch }: {
    onOpenProposal: (id: string, jobId: string) => void;
    onScopeReadinessChange?: (scope: Scope) => void;
    onHistorySelection?: () => void;
    batch?: import('./PathFinderBatchReview').BatchReviewController;
  }) => {
    const [scope, setScope] = useState<Scope>(mockScope.initial ?? { admissionId: id(70), jobId: id(7), ready: true, message: null });
    useEffect(() => { onScopeReadinessChange?.(scope); }, [scope, onScopeReadinessChange]);
    return <section aria-label="Mock revision results">
      <button onClick={() => { onHistorySelection?.(); if (scope.jobId) onOpenProposal(id(3), scope.jobId); }}>Open exact proposal in Viewer</button>
      <button onClick={() => { onHistorySelection?.(); setScope({ admissionId: id(71), jobId: id(17), ready: true, message: null }); }}>Select another completed calculation</button>
      <button onClick={() => batch?.select({ cableId: id(4), proposalId: id(3), proposalHash: 'a'.repeat(64), revisionResultHash: 'b'.repeat(64), cableWriteRevision: '9', tag: 'Fixture cable', routeText: '/BC1', designLength: '7' }, true)}>Select fixture for batch</button>
    </section>;
  } };
});
beforeEach(() => { sessionStorage.clear(); mockScope.initial = null; vi.mocked(proposalEndpointObjectIds).mockReset().mockResolvedValue([]);
  vi.mocked(fetchPathFinderCableWorkflowDetail).mockReset().mockResolvedValue(liveCableDetail()); });
afterEach(() => { sessionStorage.clear(); });
describe('calculation production boundary', () => {
  it('does not create jobs from ready data or dependency changes; manual actions remain explicit', () => {
    const calculate = vi.fn(), options = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
    const pf = { data: { registryRevision: '1', activeModel: { modelVersionId: 'model', selectionRevision: '1' }, settings: {}, artifacts: [{ id: 'artifact' }], cables: [{ id: 'cable', cableWriteRevision: '1', mto: 'Control', fromMatch: { status: 'matched' }, toMatch: { status: 'matched' } },
      { id: 'low-voltage', mto: 'LV' }, { id: 'instrument', mto: 'Instrumentation' }, { id: 'medium-voltage', mto: 'MV' }, { id: 'unknown', mto: null }], jobs: [], proposals: [] }, busy: false, calculate, preparationAccess: { projectId: null, loadedProjectId: null, token: null, isAdmin: false } } as unknown as ReturnType<typeof usePathFinder>;
    const view = render(<PathFinderResults pf={pf} selectedCableId="cable" options={options} />);
    expect(calculate).not.toHaveBeenCalled(); expect(screen.getByText('Server recalculation status')).toBeVisible();
    view.rerender(<PathFinderResults pf={{ ...pf, data: { ...pf.data!, registryRevision: '2' } }} selectedCableId="cable" options={options} />);
    expect(calculate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate non-MV cables' })); expect(calculate).toHaveBeenLastCalledWith(['cable', 'low-voltage', 'instrument'], true, options);
    fireEvent.click(screen.getByRole('button', { name: 'Calculate selected cable' })); expect(calculate).toHaveBeenLastCalledWith(['cable'], true, options);
    view.rerender(<PathFinderResults pf={pf} selectedCableId="medium-voltage" options={options} />);
    expect(screen.getByRole('button', { name: 'Calculate selected cable' })).toBeDisabled(); expect(calculate).toHaveBeenCalledTimes(2);
  });
  it('shows empty batch Review and Apply controls before the paged selection area', () => {
    const f = recoveryFixture(); render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={null} accountId={id(2)} options={options} />);
    const toolbar = screen.getByRole('region', { name: 'Batch review and Apply' }), revision = screen.getByRole('region', { name: 'Mock revision results' });
    expect(toolbar).toBeVisible(); expect(toolbar.compareDocumentPosition(revision) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm review for selected cables' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply reviewed selection' })).toBeDisabled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
});

const id = (value: number) => `50000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const options = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
function liveCableDetail() {
  const available = { status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false };
  return cableWorkflowDetailSchema.parse({ schemaVersion: 'wfc.pf.cable-workflow-detail.v1', projectId: id(1), cableId: id(4), querySha256: 'e'.repeat(64), contextSha256: 'f'.repeat(64),
    row: { projectId: id(1), mto: 'Control', cable: { id: id(4), tag: 'Live cable', fromLocation: 'Live From', toLocation: 'Live To', routing: '/LIVE-CURRENT', designLength: '12.00000000000000000001', installLength: '123.2500', cableWriteRevision: '9' },
      from: available, to: available, calculation: { jobId: null, jobStatus: null, itemState: null, outcome: 'not-evaluated', reasonCodes: [], errorCode: null, currentness: 'not-evaluated', proposalId: null, proposalHash: null, reviewable: false, acceptedMatchesCurrent: false } } });
}
function recoveryFixture() {
  const proposal = { id: id(3), projectId: id(1), jobId: id(7), cableId: id(4), status: 'calculated', proposalHash: 'a'.repeat(64),
    revisionResultHash: 'b'.repeat(64), cableWriteRevision: '9', stale: false, synthetic: true, canApply: true,
    engineeringAccepted: true, acceptanceScope: 'local-synthetic-fixture', compatibilityIssue: null as string | null, message: 'Calculated fixture.',
    itemApplicability: null as PathFinderProposal['itemApplicability'],
    engineeringMessage: 'Controlled local fixture.', routingPreferences: options, createdAt: '2026-10-19T14:00:00Z',
    design: { lengthBeforePercentageMeters: '6', unroundedLengthMeters: '6.6', designLengthMeters: '7' },
    route: { success: true, points: [[1, 2, 3]], objectIds: ['dbid:23'], lengthMeters: 1, fromDistanceMeters: 0, toDistanceMeters: 0,
      fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0, routeText: '/BC1' } };
  const action = vi.fn(async (): Promise<Record<string, unknown> | null> => null);
  const pf = { data: { projectId: id(1), registryRevision: '1', activeModel: { modelVersionId: id(8), selectionRevision: '1' }, settings: {},
    artifacts: [{ id: id(9) }], cables: [{ id: id(4), tag: 'Fixture cable', mto: 'Control', cableWriteRevision: '9' }], jobs: [], proposals: [proposal] },
    preparationAccess: { projectId: id(1), loadedProjectId: id(1), token: 'current-private-token', isAdmin: true },
    busy: false, calculate: vi.fn(), clear: vi.fn(), action, cancelOperation: vi.fn(), refresh: vi.fn(),
    readProposal: vi.fn(async () => proposal), showPath: vi.fn(async () => true), reviewProposal: vi.fn(async () => ({ reviewId: id(5), proposal })) };
  const receipt = { duplicate: true, receipt: { id: id(6), projectId: id(1), proposalId: id(3), cableId: id(4), appliedAt: '2026-10-19T14:00:00Z',
    before: { id: id(4), project_id: id(1), cable_write_revision: '9', install_length: '123' },
    after: { id: id(4), project_id: id(1), cable_write_revision: '10', install_length: '123' },
    provenance: { schemaVersion: 'pathfinder.apply.v2', proposalId: id(3), proposalHash: 'a'.repeat(64), reviewId: id(5),
      review: { id: id(5), actorId: id(2) },
      revisionResult: { revisionResultSha256: 'b'.repeat(64) } } } };
  return { pf, receipt };
}
type Fixture = ReturnType<typeof recoveryFixture>;
const asPf = (pf: object) => pf as ReturnType<typeof usePathFinder>;
function sealedFixture() {
  const f = recoveryFixture(), base = f.pf.data.proposals[0];
  const proposal = { ...base, itemApplicability: { schemaVersion: 'wfc.pf.sealed-cable-applicability.v1' as const,
    dependencyVersion: 'pathfinder.dependencies.v7' as const, projectId: base.projectId, jobId: base.jobId, cableId: base.cableId,
    proposalId: base.id, dependencyHash: 'c'.repeat(64), scope: 'sealed-cable-item' as const },
    provenance: { dependencyVersion: 'pathfinder.dependencies.v7' as const, dependencyHash: 'c'.repeat(64), engineIdentity: null, automatic: null } };
  f.pf.readProposal.mockResolvedValue(proposal);
  mockScope.initial = { admissionId: id(70), jobId: id(7), ready: false, message: 'Other cables are calculating.', wholeJobReady: false, jobStatus: 'running', cancelRequested: false };
  return { f, proposal };
}
function workflowFixture(status: 'complete' | 'running' = 'complete') {
  const f = recoveryFixture(), base = f.pf.data.proposals[0], dependencyHash = 'c'.repeat(64), baselineHash = 'd'.repeat(64);
  const itemApplicability = { schemaVersion: 'wfc.pf.sealed-cable-applicability.v1' as const, dependencyVersion: 'pathfinder.dependencies.v7' as const,
    projectId: id(1), jobId: id(7), cableId: id(4), proposalId: id(3), dependencyHash, scope: 'sealed-cable-item' as const };
  const envelope = revisionResultEnvelopeSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-result.v1', id: id(80), projectId: id(1), admissionId: id(81),
    jobId: id(7), cableId: id(4), proposalId: id(3), proposalHash: base.proposalHash, baselineHash, dependencyHash,
    engineResultSha256: 'e'.repeat(64), ledgerHash: null, oldModel: null,
    summary: { calculationMode: 'calculate', newModel: null, routeText: '/BC1', rawLengthMeters: 1, designLengthMeters: '7', unroundedMeters: '6.6',
      delta: { rawLengthMeters: null, designLengthMeters: null, unroundedMeters: null, baseline: 'current-values' }, reasonCodes: [] },
    comparisonRef: null, observedEvents: [], lengthLedger: null, physicalChangeProven: false, createdAt: base.createdAt, revisionResultSha256: base.revisionResultHash });
  const proposal = { ...base, revisionResult: envelope, revisionBaselineHash: baselineHash, itemApplicability: status === 'running' ? itemApplicability : null,
    provenance: { dependencyVersion: status === 'running' ? 'pathfinder.dependencies.v7' : 'pathfinder.dependencies.v6', dependencyHash, engineIdentity: null, automatic: null } } as unknown as PathFinderProposal;
  const live = liveCableDetail(); live.row.calculation = { ...live.row.calculation, jobId: id(7), jobStatus: status, itemState: 'complete', outcome: 'calculated',
    currentness: 'current', proposalId: id(3), proposalHash: base.proposalHash, reviewable: true, itemApplicability: status === 'running' ? itemApplicability : null };
  const parent = { id: id(7), projectId: id(1), status, total: 200, completed: status === 'complete' ? 200 : 1, cancelRequested: false, failure: null, attempts: 1, createdAt: base.createdAt, updatedAt: base.createdAt };
  const pf = { ...f.pf, data: { ...f.pf.data, proposals: [] }, readProposal: vi.fn(async (): Promise<PathFinderProposal | null> => proposal), readJob: vi.fn(async (): Promise<PathFinderJob | null> => parent) };
  vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(live);
  return { pf, proposal, live, parent, selection: live.row };
}
describe('selected current cable workflow result', () => {
  it.each(['complete', 'running'] as const)('opens the exact selected %s result outside the loaded history and recent proposals', async status => {
    const f = workflowFixture(status);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    expect(f.pf.readProposal).toHaveBeenCalledExactlyOnceWith(id(3)); expect(f.pf.readJob).toHaveBeenCalledExactlyOnceWith(id(7));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledExactlyOnceWith(id(1), 'current-private-token', id(4), options, expect.any(AbortSignal));
    expect(f.pf.showPath).toHaveBeenCalledWith({ pathId: id(3), points: [[1, 2, 3]], objectIds: [23] });
    expect(screen.getByRole('region', { name: 'Current and proposed cable values' })).toHaveTextContent('/LIVE-CURRENT');
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(f.pf.reviewProposal).toHaveBeenCalledWith(f.proposal));
  });
  it('keeps an unsealed legacy result preview only instead of borrowing the ready history admission', async () => {
    const f = workflowFixture(); f.pf.readProposal.mockResolvedValue({ ...f.proposal, revisionResult: null });
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(screen.getByText(/no verifiable calculation admission/)).toBeVisible();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it.each(['project', 'cable', 'job', 'hash', 'envelope'] as const)('refuses a selected result whose %s linkage changed', async field => {
    const f = workflowFixture(), detail = { ...f.proposal };
    if (field === 'project') detail.projectId = id(90); if (field === 'cable') detail.cableId = id(90); if (field === 'job') detail.jobId = id(90);
    if (field === 'hash') detail.proposalHash = 'f'.repeat(64); if (field === 'envelope') detail.revisionResult = { ...detail.revisionResult!, admissionId: id(90), jobId: id(90) };
    f.pf.readProposal.mockResolvedValue(detail);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} />);
    await waitFor(() => expect(screen.getByText(/calculation changed or could not be verified/)).toBeVisible());
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['cancelled', 'unknown', 'stale'] as const)('does not borrow history readiness when the fresh selected proof is %s', async mode => {
    const f = workflowFixture();
    if (mode === 'cancelled') f.pf.readJob.mockResolvedValue({ ...f.parent, status: 'cancelled', cancelRequested: true });
    if (mode === 'unknown') f.pf.readJob.mockResolvedValue(null);
    if (mode === 'stale') { f.live.row.calculation.currentness = 'changed'; f.live.row.calculation.reviewable = false; }
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce()); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it('does not reopen a selected hint when an explicit historical scope supersedes it', async () => {
    const f = workflowFixture(), view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Select another completed calculation' }));
    expect(screen.queryByRole('region', { name: 'Proposal review' })).not.toBeInTheDocument();
    view.rerender(<PathFinderResults pf={asPf({ ...f.pf, data: { ...f.pf.data, jobs: [] } })} selectedCableId={id(4)} workflowSelection={{ ...f.selection }} accountId={id(2)} options={options} />);
    await act(async () => {}); expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.showPath).toHaveBeenCalledOnce();
  });
  it('rechecks the same legacy proposal when bounded cable progress observes its parent complete', async () => {
    const f = workflowFixture(), running = { ...f.parent, status: 'running' as const, completed: 1 };
    const preview = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, jobStatus: 'running' as const, reviewable: false } } };
    f.pf.readJob.mockResolvedValueOnce(running).mockResolvedValue(f.parent);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce(preview).mockResolvedValue(f.live);
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={preview.row} accountId={id(2)} options={options} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce()); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    expect(f.pf.readJob.mock.calls).toEqual([[id(7)], [id(7)]]); expect(f.pf.readProposal.mock.calls).toEqual([[id(3)], [id(3)]]);
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('keeps explicit history selection in control when bounded progress changes the same external result readiness', async () => {
    const f = workflowFixture(), running = { ...f.parent, status: 'running' as const, completed: 1 };
    const preview = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, jobStatus: 'running' as const, reviewable: false } } };
    f.pf.readJob.mockResolvedValue(running); vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(preview);
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={preview.row} accountId={id(2)} options={options} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce()); fireEvent.click(screen.getByRole('button', { name: 'Select another completed calculation' }));
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} />);
    await act(async () => {}); expect(f.pf.readJob).toHaveBeenCalledOnce(); expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.showPath).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: 'Proposal review' })).not.toBeInTheDocument();
  });
  it.each(['selection', 'account', 'model', 'history'] as const)('fences a late selected proposal after %s changes', async change => {
    const f = workflowFixture(); let finish!: (value: PathFinderProposal) => void;
    f.pf.readProposal.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} />);
    if (change === 'history') fireEvent.click(screen.getByRole('button', { name: 'Select another completed calculation' }));
    else if (change === 'selection') view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={null} workflowSelection={null} accountId={id(2)} options={options} />);
    else if (change === 'account') view.rerender(<PathFinderResults pf={asPf({ ...f.pf, preparationAccess: { ...f.pf.preparationAccess, isAdmin: false } })} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(20)} options={options} />);
    else view.rerender(<PathFinderResults pf={asPf({ ...f.pf, data: { ...f.pf.data, activeModel: { ...f.pf.data.activeModel, selectionRevision: '2' } } })} selectedCableId={id(4)} workflowSelection={null} accountId={id(2)} options={options} />);
    await act(async () => { finish(f.proposal); }); expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Proposal review' })).not.toBeInTheDocument();
  });
});
async function submitFirstApply(fixture: Fixture) {
  fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirm proposal review' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed result' }));
  await waitFor(() => expect(fixture.pf.action).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry pending Apply' })).toBeEnabled());
}

describe('exact pending Apply through result display resets', () => {
  it('refreshes bounded cable values after a confirmed individual Apply, never merely after opening or review', async () => {
    const f = recoveryFixture(), changed = vi.fn(); f.pf.action.mockResolvedValue(f.receipt);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} onCableValuesChanged={changed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled()); expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm proposal review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled()); expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed result' }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce()); expect(f.pf.refresh).toHaveBeenCalledOnce();
  });
  it('refreshes bounded cable values after a confirmed batch Apply', async () => {
    const f = recoveryFixture(), changed = vi.fn(); f.pf.action.mockResolvedValue(f.receipt);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} onCableValuesChanged={changed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select fixture for batch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm review for selected cables' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed selection' })).toBeEnabled()); expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed selection' }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce()); expect(f.pf.refresh).toHaveBeenCalledOnce();
  });
  it('refreshes bounded cable values when Close confirms the matching already-applied receipt', async () => {
    const f = recoveryFixture(), changed = vi.fn();
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} onCableValuesChanged={changed} />);
    await submitFirstApply(f); expect(changed).not.toHaveBeenCalled();
    const original = f.pf.action.mock.calls[0] as unknown as [string, { idempotencyKey: string; reviewId: string; expectedCableWriteRevision: string }];
    f.pf.action.mockResolvedValueOnce({ schemaVersion: 'wfc.pf.apply-recovery.v1', projectId: id(1), proposalId: id(3), ...original[1],
      status: 'already-applied', duplicate: true, receipt: f.receipt.receipt });
    fireEvent.click(screen.getByRole('button', { name: 'Close pending request' }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce()); expect(f.pf.refresh).toHaveBeenCalledOnce();
  });
  it('reads live values once on explicit proposal opening instead of using the project state or frozen admission values', async () => {
    const f = recoveryFixture(), pf = { ...f.pf, data: { ...f.pf.data, cables: [{ ...f.pf.data.cables[0], routing: '/OLD-PROJECT-STATE', designLength: '999' }] } };
    const view = render(<PathFinderResults pf={asPf(pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    const current = await screen.findByRole('region', { name: 'Current cable values' });
    expect(current).toHaveTextContent('/LIVE-CURRENT'); expect(current).toHaveTextContent('12.00000000000000000001 m'); expect(current).toHaveTextContent('123.2500 m');
    expect(current).not.toHaveTextContent('/OLD-PROJECT-STATE'); expect(screen.getByText('Design length delta: -5.00000000000000000001 m')).toBeVisible();
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledWith(id(1), 'current-private-token', id(4), options, expect.any(AbortSignal));
    view.rerender(<PathFinderResults pf={asPf({ ...pf, data: { ...pf.data, proposals: [...pf.data.proposals], registryRevision: '2' } })} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('keeps preview and unrelated controls available while the independent live comparison is slow', async () => {
    const f = recoveryFixture(); vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(() => undefined));
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    expect(screen.getByText('Reading live cable values for comparison…')).toBeVisible(); expect(screen.getByRole('button', { name: 'Calculate non-MV cables' })).toBeEnabled();
    expect(f.pf.clear).not.toHaveBeenCalled(); expect(f.pf.cancelOperation).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
    const signal = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!; view.unmount(); expect(signal.aborted).toBe(true);
  });
  it('reports unavailable live comparison without disposing the Viewer, inventing blank values or changing approval gates', async () => {
    const f = recoveryFixture(); vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(Object.assign(new Error('Private old cable names'), { status: 403 }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(await screen.findByText(/Live cable comparison is unavailable/)).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    expect(screen.queryByRole('region', { name: 'Current cable values' })).toBeNull(); expect(screen.queryByText(/Both current fields are empty/)).toBeNull();
    expect(screen.queryByText('Private old cable names')).toBeNull(); expect(f.pf.clear).not.toHaveBeenCalled(); expect(f.pf.cancelOperation).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['account', 'model', 'options', 'cable', 'scope'] as const)('aborts and ignores late live comparison after a %s change', async change => {
    const f = recoveryFixture(); let finish!: (value: ReturnType<typeof liveCableDetail>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' })); await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    const signal = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!;
    if (change === 'scope') fireEvent.click(screen.getByRole('button', { name: 'Select another completed calculation' }));
    else view.rerender(<PathFinderResults pf={asPf(change === 'model' ? { ...f.pf, data: { ...f.pf.data, activeModel: { modelVersionId: id(20), selectionRevision: '2' } } } : f.pf)}
      selectedCableId={change === 'cable' ? id(30) : id(4)} accountId={change === 'account' ? id(21) : id(2)} options={change === 'options' ? { ...options, secondaryDistanceMeters: 3 } : options} />);
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(liveCableDetail()); });
    expect(screen.queryByText('/LIVE-CURRENT')).toBeNull(); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('keeps a newer explicit comparison when an older read resolves late', async () => {
    const f = recoveryFixture(); let finish!: (value: ReturnType<typeof liveCableDetail>) => void;
    const fresh = liveCableDetail(); fresh.row.cable.routing = '/NEWER-LIVE';
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(fresh);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' })); await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    const original = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!;
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' })); expect(await screen.findByText('/NEWER-LIVE')).toBeVisible(); expect(original.aborted).toBe(true);
    await act(async () => { finish(liveCableDetail()); }); expect(screen.queryByText('/LIVE-CURRENT')).toBeNull(); expect(screen.getByText('/NEWER-LIVE')).toBeVisible();
  });
  it('aborts an in-flight comparison when polling observes an intervening cable write, without automatically replacing the read', async () => {
    const f = recoveryFixture(); let finish!: (value: ReturnType<typeof liveCableDetail>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' })); await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    const signal = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!;
    view.rerender(<PathFinderResults pf={asPf({ ...f.pf, data: { ...f.pf.data, cables: [{ ...f.pf.data.cables[0], cableWriteRevision: '10' }] } })} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    expect(signal.aborted).toBe(true); await act(async () => { finish(liveCableDetail()); });
    expect(screen.queryByText('/LIVE-CURRENT')).toBeNull(); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('rejects a mismatched live cable response instead of substituting a project-state snapshot', async () => {
    const f = recoveryFixture(), wrong = liveCableDetail(); wrong.cableId = id(99); wrong.row.cable.id = id(99);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce(wrong);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' })); expect(await screen.findByText(/Live cable comparison is unavailable/)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Current cable values' })).toBeNull(); expect(f.pf.clear).not.toHaveBeenCalled();
  });
  it('blocks only the exact proposal review and Apply when a verified live read proves a different cable revision', async () => {
    const f = recoveryFixture(), live = liveCableDetail(); live.row.cable.cableWriteRevision = '10';
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce(live);
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(await screen.findByRole('region', { name: 'Current cable values' })).toHaveTextContent('revision 10');
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Calculate non-MV cables' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Open path again' })).toBeEnabled();
    expect(screen.getByText(/current cable revision differs from this proposal/)).toBeVisible();
    view.rerender(<PathFinderResults pf={asPf({ ...f.pf, data: { ...f.pf.data, cables: [{ ...f.pf.data.cables[0], cableWriteRevision: '10' }] } })} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.clear).not.toHaveBeenCalled(); expect(f.pf.cancelOperation).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('disables a previously reviewed proposal when its independent live comparison later proves an intervening write', async () => {
    const f = recoveryFixture(); let finish!: (value: ReturnType<typeof liveCableDetail>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    const live = liveCableDetail(); live.row.cable.cableWriteRevision = '10'; await act(async () => { finish(live); });
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed result' })); expect(f.pf.action).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Calculate non-MV cables' })).toBeEnabled(); expect(f.pf.clear).not.toHaveBeenCalled(); expect(f.pf.cancelOperation).not.toHaveBeenCalled();
  });
  it('reviews a fresh individually sealed v7 result while siblings calculate, without requiring it on the current page or recent list', async () => {
    const { f, proposal } = sealedFixture();
    render(<PathFinderResults pf={asPf({ ...f.pf, data: { ...f.pf.data, proposals: [] } })} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    fireEvent.click(screen.getByText('Calculation provenance'));
    expect(screen.getByText(/Shared location calculation\. An individually sealed cable result is recorded/)).toBeVisible();
    expect(screen.queryByText(/Automatic generation:/)).toBeNull();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
    f.pf.reviewProposal.mockResolvedValueOnce({ reviewId: id(5), proposal });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm proposal review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    expect(f.pf.reviewProposal).toHaveBeenCalledWith(proposal); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['projectId', 'jobId', 'cableId', 'proposalId', 'dependencyHash'] as const)('refuses active-parent item proof with a different %s', async field => {
    const { f, proposal } = sealedFixture();
    f.pf.readProposal.mockResolvedValueOnce({ ...proposal, itemApplicability: { ...proposal.itemApplicability, [field]: field === 'dependencyHash' ? 'd'.repeat(64) : id(99) } });
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'failed', 'cancelled', 'cancellation requested'] as const)('keeps sealed v7 results blocked when the parent is %s', async state => {
    const { f } = sealedFixture();
    mockScope.initial = { ...mockScope.initial!, jobStatus: state === 'unknown' ? null : state === 'cancellation requested' ? 'running' : state,
      cancelRequested: state === 'cancellation requested' };
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it.each(['failed', 'cancelled', 'cancellation requested'] as const)('preserves a checked %s scope fence when the recent job observation still says running', async state => {
    const { f } = sealedFixture();
    mockScope.initial = { ...mockScope.initial!, jobStatus: state === 'cancellation requested' ? 'running' : state,
      cancelRequested: state === 'cancellation requested' };
    const pf = { ...f.pf, data: { ...f.pf.data, jobs: [{ id: id(7), status: 'running', cancelRequested: false }] } };
    render(<PathFinderResults pf={pf as unknown as ReturnType<typeof usePathFinder>} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['missing proof', 'legacy dependency', 'server refusal', 'stale', 'incompatible'] as const)('does not use an active-parent proof to bypass %s', async issue => {
    const { f, proposal } = sealedFixture();
    const detail = { ...proposal, ...(issue === 'missing proof' ? { itemApplicability: null } : {}),
      ...(issue === 'legacy dependency' ? { provenance: { ...proposal.provenance, dependencyVersion: 'pathfinder.dependencies.v6' } } : {}),
      ...(issue === 'server refusal' ? { canApply: false } : {}), ...(issue === 'stale' ? { stale: true } : {}),
      ...(issue === 'incompatible' ? { compatibilityIssue: 'Recalculate this result.' } : {}) };
    f.pf.readProposal.mockResolvedValueOnce(detail);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('keeps the selected completed calculation separate from newer running proposals for the same cable', async () => {
    const f = recoveryFixture(), completed = f.pf.data.proposals[0];
    const running = { ...completed, id: id(33), jobId: id(17), canApply: false };
    const pf = { ...f.pf, data: { ...f.pf.data, proposals: [running, completed], jobs: [
      { id: id(17), status: 'running', cancelRequested: false }, { id: id(7), status: 'complete', cancelRequested: false },
    ] } };
    render(<PathFinderResults pf={pf as unknown as ReturnType<typeof usePathFinder>} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    const recent = within(screen.getByRole('list', { name: 'Path Finder proposals' }));
    await waitFor(() => expect(recent.getAllByRole('button')).toHaveLength(1));
    expect(recent.getByRole('button', { name: /Fixture cable — Ready for review/ })).toBeVisible();
    expect(recent.queryByRole('button', { name: /Review blocked/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    expect(f.pf.readProposal).toHaveBeenCalledWith(completed.id);
    expect(f.pf.showPath).toHaveBeenCalledWith(expect.objectContaining({ pathId: completed.id }));
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('invalidates the displayed proposal and its confirmed review when the calculation scope changes', async () => {
    const f = recoveryFixture(); render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm proposal review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Select another completed calculation' }));
    await waitFor(() => expect(screen.queryByTestId('pathfinder-proposal')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Apply reviewed result' })).toBeNull();
    expect(f.pf.showPath).toHaveBeenCalledTimes(1); expect(f.pf.reviewProposal).toHaveBeenCalledTimes(1); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['job', 'proposal ID'] as const)('refuses a fetched proposal with a different %s before displaying or reviewing it', async mismatch => {
    const f = recoveryFixture(), detail = { ...f.pf.data.proposals[0] };
    if (mismatch === 'job') detail.jobId = id(17); else detail.id = id(33);
    f.pf.readProposal.mockResolvedValueOnce(detail);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(f.pf.readProposal).toHaveBeenCalledOnce());
    expect(await screen.findByText('This proposal does not belong to the selected calculation. Open a result from that calculation again.')).toBeVisible();
    await waitFor(() => expect(screen.queryByText('Loading the exact computed path…')).toBeNull());
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(screen.queryByTestId('pathfinder-proposal')).toBeNull();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('ignores a late proposal response from the previous selected calculation', async () => {
    const f = recoveryFixture(); let finish!: (value: typeof f.pf.data.proposals[0]) => void;
    f.pf.readProposal.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(screen.getByText('Loading the exact computed path…')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Select another completed calculation' }));
    await act(async () => finish(f.pf.data.proposals[0]));
    expect(screen.queryByTestId('pathfinder-proposal')).toBeNull(); expect(f.pf.showPath).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('retains an exact pending Apply across a calculation scope change without sending it automatically', async () => {
    const f = recoveryFixture(); render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    await submitFirstApply(f); const original = f.pf.action.mock.calls[0];
    fireEvent.click(screen.getByRole('button', { name: 'Select another completed calculation' }));
    await waitFor(() => expect(screen.queryByTestId('pathfinder-proposal')).toBeNull());
    expect(screen.getByRole('button', { name: 'Retry pending Apply' })).toBeEnabled(); expect(f.pf.action).toHaveBeenCalledTimes(1);
    f.pf.action.mockResolvedValueOnce(f.receipt);
    fireEvent.click(screen.getByRole('button', { name: 'Retry pending Apply' }));
    await waitFor(() => expect(f.pf.action).toHaveBeenCalledTimes(2)); expect(f.pf.action.mock.calls[1]).toEqual(original);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry pending Apply' })).toBeNull());
    expect(f.pf.reviewProposal).toHaveBeenCalledTimes(1);
  });
  it('keeps verified From/To objects with the route without changing exact points or cable values', async () => {
    const f = recoveryFixture(); vi.mocked(proposalEndpointObjectIds).mockResolvedValue(['dbid:44', 'dbid:45', 'dbid:23']);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledWith({ pathId: id(3), points: f.pf.data.proposals[0].route.points, objectIds: [23, 44, 45] }));
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('aborts endpoint reads and ignores their late objects when the selected cable changes', async () => {
    const f = recoveryFixture(); let finish!: (value: string[]) => void;
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(proposalEndpointObjectIds).toHaveBeenCalledOnce());
    const signal = vi.mocked(proposalEndpointObjectIds).mock.calls[0][3]!;
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(22)} accountId={id(2)} options={options} />);
    expect(signal.aborted).toBe(true); finish(['dbid:44']);
    await waitFor(() => expect(screen.queryByText('Loading the exact computed path…')).toBeNull());
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('refuses an oversized route plus endpoint union without truncating the displayed path', async () => {
    const f = recoveryFixture(), detail = { ...f.pf.data.proposals[0], route: { ...f.pf.data.proposals[0].route,
      objectIds: Array.from({ length: 512 }, (_, index) => `dbid:${index + 1}`) } };
    f.pf.readProposal.mockResolvedValueOnce(detail); vi.mocked(proposalEndpointObjectIds).mockResolvedValue(['dbid:600']);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(await screen.findByText(/This path and its From\/To objects exceed the viewer object budget/)).toBeVisible();
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
  });
  it('explains the selected proposal cancellation separately from engineering acceptance without relaxing review', async () => {
    const f = recoveryFixture(); f.pf.data.proposals[0].canApply = false;
    const pf = { ...f.pf, data: { ...f.pf.data, jobs: [{ id: id(7), status: 'cancelled', cancelRequested: true }] } };
    render(<PathFinderResults pf={pf as unknown as ReturnType<typeof usePathFinder>} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(await screen.findByText(/This calculation was cancelled/)).toBeVisible();
    expect(screen.getByText('Controlled local fixture.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it.each(['queued', 'running', 'failed'])('explains an incomplete %s calculation without claiming the model itself needs acceptance', async status => {
    const f = recoveryFixture(); f.pf.data.proposals[0].canApply = false;
    const pf = { ...f.pf, data: { ...f.pf.data, jobs: [{ id: id(7), status, cancelRequested: false }] } };
    render(<PathFinderResults pf={pf as unknown as ReturnType<typeof usePathFinder>} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(await screen.findByText(new RegExp(status === 'failed' ? 'This calculation failed' : `This calculation is ${status}`))).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it('keeps the current model appearance while the selected proposal is being read', async () => {
    const f = recoveryFixture(); let finish!: (value: typeof f.pf.data.proposals[0]) => void;
    f.pf.readProposal.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(screen.getByText('Loading the exact computed path…')).toBeVisible();
    expect(f.pf.clear).not.toHaveBeenCalled(); expect(f.pf.showPath).not.toHaveBeenCalled();
    finish(f.pf.data.proposals[0]);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    expect(f.pf.clear).not.toHaveBeenCalled();
  });
  it('reconciles a committed-but-unacknowledged Apply after polling changes the cable revision', async () => {
    const f = recoveryFixture(), changed = vi.fn(), view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} onCableValuesChanged={changed} />);
    await submitFirstApply(f); expect(changed).not.toHaveBeenCalled(); const first = f.pf.action.mock.calls[0];
    const updated = { ...f.pf, data: { ...f.pf.data, cables: [{ ...f.pf.data.cables[0], cableWriteRevision: '10' }],
      proposals: [{ ...f.pf.data.proposals[0], stale: true, canApply: false }] } };
    view.rerender(<PathFinderResults pf={asPf(updated)} selectedCableId={id(4)} accountId={id(2)} options={options} onCableValuesChanged={changed} />);
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    f.pf.action.mockResolvedValueOnce(f.receipt);
    fireEvent.click(screen.getByRole('button', { name: 'Retry pending Apply' }));
    await waitFor(() => expect(f.pf.action).toHaveBeenCalledTimes(2)); expect(f.pf.action.mock.calls[1]).toEqual(first);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry pending Apply' })).toBeNull());
    expect(screen.getByText(/matching Apply receipt is confirmed/)).toBeVisible(); expect(f.pf.reviewProposal).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledOnce(); expect(f.pf.refresh).toHaveBeenCalledOnce();
  });

  it('retains one command across changed model, options, inactive tool and Viewer ownership', async () => {
    const f = recoveryFixture(), view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    await submitFirstApply(f); const first = f.pf.action.mock.calls[0];
    const changed = { ...f.pf, data: { ...f.pf.data, registryRevision: '2', activeModel: { modelVersionId: id(20), selectionRevision: '2' } } };
    view.rerender(<PathFinderResults pf={asPf(changed)} selectedCableId={null} accountId={id(2)} options={{ ...options, secondaryDistanceMeters: 3 }} active={false} displayOwned={false} />);
    expect(screen.getByRole('button', { name: 'Retry pending Apply' })).toBeDisabled(); expect(f.pf.action).toHaveBeenCalledTimes(1);
    view.rerender(<PathFinderResults pf={asPf(changed)} selectedCableId={null} accountId={id(2)} options={null} active displayOwned={false} />);
    expect(screen.getByRole('button', { name: 'Retry pending Apply' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled());
    expect(f.pf.reviewProposal).toHaveBeenCalledTimes(1); expect(f.pf.action).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry pending Apply' }));
    await waitFor(() => expect(f.pf.action).toHaveBeenCalledTimes(2)); expect(f.pf.action.mock.calls[1]).toEqual(first);
  });

  it('restores after mounted reload without transmitting until explicit retry, and fences another account', async () => {
    const f = recoveryFixture(), firstView = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    await submitFirstApply(f); const first = f.pf.action.mock.calls[0]; firstView.unmount();
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(21)} options={options} />);
    expect(screen.queryByRole('button', { name: 'Retry pending Apply' })).toBeNull(); expect(f.pf.action).toHaveBeenCalledTimes(1);
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry pending Apply' })).toBeEnabled());
    expect(f.pf.action).toHaveBeenCalledTimes(1);
    f.pf.action.mockResolvedValueOnce(f.receipt); fireEvent.click(screen.getByRole('button', { name: 'Retry pending Apply' }));
    await waitFor(() => expect(f.pf.action).toHaveBeenCalledTimes(2)); expect(f.pf.action.mock.calls[1]).toEqual(first);
  });

  it('requires an explicit close and a matching server tombstone before enabling a fresh review', async () => {
    const f = recoveryFixture(), changed = vi.fn(); render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} onCableValuesChanged={changed} />);
    await submitFirstApply(f); const original = f.pf.action.mock.calls[0] as unknown as [string, { idempotencyKey: string; reviewId: string; expectedCableWriteRevision: string }];
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(f.pf.action).toHaveBeenCalledTimes(1);
    f.pf.action.mockResolvedValueOnce({ schemaVersion: 'wfc.pf.apply-recovery.v1', projectId: id(1), proposalId: id(3),
      ...original[1], status: 'closed-without-apply', duplicate: false, receipt: null });
    fireEvent.click(screen.getByRole('button', { name: 'Close pending request' }));
    await waitFor(() => expect(f.pf.action).toHaveBeenCalledTimes(2));
    expect(f.pf.action.mock.calls[1]).toEqual([`/proposals/${id(3)}/close-pending-apply`, original[1]]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close pending request' })).toBeNull());
    expect(screen.getByText(/closed without applying cable values/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled();
    expect(f.pf.reviewProposal).toHaveBeenCalledTimes(1); expect(changed).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
  });
});
