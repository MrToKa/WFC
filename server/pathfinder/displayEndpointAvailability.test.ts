// @vitest-environment node
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {EndpointBinding} from '../../shared/pathfinderEndpointBindings.js';
import {RECALCULATION_LIMITS} from '../../shared/pathfinderRecalculation.js';
import type {LocationDto} from './contracts.js';
import {PathFinderError} from './errors.js';
import {automaticEndpointContentHash,type AutomaticEndpointCalculationPoint} from './endpointCalculationProvenance.js';
import {readDisplayEndpointAvailability,type DisplayEndpointAvailabilityInput} from './displayEndpointAvailability.js';
const mocks=vi.hoisted(()=>({automatic:vi.fn()}));
vi.mock('./automaticEndpointCandidates.js',()=>({readAutomaticEndpointCandidates:mocks.automatic}));
const id=(n:number)=>`af000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=1800000000000;
const location=(n:number):LocationDto=>({id:id(n),name:'EQ'+n,aliases:[],revision:'1',binding:null});
function fixture(count=1){
  const current={modelVersionId:id(30),selectionRevision:'1',contentFingerprint:'a'.repeat(64),aggregateId:id(31),artifactId:id(32),projectionSha256:'b'.repeat(64),captureFrameId:id(33),geometryRevision:'1',traceId:id(34)},locations=Array.from({length:count},(_,n)=>location(n+1)),query=vi.fn(()=>{throw Error('Unexpected direct SQL in projection helper');}),client={query} as unknown as PoolClient;
  const input:DisplayEndpointAvailabilityInput={projectId:id(40),current,locations,heads:new Map(),locationIds:locations.map(value=>value.id),deadline:now+30000};
  const point=(n=1):AutomaticEndpointCalculationPoint=>{const body={kind:'automatic-equipment-anchor' as const,locationId:id(n),locationRevision:'1',point:[1,2,3] as[number,number,number],modelVersionId:current.modelVersionId,artifactId:current.artifactId,aggregateId:current.aggregateId,captureFrameId:current.captureFrameId,projectionSha256:current.projectionSha256,traceId:current.traceId,traceContentSha256:'c'.repeat(64),sourceObjectRevisionId:id(50+n),sourceObjectId:'dbid:'+n,sourceObjectRecordSha256:'d'.repeat(64),orderedPlanSha256:'e'.repeat(64),matchingEvidenceSha256:'f'.repeat(64),matchingPolicyVersion:'wfc.pf.project-exact-candidates.v2' as const,matchedNames:['EQ'+n],derivation:'equipment-bottom-aabb.v1' as const,approximate:true as const,engineeringAccepted:false as const};return{...body,contentSha256:automaticEndpointContentHash(body)};};
  mocks.automatic.mockImplementation(async(_client,request:{locationIds:string[]})=>new Map(request.locationIds.map((value:string)=>{const n=Number(value.slice(-12));return[value,{status:'automatic-ready',candidateObjectIds:['dbid:'+n],point:point(n)}];})));
  return{input,client,query,point,run:()=>readDisplayEndpointAvailability(client,input)};
}
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(Date,'now').mockReturnValue(now);});afterEach(()=>vi.restoreAllMocks());

describe('bounded display-only endpoint calculation availability',()=>{
  it('calls the existing resolver once for distinct used unbound IDs and returns no machine coordinates or confirmation',async()=>{
    const f=fixture(3);f.input.locationIds=[id(2),id(1),id(2),id(1)];const before=structuredClone(f.input.locations),result=await f.run();
    expect(mocks.automatic).toHaveBeenCalledExactlyOnceWith(f.client,{projectId:f.input.projectId,current:f.input.current,locationIds:[id(1),id(2)],deadline:f.input.deadline});expect(f.query).not.toHaveBeenCalled();
    expect(result.get(id(1))).toEqual({status:'automatic-ready',pointAvailable:true,source:'automatic-model-candidate',approximate:true,candidateObjectIds:['dbid:1'],reasonCode:null,engineeringAccepted:false});expect(result.get(id(3))).toMatchObject({status:'not-evaluated',reasonCode:'LOCATION_NOT_IN_CABLE_SCOPE'});expect(f.input.locations).toEqual(before);expect(JSON.stringify([...result])).not.toMatch(/"point"|bindingRevision|contentSha256|confirmedBy/);
  });
  it('preserves trusted confirmed head, stale head and legacy precedence without fallback or treating a DTO binding as authority',async()=>{
    const f=fixture(4);f.input.heads.set(id(1),{binding:{} as EndpointBinding,ready:true});f.input.heads.set(id(2),{binding:{} as EndpointBinding,ready:false});f.input.locations[2].binding={modelVersionId:id(30),revision:'1',point:[9,8,7],objectId:'legacy',externalId:null,source:'automatic',status:'confirmed'};
    const result=await f.run();expect(result.get(id(1))).toMatchObject({status:'confirmed-ready',pointAvailable:true,source:'confirmed-shared-location',approximate:false});expect(result.get(id(2))).toMatchObject({status:'saved-binding-required',reasonCode:'SAVED_BINDING_REQUIRES_CONFIRMATION'});expect(result.get(id(3))).toMatchObject({status:'saved-binding-required',reasonCode:'LEGACY_BINDING_REQUIRES_CONFIRMATION'});expect(mocks.automatic.mock.calls[0][1].locationIds).toEqual([id(4)]);
  });
  it.each(['current','trace'] as const)('explicitly requires missing %s evidence without running a resolver',async kind=>{
    const f=fixture();if(kind==='current')f.input.current=null;else f.input.current!.traceId=null;
    expect((await f.run()).get(id(1))).toMatchObject({status:'preparation-required',pointAvailable:false,reasonCode:kind==='current'?'CURRENT_PREPARATION_REQUIRED':'CURRENT_GEOMETRY_TRACE_REQUIRED'});expect(mocks.automatic).not.toHaveBeenCalled();
  });
  it.each(['missing','ambiguous','saved-binding-required','object-unverified','preparation-required'] as const)('preserves resolver %s evidence without inventing a point',async status=>{
    const f=fixture(),candidateObjectIds=status==='missing'||status==='preparation-required'?[]:['dbid:2','dbid:1'];mocks.automatic.mockResolvedValue(new Map([[id(1),{status,candidateObjectIds,point:null}]]));expect((await f.run()).get(id(1))).toMatchObject({status,pointAvailable:false,source:null,approximate:false,candidateObjectIds,engineeringAccepted:false});
  });
  it.each(['location','revision','model','artifact','aggregate','frame','projection','trace','hash','candidate','missing-point','blocked-point'] as const)('refuses inconsistent ready provenance %s rather than returning ready or ordinary missing',async kind=>{
    const f=fixture(),point=f.point();if(kind==='location')point.locationId=id(999);if(kind==='revision')point.locationRevision='2';if(kind==='model')point.modelVersionId=id(999);if(kind==='artifact')point.artifactId=id(999);if(kind==='aggregate')point.aggregateId=id(999);if(kind==='frame')point.captureFrameId=id(999);if(kind==='projection')point.projectionSha256='0'.repeat(64);if(kind==='trace')point.traceId=id(999);
    const {contentSha256:_hash,...body}=point;point.contentSha256=kind==='hash'?'0'.repeat(64):automaticEndpointContentHash(body);
    mocks.automatic.mockResolvedValue(new Map([[id(1),{status:kind==='blocked-point'?'missing':'automatic-ready',candidateObjectIds:[kind==='candidate'?'dbid:999':'dbid:1'],point:kind==='missing-point'?null:point}]]));await expect(f.run()).rejects.toMatchObject({code:'DISPLAY_ENDPOINT_AVAILABILITY_INTEGRITY'});
  });
  it.each(['AUTOMATIC_ENDPOINT_TRACE_INTEGRITY','AUTOMATIC_ENDPOINT_OBJECT_INTEGRITY','LOGIN_REVOKED','ADMIN_REQUIRED'] as const)('propagates %s rather than relabeling it as a display budget or missing',async code=>{
    const f=fixture(),failure=new PathFinderError(code,409);mocks.automatic.mockRejectedValue(failure);await expect(f.run()).rejects.toBe(failure);
  });
  it.each(['ENDPOINT_NEEDED_LOCATION_LIMIT','ENDPOINT_NEEDED_LOCATION_BYTES','RECALCULATION_COLLECTION_DEADLINE'] as const)('makes explicit not-evaluated for bounded resolver refusal %s',async code=>{
    const f=fixture(),failure=new PathFinderError(code,413);mocks.automatic.mockRejectedValue(failure);expect((await f.run()).get(id(1))).toMatchObject({status:'not-evaluated',pointAvailable:false});
  });
  it('does not truncate excess candidates into a false unique or missing result',async()=>{
    const f=fixture();mocks.automatic.mockResolvedValue(new Map([[id(1),{status:'ambiguous',candidateObjectIds:Array.from({length:2049},(_,n)=>'dbid:'+n),point:null}]]));expect((await f.run()).get(id(1))).toMatchObject({status:'not-evaluated',candidateObjectIds:[],reasonCode:'AVAILABILITY_CANDIDATE_LIMIT'});
  });
  it('bounds cumulative input and output bytes independently, returning explicit not-evaluated without truncation',async()=>{
    const f=fixture(),byteLength=Buffer.byteLength.bind(Buffer),spy=vi.spyOn(Buffer,'byteLength').mockImplementation((value,encoding)=>typeof value==='string'&&value.startsWith('{"location":')?RECALCULATION_LIMITS.neededLocationBytes+1:byteLength(value,encoding));
    expect((await f.run()).get(id(1))).toMatchObject({status:'not-evaluated',reasonCode:'AVAILABILITY_INPUT_BYTES'});expect(mocks.automatic).not.toHaveBeenCalled();spy.mockRestore();
    vi.spyOn(Buffer,'byteLength').mockImplementation((value,encoding)=>typeof value==='string'&&value.includes('"status":"automatic-ready"')?RECALCULATION_LIMITS.neededLocationBytes+1:byteLength(value,encoding));expect((await f.run()).get(id(1))).toMatchObject({status:'not-evaluated',reasonCode:'AVAILABILITY_OUTPUT_BYTES'});
  });
  it('bounds needed unique IDs and deadlines before resolver work',async()=>{
    const f=fixture(20001);expect((await f.run()).get(id(1))).toMatchObject({status:'not-evaluated',reasonCode:'AVAILABILITY_LOCATION_LIMIT'});expect(mocks.automatic).not.toHaveBeenCalled();
    const short=fixture();short.input.deadline=now-1;expect((await short.run()).get(id(1))).toMatchObject({status:'not-evaluated',reasonCode:'AVAILABILITY_DEADLINE'});expect(mocks.automatic).not.toHaveBeenCalled();
  });
  it('does not claim verified readiness from unknown locations, incomplete resolver output or a ready head without current scope',async()=>{
    const f=fixture();f.input.locationIds=[id(999)];await expect(f.run()).rejects.toMatchObject({code:'DISPLAY_ENDPOINT_AVAILABILITY_INTEGRITY'});f.input.locationIds=[id(1)];mocks.automatic.mockResolvedValue(new Map());await expect(f.run()).rejects.toMatchObject({code:'DISPLAY_ENDPOINT_AVAILABILITY_INTEGRITY'});f.input.current=null;f.input.heads.set(id(1),{binding:{} as EndpointBinding,ready:true});await expect(f.run()).rejects.toMatchObject({code:'DISPLAY_ENDPOINT_AVAILABILITY_INTEGRITY'});
  });
});
