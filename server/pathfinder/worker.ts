import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { runEngine } from './engine.js';
import { collectDependencies, geometryHash, hash } from './dependencies.js';
import { transaction } from './transactions.js';
import { readSnapshot } from './storage.js';
import type { DependencySnapshot, EngineResponse, JobPrincipal } from './jobContracts.js';
import type { PathFinderJobs } from './jobs.js';
import { PathFinderError } from './errors.js';
import { principalTransaction } from './auth.js';
import { collectLookupDependencies, type LookupDependencies } from './lookups.js';
import { engineProjectSettings } from './settings.js';
import { collectPreviewDependencies, previewEngineRequest, type PreviewDependencies } from './previews.js';
export const nextAutomaticCursor = (rows:Array<{project_id:string}>):string|null => rows.length===5 ? rows.at(-1)!.project_id : null;

type Row = Record<string,any>;
/** Reused geometry keeps its original diagnostics; category comes from the immutable calculation inputs. */
export function mergeRetainedGeometryResponse(response:EngineResponse,retained:EngineResponse,frozenCategory:string|null):EngineResponse {
  const effectiveCategory=frozenCategory==='Instrumentation' ? 'Control' : frozenCategory;
  if (!effectiveCategory || !['MV','LV','Control'].includes(effectiveCategory) || !retained.route?.success
    || retained.effectiveCategory!=null && retained.effectiveCategory!==effectiveCategory)
    throw new PathFinderError('ENGINE_RETAINED_GEOMETRY_INVALID',502,'The retained geometry metadata does not match the original calculation inputs.');
  return {...response,route:retained.route,effectiveCategory,prepared:retained.prepared ?? response.prepared};
}
function principal(job:Row):JobPrincipal {return {userId:job.requested_by,loginId:job.login_id,loginExpiresAt:new Date(job.login_expires_at).getTime()};}
async function claim(pool:Pool):Promise<Row|null> {
  return transaction(pool,async client => {
    const row = (await client.query<Row>(`SELECT * FROM pf_jobs WHERE state='queued' OR state='running' AND lease_until<NOW()
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if (!row) return null;
    if (row.cancel_requested || row.attempts >= 3) {
      await client.query('UPDATE pf_jobs SET state=$2,failure=$3,updated_at=NOW() WHERE id=$1',[row.id,row.cancel_requested ? 'cancelled' : 'failed',row.cancel_requested ? 'Cancelled.' : 'Interrupted job exceeded its recovery attempts.']);
      return null;
    }
    const claimed = (await client.query<Row>(`UPDATE pf_jobs SET state='running',owner_token=$2,lease_until=NOW()+INTERVAL '30 seconds',attempts=attempts+1,updated_at=NOW()
      WHERE id=$1 RETURNING *`,[row.id,randomUUID()])).rows[0];
    await client.query("UPDATE pf_job_items SET state='waiting' WHERE project_id=$1 AND job_id=$2 AND state='running'",[row.project_id,row.id]);
    return claimed;
  });
}
async function fencedJob(client:PoolClient,job:Row):Promise<void> {
  const current = (await client.query<Row>('SELECT * FROM pf_jobs WHERE project_id=$1 AND id=$2 FOR UPDATE',[job.project_id,job.id])).rows[0];
  if (!current || current.owner_token !== job.owner_token || current.state !== 'running' || current.cancel_requested || new Date(current.lease_until).getTime() <= Date.now()) throw new PathFinderError('JOB_FENCED',409);
}
async function executeJob(pool:Pool,job:Row,stopping:AbortSignal):Promise<void> {
  const controller = new AbortController(),signal = AbortSignal.any([stopping,controller.signal]);
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return; heartbeatBusy = true;
    void pool.query(`UPDATE pf_jobs j SET lease_until=NOW()+INTERVAL '30 seconds',updated_at=NOW()
      WHERE j.id=$1 AND j.owner_token=$2 AND j.state='running' AND j.cancel_requested=false AND j.login_expires_at>NOW()
        AND EXISTS(SELECT 1 FROM users u WHERE u.id=j.requested_by AND u.is_admin=true)
        AND NOT EXISTS(SELECT 1 FROM viewer_login_bindings l WHERE l.login_id=j.login_id AND l.revoked_at IS NOT NULL)
      RETURNING j.id`,[job.id,job.owner_token]).then(result => {if (!result.rows.length) controller.abort();}).catch(() => controller.abort()).finally(() => {heartbeatBusy = false;});
  },1000); heartbeat.unref();
  try {
    if (job.kind==='lookup') {
      const dependencies=job.diagnostic_input as LookupDependencies;
      await principalTransaction(pool,job.project_id,principal(job),async client => {
        await fencedJob(client,job);
        if (hash(await collectLookupDependencies(client,job.project_id,dependencies))!==hash(dependencies)) throw new PathFinderError('LOOKUP_STALE',409,'The active model or artifact changed before lookup.');
      });
      await readSnapshot(dependencies.artifactId,dependencies.snapshotSha256);
      const response=await runEngine({schemaVersion:'pathfinder.model.runner.v1',requestId:randomUUID(),operation:'lookup',projectId:job.project_id,
        modelVersionId:dependencies.modelVersionId,snapshotId:dependencies.artifactId,snapshotSha256:dependencies.snapshotSha256,timeoutMilliseconds:job.timeout_ms,
        routeText:dependencies.routeText,reverse:dependencies.reverse,options:dependencies.options},signal);
      signal.throwIfAborted();
      await readSnapshot(dependencies.artifactId,dependencies.snapshotSha256);
      await principalTransaction(pool,job.project_id,principal(job),async client => {
        await fencedJob(client,job);let stale=false;
        try {stale=hash(await collectLookupDependencies(client,job.project_id,dependencies))!==hash(dependencies);} catch {stale=true;}
        await client.query(`INSERT INTO pf_lookup_results(project_id,job_id,dependencies,result,stale_at_completion) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(project_id,job_id) DO NOTHING`,[job.project_id,job.id,dependencies,response,stale]);
        await client.query('UPDATE pf_jobs SET completed=1,updated_at=NOW() WHERE id=$1 AND owner_token=$2',[job.id,job.owner_token]);
      });
    } else if (job.kind==='preview') {
      const dependencies=job.diagnostic_input as PreviewDependencies;
      await principalTransaction(pool,job.project_id,principal(job),async client=>{
        await fencedJob(client,job);
        if (hash(await collectPreviewDependencies(client,job.project_id,dependencies.input))!==hash(dependencies))
          throw new PathFinderError('PREVIEW_STALE',409,'The model, locations or Project Details changed before this preview.');
      });
      await readSnapshot(dependencies.artifactId,dependencies.snapshotSha256);
      const response=await runEngine(previewEngineRequest(dependencies,randomUUID(),job.timeout_ms),signal);
      signal.throwIfAborted();
      await principalTransaction(pool,job.project_id,principal(job),async client=>{
        await fencedJob(client,job);let stale=false;
        try {stale=hash(await collectPreviewDependencies(client,job.project_id,dependencies.input))!==hash(dependencies);} catch {stale=true;}
        await client.query(`INSERT INTO pf_lookup_results(project_id,job_id,dependencies,result,stale_at_completion) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(project_id,job_id) DO NOTHING`,[job.project_id,job.id,dependencies,response,stale]);
        await client.query('UPDATE pf_jobs SET completed=1,updated_at=NOW() WHERE id=$1 AND owner_token=$2',[job.id,job.owner_token]);
      });
    } else for (;;) {
      signal.throwIfAborted();
      const item = await principalTransaction(pool,job.project_id,principal(job),async client => {
        await fencedJob(client,job);
        const value = (await client.query<Row>("SELECT * FROM pf_job_items WHERE project_id=$1 AND job_id=$2 AND state='waiting' ORDER BY cable_id FOR UPDATE LIMIT 1",[job.project_id,job.id])).rows[0];
        if (value) await client.query("UPDATE pf_job_items SET state='running',status='calculating',message='Calculating with the independent PathFinder core.' WHERE project_id=$1 AND job_id=$2 AND cable_id=$3",[job.project_id,job.id,value.cable_id]);
        return value;
      });
      if (!item) break;
      const dependencies = item.dependencies as DependencySnapshot;
      let response:EngineResponse,calculationMode = 'calculate',retained:Row|undefined,retainedResult:EngineResponse|undefined;
      const requestId = randomUUID();
      try {
        await readSnapshot(dependencies.artifact.id,dependencies.artifact.sha256);
        const previous = await pool.query<Row>(`SELECT result FROM pf_proposals WHERE project_id=$1 AND cable_id=$2 AND geometry_hash=$3
          AND result->'route'->>'success'='true' ORDER BY created_at DESC,id DESC LIMIT 1`,[job.project_id,item.cable_id,geometryHash(dependencies)]);
        retainedResult = previous.rows[0]?.result as EngineResponse|undefined;
        retained = retainedResult?.route;
        calculationMode = retained ? 'design' : 'calculate';
        response = await runEngine({schemaVersion:'pathfinder.model.runner.v1',requestId,operation:calculationMode,projectId:job.project_id,
          modelVersionId:dependencies.model.id,snapshotId:dependencies.artifact.id,snapshotSha256:dependencies.artifact.sha256,timeoutMilliseconds:job.timeout_ms,
          ...(retained ? {route:{success:true,lengthMeters:retained.lengthMeters,fromDistanceMeters:retained.fromDistanceMeters,toDistanceMeters:retained.toDistanceMeters,
            fromRequiresSecondary:retained.fromRequiresSecondary,toRequiresSecondary:retained.toRequiresSecondary}} : {
            category:dependencies.cableInputs.mto,from:{x:dependencies.from.point[0],y:dependencies.from.point[1],z:dependencies.from.point[2]},
            to:{x:dependencies.to.point[0],y:dependencies.to.point[1],z:dependencies.to.point[2]},options:dependencies.options}),projectSettings:engineProjectSettings(dependencies.settings)},signal);
        if (retainedResult && retained) response = mergeRetainedGeometryResponse(response,retainedResult,dependencies.cableInputs.mto);
      } catch(error) {
        signal.throwIfAborted();
        const safe = error instanceof PathFinderError ? error.message : 'The private calculation engine failed.';
        response = {schemaVersion:'pathfinder.model.response.v1',requestId,status:error instanceof PathFinderError && error.code === 'ENGINE_DEADLINE' ? 'deadline_exceeded' : 'invalid_request',message:safe,engineeringAccepted:false};
      }
      signal.throwIfAborted();
      await principalTransaction(pool,job.project_id,principal(job),async client => {
        await fencedJob(client,job);
        const current = await collectDependencies(client,job.project_id,item.cable_id,dependencies.options,true);
        const stale = !current.dependencies || hash(current.dependencies) !== hash(dependencies);
        const status = stale ? 'stale' : response.status, result = {...response,calculationMode};
        const proposalHash = hash({dependencies,result});
        await client.query(`INSERT INTO pf_proposals(id,project_id,job_id,cable_id,status,dependencies,dependency_hash,geometry_hash,result,proposal_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(project_id,job_id,cable_id) DO NOTHING`,[randomUUID(),job.project_id,job.id,item.cable_id,status,dependencies,hash(dependencies),geometryHash(dependencies),result,proposalHash]);
        const completed = await client.query(`UPDATE pf_job_items SET state='complete',status=$4,message=$5 WHERE project_id=$1 AND job_id=$2 AND cable_id=$3 AND state='running' RETURNING cable_id`,
        [job.project_id,job.id,item.cable_id,status,stale ? 'Dependencies changed during calculation. Calculate a fresh proposal.' : response.message]);
        if (completed.rows.length) await client.query('UPDATE pf_jobs SET completed=completed+1,updated_at=NOW() WHERE id=$1 AND owner_token=$2',[job.id,job.owner_token]);
      });
    }
    await principalTransaction(pool,job.project_id,principal(job),async client => {
      await fencedJob(client,job);
      await client.query("UPDATE pf_jobs SET state='complete',completed=total,owner_token=NULL,lease_until=NULL,updated_at=NOW() WHERE id=$1 AND owner_token=$2",[job.id,job.owner_token]);
    });
  } catch(error) {
    await pool.query(`UPDATE pf_jobs SET state=CASE WHEN cancel_requested THEN 'cancelled' WHEN $3 THEN 'queued' ELSE 'failed' END,
      owner_token=NULL,lease_until=NULL,failure=CASE WHEN cancel_requested THEN 'Cancelled after the owned engine process stopped.' WHEN $3 THEN NULL ELSE $4 END,updated_at=NOW()
      WHERE id=$1 AND owner_token=$2 AND state='running'`,[job.id,job.owner_token,stopping.aborted,error instanceof PathFinderError ? error.message : 'Calculation stopped or worker authority was revoked.']).catch(() => undefined);
  } finally {clearInterval(heartbeat);}
}

/** One DB advisory-lock owner serializes .NET/cache access across backend processes. */
export function createPathFinderWorker(pool:Pool,jobs:PathFinderJobs) {
  const controller = new AbortController(); let work:Promise<void>|undefined;
  let lastAutomatic = 0;
  let automaticAfter:string|null = null;
  async function automatic():Promise<void> {
    if (Date.now()-lastAutomatic < 15000) return; lastAutomatic = Date.now();
    const projects = await pool.query<Row>(`SELECT * FROM (
      SELECT DISTINCT ON(project_id) * FROM pf_jobs WHERE kind='calculate' ORDER BY project_id,created_at DESC,id DESC
    ) latest WHERE state='complete' AND cancel_requested=false AND login_expires_at>NOW()
      AND ($1::uuid IS NULL OR project_id>$1::uuid) ORDER BY project_id LIMIT 5`,[automaticAfter]);
    automaticAfter=nextAutomaticCursor(projects.rows as Array<{project_id:string}>);
    for (const previous of projects.rows) {
      if (controller.signal.aborted) return;
      try {
        const registry = (await pool.query<Row>('SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1',[previous.project_id])).rows[0];
        if (registry) await jobs.create(previous.project_id,principal(previous),{expectedRegistryRevision:registry.registry_revision,options:previous.options,timeoutMilliseconds:previous.timeout_ms});
      } catch {/* Missing/revoked/stale dependencies remain visible; retries are bounded by this cadence. */}
    }
  }
  return {
    start():void {
      if (work) return;
      work = (async () => {
        while (!controller.signal.aborted) {
          let owner:PoolClient|undefined;
          try {
            owner = await pool.connect();
            const locked = await owner.query<{locked:boolean}>("SELECT pg_try_advisory_lock(hashtext('wfc-pathfinder-engine-worker-v1')) AS locked");
            if (!locked.rows[0]?.locked) {owner.release(); owner = undefined; await delay(5000,undefined,{signal:controller.signal}); continue;}
            const lost = ():void => controller.abort(); owner.once('error',lost);
            try {
              while (!controller.signal.aborted) {
                const job = await claim(pool);
                if (job) await executeJob(pool,job,controller.signal);
                else {await automatic(); await delay(1000,undefined,{signal:controller.signal});}
              }
            } finally {owner.off('error',lost); await owner.query("SELECT pg_advisory_unlock(hashtext('wfc-pathfinder-engine-worker-v1'))").catch(() => undefined);}
          } catch(error) {if (!controller.signal.aborted) {console.error('PathFinder worker temporarily unavailable.'); await delay(5000,undefined,{signal:controller.signal}).catch(() => undefined);}}
          finally {owner?.release();}
        }
      })();
    },
    async stop():Promise<void> {controller.abort(); await work;},
  };
}
