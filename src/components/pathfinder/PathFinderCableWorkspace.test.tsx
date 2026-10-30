import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderCableWorkspace, type PathFinderCableWorkspaceProps } from './PathFinderCableWorkspace';
import type { PathFinderNeedsRoutingListProps } from './PathFinderNeedsRoutingList';
import type { PathFinderCableRoutingPanelProps } from './PathFinderCableRoutingPanel';
import { fetchPathFinderCableWorkflowDetail } from '@/api/pathfinderCableWorkflow';
import { fetchPathFinderJob } from '@/api/pathfinder';
import { fetchLocationImpacts } from '@/api/pathfinderLocationImpacts';
import { usePathfinderLocationImpactProgress } from '@/hooks/usePathfinderLocationImpactProgress';
import { usePathfinderInitialFillProgress } from '@/hooks/usePathfinderInitialFillProgress';
import { cableWorkflowRowSchema, type CableWorkflowRow } from '../../../shared/pathfinderCableWorkflow';
import { endpointBindingFixture } from '@/test/endpointBindingFixtures';
import type { CableEndpointReceipt } from '@/api/pathfinderCableEndpoints';
import { emptyInitialFillCounters, type InitialFillProgress } from '../../../shared/pathfinderInitialFillProgress';
import type { BarrierAdmissionIntent } from '../../../shared/pathfinderBarrierAdmission';
import { pathFinderWorkflowDisplayScope, type PathFinderWorkflowReview } from '@/pages/ProjectDetails/PathFinderResults';
import { cableComparisonInputSchema } from '../../../shared/pathfinderCableComparison';
import { barrierCalculationFixture } from '@/test/pathfinderBarrierFixtures';
import { AUTOMATIC_PAIR_POLICY } from '../../../shared/pathfinderAutomaticPair';
vi.mock('@/api/pathfinderCableWorkflow', () => ({ fetchPathFinderCableWorkflowDetail: vi.fn() }));
vi.mock('@/api/pathfinder', () => ({ fetchPathFinderJob: vi.fn() }));
vi.mock('@/api/pathfinderLocationImpacts', () => ({ fetchLocationImpacts: vi.fn() }));
vi.mock('@/hooks/usePathfinderLocationImpactProgress', () => ({ usePathfinderLocationImpactProgress: vi.fn() }));
vi.mock('@/hooks/usePathfinderInitialFillProgress', () => ({ usePathfinderInitialFillProgress: vi.fn() }));
let listProps: PathFinderNeedsRoutingListProps, panelProps: PathFinderCableRoutingPanelProps, listRow: CableWorkflowRow;
vi.mock('./PathFinderNeedsRoutingList', () => ({ cableWorkflowReason: () => 'Resolve the missing From/To points.', PathFinderNeedsRoutingList: (props: PathFinderNeedsRoutingListProps) => {
  listProps = props; return <button disabled={!props.active} onClick={() => props.onSelect(listRow)}>Needs routing cable</button>;
} }));
vi.mock('./PathFinderCableRoutingPanel', () => ({ PathFinderCableRoutingPanel: (props: PathFinderCableRoutingPanelProps) => {
  panelProps = props; return props.open ? <div role="dialog"><button onClick={props.onClose}>Close routing popup</button></div> : null;
} }));
const id = (n: number) => `f8520000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function row(): CableWorkflowRow {
  const missing = { status: 'missing', pointAvailable: false, source: null, approximate: false, candidateObjectIds: [], reasonCode: 'LOCATION_MISSING', engineeringAccepted: false };
  return cableWorkflowRowSchema.parse({ projectId: id(1), mto: 'Control', cable: { id: id(3), tag: 'C-001', fromLocation: 'Panel A', toLocation: 'Motor B', routing: null, designLength: null, installLength: '123', cableWriteRevision: '4' }, from: missing, to: missing,
    calculation: { jobId: null, jobStatus: null, itemState: null, outcome: 'not-evaluated', reasonCodes: [], errorCode: null, currentness: 'not-evaluated', proposalId: null, proposalHash: null, reviewable: false, acceptedMatchesCurrent: false } });
}
function calculatedRow(job = 70, proposal = 80): CableWorkflowRow {
  const ready = { status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false };
  return cableWorkflowRowSchema.parse({ ...row(), from: ready, to: ready,
    calculation: { ...row().calculation, jobId: id(job), jobStatus: 'complete', itemState: 'complete', outcome: 'calculated',
      currentness: 'current', proposalId: id(proposal), proposalHash: 'f'.repeat(64), reviewable: true } });
}
function preparationUpdatedRow(): CableWorkflowRow {
  const value = row(); return cableWorkflowRowSchema.parse({ ...value, calculation: { ...value.calculation, jobId: id(70), jobStatus: 'complete',
    itemState: 'blocked', outcome: 'stale', currentness: 'changed', reasonCodes: ['ROUTING_PREPARATION_REQUIRED', 'ROUTING_PREPARATION_UPDATED'] } });
}
function props(): PathFinderCableWorkspaceProps {
  const scope = endpointBindingFixture().context.current!;
  const state = { projectId: id(1), activeModel: { modelVersionId: scope.modelVersionId, selectionRevision: scope.selectionRevision, contentFingerprint: scope.contentFingerprint }, artifacts: [] };
  return { projectId: id(1), loadedProjectId: id(1), accountId: id(2), token: 'fixture-token', isAdmin: true, active: true,
    preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, onSelect: vi.fn(),
    pf: { preparationAccess: { projectId: id(1), loadedProjectId: id(1), token: 'fixture-token', isAdmin: true }, preparationViewerGeneration: 7,
      viewerPhase: 'ready', busy: false, calculate: vi.fn(), submitCalculation: vi.fn(async () => ({ kind: 'unknown', code: 'CALCULATION_SUBMISSION_UNKNOWN' })), data: state, readSelection: vi.fn(), refresh: vi.fn(), refreshState: vi.fn(async () => state) } as unknown as PathFinderCableWorkspaceProps['pf'] };
}
function reviewController(cableId: string, proposalId: string): PathFinderWorkflowReview {
  return { cableId, proposalId, comparison: null, comparisonLoading: false, comparisonError: null, message: null, reviewed: false, applied: false,
    canReview: true, canApply: false, busy: false, pending: false, canRecover: false, recoveryMessage: null, recoveryError: null,
    review: vi.fn(), apply: vi.fn(), retry: vi.fn(), closePending: vi.fn() };
}
function writeProgress(): InitialFillProgress { return { schemaVersion: 'wfc.pf.initial-fill-progress.v1', projectId: id(1), actorId: id(2), impactId: id(8),
  mandate: { id: id(9), impactId: id(8), contentSha256: 'a'.repeat(64), mode: 'when-both-empty' }, authorized: true, currentAuthority: true, eligibleCables: 1,
  counters: { ...emptyInitialFillCounters(), written: 1 }, retryableUnknown: 0, outstanding: 0, selected: null }; }
// These regressions focus on work after the window opens. Complete its fresh
// selected-row GET first and begin their transport assertions at that boundary.
// Dedicated first-open tests below inspect that request itself without this helper.
async function openListCable(preserveReads = false) {
  await act(async () => { fireEvent.click(screen.getByText('Needs routing cable')); });
  if (!preserveReads) vi.mocked(fetchPathFinderCableWorkflowDetail).mockClear();
}
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(window, 'open').mockReturnValue(null); listRow = row(); vi.mocked(fetchLocationImpacts).mockResolvedValue({ impacts: [] } as never);
  vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: row() } as never);
  vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(async (_projectId, _token, cableId) => ({ projectId: id(1), cableId,
    row: { ...structuredClone(listRow), cable: { ...structuredClone(listRow.cable), id: cableId } } }) as never);
  vi.mocked(fetchPathFinderJob).mockResolvedValue(null as never);
  vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: null, error: null, refresh: vi.fn() } as never);
  vi.mocked(usePathfinderInitialFillProgress).mockReturnValue({ progress: null, error: null, refresh: vi.fn() } as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('owned cable routing workspace composition (mocked reads and child UI)', () => {
  it.each(['cable', 'job', 'proposal', 'hash'] as const)('forwards a display-check reason only for the exact selected result, refusing a different %s', async kind => {
    const p = props(); listRow = calculatedRow();
    const exact = { cableId: listRow.cable.id, jobId: listRow.calculation.jobId, proposalId: listRow.calculation.proposalId,
      proposalHash: listRow.calculation.proposalHash, ready: false, visible: false, routing: null, designLength: null,
      checking: false, message: 'The saved path check stopped after bounded retries.' };
    const wrong = { ...exact, ...(kind === 'cable' ? { cableId: id(300) } : kind === 'job' ? { jobId: id(300) }
      : kind === 'proposal' ? { proposalId: id(300) } : { proposalHash: 'd'.repeat(64) }) };
    const view = render(<PathFinderCableWorkspace {...p} display={wrong} />); await openListCable();
    expect(panelProps.calculationFeedback).toBeNull(); expect(panelProps.pathReady).toBe(false);
    view.rerender(<PathFinderCableWorkspace {...p} display={exact} />);
    expect(panelProps.calculationFeedback).toEqual({ cableId: listRow.cable.id, working: false, message: exact.message });
    expect(panelProps.pathReady).toBe(false); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('connects popup location display to the ready viewer without submitting a calculation', async () => {
    const p = props(); p.pf.showLocation = vi.fn(async () => true);
    const view = render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { expect(await panelProps.onShowLocation?.(55)).toBe(true); });
    expect(p.pf.showLocation).toHaveBeenCalledExactlyOnceWith(55); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
    view.rerender(<PathFinderCableWorkspace {...p} pf={{ ...p.pf, viewerPhase: 'loading' }} />);
    expect(panelProps.onShowLocation).toBeUndefined();
  });
  it('defaults each cable drilling draft off and keeps shared-location Save drilling off', async () => {
    const p = props(), strict = barrierCalculationFixture(id, false).preferences;
    render(<PathFinderCableWorkspace {...p} preferences={strict} getCalculationPreferences={drill => ({ ...strict, barrierRouting: { ...strict.barrierRouting!, drillThroughWalls: drill } })} />);
    await openListCable(); expect(panelProps.drillThroughWalls).toBe(false);
    act(() => panelProps.onDrillThroughWallsChange?.(true)); expect(panelProps.drillThroughWalls).toBe(true);
    expect(panelProps.access.calculation?.preferences.barrierRouting?.drillThroughWalls).toBe(false);
    expect(panelProps.access.initialFill).toBeNull();
    expect(panelProps.access.automaticPairPolicy).toEqual({ schemaVersion: 'wfc.pf.automatic-pair-policy.v1', mode: 'when-both-empty-or-unchanged-automatic' });
    listRow = { ...row(), cable: { ...row().cable, id: id(44) } }; await openListCable();
    expect(panelProps.drillThroughWalls).toBe(false); expect(panelProps.cable?.cable.id).toBe(id(44)); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('freezes explicit selected-job drilling preferences for submission and polling without changing shared Save or another cable', async () => {
    const p = props(), strict = barrierCalculationFixture(id, false).preferences, draft = { ...strict, barrierRouting: { ...strict.barrierRouting!, drillThroughWalls: true } };
    const acknowledged = vi.fn(); vi.mocked(p.pf.submitCalculation).mockResolvedValueOnce({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: { ...row(), calculation: { ...row().calculation, jobId: id(71), jobStatus: 'running' } } } as never);
    render(<PathFinderCableWorkspace {...p} preferences={strict} getCalculationPreferences={drill => drill ? draft : strict} onCalculationPreferences={acknowledged} />);
    await openListCable(); act(() => panelProps.onDrillThroughWallsChange?.(true));
    await act(async () => { await panelProps.onCalculate?.(); });
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    draft.barrierRouting.drillThroughWalls = false; act(() => panelProps.onDrillThroughWallsChange?.(false));
    expect(p.pf.submitCalculation).toHaveBeenCalledExactlyOnceWith([id(3)], expect.objectContaining({ barrierRouting: expect.objectContaining({ drillThroughWalls: true }) }));
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledWith(id(1), 'fixture-token', id(3), expect.objectContaining({ barrierRouting: expect.objectContaining({ drillThroughWalls: true }) }), expect.any(AbortSignal));
    expect(acknowledged).toHaveBeenCalledWith(expect.objectContaining({ cableId: id(3), jobId: id(71), preferences: expect.objectContaining({ barrierRouting: expect.objectContaining({ drillThroughWalls: true }) }) }));
    expect(panelProps.access.calculation?.preferences.barrierRouting?.drillThroughWalls).toBe(false);
    expect(panelProps.calculationFeedback).toMatchObject({ working: true, currentAttempt: true, message: 'Calculating this cable’s routing…' });
    expect(panelProps.submittedDrillThroughWalls).toBe(true);
    act(() => panelProps.onClose()); await openListCable();
    expect(panelProps.drillThroughWalls).toBe(false); expect(panelProps.submittedDrillThroughWalls).toBe(true);
    expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
  });
  it('keeps an unacknowledged submission unknown without polling or borrowing a different independently observed job', async () => {
    const p = props(), acknowledged = vi.fn(); render(<PathFinderCableWorkspace {...p} onCalculationPreferences={acknowledged} />);
    await openListCable(); const calculate = panelProps.onCalculate!;
    await act(async () => { await calculate(); });
    expect(panelProps.calculationFeedback).toMatchObject({ working: false, message: expect.stringContaining('submission is unconfirmed') });
    expect(panelProps.calculationPending).toBe(true); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled(); expect(acknowledged).not.toHaveBeenCalled();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce({ projectId: id(1), cableId: id(3), row: { ...row(), calculation: { ...row().calculation, jobId: id(99), jobStatus: 'complete' } } } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh selected cable' })); await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    expect(panelProps.calculationPending).toBe(true); expect(acknowledged).not.toHaveBeenCalled();
    await act(async () => { await calculate(); }); expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
  });
  it.each(['not-submitted', 'rejected'] as const)('releases a positively %s attempt only for a new explicit Calculate click', async kind => {
    const p = props(); vi.mocked(p.pf.submitCalculation).mockResolvedValueOnce(kind === 'rejected'
      ? { kind, status: 409, code: 'REGISTRY_CONFLICT' } : { kind, code: 'CALCULATION_PREFLIGHT_FAILED' });
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.onCalculate?.(); });
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.onCalculate).toBeTypeOf('function'); expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
    expect(panelProps.calculationFeedback).toMatchObject({ working: false, message: expect.stringContaining(kind === 'not-submitted' ? 'No calculation was submitted' : 'No calculation job was created') });
    await act(async () => { await panelProps.onCalculate?.(); });
    expect(p.pf.submitCalculation).toHaveBeenCalledTimes(2); expect(panelProps.calculationPending).toBe(true); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it.each(['preflight', 'not-submitted', 'rejected'] as const)('marks a fresh %s refusal while preserving the old preparation-updated job', async kind => {
    const p = props(); listRow = preparationUpdatedRow();
    if (kind !== 'preflight') vi.mocked(p.pf.submitCalculation).mockResolvedValueOnce(kind === 'rejected'
      ? { kind, status: 409, code: 'BARRIER_CALCULATION_SCOPE_CHANGED' } : { kind, code: 'CALCULATION_PREFLIGHT_FAILED' });
    const display = { cableId: id(3), jobId: id(70), proposalId: null, proposalHash: null, ready: false, visible: false,
      routing: null, designLength: null, checking: false, message: 'The previous saved path is unavailable.' };
    render(<PathFinderCableWorkspace {...p} display={display} preferences={kind === 'preflight' ? null : p.preferences} readPreferences={p.preferences} />);
    await openListCable(); expect(panelProps.calculationFeedback?.currentAttempt).not.toBe(true);
    await act(async () => { await panelProps.onCalculate?.(); });
    expect(panelProps.calculationFeedback).toMatchObject({ currentAttempt: true, working: false });
    expect(panelProps.calculationFeedback?.message).toContain(kind === 'preflight' ? 'Configure the current route settings'
      : kind === 'not-submitted' ? 'No calculation was submitted' : 'Refresh barriers');
    expect(panelProps.cable?.calculation).toMatchObject({ jobId: id(70), outcome: 'stale', currentness: 'changed' });
    expect(panelProps.calculationPending).toBe(false); expect(p.pf.submitCalculation).toHaveBeenCalledTimes(kind === 'preflight' ? 0 : 1);
  });
  it.each(['generation', 'artifact'] as const)('does not carry fresh-attempt precedence into a changed preparation %s', async kind => {
    const p = props(); listRow = preparationUpdatedRow();
    vi.mocked(p.pf.submitCalculation).mockResolvedValueOnce({ kind: 'rejected', status: 409, code: 'REGISTRY_CONFLICT' });
    const view = render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.onCalculate?.(); }); expect(panelProps.calculationFeedback?.currentAttempt).toBe(true);
    const pf = kind === 'generation' ? { ...p.pf, preparationViewerGeneration: p.pf.preparationViewerGeneration + 1 }
      : { ...p.pf, data: { ...p.pf.data!, artifacts: [{ id: id(91), snapshotSha256: 'd'.repeat(64) }] as NonNullable<typeof p.pf.data>['artifacts'] } };
    view.rerender(<PathFinderCableWorkspace {...p} pf={pf} />);
    expect(panelProps.calculationFeedback?.currentAttempt).toBe(false); expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
  });
  it('explains a confirmed obstacle refusal and permits another explicit calculation without borrowing the old route', async () => {
    const p = props(); vi.mocked(p.pf.submitCalculation).mockResolvedValueOnce({ kind: 'rejected', status: 409, code: 'BARRIER_CALCULATION_SCOPE_CHANGED' });
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.onCalculate?.(); });
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.onCalculate).toBeTypeOf('function');
    expect(panelProps.calculationFeedback?.message).toContain('Refresh barriers');
    expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
  });
  it('retains an unknown A attempt through A→B→A without borrowing another observed job or sending again', async () => {
    const p = props(), acknowledged = vi.fn(); render(<PathFinderCableWorkspace {...p} onCalculationPreferences={acknowledged} />);
    await openListCable(); await act(async () => { await panelProps.onCalculate?.(); });
    listRow = { ...row(), cable: { ...row().cable, id: id(44) } }; await openListCable();
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.onCalculate).toBeTypeOf('function');
    listRow = row(); await openListCable();
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.onCalculate).toBeUndefined();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce({ projectId: id(1), cableId: id(3), row: { ...row(), calculation: { ...row().calculation, jobId: id(99), jobStatus: 'complete' } } } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh selected cable' })); await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.onCalculate).toBeUndefined(); expect(p.pf.submitCalculation).toHaveBeenCalledOnce(); expect(acknowledged).not.toHaveBeenCalled();
  });
  it('keeps a late A ACK and its original drill policy when B was opened before the response', async () => {
    const p = props(), strict = barrierCalculationFixture(id, false).preferences, acknowledged = vi.fn();
    let finish!: () => void; vi.mocked(p.pf.submitCalculation).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false }); }));
    render(<PathFinderCableWorkspace {...p} preferences={strict} getCalculationPreferences={drill => ({ ...strict, barrierRouting: { ...strict.barrierRouting!, drillThroughWalls: drill } })} onCalculationPreferences={acknowledged} />);
    await openListCable(); act(() => panelProps.onDrillThroughWallsChange?.(true));
    let pending!: Promise<void>; act(() => { pending = Promise.resolve(panelProps.onCalculate?.()); });
    listRow = { ...row(), cable: { ...row().cable, id: id(44) } }; await openListCable();
    await act(async () => { finish(); await pending; });
    expect(panelProps.cable?.cable.id).toBe(id(44)); expect(panelProps.calculationPending).toBe(false); expect(acknowledged).not.toHaveBeenCalled();
    listRow = row(); await openListCable(true);
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.onCalculate).toBeUndefined(); expect(panelProps.submittedDrillThroughWalls).toBe(true);
    expect(acknowledged).toHaveBeenCalledExactlyOnceWith({ cableId: id(3), jobId: id(71), preferences: expect.objectContaining({ barrierRouting: expect.objectContaining({ drillThroughWalls: true }) }) });
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledWith(id(1), 'fixture-token', id(3), expect.objectContaining({ barrierRouting: expect.objectContaining({ drillThroughWalls: true }) }), expect.any(AbortSignal)));
    expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
  });
  it('refuses attempt129 before submission without evicting any of128 unresolved cables', async () => {
    const p = props(); render(<PathFinderCableWorkspace {...p} />);
    for (let index = 0; index < 128; index++) {
      listRow = { ...row(), cable: { ...row().cable, id: id(1000 + index) } }; await openListCable();
      await act(async () => { await panelProps.onCalculate?.(); });
    }
    expect(p.pf.submitCalculation).toHaveBeenCalledTimes(128);
    listRow = { ...row(), cable: { ...row().cable, id: id(9999) } }; await openListCable();
    await act(async () => { await panelProps.onCalculate?.(); });
    expect(panelProps.calculationFeedback?.message).toContain('128 unresolved cable calculations'); expect(p.pf.submitCalculation).toHaveBeenCalledTimes(128);
    listRow = { ...row(), cable: { ...row().cable, id: id(1000) } }; await openListCable();
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.onCalculate).toBeUndefined(); expect(p.pf.submitCalculation).toHaveBeenCalledTimes(128);
  });
  it('shows a stopped exact job in popup feedback without claiming it has an applicable result', async () => {
    const p = props(); vi.mocked(p.pf.submitCalculation).mockResolvedValueOnce({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderJob).mockResolvedValue({ id: id(71), projectId: id(1), status: 'failed', failure: 'Job stopped.', cancelRequested: false,
      items: [{ cableId: id(44), state: 'blocked', status: 'no_path', message: 'Another cable diagnostic.' },
        { cableId: id(3), state: 'blocked', status: 'resource_limit', message: 'Selected cable exceeded the native graph memory limit.' }] } as never);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce({ projectId: id(1), cableId: id(3), row: { ...row(), calculation: { ...row().calculation, jobId: id(71), jobStatus: 'failed', outcome: 'failed' } } } as never);
    render(<PathFinderCableWorkspace {...p} />); await openListCable(); await act(async () => { await panelProps.onCalculate?.(); });
    await waitFor(() => expect(panelProps.calculationPending).toBe(false));
    expect(panelProps.calculationFeedback).toMatchObject({ working: false, message: expect.stringContaining('stopped without an applicable route') });
    expect(panelProps.calculationDiagnostics).toMatchObject({ cableId: id(3), jobId: id(71), itemStatus: 'resource_limit',
      itemMessage: 'Selected cable exceeded the native graph memory limit.', jobFailure: 'Job stopped.' });
    expect(fetchPathFinderJob).toHaveBeenCalledOnce();
    expect(panelProps.review).toBeNull();
  });
  it('loads the exact failed item diagnostic on opening without submitting a calculation', async () => {
    listRow = { ...row(), calculation: { ...row().calculation, jobId: id(71), jobStatus: 'complete', itemState: 'blocked', outcome: 'no-path' } };
    vi.mocked(fetchPathFinderJob).mockResolvedValue({ id: id(71), projectId: id(1), status: 'complete', failure: null,
      items: [{ cableId: id(3), state: 'blocked', status: 'no_path', message: 'The From point cannot reach any permitted tray.' }] } as never);
    const p = props(); render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await waitFor(() => expect(panelProps.calculationDiagnostics?.itemMessage).toBe('The From point cannot reach any permitted tray.'));
    expect(fetchPathFinderJob).toHaveBeenCalledExactlyOnceWith(id(1), 'fixture-token', id(71), expect.any(AbortSignal));
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled(); expect(panelProps.pathReady).toBe(false);
  });
  it('discards a delayed failed diagnostic when another cable is selected', async () => {
    listRow = { ...row(), calculation: { ...row().calculation, jobId: id(71), jobStatus: 'failed', itemState: 'blocked', outcome: 'failed' } };
    let finish!: (value: unknown) => void;
    vi.mocked(fetchPathFinderJob).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
    const p = props(); render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await waitFor(() => expect(fetchPathFinderJob).toHaveBeenCalledOnce());
    listRow = { ...row(), cable: { ...row().cable, id: id(44) } };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(44), row: listRow } as never);
    await openListCable();
    await act(async () => { finish({ id: id(71), projectId: id(1), status: 'failed', failure: null,
      items: [{ cableId: id(3), state: 'blocked', status: 'failed', message: 'Earlier cable failure.' }] }); });
    expect(panelProps.cable?.cable.id).toBe(id(44)); expect(panelProps.calculationDiagnostics).toBeNull();
    expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('keeps diagnostic read errors separate from calculation failure and retries only on explicit Refresh', async () => {
    listRow = { ...row(), calculation: { ...row().calculation, jobId: id(71), jobStatus: 'failed', itemState: 'blocked', outcome: 'failed' } };
    vi.mocked(fetchPathFinderJob).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ id: id(71), projectId: id(1), status: 'failed', failure: null,
      items: [{ cableId: id(3), state: 'blocked', status: 'failed', message: 'Exact terminal failure.' }] } as never);
    const p = props(); render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await waitFor(() => expect(panelProps.calculationDiagnostics?.readError).toContain('diagnostic could not be read'));
    expect(fetchPathFinderJob).toHaveBeenCalledOnce(); expect(panelProps.calculationDiagnostics?.itemMessage).toBeNull();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: listRow } as never);
    await act(async () => { await panelProps.onRefresh?.(); });
    await waitFor(() => expect(panelProps.calculationDiagnostics?.itemMessage).toBe('Exact terminal failure.'));
    expect(fetchPathFinderJob).toHaveBeenCalledTimes(2); expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it('keeps search inputs, popup and exact selected detail reads available without calculation preferences', async () => {
    const p = props(), readPreferences = { secondaryDistanceMeters: 2, preferVerticalApproach: true }, configure = vi.fn();
    render(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={readPreferences} onConfigureCalculation={configure} />);
    expect(listProps.active).toBe(true); expect(listProps.preferences).toEqual(readPreferences);
    await openListCable();
    expect(screen.getByRole('dialog')).toBeVisible(); expect(window.open).toHaveBeenCalledOnce();
    expect(panelProps.access.active).toBe(true); expect(panelProps.access.calculation).toBeNull();
    expect(panelProps.access.initialFill).toBeNull(); expect(panelProps.onCalculate).toBeTypeOf('function');
    expect(panelProps.calculationBlockedReason).toMatch(/Configure the current route settings and barriers/);
    expect(panelProps.onConfigureCalculation).toBe(configure);
    await act(async () => { await panelProps.onCalculate?.(); });
    expect(configure).toHaveBeenCalledOnce(); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
    expect(screen.getByText(/No calculation was submitted/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh selected cable' }));
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledExactlyOnceWith(id(1), 'fixture-token', id(3), readPreferences, expect.any(AbortSignal)));
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(fetchLocationImpacts).not.toHaveBeenCalled();
    expect(vi.mocked(usePathfinderLocationImpactProgress).mock.calls.at(-1)?.[0].active).toBe(false);
    expect(vi.mocked(usePathfinderInitialFillProgress).mock.calls.at(-1)?.[0].active).toBe(false);
  });
  it('keeps only exact retained Apply recovery reachable when calculation preferences are unavailable', async () => {
    const p = props(), review = reviewController(id(3), id(80));
    const readPreferences = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
    const view = render(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={readPreferences} review={review} />);
    await openListCable(); expect(panelProps.review).toBeNull();
    const recovery = { ...review, pending: true, canReview: false, canApply: false, canRecover: true };
    view.rerender(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={readPreferences} review={recovery} />);
    expect(panelProps.review).toBe(recovery); expect(panelProps.onCalculate).toBeUndefined();
    expect(review.review).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled();
    expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('retains exact comparison while respecting the Results owner current-proof refusal', async () => {
    listRow = cableWorkflowRowSchema.parse({ ...row(), cable: { ...row().cable, routing: '/STORED', designLength: '30' },
      calculation: { ...row().calculation, jobId: id(70), jobStatus: 'complete', proposalId: id(80), proposalHash: 'f'.repeat(64) } });
    const p = props(), review = { ...reviewController(id(3), id(80)), canReview: false, canApply: false, comparison: cableComparisonInputSchema.parse({
      projectId: id(1), cableId: id(3), current: { source: 'live-cable-read', contextSha256: 'a'.repeat(64), mto: listRow.mto, cable: listRow.cable },
      proposal: { projectId: id(1), cableId: id(3), proposalId: id(80), proposalHash: 'f'.repeat(64), revisionResultHash: 'b'.repeat(64),
        cableWriteRevision: '4', routing: '/PROPOSED', designLength: '32' },
    }) }, readPreferences = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
    const view = render(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={readPreferences} review={review} />);
    await openListCable();
    expect(panelProps.review?.comparison).toBe(review.comparison); expect(panelProps.review?.canReview).toBe(false); expect(panelProps.review?.canApply).toBe(false);
    expect(review.canReview).toBe(false); expect(review.canApply).toBe(false); expect(panelProps.access.initialFill).toBeNull();
    view.rerender(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={readPreferences} review={{ ...review, proposalId: id(99) }} />);
    expect(panelProps.review).toBeNull();
    view.rerender(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={readPreferences} review={{ ...review, cableId: id(99) }} />);
    expect(panelProps.review).toBeNull(); expect(review.review).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled(); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('keeps exact recorded-bypass Review/Apply separate from an unconfigured next-drill-OFF draft', async () => {
    listRow = cableWorkflowRowSchema.parse({ ...row(), calculation: { ...row().calculation, jobId: id(70), jobStatus: 'complete', proposalId: id(80), proposalHash: 'f'.repeat(64) } });
    const p = props(), strict = barrierCalculationFixture(id, true).preferences;
    const review = { ...reviewController(id(3), id(80)), recordedDrillThroughWalls: true, canApply: true }, readPreferences = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
    const view = render(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={readPreferences} getCalculationPreferences={drill => drill ? strict : null} review={review} />);
    await openListCable();
    expect(panelProps.drillThroughWalls).toBe(false); expect(panelProps.calculationBlockedReason).toBeTruthy(); expect(panelProps.review).toBe(review);
    act(() => panelProps.onDrillThroughWallsChange?.(true)); act(() => panelProps.onDrillThroughWallsChange?.(false));
    expect(panelProps.review?.canReview).toBe(true); expect(panelProps.review?.canApply).toBe(true); expect(panelProps.review?.recordedDrillThroughWalls).toBe(true);
    expect(panelProps.access.calculation).toBeNull(); expect(panelProps.access.initialFill).toBeNull();
    // A changed/stale/pending current proof is still refused by Results, which
    // owns these exact action callbacks. The draft grants no approval itself.
    const blocked = { ...review, canReview: false, canApply: false };
    view.rerender(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={readPreferences} getCalculationPreferences={drill => drill ? strict : null} review={blocked} />);
    expect(panelProps.review?.canReview).toBe(false); expect(panelProps.review?.canApply).toBe(false); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('keeps current administrator and ready-model fences for read-only popup access', async () => {
    const p = props(), readPreferences = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
    const view = render(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={readPreferences} />);
    expect(screen.getByRole('button', { name: 'Needs routing cable' })).toBeEnabled();
    view.rerender(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={readPreferences} pf={{ ...p.pf, viewerPhase: 'loading' }} />);
    expect(screen.getByRole('button', { name: 'Needs routing cable' })).toBeDisabled();
    view.rerender(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={readPreferences} isAdmin={false} />);
    expect(screen.queryByText('Needs routing cable')).toBeNull(); expect(window.open).not.toHaveBeenCalled();
  });
  it('passes only the exact selected proposal controller to the popup', async () => {
    listRow = cableWorkflowRowSchema.parse({ ...row(), calculation: { ...row().calculation, jobId: id(70), jobStatus: 'complete', proposalId: id(80), proposalHash: 'f'.repeat(64) } });
    const p = props(), review = reviewController(id(3), id(80)), view = render(<PathFinderCableWorkspace {...p} review={review} />);
    await openListCable(); expect(panelProps.review).toBe(review);
    view.rerender(<PathFinderCableWorkspace {...p} review={{ ...review, cableId: id(99) }} />); expect(panelProps.review).toBeNull();
    view.rerender(<PathFinderCableWorkspace {...p} review={{ ...review, proposalId: id(99) }} />); expect(panelProps.review).toBeNull();
    const recovery = { ...review, proposalId: id(99), pending: true, canReview: false, canApply: false, canRecover: true };
    view.rerender(<PathFinderCableWorkspace {...p} review={recovery} />); expect(panelProps.review).toBe(recovery);
    expect(review.review).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled();
  });
  it('follows only the explicitly submitted new calculation and never reuses the earlier popup approval', async () => {
    listRow = cableWorkflowRowSchema.parse({ ...row(), cable: { ...row().cable, routing: '/OLD', designLength: '150' },
      calculation: { ...row().calculation, jobId: id(70), jobStatus: 'complete', proposalId: id(80), proposalHash: 'e'.repeat(64) } });
    const available = { status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false,
      candidateObjectIds: [], reasonCode: null, engineeringAccepted: false };
    const completed = cableWorkflowRowSchema.parse({ ...listRow, from: available, to: available, calculation: { ...listRow.calculation, jobId: id(71), jobStatus: 'complete', itemState: 'complete',
      outcome: 'calculated', currentness: 'current', reviewable: true, proposalId: id(81), proposalHash: 'f'.repeat(64) } });
    const p = props(), started = vi.fn(), oldReview = reviewController(id(3), id(80));
    vi.mocked(p.pf.submitCalculation).mockResolvedValueOnce({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: completed } as never);
    const view = render(<PathFinderCableWorkspace {...p} review={oldReview} onCalculationStart={started} />);
    await openListCable(); expect(panelProps.review).toBe(oldReview);
    await act(async () => { await panelProps.onCalculate?.(); });
    await waitFor(() => expect(p.onSelect).toHaveBeenLastCalledWith(completed));
    expect(started).toHaveBeenCalledExactlyOnceWith(id(3)); expect(panelProps.review).toBeNull(); expect(panelProps.calculationPending).toBe(false);
    const freshReview = reviewController(id(3), id(81)); view.rerender(<PathFinderCableWorkspace {...p} review={freshReview} onCalculationStart={started} />);
    expect(panelProps.review).toBe(freshReview); expect(panelProps.cable!.cable).toMatchObject({ routing: '/OLD', designLength: '150' });
    expect(oldReview.review).not.toHaveBeenCalled(); expect(freshReview.apply).not.toHaveBeenCalled(); expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
  });
  it('opens the selected bounded row without global refresh and supplies the new automatic ownership policy', async () => {
    const p = props(); render(<PathFinderCableWorkspace {...p} />); await openListCable();
    expect(screen.getByRole('dialog')).toBeVisible(); expect(p.onSelect).toHaveBeenCalledWith(row()); expect(p.pf.refresh).not.toHaveBeenCalled();
    expect(panelProps.access).toMatchObject({ calculation: { preferences: p.preferences, timeoutMilliseconds: 120000 }, initialFill: null,
      automaticPairPolicy: { schemaVersion: 'wfc.pf.automatic-pair-policy.v1', mode: 'when-both-empty-or-unchanged-automatic' }, readSelection: p.pf.readSelection });
    expect(listProps.active).toBe(true);
  });
  it('saves endpoints without a calculation mandate and leaves an explicit configuration-directed Calculate reachable', async () => {
    listRow = cableWorkflowRowSchema.parse({ ...row(), cable: { ...row().cable, routing: '/STORED', designLength: '30' } });
    const p = props(), configure = vi.fn(), readPreferences = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: listRow } as never);
    render(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={readPreferences} onConfigureCalculation={configure} />);
    await openListCable();
    expect(panelProps.access).toMatchObject({ active: true, calculation: null, initialFill: null });
    const original = panelProps.cable!.cable, scope = endpointBindingFixture().context.current!;
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8), status: 'blocked' } } as CableEndpointReceipt, scope, null); });
    expect(screen.getByText(/This Save did not request recalculation or automatic Cable list updates/)).toBeVisible();
    expect(screen.queryByText(/queued for recalculation/)).toBeNull(); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
    expect(panelProps.cable!.cable).toEqual(original); expect(panelProps.onCalculate).toBeTypeOf('function');
    expect(vi.mocked(usePathfinderLocationImpactProgress).mock.calls.at(-1)?.[0].active).toBe(false);
    expect(vi.mocked(usePathfinderInitialFillProgress).mock.calls.at(-1)?.[0].active).toBe(false);
    await act(async () => { await panelProps.onCalculate?.(); });
    expect(configure).toHaveBeenCalledOnce(); expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.refresh).not.toHaveBeenCalled();
    expect(panelProps.cable!.cable).toMatchObject({ routing: '/STORED', designLength: '30' });
  });
  it('keeps selected cable across popup close and opens it again', async () => {
    render(<PathFinderCableWorkspace {...props()} />); await openListCable(); fireEvent.click(screen.getByText('Close routing popup'));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByText(/Selected cable: C-001/)).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByText('Open selected cable')); }); expect(screen.getByRole('dialog')).toBeVisible();
  });
  it.each(['account', 'model'] as const)('clears old popup ownership on %s change', async kind => {
    const p = props(), view = render(<PathFinderCableWorkspace {...p} />); await openListCable();
    const next = kind === 'account' ? { ...p, accountId: id(22) }
      : { ...p, pf: { ...p.pf, data: { ...p.pf.data!, activeModel: { ...p.pf.data!.activeModel, selectionRevision: '77' } } } };
    view.rerender(<PathFinderCableWorkspace {...next} />); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText(/Selected cable:/)).toBeNull();
  });
  it('retains the selected popup and original unknown submission across route settings and filtered selection removal', async () => {
    const p = props(), view = render(<PathFinderCableWorkspace {...p} selectedCableId={id(3)} />);
    await openListCable(); await act(async () => { await panelProps.onCalculate?.(); });
    view.rerender(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={null} selectedCableId={null} />);
    expect(screen.getByRole('dialog')).toBeVisible(); expect(panelProps.access.active).toBe(true);
    expect(panelProps.cable?.cable.id).toBe(id(3)); expect(panelProps.calculationPending).toBe(true); expect(panelProps.onCalculate).toBeUndefined();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce({ projectId: id(1), cableId: id(3), row: row() } as never);
    await act(async () => { await panelProps.onRefresh?.(); });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    expect(vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]?.aborted).toBe(false);
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenLastCalledWith(id(1), 'fixture-token', id(3), p.preferences, expect.any(AbortSignal));
    view.rerender(<PathFinderCableWorkspace {...p} preferences={{ ...p.preferences!, secondaryDistanceMeters: 3 }} selectedCableId={null} />);
    expect(screen.getByRole('dialog')).toBeVisible(); expect(panelProps.calculationPending).toBe(true); expect(panelProps.onCalculate).toBeUndefined();
    expect(p.pf.submitCalculation).toHaveBeenCalledOnce(); expect(p.onCalculationPreferences).toBeUndefined();
  });
  it('keeps last selected values on a failed GET, fences approval, and restores it only after a successful current read', async () => {
    const p = props(), review = { ...reviewController(id(3), id(80)), canApply: true };
    listRow = { ...row(), cable: { ...row().cable, routing: '/STORED', designLength: '39' }, calculation: { ...row().calculation, proposalId: id(80) } };
    const original = listRow;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(new Error('transient GET failure'));
    render(<PathFinderCableWorkspace {...p} review={review} />); await openListCable();
    expect(panelProps.review).toBe(review);
    await act(async () => { await panelProps.onRefresh?.(); });
    expect(panelProps.cable).toEqual(original); expect(panelProps.refreshError).toContain('Last read values are retained'); expect(panelProps.review).toBeNull();
    expect(panelProps.refreshing).toBe(false); expect(panelProps.onRefresh).toBeTypeOf('function');
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(new Error('second transient GET failure'));
    act(() => panelProps.onClose()); await act(async () => { fireEvent.click(screen.getByText('Open selected cable')); });
    expect(panelProps.review).toBeNull(); expect(panelProps.refreshError).toContain('Last read values are retained');
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce({ projectId: id(1), cableId: id(3), row: { ...original, cable: { ...original.cable, designLength: '40' } } } as never);
    await act(async () => { await panelProps.onRefresh?.(); });
    expect(panelProps.cable?.cable.designLength).toBe('40'); expect(panelProps.refreshError).toBeNull(); expect(panelProps.review).toBe(review);
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled();
  });
  it('preserves a confirmed endpoint Save disposition through failed and successful cable GET refreshes', async () => {
    const p = props(); render(<PathFinderCableWorkspace {...p} />); await openListCable();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(new Error('transient GET failure'));
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3) } as CableEndpointReceipt, endpointBindingFixture().context.current!, null); });
    expect(screen.getByText(/This Save did not request recalculation or automatic Cable list updates/)).toBeVisible();
    expect(panelProps.refreshError).toContain('Last read values are retained');
    await act(async () => { await panelProps.onRefresh?.(); });
    expect(panelProps.refreshError).toBeNull();
    expect(screen.getByText(/This Save did not request recalculation or automatic Cable list updates/)).toBeVisible();
    expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('automatically recovers an acknowledged job after a transient first poll failure without submitting again', async () => {
    vi.useFakeTimers();
    const p = props(); vi.mocked(p.pf.submitCalculation).mockResolvedValueOnce({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(new Error('temporary poll failure'));
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.onCalculate?.(); });
    expect(panelProps.calculationFeedback?.message).toContain('Checking again automatically');
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.onCalculate).toBeUndefined();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce({ projectId: id(1), cableId: id(3), row: { ...row(), calculation: { ...row().calculation, jobId: id(71), jobStatus: 'failed', outcome: 'failed' } } } as never);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.onCalculate).toBeTypeOf('function');
    expect(panelProps.calculationFeedback?.message).toContain('stopped without an applicable route'); expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
  });
  it('recovers the exact calculated result after a transient full read and enables its verified Show without manual refresh', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), complete = calculatedRow(71, 81);
    vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(Object.assign(new Error('read timeout'), { code: 'REQUEST_TIMEOUT', status: null }))
      .mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    render(<PathFinderCableWorkspace {...p} display={{ cableId: id(3), jobId: id(71), proposalId: id(81), proposalHash: 'f'.repeat(64), verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: true, visible: false, routing: '/NEW', designLength: '58' }} />);
    await openListCable(); await act(async () => { await panelProps.onCalculate?.(); });
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.pathReady).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.pathReady).toBe(true); expect(panelProps.calculatedRouting).toBe('/NEW');
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(2); expect(p.pf.submitCalculation).toHaveBeenCalledOnce(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it('settles an exact current result even when the optional global history refresh returns null', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), state = p.pf.data!, complete = calculatedRow(71, 81);
    vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(p.pf.refreshState).mockResolvedValueOnce(null).mockResolvedValue(state);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.onCalculate?.(); }); expect(panelProps.calculationPending).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(panelProps.calculationPending).toBe(false); expect(p.pf.refreshState).toHaveBeenCalledOnce(); expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
  });
  it('does not reuse earlier display proof when the acknowledgement refresh reveals a changed artifact', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), complete = calculatedRow(71, 81);
    const state = { ...p.pf.data!, artifacts: [{ id: id(105), snapshotSha256: 'a'.repeat(64) } as never] };
    const display = { cableId: id(3), jobId: id(71), proposalId: id(81), proposalHash: 'f'.repeat(64), verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: true, visible: false, routing: '/NEW', designLength: '58' };
    vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    let advanceState!: () => void;
    function Harness() {
      const [current, setCurrent] = useState(p.pf.data);
      advanceState = () => setCurrent(state);
      return <PathFinderCableWorkspace {...p} pf={{ ...p.pf, data: current }} display={display} />;
    }
    render(<Harness />);
    vi.mocked(p.pf.refreshState).mockImplementation(async () => { advanceState(); return state; });
    await openListCable(); await act(async () => { await panelProps.onCalculate?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(panelProps.calculationPending).toBe(false);
    expect(panelProps.refreshError).toBeNull(); expect(panelProps.calculationPending).toBe(false); expect(panelProps.pathReady).toBe(false);
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
  });
  it('uses cheap job reads while the selected item runs, then hands off one current detail without waiting for siblings or global state', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props();
    p.pf.readJob = vi.fn(); vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    let finished = false;
    vi.mocked(fetchPathFinderJob).mockImplementation(async () => ({ id: id(71), projectId: id(1), status: 'running', cancelRequested: false,
      items: [{ cableId: id(3), state: finished ? 'complete' : 'running', status: finished ? 'calculated' : 'calculating' }, { cableId: id(44), state: 'running', status: 'calculating' }] }) as never);
    const complete = calculatedRow(71, 81); complete.calculation.jobStatus = 'running'; complete.calculation.acceptedMatchesCurrent = true;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    render(<PathFinderCableWorkspace {...p} />); await openListCable(); await act(async () => { await panelProps.onCalculate?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetchPathFinderJob).toHaveBeenCalledTimes(3); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled(); expect(panelProps.calculationPending).toBe(true);
    finished = true; await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(p.pf.refreshState).toHaveBeenCalledOnce(); expect(p.pf.readJob).not.toHaveBeenCalled();
    expect(panelProps.calculationPending).toBe(false); expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
  });
  it('finishes the exact explicit job with its frozen preferences after the next calculation draft changes', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), frozen = structuredClone(barrierCalculationFixture(id, false).preferences);
    const nextDraft = { ...frozen, secondaryDistanceMeters: 5, barrierRouting: { ...frozen.barrierRouting!, drillThroughWalls: true } };
    let finished = false;
    vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderJob).mockImplementation(async () => ({ id: id(71), projectId: id(1), status: finished ? 'complete' : 'running', cancelRequested: false,
      items: [{ cableId: id(3), state: finished ? 'complete' : 'running', status: finished ? 'calculated' : 'calculating' }] }) as never);
    const complete = calculatedRow(71, 81), display = { cableId: id(3), jobId: id(71), proposalId: id(81), proposalHash: 'f'.repeat(64),
      verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: true, visible: false, routing: '/EXACT', designLength: '58' };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    const view = render(<PathFinderCableWorkspace {...p} preferences={frozen} readPreferences={frozen} display={display} />);
    await openListCable(); await act(async () => { await panelProps.onCalculate?.(); });
    expect(panelProps.calculationPending).toBe(true);
    view.rerender(<PathFinderCableWorkspace {...p} preferences={nextDraft} readPreferences={nextDraft} display={display} />);
    finished = true; await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    expect(vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][3]).toEqual(frozen);
    expect(p.onSelect).toHaveBeenLastCalledWith(complete); expect(panelProps.calculationPending).toBe(false);
    expect(panelProps.refreshError).toBeNull(); expect(panelProps.pathReady).toBe(true); expect(panelProps.onCalculate).toBeTypeOf('function');
    expect(p.pf.submitCalculation).toHaveBeenCalledExactlyOnceWith([id(3)], frozen);
  });
  it.each(['explicit', 'save'] as const)('retains unresolved %s ownership and refuses late reads after the prepared viewer generation changes', async mode => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(); let finished = false;
    vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderJob).mockImplementation(async () => ({ id: id(71), projectId: id(1), status: finished ? 'complete' : 'running', cancelRequested: false,
      items: [{ cableId: id(3), state: finished ? 'complete' : 'running', status: finished ? 'calculated' : 'calculating' }] }) as never);
    const view = render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => {
      if (mode === 'explicit') await panelProps.onCalculate?.();
      else await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt,
        endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 });
    });
    view.rerender(<PathFinderCableWorkspace {...p} pf={{ ...p.pf, preparationViewerGeneration: p.pf.preparationViewerGeneration + 1 }} />);
    finished = true; await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled(); expect(p.onSelect).toHaveBeenCalledExactlyOnceWith(listRow);
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.pathReady).toBe(false); expect(panelProps.onCalculate).toBeUndefined();
    expect(p.pf.submitCalculation).toHaveBeenCalledTimes(mode === 'explicit' ? 1 : 0);
  });
  it.each(['fetch', 'body'] as const)('bounds an unresponsive cheap job %s read and automatically recovers the exact result', async phase => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), complete = calculatedRow(71, 81);
    vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    if (phase === 'fetch') vi.mocked(fetchPathFinderJob).mockImplementationOnce(() => new Promise(() => {}));
    else {
      const original = await vi.importActual<typeof import('@/api/pathfinder')>('@/api/pathfinder');
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start() {} })));
      vi.mocked(fetchPathFinderJob).mockImplementationOnce(original.fetchPathFinderJob);
    }
    vi.mocked(fetchPathFinderJob).mockResolvedValue({ id: id(71), projectId: id(1), status: 'complete', cancelRequested: false,
      items: [{ cableId: id(3), state: 'complete', status: 'calculated' }] } as never);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    const view = render(<PathFinderCableWorkspace {...p} display={{ cableId: id(3), jobId: id(71), proposalId: id(81), proposalHash: 'f'.repeat(64),
      verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: true, visible: false, routing: '/EXACT', designLength: '58' }} />);
    await openListCable(); await act(async () => { await panelProps.onCalculate?.(); });
    const signal = vi.mocked(fetchPathFinderJob).mock.calls[0][3]!;
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.pathReady).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(signal.aborted).toBe(true); expect(panelProps.calculationFeedback?.message).toContain('Checking again automatically');
    expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.pathReady).toBe(true);
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(p.pf.submitCalculation).toHaveBeenCalledOnce(); view.unmount();
  });
  it('caps the final hanging cheap job read at the remaining overall polling budget', async () => {
    vi.useFakeTimers(); const p = props();
    vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderJob).mockImplementation(() => new Promise(() => {}));
    const view = render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.onCalculate?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_001); });
    expect(fetchPathFinderJob).toHaveBeenCalledTimes(4);
    expect(vi.mocked(fetchPathFinderJob).mock.calls.at(-1)?.[3]?.aborted).toBe(true);
    expect(panelProps.calculationFeedback).toMatchObject({ working: true, message: expect.stringContaining('same calculation again automatically') });
    await act(async () => { await vi.advanceTimersByTimeAsync(125_000); });
    expect(fetchPathFinderJob).toHaveBeenCalledTimes(8);
    expect(vi.mocked(fetchPathFinderJob).mock.calls.at(-1)?.[3]?.aborted).toBe(true);
    expect(panelProps.calculationFeedback).toMatchObject({ working: false, message: expect.stringContaining('outcome is not confirmed') });
    expect(panelProps.calculationPending).toBe(true); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
    expect(p.pf.submitCalculation).toHaveBeenCalledOnce(); view.unmount();
  });
  it('recovers a hanging saved-impact cheap job read without another Save or calculation', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), complete = calculatedRow(71, 81);
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderJob).mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue({ id: id(71), projectId: id(1), status: 'complete', cancelRequested: false,
      items: [{ cableId: id(3), state: 'complete', status: 'calculated' }] } as never);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    const view = render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt,
      endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 }); });
    const signal = vi.mocked(fetchPathFinderJob).mock.calls[0][3]!;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); }); expect(signal.aborted).toBe(true);
    expect(panelProps.calculationPending).toBe(true); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.cable?.calculation.proposalId).toBe(id(81));
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled(); view.unmount();
  });
  it('retries a saved-location read failure and converges without another calculation or manual refresh', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), complete = calculatedRow(71, 81);
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(Object.assign(new Error('temporarily unavailable'), { status: 503 }))
      .mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    render(<PathFinderCableWorkspace {...p} display={{ cableId: id(3), jobId: id(71), proposalId: id(81), proposalHash: 'f'.repeat(64), verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: true, visible: false, routing: '/SAVED', designLength: '58' }} />);
    await openListCable();
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt,
      endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 }); });
    expect(panelProps.calculationPending).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.pathReady).toBe(true); expect(panelProps.calculatedRouting).toBe('/SAVED');
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it('follows a saved impact through cheap selected-item reads and ignores competing progress refreshes while math runs', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(); let finished = false;
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderJob).mockImplementation(async () => ({ id: id(71), projectId: id(1), status: 'running', cancelRequested: false,
      items: [{ cableId: id(3), state: finished ? 'complete' : 'running', status: finished ? 'calculated' : 'calculating' }] }) as never);
    const complete = calculatedRow(71, 81); complete.calculation.jobStatus = 'running'; complete.calculation.acceptedMatchesCurrent = true;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt,
      endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetchPathFinderJob).toHaveBeenCalledTimes(3); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
    act(() => { vi.mocked(usePathfinderInitialFillProgress).mock.calls.at(-1)?.[0].onChanged?.(writeProgress()); });
    expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled(); expect(panelProps.calculationPending).toBe(true);
    finished = true; await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(panelProps.calculationPending).toBe(false);
    expect(p.pf.refreshState).toHaveBeenCalledOnce(); expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it.each([70_000, 100_000])('converges a saved automatic write after %sms without repeated project state reads or a second submission', async elapsed => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), startedAt = Date.now(), complete = calculatedRow(71, 81);
    complete.calculation.jobStatus = 'running'; complete.calculation.acceptedMatchesCurrent = true;
    const pending = { ...complete, calculation: { ...complete.calculation, acceptedMatchesCurrent: false,
      automaticUpdate: { status: 'running' as const, receiptId: null, reasonCode: null } } };
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderJob).mockResolvedValue({ id: id(71), projectId: id(1), status: 'running', cancelRequested: false,
      items: [{ cableId: id(3), state: 'complete', status: 'calculated' }, { cableId: id(44), state: 'running', status: 'calculating' }] } as never);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(async () => ({ projectId: id(1), cableId: id(3),
      row: Date.now() - startedAt >= elapsed ? complete : pending }) as never);
    render(<PathFinderCableWorkspace {...p} display={{ cableId: id(3), jobId: id(71), proposalId: id(81), proposalHash: 'f'.repeat(64),
      verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: true, visible: false, routing: '/CURRENT', designLength: '58' }} />);
    await openListCable();
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt,
      endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(elapsed - 1); });
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.pathReady).toBe(false);
    expect(p.pf.refreshState).toHaveBeenCalledOnce(); // The Save acknowledgement refresh only.
    expect(p.onSelect).toHaveBeenCalledExactlyOnceWith(listRow);
    if (elapsed === 100_000) expect(vi.mocked(fetchPathFinderJob).mock.calls.length + vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls.length).toBeGreaterThan(80);
    await act(async () => { await vi.advanceTimersByTimeAsync(1501); });
    expect(p.onSelect).toHaveBeenLastCalledWith(complete); expect(panelProps.calculationPending).toBe(false);
    expect(panelProps.pathReady).toBe(true); expect(panelProps.onCalculate).toBeTypeOf('function');
    expect(p.pf.refreshState).toHaveBeenCalledTimes(2); // One terminal refresh, after the selected write settles.
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it.each(['explicit', 'save'] as const)('finishes an exact %s result on the final polling round without spending its handoff budget on the status GET', async mode => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), complete = calculatedRow(71, 81); let rounds = 0;
    vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderJob).mockImplementation(async () => ({ id: id(71), projectId: id(1), status: 'running', cancelRequested: false,
      items: [{ cableId: id(3), state: ++rounds === 80 ? 'complete' : 'running', status: rounds === 80 ? 'calculated' : 'calculating' }] }) as never);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => {
      if (mode === 'explicit') await panelProps.onCalculate?.();
      else await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt,
        endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(118_499); });
    expect(fetchPathFinderJob).toHaveBeenCalledTimes(79); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchPathFinderJob).toHaveBeenCalledTimes(80); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    expect(panelProps.calculationPending).toBe(false); expect(p.onSelect).toHaveBeenLastCalledWith(complete);
    expect(p.pf.refreshState).toHaveBeenCalledOnce();
    expect(p.pf.submitCalculation).toHaveBeenCalledTimes(mode === 'explicit' ? 1 : 0); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it.each(['explicit', 'save'] as const)('automatically reconciles the same %s job after its first read window expires without another POST', async mode => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), complete = calculatedRow(71, 81);
    vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderJob).mockImplementation(() => new Promise(() => {}));
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => {
      if (mode === 'explicit') await panelProps.onCalculate?.();
      else await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt,
        endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_001); });
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.calculationFeedback).toMatchObject({ working: true, message: expect.stringContaining('same calculation again automatically') });
    vi.mocked(fetchPathFinderJob).mockResolvedValue({ id: id(71), projectId: id(1), status: 'complete', cancelRequested: false,
      items: [{ cableId: id(3), state: 'complete', status: 'calculated' }] } as never);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(panelProps.calculationPending).toBe(false); expect(p.onSelect).toHaveBeenLastCalledWith(complete);
    expect(fetchPathFinderJob).toHaveBeenLastCalledWith(id(1), 'fixture-token', id(71), expect.any(AbortSignal));
    expect(p.pf.submitCalculation).toHaveBeenCalledTimes(mode === 'explicit' ? 1 : 0); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it('hands off the saved cable with its frozen policy and restores Show and Calculate while twelve siblings keep running', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), acknowledged = vi.fn();
    const savedPreferences = structuredClone(barrierCalculationFixture(id, false).preferences);
    const expectedPreferences = structuredClone(savedPreferences);
    const complete = cableWorkflowRowSchema.parse({ ...calculatedRow(71, 81),
      cable: { ...calculatedRow(71, 81).cable, routing: '/CURRENT', designLength: '58', cableWriteRevision: '5' },
      calculation: { ...calculatedRow(71, 81).calculation, jobStatus: 'running', acceptedMatchesCurrent: true,
        itemApplicability: { schemaVersion: 'wfc.pf.sealed-cable-applicability.v2', dependencyVersion: 'pathfinder.dependencies.v8',
          projectId: id(1), jobId: id(71), cableId: id(3), proposalId: id(81), dependencyHash: 'a'.repeat(64), scope: 'sealed-cable-item' },
        automaticUpdate: { status: 'written', receiptId: id(91), reasonCode: null } } });
    let observed: CableWorkflowRow = { ...complete, calculation: { ...complete.calculation, acceptedMatchesCurrent: false,
      automaticUpdate: { status: 'running', receiptId: null, reasonCode: null } } };
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running',
      total: 13, completed: 1, reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderJob).mockResolvedValue({ id: id(71), projectId: id(1), status: 'running', cancelRequested: false,
      items: [{ cableId: id(3), state: 'complete', status: 'calculated' }, ...Array.from({ length: 12 }, (_, index) => ({
        cableId: id(200 + index), state: 'running', status: 'calculating' }))] } as never);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(async () => ({ projectId: id(1), cableId: id(3), row: observed }) as never);
    const received = vi.fn((value: CableWorkflowRow) => {
      if (value.calculation.jobId === id(71)) expect(acknowledged).toHaveBeenLastCalledWith({ cableId: id(3), jobId: id(71), preferences: expectedPreferences });
    });
    render(<PathFinderCableWorkspace {...p} onSelect={received} onCalculationPreferences={acknowledged}
      display={{ cableId: id(3), jobId: id(71), proposalId: id(81), proposalHash: 'f'.repeat(64),
        verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: true, visible: false, routing: '/CURRENT', designLength: '58' }} />);
    await openListCable(); const earlierCalculate = panelProps.onCalculate!;
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt,
      endpointBindingFixture().context.current!, { preferences: savedPreferences, timeoutMilliseconds: 120000 }); });
    // A calculated item is not a finished automatic Cable list write. Results
    // must not start a proof read against this intermediate cable revision.
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.onCalculate).toBeUndefined(); expect(panelProps.pathReady).toBe(false);
    expect(received).toHaveBeenCalledExactlyOnceWith(listRow); expect(acknowledged).not.toHaveBeenCalled();
    await act(async () => { await earlierCalculate(); }); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
    savedPreferences.secondaryDistanceMeters = 99; savedPreferences.barrierRouting!.drillThroughWalls = true;
    observed = complete;
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(acknowledged).toHaveBeenCalledExactlyOnceWith({ cableId: id(3), jobId: id(71), preferences: expectedPreferences });
    expect(received).toHaveBeenLastCalledWith(complete); expect(received).toHaveBeenCalledTimes(2);
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.endpointRefreshKey).toBe(1);
    expect(panelProps.pathReady).toBe(true); expect(panelProps.calculatedRouting).toBe('/CURRENT'); expect(panelProps.onCalculate).toBeTypeOf('function');
    expect(panelProps.cable?.calculation.jobStatus).toBe('running'); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
    expect(p.pf.calculate).not.toHaveBeenCalled(); expect(panelProps.refreshError).toBeNull();
    await act(async () => { await panelProps.onCalculate?.(); });
    expect(p.pf.submitCalculation).toHaveBeenCalledExactlyOnceWith([id(3)], p.preferences);
  });
  it.each(['absent', 'review-required'] as const)('hands off a manual-protected Save result with %s automatic update after the read draft changes', async automatic => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), acknowledged = vi.fn();
    const frozen = structuredClone(barrierCalculationFixture(id, false).preferences), expected = structuredClone(frozen);
    const nextDraft = { ...frozen, secondaryDistanceMeters: 5, barrierRouting: { ...frozen.barrierRouting!, drillThroughWalls: true } };
    const complete = cableWorkflowRowSchema.parse({ ...calculatedRow(71, 81),
      cable: { ...calculatedRow(71, 81).cable, routing: '/MANUAL', designLength: '59' },
      calculation: { ...calculatedRow(71, 81).calculation, jobStatus: 'running', acceptedMatchesCurrent: false,
        itemApplicability: { schemaVersion: 'wfc.pf.sealed-cable-applicability.v2', dependencyVersion: 'pathfinder.dependencies.v8',
          projectId: id(1), jobId: id(71), cableId: id(3), proposalId: id(81), dependencyHash: 'a'.repeat(64), scope: 'sealed-cable-item' },
        ...(automatic === 'review-required' ? { automaticUpdate: { status: 'review-required', receiptId: null, reasonCode: 'AUTOMATIC_PAIR_OWNERSHIP_CHANGED' } } : {}) } });
    let finished = false;
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderJob).mockImplementation(async () => ({ id: id(71), projectId: id(1), status: 'running', cancelRequested: false,
      items: [{ cableId: id(3), state: finished ? 'complete' : 'running', status: finished ? 'calculated' : 'calculating' },
        { cableId: id(44), state: 'running', status: 'calculating' }] }) as never);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    const display = { cableId: id(3), jobId: id(71), proposalId: id(81), proposalHash: 'f'.repeat(64), verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: true, visible: false,
      routing: '/PROPOSAL', designLength: '58' }, review = reviewController(id(3), id(81));
    const view = render(<PathFinderCableWorkspace {...p} preferences={frozen} readPreferences={frozen} display={display} review={review} onCalculationPreferences={acknowledged} />);
    await openListCable();
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt,
      endpointBindingFixture().context.current!, { preferences: frozen, timeoutMilliseconds: 120000 }); });
    expect(panelProps.calculationPending).toBe(true);
    view.rerender(<PathFinderCableWorkspace {...p} preferences={nextDraft} readPreferences={nextDraft} display={display} review={review} onCalculationPreferences={acknowledged} />);
    finished = true; await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][3]).toEqual(expected);
    expect(acknowledged).toHaveBeenCalledExactlyOnceWith({ cableId: id(3), jobId: id(71), preferences: expected });
    expect(p.onSelect).toHaveBeenLastCalledWith(complete); expect(panelProps.calculationPending).toBe(false);
    expect(panelProps.pathReady).toBe(true); expect(panelProps.calculatedRouting).toBe('/PROPOSAL'); expect(panelProps.onCalculate).toBeTypeOf('function');
    expect(panelProps.cable?.cable).toMatchObject({ routing: '/MANUAL', designLength: '59' });
    expect(panelProps.review).toBe(review); expect(panelProps.refreshError).toBeNull();
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it('keeps the owned saved-impact progress enrolled when the next calculation configuration becomes unavailable', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), complete = calculatedRow(71, 81);
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: null, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderJob).mockResolvedValue({ id: id(71), projectId: id(1), status: 'complete', cancelRequested: false,
      items: [{ cableId: id(3), state: 'complete', status: 'calculated' }] } as never);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: complete } as never);
    const view = render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt,
      endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 }); });
    view.rerender(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={p.preferences} />);
    expect(vi.mocked(usePathfinderLocationImpactProgress).mock.calls.at(-1)?.[0]).toMatchObject({ active: true, impactId: id(8),
      calculation: { preferences: p.preferences, timeoutMilliseconds: 120000 } });
    expect(panelProps.access.calculation).toBeNull(); expect(panelProps.calculationPending).toBe(true);
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    view.rerender(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={p.preferences} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(p.onSelect).toHaveBeenLastCalledWith(complete); expect(panelProps.calculationPending).toBe(false);
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it('retains pending ownership when the current full read belongs to another job, then retries the exact owned result', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), exact = calculatedRow(71, 81);
    vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce({ projectId: id(1), cableId: id(3), row: calculatedRow(99, 89) } as never)
      .mockResolvedValue({ projectId: id(1), cableId: id(3), row: exact } as never);
    render(<PathFinderCableWorkspace {...p} />); await openListCable(); await act(async () => { await panelProps.onCalculate?.(); });
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.cable?.calculation.jobId).toBe(id(70)); expect(panelProps.pathReady).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.cable?.calculation.proposalId).toBe(id(81)); expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
  });
  it('does not suppress a new selected cable refresh because another cable retains a saved watcher', async () => {
    listRow = calculatedRow(); const p = props();
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderJob).mockResolvedValue({ id: id(71), projectId: id(1), status: 'running', cancelRequested: false,
      items: [{ cableId: id(3), state: 'running', status: 'calculating' }] } as never);
    const view = render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt,
      endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 }); });
    expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
    listRow = { ...row(), cable: { ...row().cable, id: id(44) } }; await openListCable();
    const refreshed = { ...listRow, cable: { ...listRow.cable, cableWriteRevision: '5' } };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(44), row: refreshed } as never);
    view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    expect(vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][2]).toBe(id(44)); expect(panelProps.calculationPending).toBe(false);
    expect(p.onSelect).toHaveBeenLastCalledWith(refreshed);
  });
  it('still refreshes the list from an external write when no cable is selected', async () => {
    const p = props(), view = render(<PathFinderCableWorkspace {...p} />), original = listProps.modelScopeKey;
    view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} />);
    expect(listProps.modelScopeKey).not.toBe(original); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
  });
  it.each([401, 403, 409])('fails closed after a nonretryable job read refusal %s', async status => {
    vi.useFakeTimers(); const p = props(); vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderJob).mockRejectedValue(Object.assign(new Error('refused'), { status }));
    render(<PathFinderCableWorkspace {...p} />); await openListCable(); await act(async () => { await panelProps.onCalculate?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250_000); });
    expect(fetchPathFinderJob).toHaveBeenCalledOnce(); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled(); expect(panelProps.calculationPending).toBe(true); expect(panelProps.pathReady).toBe(false);
    expect(p.pf.refresh).toHaveBeenCalledTimes(status === 409 ? 0 : 1); expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
  });
  it('keeps automatic recovery bounded and never submits a duplicate calculation on persistent transport failures', async () => {
    vi.useFakeTimers(); const p = props(); vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderJob).mockRejectedValue(Object.assign(new Error('read timeout'), { status: 503 }));
    render(<PathFinderCableWorkspace {...p} />); await openListCable(); await act(async () => { await panelProps.onCalculate?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250_000); });
    expect(fetchPathFinderJob).toHaveBeenCalledTimes(160); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled(); expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
    expect(panelProps.calculationFeedback?.working).toBe(false); expect(panelProps.calculationPending).toBe(true); expect(panelProps.pathReady).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); expect(fetchPathFinderJob).toHaveBeenCalledTimes(160);
  });
  it('ignores a late automatic full read after the user opens another cable', async () => {
    let resolve!: (value: unknown) => void; const p = props(); vi.mocked(p.pf.submitCalculation).mockResolvedValue({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(yes => { resolve = yes; }) as never);
    render(<PathFinderCableWorkspace {...p} />); await openListCable(); await act(async () => { await panelProps.onCalculate?.(); });
    const signal = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!;
    listRow = { ...row(), cable: { ...row().cable, id: id(44) } }; await openListCable();
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve({ projectId: id(1), cableId: id(3), row: calculatedRow(71, 81) }); });
    expect(panelProps.cable?.cable.id).toBe(id(44)); expect(p.onSelect).toHaveBeenLastCalledWith(listRow); expect(panelProps.pathReady).toBe(false);
    expect(p.pf.refreshState).toHaveBeenCalledOnce(); // The independent acknowledgement refresh.
  });
  it('saves exact impact scope then refreshes only bounded diagnostics and the selected cable', async () => {
    const p = props(); render(<PathFinderCableWorkspace {...p} />); await openListCable();
    const oldKey = listProps.modelScopeKey, scope = endpointBindingFixture().context.current!;
    act(() => { void panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt, scope); });
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledWith(id(1), 'fixture-token', id(3), p.preferences, expect.any(AbortSignal)));
    expect(listProps.modelScopeKey).not.toBe(oldKey); expect(p.pf.refresh).not.toHaveBeenCalled();
    expect(vi.mocked(usePathfinderLocationImpactProgress).mock.calls.at(-1)?.[0]).toMatchObject({ current: scope, impactId: id(8), active: true });
  });
  it('observes a first terminal write read but never calls it Updated without receipt-backed cable evidence', async () => {
    vi.mocked(usePathfinderInitialFillProgress).mockReturnValue({ progress: writeProgress(), error: null, refresh: vi.fn() } as never);
    const p = props(); render(<PathFinderCableWorkspace {...p} />); await openListCable();
    act(() => { void panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt, endpointBindingFixture().context.current!); });
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalled());
    expect(screen.queryByText(/Updated in Cable list/)).toBeNull(); expect(screen.getByText(/Needs routing or attention/)).toBeVisible();
  });
  it('rejects a late old-owner detail response after model change', async () => {
    let finish!: (value: Awaited<ReturnType<typeof fetchPathFinderCableWorkflowDetail>>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const p = props(), view = render(<PathFinderCableWorkspace {...p} />); await openListCable(); fireEvent.click(screen.getByText('Refresh selected cable'));
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    view.rerender(<PathFinderCableWorkspace {...p} accountId={id(88)} />);
    await act(async () => finish({ projectId: id(1), cableId: id(3), row: row() } as never)); expect(screen.queryByText(/Selected cable:/)).toBeNull(); expect(p.onSelect).toHaveBeenCalledTimes(1);
  });
  it('pauses endpoint and progress work without unmounting the saved popup state when Path is inactive', async () => {
    const p = props(), view = render(<PathFinderCableWorkspace {...p} />); await openListCable();
    view.rerender(<PathFinderCableWorkspace {...p} active={false} />); expect(screen.queryByRole('dialog')).toBeNull(); expect(panelProps.access.active).toBe(false);
    expect(vi.mocked(usePathfinderInitialFillProgress).mock.calls.at(-1)?.[0].active).toBe(false); view.rerender(<PathFinderCableWorkspace {...p} />); expect(screen.getByRole('dialog')).toBeVisible();
  });
  it('hydrates the externally selected cable without accepting an older workspace read or opening its popup', async () => {
    let finish!: (value: Awaited<ReturnType<typeof fetchPathFinderCableWorkflowDetail>>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const other = { ...row(), cable: { ...row().cable, id: id(44), tag: 'C-044' } };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce({ projectId: id(1), cableId: id(44), row: other } as never);
    const p = props(), view = render(<PathFinderCableWorkspace {...p} />);
    await openListCable(); fireEvent.click(screen.getByText('Refresh selected cable'));
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    const oldSignal = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!;
    view.rerender(<PathFinderCableWorkspace {...p} selectedCableId={id(44)} />);
    await waitFor(() => expect(p.onSelect).toHaveBeenLastCalledWith(other));
    expect(oldSignal.aborted).toBe(true); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(2);
    await act(async () => finish({ projectId: id(1), cableId: id(3), row: row() } as never));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(p.onSelect).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Selected cable: C-044/)).toBeVisible(); expect(screen.getByText('Open selected cable')).toBeVisible();
    expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it.each(['account', 'preparation'] as const)('fences a late restored-row GET after the %s scope changes', async kind => {
    let finish!: (value: Awaited<ReturnType<typeof fetchPathFinderCableWorkflowDetail>>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockReset().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(new Error('new-scope transport failure'));
    const p = props(), view = render(<PathFinderCableWorkspace {...p} selectedCableId={id(3)} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    const signal = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!;
    const next = kind === 'account' ? { ...p, accountId: id(88) }
      : { ...p, pf: { ...p.pf, preparationViewerGeneration: 8 } };
    view.rerender(<PathFinderCableWorkspace {...next} selectedCableId={id(3)} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(2));
    await act(async () => finish({ projectId: id(1), cableId: id(3), row: calculatedRow() } as never));
    expect(signal.aborted).toBe(true); expect(p.onSelect).not.toHaveBeenCalled(); expect(screen.queryByText(/Selected cable:/)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull(); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('refuses a restored-row GET from another cable and never opens or calculates it', async () => {
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockReset().mockResolvedValueOnce({ projectId: id(1), cableId: id(44), row: { ...row(), cable: { ...row().cable, id: id(44) } } } as never);
    const p = props(); render(<PathFinderCableWorkspace {...p} selectedCableId={id(3)} />);
    await waitFor(() => expect(screen.getByText(/selected cable could not be restored/)).toBeVisible());
    expect(p.onSelect).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull(); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('uses retained recovery calculation preferences rather than the editor’s changed values for progress', async () => {
    render(<PathFinderCableWorkspace {...props()} />); await openListCable();
    const original = { preferences: { secondaryDistanceMeters: 9, preferVerticalApproach: false }, timeoutMilliseconds: 7000 };
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt, endpointBindingFixture().context.current!, original); });
    expect(vi.mocked(usePathfinderLocationImpactProgress).mock.calls.at(-1)?.[0].calculation).toEqual(original);
    expect(screen.getByText(/Affected non-MV cables are queued for recalculation/)).toBeVisible();
  });
  it.each(['same', 'drilling changed', 'snapshot changed', 'legacy'] as const)('resumes only matching barrier-owned history: %s', async kind => {
    const p = props(), current = endpointBindingFixture().context.current!;
    const barrierRouting: BarrierAdmissionIntent = { schemaVersion: 'wfc.pf.barrier-admission-intent.v1',
      scope: { projectId: id(1), modelVersionId: current.modelVersionId, selectionRevision: current.selectionRevision,
        contentFingerprint: current.contentFingerprint, captureFrameId: id(51), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' },
      expectedRegistryRevision: '1', expectedSnapshot: null, drillThroughWalls: true };
    p.preferences = { ...p.preferences!, barrierRouting };
    const historical = structuredClone(p.preferences);
    if (kind === 'drilling changed') historical.barrierRouting = { ...barrierRouting, drillThroughWalls: false };
    if (kind === 'snapshot changed') historical.barrierRouting = { ...barrierRouting, expectedRegistryRevision: '2' };
    if (kind === 'legacy') delete historical.barrierRouting;
    vi.mocked(fetchLocationImpacts).mockResolvedValueOnce({ impacts: [{ id: id(8), ...current, current,
      calculation: { preferences: historical, timeoutMilliseconds: 120000 } }] } as never);
    render(<PathFinderCableWorkspace {...p} />);
    await waitFor(() => expect(fetchLocationImpacts).toHaveBeenCalledOnce());
    await act(async () => { await Promise.resolve(); });
    expect(vi.mocked(usePathfinderLocationImpactProgress).mock.calls.at(-1)?.[0].impactId).toBe(kind === 'same' ? id(8) : null);
  });
  it('refreshes the bounded list and live selected cable after an explicit confirmed Apply notification', async () => {
    const p = props(), view = render(<PathFinderCableWorkspace {...p} refreshKey={0} />); await openListCable();
    const previous = listProps.modelScopeKey; view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce()); expect(listProps.modelScopeKey).not.toBe(previous);
    expect(p.pf.refresh).not.toHaveBeenCalled(); view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} />);
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
  });
  it('defers a confirmed Apply refresh received while inactive until the same workspace resumes', async () => {
    const p = props(), view = render(<PathFinderCableWorkspace {...p} refreshKey={0} />); await openListCable();
    view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} active={false} />); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
    view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} />); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
  });
  it('does not mount new reads or UI without matching current administrator ownership', async () => {
    const p = props(); render(<PathFinderCableWorkspace {...p} isAdmin={false} />); expect(screen.queryByText('Needs routing cable')).toBeNull(); expect(fetchLocationImpacts).not.toHaveBeenCalled();
  });
  it('calculates only the selected non-MV cable after an explicit click, without an implicit Save or global calculation', async () => {
    const p = props(); render(<PathFinderCableWorkspace {...p} />); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
    await openListCable(); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
    await act(async () => { await panelProps.onCalculate?.(); });
    expect(p.pf.submitCalculation).toHaveBeenCalledExactlyOnceWith([id(3)], p.preferences); expect(p.pf.calculate).not.toHaveBeenCalled();
    expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
    expect(panelProps.calculationFeedback?.message).toContain('submission is unconfirmed');
    expect(p.pf.refresh).not.toHaveBeenCalled();
  });
  it.each(['queued', 'running'] as const)('removes Calculate while the selected cable already belongs to a %s job', async status => {
    listRow = cableWorkflowRowSchema.parse({ ...row(), calculation: { ...row().calculation, jobId: id(70), jobStatus: status, itemState: status === 'queued' ? 'waiting' : 'running' } });
    const p = props(); render(<PathFinderCableWorkspace {...p} />); await openListCable();
    expect(panelProps.onCalculate).toBeUndefined(); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('fences repeated selected-cable calculation while its first request is unsettled', async () => {
    let finish!: () => void; const p = props(); vi.mocked(p.pf.submitCalculation).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ kind: 'unknown', code: 'CALCULATION_SUBMISSION_UNKNOWN' }); }));
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    const captured = panelProps.onCalculate!;
    let first!: Promise<void>; act(() => { first = Promise.resolve(captured()); void captured(); });
    expect(panelProps.actionsBusy).toBe(true); await act(async () => { await panelProps.onCalculate?.(); }); expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
    await act(async () => { finish(); await first; }); expect(panelProps.actionsBusy).toBe(false);
  });
  it('does not refresh a different owner after a previous calculation finishes late', async () => {
    let finish!: () => void; const p = props(); vi.mocked(p.pf.submitCalculation).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ kind: 'unknown', code: 'CALCULATION_SUBMISSION_UNKNOWN' }); }));
    const view = render(<PathFinderCableWorkspace {...p} />); await openListCable();
    let first!: Promise<void>; act(() => { first = Promise.resolve(panelProps.onCalculate?.()); });
    view.rerender(<PathFinderCableWorkspace {...p} accountId={id(90)} />); await act(async () => { finish(); await first; });
    expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('passes only the selected cable display and protected toggle callback through Show/Hide', async () => {
    listRow = calculatedRow();
    const p = props(), toggle = vi.fn(), display = { cableId: id(3), jobId: id(70), proposalId: id(80), proposalHash: 'f'.repeat(64), verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: true, visible: true, routing: '/NEW/SECONDARY', designLength: '180' };
    const view = render(<PathFinderCableWorkspace {...p} onTogglePath={toggle} display={display} />); await openListCable();
    expect(panelProps).toMatchObject({ pathVisible: true, calculatedRouting: '/NEW/SECONDARY', calculatedDesignLength: '180' });
    act(() => panelProps.onTogglePath?.()); expect(toggle).toHaveBeenCalledExactlyOnceWith(id(3)); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
    view.rerender(<PathFinderCableWorkspace {...p} onTogglePath={toggle} display={{ ...display, cableId: id(99) }} />);
    expect(panelProps.pathVisible).toBe(false); expect(panelProps.calculatedRouting).toBeUndefined(); expect(panelProps.calculatedDesignLength).toBeUndefined();
    view.rerender(<PathFinderCableWorkspace {...p} onTogglePath={toggle} display={{ ...display, routing: null, designLength: null, visible: false }} />);
    expect(panelProps.calculatedRouting).toBeNull(); expect(panelProps.calculatedDesignLength).toBeNull();
  });
  it('follows the saved location recalculation without a second POST and withholds the old path until the exact new result is ready', async () => {
    vi.useFakeTimers(); listRow = calculatedRow();
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', currentAuthority: true, reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    const p = props(), started = vi.fn(), toggle = vi.fn(), current = endpointBindingFixture().context.current!;
    const display = { cableId: id(3), jobId: id(70), proposalId: id(80), proposalHash: 'f'.repeat(64), verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: true, visible: true, routing: '/OLD', designLength: '56' };
    let observed = listRow;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(async () => ({ projectId: id(1), cableId: id(3), row: observed }) as never);
    const view = render(<PathFinderCableWorkspace {...p} display={display} onCalculationStart={started} onTogglePath={toggle} />);
    await openListCable(); expect(panelProps.pathReady).toBe(true);
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt, current,
      { preferences: p.preferences!, timeoutMilliseconds: 120000 }); });
    expect(started).toHaveBeenCalledExactlyOnceWith(id(3)); expect(p.pf.refreshState).toHaveBeenCalledOnce();
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.pathReady).toBe(false); expect(panelProps.calculatedRouting).toBeUndefined();
    observed = calculatedRow(71, 81);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.endpointRefreshKey).toBe(1);
    expect(panelProps.pathReady).toBe(false); expect(panelProps.calculatedRouting).toBeUndefined();
    expect(panelProps.calculationFeedback?.message).toContain('Loading and checking');
    const replacement = { ...display, jobId: id(71), proposalId: id(81), routing: '/NEW', designLength: '61', verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: false, visible: false };
    view.rerender(<PathFinderCableWorkspace {...p} display={replacement} onCalculationStart={started} onTogglePath={toggle} />);
    expect(panelProps.pathReady).toBe(false); expect(panelProps.calculatedRouting).toBe('/NEW'); expect(panelProps.calculatedDesignLength).toBe('61');
    await act(async () => { view.rerender(<PathFinderCableWorkspace {...p} display={{ ...replacement, ready: true }} onCalculationStart={started} onTogglePath={toggle} />); });
    expect(panelProps.pathReady).toBe(true); expect(panelProps.calculatedRouting).toBe('/NEW');
    expect(panelProps.calculationFeedback?.message).toContain('current route is ready');
    act(() => panelProps.onTogglePath?.()); expect(toggle).toHaveBeenCalledExactlyOnceWith(id(3));
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it('keeps the popup pending after calculation completion until its automatic pair write is confirmed', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props();
    vi.mocked(p.pf.submitCalculation).mockResolvedValueOnce({kind:'acknowledged',jobId:id(71),registryRevision:'5',duplicate:false});
    const pending = calculatedRow(71,81); pending.calculation.automaticUpdate = {status:'pending',receiptId:null,reasonCode:null};
    let observed = pending;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(async () => ({projectId:id(1),cableId:id(3),row:observed}) as never);
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => {await panelProps.onCalculate?.();});
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.pathReady).toBe(false);
    expect(panelProps.calculationFeedback?.message).toContain('Updating the automatic Cable list values');
    expect(panelProps.onCalculate).toBeUndefined(); expect(panelProps.endpointRefreshKey).toBe(0);
    observed = {...pending,cable:{...pending.cable,routing:'/NEW',designLength:'58',cableWriteRevision:'5'},
      calculation:{...pending.calculation,acceptedMatchesCurrent:true,automaticUpdate:{status:'written',receiptId:id(91),reasonCode:null}}};
    await act(async () => {await vi.advanceTimersByTimeAsync(1500);});
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.endpointRefreshKey).toBe(1);
    expect(panelProps.cable?.cable).toMatchObject({routing:'/NEW',designLength:'58',cableWriteRevision:'5'});
    expect(p.pf.submitCalculation).toHaveBeenCalledOnce(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it.each(['written','unknown'] as const)('reopening an admitted automatic write follows its status by reads, including receipt-proven %s', async status => {
    vi.useFakeTimers(); listRow = calculatedRow(); listRow.calculation.jobStatus='running'; listRow.calculation.reviewable=false;
    listRow.calculation.automaticUpdate={status:'running',receiptId:null,reasonCode:null};
    let observed=listRow;
    const p=props(), acknowledged=vi.fn(); vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementation(async()=>({projectId:id(1),cableId:id(3),row:observed}) as never);
    render(<PathFinderCableWorkspace {...p} onCalculationPreferences={acknowledged} />); await act(async()=>{await openListCable();});
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.onCalculate).toBeUndefined(); expect(panelProps.pathReady).toBe(false);
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
    observed={...listRow,cable:{...listRow.cable,routing:'/DONE',designLength:'58',cableWriteRevision:'5'},
      calculation:{...listRow.calculation,acceptedMatchesCurrent:true,automaticUpdate:status==='written'
        ? {status,receiptId:id(91),reasonCode:null} : {status,receiptId:null,reasonCode:'AUTOMATIC_PAIR_RECOVERY_LIMIT'}}};
    await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.cable?.calculation.jobStatus).toBe('running');
    expect(panelProps.cable?.cable.routing).toBe('/DONE'); expect(panelProps.endpointRefreshKey).toBe(1);
    expect(acknowledged).toHaveBeenCalledExactlyOnceWith({cableId:id(3),jobId:id(70),preferences:p.preferences});
    expect(acknowledged.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(p.onSelect).mock.invocationCallOrder.at(-1)!);
    expect(panelProps.onCalculate).toBeTypeOf('function');
  });
  it('does not settle the saved location calculation from another current job or impact', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props();
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', currentAuthority: true, reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: calculatedRow(99, 89) } as never);
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt, endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.pathReady).toBe(false); expect(panelProps.onCalculate).toBeUndefined();
    expect(panelProps.endpointRefreshKey).toBe(0); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it.each(['blocked', 'superseded', 'failed', 'awaiting-authority'] as const)('releases a saved calculation after its exact impact is %s without creating a job', async status => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props();
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt, endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 }); });
    expect(panelProps.calculationPending).toBe(true);
    await act(async () => { vi.mocked(usePathfinderLocationImpactProgress).mock.calls.at(-1)?.[0].onChanged?.({ id: id(8), jobId: null, status, currentAuthority: false } as never); });
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.onCalculate).toBeTypeOf('function');
    expect(panelProps.calculationFeedback?.message).toContain('stopped before a job was created');
    expect(panelProps.calculationFeedback?.currentAttempt).toBe(true);
    expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('clears a previous cable read failure after its exact acknowledged job is read successfully', async () => {
    const p = props(); vi.mocked(p.pf.submitCalculation).mockResolvedValueOnce({ kind: 'acknowledged', jobId: id(71), registryRevision: '5', duplicate: false });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(new Error('temporary failure'));
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    await act(async () => { await panelProps.onRefresh?.(); }); expect(panelProps.refreshError).toContain('Last read values are retained');
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: calculatedRow(71, 81) } as never);
    await act(async () => { await panelProps.onCalculate?.(); });
    await waitFor(() => expect(panelProps.calculationPending).toBe(false)); expect(panelProps.refreshError).toBeNull();
    expect(p.pf.submitCalculation).toHaveBeenCalledOnce();
  });
  it.each(['job', 'proposal', 'hash'] as const)('never borrows another result for the same cable: %s', async kind => {
    listRow = calculatedRow(); const p = props();
    const display = { cableId: id(3), jobId: kind === 'job' ? id(99) : id(70), proposalId: kind === 'proposal' ? id(99) : id(80),
      proposalHash: kind === 'hash' ? 'e'.repeat(64) : 'f'.repeat(64), verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: true, visible: true, routing: '/OLD', designLength: '56' };
    render(<PathFinderCableWorkspace {...p} display={display} />); await openListCable();
    expect(panelProps.pathReady).toBe(false); expect(panelProps.pathVisible).toBe(false); expect(panelProps.calculatedRouting).toBeUndefined();
  });
  it('shows exact current proposal values while its viewer payload is loading without enabling Show', async () => {
    listRow = calculatedRow(); listRow.cable.routing = '/MANUAL'; listRow.cable.designLength = '59'; const p = props();
    const display = { cableId: id(3), jobId: id(70), proposalId: id(80), proposalHash: 'f'.repeat(64), verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), ready: false, visible: false,
      routing: '/EXACT-PROPOSAL', designLength: '58' };
    const view = render(<PathFinderCableWorkspace {...p} display={display} />); await openListCable();
    expect(panelProps.pathReady).toBe(false); expect(panelProps.pathVisible).toBe(false);
    expect(panelProps.calculatedRouting).toBe('/EXACT-PROPOSAL'); expect(panelProps.calculatedDesignLength).toBe('58');
    expect(panelProps.cable?.cable).toMatchObject({ routing: '/MANUAL', designLength: '59' });
    view.rerender(<PathFinderCableWorkspace {...p} display={{ ...display, routing: null, designLength: null }} />);
    expect(panelProps.calculatedRouting).toBeUndefined(); expect(panelProps.calculatedDesignLength).toBeUndefined();
    for (const change of [{ currentness: 'changed' as const }, { jobStatus: 'failed' as const }, { jobStatus: 'cancelled' as const }]) {
      listRow = { ...calculatedRow(), calculation: { ...calculatedRow().calculation, ...change, reviewable: false } };
      view.rerender(<PathFinderCableWorkspace {...p} display={display} />); await openListCable();
      expect(panelProps.pathReady).toBe(false); expect(panelProps.calculatedRouting).toBeUndefined(); expect(panelProps.calculatedDesignLength).toBeUndefined();
    }
  });
});

describe('fresh initial selection and current proof handoff', () => {
  it('opens its native window before the bounded current-row GET and never borrows old Cable list routing', async () => {
    listRow = { ...calculatedRow(), cable: { ...calculatedRow().cable, routing: '/OLD-LIST', designLength: '39' } };
    const p = props(), current = { ...calculatedRow(71, 81), cable: { ...calculatedRow().cable, routing: '/NEW', designLength: '58', cableWriteRevision: '5' } };
    let finish!: (value: Awaited<ReturnType<typeof fetchPathFinderCableWorkflowDetail>>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockReset().mockImplementation(() => {
      expect(window.open).toHaveBeenCalledOnce(); return new Promise(resolve => { finish = resolve; });
    });
    const view = render(<PathFinderCableWorkspace {...p} />); fireEvent.click(screen.getByText('Needs routing cable'));
    expect(window.open).toHaveBeenCalledOnce(); expect(panelProps.refreshing).toBe(true);
    expect(panelProps.calculatedRouting).toBeUndefined(); expect(panelProps.pathReady).toBe(false);
    await act(async () => finish({ projectId: id(1), cableId: id(3), row: current } as never));
    expect(p.onSelect).toHaveBeenLastCalledWith(current); expect(panelProps.cable?.calculation.proposalId).toBe(id(81));
    view.rerender(<PathFinderCableWorkspace {...p} display={{ cableId: id(3), jobId: id(71), proposalId: id(81), proposalHash: 'f'.repeat(64),
      ready: true, visible: false, routing: '/NEW', designLength: '58', verifiedRow: current, verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId) }} />);
    expect(panelProps.calculatedRouting).toBe('/NEW'); expect(panelProps.pathReady).toBe(true);
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled(); expect(p.pf.refreshState).not.toHaveBeenCalled();
  });
  it('reads the current row again on a second actual opening without a calculation', async () => {
    const p = props(), first = calculatedRow(), second = calculatedRow(71, 81);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockReset().mockResolvedValueOnce({ projectId: id(1), cableId: id(3), row: first } as never)
      .mockResolvedValueOnce({ projectId: id(1), cableId: id(3), row: second } as never);
    render(<PathFinderCableWorkspace {...p} />);
    await act(async () => { fireEvent.click(screen.getByText('Needs routing cable')); });
    act(() => panelProps.onClose()); await act(async () => { fireEvent.click(screen.getByText('Open selected cable')); });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(2); expect(panelProps.cable?.calculation.proposalId).toBe(id(81));
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it.each(['account', 'generation'] as const)('rejects a late first-open detail after its %s changes', async kind => {
    const p = props(); let finish!: (value: Awaited<ReturnType<typeof fetchPathFinderCableWorkflowDetail>>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockReset().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<PathFinderCableWorkspace {...p} />); fireEvent.click(screen.getByText('Needs routing cable'));
    const signal = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!;
    view.rerender(<PathFinderCableWorkspace {...p} {...(kind === 'account' ? { accountId: id(99) } : { pf: { ...p.pf, preparationViewerGeneration: 99 } })} />);
    await act(async () => finish({ projectId: id(1), cableId: id(3), row: calculatedRow(71, 81) } as never));
    expect(signal.aborted).toBe(true); expect(p.onSelect).toHaveBeenCalledExactlyOnceWith(listRow);
    expect(panelProps.cable?.calculation.proposalId).not.toBe(id(81)); expect(panelProps.pathReady).toBe(false);
  });
  it('bounds an unresponsive first-open transport without another command', async () => {
    vi.useFakeTimers(); const p = props();
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockReset().mockImplementation(() => new Promise(() => {}));
    render(<PathFinderCableWorkspace {...p} />); fireEvent.click(screen.getByText('Needs routing cable'));
    const signal = vi.mocked(fetchPathFinderCableWorkflowDetail).mock.calls[0][4]!;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(signal.aborted).toBe(true); expect(panelProps.refreshing).toBe(false); expect(panelProps.refreshError).toContain('Last read values are retained');
    expect(panelProps.cable).toEqual(listRow); expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it('adopts the exact recorded-policy proof row without an onSelect feedback loop', async () => {
    const p = props(), current = calculatedRow();
    listRow = { ...current, calculation: { ...current.calculation, currentness: 'changed', reviewable: false } };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockReset().mockResolvedValue({ projectId: id(1), cableId: id(3), row: listRow } as never);
    const view = render(<PathFinderCableWorkspace {...p} readPreferences={{ secondaryDistanceMeters: 17, preferVerticalApproach: false }} />);
    await act(async () => { fireEvent.click(screen.getByText('Needs routing cable')); });
    view.rerender(<PathFinderCableWorkspace {...p} readPreferences={{ secondaryDistanceMeters: 17, preferVerticalApproach: false }} display={{ cableId: id(3),
      jobId: id(70), proposalId: id(80), proposalHash: 'f'.repeat(64), ready: true, visible: false, routing: '/CURRENT', designLength: '58',
      verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), verifiedRow: current }} />);
    expect(panelProps.cable?.calculation.currentness).toBe('current'); expect(panelProps.calculatedRouting).toBe('/CURRENT'); expect(panelProps.pathReady).toBe(true);
    expect(p.onSelect).toHaveBeenCalledExactlyOnceWith(listRow); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it('uses separately qualified saved display without promoting its calculation authority', async () => {
    const p = props(), saved = calculatedRow(); saved.calculation = { ...saved.calculation, currentness: 'changed', reviewable: false,
      acceptedMatchesCurrent: false, savedExactDisplay: true }; saved.cable = { ...saved.cable, routing: '/SAVED', designLength: '58' };
    listRow = saved;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockReset().mockResolvedValue({ projectId: id(1), cableId: id(3), row: saved } as never);
    render(<PathFinderCableWorkspace {...p} display={{ cableId: id(3), jobId: id(70), proposalId: id(80), proposalHash: 'f'.repeat(64),
      ready: true, visible: false, source: 'saved-exact', routing: '/SAVED', designLength: '58', verifiedRow: saved,
      verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId) }} />);
    await openListCable(); expect(panelProps.pathReady).toBe(true); expect(panelProps.pathSource).toBe('saved-exact');
    expect(panelProps.calculatedRouting).toBe('/SAVED');
    expect(panelProps.cable?.calculation).toMatchObject({ currentness: 'changed', reviewable: false, acceptedMatchesCurrent: false });
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it.each(['source', 'qualification', 'scope', 'tuple', 'older-row'] as const)('refuses saved display with invalid %s evidence', async kind => {
    const p = props(), saved = calculatedRow(); saved.calculation = { ...saved.calculation, currentness: 'changed', reviewable: false,
      acceptedMatchesCurrent: false, savedExactDisplay: true }; listRow = saved;
    const verified = structuredClone(saved);
    if (kind === 'qualification') verified.calculation.savedExactDisplay = false;
    if (kind === 'tuple') verified.calculation.proposalId = id(99);
    if (kind === 'older-row') verified.cable.cableWriteRevision = '3';
    render(<PathFinderCableWorkspace {...p} display={{ cableId: id(3), jobId: id(70), proposalId: id(80), proposalHash: 'f'.repeat(64),
      ready: true, visible: true, source: kind === 'source' ? undefined : 'saved-exact', routing: '/SAVED', designLength: '58', verifiedRow: verified,
      verifiedScope: kind === 'scope' ? 'other' : pathFinderWorkflowDisplayScope(p.pf, p.accountId) }} />);
    await openListCable(); expect(panelProps.pathReady).toBe(false); expect(panelProps.pathVisible).toBe(false); expect(panelProps.calculatedRouting).toBeUndefined();
  });
  it.each(['missing', 'other-registry', 'other-generation'] as const)('refuses a same-tuple display with %s scope', async kind => {
    listRow = calculatedRow(); const p = props(), pf = kind === 'other-registry' ? { ...p.pf, data: { ...p.pf.data!, registryRevision: 'other' } }
      : { ...p.pf, preparationViewerGeneration: 99 };
    render(<PathFinderCableWorkspace {...p} display={{ cableId: id(3), jobId: id(70), proposalId: id(80), proposalHash: 'f'.repeat(64),
      ready: true, visible: true, routing: '/WRONG', designLength: '58', verifiedScope: kind === 'missing' ? undefined : pathFinderWorkflowDisplayScope(pf, p.accountId) }} />);
    await openListCable(); expect(panelProps.pathReady).toBe(false); expect(panelProps.pathVisible).toBe(false); expect(panelProps.calculatedRouting).toBeUndefined();
  });
  it('does not reuse display proof after an account transition even while the token and prepared model remain unchanged', async () => {
    listRow = calculatedRow(); const p = props(), display = { cableId: id(3), jobId: id(70), proposalId: id(80), proposalHash: 'f'.repeat(64),
      ready: true, visible: false, routing: '/BEFORE-ACCOUNT-CHANGE', designLength: '58', verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId) };
    const view = render(<PathFinderCableWorkspace {...p} display={display} />); await openListCable();
    expect(panelProps.pathReady).toBe(true);
    view.rerender(<PathFinderCableWorkspace {...p} accountId={id(99)} display={display} />);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce({ projectId: id(1), cableId: id(3), row: listRow } as never);
    await openListCable();
    expect(panelProps.access.token).toBe(p.token); expect(panelProps.cable?.calculation.currentness).toBe('current');
    expect(panelProps.pathReady).toBe(false); expect(panelProps.calculatedRouting).toBeUndefined(); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it.each(['project', 'proposal', 'hash', 'older-row', 'newer-global-row'] as const)('refuses an inconsistent fresh display row (%s)', async kind => {
    const p = props(), current = calculatedRow(); listRow = { ...current, calculation: { ...current.calculation, currentness: 'changed', reviewable: false } };
    const verified = structuredClone(current);
    if (kind === 'project') verified.projectId = id(99);
    if (kind === 'proposal') verified.calculation.proposalId = id(99);
    if (kind === 'hash') verified.calculation.proposalHash = 'a'.repeat(64);
    if (kind === 'older-row') verified.cable.cableWriteRevision = '3';
    if (kind === 'newer-global-row') p.pf.data = { ...p.pf.data!, cables: [{ ...current.cable, cableWriteRevision: '5' } as never] };
    render(<PathFinderCableWorkspace {...p} display={{ cableId: id(3), jobId: id(70), proposalId: id(80), proposalHash: 'f'.repeat(64),
      ready: true, visible: true, routing: '/WRONG', designLength: '58', verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId), verifiedRow: verified }} />);
    await openListCable(); expect(panelProps.cable?.calculation.currentness).toBe('changed');
    expect(panelProps.pathReady).toBe(false); expect(panelProps.calculatedRouting).toBeUndefined();
  });
  it('keeps the own path ready through hanging global reads and sibling progress, while external changes still refresh it', async () => {
    vi.useFakeTimers(); listRow = calculatedRow(); const p = props(), current = calculatedRow(71, 81);
    current.calculation.jobStatus = 'running'; current.calculation.acceptedMatchesCurrent = true; current.calculation.reviewable = false;
    current.cable = { ...current.cable, routing: '/OWN', designLength: '58', cableWriteRevision: '5' };
    vi.mocked(p.pf.refreshState).mockImplementation(() => new Promise(() => {}));
    vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: { id: id(8), jobId: id(71), status: 'running', reasonCodes: [] }, error: null, refresh: vi.fn() } as never);
    vi.mocked(fetchPathFinderJob).mockResolvedValue({ id: id(71), projectId: id(1), status: 'running', cancelRequested: false,
      items: [{ cableId: id(3), state: 'complete', status: 'calculated' }, { cableId: id(44), state: 'running', status: 'calculating' }] } as never);
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: current } as never);
    const display = { cableId: id(3), jobId: id(71), proposalId: id(81), proposalHash: 'f'.repeat(64), ready: true, visible: false,
      routing: '/OWN', designLength: '58', verifiedRow: current, verifiedScope: pathFinderWorkflowDisplayScope(p.pf, p.accountId) };
    const view = render(<PathFinderCableWorkspace {...p} display={display} />); await openListCable();
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt,
      endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 }); });
    expect(panelProps.calculationPending).toBe(false); expect(panelProps.pathReady).toBe(true); expect(panelProps.onCalculate).toBeTypeOf('function');
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(p.pf.refreshState).toHaveBeenCalledOnce();
    act(() => { vi.mocked(usePathfinderInitialFillProgress).mock.calls.at(-1)?.[0].onChanged?.({ ...writeProgress(), counters: { ...writeProgress().counters, written: 2 } }); });
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce(); expect(panelProps.refreshing).toBe(false); expect(panelProps.pathReady).toBe(true);
    view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} display={display} />);
    await act(async () => {}); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledTimes(2);
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(9) } } as CableEndpointReceipt,
      endpointBindingFixture().context.current!, { preferences: p.preferences!, timeoutMilliseconds: 120000 }); });
    expect(p.pf.refreshState).toHaveBeenCalledTimes(2); // A later acknowledged command never reuses the earlier unresolved refresh.
    expect(panelProps.calculationPending).toBe(true); expect(panelProps.pathReady).toBe(false);
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
});

describe('Path Finder cable popup and read-only hover', () => {
  it.each([null, '', 'Power', 'Plastic tubing', 'Unknown'])('opens and submits a cable with optional MTO %s without modifying its metadata', async mto => {
    const p = props(); listRow = { ...row(), mto };
    render(<PathFinderCableWorkspace {...p} />); await openListCable(true);
    expect(window.open).toHaveBeenCalledOnce(); expect(screen.getByRole('dialog')).toBeVisible();
    expect(p.onSelect).toHaveBeenCalledWith(listRow);
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
    expect(panelProps.cable?.mto).toBe(mto); expect(panelProps.onCalculate).toBeTypeOf('function');
    expect(panelProps.access.calculation).not.toBeNull(); expect(panelProps.access.automaticPairPolicy).toEqual(AUTOMATIC_PAIR_POLICY);
    await act(async () => { await panelProps.onCalculate?.(); });
    expect(p.pf.submitCalculation).toHaveBeenCalledWith([id(3)], p.preferences);
    expect(panelProps.cable?.mto).toBe(mto);
  });
  it('lets the hover Open action inspect a missing-MTO cable without asking for an MTO edit', async () => {
    vi.useFakeTimers(); const p = props(); listRow = { ...row(), mto: null };
    render(<PathFinderCableWorkspace {...p} />);
    act(() => listProps.onPreview?.(listRow, screen.getByText('Needs routing cable'))); act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('link', { name: 'Edit cable category' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText('Open cable in separate window')); });
    expect(window.open).toHaveBeenCalledOnce(); expect(panelProps.open).toBe(true);
    expect(panelProps.onCalculate).toBeTypeOf('function'); expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('keeps MV and another project outside this non-MV workspace', async () => {
    const p = props(); listRow = { ...row(), mto: 'MV' };
    render(<PathFinderCableWorkspace {...p} />); await openListCable();
    expect(window.open).not.toHaveBeenCalled(); expect(p.onSelect).not.toHaveBeenCalled();
    listRow = { ...row(), projectId: id(55) }; await openListCable();
    expect(window.open).not.toHaveBeenCalled(); expect(p.onSelect).not.toHaveBeenCalled();
  });
  it('blocks a retained Calculate callback if a fresh cable read changes its MTO to excluded MV', async () => {
    const p = props(); render(<PathFinderCableWorkspace {...p} />); await openListCable();
    const calculate = panelProps.onCalculate!; expect(calculate).toBeTypeOf('function');
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce({ projectId: id(1), cableId: id(3), row: { ...row(), mto: 'MV' } } as never);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh selected cable' })); });
    expect(panelProps.cable?.mto).toBe('MV'); expect(panelProps.onCalculate).toBeUndefined();
    await act(async () => { await calculate(); });
    expect(p.pf.submitCalculation).not.toHaveBeenCalled(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it('keeps read-only hover and click-to-open while barriers leave calculation preferences unavailable', async () => {
    vi.useFakeTimers(); const p = props();
    render(<PathFinderCableWorkspace {...p} preferences={null} readPreferences={{ secondaryDistanceMeters: 2, preferVerticalApproach: true }} />);
    const anchor = screen.getByText('Needs routing cable');
    act(() => listProps.onPreview?.(listRow, anchor)); act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('dialog', { name: 'C-001' })).toHaveAttribute('data-cable-preview', 'true');
    expect(p.onSelect).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByText('Open cable in separate window')); });
    expect(screen.getByRole('dialog')).toBeVisible(); expect(window.open).toHaveBeenCalledOnce();
    expect(panelProps.onCalculate).toBeTypeOf('function'); expect(panelProps.access.initialFill).toBeNull();
    expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('preopens a separate window synchronously from click, reuses it and closes it on owner loss', async () => {
    const close = vi.fn(), focus = vi.fn();
    const popup = { closed: false, close, focus, document: { title: '' } } as unknown as Window;
    vi.mocked(window.open).mockReturnValue(popup);
    const p = props(), view = render(<PathFinderCableWorkspace {...p} />);
    await openListCable();
    expect(window.open).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank', expect.stringContaining('popup=yes'));
    expect(panelProps.requestedPopup?.window).toBe(popup);
    await openListCable(); expect(window.open).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalled();
    view.rerender(<PathFinderCableWorkspace {...p} accountId={id(90)} />); expect(close).toHaveBeenCalled();
    expect(p.pf.submitCalculation).not.toHaveBeenCalled();
  });
  it('shows a delayed hover without selection, reads, focus theft or a native window; click opens an editor', async () => {
    vi.useFakeTimers(); const p = props(); render(<PathFinderCableWorkspace {...p} />);
    const anchor = screen.getByText('Needs routing cable'); anchor.focus();
    act(() => listProps.onPreview?.(listRow, anchor)); act(() => vi.advanceTimersByTime(999)); expect(screen.queryByRole('dialog')).toBeNull();
    act(() => vi.advanceTimersByTime(1)); const preview = screen.getByRole('dialog', { name: 'C-001' });
    expect(preview).toHaveAttribute('data-cable-preview', 'true'); expect(anchor).toHaveFocus();
    expect(p.onSelect).not.toHaveBeenCalled(); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
    act(() => listProps.onPreviewLeave?.()); fireEvent.pointerEnter(preview); act(() => vi.advanceTimersByTime(150)); expect(preview).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('Open cable in separate window')); }); expect(p.onSelect).toHaveBeenCalledOnce(); expect(window.open).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-cable-preview]')).toBeNull();
  });
  it('retires hover on leave and never replaces an open editing draft', async () => {
    vi.useFakeTimers(); const p = props(); render(<PathFinderCableWorkspace {...p} />); const anchor = screen.getByText('Needs routing cable');
    act(() => listProps.onPreview?.(listRow, anchor)); act(() => vi.advanceTimersByTime(1000)); expect(document.querySelector('[data-cable-preview]')).not.toBeNull();
    act(() => listProps.onPreviewLeave?.()); act(() => vi.advanceTimersByTime(150)); expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { fireEvent.click(anchor); }); act(() => listProps.onPreview?.({ ...listRow, cable: { ...listRow.cable, id: id(88) } }, anchor));
    act(() => vi.advanceTimersByTime(1100)); expect(document.querySelector('[data-cable-preview]')).toBeNull(); expect(panelProps.cable?.cable.id).toBe(id(3));
    expect(p.onSelect).toHaveBeenCalledOnce();
  });
});
