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
  const controls: { beforeAuthorityRead?: (read: number) => void } = {};
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT row_to_json(s)')) { reads++; controls.beforeAuthorityRead?.(reads); return { rows: [row] }; }
    if (sql.includes('SELECT u.is_admin FROM users')) return { rows: [{ is_admin: row.is_admin }] };
    return { rows: [] };
  });
  const release = vi.fn(), pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  const result = { schemaVersion: 'wfc.viewer.routing-bindings.v1' as const, modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', aggregateId: null, bindings: [] };
  vi.mocked(readViewerRoutingBindings).mockResolvedValue(result);
  return { identity, row, query, release, controls, service: createViewerSessionService({ pool, clock: () => now }), result, reads: () => reads };
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

describe('lightweight Path Finder capability authority', () => {
  it('checks live authority twice with only model state/health and retains every authority join and lock', async () => {
    const f = fixture(); f.row.is_admin = true;
    // A capability result must not construct a partial ViewerVersion or access
    // the manifest even when a SQL test double supplies an entire version row.
    Object.defineProperty(f.row.version, 'manifest', { get() { throw Error('Capability must not materialize model resources'); } });
    expect(await f.service.authorizePathFinder(f.identity)).toEqual({ authorized: true, loadId: f.row.session.load_id });
    const authority = f.query.mock.calls.map(([sql]) => sql).filter(sql => sql.startsWith('SELECT row_to_json(s)'));
    expect(authority).toHaveLength(2);
    for (const sql of authority) {
      expect(sql).toContain("json_build_object('state', v.state, 'health', v.health) AS version");
      expect(sql).not.toContain('row_to_json(v)'); expect(sql).not.toMatch(/manifest|storage_prefix|resource_count/);
      for (const join of ['JOIN viewer_login_bindings', 'JOIN users', 'JOIN projects', 'JOIN model_versions', 'JOIN project_model_selections']) expect(sql).toContain(join);
      expect(sql).toContain('s.secret_hash=$4'); expect(sql).toContain('FOR UPDATE OF s');
    }
    const admin = f.query.mock.calls.map(([sql]) => sql).filter(sql => sql.includes('SELECT u.is_admin FROM users'));
    expect(admin).toHaveLength(1); expect(admin[0]).toContain('FOR SHARE OF u');
    expect(f.query.mock.calls[0][0]).toBe('BEGIN'); expect(f.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('does not grant a capability to an engineer or assigned viewer without current is_admin', async () => {
    for (const role of ['engineer', 'basic']) {
      const f = fixture(); f.row.role = role;
      await expect(f.service.authorizePathFinder(f.identity)).rejects.toMatchObject({ code: 'ACCESS_REVOKED', status: 403 });
      expect(f.reads()).toBe(1); expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    }
  });
  const stale = [
    ['revoked login', 'SESSION_REVOKED', (f: ReturnType<typeof fixture>) => { Object.assign(f.row.login, { revoked_at: new Date() }); }],
    ['revoked session', 'SESSION_REVOKED', (f: ReturnType<typeof fixture>) => { Object.assign(f.row.session, { revoked_at: new Date() }); }],
    ['role and assignment', 'ACCESS_REVOKED', (f: ReturnType<typeof fixture>) => { f.row.is_admin = false; f.row.role = 'basic'; f.row.assigned = false; }],
    ['session expiry', 'SESSION_EXPIRED', (f: ReturnType<typeof fixture>) => { f.row.session.expires_at = new Date(0); }],
    ['absolute expiry', 'SESSION_EXPIRED', (f: ReturnType<typeof fixture>) => { f.row.session.absolute_expires_at = new Date(0); }],
    ['login expiry', 'SESSION_EXPIRED', (f: ReturnType<typeof fixture>) => { f.row.login.expires_at = new Date(0); }],
    ['selection revision', 'MODEL_SELECTION_CHANGED', (f: ReturnType<typeof fixture>) => { f.row.selection_revision = 2; }],
    ['active model', 'MODEL_SELECTION_CHANGED', (f: ReturnType<typeof fixture>) => { f.row.active_model_version_id = id(99); }],
    ['model health', 'MODEL_UNAVAILABLE', (f: ReturnType<typeof fixture>) => { f.row.version.health = 'unavailable'; }],
    ['model state', 'MODEL_UNAVAILABLE', (f: ReturnType<typeof fixture>) => { f.row.version.state = 'importing'; }],
  ] as const;
  it.each(stale)('refuses stale %s before capability work and at the final authority check', async (_name, code, mutate) => {
    for (const when of ['initial', 'final']) {
      const f = fixture(); f.row.is_admin = true;
      if (when === 'initial') mutate(f); else f.controls.beforeAuthorityRead = read => { if (read === 2) mutate(f); };
      await expect(f.service.authorizePathFinder(f.identity)).rejects.toMatchObject({ code });
      expect(f.reads()).toBe(when === 'initial' ? 1 : 2);
      expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK'); expect(f.release).toHaveBeenCalledTimes(1);
    }
  });
  it('keeps complete resource versions on the default authorization path', async () => {
    const f = fixture();
    const resource = await f.service.authorizeResource(f.identity);
    expect(resource.version).toEqual({ id: f.row.version.id, projectId: f.row.version.project_id,
      contentFingerprint: f.row.version.content_fingerprint, supportProfile: f.row.version.support_profile,
      format: f.row.version.format, sdkVersion: f.row.version.sdk_version, entrypoint: f.row.version.entrypoint,
      resourceCount: f.row.version.resource_count, totalBytes: f.row.version.total_bytes,
      manifest: f.row.version.manifest, storagePrefix: f.row.version.storage_prefix });
    const authority = f.query.mock.calls.find(([sql]) => sql.startsWith('SELECT row_to_json(s)'))![0];
    expect(authority).toContain('row_to_json(v) AS version'); expect(authority).not.toContain("json_build_object('state'");
  });
});
