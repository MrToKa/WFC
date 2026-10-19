// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineExecutor } from './engineSession.js';
import type { PathFinderJobs } from './jobs.js';
import type { GrantJobExecution, GrantJobClaimRecovery } from './grantWorkerAuthority.js';
import { PathFinderError } from './errors.js';
import { syntheticEngineIdentity } from './calculationFixtures.js';
import { lengthLedgerSchema } from '../../shared/pathfinderLengthLedger.js';
import { revisionBaselineSchema, revisionResultEnvelopeSchema } from '../../shared/pathfinderRevisionResults.js';

const seams = vi.hoisted(() => ({ claim: vi.fn(), acquire: vi.fn(), transaction: vi.fn(), collect: vi.fn(),
  enrollment: vi.fn(), readEnrollment: vi.fn(), identity: vi.fn(), retain: vi.fn(), requireGrant: vi.fn(), baseline: vi.fn(), seal: vi.fn() }));
vi.mock('./workerScheduling.js', async original => ({ ...await original<typeof import('./workerScheduling.js')>(), claimCalculationSlice: seams.claim }));
vi.mock('./dependencies.js', () => ({ collectDependencies: seams.collect, hash: () => 'e'.repeat(64),
  geometryHash: () => 'f'.repeat(64), verifiedDesignOnlyChange: () => false }));
vi.mock('./operationAuthority.js', async original => ({ ...await original<typeof import('./operationAuthority.js')>(), operationTransaction: seams.transaction }));
vi.mock('./grantWorkerAuthority.js', async original => ({ ...await original<typeof import('./grantWorkerAuthority.js')>(), acquireGrantJobExecution: seams.acquire }));
vi.mock('./grantWorkerRecovery.js', () => ({ retainGrantWorkerRecovery: seams.retain,
  grantWorkerRecoveryAdapter: { read: vi.fn(), retain: seams.retain, retire: vi.fn() } }));
vi.mock('./calculationAuthority.js', async original => ({ ...await original<typeof import('./calculationAuthority.js')>(), requireCalculationGrant: seams.requireGrant }));
vi.mock('./calculationEngineIdentity.js', () => ({ calculationEngineIdentity: seams.identity }));
vi.mock('./recalculationRepository.js', () => ({ requireEnrollmentAuthority: seams.enrollment, readRecalculationJobAuthority: seams.readEnrollment }));
vi.mock('./routingScope.js', () => ({ requireVersionedCalculationScope: () => undefined }));
vi.mock('./storage.js', () => ({ readSnapshot: async () => undefined }));
vi.mock('./revisionResultRepository.js', () => ({ readRevisionBaseline: seams.baseline, sealRevisionResult: seams.seal }));
import { createPathFinderWorker } from './worker.js';
import { GrantJobClaimOutcomeUnknownError } from './grantWorkerAuthority.js';

const id = (n: number) => `cb100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Row = Record<string, any>;
const active: Array<ReturnType<typeof createPathFinderWorker>> = [];

/** Actual worker control flow and finishCalculationSlice over mocked SQL/authority/engine only. */
function fixture(options: { kind?: 'current-login' | 'calculation-grant'; unknown?: 'proposal' | 'slice'; sliceCommitted?: boolean; reapFailure?: boolean } = {}) {
  const kind = options.kind ?? 'calculation-grant';
  const provenance = { kind: 'calculation-grant' as const, projectId: id(1), grantId: id(10), grantRevision: '2', grantEpoch: '3',
    installationEpoch: id(11), issuerId: id(6), issuerAdminRevision: '4' };
  const dependencies = { schemaVersion: 'pathfinder.dependencies.v5', projectId: id(1), cableId: id(3),
    options: {}, artifact: { id: id(4), sha256: 'a'.repeat(64) }, model: { id: id(5), selectionRevision: '5', contentFingerprint: 'b'.repeat(64) },
    cableInputs: { mto: 'Control' }, from: { point: [0, 0, 0] }, to: { point: [1, 0, 0] },
    settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '10' } };
  const baseline = { admissionId: id(50), baselineHash: 'a'.repeat(64), baseline: revisionBaselineSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-baseline.v1',
    currentCable: { id: id(3), tag: 'SYNTHETIC', fromLocation: 'A', toLocation: 'B', routing: '/OLD', designLength: '0', installLength: '2.50', cableWriteRevision: '1' },
    lastAcceptedApply: null, acceptedMatchesCurrent: false }) };
  const route = { success: true, message: 'Synthetic connected route.', routeText: '/A', routeCodes: ['/A'], segmentIds: ['dbid:1'],
    pathPoints: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], lengthMeters: 1, fromDistanceMeters: 0, toDistanceMeters: 0,
    fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 };
  const design = { lengthBeforePercentageMeters: '6', unroundedLengthMeters: '6.6', designLengthMeters: '7' };
  const ledger = lengthLedgerSchema.parse({ schemaVersion: 'wfc.pf.length-components.v1', formulaVersion: 'pathfinder-45c24bf5', settingsRevision: '1',
    raw: { lengthMeters: 1, fromDistanceMeters: 0, toDistanceMeters: 0 }, rawLengthDecimalMeters: '1',
    from: { requiresSecondary: false, removedApproachMeters: '0' }, to: { requiresSecondary: false, removedApproachMeters: '0' },
    settings: { secondaryTrayLengthMeters: '7', endConnectionLengthMeters: '5', additionalBendingPercent: '10' },
    secondaryEnds: 0, replacementMeters: '0', beforeClampMeters: '1', clampAdjustmentMeters: '0', afterClampMeters: '1',
    beforePercentageMeters: '6', bendingIncrementMeters: '0.6', unroundedMeters: '6.6', ceilingIncrementMeters: '0.4', designLengthMeters: '7', gapAccounting: 'already-in-raw-geometry' });
  const db = { job: { id: id(2), project_id: id(1), authority_kind: kind, grant_provenance: kind === 'calculation-grant' ? provenance : null,
    requested_by: id(6), login_id: kind === 'current-login' ? id(7) : null,
    login_expires_at: kind === 'current-login' ? new Date(Date.now() + 60000) : null,
    owner_token: null as string | null, lease_until: null as Date | null, state: 'queued', kind: 'calculate', cancel_requested: false,
    timeout_ms: 10000, completed: 0, not_before: null as Date | null, failure: null as string | null },
    item: { cable_id: id(3), state: 'waiting', dependencies }, proposals: new Map<string, Row>(), seals: new Map<string, Row>() };
  const calls: Array<{ sql: string; values: any[] }> = [], events: string[] = [], finishes: Array<ReturnType<typeof vi.fn>> = [];
  let failUsed = false, claimsRemaining = 0;
  const query = vi.fn(async (raw: string, values: any[] = []) => {
    const sql = raw.replace(/\s+/g, ' ').trim(); calls.push({ sql, values });
    if (sql.startsWith('SELECT * FROM pf_jobs')) return { rows: [{ ...db.job }] };
    if (sql.startsWith('SELECT * FROM pf_job_items')) return { rows: db.item.state === 'waiting' ? [{ ...db.item }] : [] };
    if (sql.startsWith("UPDATE pf_job_items SET state='running'")) { db.item.state = 'running'; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pf_proposals')) {
      if (db.proposals.has(id(3))) return { rows: [] };
      db.proposals.set(id(3), { id: values[0], dependencies: structuredClone(values[5]), result: structuredClone(values[8]), hash: values[9] });
      events.push('proposal'); return { rows: [{ id: values[0] }] };
    }
    if (sql.startsWith("UPDATE pf_job_items SET state='complete'")) {
      if (db.item.state !== 'running') return { rows: [] };
      db.item.state = 'complete'; return { rows: [{ cable_id: id(3) }] };
    }
    if (sql.startsWith('UPDATE pf_jobs SET completed=completed+1')) { db.job.completed++; return { rows: [] }; }
    if (sql.startsWith('SELECT 1 FROM pf_job_items')) return { rows: db.item.state === 'waiting' ? [{ value: 1 }] : [] };
    if (sql.startsWith('UPDATE pf_jobs SET state=$3,owner_token=NULL')) {
      if (db.job.owner_token === values[1]) { db.job.state = values[2]; db.job.owner_token = null; db.job.lease_until = null; }
      events.push('finish-slice'); return { rows: [] };
    }
    if (sql.startsWith('UPDATE pf_jobs SET state=CASE')) {
      if (db.job.owner_token === values[1] && db.job.state === 'running') {
        db.job.state = db.job.cancel_requested ? 'cancelled' : values[2] ? 'queued' : 'failed';
        db.job.owner_token = null; db.job.lease_until = null;
        db.job.not_before = values[4] === true || sql.includes('not_before=CASE WHEN $3') && values[2] ? new Date(Date.now() + 5000) : null;
        db.job.failure = typeof values[3] === 'string' ? values[3] : null;
      }
      events.push('failure-bookkeeping'); return { rows: [] };
    }
    if (sql.startsWith('UPDATE pf_jobs j SET lease_until')) return { rows: db.job.state === 'running' ? [{ id: db.job.id }] : [] };
    if (sql.startsWith('SELECT result,dependencies,status FROM pf_proposals')) return { rows: [] };
    throw Error('Unexpected mocked worker SQL: ' + sql);
  });
  const client = { query } as unknown as PoolClient;
  const owner = new EventEmitter() as EventEmitter & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  owner.query = vi.fn(async (sql: string) => { events.push(sql.includes('pg_try_advisory_lock') ? 'lane-lock' : 'lane-unlock'); return { rows: [{ locked: true }] }; });
  owner.release = vi.fn(() => { events.push('lane-release'); }); owner.end = vi.fn(async () => { events.push('lane-end'); });
  const pool = { connect: vi.fn(async () => owner), query } as unknown as Pool;
  seams.claim.mockImplementation(async () => {
    if (claimsRemaining === 0 || db.job.state !== 'queued') return null;
    claimsRemaining--; db.job.state = 'running'; db.job.owner_token = id(20 + seams.acquire.mock.calls.length);
    db.job.lease_until = new Date(Date.now() + 30000); if (db.item.state === 'running') db.item.state = 'waiting';
    return { ...db.job };
  });
  seams.acquire.mockImplementation(async (_pool: Pool, job: Row): Promise<GrantJobExecution> => {
    events.push('acquire:' + job.authority_kind);
    const finish = vi.fn(async (joined: boolean) => { events.push(joined ? 'execution-release' : 'execution-quarantine'); }); finishes.push(finish);
    const principal = job.authority_kind === 'calculation-grant'
      ? { kind: 'calculation-grant' as const, userId: id(6), authority: { ...provenance, operation: 'calculate' as const,
        leaseId: id(30 + finishes.length), ownerToken: 'c'.repeat(64), leaseExpiresAt: '2099-01-01T00:00:00.000Z',
        modelVersionId: id(5), selectionRevision: '5', contentFingerprint: 'b'.repeat(64) } }
      : { userId: job.requested_by, loginId: job.login_id, loginExpiresAt: new Date(job.login_expires_at).getTime() };
    return { principal, finish };
  });
  seams.transaction.mockImplementation(async (_pool: Pool, _project: string, _principal: unknown, _operation: string, work: (c: PoolClient) => Promise<unknown>) => {
    const start = calls.length, before = structuredClone(db), result = await work(client), sql = calls.slice(start).map(c => c.sql);
    const target = options.unknown === 'proposal' ? sql.some(s => s.startsWith('INSERT INTO pf_proposals'))
      : options.unknown === 'slice' && sql.some(s => s.startsWith('UPDATE pf_jobs SET state=$3,owner_token=NULL'));
    if (target && !failUsed) {
      failUsed = true; events.push('lost-commit-ack');
      if (options.unknown === 'slice' && options.sliceCommitted === false) Object.assign(db, before);
      throw new PathFinderError(kind === 'current-login' ? 'PATHFINDER_COMMIT_OUTCOME_UNKNOWN' : 'CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503);
    }
    return result;
  });
  seams.collect.mockResolvedValue({ dependencies });
  seams.baseline.mockResolvedValue(baseline);
  seams.seal.mockImplementation(async (_client: PoolClient, input: { proposalId: string; dependencyHash: string; result: Row }) => {
    const value = revisionResultEnvelopeSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-result.v1', id: id(51), projectId: id(1), admissionId: baseline.admissionId,
      jobId: id(2), cableId: id(3), proposalId: input.proposalId, proposalHash: 'e'.repeat(64), baselineHash: baseline.baselineHash,
      dependencyHash: input.dependencyHash, engineResultSha256: 'd'.repeat(64), ledgerHash: 'c'.repeat(64), oldModel: null,
      summary: { calculationMode: 'calculate', newModel: dependencies.model, routeText: route.routeText, rawLengthMeters: route.lengthMeters,
        designLengthMeters: design.designLengthMeters, unroundedMeters: design.unroundedLengthMeters,
        delta: { rawLengthMeters: null, designLengthMeters: '7', unroundedMeters: null, baseline: 'current-values' }, reasonCodes: ['ACCEPTED_CURRENT_BASELINE_UNAVAILABLE'] },
      comparisonRef: null, observedEvents: [], lengthLedger: ledger, physicalChangeProven: false, createdAt: '2026-10-19T12:00:00Z', revisionResultSha256: 'b'.repeat(64) });
    db.seals.set(input.proposalId, structuredClone(value)); events.push('seal'); return value;
  });
  const failure = new PathFinderError('ENGINE_SESSION_REAP_FAILED', 503, 'Synthetic unconfirmed process join.');
  const engines: EngineExecutor[] = [];
  const engineFactory = vi.fn((): EngineExecutor => {
    const engine: EngineExecutor = {
      execute: vi.fn(async request => { events.push('engine-calculate'); if (options.reapFailure) throw failure;
        return { schemaVersion: 'pathfinder.model.response.v1', requestId: request.requestId, status: 'calculated' as const,
          message: 'Synthetic engine output for worker bookkeeping only.', engineeringAccepted: false, route, design, lengthLedger: ledger } as const; }),
      close: vi.fn(async () => { events.push('engine-close'); if (options.reapFailure) throw failure; events.push('engine-joined'); }),
    };
    engines.push(engine); return engine;
  });
  const create = () => {
    claimsRemaining = 1; db.job.not_before = null;
    const worker = createPathFinderWorker(pool, {} as PathFinderJobs, engineFactory, async () => syntheticEngineIdentity());
    active.push(worker); return worker;
  };
  return { db, pool, query, calls, events, finishes, failure, owner, engines, engineFactory, create, provenance };
}

beforeEach(() => {
  vi.resetAllMocks(); seams.identity.mockResolvedValue(syntheticEngineIdentity()); seams.enrollment.mockResolvedValue(undefined);
  seams.readEnrollment.mockResolvedValue({ enrolled: true, valid: true }); seams.requireGrant.mockResolvedValue(undefined); seams.retain.mockResolvedValue(undefined);
});
afterEach(async () => { for (const worker of active.splice(0)) await worker.stop().catch(() => undefined); });

describe('grant worker recovery integration with mocked external seams', () => {
  it.each(['current-login', 'calculation-grant'] as const)('routes explicit %s authority through the admission helper', async kind => {
    const f = fixture({ kind }), worker = f.create(); worker.start();
    await vi.waitFor(() => expect(f.db.job.state).toBe('complete')); await worker.stop();
    expect(seams.acquire).toHaveBeenCalledOnce(); expect(seams.acquire.mock.calls[0]).toEqual([f.pool,
      expect.objectContaining({ authority_kind: kind, requested_by: id(6) }), expect.any(AbortSignal)]);
    expect(f.finishes[0]).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.engines[0].execute).toHaveBeenCalledOnce(); expect(f.db.proposals.size).toBe(1);
    expect(vi.mocked(f.engines[0].execute).mock.calls[0][0]).toMatchObject({ includeLengthLedger: true });
    expect(seams.baseline).toHaveBeenCalledWith(expect.anything(), { projectId: id(1), jobId: id(2), cableId: id(3) });
    expect(seams.seal).toHaveBeenCalledOnce(); expect(f.db.seals.size).toBe(1);
    if (kind === 'calculation-grant') {
      for (const call of seams.transaction.mock.calls) { expect(call[2]).toMatchObject({ kind: 'calculation-grant', userId: id(6) }); expect(call[2]).not.toHaveProperty('loginId'); }
    }
  });

  it.each(['current-login', 'calculation-grant'] as const)('reclaims only bookkeeping after a committed %s proposal ACK is lost, preserving its exact immutable result and seal', async kind => {
    const f = fixture({ kind, unknown: 'proposal' }), first = f.create(); first.start();
    await vi.waitFor(() => expect(f.finishes[0]).toHaveBeenCalledWith(true)); await first.stop();
    expect(f.db.job.state).toBe('queued'); expect(f.db.item.state).toBe('complete'); expect(f.db.job.completed).toBe(1);
    const original = JSON.stringify([...f.db.proposals.values()]), originalSeals = JSON.stringify([...f.db.seals.values()]);
    const bookkeeping = f.calls.filter(c => c.sql.startsWith('UPDATE pf_jobs SET state=CASE'));
    expect(bookkeeping).toHaveLength(1); expect(bookkeeping[0].values[2]).toBe(true); expect(bookkeeping[0].values[4]).toBe(true);
    const second = f.create(); second.start(); await vi.waitFor(() => expect(f.db.job.state).toBe('complete')); await second.stop();
    expect(seams.acquire).toHaveBeenCalledTimes(2); expect(f.engines.flatMap(e => vi.mocked(e.execute).mock.calls)).toHaveLength(1);
    expect(f.calls.filter(c => c.sql.startsWith('INSERT INTO pf_proposals'))).toHaveLength(1);
    expect(JSON.stringify([...f.db.proposals.values()])).toBe(original); expect(f.db.job.completed).toBe(1);
    expect(JSON.stringify([...f.db.seals.values()])).toBe(originalSeals); expect(seams.seal).toHaveBeenCalledOnce();
    expect(f.finishes.every(finish => finish.mock.calls.every(([joined]) => joined === true))).toBe(true);
  });

  it.each((['current-login', 'calculation-grant'] as const).flatMap(kind => [true, false].map(sliceCommitted => ({ kind, sliceCommitted }))))('reconciles $kind final-slice COMMIT uncertainty without recalculating (actually committed=$sliceCommitted)', async ({ kind, sliceCommitted }) => {
    const f = fixture({ kind, unknown: 'slice', sliceCommitted }), first = f.create(); first.start();
    await vi.waitFor(() => expect(f.finishes[0]).toHaveBeenCalledWith(true)); await first.stop();
    expect(f.db.job.state).toBe(sliceCommitted ? 'complete' : 'queued'); expect(f.db.item.state).toBe('complete');
    const original = JSON.stringify([...f.db.proposals.values()]), originalSeals = JSON.stringify([...f.db.seals.values()]);
    if (!sliceCommitted) { const second = f.create(); second.start(); await vi.waitFor(() => expect(f.db.job.state).toBe('complete')); await second.stop(); }
    expect(f.engines.flatMap(e => vi.mocked(e.execute).mock.calls)).toHaveLength(1);
    expect(f.calls.filter(c => c.sql.startsWith('INSERT INTO pf_proposals'))).toHaveLength(1);
    expect(f.db.job.state).toBe('complete'); expect(JSON.stringify([...f.db.proposals.values()])).toBe(original);
    expect(JSON.stringify([...f.db.seals.values()])).toBe(originalSeals); expect(seams.seal).toHaveBeenCalledOnce();
    expect(f.calls.filter(c => c.sql.startsWith('UPDATE pf_jobs SET state=CASE')).every(c => c.values[2] === true)).toBe(true);
  });

  it('retains the exact unknown claim privately and defers the job before any engine dispatch', async () => {
    const f = fixture(), recovery: GrantJobClaimRecovery = { jobId: id(2), projectId: id(1), provenance: f.provenance,
      claim: { projectId: id(1), grantId: id(10), grantRevision: '2', grantEpoch: '3', installationEpoch: id(11), operation: 'calculate',
        modelVersionId: id(5), selectionRevision: '5', contentFingerprint: 'b'.repeat(64), leaseId: id(40), ownerToken: 'd'.repeat(64) } };
    seams.acquire.mockRejectedValueOnce(new GrantJobClaimOutcomeUnknownError(recovery));
    const worker = f.create(); worker.start(); await vi.waitFor(() => expect(seams.retain).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.db.job.state).toBe('queued')); await worker.stop();
    expect(seams.retain).toHaveBeenCalledExactlyOnceWith(recovery); expect(f.engines[0].execute).not.toHaveBeenCalled();
    expect(f.finishes).toHaveLength(0); expect(f.db.proposals.size).toBe(0);
    expect(seams.baseline).not.toHaveBeenCalled(); expect(seams.seal).not.toHaveBeenCalled();
    const deferred = f.calls.find(c => c.sql.startsWith('UPDATE pf_jobs SET state=CASE'))!;
    expect(deferred.values[2]).toBe(true); expect(JSON.stringify(deferred.values)).not.toContain(recovery.claim.ownerToken);
  });

  it('quarantines an unconfirmed execution join without terminal job/proposal writes or releasing the lane', async () => {
    const f = fixture({ reapFailure: true }), worker = f.create(); worker.start();
    await vi.waitFor(() => expect(f.engines[0].close).toHaveBeenCalledOnce()); await expect(worker.stop()).rejects.toBe(f.failure);
    expect(f.finishes[0]).toHaveBeenCalledExactlyOnceWith(false); expect(worker.failureCode).toBe('ENGINE_SESSION_REAP_FAILED');
    expect(f.db.proposals.size).toBe(0); expect(f.db.job.state).toBe('running'); expect(f.db.job.owner_token).not.toBeNull();
    expect(f.db.seals.size).toBe(0); expect(seams.seal).not.toHaveBeenCalled();
    expect(f.calls.some(c => c.sql.startsWith('UPDATE pf_jobs SET state=CASE') || c.sql.startsWith('INSERT INTO pf_proposals'))).toBe(false);
    expect(f.owner.release).not.toHaveBeenCalled(); expect(f.events).not.toContain('lane-unlock'); expect(f.engines[0].execute).toHaveBeenCalledOnce();
  });
});
