import { describe,it,expect,vi } from 'vitest';
import { mergePreparationParts,validatePreparationPart,preparationCaptureRequest,createOwnedPreparationMerge } from './preparationMerge.js';
import {canonicalPurposeJson} from './pathfinderPurposePolicy.js';
import type { PreparationPlan } from './pathfinderPreparation.js';
import type { ComputationalSnapshot,SnapshotObject } from '../server/pathfinder/contracts.js';
import { snapshotSchema } from '../server/pathfinder/contracts.js';
import { validateSnapshotStructure } from '../server/pathfinder/matching.js';
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function fixture(){
 const projectId=uuid(1),modelVersionId=uuid(2),root=uuid(3),partIds=[uuid(4),uuid(5)],id=uuid(6),coordinateFrameId=uuid(7);
 const manifest=[{objectId:'dbid:1',parentId:null,name:'Plant',hasGeometry:false,isPhysicalLeaf:false,orderIndex:0},{objectId:'dbid:2',parentId:'dbid:1',name:'TRAY-01',hasGeometry:false,isPhysicalLeaf:false,orderIndex:1},...[3,7].map((value,index)=>({objectId:'dbid:'+value,parentId:'dbid:2',name:'STRAIGHT '+value,hasGeometry:true,isPhysicalLeaf:true,orderIndex:index+2}))];
 const objects=[3,7].map(objectId=>({objectId,rootObjectId:2,projectTrayId:root,routeName:'/TRAY-01',shapeName:'STRAIGHT '+objectId,allowedCategories:['LV' as const]}));
 const partPlan=objects.map((object,index)=>({partId:partIds[index],partIndex:index,objects:[object],physicalLeafIds:['dbid:'+object.objectId],equipmentObjectIds:[],ancestorObjectIds:['dbid:1','dbid:2'],equipmentNames:[],scopeSha256:'b'.repeat(64)}));
 const plan={id,projectId,modelVersionId,contentFingerprint:'a'.repeat(64),coordinateFrameId,orderedPlanSha256:'c'.repeat(64),objectManifest:manifest,objectOrder:[1,2,3,7],partPlan} as unknown as PreparationPlan;
 function snapshot(index:number):ComputationalSnapshot {
  const leafId=objects[index].objectId,minimum:[number,number,number]=[index*2+100000000.123456,0,0],maximum:[number,number,number]=[minimum[0]+1,1,0];
  const leaf:SnapshotObject={id:'dbid:'+leafId,parentId:'dbid:2',dbId:leafId,name:'STRAIGHT '+leafId,geometryRole:'routing-leaf',leafToRootNames:['STRAIGHT '+leafId,'TRAY-01','Plant'],properties:[],nativeHidden:null,planningExcluded:false,categoryAssignmentSource:'explicit-planning',allowedCategories:['LV'],routeName:'/TRAY-01',shapeName:'STRAIGHT '+leafId,bounds:{minimum,maximum},fragments:[{id:'fragment:'+leafId,vertices:[minimum,[maximum[0],0,0],maximum],triangleIndices:[0,1,2],fragmentToWorldMetres:matrix,transformAlreadyApplied:true}]};
  const ancestors=manifest.slice(0,2).map((item,index)=>({id:item.objectId,parentId:item.parentId,dbId:Number(item.objectId.slice(5)),name:item.name,geometryRole:'hierarchy' as const,leafToRootNames:index?['TRAY-01','Plant']:['Plant'],properties:[],nativeHidden:null,planningExcluded:false,categoryAssignmentSource:'unassigned' as const,allowedCategories:[],bounds:structuredClone(leaf.bounds),fragments:[]}));
  return {schemaVersion:'pathfinder.model.snapshot.v1',model:{projectId,modelVersionId,contentSha256:plan.contentFingerprint},capture:{adapterVersion:'wfc.protected-selected-capture.v1',sourceKind:'converted',inventoryComplete:false,geometryComplete:false,unitsVerified:false,transformsVerified:false,planningVisibilityKnown:false,sourceLinkVerified:false,evidenceSha256:['e'.repeat(64)]},coordinates:{vertexFrame:'canonical-world-metres',sourceUnits:'m',metresPerSourceUnit:1,sourceToWorldMetres:matrix,globalOffsetMetres:[0,0,0],displayToWorldMetres:matrix},objects:[leaf,...ancestors]};
 }
 const parts=partIds.map((partId,index)=>({partId,payload:snapshot(index)}));return{plan,parts};
}
describe('whole preparation union',()=>{
 it('is byte deterministic across arrival order and exact replay, preserves binary64 and global tie order',()=>{
  const{plan,parts}=fixture(),before=structuredClone(parts),normal=mergePreparationParts(plan,parts),reverse=mergePreparationParts(plan,[parts[1],parts[0],structuredClone(parts[1])]);
  expect(JSON.stringify(reverse)).toBe(JSON.stringify(normal));expect(parts).toEqual(before);expect(normal.snapshot.objects.map(object=>object.dbId)).toEqual([1,2,3,7]);expect(normal.snapshot.objects[2].fragments[0].vertices[0][0]).toBe(100000000.123456);
  expect(normal.counts).toEqual({objects:4,physicalLeaves:2,fragments:2,vertices:6,triangles:2});expect(snapshotSchema.safeParse(normal.snapshot).success).toBe(true);expect(()=>validateSnapshotStructure(normal.snapshot)).not.toThrow();
 });
 it('recomputes shared ancestor bounds from all physical descendants instead of the first part',()=>{
  const{plan,parts}=fixture(),merged=mergePreparationParts(plan,parts);for(const object of merged.snapshot.objects.slice(0,2)){expect(object.bounds.minimum).toEqual(parts[0].payload.objects[0].bounds.minimum);expect(object.bounds.maximum).toEqual(parts[1].payload.objects[0].bounds.maximum);}
 });
 it('one-part and multi-part payloads retain identical geometry and order without changing transforms',()=>{
  const{plan,parts}=fixture(),multi=mergePreparationParts(plan,parts),single=structuredClone(plan),combined=structuredClone(multi.snapshot);combined.capture=structuredClone(parts[0].payload.capture);
  single.partPlan=[{...single.partPlan[0],physicalLeafIds:['dbid:3','dbid:7'],objects:single.partPlan.flatMap(part=>part.objects)}];
  const merged=mergePreparationParts(single,[{partId:single.partPlan[0].partId,payload:combined}]);expect(merged.snapshot).toEqual(multi.snapshot);expect(merged.snapshot.coordinates.displayToWorldMetres).toEqual(matrix);
 });
 it.each(['missing','foreign','conflicting replay'] as const)('refuses %s parts without a publishable result',kind=>{
  const{plan,parts}=fixture();if(kind==='missing')parts.pop();if(kind==='foreign')parts[0].partId=uuid(99);if(kind==='conflicting replay'){const duplicate=structuredClone(parts[0]);duplicate.payload.objects[0].bounds.maximum[0]++;parts.push(duplicate);}expect(()=>mergePreparationParts(plan,parts)).toThrow();
 });
 it.each(['role','mask','route','shape','root','parent','name','names','native-proof','model','id','extra'] as const)('rejects part %s tampering before acknowledgement',kind=>{
  const{plan,parts}=fixture(),payload=parts[0].payload,object=payload.objects[0];
  if(kind==='role')object.geometryRole='object';if(kind==='mask')object.allowedCategories=['MV'];if(kind==='route')object.routeName='/OTHER';if(kind==='shape')object.shapeName='BEND';if(kind==='root')plan.partPlan[0].objects[0].rootObjectId=99;if(kind==='parent')object.parentId='dbid:1';if(kind==='name')object.name='CHANGED';if(kind==='names')object.leafToRootNames=['STRAIGHT 3'];if(kind==='native-proof')payload.capture.geometryComplete=true;if(kind==='model')payload.model.modelVersionId=uuid(100);if(kind==='id')object.dbId=99;if(kind==='extra')payload.objects.push({...structuredClone(object),id:'dbid:99',dbId:99});
  expect(()=>validatePreparationPart(plan,plan.partPlan[0],payload)).toThrow();
 });
 it('refuses different canonical frames/units and non-finite geometry rather than retransforming',()=>{
  const{plan,parts}=fixture();parts[1].payload.coordinates.globalOffsetMetres[0]=1;expect(()=>mergePreparationParts(plan,parts)).toThrow();parts[1].payload.coordinates.globalOffsetMetres[0]=0;parts[1].payload.objects[0].fragments[0].vertices[0][0]=Infinity;expect(()=>mergePreparationParts(plan,parts)).toThrow();
 });
 it('rejects double application flags, duplicate fragment ownership and incomplete global order',()=>{
  for(const kind of ['transform','fragment','order']){const{plan,parts}=fixture();if(kind==='transform')(parts[0].payload.objects[0].fragments[0] as unknown as {transformAlreadyApplied:boolean}).transformAlreadyApplied=false;if(kind==='fragment')parts[1].payload.objects[0].fragments[0].id=parts[0].payload.objects[0].fragments[0].id;if(kind==='order')plan.objectOrder.pop();expect(()=>mergePreparationParts(plan,parts)).toThrow();}
 });
 it('rejects shared physical ownership even when duplicated bytes look identical',()=>{
  const{plan,parts}=fixture();plan.partPlan[1]={...structuredClone(plan.partPlan[0]),partId:plan.partPlan[1].partId,partIndex:1};parts[1].payload=structuredClone(parts[0].payload);expect(()=>mergePreparationParts(plan,parts)).toThrow();
 });
 it('produces bounded exact concrete capture scope detached from the plan',()=>{
  const{plan}=fixture(),request=preparationCaptureRequest(plan,plan.partPlan[0].partId);expect(request.preparationSlice?.equipmentObjectIds).toEqual([]);expect(request.preparationSlice?.objects[0].allowedCategories).toEqual(['LV']);request.preparationSlice!.objects[0].allowedCategories.push('MV');expect(plan.partPlan[0].objects[0].allowedCategories).toEqual(['LV']);expect(()=>preparationCaptureRequest(plan,uuid(99))).toThrow();
 });
 it('never upgrades partial SDK evidence to native or engineering proofs',()=>{
  const{plan,parts}=fixture(),merged=mergePreparationParts(plan,parts);expect(merged.snapshot.capture).toMatchObject({inventoryComplete:false,geometryComplete:false,unitsVerified:false,transformsVerified:false,planningVisibilityKnown:false,sourceLinkVerified:false});expect(merged.snapshot.capture.inputScope).toBeUndefined();expect(merged.traceIndex.objects[2]).toMatchObject({projectTrayId:uuid(3),rootObjectId:'dbid:2',partIds:[plan.partPlan[0].partId]});
 });
 it('promotes a shared hierarchy stub to its exact endpoint object without replacing its actual bbox',()=>{
  const{plan,parts}=fixture(),endpoint=parts[0].payload.objects.find(object=>object.id==='dbid:2')!;plan.partPlan[0].equipmentObjectIds=['dbid:2'];plan.partPlan[0].ancestorObjectIds=['dbid:1'];endpoint.geometryRole='object';endpoint.bounds={minimum:[99999999,0,-1],maximum:[100000004,2,1]};
  const merged=mergePreparationParts(plan,parts),result=merged.snapshot.objects.find(object=>object.id==='dbid:2')!;expect(result.geometryRole).toBe('object');expect(result.bounds).toEqual(endpoint.bounds);expect(merged.snapshot.objects[0].bounds).toEqual(endpoint.bounds);
 });
 it('preserves v3 visible eligibility when another part captures the same equipment only as an ancestor stub',()=>{
  const{plan,parts}=fixture(),endpoint=parts[0].payload.objects.find(object=>object.id==='dbid:2')!;
  const endpointVisibility={schemaVersion:'wfc.pf.sdk-display-visibility.v1' as const,basis:'sdk-display-before-pf-appearance' as const,contentSha256:'a'.repeat(64)};
  plan.matchingPolicyVersion='wfc.pf.project-exact-candidates.v3';plan.requestedScope={endpointVisibility} as PreparationPlan['requestedScope'];
  plan.partPlan[0].equipmentObjectIds=['dbid:2'];plan.partPlan[0].ancestorObjectIds=['dbid:1'];endpoint.geometryRole='object';
  endpoint.equipmentEligibility={schemaVersion:'wfc.pf.equipment-eligibility.v1',matchingPolicyVersion:'wfc.pf.project-exact-candidates.v3',visibilityScopeSha256:endpointVisibility.contentSha256,visibility:'visible',checkedAncestorCount:2,fragmentStatus:'all-visible',fragmentCount:2};
  const merged=mergePreparationParts(plan,parts),result=merged.snapshot.objects.find(object=>object.id==='dbid:2')!;
  expect(result.geometryRole).toBe('object');expect(result.equipmentEligibility).toEqual(endpoint.equipmentEligibility);
  expect(result.nativeHidden).toBeNull();expect(parts[1].payload.objects.find(object=>object.id==='dbid:2')).not.toHaveProperty('equipmentEligibility');
 });
 it('rejects differing immutable ancestor properties and enforces the monotonic validation deadline',()=>{
  const{plan,parts}=fixture();parts[1].payload.objects[1].properties=[{category:'Source',name:'Changed',value:'yes'}];expect(()=>mergePreparationParts(plan,parts)).toThrow();parts[1].payload.objects[1].properties=[];
  const now=vi.spyOn(performance,'now');let ticks=0;now.mockImplementation(()=>++ticks*120001);try{expect(()=>mergePreparationParts(plan,parts)).toThrowError(expect.objectContaining({code:'PREPARATION_VALIDATION_TIMEOUT'}));}finally{now.mockRestore();}
 });
 it('incrementally adopts strictly parsed private parts without snapshot-sized clones, retaining exact generic output bytes',()=>{
  const{plan,parts}=fixture(),expected=mergePreparationParts(plan,parts),owned=parts.map(part=>({...part,payload:snapshotSchema.parse(part.payload)})),merge=createOwnedPreparationMerge(plan);
  const stringify=vi.spyOn(JSON,'stringify');let actual:ReturnType<typeof merge.finish>;
  try{
   for(const part of owned)merge.addPart(part.partId,part.payload);actual=merge.finish();
   expect(stringify.mock.calls.some(([value])=>value&&typeof value==='object'&&'schemaVersion' in value&&value.schemaVersion==='pathfinder.model.snapshot.v1')).toBe(false);
  }finally{stringify.mockRestore();}
  expect(canonicalPurposeJson(actual!)).toBe(canonicalPurposeJson(expected));expect(actual!.snapshot.objects[2]).toBe(owned[0].payload.objects[0]);expect(actual!.snapshot.objects[3].fragments[0].vertices).toBe(owned[1].payload.objects[0].fragments[0].vertices);
  expect(parts[0].payload.objects[1].bounds.maximum).toEqual(parts[0].payload.objects[0].bounds.maximum);
 });
 it('the owning path keeps strict completeness, frozen order, identity, policy and single-use guards',()=>{
  for(const kind of ['missing','order','duplicate','mask','parent','properties'] as const){
   const{plan,parts}=fixture(),merge=createOwnedPreparationMerge(plan);if(kind==='mask')parts[0].payload.objects[0].allowedCategories=['MV'];if(kind==='parent')parts[0].payload.objects[0].parentId='dbid:1';if(kind==='properties')parts[1].payload.objects[1].properties=[{category:'Source',name:'Changed',value:'yes'}];
   expect(()=>{if(kind==='order')merge.addPart(parts[1].partId,parts[1].payload);else{merge.addPart(parts[0].partId,parts[0].payload);if(kind==='duplicate')merge.addPart(parts[0].partId,parts[0].payload);else if(kind!=='missing')merge.addPart(parts[1].partId,parts[1].payload);merge.finish();}}).toThrow();
  }
  const{plan,parts}=fixture(),merge=createOwnedPreparationMerge(plan);for(const part of parts)merge.addPart(part.partId,part.payload);merge.finish();expect(()=>merge.finish()).toThrow();expect(()=>merge.addPart(parts[0].partId,parts[0].payload)).toThrow();
 });
 it('keeps escaped UTF-8, exponent and negative-zero values without a mesh-sized encoder allocation',()=>{
  const{plan,parts}=fixture();for(const part of parts)for(const object of part.payload.objects)object.properties=[{category:'Source',name:'quoted " slash \\ emoji 🙂',value:'漢字é𝄞'}];
  // Properties are already DTO-validated by the caller; byte accounting follows JSON.stringify exactly.
  parts[0].payload.objects[0].fragments[0].vertices[0][1]=-0;parts[0].payload.objects[0].fragments[0].vertices[1][1]=1e-7;
  const encode=vi.spyOn(TextEncoder.prototype,'encode');try{const result=mergePreparationParts(plan,parts);expect(snapshotSchema.safeParse(result.snapshot).success).toBe(true);expect(result.snapshot.objects[2].properties).toEqual(parts[0].payload.objects[0].properties);expect(result.snapshot.objects[2].fragments[0].vertices[1][1]).toBe(1e-7);expect(Math.max(...encode.mock.calls.map(([value])=>(value??'').length))).toBeLessThan(256);}finally{encode.mockRestore();}
 });
});
