import { setTimeout as delay } from 'node:timers/promises';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';
import { PathFinderError } from './errors.js';
import type { RecalculationRepository } from './recalculationRepository.js';

/** Independent of the engine queue; authority and atomic admission remain in the repository. */
export function createRecalculationProducer(repository: Pick<RecalculationRepository,'claimNext'|'enrollClaim'>,options:{onError?:(code:string)=>void;beforeTick?:(signal:AbortSignal)=>Promise<void>;pollMilliseconds?:number}={}){
  const milliseconds=options.pollMilliseconds??1000;if(!Number.isSafeInteger(milliseconds)||milliseconds<250||milliseconds>15000)throw new Error('Invalid recalculation poll bound.');
  const controller=new AbortController();let loop:Promise<void>|undefined,ticking:Promise<void>|undefined,lastErrorCode:string|null=null;
  async function runTick():Promise<void>{
    try{await options.beforeTick?.(controller.signal);}catch(error){if(controller.signal.aborted)return;lastErrorCode=error instanceof PathFinderError?error.code:'RECALCULATION_PRODUCER_UNAVAILABLE';try{options.onError?.(lastErrorCode);}catch{lastErrorCode='RECALCULATION_OBSERVER_FAILED';}return;}
    lastErrorCode=null;
    for(let index=0;index<RECALCULATION_LIMITS.producerProjectsPerTick&&!controller.signal.aborted;index++){
      try{const claim=await repository.claimNext(controller.signal);if(!claim)return;await repository.enrollClaim(claim,controller.signal);}
      catch(error){if(controller.signal.aborted)return;lastErrorCode=error instanceof PathFinderError?error.code:'RECALCULATION_PRODUCER_UNAVAILABLE';try{options.onError?.(lastErrorCode);}catch{lastErrorCode='RECALCULATION_OBSERVER_FAILED';}}
    }
  }
  return {
    get lastErrorCode():string|null{return lastErrorCode;},
    tick():Promise<void>{if(controller.signal.aborted)return Promise.resolve();if(ticking)return ticking;ticking=runTick().finally(()=>{ticking=undefined;});return ticking;},
    start():void{if(loop||controller.signal.aborted)return;loop=(async()=>{while(!controller.signal.aborted){await this.tick();await delay(milliseconds,undefined,{signal:controller.signal}).catch(()=>undefined);}})();},
    async stop():Promise<void>{controller.abort();await ticking;await loop;},
  };
}
