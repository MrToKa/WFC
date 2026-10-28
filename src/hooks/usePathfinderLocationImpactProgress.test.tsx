import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLocationImpacts, fetchLocationImpactProgress, LocationImpactApiError, type LocationImpactSummary } from '@/api/pathfinderLocationImpacts';
import { locationImpactSummarySchema } from '../../shared/pathfinderLocationImpacts';
import { usePathfinderLocationImpactProgress, LOCATION_IMPACT_POLL_MILLISECONDS, type LocationImpactProgressAccess } from './usePathfinderLocationImpactProgress';

vi.mock('@/api/pathfinderLocationImpacts', async original => ({ ...(await original<typeof import('@/api/pathfinderLocationImpacts')>()), fetchLocationImpacts: vi.fn(), fetchLocationImpactProgress: vi.fn() }));
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = id(1), actor = id(2), impactId = id(30);
function impact(n = 30, status: LocationImpactSummary['status'] = 'running'): LocationImpactSummary {
  return locationImpactSummarySchema.parse({ id: id(n), projectId: project, actorId: actor, modelVersionId: id(3), selectionRevision: '2', contentFingerprint: 'a'.repeat(64),
    current: { modelVersionId: id(3), selectionRevision: '2', contentFingerprint: 'a'.repeat(64), aggregateId: id(4), artifactId: id(5), projectionSha256: 'b'.repeat(64), captureFrameId: id(6), geometryRevision: '3', traceId: id(7) },
    calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 }, status, reasonCodes: [],
    eligibleCables: 3, excludedMvCables: 1, blockedCategoryCables: 1, currentTargetCables: 3, completed: status === 'complete' ? 3 : 1, total: 3, readyCables: 1, blockedCables: 0, jobId: id(8),
    createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:00:01.000Z', admittedAt: '2026-10-20T10:00:00.200Z', authorityExpiresAt: '2026-10-20T10:30:00.000Z',
    currentAuthority: true, elapsedMilliseconds: 1000, admissionElapsedMilliseconds: 200 });
}
const progress = (summary = impact()) => ({ schemaVersion: 'wfc.pf.location-impact-progress.v1' as const, projectId: project, impact: summary });
const page = (impacts = [impact()], nextBeforeId: string | null = null) => ({ schemaVersion: 'wfc.pf.location-impact-page.v1' as const, projectId: project, impacts, nextBeforeId });
const access = (): LocationImpactProgressAccess => ({ projectId: project, loadedProjectId: project, accountId: actor, token: 'current-token', isAdmin: true, active: true,
  current: impact().current, calculation: impact().calculation, impactId, onChanged: vi.fn(), onAuthorityLost: vi.fn() });
let visibility: DocumentVisibilityState = 'visible';
function hide(value: DocumentVisibilityState) { act(() => { visibility = value; fireEvent(document, new Event('visibilitychange')); }); }
beforeEach(() => {
  vi.resetAllMocks(); visibility = 'visible'; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.mocked(fetchLocationImpacts).mockResolvedValue(page()); vi.mocked(fetchLocationImpactProgress).mockResolvedValue(progress());
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('owned lightweight location-impact progress', () => {
  it('requires current administrator/project/model/configuration before any read', async () => {
    const props = access(), view = renderHook(value => usePathfinderLocationImpactProgress(value), { initialProps: { ...props, isAdmin: false } });
    for (const invalid of [{ ...props, accountId: null }, { ...props, token: null }, { ...props, loadedProjectId: id(99) }, { ...props, current: null },
      { ...props, calculation: { ...props.calculation!, timeoutMilliseconds: Number.NaN } }]) {
      view.rerender(invalid); expect(view.result.current.enabled).toBe(false); expect(view.result.current.impact).toBeNull();
    }
    expect(fetchLocationImpactProgress).not.toHaveBeenCalled(); expect(fetchLocationImpacts).not.toHaveBeenCalled();
    view.rerender(props); await waitFor(() => expect(view.result.current.impact?.id).toBe(impactId));
  });
  it('keeps one in-flight read, dedupes Refresh, and schedules the next poll only after completion', async () => {
    vi.useFakeTimers(); let finish!: (value: ReturnType<typeof progress>) => void;
    vi.mocked(fetchLocationImpactProgress).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(progress(impact(30, 'complete')));
    const view = renderHook(() => usePathfinderLocationImpactProgress(access()));
    let first!: Promise<void>, second!: Promise<void>; act(() => { first = view.result.current.refresh(); second = view.result.current.refresh(); }); expect(first).toBe(second);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); }); expect(fetchLocationImpactProgress).toHaveBeenCalledOnce();
    await act(async () => { finish(progress()); await first; });
    await act(async () => { await vi.advanceTimersByTimeAsync(LOCATION_IMPACT_POLL_MILLISECONDS - 1); }); expect(fetchLocationImpactProgress).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(2);
    expect(view.result.current.impact?.status).toBe('complete'); await act(async () => { await vi.advanceTimersByTimeAsync(20_000); }); expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(2);
    view.unmount();
  });
  it.each(['complete', 'blocked', 'superseded', 'cancelled', 'failed', 'awaiting-authority', 'restore-fenced'] as const)('stops all automatic reads at terminal/non-actionable status %s', async status => {
    vi.useFakeTimers(); vi.mocked(fetchLocationImpactProgress).mockResolvedValue(progress(impact(30, status)));
    const view = renderHook(() => usePathfinderLocationImpactProgress(access())); await act(async () => { await view.result.current.refresh(); await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchLocationImpactProgress).toHaveBeenCalledOnce(); expect(view.result.current.impact?.status).toBe(status); expect(fetchLocationImpacts).not.toHaveBeenCalled(); view.unmount();
  });
  it('stops on expired current authority without trying to renew it or start another job', async () => {
    vi.useFakeTimers(); vi.mocked(fetchLocationImpactProgress).mockResolvedValue(progress({ ...impact(), currentAuthority: false }));
    const view = renderHook(() => usePathfinderLocationImpactProgress(access())); await act(async () => { await view.result.current.refresh(); await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchLocationImpactProgress).toHaveBeenCalledOnce(); expect(view.result.current.impact?.currentAuthority).toBe(false); view.unmount();
  });
  it('pauses while hidden/inactive, retains the owned observation, and refreshes once on resumption', async () => {
    vi.useFakeTimers(); const props = access(), view = renderHook(value => usePathfinderLocationImpactProgress(value), { initialProps: props });
    await act(async () => { await view.result.current.refresh(); }); hide('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); }); expect(fetchLocationImpactProgress).toHaveBeenCalledOnce(); expect(view.result.current.paused).toBe(true); expect(view.result.current.impact?.id).toBe(impactId);
    hide('visible'); await act(async () => { await view.result.current.refresh(); }); expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(2);
    view.rerender({ ...props, active: false }); await act(async () => { await vi.advanceTimersByTimeAsync(10_000); }); expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(2);
    view.rerender(props); await act(async () => { await view.result.current.refresh(); }); expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(3); view.unmount();
  });
  it('does not read when initially hidden and cancels an in-flight read on hiding', async () => {
    visibility = 'hidden'; let finish!: (value: ReturnType<typeof progress>) => void; vi.mocked(fetchLocationImpactProgress).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(() => usePathfinderLocationImpactProgress(access())); expect(fetchLocationImpactProgress).not.toHaveBeenCalled();
    hide('visible'); await waitFor(() => expect(fetchLocationImpactProgress).toHaveBeenCalledOnce()); const signal = vi.mocked(fetchLocationImpactProgress).mock.calls[0][4];
    hide('hidden'); expect(signal?.aborted).toBe(true); await act(async () => { finish(progress()); }); expect(view.result.current.impact).toBeNull(); expect(view.result.current.loading).toBe(false);
  });
  it.each(['account', 'model', 'preparation', 'preferences'] as const)('hides old observations and ignores late replies after %s changes', async kind => {
    const props = access(); let finish!: (value: ReturnType<typeof progress>) => void;
    vi.mocked(fetchLocationImpactProgress).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(value => usePathfinderLocationImpactProgress(value), { initialProps: props });
    const change = kind === 'account' ? { accountId: id(90), token: 'other' } : kind === 'model' ? { current: { ...props.current!, modelVersionId: id(91) } }
      : kind === 'preparation' ? { current: { ...props.current!, aggregateId: id(92) } } : { calculation: { ...props.calculation!, preferences: { ...props.calculation!.preferences, secondaryDistanceMeters: 4 } } };
    const next = { ...props, ...change }, nextImpact = { ...impact(), actorId: next.accountId!, current: next.current!, modelVersionId: next.current!.modelVersionId,
      calculation: next.calculation, selectionRevision: next.current!.selectionRevision, contentFingerprint: next.current!.contentFingerprint };
    vi.mocked(fetchLocationImpactProgress).mockResolvedValueOnce(progress(nextImpact)); view.rerender(next); expect(view.result.current.impact).toBeNull();
    await act(async () => { finish(progress()); }); await waitFor(() => expect(view.result.current.impact).toEqual(nextImpact));
    expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(2);
  });
  it('does not restart for equivalent model/config objects or callback/array changes', async () => {
    const props = access(), view = renderHook(value => usePathfinderLocationImpactProgress(value), { initialProps: props }); await waitFor(() => expect(view.result.current.impact).not.toBeNull());
    view.rerender({ ...props, current: { ...props.current! }, calculation: { ...props.calculation!, preferences: { ...props.calculation!.preferences } }, onChanged: vi.fn() });
    expect(fetchLocationImpactProgress).toHaveBeenCalledOnce(); expect(view.result.current.impact?.id).toBe(impactId);
  });
  it('rediscovers the newest matching owned impact, filtering other preparation/configuration without hiding continuation', async () => {
    const wrong = { ...impact(40, 'complete'), calculation: { ...impact().calculation!, timeoutMilliseconds: 10000 } }, matching = impact(30, 'complete');
    vi.mocked(fetchLocationImpacts).mockResolvedValueOnce(page([wrong], wrong.id)).mockResolvedValueOnce(page([matching], null));
    const view = renderHook(() => usePathfinderLocationImpactProgress({ ...access(), impactId: null }));
    await waitFor(() => expect(view.result.current.historyChecked).toBe(1)); expect(view.result.current.history).toEqual([]); expect(view.result.current.impact).toBeNull(); expect(view.result.current.nextBeforeId).toBe(wrong.id);
    await act(async () => { await view.result.current.nextHistoryPage(); }); expect(view.result.current.history).toEqual([matching]); expect(view.result.current.impact?.id).toBe(matching.id); expect(view.result.current.hasPrevious).toBe(true);
    expect(vi.mocked(fetchLocationImpacts).mock.calls[1][3]).toEqual({ beforeId: wrong.id }); expect(fetchLocationImpactProgress).not.toHaveBeenCalled();
  });
  it('preserves a manual impact choice while newer discovery pages or refreshes arrive', async () => {
    vi.mocked(fetchLocationImpacts).mockResolvedValueOnce(page([impact(30, 'complete'), impact(20, 'complete')])).mockResolvedValueOnce(page([impact(50, 'complete')]));
    vi.mocked(fetchLocationImpactProgress).mockResolvedValueOnce(progress(impact(20, 'complete')));
    const view = renderHook(() => usePathfinderLocationImpactProgress({ ...access(), impactId: null })); await waitFor(() => expect(view.result.current.impact?.id).toBe(id(30)));
    await act(async () => { await view.result.current.selectImpact(id(20)); }); await act(async () => { await view.result.current.refreshHistory(); });
    expect(view.result.current.impact?.id).toBe(id(20)); expect(view.result.current.history[0].id).toBe(id(50));
  });
  it('rejects a nonadvancing/reused history cursor without turning it into Viewer authority loss', async () => {
    vi.mocked(fetchLocationImpacts).mockResolvedValueOnce(page([impact(30, 'complete')], id(30))).mockResolvedValueOnce(page([impact(40, 'complete')], id(30)));
    const props = { ...access(), impactId: null }, view = renderHook(() => usePathfinderLocationImpactProgress(props)); await waitFor(() => expect(view.result.current.nextBeforeId).toBe(id(30)));
    await act(async () => { await view.result.current.nextHistoryPage(); }); expect(view.result.current.error).toContain('did not advance'); expect(props.onAuthorityLost).not.toHaveBeenCalled();
  });
  it('refuses a newly fetched exact impact from stale preparation/settings rather than presenting it as current', async () => {
    vi.mocked(fetchLocationImpactProgress).mockResolvedValueOnce(progress({ ...impact(), current: { ...impact().current, geometryRevision: '99' } }));
    const view = renderHook(() => usePathfinderLocationImpactProgress(access())); await waitFor(() => expect(view.result.current.error).toContain('different model preparation')); expect(view.result.current.impact).toBeNull();
  });
  it('stops on access denial until a new login and treats entity404 as an unavailable impact only', async () => {
    const props = access(); vi.mocked(fetchLocationImpactProgress).mockRejectedValueOnce(new LocationImpactApiError('ADMIN_REQUIRED', 403, 'Administrator access required.'));
    const view = renderHook(value => usePathfinderLocationImpactProgress(value), { initialProps: props }); await waitFor(() => expect(view.result.current.enabled).toBe(false));
    await act(async () => { await view.result.current.refresh(); }); expect(fetchLocationImpactProgress).toHaveBeenCalledOnce(); expect(props.onAuthorityLost).toHaveBeenCalledOnce();
    vi.mocked(fetchLocationImpactProgress).mockRejectedValueOnce(new LocationImpactApiError('LOCATION_IMPACT_NOT_FOUND', 404, 'Impact unavailable.'));
    view.rerender({ ...props, token: 'fresh' }); await waitFor(() => expect(view.result.current.error).toBe('Impact unavailable.')); expect(view.result.current.enabled).toBe(true); expect(props.onAuthorityLost).toHaveBeenCalledOnce();
  });
  it('notifies only actual progress transitions, retaining observed durations without inventing ETA', async () => {
    vi.useFakeTimers(); const props = access(); vi.mocked(fetchLocationImpactProgress).mockResolvedValueOnce(progress()).mockResolvedValueOnce(progress({ ...impact(), elapsedMilliseconds: 4000 }))
      .mockResolvedValueOnce(progress({ ...impact(), completed: 2 }));
    const view = renderHook(() => usePathfinderLocationImpactProgress(props)); await act(async () => { await view.result.current.refresh(); await vi.advanceTimersByTimeAsync(LOCATION_IMPACT_POLL_MILLISECONDS); });
    expect(props.onChanged).not.toHaveBeenCalled(); await act(async () => { await vi.advanceTimersByTimeAsync(LOCATION_IMPACT_POLL_MILLISECONDS); }); expect(props.onChanged).toHaveBeenCalledOnce();
    expect(view.result.current.impact?.admissionElapsedMilliseconds).toBe(200); expect(view.result.current.readMilliseconds).toBeGreaterThanOrEqual(0); expect(view.result.current).not.toHaveProperty('eta'); view.unmount();
  });
  it('retains the last verified job during a transient failure and automatically recovers the same exact impact', async () => {
    vi.useFakeTimers(); const props = access();
    vi.mocked(fetchLocationImpactProgress).mockResolvedValueOnce(progress()).mockRejectedValueOnce(new LocationImpactApiError('UNAVAILABLE', 503, 'Temporarily unavailable.'))
      .mockResolvedValueOnce(progress({ ...impact(), completed: 2 }));
    const view = renderHook(() => usePathfinderLocationImpactProgress(props));
    await act(async () => { await view.result.current.refresh(); await vi.advanceTimersByTimeAsync(2000); });
    expect(view.result.current.impact?.jobId).toBe(id(8)); expect(view.result.current.error).toContain('checking again automatically');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(3); expect(view.result.current.impact?.completed).toBe(2);
    expect(props.onAuthorityLost).not.toHaveBeenCalled(); view.unmount();
  });
  it('bounds repeated network failures while retaining verified progress and leaves another burst to explicit refresh', async () => {
    vi.useFakeTimers(); vi.mocked(fetchLocationImpactProgress).mockResolvedValueOnce(progress()).mockRejectedValue(new TypeError('Network'));
    const view = renderHook(() => usePathfinderLocationImpactProgress(access()));
    await act(async () => { await view.result.current.refresh(); await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(5); expect(view.result.current.impact?.jobId).toBe(id(8));
    expect(view.result.current.error).toContain('bounded retries');
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); }); expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(5);
    vi.mocked(fetchLocationImpactProgress).mockResolvedValue(progress(impact(30, 'complete')));
    await act(async () => { await view.result.current.refresh(); }); expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(6);
    expect(view.result.current.impact?.status).toBe('complete'); view.unmount();
  });
  it('reads for a visible owned Save popup while the main document and unrelated progress remain hidden', async () => {
    vi.useFakeTimers(); visibility = 'hidden';
    const frame = document.createElement('iframe'); document.body.appendChild(frame); const popup = frame.contentWindow!;
    Object.defineProperty(popup, 'closed', { configurable: true, value: false });
    vi.spyOn(popup.document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.mocked(fetchLocationImpactProgress).mockRejectedValueOnce(new LocationImpactApiError('UNAVAILABLE', 503, 'Temporarily unavailable.'))
      .mockResolvedValueOnce(progress(impact(30, 'complete')));
    const props = access(), owned = renderHook(() => usePathfinderLocationImpactProgress({ ...props, foregroundWindow: popup }));
    const unrelated = renderHook(() => usePathfinderLocationImpactProgress({ ...props, impactId: id(99) }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchLocationImpactProgress).mock.calls.every(call => call[3] === impactId)).toBe(true);
    expect(owned.result.current.impact?.jobId).toBe(id(8)); expect(owned.result.current.paused).toBe(false);
    expect(unrelated.result.current.paused).toBe(true); expect(unrelated.result.current.impact).toBeNull();
    owned.unmount(); unrelated.unmount(); frame.remove();
  });
  it('suspends a hard scope refusal through visibility resumption until explicit refresh', async () => {
    vi.useFakeTimers(); const props = access();
    vi.mocked(fetchLocationImpactProgress).mockResolvedValueOnce(progress()).mockRejectedValueOnce(new LocationImpactApiError('IMPACT_SCOPE_CHANGED', 409, 'Scope changed.'));
    const view = renderHook(() => usePathfinderLocationImpactProgress(props));
    await act(async () => { await view.result.current.refresh(); await vi.advanceTimersByTimeAsync(2000); });
    expect(view.result.current.impact).toBeNull(); hide('hidden'); hide('visible');
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(2); expect(props.onAuthorityLost).not.toHaveBeenCalled();
    vi.mocked(fetchLocationImpactProgress).mockResolvedValue(progress(impact(30, 'complete')));
    await act(async () => { await view.result.current.refresh(); }); expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(3);
    expect(view.result.current.impact?.status).toBe('complete'); view.unmount();
  });
  it('resumes exact progress on returning to the main tab after popup pagehide precedes its closed flag', async () => {
    vi.useFakeTimers(); visibility = 'hidden';
    const frame = document.createElement('iframe'); document.body.appendChild(frame); const popup = frame.contentWindow!;
    let closed = false; Object.defineProperty(popup, 'closed', { configurable: true, get: () => closed });
    vi.spyOn(popup.document, 'visibilityState', 'get').mockReturnValue('visible');
    const view = renderHook(() => usePathfinderLocationImpactProgress({ ...access(), foregroundWindow: popup }));
    await act(async () => { await view.result.current.refresh(); }); expect(fetchLocationImpactProgress).toHaveBeenCalledOnce();
    act(() => { popup.dispatchEvent(new Event('pagehide')); });
    expect(view.result.current.paused).toBe(true); closed = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); }); expect(fetchLocationImpactProgress).toHaveBeenCalledOnce();
    vi.mocked(fetchLocationImpactProgress).mockResolvedValueOnce(progress(impact(30, 'complete')));
    hide('visible'); await act(async () => { await Promise.resolve(); });
    expect(fetchLocationImpactProgress).toHaveBeenCalledTimes(2); expect(view.result.current.impact?.status).toBe('complete');
    expect(view.result.current.paused).toBe(false); view.unmount(); frame.remove();
  });
  it('keeps verified progress when a consuming display callback fails', async () => {
    const props = { ...access(), onChanged: vi.fn(() => { throw new Error('Display callback unavailable'); }) };
    vi.mocked(fetchLocationImpactProgress).mockResolvedValueOnce(progress(impact(30, 'complete'))).mockResolvedValueOnce(progress({ ...impact(30, 'complete'), readyCables: 2 }));
    const view = renderHook(() => usePathfinderLocationImpactProgress(props)); await waitFor(() => expect(view.result.current.impact?.readyCables).toBe(1));
    await act(async () => { await view.result.current.refresh(); }); expect(view.result.current.impact?.readyCables).toBe(2); expect(view.result.current.error).toContain('Progress was verified');
  });
});
