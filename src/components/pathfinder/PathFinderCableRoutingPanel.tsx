import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button, Caption1, Portal, Spinner } from '@fluentui/react-components';
import type { CableEndpointSelectionAccess } from '@/hooks/useCableEndpointSelection';
import { useCableEndpointPairSelection } from '@/hooks/useCableEndpointPairSelection';
import type { CableWorkflowRow } from '../../../shared/pathfinderCableWorkflow';
import { useCableInformationPanelStyles } from '@/pages/ProjectDetails/CableInformationPanel.styles';

export type PathFinderCableRoutingPanelProps = {
  access: Omit<CableEndpointSelectionAccess, 'end' | 'cableId'>;
  cable: CableWorkflowRow | null; open: boolean; onClose: () => void; anchor?: HTMLElement | null;
  onCalculate?: () => void | Promise<void>; onTogglePath?: () => void;
  pathVisible?: boolean; actionsBusy?: boolean; calculatedRouting?: string | null; calculatedDesignLength?: string | null;
};
type Endpoint = ReturnType<typeof useCableEndpointPairSelection>['from'];
/** Persistent nonmodal portal; only its own bounds intercept pointer input. */
export function PathFinderCableRoutingPanel(props: PathFinderCableRoutingPanelProps) {
  const { access, cable } = props;
  if (!access.isAdmin || !access.accountId || !access.token || !access.projectId || access.projectId !== access.loadedProjectId
    || !cable || cable.projectId !== access.projectId || !['LV', 'Control', 'Instrumentation'].includes(cable.mto ?? '')) return null;
  const owner = JSON.stringify([access.accountId, access.projectId, access.token, cable.cable.id]);
  return <OwnedCableRoutingPanel key={owner} {...props} cable={cable} />;
}
function OwnedCableRoutingPanel({ access, cable, open, onClose, anchor, onCalculate, onTogglePath, pathVisible = false,
  actionsBusy = false, calculatedRouting, calculatedDesignLength }: PathFinderCableRoutingPanelProps & { cable: CableWorkflowRow }) {
  const styles = useCableInformationPanelStyles(), title = useId(), panel = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false), previousOpen = useRef(false), focusReturn = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 80, width: 416, maxHeight: 600 });
  const active = access.active && open && !collapsed;
  const assignment = useCableEndpointPairSelection({ ...access, cableId: cable.cable.id, active });
  const { from, to, pending, legacyRecovery } = assignment, busy = assignment.busy || actionsBusy;
  const unsaved = Boolean(from.draft || to.draft || from.context?.automaticSelection || to.context?.automaticSelection);
  const close = () => { onClose(); const target = anchor?.isConnected ? anchor : focusReturn.current; if (target?.isConnected) target.focus({ preventScroll: true }); };
  const callbacks = useRef(close); callbacks.current = close;
  useLayoutEffect(() => {
    if (open && !previousOpen.current) {
      focusReturn.current = anchor?.isConnected ? anchor : document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setCollapsed(false); panel.current?.focus({ preventScroll: true });
    }
    previousOpen.current = open;
  }, [open, anchor]);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const viewport = window.visualViewport, width = Math.max(1, Math.min(416, (viewport?.width ?? window.innerWidth) - 16));
      const height = viewport?.height ?? window.innerHeight, top = Math.min(80, Math.max(8, height - 8));
      setPosition({ width, left: (viewport?.offsetLeft ?? 0) + Math.max(8, (viewport?.width ?? window.innerWidth) - width - 8),
        top: (viewport?.offsetTop ?? 0) + top, maxHeight: Math.max(1, height - top - 8) });
    };
    measure(); window.addEventListener('resize', measure); window.visualViewport?.addEventListener('resize', measure); window.visualViewport?.addEventListener('scroll', measure);
    return () => { window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); event.stopPropagation(); callbacks.current(); } };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape);
  }, [open]);
  if (!open || !access.active) return null;
  const endpoint = (end: 'from' | 'to', state: Endpoint) => {
    const side = end === 'from' ? 'From' : 'To', name = end === 'from' ? cable.cable.fromLocation : cable.cable.toLocation;
    const automatic = state.context?.automaticSelection, confirmed = state.context?.confirmedSelection;
    const point = state.draft?.point ?? automatic?.pointProjectMetres ?? confirmed?.pointProjectMetres ?? state.context?.head?.pointProjectMetres;
    const selectedDraft = state.draftSource === 'selected';
    const objectName = selectedDraft ? state.displaySelection?.name || (state.draft?.mode === 'fixed-world' ? 'Fixed point' : 'Selected model object')
      : automatic?.name ?? confirmed?.name ?? (state.context?.head ? 'Saved endpoint' : 'No model object assigned');
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
  return <Portal><div ref={panel} className={styles.panel} style={position} role="dialog" aria-modal="false" aria-labelledby={title}
    tabIndex={-1} data-cable-id={cable.cable.id} data-collapsed={String(collapsed)} onClick={event => event.stopPropagation()}>
    <h3 id={title} className={styles.heading}>{cable.cable.tag?.trim() ? cable.cable.tag : 'Cable routing'}</h3>
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
      {endpoint('from', from)}{endpoint('to', to)}
      <section className={styles.field} aria-label="Cable routing actions">
        <h4 className={styles.heading}>{calculatedRouting !== undefined ? 'Calculated routing' : 'Cable list routing'}</h4>
        <textarea aria-label="Cable routing" className={styles.value} readOnly value={(calculatedRouting === undefined ? cable.cable.routing : calculatedRouting) ?? ''} placeholder="No routing calculated" rows={3} />
        {calculatedDesignLength !== undefined ? <p className={styles.note}>Calculated design length: {calculatedDesignLength ?? 'Not available'} m</p> : null}
        <div className={styles.actions}>
          <Button disabled={busy || Boolean(pending) || unsaved || !onCalculate} onClick={() => void onCalculate?.()}>Calculate routing</Button>
          <Button disabled={busy || !onTogglePath || !pathVisible && (!cable.calculation.proposalId || unsaved)} aria-pressed={pathVisible} onClick={onTogglePath}>{pathVisible ? 'Hide' : 'Show'}</Button>
          <Button appearance="primary" disabled={busy || Boolean(pending) || !assignment.canSave} onClick={() => void assignment.save('Confirm cable From/To model assignments.')}>Save</Button>
        </div>
        {unsaved ? <p className={styles.note}>Save the assigned endpoints before calculating routing.</p> : null}
        {assignment.busy ? <Spinner size="tiny" label="Checking or saving endpoints…" /> : null}
        {assignment.error ? <p role="alert" className={styles.note}>{assignment.error}</p> : null}
        {assignment.notice ? <p role="status" className={styles.note}>{assignment.notice}</p> : null}
        <p className={styles.note}>Save recalculates affected cables. Routing and design length fill automatically only when both are empty. Existing values require Review and Apply.</p>
      </section>
      <details><summary>Endpoint details</summary><p className={styles.note}>The connection point is the bounding-box bottom centre in project metres. Manually assigned points must be checked again after a model revision.</p>
        <Button disabled={busy || Boolean(pending) || !assignment.enabled} onClick={() => void assignment.refresh()}>Refresh endpoint contexts</Button>
      </details>
    </>}
  </div></Portal>;
}
