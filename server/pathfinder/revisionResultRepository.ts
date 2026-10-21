import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalPurposeJson, policyHashSchema, policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { canonicalDecimalString, decimalDifference } from '../../shared/pathfinderLengthLedger.js';
import { REVISION_RESULTS_LIMITS, revisionAdmissionSchema, revisionAdmissionsPageSchema, revisionBaselineSchema,
  revisionModelRefSchema, revisionResultDetailSchema, revisionResultEnvelopeSchema, revisionResultRowSchema, revisionResultsPageSchema,
  type RevisionAdmission, type RevisionBaseline, type RevisionCurrentness, type RevisionModelRef, type RevisionResultEnvelope,
  type RevisionResultRow } from '../../shared/pathfinderRevisionResults.js';
import { principalTransaction } from './auth.js';
import { collectDependencyBatchInTransaction } from './dependencyBatch.js';
import { engineResponseSchema, optionsSchema, type DependencySnapshot, type EngineOptions, type EngineResponse, type JobPrincipal } from './jobContracts.js';
import { requireCalculationLengthLedger } from './lengthLedger.js';
import { readRecalculationJobAuthority } from './recalculationRepository.js';
import { PathFinderError } from './errors.js';
import { readProposalApplicability } from './proposalApplicability.js';
import type { SealedCableItemApplicability } from '../../shared/pathfinderItemApplicability.js';
import { createInitialFillReceiptProofReader } from './initialFillReceiptProof.js';
import { readBarrierWriteEvidence } from './barrierWrites.js';
import { registerAutoLengthAdmission } from './autoLengthStore.js';

type Row = Record<string, unknown>;
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'The immutable cable revision result is unavailable or inconsistent. Refresh the admission and calculate a new proposal when required.'); };
export const revisionResultHash = (value: unknown): string => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const equal = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
const iso = (value: unknown): string => { const date = value instanceof Date ? value : new Date(String(value)); if (!Number.isFinite(date.getTime())) return fail('REVISION_RESULT_TIMESTAMP_INVALID', 500); return date.toISOString(); };
const bounded = <T>(value: T, bytes: number): T => { if (Buffer.byteLength(canonicalPurposeJson(value)) > bytes) return fail('REVISION_RESULT_BYTES', 413); return value; };
const nullableString = (value: unknown): string | null => value === null || value === undefined ? null : typeof value === 'string' ? value : fail('REVISION_BASELINE_NUMERIC_TEXT_REQUIRED', 500);
const numericEqual = (a: string | null, b: string | null): boolean => a === null || b === null ? a === b : canonicalDecimalString(a) === canonicalDecimalString(b);
const object = (value: unknown): Row | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const modelRef = (value: unknown): RevisionModelRef | null => { const parsed = revisionModelRefSchema.safeParse(value); return parsed.success ? parsed.data : null; };
const metadata = (row: Row): RevisionAdmission => revisionAdmissionSchema.parse({ id: row.id, projectId: row.project_id,
  jobId: row.job_id, generation: row.generation, kind: row.kind, inputSha256: row.input_sha256, total: row.total, modelRef: row.model_ref, createdAt: iso(row.created_at) });
const admissionSelect = `SELECT id,project_id,job_id,generation::text,kind,input_sha256,options,model_ref,total,observed_events,created_at,
  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM pf_revision_admissions`;
export type RevisionAdmissionItem = { cable: Row; dependencies: DependencySnapshot | null; status: string; message: string };
export type RevisionAdmissionInput = { projectId: string; jobId: string | null; generation: string | null; kind: 'manual' | 'automatic' | 'location-impact'; inputSha256: string;
  options: EngineOptions; items: RevisionAdmissionItem[]; modelRef?: RevisionModelRef | null };

/** Exact SQL NUMERIC text is required; Number coercion is never an admission fallback. */
function cableSnapshot(row: Row): RevisionBaseline['currentCable'] {
  for (const key of ['id', 'tag', 'from_location', 'to_location', 'routing', 'design_length', 'install_length', 'cable_write_revision']) {
    if (!Object.hasOwn(row, key)) return fail('REVISION_BASELINE_CABLE_FIELDS_REQUIRED', 500);
  }
  return revisionBaselineSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-baseline.v1', currentCable: {
    id: row.id, tag: row.tag, fromLocation: row.from_location, toLocation: row.to_location, routing: row.routing,
    designLength: nullableString(row.design_length), installLength: nullableString(row.install_length), cableWriteRevision: row.cable_write_revision },
    lastAcceptedApply: null, acceptedMatchesCurrent: false }).currentCable;
}
/** Retained human acceptance is proved from the immutable command/review/result,
 * without renewing its old login or comparing its scope with today's model. */
function protectedManualBaseline(row: Row, dependencies: DependencySnapshot, output: EngineResponse,
  seal: RevisionResultEnvelope, projectId: string, cableId: string): boolean {
  const provenance = object(row.accepted_provenance), before = object(row.accepted_before), after = object(row.accepted_after),
    review = object(provenance?.review), revision = object(provenance?.revisionResult), evidence = readBarrierWriteEvidence(dependencies, output);
  if (!provenance || !before || !after || !review || !revision || !evidence || provenance.schemaVersion !== 'pathfinder.apply.v3'
    || !equal(provenance.barrierEvidence, evidence) || !equal(provenance.dependencies, dependencies)
    || dependencies.projectId !== projectId || dependencies.cableId !== cableId || dependencies.cableWriteRevision !== before.cable_write_revision
    || before.id !== cableId || after.id !== cableId || before.project_id !== projectId || after.project_id !== projectId
    || !Object.hasOwn(before, 'install_length') || !Object.hasOwn(after, 'install_length')
    || !policyRevisionSchema.safeParse(before.cable_write_revision).success || !policyRevisionSchema.safeParse(after.cable_write_revision).success
    || BigInt(String(after.cable_write_revision)) !== BigInt(String(before.cable_write_revision)) + 1n
    || provenance.proposalId !== row.proposal_id || provenance.proposalHash !== row.proposal_hash
    || provenance.reviewId !== row.accepted_review_id || review.id !== row.accepted_review_id || review.actorId !== row.receipt_actor_id
    || row.accepted_review_actor !== row.receipt_actor_id || row.accepted_review_proposal !== row.proposal_id
    || row.accepted_review_proposal_hash !== row.proposal_hash || !['manual-review', 'synthetic-fixture'].includes(String(row.accepted_validation_method))
    || provenance.validationMethod !== row.accepted_validation_method || review.validationMethod !== row.accepted_validation_method
    || review.loginId !== row.accepted_review_login_id || row.accepted_review_dependency_sha256 !== seal.dependencyHash
    || review.dependencyHash !== seal.dependencyHash || row.accepted_review_result_sha256 !== seal.revisionResultSha256
    || review.revisionResultSha256 !== seal.revisionResultSha256 || revision.revisionResultSha256 !== seal.revisionResultSha256
    || revision.dependencyHash !== seal.dependencyHash || revision.baselineHash !== seal.baselineHash || revision.ledgerHash !== seal.ledgerHash
    || revision.engineResultSha256 !== seal.engineResultSha256 || evidence.engineResultSha256 !== seal.engineResultSha256
    || evidence.dependencySha256 !== seal.dependencyHash || after.routing !== output.route?.routeText
    || typeof after.design_length !== 'string' || !numericEqual(after.design_length, output.design?.designLengthMeters ?? null)
    || row.receipt_payload_hash !== revisionResultHash({ proposalId: row.proposal_id, idempotencyKey: row.receipt_idempotency_key,
      reviewId: row.accepted_review_id, expectedCableWriteRevision: before.cable_write_revision })) return false;
  const changed = new Set(['routing', 'design_length', 'updated_at', 'cable_write_revision']);
  return equal(Object.keys(before).sort(), Object.keys(after).sort())
    && Object.keys(before).every(key => changed.has(key) || equal(before[key], after[key]));
}
async function acceptedBaselines(client: PoolClient, projectId: string, ids: string[]): Promise<Map<string, RevisionBaseline['lastAcceptedApply']>> {
  const result = new Map<string, RevisionBaseline['lastAcceptedApply']>();
  const retainedWriteBody = `r.provenance->>'schemaVersion' IN('pathfinder.initial-fill.v1','pathfinder.initial-fill.v2','pathfinder.apply.v3') AND
    octet_length(r.before_snapshot::text)+octet_length(r.after_snapshot::text)+octet_length(r.provenance::text)
      +octet_length(p.dependencies::text)+octet_length(p.result::text)<=262144`;
  for (let at = 0; at < ids.length; at += REVISION_RESULTS_LIMITS.chunk) {
    const initialFillReceipt = createInitialFillReceiptProofReader(client);
    const values = (await client.query<Row>(`SELECT DISTINCT ON (r.cable_id) r.id AS receipt_id,r.cable_id,r.proposal_id,r.applied_at,
      r.after_snapshot->>'cable_write_revision' AS after_revision,r.after_snapshot->>'routing' AS after_routing,
      r.after_snapshot->>'design_length' AS after_design_length,p.proposal_hash,p.dependency_hash,p.dependencies->'model' AS model_ref,
      p.result#>>'{route,routeText}' AS route_text,p.result#>'{route,lengthMeters}' AS raw_length,
      p.result#>>'{design,designLengthMeters}' AS design_length,p.result#>>'{design,unroundedLengthMeters}' AS unrounded_length,
      s.record_sha256 AS sealed_hash,s.engine_result_sha256,s.ledger_sha256,
      coalesce(r.provenance->>'schemaVersion' LIKE 'pathfinder.initial-fill.%',false) AS initial_fill_kind,
      coalesce(r.provenance->>'schemaVersion' LIKE 'pathfinder.apply.%' AND (r.provenance->>'schemaVersion' NOT IN('pathfinder.apply.v1','pathfinder.apply.v2')
        OR p.dependencies->>'schemaVersion'='pathfinder.dependencies.v8' OR r.provenance ? 'barrierEvidence'),false) AS protected_apply_kind,
      r.actor_id AS receipt_actor_id,r.idempotency_key AS receipt_idempotency_key,r.payload_hash AS receipt_payload_hash,
      CASE WHEN ${retainedWriteBody} THEN r.before_snapshot ELSE NULL END AS accepted_before,
      CASE WHEN ${retainedWriteBody} THEN r.after_snapshot ELSE NULL END AS accepted_after,
      CASE WHEN ${retainedWriteBody} THEN r.provenance ELSE NULL END AS accepted_provenance,
      CASE WHEN ${retainedWriteBody} THEN p.dependencies ELSE NULL END AS accepted_dependencies,
      CASE WHEN ${retainedWriteBody} THEN p.result ELSE NULL END AS accepted_result,
      v.id AS accepted_review_id,v.actor_id AS accepted_review_actor,v.proposal_id AS accepted_review_proposal,
      v.proposal_hash AS accepted_review_proposal_hash,v.validation_method AS accepted_validation_method,
      v.revision_result_sha256 AS accepted_review_result_sha256,v.review_dependency_sha256 AS accepted_review_dependency_sha256,
      v.review_login_id AS accepted_review_login_id
      FROM pf_apply_receipts r JOIN pf_proposals p ON p.project_id=r.project_id AND p.id=r.proposal_id AND p.cable_id=r.cable_id
      LEFT JOIN pf_revision_results s ON s.project_id=p.project_id AND s.proposal_id=p.id
      LEFT JOIN pf_reviews v ON v.project_id=r.project_id AND v.id::text=r.provenance->>'reviewId'
      WHERE r.project_id=$1 AND r.cable_id=ANY($2::uuid[]) ORDER BY r.cable_id,r.applied_at DESC,r.id DESC`, [projectId, ids.slice(at, at + REVISION_RESULTS_LIMITS.chunk)])).rows;
    for (const row of values) {
      const cableId = policyUuidSchema.parse(row.cable_id); if (result.has(cableId) || !ids.includes(cableId)) return fail('REVISION_ACCEPTED_BASELINE_SCOPE', 500);
      if (row.initial_fill_kind || row.protected_apply_kind) {
        // A new write kind is recognized only through its complete immutable
        // mandate/command/result chain. Never fall back to an older receipt.
        try {
          const dependencies = row.accepted_dependencies as DependencySnapshot, retained = object(row.accepted_result);
          if (!retained || !['calculate', 'design'].includes(String(retained.calculationMode))) continue;
          const { calculationMode: _mode, ...response } = retained; engineResponseSchema.parse(response);
          // The persisted mode is part of the immutable proposal/result hash.
          const output = retained as unknown as EngineResponse;
          const seal = await verifyRevisionResultForProposal(client, { projectId, proposalId: String(row.proposal_id),
            dependencies, result: output, proposalHash: String(row.proposal_hash) });
          if (!seal) continue;
          if (row.initial_fill_kind && !await initialFillReceipt({ projectId, cableId, receiptId: String(row.receipt_id), proposalId: String(row.proposal_id),
            actorId: String(row.receipt_actor_id), idempotencyKey: String(row.receipt_idempotency_key), payloadHash: String(row.receipt_payload_hash),
            before: row.accepted_before, after: row.accepted_after, provenance: row.accepted_provenance, dependencies, result: output, seal })) continue;
          if (row.protected_apply_kind && !protectedManualBaseline(row, dependencies, output, seal, projectId, cableId)) continue;
        } catch (error) {
          if (error instanceof PathFinderError && /DEADLINE|READ_LIMIT|DATABASE_BUSY|ABORT/.test(error.code) || error instanceof Error && error.name === 'AbortError') throw error;
          continue;
        }
      }
      const value = revisionBaselineSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-baseline.v1', currentCable: {
        id: cableId, tag: null, fromLocation: null, toLocation: null, routing: null, designLength: null, installLength: null, cableWriteRevision: '0' },
        acceptedMatchesCurrent: false, lastAcceptedApply: { receiptId: row.receipt_id, proposalId: row.proposal_id, proposalHash: row.proposal_hash,
          dependencyHash: row.dependency_hash, engineResultSha256: row.engine_result_sha256 ?? null, revisionResultSha256: row.sealed_hash ?? null,
          modelRef: modelRef(row.model_ref), routeText: nullableString(row.route_text), rawLengthMeters: finite(row.raw_length),
          designLengthMeters: nullableString(row.design_length), unroundedMeters: nullableString(row.unrounded_length), ledgerHash: row.ledger_sha256 ?? null,
          appliedAt: iso(row.applied_at), afterCableWriteRevision: row.after_revision ?? null, afterRouting: row.after_routing ?? null,
          afterDesignLength: nullableString(row.after_design_length) } }).lastAcceptedApply;
      result.set(cableId, value);
    }
  }
  return result;
}
/** Caller owns the existing project, authority, dependency and sorted cable locks. */
export async function persistRevisionAdmission(client: PoolClient, input: RevisionAdmissionInput): Promise<string> {
  const projectId = policyUuidSchema.parse(input.projectId), jobId = input.jobId === null ? null : policyUuidSchema.parse(input.jobId),
    generation = input.generation === null ? null : policyRevisionSchema.parse(input.generation), options = optionsSchema.parse(input.options);
  if (input.kind === 'automatic' ? generation === null : generation !== null || jobId === null) return fail('REVISION_ADMISSION_SCOPE_INVALID', 500);
  policyHashSchema.parse(input.inputSha256);
  if (!input.items.length || input.items.length > REVISION_RESULTS_LIMITS.cables) return fail('REVISION_ADMISSION_CABLE_LIMIT', 413);
  const snapshots = input.items.map(item => cableSnapshot(item.cable)).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(snapshots.map(c => c.id)).size !== snapshots.length) return fail('REVISION_ADMISSION_DUPLICATE_CABLE', 500);
  const itemById = new Map(input.items.map(item => [String(item.cable.id), item]));
  const old = (await client.query<Row>(admissionSelect + ' WHERE project_id=$1 AND ((job_id=$2 AND $2::uuid IS NOT NULL) OR (kind=\'automatic\' AND generation=$3::bigint))', [projectId, jobId, generation])).rows;
  if (old.length) {
    if (old.length !== 1 || old[0].input_sha256 !== input.inputSha256 || old[0].job_id !== jobId || old[0].kind !== input.kind
      || (old[0].generation ?? null) !== generation || old[0].total !== input.items.length || !equal(old[0].options, options)) return fail('REVISION_ADMISSION_CONFLICT');
    const identities = (await client.query<{ cable_id: string }>('SELECT cable_id FROM pf_revision_baselines WHERE project_id=$1 AND admission_id=$2 ORDER BY cable_id LIMIT 10001', [projectId, old[0].id])).rows;
    if (identities.length !== snapshots.length || identities.some((row, at) => row.cable_id !== snapshots[at].id)) return fail('REVISION_ADMISSION_CONFLICT');
    return policyUuidSchema.parse(old[0].id);
  }
  const accepted = await acceptedBaselines(client, projectId, snapshots.map(c => c.id)), observedEvents = generation === null ? [] :
    (await client.query<Row>('SELECT generation::text,domain,reason,source_revision FROM pf_recalculation_events WHERE project_id=$1 AND generation=$2::bigint ORDER BY generation LIMIT 65', [projectId, generation])).rows
      .map(row => ({ generation: row.generation, domain: row.domain, reason: row.reason, sourceRevisionSha256: row.source_revision === null ? null : revisionResultHash(row.source_revision) }));
  revisionResultEnvelopeSchema.shape.observedEvents.parse(observedEvents);
  const id = randomUUID(), selectedModel = input.modelRef === undefined ? modelRef(input.items.find(i => i.dependencies)?.dependencies?.model) : input.modelRef;
  if (selectedModel !== null) revisionModelRefSchema.parse(selectedModel);
  const items = snapshots.map(currentCable => {
    const lastAcceptedApply = accepted.get(currentCable.id) ?? null, item = itemById.get(currentCable.id)!;
    const acceptedMatchesCurrent = lastAcceptedApply !== null && lastAcceptedApply.afterCableWriteRevision === currentCable.cableWriteRevision
      && lastAcceptedApply.afterRouting === currentCable.routing && numericEqual(lastAcceptedApply.afterDesignLength, currentCable.designLength);
    const baseline = bounded(revisionBaselineSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-baseline.v1', currentCable, lastAcceptedApply, acceptedMatchesCurrent }), REVISION_RESULTS_LIMITS.baselineBytes);
    if (typeof item.status !== 'string' || !item.status || item.status.length > 96 || typeof item.message !== 'string' || item.message.length > 32768) return fail('REVISION_ADMISSION_DIAGNOSTIC_INVALID', 500);
    return { cable_id: currentCable.id, baseline_sha256: revisionResultHash(baseline), baseline, status: item.status, message: item.message };
  });
  bounded(items, REVISION_RESULTS_LIMITS.admissionBytes);
  // node-postgres encodes a native array as a PostgreSQL array, including [] ->
  // '{}'. This JSONB array must cross the wire as JSON text instead.
  await client.query(`INSERT INTO pf_revision_admissions(id,project_id,job_id,generation,kind,input_sha256,options,model_ref,total,observed_events)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [id, projectId, jobId, generation, input.kind, input.inputSha256, options, selectedModel, items.length, JSON.stringify(observedEvents)]);
  for (let at = 0; at < items.length; at += REVISION_RESULTS_LIMITS.chunk) await client.query(`INSERT INTO pf_revision_baselines(project_id,admission_id,cable_id,baseline_sha256,baseline,status,message)
    SELECT $1,$2,x.cable_id,x.baseline_sha256,x.baseline,x.status,x.message FROM jsonb_to_recordset($3::jsonb)
    AS x(cable_id uuid,baseline_sha256 text,baseline jsonb,status text,message text)`, [projectId, id, JSON.stringify(items.slice(at, at + REVISION_RESULTS_LIMITS.chunk))]);
  // This is a new admission in the caller's existing project/authority
  // transaction. Historical admissions and exact replays above are untouched.
  await registerAutoLengthAdmission(client, { projectId, admissionId: id, jobId,
    cableIds: snapshots.map(cable => cable.id) });
  return id;
}
function verifiedBaseline(row: Row): RevisionBaseline {
  const baseline = revisionBaselineSchema.parse(row.baseline); if (revisionResultHash(baseline) !== row.baseline_sha256) return fail('REVISION_BASELINE_INTEGRITY', 500); return baseline;
}
export async function readRevisionBaseline(client: PoolClient, input: { projectId: string; jobId: string; cableId: string }): Promise<{ admissionId: string; baseline: RevisionBaseline; baselineHash: string }> {
  const row = (await client.query<Row>(`SELECT b.*,a.id AS admission_id FROM pf_revision_admissions a JOIN pf_revision_baselines b ON b.project_id=a.project_id AND b.admission_id=a.id
    WHERE a.project_id=$1 AND a.job_id=$2 AND b.cable_id=$3`, [policyUuidSchema.parse(input.projectId), policyUuidSchema.parse(input.jobId), policyUuidSchema.parse(input.cableId)])).rows[0];
  if (!row) return fail('REVISION_BASELINE_REQUIRED'); return { admissionId: String(row.admission_id), baseline: verifiedBaseline(row), baselineHash: policyHashSchema.parse(row.baseline_sha256) };
}
function verifiedEnvelope(row: Row): RevisionResultEnvelope {
  const result = revisionResultEnvelopeSchema.parse(row.record), { revisionResultSha256, ...body } = result;
  if (revisionResultHash(body) !== revisionResultSha256 || row.record_sha256 !== revisionResultSha256 || row.project_id !== result.projectId
    || row.proposal_id !== result.proposalId || row.cable_id !== result.cableId || row.admission_id !== result.admissionId
    || row.baseline_sha256 !== result.baselineHash || row.dependency_sha256 !== result.dependencyHash || row.engine_result_sha256 !== result.engineResultSha256
    || row.ledger_sha256 !== result.ledgerHash) return fail('REVISION_RESULT_INTEGRITY', 500);
  return result;
}
export async function sealRevisionResult(client: PoolClient, input: { projectId: string; jobId: string; cableId: string; proposalId: string;
  dependencyHash: string; result: unknown; dependencies: DependencySnapshot }): Promise<RevisionResultEnvelope> {
  const baseline = await readRevisionBaseline(client, input), result = object(input.result); if (!result) return fail('REVISION_RESULT_INVALID', 500);
  const proposal = (await client.query<Row>('SELECT project_id,id,job_id,cable_id,proposal_hash,dependency_hash,dependencies,result FROM pf_proposals WHERE project_id=$1 AND id=$2', [input.projectId, input.proposalId])).rows[0];
  const expectedProposalHash = revisionResultHash({ dependencies: input.dependencies, result: input.result, baselineHash: baseline.baselineHash });
  if (!proposal || proposal.job_id !== input.jobId || proposal.cable_id !== input.cableId || proposal.dependency_hash !== input.dependencyHash
    || revisionResultHash(input.dependencies) !== input.dependencyHash || proposal.proposal_hash !== expectedProposalHash
    || !equal(proposal.dependencies, input.dependencies) || !equal(proposal.result, input.result)) return fail('REVISION_PROPOSAL_CONFLICT', 500);
  const existing = (await client.query<Row>('SELECT * FROM pf_revision_results WHERE project_id=$1 AND proposal_id=$2', [input.projectId, input.proposalId])).rows[0];
  if (existing) { const value = verifiedEnvelope(existing); if (value.proposalHash !== expectedProposalHash || value.baselineHash !== baseline.baselineHash
    || value.engineResultSha256 !== revisionResultHash(input.result) || value.dependencyHash !== input.dependencyHash) return fail('REVISION_RESULT_CONFLICT'); return value; }
  const admission = (await client.query<Row>(admissionSelect + ' WHERE project_id=$1 AND id=$2', [input.projectId, baseline.admissionId])).rows[0];
  if (!admission || admission.job_id !== input.jobId) return fail('REVISION_ADMISSION_REQUIRED');
  if (result.calculationMode !== 'calculate' && result.calculationMode !== 'design') return fail('REVISION_CALCULATION_MODE_REQUIRED', 500);
  const { calculationMode: _mode, ...response } = result;
  const route = object(result.route), design = object(result.design), ledger = requireCalculationLengthLedger(engineResponseSchema.parse(response), input.dependencies.settings),
    accepted = baseline.baseline.acceptedMatchesCurrent ? baseline.baseline.lastAcceptedApply : null;
  const successfulGeometry = route?.success === true, successfulDesign = result.status === 'calculated' && successfulGeometry && design !== null && ledger !== null;
  if (result.status === 'calculated' && !successfulDesign) return fail('REVISION_CALCULATION_OUTPUT_INCONSISTENT', 500);
  // Failed route objects contain Runner placeholders. Their sealed payload stays intact,
  // but those zeros/empty strings are not an observed new geometry or design.
  const rawLengthMeters = successfulGeometry ? finite(route?.lengthMeters) : null,
    designLengthMeters = successfulDesign ? nullableString(design?.designLengthMeters) : null,
    unroundedMeters = successfulDesign ? nullableString(design?.unroundedLengthMeters) : null;
  const reasonCodes = new Set<string>(); if (!accepted) reasonCodes.add('ACCEPTED_CURRENT_BASELINE_UNAVAILABLE');
  if (accepted?.modelRef && !equal(accepted.modelRef, input.dependencies.model)) reasonCodes.add('OBSERVED_MODEL_REFERENCE_CHANGED');
  if (accepted && accepted.dependencyHash !== input.dependencyHash) reasonCodes.add('OBSERVED_DEPENDENCIES_CHANGED');
  if (accepted && successfulGeometry && accepted.routeText !== route?.routeText) reasonCodes.add('OBSERVED_ROUTE_TEXT_CHANGED');
  if (result.status !== 'calculated') reasonCodes.add(successfulGeometry ? 'DESIGN_OUTPUT_UNAVAILABLE' : 'CALCULATION_OUTPUT_UNAVAILABLE');
  const fullRouteText = successfulGeometry ? nullableString(route?.routeText) : null;
  if (fullRouteText !== null && fullRouteText.length > 8000) reasonCodes.add('ROUTING_OUTSIDE_WFC_LIMIT');
  const summary = { calculationMode: result.calculationMode === 'design' ? 'design' as const : 'calculate' as const, newModel: modelRef(input.dependencies.model),
    routeText: fullRouteText !== null && fullRouteText.length <= 8000 ? fullRouteText : null, rawLengthMeters, designLengthMeters, unroundedMeters,
    delta: { rawLengthMeters: accepted?.rawLengthMeters !== null && accepted?.rawLengthMeters !== undefined && rawLengthMeters !== null ? rawLengthMeters - accepted.rawLengthMeters : null,
      designLengthMeters: designLengthMeters !== null && baseline.baseline.currentCable.designLength !== null ? decimalDifference(designLengthMeters, baseline.baseline.currentCable.designLength) : null,
      unroundedMeters: unroundedMeters !== null && accepted?.unroundedMeters !== null && accepted?.unroundedMeters !== undefined ? decimalDifference(unroundedMeters, accepted.unroundedMeters) : null,
      baseline: accepted ? 'accepted-current' as const : baseline.baseline.currentCable.designLength !== null ? 'current-values' as const : 'unavailable' as const }, reasonCodes: [...reasonCodes].sort() };
  const comparison = 'comparison' in input.dependencies ? object(input.dependencies.comparison) : null;
  const comparisonScope = comparison === null ? null : { comparisonId: comparison.comparisonId, comparisonRevision: comparison.comparisonRevision, decisionSetSha256: comparison.decisionSetSha256 };
  const draft = revisionResultEnvelopeSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-result.v1', id: randomUUID(), projectId: input.projectId,
    admissionId: baseline.admissionId, jobId: input.jobId, cableId: input.cableId, proposalId: input.proposalId, proposalHash: expectedProposalHash,
    baselineHash: baseline.baselineHash, dependencyHash: input.dependencyHash, engineResultSha256: revisionResultHash(input.result),
    ledgerHash: ledger === null ? null : revisionResultHash(ledger), oldModel: accepted?.modelRef ?? null, summary, comparisonRef: comparisonScope,
    observedEvents: admission.observed_events, lengthLedger: ledger, physicalChangeProven: false, createdAt: new Date().toISOString(), revisionResultSha256: '0'.repeat(64) });
  const { revisionResultSha256: _hash, ...body } = draft, envelope = bounded(revisionResultEnvelopeSchema.parse({ ...draft, revisionResultSha256: revisionResultHash(body) }), REVISION_RESULTS_LIMITS.envelopeBytes);
  await client.query(`INSERT INTO pf_revision_results(id,project_id,admission_id,job_id,cable_id,proposal_id,baseline_sha256,dependency_sha256,engine_result_sha256,ledger_sha256,record_sha256,record)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [envelope.id, input.projectId, baseline.admissionId, input.jobId, input.cableId, input.proposalId,
    envelope.baselineHash, envelope.dependencyHash, envelope.engineResultSha256, envelope.ledgerHash, envelope.revisionResultSha256, envelope]);
  return envelope;
}
/** A missing legacy seal is readable but cannot authorize a fresh Review/Apply. */
export async function verifyRevisionResultForProposal(client: PoolClient, input: { projectId: string; proposalId: string; result: unknown; dependencies: unknown; proposalHash?: string }): Promise<RevisionResultEnvelope | null> {
  const row = (await client.query<Row>('SELECT * FROM pf_revision_results WHERE project_id=$1 AND proposal_id=$2', [policyUuidSchema.parse(input.projectId), policyUuidSchema.parse(input.proposalId)])).rows[0];
  if (!row) return null; const envelope = verifiedEnvelope(row);
  if (envelope.engineResultSha256 !== revisionResultHash(input.result) || envelope.dependencyHash !== revisionResultHash(input.dependencies)
    || input.proposalHash !== undefined && envelope.proposalHash !== input.proposalHash
    || envelope.proposalHash !== revisionResultHash({ dependencies: input.dependencies, result: input.result, baselineHash: envelope.baselineHash })) return fail('REVISION_RESULT_PROPOSAL_INTEGRITY', 500);
  const baseline = (await client.query<Row>('SELECT * FROM pf_revision_baselines WHERE project_id=$1 AND admission_id=$2 AND cable_id=$3', [input.projectId, envelope.admissionId, envelope.cableId])).rows[0];
  if (!baseline || revisionResultHash(verifiedBaseline(baseline)) !== envelope.baselineHash) return fail('REVISION_BASELINE_INTEGRITY', 500);
  return envelope;
}

const pageOptions = z.object({ afterCableId: policyUuidSchema.optional(), limit: z.coerce.number().int().min(1).max(REVISION_RESULTS_LIMITS.pageSize).default(50) }).strict();
const listOptions = z.object({ cursor: z.string().max(512).regex(/^[A-Za-z0-9_-]+$(?![\s\S])/).optional(), limit: z.coerce.number().int().min(1).max(REVISION_RESULTS_LIMITS.pageSize).default(50) }).strict();
const cursorSchema = z.object({ createdAt: z.string().datetime({ offset: false }), id: policyUuidSchema }).strict();
function decodeCursor(raw: string | undefined) { if (!raw) return null; try { const text = Buffer.from(raw, 'base64url').toString('utf8'), value = cursorSchema.parse(JSON.parse(text));
  if (Buffer.from(JSON.stringify(value)).toString('base64url') !== raw) return fail('REVISION_CURSOR_INVALID', 400); return value; } catch { return fail('REVISION_CURSOR_INVALID', 400); } }
type CurrentDisplay=RevisionCurrentness&{itemApplicability?:SealedCableItemApplicability|null};
function projection(row: Row, current: CurrentDisplay): RevisionResultRow {
  const {itemApplicability,...currentness}=current;
  const baseline = verifiedBaseline(row), envelope = row.record === null || row.record === undefined ? null : verifiedEnvelope({ ...row, ...object(row.sealed_row) });
  const failedWithoutOutput = envelope === null && row.job_state === 'failed', cancelledWithoutOutput = envelope === null && row.job_state === 'cancelled';
  return revisionResultRowSchema.parse({ cableId: row.cable_id, baseline, baselineHash: row.baseline_sha256,
    status: envelope ? row.proposal_status : failedWithoutOutput ? 'failed' : cancelledWithoutOutput ? 'cancelled' : row.item_status ?? row.status,
    message: failedWithoutOutput ? row.job_failure ?? 'The calculation job failed before producing this cable result.' : cancelledWithoutOutput ? 'The calculation job was cancelled before producing this cable result.' : row.item_message ?? row.message,
    result: envelope ? { ...envelope.summary, proposalId: envelope.proposalId, proposalHash: envelope.proposalHash, revisionResultSha256: envelope.revisionResultSha256,
      engineResultSha256: envelope.engineResultSha256, ledgerHash: envelope.ledgerHash, dependencyHash: envelope.dependencyHash } : null, currentness,...(itemApplicability?{itemApplicability}:{}) });
}
const cablePageSql = `SELECT b.*,i.status AS item_status,i.message AS item_message,p.status AS proposal_status,coalesce(p.dependencies->>'schemaVersion',i.dependencies->>'schemaVersion') AS dependency_version,p.dependency_hash,p.id AS proposal_id,s.record,to_jsonb(s) AS sealed_row,j.state AS job_state,j.failure AS job_failure,j.cancel_requested
 FROM pf_revision_baselines b JOIN pf_revision_admissions a ON a.project_id=b.project_id AND a.id=b.admission_id
 LEFT JOIN pf_jobs j ON j.project_id=a.project_id AND j.id=a.job_id
 LEFT JOIN pf_job_items i ON i.project_id=b.project_id AND i.job_id=a.job_id AND i.cable_id=b.cable_id
 LEFT JOIN pf_revision_results s ON s.project_id=b.project_id AND s.admission_id=b.admission_id AND s.cable_id=b.cable_id
 LEFT JOIN pf_proposals p ON p.project_id=s.project_id AND p.id=s.proposal_id`;
export function createRevisionResults(pool: Pool, adapters: { collectCurrentPage?: typeof collectDependencyBatchInTransaction } = {}) {
  const collect = adapters.collectCurrentPage ?? collectDependencyBatchInTransaction;
  const tx = <T>(projectId: string, who: JobPrincipal, run: (client: PoolClient) => Promise<T>) => principalTransaction(pool, policyUuidSchema.parse(projectId), who, run);
  const readAdmission = async (client: PoolClient, projectId: string, admissionId: string) => {
    const row = (await client.query<Row>(admissionSelect + ' WHERE project_id=$1 AND id=$2', [projectId, policyUuidSchema.parse(admissionId)])).rows[0];
    if (!row) return fail('REVISION_ADMISSION_NOT_FOUND', 404); metadata(row); return row;
  };
  async function currentPage(client: PoolClient, admission: Row, page: Row[]): Promise<Map<string, CurrentDisplay>> {
    const result = new Map<string, CurrentDisplay>(), ids = page.map(r => String(r.cable_id)); if (!ids.length) return result;
    const currentRows = (await client.query<{ id: string; cable_write_revision: string }>('SELECT id,cable_write_revision::text FROM cables WHERE project_id=$1 AND id=ANY($2::uuid[]) ORDER BY id', [admission.project_id, ids])).rows;
    const revisions = new Map(currentRows.map(r => [r.id, r.cable_write_revision]));
    const items=new Map<string,Awaited<ReturnType<typeof collect>>['items'][number]>(), unavailable=new Map<string,string>();
    const options=optionsSchema.parse(admission.options);
    const version=(row:Row)=>row.dependency_version==='pathfinder.dependencies.v8'?'pathfinder.dependencies.v8'
      :row.dependency_version==='pathfinder.dependencies.v7'?'pathfinder.dependencies.v7'
        :!row.dependency_version&&options.barrierRouting?'pathfinder.dependencies.v8':'pathfinder.dependencies.v5';
    // Preserve the historical default v5 projection, and collect each newer
    // mathematical body separately. v8 can never enter the legacy collector.
    for(const dependencyVersion of ['pathfinder.dependencies.v5','pathfinder.dependencies.v7','pathfinder.dependencies.v8'] as const){
      const selected=currentRows.filter(r=>page.some(row=>row.cable_id===r.id&&version(row)===dependencyVersion));
      if(!selected.length)continue;
      try { const batch=await collect(client,{projectId:String(admission.project_id),options,cableIds:selected.map(r=>r.id),...(dependencyVersion==='pathfinder.dependencies.v5'?{}:{dependencyVersion})});for(const item of batch.items)items.set(item.id,item); }
      catch(error){if(!(error instanceof PathFinderError))throw error;for(const item of selected)unavailable.set(item.id,error.code);}
    }
    const authority = admission.job_id === null ? null : await readRecalculationJobAuthority(client, { projectId: String(admission.project_id), jobId: String(admission.job_id) });
    for (const row of page) {
      const id = String(row.cable_id), baseline = verifiedBaseline(row), envelope = object(row.record), current = revisions.get(id);
      if (current === undefined) result.set(id, { state: 'missing', reasonCodes: ['CABLE_NOT_FOUND'] });
      else if (current !== baseline.currentCable.cableWriteRevision) result.set(id, { state: 'changed', reasonCodes: ['CABLE_WRITE_REVISION_CHANGED'] });
      else if (version(row) !== 'pathfinder.dependencies.v8') result.set(id, { state: 'unavailable', reasonCodes: ['BARRIER_WRITE_PROOF_REQUIRED'] });
      else if (authority?.enrolled && !authority.valid) result.set(id, { state: 'changed', reasonCodes: [authority.code ?? 'AUTOMATIC_AUTHORITY_CHANGED'] });
      else if (!envelope) result.set(id, { state: 'unavailable', reasonCodes: ['CALCULATION_OUTPUT_UNAVAILABLE'] });
      else if (row.proposal_status !== 'calculated') result.set(id, { state: 'unavailable', reasonCodes: ['CALCULATION_OUTPUT_NOT_APPLICABLE'] });
      else if (!items.get(id)?.dependencies) result.set(id, { state: 'unavailable', reasonCodes: [unavailable.get(id)??'CURRENT_DEPENDENCIES_UNAVAILABLE'] });
      else {
        const currentHash=revisionResultHash(items.get(id)!.dependencies),equal=currentHash===envelope.dependencyHash;
        const scoped=row.dependency_version==='pathfinder.dependencies.v7'||row.dependency_version==='pathfinder.dependencies.v8';
        const perCable=admission.job_id!==null&&scoped?await readRecalculationJobAuthority(client,{projectId:String(admission.project_id),jobId:String(admission.job_id),cableId:id}):authority;
        if(perCable?.enrolled&&!perCable.valid){result.set(id,{state:'changed',reasonCodes:[perCable.code]});continue;}
        const sealed=equal&&scoped?verifiedEnvelope({...row,...object(row.sealed_row)}):null;
        const applicable=sealed?await readProposalApplicability(client,{projectId:String(admission.project_id),jobId:sealed.jobId,cableId:id,proposalId:sealed.proposalId,
          dependencyVersion:String(row.dependency_version),dependencyHash:sealed.dependencyHash,jobState:String(row.job_state),cancelRequested:row.cancel_requested===true,seal:sealed}):null;
        if(equal&&row.dependency_version==='pathfinder.dependencies.v8'&&!applicable?.applicable){
          result.set(id,{state:'unavailable',reasonCodes:['BARRIER_ITEM_PROOF_UNAVAILABLE']});continue;
        }
        result.set(id,{state:equal?'current':'changed',reasonCodes:equal?[]:['CALCULATION_DEPENDENCIES_CHANGED'],itemApplicability:applicable?.evidence??null});
      }
    }
    return result;
  }
  return {
    listAdmissions: (projectId: string, who: JobPrincipal, raw: { cursor?: string; limit?: number } = {}) => tx(projectId, who, async client => {
      const opts = listOptions.parse(raw), cursor = decodeCursor(opts.cursor), rows = (await client.query<Row>(admissionSelect +
        ' WHERE project_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4',
        [projectId, cursor?.createdAt ?? null, cursor?.id ?? null, opts.limit + 1])).rows, page = rows.slice(0, opts.limit).map(metadata), last = page.at(-1);
      const cursorTime = rows[Math.min(rows.length, opts.limit) - 1]?.cursor_created_at;
      if (rows.length > page.length && typeof cursorTime !== 'string') return fail('REVISION_CURSOR_PRECISION_REQUIRED', 500);
      return bounded(revisionAdmissionsPageSchema.parse({ schemaVersion: 'wfc.pf.revision-admissions-page.v1', projectId, admissions: page,
        nextCursor: rows.length > page.length && last ? Buffer.from(JSON.stringify({ createdAt: cursorTime, id: last.id })).toString('base64url') : null }), REVISION_RESULTS_LIMITS.pageBytes);
    }),
    listPage: (projectId: string, who: JobPrincipal, admissionId: string, raw: { afterCableId?: string; limit?: number } = {}) => tx(projectId, who, async client => {
      const opts = pageOptions.parse(raw), admission = await readAdmission(client, projectId, admissionId), candidates = (await client.query<Row>(cablePageSql +
        ' WHERE b.project_id=$1 AND b.admission_id=$2 AND ($3::uuid IS NULL OR b.cable_id>$3::uuid) ORDER BY b.cable_id LIMIT $4', [projectId, admissionId, opts.afterCableId ?? null, opts.limit + 1])).rows;
      const selected = candidates.slice(0, opts.limit), current = await currentPage(client, admission, selected), rows: RevisionResultRow[] = []; let bytes = 1024;
      for (const row of selected) { const value = projection(row, current.get(String(row.cable_id))!); const size = Buffer.byteLength(canonicalPurposeJson(value));
        if (bytes + size > REVISION_RESULTS_LIMITS.pageBytes) break; bytes += size; rows.push(value); }
      if (selected.length && !rows.length) return fail('REVISION_RESULT_BYTES', 413);
      return bounded(revisionResultsPageSchema.parse({ schemaVersion: 'wfc.pf.revision-results-page.v1', projectId, admissionId, rows,
        nextAfterCableId: candidates.length > rows.length ? rows.at(-1)?.cableId ?? null : null }), REVISION_RESULTS_LIMITS.pageBytes);
    }),
    detail: (projectId: string, who: JobPrincipal, admissionId: string, cableId: string) => tx(projectId, who, async client => {
      const admission = await readAdmission(client, projectId, admissionId), raw = (await client.query<Row>(cablePageSql + ' WHERE b.project_id=$1 AND b.admission_id=$2 AND b.cable_id=$3', [projectId, admissionId, policyUuidSchema.parse(cableId)])).rows[0];
      if (!raw) return fail('REVISION_CABLE_NOT_FOUND', 404); const current = await currentPage(client, admission, [raw]), row = projection(raw, current.get(cableId)!);
      const proposal = row.result === null ? null : (await client.query<Row>('SELECT dependencies,result,proposal_hash FROM pf_proposals WHERE project_id=$1 AND id=$2', [projectId, row.result.proposalId])).rows[0];
      const envelope = proposal ? await verifyRevisionResultForProposal(client, { projectId, proposalId: row.result!.proposalId, result: proposal.result, dependencies: proposal.dependencies, proposalHash: String(proposal.proposal_hash) }) : null;
      return bounded(revisionResultDetailSchema.parse({ schemaVersion: 'wfc.pf.revision-result-detail.v1', projectId, admissionId, row, envelope,
        engineResult: proposal?.result ?? null, dependencies: proposal?.dependencies ?? null }), REVISION_RESULTS_LIMITS.detailBytes);
    }),
  };
}
