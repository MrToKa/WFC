// @vitest-environment node
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineExecutor } from './engineSession.js';
import type { PathFinderJobs } from './jobs.js';
import { PathFinderError } from './errors.js';
import { syntheticBarrierEngineIdentity, syntheticDrillingRuntime } from './calculationFixtures.js';
import { defaultOptions, engineResponseSchema, type EngineResponse } from './jobContracts.js';
import { barrierCanonicalJson } from '../../shared/pathfinderBarriers.js';
import { barrierRouteHashInput } from '../../shared/pathfinderBarrierRuntime.js';
import { DIRECT_SECONDARY_POLICY } from '../../shared/pathfinderDirectSecondary.js';

const seams=vi.hoisted(()=>({claim:vi.fn(),acquire:vi.fn(),transaction:vi.fn(),collect:vi.fn(),enrollment:vi.fn(),readEnrollment:vi.fn(),identity:vi.fn(),baseline:vi.fn(),seal:vi.fn(),verifySeal:vi.fn(),publish:vi.fn(),physicalFence:vi.fn()}));
vi.mock('./workerScheduling.js',async original=>({...await original<typeof import('./workerScheduling.js')>(),claimCalculationSlice:seams.claim}));
vi.mock('./dependencies.js',async original=>({...await original<typeof import('./dependencies.js')>(),collectDependenciesForVersion:seams.collect,verifiedDesignOnlyChange:()=>false}));
vi.mock('./operationAuthority.js',async original=>({...await original<typeof import('./operationAuthority.js')>(),operationTransaction:seams.transaction}));
vi.mock('./grantWorkerAuthority.js',async original=>({...await original<typeof import('./grantWorkerAuthority.js')>(),acquireGrantJobExecution:seams.acquire}));
vi.mock('./calculationEngineIdentity.js',()=>({calculationEngineIdentity:seams.identity,barrierCalculationEngineIdentity:seams.identity}));
vi.mock('./recalculationRepository.js',()=>({requireEnrollmentAuthority:seams.enrollment,readRecalculationJobAuthority:seams.readEnrollment}));
vi.mock('./routingScope.js',()=>({requireVersionedCalculationScope:()=>undefined}));
vi.mock('./storage.js',()=>({readSnapshot:async()=>undefined}));
vi.mock('./revisionResultRepository.js',()=>({readRevisionBaseline:seams.baseline,sealRevisionResult:seams.seal,verifyRevisionResultForProposal:seams.verifySeal}));
vi.mock('./autoLengthStore.js',()=>({publishAutoLength:seams.publish}));
vi.mock('./barrierWrites.js',()=>({requireCurrentBarrierWriteScope:seams.physicalFence}));
import { createPathFinderWorker } from './worker.js';

type Row=Record<string,any>;
const id=(n:number)=>`b6400000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const digest=(value:unknown)=>createHash('sha256').update(barrierCanonicalJson(value)).digest('hex');
const active:Array<ReturnType<typeof createPathFinderWorker>>=[];
/** Actual worker/slice/strategy/ledger control flow over synthetic seams only.
 * No SQL connection, process, geometry claim, HTTP or fixture file is created. */
function fixture(options:{before?:unknown;during?:unknown;authorityAtCompletion?:unknown;abortDuring?:boolean;siblings?:number;
  engineError?:unknown;cancelDuring?:boolean;publicationError?:unknown;physicalFenceError?:unknown;authorityAfterPublish?:unknown;
  lostCommitAck?:boolean;retained?:'exact'|'changed-dependencies'}={}){
  const barriers=syntheticDrillingRuntime({projectId:id(1),modelVersionId:id(5),contentFingerprint:'b'.repeat(64),selectionRevision:'1',captureFrameId:id(9),captureFrameSha256:'d'.repeat(64),coordinateFrame:'canonical-world-metres'});
  const points:[number,number,number][]=[[0,0,0],[1,0,0]],routeSha256=digest(barrierRouteHashInput(points));
  const base={schemaVersion:'pathfinder.dependencies.v8',projectId:id(1),cableWriteRevision:'1',
    options:{...defaultOptions,barrierRouting:{schemaVersion:'wfc.pf.barrier-admission-intent.v1',scope:barriers.binding.scope,expectedRegistryRevision:'1',expectedSnapshot:null,drillThroughWalls:true}},
    artifact:{id:id(4),sha256:'a'.repeat(64)},model:{id:id(5),selectionRevision:'1',contentFingerprint:'b'.repeat(64)},engineIdentity:syntheticBarrierEngineIdentity(),barriers,
    cableInputs:{mto:'Control',fromLocation:'A',toLocation:'B',cableTypeId:id(10)},from:{point:points[0]},to:{point:points[1]},
    settings:{revision:'1',connectionGap:'1',secondaryTrayLength:'7',endConnectionLength:'5',additionalBendingPercent:'10'}};
  const route={success:true,message:'Synthetic tray route.',routeText:'/A',routeCodes:['/A'],segmentIds:['dbid:1'],pathPoints:points.map(([x,y,z])=>({x,y,z})),lengthMeters:1,
    fromDistanceMeters:0,toDistanceMeters:0,fromRequiresSecondary:false,toRequiresSecondary:false,connectionGapCount:0,connectionGapLengthMeters:0};
  const design={lengthBeforePercentageMeters:'6',unroundedLengthMeters:'6.6',designLengthMeters:'7'};
  const lengthLedger={schemaVersion:'wfc.pf.length-components.v1',formulaVersion:'pathfinder-45c24bf5',settingsRevision:'1',raw:{lengthMeters:1,fromDistanceMeters:0,toDistanceMeters:0},rawLengthDecimalMeters:'1',
    from:{requiresSecondary:false,removedApproachMeters:'0'},to:{requiresSecondary:false,removedApproachMeters:'0'},settings:{secondaryTrayLengthMeters:'7',endConnectionLengthMeters:'5',additionalBendingPercent:'10'},
    secondaryEnds:0,replacementMeters:'0',beforeClampMeters:'1',clampAdjustmentMeters:'0',afterClampMeters:'1',beforePercentageMeters:'6',bendingIncrementMeters:'0.6',unroundedMeters:'6.6',ceilingIncrementMeters:'0.4',designLengthMeters:'7',gapAccounting:'already-in-raw-geometry'};
  const execution={schemaVersion:'wfc.pf.barrier-execution.v1',context:barriers,
    proof:{schemaVersion:'wfc.pf.barrier-check-proof.v2',binding:barriers.binding,routeSha256,status:'bypassed',routePointCount:2,totalSegments:1,checkedSegments:0,blocking:null,failedSegmentIndex:null,reasonCode:'EXPLICIT_DRILLING_BYPASS',coverage:'registered-selected-objects-only',engineeringAccepted:false},
    directSecondary:{schemaVersion:'wfc.pf.constrained-direct-secondary.v2',policyVersion:'nearest-eligible-tray-or-registered-barriers.v2',
      distanceDecision:{schemaVersion:'wfc.pf.direct-secondary.v1',policyVersion:DIRECT_SECONDARY_POLICY,coordinateFrame:'canonical-world-metres',mode:'tray-network',fromPoint:points[0],toPoint:points[1],distanceMeters:1,nearestFromMeters:0,nearestToMeters:0,eligibleTrays:1,comparison:null},
      binding:barriers.binding,directRouteSha256:routeSha256,mode:'tray-network',directCheck:null,reasonCode:'DISTANCE_NOT_QUALIFIED'},
    diagnostics:{status:'bypassed',reasonCode:'DRILLING_BYPASS',searchComplete:true,candidatesTruncated:false,pairAttempts:0,collisionQueries:0,work:'0',plannerAttempts:0,straightPairAttempts:0,localEdgeChecks:0,localPhaseUsed:false,straightPhaseTruncated:false},
    connectors:{from:null,to:null},qualification:null};
  const output=(requestId:string):EngineResponse=>engineResponseSchema.parse({schemaVersion:'pathfinder.model.response.v3',requestId,status:'calculated',message:'Original exact synthetic engine result.',engineeringAccepted:false,effectiveCategory:'Control',route,design,lengthLedger,barriers:execution});
  const db={job:{id:id(2),project_id:id(1),authority_kind:'current-login',requested_by:id(6),login_id:id(7),login_expires_at:new Date(Date.now()+60000),
    owner_token:null as string|null,lease_until:null as Date|null,state:'queued',kind:'calculate',cancel_requested:false,timeout_ms:10000,completed:0,failure:null as string|null},
    items:Array.from({length:options.siblings??1},(_,at)=>({cable_id:id(30+at),state:'waiting',status:'ready',message:'',dependencies:{...base,cableId:id(30+at)}})),
    proposals:[] as Array<{id:string;cableId:string;status:string;dependencies:Row;result:Row;proposalHash:string}>,outputs:[] as EngineResponse[],autoLengths:[] as Row[]};
  let failure:unknown=options.before,dispatched=false;
  const events:string[]=[];
  if(options.retained){
    const dependencies=structuredClone(db.items[0].dependencies),result={...output(id(41)),calculationMode:'calculate'};
    if(options.retained==='changed-dependencies')dependencies.cableWriteRevision='999';
    db.proposals.push({id:id(40),cableId:db.items[0].cable_id,status:'calculated',dependencies,result,
      proposalHash:digest({dependencies,result,baselineHash:'a'.repeat(64)})});
  }
  const calls:Array<{sql:string;values:any[]}>=[];
  const query=vi.fn(async(raw:string,values:any[]=[])=>{
    const sql=raw.replace(/\s+/g,' ').trim();calls.push({sql,values});
    if(sql.startsWith('SELECT * FROM pf_jobs'))return {rows:[{...db.job}]};
    if(sql.startsWith('SELECT * FROM pf_job_items'))return {rows:db.items.filter(item=>item.state==='waiting').slice(0,1).map(item=>({...item}))};
    if(sql.startsWith("UPDATE pf_job_items SET state='running'")){db.items.find(item=>item.cable_id===values[2])!.state='running';return {rows:[]};}
    if(sql.startsWith('SELECT result,dependencies,status FROM pf_proposals'))return {rows:[]};
    if(sql.startsWith('INSERT INTO pf_proposals')){if(db.proposals.some(proposal=>proposal.cableId===values[3]))return {rows:[]};
      db.proposals.push({id:values[0],cableId:values[3],status:values[4],dependencies:structuredClone(values[5]),result:structuredClone(values[8]),proposalHash:values[9]});return {rows:[{id:values[0]}]};}
    if(sql.startsWith('SELECT id,status,result,dependencies,proposal_hash FROM pf_proposals')){const old=db.proposals.find(proposal=>proposal.cableId===values[2]);return {rows:old?[{id:old.id,status:old.status,result:old.result,dependencies:old.dependencies,proposal_hash:old.proposalHash}]:[]};}
    if(sql.startsWith("UPDATE pf_job_items SET state='complete'")){const item=db.items.find(item=>item.cable_id===values[2])!;if(item.state!=='running')return {rows:[]};item.state='complete';item.status=values[3];item.message=values[4];events.push('complete:'+item.cable_id);return {rows:[{cable_id:item.cable_id}]};}
    if(sql.startsWith('UPDATE pf_jobs SET completed=completed+1')){db.job.completed++;return {rows:[]};}
    if(sql.startsWith('SELECT 1 FROM pf_job_items'))return {rows:db.items.some(item=>item.state==='waiting')?[{value:1}]:[]};
    if(sql.startsWith('UPDATE pf_jobs SET state=$3,owner_token=NULL')){db.job.state=values[2];db.job.owner_token=null;db.job.lease_until=null;return {rows:[]};}
    if(sql.startsWith('UPDATE pf_jobs SET state=CASE')){db.job.state=db.job.cancel_requested?'cancelled':values[2]?'queued':'failed';db.job.failure=values[3];db.job.owner_token=null;return {rows:[]};}
    if(sql.startsWith('UPDATE pf_jobs j SET lease_until'))return {rows:db.job.state==='running'?[{id:db.job.id}]:[]};
    throw new Error('Unexpected synthetic worker SQL: '+sql);
  });
  const client={query} as unknown as PoolClient;
  const owner=new EventEmitter() as EventEmitter&{query:ReturnType<typeof vi.fn>;release:ReturnType<typeof vi.fn>;end:ReturnType<typeof vi.fn>};
  owner.query=vi.fn(async()=>({rows:[{locked:true}]}));owner.release=vi.fn();owner.end=vi.fn(async()=>undefined);
  const pool={connect:vi.fn(async()=>owner),query} as unknown as Pool;
  seams.claim.mockImplementation(async()=>{if(db.job.state!=='queued')return null;db.job.state='running';db.job.owner_token=id(8);db.job.lease_until=new Date(Date.now()+30000);return {...db.job};});
  seams.acquire.mockImplementation(async()=>({principal:{userId:id(6),loginId:id(7),loginExpiresAt:Date.now()+60000},finish:vi.fn(async()=>undefined)}));
  let ackLost=false;
  seams.transaction.mockImplementation(async(_pool:Pool,_project:string,_principal:unknown,_operation:string,work:(c:PoolClient)=>Promise<unknown>,signal:AbortSignal)=>{
    const snapshot=structuredClone(db);signal.throwIfAborted();
    try{const value=await work(client);signal.throwIfAborted();
      if(options.lostCommitAck&&!ackLost&&db.autoLengths.length>snapshot.autoLengths.length){ackLost=true;events.push('commit-ack-lost');
        throw new PathFinderError('PATHFINDER_COMMIT_OUTCOME_UNKNOWN',503);}
      return value;
    }catch(error){
      // This explicit mock models atomic rollback and a deliberately retained
      // unknown COMMIT separately; actual SQL durability is tested elsewhere.
      if(!(error instanceof PathFinderError&&error.code==='PATHFINDER_COMMIT_OUTCOME_UNKNOWN')){Object.assign(db,snapshot);events.push('rollback');}
      throw error;
    }
  });
  seams.collect.mockImplementation(async(_client:PoolClient,_project:string,cableId:string)=>{if(failure)throw failure;return {dependencies:db.items.find(item=>item.cable_id===cableId)!.dependencies};});
  seams.baseline.mockResolvedValue({baselineHash:'a'.repeat(64)});
  const sealPlaceholder=(input:Row)=>({admissionId:id(80),baselineHash:'a'.repeat(64),proposalId:input.proposalId,
    dependencyHash:digest(input.dependencies),engineResultSha256:digest(input.result),revisionResultSha256:'e'.repeat(64)});
  seams.seal.mockImplementation(async(_client:PoolClient,input:Row)=>sealPlaceholder(input));
  seams.verifySeal.mockImplementation(async(_client:PoolClient,input:Row)=>sealPlaceholder(input));
  seams.publish.mockImplementation(async(_client:PoolClient,input:Row)=>{events.push('publish:'+input.cableId);
    expect(db.items.find(item=>item.cable_id===input.cableId)).toMatchObject({state:'complete',status:'calculated'});
    expect(db.job.state).toBe('running');db.autoLengths.push(structuredClone(input));if(options.publicationError)throw options.publicationError;
    return {status:'published',admissionOrdinal:'1'};
  });
  seams.physicalFence.mockImplementation(async(_client:PoolClient,dependencies:Row)=>{events.push('physical:'+dependencies.cableId);
    if(options.physicalFenceError)throw options.physicalFenceError;return syntheticBarrierEngineIdentity();});
  const engine:EngineExecutor={execute:vi.fn(async request=>{dispatched=true;if(options.engineError)throw options.engineError;
    const response=output(request.requestId);db.outputs.push(response);failure=options.during;
    if(options.cancelDuring)db.job.cancel_requested=true;
    if(options.abortDuring)queueMicrotask(()=>{void worker.stop();});return response;}),close:vi.fn(async()=>undefined)};
  seams.enrollment.mockImplementation(async()=>{events.push('enrollment');if(dispatched&&options.authorityAtCompletion)throw options.authorityAtCompletion;
    if(db.autoLengths.length&&options.authorityAfterPublish)throw options.authorityAfterPublish;});
  const worker=createPathFinderWorker(pool,{} as PathFinderJobs,()=>engine,async()=>syntheticBarrierEngineIdentity());active.push(worker);
  return {db,worker,engine,calls,owner,events};
}
beforeEach(()=>{vi.resetAllMocks();seams.identity.mockResolvedValue(syntheticBarrierEngineIdentity());seams.readEnrollment.mockResolvedValue({enrolled:false});});
afterEach(async()=>{for(const worker of active.splice(0))await worker.stop().catch(()=>undefined);});

describe('v8 per-item currentness across dispatch and completion',()=>{
  it('retains the exact completed result as stale when publication changes during dispatch and completes all siblings',async()=>{
    const f=fixture({during:new PathFinderError('BARRIER_CALCULATION_SCOPE_CHANGED',409),siblings:2});f.worker.start();
    await vi.waitFor(()=>expect(f.db.job.state).toBe('complete'));await f.worker.stop();
    expect(f.db.job.completed).toBe(2);expect(f.db.items.map(item=>[item.state,item.status])).toEqual([['complete','stale'],['complete','stale']]);
    expect(f.engine.execute).toHaveBeenCalledOnce();expect(f.db.proposals).toHaveLength(2);
    const {calculationMode,...retained}=f.db.proposals[0].result;expect(calculationMode).toBe('calculate');expect(retained).toEqual(f.db.outputs[0]);
    expect(f.db.proposals[0].status).toBe('stale');expect(f.db.proposals[0].dependencies).toEqual(f.db.items[0].dependencies);
    expect(f.db.proposals[1].result).toMatchObject({schemaVersion:'pathfinder.model.response.v3',status:'invalid_request',barriers:{proof:null,diagnostics:{status:'unavailable'}}});
    expect(f.db.proposals[1].result).not.toHaveProperty('route');expect(f.calls.some(call=>call.sql.startsWith('UPDATE pf_jobs SET state=CASE'))).toBe(false);
    expect(seams.seal).toHaveBeenCalledTimes(2);expect(seams.enrollment).toHaveBeenCalled();expect(seams.publish).not.toHaveBeenCalled();expect(f.db.autoLengths).toHaveLength(0);
  });
  it.each([
    ['BARRIER_CALCULATION_SCOPE_CHANGED',409],['BARRIER_CALCULATION_STORAGE_INVALID',409],['BARRIER_BLOB_INTEGRITY',409],
    ['BARRIER_CALCULATION_DEADLINE',503],['BARRIER_STORAGE_BUSY',503],
  ] as const)('does not dispatch unavailable admitted scope %s and records an honest stale typed refusal',async(code,status)=>{
    const f=fixture({before:new PathFinderError(code,status)});f.worker.start();await vi.waitFor(()=>expect(f.db.job.state).toBe('complete'));await f.worker.stop();
    expect(f.engine.execute).not.toHaveBeenCalled();expect(f.db.job.completed).toBe(1);expect(f.db.items[0]).toMatchObject({state:'complete',status:'stale'});
    const result=f.db.proposals[0].result;expect(result).toMatchObject({schemaVersion:'pathfinder.model.response.v3',status:'invalid_request',engineeringAccepted:false,barriers:{context:f.db.items[0].dependencies.barriers,proof:null,directSecondary:null,diagnostics:{status:'unavailable',reasonCode:code}}});
    expect(result.message).toContain('No route was calculated');expect(result).not.toHaveProperty('route');expect(result).not.toHaveProperty('design');
    expect(seams.publish).not.toHaveBeenCalled();expect(f.db.autoLengths).toHaveLength(0);
  });
  it.each([
    new PathFinderError('ADMIN_REQUIRED',403),new PathFinderError('CALCULATION_ENGINE_UNAVAILABLE',503),new PathFinderError('BARRIER_BLOB_INTEGRITY',500),
    Object.assign(new Error('Unnormalized missing file.'),{code:'ENOENT'}),new TypeError('Broken current-input projection.'),
  ])('does not reinterpret unrelated completion error %s as a stale completed proposal',async failure=>{
    const f=fixture({during:failure});f.worker.start();await vi.waitFor(()=>expect(f.db.job.state).toBe('failed'));await f.worker.stop();
    expect(f.db.proposals).toHaveLength(0);expect(seams.seal).not.toHaveBeenCalled();expect(f.db.job.completed).toBe(0);expect(seams.publish).not.toHaveBeenCalled();
  });
  it('does not publish stale results after completion authority is revoked',async()=>{
    const f=fixture({during:new PathFinderError('BARRIER_CALCULATION_SCOPE_CHANGED',409),authorityAtCompletion:new PathFinderError('LOCATION_IMPACT_JOB_REVOKED',409)});
    f.worker.start();await vi.waitFor(()=>expect(f.db.job.state).toBe('failed'));await f.worker.stop();
    expect(f.db.proposals).toHaveLength(0);expect(seams.seal).not.toHaveBeenCalled();expect(f.db.job.completed).toBe(0);
    expect(seams.publish).not.toHaveBeenCalled();expect(f.db.autoLengths).toHaveLength(0);
  });
  it('does not suppress cancellation when a currentness refusal races with completion',async()=>{
    const f=fixture({during:new PathFinderError('BARRIER_CALCULATION_SCOPE_CHANGED',409),abortDuring:true});f.worker.start();
    await vi.waitFor(()=>expect(f.engine.close).toHaveBeenCalledOnce());await f.worker.stop();
    expect(f.db.proposals).toHaveLength(0);expect(seams.seal).not.toHaveBeenCalled();expect(seams.publish).not.toHaveBeenCalled();
  });
});

describe('Auto length uses the actual worker final item transaction',()=>{
  it('publishes each exact sealed success after item completion and before final physical/authority fences without waiting for siblings',async()=>{
    const f=fixture({siblings:2});f.worker.start();await vi.waitFor(()=>expect(f.db.job.state).toBe('complete'));await f.worker.stop();
    expect(f.db.autoLengths).toHaveLength(2);expect(seams.publish).toHaveBeenCalledTimes(2);expect(seams.physicalFence).toHaveBeenCalledTimes(2);
    for(const auto of f.db.autoLengths){
      const stored=f.db.proposals.find(value=>value.id===auto.proposalId)!;
      expect(auto).toMatchObject({projectId:f.db.job.project_id,jobId:f.db.job.id,cableId:stored.cableId,dependencies:stored.dependencies,result:stored.result,
        seal:{dependencyHash:digest(stored.dependencies),engineResultSha256:digest(stored.result)}});
      const completed=f.events.indexOf('complete:'+auto.cableId),published=f.events.indexOf('publish:'+auto.cableId),physical=f.events.indexOf('physical:'+auto.cableId);
      expect(completed).toBeGreaterThanOrEqual(0);expect(published).toBeGreaterThan(completed);expect(physical).toBeGreaterThan(published);
      expect(f.events.indexOf('enrollment',physical+1)).toBeGreaterThan(physical);
    }
    expect(f.events.indexOf('publish:'+f.db.items[0].cable_id)).toBeLessThan(f.events.indexOf('complete:'+f.db.items[1].cable_id));
    expect(f.db.job.completed).toBe(2);
  });
  it('retains a legitimate failed engine output without promoting a new Auto value',async()=>{
    const f=fixture({engineError:new PathFinderError('ENGINE_DEADLINE',503)});f.worker.start();await vi.waitFor(()=>expect(f.db.job.state).toBe('complete'));await f.worker.stop();
    expect(f.db.items[0]).toMatchObject({state:'complete',status:'deadline_exceeded'});expect(f.db.proposals).toHaveLength(1);
    expect(seams.publish).not.toHaveBeenCalled();expect(seams.physicalFence).not.toHaveBeenCalled();expect(f.db.autoLengths).toHaveLength(0);
  });
  it('a cancellation observed after engine completion fences the actual final transaction before Auto publication',async()=>{
    const f=fixture({cancelDuring:true});f.worker.start();await vi.waitFor(()=>expect(f.db.job.state).toBe('cancelled'));await f.worker.stop();
    expect(f.db.outputs).toHaveLength(1);expect(f.db.proposals).toHaveLength(0);expect(seams.publish).not.toHaveBeenCalled();expect(f.db.autoLengths).toHaveLength(0);
  });
  it.each(['publication','physical','authority'] as const)('rolls back the exact item/proposal/counter and simulated Auto on final %s failure',async kind=>{
    const failure=new PathFinderError(kind==='publication'?'AUTO_LENGTH_SOURCE_INTEGRITY':kind==='physical'?'PROPOSAL_STALE':'LOCATION_IMPACT_JOB_REVOKED',409);
    const f=fixture(kind==='publication'?{publicationError:failure}:kind==='physical'?{physicalFenceError:failure}:{authorityAfterPublish:failure});
    f.worker.start();await vi.waitFor(()=>expect(f.db.job.state).toBe('failed'));await f.worker.stop();
    expect(seams.publish).toHaveBeenCalledOnce();expect(f.events).toContain('rollback');expect(f.db.outputs).toHaveLength(1);
    expect(f.db.autoLengths).toHaveLength(0);expect(f.db.proposals).toHaveLength(0);expect(f.db.job.completed).toBe(0);
    expect(f.db.items[0]).toMatchObject({state:'running',status:'ready'});
  });
  it('unknown final COMMIT acknowledgment retains the committed item and exact source, then finishes bookkeeping without another engine result',async()=>{
    const f=fixture({lostCommitAck:true});f.worker.start();await vi.waitFor(()=>expect(f.db.job.state).toBe('complete'));await f.worker.stop();
    expect(f.events).toContain('commit-ack-lost');expect(f.db.autoLengths).toHaveLength(1);expect(f.db.proposals).toHaveLength(1);
    expect(f.db.job.completed).toBe(1);expect(f.engine.execute).toHaveBeenCalledOnce();expect(seams.publish).toHaveBeenCalledOnce();
    expect(f.db.autoLengths[0].result).toEqual(f.db.proposals[0].result);
  });
  it('on proposal conflict publishes only the stored original engine result and its exact original seal',async()=>{
    const f=fixture({retained:'exact'});f.worker.start();await vi.waitFor(()=>expect(f.db.job.state).toBe('complete'));await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledOnce();expect(seams.verifySeal).toHaveBeenCalledOnce();expect(seams.seal).not.toHaveBeenCalled();
    expect(f.db.autoLengths).toHaveLength(1);expect(f.db.autoLengths[0].proposalId).toBe(id(40));expect(f.db.autoLengths[0].result.requestId).toBe(id(41));
    expect(f.db.autoLengths[0].result.requestId).not.toBe(f.db.outputs[0].requestId);expect(f.db.autoLengths[0].result).toEqual(f.db.proposals[0].result);
  });
  it('rejects an internally sealed retained proposal with different admitted dependencies even when its baseline matches',async()=>{
    const f=fixture({retained:'changed-dependencies'});f.worker.start();await vi.waitFor(()=>expect(f.db.job.state).toBe('failed'));await f.worker.stop();
    expect(seams.verifySeal).toHaveBeenCalledOnce();expect(seams.publish).not.toHaveBeenCalled();expect(f.db.autoLengths).toHaveLength(0);
    expect(f.db.job.completed).toBe(0);expect(f.db.proposals).toHaveLength(1);expect(f.db.proposals[0].dependencies.cableWriteRevision).toBe('999');
  });
});
