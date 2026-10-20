// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {preparationContextSchema,preparationCreateSchema,preparationPlanHashInput,type PreparationPlan} from '../../shared/pathfinderPreparation.js';
import {canonicalPurposeJson} from '../../shared/pathfinderPurposePolicy.js';
import {buildPreparationPlan} from './preparationPlans.js';
import {snapshotSchema,type ComputationalSnapshot} from './contracts.js';
import {executePreparationUnionTask,preparationUnionInputSchema,preparationUnionMessageSchema,checkPreparationUnionInputBytes,parseOwnedPreparationSnapshot,type PreparationUnionTaskStorage} from './preparationUnionTask.js';
import {LEGACY_PREPARATION_CAPACITY_PROFILE,LARGE_PREPARATION_CAPACITY_PROFILE,preparationCapacity} from '../../shared/pathfinderCapacity.js';
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function fixture(){
 const scope={modelVersionId:uuid(2),contentFingerprint:'a'.repeat(64),selectionRevision:'1',catalogRevision:'1',routingContentSha256:'b'.repeat(64),routingPolicyRevision:'1',routingPolicySha256:'c'.repeat(64),locationRegistryRevision:'1',resolutionRevision:'0'};
 const context=preparationContextSchema.parse({schemaVersion:'wfc.pf.preparation-context.v1',projectId:uuid(1),scope,trays:[{projectTrayId:uuid(3),rawName:'/B001',purposeKey:'LV',routeName:'/B001',allowedCategories:['LV'],policyState:'configured',diagnosticCodes:[]}],endpointNames:[],resolutions:[],diagnostics:[],currentAggregate:null});
 const manifest=[{objectId:'dbid:1',parentId:null,name:'Plant',hasGeometry:false,isPhysicalLeaf:false,orderIndex:0},{objectId:'dbid:2',parentId:'dbid:1',name:'/B001',hasGeometry:false,isPhysicalLeaf:false,orderIndex:1},{objectId:'dbid:3',parentId:'dbid:2',name:'STRAIGHT',hasGeometry:true,isPhysicalLeaf:true,orderIndex:2}];
 const create=preparationCreateSchema.parse({schemaVersion:'wfc.pf.preparation-create.v1',expected:scope,idempotencyKey:uuid(4),discovery:{schemaVersion:'wfc.pf.discovery-report.v1',modelVersionId:scope.modelVersionId,contentFingerprint:scope.contentFingerprint,selectionRevision:scope.selectionRevision,matchingPolicyVersion:'wfc.pf.project-exact-candidates.v1',complete:true,propertyScan:null,objects:manifest,trays:[{projectTrayId:uuid(3),candidateRootObjectIds:['dbid:2']}],endpointCandidates:[]}});
 const plan=buildPreparationPlan(context,create,uuid(5)),box={minimum:[0,0,0] as [number,number,number],maximum:[1,1,0] as [number,number,number]};
 const snapshot:ComputationalSnapshot={schemaVersion:'pathfinder.model.snapshot.v1',model:{projectId:plan.projectId,modelVersionId:plan.modelVersionId,contentSha256:plan.contentFingerprint},capture:{adapterVersion:'wfc.protected-selected-capture.v1',sourceKind:'converted',inventoryComplete:false,geometryComplete:false,unitsVerified:false,transformsVerified:false,planningVisibilityKnown:false,sourceLinkVerified:false,evidenceSha256:['f'.repeat(64)]},coordinates:{vertexFrame:'canonical-world-metres',sourceUnits:'m',metresPerSourceUnit:1,sourceToWorldMetres:matrix,displayToWorldMetres:matrix,globalOffsetMetres:[0,0,0]},objects:manifest.map((object,index)=>({id:object.objectId,parentId:object.parentId,dbId:index+1,name:object.name,geometryRole:index===2?'routing-leaf':'hierarchy',leafToRootNames:index===2?['STRAIGHT','/B001','Plant']:index===1?['/B001','Plant']:['Plant'],properties:[],nativeHidden:null,planningExcluded:false,categoryAssignmentSource:index===2?'explicit-planning':'unassigned',allowedCategories:index===2?['LV']:[],...(index===2?{routeName:'/B001',shapeName:'STRAIGHT'}:{}),bounds:box,fragments:index===2?[{id:'fragment:1',vertices:[[0,0,0],[1,0,0],[0,1,0]],triangleIndices:[0,1,2],fragmentToWorldMetres:matrix,transformAlreadyApplied:true}]:[]}))};
 const input=preparationUnionInputSchema.parse({schemaVersion:'wfc.pf.preparation-union-task.v1',requestId:uuid(6),snapshotId:uuid(7),plan,parts:[{partId:plan.partPlan[0].partId,payload:snapshot}],storageLockBuffer:new SharedArrayBuffer(4)});
 if(input.schemaVersion!=='wfc.pf.preparation-union-task.v1')throw new Error('inline fixture');
 const hash=(text:string)=>({sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)});
 const storage:PreparationUnionTaskStorage={storeSnapshot:vi.fn(async(_id,value)=>hash(JSON.stringify(value))),storePreparationBlob:vi.fn(async(_project,_session,id,value)=>({payloadRef:id,...hash(canonicalPurposeJson(value))}))};
 return{input,storage};
}
const rehash=(plan:PreparationPlan)=>{plan.orderedPlanSha256=createHash('sha256').update(canonicalPurposeJson(preparationPlanHashInput(plan))).digest('hex');};
function twoPartFixture(){
 const result=fixture(),{input}=result,second=structuredClone(input.parts[0].payload) as ComputationalSnapshot,leaf=second.objects[2];
 leaf.id='dbid:4';leaf.dbId=4;leaf.name='STRAIGHT 2';leaf.shapeName='STRAIGHT 2';leaf.leafToRootNames[0]='STRAIGHT 2';leaf.fragments[0].id='fragment:2';
 for(const object of second.objects)object.bounds={minimum:[3,0,0],maximum:[4,1,0]};leaf.fragments[0].vertices=[[3,0,0],[4,0,0],[3,1,0]];
 input.plan.objectManifest.push({...input.plan.objectManifest[2],objectId:'dbid:4',name:'STRAIGHT 2',orderIndex:3});input.plan.objectOrder.push(4);input.plan.requestedScope.orderedPhysicalLeafIds.push('dbid:4');
 const part=structuredClone(input.plan.partPlan[0]);part.partId=uuid(8);part.partIndex=1;part.physicalLeafIds=['dbid:4'];part.objects[0].objectId=4;part.objects[0].shapeName='STRAIGHT 2';input.plan.partPlan.push(part);input.parts.push({partId:part.partId,payload:second});rehash(input.plan);
 return result;
}
function referencesFor(input:ReturnType<typeof twoPartFixture>['input']){
 const bytes=new Map<string,Buffer>(),parts=input.parts.map((part,index)=>{const payload=Buffer.from(canonicalPurposeJson(part.payload)),payloadRef=uuid(20+index);bytes.set(payloadRef,payload);return{partId:part.partId,reference:{payloadRef,sha256:createHash('sha256').update(payload).digest('hex'),bytes:payload.length}};});
 return{bytes,parts};
}
describe('isolated preparation union geometry task',()=>{
 it.each(['wfc.protected-selected-capture.v1','wfc.project-preparation-aggregate.v1'])('the owned parser preserves visible SDK metadata for the exact %s converted envelope without a full reparse',adapterVersion=>{
  const {input}=fixture(),snapshot=structuredClone(input.parts[0].payload) as ComputationalSnapshot,object=snapshot.objects[0];
  snapshot.capture.adapterVersion=adapterVersion;object.geometryRole='object';
  object.equipmentEligibility={schemaVersion:'wfc.pf.equipment-eligibility.v1',matchingPolicyVersion:'wfc.pf.project-exact-candidates.v3',visibilityScopeSha256:'a'.repeat(64),visibility:'visible',checkedAncestorCount:1,fragmentStatus:'geometry-free-node-bounds',fragmentCount:0};
  const expected=snapshotSchema.parse(snapshot),actual=parseOwnedPreparationSnapshot(snapshot);
  expect(actual).toEqual(expected);expect(actual.objects[0].nativeHidden).toBeNull();expect(actual.capture.planningVisibilityKnown).toBe(false);
 });
 it.each(['source','adapter','native-visible','explicit-null','inventoryComplete','geometryComplete','unitsVerified','transformsVerified','planningVisibilityKnown','sourceLinkVerified'] as const)('the owned parser applies full display envelope guards for %s before fitting/storage',kind=>{
  const {input}=fixture(),snapshot=structuredClone(input.parts[0].payload) as ComputationalSnapshot,object=snapshot.objects[0];object.geometryRole='object';
  object.equipmentEligibility={schemaVersion:'wfc.pf.equipment-eligibility.v1',matchingPolicyVersion:'wfc.pf.project-exact-candidates.v3',visibilityScopeSha256:'a'.repeat(64),visibility:'visible',checkedAncestorCount:1,fragmentStatus:'geometry-free-node-bounds',fragmentCount:0};
  if(kind==='source')snapshot.capture.sourceKind='synthetic';else if(kind==='adapter')snapshot.capture.adapterVersion='custom-adapter';
  else if(kind==='native-visible')object.nativeHidden=false;else if(kind==='explicit-null')Object.assign(object,{equipmentEligibility:null});else snapshot.capture[kind]=true;
  expect(snapshotSchema.safeParse(snapshot).success).toBe(false);expect(()=>parseOwnedPreparationSnapshot(snapshot)).toThrow();
 });
 it('uses the exact frozen plan and strict snapshot, canonicalizes member keys while retaining every array order, and returns only references',async()=>{
  const{input,storage}=fixture(),result=await executePreparationUnionTask(input,storage);expect(Object.keys(result).sort()).toEqual(['counts','projection','snapshotId','traceIndex']);expect(result.counts).toEqual({objects:3,physicalLeaves:1,fragments:1,vertices:3,triangles:1});expect(result.projection.payloadRef).toBe(input.snapshotId);
  expect(storage.storePreparationBlob).toHaveBeenCalledTimes(2);expect(storage.storePreparationBlob).toHaveBeenNthCalledWith(1,input.plan.projectId,input.plan.id,input.snapshotId,expect.any(Object),32*1024**2);
  const value=vi.mocked(storage.storeSnapshot).mock.calls[0][1] as ComputationalSnapshot;expect(value.objects.map(object=>object.id)).toEqual(['dbid:1','dbid:2','dbid:3']);expect(value.objects[2].fragments[0].triangleIndices).toEqual([0,1,2]);expect(JSON.stringify(value)).toBe(canonicalPurposeJson(value));expect(value.capture.geometryComplete).toBe(false);expect(value.capture.sourceLinkVerified).toBe(false);
 });
 it.each(['mask','nonfinite','missing','native-proof'] as const)('rejects %s data before storing any projection',async kind=>{
  const{input,storage}=fixture(),snapshot=input.parts[0].payload as ComputationalSnapshot;if(kind==='mask')snapshot.objects[2].allowedCategories=['MV'];if(kind==='nonfinite')snapshot.objects[2].fragments[0].vertices[0][0]=Infinity;if(kind==='missing')snapshot.objects.pop();if(kind==='native-proof')snapshot.capture.geometryComplete=true;
  await expect(executePreparationUnionTask(input,storage)).rejects.toBeDefined();expect(storage.storeSnapshot).not.toHaveBeenCalled();expect(storage.storePreparationBlob).not.toHaveBeenCalled();
 });
 it('does not return a reusable receipt when the two immutable storage representations disagree',async()=>{
  const{input,storage}=fixture();vi.mocked(storage.storeSnapshot).mockResolvedValue({sha256:'0'.repeat(64),bytes:1});await expect(executePreparationUnionTask(input,storage)).rejects.toThrow('PREPARATION_UNION_STORAGE');expect(storage.storePreparationBlob).toHaveBeenCalledTimes(1);
 });
 it('obtains quota-accounted projection storage before creating any snapshot cache copy',async()=>{
  const{input,storage}=fixture();vi.mocked(storage.storePreparationBlob).mockRejectedValueOnce(new Error('quota refused'));await expect(executePreparationUnionTask(input,storage)).rejects.toThrow('quota refused');expect(storage.storeSnapshot).not.toHaveBeenCalled();
 });
 it('strictly rejects foreign protocol fields, arbitrary paths, unknown versions and a different shared lock size',()=>{
  const{input}=fixture();for(const change of [{filename:'C:/foreign/file'},{schemaVersion:'v99'},{storageLockBuffer:new SharedArrayBuffer(8)},{plan:{...input.plan,filename:'C:/foreign/file'}}])expect(preparationUnionInputSchema.safeParse({...input,...change}).success).toBe(false);
  expect(preparationUnionMessageSchema.safeParse({schemaVersion:'wfc.pf.preparation-union-message.v1',requestId:input.requestId,type:'error',code:'private-path-secret'}).success).toBe(false);
 });
 it('bounds the effective preload input independently of the unchanged 256MiB hard union limit',()=>{
  const{input}=fixture();
  expect(()=>checkPreparationUnionInputBytes(input.plan,[{partId:input.parts[0].partId,payload:{text:'x'.repeat(32*1024**2)}}])).toThrow('PREPARATION_UNION_LIMIT');expect(()=>checkPreparationUnionInputBytes({...input.plan,text:'x'.repeat(16*1024**2)},[])).toThrow('PREPARATION_UNION_LIMIT');
 });
 it.each([LEGACY_PREPARATION_CAPACITY_PROFILE,LARGE_PREPARATION_CAPACITY_PROFILE])('accounts exact cumulative input boundary for frozen %s without enlarging transport or geometry limits',profile=>{
  // Synthetic byte accounting only: no large model is allocated or claimed to fit the worker heap.
  const actual=Buffer.byteLength.bind(Buffer),maximum=preparationCapacity(profile).validationInputBytes;
  const bytes=vi.spyOn(Buffer,'byteLength').mockImplementation((value,encoding)=>typeof value==='string'&&value==='{"counted":1}'?maximum:typeof value==='string'&&value==='{"counted":2}'?1:actual(value,encoding));
  try{
   const single=fixture().input;single.plan.limitsProfile=profile;rehash(single.plan);
   expect(checkPreparationUnionInputBytes(single.plan,[{partId:single.parts[0].partId,payload:{counted:1}}])).toBe('inline');
   const multi=twoPartFixture().input;multi.plan.limitsProfile=profile;rehash(multi.plan);
   expect(()=>checkPreparationUnionInputBytes(multi.plan,multi.parts.map((part,index)=>({partId:part.partId,payload:{counted:index+1}})))).toThrow('PREPARATION_UNION_LIMIT');
  }finally{bytes.mockRestore();}
 });
 it('admits above legacy input only for the explicit larger frozen profile, failing closed on missing evidence',()=>{
  const actual=Buffer.byteLength.bind(Buffer),bytes=vi.spyOn(Buffer,'byteLength').mockImplementation((value,encoding)=>typeof value==='string'&&value==='{"counted":1}'?32*1024**2+1:actual(value,encoding));
  try{
   const{input}=fixture(),parts=[{partId:input.parts[0].partId,payload:{counted:1}}];
   expect(()=>checkPreparationUnionInputBytes(input.plan,parts)).toThrow('PREPARATION_UNION_LIMIT');
   input.plan.limitsProfile=LARGE_PREPARATION_CAPACITY_PROFILE;rehash(input.plan);expect(checkPreparationUnionInputBytes(input.plan,parts)).toBe('inline');
   for(const plan of [{},{limitsProfile:'unlimited'},null])expect(()=>checkPreparationUnionInputBytes(plan,[])).toThrow('PREPARATION_UNION_LIMIT');
  }finally{bytes.mockRestore();}
 });
 it('refuses a profile substitution under an old ordered plan hash before writing any geometry',async()=>{
  const{input,storage}=fixture();input.plan.limitsProfile=LARGE_PREPARATION_CAPACITY_PROFILE;
  await expect(executePreparationUnionTask(input,storage)).rejects.toThrow('PREPARATION_UNION_INVALID');
  expect(storage.storePreparationBlob).not.toHaveBeenCalled();expect(storage.storeSnapshot).not.toHaveBeenCalled();
 });
 it('binds larger projection storage to the explicit freshly hashed plan and returns the same geometric output',async()=>{
  const{input,storage}=fixture();input.plan.limitsProfile=LARGE_PREPARATION_CAPACITY_PROFILE;
  const{orderedPlanSha256:_old,...body}=input.plan;input.plan.orderedPlanSha256=createHash('sha256').update(canonicalPurposeJson(body)).digest('hex');
  const result=await executePreparationUnionTask(input,storage);
  expect(result.counts).toEqual({objects:3,physicalLeaves:1,fragments:1,vertices:3,triangles:1});
  expect(storage.storePreparationBlob).toHaveBeenNthCalledWith(1,input.plan.projectId,input.plan.id,input.snapshotId,expect.any(Object),128*1024**2);
 });
 it('streams immutable references in frozen order with exact inline projection/index hashes and no caller-input mutation',async()=>{
  const{input,storage}=twoPartFixture(),before=structuredClone(input.parts),inline=await executePreparationUnionTask(input,storage),refs=referencesFor(input);
  const reads:string[]=[],read=vi.fn(async(project:string,session:string,reference:{payloadRef:string})=>{expect([project,session]).toEqual([input.plan.projectId,input.plan.id]);reads.push(reference.payloadRef);return Buffer.from(refs.bytes.get(reference.payloadRef)!);});
  storage.readPreparationBlob=read;
  const referenceInput=preparationUnionInputSchema.parse({...input,schemaVersion:'wfc.pf.preparation-union-task.v2',parts:[...refs.parts].reverse()}),reference=await executePreparationUnionTask(referenceInput,storage);
  expect(reference.projection.sha256).toBe(inline.projection.sha256);expect(reference.projection.bytes).toBe(inline.projection.bytes);expect(reference.traceIndex.sha256).toBe(inline.traceIndex.sha256);expect(reference.counts).toEqual(inline.counts);
  expect(reads).toEqual(refs.parts.map(part=>part.reference.payloadRef));expect(read).toHaveBeenCalledTimes(2);expect(input.parts).toEqual(before);
  expect(storage.storeSnapshot).toHaveBeenLastCalledWith(input.snapshotId,expect.objectContaining({objects:expect.arrayContaining([expect.objectContaining({id:'dbid:4'})])}));
 });
 it('retains deterministic duplicate-identical legacy inline replay and refuses conflicting replay',async()=>{
  const{input,storage}=twoPartFixture(),normal=await executePreparationUnionTask(input,storage),duplicate=structuredClone(input.parts[0]),payload=duplicate.payload as ComputationalSnapshot;
  payload.objects[2].fragments[0].id=' fragment:1 ';
  const replay=await executePreparationUnionTask({...input,parts:[input.parts[1],duplicate,input.parts[0]]},storage);
  expect(replay.projection.sha256).toBe(normal.projection.sha256);expect(replay.traceIndex.sha256).toBe(normal.traceIndex.sha256);
  payload.objects[2].properties=[{category:'Source',name:'Changed',value:'yes'}];vi.mocked(storage.storePreparationBlob).mockClear();
  await expect(executePreparationUnionTask({...input,parts:[...input.parts,duplicate]},storage)).rejects.toThrow('PREPARATION_UNION_INVALID');expect(storage.storePreparationBlob).not.toHaveBeenCalled();
 });
 it('uses one exact canonical byte representation for quota projection before the independently stored cache',async()=>{
  const{input,storage}=twoPartFixture(),refs=referencesFor(input),writes:{kind:string;bytes:Buffer}[]=[];
  storage.readPreparationBlob=vi.fn(async(_project,_session,ref)=>Buffer.from(refs.bytes.get(ref.payloadRef)!));
  const hash=(bytes:Buffer)=>({sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
  storage.storePreparationBytes=vi.fn(async(_project,_session,id,bytes)=>{writes.push({kind:'projection',bytes:Buffer.from(bytes)});return{payloadRef:id,...hash(bytes)};});
  storage.storeSnapshotBytes=vi.fn(async(_id,bytes)=>{writes.push({kind:'cache',bytes:Buffer.from(bytes)});return hash(bytes);});
  const result=await executePreparationUnionTask(preparationUnionInputSchema.parse({...input,schemaVersion:'wfc.pf.preparation-union-task.v2',parts:refs.parts}),storage);
  expect(writes.map(write=>write.kind)).toEqual(['projection','cache']);expect(writes[0].bytes.equals(writes[1].bytes)).toBe(true);
  const encoded=writes[0].bytes.toString('utf8');expect(encoded).toBe(canonicalPurposeJson(JSON.parse(encoded)));expect(result.projection.sha256).toBe(hash(writes[0].bytes).sha256);
  expect(storage.storeSnapshot).not.toHaveBeenCalled();expect(storage.storePreparationBlob).toHaveBeenCalledExactlyOnceWith(input.plan.projectId,input.plan.id,expect.any(String),expect.objectContaining({schemaVersion:'wfc.pf.preparation-trace-index.v1'}),256*1024**2);
 });
 it.each(['hash','bytes','schema','wrong-scope','nonfinite','unknown-header','unknown-object'] as const)('refuses reference %s before either projection or cache write',async kind=>{
  const{input,storage}=fixture(),refs=referencesFor(input);let bytes=refs.bytes.get(refs.parts[0].reference.payloadRef)!;
  if(!['hash','bytes'].includes(kind)){
   const value=JSON.parse(bytes.toString('utf8'));
   if(kind==='schema')value.objects[2].fragments[0].triangleIndices=[99,0,1];if(kind==='wrong-scope')value.model.modelVersionId=uuid(99);if(kind==='nonfinite')value.objects[2].fragments[0].vertices[0][0]='Infinity';if(kind==='unknown-header')value.filename='/foreign';if(kind==='unknown-object')value.objects[0].filename='/foreign';
   bytes=Buffer.from(JSON.stringify(value));refs.parts[0].reference.bytes=bytes.length;refs.parts[0].reference.sha256=createHash('sha256').update(bytes).digest('hex');
  }
  if(kind==='hash')refs.parts[0].reference.sha256='0'.repeat(64);if(kind==='bytes')refs.parts[0].reference.bytes++;
  storage.readPreparationBlob=vi.fn(async()=>bytes);
  await expect(executePreparationUnionTask(preparationUnionInputSchema.parse({...input,schemaVersion:'wfc.pf.preparation-union-task.v2',parts:refs.parts}),storage)).rejects.toBeDefined();expect(storage.storePreparationBlob).not.toHaveBeenCalled();expect(storage.storeSnapshot).not.toHaveBeenCalled();
 });
 it('rejects mixed reference protocols and requires complete unique frozen IDs and both byte writers',async()=>{
  const{input,storage}=twoPartFixture(),refs=referencesFor(input);
  for(const parts of [[input.parts[0],refs.parts[1]],[refs.parts[0]],[refs.parts[0],refs.parts[0]],[{...refs.parts[0],filename:'/foreign'},refs.parts[1]],[{...refs.parts[0],reference:{...refs.parts[0].reference,path:'/foreign'}},refs.parts[1]]]){
   expect(()=>checkPreparationUnionInputBytes(input.plan,parts)).toThrow('PREPARATION_UNION_LIMIT');
  }
  expect(preparationUnionInputSchema.safeParse({...input,schemaVersion:'wfc.pf.preparation-union-task.v2',parts:[input.parts[0],refs.parts[1]]}).success).toBe(false);
  expect(preparationUnionInputSchema.safeParse({...input,schemaVersion:'wfc.pf.preparation-union-task.v1',parts:refs.parts}).success).toBe(false);
  storage.storeSnapshotBytes=vi.fn();await expect(executePreparationUnionTask(input,storage)).rejects.toThrow('PREPARATION_UNION_STORAGE');expect(storage.storePreparationBlob).not.toHaveBeenCalled();
 });
 it('accounts exact immutable reference bytes across the frozen profile and unchanged per-part ceiling without allocating geometry',()=>{
  const{input}=twoPartFixture(),refs=referencesFor(input);input.plan.limitsProfile=LARGE_PREPARATION_CAPACITY_PROFILE;rehash(input.plan);
  for(const part of refs.parts)part.reference.bytes=64*1024**2;
  expect(checkPreparationUnionInputBytes(input.plan,refs.parts)).toBe('references');
  const third={...structuredClone(input.plan.partPlan[0]),partId:uuid(9),partIndex:2};input.plan.partPlan.push(third);rehash(input.plan);
  expect(()=>checkPreparationUnionInputBytes(input.plan,[...refs.parts,{partId:third.partId,reference:{payloadRef:uuid(22),sha256:'e'.repeat(64),bytes:1}}])).toThrow('PREPARATION_UNION_LIMIT');
  input.plan.partPlan.pop();rehash(input.plan);refs.parts[0].reference.bytes++;
  expect(()=>checkPreparationUnionInputBytes(input.plan,refs.parts)).toThrow('PREPARATION_UNION_LIMIT');
  refs.parts[0].reference.bytes--;input.plan.limitsProfile=LEGACY_PREPARATION_CAPACITY_PROFILE;rehash(input.plan);
  expect(()=>checkPreparationUnionInputBytes(input.plan,refs.parts)).toThrow('PREPARATION_UNION_LIMIT');
 });
 it('retains every strict DTO transformation and refinement while releasing only privately owned raw slots',()=>{
  const original=fixture().input.parts[0].payload as ComputationalSnapshot,raw=structuredClone(original);raw.objects[2].fragments[0].id='  fragment:1  ';
  const expected=snapshotSchema.parse(raw),actual=parseOwnedPreparationSnapshot(raw);
  expect(actual).toEqual(expected);expect(actual.objects[2].fragments[0].id).toBe('fragment:1');expect(raw.objects).toEqual([undefined,undefined,undefined]);
  for(const change of [{...original,extra:true},{...original,objects:[]},{...original,objects:[{...original.objects[0],bounds:{minimum:[1,0,0],maximum:[0,0,0]}}]}])expect(()=>parseOwnedPreparationSnapshot(change)).toThrow();
 });
});
