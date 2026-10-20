import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCableEndpointSelection } from '@/hooks/useCableEndpointSelection';
import { cableWorkflowRowSchema } from '../../../shared/pathfinderCableWorkflow';
import { PathFinderCableRoutingPanel, type PathFinderCableRoutingPanelProps } from './PathFinderCableRoutingPanel';

vi.mock('@/hooks/useCableEndpointSelection', () => ({ useCableEndpointSelection: vi.fn() }));
const id = (value: number) => `93000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
type Endpoint = ReturnType<typeof useCableEndpointSelection>;
function endpoint(): Endpoint { return { identity: 'owned', context: null, draft: null, displaySelection: null, pending: null, storageReady: true, busy: false, error: null, notice: null, receipt: null,
  enabled: true, canSelect: true, canSave: false, canApplySelectedObject: true, canRetry: false, selectObject: vi.fn(), setFixedPoint: vi.fn(), chooseDisplayedPoint: vi.fn(),
  refresh: vi.fn(), save: vi.fn(), applySelectedObject: vi.fn(async () => true), retry: vi.fn(), closePending: vi.fn() } as unknown as Endpoint; }
let from: Endpoint, to: Endpoint;
function props(): PathFinderCableRoutingPanelProps {
  const ready = { status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false };
  return { access: { projectId: id(1), loadedProjectId: id(1), accountId: id(2), token: 'current-private-token', isAdmin: true, active: true,
    model: { modelVersionId: id(4), selectionRevision: '1', contentFingerprint: 'a'.repeat(64) }, preparationKey: 'prepared', readSelection: vi.fn(),
    calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 }, initialFill: { mode: 'when-both-empty' }, onSaved: vi.fn() },
    cable: cableWorkflowRowSchema.parse({ projectId: id(1), mto: 'Control', cable: { id: id(3), tag: 'Cable <literal>', fromLocation: 'Panel 001', toLocation: 'Motor 002', routing: null, designLength: null, installLength: '123', cableWriteRevision: '4' }, from: ready, to: ready,
      calculation: { jobId: null, jobStatus: null, itemState: null, outcome: 'not-evaluated', reasonCodes: [], errorCode: null, currentness: 'not-evaluated', proposalId: null, proposalHash: null, reviewable: false, acceptedMatchesCurrent: false } }), open: true, onClose: vi.fn() };
}
beforeEach(() => { from = endpoint(); to = endpoint(); vi.mocked(useCableEndpointSelection).mockReset().mockImplementation(access => access.end === 'from' ? from : to); });
describe('persistent nonmodal cable routing panel', () => {
  it('keeps a bounded portal open through Model Browser focus, blur, pointer leave and outside interaction', () => {
    const p = props(); render(<><button>Outside control</button><iframe title="Model Browser" /><PathFinderCableRoutingPanel {...p} /></>);
    const dialog = screen.getByRole('dialog', { name: 'Cable <literal>' });
    expect(dialog).toHaveAttribute('aria-modal', 'false'); expect(dialog).toHaveAttribute('data-cable-id', id(3)); expect(dialog.closest('[data-portal-node]')).not.toBeNull();
    expect(dialog.querySelector('script')).toBeNull(); expect(screen.queryByRole('presentation')).toBeNull();
    const frame = screen.getByTitle('Model Browser'); act(() => frame.focus()); fireEvent.blur(dialog, { relatedTarget: frame }); fireEvent.pointerLeave(dialog);
    fireEvent.click(screen.getByRole('button', { name: 'Outside control' })); expect(dialog).toBeInTheDocument(); expect(p.onClose).not.toHaveBeenCalled();
    expect(from.applySelectedObject).not.toHaveBeenCalled(); expect(to.applySelectedObject).not.toHaveBeenCalled();
    expect(Number.parseFloat(dialog.style.left)).toBeGreaterThan(8); expect(Number.parseFloat(dialog.style.width)).toBeLessThanOrEqual(416);
  });
  it('offers exact separate From/To actions through the protected callback and explicitly explains shared both-empty writes', () => {
    const p = props(); render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByText(/approximate bottom centre/)).toBeVisible(); expect(screen.getByText(/both current fields are empty/)).toBeVisible();
    expect(screen.getAllByText(/Exact shared usage is confirmed on save/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Apply for From' })); expect(from.applySelectedObject).toHaveBeenCalledWith('Apply selected model object for From endpoint.'); expect(to.applySelectedObject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply for To' })); expect(to.applySelectedObject).toHaveBeenCalledWith('Apply selected model object for To endpoint.');
    expect(from.selectObject).not.toHaveBeenCalled(); expect(from.save).not.toHaveBeenCalled();
    for (const [access] of vi.mocked(useCableEndpointSelection).mock.calls) expect(access).toMatchObject({ cableId: id(3), readSelection: p.access.readSelection, calculation: p.access.calculation, initialFill: { mode: 'when-both-empty' }, onSaved: p.access.onSaved });
  });
  it('collapses without unmounting endpoint ownership, pauses work and retains uncertain save recovery', () => {
    const p = props(); from.pending = { cableId: id(3), end: 'from', command: { expectedLogicalName: 'Panel 001' } } as Endpoint['pending']; from.canRetry = true;
    const view = render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByRole('region', { name: 'Pending endpoint assignment' })).toBeVisible(); expect(screen.getByRole('button', { name: 'Apply for To' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' })); expect(screen.getByRole('dialog')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.queryByRole('button', { name: 'Apply for From' })).toBeNull();
    const last = vi.mocked(useCableEndpointSelection).mock.calls.slice(-2); expect(last.every(([access]) => !access.active)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Expand' })); expect(screen.getByRole('region', { name: 'Pending endpoint assignment' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry exact pending save' })); expect(from.retry).toHaveBeenCalledOnce(); expect(from.applySelectedObject).not.toHaveBeenCalled();
    view.rerender(<PathFinderCableRoutingPanel {...p} open={false} />); expect(screen.queryByRole('dialog')).toBeNull();
    expect(vi.mocked(useCableEndpointSelection).mock.calls.slice(-2).every(([access]) => !access.active)).toBe(true); expect(from.closePending).not.toHaveBeenCalled();
  });
  it.each(['Close', 'Escape'])('returns focus after explicit %s without discarding an assignment', action => {
    const p = props(), anchor = document.createElement('button'); anchor.textContent = 'Cable anchor'; document.body.append(anchor); anchor.focus();
    function Harness() { const [open, setOpen] = useState(true); return <PathFinderCableRoutingPanel {...p} anchor={anchor} open={open} onClose={() => { p.onClose(); setOpen(false); }} />; }
    const view = render(<Harness />);
    if (action === 'Close') fireEvent.click(screen.getByRole('button', { name: 'Close' })); else fireEvent.keyDown(document, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledOnce(); expect(screen.queryByRole('dialog')).toBeNull(); expect(anchor).toHaveFocus(); expect(from.closePending).not.toHaveBeenCalled();
    view.unmount(); anchor.remove();
  });
  it('links missing logical names to the Cable list rather than using the selected SDK object name', () => {
    const p = props(); p.cable!.cable.fromLocation = '   '; render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByRole('button', { name: 'Apply for From' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply for To' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Set the From location name in Cable list' })).toHaveAttribute('href', `/projects/${id(1)}/cables/${id(3)}`);
    expect(from.applySelectedObject).not.toHaveBeenCalled();
  });
  it('shows only receipt-backed shared counts and distinguishes saving a shared location from cable updates', () => {
    const p = props(), view = render(<PathFinderCableRoutingPanel {...p} />); expect(screen.queryByText(/Shared location saved:/)).toBeNull();
    from.receipt = { cableId: id(3), end: 'from', logicalName: 'Panel 001', impact: { distinctCables: 20, fromOccurrences: 12, toOccurrences: 15 } } as Endpoint['receipt'];
    view.rerender(<PathFinderCableRoutingPanel {...p} />); expect(screen.getByText(/Shared location saved: 20 cables; 12 From and 15 To occurrences/)).toBeVisible();
    expect(screen.getByText(/Cable calculation and initial fill are checked separately/)).toBeVisible(); expect(screen.queryByText('Updated')).toBeNull();
  });
  it('does not relabel a reconciled old cable assignment as a save of the current endpoint', () => {
    const p = props(); from.receipt = { cableId: id(99), end: 'to', logicalName: 'Old project location', impact: { distinctCables: 20, fromOccurrences: 12, toOccurrences: 15 } } as Endpoint['receipt'];
    render(<PathFinderCableRoutingPanel {...p} />); expect(screen.getByText(/previous assignment to Old project location is confirmed/)).toBeVisible(); expect(screen.queryByText(/Shared location saved:/)).toBeNull();
  });
  it('hides the panel and actions for denied, cross-project, MV or unknown categories', () => {
    const p = props(), view = render(<PathFinderCableRoutingPanel {...p} access={{ ...p.access, isAdmin: false }} />); expect(screen.queryByRole('dialog')).toBeNull(); expect(useCableEndpointSelection).not.toHaveBeenCalled();
    view.rerender(<PathFinderCableRoutingPanel {...p} access={{ ...p.access, accountId: null }} />); expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(<PathFinderCableRoutingPanel {...p} cable={{ ...p.cable!, projectId: id(99) }} />); expect(screen.queryByRole('dialog')).toBeNull();
    for (const mto of ['MV', null, 'Unknown']) { view.rerender(<PathFinderCableRoutingPanel {...p} cable={{ ...p.cable!, mto }} />); expect(screen.queryByRole('dialog')).toBeNull(); }
    expect(useCableEndpointSelection).not.toHaveBeenCalled();
  });
  it('keeps the other endpoint disabled while an owned operation is active', () => {
    from.busy = true; render(<PathFinderCableRoutingPanel {...props()} />);
    expect(screen.getByRole('button', { name: 'Apply for From' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply for To' })).toBeDisabled();
    expect(within(screen.getByRole('region', { name: 'From endpoint' })).getByText('Checking or saving From…')).toBeVisible();
  });
});
