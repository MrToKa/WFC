import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { collectPreparationDiscovery } from '../../shared/collectPreparationDiscovery.js';
import { preparationCaptureRequest } from '../../shared/preparationMerge.js';
import {
  PREPARATION_LIMITS, preparationContextSchema, preparationCreateSchema, preparationSessionSchema,
  preparationPartReceiptSchema, preparationMutationSchema, preparationPublicationSchema, preparationScopeSchema,
  type PreparationContext, type PreparationCreate, type PreparationSession, type PreparationAggregate,
} from '../../shared/pathfinderPreparation.js';
import { captureEvidenceUploadSchema, captureEvidenceReceiptSchema } from '../../shared/pathfinderGeometryTrace.js';
import { calculationGrantProvenanceSchema, CALCULATION_GRANT_LIMITS } from '../../shared/pathfinderCalculationGrant.js';
import { canonicalPurposeJson, policyUuidSchema, policyHashSchema, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import {
  bindCompletedCaptureEvidence, verifyCompletedCaptureEvidence, type CompletedCaptureEvidence,
} from '../../viewer-runtime/capture-evidence.mjs';
import type { PreparationDiscoveryPage, PreparationDiscoveryRequest } from '../../viewer-runtime/preparation-input.mjs';
import type { ModelCaptureRequest } from '../../viewer-runtime/protocol.mjs';
import { calculationGrantAuthoritySchema, calculationGrantProvenance, type CalculationGrantAuthority } from './calculationAuthority.js';
import { snapshotSchema, type ComputationalSnapshot } from './contracts.js';
import { isGrantPrincipal, type OperationPrincipal } from './operationAuthority.js';
import { equalPreparationScope, preparationDigest } from './preparationPlans.js';
import type { PreparationService } from './preparationSessions.js';
import type { GeometryTraceRepository } from './geometryTraceRepository.js';
import { PathFinderError } from './errors.js';

const publicationSchema = preparationPublicationSchema;
const uploadIntentSchema = z.object({ kind: z.literal('upload'), sessionId: policyUuidSchema, partId: policyUuidSchema,
  planSha256: policyHashSchema, captureLoadId: policyUuidSchema,
  snapshot: snapshotSchema, evidence: z.unknown() }).strict();
const pendingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), body: preparationCreateSchema }).strict(),
  uploadIntentSchema,
  z.object({ kind: z.literal('evidence'), sessionId: policyUuidSchema, partId: policyUuidSchema, body: captureEvidenceUploadSchema }).strict(),
  z.object({ kind: z.literal('publish'), sessionId: policyUuidSchema, body: preparationMutationSchema }).strict(),
]);
export const managedPreparationCheckpointSchema = z.object({ schemaVersion: z.literal('wfc.pf.managed-preparation-checkpoint.v1'),
  projectId: policyUuidSchema, grant: calculationGrantProvenanceSchema,
  model: z.object({ modelVersionId: policyUuidSchema, selectionRevision: policyRevisionSchema, contentFingerprint: policyHashSchema }).strict(),
  scope: preparationScopeSchema.nullable(), sessionId: policyUuidSchema.nullable(), pending: pendingSchema.nullable(),
  publication: publicationSchema.nullable(),
}).strict();
export type ManagedPreparationCheckpoint = z.infer<typeof managedPreparationCheckpointSchema>;
export type ManagedPreparationIntent = NonNullable<ManagedPreparationCheckpoint['pending']>;

export interface ManagedPreparationDriver {
  readonly identity: { instanceId: string; projectId: string; modelVersionId: string; loadId: string; sessionId: string };
  discover(request: PreparationDiscoveryRequest): Promise<PreparationDiscoveryPage>;
  capture(request: ModelCaptureRequest): Promise<{ snapshot: ComputationalSnapshot; evidence: CompletedCaptureEvidence }>;
  assertCurrent(): void;
  close(): Promise<{ joined: true }>;
}
/** Implementations store this privately, outside Git. Payload/evidence are exact
 * replay bytes, while lease IDs, owner tokens and human credentials are absent. */
export interface ManagedPreparationRecorder {
  load(): Promise<ManagedPreparationCheckpoint | null>;
  save(checkpoint: ManagedPreparationCheckpoint): Promise<void>;
}
export interface ManagedPreparationWorkflowOptions {
  authority: CalculationGrantAuthority;
  principal: OperationPrincipal;
  driver: ManagedPreparationDriver;
  preparations: Pick<PreparationService, 'context' | 'get' | 'create' | 'upload' | 'publish'>;
  traces: Pick<GeometryTraceRepository, 'evidencePut'>;
  authorize(authority: CalculationGrantAuthority, signal: AbortSignal): void | Promise<void>;
  recorder: ManagedPreparationRecorder;
  signal?: AbortSignal;
  progress?(value: { phase: 'discovery' | 'capture' | 'publication'; completed: number; total: number }): void;
  uuid?: () => string;
  now?: () => number;
}
export interface ManagedPreparationWorkflowResult {
  readonly status: 'published';
  readonly producer: { readonly joined: true };
  readonly aggregate: PreparationAggregate;
  readonly sessionId: string;
  readonly traceInputs: { readonly aggregateId: string; readonly sessionId: string; readonly artifactId: string;
    readonly coordinateFrameId: string; readonly partIds: readonly string[] };
}
export class ManagedPreparationWorkflowError extends PathFinderError {
  declare readonly cause?: unknown;
  constructor(code: string, public readonly outcome: 'refused' | 'unknown', public readonly sessionId: string | null = null, cause?: unknown) {
    const boundedCode = /^[A-Z][A-Z0-9_]{0,95}$/.test(code) ? code : 'MANAGED_PREPARATION_FAILED';
    super(boundedCode, boundedCode.endsWith('_UNKNOWN') || boundedCode === 'ENGINE_SESSION_REAP_FAILED' ? 503 : 409,
      `Managed preparation stopped (${boundedCode}). Retain its private checkpoint and reconcile the same command before continuing.`);
    if (cause !== undefined) Object.defineProperty(this, 'cause', { value: cause, enumerable: false });
  }
  toJSON() { return { name: this.name, code: this.code, status: this.status, message: this.message, outcome: this.outcome, sessionId: this.sessionId }; }
}
const refuse = (code: string): never => { throw new PathFinderError(code, 409); };
const same = (left: unknown, right: unknown) => canonicalPurposeJson(left) === canonicalPurposeJson(right);
function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const item of Object.values(value)) immutable(item); Object.freeze(value); }
  return value;
}
function parsedCopy<T>(value: T): T { return JSON.parse(canonicalPurposeJson(value)) as T; }

/** Calculation-only producer. No resolution, matching, engineering acceptance,
 * trace creation, cable proposal or Apply operation is available here. */
export async function runManagedPreparationWorkflow(options: ManagedPreparationWorkflowOptions): Promise<ManagedPreparationWorkflowResult> {
  const now = options.now ?? Date.now, uuid = options.uuid ?? randomUUID;
  let checkpoint: ManagedPreparationCheckpoint | null = null, joined = false, result: ManagedPreparationWorkflowResult | undefined;
  let cause: unknown;
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]);
  const parsedAuthority = calculationGrantAuthoritySchema.safeParse(options.authority);
  if (!parsedAuthority.success) {
    try { const closed = await options.driver.close(); if (closed.joined !== true) throw new Error('join'); }
    catch { throw new ManagedPreparationWorkflowError('MANAGED_PREPARATION_JOIN_UNKNOWN', 'refused'); }
    throw new ManagedPreparationWorkflowError('MANAGED_PREPARATION_AUTHORITY_DENIED', 'refused');
  }
  const authority = parsedAuthority.data;
  const started = now(), deadline = Math.min(started + CALCULATION_GRANT_LIMITS.executionLeaseMilliseconds, Date.parse(authority.leaseExpiresAt));
  const timeout = setTimeout(() => controller.abort(), Math.max(1, deadline - started)); timeout.unref?.();
  const current = () => {
    if (signal.aborted || now() >= deadline) return refuse('MANAGED_PREPARATION_CANCELLED');
    options.driver.assertCurrent();
  };
  const fence = async () => {
    current(); await options.authorize(authority, signal); current();
  };
  // Deliberately await every known operation. A timer aborts admission; it does
  // not abandon a mutating SQL/storage promise whose outcome may still commit.
  const step = async <T>(work: () => Promise<T> | T): Promise<T> => {
    await fence(); const value = await work(); await fence(); return value;
  };
  const save = async (next: ManagedPreparationCheckpoint) => {
    const value = managedPreparationCheckpointSchema.parse(next);
    await step(() => options.recorder.save(parsedCopy(value))); checkpoint = value;
  };
  const requireScope = (scope: PreparationContext['scope']) => {
    if (scope.modelVersionId !== authority.modelVersionId || scope.selectionRevision !== authority.selectionRevision || scope.contentFingerprint !== authority.contentFingerprint)
      return refuse('MANAGED_PREPARATION_MODEL_SCOPE_DENIED');
  };
  const context = async () => {
    const value = preparationContextSchema.parse(await step(() => options.preparations.context(authority.projectId, options.principal)));
    if (value.projectId !== authority.projectId) return refuse('MANAGED_PREPARATION_MODEL_SCOPE_DENIED');
    requireScope(value.scope); return value;
  };
  const session = async (id: string) => {
    const value = preparationSessionSchema.parse(await step(() => options.preparations.get(authority.projectId, options.principal, id)));
    if (value.schemaVersion !== 'wfc.pf.preparation-session.v2' || value.id !== id || value.projectId !== authority.projectId ||
      !same(value.principal.grant, calculationGrantProvenance(authority))) return refuse('MANAGED_PREPARATION_PRODUCER_SCOPE_DENIED');
    requireScope(value.plan);
    if (!checkpoint?.scope || !equalPreparationScope(value.plan, checkpoint.scope)) return refuse('MANAGED_PREPARATION_SCOPE_STALE');
    return value;
  };
  const assertEvidence = async (evidence: unknown, value: PreparationSession, partId: string, loadId: string, payloadSha: string | null) => {
    if (!await step(() => verifyCompletedCaptureEvidence(evidence))) return refuse('MANAGED_PREPARATION_EVIDENCE_INVALID');
    const proof = evidence as CompletedCaptureEvidence, binding = proof.binding, plan = value.plan;
    if (binding.projectId !== authority.projectId || binding.modelVersionId !== authority.modelVersionId || binding.contentFingerprint !== authority.contentFingerprint ||
      binding.loadId !== loadId || binding.sessionId !== value.id || binding.partId !== partId || binding.planSha256 !== plan.orderedPlanSha256 || binding.coordinateFrameId !== plan.coordinateFrameId ||
      binding.selectionRevision !== null && binding.selectionRevision !== plan.selectionRevision || binding.partPayloadSha256 !== null && binding.partPayloadSha256 !== payloadSha)
      return refuse('MANAGED_PREPARATION_EVIDENCE_SCOPE');
    return proof;
  };
  const executePending = async (): Promise<void> => {
    if (!checkpoint?.pending) return;
    const command = checkpoint.pending;
    if (command.kind === 'create') {
      if (!checkpoint.scope || !equalPreparationScope(command.body.expected, checkpoint.scope)) return refuse('MANAGED_PREPARATION_CHECKPOINT_INVALID');
      const created = preparationSessionSchema.parse(await step(() => options.preparations.create(authority.projectId, options.principal, command.body)));
      if (created.schemaVersion !== 'wfc.pf.preparation-session.v2' || created.projectId !== authority.projectId || !same(created.principal.grant, checkpoint.grant) ||
        !equalPreparationScope(created.plan, command.body.expected)) return refuse('MANAGED_PREPARATION_CREATE_RESPONSE_INVALID');
      await save({ ...checkpoint, sessionId: created.id, pending: null }); return;
    }
    if (!checkpoint.sessionId || command.sessionId !== checkpoint.sessionId) return refuse('MANAGED_PREPARATION_CHECKPOINT_INVALID');
    const value = await session(command.sessionId);
    if (command.kind === 'upload') {
      const part = value.plan.partPlan.find(item => item.partId === command.partId);
      if (!part || command.planSha256 !== value.plan.orderedPlanSha256) return refuse('MANAGED_PREPARATION_CHECKPOINT_INVALID');
      const snapshot = snapshotSchema.parse(command.snapshot), sha256 = preparationDigest(snapshot);
      const proof = await assertEvidence(command.evidence, value, command.partId, command.captureLoadId, sha256);
      const receipt = preparationPartReceiptSchema.parse(await step(() => options.preparations.upload(authority.projectId, options.principal,
        value.id, command.partId, command.planSha256, snapshot)));
      if (receipt.schemaVersion !== 'wfc.pf.preparation-part-receipt.v2' || receipt.part.sessionId !== value.id || receipt.part.partId !== command.partId ||
        receipt.part.payloadSha256 !== sha256 || receipt.part.sessionPlanSha256 !== command.planSha256 || !same(receipt.part.producer.grant, checkpoint.grant))
        return refuse('MANAGED_PREPARATION_PART_RESPONSE_INVALID');
      const evidence = await step(() => bindCompletedCaptureEvidence(proof, { selectionRevision: value.plan.selectionRevision, partPayloadSha256: receipt.part.payloadSha256 }));
      await save({ ...checkpoint, pending: { kind: 'evidence', sessionId: value.id, partId: command.partId,
        body: { schemaVersion: 'wfc.pf.capture-evidence-upload.v1', sessionPlanSha256: command.planSha256, payloadSha256: receipt.part.payloadSha256, evidence } } });
      await executePending(); return;
    }
    if (command.kind === 'evidence') {
      const part = value.parts.find(item => item.partId === command.partId);
      const proof = command.body.evidence as CompletedCaptureEvidence;
      if (!part || command.body.sessionPlanSha256 !== value.plan.orderedPlanSha256 || command.body.payloadSha256 !== part.payloadSha256 || !proof?.binding.loadId)
        return refuse('MANAGED_PREPARATION_CHECKPOINT_INVALID');
      await assertEvidence(proof, value, command.partId, proof.binding.loadId, part.payloadSha256);
      if (proof.binding.selectionRevision !== value.plan.selectionRevision || proof.binding.partPayloadSha256 !== part.payloadSha256)
        return refuse('MANAGED_PREPARATION_EVIDENCE_SCOPE');
      const receipt = captureEvidenceReceiptSchema.parse(await step(() => options.traces.evidencePut(authority.projectId, options.principal, value.id, command.partId, command.body, signal)));
      if (receipt.sessionId !== value.id || receipt.partId !== command.partId) return refuse('MANAGED_PREPARATION_EVIDENCE_RESPONSE_INVALID');
      await save({ ...checkpoint, pending: null }); return;
    }
    const published = publicationSchema.parse(await step(() => options.preparations.publish(authority.projectId, options.principal, value.id, command.body)));
    if (published.schemaVersion !== 'wfc.pf.preparation-publication.v2' || published.sessionId !== value.id || published.aggregate.sessionId !== value.id ||
      published.aggregate.projectId !== authority.projectId || !same(published.aggregate.producerGrant, checkpoint.grant) ||
      published.aggregate.orderedPlanSha256 !== value.plan.orderedPlanSha256 || published.aggregate.coordinateFrameId !== value.plan.coordinateFrameId ||
      !same(published.aggregate.partReferences, value.parts.map(part => ({ partId: part.partId, partIndex: part.partIndex, payloadSha256: part.payloadSha256 }))))
      return refuse('MANAGED_PREPARATION_PUBLICATION_INVALID');
    await save({ ...checkpoint, pending: null, publication: published });
  };
  try {
    if (authority.operation !== 'prepare' || !isGrantPrincipal(options.principal) || options.principal.userId !== authority.issuerId ||
      'loginId' in options.principal || 'loginExpiresAt' in options.principal || !same(options.principal.authority, authority))
      return refuse('MANAGED_PREPARATION_AUTHORITY_DENIED');
    for (const key of ['instanceId', 'projectId', 'modelVersionId', 'loadId', 'sessionId'] as const) policyUuidSchema.parse(options.driver.identity[key]);
    if (options.driver.identity.projectId !== authority.projectId || options.driver.identity.modelVersionId !== authority.modelVersionId)
      return refuse('MANAGED_PREPARATION_MODEL_SCOPE_DENIED');
    const stored = await step(() => options.recorder.load());
    checkpoint = stored ? managedPreparationCheckpointSchema.parse(stored) : {
      schemaVersion: 'wfc.pf.managed-preparation-checkpoint.v1', projectId: authority.projectId, grant: calculationGrantProvenance(authority),
      model: { modelVersionId: authority.modelVersionId, selectionRevision: authority.selectionRevision, contentFingerprint: authority.contentFingerprint },
      scope: null, sessionId: null, pending: null, publication: null,
    };
    if (checkpoint.projectId !== authority.projectId || !same(checkpoint.grant, calculationGrantProvenance(authority)) ||
      !same(checkpoint.model, { modelVersionId: authority.modelVersionId, selectionRevision: authority.selectionRevision, contentFingerprint: authority.contentFingerprint }))
      return refuse('MANAGED_PREPARATION_CHECKPOINT_SCOPE_DENIED');
    let live = await context();
    // Reconcile exactly the retained command first. No new idempotency key,
    // snapshot or evidence is invented after a missing write acknowledgement.
    await executePending();
    if (!checkpoint.sessionId) {
      const reader = {
        assertCurrent: current,
        discover: (request: PreparationDiscoveryRequest) => step(() => options.driver.discover(request)),
      };
      options.progress?.({ phase: 'discovery', completed: 0, total: live.trays.length });
      const discovery = await step(() => collectPreparationDiscovery(live, reader));
      const body: PreparationCreate = preparationCreateSchema.parse({ schemaVersion: 'wfc.pf.preparation-create.v1', expected: live.scope, idempotencyKey: uuid(), discovery });
      await save({ ...checkpoint, scope: live.scope, pending: { kind: 'create', body } }); await executePending();
    }
    let frozen = await session(checkpoint.sessionId!);
    if (!checkpoint.publication) {
      live = await context();
      if (!equalPreparationScope(frozen.plan, live.scope)) return refuse('MANAGED_PREPARATION_SCOPE_STALE');
      if (frozen.plan.diagnostics.length || !frozen.plan.partPlan.length || frozen.plan.partPlan.length > PREPARATION_LIMITS.parts)
        return refuse('MANAGED_PREPARATION_PLAN_UNRESOLVED');
      if (!['planned', 'collecting', 'validating'].includes(frozen.state)) return refuse('MANAGED_PREPARATION_STATE_CONFLICT');
      for (const part of frozen.plan.partPlan) {
        if (frozen.parts.some(item => item.partId === part.partId)) continue;
        options.progress?.({ phase: 'capture', completed: part.partIndex, total: frozen.plan.partPlan.length });
        const capture = await step(() => options.driver.capture(preparationCaptureRequest(frozen.plan, part.partId)));
        const snapshot = snapshotSchema.parse(capture.snapshot), sha256 = preparationDigest(snapshot);
        if (snapshot.model.projectId !== authority.projectId || snapshot.model.modelVersionId !== authority.modelVersionId || snapshot.model.contentSha256 !== authority.contentFingerprint)
          return refuse('MANAGED_PREPARATION_CAPTURE_SCOPE');
        await assertEvidence(capture.evidence, frozen, part.partId, options.driver.identity.loadId, sha256);
        await save({ ...checkpoint, pending: { kind: 'upload', sessionId: frozen.id, partId: part.partId,
          planSha256: frozen.plan.orderedPlanSha256, captureLoadId: options.driver.identity.loadId, snapshot, evidence: capture.evidence } });
        await executePending(); frozen = await session(frozen.id);
        live = await context(); if (!equalPreparationScope(frozen.plan, live.scope)) return refuse('MANAGED_PREPARATION_SCOPE_STALE');
      }
      if (!frozen.coverage.requestedScopeComplete || frozen.coverage.missingPartIds.length) return refuse('MANAGED_PREPARATION_PARTS_INCOMPLETE');
      const body = frozen.state === 'validating' && frozen.recovery ? frozen.recovery.command : preparationMutationSchema.parse({
        schemaVersion: 'wfc.pf.preparation-mutation.v1', expectedSessionRevision: frozen.sessionRevision, idempotencyKey: uuid(), reason: 'Publish the complete managed project preparation.' });
      options.progress?.({ phase: 'publication', completed: frozen.parts.length, total: frozen.plan.partPlan.length });
      await save({ ...checkpoint, pending: { kind: 'publish', sessionId: frozen.id, body } }); await executePending();
    }
    const publication = checkpoint.publication;
    if (!publication) return refuse('MANAGED_PREPARATION_PUBLICATION_INVALID');
    if (publication.schemaVersion !== 'wfc.pf.preparation-publication.v2' || publication.sessionId !== checkpoint.sessionId ||
      publication.aggregate.projectId !== authority.projectId || !same(publication.aggregate.producerGrant, checkpoint.grant))
      return refuse('MANAGED_PREPARATION_PUBLICATION_INVALID');
    live = await context();
    if (!live.currentAggregate || live.currentAggregate.id !== publication.aggregate.id || !same(live.currentAggregate, publication.aggregate) ||
      !equalPreparationScope(publication.aggregate, live.scope)) return refuse('MANAGED_PREPARATION_PUBLICATION_STALE');
    await fence();
    result = { status: 'published', producer: { joined: true }, aggregate: parsedCopy(publication.aggregate), sessionId: publication.sessionId,
      traceInputs: { aggregateId: publication.aggregate.id, sessionId: publication.sessionId, artifactId: publication.aggregate.artifactId,
        coordinateFrameId: publication.aggregate.coordinateFrameId, partIds: publication.aggregate.partReferences.map(part => part.partId) } };
  } catch (error) { cause = error; }
  finally {
    clearTimeout(timeout);
    try { joined = (await options.driver.close()).joined === true; }
    catch { joined = false; }
    // The managed browser and the publication engine are separate children.
    // Record cleanup uncertainty without returning or throwing from finally;
    // it cannot hide an already unjoined .NET publication engine.
    if (!joined && (cause as { code?: unknown } | null)?.code !== 'ENGINE_SESSION_REAP_FAILED') cause = new PathFinderError('MANAGED_PREPARATION_JOIN_UNKNOWN', 503);
  }
  if (!cause && result && joined) {
    // Cleanup is always allowed, including after revocation. A successful return
    // still needs the original prepare authority after the awaited join.
    try {
      if (signal.aborted || now() >= deadline) return refuse('MANAGED_PREPARATION_CANCELLED');
      await options.authorize(authority, signal);
      if (signal.aborted || now() >= deadline) return refuse('MANAGED_PREPARATION_CANCELLED');
    } catch (error) { cause = error; }
  }
  if (cause || !result || !joined) {
    const rawCode = (cause as { code?: unknown } | null)?.code;
    const code = typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(rawCode) ? rawCode : 'MANAGED_PREPARATION_FAILED';
    throw new ManagedPreparationWorkflowError(code, checkpoint?.pending || code === 'ENGINE_SESSION_REAP_FAILED' ? 'unknown' : 'refused', checkpoint?.sessionId ?? null, cause);
  }
  return immutable(result);
}
