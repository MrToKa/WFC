import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useModelRevisionChanges,
  type ModelRevisionChangesAccess,
} from './useModelRevisionChanges';
import {
  fetchRevisionComparisonContext,
  fetchRevisionComparisons,
  fetchRevisionComparison,
  createRevisionComparison,
  fetchRevisionChanges,
  fetchRevisionDecisionHistory,
  saveRevisionDecision,
  RevisionChangesApiError,
} from '@/api/pathfinderRevisionChanges';
import { revisionComparisonFixture, revisionIds as ids } from '@/test/revisionComparisonFixtures';
vi.mock('@/api/pathfinderRevisionChanges', async (original) => ({
  ...(await original<typeof import('@/api/pathfinderRevisionChanges')>()),
  fetchRevisionComparisonContext: vi.fn(),
  fetchRevisionComparisons: vi.fn(),
  fetchRevisionComparison: vi.fn(),
  createRevisionComparison: vi.fn(),
  fetchRevisionChanges: vi.fn(),
  fetchRevisionDecisionHistory: vi.fn(),
  saveRevisionDecision: vi.fn(),
  fetchRevisionDecisionHead: vi.fn(),
}));
const access = (): ModelRevisionChangesAccess => ({
  projectId: ids.project,
  loadedProjectId: ids.project,
  token: 'token',
  isAdmin: true,
  active: true,
  contextKey: 'model-A',
  onAuthorityLost: vi.fn(),
  onDecisionSaved: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  const f = revisionComparisonFixture();
  vi.mocked(fetchRevisionComparisonContext).mockResolvedValue(f.context);
  vi.mocked(fetchRevisionComparisons).mockResolvedValue(f.list);
  vi.mocked(fetchRevisionComparison).mockResolvedValue(f.manifest);
  vi.mocked(createRevisionComparison).mockResolvedValue(f.receipt);
  vi.mocked(fetchRevisionChanges).mockResolvedValue(f.page);
  vi.mocked(fetchRevisionDecisionHistory).mockResolvedValue(f.history);
  vi.mocked(saveRevisionDecision).mockResolvedValue(f.decisionReceipt);
});
describe('immutable comparison lifecycle', () => {
  it('retains the exact immutable unknown decision body/key across generations and clears it on account change', async () => {
    const f = revisionComparisonFixture(),
      props = access();
    vi.mocked(saveRevisionDecision).mockRejectedValueOnce(
      new RevisionChangesApiError('COMMIT_UNKNOWN', 503, 'Reconcile same intent.', 'unknown'),
    );
    const { result, rerender } = renderHook((value) => useModelRevisionChanges(value), {
      initialProps: props,
    });
    await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.decide(ids.comparison, f.write));
    const command = vi.mocked(saveRevisionDecision).mock.calls[0][3];
    expect(Object.isFrozen(command.body)).toBe(true);
    if (f.write.kind === 'object-mapping') f.write.body.targetObjectRevisionIds.push(ids.actor);
    rerender({ ...props, contextKey: 'next-generation' });
    await waitFor(() => expect(result.current.unknown).toBe(true));
    await act(() => result.current.retry());
    expect(vi.mocked(saveRevisionDecision).mock.calls[1][3]).toBe(command);
    expect(command.kind === 'object-mapping' && command.body.targetObjectRevisionIds).toEqual([
      ids.targetObject,
    ]);
    vi.mocked(saveRevisionDecision).mockRejectedValueOnce(new TypeError('Unknown again'));
    await act(() => result.current.decide(ids.comparison, revisionComparisonFixture().write));
    rerender({ ...props, token: 'other-account' });
    expect(result.current.pending).toBeNull();
    await waitFor(() => expect(result.current.unknown).toBe(false));
  });
  it('locks and retries the exact unknown pair command across viewer generations', async () => {
    const f = revisionComparisonFixture(),
      props = access();
    vi.mocked(createRevisionComparison).mockRejectedValueOnce(new TypeError('Lost ACK'));
    const { result, rerender } = renderHook((value) => useModelRevisionChanges(value), {
      initialProps: props,
    });
    await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(() => result.current.create(f.create));
    expect(result.current.unknown).toBe(true);
    const command = vi.mocked(createRevisionComparison).mock.calls[0][2];
    await act(() => result.current.create({ ...f.create, reason: 'New intent' }));
    expect(createRevisionComparison).toHaveBeenCalledOnce();
    rerender({ ...props, contextKey: 'model-B' });
    await waitFor(() => expect(result.current.unknown).toBe(true));
    await act(() => result.current.retry());
    expect(vi.mocked(createRevisionComparison).mock.calls[1][2]).toBe(command);
    expect(result.current.manifest?.id).toBe(ids.comparison);
    expect(result.current.unknown).toBe(false);
  });
  it('discards late access-scoped reads and refuses page/manifest mismatch', async () => {
    const f = revisionComparisonFixture();
    let resolve!: (value: typeof f.context) => void;
    vi.mocked(fetchRevisionComparisonContext).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const props = access(),
      { result, rerender } = renderHook((value) => useModelRevisionChanges(value), {
        initialProps: props,
      });
    rerender({ ...props, token: 'new-token' });
    await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(async () => resolve({ ...f.context, comparisonRevision: '999' }));
    expect(result.current.context?.comparisonRevision).toBe('1');
    vi.mocked(fetchRevisionChanges).mockResolvedValueOnce({
      ...f.page,
      contentSha256: '0'.repeat(64),
    });
    await act(() => result.current.open(ids.comparison));
    expect(result.current.page).toBeNull();
    expect(result.current.error).not.toBeNull();
  });
  it('clears revoked authority and never reclassifies confirmed decisions after refresh failure', async () => {
    const f = revisionComparisonFixture(),
      props = access(),
      { result } = renderHook(() => useModelRevisionChanges(props));
    await waitFor(() => expect(result.current.context).not.toBeNull());
    vi.mocked(fetchRevisionComparisonContext).mockRejectedValueOnce(
      new Error('Read after commit failed'),
    );
    await act(() => result.current.decide(ids.comparison, f.write));
    expect(result.current.unknown).toBe(false);
    expect(props.onDecisionSaved).toHaveBeenCalledOnce();
    vi.mocked(createRevisionComparison).mockRejectedValueOnce(
      new RevisionChangesApiError('ADMIN_REQUIRED', 403, 'Administrator required.', 'refused'),
    );
    await act(() => result.current.create(f.create));
    expect(result.current.context).toBeNull();
    expect(props.onAuthorityLost).toHaveBeenCalledOnce();
  });
});
