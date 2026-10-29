import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCoordinates, createPathFinderController, createExactPathBatches } from '../pathfinder.mjs';
import { CHANNEL, validateEnvelope, MAX_MESSAGE_BYTES } from '../protocol.mjs';

const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const envelope = (type, payload) => ({ channel: CHANNEL, protocolVersion: 1, instanceId: uuid(1), projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), requestId: uuid(5), type, payload });
function fixture() {
  class Vector3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } set(x, y, z) { Object.assign(this, { x, y, z }); } }
  class Box3 {
    constructor() { this.min = new Vector3(Infinity, Infinity, Infinity); this.max = new Vector3(-Infinity, -Infinity, -Infinity); }
    expandByPoint(point) { for (const axis of ['x', 'y', 'z']) { this.min[axis] = Math.min(this.min[axis], point[axis]); this.max[axis] = Math.max(this.max[axis], point[axis]); } return this; }
    union(box) { this.expandByPoint(box.min); this.expandByPoint(box.max); return this; }
    isEmpty() { return this.min.x > this.max.x; }
  }
  class Geometry { setAttribute(key, value) { this[key] = value; } setIndex(value) { this.index = value; } dispose() { this.disposed = true; } }
  class SphereGeometry extends Geometry { constructor(radius, widthSegments, heightSegments) { super(); Object.assign(this, { radius, widthSegments, heightSegments }); } }
  class Material { constructor(options) { Object.assign(this, options); } dispose() { this.disposed = true; this.disposeCount = (this.disposeCount ?? 0) + 1; } }
  class Mesh { constructor(geometry, material) { Object.assign(this, { geometry, material, position: new Vector3(), isMesh: true }); } }
  const THREE = { Vector3, Box3, BufferGeometry: Geometry, SphereGeometry, BufferAttribute: class { constructor(array, itemSize) { Object.assign(this, { array, itemSize }); } }, MeshBasicMaterial: Material, Mesh, DoubleSide: 2 };
  const canvas = new EventTarget(); canvas.getBoundingClientRect = () => ({ left: 10, top: 20 });
  const tree = { getRootId: () => 1, getNodeName: id => ({ 1: 'MODEL', 2: '=CAB-001', 3: '=CAB-002' })[id], getNodeParentId: id => id === 1 ? 0 : 1,
    getNodeIndex: id => [1, 2, 3].includes(id) ? id - 1 : undefined,
    isNodeHidden: () => false, isNodeOff: () => false, getChildCount: id => id === 1 ? 2 : 0,
    enumNodeChildren(id, fn) { if (id === 1) for (const child of [2, 3]) if (fn(child)) break; }, enumNodeFragments(id, fn) { if (id !== 1) fn(id); } };
  const originalMaterial = new Material({ color: 0x32a852, opacity: 0.8, transparent: true, depthWrite: false, originModelId: 7, _sharedBy: [7] });
  const fragmentMaterials = new Map(Array.from({ length: 4 }, (_, id) => [id, originalMaterial]));
  const fragments = { isFragVisible: () => true, getWorldBounds(id, box) { box.expandByPoint(new Vector3(id, 2, 3)); box.expandByPoint(new Vector3(id + 1, 4, 5)); }, getCount: () => 4, getMaterial: id => fragmentMaterials.get(id), setMaterial: (id, material) => fragmentMaterials.set(id, material) };
  const model = { id: 7, unconsolidated: 0, unconsolidate() { this.unconsolidated++; }, getUnitScale: () => 0.001, getUpVector: () => [0, 0, 1], getGlobalOffset: () => ({ x: 1000000.123456, y: -2000000.654321, z: 3000 }),
    getObjectTree: success => success(tree), getExternalIdMapping: success => success({ externalA: 2, externalB: 3 }), getFragmentList: () => fragments,
    getProperties: (id, success) => success({ properties: [{ displayName: 'Tag', displayValue: tree.getNodeName(id) }] }) };
  const clones = [], registered = new Map(), manager = { cloneMaterial(original, owner) { const clone = new Material({ ...original, originModelId: owner.id }); clones.push(clone); return clone; }, addMaterial(name, material) { registered.set(name, material); }, removeMaterial(name) { registered.delete(name); } };
  const meshes = [], viewer = { model, canvas, prefs: { get: () => false }, impl: { matman: () => manager, fadeMaterial: { opacity: 0.15, variants: [{ opacity: 0.3 }] }, showGhosting: false, toggleGhosting(value) { this.showGhosting = value; }, invalidate() {} },
    overlays: { addScene() {}, removeScene() {}, addMesh(mesh) { meshes.push(mesh); }, removeMesh(mesh) { meshes.splice(meshes.indexOf(mesh), 1); } },
    isolate(ids) { this.isolated = ids; }, show(ids) { this.shown = ids; }, setGhosting(value) { this.preference = value; }, clearSelection() {}, navigation: { fitBounds(flag, box) { viewer.fittedBounds = box; } },
    hitTest: () => ({ model, dbId: 2, intersectPoint: { x: 4, y: 5, z: 6 } }) };
  model.visibilityManager = {
    defaultVisible: true, states: [[3, false]],
    getDefaultVisibility() { return this.defaultVisible; }, getVisibility() { return this.states.map(value => [...value]); },
    setAllVisibility(value) { this.defaultVisible = value; this.states = []; },
    setVisibility(defaultVisible, states) { this.defaultVisible = defaultVisible; this.states = states.map(value => [...value]); viewer.isolated = []; },
  };
  const controller = createPathFinderController(viewer, { window: { THREE } });
  return { model, viewer, controller, meshes, canvas, tree, fragments, originalMaterial, fragmentMaterials, manager, clones, registered };
}

test('canonical coordinates preserve binary64 offset, units, round trip and reject undeclared axes', () => {
  const f = fixture(), coordinates = modelCoordinates(f.model);
  const expected = [(1000000.123456 + 4) * 0.001, (-2000000.654321 + 5) * 0.001, (3000 + 6) * 0.001];
  assert.deepEqual(coordinates.toCanonical([4, 5, 6]), expected);
  assert.ok(coordinates.toDisplay(expected).every((value, i) => Math.abs(value - [4, 5, 6][i]) < 1e-9));
  assert.throws(() => modelCoordinates({ ...f.model, getUpVector: () => [0, 1, 0] }), { code: 'COORDINATES_UNSUPPORTED' });
  assert.throws(() => coordinates.toDisplay([Infinity, 0, 0]), { code: 'COORDINATES_UNSUPPORTED' });
});

test('preparation discovery is exact case-sensitive NFC, returns all duplicate candidates and retains leading zeroes',async()=>{
 const f=fixture();f.tree.getNodeName=id=>({1:'Plant',2:'TRAY-001',3:'TRAY-001'})[id];f.tree.getChildCount=id=>id===1?2:0;
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'names',names:['TRAY-001'],rootObjectId:null,cursor:0,limit:1};
 const first=await f.controller.readPreparationObjects(request),second=await f.controller.readPreparationObjects({...request,cursor:first.nextCursor});
 assert.deepEqual([...first.objects,...second.objects].map(x=>x.objectId),[2,3]);assert.equal(first.complete,false);assert.equal(second.complete,true);assert.deepEqual(first.objects[0].matchedNames,['TRAY-001']);
 for(const name of ['tray-001','TRAY-01','TRAY','RAY-001'])assert.equal((await f.controller.readPreparationObjects({...request,names:[name]})).objects.length,0);
 f.controller.dispose();
});

test('tray-name discovery normalizes an unmatched model name once per ID rather than once per requested name',async()=>{
 const f=fixture(),original=String.prototype.normalize;let unmatchedNormalizations=0;
 f.tree.getNodeName=id=>id===2?'MATCH':`UNMATCHED-${id}`;
 String.prototype.normalize=function(...args){if(String(this).startsWith('UNMATCHED-'))unmatchedNormalizations++;return original.apply(this,args);};
 try{const page=await f.controller.readPreparationObjects({schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'names',names:['MATCH',...Array.from({length:31},(_,at)=>`QUERY-${at}`)],rootObjectId:null,cursor:0,limit:128});
  assert.deepEqual(page.objects.map(object=>object.objectId),[2]);assert.deepEqual(page.objects[0].matchedNames,['MATCH']);assert.equal(unmatchedNormalizations,2);
 }finally{String.prototype.normalize=original;f.controller.dispose();}
});
test('preparation subtree and endpoint-ancestor modes preserve full hierarchy and distinguish physical leaves',async()=>{
 const f=fixture();f.tree.getChildCount=id=>id===1?2:0;f.tree.enumNodeChildren=(id,fn)=>{if(id===1){fn(2);fn(3);}};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'subtree',names:[],rootObjectId:2,cursor:0,limit:128};
 const subtree=await f.controller.readPreparationObjects(request),ancestors=await f.controller.readPreparationObjects({...request,mode:'ancestors'});
 assert.deepEqual(subtree.objects.map(x=>x.objectId),[1,2]);assert.deepEqual(ancestors.objects,subtree.objects);assert.equal(subtree.objects[1].isPhysicalLeaf,true);assert.equal(subtree.objects[0].isPhysicalLeaf,false);
 f.controller.dispose();
});

test('batched subtree traversal unions multiple parents and overlapping roots in global order with complete bounded pagination',async()=>{
 const f=fixture(),children=new Map([[1,[2,4]],[2,[3]],[4,[5]]]),parents=new Map([[1,0],[2,1],[3,2],[4,1],[5,4]]);
 f.tree.getNodeName=id=>`Node${id}`;f.tree.getNodeParentId=id=>parents.get(id);f.tree.getChildCount=id=>(children.get(id)??[]).length;
 f.tree.enumNodeChildren=(id,visit,recursive)=>{for(const child of children.get(id)??[]){if(visit(child))break;if(recursive)f.tree.enumNodeChildren(child,visit,true);}};
 f.tree.enumNodeFragments=(id,visit)=>{if(id===3||id===5)visit(id);};f.fragments.getCount=()=>6;
 let visibilityReads=0;f.fragments.isFragVisible=()=>{visibilityReads++;return true;};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'subtrees',names:[],rootObjectId:null,rootObjectIds:[4,2,3],cursor:0,limit:2},objects=[];let pages=0;
 for(;;){const page=await f.controller.readPreparationObjects(request);pages++;assert.deepEqual(page.rootObjectIds,[4,2,3]);objects.push(...page.objects);
  if(page.complete)break;assert.ok(page.nextCursor>request.cursor);request.cursor=page.nextCursor;request.visibilityScope=page.visibilityScope;}
 assert.deepEqual(objects.map(object=>object.objectId),[1,2,3,4,5]);assert.equal(new Set(objects.map(object=>object.objectId)).size,5);
 assert.deepEqual(objects.filter(object=>object.isPhysicalLeaf).map(object=>object.objectId),[3,5]);assert.equal(pages,3);
 assert.equal(visibilityReads,6*2*pages);f.controller.dispose();
});

test('batched subtree traversal refuses missing or duplicated roots and a changed active model without partial results',async()=>{
 const f=fixture(),request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'subtrees',names:[],rootObjectId:null,rootObjectIds:[2,3],cursor:0,limit:128};
 await assert.rejects(()=>f.controller.readPreparationObjects({...request,rootObjectIds:[2,999]}),{code:'PREPARATION_SCOPE_INVALID'});
 await assert.rejects(()=>f.controller.readPreparationObjects({...request,rootObjectIds:[2,2]}),{code:'PREPARATION_SCOPE_INVALID'});
 f.viewer.model={...f.model};await assert.rejects(()=>f.controller.readPreparationObjects(request),{code:'MODEL_SELECTION_CHANGED'});f.controller.dispose();
});

test('batched subtree pages retain fresh before-and-after visibility checks and refuse cross-page changes',async()=>{
 const f=fixture(),hidden=new Set(),request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'subtrees',names:[],rootObjectId:null,rootObjectIds:[2,3],cursor:0,limit:1};
 f.tree.isNodeHidden=id=>hidden.has(id);const first=await f.controller.readPreparationObjects(request);hidden.add(3);
 await assert.rejects(()=>f.controller.readPreparationObjects({...request,cursor:first.nextCursor,visibilityScope:first.visibilityScope}),{code:'PREPARATION_VISIBILITY_CHANGED'});
 hidden.clear();const original=f.tree.enumNodeFragments;f.tree.enumNodeFragments=(id,visit,recursive)=>{if(id===2)hidden.add(3);original(id,visit,recursive);};
 await assert.rejects(()=>f.controller.readPreparationObjects({...request,limit:128}),{code:'PREPARATION_VISIBILITY_CHANGED'});f.controller.dispose();
});

test('batched subtree pagination preserves the24KiB UTF8 ceiling without silently dropping shared ancestors or roots',async()=>{
 const f=fixture(),children=Array.from({length:128},(_,at)=>at+2);f.tree.getNodeName=id=>id===1?'Plant':'界'.repeat(2048);
 f.tree.getChildCount=id=>id===1?children.length:0;f.tree.enumNodeChildren=(id,visit)=>{if(id===1)children.forEach(visit);};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'subtrees',names:[],rootObjectId:null,rootObjectIds:[1,2],cursor:0,limit:128},seen=[];
 for(let at=0;at<100;at++){const page=await f.controller.readPreparationObjects(request);assert.ok(Buffer.byteLength(JSON.stringify(page))<=24576);seen.push(...page.objects.map(object=>object.objectId));
  if(page.complete)break;assert.ok(page.nextCursor>request.cursor);request.cursor=page.nextCursor;request.visibilityScope=page.visibilityScope;}
 assert.deepEqual(seen,[1,...children]);assert.equal(new Set(seen).size,129);f.controller.dispose();
});
test('preparation property discovery retains every property-only candidate and explicit omitted-row evidence',async()=>{
 for(const omitted of [false,true]){
  const f=fixture();f.tree.getChildCount=id=>id===1?2:0;let calls=0;f.model.getBulkProperties=(ids,_options,success)=>{calls++;success(ids.filter(id=>!omitted||id!==3).map(dbId=>({dbId,properties:dbId===1?[]:[{displayName:'Equipment Tag',displayValue:'p-001'}]})));};
  const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['P-001'],rootObjectId:null,cursor:0,limit:1},first=await f.controller.readPreparationObjects(request),second=first.complete?null:await f.controller.readPreparationObjects({...request,cursor:first.nextCursor});
  assert.equal(calls,1);assert.equal(first.propertyScan.complete,!omitted);assert.equal(first.propertyScan.omittedObjectCount,omitted?1:0);assert.deepEqual([...first.objects,...(second?.objects??[])].map(x=>x.objectId),omitted?[2]:[2,3]);f.controller.dispose();
 }
});
test('explicit location discovery observes canonical bottom centres without selecting or reloading the model',async()=>{
 const f=fixture();let calls=0;f.model.getBulkProperties=(ids,_options,yes)=>{calls++;yes(ids.map(dbId=>({dbId,properties:dbId===2?[{displayName:'Tag',displayValue:'/2149004__0e'}]:[]})));};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['/2149004__0e'],rootObjectId:null,cursor:0,limit:128,includeAnchors:true};
 const page=await f.controller.readPreparationObjects(request);assert.equal(page.includeAnchors,true);assert.equal(page.propertyScan.complete,true);assert.equal(page.objects.length,1);
 const bounds={minimum:[(1000000.123456+2)*.001,(-2000000.654321+2)*.001,(3000+3)*.001],maximum:[(1000000.123456+3)*.001,(-2000000.654321+4)*.001,(3000+5)*.001]};
 assert.deepEqual(page.objects[0].bounds,bounds);assert.deepEqual(page.objects[0].bottomCentre,[(bounds.minimum[0]+bounds.maximum[0])/2,(bounds.minimum[1]+bounds.maximum[1])/2,bounds.minimum[2]]);
 assert.equal(f.viewer.model,f.model);assert.equal(f.viewer.isolated,undefined);
 const {includeAnchors:_include,...withoutAnchors}=request;const old=await f.controller.readPreparationObjects(withoutAnchors);
 assert.equal(calls,1);assert.equal(Object.hasOwn(old,'includeAnchors'),false);assert.equal(Object.hasOwn(old.objects[0],'bounds'),false);f.controller.dispose();
});
test('unavailable bounds remain an explicit unavailable candidate rather than dropping an ambiguous object',async()=>{
 const f=fixture();f.model.getBulkProperties=(ids,_options,yes)=>yes(ids.map(dbId=>({dbId,properties:dbId!==1?[{displayName:'Tag',displayValue:'P-001'}]:[]})));
 f.fragments.getWorldBounds=(id,box)=>{if(id===3)throw new Error('Geometry unavailable');box.expandByPoint({x:1,y:2,z:3});box.expandByPoint({x:2,y:3,z:4});};
 const page=await f.controller.readPreparationObjects({schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['P-001'],rootObjectId:null,cursor:0,limit:128,includeAnchors:true});
 assert.deepEqual(page.objects.map(o=>o.objectId),[2,3]);assert.notEqual(page.objects[0].bounds,null);assert.equal(page.objects[1].bounds,null);assert.equal(page.objects[1].bottomCentre,null);assert.equal(page.propertyScan.complete,true);f.controller.dispose();
});
test('independent location report keeps hidden duplicate identities without qualifying their display points',async()=>{
 const f=fixture();f.model.getBulkProperties=(ids,_options,yes)=>yes(ids.map(dbId=>({dbId,properties:dbId!==1?[{displayName:'Tag',displayValue:'P-001'}]:[]})));
 f.tree.isNodeHidden=id=>id===3;
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['P-001'],rootObjectId:null,cursor:0,limit:128};
 const old=await f.controller.readPreparationObjects(request);assert.deepEqual(old.objects.map(o=>o.objectId),[2]);
 const report=await f.controller.readPreparationObjects({...request,includeAnchors:true});assert.deepEqual(report.objects.map(o=>o.objectId),[2,3]);assert.notEqual(report.objects[0].bounds,null);assert.equal(report.objects[1].bounds,null);f.controller.dispose();
});
test('preparation equipment caches only one complete query scope and reuses identical query pages',async()=>{
 const f=fixture();f.tree.getChildCount=id=>id===1?2:0;let calls=0;
 f.model.getBulkProperties=(ids,_options,success)=>{calls++;success(ids.map(dbId=>({dbId,properties:dbId===1?[]:dbId===2?[{displayName:'Equipment Tag',displayValue:' p-001 '},{displayName:'Location',displayValue:'Cafe\u0301'}]:[{attributeName:'equipment_name',displayValue:'P-002'}]})));};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['P-001'],rootObjectId:null,cursor:0,limit:1};
 const first=await f.controller.readPreparationObjects(request);
 await f.controller.readPreparationObjects(request);assert.equal(calls,1);
 const second=await f.controller.readPreparationObjects({...request,names:['P-002']});
 const third=await f.controller.readPreparationObjects({...request,names:['Caf\u00e9','p-001','P-001']});
 assert.equal(calls,3);assert.deepEqual(first.objects.map(x=>x.objectId),[2]);assert.deepEqual(second.objects.map(x=>x.objectId),[3]);
 assert.deepEqual(third.objects[0].matchedNames,['Caf\u00e9','p-001','P-001']);assert.deepEqual(second.propertyScan,first.propertyScan);assert.deepEqual(third.propertyScan,first.propertyScan);
 for(const name of ['P-01','P-001-extra','P-00'])assert.deepEqual((await f.controller.readPreparationObjects({...request,names:[name]})).objects,[]);
 assert.equal(calls,6);f.controller.dispose();
});

test('equipment name chunks share one complete bounded index universe without echoing unrelated query names',async()=>{
 const f=fixture(),indexNames=['P-001','P-002','P-003','P-004'];let calls=0;
 f.model.getBulkProperties=(ids,_options,success)=>{calls++;success(ids.map(dbId=>({dbId,properties:dbId===1?[]:[{displayName:'Tag',displayValue:dbId===2?'P-001':'P-003'}]})));};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['P-001'],indexNames,rootObjectId:null,cursor:0,limit:128};
 for(const name of indexNames){const page=await f.controller.readPreparationObjects({...request,names:[name]});assert.deepEqual(page.names,[name]);assert.ok(!Object.hasOwn(page,'indexNames'));assert.deepEqual(page.objects.map(value=>value.objectId),name==='P-001'?[2]:name==='P-003'?[3]:[]);assert.equal(page.propertyScan.complete,true);}
 assert.equal(calls,1);
 f.tree.isNodeHidden=id=>id===3;
 assert.deepEqual((await f.controller.readPreparationObjects({...request,names:['P-003']})).objects,[]);assert.equal(calls,1);
 f.tree.isNodeHidden=()=>false;
 assert.deepEqual((await f.controller.readPreparationObjects({...request,names:['P-003']})).objects.map(value=>value.objectId),[3]);assert.equal(calls,1);
 await f.controller.readPreparationObjects({...request,indexNames:['P-001']});assert.equal(calls,2);
 await assert.rejects(()=>f.controller.readPreparationObjects({...request,names:['FOREIGN']}),{code:'PREPARATION_SCOPE_INVALID'});assert.equal(calls,2);f.controller.dispose();
});
test('preparation cached equipment coverage retains omissions and never matches an omitted row by its node name',async()=>{
 const f=fixture();f.tree.getChildCount=id=>id===1?2:0;let calls=0;
 f.model.getBulkProperties=(ids,_options,success)=>{calls++;success(ids.filter(dbId=>dbId!==3).map(dbId=>({dbId,properties:dbId===2?[{displayName:'Tag',displayValue:'P-001'}]:[]})));};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['P-001'],rootObjectId:null,cursor:0,limit:128};
 const first=await f.controller.readPreparationObjects(request),second=await f.controller.readPreparationObjects({...request,names:['=CAB-002']});
 assert.equal(calls,2);assert.deepEqual(second.objects,[]);assert.deepEqual(second.propertyScan,first.propertyScan);assert.deepEqual(first.propertyScan,{attemptedObjectCount:3,returnedObjectCount:2,omittedObjectCount:1,complete:false});f.controller.dispose();
});
test('preparation equipment accepts one model leading slash without changing project queries or tray matching',async()=>{
 const f=fixture();f.tree.getChildCount=id=>id===1?2:0;f.tree.getNodeName=id=>({1:'Plant',2:'/=A001',3:'//=A001'})[id];let calls=0;
 f.model.getBulkProperties=(ids,_options,success)=>{calls++;success(ids.map(dbId=>({dbId,properties:[]})));};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['=A001','/=A001'],rootObjectId:null,cursor:0,limit:128};
 const result=await f.controller.readPreparationObjects(request);assert.deepEqual(result.names,request.names);assert.deepEqual(result.objects.map(x=>[x.objectId,x.matchedNames]),[[2,['=A001','/=A001']]]);
 for(const name of ['A001','=A1','=A001/','=A001/PART'])assert.deepEqual((await f.controller.readPreparationObjects({...request,names:[name]})).objects,[]);
 assert.deepEqual((await f.controller.readPreparationObjects({...request,mode:'names',names:['=A001']})).objects,[]);assert.equal(calls,5);f.controller.dispose();
});
test('preparation equipment retains all exact and slash-decorated property candidates instead of choosing one',async()=>{
 const f=fixture();f.tree.getChildCount=id=>id===1?2:0;
 f.model.getBulkProperties=(ids,_options,success)=>success(ids.map(dbId=>({dbId,properties:dbId===1?[]:[{displayName:'Tag',displayValue:dbId===2?'/=A001':'=A001'},{displayName:'Description',displayValue:'/=IGNORED'}]})));
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['=A001','=IGNORED'],rootObjectId:null,cursor:0,limit:128},result=await f.controller.readPreparationObjects(request);
 assert.deepEqual(result.objects.map(x=>[x.objectId,x.matchedNames]),[[2,['=A001','=IGNORED']],[3,['=A001','=IGNORED']]]);assert.equal(result.propertyScan.complete,true);f.controller.dispose();
});
test('preparation failed equipment builds are cleared rather than reused for another name batch',async()=>{
 for(const invalid of ['duplicate','oversized-value','oversized-row']){
  const f=fixture();f.tree.getChildCount=id=>id===1?2:0;let calls=0;
  f.model.getBulkProperties=(ids,_options,success)=>{calls++;const rows=ids.map(dbId=>({dbId,properties:[{displayName:'Tag',displayValue:'P-001'}]}));if(calls===1){if(invalid==='duplicate')rows[1]=rows[0];else if(invalid==='oversized-value')rows[0].properties[0].displayValue=' '.repeat(65537)+'P-001';else rows[0].properties=Array(4097).fill({displayName:'Tag',displayValue:'P-001'});}success(rows);};
  const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['P-001'],rootObjectId:null,cursor:0,limit:128};
  await assert.rejects(()=>f.controller.readPreparationObjects(request),{code:invalid==='duplicate'?'PREPARATION_EQUIPMENT_PROPERTIES_INVALID':'PREPARATION_EQUIPMENT_ROW_LIMIT'});
  const recovered=await f.controller.readPreparationObjects({...request,names:['p-001']});assert.equal(calls,2);assert.equal(recovered.objects.length,3);assert.equal(recovered.propertyScan.complete,true);f.controller.dispose();
 }
});

test('equipment SDK callback refusal and the whole-page deadline have distinct safe diagnostics',async()=>{
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['P-001'],rootObjectId:null,cursor:0,limit:128};
 const refused=fixture();refused.model.getBulkProperties=(_ids,_options,_yes,no)=>no(new Error('Private SDK details'));
 await assert.rejects(()=>refused.controller.readPreparationObjects(request),{code:'PREPARATION_EQUIPMENT_PROPERTIES_FAILED'});refused.controller.dispose();
 const expired=fixture(),originalNow=Date.now;let now=0;Date.now=()=>now;
 try{expired.model.getBulkProperties=(ids,_options,yes)=>{now=300001;yes(ids.map(dbId=>({dbId,properties:[]})));};
  await assert.rejects(()=>expired.controller.readPreparationObjects(request),{code:'PREPARATION_DISCOVERY_DEADLINE'});
 }finally{Date.now=originalNow;expired.controller.dispose();}
});

test('equipment SDK callback retains its45second deadline and returns a specific timeout code',async t=>{
 const f=fixture(),original=globalThis.setTimeout;let timeouts=0;
 t.mock.method(globalThis,'setTimeout',(callback,milliseconds,...args)=>{if(milliseconds===45000){timeouts++;return original(callback,1,...args);}return original(callback,milliseconds,...args);});
 f.model.getBulkProperties=()=>{};
 await assert.rejects(()=>f.controller.readPreparationObjects({schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['P-001'],rootObjectId:null,cursor:0,limit:128}),{code:'PREPARATION_EQUIPMENT_PROPERTIES_TIMEOUT'});
 assert.equal(timeouts,2);f.controller.dispose();
});

test('equipment raw-property scan retains the32million limit with a specific failure',async()=>{
 const f=fixture(),properties=new Array(1000000);
 f.tree.getNodeName=id=>'Object '+id;f.tree.enumNodeChildren=(id,visit)=>{if(id===1)for(let child=2;child<=33;child++)visit(child);};
 f.tree.getNodeParentId=id=>id===1?0:1;f.model.getBulkProperties=(ids,_options,yes)=>yes(ids.map(dbId=>({dbId,properties})));
 await assert.rejects(()=>f.controller.readPreparationObjects({schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['NONE'],rootObjectId:null,cursor:0,limit:128}),{code:'PREPARATION_EQUIPMENT_SCAN_LIMIT'});f.controller.dispose();
});
test('preparation equipment scans a real-shaped wide structural row without charging child links as endpoint keys',async()=>{
 const f=fixture();f.tree.getChildCount=id=>id===1?2:0;let calls=0;
 const childLinks=Array.from({length:7691},(_,index)=>({displayName:'child',displayValue:index+1,displayCategory:'__child__',hidden:true}));
 f.model.getBulkProperties=(ids,_options,success)=>{calls++;success(ids.map(dbId=>({dbId,properties:dbId===1?[...childLinks,{displayName:'Name',displayValue:'/=A001'}]:[{displayName:'Tag',displayValue:dbId===2?'P-001':'P-002'}]})));};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['=A001'],rootObjectId:null,cursor:0,limit:128};
 const first=await f.controller.readPreparationObjects(request),second=await f.controller.readPreparationObjects({...request,names:['P-002']});
 assert.deepEqual(first.objects.map(value=>value.objectId),[1]);assert.deepEqual(second.objects.map(value=>value.objectId),[3]);assert.deepEqual(first.propertyScan,{attemptedObjectCount:3,returnedObjectCount:3,omittedObjectCount:0,complete:true});assert.equal(calls,2);f.controller.dispose();
});
test('preparation equipment cancellation discards the unfinished index and ignores its late SDK callback',async()=>{
 const f=fixture();f.tree.getChildCount=id=>id===1?2:0;let calls=0,late,started;
 const began=new Promise(resolve=>{started=resolve;});
 f.model.getBulkProperties=(ids,_options,success)=>{calls++;if(calls===1){late=()=>success(ids.map(dbId=>({dbId,properties:[{displayName:'Tag',displayValue:'STALE'}]})));started();}else success(ids.map(dbId=>({dbId,properties:[{displayName:'Tag',displayValue:'CURRENT'}]})));};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['STALE'],rootObjectId:null,cursor:0,limit:128},abort=new AbortController();
 const pending=f.controller.readPreparationObjects(request,abort.signal);await began;abort.abort();await assert.rejects(pending,{name:'AbortError'});late();
 const recovered=await f.controller.readPreparationObjects({...request,names:['CURRENT']});assert.equal(calls,2);assert.equal(recovered.objects.length,3);assert.deepEqual((await f.controller.readPreparationObjects(request)).objects,[]);assert.equal(calls,3);f.controller.dispose();
});
test('preparation equipment cache is scoped to the active model and disposed controller',async()=>{
 const f=fixture();f.tree.getChildCount=id=>id===1?2:0;let calls=0;
 f.model.getBulkProperties=(ids,_options,success)=>{calls++;success(ids.map(dbId=>({dbId,properties:[{displayName:'Tag',displayValue:'P-001'}]})));};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['P-001'],rootObjectId:null,cursor:0,limit:128};
 await f.controller.readPreparationObjects(request);f.viewer.model={...f.model};await assert.rejects(()=>f.controller.readPreparationObjects(request),{code:'MODEL_SELECTION_CHANGED'});f.viewer.model=f.model;
 await f.controller.readPreparationObjects(request);assert.equal(calls,2);f.controller.dispose();await assert.rejects(()=>f.controller.readPreparationObjects(request),{name:'AbortError'});assert.equal(calls,2);
 const next=createPathFinderController(f.viewer,{window:{THREE:{}}});await next.readPreparationObjects(request);assert.equal(calls,3);next.dispose();
});
test('preparation searches arbitrary own scalar human properties and excludes hidden/internal values',async()=>{
 const f=fixture();f.model.getBulkProperties=(ids,_options,success)=>success(ids.map(dbId=>({dbId,properties:dbId===2?[{displayName:'ACS functional designation',displayValue:'/=CUSTOM'},{displayName:'Number',displayValue:42},{displayName:'Boolean',displayValue:true},{displayName:'Tag',displayValue:'SECRET',hidden:true},{displayCategory:'__child__',displayName:'Tag',displayValue:'CHILD'},{displayName:'Description',displayValue:'x'.repeat(100000)}]:[]})));
 const page=await f.controller.readPreparationObjects({schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['=CUSTOM','42','true','SECRET','CHILD'],rootObjectId:null,cursor:0,limit:128});assert.deepEqual(page.objects.map(value=>[value.objectId,value.matchedNames]),[[2,['=CUSTOM','42','true']]]);assert.equal(page.propertyScan.complete,true);f.controller.dispose();
});
test('query cached duplicate postings are re-filtered against fresh display visibility on every page',async()=>{
 const f=fixture(),hidden=new Set();let calls=0;f.tree.isNodeHidden=id=>hidden.has(id);f.model.getBulkProperties=(ids,_options,success)=>{calls++;success(ids.map(dbId=>({dbId,properties:dbId===1?[]:[{displayName:'Any custom label',displayValue:'EQ'}]})));};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['EQ'],rootObjectId:null,cursor:0,limit:128},first=await f.controller.readPreparationObjects(request);assert.deepEqual(first.objects.map(value=>value.objectId),[2,3]);hidden.add(2);
 const second=await f.controller.readPreparationObjects(request);assert.deepEqual(second.objects.map(value=>value.objectId),[3]);assert.notEqual(first.visibilityScope.contentSha256,second.visibilityScope.contentSha256);assert.equal(calls,1);
 await assert.rejects(()=>f.controller.readPreparationObjects({...request,visibilityScope:first.visibilityScope}),{code:'PREPARATION_VISIBILITY_CHANGED'});hidden.delete(2);const shown=await f.controller.readPreparationObjects({...request,visibilityScope:first.visibilityScope});assert.deepEqual(shown.objects.map(value=>value.objectId),[2,3]);assert.equal(calls,1);f.controller.dispose();
});
test('visibility mutation while SDK properties are read refuses a completed discovery',async()=>{
 const f=fixture(),hidden=new Set();f.tree.isNodeHidden=id=>hidden.has(id);f.model.getBulkProperties=(ids,_options,success)=>{hidden.add(2);success(ids.map(dbId=>({dbId,properties:[{displayName:'Tag',displayValue:'EQ'}]})));};
 await assert.rejects(()=>f.controller.readPreparationObjects({schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['EQ'],rootObjectId:null,cursor:0,limit:128}),{code:'PREPARATION_VISIBILITY_CHANGED'});f.controller.dispose();
});
test('missing or partially visible fragment geometry never becomes an automatic endpoint',async()=>{
 const f=fixture();f.model.getBulkProperties=(ids,_options,success)=>success(ids.map(dbId=>({dbId,properties:dbId===2?[{displayName:'Tag',displayValue:'EQ'}]:[]})));f.tree.enumNodeFragments=(id,visit)=>{if(id===2){visit(2);visit(3);}};f.fragments.isFragVisible=id=>id!==3;
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['EQ'],rootObjectId:null,cursor:0,limit:128};assert.deepEqual((await f.controller.readPreparationObjects(request)).objects,[]);delete f.fragments.isFragVisible;await assert.rejects(()=>f.controller.readPreparationObjects(request),{code:'PREPARATION_VISIBILITY_UNAVAILABLE'});f.controller.dispose();
});
test('PF Ghost is restored before visibility discovery while actual user-hidden objects remain excluded',async()=>{
 const f=fixture(),hidden=new Set([3]);f.tree.isNodeHidden=id=>hidden.has(id)||(f.viewer.isolated?.length>0&&id!==1&&!f.viewer.isolated.includes(id));f.model.getBulkProperties=(ids,_options,success)=>success(ids.map(dbId=>({dbId,properties:dbId===1?[]:[{displayName:'Tag',displayValue:'EQ'}]})));
 f.controller.showPath({points:[[1000,-2000,3],[1001,-2000,3]],objectIds:[2]});assert.ok(f.meshes.length);const page=await f.controller.readPreparationObjects({schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['EQ'],rootObjectId:null,cursor:0,limit:128});assert.deepEqual(page.objects.map(value=>value.objectId),[2]);assert.equal(f.meshes.length,0);assert.equal(f.viewer.impl.fadeMaterial.opacity,.15);assert.deepEqual(f.model.visibilityManager.states,[[3,false]]);f.controller.dispose();
});
test('failed PF visibility restore refuses observation and remains retryable without a false property scan',async()=>{
 const f=fixture();let calls=0;f.model.getBulkProperties=(ids,_options,success)=>{calls++;success(ids.map(dbId=>({dbId,properties:[]})));};f.controller.showPath({points:[[1000,-2000,3]],objectIds:[2]});const restore=f.model.visibilityManager.setVisibility;f.model.visibilityManager.setVisibility=()=>{throw Error('SDK restore failed');};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['=CAB-001'],rootObjectId:null,cursor:0,limit:128};await assert.rejects(()=>f.controller.readPreparationObjects(request),{code:'APPEARANCE_RESTORE_FAILED'});assert.equal(calls,0);f.model.visibilityManager.setVisibility=restore;assert.deepEqual((await f.controller.readPreparationObjects(request)).objects.map(value=>value.objectId),[2]);f.controller.dispose();
});
test('a pre-PF baseline without exact visibility restoration stays unknown even after legacy Clear',async()=>{
 const f=fixture();delete f.model.visibilityManager.getVisibility;f.controller.showPath({points:[[1000,-2000,3]],objectIds:[2]});assert.throws(()=>f.controller.prepareForVisibilityObservation(),{code:'PREPARATION_VISIBILITY_UNAVAILABLE'});f.controller.clear();assert.throws(()=>f.controller.prepareForVisibilityObservation(),{code:'PREPARATION_VISIBILITY_UNAVAILABLE'});f.controller.dispose();
});
test('query-scoped equipment discovery handles438155 SDKrows without retaining unrelated property postings',{timeout:30000},async t=>{
 const f=fixture(),count=438155,fragmentCount=664556;let calls=0,fragmentReads=0;const originalTimeout=globalThis.setTimeout;
 t.mock.method(globalThis,'setTimeout',(callback,milliseconds,...args)=>{if(milliseconds===0)return setImmediate(callback,...args);return originalTimeout(callback,milliseconds,...args);});
 f.tree.getNodeName=id=>id===1?'Plant':'Equipment '+id;f.tree.getNodeParentId=id=>id===1?0:1;f.tree.getChildCount=id=>id===1?count-1:0;f.tree.enumNodeChildren=(id,visit)=>{if(id===1)for(let child=2;child<=count;child++)visit(child);};f.tree.enumNodeFragments=(id,visit)=>{if(id===count)visit(0);};f.fragments.getCount=()=>fragmentCount;f.fragments.isFragVisible=()=>{fragmentReads++;return true;};
 f.model.getBulkProperties=(ids,_options,success)=>{calls++;success(ids.map(dbId=>({dbId,properties:Array.from({length:8},(_,index)=>({displayName:'Custom scalar '+index,displayValue:dbId===count&&index===0?'TARGET':'Unrelated '+dbId+':'+index}))})));};
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'equipment',names:['TARGET'],rootObjectId:null,cursor:0,limit:128},started=performance.now(),before=process.memoryUsage().rss,first=await f.controller.readPreparationObjects(request);assert.deepEqual(first.objects.map(value=>value.objectId),[count]);assert.equal(first.propertyScan.returnedObjectCount,count);assert.equal(first.propertyScan.complete,true);assert.equal(calls,Math.ceil(count/512));
 const second=await f.controller.readPreparationObjects({...request,visibilityScope:first.visibilityScope});assert.deepEqual(second.objects.map(value=>value.objectId),[count]);assert.equal(calls,Math.ceil(count/512));assert.equal(fragmentReads,fragmentCount*4);t.diagnostic(JSON.stringify({scope:'synthetic-source-capacity-zero-delay-yields-accelerated-not-real-SDK',rows:count,scalarValues:count*8,fragmentVisibilitySlots:fragmentCount,sdkPropertyCalls:calls,queryMatches:1,milliseconds:Math.round(performance.now()-started),rssDeltaBytes:process.memoryUsage().rss-before}));f.controller.dispose();
});
test('preparation cancelled discovery cannot complete',async()=>{
 const f=fixture();f.tree.getChildCount=id=>id===1?2:0;const abort=new AbortController();abort.abort();await assert.rejects(()=>f.controller.readPreparationObjects({schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'subtree',names:[],rootObjectId:1,cursor:0,limit:128},abort.signal),{name:'AbortError'});f.controller.dispose();
});
test('preparation subtree pagination bounds actual UTF8 records without silent truncation',async()=>{
 const f=fixture(),children=Array.from({length:128},(_,i)=>i+2);f.tree.getNodeName=id=>id===1?'Plant':'界'.repeat(2048);f.tree.getChildCount=id=>id===1?children.length:0;f.tree.enumNodeChildren=(id,fn)=>{if(id===1)children.forEach(fn);};
 const seen=[],request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'subtree',names:[],rootObjectId:1,cursor:0,limit:128};
 for(let pages=0;pages<100;pages++){const page=await f.controller.readPreparationObjects(request);assert.ok(Buffer.byteLength(JSON.stringify(page))<=24576);seen.push(...page.objects.map(object=>object.objectId));if(page.complete)break;assert.ok(page.nextCursor>request.cursor);request.cursor=page.nextCursor;}
 assert.deepEqual(seen,[1,...children]);assert.equal(new Set(seen).size,129);f.controller.dispose();
});

test('exact ordered path is rendered without fitting; filled Ghost and all original fades restore', () => {
  const f = fixture(), coordinates = modelCoordinates(f.model), points = [[4, 5, 6], [5, 7, 9], [8, 9, 10]].map(point => coordinates.toCanonical(point));
  f.controller.showPath({ points, objectIds: [2] });
  assert.equal(f.meshes.length, 1); assert.equal(f.meshes[0].material.color, 0xffe600); assert.equal(f.meshes[0].isMesh, true); assert.equal(f.meshes[0].material.depthTest, false);
  const positions = f.meshes[0].geometry.position.array, centre = index => Array.from(positions.slice(index * 3, index * 3 + 3)).map(value => Math.round(value * 1e6) / 1e6);
  assert.deepEqual([centre(16), centre(17), centre(34), centre(35)], [[0, 0, 0], [1, 2, 3], [1, 2, 3], [4, 4, 4]]);
  assert.ok(f.meshes[0].geometry.index.array instanceof Uint16Array); assert.equal(f.meshes[0].geometry.index.array.length, 192);
  assert.deepEqual(f.viewer.isolated, [2]); assert.equal(f.viewer.impl.showGhosting, true); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.025);
  const resource = f.meshes[0]; f.controller.clear(); assert.equal(f.meshes.length, 0);
  assert.equal(resource.geometry.disposed, true); assert.equal(resource.material.disposed, true);
  assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.15); assert.equal(f.viewer.impl.fadeMaterial.variants[0].opacity, 0.3); assert.equal(f.viewer.impl.showGhosting, false); f.controller.dispose();
});

test('merged yellow tubes retain exact segment axes, vertical/reversed order and a bounded Uint16 draw budget', () => {
  const points = [[1000000000, -20, 30], [1000000000, -20, 40], [1000000003, -16, 40], [1000000000, -20, 40]], original = structuredClone(points);
  const result = createExactPathBatches(points, 0.02); assert.deepEqual(points, original); assert.deepEqual(result.origin, points[0]); assert.equal(result.segmentCount, 3); assert.equal(result.markerRadius, null);
  const positions = result.batches[0].positions, indices = result.batches[0].indices;
  for (let segment = 0; segment < 3; segment++) for (let end = 0; end < 2; end++) {
    const centre = points[segment + end].map((value, axis) => value - result.origin[axis]), offset = (segment * 18 + 16 + end) * 3;
    assert.deepEqual(Array.from(positions.slice(offset, offset + 3)), centre);
    for (let ring = 0; ring < 8; ring++) {
      const vertex = Array.from(positions.slice((segment * 18 + end * 8 + ring) * 3, (segment * 18 + end * 8 + ring + 1) * 3));
      assert.ok(Math.abs(Math.hypot(...vertex.map((value, axis) => value - centre[axis])) - 0.02) < 1e-6);
    }
  }
  assert.equal(indices.length, 3 * 96); assert.ok(indices.every(index => index < positions.length / 3));
  const maximum = createExactPathBatches(Array.from({ length: 20000 }, (_, index) => [index, 0, 0]), 0.02);
  assert.equal(maximum.segmentCount, 19999); assert.equal(maximum.batches.length, 10);
  for (const batch of maximum.batches) { assert.ok(batch.indices instanceof Uint16Array); assert.ok(batch.positions.length / 3 <= 36000); assert.ok(batch.indices.every(index => index < batch.positions.length / 3)); }
  assert.throws(() => createExactPathBatches(Array.from({ length: 20001 }, (_, index) => [index, 0, 0]), 0.02), { code: 'PATH_INVALID' });
});

test('native-shaped zero-length one-point path becomes a marker without fabricating a second point or length', () => {
  const f = fixture(), point = modelCoordinates(f.model).toCanonical([4, 5, 6]), supplied = [point], before = structuredClone(supplied);
  const result = f.controller.showPath({ points: supplied, objectIds: [] });
  assert.deepEqual(supplied, before); assert.equal(result.pointCount, 1); assert.equal(f.meshes.length, 1); assert.equal(f.meshes[0].geometry.radius, 20); assert.equal(f.meshes[0].material.color, 0xffe600);
  assert.ok(Math.abs(f.meshes[0].position.x - 4) < 1e-9); assert.ok(f.viewer.fittedBounds.max.x > f.viewer.fittedBounds.min.x);
  assert.ok(validateEnvelope(envelope('BEGIN_COMPUTED_PATH', { pathId: uuid(6), pointCount: 1, objectIds: [] }), 'parent-to-frame'));
  assert.equal(validateEnvelope(envelope('BEGIN_COMPUTED_PATH', { pathId: uuid(6), pointCount: 0, objectIds: [] }), 'parent-to-frame'), null);
  const marker = f.meshes[0]; f.controller.clear(); assert.equal(marker.geometry.disposed, true); assert.equal(marker.material.disposed, true); assert.equal(f.meshes.length, 0); f.controller.dispose();
});

test('a computed path without SDK object IDs ghosts the full context and restores exact prior visibility', () => {
  const f = fixture(), coordinates = modelCoordinates(f.model), manager = f.model.visibilityManager;
  const prior = structuredClone({ defaultVisible: manager.defaultVisible, states: manager.states });
  f.controller.showPath({ points: [[4, 5, 6], [8, 9, 10]].map(point => coordinates.toCanonical(point)), objectIds: [] });
  assert.equal(manager.defaultVisible, false); assert.equal(f.viewer.impl.showGhosting, true); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.025); assert.equal(f.meshes.length, 1);
  f.controller.clear(); assert.deepEqual({ defaultVisible: manager.defaultVisible, states: manager.states }, prior); assert.equal(f.viewer.impl.showGhosting, false); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.15); f.controller.dispose();
});

test('bounded metadata deduplicates SDK root, retains names/identities and marks native visibility unknown', async () => {
  const f = fixture();
  const first = await f.controller.readObjects({ cursor: 0, limit: 1, query: 'CAB' });
  assert.equal(first.objects.length, 1); assert.equal(first.objects[0].objectId, 2); assert.equal(first.objects[0].externalId, 'externalA');
  assert.equal(first.objects[0].nativeVisibility, 'unknown'); assert.equal(first.objects[0].derivation, 'display-aabb-bottom-centre'); assert.equal(first.nextCursor, 2);
  assert.ok(validateEnvelope(envelope('MODEL_OBJECTS', first), 'frame-to-parent'));
  const second = await f.controller.readObjects({ cursor: first.nextCursor, limit: 16, query: 'CAB' });
  assert.equal(second.objects[0].objectId, 3); assert.equal(second.complete, true); f.controller.dispose();
});

test('current model selection returns exact canonical bottom centres without changing the SDK selection', async () => {
  const f = fixture(); f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [2, 3] }];
  const selected = await f.controller.readSelection();
  assert.deepEqual(selected.objects.map(object => object.objectId), [2, 3]);
  assert.deepEqual(selected.objects[0].bottomCentre, modelCoordinates(f.model).toCanonical([2.5, 3, 3]));
  assert.ok(validateEnvelope(envelope('MODEL_SELECTION', selected), 'frame-to-parent'));
  f.viewer.getAggregateSelection = () => [{ model: {}, selection: [2] }];
  await assert.rejects(() => f.controller.readSelection(), { code: 'EXTRACTION_FAILED' });
  f.viewer.getAggregateSelection = () => [{ model: f.model, selection: Array.from({ length: 17 }, (_, index) => index + 1) }];
  await assert.rejects(() => f.controller.readSelection(), { code: 'SELECTION_TOO_LARGE' });
  f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [99] }];
  await assert.rejects(() => f.controller.readSelection(), { code: 'EXTRACTION_FAILED' }); f.controller.dispose();
});

test('tray-root selection reads current IDs without inventory, properties, external IDs or geometry', async () => {
  const f = fixture(), calls = [];
  f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [2, 3] }];
  f.model.getInstanceTree = () => f.tree;
  for (const key of ['getObjectTree', 'getProperties', 'getExternalIdMapping', 'getFragmentList']) f.model[key] = () => { throw Error(`Forbidden rich read: ${key}`); };
  for (const key of ['enumNodeChildren', 'enumNodeFragments', 'getNodeName']) f.tree[key] = () => { throw Error(`Forbidden inventory read: ${key}`); };
  const selected = await f.controller.readTrayRootSelection(undefined, async () => calls.push('authorized-after'));
  assert.deepEqual(selected, { objects: [{ objectId: 2 }, { objectId: 3 }] });
  assert.deepEqual(calls, ['authorized-after']);
  assert.ok(validateEnvelope(envelope('TRAY_ROOT_SELECTION', selected), 'frame-to-parent'));
  f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [] }];
  f.model.getInstanceTree = () => { throw Error('Empty selection needs no tree.'); };
  assert.deepEqual(await f.controller.readTrayRootSelection(), { objects: [] }); f.controller.dispose();
});

test('tray-root selection refuses duplicate, foreign, unknown and oversized IDs and accepts 512 roots', async () => {
  const f = fixture(); f.model.getInstanceTree = () => f.tree;
  f.tree.getNodeIndex = id => id >= 1 && id <= 512 ? id - 1 : undefined;
  for (const selection of [[2, 2], [0], [513]]) {
    f.viewer.getAggregateSelection = () => [{ model: f.model, selection }];
    await assert.rejects(f.controller.readTrayRootSelection(), { code: 'TRAY_ROOT_SELECTION_UNAVAILABLE' });
  }
  f.viewer.getAggregateSelection = () => [{ model: {}, selection: [2] }];
  await assert.rejects(f.controller.readTrayRootSelection(), { code: 'TRAY_ROOT_SELECTION_UNAVAILABLE' });
  f.viewer.getAggregateSelection = () => [{ model: f.model, selection: Array.from({ length: 513 }, (_, at) => at + 1) }];
  await assert.rejects(f.controller.readTrayRootSelection(), { code: 'TRAY_ROOT_SELECTION_TOO_LARGE' });
  f.viewer.getAggregateSelection = () => [{ model: f.model, selection: Array.from({ length: 512 }, (_, at) => at + 1) }];
  assert.equal((await f.controller.readTrayRootSelection()).objects.length, 512); f.controller.dispose();
});

test('tray-root selection retains large model-local IDs and keeps SDK membership failures recoverable', async () => {
  const f = fixture(); f.model.getInstanceTree = () => f.tree;
  f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [426690] }];
  f.tree.getNodeIndex = id => ({ 426690: 0, 426692: 1, 426693: 2, 426694: 3, 426696: 4, 426698: 5 })[id];
  assert.deepEqual(await f.controller.readTrayRootSelection(), { objects: [{ objectId: 426690 }] });
  f.tree.getNodeIndex = () => { throw Error('Private SDK membership failure.'); };
  await assert.rejects(f.controller.readTrayRootSelection(), error => error.code === 'TRAY_ROOT_SELECTION_UNAVAILABLE' && !error.message.includes('Private'));
  f.viewer.getAggregateSelection = () => { throw Error('Private SDK selection failure.'); };
  await assert.rejects(f.controller.readTrayRootSelection(), { code: 'TRAY_ROOT_SELECTION_UNAVAILABLE' }); f.controller.dispose();
});

test('tray-root selection checks mutation, cancellation and model identity after authorization without committing IDs', async () => {
  const f = fixture(); let selected = [2]; f.model.getInstanceTree = () => f.tree;
  f.viewer.getAggregateSelection = () => [{ model: f.model, selection: selected }];
  await assert.rejects(f.controller.readTrayRootSelection(undefined, async () => { selected = [3]; }), { code: 'TRAY_ROOT_SELECTION_CHANGED' });
  const stop = new AbortController();
  await assert.rejects(f.controller.readTrayRootSelection(stop.signal, async () => stop.abort()), { name: 'AbortError' });
  await assert.rejects(f.controller.readTrayRootSelection(undefined, async () => { f.viewer.model = {}; }), { code: 'MODEL_SELECTION_CHANGED' });
  f.controller.dispose();
});

test('Model Browser parent and child retain their exact recursive bounding boxes without substitution', async () => {
  const f = fixture(); let selectedId = 1;
  f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [selectedId] }];
  f.tree.enumNodeFragments = (id, callback, recursive) => {
    if (id === 1 && recursive) { callback(2); callback(3); } else if (id === 2 || id === 3) callback(id);
  };
  const parent = (await f.controller.readSelection()).objects[0]; selectedId = 2;
  const child = (await f.controller.readSelection()).objects[0], coordinates = modelCoordinates(f.model);
  assert.equal(parent.objectId, 1); assert.equal(child.objectId, 2); assert.equal(child.parentId, 1);
  assert.deepEqual(parent.bounds, { minimum: coordinates.toCanonical([2, 2, 3]), maximum: coordinates.toCanonical([4, 4, 5]) });
  assert.deepEqual(child.bounds, { minimum: coordinates.toCanonical([2, 2, 3]), maximum: coordinates.toCanonical([3, 4, 5]) });
  assert.deepEqual(parent.bottomCentre, coordinates.toCanonical([3, 3, 3]));
  assert.deepEqual(child.bottomCentre, coordinates.toCanonical([2.5, 3, 3])); assert.notDeepEqual(parent.bottomCentre, child.bottomCentre); f.controller.dispose();
});
test('selected lower-plane centre applies display units and binary64 global offset exactly once', async () => {
  const f = fixture(); f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [2] }];
  f.model.getUnitScale = () => 2.5; f.model.getGlobalOffset = () => ({ x: -1.25, y: 2.5, z: -3.75 });
  const selected = await f.controller.readSelection(); assert.equal(selected.objects[0].objectId, 2);
  assert.deepEqual(selected.globalOffsetMetres, [-3.125, 6.25, -9.375]);
  assert.deepEqual(selected.objects[0].bounds, { minimum: [1.875, 11.25, -1.875], maximum: [4.375, 16.25, 3.125] });
  assert.deepEqual(selected.objects[0].bottomCentre, [3.125, 13.75, -1.875]);
  assert.equal(selected.objects[0].derivation, 'display-aabb-bottom-centre'); assert.equal(selected.objects[0].nativeVisibility, 'unknown'); f.controller.dispose();
});
test('an empty Model Browser selection remains empty instead of substituting an ancestor or model centre', async () => {
  const f = fixture(); f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [] }];
  assert.deepEqual((await f.controller.readSelection()).objects, []); f.controller.dispose();
});
test('a changed Model Browser selection during metadata read refuses the old bounding-centre result', async () => {
  const f = fixture(); let selectedId = 2; f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [selectedId] }];
  f.model.getProperties = (_id, success) => { selectedId = 3; success({ properties: [] }); };
  await assert.rejects(() => f.controller.readSelection(), { code: 'EXTRACTION_FAILED' }); f.controller.dispose();
});
test('fragment cap returns no selectable bbox rather than a partial selected-object centre', async () => {
  const f = fixture(); f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [2] }];
  f.tree.enumNodeFragments = (id, callback) => { if (id === 2) for (let fragment = 0; fragment < 8193; fragment++) callback(fragment); };
  const selected = await f.controller.readSelection(); assert.equal(selected.objects[0].objectId, 2);
  assert.equal(selected.objects[0].bounds, null); assert.equal(selected.objects[0].bottomCentre, null); f.controller.dispose();
});
test('reading a selected bounding centre leaves Ghost overlays, appearance and SDK selection unchanged', async () => {
  const f = fixture(); f.controller.showPath({ points: [[1000, -2000, 3], [1001, -2000, 3]], objectIds: [2] });
  f.viewer.getAggregateSelection = () => [{ model: f.model, selection: [3] }]; let selectionCleared = false;
  f.viewer.clearSelection = () => { selectionCleared = true; };
  const meshes = [...f.meshes], isolated = [...f.viewer.isolated], visibility = f.model.visibilityManager.getVisibility();
  const selected = await f.controller.readSelection(); assert.equal(selected.objects[0].objectId, 3);
  assert.deepEqual(f.meshes, meshes); assert.deepEqual(f.viewer.isolated, isolated); assert.deepEqual(f.model.visibilityManager.getVisibility(), visibility);
  assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.025); assert.equal(selectionCleared, false); f.controller.dispose();
});

test('explicit percentages change original background materials, protect route colours and restore all exact appearance on Clear', async () => {
  const f = fixture(); await assert.rejects(() => f.controller.setTransparency(50), { code: 'PATH_INVALID' });
  const original = { opacity: f.originalMaterial.opacity, transparent: f.originalMaterial.transparent, depthWrite: f.originalMaterial.depthWrite };
  f.controller.showPath({ points: [[0, 0, 0], [1, 0, 0]], objectIds: [2] });
  assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.025); assert.equal(f.clones.length, 0);
  for (const percent of [0, 40, 100]) {
    await f.controller.setTransparency(percent); assert.equal(f.originalMaterial.opacity, (100 - percent) / 100);
    assert.equal(f.originalMaterial.transparent, percent > 0); assert.equal(f.originalMaterial.depthWrite, percent === 0);
    assert.equal(f.originalMaterial.color, 0x32a852); assert.equal(f.fragmentMaterials.get(2).opacity, 1); assert.equal(f.fragmentMaterials.get(2).transparent, false); assert.equal(f.fragmentMaterials.get(2).color, 0x32a852);
    assert.equal(f.meshes[0].material.color, 0xffe600); assert.deepEqual(f.viewer.shown, [2]); assert.equal(f.viewer.impl.showGhosting, false);
    assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.025);
  }
  for (const percent of [-1, 101, 1.5, NaN, '40']) await assert.rejects(() => f.controller.setTransparency(percent), { code: 'PATH_INVALID' });
  assert.equal(f.model.unconsolidated, 1); f.controller.clear();
  assert.deepEqual({ opacity: f.originalMaterial.opacity, transparent: f.originalMaterial.transparent, depthWrite: f.originalMaterial.depthWrite }, original);
  assert.equal(f.fragmentMaterials.get(2), f.originalMaterial); assert.equal(f.clones[0].disposeCount, 1); assert.equal(f.registered.size, 0);
  assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.15); assert.equal(f.viewer.impl.fadeMaterial.variants[0].opacity, 0.3); f.controller.dispose();
});

test('successive tray and endpoint parent unions retain every descendant colour and restore exact appearance on Clear', async () => {
  const f = fixture(), roots = new Map([[20, [0, 1]], [30, [2, 3]], [40, [4, 5]], [50, [6]]]);
  const colours = [0xc93636, 0x2867c8, 0x91489d, 0x30a85a, 0x8d9aab];
  const materials = colours.map(color => new f.originalMaterial.constructor({ ...f.originalMaterial, color }));
  const originalByFragment = [materials[0], materials[0], materials[1], materials[1], materials[2], materials[2], materials[3], materials[4]];
  f.fragmentMaterials.clear(); originalByFragment.forEach((item, id) => f.fragmentMaterials.set(id, item));
  f.fragments.getCount = () => originalByFragment.length;
  const recursiveReads = [];
  f.tree.enumNodeFragments = (id, visit, recursive) => {
    recursiveReads.push([id, recursive]);
    if (recursive) for (const fragmentId of roots.get(id) ?? []) visit(fragmentId);
  };
  const baseline = { defaultVisible: f.model.visibilityManager.defaultVisible, states: f.model.visibilityManager.getVisibility() };
  const firstIds = [20, 30, 40], firstPoints = [[0, 0, 0], [1, 2, 3]];
  f.controller.showPath({ points: firstPoints, objectIds: firstIds });
  assert.deepEqual(firstIds, [20, 30, 40]); assert.deepEqual(firstPoints, [[0, 0, 0], [1, 2, 3]]);
  assert.deepEqual(f.viewer.isolated, [20, 30, 40]); assert.equal(f.viewer.impl.showGhosting, true);
  await f.controller.setTransparency(75);
  assert.deepEqual(recursiveReads, [[20, true], [30, true], [40, true]]);
  assert.deepEqual(f.viewer.shown, [20, 30, 40]); assert.equal(f.registered.size, 3);
  for (let id = 0; id < originalByFragment.length; id++) {
    const shown = f.fragmentMaterials.get(id), original = originalByFragment[id];
    assert.equal(shown.color, original.color);
    if (id < 6) {
      assert.notEqual(shown, original); assert.equal(shown.opacity, 1); assert.equal(shown.transparent, false); assert.equal(shown.depthWrite, true);
    } else {
      assert.equal(shown, original); assert.equal(shown.opacity, 0.25); assert.equal(shown.transparent, true);
    }
  }
  const firstClones = [...f.clones], firstOverlay = f.meshes[0];
  f.controller.showPath({ points: [[3, 2, 1], [0, 0, 0]], objectIds: [20, 30, 50] });
  assert.deepEqual(f.viewer.isolated, [20, 30, 50]); assert.equal(f.viewer.impl.showGhosting, true);
  assert.ok(firstClones.every(item => item.disposeCount === 1)); assert.equal(f.registered.size, 0);
  assert.equal(firstOverlay.geometry.disposed, true); assert.equal(firstOverlay.material.disposed, true);
  for (let id = 0; id < originalByFragment.length; id++) assert.equal(f.fragmentMaterials.get(id), originalByFragment[id]);
  assert.ok(materials.every(item => item.opacity === 0.8 && item.transparent === true && item.depthWrite === false));
  recursiveReads.length = 0;
  await f.controller.setTransparency(40);
  assert.deepEqual(recursiveReads, [[20, true], [30, true], [50, true]]); assert.deepEqual(f.viewer.shown, [20, 30, 50]);
  const secondForeground = new Set([0, 1, 2, 3, 6]);
  for (let id = 0; id < originalByFragment.length; id++) {
    const shown = f.fragmentMaterials.get(id), original = originalByFragment[id];
    assert.equal(shown.color, original.color);
    if (secondForeground.has(id)) {
      assert.notEqual(shown, original); assert.equal(shown.opacity, 1); assert.equal(shown.transparent, false); assert.equal(shown.depthWrite, true);
    } else {
      assert.equal(shown, original); assert.equal(shown.opacity, 0.6); assert.equal(shown.transparent, true);
    }
  }
  assert.equal(f.meshes.length, 1); assert.equal(f.meshes[0].material.color, 0xffe600);
  f.controller.clear();
  for (let id = 0; id < originalByFragment.length; id++) assert.equal(f.fragmentMaterials.get(id), originalByFragment[id]);
  assert.deepEqual(materials.map(item => item.color), colours);
  assert.ok(materials.every(item => item.opacity === 0.8 && item.transparent === true && item.depthWrite === false));
  assert.deepEqual({ defaultVisible: f.model.visibilityManager.defaultVisible, states: f.model.visibilityManager.getVisibility() }, baseline);
  assert.ok(f.clones.every(item => item.disposeCount === 1)); assert.equal(f.registered.size, 0); assert.equal(f.meshes.length, 0);
  assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.15); assert.equal(f.viewer.impl.fadeMaterial.variants[0].opacity, 0.3);
  assert.equal(f.viewer.impl.showGhosting, false); f.controller.dispose();
});

test('appearance preflight refuses foreign shared materials, unsupported APIs and all three budgets before touching the view', async () => {
  for (const configure of [
    f => { f.originalMaterial._sharedBy = [7, 8]; },
    f => { f.originalMaterial.originModelId = 8; },
    f => { f.model.unconsolidate = undefined; },
    f => { f.fragments.getCount = () => 1000001; },
    f => { f.fragments.getCount = () => 4097; f.fragments.getMaterial = () => ({ opacity: 1, transparent: false, depthWrite: true }); },
    f => { f.fragments.getCount = () => 8193; f.fragments.getMaterial = () => f.originalMaterial; f.tree.enumNodeFragments = (_id, visit) => { for (let id = 0; id < 8193; id++) visit(id); }; },
  ]) {
    const f = fixture(); f.controller.showPath({ points: [[0, 0, 0]], objectIds: [2] }); configure(f);
    await assert.rejects(() => f.controller.setTransparency(75), { code: 'SDK_UNSUPPORTED' });
    assert.equal(f.originalMaterial.opacity, 0.8); assert.equal(f.viewer.impl.showGhosting, true); assert.equal(f.model.unconsolidated, 0); assert.equal(f.registered.size, 0); f.controller.dispose();
  }
});

test('Clear, model replacement and newer concurrent percentages fence preflight without leaking allocated materials', async () => {
  for (const supersede of [f => f.controller.clear(), f => { f.viewer.model = {}; }]) {
    const f = fixture(); f.controller.showPath({ points: [[0, 0, 0]], objectIds: [2] });
    let entered, release; const waiting = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const first = f.controller.setTransparency(75, undefined, async () => { entered(); await gate; }); await waiting;
    supersede(f); release(); await assert.rejects(first, { name: 'AbortError' });
    assert.equal(f.originalMaterial.opacity, 0.8); assert.equal(f.registered.size, 0); assert.ok(f.clones.every(clone => clone.disposeCount === 1)); f.controller.dispose();
  }
  const f = fixture(); f.controller.showPath({ points: [[0, 0, 0]], objectIds: [2] });
  let entered, release; const waiting = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const first = f.controller.setTransparency(75, undefined, async () => { entered(); await gate; }); await waiting;
  await f.controller.setTransparency(40); release(); await assert.rejects(first, { name: 'AbortError' });
  assert.equal(f.originalMaterial.opacity, 0.6); assert.equal(f.registered.size, 1); f.controller.clear();
  assert.equal(f.originalMaterial.opacity, 0.8); assert.equal(f.registered.size, 0); assert.ok(f.clones.every(clone => clone.disposeCount === 1)); f.controller.dispose();
});

test('a failed commit rolls back background materials, fragment references, Ghost and owned clone registration', async () => {
  const f = fixture(); f.controller.showPath({ points: [[0, 0, 0]], objectIds: [2] }); f.viewer.show = () => { throw Error('Synthetic failure while committing the view.'); };
  await assert.rejects(() => f.controller.setTransparency(75), /Synthetic failure/);
  assert.equal(f.originalMaterial.opacity, 0.8); assert.equal(f.originalMaterial.transparent, true); assert.equal(f.fragmentMaterials.get(2), f.originalMaterial);
  assert.equal(f.viewer.impl.showGhosting, true); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.025); assert.equal(f.registered.size, 0); assert.ok(f.clones.every(clone => clone.disposeCount === 1)); f.controller.dispose();
});

test('Clear retains a failed second-fragment restore, restores independent state and never disposes its still-bound clone', async () => {
  const f = fixture(); f.controller.showPath({ points: [[0, 0, 0]], objectIds: [2, 3] }); await f.controller.setTransparency(75);
  const originalSet = f.fragments.setMaterial; let failRestore = true;
  f.fragments.setMaterial = (id, material) => { if (failRestore && id === 3 && material === f.originalMaterial) throw Error('Second fragment is temporarily unavailable.'); originalSet(id, material); };
  assert.throws(() => f.controller.clear(), { code: 'APPEARANCE_RESTORE_FAILED' });
  assert.equal(f.fragmentMaterials.get(2), f.originalMaterial); assert.equal(f.fragmentMaterials.get(3), f.clones[0]); assert.equal(f.clones[0].disposed, undefined); assert.equal(f.registered.size, 1);
  assert.equal(f.originalMaterial.opacity, 0.8); assert.equal(f.meshes.length, 0); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.15); assert.equal(f.viewer.impl.showGhosting, false);
  assert.throws(() => f.controller.showPath({ points: [[1, 0, 0]], objectIds: [2] }), { code: 'APPEARANCE_RESTORE_FAILED' }); assert.equal(f.meshes.length, 0);
  await assert.rejects(() => f.controller.setTransparency(40), { code: 'APPEARANCE_RESTORE_FAILED' });
  failRestore = false; f.controller.clear(); assert.equal(f.fragmentMaterials.get(3), f.originalMaterial); assert.equal(f.clones[0].disposeCount, 1); assert.equal(f.registered.size, 0); f.controller.dispose();
});

test('Clear retries failed unregister or dispose without losing cleanup state or disposing a registered material', async () => {
  for (const failure of ['unregister', 'dispose']) {
    const f = fixture(); f.controller.showPath({ points: [[0, 0, 0]], objectIds: [2] }); await f.controller.setTransparency(75);
    let failCleanup = true; const originalRemove = f.manager.removeMaterial, originalDispose = f.clones[0].dispose.bind(f.clones[0]);
    f.manager.removeMaterial = name => { if (failure === 'unregister' && failCleanup) throw Error('Temporary unregister failure.'); originalRemove(name); };
    f.clones[0].dispose = () => { if (failure === 'dispose' && failCleanup) throw Error('Temporary material release failure.'); originalDispose(); };
    assert.throws(() => f.controller.clear(), { code: 'APPEARANCE_RESTORE_FAILED' });
    assert.equal(f.fragmentMaterials.get(2), f.originalMaterial); assert.equal(f.meshes.length, 0); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.15); assert.equal(f.viewer.impl.showGhosting, false); assert.equal(f.clones[0].disposeCount, undefined);
    assert.equal(f.registered.size, failure === 'unregister' ? 1 : 0);
    assert.throws(() => f.controller.showPath({ points: [[1, 0, 0]], objectIds: [2] }), { code: 'APPEARANCE_RESTORE_FAILED' });
    failCleanup = false; f.controller.clear(); assert.equal(f.registered.size, 0); assert.equal(f.clones[0].disposeCount, 1); f.controller.dispose();
  }
});

test('failed commit rollback retains recovery state and the original cause until Clear can finish', async () => {
  const f = fixture(); f.controller.showPath({ points: [[0, 0, 0]], objectIds: [2] }); f.viewer.show = () => { throw Error('Original commit failure.'); };
  let failCleanup = true; const originalRemove = f.manager.removeMaterial;
  f.manager.removeMaterial = name => { if (failCleanup) throw Error('Rollback unregister failed.'); originalRemove(name); };
  await assert.rejects(() => f.controller.setTransparency(75), error => error.code === 'APPEARANCE_RESTORE_FAILED' && error.cause?.message === 'Original commit failure.');
  assert.equal(f.originalMaterial.opacity, 0.8); assert.equal(f.fragmentMaterials.get(2), f.originalMaterial); assert.equal(f.clones[0].disposed, undefined);
  assert.throws(() => f.controller.clear(), { code: 'APPEARANCE_RESTORE_FAILED' }); assert.equal(f.meshes.length, 0); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.15);
  failCleanup = false; f.controller.clear(); assert.equal(f.clones[0].disposeCount, 1); assert.equal(f.registered.size, 0); f.controller.dispose();
});

test('preflight cleanup failure never masks revoked authority and its detached materials remain retryable', async () => {
  const f = fixture(); f.controller.showPath({ points: [[0, 0, 0]], objectIds: [2] }); const denied = Object.assign(Error('Authority revoked.'), { code: 'ACCESS_REVOKED' });
  const originalClone = f.manager.cloneMaterial; let failCleanup = true;
  f.manager.cloneMaterial = (...args) => { const clone = originalClone(...args), dispose = clone.dispose.bind(clone); clone.dispose = () => { if (failCleanup) throw Error('Detached material cleanup failed.'); dispose(); }; return clone; };
  await assert.rejects(() => f.controller.setTransparency(75, undefined, async () => { throw denied; }), error => error === denied);
  assert.equal(f.originalMaterial.opacity, 0.8); assert.equal(f.registered.size, 0); assert.equal(f.model.unconsolidated, 0);
  failCleanup = false; f.controller.clear(); assert.equal(f.clones[0].disposeCount, 1); f.controller.dispose();
});

test('a newer pending percentage cannot commit after an older detached material develops a cleanup failure', async () => {
  const f = fixture(); f.controller.showPath({ points: [[0, 0, 0]], objectIds: [2] });
  let failCleanup = true; const originalClone = f.manager.cloneMaterial;
  f.manager.cloneMaterial = (...args) => {
    const clone = originalClone(...args), dispose = clone.dispose.bind(clone), first = f.clones.length === 1;
    clone.dispose = () => { if (first && failCleanup) throw Error('Old preflight material temporarily cannot be released.'); dispose(); }; return clone;
  };
  let enteredFirst, releaseFirst, enteredSecond, releaseSecond;
  const firstReady = new Promise(resolve => { enteredFirst = resolve; }), firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const secondReady = new Promise(resolve => { enteredSecond = resolve; }), secondGate = new Promise(resolve => { releaseSecond = resolve; });
  const first = f.controller.setTransparency(75, undefined, async () => { enteredFirst(); await firstGate; }); await firstReady;
  const second = f.controller.setTransparency(40, undefined, async () => { enteredSecond(); await secondGate; }); await secondReady;
  releaseFirst(); await assert.rejects(first, { name: 'AbortError' }); releaseSecond(); await assert.rejects(second, { code: 'APPEARANCE_RESTORE_FAILED' });
  assert.equal(f.originalMaterial.opacity, 0.8); assert.equal(f.model.unconsolidated, 0); assert.equal(f.registered.size, 0);
  failCleanup = false; f.controller.clear(); assert.ok(f.clones.every(clone => clone.disposeCount === 1)); f.controller.dispose();
});

test('terminal disposal cannot block SDK teardown when an attached foreground material cannot yet be restored', async () => {
  const f = fixture(); f.controller.showPath({ points: [[0, 0, 0]], objectIds: [2] }); await f.controller.setTransparency(75);
  f.fragments.setMaterial = () => { throw Error('The model is tearing down.'); };
  let sdkFinishReached = false;
  assert.doesNotThrow(() => { f.controller.dispose(); sdkFinishReached = true; });
  assert.equal(sdkFinishReached, true); assert.equal(f.meshes.length, 0); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.15);
  assert.equal(f.fragmentMaterials.get(2), f.clones[0]); assert.equal(f.clones[0].disposed, undefined); assert.equal(f.registered.size, 1);
  await assert.rejects(() => f.controller.setTransparency(40), { name: 'AbortError' });
});

test('selection and route-rule protocol payloads are closed, bounded and retain explicit all-category exclusion', () => {
  const rule = { id: uuid(6), objectIds: [2], allowedCategories: [] }, payload = { captureId: uuid(7), routeRules: [rule], equipmentNames: [] };
  assert.ok(validateEnvelope(envelope('READ_SELECTION', {}))); assert.ok(validateEnvelope(envelope('START_MODEL_CAPTURE', payload)));
  for (const changes of [{ routeCodes: ['BC1'] }, { routeRules: [{ ...rule, objectIds: [2, 2] }] }, { routeRules: [{ ...rule, allowedCategories: ['Instrumentation'] }] }, { routeRules: [rule, rule] }, { routeRules: [{ ...rule, objectIds: [0] }] }]) assert.equal(validateEnvelope(envelope('START_MODEL_CAPTURE', { ...payload, ...changes })), null);
  assert.equal(validateEnvelope(envelope('START_MODEL_CAPTURE', { ...payload, routeRules: [{ ...rule, objectIds: Array.from({ length: 512 }, (_, index) => index + 1) }, { ...rule, id: uuid(8) }] })), null);
  assert.ok(validateEnvelope(envelope('SET_PATH_TRANSPARENCY', { routeRequestId: uuid(6), percent: 0 })));
  assert.equal(validateEnvelope(envelope('SET_PATH_TRANSPARENCY', { routeRequestId: uuid(6), percent: 100.1 })), null);
  assert.equal(validateEnvelope({ ...envelope('READ_SELECTION', {}), loadId: null, modelVersionId: null }), null);
});

test('one-shot picking converts only the owned model surface hit and cancellation removes listeners', async () => {
  const f = fixture(), abort = new AbortController();
  const pending = f.controller.pickPoint(abort.signal); abort.abort(); await assert.rejects(pending, { name: 'AbortError' });
  const picked = f.controller.pickPoint();
  for (const type of ['pointerdown', 'click']) {
    const event = new Event(type, { cancelable: true }); Object.assign(event, { button: 0, clientX: 13, clientY: 24 }); f.canvas.dispatchEvent(event);
  }
  assert.deepEqual(await picked, { objectId: 2, point: modelCoordinates(f.model).toCanonical([4, 5, 6]), derivation: 'picked-surface-point' }); f.controller.dispose();
});

test('new protocol payloads reject malformed, nonfinite, oversized and missing load identities', () => {
  const begin = envelope('BEGIN_COMPUTED_PATH', { pathId: uuid(6), pointCount: 2, objectIds: [2] });
  assert.ok(validateEnvelope(begin, 'parent-to-frame'));
  for (const objectIds of [[2, 2], [0], [1.5], Array.from({ length: 513 }, (_, i) => i + 1)]) assert.equal(validateEnvelope({ ...begin, payload: { ...begin.payload, objectIds } }), null);
  assert.equal(validateEnvelope({ ...begin, loadId: null, modelVersionId: null }), null);
  for (const points of [[[NaN, 0, 0]], [[0, Infinity, 0]], [[0, 0]], Array(129).fill([0, 0, 0])]) assert.equal(validateEnvelope(envelope('APPEND_COMPUTED_PATH', { pathId: uuid(6), offset: 0, points })), null);
  const chunk = envelope('APPEND_COMPUTED_PATH', { pathId: uuid(6), offset: 0, points: Array.from({ length: 128 }, () => [-1.1234567890123457e-100, -1.1234567890123457e-100, -1.1234567890123457e-100]) });
  assert.ok(validateEnvelope(chunk)); assert.ok(Buffer.byteLength(JSON.stringify(chunk)) < MAX_MESSAGE_BYTES);
  assert.equal(validateEnvelope(envelope('READ_MODEL_OBJECTS', { cursor: 0, limit: 17, query: '' })), null);
});

test('complete capture envelopes keep escaped non-ASCII text below 64KiB without relaxing global budgets', () => {
  const eventJson = JSON.stringify({ type: 'object-part', captureId: uuid(6), text: 'България\\"\n'.repeat(750) });
  const value = envelope('MODEL_CAPTURE_EVENT', { captureId: uuid(6), index: 1, done: false, eventJson });
  assert.ok(validateEnvelope(value, 'frame-to-parent')); assert.ok(Buffer.byteLength(JSON.stringify(value)) < 65536);
  assert.equal(validateEnvelope(envelope('MODEL_CAPTURE_EVENT', { captureId: uuid(6), index: 1, done: false, eventJson: 'x'.repeat(24577) })), null);
  assert.equal(validateEnvelope(envelope('READ_MODEL_CAPTURE', { captureId: uuid(6), index: 3000 })), null);
});
