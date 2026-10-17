const $ = id => document.getElementById(id);
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const log = message => { $('activity').textContent += message + '\n'; $('activity').scrollTop = $('activity').scrollHeight; };
const status = message => { $('status').textContent = message; log(message); };
const boot = await fetch('/bootstrap.json').then(response => response.json());
const routes = [
  { caseId: 'nwd-lookup-01', text: '/BC002/BC001/C001/C101/C106/C107-1/C107-2/C107-3/C107-4/C107-5/C138-1/C138-2/C138-3/C139/BC027/SECONDARY' },
  { caseId: 'nwd-lookup-02', text: '/DFB018-1/DFB011/DFB012/DFB013/B002/B107-1/B107-2/B107-3/BC025/BC022-2/SECONDARY' }
];
const limits = { objects: 1000000, selectedObjects: 4096, fragments: 8192, vertices: 5000000, triangles: 5000000, hierarchyDepth: 512 };
let viewer, model, tree, nodeIds, nameIndex, externalById, cancellation, metadata;
const controls = ['inventory', 'routes', 'capture', 'entire'];
function active() { if (cancellation?.signal.aborted) throw new DOMException('Capture cancelled.', 'AbortError'); }
async function save(name, value) {
  active();
  const response = await fetch('/capture?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'content-type': 'application/json', 'x-capture-token': boot.token }, body: JSON.stringify(value), signal: cancellation?.signal });
  const receipt = await response.json();
  if (!response.ok) throw new Error(receipt.error);
  return receipt;
}
const clean = value => {
  if (value === undefined) return null;
  if (ArrayBuffer.isView(value)) return Array.from(value);
  if (value?.elements) return Array.from(value.elements);
  if (value && typeof value === 'object' && ['x','y','z'].every(key => typeof value[key] === 'number')) return [value.x, value.y, value.z];
  return value;
};
function canonical(point) {
  const offset = metadata.globalOffsetDisplayUnits;
  const scale = metadata.metresPerDisplayUnit;
  return [(point.x + offset[0]) * scale, (point.y + offset[1]) * scale, (point.z + offset[2]) * scale];
}
function canonicalMatrix(displayMatrix) {
  return new THREE.Matrix4().fromArray(metadata.displayToWorldMetres).multiply(displayMatrix);
}
function hierarchy(id) {
  const result = [], seen = new Set();
  while (id && !seen.has(id)) {
    if (result.length >= limits.hierarchyDepth) throw new Error('Hierarchy depth cap exceeded; no complete capture claimed.');
    seen.add(id);
    result.push({ dbId: id, name: tree.getNodeName(id) || '', displayHidden: !!tree.isNodeHidden?.(id), displayOff: !!tree.isNodeOff?.(id) });
    id = tree.getNodeParentId(id);
  }
  return result;
}
async function index() {
  if (nodeIds) return;
  const ids = [tree.getRootId()];
  tree.enumNodeChildren(tree.getRootId(), id => {
    ids.push(id);
    return ids.length > limits.objects;
  }, true);
  if (ids.length > limits.objects) throw new Error('Full inventory exceeds the explicit object budget; not truncated or accepted.');
  const index = new Map();
  for (let i = 0; i < ids.length; i++) {
    active();
    const name = (tree.getNodeName(ids[i]) || '').trim().replace(/^\/+|\/+$/g, '').toUpperCase();
    if (name) { if (!index.has(name)) index.set(name, []); index.get(name).push(ids[i]); }
    if (i % 8192 === 0) { status(`Indexing model hierarchy: ${i.toLocaleString()} / ${ids.length.toLocaleString()}`); await pause(); }
  }
  nodeIds = ids; nameIndex = index;
  status(`Complete hierarchy indexed: ${ids.length.toLocaleString()} objects.`);
}
async function externalIds() {
  if (externalById) return;
  status('Reading complete external identity mapping…');
  const mapping = await new Promise((resolve, reject) => model.getExternalIdMapping(resolve, reject));
  externalById = new Map();
  for (const [externalId, dbId] of Object.entries(mapping)) {
    if (!externalById.has(dbId)) externalById.set(dbId, []);
    externalById.get(dbId).push(externalId);
  }
}
async function captureInventory() {
  await index(); await externalIds();
  const captureId = 'inventory-' + Date.now();
  const parts = [];
  let fragmentAssociations = 0;
  for (let offset = 0; offset < nodeIds.length; offset += 2048) {
    active();
    const objects = nodeIds.slice(offset, offset + 2048).map(id => {
      const fragmentIds = [];
      tree.enumNodeFragments(id, fragmentId => { fragmentIds.push(fragmentId); }, false);
      fragmentAssociations += fragmentIds.length;
      return { id: `dbid:${id}`, dbId: id, parentId: tree.getNodeParentId(id) ? `dbid:${tree.getNodeParentId(id)}` : null,
        name: tree.getNodeName(id) || '', childCount: tree.getChildCount(id), externalIds: externalById.get(id) ?? [], fragmentIds,
        nativeHidden: null, planningVisibilityEvidence: 'SDK display flags do not prove native inherited visibility',
        displayHidden: !!tree.isNodeHidden?.(id), displayOff: !!tree.isNodeOff?.(id) };
    });
    parts.push(await save(`${captureId}-${String(parts.length).padStart(4, '0')}.json`, { schemaVersion: 'pathfinder.converted.inventory-part.v1', captureId, offset, objects }));
    status(`Saving complete hierarchy inventory: ${Math.min(offset + 2048, nodeIds.length).toLocaleString()} / ${nodeIds.length.toLocaleString()}`);
    await pause();
  }
  const report = { schemaVersion: 'pathfinder.converted.inventory.v1', captureId, capturedAt: new Date().toISOString(), package: boot.package,
    sdkVersion: LMV_VIEWER_VERSION, metadata, limits, inventoryComplete: true, geometryComplete: false, propertiesComplete: false,
    objectCount: nodeIds.length, sdkFragmentCount: model.getFragmentList().getCount(), fragmentAssociations, externalIdentityObjectCount: externalById.size, parts,
    limitations: ['Complete hierarchy/fragment association inventory, not a full mesh/property capture.', 'Native planning visibility and production tray category assignments are not established.'] };
  const receipt = await save(`${captureId}-receipt.json`, report);
  status(`Complete hierarchy inventory saved: ${nodeIds.length.toLocaleString()} objects. Receipt ${receipt.sha256.slice(0, 16)}…`);
}
function parseRoute(text) {
  const codes = text.split('/').map(value => value.trim().toUpperCase()).filter(value => value && value !== 'SECONDARY');
  if (!codes.length || codes.length > 100 || codes.some(value => !/^[A-Z0-9][A-Z0-9_.-]*$/.test(value))) throw new Error('Use 1–100 exact route names separated by /.');
  return [...new Set(codes)];
}
async function properties(ids) {
  const values = new Map();
  for (let index = 0; index < ids.length; index += 128) {
    active();
    const batch = await new Promise((resolve, reject) => model.getBulkProperties(ids.slice(index, index + 128), { ignoreHidden: false, needsExternalId: true }, resolve, reject));
    for (const item of batch) values.set(item.dbId, item);
    await pause();
  }
  return values;
}
async function captureRoute(caseId, routeText) {
  await index(); await externalIds();
  const requested = parseRoute(routeText), selected = new Map(), owners = [], diagnostics = [];
  for (const code of requested) {
    const matches = nameIndex.get(code) ?? [];
    owners.push({ routeCode: '/' + code, candidates: matches.map(id => ({ dbId: id, hierarchy: hierarchy(id) })) });
    if (matches.length === 0) diagnostics.push(`Missing exact route owner /${code}.`);
    if (matches.length > 1) diagnostics.push(`Ambiguous exact route owner /${code}: ${matches.length} candidates; all bounded candidates retained, no automatic acceptance.`);
    for (const owner of matches) {
      const add = id => {
        const fragments = [];
        tree.enumNodeFragments(id, fragmentId => { fragments.push(fragmentId); }, false);
        if (fragments.length) {
          if (!selected.has(id)) selected.set(id, { id, ownerIds: [], routeNames: [], fragmentIds: fragments });
          selected.get(id).ownerIds.push(owner); selected.get(id).routeNames.push('/' + code);
        }
        if (selected.size > limits.selectedObjects) throw new Error('Selected object budget exceeded; no truncation accepted.');
      };
      add(owner); tree.enumNodeChildren(owner, id => { add(id); }, true);
    }
  }
  const propertyMap = await properties([...selected.keys()]);
  const captureId = `${caseId}-${Date.now()}`;
  const parts = [];
  let verticesTotal = 0, trianglesTotal = 0, fragmentTotal = 0, capturedObjects = 0;
  const fragments = model.getFragmentList();
  const reader = Autodesk.Viewing.Private;
  if (typeof reader.enumMeshVertices !== 'function' || typeof reader.enumMeshIndices !== 'function') throw new Error('Pinned SDK mesh enumeration API unavailable.');
  for (const record of selected.values()) {
    active();
    const objectFragments = [], bounds = new THREE.Box3();
    for (const fragmentId of record.fragmentIds) {
      if (++fragmentTotal > limits.fragments) throw new Error('Selected fragment budget exceeded.');
      const geometry = fragments.getGeometry(fragmentId);
      if (!geometry) throw new Error(`Fragment ${fragmentId} geometry is not resident; capture is incomplete.`);
      if (geometry.isLines || geometry.isPoints || geometry.is2d) {
        diagnostics.push(`Fragment ${fragmentId} is non-triangle display geometry and is not used as a tray mesh.`);
        continue;
      }
      const original = new THREE.Matrix4(), display = new THREE.Matrix4();
      fragments.getOriginalWorldMatrix(fragmentId, original); fragments.getWorldMatrix(fragmentId, display);
      const world = canonicalMatrix(display);
      const localVertices = [], vertices = [], triangleIndices = [];
      reader.enumMeshVertices(geometry, (vertex, _normal, _uv, index) => {
        if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) throw new Error('Non-finite decoded SDK vertex.');
        const local = new THREE.Vector3(vertex.x, vertex.y, vertex.z);
        const canonicalPoint = local.clone().applyMatrix4(world);
        localVertices[index] = [local.x, local.y, local.z]; vertices[index] = [canonicalPoint.x, canonicalPoint.y, canonicalPoint.z];
        bounds.expandByPoint(canonicalPoint);
        if (++verticesTotal > limits.vertices) throw new Error('Selected vertex budget exceeded.');
      });
      reader.enumMeshIndices(geometry, (a, b, c) => {
        if (![a,b,c].every(value => Number.isInteger(value) && value >= 0 && value < vertices.length && vertices[value])) throw new Error('Invalid SDK triangle index.');
        triangleIndices.push(a, b, c);
        if (++trianglesTotal > limits.triangles) throw new Error('Selected triangle budget exceeded.');
      });
      if (vertices.some(value => !value) || triangleIndices.length === 0) throw new Error('Decoded mesh has missing vertices or no triangles.');
      const sample = localVertices[0];
      const forward = new THREE.Vector3(...sample).applyMatrix4(world);
      const recovered = forward.clone().applyMatrix4(world.clone().invert());
      const inverseError = recovered.distanceTo(new THREE.Vector3(...sample));
      objectFragments.push({ id: `fragment:${fragmentId}`, fragmentId, geometryId: fragments.getGeometryId?.(fragmentId) ?? null,
        vertices, triangleIndices, fragmentToWorldMetres: clean(world), transformAlreadyApplied: true,
        sdkOriginalWorldMatrix: clean(original), sdkDisplayWorldMatrix: clean(display), sourceLocalSample: sample,
        canonicalSample: [forward.x, forward.y, forward.z], inverseError, localVertexCount: localVertices.length });
    }
    const lineage = hierarchy(record.id);
    const props = propertyMap.get(record.id);
    const canonicalBounds = bounds.isEmpty() ? null : { minimum: [bounds.min.x,bounds.min.y,bounds.min.z], maximum: [bounds.max.x,bounds.max.y,bounds.max.z] };
    const sdkBounds = new THREE.Box3();
    for (const fragmentId of record.fragmentIds) { const part = new THREE.Box3(); fragments.getWorldBounds(fragmentId, part); sdkBounds.union(part); }
    const sdkCanonicalBounds = sdkBounds.isEmpty() ? null : { minimum: canonical(sdkBounds.min), maximum: canonical(sdkBounds.max) };
    const object = { id: `dbid:${record.id}`, dbId: record.id, parentId: lineage[1] ? `dbid:${lineage[1].dbId}` : null,
      externalIds: externalById.get(record.id) ?? [], name: tree.getNodeName(record.id) || '', hierarchy: lineage,
      ownerIds: record.ownerIds, routeNames: record.routeNames, nativeHidden: null, displayHidden: lineage.some(item => item.displayHidden || item.displayOff),
      planningExcluded: false, categoryAssignmentSource: 'unassigned', allowedCategories: [],
      properties: (props?.properties ?? []).map(property => ({ category: property.displayCategory ?? '', name: property.displayName ?? property.attributeName ?? '', value: String(property.displayValue ?? '') })),
      propertyExternalId: props?.externalId ?? null, bounds: canonicalBounds, sdkCanonicalBounds,
      bottomCentreMetres: canonicalBounds ? [(bounds.min.x + bounds.max.x)/2,(bounds.min.y + bounds.max.y)/2,bounds.min.z] : null,
      fragments: objectFragments };
    parts.push(await save(`${captureId}-object-${String(capturedObjects++).padStart(4,'0')}.json`, { schemaVersion: 'pathfinder.converted.mesh-object.v1', captureId, caseId, object }));
    status(`${caseId}: captured ${capturedObjects} / ${selected.size} objects, ${verticesTotal.toLocaleString()} vertices.`);
    await pause();
  }
  const report = { schemaVersion: 'pathfinder.converted.mesh-capture.v1', caseId, captureId, capturedAt: new Date().toISOString(), routeText,
    package: boot.package, sdkVersion: LMV_VIEWER_VERSION, metadata, limits, inventoryComplete: false, geometryComplete: false,
    selectedGeometryComplete: diagnostics.length === 0, categoryAssignmentSource: 'unassigned', nativeVisibilityKnown: false,
    owners, selectedObjectCount: selected.size, capturedObjects, fragmentTotal, verticesTotal, trianglesTotal, parts, diagnostics,
    limitations: ['Only the explicitly requested bounded route-owner geometry is captured.', 'Exact name candidates retain hierarchy/external IDs for native pairing; name matching alone is not identity proof.', 'Native inherited planning visibility and production category assignments are unknown.', 'Canonical mapping uses actual SDK units/up metadata, display transform and global offset exactly once; paired native verification remains separate.'] };
  const receipt = await save(`${captureId}-receipt.json`, report);
  viewer.fitToView([...selected.keys()], model, true);
  status(`${caseId} saved: ${capturedObjects} objects, ${fragmentTotal} fragments. Receipt ${receipt.sha256.slice(0,16)}…`);
}
async function run(action) {
  controls.forEach(id => { $(id).disabled = true; }); $('cancel').disabled = false;
  cancellation = new AbortController();
  try { await action(); }
  catch (error) { status(`${error.name === 'AbortError' ? 'Cancelled' : 'Capture failed'}: ${error.message}`); }
  finally { controls.forEach(id => { $(id).disabled = false; }); $('cancel').disabled = true; cancellation = null; }
}
$('inventory').onclick = () => run(captureInventory);
$('routes').onclick = () => run(async () => { for (const route of routes) await captureRoute(route.caseId, route.text); });
$('capture').onclick = () => run(() => captureRoute('manual-route', $('route').value));
$('cancel').onclick = () => cancellation?.abort();
$('entire').onclick = () => { viewer.showAll(); viewer.fitToView(); };

try {
  const viewing = Autodesk.Viewing;
  if (LMV_VIEWER_VERSION !== '7.130.0') throw new Error('Unexpected SDK version.');
  viewing.FeatureFlags.set(viewing.PublicFeatureFlags.WebGPU, false);
  await new Promise(resolve => viewing.Initializer({ env: 'Local', offline: 'true', useADP: false, disableAnalytics: true, shouldInitializeAuth: false, language: 'en', lmvResourceRoot: '/sdk/' }, resolve));
  viewer = new viewing.GuiViewer3D($('viewer'));
  if (viewer.start() !== 0) throw new Error('WebGL Viewer failed to start.');
  viewer.setTheme('light-theme');
  await new Promise((resolve, reject) => {
    const loaded = () => { viewer.removeEventListener(viewing.GEOMETRY_LOADED_EVENT, loaded); resolve(); };
    viewer.addEventListener(viewing.GEOMETRY_LOADED_EVENT, loaded);
    viewer.addEventListener(viewing.PROGRESS_UPDATE_EVENT, event => { if (event.percent) $('status').textContent = `Loading copied model: ${Math.round(event.percent)}%`; });
    viewer.loadModel(boot.package.entrypoint, {}, value => { model = value; if (model.isLoadDone?.()) loaded(); }, error => reject(new Error('Local model load failed: ' + error)));
  });
  tree = await new Promise((resolve, reject) => model.getObjectTree(resolve, reject));
  const data = model.getData();
  const scale = model.getUnitScale(), up = model.getUpVector();
  const offset = clean(model.getGlobalOffset?.() ?? data.globalOffset ?? { x: 0, y: 0, z: 0 });
  if (!(scale > 0) || !Number.isFinite(scale) || !up || Math.abs(up[0]) > 1e-12 || Math.abs(up[1]) > 1e-12 || Math.abs(up[2]-1) > 1e-12) throw new Error('Actual units/up convention needs an explicit adapter; capture refused.');
  const displayToWorld = new THREE.Matrix4().makeScale(scale, scale, scale);
  displayToWorld.setPosition(offset[0]*scale, offset[1]*scale, offset[2]*scale);
  metadata = { distanceUnit: model.getUnitString(), metresPerDisplayUnit: scale, upVector: up, globalOffsetDisplayUnits: offset,
    globalOffsetMetres: offset.map(value => value*scale), displayToWorldMetres: clean(displayToWorld),
    modelTransform: clean(model.getModelTransform?.()), placementTransform: clean(model.getPlacementTransform?.()),
    sourceMetadata: data.metadata, sdkBounds: clean(data.bbox?.min) ? { minimum: clean(data.bbox.min), maximum: clean(data.bbox.max) } : null,
    displayRenderer: viewer.impl.isWebGPU() ? 'WebGPU' : 'WebGL', planningVisibilityKnown: false, sourceLinkVerified: false,
    sourceToWorldMetres: clean(new THREE.Matrix4().makeScale(scale,scale,scale)),
    matrixComposition: 'canonicalVertex = displayToWorldMetres * sdk.getWorldMatrix(fragmentId) * decodedLocalVertex; world/root placement is already included by SDK; no second root transform applied.' };
  $('metadata').textContent = JSON.stringify({ metadata, limits }, null, 2);
  viewer.setLightPreset(7); viewer.setQualityLevel(false, true); viewer.fitToView();
  new ResizeObserver(() => viewer.resize()).observe($('viewer'));
  controls.forEach(id => { $(id).disabled = false; });
  status(`Copied model ready in WebGL. ${model.getFragmentList().getCount().toLocaleString()} fragments. Computational acceptance remains pending.`);
} catch (error) { status('Initialization failed: ' + error.message); }
