import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutingCableApiError, type RoutingCable } from '@/api/routingCables';
import { useRoutingCables } from './useRoutingCables';

const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/api/routingCables', async original => ({ ...await original<typeof import('@/api/routingCables')>(), fetchRoutingCables: api.read }));
const projectId = '11111111-1111-4111-8111-111111111111', a = '22222222-2222-4222-8222-222222222222', b = '33333333-3333-4333-8333-333333333333';
const row = (id = a, tag: string | null = 'A', routing: string | null = '/BC001'): RoutingCable => ({ id, projectId, tag, routing, fromLocation: null, toLocation: null });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const start = (active = true) => {
  const access = vi.fn(), invalidate = vi.fn();
  const h = renderHook(props => useRoutingCables({ ...props, onAccessFailure: access, onCableInvalidated: invalidate }), {
    initialProps: { projectId: projectId as string | null, token: 'current-token' as string | null, active },
  });
  return { ...h, access, invalidate };
};
const ready = (h: ReturnType<typeof start>) => waitFor(() => expect(h.result.current.hasSnapshot).toBe(true));
beforeEach(() => { vi.resetAllMocks(); api.read.mockResolvedValue([row()]); });

describe('scoped lazy full cable list', () => {
  it('publishes full confirmed snapshot generations independently of filtering, pending reads and failures', async () => {
    api.read.mockResolvedValueOnce([row(a, 'A'), row(b, 'B')]); const h = start(); await ready(h);
    expect(h.result.current.snapshotGeneration).toBe(1);
    act(() => h.result.current.setSearch('A'));
    expect(h.result.current.rows.map(cable => cable.id)).toEqual([a]); expect(h.result.current.cables).toHaveLength(2);
    const pending = deferred<RoutingCable[]>(); api.read.mockReturnValueOnce(pending.promise);
    let refreshing!: Promise<void>; act(() => { refreshing = h.result.current.refresh(); });
    expect(h.result.current.refreshing).toBe(true); expect(h.result.current.snapshotGeneration).toBe(1);
    await act(async () => { pending.reject(new RoutingCableApiError('NETWORK_ERROR')); await refreshing; });
    expect(h.result.current.stale).toBe(true); expect(h.result.current.snapshotGeneration).toBe(1);
    const updated = { ...row(b, 'B revised'), fromLocation: '  Source\n日本語  ', toLocation: null };
    api.read.mockResolvedValueOnce([row(a, 'A'), updated]); await act(() => h.result.current.refresh());
    expect(h.result.current.snapshotGeneration).toBe(2); expect(h.result.current.cables.find(cable => cable.id === b)).toEqual(updated);
    expect(h.result.current.rows.map(cable => cable.id)).toEqual([a]); expect(h.result.current.selectedCableId).toBeNull(); expect(h.invalidate).not.toHaveBeenCalled();
    h.rerender({ projectId, token: 'another-login', active: false });
    expect(h.result.current.snapshotGeneration).toBe(0); expect(h.result.current.cables).toEqual([]);
  });
  it('refreshes selected cable locations without invalidating its unchanged route', async () => {
    const h = start(); await ready(h); act(() => { h.result.current.select(a); });
    const updated = { ...row(), fromLocation: 'From / literal', toLocation: 'To\nline2' };
    api.read.mockResolvedValueOnce([updated]); await act(() => h.result.current.refresh());
    expect(h.result.current.selectedCable).toEqual(updated); expect(h.result.current.getSelectedForRetry()).toEqual(updated);
    expect(h.invalidate).not.toHaveBeenCalled(); expect(h.result.current.snapshotGeneration).toBe(2);
  });
  it('makes no eager Manual request and loads once at first Cables activation with the exact token', async () => {
    const h = start(false); expect(api.read).not.toHaveBeenCalled();
    h.rerender({ projectId, token: 'current-token', active: true }); await ready(h);
    expect(api.read).toHaveBeenCalledExactlyOnceWith(projectId, 'current-token', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(h.result.current.canActivate).toBe(true);
  });
  it('searches the whole snapshot locally without requests or selection replacement', async () => {
    api.read.mockResolvedValue([row(a, 'DUP', '/A'), row(b, 'DUP', '/B'), row(crypto.randomUUID(), null), row(crypto.randomUUID(), '  Ｓ８-Ｃａｓｅ  ')]);
    const h = start(); await ready(h); let selected!: RoutingCable | null;
    act(() => { selected = h.result.current.select(b); h.result.current.setSearch('Ｓ８-case'); });
    expect(selected?.routing).toBe('/B'); expect(h.result.current.rows.map(row => row.tag)).toEqual(['  Ｓ８-Ｃａｓｅ  ']);
    expect(h.result.current.selectedCableId).toBe(b); expect(h.result.current.selectedHidden).toBe(true); expect(h.result.current.omittedCount).toBe(1);
    act(() => h.result.current.setSearch('')); expect(h.result.current.rows.filter(row => row.tag === 'DUP')).toHaveLength(2); expect(api.read).toHaveBeenCalledTimes(1);
  });
  it('preserves nullable original routing and never chooses the first cable automatically', async () => {
    api.read.mockResolvedValue([row(a, 'A', null)]); const h = start(); await ready(h);
    expect(h.result.current.selectedCableId).toBeNull(); let selected!: RoutingCable | null;
    act(() => { selected = h.result.current.select(a); }); expect(selected?.routing).toBeNull(); expect(h.result.current.getSelectedForRetry()?.routing).toBeNull();
  });
  it('distinguishes initial failure from empty and retries explicitly', async () => {
    api.read.mockRejectedValueOnce(new RoutingCableApiError('NETWORK_ERROR')); const h = start();
    await waitFor(() => expect(h.result.current.error).not.toBeNull()); expect(h.result.current.hasSnapshot).toBe(false); expect(h.result.current.stale).toBe(true);
    api.read.mockResolvedValueOnce([]); await act(() => h.result.current.refresh()); expect(h.result.current.hasSnapshot).toBe(true); expect(h.result.current.cables).toEqual([]); expect(h.result.current.error).toBeNull();
  });
  it('keeps cached selected data stale after failed refresh, disables activation/retry and does not infer deletion', async () => {
    const h = start(); await ready(h); act(() => { h.result.current.select(a); });
    api.read.mockRejectedValueOnce(new RoutingCableApiError('NETWORK_ERROR')); await act(() => h.result.current.refresh());
    expect(h.result.current.selectedCableId).toBe(a); expect(h.result.current.stale).toBe(true); expect(h.result.current.cables).toHaveLength(1); expect(h.invalidate).not.toHaveBeenCalled();
    expect(h.result.current.canActivate).toBe(false); expect(h.result.current.getSelectedForRetry()).toBeNull(); expect(h.result.current.select(a)).toBeNull();
  });
  it.each(['removed', 'blank-tag', 'changed-routing'] as const)('reconciles confirmed %s by exact UUID and old routing without replaying it', async change => {
    const h = start(); await ready(h); act(() => { h.result.current.select(a); });
    api.read.mockResolvedValueOnce(change === 'removed' ? [] : [row(a, change === 'blank-tag' ? '  ' : 'A', change === 'changed-routing' ? '/LATEST' : '/BC001')]);
    await act(() => h.result.current.refresh()); expect(h.invalidate).toHaveBeenCalledExactlyOnceWith(a, '/BC001');
    expect(h.result.current.selectedCableId).toBe(change === 'changed-routing' ? a : null);
    expect(h.result.current.getSelectedForRetry()?.routing ?? null).toBe(change === 'changed-routing' ? '/LATEST' : null); expect(h.result.current.notice).not.toBeNull();
  });
  it('retags and reorders by UUID without invalidating geometry or changing selection', async () => {
    api.read.mockResolvedValueOnce([row(a, 'DUP'), row(b, 'DUP', '/B')]); const h = start(); await ready(h); act(() => { h.result.current.select(b); });
    api.read.mockResolvedValueOnce([row(b, 'Renamed', '/B'), row(a, 'DUP')]); await act(() => h.result.current.refresh());
    expect(h.result.current.selectedCableId).toBe(b); expect(h.result.current.selectedCable?.tag).toBe('Renamed'); expect(h.invalidate).not.toHaveBeenCalled();
  });
  it('coalesces in-flight focus/reveal/Refresh and refreshes only the active Cables mode', async () => {
    const pending = deferred<RoutingCable[]>(); api.read.mockReturnValueOnce(pending.promise); const h = start();
    act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); void h.result.current.refresh(); }); expect(api.read).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve([row()]); });
    h.rerender({ projectId, token: 'current-token', active: false }); act(() => window.dispatchEvent(new Event('focus'))); expect(api.read).toHaveBeenCalledTimes(1);
    h.rerender({ projectId, token: 'current-token', active: true }); await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
  });
  it.each([401, 403, 404])('clears scoped data and terminates access for list HTTP %s without focus retry loops', async status => {
    const h = start(); await ready(h); act(() => { h.result.current.select(a); });
    const code = status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'ACCESS_DENIED' : 'PROJECT_NOT_FOUND';
    api.read.mockRejectedValueOnce(new RoutingCableApiError(code, status)); await act(() => h.result.current.refresh());
    expect(h.access).toHaveBeenCalledExactlyOnceWith(code, status); expect(h.result.current.cables).toEqual([]); expect(h.result.current.selectedCableId).toBeNull();
    act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }); expect(api.read).toHaveBeenCalledTimes(2);
  });
  it('disables activation while refreshing and reads the current confirmed record for Retry afterward', async () => {
    const h = start(); await ready(h); act(() => { h.result.current.select(a); });
    const pending = deferred<RoutingCable[]>(); api.read.mockReturnValueOnce(pending.promise);
    let refreshing!: Promise<void>; act(() => { refreshing = h.result.current.refresh(); }); expect(h.result.current.getSelectedForRetry()).toBeNull();
    await act(async () => { pending.resolve([row(a, 'A', '/LATEST')]); await refreshing; }); expect(h.result.current.getSelectedForRetry()?.routing).toBe('/LATEST');
  });
  it('invalidates scope immediately, ignores late old-token data and rejects retained callbacks', async () => {
    const pending = deferred<RoutingCable[]>(); api.read.mockReturnValueOnce(pending.promise); const h = start();
    const oldRefresh = h.result.current.refresh, oldSearch = h.result.current.setSearch, oldSelect = h.result.current.select;
    const oldSignal = api.read.mock.calls[0][2].signal as AbortSignal;
    h.rerender({ projectId, token: 'new-token', active: false }); expect(h.result.current.cables).toEqual([]); expect(h.result.current.search).toBe(''); expect(h.result.current.selectedCableId).toBeNull(); expect(oldSignal.aborted).toBe(true);
    await act(async () => { pending.resolve([row()]); await oldRefresh(); oldSearch('OLD'); expect(oldSelect(a)).toBeNull(); });
    expect(api.read).toHaveBeenCalledTimes(1); expect(h.result.current.cables).toEqual([]); expect(h.result.current.search).toBe(''); expect(h.access).not.toHaveBeenCalled(); expect(h.invalidate).not.toHaveBeenCalled();
  });
});
