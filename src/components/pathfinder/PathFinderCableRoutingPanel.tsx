import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button, Caption1, Portal, Spinner } from '@fluentui/react-components';
import { useCableEndpointSelection, type CableEndpointSelectionAccess } from '@/hooks/useCableEndpointSelection';
import type { CableWorkflowRow } from '../../../shared/pathfinderCableWorkflow';
import { useCableInformationPanelStyles } from '@/pages/ProjectDetails/CableInformationPanel.styles';

export type PathFinderCableRoutingPanelProps = {
  access: Omit<CableEndpointSelectionAccess, 'end' | 'cableId'>;
  cable: CableWorkflowRow | null; open: boolean; onClose: () => void; anchor?: HTMLElement | null;
};
type Endpoint = ReturnType<typeof useCableEndpointSelection>;
/** Persistent nonmodal portal; only its own bounds intercept pointer input. */
export function PathFinderCableRoutingPanel(props: PathFinderCableRoutingPanelProps) {
  const { access, cable } = props;
  if (!access.isAdmin || !access.accountId || !access.token || !access.projectId || access.projectId !== access.loadedProjectId
    || !cable || cable.projectId !== access.projectId || !['LV', 'Control', 'Instrumentation'].includes(cable.mto ?? '')) return null;
  const owner = JSON.stringify([access.accountId, access.projectId, access.token, cable.cable.id]);
  return <OwnedCableRoutingPanel key={owner} {...props} cable={cable} />;
}
function OwnedCableRoutingPanel({ access, cable, open, onClose, anchor }: PathFinderCableRoutingPanelProps & { cable: CableWorkflowRow }) {
  const styles = useCableInformationPanelStyles(), title = useId(), panel = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false), previousOpen = useRef(false), focusReturn = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 80, width: 416, maxHeight: 600 });
  const active = access.active && open && !collapsed;
  const from = useCableEndpointSelection({ ...access, cableId: cable.cable.id, end: 'from', active });
  const to = useCableEndpointSelection({ ...access, cableId: cable.cable.id, end: 'to', active });
  const pending = from.pending ?? to.pending, recovery = from.pending ? from : to, busy = from.busy || to.busy;
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
    const impact = state.receipt?.impact, savedHere = state.receipt?.cableId === cable.cable.id && state.receipt.end === end
      && state.receipt.logicalName === name?.normalize('NFC').trim();
    return <section aria-label={`${side} endpoint`} className={styles.field}>
      <h4 className={styles.heading}>{side}</h4><p className={styles.note}>{name?.trim() ? name : 'Location name is missing.'}</p>
      {!name?.trim() ? <a href={`/projects/${access.projectId}/cables/${cable.cable.id}`}>Set the {side} location name in Cable list</a> : null}
      <Caption1>Choose one object in the Model Browser, then apply it to this existing logical location name.</Caption1>
      <Button appearance="primary" disabled={busy || Boolean(pending) || !name?.trim() || !state.canApplySelectedObject}
        onClick={() => void state.applySelectedObject(`Apply selected model object for ${side} endpoint.`)}>Apply for {side}</Button>
      {!busy && !pending && name?.trim() && !state.canApplySelectedObject && !state.error ? <p className={styles.note} role="status">Assignment is not ready. Prepare the current model, check the calculation settings, then refresh this endpoint context.</p> : null}
      {state.busy ? <Spinner size="tiny" label={`Checking or saving ${side}…`} /> : null}
      {state.error ? <p role="alert" className={styles.note}>{state.error}</p> : null}
      {state.notice ? <p role="status" className={styles.note}>{state.notice}</p> : null}
      {savedHere ? <p className={styles.note}>Shared location saved: {impact?.distinctCables} cables; {impact?.fromOccurrences} From and {impact?.toOccurrences} To occurrences. Cable calculation and initial fill are checked separately.</p>
        : state.receipt ? <Caption1>The previous assignment to {state.receipt.logicalName} is confirmed. This endpoint is shown from its own refreshed context.</Caption1>
        : <Caption1>This assignment is shared by matching From and To names in this project. Exact shared usage is confirmed on save.</Caption1>}
      <Button size="small" disabled={busy || Boolean(pending) || !state.enabled} onClick={() => void state.refresh()}>Refresh {side} context</Button>
    </section>;
  };
  return <Portal><div ref={panel} className={styles.panel} style={position} role="dialog" aria-modal="false" aria-labelledby={title}
    tabIndex={-1} data-cable-id={cable.cable.id} data-collapsed={String(collapsed)} onClick={event => event.stopPropagation()}>
    <h3 id={title} className={styles.heading}>{cable.cable.tag?.trim() ? cable.cable.tag : 'Cable routing'}</h3>
    <div className={styles.actions}><Button aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? 'Expand' : 'Collapse'}</Button><Button onClick={close}>Close</Button></div>
    {collapsed ? <p className={styles.note}>Cable routing is collapsed. The model remains available; any pending save is retained.</p> : <>
      <p className={styles.note}>The verified anchor is the approximate bottom centre of the selected object. Your cable location names and confirmed aliases are preserved.</p>
      <p className={styles.note}>Applying From or To recalculates affected non-MV cables. Routing and design length can fill automatically only when both current fields are empty. Existing or partial values require explicit Review and Apply.</p>
      {pending ? <section aria-label="Pending endpoint assignment"><h4>Pending endpoint assignment</h4>
        <p className={styles.note}>The exact original assignment to {pending.command.expectedLogicalName} is retained for this account and project. Reconcile it before another assignment.</p>
        <div className={styles.actions}><Button disabled={busy || !recovery.canRetry} onClick={() => void recovery.retry()}>Retry exact pending save</Button>
          <Button disabled={busy || !recovery.canRetry} onClick={() => void recovery.closePending()}>Close pending assignment</Button></div>
      </section> : null}
      {endpoint('from', from)}{endpoint('to', to)}
    </>}
  </div></Portal>;
}
