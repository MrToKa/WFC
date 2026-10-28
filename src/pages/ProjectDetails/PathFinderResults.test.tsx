import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderResults, pathFinderJobOutputLabel, pathFinderWorkflowDisplayScope, type PathFinderWorkflowDisplay, type PathFinderWorkflowReview } from './PathFinderResults';
import type { usePathFinder } from './hooks/usePathFinder';
import { proposalEndpointObjectIds } from './pathFinderEndpointVisibility';
import { parsePathFinderProposal, type PathFinderJob, type PathFinderPreferences, type PathFinderProposal } from '@/api/pathfinder';
import { fetchPathFinderCableWorkflowDetail } from '@/api/pathfinderCableWorkflow';
import { cableWorkflowDetailSchema } from '../../../shared/pathfinderCableWorkflowQueries';
import { revisionResultEnvelopeSchema } from '../../../shared/pathfinderRevisionResults';
import { barrierAdmissionIntentSchema } from '../../../shared/pathfinderBarrierAdmission';
import { barrierWriteEvidenceSchema } from '../../../shared/pathfinderBarrierWrites';
import { barrierCalculationFixture } from '@/test/pathfinderBarrierFixtures';
vi.mock('@/api/pathfinderCableWorkflow', () => ({ fetchPathFinderCableWorkflowDetail: vi.fn() }));
const mockScope = vi.hoisted(() => ({ initial: null as import('./PathFinderRevisionResults').PathFinderCalculationScope | null }));
const recalculationCapture = vi.hoisted(() => ({ preferences: undefined as unknown }));
describe('calculation and Cable list saving dispositions', () => {
  it.each([
    ['pending', 'waiting to save'], ['running', 'saving'], ['written', 'saved'], ['already-written', 'already saved'],
    ['review-required', 'confirmation required'], ['stale', 'not saved — inputs changed'], ['authority-expired', 'not saved — authorization expired'],
    ['refused', 'not saved'], ['unknown', 'save not confirmed'],
  ] as const)('reports %s without promoting calculation status to saved values', (status, label) => {
    expect(pathFinderJobOutputLabel({ status, receiptId: ['written', 'already-written'].includes(status) ? id(90) : null, reasonCode: null })).toBe(`Cable list update: ${label}`);
  });
  it('does not infer saving from a historical calculation alone', () => { expect(pathFinderJobOutputLabel(undefined)).toBe('Cable list update: not reported'); });
  it('shows an exact job writer refusal alongside the successfully calculated route', async () => {
    const f = recoveryFixture(), job: PathFinderJob = { id: id(7), projectId: id(1), status: 'complete', total: 1, completed: 1, cancelRequested: false,
      failure: null, attempts: 1, createdAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:01Z',
      items: [{ cableId: id(4), status: 'calculated', state: 'complete', message: null, automaticUpdate: { status: 'refused', receiptId: null, reasonCode: 'PROPOSAL_NOT_APPLICABLE' } }] };
    const pf = { ...f.pf, data: { ...f.pf.data, jobs: [job] }, readJob: vi.fn(async () => job) };
    render(<PathFinderResults pf={asPf(pf)} selectedCableId={null} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Job details' }));
    const outcomes = await screen.findByRole('list', { name: 'Calculation outcomes' });
    expect(outcomes).toHaveTextContent('Fixture cable: Route calculated');
    expect(outcomes).toHaveTextContent('Cable list update: not saved (proposal not applicable)');
    expect(outcomes).not.toHaveTextContent('Ready for review'); expect(pf.calculate).not.toHaveBeenCalled(); expect(pf.action).not.toHaveBeenCalled();
  });
});
vi.mock('./pathFinderEndpointVisibility', async original => ({ ...await original<typeof import('./pathFinderEndpointVisibility')>(), proposalEndpointObjectIds: vi.fn(async () => [] as string[]) }));
vi.mock('./PathFinderRecalculationPanel', () => ({ PathFinderRecalculationPanel: (props: { preferences?: unknown }) => {
  recalculationCapture.preferences = props.preferences; return <div>Server recalculation status</div>;
} }));
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
beforeEach(() => { sessionStorage.clear(); mockScope.initial = null; recalculationCapture.preferences = undefined; vi.mocked(proposalEndpointObjectIds).mockReset().mockResolvedValue([]);
  vi.mocked(fetchPathFinderCableWorkflowDetail).mockReset().mockResolvedValue(liveCableDetail()); });
afterEach(() => { vi.useRealTimers(); sessionStorage.clear(); });
describe('calculation production boundary', () => {
  // This multi-render Fluent UI ownership flow already takes 4.6–4.9 s on the
  // unchanged baseline. Keep its assertions independent of the default 5 s cap.
  it('retains the exact live comparison when claiming the parent viewer and still revokes writes when that view is released', async () => {
    const f = recoveryFixture(); let finishComparison!: (value: ReturnType<typeof liveCableDetail>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finishComparison = resolve; }));
    function ParentViewer() {
      const [displayOwned, setDisplayOwned] = useState(false);
      return <><button onClick={() => setDisplayOwned(false)}>Release parent viewer</button>
        <PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} displayOwned={displayOwned}
          claimViewer={() => { setDisplayOwned(true); return () => true; }} /></>;
    }
    render(<ParentViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    await act(async () => finishComparison(liveCableDetail()));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    expect(screen.getByRole('region', { name: 'Current and proposed cable values' })).toHaveTextContent('/LIVE-CURRENT');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm proposal review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Release parent viewer' }));
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    expect(f.pf.action).not.toHaveBeenCalled();
  }, 10_000);
  it('shares the exact comparison and separate explicit review and Apply actions with the cable popup', async () => {
    const f = recoveryFixture(), changed = vi.fn(), update = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    const popup = () => update.mock.calls.at(-1)?.[0];
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} onWorkflowReviewChange={update} onCableValuesChanged={changed} />);
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(popup()?.canReview).toBe(true));
    expect(popup()?.comparison?.current.cable).toMatchObject({ routing: '/LIVE-CURRENT', designLength: '12.00000000000000000001', installLength: '123.2500' });
    expect(popup()?.comparison?.proposal).toMatchObject({ proposalId: id(3), routing: '/BC1', designLength: '7' });
    await act(async () => { popup()!.review(); }); await waitFor(() => expect(popup()?.canApply).toBe(true));
    expect(f.pf.reviewProposal).toHaveBeenCalledOnce(); expect(f.pf.action).not.toHaveBeenCalled();
    f.pf.action.mockResolvedValueOnce(f.receipt); await act(async () => { popup()!.apply(); });
    await waitFor(() => expect(changed).toHaveBeenCalledOnce()); expect(f.pf.action).toHaveBeenCalledOnce();
  });
  it('fences retained popup callbacks immediately when the selected cable changes', async () => {
    const f = recoveryFixture(), update = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    const popup = () => update.mock.calls.at(-1)?.[0];
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} onWorkflowReviewChange={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' })); await waitFor(() => expect(popup()?.canReview).toBe(true));
    const old = popup()!;
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(99)} accountId={id(2)} options={options} onWorkflowReviewChange={update} />);
    await act(async () => { old.review(); old.apply(); old.retry(); old.closePending(); });
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
    expect(popup()?.cableId).toBe(id(99)); expect(popup()?.proposalId).toBeNull();
  });
  it('synchronously admits only one review when the same popup action is activated twice before a render', async () => {
    const f = recoveryFixture(), update = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    const popup = () => update.mock.calls.at(-1)?.[0]; let finish!: (value: { reviewId: string; proposal: PathFinderProposal }) => void;
    f.pf.reviewProposal.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} onWorkflowReviewChange={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' })); await waitFor(() => expect(popup()?.canReview).toBe(true));
    const old = popup()!; act(() => { old.review(); old.review(); });
    expect(f.pf.reviewProposal).toHaveBeenCalledOnce(); expect(popup()?.busy).toBe(true); expect(popup()?.canApply).toBe(false);
    await act(async () => { finish({ reviewId: id(5), proposal: f.pf.data.proposals[0] }); });
    await waitFor(() => expect(popup()?.canApply).toBe(true)); expect(f.pf.action).not.toHaveBeenCalled();
  });
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
function fixtureBarrierIntent(drillThroughWalls = false) {
  return barrierCalculationFixture(id, drillThroughWalls, [[1, 2, 3], [2, 2, 3]]).preferences.barrierRouting;
}
const options: PathFinderPreferences = { secondaryDistanceMeters: 2, preferVerticalApproach: true, barrierRouting: fixtureBarrierIntent() };
function liveCableDetail() {
  const available = { status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false };
  return cableWorkflowDetailSchema.parse({ schemaVersion: 'wfc.pf.cable-workflow-detail.v1', projectId: id(1), cableId: id(4), querySha256: 'e'.repeat(64), contextSha256: 'f'.repeat(64),
    row: { projectId: id(1), mto: 'Control', cable: { id: id(4), tag: 'Live cable', fromLocation: 'Live From', toLocation: 'Live To', routing: '/LIVE-CURRENT', designLength: '12.00000000000000000001', installLength: '123.2500', cableWriteRevision: '9' },
      from: available, to: available, calculation: { jobId: null, jobStatus: null, itemState: null, outcome: 'not-evaluated', reasonCodes: [], errorCode: null, currentness: 'not-evaluated', proposalId: null, proposalHash: null, reviewable: false, acceptedMatchesCurrent: false } } });
}
function recoveryFixture() {
  const { barriers, engineIdentity } = barrierFixtureFacts();
  const proposal = { schemaVersion: 'wfc.pf.proposal.v2' as const, id: id(3), projectId: id(1), jobId: id(7), cableId: id(4), status: 'calculated', proposalHash: 'a'.repeat(64),
    revisionResultHash: 'b'.repeat(64), cableWriteRevision: '9', stale: false, synthetic: true, canApply: true,
    engineeringAccepted: true, acceptanceScope: 'local-synthetic-fixture', compatibilityIssue: null as string | null, message: 'Calculated fixture.',
    itemApplicability: null as PathFinderProposal['itemApplicability'],
    engineeringMessage: 'Controlled local fixture.', routingPreferences: options, createdAt: '2026-10-19T14:00:00Z', barriers,
    provenance: { dependencyVersion: 'pathfinder.dependencies.v8' as const, dependencyHash: 'c'.repeat(64), engineIdentity, automatic: null,
      endpointSources: { from: 'confirmed-shared-location' as const, to: 'confirmed-shared-location' as const } },
    design: { lengthBeforePercentageMeters: '6', unroundedLengthMeters: '6.6', designLengthMeters: '7' },
    route: { success: true, message: 'Synthetic exact route.', routeCodes: ['/BC1'], segmentIds: ['dbid:23'], points: [[1, 2, 3], [2, 2, 3]] as [number, number, number][], objectIds: ['dbid:23'], lengthMeters: 1, fromDistanceMeters: 0, toDistanceMeters: 0,
      fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0, routeText: '/BC1' } };
  const action = vi.fn(async (): Promise<Record<string, unknown> | null> => null);
  const pf = { data: { projectId: id(1), registryRevision: '1', activeModel: { modelVersionId: id(8), selectionRevision: '1' }, settings: {},
    artifacts: [{ id: id(9) }], cables: [{ id: id(4), tag: 'Fixture cable', mto: 'Control', cableWriteRevision: '9' }], jobs: [], proposals: [proposal] },
    preparationAccess: { projectId: id(1), loadedProjectId: id(1), token: 'current-private-token', isAdmin: true },
    busy: false, calculate: vi.fn(), clear: vi.fn(), action, cancelOperation: vi.fn(), refresh: vi.fn(),
    readProposal: vi.fn(async (): Promise<PathFinderProposal | null> => proposal as unknown as PathFinderProposal), showPath: vi.fn(async () => true),
    reviewProposal: vi.fn(async (): Promise<{ reviewId: string; proposal: PathFinderProposal } | null> => ({ reviewId: id(5), proposal: proposal as unknown as PathFinderProposal })) };
  const receipt = { duplicate: true, receipt: { id: id(6), projectId: id(1), proposalId: id(3), cableId: id(4), appliedAt: '2026-10-19T14:00:00Z',
    before: { id: id(4), project_id: id(1), cable_write_revision: '9', install_length: '123' },
    after: { id: id(4), project_id: id(1), cable_write_revision: '10', install_length: '123' },
    provenance: { schemaVersion: 'pathfinder.apply.v3', proposalId: id(3), proposalHash: 'a'.repeat(64), reviewId: id(5),
      review: { id: id(5), actorId: id(2), dependencyHash: 'c'.repeat(64), revisionResultSha256: 'b'.repeat(64) },
      dependencies: { schemaVersion: 'pathfinder.dependencies.v8', projectId: id(1), cableId: id(4), engineIdentity },
      revisionResult: { revisionResultSha256: 'b'.repeat(64), dependencyHash: 'c'.repeat(64), engineResultSha256: 'e'.repeat(64) }, barrierEvidence: barrierWriteEvidenceSchema.parse({ schemaVersion: 'wfc.pf.barrier-write-evidence.v1',
        dependencyVersion: 'pathfinder.dependencies.v8', responseVersion: 'pathfinder.model.response.v3', projectId: id(1), cableId: id(4),
        dependencySha256: 'c'.repeat(64), engineIdentitySha256: engineIdentity.contentSha256, engineResultSha256: 'e'.repeat(64), contextSha256: 'f'.repeat(64),
        executionSha256: '1'.repeat(64), routeSha256: barriers.proof!.routeSha256, policySha256: barriers.context.binding.policySha256,
        profileSha256: barriers.context.profileSha256, registryRevision: '1', snapshotId: id(91), snapshotSha256: 'c'.repeat(64), drillThroughWalls: false, status: 'no-barriers-declared' }) } } };
  return { pf, receipt };
}
type Fixture = ReturnType<typeof recoveryFixture>;
const asPf = (pf: object) => pf as ReturnType<typeof usePathFinder>;
function sealedFixture() {
  const f = recoveryFixture(), base = f.pf.data.proposals[0];
  const proposal = { ...base, barriers: null, itemApplicability: { schemaVersion: 'wfc.pf.sealed-cable-applicability.v1' as const,
    dependencyVersion: 'pathfinder.dependencies.v7' as const, projectId: base.projectId, jobId: base.jobId, cableId: base.cableId,
    proposalId: base.id, dependencyHash: 'c'.repeat(64), scope: 'sealed-cable-item' as const },
    provenance: { dependencyVersion: 'pathfinder.dependencies.v7' as const, dependencyHash: 'c'.repeat(64), engineIdentity: null, automatic: null } };
  f.pf.readProposal.mockResolvedValue(proposal);
  mockScope.initial = { admissionId: id(70), jobId: id(7), ready: false, message: 'Other cables are calculating.', wholeJobReady: false, jobStatus: 'running', cancelRequested: false };
  return { f, proposal };
}
/** Complete, structurally validated synthetic v8 result with explicit empty or
 * explicit drilling evidence. It grants no real-model engineering acceptance. */
function barrierFixtureFacts(drillThroughWalls = false) {
  return barrierCalculationFixture(id, drillThroughWalls, [[1, 2, 3], [2, 2, 3]]);
}
function barrierSealedFixture(drillThroughWalls = false) {
  const f = recoveryFixture(), base = f.pf.data.proposals[0], { barriers, engineIdentity, preferences } = barrierFixtureFacts(drillThroughWalls);
  const proposal = parsePathFinderProposal({ ...base, schemaVersion: 'wfc.pf.proposal.v2', routingPreferences: preferences, barriers,
    route: { ...base.route },
    itemApplicability: { schemaVersion: 'wfc.pf.sealed-cable-applicability.v2', dependencyVersion: 'pathfinder.dependencies.v8', projectId: base.projectId,
      jobId: base.jobId, cableId: base.cableId, proposalId: base.id, dependencyHash: 'c'.repeat(64), scope: 'sealed-cable-item' },
    provenance: { dependencyVersion: 'pathfinder.dependencies.v8', dependencyHash: 'c'.repeat(64), engineIdentity, automatic: null,
      endpointSources: { from: 'confirmed-shared-location', to: 'confirmed-shared-location' } } });
  const pf = { ...f.pf, data: { ...f.pf.data, proposals: [], activeModel: { ...f.pf.data.activeModel, contentFingerprint: preferences.barrierRouting!.scope.contentFingerprint } },
    readProposal: vi.fn(async (): Promise<PathFinderProposal | null> => proposal), reviewProposal: vi.fn(async () => ({ reviewId: id(5), proposal })) };
  mockScope.initial = { admissionId: id(70), jobId: id(7), ready: false, message: 'Other cables are calculating.', wholeJobReady: false,
    jobStatus: 'running', cancelRequested: false };
  return { f, pf, proposal, preferences };
}
function workflowFixture(status: 'complete' | 'running' = 'complete') {
  const f = recoveryFixture(), base = f.pf.data.proposals[0], dependencyHash = 'c'.repeat(64), baselineHash = 'd'.repeat(64);
  const itemApplicability = { schemaVersion: 'wfc.pf.sealed-cable-applicability.v2' as const, dependencyVersion: 'pathfinder.dependencies.v8' as const,
    projectId: id(1), jobId: id(7), cableId: id(4), proposalId: id(3), dependencyHash, scope: 'sealed-cable-item' as const };
  const envelope = revisionResultEnvelopeSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-result.v1', id: id(80), projectId: id(1), admissionId: id(81),
    jobId: id(7), cableId: id(4), proposalId: id(3), proposalHash: base.proposalHash, baselineHash, dependencyHash,
    engineResultSha256: 'e'.repeat(64), ledgerHash: null, oldModel: null,
    summary: { calculationMode: 'calculate', newModel: null, routeText: '/BC1', rawLengthMeters: 1, designLengthMeters: '7', unroundedMeters: '6.6',
      delta: { rawLengthMeters: null, designLengthMeters: null, unroundedMeters: null, baseline: 'current-values' }, reasonCodes: [] },
    comparisonRef: null, observedEvents: [], lengthLedger: null, physicalChangeProven: false, createdAt: base.createdAt, revisionResultSha256: base.revisionResultHash });
  const proposal = { ...base, revisionResult: envelope, revisionBaselineHash: baselineHash, itemApplicability: status === 'running' ? itemApplicability : null } as unknown as PathFinderProposal;
  const live = liveCableDetail(); live.row.calculation = { ...live.row.calculation, jobId: id(7), jobStatus: status, itemState: 'complete', outcome: 'calculated',
    currentness: 'current', proposalId: id(3), proposalHash: base.proposalHash, reviewable: true, itemApplicability: status === 'running' ? itemApplicability : null };
  const parent = { id: id(7), projectId: id(1), status, total: 200, completed: status === 'complete' ? 200 : 1, cancelRequested: false, failure: null, attempts: 1, createdAt: base.createdAt, updatedAt: base.createdAt };
  const pf = { ...f.pf, data: { ...f.pf.data, proposals: [] }, readProposal: vi.fn(async (): Promise<PathFinderProposal | null> => proposal), readJob: vi.fn(async (): Promise<PathFinderJob | null> => parent) };
  vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(live);
  return { pf, proposal, live, parent, selection: live.row };
}
function savedHistoryFixture() {
  const f = workflowFixture();
  f.proposal.stale = true; f.proposal.canApply = false;
  f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7.000', cableWriteRevision: '10' };
  f.live.row.calculation = { ...f.live.row.calculation, reviewable: false, acceptedMatchesCurrent: true };
  mockScope.initial = { admissionId: f.proposal.revisionResult!.admissionId, jobId: f.proposal.jobId,
    ready: true, wholeJobReady: true, jobStatus: 'complete', cancelRequested: false, message: null };
  const pf = { ...f.pf, data: { ...f.pf.data, proposals: [f.proposal], cables: f.pf.data.cables.map(cable => ({ ...cable, cableWriteRevision: '10' })) } };
  return { ...f, pf };
}
describe('receipt-backed saved history presentation', () => {
  it('shows the exact saved result and current barrier evidence without renewing review or Apply', async () => {
    const f = savedHistoryFixture(), review = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    vi.mocked(proposalEndpointObjectIds).mockResolvedValueOnce(['dbid:44', 'dbid:45']);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} onWorkflowReviewChange={review} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(await screen.findByRole('heading', { name: 'Saved in Cable list' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Saved cable values' })).toHaveTextContent('Design length: 7.000 m');
    expect(screen.getByRole('region', { name: 'Saved cable values' })).toHaveTextContent('/BC1');
    expect(screen.queryByText(/The current cable revision differs/)).toBeNull();
    expect(screen.queryByText(/This result is outdated/)).toBeNull();
    expect(screen.queryByText('Recorded barrier check is outdated')).toBeNull();
    expect(screen.queryByText(/The model, barrier scope or calculation policy changed/)).toBeNull();
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(await screen.findByText('Saved route shown in the model.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirm proposal review' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply reviewed result' })).toBeNull();
    expect(review.mock.calls.at(-1)?.[0]).toMatchObject({ canReview: false, canApply: false });
    expect(screen.getByRole('list', { name: 'Path Finder proposals' })).toHaveTextContent('Saved in Cable list');
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it('keeps a failed viewer acknowledgement retryable without claiming the path was shown', async () => {
    const f = savedHistoryFixture(); f.pf.showPath.mockResolvedValueOnce(false);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(await screen.findByRole('heading', { name: 'Saved in Cable list' })).toBeVisible();
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    expect(screen.queryByText('Saved route shown in the model.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open path again' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open path again' }));
    expect(await screen.findByText('Saved route shown in the model.')).toBeVisible();
    expect(f.pf.showPath).toHaveBeenCalledTimes(2); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('uses the fresh completed scope and current saved proof while broad job progress still says queued', async () => {
    const f = savedHistoryFixture(), pf = { ...f.pf, data: { ...f.pf.data, jobs: [{ ...f.parent, status: 'queued' }] } };
    render(<PathFinderResults pf={asPf(pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(await screen.findByRole('heading', { name: 'Saved in Cable list' })).toBeVisible();
    expect(screen.queryByText(/This calculation is queued/)).toBeNull();
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it.each(['no accepted proof', 'historical saved exact', 'routing', 'length', 'job', 'proposal', 'proposal hash', 'envelope hash', 'admission', 'dependency', 'unavailable endpoints', 'parent failed', 'parent cancelled'] as const)
    ('retains stale warnings when %s does not prove the same current saved result', async reason => {
      const f = savedHistoryFixture();
      if (reason === 'no accepted proof') f.live.row.calculation.acceptedMatchesCurrent = false;
      if (reason === 'historical saved exact') Object.assign(f.live.row.calculation, { acceptedMatchesCurrent: false, currentness: 'changed', savedExactDisplay: true });
      if (reason === 'routing') f.live.row.cable.routing = '/MANUAL';
      if (reason === 'length') f.live.row.cable.designLength = '8';
      if (reason === 'job') f.live.row.calculation.jobId = id(99);
      if (reason === 'proposal') f.live.row.calculation.proposalId = id(99);
      if (reason === 'proposal hash') f.live.row.calculation.proposalHash = 'f'.repeat(64);
      if (reason === 'envelope hash') f.proposal.revisionResult = { ...f.proposal.revisionResult!, revisionResultSha256: 'f'.repeat(64) };
      if (reason === 'admission') mockScope.initial!.admissionId = id(99);
      if (reason === 'dependency') f.proposal.revisionResult = { ...f.proposal.revisionResult!, dependencyHash: 'f'.repeat(64) };
      if (reason === 'unavailable endpoints') f.live.row.from.pointAvailable = false;
      if (reason === 'parent failed') mockScope.initial!.jobStatus = 'failed';
      if (reason === 'parent cancelled') mockScope.initial!.cancelRequested = true;
      render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
      await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
      await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
      expect(screen.queryByRole('heading', { name: 'Saved in Cable list' })).toBeNull();
      expect(screen.getByText(/This result is outdated/)).toBeVisible();
      expect(screen.getByText('Recorded barrier check is outdated')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
      expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
    });
  it.each(['registry', 'generation', 'artifact', 'settings', 'model', 'token', 'account', 'options', 'revision'] as const)
    ('retires saved acknowledgement immediately after %s changes', async reason => {
      const f = savedHistoryFixture(), props = { selectedCableId: id(4), accountId: id(2), options };
      const view = render(<PathFinderResults {...props} pf={asPf(f.pf)} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
      expect(await screen.findByRole('heading', { name: 'Saved in Cable list' })).toBeVisible();
      const changed = { ...f.pf, data: { ...f.pf.data }, preparationAccess: { ...f.pf.preparationAccess }, preparationViewerGeneration: 0 };
      if (reason === 'registry') changed.data.registryRevision = '2';
      if (reason === 'generation') changed.preparationViewerGeneration = 1;
      if (reason === 'artifact') changed.data.artifacts = [{ id: id(99) }];
      if (reason === 'settings') changed.data.settings = { connectionGap: 2 };
      if (reason === 'model') changed.data.activeModel = { ...changed.data.activeModel, modelVersionId: id(99) };
      if (reason === 'token') changed.preparationAccess.token = 'other-current-token';
      if (reason === 'revision') changed.data.cables = changed.data.cables.map(cable => ({ ...cable, cableWriteRevision: '11' }));
      view.rerender(<PathFinderResults {...props} pf={asPf(changed)} accountId={reason === 'account' ? id(99) : props.accountId}
        options={reason === 'options' ? { ...options, secondaryDistanceMeters: 3 } : options} />);
      expect(screen.queryByRole('heading', { name: 'Saved in Cable list' })).toBeNull();
      expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
    });
  it('does not promote a late accepted proof after its registry context changes', async () => {
    const f = savedHistoryFixture(); let finish!: (value: ReturnType<typeof liveCableDetail>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const props = { selectedCableId: id(4), accountId: id(2), options };
    const view = render(<PathFinderResults {...props} pf={asPf(f.pf)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    const signal = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!;
    view.rerender(<PathFinderResults {...props} pf={asPf({ ...f.pf, data: { ...f.pf.data, registryRevision: '2' } })} />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish(f.live));
    expect(screen.queryByRole('heading', { name: 'Saved in Cable list' })).toBeNull();
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
});

describe('selected current cable workflow result', () => {
  it('qualifies only read-only saved exact display after an engine update while current review remains blocked', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), review = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    f.proposal.stale = true; f.proposal.canApply = false;
    f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7', cableWriteRevision: '10' };
    f.live.row.calculation = { ...f.live.row.calculation, currentness: 'changed', reviewable: false, acceptedMatchesCurrent: false, savedExactDisplay: true };
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.live.row} accountId={id(2)} options={options}
      onWorkflowDisplayChange={changed} onWorkflowReviewChange={review} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, source: 'saved-exact', routing: '/BC1', designLength: '7' }));
    expect(changed.mock.calls.at(-1)?.[0].verifiedRow?.calculation).toMatchObject({ currentness: 'changed', reviewable: false, acceptedMatchesCurrent: false });
    expect(review.mock.calls.at(-1)?.[0]).toMatchObject({ canReview: false, canApply: false });
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.live.row} accountId={id(2)} options={options}
      onWorkflowDisplayChange={changed} onWorkflowReviewChange={review} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it.each([
    ['saved-exact', 'before-show'], ['saved-exact', 'after-show'],
    ['accepted', 'before-show'], ['accepted', 'after-show'],
  ] as const)('shows both saved locations on the first explicit Show for a persisted %s route with endpoint foreground %s', async (source, timing) => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), review = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    let finishEndpoints!: (ids: string[]) => void;
    f.proposal.stale = true; f.proposal.canApply = false;
    f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7', cableWriteRevision: '10' };
    f.live.row.calculation = { ...f.live.row.calculation, currentness: source === 'saved-exact' ? 'changed' : 'current',
      reviewable: false, acceptedMatchesCurrent: source === 'accepted', savedExactDisplay: source === 'saved-exact' };
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise(resolve => { finishEndpoints = resolve; }));
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.live.row,
      accountId: id(2), options, onWorkflowDisplayChange: changed, onWorkflowReviewChange: review };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false, routing: '/BC1' }));
    expect(f.pf.showPath).not.toHaveBeenCalled();
    if (timing === 'before-show') await act(async () => finishEndpoints(['dbid:44', 'dbid:45']));
    view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    if (timing === 'after-show') {
      await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
      await act(async () => finishEndpoints(['dbid:44', 'dbid:45']));
    }
    await waitFor(() => expect(f.pf.showPath).toHaveBeenLastCalledWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(f.pf.showPath).toHaveBeenCalledTimes(timing === 'before-show' ? 1 : 2);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: true }));
    expect(review.mock.calls.at(-1)?.[0]).toMatchObject({ canReview: false, canApply: false });
    expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.readJob).toHaveBeenCalledOnce(); expect(proposalEndpointObjectIds).toHaveBeenCalledOnce();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it.each(['qualification', 'routing', 'length', 'parent-failed', 'parent-cancelled', 'proposal-hash'] as const)('refuses saved exact display when %s no longer matches', async failure => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.proposal.stale = true; f.proposal.canApply = false;
    f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7', cableWriteRevision: '10' };
    f.live.row.calculation = { ...f.live.row.calculation, currentness: 'changed', reviewable: false, acceptedMatchesCurrent: false, savedExactDisplay: true };
    if (failure === 'qualification') f.live.row.calculation.savedExactDisplay = false;
    if (failure === 'routing') f.live.row.cable.routing = '/MANUAL';
    if (failure === 'length') f.live.row.cable.designLength = '8';
    if (failure === 'parent-failed') Object.assign(f.parent, { status: 'failed' });
    if (failure === 'parent-cancelled') f.parent.cancelRequested = true;
    if (failure === 'proposal-hash') f.live.row.calculation.proposalHash = 'f'.repeat(64);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(f.pf.readProposal).toHaveBeenCalled()); await act(async () => {});
    expect(changed.mock.calls.at(-1)?.[0].ready).toBe(false); expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('revalidates a stored result under its recorded policy when the opening list hint reports changed currentness', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    const hint = { ...f.selection, calculation: { ...f.selection.calculation, currentness: 'changed' as const, reviewable: false } };
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={hint} accountId={id(2)} options={options}
      readPreferences={{ secondaryDistanceMeters: 17, preferVerticalApproach: false }} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, routing: '/BC1', designLength: '7' }));
    expect(changed.mock.calls.at(-1)?.[0].verifiedRow).toBe(f.live.row);
    expect(changed.mock.calls.at(-1)?.[0].verifiedScope).toBe(pathFinderWorkflowDisplayScope(asPf(f.pf), id(2)));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledExactlyOnceWith(id(1), 'current-private-token', id(4), f.proposal.routingPreferences, expect.any(AbortSignal));
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('keeps a stored result unavailable when its recorded-policy current proof is still changed', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.live.row.calculation = { ...f.live.row.calculation, currentness: 'changed', reviewable: false };
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    await act(async () => {});
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, routing: null, designLength: null, verifiedRow: null, verifiedScope: null });
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('starts endpoint foreground reads after the exact proposal arrives while current cable proof is still loading', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let finish!: (value: ReturnType<typeof liveCableDetail>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      workflowCalculationPreferences={{ cableId: id(4), jobId: id(7), preferences: options }} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(proposalEndpointObjectIds).toHaveBeenCalledOnce());
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, routing: null });
    await act(async () => finish(f.live));
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, routing: '/BC1' }));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(proposalEndpointObjectIds).toHaveBeenCalledOnce();
  });
  it('keeps the checked own result ready when a background state read only catches up to its already verified cable revision', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.proposal.stale = true; f.proposal.canApply = false;
    f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7', cableWriteRevision: '10' };
    f.live.row.calculation = { ...f.live.row.calculation, reviewable: false, acceptedMatchesCurrent: true };
    const props = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.live.row, accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...props} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    const reads = [f.pf.readProposal.mock.calls.length, f.pf.readJob.mock.calls.length, vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls.length];
    const caughtUp = { ...f.pf, data: { ...f.pf.data, cables: f.pf.data.cables.map(cable => ({ ...cable, cableWriteRevision: '10' })) } };
    view.rerender(<PathFinderResults {...props} pf={asPf(caughtUp)} />);
    await act(async () => {});
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, routing: '/BC1', verifiedRow: f.live.row });
    expect([f.pf.readProposal.mock.calls.length, f.pf.readJob.mock.calls.length, vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls.length]).toEqual(reads);
  });
  it.each(['generation', 'registry', 'settings', 'token', 'account'] as const)('immediately retires an emitted fresh row when its %s scope changes', async field => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    const props = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection, accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...props} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    f.pf.readProposal.mockImplementation(() => new Promise(() => {}));
    const next = { ...asPf(f.pf), preparationAccess: { ...asPf(f.pf).preparationAccess }, data: { ...asPf(f.pf).data! } };
    if (field === 'generation') next.preparationViewerGeneration = 2;
    if (field === 'registry') next.data.registryRevision = '2';
    if (field === 'settings') next.data.settings = { ...next.data.settings, revision: '2' };
    if (field === 'token') next.preparationAccess.token = 'another-current-token';
    const nextAccountId = field === 'account' ? id(99) : props.accountId;
    if (field === 'account') {
      expect(next.preparationAccess.token).toBe(f.pf.preparationAccess.token);
      expect(pathFinderWorkflowDisplayScope(next, nextAccountId)).not.toBe(pathFinderWorkflowDisplayScope(asPf(f.pf), props.accountId));
    }
    view.rerender(<PathFinderResults {...props} pf={next} accountId={nextAccountId} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, routing: null, verifiedRow: null, verifiedScope: null }));
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('keeps a receipt-proven own-write result displayable after its cable revision advances without renewing Review or Apply', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), review = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    f.proposal.stale = true; f.proposal.canApply = false;
    f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7.000', cableWriteRevision: '10' };
    f.live.row.calculation = { ...f.live.row.calculation, reviewable: false, acceptedMatchesCurrent: true };
    f.pf.data.cables[0].cableWriteRevision = '10';
    const props = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.live.row, accountId: id(2), options,
      onWorkflowDisplayChange: changed, onWorkflowReviewChange: review };
    const view = render(<PathFinderResults {...props} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false, jobId: id(7), proposalId: id(3), routing: '/BC1', designLength: '7' }));
    expect(review.mock.calls.at(-1)?.[0]).toMatchObject({ canReview: false, canApply: false, message: expect.stringContaining('already saved in Cable list') });
    view.rerender(<PathFinderResults {...props} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
    expect(review.mock.calls.at(-1)?.[0]).toMatchObject({ canReview: false, canApply: false });
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['queued', 'running'] as const)('hydrates an accepted own-write path while siblings remain %s without borrowing item review authority', async status => {
    const f = workflowFixture('running'), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), review = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    f.proposal.stale = true; f.proposal.canApply = false; f.proposal.itemApplicability = null;
    f.pf.readJob.mockResolvedValue({ ...f.parent, status });
    f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7.000', cableWriteRevision: '10' };
    f.live.row.calculation = { ...f.live.row.calculation, jobStatus: status, reviewable: false, acceptedMatchesCurrent: true, itemApplicability: null };
    f.pf.data.cables[0].cableWriteRevision = '10';
    const props = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.live.row, accountId: id(2), options,
      onWorkflowDisplayChange: changed, onWorkflowReviewChange: review };
    const view = render(<PathFinderResults {...props} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false, routing: '/BC1' }));
    expect(review.mock.calls.at(-1)?.[0]).toMatchObject({ canReview: false, canApply: false });
    view.rerender(<PathFinderResults {...props} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('keeps the accepted own-write path ready and visible when background siblings finish without item review authority', async () => {
    const f = workflowFixture('running'), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.proposal.stale = true; f.proposal.canApply = false; f.proposal.itemApplicability = null;
    f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7.000', cableWriteRevision: '10' };
    f.live.row.calculation = { ...f.live.row.calculation, jobStatus: 'running', reviewable: false, acceptedMatchesCurrent: true, itemApplicability: null };
    f.pf.data.cables[0].cableWriteRevision = '10';
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.live.row, accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    const shown = { cableId: id(4), requestId: 1, action: 'show' as const };
    view.rerender(<PathFinderResults {...p} workflowDisplayRequest={shown} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].visible).toBe(true));
    const reads = [f.pf.readProposal.mock.calls.length, f.pf.readJob.mock.calls.length, vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls.length];
    f.pf.readProposal.mockImplementation(() => new Promise(() => {})); f.pf.readJob.mockImplementation(() => new Promise(() => {}));
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(() => new Promise(() => {}));
    const completed = { ...f.live.row, calculation: { ...f.live.row.calculation, jobStatus: 'complete' as const } };
    const pf = { ...f.pf, data: { ...f.pf.data, jobs: [{ ...f.parent, status: 'complete' as const, completed: 13, total: 13 }] } };
    view.rerender(<PathFinderResults {...p} pf={asPf(pf)} workflowSelection={completed} workflowDisplayRequest={shown} />);
    await act(async () => {});
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: true, routing: '/BC1', designLength: '7' });
    expect([f.pf.readProposal.mock.calls.length, f.pf.readJob.mock.calls.length, vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls.length]).toEqual(reads);
    expect(f.pf.showPath).toHaveBeenCalledOnce(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('reopens a persisted manual-protected result under its recorded policy while new-calculation configuration is unavailable', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), review = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    const genericReadPreferences = { secondaryDistanceMeters: 17, preferVerticalApproach: false };
    const props = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection, accountId: id(2), options: null,
      readPreferences: genericReadPreferences, workflowConfigurationReady: false, onWorkflowDisplayChange: changed, onWorkflowReviewChange: review };
    const view = render(<PathFinderResults {...props} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false, routing: '/BC1', designLength: '7' }));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledExactlyOnceWith(id(1), 'current-private-token', id(4), f.proposal.routingPreferences, expect.any(AbortSignal));
    expect(review.mock.calls.at(-1)?.[0]).toMatchObject({ canReview: false, canApply: false });
    view.rerender(<PathFinderResults {...props} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.calculate).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['routing', 'length', 'cancelled', 'failed'] as const)('does not use an accepted receipt as display readiness when its current %s proof differs', async changedField => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.proposal.stale = true; f.proposal.canApply = false;
    f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7', cableWriteRevision: '10' };
    f.live.row.calculation = { ...f.live.row.calculation, reviewable: false, acceptedMatchesCurrent: true };
    if (changedField === 'routing') f.live.row.cable.routing = '/OTHER';
    if (changedField === 'length') f.live.row.cable.designLength = '8';
    if (changedField === 'cancelled' || changedField === 'failed') f.pf.readJob.mockResolvedValue({ ...f.parent, status: changedField, cancelRequested: changedField === 'cancelled' });
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.live.row} accountId={id(2)} options={options}
      onWorkflowDisplayChange={changed} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    await act(async () => {});
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false, routing: null });
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['complete', 'running'] as const)('reads the saved selected result concurrently under its immutable policy while the parent is %s', async status => {
    const f = workflowFixture(status), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let finish!: (value: PathFinderProposal) => void;
    f.pf.readProposal.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      workflowCalculationPreferences={{ cableId: id(4), jobId: id(7), preferences: options }} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(f.pf.readProposal).toHaveBeenCalledOnce());
    expect(f.pf.readJob).toHaveBeenCalledExactlyOnceWith(id(7), expect.any(AbortSignal));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledExactlyOnceWith(id(1), 'current-private-token', id(4), options, expect.any(AbortSignal));
    expect(changed.mock.calls.at(-1)?.[0].ready).toBe(false);
    await act(async () => finish(f.proposal));
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('keeps a checked selected path ready when background siblings finish and its item proof is replaced by whole-job completion', async () => {
    const f = workflowFixture('running'), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection, accountId: id(2), options,
      workflowCalculationPreferences: { cableId: id(4), jobId: id(7), preferences: options }, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    f.pf.readProposal.mockImplementation(() => new Promise(() => {}));
    f.pf.readJob.mockImplementation(() => new Promise(() => {}));
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(() => new Promise(() => {}));
    const completed = { ...f.selection, calculation: { ...f.selection.calculation, jobStatus: 'complete' as const, itemApplicability: null } };
    const pf = { ...f.pf, data: { ...f.pf.data, jobs: [{ ...f.parent, status: 'complete' as const, completed: 13, total: 13 }] } };
    view.rerender(<PathFinderResults {...p} pf={asPf(pf)} workflowSelection={completed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: true, routing: '/BC1' }));
    expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.readJob).toHaveBeenCalledOnce();
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it.each(['cancelled', 'failed'] as const)('revokes a checked selected display when background parent status becomes %s', async status => {
    const f = workflowFixture('running'), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection, accountId: id(2), options,
      workflowCalculationPreferences: { cableId: id(4), jobId: id(7), preferences: options }, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    f.pf.readJob.mockResolvedValue({ ...f.parent, status });
    const stopped = { ...f.selection, calculation: { ...f.selection.calculation, jobStatus: status, reviewable: false } };
    view.rerender(<PathFinderResults {...p} workflowSelection={stopped}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.readJob.mock.calls.length).toBeGreaterThan(1));
    await act(async () => {});
    expect(changed.mock.calls.at(-1)?.[0].ready).toBe(false);
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each([{ status: 'cancelled', cancelRequested: false }, { status: 'failed', cancelRequested: false },
    { status: 'running', cancelRequested: true }] as const)('revokes cached Show on a fresh exact-job stop while the selected row lags (%j)', async stop => {
    const f = workflowFixture('running'), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection, accountId: id(2), options,
      workflowCalculationPreferences: { cableId: id(4), jobId: id(7), preferences: options }, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    view.rerender(<PathFinderResults {...p} pf={asPf({ ...f.pf, data: { ...f.pf.data, jobs: [{ ...f.parent, ...stop }] } })}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await act(async () => {});
    expect(changed.mock.calls.at(-1)?.[0].ready).toBe(false);
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.readJob).toHaveBeenCalledOnce();
    expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('makes the exact new route ready while optional endpoint foreground is still loading', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let finish!: (ids: string[]) => void;
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(proposalEndpointObjectIds).toHaveBeenCalledOnce());
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false, routing: '/BC1', designLength: '7' });
    expect(f.live.row.cable.routing).toBe('/LIVE-CURRENT');
    expect(f.pf.showPath).not.toHaveBeenCalled();
    await act(async () => finish(['dbid:44', 'dbid:45']));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ cableId: id(4), jobId: id(7), proposalId: id(3), proposalHash: f.proposal.proposalHash,
      ready: true, visible: false, routing: '/BC1', designLength: '7', source: 'current-calculation', verifiedRow: f.live.row, verifiedScope: pathFinderWorkflowDisplayScope(asPf(f.pf), id(2)) }));
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('keeps selected route hydration alive when viewer ownership is released before its live proof arrives', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let finish!: (value: typeof f.live) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise(() => {}));
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
      accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} displayOwned />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    view.rerender(<PathFinderResults {...p} displayOwned={false} />);
    await act(async () => finish(f.live));
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false, routing: '/BC1' }));
    view.rerender(<PathFinderResults {...p} displayOwned={false} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
    expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.readJob).toHaveBeenCalledOnce();
    expect(f.pf.refresh).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('shows the calculated route after viewer ownership changes while endpoint highlighting is delayed', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let finish!: (ids: string[]) => void;
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
      accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} displayOwned />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ routing: '/BC1' }));
    view.rerender(<PathFinderResults {...p} displayOwned={false} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    view.rerender(<PathFinderResults {...p} displayOwned workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
    await act(async () => finish(['dbid:44', 'dbid:45']));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenLastCalledWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(f.pf.showPath).toHaveBeenCalledTimes(2);
    expect(f.pf.refresh).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('includes endpoint foreground already available before an initially requested Show is verified', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let finishProof!: (value: typeof f.live) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finishProof = resolve; }));
    vi.mocked(proposalEndpointObjectIds).mockResolvedValueOnce(['dbid:44', 'dbid:45']);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(proposalEndpointObjectIds).toHaveBeenCalledOnce());
    await act(async () => finishProof(f.live));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: true });
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['initial', 'cached'] as const)('serializes late endpoint foreground behind a pending %s Show', async start => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let finishEndpoints!: (ids: string[]) => void, finishShow!: (shown: boolean) => void;
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise(resolve => { finishEndpoints = resolve; }));
    f.pf.showPath.mockImplementationOnce(() => new Promise(resolve => { finishShow = resolve; }));
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
      accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} workflowDisplayRequest={start === 'initial' ? { cableId: id(4), requestId: 0, action: 'show' } : null} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    if (start === 'cached') view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
    await act(async () => finishEndpoints(['dbid:44', 'dbid:45']));
    expect(f.pf.showPath).toHaveBeenCalledOnce();
    await act(async () => finishShow(true));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenLastCalledWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(f.pf.showPath).toHaveBeenCalledTimes(2);
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: true });
    expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.readJob).toHaveBeenCalledOnce();
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    expect(f.pf.refresh).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('retains late endpoint foreground while hidden and includes it in the next Show without re-reading', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let finishEndpoints!: (ids: string[]) => void;
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise(resolve => { finishEndpoints = resolve; }));
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
      accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 2, action: 'hide' }} />);
    await act(async () => finishEndpoints(['dbid:44', 'dbid:45']));
    expect(f.pf.showPath).toHaveBeenCalledOnce();
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false });
    view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 3, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenLastCalledWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(f.pf.showPath).toHaveBeenCalledTimes(2);
    expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.readJob).toHaveBeenCalledOnce(); expect(proposalEndpointObjectIds).toHaveBeenCalledOnce();
    expect(f.pf.refresh).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('does not reclaim viewer ownership when endpoint foreground arrives after another presentation takes over', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let finishEndpoints!: (ids: string[]) => void, ownsViewer = true;
    const claimViewer = vi.fn(() => () => ownsViewer);
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise(resolve => { finishEndpoints = resolve; }));
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
      accountId: id(2), options, onWorkflowDisplayChange: changed, claimViewer };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    ownsViewer = false;
    view.rerender(<PathFinderResults {...p} displayOwned={false} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await act(async () => finishEndpoints(['dbid:44', 'dbid:45']));
    expect(f.pf.showPath).toHaveBeenCalledOnce(); expect(claimViewer).toHaveBeenCalledOnce();
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false });
    ownsViewer = true;
    view.rerender(<PathFinderResults {...p} displayOwned workflowDisplayRequest={{ cableId: id(4), requestId: 2, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenLastCalledWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(claimViewer).toHaveBeenCalledTimes(2); expect(proposalEndpointObjectIds).toHaveBeenCalledOnce();
  });
  it('does not redraw a visible route when endpoint foreground adds no new objects', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let finishEndpoints!: (ids: string[]) => void;
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise(resolve => { finishEndpoints = resolve; }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    await act(async () => finishEndpoints(['dbid:23']));
    expect(f.pf.showPath).toHaveBeenCalledOnce();
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: true });
  });
  it.each([new DOMException('Endpoint display lookup timed out.', 'TimeoutError'), { status: 503 }])(
    'keeps the verified route ready when optional endpoint highlighting fails (%j)', async error => {
      const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
      let fail!: (error: unknown) => void;
      vi.mocked(proposalEndpointObjectIds).mockRejectedValue(error).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
      const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
        accountId: id(2), options, onWorkflowDisplayChange: changed };
      const view = render(<PathFinderResults {...p} />);
      await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
      await act(async () => fail(error));
      view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
      await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
      expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.readJob).toHaveBeenCalledOnce();
      await waitFor(() => expect(proposalEndpointObjectIds).toHaveBeenCalledTimes(3), { timeout: 2500 });
      expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
      expect(f.pf.refresh).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
    });
  it('retains bounded foreground recovery while hidden and enriches the next Show without another proof read', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let fail!: (error: unknown) => void;
    vi.mocked(proposalEndpointObjectIds).mockResolvedValue(['dbid:44', 'dbid:45'])
      .mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
      accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    try {
      await act(async () => fail({ status: 503 }));
      view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 2, action: 'hide' }} />);
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(proposalEndpointObjectIds).toHaveBeenCalledTimes(2); expect(f.pf.showPath).toHaveBeenCalledOnce();
      view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 3, action: 'show' }} />);
      await act(async () => {});
      expect(f.pf.showPath).toHaveBeenLastCalledWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] });
      expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.readJob).toHaveBeenCalledOnce(); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
      expect(f.pf.refresh).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it.each(['selection', 'unmount'] as const)('cancels endpoint foreground backoff when %s retires its result', async change => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let fail!: (error: unknown) => void;
    vi.mocked(proposalEndpointObjectIds).mockRejectedValue({ status: 503 })
      .mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
      accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    vi.useFakeTimers();
    try {
      await act(async () => fail({ status: 503 }));
      if (change === 'unmount') view.unmount();
      else view.rerender(<PathFinderResults {...p} selectedCableId={null} workflowSelection={null} />);
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(proposalEndpointObjectIds).toHaveBeenCalledOnce(); expect(f.pf.showPath).not.toHaveBeenCalled();
      expect(f.pf.refresh).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('revokes endpoint foreground recovery immediately when a retry reports lost authority', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let fail!: (error: unknown) => void;
    vi.mocked(proposalEndpointObjectIds).mockRejectedValue({ status: 403 })
      .mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    vi.useFakeTimers();
    try {
      await act(async () => fail({ status: 503 }));
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(proposalEndpointObjectIds).toHaveBeenCalledTimes(2);
      expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false });
      expect(f.pf.refresh).toHaveBeenCalledOnce();
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(proposalEndpointObjectIds).toHaveBeenCalledTimes(2); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('revokes a ready route when the optional endpoint read reports lost administrator authority', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let fail!: (error: unknown) => void;
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
      accountId: id(2), options, onWorkflowDisplayChange: changed };
    render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    await act(async () => fail({ status: 403 }));
    await screen.findByText(/Current administrator access is required to inspect/);
    expect(changed.mock.calls.at(-1)?.[0].ready).toBe(false);
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.refresh).toHaveBeenCalledOnce(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it('never publishes Show readiness when endpoint authority was refused before the live route proof arrived', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let finishProof!: (value: typeof f.live) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finishProof = resolve; }));
    vi.mocked(proposalEndpointObjectIds).mockRejectedValueOnce({ status: 403 });
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(proposalEndpointObjectIds).toHaveBeenCalledOnce());
    await act(async () => finishProof(f.live));
    await screen.findByText(/Current administrator access is required to inspect/);
    expect(changed.mock.calls.some(([value]) => value.ready)).toBe(false);
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.refresh).toHaveBeenCalledOnce();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('revokes a pending initial Show immediately when late endpoint authority is refused', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let fail!: (error: unknown) => void, finishShow!: (shown: boolean) => void;
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    f.pf.showPath.mockImplementationOnce(() => new Promise(resolve => { finishShow = resolve; }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    await act(async () => fail({ status: 403 }));
    await screen.findByText(/Current administrator access is required to inspect/);
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false });
    expect(screen.queryByText('Loading the exact computed path…')).toBeNull(); expect(f.pf.clear).toHaveBeenCalledOnce();
    await act(async () => finishShow(true));
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false });
    expect(f.pf.refresh).toHaveBeenCalledOnce(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('cancels an in-flight cached Show and its loading state when optional endpoint authority is revoked', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let fail!: (error: unknown) => void, finishShow!: (shown: boolean) => void;
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    f.pf.showPath.mockImplementationOnce(() => new Promise(resolve => { finishShow = resolve; }));
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
      accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    await act(async () => fail({ status: 403 }));
    await screen.findByText(/Current administrator access is required to inspect/);
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false });
    expect(screen.queryByText('Loading the exact computed path…')).toBeNull();
    expect(f.pf.clear).toHaveBeenCalledOnce();
    await act(async () => finishShow(true));
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false });
    expect(f.pf.refresh).toHaveBeenCalledOnce(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['objects', 'authority refusal'] as const)('ignores late optional endpoint %s after the selected cable changes', async result => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let finish!: () => void;
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise((resolve, reject) => {
      finish = () => result === 'objects' ? resolve(['dbid:99']) : reject({ status: 403 });
    }));
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
      accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    view.rerender(<PathFinderResults {...p} selectedCableId={id(99)} workflowSelection={null} />);
    await act(async () => finish());
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false, routing: null });
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('keeps a complete 512-object route ready when optional endpoint highlighting would exceed the object budget', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.proposal.route!.objectIds = Array.from({ length: 512 }, (_, index) => `dbid:${index + 1}`);
    vi.mocked(proposalEndpointObjectIds).mockResolvedValue(['dbid:999']);
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
      accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points,
      objectIds: Array.from({ length: 512 }, (_, index) => index + 1) }));
  });
  it('retains the exact route object budget when the route itself contains more than 512 objects', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.proposal.route!.objectIds = Array.from({ length: 513 }, (_, index) => `dbid:${index + 1}`);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} />);
    await screen.findByText(/This exact path exceeds the viewer object budget/);
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, routing: null });
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each([{ status: 503, code: 'WORKFLOW_READ_TIMEOUT' }, { status: null, code: 'REQUEST_TIMEOUT' }])('automatically recovers a transient exact-result read without a refresh or another calculation (%j)', async error => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(error).mockResolvedValue(f.live);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} />);
    await screen.findByText(/Retrying the exact result automatically/);
    expect(changed.mock.calls.at(-1)?.[0].ready).toBe(false);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true), { timeout: 3000 });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(2);
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('recovers a temporarily unavailable proposal and checks it before enabling Show', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.pf.readProposal.mockResolvedValueOnce(null).mockResolvedValue(f.proposal);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} />);
    await screen.findByText(/Retrying the exact result automatically/);
    expect(changed.mock.calls.at(-1)?.[0].ready).toBe(false);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true), { timeout: 3000 });
    expect(f.pf.readProposal).toHaveBeenCalledTimes(2); expect(proposalEndpointObjectIds).toHaveBeenCalledOnce();
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['unavailable proof', 'earlier tuple'] as const)('rechecks a successful but temporarily inconsistent %s read before publishing Show', async kind => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    const earlier = structuredClone(f.live);
    earlier.row.calculation = { ...earlier.row.calculation, currentness: 'unavailable', reviewable: false, acceptedMatchesCurrent: false,
      ...(kind === 'earlier tuple' ? { jobId: id(88), proposalId: id(89), proposalHash: 'e'.repeat(64) } : {}) };
    let finish!: (value: PathFinderProposal) => void;
    f.pf.readProposal.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce(earlier).mockResolvedValue(f.live);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      workflowCalculationPreferences={{ cableId: id(4), jobId: id(7), preferences: options }} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    expect(changed.mock.calls.at(-1)?.[0].ready).toBe(false);
    await act(async () => finish(f.proposal));
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true), { timeout: 3000 });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(2); expect(changed.mock.calls.at(-1)?.[0].verifiedRow).toBe(f.live.row);
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('finishes an exhausted read check with a visible terminal reason instead of permanent loading', async () => {
    vi.useFakeTimers(); const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValue({ status: 503 });
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      onWorkflowDisplayChange={changed} />);
    await act(async () => {}); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(7);
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ cableId: id(4), jobId: id(7), proposalId: id(3), ready: false, checking: false,
      message: expect.stringContaining('after bounded automatic retries') });
    expect(screen.getByText(/after bounded automatic retries/)).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(7);
    expect(f.pf.refresh).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('aborts a hanging result GET at the overall 30-second deadline and publishes its terminal reason', async () => {
    vi.useFakeTimers(); const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(() => new Promise(() => {}));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      onWorkflowDisplayChange={changed} />);
    await act(async () => {}); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    const signal = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!;
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); }); expect(signal.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(signal.aborted).toBe(true);
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, checking: false, message: expect.stringContaining('within 30 seconds') });
    expect(screen.queryByText('Loading the exact computed path…')).toBeNull();
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each([401, 403])('stops bounded recovery immediately when a later read refuses administrator access with %s', async status => {
    vi.useFakeTimers(); const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce({ status: 503 }).mockRejectedValue({ status });
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      onWorkflowDisplayChange={changed} />);
    await act(async () => {}); await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(2); expect(f.pf.refresh).toHaveBeenCalledOnce();
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, checking: false, message: expect.stringContaining('administrator access') });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(2);
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each([401, 403])('does not lose an endpoint authority refusal with %s while the workflow read enters recovery', async status => {
    vi.useFakeTimers(); const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    let failEndpoints!: (error: unknown) => void;
    vi.mocked(proposalEndpointObjectIds).mockImplementationOnce(() => new Promise((_, reject) => { failEndpoints = reject; }));
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce({ status: 503 }).mockResolvedValue(f.live);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      onWorkflowDisplayChange={changed} />); await act(async () => {});
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, checking: true });
    await act(async () => failEndpoints({ status }));
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, checking: false, message: expect.stringContaining('administrator access') });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.refresh).toHaveBeenCalledOnce();
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['selection', 'unmount'] as const)('cancels pending result retries on %s changes', async change => {
    vi.useFakeTimers(); const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValue({ status: 503 });
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection, accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />); await act(async () => {});
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    if (change === 'unmount') view.unmount(); else view.rerender(<PathFinderResults {...p} selectedCableId={null} workflowSelection={null} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    expect(changed.mock.calls.some(([value]) => value.ready)).toBe(false);
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('clears the result deadline as soon as the route is checked while optional endpoint lookup is still pending', async () => {
    vi.useFakeTimers(); const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    vi.mocked(proposalEndpointObjectIds).mockImplementation(() => new Promise(() => {}));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      onWorkflowDisplayChange={changed} />); await act(async () => {});
    expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true); expect(f.pf.refresh).not.toHaveBeenCalled();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('shows the already checked exact route and both endpoints without repeating slow verification reads', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    vi.mocked(proposalEndpointObjectIds).mockResolvedValue(['dbid:44', 'dbid:45']);
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    f.pf.readProposal.mockImplementation(() => new Promise(() => {}));
    f.pf.readJob.mockImplementation(() => new Promise(() => {}));
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(() => new Promise(() => {}));
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23, 44, 45] }));
    expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.readJob).toHaveBeenCalledOnce();
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(proposalEndpointObjectIds).toHaveBeenCalledOnce();
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: true }));
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('does not retry a revoked administrator read or make it a verified display', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValue({ status: 403 });
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} />);
    await screen.findByText(/Current administrator access is required to inspect/);
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.refresh).toHaveBeenCalledOnce();
    expect(changed.mock.calls.at(-1)?.[0].ready).toBe(false); expect(f.pf.showPath).not.toHaveBeenCalled();
  });
  it('retires the checked Show payload when a newer cable revision is observed before the workflow row refreshes', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(() => new Promise(() => {}));
    const newer = { ...f.pf, data: { ...f.pf.data, cables: f.pf.data.cables.map(cable => cable.id === id(4) ? { ...cable, cableWriteRevision: '10' } : cable) } };
    view.rerender(<PathFinderResults pf={asPf(newer)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(false));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(2); expect(f.pf.showPath).not.toHaveBeenCalled();
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it('retires a completed display immediately while a newer result for the same cable is loading', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    const proposal: PathFinderProposal = { ...f.proposal, id: id(91), jobId: id(92), proposalHash: '9'.repeat(64),
      route: { ...f.proposal.route!, routeText: '/NEW-LOCATION' },
      revisionResult: { ...f.proposal.revisionResult!, id: id(93), admissionId: id(94), jobId: id(92), proposalId: id(91), proposalHash: '9'.repeat(64) } };
    const live = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, jobId: id(92), proposalId: id(91), proposalHash: '9'.repeat(64) } } };
    let finish!: (value: PathFinderProposal) => void;
    f.pf.readProposal.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.pf.readJob.mockResolvedValue({ ...f.parent, id: id(92) });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(live);
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={live.row}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} />);
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false, routing: null, designLength: null });
    await act(async () => finish(proposal));
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ jobId: id(92), proposalId: id(91), proposalHash: '9'.repeat(64), ready: true, routing: '/NEW-LOCATION' }));
    f.pf.readProposal.mockResolvedValue(proposal);
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={live.row}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledWith(expect.objectContaining({ pathId: id(91), points: proposal.route!.points })));
  });
  it('does not draw an earlier selected path after the live endpoint proof has changed', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    const live = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, currentness: 'changed' as const, reviewable: false } } };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(live);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await screen.findByText(/The current cable proof is unavailable or changed/);
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false, routing: null, designLength: null });
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(proposalEndpointObjectIds).toHaveBeenCalledOnce();
    expect(vi.mocked(proposalEndpointObjectIds).mock.calls[0][3]?.aborted).toBe(true);
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it('keeps the result unready when the foreground reader would see an earlier prepared artifact', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    // This deliberately incomplete dependency stub is refused before any
    // endpoint, renderer or write code can consume it as a complete result.
    f.proposal.dependencies = { projectId: id(1), model: { id: id(8), selectionRevision: '1', contentFingerprint: 'c'.repeat(64) },
      artifact: { id: id(90), sha256: 'd'.repeat(64) } } as NonNullable<PathFinderProposal['dependencies']>;
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await screen.findByText(/The model preparation for this result is still refreshing/);
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false, routing: null });
    expect(proposalEndpointObjectIds).not.toHaveBeenCalled(); expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('reads and reviews the acknowledged selected proposal with its immutable drilling policy while global manual preferences stay off', async () => {
    const f = workflowFixture(), recorded = barrierFixtureFacts(true), manual = barrierFixtureFacts(false).preferences;
    f.proposal.routingPreferences = recorded.preferences; f.proposal.barriers = recorded.barriers; f.proposal.provenance!.engineIdentity = recorded.engineIdentity;
    const update = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={manual}
      workflowCalculationPreferences={{ cableId: id(4), jobId: id(7), preferences: recorded.preferences }} onWorkflowReviewChange={update}
      workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledWith(id(1), 'current-private-token', id(4), recorded.preferences, expect.any(AbortSignal));
    expect(screen.getByText(/Calculation policy: Drill through the walls enabled/)).toBeInTheDocument();
    expect(f.proposal.routingPreferences.barrierRouting?.drillThroughWalls).toBe(true); expect(manual.barrierRouting?.drillThroughWalls).toBe(false);
    await waitFor(() => expect(update.mock.calls.at(-1)?.[0]).toMatchObject({ canReview: true, recordedDrillThroughWalls: true }));
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('requires a currently available popup configuration before an acknowledged policy can replace null manual options', async () => {
    const f = workflowFixture(), recorded = barrierFixtureFacts(true), update = vi.fn<(value: PathFinderWorkflowReview | null) => void>(), committed = vi.fn();
    f.proposal.routingPreferences = recorded.preferences; f.proposal.barriers = recorded.barriers; f.proposal.provenance!.engineIdentity = recorded.engineIdentity;
    const props = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection, accountId: id(2), options: null,
      readPreferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true },
      workflowCalculationPreferences: { cableId: id(4), jobId: id(7), preferences: recorded.preferences },
      onWorkflowReviewChange: update, onCalculationCommitted: committed,
      workflowDisplayRequest: { cableId: id(4), requestId: 0, action: 'show' as const } };
    const view = render(<PathFinderResults {...props} workflowConfigurationReady={false} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled());
    expect(committed).not.toHaveBeenCalled();
    view.rerender(<PathFinderResults {...props} workflowConfigurationReady />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    const staleReview = update.mock.calls.at(-1)?.[0]?.review;
    view.rerender(<PathFinderResults {...props} workflowConfigurationReady={false} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled());
    act(() => staleReview?.());
    expect(update.mock.calls.at(-1)?.[0]?.canReview).toBe(false); expect(update.mock.calls.at(-1)?.[0]?.canApply).toBe(false);
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it('refuses a selected job whose recorded policy differs from the positively acknowledged request snapshot', async () => {
    const f = workflowFixture(), recorded = barrierFixtureFacts(true), manual = barrierFixtureFacts(false).preferences;
    const changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.proposal.routingPreferences = recorded.preferences; f.proposal.barriers = recorded.barriers;
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={manual}
      workflowCalculationPreferences={{ cableId: id(4), jobId: id(7), preferences: manual }}
      workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(screen.getByText(/calculation changed or could not be verified/)).toBeVisible());
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledExactlyOnceWith(id(1), 'current-private-token', id(4), manual, expect.any(AbortSignal));
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false, routing: null });
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('reports a selected display-only comparison as loading while its exact live read is pending', async () => {
    const f = workflowFixture(), update = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    let finish!: (value: typeof f.live) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const popup = () => update.mock.calls.at(-1)?.[0];
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={null} readPreferences={{ secondaryDistanceMeters: 2, preferVerticalApproach: true }} onWorkflowReviewChange={update} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    expect(popup()?.comparisonLoading).toBe(true); expect(popup()?.comparison).toBeNull(); expect(popup()?.comparisonError).toBeNull();
    expect(popup()?.canReview).toBe(false); expect(popup()?.canApply).toBe(false);
    await act(async () => finish(f.live));
    await waitFor(() => expect(popup()?.comparisonLoading).toBe(false));
    expect(popup()?.comparison?.current.cable.routing).toBe('/LIVE-CURRENT');
    // Even an optimistic display-only response cannot replace the missing
    // protected calculation preferences as authority for a new write.
    expect(f.live.row.calculation.reviewable).toBe(true);
    expect(popup()?.canReview).toBe(false); expect(popup()?.canApply).toBe(false);
    await act(async () => { popup()!.review(); popup()!.apply(); });
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); view.unmount();
  });
  it('compares the exact selected proposal with live values while protected calculation preferences are unavailable', async () => {
    const f = workflowFixture(), update = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    const readPreferences = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
    const live = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, currentness: 'unavailable' as const, reviewable: false } } };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(live);
    const popup = () => update.mock.calls.at(-1)?.[0];
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={null} readPreferences={readPreferences} onWorkflowReviewChange={update} />);
    await waitFor(() => expect(popup()?.comparison?.current.cable.routing).toBe('/LIVE-CURRENT'));
    expect(popup()?.comparison?.proposal).toMatchObject({ proposalId: f.proposal.id, routing: '/BC1', designLength: '7' });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledWith(id(1), 'current-private-token', id(4), f.proposal.routingPreferences, expect.any(AbortSignal));
    expect(popup()?.canReview).toBe(false); expect(popup()?.canApply).toBe(false);
    await act(async () => { popup()!.review(); popup()!.apply(); });
    expect(screen.getByRole('button', { name: 'Calculate non-MV cables' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Calculate selected cable' })).toBeDisabled();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
    expect(f.pf.showPath).not.toHaveBeenCalled();
  });
  it('requests one ordinary Cable projection read for a current sealed v8 item while unrelated siblings run without Review, Apply or Viewer changes', async () => {
    const f = workflowFixture('running'), changed = vi.fn(), claimViewer = vi.fn(() => () => true);
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} displayOwned={false} claimViewer={claimViewer} onCalculationCommitted={changed} />);
    await waitFor(() => expect(changed).toHaveBeenCalledExactlyOnceWith({ projectId: id(1), cableId: id(4), jobId: id(7),
      proposalId: id(3), proposalHash: f.proposal.proposalHash, revisionResultHash: f.proposal.revisionResultHash, dependencyHash: 'c'.repeat(64) }));
    view.rerender(<PathFinderResults pf={asPf({ ...f.pf, data: { ...f.pf.data, jobs: [{ ...f.parent, completed: 20 }] } })}
      selectedCableId={id(4)} workflowSelection={{ ...f.selection }} accountId={id(2)} options={options} displayOwned={false}
      claimViewer={claimViewer} onCalculationCommitted={changed} />);
    await act(async () => {});
    expect(changed).toHaveBeenCalledOnce(); expect(f.pf.refresh).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(claimViewer).not.toHaveBeenCalled();
  });
  it('does not request an Auto projection refresh for a selected item whose authoritative currentness changed', async () => {
    const f = workflowFixture('running'), changed = vi.fn();
    const selection = { ...f.selection, calculation: { ...f.selection.calculation, currentness: 'changed' as const, reviewable: false } };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ ...f.live, row: selection });
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={selection}
      accountId={id(2)} options={options} displayOwned={false} onCalculationCommitted={changed} />);
    await screen.findByText(/The current cable proof is unavailable or changed/);
    expect(changed).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
  });
  it('reads selected cable metadata and refreshed progress without claiming the viewer or making the model Ghost', async () => {
    const f = workflowFixture(), claimViewer = vi.fn(() => () => true), changed = vi.fn();
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} claimViewer={claimViewer} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Current and proposed cable values' })).toHaveTextContent('/LIVE-CURRENT'));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ cableId: id(4), jobId: id(7), proposalId: id(3), proposalHash: f.proposal.proposalHash,
      ready: true, visible: false, routing: '/BC1', designLength: '7', source: 'current-calculation', verifiedRow: f.live.row, verifiedScope: pathFinderWorkflowDisplayScope(asPf(f.pf), id(2)) }));
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    const updated = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, currentness: 'changed' as const, reviewable: false } } };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(updated);
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={updated.row}
      accountId={id(2)} options={options} claimViewer={claimViewer} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(f.pf.readProposal).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Current and proposed cable values' })).toHaveTextContent('/LIVE-CURRENT'));
    expect(claimViewer).not.toHaveBeenCalled(); expect(proposalEndpointObjectIds).toHaveBeenCalledTimes(2);
    expect(vi.mocked(proposalEndpointObjectIds).mock.calls[1][3]?.aborted).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ ready: false, visible: false, routing: null, designLength: null }));
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.clear).not.toHaveBeenCalled();
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it('shows a selected result only after its explicit Reopen action', async () => {
    const f = workflowFixture(), claimViewer = vi.fn(() => () => true);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} claimViewer={claimViewer} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reopen selected cable result' })).toBeEnabled());
    expect(claimViewer).not.toHaveBeenCalled(); expect(f.pf.showPath).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen selected cable result' }));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce()); expect(claimViewer).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled();
  });
  it('toggles the popup Show/Hide through the protected proposal display without changing cable values', async () => {
    const f = workflowFixture(), changed = vi.fn();
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} onWorkflowDisplayChange={changed} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    expect(changed).toHaveBeenLastCalledWith({ cableId: id(4), jobId: id(7), proposalId: id(3), proposalHash: f.proposal.proposalHash,
      ready: true, visible: true, routing: '/BC1', designLength: '7', source: 'current-calculation', verifiedRow: f.live.row, verifiedScope: pathFinderWorkflowDisplayScope(asPf(f.pf), id(2)) });
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} onWorkflowDisplayChange={changed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'hide' }} />);
    await waitFor(() => expect(f.pf.clear).toHaveBeenCalledOnce());
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ cableId: id(4), jobId: id(7), proposalId: id(3), proposalHash: f.proposal.proposalHash,
      ready: true, visible: false, routing: '/BC1', designLength: '7', source: 'current-calculation', verifiedRow: f.live.row, verifiedScope: pathFinderWorkflowDisplayScope(asPf(f.pf), id(2)) }));
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} onWorkflowDisplayChange={changed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 2, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledTimes(2));
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it('keeps a hidden route ready for Show when its individually finished job later completes other cables', async () => {
    const f = workflowFixture('running'), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: true }));
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'hide' }} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false }));
    const finished = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, jobStatus: 'complete' as const } } };
    f.pf.readJob.mockResolvedValue({ ...f.parent, status: 'complete' });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(finished);
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={finished.row}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'hide' }} />);
    await act(async () => {});
    expect(f.pf.readProposal).toHaveBeenCalledOnce();
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false });
    expect(f.pf.showPath).toHaveBeenCalledOnce();
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={finished.row}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed}
      workflowDisplayRequest={{ cableId: id(4), requestId: 2, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledTimes(2));
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it('shows the exact route on the first popup request when optional From/To highlighting times out', async () => {
    const f = workflowFixture(), changed = vi.fn();
    const timeout = new DOMException('Endpoint display lookup timed out.', 'TimeoutError');
    vi.mocked(proposalEndpointObjectIds).mockRejectedValueOnce(timeout);
    const request = { cableId: id(4), requestId: 0, action: 'show' as const };
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} workflowDisplayRequest={request} />);
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ cableId: id(4), jobId: id(7), proposalId: id(3), proposalHash: f.proposal.proposalHash,
      ready: true, visible: true, routing: '/BC1', designLength: '7', source: 'current-calculation', verifiedRow: f.live.row, verifiedScope: pathFinderWorkflowDisplayScope(asPf(f.pf), id(2)) }));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
    expect(proposalEndpointObjectIds).toHaveBeenCalledOnce(); expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.readJob).toHaveBeenCalledOnce();
    expect(f.pf.clear).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it('keeps a late pending preview hidden after the popup Hide request', async () => {
    const f = workflowFixture(); let resolve: (proposal: PathFinderProposal) => void = () => undefined;
    f.pf.readProposal.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(f.pf.readProposal).toHaveBeenCalledOnce());
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'hide' }} />);
    await act(async () => resolve(f.proposal));
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      workflowDisplayRequest={{ cableId: id(4), requestId: 2, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
  });
  it('keeps a newer completed proposal for the same cable hidden until a fresh explicit Show request', async () => {
    const f = workflowFixture(), hiddenRequest = { cableId: id(4), requestId: 1, action: 'hide' as const };
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={hiddenRequest} />);
    await waitFor(() => expect(f.pf.clear).toHaveBeenCalledOnce());
    const proposal: PathFinderProposal = { ...f.proposal, id: id(91), jobId: id(92), proposalHash: '9'.repeat(64), cableWriteRevision: '10',
      revisionResult: { ...f.proposal.revisionResult!, id: id(93), admissionId: id(94), jobId: id(92), proposalId: id(91), proposalHash: '9'.repeat(64) } };
    const live = { ...f.live, row: { ...f.live.row, cable: { ...f.live.row.cable, cableWriteRevision: '10' },
      calculation: { ...f.live.row.calculation, jobId: id(92), proposalId: id(91), proposalHash: '9'.repeat(64) } } };
    const next = { ...f.pf, data: { ...f.pf.data, cables: [{ ...f.pf.data.cables[0], cableWriteRevision: '10' }] } };
    f.pf.readProposal.mockResolvedValue(proposal); f.pf.readJob.mockResolvedValue({ ...f.parent, id: id(92) });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(live);
    // A cloned event object is not a new command; newer rows/progress likewise
    // cannot turn the explicit hidden intent back into an automatic preview.
    view.rerender(<PathFinderResults pf={asPf(next)} selectedCableId={id(4)} workflowSelection={live.row} accountId={id(2)} options={options} workflowDisplayRequest={{ ...hiddenRequest }} />);
    await act(async () => {});
    expect(f.pf.showPath).toHaveBeenCalledOnce(); expect(f.pf.readProposal).toHaveBeenCalledTimes(2); expect(f.pf.clear).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    const showRequest = { cableId: id(4), requestId: 2, action: 'show' as const };
    view.rerender(<PathFinderResults pf={asPf(next)} selectedCableId={id(4)} workflowSelection={live.row} accountId={id(2)} options={options} workflowDisplayRequest={showRequest} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledTimes(2));
    expect(f.pf.showPath).toHaveBeenLastCalledWith(expect.objectContaining({ pathId: proposal.id }));
    view.rerender(<PathFinderResults pf={asPf(next)} selectedCableId={id(4)} workflowSelection={{ ...live.row }} accountId={id(2)} options={options} workflowDisplayRequest={{ ...showRequest }} />);
    await act(async () => {}); expect(f.pf.showPath).toHaveBeenCalledTimes(2); expect(f.pf.readProposal).toHaveBeenCalledTimes(2);
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it('does not transfer an earlier Show to a new calculation returned after Save or progress refresh', async () => {
    const f = workflowFixture(), show = { cableId: id(4), requestId: 0, action: 'show' as const };
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} workflowDisplayRequest={show} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    const proposal: PathFinderProposal = { ...f.proposal, id: id(91), jobId: id(92), proposalHash: '9'.repeat(64),
      revisionResult: { ...f.proposal.revisionResult!, id: id(93), admissionId: id(94), jobId: id(92), proposalId: id(91), proposalHash: '9'.repeat(64) } };
    const live = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, jobId: id(92), proposalId: id(91), proposalHash: '9'.repeat(64) } } };
    f.pf.readProposal.mockResolvedValue(proposal); f.pf.readJob.mockResolvedValue({ ...f.parent, id: id(92) });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(live);
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={live.row}
      accountId={id(2)} options={options} workflowDisplayRequest={{ ...show }} />);
    await waitFor(() => expect(f.pf.readProposal).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Current and proposed cable values' })).toBeVisible());
    expect(f.pf.showPath).toHaveBeenCalledOnce(); expect(f.pf.clear).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={live.row}
      accountId={id(2)} options={options} workflowDisplayRequest={{ ...show, requestId: 1 }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledTimes(2));
    expect(f.pf.showPath).toHaveBeenLastCalledWith(expect.objectContaining({ pathId: proposal.id }));
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it.each(['complete', 'running'] as const)('opens the exact selected %s result outside the loaded history and recent proposals', async status => {
    const f = workflowFixture(status);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    expect(f.pf.readProposal).toHaveBeenCalledExactlyOnceWith(id(3), expect.any(AbortSignal)); expect(f.pf.readJob).toHaveBeenCalledExactlyOnceWith(id(7), expect.any(AbortSignal));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledExactlyOnceWith(id(1), 'current-private-token', id(4), options, expect.any(AbortSignal));
    expect(f.pf.showPath).toHaveBeenCalledWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] });
    expect(screen.getByRole('region', { name: 'Current and proposed cable values' })).toHaveTextContent('/LIVE-CURRENT');
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm proposal review' })); await waitFor(() => expect(f.pf.reviewProposal).toHaveBeenCalledWith(f.proposal));
  });
  it('keeps an unsealed legacy result in history instead of showing it as the ready selected route', async () => {
    const f = workflowFixture(); f.pf.readProposal.mockResolvedValue({ ...f.proposal, revisionResult: null });
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await screen.findByText(/no verifiable calculation admission/);
    expect(f.pf.showPath).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled(); expect(screen.getByText(/no verifiable calculation admission/)).toBeVisible();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it.each(['project', 'cable', 'job', 'hash', 'envelope'] as const)('refuses a selected result whose %s linkage changed', async field => {
    const f = workflowFixture(), detail = { ...f.proposal };
    if (field === 'project') detail.projectId = id(90); if (field === 'cable') detail.cableId = id(90); if (field === 'job') detail.jobId = id(90);
    if (field === 'hash') detail.proposalHash = 'f'.repeat(64); if (field === 'envelope') detail.revisionResult = { ...detail.revisionResult!, admissionId: id(90), jobId: id(90) };
    f.pf.readProposal.mockResolvedValue(detail);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(screen.getByText(/calculation changed or could not be verified/)).toBeVisible());
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['cancelled', 'unknown', 'stale'] as const)('does not borrow history readiness when the fresh selected proof is %s', async mode => {
    const f = workflowFixture();
    if (mode === 'cancelled') f.pf.readJob.mockResolvedValue({ ...f.parent, status: 'cancelled', cancelRequested: true });
    if (mode === 'unknown') f.pf.readJob.mockResolvedValue(null);
    if (mode === 'stale') { f.live.row.calculation.currentness = 'changed'; f.live.row.calculation.reviewable = false; }
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await screen.findByText(mode === 'stale' ? /The current cable proof is unavailable or changed/
      : mode === 'cancelled' ? /This calculation was cancelled or failed/ : /The exact calculation state is unavailable/);
    expect(f.pf.showPath).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it.each([false, true])('reopens the same selected cable after historical scope selection only for a fresh Show (previously displayed: %s)', async previouslyShown => {
    const f = workflowFixture(), claimViewer = vi.fn(() => () => true);
    const initialRequest = previouslyShown ? { cableId: id(4), requestId: 0, action: 'show' as const } : null;
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} claimViewer={claimViewer} workflowDisplayRequest={initialRequest} />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Current and proposed cable values' })).toBeVisible());
    if (previouslyShown) await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    else expect(f.pf.showPath).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Select another completed calculation' }));
    expect(screen.queryByRole('region', { name: 'Proposal review' })).not.toBeInTheDocument();
    // An unchanged target/list refresh must leave the historical choice alone.
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={{ ...f.selection }}
      accountId={id(2)} options={options} claimViewer={claimViewer} workflowDisplayRequest={initialRequest} />);
    await act(async () => {}); expect(f.pf.readProposal).toHaveBeenCalledOnce();
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} claimViewer={claimViewer}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledTimes(previouslyShown ? 2 : 1));
    expect(f.pf.readProposal).toHaveBeenCalledTimes(2); expect(f.pf.readJob).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled();
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it('does not reopen a selected hint when an explicit historical scope supersedes it', async () => {
    const f = workflowFixture(), view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Select another completed calculation' }));
    expect(screen.queryByRole('region', { name: 'Proposal review' })).not.toBeInTheDocument();
    view.rerender(<PathFinderResults pf={asPf({ ...f.pf, data: { ...f.pf.data, jobs: [] } })} selectedCableId={id(4)} workflowSelection={{ ...f.selection }} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await act(async () => {}); expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.showPath).toHaveBeenCalledOnce();
  });
  it('rechecks the same legacy proposal when bounded cable progress observes its parent complete', async () => {
    const f = workflowFixture(), running = { ...f.parent, status: 'running' as const, completed: 1 };
    const preview = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, jobStatus: 'running' as const, reviewable: false } } };
    f.pf.readJob.mockResolvedValueOnce(running).mockResolvedValue(f.parent);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce(preview).mockResolvedValue(f.live);
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={preview.row} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await screen.findByText(/The current cable proof is unavailable or changed/);
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    expect(f.pf.showPath).toHaveBeenCalledOnce();
    expect(f.pf.readJob.mock.calls).toEqual([[id(7), expect.any(AbortSignal)], [id(7), expect.any(AbortSignal)]]); expect(f.pf.readProposal.mock.calls).toEqual([[id(3), expect.any(AbortSignal)], [id(3), expect.any(AbortSignal)]]);
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('keeps explicit history selection in control when bounded progress changes the same external result readiness', async () => {
    const f = workflowFixture(), running = { ...f.parent, status: 'running' as const, completed: 1 };
    const preview = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, jobStatus: 'running' as const, reviewable: false } } };
    f.pf.readJob.mockResolvedValue(running); vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(preview);
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={preview.row} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await screen.findByText(/The current cable proof is unavailable or changed/);
    expect(f.pf.showPath).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Select another completed calculation' }));
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await act(async () => {}); expect(f.pf.readJob).toHaveBeenCalledOnce(); expect(f.pf.readProposal).toHaveBeenCalledOnce(); expect(f.pf.showPath).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Proposal review' })).not.toBeInTheDocument();
  });
  it.each(['selection', 'account', 'model', 'history'] as const)('fences a late selected proposal after %s changes', async change => {
    const f = workflowFixture(); let finish!: (value: PathFinderProposal) => void;
    f.pf.readProposal.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    if (change === 'history') fireEvent.click(screen.getByRole('button', { name: 'Select another completed calculation' }));
    else if (change === 'selection') view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={null} workflowSelection={null} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    else if (change === 'account') view.rerender(<PathFinderResults pf={asPf({ ...f.pf, preparationAccess: { ...f.pf.preparationAccess, isAdmin: false } })} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(20)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    else view.rerender(<PathFinderResults pf={asPf({ ...f.pf, data: { ...f.pf.data, activeModel: { ...f.pf.data.activeModel, selectionRevision: '2' } } })} selectedCableId={id(4)} workflowSelection={null} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
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
  it('reads a historical comparison independently of missing calculation admission without authorizing a fresh write', async () => {
    const f = recoveryFixture(), readPreferences = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={null} readPreferences={readPreferences} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(await screen.findByRole('region', { name: 'Current cable values' })).toHaveTextContent('/LIVE-CURRENT');
    expect(screen.getByRole('region', { name: 'Proposed cable values' })).toHaveTextContent('/BC1');
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledWith(id(1), 'current-private-token', id(4), readPreferences, expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it.each([403, 409])('keeps a failed display-only comparison distinct from empty cable values (%s)', async status => {
    const f = recoveryFixture(), readPreferences = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(Object.assign(new Error('Private cable values'), { status }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={null} readPreferences={readPreferences} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(await screen.findByText(/Live cable comparison is unavailable/)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Current cable values' })).toBeNull();
    expect(screen.queryByText(/Both current fields are empty/)).toBeNull(); expect(screen.queryByText('Private cable values')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it('keeps preview and unrelated controls available while the independent live comparison is slow', async () => {
    const f = recoveryFixture(); vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(() => undefined));
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(screen.getByText('Reading live cable values for comparison…')).toBeVisible(); expect(screen.getByRole('button', { name: 'Calculate non-MV cables' })).toBeEnabled();
    expect(f.pf.clear).not.toHaveBeenCalled(); expect(f.pf.cancelOperation).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
    const signal = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!; view.unmount(); expect(signal.aborted).toBe(true);
  });
  it('blocks new approval when live comparison is unavailable without disposing the Viewer or inventing blank values', async () => {
    const f = recoveryFixture(); vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(Object.assign(new Error('Private old cable names'), { status: 403 }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(await screen.findByText(/Live cable comparison is unavailable/)).toBeVisible();
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Current cable values' })).toBeNull(); expect(screen.queryByText(/Both current fields are empty/)).toBeNull();
    expect(screen.queryByText('Private old cable names')).toBeNull(); expect(f.pf.clear).not.toHaveBeenCalled(); expect(f.pf.cancelOperation).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['account', 'model', 'options', 'read preferences', 'cable', 'scope'] as const)('aborts and ignores late live comparison after a %s change', async change => {
    const f = recoveryFixture(); let finish!: (value: ReturnType<typeof liveCableDetail>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' })); await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    const signal = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!;
    if (change === 'scope') fireEvent.click(screen.getByRole('button', { name: 'Select another completed calculation' }));
    else view.rerender(<PathFinderResults pf={asPf(change === 'model' ? { ...f.pf, data: { ...f.pf.data, activeModel: { modelVersionId: id(20), selectionRevision: '2' } } } : f.pf)}
      selectedCableId={change === 'cable' ? id(30) : id(4)} accountId={change === 'account' ? id(21) : id(2)} options={change === 'options' ? { ...options, secondaryDistanceMeters: 3 } : options}
      readPreferences={change === 'read preferences' ? { secondaryDistanceMeters: 3, preferVerticalApproach: true } : undefined} />);
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
  it('keeps new review blocked while its comparison is pending and after it proves an intervening write', async () => {
    const f = recoveryFixture(); let finish!: (value: ReturnType<typeof liveCableDetail>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    const live = liveCableDetail(); live.row.cable.cableWriteRevision = '10'; await act(async () => { finish(live); });
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed result' })); expect(f.pf.action).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Calculate non-MV cables' })).toBeEnabled(); expect(f.pf.clear).not.toHaveBeenCalled(); expect(f.pf.cancelOperation).not.toHaveBeenCalled();
  });
  it.each(['running', 'complete'] as const)('keeps a historical individually sealed v7 result inspectable but ineligible for a new review when the parent is %s', async status => {
    const { f } = sealedFixture();
    mockScope.initial = { ...mockScope.initial!, jobStatus: status, ready: status === 'complete', wholeJobReady: status === 'complete' };
    render(<PathFinderResults pf={asPf({ ...f.pf, data: { ...f.pf.data, proposals: [] } })} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByText('Calculation provenance'));
    expect(screen.getByText(/Shared location calculation\. An individually sealed cable result is recorded/)).toBeVisible();
    expect(screen.queryByText(/Automatic generation:/)).toBeNull();
    expect(screen.getByText(/This historical or unchecked result can be inspected/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm proposal review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed result' }));
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('reviews an exact sealed v8/v2 cable result while sibling cables remain running, retaining its barrier outcome', async () => {
    const { pf, proposal, preferences } = barrierSealedFixture();
    render(<PathFinderResults pf={asPf(pf)} selectedCableId={id(4)} accountId={id(2)} options={preferences} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
    expect(within(screen.getByRole('region', { name: 'Barrier routing result' })).getByText('No barriers declared for this calculation')).toBeVisible();
    fireEvent.click(screen.getByText('Calculation provenance'));
    expect(screen.getByText(/Shared location calculation\. An individually sealed cable result is recorded/)).toBeVisible();
    expect(pf.reviewProposal).not.toHaveBeenCalled(); expect(pf.action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm proposal review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
    expect(pf.reviewProposal).toHaveBeenCalledExactlyOnceWith(proposal);
    expect(pf.action).not.toHaveBeenCalled(); expect(pf.calculate).not.toHaveBeenCalled();
  });
  it.each([
    { label: 'v8 proposal with historical v1/v7 item', proposalVersion: 'pathfinder.dependencies.v8', schemaVersion: 'wfc.pf.sealed-cable-applicability.v1', itemVersion: 'pathfinder.dependencies.v7' },
    { label: 'v7 proposal with protected v2/v8 item', proposalVersion: 'pathfinder.dependencies.v7', schemaVersion: 'wfc.pf.sealed-cable-applicability.v2', itemVersion: 'pathfinder.dependencies.v8' },
    { label: 'v1 schema with v8 item dependency', proposalVersion: 'pathfinder.dependencies.v8', schemaVersion: 'wfc.pf.sealed-cable-applicability.v1', itemVersion: 'pathfinder.dependencies.v8' },
    { label: 'v2 schema with v7 item dependency', proposalVersion: 'pathfinder.dependencies.v8', schemaVersion: 'wfc.pf.sealed-cable-applicability.v2', itemVersion: 'pathfinder.dependencies.v7' },
  ] as const)('refuses crossed version authority: $label', async pair => {
    const { pf, proposal, preferences } = barrierSealedFixture();
    // Deliberately bypass the API decoder to exercise the component's own
    // applicability fence against malformed or crossed-version authority.
    pf.readProposal.mockResolvedValueOnce({ ...proposal,
      provenance: { ...proposal.provenance!, dependencyVersion: pair.proposalVersion },
      itemApplicability: { ...proposal.itemApplicability!, schemaVersion: pair.schemaVersion, dependencyVersion: pair.itemVersion },
    } as PathFinderProposal);
    render(<PathFinderResults pf={asPf(pf)} selectedCableId={id(4)} accountId={id(2)} options={preferences} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    await waitFor(() => expect(pf.showPath).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    expect(pf.reviewProposal).not.toHaveBeenCalled(); expect(pf.action).not.toHaveBeenCalled();
  });
  it.each(['model', 'content', 'selection', 'capture frame', 'frame digest', 'registry revision', 'snapshot', 'snapshot digest', 'scope mode', 'drilling'] as const)(
    'invalidates the reviewed v8 result when the full barrier intent changes: %s', async field => {
      const { pf, preferences } = barrierSealedFixture();
      const view = render(<PathFinderResults pf={asPf(pf)} selectedCableId={id(4)} accountId={id(2)} options={preferences} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Confirm proposal review' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeEnabled());
      const intent = structuredClone(preferences.barrierRouting!);
      if (field === 'model') intent.scope.modelVersionId = id(98);
      if (field === 'content') intent.scope.contentFingerprint = 'e'.repeat(64);
      if (field === 'selection') intent.scope.selectionRevision = '2';
      if (field === 'capture frame') intent.scope.captureFrameId = id(98);
      if (field === 'frame digest') intent.scope.captureFrameSha256 = 'e'.repeat(64);
      intent.expectedSnapshot!.scope = structuredClone(intent.scope);
      if (field === 'registry revision') { intent.expectedRegistryRevision = '2'; intent.expectedSnapshot!.registryRevision = '2'; }
      if (field === 'snapshot') intent.expectedSnapshot!.snapshotId = id(98);
      if (field === 'snapshot digest') intent.expectedSnapshot!.contentSha256 = 'e'.repeat(64);
      if (field === 'scope mode') intent.expectedSnapshot!.mode = 'mesh-set';
      if (field === 'drilling') intent.drillThroughWalls = true;
      const changed = { ...preferences, barrierRouting: barrierAdmissionIntentSchema.parse(intent) };
      view.rerender(<PathFinderResults pf={asPf(pf)} selectedCableId={id(4)} accountId={id(2)} options={changed} />);
      expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
      expect(screen.getByText(/This proposal uses different routing preferences/)).toBeVisible();
      expect(within(screen.getByRole('region', { name: 'Barrier routing result' })).getByText('Recorded barrier check is outdated')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed result' }));
      expect(pf.reviewProposal).toHaveBeenCalledOnce(); expect(pf.action).not.toHaveBeenCalled();
    });
  it('keeps manual drilling preferences separate from the drilling-disabled background enrollment', () => {
    const { pf, preferences } = barrierSealedFixture(true);
    const backgroundOptions = { ...preferences, barrierRouting: barrierAdmissionIntentSchema.parse({ ...preferences.barrierRouting!, drillThroughWalls: false }) };
    render(<PathFinderResults pf={asPf(pf)} selectedCableId={id(4)} accountId={id(2)} options={preferences} backgroundOptions={backgroundOptions} />);
    expect(recalculationCapture.preferences).toEqual(backgroundOptions);
    expect((recalculationCapture.preferences as PathFinderPreferences).barrierRouting?.drillThroughWalls).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Calculate selected cable' }));
    expect(pf.calculate).toHaveBeenCalledExactlyOnceWith([id(4)], true, preferences);
    expect(preferences.barrierRouting?.drillThroughWalls).toBe(true); expect(pf.action).not.toHaveBeenCalled();
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
      ...(issue === 'legacy dependency' ? { provenance: { ...proposal.provenance, dependencyVersion: 'pathfinder.dependencies.v6' as const } } : {}),
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
  it('offers a retry when an exact historical Show cannot check From/To instead of showing a route-only foreground', async () => {
    const f = recoveryFixture(); vi.mocked(proposalEndpointObjectIds).mockRejectedValueOnce(new TypeError('Network request failed.'));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} accountId={id(2)} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact proposal in Viewer' }));
    expect(await screen.findByText('The From/To objects could not be checked. Open the path again.')).toBeVisible();
    expect(proposalEndpointObjectIds).toHaveBeenCalledOnce();
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.clear).not.toHaveBeenCalled();
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm proposal review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply reviewed result' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open path again' })).toBeEnabled();
    expect(screen.queryByText('Loading the exact computed path…')).toBeNull();
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

  // This multi-render Fluent UI flow exceeded the default 5 s on both the
  // unchanged baseline and the fix; retain every assertion with a local budget.
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
  }, 10_000);

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
