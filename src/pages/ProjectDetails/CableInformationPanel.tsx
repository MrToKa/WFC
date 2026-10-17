import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Portal } from '@fluentui/react-components';
import type { CableInformationPanelProps } from './hooks/useCableInformationPanel';
import { useCableInformationPanelStyles } from './CableInformationPanel.styles';

export type { CableInformationPanelProps } from './hooks/useCableInformationPanel';

/** The portal is nonmodal: opening on hover never moves focus or traps Tab. */
export function CableInformationPanel(props: CableInformationPanelProps) {
  const styles = useCableInformationPanelStyles();
  const panel = useRef<HTMLDivElement>(null);
  const from = useRef<HTMLTextAreaElement>(null), to = useRef<HTMLTextAreaElement>(null), routing = useRef<HTMLTextAreaElement>(null), all = useRef<HTMLTextAreaElement>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 416, maxHeight: 600, visibility: 'hidden' as 'visible' | 'hidden' });
  const titleId = `${props.id}-title`;
  useLayoutEffect(() => {
    const element = panel.current; if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8, topEdge = (viewport?.offsetTop ?? 0) + 8;
      const width = Math.max(1, Math.min(416, (viewport?.width ?? window.innerWidth) - 16));
      const maxHeight = Math.max(1, (viewport?.height ?? window.innerHeight) - 16);
      const rightEdge = leftEdge + Math.max(1, (viewport?.width ?? window.innerWidth) - 16), bottomEdge = topEdge + maxHeight;
      const anchor = props.anchor?.isConnected ? props.anchor.getBoundingClientRect() : props.anchorRect;
      const measuredHeight = Math.min(element.getBoundingClientRect().height || maxHeight, maxHeight);
      const preferred = anchor.right + 8 + width <= rightEdge ? anchor.right + 8 : anchor.left - 8 - width;
      const left = Math.min(Math.max(leftEdge, preferred), Math.max(leftEdge, rightEdge - width));
      const top = Math.min(Math.max(topEdge, anchor.top), Math.max(topEdge, bottomEdge - measuredHeight));
      setPosition(previous => previous.left === left && previous.top === top && previous.width === width && previous.maxHeight === maxHeight && previous.visibility === 'visible'
        ? previous : { left, top, width, maxHeight, visibility: 'visible' });
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(queue);
    observer?.observe(element); if (props.anchor?.isConnected) observer?.observe(props.anchor);
    window.addEventListener('scroll', queue, true); window.addEventListener('resize', queue);
    window.visualViewport?.addEventListener('resize', queue); window.visualViewport?.addEventListener('scroll', queue);
    return () => {
      if (frame) cancelAnimationFrame(frame); observer?.disconnect();
      window.removeEventListener('scroll', queue, true); window.removeEventListener('resize', queue);
      window.visualViewport?.removeEventListener('resize', queue); window.visualViewport?.removeEventListener('scroll', queue);
    };
  }, [props.anchor, props.anchorRect]);
  useLayoutEffect(() => { if (props.focusOnOpen) panel.current?.focus({ preventScroll: true }); }, [props.focusOnOpen, props.cable.id]);
  useLayoutEffect(() => {
    if (!props.fallbackField) return;
    if (props.fallbackField === 'all') setManualOpen(true);
    const target = props.fallbackField === 'all' ? all.current : props.fallbackField === 'fromLocation' ? from.current : props.fallbackField === 'toLocation' ? to.current : routing.current;
    target?.focus({ preventScroll: true }); target?.select();
  }, [props.fallbackField, props.copyAttempt]);
  return <Portal>
    <div ref={panel} className={styles.panel} style={position} id={props.id} role="dialog" aria-modal="false" aria-labelledby={titleId}
      tabIndex={-1} data-cable-id={props.cable.id} data-pinned={String(props.pinned)}
      onPointerEnter={props.onPointerEnter} onPointerLeave={props.onPointerLeave} onFocus={props.onFocus} onBlur={props.onBlur} onKeyDown={props.onKeyDown}
      onClick={event => event.stopPropagation()}>
      <h3 id={titleId} className={styles.heading}>{props.cable.tag}</h3>
      <div className={styles.actions}>
        <Button onClick={props.onTogglePin} aria-pressed={props.pinned}>{props.pinned ? 'Unpin' : 'Pin'}</Button>
        <Button onClick={props.onClose}>Close</Button>
      </div>
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
    </div>
  </Portal>;
}
