import type {PoolClient} from 'pg';
import {calculationAvailabilitySchema,notEvaluatedCalculationAvailability,CALCULATION_AVAILABILITY_LIMITS,type CalculationAvailability} from '../../shared/pathfinderCalculationAvailability.js';
import {RECALCULATION_LIMITS} from '../../shared/pathfinderRecalculation.js';
import type {EndpointCurrentScope,EndpointBinding} from '../../shared/pathfinderEndpointBindings.js';
import type {LocationDto} from './contracts.js';
import {readAutomaticEndpointCandidates,type AutomaticEndpointCandidateResult} from './automaticEndpointCandidates.js';
import {automaticEndpointCalculationPointSchema,automaticEndpointContentHash} from './endpointCalculationProvenance.js';
import {PathFinderError} from './errors.js';

export type DisplayEndpointHeads=Map<string,{binding:EndpointBinding;ready:boolean}>;
export type DisplayEndpointAvailabilityInput={projectId:string;current:EndpointCurrentScope|null;locations:LocationDto[];heads:DisplayEndpointHeads;locationIds:string[];deadline:number};
const fail=():never=>{throw new PathFinderError('DISPLAY_ENDPOINT_AVAILABILITY_INTEGRITY',409);};
const budgetCodes=new Map([
  ['ENDPOINT_NEEDED_LOCATION_LIMIT','AVAILABILITY_LOCATION_LIMIT'],
  ['ENDPOINT_NEEDED_LOCATION_BYTES','AVAILABILITY_INPUT_BYTES'],
  ['RECALCULATION_COLLECTION_DEADLINE','AVAILABILITY_DEADLINE'],
]);
const blocked=(status:CalculationAvailability['status'],reasonCode:string,candidateObjectIds:string[]=[]):CalculationAvailability=>calculationAvailabilitySchema.parse({status,pointAvailable:false,source:null,approximate:false,candidateObjectIds,reasonCode,engineeringAccepted:false});
const confirmed=():CalculationAvailability=>calculationAvailabilitySchema.parse({status:'confirmed-ready',pointAvailable:true,source:'confirmed-shared-location',approximate:false,candidateObjectIds:[],reasonCode:null,engineeringAccepted:false});

function projectAutomatic(result:AutomaticEndpointCandidateResult,location:LocationDto,current:EndpointCurrentScope):CalculationAvailability{
  if(!Array.isArray(result.candidateObjectIds))return fail();
  if(result.candidateObjectIds.length>CALCULATION_AVAILABILITY_LIMITS.candidateObjectIds)return notEvaluatedCalculationAvailability('AVAILABILITY_CANDIDATE_LIMIT');
  if(result.status!=='automatic-ready'){
    if(result.point!==null)return fail();
    return blocked(result.status,'AUTOMATIC_ENDPOINT_'+result.status.replaceAll('-','_').toUpperCase(),result.candidateObjectIds);
  }
  const parsed=automaticEndpointCalculationPointSchema.safeParse(result.point);if(!parsed.success)return fail();
  const point=parsed.data,{contentSha256,...body}=point;
  if(contentSha256!==automaticEndpointContentHash(body)||point.locationId!==location.id||point.locationRevision!==location.revision||point.modelVersionId!==current.modelVersionId||point.artifactId!==current.artifactId||point.aggregateId!==current.aggregateId||point.captureFrameId!==current.captureFrameId||point.projectionSha256!==current.projectionSha256||point.traceId!==current.traceId||result.candidateObjectIds.length!==1||result.candidateObjectIds[0]!==point.sourceObjectId)return fail();
  return calculationAvailabilitySchema.parse({status:'automatic-ready',pointAvailable:true,source:'automatic-model-candidate',approximate:true,candidateObjectIds:result.candidateObjectIds,reasonCode:null,engineeringAccepted:false});
}

/** One SELECT-only display evaluation in the caller's authorized coherent transaction.
 * It reuses already validated context/heads and never creates binding authority. */
export async function readDisplayEndpointAvailability(client:PoolClient,input:DisplayEndpointAvailabilityInput):Promise<Map<string,CalculationAvailability>>{
  const locations=new Map(input.locations.map(location=>[location.id,location])),ids=[...new Set(input.locationIds)].sort(),needed=new Set(ids);
  if(ids.some(id=>!locations.has(id)))return fail();
  const baseline=(reason:string)=>new Map(input.locations.map(location=>[location.id,notEvaluatedCalculationAvailability(needed.has(location.id)?reason:'LOCATION_NOT_IN_CABLE_SCOPE')]));
  const withinOutput=(values:Map<string,CalculationAvailability>):boolean=>{
    let bytes=2;for(const [id,value] of values){bytes+=Buffer.byteLength(JSON.stringify([id,value]))+1;if(bytes>RECALCULATION_LIMITS.neededLocationBytes)return false;}return true;
  };
  const notEvaluated=(reason:string):Map<string,CalculationAvailability>=>{
    const values=baseline(reason);if(!withinOutput(values))throw new PathFinderError('DISPLAY_ENDPOINT_AVAILABILITY_RESPONSE_LIMIT',413);return values;
  };
  if(ids.length>RECALCULATION_LIMITS.neededLocations)return notEvaluated('AVAILABILITY_LOCATION_LIMIT');
  if(Date.now()>input.deadline)return notEvaluated('AVAILABILITY_DEADLINE');
  let bytes=0;
  for(const id of ids){if(Date.now()>input.deadline)return notEvaluated('AVAILABILITY_DEADLINE');bytes+=Buffer.byteLength(JSON.stringify({location:locations.get(id),head:input.heads.get(id)??null}));if(bytes>RECALCULATION_LIMITS.neededLocationBytes)return notEvaluated('AVAILABILITY_INPUT_BYTES');}
  const values=baseline('AVAILABILITY_NOT_EVALUATED'),unbound:string[]=[];
  for(const id of ids){
    if(Date.now()>input.deadline)return notEvaluated('AVAILABILITY_DEADLINE');
    const location=locations.get(id)!,head=input.heads.get(id);
    if(head){
      if(head.ready){if(!input.current)return fail();values.set(id,confirmed());}
      else values.set(id,blocked('saved-binding-required','SAVED_BINDING_REQUIRES_CONFIRMATION'));
    }else if(location.binding)values.set(id,blocked('saved-binding-required','LEGACY_BINDING_REQUIRES_CONFIRMATION'));
    else if(!input.current)values.set(id,blocked('preparation-required','CURRENT_PREPARATION_REQUIRED'));
    else if(!input.current.traceId)values.set(id,blocked('preparation-required','CURRENT_GEOMETRY_TRACE_REQUIRED'));
    else unbound.push(id);
  }
  if(unbound.length){
    const unboundIds=new Set(unbound);
    let automatic:Map<string,AutomaticEndpointCandidateResult>;
    try{automatic=await readAutomaticEndpointCandidates(client,{projectId:input.projectId,current:input.current!,locationIds:unbound,deadline:input.deadline});}
    catch(error){const code=error instanceof PathFinderError?budgetCodes.get(error.code):undefined;if(code)return notEvaluated(code);throw error;}
    if(automatic.size!==unbound.length||[...automatic.keys()].some(id=>!unboundIds.has(id)))return fail();
    for(const id of unbound){const result=automatic.get(id);if(!result)return fail();values.set(id,projectAutomatic(result,locations.get(id)!,input.current!));}
  }
  const fits=withinOutput(values);
  if(Date.now()>input.deadline)return notEvaluated('AVAILABILITY_DEADLINE');
  return fits?values:notEvaluated('AVAILABILITY_OUTPUT_BYTES');
}
