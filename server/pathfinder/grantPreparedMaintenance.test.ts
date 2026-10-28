// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { calculationGrantSchema, CALCULATION_GRANT_OPERATIONS } from '../../shared/pathfinderCalculationGrant.js';
import { preparationAggregateV2Schema } from '../../shared/pathfinderPreparation.js';
import { geometryTraceReceiptSchema, GEOMETRY_TRACE_DERIVATION } from '../../shared/pathfinderGeometryTrace.js';
import { revisionComparisonContextSchema, revisionComparisonCreateSchema, revisionComparisonReceiptSchema, type RevisionComparisonChoice, type RevisionComparisonCreate } from '../../shared/pathfinderRevisionComparison.js';
import type { CalculationGrantLeaseClaim } from './calculationGrantRepository.js';
import type { CalculationGrantAuthority, grantTransaction } from './calculationAuthority.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace } from './geometryTraceBuilder.js';
import { createGrantPreparedMaintenance, grantPreparedMaintenanceRecordSchema, type GrantPreparedMaintenanceRecord,
  type PreparedMaintenanceInput, type GrantPreparedMaintenanceOptions } from './grantPreparedMaintenance.js';
import { PathFinderError } from './errors.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';

const id = (n: number) => `cc100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const same = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
function fixture() {
  const f = geometryTraceFixture(), grant = calculationGrantSchema.parse({ schemaVersion: 'wfc.pf.calculation-grant.v1', projectId: f.aggregate.projectId,
    id: id(1), grantRevision: '2', grantEpoch: '3', installationEpoch: id(4), enabled: true, enabledBy: f.createdBy, issuerAdminRevision: '5',
    enabledAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', scope: 'active-model', operations: [...CALCULATION_GRANT_OPERATIONS],
    limitsProfile: 'local-bounded-v1', preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 });
  const provenance = { kind: 'calculation-grant' as const, projectId: grant.projectId, grantId: grant.id, grantRevision: grant.grantRevision,
    grantEpoch: grant.grantEpoch, installationEpoch: grant.installationEpoch, issuerId: grant.enabledBy, issuerAdminRevision: grant.issuerAdminRevision };
  const aggregate = preparationAggregateV2Schema.parse({ ...f.aggregate, schemaVersion: 'wfc.pf.geometry-aggregate.v2', producerGrant: provenance });
  const trace = buildGeometryTrace({ ...f, aggregate }).manifest;
  const receipt = geometryTraceReceiptSchema.parse({ schemaVersion: 'wfc.pf.geometry-trace-receipt.v1', trace, duplicate: false });
  const input: PreparedMaintenanceInput = { candidate: { projectId: grant.projectId, grant, modelVersionId: aggregate.modelVersionId,
    selectionRevision: aggregate.selectionRevision, contentFingerprint: aggregate.contentFingerprint }, result: { status: 'published', producer: { joined: true },
    aggregate, sessionId: aggregate.sessionId, traceInputs: { aggregateId: aggregate.id, sessionId: aggregate.sessionId, artifactId: aggregate.artifactId,
      coordinateFrameId: aggregate.coordinateFrameId, partIds: aggregate.partReferences.map(p => p.partId) } } };
  const target: RevisionComparisonChoice = { aggregateId: aggregate.id, traceId: trace.id, projectionSha256: trace.projection.sha256,
    traceContentSha256: trace.contentSha256, modelVersionId: aggregate.modelVersionId, captureFrameId: aggregate.coordinateFrameId,
    geometryRevision: aggregate.geometryRevision, coverage: { requestedScopeSha256: aggregate.orderedScopeSha256, comparableScopeSha256: null,
      requestedScopeComplete: true, includedObjects: trace.counts.objects, excludedObjects: null, basis: 'prepared-requested-scope' },
    routing: { catalogRevision: aggregate.catalogRevision, routingContentSha256: aggregate.routingContentSha256,
      routingPolicyRevision: aggregate.routingPolicyRevision, routingPolicySha256: aggregate.routingPolicySha256 }, modelLabel: 'Synthetic current model', createdAt: trace.createdAt };
  const older: RevisionComparisonChoice = { ...target, aggregateId: id(10), traceId: id(11), traceContentSha256: 'a'.repeat(64),
    modelVersionId: id(12), createdAt: '2026-10-17T00:00:00Z', modelLabel: 'Synthetic older model' };
  const newerSameModel: RevisionComparisonChoice = { ...target, aggregateId: id(13), traceId: id(14), traceContentSha256: 'b'.repeat(64), createdAt: '2026-10-18T00:00:00Z' };
  const context = revisionComparisonContextSchema.parse({ schemaVersion: 'wfc.pf.revision-comparison-context.v1', projectId: grant.projectId,
    comparisonRevision: '6', current: null, activeModelVersionId: aggregate.modelVersionId, choices: [newerSameModel, target, older], choicesTruncated: false,
    capabilities: { compare: true, reviewedObjectMapping: true, reviewedFrameMapping: true, bindingFrameQualification: true, reasonCodes: [] } });
  const events: string[] = [], records = new Map<string, GrantPreparedMaintenanceRecord>();
  const journal = { list: vi.fn(async () => structuredClone([...records.values()])),
    save: vi.fn(async (previous: GrantPreparedMaintenanceRecord | null, next: GrantPreparedMaintenanceRecord) => {
      const current = records.get(next.id); if (current ? !previous || !same(current, previous) : previous !== null) throw new PathFinderError('PREPARED_MAINTENANCE_JOURNAL_CONFLICT', 503);
      const parsed = grantPreparedMaintenanceRecordSchema.parse(next); records.set(next.id, structuredClone(parsed)); events.push('save'); return structuredClone(parsed);
    }) };
  const repository = {
    claim: vi.fn(async (claim: CalculationGrantLeaseClaim): Promise<CalculationGrantAuthority> => {
      events.push('claim:' + claim.operation);
      const record = [...records.values()][0], step = claim.operation === 'trace' ? record.trace : record.comparison!;
      expect(step.claim).toEqual(claim); expect(step.phase).toBe('planned');
      if (claim.operation === 'trace') expect(step).toHaveProperty('command.derivationVersion', GEOMETRY_TRACE_DERIVATION);
      return { ...claim, kind: 'calculation-grant', issuerId: grant.enabledBy, issuerAdminRevision: grant.issuerAdminRevision, leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
    }),
    release: vi.fn(async (a: CalculationGrantAuthority) => { events.push('release:' + a.operation); }),
    quarantine: vi.fn(async (a: CalculationGrantAuthority, _reason: string) => { events.push('quarantine:' + a.operation); }),
  };
  const traces = { create: vi.fn(async () => { events.push('trace-create'); return receipt; }) };
  const comparisonReceipt = (command: RevisionComparisonCreate) => {
    const source = context.choices.find(c => c.aggregateId === command.source.aggregateId)!;
    const toInput = ({ modelLabel: _label, createdAt: _time, ...choice }: RevisionComparisonChoice) => choice;
    return revisionComparisonReceiptSchema.parse({ schemaVersion: 'wfc.pf.revision-comparison-receipt.v1', duplicate: false,
      comparison: { schemaVersion: 'wfc.pf.revision-comparison.v1', id: id(30), projectId: grant.projectId, comparisonRevision: '7',
        source: toInput(source), target: toInput(target), policyVersion: 'wfc.pf.revision-comparison-policy.v1', decisionSetSha256: 'c'.repeat(64),
        changesSha256: 'd'.repeat(64), contentSha256: 'e'.repeat(64), counts: { sourceObjects: source.coverage.includedObjects,
          targetObjects: target.coverage.includedObjects, changes: 0, candidateEdges: 0, matched: 0, unresolved: 0 },
        readiness: { package: 'ready', geometry: 'ready', frame: 'unverified', mappings: 'requires-review', endpoints: 'not-evaluated', calculation: 'not-evaluated',
          review: 'required-per-proposal', apply: 'requires-fresh-human-review', reasonCodes: ['MANUAL_REVIEW_REQUIRED'] }, createdBy: grant.enabledBy,
        createdAt: '2026-10-19T00:01:00Z', reason: command.reason, engineeringAccepted: false } });
  };
  const comparisons = { context: vi.fn(async () => { events.push('compare-context'); return structuredClone(context); }),
    create: vi.fn(async (_project: string, _who: unknown, raw: unknown) => { events.push('compare-create'); return comparisonReceipt(revisionComparisonCreateSchema.parse(raw)); }), decide: vi.fn() };
  const dirty = vi.fn(async (_c: PoolClient, _input: unknown) => { events.push('dirty'); });
  const transaction = vi.fn(async (_pool: Pool, _a: CalculationGrantAuthority, op: string, work: (c: PoolClient) => Promise<unknown>) => {
    events.push('transaction:' + op); return work({} as PoolClient);
  });
  const pool = {} as Pool, options: GrantPreparedMaintenanceOptions = { traces, comparisons, journal, repository, dirty,
    transaction: transaction as unknown as typeof grantTransaction };
  const create = () => createGrantPreparedMaintenance(pool, options);
  return { input, aggregate, trace, receipt, context, target, older, newerSameModel, records, journal, repository, traces, comparisons,
    events, dirty, transaction, create, options, comparisonReceipt };
}

describe('grant-owned trace/comparison maintenance after physical preparation cleanup', () => {
  it('uses distinct finite operation leases and marks trace dirty before releasing it', async () => {
    const f = fixture(), maintenance = f.create(), outcome = await maintenance.onPrepared(f.input);
    expect(outcome).toEqual({ status: 'complete', traceId: f.trace.id, comparisonId: id(30), reasonCode: null });
    expect(f.repository.claim.mock.calls.map(([c]) => c.operation)).toEqual(['trace', 'compare']);
    expect(f.events.indexOf('trace-create')).toBeLessThan(f.events.indexOf('dirty'));
    expect(f.events.indexOf('dirty')).toBeLessThan(f.events.indexOf('release:trace'));
    expect(f.events.indexOf('release:trace')).toBeLessThan(f.events.indexOf('claim:compare'));
    expect(f.dirty).toHaveBeenCalledExactlyOnceWith(expect.anything(), { projectId: f.input.candidate.projectId, domain: 'geometry',
      reason: 'GEOMETRY_TRACE_PUBLISHED', sourceRevision: f.trace.id + ':' + f.trace.contentSha256 });
    expect(f.transaction.mock.calls[0][2]).toBe('trace'); expect(f.comparisons.decide).not.toHaveBeenCalled();
    expect(maintenance.pending).toBe(false); expect(maintenance.blockCode).toBeNull();
  });

  it('persists exact trace and comparison commands before their writes and carries no fabricated human login', async () => {
    const f = fixture(); await f.create().onPrepared(f.input);
    const traceCommand = f.traces.create.mock.calls[0] as unknown as unknown[];
    expect(traceCommand[2]).toMatchObject({ aggregateId: f.aggregate.id, expectedProjectionSha256: f.aggregate.projection.sha256,
      derivationVersion: GEOMETRY_TRACE_DERIVATION, idempotencyKey: expect.any(String) });
    const comparisonCommand = revisionComparisonCreateSchema.parse(f.comparisons.create.mock.calls[0][2]);
    expect(comparisonCommand.source.aggregateId).toBe(f.older.aggregateId);
    expect(comparisonCommand.target.traceId).toBe(f.trace.id); expect(comparisonCommand.expectedComparisonRevision).toBe('6');
    for (const args of [traceCommand, f.comparisons.create.mock.calls[0]]) {
      expect(args[1]).toMatchObject({ kind: 'calculation-grant', userId: f.input.candidate.grant.enabledBy });
      expect(args[1]).not.toHaveProperty('loginId');
    }
    const writes = f.journal.save.mock.calls.map(([, r]) => r);
    expect(writes.some(r => r.trace.phase === 'invoking' && same(r.trace.command, traceCommand[2]))).toBe(true);
    expect(writes.some(r => r.comparison?.phase === 'invoking' && same(r.comparison.command, comparisonCommand))).toBe(true);
  });

  it('chooses the latest earlier different model before a newer same-model choice', async () => {
    const f = fixture(); const secondOlder = { ...f.older, aggregateId: id(40), traceId: id(41), createdAt: '2026-10-18T01:00:00Z' };
    f.context.choices.push(secondOlder); await f.create().onPrepared(f.input);
    expect(revisionComparisonCreateSchema.parse(f.comparisons.create.mock.calls[0][2]).source.traceId).toBe(secondOlder.traceId);
  });

  it('skips comparison explicitly when there is no earlier traced aggregate', async () => {
    const f = fixture(); f.context.choices = [f.target]; const maintenance = f.create();
    expect(await maintenance.onPrepared(f.input)).toMatchObject({ status: 'skipped', traceId: f.trace.id, comparisonId: null, reasonCode: 'TWO_TRACED_AGGREGATES_REQUIRED' });
    expect(f.repository.release).toHaveBeenCalledTimes(2); expect(f.comparisons.create).not.toHaveBeenCalled(); expect(maintenance.pending).toBe(false);
  });

  it('replays completed maintenance from exact durable receipts without a new lease or engine operation', async () => {
    const f = fixture(), first = await f.create().onPrepared(f.input);
    expect(await f.create().onPrepared(f.input)).toEqual(first);
    expect(f.traces.create).toHaveBeenCalledOnce(); expect(f.comparisons.create).toHaveBeenCalledOnce(); expect(f.repository.claim).toHaveBeenCalledTimes(2);
  });

  it.each(['model', 'grant', 'join', 'trace-input'] as const)('refuses mismatched %s input before claiming or writing', async variant => {
    const f = fixture(); let input = structuredClone(f.input);
    if (variant === 'model') input.candidate.selectionRevision = '99';
    if (variant === 'grant') input.candidate.grant.grantRevision = '99';
    if (variant === 'join') input = { ...input, result: { ...input.result, producer: { joined: false } as never } };
    if (variant === 'trace-input') input = { ...input, result: { ...input.result, traceInputs: { ...input.result.traceInputs, aggregateId: id(99) } } };
    await expect(f.create().onPrepared(input)).rejects.toMatchObject({ code: 'PREPARED_MAINTENANCE_SCOPE_DENIED' });
    expect(f.repository.claim).not.toHaveBeenCalled(); expect(f.journal.save).not.toHaveBeenCalled();
  });

  it('quarantines unknown trace completion and blocks automatic command/owner replacement across restarts', async () => {
    const f = fixture(); f.traces.create.mockRejectedValueOnce(new PathFinderError('ENGINE_SESSION_REAP_FAILED', 503));
    const maintenance = f.create(); await expect(maintenance.onPrepared(f.input)).rejects.toMatchObject({ code: 'ENGINE_SESSION_REAP_FAILED' });
    expect(f.repository.quarantine).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: 'trace' }), 'ENGINE_SESSION_REAP_FAILED');
    expect(f.repository.release).not.toHaveBeenCalled(); expect(maintenance.pending).toBe(true);
    const original = structuredClone([...f.records.values()][0]);
    await expect(f.create().onPrepared(f.input)).rejects.toMatchObject({ code: 'ENGINE_SESSION_REAP_FAILED' });
    expect(f.traces.create).toHaveBeenCalledOnce(); expect(f.repository.claim).toHaveBeenCalledOnce(); expect([...f.records.values()][0]).toEqual(original);
  });

  it('quarantines an uncertain comparison after the trace lease was positively released', async () => {
    const f = fixture(); f.comparisons.create.mockRejectedValueOnce(new PathFinderError('REVISION_COMPARISON_COMMIT_OUTCOME_UNKNOWN', 503));
    await expect(f.create().onPrepared(f.input)).rejects.toMatchObject({ code: 'REVISION_COMPARISON_COMMIT_OUTCOME_UNKNOWN' });
    expect(f.repository.release).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: 'trace' }));
    expect(f.repository.quarantine).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: 'compare' }), 'REVISION_COMPARISON_COMMIT_OUTCOME_UNKNOWN');
    expect(f.comparisons.decide).not.toHaveBeenCalled();
  });

  it('releases a compare lease when context preflight refuses before any comparison work starts', async () => {
    const f = fixture(); f.comparisons.context.mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_MODEL_CHANGED', 409));
    await expect(f.create().onPrepared(f.input)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_MODEL_CHANGED' });
    expect(f.repository.release).toHaveBeenCalledTimes(2); expect(f.repository.quarantine).not.toHaveBeenCalled(); expect(f.comparisons.create).not.toHaveBeenCalled();
  });

  it('releases known joined trace ownership while retaining unknown dirty-commit outcome', async () => {
    const f = fixture(); f.dirty.mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503));
    await expect(f.create().onPrepared(f.input)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN' });
    expect(f.repository.release).toHaveBeenCalledOnce(); expect(f.repository.quarantine).not.toHaveBeenCalled(); expect(f.comparisons.context).not.toHaveBeenCalled();
    expect([...f.records.values()][0].trace.dirty).toBe(false);
  });

  it('retains an unknown claim owner without inventing an expiry or process join', async () => {
    const f = fixture(); f.repository.claim.mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503));
    const maintenance = f.create(); await expect(maintenance.onPrepared(f.input)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN' });
    const record = [...f.records.values()][0]; expect(record.trace.claim.ownerToken).toMatch(/^[a-f0-9]{64}$/); expect(record.trace.authority).toBeNull();
    expect(f.repository.release).not.toHaveBeenCalled(); expect(f.repository.quarantine).not.toHaveBeenCalled(); expect(f.traces.create).not.toHaveBeenCalled();
  });

  it('retries a positive no-work trace lease contention with its original exact command and owner', async () => {
    const f = fixture(); f.repository.claim.mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_LEASE_BUSY', 409));
    const maintenance = f.create(); await expect(maintenance.onPrepared(f.input)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_LEASE_BUSY' });
    const original = f.repository.claim.mock.calls[0][0]; await maintenance.onPrepared(f.input);
    expect(f.repository.claim.mock.calls[1][0]).toEqual(original); expect(f.traces.create).toHaveBeenCalledOnce();
  });

  it('retries known compare contention without tracing again or replacing its unused compare owner', async () => {
    const f = fixture(), actual = f.repository.claim.getMockImplementation()!; let refused = false;
    f.repository.claim.mockImplementation(async claim => { if (claim.operation === 'compare' && !refused) { refused = true; throw new PathFinderError('CALCULATION_GRANT_LEASE_BUSY', 409); } return actual(claim); });
    const maintenance = f.create(); await expect(maintenance.onPrepared(f.input)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_LEASE_BUSY' });
    const original = f.repository.claim.mock.calls[1][0]; await maintenance.onPrepared(f.input);
    expect(f.repository.claim.mock.calls[2][0]).toEqual(original); expect(f.traces.create).toHaveBeenCalledOnce(); expect(f.comparisons.create).toHaveBeenCalledOnce();
  });

  it('never releases after unknown process join even when quarantine bookkeeping fails', async () => {
    const f = fixture(); f.traces.create.mockRejectedValueOnce(Error('Synthetic unknown trace join.')); f.repository.quarantine.mockRejectedValueOnce(Error('Synthetic unavailable database.'));
    await expect(f.create().onPrepared(f.input)).rejects.toMatchObject({ code: 'PREPARED_MAINTENANCE_CLEANUP_UNKNOWN' });
    expect(f.repository.release).not.toHaveBeenCalled(); expect([...f.records.values()][0].state).toBe('blocked');
  });

  it('requires actual durable receipts, scopes and released dirty trace before accepting a completed checkpoint', async () => {
    const f = fixture(); await f.create().onPrepared(f.input); const complete = [...f.records.values()][0];
    for (const changed of [{ ...complete, trace: { ...complete.trace, dirty: false } }, { ...complete, trace: { ...complete.trace, receipt: null } },
      { ...complete, trace: { ...complete.trace, claim: { ...complete.trace.claim, operation: 'calculate' } } },
      { ...complete, engineeringAccepted: true }]) expect(grantPreparedMaintenanceRecordSchema.safeParse(changed).success).toBe(false);
  });
});
