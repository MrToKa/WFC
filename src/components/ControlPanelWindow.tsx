import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, FluentProvider, PortalMountNodeProvider } from '@fluentui/react-components';
import { useControlPanelWindow } from '@/hooks/useControlPanelWindow';

const ControlPanelContext = createContext<(ReturnType<typeof useControlPanelWindow> & { actionsInPanel: boolean }) | null>(null);

export function useControlPanelDetached() {
  return useContext(ControlPanelContext)?.detached ?? false;
}

export function ControlPanelWindow({ scopeKey, children, actionsInPanel = false }: { scopeKey: string; children: (detached: boolean) => ReactNode; actionsInPanel?: boolean }) {
  const panel = useControlPanelWindow(scopeKey);
  return <ControlPanelContext.Provider value={{ ...panel, actionsInPanel }}>
    {(!actionsInPanel || panel.detached || panel.notice) ?
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
      {(!actionsInPanel || panel.detached) ? <Button onClick={panel.openInWindow}>Pop-up control panel</Button> : null}
      {panel.detached ? <Button onClick={panel.returnToPage}>Return to main window</Button> : null}
      {panel.notice ? <span role="status">{panel.notice}</span> : null}
    </div> : null}
    <div ref={panel.homeRef} style={{ display: 'none' }} />
    {createPortal(<div data-control-panel-order="-1">
      <FluentProvider targetDocument={panel.popupDocument ?? document} style={{ display: 'contents' }}>
        <Button onClick={panel.returnToPage}>Return to main window</Button>
      </FluentProvider>
    </div>, panel.contentHost)}
    {children(panel.detached)}
  </ControlPanelContext.Provider>;
}

/** Place the inline action in the active controls, immediately below project navigation. */
export function ControlPanelOpenButton() {
  const panel = useContext(ControlPanelContext);
  if (!panel?.actionsInPanel || panel.detached) return null;
  return <Button style={{ alignSelf: 'flex-start' }} onClick={panel.openInWindow}>Pop-up control panel</Button>;
}

/** Move only the stable DOM container. Changing a React portal target would discard child drafts. */
export function ControlPanelPart({ children, order, hidden = false, inlineOnly = false }: { children: ReactNode; order: number; hidden?: boolean; inlineOnly?: boolean }) {
  const panel = useContext(ControlPanelContext);
  const home = useRef<HTMLDivElement>(null);
  const [host] = useState(() => document.createElement('div'));
  const destination = panel?.detached && !inlineOnly ? panel.contentHost : null;
  useLayoutEffect(() => () => host.remove(), [host]);
  useLayoutEffect(() => {
    const parent = destination ?? home.current;
    if (!parent) return;
    host.dataset.controlPanelOrder = String(order);
    const next = destination ? Array.from(parent.children).find(child => child !== host && Number((child as HTMLElement).dataset.controlPanelOrder) > order) : null;
    if (host.parentNode !== parent) {
      const active = host.ownerDocument.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
      const focused = active && host.contains(active) ? active : null;
      const selection = focused && typeof focused.selectionStart === 'number'
        ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] as const : null;
      const scroll = [host, ...host.querySelectorAll<HTMLElement>('*')]
        .filter(element => element.scrollTop || element.scrollLeft)
        .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
      parent.insertBefore(host, next ?? null);
      focused?.focus({ preventScroll: true });
      if (focused && selection) focused.setSelectionRange(selection[0], selection[1], selection[2] ?? undefined);
      for (const { element, top, left } of scroll) { element.scrollTop = top; element.scrollLeft = left; }
    }
  }, [destination, host, order]);
  // Keep both wrappers and the portal identity stable through every round trip.
  host.style.display = hidden ? 'none' : destination ? 'flex' : 'contents';
  host.style.flexDirection = 'column';
  host.style.gap = '1rem';
  host.style.minWidth = '0';
  host.style.width = '100%';
  if (!panel) return <>{children}</>;
  return <div ref={home} style={{ display: 'contents' }}>
    {createPortal(<PortalMountNodeProvider value={host}><FluentProvider targetDocument={destination ? panel.popupDocument : document} style={{ display: 'contents' }}>
      {children}
    </FluentProvider></PortalMountNodeProvider>, host)}
  </div>;
}
