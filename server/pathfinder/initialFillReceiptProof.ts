import type { PoolClient } from 'pg';
import { isPathFinderCableEligible } from '../../shared/pathfinderCableEligibility.js';
import { z } from 'zod';
import { canonicalPurposeJson, policyHashSchema, policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { canonicalDecimalString } from '../../shared/pathfinderLengthLedger.js';
import { cableEndpointCommandSchema, cableEndpointReceiptSchema } from '../../shared/pathfinderCableEndpoints.js';
import { initialFillMandateReference, initialFillProvenanceSchema, initialFillRequestHashInput } from '../../shared/pathfinderInitialFill.js';
import { locationImpactItemSchema, locationImpactRecordSchema } from '../../shared/pathfinderLocationImpacts.js';
import type { RevisionResultEnvelope } from '../../shared/pathfinderRevisionResults.js';
import type { DependencySnapshot, EngineResponse } from './jobContracts.js';
import { designLengthCompatibilityIssue, routeCompatibilityIssue } from './jobContracts.js';
import { hash } from './dependencies.js';
import { endpointBindingHash } from './endpointBindingRepository.js';
import { requireCalculationLengthLedger } from './lengthLedger.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { readInitialFillMandate } from './initialFillMandates.js';
import { initialFillIdempotencyKey } from './initialFillIdentity.js';
import { PathFinderError } from './errors.js';
import { sameSupportedBarrierAdmissionIntent as sameBarrierAdmissionIntent } from '../../shared/pathfinderBarrierSupported.js';
import { readBarrierWriteEvidence } from './barrierWrites.js';

type Row = Record<string, any>;
const object = (value: unknown): Row | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
const same = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
const contentHash = (value: { contentSha256: string }) => { const { contentSha256: _hash, ...body } = value; return endpointBindingHash(body); };
const decimalEqual = (a: unknown, b: unknown) => {
  try { return typeof a === 'string' && typeof b === 'string' && canonicalDecimalString(a) === canonicalDecimalString(b); } catch { return false; }
};
const commandOwnerSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-command-owner.v1'), cableId: policyUuidSchema,
  end: z.enum(['from', 'to']), command: cableEndpointCommandSchema }).strict();
const savedCommandSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-stored.v1'), status: z.literal('saved'), receipt: cableEndpointReceiptSchema }).strict();

export type InitialFillReceiptProofInput = {
  projectId: string; cableId: string; receiptId: string; proposalId: string; actorId: string; idempotencyKey: string; payloadHash: string;
  before: unknown; after: unknown; provenance: unknown; dependencies: DependencySnapshot; result: EngineResponse; seal: RevisionResultEnvelope;
};
export const INITIAL_FILL_PROOF_READ_BYTES = 32 * 1024 ** 2;

/** Exact server-owned pair transition only; no current-state or authority exception. */
export function initialFillOwnWriteTransition(input: Pick<InitialFillReceiptProofInput, 'projectId' | 'cableId' | 'before' | 'after'>): boolean {
  const before = object(input.before), after = object(input.after);
  let design: string;
  try { design = typeof after?.design_length === 'string' ? canonicalDecimalString(after.design_length) : ''; } catch { return false; }
  if (!before || !after || before.id !== input.cableId || after.id !== input.cableId || before.project_id !== input.projectId || after.project_id !== input.projectId
    || !policyRevisionSchema.safeParse(before.cable_write_revision).success || !policyRevisionSchema.safeParse(after.cable_write_revision).success
    || BigInt(after.cable_write_revision) !== BigInt(before.cable_write_revision) + 1n
    || before.design_length !== null || before.routing !== null && (typeof before.routing !== 'string' || before.routing.trim().length !== 0)
    || typeof after.routing !== 'string' || routeCompatibilityIssue(after.routing) || typeof after.design_length !== 'string'
    || designLengthCompatibilityIssue(design) || !Object.hasOwn(before, 'install_length') || !Object.hasOwn(after, 'install_length')) return false;
  const changed = new Set(['routing', 'design_length', 'updated_at', 'cable_write_revision']);
  return same(Object.keys(before).sort(), Object.keys(after).sort()) && Object.keys(before).every(key => changed.has(key) || same(before[key], after[key]));
}

/** Transaction-local immutable common-record caches; no cross-request authority cache. */
export function createInitialFillReceiptProofReader(client: Pick<PoolClient, 'query'>, check: () => void = () => undefined) {
  let readBytes = 0, terminalReadError: PathFinderError | undefined;
  const assertBudget = () => { check(); if (terminalReadError) throw terminalReadError; };
  const readClient = Object.create(client) as Pick<PoolClient, 'query'>;
  readClient.query = (async (sql: string, parameters?: unknown[]) => {
    assertBudget(); const value = await client.query(sql, parameters); assertBudget();
    readBytes += Buffer.byteLength(JSON.stringify(value.rows));
    if (readBytes > INITIAL_FILL_PROOF_READ_BYTES) {
      terminalReadError = new PathFinderError('INITIAL_FILL_PROOF_READ_LIMIT', 413, 'Retained initial-fill proof exceeds the bounded historical read budget.');
      throw terminalReadError;
    }
    return value;
  }) as PoolClient['query'];
  const mandates = new Map<string, ReturnType<typeof readInitialFillMandate>>(), impacts = new Map<string, Promise<Row | null>>(), commands = new Map<string, Promise<Row | null>>();
  const mandate = (projectId: string, mandateId: string) => {
    const key = projectId + ':' + mandateId;
    if (!mandates.has(key)) mandates.set(key, readInitialFillMandate(readClient, projectId, mandateId)); return mandates.get(key)!;
  };
  const impact = (projectId: string, impactId: string) => {
    const key = projectId + ':' + impactId;
    if (!impacts.has(key)) impacts.set(key, readClient.query<Row>(`/* initial-fill:historical-impact */ SELECT project_id,id,actor_id,login_id,idempotency_key,command_sha256,record_sha256,
      CASE WHEN octet_length(record::text)<=1048576 THEN record ELSE NULL END AS record FROM pf_location_impacts WHERE project_id=$1 AND id=$2`,
    [projectId, impactId]).then(value => value.rows[0] ?? null)); return impacts.get(key)!;
  };
  const command = (projectId: string, actorId: string, idempotencyKey: string) => {
    const key = projectId + ':' + actorId + ':' + idempotencyKey;
    if (!commands.has(key)) commands.set(key, readClient.query<Row>(`/* initial-fill:historical-command */ SELECT kind,request_sha256,
      CASE WHEN octet_length(request::text)<=65536 THEN request ELSE NULL END AS request,
      CASE WHEN octet_length(receipt::text)<=1048576 THEN receipt ELSE NULL END AS receipt
      FROM pf_endpoint_binding_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3`,
    [projectId, actorId, idempotencyKey]).then(value => value.rows[0] ?? null)); return commands.get(key)!;
  };
  return async (input: InitialFillReceiptProofInput): Promise<boolean> => {
    assertBudget();
    try {
      for (const value of [input.projectId, input.cableId, input.receiptId, input.proposalId, input.actorId, input.idempotencyKey]) policyUuidSchema.parse(value);
      policyHashSchema.parse(input.payloadHash);
      const provenance = initialFillProvenanceSchema.parse(input.provenance), before = object(input.before), after = object(input.after), dependencies = input.dependencies, seal = input.seal;
      if (!initialFillOwnWriteTransition(input) || !before || !after
        || dependencies.schemaVersion !== 'pathfinder.dependencies.v7' && dependencies.schemaVersion !== 'pathfinder.dependencies.v8') return false;
      if (provenance.schemaVersion === 'pathfinder.initial-fill.v2') {
        const evidence = readBarrierWriteEvidence(dependencies, input.result);
        if (dependencies.schemaVersion !== 'pathfinder.dependencies.v8' || !evidence || !same(evidence, provenance.barrierEvidence)) return false;
      } else if (dependencies.schemaVersion !== 'pathfinder.dependencies.v7' || input.result.schemaVersion === 'pathfinder.model.response.v3') return false;
      requireVersionedCalculationScope(dependencies);
      const ledger = requireCalculationLengthLedger(input.result, dependencies.settings);
      if (!ledger || input.result.status !== 'calculated' || !input.result.route?.success || !input.result.design
        || dependencies.projectId !== input.projectId || dependencies.cableId !== input.cableId || dependencies.cableWriteRevision !== before.cable_write_revision
        || !isPathFinderCableEligible(dependencies.cableInputs.mto) || before.mto !== dependencies.cableInputs.mto
        || before.from_location !== dependencies.cableInputs.fromLocation || before.to_location !== dependencies.cableInputs.toLocation
        || before.cable_type_id !== dependencies.cableInputs.cableTypeId || provenance.proposalId !== input.proposalId
        || seal.projectId !== input.projectId || seal.cableId !== input.cableId || seal.proposalId !== input.proposalId
        || seal.dependencyHash !== hash(dependencies) || seal.engineResultSha256 !== hash(input.result) || seal.ledgerHash !== hash(ledger)
        || seal.proposalHash !== hash({ dependencies, result: input.result, baselineHash: seal.baselineHash }) || provenance.proposalHash !== seal.proposalHash
        || !same(provenance.dependencies, dependencies) || !same(provenance.revisionResult, { admissionId: seal.admissionId,
          revisionResultSha256: seal.revisionResultSha256, baselineHash: seal.baselineHash, engineResultSha256: seal.engineResultSha256,
          ledgerHash: seal.ledgerHash, dependencyHash: seal.dependencyHash })
        || after.routing !== input.result.route.routeText || !decimalEqual(after.design_length, input.result.design.designLengthMeters)
        || provenance.request.idempotencyKey !== input.idempotencyKey || provenance.request.expectedCableWriteRevision !== before.cable_write_revision
        || input.payloadHash !== hash(initialFillRequestHashInput(provenance.request))
        || input.idempotencyKey !== initialFillIdempotencyKey({ projectId: input.projectId, cableId: input.cableId, proposalId: input.proposalId,
          proposalHash: seal.proposalHash, mandateId: provenance.mandate.id, expectedCableWriteRevision: before.cable_write_revision })) return false;
      const historicalMandate = await mandate(input.projectId, provenance.mandate.id); check();
      if (!historicalMandate || !same(initialFillMandateReference(historicalMandate), provenance.mandate) || historicalMandate.actorId !== input.actorId
        || !historicalMandate.eligibleCableIds.includes(input.cableId) || provenance.authorized.actorId !== historicalMandate.actorId
        || provenance.authorized.loginId !== historicalMandate.loginId || provenance.authorized.installationEpoch !== historicalMandate.installationEpoch
        || Date.parse(provenance.authorized.authorizedAt) < Date.parse(historicalMandate.createdAt)
        || Date.parse(provenance.authorized.authorizedAt) >= Math.min(Date.parse(historicalMandate.authorityExpiresAt), Date.parse(historicalMandate.loginExpiresAt))) return false;
      const rawImpact = await impact(input.projectId, historicalMandate.impactId); check();
      if (!rawImpact) return false; const impactRecord = locationImpactRecordSchema.parse(rawImpact.record);
      if (impactRecord.projectId !== input.projectId || impactRecord.id !== historicalMandate.impactId || rawImpact.project_id !== input.projectId || rawImpact.id !== impactRecord.id
        || rawImpact.actor_id !== impactRecord.actorId || rawImpact.login_id !== impactRecord.loginId || rawImpact.idempotency_key !== impactRecord.idempotencyKey
        || rawImpact.command_sha256 !== impactRecord.commandSha256 || rawImpact.record_sha256 !== impactRecord.contentSha256 || contentHash(impactRecord) !== impactRecord.contentSha256
        || impactRecord.contentSha256 !== historicalMandate.impactContentSha256 || impactRecord.commandSha256 !== historicalMandate.commandSha256
        || impactRecord.idempotencyKey !== historicalMandate.idempotencyKey || impactRecord.actorId !== historicalMandate.actorId
        || impactRecord.actorAdminRevision !== historicalMandate.actorAdminRevision || impactRecord.loginId !== historicalMandate.loginId
        || impactRecord.loginExpiresAt !== historicalMandate.loginExpiresAt || impactRecord.authorityExpiresAt !== historicalMandate.authorityExpiresAt
        || impactRecord.installationEpoch !== historicalMandate.installationEpoch || !same(impactRecord.current, historicalMandate.current)
        || !same(impactRecord.eligibleCableIds, historicalMandate.eligibleCableIds) || !impactRecord.calculation
        || dependencies.model.id !== historicalMandate.current.modelVersionId || dependencies.model.selectionRevision !== historicalMandate.current.selectionRevision
        || dependencies.model.contentFingerprint !== historicalMandate.current.contentFingerprint || dependencies.artifact.id !== historicalMandate.current.artifactId
        || dependencies.artifact.sha256 !== historicalMandate.current.projectionSha256 || dependencies.preparation.aggregateId !== historicalMandate.current.aggregateId
        || dependencies.preparation.geometryRevision !== historicalMandate.current.geometryRevision || dependencies.preparation.captureFrameId !== historicalMandate.current.captureFrameId
        || dependencies.preparation.projectionSha256 !== historicalMandate.current.projectionSha256
        || dependencies.options.secondaryDistanceMeters !== impactRecord.calculation.preferences.secondaryDistanceMeters
        || dependencies.options.preferVerticalApproach !== impactRecord.calculation.preferences.preferVerticalApproach
        || dependencies.schemaVersion === 'pathfinder.dependencies.v8' && !sameBarrierAdmissionIntent(
          dependencies.options.barrierRouting, impactRecord.calculation.preferences.barrierRouting)) return false;
      const rawCommand = await command(input.projectId, historicalMandate.actorId, historicalMandate.idempotencyKey); check();
      if (!rawCommand || rawCommand.kind !== 'confirm') return false;
      const owner = commandOwnerSchema.parse(rawCommand.request), original = owner.command, stored = savedCommandSchema.parse(rawCommand.receipt).receipt;
      if (original.schemaVersion !== 'wfc.pf.cable-endpoint-command.v3' || original.initialFill?.mode !== 'when-both-empty'
        || endpointBindingHash(owner) !== rawCommand.request_sha256 || endpointBindingHash(original) !== historicalMandate.commandSha256
        || original.idempotencyKey !== historicalMandate.idempotencyKey || !same(original.expectedCurrent, historicalMandate.current)
        || !same(original.calculation, impactRecord.calculation) || stored.projectId !== input.projectId || stored.actorId !== historicalMandate.actorId
        || stored.cableId !== owner.cableId || stored.end !== owner.end || stored.logicalName !== original.expectedLogicalName || stored.idempotencyKey !== original.idempotencyKey
        || stored.commandSha256 !== historicalMandate.commandSha256 || stored.expectedContextSha256 !== original.expectedContextSha256
        || stored.expectedCableWriteRevision !== original.expectedCableWriteRevision || !same(stored.initialFillMandate, provenance.mandate)
        || stored.locationImpact?.id !== impactRecord.id || stored.binding.binding.id !== impactRecord.bindingId
        || stored.binding.binding.contentSha256 !== impactRecord.bindingContentSha256 || contentHash(stored.binding.binding) !== impactRecord.bindingContentSha256
        || stored.binding.registryRevision !== impactRecord.observedRegistryRevision
        || stored.locationId !== impactRecord.locationId) return false;
      const item = (await readClient.query<Row>(`/* initial-fill:historical-member */ SELECT i.project_id,i.impact_id,i.cable_id,i.generation::text,i.eligible,i.record_sha256,
        CASE WHEN octet_length(i.record::text)<=32768 THEN i.record ELSE NULL END AS record,e.job_id,e.admission_id,e.input_sha256,
        a.input_sha256 AS admission_input_sha256,a.kind AS admission_kind,j.requested_by,j.login_id,j.login_expires_at,j.authority_kind
        FROM pf_location_impact_items i JOIN pf_location_impact_enrollments e ON e.project_id=i.project_id AND e.impact_id=i.impact_id
        JOIN pf_revision_admissions a ON a.project_id=e.project_id AND a.id=e.admission_id AND a.job_id=e.job_id
        JOIN pf_jobs j ON j.project_id=e.project_id AND j.id=e.job_id
        WHERE i.project_id=$1 AND i.impact_id=$2 AND i.cable_id=$3 AND e.job_id=$4 LIMIT 1`,
      [input.projectId, historicalMandate.impactId, input.cableId, seal.jobId])).rows[0]; check();
      if (!item) return false; const member = locationImpactItemSchema.parse(item.record);
      return item.project_id === input.projectId && item.impact_id === historicalMandate.impactId && item.cable_id === input.cableId
        && item.job_id === seal.jobId && item.admission_id === seal.admissionId && item.admission_kind === 'location-impact'
        && policyHashSchema.safeParse(item.input_sha256).success && item.input_sha256 === item.admission_input_sha256
        && item.requested_by === historicalMandate.actorId && item.login_id === historicalMandate.loginId && item.authority_kind === 'current-login'
        && new Date(item.login_expires_at).toISOString() === historicalMandate.loginExpiresAt
        && item.eligible === true && member.eligible && member.projectId === input.projectId
        && member.impactId === historicalMandate.impactId && member.cableId === input.cableId && member.generation === item.generation
        && member.generation === provenance.authorized.targetGeneration && member.cableWriteRevision === before.cable_write_revision
        && member.category === dependencies.cableInputs.mto && member.fromLogicalKey === dependencies.endpointResolution.from.logicalKey
        && member.toLogicalKey === dependencies.endpointResolution.to.logicalKey && member.contentSha256 === item.record_sha256
        && contentHash(member) === member.contentSha256;
    } catch (error) {
      assertBudget();
      if (error instanceof PathFinderError && /DEADLINE|READ_LIMIT|DATABASE_BUSY|ABORT/.test(error.code) || error instanceof Error && error.name === 'AbortError') throw error;
      return false;
    }
  };
}

/** Historical proof: current login, restore epoch and latest target heads are deliberately not consulted. */
export function readInitialFillReceiptProof(client: Pick<PoolClient, 'query'>, input: InitialFillReceiptProofInput): Promise<boolean> {
  return createInitialFillReceiptProofReader(client)(input);
}
