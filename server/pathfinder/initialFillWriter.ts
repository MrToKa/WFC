import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {INITIAL_FILL_ROUTING_WHITESPACE,initialFillApplyRequestSchema,initialFillProvenanceSchema,initialFillRequestHashInput,
  initialFillMandateReference,type InitialFillApplyRequest} from '../../shared/pathfinderInitialFill.js';
import {classifyCableInitialFill} from '../../shared/pathfinderCableWorkflow.js';
import {canonicalPurposeJson} from '../../shared/pathfinderPurposePolicy.js';
import {canonicalDecimalString} from '../../shared/pathfinderLengthLedger.js';
import {locationImpactItemSchema} from '../../shared/pathfinderLocationImpacts.js';
import {readInitialFillMandate,requireCurrentInitialFillMandate} from './initialFillMandates.js';
import {endpointBindingTransaction} from './endpointBindingRepository.js';
import {initialFillIdempotencyKey} from './initialFillIdentity.js';
import {collectDependenciesForVersion,hash} from './dependencies.js';
import {calculationEngineIdentity} from './calculationEngineIdentity.js';
import {verifyRevisionResultForProposal} from './revisionResultRepository.js';
import {readInitialFillReceiptProof} from './initialFillReceiptProof.js';
import {readProposalApplicability} from './proposalApplicability.js';
import {requireCalculationLengthLedger} from './lengthLedger.js';
import {requireVersionedCalculationScope} from './routingScope.js';
import {designLengthCompatibilityIssue,routeCompatibilityIssue,type DependencySnapshot} from './jobContracts.js';
import {normalizeLocation} from './matching.js';
import {readSnapshot} from './storage.js';
import {recordPathFinderCableHistory} from './cableWriteHistory.js';
import {PathFinderError} from './errors.js';
import {schedulerTransaction} from './schedulerTransaction.js';

type Row=Record<string,any>;
const fail=(code:string,status=409):never=>{throw new PathFinderError(code,status,'Automatic initial fill could not be authorized for this exact result. Existing cable values were preserved.');};
const snapshotSql=`SELECT CASE WHEN octet_length(to_jsonb(c)::text)<=65536 THEN to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,'install_length',c.install_length::text,'cable_write_revision',c.cable_write_revision::text) ELSE NULL END AS value
  FROM cables c WHERE c.project_id=$1 AND c.id=$2 FOR UPDATE`;
export type InitialFillWriteFence=(client:PoolClient)=>Promise<void>;
export type InitialFillWriterAdapters={collect?:typeof collectDependenciesForVersion;identity?:typeof calculationEngineIdentity;
  snapshot?:typeof readSnapshot;seal?:typeof verifyRevisionResultForProposal;proof?:typeof readInitialFillReceiptProof;applicability?:typeof readProposalApplicability};

/** Recognition of a committed immutable receipt does not renew its expired mandate. */
async function previousReceipt(client:PoolClient,projectId:string,request:InitialFillApplyRequest,proof:typeof readInitialFillReceiptProof,sealResult:typeof verifyRevisionResultForProposal){
  const rows=(await client.query<Row>(`/* initial-fill:receipt */ SELECT id,project_id,actor_id,idempotency_key,payload_hash,proposal_id,cable_id,
    CASE WHEN octet_length(before_snapshot::text)+octet_length(after_snapshot::text)+octet_length(provenance::text)<=262144 THEN before_snapshot ELSE NULL END AS before_snapshot,
    CASE WHEN octet_length(before_snapshot::text)+octet_length(after_snapshot::text)+octet_length(provenance::text)<=262144 THEN after_snapshot ELSE NULL END AS after_snapshot,
    CASE WHEN octet_length(before_snapshot::text)+octet_length(after_snapshot::text)+octet_length(provenance::text)<=262144 THEN provenance ELSE NULL END AS provenance
    FROM pf_apply_receipts WHERE project_id=$1 AND idempotency_key=$2
    AND actor_id=(SELECT actor_id FROM pf_initial_fill_mandates WHERE project_id=$1 AND id=$3) LIMIT 2`,[projectId,request.idempotencyKey,request.mandateId])).rows;
  if(!rows.length)return null;if(rows.length!==1)return fail('INITIAL_FILL_RECEIPT_CONFLICT');
  const row=rows[0],parsed=initialFillProvenanceSchema.safeParse(row.provenance);
  if(!parsed.success||row.payload_hash!==hash(initialFillRequestHashInput(request))||canonicalPurposeJson(parsed.data.request)!==canonicalPurposeJson(request))return fail('INITIAL_FILL_RECEIPT_CONFLICT');
  const proposal=(await client.query<Row>(`SELECT CASE WHEN octet_length(dependencies::text)+octet_length(result::text)<=262144 THEN dependencies ELSE NULL END AS dependencies,
    CASE WHEN octet_length(dependencies::text)+octet_length(result::text)<=262144 THEN result ELSE NULL END AS result,proposal_hash
    FROM pf_proposals WHERE project_id=$1 AND id=$2 AND cable_id=$3`,[projectId,request.proposalId,row.cable_id])).rows[0];
  if(!proposal)return fail('INITIAL_FILL_RECEIPT_INTEGRITY');
  const seal=await sealResult(client,{projectId,proposalId:request.proposalId,dependencies:proposal.dependencies,result:proposal.result,proposalHash:proposal.proposal_hash});
  if(!seal||!await proof(client,{projectId,cableId:row.cable_id,receiptId:row.id,proposalId:request.proposalId,actorId:row.actor_id,
    idempotencyKey:row.idempotency_key,payloadHash:row.payload_hash,before:row.before_snapshot,after:row.after_snapshot,provenance:row.provenance,
    dependencies:proposal.dependencies,result:proposal.result,seal}))return fail('INITIAL_FILL_RECEIPT_INTEGRITY');
  return {status:'already-written' as const,receiptId:row.id,cableId:row.cable_id};
}

export function createInitialFillWriter(pool:Pool,adapters:InitialFillWriterAdapters={}){
  const collect=adapters.collect??collectDependenciesForVersion,identity=adapters.identity??calculationEngineIdentity,artifact=adapters.snapshot??readSnapshot,
    sealResult=adapters.seal??verifyRevisionResultForProposal,proof=adapters.proof??readInitialFillReceiptProof,applicability=adapters.applicability??readProposalApplicability;
  return {async apply(projectId:string,raw:unknown,fence:InitialFillWriteFence,signal?:AbortSignal){
    const request=initialFillApplyRequestSchema.parse(raw);signal?.throwIfAborted();
    // A read-only service-side reconciliation precedes new write authority. It
    // cannot manufacture a receipt or authorize a replacement request.
    const observed=await schedulerTransaction(pool,async client=>({previous:await previousReceipt(client,projectId,request,proof,sealResult),
      mandate:await readInitialFillMandate(client,projectId,request.mandateId)}),signal);
    if(observed.previous)return observed.previous;const mandate=observed.mandate;
    if(!mandate)return fail('INITIAL_FILL_MANDATE_REQUIRED');
    const who={userId:mandate.actorId,loginId:mandate.loginId,loginExpiresAt:Date.parse(mandate.loginExpiresAt)};
    const committed=await endpointBindingTransaction(pool,projectId,who,async client=>{
      await fence(client);const previous=await previousReceipt(client,projectId,request,proof,sealResult);if(previous)return previous;
      const proposal=(await client.query<Row>(`/* initial-fill:proposal */ SELECT p.id,p.project_id,p.cable_id,p.job_id,p.status,p.proposal_hash,p.dependency_hash,
        CASE WHEN octet_length(p.dependencies::text)+octet_length(p.result::text)<=262144 THEN p.dependencies ELSE NULL END AS dependencies,
        CASE WHEN octet_length(p.dependencies::text)+octet_length(p.result::text)<=262144 THEN p.result ELSE NULL END AS result,j.state AS job_state,j.cancel_requested FROM pf_proposals p
        JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id WHERE p.project_id=$1 AND p.id=$2 FOR SHARE OF p,j`,[projectId,request.proposalId])).rows[0];
      if(!proposal)return fail('PROPOSAL_NOT_FOUND',404);
      const dependencies=proposal.dependencies as DependencySnapshot,result=proposal.result;
      if(!dependencies||!result||dependencies.schemaVersion!=='pathfinder.dependencies.v7'||proposal.proposal_hash!==request.expectedProposalHash||dependencies.cableWriteRevision!==request.expectedCableWriteRevision
        ||proposal.status!=='calculated'||result.status!=='calculated'||!result.route?.success||!result.design)return fail('INITIAL_FILL_PROPOSAL_INVALID');
      if(request.idempotencyKey!==initialFillIdempotencyKey({projectId,cableId:proposal.cable_id,proposalId:request.proposalId,proposalHash:request.expectedProposalHash,
        mandateId:request.mandateId,expectedCableWriteRevision:request.expectedCableWriteRevision}))return fail('INITIAL_FILL_REQUEST_IDENTITY');
      const currentMandate=await requireCurrentInitialFillMandate(client,{projectId,mandateId:request.mandateId,impactId:mandate.impactId,jobId:proposal.job_id,cableId:proposal.cable_id,principal:who,lock:true});
      const memberRow=(await client.query<Row>(`SELECT i.generation::text,i.record_sha256,CASE WHEN octet_length(i.record::text)<=32768 THEN i.record ELSE NULL END AS record
        FROM pf_location_impact_items i JOIN pf_location_impact_enrollments e ON e.project_id=i.project_id AND e.impact_id=i.impact_id
        WHERE i.project_id=$1 AND i.impact_id=$2 AND i.cable_id=$3 AND e.job_id=$4 FOR SHARE OF i,e`,[projectId,mandate.impactId,proposal.cable_id,proposal.job_id])).rows[0];
      const member=locationImpactItemSchema.safeParse(memberRow?.record);
      if(!member.success)return fail('INITIAL_FILL_MEMBER_INTEGRITY');const {contentSha256,...memberBody}=member.data;
      if(contentSha256!==memberRow.record_sha256||hash(memberBody)!==contentSha256||member.data.projectId!==projectId||member.data.impactId!==mandate.impactId||member.data.cableId!==proposal.cable_id
        ||member.data.generation!==memberRow.generation||!member.data.eligible||member.data.cableWriteRevision!==dependencies.cableWriteRevision
        ||member.data.fromLogicalKey!==normalizeLocation(dependencies.cableInputs.fromLocation??'')||member.data.toLogicalKey!==normalizeLocation(dependencies.cableInputs.toLocation??'')
        ||member.data.category!==dependencies.cableInputs.mto)return fail('INITIAL_FILL_ORIGINAL_SCOPE_CHANGED');
      requireVersionedCalculationScope(dependencies);const sealed=await sealResult(client,{projectId,proposalId:request.proposalId,result,dependencies,proposalHash:proposal.proposal_hash});
      if(!sealed?.ledgerHash)return fail('REVISION_RESULT_REVIEW_REQUIRED');
      const applicable=await applicability(client,{projectId,jobId:proposal.job_id,cableId:proposal.cable_id,proposalId:request.proposalId,dependencyVersion:dependencies.schemaVersion,
        dependencyHash:proposal.dependency_hash,jobState:proposal.job_state,cancelRequested:proposal.cancel_requested,seal:sealed});if(!applicable.applicable)return fail('PROPOSAL_NOT_APPLICABLE');
      requireCalculationLengthLedger(result,dependencies.settings);
      if(routeCompatibilityIssue(result.route.routeText)||designLengthCompatibilityIssue(result.design.designLengthMeters))return fail('INITIAL_FILL_VALUE_OUTSIDE_WFC_LIMIT');
      const loadedIdentity=await identity({force:true}),current=await collect(client,projectId,proposal.cable_id,dependencies.options,dependencies.schemaVersion,true,loadedIdentity);
      if(!current.dependencies||hash(current.dependencies)!==proposal.dependency_hash||current.cable.cable_write_revision!==request.expectedCableWriteRevision)return fail('PROPOSAL_STALE');
      const before=(await client.query<Row>(snapshotSql,[projectId,proposal.cable_id])).rows[0]?.value;if(!before)return fail('INITIAL_FILL_CABLE_SNAPSHOT_LIMIT');
      if(classifyCableInitialFill({mto:before.mto,routing:before.routing,designLength:before.design_length}).mode!=='initial-fill-candidate')return {status:'review-required' as const,receiptId:null,cableId:proposal.cable_id};
      await artifact(dependencies.artifact.id,dependencies.artifact.sha256);signal?.throwIfAborted();await fence(client);
      await requireCurrentInitialFillMandate(client,{projectId,mandateId:request.mandateId,impactId:mandate.impactId,jobId:proposal.job_id,cableId:proposal.cable_id,principal:who,lock:true});
      await client.query("SELECT set_config('wfc.pathfinder_apply','1',true)");
      const after=(await client.query<Row>(`UPDATE cables c SET routing=$3,design_length=$4,updated_at=NOW() WHERE c.project_id=$1 AND c.id=$2
        AND c.cable_write_revision=$5 AND c.design_length IS NULL AND (c.routing IS NULL OR btrim(c.routing,$6)='')
        RETURNING to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,'install_length',c.install_length::text,'cable_write_revision',c.cable_write_revision::text) AS value`,
        [projectId,proposal.cable_id,result.route.routeText,result.design.designLengthMeters,request.expectedCableWriteRevision,INITIAL_FILL_ROUTING_WHITESPACE])).rows[0]?.value;
      if(!after)return fail('CABLE_WRITE_CONFLICT');
      const changed=new Set(['routing','design_length','updated_at','cable_write_revision']);
      if(after.routing!==result.route.routeText||canonicalDecimalString(after.design_length)!==canonicalDecimalString(result.design.designLengthMeters)
        ||BigInt(after.cable_write_revision)!==BigInt(before.cable_write_revision)+1n||canonicalPurposeJson(Object.keys(before).sort())!==canonicalPurposeJson(Object.keys(after).sort())
        ||Object.keys(before).some(key=>!changed.has(key)&&canonicalPurposeJson(before[key])!==canonicalPurposeJson(after[key])))return fail('INITIAL_FILL_WRITE_INTEGRITY');
      const provenance=initialFillProvenanceSchema.parse({schemaVersion:'pathfinder.initial-fill.v1',validationMethod:'automatic-initial-fill',nativeParity:'not-performed',engineeringAccepted:false,
        proposalId:request.proposalId,proposalHash:proposal.proposal_hash,dependencies,mandate:initialFillMandateReference(currentMandate),request,
        revisionResult:{admissionId:sealed.admissionId,revisionResultSha256:sealed.revisionResultSha256,baselineHash:sealed.baselineHash,engineResultSha256:sealed.engineResultSha256,ledgerHash:sealed.ledgerHash,dependencyHash:sealed.dependencyHash},
        authorized:{actorId:who.userId,loginId:who.loginId,installationEpoch:currentMandate.installationEpoch,targetGeneration:member.data.generation,authorizedAt:new Date().toISOString()}});
      if(Buffer.byteLength(canonicalPurposeJson({before,after,provenance}))>262144)return fail('INITIAL_FILL_RECEIPT_LIMIT');
      await recordPathFinderCableHistory(client,{projectId,cableId:proposal.cable_id,actorId:who.userId});
      const receiptId=randomUUID();await client.query(`INSERT INTO pf_apply_receipts(id,project_id,actor_id,idempotency_key,payload_hash,proposal_id,cable_id,before_snapshot,after_snapshot,provenance)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[receiptId,projectId,who.userId,request.idempotencyKey,hash(initialFillRequestHashInput(request)),request.proposalId,proposal.cable_id,before,after,provenance]);
      await fence(client);await requireCurrentInitialFillMandate(client,{projectId,mandateId:request.mandateId,impactId:mandate.impactId,jobId:proposal.job_id,cableId:proposal.cable_id,principal:who,lock:true});
      return {status:'written' as const,receiptId,cableId:proposal.cable_id};
    },signal);
    if(signal?.aborted||Date.now()>=Math.min(Date.parse(mandate.authorityExpiresAt),who.loginExpiresAt))return fail('INITIAL_FILL_COMMIT_OUTCOME_UNKNOWN',503);
    return committed;
  }};
}
export type InitialFillWriter=ReturnType<typeof createInitialFillWriter>;
