import { generateId } from '@/utils/generateId';
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

export type FloatingCableWindowRequest = { window: Window | null; blocked: boolean; id: string };
type WindowOptions = { title: string; width?: number; height?: number };
type ScopeKey = string | object;
type Position = { left: number; top: number };
type Child = { window: Window; target: HTMLElement; scopeKey: ScopeKey; synchronize: () => void; dispose: () => void };
type Options = { open: boolean; title: string; scopeKey: ScopeKey; width?: number; preferredTop?: number;
  onInteract?: () => void; requestedPopup?: FloatingCableWindowRequest | null };

/** Call synchronously from the cable click, before rendering the selected panel. */
export function requestFloatingCableWindow(options: WindowOptions, existing?: FloatingCableWindowRequest | null): FloatingCableWindowRequest {
  try {
    if (existing?.window && !existing.window.closed) { existing.window.focus(); return existing; }
  } catch { return { window: null, blocked: true, id: generateId() }; }
  let child: Window | null = null;
  try {
    child = window.open('about:blank', '_blank', `popup=yes,width=${options.width ?? 520},height=${options.height ?? 780},resizable=yes,scrollbars=yes`);
    if (child) child.document.title = options.title;
  } catch {
    child?.close();
    child = null;
  }
  return { window: child, blocked: child === null, id: generateId() };
}

function copyAttributes(source: HTMLElement, destination: HTMLElement) {
  destination.className = source.className;
  for (const attribute of ['style', 'dir', 'lang']) {
    const value = source.getAttribute(attribute);
    if (value === null) destination.removeAttribute(attribute); else destination.setAttribute(attribute, value);
  }
}

/** Griffel inserts rules without a DOM mutation; inspect counts without serializing the sheets on every tick. */
function styleSheetSignature(source: Document): string {
  return Array.from(source.styleSheets, sheet => {
    let ruleCount = -1;
    try { ruleCount = sheet.cssRules.length; } catch { /* Respect inaccessible stylesheets. */ }
    return JSON.stringify([sheet.href, sheet.disabled, sheet.media?.mediaText ?? '', ruleCount]);
  }).join('|');
}

/** Inline CSSOM rules include Griffel's insertRule styles even when style.textContent is empty. */
function synchronizeStyles(source: Document, destination: Document) {
  const fragment = destination.createDocumentFragment();
  for (const sheet of Array.from(source.styleSheets)) {
    const owner = sheet.ownerNode as HTMLElement | null;
    if (owner?.tagName === 'LINK') {
      const href = (owner as HTMLLinkElement).href;
      try {
        if (new URL(href, source.baseURI).origin !== new URL(source.URL).origin) continue;
      } catch { continue; }
      const link = destination.createElement('link');
      link.rel = 'stylesheet'; link.href = href; link.media = sheet.media?.mediaText ?? '';
      link.dataset.floatingCableStyle = 'true'; fragment.appendChild(link);
    } else {
      try {
        const style = destination.createElement('style');
        style.dataset.floatingCableStyle = 'true'; style.media = sheet.media?.mediaText ?? '';
        style.textContent = Array.from(sheet.cssRules, rule => rule.cssText).join('\n');
        fragment.appendChild(style);
      } catch { /* A stylesheet unavailable to the opener cannot be granted to the popup. */ }
    }
  }
  for (const previous of Array.from(destination.head.querySelectorAll('[data-floating-cable-style]'))) previous.remove();
  destination.head.appendChild(fragment);
}

function interactiveTarget(target: EventTarget | null, handle: HTMLElement) {
  const element = target as Element | null;
  const control = element?.nodeType === 1 ? element.closest('button,a,input,select,textarea,[contenteditable="true"],[role="button"],[role="link"]') : null;
  return control !== null && control !== handle;
}

/** A portal keeps the existing React state and protected Viewer bridge in the opener. */
export function useFloatingCablePanel({ open, title, scopeKey, width = 420, preferredTop = 112, onInteract, requestedPopup }: Options) {
  const panelRef = useRef<HTMLDivElement>(null);
  const childRef = useRef<Child | null>(null), mounted = useRef(false), previousScope = useRef(scopeKey);
  const [child, setChild] = useState<Child | null>(null), [position, setPosition] = useState<Position | null>(null), [notice, setNotice] = useState<string | null>(null);
  const latest = useRef({ open, scopeKey, onInteract }); latest.current = { open, scopeKey, onInteract };
  const consumedRequest = useRef<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number; handle: HTMLElement } | null>(null);

  const endDrag = useCallback(() => {
    const current = drag.current; drag.current = null;
    if (current) { try { current.handle.releasePointerCapture(current.pointerId); } catch { /* Capture may already have been released. */ } }
  }, []);
  const closeChild = useCallback((update = true) => {
    const current = childRef.current; childRef.current = null;
    if (current) { current.dispose(); if (!current.window.closed) current.window.close(); }
    if (update && mounted.current) setChild(null);
  }, []);
  const adopt = useCallback((request: FloatingCableWindowRequest) => {
    if (!latest.current.open) { request.window?.close(); return; }
    if (request.blocked || !request.window || request.window.closed) {
      setNotice('The browser blocked the separate window. Allow pop-ups for this site, or continue using this panel here.'); return;
    }
    if (childRef.current?.window === request.window) { request.window.focus(); return; }
    closeChild(); endDrag();
    const popup = request.window, source = panelRef.current?.ownerDocument ?? document;
    try {
      const targetDocument = popup.document;
      targetDocument.title = title;
      const ancestors: HTMLElement[] = [];
      for (let current = panelRef.current?.parentElement; current && current !== source.body; current = current.parentElement) ancestors.unshift(current);
      targetDocument.body.replaceChildren();
      let parent: HTMLElement = targetDocument.body;
      const mirrors = ancestors.map(ancestor => {
        const mirror = targetDocument.createElement('div'); parent.appendChild(mirror); parent = mirror;
        return { ancestor, mirror };
      });
      const target = targetDocument.createElement('div'); target.dataset.floatingCablePanel = 'true'; parent.appendChild(target);
      let copiedStyleSignature = '';
      const synchronize = () => {
        copyAttributes(source.documentElement, targetDocument.documentElement); copyAttributes(source.body, targetDocument.body);
        targetDocument.body.style.margin = '0'; targetDocument.body.style.minWidth = '0'; targetDocument.body.style.overflow = 'auto';
        for (const { ancestor, mirror } of mirrors) { copyAttributes(ancestor, mirror); mirror.style.display = 'contents'; mirror.style.minWidth = '0'; }
        synchronizeStyles(source, targetDocument);
        copiedStyleSignature = styleSheetSignature(source);
      };
      synchronize();
      const observer = new MutationObserver(synchronize);
      observer.observe(source.head, { subtree: true, childList: true, characterData: true, attributes: true });
      observer.observe(source.documentElement, { attributes: true }); observer.observe(source.body, { attributes: true });
      for (const { ancestor } of mirrors) observer.observe(ancestor, { attributes: true });
      const returned = () => {
        if (childRef.current?.window !== popup) return;
        const owned = childRef.current; childRef.current = null; owned.dispose();
        if (mounted.current) { setChild(null); setNotice('The cable window was closed. Your current selections remain in this panel.'); }
      };
      popup.addEventListener('pagehide', returned); popup.addEventListener('beforeunload', returned);
      const poll = window.setInterval(() => {
        if (popup.closed) returned();
        else if (styleSheetSignature(source) !== copiedStyleSignature) synchronize();
      }, 500);
      const owned: Child = { window: popup, target, scopeKey: latest.current.scopeKey, synchronize,
        dispose: () => { observer.disconnect(); window.clearInterval(poll); popup.removeEventListener('pagehide', returned); popup.removeEventListener('beforeunload', returned); } };
      childRef.current = owned; setChild(owned); setNotice(null); popup.focus();
    } catch {
      popup.close(); setNotice('The separate window could not be opened. Your current selections remain in this panel.');
    }
  }, [closeChild, endDrag, title]);

  useLayoutEffect(() => {
    mounted.current = true;
    const leaving = () => closeChild(false);
    window.addEventListener('pagehide', leaving);
    return () => { mounted.current = false; window.removeEventListener('pagehide', leaving); endDrag(); closeChild(false); };
  }, [closeChild, endDrag]);
  useLayoutEffect(() => {
    if (!open || previousScope.current !== scopeKey) { closeChild(); endDrag(); }
    if (previousScope.current !== scopeKey) { setPosition(null); setNotice(null); }
    previousScope.current = scopeKey;
  }, [open, scopeKey, closeChild, endDrag]);
  useLayoutEffect(() => {
    if (!open || !requestedPopup || consumedRequest.current === requestedPopup.id) return;
    consumedRequest.current = requestedPopup.id; adopt(requestedPopup);
  }, [open, requestedPopup, adopt]);
  // React updates can insert CSSOM rules without a DOM mutation, so refresh after commits too.
  useLayoutEffect(() => { childRef.current?.synchronize(); if (childRef.current) childRef.current.window.document.title = title; });

  const clamp = useCallback((candidate: Position): Position => {
    const rect = panelRef.current?.getBoundingClientRect();
    return { left: Math.max(8, Math.min(candidate.left, Math.max(8, window.innerWidth - (rect?.width || width) - 8))),
      top: Math.max(8, Math.min(candidate.top, Math.max(8, window.innerHeight - Math.min(rect?.height || 96, 96) - 8))) };
  }, [width]);
  useLayoutEffect(() => {
    const resize = () => setPosition(previous => previous ? clamp(previous) : null);
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, [clamp]);
  const resetPosition = useCallback(() => { latest.current.onInteract?.(); endDrag(); setPosition(null); }, [endDrag]);
  const returnToPage = useCallback(() => { latest.current.onInteract?.(); closeChild(); setNotice(null); }, [closeChild]);
  const openInWindow = useCallback(() => {
    latest.current.onInteract?.();
    const existing = childRef.current ? { window: childRef.current.window, blocked: false, id: 'current-window' } : null;
    adopt(requestFloatingCableWindow({ title, width: Math.max(420, width + 40) }, existing));
  }, [adopt, title, width]);
  const detached = Boolean(open && child && child.scopeKey === scopeKey && !child.window.closed);
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (detached || event.button !== 0 || interactiveTarget(event.target, event.currentTarget)) return;
    const rect = panelRef.current?.getBoundingClientRect(); if (!rect) return;
    latest.current.onInteract?.(); event.preventDefault();
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, handle: event.currentTarget };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { endDrag(); }
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
    setPosition(clamp({ left: current.left + event.clientX - current.x, top: current.top + event.clientY - current.y }));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (detached || interactiveTarget(event.target, event.currentTarget) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Home') { event.preventDefault(); resetPosition(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const rect = panelRef.current?.getBoundingClientRect(); if (!rect) return;
    event.preventDefault(); latest.current.onInteract?.(); const step = event.shiftKey ? 30 : 10;
    setPosition(clamp({ left: rect.left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      top: rect.top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) }));
  };
  const panelStyle: CSSProperties = detached
    ? { position: 'relative', inset: 'auto', width: '100%', minWidth: 0, minHeight: '100vh', maxWidth: 'none', maxHeight: 'none', margin: 0, overflow: 'visible' }
    : { position: 'fixed', ...(position ? { left: position.left, top: position.top, right: 'auto' } : { right: 16, top: Math.max(8, Math.min(preferredTop, window.innerHeight - 104)) }),
      width, maxWidth: 'calc(100vw - 16px)', minWidth: 0, maxHeight: 'calc(100vh - 16px)', overflow: 'auto' };
  return { panelRef, portalTarget: detached ? child!.target : null, isPoppedOut: detached, panelStyle,
    dragHandleProps: { tabIndex: detached ? -1 : 0, role: 'group', 'aria-label': 'Move cable panel. Use arrow keys to move and Home to reset.',
      style: { cursor: detached ? 'default' : 'move', touchAction: 'none' } as CSSProperties,
      onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag, onKeyDown },
    openInWindow, returnToPage, resetPosition, notice };
}
