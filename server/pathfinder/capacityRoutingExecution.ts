import { randomUUID } from 'node:crypto';
import { engineResponseSchema, trayCapacityResultSchema, type EngineResponse } from './jobContracts.js';
import type { EngineInvocation } from './engineSession.js';
import type { TrayCapacityRoutingContext } from './trayCapacityRouting.js';
import type { z } from 'zod';

export type NativeRoutingQuery=NonNullable<z.infer<typeof trayCapacityResultSchema>['query']>;
export function withNativeRoutingQuery(request:EngineInvocation,query:NativeRoutingQuery):EngineInvocation{
  const {routeCostMultipliers:_weights,excludedRouteCodes:_excluded,...base}=request;
  return {...base,timeoutMilliseconds:query.timeoutMilliseconds,
    ...(query.routeCostMultipliers.length?{routeCostMultipliers:query.routeCostMultipliers}:{}),
    ...(query.excludedRouteCodes.length?{excludedRouteCodes:query.excludedRouteCodes}:{})};
}

export const CAPACITY_SEARCH_LIMITS=Object.freeze({attempts:16,excludedRouteCodes:128});
const nativeCode=(value:string)=>/^\/[A-Z0-9][A-Z0-9_.-]*$/.test(value)&&value.length<=256;

/** This pass checks placement, never geometry or length. Every alternate path,
 * barrier check and design length still comes from the ordinary native engine. */
export async function executeCapacityRouting(input:{request:EngineInvocation;context:TrayCapacityRoutingContext;
  execute:(request:EngineInvocation,signal:AbortSignal)=>Promise<EngineResponse>;signal:AbortSignal;
  validate:(response:EngineResponse)=>void;initialResponse?:EngineResponse;
}):Promise<{response:EngineResponse;request:EngineInvocation}> {
  const {context,signal}=input,restricted=context.policy.enabled,started=performance.now(),excluded=new Set<string>(
    Array.isArray(input.request.excludedRouteCodes)?input.request.excludedRouteCodes as string[]:[]);
  let request=input.request,response:EngineResponse|undefined,assessment=context.evaluate([]),attempts=0;
  const finish=(value:EngineResponse,outcome:'balanced'|'fits'|'rerouted'|'unavailable'|'no-capacity'|'no-path'|'search-limit',message?:string)=>({
    request,response:engineResponseSchema.parse({...value,...(message?{message}:{}),trayCapacity:trayCapacityResultSchema.parse({
      ...assessment,restrictionEnabled:restricted,outcome,attempts,excludedRouteCodes:[...excluded].sort(),query:{
        timeoutMilliseconds:request.timeoutMilliseconds,excludedRouteCodes:[...excluded].sort(),
        routeCostMultipliers:Array.isArray(request.routeCostMultipliers)?request.routeCostMultipliers:[]}})})});
  const unavailable=()=>{
    if(!response)throw new Error('Capacity search requires a native observation.');
    const message='The capacity search limit was reached. No route was assigned; other cables continue calculating.';
    if(response.schemaVersion==='pathfinder.model.response.v3'){
      const b=response.barriers;
      return finish({schemaVersion:response.schemaVersion,requestId:response.requestId,status:'resource_limit',engineeringAccepted:false,message,
        barriers:{...b,proof:null,directSecondary:null,connectors:{from:null,to:null},qualification:null,
          diagnostics:{status:'unavailable',reasonCode:'TRAY_CAPACITY_SEARCH_LIMIT',searchComplete:false,candidatesTruncated:true,
            pairAttempts:0,collisionQueries:0,work:'0',plannerAttempts:0,straightPairAttempts:0,localEdgeChecks:0,localPhaseUsed:false,straightPhaseTruncated:false}}},'search-limit');
    }
    return finish({schemaVersion:'pathfinder.model.response.v1',requestId:response.requestId,status:'resource_limit',engineeringAccepted:false,message},'search-limit');
  };
  while(attempts<CAPACITY_SEARCH_LIMITS.attempts){
    signal.throwIfAborted();
    response=attempts===0&&input.initialResponse?input.initialResponse:await input.execute(request,signal);
    input.validate(response);attempts++;
    if(response.status!=='calculated'||!response.route?.success){
      return finish(response,restricted&&excluded.size?'no-capacity':'no-path',restricted&&excluded.size&&response.status==='no_path'
        ?'No alternative route meets the project minimum free space with the 3 percentage point tolerance. This cable remains unrouted; other cables continue calculating.':undefined);
    }
    assessment=context.evaluate(response.route.routeCodes);
    if(!restricted||!assessment.blockedRouteCodes.length){
      const unknown=assessment.unavailableRouteCodes.length>0||assessment.policyIssue!==undefined;
      return finish(response,unknown?'unavailable':!restricted?'balanced':excluded.size?'rerouted':'fits',unknown
        ?response.message+' Tray capacity could not be verified for all route sections; check the tray dimensions and cable data.':undefined);
    }
    for(const code of assessment.blockedRouteCodes){if(!nativeCode(code))return unavailable();excluded.add(code);}
    const remaining=Math.floor(input.request.timeoutMilliseconds-(performance.now()-started));
    if(excluded.size>CAPACITY_SEARCH_LIMITS.excludedRouteCodes||remaining<100||attempts>=CAPACITY_SEARCH_LIMITS.attempts)return unavailable();
    request={...input.request,requestId:randomUUID(),timeoutMilliseconds:remaining,excludedRouteCodes:[...excluded].sort()};
  }
  return unavailable();
}

/** Finite hints locate an already verified native computation for endpoint copies.
 * The current complete placement observation is checked again before accepting it. */
const exclusionHints=new Map<string,{codes:string[];milliseconds:number;expires:number}>();
export function capacityExclusionHint(key:string):{codes:string[];milliseconds:number}|null{
  const entry=exclusionHints.get(key);if(!entry||entry.expires<Date.now()){exclusionHints.delete(key);return null;}
  return {codes:[...entry.codes],milliseconds:entry.milliseconds};
}
export function rememberCapacityExclusions(key:string,codes:string[],milliseconds:number):void{
  exclusionHints.delete(key);while(exclusionHints.size>=16)exclusionHints.delete(exclusionHints.keys().next().value!);
  if(codes.length&&codes.length<=4096)exclusionHints.set(key,{codes:[...codes],milliseconds,expires:Date.now()+300000});
}
