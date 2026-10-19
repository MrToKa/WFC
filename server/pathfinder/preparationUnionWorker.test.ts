// @vitest-environment node
import {afterEach,describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import type {WorkerOptions} from 'node:worker_threads';
import type {PreparationPlan} from '../../shared/pathfinderPreparation.js';
import type {ComputationalSnapshot} from './contracts.js';
import {createPreparationUnionRunner,type PreparationUnionThread} from './preparationUnionWorker.js';
import {preparationUnionPolicy} from './preparationUnionTask.js';
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const plan={id:uuid(1)} as PreparationPlan,parts=[{partId:uuid(2),payload:{} as ComputationalSnapshot}];
afterEach(()=>vi.useRealTimers());
function fixture(){
 let joined!:()=>void,options!:WorkerOptions,rss=1000;
 const worker=Object.assign(new EventEmitter(),{threadId:99,terminate:vi.fn(()=>new Promise<number>(resolve=>{joined=()=>{worker.emit('exit',1);resolve(1);};}))});
 const release=vi.fn(),spawn=vi.fn((_file:URL|string,value:WorkerOptions)=>{options=value;return worker as unknown as PreparationUnionThread;}),target=vi.fn(async()=>({filename:new URL('file:///fixed/server/preparationUnionTask.js')}));
 const run=createPreparationUnionRunner({target,spawn,residentBytes:()=>rss,storageLockBuffer:new SharedArrayBuffer(4),releaseStorageOwner:release});
 const result=()=>({schemaVersion:'wfc.pf.preparation-union-message.v1',requestId:options.workerData.requestId,type:'result',result:{snapshotId:options.workerData.snapshotId,projection:{schemaVersion:'pathfinder.model.snapshot.v1',payloadRef:options.workerData.snapshotId,sha256:'a'.repeat(64),bytes:100},traceIndex:{schemaVersion:'wfc.pf.preparation-trace-index.v1',payloadRef:uuid(3),sha256:'b'.repeat(64),bytes:20},counts:{objects:3,physicalLeaves:1,fragments:1,vertices:3,triangles:1}}});
 return{run,worker,release,spawn,target,result,get options(){return options;},join:()=>joined(),setRss:(value:number)=>{rss=value;}};
}
const turn=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
describe('bounded off-thread preparation union lifecycle',()=>{
 it('uses fixed admission, 512MiB V8 old space, shared quota lock, and returns references only after termination joins',async()=>{
  const f=fixture(),done=f.run(plan,parts,new AbortController().signal);await turn();expect(f.options.resourceLimits).toEqual({maxOldGenerationSizeMb:512});expect(f.options.execArgv).toEqual([]);expect(f.options.workerData.storageLockBuffer).toBeInstanceOf(SharedArrayBuffer);
  let settled=false;void done.then(()=>{settled=true;});f.worker.emit('message',f.result());await turn();expect(f.worker.terminate).toHaveBeenCalledTimes(1);expect(settled).toBe(false);expect(f.release).not.toHaveBeenCalled();f.join();await expect(done).resolves.toEqual(f.result().result);expect(f.release).toHaveBeenCalledExactlyOnceWith(99);
 });
 it.each(['wrong-request','wrong-snapshot','unknown-key','unknown-version','hash-newline','duplicate'] as const)('refuses %s protocol before releasing admission',async kind=>{
  const f=fixture(),done=f.run(plan,parts,new AbortController().signal),rejected=expect(done).rejects.toMatchObject({code:'PREPARATION_UNION_PROTOCOL'});await turn();const value=f.result();if(kind==='wrong-request')value.requestId=uuid(99);if(kind==='wrong-snapshot')value.result.snapshotId=uuid(99);if(kind==='unknown-key')Object.assign(value,{payload:'not allowed'});if(kind==='unknown-version')value.schemaVersion='v9';if(kind==='hash-newline')value.result.projection.sha256+='\n';f.worker.emit('message',value);if(kind==='duplicate')f.worker.emit('message',value);expect(f.release).not.toHaveBeenCalled();f.join();await rejected;
 });
 it('cancellation joins the worker before rejection and keeps the lane busy while termination is pending',async()=>{
  const f=fixture(),abort=new AbortController(),done=f.run(plan,parts,abort.signal),rejected=expect(done).rejects.toMatchObject({name:'AbortError'});await turn();abort.abort();await expect(f.run(plan,parts,new AbortController().signal)).rejects.toMatchObject({code:'PREPARATION_UNION_BUSY'});expect(f.release).not.toHaveBeenCalled();f.join();await rejected;
 });
 it('an abort arriving after result but before join cannot return success',async()=>{
  const f=fixture(),abort=new AbortController(),done=f.run(plan,parts,abort.signal),rejected=expect(done).rejects.toMatchObject({name:'AbortError'});await turn();f.worker.emit('message',f.result());abort.abort();f.join();await rejected;
 });
 it('a late worker error before join cannot bless an otherwise valid result',async()=>{
  const f=fixture(),done=f.run(plan,parts,new AbortController().signal),rejected=expect(done).rejects.toMatchObject({code:'PREPARATION_UNION_FAILED'});await turn();f.worker.emit('message',f.result());f.worker.emit('error',new Error('private worker detail'));f.join();await rejected;
 });
 it.each(['timeout','rss'] as const)('enforces %s then joins instead of leaving background validation',async kind=>{
  vi.useFakeTimers();const f=fixture(),done=f.run(plan,parts,new AbortController().signal),rejected=expect(done).rejects.toMatchObject({code:kind==='timeout'?'PREPARATION_UNION_TIMEOUT':'PREPARATION_UNION_MEMORY_LIMIT'});await turn();if(kind==='rss')f.setRss(preparationUnionPolicy.rssBytes);await vi.advanceTimersByTimeAsync(kind==='rss'?100:120000);expect(f.worker.terminate).toHaveBeenCalledTimes(1);expect(f.release).not.toHaveBeenCalled();f.join();await rejected;
 });
 it('quarantines admission and the exact storage owner when termination cannot be confirmed',async()=>{
  vi.useFakeTimers();const f=fixture(),abort=new AbortController(),done=f.run(plan,parts,abort.signal),rejected=expect(done).rejects.toMatchObject({code:'PREPARATION_UNION_JOIN_UNCONFIRMED'});await turn();abort.abort();await vi.advanceTimersByTimeAsync(10000);await rejected;expect(f.release).not.toHaveBeenCalled();await expect(f.run(plan,parts,new AbortController().signal)).rejects.toMatchObject({code:'PREPARATION_UNION_BUSY'});f.join();await turn();expect(f.release).toHaveBeenCalledExactlyOnceWith(99);
 });
 it('refuses aborted, oversized and unavailable-RSS work before spawning or inspecting geometry',async()=>{
  const f=fixture(),abort=new AbortController();abort.abort();await expect(f.run(plan,parts,abort.signal)).rejects.toMatchObject({name:'AbortError'});
  await expect(f.run(plan,[{partId:uuid(2),payload:{text:'x'.repeat(32*1024**2)} as unknown as ComputationalSnapshot}],new AbortController().signal)).rejects.toMatchObject({code:'PREPARATION_UNION_LIMIT'});f.setRss(NaN);await expect(f.run(plan,parts,new AbortController().signal)).rejects.toMatchObject({code:'PREPARATION_UNION_MEMORY_UNAVAILABLE'});expect(f.spawn).not.toHaveBeenCalled();
 });
 it('requires an actual final response even after a clean exit and sanitizes worker errors',async()=>{
  for(const kind of ['exit','error']){const f=fixture(),done=f.run(plan,parts,new AbortController().signal),rejected=expect(done).rejects.toMatchObject({code:'PREPARATION_UNION_FAILED',message:'PREPARATION_UNION_FAILED'});await turn();if(kind==='exit')f.worker.emit('exit',0);else{f.worker.emit('error',new Error('private source/path must not escape'));f.join();}await rejected;}
 });
});
