import { act, renderHook } from '@testing-library/react';
import type { FocusEvent, KeyboardEvent, PointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cableInformationText, useCableInformationPanel, type CableInformationRecord, type UseCableInformationPanelOptions } from './useCableInformationPanel';

const projectId = '11111111-1111-4111-8111-111111111111', a = '22222222-2222-4222-8222-222222222222', b = '33333333-3333-4333-8333-333333333333';
const row = (id = a, overrides: Partial<CableInformationRecord> = {}): CableInformationRecord => ({ id, projectId, tag: 'DUPLICATE', fromLocation: '  Ａ\n<from>  ', toLocation: null, routing: '/ A /SECONDARY\n/B', ...overrides });
const pending = () => { let resolve!: () => void, reject!: (reason: Error) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const start = (overrides: Partial<UseCableInformationPanelOptions> = {}) => {
  const search = document.createElement('input'); search.setAttribute('aria-label', 'Search cable tags'); document.body.append(search);
  let options: UseCableInformationPanelOptions = { scopeIdentity: {}, active: true, lifecycleIdentity: 'load-a', snapshotGeneration: 1,
    rows: [row(), row(b, { fromLocation: 'B FROM', routing: '/B' })], readStatus: 'confirmed', searchRef: { current: search }, ...overrides };
  const h = renderHook(value => useCableInformationPanel(value), { initialProps: options });
  const nodes = new Map<string, HTMLButtonElement>();
  const bind = (id = a) => {
    let node = nodes.get(id); if (!node) { node = document.createElement('button'); node.textContent = id; document.body.append(node); nodes.set(id, node); }
    const props = h.result.current.getRowProps(id); props.ref(node); return { node, props };
  };
  const enter = (id = a) => { const value = bind(id); act(() => value.props.onPointerEnter({ currentTarget: value.node } as PointerEvent<HTMLButtonElement>)); return value; };
  const leave = (id = a) => act(() => h.result.current.getRowProps(id).onPointerLeave({} as PointerEvent<HTMLButtonElement>));
  const keyboard = (id = a) => { const value = bind(id); const event = { key: 'Enter', altKey: true, currentTarget: value.node, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    act(() => value.props.onKeyDown(event as unknown as KeyboardEvent<HTMLButtonElement>)); return event; };
  const click = (id = a) => { const value = bind(id); act(() => h.result.current.openPinned(id, value.node)); return value; };
  const rerender = (changes: Partial<UseCableInformationPanelOptions>) => { options = { ...options, ...changes }; h.rerender(options); };
  return { ...h, search, bind, enter, leave, keyboard, click, rerender, get options() { return options; } };
};
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(window, 'open').mockReturnValue(null); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('one scope-bound cable information panel', () => {
  it('opens and pins on explicit click immediately, retaining the cable after pointer leave', () => {
    const h = start(); h.click();
    expect(h.result.current.panelProps?.cable.id).toBe(a); expect(h.result.current.panelProps?.pinned).toBe(true);
    expect(h.result.current.panelProps?.requestedPopup?.blocked).toBe(true); expect(window.open).toHaveBeenCalledOnce();
    h.leave(); tick(2000); expect(h.result.current.panelProps?.cable.id).toBe(a);
  });
  it('lets another explicit click replace a pinned cable while hover cannot replace it', () => {
    const h = start(); h.click(); h.enter(b); tick(1000); expect(h.result.current.panelProps?.cable.id).toBe(a);
    h.click(b); expect(h.result.current.panelProps?.cable.id).toBe(b); expect(h.result.current.panelProps?.pinned).toBe(true);
  });
  it('pins an existing hover panel on drag or detach interaction without toggling an already pinned panel', () => {
    const h = start(); h.enter(); tick(1000); expect(h.result.current.panelProps?.pinned).toBe(false);
    act(() => h.result.current.panelProps!.onPin()); expect(h.result.current.panelProps?.pinned).toBe(true);
    act(() => h.result.current.panelProps!.onPin()); expect(h.result.current.panelProps?.pinned).toBe(true);
    h.leave(); tick(2000); expect(h.result.current.panelProps?.cable.id).toBe(a);
  });
  it('refuses stale click requests before opening a browser window', () => {
    const h = start({ readStatus: 'stale' }); h.click(); expect(h.result.current.panelProps).toBeNull(); expect(window.open).not.toHaveBeenCalled();
    h.rerender({ readStatus: 'confirmed' }); const staleClick = h.result.current.openPinned, { node } = h.bind();
    h.rerender({ snapshotGeneration: 2 }); act(() => staleClick(a, node)); expect(h.result.current.panelProps).toBeNull(); expect(window.open).not.toHaveBeenCalled();
  });
  it.each(['close', 'scope', 'inactive', 'unmount'] as const)('closes a synchronously requested window on %s even before a portal adopts it', change => {
    const popup = { closed: false, document: document.implementation.createHTMLDocument(), focus: vi.fn(), close: vi.fn(() => { popup.closed = true; }) };
    vi.mocked(window.open).mockReturnValue(popup as unknown as Window);
    const h = start(); h.click(); expect(h.result.current.panelProps?.requestedPopup?.window).toBe(popup);
    if (change === 'close') act(() => h.result.current.panelProps!.onClose());
    else if (change === 'scope') h.rerender({ scopeIdentity: {} });
    else if (change === 'inactive') h.rerender({ active: false });
    else h.unmount();
    expect(popup.close).toHaveBeenCalledOnce(); expect(popup.closed).toBe(true);
  });
  it('reuses one live browser window when an explicit click selects another cable', () => {
    const popup = { closed: false, document: document.implementation.createHTMLDocument(), focus: vi.fn(), close: vi.fn() };
    vi.mocked(window.open).mockReturnValue(popup as unknown as Window);
    const h = start(); h.click(); const request = h.result.current.panelProps?.requestedPopup;
    h.click(b); expect(h.result.current.panelProps?.cable.id).toBe(b); expect(h.result.current.panelProps?.requestedPopup).toBe(request);
    expect(window.open).toHaveBeenCalledOnce(); expect(popup.focus).toHaveBeenCalledOnce(); expect(popup.close).not.toHaveBeenCalled();
  });
  it('has no dialog at999ms and opens the exact unselected UUID at1000ms without focus theft', () => {
    const h = start(); const { node } = h.enter(b); h.search.focus(); tick(999); expect(h.result.current.panelProps).toBeNull();
    tick(1); expect(h.result.current.panelProps?.cable.id).toBe(b); expect(h.result.current.panelProps?.focusOnOpen).toBe(false);
    expect(document.activeElement).toBe(h.search); expect(node).not.toHaveFocus();
  });
  it('cancels leave/reenter and A→B dwell rather than opening an old identity', () => {
    const h = start(); h.enter(); tick(700); h.leave(); tick(1000); expect(h.result.current.panelProps).toBeNull();
    h.enter(); tick(999); h.enter(b); tick(1); expect(h.result.current.panelProps).toBeNull(); tick(999);
    expect(h.result.current.panelProps?.cable.id).toBe(b);
  });
  it('allows B dwell to complete after the previously open A closes across the gap', () => {
    const h = start(); h.enter(); tick(1000); h.leave(); h.enter(b); tick(150); expect(h.result.current.panelProps).toBeNull();
    tick(849); expect(h.result.current.panelProps).toBeNull(); tick(1); expect(h.result.current.panelProps?.cable.id).toBe(b);
  });
  it('retains row→gap→panel and focus inside, then closes only after150ms outside both', () => {
    const h = start(); h.enter(); tick(1000); h.leave(); tick(149);
    act(() => h.result.current.panelProps!.onPointerEnter({} as PointerEvent<HTMLDivElement>)); tick(1000); expect(h.result.current.panelProps).not.toBeNull();
    act(() => { h.result.current.panelProps!.onPointerLeave({} as PointerEvent<HTMLDivElement>); h.result.current.panelProps!.onFocus({} as FocusEvent<HTMLDivElement>); }); tick(500);
    expect(h.result.current.panelProps).not.toBeNull();
    const panel = document.createElement('div');
    act(() => h.result.current.panelProps!.onBlur({ currentTarget: panel, relatedTarget: null } as FocusEvent<HTMLDivElement>));
    tick(149); expect(h.result.current.panelProps).not.toBeNull(); tick(1); expect(h.result.current.panelProps).toBeNull();
  });
  it('keeps one pinned UUID on hover B and after its anchor is filtered out', () => {
    const h = start(); const { node, props } = h.enter(); tick(1000); act(() => h.result.current.panelProps!.onTogglePin());
    h.leave(); h.enter(b); node.remove(); props.ref(null); h.rerender({}); tick(2000);
    expect(h.result.current.panelProps?.cable.id).toBe(a); expect(h.result.current.panelProps?.pinned).toBe(true); expect(h.result.current.panelProps?.anchor).toBeNull();
    act(() => h.result.current.panelProps!.onTogglePin()); tick(150); expect(h.result.current.panelProps).toBeNull();
  });
  it('supports focus dwell and immediate Alt+Enter while leaving native Enter and Space routing alone', () => {
    const h = start(); const { node, props } = h.bind(); act(() => props.onFocus({ currentTarget: node } as FocusEvent<HTMLButtonElement>)); tick(1000);
    expect(h.result.current.panelProps?.cable.id).toBe(a);
    act(() => h.result.current.panelProps!.onClose());
    const event = h.keyboard(b); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce(); expect(h.result.current.panelProps?.focusOnOpen).toBe(true);
    for (const key of ['Enter', ' ']) {
      const normal = { key, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      act(() => h.result.current.getRowProps(b).onKeyDown(normal as unknown as KeyboardEvent<HTMLButtonElement>)); expect(normal.preventDefault).not.toHaveBeenCalled();
    }
  });
  it('returns Close focus to the exact UUID, suppresses reopened focus dwell, and allows new intended hover', () => {
    const h = start(); const { node } = h.bind(); h.keyboard();
    act(() => h.result.current.panelProps!.onClose()); expect(node).toHaveFocus();
    act(() => h.result.current.getRowProps(a).onFocus({ currentTarget: node } as FocusEvent<HTMLButtonElement>)); tick(1500); expect(h.result.current.panelProps).toBeNull();
    h.enter(); tick(1000); expect(h.result.current.panelProps?.cable.id).toBe(a);
  });
  it('returns focus to Search when the exact row is absent, never to a duplicate-tag neighbor', () => {
    const h = start(); const { node, props } = h.bind(); h.keyboard(); h.bind(b); node.remove(); props.ref(null);
    act(() => h.result.current.panelProps!.onClose()); expect(h.search).toHaveFocus();
  });
  it('closes before another explicit cable route and cancels dwell without changing any selection owner', () => {
    const h = start(); h.enter(); tick(1000); act(() => h.result.current.beforeRoute(b)); expect(h.result.current.panelProps).toBeNull();
    h.enter(b); tick(900); act(() => h.result.current.beforeRoute(b)); tick(500); expect(h.result.current.panelProps).toBeNull();
  });
  it('reconciles a pinned unselected UUID against full refreshed rows with exact original fields and tag', () => {
    const h = start(); h.keyboard(b); act(() => h.result.current.panelProps!.onTogglePin());
    h.rerender({ snapshotGeneration: 2, rows: [row(), row(b, { tag: '  NEW ＴＡＧ ', fromLocation: '  NEW\nFROM ', toLocation: '<to>', routing: '/ NEW /' })] });
    expect(h.result.current.panelProps?.cable).toEqual(row(b, { tag: '  NEW ＴＡＧ ', fromLocation: '  NEW\nFROM ', toLocation: '<to>', routing: '/ NEW /' }));
    expect(h.result.current.panelProps?.notice).toBe('Cable information was updated.'); expect(h.result.current.panelProps?.pinned).toBe(true);
  });
  it.each(['removed', 'blank-tag'] as const)('closes a hovered or pinned unselected %s UUID only after successful refresh', change => {
    const h = start(); h.keyboard(b); act(() => h.result.current.panelProps!.onTogglePin());
    h.rerender({ readStatus: 'refreshing' }); expect(h.result.current.panelProps?.readStatus).toBe('refreshing');
    h.rerender({ readStatus: 'stale' }); expect(h.result.current.panelProps?.cable.id).toBe(b);
    h.rerender({ readStatus: 'confirmed', snapshotGeneration: 2, rows: change === 'removed' ? [row()] : [row(), row(b, { tag: '  ' })] }); expect(h.result.current.panelProps).toBeNull();
  });
  it('cancels old generation dwell and will not open new information from stale or refreshing rows', () => {
    const h = start(); h.enter(); tick(999); h.rerender({ snapshotGeneration: 2 }); tick(1); expect(h.result.current.panelProps).toBeNull();
    h.rerender({ readStatus: 'refreshing' }); h.enter(); tick(1000); expect(h.result.current.panelProps).toBeNull();
    h.rerender({ readStatus: 'stale' }); h.keyboard(); expect(h.result.current.panelProps).toBeNull();
    h.rerender({ readStatus: 'confirmed', snapshotGeneration: 3 }); h.keyboard(); expect(h.result.current.panelProps?.cable.id).toBe(a);
  });
  it.each(['scopeIdentity', 'lifecycleIdentity', 'active'] as const)('masks current panel, cancels dwell and refuses old callbacks after %s changes', key => {
    const h = start(); h.keyboard(); const old = h.result.current.panelProps!, oldRow = h.result.current.getRowProps(a), oldRoute = h.result.current.beforeRoute;
    h.rerender(key === 'scopeIdentity' ? { scopeIdentity: {} } : key === 'lifecycleIdentity' ? { lifecycleIdentity: 'load-b' } : { active: false });
    expect(h.result.current.panelProps).toBeNull(); act(() => { old.onTogglePin(); old.onCopy('all'); oldRoute(b); oldRow.onPointerEnter({ currentTarget: h.bind().node } as PointerEvent<HTMLButtonElement>); });
    tick(1000); expect(h.result.current.panelProps).toBeNull();
  });
  it.each(['scopeIdentity', 'lifecycleIdentity', 'active'] as const)('refuses a pending old-scope dwell after %s changes at999ms', key => {
    const h = start(); h.enter(); tick(999);
    h.rerender(key === 'scopeIdentity' ? { scopeIdentity: {} } : key === 'lifecycleIdentity' ? { lifecycleIdentity: 'load-b' } : { active: false });
    tick(1000); expect(h.result.current.panelProps).toBeNull();
  });
  it('permits information for confirmed read data while model lifecycle is initially null', () => {
    const h = start({ lifecycleIdentity: null }); h.keyboard(); expect(h.result.current.panelProps?.cable.id).toBe(a);
  });
  it('cancels all dwell/grace work on unmount', () => {
    const h = start(); h.enter(); expect(vi.getTimerCount()).toBe(1); h.unmount(); expect(vi.getTimerCount()).toBe(0); tick(1000);
  });
});

describe('original plain text and identity-bound clipboard feedback', () => {
  it('formats exactly the original nullable/multiline text without placeholders or markup insertion', () => {
    expect(cableInformationText(row())).toBe('From:   Ａ\n<from>  \nTo: \nRouting: / A /SECONDARY\n/B');
  });
  it('copies only the exact requested original field and labeled Copy all text after explicit action', async () => {
    const writeText = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const h = start(); h.keyboard(); expect(writeText).not.toHaveBeenCalled();
    for (const [field, text] of [['fromLocation', row().fromLocation], ['toLocation', ''], ['routing', row().routing], ['all', cableInformationText(row())]] as const) {
      await act(async () => h.result.current.panelProps!.onCopy(field)); expect(writeText).toHaveBeenLastCalledWith(text); expect(h.result.current.panelProps?.feedback).toBe('Copied.');
    }
  });
  it('copies original CRLF/Unicode/whitespace from the snapshot rather than textarea-normalized text', async () => {
    const writeText = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const cable = row(a, { fromLocation: '  Ｕ\r\nnext\r\n ', routing: '/ A\r\n/Ｂ  ' });
    const h = start({ rows: [cable] }); h.keyboard();
    await act(async () => h.result.current.panelProps!.onCopy('fromLocation')); expect(writeText).toHaveBeenLastCalledWith(cable.fromLocation);
    await act(async () => h.result.current.panelProps!.onCopy('all')); expect(writeText).toHaveBeenLastCalledWith('From:   Ｕ\r\nnext\r\n \nTo: \nRouting: / A\r\n/Ｂ  ');
  });
  it.each(['unavailable', 'denied', 'failed'] as const)('keeps manual selection fallback and never claims Copied when clipboard is %s', async failure => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: failure === 'unavailable' ? undefined : { writeText: vi.fn(async () => { throw new Error(failure); }) } });
    const h = start(); h.keyboard(); await act(async () => h.result.current.panelProps!.onCopy('all'));
    expect(h.result.current.panelProps?.feedback).toBe('Select the text and press Ctrl+C.'); expect(h.result.current.panelProps?.fallbackField).toBe('all');
  });
  it.each((['close', 'scope', 'generation', 'other-cable'] as const).flatMap(change => (['success', 'failure'] as const).map(outcome => ({ change, outcome }))))('does not post late clipboard $outcome to a $change panel', async ({ change, outcome }) => {
    const deferred = pending(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => deferred.promise) } });
    const h = start(); h.keyboard(); act(() => h.result.current.panelProps!.onCopy('routing'));
    if (change === 'close') act(() => h.result.current.panelProps!.onClose());
    else if (change === 'scope') h.rerender({ scopeIdentity: {} });
    else if (change === 'generation') h.rerender({ snapshotGeneration: 2, rows: [row(a, { routing: '/NEW' })] });
    else h.keyboard(b);
    await act(async () => { if (outcome === 'success') deferred.resolve(); else deferred.reject(new Error('Denied')); }); expect(h.result.current.panelProps?.feedback ?? null).toBeNull();
  });
  it('does not let clipboard feedback prevent an already scheduled outside close', async () => {
    const deferred = pending(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => deferred.promise) } });
    const h = start(); h.enter(); tick(1000); act(() => h.result.current.panelProps!.onCopy('routing')); h.leave();
    await act(async () => deferred.resolve()); tick(150); expect(h.result.current.panelProps).toBeNull();
  });
});
