// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { AUTOMATIC_PAIR_POLICY } from '../../shared/pathfinderAutomaticPair.js';
import { appendAutomaticPairMandatesInTransaction, requireCurrentAutomaticPairMandate, type AppendAutomaticPairMandatesInput } from './automaticPairMandates.js';
import { automaticPairHash } from './automaticPairReceiptProof.js';

const id = (n: number) => `ba000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const expires = Date.now() + 3600000, principal = { userId: id(3), loginId: id(4), loginExpiresAt: expires };
  const before = { id: id(2), project_id: id(1), cable_write_revision: '7', mto: 'LV', routing: null, design_length: null };
  const dependencies = { schemaVersion: 'pathfinder.dependencies.v8', projectId: id(1), cableId: id(2), cableWriteRevision: '7' };
  const input: AppendAutomaticPairMandatesInput = { projectId: id(1), jobId: id(5), principal, policy: AUTOMATIC_PAIR_POLICY,
    source: { kind: 'explicit-job' }, requestSha256: 'a'.repeat(64), items: [{ cableId: id(2), cableWriteRevision: '7', dependencyHash: automaticPairHash(dependencies) }] };
  const state = { authorityKind: 'current-login', existing: [] as any[], inserted: [] as any[], impact: null as any, command: null as any, admin: true,
    adminRevision: '2', epoch: id(6), cancelled: false, revoked: false };
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql.startsWith('INSERT INTO viewer_login_bindings')) return { rows: [] };
    if (sql.startsWith('SELECT user_id,expires_at')) return { rows: [{ user_id: principal.userId, expires_at: new Date(expires), revoked_at: state.revoked ? new Date() : null }] };
    if (sql.includes('automatic-pair:principal')) return { rows: [{ is_admin: state.admin, admin_revision: '2', installation_epoch: id(6) }] };
    if (sql.includes('current-authority')) return { rows: [{ is_admin: state.admin, admin_revision: state.adminRevision, installation_epoch: state.epoch,
      requested_by: principal.userId, login_id: principal.loginId, login_expires_at: new Date(expires), authority_kind: state.authorityKind,
      cancel_requested: state.cancelled, state: 'complete', request_hash: input.requestSha256 }] };
    if (sql.includes('FROM pf_location_impact_enrollments') || sql.includes('FROM pf_recalculation_enrollments')) return { rows: [] };
    if (sql.startsWith('SELECT authority_kind,grant_provenance')) return { rows: [{ authority_kind: 'current-login', grant_provenance: null }] };
    if (sql.includes('admitted-job')) return { rows: [{ requested_by: principal.userId, login_id: principal.loginId, login_expires_at: new Date(expires),
      authority_kind: state.authorityKind, cancel_requested: false, state: 'queued', request_hash: input.requestSha256 }] };
    if (sql.includes('original-impact')) return { rows: state.impact ? [state.impact] : [] };
    if (sql.includes('original-command')) return { rows: state.command ? [state.command] : [] };
    if (sql.includes('automatic-pair:mandate')) return { rows: state.existing };
    if (sql.includes('admitted-item')) return { rows: [{ dependencies }] };
    if (sql.includes('impact-target')) { const body = { projectId: id(1), impactId: id(7), cableId: id(2), generation: '1', cableWriteRevision: '7', eligible: true };
      const sha = automaticPairHash(body); return { rows: [{ generation: '1', record_sha256: sha, record: { ...body, contentSha256: sha } }] }; }
    if (sql.includes('cable-baseline')) return { rows: [{ value: before }] };
    if (sql.startsWith('INSERT INTO pf_automatic_pair_mandates')) { state.inserted.push(args[7]); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pf_automatic_pair_dispatch')) return { rows: [] }; throw Error(sql);
  });
  const ownership = vi.fn(async () => ({ kind: 'empty' as const }));
  const run = () => appendAutomaticPairMandatesInTransaction({ query } as unknown as PoolClient, input, undefined, { ownership });
  const impact = () => {
    const createdAt = new Date(Date.now() - 1700000).toISOString(), authorityExpiresAt = new Date(Date.now() + 10000).toISOString();
    input.source = { kind: 'location-impact', impactId: id(7), createdAt, authorityExpiresAt };
    const current = { modelVersionId: id(10), selectionRevision: '1', contentFingerprint: 'b'.repeat(64), aggregateId: id(11), artifactId: id(12),
      projectionSha256: 'c'.repeat(64), captureFrameId: id(13), geometryRevision: '1', traceId: null };
    const calculation = { preferences: { secondaryDistanceMeters: 1, preferVerticalApproach: false }, timeoutMilliseconds: 30000 };
    const command = { schemaVersion: 'wfc.pf.cable-endpoint-command.v4', idempotencyKey: id(8), initialFill: null, automaticPairPolicy: AUTOMATIC_PAIR_POLICY,
      calculation, expectedCurrent: current, expectedContextSha256: 'd'.repeat(64), expectedCableWriteRevision: '7', expectedLogicalName: 'FROM',
      expectedRegistryRevision: '1', expectedLocationId: null, expectedLocationRevision: null, expectedHeadId: null, reason: 'Save this location',
      selection: { mode: 'fixed-world', pointProjectMetres: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: null } };
    const record = { schemaVersion: 'wfc.pf.location-impact-record.v3', projectId: id(1), id: id(7), actorId: principal.userId,
      loginId: principal.loginId, loginExpiresAt: new Date(expires).toISOString(), actorAdminRevision: '2', installationEpoch: id(6),
      createdAt, authorityExpiresAt, automaticPairPolicy: AUTOMATIC_PAIR_POLICY, calculation, current, eligibleCableIds: [id(2)], commandSha256: automaticPairHash(command),
      originCableId: id(2), idempotencyKey: id(8), locationId: id(14), bindingId: id(15), bindingContentSha256: 'e'.repeat(64),
      observedRegistryRevision: '1', excludedMvCableIds: [], blockedCategoryCableIds: [] };
    const signed = { ...record, contentSha256: automaticPairHash(record) };
    state.impact = { actor_id: principal.userId, login_id: principal.loginId, idempotency_key: id(8), command_sha256: record.commandSha256, record_sha256: signed.contentSha256, record: signed };
    const owner = { schemaVersion: 'wfc.pf.cable-endpoint-command-owner.v1', command, cableId: id(2), end: 'from' };
    state.command = { request: owner, request_sha256: automaticPairHash(owner) }; return { record: signed, command };
  };
  const current = async () => { if (!state.inserted.length) await run(); const m = state.inserted[0];
    state.existing = [{ project_id: m.projectId, job_id: m.jobId, cable_id: m.cableId, id: m.id, actor_id: m.actorId,
      login_id: m.loginId, record_sha256: m.contentSha256, record: m }]; return requireCurrentAutomaticPairMandate({ query } as unknown as PoolClient, m); };
  return { input, state, before, dependencies, query, ownership, run, impact, current };
}
describe('fresh exact automatic pair mandate admission', () => {
  it('binds current human job/item, revision, baseline and finite policy outside math inputs', async () => {
    const f = fixture(); expect(await f.run()).toBe(1); const m = f.state.inserted[0];
    expect(m.baselineSha256).toBe(automaticPairHash(f.before)); expect(m.dependencyHash).toBe(automaticPairHash(f.dependencies));
    expect(Date.parse(m.authorityExpiresAt) - Date.parse(m.createdAt)).toBe(1800000); expect(m.ownership).toEqual({ kind: 'empty' });
  });
  it('does not authorize a calculation-grant job', async () => { const f = fixture(); f.state.authorityKind = 'calculation-grant';
    await expect(f.run()).rejects.toMatchObject({ code: 'AUTOMATIC_PAIR_JOB_AUTHORITY_REQUIRED' }); expect(f.state.inserted).toHaveLength(0); });
  it('retains the original Save deadline instead of starting another thirty minutes', async () => { const f = fixture(); const { record } = f.impact();
    expect(await f.run()).toBe(1); expect(f.state.inserted[0].authorityExpiresAt).toBe(record.authorityExpiresAt); });
  it('rejects caller-supplied impact authority mismatching stored bytes', async () => { const f = fixture(); f.impact();
    if (f.input.source.kind === 'location-impact') f.input.source.authorityExpiresAt = new Date(Date.now() + 600000).toISOString();
    await expect(f.run()).rejects.toMatchObject({ code: 'AUTOMATIC_PAIR_ORIGINAL_IMPACT_REQUIRED' }); });
  it('does not manufacture automatic ownership for unproven legacy data', async () => { const f = fixture(); f.ownership.mockResolvedValue({ kind: 'review-required', reasonCode: 'UNPROVEN' } as never);
    expect(await f.run()).toBe(0); expect(f.state.inserted).toHaveLength(0); });
  it('rejects a changed baseline revision before ownership discovery', async () => { const f = fixture(); f.before.cable_write_revision = '8';
    await expect(f.run()).rejects.toMatchObject({ code: 'AUTOMATIC_PAIR_BASELINE_CHANGED' }); expect(f.ownership).not.toHaveBeenCalled(); });
  it('keeps old when-both-empty commands from gaining a new mandate', async () => { const f = fixture(); const { command } = f.impact(); command.schemaVersion = 'wfc.pf.cable-endpoint-command.v3';
    await expect(f.run()).rejects.toMatchObject({ code: 'AUTOMATIC_PAIR_ORIGINAL_COMMAND_REQUIRED' }); });
  it('rejects a validly hashed owner belonging to another cable', async () => {
    const f = fixture(); f.impact(); f.state.command.request.cableId = id(99);
    f.state.command.request_sha256 = automaticPairHash(f.state.command.request);
    await expect(f.run()).rejects.toMatchObject({ code: 'AUTOMATIC_PAIR_ORIGINAL_COMMAND_REQUIRED' }); expect(f.state.inserted).toHaveLength(0);
  });
  it.each(['owner', 'impact'] as const)('rejects extra authority on the strict %s record even with a matching hash', async kind => {
    const f = fixture(); f.impact();
    if (kind === 'owner') { f.state.command.request.authority = 'renew'; f.state.command.request_sha256 = automaticPairHash(f.state.command.request); }
    else { f.state.impact.record.authority = 'renew'; const { contentSha256: _old, ...body } = f.state.impact.record;
      f.state.impact.record.contentSha256 = automaticPairHash(body); f.state.impact.record_sha256 = f.state.impact.record.contentSha256; }
    await expect(f.run()).rejects.toMatchObject({ code: kind === 'owner' ? 'AUTOMATIC_PAIR_ORIGINAL_COMMAND_REQUIRED' : 'AUTOMATIC_PAIR_ORIGINAL_IMPACT_REQUIRED' });
  });
  it('revalidates the immutable mandate against current human authority', async () => {
    const f = fixture(); await f.run(); expect(await f.current()).toEqual(f.state.inserted[0]);
  });
  it.each(['admin', 'admin revision', 'restore epoch', 'cancel', 'grant', 'login revoked'] as const)('refuses current %s drift', async kind => {
    const f = fixture(); await f.run(); if (kind === 'admin') f.state.admin = false; if (kind === 'admin revision') f.state.adminRevision = '3';
    if (kind === 'restore epoch') f.state.epoch = id(99); if (kind === 'cancel') f.state.cancelled = true;
    if (kind === 'grant') f.state.authorityKind = 'calculation-grant'; if (kind === 'login revoked') f.state.revoked = true;
    await expect(f.current()).rejects.toBeDefined();
  });
});
