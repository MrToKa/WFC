import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('@/api/pathfinderCableWorkflow', () => ({ fetchPathFinderCableWorkflowDetail: vi.fn() }));
vi.mock('@/api/pathfinderLocationImpacts', () => ({ fetchLocationImpacts: vi.fn() }));
vi.mock('@/hooks/usePathfinderLocationImpactProgress', () => ({ usePathfinderLocationImpactProgress: vi.fn() }));
vi.mock('@/hooks/usePathfinderInitialFillProgress', () => ({ usePathfinderInitialFillProgress: vi.fn() }));
let listProps: PathFinderNeedsRoutingListProps, panelProps: PathFinderCableRoutingPanelProps;
vi.mock('./PathFinderNeedsRoutingList', () => ({ PathFinderNeedsRoutingList: (props: PathFinderNeedsRoutingListProps) => {
  listProps = props; return <button disabled={!props.active} onClick={() => props.onSelect(row())}>Needs routing cable</button>;
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
      viewerPhase: 'ready', data: { activeModel: { modelVersionId: scope.modelVersionId, selectionRevision: scope.selectionRevision, contentFingerprint: scope.contentFingerprint }, artifacts: [] }, readSelection: vi.fn(), refresh: vi.fn() } as unknown as PathFinderCableWorkspaceProps['pf'] };
}
function writeProgress(): InitialFillProgress { return { schemaVersion: 'wfc.pf.initial-fill-progress.v1', projectId: id(1), actorId: id(2), impactId: id(8),
  mandate: { id: id(9), impactId: id(8), contentSha256: 'a'.repeat(64), mode: 'when-both-empty' }, authorized: true, currentAuthority: true, eligibleCables: 1,
  counters: { ...emptyInitialFillCounters(), written: 1 }, retryableUnknown: 0, outstanding: 0, selected: null }; }
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(fetchLocationImpacts).mockResolvedValue({ impacts: [] } as never);
  vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValue({ projectId: id(1), cableId: id(3), row: row() } as never);
  vi.mocked(usePathfinderLocationImpactProgress).mockReturnValue({ impact: null, error: null, refresh: vi.fn() } as never);
  vi.mocked(usePathfinderInitialFillProgress).mockReturnValue({ progress: null, error: null, refresh: vi.fn() } as never);
});
describe('owned cable routing workspace composition (mocked reads and child UI)', () => {
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
  it('uses retained recovery calculation preferences rather than the editor’s changed values for progress', () => {
    render(<PathFinderCableWorkspace {...props()} />); fireEvent.click(screen.getByText('Needs routing cable'));
    const original = { preferences: { secondaryDistanceMeters: 9, preferVerticalApproach: false }, timeoutMilliseconds: 7000 };
    act(() => { void panelProps.access.onSaved?.({ cableId: id(3), locationImpact: { id: id(8) } } as CableEndpointReceipt, endpointBindingFixture().context.current!, original); });
    expect(vi.mocked(usePathfinderLocationImpactProgress).mock.calls.at(-1)?.[0].calculation).toEqual(original);
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
});
