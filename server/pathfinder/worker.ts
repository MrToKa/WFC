import { randomUUID } from 'node:crypto';
import type { Client, Pool, PoolClient } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { createConfiguredEngineExecutor, type EngineExecutor } from './engineSession.js';
import { collectDependencies, geometryHash, hash, verifiedDesignOnlyChange } from './dependencies.js';
import { readSnapshot } from './storage.js';
import type { DependencySnapshot, EngineResponse, JobPrincipal } from './jobContracts.js';
import type { PathFinderJobs } from './jobs.js';
import { PathFinderError } from './errors.js';
import { principalTransaction } from './auth.js';
import { collectLookupDependencies, type LookupDependencies } from './lookups.js';
import { engineProjectSettings } from './settings.js';
import { collectPreviewDependencies, previewEngineRequest, type PreviewDependencies } from './previews.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { readRecalculationJobAuthority, requireEnrollmentAuthority } from './recalculationRepository.js';
import { calculationEngineIdentity } from './calculationEngineIdentity.js';
import { claimCalculationSlice, finishCalculationSlice } from './workerScheduling.js';
import { createPreparationEngineLane } from './preparationEngineLane.js';
import type { EngineInvocation } from './engineSession.js';
import type { EngineIdentity } from '../../shared/pathfinderEngineIdentity.js';
export const nextAutomaticCursor = (rows:Array<{project_id:string}>):string|null => rows.length===5 ? rows.at(-1)!.project_id : null;

type Row = Record<string,any>;
/** A failed join is an ownership failure, never a normal per-cable engine result. */
function unconfirmedEngineJoin(error:unknown):boolean {
  return error!==null&&typeof error==='object'&&(error as {code?:unknown}).code==='ENGINE_SESSION_REAP_FAILED';
}
function implementationRestartRequired(error:unknown):boolean {
  return error!==null&&typeof error==='object'&&(error as {code?:unknown}).code==='ENGINE_IMPLEMENTATION_RESTART_REQUIRED';
}
/** Reused geometry keeps its original diagnostics; category comes from the immutable calculation inputs. */
export function mergeRetainedGeometryResponse(response:EngineResponse,retained:EngineResponse,frozenCategory:string|null):EngineResponse {
  const effectiveCategory=frozenCategory==='Instrumentation' ? 'Control' : frozenCategory;
  if (!effectiveCategory || !['MV','LV','Control'].includes(effectiveCategory) || !retained.route?.success
    || retained.effectiveCategory!=null && retained.effectiveCategory!==effectiveCategory)
    throw new PathFinderError('ENGINE_RETAINED_GEOMETRY_INVALID',502,'The retained geometry metadata does not match the original calculation inputs.');
  return {...response,route:retained.route,effectiveCategory,prepared:retained.prepared ?? response.prepared};
}
function principal(job:Row):JobPrincipal {return {userId:job.requested_by,loginId:job.login_id,loginExpiresAt:new Date(job.login_expires_at).getTime()};}
/** Compare the latest result; a geometry-key search must not skip intervening input changes. */
export async function readRetainedDesignGeometry(client:Pick<PoolClient,'query'>,projectId:string,cableId:string,dependencies:DependencySnapshot):Promise<EngineResponse|undefined>{
  const previous=(await client.query<Row>(`SELECT result,dependencies,status FROM pf_proposals WHERE project_id=$1 AND cable_id=$2
    ORDER BY created_at DESC,id DESC LIMIT 1`,[projectId,cableId])).rows[0];
  return previous?.status==='calculated'&&previous.result?.route?.success===true&&verifiedDesignOnlyChange(dependencies,previous.dependencies)
    ? previous.result as EngineResponse : undefined;
}
async function fencedJob(client:PoolClient,job:Row):Promise<void> {
  const current = (await client.query<Row>('SELECT * FROM pf_jobs WHERE project_id=$1 AND id=$2 FOR UPDATE',[job.project_id,job.id])).rows[0];
  if (!current || current.owner_token !== job.owner_token || current.state !== 'running' || current.cancel_requested || new Date(current.lease_until).getTime() <= Date.now()) throw new PathFinderError('JOB_FENCED',409);
}
async function executeJob(pool:Pool,job:Row,stopping:AbortSignal,engine:EngineExecutor):Promise<void> {
  const controller = new AbortController(),signal = AbortSignal.any([stopping,controller.signal]);
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return; heartbeatBusy = true;
    void pool.query(`UPDATE pf_jobs j SET lease_until=NOW()+INTERVAL '30 seconds',updated_at=NOW()
      WHERE j.id=$1 AND j.owner_token=$2 AND j.state='running' AND j.cancel_requested=false AND j.login_expires_at>NOW()
        AND EXISTS(SELECT 1 FROM users u WHERE u.id=j.requested_by AND u.is_admin=true)
        AND NOT EXISTS(SELECT 1 FROM viewer_login_bindings l WHERE l.login_id=j.login_id AND l.revoked_at IS NOT NULL)
      RETURNING j.id`,[job.id,job.owner_token]).then(async result => {
        if (!result.rows.length) {controller.abort();return;}
        const authority=await readRecalculationJobAuthority(pool,{projectId:job.project_id,jobId:job.id});
        if(authority.enrolled&&!authority.valid)controller.abort();
      }).catch(() => controller.abort()).finally(() => {heartbeatBusy = false;});
  },1000); heartbeat.unref();
  try {
    if (job.kind==='lookup') {
      const dependencies=job.diagnostic_input as LookupDependencies;
      await principalTransaction(pool,job.project_id,principal(job),async client => {
        await fencedJob(client,job);
        if (hash(await collectLookupDependencies(client,job.project_id,dependencies))!==hash(dependencies)) throw new PathFinderError('LOOKUP_STALE',409,'The active model or artifact changed before lookup.');
      });
      await readSnapshot(dependencies.artifactId,dependencies.snapshotSha256);
      const response=await engine.execute({schemaVersion:'pathfinder.model.runner.v1',requestId:randomUUID(),operation:'lookup',projectId:job.project_id,
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
      const response=await engine.execute(previewEngineRequest(dependencies,randomUUID(),job.timeout_ms),signal);
      signal.throwIfAborted();
      await principalTransaction(pool,job.project_id,principal(job),async client=>{
        await fencedJob(client,job);let stale=false;
        try {stale=hash(await collectPreviewDependencies(client,job.project_id,dependencies.input))!==hash(dependencies);} catch {stale=true;}
        await client.query(`INSERT INTO pf_lookup_results(project_id,job_id,dependencies,result,stale_at_completion) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(project_id,job_id) DO NOTHING`,[job.project_id,job.id,dependencies,response,stale]);
        await client.query('UPDATE pf_jobs SET completed=1,updated_at=NOW() WHERE id=$1 AND owner_token=$2',[job.id,job.owner_token]);
      });
    } else for (let quantum=0;quantum<1;quantum++) {
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
        requireVersionedCalculationScope(dependencies);
        const identity=await calculationEngineIdentity({force:true});
        await principalTransaction(pool,job.project_id,principal(job),async client => {
          await fencedJob(client,job);
          const current=await collectDependencies(client,job.project_id,item.cable_id,dependencies.options,true,identity);
          if (!current.dependencies || hash(current.dependencies)!==hash(dependencies))
            throw new PathFinderError('PROPOSAL_STALE',409,'The tray catalog, routing permissions or another calculation input changed. Calculate a fresh proposal.');
          await requireEnrollmentAuthority(client,{projectId:job.project_id,jobId:job.id});
        });
        await readSnapshot(dependencies.artifact.id,dependencies.artifact.sha256);
        retainedResult = await readRetainedDesignGeometry(pool,job.project_id,item.cable_id,dependencies);
        retained = retainedResult?.route;
        calculationMode = retained ? 'design' : 'calculate';
        response = await engine.execute({schemaVersion:'pathfinder.model.runner.v1',requestId,operation:calculationMode,projectId:job.project_id,
          modelVersionId:dependencies.model.id,snapshotId:dependencies.artifact.id,snapshotSha256:dependencies.artifact.sha256,timeoutMilliseconds:job.timeout_ms,
          ...(retained ? {route:{success:true,lengthMeters:retained.lengthMeters,fromDistanceMeters:retained.fromDistanceMeters,toDistanceMeters:retained.toDistanceMeters,
            fromRequiresSecondary:retained.fromRequiresSecondary,toRequiresSecondary:retained.toRequiresSecondary}} : {
            category:dependencies.cableInputs.mto,from:{x:dependencies.from.point[0],y:dependencies.from.point[1],z:dependencies.from.point[2]},
            to:{x:dependencies.to.point[0],y:dependencies.to.point[1],z:dependencies.to.point[2]},options:dependencies.options}),projectSettings:engineProjectSettings(dependencies.settings)},signal);
        if (retainedResult && retained) response = mergeRetainedGeometryResponse(response,retainedResult,dependencies.cableInputs.mto);
      } catch(error) {
        // Preserve this failure even when cancellation already aborted the signal.
        // A cancelled signal cannot certify that the owned process group joined.
        if(unconfirmedEngineJoin(error)||implementationRestartRequired(error))throw error;
        signal.throwIfAborted();
        const safe = error instanceof PathFinderError ? error.message : 'The private calculation engine failed.';
        response = {schemaVersion:'pathfinder.model.response.v1',requestId,status:error instanceof PathFinderError && error.code === 'ENGINE_DEADLINE' ? 'deadline_exceeded' : 'invalid_request',message:safe,engineeringAccepted:false};
      }
      signal.throwIfAborted();
      const finalIdentity=await calculationEngineIdentity({force:true});
      await principalTransaction(pool,job.project_id,principal(job),async client => {
        await fencedJob(client,job);
        const current = await collectDependencies(client,job.project_id,item.cable_id,dependencies.options,true,finalIdentity);
        const stale = !current.dependencies || hash(current.dependencies) !== hash(dependencies);
        await requireEnrollmentAuthority(client,{projectId:job.project_id,jobId:job.id});
        const status = stale ? 'stale' : response.status, result = {...response,calculationMode};
        const proposalHash = hash({dependencies,result});
        await client.query(`INSERT INTO pf_proposals(id,project_id,job_id,cable_id,status,dependencies,dependency_hash,geometry_hash,result,proposal_hash)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(project_id,job_id,cable_id) DO NOTHING`,[randomUUID(),job.project_id,job.id,item.cable_id,status,dependencies,hash(dependencies),geometryHash(dependencies),result,proposalHash]);
        const completed = await client.query(`UPDATE pf_job_items SET state='complete',status=$4,message=$5 WHERE project_id=$1 AND job_id=$2 AND cable_id=$3 AND state='running' RETURNING cable_id`,
        [job.project_id,job.id,item.cable_id,status,stale ? 'Dependencies changed during calculation. Calculate a fresh proposal.' : response.message]);
        if (completed.rows.length) await client.query('UPDATE pf_jobs SET completed=completed+1,updated_at=NOW() WHERE id=$1 AND owner_token=$2',[job.id,job.owner_token]);
        await requireEnrollmentAuthority(client,{projectId:job.project_id,jobId:job.id});
      });
    }
    await principalTransaction(pool,job.project_id,principal(job),async client => {
      await fencedJob(client,job);
      await requireEnrollmentAuthority(client,{projectId:job.project_id,jobId:job.id});
      await finishCalculationSlice(client,job);
      await requireEnrollmentAuthority(client,{projectId:job.project_id,jobId:job.id});
    });
  } catch(error) {
    // The executor wrapper has stopped the whole worker. Keep the owned job/lease
    // untouched until a later safe recovery; terminal state would claim a join.
    if(unconfirmedEngineJoin(error)||implementationRestartRequired(error))throw error;
    await pool.query(`UPDATE pf_jobs SET state=CASE WHEN cancel_requested THEN 'cancelled' WHEN $3 THEN 'queued' ELSE 'failed' END,
      owner_token=NULL,lease_until=NULL,failure=CASE WHEN cancel_requested THEN 'Cancelled after the owned engine process stopped.' WHEN $3 THEN NULL ELSE $4 END,updated_at=NOW()
      WHERE id=$1 AND owner_token=$2 AND state='running'`,[job.id,job.owner_token,stopping.aborted,error instanceof PathFinderError ? error.message : 'Calculation stopped or worker authority was revoked.']).catch(() => undefined);
  } finally {clearInterval(heartbeat);}
}

/** One DB advisory-lock owner serializes .NET/cache access across backend processes. */
export function createPathFinderWorker(pool:Pool,_jobs:PathFinderJobs,engineFactory:()=>EngineExecutor=createConfiguredEngineExecutor,
  identityReader:typeof calculationEngineIdentity=calculationEngineIdentity) {
  const controller = new AbortController(); let work:Promise<void>|undefined,fatalStop:unknown,unavailableCode:string|undefined;
  const preparation = createPreparationEngineLane();
  return {
    start():void {
      if (work) return;
      preparation.activate();
      work = (async () => {
        while (!controller.signal.aborted) {
          let owner:PoolClient|undefined,releaseOwner=true,discardOwner=false;
          const lost = ():void => {discardOwner=true;unavailableCode??='WORKER_OWNER_CONNECTION_LOST';controller.abort();};
          async function release():Promise<void> {
            if (!owner || !releaseOwner) return;
            if (discardOwner) {
              // pg-pool installs its idle error listener during release. Finish
              // the damaged transport first, while repeated errors are still
              // handled by this owner, then discard instead of pooling it.
              // Keep the handler on this terminal, never-reused client.
              // pg-pool returns the concrete pg Client; its PoolClient typing
              // omits end(). Refuse unknown implementations rather than losing
              // the transport-error handler during an unsafe pool handoff.
              const terminal=owner as PoolClient & Partial<Pick<Client,'end'>>;
              try {
                if(typeof terminal.end!=='function')throw new Error('Missing terminal client close.');
                await terminal.end();
              } catch {
                controller.abort();releaseOwner=false;
                fatalStop=new PathFinderError('WORKER_OWNER_CLOSE_FAILED',500,'The PathFinder worker database owner could not be closed safely.');
                return;
              }
              owner.release(true);
            } else {
              owner.release();
              owner.off('error',lost);
            }
            owner=undefined;
          }
          try {
            owner = await pool.connect();
            // A checked-out pg client has no pool idle error handler. Subscribe
            // before the lock query, and keep handling transport errors until
            // the lane has joined and the client is safely returned/discarded.
            owner.on('error',lost);
            let locked;
            try {locked = await owner.query<{locked:boolean}>("SELECT pg_try_advisory_lock(hashtext('wfc-pathfinder-engine-worker-v1')) AS locked");}
            catch(error) {discardOwner=true;throw error;}
            if (!locked.rows[0]?.locked) {await release(); await delay(5000,undefined,{signal:controller.signal}); continue;}
            let engine:EngineExecutor|undefined;
            try {
              if (!controller.signal.aborted) {
                const loadedIdentity:EngineIdentity=await identityReader({force:true});
                if(!controller.signal.aborted){
                  const owned=engineFactory();
                  engine={close:()=>owned.close(),execute:async(request,signal)=>{
                    const current=await identityReader({force:true});
                    if(current.contentSha256!==loadedIdentity.contentSha256){
                      unavailableCode='ENGINE_IMPLEMENTATION_RESTART_REQUIRED';
                      const error=new PathFinderError(unavailableCode,503,'The loaded calculation implementation changed. Restart the owned backend before calculating.');
                      controller.abort(error);throw error;
                    }
                    try{return await owned.execute(request,signal);}
                    catch(error){
                      if(unconfirmedEngineJoin(error)){
                        fatalStop??=error;controller.abort(error);
                      }
                      throw error;
                    }
                  }};
                }
              }
              let preparationLast=false;
              while (!controller.signal.aborted) {
                if (!preparationLast && await preparation.runNext(engine!,controller.signal)) {preparationLast=true;continue;}
                preparationLast=false;
                const job = await claimCalculationSlice(pool);
                if (job) await executeJob(pool,job,controller.signal,engine!);
                else {await delay(1000,undefined,{signal:controller.signal});}
              }
            } finally {
              try {await engine?.close();}
              catch(error) {
                // An unreaped lane must not start another owner or return its locked
                // connection to the pool. Quarantine until the backend terminates.
                controller.abort();releaseOwner=false;fatalStop??=error;
              }
              if(releaseOwner&&!discardOwner)await owner.query("SELECT pg_advisory_unlock(hashtext('wfc-pathfinder-engine-worker-v1'))").catch(() => {discardOwner=true;});
            }
          } catch(error) {if (!controller.signal.aborted) {console.error('PathFinder worker temporarily unavailable.'); await delay(5000,undefined,{signal:controller.signal}).catch(() => undefined);}}
          finally {await release();}
        }
      })().finally(() => preparation.close());
    },
    executePreparation(request:EngineInvocation,signal:AbortSignal):Promise<EngineResponse> {
      if (!work || controller.signal.aborted) return Promise.reject(new PathFinderError('PREPARATION_WORKER_UNAVAILABLE',503));
      return preparation.enqueue(request,signal);
    },
    get failureCode():string|null {
      if(!fatalStop)return unavailableCode??null;
      const code=(fatalStop as {code?:unknown}).code;
      return typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(code)?code:'WORKER_FATAL';
    },
    async stop():Promise<void> {controller.abort();preparation.close(); await work;if(fatalStop)throw fatalStop;},
  };
}
