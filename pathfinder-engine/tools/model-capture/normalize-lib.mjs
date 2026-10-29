import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseJson } from '../../../server/vendor/routings-model-package/lib/json.mjs';

export const LIMITS = Object.freeze({ receiptBytes: 16 * 1024 * 1024, partBytes: 32 * 1024 * 1024, totalBytes: 512 * 1024 * 1024,
  objects: 4096, parts: 8192, fragments: 8192, vertices: 5000000, triangles: 5000000, depth: 512, properties: 1024 });
export const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const encode = value => Buffer.from(JSON.stringify(value) + '\n');
export const assert = (condition, message) => { if (!condition) throw new Error(message); };
export const text = (value, label, maximum = 2048, empty = false) => {
  assert(typeof value === 'string' && value.length <= maximum && (empty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value), `${label}: invalid bounded text.`);
  return value;
};
export function point(value, label = 'point') {
  assert(Array.isArray(value) && value.length === 3 && value.every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1e12), `${label}: three finite canonical coordinates required.`);
  return [...value];
}
export function matrix(value, label = 'matrix') {
  assert(Array.isArray(value) && value.length === 16 && value.every(Number.isFinite), `${label}: 16 finite values required.`);
  assert(value[3] === 0 && value[7] === 0 && value[11] === 0 && value[15] === 1, `${label}: affine matrix required.`);
  const determinant = value[0]*(value[5]*value[10]-value[9]*value[6])-value[4]*(value[1]*value[10]-value[9]*value[2])+value[8]*(value[1]*value[6]-value[5]*value[2]);
  assert(Number.isFinite(determinant) && determinant !== 0, `${label}: invertible matrix required.`);
  return [...value];
}
export function apply(m, p) { return [0,1,2].map(row => m[row]*p[0]+m[4+row]*p[1]+m[8+row]*p[2]+m[12+row]); }
export function multiply(a, b) { const output = Array(16).fill(0); for (let col=0;col<4;col++) for (let row=0;row<4;row++) for (let i=0;i<4;i++) output[col*4+row]+=a[i*4+row]*b[col*4+i]; return output; }
const residual = (a,b) => Math.max(...a.map((value,index) => Math.abs(value-b[index])));
const arithmeticTolerance = values => Math.max(1e-9, Number.EPSILON*32*Math.max(1,...values.map(Math.abs)));
export async function readJson(file, maximum = LIMITS.partBytes) {
  const stat = await fs.lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximum, 'Input must be a bounded regular JSON file.');
  const bytes = await fs.readFile(file);
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { value: parseJson(decoded, { maxDepth: 64 }), sha256: hash(bytes), bytes: bytes.length, path: path.resolve(file) };
}
export async function readCapture(receiptFile, inventoryFile) {
  const main = await readJson(receiptFile, LIMITS.receiptBytes);
  assert(main.value.schemaVersion === 'pathfinder.converted.mesh-capture.v1', 'A completed mesh capture receipt is required.');
  assert(Array.isArray(main.value.parts) && main.value.parts.length > 0 && main.value.parts.length <= LIMITS.parts, 'Capture parts outside explicit budget.');
  const parts = [], usedNames = new Set(); let bytes = main.bytes;
  for (const expected of main.value.parts) {
    assert(typeof expected.name === 'string' && /^[a-z0-9][a-z0-9_.-]{0,119}\.json$/.test(expected.name) && !usedNames.has(expected.name), 'Unsafe or duplicate capture part name.');
    usedNames.add(expected.name);
    const part = await readJson(path.join(path.dirname(main.path), expected.name));
    assert(part.sha256 === expected.sha256 && part.bytes === expected.bytes, 'Capture part hash/byte count differs.');
    bytes += part.bytes; assert(bytes <= LIMITS.totalBytes, 'Aggregate raw capture byte budget exceeded.');
    parts.push(part);
  }
  let inventory = null;
  if (inventoryFile) {
    const receipt = await readJson(inventoryFile, LIMITS.receiptBytes);
    assert(receipt.value.schemaVersion === 'pathfinder.converted.inventory.v1' && receipt.value.inventoryComplete === true, 'Completed hierarchy inventory required.');
    assert(receipt.value.package?.contentFingerprint === main.value.package?.contentFingerprint, 'Inventory model content differs from mesh capture.');
    assert(Array.isArray(receipt.value.parts) && receipt.value.parts.length <= LIMITS.parts, 'Inventory part count outside budget.');
    const objects = new Map(); let offset = 0;
    for (const expected of receipt.value.parts) {
      assert(/^[a-z0-9][a-z0-9_.-]{0,119}\.json$/.test(expected.name), 'Unsafe inventory part name.');
      const part = await readJson(path.join(path.dirname(receipt.path), expected.name));
      assert(part.sha256 === expected.sha256 && part.bytes === expected.bytes, 'Inventory part hash/byte count differs.');
      bytes += part.bytes; assert(bytes <= LIMITS.totalBytes, 'Aggregate capture/inventory byte budget exceeded.');
      assert(part.value.schemaVersion === 'pathfinder.converted.inventory-part.v1' && part.value.captureId === receipt.value.captureId && part.value.offset === offset && Array.isArray(part.value.objects), 'Inventory part order/identity differs.');
      for (const object of part.value.objects) { assert(!objects.has(object.id), 'Duplicate inventory object ID.'); objects.set(object.id, object); }
      offset += part.value.objects.length;
    }
    assert(offset === receipt.value.objectCount && offset <= 1000000, 'Inventory count differs or exceeds the declared model budget.');
    for (const object of objects.values()) if (object.parentId !== null) assert(objects.has(object.parentId), 'Complete inventory has a missing parent.');
    const validatedDepth=new Map();
    for(const object of objects.values()){
      const seen=new Set(),pending=[];let current=object;
      while(current&&!validatedDepth.has(current.id)){
        assert(!seen.has(current.id)&&seen.size<LIMITS.depth,'Cyclic or over-depth complete inventory hierarchy.');seen.add(current.id);
        pending.push(current.id);
        current=current.parentId===null?null:objects.get(current.parentId);
      }
      let depth=current?validatedDepth.get(current.id):0;
      for(let index=pending.length-1;index>=0;index--){
        assert(++depth<=LIMITS.depth,'Cyclic or over-depth complete inventory hierarchy.');
        validatedDepth.set(pending[index],depth);
      }
    }
    inventory = { receipt, objects };
  }
  return { main, parts, inventory, totalBytes: bytes };
}

export function normalizeCapture(loaded, { projectId, modelVersionId, synthetic = false } = {}) {
  text(projectId, 'projectId', 256); text(modelVersionId, 'modelVersionId', 256);
  const raw = loaded.main.value;
  assert(raw.schemaVersion === 'pathfinder.converted.mesh-capture.v1' && typeof raw.captureId === 'string' && typeof raw.caseId === 'string', 'Unsupported capture identity.');
  assert(raw.sdkVersion === '7.130.0','Unsupported capture SDK version; a new version needs an explicit mapping audit.');
  assert(loaded.parts.length <= LIMITS.objects && raw.capturedObjects === loaded.parts.length && raw.selectedObjectCount === raw.capturedObjects, 'Selected mesh capture is incomplete or count differs.');
  assert(/^[0-9a-f]{64}$/.test(raw.package?.contentFingerprint), 'Verified model content fingerprint required.');
  const metadata = raw.metadata;
  assert(metadata && residual(point(metadata.upVector,'upVector'),[0,0,1]) <= 1e-12, 'An explicit Z-up SDK mapping is required.');
  const displayToWorld = matrix(metadata.displayToWorldMetres, 'displayToWorldMetres');
  const sourceToWorld = metadata.sourceToWorldMetres === null ? null : matrix(metadata.sourceToWorldMetres, 'sourceToWorldMetres');
  const offset = point(metadata.globalOffsetMetres, 'globalOffsetMetres');
  const units = text(metadata.distanceUnit ?? 'unknown', 'distanceUnit', 64);
  const scale = metadata.metresPerDisplayUnit;
  assert(scale === null || (typeof scale === 'number' && Number.isFinite(scale) && scale > 0 && scale <= 1e9), 'Unit scale must be explicit positive or null.');
  if (metadata.captureKind === 'synthetic') synthetic = true;
  const objects = [], provenance = [], diagnostics = [], seenIds = new Set(), seenFragments = new Set();
  let vertexCount = 0, triangleCount = 0, fragmentCount = 0, maximumTransformResidual = 0;
  for (const part of loaded.parts) {
    const value = part.value;
    assert(value.schemaVersion === 'pathfinder.converted.mesh-object.v1' && value.captureId === raw.captureId && value.caseId === raw.caseId, 'Part capture/case identity differs.');
    const object = value.object;
    text(object.id,'object.id',256); assert(!seenIds.has(object.id),'Duplicate selected object ID.'); seenIds.add(object.id);
    assert(Number.isSafeInteger(object.dbId) && object.dbId >= 0 && object.id === `dbid:${object.dbId}`, 'Version-local SDK identity differs.');
    assert(Array.isArray(object.hierarchy) && object.hierarchy.length > 0 && object.hierarchy.length <= LIMITS.depth, 'Full leaf-to-root hierarchy evidence required.');
    assert(object.hierarchy[0].dbId === object.dbId && object.hierarchy[0].name === object.name, 'Leaf hierarchy identity/name differs.');
    const hierarchyIds = new Set();
    for (const node of object.hierarchy) { assert(Number.isSafeInteger(node.dbId) && !hierarchyIds.has(node.dbId), 'Cyclic/invalid hierarchy identity.'); hierarchyIds.add(node.dbId); text(node.name,'hierarchy.name',2048,true); }
    const parentId = object.hierarchy[1] ? `dbid:${object.hierarchy[1].dbId}` : null;
    assert((object.parentId ?? null) === parentId, 'Object parent disagrees with full hierarchy evidence.');
    const minimum = point(object.bounds?.minimum,'bounds.minimum'), maximum = point(object.bounds?.maximum,'bounds.maximum');
    assert(minimum.every((value,axis) => value <= maximum[axis]),'Inverted canonical bounds.');
    assert(Array.isArray(object.fragments) && object.fragments.length > 0,'Selected routing leaf needs actual triangle fragments; no fabricated AABB mesh.');
    const external = [...new Set([...(object.externalIds ?? []), ...(object.propertyExternalId ? [object.propertyExternalId] : [])])];
    external.forEach(value => text(value,'externalId',1024));
    if (external.length > 1) diagnostics.push({ code: 'external_identity_ambiguous', objectId: object.id, candidates: external });
    assert(object.nativeHidden === null || typeof object.nativeHidden === 'boolean','Native visibility must be explicit boolean or unknown.');
    // The SDK cannot prove native inherited visibility; retain it in provenance, never promote display flags.
    const properties = object.properties;
    assert(Array.isArray(properties) && properties.length <= LIMITS.properties,'Selected property count outside strict model budget.');
    const mappedProperties = properties.map(property => ({ category: text(property.category,'property.category',512,true), name: text(property.name,'property.name',512,true), value: text(property.value,'property.value',16384,true) }));
    const routeNames = [...new Set(object.routeNames ?? [])]; routeNames.forEach(value => text(value,'routeName',2048));
    if (routeNames.length !== 1) diagnostics.push({ code: 'route_owner_ambiguous', objectId: object.id, candidates: routeNames });
    const fragments = object.fragments.map(fragment => {
      text(fragment.id,'fragment.id',256); assert(!seenFragments.has(fragment.id),'Duplicate version-local fragment identity.'); seenFragments.add(fragment.id);
      assert(++fragmentCount <= LIMITS.fragments && fragment.transformAlreadyApplied === true,'Unapplied transform or fragment budget exceeded.');
      const world = matrix(fragment.fragmentToWorldMetres,'fragmentToWorldMetres');
      const display = matrix(fragment.sdkDisplayWorldMatrix,'sdkDisplayWorldMatrix');
      const original = matrix(fragment.sdkOriginalWorldMatrix,'sdkOriginalWorldMatrix');
      const composition = multiply(displayToWorld,display);
      const matrixError = residual(composition,world);
      assert(matrixError <= arithmeticTolerance([...composition,...world]),'Recorded canonical fragment matrix composition differs.');
      assert(Array.isArray(fragment.vertices) && fragment.vertices.length >= 3 && Array.isArray(fragment.triangleIndices) && fragment.triangleIndices.length >= 3 && fragment.triangleIndices.length % 3 === 0,'Invalid triangle mesh arrays.');
      vertexCount += fragment.vertices.length; triangleCount += fragment.triangleIndices.length/3;
      assert(vertexCount <= LIMITS.vertices && triangleCount <= LIMITS.triangles,'Selected canonical geometry resource budget exceeded.');
      const vertices = fragment.vertices.map(vertex => { const p=point(vertex); assert(p.every((value,axis)=>value>=minimum[axis]-1e-6&&value<=maximum[axis]+1e-6),'Canonical vertex outside declared AABB.'); return p; });
      for (const index of fragment.triangleIndices) assert(Number.isSafeInteger(index)&&index>=0&&index<vertices.length,'Triangle index outside fragment vertices.');
      const localSample=point(fragment.sourceLocalSample,'sourceLocalSample'), canonicalSample=point(fragment.canonicalSample,'canonicalSample');
      const sampleError=residual(apply(world,localSample),canonicalSample);
      assert(sampleError<=arithmeticTolerance(canonicalSample)&&residual(vertices[0],canonicalSample)<=arithmeticTolerance(canonicalSample),'Canonical sample disagrees with raw matrix or first vertex.');
      maximumTransformResidual=Math.max(maximumTransformResidual,matrixError,sampleError);
      provenance.push({ objectId:object.id,fragmentId:fragment.id,sdkOriginalWorldMatrix:original,sdkDisplayWorldMatrix:display,canonicalMatrix:world,localSample,canonicalSample,matrixError,sampleError });
      return { id:fragment.id,vertices,triangleIndices:[...fragment.triangleIndices],fragmentToWorldMetres:world,transformAlreadyApplied:true };
    });
    if (loaded.inventory) {
      const row=loaded.inventory.objects.get(object.id);
      assert(row&&row.name===object.name&&row.dbId===object.dbId&&(row.parentId??null)===parentId,'Mesh object does not match completed inventory identity.');
      assert(object.fragments.every(fragment=>row.fragmentIds?.includes(fragment.fragmentId)),'Selected fragment does not belong to the inventory object.');
      for(let index=0;index<object.hierarchy.length;index++){
        const node=object.hierarchy[index],stored=loaded.inventory.objects.get(`dbid:${node.dbId}`);
        const expectedParent=object.hierarchy[index+1]?`dbid:${object.hierarchy[index+1].dbId}`:null;
        assert(stored&&stored.name===node.name&&(stored.parentId??null)===expectedParent,'Full selected hierarchy disagrees with complete inventory.');
      }
    }
    objects.push({ id:object.id,...(parentId?{parentId}:{}),...(external.length===1?{externalId:external[0]}:{}),dbId:object.dbId,
      name:text(object.name,'object.name',2048,true),leafToRootNames:object.hierarchy.map(node=>node.name),properties:mappedProperties,
      nativeHidden:null,planningExcluded:false,geometryRole:'routing-leaf',...(routeNames.length===1?{routeName:routeNames[0]}:{}),shapeName:object.name,
      categoryAssignmentSource:'unassigned',allowedCategories:[],bounds:{minimum,maximum},fragments });
    provenance.push({ objectId:object.id,externalCandidates:external,rawNativeHidden:object.nativeHidden,displayHidden:object.displayHidden,
      ownerIds:object.ownerIds,routeNames,geometryRoleDerivation:'Bounded explicit route-owner geometry selection; provisional routing leaf, not approved category eligibility.',
      categoryAssignmentDiscarded:object.categoryAssignmentSource!=='unassigned'||(object.allowedCategories?.length??0)>0,
      fullHierarchy:object.hierarchy,sdkCanonicalBounds:object.sdkCanonicalBounds,bottomCentreMetres:object.bottomCentreMetres });
  }
  objects.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const snapshot={ schemaVersion:'pathfinder.model.snapshot.v1',model:{projectId,modelVersionId,contentSha256:raw.package.contentFingerprint},
    capture:{adapterVersion:'pf2.converted-normalizer.v1',sourceKind:synthetic?'synthetic':'converted',inventoryComplete:false,geometryComplete:false,
      unitsVerified:false,transformsVerified:false,planningVisibilityKnown:false,sourceLinkVerified:false,
      evidenceSha256:[...new Set([loaded.main.sha256,...loaded.parts.map(part=>part.sha256),...(loaded.inventory?[loaded.inventory.receipt.sha256]:[])])].slice(0,256)},
    coordinates:{vertexFrame:'canonical-world-metres',sourceUnits:units,metresPerSourceUnit:scale,sourceToWorldMetres:sourceToWorld,globalOffsetMetres:offset,displayToWorldMetres:displayToWorld},objects };
  // Bound evidence closure without dropping provenance: a digest over the full ordered part list represents it.
  const closureHash=hash(encode(loaded.parts.map(part=>({sha256:part.sha256,bytes:part.bytes}))));
  snapshot.capture.evidenceSha256=[loaded.main.sha256,closureHash,...(loaded.inventory?[loaded.inventory.receipt.sha256]:[])];
  return { snapshot,report:{schemaVersion:'pathfinder.converted.normalization.v1',status:'PASS',scope:synthetic?'synthetic-normalizer-check':'bounded-converted-capture-normalization',
    caseId:raw.caseId,captureId:raw.captureId,captureReceiptSha256:loaded.main.sha256,rawPartClosureSha256:closureHash,
    selectedObjectCount:objects.length,fragmentCount,vertexCount,triangleCount,maximumTransformResidual,
    rawSelectedGeometryComplete:raw.selectedGeometryComplete===true,rawCaptureDiagnostics:raw.diagnostics??[],
    completeInventorySeparatelyVerified:!!loaded.inventory,normalizedInventoryComplete:false,normalizedGeometryComplete:false,
    engineeringReadiness:'needs_review',rawMetadata:metadata,rawPackage:raw.package,provenance,diagnostics,
    limitations:['No coordinates are transformed a second time. Matrices and sample consistency are checked, not native/conversion equivalence.',
      'Unknown native visibility and unassigned categories remain unresolved; metadata booleans cannot authorize readiness.',
      'A complete hierarchy inventory, if supplied, is verified separately and does not make selected mesh geometry complete.'] } };
}
