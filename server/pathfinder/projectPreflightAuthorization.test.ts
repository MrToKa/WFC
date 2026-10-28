// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizePathFinderPreflight, PREFLIGHT_AUTHORIZATION_BOUNDS } from './projectPreflightAuthorization.js';
import { createModelLocationMatchRepository } from './modelLocationMatch.js';

const id = (n: number) => `bb100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const who = { userId: id(1), loginId: id(2), loginExpiresAt: Date.now() + 60000 }, projectId = id(3);
  const row = { is_admin: true, login_id: who.loginId as string | null, login_user: who.userId as string | null,
    expires_at: new Date(who.loginExpiresAt) as Date | string | null, revoked_at: null as Date | string | null, project_exists: true };
  const query = vi.fn(async (sql: string, _args?: unknown[]) => ({ rows: sql.includes('preflight-authorization') ? [row] : [] }));
  const release = vi.fn(), client = { query, release } as unknown as PoolClient, connect = vi.fn(async () => client), pool = { connect } as unknown as Pool;
  return { row, query, release, client, connect, pool, who, projectId, run: (signal?: AbortSignal) => authorizePathFinderPreflight(pool, projectId, who, signal) };
}
afterEach(() => vi.useRealTimers());

describe('read-only Path Finder HTTP preflight', () => {
  it('wires matching HTTP authorization through this read without reading preparation or taking its write mutex', async () => {
    const f = fixture(); await createModelLocationMatchRepository(f.pool).authorize(f.projectId, f.who);
    const sql = f.query.mock.calls.map(([text]) => text).join('\n');
    expect(sql).toContain('pathfinder:preflight-authorization');
    expect(sql).not.toMatch(/pf_project_preparations|\bFOR\s+(?:NO\s+KEY\s+UPDATE|UPDATE|SHARE)\b|\bINSERT\b/i);
  });
  it('checks one current snapshot without acquiring project or authority row locks', async () => {
    const f = fixture(); await f.run();
    const sql = f.query.mock.calls.map(([text]) => text);
    expect(sql[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(sql.at(-1)).toBe('ROLLBACK');
    expect(sql.join('\n')).not.toMatch(/\bFOR\s+(?:NO\s+KEY\s+UPDATE|UPDATE|SHARE|KEY\s+SHARE)\b|\b(?:INSERT|UPDATE|DELETE|COMMIT)\b|set_config/i);
    expect(f.query.mock.calls.find(([text]) => text.includes('preflight-authorization'))?.[1]).toEqual([f.projectId, f.who.userId, f.who.loginId]);
    expect(f.release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('allows a new signed principal with no login binding without registering or renewing it', async () => {
    const f = fixture(); Object.assign(f.row, { login_id: null, login_user: null, expires_at: null, revoked_at: null });
    await f.run(); expect(f.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/\bINSERT\b|\bUPDATE\b/i);
  });
  it.each(['foreign-user', 'other-login', 'revoked', 'different-expiry', 'missing-expiry'] as const)('rejects an existing %s login before disclosing project absence', async kind => {
    const f = fixture(); f.row.project_exists = false;
    if (kind === 'foreign-user') f.row.login_user = id(9);
    if (kind === 'other-login') f.row.login_id = id(9);
    if (kind === 'revoked') f.row.revoked_at = new Date();
    if (kind === 'different-expiry') f.row.expires_at = new Date(f.who.loginExpiresAt - 1);
    if (kind === 'missing-expiry') f.row.expires_at = null;
    await expect(f.run()).rejects.toMatchObject({ code: 'LOGIN_REVOKED', status: 401 });
    expect(f.release).toHaveBeenCalledOnce();
  });
  it('rejects expired signed authority before acquiring a connection', async () => {
    const f = fixture(); f.who.loginExpiresAt = Date.now() - 1;
    await expect(f.run()).rejects.toMatchObject({ code: 'LOGIN_EXPIRED' }); expect(f.connect).not.toHaveBeenCalled();
  });
  it('discloses missing project only to a current administrator', async () => {
    const f = fixture(); f.row.project_exists = false; f.row.is_admin = false;
    await expect(f.run()).rejects.toMatchObject({ code: 'ADMIN_REQUIRED', status: 403 });
    f.row.is_admin = true; await expect(f.run()).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND', status: 404 });
  });
  it('rejects a deleted administrator account', async () => {
    const f = fixture(), ordinary = f.query.getMockImplementation()!;
    f.query.mockImplementation((sql, args) => sql.includes('preflight-authorization') ? Promise.resolve({ rows: [] }) : ordinary(sql, args));
    await expect(f.run()).rejects.toMatchObject({ code: 'LOGIN_REVOKED', status: 401 });
  });
  it.each(['55P03', '57014', '40001'])('reports a retryable preflight read failure %s without inventing command outcome', async code => {
    const f = fixture(), ordinary = f.query.getMockImplementation()!;
    f.query.mockImplementation((sql, args) => sql.includes('preflight-authorization') ? Promise.reject(Object.assign(new Error('private database detail'), { code })) : ordinary(sql, args));
    await expect(f.run()).rejects.toMatchObject({ code: 'PREFLIGHT_DATABASE_BUSY', status: 503 });
    expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('discards an acquired connection when a read cannot be rolled back', async () => {
    const f = fixture(); f.query.mockRejectedValue(new Error('Broken transport'));
    await expect(f.run()).rejects.toThrow('Broken transport'); expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('does not start an access query after caller cancellation', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(f.run(controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(f.connect).not.toHaveBeenCalled();
  });
  it('bounds acquisition and discards a connection that arrives after timeout', async () => {
    vi.useFakeTimers(); const f = fixture(); let resolve!: (client: PoolClient) => void;
    f.connect.mockImplementation(() => new Promise<PoolClient>(done => { resolve = done; }));
    const outcome = f.run().then(() => null, error => error);
    await vi.advanceTimersByTimeAsync(PREFLIGHT_AUTHORIZATION_BOUNDS.acquisitionMilliseconds);
    expect(await outcome).toMatchObject({ code: 'PREFLIGHT_DATABASE_BUSY', status: 503 });
    resolve(f.client); await Promise.resolve(); expect(f.release).toHaveBeenCalledExactlyOnceWith(true); expect(f.query).not.toHaveBeenCalled();
  });
  it('bounds a hung query and discards its connection on the overall deadline', async () => {
    vi.useFakeTimers(); const f = fixture(), ordinary = f.query.getMockImplementation()!;
    f.query.mockImplementation((sql, args) => sql.includes('preflight-authorization') ? new Promise(() => undefined) : ordinary(sql, args));
    const outcome = f.run().then(() => null, error => error);
    await vi.advanceTimersByTimeAsync(PREFLIGHT_AUTHORIZATION_BOUNDS.deadlineMilliseconds);
    expect(await outcome).toMatchObject({ code: 'PREFLIGHT_DATABASE_BUSY', status: 503 }); expect(f.release).toHaveBeenCalledExactlyOnceWith(true);
  });
});
