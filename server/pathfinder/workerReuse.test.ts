// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {ENGINE_IDENTITY_POLICY_VERSIONS,ENGINE_IDENTITY_VERSION} from '../../shared/pathfinderEngineIdentity.js';
import {hash,verifiedDesignOnlyChange} from './dependencies.js';
import {defaultOptions,type CurrentDependencySnapshot,type EngineResponse} from './jobContracts.js';
import {readRetainedDesignGeometry} from './worker.js';

const id=(n:number)=>`ed000000-0000-4000-a000-${String(n).padStart(12,'0')}`;
/** Synthetic frozen inputs/results test selection only; no engine or database runs here. */
function fixture():CurrentDependencySnapshot{
  const body={schemaVersion:'wfc.pf.engine-identity.v1' as const,version:ENGINE_IDENTITY_VERSION,runnerSha256:'1'.repeat(64),modelModuleSha256:'2'.repeat(64),coreModuleSha256:'3'.repeat(64),adapterModuleSha256:'4'.repeat(64),derivationSha256:'5'.repeat(64),policyVersions:{...ENGINE_IDENTITY_POLICY_VERSIONS}};
  const endpoint=(n:number)=>({locationId:id(n),locationRevision:'2',bindingRevision:'3',point:[1,2,3] as [number,number,number],bindingId:id(n+10),bindingContentSha256:'b'.repeat(64),mode:'fixed-world' as const,captureFrameId:id(5),qualifiedProjectFrameId:null,aggregateId:id(4),projectionSha256:'d'.repeat(64),sourceObjectRevisionId:null,migrationDecisionId:null});
  return{schemaVersion:'pathfinder.dependencies.v5',projectId:id(1),cableId:id(8),cableWriteRevision:'4',cableInputs:{fromLocation:'From',toLocation:'To',mto:'Instrumentation',cableTypeId:id(9)},registryRevision:'7',routing:{catalogRevision:'2',routingContentSha256:'e'.repeat(64),routingPolicyRevision:'3',routingPolicySha256:'f'.repeat(64)},model:{id:id(2),selectionRevision:'1',contentFingerprint:'c'.repeat(64)},artifact:{id:id(3),sha256:'d'.repeat(64)},preparation:{aggregateId:id(4),geometryRevision:'2',captureFrameId:id(5),projectionSha256:'d'.repeat(64)},comparison:null,settings:{revision:'3',connectionGap:'1',secondaryTrayLength:'7',endConnectionLength:'5',additionalBendingPercent:'10'},options:{...defaultOptions,connectionToleranceMeters:1},from:endpoint(6),to:endpoint(7),engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1',engineIdentity:{...body,contentSha256:hash(body)}};
}
const allowances=(before:CurrentDependencySnapshot):CurrentDependencySnapshot=>({...structuredClone(before),settings:{...before.settings,revision:'4',additionalBendingPercent:'11'}});
const response=():EngineResponse=>({schemaVersion:'pathfinder.model.response.v1',requestId:id(50),status:'calculated',message:'Synthetic selection fixture.',engineeringAccepted:false,effectiveCategory:'Control',prepared:{warnings:['Retain exact synthetic diagnostics.']},route:{success:true,message:'Synthetic route.',routeText:'/T1',routeCodes:['/T1'],segmentIds:['synthetic-segment'],pathPoints:[{x:0,y:0,z:0},{x:2,y:0,z:0}],lengthMeters:2,fromDistanceMeters:0,toDistanceMeters:0,fromRequiresSecondary:false,toRequiresSecondary:false,connectionGapCount:0,connectionGapLengthMeters:0}});
function database(row?:{status:string;dependencies:CurrentDependencySnapshot;result:EngineResponse|null}){
  const query=vi.fn(async(_sql:string,_values?:unknown[])=>({rows:row?[row]:[]}));
  return{query,client:{query} as unknown as Pick<PoolClient,'query'>};
}

describe('latest-proposal-only retained design geometry (mocked SQL, real reuse predicate)',()=>{
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
