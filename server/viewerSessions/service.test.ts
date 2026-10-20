// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
vi.mock('./routingBindings.js', () => ({ readViewerRoutingBindings: vi.fn() }));
import { readViewerRoutingBindings } from './routingBindings.js';
import { createViewerSessionService } from './service.js';

const id = (value: number) => `22000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
function fixture() {
  const now = Date.parse('2026-10-20T12:00:00Z'), cookieSecret = Buffer.alloc(32, 7).toString('base64url');
  const identity = { projectId: id(1), modelVersionId: id(2), sessionId: id(3), cookieSecret };
  const row = { session: { id: id(3), user_id: id(4), login_id: id(5), project_id: id(1), model_version_id: id(2), load_id: id(6), selection_revision: 1,
    expires_at: new Date(now + 60000), absolute_expires_at: new Date(now + 300000), revoked_at: null, revoke_reason: null },
    login: { expires_at: new Date(now + 300000), revoked_at: null }, is_admin: false, role: 'basic', assigned: true,
    active_model_version_id: id(2), selection_revision: 1,
    version: { id: id(2), project_id: id(1), content_fingerprint: 'a'.repeat(64), state: 'ready', health: 'healthy', support_profile: 'svf-local-7.130.0-v1', format: 'svf', sdk_version: '7.130.0', entrypoint: 'resources/output/0/0.svf', resource_count: 1, total_bytes: 4, manifest: { resources: [] }, storage_prefix: 'private-model' } };
  let reads = 0;
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT row_to_json(s)')) { reads++; return { rows: [row] }; }
    return { rows: [] };
  });
  const release = vi.fn(), pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  const result = { schemaVersion: 'wfc.viewer.routing-bindings.v1' as const, modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', aggregateId: null, bindings: [] };
  vi.mocked(readViewerRoutingBindings).mockResolvedValue(result);
  return { identity, row, query, release, service: createViewerSessionService({ pool, clock: () => now }), result, reads: () => reads };
}
beforeEach(() => { vi.clearAllMocks(); });
describe('routing binding reads use fresh ordinary viewer authority', () => {
  it('permits an assigned basic viewer without granting administrator PF authority', async () => {
    const f = fixture(); expect(await f.service.routingBindings(f.identity)).toEqual(f.result);
    expect(readViewerRoutingBindings).toHaveBeenCalledWith(expect.anything(), { projectId: f.identity.projectId, modelVersionId: f.identity.modelVersionId, contentFingerprint: 'a'.repeat(64) });
    expect(f.reads()).toBe(2); expect(f.query.mock.calls.at(-1)?.[0]).toBe('COMMIT'); expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls.some(([sql]) => sql.includes('SELECT u.is_admin FROM users'))).toBe(false);
  });
  it('denies a revoked project assignment before reading any PF projection', async () => {
    const f = fixture(); f.row.assigned = false;
    await expect(f.service.routingBindings(f.identity)).rejects.toMatchObject({ code: 'ACCESS_REVOKED', status: 403 });
    expect(readViewerRoutingBindings).not.toHaveBeenCalled(); expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('reauthorizes after the projection and sends no result after a concurrent revoke', async () => {
    const f = fixture(); vi.mocked(readViewerRoutingBindings).mockImplementationOnce(async () => { f.row.assigned = false; return f.result; });
    await expect(f.service.routingBindings(f.identity)).rejects.toMatchObject({ code: 'ACCESS_REVOKED', status: 403 });
    expect(f.reads()).toBe(2); expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('rejects an expired session and a changed active selection using the existing resource guard', async () => {
    const expired = fixture(); expired.row.session.expires_at = new Date(0);
    await expect(expired.service.routingBindings(expired.identity)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    const changed = fixture(); changed.row.selection_revision = 2;
    await expect(changed.service.routingBindings(changed.identity)).rejects.toMatchObject({ code: 'MODEL_SELECTION_CHANGED' });
    expect(readViewerRoutingBindings).not.toHaveBeenCalled();
  });
});
