// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {ENGINE_IDENTITY_POLICY_VERSIONS,ENGINE_IDENTITY_VERSION} from '../../shared/pathfinderEngineIdentity.js';
import {hash,verifiedDesignOnlyChange} from './dependencies.js';
import {defaultOptions,type CurrentDependencySnapshot,type EngineResponse} from './jobContracts.js';
import {buildCableEngineRequest,mergeRetainedGeometryResponse,readRetainedDesignGeometry,requireCableEngineStrategy} from './worker.js';
import {DIRECT_SECONDARY_POLICY,type DirectSecondaryDecision} from '../../shared/pathfinderDirectSecondary.js';
import type {EngineIdentity} from '../../shared/pathfinderEngineIdentity.js';

const id=(n:number)=>`ed000000-0000-4000-a000-${String(n).padStart(12,'0')}`;
/** Synthetic frozen inputs/results test selection only; no engine or database runs here. */
function fixture(direct=false):CurrentDependencySnapshot{
  const {numeric,routing,fitting,projection,categoryMapping}=ENGINE_IDENTITY_POLICY_VERSIONS;
  const policyVersions:EngineIdentity['policyVersions']={numeric,routing,fitting,projection,categoryMapping,...(direct?{directSecondary:DIRECT_SECONDARY_POLICY}:{})};
  const body={schemaVersion:'wfc.pf.engine-identity.v1' as const,version:ENGINE_IDENTITY_VERSION,runnerSha256:'1'.repeat(64),modelModuleSha256:'2'.repeat(64),coreModuleSha256:'3'.repeat(64),adapterModuleSha256:'4'.repeat(64),derivationSha256:'5'.repeat(64),policyVersions};
  const endpoint=(n:number)=>({locationId:id(n),locationRevision:'2',bindingRevision:'3',point:[1,2,3] as [number,number,number],bindingId:id(n+10),bindingContentSha256:'b'.repeat(64),mode:'fixed-world' as const,captureFrameId:id(5),qualifiedProjectFrameId:null,aggregateId:id(4),projectionSha256:'d'.repeat(64),sourceObjectRevisionId:null,migrationDecisionId:null});
  return{schemaVersion:'pathfinder.dependencies.v5',projectId:id(1),cableId:id(8),cableWriteRevision:'4',cableInputs:{fromLocation:'From',toLocation:'To',mto:'Instrumentation',cableTypeId:id(9)},registryRevision:'7',routing:{catalogRevision:'2',routingContentSha256:'e'.repeat(64),routingPolicyRevision:'3',routingPolicySha256:'f'.repeat(64)},model:{id:id(2),selectionRevision:'1',contentFingerprint:'c'.repeat(64)},artifact:{id:id(3),sha256:'d'.repeat(64)},preparation:{aggregateId:id(4),geometryRevision:'2',captureFrameId:id(5),projectionSha256:'d'.repeat(64)},comparison:null,settings:{revision:'3',connectionGap:'1',secondaryTrayLength:'7',endConnectionLength:'5',additionalBendingPercent:'10'},options:{...defaultOptions,connectionToleranceMeters:1},from:endpoint(6),to:endpoint(7),engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1',engineIdentity:{...body,contentSha256:hash(body)}};
}
const allowances=(before:CurrentDependencySnapshot):CurrentDependencySnapshot=>({...structuredClone(before),settings:{...before.settings,revision:'4',additionalBendingPercent:'11'}});
const response=():EngineResponse=>({schemaVersion:'pathfinder.model.response.v1',requestId:id(50),status:'calculated',message:'Synthetic selection fixture.',engineeringAccepted:false,effectiveCategory:'Control',prepared:{warnings:['Retain exact synthetic diagnostics.']},route:{success:true,message:'Synthetic route.',routeText:'/T1',routeCodes:['/T1'],segmentIds:['synthetic-segment'],pathPoints:[{x:0,y:0,z:0},{x:2,y:0,z:0}],lengthMeters:2,fromDistanceMeters:0,toDistanceMeters:0,fromRequiresSecondary:false,toRequiresSecondary:false,connectionGapCount:0,connectionGapLengthMeters:0}});
function database(row?:{status:string;dependencies:CurrentDependencySnapshot;result:EngineResponse|null}){
  const query=vi.fn(async(_sql:string,_values?:unknown[])=>({rows:row?[row]:[]}));
  return{query,client:{query} as unknown as Pick<PoolClient,'query'>};
}
function directFixture(){
  const dependencies=fixture(true);dependencies.from.point=[0,0,0];dependencies.to.point=[3,0,0];
  const directSecondary:DirectSecondaryDecision={schemaVersion:'wfc.pf.direct-secondary.v1',policyVersion:DIRECT_SECONDARY_POLICY,coordinateFrame:'canonical-world-metres',
    mode:'direct-secondary',fromPoint:[0,0,0],toPoint:[3,0,0],distanceMeters:3,nearestFromMeters:4,nearestToMeters:5,eligibleTrays:2,comparison:'both'};
  const result:Extract<EngineResponse,{schemaVersion:'pathfinder.model.response.v2'}>={...response(),status:'calculated',schemaVersion:'pathfinder.model.response.v2',directSecondary,
    route:{...response().route!,routeText:'/SECONDARY',routeCodes:['/SECONDARY'],segmentIds:[],pathPoints:[{x:0,y:0,z:0},{x:3,y:0,z:0}],lengthMeters:3}};
  return{dependencies,result};
}

describe('latest-proposal-only retained design geometry (mocked SQL, real reuse predicate)',()=>{
  it.each(['secondaryTrayLength','endConnectionLength','additionalBendingPercent'] as const)('retains direct geometry and its explicit decision during a %s-only change without substituting S or gaps',async field=>{
    const {dependencies:previous,result}=directFixture(),current=structuredClone(previous);current.settings={...current.settings,revision:'4',[field]:'12'};
    const db=database({status:'calculated',dependencies:previous,result}),retained=await readRetainedDesignGeometry(db.client,current.projectId,current.cableId,current);
    expect(retained).toBe(result);const request=buildCableEngineRequest(current,id(51),60000,retained);
    expect(request).toMatchObject({operation:'design',directSecondaryPolicy:DIRECT_SECONDARY_POLICY,category:'Instrumentation',
      route:{lengthMeters:3,fromDistanceMeters:0,toDistanceMeters:0,fromRequiresSecondary:false,toRequiresSecondary:false,directSecondary:result.directSecondary},
      projectSettings:{revision:'4',secondaryTrayLength:current.settings.secondaryTrayLength,endConnectionLength:current.settings.endConnectionLength,additionalBendingPercent:current.settings.additionalBendingPercent}});
    expect(request.route).not.toHaveProperty('connectionGapLengthMeters');expect(request).not.toHaveProperty('from');
    const fresh={...result,requestId:id(51),route:undefined,design:{lengthBeforePercentageMeters:'8',unroundedLengthMeters:'8.8',designLengthMeters:'9'}};
    requireCableEngineStrategy(fresh,current);const merged=mergeRetainedGeometryResponse(fresh,result,'Instrumentation');
    expect(merged.route).toBe(result.route);expect(merged.schemaVersion).toBe('pathfinder.model.response.v2');
    expect('directSecondary' in merged?merged.directSecondary:null).toEqual(result.directSecondary);expect(merged.design).toBe(fresh.design);
  });
  it('keeps legacy requests absent-policy and deliberately opts only new eligible frozen calculations in',()=>{
    const legacy=fixture(),current=directFixture().dependencies;
    expect(buildCableEngineRequest(legacy,id(51),60000)).not.toHaveProperty('directSecondaryPolicy');
    expect(buildCableEngineRequest(current,id(51),60000)).toMatchObject({operation:'calculate',directSecondaryPolicy:DIRECT_SECONDARY_POLICY,from:{x:0,y:0,z:0},to:{x:3,y:0,z:0}});
    current.cableInputs.mto='MV';expect(buildCableEngineRequest(current,id(51),60000)).not.toHaveProperty('directSecondaryPolicy');
    expect(buildCableEngineRequest(legacy,id(51),60000,response())).not.toHaveProperty('category');
  });
  it('retains an explicit tray-network fallback decision and the original legacy SECONDARY approach flags',async()=>{
    const {dependencies:previous,result}=directFixture();result.directSecondary={...result.directSecondary,mode:'tray-network',nearestFromMeters:1,nearestToMeters:2,comparison:null};
    result.route={...result.route!,routeText:'/T1/SECONDARY',routeCodes:['/T1','/SECONDARY'],segmentIds:['synthetic-tray'],lengthMeters:8,fromDistanceMeters:1,toDistanceMeters:2,
      toRequiresSecondary:true,pathPoints:[{x:0,y:0,z:0},{x:3,y:0,z:0}]};
    const current=allowances(previous),db=database({status:'calculated',dependencies:previous,result});
    expect(await readRetainedDesignGeometry(db.client,current.projectId,current.cableId,current)).toBe(result);
    expect(buildCableEngineRequest(current,id(51),60000,result)).toMatchObject({operation:'design',directSecondaryPolicy:DIRECT_SECONDARY_POLICY,
      route:{lengthMeters:8,toRequiresSecondary:true,toDistanceMeters:2,directSecondary:{mode:'tray-network',comparison:null}}});
    const merged=mergeRetainedGeometryResponse({...result,route:undefined},result,'Instrumentation');expect(merged.route).toBe(result.route);
  });
  it.each(['missing-decision','wrong-points','wrong-category','wrong-route','missing-policy'] as const)('disables direct retained reuse when %s is incompatible',async kind=>{
    const {dependencies:previous,result}=directFixture(),current=allowances(previous);
    let retained:EngineResponse=result;
    if(kind==='missing-decision')retained={...response(),route:result.route};
    if(kind==='wrong-points')result.directSecondary={...result.directSecondary,fromPoint:[1,0,0]};
    if(kind==='wrong-category')result.effectiveCategory='LV';if(kind==='wrong-route')result.route!.connectionGapCount=1;
    if(kind==='missing-policy'){delete current.engineIdentity.policyVersions.directSecondary;delete previous.engineIdentity.policyVersions.directSecondary;}
    const db=database({status:'calculated',dependencies:previous,result:retained});
    expect(await readRetainedDesignGeometry(db.client,current.projectId,current.cableId,current)).toBeUndefined();
    expect(()=>buildCableEngineRequest(current,id(51),60000,retained)).toThrowError(expect.objectContaining({code:'ENGINE_RETAINED_GEOMETRY_INVALID'}));
  });
  it('refuses a changed direct design decision instead of merging a different strategy onto the retained route',()=>{
    const {result}=directFixture(),changed={...result,directSecondary:{...result.directSecondary,nearestToMeters:6},route:undefined};
    expect(()=>mergeRetainedGeometryResponse(changed,result,'Instrumentation')).toThrowError(expect.objectContaining({code:'ENGINE_RETAINED_GEOMETRY_INVALID'}));
    expect(()=>mergeRetainedGeometryResponse({...changed,directSecondary:result.directSecondary,effectiveCategory:'LV'},result,'Instrumentation')).toThrowError(expect.objectContaining({code:'ENGINE_RETAINED_GEOMETRY_INVALID'}));
  });
  it('preserves an early C# settings failure without fabricating a direct route or decision',()=>{
    const {result}=directFixture(),failed:EngineResponse={schemaVersion:'pathfinder.model.response.v1',requestId:id(52),status:'settings_required',message:'Settings unavailable.',engineeringAccepted:false};
    expect(mergeRetainedGeometryResponse(failed,result,'Instrumentation')).toBe(failed);
  });
  it('reads the exact project/cable latest proposal without hiding failed or different-geometry history in SQL',async()=>{
    const current=fixture(),db=database();expect(await readRetainedDesignGeometry(db.client,current.projectId,current.cableId,current)).toBeUndefined();
    expect(db.query).toHaveBeenCalledTimes(1);const [raw,values]=db.query.mock.calls[0],sql=raw.replace(/\s+/g,' ').trim();
    expect(values).toEqual([current.projectId,current.cableId]);
    expect(sql).toBe('SELECT result,dependencies,status FROM pf_proposals WHERE project_id=$1 AND cable_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1');
    expect(sql).not.toMatch(/geometry_hash|result\s*->|status\s*=|JOIN|OFFSET/i);
  });

  it.each(['secondaryTrayLength','endConnectionLength','additionalBendingPercent'] as const)('retains the latest successful route and its exact metadata only for a %s-only change',async field=>{
    const previous=fixture(),current=structuredClone(previous);current.settings={...previous.settings,revision:'4',[field]:'12'};
    const result=response(),db=database({status:'calculated',dependencies:previous,result});
    expect(verifiedDesignOnlyChange(current,previous)).toBe(true);
    expect(await readRetainedDesignGeometry(db.client,current.projectId,current.cableId,current)).toBe(result);
    expect(result.route?.pathPoints).toEqual([{x:0,y:0,z:0},{x:2,y:0,z:0}]);expect(result.prepared).toEqual({warnings:['Retain exact synthetic diagnostics.']});
  });

  it('forces a full route after an intervening gap change even when an older gap1 route would match current allowances',async()=>{
    const older=fixture(),latest=structuredClone(older);latest.settings={...older.settings,revision:'4',connectionGap:'0.75'};latest.options.connectionToleranceMeters=0.75;
    const current=allowances(older);current.settings.revision='5';
    expect(verifiedDesignOnlyChange(current,older)).toBe(true);expect(verifiedDesignOnlyChange(current,latest)).toBe(false);
    const db=database({status:'calculated',dependencies:latest,result:response()});
    expect(await readRetainedDesignGeometry(db.client,current.projectId,current.cableId,current)).toBeUndefined();expect(db.query).toHaveBeenCalledTimes(1);
  });

  it.each(['no_path','deadline_exceeded','stale','invalid_request','resource_limit'])('does not skip the latest %s proposal to search older successful history',async status=>{
    const previous=fixture(),current=allowances(previous),db=database({status,dependencies:previous,result:response()});
    expect(verifiedDesignOnlyChange(current,previous)).toBe(true);
    expect(await readRetainedDesignGeometry(db.client,current.projectId,current.cableId,current)).toBeUndefined();expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('refuses a latest calculated row whose route did not succeed',async()=>{
    const previous=fixture(),current=allowances(previous),result=response();result.route={...result.route!,success:false};
    const db=database({status:'calculated',dependencies:previous,result});
    expect(await readRetainedDesignGeometry(db.client,current.projectId,current.cableId,current)).toBeUndefined();
  });

  it('refuses a latest calculated row with no retained engine result',async()=>{
    const previous=fixture(),current=allowances(previous),db=database({status:'calculated',dependencies:previous,result:null});
    expect(await readRetainedDesignGeometry(db.client,current.projectId,current.cableId,current)).toBeUndefined();
  });

  it.each(['cable-write','registry','endpoint','model','engine','routing-preference'] as const)('forces a full route when latest %s authority differs despite a simultaneous allowance change',async kind=>{
    const previous=fixture(),current=allowances(previous);
    if(kind==='cable-write')current.cableWriteRevision='5';
    if(kind==='registry')current.registryRevision='8';
    if(kind==='endpoint')current.from.bindingRevision='4';
    if(kind==='model')current.model.selectionRevision='2';
    if(kind==='engine'){current.engineIdentity.runnerSha256='a'.repeat(64);const {contentSha256:_old,...body}=current.engineIdentity;current.engineIdentity.contentSha256=hash(body);}
    if(kind==='routing-preference')current.options.preferVerticalApproach=!current.options.preferVerticalApproach;
    const db=database({status:'calculated',dependencies:previous,result:response()});
    expect(await readRetainedDesignGeometry(db.client,current.projectId,current.cableId,current)).toBeUndefined();expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('does not use an unchanged latest snapshot as a design-only transition',async()=>{
    const previous=fixture(),db=database({status:'calculated',dependencies:previous,result:response()});
    expect(await readRetainedDesignGeometry(db.client,previous.projectId,previous.cableId,structuredClone(previous))).toBeUndefined();
  });
});
