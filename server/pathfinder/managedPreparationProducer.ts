import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool, PoolClient } from 'pg';
import { canonicalPurposeJson, policyHashSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { calculationGrantProducerStatusSchema, type CalculationGrant, type CalculationGrantProducerStatus } from '../../shared/pathfinderCalculationGrant.js';
import { preparationPlanSchema, preparationPlanHashInput, type PreparationAggregate, type PreparationContext, type PreparationPlan } from '../../shared/pathfinderPreparation.js';
import { geometryTraceManifestSchema, geometryTraceContentHashInput } from '../../shared/pathfinderGeometryTrace.js';
import { createCalculationGrantRepository, newCalculationGrantLeaseOwner, type CalculationGrantRepository } from './calculationGrantRepository.js';
import { validateCalculationGrantRecord, calculationGrantProvenance, grantTransaction, type CalculationGrantAuthority } from './calculationAuthority.js';
import { grantOperationPrincipal } from './operationAuthority.js';
import { schedulerTransaction } from './schedulerTransaction.js';
import { readPreparationContext, equalPreparationScope, preparationFrameId } from './preparationPlans.js';
import { geometryTraceRuntimeFingerprint } from './geometryTraceEngine.js';
import { createManagedCaptureDriver } from './managedCaptureDriver.js';
import type { ManagedProducerControl } from './managedProducerControl.js';
import type { ProducerResourceService, ProducerResourceIdentity } from './producerResourceService.js';
import type { PreparationService } from './preparationSessions.js';
import type { GeometryTraceRepository } from './geometryTraceRepository.js';
import { runManagedPreparationWorkflow, type ManagedPreparationWorkflowOptions, type ManagedPreparationWorkflowResult } from './managedPreparationWorkflow.js';
import { createManagedPreparationJournal, type ManagedPreparationJournal, type ManagedPreparationOwner } from './managedPreparationJournal.js';
import { PathFinderError } from './errors.js';

export const MANAGED_PREPARATION_PRODUCER_LIMITS = Object.freeze({ projectsPerTick: 5, failureBackoffMilliseconds: 30000, trackedProjects: 4096 });
const sha = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const same = (left: unknown, right: unknown) => canonicalPurposeJson(left) === canonicalPurposeJson(right);
const codeOf = (error: unknown) => typeof (error as { code?: unknown })?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test((error as { code: string }).code)
  ? (error as { code: string }).code : 'MANAGED_PREPARATION_PRODUCER_FAILED';
const fail = (code: string): never => { throw new PathFinderError(code, 503); };
const retryableAdmission = new Set(['CALCULATION_GRANT_LEASE_BUSY', 'CALCULATION_GRANT_DATABASE_BUSY', 'SCHEDULER_DATABASE_BUSY', 'MANAGED_PRODUCER_BUSY']);
// These are the maintenance adapter's definite pre-claim refusals. Other
// failures may follow an invoked durable command and must not replay it.
const retryableCallback = new Set(['CALCULATION_GRANT_LEASE_BUSY', 'SCHEDULER_DATABASE_BUSY']);
const knownCallbackRefusal = (error: unknown) => error instanceof PathFinderError &&
  (error as PathFinderError & { outcome?: unknown }).outcome !== 'unknown' && retryableCallback.has(error.code);
export type ManagedPreparationCandidate = { projectId: string; grant: CalculationGrant;
  model: { modelVersionId: string; selectionRevision: string; contentFingerprint: string }; sourceSha256: string; alreadyComplete: boolean; currentAggregateId?: string | null };
export type ManagedPreparationCandidates = { candidates: ManagedPreparationCandidate[]; nextCursor: string | null; blocked?: { projectId: string; code: string }[] };

/** Reusing an already published projection is not a new capture admission. The
 * original full plan/registry provenance remains immutable; binding-only registry
 * changes are irrelevant only when every actual capture input is still exact. */
function completedCaptureInputsMatch(context: PreparationContext, aggregate: PreparationAggregate, plan: PreparationPlan): boolean {
  if (plan.projectId !== context.projectId || plan.id !== aggregate.sessionId || plan.coordinateFrameId !== aggregate.coordinateFrameId ||
    aggregate.coordinateFrameId !== preparationFrameId(context.projectId, context.scope.modelVersionId, context.scope.contentFingerprint) ||
    aggregate.engineVersion !== 'pathfinder-45c24bf5-pf1-modelrunner-v1' || aggregate.rulesVersion !== 'pf2.rules.v1/wfc-mto-v1' ||
    aggregate.sourceLocationRegistryRevision !== plan.locationRegistryRevision || aggregate.orderedPlanSha256 !== plan.orderedPlanSha256 ||
    sha(preparationPlanHashInput(plan)) !== plan.orderedPlanSha256 || aggregate.orderedScopeSha256 !== plan.requestedScope.scopeSha256 ||
    !equalPreparationScope(plan, { ...aggregate, locationRegistryRevision: plan.locationRegistryRevision }) ||
    !same(plan.requestedScope.endpointNames, context.endpointNames) ||
    !same(aggregate.partReferences.map(part => ({ partId: part.partId, partIndex: part.partIndex })), plan.partPlan.map(part => ({ partId: part.partId, partIndex: part.partIndex })))) return false;
  const captured = new Map(plan.requestedScope.trays.map(tray => [tray.projectTrayId, tray])), excluded = new Set(plan.requestedScope.excludedProjectTrayIds);
  if (captured.size + excluded.size !== context.trays.length || new Set(context.trays.map(tray => tray.projectTrayId)).size !== context.trays.length) return false;
  return context.trays.every(tray => {
    if (excluded.has(tray.projectTrayId)) return !captured.has(tray.projectTrayId);
    const old = captured.get(tray.projectTrayId);
    return old !== undefined && tray.policyState === 'configured' && tray.diagnosticCodes.length === 0 &&
      same({ rawName: old.rawName, purposeKey: old.purposeKey, routeName: old.routeName, allowedCategories: old.allowedCategories },
        { rawName: tray.rawName, purposeKey: tray.purposeKey, routeName: tray.routeName, allowedCategories: tray.allowedCategories });
  });
}

async function publishedImplementationStillCurrent(client: PoolClient, projectId: string, aggregate: PreparationAggregate): Promise<boolean> {
  const row = (await client.query<{ id: string; manifest: unknown }>(`SELECT id,manifest FROM pf_geometry_trace_sets
    WHERE project_id=$1 AND aggregate_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`, [projectId, aggregate.id])).rows[0];
  if (!row) return false;
  const parsed = geometryTraceManifestSchema.safeParse(row.manifest); if (!parsed.success) return false;
  const trace = parsed.data;
  if (trace.id !== row.id || trace.projectId !== projectId || trace.aggregateId !== aggregate.id || trace.modelVersionId !== aggregate.modelVersionId ||
    trace.geometryRevision !== aggregate.geometryRevision || trace.sessionId !== aggregate.sessionId || trace.captureFrameId !== aggregate.coordinateFrameId ||
    !same(trace.projection, { payloadRef: aggregate.projection.payloadRef, sha256: aggregate.projection.sha256, bytes: aggregate.projection.bytes }) ||
    sha(geometryTraceContentHashInput(trace)) !== trace.contentSha256) return false;
  // This proves only the recorded computational implementation/projection is
  // current. It grants no native, engineering or project-frame qualification.
  try { return same(trace.runtimeFingerprint, await geometryTraceRuntimeFingerprint()); }
  catch (error) { if (error instanceof PathFinderError) return false; throw error; }
}

/** Independent of calculate desired/enrolled ledgers: a project with only
 * blocked calculation items can still acquire its first complete preparation. */
export async function readManagedPreparationCandidates(pool: Pool, afterProjectId: string | null, signal?: AbortSignal): Promise<ManagedPreparationCandidates> {
  if (afterProjectId !== null) policyUuidSchema.parse(afterProjectId);
  return schedulerTransaction(pool, async client => {
    const rows = (await client.query<Record<string, any>>(`SELECT r.project_id,r.id,r.grant_revision::text,r.grant_epoch::text,r.installation_epoch,
      r.issuer_id,r.issuer_admin_revision::text,r.record_sha256,r.record,
      s.active_model_version_id,s.selection_revision::text,m.content_fingerprint
      FROM pf_calculation_grant_heads h JOIN pf_calculation_grant_revisions r ON r.project_id=h.project_id AND r.id=h.grant_id
        AND r.grant_revision=h.control_revision AND r.grant_epoch=h.grant_epoch
      JOIN users u ON u.id=r.issuer_id AND u.is_admin AND u.pf_admin_revision=r.issuer_admin_revision
      JOIN pf_installation_state i ON i.singleton=true AND i.installation_epoch=r.installation_epoch
      JOIN project_model_selections s ON s.project_id=r.project_id JOIN model_versions m ON m.project_id=s.project_id AND m.id=s.active_model_version_id
      WHERE r.record->>'enabled'='true' AND m.state='ready' AND m.health='healthy' AND ($1::uuid IS NULL OR r.project_id>$1::uuid)
      ORDER BY r.project_id LIMIT 5`, [afterProjectId])).rows;
    const candidates: ManagedPreparationCandidate[] = [], blocked: { projectId: string; code: string }[] = [];
    for (const row of rows) {
      signal?.throwIfAborted();
      const grant = validateCalculationGrantRecord(row as Parameters<typeof validateCalculationGrantRecord>[0]);
      if (!grant.enabled) continue;
      let context;
      try { context = await readPreparationContext(client, grant.projectId); }
      catch (error) { if (!(error instanceof PathFinderError)) throw error; blocked.push({ projectId: grant.projectId, code: codeOf(error) }); continue; }
      const model = { modelVersionId: policyUuidSchema.parse(row.active_model_version_id), selectionRevision: String(row.selection_revision), contentFingerprint: policyHashSchema.parse(row.content_fingerprint) };
      if (context.scope.modelVersionId !== model.modelVersionId || context.scope.selectionRevision !== model.selectionRevision || context.scope.contentFingerprint !== model.contentFingerprint) continue;
      let alreadyComplete = false;
      const aggregate = context.currentAggregate;
      if (aggregate?.schemaVersion === 'wfc.pf.geometry-aggregate.v2' && same(aggregate.producerGrant, { kind: 'calculation-grant', projectId: grant.projectId,
        grantId: grant.id, grantRevision: grant.grantRevision, grantEpoch: grant.grantEpoch, installationEpoch: grant.installationEpoch, issuerId: grant.enabledBy, issuerAdminRevision: grant.issuerAdminRevision }) &&
        equalPreparationScope(aggregate, { ...context.scope, locationRegistryRevision: aggregate.locationRegistryRevision }) &&
        BigInt(context.scope.locationRegistryRevision) >= BigInt(aggregate.locationRegistryRevision)) {
        const stored = (await client.query<{ plan: unknown }>('SELECT plan FROM pf_preparation_sessions WHERE project_id=$1 AND id=$2', [grant.projectId, aggregate.sessionId])).rows[0];
        const plan = preparationPlanSchema.safeParse(stored?.plan);
        if (plan.success && completedCaptureInputsMatch(context, aggregate, plan.data)) {
          alreadyComplete = equalPreparationScope(aggregate, context.scope) || await publishedImplementationStillCurrent(client, grant.projectId, aggregate);
        }
      }
      candidates.push({ projectId: grant.projectId, grant, model, alreadyComplete, currentAggregateId: context.currentAggregate?.id ?? null,
        sourceSha256: sha({ schemaVersion: 'wfc.pf.managed-preparation-source.v1', grant: { id: grant.id, revision: grant.grantRevision, epoch: grant.grantEpoch,
          installation: grant.installationEpoch, issuerRevision: grant.issuerAdminRevision }, scope: context.scope, endpointNames: context.endpointNames }) });
    }
    return { candidates, blocked, nextCursor: rows.length === MANAGED_PREPARATION_PRODUCER_LIMITS.projectsPerTick ? rows[rows.length - 1].project_id as string : null };
  }, signal);
}
export interface ManagedPreparationProducerOptions {
  control: Pick<ManagedProducerControl, 'configured' | 'snapshot' | 'register'>;
  resources: Pick<ProducerResourceService, 'create' | 'revoke'>;
  preparations: Pick<PreparationService, 'context' | 'get' | 'create' | 'upload' | 'publish'>;
  traces: Pick<GeometryTraceRepository, 'evidencePut'>;
  qualification: { producerStatus(client: PoolClient, input: { projectId: string; installationEpoch: string }): Promise<CalculationGrantProducerStatus>;
    /** Explicit qualification attempt scope, never a global claim of SDK/model PASS. */
    canQualifyProject?: string; revisionSha256?: string };
  repository?: Pick<CalculationGrantRepository, 'claim' | 'release' | 'quarantine'>;
  journal?: ManagedPreparationJournal;
  readCandidates?: typeof readManagedPreparationCandidates;
  workflow?: typeof runManagedPreparationWorkflow;
  createDriver?: typeof createManagedCaptureDriver;
  authorize?: (authority: CalculationGrantAuthority, signal: AbortSignal) => Promise<void>;
  onPrepared?(value: { candidate: ManagedPreparationCandidate; result: ManagedPreparationWorkflowResult }, signal?: AbortSignal): Promise<void>;
  onError?(code: string): void;
  pollMilliseconds?: number; now?: () => number;
}
function safeRetained(record: ManagedPreparationOwner): boolean {
  return record.leaseReleased || record.phase === 'blocked' && record.authority === null && record.reasonCode !== null && !record.reasonCode.includes('UNKNOWN');
}
function recoveredResult(record: ManagedPreparationOwner): ManagedPreparationWorkflowResult | null {
  const publication = record.checkpoint?.publication;
  if (!record.joined || !record.resourceRevoked || !record.leaseReleased || !publication) return null;
  const aggregate = publication.aggregate;
  return Object.freeze({ status: 'published', producer: Object.freeze({ joined: true }), aggregate, sessionId: publication.sessionId,
    traceInputs: Object.freeze({ aggregateId: aggregate.id, sessionId: publication.sessionId, artifactId: aggregate.artifactId,
      coordinateFrameId: aggregate.coordinateFrameId, partIds: Object.freeze(aggregate.partReferences.map(part => part.partId)) }) });
}

export function createManagedPreparationProducer(pool: Pool, options: ManagedPreparationProducerOptions) {
  const poll = options.pollMilliseconds ?? 5000;
  if (!Number.isSafeInteger(poll) || poll < 1000 || poll > 60000) throw new Error('Invalid managed preparation cadence.');
  if (options.qualification.canQualifyProject !== undefined) policyUuidSchema.parse(options.qualification.canQualifyProject);
  if (options.qualification.revisionSha256 !== undefined) policyHashSchema.parse(options.qualification.revisionSha256);
  const stateFor = async (client: PoolClient, input: { projectId: string; installationEpoch: string }) => {
    const status = calculationGrantProducerStatusSchema.parse(await options.qualification.producerStatus(client, input));
    if (['ready', 'running'].includes(status.status)) return status;
    return options.control.configured && options.qualification.canQualifyProject === input.projectId
      ? { status: 'running' as const, reasonCode: 'MANAGED_PRODUCER_QUALIFICATION_RUNNING' } : status;
  };
  const repository = options.repository ?? createCalculationGrantRepository(pool, { producerStatus: stateFor }), journal = options.journal ?? createManagedPreparationJournal();
  const readCandidates = options.readCandidates ?? readManagedPreparationCandidates, workflow = options.workflow ?? runManagedPreparationWorkflow,
    createDriver = options.createDriver ?? createManagedCaptureDriver, now = options.now ?? Date.now;
  const authorize = options.authorize ?? ((authority: CalculationGrantAuthority, signal: AbortSignal) => grantTransaction(pool, authority, 'prepare', async () => undefined, signal));
  const controller = new AbortController(), suppressed = new Map<string, string>();
  let cursor: string | null = null, inFlight: Promise<void> | undefined, loop: Promise<void> | undefined, retryAt = 0, phase = 'idle', lastCode: string | null = null;
  const report = (code: string) => { lastCode = code; try { options.onError?.(code); } catch { /* Diagnostics cannot authorize or release ownership. */ } };
  const write = async (record: ManagedPreparationOwner, change: Partial<ManagedPreparationOwner>) => journal.save(record,
    { ...record, ...change, revision: (BigInt(record.revision) + 1n).toString() });
  const notify = async (record: ManagedPreparationOwner, candidate: ManagedPreparationCandidate, result: ManagedPreparationWorkflowResult) => {
    if (!options.onPrepared || record.notified || controller.signal.aborted) return record;
    // Persist uncertainty before invoking maintenance. A lost callback or journal
    // acknowledgement must never leave an apparently safe replayable callback.
    const invoking = await write(record, { phase: 'blocked', reasonCode: 'MANAGED_PREPARATION_CALLBACK_UNKNOWN' });
    try { await options.onPrepared({ candidate, result }, controller.signal); }
    catch (error) {
      const code = codeOf(error); report(code); retryAt = now() + MANAGED_PREPARATION_PRODUCER_LIMITS.failureBackoffMilliseconds;
      if (knownCallbackRefusal(error)) {
        phase = 'waiting';
        return write(invoking, { phase: 'released', notified: false, reasonCode: code });
      }
      phase = 'blocked'; return invoking;
    }
    return write(invoking, { phase: 'released', notified: true, reasonCode: null });
  };
  const run = async (candidate: ManagedPreparationCandidate, sourceSha256: string) => {
    const grant = candidate.grant, owner = newCalculationGrantLeaseOwner();
    let record = await journal.save(null, { schemaVersion: 'wfc.pf.private-managed-preparation-owner.v1', id: randomUUID(), revision: '0', projectId: candidate.projectId,
      sourceSha256, claim: { projectId: candidate.projectId, grantId: grant.id, grantRevision: grant.grantRevision, grantEpoch: grant.grantEpoch,
        installationEpoch: grant.installationEpoch, operation: 'prepare', ...candidate.model, ...owner }, authority: null, identity: null, attemptId: null,
      phase: 'claim-intent', joined: false, resourceRevoked: false, leaseReleased: false, notified: false, checkpoint: null, reasonCode: null });
    let authority: CalculationGrantAuthority | undefined, attempt: Awaited<ReturnType<ManagedProducerControl['register']>> | undefined,
      resource: Awaited<ReturnType<ProducerResourceService['create']>> | undefined, registrationStarted = false, joinConfirmed = false,
      result: ManagedPreparationWorkflowResult | undefined, error: unknown;
    try {
      phase = 'claiming'; authority = await repository.claim(record.claim, controller.signal);
      record = await write(record, { authority, phase: 'claimed' });
      const loadId = randomUUID(); record = await write(record, { phase: 'session-intent' });
      resource = await options.resources.create({ authority, loadId, signal: controller.signal });
      const identity = { instanceId: randomUUID(), projectId: authority.projectId, modelVersionId: authority.modelVersionId, loadId, sessionId: resource.session.sessionId };
      record = await write(record, { identity, phase: 'register-intent' }); registrationStarted = true;
      const resources: ProducerResourceIdentity = { projectId: authority.projectId, modelVersionId: authority.modelVersionId, sessionId: resource.session.sessionId, capability: resource.capability };
      const current = () => authorize(authority!, controller.signal);
      attempt = await options.control.register({ identity, resources, authorize: current });
      record = await write(record, { attemptId: attempt.attemptId, phase: 'running' }); phase = 'preparing';
      const close = async (): Promise<{ joined: true }> => { const value = await attempt!.close(); if (value.joined !== true) return fail('MANAGED_PREPARATION_JOIN_UNKNOWN'); joinConfirmed = true; return value; };
      const driver = createDriver({ identity: attempt.identity, selectionRevision: authority.selectionRevision, contentFingerprint: authority.contentFingerprint,
        signal: controller.signal, exchange: value => attempt!.exchange(value), close });
      const workflowOptions: ManagedPreparationWorkflowOptions = { authority, principal: grantOperationPrincipal(authority), driver,
        preparations: options.preparations, traces: options.traces, authorize,
        recorder: { load: async () => record.checkpoint, save: async checkpoint => { record = await write(record, { checkpoint }); } }, signal: controller.signal };
      result = await workflow(workflowOptions);
      if (!joinConfirmed || result.producer.joined !== true) return fail('MANAGED_PREPARATION_JOIN_UNKNOWN');
    } catch (caught) { error = caught; }
    // Known mutation promises above have settled. Cleanup uses the owned private
    // identity even when the live grant has since been revoked or expired.
    if (authority) {
      if (attempt && !joinConfirmed) {
        const snapshot = options.control.snapshot;
        if (snapshot.attemptId === attempt.attemptId && snapshot.joined === true) joinConfirmed = true;
        else try { const closed = await attempt.close(); joinConfirmed = closed.joined === true; } catch { /* Unknown is quarantined below. */ }
      }
      if (!registrationStarted) joinConfirmed = true; // No owned helper was ever registered or started.
      let revoked = resource === undefined;
      if (resource) try { await options.resources.revoke({ authority, sessionId: resource.session.sessionId }); revoked = true; } catch (caught) { error ??= caught; }
      if (codeOf(error) === 'ENGINE_SESSION_REAP_FAILED') {
        // A positive browser join proves nothing about the separate .NET
        // publication child. Keep its exact prepare owner until reconciled.
        try { await repository.quarantine(authority, 'ENGINE_SESSION_REAP_FAILED'); } catch { /* Retain ownership even when quarantine acknowledgement is unknown. */ }
        try { record = await write(record, { phase: 'quarantined', joined: joinConfirmed, resourceRevoked: revoked, reasonCode: 'ENGINE_SESSION_REAP_FAILED' }); } catch { /* Original private owner remains authoritative. */ }
      } else if (joinConfirmed && revoked) {
        try {
          record = await write(record, { joined: true, resourceRevoked: true, phase: 'release-intent', reasonCode: error ? codeOf(error) : null });
          await repository.release(authority);
          record = await write(record, { leaseReleased: true, phase: error ? 'blocked' : 'released' });
          if (!error && result) record = await notify(record, candidate, result);
        } catch (caught) { error ??= caught; }
      } else {
        try { await repository.quarantine(authority, 'MANAGED_PREPARATION_JOIN_UNKNOWN'); } catch { /* Retained exact owner remains mandatory. */ }
        try { record = await write(record, { phase: 'quarantined', joined: joinConfirmed, resourceRevoked: revoked, reasonCode: 'MANAGED_PREPARATION_JOIN_UNKNOWN' }); } catch { /* Never replace a conflicting or unknown private journal. */ }
        error = new PathFinderError('MANAGED_PREPARATION_JOIN_UNKNOWN', 503);
      }
    } else {
      const definite = error instanceof PathFinderError && !codeOf(error).includes('UNKNOWN');
      try { record = await write(record, { phase: definite ? 'blocked' : 'quarantined', reasonCode: codeOf(error) }); } catch { /* Original owner claim intent stays retained. */ }
    }
    if (error) {
      const code = codeOf(error); report(code); retryAt = now() + MANAGED_PREPARATION_PRODUCER_LIMITS.failureBackoffMilliseconds;
      if (!authority && retryableAdmission.has(code)) suppressed.delete(candidate.projectId);
    }
    return record;
  };
  const tickBody = async () => {
    if (controller.signal.aborted || !options.control.configured || now() < retryAt) return;
    phase = 'scanning';
    const records = await journal.list();
    if (records.some(record => !safeRetained(record))) { phase = 'quarantined'; report('MANAGED_PREPARATION_RECOVERY_REQUIRED'); return; }
    // A currently occupied slot is an external dependency, not a failed model.
    // Do not create repeated owner intents while the same finite lease is held.
    const occupied = await schedulerTransaction(pool, async client => (await client.query<{ id: string; state: string }>(
      `SELECT l.id,l.state FROM pf_calculation_grant_leases l JOIN pf_installation_state i ON i.singleton=true AND i.installation_epoch=l.installation_epoch
       WHERE l.state IN('active','quarantined') ORDER BY l.id LIMIT 1`)).rows[0], controller.signal);
    if (occupied) { phase = occupied.state === 'quarantined' ? 'quarantined' : 'waiting'; report(occupied.state === 'quarantined' ? 'CALCULATION_GRANT_LEASE_QUARANTINED' : 'CALCULATION_GRANT_LEASE_BUSY'); retryAt = now() + MANAGED_PREPARATION_PRODUCER_LIMITS.failureBackoffMilliseconds; return; }
    const page = await readCandidates(pool, cursor, controller.signal); cursor = page.nextCursor;
    for (const item of page.blocked ?? []) report(item.code);
    if (page.candidates.length > MANAGED_PREPARATION_PRODUCER_LIMITS.projectsPerTick) return fail('MANAGED_PREPARATION_CANDIDATE_LIMIT');
    for (const candidate of page.candidates) {
      controller.signal.throwIfAborted();
      const status = await schedulerTransaction(pool, client => stateFor(client, { projectId: candidate.projectId, installationEpoch: candidate.grant.installationEpoch }), controller.signal);
      const dependency = sha({ source: candidate.sourceSha256, qualification: status, revision: options.qualification.revisionSha256 ?? null,
        qualificationProject: options.qualification.canQualifyProject ?? null });
      const retained = records.find(record => record.projectId === candidate.projectId && record.leaseReleased && !record.notified && record.phase === 'released' &&
        record.checkpoint?.publication?.aggregate.id === candidate.currentAggregateId && record.claim.grantId === candidate.grant.id && record.claim.grantRevision === candidate.grant.grantRevision &&
        record.claim.grantEpoch === candidate.grant.grantEpoch && record.claim.installationEpoch === candidate.grant.installationEpoch &&
        record.claim.modelVersionId === candidate.model.modelVersionId && record.claim.selectionRevision === candidate.model.selectionRevision && record.claim.contentFingerprint === candidate.model.contentFingerprint);
      if (candidate.alreadyComplete && retained && options.onPrepared) {
        const recovered = recoveredResult(retained);
        if (recovered) {
          await notify(retained, candidate, recovered); cursor = candidate.projectId;
          // A recovered maintenance call can own the global lease. Process at
          // most one long-running callback per tick, including a BUSY refusal.
          if (phase === 'scanning') phase = 'idle';
          return;
        }
      }
      if (candidate.alreadyComplete || suppressed.get(candidate.projectId) === dependency || records.some(record => record.sourceSha256 === dependency && record.phase === 'blocked' && !retryableAdmission.has(record.reasonCode ?? ''))) continue;
      if (suppressed.size >= MANAGED_PREPARATION_PRODUCER_LIMITS.trackedProjects && !suppressed.has(candidate.projectId)) return fail('MANAGED_PREPARATION_TRACKING_LIMIT');
      if (!['ready', 'running'].includes(status.status)) { suppressed.set(candidate.projectId, dependency); continue; }
      suppressed.set(candidate.projectId, dependency);
      const finished = await run(candidate, dependency);
      cursor = candidate.projectId;
      if (!safeRetained(finished)) { phase = 'quarantined'; return; }
      // One long-running producer owns the single global lease at a time. The
      // next candidate is revisited through the stable cursor in a later tick.
      break;
    }
    if (!['quarantined', 'waiting', 'blocked'].includes(phase)) phase = 'idle';
  };
  const tick = () => {
    if (inFlight) return inFlight;
    inFlight = tickBody().catch(error => { report(codeOf(error)); phase = 'blocked'; retryAt = now() + MANAGED_PREPARATION_PRODUCER_LIMITS.failureBackoffMilliseconds; })
      .finally(() => { inFlight = undefined; });
    return inFlight;
  };
  return {
    get snapshot() { return Object.freeze({ phase, running: Boolean(inFlight), cursor, lastCode, retryAt }); },
    tick,
    start() { if (loop || controller.signal.aborted) return; loop = (async () => { while (!controller.signal.aborted) { await tick(); await delay(poll, undefined, { signal: controller.signal }).catch(() => undefined); } })(); },
    async stop() { controller.abort(); await inFlight; await loop; phase = 'stopped'; },
  };
}
