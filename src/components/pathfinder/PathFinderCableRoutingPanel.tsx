import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingCablePanel, type FloatingCableWindowRequest } from '@/hooks/useFloatingCablePanel';
import { Button, Caption1, Portal, Spinner } from '@fluentui/react-components';
import type { CableEndpointSelectionAccess } from '@/hooks/useCableEndpointSelection';
import { useCableEndpointPairSelection } from '@/hooks/useCableEndpointPairSelection';
import type { CableWorkflowRow } from '../../../shared/pathfinderCableWorkflow';
import { CablePopupSurface, type CablePopupSurfaceStyles } from '@/components/CablePopupSurface';
import type { PathFinderWorkflowReview } from '@/pages/ProjectDetails/PathFinderResults';
import { PathFinderCableComparison } from './PathFinderCableComparison';
import { CableAutoCalculatedLength } from './CableAutoCalculatedLength';

export type PathFinderCableRoutingPanelProps = {
  access: Omit<CableEndpointSelectionAccess, 'end' | 'cableId'>;
  requestedPopup?: FloatingCableWindowRequest | null;
  cable: CableWorkflowRow | null; open: boolean; onClose: () => void; anchor?: HTMLElement | null;
  onCalculate?: () => void | Promise<void>; onTogglePath?: () => void;
  pathVisible?: boolean; actionsBusy?: boolean; calculatedRouting?: string | null; calculatedDesignLength?: string | null;
  review?: PathFinderWorkflowReview | null; calculationPending?: boolean;
  calculationBlockedReason?: string | null; onConfigureCalculation?: () => void;
};
type Endpoint = ReturnType<typeof useCableEndpointPairSelection>['from'];
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
function OwnedCableRoutingPanel({ access, cable, open, onClose, anchor, onCalculate, onTogglePath, pathVisible = false,
  actionsBusy = false, calculatedRouting, calculatedDesignLength, review, calculationPending = false, calculationBlockedReason = null,
  onConfigureCalculation, floating }: PathFinderCableRoutingPanelProps & { cable: CableWorkflowRow; floating: ReturnType<typeof useFloatingCablePanel> }) {
  const title = useId(), panel = floating.panelRef;
  const [collapsed, setCollapsed] = useState(false), previousOpen = useRef(false), focusReturn = useRef<HTMLElement | null>(null);
  const active = access.active && open && !collapsed;
  const assignment = useCableEndpointPairSelection({ ...access, cableId: cable.cable.id, active });
  const { from, to, pending, legacyRecovery } = assignment, busy = assignment.busy || actionsBusy;
  const endpointOnlySave = access.calculation === null && access.initialFill === null;
  const unsaved = Boolean(from.draft || to.draft || from.context?.automaticSelection || to.context?.automaticSelection);
  const currentReview = review?.cableId === cable.cable.id ? review : null;
  const reviewBlocked = busy || Boolean(pending) || unsaved || calculationPending || Boolean(currentReview?.pending) || Boolean(calculationBlockedReason);
  const oldBarrierProof = cable.calculation.reasonCodes.includes('BARRIER_WRITE_PROOF_REQUIRED');
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
    const automatic = state.context?.automaticSelection, confirmed = state.context?.confirmedSelection,
      savedDisplay = state.context?.confirmedDisplaySelection;
    const point = state.draft?.point ?? automatic?.pointProjectMetres ?? confirmed?.pointProjectMetres ?? savedDisplay?.pointProjectMetres ?? state.context?.head?.pointProjectMetres;
    const selectedDraft = state.draftSource === 'selected';
    const objectName = selectedDraft ? state.displaySelection?.name || (state.draft?.mode === 'fixed-world' ? 'Fixed point' : 'Selected model object')
      : automatic?.name ?? confirmed?.name ?? savedDisplay?.name ?? (savedDisplay ? `Saved model object (ID ${savedDisplay.sdkObjectId})`
        : state.context?.head ? `Saved point for ${name ?? 'this location'}` : 'No model object assigned');
    const value = [objectName, point ? `X: ${point[0]} m; Y: ${point[1]} m; Z: ${point[2]} m` : ''].filter(Boolean).join('\n');
    return <section aria-label={`${side} endpoint`} className={styles.field}>
      <h4 className={styles.heading}>{side}: {name?.trim() ? name : 'Location name is missing.'}</h4>
      {!name?.trim() ? <a href={`/projects/${access.projectId}/cables/${cable.cable.id}`}>Set the {side} location name in Cable list</a> : null}
      <textarea aria-label={`${side} assigned model object`} className={styles.value} readOnly value={value} rows={3} />
      <Caption1>{selectedDraft ? 'Selected — not saved.' : automatic ? 'Automatically matched — confirm with Save.'
        : state.context?.head ? 'Saved shared location.' : 'Choose one object in the Model Browser.'}</Caption1>
      <Button disabled={busy || Boolean(pending) || !name?.trim() || !state.canSelect}
        onClick={() => void state.selectObject()}>Assign {side}</Button>
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
        <h4 className={styles.heading}>{calculatedRouting !== undefined ? 'Calculated routing' : 'Cable list routing'}</h4>
        <textarea aria-label="Cable routing" className={styles.value} readOnly value={(calculatedRouting === undefined ? cable.cable.routing : calculatedRouting) ?? ''} placeholder="No routing calculated" rows={3} />
        {calculatedDesignLength !== undefined ? <p className={styles.note}>Calculated design length: {calculatedDesignLength ?? 'Not available'} m</p> : null}
        <div className={styles.actions}>
          <Button disabled={busy || Boolean(pending) || Boolean(legacyRecovery) || Boolean(currentReview?.pending) || unsaved || calculationPending || !onCalculate} onClick={() => void onCalculate?.()}>Calculate routing</Button>
          <Button disabled={busy || !onTogglePath || !pathVisible && (!cable.calculation.proposalId || unsaved)} aria-pressed={pathVisible} onClick={onTogglePath}>{pathVisible ? 'Hide' : 'Show'}</Button>
          <Button appearance="primary" disabled={busy || Boolean(pending) || !assignment.canSave} onClick={() => void assignment.save('Confirm cable From/To model assignments.')}>Save</Button>
        </div>
        {calculationBlockedReason ? <p role="status" className={styles.note}>{calculationBlockedReason}</p> : null}
        {calculationBlockedReason && onConfigureCalculation ? <Button disabled={busy} onClick={onConfigureCalculation}>Configure routing</Button> : null}
        {oldBarrierProof ? <p role="status" className={styles.note}>This earlier route has no verified barrier checks. Configure the current barriers and calculate routing again before Review and Apply.</p> : null}
        {unsaved ? <p className={styles.note}>{endpointOnlySave
          ? 'Save the assigned From/To locations now. Configure the current route settings and barriers before calculating routing.'
          : 'Save the assigned endpoints before calculating routing.'}</p> : null}
        {!unsaved && !busy && !pending && !legacyRecovery && !assignment.error ? <p className={styles.note}>No From/To changes to save. Save confirms endpoint assignments; Review and Apply update routing and design length.</p> : null}
        {assignment.busy ? <Spinner size="tiny" label="Checking or saving endpoints…" /> : null}
        {assignment.error ? <p role="alert" className={styles.note}>{assignment.error}</p> : null}
        {assignment.notice ? <p role="status" className={styles.note}>{assignment.notice}</p> : null}
        <p className={styles.note}>{endpointOnlySave
          ? 'Save confirms the shared locations. It does not calculate routing or update Cable list values. After configuring the current barriers, submit a new calculation.'
          : 'Save recalculates affected cables. Routing and design length fill automatically only when both are empty. Existing values require Review and Apply.'}</p>
      </section>
      <section className={styles.field} aria-label="Review and Apply cable routing">
        <h4 className={styles.heading}>Review and Apply</h4>
        {currentReview?.autoLength || currentReview?.autoLengthLoading || currentReview?.autoLengthError ? <section aria-label="Automatic length from Cable list">
          <h4 className={styles.heading}>Auto calculated length [m]</h4>
          {currentReview.autoLengthLoading ? <Spinner size="tiny" label="Reading automatic cable length…" /> : null}
          {currentReview.autoLength ? <CableAutoCalculatedLength value={currentReview.autoLength} /> : null}
          {currentReview.autoLengthError ? <p role="alert" className={styles.note}>{currentReview.autoLengthError}</p> : null}
          {currentReview.refreshAutoLength ? <Button disabled={currentReview.autoLengthLoading} onClick={currentReview.refreshAutoLength}>Refresh automatic length</Button> : null}
        </section> : null}
        <p className={styles.note}>Keep the existing Cable list values. Compare them with the calculated proposal, inspect its path with Show, then explicitly review and Apply it.</p>
        {calculationPending ? <p role="status" className={styles.note}>Waiting for this cable’s new calculation. Earlier proposals cannot be approved here.</p>
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
        <div className={styles.actions}>
          <Button disabled={reviewBlocked || !currentReview?.canReview || currentReview.busy} onClick={() => currentReview?.review()}>Review proposed routing</Button>
          <Button appearance="primary" disabled={reviewBlocked || !currentReview?.canApply || currentReview.busy} onClick={() => currentReview?.apply()}>Apply reviewed routing</Button>
        </div>
        {currentReview?.pending ? <section aria-label="Pending cable routing Apply">
          <p className={styles.note}>The original Apply command is retained. Check its outcome before approving another result.</p>
          <div className={styles.actions}><Button disabled={busy || !currentReview.canRecover} onClick={currentReview.retry}>Retry pending routing Apply</Button>
            <Button disabled={busy || !currentReview.canRecover} onClick={currentReview.closePending}>Close pending routing request</Button></div>
        </section> : null}
        {currentReview?.recoveryError ? <p role="alert" className={styles.note}>{currentReview.recoveryError}</p> : null}
        {currentReview?.recoveryMessage ? <p role="status" className={styles.note}>{currentReview.recoveryMessage}</p> : null}
      </section>
      <details><summary>Endpoint details</summary><p className={styles.note}>The connection point is the bounding-box bottom centre in project metres. Manually assigned points must be checked again after a model revision.</p>
        <Button disabled={busy || Boolean(pending) || !assignment.enabled} onClick={() => void assignment.refresh()}>Refresh endpoint contexts</Button>
      </details>
    </>}
  </div>}</CablePopupSurface>;
  return floating.portalTarget ? createPortal(content, floating.portalTarget) : <Portal>{content}</Portal>;
}
