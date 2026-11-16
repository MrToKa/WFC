import { useCallback, useLayoutEffect, useRef, useState } from 'react';

type OwnedWindow = { window: Window; dispose: () => void; synchronize: () => void };

function copyPresentation(source: HTMLElement, destination: HTMLElement) {
  destination.className = source.className;
  for (const attribute of ['style', 'dir', 'lang']) {
    const value = source.getAttribute(attribute);
    if (value === null) destination.removeAttribute(attribute);
    else destination.setAttribute(attribute, value);
  }
}

function sheetSignature(source: Document) {
  return Array.from(source.styleSheets, sheet => {
    let count = -1;
    try { count = sheet.cssRules.length; } catch { /* Respect inaccessible stylesheets. */ }
    return JSON.stringify([sheet.href, sheet.disabled, sheet.media?.mediaText ?? '', count]);
  }).join('|');
}

function copyStyles(source: Document, destination: Document) {
  const fragment = destination.createDocumentFragment();
  for (const sheet of Array.from(source.styleSheets)) {
    const owner = sheet.ownerNode as HTMLElement | null;
    if (owner?.tagName === 'LINK') {
      const href = (owner as HTMLLinkElement).href;
      try { if (new URL(href, source.baseURI).origin !== new URL(source.URL).origin) continue; }
      catch { continue; }
      const link = destination.createElement('link');
      link.rel = 'stylesheet'; link.href = href; link.media = sheet.media?.mediaText ?? '';
      link.dataset.controlPanelStyle = 'true'; fragment.appendChild(link);
    } else {
      try {
        const style = destination.createElement('style');
        style.textContent = Array.from(sheet.cssRules, rule => rule.cssText).join('\n');
        style.media = sheet.media?.mediaText ?? '';
        style.dataset.controlPanelStyle = 'true'; fragment.appendChild(style);
      } catch { /* Do not grant access to inaccessible stylesheets. */ }
    }
  }
  for (const old of destination.head.querySelectorAll('[data-control-panel-style]')) old.remove();
  destination.head.appendChild(fragment);
}

/** Keep the portal destination constant: changing it would remount children and discard drafts. */
export function useControlPanelWindow(scopeKey: string) {
  const homeRef = useRef<HTMLDivElement>(null);
  const [contentHost] = useState(() => {
    const host = document.createElement('div');
    host.dataset.controlPanelHost = 'true';
    host.style.width = '100%'; host.style.minWidth = '0';
    host.style.boxSizing = 'border-box'; host.style.padding = '1rem';
    host.style.display = 'flex'; host.style.flexDirection = 'column'; host.style.gap = '1rem';
    return host;
  });
  const owned = useRef<OwnedWindow | null>(null);
  const mounted = useRef(false);
  const previousScope = useRef(scopeKey);
  const [popupDocument, setPopupDocument] = useState<Document>();
  const [notice, setNotice] = useState<string | null>(null);

  const resizeModel = useCallback(() => window.dispatchEvent(new Event('resize')), []);
  const moveHost = useCallback((destination: HTMLElement) => {
    const active = contentHost.ownerDocument.activeElement as HTMLElement | null;
    const focused = active && contentHost.contains(active) ? active : null;
    const positions = [contentHost, ...contentHost.querySelectorAll<HTMLElement>('*')]
      .filter(element => element.scrollTop || element.scrollLeft)
      .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
    destination.appendChild(contentHost);
    focused?.focus({ preventScroll: true });
    for (const { element, top, left } of positions) { element.scrollTop = top; element.scrollLeft = left; }
  }, [contentHost]);

  const restore = useCallback((close: boolean, update = true) => {
    const current = owned.current;
    owned.current = null;
    current?.dispose();
    // Move the host out before closing its document so uncontrolled fields and all React state survive.
    if (homeRef.current && contentHost.parentElement !== homeRef.current) moveHost(homeRef.current);
    if (close && current && !current.window.closed) current.window.close();
    if (update && mounted.current) setPopupDocument(undefined);
    resizeModel();
  }, [contentHost, moveHost, resizeModel]);

  const returnToPage = useCallback(() => { restore(true); setNotice(null); }, [restore]);
  const openInWindow = useCallback(() => {
    if (owned.current && !owned.current.window.closed) { owned.current.window.focus(); return; }
    if (owned.current) restore(false);
    if (!homeRef.current) return;
    let popup: Window | null = null;
    try { popup = window.open('about:blank', '_blank', 'popup=yes,width=1100,height=850,resizable=yes,scrollbars=yes'); }
    catch { /* Use the same inline fallback as a blocked popup. */ }
    if (!popup) {
      setNotice('The browser blocked the control panel window. Allow pop-ups for this site, then try again.');
      return;
    }
    try {
      const source = homeRef.current.ownerDocument;
      const target = popup.document;
      target.title = 'ACS App — Control panel';
      target.body.replaceChildren();
      let parent: HTMLElement = target.body;
      const ancestors: HTMLElement[] = [];
      for (let element = homeRef.current.parentElement; element && element !== source.body; element = element.parentElement) ancestors.unshift(element);
      const mirrors = ancestors.map(ancestor => {
        const mirror = target.createElement('div'); parent.appendChild(mirror); parent = mirror;
        return { ancestor, mirror };
      });
      let signature = '';
      const synchronize = () => {
        copyPresentation(source.documentElement, target.documentElement);
        copyPresentation(source.body, target.body);
        target.body.style.margin = '0'; target.body.style.minWidth = '0'; target.body.style.overflow = 'auto';
        const themeRoot = homeRef.current?.closest('.fui-FluentProvider') ?? source.body;
        const presentation = source.defaultView?.getComputedStyle(themeRoot);
        if (presentation) {
          target.body.style.backgroundColor = presentation.backgroundColor;
          target.body.style.color = presentation.color;
          target.body.style.fontFamily = presentation.fontFamily;
        }
        for (const { ancestor, mirror } of mirrors) {
          copyPresentation(ancestor, mirror); mirror.style.display = 'contents'; mirror.style.minWidth = '0';
        }
        copyStyles(source, target); signature = sheetSignature(source);
      };
      synchronize();
      const observer = new MutationObserver(synchronize);
      observer.observe(source.head, { subtree: true, childList: true, characterData: true, attributes: true });
      observer.observe(source.documentElement, { attributes: true }); observer.observe(source.body, { attributes: true });
      for (const { ancestor } of mirrors) observer.observe(ancestor, { attributes: true });
      const returned = () => {
        if (owned.current?.window !== popup) return;
        restore(false);
        if (mounted.current) setNotice('The control panel was returned to the main window. Your selections and unsaved changes are preserved.');
      };
      popup.addEventListener('pagehide', returned); popup.addEventListener('beforeunload', returned);
      popup.addEventListener('resize', resizeModel);
      const poll = window.setInterval(() => {
        if (popup.closed) returned();
        else if (sheetSignature(source) !== signature) synchronize();
      }, 500);
      owned.current = { window: popup, synchronize, dispose: () => {
        observer.disconnect(); window.clearInterval(poll);
        popup.removeEventListener('pagehide', returned); popup.removeEventListener('beforeunload', returned);
        popup.removeEventListener('resize', resizeModel);
      } };
      moveHost(parent);
      setPopupDocument(target); setNotice(null); popup.focus(); resizeModel();
    } catch {
      if (owned.current?.window === popup) restore(true);
      else if (!popup.closed) popup.close();
      setNotice('The control panel window could not be opened. Your selections and unsaved changes remain here.');
    }
  }, [moveHost, resizeModel, restore]);

  useLayoutEffect(() => {
    mounted.current = true;
    if (homeRef.current && !owned.current) homeRef.current.appendChild(contentHost);
    const leaving = () => restore(true, false);
    window.addEventListener('pagehide', leaving);
    return () => {
      mounted.current = false; window.removeEventListener('pagehide', leaving);
      restore(true, false); contentHost.remove();
    };
  }, [contentHost, restore]);

  // The loading/error branch may temporarily omit the home anchor; attach when it appears.
  useLayoutEffect(() => {
    if (homeRef.current && !owned.current && contentHost.parentElement !== homeRef.current) homeRef.current.appendChild(contentHost);
    owned.current?.synchronize();
  });
  useLayoutEffect(() => {
    if (previousScope.current !== scopeKey) { restore(true); setNotice(null); }
    previousScope.current = scopeKey;
  }, [scopeKey, restore]);

  return { homeRef, contentHost, detached: Boolean(popupDocument), popupDocument, openInWindow, returnToPage, notice };
}
