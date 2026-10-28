import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchInitialFillProgress, InitialFillProgressApiError, type InitialFillProgress } from '@/api/pathfinderInitialFillProgress';
import { emptyInitialFillCounters, INITIAL_FILL_PROGRESS_LIMITS } from '../../shared/pathfinderInitialFillProgress';
import { usePathfinderInitialFillProgress, type InitialFillProgressAccess } from './usePathfinderInitialFillProgress';
vi.mock('@/api/pathfinderInitialFillProgress', async original => ({ ...await original<typeof import('@/api/pathfinderInitialFillProgress')>(), fetchInitialFillProgress: vi.fn() }));
const id = (n: number) => `f8300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = id(1), actor = id(2), impact = id(3), cable = id(4);
function progress(outstanding = 1): InitialFillProgress { return { schemaVersion: 'wfc.pf.initial-fill-progress.v1', projectId: project, actorId: actor, impactId: impact,
  mandate: { id: id(5), contentSha256: 'a'.repeat(64), impactId: impact, mode: 'when-both-empty' }, authorized: true, currentAuthority: true, eligibleCables: 1,
  counters: { ...emptyInitialFillCounters(), ...(outstanding ? { pending: 1 } : { written: 1 }) }, retryableUnknown: 0, outstanding,
  selected: { cableId: cable, status: outstanding ? 'pending' : 'written', reasonCode: null, receiptId: outstanding ? null : id(6) } }; }
const access = (): InitialFillProgressAccess => ({ projectId: project, loadedProjectId: project, accountId: actor, token: 'token', isAdmin: true, active: true, impactId: impact, cableId: cable, onChanged: vi.fn(), onAuthorityLost: vi.fn() });
let visibility: DocumentVisibilityState = 'visible';
const hide = (value: DocumentVisibilityState) => act(() => { visibility = value; fireEvent(document, new Event('visibilitychange')); });
beforeEach(() => { vi.resetAllMocks(); visibility = 'visible'; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility); vi.mocked(fetchInitialFillProgress).mockResolvedValue(progress()); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('completion-based exact-impact initial-fill observation', () => {
  it('requires current admin/loaded project/account/exact impact before reading', async () => {
    const p = access(), view = renderHook(value => usePathfinderInitialFillProgress(value), { initialProps: { ...p, isAdmin: false } });
    for (const invalid of [{ ...p, accountId: null }, { ...p, token: null }, { ...p, loadedProjectId: id(99) }, { ...p, impactId: null }, { ...p, cableId: '../bad' }]) {
      view.rerender(invalid); expect(view.result.current.enabled).toBe(false); expect(view.result.current.progress).toBeNull();
    }
    expect(fetchInitialFillProgress).not.toHaveBeenCalled(); view.rerender(p); await waitFor(() => expect(view.result.current.progress?.impactId).toBe(impact)); view.unmount();
  });
  it('keeps one read in flight and schedules two seconds only after completion, then stops terminal', async () => {
    vi.useFakeTimers(); let finish!: (value: InitialFillProgress) => void; vi.mocked(fetchInitialFillProgress).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(progress(0));
    const view = renderHook(() => usePathfinderInitialFillProgress(access())); let first!: Promise<void>, second!: Promise<void>;
    act(() => { first = view.result.current.refresh(); second = view.result.current.refresh(); }); expect(first).toBe(second);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); }); expect(fetchInitialFillProgress).toHaveBeenCalledOnce();
    await act(async () => { finish(progress()); await first; await vi.advanceTimersByTimeAsync(INITIAL_FILL_PROGRESS_LIMITS.pollMilliseconds - 1); }); expect(fetchInitialFillProgress).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(fetchInitialFillProgress).toHaveBeenCalledTimes(2); expect(view.result.current.progress?.outstanding).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); }); expect(fetchInitialFillProgress).toHaveBeenCalledTimes(2); view.unmount();
  });
  it('does not notify on initial observation or unchanged reads, but reports a changed terminal outcome once', async () => {
    vi.useFakeTimers(); const p = access(); vi.mocked(fetchInitialFillProgress).mockResolvedValueOnce(progress()).mockResolvedValueOnce(progress()).mockResolvedValueOnce(progress(0));
    const view = renderHook(() => usePathfinderInitialFillProgress(p)); await act(async () => { await view.result.current.refresh(); }); expect(p.onChanged).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); expect(p.onChanged).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); expect(p.onChanged).toHaveBeenCalledExactlyOnceWith(progress(0)); view.unmount();
  });
  it('pauses hidden/inactive reads, preserves current owned observation and refreshes once on resumption', async () => {
    vi.useFakeTimers(); const p = access(), view = renderHook(value => usePathfinderInitialFillProgress(value), { initialProps: p }); await act(async () => { await view.result.current.refresh(); });
    hide('hidden'); await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); expect(fetchInitialFillProgress).toHaveBeenCalledOnce(); expect(view.result.current.progress?.impactId).toBe(impact);
    hide('visible'); await act(async () => { await view.result.current.refresh(); }); expect(fetchInitialFillProgress).toHaveBeenCalledTimes(2);
    view.rerender({ ...p, active: false }); await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); expect(fetchInitialFillProgress).toHaveBeenCalledTimes(2); view.unmount();
  });
  it('performs no read while initially hidden and ignores a response cancelled by hiding', async () => {
    visibility = 'hidden'; let finish!: (value: InitialFillProgress) => void; vi.mocked(fetchInitialFillProgress).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(() => usePathfinderInitialFillProgress(access())); expect(fetchInitialFillProgress).not.toHaveBeenCalled(); hide('visible'); await waitFor(() => expect(fetchInitialFillProgress).toHaveBeenCalledOnce());
    hide('hidden'); expect(vi.mocked(fetchInitialFillProgress).mock.calls[0][5]?.aborted).toBe(true); await act(async () => finish(progress())); expect(view.result.current.progress).toBeNull(); view.unmount();
  });
  it.each(['accountId', 'token', 'projectId', 'impactId', 'cableId'] as const)('discards late replies and hides old data after %s changes', async field => {
    const p = access(); let finish!: (value: InitialFillProgress) => void; vi.mocked(fetchInitialFillProgress).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(value => usePathfinderInitialFillProgress(value), { initialProps: p }), next = { ...p, [field]: field === 'token' ? 'new-token' : id(99) };
    if (field === 'projectId') next.loadedProjectId = next.projectId; const nextValue = { ...progress(0), projectId: next.projectId!, actorId: next.accountId!, impactId: next.impactId!, mandate: { ...progress().mandate!, impactId: next.impactId! }, selected: { ...progress(0).selected!, cableId: next.cableId! } };
    vi.mocked(fetchInitialFillProgress).mockResolvedValueOnce(nextValue); view.rerender(next); expect(view.result.current.progress).toBeNull(); await act(async () => finish(progress()));
    await waitFor(() => expect(view.result.current.progress).toEqual(nextValue)); expect(fetchInitialFillProgress).toHaveBeenCalledTimes(2); view.unmount();
  });
  it('clears denied data and does not retry the same principal automatically or on Refresh', async () => {
    vi.useFakeTimers(); const p = access(); vi.mocked(fetchInitialFillProgress).mockRejectedValue(new InitialFillProgressApiError('ADMIN_REQUIRED', 403, 'Current administrator access is required.'));
    const view = renderHook(() => usePathfinderInitialFillProgress(p)); await act(async () => { await view.result.current.refresh(); await vi.advanceTimersByTimeAsync(10000); });
    expect(view.result.current.enabled).toBe(false); expect(view.result.current.progress).toBeNull(); expect(p.onAuthorityLost).toHaveBeenCalledOnce(); await act(async () => { await view.result.current.refresh(); }); expect(fetchInitialFillProgress).toHaveBeenCalledOnce(); view.unmount();
  });
  it('suspends errors until explicit refresh, and does not restart for new callback identities', async () => {
    vi.useFakeTimers(); const p = access(); vi.mocked(fetchInitialFillProgress).mockRejectedValueOnce(Error('network')).mockResolvedValue(progress(0));
    const view = renderHook(value => usePathfinderInitialFillProgress(value), { initialProps: p }); await act(async () => { await view.result.current.refresh(); await vi.advanceTimersByTimeAsync(10000); }); expect(fetchInitialFillProgress).toHaveBeenCalledOnce();
    view.rerender({ ...p, onChanged: vi.fn() }); expect(fetchInitialFillProgress).toHaveBeenCalledOnce(); await act(async () => { await view.result.current.refresh(); }); expect(view.result.current.progress?.outstanding).toBe(0); view.unmount();
  });
  it('aborts and clears timers on unmount without mutation transports', async () => {
    vi.useFakeTimers(); const view = renderHook(() => usePathfinderInitialFillProgress(access())); await act(async () => { await view.result.current.refresh(); }); view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); expect(fetchInitialFillProgress).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
