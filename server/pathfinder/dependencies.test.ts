// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { collectDependencies, geometryHash } from './dependencies.js';
import { defaultOptions } from './jobContracts.js';
import { syntheticEngineIdentity } from './calculationFixtures.js';
vi.mock('./calculationEngineIdentity.js',()=>({calculationEngineIdentity:async()=>syntheticEngineIdentity()}));
const mocked=vi.hoisted(()=>({context:vi.fn(),binding:vi.fn(),active:vi.fn(),artifact:vi.fn(),routing:vi.fn(),settings:vi.fn(),comparison:vi.fn()}));
vi.mock('./repository.js',()=>({activeModel:mocked.active,latestArtifact:mocked.artifact}));
vi.mock('./endpointBindingRepository.js',()=>({readCurrentEndpointBindingContext:mocked.context,readEndpointBindingScope:mocked.binding}));
vi.mock('./routingScope.js',()=>({requirePreparedRoutingScope:mocked.routing}));
vi.mock('./settings.js',()=>({projectRoutingSettings:mocked.settings}));
vi.mock('./revisionComparisonRepository.js',()=>({readComparisonDependency:mocked.comparison}));
const id=(n:number)=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,pid=id(1),mid=id(2),artifactId=id(3),aggregateId=id(4),frameId=id(5);
const context=()=>({modelVersionId:mid,selectionRevision:'1',contentFingerprint:'c'.repeat(64),artifactId,aggregateId,projectionSha256:'d'.repeat(64),captureFrameId:frameId,geometryRevision:'2',traceId:null});
const binding=(locationId:string)=>({id:id(locationId===id(6)?16:17),locationId,artifactId,locationRevision:'2',bindingRevision:'3',pointProjectMetres:[1,2,3],contentSha256:'a'.repeat(64),mode:'fixed-world',captureFrameId:frameId,qualifiedProjectFrameId:null,aggregateId,projectionSha256:'d'.repeat(64),sourceObject:null,sourceDecisionId:null});
function database(from='  =a-01 ',to='=B.02',shared=false){
 const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
  if(sql.includes('FROM cables WHERE'))return{rows:[{id:args[1],from_location:from,to_location:to,mto:'Instrumentation',cable_type_id:id(10),cable_write_revision:'4',routing:'/OLD',design_length:23,install_length:24}]};
  if(sql.includes('FROM pf_project_state'))return{rows:[{registry_revision:'9'}]};
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
});
describe('shared current endpoint collection',()=>{
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
});
