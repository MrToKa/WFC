import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AUTOMATIC_PAIR_LIMITS, automaticPairHistorySchema, automaticPairProvenanceSchema, automaticPairCapacityClearProvenanceSchema, automaticPairWriteRequestSchema,
  sameAutomaticPairValue, type AutomaticPairOutcome, type AutomaticPairMandate, type AutomaticPairWriteRequest } from '../../shared/pathfinderAutomaticPair.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { automaticPairHash, automaticPairIdempotencyKey, automaticPairOwnTransition, automaticPairDecimalEqual, automaticPairHistoryMatches,
  readAutomaticPairReceiptProof } from './automaticPairReceiptProof.js';
import { readAutomaticPairOwnership } from './automaticPairOwnership.js';
import { readAutomaticPairMandate, requireCurrentAutomaticPairMandate } from './automaticPairMandates.js';
import { endpointBindingTransaction } from './endpointBindingRepository.js';
import { schedulerTransaction } from './schedulerTransaction.js';
import { collectDependenciesForVersion, hash } from './dependencies.js';
import { verifyRevisionResultForProposal } from './revisionResultRepository.js';
import { readProposalApplicability, readAutomaticPairProposalApplicability } from './proposalApplicability.js';
import { requireBarrierWriteEvidence, requireCurrentBarrierWriteScope } from './barrierWrites.js';
import { requireCalculationLengthLedger } from './lengthLedger.js';
import { readSnapshot } from './storage.js';
import { recordPathFinderCableHistory } from './cableWriteHistory.js';
import { PathFinderError } from './errors.js';
import type { BarrierDependencySnapshot, EngineResponse } from './jobContracts.js';
import { readVerifiedSameEndpointCurrent, type VerifiedSameEndpointCurrent } from './verifiedSameEndpointReuse.js';
import { isCapacityNoPathResult, automaticPairCapacityClearTransition, readCurrentCapacityClearEvidence, capacityClearItemApplicable,
  validCapacityClearEvidence, readCurrentPositiveCapacity, type CapacityClearEvidence } from './capacityClearWrite.js';

type Row = Record<string, any>;
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'Automatic routing and Design length update was refused; current values are retained.'); };
export type AutomaticPairClaim = { projectId: string; jobId: string; cableId: string; ownerToken: string; leaseExpiresAt: string };
export type AutomaticPairRecoveryKey = Pick<AutomaticPairClaim, 'projectId' | 'jobId' | 'cableId'>;
export { automaticPairIdempotencyKey } from './automaticPairReceiptProof.js';
export type AutomaticPairWriterAdapters = { collect?: typeof collectDependenciesForVersion; barrierFence?: typeof requireCurrentBarrierWriteScope;
  snapshot?: typeof readSnapshot; seal?: typeof verifyRevisionResultForProposal; applicability?: typeof readProposalApplicability;
  ownership?: typeof readAutomaticPairOwnership; proof?: typeof readAutomaticPairReceiptProof; mandateFence?: typeof requireCurrentAutomaticPairMandate;
  history?: typeof recordPathFinderCableHistory;
  capacityEvidence?: typeof readCurrentCapacityClearEvidence; clearApplicability?: typeof capacityClearItemApplicable;
  currentPositiveCapacity?: typeof readCurrentPositiveCapacity;
  verifiedCurrent?: (client: PoolClient, dependencies: BarrierDependencySnapshot, result: unknown, signal?: AbortSignal) => Promise<VerifiedSameEndpointCurrent | null> };
/** A separate exact-result writer. Calculation-only workers never gain writes merely by publishing AutoLength. */
export function createAutomaticPairWriter(pool: Pool, adapters: AutomaticPairWriterAdapters = {}) {
  const collect = adapters.collect ?? collectDependenciesForVersion, barrierFence = adapters.barrierFence ?? requireCurrentBarrierWriteScope,
    sealResult = adapters.seal ?? verifyRevisionResultForProposal, proof = adapters.proof ?? readAutomaticPairReceiptProof,
    mandateFence = adapters.mandateFence ?? requireCurrentAutomaticPairMandate, ownership = adapters.ownership ?? readAutomaticPairOwnership;
  async function load(client: PoolClient, claim: AutomaticPairRecoveryKey) {
    const mandate = await readAutomaticPairMandate(client, claim); if (!mandate) return fail('AUTOMATIC_PAIR_MANDATE_REQUIRED');
    const rows = (await client.query<Row>(`/* automatic-pair:result */ SELECT p.id,p.job_id,p.cable_id,p.proposal_hash,p.dependency_hash,p.status,p.dependencies,p.result,
      j.state AS job_state,j.cancel_requested,j.request_hash,i.state AS item_state,i.status AS item_status FROM pf_proposals p
      JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id
      JOIN pf_job_items i ON i.project_id=p.project_id AND i.job_id=p.job_id AND i.cable_id=p.cable_id
      WHERE p.project_id=$1 AND p.job_id=$2 AND p.cable_id=$3
      AND octet_length(p.dependencies::text)+octet_length(p.result::text)<=262144 FOR SHARE OF p,i,j`, [claim.projectId, claim.jobId, claim.cableId])).rows;
    if (rows.length !== 1) return fail('AUTOMATIC_PAIR_EXACT_RESULT_REQUIRED'); const p = rows[0];
    if (p.job_id !== mandate.jobId || p.cable_id !== mandate.cableId || p.request_hash !== mandate.requestSha256)
      return fail('AUTOMATIC_PAIR_EXACT_REQUEST_REQUIRED');
    const body = { schemaVersion: 'wfc.pf.automatic-pair-write.v1' as const, mandateId: mandate.id, mandateSha256: mandate.contentSha256,
      projectId: mandate.projectId, jobId: mandate.jobId, cableId: mandate.cableId, proposalId: p.id, proposalHash: p.proposal_hash,
      expectedCableWriteRevision: mandate.cableWriteRevision };
    const request = automaticPairWriteRequestSchema.parse({ ...body, idempotencyKey: automaticPairIdempotencyKey(body) });
    return { mandate, p, request };
  }
  async function previous(client: PoolClient, m: AutomaticPairMandate, request: AutomaticPairWriteRequest): Promise<AutomaticPairOutcome | null> {
    const rows = (await client.query<Row>(`/* automatic-pair:existing-receipt */ SELECT id,payload_hash FROM pf_apply_receipts
      WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 LIMIT 2`, [m.projectId, m.actorId, request.idempotencyKey])).rows;
    if (!rows.length) return null;
    if (rows.length !== 1 || rows[0].payload_hash !== automaticPairHash(request)
      || !await proof(client, { projectId: m.projectId, cableId: m.cableId, receiptId: rows[0].id })) return fail('AUTOMATIC_PAIR_RECEIPT_INTEGRITY');
    return { status: 'already-written', receiptId: rows[0].id };
  }
  return {
  /** Business-read-only reconciliation. The caller supplies a transaction; no
   * authority is renewed and no cable write or new claim is attempted here. */
  async inspectInTransaction(client: PoolClient, key: AutomaticPairRecoveryKey, signal?: AbortSignal): Promise<AutomaticPairOutcome> {
    signal?.throwIfAborted();
    const project = await client.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [key.projectId]);
    if (project.rows.length !== 1) return fail('AUTOMATIC_PAIR_RECOVERY_PROJECT_REQUIRED');
    const dispatch = (await client.query<Row>(`/* automatic-pair:recovery-fence */ SELECT status,attempts,owner_token,lease_until
      FROM pf_automatic_pair_dispatch WHERE project_id=$1 AND job_id=$2 AND cable_id=$3 FOR UPDATE`,
    [key.projectId, key.jobId, key.cableId])).rows;
    if (dispatch.length !== 1 || dispatch[0].status !== 'unknown' || dispatch[0].attempts !== AUTOMATIC_PAIR_LIMITS.attempts
      || dispatch[0].owner_token !== null || dispatch[0].lease_until !== null) return fail('AUTOMATIC_PAIR_RECOVERY_FENCED');
    // A writer must hold this same dispatch row until its business transaction
    // commits. Acquiring it after the project mutex proves every older writer
    // either committed already or cannot pass its next exact owner fence.
    const loaded = await load(client, key), committed = await previous(client, loaded.mandate, loaded.request);
    signal?.throwIfAborted();
    return committed ?? { status: 'refused', receiptId: null, code: 'AUTOMATIC_PAIR_NOT_WRITTEN_CONFIRMED' };
  }, async apply(claim: AutomaticPairClaim, fence: (client: PoolClient, claim: AutomaticPairClaim) => Promise<void>, signal?: AbortSignal): Promise<AutomaticPairOutcome> {
    signal?.throwIfAborted();
    // Read reconciliation is intentionally before current authority. An old
    // committed write remains recognizable after its finite mandate expires.
    const observed = await schedulerTransaction(pool, async client => { const loaded = await load(client, claim);
      return { ...loaded, previous: await previous(client, loaded.mandate, loaded.request) }; }, signal);
    if (observed.previous) return observed.previous;
    const m = observed.mandate, who = { userId: m.actorId, loginId: m.loginId, loginExpiresAt: Date.parse(m.loginExpiresAt) };
    const committed = await endpointBindingTransaction(pool, m.projectId, who, async client => {
      await fence(client, claim); const loaded = await load(client, claim), { p, request } = loaded;
      if (!sameAutomaticPairValue(loaded.mandate, m)) return fail('AUTOMATIC_PAIR_MANDATE_CHANGED');
      const replay = await previous(client, m, request); if (replay) return replay;
      await mandateFence(client, m);
      const dependencies = p.dependencies as BarrierDependencySnapshot, result = p.result as EngineResponse;
      const capacityClear = isCapacityNoPathResult(dependencies, result), expectedStatus = capacityClear ? 'no_path' : 'calculated';
      if (p.job_id !== m.jobId || p.cable_id !== m.cableId || p.status !== expectedStatus || p.item_state !== 'complete' || p.item_status !== expectedStatus
        || p.cancel_requested || !['queued', 'running', 'complete'].includes(p.job_state) || dependencies?.schemaVersion !== 'pathfinder.dependencies.v8'
        || dependencies.cableWriteRevision !== m.cableWriteRevision || hash(dependencies) !== m.dependencyHash || p.dependency_hash !== m.dependencyHash
        || (!capacityClear && (result?.status !== 'calculated' || !result.route?.success || !result.design))) return fail('AUTOMATIC_PAIR_EXACT_RESULT_REQUIRED');
      const barrierEvidence = capacityClear ? null : requireBarrierWriteEvidence(dependencies, result);
      const ledger = capacityClear ? null : requireCalculationLengthLedger(result, dependencies.settings);
      const seal = await sealResult(client, { projectId: m.projectId, proposalId: p.id, dependencies, result, proposalHash: p.proposal_hash });
      if (!seal || (capacityClear ? seal.ledgerHash !== null : !seal.ledgerHash || !ledger)
        || seal.jobId !== m.jobId || seal.cableId !== m.cableId) return fail('AUTOMATIC_PAIR_SEALED_RESULT_REQUIRED');
      const applicable = capacityClear ? { applicable: await (adapters.clearApplicability ?? ((c, input) => capacityClearItemApplicable(c, input, m)))(client,
        { projectId: m.projectId, jobId: m.jobId, cableId: m.cableId, jobState: p.job_state, cancelRequested: p.cancel_requested }) }
        : await (adapters.applicability ?? ((c, input) => readAutomaticPairProposalApplicability(c, input, m)))(client, { projectId: m.projectId, jobId: m.jobId, cableId: m.cableId,
        proposalId: p.id, dependencyVersion: dependencies.schemaVersion, dependencyHash: m.dependencyHash,
        jobState: p.job_state, cancelRequested: p.cancel_requested, seal });
      if (!applicable.applicable) return fail('PROPOSAL_NOT_APPLICABLE');
      const verified=capacityClear ? null : readVerifiedSameEndpointCurrent(await adapters.verifiedCurrent?.(client,dependencies,p.result,signal));
      let capacityEvidence: CapacityClearEvidence | null = null;
      const currentCapacity = () => (adapters.capacityEvidence ?? readCurrentCapacityClearEvidence)(client,
        { dependencies, result: p.result, jobId: m.jobId }, signal);
      const positiveRestricted = !capacityClear && dependencies.settings.trayCapacity?.enabled === true;
      const currentPositiveCapacity = () => (adapters.currentPositiveCapacity ?? readCurrentPositiveCapacity)(client,
        { dependencies, result: p.result, jobId: m.jobId }, signal);
      const currentScope=async()=>{
        if (capacityEvidence && !sameAutomaticPairValue(await currentCapacity(), capacityEvidence)) return fail('AUTOMATIC_PAIR_CAPACITY_CHANGED');
        if (positiveRestricted && !await currentPositiveCapacity()) return fail('AUTOMATIC_PAIR_CAPACITY_CHANGED');
        if(!verified)return barrierFence(client,dependencies,{signal});
        if(!await verified.recheck(client,signal))return fail('PROPOSAL_STALE');return verified.identity;};
      const identity = verified?.identity??await barrierFence(client, dependencies, { signal });
      const current = verified?.current??await collect(client, m.projectId, m.cableId, dependencies.options, dependencies.schemaVersion, true, identity);
      if (!current.dependencies || hash(current.dependencies) !== m.dependencyHash || current.cable.cable_write_revision !== m.cableWriteRevision)
        return { status: 'stale', receiptId: null, code: 'AUTOMATIC_PAIR_DEPENDENCIES_CHANGED' };
      const before = (await client.query<Row>(`/* automatic-pair:write-baseline */ SELECT CASE WHEN octet_length(to_jsonb(c)::text)<=65536
        THEN to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,'install_length',c.install_length::text,'cable_write_revision',c.cable_write_revision::text) ELSE NULL END AS value
        FROM cables c WHERE c.project_id=$1 AND c.id=$2 FOR UPDATE`, [m.projectId, m.cableId])).rows[0]?.value;
      if (!before || automaticPairHash(before) !== m.baselineSha256) return { status: 'review-required', receiptId: null, code: 'AUTOMATIC_PAIR_BASELINE_CHANGED' };
      const owned = await ownership(client, { projectId: m.projectId, cableId: m.cableId, currentSnapshot: before }, () => signal?.throwIfAborted());
      if (owned.kind === 'review-required' || !sameAutomaticPairValue(owned, m.ownership)) return { status: 'review-required', receiptId: null, code: 'AUTOMATIC_PAIR_OWNERSHIP_CHANGED' };
      if (capacityClear) {
        if (owned.kind !== 'automatic') return { status: 'refused', receiptId: null, code: 'AUTOMATIC_PAIR_EMPTY_NO_PATH' };
        capacityEvidence = await currentCapacity();
        if (!validCapacityClearEvidence(dependencies, p.result, capacityEvidence))
          return { status: 'stale', receiptId: null, code: 'AUTOMATIC_PAIR_CAPACITY_CHANGED' };
      }
      if (positiveRestricted && !await currentPositiveCapacity())
        return { status: 'refused', receiptId: null, code: 'AUTOMATIC_PAIR_CAPACITY_CHANGED' };
      if(!verified)await (adapters.snapshot ?? readSnapshot)(dependencies.artifact.id, dependencies.artifact.sha256);
      if(verified)await currentScope();await fence(client, claim); await mandateFence(client, m); signal?.throwIfAborted();
      await client.query("SELECT set_config('wfc.pathfinder_apply','1',true)");
      const nextRouting = capacityClear ? null : result.route!.routeText, nextDesign = capacityClear ? null : result.design!.designLengthMeters;
      const after = (await client.query<Row>(`/* automatic-pair:write */ UPDATE cables c SET routing=$3,design_length=$4,updated_at=NOW()
        WHERE c.project_id=$1 AND c.id=$2 AND c.cable_write_revision=$5 AND c.routing IS NOT DISTINCT FROM $6::text AND c.design_length IS NOT DISTINCT FROM $7::numeric
        RETURNING to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,'install_length',c.install_length::text,'cable_write_revision',c.cable_write_revision::text) AS value`,
      [m.projectId, m.cableId, nextRouting, nextDesign, m.cableWriteRevision, before.routing, before.design_length])).rows[0]?.value;
      if (!after) return fail('CABLE_WRITE_CONFLICT');
      if (capacityClear ? !automaticPairCapacityClearTransition(m.projectId, m.cableId, before, after)
        : !automaticPairOwnTransition(m.projectId, m.cableId, before, after) || after.routing !== nextRouting
          || !automaticPairDecimalEqual(after.design_length, nextDesign)) return fail('AUTOMATIC_PAIR_WRITE_INTEGRITY');
      const h = await (adapters.history ?? recordPathFinderCableHistory)(client, { projectId: m.projectId, cableId: m.cableId, actorId: m.actorId });
      const history = automaticPairHistorySchema.parse({ id: h.id, version: h.versionNumber });
      const histories = (await client.query<Row>(`/* automatic-pair:write-history */ SELECT *,design_length::text,install_length::text
        FROM cable_versions WHERE cable_id=$1 AND id=$2 AND version_number=$3`, [m.cableId, history.id, history.version])).rows;
      if (histories.length !== 1 || !automaticPairHistoryMatches(histories[0], after, m.actorId)) return fail('AUTOMATIC_PAIR_HISTORY_INTEGRITY');
      const provenanceBody = { engineeringAccepted: false, nativeParity: 'not-performed', request, mandate: m, dependencies,
        revisionResult: { admissionId: seal.admissionId, revisionResultSha256: seal.revisionResultSha256, baselineHash: seal.baselineHash,
          engineResultSha256: seal.engineResultSha256, ledgerHash: seal.ledgerHash, dependencyHash: seal.dependencyHash }, history, authorizedAt: new Date().toISOString() };
      const provenance = capacityClear
        ? automaticPairCapacityClearProvenanceSchema.parse({ ...provenanceBody, schemaVersion: 'pathfinder.automatic-pair-capacity-clear.v1',
          validationMethod: 'automatic-owned-capacity-clear', capacityEvidence })
        : automaticPairProvenanceSchema.parse({ ...provenanceBody, schemaVersion: 'pathfinder.automatic-pair.v1', validationMethod: 'automatic-owned-pair', barrierEvidence });
      if (Buffer.byteLength(canonicalPurposeJson({ before, after, provenance })) > AUTOMATIC_PAIR_LIMITS.receiptBytes) return fail('AUTOMATIC_PAIR_RECEIPT_LIMIT', 413);
      const receiptId = randomUUID(); await client.query(`INSERT INTO pf_apply_receipts(id,project_id,actor_id,idempotency_key,payload_hash,proposal_id,cable_id,before_snapshot,after_snapshot,provenance)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [receiptId, m.projectId, m.actorId, request.idempotencyKey, automaticPairHash(request), p.id, m.cableId, before, after, provenance]);
      await currentScope(); await fence(client, claim); await mandateFence(client, m); signal?.throwIfAborted();
      return { status: 'written', receiptId };
    }, signal);
    if (signal?.aborted || Date.now() >= Math.min(Date.parse(m.authorityExpiresAt), who.loginExpiresAt)) return fail('AUTOMATIC_PAIR_COMMIT_OUTCOME_UNKNOWN', 503);
    return committed as AutomaticPairOutcome;
  } };
}
export type AutomaticPairWriter = ReturnType<typeof createAutomaticPairWriter>;
