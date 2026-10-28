// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {executeCapacityRouting,withNativeRoutingQuery} from './capacityRoutingExecution.js';
import type {EngineResponse} from './jobContracts.js';
import type {TrayCapacityRoutingContext} from './trayCapacityRouting.js';
import type {EngineInvocation} from './engineSession.js';

const id='00000000-0000-4000-8000-000000000001';
const request={requestId:id,timeoutMilliseconds:120000,operation:'calculate'};
const route=(code:string):EngineResponse=>({schemaVersion:'pathfinder.model.response.v1',requestId:id,status:'calculated',engineeringAccepted:false,message:'Calculated.',
  route:{success:true,message:'Calculated.',routeText:code,routeCodes:[code],segmentIds:[code],pathPoints:[],lengthMeters:10,fromDistanceMeters:0,toDistanceMeters:0,
    fromRequiresSecondary:false,toRequiresSecondary:false,connectionGapCount:0,connectionGapLengthMeters:0},design:null});
const noPath:EngineResponse={schemaVersion:'pathfinder.model.response.v1',requestId:id,status:'no_path',engineeringAccepted:false,message:'No path.'};
function context(blocked:(codes:string[])=>string[]=()=>[],unknown=false):TrayCapacityRoutingContext{
  const evaluate=(codes:string[])=>({schemaVersion:'wfc.pf.tray-capacity-diagnostics.v1' as const,minimumFreeSpacePercent:30,effectiveMinimumFreeSpacePercent:27,
    tolerancePercentagePoints:3 as const,occupancySha256:'a'.repeat(64),groupCableCount:2,blockedRouteCodes:blocked(codes),unavailableRouteCodes:unknown?codes:[],trays:[]});
  return {policy:{enabled:true,minimumFreeSpacePercent:30,effectiveMinimumFreeSpacePercent:27,tolerancePercentagePoints:3},minimumFreeSpacePercent:30,effectiveMinimumFreeSpacePercent:27,
    tolerancePercentagePoints:3,occupancySha256:'a'.repeat(64),groupCableCount:2,groupCableIds:[id],groupKey:'group',
    restrictionEnabled:true,routeCostMultipliers:[],sameToGroupKey:'to',sameToGroupCableIds:[id],preferredCorridors:[],settledSource:null,evaluate,
    score:codes=>({assessment:evaluate(codes),bottleneckOccupiedPercent:null,meanOccupiedPercent:null,knownTrayCount:0,unknownTrayCount:0,sharedSuffixRouteCodes:[]})};
}
const run=(extras:Partial<Parameters<typeof executeCapacityRouting>[0]>={})=>executeCapacityRouting({request,context:context(),execute:vi.fn(async()=>route('/A')),
  validate:vi.fn(),signal:new AbortController().signal,...extras});
describe('capacity-aware native search',()=>{
  it('retains independent cable Purpose permissions through capacity query restoration and retries',async()=>{
    const scoped={...request,allowedPurposeRouteCodes:['/A','/B']};
    expect(withNativeRoutingQuery(scoped,{timeoutMilliseconds:30000,excludedRouteCodes:['/A'],routeCostMultipliers:[]})
      .allowedPurposeRouteCodes).toEqual(['/A','/B']);
    const engine=vi.fn().mockResolvedValueOnce(route('/A')).mockResolvedValueOnce(route('/B'));
    await run({request:scoped,execute:engine,context:context(codes=>codes.includes('/A')?['/A']:[])});
    expect(engine.mock.calls[0][0].allowedPurposeRouteCodes).toEqual(['/A','/B']);
    expect(engine.mock.calls[1][0].allowedPurposeRouteCodes).toEqual(['/A','/B']);
    expect(engine.mock.calls[1][0].excludedRouteCodes).toEqual(['/A']);
  });
  it('accepts a fitting route without an additional native search',async()=>{
    const engine=vi.fn(async()=>route('/A')),result=await run({execute:engine});
    expect(engine).toHaveBeenCalledTimes(1);expect(result.response.route?.routeText).toBe('/A');expect(result.response.trayCapacity?.outcome).toBe('fits');
    expect(result.request).toBe(request);
  });
  it('excludes full sections and keeps the actual alternate native path',async()=>{
    const engine=vi.fn().mockResolvedValueOnce(route('/A')).mockResolvedValueOnce(route('/B'));
    const result=await run({execute:engine,context:context(codes=>codes.includes('/A')?['/A']:[])});
    expect(engine.mock.calls[1][0].excludedRouteCodes).toEqual(['/A']);expect(result.response.route?.routeText).toBe('/B');
    expect(result.response.trayCapacity).toMatchObject({outcome:'rerouted',attempts:2,excludedRouteCodes:['/A']});
  });
  it('leaves no route when no capacity-compliant alternative exists',async()=>{
    const engine=vi.fn().mockResolvedValueOnce(route('/A')).mockResolvedValueOnce(noPath);
    const result=await run({execute:engine,context:context(codes=>codes)});
    expect(result.response.status).toBe('no_path');expect(result.response.route).toBeUndefined();expect(result.response.design).toBeUndefined();
    expect(result.response.trayCapacity?.outcome).toBe('no-capacity');expect(result.response.message).toContain('remains unrouted');
  });
  it('keeps bounded search exhaustion unrouted instead of returning the last overfull candidate',async()=>{
    let index=0;const engine=vi.fn(async()=>route('/A'+index++));
    const result=await run({execute:engine,context:context(codes=>codes)});
    expect(engine).toHaveBeenCalledTimes(16);expect(result.response.status).toBe('resource_limit');expect(result.response.route).toBeUndefined();
    expect(result.response.trayCapacity?.outcome).toBe('search-limit');
  });
  it('reports unavailable capacity data without stopping a geometry-valid calculation',async()=>{
    const result=await run({context:context(()=>[],true)});expect(result.response.status).toBe('calculated');
    expect(result.response.trayCapacity?.outcome).toBe('unavailable');expect(result.response.message).toContain('could not be verified');
  });
  it('reuses an endpoint-group native computation without a second geometry search',async()=>{
    const engine=vi.fn(async()=>route('/B'));const result=await run({execute:engine,initialResponse:route('/A')});
    expect(engine).not.toHaveBeenCalled();expect(result.response.route?.routeText).toBe('/A');
  });
  it('keeps balancing weights with the exact native query while the restriction is off',async()=>{
    const placement=context(codes=>codes);placement.policy.enabled=false;placement.restrictionEnabled=false;
    const weights=[{routeCode:'/A',multiplier:6},{routeCode:'/B',multiplier:1.2}];
    const weighted={...request,routeCostMultipliers:weights};
    const engine=vi.fn(async(_request:EngineInvocation)=>route('/B'));
    const result=await run({request:weighted,context:placement,execute:engine});
    expect(engine).toHaveBeenCalledOnce();expect(engine.mock.calls[0][0]).toBe(weighted);
    expect(result.response.status).toBe('calculated');expect(result.response.route?.lengthMeters).toBe(10);
    expect(result.response.trayCapacity).toMatchObject({outcome:'balanced',restrictionEnabled:false,query:{routeCostMultipliers:weights,excludedRouteCodes:[],timeoutMilliseconds:120000}});
  });
  it('retains load costs on a capacity alternate and records the actual bounded query',async()=>{
    const weights=[{routeCode:'/A',multiplier:7},{routeCode:'/B',multiplier:2}];
    const engine=vi.fn().mockResolvedValueOnce(route('/A')).mockResolvedValueOnce(route('/B'));
    const result=await run({request:{...request,routeCostMultipliers:weights},context:context(codes=>codes.includes('/A')?codes:[]),execute:engine});
    expect(engine.mock.calls[1][0].routeCostMultipliers).toEqual(weights);
    expect(result.response.trayCapacity?.query).toEqual({timeoutMilliseconds:result.request.timeoutMilliseconds,excludedRouteCodes:['/A'],routeCostMultipliers:weights});
  });
  it('reconstructs a settled group query without keeping newer candidate weights or exclusions',()=>{
    expect(withNativeRoutingQuery({...request,routeCostMultipliers:[{routeCode:'/NEW',multiplier:3}],excludedRouteCodes:['/NEW']},
      {timeoutMilliseconds:32100,routeCostMultipliers:[{routeCode:'/OLD',multiplier:2}],excludedRouteCodes:[]}))
      .toEqual({...request,timeoutMilliseconds:32100,routeCostMultipliers:[{routeCode:'/OLD',multiplier:2}]});
  });
  it('honors cancellation before starting work',async()=>{
    const controller=new AbortController();controller.abort();const engine=vi.fn(async()=>route('/A'));
    await expect(run({execute:engine,signal:controller.signal})).rejects.toThrow();expect(engine).not.toHaveBeenCalled();
  });
});
