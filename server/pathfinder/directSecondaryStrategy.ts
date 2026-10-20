import { DIRECT_SECONDARY_POLICY, directSecondaryDecisionSchema, directSecondaryRouteIssue, type DirectSecondaryDecision } from '../../shared/pathfinderDirectSecondary.js';
import type { EngineIdentity } from '../../shared/pathfinderEngineIdentity.js';
import type { EngineResponse } from './jobContracts.js';
import { PathFinderError } from './errors.js';

export type DirectSecondaryCalculationScope = { category:string|null;fromPoint:[number,number,number];toPoint:[number,number,number];engineIdentity?:EngineIdentity|null;reverse?:boolean };
/** The admitted implementation chooses the strategy; route text and mutable UI never do. */
export function directSecondaryPolicyForScope(scope:Pick<DirectSecondaryCalculationScope,'category'|'engineIdentity'>):typeof DIRECT_SECONDARY_POLICY|null {
  return ['LV','Control','Instrumentation'].includes(scope.category??'')&&scope.engineIdentity
    &&'directSecondary' in scope.engineIdentity.policyVersions&&scope.engineIdentity.policyVersions.directSecondary===DIRECT_SECONDARY_POLICY
    ?DIRECT_SECONDARY_POLICY:null;
}
/** C# alone computes D/F/T. This guard binds its recorded evidence to the exact immutable request. */
export function requireDirectSecondaryStrategy(response:EngineResponse,scope:DirectSecondaryCalculationScope):DirectSecondaryDecision|null {
  const policy=directSecondaryPolicyForScope(scope),hasDecision='directSecondary' in response&&response.directSecondary!==undefined;
  if(!policy){
    if(response.schemaVersion!=='pathfinder.model.response.v1'||hasDecision)throw new PathFinderError('ENGINE_ROUTING_STRATEGY_INVALID',502,'The calculation returned a strategy outside its immutable admitted inputs.');
    return null;
  }
  // Boundary/settings/category failures can occur before truthful nearest geometry exists.
  if(!['calculated','no_path'].includes(response.status)&&response.schemaVersion!=='pathfinder.model.response.v2'&&!hasDecision)return null;
  const parsed=directSecondaryDecisionSchema.safeParse('directSecondary' in response?response.directSecondary:undefined);
  const category=scope.category==='Instrumentation'?'Control':scope.category,from=scope.reverse?scope.toPoint:scope.fromPoint,to=scope.reverse?scope.fromPoint:scope.toPoint;
  if(response.schemaVersion!=='pathfinder.model.response.v2'||!parsed.success||response.effectiveCategory!==category
    ||!parsed.data.fromPoint.every((number,index)=>number===from[index])||!parsed.data.toPoint.every((number,index)=>number===to[index]))
    throw new PathFinderError('ENGINE_ROUTING_STRATEGY_INVALID',502,'The direct SECONDARY decision is missing or does not match the immutable endpoints and category.');
  if(response.route&&directSecondaryRouteIssue(parsed.data,{...response.route,points:response.route.pathPoints.map(value=>[value.x,value.y,value.z] as [number,number,number])}))
    throw new PathFinderError('ENGINE_ROUTING_STRATEGY_INVALID',502,'The direct SECONDARY geometry does not match its immutable decision.');
  return parsed.data;
}
