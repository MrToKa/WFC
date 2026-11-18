// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({current:vi.fn(),candidate:vi.fn(),confirm:vi.fn(),display:vi.fn()}));
vi.mock('./endpointBindingRepository.js',async original=>({...await original<typeof import('./endpointBindingRepository.js')>(),readCurrentEndpointBindingContext:mocks.current,confirmEndpointBindingChangeInTransaction:mocks.confirm}));
vi.mock('./automaticEndpointCandidates.js',()=>({createAutomaticNamedEndpointCandidateReader:()=>mocks.candidate}));
vi.mock('./modelLocationMatchDisplay.js',()=>({readMatchedLocationDisplay:mocks.display}));
import {endpointBindingFixture,endpointFixtureId as id} from './endpointBindingFixtures.js';
import {recoverCrossModelEndpointsInTransaction} from './crossModelEndpointRecovery.js';
import type {PoolClient} from 'pg';
import {endpointBindingHash} from './endpointBindingRepository.js';
beforeEach(()=>{mocks.current.mockReset();mocks.candidate.mockReset();mocks.confirm.mockReset();mocks.display.mockReset().mockResolvedValue({sdkObjectId:1});});
async function fixture(){
 const f=endpointBindingFixture();await f.repo.confirm(f.f.aggregate.projectId,f.who,f.locationId,f.command());const head=f.state.bindings.get(f.state.heads.get(f.locationId)!)!;
 mocks.current.mockResolvedValue({modelVersionId:id(951),selectionRevision:'2',contentFingerprint:'b'.repeat(64),aggregateId:id(952),artifactId:id(953),projectionSha256:'c'.repeat(64),captureFrameId:id(954),geometryRevision:'2',traceId:id(955)});
 const original=f.query.getMockImplementation()!,diagnostics:unknown[]=[];
 f.query.mockImplementation(async(sql,args=[])=>{if(sql.startsWith('/* cross-model-endpoints:needed */'))return {rows:[{}]};if(sql.startsWith('/* cross-model-endpoints:heads */'))return {rows:[{id:f.locationId,name:'Equipment',revision:head.locationRevision,record:head,aliases:[]}]};if(sql.startsWith('/* cross-model-endpoints:checked */'))return {rows:[]};if(sql.startsWith('/* cross-model-endpoints:diagnostic */')){diagnostics.push(args[5]);return {rows:[]};}return original(sql,args);});
 return {...f,diagnostics};
}
describe('native cross-model identity recovery refusal isolation',()=>{
 it.each([{status:'missing',candidateObjectIds:[],point:null,objectId:null,reason:'MODEL_LOCATION_CROSS_MODEL_MISSING'},{status:'ambiguous',candidateObjectIds:['1','2'],point:null,objectId:null,reason:'MODEL_LOCATION_CROSS_MODEL_AMBIGUOUS'},{status:'automatic-ready',candidateObjectIds:['1'],point:[2.3,3,4],objectId:'1',reason:'MODEL_LOCATION_CROSS_MODEL_DISTANCE_EXCEEDED'}])('preserves old point and stores explicit diagnostic for $status',async item=>{
  const f=await fixture(),before=structuredClone(f.state.bindings);mocks.candidate.mockResolvedValue(item);
  expect(await recoverCrossModelEndpointsInTransaction(f.client as unknown as PoolClient,f.f.aggregate.projectId,f.who,AbortSignal.timeout(30000))).toBe(0);expect(mocks.confirm).not.toHaveBeenCalled();expect(f.state.bindings).toEqual(before);expect(f.diagnostics).toEqual([expect.objectContaining({updated:false,reasonCode:item.reason})]);
 });
 it.each([0,0.25])('publishes the verified NEW object through the real binding writer at %s m and retains old revision',async distance=>{
  const f=await fixture(),head=f.state.bindings.get(f.state.heads.get(f.locationId)!)!,object=f.built.records[2],anchor=object.geometry.equipmentAnchor!.pointMetres;
  head.modelVersionId=id(951);head.pointProjectMetres=[anchor[0],anchor[1],anchor[2]+distance];const {contentSha256:_sha,...body}=head;head.contentSha256=endpointBindingHash(body);const before=structuredClone(head);
  const a=f.f.aggregate,current={modelVersionId:a.modelVersionId,selectionRevision:a.selectionRevision,contentFingerprint:a.contentFingerprint,aggregateId:a.id,artifactId:a.artifactId,projectionSha256:a.projection.sha256,captureFrameId:a.coordinateFrameId,geometryRevision:a.geometryRevision,traceId:f.built.manifest.id};mocks.current.mockResolvedValue(current);
  mocks.candidate.mockResolvedValue({status:'automatic-ready',candidateObjectIds:[object.identity.objectId],point:anchor,objectId:object.identity.objectId});
  const original=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,args=[])=>sql.startsWith('/* cross-model-endpoints:object */')?{rows:[{record:object,record_sha256:endpointBindingHash(object)}]}:original(sql,args));
  const actual=await vi.importActual<typeof import('./endpointBindingRepository.js')>('./endpointBindingRepository.js');mocks.confirm.mockImplementation(actual.confirmEndpointBindingChangeInTransaction);
  expect(await recoverCrossModelEndpointsInTransaction(f.client as unknown as PoolClient,a.projectId,f.who,AbortSignal.timeout(30000))).toBe(1);
  expect(mocks.confirm).toHaveBeenCalledWith(f.client,a.projectId,f.who,f.locationId,expect.objectContaining({mode:'object-derived',expectedRegistryRevision:before.locationRegistryRevision,expectedLocationRevision:before.locationRevision,expectedHeadId:before.id,modelVersionId:current.modelVersionId,aggregateId:current.aggregateId,object:{traceId:current.traceId,objectRevisionId:object.id,recordSha256:endpointBindingHash(object)}}),expect.any(AbortSignal));
  const after=f.state.bindings.get(f.state.heads.get(f.locationId)!)!;expect(after.modelVersionId).toBe(current.modelVersionId);expect(after.pointProjectMetres).toEqual(anchor);expect(after.sourceObject?.objectRevisionId).toBe(object.id);expect(after.supersedesBindingId).toBe(before.id);expect(f.state.bindings.get(before.id)).toEqual(before);
 });
 it('does not read/research any model when no different-model saved heads exist',async()=>{const f=endpointBindingFixture(),original=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,args=[])=>sql.startsWith('/* cross-model-endpoints:needed */')?{rows:[]}:original(sql,args));expect(await recoverCrossModelEndpointsInTransaction(f.client as unknown as PoolClient,f.f.aggregate.projectId,f.who,AbortSignal.timeout(30000))).toBe(0);expect(mocks.current).not.toHaveBeenCalled();expect(mocks.candidate).not.toHaveBeenCalled();});
 it.each([0,.25,.250001])('checks a proved OLD centre against the NEW centre (%sm) before normal bottom admission',async distance=>{
  const f=await fixture(),head=f.state.bindings.get(f.state.heads.get(f.locationId)!)!,object=f.built.records[2],bounds=object.geometry.bounds,anchor=object.geometry.equipmentAnchor!.pointMetres;
  const centre=bounds.minimum.map((v,i)=>(v+bounds.maximum[i])/2) as [number,number,number];
  head.modelVersionId=id(951);head.pointProjectMetres=[centre[0]+distance,centre[1],centre[2]];head.derivation='matched-model-centre-fallback.v1';
  const oldBounds={minimum:bounds.minimum.map((v,i)=>v+(i===0?distance:0)) as [number,number,number],maximum:bounds.maximum.map((v,i)=>v+(i===0?distance:0)) as [number,number,number]};
  const prior={modelVersionId:head.modelVersionId,selectionRevision:'1',contentFingerprint:'a'.repeat(64),aggregateId:head.aggregateId,artifactId:head.artifactId,projectionSha256:head.projectionSha256,captureFrameId:head.captureFrameId,geometryRevision:'1',traceId:f.built.manifest.id};
  head.autoMatchEvidence={schemaVersion:'wfc.pf.model-location-match-evidence.v1',operationId:id(971),commandSha256:'a'.repeat(64),scanSha256:'a'.repeat(64),namesSha256:'a'.repeat(64),current:prior,logicalKey:'EQUIPMENT',sdkObjectId:1,objectName:'Pump',bounds:oldBounds,
   bottomCentre:[head.pointProjectMetres[0],head.pointProjectMetres[1],oldBounds.minimum[2]],matchingPolicyVersion:'wfc.pf.project-exact-candidates.v3',visibilityScopeSha256:'a'.repeat(64),approximate:true,engineeringAccepted:false};
  head.centreFallbackEvidence={schemaVersion:'wfc.pf.endpoint-centre-fallback.v1',sourceBindingId:id(972),sourceBindingSha256:'a'.repeat(64),commandId:id(973),actorId:f.who.userId,current:prior,sourceJobId:id(974),sourceCableId:id(975),sourceDependencySha256:'a'.repeat(64),side:'to',failedRequestId:id(976),failedResultSha256:'a'.repeat(64),trialRequestId:id(977),trialRequestSha256:'a'.repeat(64),trialResultSha256:'a'.repeat(64),barrierProofSha256:'a'.repeat(64),policy:'blocked-automatic-bottom-to-same-bounds-centre.v1',approximate:true,engineeringAccepted:false,authority:'machine-derived-under-current-human-job'};
  const {contentSha256:_old,...body}=head;head.contentSha256=endpointBindingHash(body);
  const a=f.f.aggregate;mocks.current.mockResolvedValue({...prior,modelVersionId:a.modelVersionId,aggregateId:a.id,artifactId:a.artifactId,projectionSha256:a.projection.sha256,captureFrameId:a.coordinateFrameId});
  mocks.candidate.mockResolvedValue({status:'automatic-ready',candidateObjectIds:[object.identity.objectId],point:anchor,objectId:object.identity.objectId});
  const original=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,args=[])=>sql.startsWith('/* cross-model-endpoints:object */')?{rows:[{record:object,record_sha256:endpointBindingHash(object)}]}:original(sql,args));
  expect(await recoverCrossModelEndpointsInTransaction(f.client as unknown as PoolClient,a.projectId,f.who,AbortSignal.timeout(30000))).toBe(distance<=.25?1:0);
  if(distance<=.25)expect(mocks.confirm).toHaveBeenCalledWith(f.client,a.projectId,f.who,f.locationId,expect.objectContaining({mode:'object-derived',anchorRule:'equipment-bottom-aabb.v1'}),expect.any(AbortSignal));
  else expect(f.diagnostics).toEqual([expect.objectContaining({reasonCode:'MODEL_LOCATION_CROSS_MODEL_DISTANCE_EXCEEDED'})]);
  expect(mocks.display).toHaveBeenCalled();
 });
});
