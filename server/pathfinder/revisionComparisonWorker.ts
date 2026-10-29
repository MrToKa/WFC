import { Worker,type WorkerOptions } from 'node:worker_threads';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PathFinderError } from './errors.js';
import { preparationStorageLockBuffer,releasePreparationStorageOwner } from './preparationStorage.js';
import { revisionComparisonThreadInputSchema,revisionComparisonThreadMessageSchema,revisionComparisonThreadResultSchema,type RevisionComparisonThreadInput,type RevisionComparisonThreadResult } from './revisionComparisonThread.js';

export const revisionComparisonWorkerPolicy=Object.freeze({milliseconds:120000,oldGenerationMiB:512,rssBytes:2*1024**3,rssIntervalMilliseconds:100,joinMilliseconds:10000});
export interface RevisionComparisonWorkerThread{readonly threadId:number;on(event:'message',handler:(message:unknown)=>void):this;on(event:'error',handler:(error:Error)=>void):this;on(event:'exit',handler:(code:number)=>void):this;terminate():Promise<number>}
type Target={filename:URL|string;options?:WorkerOptions};
export interface RevisionComparisonWorkerDependencies{target:()=>Promise<Target>;spawn:(filename:URL|string,options:WorkerOptions)=>RevisionComparisonWorkerThread;residentBytes:()=>number;storageLockBuffer:SharedArrayBuffer;releaseStorageOwner:(threadId:number)=>void}
export type RevisionComparisonWorkerInput=Omit<RevisionComparisonThreadInput,'schemaVersion'|'requestId'|'storageLockBuffer'>;
async function regular(url:URL){try{const s=await fs.lstat(url);return s.isFile()&&!s.isSymbolicLink();}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
export async function resolveRevisionComparisonWorkerTarget():Promise<Target>{
  const compiled=new URL('./revisionComparisonThread.js',import.meta.url);if(await regular(compiled))return{filename:compiled};
  const source=new URL('./revisionComparisonThread.ts',import.meta.url);if(!new URL(import.meta.url).pathname.endsWith('.ts')||!await regular(source))throw new PathFinderError('REVISION_COMPARISON_WORKER_UNAVAILABLE',503);
  const loader=import.meta.resolve('tsx/esm/api');return{filename:`(async()=>{const{register}=await import(${JSON.stringify(loader)});register();await import(${JSON.stringify(source.href)});})().catch(()=>{process.exitCode=1;});`,options:{eval:true}};
}
/** Refs-only fixed executable, measured whole-process RSS and terminate-then-join semantics. */
export function createRevisionComparisonWorker(deps:RevisionComparisonWorkerDependencies){
  let occupied=false;
  return async(raw:RevisionComparisonWorkerInput,signal:AbortSignal):Promise<RevisionComparisonThreadResult>=>{
    signal.throwIfAborted();if(occupied)throw new PathFinderError('REVISION_COMPARISON_WORKER_BUSY',503);occupied=true;let spawned=false;
    try{
      const input=revisionComparisonThreadInputSchema.parse({...raw,schemaVersion:'wfc.pf.revision-comparison-thread.v1',requestId:randomUUID(),storageLockBuffer:deps.storageLockBuffer}),initial=deps.residentBytes();
      if(!Number.isFinite(initial)||initial<0)throw new PathFinderError('REVISION_COMPARISON_MEMORY_UNAVAILABLE',503);if(initial>=revisionComparisonWorkerPolicy.rssBytes)throw new PathFinderError('REVISION_COMPARISON_MEMORY_LIMIT',413);
      const target=await deps.target();signal.throwIfAborted();const worker=deps.spawn(target.filename,{...target.options,execArgv:[],workerData:input,resourceLimits:{maxOldGenerationSizeMb:revisionComparisonWorkerPolicy.oldGenerationMiB}});spawned=true;const threadId=worker.threadId;
      return await new Promise((resolve,reject)=>{
        let settled=false,exited=false,released=false,stopping=false,seen=false,result:RevisionComparisonThreadResult|undefined,stopError:Error|undefined;
        let timeout:ReturnType<typeof setTimeout>,rss:ReturnType<typeof setInterval>,join:ReturnType<typeof setTimeout>|undefined;
        const release=()=>{if(!released){released=true;deps.releaseStorageOwner(threadId);occupied=false;}};
        const cleanup=()=>{clearTimeout(timeout);clearInterval(rss);if(join)clearTimeout(join);signal.removeEventListener('abort',abort);};
        const settle=(error?:Error)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else if(result)resolve(result);else reject(new PathFinderError('REVISION_COMPARISON_WORKER_PROTOCOL',502));};
        const stop=(error?:Error)=>{if(stopping||settled)return;stopping=true;stopError=error;clearTimeout(timeout);clearInterval(rss);
          join=setTimeout(()=>{if(exited){release();settle(stopError);}else settle(new PathFinderError('REVISION_COMPARISON_JOIN_UNCONFIRMED',503));},revisionComparisonWorkerPolicy.joinMilliseconds);
          void worker.terminate().then(()=>{exited=true;release();settle(stopError);},()=>{if(exited){release();settle(stopError);}else settle(new PathFinderError('REVISION_COMPARISON_JOIN_UNCONFIRMED',503));});
        };
        const abort=()=>{const error=new DOMException('Revision comparison cancelled.','AbortError');if(stopping&&!settled)stopError=error;else stop(error);};
        worker.on('message',value=>{
          if(settled)return;if(stopping){if(seen)stopError=new PathFinderError('REVISION_COMPARISON_WORKER_PROTOCOL',502);return;}
          const parsed=revisionComparisonThreadMessageSchema.safeParse(value);
          if(seen||!parsed.success||parsed.data.requestId!==input.requestId){stop(new PathFinderError('REVISION_COMPARISON_WORKER_PROTOCOL',502));return;}seen=true;
          if(parsed.data.type==='error'){stop(new PathFinderError(parsed.data.code,parsed.data.code==='REVISION_COMPARISON_BUILD_LIMIT'?413:409));return;}
          if(parsed.data.result.comparisonId!==input.comparisonId){stop(new PathFinderError('REVISION_COMPARISON_WORKER_PROTOCOL',502));return;}
          result=parsed.data.result;stop();
        });
        worker.on('error',()=>{const error=new PathFinderError('REVISION_COMPARISON_WORKER_FAILED',503);if(stopping&&!settled)stopError??=error;else stop(error);});
        worker.on('exit',code=>{exited=true;if(stopping){if(settled)release();return;}release();if(code||!result)settle(new PathFinderError('REVISION_COMPARISON_WORKER_FAILED',503));else settle();});
        timeout=setTimeout(()=>stop(new PathFinderError('REVISION_COMPARISON_WORKER_TIMEOUT',504)),revisionComparisonWorkerPolicy.milliseconds);
        rss=setInterval(()=>{try{const n=deps.residentBytes();if(!Number.isFinite(n)||n<0||n>=revisionComparisonWorkerPolicy.rssBytes)stop(new PathFinderError('REVISION_COMPARISON_MEMORY_LIMIT',413));}catch{stop(new PathFinderError('REVISION_COMPARISON_MEMORY_UNAVAILABLE',503));}},revisionComparisonWorkerPolicy.rssIntervalMilliseconds);
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      });
    }finally{if(!spawned)occupied=false;}
  };
}
export const runRevisionComparisonWorker=createRevisionComparisonWorker({target:resolveRevisionComparisonWorkerTarget,spawn:(filename,options)=>new Worker(filename,options),residentBytes:()=>process.memoryUsage.rss(),storageLockBuffer:preparationStorageLockBuffer,releaseStorageOwner:releasePreparationStorageOwner});
export const validateRevisionComparisonWorkerResult=(value:unknown)=>revisionComparisonThreadResultSchema.parse(value);
