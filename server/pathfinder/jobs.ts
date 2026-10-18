import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { PathFinderError } from './errors.js';
import { collectDependencies, hash, hasSyntheticProof } from './dependencies.js';
import type { PathFinderRepository } from './repository.js';
import { defaultOptions, type createJobSchema, type DependencySnapshot, type JobPrincipal } from './jobContracts.js';
import { designLengthCompatibilityIssue,routeCompatibilityIssue } from './jobContracts.js';
import { principalTransaction } from './auth.js';
import { projectRoutingSettings } from './settings.js';

type Row = Record<string,any>;
export function jobDto(row:Row) {
  return {id:row.id,projectId:row.project_id,kind:row.kind ?? 'calculate',status:row.state,total:row.total,completed:row.completed,
    cancelRequested:row.cancel_requested,failure:row.failure,attempts:row.attempts,createdAt:row.created_at,updatedAt:row.updated_at};
}
export async function proposalDto(client:PoolClient,row:Row,detail:boolean) {
  const dependencies = row.dependencies as DependencySnapshot;
  const current = await collectDependencies(client,row.project_id,row.cable_id,dependencies.options);
  const stale = !current.dependencies || hash(current.dependencies) !== row.dependency_hash;
  const synthetic = await hasSyntheticProof(client,dependencies);
  const result = row.result, route = result.route;
  const compatibilityIssue = (route ? routeCompatibilityIssue(route.routeText) : null)
    ?? (result.design != null ? designLengthCompatibilityIssue(result.design.designLengthMeters) : null);
  return {id:row.id,projectId:row.project_id,jobId:row.job_id,cableId:row.cable_id,status:row.status,
    proposalHash:row.proposal_hash,cableWriteRevision:dependencies.cableWriteRevision,stale,synthetic,engineeringAccepted:synthetic,
    acceptanceScope:synthetic ? 'local-synthetic-fixture' : 'manual-review',canApply:!stale && !compatibilityIssue && !row.cancel_requested && row.status === 'calculated' && route?.success===true && result.design != null && row.job_state === 'complete',
    compatibilityIssue,
    message:stale ? 'Dependencies changed. Calculate a fresh proposal.' : result.message,
    engineeringMessage:synthetic ? 'Synthetic local demonstration only.' : 'Manual review and explicit Apply are required for this exact proposal. Native engineering parity has not been performed.',
    design:result.design ?? null,route:route ? {...route,pathPoints:undefined,...(detail ? {points:route.pathPoints.map((point:Row) => [point.x,point.y,point.z]),objectIds:[...new Set(route.segmentIds as string[])]} : {})} : null,
    calculationMode:result.calculationMode,
    ...(detail ? {dependencies,prepared:result.prepared ?? null,effectiveCategory:result.effectiveCategory ?? null} : {}),createdAt:row.created_at};
}
export function createPathFinderJobs(pool:Pool,registry:PathFinderRepository) {
  return {
    async create(projectId:string,who:JobPrincipal,input:z.infer<typeof createJobSchema>) {
      const matched = await registry.match(projectId,who,input.expectedRegistryRevision);
      return principalTransaction(pool,projectId,who,async client => {
        const revision = (await client.query<Row>('SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1 FOR UPDATE',[projectId])).rows[0];
        if (revision.registry_revision !== matched.registryRevision) throw new PathFinderError('REGISTRY_CONFLICT',409);
        const cables = await client.query<Row>(`SELECT id FROM cables WHERE project_id=$1 ${input.cableIds ? 'AND id=ANY($2::uuid[])' : ''} ORDER BY cable_id,id LIMIT 10001`,input.cableIds ? [projectId,input.cableIds] : [projectId]);
        if (!cables.rows.length) throw new PathFinderError('NO_CABLES',409,'There are no selected cables to calculate.');
        if (cables.rows.length > 10000) throw new PathFinderError('JOB_CABLE_BUDGET',413);
        if (input.cableIds && new Set(input.cableIds).size !== cables.rows.length) throw new PathFinderError('CABLE_NOT_FOUND',404);
        const {options}=await projectRoutingSettings(client,projectId,input.options ?? {...defaultOptions}),items = [];
        for (const cable of cables.rows) items.push({id:cable.id,...await collectDependencies(client,projectId,cable.id,options,true)});
        const requestHash = hash({timeoutMilliseconds:input.timeoutMilliseconds ?? 60000,items:items.map(item => ({id:item.id,dependencies:item.dependencies,status:item.status,cableWriteRevision:item.cable.cable_write_revision}))});
        if (!input.force) {
          const latest=(await client.query<Row>("SELECT id,state,cancel_requested,request_hash FROM pf_jobs WHERE project_id=$1 AND kind='calculate' ORDER BY created_at DESC,id DESC LIMIT 1",[projectId])).rows[0];
          if (latest && (latest.state==='cancelled' || latest.cancel_requested || latest.state==='failed' && latest.request_hash===requestHash))
            return {jobId:latest.id,duplicate:true,paused:true,registryRevision:matched.registryRevision};
        }
        const existing = (await client.query<Row>(`SELECT id FROM pf_jobs WHERE project_id=$1 AND requested_by=$2 AND login_id=$3 AND request_hash=$4
          AND kind='calculate' AND state IN ('queued','running','complete') ORDER BY created_at DESC LIMIT 1`,[projectId,who.userId,who.loginId,requestHash])).rows[0];
        if (existing && !input.force) return {jobId:existing.id,duplicate:true,registryRevision:matched.registryRevision};
        const jobId = randomUUID(),blocked = items.filter(item => !item.dependencies).length;
        await client.query(`INSERT INTO pf_jobs(id,project_id,requested_by,login_id,login_expires_at,state,total,completed,options,timeout_ms,request_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[jobId,projectId,who.userId,who.loginId,new Date(who.loginExpiresAt),blocked === items.length ? 'complete' : 'queued',items.length,blocked,options,input.timeoutMilliseconds ?? 60000,requestHash]);
        for (const item of items) await client.query(`INSERT INTO pf_job_items(project_id,job_id,cable_id,state,dependencies,status,message)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,[projectId,jobId,item.id,item.dependencies ? 'waiting' : 'blocked',item.dependencies,item.status,item.message]);
        return {jobId,duplicate:false,registryRevision:matched.registryRevision};
      });
    },
    async state(projectId:string,who:JobPrincipal) {
      return principalTransaction(pool,projectId,who,async client => {
        const jobs = await client.query<Row>('SELECT * FROM pf_jobs WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[projectId]);
        const proposals = await client.query<Row>(`SELECT p.*,j.state AS job_state,j.cancel_requested FROM pf_proposals p JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id
          WHERE p.project_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT 1000`,[projectId]);
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
        const proposal = await proposalDto(client,row,true);
        if (proposal.stale) throw new PathFinderError('PROPOSAL_STALE',409);
        if (!proposal.canApply) throw new PathFinderError('PROPOSAL_NOT_APPLICABLE',409,'Only a complete applicable proposal can be confirmed for review.');
        const reviewId = randomUUID(); await client.query('INSERT INTO pf_reviews(id,project_id,proposal_id,actor_id,proposal_hash,validation_method) VALUES($1,$2,$3,$4,$5,$6)',[reviewId,projectId,proposalId,who.userId,expectedProposalHash,proposal.synthetic?'synthetic-fixture':'manual-review']);
        return {reviewId,proposal};
      });
    },
  };
}
export type PathFinderJobs = ReturnType<typeof createPathFinderJobs>;
