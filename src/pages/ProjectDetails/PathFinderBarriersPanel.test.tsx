import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderBarriersPanel, type PathFinderBarriersPanelProps } from './PathFinderBarriersPanel';
import { usePathfinderBarriers } from './hooks/usePathfinderBarriers';
import type { BarrierRegistry } from '../../../shared/pathfinderBarriers';

vi.mock('./hooks/usePathfinderBarriers', () => ({ usePathfinderBarriers: vi.fn() }));
const id = (n: number) => `b5000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const registry: BarrierRegistry = { schemaVersion: 'wfc.pf.barrier-registry.v1', scope: { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' }, registryRevision: '1', state: 'unconfigured', selectedParents: [], snapshot: null, reasonCodes: ['NO_BARRIER_SCOPE_CONFIGURED'] };
  const state = { registry, manifest: null, draftParents: [] as BarrierRegistry['selectedParents'], kind: 'wall' as const, setKind: vi.fn(), emptyReason: '', setEmptyReason: vi.fn(), phase: 'idle', message: null, error: null, busy: false, dirty: false, pending: false, canAuthor: true,
    refresh: vi.fn(), addSelection: vi.fn(), removeParent: vi.fn(), save: vi.fn(), retry: vi.fn(), cancel: vi.fn(), discardPending: vi.fn() };
  const props: PathFinderBarriersPanelProps = { projectId: id(1), loadedProjectId: id(1), token: 'synthetic-login', isAdmin: true, pf: { busy: false } as PathFinderBarriersPanelProps['pf'], onStateChange: vi.fn() };
  const install = () => vi.mocked(usePathfinderBarriers).mockReturnValue(state as unknown as ReturnType<typeof usePathfinderBarriers>); install();
  return { state, props, install };
}
beforeEach(() => vi.clearAllMocks());

describe('administrator barrier authoring panel', () => {
  it('keeps its authoring hook entirely unmounted for a non-administrator', () => {
    const f = fixture(); render(<PathFinderBarriersPanel {...f.props} isAdmin={false} />);
    expect(usePathfinderBarriers).not.toHaveBeenCalled(); expect(screen.queryByRole('region', { name: 'Barriers' })).toBeNull();
  });
  it('shows English accessible authoring controls and explains current Model Browser selection', () => {
    const f = fixture(); render(<PathFinderBarriersPanel {...f.props} />);
    expect(screen.getByRole('region', { name: 'Barriers' })).toBeInTheDocument(); expect(screen.getByRole('combobox', { name: 'Barrier type' })).toHaveValue('wall');
    expect(screen.getByText(/Select an object in Model Browser/)).toBeInTheDocument(); expect(screen.getByText(/descendant fragments/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add selected objects' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Declare no barriers' })).toBeDisabled();
    expect(screen.getByText(/This does not declare that the model has no barriers/)).toBeInTheDocument(); expect(screen.queryByText(/Published manifest:/)).toBeNull();
  });
  it('allows keyboard activation of Add selected objects and changes the explicit barrier type', async () => {
    const f = fixture(); const user = userEvent.setup(); render(<PathFinderBarriersPanel {...f.props} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Barrier type' }), 'floor'); expect(f.state.setKind).toHaveBeenCalledWith('floor');
    screen.getByRole('button', { name: 'Add selected objects' }).focus(); await user.keyboard('{Enter}'); expect(f.state.addSelection).toHaveBeenCalledTimes(1);
  });
  it('offers an explicit Obstacle type for pipes, tanks and mixed groups without selecting or saving objects automatically', async () => {
    const f = fixture(); const user = userEvent.setup(); render(<PathFinderBarriersPanel {...f.props} />);
    const select = screen.getByRole('combobox', { name: 'Barrier type' });
    expect(select).toHaveValue('wall');
    expect(screen.getByRole('option', { name: 'Obstacle' })).toHaveValue('obstacle');
    expect(screen.getByText(/Choose Obstacle for pipes, tanks or mixed model groups/)).toBeVisible();
    expect(screen.getByText(/qualified captured triangle geometry/)).toHaveTextContent('A bounding box is not treated as a solid obstacle');
    await user.selectOptions(select, 'obstacle');
    expect(f.state.setKind).toHaveBeenCalledWith('obstacle');
    expect(f.state.addSelection).not.toHaveBeenCalled(); expect(f.state.save).not.toHaveBeenCalled();
  });
  it('shows a registered mixed-group parent as an Obstacle and saves only after explicit activation', () => {
    const f = fixture(); f.state.draftParents = [{ selectionId: id(8), kind: 'obstacle', objectId: 'dbid:18', dbId: 18,
      name: 'Selected mixed source group', externalId: null, inclusion: 'own-and-all-descendant-fragments', identityBasis: 'version-local-only' }];
    f.state.dirty = true; f.install(); render(<PathFinderBarriersPanel {...f.props} />);
    const list = within(screen.getByRole('list', { name: 'Selected barrier parents' }));
    expect(list.getByText('Selected mixed source group')).toBeVisible(); expect(list.getByText('Obstacle')).toBeVisible();
    expect(f.state.save).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Save barrier set' }));
    expect(f.state.save).toHaveBeenCalledTimes(1);
  });
  it('shows exact selected parent names and removes only the requested draft identity', () => {
    const f = fixture(); f.state.draftParents = [{ selectionId: id(7), kind: 'partition', objectId: 'dbid:12', dbId: 12, name: 'Named civil partition', externalId: null, inclusion: 'own-and-all-descendant-fragments', identityBasis: 'version-local-only' }]; f.state.dirty = true; f.install();
    render(<PathFinderBarriersPanel {...f.props} />); expect(screen.getByRole('list', { name: 'Selected barrier parents' })).toHaveTextContent('Named civil partition');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Named civil partition' })); expect(f.state.removeParent).toHaveBeenCalledWith(id(7));
    fireEvent.click(screen.getByRole('button', { name: 'Save barrier set' })); expect(f.state.save).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/published barrier set remains unchanged/)).toBeInTheDocument();
  });
  it('requires an explicit empty reason and exposes a separately named declaration action', () => {
    const f = fixture(); const view = render(<PathFinderBarriersPanel {...f.props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Explicit empty reason' }), { target: { value: 'Reviewed empty registered scope' } }); expect(f.state.setEmptyReason).toHaveBeenCalledWith('Reviewed empty registered scope');
    f.state.emptyReason = 'Reviewed empty registered scope'; f.install(); view.rerender(<PathFinderBarriersPanel {...f.props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Declare no barriers' })); expect(f.state.save).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/does not certify that the model contains no walls/)).toBeInTheDocument();
  });
  it('retains unknown commands without allowing discard or a replacement draft', () => {
    const f = fixture(); f.state.phase = 'unknown'; f.state.pending = true; f.install(); render(<PathFinderBarriersPanel {...f.props} />);
    expect(screen.getByRole('status')).toHaveTextContent('Unknown command outcome'); expect(screen.getByRole('button', { name: 'Add selected objects' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Discard saved command' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Retry saved command' })); expect(f.state.retry).toHaveBeenCalledTimes(1);
  });
  it('shows cancellation during capture while preventing conflicting authoring changes', () => {
    const f = fixture(); f.state.busy = true; f.state.phase = 'capturing'; f.install(); render(<PathFinderBarriersPanel {...f.props} />);
    expect(screen.getByRole('button', { name: 'Add selected objects' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(f.state.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Capturing selected barrier geometry…')).toBeInTheDocument();
  });
  it('reports only current registry/draft/pending state to the common calculation controls', async () => {
    const f = fixture(); const view = render(<PathFinderBarriersPanel {...f.props} />);
    await waitFor(() => expect(f.props.onStateChange).toHaveBeenLastCalledWith({ registry: f.state.registry, dirty: false, pending: false }));
    f.state.dirty = true; f.state.pending = true; f.install(); view.rerender(<PathFinderBarriersPanel {...f.props} />);
    await waitFor(() => expect(f.props.onStateChange).toHaveBeenLastCalledWith({ registry: f.state.registry, dirty: true, pending: true }));
  });
  it('unmounts all authoring controls immediately when administrator access is lost', () => {
    const f = fixture(); const view = render(<PathFinderBarriersPanel {...f.props} />); const calls = vi.mocked(usePathfinderBarriers).mock.calls.length;
    view.rerender(<PathFinderBarriersPanel {...f.props} isAdmin={false} />); expect(screen.queryByRole('region', { name: 'Barriers' })).toBeNull(); expect(usePathfinderBarriers).toHaveBeenCalledTimes(calls);
  });
});
