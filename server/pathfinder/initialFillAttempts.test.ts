// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialFillRequestHashInput } from '../../shared/pathfinderInitialFill.js';
import { createInitialFillAttempts, type InitialFillClaim } from './initialFillAttempts.js';
import { initialFillIdempotencyKey } from './initialFillIdentity.js';
import { INITIAL_FILL_ATTEMPT_SQL, initializeInitialFillAttemptSchema } from './initialFillAttemptSchema.js';
import { hash } from './dependencies.js';

// Synthetic SQL protocol, using the real scheduler transaction. It does not
// prove actual PostgreSQL locking, row immutability, engine or mandate authority.
type Row = Record<string, any>;
const id = (n: number) => `af410000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-10-20T12:00:00.000Z');
const scopeKey = (project: string, actor: string, key: string) => `${project}:${actor}:${key}`;
function fixture() {
  const candidate = { project_id: id(1), mandate_id: id(2), actor_id: id(3), proposal_id: id(4), cable_id: id(5), proposal_hash: 'a'.repeat(64), revision: '9007199254740993' };
  const state = { candidates: [candidate] as Row[], attempts: new Map<string, Row>(), dispatch: new Map<string, Row>() };
  let snapshot: typeof state | null = null;
  const query = vi.fn(async (sql: string, args: any[] = []): Promise<{ rows: any[] }> => {
    if (sql === 'BEGIN') { snapshot = structuredClone(state); return { rows: [] }; }
    if (sql === 'ROLLBACK') { if (snapshot) Object.assign(state, snapshot); snapshot = null; return { rows: [] }; }
    if (sql === 'COMMIT') { snapshot = null; return { rows: [] }; }
    if (sql.startsWith('SET LOCAL') || sql.startsWith('SELECT pg_advisory_xact_lock') || sql === INITIAL_FILL_ATTEMPT_SQL) return { rows: [] };
    if (sql.startsWith('/* initial-fill:discover */')) return { rows: state.candidates.slice(0, 10) };
    if (sql.startsWith('INSERT INTO pf_initial_fill_attempts')) {
      const key = scopeKey(args[0], args[1], args[2]);
      if (!state.attempts.has(key)) state.attempts.set(key, { project_id: args[0], actor_id: args[1], idempotency_key: args[2], mandate_id: args[3],
        proposal_id: args[4], cable_id: args[5], request_sha256: args[6], request: structuredClone(args[7]) });
      return { rows: [] };
    }
    if (sql.startsWith('SELECT request_sha256,mandate_id')) { const row = state.attempts.get(scopeKey(args[0], args[1], args[2])); return { rows: row ? [row] : [] }; }
    if (sql.startsWith('INSERT INTO pf_initial_fill_dispatch')) {
      const key = scopeKey(args[0], args[1], args[2]); if (!state.dispatch.has(key)) state.dispatch.set(key, { project_id: args[0], actor_id: args[1], idempotency_key: args[2],
        status: 'pending', attempts: 0, owner_token: null, lease_until: null, not_before: now, receipt_id: null, reason_code: null }); return { rows: [] };
    }
    if (sql.startsWith('WITH exhausted')) {
      for (const row of [...state.dispatch.values()].filter(row => ['running', 'unknown'].includes(row.status) && row.attempts >= 3
        && row.lease_until !== null && Date.parse(row.lease_until) <= Date.now()).slice(0, 10))
        Object.assign(row, { status: 'unknown', reason_code: 'INITIAL_FILL_RECOVERY_LIMIT', owner_token: null, lease_until: null, not_before: null });
      return { rows: [] };
    }
    if (sql.startsWith('SELECT d.project_id')) {
      const row = [...state.dispatch.values()].find(row => ['pending', 'running', 'unknown'].includes(row.status) && row.attempts < 3
        && row.not_before !== null && row.not_before <= Date.now() && (row.lease_until === null || Date.parse(row.lease_until) <= Date.now()));
      return { rows: row ? [{ ...row, ...state.attempts.get(scopeKey(row.project_id, row.actor_id, row.idempotency_key)) }] : [] };
    }
    if (sql.startsWith("UPDATE pf_initial_fill_dispatch SET status='running'")) {
      const row = state.dispatch.get(scopeKey(args[0], args[1], args[2]))!; Object.assign(row, { status: 'running', attempts: row.attempts + 1, owner_token: args[3], lease_until: args[4] }); return { rows: [] };
    }
    if (sql.startsWith('SELECT d.status,d.owner_token')) {
      const key = scopeKey(args[0], args[1], args[2]), row = state.dispatch.get(key), attempt = state.attempts.get(key);
      return { rows: row && attempt ? [{ ...row, request_sha256: attempt.request_sha256 }] : [] };
    }
    if (sql.startsWith('UPDATE pf_initial_fill_dispatch SET status=$4')) {
      const row = state.dispatch.get(scopeKey(args[0], args[1], args[2]));
      if (row && row.owner_token === args[6]) Object.assign(row, { status: args[3], receipt_id: args[4], reason_code: args[5], owner_token: null, lease_until: null,
        not_before: args[3] === 'unknown' && row.attempts < 3 ? Date.now() + 5000 : null }); return { rows: [] };
    }
    throw Error('Unexpected synthetic attempt SQL: ' + sql.slice(0, 120));
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient, pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  const repository = createInitialFillAttempts(pool);
  const prepare = async () => { await repository.discover(); const claim = await repository.claim(); if (!claim) throw Error('Synthetic attempt must be claimable.'); return claim; };
  const row = (claim: InitialFillClaim) => state.dispatch.get(scopeKey(claim.projectId, claim.actorId, claim.idempotencyKey))!;
  return { candidate, state, query, client, pool, repository, prepare, row };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe('immutable deterministic initial-fill attempt discovery with synthetic SQL', () => {
  it('discovers a bounded exact v7 completed-cable scope and retains one immutable request/hash', async () => {
    const f = fixture(); expect(await f.repository.discover()).toBe(1); const row = [...f.state.attempts.values()][0];
    expect(row.request).toEqual({ schemaVersion: 'wfc.pf.initial-fill-request.v1', idempotencyKey: initialFillIdempotencyKey({ projectId: f.candidate.project_id,
      cableId: f.candidate.cable_id, proposalId: f.candidate.proposal_id, proposalHash: f.candidate.proposal_hash, mandateId: f.candidate.mandate_id,
      expectedCableWriteRevision: f.candidate.revision }), proposalId: f.candidate.proposal_id, expectedProposalHash: f.candidate.proposal_hash,
      mandateId: f.candidate.mandate_id, expectedCableWriteRevision: f.candidate.revision });
    expect(row.request_sha256).toBe(hash(initialFillRequestHashInput(row.request))); expect(f.state.dispatch.size).toBe(1);
    const sql = f.query.mock.calls.find(([sql]) => sql.startsWith('/* initial-fill:discover */'))![0];
    expect(sql).toContain('LIMIT 10 FOR SHARE OF m,p,i,j'); expect(sql).toContain("i.state='complete' AND i.status='calculated'");
    expect(sql).toContain("p.dependencies->>'schemaVersion'='pathfinder.dependencies.v7'"); expect(sql).toContain("j.state IN('queued','running','complete') AND NOT j.cancel_requested");
    expect(sql).toContain('FROM pf_initial_fill_mandates'); expect(sql).not.toMatch(/pf_calculation_grants|pf_recalculation_grants/);
  });
  it('does not replace the saved body or enqueue twice after an exact concurrent/replayed discovery', async () => {
    const f = fixture(); await f.repository.discover(); const before = structuredClone([...f.state.attempts.values()]);
    await f.repository.discover(); expect([...f.state.attempts.values()]).toEqual(before); expect(f.state.attempts.size).toBe(1); expect(f.state.dispatch.size).toBe(1);
    const mutations = f.query.mock.calls.map(([sql]) => sql).join('\n'); expect(mutations).toContain('ON CONFLICT DO NOTHING');
    expect(mutations).not.toMatch(/UPDATE pf_initial_fill_attempts|UPDATE cables|INSERT INTO pf_reviews|INSERT INTO pf_apply_receipts/);
  });
  it.each(['request_sha256', 'mandate_id', 'proposal_id', 'cable_id'] as const)('refuses conflicting retained %s without replacing immutable input', async field => {
    const f = fixture(); await f.repository.discover(); const row = [...f.state.attempts.values()][0]; row[field] = field === 'request_sha256' ? 'f'.repeat(64) : id(999);
    await expect(f.repository.discover()).rejects.toMatchObject({ code: 'INITIAL_FILL_ATTEMPT_CONFLICT' });
    expect([...f.state.attempts.values()][0][field]).toBe(row[field]); expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('creates distinct keys when a later proposal changes, leaving the first immutable request intact', async () => {
    const f = fixture(); await f.repository.discover(); const original = structuredClone([...f.state.attempts.values()][0]);
    f.state.candidates = [{ ...f.candidate, proposal_id: id(99), proposal_hash: 'b'.repeat(64) }]; await f.repository.discover();
    const rows = [...f.state.attempts.values()]; expect(rows).toHaveLength(2); expect(rows[0]).toEqual(original); expect(rows[1].idempotency_key).not.toBe(original.idempotency_key);
  });
  it('returns no work for no mandate-owned completed proposals and performs no cable authorization', async () => {
    const f = fixture(); f.state.candidates = []; expect(await f.repository.discover()).toBe(0); expect(f.state.attempts.size).toBe(0);
    expect(f.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/FROM users|viewer_login_bindings|UPDATE cables|pf_reviews/);
  });
});

describe('bounded initial-fill claim/fence/recovery protocol with synthetic SQL', () => {
  it('claims one exact request with a unique sixty-second lease and locked skip-locked admission', async () => {
    const f = fixture(), claim = await f.prepare(); expect(claim).toMatchObject({ projectId: f.candidate.project_id, actorId: f.candidate.actor_id,
      leaseExpiresAt: new Date(now + 60000).toISOString() }); expect(claim.request.idempotencyKey).toBe(claim.idempotencyKey);
    expect(f.row(claim)).toMatchObject({ status: 'running', attempts: 1, owner_token: claim.ownerToken }); expect(await f.repository.claim()).toBeNull();
    const sql = f.query.mock.calls.find(([sql]) => sql.startsWith('SELECT d.project_id'))![0];
    expect(sql).toContain('d.attempts<3'); expect(sql).toContain('LIMIT 1 FOR UPDATE OF d SKIP LOCKED');
  });
  it.each(['body-hash', 'request-key', 'extra-field'] as const)('refuses corrupted %s before changing dispatch ownership', async kind => {
    const f = fixture(); await f.repository.discover(); const attempt = [...f.state.attempts.values()][0];
    if (kind === 'body-hash') attempt.request_sha256 = 'f'.repeat(64); if (kind === 'request-key') attempt.request.idempotencyKey = id(999);
    if (kind === 'extra-field') attempt.request.replacement = true;
    await expect(f.repository.claim()).rejects.toBeDefined(); expect([...f.state.dispatch.values()][0]).toMatchObject({ status: 'pending', attempts: 0, owner_token: null });
  });
  it('recovers an expired crashed claim under a new owner using the identical original body/key', async () => {
    const f = fixture(), first = await f.prepare(); vi.setSystemTime(now + 60000); const recovered = await f.repository.claim();
    expect(recovered!.request).toEqual(first.request); expect(recovered!.idempotencyKey).toBe(first.idempotencyKey); expect(recovered!.ownerToken).not.toBe(first.ownerToken);
    await expect(f.repository.fence(f.client, first)).rejects.toMatchObject({ code: 'INITIAL_FILL_CLAIM_FENCED' });
    await expect(f.repository.fence(f.client, recovered!)).resolves.toBeUndefined();
  });
  it.each(['missing', 'status', 'owner', 'lease', 'expired', 'hash', 'foreign-actor', 'foreign-project'] as const)('requires exact live %s ownership at each write fence', async kind => {
    const f = fixture(), claim = await f.prepare(), dispatch = f.row(claim); if (kind === 'missing') f.state.dispatch.clear(); if (kind === 'status') dispatch.status = 'unknown';
    if (kind === 'owner') dispatch.owner_token = id(999); if (kind === 'lease') dispatch.lease_until = new Date(now + 60001).toISOString();
    if (kind === 'expired') vi.setSystemTime(now + 60000); if (kind === 'hash') [...f.state.attempts.values()][0].request_sha256 = 'f'.repeat(64);
    if (kind === 'foreign-actor') claim.actorId = id(999); if (kind === 'foreign-project') claim.projectId = id(999);
    await expect(f.repository.fence(f.client, claim)).rejects.toMatchObject({ code: 'INITIAL_FILL_CLAIM_FENCED' });
  });
  it('unknown outcome retries only the identical key/body after five seconds and stops after attempt3', async () => {
    const f = fixture(); let claim = await f.prepare(); const original = structuredClone(claim.request);
    for (let at = 1; at <= 3; at++) {
      expect(claim.request).toEqual(original); await f.repository.finish(claim, { status: 'unknown', receiptId: null, code: 'INITIAL_FILL_COMMIT_OUTCOME_UNKNOWN' });
      expect(await f.repository.claim()).toBeNull(); vi.setSystemTime(Date.now() + 5000);
      const next = await f.repository.claim(); if (at < 3) { expect(next).not.toBeNull(); claim = next!; } else expect(next).toBeNull();
    }
    expect(f.row(claim)).toMatchObject({ status: 'unknown', attempts: 3, not_before: null, owner_token: null }); expect(f.state.attempts.size).toBe(1);
  });
  it('quarantines a crashed final claim as terminal unknown without creating a replacement attempt', async () => {
    const f = fixture(), claim = await f.prepare(), row = f.row(claim); row.attempts = 3; vi.setSystemTime(now + 60000);
    expect(await f.repository.claim()).toBeNull(); expect(row).toMatchObject({ status: 'unknown', reason_code: 'INITIAL_FILL_RECOVERY_LIMIT', owner_token: null, not_before: null });
    expect(f.state.attempts.size).toBe(1); expect(f.query.mock.calls.find(([sql]) => sql.startsWith('WITH exhausted'))?.[0]).toContain('LIMIT 10 FOR UPDATE SKIP LOCKED');
  });
  it.each(['written', 'already-written', 'review-required', 'stale', 'authority-expired', 'refused'])(
    'terminal outcome %s never schedules a blind retry', async status => {
      const f = fixture(), claim = await f.prepare(); await f.repository.finish(claim, { status, receiptId: status.includes('written') ? id(70) : null });
      expect(f.row(claim)).toMatchObject({ status, owner_token: null, lease_until: null, not_before: null });
      vi.setSystemTime(now + 86400000); expect(await f.repository.claim()).toBeNull();
    });
  it('a stale completion cannot overwrite a newly owned claim or a committed terminal result', async () => {
    const f = fixture(), old = await f.prepare(); vi.setSystemTime(now + 60000); const current = (await f.repository.claim())!;
    await f.repository.finish(old, { status: 'refused', receiptId: null }); expect(f.row(current)).toMatchObject({ status: 'running', owner_token: current.ownerToken });
    await f.repository.finish(current, { status: 'written', receiptId: id(70) });
    await f.repository.finish(old, { status: 'unknown', receiptId: null }); expect(f.row(current)).toMatchObject({ status: 'written', receipt_id: id(70), not_before: null });
  });
  it('refuses unknown outcome names without updating any dispatch row', async () => {
    const f = fixture(), claim = await f.prepare(); await expect(f.repository.finish(claim, { status: 'accepted-by-engine', receiptId: null })).rejects.toMatchObject({ code: 'INITIAL_FILL_OUTCOME_INVALID' });
    expect(f.row(claim).status).toBe('running');
  });
  it('aborted discovery/claim cannot acquire a scheduler connection or manufacture a new attempt', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort(new Error('Stopped.'));
    await expect(f.repository.discover(controller.signal)).rejects.toThrow('Stopped.'); await expect(f.repository.claim(controller.signal)).rejects.toThrow('Stopped.');
    expect(f.pool.connect).not.toHaveBeenCalled(); expect(f.state.attempts.size).toBe(0);
  });
});

describe('initial-fill attempt additive schema source contract', () => {
  it('initializes only immutable attempt and bounded dispatcher bookkeeping under a scheduler lock', async () => {
    const f = fixture(); await initializeInitialFillAttemptSchema(f.pool);
    expect(f.query.mock.calls.some(([sql]) => sql === INITIAL_FILL_ATTEMPT_SQL)).toBe(true);
    expect(INITIAL_FILL_ATTEMPT_SQL).toContain('UNIQUE(project_id,mandate_id,proposal_id)'); expect(INITIAL_FILL_ATTEMPT_SQL).toContain('attempts BETWEEN 0 AND 3');
    expect(INITIAL_FILL_ATTEMPT_SQL).toContain('BEFORE UPDATE OR DELETE ON pf_initial_fill_attempts');
    expect(INITIAL_FILL_ATTEMPT_SQL).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM)\s+(?:cables|pf_reviews|pf_proposals|pf_calculation_grants)\b/);
  });
});
