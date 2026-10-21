import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderCableWorkspace, type PathFinderCableWorkspaceProps } from './PathFinderCableWorkspace';
import type { PathFinderNeedsRoutingListProps } from './PathFinderNeedsRoutingList';
import type { PathFinderCableRoutingPanelProps } from './PathFinderCableRoutingPanel';
import { fetchPathFinderCableWorkflowDetail } from '@/api/pathfinderCableWorkflow';
import { fetchLocationImpacts } from '@/api/pathfinderLocationImpacts';
import { usePathfinderLocationImpactProgress } from '@/hooks/usePathfinderLocationImpactProgress';
import { usePathfinderInitialFillProgress } from '@/hooks/usePathfinderInitialFillProgress';
import { cableWorkflowRowSchema, type CableWorkflowRow } from '../../../shared/pathfinderCableWorkflow';
import { endpointBindingFixture } from '@/test/endpointBindingFixtures';
import type { CableEndpointReceipt } from '@/api/pathfinderCableEndpoints';
import { emptyInitialFillCounters, type InitialFillProgress } from '../../../shared/pathfinderInitialFillProgress';
import type { BarrierAdmissionIntent } from '../../../shared/pathfinderBarrierAdmission';
import type { PathFinderWorkflowReview } from '@/pages/ProjectDetails/PathFinderResults';
vi.mock('@/api/pathfinderCableWorkflow', () => ({ fetchPathFinderCableWorkflowDetail: vi.fn() }));
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
function props(): PathFinderCableWorkspaceProps {
  const scope = endpointBindingFixture().context.current!;
  return { projectId: id(1), loadedProjectId: id(1), accountId: id(2), token: 'fixture-token', isAdmin: true, active: true,
    preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, onSelect: vi.fn(),
    pf: { preparationAccess: { projectId: id(1), loadedProjectId: id(1), token: 'fixture-token', isAdmin: true }, preparationViewerGeneration: 7,
      viewerPhase: 'ready', busy: false, calculate: vi.fn(async () => null), data: { activeModel: { modelVersionId: scope.modelVersionId, selectionRevision: scope.selectionRevision, contentFingerprint: scope.contentFingerprint }, artifacts: [] }, readSelection: vi.fn(), refresh: vi.fn() } as unknown as PathFinderCableWorkspaceProps['pf'] };
}
function reviewController(cableId: string, proposalId: string): PathFinderWorkflowReview {
  return { cableId, proposalId, comparison: null, comparisonLoading: false, comparisonError: null, message: null, reviewed: false, applied: false,
    canReview: true, canApply: false, busy: false, pending: false, canRecover: false, recoveryMessage: null, recoveryError: null,
    review: vi.fn(), apply: vi.fn(), retry: vi.fn(), closePending: vi.fn() };
}
function writeProgress(): InitialFillProgress { return { schemaVersion: 'wfc.pf.initial-fill-progress.v1', projectId: id(1), actorId: id(2), impactId: id(8),
  mandate: { id: id(9), impactId: id(8), contentSha256: 'a'.repeat(64), mode: 'when-both-empty' }, authorized: true, currentAuthority: true, eligibleCables: 1,
  counters: { ...emptyInitialFillCounters(), written: 1 }, retryableUnknown: 0, outstanding: 0, selected: null }; }
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(window, 'open').mockReturnValue(null); listRow = row(); vi.mocked(fetchLocationImpacts).mockResolvedValue({ impacts: [] } as never);
  vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: row() } as never);
  vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: null, error: null, refresh: vi.fn() } as never);
  vi.mocked(usePathfinderInitialFillProgress).mockReturnValue({ progress: null, error: null, refresh: vi.fn() } as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('owned cable routing workspace composition (mocked reads and child UI)', () => {
  it('passes only the exact selected proposal controller to the popup', () => {
    listRow = cableWorkflowRowSchema.parse({ ...row(), calculation: { ...row().calculation, jobId: id(70), jobStatus: 'complete', proposalId: id(80), proposalHash: 'f'.repeat(64) } });
    const p = props(), review = reviewController(id(3), id(80)), view = render(<PathFinderCableWorkspace {...p} review={review} />);
    fireEvent.click(screen.getByText('Needs routing cable')); expect(panelProps.review).toBe(review);
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
    vi.mocked(p.pf.calculate).mockResolvedValueOnce({ jobId: id(71) });
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce({ projectId: id(1), cableId: id(3), row: completed } as never);
    const view = render(<PathFinderCableWorkspace {...p} review={oldReview} onCalculationStart={started} />);
    fireEvent.click(screen.getByText('Needs routing cable')); expect(panelProps.review).toBe(oldReview);
    await act(async () => { await panelProps.onCalculate?.(); });
    await waitFor(() => expect(p.onSelect).toHaveBeenLastCalledWith(completed));
    expect(started).toHaveBeenCalledExactlyOnceWith(id(3)); expect(panelProps.review).toBeNull(); expect(panelProps.calculationPending).toBe(false);
    const freshReview = reviewController(id(3), id(81)); view.rerender(<PathFinderCableWorkspace {...p} review={freshReview} onCalculationStart={started} />);
    expect(panelProps.review).toBe(freshReview); expect(panelProps.cable!.cable).toMatchObject({ routing: '/OLD', designLength: '150' });
    expect(oldReview.review).not.toHaveBeenCalled(); expect(freshReview.apply).not.toHaveBeenCalled(); expect(p.pf.calculate).toHaveBeenCalledOnce();
  });
  it('opens the selected bounded row without global refresh and deliberately supplies both-empty v3 policy', () => {
    const p = props(); render(<PathFinderCableWorkspace {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Needs routing cable' }));
    expect(screen.getByRole('dialog')).toBeVisible(); expect(p.onSelect).toHaveBeenCalledWith(row()); expect(p.pf.refresh).not.toHaveBeenCalled();
    expect(panelProps.access).toMatchObject({ calculation: { preferences: p.preferences, timeoutMilliseconds: 120000 }, initialFill: { mode: 'when-both-empty' }, readSelection: p.pf.readSelection });
    expect(listProps.active).toBe(true);
  });
  it('keeps selected cable across popup close and opens it again', () => {
    render(<PathFinderCableWorkspace {...props()} />); fireEvent.click(screen.getByText('Needs routing cable')); fireEvent.click(screen.getByText('Close routing popup'));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByText(/Selected cable: C-001/)).toBeVisible();
    fireEvent.click(screen.getByText('Open selected cable')); expect(screen.getByRole('dialog')).toBeVisible();
  });
  it.each(['account', 'model', 'preferences'] as const)('clears old popup ownership on %s change', kind => {
    const p = props(), view = render(<PathFinderCableWorkspace {...p} />); fireEvent.click(screen.getByText('Needs routing cable'));
    const next = kind === 'account' ? { ...p, accountId: id(22) } : kind === 'preferences' ? { ...p, preferences: { ...p.preferences!, secondaryDistanceMeters: 3 } }
      : { ...p, pf: { ...p.pf, data: { ...p.pf.data!, activeModel: { ...p.pf.data!.activeModel, selectionRevision: '77' } } } };
    view.rerender(<PathFinderCableWorkspace {...next} />); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText(/Selected cable:/)).toBeNull();
  });
  it('saves exact impact scope then refreshes only bounded diagnostics and the selected cable', async () => {
    const p = props(); render(<PathFinderCableWorkspace {...p} />); fireEvent.click(screen.getByText('Needs routing cable'));
    const oldKey = listProps.modelScopeKey, scope = endpointBindingFixture().context.current!;
    act(() => { void panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt, scope); });
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledWith(id(1), 'fixture-token', id(3), p.preferences, expect.any(AbortSignal)));
    expect(listProps.modelScopeKey).not.toBe(oldKey); expect(p.pf.refresh).not.toHaveBeenCalled();
    expect(vi.mocked(usePathfinderLocationImpactProgress).mock.calls.at(-1)?.[0]).toMatchObject({ current: scope, impactId: id(8), active: true });
  });
  it('observes a first terminal write read but never calls it Updated without receipt-backed cable evidence', async () => {
    vi.mocked(usePathfinderInitialFillProgress).mockReturnValue({ progress: writeProgress(), error: null, refresh: vi.fn() } as never);
    const p = props(); render(<PathFinderCableWorkspace {...p} />); fireEvent.click(screen.getByText('Needs routing cable'));
    act(() => { void panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt, endpointBindingFixture().context.current!); });
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalled());
    expect(screen.queryByText(/Updated in Cable list/)).toBeNull(); expect(screen.getByText(/Needs routing or attention/)).toBeVisible();
  });
  it('rejects a late old-owner detail response after model change', async () => {
    let finish!: (value: Awaited<ReturnType<typeof fetchPathFinderCableWorkflowDetail>>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const p = props(), view = render(<PathFinderCableWorkspace {...p} />); fireEvent.click(screen.getByText('Needs routing cable')); fireEvent.click(screen.getByText('Refresh selected cable'));
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    view.rerender(<PathFinderCableWorkspace {...p} accountId={id(88)} />);
    await act(async () => finish({ projectId: id(1), cableId: id(3), row: row() } as never)); expect(screen.queryByText(/Selected cable:/)).toBeNull(); expect(p.onSelect).toHaveBeenCalledTimes(1);
  });
  it('pauses endpoint and progress work without unmounting the saved popup state when Path is inactive', () => {
    const p = props(), view = render(<PathFinderCableWorkspace {...p} />); fireEvent.click(screen.getByText('Needs routing cable'));
    view.rerender(<PathFinderCableWorkspace {...p} active={false} />); expect(screen.queryByRole('dialog')).toBeNull(); expect(panelProps.access.active).toBe(false);
    expect(vi.mocked(usePathfinderInitialFillProgress).mock.calls.at(-1)?.[0].active).toBe(false); view.rerender(<PathFinderCableWorkspace {...p} />); expect(screen.getByRole('dialog')).toBeVisible();
  });
  it('does not retarget an externally selected cable after an older workspace read completes', async () => {
    let finish!: (value: Awaited<ReturnType<typeof fetchPathFinderCableWorkflowDetail>>) => void;
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const p = props(), view = render(<PathFinderCableWorkspace {...p} selectedCableId={id(3)} />);
    fireEvent.click(screen.getByText('Needs routing cable')); fireEvent.click(screen.getByText('Refresh selected cable'));
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    view.rerender(<PathFinderCableWorkspace {...p} selectedCableId={id(44)} />);
    await act(async () => finish({ row: row() } as never)); expect(screen.queryByRole('dialog')).toBeNull(); expect(p.onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Selected cable:/)).toBeNull();
  });
  it('uses retained recovery calculation preferences rather than the editor’s changed values for progress', async () => {
    render(<PathFinderCableWorkspace {...props()} />); fireEvent.click(screen.getByText('Needs routing cable'));
    const original = { preferences: { secondaryDistanceMeters: 9, preferVerticalApproach: false }, timeoutMilliseconds: 7000 };
    await act(async () => { await panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt, endpointBindingFixture().context.current!, original); });
    expect(vi.mocked(usePathfinderLocationImpactProgress).mock.calls.at(-1)?.[0].calculation).toEqual(original);
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
    const p = props(), view = render(<PathFinderCableWorkspace {...p} refreshKey={0} />); fireEvent.click(screen.getByText('Needs routing cable'));
    const previous = listProps.modelScopeKey; view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce()); expect(listProps.modelScopeKey).not.toBe(previous);
    expect(p.pf.refresh).not.toHaveBeenCalled(); view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} />);
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
  });
  it('defers a confirmed Apply refresh received while inactive until the same workspace resumes', async () => {
    const p = props(), view = render(<PathFinderCableWorkspace {...p} refreshKey={0} />); fireEvent.click(screen.getByText('Needs routing cable'));
    view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} active={false} />); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
    view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} />);
    await waitFor(() => expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce());
    view.rerender(<PathFinderCableWorkspace {...p} refreshKey={1} />); expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledOnce();
  });
  it('does not mount new reads or UI without matching current administrator ownership', () => {
    const p = props(); render(<PathFinderCableWorkspace {...p} isAdmin={false} />); expect(screen.queryByText('Needs routing cable')).toBeNull(); expect(fetchLocationImpacts).not.toHaveBeenCalled();
  });
  it('calculates only the selected non-MV cable after an explicit click, without an implicit Save or global calculation', async () => {
    const p = props(); render(<PathFinderCableWorkspace {...p} />); expect(p.pf.calculate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Needs routing cable')); expect(p.pf.calculate).not.toHaveBeenCalled();
    await act(async () => { await panelProps.onCalculate?.(); });
    expect(p.pf.calculate).toHaveBeenCalledExactlyOnceWith([id(3)], true, p.preferences);
    expect(fetchPathFinderCableWorkflowDetail).toHaveBeenCalledExactlyOnceWith(id(1), 'fixture-token', id(3), p.preferences, expect.any(AbortSignal));
    expect(p.pf.refresh).not.toHaveBeenCalled();
  });
  it.each(['queued', 'running'] as const)('removes Calculate while the selected cable already belongs to a %s job', status => {
    listRow = cableWorkflowRowSchema.parse({ ...row(), calculation: { ...row().calculation, jobId: id(70), jobStatus: status, itemState: status === 'queued' ? 'waiting' : 'running' } });
    const p = props(); render(<PathFinderCableWorkspace {...p} />); fireEvent.click(screen.getByText('Needs routing cable'));
    expect(panelProps.onCalculate).toBeUndefined(); expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it('fences repeated selected-cable calculation while its first request is unsettled', async () => {
    let finish!: () => void; const p = props(); vi.mocked(p.pf.calculate).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(null as never); }));
    render(<PathFinderCableWorkspace {...p} />); fireEvent.click(screen.getByText('Needs routing cable'));
    const captured = panelProps.onCalculate!;
    let first!: Promise<void>; act(() => { first = Promise.resolve(captured()); void captured(); });
    expect(panelProps.actionsBusy).toBe(true); await act(async () => { await panelProps.onCalculate?.(); }); expect(p.pf.calculate).toHaveBeenCalledOnce();
    await act(async () => { finish(); await first; }); expect(panelProps.actionsBusy).toBe(false);
  });
  it('does not refresh a different owner after a previous calculation finishes late', async () => {
    let finish!: () => void; const p = props(); vi.mocked(p.pf.calculate).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(null as never); }));
    const view = render(<PathFinderCableWorkspace {...p} />); fireEvent.click(screen.getByText('Needs routing cable'));
    let first!: Promise<void>; act(() => { first = Promise.resolve(panelProps.onCalculate?.()); });
    view.rerender(<PathFinderCableWorkspace {...p} accountId={id(90)} />); await act(async () => { finish(); await first; });
    expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('passes only the selected cable display and protected toggle callback through Show/Hide', () => {
    const p = props(), toggle = vi.fn(), display = { cableId: id(3), visible: true, routing: '/NEW/SECONDARY', designLength: '180' };
    const view = render(<PathFinderCableWorkspace {...p} onTogglePath={toggle} display={display} />); fireEvent.click(screen.getByText('Needs routing cable'));
    expect(panelProps).toMatchObject({ pathVisible: true, calculatedRouting: '/NEW/SECONDARY', calculatedDesignLength: '180' });
    act(() => panelProps.onTogglePath?.()); expect(toggle).toHaveBeenCalledExactlyOnceWith(id(3)); expect(p.pf.calculate).not.toHaveBeenCalled();
    view.rerender(<PathFinderCableWorkspace {...p} onTogglePath={toggle} display={{ ...display, cableId: id(99) }} />);
    expect(panelProps.pathVisible).toBe(false); expect(panelProps.calculatedRouting).toBeUndefined(); expect(panelProps.calculatedDesignLength).toBeUndefined();
    view.rerender(<PathFinderCableWorkspace {...p} onTogglePath={toggle} display={{ ...display, routing: null, designLength: null, visible: false }} />);
    expect(panelProps.calculatedRouting).toBeNull(); expect(panelProps.calculatedDesignLength).toBeNull();
  });
});

describe('Path Finder cable popup and read-only hover', () => {
  it('preopens a separate window synchronously from click, reuses it and closes it on owner loss', () => {
    const close = vi.fn(), focus = vi.fn();
    const popup = { closed: false, close, focus, document: { title: '' } } as unknown as Window;
    vi.mocked(window.open).mockReturnValue(popup);
    const p = props(), view = render(<PathFinderCableWorkspace {...p} />);
    fireEvent.click(screen.getByText('Needs routing cable'));
    expect(window.open).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank', expect.stringContaining('popup=yes'));
    expect(panelProps.requestedPopup?.window).toBe(popup);
    fireEvent.click(screen.getByText('Needs routing cable')); expect(window.open).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalled();
    view.rerender(<PathFinderCableWorkspace {...p} accountId={id(90)} />); expect(close).toHaveBeenCalled();
    expect(p.pf.calculate).not.toHaveBeenCalled();
  });
  it('shows a delayed hover without selection, reads, focus theft or a native window; click opens an editor', () => {
    vi.useFakeTimers(); const p = props(); render(<PathFinderCableWorkspace {...p} />);
    const anchor = screen.getByText('Needs routing cable'); anchor.focus();
    act(() => listProps.onPreview?.(listRow, anchor)); act(() => vi.advanceTimersByTime(999)); expect(screen.queryByRole('dialog')).toBeNull();
    act(() => vi.advanceTimersByTime(1)); const preview = screen.getByRole('dialog', { name: 'C-001' });
    expect(preview).toHaveAttribute('data-cable-preview', 'true'); expect(anchor).toHaveFocus();
    expect(p.onSelect).not.toHaveBeenCalled(); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
    act(() => listProps.onPreviewLeave?.()); fireEvent.pointerEnter(preview); act(() => vi.advanceTimersByTime(150)); expect(preview).toBeInTheDocument();
    fireEvent.click(screen.getByText('Open cable in separate window')); expect(p.onSelect).toHaveBeenCalledOnce(); expect(window.open).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-cable-preview]')).toBeNull();
  });
  it('retires hover on leave and never replaces an open editing draft', () => {
    vi.useFakeTimers(); const p = props(); render(<PathFinderCableWorkspace {...p} />); const anchor = screen.getByText('Needs routing cable');
    act(() => listProps.onPreview?.(listRow, anchor)); act(() => vi.advanceTimersByTime(1000)); expect(document.querySelector('[data-cable-preview]')).not.toBeNull();
    act(() => listProps.onPreviewLeave?.()); act(() => vi.advanceTimersByTime(150)); expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(anchor); act(() => listProps.onPreview?.({ ...listRow, cable: { ...listRow.cable, id: id(88) } }, anchor));
    act(() => vi.advanceTimersByTime(1100)); expect(document.querySelector('[data-cable-preview]')).toBeNull(); expect(panelProps.cable?.cable.id).toBe(id(3));
    expect(p.onSelect).toHaveBeenCalledOnce();
  });
});
