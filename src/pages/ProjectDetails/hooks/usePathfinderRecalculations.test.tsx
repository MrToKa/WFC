import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { fetchRecalculationContext, sendRecalculationCommand, RecalculationsApiError } from '@/api/pathfinderRecalculations';
import { usePathfinderRecalculations, type RecalculationAccess } from './usePathfinderRecalculations';
import { recalculationFixture, recalculationIds as ids } from '@/test/recalculationFixtures';
import { AUTOMATIC_PAIR_POLICY } from '../../../../shared/pathfinderAutomaticPair';
import { recalculationCommandSchema } from '../../../../shared/pathfinderRecalculation';
vi.mock('@/api/pathfinderRecalculations', async original => ({ ...(await original<typeof import('@/api/pathfinderRecalculations')>()), fetchRecalculationContext: vi.fn(), sendRecalculationCommand: vi.fn() }));
const access = (): RecalculationAccess => ({ projectId: ids.project, loadedProjectId: ids.project, token: 'token', isAdmin: true, active: true, contextKey: 'model-A', onChanged: vi.fn(), onAuthorityLost: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto); vi.mocked(fetchRecalculationContext).mockResolvedValue(recalculationFixture().context); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('durable recalculation recovery', () => {
  it('refreshes output-only progress on the existing ten-second read poll without submitting or changing project inputs', async () => {
    vi.useFakeTimers(); const props = access(), f = recalculationFixture();
    const progress = { schemaVersion: 'wfc.pf.recalculation-progress.v1' as const, jobId: ids.key, generation: '7', total: 2, eligible: 1,
      blockedInputs: 1, waiting: 0, running: 0, processed: 1, calculated: 1, saved: 0, saving: 1,
      reviewRequired: 0, refused: 0, authorityExpired: 0, stale: 0, notScheduledForSave: 0, calculationFailed: 0 };
    const initial = { ...f.enabled, status: 'complete' as const, jobId: ids.key, completed: 2, automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY }, progress };
    vi.mocked(fetchRecalculationContext).mockResolvedValue(initial);
    const { result } = renderHook(() => usePathfinderRecalculations(props)); await act(async () => {});
    expect(result.current.context?.progress?.saving).toBe(1); expect(props.onChanged).not.toHaveBeenCalled();
    vi.mocked(fetchRecalculationContext).mockResolvedValue({ ...initial, progress: { ...progress, saved: 1, saving: 0 } });
    await act(async () => vi.advanceTimersByTimeAsync(9999)); expect(fetchRecalculationContext).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(result.current.context?.progress?.saved).toBe(1);
    expect(props.onChanged).toHaveBeenCalledOnce(); expect(sendRecalculationCommand).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(props.onChanged).toHaveBeenCalledOnce();
    expect(result.current.context?.desiredGeneration).toBe(initial.desiredGeneration);
    expect(result.current.context?.controlRevision).toBe(initial.controlRevision);
  });
  it('keeps a newer command busy and error-free when an older refused command finishes its deferred refresh', async () => {
    const f = recalculationFixture(); let finishOldRead!: (value: typeof f.context) => void, finishNewCommand!: (value: typeof f.receipt) => void;
    vi.mocked(sendRecalculationCommand).mockRejectedValueOnce(new RecalculationsApiError('AUTOMATIC_OUTPUT_ENABLE_REQUIRED', 409, 'Old output expired.', 'refused'))
      .mockImplementationOnce(() => new Promise(resolve => { finishNewCommand = resolve; }));
    const { result } = renderHook(() => usePathfinderRecalculations(access()));
    await waitFor(() => expect(result.current.context).not.toBeNull());
    vi.mocked(fetchRecalculationContext).mockImplementationOnce(() => new Promise(resolve => { finishOldRead = resolve; }));
    act(() => result.current.command(f.command));
    await waitFor(() => expect(result.current.pending).toBeNull());
    const next = recalculationCommandSchema.parse({ ...f.command, idempotencyKey: ids.actor });
    act(() => result.current.command(next)); await waitFor(() => expect(sendRecalculationCommand).toHaveBeenCalledTimes(2));
    const pending = result.current.pending; expect(result.current.busy).toBe(true); expect(result.current.error).toBeNull();
    await act(async () => finishOldRead(f.context));
    expect(result.current.pending).toBe(pending); expect(result.current.busy).toBe(true); expect(result.current.error).toBeNull();
    await act(async () => finishNewCommand(f.receipt)); await waitFor(() => expect(result.current.pending).toBeNull());
    expect(result.current.busy).toBe(false); expect(result.current.error).toBeNull();
  });
  it('bounds an unresponsive command to thirty seconds without losing its exact recovery intent', async () => {
    vi.useFakeTimers(); vi.mocked(sendRecalculationCommand).mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => usePathfinderRecalculations(access()));
    await act(async () => {}); expect(result.current.context).not.toBeNull();
    act(() => result.current.command(recalculationFixture().command)); await act(async () => {});
    const pending = result.current.pending;
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(result.current.busy).toBe(false); expect(result.current.unknown).toBe(true); expect(result.current.pending).toBe(pending);
    expect(result.current.error).toContain('within 30 seconds'); expect(sendRecalculationCommand).toHaveBeenCalledOnce();
    expect(vi.mocked(sendRecalculationCommand).mock.calls[0][3]?.aborted).toBe(true);
  });
  it('stops automatic busy recovery immediately when the retry loses authority', async () => {
    const props = access(); vi.mocked(sendRecalculationCommand).mockRejectedValueOnce(new RecalculationsApiError('PREFLIGHT_DATABASE_BUSY', 503, 'Busy'))
      .mockRejectedValueOnce(new RecalculationsApiError('LOGIN_REVOKED', 401, 'Revoked', 'refused'));
    const { result } = renderHook(() => usePathfinderRecalculations(props));
    await waitFor(() => expect(result.current.context).not.toBeNull()); act(() => result.current.command(recalculationFixture().command));
    await waitFor(() => expect(props.onAuthorityLost).toHaveBeenCalledOnce());
    expect(sendRecalculationCommand).toHaveBeenCalledTimes(2); expect(result.current.pending).toBeNull(); expect(result.current.context).toBeNull();
  });
  it('cancels the automatic backoff when the active scope changes, retaining the original command without resubmitting it', async () => {
    const props = access(); vi.mocked(sendRecalculationCommand).mockRejectedValue(new RecalculationsApiError('PREFLIGHT_DATABASE_BUSY', 503, 'Busy'));
    const { result, rerender } = renderHook(p => usePathfinderRecalculations(p), { initialProps: props });
    await waitFor(() => expect(result.current.context).not.toBeNull()); act(() => result.current.command(recalculationFixture().command));
    await waitFor(() => expect(sendRecalculationCommand).toHaveBeenCalledOnce()); const pending = result.current.pending;
    rerender({ ...props, contextKey: 'different-scope' }); await waitFor(() => expect(result.current.context).not.toBeNull());
    await act(async () => new Promise(resolve => setTimeout(resolve, 650)));
    expect(sendRecalculationCommand).toHaveBeenCalledOnce(); expect(result.current.pending).toBe(pending);
  });
  it('clears the command deadline as soon as its acknowledgement is verified, before a slow following GET', async () => {
    vi.useFakeTimers(); const f = recalculationFixture(); vi.mocked(sendRecalculationCommand).mockResolvedValue(f.receipt);
    const { result } = renderHook(() => usePathfinderRecalculations(access())); await act(async () => {});
    vi.mocked(fetchRecalculationContext).mockImplementation(() => new Promise(() => {}));
    act(() => result.current.command(f.command)); await act(async () => {});
    expect(result.current.pending).toBeNull(); await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(result.current.unknown).toBe(false); expect(result.current.error).toBeNull();
    // Polling may replace a slow GET; the command timer cannot revive uncertainty.
    expect(sendRecalculationCommand).toHaveBeenCalledOnce();
  });
  it.each(['PREFLIGHT_DATABASE_BUSY', 'RECALCULATION_DATABASE_BUSY'])('automatically reconciles only the same frozen command after typed %s', async code => {
    const f = recalculationFixture(), command = recalculationCommandSchema.parse({ schemaVersion: 'wfc.pf.recalculation-command.v2', action: 'retry',
      expectedControlRevision: f.context.controlRevision, idempotencyKey: ids.key, reason: 'Continue saved output.', automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } });
    vi.mocked(sendRecalculationCommand).mockRejectedValueOnce(new RecalculationsApiError(code, 503, 'Project is busy.'))
      .mockResolvedValueOnce({ ...f.receipt, duplicate: true });
    const { result } = renderHook(() => usePathfinderRecalculations(access()));
    await waitFor(() => expect(result.current.context).not.toBeNull());
    act(() => result.current.command(command));
    await waitFor(() => expect(sendRecalculationCommand).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.pending).toBeNull());
    const calls = vi.mocked(sendRecalculationCommand).mock.calls;
    expect(calls[1][2]).toBe(calls[0][2]); expect(calls[0][2]).toEqual(command);
    expect(result.current.unknown).toBe(false);
  });
  it('exhausts typed busy recovery after three sends and preserves its diagnostic across GET and context changes', async () => {
    const f = recalculationFixture(), props = access();
    vi.mocked(sendRecalculationCommand).mockRejectedValue(new RecalculationsApiError('RECALCULATION_DATABASE_BUSY', 503, 'Project remains busy.'));
    const { result, rerender } = renderHook(p => usePathfinderRecalculations(p), { initialProps: props });
    await waitFor(() => expect(result.current.context).not.toBeNull()); act(() => result.current.command(f.command));
    await waitFor(() => expect(result.current.unknown).toBe(true), { timeout: 4000 });
    expect(sendRecalculationCommand).toHaveBeenCalledTimes(3); const pending = result.current.pending;
    await act(async () => result.current.refresh()); expect(result.current.error).toBe('Project remains busy.'); expect(result.current.pending).toBe(pending);
    rerender({ ...props, contextKey: 'another-model-and-options' });
    await waitFor(() => expect(result.current.context).not.toBeNull());
    expect(result.current.error).toBe('Project remains busy.'); expect(result.current.pending).toBe(pending);
    expect(sendRecalculationCommand).toHaveBeenCalledTimes(3);
  });
  it.each([new Error('Network unavailable'), new RecalculationsApiError('INVALID_RESPONSE', null, 'Bad receipt'),
    new RecalculationsApiError('COMMIT_OUTCOME_UNKNOWN', 503, 'Commit unconfirmed'), new RecalculationsApiError('RECALCULATION_DATABASE_BUSY', 500, 'Wrong status')])('never automatically replays nonallowlisted uncertainty: %s', async error => {
    vi.mocked(sendRecalculationCommand).mockRejectedValue(error);
    const { result } = renderHook(() => usePathfinderRecalculations(access()));
    await waitFor(() => expect(result.current.context).not.toBeNull()); act(() => result.current.command(recalculationFixture().command));
    await waitFor(() => expect(result.current.unknown).toBe(true)); expect(sendRecalculationCommand).toHaveBeenCalledOnce();
  });
  it('keeps Enable available after a definite expired-output refusal instead of creating a replacement command', async () => {
    const f = recalculationFixture(); vi.mocked(sendRecalculationCommand).mockRejectedValue(new RecalculationsApiError('AUTOMATIC_OUTPUT_ENABLE_REQUIRED', 409, 'Enable again.', 'refused'));
    const { result } = renderHook(() => usePathfinderRecalculations(access()));
    await waitFor(() => expect(result.current.context).not.toBeNull()); act(() => result.current.command(f.command));
    await waitFor(() => expect(result.current.error).toBe('Enable again.'));
    expect(result.current.pending).toBeNull(); expect(result.current.conflict).toBe(false); expect(sendRecalculationCommand).toHaveBeenCalledOnce();
  });
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
  it('retains and restores the same frozen v2 output policy without upgrading a pending command', async () => {
    const f = recalculationFixture(), props = { ...access(), accountId: ids.actor };
    const command = recalculationCommandSchema.parse({ ...f.command, schemaVersion: 'wfc.pf.recalculation-command.v2', automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } });
    const receipt = { ...f.receipt, context: { ...f.enabled, automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } } };
    vi.mocked(sendRecalculationCommand).mockRejectedValueOnce(new RecalculationsApiError('ACK_UNKNOWN', null, 'Unknown')).mockResolvedValueOnce({ ...receipt, duplicate: true });
    const first = renderHook(() => usePathfinderRecalculations(props));
    await waitFor(() => expect(first.result.current.context).not.toBeNull());
    act(() => first.result.current.command(command)); await waitFor(() => expect(first.result.current.unknown).toBe(true));
    const pending = first.result.current.pending!;
    expect(Object.isFrozen(pending)).toBe(true); expect('automaticPairPolicy' in pending && Object.isFrozen(pending.automaticPairPolicy)).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('wfc.pathfinder.recalculation.pending.v1')!).command).toEqual(command);
    first.unmount();
    const second = renderHook(() => usePathfinderRecalculations({ ...props, contextKey: 'another-model' }));
    await waitFor(() => expect(second.result.current.pending).toEqual(command)); expect(sendRecalculationCommand).toHaveBeenCalledTimes(1);
    vi.mocked(fetchRecalculationContext).mockResolvedValueOnce(receipt.context);
    act(() => second.result.current.retry()); await waitFor(() => expect(second.result.current.pending).toBeNull());
    expect(vi.mocked(sendRecalculationCommand).mock.calls[1][2]).toEqual(command); expect(second.result.current.context?.automaticPairPolicy).toEqual(AUTOMATIC_PAIR_POLICY);
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
