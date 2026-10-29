import { webcrypto } from 'node:crypto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/pathfinderModelLocationMatch';
import { modelMatchContext, modelMatchIds as ids, modelMatchPage, modelMatchReceipt } from '@/test/modelLocationMatchFixtures';
import { collectModelLocationMatch, useModelLocationMatch } from './useModelLocationMatch';
import type { ProjectPreparationViewer, usePathFinder } from './usePathFinder';
import type { PreparationDiscoveryPage, PreparationDiscoveryRequest } from '../../../../viewer-runtime/preparation-input.mjs';
vi.mock('@/api/pathfinderModelLocationMatch', async original => ({ ...await original<typeof api>(), fetchModelLocationMatchContext: vi.fn(), assignModelLocations: vi.fn() }));
function setup(names = ['TAG-1']) {
  const context = modelMatchContext(names);
  vi.mocked(api.fetchModelLocationMatchContext).mockResolvedValue(context);
  let revision = 7;
  vi.mocked(api.assignModelLocations).mockImplementation(async (_project, _token, body) => modelMatchReceipt(body, String(++revision)));
  const discover = vi.fn(async (request: PreparationDiscoveryRequest) => modelMatchPage(request));
  const viewer = { assertCurrent: vi.fn(), discover } as unknown as ProjectPreparationViewer;
  const pf = { preparationAccess: { projectId: ids.project, loadedProjectId: ids.project, token: 'token', isAdmin: true },
    preparationViewerGeneration: 1, data: { activeModel: context.current }, viewerPhase: 'ready', busy: false, refresh: vi.fn(),
    refreshState: vi.fn().mockResolvedValue(undefined), calculate: vi.fn(), cancelOperation: vi.fn(),
    runProjectPreparation: vi.fn(async (_scope, work: (v: ProjectPreparationViewer) => Promise<unknown>) => work(viewer)),
  } as unknown as ReturnType<typeof usePathFinder>;
  return { context, pf, viewer, discover };
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('crypto', webcrypto); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('complete endpoint-only matching scan', () => {
  it('includes every SDK page and unavailable candidate instead of turning ambiguity into a unique match', async () => {
    const { context, viewer, discover } = setup();
    discover.mockImplementation(async request => {
      const page = modelMatchPage(request, request.cursor === 0 ? [1] : [2]);
      if (request.cursor === 0) { page.nextCursor = 1; page.complete = false; }
      else { page.objects[0].bounds = null; page.objects[0].bottomCentre = null; }
      return page;
    });
    const scan = await collectModelLocationMatch(context, viewer, vi.fn(), new AbortController().signal);
    expect(scan.candidates.map(c => c.objectId)).toEqual([1, 2]);
    expect(scan.candidates[1].bounds).toBeNull();
    expect(discover.mock.calls.every(([r]) => r.mode === 'equipment' && r.includeAnchors === true && r.indexNames?.[0] === 'TAG-1')).toBe(true);
    expect(discover.mock.calls[1][0].visibilityScope).toEqual(scan.visibilityScope);
    expect(api.assignModelLocations).not.toHaveBeenCalled();
  });
  it.each(['incomplete', 'omitted', 'visibility', 'cursor'])('rejects %s evidence without assigning', async kind => {
    const { context, viewer, discover } = setup();
    discover.mockImplementation(async request => {
      const page = modelMatchPage(request);
      if (kind === 'incomplete') page.propertyScan!.complete = false;
      if (kind === 'omitted') { page.propertyScan!.omittedObjectCount = 1; page.propertyScan!.returnedObjectCount = 999; }
      if (kind === 'cursor') page.nextCursor = request.cursor;
      if (kind === 'visibility') { if (request.cursor === 0) { page.nextCursor = 1; page.complete = false; } else page.visibilityScope.contentSha256 = 'd'.repeat(64); }
      return page;
    });
    await expect(collectModelLocationMatch(context, viewer, vi.fn(), new AbortController().signal)).rejects.toThrow();
    expect(api.assignModelLocations).not.toHaveBeenCalled();
  });
});
describe('find and assign operation ownership', () => {
  it('scans first, posts serialized 128-name pages with returned registry revisions, then refreshes once without calculating', async () => {
    const names = Array.from({ length: 150 }, (_, i) => `TAG-${i}`), { pf, discover } = setup(names), onChanged = vi.fn();
    const { result } = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true, onChanged }));
    await waitFor(() => expect(result.current.canStart).toBe(true));
    await act(() => result.current.start());
    expect(result.current.complete).toBe(true); expect(result.current.results).toHaveLength(150);
    expect(discover).toHaveBeenCalledTimes(2);
    expect(discover.mock.calls.every(([request]) => request.indexNames?.length === 150 && request.mode === 'equipment')).toBe(true);
    expect(api.assignModelLocations).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(api.assignModelLocations).mock.calls;
    expect(calls[0][2].names).toHaveLength(128); expect(calls[1][2].names).toHaveLength(22);
    expect(calls[0][2].expectedRegistryRevision).toBe('7'); expect(calls[1][2].expectedRegistryRevision).toBe('8');
    expect(calls.every(call => call[2].scan.candidates[0].matchedNames.length === call[2].names.length)).toBe(true);
    expect(pf.calculate).not.toHaveBeenCalled(); expect(pf.refreshState).toHaveBeenCalledTimes(1); expect(onChanged).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });
  it('retains an unknown exact POST and retries only that same command when explicitly requested', async () => {
    const { pf, discover } = setup();
    vi.mocked(api.assignModelLocations).mockRejectedValueOnce(new api.ModelLocationMatchApiError('DATABASE_BUSY', 503, 'unknown', 'Busy'));
    const { result } = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(result.current.canStart).toBe(true)); await act(() => result.current.start());
    const body = vi.mocked(api.assignModelLocations).mock.calls[0][2];
    expect(result.current.pending?.command).toEqual(body); expect(result.current.canStart).toBe(false); expect(localStorage.length).toBe(1);
    expect(api.assignModelLocations).toHaveBeenCalledTimes(1);
    await act(() => result.current.retry());
    expect(vi.mocked(api.assignModelLocations).mock.calls[1][2]).toEqual(body);
    expect(discover).toHaveBeenCalledTimes(1); expect(api.fetchModelLocationMatchContext).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBeNull(); expect(localStorage.length).toBe(0); expect(pf.calculate).not.toHaveBeenCalled();
  });
  it('restores a pending assignment after remount, reconciles it, then continues with a fresh complete scan', async () => {
    const { pf, discover } = setup();
    vi.mocked(api.assignModelLocations).mockRejectedValueOnce(new api.ModelLocationMatchApiError('LOST_ACK', null, 'unknown', 'Lost acknowledgement'));
    const a = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(a.result.current.canStart).toBe(true)); await act(() => a.result.current.start());
    const id = a.result.current.pending!.command.idempotencyKey; a.unmount();
    vi.mocked(api.fetchModelLocationMatchContext).mockResolvedValueOnce({ ...modelMatchContext(), registryRevision: '8' });
    const b = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(b.result.current.pending?.command.idempotencyKey).toBe(id));
    await act(() => b.result.current.retry()); expect(discover).toHaveBeenCalledTimes(2); expect(b.result.current.pending).toBeNull();
    expect(b.result.current.complete).toBe(true); expect(b.result.current.results).toHaveLength(1);
  });
  it('resumes page six and all remaining pages with cumulative counts after an uncertain 640-name prefix', async () => {
    const names = Array.from({ length: 1478 }, (_, i) => `TAG-${i}`), { pf, discover } = setup(names);
    let calls = 0, revision = 7;
    vi.mocked(api.assignModelLocations).mockImplementation(async (_project, _token, body) => {
      if (++calls === 6) throw new api.ModelLocationMatchApiError('REQUEST_TIMEOUT', null, 'unknown', 'The matching request timed out.');
      return modelMatchReceipt(body, String(++revision));
    });
    const { result } = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(result.current.canStart).toBe(true)); await act(() => result.current.start());
    expect(result.current.results).toHaveLength(640); expect(result.current.totalNames).toBe(1478); expect(result.current.canStart).toBe(false);
    expect(result.current.error).toContain('REQUEST_TIMEOUT');
    const pending = result.current.pending!.command, scanReads = discover.mock.calls.length;
    expect(pending.names).toEqual(names.slice(640, 768)); expect(pending.expectedRegistryRevision).toBe('12');
    await act(() => result.current.retry());
    expect(vi.mocked(api.assignModelLocations).mock.calls[6][2]).toEqual(pending);
    expect(discover).toHaveBeenCalledTimes(scanReads); expect(api.fetchModelLocationMatchContext).toHaveBeenCalledTimes(1);
    expect(result.current.complete).toBe(true); expect(result.current.results.map(r => r.name)).toEqual(names);
    expect(result.current.results).toHaveLength(1478); expect(result.current.pending).toBeNull(); expect(localStorage.length).toBe(0);
    expect(pf.refreshState).toHaveBeenCalledTimes(1); expect(pf.calculate).not.toHaveBeenCalled();
  }, 10_000);
  it('after remount reconciles page six, reads the current registry and completes all1478 names from a fresh scan', async () => {
    const names = Array.from({ length: 1478 }, (_, i) => `TAG-${i}`), { pf, discover, context } = setup(names);
    let calls = 0, revision = 7;
    vi.mocked(api.assignModelLocations).mockImplementation(async (_project, _token, body) => {
      if (++calls === 6) throw new api.ModelLocationMatchApiError('REQUEST_TIMEOUT', null, 'unknown', 'Lost acknowledgement.');
      return modelMatchReceipt(body, String(++revision));
    });
    const first = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(first.result.current.canStart).toBe(true)); await act(() => first.result.current.start());
    const pending = first.result.current.pending!.command, firstScanReads = discover.mock.calls.length;
    expect(first.result.current.results).toHaveLength(640); first.unmount();
    vi.mocked(api.fetchModelLocationMatchContext).mockResolvedValueOnce({ ...context, registryRevision: '13' });
    const second = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(second.result.current.pending).not.toBeNull()); await act(() => second.result.current.retry());
    const sent = vi.mocked(api.assignModelLocations).mock.calls;
    expect(sent[6][2]).toEqual(pending); expect(sent[7][2].expectedRegistryRevision).toBe('13'); expect(sent[7][2].names).toEqual(names.slice(0, 128));
    expect(api.fetchModelLocationMatchContext).toHaveBeenCalledTimes(2); expect(discover).toHaveBeenCalledTimes(firstScanReads * 2);
    expect(second.result.current.complete).toBe(true); expect(second.result.current.results.map(item => item.name)).toEqual(names);
    expect(second.result.current.results).toHaveLength(1478); expect(second.result.current.totalNames).toBe(1478);
    expect(second.result.current.pending).toBeNull(); expect(localStorage.length).toBe(0); expect(pf.calculate).not.toHaveBeenCalled();
  }, 10_000);
  it('retries a busy page with the identical saved key before advancing to its remaining names', async () => {
    const { pf, discover } = setup(Array.from({ length: 150 }, (_, i) => `TAG-${i}`));
    vi.mocked(api.assignModelLocations).mockRejectedValueOnce(new api.ModelLocationMatchApiError('PREFLIGHT_DATABASE_BUSY', 503, 'unknown', 'The project is temporarily busy.'));
    const { result } = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(result.current.canStart).toBe(true)); await act(() => result.current.start());
    const sent = vi.mocked(api.assignModelLocations).mock.calls;
    expect(sent).toHaveLength(3); expect(sent[1][2]).toEqual(sent[0][2]);
    expect(sent[2][2].idempotencyKey).not.toBe(sent[0][2].idempotencyKey); expect(sent[2][2].names).toHaveLength(22);
    expect(discover).toHaveBeenCalledTimes(2); expect(result.current.results).toHaveLength(150); expect(result.current.complete).toBe(true);
  });
  it('stops after two extra busy replays and preserves the exact page with its real error code', async () => {
    const { pf } = setup();
    vi.mocked(api.assignModelLocations).mockRejectedValue(new api.ModelLocationMatchApiError('WORKFLOW_DATABASE_BUSY', 503, 'unknown', 'The project is temporarily busy.'));
    const { result } = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(result.current.canStart).toBe(true)); await act(() => result.current.start());
    expect(api.assignModelLocations).toHaveBeenCalledTimes(3);
    const pending = result.current.pending!.command;
    for (const call of vi.mocked(api.assignModelLocations).mock.calls) expect(call[2]).toEqual(pending);
    expect(result.current.results).toHaveLength(0); expect(result.current.error).toContain('WORKFLOW_DATABASE_BUSY; HTTP 503');
    expect(result.current.progress).toContain('Retrying the same saved assignment 2 of 2'); expect(localStorage.length).toBe(1);
    vi.mocked(api.assignModelLocations).mockResolvedValueOnce(modelMatchReceipt(pending));
    await act(() => result.current.retry()); expect(result.current.pending).toBeNull(); expect(result.current.complete).toBe(true);
  }, 10_000);
  it('cancels a busy backoff without another POST and retains the pending command', async () => {
    const { pf } = setup();
    vi.mocked(api.assignModelLocations).mockRejectedValueOnce(new api.ModelLocationMatchApiError('ENDPOINT_DATABASE_BUSY', 503, 'unknown', 'Busy.'));
    const { result } = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(result.current.canStart).toBe(true)); let work!: Promise<void>;
    act(() => { work = result.current.start(); }); await waitFor(() => expect(result.current.progress).toContain('ENDPOINT_DATABASE_BUSY'));
    act(() => result.current.cancel()); await act(() => work);
    expect(api.assignModelLocations).toHaveBeenCalledTimes(1); expect(result.current.pending).not.toBeNull(); expect(result.current.error).toContain('AbortError');
  });
  it('does not retire an uncertain busy attempt after a later ordinary refusal', async () => {
    const { pf } = setup();
    vi.mocked(api.assignModelLocations)
      .mockRejectedValueOnce(new api.ModelLocationMatchApiError('ENDPOINT_DATABASE_BUSY', 503, 'unknown', 'Busy.'))
      .mockRejectedValueOnce(new api.ModelLocationMatchApiError('MODEL_LOCATION_MATCH_BODY_LIMIT', 413, 'refused', 'Too large.'));
    const { result } = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(result.current.canStart).toBe(true)); await act(() => result.current.start());
    const calls = vi.mocked(api.assignModelLocations).mock.calls;
    expect(calls).toHaveLength(2); expect(calls[1][2]).toEqual(calls[0][2]);
    expect(result.current.pending?.command).toEqual(calls[0][2]); expect(localStorage.length).toBe(1);
    expect(result.current.error).toContain('MODEL_LOCATION_MATCH_BODY_LIMIT; HTTP 413');
  });
  it.each(['account', 'model'] as const)('stops after a %s change during an unconfirmed page and retains its exact saved command', async kind => {
    const names = Array.from({ length: 300 }, (_, i) => `TAG-${i}`), { pf } = setup(names), onChanged = vi.fn();
    let finish!: (receipt: ReturnType<typeof modelMatchReceipt>) => void;
    vi.mocked(api.assignModelLocations)
      .mockImplementationOnce(async (_project, _token, body) => modelMatchReceipt(body))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const otherAccount = '99999999-9999-4999-8999-999999999999', otherModel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const { result, rerender } = renderHook(({ changed }) => useModelLocationMatch({
      pf: changed && kind === 'model' ? { ...pf, data: { ...pf.data!, activeModel: { ...pf.data!.activeModel, modelVersionId: otherModel } } } : pf,
      accountId: changed && kind === 'account' ? otherAccount : ids.account, active: true, onChanged,
    }), { initialProps: { changed: false } });
    await waitFor(() => expect(result.current.canStart).toBe(true)); let work!: Promise<void>;
    act(() => { work = result.current.start(); }); await waitFor(() => expect(api.assignModelLocations).toHaveBeenCalledTimes(2));
    const body = vi.mocked(api.assignModelLocations).mock.calls[1][2], persisted = localStorage.getItem(localStorage.key(0)!);
    expect(result.current.results).toHaveLength(128); rerender({ changed: true });
    await act(async () => { finish(modelMatchReceipt(body, '9')); await work; });
    expect(api.assignModelLocations).toHaveBeenCalledTimes(2); expect(localStorage.getItem(localStorage.key(0)!)).toBe(persisted);
    expect(result.current.results).toHaveLength(0); expect(onChanged).not.toHaveBeenCalled(); expect(pf.refreshState).not.toHaveBeenCalled();
    if (kind === 'model') {
      await waitFor(() => expect(result.current.pending?.command).toEqual(body));
      await act(() => result.current.retry()); expect(api.assignModelLocations).toHaveBeenCalledTimes(2);
      expect(result.current.error).toContain('another model'); expect(result.current.pending?.command).toEqual(body);
    } else await waitFor(() => expect(result.current.storageReady).toBe(true));
  });
  it('continues through ordinary job and registry state refreshes while the active model and owner are unchanged', async () => {
    const names = Array.from({ length: 150 }, (_, i) => `TAG-${i}`), { pf } = setup(names);
    let finish!: (receipt: ReturnType<typeof modelMatchReceipt>) => void;
    vi.mocked(api.assignModelLocations).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ polling }) => useModelLocationMatch({ pf: { ...pf, busy: polling,
      data: { ...pf.data!, activeModel: { ...pf.data!.activeModel } }, refreshState: pf.refreshState }, accountId: ids.account, active: true }),
      { initialProps: { polling: false } });
    await waitFor(() => expect(result.current.canStart).toBe(true)); let work!: Promise<void>;
    act(() => { work = result.current.start(); }); await waitFor(() => expect(api.assignModelLocations).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.assignModelLocations).mock.calls[0][2]; rerender({ polling: true });
    await act(async () => { finish(modelMatchReceipt(body)); await work; });
    expect(api.assignModelLocations).toHaveBeenCalledTimes(2); expect(result.current.complete).toBe(true); expect(result.current.results).toHaveLength(150);
  });
  it('after reload reconciles the old page then scans the complete fresh name scope without double-counting', async () => {
    const { pf, discover } = setup();
    vi.mocked(api.assignModelLocations).mockRejectedValueOnce(new api.ModelLocationMatchApiError('LOST_ACK', null, 'unknown', 'Lost acknowledgement'));
    const first = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(first.result.current.canStart).toBe(true)); await act(() => first.result.current.start());
    const pending = first.result.current.pending!.command; first.unmount();
    vi.mocked(api.fetchModelLocationMatchContext).mockResolvedValueOnce({ ...modelMatchContext(['CURRENT-NAME']), registryRevision: '8' });
    const second = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(second.result.current.pending).not.toBeNull()); await act(() => second.result.current.retry());
    expect(vi.mocked(api.assignModelLocations).mock.calls[1][2]).toEqual(pending); expect(discover).toHaveBeenCalledTimes(2);
    expect(second.result.current.results.map(item => item.name)).toEqual(['CURRENT-NAME']); expect(second.result.current.totalNames).toBe(1);
    expect(second.result.current.complete).toBe(true); expect(second.result.current.pending).toBeNull(); expect(pf.calculate).not.toHaveBeenCalled();
  });
  it('clears a typed first-attempt refusal without resubmitting it', async () => {
    const { pf } = setup();
    vi.mocked(api.assignModelLocations).mockRejectedValueOnce(new api.ModelLocationMatchApiError('MODEL_LOCATION_MATCH_BODY_LIMIT', 413, 'refused', 'Too large.'));
    const { result } = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(result.current.canStart).toBe(true)); await act(() => result.current.start());
    expect(result.current.pending).toBeNull(); expect(localStorage.length).toBe(0); expect(result.current.canStart).toBe(true);
    expect(api.assignModelLocations).toHaveBeenCalledTimes(1);
  });
  it('retains an earlier unknown assignment when a retry loses administrator access', async () => {
    const { pf, discover } = setup();
    vi.mocked(api.assignModelLocations)
      .mockRejectedValueOnce(new api.ModelLocationMatchApiError('LOST_ACK', null, 'unknown', 'Lost acknowledgement'))
      .mockRejectedValueOnce(new api.ModelLocationMatchApiError('UNAUTHORIZED', 401, 'refused', 'Administrator access required.'));
    const { result } = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(result.current.canStart).toBe(true)); await act(() => result.current.start());
    const body = result.current.pending!.command; await act(() => result.current.retry());
    expect(result.current.pending?.command).toEqual(body); expect(localStorage.length).toBe(1); expect(result.current.canStart).toBe(false);
    expect(vi.mocked(api.assignModelLocations).mock.calls[1][2]).toEqual(body); expect(discover).toHaveBeenCalledTimes(1); expect(pf.refresh).toHaveBeenCalledTimes(1);
  });
  it('retires an unknown assignment only after the serialized server context check proves it was not accepted', async () => {
    const { pf } = setup();
    vi.mocked(api.assignModelLocations)
      .mockRejectedValueOnce(new api.ModelLocationMatchApiError('LOST_ACK', null, 'unknown', 'Lost acknowledgement'))
      .mockRejectedValueOnce(new api.ModelLocationMatchApiError('MODEL_LOCATION_MATCH_CONTEXT_CHANGED', 409, 'refused', 'Context changed.'));
    const { result } = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(result.current.canStart).toBe(true)); await act(() => result.current.start());
    const body = result.current.pending!.command; await act(() => result.current.retry());
    expect(vi.mocked(api.assignModelLocations).mock.calls[1][2]).toEqual(body);
    expect(result.current.pending).toBeNull(); expect(localStorage.length).toBe(0); expect(result.current.canStart).toBe(true);
    expect(result.current.error).toContain('before this assignment was accepted');
  });
  it('does not submit after cancellation during an SDK read', async () => {
    const { pf, discover } = setup(); let finish!: (page: PreparationDiscoveryPage) => void;
    discover.mockImplementation(request => new Promise(resolve => { finish = page => resolve({ ...page, names: request.names }); }));
    const { result } = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(result.current.canStart).toBe(true)); let work!: Promise<void>;
    act(() => { work = result.current.start(); }); await waitFor(() => expect(discover).toHaveBeenCalledTimes(1));
    act(() => result.current.cancel()); await act(async () => { finish(modelMatchPage(discover.mock.calls[0][0])); await work; });
    expect(api.assignModelLocations).not.toHaveBeenCalled(); expect(result.current.pending).toBeNull(); expect(result.current.busy).toBe(false);
  });
  it('does not submit when the viewer generation changes during a scan', async () => {
    const { pf, discover } = setup(); let finish!: (page: PreparationDiscoveryPage) => void;
    discover.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ generation }) => useModelLocationMatch({ pf: { ...pf, preparationViewerGeneration: generation }, accountId: ids.account, active: true }), { initialProps: { generation: 1 } });
    await waitFor(() => expect(result.current.canStart).toBe(true)); let work!: Promise<void>; act(() => { work = result.current.start(); });
    await waitFor(() => expect(discover).toHaveBeenCalledTimes(1)); rerender({ generation: 2 });
    await act(async () => { finish(modelMatchPage(discover.mock.calls[0][0])); await work; }); expect(api.assignModelLocations).not.toHaveBeenCalled();
  });
  it('refuses a write if browser recovery storage cannot retain the exact command', async () => {
    const { pf } = setup(); const { result } = renderHook(() => useModelLocationMatch({ pf, accountId: ids.account, active: true }));
    await waitFor(() => expect(result.current.canStart).toBe(true));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Recovery storage is unavailable'); });
    await act(() => result.current.start()); expect(api.assignModelLocations).not.toHaveBeenCalled(); expect(result.current.error).toContain('storage');
  });
});
