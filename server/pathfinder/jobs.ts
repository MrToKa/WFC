import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { PathFinderError } from './errors.js';
import { collectDependenciesForVersion, createTransactionDependencyReadCollector, hash, hasSyntheticProof,
  type TransactionDependencyReadCollector } from './dependencies.js';
import type { PathFinderRepository } from './repository.js';
import { defaultOptions, type createJobSchema, type BarrierDependencySnapshot, type DependencySnapshot, type JobPrincipal } from './jobContracts.js';
import { designLengthCompatibilityIssue,routeCompatibilityIssue,proposalRoutingPreferences } from './jobContracts.js';
import { assertLoginNotExpired, principalTransaction } from './auth.js';
import { isGrantPrincipal, grantProvenance, type OperationPrincipal } from './operationAuthority.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { collectDependencyBatchInTransaction, type DependencyBatch } from './dependencyBatch.js';
import { RECALCULATION_LIMITS, recalculationReasonSchema } from '../../shared/pathfinderRecalculation.js';
import { pauseRecalculationForJob, readRecalculationJobAuthority, requireEnrollmentAuthority, type RecalculationJobAdapter } from './recalculationRepository.js';
import { BARRIER_WRITE_UNVERIFIED_MESSAGE, readBarrierWriteEvidence, requireBarrierWriteEvidence, requireCurrentBarrierWriteScope } from './barrierWrites.js';
import { persistRevisionAdmission, verifyRevisionResultForProposal } from './revisionResultRepository.js';
import { isAutomaticEndpointCalculationPoint } from './endpointCalculationProvenance.js';
import { readProposalApplicability } from './proposalApplicability.js';
import { cancelLocationImpactForJob } from './locationImpactRepository.js';
import { readCurrentBarrierAdmissionIntent } from './barrierCalculationScope.js';
import { barrierHistoricalUnavailableMessage, isExpectedBarrierCurrentnessError } from './barrierCurrentness.js';
import { appendAutomaticPairMandatesInTransaction } from './automaticPairMandates.js';
import { automaticPairStatuses } from '../../shared/pathfinderAutomaticPair.js';

type Row = Record<string,any>;
// The full admission history is separately paginated by Cable revision results.
// Keep the frequently refreshed state preview small: every returned proposal
// still performs the complete live dependency and authority validation below.
const RECENT_PROPOSAL_PREVIEW_LIMIT = 5;
const jobAutomaticUpdateSchema = z.object({ status: z.enum(automaticPairStatuses), receiptId: z.string().uuid().nullable(),
  reasonCode: recalculationReasonSchema.nullable() }).strict()
  .refine(value => ['written', 'already-written'].includes(value.status) === (value.receiptId !== null));
export function jobDto(row:Row) {
  return {id:row.id,projectId:row.project_id,kind:row.kind ?? 'calculate',status:row.state,total:row.total,completed:row.completed,
    cancelRequested:row.cancel_requested,failure:row.failure,attempts:row.attempts,createdAt:row.created_at,updatedAt:row.updated_at};
}
export async function proposalDto(client:PoolClient,row:Row,detail:boolean,readCurrent?:TransactionDependencyReadCollector) {
  const dependencies = row.dependencies as DependencySnapshot;
  let current:Awaited<ReturnType<typeof collectDependenciesForVersion>>|null;
  let unavailable: 'cable' | 'barriers' | null = null;
  try {current=await (readCurrent ? readCurrent(row.cable_id,dependencies.options,dependencies.schemaVersion)
    : collectDependenciesForVersion(client,row.project_id,row.cable_id,dependencies.options,dependencies.schemaVersion));}
  catch(error){
    // Readability is independent from current applicability. Only explicit
    // missing-cable/barrier-currentness refusals become stale history here;
    // authority, implementation and unknown failures still refuse the request.
    if(error instanceof PathFinderError&&error.code==='CABLE_NOT_FOUND'){current=null;unavailable='cable';}
    else if(dependencies.schemaVersion==='pathfinder.dependencies.v8'&&isExpectedBarrierCurrentnessError(error)){current=null;unavailable='barriers';}
    else throw error;
  }
  const enrollment=await readRecalculationJobAuthority(client,{projectId:row.project_id,jobId:row.job_id,cableId:row.cable_id});
  const stale = current===null || !current.dependencies || hash(current.dependencies) !== row.dependency_hash || enrollment.enrolled&&!enrollment.valid;
  const synthetic = await hasSyntheticProof(client,dependencies);
  const result = row.result, route = result.route;
  const revisionResult=await verifyRevisionResultForProposal(client,{projectId:row.project_id,proposalId:row.id,result,dependencies,proposalHash:row.proposal_hash});
  const applicability=await readProposalApplicability(client,{projectId:row.project_id,jobId:row.job_id,cableId:row.cable_id,
    proposalId:row.id,dependencyHash:row.dependency_hash,dependencyVersion:dependencies.schemaVersion,
    jobState:row.job_state,cancelRequested:row.cancel_requested,seal:revisionResult});
  const routingPreferences=proposalRoutingPreferences(dependencies.options);
  let endpointIssue: string | null = null;
  try { requireVersionedCalculationScope(dependencies); }
  catch (error) { endpointIssue = error instanceof PathFinderError ? error.message : 'Calculate and review a fresh proposal against current dependencies.'; }
  const barrierEvidence=readBarrierWriteEvidence(dependencies,result);
  const compatibilityIssue = (barrierEvidence?null:BARRIER_WRITE_UNVERIFIED_MESSAGE) ?? endpointIssue ?? (route ? routeCompatibilityIssue(route.routeText) : null)
    ?? (result.design != null ? designLengthCompatibilityIssue(result.design.designLengthMeters) : null)
    ?? (routingPreferences ? null : 'The original calculation preferences are unavailable. Calculate and review a fresh proposal.')
    ?? (revisionResult ? null : 'The immutable cable baseline and exact length components are unavailable for this historical result. Calculate a fresh proposal.');
  return {schemaVersion:'wfc.pf.proposal.v2',id:row.id,projectId:row.project_id,jobId:row.job_id,cableId:row.cable_id,status:row.status,
    proposalHash:row.proposal_hash,cableWriteRevision:dependencies.cableWriteRevision,stale,synthetic,engineeringAccepted:synthetic,
    acceptanceScope:synthetic ? 'local-synthetic-fixture' : 'manual-review',canApply:!stale && !compatibilityIssue && row.status === 'calculated' && route?.success===true && result.design != null && applicability.applicable,
    itemApplicability:applicability.evidence,
    compatibilityIssue,routingPreferences,
    message:unavailable==='cable' ? 'The cable no longer exists. This historical result remains available for inspection and cannot be applied.'
      : unavailable==='barriers' ? barrierHistoricalUnavailableMessage : stale ? 'Dependencies changed. Calculate a fresh proposal.' : result.message,
    engineeringMessage:synthetic ? 'Synthetic local demonstration only.' : (dependencies.schemaVersion === 'pathfinder.dependencies.v6'||dependencies.schemaVersion === 'pathfinder.dependencies.v7'||dependencies.schemaVersion==='pathfinder.dependencies.v8')&&(isAutomaticEndpointCalculationPoint(dependencies.from)||isAutomaticEndpointCalculationPoint(dependencies.to))
      ? 'Automatic model endpoint candidates use approximate bounding-box anchors. Review their positions, route and length before explicit Apply. These endpoints have not been manually confirmed. Native engineering parity has not been performed.'
      : 'Manual review and explicit Apply are required for this exact proposal. Native engineering parity has not been performed.',
    design:result.design ?? null,lengthLedger:result.lengthLedger??null,
    ...(result.directSecondary ? { directSecondary: result.directSecondary } : {}),
    ...(result.schemaVersion==='pathfinder.model.response.v3'?{barriers:result.barriers,
      ...(result.barriers.directSecondary?.mode==='direct-secondary'?{directSecondary:result.barriers.directSecondary.distanceDecision}:{})}:{}),
    revisionResultHash:revisionResult?.revisionResultSha256??null,revisionBaselineHash:revisionResult?.baselineHash??null,
    ...(detail?{revisionResult}:{}),route:route ? {...route,pathPoints:undefined,...(detail ? {points:route.pathPoints.map((point:Row) => [point.x,point.y,point.z]),objectIds:[...new Set(route.segmentIds as string[])]} : {})} : null,
    calculationMode:result.calculationMode,
    provenance:{dependencyVersion:dependencies.schemaVersion,dependencyHash:row.dependency_hash,
      engineIdentity:['pathfinder.dependencies.v5','pathfinder.dependencies.v6','pathfinder.dependencies.v7','pathfinder.dependencies.v8'].includes(dependencies.schemaVersion)?('engineIdentity' in dependencies?dependencies.engineIdentity:null):null,
      ...(dependencies.schemaVersion==='pathfinder.dependencies.v6'||dependencies.schemaVersion==='pathfinder.dependencies.v7'||dependencies.schemaVersion==='pathfinder.dependencies.v8'?{endpointSources:{
        from:isAutomaticEndpointCalculationPoint(dependencies.from)?'automatic-model-candidate':'confirmed-shared-location',
        to:isAutomaticEndpointCalculationPoint(dependencies.to)?'automatic-model-candidate':'confirmed-shared-location',
      }}:{}),
      automatic:enrollment.enrolled?{generation:enrollment.generation,authorityEpoch:enrollment.authorityEpoch,current:enrollment.valid,reasonCode:enrollment.code}:null},
    ...(detail ? {dependencies,prepared:result.prepared ?? null,effectiveCategory:result.effectiveCategory ?? null} : {}),createdAt:row.created_at};
}

function batchHash(batch:DependencyBatch,timeout:number):string{
  return hash({timeoutMilliseconds:timeout,items:batch.items.map(item=>({id:item.id,dependencies:item.dependencies,status:item.status,cableWriteRevision:item.cable.cable_write_revision}))});
}
async function admissionModelRef(client:PoolClient,projectId:string){
  const row=(await client.query<{id:string;selectionRevision:string;contentFingerprint:string}>(`SELECT m.id,s.selection_revision::text AS "selectionRevision",m.content_fingerprint AS "contentFingerprint"
    FROM project_model_selections s JOIN model_versions m ON m.project_id=s.project_id AND m.id=s.active_model_version_id WHERE s.project_id=$1`,[projectId])).rows[0];
  return row??null;
}
export async function insertCalculationBatch(client:PoolClient,projectId:string,who:OperationPrincipal,batch:DependencyBatch,timeout:number,requestHash:string,bounds:{signal?:AbortSignal;deadline:number},admission:{kind:'manual'|'automatic'|'location-impact';generation:string|null}={kind:'manual',generation:null}):Promise<string>{
  const check=()=>{bounds.signal?.throwIfAborted();if(Date.now()>bounds.deadline)throw new PathFinderError('RECALCULATION_COLLECTION_DEADLINE',503);};check();
  const id=randomUUID(),blocked=batch.items.filter(item=>!item.dependencies).length;
  await client.query(`INSERT INTO pf_jobs(id,project_id,requested_by,login_id,login_expires_at,state,total,completed,options,timeout_ms,request_hash,authority_kind,grant_provenance)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,projectId,who.userId,who.loginId??null,isGrantPrincipal(who)?null:new Date(who.loginExpiresAt),blocked===batch.items.length?'complete':'queued',batch.items.length,blocked,batch.options,timeout,requestHash,isGrantPrincipal(who)?'calculation-grant':'current-login',isGrantPrincipal(who)?grantProvenance(who):null]);
  for(let offset=0;offset<batch.items.length;offset+=RECALCULATION_LIMITS.cableChunk){
    check();
    const rows=batch.items.slice(offset,offset+RECALCULATION_LIMITS.cableChunk).map(item=>({cable_id:item.id,state:item.dependencies?'waiting':'blocked',dependencies:item.dependencies,status:item.status,message:item.message}));
    await client.query(`INSERT INTO pf_job_items(project_id,job_id,cable_id,state,dependencies,status,message)
      SELECT $1::uuid,$2::uuid,x.cable_id,x.state,x.dependencies,x.status,x.message FROM jsonb_to_recordset($3::jsonb)
      AS x(cable_id uuid,state text,dependencies jsonb,status text,message text)`,[projectId,id,JSON.stringify(rows)]);
  }
  check();
  await persistRevisionAdmission(client,{projectId,jobId:id,...admission,inputSha256:requestHash,items:batch.items,options:batch.options,modelRef:await admissionModelRef(client,projectId)});
  return id;
}

/** Called only inside the scheduler's current-principal transaction; scheduler state locks LAST. */
export const createAutomaticJobInTransaction:RecalculationJobAdapter['createInTransaction']=async(client,input)=>{
  const deadline=Date.now()+RECALCULATION_LIMITS.collectionMilliseconds;
  const {barrierRouting:_previousIntent,...mathPreferences}=input.preferences;
  // Browser-closed work always derives the current publication with drilling off.
  // Historical or expired preferences cannot downgrade a fresh calculation.
  const options={...defaultOptions,...mathPreferences,
    barrierRouting:await readCurrentBarrierAdmissionIntent(client,input.projectId,false)};
  const batch=await collectDependencyBatchInTransaction(client,{projectId:input.projectId,options,signal:input.signal,deadline,
    dependencyVersion:'pathfinder.dependencies.v8'});
  const inputSha256=batchHash(batch,input.timeoutMilliseconds),readyCables=batch.items.filter(item=>item.dependencies).length;
  const reasonCodes=[...new Set(batch.items.filter(item=>!item.dependencies).map(item=>item.status.toUpperCase()))].sort();
  input.signal.throwIfAborted();
  if(Date.now()>deadline)throw new PathFinderError('RECALCULATION_COLLECTION_DEADLINE',503);
  // Collection already owns all target cable FOR UPDATE locks and the caller
  // owns project/user/login. Acquire the remaining global installation guard
  // before the scheduler latch; mandate admission only reacquires these locks.
  if(input.automaticPairSource){
    if(isGrantPrincipal(input.principal))throw new PathFinderError('AUTOMATIC_PAIR_HUMAN_AUTHORITY_REQUIRED',403);
    await client.query('/* automatic-generation:installation-lock */ SELECT installation_epoch FROM pf_installation_state WHERE singleton=true FOR SHARE');
  }
  await input.beforeInsert();
  // beforeInsert has already validated this exact generation and owns the
  // scheduler latch. Every scope, including an all-blocked one, gets a baseline.
  const generation=(await client.query<{generation:string}>('SELECT desired_generation::text AS generation FROM pf_recalculation_state WHERE project_id=$1',[input.projectId])).rows[0]?.generation;
  if(generation===undefined)throw new PathFinderError('REVISION_GENERATION_REQUIRED',409);
  const jobId=readyCables?await insertCalculationBatch(client,input.projectId,input.principal,batch,input.timeoutMilliseconds,inputSha256,{signal:input.signal,deadline},{kind:'automatic',generation}):null;
  if(jobId&&input.automaticPairSource){
    if(isGrantPrincipal(input.principal)||input.automaticPairSource.generation!==generation)throw new PathFinderError('AUTOMATIC_OUTPUT_AUTHORITY_CHANGED',409);
    await appendAutomaticPairMandatesInTransaction(client,{projectId:input.projectId,jobId,principal:input.principal,
      policy:input.automaticPairSource.authorization.policy,requestSha256:inputSha256,source:input.automaticPairSource,
      items:batch.items.flatMap(item=>item.dependencies?[{cableId:item.id,cableWriteRevision:item.cable.cable_write_revision,dependencyHash:hash(item.dependencies)}]:[])
        .sort((a,b)=>a.cableId<b.cableId?-1:1)},()=>{input.signal.throwIfAborted();if(Date.now()>deadline)throw new PathFinderError('RECALCULATION_COLLECTION_DEADLINE',503);});
  }
  if(!jobId)await persistRevisionAdmission(client,{projectId:input.projectId,jobId:null,generation,kind:'automatic',inputSha256,items:batch.items,options:batch.options,modelRef:await admissionModelRef(client,input.projectId)});
  return{jobId,inputSha256,duplicate:false,readyCables,blockedCables:batch.items.length-readyCables,total:batch.items.length,reasonCodes};
};
export function createPathFinderJobs(pool:Pool,registry:PathFinderRepository) {
  return {
    createInTransaction:createAutomaticJobInTransaction,
    async create(projectId:string,who:JobPrincipal,input:z.infer<typeof createJobSchema>) {
      if(!input.options?.barrierRouting)throw new PathFinderError('BARRIER_ROUTING_INTENT_REQUIRED',409,
        'Refresh Path Finder and configure the current barriers, or explicitly enable drilling for this calculation.');
      const matched = await registry.match(projectId,who,input.expectedRegistryRevision,input.cableIds);
      return principalTransaction(pool,projectId,who,async client => {
        const revision = (await client.query<Row>('SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1 FOR UPDATE',[projectId])).rows[0];
        if (revision.registry_revision !== matched.registryRevision) throw new PathFinderError('REGISTRY_CONFLICT',409);
        await client.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='30000ms'");
        const deadline=Date.now()+RECALCULATION_LIMITS.collectionMilliseconds;
        const batch=await collectDependencyBatchInTransaction(client,{projectId,options:input.options??{...defaultOptions},cableIds:input.cableIds,deadline,
          dependencyVersion:'pathfinder.dependencies.v8'});
        const calculationSha256=batchHash(batch,input.timeoutMilliseconds??60000);
        // A write policy is exact request authority, never a mathematical input.
        // Historical requests without it retain their original hash and meaning.
        const requestHash=input.automaticPairPolicy ? hash({schemaVersion:'wfc.pf.automatic-pair-job-request.v1',
          automaticPairPolicy:input.automaticPairPolicy,options:batch.options,calculationSha256}) : calculationSha256;
        if (!input.force) {
          const latest=(await client.query<Row>("SELECT id,state,cancel_requested,request_hash FROM pf_jobs WHERE project_id=$1 AND kind='calculate' ORDER BY created_at DESC,id DESC LIMIT 1",[projectId])).rows[0];
          if (latest && (latest.state==='cancelled' || latest.cancel_requested || latest.state==='failed' && latest.request_hash===requestHash))
            return {jobId:latest.id,duplicate:true,paused:true,registryRevision:matched.registryRevision};
        }
        const existing = (await client.query<Row>(`SELECT id FROM pf_jobs WHERE project_id=$1 AND requested_by=$2 AND login_id=$3 AND request_hash=$4
          AND kind='calculate' AND state IN ('queued','running','complete') ORDER BY created_at DESC LIMIT 1`,[projectId,who.userId,who.loginId,requestHash])).rows[0];
        if (existing && !input.force) return {jobId:existing.id,duplicate:true,registryRevision:matched.registryRevision};
        if(Date.now()>deadline)throw new PathFinderError('RECALCULATION_COLLECTION_DEADLINE',503);
        const jobId=await insertCalculationBatch(client,projectId,who,batch,input.timeoutMilliseconds??60000,requestHash,{deadline});
        if(input.automaticPairPolicy&&batch.items.some(item=>item.dependencies))await appendAutomaticPairMandatesInTransaction(client,{projectId,jobId,principal:who,
          policy:input.automaticPairPolicy,requestSha256:requestHash,source:{kind:'explicit-job'},
          items:batch.items.flatMap(item=>item.dependencies?[{cableId:item.id,cableWriteRevision:item.cable.cable_write_revision,
            dependencyHash:hash(item.dependencies)}]:[]).sort((a,b)=>a.cableId<b.cableId?-1:1)},()=>{if(Date.now()>deadline)throw new PathFinderError('RECALCULATION_COLLECTION_DEADLINE',503);});
        return {jobId,duplicate:false,registryRevision:matched.registryRevision};
      });
    },
    async state(projectId:string,who:JobPrincipal) {
      return principalTransaction(pool,projectId,who,async client => {
        const jobs = await client.query<Row>('SELECT * FROM pf_jobs WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[projectId]);
        const proposals = await client.query<Row>(`SELECT p.*,j.state AS job_state,j.cancel_requested FROM pf_proposals p JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id
          WHERE p.project_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT ${RECENT_PROPOSAL_PREVIEW_LIMIT}`,[projectId]);
        const readCurrent = createTransactionDependencyReadCollector(client, projectId);
        const values = []; for (const proposal of proposals.rows) values.push(await proposalDto(client,proposal,false,readCurrent));
        return {jobs:jobs.rows.map(jobDto),proposals:values};
      });
    },
    async get(projectId:string,who:JobPrincipal,jobId:string) {
      return principalTransaction(pool,projectId,who,async client => {
        const row = (await client.query<Row>('SELECT * FROM pf_jobs WHERE project_id=$1 AND id=$2',[projectId,jobId])).rows[0];
        if (!row) throw new PathFinderError('JOB_NOT_FOUND',404);
        const items = await client.query<Row>(`/* job-output-items */ SELECT i.cable_id,i.state,i.status,i.message,
          d.status AS automatic_update_status,d.receipt_id AS automatic_update_receipt,d.reason_code AS automatic_update_reason
          FROM pf_job_items i LEFT JOIN pf_automatic_pair_dispatch d ON d.project_id=i.project_id AND d.job_id=i.job_id AND d.cable_id=i.cable_id
          WHERE i.project_id=$1 AND i.job_id=$2 ORDER BY i.cable_id`,[projectId,jobId]);
        return {...jobDto(row),items:items.rows.map(item => {
          const value = {cableId:item.cable_id,status:item.status,state:item.state,message:item.message};
          if (item.automatic_update_status == null) return value;
          const update = jobAutomaticUpdateSchema.safeParse({status:item.automatic_update_status,receiptId:item.automatic_update_receipt??null,reasonCode:item.automatic_update_reason??null});
          if (!update.success) throw new PathFinderError('JOB_AUTOMATIC_UPDATE_INVALID',500);
          return {...value,automaticUpdate:update.data};
        })};
      });
    },
    async cancel(projectId:string,who:JobPrincipal,jobId:string) {
      return principalTransaction(pool,projectId,who,async client => {
        const row = (await client.query<Row>(`UPDATE pf_jobs SET cancel_requested=true,state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END,updated_at=NOW()
          WHERE project_id=$1 AND id=$2 RETURNING *`,[projectId,jobId])).rows[0];
        if (!row) throw new PathFinderError('JOB_NOT_FOUND',404);
        await pauseRecalculationForJob(client,{projectId,jobId});
        await cancelLocationImpactForJob(client,{projectId,jobId});
        return jobDto(row);
      });
    },
    async proposal(projectId:string,who:JobPrincipal,proposalId:string) {
      return principalTransaction(pool,projectId,who,async client => {
        const row = (await client.query<Row>(`SELECT p.*,j.state AS job_state,j.cancel_requested FROM pf_proposals p JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id WHERE p.project_id=$1 AND p.id=$2`,[projectId,proposalId])).rows[0];
        if (!row) throw new PathFinderError('PROPOSAL_NOT_FOUND',404);
        return proposalDto(client,row,true);
      });
    },
    async review(projectId:string,who:JobPrincipal,proposalId:string,expectedProposalHash:string) {
      return principalTransaction(pool,projectId,who,async client => {
        const row = (await client.query<Row>(`SELECT p.*,j.state AS job_state,j.cancel_requested FROM pf_proposals p JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id WHERE p.project_id=$1 AND p.id=$2 FOR SHARE OF p,j`,[projectId,proposalId])).rows[0];
        if (!row) throw new PathFinderError('PROPOSAL_NOT_FOUND',404);
        if (row.proposal_hash !== expectedProposalHash) throw new PathFinderError('PROPOSAL_HASH_CONFLICT',409);
        const frozen=row.dependencies as DependencySnapshot;
        requireBarrierWriteEvidence(frozen,row.result);
        const identity=await requireCurrentBarrierWriteScope(client,frozen as BarrierDependencySnapshot);
        const current=await collectDependenciesForVersion(client,projectId,row.cable_id,frozen.options,frozen.schemaVersion,true,identity);
        if(!current.dependencies||hash(current.dependencies)!==row.dependency_hash)throw new PathFinderError('PROPOSAL_STALE',409);
        await requireEnrollmentAuthority(client,{projectId,jobId:row.job_id,cableId:row.cable_id});
        const proposal = await proposalDto(client,row,true);
        if (proposal.stale) throw new PathFinderError('PROPOSAL_STALE',409);
        if (!proposal.canApply) throw new PathFinderError('PROPOSAL_NOT_APPLICABLE',409,'Only a complete applicable proposal can be confirmed for review.');
        const sealed=await verifyRevisionResultForProposal(client,{projectId,proposalId,result:row.result,dependencies:row.dependencies,proposalHash:row.proposal_hash});
        if(!sealed||!sealed.ledgerHash)throw new PathFinderError('REVISION_RESULT_REVIEW_REQUIRED',409);
        const reviewId = randomUUID(); await client.query(`INSERT INTO pf_reviews(id,project_id,proposal_id,actor_id,proposal_hash,validation_method,revision_result_sha256,review_login_id,review_dependency_sha256)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[reviewId,projectId,proposalId,who.userId,expectedProposalHash,proposal.synthetic?'synthetic-fixture':'manual-review',sealed.revisionResultSha256,who.loginId,sealed.dependencyHash]);
        await requireCurrentBarrierWriteScope(client,frozen as BarrierDependencySnapshot);
        await requireEnrollmentAuthority(client,{projectId,jobId:row.job_id,cableId:row.cable_id});
        assertLoginNotExpired(who);
        return {reviewId,proposal};
      });
    },
  };
}
export type PathFinderJobs = ReturnType<typeof createPathFinderJobs>;
