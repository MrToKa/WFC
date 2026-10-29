// @vitest-environment node
import {afterEach,describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {WorkerOptions} from 'node:worker_threads';
import {preparationContextSchema,preparationCreateSchema,preparationPlanHashInput,type PreparationPlan} from '../../shared/pathfinderPreparation.js';
import {canonicalPurposeJson} from '../../shared/pathfinderPurposePolicy.js';
import type {ComputationalSnapshot} from './contracts.js';
import {createPreparationUnionRunner,type PreparationUnionParts,type PreparationUnionThread} from './preparationUnionWorker.js';
import {buildPreparationPlan} from './preparationPlans.js';
import {preparationUnionPolicy} from './preparationUnionTask.js';
import {LEGACY_PREPARATION_CAPACITY_PROFILE,LARGE_PREPARATION_CAPACITY_PROFILE} from '../../shared/pathfinderCapacity.js';
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={modelVersionId:uuid(20),contentFingerprint:'a'.repeat(64),selectionRevision:'1',catalogRevision:'1',routingContentSha256:'b'.repeat(64),routingPolicyRevision:'1',routingPolicySha256:'c'.repeat(64),locationRegistryRevision:'1',resolutionRevision:'0'};
const context=preparationContextSchema.parse({schemaVersion:'wfc.pf.preparation-context.v1',projectId:uuid(10),scope,trays:[{projectTrayId:uuid(30),rawName:'/B001',purposeKey:'LV',routeName:'/B001',allowedCategories:['LV'],policyState:'configured',diagnosticCodes:[]}],endpointNames:[],resolutions:[],diagnostics:[],currentAggregate:null});
const input=preparationCreateSchema.parse({schemaVersion:'wfc.pf.preparation-create.v1',expected:scope,idempotencyKey:uuid(40),discovery:{schemaVersion:'wfc.pf.discovery-report.v1',modelVersionId:scope.modelVersionId,contentFingerprint:scope.contentFingerprint,selectionRevision:scope.selectionRevision,matchingPolicyVersion:'wfc.pf.project-exact-candidates.v1',complete:true,propertyScan:null,objects:[{objectId:'dbid:1',parentId:null,name:'Plant',hasGeometry:false,isPhysicalLeaf:false,orderIndex:0},{objectId:'dbid:2',parentId:'dbid:1',name:'/B001',hasGeometry:false,isPhysicalLeaf:false,orderIndex:1},{objectId:'dbid:3',parentId:'dbid:2',name:'STRAIGHT',hasGeometry:true,isPhysicalLeaf:true,orderIndex:2}],trays:[{projectTrayId:uuid(30),candidateRootObjectIds:['dbid:2']}],endpointCandidates:[]}});
const plan=buildPreparationPlan(context,input,uuid(1)),parts=[{partId:plan.partPlan[0].partId,payload:{} as ComputationalSnapshot}];
const references=()=>[{partId:plan.partPlan[0].partId,reference:{payloadRef:uuid(50),sha256:'d'.repeat(64),bytes:100}}];
const rehash=(value:PreparationPlan):PreparationPlan=>({...value,orderedPlanSha256:createHash('sha256').update(canonicalPurposeJson(preparationPlanHashInput(value))).digest('hex')});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
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
 it('keeps the same memory, watchdog and join fences for the explicit larger profile',async()=>{
  const f=fixture(),done=f.run(rehash({...plan,limitsProfile:LARGE_PREPARATION_CAPACITY_PROFILE}),parts,new AbortController().signal);
  await turn();expect(f.options.workerData.plan.limitsProfile).toBe(LARGE_PREPARATION_CAPACITY_PROFILE);
  expect(f.options.resourceLimits).toEqual({maxOldGenerationSizeMb:512});
  expect(preparationUnionPolicy).toMatchObject({milliseconds:120000,rssBytes:2*1024**3,rssIntervalMilliseconds:100,joinMilliseconds:10000});
  f.worker.emit('message',f.result());expect(f.release).not.toHaveBeenCalled();f.join();await done;
 });
 it('refuses a missing or unknown frozen profile before spawning a worker',async()=>{
  const f=fixture();
  for(const value of [undefined,'unlimited'])await expect(f.run({...plan,limitsProfile:value} as PreparationPlan,parts,new AbortController().signal)).rejects.toMatchObject({code:'PREPARATION_UNION_LIMIT'});
  expect(f.spawn).not.toHaveBeenCalled();expect(f.target).not.toHaveBeenCalled();
 });
 it('uses fixed admission, the configured 512MiB resource request, shared quota lock, and returns only after termination joins',async()=>{
  const f=fixture(),done=f.run(plan,parts,new AbortController().signal);await turn();expect(f.options.resourceLimits).toEqual({maxOldGenerationSizeMb:512});expect(f.options.execArgv).toEqual([]);expect(f.options.workerData.storageLockBuffer).toBeInstanceOf(SharedArrayBuffer);
  expect(f.options.workerData.schemaVersion).toBe('wfc.pf.preparation-union-task.v1');expect(f.options.workerData.parts).toBe(parts);expect(f.options.workerData.plan.limitsProfile).toBe(LEGACY_PREPARATION_CAPACITY_PROFILE);
  let settled=false;void done.then(()=>{settled=true;});f.worker.emit('message',f.result());await turn();expect(f.worker.terminate).toHaveBeenCalledTimes(1);expect(settled).toBe(false);expect(f.release).not.toHaveBeenCalled();f.join();await expect(done).resolves.toEqual(f.result().result);expect(f.release).toHaveBeenCalledExactlyOnceWith(99);
 });
 it('passes only immutable part references to task v2 without loading geometry on the parent lane',async()=>{
  const f=fixture(),refs=references(),read=vi.spyOn(fs,'readFile'),done=f.run(plan,refs,new AbortController().signal);
  await turn();expect(f.options.workerData.schemaVersion).toBe('wfc.pf.preparation-union-task.v2');expect(f.options.workerData.parts).toBe(refs);
  expect(f.options.workerData.parts).toEqual([{partId:plan.partPlan[0].partId,reference:{payloadRef:uuid(50),sha256:'d'.repeat(64),bytes:100}}]);
  expect(read).not.toHaveBeenCalled();expect(f.options.resourceLimits).toEqual({maxOldGenerationSizeMb:512});expect(f.options.execArgv).toEqual([]);
  expect(f.options.workerData.storageLockBuffer).toBeInstanceOf(SharedArrayBuffer);f.worker.emit('message',f.result());expect(f.release).not.toHaveBeenCalled();f.join();await expect(done).resolves.toEqual(f.result().result);expect(f.release).toHaveBeenCalledExactlyOnceWith(99);
 });
 it('admits reference metadata above 32MiB only for a freshly hashed larger frozen plan',async()=>{
  const f=fixture(),refs=references();refs[0].reference.bytes=32*1024**2+1;
  await expect(f.run(plan,refs,new AbortController().signal)).rejects.toMatchObject({code:'PREPARATION_UNION_LIMIT'});expect(f.spawn).not.toHaveBeenCalled();
  await expect(f.run({...plan,limitsProfile:LARGE_PREPARATION_CAPACITY_PROFILE},refs,new AbortController().signal)).rejects.toMatchObject({code:'PREPARATION_UNION_LIMIT'});expect(f.spawn).not.toHaveBeenCalled();
  const large=rehash({...plan,limitsProfile:LARGE_PREPARATION_CAPACITY_PROFILE}),done=f.run(large,refs,new AbortController().signal);await turn();expect(f.options.workerData.schemaVersion).toBe('wfc.pf.preparation-union-task.v2');expect(f.options.workerData.plan).toBe(large);
  f.worker.emit('message',f.result());f.join();await done;
 });
 it('refuses mixed input, arbitrary paths, foreign part IDs and invalid reference metadata before resolving a worker',async()=>{
  const f=fixture(),ref=references()[0],invalid:unknown[]=[
   [ref,parts[0]],[{...ref,payload:{}}],[{...ref,filename:'/foreign/model.json'}],[{...ref,partId:uuid(99)}],
   [{...ref,reference:{...ref.reference,filename:'/foreign/model.json'}}],[{...ref,reference:{...ref.reference,payloadRef:'../foreign'}}],
   [{...ref,reference:{...ref.reference,sha256:ref.reference.sha256+'\n'}}],[{...ref,reference:{...ref.reference,bytes:0}}],
   [{...ref,reference:{...ref.reference,bytes:64*1024**2+1}}],[],[ref,ref],
  ];
  for(const value of invalid)await expect(f.run(plan,value as PreparationUnionParts,new AbortController().signal)).rejects.toMatchObject({code:'PREPARATION_UNION_LIMIT'});
  expect(f.target).not.toHaveBeenCalled();expect(f.spawn).not.toHaveBeenCalled();expect(f.release).not.toHaveBeenCalled();
 });
 it.each(['cancel','abort-after-result','timeout','rss','join-quarantine'] as const)('retains reference-worker %s cleanup and lane fences',async kind=>{
  vi.useFakeTimers();const f=fixture(),abort=new AbortController(),done=f.run(plan,references(),abort.signal),code=kind==='timeout'?'PREPARATION_UNION_TIMEOUT':kind==='rss'?'PREPARATION_UNION_MEMORY_LIMIT':kind==='join-quarantine'?'PREPARATION_UNION_JOIN_UNCONFIRMED':undefined;
  const rejected=code?expect(done).rejects.toMatchObject({code}):expect(done).rejects.toMatchObject({name:'AbortError'});await turn();
  if(kind==='abort-after-result')f.worker.emit('message',f.result());
  if(kind==='rss'){f.setRss(preparationUnionPolicy.rssBytes);await vi.advanceTimersByTimeAsync(100);}else if(kind==='timeout')await vi.advanceTimersByTimeAsync(120000);else abort.abort();
  expect(f.worker.terminate).toHaveBeenCalledTimes(1);expect(f.release).not.toHaveBeenCalled();await expect(f.run(plan,references(),new AbortController().signal)).rejects.toMatchObject({code:'PREPARATION_UNION_BUSY'});
  if(kind==='join-quarantine'){await vi.advanceTimersByTimeAsync(10000);await rejected;expect(f.release).not.toHaveBeenCalled();await expect(f.run(plan,references(),new AbortController().signal)).rejects.toMatchObject({code:'PREPARATION_UNION_BUSY'});f.join();await turn();}
  else{f.join();await rejected;}
  expect(f.release).toHaveBeenCalledExactlyOnceWith(99);
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
