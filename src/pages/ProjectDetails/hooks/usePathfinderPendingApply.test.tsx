import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_APPLY_STORAGE_KEY, usePathfinderPendingApply, type PendingApplyAccess, type PendingApplyInput } from './usePathfinderPendingApply';

const id = (value: number) => `40000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const input: PendingApplyInput = { proposalId: id(3), proposalHash: 'a'.repeat(64), cableId: id(4), reviewId: id(5),
  expectedCableWriteRevision: '9', revisionResultHash: 'b'.repeat(64) };
const access = (): PendingApplyAccess => ({ projectId: id(1), loadedProjectId: id(1), accountId: id(2), token: 'private-bearer-token',
  isAdmin: true, active: true, action: vi.fn(async () => null) });
function receipt(body: PendingApplyInput = input) {
  return { duplicate: true, receipt: { id: id(7), projectId: id(1), proposalId: body.proposalId, cableId: body.cableId,
    appliedAt: '2026-10-19T14:00:00Z',
    before: { id: body.cableId, project_id: id(1), cable_write_revision: body.expectedCableWriteRevision },
    after: { id: body.cableId, project_id: id(1), cable_write_revision: '10' },
    provenance: { schemaVersion: 'pathfinder.apply.v2', proposalId: body.proposalId, proposalHash: body.proposalHash,
      reviewId: body.reviewId, review: { id: body.reviewId, actorId: id(2) }, revisionResult: { revisionResultSha256: body.revisionResultHash } } } };
}
const stored = () => JSON.parse(sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY)!);
function recovery(status: 'already-applied' | 'closed-without-apply') {
  const pending = stored().intents[0];
  return { schemaVersion: 'wfc.pf.apply-recovery.v1', projectId: pending.projectId, proposalId: pending.proposalId,
    idempotencyKey: pending.idempotencyKey, reviewId: pending.reviewId, expectedCableWriteRevision: pending.expectedCableWriteRevision,
    status, duplicate: false, receipt: status === 'already-applied' ? receipt().receipt : null };
}
beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

describe('durable human Apply recovery', () => {
  it('retains the exact command before the first POST and never stores a bearer', async () => {
    const props = access();
    props.action = vi.fn(async (_path, body) => {
      expect(stored().intents[0]).toMatchObject({ ...input, projectId: id(1), accountId: id(2) });
      expect(body).toEqual({ idempotencyKey: stored().intents[0].idempotencyKey, reviewId: id(5), expectedCableWriteRevision: '9' });
      return null;
    });
    const view = renderHook(value => usePathfinderPendingApply(value), { initialProps: props });
    await waitFor(() => expect(view.result.current.canStart).toBe(true));
    await act(async () => { await view.result.current.start(input); });
    expect(props.action).toHaveBeenCalledTimes(1); expect(view.result.current.pending).not.toBeNull();
    expect(view.result.current.canStart).toBe(false); expect(view.result.current.canRetry).toBe(true);
    expect(sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY)).not.toContain('private-bearer-token');
    expect(view.result.current.error).toMatch(/unconfirmed/);
  });

  it('retries the identical body after a lost acknowledgement and clears only the matching receipt', async () => {
    const props = access(), action = vi.mocked(props.action); action.mockResolvedValueOnce(null).mockResolvedValueOnce(receipt());
    const view = renderHook(() => usePathfinderPendingApply(props));
    await waitFor(() => expect(view.result.current.canStart).toBe(true));
    await act(async () => { await view.result.current.start(input); });
    const original = action.mock.calls[0];
    await act(async () => { await view.result.current.start({ ...input, proposalId: id(8) }); });
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => { expect(await view.result.current.retry()).toBe(true); });
    expect(action.mock.calls[1]).toEqual(original);
    expect(view.result.current.pending).toBeNull(); expect(stored().intents).toHaveLength(0);
    expect(view.result.current.message).toMatch(/matching Apply receipt is confirmed/);
  });

  it('closes only on an explicit exact tombstone acknowledgment and never reports that cable data was applied', async () => {
    const props = access(), action = vi.mocked(props.action);
    action.mockResolvedValueOnce(null).mockImplementationOnce(async () => recovery('closed-without-apply'));
    const view = renderHook(() => usePathfinderPendingApply(props)); await waitFor(() => expect(view.result.current.canStart).toBe(true));
    await act(async () => { await view.result.current.start(input); }); const original = action.mock.calls[0][1];
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => { expect(await view.result.current.close()).toBe(true); });
    expect(action.mock.calls[1]).toEqual([`/proposals/${input.proposalId}/close-pending-apply`, original]);
    expect(view.result.current.pending).toBeNull(); expect(stored().intents).toHaveLength(0);
    expect(view.result.current.message).toMatch(/closed without applying/); expect(view.result.current.message).toMatch(/blocked from any later Apply/);
    expect(view.result.current.message).not.toMatch(/applied together/);
  });

  it('recognizes an already-applied close response only through its exact existing receipt', async () => {
    const props = access(), action = vi.mocked(props.action);
    action.mockResolvedValueOnce(null).mockImplementationOnce(async () => recovery('already-applied'));
    const view = renderHook(() => usePathfinderPendingApply(props)); await waitFor(() => expect(view.result.current.canStart).toBe(true));
    await act(async () => { await view.result.current.start(input); });
    await act(async () => { expect(await view.result.current.close()).toBe(true); });
    expect(view.result.current.pending).toBeNull(); expect(view.result.current.message).toMatch(/matching Apply receipt is confirmed/);
  });

  it.each(['project', 'proposal', 'key', 'review', 'revision', 'wrong-receipt', 'closed-with-receipt', 'missing-receipt'])('retains recovery after a mismatched close acknowledgment: %s', async field => {
    const props = access(), action = vi.mocked(props.action); action.mockResolvedValueOnce(null).mockImplementationOnce(async () => {
      const result = recovery(field === 'closed-with-receipt' ? 'closed-without-apply' : 'already-applied');
      if (field === 'project') result.projectId = id(30);
      if (field === 'proposal') result.proposalId = id(30);
      if (field === 'key') result.idempotencyKey = id(30);
      if (field === 'review') result.reviewId = id(30);
      if (field === 'revision') result.expectedCableWriteRevision = '10';
      if (field === 'wrong-receipt') result.receipt!.provenance.proposalHash = 'c'.repeat(64);
      if (field === 'closed-with-receipt') result.receipt = receipt().receipt;
      if (field === 'missing-receipt') result.receipt = null;
      return result;
    });
    const view = renderHook(() => usePathfinderPendingApply(props)); await waitFor(() => expect(view.result.current.canStart).toBe(true));
    await act(async () => { await view.result.current.start(input); }); const original = stored().intents[0];
    await act(async () => { expect(await view.result.current.close()).toBe(false); });
    expect(view.result.current.pending).toEqual(original); expect(stored().intents).toEqual([original]);
    expect(view.result.current.error).toMatch(/does not match/);
  });

  it('keeps the same command after an unacknowledged close and permits an exact repeat', async () => {
    const props = access(), action = vi.mocked(props.action); action.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      .mockImplementationOnce(async () => ({ ...recovery('closed-without-apply'), duplicate: true }));
    const view = renderHook(() => usePathfinderPendingApply(props)); await waitFor(() => expect(view.result.current.canStart).toBe(true));
    await act(async () => { await view.result.current.start(input); });
    await act(async () => { expect(await view.result.current.close()).toBe(false); }); expect(view.result.current.pending).not.toBeNull();
    await act(async () => { expect(await view.result.current.close()).toBe(true); });
    expect(action.mock.calls[2]).toEqual(action.mock.calls[1]); expect(view.result.current.pending).toBeNull();
  });

  it.each(['project', 'proposal', 'cable', 'hash', 'review', 'actor', 'write-revision', 'seal', 'truthy-object'])('retains a pending command after a mismatched %s receipt', async field => {
    const props = access(), bad = receipt();
    if (field === 'project') bad.receipt.projectId = id(8);
    if (field === 'proposal') bad.receipt.proposalId = id(8);
    if (field === 'cable') bad.receipt.cableId = id(8);
    if (field === 'hash') bad.receipt.provenance.proposalHash = 'c'.repeat(64);
    if (field === 'review') bad.receipt.provenance.reviewId = id(8);
    if (field === 'actor') bad.receipt.provenance.review.actorId = id(8);
    if (field === 'write-revision') bad.receipt.before.cable_write_revision = '10';
    if (field === 'seal') bad.receipt.provenance.revisionResult.revisionResultSha256 = 'c'.repeat(64);
    vi.mocked(props.action).mockResolvedValue(field === 'truthy-object' ? {} : bad);
    const view = renderHook(() => usePathfinderPendingApply(props)); await waitFor(() => expect(view.result.current.canStart).toBe(true));
    await act(async () => { expect(await view.result.current.start(input)).toBe(false); });
    expect(view.result.current.pending).not.toBeNull(); expect(stored().intents).toHaveLength(1);
    expect(view.result.current.error).toMatch(/does not match/);
  });

  it('recovers after unmount/reload without a POST and uses the old key only on explicit retry', async () => {
    const props = access(), first = renderHook(() => usePathfinderPendingApply(props));
    await waitFor(() => expect(first.result.current.canStart).toBe(true));
    await act(async () => { await first.result.current.start(input); });
    const exact = vi.mocked(props.action).mock.calls[0]; first.unmount();
    const next = { ...props, token: 'new-current-login', action: vi.fn(async () => receipt()) };
    const view = renderHook(() => usePathfinderPendingApply(next));
    await waitFor(() => expect(view.result.current.pending).not.toBeNull()); expect(next.action).not.toHaveBeenCalled();
    await act(async () => { await view.result.current.retry(); }); expect(vi.mocked(next.action).mock.calls[0]).toEqual(exact);
    expect(view.result.current.pending).toBeNull();
  });

  it.each([
    { accountId: id(20) }, { projectId: id(20), loadedProjectId: id(20) }, { isAdmin: false },
    { loadedProjectId: id(20) }, { accountId: null }, { token: null },
  ])('fences reads and replay for changed ownership: %j', async change => {
    const props = access(), view = renderHook(value => usePathfinderPendingApply(value), { initialProps: props });
    await waitFor(() => expect(view.result.current.canStart).toBe(true));
    await act(async () => { await view.result.current.start(input); }); const retained = sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY);
    view.rerender({ ...props, ...change }); expect(view.result.current.pending).toBeNull();
    await act(async () => { await view.result.current.retry(); await view.result.current.close(); }); expect(props.action).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY)).toBe(retained);
    view.rerender(props); await waitFor(() => expect(view.result.current.pending).not.toBeNull());
    expect(view.result.current.pending?.accountId).toBe(id(2)); expect(props.action).toHaveBeenCalledTimes(1);
  });

  it('keeps the original command during inactive tools and does not replay automatically on return', async () => {
    const props = access(), view = renderHook(value => usePathfinderPendingApply(value), { initialProps: props });
    await waitFor(() => expect(view.result.current.canStart).toBe(true));
    await act(async () => { await view.result.current.start(input); }); const original = stored().intents[0];
    view.rerender({ ...props, active: false }); expect(view.result.current.pending).toEqual(original);
    await act(async () => { await view.result.current.retry(); }); expect(props.action).toHaveBeenCalledTimes(1);
    view.rerender(props); expect(view.result.current.canRetry).toBe(true); expect(props.action).toHaveBeenCalledTimes(1);
  });

  it('admits only one exact command under double activation while its response is outstanding', async () => {
    const props = access(); let finish!: (value: null) => void;
    props.action = vi.fn(() => new Promise<null>(resolve => { finish = resolve; }));
    const view = renderHook(() => usePathfinderPendingApply(props)); await waitFor(() => expect(view.result.current.canStart).toBe(true));
    let completion!: Promise<boolean>;
    act(() => { completion = view.result.current.start(input); void view.result.current.start(input); void view.result.current.retry(); });
    expect(props.action).toHaveBeenCalledTimes(1); expect(stored().intents).toHaveLength(1);
    await act(async () => { finish(null); await completion; }); expect(view.result.current.pending).not.toBeNull();
  });

  it('fences a late old-account receipt and retains recovery for the original account', async () => {
    const props = access(); let finish!: (value: Record<string, unknown>) => void;
    props.action = vi.fn(() => new Promise<Record<string, unknown>>(resolve => { finish = resolve; }));
    const view = renderHook(value => usePathfinderPendingApply(value), { initialProps: props });
    await waitFor(() => expect(view.result.current.canStart).toBe(true)); let completion!: Promise<boolean>;
    act(() => { completion = view.result.current.start(input); }); view.rerender({ ...props, accountId: id(20) });
    await act(async () => { finish(receipt()); await completion; });
    expect(stored().intents).toHaveLength(1); expect(view.result.current.pending).toBeNull();
    view.rerender(props); await waitFor(() => expect(view.result.current.pending?.idempotencyKey).toBe(stored().intents[0].idempotencyKey));
  });

  it('refuses to POST when browser storage is unavailable and preserves corrupt recovery rather than deleting it', async () => {
    const props = access(), raw = '{broken recovery'; sessionStorage.setItem(PENDING_APPLY_STORAGE_KEY, raw);
    const view = renderHook(() => usePathfinderPendingApply(props));
    await waitFor(() => expect(view.result.current.error).toMatch(/unavailable or invalid/));
    await act(async () => { await view.result.current.start(input); }); expect(props.action).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY)).toBe(raw); view.unmount(); sessionStorage.clear();
    const next = renderHook(() => usePathfinderPendingApply(props)); await waitFor(() => expect(next.result.current.canStart).toBe(true));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded'); });
    await act(async () => { await next.result.current.start(input); });
    expect(props.action).not.toHaveBeenCalled(); expect(next.result.current.canStart).toBe(false);
  });

  it('bounds retained owners without expiring or replacing unresolved commands', async () => {
    const props = access();
    const intents = Array.from({ length: 8 }, (_, index) => ({ ...input, projectId: id(100 + index), accountId: id(2),
      idempotencyKey: id(200 + index), createdAt: '2020-01-01T00:00:00Z' }));
    sessionStorage.setItem(PENDING_APPLY_STORAGE_KEY, JSON.stringify({ version: 1, intents }));
    const view = renderHook(() => usePathfinderPendingApply(props)); await waitFor(() => expect(view.result.current.canStart).toBe(true));
    await act(async () => { await view.result.current.start(input); });
    expect(props.action).not.toHaveBeenCalled(); expect(stored().intents).toEqual(intents);
    expect(view.result.current.error).toMatch(/No new Apply/);
  });
});
