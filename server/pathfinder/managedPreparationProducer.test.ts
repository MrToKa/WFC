// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculationGrantSchema, CALCULATION_GRANT_OPERATIONS } from '../../shared/pathfinderCalculationGrant.js';
import { calculationGrantProvenance, calculationGrantRecordHash, type CalculationGrantAuthority } from './calculationAuthority.js';
import type { CalculationGrantLeaseClaim } from './calculationGrantRepository.js';
import { managedPreparationOwnerSchema, type ManagedPreparationOwner } from './managedPreparationJournal.js';
import { createManagedPreparationProducer, readManagedPreparationCandidates, type ManagedPreparationCandidate, type ManagedPreparationProducerOptions } from './managedPreparationProducer.js';
import type { ManagedPreparationWorkflowOptions, ManagedPreparationWorkflowResult } from './managedPreparationWorkflow.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { preparationAggregateSchema, preparationContextSchema, preparationPublicationSchema, type PreparationContext } from '../../shared/pathfinderPreparation.js';
import { schedulerTransaction } from './schedulerTransaction.js';
import { equalPreparationScope, readPreparationContext } from './preparationPlans.js';
import { buildGeometryTrace, geometryTraceHash } from './geometryTraceBuilder.js';
import { geometryTraceContentHashInput, type GeometryTraceManifest } from '../../shared/pathfinderGeometryTrace.js';
import { geometryTraceRuntimeFingerprint } from './geometryTraceEngine.js';
import { PathFinderError } from './errors.js';

vi.mock('./schedulerTransaction.js', () => ({ schedulerTransaction: vi.fn() }));
vi.mock('./preparationPlans.js', async original => ({ ...await original<typeof import('./preparationPlans.js')>(), readPreparationContext: vi.fn() }));
vi.mock('./geometryTraceEngine.js', () => ({ geometryTraceRuntimeFingerprint: vi.fn() }));
const id = (number: number) => `d1000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function candidate(number = 1): ManagedPreparationCandidate {
  const grant = calculationGrantSchema.parse({ schemaVersion: 'wfc.pf.calculation-grant.v1', projectId: id(number), id: id(100 + number), grantRevision: '1', grantEpoch: '1',
    installationEpoch: id(200), enabled: true, enabledBy: id(201), issuerAdminRevision: '2', enabledAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z',
    scope: 'active-model', operations: [...CALCULATION_GRANT_OPERATIONS], limitsProfile: 'local-bounded-v1', preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 });
  return { projectId: grant.projectId, grant, model: { modelVersionId: id(number + 1), selectionRevision: '1', contentFingerprint: 'a'.repeat(64) }, sourceSha256: String(number).repeat(64).slice(0, 64), alreadyComplete: false };
}
function fixture(rows = [candidate()]) {
  const events: string[] = [], records = new Map<string, ManagedPreparationOwner>(); let clock = Date.now();
  const flags = { qualified: true, unknownClaim: false, unknownJoin: false, unknownRelease: false, failedWorkflow: false };
  let controlSnapshot = { configured: true, attemptId: null as string | null, quarantined: false, joined: false };
  const client = { query: vi.fn(async () => ({ rows: [] })) } as unknown as PoolClient;
  vi.mocked(schedulerTransaction).mockImplementation(async (_pool, work) => work(client));
  const journal = { list: vi.fn(async () => [...records.values()].map(value => structuredClone(value))),
    save: vi.fn(async (previous: ManagedPreparationOwner | null, value: ManagedPreparationOwner) => {
      const parsed = managedPreparationOwnerSchema.parse(value), prior = records.get(value.id);
      if (previous) expect(prior?.revision).toBe(previous.revision); else expect(prior).toBeUndefined();
      events.push('journal:' + parsed.phase); records.set(parsed.id, structuredClone(parsed)); return parsed;
    }) };
  const repository = {
    claim: vi.fn(async (claim: CalculationGrantLeaseClaim): Promise<CalculationGrantAuthority> => {
      expect([...records.values()].some(value => value.phase === 'claim-intent' && value.claim.ownerToken === claim.ownerToken)).toBe(true);
      events.push('claim'); if (flags.unknownClaim) throw new PathFinderError('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503);
      const grant = rows.find(value => value.projectId === claim.projectId)!.grant;
      return { ...claim, kind: 'calculation-grant', issuerId: grant.enabledBy, issuerAdminRevision: grant.issuerAdminRevision, leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
    }),
    release: vi.fn(async () => { events.push('release'); if (flags.unknownRelease) throw new PathFinderError('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503); }),
    quarantine: vi.fn(async () => { events.push('quarantine'); }),
  };
  const resources = {
    create: vi.fn(async (input: { authority: CalculationGrantAuthority; loadId: string }) => {
      events.push('resource-create'); return { capability: 'A'.repeat(43), session: { sessionId: id(70), projectId: input.authority.projectId,
        modelVersionId: input.authority.modelVersionId, loadId: input.loadId, expiresAt: '2099-01-01T00:00:00.000Z', absoluteExpiresAt: '2099-01-01T00:00:00.000Z' } };
    }), revoke: vi.fn(async () => { events.push('resource-revoke'); }),
  };
  const control: ManagedPreparationProducerOptions['control'] = {
    get configured() { return true; }, get snapshot() { return controlSnapshot; },
    register: vi.fn(async input => {
      events.push('register'); controlSnapshot = { configured: true, attemptId: id(80), quarantined: false, joined: false };
      return { attemptId: id(80), identity: input.identity, exchange: vi.fn(async () => ({})), close: vi.fn(async () => {
        events.push('physical-join'); if (flags.unknownJoin) throw new PathFinderError('MANAGED_PRODUCER_JOIN_UNKNOWN', 503);
        controlSnapshot.joined = true; return { joined: true as const };
      }) };
    }),
  };
  const workflow = vi.fn(async (input: ManagedPreparationWorkflowOptions): Promise<ManagedPreparationWorkflowResult> => {
    events.push('workflow'); if (flags.failedWorkflow) { await input.driver.close(); throw new PathFinderError('MANAGED_PREPARATION_PLAN_UNRESOLVED', 409); }
    const fixture = geometryTraceFixture(), aggregate = { ...fixture.aggregate, schemaVersion: 'wfc.pf.geometry-aggregate.v2' as const,
      projectId: input.authority.projectId, modelVersionId: input.authority.modelVersionId, producerGrant: calculationGrantProvenance(input.authority) };
    const publication = preparationPublicationSchema.parse({ schemaVersion: 'wfc.pf.preparation-publication.v2', sessionId: aggregate.sessionId, aggregate, duplicate: false });
    await input.recorder.save({ schemaVersion: 'wfc.pf.managed-preparation-checkpoint.v1', projectId: input.authority.projectId, grant: calculationGrantProvenance(input.authority),
      model: { modelVersionId: input.authority.modelVersionId, selectionRevision: input.authority.selectionRevision, contentFingerprint: input.authority.contentFingerprint },
      scope: { modelVersionId: aggregate.modelVersionId, contentFingerprint: aggregate.contentFingerprint, selectionRevision: aggregate.selectionRevision,
        catalogRevision: aggregate.catalogRevision, routingContentSha256: aggregate.routingContentSha256, routingPolicyRevision: aggregate.routingPolicyRevision, routingPolicySha256: aggregate.routingPolicySha256,
        locationRegistryRevision: aggregate.locationRegistryRevision, resolutionRevision: aggregate.resolutionRevision }, sessionId: aggregate.sessionId, pending: null, publication });
    await input.driver.close();
    return { status: 'published', producer: { joined: true }, aggregate, sessionId: aggregate.sessionId,
      traceInputs: { aggregateId: aggregate.id, sessionId: aggregate.sessionId, artifactId: aggregate.artifactId, coordinateFrameId: aggregate.coordinateFrameId,
        partIds: aggregate.partReferences.map(part => part.partId) } };
  });
  const readCandidates = vi.fn(async (_pool: Pool, after: string | null) => ({ candidates: rows.filter(value => !after || value.projectId > after).slice(0, 5), nextCursor: null }));
  const onPrepared = vi.fn(async () => { events.push('onPrepared'); });
  const options: ManagedPreparationProducerOptions = { control, resources, preparations: {} as ManagedPreparationProducerOptions['preparations'], traces: {} as ManagedPreparationProducerOptions['traces'],
    repository, journal, workflow, readCandidates, authorize: vi.fn(async () => {}), now: () => clock, onPrepared,
    qualification: { producerStatus: vi.fn(async () => ({ status: flags.qualified ? 'ready' as const : 'unqualified' as const, reasonCode: flags.qualified ? null : 'MANAGED_PRODUCER_UNQUALIFIED' })) } };
  return { options, flags, events, records, repository, resources, control, workflow, readCandidates, onPrepared, journal, client,
    create: (extra: Partial<ManagedPreparationProducerOptions> = {}) => createManagedPreparationProducer({} as Pool, { ...options, ...extra }),
    advance: (milliseconds: number) => { clock += milliseconds; } };
}
beforeEach(() => vi.clearAllMocks());

describe('separate preparation grant producer with injected transports only', () => {
  it('persists owner before claim and emits prepared only after physical join, resource revocation and confirmed release', async () => {
    const f = fixture(), producer = f.create(); await producer.tick();
    expect(f.workflow).toHaveBeenCalledTimes(1); expect(f.onPrepared).toHaveBeenCalledTimes(1);
    expect(f.events.indexOf('journal:claim-intent')).toBeLessThan(f.events.indexOf('claim'));
    expect(f.events.indexOf('physical-join')).toBeLessThan(f.events.indexOf('resource-revoke'));
    expect(f.events.indexOf('resource-revoke')).toBeLessThan(f.events.indexOf('release')); expect(f.events.indexOf('release')).toBeLessThan(f.events.indexOf('onPrepared'));
    const record = [...f.records.values()][0]; expect(record).toMatchObject({ joined: true, resourceRevoked: true, leaseReleased: true, notified: true });
    expect(record).not.toHaveProperty('capability'); expect(JSON.stringify(record)).not.toContain('A'.repeat(43));
    await producer.stop();
  });
  it('never turns configured transport into qualification and limits explicit qualification mode to one project', async () => {
    const rows = [candidate(1), candidate(2)], f = fixture(rows); f.flags.qualified = false;
    const producer = f.create({ qualification: { ...f.options.qualification, canQualifyProject: rows[1].projectId } }); await producer.tick();
    expect(f.repository.claim).toHaveBeenCalledTimes(1); expect(f.repository.claim.mock.calls[0][0].projectId).toBe(rows[1].projectId);
    expect(await f.options.qualification.producerStatus(f.client, { projectId: rows[0].projectId, installationEpoch: rows[0].grant.installationEpoch })).toMatchObject({ status: 'unqualified' });
    await producer.stop();
  });
  it('retains unknown claim ownership and blocks unchanged replacement without relying on lease expiry', async () => {
    const f = fixture(); f.flags.unknownClaim = true; const producer = f.create(); await producer.tick();
    expect([...f.records.values()][0]).toMatchObject({ phase: 'quarantined', authority: null, leaseReleased: false });
    const owner = [...f.records.values()][0].claim.ownerToken; f.advance(31 * 60000); await producer.tick();
    expect(f.repository.claim).toHaveBeenCalledTimes(1); expect([...f.records.values()][0].claim.ownerToken).toBe(owner);
    expect(f.repository.release).not.toHaveBeenCalled(); expect(producer.snapshot.phase).toBe('quarantined'); await producer.stop();
  });
  it('quarantines a nonjoined helper and never releases or emits its result', async () => {
    const f = fixture(); f.flags.unknownJoin = true; const producer = f.create(); await producer.tick();
    expect(f.repository.quarantine).toHaveBeenCalledTimes(1); expect(f.repository.release).not.toHaveBeenCalled(); expect(f.onPrepared).not.toHaveBeenCalled();
    expect([...f.records.values()][0]).toMatchObject({ phase: 'quarantined', joined: false, leaseReleased: false }); await producer.stop();
  });
  it.each([true, false])('retains the prepare lease for an unjoined .NET engine independently of browser join=%s', async browserJoined => {
    const f = fixture(); f.flags.unknownJoin = !browserJoined;
    f.workflow.mockImplementation(async input => {
      await input.driver.close().catch(() => undefined);
      throw new PathFinderError('ENGINE_SESSION_REAP_FAILED', 502);
    });
    const producer = f.create(); await producer.tick(); const record = [...f.records.values()][0];
    expect(record).toMatchObject({ phase: 'quarantined', joined: browserJoined, resourceRevoked: true, leaseReleased: false, notified: false, reasonCode: 'ENGINE_SESSION_REAP_FAILED' });
    expect(f.repository.quarantine).toHaveBeenCalledWith(record.authority, 'ENGINE_SESSION_REAP_FAILED');
    expect(f.resources.revoke).toHaveBeenCalledTimes(1); expect(f.repository.release).not.toHaveBeenCalled(); expect(f.onPrepared).not.toHaveBeenCalled();
    expect(producer.snapshot).toMatchObject({ phase: 'quarantined', lastCode: 'ENGINE_SESSION_REAP_FAILED' });
    const owner = record.claim.ownerToken; f.advance(31 * 60000); await producer.tick();
    expect(f.repository.claim).toHaveBeenCalledTimes(1); expect([...f.records.values()][0].claim.ownerToken).toBe(owner); await producer.stop();
  });
  it('retains a missing release acknowledgement and suppresses callback/replacement', async () => {
    const f = fixture(); f.flags.unknownRelease = true; const producer = f.create(); await producer.tick();
    expect([...f.records.values()][0]).toMatchObject({ phase: 'release-intent', joined: true, resourceRevoked: true, leaseReleased: false });
    expect(f.onPrepared).not.toHaveBeenCalled(); f.advance(31000); await producer.tick(); expect(f.repository.claim).toHaveBeenCalledTimes(1); await producer.stop();
  });
  it('can clean a refused workflow with an actual positive join while retaining its blocked source', async () => {
    const f = fixture(); f.flags.failedWorkflow = true; const producer = f.create(); await producer.tick();
    expect(f.repository.release).toHaveBeenCalledTimes(1); expect(f.repository.quarantine).not.toHaveBeenCalled(); expect(f.onPrepared).not.toHaveBeenCalled();
    expect([...f.records.values()][0]).toMatchObject({ phase: 'blocked', leaseReleased: true, reasonCode: 'MANAGED_PREPARATION_PLAN_UNRESOLVED' });
    f.advance(31000); await producer.tick(); expect(f.workflow).toHaveBeenCalledTimes(1); await producer.stop();
  });
  it('current completed aggregates are skipped and serialized ticks use the stable processed-project cursor', async () => {
    const rows = [candidate(1), candidate(2), candidate(3)], f = fixture(rows); rows[0].alreadyComplete = true;
    const producer = f.create(); await Promise.all([producer.tick(), producer.tick()]);
    expect(f.workflow).toHaveBeenCalledTimes(1); expect(f.repository.claim.mock.calls[0][0].projectId).toBe(rows[1].projectId);
    await producer.tick(); expect(f.readCandidates.mock.calls[1][1]).toBe(rows[1].projectId); expect(f.repository.claim.mock.calls[1][0].projectId).toBe(rows[2].projectId); await producer.stop();
  });
  it.each(['CALCULATION_GRANT_LEASE_BUSY', 'SCHEDULER_DATABASE_BUSY'])('retries a definite %s callback refusal after 30 seconds without preparing again', async code => {
    const rows = [candidate()], f = fixture(rows), onPrepared = vi.fn<NonNullable<ManagedPreparationProducerOptions['onPrepared']>>()
      .mockRejectedValueOnce(new PathFinderError(code, 503)).mockResolvedValue(undefined);
    f.readCandidates.mockImplementation(async () => ({ candidates: rows, nextCursor: null }));
    const producer = f.create({ onPrepared }); await producer.tick();
    const first = [...f.records.values()][0], callback = onPrepared.mock.calls[0][0];
    expect(first).toMatchObject({ phase: 'released', notified: false, leaseReleased: true, joined: true, resourceRevoked: true, reasonCode: code });
    expect(producer.snapshot).toMatchObject({ phase: 'waiting', lastCode: code });
    expect(producer.snapshot.retryAt).toBe(f.options.now!() + 30000);
    rows[0].alreadyComplete = true; rows[0].currentAggregateId = first.checkpoint!.publication!.aggregate.id;
    await producer.tick(); f.advance(29999); await producer.tick(); expect(onPrepared).toHaveBeenCalledTimes(1);
    f.advance(1); await producer.tick();
    expect(onPrepared).toHaveBeenCalledTimes(2); expect(onPrepared.mock.calls[1][0].result).toEqual(callback.result);
    expect(f.workflow).toHaveBeenCalledTimes(1); expect(f.repository.claim).toHaveBeenCalledTimes(1); expect(f.resources.create).toHaveBeenCalledTimes(1);
    expect([...f.records.values()][0]).toMatchObject({ id: first.id, claim: first.claim, phase: 'released', notified: true, reasonCode: null });
    await producer.stop();
  });
  it.each([
    Object.assign(new PathFinderError('CALCULATION_GRANT_LEASE_BUSY', 503), { outcome: 'unknown' }),
    Object.assign(new Error('synthetic private transport failure'), { code: 'CALCULATION_GRANT_LEASE_BUSY' }),
    new PathFinderError('CALCULATION_GRANT_COMMIT_OUTCOME_UNKNOWN', 503),
    new Error('synthetic private callback outcome'),
  ])('keeps an unknown or unclassified callback outcome blocked and never automatically invokes it again', async error => {
    const rows = [candidate()], f = fixture(rows), onPrepared = vi.fn<NonNullable<ManagedPreparationProducerOptions['onPrepared']>>().mockRejectedValue(error);
    f.readCandidates.mockImplementation(async () => ({ candidates: rows, nextCursor: null }));
    const producer = f.create({ onPrepared }); await producer.tick();
    const record = [...f.records.values()][0];
    expect(record).toMatchObject({ phase: 'blocked', leaseReleased: true, notified: false, reasonCode: 'MANAGED_PREPARATION_CALLBACK_UNKNOWN' });
    rows[0].alreadyComplete = true; rows[0].currentAggregateId = record.checkpoint!.publication!.aggregate.id;
    f.advance(31000); await producer.tick(); await producer.tick();
    expect(onPrepared).toHaveBeenCalledTimes(1); expect(f.workflow).toHaveBeenCalledTimes(1); expect(f.repository.claim).toHaveBeenCalledTimes(1);
    await producer.stop();
  });
  it('records callback uncertainty before invocation and preserves it when recording successful notification fails', async () => {
    const rows = [candidate()], f = fixture(rows), originalSave = f.journal.save.getMockImplementation()!;
    f.journal.save.mockImplementation(async (previous, next) => {
      if (next.notified) throw new Error('synthetic journal acknowledgement failure');
      return originalSave(previous, next);
    });
    const onPrepared = vi.fn<NonNullable<ManagedPreparationProducerOptions['onPrepared']>>(async () => {
      expect([...f.records.values()][0]).toMatchObject({ phase: 'blocked', notified: false, reasonCode: 'MANAGED_PREPARATION_CALLBACK_UNKNOWN' });
    });
    f.readCandidates.mockImplementation(async () => ({ candidates: rows, nextCursor: null }));
    const producer = f.create({ onPrepared }); await producer.tick(); const record = [...f.records.values()][0];
    expect(record).toMatchObject({ phase: 'blocked', leaseReleased: true, notified: false, reasonCode: 'MANAGED_PREPARATION_CALLBACK_UNKNOWN' });
    rows[0].alreadyComplete = true; rows[0].currentAggregateId = record.checkpoint!.publication!.aggregate.id;
    f.advance(31000); await producer.tick(); expect(onPrepared).toHaveBeenCalledTimes(1); await producer.stop();
  });
  it('does not start another project during a recovered BUSY callback tick', async () => {
    const rows = [candidate(1), candidate(2)], f = fixture(rows), onPrepared = vi.fn<NonNullable<ManagedPreparationProducerOptions['onPrepared']>>().mockResolvedValue(undefined);
    f.readCandidates.mockImplementation(async () => ({ candidates: rows, nextCursor: null }));
    const producer = f.create({ onPrepared }); await producer.tick();
    const record = [...f.records.values()][0];
    // A fresh process can find a safely released publication whose definite
    // pre-claim callback refusal still needs the original maintenance command.
    f.records.set(record.id, { ...record, notified: false, reasonCode: 'CALCULATION_GRANT_LEASE_BUSY' });
    rows[0].alreadyComplete = true; rows[0].currentAggregateId = record.checkpoint!.publication!.aggregate.id;
    onPrepared.mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_LEASE_BUSY', 409));
    await producer.tick();
    expect(f.repository.claim).toHaveBeenCalledTimes(1); expect(onPrepared).toHaveBeenCalledTimes(2);
    expect(producer.snapshot).toMatchObject({ phase: 'waiting', cursor: rows[0].projectId, lastCode: 'CALCULATION_GRANT_LEASE_BUSY' });
    await producer.tick(); expect(f.repository.claim).toHaveBeenCalledTimes(1); await producer.stop();
  });
  it('waits on an occupied global lease without creating owner intents or scanning more projects', async () => {
    const f = fixture([candidate(1), candidate(2)]), producer = f.create(), query = vi.mocked(f.client.query);
    query.mockResolvedValueOnce({ rows: [{ id: id(90), state: 'active' }] } as never);
    await producer.tick();
    expect(producer.snapshot).toMatchObject({ phase: 'waiting', lastCode: 'CALCULATION_GRANT_LEASE_BUSY' });
    expect(f.readCandidates).not.toHaveBeenCalled(); expect(f.journal.save).not.toHaveBeenCalled(); expect(f.repository.claim).not.toHaveBeenCalled();
    await producer.tick(); expect(query).toHaveBeenCalledTimes(1);
    f.advance(30000); await producer.tick(); expect(f.repository.claim).toHaveBeenCalledTimes(1);
    await producer.stop();
  });
  it('passes cancellation into maintenance and waits for the known callback before stop completes', async () => {
    const f = fixture(); let started!: () => void, finished = false;
    const callbackStarted = new Promise<void>(resolve => { started = resolve; });
    const onPrepared = vi.fn<NonNullable<ManagedPreparationProducerOptions['onPrepared']>>(async (_value, signal) => {
      expect(signal).toBeInstanceOf(AbortSignal); started();
      await new Promise<void>(resolve => signal!.addEventListener('abort', () => resolve(), { once: true }));
      finished = true; throw new PathFinderError('MANAGED_PREPARATION_CANCELLED', 503);
    });
    const producer = f.create({ onPrepared }), ticking = producer.tick(); await callbackStarted;
    expect(finished).toBe(false); await producer.stop(); await ticking;
    expect(finished).toBe(true); expect([...f.records.values()][0]).toMatchObject({ phase: 'blocked', leaseReleased: true, notified: false, reasonCode: 'MANAGED_PREPARATION_CALLBACK_UNKNOWN' });
    expect(producer.snapshot.phase).toBe('stopped');
  });
});

describe('bounded independent preparation candidate query (mock SQL only)', () => {
  it('does not depend on desired/enrolled or cable readiness and applies issuer/install/model/current grant gates', async () => {
    const f = fixture(), value = candidate(), context = { schemaVersion: 'wfc.pf.preparation-context.v1' as const, projectId: value.projectId,
      scope: { modelVersionId: value.model.modelVersionId, contentFingerprint: value.model.contentFingerprint, selectionRevision: value.model.selectionRevision, catalogRevision: '1',
        routingContentSha256: 'b'.repeat(64), routingPolicyRevision: '1', routingPolicySha256: 'c'.repeat(64), locationRegistryRevision: '1', resolutionRevision: '0' },
      trays: [], endpointNames: [], resolutions: [], diagnostics: [], currentAggregate: null };
    vi.mocked(readPreparationContext).mockResolvedValue(context);
    const query = vi.mocked(f.client.query);
    query.mockResolvedValueOnce({ rows: [{ project_id: value.projectId, id: value.grant.id, grant_revision: value.grant.grantRevision, grant_epoch: value.grant.grantEpoch,
      installation_epoch: value.grant.installationEpoch, issuer_id: value.grant.enabledBy, issuer_admin_revision: value.grant.issuerAdminRevision,
      record: value.grant, record_sha256: calculationGrantRecordHash(value.grant), active_model_version_id: value.model.modelVersionId, selection_revision: value.model.selectionRevision, content_fingerprint: value.model.contentFingerprint }] } as never);
    const page = await readManagedPreparationCandidates({} as Pool, id(0)); expect(page.candidates).toHaveLength(1);
    const sql = query.mock.calls[0][0] as string; expect(sql).toContain('LIMIT 5'); expect(sql).toContain('u.is_admin'); expect(sql).toContain('pf_installation_state');
    expect(sql).toContain("m.state='ready'"); expect(sql).not.toContain('desired_generation'); expect(sql).not.toContain('enrolled'); expect(sql).not.toContain('pf_jobs');
    expect(query.mock.calls[0][1]).toEqual([id(0)]);
  });
});

describe('already published preparation reuse after binding-only registry changes (mock SQL only)', () => {
  function publishedFixture() {
    const f = fixture(), value = candidate(), geometry = geometryTraceFixture(), plan = geometry.plan;
    const aggregate = preparationAggregateSchema.parse({ ...geometry.aggregate, schemaVersion: 'wfc.pf.geometry-aggregate.v2',
      producerGrant: { kind: 'calculation-grant', projectId: value.projectId, grantId: value.grant.id, grantRevision: value.grant.grantRevision,
        grantEpoch: value.grant.grantEpoch, installationEpoch: value.grant.installationEpoch, issuerId: value.grant.enabledBy, issuerAdminRevision: value.grant.issuerAdminRevision },
      engineVersion: 'pathfinder-45c24bf5-pf1-modelrunner-v1', locationRegistryRevision: '5' });
    const context: PreparationContext = preparationContextSchema.parse({ schemaVersion: 'wfc.pf.preparation-context.v2', projectId: value.projectId,
      scope: { modelVersionId: plan.modelVersionId, contentFingerprint: plan.contentFingerprint, selectionRevision: plan.selectionRevision,
        catalogRevision: plan.catalogRevision, routingContentSha256: plan.routingContentSha256, routingPolicyRevision: plan.routingPolicyRevision,
        routingPolicySha256: plan.routingPolicySha256, locationRegistryRevision: '8', resolutionRevision: plan.resolutionRevision },
      trays: plan.requestedScope.trays.map(({ projectTrayId, rawName, routeName, purposeKey, allowedCategories }) =>
        ({ projectTrayId, rawName, routeName, purposeKey, allowedCategories, policyState: 'configured', diagnosticCodes: [] })),
      endpointNames: plan.requestedScope.endpointNames, resolutions: [], diagnostics: [], currentAggregate: aggregate });
    const trace = buildGeometryTrace({ ...geometry, aggregate }).manifest;
    const state: { plan: unknown; trace: { id: string; manifest: GeometryTraceManifest } | null } = { plan, trace: { id: trace.id, manifest: trace } };
    vi.mocked(readPreparationContext).mockImplementation(async () => context);
    vi.mocked(geometryTraceRuntimeFingerprint).mockResolvedValue(geometry.runtimeFingerprint);
    vi.mocked(f.client.query).mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM pf_calculation_grant_heads')) return { rows: [{ project_id: value.projectId, id: value.grant.id,
        grant_revision: value.grant.grantRevision, grant_epoch: value.grant.grantEpoch, installation_epoch: value.grant.installationEpoch,
        issuer_id: value.grant.enabledBy, issuer_admin_revision: value.grant.issuerAdminRevision, record: value.grant,
        record_sha256: calculationGrantRecordHash(value.grant), active_model_version_id: context.scope.modelVersionId,
        selection_revision: context.scope.selectionRevision, content_fingerprint: context.scope.contentFingerprint }] } as never;
      if (text.includes('SELECT plan FROM pf_preparation_sessions')) return { rows: [{ plan: state.plan }] } as never;
      if (text.includes('FROM pf_geometry_trace_sets')) return { rows: state.trace ? [state.trace] : [] } as never;
      return { rows: [] } as never;
    });
    const read = async () => (await readManagedPreparationCandidates({} as Pool, null)).candidates;
    return { ...f, value, context, aggregate, plan, trace, state, geometry, read };
  }
  const rehash = (trace: GeometryTraceManifest) => { trace.contentSha256 = geometryTraceHash(geometryTraceContentHashInput(trace)); };

  it('reuses the exact published projection after registry-only advances without rewriting original source provenance or granting acceptance', async () => {
    const f = publishedFixture(), originalAggregate = structuredClone(f.aggregate), originalPlan = structuredClone(f.plan);
    expect(equalPreparationScope(f.aggregate, f.context.scope)).toBe(false);
    expect((await f.read())[0]).toMatchObject({ alreadyComplete: true, currentAggregateId: f.aggregate.id });
    f.context.scope.locationRegistryRevision = '9';
    expect((await f.read())[0].alreadyComplete).toBe(true);
    expect(geometryTraceRuntimeFingerprint).toHaveBeenCalledTimes(2);
    expect(f.aggregate).toEqual(originalAggregate); expect(f.plan).toEqual(originalPlan);
    expect(f.aggregate).toMatchObject({ sourceLocationRegistryRevision: '4', locationRegistryRevision: '5', engineeringAccepted: false, nativeParity: 'not-performed' });
    expect(f.trace.qualifiedProjectFrame).toBeNull();
    // New capture/publication admission continues to use the shared strict scope comparison.
    expect(equalPreparationScope(f.plan, f.context.scope)).toBe(false);
  });
  it('never claims another prepare lease or launches a browser for a completed binding-only update', async () => {
    const f = publishedFixture(), producer = f.create({ readCandidates: readManagedPreparationCandidates });
    await producer.tick(); f.context.scope.locationRegistryRevision = '9'; await producer.tick();
    expect(f.repository.claim).not.toHaveBeenCalled(); expect(f.resources.create).not.toHaveBeenCalled();
    expect(f.control.register).not.toHaveBeenCalled(); expect(f.workflow).not.toHaveBeenCalled(); expect(f.journal.save).not.toHaveBeenCalled();
    await producer.stop();
  });
  it.each([
    ['modelVersionId', id(600)], ['contentFingerprint', '6'.repeat(64)], ['selectionRevision', '2'], ['catalogRevision', '3'],
    ['routingContentSha256', '6'.repeat(64)], ['routingPolicyRevision', '4'], ['routingPolicySha256', '6'.repeat(64)], ['resolutionRevision', '1'],
  ] as const)('requires a fresh capture when the material scope %s changes', async (field, next) => {
    const f = publishedFixture(); f.context.scope[field] = next;
    expect((await f.read())[0].alreadyComplete).toBe(false);
    expect(geometryTraceRuntimeFingerprint).not.toHaveBeenCalled();
  });
  it.each(['rename', 'additional-endpoint'] as const)('requires a fresh capture for a changed cable endpoint name set: %s', async change => {
    const f = publishedFixture(); f.context.endpointNames = change === 'rename' ? ['EQ02'] : ['EQ01', 'EQ02'];
    expect((await f.read())[0].alreadyComplete).toBe(false);
    expect(geometryTraceRuntimeFingerprint).not.toHaveBeenCalled();
  });
  it.each(['rawName', 'purposeKey', 'routeName', 'allowedCategories', 'invalid', 'missing-tray'] as const)
    ('does not hide material tray input drift even if a caller presents unchanged scope hashes: %s', async field => {
      const f = publishedFixture(), tray = f.context.trays[0];
      if (field === 'rawName') tray.rawName = 'B099';
      else if (field === 'purposeKey') tray.purposeKey = 'LV';
      else if (field === 'routeName') tray.routeName = '/B099';
      else if (field === 'allowedCategories') tray.allowedCategories = ['LV'];
      else if (field === 'invalid') { tray.policyState = 'invalid'; tray.diagnosticCodes = ['ROUTE_CODE_COLLISION']; }
      else f.context.trays.pop();
      expect((await f.read())[0].alreadyComplete).toBe(false);
    });
  it('fails closed when registry revision rolls back or frozen source registry provenance differs', async () => {
    const f = publishedFixture(); f.context.scope.locationRegistryRevision = '3';
    expect((await f.read())[0].alreadyComplete).toBe(false);
    f.context.scope.locationRegistryRevision = '8'; f.aggregate.sourceLocationRegistryRevision = '3';
    // The parsed context owns its own aggregate instance; change the actual reader input.
    f.context.currentAggregate!.sourceLocationRegistryRevision = '3';
    expect((await f.read())[0].alreadyComplete).toBe(false);
  });
  it('requires the immutable plan itself to retain its verified content hash', async () => {
    const f = publishedFixture(); f.plan.objectOrder.reverse();
    expect((await f.read())[0].alreadyComplete).toBe(false);
  });
  it.each(['missing', 'content-hash', 'projection', 'frame', 'geometry-revision', 'row-id'] as const)
    ('does not relax registry equality without exact stored trace proof: %s', async change => {
      const f = publishedFixture();
      if (change === 'missing') f.state.trace = null;
      else if (change === 'content-hash') f.trace.contentSha256 = '0'.repeat(64);
      else if (change === 'row-id') f.state.trace!.id = id(700);
      else {
        if (change === 'projection') f.trace.projection.sha256 = '6'.repeat(64);
        else if (change === 'frame') f.trace.captureFrameId = id(700);
        else f.trace.geometryRevision = '2';
        rehash(f.trace);
      }
      expect((await f.read())[0].alreadyComplete).toBe(false);
      expect(geometryTraceRuntimeFingerprint).not.toHaveBeenCalled();
    });
  it('requires the actual executable and derivation fingerprint to remain identical', async () => {
    const f = publishedFixture(); vi.mocked(geometryTraceRuntimeFingerprint).mockResolvedValue({ ...f.geometry.runtimeFingerprint, coreModuleSha256: '6'.repeat(64) });
    expect((await f.read())[0].alreadyComplete).toBe(false);
    vi.mocked(geometryTraceRuntimeFingerprint).mockResolvedValue({ ...f.geometry.runtimeFingerprint, derivationSha256: '6'.repeat(64) });
    expect((await f.read())[0].alreadyComplete).toBe(false);
    vi.mocked(geometryTraceRuntimeFingerprint).mockRejectedValue(new PathFinderError('GEOMETRY_TRACE_ENGINE_NOT_CONFIGURED', 503));
    expect((await f.read())[0].alreadyComplete).toBe(false);
  });
});
