import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectModelSelection } from './useProjectModelSelection';
import { ProjectModelApiError, type ProjectModelSnapshot } from '@/api/projectModels';

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('@/api/projectModels', async importOriginal => ({ ...(await importOriginal<typeof import('@/api/projectModels')>()), fetchProjectModels: api.get, setProjectActiveModel: api.save }));
const projectId = '11111111-1111-4111-8111-111111111111', otherProject = '99999999-9999-4999-8999-999999999999';
const a = '22222222-2222-4222-8222-222222222222', b = '33333333-3333-4333-8333-333333333333';
const stamp = '2026-10-16T12:00:00.000Z';
const snapshot = (active: string | null = a, revision = 1, project = projectId): ProjectModelSnapshot => ({ selection: { projectId: project, activeModelVersionId: active, selectionRevision: revision, updatedAt: stamp }, versions: [a, b].map(id => ({ id, projectId: project, label: 'Same label', source: { name: 'source.nwd', bytes: 1, sha256: 'a'.repeat(64), identityBasis: 'observed-local-file' }, state: 'ready', health: 'healthy', preparedAt: stamp, importedAt: stamp })) });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
type Props = { projectId: string | null; token: string | null; canEdit: boolean };
const start = (props: Props = { projectId, token: 'token-a', canEdit: true }) => renderHook(value => useProjectModelSelection(value), { initialProps: props });
const ready = async (hook: ReturnType<typeof start>) => waitFor(() => expect(hook.result.current.snapshot).not.toBeNull());
beforeEach(() => { vi.resetAllMocks(); api.get.mockResolvedValue(snapshot()); api.save.mockImplementation(async (_project, _token, input) => ({ selection: snapshot(input.modelVersionId, input.expectedSelectionRevision + 1).selection })); });

describe('project model selection state', () => {
  it('loads authoritative state without default/no-op PATCH, including null and read-only access', async () => {
    for (const canEdit of [true, false]) {
      api.get.mockResolvedValueOnce(snapshot(null)); const h = start({ projectId, token: 'legacy-token', canEdit }); await ready(h);
      expect(h.result.current.draftId).toBeNull(); expect(h.result.current.canSave).toBe(false);
      await act(() => h.result.current.save()); expect(api.save).not.toHaveBeenCalled();
      if (!canEdit) { act(() => h.result.current.changeDraft(b)); expect(h.result.current.draftId).toBeNull(); }
      h.unmount();
    }
  });

  it('distinguishes a failed request from an empty snapshot, and retry confirms fresh data', async () => {
    api.get.mockRejectedValueOnce(new ProjectModelApiError('NETWORK_ERROR')); const h = start();
    await waitFor(() => expect(h.result.current.error).not.toBeNull()); expect(h.result.current.snapshot).toBeNull(); expect(h.result.current.stale).toBe(true);
    api.get.mockResolvedValueOnce({ versions: [], selection: snapshot(null).selection }); await act(() => h.result.current.refresh());
    expect(h.result.current.snapshot?.versions).toEqual([]); expect(h.result.current.error).toBeNull(); expect(h.result.current.stale).toBe(false); expect(api.save).not.toHaveBeenCalled();
  });

  it('preserves unavailable and missing active IDs, blocks invalid new options and never substitutes null', async () => {
    const unavailable = snapshot(); unavailable.versions[0].health = 'unavailable'; api.get.mockResolvedValueOnce(unavailable);
    const h = start(); await ready(h); expect(h.result.current.draftId).toBe(a);
    act(() => h.result.current.changeDraft(a)); expect(h.result.current.error).toContain('available'); expect(h.result.current.canSave).toBe(false);
    const missing = snapshot(otherProject, 2); api.get.mockResolvedValueOnce(missing); await act(() => h.result.current.refresh());
    expect(h.result.current.activeMissing).toBe(true); expect(h.result.current.snapshot?.selection.activeModelVersionId).toBe(otherProject); expect(h.result.current.draftId).toBe(otherProject);
    act(() => h.result.current.changeDraft(null)); expect(h.result.current.canSave).toBe(false); await act(() => h.result.current.save()); expect(api.save).not.toHaveBeenCalled();
  });

  it('saves an explicit UUID and null with current project/revision and shows Saved only after acknowledgement', async () => {
    const pending = deferred<{ selection: ProjectModelSnapshot['selection'] }>(); api.save.mockReturnValueOnce(pending.promise);
    const h = start(); await ready(h); act(() => h.result.current.changeDraft(b)); expect(h.result.current.canSave).toBe(true);
    let saving!: Promise<void>; act(() => { saving = h.result.current.save(); }); expect(h.result.current.saving).toBe(true); expect(h.result.current.notice).toBeNull();
    expect(api.save).toHaveBeenCalledWith(projectId, 'token-a', { modelVersionId: b, expectedSelectionRevision: 1 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await act(async () => { pending.resolve({ selection: snapshot(b, 2).selection }); await saving; });
    expect(h.result.current.notice).toBe('Model selection saved.'); expect(h.result.current.snapshot?.selection.activeModelVersionId).toBe(b); expect(h.result.current.canSave).toBe(false);
    act(() => h.result.current.changeDraft(null)); await act(() => h.result.current.save()); expect(api.save.mock.calls[1][2]).toEqual({ modelVersionId: null, expectedSelectionRevision: 2 });
  });

  it('blocks double-click saves synchronously and defers/coalesces focus reads until the mutation settles', async () => {
    const pending = deferred<{ selection: ProjectModelSnapshot['selection'] }>(); api.save.mockReturnValue(pending.promise);
    const h = start(); await ready(h); act(() => h.result.current.changeDraft(b));
    let first!: Promise<void>; act(() => { first = h.result.current.save(); void h.result.current.save(); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    expect(api.save).toHaveBeenCalledTimes(1); expect(api.get).toHaveBeenCalledTimes(1);
    api.get.mockResolvedValueOnce(snapshot(b, 2)); await act(async () => { pending.resolve({ selection: snapshot(b, 2).selection }); await first; }); expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('clears an old Saved notice when a pristine refresh observes a new revision, even for the same UUID', async () => {
    const h = start(); await ready(h); act(() => h.result.current.changeDraft(b)); await act(() => h.result.current.save());
    expect(h.result.current.notice).toBe('Model selection saved.');
    api.get.mockResolvedValueOnce(snapshot(b, 2)); await act(() => h.result.current.refresh()); expect(h.result.current.notice).toBe('Model selection saved.');
    api.get.mockResolvedValueOnce(snapshot(b, 3)); await act(() => h.result.current.refresh());
    expect(h.result.current.snapshot?.selection).toMatchObject({ activeModelVersionId: b, selectionRevision: 3 });
    expect(h.result.current.draftId).toBe(b); expect(h.result.current.notice).toBeNull(); expect(h.result.current.stale).toBe(false); expect(h.result.current.conflict).toBeNull(); expect(h.result.current.canSave).toBe(false); expect(api.save).toHaveBeenCalledTimes(1);
  });

  it('409 refreshes latest authority but retains draft and requires an explicit decision before a new CAS', async () => {
    api.save.mockRejectedValueOnce(new ProjectModelApiError('SELECTION_CONFLICT', 409)); const h = start(); await ready(h);
    act(() => h.result.current.changeDraft(b)); api.get.mockResolvedValueOnce(snapshot(null, 2)); await act(() => h.result.current.save());
    expect(h.result.current.snapshot?.selection.activeModelVersionId).toBeNull(); expect(h.result.current.draftId).toBe(b); expect(h.result.current.conflict).not.toBeNull(); expect(h.result.current.canSave).toBe(false); expect(api.save).toHaveBeenCalledTimes(1);
    await act(() => h.result.current.save()); expect(api.save).toHaveBeenCalledTimes(1);
    act(() => h.result.current.confirmDraftAgainstLatest()); expect(h.result.current.canSave).toBe(true); await act(() => h.result.current.save()); expect(api.save.mock.calls[1][2].expectedSelectionRevision).toBe(2);
  });

  it('focus refresh retains a dirty draft and treats same UUID with a new revision as a conflict', async () => {
    const h = start(); await ready(h); act(() => h.result.current.changeDraft(b)); api.get.mockResolvedValueOnce(snapshot(a, 2));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(h.result.current.draftId).toBe(b); expect(h.result.current.snapshot?.selection.selectionRevision).toBe(2); expect(h.result.current.conflict).not.toBeNull(); expect(h.result.current.canSave).toBe(false);
    act(() => h.result.current.useLatestSelection()); expect(h.result.current.draftId).toBe(a); expect(h.result.current.conflict).toBeNull(); expect(api.save).not.toHaveBeenCalled();
  });

  it('503 refreshes health and keeps the active model and draft without fallback selection', async () => {
    api.save.mockRejectedValueOnce(new ProjectModelApiError('MODEL_UNAVAILABLE', 503)); const h = start(); await ready(h); act(() => h.result.current.changeDraft(b));
    const next = snapshot(a); next.versions[1].health = 'unavailable'; api.get.mockResolvedValueOnce(next); await act(() => h.result.current.save());
    expect(h.result.current.snapshot?.selection.activeModelVersionId).toBe(a); expect(h.result.current.draftId).toBe(b); expect(h.result.current.error).toContain('unavailable'); expect(h.result.current.canSave).toBe(false); expect(api.save).toHaveBeenCalledTimes(1);
  });

  it('lost PATCH reply reconciles with GET without repeating mutation or claiming Saved', async () => {
    api.save.mockRejectedValueOnce(new ProjectModelApiError('NETWORK_ERROR')); const h = start(); await ready(h); act(() => h.result.current.changeDraft(b));
    const read = deferred<ProjectModelSnapshot>(); api.get.mockReturnValueOnce(read.promise);
    let saving!: Promise<void>; act(() => { saving = h.result.current.save(); }); await waitFor(() => expect(h.result.current.reconciling).toBe(true));
    await act(async () => { read.resolve(snapshot(b, 2)); await saving; });
    expect(h.result.current.snapshot?.selection.activeModelVersionId).toBe(b); expect(h.result.current.draftId).toBe(b); expect(h.result.current.conflict).toContain('could not be confirmed'); expect(h.result.current.notice).not.toContain('saved.'); expect(api.save).toHaveBeenCalledTimes(1); expect(h.result.current.canSave).toBe(false);
  });

  it('retains old information as stale when reconciliation/refresh fails', async () => {
    const h = start(); await ready(h); act(() => h.result.current.changeDraft(b)); api.get.mockRejectedValueOnce(new ProjectModelApiError('NETWORK_ERROR')); await act(() => h.result.current.refresh());
    expect(h.result.current.snapshot?.selection.activeModelVersionId).toBe(a); expect(h.result.current.draftId).toBe(b); expect(h.result.current.stale).toBe(true); expect(h.result.current.canSave).toBe(false);
  });

  it('lost reply followed by failed reconciliation and Retry preserves the unknown outcome and requires review', async () => {
    const h = start(); await ready(h); act(() => h.result.current.changeDraft(b));
    api.save.mockRejectedValueOnce(new ProjectModelApiError('NETWORK_ERROR')); api.get.mockRejectedValueOnce(new ProjectModelApiError('NETWORK_ERROR'));
    await act(() => h.result.current.save());
    expect(h.result.current.stale).toBe(true); expect(h.result.current.snapshot?.selection.activeModelVersionId).toBe(a); expect(h.result.current.draftId).toBe(b); expect(h.result.current.conflict).toContain('could not be confirmed');
    api.get.mockResolvedValueOnce(snapshot(null, 3)); await act(() => h.result.current.refresh());
    expect(h.result.current.stale).toBe(false); expect(h.result.current.snapshot?.selection.selectionRevision).toBe(3); expect(h.result.current.draftId).toBe(b); expect(h.result.current.conflict).toContain('could not be confirmed'); expect(h.result.current.canSave).toBe(false); expect(api.save).toHaveBeenCalledTimes(1);
    act(() => h.result.current.confirmDraftAgainstLatest()); expect(h.result.current.canSave).toBe(true);
    await act(() => h.result.current.save()); expect(api.save.mock.calls[1][2]).toEqual({ modelVersionId: b, expectedSelectionRevision: 3 });
  });

  it('ignores an older GET even if transport ignores its aborted signal', async () => {
    const old = deferred<ProjectModelSnapshot>(); api.get.mockReturnValueOnce(old.promise); const h = start();
    api.get.mockResolvedValueOnce(snapshot(null, 2)); await act(() => h.result.current.refresh());
    await act(async () => old.resolve(snapshot(a, 1))); expect(h.result.current.snapshot?.selection.selectionRevision).toBe(2); expect(h.result.current.draftId).toBeNull();
    expect(api.get.mock.calls[0][2].signal.aborted).toBe(true);
  });

  it.each(['project', 'token', 'logout'] as const)('isolates late GET/PATCH on %s change and aborts the old scope', async kind => {
    const pending = deferred<{ selection: ProjectModelSnapshot['selection'] }>(); const h = start(); await ready(h); act(() => h.result.current.changeDraft(b)); api.save.mockReturnValueOnce(pending.promise);
    let saving!: Promise<void>; act(() => { saving = h.result.current.save(); }); const oldSignal = api.save.mock.calls[0][3].signal;
    const next = { projectId: kind === 'project' ? otherProject : projectId, token: kind === 'logout' ? null : kind === 'token' ? 'token-b' : 'token-a', canEdit: true };
    api.get.mockResolvedValueOnce(snapshot(null, 5, next.projectId)); h.rerender(next);
    await act(async () => { pending.resolve({ selection: snapshot(b, 2).selection }); await saving; });
    expect(oldSignal.aborted).toBe(true); expect(h.result.current.notice).toBeNull();
    if (kind === 'logout') expect(h.result.current.snapshot).toBeNull(); else { await ready(h); expect(h.result.current.snapshot?.selection.selectionRevision).toBe(5); expect(h.result.current.draftId).toBeNull(); }
  });

  it.each(['project', 'token', 'logout'] as const)('ignores a late initial GET from the old %s scope even if it resolves after the new read', async kind => {
    const pending = deferred<ProjectModelSnapshot>(); api.get.mockReturnValueOnce(pending.promise); const h = start(); const oldSignal = api.get.mock.calls[0][2].signal;
    const next = { projectId: kind === 'project' ? otherProject : projectId, token: kind === 'logout' ? null : kind === 'token' ? 'token-b' : 'token-a', canEdit: true };
    api.get.mockResolvedValueOnce(snapshot(null, 8, next.projectId)); h.rerender(next);
    if (kind !== 'logout') await ready(h);
    await act(async () => pending.resolve(snapshot(b, 1)));
    expect(oldSignal.aborted).toBe(true);
    if (kind === 'logout') expect(h.result.current.snapshot).toBeNull(); else expect(h.result.current.snapshot?.selection).toMatchObject({ activeModelVersionId: null, selectionRevision: 8, projectId: next.projectId });
    expect(api.save).not.toHaveBeenCalled();
  });

  it('aborts pending GET and save on unmount and no late completion initiates reconciliation', async () => {
    const old = deferred<ProjectModelSnapshot>(); api.get.mockReturnValueOnce(old.promise); const h = start(); const signal = api.get.mock.calls[0][2].signal; h.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => old.resolve(snapshot())); expect(api.get).toHaveBeenCalledTimes(1);
    const pending = deferred<{ selection: ProjectModelSnapshot['selection'] }>(); api.get.mockResolvedValueOnce(snapshot()); const second = start(); await ready(second); act(() => second.result.current.changeDraft(b)); api.save.mockReturnValueOnce(pending.promise);
    let saving!: Promise<void>; act(() => { saving = second.result.current.save(); }); const saveSignal = api.save.mock.calls[0][3].signal; second.unmount();
    await act(async () => { pending.reject(new ProjectModelApiError('NETWORK_ERROR')); await saving; }); expect(saveSignal.aborted).toBe(true); expect(api.get).toHaveBeenCalledTimes(2);
  });
});
