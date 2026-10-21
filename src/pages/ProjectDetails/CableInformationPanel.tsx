import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Portal } from '@fluentui/react-components';
import type { CableInformationPanelProps } from './hooks/useCableInformationPanel';
import { useFloatingCablePanel } from '@/hooks/useFloatingCablePanel';
import { useCableInformationPanelStyles } from './CableInformationPanel.styles';

export type { CableInformationPanelProps } from './hooks/useCableInformationPanel';

/** The portal is nonmodal: opening on hover never moves focus or traps Tab. */
export function CableInformationPanel(props: CableInformationPanelProps) {
  const styles = useCableInformationPanelStyles();
  const floating = useFloatingCablePanel({ open: true, title: `Cable: ${props.cable.tag}`, scopeKey: props.scopeKey,
    width: 416, preferredTop: props.anchorRect.top, onInteract: props.onPin, requestedPopup: props.requestedPopup });
  const panel = floating.panelRef;
  const from = useRef<HTMLTextAreaElement>(null), to = useRef<HTMLTextAreaElement>(null), routing = useRef<HTMLTextAreaElement>(null), all = useRef<HTMLTextAreaElement>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const titleId = `${props.id}-title`;
  useLayoutEffect(() => { if (props.focusOnOpen) panel.current?.focus({ preventScroll: true }); }, [props.focusOnOpen, props.cable.id, floating.portalTarget, panel]);
  useLayoutEffect(() => {
    const owner = panel.current?.ownerDocument; if (!owner) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation(); props.onClose();
    };
    owner.addEventListener('keydown', escape);
    return () => owner.removeEventListener('keydown', escape);
  }, [floating.portalTarget, panel, props.onClose]);
  useLayoutEffect(() => {
    if (!props.fallbackField) return;
    if (props.fallbackField === 'all') setManualOpen(true);
    const target = props.fallbackField === 'all' ? all.current : props.fallbackField === 'fromLocation' ? from.current : props.fallbackField === 'toLocation' ? to.current : routing.current;
    target?.focus({ preventScroll: true }); target?.select();
  }, [props.fallbackField, props.copyAttempt]);
  const content = <div ref={panel} className={styles.panel} style={floating.panelStyle} id={props.id} role="dialog" aria-modal="false" aria-labelledby={titleId}
      tabIndex={-1} data-cable-id={props.cable.id} data-pinned={String(props.pinned)} data-popped-out={String(floating.isPoppedOut)}
      onPointerEnter={props.onPointerEnter} onPointerLeave={props.onPointerLeave} onFocus={props.onFocus} onBlur={props.onBlur} onKeyDown={props.onKeyDown}
      onClick={event => event.stopPropagation()}>
      <div {...floating.dragHandleProps}><h3 id={titleId} className={styles.heading}>{props.cable.tag}</h3></div>
      <div className={styles.actions}>
        <Button onClick={props.onTogglePin} aria-pressed={props.pinned}>{props.pinned ? 'Unpin' : 'Pin'}</Button>
        <Button onClick={props.onClose}>Close</Button>
        {floating.isPoppedOut ? <Button onClick={floating.returnToPage}>Return to page</Button>
          : <Button onClick={floating.openInWindow}>Open in new window</Button>}
        <Button onClick={floating.resetPosition}>Reset position</Button>
      </div>
      {floating.notice ? <p className={styles.note} role="status">{floating.notice}</p> : null}
      <div data-testid="cable-information-status" role="status" aria-live="polite">
      {props.readStatus !== 'confirmed' ? <p className={styles.note}>{props.readStatus === 'refreshing'
        ? 'Refreshing cables. These are previously confirmed values.' : 'These cached values may be out of date. Refresh cables to confirm them.'}</p> : null}
      {props.notice ? <p className={styles.note}>{props.notice}</p> : null}
      </div>
      <label className={styles.field}><span className={styles.label}>From</span>
        <textarea ref={from} className={styles.value} aria-label="From" readOnly value={props.cable.fromLocation ?? ''} placeholder="No value" rows={2} />
      </label>
      <div className={styles.actions}><Button onClick={() => props.onCopy('fromLocation')}>Copy From</Button></div>
      <label className={styles.field}><span className={styles.label}>To</span>
        <textarea ref={to} className={styles.value} aria-label="To" readOnly value={props.cable.toLocation ?? ''} placeholder="No value" rows={2} />
      </label>
      <div className={styles.actions}><Button onClick={() => props.onCopy('toLocation')}>Copy To</Button></div>
      <label className={styles.field}><span className={styles.label}>Routing</span>
        <textarea ref={routing} className={styles.value} aria-label="Routing" readOnly value={props.cable.routing ?? ''} placeholder="No value" rows={4} />
      </label>
      <div className={styles.actions}>
        <Button onClick={() => props.onCopy('routing')}>Copy Routing</Button>
        <Button onClick={() => props.onCopy('all')}>Copy all</Button>
      </div>
      <p className={styles.note}>Select the text and press Ctrl+C.</p>
      <p className={styles.note} role="status" aria-live="polite" data-testid="cable-information-copy-status">{props.feedback ?? ''}</p>
      <details className={styles.manual} open={manualOpen || props.fallbackField === 'all'} onToggle={event => setManualOpen(event.currentTarget.open)}>
        <summary>Copy all text manually</summary>
        <textarea ref={all} className={styles.value} aria-label="Copy all text" readOnly value={props.allText} rows={5} />
      </details>
    </div>;
  return floating.portalTarget ? createPortal(content, floating.portalTarget) : <Portal>{content}</Portal>;
}
