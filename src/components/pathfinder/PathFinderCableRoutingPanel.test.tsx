import { useState } from 'react';
import { FluentProvider, webDarkTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCableEndpointSelection } from '@/hooks/useCableEndpointSelection';
import { useCableEndpointPairSelection } from '@/hooks/useCableEndpointPairSelection';
import { cableWorkflowRowSchema } from '../../../shared/pathfinderCableWorkflow';
import { cableEndpointContextSchema } from '../../../shared/pathfinderCableEndpoints';
import { endpointBindingFixture } from '@/test/endpointBindingFixtures';
import { PathFinderCableRoutingPanel, type PathFinderCableRoutingPanelProps } from './PathFinderCableRoutingPanel';
import type { PathFinderWorkflowReview } from '@/pages/ProjectDetails/PathFinderResults';
import { cableComparisonInputSchema } from '../../../shared/pathfinderCableComparison';

vi.mock('@/hooks/useCableEndpointSelection', () => ({ useCableEndpointSelection: vi.fn() }));
vi.mock('@/hooks/useCableEndpointPairSelection', () => ({ useCableEndpointPairSelection: vi.fn() }));
const id = (value: number) => `93000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
type Assignment = ReturnType<typeof useCableEndpointPairSelection>;
type Endpoint = Assignment['from'];
function endpoint(): Endpoint { return { context: null, draft: null, effectiveDraft: null, draftSource: null, displaySelection: null,
  busy: false, error: null, notice: null, enabled: true, canSelect: true, selectObject: vi.fn(), setFixedPoint: vi.fn(), chooseDisplayedPoint: vi.fn(), refresh: vi.fn() } as unknown as Endpoint; }
function pair(): Assignment { return { identity: 'owned', from: endpoint(), to: endpoint(), pending: null, legacyPending: false, legacyRecovery: null, storageReady: true,
  busy: false, error: null, notice: null, receipt: null, retired: false, refreshPhase: 'idle', enabled: true, canSave: false, canRetry: false,
  save: vi.fn(async () => true), retry: vi.fn(async () => true), closePending: vi.fn(async () => true), refresh: vi.fn() } as Assignment; }
let assignment: Assignment;
function context(end: 'from' | 'to', mode: 'automatic' | 'confirmed' = 'automatic') {
  const base = endpointBindingFixture(), index = end === 'from' ? 0 : 1, point: [number, number, number] = [index + 1, 2, 3];
  const object = { traceId: id(8), objectRevisionId: id(20 + index), recordSha256: 'd'.repeat(64) };
  const current = { ...base.context.current!, modelVersionId: id(4), aggregateId: id(5), artifactId: id(6), captureFrameId: id(7),
    traceId: id(8), contentFingerprint: 'a'.repeat(64), projectionSha256: 'c'.repeat(64) };
  const selection = { sdkObjectId: 123 + index, name: index ? 'Motor object 002' : 'Panel object 001', object, pointProjectMetres: point, approximate: true };
  return cableEndpointContextSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-context.v1', projectId: id(1), cableId: id(3), end,
    cableWriteRevision: '4', logicalName: index ? 'Motor 002' : 'Panel 001', logicalKey: index ? 'MOTOR 002' : 'PANEL 001', mto: 'Control',
    canBind: true, reasonCodes: [], registryRevision: '5', current, contextSha256: 'a'.repeat(64),
    location: mode === 'confirmed' ? { id: id(70 + index), name: index ? 'Motor 002' : 'Panel 001', aliases: [], revision: '2' } : null,
    head: mode === 'confirmed' ? { ...base.binding, projectId: id(1), locationId: id(70 + index), modelVersionId: current.modelVersionId,
      aggregateId: current.aggregateId, artifactId: current.artifactId, captureFrameId: current.captureFrameId, projectionSha256: current.projectionSha256,
      mode: 'object-derived', derivation: 'equipment-bottom-aabb.v1', sourceObject: object, pointProjectMetres: point } : null,
    ...(mode === 'automatic' ? { automaticSelection: { ...selection, source: 'automatic-unconfirmed', confirmed: false } }
      : { confirmedSelection: { ...selection, source: 'confirmed', confirmed: true } }),
  });
}
function props(): PathFinderCableRoutingPanelProps {
  const ready = { status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false };
  return { access: { projectId: id(1), loadedProjectId: id(1), accountId: id(2), token: 'current-private-token', isAdmin: true, active: true,
    model: { modelVersionId: id(4), selectionRevision: '1', contentFingerprint: 'a'.repeat(64) }, preparationKey: 'prepared', readSelection: vi.fn(),
    calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 }, initialFill: { mode: 'when-both-empty' }, onSaved: vi.fn() },
    cable: cableWorkflowRowSchema.parse({ projectId: id(1), mto: 'Control', cable: { id: id(3), tag: 'Cable <literal>', fromLocation: 'Panel 001', toLocation: 'Motor 002', routing: null, designLength: null, installLength: '123', cableWriteRevision: '4' }, from: ready, to: ready,
      calculation: { jobId: null, jobStatus: null, itemState: null, outcome: 'not-evaluated', reasonCodes: [], errorCode: null, currentness: 'not-evaluated', proposalId: null, proposalHash: null, reviewable: false, acceptedMatchesCurrent: false } }),
    open: true, onClose: vi.fn(), onCalculate: vi.fn(), onTogglePath: vi.fn() };
}
function reviewController(p: PathFinderCableRoutingPanelProps): PathFinderWorkflowReview {
  return { cableId: p.cable!.cable.id, proposalId: id(80), comparisonLoading: false, comparisonError: null, message: null,
    reviewed: false, applied: false, canReview: true, canApply: false, busy: false, pending: false, canRecover: false, recoveryMessage: null, recoveryError: null,
    review: vi.fn(), apply: vi.fn(), retry: vi.fn(), closePending: vi.fn(),
    comparison: cableComparisonInputSchema.parse({ projectId: id(1), cableId: p.cable!.cable.id,
      current: { source: 'live-cable-read', contextSha256: 'a'.repeat(64), mto: p.cable!.mto, cable: p.cable!.cable },
      proposal: { projectId: id(1), cableId: p.cable!.cable.id, proposalId: id(80), proposalHash: 'b'.repeat(64), revisionResultHash: 'c'.repeat(64),
        cableWriteRevision: p.cable!.cable.cableWriteRevision, routing: '/NEW/SECONDARY', designLength: '180' } }) };
}
beforeEach(() => { assignment = pair(); vi.mocked(useCableEndpointPairSelection).mockReset().mockImplementation(() => assignment); vi.mocked(useCableEndpointSelection).mockReset(); });

describe('persistent nonmodal cable routing panel with atomic drafts', () => {
  it('keeps Calculate actionable for configuration while preserving endpoint Save and approval guards', () => {
    const p = props(), configure = vi.fn(), calculate = vi.fn(() => configure());
    p.access = { ...p.access, calculation: null, initialFill: undefined };
    p.cable!.cable.routing = '/STORED'; p.cable!.cable.designLength = '30';
    p.cable!.calculation.reasonCodes = ['BARRIER_WRITE_PROOF_REQUIRED'];
    const review = { ...reviewController(p), canReview: false, canApply: false };
    render(<PathFinderCableRoutingPanel {...p} review={review} onCalculate={calculate} onConfigureCalculation={configure}
      calculationBlockedReason="Configure the current barriers before calculating or saving changed From/To." />);
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate routing' })); expect(calculate).toHaveBeenCalledOnce(); expect(configure).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Configure routing' })); expect(configure).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/earlier route has no verified barrier checks/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review proposed routing' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply reviewed routing' })).toBeDisabled();
    const comparison = within(screen.getByRole('region', { name: 'Current and proposed cable values' }));
    expect(comparison.getByText('Design length: 30 m')).toBeVisible(); expect(comparison.getByText('/STORED')).toBeVisible();
    expect(comparison.getByText('/NEW/SECONDARY')).toBeVisible();
    expect(assignment.save).not.toHaveBeenCalled(); expect(review.review).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled();
  });
  it('shows stored values and the actual no-endpoint-change Save meaning without a fictitious comparison failure', () => {
    const p = props(); p.cable!.cable.routing = '/STORED'; p.cable!.cable.designLength = '30';
    render(<PathFinderCableRoutingPanel {...p} calculationBlockedReason="Configure the current barriers." />);
    const stored = within(screen.getByRole('region', { name: 'Stored cable values' }));
    expect(stored.getByText('Design length: 30 m')).toBeVisible(); expect(stored.getByText('/STORED')).toBeVisible();
    expect(screen.getByText(/No From\/To changes to save/)).toBeVisible();
    expect(screen.queryByText(/Current cable values or their exact proposal references are unavailable/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('explains unsaved endpoint changes under missing admission without enabling Save or a calculation', () => {
    assignment.from.context = context('from');
    render(<PathFinderCableRoutingPanel {...props()} calculationBlockedReason="Configure the current barriers." />);
    expect(screen.getByText(/Your From\/To changes are not saved/)).toBeVisible();
    expect(screen.queryByText(/No From\/To changes to save/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeDisabled();
    expect(assignment.save).not.toHaveBeenCalled();
  });
  it('does not use configuration-directed Calculate while exact Apply recovery is pending', () => {
    const p = props(), review = { ...reviewController(p), pending: true, canRecover: true, canReview: false, canApply: false };
    render(<PathFinderCableRoutingPanel {...p} review={review} calculationBlockedReason="Configure the current barriers." />);
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry pending routing Apply' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry pending routing Apply' })); expect(review.retry).toHaveBeenCalledOnce();
    expect(p.onCalculate).not.toHaveBeenCalled(); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('shows the separately read Auto projection without replacing Design or creating an approval', () => {
    const p = props(), refreshAutoLength = vi.fn(), review = { ...reviewController(p), autoLength: { autoCalculatedLength: 54,
      autoLengthStatus: 'calculated' as const, autoLengthCalculatedAt: '2026-10-21T12:00:00Z',
      autoLengthBarrierStatus: 'bypassed' as const, autoLengthMatchesLatestRequest: true }, refreshAutoLength };
    render(<PathFinderCableRoutingPanel {...p} review={review} />);
    const auto = within(screen.getByRole('region', { name: 'Automatic length from Cable list' }));
    expect(auto.getByText('54')).toBeVisible(); expect(auto.getByText(/Drill through the walls enabled/)).toBeVisible();
    expect(auto.queryByRole('spinbutton')).toBeNull(); expect(review.review).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled();
    fireEvent.click(auto.getByRole('button', { name: 'Refresh automatic length' })); expect(refreshAutoLength).toHaveBeenCalledOnce();
    expect(p.cable!.cable.designLength).not.toBe('54'); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('compares retained and proposed routing and length in the same popup and requires separate review and Apply clicks', () => {
    const p = props(); p.cable!.cable.routing = '/OLD/SECONDARY'; p.cable!.cable.designLength = '150';
    const review = reviewController(p), view = render(<PathFinderCableRoutingPanel {...p} review={review} />);
    const comparison = within(screen.getByRole('region', { name: 'Current and proposed cable values' }));
    expect(comparison.getByText('/OLD/SECONDARY')).toBeVisible(); expect(comparison.getByText('/NEW/SECONDARY')).toBeVisible();
    expect(comparison.getByText('Design length: 150 m')).toBeVisible(); expect(comparison.getByText('Design length: 180 m')).toBeVisible();
    expect(review.review).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled(); expect(assignment.save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply reviewed routing' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Review proposed routing' })); expect(review.review).toHaveBeenCalledOnce();
    view.rerender(<PathFinderCableRoutingPanel {...p} review={{ ...review, reviewed: true, canReview: false, canApply: true }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed routing' })); expect(review.apply).toHaveBeenCalledOnce();
    expect(p.cable!.cable.routing).toBe('/OLD/SECONDARY'); expect(p.cable!.cable.designLength).toBe('150'); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('blocks an earlier proposal while a new calculation is pending and refuses a different cable controller', () => {
    const p = props(), review = reviewController(p), view = render(<PathFinderCableRoutingPanel {...p} review={review} calculationPending />);
    expect(screen.getByRole('button', { name: 'Review proposed routing' })).toBeDisabled();
    expect(screen.getByText(/Waiting for this cable’s new calculation/)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Proposed cable values' })).toBeNull();
    view.rerender(<PathFinderCableRoutingPanel {...p} review={{ ...review, cableId: id(99), canApply: true }} />);
    expect(screen.getByRole('button', { name: 'Review proposed routing' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply reviewed routing' })).toBeDisabled();
    expect(review.review).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled();
  });
  it('keeps original Apply recovery in the popup when comparison is unavailable without creating a new write', () => {
    const p = props(), review = { ...reviewController(p), comparison: null, comparisonError: 'Refresh this exact comparison.', canReview: false,
      canApply: false, pending: true, canRecover: true, recoveryError: 'The outcome is unconfirmed.' };
    render(<PathFinderCableRoutingPanel {...p} review={review} />);
    expect(screen.getByRole('button', { name: 'Review proposed routing' })).toBeDisabled(); expect(review.retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry pending routing Apply' })); expect(review.retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close pending routing request' })); expect(review.closePending).toHaveBeenCalledOnce();
    expect(review.apply).not.toHaveBeenCalled(); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('keeps a bounded portal open through Model Browser focus, blur, pointer leave and outside interaction', () => {
    const p = props(); render(<><button>Outside control</button><iframe title="Model Browser" /><PathFinderCableRoutingPanel {...p} /></>);
    const dialog = screen.getByRole('dialog', { name: 'Cable <literal>' });
    expect(dialog).toHaveAttribute('aria-modal', 'false'); expect(dialog).toHaveAttribute('data-cable-id', id(3)); expect(dialog.closest('[data-portal-node]')).not.toBeNull();
    expect(dialog.querySelector('script')).toBeNull(); expect(screen.queryByRole('presentation')).toBeNull();
    const frame = screen.getByTitle('Model Browser'); act(() => frame.focus()); fireEvent.blur(dialog, { relatedTarget: frame }); fireEvent.pointerLeave(dialog);
    fireEvent.click(screen.getByRole('button', { name: 'Outside control' })); expect(dialog).toBeInTheDocument(); expect(p.onClose).not.toHaveBeenCalled();
    expect(assignment.save).not.toHaveBeenCalled(); expect(useCableEndpointSelection).not.toHaveBeenCalled();
    expect(dialog.style.position).toBe('fixed'); expect(dialog.style.right).toBe('16px'); expect(dialog.style.maxHeight).toContain('100vh');
  });
  it('Assign reads selected objects independently without saving or applying', () => {
    const p = props(); render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByRole('heading', { name: 'From: Panel 001' })).toBeVisible(); expect(screen.getByRole('heading', { name: 'To: Motor 002' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Assign From' })); expect(assignment.from.selectObject).toHaveBeenCalledOnce(); expect(assignment.to.selectObject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Assign To' })); expect(assignment.to.selectObject).toHaveBeenCalledOnce();
    expect(assignment.save).not.toHaveBeenCalled(); expect(useCableEndpointSelection).not.toHaveBeenCalled(); expect(p.access.onSaved).not.toHaveBeenCalled();
    expect(vi.mocked(useCableEndpointPairSelection).mock.calls.at(-1)?.[0]).toMatchObject({ cableId: id(3), readSelection: p.access.readSelection,
      calculation: p.access.calculation, initialFill: { mode: 'when-both-empty' }, onSaved: p.access.onSaved });
  });
  it('prepopulates both automatic names and coordinates as unconfirmed and sends one explicit pair Save', () => {
    assignment.from.context = context('from'); assignment.to.context = context('to'); assignment.canSave = true;
    const p = props(); render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByRole('textbox', { name: 'From assigned model object' })).toHaveValue('Panel object 001\nX: 1 m; Y: 2 m; Z: 3 m');
    expect(screen.getByRole('textbox', { name: 'To assigned model object' })).toHaveValue('Motor object 002\nX: 2 m; Y: 2 m; Z: 3 m');
    expect(screen.getAllByText('Automatically matched — confirm with Save.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(assignment.save).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(assignment.save).toHaveBeenCalledExactlyOnceWith('Confirm cable From/To model assignments.');
    expect(assignment.from.selectObject).not.toHaveBeenCalled(); expect(assignment.to.selectObject).not.toHaveBeenCalled(); expect(useCableEndpointSelection).not.toHaveBeenCalled();
  });
  it('shows an explicit selected draft instead of its prior automatic candidate and keeps it unsaved', () => {
    assignment.from.context = context('from'); assignment.from.draft = { mode: 'object-derived', sdkObjectId: 999, object: { traceId: id(8), objectRevisionId: id(99), recordSha256: 'f'.repeat(64) }, point: [7, 8, 9] };
    assignment.from.draftSource = 'selected'; assignment.from.displaySelection = { name: 'New selected equipment' } as Endpoint['displaySelection'];
    render(<PathFinderCableRoutingPanel {...props()} />);
    expect(screen.getByRole('textbox', { name: 'From assigned model object' })).toHaveValue('New selected equipment\nX: 7 m; Y: 8 m; Z: 9 m');
    expect(screen.getByText('Selected — not saved.')).toBeVisible(); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('reloads exact saved object names from confirmed context without fabricating another Save', () => {
    const p = props(), first = render(<PathFinderCableRoutingPanel {...p} />); first.unmount();
    assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed');
    render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByRole('textbox', { name: 'From assigned model object' })).toHaveValue('Panel object 001\nX: 1 m; Y: 2 m; Z: 3 m');
    expect(screen.getAllByText('Saved shared location.')).toHaveLength(2); expect(screen.queryByText('Automatically matched — confirm with Save.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('shows the saved fixed-world object label and coordinates while preserving the cable logical name', () => {
    const base = context('from', 'confirmed'), head = { ...base.head!, mode: 'fixed-world' as const, derivation: 'manual-world-point' as const, sourceObject: null, attachment: null };
    assignment.from.context = cableEndpointContextSchema.parse({ ...base, head, confirmedSelection: null, confirmedDisplaySelection: {
      source: 'confirmed-display-only', mode: 'fixed-world', sdkObjectId: 444, name: 'Equipment parent /actual-model-name',
      pointProjectMetres: head.pointProjectMetres, current: base.current!, bindingId: head.id, bindingContentSha256: head.contentSha256, commandSha256: 'e'.repeat(64),
    } });
    render(<PathFinderCableRoutingPanel {...props()} />);
    expect(screen.getByRole('heading', { name: 'From: Panel 001' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'From assigned model object' })).toHaveValue('Equipment parent /actual-model-name\nX: 1 m; Y: 2 m; Z: 3 m');
    expect(assignment.save).not.toHaveBeenCalled(); expect(assignment.from.selectObject).not.toHaveBeenCalled();
  });
  it('collapses without discarding ownership, pauses work and retains uncertain Save recovery', () => {
    assignment.pending = { cableId: id(3) } as Assignment['pending']; assignment.canRetry = true;
    const p = props(), view = render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByRole('region', { name: 'Pending endpoint assignment' })).toBeVisible(); expect(screen.getByRole('button', { name: 'Assign To' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' })); expect(screen.getByRole('dialog')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.queryByRole('button', { name: 'Assign From' })).toBeNull(); expect(vi.mocked(useCableEndpointPairSelection).mock.calls.at(-1)?.[0].active).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Expand' })); expect(screen.getByRole('region', { name: 'Pending endpoint assignment' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry exact pending save' })); expect(assignment.retry).toHaveBeenCalledOnce(); expect(assignment.save).not.toHaveBeenCalled();
    view.rerender(<PathFinderCableRoutingPanel {...p} open={false} />); expect(screen.queryByRole('dialog')).toBeNull();
    expect(vi.mocked(useCableEndpointPairSelection).mock.calls.at(-1)?.[0].active).toBe(false); expect(assignment.closePending).not.toHaveBeenCalled();
  });
  it('requires the explicit recovery button before closing an uncertain pair command', () => {
    assignment.pending = { cableId: id(3) } as Assignment['pending']; assignment.canRetry = true;
    render(<PathFinderCableRoutingPanel {...props()} />); expect(assignment.closePending).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close pending assignment' })); expect(assignment.closePending).toHaveBeenCalledOnce(); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('offers explicit earlier endpoint recovery without exposing the previous editor or creating a replacement Save', () => {
    assignment.legacyPending = true; assignment.canSave = false;
    assignment.legacyRecovery = { cableId: id(77), end: 'to', canRetry: true, retry: vi.fn(), close: vi.fn() };
    render(<PathFinderCableRoutingPanel {...props()} />);
    expect(screen.getByRole('region', { name: 'Earlier endpoint recovery' })).toBeVisible(); expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry earlier endpoint save' })); expect(assignment.legacyRecovery.retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close earlier endpoint command' })); expect(assignment.legacyRecovery.close).toHaveBeenCalledOnce();
    expect(assignment.save).not.toHaveBeenCalled(); expect(assignment.from.selectObject).not.toHaveBeenCalled();
  });
  it.each(['Close', 'Escape'])('returns focus after explicit %s without discarding pending Save', action => {
    const p = props(), anchor = document.createElement('button'); anchor.textContent = 'Cable anchor'; document.body.append(anchor); anchor.focus();
    function Harness() { const [open, setOpen] = useState(true); return <PathFinderCableRoutingPanel {...p} anchor={anchor} open={open} onClose={() => { p.onClose(); setOpen(false); }} />; }
    const view = render(<Harness />); if (action === 'Close') fireEvent.click(screen.getByRole('button', { name: 'Close' })); else fireEvent.keyDown(document, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledOnce(); expect(screen.queryByRole('dialog')).toBeNull(); expect(anchor).toHaveFocus(); expect(assignment.closePending).not.toHaveBeenCalled(); view.unmount(); anchor.remove();
  });
  it('links missing logical names to Cable list instead of substituting an SDK object name', () => {
    const p = props(); p.cable!.cable.fromLocation = '   '; render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByRole('button', { name: 'Assign From' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Assign To' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Set the From location name in Cable list' })).toHaveAttribute('href', `/projects/${id(1)}/cables/${id(3)}`);
    expect(screen.getByRole('heading', { name: 'From: Location name is missing.' })).toBeVisible(); expect(assignment.save).not.toHaveBeenCalled();
  });
  it.each(['unsaved', 'pending', 'busy', 'external-busy'] as const)('keeps Calculate disabled for %s', state => {
    const p = props(); if (state === 'unsaved') assignment.from.context = context('from'); if (state === 'pending') assignment.pending = { cableId: id(3) } as Assignment['pending'];
    if (state === 'busy') assignment.busy = true; if (state === 'external-busy') p.actionsBusy = true;
    render(<PathFinderCableRoutingPanel {...p} />); expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeDisabled(); expect(p.onCalculate).not.toHaveBeenCalled();
  });
  it('uses the protected Show/Hide callback and still allows Hide while a new draft is unsaved', () => {
    const p = props(); p.cable = cableWorkflowRowSchema.parse({ ...p.cable, calculation: { ...p.cable!.calculation,
      jobId: id(81), jobStatus: 'complete', itemState: 'complete', outcome: 'calculated', currentness: 'current', proposalId: id(80), proposalHash: 'f'.repeat(64) } });
    const view = render(<PathFinderCableRoutingPanel {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Show' })); expect(p.onTogglePath).toHaveBeenCalledOnce();
    assignment.from.context = context('from'); view.rerender(<PathFinderCableRoutingPanel {...p} />); expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled();
    view.rerender(<PathFinderCableRoutingPanel {...p} pathVisible />); expect(screen.getByRole('button', { name: 'Hide' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' })); expect(p.onTogglePath).toHaveBeenCalledTimes(2); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('keeps stored Cable list values distinct from the displayed calculated proposal', () => {
    const p = props(); p.cable!.cable.routing = '/OLD/SECONDARY'; p.cable!.cable.designLength = '150';
    const view = render(<PathFinderCableRoutingPanel {...p} />); expect(screen.getByRole('heading', { name: 'Cable list routing' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Cable routing' })).toHaveValue('/OLD/SECONDARY');
    view.rerender(<PathFinderCableRoutingPanel {...p} calculatedRouting="/NEW/SECONDARY" calculatedDesignLength="180" />);
    expect(screen.getByRole('heading', { name: 'Calculated routing' })).toBeVisible(); expect(screen.getByRole('textbox', { name: 'Cable routing' })).toHaveValue('/NEW/SECONDARY');
    expect(screen.getByText('Calculated design length: 180 m')).toBeVisible(); expect(p.cable!.cable.designLength).toBe('150');
    view.rerender(<PathFinderCableRoutingPanel {...p} calculatedRouting={null} calculatedDesignLength={null} />);
    expect(screen.getByRole('textbox', { name: 'Cable routing' })).toHaveValue(''); expect(screen.getByText('Calculated design length: Not available m')).toBeVisible();
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull(); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('lets the user Hide an already visible path even when its refreshed row no longer offers a proposal', () => {
    const p = props(); render(<PathFinderCableRoutingPanel {...p} pathVisible />);
    expect(screen.getByRole('button', { name: 'Hide' })).toBeEnabled(); fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(p.onTogglePath).toHaveBeenCalledOnce(); expect(assignment.save).not.toHaveBeenCalled(); expect(p.onCalculate).not.toHaveBeenCalled();
  });
  it('does not invoke the hook for denied, cross-project, MV or unknown categories', () => {
    const p = props(), view = render(<PathFinderCableRoutingPanel {...p} access={{ ...p.access, isAdmin: false }} />);
    expect(screen.queryByRole('dialog')).toBeNull(); view.rerender(<PathFinderCableRoutingPanel {...p} access={{ ...p.access, accountId: null }} />);
    view.rerender(<PathFinderCableRoutingPanel {...p} cable={{ ...p.cable!, projectId: id(99) }} />);
    for (const mto of ['MV', null, 'Unknown']) { view.rerender(<PathFinderCableRoutingPanel {...p} cable={{ ...p.cable!, mto }} />); expect(screen.queryByRole('dialog')).toBeNull(); }
    expect(useCableEndpointPairSelection).not.toHaveBeenCalled();
  });
  it('remounts ownership when cable/account changes and scopes its current hook to the new owner', () => {
    const p = props(), view = render(<PathFinderCableRoutingPanel {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    view.rerender(<PathFinderCableRoutingPanel {...p} access={{ ...p.access, accountId: id(99) }} cable={{ ...p.cable!, cable: { ...p.cable!.cable, id: id(98), tag: 'New cable' } }} />);
    expect(screen.getByRole('dialog', { name: 'New cable' })).toHaveAttribute('data-collapsed', 'false');
    expect(vi.mocked(useCableEndpointPairSelection).mock.calls.at(-1)?.[0]).toMatchObject({ cableId: id(98), accountId: id(99) });
  });
  it('disables both endpoints during an owned operation and surfaces the selected endpoint error', () => {
    assignment.busy = true; assignment.from.busy = true; assignment.from.error = 'The selected object belongs to another model.';
    render(<PathFinderCableRoutingPanel {...props()} />);
    expect(screen.getByRole('button', { name: 'Assign From' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Assign To' })).toBeDisabled();
    const region = within(screen.getByRole('region', { name: 'From endpoint' })); expect(region.getByText('Checking From selection…')).toBeVisible();
    expect(region.getByRole('alert')).toHaveTextContent('The selected object belongs to another model.');
  });
});

describe('selected bounding-box point presentation', () => {
  it('shows the manually selected object and its lower-face point while Save remains explicit', () => {
    assignment.from.draft = { mode: 'fixed-world', point: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: 55 };
    assignment.from.effectiveDraft = assignment.from.draft; assignment.from.draftSource = 'selected';
    assignment.from.displaySelection = { sdkObjectId: 55, name: 'BOX 1 of EQUIPMENT', point: [1, 2, 3] }; assignment.canSave = true;
    const p = props(); render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByRole('textbox', { name: 'From assigned model object' })).toHaveValue('BOX 1 of EQUIPMENT\nX: 1 m; Y: 2 m; Z: 3 m');
    expect(screen.getByRole('heading', { name: 'From: Panel 001' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(); expect(assignment.save).not.toHaveBeenCalled();
    expect(screen.getByText(/connection starts at the centre of its bottom face/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save' })); expect(assignment.save).toHaveBeenCalledOnce();
  });
});
describe('Path Finder detached window integration', () => {
  it('adopts the clicked window, uses the current selection callbacks and retains draft presentation on return', () => {
    const p = props(), frame = document.createElement('iframe'); document.body.appendChild(frame); const popup = frame.contentWindow!;
    Object.defineProperty(popup, 'closed', { configurable: true, value: false }); popup.focus = vi.fn(); popup.close = vi.fn();
    assignment.from.draft = { mode: 'fixed-world', point: [7, 8, 9], derivation: 'manual-world-point', displaySdkObjectId: 55 };
    assignment.from.draftSource = 'selected'; assignment.from.displaySelection = { sdkObjectId: 55, name: 'Parent equipment', point: [7, 8, 9] }; assignment.canSave = true;
    const view = render(<FluentProvider theme={webDarkTheme}><PathFinderCableRoutingPanel {...p} requestedPopup={{ window: popup, blocked: false, id: 'clicked' }} /></FluentProvider>);
    const child = within(popup.document.body); expect(child.getByRole('dialog', { name: 'Cable <literal>' })).toBeInTheDocument();
    const nativePanel = child.getByRole('dialog'), nativeProvider = nativePanel.closest('.fui-FluentProvider')!;
    expect(popup.getComputedStyle(nativeProvider).getPropertyValue('--colorNeutralBackground1')).toBe(webDarkTheme.colorNeutralBackground1);
    expect(popup.getComputedStyle(nativePanel).display).toBe('flex');
    expect(child.getByRole('textbox', { name: 'From assigned model object' })).toHaveValue('Parent equipment\nX: 7 m; Y: 8 m; Z: 9 m');
    fireEvent.click(child.getByRole('button', { name: 'Assign To' })); expect(assignment.to.selectObject).toHaveBeenCalledOnce(); expect(assignment.save).not.toHaveBeenCalled();
    fireEvent.click(child.getByRole('button', { name: 'Return to page' })); expect(popup.close).toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'From assigned model object' })).toHaveValue('Parent equipment\nX: 7 m; Y: 8 m; Z: 9 m');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(); expect(p.onCalculate).not.toHaveBeenCalled(); expect(p.onTogglePath).not.toHaveBeenCalled();
    view.unmount(); frame.remove();
  });
  it('keeps the separate window across cable switches and closes it on role revocation', () => {
    const p = props(), frame = document.createElement('iframe'); document.body.appendChild(frame); const popup = frame.contentWindow!;
    Object.defineProperty(popup, 'closed', { configurable: true, value: false }); popup.focus = vi.fn(); popup.close = vi.fn();
    const request = { window: popup, blocked: false, id: 'clicked' }, view = render(<PathFinderCableRoutingPanel {...p} requestedPopup={request} />);
    view.rerender(<PathFinderCableRoutingPanel {...p} requestedPopup={request} cable={{ ...p.cable!, cable: { ...p.cable!.cable, id: id(98), tag: 'Another cable' } }} />);
    expect(within(popup.document.body).getByRole('dialog', { name: 'Another cable' })).toBeInTheDocument(); expect(popup.close).not.toHaveBeenCalled();
    view.rerender(<PathFinderCableRoutingPanel {...p} requestedPopup={request} access={{ ...p.access, isAdmin: false }} />);
    expect(popup.close).toHaveBeenCalledOnce(); expect(popup.document.querySelector('[role=dialog]')).toBeNull(); frame.remove();
  });
  it('offers an inline fallback when the browser blocks the requested window', () => {
    render(<PathFinderCableRoutingPanel {...props()} requestedPopup={{ window: null, blocked: true, id: 'blocked' }} />);
    expect(screen.getByRole('dialog')).toBeVisible(); expect(screen.getByText(/browser blocked the separate window/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open in separate window' })).toBeEnabled();
  });
});
