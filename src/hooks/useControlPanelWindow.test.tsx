import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useControlPanelWindow } from './useControlPanelWindow';

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

function Draft({ onMount }: { onMount?: () => void }) {
  const [value, setValue] = useState('initial');
  useEffect(() => { onMount?.(); }, [onMount]);
  return <>
    <label>Draft<input aria-label="Draft" value={value} onChange={event => setValue(event.target.value)} /></label>
    <label>Uncontrolled<input aria-label="Uncontrolled" defaultValue="uncontrolled" /></label>
    <label>Selected section<select aria-label="Selected section" defaultValue="routes"><option value="routes">Routes</option><option value="path">Path</option></select></label>
  </>;
}
function Harness({ scope = 'project-account-session', onMount }: { scope?: string; onMount?: () => void }) {
  const panel = useControlPanelWindow(scope);
  return <>
    <button onClick={panel.openInWindow}>Pop-up control panel</button>
    <div data-testid="home" ref={panel.homeRef} />
    <span data-testid="detached">{String(panel.detached)}</span>
    {panel.notice && <p role="status">{panel.notice}</p>}
    {createPortal(<div data-testid="panel">
      <Draft onMount={onMount} />
      <button onClick={panel.returnToPage}>Return to main window</button>
    </div>, panel.contentHost)}
  </>;
}

afterEach(() => {
  cleanup(); frames.splice(0).forEach(frame => frame.remove());
  document.head.querySelectorAll('[data-test-control-style]').forEach(element => element.remove());
  document.body.className = ''; document.documentElement.removeAttribute('dir');
  vi.restoreAllMocks(); vi.useRealTimers();
});

describe('stable control panel window', () => {
  it('moves the same mounted DOM and preserves controlled and uncontrolled drafts, selection, and edits in both directions', () => {
    const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    const mounted = vi.fn(); render(<Harness onMount={mounted} />);
    const original = screen.getByTestId('panel');
    const input = screen.getByLabelText('Draft');
    fireEvent.change(input, { target: { value: 'unsaved main draft' } });
    fireEvent.change(screen.getByLabelText('Uncontrolled'), { target: { value: 'local browser value' } });
    fireEvent.change(screen.getByLabelText('Selected section'), { target: { value: 'path' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    const child = within(popup.document.body);
    expect(child.getByTestId('panel')).toBe(original);
    expect(child.getByLabelText('Draft')).toBe(input);
    expect((input as HTMLInputElement).value).toBe('unsaved main draft');
    expect((child.getByLabelText('Uncontrolled') as HTMLInputElement).value).toBe('local browser value');
    expect((child.getByLabelText('Selected section') as HTMLSelectElement).value).toBe('path');
    expect(screen.getByTestId('home')).toBeEmptyDOMElement();
    expect(screen.getByTestId('detached')).toHaveTextContent('true');
    fireEvent.change(input, { target: { value: 'edited in popup' } });
    fireEvent.click(child.getByRole('button', { name: 'Return to main window' }));
    expect(screen.getByTestId('panel')).toBe(original);
    expect(screen.getByLabelText('Draft')).toHaveValue('edited in popup');
    expect(mounted).toHaveBeenCalledOnce();
    expect(popup.close).toHaveBeenCalledOnce();
    expect(screen.getByTestId('detached')).toHaveTextContent('false');
  });

  it('reuses the existing popup and restores the same nodes when its native close button is used', () => {
    const popup = popupWindow(), open = vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<Harness />);
    const original = screen.getByTestId('panel');
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    expect(open).toHaveBeenCalledOnce();
    expect(popup.focus).toHaveBeenCalledTimes(2);
    fireEvent.change(within(popup.document.body).getByLabelText('Draft'), { target: { value: 'not yet saved' } });
    act(() => popup.close());
    expect(screen.getByTestId('panel')).toBe(original);
    expect(screen.getByLabelText('Draft')).toHaveValue('not yet saved');
    expect(screen.getByRole('status')).toHaveTextContent('unsaved changes are preserved');
  });

  it('keeps the existing panel inline if blocked and opens only on the explicit button click', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Harness />); const original = screen.getByTestId('panel');
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    expect(screen.getByTestId('panel')).toBe(original);
    expect(screen.getByRole('status')).toHaveTextContent('Allow pop-ups for this site');
  });

  it.each(['scope change', 'unmount', 'opener exit'])('cleans up its window on %s', reason => {
    vi.useFakeTimers(); const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    if (reason === 'scope change') view.rerender(<Harness scope="new-project-account-session" />);
    else if (reason === 'unmount') view.unmount();
    else act(() => window.dispatchEvent(new Event('pagehide')));
    expect(popup.close).toHaveBeenCalledOnce();
    expect(popup.document.querySelector('[data-control-panel-host]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers from a close without lifecycle events using its bounded close detector', () => {
    vi.useFakeTimers(); const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    render(<Harness />); const original = screen.getByTestId('panel');
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    Object.defineProperty(popup, 'closed', { value: true });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByTestId('panel')).toBe(original);
    expect(screen.getByTestId('detached')).toHaveTextContent('false');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('copies live CSSOM rules and theme ancestors without adding scripts or a second app', async () => {
    vi.useFakeTimers(); const popup = popupWindow(); vi.spyOn(window, 'open').mockReturnValue(popup);
    const style = document.createElement('style'); style.dataset.testControlStyle = 'true'; document.head.appendChild(style);
    style.sheet!.insertRule('.control-theme { --colorNeutralBackground1: black; }', 0);
    document.body.className = 'dark-theme'; document.documentElement.dir = 'rtl';
    const view = render(<div className="control-theme"><Harness /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up control panel' }));
    expect(popup.document.title).toBe('ACS App — Control panel');
    expect(popup.document.body.className).toBe('dark-theme');
    expect(popup.document.documentElement.dir).toBe('rtl');
    expect(popup.document.querySelector('.control-theme')).not.toBeNull();
    expect(popup.document.head.textContent).toContain('--colorNeutralBackground1');
    expect(popup.document.querySelector('script, iframe')).toBeNull();
    style.sheet!.insertRule('.late-popup-rule { color: purple; }', 1);
    act(() => vi.advanceTimersByTime(500));
    expect(popup.document.head.textContent).toContain('.late-popup-rule');
    const copied = popup.document.head.querySelector('[data-control-panel-style]');
    act(() => vi.advanceTimersByTime(500));
    expect(popup.document.head.querySelector('[data-control-panel-style]')).toBe(copied);
    await act(async () => { document.body.className = 'light-theme'; });
    expect(popup.document.body.className).toBe('light-theme');
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});
