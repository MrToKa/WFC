// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculationGrantSchema, CALCULATION_GRANT_OPERATIONS } from '../../shared/pathfinderCalculationGrant.js';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';
import { calculationAuthorityOwnerHash, type CalculationGrantAuthority, type grantTransaction } from './calculationAuthority.js';
import type { CalculationGrantLeaseClaim } from './calculationGrantRepository.js';
import type { GrantGenerationCandidate, GrantRecalculationAdapter, enrollGrantGenerationInTransaction } from './grantRecalculation.js';
import type { GrantJobClaimRecovery } from './grantWorkerAuthority.js';
import { createGrantRecalculationProducer, grantAdmissionOwnerKey, grantAdmissionRecordSchema,
  type GrantAdmissionRecord, type GrantRecalculationProducerOptions } from './grantRecalculationProducer.js';
import { schedulerTransaction } from './schedulerTransaction.js';
import { PathFinderError } from './errors.js';

vi.mock('./schedulerTransaction.js', () => ({ schedulerTransaction: vi.fn() }));
const id = (n: number) => `ca100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function candidate(n = 1, generation = '2'): GrantGenerationCandidate {
  const grant = calculationGrantSchema.parse({ schemaVersion: 'wfc.pf.calculation-grant.v1', projectId: id(n), id: id(100 + n), grantRevision: '3',
    grantEpoch: '4', installationEpoch: id(200), enabled: true, enabledBy: id(201), issuerAdminRevision: '5',
    enabledAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', scope: 'active-model', operations: [...CALCULATION_GRANT_OPERATIONS],
    limitsProfile: 'local-bounded-v1', preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 });
  return { projectId: id(n), grant, modelVersionId: id(300 + n), selectionRevision: '6', contentFingerprint: 'a'.repeat(64),
    generation, controlRevision: '7', authorityEpoch: '8' };
}
function admissionScope(value: GrantGenerationCandidate) {
  const g = value.grant;
  return { projectId: value.projectId, generation: value.generation, controlRevision: value.controlRevision, authorityEpoch: value.authorityEpoch,
    provenance: { kind: 'calculation-grant' as const, projectId: g.projectId, grantId: g.id, grantRevision: g.grantRevision,
      grantEpoch: g.grantEpoch, installationEpoch: g.installationEpoch, issuerId: g.enabledBy, issuerAdminRevision: g.issuerAdminRevision },
    modelVersionId: value.modelVersionId, selectionRevision: value.selectionRevision, contentFingerprint: value.contentFingerprint };
}
function fixture(rows = [candidate()]) {
  const events: string[] = [], records = new Map<string, GrantAdmissionRecord>(), owners = new Map<string, GrantJobClaimRecovery>(),
    leases = new Map<string, Record<string, unknown>>(), enrolled = new Map<string, string>();
  const clock = { value: Date.parse('2026-10-19T00:00:00Z') }, blocked = { value: false };
  const ownerKey = (projectId: string, jobId: string) => projectId + ':' + jobId;
  const journal = {
    list: vi.fn(async () => [...records.values()]),
    retain: vi.fn(async (record: GrantAdmissionRecord) => { events.push('journal-retain'); records.set(record.id, structuredClone(record)); }),
    retire: vi.fn(async (record: GrantAdmissionRecord) => { events.push('journal-retire'); records.delete(record.id); }),
  };
  const recovery = {
    read: vi.fn(async (key: { projectId: string; jobId: string }) => owners.get(ownerKey(key.projectId, key.jobId)) ?? null),
    retain: vi.fn(async (intent: GrantJobClaimRecovery) => { events.push('owner-retain'); owners.set(ownerKey(intent.projectId, intent.jobId), structuredClone(intent)); }),
    retire: vi.fn(async (intent: GrantJobClaimRecovery) => { events.push('owner-retire'); owners.delete(ownerKey(intent.projectId, intent.jobId)); }),
  };
  const rowFor = (a: CalculationGrantAuthority, state = 'active') => ({ id: a.leaseId, project_id: a.projectId, grant_id: a.grantId,
    grant_revision: a.grantRevision, grant_epoch: a.grantEpoch, installation_epoch: a.installationEpoch, issuer_id: a.issuerId,
    issuer_admin_revision: a.issuerAdminRevision, operation: a.operation, model_version_id: a.modelVersionId, selection_revision: a.selectionRevision,
    content_fingerprint: a.contentFingerprint, owner_sha256: calculationAuthorityOwnerHash(a.ownerToken), state, expires_at: a.leaseExpiresAt });
  const repository = {
    claim: vi.fn(async (claim: CalculationGrantLeaseClaim): Promise<CalculationGrantAuthority> => {
      events.push('claim');
      const record = [...records.values()].find(r => r.leaseId === claim.leaseId)!;
      expect(record).toBeDefined(); expect(owners.get(ownerKey(record.projectId, record.id))?.claim).toEqual(claim);
      const authority: CalculationGrantAuthority = { ...claim, kind: 'calculation-grant', issuerId: record.provenance.issuerId,
        issuerAdminRevision: record.provenance.issuerAdminRevision, leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
      leases.set(claim.leaseId, rowFor(authority)); return authority;
    }),
    release: vi.fn(async (authority: CalculationGrantAuthority) => { events.push('release'); leases.get(authority.leaseId)!.state = 'released'; }),
  };
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('pg_advisory_xact_lock')) { events.push('reconcile-lock'); return { rows: [] }; }
    if (sql.includes('FROM pf_calculation_grant_leases WHERE id=$1 FOR UPDATE')) {
      events.push('reconcile-row'); const row = leases.get(String(values[0])); return { rows: row ? [row] : [] };
    }
    throw Error('Unexpected mocked admission recovery query.');
  });
  const client = { query } as unknown as PoolClient, pool = {} as Pool;
  vi.mocked(schedulerTransaction).mockImplementation(async (_pool, work) => work(client));
  const readCandidates = vi.fn(async (_pool: Pool, options: { limit?: number; afterProjectId?: string | null; signal?: AbortSignal } = {}) => rows
    .filter(r => (!options.afterProjectId || r.projectId > options.afterProjectId) && enrolled.get(r.projectId) !== r.generation)
    .sort((a, b) => a.projectId.localeCompare(b.projectId)).slice(0, options.limit ?? 5));
  const adapter: GrantRecalculationAdapter = { createInTransaction: vi.fn() };
  const enroll = vi.fn(async (_client: PoolClient, input: Parameters<typeof enrollGrantGenerationInTransaction>[1]): Promise<Awaited<ReturnType<typeof enrollGrantGenerationInTransaction>>> => {
    events.push('enroll'); input.signal.throwIfAborted(); enrolled.set(input.authority.projectId, input.generation);
    return { status: blocked.value ? 'blocked' : 'enrolled', generation: input.generation, jobId: blocked.value ? null : id(500) };
  });
  const transaction = vi.fn(async (_pool: Pool, _authority: CalculationGrantAuthority, _operation: string, work: (c: PoolClient) => Promise<unknown>, signal?: AbortSignal) => {
    events.push('transaction'); signal?.throwIfAborted(); const value = await work(client); signal?.throwIfAborted(); events.push('commit'); return value;
  });
  const options: GrantRecalculationProducerOptions = { repository, recovery, journal, readCandidates,
    enroll, transaction: transaction as unknown as typeof grantTransaction, now: () => clock.value };
  const create = (extra: GrantRecalculationProducerOptions = {}) => createGrantRecalculationProducer(pool, adapter, { ...options, ...extra });
  function pending(value: GrantGenerationCandidate, n = 600, state: 'active' | 'released' | 'quarantined' | 'absent' = 'active') {
    const scope = admissionScope(value), key = grantAdmissionOwnerKey(scope), claim: CalculationGrantLeaseClaim = { projectId: scope.projectId,
      grantId: scope.provenance.grantId, grantRevision: scope.provenance.grantRevision, grantEpoch: scope.provenance.grantEpoch,
      installationEpoch: scope.provenance.installationEpoch, operation: 'calculate', modelVersionId: scope.modelVersionId,
      selectionRevision: scope.selectionRevision, contentFingerprint: scope.contentFingerprint, leaseId: id(n), ownerToken: 'c'.repeat(64) };
    const record = grantAdmissionRecordSchema.parse({ ...scope, schemaVersion: 'wfc.pf.private-grant-admission.v1',
      purpose: 'generation-admission-only-no-engine', id: key, leaseId: claim.leaseId, ownerSha256: calculationAuthorityOwnerHash(claim.ownerToken) });
    const intent: GrantJobClaimRecovery = { projectId: scope.projectId, jobId: key, provenance: scope.provenance, claim };
    records.set(key, record); owners.set(ownerKey(scope.projectId, key), intent);
    if (state !== 'absent') leases.set(claim.leaseId, rowFor({ ...claim, kind: 'calculation-grant', issuerId: scope.provenance.issuerId,
      issuerAdminRevision: scope.provenance.issuerAdminRevision, leaseExpiresAt: '2020-01-01T00:00:00.000Z' }, state));
    return { record, intent };
  }
  return { rows, events, records, owners, leases, enrolled, clock, blocked, journal, recovery, repository, query, readCandidates,
    adapter, enroll, transaction, options, create, pending, ownerKey };
}

beforeEach(() => vi.resetAllMocks());

describe('bounded persistent-grant generation admission producer', () => {
  it('retains admission metadata and exact private owner before claim, then delegates atomic job admission', async () => {
    const f = fixture(), producer = f.create(); await producer.tick();
    expect(f.events).toEqual(['journal-retain', 'owner-retain', 'claim', 'transaction', 'enroll', 'commit', 'release', 'owner-retire', 'journal-retire']);
    const input = f.enroll.mock.calls[0][1], authority = f.transaction.mock.calls[0][1];
    expect(input).toMatchObject({ authority, generation: '2', controlRevision: '7', authorityEpoch: '8', preferences: f.rows[0].grant.preferences,
      timeoutMilliseconds: f.rows[0].grant.timeoutMilliseconds, adapter: f.adapter });
    expect(f.transaction.mock.calls[0][2]).toBe('calculate'); expect(f.records.size).toBe(0); expect(f.owners.size).toBe(0);
    expect(f.adapter.createInTransaction).not.toHaveBeenCalled(); expect(producer.lastErrorCode).toBeNull(); await producer.stop();
  });

  it('records an all-blocked null-job generation once and suppresses an unchanged returned scope', async () => {
    const f = fixture(); f.blocked.value = true; f.readCandidates.mockImplementation(async () => f.rows);
    const producer = f.create(); await producer.tick(); await producer.tick();
    expect(f.enroll).toHaveBeenCalledOnce(); await expect(f.enroll.mock.results[0].value).resolves.toMatchObject({ status: 'blocked', jobId: null });
    expect(f.repository.claim).toHaveBeenCalledOnce(); expect(f.repository.release).toHaveBeenCalledOnce();
    await producer.stop();
  });

  it('admits changed generation/model/selection scope instead of reusing the old proposal inputs', async () => {
    const f = fixture(), producer = f.create(); await producer.tick();
    f.rows[0] = { ...f.rows[0], generation: '3', selectionRevision: '9', contentFingerprint: 'd'.repeat(64) };
    await producer.tick(); expect(f.enroll).toHaveBeenCalledTimes(2);
    expect(f.repository.claim.mock.calls[1][0]).toMatchObject({ selectionRevision: '9', contentFingerprint: 'd'.repeat(64) }); await producer.stop();
  });

  it('preserves generation/role/dependency refusal and backs off without repeatedly claiming the unchanged scope', async () => {
    const f = fixture(); f.enroll.mockRejectedValue(new PathFinderError('AUTOMATIC_GENERATION_SUPERSEDED', 409));
    const producer = f.create(); await producer.tick(); await producer.tick();
    expect(producer.lastErrorCode).toBe('AUTOMATIC_GENERATION_SUPERSEDED'); expect(f.repository.claim).toHaveBeenCalledOnce();
    expect(f.repository.release).toHaveBeenCalledOnce(); expect(f.records.size).toBe(0);
    f.clock.value += 30000; await producer.tick(); expect(f.repository.claim).toHaveBeenCalledTimes(2); await producer.stop();
  });

  it('bounds each tick to five project candidates and advances past refused projects fairly', async () => {
    const f = fixture(Array.from({ length: 6 }, (_, n) => candidate(n + 1)));
    f.repository.claim.mockRejectedValue(new PathFinderError('CALCULATION_GRANT_REVOKED', 409));
    const producer = f.create(); await producer.tick(); expect(f.repository.claim).toHaveBeenCalledTimes(RECALCULATION_LIMITS.producerProjectsPerTick);
    await producer.tick(); expect(f.repository.claim).toHaveBeenCalledTimes(6);
    expect(f.readCandidates.mock.calls[1][1]).toMatchObject({ afterProjectId: id(5), limit: 5 });
    await producer.tick(); expect(f.repository.claim).toHaveBeenCalledTimes(6); await producer.stop();
  });

  it('never claims before both durable stores acknowledge their exact metadata/owner', async () => {
    const f = fixture(); f.recovery.retain.mockRejectedValueOnce(Error('Synthetic durable owner failure.'));
    const producer = f.create(); await producer.tick();
    expect(f.repository.claim).not.toHaveBeenCalled(); expect(f.enroll).not.toHaveBeenCalled();
    expect(f.events).toContain('reconcile-lock'); expect(f.records.size).toBe(0); await producer.stop();
  });

  it('recovers an older generation admission even when it is absent from current candidates', async () => {
    const f = fixture([]), old = f.pending(candidate(1, '1')), producer = f.create(); await producer.tick();
    expect(f.repository.release).toHaveBeenCalledOnce(); expect(f.repository.release.mock.calls[0][0]).toMatchObject({ leaseId: old.record.leaseId, ownerToken: old.intent.claim.ownerToken });
    expect(f.records.size).toBe(0); expect(f.owners.size).toBe(0); expect(f.enroll).not.toHaveBeenCalled(); await producer.stop();
  });

  it('does not cancel another unexpired live admission while recovering the shared journal', async () => {
    const f = fixture([]), prior = f.pending(candidate());
    f.leases.get(prior.record.leaseId)!.expires_at = '2099-01-01T00:00:00.000Z';
    const producer = f.create(); await producer.tick(); await producer.tick();
    expect(producer.lastErrorCode).toBe('GRANT_ADMISSION_LEASE_IN_PROGRESS'); expect(f.repository.release).not.toHaveBeenCalled();
    expect(f.records.size).toBe(1);
    f.clock.value = Date.parse('2100-01-01T00:00:00Z'); await producer.tick();
    expect(f.repository.release).toHaveBeenCalledOnce(); expect(f.records.size).toBe(0); await producer.stop();
  });

  it('uses no-engine proof only for an exact admission-purpose record, never a worker private key', async () => {
    const f = fixture([]), pending = f.pending(candidate());
    f.owners.set(f.ownerKey(pending.record.projectId, pending.record.id), { ...pending.intent, jobId: id(999) });
    const producer = f.create(); await producer.tick();
    expect(producer.lastErrorCode).toBe('GRANT_ADMISSION_RECOVERY_CONFLICT'); expect(f.repository.release).not.toHaveBeenCalled();
    expect(f.records.size).toBe(1); expect(f.recovery.retire).not.toHaveBeenCalled(); await producer.stop();
  });

  it.each(['quarantined', 'missing-secret', 'wrong-hash'] as const)('retains %s admission recovery and avoids a retry hot loop', async variant => {
    const f = fixture([]), pending = f.pending(candidate(), 600, variant === 'quarantined' ? 'quarantined' : 'active');
    if (variant === 'missing-secret') f.owners.clear();
    if (variant === 'wrong-hash') f.leases.get(pending.record.leaseId)!.owner_sha256 = '0'.repeat(64);
    const producer = f.create(); await producer.tick(); const queries = f.query.mock.calls.length; await producer.tick();
    expect(f.query).toHaveBeenCalledTimes(queries); expect(f.repository.release).not.toHaveBeenCalled(); expect(f.records.size).toBe(1); await producer.stop();
  });

  it('retires exact no-claim or released admission records without falsely requiring process reaping', async () => {
    const f = fixture([]); f.pending(candidate(1), 600, 'absent'); f.pending(candidate(2), 601, 'released');
    const producer = f.create(); await producer.tick();
    expect(f.repository.release).not.toHaveBeenCalled(); expect(f.records.size).toBe(0); expect(f.owners.size).toBe(0); await producer.stop();
  });

  it('shares the five-operation tick budget with recovery before admitting more projects', async () => {
    const f = fixture([candidate(6)]); for (let n = 1; n <= 5; n++) f.pending(candidate(n), 600 + n, 'released');
    const producer = f.create(); await producer.tick(); expect(f.readCandidates).not.toHaveBeenCalled(); expect(f.records.size).toBe(0);
    await producer.tick(); expect(f.enroll).toHaveBeenCalledOnce(); await producer.stop();
  });

  it('reconciles an unknown claim with the exact retained owner instead of creating a replacement lease', async () => {
    const f = fixture(), actual = f.repository.claim.getMockImplementation()!;
    f.repository.claim.mockImplementationOnce(async input => { await actual(input); throw new PathFinderError('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503); });
    const producer = f.create(); await producer.tick();
    expect(f.repository.claim).toHaveBeenCalledOnce(); expect(f.repository.release.mock.calls[0][0].leaseId).toBe(f.repository.claim.mock.calls[0][0].leaseId);
    expect(f.enroll).not.toHaveBeenCalled(); expect(f.records.size).toBe(0); expect(producer.lastErrorCode).toBe('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN'); await producer.stop();
  });

  it('retains cleanup uncertainty until exact released-state reconciliation succeeds', async () => {
    const f = fixture(), actual = f.repository.release.getMockImplementation()!;
    f.repository.release.mockImplementationOnce(async authority => { await actual(authority); throw new PathFinderError('SCHEDULER_COMMIT_OUTCOME_UNKNOWN', 503); });
    const producer = f.create(); await producer.tick();
    expect(f.repository.release).toHaveBeenCalledOnce(); expect(f.repository.claim).toHaveBeenCalledOnce(); expect(f.enroll).toHaveBeenCalledOnce();
    expect(f.records.size).toBe(0); expect(f.owners.size).toBe(0); expect(producer.lastErrorCode).toBe('SCHEDULER_COMMIT_OUTCOME_UNKNOWN'); await producer.stop();
  });

  it('does not duplicate admission after an enrollment COMMIT acknowledgement is lost', async () => {
    const f = fixture(), actual = f.enroll.getMockImplementation()!;
    f.enroll.mockImplementationOnce(async (c, input) => { await actual(c, input); throw new PathFinderError('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503); });
    const producer = f.create(); await producer.tick(); await producer.tick();
    expect(f.enroll).toHaveBeenCalledOnce(); expect(f.repository.claim).toHaveBeenCalledOnce(); expect(f.records.size).toBe(0); await producer.stop();
  });

  it('coalesces overlapping ticks and stop awaits admission plus exact cleanup', async () => {
    const f = fixture(); let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    f.enroll.mockImplementationOnce(async (_c, input) => { entered(); await new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }));
      input.signal.throwIfAborted(); return { status: 'blocked', generation: input.generation, jobId: null }; });
    const producer = f.create(), first = producer.tick(), second = producer.tick(); expect(first).toBe(second); await ready;
    await producer.stop(); await first;
    expect(f.enroll).toHaveBeenCalledOnce(); expect(f.repository.release).toHaveBeenCalledOnce(); expect(f.records.size).toBe(0);
    await producer.tick(); expect(f.repository.claim).toHaveBeenCalledOnce();
  });

  it('gates the whole tick on the trusted observer and never exposes its private error message', async () => {
    const f = fixture(), onError = vi.fn(), producer = f.create({ beforeTick: async () => { throw Error('private credentials'); }, onError });
    await producer.tick(); expect(f.journal.list).not.toHaveBeenCalled(); expect(f.repository.claim).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith('GRANT_RECALCULATION_PRODUCER_UNAVAILABLE'); await producer.stop();
  });

  it('starts one owned poll loop and stop aborts/joins it without leaving background work', async () => {
    const f = fixture(); let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const beforeTick = vi.fn(async (signal: AbortSignal) => { entered(); await new Promise<void>(resolve => {
      if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true });
    }); });
    const producer = f.create({ beforeTick }); producer.start(); producer.start(); await ready; await producer.stop();
    expect(beforeTick).toHaveBeenCalledOnce(); expect(f.repository.claim).not.toHaveBeenCalled();
    producer.start(); await producer.tick(); expect(beforeTick).toHaveBeenCalledOnce();
  });

  it.each([0, 249, 15001, NaN])('rejects unsafe poll cadence %s', pollMilliseconds => {
    const f = fixture(); expect(() => f.create({ pollMilliseconds })).toThrow('Invalid grant recalculation producer cadence.');
  });

  it.each([0, 4999, 60001, NaN])('rejects unsafe retry cadence %s', failureBackoffMilliseconds => {
    const f = fixture(); expect(() => f.create({ failureBackoffMilliseconds })).toThrow('Invalid grant recalculation producer cadence.');
  });
});

describe('admission-only recovery identity', () => {
  it('derives a deterministic UUIDv5 for this exact project/generation/grant/model authority scope', () => {
    const a = admissionScope(candidate()), first = grantAdmissionOwnerKey(a);
    expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(grantAdmissionOwnerKey(structuredClone(a))).toBe(first);
    expect(grantAdmissionOwnerKey({ ...a, generation: '3' })).not.toBe(first);
    expect(grantAdmissionOwnerKey({ ...a, provenance: { ...a.provenance, grantEpoch: '99' } })).not.toBe(first);
    expect(grantAdmissionOwnerKey({ ...a, contentFingerprint: 'd'.repeat(64) })).not.toBe(first);
  });

  it('rejects worker-purpose, forged key, foreign tenant and owner-secret index data', () => {
    const f = fixture([]), { record } = f.pending(candidate());
    for (const changed of [{ ...record, purpose: 'worker-calculate' }, { ...record, id: id(999) },
      { ...record, projectId: id(998) }, { ...record, ownerToken: 'd'.repeat(64) }]) {
      expect(grantAdmissionRecordSchema.safeParse(changed).success).toBe(false);
    }
  });
});
