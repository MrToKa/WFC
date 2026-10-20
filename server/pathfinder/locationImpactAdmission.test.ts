// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
const seams=vi.hoisted(()=>({collect:vi.fn(),insert:vi.fn()}));
vi.mock('./dependencyBatch.js',()=>({collectDependencyBatchInTransaction:seams.collect}));
vi.mock('./jobs.js',()=>({insertCalculationBatch:seams.insert}));
import {locationImpactAdmission} from './locationImpactAdmission.js';
const id=(n:number)=>`da300000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(blocked=false){
  const item={id:id(3),cable:{id:id(3),mto:'Instrumentation',cable_write_revision:'7'},dependencies:blocked?null:{schemaVersion:'pathfinder.dependencies.v7'},status:blocked?'locations_required':'ready',message:''};
  const batch={items:[item],options:{sampleSpacingMeters:0.125},registryRevision:'4',bytes:100};seams.collect.mockResolvedValue(batch);seams.insert.mockResolvedValue(id(5));
  const query=vi.fn().mockResolvedValue({rows:[{id:id(6)}]}),client={query} as unknown as PoolClient;
  const input={projectId:id(1),impactId:id(2),principal:{userId:id(8),loginId:id(9),loginExpiresAt:Date.now()+60000},cableIds:[id(3)],
    preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true},timeoutMilliseconds:10000,signal:new AbortController().signal,beforeInsert:vi.fn().mockResolvedValue(undefined)};
  return {input,batch,client,query};
}
beforeEach(()=>vi.clearAllMocks());
describe('targeted location impact admission (real adapter, mocked batch/insertion)',()=>{
  it('admits exact affected ids with explicit preferences, v7 and an independent admission kind',async()=>{
    const f=fixture();const result=await locationImpactAdmission(f.client,f.input);
    expect(seams.collect).toHaveBeenCalledWith(f.client,expect.objectContaining({cableIds:f.input.cableIds,dependencyVersion:'pathfinder.dependencies.v7',options:expect.objectContaining(f.input.preferences)}));
    expect(f.input.beforeInsert).toHaveBeenCalledOnce();expect(seams.insert.mock.invocationCallOrder[0]).toBeGreaterThan(f.input.beforeInsert.mock.invocationCallOrder[0]);
    expect(seams.insert).toHaveBeenCalledWith(f.client,f.input.projectId,f.input.principal,f.batch,10000,expect.stringMatching(/^[a-f0-9]{64}$/),expect.anything(),{kind:'location-impact',generation:null});
    expect(result).toMatchObject({jobId:id(5),admissionId:id(6),readyCables:1,blockedCables:0,total:1});
  });
  it('retains a real all-blocked scope so an old success does not become the latest result',async()=>{
    const f=fixture(true);expect(await locationImpactAdmission(f.client,f.input)).toMatchObject({jobId:id(5),readyCables:0,blockedCables:1,reasonCodes:['LOCATIONS_REQUIRED']});
    expect(seams.insert).toHaveBeenCalledOnce();
  });
  it.each(['MV','Unknown',null])('refuses category %s before creating an admission',async mto=>{
    const f=fixture();f.batch.items[0].cable.mto=mto as string;
    await expect(locationImpactAdmission(f.client,f.input)).rejects.toMatchObject({code:'LOCATION_IMPACT_CATEGORY_CHANGED'});expect(seams.insert).not.toHaveBeenCalled();
  });
  it('cannot insert when the exact claim fence rejects',async()=>{
    const f=fixture();f.input.beforeInsert.mockRejectedValue(Error('claim fenced'));
    await expect(locationImpactAdmission(f.client,f.input)).rejects.toThrow('claim fenced');expect(seams.insert).not.toHaveBeenCalled();
  });
  it('refuses a missing immutable admission instead of returning invented metadata',async()=>{
    const f=fixture();f.query.mockResolvedValue({rows:[]});await expect(locationImpactAdmission(f.client,f.input)).rejects.toMatchObject({code:'REVISION_ADMISSION_REQUIRED'});
  });
});
