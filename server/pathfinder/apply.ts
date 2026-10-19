import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { z } from 'zod';
import { PathFinderError } from './errors.js';
import { collectDependencies, hash, hasSyntheticProof } from './dependencies.js';
import { readSnapshot } from './storage.js';
import type { applySchema, DependencySnapshot, JobPrincipal } from './jobContracts.js';
import { designLengthCompatibilityIssue,routeCompatibilityIssue,proposalRoutingPreferences } from './jobContracts.js';
import { assertLoginNotExpired, principalTransaction } from './auth.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { calculationEngineIdentity } from './calculationEngineIdentity.js';
import { requireEnrollmentAuthority } from './recalculationRepository.js';

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
    const proposal = (await client.query<Row>(`SELECT p.*,j.state AS job_state,j.cancel_requested FROM pf_proposals p
      JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id WHERE p.project_id=$1 AND p.id=$2 FOR SHARE OF p,j`,[projectId,proposalId])).rows[0];
    if (!proposal) throw new PathFinderError('PROPOSAL_NOT_FOUND',404);
    const review = (await client.query<Row>('SELECT * FROM pf_reviews WHERE project_id=$1 AND id=$2 FOR SHARE',[projectId,input.reviewId])).rows[0];
    if (!review || review.actor_id !== who.userId || review.proposal_id !== proposalId || review.proposal_hash !== proposal.proposal_hash) throw new PathFinderError('REVIEW_REQUIRED',409,'Review this exact proposal before applying it.');
    const dependencies = proposal.dependencies as DependencySnapshot,result = proposal.result;
    if (!proposalRoutingPreferences(dependencies.options)) throw new PathFinderError('PROPOSAL_PREFERENCES_REQUIRED',409,'The original calculation preferences are unavailable. Calculate and review a fresh proposal.');
    requireVersionedCalculationScope(dependencies);
    if (proposal.status !== 'calculated' || !result.route?.success || !result.design || proposal.job_state !== 'complete' || proposal.cancel_requested) throw new PathFinderError('PROPOSAL_NOT_APPLICABLE',409);
    const synthetic=await hasSyntheticProof(client,dependencies);
    if (!synthetic && review.validation_method!=='manual-review') throw new PathFinderError('MANUAL_REVIEW_REQUIRED',409,'Confirm manual review of this exact proposal before applying it. Historical reviews do not grant manual acceptance.');
    await calculationEngineIdentity({force:true});
    const current = await collectDependencies(client,projectId,proposal.cable_id,dependencies.options,true);
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
    const before = (await client.query<Row>('SELECT to_jsonb(c) AS value FROM cables c WHERE c.project_id=$1 AND c.id=$2',[projectId,proposal.cable_id])).rows[0].value;
    await requireEnrollmentAuthority(client,{projectId,jobId:proposal.job_id});
    await client.query("SELECT set_config('wfc.pathfinder_apply','1',true)");
    const after = (await client.query<Row>(`UPDATE cables c SET routing=$3,design_length=$4,updated_at=NOW()
      WHERE c.project_id=$1 AND c.id=$2 AND c.cable_write_revision=$5 RETURNING to_jsonb(c) AS value`,[projectId,proposal.cable_id,route,Number(length),input.expectedCableWriteRevision])).rows[0]?.value;
    if (!after) throw new PathFinderError('CABLE_WRITE_CONFLICT',409);
    const provenance = {schemaVersion:'pathfinder.apply.v1',proposalId,proposalHash:proposal.proposal_hash,reviewId:input.reviewId,dependencies,
      engineVersion:dependencies.engineVersion,calculationMode:result.calculationMode,synthetic,acceptanceScope:synthetic?'local-synthetic-fixture':'manual-review',
      validationMethod:synthetic?'synthetic-fixture':'manual-review',nativeParity:'not-performed',
      review:{id:review.id,actorId:review.actor_id,reviewedAt:review.reviewed_at,validationMethod:review.validation_method},
      engineeringAcceptanceMessage:synthetic?'This is the explicitly seeded synthetic fixture; it is not acceptance of the real converted model.':'An administrator confirmed manual review of this exact proposal. Native engineering parity has not been performed; broader user acceptance remains pending.'};
    await client.query(`INSERT INTO cable_versions(id,cable_id,version_number,change_type,change_source,cable_number,revision,mto,tag,cable_type_id,cable_type_name,
      from_location,to_location,routing,delivery,design_length,install_length,pull_date,connected_from,connected_to,tested,changed_by,changed_by_snapshot)
      SELECT $1,c.id,COALESCE((SELECT MAX(v.version_number) FROM cable_versions v WHERE v.cable_id=c.id),0)+1,'update','pathfinder',c.cable_id,c.revision,c.mto,c.tag,c.cable_type_id,ct.name,
      c.from_location,c.to_location,c.routing,c.delivery,c.design_length,c.install_length,c.pull_date,c.connected_from,c.connected_to,c.tested,$4,
      (SELECT jsonb_build_object('id',u.id,'firstName',u.first_name,'lastName',u.last_name,'email',u.email) FROM users u WHERE u.id=$4)
      FROM cables c JOIN cable_types ct ON ct.id=c.cable_type_id WHERE c.project_id=$2 AND c.id=$3`,[randomUUID(),projectId,proposal.cable_id,who.userId]);
    const receipt = (await client.query<Row>(`INSERT INTO pf_apply_receipts(id,project_id,actor_id,idempotency_key,payload_hash,proposal_id,cable_id,before_snapshot,after_snapshot,provenance)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[randomUUID(),projectId,who.userId,input.idempotencyKey,payloadHash,proposalId,proposal.cable_id,before,after,provenance])).rows[0];
    assertLoginNotExpired(who);
    await requireEnrollmentAuthority(client,{projectId,jobId:proposal.job_id});
    return {receipt:receiptDto(receipt),duplicate:false};
  });
}
