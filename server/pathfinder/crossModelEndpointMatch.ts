import {modelLocationMatchCandidateSchema,type ModelLocationMatchAssign} from '../../shared/pathfinderModelLocationMatch.js';
import {endpointPointSchema,normalizeEndpointLocation,type EndpointBinding} from '../../shared/pathfinderEndpointBindings.js';
import {groupModelLocationMatchCandidates,type ModelLocationMatchCandidateGroup} from './modelLocationMatchCandidates.js';
export const CROSS_MODEL_ENDPOINT_TOLERANCE_METRES=0.25;
type Previous=Pick<EndpointBinding,'status'|'modelVersionId'|'pointProjectMetres'|'locationRevision'> & Partial<Pick<EndpointBinding,'derivation'>>;
export type CrossModelEndpointMatch={accepted:true;candidate:ModelLocationMatchCandidateGroup;distanceMetres:number}|{accepted:false;reasonCode:string};
/** Proximity corroborates identity. It never selects an arbitrary nearby object. */
export function evaluateCrossModelEndpointMatch(input:{previous:Previous|null;locationRevision:string;currentModelVersionId:string;logicalName:string;candidates:ModelLocationMatchAssign['scan']['candidates']}):CrossModelEndpointMatch{
 const old=input.previous;
 if(!old||old.status!=='confirmed'||old.locationRevision!==input.locationRevision)return {accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_SAVED_BINDING_REQUIRED'};
 if(old.modelVersionId===input.currentModelVersionId)return {accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_NOT_REQUIRED'};
 if(!endpointPointSchema.safeParse(old.pointProjectMetres).success)return {accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_POINT_UNAVAILABLE'};
 const name=normalizeEndpointLocation(input.logicalName);if(!name)return {accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_NAME_REQUIRED'};
 if(input.candidates.some(c=>!modelLocationMatchCandidateSchema.safeParse(c).success))return {accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_POINT_UNAVAILABLE'};
 let groups:ModelLocationMatchCandidateGroup[];try{groups=groupModelLocationMatchCandidates(input.candidates,name);}catch{return {accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_AMBIGUOUS'};}
 if(groups.length!==1)return {accepted:false,reasonCode:groups.length?'MODEL_LOCATION_CROSS_MODEL_AMBIGUOUS':'MODEL_LOCATION_CROSS_MODEL_MISSING'};
 const candidate=groups[0];
 if(candidate.objectId<=0||!candidate.bounds||!candidate.bottomCentre)return {accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_POINT_UNAVAILABLE'};
 // Corroborate like-for-like approximate anchors. Acceptance authorizes only
 // the normal NEW-model bottom observation, never an unchecked new centre.
 const observed=old.derivation==='matched-model-centre-fallback.v1'
   ? candidate.bounds.minimum.map((p,i)=>(p+candidate.bounds!.maximum[i])/2) : candidate.bottomCentre;
 const distanceMetres=Math.hypot(...observed.map((p,i)=>p-old.pointProjectMetres[i]));
 if(!Number.isFinite(distanceMetres)||distanceMetres>CROSS_MODEL_ENDPOINT_TOLERANCE_METRES)return {accepted:false,reasonCode:'MODEL_LOCATION_CROSS_MODEL_DISTANCE_EXCEEDED'};
 return {accepted:true,candidate,distanceMetres};
}
