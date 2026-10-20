// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locationImpactItemSchema, locationImpactRecordSchema } from '../../shared/pathfinderLocationImpacts.js';
import { endpointBindingHash as digest } from './endpointBindingRepository.js';
import { PathFinderError } from './errors.js';
import { cancelLocationImpactForJob, createLocationImpactRepository, readLocationImpactJobAuthority,
  requireLocationImpactAuthority, type LocationImpactAdmission, type LocationImpactAdmissionInput } from './locationImpactRepository.js';

// Synthetic SQL protocol, including the genuine principal/scheduler transactions.
// This suite is not evidence of PostgreSQL locks, engine work or real model parity.
const id = (n: number) => `af300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-10-20T12:00:00.000Z');
const sealed = <T extends { contentSha256: string }>(value: T): T => {
  const { contentSha256: _hash, ...body } = value;
  return { ...value, contentSha256: digest(body) };
};
function fixture() {
  const current = { modelVersionId: id(10), selectionRevision: '3', contentFingerprint: 'a'.repeat(64), aggregateId: id(11),
    artifactId: id(12), projectionSha256: 'b'.repeat(64), captureFrameId: id(13), geometryRevision: '2', traceId: id(14) };
  const record = sealed(locationImpactRecordSchema.parse({ schemaVersion: 'wfc.pf.location-impact-record.v1', id: id(1), projectId: id(2),
    actorId: id(3), actorAdminRevision: '8', loginId: id(4), loginExpiresAt: new Date(now + 3600000).toISOString(),
    authorityExpiresAt: new Date(now + 1800000).toISOString(), installationEpoch: id(5), idempotencyKey: id(6),
    commandSha256: 'c'.repeat(64), locationId: id(7), bindingId: id(8), bindingContentSha256: 'd'.repeat(64), observedRegistryRevision: '99',
    current, calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 },
    eligibleCableIds: [id(20), id(21)], excludedMvCableIds: [id(22)], blockedCategoryCableIds: [], createdAt: new Date(now).toISOString(), contentSha256: '0'.repeat(64) }));
  const items = record.eligibleCableIds.map(cableId => sealed(locationImpactItemSchema.parse({ schemaVersion: 'wfc.pf.location-impact-item.v1',
    projectId: record.projectId, impactId: record.id, cableId, generation: '1', cableWriteRevision: '7', fromLogicalKey: 'FROM', toLogicalKey: 'TO',
    category: 'LV', eligible: true, contentSha256: '0'.repeat(64) })));
  const state = { linked: true, recordPresent: true, record, user: { is_admin: true, revision: record.actorAdminRevision } as Record<string, unknown> | null,
    login: { user_id: record.actorId, expires_at: record.loginExpiresAt, revoked_at: null } as Record<string, unknown> | null,
    epoch: record.installationEpoch as string | null, current: { active_model_version_id: current.modelVersionId, selection_revision: current.selectionRevision,
      state: 'ready', health: 'healthy', content_fingerprint: current.contentFingerprint, current_aggregate_id: current.aggregateId,
      current_artifact_id: current.artifactId, geometry_revision: current.geometryRevision, capture_frame_id: current.captureFrameId,
      snapshot_sha256: current.projectionSha256, trace_id: current.traceId } as Record<string, unknown> | null,
    job: { requested_by: record.actorId, login_id: record.loginId, login_expires_at: record.loginExpiresAt, authority_kind: 'current-login', state: 'running', cancel_requested: false } as Record<string, unknown> | null,
    currentTargets: new Set(record.eligibleCableIds), jobMembers: new Set(record.eligibleCableIds), liveCategories: new Map(record.eligibleCableIds.map(cableId => [cableId, 'LV' as string | null])), items,
    rawItemHash: null as string | null, rawRecordHash: null as string | null, itemPayloadNull: false, existingEnrollment: false,
    dispatch: { status: 'collecting', owner_token: id(40) as string | null, lease_until: new Date(now + 60000).toISOString() as string | null, attempts: 1, due: true, reasons: [] as string[] },
    enrollmentWrites: [] as unknown[][], dispatchWrites: [] as unknown[][] };
  const jobId = id(30), principal = { userId: record.actorId, loginId: record.loginId, loginExpiresAt: Date.parse(record.loginExpiresAt) };
  const query = vi.fn(async (sql: string, args: any[] = []): Promise<{ rows: any[] }> => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SET LOCAL') || sql.startsWith('INSERT INTO viewer_login_bindings')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: record.projectId }] };
    if (sql.startsWith('SELECT is_admin')) return { rows: state.user ? [state.user] : [] };
    if (sql.startsWith('SELECT user_id,expires_at')) return { rows: state.login ? [state.login] : [] };
    if (sql.startsWith('SELECT installation_epoch')) return { rows: state.epoch ? [{ installation_epoch: state.epoch }] : [] };
    if (sql.startsWith('/* location-impact:scope */')) return { rows: state.current ? [state.current] : [] };
    if (sql.startsWith('SELECT impact_id FROM pf_location_impact_enrollments')) return { rows: state.linked ? [{ impact_id: record.id }] : [] };
    if (sql.startsWith('SELECT i.project_id')) return { rows: state.recordPresent ? [{ project_id: record.projectId, id: record.id, actor_id: record.actorId,
      login_id: record.loginId, idempotency_key: record.idempotencyKey, command_sha256: record.commandSha256,
      record_sha256: state.rawRecordHash ?? state.record.contentSha256, record: state.record }] : [] };
    if (sql.startsWith('SELECT requested_by')) return { rows: state.job ? [state.job] : [] };
    if (sql.startsWith('SELECT i.cable_id,i.generation')) {
      const item = state.items.find(item => state.currentTargets.has(item.cableId) && state.jobMembers.has(item.cableId)
        && ['LV', 'Control', 'Instrumentation'].includes(state.liveCategories.get(item.cableId) ?? '') && (args[3] === null || item.cableId === args[3]));
      return { rows: item ? [{ cable_id: item.cableId, generation: item.generation, record_sha256: state.rawItemHash ?? item.contentSha256,
        record: state.itemPayloadNull ? null : item }] : [] };
    }
    if (sql.startsWith('SELECT d.project_id')) return { rows: state.dispatch.due && ['pending', 'collecting'].includes(state.dispatch.status)
      && (state.dispatch.lease_until === null || Date.parse(state.dispatch.lease_until) <= Date.now()) ? [{ project_id: record.projectId, impact_id: record.id,
        attempts: state.dispatch.attempts, actor_id: record.actorId, login_id: record.loginId, login_expires_at: record.loginExpiresAt }] : [] };
    if (sql.startsWith('SELECT job_id FROM pf_location_impact_enrollments')) return { rows: state.existingEnrollment ? [{ job_id: jobId }] : [] };
    if (sql.startsWith('SELECT i.cable_id FROM pf_location_impact_items')) return { rows: [...state.currentTargets].sort().map(cable_id => ({ cable_id })) };
    if (sql.startsWith('SELECT status,owner_token')) return { rows: [state.dispatch] };
    if (sql.startsWith('INSERT INTO pf_location_impact_enrollments')) { state.enrollmentWrites.push(args); return { rows: [] }; }
    if (sql.startsWith('UPDATE pf_location_impact_dispatch d')) {
      if (!state.linked || args[0] !== record.projectId || args[1] !== jobId) return { rows: [] };
      state.dispatch.status = 'cancelled'; state.dispatch.owner_token = null; state.dispatch.lease_until = null; state.dispatch.due = false;
      return { rows: [{ impact_id: record.id }] };
    }
    if (sql.startsWith('UPDATE pf_location_impact_dispatch')) {
      state.dispatchWrites.push(args);
      if (sql.includes("status='collecting',attempts=attempts+1")) {
        state.dispatch.status = 'collecting'; state.dispatch.attempts++; state.dispatch.owner_token = args[2]; state.dispatch.lease_until = new Date(args[3]).toISOString();
      } else if (sql.includes('status=CASE WHEN $5')) {
        if (state.dispatch.owner_token === args[5]) { state.dispatch.status = args[4] && state.dispatch.attempts < 3 ? 'pending' : args[3]; state.dispatch.reasons = JSON.parse(args[2]); state.dispatch.due = state.dispatch.status === 'pending'; state.dispatch.owner_token = null; state.dispatch.lease_until = null; }
      } else if (sql.includes("status='failed'")) { state.dispatch.status = 'failed'; state.dispatch.due = false; state.dispatch.owner_token = null; state.dispatch.lease_until = null; }
      else { state.dispatch.status = sql.includes("status='superseded'") ? 'superseded' : args[2]; state.dispatch.due = false; state.dispatch.owner_token = null; state.dispatch.lease_until = null; }
      return { rows: [] };
    }
    throw Error('Unhandled synthetic SQL: ' + sql.slice(0, 130));
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient, pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  const admit = vi.fn(async (_client: PoolClient, input: LocationImpactAdmissionInput): Promise<LocationImpactAdmission> => {
    await input.beforeInsert(); return { jobId, inputSha256: 'e'.repeat(64), admissionId: id(31), total: input.cableIds.length, readyCables: input.cableIds.length, blockedCables: 0 };
  });
  const repo = createLocationImpactRepository(pool, { admitInTransaction: admit });
  const claim = { projectId: record.projectId, impactId: record.id, ownerToken: id(40), leaseExpiresAt: new Date(now + 60000).toISOString(), principal };
  const read = (cableId?: string, lock = true) => readLocationImpactJobAuthority(client, { projectId: record.projectId, jobId, cableId, lock });
  return { state, record, items, query, client, repo, admit, claim, principal, jobId, read };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe('finite scoped location impact authority, synthetic SQL protocol only', () => {
  it('keeps a current sibling eligible after a partially overlapping save supersedes only one cable', async () => {
    const f = fixture(); f.state.currentTargets.delete(id(20));
    expect(await f.read(id(20))).toMatchObject({ scope: 'location-impact', valid: false, code: 'LOCATION_IMPACT_TARGET_SUPERSEDED' });
    expect(await f.read(id(21))).toMatchObject({ scope: 'location-impact', valid: true });
    expect(await f.read()).toMatchObject({ valid: true });
    const reads = f.query.mock.calls.filter(([sql]) => sql.startsWith('SELECT i.cable_id,i.generation'));
    expect(reads.map(([, args]) => args?.[3])).toEqual([id(20), id(21), null]);
    expect(reads.every(([sql]) => sql.includes('LIMIT 1 FOR SHARE OF i,t,j') && sql.includes('t.generation=i.generation') && sql.includes('j.job_id=$2'))).toBe(true);
  });
  it('returns null only for an unenrolled job, never a known invalid scoped authority', async () => {
    const f = fixture(); f.state.linked = false; expect(await f.read()).toBeNull(); expect(f.query).toHaveBeenCalledOnce();
    f.state.linked = true; f.state.currentTargets.clear(); expect(await f.read()).toMatchObject({ enrolled: true, valid: false });
    expect(f.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/pf_recalculation_(?:grants|dirty)|registry_revision/);
  });
  it('requires the exact job membership, not another eligible cable in the same project', async () => {
    const f = fixture(); f.state.jobMembers.delete(id(21)); expect(await f.read(id(21))).toMatchObject({ valid: false, code: 'LOCATION_IMPACT_TARGET_SUPERSEDED' });
    expect(await f.read(id(22))).toMatchObject({ valid: false, code: 'LOCATION_IMPACT_TARGET_SUPERSEDED' });
  });
  it.each(['deleted', 'MV'])('fences only the %s cable while a surviving sibling remains current', async kind => {
    const f = fixture(); if (kind === 'deleted') f.state.liveCategories.delete(id(20)); else f.state.liveCategories.set(id(20), 'MV');
    expect(await f.read(id(20))).toMatchObject({ valid: false, code: 'LOCATION_IMPACT_TARGET_SUPERSEDED' });
    expect(await f.read(id(21))).toMatchObject({ valid: true }); expect(await f.read()).toMatchObject({ valid: true });
    expect(f.query.mock.calls.find(([sql]) => sql.startsWith('SELECT i.cable_id,i.generation'))?.[0]).toContain("c.mto IN('LV','Control','Instrumentation')");
  });
  it.each(['admin-removed', 'admin-revision', 'missing-user', 'revoked-login', 'wrong-login-owner', 'changed-login-expiry', 'missing-login', 'authority-expired', 'login-expired'] as const)(
    'invalidates original finite authority: %s', async kind => {
      const f = fixture(); if (kind === 'admin-removed') f.state.user!.is_admin = false; if (kind === 'admin-revision') f.state.user!.revision = '9';
      if (kind === 'missing-user') f.state.user = null; if (kind === 'revoked-login') f.state.login!.revoked_at = new Date(now);
      if (kind === 'wrong-login-owner') f.state.login!.user_id = id(99); if (kind === 'changed-login-expiry') f.state.login!.expires_at = new Date(now + 3600001);
      if (kind === 'missing-login') f.state.login = null; if (kind === 'authority-expired') vi.setSystemTime(now + 1800000); if (kind === 'login-expired') vi.setSystemTime(now + 3600000);
      expect(await f.read(id(20))).toMatchObject({ enrolled: true, valid: false, code: 'LOCATION_IMPACT_AUTHORITY_EXPIRED' });
      expect(f.query.mock.calls.some(([sql]) => sql.startsWith('SELECT i.cable_id,i.generation'))).toBe(false);
    });
  it.each(['missing-epoch', 'new-restore-epoch'] as const)('fences %s without refreshing the saved mandate', async kind => {
    const f = fixture(); f.state.epoch = kind === 'missing-epoch' ? null : id(99);
    expect(await f.read()).toMatchObject({ valid: false, code: 'LOCATION_IMPACT_RESTORE_FENCED' });
  });
  it.each(['active_model_version_id', 'selection_revision', 'content_fingerprint', 'current_aggregate_id', 'current_artifact_id', 'geometry_revision', 'capture_frame_id', 'snapshot_sha256', 'trace_id', 'state', 'health'])(
    'requires exact current model/preparation metadata: %s', async field => {
      const f = fixture(); f.state.current![field] = 'changed'; expect(await f.read()).toMatchObject({ valid: false, code: 'LOCATION_IMPACT_MODEL_CHANGED' });
    });
  it.each(['missing', 'grant-authority', 'different-actor', 'different-login', 'different-expiry', 'cancel-requested', 'cancelled', 'failed'] as const)('rejects revoked or foreign job: %s', async kind => {
    const f = fixture(); if (kind === 'missing') f.state.job = null; if (kind === 'grant-authority') f.state.job!.authority_kind = 'project-grant';
    if (kind === 'different-actor') f.state.job!.requested_by = id(99); if (kind === 'different-login') f.state.job!.login_id = id(99);
    if (kind === 'different-expiry') f.state.job!.login_expires_at = new Date(now + 3600001); if (kind === 'cancel-requested') f.state.job!.cancel_requested = true;
    if (kind === 'cancelled' || kind === 'failed') f.state.job!.state = kind;
    expect(await f.read()).toMatchObject({ valid: false, code: 'LOCATION_IMPACT_JOB_REVOKED' });
  });
  it.each(['queued', 'running', 'complete'])('allows current scoped parent state %s without requiring whole-job completion', async value => {
    const f = fixture(); f.state.job!.state = value; expect(await f.read(id(20))).toMatchObject({ valid: true });
  });
  it.each(['missing-record', 'record-hash', 'item-hash', 'suppressed-item'] as const)('fails closed on retained integrity error: %s', async kind => {
    const f = fixture(); if (kind === 'missing-record') f.state.recordPresent = false; if (kind === 'record-hash') f.state.rawRecordHash = 'f'.repeat(64);
    if (kind === 'item-hash') f.state.rawItemHash = 'f'.repeat(64); if (kind === 'suppressed-item') f.state.itemPayloadNull = true;
    await expect(f.read(id(20))).rejects.toMatchObject({ code: kind.startsWith('item') || kind === 'suppressed-item' ? 'LOCATION_IMPACT_ITEM_INTEGRITY' : 'LOCATION_IMPACT_INTEGRITY' });
  });
  it('strict require helper defaults to locked reads and never falls back when known revoked', async () => {
    const f = fixture(); expect(await requireLocationImpactAuthority(f.client, { projectId: f.record.projectId, jobId: f.jobId, cableId: id(21) })).toBe(true);
    expect(f.query.mock.calls.find(([sql]) => sql.startsWith('SELECT requested_by'))?.[0]).toContain('FOR SHARE');
    f.state.currentTargets.clear(); await expect(requireLocationImpactAuthority(f.client, { projectId: f.record.projectId, jobId: f.jobId })).rejects.toMatchObject({ code: 'LOCATION_IMPACT_TARGET_SUPERSEDED' });
    f.state.linked = false; expect(await requireLocationImpactAuthority(f.client, { projectId: f.record.projectId, jobId: f.jobId })).toBe(false);
  });
});

describe('location impact claim, admission and bounded failure recovery with synthetic SQL', () => {
  it('claims due work with SKIP LOCKED and a fresh exact60second owner lease', async () => {
    const f = fixture(); f.state.dispatch.status = 'pending'; f.state.dispatch.lease_until = null; f.state.dispatch.owner_token = null;
    const claim = await f.repo.claimNext(); expect(claim).toMatchObject({ projectId: f.record.projectId, impactId: f.record.id, principal: f.principal,
      leaseExpiresAt: new Date(now + 60000).toISOString() }); expect(claim!.ownerToken).not.toBe(f.claim.ownerToken); expect(f.state.dispatch.attempts).toBe(2);
    expect(f.query.mock.calls.find(([sql]) => sql.startsWith('SELECT d.project_id'))?.[0]).toContain('LIMIT 1 FOR UPDATE OF d SKIP LOCKED');
  });
  it('does not reclaim an unexpired lease and stops after three admitted collection attempts', async () => {
    const f = fixture(); expect(await f.repo.claimNext()).toBeNull(); f.state.dispatch.lease_until = new Date(now).toISOString(); f.state.dispatch.attempts = 3;
    expect(await f.repo.claimNext()).toBeNull(); expect(f.state.dispatch.status).toBe('failed'); expect(f.state.dispatch.due).toBe(false);
  });
  it('admits only current eligible targets and preserves an unaffected sibling after partial supersession', async () => {
    const f = fixture(); f.state.currentTargets.delete(id(20)); expect(await f.repo.enrollClaim(f.claim)).toEqual({ status: 'enrolled', jobId: f.jobId });
    expect(f.admit.mock.calls[0][1].cableIds).toEqual([id(21)]); expect(f.admit.mock.calls[0][1]).toMatchObject({ preferences: f.record.calculation!.preferences, timeoutMilliseconds: 60000 });
    expect(f.state.enrollmentWrites[0]).toEqual([f.record.projectId, f.record.id, f.jobId, 'e'.repeat(64), id(31), 1, 1, 0]);
    expect(f.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/UPDATE cables|INSERT INTO pf_reviews|pf_recalculation_grants|pf_recalculation_dirty/);
  });
  it.each(['owner', 'lease', 'expired', 'cancelled'] as const)('refuses %s claim changes immediately before the insertion', async kind => {
    const f = fixture(); if (kind === 'owner') f.state.dispatch.owner_token = id(99); if (kind === 'lease') f.state.dispatch.lease_until = new Date(now + 60001).toISOString();
    if (kind === 'expired') vi.setSystemTime(now + 60000); if (kind === 'cancelled') { f.state.dispatch.status = 'cancelled'; f.state.dispatch.owner_token = null; }
    await expect(f.repo.enrollClaim(f.claim)).rejects.toMatchObject({ code: 'LOCATION_IMPACT_CLAIM_FENCED' }); expect(f.state.enrollmentWrites).toHaveLength(0);
  });
  it('rechecks the original administrator revision immediately before committing an admission', async () => {
    const f = fixture(); f.admit.mockImplementationOnce(async (_client, input) => { f.state.user!.revision = '9'; await input.beforeInsert(); throw Error('unreachable'); });
    await expect(f.repo.enrollClaim(f.claim)).rejects.toMatchObject({ code: 'LOCATION_IMPACT_AUTHORITY_EXPIRED' }); expect(f.state.enrollmentWrites).toHaveLength(0);
  });
  it('zero remaining targets terminally supersedes the claim and never calls the engine adapter', async () => {
    const f = fixture(); f.state.currentTargets.clear(); expect(await f.repo.enrollClaim(f.claim)).toEqual({ status: 'superseded', jobId: null });
    expect(f.admit).not.toHaveBeenCalled(); expect(f.state.enrollmentWrites).toHaveLength(0); expect(f.state.dispatch.status).toBe('superseded');
  });
  it('existing enrollment is an exact duplicate without a second callback or enrollment', async () => {
    const f = fixture(); f.state.existingEnrollment = true; expect(await f.repo.enrollClaim(f.claim)).toEqual({ status: 'duplicate', jobId: f.jobId });
    expect(f.admit).not.toHaveBeenCalled(); expect(f.state.enrollmentWrites).toHaveLength(0);
  });
  it('keeps an all-blocked newest admission and refuses a null-job adapter shortcut', async () => {
    const f = fixture(); f.admit.mockImplementationOnce(async (_client, input) => { await input.beforeInsert(); return { jobId: f.jobId, inputSha256: 'e'.repeat(64), total: 2, readyCables: 0, blockedCables: 2 }; });
    expect(await f.repo.enrollClaim(f.claim)).toEqual({ status: 'blocked', jobId: f.jobId }); expect(f.state.enrollmentWrites).toHaveLength(1);
    const invalid = fixture(); invalid.admit.mockImplementationOnce(async (_client, input) => { await input.beforeInsert(); return { jobId: null, inputSha256: 'e'.repeat(64), total: 2, readyCables: 0, blockedCables: 2 }; });
    await expect(invalid.repo.enrollClaim(invalid.claim)).rejects.toMatchObject({ code: 'LOCATION_IMPACT_ADAPTER_INVALID' }); expect(invalid.state.enrollmentWrites).toHaveLength(0);
  });
  it.each(['missing-before-insert', 'twice-before-insert', 'wrong-total'] as const)('fails closed on adapter protocol error %s', async kind => {
    const f = fixture(); f.admit.mockImplementationOnce(async (_client, input) => { if (kind !== 'missing-before-insert') await input.beforeInsert(); if (kind === 'twice-before-insert') await input.beforeInsert();
      return { jobId: f.jobId, inputSha256: 'e'.repeat(64), total: kind === 'wrong-total' ? 3 : 2, readyCables: 2, blockedCables: 0 }; });
    await expect(f.repo.enrollClaim(f.claim)).rejects.toMatchObject({ code: kind === 'twice-before-insert' ? 'LOCATION_IMPACT_CLAIM_FENCED' : 'LOCATION_IMPACT_ADAPTER_INVALID' });
    expect(f.state.enrollmentWrites).toHaveLength(0);
  });
  it.each(['no_path', 'deadline_exceeded', 'ENGINE_TIMEOUT', 'ENGINE_RESOURCE_LIMIT', 'LOCATION_IMPACT_ADMISSION_FAILED'])('never automatically retries terminal outcome %s', async code => {
    const f = fixture(); await f.repo.recordFailure(f.claim, new PathFinderError(code, 503)); expect(f.state.dispatch.status).toBe('blocked'); expect(f.state.dispatch.due).toBe(false);
    expect(await f.repo.claimNext()).toBeNull(); expect(f.admit).not.toHaveBeenCalled();
  });
  it.each(['ENDPOINT_DATABASE_BUSY', 'SCHEDULER_DATABASE_BUSY', 'RECALCULATION_COLLECTION_DEADLINE', 'LOCATION_IMPACT_COLLECTION_DEADLINE'])('retries only bounded transient %s before attempt3', async code => {
    const f = fixture(); await f.repo.recordFailure(f.claim, new PathFinderError(code, 503)); expect(f.state.dispatch.status).toBe('pending'); expect(f.state.dispatch.due).toBe(true);
    f.state.dispatch.owner_token = f.claim.ownerToken; f.state.dispatch.attempts = 3; await f.repo.recordFailure(f.claim, new PathFinderError(code, 503));
    expect(f.state.dispatch.status).toBe('blocked'); expect(f.state.dispatch.due).toBe(false);
    expect(f.query.mock.calls.find(([sql]) => sql.includes('status=CASE WHEN $5'))?.[0]).toContain("clock_timestamp()+interval '5 seconds'");
  });
  it.each(['LOCATION_IMPACT_AUTHORITY_EXPIRED', 'LOGIN_EXPIRED', 'LOGIN_REVOKED', 'ADMIN_REQUIRED', 'LOCATION_IMPACT_RESTORE_FENCED'])('terminally records %s without refreshing any authority', async code => {
    const f = fixture(); await f.repo.recordFailure(f.claim, new PathFinderError(code, 409)); expect(f.state.dispatch.status).toBe(code === 'LOCATION_IMPACT_RESTORE_FENCED' ? 'restore-fenced' : 'awaiting-authority'); expect(f.state.dispatch.due).toBe(false);
  });
  it('a late failure cannot reset a cancelled or differently owned claim', async () => {
    const f = fixture(); expect(await cancelLocationImpactForJob(f.client, { projectId: f.record.projectId, jobId: f.jobId })).toBe(true);
    await f.repo.recordFailure(f.claim, new PathFinderError('ENDPOINT_DATABASE_BUSY', 503)); expect(f.state.dispatch.status).toBe('cancelled'); expect(f.state.dispatch.due).toBe(false);
    expect(await cancelLocationImpactForJob(f.client, { projectId: f.record.projectId, jobId: id(99) })).toBe(false);
  });
});
