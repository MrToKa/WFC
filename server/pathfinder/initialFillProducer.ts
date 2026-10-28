import {setTimeout as delay} from 'node:timers/promises';
import type {InitialFillAttempts} from './initialFillAttempts.js';
import type {InitialFillWriter} from './initialFillWriter.js';
import {PathFinderError} from './errors.js';

/** Separate conditional-write service; calculation-only producers never invoke this writer. */
export function createInitialFillProducer(attempts:InitialFillAttempts,writer:InitialFillWriter){
  const controller=new AbortController();let loop:Promise<void>|undefined,ticking:Promise<void>|undefined,lastErrorCode:string|null=null;
  const tick=()=>{
    if(controller.signal.aborted)return Promise.resolve();if(ticking)return ticking;
    ticking=(async()=>{
      await attempts.discover(controller.signal);
      for(let index=0;index<5&&!controller.signal.aborted;index++){
        const claim=await attempts.claim(controller.signal);if(!claim)return;
        const deadline=AbortSignal.timeout(45000),signal=AbortSignal.any([controller.signal,deadline]);
        try{const result=await writer.apply(claim.projectId,claim.request,client=>attempts.fence(client,claim),signal);
          await attempts.finish(claim,result);lastErrorCode=null;
        }catch(error){
          const code=error instanceof PathFinderError?error.code:signal.aborted?'INITIAL_FILL_INTERRUPTED':'INITIAL_FILL_WRITE_REFUSED';lastErrorCode=code;
          const unknown=signal.aborted||['INITIAL_FILL_COMMIT_OUTCOME_UNKNOWN','ENDPOINT_COMMIT_OUTCOME_UNKNOWN','SCHEDULER_COMMIT_OUTCOME_UNKNOWN','ENDPOINT_DATABASE_BUSY','SCHEDULER_DATABASE_BUSY'].includes(code);
          const status=unknown?'unknown':/EXPIRED|REVOKED|ADMIN_REQUIRED|RESTORE_FENCED/.test(code)?'authority-expired':/STALE|SCOPE_CHANGED|SUPERSEDED|CABLE_WRITE_CONFLICT/.test(code)?'stale':'refused';
          await attempts.finish(claim,{status,receiptId:null,code});
        }
      }
    })().catch(error=>{if(!controller.signal.aborted)lastErrorCode=error instanceof PathFinderError?error.code:'INITIAL_FILL_PRODUCER_UNAVAILABLE';}).finally(()=>{ticking=undefined;});
    return ticking;
  };
  return {tick,get lastErrorCode(){return lastErrorCode;},start(){if(loop)return;loop=(async()=>{while(!controller.signal.aborted){await tick();await delay(1000,undefined,{signal:controller.signal}).catch(()=>undefined);}})();},
    async stop(){controller.abort();await loop;await ticking;}};
}
