// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { cableWorkflowReadTransaction, CABLE_WORKFLOW_SQL_BOUNDS } from './cableWorkflowRead.js';
import { CABLE_WORKFLOW_READ_LIMITS } from '../../shared/pathfinderCableWorkflowQueries.js';
import type { JobPrincipal } from './jobContracts.js';

const id = (value: number) => `ab000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const projectId = id(1), now = Date.UTC(2026, 9, 20, 18);
const principal = (): JobPrincipal => ({ userId: id(2), loginId: id(3), loginExpiresAt: now + 60_000 });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
function fixture() {
  const who = principal(), calls: Array<{ sql: string; values: unknown[] | undefined }> = [], release = vi.fn();
  const state = { exists: true, user: { is_admin: true } as { is_admin: boolean } | null,
    login: { user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: null } as { user_id: string; expires_at: Date; revoked_at: Date | null } | null };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT id FROM projects')) return { rows: state.exists ? [{ id: projectId }] : [] };
    if (sql.startsWith('SELECT is_admin FROM users')) return { rows: state.user ? [state.user] : [] };
    if (sql.startsWith('SELECT user_id,expires_at,revoked_at')) return { rows: state.login ? [state.login] : [] };
    return { rows: [] as Record<string, unknown>[] };
  });
  const client = { query, release } as unknown as PoolClient, connect = vi.fn(async () => client), pool = { connect } as unknown as Pool;
  return { who, calls, state, query, client, connect, pool, release };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe('SELECT-only cable workflow read ownership', () => {
  it('locks current project, role and exact existing login before a bounded coherent read without any DML', async () => {
    const db = fixture(), value = { marker: 'synthetic read result' };
    const operation = vi.fn(async (client: PoolClient, check: () => void) => { check(); await client.query('/* diagnostics */ SELECT id FROM cables WHERE project_id=$1', [projectId]); return value; });
    expect(await cableWorkflowReadTransaction(db.pool, projectId, db.who, operation)).toBe(value);
    expect(db.calls[0].sql).toContain('BEGIN ISOLATION LEVEL REPEATABLE READ');
    expect(db.calls[1].sql).toContain("lock_timeout='1000ms'"); expect(db.calls[1].sql).toContain("statement_timeout='3000ms'");
    expect(db.calls[2]).toEqual({ sql: 'SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', values: [projectId] });
    expect(db.calls[3]).toEqual({ sql: 'SELECT is_admin FROM users WHERE id=$1 FOR SHARE', values: [db.who.userId] });
    expect(db.calls[4]).toEqual({ sql: 'SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings WHERE login_id=$1 FOR SHARE', values: [db.who.loginId] });
    expect(db.calls.at(-1)?.sql).toBe('COMMIT'); expect(db.calls.map(call => call.sql).join('\n')).not.toMatch(/\b(?:INSERT|UPDATE\s+\w+\s+SET|DELETE|CREATE|ALTER|TRUNCATE)\b/i);
    expect(db.release).toHaveBeenCalledExactlyOnceWith(false); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['missing user', 'LOGIN_REVOKED', (db: ReturnType<typeof fixture>) => { db.state.user = null; }],
    ['nonadministrator', 'ADMIN_REQUIRED', (db: ReturnType<typeof fixture>) => { db.state.user!.is_admin = false; }],
    ['missing binding', 'LOGIN_REFRESH_REQUIRED', (db: ReturnType<typeof fixture>) => { db.state.login = null; }],
    ['foreign login owner', 'LOGIN_REVOKED', (db: ReturnType<typeof fixture>) => { db.state.login!.user_id = id(8); }],
    ['revoked binding', 'LOGIN_REVOKED', (db: ReturnType<typeof fixture>) => { db.state.login!.revoked_at = new Date(now); }],
    ['changed binding expiry', 'LOGIN_REVOKED', (db: ReturnType<typeof fixture>) => { db.state.login!.expires_at = new Date(db.who.loginExpiresAt + 1000); }],
    ['missing owned project', 'PROJECT_NOT_FOUND', (db: ReturnType<typeof fixture>) => { db.state.exists = false; }],
  ] as const)('refuses %s before any diagnostic operation', async (_label, code, mutate) => {
    const db = fixture(), operation = vi.fn(); mutate(db);
    await expect(cableWorkflowReadTransaction(db.pool, projectId, db.who, operation)).rejects.toMatchObject({ code });
    expect(operation).not.toHaveBeenCalled(); expect(db.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(db.calls.some(call => /\bINSERT\b/i.test(call.sql))).toBe(false); expect(db.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('checks current administrator authority before exposing project absence', async () => {
    const db = fixture(); db.state.exists = false; db.state.user!.is_admin = false;
    await expect(cableWorkflowReadTransaction(db.pool, projectId, db.who, vi.fn())).rejects.toMatchObject({ code: 'ADMIN_REQUIRED', status: 403 });
  });

  it.each([0, NaN, Infinity])('refuses invalid or expired authority %s without acquiring a connection', async expiry => {
    const db = fixture(); db.who.loginExpiresAt = expiry;
    await expect(cableWorkflowReadTransaction(db.pool, projectId, db.who, vi.fn())).rejects.toMatchObject({ code: 'LOGIN_EXPIRED', status: 401 });
    expect(db.connect).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses an already aborted read without acquiring or registering a login', async () => {
    const db = fixture(), controller = new AbortController(), reason = new Error('Synthetic cancelled read.'); controller.abort(reason);
    await expect(cableWorkflowReadTransaction(db.pool, projectId, db.who, vi.fn(), controller.signal)).rejects.toBe(reason);
    expect(db.connect).not.toHaveBeenCalled(); expect(db.release).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds pool acquisition and discards a late arriving connection without SQL', async () => {
    const db = fixture(), connection = deferred<PoolClient>(), operation = vi.fn(); db.connect.mockImplementation(() => connection.promise);
    const read = cableWorkflowReadTransaction(db.pool, projectId, db.who, operation), rejected = expect(read).rejects.toMatchObject({ code: 'WORKFLOW_DATABASE_BUSY', status: 503 });
    await vi.advanceTimersByTimeAsync(CABLE_WORKFLOW_SQL_BOUNDS.acquisitionMilliseconds - 1); expect(operation).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await rejected; expect(db.release).not.toHaveBeenCalled();
    connection.resolve(db.client); await vi.advanceTimersByTimeAsync(0);
    expect(db.release).toHaveBeenCalledExactlyOnceWith(true); expect(db.query).not.toHaveBeenCalled(); expect(operation).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('settles cancellation during acquisition promptly and discards the later connection', async () => {
    const db = fixture(), connection = deferred<PoolClient>(), controller = new AbortController(), reason = new Error('Acquisition was cancelled.');
    db.connect.mockImplementation(() => connection.promise);
    let settled = false; const read = cableWorkflowReadTransaction(db.pool, projectId, db.who, vi.fn(), controller.signal); void read.catch(() => { settled = true; });
    const rejected = expect(read).rejects.toBe(reason); controller.abort(reason); await vi.advanceTimersByTimeAsync(0);
    try { expect(settled).toBe(true); } finally { connection.resolve(db.client); await vi.advanceTimersByTimeAsync(0); }
    await rejected; expect(db.release).toHaveBeenCalledExactlyOnceWith(true); expect(db.query).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled operation, discards its client, and prevents its late callback from issuing SQL', async () => {
    const db = fixture(), stalled = deferred<void>(), operation = vi.fn(async (client: PoolClient) => { await stalled.promise; await client.query('SELECT late_private_read'); return 1; });
    const read = cableWorkflowReadTransaction(db.pool, projectId, db.who, operation), rejected = expect(read).rejects.toMatchObject({ code: 'WORKFLOW_DEADLINE_EXCEEDED', status: 503 });
    await vi.advanceTimersByTimeAsync(0); expect(operation).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(CABLE_WORKFLOW_READ_LIMITS.deadlineMilliseconds); await rejected;
    expect(db.release).toHaveBeenCalledExactlyOnceWith(true); expect(db.calls.some(call => call.sql === 'COMMIT')).toBe(false);
    stalled.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(db.calls.some(call => call.sql === 'SELECT late_private_read')).toBe(false); expect(db.release).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['BEGIN ISOLATION LEVEL REPEATABLE READ', 'SELECT is_admin FROM users WHERE id=$1 FOR SHARE',
    'SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings WHERE login_id=$1 FOR SHARE'])(
    'bounds a stalled authority/setup query without waiting for transport completion: %s', async heldSql => {
      const db = fixture(), original = db.query.getMockImplementation()!, held = deferred<{ rows: Record<string, unknown>[] }>(), operation = vi.fn();
      db.query.mockImplementation(async (sql, values) => { if (sql === heldSql) { db.calls.push({ sql, values }); return held.promise; } return original(sql, values); });
      const read = cableWorkflowReadTransaction(db.pool, projectId, db.who, operation), rejected = expect(read).rejects.toMatchObject({ code: 'WORKFLOW_DEADLINE_EXCEEDED' });
      await vi.advanceTimersByTimeAsync(0); expect(db.calls.at(-1)?.sql).toBe(heldSql);
      await vi.advanceTimersByTimeAsync(CABLE_WORKFLOW_READ_LIMITS.deadlineMilliseconds); await rejected;
      expect(db.release).toHaveBeenCalledExactlyOnceWith(true); const count = db.calls.length;
      held.resolve({ rows: [] }); await vi.advanceTimersByTimeAsync(0);
      expect(db.calls).toHaveLength(count); expect(operation).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });

  it('bounds stalled rollback cleanup rather than holding a timed-out read open', async () => {
    const db = fixture(), original = db.query.getMockImplementation()!, held = deferred<{ rows: Record<string, unknown>[] }>();
    db.query.mockImplementation(async (sql, values) => { if (sql === 'ROLLBACK') { db.calls.push({ sql, values }); return held.promise; } return original(sql, values); });
    const read = cableWorkflowReadTransaction(db.pool, projectId, db.who, async () => { throw new Error('Synthetic read refusal.'); });
    const rejected = expect(read).rejects.toMatchObject({ code: 'WORKFLOW_DEADLINE_EXCEEDED' });
    await vi.advanceTimersByTimeAsync(0); expect(db.calls.at(-1)?.sql).toBe('ROLLBACK');
    await vi.advanceTimersByTimeAsync(CABLE_WORKFLOW_READ_LIMITS.deadlineMilliseconds); await rejected;
    expect(db.release).toHaveBeenCalledExactlyOnceWith(true); held.resolve({ rows: [] }); await vi.advanceTimersByTimeAsync(0); expect(db.release).toHaveBeenCalledOnce();
  });

  it('does not return a result when cancellation arrives during COMMIT', async () => {
    const db = fixture(), original = db.query.getMockImplementation()!, controller = new AbortController(), reason = new Error('Cancelled at commit.');
    db.query.mockImplementation(async (sql, values) => { const result = await original(sql, values); if (sql === 'COMMIT') controller.abort(reason); return result; });
    await expect(cableWorkflowReadTransaction(db.pool, projectId, db.who, async () => 42, controller.signal)).rejects.toBe(reason);
    expect(db.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('does not return a result when login expiry passes during COMMIT', async () => {
    const db = fixture(), original = db.query.getMockImplementation()!;
    db.query.mockImplementation(async (sql, values) => { const result = await original(sql, values); if (sql === 'COMMIT') vi.setSystemTime(db.who.loginExpiresAt + 1); return result; });
    await expect(cableWorkflowReadTransaction(db.pool, projectId, db.who, async () => 42)).rejects.toMatchObject({ code: 'LOGIN_EXPIRED', status: 401 });
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('rechecks expiry after each SQL read before exposing its rows', async () => {
    const db = fixture(), original = db.query.getMockImplementation()!;
    db.query.mockImplementation(async (sql, values) => { const result = await original(sql, values); if (sql === 'SELECT secret_result') vi.setSystemTime(db.who.loginExpiresAt + 1); return result; });
    await expect(cableWorkflowReadTransaction(db.pool, projectId, db.who, async client => client.query('SELECT secret_result'))).rejects.toMatchObject({ code: 'LOGIN_EXPIRED' });
    expect(db.calls.at(-1)?.sql).toBe('ROLLBACK'); expect(db.calls.some(call => call.sql === 'COMMIT')).toBe(false);
  });

  it.each(['UPDATE cables SET routing=\'x\'', 'INSERT INTO cables VALUES(1)', 'DELETE FROM cables', 'CREATE TABLE x(id int)',
    'WITH removed AS (DELETE FROM cables RETURNING id) SELECT * FROM removed', 'SELECT 1; DELETE FROM cables',
    'SELECT 1 INTO TEMP TABLE diagnostics_mutation', "SELECT set_config('wfc.pathfinder_apply','1',true)"])(
    'refuses forbidden diagnostic SQL without dispatching it: %s', async sql => {
      const db = fixture();
      await expect(cableWorkflowReadTransaction(db.pool, projectId, db.who, async client => client.query(sql))).rejects.toMatchObject({ code: 'WORKFLOW_NON_READ_OPERATION', status: 500 });
      expect(db.calls.some(call => call.sql === sql)).toBe(false); expect(db.calls.at(-1)?.sql).toBe('ROLLBACK');
    });

  it.each(['55P03', '57014', '40001'])('maps SQL refusal %s to a safe retryable error without exposing SQL detail', async code => {
    const db = fixture(), original = db.query.getMockImplementation()!;
    db.query.mockImplementation(async (sql, values) => { if (sql === 'SELECT unavailable') throw Object.assign(new Error('private SQL credentials and business rows'), { code }); return original(sql, values); });
    const error = await cableWorkflowReadTransaction(db.pool, projectId, db.who, async client => client.query('SELECT unavailable')).catch(value => value);
    expect(error).toMatchObject({ code: 'WORKFLOW_DATABASE_BUSY', status: 503 }); expect(error.message).not.toContain('private SQL');
    expect(db.calls.at(-1)?.sql).toBe('ROLLBACK'); expect(db.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('discards an unconfirmed rollback instead of returning its connection to the pool', async () => {
    const db = fixture(), original = db.query.getMockImplementation()!, failure = new Error('Synthetic read failure.');
    db.query.mockImplementation(async (sql, values) => { if (sql === 'ROLLBACK') throw new Error('Lost rollback acknowledgement.'); return original(sql, values); });
    await expect(cableWorkflowReadTransaction(db.pool, projectId, db.who, async () => { throw failure; })).rejects.toBe(failure);
    expect(db.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each([false, true])('keeps a caught proof-byte-limit failure terminal, including further reads: %s', async tryFurtherRead => {
    const db = fixture(), original = db.query.getMockImplementation()!, payload = 'x'.repeat(CABLE_WORKFLOW_SQL_BOUNDS.readBytes / 2 + 16);
    db.query.mockImplementation(async (sql, values) => {
      if (sql === 'SELECT bounded_payload') { db.calls.push({ sql, values }); return { rows: [{ payload }] }; }
      return original(sql, values);
    });
    const read = cableWorkflowReadTransaction(db.pool, projectId, db.who, async client => {
      await client.query('SELECT bounded_payload');
      // Invalid retained proofs are intentionally caught by the read model. A
      // transport resource-limit failure must still terminate the transaction.
      await client.query('SELECT bounded_payload').catch(() => undefined);
      if (tryFurtherRead) await client.query('SELECT after_exhausted_budget').catch(() => undefined);
      return { unsafePartialPage: true };
    });
    await expect(read).rejects.toMatchObject({ code: 'WORKFLOW_READ_LIMIT', status: 413 });
    expect(db.calls.some(call => call.sql === 'SELECT after_exhausted_budget')).toBe(false);
    expect(db.calls.some(call => call.sql === 'COMMIT')).toBe(false);
    expect(db.calls.at(-1)?.sql).toBe('ROLLBACK'); expect(db.release).toHaveBeenCalledOnce();
  });

  it('bounds cumulative SQL result bytes before returning a diagnostic page', async () => {
    const db = fixture(), original = db.query.getMockImplementation()!, payload = 'x'.repeat(CABLE_WORKFLOW_SQL_BOUNDS.readBytes / 2 + 16);
    db.query.mockImplementation(async (sql, values) => sql === 'SELECT bounded_payload' ? { rows: [{ payload }] } : original(sql, values));
    await expect(cableWorkflowReadTransaction(db.pool, projectId, db.who, async client => { await client.query('SELECT bounded_payload'); await client.query('SELECT bounded_payload'); })).rejects.toMatchObject({ code: 'WORKFLOW_READ_LIMIT', status: 413 });
    expect(db.calls.at(-1)?.sql).toBe('ROLLBACK'); expect(db.release).toHaveBeenCalledExactlyOnceWith(false);
  });
});
