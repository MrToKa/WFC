// @vitest-environment node
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialFillProgress } from './initialFillProgress.js';
import { hash } from './dependencies.js';
const mocks = vi.hoisted(() => ({ mandate: vi.fn() }));
vi.mock('./initialFillMandates.js', () => ({ readInitialFillMandateForImpact: mocks.mandate }));
const id = (n: number) => `f8100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-10-20T12:00:00.000Z');
type Row = Record<string, any>;
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());
function fixture() {
  const projectId = id(1), impactId = id(2), who = { userId: id(3), loginId: id(4), loginExpiresAt: now + 60000 }, ids = [id(5), id(6)];
  const current = { modelVersionId: id(7), selectionRevision: '1', contentFingerprint: 'a'.repeat(64), aggregateId: id(8), artifactId: id(9), projectionSha256: 'b'.repeat(64), captureFrameId: id(10), geometryRevision: '1', traceId: id(11) };
  const body = { schemaVersion: 'wfc.pf.location-impact-record.v1', id: impactId, projectId, actorId: who.userId, actorAdminRevision: '2', loginId: who.loginId,
    loginExpiresAt: new Date(who.loginExpiresAt).toISOString(), authorityExpiresAt: new Date(now + 30000).toISOString(), installationEpoch: id(12), idempotencyKey: id(13), commandSha256: 'c'.repeat(64),
    locationId: id(14), bindingId: id(15), bindingContentSha256: 'd'.repeat(64), observedRegistryRevision: '3', current,
    calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 }, eligibleCableIds: ids, excludedMvCableIds: [id(16)], blockedCategoryCableIds: [], createdAt: new Date(now).toISOString() };
  const record = { ...body, contentSha256: hash(body) };
  const impact: Row = { project_id: projectId, id: impactId, actor_id: who.userId, login_id: who.loginId, idempotency_key: body.idempotencyKey, command_sha256: body.commandSha256, record_sha256: record.contentSha256, record };
  const mandate: Row = { ...record, schemaVersion: 'wfc.pf.initial-fill-mandate.v1', id: id(20), impactId, impactContentSha256: record.contentSha256, mode: 'when-both-empty', contentSha256: 'e'.repeat(64) };
  const authority: Row = { is_admin: true, admin_revision: '2', user_id: who.userId, expires_at: body.loginExpiresAt, revoked_at: null, installation_epoch: body.installationEpoch,
    active_model_version_id: current.modelVersionId, selection_revision: '1', state: 'ready', health: 'healthy', content_fingerprint: current.contentFingerprint,
    current_aggregate_id: current.aggregateId, current_artifact_id: current.artifactId, geometry_revision: '1', capture_frame_id: current.captureFrameId, snapshot_sha256: current.projectionSha256, trace_id: current.traceId };
  const rows: Row[] = ids.map(cable_id => ({ cable_id, job_id: id(21), job_state: 'running', cancel_requested: false, item_state: 'waiting', item_status: 'waiting', proposal_status: null,
    dependency_version: null,response_version:null,calculation_mode:null, attempt_key: null, dispatch_status: null, attempts: null, not_before: null, lease_until: null, reason_code: null, verified_receipt_id: null, impact_status: 'enrolled' }));
  const state = { admin: true, revoked: false, impact: impact as Row | null, authority: authority as Row | null, rows };
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: projectId }] };
    if (sql.startsWith('SELECT is_admin FROM users')) return { rows: [{ is_admin: state.admin }] };
    if (sql.startsWith('SELECT user_id,expires_at,revoked_at')) return { rows: [{ user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: state.revoked ? new Date(now) : null }] };
    if (sql.includes('initial-fill-progress:impact')) return { rows: state.impact ? [state.impact] : [] };
    if (sql.includes('initial-fill-progress:authority')) return { rows: state.authority ? [state.authority] : [] };
    if (sql.includes('initial-fill-progress:items')) return { rows: state.rows };
    if (sql.startsWith('BEGIN') || sql.startsWith('SET LOCAL') || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    throw Error('Unexpected progress SQL: ' + sql.slice(0, 100));
  });
  const release = vi.fn(), pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool; mocks.mandate.mockResolvedValue(mandate);
  const service = createInitialFillProgress(pool), read = (cableId: string | undefined = ids[0]) => service.read(projectId, who, { impactId, ...(cableId ? { cableId } : {}) });
  return { projectId, impactId, who, ids, record, mandate, authority, state, query, pool, read };
}
describe('SELECT-only exact-impact initial-fill progress with synthetic SQL', () => {
  it('observes active calculation separately from eventual writing without DDL or authority renewal', async () => {
    const f = fixture(), result = await f.read(); expect(result).toMatchObject({ authorized: true, currentAuthority: true, outstanding: 2, counters: { 'awaiting-result': 2 }, selected: { cableId: f.ids[0], status: 'awaiting-result', receiptId: null } });
    const sql = f.query.mock.calls.map(([sql]) => sql).join('\n'); expect(sql).not.toMatch(/\b(?:INSERT|CREATE|ALTER|DELETE|TRUNCATE)\b|UPDATE\s+\w+\s+SET/i); expect(sql).toContain('LIMIT 10001'); expect(sql).toContain('octet_length(record::text)<=1048576'); expect(sql).not.toContain('result::text');
  });
  it('returns terminal not-authorized for old calculation-only impacts without reading attempts', async () => {
    const f = fixture(); mocks.mandate.mockResolvedValue(null); expect(await f.read()).toMatchObject({ mandate: null, authorized: false, currentAuthority: false, outstanding: 0, selected: { status: 'not-authorized' } }); expect(f.query.mock.calls.some(([sql]) => sql.includes('initial-fill-progress:items'))).toBe(false);
  });
  it.each(['no_path', 'settings_required', 'resource_limit', 'deadline_exceeded'])('does not keep terminal %s calculations outstanding forever', async item_status => {
    const f = fixture(); f.state.rows.forEach(row => Object.assign(row, { item_state: 'blocked', item_status, job_state: 'complete' })); expect(await f.read()).toMatchObject({ outstanding: 0, counters: { 'not-applicable': 2 } });
  });
  it('counts calculated-but-undiscovered and bounded retry-unknown separately', async () => {
    const f = fixture(); Object.assign(f.state.rows[0], { item_state: 'complete', item_status: 'calculated', proposal_status: 'calculated', dependency_version: 'pathfinder.dependencies.v8',response_version:'pathfinder.model.response.v3',calculation_mode:'calculate' });
    Object.assign(f.state.rows[1], { attempt_key: id(40), dispatch_status: 'unknown', attempts: 2, not_before: new Date(now), reason_code: 'INITIAL_FILL_INTERRUPTED' });
    expect(await f.read()).toMatchObject({ outstanding: 2, retryableUnknown: 1, counters: { unknown: 1, 'awaiting-result': 1 } });
    f.state.rows[1].attempts = 3; f.state.rows[1].not_before = null; expect(await f.read()).toMatchObject({ outstanding: 1, retryableUnknown: 0 });
  });
  it.each([
    {dependency_version:'pathfinder.dependencies.v7',response_version:'pathfinder.model.response.v1',calculation_mode:'calculate'},
    {dependency_version:'pathfinder.dependencies.v8',response_version:'pathfinder.model.response.v1',calculation_mode:'calculate'},
    {dependency_version:'pathfinder.dependencies.v8',response_version:'pathfinder.model.response.v3',calculation_mode:'design'},
  ])('does not await fresh automatic discovery for historical/incompatible result %j',async versions=>{
    const f=fixture();f.state.rows.forEach(row=>Object.assign(row,{item_state:'complete',item_status:'calculated',proposal_status:'calculated',job_state:'complete',...versions}));
    expect(await f.read()).toMatchObject({outstanding:0,counters:{'awaiting-result':0,'not-applicable':2}});
  });
  it('does not turn a written dispatch without its exact immutable receipt into Updated', async () => {
    const f = fixture(); Object.assign(f.state.rows[0], { attempt_key: id(40), dispatch_status: 'written', verified_receipt_id: null });
    expect((await f.read()).selected).toMatchObject({ status: 'unknown', reasonCode: 'INITIAL_FILL_RECEIPT_REQUIRED', receiptId: null });
    f.state.rows[0].verified_receipt_id = id(41); expect((await f.read()).selected).toMatchObject({ status: 'written', receiptId: id(41) });
  });
  it.each(['pending', 'running', 'written', 'already-written', 'review-required', 'stale', 'authority-expired', 'refused', 'unknown'] as const)('retains exact per-cable %s outcomes', async status => {
    const f = fixture(); Object.assign(f.state.rows[0], { attempt_key: id(40), dispatch_status: status, attempts: status === 'pending' ? 0 : 3, not_before: new Date(now), lease_until: new Date(now + 1000), reason_code: null, verified_receipt_id: ['written', 'already-written'].includes(status) ? id(41) : null });
    expect((await f.read()).selected?.status).toBe(status);
  });
  it('stops awaiting new results after original authority expires or model preparation changes', async () => {
    const f = fixture(); vi.setSystemTime(now + 30000); expect(await f.read()).toMatchObject({ authorized: true, currentAuthority: false, outstanding: 0 });
    vi.setSystemTime(now); f.authority.current_aggregate_id = id(99); expect(await f.read()).toMatchObject({ currentAuthority: false, outstanding: 0 });
  });
  it('does not poll a calculated-but-undiscovered item forever after its finite original authority expires', async () => {
    const f = fixture(); f.state.rows.forEach(row => Object.assign(row, { item_state: 'complete', item_status: 'calculated', proposal_status: 'calculated', dependency_version: 'pathfinder.dependencies.v8',response_version:'pathfinder.model.response.v3',calculation_mode:'calculate' }));
    vi.setSystemTime(now + 30000); expect(await f.read()).toMatchObject({ authorized: true, currentAuthority: false, outstanding: 0, counters: { 'awaiting-result': 0, 'not-applicable': 2 } });
  });
  it('projects exhausted expired running leases as terminal unknown without inventing a retry', async () => {
    const f = fixture(); Object.assign(f.state.rows[0], { attempt_key: id(40), dispatch_status: 'running', attempts: 3, not_before: new Date(now), lease_until: new Date(now - 1) });
    Object.assign(f.state.rows[1], { item_state: 'blocked', item_status: 'no_path', job_state: 'complete' });
    expect(await f.read()).toMatchObject({ outstanding: 0, retryableUnknown: 0, selected: { status: 'unknown', reasonCode: 'INITIAL_FILL_RECOVERY_LIMIT' } });
    f.state.rows[0].attempts = 2; expect(await f.read()).toMatchObject({ outstanding: 1, retryableUnknown: 1, selected: { status: 'unknown', reasonCode: 'INITIAL_FILL_LEASE_EXPIRED' } });
  });
  it.each(['hash', 'actor', 'project', 'mandate', 'rows'] as const)('refuses inconsistent immutable %s ownership instead of returning counters', async kind => {
    const f = fixture(); if (kind === 'hash') f.state.impact!.record_sha256 = '0'.repeat(64); if (kind === 'actor') f.state.impact!.actor_id = id(99); if (kind === 'project') f.state.impact!.project_id = id(99);
    if (kind === 'mandate') f.mandate.impactContentSha256 = '0'.repeat(64); if (kind === 'rows') f.state.rows.pop(); await expect(f.read()).rejects.toMatchObject({ code: 'INITIAL_FILL_PROGRESS_INTEGRITY' });
  });
  it('denies current non-admin/revoked readers and foreign impact membership without data', async () => {
    const f = fixture(); f.state.admin = false; await expect(f.read()).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' }); f.state.admin = true; f.state.revoked = true;
    await expect(f.read()).rejects.toMatchObject({ code: 'LOGIN_REVOKED' }); f.state.revoked = false; await expect(f.read(id(99))).rejects.toMatchObject({ code: 'INITIAL_FILL_CABLE_OUTSIDE_IMPACT' });
    f.state.impact = null; await expect(f.read()).rejects.toMatchObject({ code: 'INITIAL_FILL_IMPACT_NOT_FOUND' });
  });
});
