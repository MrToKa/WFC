// @vitest-environment node
import { describe,expect,it } from 'vitest';
import { mergeRetainedGeometryResponse } from './worker.js';
import type { EngineResponse } from './jobContracts.js';

const retained:EngineResponse={schemaVersion:'pathfinder.model.response.v1',requestId:'11111111-1111-4111-8111-111111111111',status:'calculated',message:'Path found.',engineeringAccepted:false,
  effectiveCategory:'Control',prepared:{objectCount:52,segmentCount:26,counts:{fallbackBends:2},engineeringAccepted:false},
  projectSettings:{revision:'1',endConnectionLength:'5',secondaryTrayLength:'3',additionalBendingPercent:'10'},
  route:{success:true,message:'Path found.',routeText:'/A/B',routeCodes:['A','B'],segmentIds:['dbid:1','dbid:2'],pathPoints:[{x:0,y:0,z:.5},{x:35.30345579516123,y:0,z:.5}],
    lengthMeters:35.30345579516123,fromDistanceMeters:0,toDistanceMeters:0,fromRequiresSecondary:false,toRequiresSecondary:false,connectionGapCount:0,connectionGapLengthMeters:0},
  design:{lengthBeforePercentageMeters:'40.3034557951612',unroundedLengthMeters:'44.33380137467732',designLengthMeters:'45'}};
const updated:EngineResponse={schemaVersion:'pathfinder.model.response.v1',requestId:'22222222-2222-4222-8222-222222222222',status:'calculated',message:'Design length calculated.',engineeringAccepted:false,
  projectSettings:{revision:'2',endConnectionLength:'6',secondaryTrayLength:'3',additionalBendingPercent:'10'},
  design:{lengthBeforePercentageMeters:'41.3034557951612',unroundedLengthMeters:'45.43380137467732',designLengthMeters:'46'}};

describe('retained geometry response provenance',()=>{
  it('preserves exact route, original diagnostics and Instrumentation category while using the fresh C# decimal design/settings',()=>{
    const before=JSON.stringify(retained),freshBefore=JSON.stringify(updated),value=mergeRetainedGeometryResponse(updated,retained,'Instrumentation');
    expect(value.route).toBe(retained.route);expect(value.prepared).toBe(retained.prepared);expect(value.effectiveCategory).toBe('Control');
    expect(value.design).toBe(updated.design);expect(value.projectSettings).toBe(updated.projectSettings);expect(value.requestId).toBe(updated.requestId);
    expect(JSON.stringify(retained)).toBe(before);expect(JSON.stringify(updated)).toBe(freshBefore);
  });
  it.each(['MV','LV','Control'])('retains the frozen %s category without reading a mutable cable record',category=>{
    expect(mergeRetainedGeometryResponse(updated,{...retained,effectiveCategory:category},category).effectiveCategory).toBe(category);
  });
  it('recovers category metadata from explicit immutable input when a historical design-only result omitted it, without inventing missing diagnostics',()=>{
    const value=mergeRetainedGeometryResponse(updated,{...retained,effectiveCategory:null,prepared:undefined},'Instrumentation');
    expect(value.effectiveCategory).toBe('Control');expect(value.prepared).toBeUndefined();expect(value.route).toBe(retained.route);
  });
  it.each([null,'unknown','instrumentation'])('rejects unsupported frozen category %s',category=>{
    expect(()=>mergeRetainedGeometryResponse(updated,retained,category)).toThrowError(expect.objectContaining({code:'ENGINE_RETAINED_GEOMETRY_INVALID'}));
  });
  it('fails closed for contradictory original category metadata or a missing successful retained route',()=>{
    expect(()=>mergeRetainedGeometryResponse(updated,{...retained,effectiveCategory:'MV'},'Instrumentation')).toThrowError(expect.objectContaining({code:'ENGINE_RETAINED_GEOMETRY_INVALID'}));
    expect(()=>mergeRetainedGeometryResponse(updated,{...retained,route:undefined},'Control')).toThrowError(expect.objectContaining({code:'ENGINE_RETAINED_GEOMETRY_INVALID'}));
  });
});
