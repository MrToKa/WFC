import { useState } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestFloatingCableWindow, useFloatingCablePanel, type FloatingCableWindowRequest } from './useFloatingCablePanel';

const frames: HTMLIFrameElement[] = [];
function popupWindow() {
  const iframe = document.createElement('iframe'); document.body.appendChild(iframe); frames.push(iframe);
  const child = iframe.contentWindow!;
  Object.defineProperty(child, 'closed', { configurable: true, writable: true, value: false });
  child.focus = vi.fn();
  child.close = vi.fn(() => {
    Object.defineProperty(child, 'closed', { configurable: true, writable: true, value: true });
    const event = child.document.createEvent('Event'); event.initEvent('beforeunload', false, false); child.dispatchEvent(event);
  });
  return child;
}
function attachPanel(hook: { result: { current: ReturnType<typeof useFloatingCablePanel> } }) {
  const element = document.createElement('div'); document.body.appendChild(element);
  element.getBoundingClientRect = () => ({ left: 100, top: 120, width: 420, height: 600, right: 520, bottom: 720, x: 100, y: 120, toJSON: () => ({}) });
  hook.result.current.panelRef.current = element;
  return element;
}
function Harness({ open = true, scopeKey = 'account-session-project', requestedPopup }: { open?: boolean; scopeKey?: string; requestedPopup?: FloatingCableWindowRequest }) {
  const [draft, setDraft] = useState('current draft');
  const floating = useFloatingCablePanel({ open, title: 'Selected cable', scopeKey, requestedPopup });
  if (!open) return null;
  const panel = <div ref={floating.panelRef} style={floating.panelStyle} data-testid="cable-panel">
    <div {...floating.dragHandleProps}>Cable title <button type="button">Unrelated button</button></div>
    <label>Draft <input value={draft} onChange={event => setDraft(event.target.value)} /></label>
    <button type="button" onClick={floating.openInWindow}>Separate window</button>
    <button type="button" onClick={floating.returnToPage}>Return to page</button>
    {floating.notice && <p role="status">{floating.notice}</p>}
  </div>;
  return createPortal(panel, floating.portalTarget ?? document.body);
}
afterEach(() => {
  cleanup(); frames.splice(0).forEach(frame => frame.remove());
  document.head.querySelectorAll('[data-test-floating-style]').forEach(element => element.remove());
  document.body.className = ''; document.documentElement.removeAttribute('dir');
  vi.restoreAllMocks(); vi.useRealTimers();
});

describe('floating cable window ownership', () => {
  it('opens only from the explicit click helper and reuses a live requested window', () => {
    const popup = popupWindow(), open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const view = renderHook(() => useFloatingCablePanel({ open: true, title: 'Cable', scopeKey: 'scope' }));
    expect(open).not.toHaveBeenCalled();
    const request = requestFloatingCableWindow({ title: 'Cable A' });
    expect(open).toHaveBeenCalledWith('about:blank', '_blank', expect.stringContaining('popup=yes'));
    expect(popup.document.title).toBe('Cable A');
    expect(requestFloatingCableWindow({ title: 'Cable B' }, request)).toBe(request);
    expect(open).toHaveBeenCalledOnce();
    view.unmount(); popup.close();
  });
  it('adopts a synchronously requested window without opening another one', () => {
    const popup = popupWindow(), open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const request = requestFloatingCableWindow({ title: 'Cable' });
    const view = renderHook(() => useFloatingCablePanel({ open: true, title: 'Cable', scopeKey: 'scope', requestedPopup: request }));
    expect(view.result.current.isPoppedOut).toBe(true);
    expect(view.result.current.portalTarget?.ownerDocument).toBe(popup.document);
    expect(open).toHaveBeenCalledOnce();
    view.unmount(); expect(popup.close).toHaveBeenCalledOnce();
  });
  it('keeps the controlled draft in the opener while detaching, editing, and returning', () => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'assigned From' } });
    fireEvent.click(screen.getByRole('button', { name: 'Separate window' }));
    expect(document.body.querySelector('[data-testid="cable-panel"]')).toBeNull();
    const draft = popup.document.querySelector('input')!;
    expect(draft.value).toBe('assigned From');
    fireEvent.change(draft, { target: { value: 'assigned From and To' } });
    const returnButton = [...popup.document.querySelectorAll('button')].find(button => button.textContent === 'Return to page')!;
    fireEvent.click(returnButton);
    expect(screen.getByLabelText('Draft')).toHaveValue('assigned From and To');
    expect(popup.close).toHaveBeenCalledOnce();
  });
  it('copies CSSOM-inserted Griffel rules and theme ancestors without copying app markup or scripts', () => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    const style = document.createElement('style'); style.dataset.testFloatingStyle = 'true'; document.head.appendChild(style);
    style.sheet!.insertRule('.fui-test-theme { --colorNeutralForeground1: rgb(1, 2, 3); }', 0);
    document.body.className = 'app-theme'; document.documentElement.dir = 'rtl';
    const view = renderHook(() => useFloatingCablePanel({ open: true, title: 'Cable', scopeKey: 'scope' }));
    const panel = attachPanel(view), provider = document.createElement('div'); provider.className = 'fui-test-theme';
    panel.replaceWith(provider); provider.appendChild(panel);
    act(() => view.result.current.openInWindow());
    expect(popup.document.body.className).toBe('app-theme'); expect(popup.document.documentElement.dir).toBe('rtl');
    expect(popup.document.querySelector('.fui-test-theme')).not.toBeNull();
    expect(popup.document.head.textContent).toContain('--colorNeutralForeground1');
    expect(popup.document.querySelector('script')).toBeNull(); expect(popup.document.querySelector('iframe')).toBeNull();
    style.sheet!.insertRule('.new-griffel-rule { color: purple; }', 1);
    view.rerender(); expect(popup.document.head.textContent).toContain('.new-griffel-rule');
    view.unmount(); provider.remove();
  });
  it('copies rules inserted by a descendant without rerendering the floating owner', () => {
    vi.useFakeTimers();
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    const style = document.createElement('style'); style.dataset.testFloatingStyle = 'true'; document.head.appendChild(style);
    style.sheet!.insertRule('.before-descendant-update { color: blue; }', 0);
    const rendered = vi.fn();
    const view = renderHook(() => { rendered(); return useFloatingCablePanel({ open: true, title: 'Cable', scopeKey: 'scope' }); });
    act(() => view.result.current.openInWindow());
    const commits = rendered.mock.calls.length;
    style.sheet!.insertRule('.late-descendant-spinner { color: purple; }', 1);
    expect(popup.document.head.textContent).not.toContain('.late-descendant-spinner');
    act(() => vi.advanceTimersByTime(500));
    expect(popup.document.head.textContent).toContain('.late-descendant-spinner');
    expect(rendered).toHaveBeenCalledTimes(commits);
    const copiedStyle = popup.document.head.querySelector('[data-floating-cable-style]');
    act(() => vi.advanceTimersByTime(500));
    expect(popup.document.head.querySelector('[data-floating-cable-style]')).toBe(copiedStyle);
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it('shows an actionable inline fallback when popup creation is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Separate window' }));
    expect(screen.getByRole('status')).toHaveTextContent('Allow pop-ups for this site');
    expect(screen.getByLabelText('Draft')).toHaveValue('current draft');
  });
  it('retains the inline draft when the user closes the separate window', () => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<Harness />); fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'pending Save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Separate window' }));
    act(() => popup.close());
    expect(screen.getByLabelText('Draft')).toHaveValue('pending Save');
    expect(screen.getByRole('status')).toHaveTextContent('current selections remain');
  });
  it.each(['hidden', 'account-changed', 'unmounted'] as const)('closes and clears the owned native window when %s', mode => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    const view = render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Separate window' }));
    if (mode === 'hidden') view.rerender(<Harness open={false} />);
    else if (mode === 'account-changed') view.rerender(<Harness scopeKey="new-account" />);
    else view.unmount();
    expect(popup.close).toHaveBeenCalledOnce(); expect(popup.document.querySelector('[data-testid="cable-panel"]')).toBeNull();
  });
  it('closes its owned native window when the opener leaves', () => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    const view = renderHook(() => useFloatingCablePanel({ open: true, title: 'Cable', scopeKey: 'scope' }));
    act(() => view.result.current.openInWindow()); act(() => window.dispatchEvent(new Event('pagehide')));
    expect(popup.close).toHaveBeenCalledOnce(); view.unmount();
  });
  it('polls only its own window to recover from a close without an unload event', () => {
    vi.useFakeTimers(); const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    const view = renderHook(() => useFloatingCablePanel({ open: true, title: 'Cable', scopeKey: 'scope' }));
    act(() => view.result.current.openInWindow());
    Object.defineProperty(popup, 'closed', { value: true }); act(() => vi.advanceTimersByTime(500));
    expect(view.result.current.portalTarget).toBeNull(); expect(view.result.current.notice).toContain('was closed');
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('inline panel movement', () => {
  it('moves with arrow keys, clamps to the viewport and offers Home reset', () => {
    const view = renderHook(() => useFloatingCablePanel({ open: true, title: 'Cable', scopeKey: 'scope' }));
    const panel = attachPanel(view), handle = document.createElement('div'); panel.appendChild(handle);
    const key = (value: string) => ({ key: value, target: handle, currentTarget: handle, preventDefault: vi.fn(), altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
    act(() => view.result.current.dragHandleProps.onKeyDown(key('ArrowRight') as never));
    expect(view.result.current.panelStyle.left).toBe(110);
    panel.getBoundingClientRect = () => ({ left: -100, top: -100, width: 420, height: 600, right: 320, bottom: 500, x: -100, y: -100, toJSON: () => ({}) });
    act(() => view.result.current.dragHandleProps.onKeyDown(key('ArrowLeft') as never));
    expect(view.result.current.panelStyle.left).toBe(8); expect(view.result.current.panelStyle.top).toBe(8);
    act(() => view.result.current.dragHandleProps.onKeyDown(key('Home') as never));
    expect(view.result.current.panelStyle.right).toBe(16); view.unmount(); panel.remove();
  });
  it('uses pointer capture, ignores controls, and releases capture on cancellation', () => {
    const onInteract = vi.fn(), view = renderHook(() => useFloatingCablePanel({ open: true, title: 'Cable', scopeKey: 'scope', onInteract }));
    const panel = attachPanel(view), handle = document.createElement('div'), button = document.createElement('button');
    panel.appendChild(handle); handle.appendChild(button); handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn();
    const pointer = (target: HTMLElement, x = 10, y = 20) => ({ target, currentTarget: handle, button: 0, pointerId: 7, clientX: x, clientY: y, preventDefault: vi.fn() });
    act(() => view.result.current.dragHandleProps.onPointerDown(pointer(button) as never));
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
    act(() => view.result.current.dragHandleProps.onPointerDown(pointer(handle) as never));
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    act(() => view.result.current.dragHandleProps.onPointerMove(pointer(handle, 40, 50) as never));
    expect(view.result.current.panelStyle).toMatchObject({ left: 130, top: 150 });
    act(() => view.result.current.dragHandleProps.onPointerCancel());
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(7); expect(onInteract).toHaveBeenCalledOnce();
    act(() => view.result.current.dragHandleProps.onPointerMove(pointer(handle, 90, 90) as never));
    expect(view.result.current.panelStyle).toMatchObject({ left: 130, top: 150 });
    view.unmount(); panel.remove();
  });
});
