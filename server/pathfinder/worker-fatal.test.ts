// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import type {Pool,PoolClient} from 'pg';
import type {EngineExecutor} from './engineSession.js';
import type {PathFinderJobs} from './jobs.js';
import {PathFinderError} from './errors.js';
import {syntheticEngineIdentity} from './calculationFixtures.js';

const seams=vi.hoisted(()=>({claim:vi.fn(),finish:vi.fn(),collect:vi.fn(),authority:vi.fn(),readAuthority:vi.fn(),identity:vi.fn()}));
vi.mock('./workerScheduling.js',()=>({claimCalculationSlice:seams.claim,finishCalculationSlice:seams.finish}));
vi.mock('./dependencies.js',()=>({collectDependencies:seams.collect,collectDependenciesForVersion:seams.collect,hash:()=> 'frozen',geometryHash:()=> 'geometry',verifiedDesignOnlyChange:()=>false}));
vi.mock('./calculationEngineIdentity.js',()=>({calculationEngineIdentity:seams.identity}));
vi.mock('./recalculationRepository.js',()=>({requireEnrollmentAuthority:seams.authority,readRecalculationJobAuthority:seams.readAuthority}));
vi.mock('./routingScope.js',()=>({requireVersionedCalculationScope:()=>undefined}));
vi.mock('./storage.js',()=>({readSnapshot:async()=>undefined}));
vi.mock('./auth.js',()=>({principalTransaction:async(_pool:Pool,_project:string,_principal:unknown,operation:(c:PoolClient)=>Promise<unknown>)=>operation(controlClient!)}));
// Login/grant admission is covered by grantWorkerAuthority tests. This fixture
// isolates engine-lane ownership and never opens a database or recovery file.
vi.mock('./grantWorkerAuthority.js',async importOriginal=>({...await importOriginal<typeof import('./grantWorkerAuthority.js')>(),
  acquireGrantJobExecution:async(_pool:Pool,job:Record<string,any>)=>({principal:{userId:job.requested_by,loginId:job.login_id,loginExpiresAt:new Date(job.login_expires_at).getTime()},async finish(){}})}));
import {createPathFinderWorker} from './worker.js';

let controlClient:PoolClient|undefined;
const id=(n:number)=>`fa700000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const active:Array<ReturnType<typeof createPathFinderWorker>>=[];

/** Mock SQL/engine ownership only: no database, child process, HTTP or fixture writes. */
function fixture(options:{cancelled?:boolean;awaitAbort?:boolean;closeFails?:boolean;confirmedCancel?:boolean}={}){
  const failure=new PathFinderError('ENGINE_SESSION_REAP_FAILED',503,'Synthetic unconfirmed process-group join.');
  const dependencies={schemaVersion:'pathfinder.dependencies.v5',options:{},artifact:{id:id(4),sha256:'a'.repeat(64)},model:{id:id(5)},
    cableInputs:{mto:'Control'},from:{point:[0,0,0]},to:{point:[1,0,0]},settings:{}};
  const row={id:id(2),project_id:id(1),authority_kind:'current-login',grant_provenance:null,requested_by:id(6),login_id:id(7),login_expires_at:new Date(Date.now()+60000),
    owner_token:id(8),lease_until:new Date(Date.now()+30000),state:'running',kind:'calculate',cancel_requested:false,timeout_ms:10000};
  const calls:string[]=[],events:string[]=[];
  const query=vi.fn(async(sql:string)=>{
    calls.push(sql.replace(/\s+/g,' ').trim());
    if(sql.startsWith('SELECT * FROM pf_jobs'))return {rows:[row]};
    if(sql.startsWith('SELECT * FROM pf_job_items'))return {rows:[{cable_id:id(3),dependencies}]};
    return {rows:[]};
  });
  controlClient={query} as unknown as PoolClient;
  const owner=new EventEmitter() as EventEmitter&{query:ReturnType<typeof vi.fn>;release:ReturnType<typeof vi.fn>;end:ReturnType<typeof vi.fn>};
  owner.query=vi.fn(async(sql:string)=>{events.push(sql.includes('pg_try_advisory_lock')?'lock':'unlock');return {rows:[{locked:true}]};});
  owner.release=vi.fn(()=>events.push('release'));owner.end=vi.fn(async()=>{events.push('end');});
  const pool={connect:vi.fn(async()=>owner),query:vi.fn(async(sql:string)=>{calls.push(sql.replace(/\s+/g,' ').trim());return {rows:[]};})} as unknown as Pool;
  let reached!:()=>void;const dispatched=new Promise<void>(resolve=>{reached=resolve;});
  const engine:EngineExecutor={
    execute:vi.fn(async(_request,signal)=>{
      events.push('dispatch');reached();
      if(options.cancelled||options.awaitAbort){
        await new Promise<void>(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',()=>resolve(),{once:true});});
        if(options.cancelled)row.cancel_requested=true;
      }
      if(options.confirmedCancel){events.push('cancel-joined');throw new PathFinderError('CALCULATION_CANCELLED',409);}
      throw failure;
    }),
    close:vi.fn(async()=>{events.push('close');if(options.closeFails!==false)throw failure;events.push('joined');}),
  };
  const factory=vi.fn(()=>engine),identityReader=vi.fn(async()=>syntheticEngineIdentity());
  const worker=createPathFinderWorker(pool,{} as PathFinderJobs,factory,identityReader);
  active.push(worker);seams.claim.mockResolvedValueOnce(row).mockResolvedValue(null);seams.collect.mockResolvedValue({dependencies});
  return{worker,engine,factory,owner,pool,calls,events,failure,dispatched,identityReader};
}
beforeEach(()=>{
  vi.clearAllMocks();seams.identity.mockResolvedValue(syntheticEngineIdentity());seams.authority.mockResolvedValue(undefined);seams.readAuthority.mockResolvedValue({enrolled:false});
});
afterEach(async()=>{for(const worker of active.splice(0))await worker.stop().catch(()=>undefined);vi.useRealTimers();controlClient=undefined;});

describe('unconfirmed engine join quarantines the complete worker lane',()=>{
  it.each([false,true])('does not publish or mark terminal after reap failure (already cancelled=%s)',async cancelled=>{
    if(cancelled)vi.useFakeTimers();
    const h=fixture({cancelled});h.worker.start();await h.dispatched;
    if(cancelled)await vi.advanceTimersByTimeAsync(1000); // Production heartbeat observes the cancelled owned job.
    await vi.waitFor(()=>expect(h.engine.close).toHaveBeenCalledOnce());
    await expect(h.worker.stop()).rejects.toBe(h.failure);
    expect(h.worker.failureCode).toBe('ENGINE_SESSION_REAP_FAILED');
    expect(h.engine.execute).toHaveBeenCalledOnce();expect(h.factory).toHaveBeenCalledOnce();expect(seams.claim).toHaveBeenCalledOnce();
    expect(h.calls.filter(sql=>sql.startsWith('INSERT INTO pf_proposals')||sql.includes("SET state='complete'")||sql.startsWith('UPDATE pf_jobs SET state=CASE'))).toEqual([]);
    expect(seams.finish).not.toHaveBeenCalled();expect(h.owner.release).not.toHaveBeenCalled();expect(h.owner.end).not.toHaveBeenCalled();
    expect(h.events).toEqual(['lock','dispatch','close']);
    h.worker.start();expect(h.factory).toHaveBeenCalledOnce();
    await expect(h.worker.executePreparation({requestId:id(10),operation:'prepare',timeoutMilliseconds:1000},new AbortController().signal)).rejects.toMatchObject({code:'PREPARATION_WORKER_UNAVAILABLE'});
  });

  it('releases ownership only when a later explicit close positively joins, while retaining the fatal outcome',async()=>{
    const h=fixture({closeFails:false});h.worker.start();await h.dispatched;
    await vi.waitFor(()=>expect(h.owner.release).toHaveBeenCalledOnce());
    await expect(h.worker.stop()).rejects.toBe(h.failure);
    expect(h.events).toEqual(['lock','dispatch','close','joined','unlock','release']);
    expect(h.worker.failureCode).toBe('ENGINE_SESSION_REAP_FAILED');expect(seams.finish).not.toHaveBeenCalled();expect(seams.claim).toHaveBeenCalledOnce();
    expect(h.calls.some(sql=>sql.startsWith('INSERT INTO pf_proposals')||sql.startsWith('UPDATE pf_jobs SET state=CASE'))).toBe(false);
  });

  it('retains ordinary confirmed cancellation and releases its lane normally on shutdown',async()=>{
    vi.useFakeTimers();const h=fixture({cancelled:true,confirmedCancel:true,closeFails:false});h.worker.start();await h.dispatched;
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(()=>expect(h.calls.some(sql=>sql.startsWith('UPDATE pf_jobs SET state=CASE'))).toBe(true));
    expect(h.events).toContain('cancel-joined');expect(h.worker.failureCode).toBeNull();
    expect(h.calls.filter(sql=>sql.startsWith('INSERT INTO pf_proposals'))).toEqual([]);expect(seams.finish).not.toHaveBeenCalled();
    await h.worker.stop();
    expect(h.events).toEqual(['lock','dispatch','cancel-joined','close','joined','unlock','release']);
    expect(h.engine.execute).toHaveBeenCalledOnce();expect(h.factory).toHaveBeenCalledOnce();expect(h.worker.failureCode).toBeNull();
  });

  it('exposes safely joined advisory-transport loss without changing its clean shutdown contract',async()=>{
    const h=fixture({awaitAbort:true,confirmedCancel:true,closeFails:false});h.worker.start();await h.dispatched;
    h.owner.emit('error',new Error('Synthetic owned advisory transport loss.'));
    await h.worker.stop();
    expect(h.worker.failureCode).toBe('WORKER_OWNER_CONNECTION_LOST');
    expect(h.events).toEqual(['lock','dispatch','cancel-joined','close','joined','end','release']);
    expect(h.owner.release).toHaveBeenCalledWith(true);expect(h.engine.execute).toHaveBeenCalledOnce();expect(seams.claim).toHaveBeenCalledOnce();
    expect(h.calls.some(sql=>sql.startsWith('INSERT INTO pf_proposals'))).toBe(false);
  });

  it('gives an unconfirmed join priority over the preceding advisory-transport unavailability',async()=>{
    const h=fixture({awaitAbort:true});h.worker.start();await h.dispatched;
    h.owner.emit('error',new Error('Synthetic owned advisory transport loss.'));
    await expect(h.worker.stop()).rejects.toBe(h.failure);
    expect(h.worker.failureCode).toBe('ENGINE_SESSION_REAP_FAILED');
    expect(h.owner.release).not.toHaveBeenCalled();expect(h.owner.end).not.toHaveBeenCalled();
    expect(h.calls.some(sql=>sql.startsWith('INSERT INTO pf_proposals')||sql.startsWith('UPDATE pf_jobs SET state=CASE'))).toBe(false);
  });

  it('stops and exposes changed loaded implementation before dispatch without fabricating a proposal or terminal result',async()=>{
    const h=fixture({closeFails:false}),loaded=syntheticEngineIdentity(),changed={...loaded,contentSha256:'f'.repeat(64)};
    h.identityReader.mockResolvedValueOnce(loaded).mockResolvedValue(changed);
    h.worker.start();await vi.waitFor(()=>expect(h.owner.release).toHaveBeenCalledOnce());
    await h.worker.stop();
    expect(h.worker.failureCode).toBe('ENGINE_IMPLEMENTATION_RESTART_REQUIRED');expect(h.engine.execute).not.toHaveBeenCalled();
    expect(h.events).toEqual(['lock','close','joined','unlock','release']);expect(seams.finish).not.toHaveBeenCalled();expect(seams.claim).toHaveBeenCalledOnce();
    expect(h.calls.some(sql=>sql.startsWith('INSERT INTO pf_proposals')||sql.startsWith('UPDATE pf_jobs SET state=CASE'))).toBe(false);
  });

  it('exposes no fatal status before a worker has encountered a failed join',()=>{
    const h=fixture();expect(h.worker.failureCode).toBeNull();expect(h.engine.execute).not.toHaveBeenCalled();
  });
});
