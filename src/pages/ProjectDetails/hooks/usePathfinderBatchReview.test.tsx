import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PathFinderProposal } from '@/api/pathfinder';
import { PENDING_APPLY_STORAGE_KEY, usePathfinderPendingApply, type PendingApplyInput } from './usePathfinderPendingApply';
import { MAX_BATCH_REVIEW_SELECTION, usePathfinderBatchReview, type BatchReviewAccess, type BatchReviewCandidate } from './usePathfinderBatchReview';

const id = (value: number) => `51000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const options = { secondaryDistanceMeters: 2, preferVerticalApproach: true };
const candidate = (value: number): BatchReviewCandidate => ({ proposalId: id(value), proposalHash: 'a'.repeat(64),
  revisionResultHash: 'b'.repeat(64), cableId: id(value + 10_000), cableWriteRevision: '9', tag: `Synthetic cable ${value}`,
  routeText: `/TEST-${value}`, designLength: '42' });
function proposal(value: BatchReviewCandidate): PathFinderProposal {
  return { id: value.proposalId, projectId: id(1), jobId: id(2), cableId: value.cableId, status: 'calculated',
    proposalHash: value.proposalHash, revisionResultHash: value.revisionResultHash, cableWriteRevision: value.cableWriteRevision,
    stale: false, synthetic: true, engineeringAccepted: true, acceptanceScope: 'local-synthetic-fixture', canApply: true,
    compatibilityIssue: null, message: 'Synthetic result', engineeringMessage: 'Synthetic fixture only',
    design: { lengthBeforePercentageMeters: '38', unroundedLengthMeters: '41.8', designLengthMeters: value.designLength },
    route: { success: true, message: 'Synthetic path', routeText: value.routeText, routeCodes: [value.routeText], segmentIds: ['dbid:1'],
      points: [[0, 0, 0], [10, 0, 0]], objectIds: ['dbid:1'], lengthMeters: 10, fromDistanceMeters: 0, toDistanceMeters: 0,
      fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 },
    routingPreferences: { ...options }, createdAt: '2026-10-20T00:00:00Z' };
}
function fixture(values = [candidate(10), candidate(11)]) {
  const proposals = new Map(values.map(value => [value.proposalId, proposal(value)]));
  const access: BatchReviewAccess = { identityKey: 'synthetic-account/project/login', contextKey: 'synthetic-dependencies-1',
    active: true, blocked: false, options,
    readProposal: vi.fn(async value => proposals.get(value) ?? null),
    reviewProposal: vi.fn(async value => ({ reviewId: id(Number(value.id.slice(-12)) + 20_000), proposal: value })),
    pendingApply: { canStart: true, start: vi.fn(async (_input: PendingApplyInput) => true) }, onApplied: vi.fn() };
  const view = renderHook((props: BatchReviewAccess) => usePathfinderBatchReview(props), { initialProps: access });
  const selectAll = () => act(() => { for (const value of values) view.result.current.select(value, true); });
  return { access, view, values, proposals, selectAll };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
async function reviewAll(value: ReturnType<typeof fixture>) {
  value.selectAll(); await act(async () => { expect(await value.view.result.current.confirmReview()).toBe(true); });
}
function applyReceipt(value: BatchReviewCandidate) {
  const reviewId = id(Number(value.proposalId.slice(-12)) + 20_000);
  return { duplicate: false, receipt: { id: id(Number(value.proposalId.slice(-12)) + 30_000), projectId: id(1),
    proposalId: value.proposalId, cableId: value.cableId, appliedAt: '2026-10-20T00:00:00Z',
    before: { id: value.cableId, project_id: id(1), cable_write_revision: value.cableWriteRevision },
    after: { id: value.cableId, project_id: id(1), cable_write_revision: '10' },
    provenance: { schemaVersion: 'pathfinder.apply.v2', proposalId: value.proposalId, proposalHash: value.proposalHash,
      reviewId, review: { id: reviewId, actorId: id(8) }, revisionResult: { revisionResultSha256: value.revisionResultHash } } } };
}
function actualPendingFixture(values: BatchReviewCandidate[]) {
  sessionStorage.clear();
  const readProposal = vi.fn(async (key: string) => values.find(value => value.proposalId === key) ? proposal(values.find(value => value.proposalId === key)!) : null);
  const reviewProposal = vi.fn(async (value: PathFinderProposal) => ({ reviewId: id(Number(value.id.slice(-12)) + 20_000), proposal: value }));
  const action = vi.fn<(_path: string, _body: unknown) => Promise<Record<string, unknown> | null>>(), onApplied = vi.fn();
  const view = renderHook(() => {
    const pendingApply = usePathfinderPendingApply({ projectId: id(1), loadedProjectId: id(1), accountId: id(8),
      token: 'synthetic-bearer-only', isAdmin: true, active: true, action });
    return usePathfinderBatchReview({ identityKey: 'synthetic-live-hooks', contextKey: 'dependencies-1', options,
      active: true, blocked: false, readProposal, reviewProposal, pendingApply, onApplied });
  });
  return { view, values, action, onApplied, selectAll: () => act(() => { for (const value of values) view.result.current.select(value, true); }) };
}

describe('explicit bounded batch Review and Apply', () => {
  it('never sends requests on mount or selection and requires separate review and Apply actions', async () => {
    const f = fixture(); f.selectAll();
    expect(f.access.readProposal).not.toHaveBeenCalled(); expect(f.access.reviewProposal).not.toHaveBeenCalled();
    expect(f.access.pendingApply.start).not.toHaveBeenCalled(); expect(f.view.result.current.canApply).toBe(false);
    await act(async () => { expect(await f.view.result.current.confirmReview()).toBe(true); });
    expect(f.access.reviewProposal).toHaveBeenCalledTimes(2); expect(f.access.pendingApply.start).not.toHaveBeenCalled();
    expect(f.view.result.current.counts).toMatchObject({ selected: 2, reviewed: 2, applied: 0 });
    await act(async () => { expect(await f.view.result.current.applyReviewed()).toBe(true); });
    expect(f.access.pendingApply.start).toHaveBeenNthCalledWith(1, { proposalId: f.values[0].proposalId,
      proposalHash: f.values[0].proposalHash, revisionResultHash: f.values[0].revisionResultHash, cableId: f.values[0].cableId,
      expectedCableWriteRevision: '9', reviewId: id(20_010) });
    expect(f.access.pendingApply.start).toHaveBeenCalledTimes(2); expect(f.access.onApplied).toHaveBeenCalledOnce();
    expect(f.view.result.current.counts).toMatchObject({ selected: 0, reviewed: 0, applied: 2 });
    await act(async () => { expect(await f.view.result.current.applyReviewed()).toBe(false); });
    expect(f.access.pendingApply.start).toHaveBeenCalledTimes(2);
  });

  it('bounds selections and rejects two proposals for the same cable', () => {
    const f = fixture(); act(() => { f.view.result.current.select(f.values[0], true);
      f.view.result.current.select({ ...candidate(99), cableId: f.values[0].cableId }, true); });
    expect(f.view.result.current.entries).toHaveLength(1); expect(f.view.result.current.error).toMatch(/one proposal/);
    act(() => { f.view.result.current.clearSelection(); for (let value = 1; value <= MAX_BATCH_REVIEW_SELECTION + 1; value++) f.view.result.current.select(candidate(value), true); });
    expect(f.view.result.current.entries).toHaveLength(MAX_BATCH_REVIEW_SELECTION);
    expect(f.view.result.current.error).toMatch(/at most 1000/); expect(f.access.readProposal).not.toHaveBeenCalled();
  });

  it.each(['id', 'proposalHash', 'revisionResultHash', 'cableId', 'cableWriteRevision', 'routeText', 'designLength', 'stale', 'canApply', 'preferences'])(
    'refuses a selected result whose exact %s changed before human review', async field => {
      const f = fixture(), old = f.proposals.get(f.values[0].proposalId)!;
      if (field === 'id') old.id = id(88);
      if (field === 'proposalHash') old.proposalHash = 'c'.repeat(64);
      if (field === 'revisionResultHash') old.revisionResultHash = 'c'.repeat(64);
      if (field === 'cableId') old.cableId = id(88);
      if (field === 'cableWriteRevision') old.cableWriteRevision = '10';
      if (field === 'routeText') old.route!.routeText = '/OTHER';
      if (field === 'designLength') old.design!.designLengthMeters = '43';
      if (field === 'stale') old.stale = true;
      if (field === 'canApply') old.canApply = false;
      if (field === 'preferences') old.routingPreferences = { ...options, secondaryDistanceMeters: 3 };
      f.selectAll(); await act(async () => { expect(await f.view.result.current.confirmReview()).toBe(false); });
      expect(f.access.reviewProposal).not.toHaveBeenCalled(); expect(f.access.pendingApply.start).not.toHaveBeenCalled();
      expect(f.view.result.current.entries.map(value => value.status)).toEqual(['blocked', 'selected']);
    });

  it('does not accept a mismatched review response as approval', async () => {
    const f = fixture(); vi.mocked(f.access.reviewProposal).mockImplementationOnce(async value => ({ reviewId: id(50), proposal: { ...value, proposalHash: 'c'.repeat(64) } }));
    f.selectAll(); await act(async () => { expect(await f.view.result.current.confirmReview()).toBe(false); });
    expect(f.view.result.current.entries[0].status).toBe('blocked'); expect(f.access.pendingApply.start).not.toHaveBeenCalled();
    expect(f.access.reviewProposal).toHaveBeenCalledOnce();
  });

  it.each(['identity', 'context', 'options'] as const)('fences a late read and clears approval after %s changes', async field => {
    const f = fixture(), response = deferred<PathFinderProposal | null>(); vi.mocked(f.access.readProposal).mockReturnValueOnce(response.promise);
    f.selectAll(); let pending!: Promise<boolean>; act(() => { pending = f.view.result.current.confirmReview(); });
    const next = { ...f.access, ...(field === 'identity' ? { identityKey: 'other-account/project/login' }
      : field === 'context' ? { contextKey: 'changed-dependencies' } : { options: { ...options, secondaryDistanceMeters: 3 } }) };
    f.view.rerender(next); await act(async () => { response.resolve(proposal(f.values[0])); expect(await pending).toBe(false); });
    expect(f.view.result.current.entries).toEqual([]); expect(f.access.reviewProposal).not.toHaveBeenCalled();
    expect(f.access.pendingApply.start).not.toHaveBeenCalled();
  });

  it('cancellation while reading sends no review and retains the unprocessed selection', async () => {
    const f = fixture(), response = deferred<PathFinderProposal | null>(); vi.mocked(f.access.readProposal).mockReturnValueOnce(response.promise);
    f.selectAll(); let pending!: Promise<boolean>; act(() => { pending = f.view.result.current.confirmReview(); });
    act(() => { f.view.result.current.cancel(); });
    await act(async () => { response.resolve(proposal(f.values[0])); expect(await pending).toBe(false); });
    expect(f.access.reviewProposal).not.toHaveBeenCalled(); expect(f.view.result.current.entries.map(value => value.status)).toEqual(['selected', 'selected']);
    expect(f.view.result.current.busy).toBe(false);
  });

  it('stops after an acknowledged in-flight Apply when cancelled and refreshes only once', async () => {
    const f = fixture(), response = deferred<boolean>(); await reviewAll(f);
    vi.mocked(f.access.pendingApply.start).mockReturnValueOnce(response.promise);
    let pending!: Promise<boolean>; await act(async () => { pending = f.view.result.current.applyReviewed(); await Promise.resolve(); });
    expect(f.access.pendingApply.start).toHaveBeenCalledOnce(); act(() => { f.view.result.current.cancel(); });
    await act(async () => { response.resolve(true); expect(await pending).toBe(false); });
    expect(f.view.result.current.entries.map(value => value.status)).toEqual(['applied', 'reviewed']);
    expect(f.access.pendingApply.start).toHaveBeenCalledOnce(); expect(f.access.onApplied).toHaveBeenCalledOnce();
  });

  it('uses the latest shared pending start reference for the next cable', async () => {
    const f = fixture(), response = deferred<boolean>(); await reviewAll(f);
    vi.mocked(f.access.pendingApply.start).mockReturnValueOnce(response.promise);
    let pending!: Promise<boolean>; await act(async () => { pending = f.view.result.current.applyReviewed(); await Promise.resolve(); });
    const nextStart = vi.fn(async (_input: PendingApplyInput) => true);
    f.view.rerender({ ...f.access, pendingApply: { start: nextStart, canStart: true } });
    await act(async () => { response.resolve(true); expect(await pending).toBe(true); });
    expect(f.access.pendingApply.start).toHaveBeenCalledOnce(); expect(nextStart).toHaveBeenCalledOnce();
    expect(nextStart.mock.calls[0][0].proposalId).toBe(f.values[1].proposalId);
  });

  it('applies two delayed real pending-hook commands sequentially despite intermediate React readiness renders', async () => {
    const f = actualPendingFixture([candidate(10), candidate(11)]), first = deferred<Record<string, unknown> | null>(), second = deferred<Record<string, unknown> | null>();
    f.action.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    f.selectAll(); await waitFor(() => expect(f.view.result.current.canReview).toBe(true));
    await act(async () => { expect(await f.view.result.current.confirmReview()).toBe(true); });
    let running!: Promise<boolean>; act(() => { running = f.view.result.current.applyReviewed(); });
    await waitFor(() => expect(f.action).toHaveBeenCalledOnce());
    const retainedFirst = JSON.parse(sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY)!).intents[0];
    expect(retainedFirst.proposalId).toBe(f.values[0].proposalId);
    await act(async () => { first.resolve(applyReceipt(f.values[0])); await Promise.resolve(); });
    await waitFor(() => expect(f.action).toHaveBeenCalledTimes(2));
    const retainedSecond = JSON.parse(sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY)!).intents[0];
    expect(retainedSecond.proposalId).toBe(f.values[1].proposalId); expect(retainedSecond.idempotencyKey).not.toBe(retainedFirst.idempotencyKey);
    await act(async () => { second.resolve(applyReceipt(f.values[1])); expect(await running).toBe(true); });
    expect(f.view.result.current.counts.applied).toBe(2); expect(f.onApplied).toHaveBeenCalledOnce();
    expect(JSON.parse(sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY)!).intents).toEqual([]); sessionStorage.clear();
  });

  it('keeps the real pending command after a lost second acknowledgement and never sends the third', async () => {
    const f = actualPendingFixture([candidate(10), candidate(11), candidate(12)]), first = deferred<Record<string, unknown> | null>(), second = deferred<Record<string, unknown> | null>();
    f.action.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    f.selectAll(); await waitFor(() => expect(f.view.result.current.canReview).toBe(true));
    await act(async () => { expect(await f.view.result.current.confirmReview()).toBe(true); });
    let running!: Promise<boolean>; act(() => { running = f.view.result.current.applyReviewed(); });
    await waitFor(() => expect(f.action).toHaveBeenCalledOnce());
    await act(async () => { first.resolve(applyReceipt(f.values[0])); await Promise.resolve(); });
    await waitFor(() => expect(f.action).toHaveBeenCalledTimes(2));
    const retained = JSON.parse(sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY)!).intents[0];
    await act(async () => { second.resolve(null); expect(await running).toBe(false); });
    expect(f.view.result.current.entries.map(value => value.status)).toEqual(['applied', 'blocked', 'reviewed']);
    expect(JSON.parse(sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY)!).intents[0]).toEqual(retained);
    expect(f.action).toHaveBeenCalledTimes(2); expect(f.onApplied).toHaveBeenCalledOnce();
    await act(async () => { expect(await f.view.result.current.applyReviewed()).toBe(false); });
    expect(f.action).toHaveBeenCalledTimes(2); sessionStorage.clear();
  });

  it('retains successful rows and stops on an unknown Apply outcome without sending any later cable', async () => {
    const f = fixture([candidate(10), candidate(11), candidate(12)]); await reviewAll(f);
    vi.mocked(f.access.pendingApply.start).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await act(async () => { expect(await f.view.result.current.applyReviewed()).toBe(false); });
    expect(f.view.result.current.entries.map(value => value.status)).toEqual(['applied', 'blocked', 'reviewed']);
    expect(f.access.pendingApply.start).toHaveBeenCalledTimes(2); expect(f.access.onApplied).toHaveBeenCalledOnce();
    expect(f.view.result.current.error).toMatch(/unconfirmed/);
    f.view.rerender({ ...f.access, pendingApply: { ...f.access.pendingApply, canStart: false } });
    await act(async () => { expect(await f.view.result.current.applyReviewed()).toBe(false); });
    expect(f.access.pendingApply.start).toHaveBeenCalledTimes(2); expect(f.view.result.current.canReview).toBe(false);
  });

  it('rechecks immutable applicability immediately before Apply and does not trust an earlier review', async () => {
    const f = fixture(); await reviewAll(f); f.proposals.get(f.values[0].proposalId)!.cableWriteRevision = '10';
    await act(async () => { expect(await f.view.result.current.applyReviewed()).toBe(false); });
    expect(f.access.pendingApply.start).not.toHaveBeenCalled(); expect(f.view.result.current.entries.map(value => value.status)).toEqual(['blocked', 'reviewed']);
    expect(f.access.onApplied).not.toHaveBeenCalled();
  });

  it('blocks review and Apply while another exact pending request needs reconciliation', async () => {
    const f = fixture(); f.selectAll(); f.view.rerender({ ...f.access, pendingApply: { ...f.access.pendingApply, canStart: false } });
    await act(async () => { expect(await f.view.result.current.confirmReview()).toBe(false); expect(await f.view.result.current.applyReviewed()).toBe(false); });
    expect(f.access.readProposal).not.toHaveBeenCalled(); expect(f.access.reviewProposal).not.toHaveBeenCalled(); expect(f.access.pendingApply.start).not.toHaveBeenCalled();
  });

  it('preserves confirmed applied history when clearing remaining selections', async () => {
    const f = fixture(); await reviewAll(f); vi.mocked(f.access.pendingApply.start).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await act(async () => { await f.view.result.current.applyReviewed(); }); act(() => { f.view.result.current.clearSelection(); });
    expect(f.view.result.current.entries).toHaveLength(1); expect(f.view.result.current.entries[0].status).toBe('applied');
    expect(f.view.result.current.canReview).toBe(false); expect(f.view.result.current.canApply).toBe(false);
  });

  it('never dispatches the next item after deactivation during an in-flight read', async () => {
    const f = fixture(), response = deferred<PathFinderProposal | null>(); vi.mocked(f.access.readProposal).mockReturnValueOnce(response.promise);
    f.selectAll(); let pending!: Promise<boolean>; act(() => { pending = f.view.result.current.confirmReview(); });
    f.view.rerender({ ...f.access, active: false });
    await act(async () => { response.resolve(proposal(f.values[0])); expect(await pending).toBe(false); });
    expect(f.access.reviewProposal).not.toHaveBeenCalled(); expect(f.view.result.current.busy).toBe(false); expect(f.access.readProposal).toHaveBeenCalledOnce();
  });
});
