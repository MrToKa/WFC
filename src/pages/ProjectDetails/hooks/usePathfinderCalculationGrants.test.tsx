import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { fetchCalculationGrantContext, sendCalculationGrantCommand, CalculationGrantsApiError } from '@/api/pathfinderCalculationGrants';
import { usePathfinderCalculationGrants, type CalculationGrantAccess } from './usePathfinderCalculationGrants';
import { calculationGrantFixture, calculationGrantIds as ids } from '@/test/calculationGrantFixtures';
vi.mock('@/api/pathfinderCalculationGrants', async original => ({ ...(await original<typeof import('@/api/pathfinderCalculationGrants')>()), fetchCalculationGrantContext: vi.fn(), sendCalculationGrantCommand: vi.fn() }));
const key = 'wfc.pathfinder.calculation-grant.pending.v1';
const access = (): CalculationGrantAccess => ({ projectId: ids.project, loadedProjectId: ids.project, accountId: ids.actor, token: 'token', isAdmin: true, active: true, contextKey: 'model-A', onChanged: vi.fn(), onAuthorityLost: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto); vi.mocked(fetchCalculationGrantContext).mockResolvedValue(calculationGrantFixture().context); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('explicit grant authority and exact command recovery', () => {
  it('reads status without enabling or scheduling and refuses engineer, accountless or mismatched-project access', async () => {
    const props = access(), { result, rerender } = renderHook(p => usePathfinderCalculationGrants(p), { initialProps: { ...props, isAdmin: false } });
    expect(result.current.enabled).toBe(false); expect(fetchCalculationGrantContext).not.toHaveBeenCalled();
    rerender({ ...props, loadedProjectId: ids.actor }); expect(fetchCalculationGrantContext).not.toHaveBeenCalled();
    rerender({ ...props, accountId: null }); expect(fetchCalculationGrantContext).not.toHaveBeenCalled();
    rerender(props); await waitFor(() => expect(result.current.context).not.toBeNull()); expect(sendCalculationGrantCommand).not.toHaveBeenCalled();
  });
  it('reconciles the same frozen uncertain command after model changes and ignores a replacement key', async () => {
    const f = calculationGrantFixture(), props = access();
    vi.mocked(sendCalculationGrantCommand).mockRejectedValueOnce(new CalculationGrantsApiError('ACK_UNKNOWN', null, 'Unknown')).mockResolvedValueOnce({ ...f.receipt, duplicate: true });
    const { result, rerender } = renderHook(p => usePathfinderCalculationGrants(p), { initialProps: props });
    await waitFor(() => expect(result.current.context).not.toBeNull()); act(() => result.current.command(f.command)); await waitFor(() => expect(result.current.unknown).toBe(true));
    const saved = result.current.pending; expect(Object.isFrozen(saved)).toBe(true);
    rerender({ ...props, contextKey: 'new-model-new-preferences' }); await waitFor(() => expect(result.current.context).not.toBeNull()); expect(result.current.pending).toBe(saved);
    act(() => result.current.command({ ...f.command, idempotencyKey: ids.actor })); expect(sendCalculationGrantCommand).toHaveBeenCalledOnce();
    vi.mocked(fetchCalculationGrantContext).mockResolvedValueOnce(f.enabled); act(() => result.current.retry()); await waitFor(() => expect(result.current.pending).toBeNull());
    expect(vi.mocked(sendCalculationGrantCommand).mock.calls[1][2]).toBe(saved); expect(result.current.context?.controlRevision).toBe('1');
  });
  it('retains confirmed command success when the subsequent status read fails', async () => {
    const f = calculationGrantFixture(); vi.mocked(sendCalculationGrantCommand).mockResolvedValueOnce(f.receipt);
    const { result } = renderHook(() => usePathfinderCalculationGrants(access())); await waitFor(() => expect(result.current.context).not.toBeNull());
    vi.mocked(fetchCalculationGrantContext).mockRejectedValueOnce(new Error('Status unavailable'));
    act(() => result.current.command(f.command)); await waitFor(() => expect(result.current.error).toBe('Status unavailable'));
    expect(result.current.pending).toBeNull(); expect(result.current.unknown).toBe(false); expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('keeps refusal distinct from uncertainty and requires a refreshed context before new work', async () => {
    const f = calculationGrantFixture(); vi.mocked(sendCalculationGrantCommand).mockRejectedValueOnce(new CalculationGrantsApiError('GRANT_CONTROL_CONFLICT', 409, 'Refresh current settings.', 'refused'));
    const { result } = renderHook(() => usePathfinderCalculationGrants(access())); await waitFor(() => expect(result.current.context).not.toBeNull());
    act(() => result.current.command(f.command)); await waitFor(() => expect(result.current.conflict).toBe(true)); expect(result.current.pending).toBeNull(); expect(result.current.unknown).toBe(false);
    act(() => result.current.command(f.command)); expect(sendCalculationGrantCommand).toHaveBeenCalledOnce();
    act(() => result.current.discardConflict()); await waitFor(() => expect(result.current.conflict).toBe(false));
  });
  it('restores bounded recovery after a fresh authorized GET without storing a bearer or sending automatically', async () => {
    const f = calculationGrantFixture(), props = { ...access(), token: 'private-bearer-value' };
    vi.mocked(sendCalculationGrantCommand).mockRejectedValueOnce(new CalculationGrantsApiError('ACK_UNKNOWN', null, 'Unknown'));
    const first = renderHook(() => usePathfinderCalculationGrants(props)); await waitFor(() => expect(first.result.current.context).not.toBeNull());
    act(() => first.result.current.command(f.command)); await waitFor(() => expect(first.result.current.unknown).toBe(true));
    const raw = sessionStorage.getItem(key)!; expect(raw).not.toContain(props.token); expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(65536); expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['accountId', 'command', 'projectId', 'savedAt', 'tokenEpoch', 'version']); first.unmount();
    let finish!: (value: typeof f.context) => void; vi.mocked(fetchCalculationGrantContext).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const second = renderHook(() => usePathfinderCalculationGrants(props)); act(() => second.result.current.retry()); expect(sendCalculationGrantCommand).toHaveBeenCalledOnce();
    await act(async () => finish(f.context)); await waitFor(() => expect(second.result.current.pending).toEqual(f.command)); expect(sendCalculationGrantCommand).toHaveBeenCalledOnce();
    vi.mocked(sendCalculationGrantCommand).mockResolvedValueOnce({ ...f.receipt, duplicate: true }); act(() => second.result.current.retry()); await waitFor(() => expect(second.result.current.pending).toBeNull());
    expect(vi.mocked(sendCalculationGrantCommand).mock.calls[1][2]).toEqual(f.command); expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('fences stale project responses and clears pending authority on a current-role refusal', async () => {
    const props = access(); let finish!: (value: ReturnType<typeof calculationGrantFixture>['context']) => void;
    vi.mocked(fetchCalculationGrantContext).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(p => usePathfinderCalculationGrants(p), { initialProps: props });
    rerender({ ...props, projectId: ids.key, loadedProjectId: ids.key, isAdmin: false }); await act(async () => finish(calculationGrantFixture().context)); expect(result.current.context).toBeNull();
    rerender(props); await waitFor(() => expect(result.current.context).not.toBeNull());
    vi.mocked(sendCalculationGrantCommand).mockRejectedValueOnce(new CalculationGrantsApiError('ADMIN_REQUIRED', 403, 'Denied', 'refused'));
    act(() => result.current.command(calculationGrantFixture().command)); await waitFor(() => expect(props.onAuthorityLost).toHaveBeenCalled());
    expect(result.current.context).toBeNull(); expect(result.current.pending).toBeNull(); expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('cannot recreate pending storage or send after unmount during deferred token hashing', async () => {
    let finish!: (value: ArrayBuffer) => void; vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, unmount } = renderHook(() => usePathfinderCalculationGrants(access())); await waitFor(() => expect(result.current.context).not.toBeNull());
    act(() => result.current.command(calculationGrantFixture().command)); expect(result.current.pending).not.toBeNull(); unmount(); sessionStorage.removeItem(key);
    await act(async () => finish(new ArrayBuffer(32))); expect(sessionStorage.getItem(key)).toBeNull(); expect(sendCalculationGrantCommand).not.toHaveBeenCalled();
  });
  it('allows a fresh authorized read after an observed account-role cycle without restoring denied pending work', async () => {
    const props = access(); vi.mocked(fetchCalculationGrantContext).mockRejectedValueOnce(new CalculationGrantsApiError('ADMIN_REQUIRED', 403, 'Denied', 'refused'));
    const { result, rerender } = renderHook(p => usePathfinderCalculationGrants(p), { initialProps: props }); await waitFor(() => expect(props.onAuthorityLost).toHaveBeenCalled());
    rerender({ ...props, isAdmin: false }); rerender(props); await waitFor(() => expect(result.current.context).not.toBeNull());
    expect(fetchCalculationGrantContext).toHaveBeenCalledTimes(2); expect(result.current.pending).toBeNull(); expect(sendCalculationGrantCommand).not.toHaveBeenCalled();
  });
  it.each(['expired', 'future', 'oversized'])('discards $0 recovery records after the fresh authorized GET', async kind => {
    const f = calculationGrantFixture(), props = access();
    const epoch = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(props.token!)))].map(b => b.toString(16).padStart(2, '0')).join('');
    const record = { version: 1, projectId: ids.project, accountId: ids.actor, tokenEpoch: epoch, savedAt: kind === 'future' ? Date.now() + 60000 : Date.now() - 24 * 60 * 60 * 1000 - 1, command: f.command };
    sessionStorage.setItem(key, kind === 'oversized' ? 'x'.repeat(65537) : JSON.stringify(record));
    const { result } = renderHook(() => usePathfinderCalculationGrants(props)); await waitFor(() => expect(result.current.context).not.toBeNull());
    expect(sessionStorage.getItem(key)).toBeNull(); expect(result.current.pending).toBeNull(); expect(sendCalculationGrantCommand).not.toHaveBeenCalled();
  });
  it('discards malformed saved JSON and keeps in-memory reconciliation when browser storage refuses writes', async () => {
    sessionStorage.setItem(key, '{"version":1,"version":1}');
    const { result } = renderHook(() => usePathfinderCalculationGrants(access())); await waitFor(() => expect(result.current.context).not.toBeNull()); expect(sessionStorage.getItem(key)).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota full', 'QuotaExceededError'); });
    vi.mocked(sendCalculationGrantCommand).mockRejectedValueOnce(new CalculationGrantsApiError('ACK_UNKNOWN', null, 'Unknown'));
    act(() => result.current.command(calculationGrantFixture().command)); await waitFor(() => expect(result.current.unknown).toBe(true)); expect(result.current.pending).toEqual(calculationGrantFixture().command);
  });
  it.each([{ token: 'another-login' }, { accountId: ids.key }, { isAdmin: false }, { token: null }, { projectId: ids.key, loadedProjectId: ids.key }])('discards pending recovery after authority identity changes: %j', async change => {
    const props = access(); vi.mocked(sendCalculationGrantCommand).mockRejectedValueOnce(new CalculationGrantsApiError('ACK_UNKNOWN', null, 'Unknown'));
    const { result, rerender } = renderHook(p => usePathfinderCalculationGrants(p), { initialProps: props }); await waitFor(() => expect(result.current.context).not.toBeNull());
    act(() => result.current.command(calculationGrantFixture().command)); await waitFor(() => expect(result.current.unknown).toBe(true)); expect(sessionStorage.getItem(key)).not.toBeNull();
    rerender({ ...props, ...change }); await waitFor(() => expect(result.current.pending).toBeNull()); expect(sessionStorage.getItem(key)).toBeNull(); expect(sendCalculationGrantCommand).toHaveBeenCalledOnce();
  });
});
