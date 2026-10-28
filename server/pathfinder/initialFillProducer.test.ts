// @vitest-environment node
import type { PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialFillProducer } from './initialFillProducer.js';
import type { InitialFillAttempts, InitialFillClaim } from './initialFillAttempts.js';
import type { InitialFillWriter } from './initialFillWriter.js';
import { PathFinderError } from './errors.js';

const id = (n: number) => `af420000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const claim: InitialFillClaim = { projectId: id(1), actorId: id(2), idempotencyKey: id(3), ownerToken: id(4), leaseExpiresAt: '2099-01-01T00:00:00Z',
    request: { schemaVersion: 'wfc.pf.initial-fill-request.v1', idempotencyKey: id(3), proposalId: id(5), expectedProposalHash: 'a'.repeat(64), mandateId: id(6), expectedCableWriteRevision: '7' } };
  const attempts = { discover: vi.fn().mockResolvedValue(1), claim: vi.fn().mockResolvedValueOnce(claim).mockResolvedValue(null),
    fence: vi.fn().mockResolvedValue(undefined), finish: vi.fn().mockResolvedValue(undefined) };
  const writer = { apply: vi.fn().mockResolvedValue({ status: 'written', receiptId: id(7), cableId: id(8) }) };
  const producer = createInitialFillProducer(attempts as unknown as InitialFillAttempts, writer as unknown as InitialFillWriter);
  return { claim, attempts, writer, producer };
}
afterEach(() => { vi.restoreAllMocks(); });

describe('separate bounded conditional initial-fill producer with synthetic adapters', () => {
  it('passes the exact retained request and live claim fence to the distinct writer, then records its receipt', async () => {
    const f = fixture(), client = {} as PoolClient;
    f.writer.apply.mockImplementationOnce(async (projectId, request, fence, signal) => {
      expect(projectId).toBe(f.claim.projectId); expect(request).toBe(f.claim.request); expect(signal.aborted).toBe(false);
      await fence(client); return { status: 'written', receiptId: id(7), cableId: id(8) };
    });
    await f.producer.tick(); expect(f.attempts.fence).toHaveBeenCalledExactlyOnceWith(client, f.claim);
    expect(f.attempts.finish).toHaveBeenCalledExactlyOnceWith(f.claim, { status: 'written', receiptId: id(7), cableId: id(8) });
    expect(f.producer.lastErrorCode).toBeNull(); await f.producer.stop();
  });
  it('no mandate-owned attempt means no writer call, even when a calculation-only job may exist elsewhere', async () => {
    const f = fixture(); f.attempts.claim.mockReset().mockResolvedValue(null); await f.producer.tick();
    expect(f.attempts.discover).toHaveBeenCalledOnce(); expect(f.writer.apply).not.toHaveBeenCalled(); expect(f.attempts.finish).not.toHaveBeenCalled(); await f.producer.stop();
  });
  it('caps each tick at five conditional writes instead of draining an unbounded project', async () => {
    const f = fixture(); f.attempts.claim.mockReset().mockResolvedValue(f.claim); await f.producer.tick();
    expect(f.writer.apply).toHaveBeenCalledTimes(5); expect(f.attempts.finish).toHaveBeenCalledTimes(5); expect(f.attempts.discover).toHaveBeenCalledOnce(); await f.producer.stop();
  });
  it('single-flights overlapping ticks and does no work after stop', async () => {
    const f = fixture(), pending = deferred<number>(); f.attempts.discover.mockReturnValueOnce(pending.promise);
    const first = f.producer.tick(), second = f.producer.tick(); expect(first).toBe(second); expect(f.attempts.discover).toHaveBeenCalledOnce();
    pending.resolve(1); await first; await f.producer.stop(); await f.producer.tick(); expect(f.attempts.discover).toHaveBeenCalledOnce();
  });
  it.each(['INITIAL_FILL_COMMIT_OUTCOME_UNKNOWN', 'ENDPOINT_COMMIT_OUTCOME_UNKNOWN', 'SCHEDULER_COMMIT_OUTCOME_UNKNOWN', 'ENDPOINT_DATABASE_BUSY', 'SCHEDULER_DATABASE_BUSY'])(
    'retains exact-key unknown recovery for %s without inventing a new request', async code => {
      const f = fixture(); f.writer.apply.mockRejectedValueOnce(new PathFinderError(code, 503)); await f.producer.tick();
      expect(f.attempts.finish).toHaveBeenCalledExactlyOnceWith(f.claim, { status: 'unknown', receiptId: null, code });
      expect(f.writer.apply.mock.calls[0][1]).toBe(f.claim.request); expect(f.producer.lastErrorCode).toBe(code); await f.producer.stop();
    });
  it.each(['INITIAL_FILL_MANDATE_EXPIRED', 'LOGIN_REVOKED', 'ADMIN_REQUIRED', 'LOCATION_IMPACT_RESTORE_FENCED'])(
    'terminally records missing original authority %s without authorizing a calculation grant', async code => {
      const f = fixture(); f.writer.apply.mockRejectedValueOnce(new PathFinderError(code, 403)); await f.producer.tick();
      expect(f.attempts.finish).toHaveBeenCalledExactlyOnceWith(f.claim, { status: 'authority-expired', receiptId: null, code }); expect(f.writer.apply).toHaveBeenCalledOnce(); await f.producer.stop();
    });
  it.each(['PROPOSAL_STALE', 'INITIAL_FILL_ORIGINAL_SCOPE_CHANGED', 'LOCATION_IMPACT_TARGET_SUPERSEDED', 'CABLE_WRITE_CONFLICT'])(
    'records intervening input %s as stale without retrying or replacing the body', async code => {
      const f = fixture(); f.writer.apply.mockRejectedValueOnce(new PathFinderError(code, 409)); await f.producer.tick();
      expect(f.attempts.finish).toHaveBeenCalledExactlyOnceWith(f.claim, { status: 'stale', receiptId: null, code }); await f.producer.stop();
    });
  it.each(['INITIAL_FILL_MANDATE_REQUIRED', 'HUMAN_ADMINISTRATOR_REQUIRED', 'PROPOSAL_NOT_APPLICABLE', 'ENGINE_TIMEOUT', 'no_path'])(
    'terminally refuses %s rather than automatically recalculating or refreshing authority', async code => {
      const f = fixture(); f.writer.apply.mockRejectedValueOnce(new PathFinderError(code, 409)); await f.producer.tick();
      expect(f.attempts.finish).toHaveBeenCalledExactlyOnceWith(f.claim, { status: 'refused', receiptId: null, code }); await f.producer.stop();
    });
  it('reports generic write failure with a safe code and never exposes private transport text', async () => {
    const f = fixture(); f.writer.apply.mockRejectedValueOnce(new Error('Private transport and credential details.')); await f.producer.tick();
    expect(f.producer.lastErrorCode).toBe('INITIAL_FILL_WRITE_REFUSED');
    expect(f.attempts.finish).toHaveBeenCalledWith(f.claim, { status: 'refused', receiptId: null, code: 'INITIAL_FILL_WRITE_REFUSED' }); await f.producer.stop();
  });
  it('deadline abort retains unknown outcome while waiting for the writer to settle before releasing tick ownership', async () => {
    const f = fixture(), deadline = new AbortController(), entered = deferred<void>(), complete = deferred<void>();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    f.writer.apply.mockImplementationOnce(async (_project, _request, _fence, signal) => {
      entered.resolve(); await complete.promise; signal.throwIfAborted(); return { status: 'written', receiptId: id(7), cableId: id(8) };
    });
    const tick = f.producer.tick(); await entered.promise; expect(timeout).toHaveBeenCalledWith(45000);
    deadline.abort(new Error('Synthetic deadline.')); expect(f.attempts.finish).not.toHaveBeenCalled(); complete.resolve(); await tick;
    expect(f.attempts.finish).toHaveBeenCalledWith(f.claim, { status: 'unknown', receiptId: null, code: 'INITIAL_FILL_INTERRUPTED' }); await f.producer.stop();
  });
  it('start is idempotent and stop aborts and joins an in-flight writer plus terminal bookkeeping', async () => {
    const f = fixture(), entered = deferred<void>(), released = deferred<void>(), finished = deferred<void>(); let actualSignal: AbortSignal | undefined;
    f.writer.apply.mockImplementationOnce(async (_project, _request, _fence, signal) => { actualSignal = signal; entered.resolve(); await released.promise; signal.throwIfAborted(); return { status: 'written', receiptId: id(7), cableId: id(8) }; });
    f.attempts.finish.mockImplementationOnce(async () => { await finished.promise; });
    f.producer.start(); f.producer.start(); await entered.promise; const stop = f.producer.stop(); expect(actualSignal!.aborted).toBe(true);
    let stopped = false; void stop.then(() => { stopped = true; }); await Promise.resolve(); expect(stopped).toBe(false);
    released.resolve(); await vi.waitFor(() => expect(f.attempts.finish).toHaveBeenCalledOnce()); expect(stopped).toBe(false);
    finished.resolve(); await stop; expect(stopped).toBe(true); expect(f.attempts.discover).toHaveBeenCalledOnce(); expect(f.attempts.claim).toHaveBeenCalledOnce();
    await f.producer.tick(); expect(f.attempts.discover).toHaveBeenCalledOnce();
  });
  it.each(['discover', 'claim'] as const)('retains %s admission failure without calling a writer or fabricating a finish', async phase => {
    const f = fixture(); f.attempts[phase].mockReset().mockRejectedValueOnce(new PathFinderError('SCHEDULER_DATABASE_BUSY', 503)); await f.producer.tick();
    expect(f.producer.lastErrorCode).toBe('SCHEDULER_DATABASE_BUSY'); expect(f.writer.apply).not.toHaveBeenCalled(); expect(f.attempts.finish).not.toHaveBeenCalled(); await f.producer.stop();
  });
  it('a lost finish acknowledgement reuses the same claim for unknown reconciliation instead of a replacement write', async () => {
    const f = fixture(); f.attempts.finish.mockRejectedValueOnce(new PathFinderError('SCHEDULER_COMMIT_OUTCOME_UNKNOWN', 503)); await f.producer.tick();
    expect(f.writer.apply).toHaveBeenCalledOnce(); expect(f.attempts.finish.mock.calls.map(([claim]) => claim)).toEqual([f.claim, f.claim]);
    expect(f.attempts.finish.mock.calls[1][1]).toEqual({ status: 'unknown', receiptId: null, code: 'SCHEDULER_COMMIT_OUTCOME_UNKNOWN' }); await f.producer.stop();
  });
  it('a later exact recovery receipt is already-written, without creating a different request', async () => {
    const f = fixture(); f.writer.apply.mockResolvedValueOnce({ status: 'already-written', receiptId: id(7), cableId: id(8) }); await f.producer.tick();
    expect(f.writer.apply.mock.calls[0][1]).toBe(f.claim.request); expect(f.attempts.finish).toHaveBeenCalledWith(f.claim, { status: 'already-written', receiptId: id(7), cableId: id(8) }); await f.producer.stop();
  });
});
