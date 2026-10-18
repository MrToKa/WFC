import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { principalTransaction } from './auth.js';
import { activeModel, latestArtifact } from './repository.js';
import { PathFinderError } from './errors.js';
import { defaultOptions, type EngineOptions, type JobPrincipal, type lookupSchema, type lookupPlanSchema } from './jobContracts.js';
import { hash } from './dependencies.js';
import { jobDto } from './jobs.js';
import { projectRoutingSettings } from './settings.js';
import { validateSnapshotStructure } from './matching.js';
import { discardSnapshot,readSnapshot,snapshotDigest,storeSnapshot } from './storage.js';
import { runEngine } from './engine.js';

type Row=Record<string,any>;
export type LookupDependencies={schemaVersion:'pathfinder.lookup.dependencies.v1';projectId:string;modelVersionId:string;selectionRevision:string;contentFingerprint:string;
  artifactId:string;snapshotSha256:string;routeText:string;reverse:boolean;settingsRevision:string;connectionGap:string;options:EngineOptions;engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1'};
async function lookupModel(client:PoolClient,projectId:string,expectedSelectionRevision?:string) {
  const selected=await activeModel(client,projectId,undefined,expectedSelectionRevision);
  if (!selected.active_model_version_id) throw new PathFinderError('MODEL_REQUIRED',409);
  const selection=(await client.query<Row>('SELECT active_model_version_id,selection_revision::text FROM project_model_selections WHERE project_id=$1 FOR SHARE',[projectId])).rows[0];
  const model=(await client.query<Row>('SELECT id,state,health,content_fingerprint FROM model_versions WHERE project_id=$1 AND id=$2 FOR SHARE',[projectId,selected.active_model_version_id])).rows[0];
  if (!model || model.state!=='ready' || model.health!=='healthy' || selection?.active_model_version_id!==model.id || selection.selection_revision!==selected.selection_revision) throw new PathFinderError('MODEL_UNAVAILABLE',409);
  return {modelVersionId:model.id as string,selectionRevision:selection.selection_revision as string,contentFingerprint:model.content_fingerprint as string};
}
export async function collectLookupDependencies(client:PoolClient,projectId:string,input:{routeText:string;reverse:boolean;options:EngineOptions;artifactId?:string;expectedSelectionRevision?:string;planningOnly?:boolean}):Promise<LookupDependencies> {
  const model=await lookupModel(client,projectId,input.expectedSelectionRevision);
  const artifact=input.artifactId
    ? (await client.query<Row>('SELECT * FROM pf_artifacts WHERE project_id=$1 AND model_version_id=$2 AND id=$3 FOR SHARE',[projectId,model.modelVersionId,input.artifactId])).rows[0]
    : await latestArtifact(client,projectId,model.modelVersionId);
  if (!artifact || input.artifactId && artifact.id!==input.artifactId || artifact.content_fingerprint!==model.contentFingerprint) throw new PathFinderError('MODEL_INDEX_CONFLICT',409);
  const purpose=artifact.purpose ?? 'planning';
  if (input.planningOnly && purpose!=='planning') throw new PathFinderError('MODEL_INDEX_CONFLICT',409,'Path calculation requires the current planning artifact.');
  if (purpose==='planning') {
    if ((await latestArtifact(client,projectId,model.modelVersionId))?.id!==artifact.id) throw new PathFinderError('MODEL_INDEX_CONFLICT',409);
  } else if (purpose!=='lookup' || !artifact.capture?.lookupRouteCodes?.length || artifact.capture.adapterVersion!=='wfc.protected-lookup-capture.v1') throw new PathFinderError('LOOKUP_SCOPE_REQUIRED',409);
  await client.query('SELECT id FROM pf_artifacts WHERE project_id=$1 AND id=$2 FOR SHARE',[projectId,artifact.id]);
  const current=await projectRoutingSettings(client,projectId,input.options);
  return {schemaVersion:'pathfinder.lookup.dependencies.v1',projectId,...model,
    artifactId:artifact.id,snapshotSha256:artifact.snapshot_sha256,routeText:input.routeText,reverse:input.reverse,settingsRevision:current.settings.revision,connectionGap:current.settings.connectionGap,options:current.options,engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1'};
}
const nonnegativeCount=(value:unknown):number|null=>typeof value==='number' && Number.isSafeInteger(value) && value>=0 ? value : null;
export function lookupDiagnostics(result:Row) {
  return {geometryLeavesUsed:Array.isArray(result.route?.segmentIds) ? new Set(result.route.segmentIds).size : null,
    fallbackBends:nonnegativeCount(result.prepared?.counts?.fallbackBends),fallbackStraights:nonnegativeCount(result.prepared?.counts?.fallbackStraights),fallbackClearances:nonnegativeCount(result.prepared?.counts?.fallbackClearances)};
}
export function createPathFinderLookups(pool:Pool) {
  let planning=0;
  return {
    async plan(projectId:string,who:JobPrincipal,input:z.infer<typeof lookupPlanSchema>,signal:AbortSignal=AbortSignal.timeout(7500)) {
      if (planning>=2) throw new PathFinderError('LOOKUP_PLAN_BUSY',429,'Another lookup route is being parsed. Try again shortly.');
      planning++;
      try {
        const before=await principalTransaction(pool,projectId,who,client=>lookupModel(client,projectId,input.expectedSelectionRevision));
        const result=await runEngine({schemaVersion:'pathfinder.model.runner.v1',requestId:randomUUID(),operation:'lookup-plan',projectId,modelVersionId:before.modelVersionId,timeoutMilliseconds:5000,routeText:input.routeText},signal);
        if (result.status!=='lookup_planned') throw new PathFinderError('INVALID_LOOKUP_ROUTE',result.status==='deadline_exceeded' ? 408 : result.status==='resource_limit' ? 413 : 400,result.message);
        if (!result.routeCodes?.length || new Set(result.routeCodes).size!==result.routeCodes.length) throw new PathFinderError('ENGINE_RESPONSE_INVALID',502);
        return await principalTransaction(pool,projectId,who,async client=>{
          const after=await lookupModel(client,projectId,input.expectedSelectionRevision);
          if (hash(before)!==hash(after)) throw new PathFinderError('MODEL_SELECTION_CONFLICT',409);
          const current=await projectRoutingSettings(client,projectId,{...defaultOptions});
          return {routeCodes:result.routeCodes!,connectionGap:current.settings.connectionGap,selectionRevision:after.selectionRevision};
        });
      } finally {planning--;}
    },
    async create(projectId:string,who:JobPrincipal,input:z.infer<typeof lookupSchema>) {
      let owned:{id:string;sha256:string}|undefined;
      try {return await principalTransaction(pool,projectId,who,async client => {
        let artifactId:string;
        if ('snapshot' in input) {
          const model=await lookupModel(client,projectId,input.expectedSelectionRevision),snapshot=input.snapshot;
          if (snapshot.model.projectId!==projectId || snapshot.model.modelVersionId!==model.modelVersionId || snapshot.model.contentSha256!==model.contentFingerprint)
            throw new PathFinderError('MODEL_FINGERPRINT_CONFLICT',409,'The lookup capture belongs to another project, model or conversion.');
          if (!snapshot.capture.lookupRouteCodes?.length || snapshot.capture.adapterVersion!=='wfc.protected-lookup-capture.v1'
            || snapshot.objects.some(object=>object.geometryRole==='routing-leaf' && object.categoryAssignmentSource!=='lookup-all-categories')) throw new PathFinderError('LOOKUP_SCOPE_REQUIRED',409,'Use a dedicated capture of the entered lookup route.');
          validateSnapshotStructure(snapshot);
          // The principal transaction holds the project mutex. Reuse only identical lookup bytes in this current conversion.
          const digest=snapshotDigest(snapshot),reused=(await client.query<Row>(`SELECT id,snapshot_sha256 FROM pf_artifacts WHERE project_id=$1 AND model_version_id=$2
            AND content_fingerprint=$3 AND purpose='lookup' AND snapshot_sha256=$4 ORDER BY created_at,id LIMIT 1 FOR SHARE`,[projectId,model.modelVersionId,model.contentFingerprint,digest])).rows[0];
          if (reused) {artifactId=reused.id;await readSnapshot(artifactId,reused.snapshot_sha256);}
          else {
            artifactId=randomUUID();const stored=await storeSnapshot(artifactId,snapshot);owned={id:artifactId,sha256:stored.sha256};
            await client.query(`INSERT INTO pf_artifacts(id,project_id,model_version_id,content_fingerprint,snapshot_sha256,snapshot_bytes,capture,coordinates,object_count,created_by,purpose)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'lookup')`,[artifactId,projectId,model.modelVersionId,model.contentFingerprint,stored.sha256,stored.bytes,snapshot.capture,snapshot.coordinates,snapshot.objects.length,who.userId]);
          }
        } else artifactId=input.artifactId;
        const dependencies=await collectLookupDependencies(client,projectId,{routeText:input.routeText,reverse:input.reverse,expectedSelectionRevision:input.expectedSelectionRevision,artifactId,
          options:'options' in input && input.options ? input.options : {...defaultOptions}});
        const requestHash=hash({kind:'lookup',dependencies});
        const existing=(await client.query<Row>(`SELECT id FROM pf_jobs WHERE project_id=$1 AND requested_by=$2 AND login_id=$3 AND request_hash=$4
          AND kind='lookup' AND state IN ('queued','running') ORDER BY created_at DESC LIMIT 1`,[projectId,who.userId,who.loginId,requestHash])).rows[0];
        if (existing) return {jobId:existing.id,duplicate:true};
        const jobId=randomUUID();
        await client.query(`INSERT INTO pf_jobs(id,project_id,requested_by,login_id,login_expires_at,state,total,options,timeout_ms,request_hash,kind,diagnostic_input)
          VALUES($1,$2,$3,$4,$5,'queued',1,$6,60000,$7,'lookup',$8)`,[jobId,projectId,who.userId,who.loginId,new Date(who.loginExpiresAt),dependencies.options,requestHash,dependencies]);
        return {jobId,duplicate:false};
      });} catch(error) {
        if (owned) try {
          // A lost COMMIT acknowledgement must never remove a snapshot that was actually published.
          const published=await pool.query('SELECT id FROM pf_artifacts WHERE project_id=$1 AND id=$2',[projectId,owned.id]);
          if (!published.rows.length) await discardSnapshot(owned.id,owned.sha256);
        } catch {console.error('Owned unpublished lookup snapshot cleanup deferred.');}
        throw error;
      }
    },
    async get(projectId:string,who:JobPrincipal,jobId:string) {
      return principalTransaction(pool,projectId,who,async client => {
        const job=(await client.query<Row>("SELECT * FROM pf_jobs WHERE project_id=$1 AND id=$2 AND kind='lookup'",[projectId,jobId])).rows[0];
        if (!job) throw new PathFinderError('LOOKUP_NOT_FOUND',404);
        const stored=(await client.query<Row>('SELECT * FROM pf_lookup_results WHERE project_id=$1 AND job_id=$2',[projectId,jobId])).rows[0];
        const input=job.diagnostic_input as LookupDependencies;let stale=Boolean(stored?.stale_at_completion);
        if (stored) {try {stale ||= hash(await collectLookupDependencies(client,projectId,input))!==hash(stored.dependencies);await readSnapshot(input.artifactId,input.snapshotSha256);} catch {stale=true;}}
        const result=stored?.result,route=result?.route;
        return {...jobDto(job),kind:'lookup',input:{routeText:input.routeText,reverse:input.reverse},result:result ? {
          status:result.status,message:result.message,prepared:result.prepared ?? null,engineeringAccepted:false,acceptanceScope:'diagnostic-lookup',stale,design:null,
          connectionGap:input.connectionGap,diagnostics:lookupDiagnostics(result),lookupScope:result.lookupScope ?? null,
          route:route ? {...route,pathPoints:undefined,points:route.pathPoints.map((point:Row)=>[point.x,point.y,point.z]),objectIds:[...new Set(route.segmentIds as string[])]} : null,
        } : null};
      });
    },
  };
}
