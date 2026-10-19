import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { PathFinderError } from './errors.js';
import { collectDependencies, hash, hasSyntheticProof } from './dependencies.js';
import type { PathFinderRepository } from './repository.js';
import { defaultOptions, type createJobSchema, type DependencySnapshot, type JobPrincipal } from './jobContracts.js';
import { designLengthCompatibilityIssue,routeCompatibilityIssue,proposalRoutingPreferences } from './jobContracts.js';
import { principalTransaction } from './auth.js';
import { isGrantPrincipal, grantProvenance, type OperationPrincipal } from './operationAuthority.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { collectDependencyBatchInTransaction, type DependencyBatch } from './dependencyBatch.js';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';
import { pauseRecalculationForJob, readRecalculationJobAuthority, requireEnrollmentAuthority, type RecalculationJobAdapter } from './recalculationRepository.js';
import { calculationEngineIdentity } from './calculationEngineIdentity.js';
import { persistRevisionAdmission, verifyRevisionResultForProposal } from './revisionResultRepository.js';

type Row = Record<string,any>;
export function jobDto(row:Row) {
  return {id:row.id,projectId:row.project_id,kind:row.kind ?? 'calculate',status:row.state,total:row.total,completed:row.completed,
    cancelRequested:row.cancel_requested,failure:row.failure,attempts:row.attempts,createdAt:row.created_at,updatedAt:row.updated_at};
}
export async function proposalDto(client:PoolClient,row:Row,detail:boolean) {
  const dependencies = row.dependencies as DependencySnapshot;
  let current:Awaited<ReturnType<typeof collectDependencies>>|null;
  try {current=await collectDependencies(client,row.project_id,row.cable_id,dependencies.options);}
  catch(error){
    // Retained history outlives a deleted live cable. Only this exact missing
    // current-input state is readable as stale; other collection errors remain
    // failures and the locked Review/Apply collectors still refuse the write.
    if(error instanceof PathFinderError&&error.code==='CABLE_NOT_FOUND')current=null;
    else throw error;
  }
  const enrollment=await readRecalculationJobAuthority(client,{projectId:row.project_id,jobId:row.job_id});
  const stale = current===null || !current.dependencies || hash(current.dependencies) !== row.dependency_hash || enrollment.enrolled&&!enrollment.valid;
  const synthetic = await hasSyntheticProof(client,dependencies);
  const result = row.result, route = result.route;
  const revisionResult=await verifyRevisionResultForProposal(client,{projectId:row.project_id,proposalId:row.id,result,dependencies,proposalHash:row.proposal_hash});
  const routingPreferences=proposalRoutingPreferences(dependencies.options);
  let endpointIssue: string | null = null;
  try { requireVersionedCalculationScope(dependencies); }
  catch (error) { endpointIssue = error instanceof PathFinderError ? error.message : 'Calculate and review a fresh proposal against current dependencies.'; }
  const compatibilityIssue = endpointIssue ?? (route ? routeCompatibilityIssue(route.routeText) : null)
    ?? (result.design != null ? designLengthCompatibilityIssue(result.design.designLengthMeters) : null)
    ?? (routingPreferences ? null : 'The original calculation preferences are unavailable. Calculate and review a fresh proposal.')
    ?? (revisionResult ? null : 'The immutable cable baseline and exact length components are unavailable for this historical result. Calculate a fresh proposal.');
  return {schemaVersion:'wfc.pf.proposal.v2',id:row.id,projectId:row.project_id,jobId:row.job_id,cableId:row.cable_id,status:row.status,
    proposalHash:row.proposal_hash,cableWriteRevision:dependencies.cableWriteRevision,stale,synthetic,engineeringAccepted:synthetic,
    acceptanceScope:synthetic ? 'local-synthetic-fixture' : 'manual-review',canApply:!stale && !compatibilityIssue && !row.cancel_requested && row.status === 'calculated' && route?.success===true && result.design != null && row.job_state === 'complete',
    compatibilityIssue,routingPreferences,
    message:current===null ? 'The cable no longer exists. This historical result remains available for inspection and cannot be applied.' : stale ? 'Dependencies changed. Calculate a fresh proposal.' : result.message,
    engineeringMessage:synthetic ? 'Synthetic local demonstration only.' : 'Manual review and explicit Apply are required for this exact proposal. Native engineering parity has not been performed.',
    design:result.design ?? null,lengthLedger:result.lengthLedger??null,revisionResultHash:revisionResult?.revisionResultSha256??null,revisionBaselineHash:revisionResult?.baselineHash??null,
    ...(detail?{revisionResult}:{}),route:route ? {...route,pathPoints:undefined,...(detail ? {points:route.pathPoints.map((point:Row) => [point.x,point.y,point.z]),objectIds:[...new Set(route.segmentIds as string[])]} : {})} : null,
    calculationMode:result.calculationMode,
    provenance:{dependencyVersion:dependencies.schemaVersion,dependencyHash:row.dependency_hash,
      engineIdentity:dependencies.schemaVersion==='pathfinder.dependencies.v5'?dependencies.engineIdentity:null,
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
async function insertCalculationBatch(client:PoolClient,projectId:string,who:OperationPrincipal,batch:DependencyBatch,timeout:number,requestHash:string,bounds:{signal?:AbortSignal;deadline:number},admission:{kind:'manual'|'automatic';generation:string|null}={kind:'manual',generation:null}):Promise<string>{
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
  const batch=await collectDependencyBatchInTransaction(client,{projectId:input.projectId,options:{...defaultOptions,...input.preferences},signal:input.signal,deadline});
  const inputSha256=batchHash(batch,input.timeoutMilliseconds),readyCables=batch.items.filter(item=>item.dependencies).length;
  const reasonCodes=[...new Set(batch.items.filter(item=>!item.dependencies).map(item=>item.status.toUpperCase()))].sort();
  input.signal.throwIfAborted();
  if(Date.now()>deadline)throw new PathFinderError('RECALCULATION_COLLECTION_DEADLINE',503);
  await input.beforeInsert();
  // beforeInsert has already validated this exact generation and owns the
  // scheduler latch. Every scope, including an all-blocked one, gets a baseline.
  const generation=(await client.query<{generation:string}>('SELECT desired_generation::text AS generation FROM pf_recalculation_state WHERE project_id=$1',[input.projectId])).rows[0]?.generation;
  if(generation===undefined)throw new PathFinderError('REVISION_GENERATION_REQUIRED',409);
  const jobId=readyCables?await insertCalculationBatch(client,input.projectId,input.principal,batch,input.timeoutMilliseconds,inputSha256,{signal:input.signal,deadline},{kind:'automatic',generation}):null;
  if(!jobId)await persistRevisionAdmission(client,{projectId:input.projectId,jobId:null,generation,kind:'automatic',inputSha256,items:batch.items,options:batch.options,modelRef:await admissionModelRef(client,input.projectId)});
  return{jobId,inputSha256,duplicate:false,readyCables,blockedCables:batch.items.length-readyCables,total:batch.items.length,reasonCodes};
};
export function createPathFinderJobs(pool:Pool,registry:PathFinderRepository) {
  return {
    createInTransaction:createAutomaticJobInTransaction,
    async create(projectId:string,who:JobPrincipal,input:z.infer<typeof createJobSchema>) {
      const matched = await registry.match(projectId,who,input.expectedRegistryRevision);
      return principalTransaction(pool,projectId,who,async client => {
        const revision = (await client.query<Row>('SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1 FOR UPDATE',[projectId])).rows[0];
        if (revision.registry_revision !== matched.registryRevision) throw new PathFinderError('REGISTRY_CONFLICT',409);
        await client.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='30000ms'");
        const deadline=Date.now()+RECALCULATION_LIMITS.collectionMilliseconds;
        const batch=await collectDependencyBatchInTransaction(client,{projectId,options:input.options??{...defaultOptions},cableIds:input.cableIds,deadline});
        const requestHash=batchHash(batch,input.timeoutMilliseconds??60000);
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
        return {jobId,duplicate:false,registryRevision:matched.registryRevision};
      });
    },
    async state(projectId:string,who:JobPrincipal) {
      return principalTransaction(pool,projectId,who,async client => {
        const jobs = await client.query<Row>('SELECT * FROM pf_jobs WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[projectId]);
        const proposals = await client.query<Row>(`SELECT p.*,j.state AS job_state,j.cancel_requested FROM pf_proposals p JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id
          WHERE p.project_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT 30`,[projectId]);
        const values = []; for (const proposal of proposals.rows) values.push(await proposalDto(client,proposal,false));
        return {jobs:jobs.rows.map(jobDto),proposals:values};
      });
    },
    async get(projectId:string,who:JobPrincipal,jobId:string) {
      return principalTransaction(pool,projectId,who,async client => {
        const row = (await client.query<Row>('SELECT * FROM pf_jobs WHERE project_id=$1 AND id=$2',[projectId,jobId])).rows[0];
        if (!row) throw new PathFinderError('JOB_NOT_FOUND',404);
        const items = await client.query<Row>('SELECT cable_id,state,status,message FROM pf_job_items WHERE project_id=$1 AND job_id=$2 ORDER BY cable_id',[projectId,jobId]);
        return {...jobDto(row),items:items.rows.map(item => ({cableId:item.cable_id,status:item.status,state:item.state,message:item.message}))};
      });
    },
    async cancel(projectId:string,who:JobPrincipal,jobId:string) {
      return principalTransaction(pool,projectId,who,async client => {
        const row = (await client.query<Row>(`UPDATE pf_jobs SET cancel_requested=true,state=CASE WHEN state='queued' THEN 'cancelled' ELSE state END,updated_at=NOW()
          WHERE project_id=$1 AND id=$2 RETURNING *`,[projectId,jobId])).rows[0];
        if (!row) throw new PathFinderError('JOB_NOT_FOUND',404);
        await pauseRecalculationForJob(client,{projectId,jobId});
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
        await calculationEngineIdentity({force:true});
        const frozen=row.dependencies as DependencySnapshot;
        await collectDependencies(client,projectId,row.cable_id,frozen.options,true);
        await requireEnrollmentAuthority(client,{projectId,jobId:row.job_id});
        const proposal = await proposalDto(client,row,true);
        if (proposal.stale) throw new PathFinderError('PROPOSAL_STALE',409);
        if (!proposal.canApply) throw new PathFinderError('PROPOSAL_NOT_APPLICABLE',409,'Only a complete applicable proposal can be confirmed for review.');
        const sealed=await verifyRevisionResultForProposal(client,{projectId,proposalId,result:row.result,dependencies:row.dependencies,proposalHash:row.proposal_hash});
        if(!sealed||!sealed.ledgerHash)throw new PathFinderError('REVISION_RESULT_REVIEW_REQUIRED',409);
        const reviewId = randomUUID(); await client.query(`INSERT INTO pf_reviews(id,project_id,proposal_id,actor_id,proposal_hash,validation_method,revision_result_sha256,review_login_id,review_dependency_sha256)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[reviewId,projectId,proposalId,who.userId,expectedProposalHash,proposal.synthetic?'synthetic-fixture':'manual-review',sealed.revisionResultSha256,who.loginId,sealed.dependencyHash]);
        await requireEnrollmentAuthority(client,{projectId,jobId:row.job_id});
        return {reviewId,proposal};
      });
    },
  };
}
export type PathFinderJobs = ReturnType<typeof createPathFinderJobs>;
