import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerTrayRootSelection } from '../../../../viewer-runtime/protocol.mjs';
import { useTrayModelSelection } from './useTrayModelSelection';

function setup() {
  const reader = vi.fn<() => Promise<ViewerTrayRootSelection | null>>().mockResolvedValue({ objects: [{ objectId: 55 }] });
  const pf = { busy: false, viewerPhase: 'ready' as const, preparationViewerGeneration: 1,
    preparationAccess: { projectId: 'project', token: 'login' }, readTrayRootSelection: reader,
    runProjectPreparation: vi.fn(), readSelection: vi.fn() };
  return { reader, pf, input: { pf, active: true, scopeKey: 'scope-one', paused: false } };
}
const flush = () => act(async () => { await Promise.resolve(); });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('passive model tray selection', () => {
  it('polls only the lightweight reader without changing busy or using capture/rich metadata', async () => {
    const { input, reader, pf } = setup();
    const view = renderHook(useTrayModelSelection, { initialProps: input });
    expect(view.result.current.status).toBe('loading');
    await flush();
    expect(view.result.current).toMatchObject({ status: 'ready', objectIds: [55], error: null });
    const refresh = view.result.current.refresh;
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(reader).toHaveBeenCalledTimes(2);
    expect(view.result.current.refresh).toBe(refresh);
    expect(pf.busy).toBe(false);
    expect(pf.runProjectPreparation).not.toHaveBeenCalled(); expect(pf.readSelection).not.toHaveBeenCalled();
  });
  it('serializes slow polls and manual refreshes instead of overlapping selection reads', async () => {
    const { input, reader } = setup(); let finish!: (value: ViewerTrayRootSelection) => void;
    reader.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(useTrayModelSelection, { initialProps: input }); await flush();
    await act(() => vi.advanceTimersByTimeAsync(10000));
    let refreshed!: Promise<void>;
    act(() => { refreshed = view.result.current.refresh(); });
    expect(reader).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ objects: [{ objectId: 58 }] }); await refreshed; });
    expect(view.result.current.objectIds).toEqual([58]);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(reader).toHaveBeenCalledTimes(2);
  });
  it.each(['scope', 'access', 'generation'] as const)('clears immediately and ignores a late result after %s changes', async change => {
    const { input, reader } = setup(); let finish!: (value: ViewerTrayRootSelection) => void;
    reader.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ objects: [{ objectId: 58 }] });
    const view = renderHook(useTrayModelSelection, { initialProps: input }); await flush();
    const next = { ...input, pf: { ...input.pf } };
    if (change === 'scope') next.scopeKey = 'scope-two';
    if (change === 'access') next.pf.preparationAccess = { ...next.pf.preparationAccess, token: 'new-login' };
    if (change === 'generation') next.pf.preparationViewerGeneration = 2;
    view.rerender(next);
    expect(view.result.current).toMatchObject({ status: 'loading', objectIds: [], error: null });
    expect(reader).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ objects: [{ objectId: 55 }] }); });
    expect(reader).toHaveBeenCalledTimes(2);
    expect(view.result.current).toMatchObject({ status: 'ready', objectIds: [58] });
  });
  it('pauses without polling during busy work, inactive tools or explicit pause and reads afresh on resume', async () => {
    const { input, reader } = setup();
    const view = renderHook(useTrayModelSelection, { initialProps: input }); await flush();
    for (const next of [{ ...input, paused: true }, { ...input, active: false }, { ...input, pf: { ...input.pf, busy: true } }]) {
      view.rerender(next);
      expect(view.result.current).toMatchObject({ status: 'paused', objectIds: [] });
      await act(() => vi.advanceTimersByTimeAsync(20000));
    }
    expect(reader).toHaveBeenCalledTimes(1);
    reader.mockResolvedValue({ objects: [{ objectId: 58 }] });
    view.rerender(input); await flush();
    expect(view.result.current).toMatchObject({ status: 'ready', objectIds: [58] });
    expect(input.pf.busy).toBe(false);
  });
  it('reports a read failure locally with bounded backoff and recovers without raw error text', async () => {
    const { input, reader } = setup();
    reader.mockRejectedValueOnce(new Error('PRIVATE transport details'));
    const view = renderHook(useTrayModelSelection, { initialProps: input }); await flush();
    expect(view.result.current.status).toBe('error');
    expect(view.result.current.error).not.toContain('PRIVATE');
    expect(view.result.current.objectIds).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(3999)); expect(reader).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(reader).toHaveBeenCalledTimes(2);
    expect(view.result.current).toMatchObject({ status: 'ready', objectIds: [55], error: null });
  });
  it('distinguishes an unavailable observation from a verified empty selection', async () => {
    const { input, reader } = setup(); reader.mockResolvedValueOnce(null).mockResolvedValue({ objects: [] });
    const view = renderHook(useTrayModelSelection, { initialProps: input }); await flush();
    expect(view.result.current.status).toBe('unavailable');
    await act(async () => { await view.result.current.refresh(); });
    expect(view.result.current).toMatchObject({ status: 'ready', objectIds: [], error: null });
  });
  it('supports old mocks without a reader and does not leak old results after the viewer becomes unavailable', async () => {
    const { input, reader } = setup();
    const view = renderHook(useTrayModelSelection, { initialProps: input }); await flush();
    view.rerender({ ...input, pf: { ...input.pf, readTrayRootSelection: undefined as unknown as typeof reader } });
    expect(view.result.current).toMatchObject({ status: 'unavailable', objectIds: [] });
    await act(async () => { await view.result.current.refresh(); });
    await act(() => vi.advanceTimersByTimeAsync(20000));
    expect(reader).toHaveBeenCalledTimes(1);
  });
});
