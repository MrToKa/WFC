// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {DIRECT_SECONDARY_POLICY,type DirectSecondaryDecision} from '../../shared/pathfinderDirectSecondary.js';
import {syntheticEngineIdentity} from './calculationFixtures.js';
import {directSecondaryPolicyForScope,requireDirectSecondaryStrategy,type DirectSecondaryCalculationScope} from './directSecondaryStrategy.js';
import type {EngineResponse} from './jobContracts.js';

function scope(policy=true):DirectSecondaryCalculationScope{
  const engineIdentity=syntheticEngineIdentity();
  engineIdentity.policyVersions={...engineIdentity.policyVersions,...(policy?{directSecondary:DIRECT_SECONDARY_POLICY}:{})};
  if(!policy)delete engineIdentity.policyVersions.directSecondary;
  return{category:'Instrumentation',fromPoint:[0,0,0],toPoint:[3,0,0],engineIdentity};
}
function result():Extract<EngineResponse,{schemaVersion:'pathfinder.model.response.v2'}>{
  const directSecondary:DirectSecondaryDecision={schemaVersion:'wfc.pf.direct-secondary.v1',policyVersion:DIRECT_SECONDARY_POLICY,coordinateFrame:'canonical-world-metres',
    mode:'direct-secondary',fromPoint:[0,0,0],toPoint:[3,0,0],distanceMeters:3,nearestFromMeters:10,nearestToMeters:4,eligibleTrays:2,comparison:'both'};
  return{schemaVersion:'pathfinder.model.response.v2',requestId:'11111111-1111-4111-8111-111111111111',status:'calculated',message:'Synthetic direct.',engineeringAccepted:false,
    effectiveCategory:'Control',directSecondary,route:{success:true,message:'Synthetic direct.',routeText:'/SECONDARY',routeCodes:['/SECONDARY'],segmentIds:[],pathPoints:[{x:0,y:0,z:0},{x:3,y:0,z:0}],
      lengthMeters:3,fromDistanceMeters:0,toDistanceMeters:0,fromRequiresSecondary:false,toRequiresSecondary:false,connectionGapCount:0,connectionGapLengthMeters:0}};
}
describe('frozen direct SECONDARY dispatch strategy evidence',()=>{
  it.each(['LV','Control','Instrumentation'])('opts in %s only with the explicit frozen engine policy',category=>{
    expect(directSecondaryPolicyForScope({...scope(),category})).toBe(DIRECT_SECONDARY_POLICY);
    expect(directSecondaryPolicyForScope({...scope(false),category})).toBeNull();
  });
  it.each(['MV','Unknown',null])('does not opt excluded category %s in',category=>expect(directSecondaryPolicyForScope({...scope(),category})).toBeNull());
  it('does not invent strategy authority without an engine identity',()=>expect(directSecondaryPolicyForScope({category:'Control'})).toBeNull());
  it('binds a valid C# decision to exact immutable endpoints/category without changing it',()=>{
    const response=result(),before=JSON.stringify(response);expect(requireDirectSecondaryStrategy(response,scope())).toEqual(response.directSecondary);expect(JSON.stringify(response)).toBe(before);
  });
  it('accepts reversed preview evidence only for the exact swapped request endpoints',()=>{
    const response=result();if(response.schemaVersion!=='pathfinder.model.response.v2')throw new Error('fixture');
    response.directSecondary={...response.directSecondary,fromPoint:[3,0,0],toPoint:[0,0,0]};response.route!.pathPoints.reverse();
    expect(()=>requireDirectSecondaryStrategy(response,{...scope(),reverse:true})).not.toThrow();
    expect(()=>requireDirectSecondaryStrategy(response,scope())).toThrowError(expect.objectContaining({code:'ENGINE_ROUTING_STRATEGY_INVALID'}));
  });
  it.each(['from','to','category','frame','decision','route','segment','gap','legacy-secondary'] as const)('refuses incompatible %s evidence',kind=>{
    const response=result();if(response.schemaVersion!=='pathfinder.model.response.v2')throw new Error('fixture');
    if(kind==='from')response.directSecondary.fromPoint=[0,1,0];if(kind==='to')response.directSecondary.toPoint=[4,0,0];
    if(kind==='category')response.effectiveCategory='LV';if(kind==='frame')Object.assign(response.directSecondary,{coordinateFrame:'viewer-local'});
    if(kind==='decision')Object.assign(response.directSecondary,{comparison:'from-approach'});if(kind==='route')response.route!.lengthMeters=4;
    if(kind==='segment')response.route!.segmentIds=['imaginary'];if(kind==='gap')response.route!.connectionGapLengthMeters=1;
    if(kind==='legacy-secondary')response.route!.toRequiresSecondary=true;
    expect(()=>requireDirectSecondaryStrategy(response,scope())).toThrowError(expect.objectContaining({code:'ENGINE_ROUTING_STRATEGY_INVALID'}));
  });
  it('allows a design-only response without a route only when its explicit decision still matches',()=>{
    const response=result();delete response.route;expect(()=>requireDirectSecondaryStrategy(response,scope())).not.toThrow();
  });
  it('retains honest unavailable eligible geometry as a no-path network fallback, never a direct shortcut',()=>{
    const response=result();response.status='no_path';delete response.route;
    response.directSecondary={...response.directSecondary,mode:'tray-network',nearestFromMeters:null,nearestToMeters:null,eligibleTrays:0,comparison:null};
    expect(requireDirectSecondaryStrategy(response,scope())?.mode).toBe('tray-network');
    response.directSecondary.mode='direct-secondary';expect(()=>requireDirectSecondaryStrategy(response,scope())).toThrowError(expect.objectContaining({code:'ENGINE_ROUTING_STRATEGY_INVALID'}));
  });
  it.each(['invalid_request','settings_required','category_required','deadline_exceeded','resource_limit'] as const)('retains honest predecision %s failures',status=>{
    const response:EngineResponse={schemaVersion:'pathfinder.model.response.v1',requestId:result().requestId,status,message:'Before decision.',engineeringAccepted:false};
    expect(requireDirectSecondaryStrategy(response,scope())).toBeNull();
  });
  it.each(['calculated','no_path'] as const)('rejects a silent legacy %s result after explicit opt-in',status=>{
    const response:EngineResponse={schemaVersion:'pathfinder.model.response.v1',requestId:result().requestId,status,message:'Legacy.',engineeringAccepted:false};
    expect(()=>requireDirectSecondaryStrategy(response,scope())).toThrowError(expect.objectContaining({code:'ENGINE_ROUTING_STRATEGY_INVALID'}));
    expect(requireDirectSecondaryStrategy(response,scope(false))).toBeNull();
  });
  it('does not reinterpret a direct decision under a retained historical identity or MV category',()=>{
    for(const old of [scope(false),{...scope(),category:'MV'}])expect(()=>requireDirectSecondaryStrategy(result(),old)).toThrowError(expect.objectContaining({code:'ENGINE_ROUTING_STRATEGY_INVALID'}));
  });
});
