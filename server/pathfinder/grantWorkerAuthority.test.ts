// @vitest-environment node
import { inspect } from 'node:util';
import type { Pool, PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CALCULATION_GRANT_OPERATIONS, type CalculationGrant, type CalculationGrantProvenance } from '../../shared/pathfinderCalculationGrant.js';
import { calculationAuthorityOwnerHash, requireCalculationGrantRevision, type CalculationGrantAuthority } from './calculationAuthority.js';
import { createCalculationGrantRepository, type CalculationGrantLeaseClaim } from './calculationGrantRepository.js';
import { PathFinderError } from './errors.js';
import { acquireGrantJobExecution, GrantJobClaimOutcomeUnknownError, type GrantJobExecutionRow, type GrantJobClaimRecovery, type GrantJobExecutionOptions } from './grantWorkerAuthority.js';
import { schedulerTransaction } from './schedulerTransaction.js';

vi.mock('./calculationAuthority.js', async original => ({ ...(await original<typeof import('./calculationAuthority.js')>()), requireCalculationGrantRevision: vi.fn() }));
vi.mock('./calculationGrantRepository.js', async original => ({ ...(await original<typeof import('./calculationGrantRepository.js')>()), createCalculationGrantRepository: vi.fn() }));
vi.mock('./schedulerTransaction.js', () => ({ schedulerTransaction: vi.fn() }));
const id = (n: number) => `c8000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Item = { cable_id: string; dependencies: Record<string, any> };

function fixture() {
  const provenance: CalculationGrantProvenance = { kind: 'calculation-grant', projectId: id(1), grantId: id(2), grantRevision: '3', grantEpoch: '2', installationEpoch: id(3), issuerId: id(4), issuerAdminRevision: '5' };
  const grant: CalculationGrant = { schemaVersion: 'wfc.pf.calculation-grant.v1', id: provenance.grantId, projectId: provenance.projectId, grantRevision: provenance.grantRevision, grantEpoch: provenance.grantEpoch,
    installationEpoch: provenance.installationEpoch, enabled: true, enabledBy: provenance.issuerId, issuerAdminRevision: provenance.issuerAdminRevision,
    enabledAt: new Date().toISOString(), updatedAt: new Date().toISOString(), scope: 'active-model', operations: [...CALCULATION_GRANT_OPERATIONS], limitsProfile: 'local-bounded-v1',
    preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 };
  const job: GrantJobExecutionRow = { id: id(5), project_id: id(1), requested_by: id(4), authority_kind: 'calculation-grant', grant_provenance: provenance, kind: 'calculate', login_id: null, login_expires_at: null };
  const items: Item[] = [{ cable_id: id(7), dependencies: { schemaVersion: 'pathfinder.dependencies.v5', projectId: id(1), cableId: id(7), model: { id: id(6), selectionRevision: '4', contentFingerprint: 'b'.repeat(64) } } }];
  const humanExpiry = Date.now() + 3600000;
  const db = { project: true, live: { is_admin: true, user_id: id(4) as string | null, expires_at: new Date(humanExpiry) as Date | null, revoked_at: null as Date | null }, leases: new Map<string, Record<string, any>>() };
  const completed: Item[] = [], order: string[] = [], retained = { intent: null as GrantJobClaimRecovery | null };
  const recovery = {
    read: vi.fn(async (_key: { projectId: string; jobId: string }) => retained.intent),
    retain: vi.fn(async (intent: GrantJobClaimRecovery) => { order.push('retain'); retained.intent = structuredClone(intent); }),
    retire: vi.fn(async (_intent: GrantJobClaimRecovery) => { order.push('retire'); retained.intent = null; }),
  };
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('SELECT id FROM projects')) return { rows: db.project ? [{ id: values[0] }] : [] };
    if (sql.includes('LEFT JOIN viewer_login_bindings')) return { rows: [db.live] };
    if (sql.startsWith('SELECT cable_id,dependencies FROM pf_job_items')) return { rows: [...(sql.includes("state='complete'") ? completed : items)].sort((a, b) => a.cable_id.localeCompare(b.cable_id)).slice(0, 1) };
    if (sql.includes('pg_advisory_xact_lock')) { order.push('reconcile-lock'); return { rows: [] }; }
    if (sql.includes('FROM pf_calculation_grant_leases WHERE id=$1 FOR UPDATE')) {
      order.push('reconcile-row'); const row = db.leases.get(String(values[0])); return { rows: row ? [row] : [] };
    }
    throw new Error('Unexpected synthetic read-only authority query.');
  });
  const pool = {} as Pool, c = { query } as unknown as PoolClient;
  vi.mocked(schedulerTransaction).mockImplementation(async (_pool, work, signal) => { signal?.throwIfAborted(); const value = await work(c); signal?.throwIfAborted(); return value; });
  vi.mocked(requireCalculationGrantRevision).mockResolvedValue(grant);
  const claim = vi.fn(async (input: CalculationGrantLeaseClaim): Promise<CalculationGrantAuthority> => {
    order.push('claim');
    expect(retained.intent?.claim).toEqual(input);
    const authority: CalculationGrantAuthority = { ...input, kind: 'calculation-grant', issuerId: provenance.issuerId,
      issuerAdminRevision: provenance.issuerAdminRevision, leaseExpiresAt: new Date(Date.now() + 15 * 60000).toISOString() };
    db.leases.set(input.leaseId, { id: input.leaseId, project_id: input.projectId, grant_id: input.grantId,
      grant_revision: input.grantRevision, grant_epoch: input.grantEpoch, installation_epoch: input.installationEpoch,
      issuer_id: provenance.issuerId, issuer_admin_revision: provenance.issuerAdminRevision, operation: input.operation,
      model_version_id: input.modelVersionId, selection_revision: input.selectionRevision, content_fingerprint: input.contentFingerprint,
      owner_sha256: calculationAuthorityOwnerHash(input.ownerToken), state: 'active', expires_at: authority.leaseExpiresAt });
    return authority;
  });
  const release = vi.fn(async (authority: CalculationGrantAuthority) => { order.push('release'); db.leases.get(authority.leaseId)!.state = 'released'; });
  const quarantine = vi.fn(async (authority: CalculationGrantAuthority, _reason: string) => { order.push('quarantine'); db.leases.get(authority.leaseId)!.state = 'quarantined'; });
  vi.mocked(createCalculationGrantRepository).mockReturnValue({ claim, release, quarantine } as unknown as ReturnType<typeof createCalculationGrantRepository>);
  const human = (): GrantJobExecutionRow => ({ ...job, authority_kind: 'current-login', grant_provenance: null, login_id: id(8), login_expires_at: new Date(humanExpiry) });
  const acquire = (row: GrantJobExecutionRow, signal?: AbortSignal, options: GrantJobExecutionOptions = {}) =>
    acquireGrantJobExecution(pool, row, signal, { recovery, ...options });
  return { pool, c, job, human, db, items, completed, provenance, grant, query, claim, release, quarantine, recovery, retained, order, acquire };
}

beforeEach(() => vi.resetAllMocks());

describe('explicit human or finite grant authority for a worker quantum', () => {
  it('uses an existing real human login without creating a grant lease or binding', async () => {
    const f = fixture(), execution = await f.acquire(f.human());
    expect(execution.principal).toEqual({ userId: id(4), loginId: id(8), loginExpiresAt: f.db.live.expires_at!.getTime() });
    await execution.finish(true); await execution.finish(false);
    expect(f.claim).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(f.quarantine).not.toHaveBeenCalled();
    expect(f.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
  });
  it.each(['expired', 'invalid-time', 'invalid-login', 'missing-binding', 'revoked', 'different-user', 'different-expiry', 'demoted', 'missing-project'] as const)('refuses %s human authority without synthesizing a login', async change => {
    const f = fixture(), job = f.human();
    if (change === 'expired') job.login_expires_at = new Date(0);
    if (change === 'invalid-time') job.login_expires_at = 'not-a-timestamp';
    if (change === 'invalid-login') job.login_id = null;
    if (change === 'missing-binding') { f.db.live.user_id = null; f.db.live.expires_at = null; }
    if (change === 'revoked') f.db.live.revoked_at = new Date();
    if (change === 'different-user') f.db.live.user_id = id(9);
    if (change === 'different-expiry') f.db.live.expires_at = new Date(f.db.live.expires_at!.getTime() + 1);
    if (change === 'demoted') f.db.live.is_admin = false;
    if (change === 'missing-project') f.db.project = false;
    await expect(f.acquire(job)).rejects.toBeInstanceOf(PathFinderError);
    expect(f.claim).not.toHaveBeenCalled(); expect(f.query.mock.calls.some(([sql]) => /INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
  });
  it.each([undefined, null, 'human', 'CURRENT-LOGIN', 'prepare'])('does not infer human authority from unknown discriminator %s', async authority_kind => {
    const f = fixture(); await expect(f.acquire({ ...f.human(), authority_kind })).rejects.toMatchObject({ code: 'JOB_AUTHORITY_INVALID' });
    expect(f.query).not.toHaveBeenCalled(); expect(f.claim).not.toHaveBeenCalled();
  });
  it.each(['lookup', 'preview', undefined])('denies grant job operation %s before acquiring any lease', async kind => {
    const f = fixture(); await expect(f.acquire({ ...f.job, kind })).rejects.toMatchObject({ code: 'CALCULATION_GRANT_JOB_SCOPE_DENIED' });
    expect(f.query).not.toHaveBeenCalled(); expect(f.claim).not.toHaveBeenCalled();
  });
  it.each(['issuer', 'project', 'extra-secret', 'malformed', 'login-field', 'expiry-field'] as const)('refuses mismatched %s grant provenance without human fallback', async change => {
    const f = fixture(), job = { ...f.job };
    if (change === 'issuer') job.requested_by = id(9);
    if (change === 'project') job.project_id = id(9);
    if (change === 'extra-secret') job.grant_provenance = { ...f.provenance, ownerToken: 'a'.repeat(64) };
    if (change === 'malformed') job.grant_provenance = null;
    if (change === 'login-field') job.login_id = id(8);
    if (change === 'expiry-field') job.login_expires_at = new Date();
    await expect(f.acquire(job)).rejects.toBeInstanceOf(PathFinderError);
    expect(f.query).not.toHaveBeenCalled(); expect(f.claim).not.toHaveBeenCalled();
  });
  it('delegates only the first waiting cable exact model to a fresh calculate lease and immutable issuer principal', async () => {
    const f = fixture(); f.items.unshift({ cable_id: id(9), dependencies: { projectId: id(1), cableId: id(9), model: { id: id(10), selectionRevision: '8', contentFingerprint: 'c'.repeat(64) } } });
    const execution = await f.acquire(f.job), claim = f.claim.mock.calls[0][0];
    expect(f.query.mock.calls[0]).toEqual([expect.stringContaining("state='waiting' ORDER BY cable_id LIMIT 1"), [id(1), id(5)]]);
    expect(requireCalculationGrantRevision).toHaveBeenCalledWith(f.c, f.provenance);
    expect(claim).toEqual({ projectId: id(1), grantId: id(2), grantRevision: '3', grantEpoch: '2', installationEpoch: id(3), operation: 'calculate', modelVersionId: id(6),
      selectionRevision: '4', contentFingerprint: 'b'.repeat(64), leaseId: expect.stringMatching(/^[a-f0-9-]{36}$/), ownerToken: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(execution.principal).toMatchObject({ kind: 'calculation-grant', userId: id(4), authority: { ...claim, issuerId: id(4), issuerAdminRevision: '5' } });
    expect(execution.principal).not.toHaveProperty('loginId'); expect(execution.principal).not.toHaveProperty('loginExpiresAt');
    expect(f.query.mock.calls.some(([sql]) => sql.includes('viewer_login_bindings'))).toBe(false);
  });
  it.each(['missing', 'wrong-project', 'wrong-cable', 'invalid-model', 'extra-model-secret'] as const)('refuses %s waiting dependency before claiming work', async change => {
    const f = fixture();
    if (change === 'missing') f.items.length = 0;
    if (change === 'wrong-project') f.items[0].dependencies.projectId = id(9);
    if (change === 'wrong-cable') f.items[0].dependencies.cableId = id(9);
    if (change === 'invalid-model') f.items[0].dependencies.model.selectionRevision = '-1';
    if (change === 'extra-model-secret') f.items[0].dependencies.model.ownerToken = 'a'.repeat(64);
    await expect(f.acquire(f.job)).rejects.toMatchObject({ code: change === 'missing' ? 'CALCULATION_GRANT_WAITING_ITEM_REQUIRED' : 'CALCULATION_GRANT_JOB_MODEL_INVALID' });
    expect(f.claim).not.toHaveBeenCalled();
  });
  it('does not claim after current issuer/grant validation refuses the persisted revision', async () => {
    const f = fixture(); vi.mocked(requireCalculationGrantRevision).mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_ISSUER_REVOKED', 403));
    await expect(f.acquire(f.job)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_ISSUER_REVOKED' }); expect(f.claim).not.toHaveBeenCalled();
  });
  it.each(['CALCULATION_GRANT_LEASE_EXPIRED', 'CALCULATION_GRANT_MODEL_CHANGED', 'CALCULATION_GRANT_LEASE_BUSY'])('preserves repository %s refusal without retries or human fallback', async code => {
    const f = fixture(); f.claim.mockRejectedValueOnce(new PathFinderError(code, 409));
    await expect(f.acquire(f.job)).rejects.toMatchObject({ code }); expect(f.claim).toHaveBeenCalledOnce(); expect(f.release).not.toHaveBeenCalled(); expect(f.quarantine).not.toHaveBeenCalled();
  });
  it('creates a new private owner for each quantum instead of reusing persisted user or lease data', async () => {
    const f = fixture(), first = await f.acquire(f.job); await first.finish(true);
    const second = await f.acquire(f.job); await second.finish(true);
    expect(f.claim.mock.calls[0][0].leaseId).not.toBe(f.claim.mock.calls[1][0].leaseId); expect(f.claim.mock.calls[0][0].ownerToken).not.toBe(f.claim.mock.calls[1][0].ownerToken);
  });
  it('releases once only after a confirmed join and coalesces concurrent same-disposition cleanup', async () => {
    const f = fixture(), execution = await f.acquire(f.job);
    expect(f.release).not.toHaveBeenCalled(); await Promise.all([execution.finish(true), execution.finish(true)]); await execution.finish(true);
    expect(f.release).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledWith((execution.principal as { authority: CalculationGrantAuthority }).authority); expect(f.quarantine).not.toHaveBeenCalled();
    await expect(execution.finish(false)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_CLEANUP_CONFLICT' });
  });
  it('quarantines an unconfirmed join and cannot later release it through this execution handle', async () => {
    const f = fixture(), execution = await f.acquire(f.job); await execution.finish(false); await execution.finish(false);
    expect(f.quarantine).toHaveBeenCalledOnce(); expect(f.quarantine).toHaveBeenCalledWith((execution.principal as { authority: CalculationGrantAuthority }).authority, 'ENGINE_SESSION_REAP_FAILED');
    await expect(execution.finish(true)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_CLEANUP_CONFLICT' }); expect(f.release).not.toHaveBeenCalled();
  });
  it('retries uncertain cleanup with the same original authority and never claims a replacement', async () => {
    const f = fixture(), execution = await f.acquire(f.job); f.release.mockRejectedValueOnce(new PathFinderError('SCHEDULER_COMMIT_OUTCOME_UNKNOWN', 503));
    await expect(execution.finish(true)).rejects.toMatchObject({ code: 'SCHEDULER_COMMIT_OUTCOME_UNKNOWN' }); await execution.finish(true);
    expect(f.release).toHaveBeenCalledTimes(2); expect(f.release.mock.calls[1][0]).toBe(f.release.mock.calls[0][0]); expect(f.claim).toHaveBeenCalledOnce();
  });
  it('retains the exact unknown-claim private owner intent without exposing it to JSON or ordinary inspection', async () => {
    const f = fixture(); f.claim.mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503));
    const error = await f.acquire(f.job).catch(value => value) as GrantJobClaimOutcomeUnknownError;
    expect(error).toBeInstanceOf(GrantJobClaimOutcomeUnknownError); expect(error.privateRecovery).toEqual({ projectId: id(1), jobId: id(5), provenance: f.provenance, claim: f.claim.mock.calls[0][0] });
    expect(Object.isFrozen(error.privateRecovery.claim)).toBe(true); expect(Object.keys(error)).not.toContain('privateRecovery');
    expect(JSON.stringify(error)).not.toContain(error.privateRecovery.claim.ownerToken); expect(inspect(error)).not.toContain(error.privateRecovery.claim.ownerToken);
    expect(f.claim).toHaveBeenCalledOnce(); expect(f.release).not.toHaveBeenCalled(); expect(f.quarantine).not.toHaveBeenCalled();
  });
  it('honors pre-claim cancellation without acquiring an owner', async () => {
    const f = fixture(), controller = new AbortController();
    vi.mocked(requireCalculationGrantRevision).mockImplementationOnce(async () => { controller.abort(); return f.grant; });
    await expect(f.acquire(f.job, controller.signal)).rejects.toBeDefined(); expect(f.claim).not.toHaveBeenCalled();
  });
  it('returns a known successful owner when cancellation lands at the claim boundary so finally can retire it', async () => {
    const f = fixture(), controller = new AbortController(), actualClaim = f.claim.getMockImplementation()!;
    f.claim.mockImplementationOnce(async input => { const authority = await actualClaim(input); controller.abort(); return authority; });
    const execution = await f.acquire(f.job, controller.signal); expect(controller.signal.aborted).toBe(true);
    await execution.finish(true); expect(f.release).toHaveBeenCalledWith((execution.principal as { authority: CalculationGrantAuthority }).authority);
  });

  it('durably retains the exact private intent before claim and retires only after confirmed release', async () => {
    const f = fixture(), execution = await f.acquire(f.job);
    expect(f.order).toEqual(['retain', 'claim']);
    expect(f.recovery.retain).toHaveBeenCalledExactlyOnceWith({ projectId: f.job.project_id, jobId: f.job.id,
      provenance: f.provenance, claim: f.claim.mock.calls[0][0] });
    expect(f.retained.intent).not.toBeNull();
    await execution.finish(true);
    expect(f.order).toEqual(['retain', 'claim', 'release', 'retire']);
    expect(f.retained.intent).toBeNull();
  });

  it('cannot claim if private owner persistence fails', async () => {
    const f = fixture(); f.recovery.retain.mockRejectedValueOnce(Error('Synthetic private persistence refusal.'));
    await expect(f.acquire(f.job)).rejects.toThrow('Synthetic private persistence refusal.');
    expect(f.claim).not.toHaveBeenCalled();
  });

  it('keeps active prior ownership fenced after restart until an independent old join is confirmed', async () => {
    const f = fixture(); await f.acquire(f.job);
    const original = f.retained.intent;
    await expect(f.acquire(f.job)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_LEASE_RECOVERY_REQUIRED' });
    expect(f.retained.intent).toBe(original);
    expect(f.claim).toHaveBeenCalledOnce(); expect(f.release).not.toHaveBeenCalled(); expect(f.recovery.retire).not.toHaveBeenCalled();
    expect(f.order.slice(-2)).toEqual(['reconcile-lock', 'reconcile-row']);
  });

  it('does not treat expired or quarantined ownership as a process join', async () => {
    const f = fixture(), execution = await f.acquire(f.job); await execution.finish(false);
    f.db.leases.get(f.claim.mock.calls[0][0].leaseId)!.expires_at = new Date(0);
    await expect(f.acquire(f.job)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_LEASE_RECOVERY_REQUIRED' });
    expect(f.claim).toHaveBeenCalledOnce(); expect(f.release).not.toHaveBeenCalled(); expect(f.retained.intent).not.toBeNull();
  });

  it('releases the exact old owner only after an explicit recovered join, then starts a fresh finite quantum', async () => {
    const f = fixture(), first = await f.acquire(f.job); await first.finish(false);
    const prior = f.retained.intent!, oldAuthority = (first.principal as { authority: CalculationGrantAuthority }).authority;
    const confirmRecoveredJoin = vi.fn(async (intent: GrantJobClaimRecovery) => { expect(intent).toEqual(prior); return true; });
    const next = await f.acquire(f.job, undefined, { confirmRecoveredJoin });
    expect(confirmRecoveredJoin).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledExactlyOnceWith(oldAuthority);
    expect(f.recovery.retire).toHaveBeenCalledWith(prior);
    expect(f.claim).toHaveBeenCalledTimes(2);
    expect(f.claim.mock.calls[1][0].leaseId).not.toBe(prior.claim.leaseId);
    expect(f.claim.mock.calls[1][0].ownerToken).not.toBe(prior.claim.ownerToken);
    await next.finish(true);
  });

  it('retires a prior intent after an exact serialized no-claim result without inventing join evidence', async () => {
    const f = fixture(); f.claim.mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503));
    await expect(f.acquire(f.job)).rejects.toBeInstanceOf(GrantJobClaimOutcomeUnknownError);
    const original = f.retained.intent!;
    const next = await f.acquire(f.job);
    expect(f.order.slice(1, 4)).toEqual(['reconcile-lock', 'reconcile-row', 'retire']);
    expect(f.recovery.retire).toHaveBeenCalledWith(original);
    expect(f.release).not.toHaveBeenCalled(); expect(f.claim).toHaveBeenCalledTimes(2);
    await next.finish(true);
  });

  it('retains the same intent if a committed unknown claim is found active', async () => {
    const f = fixture(), actualClaim = f.claim.getMockImplementation()!;
    f.claim.mockImplementationOnce(async input => { await actualClaim(input); throw new PathFinderError('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503); });
    await expect(f.acquire(f.job)).rejects.toBeInstanceOf(GrantJobClaimOutcomeUnknownError);
    const original = f.retained.intent;
    await expect(f.acquire(f.job)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_LEASE_RECOVERY_REQUIRED' });
    expect(f.retained.intent).toBe(original); expect(f.claim).toHaveBeenCalledOnce();
  });

  it('can retire an already released exact owner after cleanup acknowledgement was lost', async () => {
    const f = fixture(), execution = await f.acquire(f.job), actualRelease = f.release.getMockImplementation()!;
    f.release.mockImplementationOnce(async input => { await actualRelease(input); throw new PathFinderError('SCHEDULER_COMMIT_OUTCOME_UNKNOWN', 503); });
    await expect(execution.finish(true)).rejects.toMatchObject({ code: 'SCHEDULER_COMMIT_OUTCOME_UNKNOWN' });
    const original = f.retained.intent!;
    const next = await f.acquire(f.job);
    expect(f.recovery.retire).toHaveBeenCalledWith(original); expect(f.release).toHaveBeenCalledOnce();
    await next.finish(true);
  });

  it('never retires an intent when exact reconciliation fails or its owner hash differs', async () => {
    const f = fixture(); await f.acquire(f.job);
    const original = f.retained.intent!;
    f.db.leases.get(original.claim.leaseId)!.owner_sha256 = '0'.repeat(64);
    await expect(f.acquire(f.job)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_RECOVERY_CONFLICT' });
    expect(f.recovery.retire).not.toHaveBeenCalled(); expect(f.claim).toHaveBeenCalledOnce(); expect(f.retained.intent).toBe(original);
  });

  it('keeps private ownership on transient reconciliation errors instead of treating them as no claim', async () => {
    const f = fixture(); await f.acquire(f.job);
    const original = f.retained.intent!, actualQuery = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, values) => { if (sql.includes('pg_advisory_xact_lock')) throw Error('Synthetic database unavailable.'); return actualQuery(sql, values); });
    await expect(f.acquire(f.job)).rejects.toThrow('Synthetic database unavailable.');
    expect(f.recovery.retire).not.toHaveBeenCalled(); expect(f.claim).toHaveBeenCalledOnce(); expect(f.retained.intent).toBe(original);
  });

  it('retains a real completed dependency for final bookkeeping after the last proposal committed', async () => {
    const f = fixture(); f.completed.push(f.items[0]); f.items.length = 0;
    const execution = await f.acquire(f.job);
    expect(f.query.mock.calls.some(([sql]) => sql.includes("state='complete' AND dependencies IS NOT NULL"))).toBe(true);
    expect(f.claim.mock.calls[0][0].modelVersionId).toBe(id(6));
    await execution.finish(true);
  });
});
