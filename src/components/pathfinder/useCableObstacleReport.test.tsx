import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPathFinderProposal, type PathFinderProposal } from '@/api/pathfinder';
import type { AnyBarrierExecution } from '../../../shared/pathfinderBarrierSupported';
import { useCableObstacleReport } from './useCableObstacleReport';

vi.mock('@/api/pathfinder', () => ({ fetchPathFinderProposal: vi.fn() }));
type Input = Parameters<typeof useCableObstacleReport>[0];
const report = { obstacleReport: { crossedParentSelectionIds: ['actual-crossing'] } } as unknown as AnyBarrierExecution;
const oldReport = { obstacleReport: { crossedParentSelectionIds: ['older-route'] } } as unknown as AnyBarrierExecution;
const input = (): Input => ({ active: true, projectId: 'project', accountId: 'account', token: 'token', cableId: 'cable',
  current: { jobId: 'job', proposalId: 'proposal' }, pending: false, stopped: false, useSaved: false });
const proposal = (patch: Partial<PathFinderProposal> = {}) => ({ projectId: 'project', cableId: 'cable', jobId: 'job', id: 'proposal', barriers: report, ...patch }) as PathFinderProposal;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(fetchPathFinderProposal).mockResolvedValue(proposal()); });
afterEach(cleanup);

describe('exact cable obstacle report read', () => {
  it('uses the matching already read review without another request', () => {
    const value = input(); value.review = { cableId: 'cable', proposalId: 'proposal', barriers: report };
    const { result } = renderHook(() => useCableObstacleReport(value));
    expect(result.current.execution).toBe(report); expect(fetchPathFinderProposal).not.toHaveBeenCalled();
  });
  it('treats an already loaded historical proposal without a report as unknown', () => {
    const value = input(); value.review = { cableId: 'cable', proposalId: 'proposal' };
    const { result } = renderHook(() => useCableObstacleReport(value));
    expect(result.current).toMatchObject({ execution: null, loading: false }); expect(fetchPathFinderProposal).not.toHaveBeenCalled();
  });
  it('clears previous evidence while a new calculation is pending', () => {
    const value = input(); value.pending = true; value.review = { cableId: 'cable', proposalId: 'proposal', barriers: oldReport };
    const { result } = renderHook(() => useCableObstacleReport(value));
    expect(result.current).toMatchObject({ execution: null, loading: true }); expect(fetchPathFinderProposal).not.toHaveBeenCalled();
  });
  it('loads a failed result by its exact job diagnostic and never borrows the old review', async () => {
    const value = input(); value.stopped = true; value.current.proposalId = null;
    value.diagnostics = { cableId: 'cable', jobId: 'job', proposalId: 'proposal' };
    value.review = { cableId: 'cable', proposalId: 'old', barriers: oldReport };
    const { result } = renderHook(() => useCableObstacleReport(value));
    expect(result.current.execution).toBeNull();
    await waitFor(() => expect(result.current.execution).toBe(report));
    expect(fetchPathFinderProposal).toHaveBeenCalledWith('project', 'token', 'proposal', expect.any(AbortSignal));
  });
  it.each([{ projectId: 'other' }, { cableId: 'other' }, { jobId: 'other' }, { id: 'other' }])('refuses mismatched response identity %s', async patch => {
    vi.mocked(fetchPathFinderProposal).mockResolvedValue(proposal(patch));
    const { result } = renderHook(() => useCableObstacleReport(input()));
    await waitFor(() => expect(result.current.error).not.toBeNull()); expect(result.current.execution).toBeNull();
  });
  it('does not revive a late response after switching cables', async () => {
    let finish!: (value: PathFinderProposal) => void;
    vi.mocked(fetchPathFinderProposal).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = input(), { result, rerender } = renderHook(value => useCableObstacleReport(value), { initialProps: first });
    rerender({ ...first, cableId: 'next', pending: true });
    await act(async () => finish(proposal()));
    expect(result.current).toMatchObject({ execution: null, loading: true });
  });
  it('keeps a failed read unavailable and permits a read-only retry', async () => {
    vi.mocked(fetchPathFinderProposal).mockRejectedValueOnce(new Error('offline'));
    const value = input(); value.stopped = true; value.diagnostics = { cableId: 'cable', jobId: 'job', proposalId: 'proposal' };
    value.review = { cableId: 'cable', proposalId: 'old', barriers: oldReport };
    const { result } = renderHook(() => useCableObstacleReport(value));
    await waitFor(() => expect(result.current.error).not.toBeNull()); expect(result.current.execution).toBeNull();
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.execution).toBe(report)); expect(fetchPathFinderProposal).toHaveBeenCalledTimes(2);
  });
  it('does not use an automatic proposal as evidence for an unverified stored route', () => {
    const value = input(); value.useSaved = true; value.saved = null;
    const { result } = renderHook(() => useCableObstacleReport(value));
    expect(result.current).toMatchObject({ execution: null, loading: false }); expect(fetchPathFinderProposal).not.toHaveBeenCalled();
  });
  it('waits for matching failed job diagnostics and ignores another job', () => {
    const value = input(); value.stopped = true; value.diagnostics = { cableId: 'cable', jobId: 'older-job', proposalId: 'old' };
    const { result } = renderHook(() => useCableObstacleReport(value));
    expect(result.current).toMatchObject({ execution: null, loading: true }); expect(fetchPathFinderProposal).not.toHaveBeenCalled();
  });
  it('aborts the pending read on unmount', () => {
    vi.mocked(fetchPathFinderProposal).mockImplementation(() => new Promise(() => {}));
    const { unmount } = renderHook(() => useCableObstacleReport(input()));
    const signal = vi.mocked(fetchPathFinderProposal).mock.calls[0][3]!; unmount(); expect(signal.aborted).toBe(true);
  });
});
