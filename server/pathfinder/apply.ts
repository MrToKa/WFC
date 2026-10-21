import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { z } from 'zod';
import { PathFinderError } from './errors.js';
import { collectDependenciesForVersion, hash, hasSyntheticProof } from './dependencies.js';
import { readSnapshot } from './storage.js';
import type { applySchema, BarrierDependencySnapshot, DependencySnapshot, JobPrincipal } from './jobContracts.js';
import { designLengthCompatibilityIssue,routeCompatibilityIssue,proposalRoutingPreferences } from './jobContracts.js';
import { assertLoginNotExpired, principalTransaction } from './auth.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { requireBarrierWriteEvidence, requireCurrentBarrierWriteScope } from './barrierWrites.js';
import { requireEnrollmentAuthority } from './recalculationRepository.js';
import { verifyRevisionResultForProposal } from './revisionResultRepository.js';
import { requireCalculationLengthLedger } from './lengthLedger.js';
import { readApplyAbandonment } from './applyRecovery.js';
import { readProposalApplicability } from './proposalApplicability.js';
import { recordPathFinderCableHistory } from './cableWriteHistory.js';
import { canonicalDecimalString } from '../../shared/pathfinderLengthLedger.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';

type Row = Record<string,any>;
function receiptDto(row:Row) {
  return {id:row.id,projectId:row.project_id,proposalId:row.proposal_id,cableId:row.cable_id,before:row.before_snapshot,after:row.after_snapshot,
    provenance:row.provenance,appliedAt:row.applied_at};
}
export function createPathFinderApply(pool:Pool) {
  return async (projectId:string,who:JobPrincipal,proposalId:string,input:z.infer<typeof applySchema>) => principalTransaction(pool,projectId,who,async client => {
    const payloadHash = hash({proposalId,...input});
    const previous = (await client.query<Row>('SELECT * FROM pf_apply_receipts WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 FOR SHARE',[projectId,who.userId,input.idempotencyKey])).rows[0];
    if (previous) {
      if (previous.payload_hash !== payloadHash) throw new PathFinderError('IDEMPOTENCY_CONFLICT',409,'This idempotency key was used for a different Apply request.');
      assertLoginNotExpired(who);
      return {receipt:receiptDto(previous),duplicate:true};
    }
    if (await readApplyAbandonment(client,{projectId,actorId:who.userId,idempotencyKey:input.idempotencyKey,payloadHash}))
      throw new PathFinderError('APPLY_REQUEST_CLOSED',409,'This exact pending Apply request was closed without applying. Review a current proposal before creating a new Apply request.');
    const proposal = (await client.query<Row>(`SELECT p.*,j.state AS job_state,j.cancel_requested FROM pf_proposals p
      JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id WHERE p.project_id=$1 AND p.id=$2 FOR SHARE OF p,j`,[projectId,proposalId])).rows[0];
    if (!proposal) throw new PathFinderError('PROPOSAL_NOT_FOUND',404);
    const review = (await client.query<Row>('SELECT * FROM pf_reviews WHERE project_id=$1 AND id=$2 FOR SHARE',[projectId,input.reviewId])).rows[0];
    if (!review || review.actor_id !== who.userId || review.proposal_id !== proposalId || review.proposal_hash !== proposal.proposal_hash) throw new PathFinderError('REVIEW_REQUIRED',409,'Review this exact proposal before applying it.');
    const dependencies = proposal.dependencies as DependencySnapshot,result = proposal.result;
    if (!proposalRoutingPreferences(dependencies.options)) throw new PathFinderError('PROPOSAL_PREFERENCES_REQUIRED',409,'The original calculation preferences are unavailable. Calculate and review a fresh proposal.');
    const barrierEvidence=requireBarrierWriteEvidence(dependencies,result);
    requireVersionedCalculationScope(dependencies);
    if (proposal.status !== 'calculated' || !result.route?.success || !result.design || proposal.cancel_requested) throw new PathFinderError('PROPOSAL_NOT_APPLICABLE',409);
    const revisionResult=await verifyRevisionResultForProposal(client,{projectId,proposalId,result,dependencies,proposalHash:proposal.proposal_hash});
    const applicability=await readProposalApplicability(client,{projectId,jobId:proposal.job_id,cableId:proposal.cable_id,proposalId,
      dependencyHash:proposal.dependency_hash,dependencyVersion:dependencies.schemaVersion,jobState:proposal.job_state,cancelRequested:proposal.cancel_requested,seal:revisionResult});
    if(!applicability.applicable)throw new PathFinderError('PROPOSAL_NOT_APPLICABLE',409);
    if(!revisionResult||!revisionResult.ledgerHash||review.revision_result_sha256!==revisionResult.revisionResultSha256
      ||review.review_dependency_sha256!==proposal.dependency_hash||review.review_login_id!==who.loginId)throw new PathFinderError('REVISION_RESULT_REVIEW_REQUIRED',409,'Calculate and review a fresh result with its exact cable baseline and length components in the current login.');
    requireCalculationLengthLedger(result,dependencies.settings);
    const synthetic=await hasSyntheticProof(client,dependencies);
    if (!synthetic && review.validation_method!=='manual-review') throw new PathFinderError('MANUAL_REVIEW_REQUIRED',409,'Confirm manual review of this exact proposal before applying it. Historical reviews do not grant manual acceptance.');
    const identity=await requireCurrentBarrierWriteScope(client,dependencies as BarrierDependencySnapshot);
    const current = await collectDependenciesForVersion(client,projectId,proposal.cable_id,dependencies.options,dependencies.schemaVersion,true,identity);
    if (!current.dependencies || hash(current.dependencies) !== proposal.dependency_hash || input.expectedCableWriteRevision !== current.cable.cable_write_revision) throw new PathFinderError('PROPOSAL_STALE',409,'The cable or a calculation dependency changed. Recalculate and review.');
    await readSnapshot(dependencies.artifact.id,dependencies.artifact.sha256);
    const length = result.design.designLengthMeters;
    const designIssue=designLengthCompatibilityIssue(length);
    if (designIssue) throw new PathFinderError('DESIGN_LENGTH_OUTSIDE_WFC_LIMIT',409,designIssue);
    const route = result.route.routeText;
    if (typeof route !== 'string') throw new PathFinderError('ROUTING_OUTSIDE_WFC_LIMIT',409);
    const compatibilityIssue = routeCompatibilityIssue(route);
    if (compatibilityIssue) throw new PathFinderError('ROUTING_OUTSIDE_WFC_LIMIT',409,compatibilityIssue);
    assertLoginNotExpired(who);
    const before = (await client.query<Row>(`SELECT to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,'install_length',c.install_length::text,'cable_write_revision',c.cable_write_revision::text) AS value FROM cables c WHERE c.project_id=$1 AND c.id=$2`,[projectId,proposal.cable_id])).rows[0].value;
    await requireEnrollmentAuthority(client,{projectId,jobId:proposal.job_id,cableId:proposal.cable_id});
    await client.query("SELECT set_config('wfc.pathfinder_apply','1',true)");
    const after = (await client.query<Row>(`UPDATE cables c SET routing=$3,design_length=$4,updated_at=NOW()
      WHERE c.project_id=$1 AND c.id=$2 AND c.cable_write_revision=$5 RETURNING to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,'install_length',c.install_length::text,'cable_write_revision',c.cable_write_revision::text) AS value`,[projectId,proposal.cable_id,route,length,input.expectedCableWriteRevision])).rows[0]?.value;
    if (!after) throw new PathFinderError('CABLE_WRITE_CONFLICT',409);
    // Verify the exact pair and preserved fields even if a schema trigger changes.
    let validTransition=false;
    try {
      const changed=new Set(['routing','design_length','updated_at','cable_write_revision']);
      validTransition=after.routing===route&&canonicalDecimalString(after.design_length)===canonicalDecimalString(length)
        &&BigInt(after.cable_write_revision)===BigInt(before.cable_write_revision)+1n
        &&canonicalPurposeJson(Object.keys(before).sort())===canonicalPurposeJson(Object.keys(after).sort())
        &&Object.keys(before).every(key=>changed.has(key)||canonicalPurposeJson(before[key])===canonicalPurposeJson(after[key]));
    }catch{validTransition=false;}
    if(!validTransition)throw new PathFinderError('APPLY_WRITE_INTEGRITY',409,'The exact routing and design length could not be recorded with all other cable values preserved.');
    const provenance = {schemaVersion:'pathfinder.apply.v3',proposalId,proposalHash:proposal.proposal_hash,reviewId:input.reviewId,dependencies,barrierEvidence,
      revisionResult:{admissionId:revisionResult.admissionId,revisionResultSha256:revisionResult.revisionResultSha256,baselineHash:revisionResult.baselineHash,
        engineResultSha256:revisionResult.engineResultSha256,ledgerHash:revisionResult.ledgerHash,dependencyHash:revisionResult.dependencyHash,
        oldModel:revisionResult.oldModel,newModel:revisionResult.summary.newModel,comparisonRef:revisionResult.comparisonRef,reasons:revisionResult.summary.reasonCodes,
        observedEvents:revisionResult.observedEvents,physicalChangeProven:revisionResult.physicalChangeProven},
      engineVersion:dependencies.engineVersion,calculationMode:result.calculationMode,synthetic,acceptanceScope:synthetic?'local-synthetic-fixture':'manual-review',
      validationMethod:synthetic?'synthetic-fixture':'manual-review',nativeParity:'not-performed',
      review:{id:review.id,actorId:review.actor_id,loginId:review.review_login_id,reviewedAt:review.reviewed_at,validationMethod:review.validation_method,
        dependencyHash:review.review_dependency_sha256,revisionResultSha256:review.revision_result_sha256},
      engineeringAcceptanceMessage:synthetic?'This is the explicitly seeded synthetic fixture; it is not acceptance of the real converted model.':'An administrator confirmed manual review of this exact proposal. Native engineering parity has not been performed; broader user acceptance remains pending.'};
    await recordPathFinderCableHistory(client,{projectId,cableId:proposal.cable_id,actorId:who.userId});
    const receipt = (await client.query<Row>(`INSERT INTO pf_apply_receipts(id,project_id,actor_id,idempotency_key,payload_hash,proposal_id,cable_id,before_snapshot,after_snapshot,provenance)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[randomUUID(),projectId,who.userId,input.idempotencyKey,payloadHash,proposalId,proposal.cable_id,before,after,provenance])).rows[0];
    await requireCurrentBarrierWriteScope(client,dependencies as BarrierDependencySnapshot);
    await requireEnrollmentAuthority(client,{projectId,jobId:proposal.job_id,cableId:proposal.cable_id});
    assertLoginNotExpired(who);
    return {receipt:receiptDto(receipt),duplicate:false};
  });
}
