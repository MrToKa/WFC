// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { automaticPairFailureOutcome, createAutomaticPairProducer } from './automaticPairProducer.js';
import { PathFinderError } from './errors.js';

function fixture() { const claim = { projectId: 'P', jobId: 'J', cableId: 'C', ownerToken: 'O', leaseExpiresAt: 'E' };
  const dispatch = { discover: vi.fn(async () => 0), reconcileNext: vi.fn(async () => null), claim: vi.fn().mockResolvedValueOnce(claim).mockResolvedValue(null), fence: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) };
  const writer = { apply: vi.fn(async () => ({ status: 'written' as const, receiptId: 'R' })), inspectInTransaction: vi.fn() };
  return { claim, dispatch, writer, producer: createAutomaticPairProducer(dispatch as never, writer as never) }; }
describe('bounded automatic pair service', () => {
  it('constructs without starting any work and processes only exact claimed work', async () => {
    const f = fixture(); expect(f.writer.apply).not.toHaveBeenCalled(); await f.producer.tick();
    expect(f.writer.apply).toHaveBeenCalledWith(f.claim, f.dispatch.fence, expect.any(AbortSignal));
    expect(f.dispatch.finish).toHaveBeenCalledWith(f.claim, { status: 'written', receiptId: 'R' }); await f.producer.stop();
  });
  it('serializes concurrent ticks', async () => {
    const f = fixture(); let release!: () => void; f.dispatch.discover.mockImplementation(() => new Promise<number>(resolve => { release = () => resolve(0); }));
    const first = f.producer.tick(), second = f.producer.tick(); expect(first).toBe(second); release(); await first; expect(f.writer.apply).toHaveBeenCalledOnce();
  });
  it('bounds each tick to five claims', async () => {
    const f = fixture(); f.dispatch.claim.mockReset().mockResolvedValue(f.claim); await f.producer.tick(); expect(f.writer.apply).toHaveBeenCalledTimes(5);
    expect(f.dispatch.reconcileNext).toHaveBeenCalledOnce(); expect(f.dispatch.reconcileNext).toHaveBeenCalledWith(f.writer.inspectInTransaction, expect.any(AbortSignal));
  });
  it('offers exhausted commands only to business-read-only reconciliation and never directly to apply', async () => {
    const f = fixture(); f.dispatch.claim.mockReset().mockResolvedValue(null); await f.producer.tick();
    expect(f.dispatch.reconcileNext).toHaveBeenCalledOnce(); expect(f.writer.apply).not.toHaveBeenCalled(); expect(f.dispatch.finish).not.toHaveBeenCalled();
  });
  it.each(['ENDPOINT_COMMIT_OUTCOME_UNKNOWN', 'SCHEDULER_DATABASE_BUSY'] as const)('retains unknown outcome after %s', async code => {
    const f = fixture(); f.writer.apply.mockRejectedValue(new PathFinderError(code, 503)); await f.producer.tick();
    expect(f.dispatch.finish).toHaveBeenCalledWith(f.claim, { status: 'unknown', receiptId: null, code });
  });
  it.each([['AUTOMATIC_PAIR_AUTHORITY_EXPIRED', 'authority-expired'], ['PROPOSAL_STALE', 'stale'], ['BAD_PROOF', 'refused']] as const)('classifies %s without another calculation', (code, status) => {
    expect(automaticPairFailureOutcome(new PathFinderError(code, 409), false)).toEqual({ status, receiptId: null, code });
  });
});
