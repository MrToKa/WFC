import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderBarriersPanel, type PathFinderBarriersPanelProps } from './PathFinderBarriersPanel';
import { usePathfinderBarriers } from './hooks/usePathfinderBarriers';
import type { BarrierRegistry, BarrierSnapshot } from '../../../shared/pathfinderBarriers';

vi.mock('./hooks/usePathfinderBarriers', () => ({ usePathfinderBarriers: vi.fn() }));
const id = (n: number) => `b5000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const registry: BarrierRegistry = { schemaVersion: 'wfc.pf.barrier-registry.v1', scope: { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' }, registryRevision: '1', state: 'unconfigured', selectedParents: [], snapshot: null, reasonCodes: ['NO_BARRIER_SCOPE_CONFIGURED'] };
  const state = { registry: registry as BarrierRegistry | null, manifest: null, saved: null as ReturnType<typeof usePathfinderBarriers>['saved'], draftParents: [] as BarrierRegistry['selectedParents'], kind: 'wall' as const, setKind: vi.fn(), emptyReason: '', setEmptyReason: vi.fn(), phase: 'idle', message: null, error: null, busy: false, dirty: false, pending: false, canAuthor: true, canRetry: true, canInspect: true, canClose: true, canDiscard: true,
    refresh: vi.fn(), addSelection: vi.fn(), removeParent: vi.fn(), save: vi.fn(), retry: vi.fn(), inspect: vi.fn(), close: vi.fn(), cancel: vi.fn(), discardPending: vi.fn() };
  const props: PathFinderBarriersPanelProps = { projectId: id(1), loadedProjectId: id(1), token: 'synthetic-login', isAdmin: true, pf: { busy: false } as PathFinderBarriersPanelProps['pf'], onStateChange: vi.fn() };
  const install = () => vi.mocked(usePathfinderBarriers).mockReturnValue(state as unknown as ReturnType<typeof usePathfinderBarriers>); install();
  return { state, props, install };
}
beforeEach(() => vi.clearAllMocks());

function savedManifest(): BarrierSnapshot {
  const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  const parent = { selectionId: id(8), kind: 'obstacle' as const, objectId: 'dbid:18', dbId: 18, name: 'Saved civil source group', externalId: null,
    inclusion: 'own-and-all-descendant-fragments' as const, identityBasis: 'version-local-only' as const };
  return { schemaVersion: 'wfc.pf.barrier-snapshot.v1', snapshotId: id(10), scope, registryRevision: '1', contentSha256: 'c'.repeat(64), selectedParents: [parent],
    capture: { captureId: id(11), payloadSha256: 'd'.repeat(64) }, geometry: { mode: 'mesh-set', fragments: [{ source: { fragmentId: 0, ownerObjectId: 'dbid:18', parentSelectionIds: [id(8)],
      sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], transformSha256: 'e'.repeat(64) },
      bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] }, mesh: { blobId: id(12), sha256: 'f'.repeat(64), bytes: 256 }, vertices: 8, triangles: 12 }],
      verification: { producerVersion: 'wfc.pf.barrier-verifier.v1', selectionClosure: 'complete-selected-scope', topology: 'qualified-closed-consistent-two-manifold',
        selfIntersection: 'bounded-verification-passed', computationalMeshes: 1, verifiedCaptureSha256: 'd'.repeat(64), verificationSha256: 'a'.repeat(64) } },
    coverage: 'registered-selected-objects-only', engineeringAccepted: false };
}

describe('administrator barrier authoring panel', () => {
  it('keeps stale saved obstacles visible separately from an empty current draft', () => {
    const f = fixture(); f.state.saved = { manifest: savedManifest(), status: 'recapture-required' }; f.install();
    render(<PathFinderBarriersPanel {...f.props} />);
    const saved = within(screen.getByRole('region', { name: 'Saved obstacles' }));
    expect(saved.getByRole('list', { name: 'Saved barrier parents' })).toHaveTextContent('Saved civil source group');
    expect(saved.getByText(/old geometry is not ready for calculation/)).toBeVisible();
    expect(saved.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Selected barrier parents' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Saved obstacles need recapture');
    expect(f.state.addSelection).not.toHaveBeenCalled(); expect(f.state.save).not.toHaveBeenCalled();
  });
  it('retains unavailable saved names while current authoring is disabled and exposes their original scope', () => {
    const f = fixture(); f.state.registry = null; f.state.canAuthor = false; f.state.saved = { manifest: savedManifest(), status: 'unavailable' }; f.install();
    render(<PathFinderBarriersPanel {...f.props} />);
    const saved = within(screen.getByRole('region', { name: 'Saved obstacles' }));
    expect(saved.getByText('Saved civil source group')).toBeVisible(); expect(saved.getByText(/Current readiness is unavailable/)).toBeVisible();
    expect(saved.getByText(/Snapshot/)).toHaveTextContent(`Model ${id(2)}. Frame ${id(3)}`);
    expect(screen.getByRole('button', { name: 'Add selected objects' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Declare no barriers' })).toBeDisabled();
  });
  it('labels Add as unsaved and keeps a changed draft distinct from the saved obstacle list', () => {
    const f = fixture(); f.state.saved = { manifest: savedManifest(), status: 'current' };
    f.state.draftParents = [{ ...f.state.saved.manifest.selectedParents[0], selectionId: id(20), objectId: 'dbid:20', dbId: 20, name: 'New unsaved object' }]; f.state.dirty = true; f.install();
    render(<PathFinderBarriersPanel {...f.props} />);
    expect(screen.getByText(/Add selected objects creates an unsaved draft/)).toHaveTextContent('unsaved additions do not survive a browser refresh');
    expect(screen.getByRole('list', { name: 'Saved barrier parents' })).toHaveTextContent('Saved civil source group');
    expect(screen.getByRole('list', { name: 'Selected barrier parents' })).toHaveTextContent('New unsaved object');
    expect(screen.getByText(/Unsaved changes/)).toBeVisible(); expect(f.state.save).not.toHaveBeenCalled();
  });
  it('shows a saved empty declaration without resurrecting a nonempty list', () => {
    const f = fixture(), manifest = savedManifest(); manifest.selectedParents = []; manifest.capture = null;
    manifest.geometry = { mode: 'explicit-empty', declarationId: id(30), declaration: 'administrator-declared-no-selected-barriers', reason: 'Saved reviewed empty scope' };
    f.state.saved = { manifest, status: 'unavailable' }; f.install(); render(<PathFinderBarriersPanel {...f.props} />);
    expect(screen.getByRole('region', { name: 'Saved obstacles' })).toHaveTextContent('Published empty declaration: Saved reviewed empty scope');
    expect(screen.queryByRole('list', { name: 'Saved barrier parents' })).toBeNull(); expect(f.state.save).not.toHaveBeenCalled();
  });
  it('keeps exact pending retry available after current readiness is withheld', () => {
    const f = fixture(); f.state.registry = null; f.state.canAuthor = false; f.state.pending = true; f.state.phase = 'unknown'; f.state.canRetry = true; f.install();
    render(<PathFinderBarriersPanel {...f.props} />);
    expect(screen.getByRole('button', { name: 'Add selected objects' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved command' })); expect(f.state.retry).toHaveBeenCalledOnce();
    expect(f.state.save).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Discard saved command' })).toBeNull();
  });
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
  it('offers explicit inspect and exact-command close while the Viewer and current registry are unavailable', () => {
    const f = fixture(); f.state.phase = 'unknown'; f.state.pending = true; f.state.canAuthor = false; f.state.registry = null;
    f.props.pf = { ...f.props.pf, viewerPhase: 'error' }; f.install(); render(<PathFinderBarriersPanel {...f.props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect saved outcome' })); expect(f.state.inspect).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close this exact command' })); expect(f.state.close).toHaveBeenCalledOnce();
    expect(screen.getByText(/Close stops only this exact command/)).toHaveTextContent('keeps the published barriers');
    expect(f.state.retry).not.toHaveBeenCalled(); expect(f.state.save).not.toHaveBeenCalled(); expect(f.state.addSelection).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Discard saved command' })).toBeNull();
  });
  it('keeps both recovery actions disabled when their hook authority or operation guard is unavailable', () => {
    const f = fixture(); f.state.pending = true; f.state.canInspect = false; f.state.canClose = false; f.install();
    const view = render(<PathFinderBarriersPanel {...f.props} />);
    expect(screen.getByRole('button', { name: 'Inspect saved outcome' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Close this exact command' })).toBeDisabled();
    view.rerender(<PathFinderBarriersPanel {...f.props} isAdmin={false} />);
    expect(screen.queryByRole('button', { name: 'Close this exact command' })).toBeNull();
  });
  it('disables saved-command discard while exact terminal recovery still needs refresh, and keeps legal draft discard active', () => {
    const f = fixture(); f.state.pending = true; f.state.phase = 'refused'; f.state.canDiscard = false; f.install();
    const view = render(<PathFinderBarriersPanel {...f.props} />);
    expect(screen.getByRole('button', { name: 'Discard saved command' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard saved command' })); expect(f.state.discardPending).not.toHaveBeenCalled();
    f.state.pending = false; f.state.dirty = true; f.state.canDiscard = true; f.install(); view.rerender(<PathFinderBarriersPanel {...f.props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft and refresh' })); expect(f.state.discardPending).toHaveBeenCalledOnce();
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
