import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { runGeometryTraceControlPhase, type GeometryTraceControlInput } from './geometryTrace.integration.js';
import type { GeometryTraceRepository } from './geometryTraceRepository.js';
import { PathFinderError } from './errors.js';

const projectId = '56eadef6-8382-49f8-a652-c8f12026602e';
const modelId = '098a7e6f-6e39-4935-a98b-ba3b683875a5';
const actorId = '9ac1ea26-8bee-4719-87c5-1693df5682b4';
const email = `${actorId}@pf-r3-ui.invalid`;
const id = (n: number) => `d3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(phase: GeometryTraceControlInput['phase'] = 'auth-role') {
  const input: GeometryTraceControlInput = { schemaVersion: 'wfc.pf.geometry-trace-control-input.v1', phase, phaseIntentId: id(1), intentCreatedAt: new Date().toISOString(), projectId, modelVersionId: modelId, actorEmail: email, aggregateId: id(2), traceId: id(3), expectedProjectionSha256: 'a'.repeat(64), principal: { userId: actorId, loginId: id(4), loginExpiresAt: Date.now() + 3600000 }, expectedDatabaseUser: 'pf_local', expectedServerAddress: '192.0.2.10', command: { schemaVersion: 'wfc.pf.geometry-trace-create.v1', aggregateId: id(2), expectedProjectionSha256: 'a'.repeat(64), derivationVersion: 'wfc.pf.geometry-trace-derivation.v1', idempotencyKey: id(5) } };
  const state = { isAdmin: true, revokedAt: null as Date | null, databaseAddress: input.expectedServerAddress, actorEmail: email, failCommitOrdinal: 0, commits: 0, failRollback: false, getError: null as Error | null, changeRevocationOnGet: false };
  const calls: { sql: string; parameters: unknown[] }[] = [], releases: unknown[] = [];
  const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    calls.push({ sql, parameters });
    if (sql === 'COMMIT') { if (++state.commits === state.failCommitOrdinal) throw Error('Synthetic committed acknowledgement lost.'); return { rows: [] }; }
    if (sql === 'ROLLBACK') { if (state.failRollback) throw Error('Synthetic rollback acknowledgement lost.'); return { rows: [] }; }
    if (sql === 'BEGIN' || sql.startsWith('SET LOCAL')) return { rows: [] };
    if (sql.startsWith('SELECT current_database()')) return { rows: [{ database: 'wfc_pathfinder_local', username: 'pf_local', address: state.databaseAddress, port: 5432 }] };
    if (sql.startsWith('SELECT p.project_number')) return { rows: [{ project_number: `PF-R3-UI-${projectId}`, name: `PF-R3-UI-${projectId}`, model_id: modelId, state: 'ready', health: 'healthy', manifest: { id: input.aggregateId, projectId, modelVersionId: modelId, projection: { sha256: input.expectedProjectionSha256 }, counts: { objects: 13, physicalLeaves: 6 } } }] };
    if (sql.startsWith('SELECT email,is_admin,role')) return { rows: [{ email: state.actorEmail, is_admin: state.isAdmin, role: 'admin' }] };
    if (sql.startsWith('SELECT project_id,aggregate_id,model_version_id')) return { rows: [{ project_id: projectId, aggregate_id: input.aggregateId, model_version_id: modelId }] };
    if (sql.startsWith('SELECT jsonb_build_object')) return { rows: [{ proof: { stable: true } }] };
    if (sql.startsWith('SELECT user_id,expires_at,revoked_at')) return { rows: [{ user_id: actorId, expires_at: new Date(input.principal.loginExpiresAt), revoked_at: state.revokedAt }] };
    if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: projectId }] };
    if (sql.startsWith('UPDATE users SET is_admin=false')) { state.isAdmin = false; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('UPDATE users SET is_admin=true')) { state.isAdmin = true; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('UPDATE viewer_login_bindings SET revoked_at=$4')) { state.revokedAt = parameters[3] as Date; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('UPDATE viewer_login_bindings SET revoked_at=NULL')) { state.revokedAt = null; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('UPDATE pf_geometry_trace_sets SET manifest=manifest')) throw Object.assign(Error('Geometry trace proof is immutable'), { code: 'P0001' });
    throw Error('Unexpected synthetic control SQL: ' + sql);
  });
  const pool = { options: { max: 3, connectionTimeoutMillis: 5000, query_timeout: 5000 }, connect: vi.fn(async () => ({ query, release: (discard: unknown) => releases.push(discard) })), query } as unknown as Pool;
  const repository = { authorize: vi.fn(async () => undefined), get: vi.fn(async () => {
    if (state.getError && (!state.isAdmin || state.revokedAt)) throw state.getError;
    if (!state.isAdmin) throw new PathFinderError('ADMIN_REQUIRED', 403);
    if (state.revokedAt) { if (state.changeRevocationOnGet) state.revokedAt = new Date(Date.parse(input.intentCreatedAt) + 1); throw new PathFinderError('LOGIN_REVOKED', 401); }
    return { aggregateId: input.aggregateId, modelVersionId: modelId, projection: { sha256: input.expectedProjectionSha256 } };
  }) } as unknown as GeometryTraceRepository;
  return { input, state, calls, releases, pool, repository };
}

describe('root-only actual-control harness safety with mocked SQL/repository', () => {
  it('rejects the normal application actor before any pool or SQL operation', async () => {
    const t = fixture(); await expect(runGeometryTraceControlPhase(t.pool, t.repository, { ...t.input, principal: { ...t.input.principal, userId: id(99) } })).rejects.toThrow(); expect(t.calls).toEqual([]); expect(t.pool.connect).not.toHaveBeenCalled();
  });
  it('refuses a foreign database endpoint before inspecting or mutating fixture rows', async () => {
    const t = fixture(); t.state.databaseAddress = '192.0.2.11'; await expect(runGeometryTraceControlPhase(t.pool, t.repository, t.input)).rejects.toThrow(); expect(t.calls.some(c => c.sql.startsWith('SELECT p.project_number') || c.sql.startsWith('UPDATE'))).toBe(false); expect(t.calls.at(-1)?.sql).toBe('ROLLBACK');
  });
  it('refuses a mismatched owned actor email without any mutation', async () => {
    const t = fixture(); t.state.actorEmail = 'outside@synthetic.invalid'; await expect(runGeometryTraceControlPhase(t.pool, t.repository, t.input)).rejects.toThrow(); expect(t.calls.some(c => c.sql.startsWith('UPDATE'))).toBe(false);
  });
  it('commits a temporary exact owned role probe then restores it and returns only a bounded public receipt', async () => {
    const t = fixture(), receipt = await runGeometryTraceControlPhase(t.pool, t.repository, t.input); expect(receipt.status).toBe('PASS'); expect(t.state.isAdmin).toBe(true);
    expect(t.calls.filter(c => c.sql.startsWith('UPDATE users')).map(c => c.parameters[0])).toEqual([actorId, actorId]); expect(t.calls.some(c => /DELETE|model_versions SET|cables SET/i.test(c.sql))).toBe(false); expect(JSON.stringify(receipt)).not.toContain(email); expect(JSON.stringify(receipt)).not.toContain('password');
  });
  it('restores owned role even if the actual refusal check fails, without returning false PASS', async () => {
    const t = fixture(); t.state.getError = Error('Synthetic unexpected request failure.'); await expect(runGeometryTraceControlPhase(t.pool, t.repository, t.input)).rejects.toThrow('Synthetic unexpected'); expect(t.state.isAdmin).toBe(true); expect(t.calls.some(c => c.sql.startsWith('UPDATE users SET is_admin=true'))).toBe(true);
  });
  it('reconciles a lost temporary mutation COMMIT acknowledgement before restoring the exact owned actor', async () => {
    const t = fixture(); t.state.failCommitOrdinal = 2; await expect(runGeometryTraceControlPhase(t.pool, t.repository, t.input)).rejects.toThrow('Synthetic committed acknowledgement'); expect(t.state.isAdmin).toBe(true); expect(t.calls.filter(c => c.sql.startsWith('UPDATE users'))).toHaveLength(2);
  });
  it('restores only the exact fixture login revocation stamp', async () => {
    const t = fixture('auth-login'); expect((await runGeometryTraceControlPhase(t.pool, t.repository, t.input)).status).toBe('PASS'); expect(t.state.revokedAt).toBe(null); expect(t.calls.filter(c => c.sql.startsWith('UPDATE viewer_login_bindings')).every(c => c.parameters[0] === t.input.principal.loginId && c.parameters[1] === actorId)).toBe(true);
  });
  it('preserves an intervening login mutation rather than blindly restoring it', async () => {
    const t = fixture('auth-login'); t.state.changeRevocationOnGet = true; await expect(runGeometryTraceControlPhase(t.pool, t.repository, t.input)).rejects.toThrow(); expect(t.state.revokedAt?.getTime()).toBe(Date.parse(t.input.intentCreatedAt) + 1); expect(t.calls.some(c => c.sql.startsWith('UPDATE viewer_login_bindings SET revoked_at=NULL'))).toBe(false);
  });
  it('refuses to acknowledge an immutable-row probe when rollback is unconfirmed and discards its connection', async () => {
    const t = fixture('immutability'); t.state.failRollback = true; await expect(runGeometryTraceControlPhase(t.pool, t.repository, t.input)).rejects.toThrow('Immutable-row probe rollback is unconfirmed'); expect(t.releases).toContain(true);
  });
});
