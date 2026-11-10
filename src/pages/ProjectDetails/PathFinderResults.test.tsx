import { act, render as renderComponent, waitFor } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderResults, pathFinderWorkflowDisplayScope, type PathFinderWorkflowDisplay, type PathFinderWorkflowReview } from './PathFinderResults';
import type { usePathFinder } from './hooks/usePathFinder';
import { proposalEndpointObjectIds } from './pathFinderEndpointVisibility';
import { type PathFinderJob, type PathFinderPreferences, type PathFinderProposal } from '@/api/pathfinder';
import { fetchPathFinderCableWorkflowDetail } from '@/api/pathfinderCableWorkflow';
import { cableWorkflowDetailSchema } from '../../../shared/pathfinderCableWorkflowQueries';
import { revisionResultEnvelopeSchema } from '../../../shared/pathfinderRevisionResults';
import { barrierWriteEvidenceSchema } from '../../../shared/pathfinderBarrierWrites';
import { barrierCalculationFixture } from '@/test/pathfinderBarrierFixtures';
vi.mock('@/api/pathfinderCableWorkflow', () => ({ fetchPathFinderCableWorkflowDetail: vi.fn() }));
vi.mock('./pathFinderEndpointVisibility', async original => ({ ...await original<typeof import('./pathFinderEndpointVisibility')>(), proposalEndpointObjectIds: vi.fn(async () => [] as string[]) }));
let popup: PathFinderWorkflowReview | null = null;
let display: PathFinderWorkflowDisplay | null = null;
const observe = (node: ReactElement) => node.type === PathFinderResults ? cloneElement(node as ReactElement<Parameters<typeof PathFinderResults>[0]>, {
  onWorkflowReviewChange: value => { popup = value; (node.props as Parameters<typeof PathFinderResults>[0]).onWorkflowReviewChange?.(value); },
  onWorkflowDisplayChange: value => { display = value; (node.props as Parameters<typeof PathFinderResults>[0]).onWorkflowDisplayChange?.(value); },
}) : node;
function render(node: ReactElement) { const view = renderComponent(observe(node)); return { ...view, rerender: (next: ReactElement) => view.rerender(observe(next)) }; }
beforeEach(() => { popup = null; display = null; sessionStorage.clear(); vi.mocked(proposalEndpointObjectIds).mockReset().mockResolvedValue([]);
  vi.mocked(fetchPathFinderCableWorkflowDetail).mockReset().mockResolvedValue(liveCableDetail()); });
afterEach(() => { vi.useRealTimers(); sessionStorage.clear(); });

async function openPopupForApply() {
  const f = workflowFixture(), changed = vi.fn();
  const props = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection, accountId: id(2), options,
    workflowDisplayRequest: { cableId: id(4), requestId: 1, action: 'show' as const }, onCableValuesChanged: changed };
  const view = render(<PathFinderResults {...props} />);
  await waitFor(() => expect(popup?.canReview).toBe(true));
  await act(async () => { popup?.review(); });
  await waitFor(() => expect(popup?.canApply).toBe(true));
  return { f, props, view, changed };
}

async function startUnconfirmedPopupApply() {
  const setup = await openPopupForApply();
  await act(async () => { popup?.apply(); });
  await waitFor(() => expect(popup?.pending).toBe(true));
  expect(setup.f.pf.action).toHaveBeenCalledOnce();
  return setup;
}

describe('popup-only calculation results and exact Apply recovery', () => {
  it('renders no lower history, batch, calculation jobs or proposal surface and creates no work from project data', async () => {
    const f = recoveryFixture(), busy = vi.fn(), readJob = vi.fn();
    const view = render(<PathFinderResults pf={asPf({ ...f.pf, readJob })} selectedCableId={null} accountId={id(2)} options={options} onBatchBusyChange={busy} />);
    expect(view.container).toBeEmptyDOMElement(); expect(busy).toHaveBeenLastCalledWith(false);
    expect(view.queryByText('Calculation jobs')).toBeNull();
    expect(view.queryByRole('region', { name: 'Cable revision results' })).toBeNull();
    expect(view.queryByRole('region', { name: 'Batch review and Apply' })).toBeNull();
    expect(f.pf.readProposal).not.toHaveBeenCalled(); expect(readJob).not.toHaveBeenCalled();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
    view.rerender(<PathFinderResults pf={asPf({ ...f.pf, data: { ...f.pf.data, registryRevision: '2' } })} selectedCableId={null} accountId={id(2)} options={options} />);
    expect(view.container).toBeEmptyDOMElement(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it('keeps selected popup Show, manual Review and Apply explicit without adding duplicate result controls', async () => {
    const { f, view, changed } = await openPopupForApply();
    expect(view.container).toBeEmptyDOMElement(); expect(f.pf.showPath).toHaveBeenCalledOnce();
    expect(f.pf.reviewProposal).toHaveBeenCalledExactlyOnceWith(f.proposal); expect(f.pf.action).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
    f.pf.action.mockResolvedValueOnce(recoveryFixture().receipt);
    await act(async () => { popup?.apply(); });
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(f.pf.action).toHaveBeenCalledOnce(); expect(f.pf.refresh).toHaveBeenCalledOnce();
  });
  it('admits only one review from a retained popup callback activated twice before rendering', async () => {
    const f = workflowFixture(); let finish!: (value: { reviewId: string; proposal: PathFinderProposal }) => void;
    f.pf.reviewProposal.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(popup?.canReview).toBe(true));
    const retained = popup!; act(() => { retained.review(); retained.review(); });
    expect(f.pf.reviewProposal).toHaveBeenCalledOnce(); expect(popup?.canApply).toBe(false);
    await act(async () => { finish({ reviewId: id(5), proposal: f.proposal }); });
    await waitFor(() => expect(popup?.canApply).toBe(true)); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('reconciles an unconfirmed popup Apply with the exact original command after a cable revision changes', async () => {
    const { f, view, props, changed } = await startUnconfirmedPopupApply(), original = f.pf.action.mock.calls[0];
    const updated = { ...f.pf, data: { ...f.pf.data, cables: [{ ...f.pf.data.cables[0], cableWriteRevision: '10' }] } };
    view.rerender(<PathFinderResults {...props} pf={asPf(updated)} />);
    await waitFor(() => expect(popup?.canRecover).toBe(true));
    expect(popup?.canReview).toBe(false); expect(popup?.canApply).toBe(false); expect(f.pf.action).toHaveBeenCalledOnce();
    f.pf.action.mockResolvedValueOnce(recoveryFixture().receipt);
    await act(async () => { popup?.retry(); });
    await waitFor(() => expect(popup?.pending).toBe(false));
    expect(f.pf.action.mock.calls[1]).toEqual(original); expect(f.pf.reviewProposal).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce(); expect(f.pf.refresh).toHaveBeenCalledOnce();
  });
  it('retains one pending command across model, options, inactive tool and viewer ownership changes without resending', async () => {
    const { f, view, props } = await startUnconfirmedPopupApply(), original = f.pf.action.mock.calls[0];
    const changed = { ...f.pf, data: { ...f.pf.data, registryRevision: '2', activeModel: { modelVersionId: id(20), selectionRevision: '2' } } };
    view.rerender(<PathFinderResults {...props} pf={asPf(changed)} options={null} active={false} displayOwned={false} />);
    expect(popup?.pending).toBe(true); expect(popup?.canRecover).toBe(false); expect(f.pf.action).toHaveBeenCalledOnce();
    view.rerender(<PathFinderResults {...props} pf={asPf(changed)} workflowSelection={null} options={null} active displayOwned={false} />);
    await waitFor(() => expect(popup?.canRecover).toBe(true)); expect(f.pf.action).toHaveBeenCalledOnce();
    await act(async () => { popup?.retry(); });
    await waitFor(() => expect(f.pf.action).toHaveBeenCalledTimes(2)); expect(f.pf.action.mock.calls[1]).toEqual(original);
  });
  it('restores pending popup recovery after reload only for the original account and waits for explicit retry', async () => {
    const { f, view, props } = await startUnconfirmedPopupApply(), original = f.pf.action.mock.calls[0]; view.unmount();
    const restored = render(<PathFinderResults {...props} accountId={id(21)} />);
    expect(popup?.pending).toBe(false); expect(popup?.canRecover).toBe(false); expect(f.pf.action).toHaveBeenCalledOnce();
    restored.rerender(<PathFinderResults {...props} />);
    await waitFor(() => expect(display?.ready).toBe(true));
    await waitFor(() => expect(popup?.canRecover).toBe(true)); expect(f.pf.action).toHaveBeenCalledOnce();
    f.pf.action.mockResolvedValueOnce(recoveryFixture().receipt);
    await act(async () => { popup?.retry(); });
    await waitFor(() => expect(f.pf.action).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(popup?.pending).toBe(false)); expect(f.pf.action.mock.calls[1]).toEqual(original);
  });
  it.each(['closed-without-apply', 'already-applied'] as const)('reconciles popup Close only from its matching %s disposition', async status => {
    const { f, changed } = await startUnconfirmedPopupApply();
    const original = f.pf.action.mock.calls[0] as unknown as [string, { idempotencyKey: string; reviewId: string; expectedCableWriteRevision: string }];
    f.pf.action.mockResolvedValueOnce({ schemaVersion: 'wfc.pf.apply-recovery.v1', projectId: id(1), proposalId: id(3), ...original[1],
      status, duplicate: status === 'already-applied', receipt: status === 'already-applied' ? recoveryFixture().receipt.receipt : null });
    await act(async () => { popup?.closePending(); });
    await waitFor(() => expect(popup?.pending).toBe(false));
    expect(f.pf.action.mock.calls[1]).toEqual([`/proposals/${id(3)}/close-pending-apply`, original[1]]);
    expect(popup?.canApply).toBe(false); expect(f.pf.reviewProposal).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledTimes(status === 'already-applied' ? 1 : 0);
    expect(f.pf.refresh).toHaveBeenCalledTimes(status === 'already-applied' ? 1 : 0);
  });
  it('fences retained review and Apply callbacks when the selected cable changes', async () => {
    const { f, view, props } = await openPopupForApply(), retained = popup!;
    view.rerender(<PathFinderResults {...props} selectedCableId={id(99)} workflowSelection={null} />);
    await act(async () => { retained.review(); retained.apply(); retained.retry(); retained.closePending(); });
    expect(f.pf.reviewProposal).toHaveBeenCalledOnce(); expect(f.pf.action).not.toHaveBeenCalled();
    expect(popup?.cableId).toBe(id(99)); expect(popup?.proposalId).toBeNull();
  });
  it('identifies the cable that owns pending Apply recovery without exposing its commands through another cable', async () => {
    const { f, view, props } = await startUnconfirmedPopupApply();
    view.rerender(<PathFinderResults {...props} selectedCableId={id(99)} workflowSelection={null} />);
    expect(popup?.message).toContain('pending Apply for Fixture cable');
    expect(popup).toMatchObject({ pending: false, canRecover: false, canReview: false, canApply: false });
    await act(async () => { popup?.retry(); popup?.closePending(); });
    expect(f.pf.action).toHaveBeenCalledOnce();
    view.rerender(<PathFinderResults {...props} />);
    await waitFor(() => expect(popup?.canRecover).toBe(true)); expect(popup?.pending).toBe(true);
    expect(f.pf.action).toHaveBeenCalledOnce();
  });
  it('reviews an exact sealed v8 cable in the popup while sibling cables continue calculating', async () => {
    const f = workflowFixture('running');
    f.pf.reviewProposal.mockResolvedValue({ reviewId: id(5), proposal: f.proposal });
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(popup?.canReview).toBe(true));
    await act(async () => { popup?.review(); });
    await waitFor(() => expect(popup?.canApply).toBe(true));
    expect(f.pf.reviewProposal).toHaveBeenCalledExactlyOnceWith(f.proposal);
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it.each([
    { proposalVersion: 'pathfinder.dependencies.v8', schemaVersion: 'wfc.pf.sealed-cable-applicability.v1', itemVersion: 'pathfinder.dependencies.v7' },
    { proposalVersion: 'pathfinder.dependencies.v7', schemaVersion: 'wfc.pf.sealed-cable-applicability.v2', itemVersion: 'pathfinder.dependencies.v8' },
    { proposalVersion: 'pathfinder.dependencies.v8', schemaVersion: 'wfc.pf.sealed-cable-applicability.v1', itemVersion: 'pathfinder.dependencies.v8' },
    { proposalVersion: 'pathfinder.dependencies.v8', schemaVersion: 'wfc.pf.sealed-cable-applicability.v2', itemVersion: 'pathfinder.dependencies.v7' },
  ] as const)('refuses crossed selected-item version authority (%j)', async pair => {
    const f = workflowFixture('running');
    f.pf.readProposal.mockResolvedValue({ ...f.proposal, provenance: { ...f.proposal.provenance!, dependencyVersion: pair.proposalVersion },
      itemApplicability: { ...f.proposal.itemApplicability!, schemaVersion: pair.schemaVersion, dependencyVersion: pair.itemVersion } } as PathFinderProposal);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(display?.checking).toBe(false));
    expect(popup?.canReview).toBe(false); expect(popup?.canApply).toBe(false);
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['projectId', 'jobId', 'cableId', 'proposalId', 'dependencyHash'] as const)('refuses a selected-item proof with a different %s', async field => {
    const f = workflowFixture('running');
    f.pf.readProposal.mockResolvedValue({ ...f.proposal, itemApplicability: { ...f.proposal.itemApplicability!,
      [field]: field === 'dependencyHash' ? 'd'.repeat(64) : id(99) } });
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(display?.checking).toBe(false));
    expect(popup?.canReview).toBe(false); expect(popup?.canApply).toBe(false);
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['missing proof', 'legacy dependency', 'server refusal', 'stale', 'incompatible'] as const)('does not let selected-item authority bypass %s', async issue => {
    const f = workflowFixture('running'), detail = { ...f.proposal,
      ...(issue === 'missing proof' ? { itemApplicability: null } : {}),
      ...(issue === 'legacy dependency' ? { provenance: { ...f.proposal.provenance!, dependencyVersion: 'pathfinder.dependencies.v6' as const } } : {}),
      ...(issue === 'server refusal' ? { canApply: false } : {}), ...(issue === 'stale' ? { stale: true } : {}),
      ...(issue === 'incompatible' ? { compatibilityIssue: 'Recalculate this result.' } : {}) };
    f.pf.readProposal.mockResolvedValue(detail);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options}
      workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(popup?.comparison).not.toBeNull());
    expect(popup?.canReview).toBe(false); expect(popup?.canApply).toBe(false);
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
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
const asPf = (pf: object) => pf as ReturnType<typeof usePathFinder>;
/** Complete, structurally validated synthetic v8 result with explicit empty or
 * explicit drilling evidence. It grants no real-model engineering acceptance. */
function barrierFixtureFacts(drillThroughWalls = false) {
  return barrierCalculationFixture(id, drillThroughWalls, [[1, 2, 3], [2, 2, 3]]);
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
  it('labels a receipt-proven own-write result ready after its cable revision advances without renewing Review or Apply', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), review = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    f.proposal.stale = true; f.proposal.canApply = false;
    f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7.000', cableWriteRevision: '10' };
    f.live.row.calculation = { ...f.live.row.calculation, reviewable: false, acceptedMatchesCurrent: true };
    f.pf.data.cables[0].cableWriteRevision = '10';
    const props = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.live.row, accountId: id(2), options,
      onWorkflowDisplayChange: changed, onWorkflowReviewChange: review };
    const view = render(<PathFinderResults {...props} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false, jobId: id(7), proposalId: id(3), routing: '/BC1', designLength: '7' }));
    expect(popup?.message).toContain('already saved in Cable list');
    expect(popup?.message).not.toContain('current cable proof is unavailable');
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
  it.each(['routing', 'length'] as const)('does not use an accepted receipt as display readiness when its current %s proof differs', async changedField => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.proposal.stale = true; f.proposal.canApply = false;
    f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7', cableWriteRevision: '10' };
    f.live.row.calculation = { ...f.live.row.calculation, reviewable: false, acceptedMatchesCurrent: true };
    if (changedField === 'routing') f.live.row.cable.routing = '/OTHER';
    if (changedField === 'length') f.live.row.cable.designLength = '8';
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.live.row} accountId={id(2)} options={options}
      onWorkflowDisplayChange={changed} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    await act(async () => {});
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false, routing: null });
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each([{ status: 'cancelled', cancelRequested: false }, { status: 'failed', cancelRequested: false },
    { status: 'running', cancelRequested: true }] as const)('shows an independently saved current item after its background parent stops (%j)', async stop => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>(), review = vi.fn<(value: PathFinderWorkflowReview | null) => void>();
    f.proposal.stale = true; f.proposal.canApply = false;
    f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7', cableWriteRevision: '10' };
    f.live.row.calculation = { ...f.live.row.calculation, jobStatus: stop.status, reviewable: false, acceptedMatchesCurrent: true };
    f.pf.data.cables[0].cableWriteRevision = '10'; f.pf.readJob.mockResolvedValue({ ...f.parent, ...stop });
    const p = { pf: asPf({ ...f.pf, data: { ...f.pf.data, jobs: [{ ...f.parent, ...stop }] } }), selectedCableId: id(4),
      workflowSelection: f.live.row, accountId: id(2), options, onWorkflowDisplayChange: changed, onWorkflowReviewChange: review };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false, routing: '/BC1' }));
    view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] }));
    expect(review.mock.calls.at(-1)?.[0]).toMatchObject({ canReview: false, canApply: false });
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each([true, false])('freshly verifies an accepted cached path after a parent stop before retaining Show (receipt remains current: %s)', async remainsCurrent => {
    const f = workflowFixture('running'), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.proposal.stale = true; f.proposal.canApply = false;
    f.live.row.cable = { ...f.live.row.cable, routing: '/BC1', designLength: '7', cableWriteRevision: '10' };
    f.live.row.calculation = { ...f.live.row.calculation, reviewable: false, acceptedMatchesCurrent: true };
    f.pf.data.cables[0].cableWriteRevision = '10';
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.live.row, accountId: id(2), options,
      onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    let finish!: (value: typeof f.live) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.pf.readJob.mockResolvedValue({ ...f.parent, status: 'failed' });
    view.rerender(<PathFinderResults {...p} pf={asPf({ ...f.pf, data: { ...f.pf.data, jobs: [{ ...f.parent, status: 'failed' }] } })} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(2));
    expect(changed.mock.calls.at(-1)?.[0].ready).toBe(false); expect(f.pf.showPath).not.toHaveBeenCalled();
    const fresh = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, jobStatus: 'failed' as const,
      acceptedMatchesCurrent: remainsCurrent, currentness: remainsCurrent ? 'current' as const : 'changed' as const } } };
    await act(async () => finish(fresh));
    await waitFor(() => {
      expect(changed.mock.calls.at(-1)?.[0].ready).toBe(remainsCurrent);
      expect(changed.mock.calls.at(-1)?.[0].checking).not.toBe(true);
    });
    expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
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
    // Starting the endpoint read precedes the independent route proof commit.
    // Wait for that commit while keeping the endpoint promise unresolved.
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, visible: false, routing: '/BC1', designLength: '7' }));
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
    await waitFor(() => expect(popup?.message).toMatch(/Current administrator access is required to inspect/));
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
    await waitFor(() => expect(popup?.message).toMatch(/Current administrator access is required to inspect/));
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
    await waitFor(() => expect(popup?.message).toMatch(/Current administrator access is required to inspect/));
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false });
    expect(display?.checking).not.toBe(true); expect(f.pf.clear).toHaveBeenCalledOnce();
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
    await waitFor(() => expect(popup?.message).toMatch(/Current administrator access is required to inspect/));
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, visible: false });
    expect(display?.checking).not.toBe(true);
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
  it('shows a complete 512-object route with both complete 4096-part endpoint groups', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.proposal.route!.objectIds = Array.from({ length: 512 }, (_, index) => `dbid:${index + 1}`);
    vi.mocked(proposalEndpointObjectIds).mockResolvedValue(Array.from({ length: 8192 }, (_, index) => `dbid:${index + 513}`));
    const p = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection,
      accountId: id(2), options, onWorkflowDisplayChange: changed };
    const view = render(<PathFinderResults {...p} />);
    await waitFor(() => expect(changed.mock.calls.at(-1)?.[0].ready).toBe(true));
    view.rerender(<PathFinderResults {...p} workflowDisplayRequest={{ cableId: id(4), requestId: 1, action: 'show' }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points,
      objectIds: Array.from({ length: 8704 }, (_, index) => index + 1) }));
  });
  it('retains the exact result when its objects exceed the complete protected display budget', async () => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    f.proposal.route!.objectIds = Array.from({ length: 8705 }, (_, index) => `dbid:${index + 1}`);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(popup?.message).toMatch(/This exact path exceeds the viewer object budget/));
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ready: false, routing: null });
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each([{ status: 503, code: 'WORKFLOW_READ_TIMEOUT' }, { status: null, code: 'REQUEST_TIMEOUT' }])('automatically recovers a transient exact-result read without a refresh or another calculation (%j)', async error => {
    const f = workflowFixture(), changed = vi.fn<(value: PathFinderWorkflowDisplay) => void>();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(error).mockResolvedValue(f.live);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(display?.message).toMatch(/Retrying the exact result automatically/));
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
    await waitFor(() => expect(display?.message).toMatch(/Retrying the exact result automatically/));
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
    expect(display?.message).toMatch(/after bounded automatic retries/);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(7);
    expect(f.pf.refresh).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it('rechecks an unchanged exact result after explicit status refresh without replaying Show or a write', async () => {
    vi.useFakeTimers(); const f = workflowFixture();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValue({ status: 503 });
    const props = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection, accountId: id(2), options,
      workflowDisplayRequest: { cableId: id(4), requestId: 1, action: 'show' as const } };
    const view = render(<PathFinderResults {...props} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(7);
    expect(display).toMatchObject({ ready: false, checking: false, message: expect.stringContaining('after bounded automatic retries') });

    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(f.live);
    const workflowRefreshRequest = { cableId: id(4), requestId: 1 };
    view.rerender(<PathFinderResults {...props} workflowSelection={structuredClone(f.selection)} workflowRefreshRequest={workflowRefreshRequest} />);
    await act(async () => {});
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(8);
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenLastCalledWith(id(1), 'current-private-token', id(4), options, expect.any(AbortSignal));
    expect(f.pf.readProposal).toHaveBeenCalledTimes(8); expect(f.pf.readJob).toHaveBeenCalledTimes(8);
    expect(display).toMatchObject({ cableId: id(4), jobId: id(7), proposalId: id(3), proposalHash: f.proposal.proposalHash,
      ready: true, visible: false, verifiedRow: f.live.row });
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(popup?.canReview).toBe(false);

    // Repeating the same refresh event cannot create another verification or
    // reuse the earlier Show request when the result eventually becomes ready.
    view.rerender(<PathFinderResults {...props} workflowSelection={{ ...f.selection }} workflowRefreshRequest={{ ...workflowRefreshRequest }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(8); expect(f.pf.showPath).not.toHaveBeenCalled();
    view.rerender(<PathFinderResults {...props} workflowRefreshRequest={workflowRefreshRequest}
      workflowDisplayRequest={{ ...props.workflowDisplayRequest, requestId: 2 }} />);
    await act(async () => {});
    expect(f.pf.showPath).toHaveBeenCalledExactlyOnceWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(8);
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it('keeps the selected verified route when another cable or an older request is refreshed', async () => {
    const f = workflowFixture(), workflowRefreshRequest = { cableId: id(4), requestId: 3 };
    const props = { pf: asPf(f.pf), selectedCableId: id(4), workflowSelection: f.selection, accountId: id(2), options,
      workflowDisplayRequest: { cableId: id(4), requestId: 1, action: 'show' as const } };
    const view = render(<PathFinderResults {...props} workflowRefreshRequest={workflowRefreshRequest} />);
    await waitFor(() => expect(display).toMatchObject({ ready: true, visible: true }));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.showPath).toHaveBeenCalledOnce();

    for (const request of [{ cableId: id(99), requestId: 4 }, { cableId: id(4), requestId: 2 }, { cableId: id(4), requestId: NaN }]) {
      view.rerender(<PathFinderResults {...props} workflowSelection={{ ...f.selection }} workflowRefreshRequest={request} />);
      await act(async () => {});
      expect(display).toMatchObject({ ready: true, visible: true });
      expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(f.pf.showPath).toHaveBeenCalledOnce();
      expect(f.pf.clear).not.toHaveBeenCalled();
    }
    view.rerender(<PathFinderResults {...props} workflowRefreshRequest={{ cableId: id(4), requestId: 4 }} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(display).toMatchObject({ ready: true, visible: false }));
    expect(f.pf.showPath).toHaveBeenCalledOnce();
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
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
    expect(display?.checking).not.toBe(true);
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
    await waitFor(() => expect(popup?.message).toMatch(/Current administrator access is required to inspect/));
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
    await waitFor(() => expect(display?.message).toMatch(/The current cable proof is unavailable or changed/));
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
    await waitFor(() => expect(popup?.message).toMatch(/The model preparation for this result is still refreshing/));
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
    await waitFor(() => expect(popup?.canReview).toBe(true));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledWith(id(1), 'current-private-token', id(4), recorded.preferences, expect.any(AbortSignal));
    expect(popup?.recordedDrillThroughWalls).toBe(true);
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
    await waitFor(() => expect(popup?.canReview).toBe(false));
    expect(committed).not.toHaveBeenCalled();
    view.rerender(<PathFinderResults {...props} workflowConfigurationReady />);
    await waitFor(() => expect(popup?.canReview).toBe(true));
    const staleReview = update.mock.calls.at(-1)?.[0]?.review;
    view.rerender(<PathFinderResults {...props} workflowConfigurationReady={false} />);
    await waitFor(() => expect(popup?.canReview).toBe(false));
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
    await waitFor(() => expect(popup?.message).toMatch(/calculation changed or could not be verified/));
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
    expect(f.pf.calculate).not.toHaveBeenCalled();
    expect(f.pf.action).not.toHaveBeenCalled();
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
    await waitFor(() => expect(display?.message).toMatch(/The current cable proof is unavailable or changed/));
    expect(changed).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
  });
  it('reads selected cable metadata and refreshed progress without claiming the viewer or making the model Ghost', async () => {
    const f = workflowFixture(), claimViewer = vi.fn(() => () => true), changed = vi.fn();
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection}
      accountId={id(2)} options={options} claimViewer={claimViewer} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(popup?.comparison?.current.cable.routing).toBe('/LIVE-CURRENT'));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ cableId: id(4), jobId: id(7), proposalId: id(3), proposalHash: f.proposal.proposalHash,
      ready: true, visible: false, routing: '/BC1', designLength: '7', source: 'current-calculation', verifiedRow: f.live.row, verifiedScope: pathFinderWorkflowDisplayScope(asPf(f.pf), id(2)) }));
    expect(popup?.canReview).toBe(false);
    const updated = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, currentness: 'changed' as const, reviewable: false } } };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue(updated);
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={updated.row}
      accountId={id(2)} options={options} claimViewer={claimViewer} onWorkflowDisplayChange={changed} />);
    await waitFor(() => expect(f.pf.readProposal).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(popup?.comparison?.current.cable.routing).toBe('/LIVE-CURRENT'));
    expect(claimViewer).not.toHaveBeenCalled(); expect(proposalEndpointObjectIds).toHaveBeenCalledTimes(2);
    expect(vi.mocked(proposalEndpointObjectIds).mock.calls[1][3]?.aborted).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ ready: false, visible: false, routing: null, designLength: null }));
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.clear).not.toHaveBeenCalled();
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
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
    expect(popup?.canReview).toBe(false);
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
    expect(popup?.canReview).toBe(false);
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
    await waitFor(() => expect(popup?.comparison).not.toBeNull());
    expect(f.pf.showPath).toHaveBeenCalledOnce(); expect(f.pf.clear).toHaveBeenCalledOnce();
    expect(popup?.canReview).toBe(false);
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={live.row}
      accountId={id(2)} options={options} workflowDisplayRequest={{ ...show, requestId: 1 }} />);
    await waitFor(() => expect(f.pf.showPath).toHaveBeenCalledTimes(2));
    expect(f.pf.showPath).toHaveBeenLastCalledWith(expect.objectContaining({ pathId: proposal.id }));
    expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.calculate).not.toHaveBeenCalled();
  });
  it.each(['complete', 'running'] as const)('opens the exact selected %s result outside the loaded history and recent proposals', async status => {
    const f = workflowFixture(status);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(popup?.canReview).toBe(true));
    expect(f.pf.readProposal).toHaveBeenCalledExactlyOnceWith(id(3), expect.any(AbortSignal)); expect(f.pf.readJob).toHaveBeenCalledExactlyOnceWith(id(7), expect.any(AbortSignal));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledExactlyOnceWith(id(1), 'current-private-token', id(4), options, expect.any(AbortSignal));
    expect(f.pf.showPath).toHaveBeenCalledWith({ pathId: id(3), points: f.proposal.route!.points, objectIds: [23] });
    expect(popup?.comparison?.current.cable.routing).toBe('/LIVE-CURRENT');
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled(); expect(f.pf.refresh).not.toHaveBeenCalled();
    await act(async () => { popup?.review(); }); await waitFor(() => expect(f.pf.reviewProposal).toHaveBeenCalledWith(f.proposal));
  });
  it('keeps an unsealed legacy result unavailable instead of showing it as the ready selected route', async () => {
    const f = workflowFixture(); f.pf.readProposal.mockResolvedValue({ ...f.proposal, revisionResult: null });
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(display?.message).toMatch(/no verifiable calculation admission/));
    expect(f.pf.showPath).not.toHaveBeenCalled();
    expect(popup?.canReview).toBe(false); expect(popup?.canReview).toBe(false);
    expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });
  it.each(['project', 'cable', 'job', 'hash', 'envelope'] as const)('refuses a selected result whose %s linkage changed', async field => {
    const f = workflowFixture(), detail = { ...f.proposal };
    if (field === 'project') detail.projectId = id(90); if (field === 'cable') detail.cableId = id(90); if (field === 'job') detail.jobId = id(90);
    if (field === 'hash') detail.proposalHash = 'f'.repeat(64); if (field === 'envelope') detail.revisionResult = { ...detail.revisionResult!, admissionId: id(90), jobId: id(90) };
    f.pf.readProposal.mockResolvedValue(detail);
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(popup?.message).toMatch(/calculation changed or could not be verified/));
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });
  it.each(['cancelled', 'unknown', 'stale'] as const)('does not borrow history readiness when the fresh selected proof is %s', async mode => {
    const f = workflowFixture();
    if (mode === 'cancelled') f.pf.readJob.mockResolvedValue({ ...f.parent, status: 'cancelled', cancelRequested: true });
    if (mode === 'unknown') f.pf.readJob.mockResolvedValue(null);
    if (mode === 'stale') { f.live.row.calculation.currentness = 'changed'; f.live.row.calculation.reviewable = false; }
    render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(display?.message).toMatch(mode === 'stale' ? /The current cable proof is unavailable or changed/
      : mode === 'cancelled' ? /This calculation was cancelled/ : /The exact calculation state is unavailable/));
    expect(f.pf.showPath).not.toHaveBeenCalled();
    expect(popup?.canReview).toBe(false);
    expect(f.pf.reviewProposal).not.toHaveBeenCalled();
  });


  it('rechecks the same legacy proposal when bounded cable progress observes its parent complete', async () => {
    const f = workflowFixture(), running = { ...f.parent, status: 'running' as const, completed: 1 };
    const preview = { ...f.live, row: { ...f.live.row, calculation: { ...f.live.row.calculation, jobStatus: 'running' as const, reviewable: false } } };
    f.pf.readJob.mockResolvedValueOnce(running).mockResolvedValue(f.parent);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce(preview).mockResolvedValue(f.live);
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={preview.row} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(display?.message).toMatch(/The current cable proof is unavailable or changed/));
    expect(f.pf.showPath).not.toHaveBeenCalled(); expect(popup?.canReview).toBe(false);
    view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await waitFor(() => expect(popup?.canReview).toBe(true));
    expect(f.pf.showPath).toHaveBeenCalledOnce();
    expect(f.pf.readJob.mock.calls).toEqual([[id(7), expect.any(AbortSignal)], [id(7), expect.any(AbortSignal)]]); expect(f.pf.readProposal.mock.calls).toEqual([[id(3), expect.any(AbortSignal)], [id(3), expect.any(AbortSignal)]]);
    expect(f.pf.calculate).not.toHaveBeenCalled(); expect(f.pf.action).not.toHaveBeenCalled();
  });

  it.each(['selection', 'account', 'model'] as const)('fences a late selected proposal after %s changes', async change => {
    const f = workflowFixture(); let finish!: (value: PathFinderProposal) => void;
    f.pf.readProposal.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<PathFinderResults pf={asPf(f.pf)} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    if (change === 'selection') view.rerender(<PathFinderResults pf={asPf(f.pf)} selectedCableId={null} workflowSelection={null} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    else if (change === 'account') view.rerender(<PathFinderResults pf={asPf({ ...f.pf, preparationAccess: { ...f.pf.preparationAccess, isAdmin: false } })} selectedCableId={id(4)} workflowSelection={f.selection} accountId={id(20)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    else view.rerender(<PathFinderResults pf={asPf({ ...f.pf, data: { ...f.pf.data, activeModel: { ...f.pf.data.activeModel, selectionRevision: '2' } } })} selectedCableId={id(4)} workflowSelection={null} accountId={id(2)} options={options} workflowDisplayRequest={{ cableId: id(4), requestId: 0, action: 'show' }} />);
    await act(async () => { finish(f.proposal); }); expect(f.pf.showPath).not.toHaveBeenCalled(); expect(f.pf.reviewProposal).not.toHaveBeenCalled();
    expect(popup?.canReview).not.toBe(true);
  });
});
