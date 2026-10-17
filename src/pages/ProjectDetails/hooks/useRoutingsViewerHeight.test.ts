import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { availableViewerHeight, useRoutingsViewerHeight } from './useRoutingsViewerHeight';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('available project viewer height', () => {
  it('uses the actual slot position and measured bottom padding, including short viewports', () => {
    expect(availableViewerHeight(214.5, 900, 56)).toBe(629);
    expect(availableViewerHeight(410, 480, 56)).toBe(14);
    expect(availableViewerHeight(510, 480, 56)).toBe(0);
    expect(availableViewerHeight(510, 480, 56, 92)).toBe(332);
  });
  it('recalculates after wrapping/layout/viewport changes and releases its observers', () => {
    let resize!: ResizeObserverCallback; const disconnect = vi.fn(); const observe = vi.fn();
    vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe = observe; disconnect = disconnect; });
    const main = document.createElement('main'); main.id = 'app-root'; main.style.paddingBottom = '24px';
    const section = document.createElement('section'); section.style.paddingBottom = '32px'; const header = document.createElement('header'); const anchor = document.createElement('div');
    section.append(header, anchor); main.append(section); document.body.append(main);
    let top = 200; vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({ top } as DOMRect));
    vi.stubGlobal('innerHeight', 800); const ref = createRef<HTMLElement>(); ref.current = anchor;
    let scheduled: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { scheduled = callback; return 1; });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const h = renderHook(() => useRoutingsViewerHeight(ref)); expect(h.result.current).toBe(544); expect(observe).toHaveBeenCalledWith(header);
    top = 260; act(() => { resize([], {} as ResizeObserver); scheduled?.(0); }); expect(h.result.current).toBe(484);
    act(() => window.dispatchEvent(new Event('resize'))); h.unmount(); expect(disconnect).toHaveBeenCalled(); expect(cancel).toHaveBeenCalledWith(1);
    main.remove();
  });
  it('keeps controls reachable when a long header initially places the slot below the viewport', () => {
    const shell = document.createElement('div'); const header = document.createElement('header'); const main = document.createElement('main'); main.id = 'app-root'; main.style.paddingBottom = '24px';
    const anchor = document.createElement('div'); main.append(anchor); shell.append(header, main); document.body.append(shell);
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ bottom: 96 } as DOMRect);
    let top = 700; vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({ top } as DOMRect)); vi.stubGlobal('innerHeight', 600);
    let scheduled: FrameRequestCallback | undefined; vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { scheduled = callback; return 1; });
    const ref = createRef<HTMLElement>(); ref.current = anchor; const h = renderHook(() => useRoutingsViewerHeight(ref));
    expect(h.result.current).toBe(480);
    top = 500; act(() => { window.dispatchEvent(new Event('scroll')); scheduled?.(0); }); expect(h.result.current).toBe(480);
    top = 96; act(() => { window.dispatchEvent(new Event('scroll')); scheduled?.(0); }); expect(h.result.current).toBe(480);
    h.unmount(); shell.remove();
  });
});
