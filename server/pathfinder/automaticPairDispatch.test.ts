// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { createAutomaticPairDispatch } from './automaticPairDispatch.js';
import { PathFinderError } from './errors.js';

describe('durable automatic pair dispatch SQL fences', () => {
  function fixture() { const state = { row: { project_id: 'P', job_id: 'J', cable_id: 'C' } as Record<string, unknown> | null,
    fence: { status: 'running', owner_token: 'O', lease_until: new Date(Date.now() + 10000).toISOString() }, recoveryDue: true,
    recovery: { status: 'unknown', attempts: 3, owner_token: null as string | null, lease_until: null }, reconciled: 0 };
    const query = vi.fn(async (sql: string, _args?: unknown[]) => {
      if (sql.includes('automatic-pair:claim')) return { rows: state.row ? [state.row] : [] };
      if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: 'P' }] };
      if (sql.includes('recovery-candidate')) return { rows: state.recoveryDue && state.row ? [state.row] : [] };
      if (sql.includes('recovery-lock')) return { rows: state.recoveryDue ? [state.recovery] : [] };
      if (sql.includes('recovery-finish')) { state.recoveryDue = false; state.reconciled++; return { rows: [], rowCount: 1 }; }
      if (sql.includes('dispatch-fence')) return { rows: [state.fence] }; return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient, pool = { connect: async () => client } as unknown as Pool;
    return { state, query, client, dispatch: createAutomaticPairDispatch(pool) }; }
  it('claims only sealed completed calculated items under exact row ownership', async () => {
    const f = fixture(), claim = await f.dispatch.claim(); expect(claim).toMatchObject({ projectId: 'P', jobId: 'J', cableId: 'C' });
    const sql = f.query.mock.calls.find(([sql]) => sql.includes('automatic-pair:claim'))![0];
    expect(sql).toContain('JOIN pf_revision_results'); expect(sql).toContain("i.state='complete'"); expect(sql).toContain('FOR UPDATE OF d SKIP LOCKED');
    expect(sql).toContain('d.attempts<3'); expect(sql).toContain('lease_until<=clock_timestamp()');
  });
  it('does not manufacture a claim without an exact completed result', async () => { const f = fixture(); f.state.row = null; expect(await f.dispatch.claim()).toBeNull(); });
  it('fences wrong owners and expired leases', async () => {
    const f = fixture(), claim = { projectId: 'P', jobId: 'J', cableId: 'C', ownerToken: 'O', leaseExpiresAt: f.state.fence.lease_until };
    await expect(f.dispatch.fence(f.client, claim)).resolves.toBeUndefined();
    await expect(f.dispatch.fence(f.client, { ...claim, ownerToken: 'OTHER' })).rejects.toMatchObject({ code: 'AUTOMATIC_PAIR_CLAIM_FENCED' });
    f.state.fence.lease_until = new Date(0).toISOString(); await expect(f.dispatch.fence(f.client, { ...claim, leaseExpiresAt: f.state.fence.lease_until })).rejects.toBeDefined();
  });
  it('requires receipt identity for successful dispositions', async () => {
    const f = fixture(); await expect(f.dispatch.finish({} as never, { status: 'written', receiptId: null })).rejects.toMatchObject({ code: 'AUTOMATIC_PAIR_CLAIM_FENCED' });
  });
  it('does not requeue a terminal refusal or renew an exhausted unknown command', async () => {
    const f = fixture(), claim = { projectId: 'P', jobId: 'J', cableId: 'C', ownerToken: 'O', leaseExpiresAt: f.state.fence.lease_until };
    await f.dispatch.finish(claim, { status: 'review-required', receiptId: null });
    const call = f.query.mock.calls.find(([sql]) => sql.includes('automatic-pair:finish'))!;
    expect(call[0]).toContain("$4='unknown' AND attempts<3"); expect(call[0]).toContain("owner_token=$7 AND status='running'");
  });
  it.each([{ status: 'already-written' as const, receiptId: 'R' }, { status: 'refused' as const, receiptId: null, code: 'AUTOMATIC_PAIR_NOT_WRITTEN_CONFIRMED' }])(
    'reconciles $status under project then exact dispatch locks without a fourth claim', async outcome => {
      const f = fixture(), inspect = vi.fn(async () => outcome);
      expect(await f.dispatch.reconcileNext(inspect)).toEqual(outcome); expect(inspect).toHaveBeenCalledWith(f.client, { projectId: 'P', jobId: 'J', cableId: 'C' }, undefined);
      const queries = f.query.mock.calls.map(([sql]) => sql);
      expect(queries.findIndex(sql => sql.startsWith('SELECT id FROM projects'))).toBeLessThan(queries.findIndex(sql => sql.includes('recovery-lock')));
      expect(queries.some(sql => sql.includes('automatic-pair:claim'))).toBe(false);
      const finish = f.query.mock.calls.find(([sql]) => sql.includes('recovery-finish'))!;
      expect(finish[0]).toContain("status='unknown' AND attempts=3 AND owner_token IS NULL AND lease_until IS NULL");
      expect(finish[0]).not.toContain('attempts=attempts+'); expect(f.state.recovery.attempts).toBe(3);
      expect(await f.dispatch.reconcileNext(inspect)).toBeNull(); expect(inspect).toHaveBeenCalledOnce();
    });
  it('retains unavailable historical proof as unknown with a sixty second cooldown and unchanged attempt count', async () => {
    const f = fixture(), inspect = vi.fn(async () => { throw new PathFinderError('AUTOMATIC_PAIR_RECEIPT_INTEGRITY', 409); });
    expect(await f.dispatch.reconcileNext(inspect)).toEqual({ status: 'unknown', receiptId: null, code: 'AUTOMATIC_PAIR_RECEIPT_INTEGRITY' });
    const queries = f.query.mock.calls.map(([sql]) => sql), finish = f.query.mock.calls.find(([sql]) => sql.includes('recovery-finish'))!;
    expect(queries).toContain('ROLLBACK TO SAVEPOINT automatic_pair_reconciliation');
    expect(finish[0]).toContain("clock_timestamp()+interval '60 seconds'"); expect(finish[1]?.slice(3)).toEqual(['unknown', null, 'AUTOMATIC_PAIR_RECEIPT_INTEGRITY']);
    expect(f.state.recovery.attempts).toBe(3); expect(await f.dispatch.reconcileNext(inspect)).toBeNull(); expect(inspect).toHaveBeenCalledOnce();
  });
  it('rechecks the exhausted ownerless boundary after locking and leaves a live claim untouched', async () => {
    const f = fixture(), inspect = vi.fn(); f.state.recovery.owner_token = 'NEW';
    expect(await f.dispatch.reconcileNext(inspect)).toBeNull(); expect(inspect).not.toHaveBeenCalled(); expect(f.state.reconciled).toBe(0);
  });
});
