import { createRef } from 'react';
import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CableInformationPanel } from './CableInformationPanel';
import { useCableInformationPanel, type CableInformationRecord, type UseCableInformationPanelOptions } from './hooks/useCableInformationPanel';

const a = '22222222-2222-4222-8222-222222222222', b = '33333333-3333-4333-8333-333333333333', projectId = '11111111-1111-4111-8111-111111111111';
const original: CableInformationRecord = { id: a, projectId, tag: '  Ａ <Cable> ', fromLocation: '  FROM\n<script>literal</script>  ', toLocation: null, routing: '/ A /\n/SECONDARY/Ｂ  ' };
const scope = {};
const route = vi.fn();
function Harness({ changes = {}, dark = false, routeReady = true }: { changes?: Partial<UseCableInformationPanelOptions>; dark?: boolean; routeReady?: boolean }) {
  const searchRef = createRef<HTMLInputElement>();
  const options: UseCableInformationPanelOptions = { scopeIdentity: scope, active: true, lifecycleIdentity: 'load-a', snapshotGeneration: 1, rows: [original, { ...original, id: b, tag: 'B', fromLocation: 'B FROM' }], readStatus: 'confirmed', searchRef, ...changes };
  const information = useCableInformationPanel(options);
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
    <input aria-label="Search cable tags" ref={searchRef} />
    {options.rows.map(cable => <button key={cable.id} {...information.getRowProps(cable.id)} aria-disabled={!routeReady}
      onClick={event => { information.openPinned(cable.id, event.currentTarget); if (!routeReady) return; information.beforeRoute(cable.id); route(cable.id); }}>{cable.tag}</button>)}
    {information.panelProps ? <CableInformationPanel {...information.panelProps} /> : null}
  </FluentProvider>;
}
const open = () => { const row = screen.getByRole('button', { name: 'Ａ <Cable>' }); fireEvent.pointerEnter(row); act(() => vi.advanceTimersByTime(1000)); return row; };
beforeEach(() => { vi.useFakeTimers(); route.mockReset(); vi.spyOn(window, 'open').mockReturnValue(null); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('interactive nonmodal cable information portal', () => {
  it('renders native cable information with the application theme and retains its values on return', () => {
    const frame = document.createElement('iframe'); document.body.appendChild(frame); const popup = frame.contentWindow!;
    Object.defineProperty(popup, 'closed', { configurable: true, value: false }); popup.focus = vi.fn(); popup.close = vi.fn();
    vi.mocked(window.open).mockReturnValue(popup);
    const view = render(<Harness dark />); fireEvent.click(screen.getByRole('button', { name: 'Ａ <Cable>' }));
    const child = within(popup.document.body), dialog = child.getByRole('dialog', { name: 'Ａ <Cable>' }), provider = dialog.closest('.fui-FluentProvider')!;
    expect(popup.getComputedStyle(provider).getPropertyValue('--colorNeutralBackground1')).toBe(webDarkTheme.colorNeutralBackground1);
    expect(popup.getComputedStyle(dialog).display).toBe('flex');
    expect(child.getByRole('textbox', { name: 'From' })).toHaveValue(original.fromLocation);
    fireEvent.click(child.getByRole('button', { name: 'Return to page' })); expect(popup.close).toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'From' })).toHaveValue(original.fromLocation);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-pinned', 'true');
    expect(route).toHaveBeenCalledExactlyOnceWith(a); view.unmount(); frame.remove();
  });
  it('renders one titled nonmodal dialog with exact readonly values after1000ms, without hover autofocus or any route action', () => {
    render(<Harness />); const search = screen.getByRole('textbox', { name: 'Search cable tags' }); search.focus(); open();
    const dialog = screen.getByRole('dialog', { name: 'Ａ <Cable>' });
    expect(dialog).toHaveAttribute('aria-modal', 'false'); expect(dialog).toHaveAttribute('data-cable-id', a); expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getByRole('heading', { name: 'Ａ <Cable>', level: 3 })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'From' })).toHaveValue(original.fromLocation);
    expect(within(dialog).getByRole('textbox', { name: 'To' })).toHaveValue('');
    expect(within(dialog).getByRole('textbox', { name: 'Routing' })).toHaveValue(original.routing);
    for (const field of ['From', 'To', 'Routing']) expect(within(dialog).getByRole('textbox', { name: field })).toHaveAttribute('readonly');
    expect(dialog.querySelector('script')).toBeNull(); expect(search).toHaveFocus(); expect(route).not.toHaveBeenCalled();
    expect(dialog.closest('[data-portal-node]')).not.toBeNull();
    expect(window.open).not.toHaveBeenCalled();
  });
  it('provides the keyboard information path even while route activation is unavailable', () => {
    render(<Harness routeReady={false} />); const row = screen.getByRole('button', { name: 'Ａ <Cable>' });
    expect(row).not.toBeDisabled(); expect(row).toHaveAttribute('aria-disabled', 'true'); fireEvent.click(row); expect(route).not.toHaveBeenCalled();
    fireEvent.keyDown(row, { key: 'Enter', altKey: true }); expect(screen.getByRole('dialog')).toHaveFocus(); expect(route).not.toHaveBeenCalled();
  });
  it('retains a selectable field while moving into the panel, and Pin/Copy/Close cannot bubble to row routing', async () => {
    const writeText = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<Harness />); const row = open(); const dialog = screen.getByRole('dialog'); fireEvent.pointerLeave(row); act(() => vi.advanceTimersByTime(149)); fireEvent.pointerEnter(dialog);
    const text = within(dialog).getByRole('textbox', { name: 'From' }) as HTMLTextAreaElement; text.focus(); text.select();
    expect(text.selectionStart).toBe(0); expect(text.selectionEnd).toBe(original.fromLocation!.length); act(() => vi.advanceTimersByTime(1000)); expect(dialog).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pin' })); expect(dialog).toHaveAttribute('data-pinned', 'true');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Copy From' })));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(original.fromLocation); expect(screen.getByTestId('cable-information-copy-status')).toHaveTextContent('Copied.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(row).toHaveFocus(); expect(route).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000)); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('uses Escape without clearing the route and restores row focus without a reopen loop', () => {
    render(<Harness />); const row = screen.getByRole('button', { name: 'Ａ <Cable>' }); fireEvent.keyDown(row, { key: 'Enter', altKey: true });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(row).toHaveFocus(); act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(route).not.toHaveBeenCalled();
  });
  it('closes a hover-open panel with global Escape while focus remains in Search', () => {
    render(<Harness />); const search = screen.getByRole('textbox', { name: 'Search cable tags' }); search.focus(); const row = open();
    expect(search).toHaveFocus(); expect(row).toHaveAttribute('aria-keyshortcuts', 'Alt+Enter');
    fireEvent.keyDown(search, { key: 'Escape' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(row).toHaveFocus();
    act(() => vi.advanceTimersByTime(1000)); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(route).not.toHaveBeenCalled();
  });
  it('allows a new explicit cable route once and replaces the previous information with a pinned cable window', () => {
    render(<Harness />); open(); fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(route).toHaveBeenCalledExactlyOnceWith(b); expect(screen.getByRole('dialog', { name: 'B' })).toHaveAttribute('data-pinned', 'true');
    expect(window.open).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(2000)); expect(screen.getByRole('dialog', { name: 'B' })).toBeInTheDocument();
  });
  it('pins an immediate cable click and offers native-window movement controls while popup blocking keeps an inline fallback', () => {
    render(<Harness />); const row = screen.getByRole('button', { name: 'Ａ <Cable>' }); fireEvent.click(row);
    const dialog = screen.getByRole('dialog'); expect(dialog).toHaveAttribute('data-pinned', 'true');
    expect(within(dialog).getByRole('button', { name: 'Open in new window' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Reset position' })).toBeEnabled();
    expect(within(dialog).getByRole('group', { name: /move/i })).toHaveAttribute('tabindex', '0');
    fireEvent.pointerLeave(row); act(() => vi.advanceTimersByTime(2000)); expect(dialog).toBeInTheDocument();
  });
  it('pins a hover preview when its move handle is used and keeps copy actions separate from routing', () => {
    render(<Harness />); const row = open(); const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(within(dialog).getByRole('group', { name: /move/i }), { key: 'ArrowLeft' });
    expect(dialog).toHaveAttribute('data-pinned', 'true'); fireEvent.pointerLeave(row); act(() => vi.advanceTimersByTime(2000));
    expect(dialog).toBeInTheDocument(); expect(route).not.toHaveBeenCalled();
  });
  it.each(['unavailable', 'denied'] as const)('provides selected exact Copy all plaintext fallback after clipboard %s without false success', async failure => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: failure === 'unavailable' ? undefined : { writeText: vi.fn(async () => { throw new DOMException('Not allowed', 'NotAllowedError'); }) } });
    render(<Harness />); open(); const dialog = screen.getByRole('dialog');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Copy all' })));
    const all = within(dialog).getByRole('textbox', { name: 'Copy all text' }) as HTMLTextAreaElement;
    expect(all).toHaveValue(`From: ${original.fromLocation}\nTo: \nRouting: ${original.routing}`); expect(all).toHaveFocus();
    expect(all.selectionStart).toBe(0); expect(all.selectionEnd).toBe(all.value.length);
    expect(screen.getByTestId('cable-information-copy-status')).toHaveTextContent('Select the text and press Ctrl+C.');
    expect(screen.getByTestId('cable-information-copy-status')).not.toHaveTextContent('Copied'); expect(route).not.toHaveBeenCalled();
  });
  it('always offers manual Copy all text even when clipboard succeeds and never substitutes No value for null', async () => {
    const writeText = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<Harness />); open(); const dialog = screen.getByRole('dialog');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Copy To' }))); expect(writeText).toHaveBeenCalledExactlyOnceWith('');
    fireEvent.click(within(dialog).getByText('Copy all text manually'));
    expect(within(dialog).getByRole('textbox', { name: 'Copy all text' })).toHaveValue(`From: ${original.fromLocation}\nTo: \nRouting: ${original.routing}`);
  });
  it('clearly labels cached values during a pending or failed refresh, then updates the same UUID on confirmed refresh', () => {
    const h = render(<Harness />); open(); fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    h.rerender(<Harness changes={{ readStatus: 'refreshing' }} />); expect(screen.getByTestId('cable-information-status')).toHaveTextContent('previously confirmed');
    h.rerender(<Harness changes={{ readStatus: 'stale' }} />); expect(screen.getByTestId('cable-information-status')).toHaveTextContent('may be out of date');
    h.rerender(<Harness changes={{ snapshotGeneration: 2, rows: [{ ...original, tag: 'NEW', fromLocation: '  CHANGED\nVALUE ' }] }} />);
    const dialog = screen.getByRole('dialog', { name: 'NEW' }); expect(dialog).toHaveAttribute('data-cable-id', a); expect(dialog).toHaveAttribute('data-pinned', 'true');
    expect(within(dialog).getByRole('textbox', { name: 'From' })).toHaveValue('  CHANGED\nVALUE '); expect(screen.getByTestId('cable-information-status')).toHaveTextContent('updated');
  });
  it('retains an unpinned panel across successful snapshot refresh while the same rendered row remains hovered and focused', () => {
    const h = render(<Harness />); const row = open(); row.focus();
    h.rerender(<Harness changes={{ snapshotGeneration: 2, rows: [{ ...original, fromLocation: 'FRESH FROM' }] }} />);
    expect(screen.getByRole('button', { name: 'Ａ <Cable>' })).toBe(row);
    act(() => vi.advanceTimersByTime(151));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-pinned', 'false');
    expect(screen.getByRole('textbox', { name: 'From' })).toHaveValue('FRESH FROM'); expect(row).toHaveFocus();
    fireEvent.pointerLeave(row); act(() => vi.advanceTimersByTime(151)); expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.blur(row, { relatedTarget: null }); act(() => vi.advanceTimersByTime(150)); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('uses the themed portal and bounds long readonly values to the viewport without growing the grid', () => {
    render(<Harness dark changes={{ rows: [{ ...original, routing: '/LONG'.repeat(2000) }] }} />); open();
    const dialog = screen.getByRole('dialog'); expect(dialog).toHaveStyle({ position: 'fixed' });
    expect(dialog).toHaveStyle({ width: '416px', maxWidth: 'calc(100vw - 16px)' }); expect(dialog.style.maxHeight).toContain('100vh - 16px');
    expect(dialog.closest('[data-portal-node]')?.className).toContain('fui-FluentProvider');
    expect(within(dialog).getByRole('textbox', { name: 'Routing' })).toHaveValue('/LONG'.repeat(2000));
  });
});
