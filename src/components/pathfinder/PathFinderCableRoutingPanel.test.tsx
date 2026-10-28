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

describe('verified live popup endpoint foreground publisher', () => {
  it('publishes one matching live pair and retracts it when retired or unmounted', () => {
    assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed');
    const p = props(), changed = vi.fn(), view = render(<PathFinderCableRoutingPanel {...p} onEndpointForegroundContexts={changed} />);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: id(1), accountId: id(2), cableId: id(3),
      modelVersionId: id(4), preparationKey: 'prepared', from: assignment.from.context, to: assignment.to.context }));
    assignment.retired = true; view.rerender(<PathFinderCableRoutingPanel {...p} onEndpointForegroundContexts={changed} />);
    expect(changed).toHaveBeenLastCalledWith(null); view.unmount(); expect(changed).toHaveBeenLastCalledWith(null);
  });
  it.each(['pending', 'draft', 'retired', 'busy', 'error', 'disabled child', 'registry', 'cable revision', 'current model', 'inactive'])(
    'never publishes retained or ineligible %s contexts', blocked => {
      assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed');
      const p = props(), changed = vi.fn();
      if (blocked === 'pending') assignment.pending = {} as never;
      if (blocked === 'draft') assignment.from.draft = { mode: 'fixed-world', point: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: null };
      if (blocked === 'retired') assignment.retired = true;
      if (blocked === 'busy') assignment.busy = true;
      if (blocked === 'error') assignment.from.error = 'Read unavailable';
      if (blocked === 'disabled child') assignment.to.enabled = false;
      if (blocked === 'registry') assignment.to.context.registryRevision = '999';
      if (blocked === 'cable revision') assignment.to.context.cableWriteRevision = '999';
      if (blocked === 'current model') assignment.to.context.current!.modelVersionId = id(99);
      if (blocked === 'inactive') p.open = false;
      render(<PathFinderCableRoutingPanel {...p} onEndpointForegroundContexts={changed} />);
      expect(changed.mock.calls.every(([value]) => value === null)).toBe(true);
    });
});

describe('exact selected-cable calculation failure diagnostics', () => {
  it('shows the actual failed item next to Calculate and keeps the previous route separate', () => {
    const p = props();
    p.cable = { ...p.cable!, cable: { ...p.cable!.cable, routing: '/PREVIOUS', designLength: '58' }, calculation: { ...p.cable!.calculation,
      jobId: id(71), jobStatus: 'complete', itemState: 'blocked', outcome: 'no-path', reasonCodes: ['NO_PATH'] } };
    p.calculationFeedback = { working: false, message: 'The recalculation stopped without a current route. Check its diagnostics before calculating again.' };
    p.calculationDiagnostics = { cableId: id(3), jobId: id(71), jobStatus: 'complete', itemStatus: 'no_path', itemState: 'blocked',
      itemMessage: 'The From point cannot reach any permitted tray.', jobFailure: null, readError: null };
    render(<FluentProvider theme={webDarkTheme}><PathFinderCableRoutingPanel {...p} /></FluentProvider>);
    expect(screen.getByText('Calculation stopped: The From point cannot reach any permitted tray.')).toBeVisible();
    fireEvent.click(screen.getByText('Calculation diagnostics'));
    expect(screen.getByText('Cable diagnostic: The From point cannot reach any permitted tray.')).toBeVisible();
    expect(screen.getByText(/Latest calculation outcome: no-path/)).toHaveTextContent(id(71));
    expect(screen.getByLabelText('Cable routing')).toHaveValue('/PREVIOUS');
    expect(screen.getByRole('button', { name: /^Show$/ })).toBeDisabled();
    expect(p.onCalculate).not.toHaveBeenCalled(); expect(assignment.save).not.toHaveBeenCalled();
  });
  it.each([false, true])('presents a refreshed network without repeating its historical preparation refusal (feedback=%s)', feedback => {
    const p = props(); p.onCalculate = undefined;
    p.cable = { ...p.cable!, calculation: { ...p.cable!.calculation, jobId: id(71), jobStatus: 'complete', itemState: 'blocked',
      outcome: 'stale', currentness: 'changed', reasonCodes: ['ROUTING_PREPARATION_REQUIRED', 'ROUTING_PREPARATION_UPDATED'],
      errorCode: 'ROUTING_PREPARATION_REQUIRED' } };
    if (feedback) p.calculationFeedback = { working: false, message: 'The recalculation stopped without a current route.' };
    p.calculationDiagnostics = { cableId: id(3), jobId: id(71), jobStatus: 'complete', itemStatus: 'routing_preparation_required', itemState: 'blocked',
      itemMessage: 'Prepare the project network against the current tray catalog and routing permissions before calculating.', jobFailure: null, readError: null };
    render(<FluentProvider theme={webDarkTheme}><PathFinderCableRoutingPanel {...p} /></FluentProvider>);
    expect(screen.getByText('Network ready. Calculate routing to create a current route.')).toBeVisible();
    expect(screen.queryByText(/^Calculation stopped:/)).toBeNull(); expect(screen.queryByText('Calculation diagnostics')).toBeNull();
    const details = screen.getByText('Previous calculation diagnostics').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByText(/^Previous cable diagnostic:/)).not.toBeVisible();
    expect(within(details).getByText(/Previous calculation job:/)).toHaveTextContent(id(71));
    expect(within(details).getByText(/Recorded refusal and update codes:/)).toHaveTextContent('ROUTING_PREPARATION_REQUIRED');
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Show$/ })).toBeDisabled();
    fireEvent.click(screen.getByText('Previous calculation diagnostics'));
    expect(within(details).getByText(/^Previous cable diagnostic:/)).toBeVisible();
    expect(within(details).getByText(/Previous calculation error code:/)).toHaveTextContent('ROUTING_PREPARATION_REQUIRED');
    expect(assignment.save).not.toHaveBeenCalled();
  });
  it('does not hide a genuine current failure merely because the update marker is present', () => {
    const p = props(); p.cable = { ...p.cable!, calculation: { ...p.cable!.calculation, jobId: id(72), jobStatus: 'complete',
      itemState: 'blocked', outcome: 'no-path', currentness: 'current', reasonCodes: ['NO_PATH', 'ROUTING_PREPARATION_UPDATED'] } };
    p.calculationDiagnostics = { cableId: id(3), jobId: id(72), jobStatus: 'complete', itemStatus: 'no_path', itemState: 'blocked',
      itemMessage: 'The From point cannot reach any permitted tray.', jobFailure: null, readError: null };
    render(<FluentProvider theme={webDarkTheme}><PathFinderCableRoutingPanel {...p} /></FluentProvider>);
    expect(screen.getByText('Calculation stopped: The From point cannot reach any permitted tray.')).toBeVisible();
    expect(screen.queryByText('Network ready. Calculate routing to create a current route.')).toBeNull();
    expect(screen.getByText('Calculation diagnostics')).toBeVisible();
  });
  it.each(['Configure the current route settings and barriers. No calculation was submitted.',
    'No calculation job was created. Refresh barriers and calculate again.'])('shows a fresh attempt refusal over a historical preparation update: %s', message => {
    const p = props(); p.cable = { ...p.cable!, calculation: { ...p.cable!.calculation, jobId: id(71), jobStatus: 'complete', itemState: 'blocked',
      outcome: 'stale', currentness: 'changed', reasonCodes: ['ROUTING_PREPARATION_REQUIRED', 'ROUTING_PREPARATION_UPDATED'] } };
    p.calculationFeedback = { working: false, message, currentAttempt: true };
    p.calculationDiagnostics = { cableId: id(3), jobId: id(71), jobStatus: 'complete', itemStatus: 'routing_preparation_required', itemState: 'blocked',
      itemMessage: 'Prepare the previous routing network.', jobFailure: null, readError: null };
    const view = render(<FluentProvider theme={webDarkTheme}><PathFinderCableRoutingPanel {...p} /></FluentProvider>);
    expect(screen.getByText(message)).toBeVisible(); expect(screen.queryByText('Network ready. Calculate routing to create a current route.')).toBeNull();
    expect(screen.queryByText(/^Calculation stopped:/)).toBeNull(); expect(screen.getByText('Previous calculation diagnostics')).toBeVisible();
    view.rerender(<FluentProvider theme={webDarkTheme}><PathFinderCableRoutingPanel {...p} calculationFeedback={{ working: false, message, currentAttempt: false }} /></FluentProvider>);
    expect(screen.getByText('Network ready. Calculate routing to create a current route.')).toBeVisible(); expect(screen.queryByText(message)).toBeNull();
  });
  it.each(['another cable', 'earlier job'])('does not expose a diagnostic from %s', mismatch => {
    const p = props(); p.cable = { ...p.cable!, calculation: { ...p.cable!.calculation,
      jobId: id(71), jobStatus: 'failed', itemState: 'blocked', outcome: 'failed' } };
    p.calculationDiagnostics = { cableId: mismatch === 'another cable' ? id(44) : id(3), jobId: mismatch === 'earlier job' ? id(70) : id(71),
      jobStatus: 'failed', itemStatus: 'failed', itemState: 'blocked', itemMessage: 'Unrelated failure.', jobFailure: null, readError: null };
    render(<FluentProvider theme={webDarkTheme}><PathFinderCableRoutingPanel {...p} /></FluentProvider>);
    expect(screen.queryByText(/Unrelated failure/)).toBeNull();
    expect(screen.getByRole('button', { name: /^Show$/ })).toBeDisabled();
  });
});

describe('showing the popup From/To locations without changing them', () => {
  it('places Show location beside each Assign button and shows each saved object independently', async () => {
    assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed');
    const show = vi.fn(async () => true), p = props(); render(<PathFinderCableRoutingPanel {...p} onShowLocation={show} />);
    for (const [side, objectId] of [['From', 123], ['To', 124]] as const) {
      const button = screen.getByRole('button', { name: `Show ${side} location` });
      expect(button.parentElement).toBe(screen.getByRole('button', { name: `Assign ${side}` }).parentElement);
      await act(async () => { fireEvent.click(button); }); expect(show).toHaveBeenLastCalledWith(objectId);
    }
    expect(assignment.from.selectObject).not.toHaveBeenCalled(); expect(assignment.to.selectObject).not.toHaveBeenCalled();
    expect(assignment.save).not.toHaveBeenCalled(); expect(p.onCalculate).not.toHaveBeenCalled(); expect(p.onTogglePath).not.toHaveBeenCalled();
  });
  it.each(['object-derived', 'fixed-world'] as const)('shows an unsaved %s assignment ahead of the previous saved object', async mode => {
    assignment.from.context = context('from', 'confirmed'); assignment.from.draftSource = 'selected';
    assignment.from.draft = mode === 'object-derived'
      ? { mode, sdkObjectId: 55, point: [7, 8, 9], object: context('from', 'confirmed').confirmedSelection!.object }
      : { mode, displaySdkObjectId: 55, point: [7, 8, 9], derivation: 'picked-surface-point' };
    assignment.from.displaySelection = { sdkObjectId: 55, name: 'New selected object', point: [7, 8, 9] };
    const show = vi.fn(async () => true); render(<PathFinderCableRoutingPanel {...props()} onShowLocation={show} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show From location' })); });
    expect(show).toHaveBeenCalledExactlyOnceWith(55); expect(assignment.save).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: 'From assigned model object' }) as HTMLTextAreaElement).value).toContain('New selected object');
  });
  it('can show an automatic candidate and a confirmed display-only fixed-world object', async () => {
    assignment.from.context = context('from');
    const saved = context('to', 'confirmed');
    assignment.to.context = { ...saved, confirmedSelection: null, confirmedDisplaySelection: { source: 'confirmed-display-only', mode: 'fixed-world',
      sdkObjectId: 444, pointProjectMetres: [2, 2, 3], current: saved.current!, bindingId: saved.head!.id,
      bindingContentSha256: saved.head!.contentSha256, commandSha256: 'e'.repeat(64) } };
    const show = vi.fn(async () => true); render(<PathFinderCableRoutingPanel {...props()} onShowLocation={show} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show From location' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show To location' })); });
    expect(show.mock.calls).toEqual([[123], [444]]);
  });
  it('does not substitute an older object for a manually entered point', () => {
    assignment.from.context = context('from', 'confirmed'); assignment.from.draftSource = 'selected';
    assignment.from.draft = { mode: 'fixed-world', point: [7, 8, 9], derivation: 'manual-world-point', displaySdkObjectId: null };
    render(<PathFinderCableRoutingPanel {...props()} onShowLocation={vi.fn(async () => true)} />);
    expect(screen.getByRole('button', { name: 'Show From location' })).toBeDisabled();
    expect(screen.getByText('This location has no current model object to show. Assign an object or refresh From/To.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show To location' })).toBeDisabled();
  });
  it('never uses retained labels or a different model revision to show a location', () => {
    assignment.from.context = context('from', 'confirmed'); const p = props(), show = vi.fn(async () => true);
    const view = render(<PathFinderCableRoutingPanel {...p} onShowLocation={show} />);
    expect(screen.getByRole('button', { name: 'Show From location' })).toBeEnabled();
    assignment.from.context = null; view.rerender(<PathFinderCableRoutingPanel {...p} onShowLocation={show} />);
    expect(screen.getByRole('button', { name: 'Show From location' })).toBeDisabled();
    assignment.from.context = context('from', 'confirmed'); assignment.from.context.current!.selectionRevision = '99';
    view.rerender(<PathFinderCableRoutingPanel {...p} onShowLocation={show} />);
    expect(screen.getByRole('button', { name: 'Show From location' })).toBeDisabled(); expect(show).not.toHaveBeenCalled();
  });
  it('reports a display failure, allows retry, and drops late feedback after switching cables', async () => {
    assignment.from.context = context('from', 'confirmed'); let finish!: (value: boolean) => void;
    const show = vi.fn<NonNullable<PathFinderCableRoutingPanelProps['onShowLocation']>>().mockResolvedValueOnce(false)
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const p = props(), view = render(<PathFinderCableRoutingPanel {...p} onShowLocation={show} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show From location' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('This location could not be shown.');
    fireEvent.click(screen.getByRole('button', { name: 'Show From location' }));
    expect(screen.getByRole('button', { name: 'Show From location' })).toBeDisabled();
    view.rerender(<PathFinderCableRoutingPanel {...p} cable={{ ...p.cable!, cable: { ...p.cable!.cable, id: id(99) } }} onShowLocation={show} />);
    await act(async () => { finish(false); }); expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('persistent nonmodal cable routing panel with atomic drafts', () => {
  it('requires no Review or Apply when exact current cable values are already confirmed', () => {
    const p=props(); p.cable!.cable.routing='/SAVED'; p.cable!.cable.designLength='58';
    p.cable!.calculation.acceptedMatchesCurrent=true; p.cable!.calculation.currentness='current';
    render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByText('Routing and length saved')).toBeVisible();
    expect(screen.queryByRole('button',{name:'Review proposed routing'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Apply reviewed routing'})).toBeNull();
  });
  it('shows automatic pair write progress without offering Review or Apply during that write', () => {
    const p=props(); p.cable!.calculation.automaticUpdate={status:'running',receiptId:null,reasonCode:null};
    render(<PathFinderCableRoutingPanel {...p} calculationPending />);
    expect(screen.getByText('Updating cable values')).toBeVisible();
    expect(screen.queryByRole('button',{name:'Review proposed routing'})).toBeNull();
    expect(screen.getByText(/Waiting for the automatic Routing and Design length update/)).toBeVisible();
  });
  it('makes exhausted automatic write recovery explicit without permitting another write',()=>{
    const p=props();p.cable!.calculation.automaticUpdate={status:'unknown',receiptId:null,reasonCode:'AUTOMATIC_PAIR_RECOVERY_LIMIT'};
    render(<PathFinderCableRoutingPanel {...p} calculationPending />);
    expect(screen.getByText('Cable update needs confirmation')).toBeVisible();
    expect(screen.getByText(/Use Refresh cable status to check the exact saved receipt/)).toBeVisible();
    expect(screen.queryByRole('button',{name:'Apply reviewed routing'})).toBeNull();
  });
  it.each(['refused', 'stale', 'authority-expired'] as const)('shows the actual %s output refusal without inventing a manual edit', status => {
    const p = props(); p.cable!.calculation.automaticUpdate = { status, receiptId: null, reasonCode: 'PROPOSAL_NOT_APPLICABLE' };
    render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByText('Cable list update not saved')).toBeVisible();
    expect(screen.getByText(/automatic Routing and Design length update was not saved/)).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Update reason: proposal not applicable.');
    expect(screen.queryByText(/Manually changed Cable list values are retained/)).not.toBeInTheDocument();
    expect(p.onCalculate).not.toHaveBeenCalled(); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('retains last read endpoint display after failed refresh and offers GET-only refresh while commands are pending', () => {
    assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed');
    const p = props(), refresh = vi.fn(), review = { ...reviewController(p), canApply: true }, view = render(<PathFinderCableRoutingPanel {...p} onRefresh={refresh} review={review} />);
    assignment.from.context = null; assignment.to.context = null; assignment.retired = true; assignment.error = 'Endpoint GET failed.';
    assignment.pending = { cableId: id(3) } as Assignment['pending'];
    view.rerender(<PathFinderCableRoutingPanel {...p} onRefresh={refresh} review={review} calculationPending actionsBusy />);
    expect(screen.getByRole('textbox', { name: 'From assigned model object' })).toHaveValue('Panel object 001\nX: 1 m; Y: 2 m; Z: 3 m');
    expect(screen.getByRole('textbox', { name: 'To assigned model object' })).toHaveValue('Motor object 002\nX: 2 m; Y: 2 m; Z: 3 m');
    expect(screen.getAllByText('Last read location — refresh From/To before using it.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Refresh cable status' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Refresh From/To' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh cable status' })); fireEvent.click(screen.getByRole('button', { name: 'Refresh From/To' }));
    expect(refresh).toHaveBeenCalledTimes(2); expect(assignment.refresh).toHaveBeenCalledOnce(); expect(assignment.retry).not.toHaveBeenCalled(); expect(assignment.save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Review proposed routing' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply reviewed routing' })).toBeDisabled();
    assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed'); assignment.retired = false; assignment.error = null; assignment.pending = null;
    view.rerender(<PathFinderCableRoutingPanel {...p} onRefresh={refresh} review={review} />);
    expect(screen.queryByText('Last read location — refresh From/To before using it.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Review proposed routing' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Apply reviewed routing' })).toBeEnabled();
    expect(p.onCalculate).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled();
  });
  it.each(['preparation', 'model', 'cable', 'location', 'denied'] as const)('does not carry retained endpoint display across changed %s ownership', kind => {
    assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed');
    const p = props(), view = render(<PathFinderCableRoutingPanel {...p} />);
    assignment.from.context = null; assignment.to.context = null; assignment.retired = true; assignment.error = 'Read unavailable.';
    const next = kind === 'preparation' ? { ...p, access: { ...p.access, preparationKey: 'new-preparation' } }
      : kind === 'model' ? { ...p, access: { ...p.access, model: { ...p.access.model!, selectionRevision: '2' } } }
        : kind === 'cable' ? { ...p, cable: { ...p.cable!, cable: { ...p.cable!.cable, id: id(99) } } }
          : kind === 'location' ? { ...p, cable: { ...p.cable!, cable: { ...p.cable!.cable, fromLocation: 'Changed location' } } } : p;
    if (kind === 'denied') assignment.enabled = false;
    view.rerender(<PathFinderCableRoutingPanel {...next} />);
    expect((screen.getByRole('textbox', { name: 'From assigned model object' }) as HTMLTextAreaElement).value).not.toContain('Panel object 001');
    expect((screen.getByRole('textbox', { name: 'To assigned model object' }) as HTMLTextAreaElement).value).not.toContain('Motor object 002');
    expect(assignment.save).not.toHaveBeenCalled(); expect(p.onCalculate).not.toHaveBeenCalled();
  });
  it('keeps display-only locations after a same-name cable revision advances and its endpoint read fails', () => {
    assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed');
    const p = props(), review = { ...reviewController(p), canApply: true }, view = render(<PathFinderCableRoutingPanel {...p} review={review} />);
    assignment.from.context = null; assignment.to.context = null; assignment.retired = true; assignment.error = 'Endpoint GET failed.';
    const revised = { ...p.cable!, cable: { ...p.cable!.cable, cableWriteRevision: '5', routing: '/NEW', designLength: '30' } };
    view.rerender(<PathFinderCableRoutingPanel {...p} cable={revised} review={review} />);
    expect(screen.getByRole('textbox', { name: 'From assigned model object' })).toHaveValue('Panel object 001\nX: 1 m; Y: 2 m; Z: 3 m');
    expect(screen.getByRole('textbox', { name: 'To assigned model object' })).toHaveValue('Motor object 002\nX: 2 m; Y: 2 m; Z: 3 m');
    expect(screen.getAllByText('Last read location — refresh From/To before using it.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Review proposed routing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply reviewed routing' })).toBeDisabled(); expect(assignment.save).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled();
  });
  it('offers a default-off next-calculation drilling choice without changing endpoint Save or recorded proposal controls', () => {
    const p = props(), change = vi.fn(), review = { ...reviewController(p), recordedDrillThroughWalls: true },
      view = render(<PathFinderCableRoutingPanel {...p} review={review} submittedDrillThroughWalls onDrillThroughWallsChange={change} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Drill through the walls' }); expect(checkbox).not.toBeChecked(); fireEvent.click(checkbox);
    expect(screen.getByText(/Submitted calculation: Drill through the walls enabled/)).toBeVisible();
    expect(screen.getByText(/Recorded result: Drill through the walls enabled/)).toBeVisible();
    expect(change).toHaveBeenCalledWith(true); expect(assignment.save).not.toHaveBeenCalled(); expect(p.onCalculate).not.toHaveBeenCalled();
    view.rerender(<PathFinderCableRoutingPanel {...p} review={review} drillThroughWalls onDrillThroughWallsChange={change} />);
    expect(checkbox).toBeChecked(); expect(vi.mocked(useCableEndpointPairSelection).mock.calls.at(-1)?.[0].calculation).toEqual(p.access.calculation);
    view.rerender(<PathFinderCableRoutingPanel {...p} review={review} drillThroughWalls onDrillThroughWallsChange={change} calculationPending
      calculationFeedback={{ message: 'The calculation submission is unconfirmed. Refresh this cable.', working: false }} />);
    expect(checkbox).toBeDisabled(); expect(screen.getByText(/submission is unconfirmed/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeDisabled(); expect(review.review).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled();
  });
  it('keeps Calculate actionable for configuration while preserving endpoint Save and approval guards', () => {
    const p = props(), configure = vi.fn(), calculate = vi.fn(() => configure());
    p.access = { ...p.access, calculation: null, initialFill: null };
    p.cable!.cable.routing = '/STORED'; p.cable!.cable.designLength = '30';
    p.cable!.calculation.reasonCodes = ['BARRIER_WRITE_PROOF_REQUIRED'];
    const review = { ...reviewController(p), canReview: false, canApply: false };
    render(<PathFinderCableRoutingPanel {...p} review={review} onCalculate={calculate} onConfigureCalculation={configure}
      calculationBlockedReason="Save From/To now. Configure the current barriers before calculating." />);
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
  it('reviews the exact recorded bypass while next-drill OFF requires configuration for a new calculation', () => {
    const p = props(); p.access = { ...p.access, calculation: null, initialFill: null };
    const changeDrilling = vi.fn();
    const review = { ...reviewController(p), recordedDrillThroughWalls: true };
    const view = render(<PathFinderCableRoutingPanel {...p} review={review} drillThroughWalls={false} onDrillThroughWallsChange={changeDrilling}
      calculationBlockedReason="Configure barriers before calculating with drilling disabled." />);
    expect(screen.getByRole('checkbox', { name: 'Drill through the walls' })).not.toBeChecked();
    expect(screen.getByText(/Recorded result: Drill through the walls enabled/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Review proposed routing' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Review proposed routing' })); expect(review.review).toHaveBeenCalledOnce();
    view.rerender(<PathFinderCableRoutingPanel {...p} review={{ ...review, reviewed: true, canReview: false, canApply: true }} drillThroughWalls={false} onDrillThroughWallsChange={changeDrilling}
      calculationBlockedReason="Configure barriers before calculating with drilling disabled." />);
    expect(screen.getByRole('button', { name: 'Apply reviewed routing' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed routing' })); expect(review.apply).toHaveBeenCalledOnce();
    expect(changeDrilling).not.toHaveBeenCalled();
    expect(p.onCalculate).not.toHaveBeenCalled(); expect(assignment.save).not.toHaveBeenCalled();
    expect(vi.mocked(useCableEndpointPairSelection).mock.calls.at(-1)?.[0]).toMatchObject({ calculation: null, initialFill: null });
  });
  it.each(['dirty-barriers', 'pending-barriers', 'stale-result'] as const)('keeps the Results owner %s refusal without deriving approval from the drill draft', reason => {
    const p = props(), review = { ...reviewController(p), canReview: false, canApply: false, message: reason, recordedDrillThroughWalls: true };
    render(<PathFinderCableRoutingPanel {...p} review={review} drillThroughWalls calculationBlockedReason="Current route configuration is unavailable." />);
    expect(screen.getByRole('button', { name: 'Review proposed routing' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply reviewed routing' })).toBeDisabled();
    expect(review.review).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled();
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
  it('saves a changed From with its saved To before offering configuration-directed Calculate', async () => {
    const p = props(), configure = vi.fn(); p.access = { ...p.access, calculation: null, initialFill: null };
    p.cable!.cable.routing = '/STORED'; p.cable!.cable.designLength = '30'; p.onCalculate = configure;
    assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed');
    assignment.from.draft = { mode: 'fixed-world', point: [7, 8, 9], derivation: 'manual-world-point', displaySdkObjectId: 55 };
    assignment.from.effectiveDraft = assignment.from.draft; assignment.from.draftSource = 'selected';
    assignment.from.displaySelection = { sdkObjectId: 55, name: 'Selected From equipment', point: [7, 8, 9] }; assignment.canSave = true;
    // Changing a saved endpoint makes the old proposal unreviewable at the
    // Results owner; next-calculation settings are a separate concern.
    const review = { ...reviewController(p), canReview: false, canApply: false }, view = render(<PathFinderCableRoutingPanel {...p} review={review} calculationBlockedReason="Configure the current barriers." />);
    expect(screen.getByText(/Save the assigned From\/To locations now/)).toBeVisible(); expect(screen.queryByText(/Configure routing before saving/)).toBeNull();
    expect(screen.getByText(/It does not calculate routing or update Cable list values/)).toBeVisible(); expect(screen.queryByText(/Save recalculates affected cables/)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'From assigned model object' })).toHaveValue('Selected From equipment\nX: 7 m; Y: 8 m; Z: 9 m');
    expect(screen.getByText('Selected — not saved.')).toBeVisible(); expect(screen.getAllByText('Saved shared location.')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeDisabled();
    expect(useCableEndpointPairSelection).toHaveBeenLastCalledWith(expect.objectContaining({ calculation: null, initialFill: null }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(assignment.save).toHaveBeenCalledExactlyOnceWith('Confirm cable From/To model assignments.'); expect(configure).not.toHaveBeenCalled();
    const savedFrom = context('from', 'confirmed'), savedHead = { ...savedFrom.head!, mode: 'fixed-world' as const, derivation: 'manual-world-point' as const,
      sourceObject: null, attachment: null, pointProjectMetres: [7, 8, 9] as [number, number, number] };
    assignment.from.context = cableEndpointContextSchema.parse({ ...savedFrom, head: savedHead, confirmedSelection: null, confirmedDisplaySelection: {
      source: 'confirmed-display-only', mode: 'fixed-world', sdkObjectId: 55, name: 'Selected From equipment', pointProjectMetres: savedHead.pointProjectMetres,
      current: savedFrom.current!, bindingId: savedHead.id, bindingContentSha256: savedHead.contentSha256, commandSha256: 'e'.repeat(64),
    } });
    assignment.from.draft = null; assignment.from.effectiveDraft = null; assignment.from.draftSource = null; assignment.canSave = false;
    view.rerender(<PathFinderCableRoutingPanel {...p} review={review} calculationBlockedReason="Configure the current barriers." />);
    expect(screen.getByRole('textbox', { name: 'From assigned model object' })).toHaveValue('Selected From equipment\nX: 7 m; Y: 8 m; Z: 9 m');
    expect(screen.getAllByText('Saved shared location.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate routing' })); expect(configure).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Review proposed routing' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Apply reviewed routing' })).toBeDisabled();
    expect(p.cable!.cable).toMatchObject({ routing: '/STORED', designLength: '30' }); expect(review.review).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled();
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
    const p = { ...props(), pathReady: true }; p.cable = cableWorkflowRowSchema.parse({ ...p.cable, calculation: { ...p.cable!.calculation,
      jobId: id(81), jobStatus: 'complete', itemState: 'complete', outcome: 'calculated', currentness: 'current', proposalId: id(80), proposalHash: 'f'.repeat(64) } });
    const view = render(<PathFinderCableRoutingPanel {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Show' })); expect(p.onTogglePath).toHaveBeenCalledOnce();
    assignment.from.context = context('from'); view.rerender(<PathFinderCableRoutingPanel {...p} />); expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled();
    view.rerender(<PathFinderCableRoutingPanel {...p} pathVisible />); expect(screen.getByRole('button', { name: 'Hide' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' })); expect(p.onTogglePath).toHaveBeenCalledTimes(2); expect(assignment.save).not.toHaveBeenCalled();
  });
  it.each(['pending', 'refreshing', 'read failed', 'endpoint retired', 'result not ready'] as const)('keeps Show unavailable while %s and never draws the old route', state => {
    const p = props(); assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed');
    if (state === 'endpoint retired') assignment.retired = true;
    render(<PathFinderCableRoutingPanel {...p} pathReady={state !== 'result not ready'} calculationPending={state === 'pending'}
      refreshing={state === 'refreshing'} refreshError={state === 'read failed' ? 'GET unavailable' : null} />);
    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show' })); expect(p.onTogglePath).not.toHaveBeenCalled();
  });
  it('refreshes From/To once after a replacement result and waits for an existing draft before doing so', () => {
    const p = props(), view = render(<PathFinderCableRoutingPanel {...p} endpointRefreshKey={0} />);
    expect(assignment.refresh).not.toHaveBeenCalled();
    assignment.from.context = context('from'); view.rerender(<PathFinderCableRoutingPanel {...p} endpointRefreshKey={1} />);
    expect(assignment.refresh).not.toHaveBeenCalled();
    assignment.from.context = context('from', 'confirmed'); view.rerender(<PathFinderCableRoutingPanel {...p} endpointRefreshKey={1} />);
    expect(assignment.refresh).toHaveBeenCalledOnce();
    view.rerender(<PathFinderCableRoutingPanel {...p} endpointRefreshKey={1} />); expect(assignment.refresh).toHaveBeenCalledOnce();
    expect(assignment.save).not.toHaveBeenCalled(); expect(p.onCalculate).not.toHaveBeenCalled();
  });
  it('refreshes converged Save contexts once when the selected automatic cable write advances its revision while siblings run', () => {
    assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed');
    const p = props(); p.cable!.cable.cableWriteRevision = '5';
    p.cable!.calculation = { ...p.cable!.calculation, jobStatus: 'running', itemState: 'complete', currentness: 'current', outcome: 'calculated' };
    const view = render(<PathFinderCableRoutingPanel {...p} pathReady />);
    expect(assignment.refresh).toHaveBeenCalledOnce();
    assignment.from.context = { ...assignment.from.context!, cableWriteRevision: '5' };
    assignment.to.context = { ...assignment.to.context!, cableWriteRevision: '5' };
    view.rerender(<PathFinderCableRoutingPanel {...p} pathReady />);
    expect(assignment.refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Assign From' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Assign To' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Show' })).toBeEnabled();
    expect(assignment.save).not.toHaveBeenCalled(); expect(p.onCalculate).not.toHaveBeenCalled();
  });
  it('does not replace newer endpoint contexts with an older cable list observation', () => {
    assignment.from.context = { ...context('from', 'confirmed'), cableWriteRevision: '6' };
    assignment.to.context = { ...context('to', 'confirmed'), cableWriteRevision: '6' };
    const p = props(); p.cable!.cable.cableWriteRevision = '5';
    render(<PathFinderCableRoutingPanel {...p} pathReady />);
    expect(assignment.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Assign From' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Show' })).toBeEnabled();
  });
  it('defers selected-revision convergence while a Save command is unconfirmed', () => {
    assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed');
    assignment.pending = { cableId: id(3) } as Assignment['pending'];
    const p = props(); p.cable!.cable.cableWriteRevision = '5';
    const view = render(<PathFinderCableRoutingPanel {...p} />);
    expect(assignment.refresh).not.toHaveBeenCalled(); expect(assignment.save).not.toHaveBeenCalled();
    assignment.pending = null; view.rerender(<PathFinderCableRoutingPanel {...p} />);
    expect(assignment.refresh).toHaveBeenCalledOnce();
    expect(assignment.retry).not.toHaveBeenCalled(); expect(assignment.closePending).not.toHaveBeenCalled();
  });
  it('loads stored routing and length on first open without submitting a calculation or granting Show or review', () => {
    const p = props(); p.cable!.cable.routing = '/STORED/CABLE/LIST'; p.cable!.cable.designLength = '153';
    render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByRole('heading', { name: 'Cable list routing' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Cable routing' })).toHaveValue('/STORED/CABLE/LIST');
    expect(screen.getByText('Cable list design length: 153 m')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review proposed routing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply reviewed routing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeEnabled();
    expect(p.onCalculate).not.toHaveBeenCalled(); expect(p.onTogglePath).not.toHaveBeenCalled(); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('retains the saved route after obstacle changes with an actionable Show message instead of an indefinite loading claim', () => {
    const p = props(); p.cable!.cable.routing = '/SAVED'; p.cable!.cable.designLength = '58';
    p.cable!.calculation.outcome = 'calculated'; p.cable!.calculation.currentness = 'changed';
    render(<PathFinderCableRoutingPanel {...p} />);
    expect(screen.getByRole('textbox', { name: 'Cable routing' })).toHaveValue('/SAVED');
    expect(screen.getByText('Show needs a current path for the active model, locations and obstacles. Calculate routing to update it.')).toBeVisible();
    expect(screen.queryByText(/not finished verification/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled(); expect(p.onCalculate).not.toHaveBeenCalled();
  });
  it('shows the separately qualified saved exact path without granting Review or Apply', () => {
    const p = props(); p.cable!.cable.routing = '/SAVED'; p.cable!.cable.designLength = '58';
    p.cable!.calculation.currentness = 'changed'; const review = reviewController(p); review.canApply = true;
    render(<PathFinderCableRoutingPanel {...p} pathSource="saved-exact" pathReady calculatedRouting="/SAVED" calculatedDesignLength="58" review={review} />);
    expect(screen.getByRole('heading', { name: 'Cable list routing' })).toBeVisible();
    expect(screen.getByText('Cable list design length: 58 m')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Review proposed routing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply reviewed routing' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show' })); expect(p.onTogglePath).toHaveBeenCalledOnce();
    expect(p.onCalculate).not.toHaveBeenCalled(); expect(assignment.save).not.toHaveBeenCalled(); expect(review.review).not.toHaveBeenCalled(); expect(review.apply).not.toHaveBeenCalled();
  });
  it.each(['save', 'legacy', 'review'] as const)('blocks a retained saved exact Show during pending %s while permitting Hide', kind => {
    const p = props(), review = reviewController(p);
    if (kind === 'save') assignment.pending = { cableId: id(3) } as Assignment['pending'];
    if (kind === 'legacy') assignment.legacyRecovery = { canRetry: false, retry: vi.fn(), close: vi.fn() } as unknown as Assignment['legacyRecovery'];
    if (kind === 'review') review.pending = true;
    const view = render(<PathFinderCableRoutingPanel {...p} pathSource="saved-exact" pathReady calculatedRouting="/SAVED" calculatedDesignLength="58" review={review} />);
    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled();
    view.rerender(<PathFinderCableRoutingPanel {...p} pathSource="saved-exact" pathReady pathVisible calculatedRouting="/SAVED" calculatedDesignLength="58" review={review} />);
    expect(screen.getByRole('button', { name: 'Hide' })).toBeEnabled(); expect(p.onCalculate).not.toHaveBeenCalled(); expect(assignment.save).not.toHaveBeenCalled();
  });
  it('labels retained Cable list text as previous while a new result is pending or unconfirmed', () => {
    const p = props(); p.cable!.cable.routing = '/SAVED'; p.cable!.cable.designLength = '58';
    const view = render(<PathFinderCableRoutingPanel {...p} calculationPending />);
    expect(screen.getByRole('heading', { name: 'Previous Cable list routing' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Cable routing' })).toHaveValue('/SAVED');
    expect(screen.getByText('Previous Cable list design length: 58 m')).toBeVisible();
    expect(screen.getByText(/The new calculated route will appear here/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled();
    view.rerender(<PathFinderCableRoutingPanel {...p} calculationFeedback={{ working: false, message: 'The new calculation could not be checked.' }} />);
    expect(screen.getByRole('heading', { name: 'Previous Cable list routing' })).toBeVisible();
    expect(screen.getByText('Previously saved route. Refresh cable status or calculate routing to check the current result.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled(); expect(p.onCalculate).not.toHaveBeenCalled();
  });
  it('shows new proposal text before Show is ready without changing manual Cable list values or blocking Assign and Calculate', () => {
    const p = props(); p.cable!.cable.routing = '/OLD/SECONDARY'; p.cable!.cable.designLength = '150';
    assignment.from.context = context('from', 'confirmed'); assignment.to.context = context('to', 'confirmed');
    const view = render(<PathFinderCableRoutingPanel {...p} />); expect(screen.getByRole('heading', { name: 'Cable list routing' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Cable routing' })).toHaveValue('/OLD/SECONDARY');
    expect(within(screen.getByRole('region', { name: 'Stored cable values' })).getByText('/OLD/SECONDARY')).toBeVisible();
    view.rerender(<PathFinderCableRoutingPanel {...p} calculatedRouting="/NEW/SECONDARY" calculatedDesignLength="180" />);
    expect(screen.getByRole('heading', { name: 'Calculated routing' })).toBeVisible(); expect(screen.getByRole('textbox', { name: 'Cable routing' })).toHaveValue('/NEW/SECONDARY');
    expect(screen.getByText('Calculated design length: 180 m')).toBeVisible(); expect(p.cable!.cable.designLength).toBe('150');
    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Assign From' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Assign To' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Calculate routing' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show' })); expect(p.onTogglePath).not.toHaveBeenCalled();
    view.rerender(<PathFinderCableRoutingPanel {...p} calculatedRouting="/NEW/SECONDARY" calculatedDesignLength="180" pathReady />);
    expect(screen.getByRole('button', { name: 'Show' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show' })); expect(p.onTogglePath).toHaveBeenCalledOnce();
    view.rerender(<PathFinderCableRoutingPanel {...p} calculatedRouting={null} calculatedDesignLength={null} />);
    expect(screen.getByRole('textbox', { name: 'Cable routing' })).toHaveValue('/OLD/SECONDARY');
    expect(screen.getByRole('heading', { name: 'Previous Cable list routing' })).toBeVisible();
    expect(screen.getByText('Previous Cable list design length: 150 m')).toBeVisible();
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull(); expect(assignment.save).not.toHaveBeenCalled(); expect(p.onCalculate).not.toHaveBeenCalled();
    expect(p.cable!.cable).toMatchObject({ routing: '/OLD/SECONDARY', designLength: '150' });
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
  it('shows the assigned location from the separate window', async () => {
    const p = props(), frame = document.createElement('iframe'); document.body.appendChild(frame); const popup = frame.contentWindow!;
    Object.defineProperty(popup, 'closed', { configurable: true, value: false }); popup.focus = vi.fn(); popup.close = vi.fn();
    assignment.from.context = context('from', 'confirmed'); const show = vi.fn(async () => true);
    const view = render(<FluentProvider theme={webDarkTheme}><PathFinderCableRoutingPanel {...p} onShowLocation={show}
      requestedPopup={{ window: popup, blocked: false, id: 'show-location-window' }} /></FluentProvider>);
    await act(async () => { fireEvent.click(within(popup.document.body).getByRole('button', { name: 'Show From location' })); });
    expect(show).toHaveBeenCalledExactlyOnceWith(123); expect(assignment.from.selectObject).not.toHaveBeenCalled();
    expect(assignment.save).not.toHaveBeenCalled(); expect(p.onCalculate).not.toHaveBeenCalled(); expect(p.onTogglePath).not.toHaveBeenCalled();
    view.unmount(); frame.remove();
  });
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
