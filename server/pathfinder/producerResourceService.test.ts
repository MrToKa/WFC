// @vitest-environment node
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProducerResourceService } from './producerResourceService.js';
import { grantTransaction, type CalculationGrantAuthority } from './calculationAuthority.js';
import { PathFinderError } from './errors.js';
import { ViewerSessionError } from '../viewerSessions/errors.js';
import { PRODUCER_RESOURCE_LIMITS } from '../../shared/pathfinderProducerResource.js';
vi.mock('./calculationAuthority.js', async original => ({ ...(await original<typeof import('./calculationAuthority.js')>()), grantTransaction: vi.fn() }));
const id = (n: number) => `b8000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  let clock = Date.now(); const sessions = new Map<string, Record<string, any>>();
  const authority: CalculationGrantAuthority = { kind: 'calculation-grant', projectId: id(1), grantId: id(2), grantRevision: '1', grantEpoch: '1', installationEpoch: id(3), issuerId: id(4), issuerAdminRevision: '0', leaseId: id(5), ownerToken: 'a'.repeat(64), leaseExpiresAt: new Date(clock + 300000).toISOString(), operation: 'prepare', modelVersionId: id(6), selectionRevision: '2', contentFingerprint: 'b'.repeat(64) };
  const model = { id: id(6), project_id: id(1), content_fingerprint: 'b'.repeat(64), support_profile: 'svf-local-7.130.0-v1', format: 'svf', sdk_version: '7.130.0', entrypoint: 'resources/output/0/0.svf', resource_count: 1, total_bytes: 4, manifest: { resources: [{ path: 'resources/output/0/0.svf', bytes: 4, sha256: 'c'.repeat(64) }] }, storage_prefix: `projects/${id(1)}/versions/${id(6)}/`, state: 'ready', health: 'healthy' };
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SET LOCAL ')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM pf_producer_resource_sessions')) return { rows: [...sessions.values()].filter(s => s.lease_id === args[0]).map(s => ({ id: s.id })) };
    if (sql.startsWith('SELECT count')) return { rows: [{ count: String(sessions.size) }] };
    if (sql.startsWith('INSERT INTO pf_producer_resource_sessions')) { const [sessionId, project, version, load, lease, epoch, selection, fingerprint, capHash, ref, created, expires] = args; sessions.set(String(sessionId), { id: sessionId, project_id: project, model_version_id: version, load_id: load, lease_id: lease, installation_epoch: epoch, selection_revision: selection, content_fingerprint: fingerprint, capability_sha256: capHash, grant_ref: ref, created_at: created, expires_at: expires, revoked_at: null }); return { rows: [] }; }
    if (sql.includes(' AS session,row_to_json(m)')) { const row = sessions.get(String(args[0])); return { rows: row && row.project_id === args[1] && row.model_version_id === args[2] && row.capability_sha256 === args[3] ? [{ session: row, version: model }] : [] }; }
    if (sql.startsWith('SELECT id,project_id,model_version_id,load_id')) { const row = sessions.get(String(args[0])); return { rows: row && row.id === args[0] && row.project_id === args[1] && row.model_version_id === args[2] && row.capability_sha256 === args[3] ? [row] : [] }; }
    if (sql.startsWith('UPDATE pf_producer_resource_sessions')) {
      const row = sessions.get(String(args[0]));
      if (!row || row.project_id !== args[1] || row.lease_id !== args[2] || row.capability_sha256 !== args[3] || row.model_version_id !== args[4] || row.installation_epoch !== args[5]) return { rows: [] };
      row.revoked_at ??= new Date(clock); return { rows: [{ id: row.id }] };
    }
    throw new Error('Unexpected synthetic query');
  });
  const release = vi.fn(), client = { query, release } as unknown as PoolClient, connect = vi.fn(async () => client), pool = { query, connect } as unknown as Pool;
  vi.mocked(grantTransaction).mockImplementation(async (_pool, _authority, _operation, work) => work(client));
  const service = createProducerResourceService({ pool, clock: () => clock });
  return { service, pool, query, sessions, authority, model, client, release, connect, advance: (ms: number) => { clock += ms; }, create: () => service.create({ authority, loadId: id(7) }) };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());
describe('separate finite producer resource capability', () => {
  it('creates only a hash/scrubbed reference and delegates create/read to actual prepare grant fences', async () => {
    const f = fixture(), created = await f.create(), row = [...f.sessions.values()][0];
    expect(created.capability).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(row.capability_sha256).toBe(createHash('sha256').update(created.capability).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(created.capability); expect(JSON.stringify(row)).not.toContain(f.authority.ownerToken); expect(JSON.stringify(row)).not.toContain('login');
    const input = { projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability };
    expect((await f.service.authorizeResource(input)).session.loadId).toBe(id(7)); expect(await f.service.authorizePathFinder(input)).toEqual({ authorized: true, loadId: id(7) });
    expect(vi.mocked(grantTransaction).mock.calls.every(c => c[1].operation === 'prepare' && c[2] === 'prepare')).toBe(true);
    expect(f.query.mock.calls.some(([sql]) => /viewer_login_bindings|viewer_resource_sessions|INSERT INTO users/.test(sql))).toBe(false);
  });
  it('rejects copied/cross-scope capability, other operations and process-restart recovery', async () => {
    const f = fixture(), created = await f.create(), input = { projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability };
    for (const change of [{ projectId: id(8) }, { modelVersionId: id(8) }, { sessionId: id(8) }, { capability: 'z'.repeat(43) }, { capability: '' }]) await expect(f.service.authorizeResource({ ...input, ...change })).rejects.toMatchObject({ status: 401 });
    await expect(f.service.create({ authority: { ...f.authority, operation: 'calculate' }, loadId: id(7) })).rejects.toMatchObject({ status: 403 });
    await expect(createProducerResourceService({ pool: f.pool }).authorizeResource(input)).rejects.toMatchObject({ status: 401 });
  });
  it('authorizes broker pings through exact prepare grants and durable session pins without loading any model manifest', async () => {
    const f = fixture(), created = await f.create(), input = { projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability };
    Object.defineProperty(f.model, 'manifest', { get() { throw new Error('A lightweight authorization ping must not read the model manifest'); } });
    const full = vi.spyOn(f.service, 'authorizeResource'); f.query.mockClear(); vi.mocked(grantTransaction).mockClear();
    await expect(f.service.authorizePathFinder(input)).resolves.toEqual({ authorized: true, loadId: id(7) });
    expect(full).not.toHaveBeenCalled(); expect(f.query).toHaveBeenCalledOnce();
    const [sql, args] = f.query.mock.calls[0]; expect(sql).not.toMatch(/model_versions|manifest|row_to_json|to_jsonb|\*/i); expect(sql).toContain('FOR SHARE');
    expect(args).toEqual([input.sessionId, input.projectId, input.modelVersionId, createHash('sha256').update(input.capability).digest('hex')]);
    expect(grantTransaction).toHaveBeenCalledWith(f.pool, f.authority, 'prepare', expect.any(Function), undefined);
  });
  it('rejects forged or process-restarted ping capabilities before any database authorization', async () => {
    const f = fixture(), created = await f.create(), input = { projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability };
    f.query.mockClear(); vi.mocked(grantTransaction).mockClear();
    for (const change of [{ projectId: id(8) }, { modelVersionId: id(8) }, { sessionId: id(8) }, { capability: 'z'.repeat(43) }, { capability: '' }]) await expect(f.service.authorizePathFinder({ ...input, ...change })).rejects.toMatchObject({ status: 401 });
    await expect(createProducerResourceService({ pool: f.pool }).authorizePathFinder(input)).rejects.toMatchObject({ status: 401 });
    expect(f.query).not.toHaveBeenCalled(); expect(grantTransaction).not.toHaveBeenCalled();
  });
  it.each([
    ['id', id(99)], ['project_id', id(99)], ['model_version_id', id(99)], ['capability_sha256', 'f'.repeat(64)],
    ['load_id', id(99)], ['lease_id', id(99)], ['installation_epoch', id(99)], ['selection_revision', '99'],
    ['content_fingerprint', 'f'.repeat(64)], ['grant_ref', { kind: 'calculation-grant', grantEpoch: '99' }],
    ['expires_at', new Date(0)], ['revoked_at', new Date(0)],
  ] as const)('refuses a lightweight ping after durable %s is replaced', async (field, value) => {
    const f = fixture(), created = await f.create(), row = [...f.sessions.values()][0], input = { projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability };
    row[field] = value; await expect(f.service.authorizePathFinder(input)).rejects.toBeInstanceOf(ViewerSessionError);
    expect(f.query.mock.calls.some(([sql]) => /row_to_json\(m\)/.test(sql))).toBe(false);
  });
  it.each(['CALCULATION_GRANT_ISSUER_REVOKED', 'CALCULATION_GRANT_MODEL_CHANGED', 'CALCULATION_GRANT_REVOKED', 'CALCULATION_GRANT_LEASE_FENCED', 'CALCULATION_GRANT_LEASE_EXPIRED'])('keeps the current grant boundary on pings: %s', async code => {
    const f = fixture(), created = await f.create(), input = { projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability };
    vi.mocked(grantTransaction).mockRejectedValueOnce(new PathFinderError(code, 409));
    await expect(f.service.authorizePathFinder(input)).rejects.toMatchObject({ code });
  });
  it('rechecks process capability expiry and cancellation after the lightweight grant transaction', async () => {
    const f = fixture(), created = await f.create(), input = { projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability };
    vi.mocked(grantTransaction).mockImplementationOnce(async (_pool, _authority, _operation, work) => { const value = await work(f.client); f.advance(300000); return value; });
    await expect(f.service.authorizePathFinder(input)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    const other = fixture(), next = await other.create(), controller = new AbortController(), cancelled = { ...input, sessionId: next.session.sessionId, capability: next.capability };
    vi.mocked(grantTransaction).mockImplementationOnce(async (_pool, _authority, _operation, work) => { const value = await work(other.client); controller.abort(); return value; });
    await expect(other.service.authorizePathFinder(cancelled, controller.signal)).rejects.toBeDefined();
  });
  it('allows one session per lease and invalidates an expired capability while retaining bounded audit', async () => {
    const f = fixture(), created = await f.create(); await expect(f.create()).rejects.toMatchObject({ code: 'PRODUCER_SESSION_EXISTS' });
    expect(Date.parse(created.session.expiresAt) - new Date([...f.sessions.values()][0].created_at).getTime()).toBe(300000);
    f.advance(300000); await expect(f.service.authorizeResource({ projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(f.sessions.size).toBe(1);
  });
  it('never installs a capability after an unknown COMMIT and propagates current grant revocation', async () => {
    const f = fixture(); vi.mocked(grantTransaction).mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503)); await expect(f.create()).rejects.toMatchObject({ code: 'CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN' });
    const created = await f.create(); vi.mocked(grantTransaction).mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_REVOKED', 409));
    await expect(f.service.authorizeResource({ projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability })).rejects.toMatchObject({ code: 'CALCULATION_GRANT_REVOKED' });
  });
  it('rejects tampered durable load/epoch/ref identity even with the correct process capability', async () => {
    const f = fixture(), created = await f.create(), row = [...f.sessions.values()][0], input = { projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability };
    row.load_id = id(9); await expect(f.service.authorizeResource(input)).rejects.toMatchObject({ code: 'SESSION_REVOKED' }); row.load_id = id(7);
    row.installation_epoch = id(9); await expect(f.service.authorizeResource(input)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });
  it('enforces finite byte/request limits and cleanup requires the exact owned authority', async () => {
    const f = fixture(), created = await f.create(), input = { projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability };
    f.service.reserveResponse(input, PRODUCER_RESOURCE_LIMITS.responseBytes); expect(() => f.service.reserveResponse(input, 1)).toThrowError(expect.objectContaining({ status: 429 }));
    await expect(f.service.revoke({ sessionId: created.session.sessionId, authority: { ...f.authority, ownerToken: 'd'.repeat(64) } })).rejects.toMatchObject({ status: 401 });
    await f.service.revoke({ sessionId: created.session.sessionId, authority: f.authority }); await expect(f.service.authorizeResource(input)).rejects.toMatchObject({ status: 401 });
    const other = fixture(), second = await other.create(), secondInput = { ...input, sessionId: second.session.sessionId, capability: second.capability };
    for (const change of [{ projectId: id(8) }, { modelVersionId: id(8) }, { capability: 'z'.repeat(43) }]) expect(() => other.service.reserveRequest({ ...secondInput, ...change })).toThrowError(expect.objectContaining({ status: 401 }));
    // Failed processing and repeated authorization share the admitted request,
    // but only the admission itself consumes this exact finite allowance.
    for (let i = 0; i < PRODUCER_RESOURCE_LIMITS.requests; i++) other.service.reserveRequest(secondInput);
    await expect(other.service.authorizeResource(secondInput)).resolves.toHaveProperty('session.sessionId', second.session.sessionId);
    await expect(other.service.authorizePathFinder(secondInput)).resolves.toEqual({ authorized: true, loadId: id(7) });
    expect(() => other.service.reserveResponse(secondInput, 0)).not.toThrow();
    expect(() => other.service.reserveRequest(secondInput)).toThrowError(expect.objectContaining({ status: 429 })); other.service.close(); expect(() => other.service.reserveResponse(secondInput, 0)).toThrowError(expect.objectContaining({ status: 503 }));
  });
  it('revokes in memory immediately and confirms cleanup only after the bounded transaction commits', async () => {
    const f = fixture(), created = await f.create(), input = { projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability };
    let finish!: () => void; const held = new Promise<void>(resolve => { finish = resolve; }), original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, args) => { if (sql === 'COMMIT') await held; return original(sql, args); });
    let resolved = false; const revoke = f.service.revoke({ sessionId: created.session.sessionId, authority: f.authority }).then(() => { resolved = true; });
    expect(() => f.service.reserveRequest(input)).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
    await vi.waitFor(() => expect(f.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true)); expect(resolved).toBe(false);
    const settings = f.query.mock.calls.find(([sql]) => sql.startsWith('SET LOCAL '))![0];
    expect(settings).toContain("lock_timeout='3000ms'"); expect(settings).toContain("statement_timeout='15000ms'"); expect(settings).toContain("idle_in_transaction_session_timeout='30000ms'");
    finish(); await revoke; expect(resolved).toBe(true); expect(f.connect).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledWith(undefined);
  });
  it('keeps a failed cleanup inaccessible but retriable only by its same exact private owner', async () => {
    const f = fixture(), created = await f.create(), input = { projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability }, original = f.query.getMockImplementation()!;
    let refused = false;
    f.query.mockImplementation(async (sql, args) => { if (!refused && sql.startsWith('UPDATE pf_producer_resource_sessions')) { refused = true; throw Object.assign(Error('synthetic lock timeout'), { code: '55P03' }); } return original(sql, args); });
    await expect(f.service.revoke({ sessionId: created.session.sessionId, authority: f.authority })).rejects.toMatchObject({ code: '55P03' });
    await expect(f.service.authorizeResource(input)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(f.service.revoke({ sessionId: created.session.sessionId, authority: { ...f.authority, ownerToken: 'd'.repeat(64) } })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await f.service.revoke({ sessionId: created.session.sessionId, authority: f.authority });
    expect(f.connect).toHaveBeenCalledTimes(2); expect(f.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });
  it('retains the same cleanup after an unknown COMMIT and never restores its capability', async () => {
    const f = fixture(), created = await f.create(), input = { projectId: id(1), modelVersionId: id(6), sessionId: created.session.sessionId, capability: created.capability }, original = f.query.getMockImplementation()!;
    let lost = false;
    f.query.mockImplementation(async (sql, args) => { if (!lost && sql === 'COMMIT') { lost = true; throw Error('synthetic lost commit acknowledgement'); } return original(sql, args); });
    await expect(f.service.revoke({ sessionId: created.session.sessionId, authority: f.authority })).rejects.toMatchObject({ code: 'SCHEDULER_COMMIT_OUTCOME_UNKNOWN' });
    expect(f.release).toHaveBeenCalledWith(true); await expect(f.service.authorizeResource(input)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    const update = f.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE pf_producer_resource_sessions'))!;
    await f.service.revoke({ sessionId: created.session.sessionId, authority: f.authority });
    const repeated = f.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE pf_producer_resource_sessions'));
    expect(repeated).toHaveLength(2); expect(repeated[1]).toEqual(update); expect(f.connect).toHaveBeenCalledTimes(2);
  });
  it('shares concurrent cleanup and bounds database acquisition without abandoning a known mutation', async () => {
    const f = fixture(), created = await f.create(); let finish!: (client: PoolClient) => void;
    f.connect.mockImplementationOnce(() => new Promise<PoolClient>(resolve => { finish = resolve; })); vi.useFakeTimers();
    const first = f.service.revoke({ sessionId: created.session.sessionId, authority: f.authority }), second = f.service.revoke({ sessionId: created.session.sessionId, authority: f.authority });
    const denied = Promise.all([expect(first).rejects.toMatchObject({ code: 'SCHEDULER_DATABASE_BUSY' }), expect(second).rejects.toMatchObject({ code: 'SCHEDULER_DATABASE_BUSY' })]);
    await vi.advanceTimersByTimeAsync(5000); await denied; expect(f.connect).toHaveBeenCalledTimes(1);
    finish(f.client); await Promise.resolve(); await Promise.resolve(); expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls.some(([sql]) => sql === 'BEGIN')).toBe(false);
    vi.useRealTimers(); await f.service.revoke({ sessionId: created.session.sessionId, authority: f.authority }); expect(f.connect).toHaveBeenCalledTimes(2);
  });
  it('does not certify revocation for a missing or mismatched durable session', async () => {
    const f = fixture(), created = await f.create(), row = [...f.sessions.values()][0]; row.installation_epoch = id(99);
    await expect(f.service.revoke({ sessionId: created.session.sessionId, authority: f.authority })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    row.installation_epoch = f.authority.installationEpoch; await f.service.revoke({ sessionId: created.session.sessionId, authority: f.authority });
  });
});
