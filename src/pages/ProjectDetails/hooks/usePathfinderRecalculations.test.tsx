import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { fetchRecalculationContext, sendRecalculationCommand, RecalculationsApiError } from '@/api/pathfinderRecalculations';
import { usePathfinderRecalculations, type RecalculationAccess } from './usePathfinderRecalculations';
import { recalculationFixture, recalculationIds as ids } from '@/test/recalculationFixtures';
vi.mock('@/api/pathfinderRecalculations', async original => ({ ...(await original<typeof import('@/api/pathfinderRecalculations')>()), fetchRecalculationContext: vi.fn(), sendRecalculationCommand: vi.fn() }));
const access = (): RecalculationAccess => ({ projectId: ids.project, loadedProjectId: ids.project, token: 'token', isAdmin: true, active: true, contextKey: 'model-A', onChanged: vi.fn(), onAuthorityLost: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto); vi.mocked(fetchRecalculationContext).mockResolvedValue(recalculationFixture().context); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('durable recalculation recovery', () => {
  it('reads without producing any mutation and refuses engineer or mismatched project access', async () => {
    const props = access(), { result, rerender } = renderHook(p => usePathfinderRecalculations(p), { initialProps: { ...props, isAdmin: false } });
    expect(result.current.enabled).toBe(false); expect(fetchRecalculationContext).not.toHaveBeenCalled();
    rerender({ ...props, loadedProjectId: ids.actor }); expect(fetchRecalculationContext).not.toHaveBeenCalled();
    rerender(props); await waitFor(() => expect(result.current.context).not.toBeNull()); expect(sendRecalculationCommand).not.toHaveBeenCalled();
  });
  it('keeps the exact uncertain command across model/options generations and refreshes current state after historical receipt', async () => {
    const f = recalculationFixture(), props = access();
    vi.mocked(sendRecalculationCommand).mockRejectedValueOnce(new RecalculationsApiError('ACK_UNKNOWN', null, 'Unknown')).mockResolvedValueOnce({ ...f.receipt, duplicate: true });
    const { result, rerender } = renderHook(p => usePathfinderRecalculations(p), { initialProps: props });
    await waitFor(() => expect(result.current.context).not.toBeNull());
    act(() => result.current.command(f.command)); await waitFor(() => expect(result.current.unknown).toBe(true));
    const pending = result.current.pending; rerender({ ...props, contextKey: 'model-B-options-B' });
    await waitFor(() => expect(result.current.context).not.toBeNull()); expect(result.current.pending).toBe(pending);
    act(() => result.current.command({ ...f.command, idempotencyKey: ids.actor })); expect(sendRecalculationCommand).toHaveBeenCalledTimes(1);
    vi.mocked(fetchRecalculationContext).mockResolvedValueOnce({ ...f.enabled, controlRevision: '8', status: 'complete' });
    act(() => result.current.retry()); await waitFor(() => expect(result.current.context?.controlRevision).toBe('8'));
    expect(vi.mocked(sendRecalculationCommand).mock.calls[1][2]).toBe(pending); expect(result.current.pending).toBeNull();
  });
  it('never turns a confirmed command into an unknown command when its following GET fails', async () => {
    const f = recalculationFixture(); vi.mocked(sendRecalculationCommand).mockResolvedValue(f.receipt);
    const { result } = renderHook(() => usePathfinderRecalculations(access()));
    await waitFor(() => expect(result.current.context).not.toBeNull()); vi.mocked(fetchRecalculationContext).mockRejectedValueOnce(new Error('Read unavailable'));
    act(() => result.current.command(f.command)); await waitFor(() => expect(result.current.error).toBe('Read unavailable'));
    expect(result.current.pending).toBeNull(); expect(result.current.unknown).toBe(false);
  });
  it('clears pending authority on revocation and fences late previous-project reads', async () => {
    let finish!: (value: ReturnType<typeof recalculationFixture>['context']) => void;
    vi.mocked(fetchRecalculationContext).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const props = access(), { result, rerender } = renderHook(p => usePathfinderRecalculations(p), { initialProps: props });
    rerender({ ...props, projectId: ids.actor, loadedProjectId: ids.actor, isAdmin: false });
    await act(async () => finish(recalculationFixture().context)); expect(result.current.context).toBeNull();
    rerender(props); await waitFor(() => expect(result.current.context).not.toBeNull());
    vi.mocked(sendRecalculationCommand).mockRejectedValueOnce(new RecalculationsApiError('ACCESS_DENIED', 403, 'Denied', 'refused'));
    act(() => result.current.command(recalculationFixture().command)); await waitFor(() => expect(props.onAuthorityLost).toHaveBeenCalled());
    expect(result.current.pending).toBeNull(); expect(result.current.context).toBeNull();
  });
  it('restores a bounded exact command after reload only after fresh authority, without automatically sending it', async () => {
    const f = recalculationFixture(), props = { ...access(), accountId: ids.actor, token: 'private-bearer-value' };
    vi.mocked(sendRecalculationCommand).mockRejectedValueOnce(new RecalculationsApiError('ACK_UNKNOWN', null, 'Unknown'));
    const first = renderHook(() => usePathfinderRecalculations(props));
    await waitFor(() => expect(first.result.current.context).not.toBeNull());
    act(() => first.result.current.command(f.command)); await waitFor(() => expect(sendRecalculationCommand).toHaveBeenCalledOnce());
    const stored = sessionStorage.getItem('wfc.pathfinder.recalculation.pending.v1')!;
    expect(new TextEncoder().encode(stored).byteLength).toBeLessThanOrEqual(65536);
    expect(stored).not.toContain(props.token); expect(Object.keys(JSON.parse(stored)).sort()).toEqual(['accountId', 'command', 'projectId', 'savedAt', 'tokenEpoch', 'version']);
    expect(JSON.parse(stored).tokenEpoch).toMatch(/^[a-f0-9]{64}$/); first.unmount();
    let finish!: (value: typeof f.context) => void;
    vi.mocked(fetchRecalculationContext).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const second = renderHook(() => usePathfinderRecalculations(props));
    act(() => second.result.current.retry()); expect(sendRecalculationCommand).toHaveBeenCalledOnce(); expect(second.result.current.context).toBeNull();
    await act(async () => finish(f.context)); await waitFor(() => expect(second.result.current.pending).toEqual(f.command));
    expect(sendRecalculationCommand).toHaveBeenCalledOnce();
    vi.mocked(sendRecalculationCommand).mockResolvedValueOnce({ ...f.receipt, duplicate: true });
    act(() => second.result.current.retry()); await waitFor(() => expect(second.result.current.pending).toBeNull());
    expect(vi.mocked(sendRecalculationCommand).mock.calls[1][2]).toEqual(f.command); expect(sessionStorage.getItem('wfc.pathfinder.recalculation.pending.v1')).toBeNull();
  });
  it('cannot recreate recovery storage or send a command after logout unmount while token hashing is deferred', async () => {
    let finish!: (value: ArrayBuffer) => void;
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => new Promise<ArrayBuffer>(resolve => { finish = resolve; }));
    const props = { ...access(), accountId: ids.actor }, { result, unmount } = renderHook(() => usePathfinderRecalculations(props));
    await waitFor(() => expect(result.current.context).not.toBeNull());
    act(() => result.current.command(recalculationFixture().command));
    expect(result.current.pending).not.toBeNull(); expect(sendRecalculationCommand).not.toHaveBeenCalled();
    unmount(); sessionStorage.removeItem('wfc.pathfinder.recalculation.pending.v1');
    await act(async () => finish(new ArrayBuffer(32)));
    expect(sessionStorage.getItem('wfc.pathfinder.recalculation.pending.v1')).toBeNull(); expect(sendRecalculationCommand).not.toHaveBeenCalled();
  });
  it('discards malformed or oversized saved input and keeps an exact in-memory retry when storage quota refuses a write', async () => {
    const props = { ...access(), accountId: ids.actor }, key = 'wfc.pathfinder.recalculation.pending.v1';
    sessionStorage.setItem(key, '{"version":1,"version":1}');
    const first = renderHook(() => usePathfinderRecalculations(props)); await waitFor(() => expect(first.result.current.context).not.toBeNull());
    expect(sessionStorage.getItem(key)).toBeNull(); expect(first.result.current.pending).toBeNull(); first.unmount();
    sessionStorage.setItem(key, 'x'.repeat(65537));
    const second = renderHook(() => usePathfinderRecalculations(props)); await waitFor(() => expect(second.result.current.context).not.toBeNull());
    expect(sessionStorage.getItem(key)).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota full', 'QuotaExceededError'); });
    vi.mocked(sendRecalculationCommand).mockRejectedValueOnce(new RecalculationsApiError('ACK_UNKNOWN', null, 'Unknown'));
    act(() => second.result.current.command(recalculationFixture().command)); await waitFor(() => expect(sendRecalculationCommand).toHaveBeenCalledOnce());
    await waitFor(() => expect(second.result.current.unknown).toBe(true)); expect(second.result.current.pending).toEqual(recalculationFixture().command);
  });
  it.each([
    { token: 'another-login-token' }, { accountId: ids.key }, { isAdmin: false }, { token: null }, { projectId: ids.key, loadedProjectId: ids.key },
  ])('discards recovery on account/token/authority/project switch: %j', async change => {
    const f = recalculationFixture(), props: RecalculationAccess = { ...access(), accountId: ids.actor };
    vi.mocked(sendRecalculationCommand).mockRejectedValueOnce(new RecalculationsApiError('ACK_UNKNOWN', null, 'Unknown'));
    const { result, rerender } = renderHook(p => usePathfinderRecalculations(p), { initialProps: props });
    await waitFor(() => expect(result.current.context).not.toBeNull()); act(() => result.current.command(f.command));
    await waitFor(() => expect(sendRecalculationCommand).toHaveBeenCalledOnce()); expect(sessionStorage.getItem('wfc.pathfinder.recalculation.pending.v1')).not.toBeNull();
    rerender({ ...props, ...change }); await waitFor(() => expect(result.current.pending).toBeNull());
    expect(sessionStorage.getItem('wfc.pathfinder.recalculation.pending.v1')).toBeNull(); expect(sendRecalculationCommand).toHaveBeenCalledOnce();
  });
});
