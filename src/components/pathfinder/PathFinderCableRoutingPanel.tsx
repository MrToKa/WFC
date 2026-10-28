import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingCablePanel, type FloatingCableWindowRequest } from '@/hooks/useFloatingCablePanel';
import { Button, Caption1, Checkbox, Portal, Spinner } from '@fluentui/react-components';
import { useCableEndpointPairSelection, type CableEndpointPairSelectionAccess } from '@/hooks/useCableEndpointPairSelection';
import type { CableWorkflowRow } from '../../../shared/pathfinderCableWorkflow';
import { CablePopupSurface, type CablePopupSurfaceStyles } from '@/components/CablePopupSurface';
import type { PathFinderWorkflowDisplay, PathFinderWorkflowReview } from '@/pages/ProjectDetails/PathFinderResults';
import { PathFinderCableComparison } from './PathFinderCableComparison';
import { CableAutoCalculatedLength } from './CableAutoCalculatedLength';
import type { PathFinderEndpointForegroundContexts } from '@/pages/ProjectDetails/pathFinderEndpointVisibility';

export type PathFinderCalculationDiagnostics = {
  cableId: string; jobId: string; jobStatus: string | null;
  itemStatus: string | null; itemState: string | null; itemMessage: string | null;
  jobFailure: string | null; readError: string | null;
};
export type PathFinderCableRoutingPanelProps = {
  access: Omit<CableEndpointPairSelectionAccess, 'cableId'>;
  requestedPopup?: FloatingCableWindowRequest | null;
  cable: CableWorkflowRow | null; open: boolean; onClose: () => void; anchor?: HTMLElement | null;
  onCalculate?: () => void | Promise<void>; onTogglePath?: () => void;
  onShowLocation?: (sdkObjectId: number) => Promise<boolean>;
  onEndpointForegroundContexts?: (value: PathFinderEndpointForegroundContexts | null) => void;
  pathVisible?: boolean; pathReady?: boolean; endpointRefreshKey?: number; actionsBusy?: boolean; calculatedRouting?: string | null; calculatedDesignLength?: string | null;
  pathSource?: PathFinderWorkflowDisplay['source'];
  review?: PathFinderWorkflowReview | null; calculationPending?: boolean;
  calculationBlockedReason?: string | null; onConfigureCalculation?: () => void;
  drillThroughWalls?: boolean; onDrillThroughWallsChange?: (checked: boolean) => void;
  submittedDrillThroughWalls?: boolean | null;
  calculationFeedback?: { message: string; working: boolean; currentAttempt?: boolean } | null;
  calculationDiagnostics?: PathFinderCalculationDiagnostics | null;
  onRefresh?: () => void | Promise<void>; refreshing?: boolean; refreshError?: string | null;
};
type Endpoint = ReturnType<typeof useCableEndpointPairSelection>['from'];
/** Display uses live model identities only; retained labels never target a new model. */
function locationObjectId(state: Endpoint, model: PathFinderCableRoutingPanelProps['access']['model']): number | null {
  const current = state.context?.current;
  if (!state.enabled || !model || !current || current.modelVersionId !== model.modelVersionId
    || current.selectionRevision !== model.selectionRevision || current.contentFingerprint !== model.contentFingerprint) return null;
  const id = state.draft ? state.draft.mode === 'object-derived' ? state.draft.sdkObjectId : state.draft.displaySdkObjectId
    : state.context?.automaticSelection?.sdkObjectId ?? state.context?.confirmedSelection?.sdkObjectId ?? state.context?.confirmedDisplaySelection?.sdkObjectId;
  return Number.isSafeInteger(id) && Number(id) > 0 && Number(id) <= 2147483647 ? Number(id) : null;
}
/** Persistent nonmodal portal; only its own bounds intercept pointer input. */
export function PathFinderCableRoutingPanel(props: PathFinderCableRoutingPanelProps) {
  const { access, cable } = props;
  if (!access.isAdmin || !access.accountId || !access.token || !access.projectId || access.projectId !== access.loadedProjectId
    || !cable || cable.projectId !== access.projectId || !['LV', 'Control', 'Instrumentation'].includes(cable.mto ?? '')) return null;
  const owner = JSON.stringify([access.accountId, access.projectId, access.token, access.model]);
  return <FloatingRoutingPanel key={owner} {...props} cable={cable} owner={owner} />;
}
function FloatingRoutingPanel(props: PathFinderCableRoutingPanelProps & { cable: CableWorkflowRow; owner: string }) {
  const floating = useFloatingCablePanel({ open: props.open && props.access.active, title: props.cable.cable.tag || 'Cable routing',
    scopeKey: props.owner, width: 416, preferredTop: 80, requestedPopup: props.requestedPopup });
  return <OwnedCableRoutingPanel key={props.cable.cable.id} {...props} floating={floating} />;
}
function OwnedCableRoutingPanel({ access, cable, open, onClose, anchor, onCalculate, onTogglePath, onShowLocation, pathVisible = false,
  pathReady = false, pathSource = null, endpointRefreshKey = 0, actionsBusy = false, calculatedRouting, calculatedDesignLength, review, calculationPending = false, calculationBlockedReason = null,
  onConfigureCalculation, drillThroughWalls = false, onDrillThroughWallsChange, submittedDrillThroughWalls, calculationFeedback, calculationDiagnostics,
  onRefresh, refreshing = false, refreshError = null, onEndpointForegroundContexts,
  floating }: PathFinderCableRoutingPanelProps & { cable: CableWorkflowRow; floating: ReturnType<typeof useFloatingCablePanel> }) {
  const title = useId(), panel = floating.panelRef;
  const [collapsed, setCollapsed] = useState(false), previousOpen = useRef(false), focusReturn = useRef<HTMLElement | null>(null);
  const active = access.active && open && !collapsed;
  const assignment = useCableEndpointPairSelection({ ...access, cableId: cable.cable.id, active });
  const previousEndpointRefresh = useRef(endpointRefreshKey);
  const previousEndpointRevisionRead = useRef<string | null>(null);
  const { from, to, pending, legacyRecovery } = assignment, busy = assignment.busy || actionsBusy;
  // Retained contexts are presentation only. The pair hook remains the sole
  // source of live Save/selection authority after a failed or retired read.
  // A cable-value write can advance its revision without moving either logical
  // endpoint. Keep that old display; it never supplies Save or review authority.
  const displayScope = JSON.stringify([access.accountId, access.projectId, access.token, access.model, access.preparationKey,
    cable.cable.id, cable.cable.fromLocation, cable.cable.toLocation]);
  const [locationDisplay, setLocationDisplay] = useState<{ scope: string; end: 'from' | 'to'; working: boolean; error: string | null } | null>(null);
  const locationOwner = useRef({ scope: displayScope, active }); locationOwner.current = { scope: displayScope, active };
  const locationRequest = useRef<symbol | null>(null);
  useEffect(() => { locationRequest.current = null; setLocationDisplay(null); }, [displayScope, active]);
  useEffect(() => () => { locationOwner.current.active = false; locationRequest.current = null; }, []);
  const locationWorking = locationDisplay?.scope === displayScope && locationDisplay.working;
  const showLocation = async (end: 'from' | 'to', sdkObjectId: number) => {
    if (!onShowLocation || locationRequest.current || !locationOwner.current.active || locationOwner.current.scope !== displayScope) return;
    const request = Symbol(); locationRequest.current = request;
    setLocationDisplay({ scope: displayScope, end, working: true, error: null });
    let shown = false;
    try { shown = await onShowLocation(sdkObjectId); } catch { /* Display errors do not change endpoint or calculation state. */ }
    if (locationRequest.current !== request) return;
    locationRequest.current = null;
    if (locationOwner.current.active && locationOwner.current.scope === displayScope) setLocationDisplay({ scope: displayScope, end, working: false,
      error: shown ? null : 'This location could not be shown. Check that the current model is loaded, then try again.' });
  };
  const retained = useRef<{ scope: string; from: Endpoint['context']; to: Endpoint['context'] }>({ scope: displayScope, from: null, to: null });
  if (retained.current.scope !== displayScope || !assignment.enabled) retained.current = { scope: displayScope, from: null, to: null };
  for (const [end, state] of [['from', from], ['to', to]] as const) {
    if (assignment.enabled && state.context) retained.current[end] = structuredClone(state.context);
  }
  const endpointReadUnavailable = Boolean(assignment.retired || assignment.error || from.error || to.error
    || !from.context && retained.current.from || !to.context && retained.current.to);
  const endpointOnlySave = access.calculation === null && access.initialFill === null;
  const unsaved = Boolean(from.draft || to.draft || from.context?.automaticSelection || to.context?.automaticSelection);
  // Share the pair reader's verified live evidence with Show. Retained labels,
  // drafts and mismatched pair revisions never supply foreground identities.
  const start = from.context, end = to.context, model = access.model;
  const foregroundReady = Boolean(active && assignment.enabled && !assignment.retired && !assignment.busy && !assignment.error
    && !pending && !legacyRecovery && !unsaved && from.enabled && to.enabled && !from.busy && !to.busy && !from.error && !to.error
    && start?.canBind && end?.canBind && start.projectId === access.projectId && end.projectId === access.projectId
    && start.cableId === cable.cable.id && end.cableId === cable.cable.id && start.end === 'from' && end.end === 'to'
    && start.cableWriteRevision === end.cableWriteRevision && start.registryRevision === end.registryRevision
    && start.current && end.current && JSON.stringify(start.current) === JSON.stringify(end.current)
    && model && start.current.modelVersionId === model.modelVersionId && start.current.selectionRevision === model.selectionRevision
    && start.current.contentFingerprint === model.contentFingerprint && access.accountId && access.projectId && access.token);
  const foregroundKey = foregroundReady ? JSON.stringify([displayScope, start!.contextSha256, end!.contextSha256]) : null;
  const foregroundLatest = useRef<PathFinderEndpointForegroundContexts | null>(null);
  foregroundLatest.current = foregroundReady ? { projectId: access.projectId!, accountId: access.accountId!, token: access.token!,
    cableId: cable.cable.id, modelVersionId: model!.modelVersionId, selectionRevision: model!.selectionRevision,
    contentFingerprint: model!.contentFingerprint, preparationKey: access.preparationKey ?? '', from: start!, to: end! } : null;
  useEffect(() => {
    onEndpointForegroundContexts?.(foregroundLatest.current);
    return () => onEndpointForegroundContexts?.(null);
  }, [foregroundKey, onEndpointForegroundContexts]);
  const currentReview = review?.cableId === cable.cable.id ? review : null;
  const savedExactPending = pathSource === 'saved-exact' && Boolean(pending || legacyRecovery || currentReview?.pending);
  const reviewBlocked = busy || Boolean(pending) || unsaved || calculationPending || refreshing || Boolean(refreshError)
    || endpointReadUnavailable || Boolean(currentReview?.pending) || pathSource === 'saved-exact';
  const oldBarrierProof = cable.calculation.reasonCodes.includes('BARRIER_WRITE_PROOF_REQUIRED');
  const stoppedCalculation = !calculationPending && cable.calculation.jobId !== null && cable.calculation.outcome !== 'calculated'
    && (['failed', 'cancelled', 'complete'].includes(cable.calculation.jobStatus ?? '') || cable.calculation.itemState === 'blocked');
  const diagnostics = stoppedCalculation && calculationDiagnostics?.cableId === cable.cable.id
    && calculationDiagnostics.jobId === cable.calculation.jobId ? calculationDiagnostics : null;
  const stoppedMessage = diagnostics?.itemMessage?.trim() ? `Calculation stopped: ${diagnostics.itemMessage}`
    : diagnostics?.jobFailure?.trim() ? `Calculation job stopped: ${diagnostics.jobFailure}` : null;
  const preparationUpdated = stoppedCalculation && cable.calculation.outcome === 'stale' && cable.calculation.currentness === 'changed'
    && cable.calculation.reasonCodes.includes('ROUTING_PREPARATION_UPDATED') && cable.calculation.proposalId === null
    && cable.calculation.proposalHash === null && !cable.calculation.reviewable && !cable.calculation.acceptedMatchesCurrent;
  const calculationMessage = preparationUpdated ? calculationFeedback?.currentAttempt ? calculationFeedback.message
    : 'Network ready. Calculate routing to create a current route.' : stoppedMessage;
  const pairSaved = cable.calculation.acceptedMatchesCurrent && !calculationPending && !unsaved;
  // Stored Cable list values remain useful on first open even when no current
  // proposal can be drawn. They supply text only, never Show or review authority.
  const hasCalculatedRouting = typeof calculatedRouting === 'string' && calculatedRouting.trim().length > 0;
  const usingSavedExactPath = pathSource === 'saved-exact' && hasCalculatedRouting && !calculationPending && !unsaved;
  const storedRouting = cable.cable.routing?.trim() ? cable.cable.routing : null;
  const showingStoredRouting = !hasCalculatedRouting && storedRouting !== null;
  const previousStoredRouting = showingStoredRouting && (calculationPending || unsaved || Boolean(calculationFeedback)
    || calculatedRouting !== undefined);
  const routingHeading = usingSavedExactPath ? 'Cable list routing' : hasCalculatedRouting || !showingStoredRouting ? 'Calculated routing'
    : previousStoredRouting ? 'Previous Cable list routing' : 'Cable list routing';
  const automaticWriting = ['pending','running','unknown'].includes(cable.calculation.automaticUpdate?.status??'');
  const automaticRecoveryRequired = !pairSaved && cable.calculation.automaticUpdate?.status==='unknown'
    && cable.calculation.automaticUpdate.reasonCode==='AUTOMATIC_PAIR_RECOVERY_LIMIT';
  const automaticUpdate = cable.calculation.automaticUpdate;
  const automaticStopped = !pairSaved && ['refused', 'stale', 'authority-expired'].includes(automaticUpdate?.status ?? '');
  useEffect(() => {
    const observed = cable.cable.cableWriteRevision;
    const revisionKey = JSON.stringify([displayScope, observed]);
    // A receipt-backed automatic write can advance this cable after its two
    // Save contexts were read. Refresh those contexts once; sibling progress
    // and older list rows do not invalidate a fresh pair or a checked path.
    const newerSelectedRevision = /^(0|[1-9][0-9]*)$/.test(observed) && [from.context, to.context].some(context =>
      context && /^(0|[1-9][0-9]*)$/.test(context.cableWriteRevision) && BigInt(observed) > BigInt(context.cableWriteRevision));
    const revisionRefresh = newerSelectedRevision && previousEndpointRevisionRead.current !== revisionKey;
    if (previousEndpointRefresh.current === endpointRefreshKey && !revisionRefresh || !active || assignment.busy
      || pending || legacyRecovery || unsaved || assignment.retired || assignment.error || from.error || to.error) return;
    previousEndpointRefresh.current = endpointRefreshKey;
    if (revisionRefresh) previousEndpointRevisionRead.current = revisionKey;
    assignment.refresh();
  }, [endpointRefreshKey, active, assignment, pending, legacyRecovery, unsaved, displayScope, cable.cable.cableWriteRevision, from.context, to.context, from.error, to.error]);
  const close = () => { onClose(); const target = anchor?.isConnected ? anchor : focusReturn.current; if (target?.isConnected) target.focus({ preventScroll: true }); };
  const callbacks = useRef(close); callbacks.current = close;
  useLayoutEffect(() => {
    if (open && !previousOpen.current) {
      focusReturn.current = anchor?.isConnected ? anchor : document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setCollapsed(false); panel.current?.focus({ preventScroll: true });
    }
    previousOpen.current = open;
  }, [open, anchor]);
  useEffect(() => {
    if (!open) return;
    const ownerDocument = floating.portalTarget?.ownerDocument ?? document;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); event.stopPropagation(); callbacks.current(); } };
    ownerDocument.addEventListener('keydown', escape); return () => ownerDocument.removeEventListener('keydown', escape);
  }, [open, floating.portalTarget]);
  if (!open || !access.active) return null;
  const endpoint = (end: 'from' | 'to', state: Endpoint, styles: CablePopupSurfaceStyles) => {
    const side = end === 'from' ? 'From' : 'To', name = end === 'from' ? cable.cable.fromLocation : cable.cable.toLocation;
    const displayContext = state.context ?? retained.current[end], lastRead = !state.context && Boolean(displayContext);
    const automatic = displayContext?.automaticSelection, confirmed = displayContext?.confirmedSelection,
      savedDisplay = displayContext?.confirmedDisplaySelection;
    const point = state.draft?.point ?? automatic?.pointProjectMetres ?? confirmed?.pointProjectMetres ?? savedDisplay?.pointProjectMetres ?? displayContext?.head?.pointProjectMetres;
    const selectedDraft = state.draftSource === 'selected';
    const objectName = selectedDraft ? state.displaySelection?.name || (state.draft?.mode === 'fixed-world' ? 'Fixed point' : 'Selected model object')
      : automatic?.name ?? confirmed?.name ?? savedDisplay?.name ?? (savedDisplay ? `Saved model object (ID ${savedDisplay.sdkObjectId})`
        : displayContext?.head ? `Saved point for ${name ?? 'this location'}` : state.error || assignment.error || assignment.retired
          ? 'Location could not be read. Refresh From/To.' : 'No model object assigned');
    const value = [objectName, point ? `X: ${point[0]} m; Y: ${point[1]} m; Z: ${point[2]} m` : ''].filter(Boolean).join('\n');
    const objectId = assignment.retired ? null : locationObjectId(state, access.model);
    const display = locationDisplay?.scope === displayScope && locationDisplay.end === end ? locationDisplay : null;
    return <section aria-label={`${side} endpoint`} className={styles.field}>
      <h4 className={styles.heading}>{side}: {name?.trim() ? name : 'Location name is missing.'}</h4>
      {!name?.trim() ? <a href={`/projects/${access.projectId}/cables/${cable.cable.id}`}>Set the {side} location name in Cable list</a> : null}
      <textarea aria-label={`${side} assigned model object`} className={styles.value} readOnly value={value} rows={3} />
      <Caption1>{lastRead ? 'Last read location — refresh From/To before using it.' : selectedDraft ? 'Selected — not saved.' : automatic ? 'Automatically matched — confirm with Save.'
        : displayContext?.head ? 'Saved shared location.' : 'Choose one object in the Model Browser.'}</Caption1>
      <div className={styles.actions}>
        <Button disabled={busy || locationWorking || Boolean(pending) || !name?.trim() || !state.canSelect}
          onClick={() => void state.selectObject()}>Assign {side}</Button>
        <Button aria-label={`Show ${side} location`} disabled={actionsBusy || state.busy || locationWorking || objectId === null || !onShowLocation}
          onClick={() => { if (objectId !== null) void showLocation(end, objectId); }}>Show location</Button>
      </div>
      {objectId === null && point && !lastRead && !state.busy ? <Caption1>This location has no current model object to show. Assign an object or refresh From/To.</Caption1> : null}
      {display?.working ? <Spinner size="tiny" label={`Showing ${side} location…`} /> : null}
      {display?.error ? <p role="alert" className={styles.note}>{display.error}</p> : null}
      {!busy && !pending && name?.trim() && !state.canSelect && !state.error ? <p className={styles.note} role="status">Prepare the current model and refresh this endpoint before assigning an object.</p> : null}
      {state.busy ? <Spinner size="tiny" label={`Checking ${side} selection…`} /> : null}
      {state.error ? <p role="alert" className={styles.note}>{state.error}</p> : null}
      {state.notice ? <p role="status" className={styles.note}>{state.notice}</p> : null}
    </section>;
  };
  const content = <CablePopupSurface targetDocument={floating.portalTarget?.ownerDocument}>{styles => <div ref={panel} className={styles.panel} style={floating.panelStyle} role="dialog" aria-modal="false" aria-labelledby={title}
    tabIndex={-1} data-cable-id={cable.cable.id} data-collapsed={String(collapsed)} onClick={event => event.stopPropagation()}>
    <div {...floating.dragHandleProps}><h3 id={title} className={styles.heading}>{cable.cable.tag?.trim() ? cable.cable.tag : 'Cable routing'}</h3></div>
    <div className={styles.actions}><Button onClick={floating.isPoppedOut ? floating.returnToPage : floating.openInWindow}>{floating.isPoppedOut ? 'Return to page' : 'Open in separate window'}</Button>
      {!floating.isPoppedOut ? <Button onClick={floating.resetPosition}>Reset position</Button> : null}</div>
    {floating.notice ? <p role="status" className={styles.note}>{floating.notice}</p> : null}
    <div className={styles.actions}><Button aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? 'Expand' : 'Collapse'}</Button><Button onClick={close}>Close</Button></div>
    {collapsed ? <p className={styles.note}>Cable routing is collapsed. The model remains available; any pending save is retained.</p> : <>
      <div className={styles.actions}>
        {onRefresh ? <Button disabled={refreshing} onClick={() => void onRefresh()}>Refresh cable status</Button> : null}
        <Button disabled={assignment.busy || !assignment.enabled} onClick={() => { assignment.refresh(); void onRefresh?.(); }}>Refresh From/To</Button>
      </div>
      {refreshing ? <Spinner size="tiny" label="Refreshing this cable…" /> : null}
      {refreshError ? <p role="alert" className={styles.note}>{refreshError}</p> : null}
      {endpointReadUnavailable ? <p role="status" className={styles.note}>From/To could not be confirmed. Last read locations remain visible. Use Refresh From/To to check them; pending commands are retained.</p> : null}
      <p className={styles.note}>Assign the selected Model Browser object to From or To. The connection starts at the centre of its bottom face. Save to confirm and reuse this location for other cables with the same location name.</p>
      {pending ? <section aria-label="Pending endpoint assignment"><h4>Pending endpoint assignment</h4>
        <p className={styles.note}>An exact Save is retained for this project. Reconcile its original cable and endpoint assignments before making another assignment.</p>
        <div className={styles.actions}><Button disabled={busy || !assignment.canRetry} onClick={() => void assignment.retry()}>Retry exact pending save</Button>
          <Button disabled={busy || !assignment.canRetry} onClick={() => void assignment.closePending()}>Close pending assignment</Button></div>
      </section> : null}
      {legacyRecovery ? <section aria-label="Earlier endpoint recovery"><h4>Earlier endpoint recovery</h4>
        <p className={styles.note}>An earlier {legacyRecovery.end ?? 'endpoint'} assignment is unconfirmed{legacyRecovery.cableId ? ` for cable ${legacyRecovery.cableId}` : ''}. These controls reconcile its exact saved command.</p>
        <div className={styles.actions}><Button disabled={busy || !legacyRecovery.canRetry} onClick={() => void legacyRecovery.retry()}>Retry earlier endpoint save</Button>
          <Button disabled={busy || !legacyRecovery.canRetry} onClick={() => void legacyRecovery.close()}>Close earlier endpoint command</Button></div>
      </section> : null}
      {endpoint('from', from, styles)}{endpoint('to', to, styles)}
      <section className={styles.field} aria-label="Cable routing actions">
        <h4 className={styles.heading}>{routingHeading}</h4>
        <textarea aria-label="Cable routing" className={styles.value} readOnly value={hasCalculatedRouting ? calculatedRouting : storedRouting ?? ''} placeholder={calculationPending ? 'Calculating this cable’s new route…' : 'No routing saved in Cable list'} rows={3} />
        {showingStoredRouting ? <>
          <p className={styles.note}>{previousStoredRouting ? 'Previous Cable list' : 'Cable list'} design length: {cable.cable.designLength === null ? 'Not set' : cable.cable.designLength === '' ? 'Empty stored value' : `${cable.cable.designLength} m`}</p>
          <Caption1>{previousStoredRouting ? calculationPending
            ? 'Previously saved route. The new calculated route will appear here when it is available.'
            : 'Previously saved route. Refresh cable status or calculate routing to check the current result.'
            : 'Saved Cable list route. Show requires a current calculated path for these locations, the active model and obstacles.'}</Caption1>
        </> : calculatedDesignLength !== undefined ? <p className={styles.note}>{usingSavedExactPath ? 'Cable list' : 'Calculated'} design length: {calculatedDesignLength ?? 'Not available'} m</p> : null}
        {usingSavedExactPath ? <Caption1>Saved route. Show displays its saved path without recalculating.</Caption1> : null}
        {onDrillThroughWallsChange ? <>
          <Checkbox label="Drill through the walls" checked={drillThroughWalls}
            disabled={busy || Boolean(pending) || Boolean(legacyRecovery) || calculationPending || Boolean(currentReview?.pending)}
            onChange={(_, value) => onDrillThroughWallsChange(value.checked === true)} />
          <Caption1>For the next calculation of this cable only. Ignore all registered barrier types. New shared-location Saves keep drilling disabled. Existing results and pending commands retain their original setting.</Caption1>
        </> : null}
        {submittedDrillThroughWalls !== null && submittedDrillThroughWalls !== undefined ? <p className={styles.note}>Submitted calculation: Drill through the walls {submittedDrillThroughWalls ? 'enabled' : 'disabled'}. The next-calculation checkbox does not change this request.</p> : null}
        {calculationFeedback ? calculationFeedback.working
          ? <Spinner size="tiny" label={calculationFeedback.message} />
          : <p role="status" className={styles.note}>{calculationMessage ?? calculationFeedback.message}</p>
          : stoppedCalculation ? <p role="status" className={styles.note}>{calculationMessage ?? 'The latest calculation did not produce a current route. Check its calculation diagnostics.'}</p> : null}
        {stoppedCalculation ? <details><summary>{preparationUpdated ? 'Previous calculation diagnostics' : 'Calculation diagnostics'}</summary>
          {preparationUpdated ? <p className={styles.note}>Previous calculation job: {cable.calculation.jobId}. Its refusal was recorded before the current routing network was prepared.</p>
            : <p className={styles.note}>Latest calculation outcome: {cable.calculation.outcome}. Job: {cable.calculation.jobId}.</p>}
          {diagnostics ? <>
            <p className={styles.note}>{preparationUpdated ? 'Previous job status' : 'Job status'}: {diagnostics.jobStatus ?? 'Unavailable'}; {preparationUpdated ? 'previous cable status' : 'cable status'}: {diagnostics.itemStatus ?? 'Unavailable'}; {preparationUpdated ? 'previous cable state' : 'cable state'}: {diagnostics.itemState ?? 'Unavailable'}.</p>
            {diagnostics.itemMessage ? <p className={styles.note}>{preparationUpdated ? 'Previous cable diagnostic' : 'Cable diagnostic'}: {diagnostics.itemMessage}</p> : null}
            {diagnostics.jobFailure ? <p className={styles.note}>{preparationUpdated ? 'Previous job diagnostic' : 'Job diagnostic'}: {diagnostics.jobFailure}</p> : null}
            {diagnostics.readError ? <p role="status" className={styles.note}>{preparationUpdated ? 'Previous diagnostic read: ' : ''}{diagnostics.readError}</p> : null}
          </> : <p className={styles.note}>{preparationUpdated ? 'Reading the previous calculation’s diagnostic…' : 'Reading this cable’s exact calculation diagnostic…'}</p>}
          {cable.calculation.reasonCodes.length ? <p className={styles.note}>{preparationUpdated ? 'Recorded refusal and update codes' : 'Reason codes'}: {cable.calculation.reasonCodes.join(', ')}.</p> : null}
          {cable.calculation.errorCode ? <p className={styles.note}>{preparationUpdated ? 'Previous calculation error code' : 'Error code'}: {cable.calculation.errorCode}.</p> : null}
        </details> : null}
        <div className={styles.actions}>
          <Button disabled={busy || Boolean(pending) || Boolean(legacyRecovery) || Boolean(currentReview?.pending) || unsaved || endpointReadUnavailable || calculationPending || !onCalculate} onClick={() => void onCalculate?.()}>Calculate routing</Button>
          <Button disabled={busy || !onTogglePath || !pathVisible && (!pathReady || unsaved || calculationPending || refreshing || Boolean(refreshError) || endpointReadUnavailable || savedExactPending)} aria-pressed={pathVisible} onClick={onTogglePath}>{pathVisible ? 'Hide' : 'Show'}</Button>
          <Button appearance="primary" disabled={busy || Boolean(pending) || !assignment.canSave} onClick={() => void assignment.save('Confirm cable From/To model assignments.')}>Save</Button>
        </div>
        {calculationBlockedReason ? <p role="status" className={styles.note}>{calculationBlockedReason}</p> : null}
        {calculationBlockedReason && onConfigureCalculation ? <Button disabled={busy} onClick={onConfigureCalculation}>Configure routing</Button> : null}
        {!calculationPending && !pathReady && cable.calculation.outcome === 'calculated' ? <p role="status" className={styles.note}>{refreshing
          ? 'Loading the saved calculation for Show…'
          : cable.calculation.currentness !== 'current'
            ? 'Show needs a current path for the active model, locations and obstacles. Calculate routing to update it.'
            : hasCalculatedRouting
              ? 'The route text is loaded. Preparing its exact calculated path for Show…'
              : 'No verified path is available for Show. Refresh cable status to check the saved result, or calculate a new route.'}</p> : null}
        {oldBarrierProof ? <p role="status" className={styles.note}>This earlier route has no verified barrier checks. Configure the current barriers and calculate routing again before Review and Apply.</p> : null}
        {unsaved ? <p className={styles.note}>{endpointOnlySave
          ? 'Save the assigned From/To locations now. Configure the current route settings and barriers before calculating routing.'
          : 'Save the assigned endpoints before calculating routing.'}</p> : null}
        {!unsaved && !busy && !pending && !legacyRecovery && !assignment.error ? <p className={styles.note}>No From/To changes to save. Save confirms endpoint assignments. Manually changed cable values require Review and Apply.</p> : null}
        {assignment.busy ? <Spinner size="tiny" label="Checking or saving endpoints…" /> : null}
        {assignment.error ? <p role="alert" className={styles.note}>{assignment.error}</p> : null}
        {assignment.notice ? <p role="status" className={styles.note}>{assignment.notice}</p> : null}
        <p className={styles.note}>{endpointOnlySave
          ? 'Save confirms the shared locations. It does not calculate routing or update Cable list values. After configuring the current barriers, submit a new calculation.'
          : access.automaticPairPolicy
            ? 'Save recalculates this cable first, then other cables sharing its locations. Empty Routing and Design length fields, or unchanged values previously written automatically by Path Finder, update automatically. Manually changed cables require Review and Apply.'
            : 'Save recalculates affected cables. Routing and design length fill automatically only when both are empty. Existing values require Review and Apply.'}</p>
      </section>
      <section className={styles.field} aria-label="Review and Apply cable routing">
        <h4 className={styles.heading}>{pairSaved ? 'Routing and length saved' : automaticStopped ? 'Cable list update not saved' : usingSavedExactPath ? 'Routing and length saved' : automaticRecoveryRequired ? 'Cable update needs confirmation' : automaticWriting ? 'Updating cable values' : 'Review and Apply'}</h4>
        {currentReview?.recordedDrillThroughWalls !== null && currentReview?.recordedDrillThroughWalls !== undefined ? <p className={styles.note}>Recorded result: Drill through the walls {currentReview.recordedDrillThroughWalls ? 'enabled' : 'disabled'}. This setting belongs to the exact calculated proposal.</p> : null}
        {currentReview?.autoLength || currentReview?.autoLengthLoading || currentReview?.autoLengthError ? <section aria-label="Automatic length from Cable list">
          <h4 className={styles.heading}>Auto calculated length [m]</h4>
          {currentReview.autoLengthLoading ? <Spinner size="tiny" label="Reading automatic cable length…" /> : null}
          {currentReview.autoLength ? <CableAutoCalculatedLength value={currentReview.autoLength} /> : null}
          {currentReview.autoLengthError ? <p role="alert" className={styles.note}>{currentReview.autoLengthError}</p> : null}
          {currentReview.refreshAutoLength ? <Button disabled={currentReview.autoLengthLoading} onClick={currentReview.refreshAutoLength}>Refresh automatic length</Button> : null}
        </section> : null}
        <p className={styles.note}>{pairSaved ? 'The exact current result is already saved in Cable list. No further approval is required.'
          : automaticStopped ? 'The automatic Routing and Design length update was not saved. Existing Cable list values were retained.'
            : usingSavedExactPath ? 'The saved route and Design length are available for viewing. Calculate routing to review a new result.'
            : automaticRecoveryRequired ? 'The automatic cable update could not be confirmed. Use Refresh cable status to check the exact saved receipt. No replacement calculation or write will be submitted.'
            : automaticWriting ? 'The calculation is complete. Waiting for the automatic Routing and Design length update to be confirmed.'
            : 'Manually changed Cable list values are retained. Compare them with the calculated proposal, inspect its path with Show, then review and Apply it.'}</p>
        {automaticStopped && automaticUpdate?.reasonCode ? <p role="alert" className={styles.note}>Update reason: {automaticUpdate.reasonCode.toLowerCase().replaceAll('_', ' ')}.</p> : null}
        {pairSaved ? <p role="status" className={styles.note}>Routing and Design length match the verified result in Cable list.</p>
          : calculationPending ? <p role="status" className={styles.note}>Waiting for this cable’s new calculation and any automatic cable update. Earlier proposals cannot be approved here.</p>
          : currentReview?.comparisonLoading ? <Spinner size="tiny" label="Reading current and proposed cable values…" />
            : currentReview?.comparison ? <PathFinderCableComparison input={currentReview.comparison} />
              : <section aria-label="Stored cable values"><h4 className={styles.heading}>Stored cable values</h4>
                <Caption1>Last read from Cable list. These values do not approve a calculated proposal.</Caption1>
                <p className={styles.note}>Design length: {cable.cable.designLength === null ? 'Not set' : cable.cable.designLength === '' ? 'Empty stored value' : `${cable.cable.designLength} m`}</p>
                <pre className={styles.note} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{cable.cable.routing ?? 'No routing stored'}</pre>
                <p role="status" className={styles.note}>An exact current proposal comparison is not available yet. Refresh this cable or configure routing and calculate a new result before Review and Apply.</p>
              </section>}
        {currentReview?.comparisonError ? <p role="alert" className={styles.note}>{currentReview.comparisonError}</p> : null}
        {currentReview?.message ? <p role="status" className={styles.note}>{currentReview.message}</p> : null}
        {currentReview?.reviewed ? <p role="status" className={styles.note}>Review confirmed for this exact proposal. Apply updates routing and design length together.</p> : null}
        {currentReview?.applied ? <p role="status" className={styles.note}>The matching Apply receipt is confirmed. Cable list values have been updated.</p> : null}
        {!pairSaved && !automaticWriting ? <div className={styles.actions}>
          <Button disabled={reviewBlocked || !currentReview?.canReview || currentReview.busy} onClick={() => currentReview?.review()}>Review proposed routing</Button>
          <Button appearance="primary" disabled={reviewBlocked || !currentReview?.canApply || currentReview.busy} onClick={() => currentReview?.apply()}>Apply reviewed routing</Button>
        </div> : null}
        {currentReview?.pending ? <section aria-label="Pending cable routing Apply">
          <p className={styles.note}>The original Apply command is retained. Check its outcome before approving another result.</p>
          <div className={styles.actions}><Button disabled={busy || !currentReview.canRecover} onClick={currentReview.retry}>Retry pending routing Apply</Button>
            <Button disabled={busy || !currentReview.canRecover} onClick={currentReview.closePending}>Close pending routing request</Button></div>
        </section> : null}
        {currentReview?.recoveryError ? <p role="alert" className={styles.note}>{currentReview.recoveryError}</p> : null}
        {currentReview?.recoveryMessage ? <p role="status" className={styles.note}>{currentReview.recoveryMessage}</p> : null}
      </section>
      <details><summary>Endpoint details</summary><p className={styles.note}>The connection point is the bounding-box bottom centre in project metres. Manually assigned points must be checked again after a model revision.</p>
      </details>
    </>}
  </div>}</CablePopupSurface>;
  return floating.portalTarget ? createPortal(content, floating.portalTarget) : <Portal>{content}</Portal>;
}
