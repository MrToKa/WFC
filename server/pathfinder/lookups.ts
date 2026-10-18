import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { principalTransaction } from './auth.js';
import { activeModel, latestArtifact } from './repository.js';
import { PathFinderError } from './errors.js';
import { defaultOptions, type EngineOptions, type JobPrincipal, type lookupSchema } from './jobContracts.js';
import { hash } from './dependencies.js';
import { jobDto } from './jobs.js';

type Row=Record<string,any>;
export type LookupDependencies={schemaVersion:'pathfinder.lookup.dependencies.v1';projectId:string;modelVersionId:string;selectionRevision:string;contentFingerprint:string;
  artifactId:string;snapshotSha256:string;routeText:string;reverse:boolean;options:EngineOptions;engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1'};
export async function collectLookupDependencies(client:PoolClient,projectId:string,input:{routeText:string;reverse:boolean;options:EngineOptions;artifactId?:string;expectedSelectionRevision?:string}):Promise<LookupDependencies> {
  const selected=await activeModel(client,projectId,undefined,input.expectedSelectionRevision);
  if (!selected.active_model_version_id) throw new PathFinderError('MODEL_REQUIRED',409);
  const selection=(await client.query<Row>('SELECT active_model_version_id,selection_revision::text FROM project_model_selections WHERE project_id=$1 FOR SHARE',[projectId])).rows[0];
  const model=(await client.query<Row>('SELECT id,state,health,content_fingerprint FROM model_versions WHERE project_id=$1 AND id=$2 FOR SHARE',[projectId,selected.active_model_version_id])).rows[0];
  if (!model || model.state!=='ready' || model.health!=='healthy' || selection?.active_model_version_id!==model.id || selection.selection_revision!==selected.selection_revision) throw new PathFinderError('MODEL_UNAVAILABLE',409);
  const artifact=await latestArtifact(client,projectId,model.id);
  if (!artifact || input.artifactId && input.artifactId!==artifact.id || artifact.content_fingerprint!==model.content_fingerprint) throw new PathFinderError('MODEL_INDEX_CONFLICT',409);
  await client.query('SELECT id FROM pf_artifacts WHERE project_id=$1 AND id=$2 FOR SHARE',[projectId,artifact.id]);
  return {schemaVersion:'pathfinder.lookup.dependencies.v1',projectId,modelVersionId:model.id,selectionRevision:selection.selection_revision,contentFingerprint:model.content_fingerprint,
    artifactId:artifact.id,snapshotSha256:artifact.snapshot_sha256,routeText:input.routeText,reverse:input.reverse,options:input.options,engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1'};
}
export function createPathFinderLookups(pool:Pool) {
  return {
    async create(projectId:string,who:JobPrincipal,input:z.infer<typeof lookupSchema>) {
      return principalTransaction(pool,projectId,who,async client => {
        const dependencies=await collectLookupDependencies(client,projectId,{...input,options:input.options ?? {...defaultOptions}});
        const requestHash=hash({kind:'lookup',dependencies});
        const existing=(await client.query<Row>(`SELECT id FROM pf_jobs WHERE project_id=$1 AND requested_by=$2 AND login_id=$3 AND request_hash=$4
          AND kind='lookup' AND state IN ('queued','running') ORDER BY created_at DESC LIMIT 1`,[projectId,who.userId,who.loginId,requestHash])).rows[0];
        if (existing) return {jobId:existing.id,duplicate:true};
        const jobId=randomUUID();
        await client.query(`INSERT INTO pf_jobs(id,project_id,requested_by,login_id,login_expires_at,state,total,options,timeout_ms,request_hash,kind,diagnostic_input)
          VALUES($1,$2,$3,$4,$5,'queued',1,$6,60000,$7,'lookup',$8)`,[jobId,projectId,who.userId,who.loginId,new Date(who.loginExpiresAt),dependencies.options,requestHash,dependencies]);
        return {jobId,duplicate:false};
      });
    },
    async get(projectId:string,who:JobPrincipal,jobId:string) {
      return principalTransaction(pool,projectId,who,async client => {
        const job=(await client.query<Row>("SELECT * FROM pf_jobs WHERE project_id=$1 AND id=$2 AND kind='lookup'",[projectId,jobId])).rows[0];
        if (!job) throw new PathFinderError('LOOKUP_NOT_FOUND',404);
        const stored=(await client.query<Row>('SELECT * FROM pf_lookup_results WHERE project_id=$1 AND job_id=$2',[projectId,jobId])).rows[0];
        const input=job.diagnostic_input as LookupDependencies;let stale=Boolean(stored?.stale_at_completion);
        if (stored) {try {stale ||= hash(await collectLookupDependencies(client,projectId,input))!==hash(stored.dependencies);} catch {stale=true;}}
        const result=stored?.result,route=result?.route;
        return {...jobDto(job),kind:'lookup',input:{routeText:input.routeText,reverse:input.reverse},result:result ? {
          status:result.status,message:result.message,prepared:result.prepared ?? null,engineeringAccepted:false,acceptanceScope:'diagnostic-lookup',stale,design:null,
          route:route ? {...route,pathPoints:undefined,points:route.pathPoints.map((point:Row)=>[point.x,point.y,point.z]),objectIds:[...new Set(route.segmentIds as string[])]} : null,
        } : null};
      });
    },
  };
}
