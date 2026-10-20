import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePreparationDiscoveryRequest,validatePreparationDiscoveryPage,validatePreparationSlice,validatePreparationVisibilityScope,PREPARATION_MATCHING_POLICY,PREPARATION_VIEWER_LIMITS } from '../preparation-input.mjs';
import { validateEnvelope } from '../protocol.mjs';
import { planModelCaptureInput,createModelCaptureInputStage } from '../capture-input.mjs';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity={instanceId:uuid(1),projectId:uuid(2),modelVersionId:uuid(3),loadId:uuid(4)};
const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'names',names:['TRAY-001'],rootObjectId:null,cursor:0,limit:128};
const visibilityScope={schemaVersion:'wfc.pf.sdk-display-visibility.v1',basis:'sdk-display-before-pf-appearance',contentSha256:'b'.repeat(64)};
const slice={schemaVersion:'wfc.pf.viewer-slice.v1',sessionId:uuid(5),partId:uuid(6),planSha256:'a'.repeat(64),coordinateFrameId:uuid(7),objects:[{objectId:3,rootObjectId:2,projectTrayId:uuid(8),routeName:'/TRAY-001',shapeName:'STRAIGHT',allowedCategories:['LV']}],equipmentObjectIds:[]};
const envelope=(type,payload)=>({channel:'wfc-routings-viewer',protocolVersion:1,...identity,requestId:uuid(9),type,payload});
test('preparation exact discovery transport rejects unknown fields, versions, names, unsafe IDs and budgets',()=>{
 assert.equal(validatePreparationDiscoveryRequest(request),true);assert.ok(validateEnvelope(envelope('READ_PREPARATION_OBJECTS',request),'parent-to-frame'));
 for(const changed of [{extra:true},{schemaVersion:'v2'},{names:[' tray ']},{names:Array.from({length:33},(_,i)=>'A'+i)},{cursor:NaN},{limit:129},{rootObjectId:1},{mode:'substring'},{names:['X\n']}])assert.equal(validatePreparationDiscoveryRequest({...request,...changed}),false);
 for(const mode of ['subtree','ancestors'])assert.equal(validatePreparationDiscoveryRequest({...request,mode,names:[],rootObjectId:0}),true);
});
test('preparation pages distinguish pagination from honest property coverage and enforce 24KiB',()=>{
 const page={schemaVersion:request.schemaVersion,mode:'equipment',names:['P-001'],rootObjectId:null,cursor:0,matchingPolicyVersion:PREPARATION_MATCHING_POLICY,visibilityScope,indexedObjectCount:3,propertyScan:{attemptedObjectCount:3,returnedObjectCount:2,omittedObjectCount:1,complete:false},objects:[{objectId:2,parentId:1,name:'Pump',hasGeometry:true,isPhysicalLeaf:true,orderIndex:1,matchedNames:['P-001']}],nextCursor:null,complete:true};
 assert.equal(validatePreparationDiscoveryPage(page),true);assert.ok(validateEnvelope(envelope('PREPARATION_OBJECTS',page),'frame-to-parent'));
 for(const change of [{propertyScan:{...page.propertyScan,complete:true}},{nextCursor:1,complete:true},{objects:[{...page.objects[0],matchedNames:['OTHER']}]},{objects:Array.from({length:128},(_,i)=>({...page.objects[0],objectId:i+10,name:'界'.repeat(2048)}))}])assert.equal(validatePreparationDiscoveryPage({...page,...change}),false);
});
test('equipment query packs allow many exact names while tray requests retain32 and UTF8 stays bounded',()=>{
 const names=Array.from({length:1000},(_,index)=>'E'+index),equipment={...request,mode:'equipment',names};
 assert.equal(validatePreparationDiscoveryRequest(equipment),true);assert.equal(validatePreparationDiscoveryRequest({...equipment,mode:'names'}),false);
 assert.equal(validatePreparationDiscoveryRequest({...equipment,names:Array.from({length:4097},(_,index)=>String(index))}),false);
 assert.equal(validatePreparationDiscoveryRequest({...equipment,names:Array.from({length:100},(_,index)=>'界'.repeat(100)+index)}),false);
 assert.equal(validatePreparationDiscoveryRequest({...equipment,visibilityScope}),true);
});
test('v3 pages require honest SDK baseline scope and one worst-case matching row still fits24KiB',()=>{
 const names=[];let index=0;while(new TextEncoder().encode(JSON.stringify([...names,'界'.repeat(30)+index])).length<=PREPARATION_VIEWER_LIMITS.equipmentNameBytes)names.push('界'.repeat(30)+index++);
 const page={schemaVersion:request.schemaVersion,mode:'equipment',names,rootObjectId:null,cursor:0,matchingPolicyVersion:PREPARATION_MATCHING_POLICY,visibilityScope,indexedObjectCount:1,
  propertyScan:{attemptedObjectCount:1,returnedObjectCount:1,omittedObjectCount:0,complete:true},objects:[{objectId:1,parentId:null,name:'界'.repeat(2048),hasGeometry:false,isPhysicalLeaf:false,orderIndex:0,matchedNames:names}],nextCursor:null,complete:true};
 assert.equal(validatePreparationDiscoveryPage(page),true);assert.ok(new TextEncoder().encode(JSON.stringify(page)).length<=24576);
 const {visibilityScope:_scope,...missing}=page;assert.equal(validatePreparationDiscoveryPage(missing),false);
 assert.equal(validatePreparationDiscoveryPage({...page,matchingPolicyVersion:'wfc.pf.project-exact-candidates.v2'}),false);
 for(const bad of [null,{...visibilityScope,basis:'native-visible'},{...visibilityScope,contentSha256:'b'.repeat(64)+'\n'},{...visibilityScope,extra:true}])assert.equal(validatePreparationVisibilityScope(bad),false);
});
test('preparation slices reject conflicting ownership/endpoint roles and preserve explicit project categories',()=>{
 assert.equal(validatePreparationSlice(slice),true);
 for(const change of [{objects:[slice.objects[0],slice.objects[0]]},{equipmentObjectIds:[3]},{objects:[{...slice.objects[0],allowedCategories:[]}]},{objects:[{...slice.objects[0],routeName:'/SECONDARY'}]},{sessionId:slice.sessionId+'\n'},{planSha256:'a'.repeat(64)+'\n'},{objects:[],equipmentObjectIds:[]}])assert.equal(validatePreparationSlice({...slice,...change}),false);
 assert.equal(validatePreparationSlice({...slice,objects:[],equipmentObjectIds:[2]}),true);
 assert.equal(validatePreparationSlice({...slice,endpointVisibility:visibilityScope}),true);
 assert.equal(validatePreparationSlice({...slice,endpointVisibility:{...visibilityScope,basis:'native-visible'}}),false);
 assert.equal(Object.hasOwn(slice,'endpointVisibility'),false);
});
test('preparation input is detached, bounded, digest-verified and staged without caller permissions becoming authority',async()=>{
 const source={preparationSlice:{...structuredClone(slice),endpointVisibility:{...visibilityScope}},equipmentNames:['P-001']},plan=await planModelCaptureInput(source,{captureId:uuid(10),envelopeIdentity:identity});
 source.preparationSlice.objects[0].allowedCategories.push('MV');assert.deepEqual(plan.request.preparationSlice.objects[0].allowedCategories,['LV']);
 source.preparationSlice.endpointVisibility.contentSha256='c'.repeat(64);assert.deepEqual(plan.request.preparationSlice.endpointVisibility,visibilityScope);
 assert.ok(validateEnvelope(envelope('START_MODEL_CAPTURE',plan.startPayload),'parent-to-frame'));
 const stage=createModelCaptureInputStage(plan.startPayload);await stage.initialAck();for(const chunk of plan.chunks)await stage.append(chunk);assert.equal(stage.ready,true);assert.deepEqual(stage.request().preparationSlice,plan.request.preparationSlice);
 const big={...slice,objects:Array.from({length:512},(_,i)=>({...slice.objects[0],objectId:i+100,shapeName:'界'.repeat(2048)}))};await assert.rejects(()=>planModelCaptureInput({preparationSlice:big,equipmentNames:[]},{captureId:uuid(10),envelopeIdentity:identity}),/over-budget/);
});
