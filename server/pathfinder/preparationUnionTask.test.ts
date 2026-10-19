// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {preparationContextSchema,preparationCreateSchema} from '../../shared/pathfinderPreparation.js';
import {canonicalPurposeJson} from '../../shared/pathfinderPurposePolicy.js';
import {buildPreparationPlan} from './preparationPlans.js';
import type {ComputationalSnapshot} from './contracts.js';
import {executePreparationUnionTask,preparationUnionInputSchema,preparationUnionMessageSchema,checkPreparationUnionInputBytes,type PreparationUnionTaskStorage} from './preparationUnionTask.js';
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
 const hash=(text:string)=>({sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)});
 const storage:PreparationUnionTaskStorage={storeSnapshot:vi.fn(async(_id,value)=>hash(JSON.stringify(value))),storePreparationBlob:vi.fn(async(_project,_session,id,value)=>({payloadRef:id,...hash(canonicalPurposeJson(value))}))};
 return{input,storage};
}
describe('isolated preparation union geometry task',()=>{
 it('uses the exact frozen plan and strict snapshot, canonicalizes member keys while retaining every array order, and returns only references',async()=>{
  const{input,storage}=fixture(),result=await executePreparationUnionTask(input,storage);expect(Object.keys(result).sort()).toEqual(['counts','projection','snapshotId','traceIndex']);expect(result.counts).toEqual({objects:3,physicalLeaves:1,fragments:1,vertices:3,triangles:1});expect(result.projection.payloadRef).toBe(input.snapshotId);
  expect(storage.storePreparationBlob).toHaveBeenCalledTimes(2);expect(storage.storePreparationBlob).toHaveBeenNthCalledWith(1,input.plan.projectId,input.plan.id,input.snapshotId,expect.any(Object),256*1024**2);
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
  expect(()=>checkPreparationUnionInputBytes({},[{payload:{text:'x'.repeat(32*1024**2)}}])).toThrow('PREPARATION_UNION_LIMIT');expect(()=>checkPreparationUnionInputBytes({text:'x'.repeat(16*1024**2)},[])).toThrow('PREPARATION_UNION_LIMIT');
 });
});
