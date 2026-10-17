import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEventHandler, type KeyboardEventHandler, type PointerEventHandler, type RefObject } from 'react';

export type CableInformationRecord = Readonly<{
  id: string; projectId: string; tag: string | null; fromLocation: string | null; toLocation: string | null; routing: string | null;
}>;
export type CableInformationReadStatus = 'confirmed' | 'refreshing' | 'stale' | 'unavailable';
export type CableInformationField = 'fromLocation' | 'toLocation' | 'routing' | 'all';
export type CableInformationAnchor = Readonly<{ left: number; right: number; top: number; bottom: number }>;
export type UseCableInformationPanelOptions = {
  scopeIdentity: object | null; active: boolean; lifecycleIdentity: string | null; snapshotGeneration: number;
  rows: readonly CableInformationRecord[]; readStatus: CableInformationReadStatus; searchRef: RefObject<HTMLElement | null>;
};
export type CableInformationRowProps = {
  ref(node: HTMLButtonElement | null): void;
  onPointerEnter: PointerEventHandler<HTMLButtonElement>; onPointerLeave: PointerEventHandler<HTMLButtonElement>;
  onFocus: FocusEventHandler<HTMLButtonElement>; onBlur: FocusEventHandler<HTMLButtonElement>; onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  'aria-haspopup': 'dialog'; 'aria-keyshortcuts': 'Alt+Enter'; 'aria-expanded': boolean; 'aria-controls'?: string;
};
export type CableInformationPanelProps = {
  id: string; cable: CableInformationRecord; pinned: boolean; readStatus: CableInformationReadStatus;
  anchor: HTMLButtonElement | null; anchorRect: CableInformationAnchor; focusOnOpen: boolean;
  notice: string | null; feedback: string | null; fallbackField: CableInformationField | null; copyAttempt: number; allText: string;
  onPointerEnter: PointerEventHandler<HTMLDivElement>; onPointerLeave: PointerEventHandler<HTMLDivElement>;
  onFocus: FocusEventHandler<HTMLDivElement>; onBlur: FocusEventHandler<HTMLDivElement>; onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onClose(): void; onTogglePin(): void; onCopy(field: CableInformationField): void;
};

type Context = { scope: object | null; lifecycle: string | null; active: boolean };
type Anchor = { node: HTMLButtonElement; context: Context; generation: number };
type OpenPanel = {
  context: Context; serial: number; cable: CableInformationRecord; generation: number; anchor: HTMLButtonElement;
  anchorRect: CableInformationAnchor; pinned: boolean; focusOnOpen: boolean; notice: string | null;
  feedback: string | null; fallbackField: CableInformationField | null; copyAttempt: number;
};
const tagged = (cable: CableInformationRecord | undefined): cable is CableInformationRecord => Boolean(cable?.tag?.trim());
const sameData = (a: CableInformationRecord, b: CableInformationRecord) => a.id === b.id && a.projectId === b.projectId && a.tag === b.tag
  && a.fromLocation === b.fromLocation && a.toLocation === b.toLocation && a.routing === b.routing;
const rectOf = (node: HTMLElement): CableInformationAnchor => {
  const { left, right, top, bottom } = node.getBoundingClientRect(); return { left, right, top, bottom };
};
export const cableInformationText = (cable: CableInformationRecord) => `From: ${cable.fromLocation ?? ''}\nTo: ${cable.toLocation ?? ''}\nRouting: ${cable.routing ?? ''}`;

/** One timer pair and one panel identity, independent of cable selection and routing. */
export function useCableInformationPanel(options: UseCableInformationPanelOptions) {
  const id = useId();
  const context = useMemo<Context>(() => ({ scope: options.scopeIdentity, lifecycle: options.lifecycleIdentity, active: options.active }),
    [options.scopeIdentity, options.lifecycleIdentity, options.active]);
  const latest = useRef({ context, options }); latest.current = { context, options };
  const alive = useRef(true);
  const anchors = useRef(new Map<string, Anchor>());
  const anchorCallbacks = useRef(new Map<string, { context: Context; ref(node: HTMLButtonElement | null): void }>());
  const pointerRow = useRef<string | null>(null), focusRow = useRef<string | null>(null);
  const panelPointer = useRef(false), panelFocus = useRef(false), suppressedFocus = useRef<HTMLElement | null>(null);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null), grace = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellCandidate = useRef<string | null>(null);
  const serial = useRef(0), copySerial = useRef(0);
  const [open, setOpen] = useState<OpenPanel | null>(null);
  const openRef = useRef(open);
  const eligible = (captured: Context) => alive.current && latest.current.context === captured && captured.active && captured.scope !== null;
  const stopDwell = () => { if (dwell.current !== null) clearTimeout(dwell.current); dwell.current = null; dwellCandidate.current = null; };
  const stopGrace = () => { if (grace.current !== null) clearTimeout(grace.current); grace.current = null; };
  const publish = (next: OpenPanel | null) => { openRef.current = next; setOpen(next); };
  const close = (restoreFocus: boolean, preserveOtherDwell = false) => {
    const previous = openRef.current;
    if (!preserveOtherDwell || dwellCandidate.current === previous?.cable.id) stopDwell();
    stopGrace(); ++copySerial.current; publish(null); panelPointer.current = false; panelFocus.current = false;
    if (!restoreFocus || !previous || !eligible(previous.context)) return;
    const exact = anchors.current.get(previous.cable.id);
    const target = exact?.context === previous.context && exact.node.isConnected ? exact.node : latest.current.options.searchRef.current;
    if (target?.isConnected) { suppressedFocus.current = target; target.focus({ preventScroll: true }); }
  };
  const scheduleClose = () => {
    stopGrace(); const captured = openRef.current;
    if (!captured || captured.pinned || !eligible(captured.context)) return;
    grace.current = setTimeout(() => {
      grace.current = null;
      const value = openRef.current;
      if (!value || value.serial !== captured.serial || value.context !== captured.context || !eligible(value.context) || value.pinned || panelPointer.current || panelFocus.current
        || pointerRow.current === value.cable.id || focusRow.current === value.cable.id) return;
      close(false, true);
    }, 150);
  };
  const openFor = (captured: Context, generation: number, cableId: string, node: HTMLButtonElement, keyboard: boolean) => {
    const current = latest.current.options, anchor = anchors.current.get(cableId);
    if (!eligible(captured) || current.readStatus !== 'confirmed' || generation !== current.snapshotGeneration || !node.isConnected
      || anchor?.node !== node || anchor.context !== captured || anchor.generation !== generation) return;
    const cable = current.rows.find(row => row.id === cableId);
    if (!tagged(cable)) return;
    const previous = openRef.current;
    if (previous?.context === captured && previous.pinned && previous.cable.id !== cableId) return;
    if (previous?.context === captured && panelFocus.current && previous.cable.id !== cableId && !keyboard) return;
    stopDwell(); stopGrace(); ++copySerial.current;
    panelPointer.current = false; panelFocus.current = false;
    publish({ context: captured, serial: ++serial.current, cable: { ...cable }, generation, anchor: node, anchorRect: rectOf(node),
      pinned: previous?.context === captured && previous.cable.id === cableId ? previous.pinned : false,
      focusOnOpen: keyboard, notice: null, feedback: null, fallbackField: null, copyAttempt: 0 });
  };
  const startDwell = (captured: Context, generation: number, cableId: string, node: HTMLButtonElement) => {
    stopDwell();
    if (!eligible(captured) || latest.current.options.readStatus !== 'confirmed') return;
    const previous = openRef.current;
    if (previous?.context === captured && (previous.pinned || previous.cable.id === cableId)) { if (previous.cable.id === cableId) stopGrace(); return; }
    dwellCandidate.current = cableId;
    dwell.current = setTimeout(() => {
      dwell.current = null; dwellCandidate.current = null;
      if (pointerRow.current !== cableId && focusRow.current !== cableId) return;
      openFor(captured, generation, cableId, node, false);
    }, 1000);
  };

  useLayoutEffect(() => {
    alive.current = true; stopDwell(); stopGrace(); ++copySerial.current;
    pointerRow.current = null; focusRow.current = null; panelPointer.current = false; panelFocus.current = false; suppressedFocus.current = null;
    publish(null);
    for (const [key, anchor] of anchors.current) if (anchor.context !== context) anchors.current.delete(key);
    for (const [key, anchor] of anchorCallbacks.current) if (anchor.context !== context) anchorCallbacks.current.delete(key);
    return () => { alive.current = false; stopDwell(); stopGrace(); ++copySerial.current; };
  }, [context]);
  useLayoutEffect(() => {
    const value = openRef.current;
    stopDwell();
    if (!eligible(context) || !value || value.context !== context || options.readStatus !== 'confirmed' || value.generation === options.snapshotGeneration) return;
    ++copySerial.current;
    const replacement = options.rows.find(row => row.id === value.cable.id);
    if (!tagged(replacement) || replacement.projectId !== value.cable.projectId) { close(false); return; }
    publish({ ...value, cable: { ...replacement }, generation: options.snapshotGeneration,
      notice: sameData(value.cable, replacement) ? value.notice : 'Cable information was updated.', feedback: null, fallbackField: null, copyAttempt: 0 });
  }, [context, options.snapshotGeneration, options.readStatus]);
  useLayoutEffect(() => {
    if (!open || open.context !== context || !eligible(context)) return;
    const serial = open.serial;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !eligible(context)
        || openRef.current?.context !== context || openRef.current.serial !== serial) return;
      event.preventDefault(); event.stopPropagation(); close(true);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [context, open?.serial]);

  const getRowProps = useCallback((cableId: string): CableInformationRowProps => {
    const captured = context, generation = options.snapshotGeneration;
    const valid = () => eligible(captured) && latest.current.options.snapshotGeneration === generation;
    let callback = anchorCallbacks.current.get(cableId);
    // Snapshot replacement must not detach an unchanged DOM row or erase its pointer/focus membership.
    const existingAnchor = anchors.current.get(cableId);
    if (existingAnchor?.context === captured) existingAnchor.generation = generation;
    if (!callback || callback.context !== captured) {
      callback = { context: captured, ref: node => {
        if (node && latest.current.context === captured && captured.active && captured.scope !== null) anchors.current.set(cableId, { node, context: captured, generation: latest.current.options.snapshotGeneration });
        else if (!node) {
          const existing = anchors.current.get(cableId);
          if (existing?.context === captured) {
            anchors.current.delete(cableId);
            if (pointerRow.current === cableId) pointerRow.current = null;
            if (focusRow.current === cableId) focusRow.current = null;
            if (dwellCandidate.current === cableId) stopDwell(); scheduleClose();
          }
        }
      } };
      anchorCallbacks.current.set(cableId, callback);
    }
    return {
      ref: callback.ref,
      'aria-haspopup': 'dialog', 'aria-keyshortcuts': 'Alt+Enter', 'aria-expanded': Boolean(open?.context === captured && open.cable.id === cableId),
      'aria-controls': open?.context === captured && open.cable.id === cableId ? id : undefined,
      onPointerEnter: event => { if (!valid()) return; suppressedFocus.current = null; pointerRow.current = cableId; startDwell(captured, generation, cableId, event.currentTarget); },
      onPointerLeave: () => { if (!valid()) return; if (pointerRow.current === cableId) pointerRow.current = null; if (focusRow.current !== cableId) stopDwell(); scheduleClose(); },
      onFocus: event => {
        if (!valid()) return; focusRow.current = cableId;
        if (suppressedFocus.current !== event.currentTarget) startDwell(captured, generation, cableId, event.currentTarget);
      },
      onBlur: event => {
        if (!valid()) return; if (focusRow.current === cableId) focusRow.current = null;
        if (suppressedFocus.current === event.currentTarget) suppressedFocus.current = null;
        if (pointerRow.current !== cableId) stopDwell(); scheduleClose();
      },
      onKeyDown: event => {
        if (!valid()) return;
        if (event.key === 'Enter' && event.altKey) {
          event.preventDefault(); event.stopPropagation(); suppressedFocus.current = null; openFor(captured, generation, cableId, event.currentTarget, true);
        } else if (event.key === 'Escape') {
          stopDwell();
          if (openRef.current?.context === captured) { event.preventDefault(); event.stopPropagation(); close(true); }
        }
      },
    };
  }, [context, options.snapshotGeneration, open, id]);
  const beforeRoute = useCallback((cableId: string) => {
    if (!eligible(context)) return; stopDwell();
    if (openRef.current?.context === context && openRef.current.cable.id !== cableId) close(false);
  }, [context]);

  let visible = open?.context === context && eligible(context) ? open : null;
  if (visible && options.readStatus === 'confirmed' && visible.generation !== options.snapshotGeneration) {
    const replacement = options.rows.find(row => row.id === visible!.cable.id);
    visible = tagged(replacement) && replacement.projectId === visible.cable.projectId ? { ...visible, cable: replacement, generation: options.snapshotGeneration,
      notice: sameData(visible.cable, replacement) ? visible.notice : 'Cable information was updated.', feedback: null, fallbackField: null } : null;
  }
  const currentPanel = (value: OpenPanel) => eligible(value.context) && openRef.current?.context === value.context
    && openRef.current.serial === value.serial && openRef.current.generation === value.generation && latest.current.options.snapshotGeneration === value.generation;
  const panelProps: CableInformationPanelProps | null = visible ? {
    id, cable: visible.cable, pinned: visible.pinned, readStatus: options.readStatus, anchor: visible.anchor.isConnected ? visible.anchor : null,
    anchorRect: visible.anchorRect, focusOnOpen: visible.focusOnOpen, notice: visible.notice, feedback: visible.feedback,
    fallbackField: visible.fallbackField, copyAttempt: visible.copyAttempt, allText: cableInformationText(visible.cable),
    onPointerEnter: () => { if (!currentPanel(visible!)) return; panelPointer.current = true; stopGrace(); },
    onPointerLeave: () => { if (!currentPanel(visible!)) return; panelPointer.current = false; scheduleClose(); },
    onFocus: () => { if (!currentPanel(visible!)) return; panelFocus.current = true; stopGrace(); },
    onBlur: event => { if (!currentPanel(visible!) || event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return; panelFocus.current = false; scheduleClose(); },
    onKeyDown: event => { if (event.key === 'Escape' && currentPanel(visible!)) { event.preventDefault(); event.stopPropagation(); close(true); } },
    onClose: () => { if (currentPanel(visible!)) close(true); },
    onTogglePin: () => {
      if (!currentPanel(visible!)) return; const value = openRef.current!; stopGrace(); publish({ ...value, pinned: !value.pinned });
      if (value.pinned) scheduleClose();
    },
    onCopy: field => {
      const captured = visible!; if (!currentPanel(captured)) return;
      const attempt = ++copySerial.current;
      const text = field === 'all' ? cableInformationText(captured.cable) : captured.cable[field] ?? '';
      publish({ ...openRef.current!, feedback: null, fallbackField: null, copyAttempt: attempt });
      void (async () => {
        let copied = false;
        try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; } } catch { /* Selectable text remains available. */ }
        if (copySerial.current !== attempt || !currentPanel(captured)) return;
        publish({ ...openRef.current!, feedback: copied ? 'Copied.' : 'Select the text and press Ctrl+C.', fallbackField: copied ? null : field, copyAttempt: attempt });
      })();
    },
  } : null;
  return { getRowProps, beforeRoute, panelProps };
}
