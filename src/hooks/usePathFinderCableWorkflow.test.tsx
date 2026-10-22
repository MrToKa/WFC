import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPathFinderCableWorkflowPage, fetchPathFinderCableWorkflowDetail, PathFinderCableWorkflowApiError, type CableWorkflowPage } from '@/api/pathfinderCableWorkflow';
import { cableWorkflowPageSchema } from '../../shared/pathfinderCableWorkflow';
import { CABLE_WORKFLOW_SEARCH_MILLISECONDS, CABLE_WORKFLOW_SEARCH_PAGE_LIMIT, usePathFinderCableWorkflow, type PathFinderCableWorkflowAccess } from './usePathFinderCableWorkflow';

vi.mock('@/api/pathfinderCableWorkflow', async original => ({ ...(await original<typeof import('@/api/pathfinderCableWorkflow')>()),
  fetchPathFinderCableWorkflowPage: vi.fn(), fetchPathFinderCableWorkflowDetail: vi.fn() }));
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = id(1), cable = id(10), hash = 'a'.repeat(64);
function page(): CableWorkflowPage {
  return cableWorkflowPageSchema.parse({ schemaVersion: 'wfc.pf.cable-workflow-page.v1', projectId: project, querySha256: hash, contextSha256: hash,
    scannedCount: 1, scannedThroughCableId: cable, nextCursor: null, rows: [{ projectId: project, mto: 'LV', cable: { id: cable, tag: 'Cable A', fromLocation: 'A', toLocation: 'B', routing: null, designLength: null, installLength: '0', cableWriteRevision: '2' },
      from: { status: 'missing', pointAvailable: false, source: null, approximate: false, candidateObjectIds: [], reasonCode: 'LOCATION_MISSING', engineeringAccepted: false },
      to: { status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false },
      calculation: { jobId: null, jobStatus: null, itemState: null, outcome: 'not-evaluated', reasonCodes: [], errorCode: null, currentness: 'not-evaluated', proposalId: null, proposalHash: null, reviewable: false, acceptedMatchesCurrent: false },
    }] });
}
const access = (): PathFinderCableWorkflowAccess => ({ projectId: project, loadedProjectId: project, accountId: id(2), token: 'token', isAdmin: true, active: true, modelScopeKey: 'model-current', onAuthorityLost: vi.fn() });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(fetchPathFinderCableWorkflowPage).mockResolvedValue(page()); });
afterEach(() => { vi.useRealTimers(); });

describe('direct text search across bounded workflow portions', () => {
  const empty = (boundary: number, cursor: string | null): CableWorkflowPage => ({ ...page(), rows: [], scannedCount: 200,
    scannedThroughCableId: id(boundary), nextCursor: cursor });
  it('automatically reaches a late match without exposing empty transport portions or requiring Next', async () => {
    const late = { ...page(), rows: [{ ...page().rows[0], cable: { ...page().rows[0].cable, id: id(401) } }], scannedThroughCableId: id(401) };
    vi.mocked(fetchPathFinderCableWorkflowPage).mockResolvedValueOnce(empty(200, 'a')).mockResolvedValueOnce(empty(400, 'b')).mockResolvedValueOnce(late);
    const view = renderHook(() => usePathFinderCableWorkflow({ ...access(), query: { search: 'Cable A', filter: 'needs-routing' } }));
    await waitFor(() => expect(view.result.current.page?.rows[0].cable.id).toBe(id(401)));
    expect(view.result.current.hasPrevious).toBe(false); expect(view.result.current.error).toBeNull();
    expect(vi.mocked(fetchPathFinderCableWorkflowPage).mock.calls.map(call => call[2]?.cursor)).toEqual([undefined, 'a', 'b']);
    expect(vi.mocked(fetchPathFinderCableWorkflowPage).mock.calls.every(call => call[2]?.filter === 'needs-routing')).toBe(true);
    expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
  });
  it('reports no matches only after exhaustion and does not offer earlier invisible portions', async () => {
    vi.mocked(fetchPathFinderCableWorkflowPage).mockResolvedValueOnce(empty(200, 'a')).mockResolvedValueOnce({ ...page(), rows: [], scannedCount: 0, scannedThroughCableId: null });
    const view = renderHook(() => usePathFinderCableWorkflow({ ...access(), query: { search: 'absent' } }));
    await waitFor(() => expect(view.result.current.page?.scannedCount).toBe(0));
    expect(view.result.current.page?.nextCursor).toBeNull(); expect(view.result.current.hasPrevious).toBe(false); expect(view.result.current.error).toBeNull();
  });
  it('returns to the previous visible results without navigating through skipped empty portions', async () => {
    const visible = (at: number, cursor: string) => ({ ...page(), rows: [{ ...page().rows[0], cable: { ...page().rows[0].cable, id: id(at) } }], scannedThroughCableId: id(at), nextCursor: cursor });
    vi.mocked(fetchPathFinderCableWorkflowPage).mockResolvedValueOnce(empty(200, 'a')).mockResolvedValueOnce(visible(201, 'b'))
      .mockResolvedValueOnce(empty(400, 'c')).mockResolvedValueOnce(visible(401, 'd')).mockResolvedValueOnce(visible(201, 'b'));
    const view = renderHook(() => usePathFinderCableWorkflow({ ...access(), query: { search: 'Cable A' } }));
    await waitFor(() => expect(view.result.current.page?.rows[0].cable.id).toBe(id(201)));
    act(() => view.result.current.nextPage()); await waitFor(() => expect(view.result.current.page?.rows[0].cable.id).toBe(id(401)));
    expect(view.result.current.hasPrevious).toBe(true);
    act(() => view.result.current.previousPage()); await waitFor(() => expect(view.result.current.page?.rows[0].cable.id).toBe(id(201)));
    expect(view.result.current.hasPrevious).toBe(false); expect(view.result.current.error).toBeNull();
    expect(vi.mocked(fetchPathFinderCableWorkflowPage).mock.calls.map(call => call[2]?.cursor)).toEqual([undefined, 'a', 'b', 'c', 'a']);
  });
  it.each(['context', 'query', 'cursor', 'boundary'] as const)('refuses changed or nonadvancing automatic search evidence: %s', async kind => {
    const next = { ...empty(400, 'b'), ...(kind === 'context' ? { contextSha256: 'b'.repeat(64) }
      : kind === 'query' ? { querySha256: 'b'.repeat(64) } : kind === 'cursor' ? { nextCursor: 'a' } : { scannedThroughCableId: id(200) }) };
    vi.mocked(fetchPathFinderCableWorkflowPage).mockResolvedValueOnce(empty(200, 'a')).mockResolvedValueOnce(next);
    const view = renderHook(() => usePathFinderCableWorkflow({ ...access(), query: { search: 'Cable A' } }));
    await waitFor(() => expect(view.result.current.error).toContain('project changed'));
    expect(view.result.current.page).toBeNull(); expect(fetchPathFinderCableWorkflowPage).toHaveBeenCalledTimes(2);
  });
  it('aborts the automatic chain on a new query and ignores the old late response', async () => {
    let finish!: (value: CableWorkflowPage) => void;
    vi.mocked(fetchPathFinderCableWorkflowPage).mockResolvedValueOnce(empty(200, 'a')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(page());
    const props = { ...access(), query: { search: 'old' } }, view = renderHook(value => usePathFinderCableWorkflow(value), { initialProps: props });
    await waitFor(() => expect(fetchPathFinderCableWorkflowPage).toHaveBeenCalledTimes(2)); const signal = vi.mocked(fetchPathFinderCableWorkflowPage).mock.calls[1][3];
    view.rerender({ ...props, query: { search: 'new' } }); expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(view.result.current.page?.rows).toHaveLength(1));
    await act(async () => finish(empty(400, 'b'))); expect(fetchPathFinderCableWorkflowPage).toHaveBeenCalledTimes(3); expect(view.result.current.error).toBeNull();
  });
  it('stops immediately when current administrator authority is denied during automatic continuation', async () => {
    const props = { ...access(), query: { search: 'Cable A' } };
    vi.mocked(fetchPathFinderCableWorkflowPage).mockResolvedValueOnce(empty(200, 'a')).mockRejectedValueOnce(new PathFinderCableWorkflowApiError('ADMIN_REQUIRED', 403, 'Administrator access is required.'));
    const view = renderHook(() => usePathFinderCableWorkflow(props)); await waitFor(() => expect(view.result.current.enabled).toBe(false));
    expect(view.result.current.page).toBeNull(); expect(props.onAuthorityLost).toHaveBeenCalledOnce(); expect(fetchPathFinderCableWorkflowPage).toHaveBeenCalledTimes(2);
  });
  it('bounds endless distinct continuations without publishing a false no-match result', async () => {
    let portion = 0; vi.mocked(fetchPathFinderCableWorkflowPage).mockImplementation(async () => empty(++portion * 200, 'cursor_'+portion));
    const view = renderHook(() => usePathFinderCableWorkflow({ ...access(), query: { search: 'Cable A' } }));
    await waitFor(() => expect(view.result.current.error).toContain('scan limit'));
    expect(fetchPathFinderCableWorkflowPage).toHaveBeenCalledTimes(CABLE_WORKFLOW_SEARCH_PAGE_LIMIT); expect(view.result.current.page).toBeNull(); expect(view.result.current.busy).toBe(false);
  });
  it('bounds total search time even when a continuation ignores cancellation', async () => {
    vi.useFakeTimers(); vi.mocked(fetchPathFinderCableWorkflowPage).mockImplementationOnce(async () => empty(200, 'a')).mockImplementationOnce(() => new Promise(() => {}));
    const view = renderHook(() => usePathFinderCableWorkflow({ ...access(), query: { search: 'Cable A' } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(CABLE_WORKFLOW_SEARCH_MILLISECONDS); });
    expect(view.result.current.error).toContain('timed out'); expect(view.result.current.busy).toBe(false); expect(view.result.current.page).toBeNull();
    expect(vi.mocked(fetchPathFinderCableWorkflowPage).mock.calls[1][3]?.aborted).toBe(true);
  });
});

describe('owned cable workflow reads', () => {
  it('retains last owned page and detail during a transient refresh failure, then replaces them on a successful read', async () => {
    const base = page(), detail = { schemaVersion: 'wfc.pf.cable-workflow-detail.v1' as const, projectId: project, cableId: cable,
      querySha256: hash, contextSha256: hash, row: base.rows[0] };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce(detail);
    const view = renderHook(() => usePathFinderCableWorkflow(access())); await waitFor(() => expect(view.result.current.page).not.toBeNull());
    await act(async () => { await view.result.current.readDetail(cable); });
    let fail!: (error: Error) => void;
    vi.mocked(fetchPathFinderCableWorkflowPage).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    act(() => view.result.current.refresh()); expect(view.result.current.loading).toBe(true);
    expect(view.result.current.page).toEqual(base); expect(view.result.current.detail).toEqual(detail);
    await act(async () => fail(new Error('Temporary GET failure')));
    expect(view.result.current.error).toContain('could not be read'); expect(view.result.current.page).toEqual(base); expect(view.result.current.detail).toEqual(detail);
    const replacement = { ...base, rows: [] }; vi.mocked(fetchPathFinderCableWorkflowPage).mockResolvedValueOnce(replacement);
    act(() => view.result.current.refresh()); await waitFor(() => expect(view.result.current.page?.rows).toHaveLength(0));
    expect(view.result.current.error).toBeNull(); expect(view.result.current.detail).toBeNull();
  });
  it('retains last same-cable detail through a transient detail GET failure without retaining it after a currentness refusal', async () => {
    const base = page(), detail = { schemaVersion: 'wfc.pf.cable-workflow-detail.v1' as const, projectId: project, cableId: cable,
      querySha256: hash, contextSha256: hash, row: base.rows[0] };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce(detail).mockRejectedValueOnce(new Error('Temporary detail failure'))
      .mockRejectedValueOnce(new PathFinderCableWorkflowApiError('WORKFLOW_CONTEXT_CHANGED', 409, 'The project changed.'));
    const view = renderHook(() => usePathFinderCableWorkflow(access())); await waitFor(() => expect(view.result.current.page).not.toBeNull());
    await act(async () => { await view.result.current.readDetail(cable); });
    await act(async () => { expect(await view.result.current.readDetail(cable)).toBeNull(); });
    expect(view.result.current.detail).toEqual(detail); expect(view.result.current.page).toEqual(base); expect(view.result.current.error).not.toBeNull();
    await act(async () => { expect(await view.result.current.readDetail(cable)).toBeNull(); });
    expect(view.result.current.detail).toBeNull(); expect(view.result.current.page).toBeNull(); expect(view.result.current.error).toContain('project changed');
  });
  it('does not read or expose rows for an inactive/nonadmin/unowned account or project', async () => {
    const props = access(), view = renderHook(value => usePathFinderCableWorkflow(value), { initialProps: { ...props, active: false } });
    expect(fetchPathFinderCableWorkflowPage).not.toHaveBeenCalled();
    for (const next of [{ ...props, isAdmin: false }, { ...props, accountId: null }, { ...props, loadedProjectId: id(3) }]) {
      view.rerender(next); expect(view.result.current.page).toBeNull(); expect(view.result.current.enabled).toBe(false);
    }
    expect(fetchPathFinderCableWorkflowPage).not.toHaveBeenCalled(); view.rerender(props);
    await waitFor(() => expect(view.result.current.page?.rows).toHaveLength(1));
    view.rerender({ ...props, active: false }); expect(view.result.current.page).toBeNull(); expect(fetchPathFinderCableWorkflowPage).toHaveBeenCalledOnce();
  });
  it('continues through empty portions beyond the first200 candidates and returns to an earlier page', async () => {
    const base = page();
    vi.mocked(fetchPathFinderCableWorkflowPage)
      .mockResolvedValueOnce({ ...base, rows: [], scannedCount: 200, scannedThroughCableId: id(200), nextCursor: 'cursor_a' })
      .mockResolvedValueOnce({ ...base, rows: [], scannedCount: 200, scannedThroughCableId: id(400), nextCursor: 'cursor_b' })
      .mockResolvedValueOnce({ ...base, rows: [{ ...base.rows[0], cable: { ...base.rows[0].cable, id: id(401) } }], scannedThroughCableId: id(401) })
      .mockResolvedValueOnce({ ...base, rows: [], scannedCount: 200, scannedThroughCableId: id(400), nextCursor: 'cursor_b' });
    const view = renderHook(() => usePathFinderCableWorkflow(access()));
    await waitFor(() => expect(view.result.current.page?.nextCursor).toBe('cursor_a'));
    act(() => view.result.current.nextPage()); await waitFor(() => expect(view.result.current.page?.nextCursor).toBe('cursor_b'));
    act(() => view.result.current.nextPage()); await waitFor(() => expect(view.result.current.page?.rows[0].cable.id).toBe(id(401)));
    expect(view.result.current.hasPrevious).toBe(true); expect(vi.mocked(fetchPathFinderCableWorkflowPage).mock.calls[2][2]).toMatchObject({ cursor: 'cursor_b' });
    act(() => view.result.current.previousPage()); await waitFor(() => expect(view.result.current.page?.scannedThroughCableId).toBe(id(400)));
    expect(vi.mocked(fetchPathFinderCableWorkflowPage).mock.calls[3][2]).toMatchObject({ cursor: 'cursor_a' });
  });
  it('accepts a zero-scan terminal page after a bounded continuation without pretending the project changed', async () => {
    vi.mocked(fetchPathFinderCableWorkflowPage).mockResolvedValueOnce({ ...page(), nextCursor: 'maybe_more' })
      .mockResolvedValueOnce({ ...page(), rows: [], scannedCount: 0, scannedThroughCableId: null });
    const view = renderHook(() => usePathFinderCableWorkflow(access())); await waitFor(() => expect(view.result.current.page?.nextCursor).toBe('maybe_more'));
    act(() => view.result.current.nextPage()); await waitFor(() => expect(view.result.current.page?.scannedCount).toBe(0));
    expect(view.result.current.page?.nextCursor).toBeNull(); expect(view.result.current.hasPrevious).toBe(true); expect(view.result.current.error).toBeNull();
  });
  it('does not accept an externally injected cursor as the first owned query', () => {
    const view = renderHook(() => usePathFinderCableWorkflow({ ...access(), query: { cursor: 'unowned' } as never }));
    expect(view.result.current.enabled).toBe(false); expect(fetchPathFinderCableWorkflowPage).not.toHaveBeenCalled();
  });
  it.each(['token', 'model', 'preferences', 'search', 'filter'] as const)('resets cursors and refuses late reads when %s changes', async kind => {
    const props = access(), base = { ...page(), nextCursor: 'cursor_a' }; let finish!: (value: CableWorkflowPage) => void;
    vi.mocked(fetchPathFinderCableWorkflowPage).mockResolvedValueOnce(base).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(page());
    const view = renderHook(value => usePathFinderCableWorkflow(value), { initialProps: props });
    await waitFor(() => expect(view.result.current.page?.nextCursor).toBe('cursor_a'));
    act(() => view.result.current.nextPage()); const signal = vi.mocked(fetchPathFinderCableWorkflowPage).mock.calls[1][3];
    const change = kind === 'token' ? { token: 'other-token', accountId: id(4) } : kind === 'model' ? { modelScopeKey: 'other-model' }
      : { query: kind === 'preferences' ? { secondaryDistanceMeters: 4, preferVerticalApproach: false } : kind === 'search' ? { search: 'literal%' } : { filter: 'all' as const } };
    view.rerender({ ...props, ...change }); expect(signal?.aborted).toBe(true); expect(view.result.current.page).toBeNull();
    await waitFor(() => expect(fetchPathFinderCableWorkflowPage).toHaveBeenCalledTimes(3));
    expect(vi.mocked(fetchPathFinderCableWorkflowPage).mock.calls[2][2]).not.toHaveProperty('cursor');
    await act(async () => finish({ ...base, contextSha256: 'b'.repeat(64), rows: [] }));
    await waitFor(() => expect(view.result.current.page?.contextSha256).toBe(hash)); expect(view.result.current.hasPrevious).toBe(false);
  });
  it('keeps one read in flight and cancels it when the list becomes inactive', async () => {
    const props = access(); let finish!: (value: CableWorkflowPage) => void;
    vi.mocked(fetchPathFinderCableWorkflowPage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderHook(value => usePathFinderCableWorkflow(value), { initialProps: props });
    await waitFor(() => expect(fetchPathFinderCableWorkflowPage).toHaveBeenCalledOnce());
    act(() => { view.result.current.refresh(); view.result.current.refresh(); view.result.current.nextPage(); });
    expect(fetchPathFinderCableWorkflowPage).toHaveBeenCalledOnce();
    const signal = vi.mocked(fetchPathFinderCableWorkflowPage).mock.calls[0][3]; view.rerender({ ...props, active: false }); expect(signal?.aborted).toBe(true);
    await act(async () => finish(page())); expect(view.result.current.page).toBeNull(); expect(view.result.current.busy).toBe(false);
  });
  it.each(['context', 'query', 'cursor', 'boundary'] as const)('refuses a nonowned or nonadvancing continuation: %s', async kind => {
    const base = { ...page(), nextCursor: 'cursor_a' };
    const next = { ...page(), rows: [], scannedThroughCableId: id(20), nextCursor: 'cursor_b',
      ...(kind === 'context' ? { contextSha256: 'b'.repeat(64) } : kind === 'query' ? { querySha256: 'b'.repeat(64) } : kind === 'cursor' ? { nextCursor: 'cursor_a' } : { scannedThroughCableId: cable }) };
    vi.mocked(fetchPathFinderCableWorkflowPage).mockResolvedValueOnce(base).mockResolvedValueOnce(next);
    const view = renderHook(() => usePathFinderCableWorkflow(access())); await waitFor(() => expect(view.result.current.page).not.toBeNull());
    act(() => view.result.current.nextPage()); await waitFor(() => expect(view.result.current.error).toContain('project changed'));
    expect(view.result.current.page).toBeNull(); expect(view.result.current.hasPrevious).toBe(false);
  });
  it('requires an owned visible cable for details, tolerates item progress but rejects changed cable values', async () => {
    const base = page(), detail = { schemaVersion: 'wfc.pf.cable-workflow-detail.v1' as const, projectId: project, cableId: cable,
      querySha256: hash, contextSha256: hash, row: { ...base.rows[0], calculation: { ...base.rows[0].calculation, reasonCodes: ['NEW_PROGRESS'] } } };
    vi.mocked(fetchPathFinderCableWorkflowDetail).mockResolvedValueOnce(detail).mockResolvedValueOnce({ ...detail, row: { ...detail.row, cable: { ...detail.row.cable, cableWriteRevision: '3' } } });
    const view = renderHook(() => usePathFinderCableWorkflow(access())); await waitFor(() => expect(view.result.current.page).not.toBeNull());
    await act(async () => { expect(await view.result.current.readDetail(id(99))).toBeNull(); }); expect(fetchPathFinderCableWorkflowDetail).not.toHaveBeenCalled();
    await act(async () => { expect(await view.result.current.readDetail(cable)).toEqual(detail); });
    expect(view.result.current.detail).toEqual(detail);
    await act(async () => { expect(await view.result.current.readDetail(cable)).toBeNull(); });
    expect(view.result.current.page).toBeNull(); expect(view.result.current.error).toContain('project changed');
  });
  it('clears rows on revoked access, suppresses retries for the same account and permits a new login', async () => {
    const props = access(); vi.mocked(fetchPathFinderCableWorkflowPage).mockResolvedValueOnce(page()).mockRejectedValueOnce(new PathFinderCableWorkflowApiError('ADMIN_REQUIRED', 403, 'Administrator access is required.')).mockResolvedValueOnce(page());
    const view = renderHook(value => usePathFinderCableWorkflow(value), { initialProps: props }); await waitFor(() => expect(view.result.current.page).not.toBeNull());
    act(() => view.result.current.refresh()); await waitFor(() => expect(view.result.current.enabled).toBe(false));
    expect(view.result.current.page).toBeNull(); expect(props.onAuthorityLost).toHaveBeenCalledOnce();
    act(() => view.result.current.refresh()); expect(fetchPathFinderCableWorkflowPage).toHaveBeenCalledTimes(2);
    view.rerender({ ...props, token: 'fresh-login' }); await waitFor(() => expect(view.result.current.page).not.toBeNull());
    expect(fetchPathFinderCableWorkflowPage).toHaveBeenCalledTimes(3);
  });
  it('does not treat an unavailable cable detail as lost Viewer or administrator authority', async () => {
    const props = access(); vi.mocked(fetchPathFinderCableWorkflowDetail).mockRejectedValueOnce(new PathFinderCableWorkflowApiError('CABLE_NOT_FOUND', 404, 'This cable is unavailable.'));
    const view = renderHook(() => usePathFinderCableWorkflow(props)); await waitFor(() => expect(view.result.current.page).not.toBeNull());
    await act(async () => { await view.result.current.readDetail(cable); }); expect(view.result.current.enabled).toBe(true); expect(view.result.current.page).not.toBeNull(); expect(props.onAuthorityLost).not.toHaveBeenCalled();
  });
});
