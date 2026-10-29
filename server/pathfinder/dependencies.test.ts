// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { collectDependencies, collectDependenciesForVersion, geometryHash, hash, verifiedDesignOnlyChange } from './dependencies.js';
import { defaultOptions } from './jobContracts.js';
import { syntheticEngineIdentity } from './calculationFixtures.js';
import { BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS, type BarrierEngineIdentity } from '../../shared/pathfinderEngineIdentity.js';
import { BARRIER_RUNTIME_PROFILE, createBarrierRuntimePolicy, type BarrierRuntimeContext } from '../../shared/pathfinderBarrierRuntime.js';
vi.mock('./calculationEngineIdentity.js',()=>({calculationEngineIdentity:async()=>syntheticEngineIdentity(),barrierCalculationEngineIdentity:async()=>barrierIdentity()}));
const mocked=vi.hoisted(()=>({context:vi.fn(),binding:vi.fn(),active:vi.fn(),artifact:vi.fn(),routing:vi.fn(),settings:vi.fn(),comparison:vi.fn(),automatic:vi.fn(),barriers:vi.fn()}));
vi.mock('./catalog.js',()=>({readRoutingCatalog:async()=>({rows:[{projectTrayId:'tray',rawName:'/B001',purposeKey:'Mixed'}],diagnostics:[]})}));
vi.mock('./barrierCalculationScope.js',()=>({collectBarrierCalculationScope:mocked.barriers}));
vi.mock('./automaticEndpointCandidates.js',()=>({readAutomaticEndpointCandidates:mocked.automatic}));
vi.mock('./repository.js',()=>({activeModel:mocked.active,latestArtifact:mocked.artifact}));
vi.mock('./endpointBindingRepository.js',()=>({readCurrentEndpointBindingContext:mocked.context,readEndpointBindingScope:mocked.binding}));
vi.mock('./routingScope.js',()=>({requirePreparedRoutingScope:mocked.routing}));
vi.mock('./settings.js',()=>({projectRoutingSettings:mocked.settings}));
vi.mock('./revisionComparisonRepository.js',()=>({readComparisonDependency:mocked.comparison}));
const id=(n:number)=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,pid=id(1),mid=id(2),artifactId=id(3),aggregateId=id(4),frameId=id(5);
const context=()=>({modelVersionId:mid,selectionRevision:'1',contentFingerprint:'c'.repeat(64),artifactId,aggregateId,projectionSha256:'d'.repeat(64),captureFrameId:frameId,geometryRevision:'2',traceId:null});
function barrierIdentity():BarrierEngineIdentity {
 const {contentSha256:_old,...base}=syntheticEngineIdentity();
 const body={...base,schemaVersion:'wfc.pf.engine-identity.v2' as const,barriersModuleSha256:'8'.repeat(64),barrierVerifierModuleSha256:'9'.repeat(64),policyVersions:{...BARRIER_ENGINE_IDENTITY_POLICY_VERSIONS}};
 return {...body,contentSha256:hash(body)};
}
function barrierRuntime():BarrierRuntimeContext {
 const policy=createBarrierRuntimePolicy(true);
 return {schemaVersion:'wfc.pf.barrier-runtime.v1',binding:{scope:{projectId:pid,modelVersionId:mid,contentFingerprint:'c'.repeat(64),selectionRevision:'1',captureFrameId:frameId,captureFrameSha256:'b'.repeat(64),coordinateFrame:'canonical-world-metres'},
  registryRevision:'0',snapshot:null,policy,policySha256:hash(policy)},profile:structuredClone(BARRIER_RUNTIME_PROFILE),profileSha256:hash(BARRIER_RUNTIME_PROFILE),storage:null};
}
function barrierOptions(){const value=barrierRuntime();return{...defaultOptions,barrierRouting:{schemaVersion:'wfc.pf.barrier-admission-intent.v1' as const,scope:value.binding.scope,expectedRegistryRevision:'0',expectedSnapshot:null,drillThroughWalls:true}};}
const binding=(locationId:string)=>({id:id(locationId===id(6)?16:17),locationId,artifactId,locationRevision:'2',bindingRevision:'3',pointProjectMetres:[1,2,3],contentSha256:'a'.repeat(64),mode:'fixed-world',captureFrameId:frameId,qualifiedProjectFrameId:null,aggregateId,projectionSha256:'d'.repeat(64),sourceObject:null,sourceDecisionId:null});
function database(from='  =a-01 ',to='=B.02',shared=false,registry='9',mto='Instrumentation'){
 const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
  if(sql.includes('FROM cables WHERE'))return{rows:[{id:args[1],from_location:from,to_location:to,mto,cable_type_id:id(10),cable_type_purpose:'Control',cable_write_revision:'4',routing:'/OLD',design_length:23,install_length:24}]};
  if(sql.includes('cable-purpose:locked-scope-types'))return{rows:[{id:(args[1] as string[])[0],cable_type_id:id(10),cable_type_purpose:'Control',cable_write_revision:'4'}]};
  if(sql.includes('FROM pf_routing_purpose_rules'))return{rows:[{purpose_key:'Mixed',allowed_categories:['Control']}]};
  if(sql.startsWith('SELECT DISTINCT purpose'))return{rows:[{purpose:'Control'}]};
  if(sql.includes('FROM pf_project_state'))return{rows:[{registry_revision:registry}]};
  if(sql.includes('FROM pf_location_aliases'))return{rows:[{id:shared||args[1]==='=A-01'?id(6):id(7)}]};
  throw Error('Unexpected SQL in endpoint collection');
 });return{client:{query}as unknown as PoolClient,query};
}
beforeEach(()=>{
 vi.clearAllMocks();mocked.active.mockResolvedValue({active_model_version_id:mid,selection_revision:'1',state:'ready',health:'healthy',content_fingerprint:'c'.repeat(64)});
 mocked.artifact.mockResolvedValue({id:artifactId,content_fingerprint:'c'.repeat(64),snapshot_sha256:'d'.repeat(64)});mocked.context.mockResolvedValue(context());
 mocked.routing.mockResolvedValue({catalogRevision:'1',routingContentSha256:'e'.repeat(64),routingPolicyRevision:'1',routingPolicySha256:'f'.repeat(64)});
 mocked.settings.mockResolvedValue({settings:{revision:'1',connectionGap:'1',secondaryTrayLength:'7',endConnectionLength:'5',additionalBendingPercent:'10'},options:{...defaultOptions,connectionToleranceMeters:1}});
 mocked.binding.mockImplementation(async(_c:unknown,input:{locationId:string})=>({status:'confirmed',binding:binding(input.locationId)}));
 mocked.comparison.mockResolvedValue({applicability:'not-required',readiness:'not-required',scope:null,reasonCodes:[],reviewStatus:'not-applicable'});
 mocked.automatic.mockResolvedValue(new Map());
 mocked.barriers.mockResolvedValue(barrierRuntime());
});
describe('additive v8 barrier dependency projection',()=>{
 it('keeps MV excluded before protected dispatch rather than enrolling a guaranteed runner refusal',async()=>{
  const value=await collectDependenciesForVersion(database('  =a-01 ','=B.02',false,'9','MV').client,pid,id(8),barrierOptions(),'pathfinder.dependencies.v8');
  expect(value.dependencies).toBeNull();expect(value.status).toBe('category_required');expect(value.message).toContain('MV cables are excluded');
 });
 const retainOptions=()=>mocked.settings.mockImplementation(async(_client:unknown,_project:string,options:unknown)=>({settings:{revision:'1',connectionGap:'1',secondaryTrayLength:'7',endConnectionLength:'5',additionalBendingPercent:'10'},options:{...(options as object),connectionToleranceMeters:1}}));
 it('freezes exact runtime/identity/intent alongside scoped endpoint resolution, without global registry authority',async()=>{
  retainOptions();const options=barrierOptions();
  const value=(await collectDependenciesForVersion(database().client,pid,id(8),options,'pathfinder.dependencies.v8')).dependencies!;
  expect(value.schemaVersion).toBe('pathfinder.dependencies.v8');expect(value).toHaveProperty('barriers',barrierRuntime());
  expect(value).toHaveProperty('engineIdentity',barrierIdentity());expect(value).not.toHaveProperty('registryRevision');
  expect(value.options.barrierRouting).toEqual(options.barrierRouting);expect(value).toHaveProperty('endpointResolution.to.logicalKey','=B.02');
  expect(mocked.barriers).toHaveBeenCalledTimes(1);expect(mocked.barriers.mock.calls[0][2]).toEqual(options.barrierRouting);
 });
 it('refuses absent/malformed v8 intents and a protected intent on retained legacy versions',async()=>{
  await expect(collectDependenciesForVersion(database().client,pid,id(8),defaultOptions,'pathfinder.dependencies.v8')).rejects.toMatchObject({code:'BARRIER_ADMISSION_REQUIRED'});
  await expect(collectDependenciesForVersion(database().client,pid,id(8),barrierOptions(),'pathfinder.dependencies.v7')).rejects.toMatchObject({code:'BARRIER_ADMISSION_REQUIRED'});
  const malformed={...barrierOptions(),barrierRouting:{...barrierOptions().barrierRouting,drillThroughWalls:'true'}};
  await expect(collectDependenciesForVersion(database().client,pid,id(8),malformed as never,'pathfinder.dependencies.v8')).rejects.toThrow();
  expect(mocked.barriers).not.toHaveBeenCalled();
 });
 it('keeps an explicitly absent optional field outside legacy frozen hashes',async()=>{
  retainOptions();const legacy=(await collectDependencies(database().client,pid,id(8),defaultOptions)).dependencies!;
  const absent=(await collectDependencies(database().client,pid,id(8),{...defaultOptions,barrierRouting:undefined})).dependencies!;
  expect(hash(absent)).toBe(hash(legacy));expect(absent.options).not.toHaveProperty('barrierRouting');
 });
 it('binds runtime scope changes to geometry and refuses design-only v8 reuse even for allowance-only changes',async()=>{
  retainOptions();const previous=(await collectDependenciesForVersion(database().client,pid,id(8),barrierOptions(),'pathfinder.dependencies.v8')).dependencies!;
  if(previous.schemaVersion!=='pathfinder.dependencies.v8'||previous.barriers.schemaVersion!=='wfc.pf.barrier-runtime.v1')throw Error('Wrong dependency fixture');
  const allowance={...previous,settings:{...previous.settings,revision:'2',endConnectionLength:'6'}};
  expect(geometryHash(allowance)).toBe(geometryHash(previous));expect(verifiedDesignOnlyChange(allowance,previous)).toBe(false);
  const changed={...previous,barriers:{...previous.barriers,profileSha256:'f'.repeat(64)}};
  expect(geometryHash(changed)).not.toBe(geometryHash(previous));
  const changedPolicy={...previous,barriers:{...previous.barriers,binding:{...previous.barriers.binding,policySha256:'f'.repeat(64)}}};
  expect(geometryHash(changedPolicy)).not.toBe(geometryHash(previous));
 });
 it('propagates current barrier refusal rather than returning a legacy calculation',async()=>{
  retainOptions();mocked.barriers.mockRejectedValueOnce(Object.assign(new Error('Changed scope'),{code:'BARRIER_CALCULATION_SCOPE_CHANGED'}));
  await expect(collectDependenciesForVersion(database().client,pid,id(8),barrierOptions(),'pathfinder.dependencies.v8')).rejects.toMatchObject({code:'BARRIER_CALCULATION_SCOPE_CHANGED'});
 });
 it('requires runtime barriers to describe the same prepared endpoint frame',async()=>{
  retainOptions();const runtime=barrierRuntime();runtime.binding.scope.captureFrameId=id(99);mocked.barriers.mockResolvedValue(runtime);
  await expect(collectDependenciesForVersion(database().client,pid,id(8),barrierOptions(),'pathfinder.dependencies.v8')).rejects.toMatchObject({code:'BARRIER_CALCULATION_SCOPE_CHANGED'});
 });
 it('refuses a legacy identity supplied to v8 rather than blessing it with new metadata',async()=>{
  retainOptions();await expect(collectDependenciesForVersion(database().client,pid,id(8),barrierOptions(),'pathfinder.dependencies.v8',false,syntheticEngineIdentity())).rejects.toMatchObject({code:'BARRIER_ADMISSION_REQUIRED'});
 });
});
describe('shared current endpoint collection',()=>{
 it('keeps unrelated global registry changes outside new v7 mathematics while retaining strict legacy hashes',async()=>{
  const read=(registry:string,version:'pathfinder.dependencies.v5'|'pathfinder.dependencies.v7')=>collectDependenciesForVersion(database(undefined,undefined,false,registry).client,pid,id(8),defaultOptions,version);
  const old=(await read('9','pathfinder.dependencies.v5')).dependencies!,oldAfter=(await read('10','pathfinder.dependencies.v5')).dependencies!;
  const scoped=(await read('9','pathfinder.dependencies.v7')).dependencies!,scopedAfter=(await read('10','pathfinder.dependencies.v7')).dependencies!;
  expect(hash(oldAfter)).not.toBe(hash(old));expect(hash(scopedAfter)).toBe(hash(scoped));
  expect(scoped.schemaVersion).toBe('pathfinder.dependencies.v7');expect(scoped).not.toHaveProperty('registryRevision');
  expect(scoped).toHaveProperty('endpointResolution',{schemaVersion:'pathfinder.endpoint-resolution.v1',matchingPolicy:'nfc-trim-uppercase-v1',
    from:{logicalKey:'=A-01',locationId:id(6)},to:{logicalKey:'=B.02',locationId:id(7)}});
 });
 it.each(['pathfinder.dependencies.v2','pathfinder.dependencies.v3','pathfinder.dependencies.v4','pathfinder.dependencies.v5','pathfinder.dependencies.v6'] as const)(
  'retains exact legacy current collection for a retained %s body instead of silently upgrading it',async version=>{
   const legacy=await collectDependencies(database().client,pid,id(8),defaultOptions);
   expect(await collectDependenciesForVersion(database().client,pid,id(8),defaultOptions,version)).toEqual(legacy);
  });
 it('preserves exact selected alias identity even when both logical names resolve to the same point and shared head',async()=>{
  const scoped=async(from:string,to:string)=> (await collectDependenciesForVersion(database(from,to,true).client,pid,id(8),defaultOptions,'pathfinder.dependencies.v7')).dependencies!;
  const first=await scoped('=A-01','=A-01'),alias=await scoped('=A-01','=A-ALIAS');
  expect(first.from).toEqual(alias.from);expect(first.to).toEqual(alias.to);expect(hash(first)).not.toBe(hash(alias));expect(geometryHash(first)).not.toBe(geometryHash(alias));
  expect(alias).toHaveProperty('endpointResolution.to',{logicalKey:'=A-ALIAS',locationId:id(6)});
 });
 it('stales scoped input when the chosen alias resolves to a different location despite equal coordinates',async()=>{
  const first=(await collectDependenciesForVersion(database('=A-01','=B.02',true).client,pid,id(8),defaultOptions,'pathfinder.dependencies.v7')).dependencies!;
  const next=(await collectDependenciesForVersion(database('=A-01','=B.02').client,pid,id(8),defaultOptions,'pathfinder.dependencies.v7')).dependencies!;
  expect(first.to.point).toEqual(next.to.point);expect(hash(next)).not.toBe(hash(first));expect(geometryHash(next)).not.toBe(geometryHash(first));
 });
 it('includes every relevant v7 dependency while limiting design-only reuse to same-version S/E/P changes',async()=>{
  const previous=(await collectDependenciesForVersion(database().client,pid,id(8),defaultOptions,'pathfinder.dependencies.v7')).dependencies!;
  expect(previous.schemaVersion).toBe('pathfinder.dependencies.v7');if(previous.schemaVersion!=='pathfinder.dependencies.v7')throw Error('Wrong scoped fixture.');
  const allowance={...previous,settings:{...previous.settings,revision:'2',endConnectionLength:'6'}};
  expect(verifiedDesignOnlyChange(allowance,previous)).toBe(true);expect(geometryHash(allowance)).toBe(geometryHash(previous));expect(hash(allowance)).not.toBe(hash(previous));
  const variants=[{...allowance,cableWriteRevision:'5'}, {...allowance,from:{...allowance.from,point:[9,2,3] as [number,number,number]}},
   {...allowance,from:{...allowance.from,locationRevision:'3'}}, {...allowance,model:{...allowance.model,selectionRevision:'2'}},
   {...allowance,routing:{...allowance.routing,routingPolicyRevision:'2'}}, {...allowance,engineIdentity:{...allowance.engineIdentity,contentSha256:'f'.repeat(64)}},
   {...allowance,endpointResolution:{...allowance.endpointResolution,from:{...allowance.endpointResolution.from,logicalKey:'=A-ALIAS'}}},
   {...allowance,settings:{...allowance.settings,connectionGap:'2'}}];
  for(const changed of variants){expect(hash(changed)).not.toBe(hash(previous));expect(verifiedDesignOnlyChange(changed,previous)).toBe(false);}
  const legacy=(await collectDependencies(database().client,pid,id(8),defaultOptions)).dependencies!;expect(verifiedDesignOnlyChange(allowance,legacy)).toBe(false);
 });
 it('does not create a scoped runnable snapshot for missing or empty logical endpoints',async()=>{
  const value=await collectDependenciesForVersion(database('',' ').client,pid,id(8),defaultOptions,'pathfinder.dependencies.v7');
  expect(value).toMatchObject({dependencies:null,status:'locations_required'});expect(mocked.binding).not.toHaveBeenCalled();
 });
 it('blocks an admitted pending comparison before resolving endpoints and does not erase it to null',async()=>{
  mocked.comparison.mockResolvedValue({applicability:'required',readiness:'pending',scope:null,reasonCodes:['REVISION_COMPARISON_PENDING'],reviewStatus:'unreviewed'});
  const result=await collectDependencies(database().client,pid,id(8),defaultOptions);
  expect(result).toMatchObject({status:'comparison_required',dependencies:null});expect(mocked.binding).not.toHaveBeenCalled();
 });
 it('freezes the exact per-target reviewed comparison token and invalidates route reuse on its change',async()=>{
  const scope={comparisonId:id(90),comparisonRevision:'7',sourceAggregateId:id(91),targetAggregateId:aggregateId,decisionSetSha256:'1'.repeat(64),contentSha256:'2'.repeat(64)};
  mocked.comparison.mockResolvedValue({applicability:'required',readiness:'ready',scope,reasonCodes:[],reviewStatus:'unreviewed'});
  const old=(await collectDependencies(database().client,pid,id(8),defaultOptions)).dependencies!;
  expect(old).toHaveProperty('comparison',scope);
  mocked.comparison.mockResolvedValue({applicability:'required',readiness:'ready',scope:{...scope,comparisonRevision:'8',decisionSetSha256:'3'.repeat(64)},reasonCodes:[],reviewStatus:'reviewed'});
  const next=(await collectDependencies(database().client,pid,id(8),defaultOptions)).dependencies!;
  expect(geometryHash(next)).not.toBe(geometryHash(old));
 });
 it('normalizes exact aliases and freezes both immutable bindings without querying v1 authority',async()=>{
  const db=database(),result=await collectDependencies(db.client,pid,id(8),defaultOptions);
  expect(result.status).toBe('ready');expect(result.dependencies?.schemaVersion).toBe('pathfinder.dependencies.v5');
  expect(result.dependencies).toHaveProperty('comparison',null);
  expect(result.dependencies?.from).toMatchObject({locationId:id(6),bindingId:id(16),bindingRevision:'3',mode:'fixed-world'});
  expect(result.dependencies?.to).toMatchObject({locationId:id(7),bindingId:id(17)});
  expect(mocked.automatic).not.toHaveBeenCalled();
  expect(db.query.mock.calls.filter(x=>x[0].includes('pf_location_aliases')).map(x=>x[1]?.[1])).toEqual(['=A-01','=B.02']);
  expect(db.query.mock.calls.some(x=>x[0].includes('pf_location_bindings'))).toBe(false);
 });
 it('uses one shared location at both ends and across unselected cable identities',async()=>{
  const db=database('=A-01','=A-ALIAS',true);
  const first=await collectDependencies(db.client,pid,id(8),defaultOptions),second=await collectDependencies(db.client,pid,id(9),defaultOptions);
  expect(first.dependencies?.from).toEqual(first.dependencies?.to);expect(second.dependencies?.from).toEqual(first.dependencies?.from);
  const old=first.dependencies!;mocked.binding.mockImplementation(async(_c:unknown,input:{locationId:string})=>({status:'confirmed',binding:{...binding(input.locationId),id:id(90),bindingRevision:'4'}}));
  const changed=await collectDependencies(db.client,pid,id(8),defaultOptions);
  expect(geometryHash(changed.dependencies!)).not.toBe(geometryHash(old));
 });
 it.each(['missing','stale','unsupported'])('blocks %s bindings instead of promoting old points',async(status)=>{
  mocked.binding.mockResolvedValue({status,code:'ENDPOINT_BINDING_REQUIRED'});const db=database();
  expect((await collectDependencies(db.client,pid,id(8),defaultOptions)).status).toBe('locations_required');
 });
 it('requires the exact current aggregate and projection rather than any artifact for the model',async()=>{
  mocked.context.mockResolvedValue({...context(),projectionSha256:'a'.repeat(64)});
  const result=await collectDependencies(database().client,pid,id(8),defaultOptions);
  expect(result.status).toBe('endpoint_preparation_required');expect(mocked.binding).not.toHaveBeenCalled();
 });
 it('keeps blank endpoints missing and never substitutes zero coordinates',async()=>{
  const result=await collectDependencies(database('','  ').client,pid,id(8),defaultOptions);
  expect(result.dependencies).toBeNull();expect(result.status).toBe('locations_required');expect(mocked.binding).not.toHaveBeenCalled();
 });
 it('freezes automatic-only ends as v6 proposal inputs and reuses one shared location across aliases',async()=>{
  const point={kind:'automatic-equipment-anchor',locationId:id(6),locationRevision:'2',point:[1,2,3],approximate:true,engineeringAccepted:false};
  mocked.binding.mockResolvedValue({status:'missing',code:'ENDPOINT_BINDING_REQUIRED'});
  mocked.automatic.mockResolvedValue(new Map([[id(6),{status:'automatic-ready',candidateObjectIds:['dbid:42'],point}]]));
  const result=await collectDependencies(database('=A-01','=A-ALIAS',true).client,pid,id(8),defaultOptions);
  expect(result.status).toBe('ready');expect(result.dependencies?.schemaVersion).toBe('pathfinder.dependencies.v6');
  expect(result.dependencies?.from).toEqual(point);expect(result.dependencies?.to).toEqual(point);
  expect(result.message).toMatch(/approximate automatic equipment anchors/);expect(mocked.automatic).toHaveBeenCalledTimes(1);
  expect(result.cable).toMatchObject({routing:'/OLD',design_length:23,install_length:24,cable_write_revision:'4'});
  expect(result.dependencies?.from).not.toHaveProperty('confirmedBy');
 });
 it.each(['stale','unsupported'])('never replaces an existing %s saved point with an automatic anchor',async status=>{
  mocked.binding.mockResolvedValue({status,code:'ENDPOINT_BINDING_STALE'});
  const result=await collectDependencies(database().client,pid,id(8),defaultOptions);
  expect(result.status).toBe('locations_required');expect(mocked.automatic).not.toHaveBeenCalled();
 });
});
