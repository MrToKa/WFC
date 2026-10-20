import type { ComputationalSnapshot, SnapshotObject } from '../server/pathfinder/contracts.js';
import type { PreparationPlan } from './pathfinderPreparation.js';
import type { ModelCaptureRequest } from '../viewer-runtime/protocol.mjs';
import { validatePreparationSlice } from '../viewer-runtime/preparation-input.mjs';

export const PREPARATION_MERGE_LIMITS = Object.freeze({ partBytes:64*1024**2, unionBytes:256*1024**2, partObjects:4096, objects:1_000_000, fragments:100_000, vertices:5_000_000, triangles:5_000_000, depth:512 });
export class PreparationMergeError extends Error {
  constructor(public readonly code:string) { super('The preparation geometry does not match the complete frozen scope.'); this.name='PreparationMergeError'; }
}
function refuse(code:string):never { throw new PreparationMergeError(code); }
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function encode(value:unknown):string {
  return JSON.stringify(value,(_key,item:unknown)=>{if(typeof item==='number'&&!Number.isFinite(item))refuse('NONFINITE_GEOMETRY');return item;});
}
// Count the exact finite JSON representation without constructing a mesh-sized string
// and a second mesh-sized UTF-8 buffer merely to check its existing byte ceiling.
function byteLength(value:unknown):number {
  if(value===null)return 4;
  if(typeof value==='number'){if(!Number.isFinite(value))refuse('NONFINITE_GEOMETRY');return JSON.stringify(value).length;}
  if(typeof value==='boolean')return value?4:5;
  if(typeof value==='string')return new TextEncoder().encode(JSON.stringify(value)).length;
  if(Array.isArray(value)){let bytes=2;for(let index=0;index<value.length;index++)bytes+=(index?1:0)+(value[index]===undefined?4:byteLength(value[index]));return bytes;}
  if(value&&typeof value==='object'){let bytes=2,count=0;for(const key of Object.keys(value)){const item=(value as Record<string,unknown>)[key];if(item===undefined)continue;bytes+=(count++?1:0)+new TextEncoder().encode(JSON.stringify(key)).length+1+byteLength(item);}return bytes;}
  return refuse('NONFINITE_GEOMETRY');
}
const clone=<T>(value:T):T=>JSON.parse(encode(value)) as T;
const numericId=(value:string):number=>{if(!/^dbid:(?:0|[1-9][0-9]*)$/.test(value))refuse('INVALID_OBJECT_ID');const id=Number(value.slice(5));if(!Number.isSafeInteger(id)||id<0||id>2147483647)refuse('INVALID_OBJECT_ID');return id;};
function timeBudget():()=>void { const started=performance.now();return()=>{if(performance.now()-started>120000)refuse('PREPARATION_VALIDATION_TIMEOUT');}; }
const canonical=(point:unknown):point is [number,number,number]=>Array.isArray(point)&&point.length===3&&point.every(value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=1e9);
const validBox=(box:SnapshotObject['bounds'])=>box&&canonical(box.minimum)&&canonical(box.maximum)&&box.minimum.every((value,index)=>value<=box.maximum[index]);
const affine=(matrix:number[]|null)=>matrix!==null&&Array.isArray(matrix)&&matrix.length===16&&matrix.every(Number.isFinite)&&matrix[3]===0&&matrix[7]===0&&matrix[11]===0&&matrix[15]===1;
type PartPlan=PreparationPlan['partPlan'][number];
export type PreparationGeometryCounts={objects:number;physicalLeaves:number;fragments:number;vertices:number;triangles:number};
export interface PreparationTraceIndex { schemaVersion:'wfc.pf.preparation-trace-index.v1';sessionId:string;coordinateFrameId:string;objects:{objectId:string;projectTrayId:string|null;rootObjectId:string|null;geometryRole:SnapshotObject['geometryRole'];partIds:string[]}[] }

/** Derive transport evidence from the server's immutable part; it grants no authority. */
export function preparationCaptureRequest(plan:PreparationPlan,partId:string):ModelCaptureRequest {
  const part=plan.partPlan.find(value=>value.partId===partId);if(!part)refuse('PART_NOT_PLANNED');
  const preparationSlice={schemaVersion:'wfc.pf.viewer-slice.v1' as const,sessionId:plan.id,partId,planSha256:plan.orderedPlanSha256,coordinateFrameId:plan.coordinateFrameId,objects:clone(part.objects),equipmentObjectIds:part.equipmentObjectIds.map(numericId)};
  if(!validatePreparationSlice(preparationSlice))refuse('PART_TRANSPORT_BUDGET');
  return {preparationSlice,equipmentNames:[...part.equipmentNames]};
}

/** Payload MUST first pass the existing strict snapshotSchema; no second DTO dialect. */
export function validatePreparationPart(plan:PreparationPlan,part:PartPlan,payload:ComputationalSnapshot):ComputationalSnapshot {
  return validatePart(plan,part,payload,false);
}
function validatePart(plan:PreparationPlan,part:PartPlan,payload:ComputationalSnapshot,owned:boolean):ComputationalSnapshot {
  const active=timeBudget();active();
  if(!plan.partPlan.some(value=>value.partId===part.partId&&same(value,part)))refuse('PART_NOT_PLANNED');
  preparationCaptureRequest(plan,part.partId);
  const snapshot=owned?payload:clone(payload);
  if(!snapshot||snapshot.schemaVersion!=='pathfinder.model.snapshot.v1'||snapshot.model?.projectId!==plan.projectId||snapshot.model.modelVersionId!==plan.modelVersionId||snapshot.model.contentSha256!==plan.contentFingerprint)refuse('PART_MODEL_MISMATCH');
  if(!snapshot.capture||!['converted','synthetic'].includes(snapshot.capture.sourceKind)||snapshot.capture.lookupRouteCodes!==undefined||['inventoryComplete','geometryComplete','unitsVerified','transformsVerified','planningVisibilityKnown','sourceLinkVerified'].some(key=>(snapshot.capture as unknown as Record<string,unknown>)[key]!==false))refuse('PART_PROOF_NOT_ALLOWED');
  if(!snapshot.coordinates||snapshot.coordinates.vertexFrame!=='canonical-world-metres'||!canonical(snapshot.coordinates.globalOffsetMetres)||!affine(snapshot.coordinates.displayToWorldMetres)||snapshot.coordinates.sourceToWorldMetres!==null&&!affine(snapshot.coordinates.sourceToWorldMetres)||snapshot.coordinates.metresPerSourceUnit!==null&&(!Number.isFinite(snapshot.coordinates.metresPerSourceUnit)||snapshot.coordinates.metresPerSourceUnit<=0))refuse('PART_COORDINATES_INVALID');
  if(!Array.isArray(snapshot.objects)||snapshot.objects.length>PREPARATION_MERGE_LIMITS.partObjects||byteLength(snapshot)>PREPARATION_MERGE_LIMITS.partBytes)refuse('PART_BUDGET');
  const expected=new Set([...part.physicalLeafIds,...part.equipmentObjectIds,...part.ancestorObjectIds]),leaves=new Map(part.objects.map(object=>['dbid:'+object.objectId,object])),equipment=new Set(part.equipmentObjectIds),manifest=new Map(plan.objectManifest.map(object=>[object.objectId,object])),byId=new Map<string,SnapshotObject>(),fragments=new Set<string>();
  if(expected.size!==snapshot.objects.length||part.objects.length!==part.physicalLeafIds.length||part.physicalLeafIds.some((id,index)=>id!=='dbid:'+part.objects[index].objectId))refuse('PART_SCOPE_MISMATCH');
  for(const object of snapshot.objects){
    active();
    const source=manifest.get(object.id),leaf=leaves.get(object.id),role=leaf?'routing-leaf':equipment.has(object.id)?'object':'hierarchy';
    if(!expected.has(object.id)||byId.has(object.id)||!source||object.dbId!==numericId(object.id)||object.name!==source.name||(object.parentId??null)!==source.parentId||object.geometryRole!==role||object.nativeHidden!==null||object.planningExcluded!==false||!validBox(object.bounds))refuse('PART_OBJECT_MISMATCH');
    if(leaf){
      if(!source.isPhysicalLeaf||!source.hasGeometry||object.routeName!==leaf.routeName||object.shapeName!==leaf.shapeName||object.routeBoundaryId!==undefined||object.categoryAssignmentSource!=='explicit-planning'||!same(object.allowedCategories,leaf.allowedCategories)||!object.fragments.length)refuse('PART_POLICY_MISMATCH');
    }else if(object.categoryAssignmentSource!=='unassigned'||object.allowedCategories.length||object.fragments.length||object.routeName!==undefined||object.shapeName!==undefined||object.routeBoundaryId!==undefined)refuse('PART_ROLE_MISMATCH');
    if(!Array.isArray(object.properties)||object.properties.length>1024)refuse('PART_PROPERTY_BUDGET');
    byId.set(object.id,object);
    for(const fragment of object.fragments){
      if(fragments.has(fragment.id)||fragment.transformAlreadyApplied!==true||fragment.fragmentToWorldMetres!==null&&!affine(fragment.fragmentToWorldMetres)||!Array.isArray(fragment.vertices)||fragment.vertices.length<3||!Array.isArray(fragment.triangleIndices)||fragment.triangleIndices.length<3||fragment.triangleIndices.length%3!==0)refuse('PART_FRAGMENT_INVALID');
      fragments.add(fragment.id);
      for(let index=0;index<fragment.vertices.length;index++){if(index%1024===0)active();const point=fragment.vertices[index];if(!canonical(point)||point.some((value,axis)=>value<object.bounds.minimum[axis]-1e-6||value>object.bounds.maximum[axis]+1e-6))refuse('PART_VERTEX_INVALID');}
      if(fragment.triangleIndices.some(index=>!Number.isSafeInteger(index)||index<0||index>=fragment.vertices.length))refuse('PART_TRIANGLES_INVALID');
    }
  }
  for(const object of snapshot.objects){
    active();
    const chain:string[]=[],visited=new Set<string>();let current:SnapshotObject|undefined=object;
    while(current){if(visited.has(current.id)||chain.length>=PREPARATION_MERGE_LIMITS.depth)refuse('PART_HIERARCHY_INVALID');visited.add(current.id);chain.push(current.name);if(current.parentId!==null&&current.parentId!==undefined&&!byId.has(current.parentId))refuse('PART_PARENT_MISSING');current=current.parentId?byId.get(current.parentId):undefined;if(current?.geometryRole==='routing-leaf')refuse('PART_HIERARCHY_INVALID');}
    if(!same(chain,object.leafToRootNames))refuse('PART_HIERARCHY_NAMES');
    const leaf=leaves.get(object.id);if(leaf&&!visited.has('dbid:'+leaf.rootObjectId))refuse('PART_ROOT_MISMATCH');
  }
  countGeometry(snapshot.objects);
  active();return snapshot;
}

function countGeometry(objects:SnapshotObject[]):PreparationGeometryCounts {
  const counts={objects:objects.length,physicalLeaves:0,fragments:0,vertices:0,triangles:0};
  for(const object of objects){if(object.geometryRole==='routing-leaf')counts.physicalLeaves++;for(const fragment of object.fragments){counts.fragments++;counts.vertices+=fragment.vertices.length;counts.triangles+=fragment.triangleIndices.length/3;}}
  if(counts.objects>PREPARATION_MERGE_LIMITS.objects||counts.fragments>PREPARATION_MERGE_LIMITS.fragments||counts.vertices>PREPARATION_MERGE_LIMITS.vertices||counts.triangles>PREPARATION_MERGE_LIMITS.triangles)refuse('GEOMETRY_UNION_BUDGET');
  return counts;
}
const sharedIdentity=(object:SnapshotObject):unknown=>{const {bounds:_bounds,geometryRole:_role,...identity}=object;return identity;};

export type PreparationMergeResult={snapshot:ComputationalSnapshot;traceIndex:PreparationTraceIndex;counts:PreparationGeometryCounts};
/** Exclusively owned, already strict-schema-parsed parts, supplied in frozen order.
 * The caller relinquishes each parsed graph; the builder retains only union objects.
 * Public merge/validation APIs below continue to detach all caller-owned inputs. */
export function createOwnedPreparationMerge(plan:PreparationPlan):{addPart:(partId:string,payload:ComputationalSnapshot)=>void;finish:()=>PreparationMergeResult} {
  return createMerge(plan,true);
}
function createMerge(plan:PreparationPlan,owned:boolean):{addPart:(partId:string,payload:ComputationalSnapshot)=>void;finish:()=>PreparationMergeResult} {
  const active=timeBudget();active();
  if(!plan.partPlan.length||plan.partPlan.length>4096)refuse('PARTS_INCOMPLETE');
  const objects=new Map<string,SnapshotObject>(),owners=new Map<string,{projectTrayId:string;rootObjectId:string}>(),origins=new Map<string,string[]>(),physicalOwners=new Map<string,string>();
  let first:Pick<ComputationalSnapshot,'model'|'coordinates'>&{sourceKind:ComputationalSnapshot['capture']['sourceKind']}|undefined,next=0,finished=false;
  function addPart(partId:string,payload:ComputationalSnapshot):void {
    active();
    const part=plan.partPlan[next];if(finished||!part||part.partId!==partId)refuse('PARTS_INCOMPLETE');
    const snapshot=validatePart(plan,part,payload,owned);
    if(!first)first={model:snapshot.model,coordinates:snapshot.coordinates,sourceKind:snapshot.capture.sourceKind};else if(!same(snapshot.coordinates,first.coordinates)||snapshot.capture.sourceKind!==first.sourceKind||!same(snapshot.model,first.model))refuse('PART_FRAME_MISMATCH');
    for(const leaf of part.objects){const id='dbid:'+leaf.objectId;if(physicalOwners.has(id))refuse('LEAF_OWNERSHIP_CONFLICT');physicalOwners.set(id,part.partId);owners.set(id,{projectTrayId:leaf.projectTrayId,rootObjectId:'dbid:'+leaf.rootObjectId});}
    for(const object of snapshot.objects){
      active();
      const prior=objects.get(object.id);origins.set(object.id,[...(origins.get(object.id)??[]),part.partId]);
      if(!prior)objects.set(object.id,object);
      else{
        if(prior.geometryRole==='routing-leaf'||object.geometryRole==='routing-leaf'||!same(sharedIdentity(prior),sharedIdentity(object)))refuse('OBJECT_IDENTITY_CONFLICT');
        if(prior.geometryRole==='object'&&object.geometryRole==='object'&&!same(prior.bounds,object.bounds))refuse('ENDPOINT_BOUNDS_CONFLICT');
        if(object.geometryRole==='object')objects.set(object.id,object);
      }
    }
    next++;
  }
  function finish():PreparationMergeResult {
  active();if(finished||next!==plan.partPlan.length)refuse('PARTS_INCOMPLETE');finished=true;
  const ordered:SnapshotObject[]=[],order=new Set<number>(),fragmentOwners=new Set<string>();
  for(const id of plan.objectOrder){if(order.has(id))refuse('GLOBAL_ORDER_CONFLICT');order.add(id);const object=objects.get('dbid:'+id);if(object)ordered.push(object);}
  if(ordered.length!==objects.size)refuse('GLOBAL_ORDER_INCOMPLETE');
  const hierarchyBoxes=new Map<string,SnapshotObject['bounds']>();
  for(const object of ordered){
    active();
    for(const fragment of object.fragments){if(fragmentOwners.has(fragment.id))refuse('FRAGMENT_OWNERSHIP_CONFLICT');fragmentOwners.add(fragment.id);}
    if(object.geometryRole==='hierarchy')continue;
    let parent=object.parentId,depth=0;const visited=new Set<string>();
    while(parent){if(++depth>PREPARATION_MERGE_LIMITS.depth||visited.has(parent)||!objects.has(parent))refuse('UNION_HIERARCHY_INVALID');visited.add(parent);const ancestor=objects.get(parent)!;if(ancestor.geometryRole==='hierarchy'){let box=hierarchyBoxes.get(parent);if(!box){box=clone(object.bounds);hierarchyBoxes.set(parent,box);}else for(let axis=0;axis<3;axis++){box.minimum[axis]=Math.min(box.minimum[axis],object.bounds.minimum[axis]);box.maximum[axis]=Math.max(box.maximum[axis],object.bounds.maximum[axis]);}}parent=ancestor.parentId;}
  }
  for(const object of ordered)if(object.geometryRole==='hierarchy'){const box=hierarchyBoxes.get(object.id);if(!box)refuse('EMPTY_ANCESTOR_SCOPE');object.bounds=box;}
  const snapshot:ComputationalSnapshot={schemaVersion:'pathfinder.model.snapshot.v1',model:clone(first!.model),capture:{adapterVersion:'wfc.project-preparation-aggregate.v1',sourceKind:first!.sourceKind,inventoryComplete:false,geometryComplete:false,unitsVerified:false,transformsVerified:false,planningVisibilityKnown:false,sourceLinkVerified:false,evidenceSha256:[plan.orderedPlanSha256]},coordinates:clone(first!.coordinates),objects:ordered};
  const counts=countGeometry(ordered);if(byteLength(snapshot)>PREPARATION_MERGE_LIMITS.unionBytes)refuse('GEOMETRY_UNION_BUDGET');
  const traceIndex:PreparationTraceIndex={schemaVersion:'wfc.pf.preparation-trace-index.v1',sessionId:plan.id,coordinateFrameId:plan.coordinateFrameId,objects:ordered.map(object=>({objectId:object.id,projectTrayId:owners.get(object.id)?.projectTrayId??null,rootObjectId:owners.get(object.id)?.rootObjectId??null,geometryRole:object.geometryRole,partIds:origins.get(object.id)!}))};
  active();return {snapshot,traceIndex,counts};
  }
  return {addPart,finish};
}

/** One deterministic whole union; part arrival order never controls algorithm ties. */
export function mergePreparationParts(plan:PreparationPlan,parts:{partId:string;payload:ComputationalSnapshot}[]):PreparationMergeResult {
  if(!plan.partPlan.length||parts.length>4096)refuse('PARTS_INCOMPLETE');
  const supplied=new Map<string,ComputationalSnapshot>();
  for(const entry of parts){if(supplied.has(entry.partId)){if(!same(supplied.get(entry.partId),entry.payload))refuse('PART_IDENTITY_CONFLICT');}else supplied.set(entry.partId,entry.payload);}
  if(supplied.size!==plan.partPlan.length||[...supplied.keys()].some(id=>!plan.partPlan.some(part=>part.partId===id)))refuse('PARTS_INCOMPLETE');
  const merge=createMerge(plan,false);for(const part of plan.partPlan)merge.addPart(part.partId,supplied.get(part.partId)!);return merge.finish();
}
