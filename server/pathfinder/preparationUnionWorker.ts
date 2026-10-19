import { Worker, type WorkerOptions } from 'node:worker_threads';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { PreparationPlan } from '../../shared/pathfinderPreparation.js';
import type { ComputationalSnapshot } from './contracts.js';
import { PathFinderError } from './errors.js';
import { preparationStorageLockBuffer,releasePreparationStorageOwner } from './preparationStorage.js';
import { preparationUnionPolicy,preparationUnionMessageSchema,checkPreparationUnionInputBytes,type PreparationUnionResult } from './preparationUnionTask.js';

export interface PreparationUnionThread {
 readonly threadId:number;
 on(event:'message',handler:(message:unknown)=>void):this;
 on(event:'error',handler:(error:Error)=>void):this;
 on(event:'exit',handler:(code:number)=>void):this;
 terminate():Promise<number>;
}
type Target={filename:URL|string;options?:WorkerOptions};
export interface PreparationUnionWorkerDependencies {
 target:()=>Promise<Target>;
 spawn:(filename:URL|string,options:WorkerOptions)=>PreparationUnionThread;
 residentBytes:()=>number;
 storageLockBuffer:SharedArrayBuffer;
 releaseStorageOwner:(threadId:number)=>void;
}
async function regularFile(url:URL):Promise<boolean>{try{const stat=await fs.lstat(url);return stat.isFile()&&!stat.isSymbolicLink();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
/** Fixed sibling executable only. Development loader is resolved from installed tsx. */
export async function resolvePreparationUnionWorkerTarget():Promise<Target>{
 const compiled=new URL('./preparationUnionTask.js',import.meta.url);
 if(await regularFile(compiled))return{filename:compiled};
 const source=new URL('./preparationUnionTask.ts',import.meta.url);
 if(!new URL(import.meta.url).pathname.endsWith('.ts')||!await regularFile(source))throw new PathFinderError('PREPARATION_UNION_WORKER_UNAVAILABLE',503);
 const loader=import.meta.resolve('tsx/esm/api');
 // No inherited --eval/--require/inspection/Vitest executable arguments.
 const program=`(async()=>{const{register}=await import(${JSON.stringify(loader)});register();await import(${JSON.stringify(source.href)});})().catch(()=>{process.exitCode=1;});`;
 return{filename:program,options:{eval:true}};
}

/** Dependency injection is server-internal for pure lifecycle tests, never request input. */
export function createPreparationUnionRunner(dependencies:PreparationUnionWorkerDependencies){
 let occupied=false;
 return async(plan:PreparationPlan,parts:{partId:string;payload:ComputationalSnapshot}[],signal:AbortSignal):Promise<PreparationUnionResult>=>{
  signal.throwIfAborted();if(occupied)throw new PathFinderError('PREPARATION_UNION_BUSY',503);occupied=true;
  let spawned=false;
  try{
   try{checkPreparationUnionInputBytes(plan,parts);}catch{throw new PathFinderError('PREPARATION_UNION_LIMIT',413);}
   const initialRss=dependencies.residentBytes();if(!Number.isFinite(initialRss)||initialRss<0)throw new PathFinderError('PREPARATION_UNION_MEMORY_UNAVAILABLE',503);if(initialRss>=preparationUnionPolicy.rssBytes)throw new PathFinderError('PREPARATION_UNION_MEMORY_LIMIT',413);
   const target=await dependencies.target();signal.throwIfAborted();
   const requestId=randomUUID(),snapshotId=randomUUID();
   const worker=dependencies.spawn(target.filename,{...target.options,execArgv:[],workerData:{schemaVersion:'wfc.pf.preparation-union-task.v1',requestId,snapshotId,plan,parts,storageLockBuffer:dependencies.storageLockBuffer},resourceLimits:{maxOldGenerationSizeMb:preparationUnionPolicy.oldGenerationMiB}});
   spawned=true;const threadId=worker.threadId;
   return await new Promise<PreparationUnionResult>((resolve,reject)=>{
    let settled=false,exited=false,released=false,stopping=false,result:PreparationUnionResult|undefined,messageSeen=false,stopError:Error|undefined;
    let timeout:ReturnType<typeof setTimeout>,rss:ReturnType<typeof setInterval>,joinTimeout:ReturnType<typeof setTimeout>|undefined;
    const cleanup=()=>{clearTimeout(timeout);clearInterval(rss);if(joinTimeout)clearTimeout(joinTimeout);signal.removeEventListener('abort',abort);};
    const release=()=>{if(released)return;released=true;dependencies.releaseStorageOwner(threadId);occupied=false;};
    const settle=(error?:Error)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else if(result)resolve(result);else reject(new PathFinderError('PREPARATION_UNION_PROTOCOL',502));};
    const stop=(error?:Error)=>{
     if(stopping||settled)return;stopping=true;stopError=error;clearTimeout(timeout);clearInterval(rss);
     // A failed join quarantines the lane and its lock until an actual exit is observed.
     joinTimeout=setTimeout(()=>{if(exited){release();settle(stopError);}else settle(new PathFinderError('PREPARATION_UNION_JOIN_UNCONFIRMED',503));},preparationUnionPolicy.joinMilliseconds);
     void worker.terminate().then(()=>{exited=true;release();settle(stopError);},()=>{if(exited){release();settle(stopError);}else settle(new PathFinderError('PREPARATION_UNION_JOIN_UNCONFIRMED',503));});
    };
    const abort=()=>{const error=new DOMException('Preparation validation cancelled.','AbortError');if(stopping&&!settled)stopError=error;else stop(error);};
    worker.on('message',value=>{
     if(settled)return;if(stopping){if(messageSeen)stopError=new PathFinderError('PREPARATION_UNION_PROTOCOL',502);return;}const parsed=preparationUnionMessageSchema.safeParse(value);
     if(messageSeen||!parsed.success||parsed.data.requestId!==requestId){stop(new PathFinderError('PREPARATION_UNION_PROTOCOL',502));return;}messageSeen=true;
     if(parsed.data.type==='error'){stop(new PathFinderError(parsed.data.code,parsed.data.code==='PREPARATION_UNION_LIMIT'?413:409));return;}
     if(parsed.data.result.snapshotId!==snapshotId){stop(new PathFinderError('PREPARATION_UNION_PROTOCOL',502));return;}result=parsed.data.result;stop();
    });
    worker.on('error',()=>{const error=new PathFinderError('PREPARATION_UNION_FAILED',503);if(stopping&&!settled)stopError??=error;else stop(error);});
    worker.on('exit',code=>{exited=true;if(stopping){if(settled)release();return;}release();if(code!==0||!result)settle(new PathFinderError('PREPARATION_UNION_FAILED',503));else settle();});
    timeout=setTimeout(()=>stop(new PathFinderError('PREPARATION_UNION_TIMEOUT',504)),preparationUnionPolicy.milliseconds);
    rss=setInterval(()=>{try{const bytes=dependencies.residentBytes();if(!Number.isFinite(bytes)||bytes<0||bytes>=preparationUnionPolicy.rssBytes)stop(new PathFinderError('PREPARATION_UNION_MEMORY_LIMIT',413));}catch{stop(new PathFinderError('PREPARATION_UNION_MEMORY_UNAVAILABLE',503));}},preparationUnionPolicy.rssIntervalMilliseconds);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
   });
  }finally{if(!spawned)occupied=false;}
 };
}
const run=createPreparationUnionRunner({target:resolvePreparationUnionWorkerTarget,spawn:(filename,options)=>new Worker(filename,options),residentBytes:()=>process.memoryUsage.rss(),storageLockBuffer:preparationStorageLockBuffer,releaseStorageOwner:releasePreparationStorageOwner});
/** RSS is sampled for the WHOLE Node process; 100 ms observations are not an exact peak. */
export const runPreparationUnion=run;
