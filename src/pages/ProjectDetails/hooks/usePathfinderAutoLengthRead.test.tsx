import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCableDetails } from '@/api/cables';
import { usePathfinderAutoLengthRead, AUTO_LENGTH_READ_TIMEOUT_MS } from './usePathfinderAutoLengthRead';
import type { AutoLengthView } from '../../../../shared/pathfinderAutoLength';

vi.mock('@/api/cables', () => ({ fetchCableDetails: vi.fn() }));
const id = (value: number) => `96000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const successful: AutoLengthView = { autoCalculatedLength: 54, autoLengthStatus: 'calculated',
  autoLengthCalculatedAt: '2026-10-21T12:00:00Z', autoLengthBarrierStatus: 'clear', autoLengthMatchesLatestRequest: true };
const input = () => ({ projectId: id(1), loadedProjectId: id(1), accountId: id(2), token: 'current-test-token', isAdmin: true, active: true,
  selectedCableId: id(3), item: { projectId: id(1), cableId: id(3), jobId: id(4), proposalId: id(5),
    proposalHash: 'a'.repeat(64), revisionResultHash: 'b'.repeat(64), dependencyHash: 'c'.repeat(64) }, writeRefreshKey: 0 });
function response(length = 54) {
  return { cable: { id: id(3), projectId: id(1), designLength: 777, ...successful, autoCalculatedLength: length } } as Awaited<ReturnType<typeof fetchCableDetails>>;
}
beforeEach(() => { vi.mocked(fetchCableDetails).mockReset().mockResolvedValue(response()); });
afterEach(() => { vi.useRealTimers(); });
describe('ordinary read of the selected cable Auto projection', () => {
  it('reads once per exact item despite new polling objects and refreshes once for a new seal or committed write', async () => {
    const current = input(), view = renderHook(props => usePathfinderAutoLengthRead(props), { initialProps: current });
    await waitFor(() => expect(view.result.current.view?.autoCalculatedLength).toBe(54));
    expect(fetchCableDetails).toHaveBeenCalledExactlyOnceWith(id(1), id(3));
    view.rerender({ ...current, item: { ...current.item } }); await act(async () => {});
    expect(fetchCableDetails).toHaveBeenCalledOnce();
    vi.mocked(fetchCableDetails).mockResolvedValueOnce(response(61));
    const next = { ...current, item: { ...current.item, proposalId: id(6), revisionResultHash: 'd'.repeat(64) } };
    view.rerender(next); await waitFor(() => expect(view.result.current.view?.autoCalculatedLength).toBe(61));
    expect(fetchCableDetails).toHaveBeenCalledTimes(2);
    view.rerender({ ...next, writeRefreshKey: 1 }); await waitFor(() => expect(fetchCableDetails).toHaveBeenCalledTimes(3));
    expect(view.result.current.view?.autoCalculatedLength).not.toBe(777);
  });
  it('rejects an old account response and ignores a retained retry action after the selected cable changes', async () => {
    let finishOld!: (value: ReturnType<typeof response>) => void;
    vi.mocked(fetchCableDetails).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockResolvedValueOnce(response(61));
    const current = input(), view = renderHook(props => usePathfinderAutoLengthRead(props), { initialProps: current });
    view.rerender({ ...current, accountId: id(9), token: 'new-test-token' });
    await waitFor(() => expect(view.result.current.view?.autoCalculatedLength).toBe(61));
    const oldRefresh = view.result.current.refresh;
    await act(async () => finishOld(response(99)));
    expect(view.result.current.view?.autoCalculatedLength).toBe(61);
    view.rerender({ ...current, selectedCableId: id(99) }); act(() => oldRefresh());
    expect(view.result.current.view).toBeNull(); expect(fetchCableDetails).toHaveBeenCalledTimes(2);
  });
  it('reports an unavailable ordinary read and retries explicitly without borrowing Design', async () => {
    vi.mocked(fetchCableDetails).mockRejectedValueOnce(new Error('Unavailable'));
    const view = renderHook(() => usePathfinderAutoLengthRead(input()));
    await waitFor(() => expect(view.result.current.error).toMatch(/could not be refreshed/));
    expect(view.result.current.view?.autoCalculatedLength).toBeNull();
    act(() => view.result.current.refresh()); await waitFor(() => expect(view.result.current.view?.autoCalculatedLength).toBe(54));
    expect(fetchCableDetails).toHaveBeenCalledTimes(2);
  });
  it('refuses a mismatched cable response and a legacy DTO with no checked Auto fields', async () => {
    vi.mocked(fetchCableDetails).mockResolvedValueOnce({ ...response(), cable: { ...response().cable, id: id(99) } });
    const view = renderHook(() => usePathfinderAutoLengthRead(input()));
    await waitFor(() => expect(view.result.current.error).not.toBeNull());
    expect(view.result.current.view?.autoCalculatedLength).toBeNull();
    vi.mocked(fetchCableDetails).mockResolvedValueOnce({ ...response(), cable: { ...response().cable, autoCalculatedLength: undefined } });
    act(() => view.result.current.refresh()); await waitFor(() => expect(fetchCableDetails).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.result.current.error).not.toBeNull());
    expect(view.result.current.view?.autoCalculatedLength).toBeNull();
  });
  it('bounds an unanswered read and ignores its later success until an explicit retry', async () => {
    vi.useFakeTimers(); let finish!: (value: ReturnType<typeof response>) => void;
    vi.mocked(fetchCableDetails).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(() => usePathfinderAutoLengthRead(input()));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_LENGTH_READ_TIMEOUT_MS); });
    expect(view.result.current.loading).toBe(false); expect(view.result.current.error).toMatch(/could not be refreshed/);
    await act(async () => finish(response()));
    expect(view.result.current.view?.autoCalculatedLength).toBeNull(); expect(fetchCableDetails).toHaveBeenCalledOnce();
  });
});
