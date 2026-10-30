// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
const seams=vi.hoisted(()=>({collect:vi.fn(),insert:vi.fn(),barriers:vi.fn(),automatic:vi.fn()}));
vi.mock('./dependencyBatch.js',()=>({collectDependencyBatchInTransaction:seams.collect}));
vi.mock('./jobs.js',()=>({insertCalculationBatch:seams.insert}));
vi.mock('./barrierCalculationScope.js',()=>({collectBarrierCalculationScope:seams.barriers}));
vi.mock('./automaticPairMandates.js',()=>({appendAutomaticPairMandatesInTransaction:seams.automatic}));
import {locationImpactAdmission} from './locationImpactAdmission.js';
import {hash} from './dependencies.js';
const id=(n:number)=>`da300000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const policy={schemaVersion:'wfc.pf.automatic-pair-policy.v1' as const,mode:'when-both-empty-or-unchanged-automatic' as const};
const automaticPair={policy,createdAt:'2026-10-20T12:00:00.000Z',authorityExpiresAt:'2026-10-20T12:30:00.000Z'};
const barrierIntent=(drillThroughWalls=false)=>{const scope={projectId:id(1),modelVersionId:id(10),contentFingerprint:'a'.repeat(64),selectionRevision:'3',captureFrameId:id(11),captureFrameSha256:'b'.repeat(64),coordinateFrame:'canonical-world-metres' as const};return{schemaVersion:'wfc.pf.barrier-admission-intent.v1' as const,scope,expectedRegistryRevision:'4',expectedSnapshot:{snapshotId:id(12),scope,registryRevision:'4',contentSha256:'c'.repeat(64),mode:'explicit-empty' as const},drillThroughWalls};};
function fixture(blocked=false){
  const barrierRouting=barrierIntent(),barriers={binding:{scope:barrierRouting.scope,snapshot:barrierRouting.expectedSnapshot},profileSha256:'d'.repeat(64)};
  const item={id:id(3),cable:{id:id(3),mto:'Instrumentation',cable_write_revision:'7'},dependencies:blocked?null:{schemaVersion:'pathfinder.dependencies.v8',barriers},status:blocked?'locations_required':'ready',message:''};
  const batch={items:[item],options:{sampleSpacingMeters:0.125},registryRevision:'4',bytes:100};seams.collect.mockResolvedValue(batch);seams.insert.mockResolvedValue(id(5));
  seams.barriers.mockResolvedValue(barriers);
  const query=vi.fn().mockResolvedValue({rows:[{id:id(6)}]}),client={query} as unknown as PoolClient;
  const input={projectId:id(1),impactId:id(2),principal:{userId:id(8),loginId:id(9),loginExpiresAt:Date.now()+60000},cableIds:[id(3)],
    preferences:{secondaryDistanceMeters:2,preferVerticalApproach:true,barrierRouting},timeoutMilliseconds:10000,signal:new AbortController().signal,beforeInsert:vi.fn().mockResolvedValue(undefined)};
  return {input,batch,client,query};
}
beforeEach(()=>vi.clearAllMocks());
describe('targeted location impact admission (real adapter, mocked batch/insertion)',()=>{
  it('preserves the original admission hash and never upgrades a legacy impact to automatic writes',async()=>{
    const f=fixture(),result=await locationImpactAdmission(f.client,f.input);
    expect(result.inputSha256).toBe(hash({schemaVersion:'wfc.pf.location-impact-admission.v1',impactId:f.input.impactId,
      timeoutMilliseconds:f.input.timeoutMilliseconds,items:f.batch.items.map(item=>({id:item.id,dependencies:item.dependencies,status:item.status,cableWriteRevision:item.cable.cable_write_revision}))}));
    expect(seams.automatic).not.toHaveBeenCalled();
  });
  it('binds ready-item mandates to the immutable Save policy and original finite authority after admission',async()=>{
    const f=fixture(),blocked={...f.batch.items[0],id:id(4),dependencies:null,status:'locations_required'};
    seams.collect.mockResolvedValue({...f.batch,items:[blocked,f.batch.items[0]]});
    const result=await locationImpactAdmission(f.client,{...f.input,cableIds:[id(3),id(4)],automaticPair});
    expect(seams.automatic).toHaveBeenCalledExactlyOnceWith(f.client,{projectId:f.input.projectId,jobId:id(5),principal:f.input.principal,
      policy,requestSha256:result.inputSha256,source:{kind:'location-impact',impactId:f.input.impactId,createdAt:automaticPair.createdAt,
        authorityExpiresAt:automaticPair.authorityExpiresAt},items:[{cableId:id(3),cableWriteRevision:'7',dependencyHash:hash(f.batch.items[0].dependencies)}]},expect.any(Function));
    expect(seams.automatic.mock.invocationCallOrder[0]).toBeGreaterThan(seams.insert.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({readyCables:1,blockedCables:1,total:2});
    expect(seams.collect.mock.calls[0][1].options).not.toHaveProperty('automaticPairPolicy');
  });
  it('does not create an empty automatic mandate when every exact target is blocked',async()=>{
    const f=fixture(true);expect(await locationImpactAdmission(f.client,{...f.input,automaticPair})).toMatchObject({readyCables:0,blockedCables:1});
    expect(seams.insert).toHaveBeenCalledOnce();expect(seams.automatic).not.toHaveBeenCalled();
  });
  it('does not append write authority without the exact immutable admission',async()=>{
    const f=fixture();f.query.mockResolvedValue({rows:[]});
    await expect(locationImpactAdmission(f.client,{...f.input,automaticPair})).rejects.toMatchObject({code:'REVISION_ADMISSION_REQUIRED'});
    expect(seams.automatic).not.toHaveBeenCalled();
  });
  it.each([false,true])('admits explicit scoped intent as v8 and rereads barriers before the final claim latch (drill=%s)',async drillThroughWalls=>{
    const f=fixture(),barrierRouting=barrierIntent(drillThroughWalls),barriers={binding:{scope:barrierRouting.scope,snapshot:barrierRouting.expectedSnapshot},profileSha256:'d'.repeat(64)};
    // The batch and retained-byte reader are boundary mocks; this test makes no
    // geometric qualification or real runtime assertion.
    const batch={...f.batch,items:[{...f.batch.items[0],dependencies:{schemaVersion:'pathfinder.dependencies.v8',barriers}}]};
    seams.collect.mockResolvedValue(batch);seams.barriers.mockResolvedValue(barriers);
    await locationImpactAdmission(f.client,{...f.input,preferences:{...f.input.preferences,barrierRouting}});
    expect(seams.collect).toHaveBeenCalledWith(f.client,expect.objectContaining({dependencyVersion:'pathfinder.dependencies.v8',options:expect.objectContaining({barrierRouting})}));
    expect(seams.barriers).toHaveBeenCalledWith(f.client,f.input.projectId,barrierRouting,expect.objectContaining({signal:f.input.signal,deadline:expect.any(Number)}));
    expect(seams.barriers.mock.invocationCallOrder[0]).toBeLessThan(f.input.beforeInsert.mock.invocationCallOrder[0]);
    expect(seams.insert.mock.invocationCallOrder[0]).toBeGreaterThan(f.input.beforeInsert.mock.invocationCallOrder[0]);
  });
  it('refuses changed v8 barrier proof before inserting or taking the final scheduler latch',async()=>{
    const f=fixture(),barrierRouting=barrierIntent();
    seams.collect.mockResolvedValue({...f.batch,items:[{...f.batch.items[0],dependencies:{schemaVersion:'pathfinder.dependencies.v8',barriers:{version:'old'}}}]});
    seams.barriers.mockResolvedValue({version:'new'});
    await expect(locationImpactAdmission(f.client,{...f.input,preferences:{...f.input.preferences,barrierRouting}})).rejects.toMatchObject({code:'BARRIER_CALCULATION_SCOPE_CHANGED'});
    expect(f.input.beforeInsert).not.toHaveBeenCalled();expect(seams.insert).not.toHaveBeenCalled();
  });
  it('revalidates barriers even for an all-blocked v8 input and propagates a lost publication refusal',async()=>{
    const f=fixture(true),barrierRouting=barrierIntent();seams.barriers.mockRejectedValue(Object.assign(Error('changed'),{code:'BARRIER_CALCULATION_SCOPE_CHANGED'}));
    await expect(locationImpactAdmission(f.client,{...f.input,preferences:{...f.input.preferences,barrierRouting}})).rejects.toMatchObject({code:'BARRIER_CALCULATION_SCOPE_CHANGED'});
    expect(seams.barriers).toHaveBeenCalledOnce();expect(seams.insert).not.toHaveBeenCalled();
  });
  it('refuses malformed intent before collecting a legacy batch instead of stripping the field',async()=>{
    const f=fixture();
    await expect(locationImpactAdmission(f.client,{...f.input,preferences:{...f.input.preferences,barrierRouting:null}} as never)).rejects.toThrow();
    expect(seams.collect).not.toHaveBeenCalled();expect(seams.insert).not.toHaveBeenCalled();
  });
  it('refuses a historical missing intent before batch collection, insertion or the scheduler latch',async()=>{
    const f=fixture(),{barrierRouting:_historical,...preferences}=f.input.preferences;
    await expect(locationImpactAdmission(f.client,{...f.input,preferences})).rejects.toMatchObject({code:'BARRIER_ROUTING_INTENT_REQUIRED'});
    expect(seams.collect).not.toHaveBeenCalled();expect(seams.barriers).not.toHaveBeenCalled();expect(seams.insert).not.toHaveBeenCalled();
    expect(f.input.beforeInsert).not.toHaveBeenCalled();expect(f.query).not.toHaveBeenCalled();
  });
  it('admits exact affected ids with explicit preferences, v8 and an independent admission kind',async()=>{
    const f=fixture();const result=await locationImpactAdmission(f.client,f.input);
    expect(seams.collect).toHaveBeenCalledWith(f.client,expect.objectContaining({cableIds:f.input.cableIds,dependencyVersion:'pathfinder.dependencies.v8',options:expect.objectContaining(f.input.preferences)}));
    expect(f.input.beforeInsert).toHaveBeenCalledOnce();expect(seams.insert.mock.invocationCallOrder[0]).toBeGreaterThan(f.input.beforeInsert.mock.invocationCallOrder[0]);
    expect(seams.insert).toHaveBeenCalledWith(f.client,f.input.projectId,f.input.principal,f.batch,10000,expect.stringMatching(/^[a-f0-9]{64}$/),expect.anything(),{kind:'location-impact',generation:null});
    expect(result).toMatchObject({jobId:id(5),admissionId:id(6),readyCables:1,blockedCables:0,total:1});
    expect(seams.barriers).toHaveBeenCalledOnce();expect(seams.collect.mock.calls[0][1].options.barrierRouting).toEqual(f.input.preferences.barrierRouting);
  });
  it('retains a real all-blocked scope so an old success does not become the latest result',async()=>{
    const f=fixture(true);expect(await locationImpactAdmission(f.client,f.input)).toMatchObject({jobId:id(5),readyCables:0,blockedCables:1,reasonCodes:['LOCATIONS_REQUIRED']});
    expect(seams.insert).toHaveBeenCalledOnce();
  });
  it.each(['Unknown',null,''])('admits the exact scoped calculation without requiring MTO %j',async mto=>{
    const f=fixture();f.batch.items[0].cable.mto=mto as string;
    expect(await locationImpactAdmission(f.client,f.input)).toMatchObject({jobId:id(5),readyCables:1,total:1});
    expect(seams.insert).toHaveBeenCalledOnce();expect(f.batch.items[0].cable.mto).toBe(mto);
  });
  it.each(['MV'])('refuses category %s before creating an admission',async mto=>{
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
