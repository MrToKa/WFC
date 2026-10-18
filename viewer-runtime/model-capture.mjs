// Protected-runtime capture only. Importing this module does not read SDK globals.
// The parent application uses only the pure assembler and the bounded bridge.
export const MODEL_CAPTURE_LIMITS = Object.freeze({ eventBytes: 24 * 1024, totalBytes: 64 * 1024 ** 2, events: 3000, indexedObjects: 1000000, objects: 4096, fragments: 100000, vertices: 5000000, triangles: 5000000, depth: 512, properties: 1024, milliseconds: 300000 });
const encoder = new TextEncoder();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const PROPERTY_NAME = /^(tag|name|equipment[ _-]?tag|equipment[ _-]?name|location)$/i;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const refuse = message => { throw new Error(message); };
const normal = value => String(value).normalize('NFC').trim().toUpperCase();
const routeKey = value => normal(value).replace(/^\/+|\/+$/g, '');
const point = (value, maximum = 1e12) => { const result = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : [value?.x, value?.y, value?.z]; if (result.length !== 3 || result.some(number => !Number.isFinite(number) || Math.abs(number) > maximum)) refuse(maximum === 1e9 ? 'Invalid finite model coordinate or coordinate exceeds the1e9 bound.' : 'Invalid finite model coordinate.'); return result; };
const canonicalPoint = value => point(value, 1e9);
const text = (value, maximum = 2048) => { if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) refuse('Model text exceeds the exact snapshot contract.'); return value; };
const serialize = value => JSON.stringify(value, (_key, item) => { if (typeof item === 'number' && !Number.isFinite(item)) refuse('Non-finite capture value.'); return item; });
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...expected].sort().join('|');
const size = value => encoder.encode(serialize(value)).length;
const bounds = () => ({ minimum: [Infinity, Infinity, Infinity], maximum: [-Infinity, -Infinity, -Infinity] });
const expand = (box, p) => { for (let axis = 0; axis < 3; axis++) { box.minimum[axis] = Math.min(box.minimum[axis], p[axis]); box.maximum[axis] = Math.max(box.maximum[axis], p[axis]); } };
const validBounds = value => value?.minimum?.length === 3 && value?.maximum?.length === 3 && value.minimum.every((number, axis) => Number.isFinite(number) && Number.isFinite(value.maximum[axis]) && number <= value.maximum[axis]);
const unique = values => [...new Set(values)];
function affine(value) { if (!Array.isArray(value) || value.length !== 16 || value.some(number => !Number.isFinite(number)) || value[3] !== 0 || value[7] !== 0 || value[11] !== 0 || value[15] !== 1) refuse('Invalid affine capture matrix.'); }
function exactBounds(value) { if (!keys(value, ['minimum', 'maximum']) || !Array.isArray(value.minimum) || !Array.isArray(value.maximum) || !validBounds(value)) refuse('Invalid capture bounds.'); canonicalPoint(value.minimum); canonicalPoint(value.maximum); }
function validateHeader(header) {
  if (!keys(header, ['schemaVersion', 'model', 'capture', 'coordinates']) || header.schemaVersion !== 'pathfinder.model.snapshot.v1' || !keys(header.model, ['projectId', 'modelVersionId', 'contentSha256']) || !UUID.test(header.model.projectId ?? '') || !UUID.test(header.model.modelVersionId ?? '') || !HASH.test(header.model.contentSha256 ?? '')) refuse('Invalid snapshot header.');
  const captureKeys = ['adapterVersion', 'sourceKind', 'inventoryComplete', 'geometryComplete', 'unitsVerified', 'transformsVerified', 'planningVisibilityKnown', 'sourceLinkVerified', 'evidenceSha256'];
  if (!keys(header.capture, captureKeys) || header.capture.sourceKind !== 'converted' || header.capture.adapterVersion !== 'wfc.protected-selected-capture.v1' || ['inventoryComplete', 'geometryComplete', 'unitsVerified', 'transformsVerified', 'planningVisibilityKnown', 'sourceLinkVerified'].some(key => header.capture[key] !== false) || !Array.isArray(header.capture.evidenceSha256) || !header.capture.evidenceSha256.length || header.capture.evidenceSha256.length > 256 || header.capture.evidenceSha256.some(value => !HASH.test(value))) refuse('Snapshot metadata claims unsupported proof.');
  const coordinates = header.coordinates;
  if (!keys(coordinates, ['vertexFrame', 'sourceUnits', 'metresPerSourceUnit', 'sourceToWorldMetres', 'globalOffsetMetres', 'displayToWorldMetres']) || coordinates.vertexFrame !== 'canonical-world-metres' || typeof coordinates.sourceUnits !== 'string' || !coordinates.sourceUnits.length || coordinates.sourceUnits.length > 64 || !(coordinates.metresPerSourceUnit > 0) || coordinates.metresPerSourceUnit > 1e9 || !Number.isFinite(coordinates.metresPerSourceUnit)) refuse('Invalid capture coordinates.');
  text(coordinates.sourceUnits, 64); canonicalPoint(coordinates.globalOffsetMetres); affine(coordinates.sourceToWorldMetres); affine(coordinates.displayToWorldMetres);
}
function validateObject(object) {
  const required = ['id', 'parentId', 'dbId', 'name', 'geometryRole', 'leafToRootNames', 'properties', 'nativeHidden', 'planningExcluded', 'categoryAssignmentSource', 'allowedCategories', 'bounds', 'fragments'];
  const allowed = new Set([...required, 'externalId', 'routeName', 'shapeName', 'routeBoundaryId']);
  if (!object || typeof object !== 'object' || Array.isArray(object) || required.some(key => !Object.hasOwn(object, key)) || Object.keys(object).some(key => !allowed.has(key)) || !Number.isSafeInteger(object.dbId) || object.dbId < 0 || object.dbId > 2147483647 || object.id !== 'dbid:' + object.dbId || object.parentId !== null && !/^dbid:[0-9]+$/.test(object.parentId ?? '') || !['hierarchy', 'object', 'routing-leaf'].includes(object.geometryRole) || object.nativeHidden !== null || object.planningExcluded !== false) refuse('Invalid physical/hierarchy captured object.');
  text(object.name); if (object.externalId !== undefined && (!text(object.externalId, 1024).length)) refuse('Invalid external identity.');
  if (!Array.isArray(object.leafToRootNames) || !object.leafToRootNames.length || object.leafToRootNames.length > MODEL_CAPTURE_LIMITS.depth || object.leafToRootNames[0] !== object.name) refuse('Invalid leaf-to-root capture names.'); object.leafToRootNames.forEach(value => text(value));
  if (!Array.isArray(object.properties) || object.properties.length > MODEL_CAPTURE_LIMITS.properties) refuse('Invalid selected property count.');
  for (const property of object.properties) { if (!keys(property, ['category', 'name', 'value'])) refuse('Invalid captured property.'); text(property.category, 512); text(property.name, 512); text(property.value); }
  if (!Array.isArray(object.allowedCategories) || object.allowedCategories.length > 3 || unique(object.allowedCategories).length !== object.allowedCategories.length || object.allowedCategories.some(value => !['MV', 'LV', 'Control'].includes(value))) refuse('Invalid explicit category assignment.');
  const boundedRoute = /^dbid:[1-9][0-9]*$/.test(object.routeBoundaryId ?? '') && object.routeName === undefined && object.shapeName === undefined;
  if (object.geometryRole === 'routing-leaf' ? object.categoryAssignmentSource !== 'explicit-planning' || !object.allowedCategories.length || !(boundedRoute || object.routeBoundaryId === undefined && typeof object.routeName === 'string' && object.routeName.startsWith('/') && typeof object.shapeName === 'string') : object.categoryAssignmentSource !== 'unassigned' || object.allowedCategories.length || object.routeName !== undefined || object.shapeName !== undefined || object.routeBoundaryId !== undefined) refuse('Unsupported captured category/role assignment.');
  if (object.routeName !== undefined) text(object.routeName); if (object.shapeName !== undefined) text(object.shapeName);
  exactBounds(object.bounds);
  if (!Array.isArray(object.fragments) || object.fragments.length > MODEL_CAPTURE_LIMITS.fragments || object.geometryRole !== 'routing-leaf' && object.fragments.length || object.geometryRole === 'routing-leaf' && !object.fragments.length) refuse('Invalid physical geometry role.');
  for (const fragment of object.fragments) {
    if (!keys(fragment, ['id', 'vertices', 'triangleIndices', 'fragmentToWorldMetres', 'transformAlreadyApplied']) || !/^fragment:[0-9]+$/.test(fragment.id ?? '') || fragment.transformAlreadyApplied !== true || !Array.isArray(fragment.vertices) || fragment.vertices.length < 3 || fragment.vertices.length > MODEL_CAPTURE_LIMITS.vertices || !Array.isArray(fragment.triangleIndices) || !fragment.triangleIndices.length || fragment.triangleIndices.length % 3 || fragment.triangleIndices.length > 3 * MODEL_CAPTURE_LIMITS.triangles) refuse('Invalid captured triangle mesh.');
    affine(fragment.fragmentToWorldMetres);
    for (const vertex of fragment.vertices) { if (!Array.isArray(vertex)) refuse('Invalid canonical vertex.'); canonicalPoint(vertex); if (vertex.some((number, axis) => number < object.bounds.minimum[axis] - 1e-6 || number > object.bounds.maximum[axis] + 1e-6)) refuse('Canonical vertex is outside object bounds.'); }
    for (const index of fragment.triangleIndices) if (!Number.isSafeInteger(index) || index < 0 || index >= fragment.vertices.length) refuse('Invalid captured triangle index.');
  }
}

function requestContract(request) {
  if (!UUID.test(request?.captureId ?? '') || !UUID.test(request.projectId ?? '') || !UUID.test(request.modelVersionId ?? '') || !HASH.test(request.contentFingerprint ?? '')) refuse('Trusted capture/model identity is required.');
  if (request.routeRules !== undefined) {
    if (request.routeCodes !== undefined || request.allowedCategories !== undefined || !Array.isArray(request.routeRules) || !request.routeRules.length || request.routeRules.length > 100 || unique(request.routeRules.map(rule => rule?.id)).length !== request.routeRules.length || request.routeRules.some(rule => !keys(rule, ['id', 'objectIds', 'allowedCategories']) || !UUID.test(rule.id ?? '') || !Array.isArray(rule.objectIds) || !rule.objectIds.length || rule.objectIds.some(id => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) || unique(rule.objectIds).length !== rule.objectIds.length || !Array.isArray(rule.allowedCategories) || rule.allowedCategories.length > 3 || unique(rule.allowedCategories).length !== rule.allowedCategories.length || rule.allowedCategories.some(value => !['MV', 'LV', 'Control'].includes(value))) || request.routeRules.reduce((count, rule) => count + rule.objectIds.length, 0) > 512) refuse('Choose 1–100 valid ordered route rules within the selected root budget.');
  } else {
    if (!Array.isArray(request.routeCodes) || request.routeCodes.length < 1 || request.routeCodes.length > 100 || request.routeCodes.some(value => typeof value !== 'string' || value.length > 256 || !/^[A-Z0-9][A-Z0-9_.-]*$/i.test(value.replace(/^\/+|\/+$/g, '').trim()) || routeKey(value) === 'SECONDARY')) refuse('Choose 1–100 exact routing network codes; SECONDARY is an allowance.');
    if (!Array.isArray(request.allowedCategories) || !request.allowedCategories.length || request.allowedCategories.length > 3 || request.allowedCategories.some(value => !['MV', 'LV', 'Control'].includes(value)) || unique(request.allowedCategories).length !== request.allowedCategories.length) refuse('Explicit allowed routing categories are required.');
  }
  if (!Array.isArray(request.equipmentNames) || request.equipmentNames.length > 256 || request.equipmentNames.some(value => typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(value))) refuse('Equipment names exceed the explicit capture budget.');
  return { ...request, ...(request.routeRules ? { routeRules: request.routeRules.map(rule => ({ id: rule.id, objectIds: [...rule.objectIds], allowedCategories: [...rule.allowedCategories] })) } : { routeCodes: unique(request.routeCodes.map(routeKey)) }), equipmentNames: unique(request.equipmentNames.map(value => value.normalize('NFC').trim())) };
}

function* textParts(type, captureId, id, body) {
  let cursor = 0, partIndex = 0;
  do {
    let end = Math.min(cursor + 16384, body.length), event;
    for (;;) {
      // Keep a Unicode surrogate pair together; JSON is reconstructed exactly.
      if (end < body.length && /[\uD800-\uDBFF]/u.test(body[end - 1])) end--;
      event = { type, captureId, ...(id ? { objectId: id } : {}), partIndex, final: end === body.length, text: body.slice(cursor, end) };
      if (size(event) <= MODEL_CAPTURE_LIMITS.eventBytes) break;
      end = cursor + Math.floor((end - cursor) / 2); if (end <= cursor) refuse('Capture event cannot fit its byte budget.');
    }
    yield event; cursor = end; partIndex++;
  } while (cursor < body.length);
}

export async function* captureSelectedModel(viewer, input, { signal, onProgress } = {}) {
  const request = requestContract(input), started = Date.now(), model = viewer?.model;
  if (!model) refuse('The selected model is not loaded.');
  const active = () => { if (signal?.aborted) throw new DOMException('Model capture cancelled.', 'AbortError'); if (Date.now() - started > MODEL_CAPTURE_LIMITS.milliseconds) refuse('Selected model capture deadline exceeded. Reduce the scope.'); if (viewer.model !== model) refuse('The model changed during capture.'); };
  const sdk = globalThis.Autodesk?.Viewing?.Private, THREE = globalThis.THREE;
  if (!sdk || typeof sdk.enumMeshVertices !== 'function' || typeof sdk.enumMeshTriangles !== 'function' || !THREE || typeof sdk.LmvMatrix4 !== 'function') refuse('Pinned SDK computational capture APIs are unavailable.');
  if (String(globalThis.LMV_VIEWER_VERSION ?? '') !== '7.130.0') refuse('This computational capture adapter requires pinned SDK7.130.0.');
  const matrix = () => { const result = new sdk.LmvMatrix4(true); if (!(result.elements instanceof Float64Array)) refuse('Binary64 fragment matrices are required.'); return result; };
  async function sdkCall(invoke) {
    active();
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
      const abort = () => finish(new DOMException('Model capture cancelled.', 'AbortError'));
      const timer = setTimeout(() => finish(Error('The SDK capture request timed out.')), 45000);
      signal?.addEventListener('abort', abort, { once: true });
      try { invoke(value => { try { active(); finish(null, value); } catch (error) { finish(error); } }, () => finish(Error('The SDK could not read the selected model.'))); } catch (error) { finish(error); }
    });
  }
  const tree = await sdkCall((success, failure) => model.getObjectTree(success, failure));
  const fragmentList = model.getFragmentList(), scale = model.getUnitScale(), up = point(model.getUpVector());
  if (!(scale > 0) || !Number.isFinite(scale) || scale > 1e9 || Math.abs(up[0]) > 1e-12 || Math.abs(up[1]) > 1e-12 || Math.abs(up[2] - 1) > 1e-12) refuse('This model needs an explicit supported unit/up adapter.');
  const offset = point(model.getGlobalOffset?.() ?? model.getData().globalOffset ?? { x: 0, y: 0, z: 0 });
  const displayToWorld = matrix().makeScale(scale, scale, scale);
  for (let axis = 0; axis < 3; axis++) displayToWorld.elements[12 + axis] = offset[axis] * scale;
  const sourceToWorld = matrix().makeScale(scale, scale, scale), sourceUnits = text(model.getUnitString(), 64); if (!sourceUnits.length) refuse('SDK source unit label is missing.');
  const evidence = { sdkVersion: String(globalThis.LMV_VIEWER_VERSION ?? 'unknown'), matrixPrecision: 'binary64', upVector: up, metresPerDisplayUnit: scale, globalOffsetDisplayUnits: offset, globalOffsetMetres: offset.map(value => value * scale), displayToWorldMetres: Array.from(displayToWorld.elements), modelTransform: model.getModelTransform?.() ? Array.from(model.getModelTransform().elements) : null, placementTransform: model.getPlacementTransform?.() ? Array.from(model.getPlacementTransform().elements) : null, composition: 'canonicalVertex = displayToWorldMetres * sdkFragmentWorldMatrix * decodedLocalVertex; placement/root transform is not applied twice.', sourceLinkVerified: false, nativeVisibilityKnown: false, fragments: [] };
  const captureScope = { ...(request.routeRules ? { routeRules: request.routeRules } : { routeCodes: request.routeCodes, allowedCategories: request.allowedCategories }), equipmentNames: request.equipmentNames };
  const metadataHash = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(serialize({ ...evidence, scope: captureScope }))))).map(value => value.toString(16).padStart(2, '0')).join('');
  const header = { schemaVersion: 'pathfinder.model.snapshot.v1', model: { projectId: request.projectId, modelVersionId: request.modelVersionId, contentSha256: request.contentFingerprint }, capture: { adapterVersion: 'wfc.protected-selected-capture.v1', sourceKind: 'converted', inventoryComplete: false, geometryComplete: false, unitsVerified: false, transformsVerified: false, planningVisibilityKnown: false, sourceLinkVerified: false, evidenceSha256: [metadataHash] }, coordinates: { vertexFrame: 'canonical-world-metres', sourceUnits, metresPerSourceUnit: scale, sourceToWorldMetres: Array.from(sourceToWorld.elements), globalOffsetMetres: offset.map(value => value * scale), displayToWorldMetres: Array.from(displayToWorld.elements) } };
  validateHeader(header);
  let eventCount = 0, transportBytes = 0, snapshotBytes = size(header);
  function emit(event) { active(); const bytes = size(event); if (bytes > MODEL_CAPTURE_LIMITS.eventBytes || ++eventCount > MODEL_CAPTURE_LIMITS.events || (transportBytes += bytes) > MODEL_CAPTURE_LIMITS.totalBytes) refuse('Selected capture exceeds the bounded bridge budget. Reduce network/equipment scope.'); return event; }
  yield emit({ type: 'metadata', captureId: request.captureId, schemaVersion: 'pathfinder.model.capture.events.v1', snapshotHeader: header, scope: 'explicit-selected-network', inventoryComplete: false, geometryComplete: false });
  const ids = [tree.getRootId()], seen = new Set(ids), routes = new Map((request.routeCodes ?? []).map(code => [code, []])), equipment = new Map(request.equipmentNames.map(name => [normal(name), { name, ids: new Set() }]));
  tree.enumNodeChildren(tree.getRootId(), id => { active(); if (!Number.isSafeInteger(id) || id < 0) refuse('Invalid SDK object identity.'); if (!seen.has(id)) { seen.add(id); ids.push(id); } if (ids.length > MODEL_CAPTURE_LIMITS.indexedObjects) refuse('Model inventory exceeds the capture indexing budget.'); return false; }, true);
  for (let index = 0; index < ids.length; index++) {
    active(); const id = ids[index], name = tree.getNodeName(id) ?? '', key = routeKey(name);
    if (routes.has(key)) routes.get(key).push(id);
    if (equipment.has(normal(name))) equipment.get(normal(name)).ids.add(id);
    if (index % 8192 === 0) { onProgress?.({ phase: 'index', loaded: index, total: ids.length }); await pause(); }
  }
  const selected = new Map(), diagnostics = [], propertyMap = new Map();
  const ownFragments = id => { const result = []; tree.enumNodeFragments(id, value => { if (!Number.isSafeInteger(value) || value < 0) refuse('Invalid SDK fragment identity.'); if (!result.includes(value)) result.push(value); if (result.length > MODEL_CAPTURE_LIMITS.fragments) refuse('Object fragment budget exceeded.'); }, false); return result; };
  function select(id, role, routeName) {
    if (!selected.has(id)) selected.set(id, { id, role, routeNames: new Set(), fragmentIds: ownFragments(id) });
    const record = selected.get(id); if (role === 'routing-leaf') record.role = role; else if (record.role === 'hierarchy' && role === 'object') record.role = role;
    if (routeName) record.routeNames.add(routeName);
    if (selected.size > MODEL_CAPTURE_LIMITS.objects) refuse('Selected object/ancestor budget exceeded. Reduce scope.');
    return record;
  }
  for (const [code, owners] of routes) {
    if (owners.length !== 1) diagnostics.push({ code: owners.length ? 'ambiguous_route_owner' : 'missing_route_owner', routeCode: '/' + code, candidateDbIds: [...owners] });
    for (const owner of owners) {
      const collect = id => {
        active(); const fragmentIds = ownFragments(id); if (!fragmentIds.length) return;
        if (tree.getChildCount(id) > 0) refuse('Routing mesh belongs to a non-leaf hierarchy object; resolve the selected scope explicitly.');
        select(id, 'routing-leaf', '/' + code);
      };
      collect(owner); tree.enumNodeChildren(owner, id => { collect(id); return false; }, true);
    }
  }
  if (request.routeRules) for (const rule of request.routeRules) for (const rootId of rule.objectIds) {
    if (!seen.has(rootId)) refuse('A selected route root is not in the current model inventory.');
    let deepestMeshes = 0;
    const collect = id => {
      active();
      if (tree.getChildCount(id) !== 0) return;
      if (!ownFragments(id).length) return;
      deepestMeshes++;
      if (!rule.allowedCategories.length) { selected.delete(id); diagnostics.push({ code: 'route_rule_excluded', ruleId: rule.id, objectId: 'dbid:' + id }); return; }
      const record = select(id, 'routing-leaf');
      record.routeBoundaryId = rootId; record.allowedCategories = [...rule.allowedCategories]; record.ruleId = rule.id;
    };
    collect(rootId); tree.enumNodeChildren(rootId, id => { collect(id); return false; }, true);
    if (!deepestMeshes) refuse('A selected route root has no deepest physical geometry descendants.');
  }
  // A bounded full property scan is required for exact NFC property matching.
  // SDK fuzzy/substring search cannot establish absence or ambiguity reliably.
  for (let index = 0; index < ids.length; index += 512) {
    active(); const batchIds = ids.slice(index, index + 512);
    if (equipment.size || batchIds.some(id => selected.has(id))) {
      const rows = await sdkCall((success, failure) => model.getBulkProperties(batchIds, { ignoreHidden: false, needsExternalId: true }, success, failure));
      if (!Array.isArray(rows) || rows.length > batchIds.length) refuse('Invalid SDK property batch.');
      const returned = new Set();
      for (const row of rows) {
        if (!batchIds.includes(row.dbId) || returned.has(row.dbId)) refuse('SDK property batch identity mismatch.'); returned.add(row.dbId);
        const names = [tree.getNodeName(row.dbId) ?? '', ...(row.properties ?? []).filter(value => PROPERTY_NAME.test(value.displayName ?? value.attributeName ?? '')).map(value => String(value.displayValue ?? ''))];
        const matches = names.map(normal).filter(name => equipment.has(name));
        if (matches.length) { select(row.dbId, 'object'); for (const name of matches) equipment.get(name).ids.add(row.dbId); }
        if (selected.has(row.dbId)) propertyMap.set(row.dbId, row);
      }
      if (batchIds.some(id => selected.has(id) && !returned.has(id))) refuse('Selected object properties are incomplete.');
    }
    onProgress?.({ phase: 'properties', loaded: Math.min(index + 512, ids.length), total: ids.length }); await pause();
  }
  for (const value of equipment.values()) for (const id of value.ids) select(id, 'object');
  function lineage(id) {
    const chain = [], visited = new Set(); let current = id;
    while (current !== null && current !== undefined) {
      if (!Number.isSafeInteger(current) || current < 0 || visited.has(current) || chain.length >= MODEL_CAPTURE_LIMITS.depth || !seen.has(current)) refuse('Cyclic, missing or over-depth SDK hierarchy.');
      visited.add(current); chain.push(current); const parent = tree.getNodeParentId(current); if (parent === current) refuse('Cyclic SDK parent.'); if (!parent && current === tree.getRootId()) break; current = parent;
    }
    return chain;
  }
  for (const record of [...selected.values()]) for (const parent of lineage(record.id).slice(1)) select(parent, 'hierarchy');
  if (![...selected.values()].some(record => record.role === 'routing-leaf')) refuse('No physical routing leaves match the explicitly selected network.');
  const missingProperties = [...selected.keys()].filter(id => !propertyMap.has(id));
  for (let start = 0; start < missingProperties.length; start += 128) {
    const batch = missingProperties.slice(start, start + 128), rows = await sdkCall((success, failure) => model.getBulkProperties(batch, { ignoreHidden: false, needsExternalId: true }, success, failure));
    if (!Array.isArray(rows) || rows.length !== batch.length) refuse('Selected hierarchy/object properties are incomplete.');
    for (const row of rows) { if (!batch.includes(row.dbId) || propertyMap.has(row.dbId)) refuse('Selected property identity differs.'); propertyMap.set(row.dbId, row); }
  }
  const externalMap = await sdkCall((success, failure) => model.getExternalIdMapping(success, failure)), externalIds = new Map(); let externalCount = 0;
  for (const [externalId, dbId] of Object.entries(externalMap ?? {})) { active(); if (++externalCount > MODEL_CAPTURE_LIMITS.indexedObjects) refuse('External identity map exceeds its budget.'); if (selected.has(dbId)) { if (!externalIds.has(dbId)) externalIds.set(dbId, []); externalIds.get(dbId).push(text(externalId, 1024)); } }
  let fragmentCount = 0, vertexCount = 0, triangleCount = 0, objectCount = 0; const capturedFragments = new Set();
  const toCanonical = value => canonicalPoint(point(value).map((number, axis) => (number + offset[axis]) * scale));
  function sdkBounds(id) {
    const box = bounds(), allFragments = new Set(ownFragments(id));
    tree.enumNodeChildren(id, child => { for (const fragment of ownFragments(child)) allFragments.add(fragment); if (allFragments.size > MODEL_CAPTURE_LIMITS.fragments) refuse('Equipment bound fragments exceed the budget.'); return false; }, true);
    for (const fragmentId of allFragments) { active(); const part = new THREE.Box3(); fragmentList.getWorldBounds(fragmentId, part); if (!part.isEmpty()) { expand(box, toCanonical(part.min)); expand(box, toCanonical(part.max)); } }
    if (!validBounds(box) && typeof tree.getNodeBox === 'function') {
      for (const transform of [model.getModelTransform?.(), model.getPlacementTransform?.()]) if (transform && Array.from(transform.elements).some((value, index) => value !== (index % 5 === 0 ? 1 : 0))) refuse('Geometry-free equipment bounds need an explicit placement adapter for this model.');
      const raw = new Float64Array(6).fill(NaN); tree.getNodeBox(id, raw);
      if (Array.from(raw).every(Number.isFinite) && [0, 1, 2].every(axis => raw[axis] <= raw[axis + 3])) { expand(box, toCanonical(Array.from(raw.slice(0, 3)))); expand(box, toCanonical(Array.from(raw.slice(3, 6)))); diagnostics.push({ code: 'sdk_node_bounds_without_triangle_geometry', objectId: 'dbid:' + id }); }
    }
    if (!validBounds(box)) refuse('A selected endpoint/hierarchy has no finite SDK bounds; no anchor is invented.');
    return box;
  }
  const selectedAncestorBounds = new Map();
  // Physical/endpoint objects go first. Hierarchy bounds are a union of the
  // captured descendants only: they are context stubs, never a full-plant mesh.
  for (const record of [...selected.values()].sort((a, b) => (a.role === 'hierarchy') - (b.role === 'hierarchy') || a.id - b.id)) {
    active(); const chain = lineage(record.id), objectBounds = bounds(), fragments = [];
    if (record.role === 'routing-leaf') for (const fragmentId of record.fragmentIds) {
      if (capturedFragments.has(fragmentId)) refuse('A physical fragment belongs to multiple selected leaves.'); capturedFragments.add(fragmentId);
      const geometry = fragmentList.getGeometry(fragmentId); if (!geometry) refuse('Selected fragment geometry is not resident.');
      if (geometry.isLines || geometry.isPoints || geometry.is2d) { diagnostics.push({ code: 'non_triangle_fragment_excluded', objectId: 'dbid:' + record.id, fragmentId }); continue; }
      if (++fragmentCount > MODEL_CAPTURE_LIMITS.fragments) refuse('Selected fragment budget exceeded.');
      const world = matrix(), original = matrix(); fragmentList.getWorldMatrix(fragmentId, world); fragmentList.getOriginalWorldMatrix(fragmentId, original);
      const canonicalMatrix = matrix().copy(displayToWorld).multiply(world), vertices = [], triangleIndices = [];
      if (Array.from(canonicalMatrix.elements).some(value => !Number.isFinite(value)) || Math.abs(canonicalMatrix.determinant()) < 1e-30) refuse('Invalid or singular canonical fragment transform.');
      sdk.enumMeshVertices(geometry, (vertex, _normal, _uv, index) => {
        active(); if (!Number.isSafeInteger(index) || index < 0 || index > MODEL_CAPTURE_LIMITS.vertices || vertices[index]) refuse('Invalid or duplicate SDK vertex index.');
        const local = point(vertex), transformed = new THREE.Vector3(...local).applyMatrix4(canonicalMatrix), p = canonicalPoint(transformed); vertices[index] = p; expand(objectBounds, p);
        if (++vertexCount > MODEL_CAPTURE_LIMITS.vertices) refuse('Selected vertex budget exceeded.');
      });
      sdk.enumMeshTriangles(geometry, (_a, _b, _c, a, b, c) => { active(); if (![a, b, c].every(index => Number.isSafeInteger(index) && index >= 0 && index < vertices.length && vertices[index])) refuse('Invalid SDK triangle index.'); triangleIndices.push(a, b, c); if (++triangleCount > MODEL_CAPTURE_LIMITS.triangles) refuse('Selected triangle budget exceeded.'); });
      if (vertices.length < 3 || !triangleIndices.length) refuse('Selected mesh is incomplete; no AABB mesh is fabricated.');
      for (let index = 0; index < vertices.length; index++) if (!vertices[index]) refuse('Selected mesh contains an unfilled vertex index.');
      fragments.push({ id: 'fragment:' + fragmentId, vertices, triangleIndices, fragmentToWorldMetres: Array.from(canonicalMatrix.elements), transformAlreadyApplied: true });
      evidence.fragments.push({ objectId: 'dbid:' + record.id, fragmentId, original: Array.from(original.elements), display: Array.from(world.elements), canonical: Array.from(canonicalMatrix.elements) });
    }
    if (record.role === 'routing-leaf' && !fragments.length) refuse('A selected routing leaf has no triangle geometry.');
    const props = propertyMap.get(record.id), properties = (props?.properties ?? []).map(value => ({ category: text(String(value.displayCategory ?? ''), 512), name: text(String(value.displayName ?? value.attributeName ?? ''), 512), value: text(String(value.displayValue ?? '')) }));
    if (properties.length > MODEL_CAPTURE_LIMITS.properties) refuse('Selected property budget exceeded.');
    const external = unique([...(externalIds.get(record.id) ?? []), ...(props?.externalId ? [text(props.externalId, 1024)] : [])]);
    if (external.length > 1) diagnostics.push({ code: 'ambiguous_external_identity', objectId: 'dbid:' + record.id, candidates: external });
    if (record.routeNames.size > 1) refuse('A physical leaf has multiple selected route owners; resolve the network ambiguity.');
    const actualBounds = validBounds(objectBounds) ? objectBounds : record.role === 'hierarchy' ? selectedAncestorBounds.get(record.id) : sdkBounds(record.id);
    if (!validBounds(actualBounds)) refuse('Captured hierarchy has no selected descendant bounds.');
    for (const parent of chain.slice(1)) { if (!selectedAncestorBounds.has(parent)) selectedAncestorBounds.set(parent, bounds()); expand(selectedAncestorBounds.get(parent), actualBounds.minimum); expand(selectedAncestorBounds.get(parent), actualBounds.maximum); }
    const object = { id: 'dbid:' + record.id, parentId: chain[1] !== undefined ? 'dbid:' + chain[1] : null, ...(external.length === 1 ? { externalId: external[0] } : {}), dbId: record.id, name: text(tree.getNodeName(record.id) ?? ''), geometryRole: record.role, leafToRootNames: chain.map(id => text(tree.getNodeName(id) ?? '')), properties, nativeHidden: null, planningExcluded: false, ...(record.role === 'routing-leaf' ? record.routeBoundaryId !== undefined ? { routeBoundaryId: 'dbid:' + record.routeBoundaryId } : { routeName: [...record.routeNames][0], shapeName: text(tree.getNodeName(record.id) ?? '') } : {}), categoryAssignmentSource: record.role === 'routing-leaf' ? 'explicit-planning' : 'unassigned', allowedCategories: record.role === 'routing-leaf' ? [...(record.allowedCategories ?? request.allowedCategories)] : [], bounds: actualBounds, fragments };
    const body = serialize(object); snapshotBytes += encoder.encode(body).length; if (snapshotBytes > MODEL_CAPTURE_LIMITS.totalBytes) refuse('Selected computational snapshot exceeds64MiB. Reduce scope.');
    for (const event of textParts('object-part', request.captureId, object.id, body)) yield emit(event);
    objectCount++; onProgress?.({ phase: 'geometry', loaded: objectCount, total: selected.size }); await pause();
  }
  const equipmentMatches = [...equipment.values()].map(value => ({ name: value.name, status: value.ids.size === 0 ? 'missing' : value.ids.size > 1 ? 'ambiguous' : 'candidate', candidateObjectIds: [...value.ids].sort((a, b) => a - b).map(id => 'dbid:' + id) }));
  const summary = { scope: { kind: 'explicit-selected-network', ...captureScope, ...(request.routeRules ? {} : { routeCodes: request.routeCodes.map(code => '/' + code) }), fullHierarchyIndexed: true, indexedObjectCount: ids.length, selectedObjectsOnly: true, fullGeometryCaptured: false, fullPropertyScan: equipment.size > 0 }, evidence, equipmentMatches, diagnostics, counts: { objectCount, fragmentCount, vertexCount, triangleCount }, engineeringAccepted: false, limitations: ['Selected network geometry only; full plant capture/capacity is not established.', 'Exact endpoint candidates retain ambiguity and unknown native visibility; automatic engineering acceptance is not granted.', 'SDK unit/transform measurements do not establish native-converted parity or source-link proof.'] };
  for (const event of textParts('summary-part', request.captureId, null, serialize(summary))) yield emit(event);
  yield emit({ type: 'complete', captureId: request.captureId, objectCount, fragmentCount, vertexCount, triangleCount, engineeringAccepted: false });
}

export function createModelCaptureAssembler() {
  let captureId, header, totalBytes = 0, eventCount = 0, current, summaryText = '', summaryPart = 0, summaryDone = false, completed = false, summary;
  const objects = [], seenObjects = new Set();
  return {
    accept(event) {
      if (!event || typeof event !== 'object' || Array.isArray(event) || completed || !UUID.test(event.captureId ?? '') || size(event) > MODEL_CAPTURE_LIMITS.eventBytes || ++eventCount > MODEL_CAPTURE_LIMITS.events || (totalBytes += size(event)) > MODEL_CAPTURE_LIMITS.totalBytes) refuse('Invalid, stale or over-budget capture event.');
      if (!captureId) { if (event.type !== 'metadata') refuse('Capture metadata must be first.'); captureId = event.captureId; }
      if (event.captureId !== captureId) refuse('Capture identity changed.');
      if (event.type === 'metadata') {
        if (header || !keys(event, ['type', 'captureId', 'schemaVersion', 'snapshotHeader', 'scope', 'inventoryComplete', 'geometryComplete']) || event.schemaVersion !== 'pathfinder.model.capture.events.v1' || event.scope !== 'explicit-selected-network' || event.inventoryComplete !== false || event.geometryComplete !== false) refuse('Invalid capture metadata.');
        header = event.snapshotHeader;
        validateHeader(header);
        header = JSON.parse(serialize(header)); return;
      }
      if (!header) refuse('Capture metadata is missing.');
      if (event.type === 'object-part') {
        if (summaryPart || !keys(event, ['type', 'captureId', 'objectId', 'partIndex', 'final', 'text']) || typeof event.text !== 'string' || typeof event.final !== 'boolean' || !/^dbid:[0-9]+$/.test(event.objectId ?? '') || !Number.isSafeInteger(event.partIndex) || event.partIndex < 0) refuse('Invalid object capture part.');
        if (!current) { if (event.partIndex !== 0 || seenObjects.has(event.objectId)) refuse('Duplicate or missing object capture part.'); current = { id: event.objectId, index: 0, text: '' }; }
        if (event.objectId !== current.id || event.partIndex !== current.index++) refuse('Out-of-order object capture part.');
        current.text += event.text;
        if (event.final) { let object; try { object = JSON.parse(current.text); } catch { refuse('Invalid captured object JSON.'); } if (serialize(object) !== current.text) refuse('Captured object JSON is not canonical; duplicate members are refused.'); if (object.id !== current.id) refuse('Captured object identity differs.'); validateObject(object); objects.push(object); seenObjects.add(object.id); current = undefined; if (objects.length > MODEL_CAPTURE_LIMITS.objects) refuse('Captured object budget exceeded.'); }
        return;
      }
      if (event.type === 'summary-part') {
        if (current || summaryDone || !keys(event, ['type', 'captureId', 'partIndex', 'final', 'text']) || event.partIndex !== summaryPart++ || typeof event.text !== 'string' || typeof event.final !== 'boolean') refuse('Invalid summary capture part.');
        summaryText += event.text; summaryDone = event.final; if (summaryDone) { try { summary = JSON.parse(summaryText); } catch { refuse('Invalid capture summary JSON.'); } if (serialize(summary) !== summaryText) refuse('Capture summary JSON is not canonical.'); } return;
      }
      if (event.type === 'complete') {
        if (current || !summaryDone || !keys(event, ['type', 'captureId', 'objectCount', 'fragmentCount', 'vertexCount', 'triangleCount', 'engineeringAccepted']) || event.engineeringAccepted !== false || event.objectCount !== objects.length || !objects.length || summary?.engineeringAccepted !== false || summary?.counts?.objectCount !== objects.length) refuse('Incomplete capture cannot become a computational snapshot.');
        const counts = { fragmentCount: 0, vertexCount: 0, triangleCount: 0 }, fragmentIds = new Set(), byId = new Map(objects.map(object => [object.id, object]));
        for (const object of objects) {
          const chain = [], visited = new Set(); let node = object;
          while (node) { if (visited.has(node.id) || chain.length >= MODEL_CAPTURE_LIMITS.depth) refuse('Cyclic or over-depth captured hierarchy.'); visited.add(node.id); chain.push(node.name); if (node.parentId !== null && (!byId.has(node.parentId) || byId.get(node.parentId).geometryRole === 'routing-leaf')) refuse('Missing or physical-leaf captured parent.'); node = node.parentId === null ? null : byId.get(node.parentId); }
          if (serialize(chain) !== serialize(object.leafToRootNames)) refuse('Captured hierarchy names disagree with parents.');
          if (object.routeBoundaryId !== undefined && !visited.has(object.routeBoundaryId)) refuse('Selected route boundary is not an ancestor of its physical leaf.');
          for (const fragment of object.fragments) { if (fragmentIds.has(fragment.id)) refuse('Duplicate captured physical fragment.'); fragmentIds.add(fragment.id); counts.fragmentCount++; counts.vertexCount += fragment.vertices.length; counts.triangleCount += fragment.triangleIndices.length / 3; }
        }
        if (counts.fragmentCount > MODEL_CAPTURE_LIMITS.fragments || counts.vertexCount > MODEL_CAPTURE_LIMITS.vertices || counts.triangleCount > MODEL_CAPTURE_LIMITS.triangles) refuse('Captured geometry total budget exceeded.');
        for (const key of Object.keys(counts)) if (counts[key] !== event[key] || counts[key] !== summary.counts[key]) refuse('Capture count closure differs.');
        completed = true; return;
      }
      refuse('Unknown capture event.');
    },
    finish() { if (!completed) refuse('Model capture is not complete.'); const snapshot = { ...header, objects }; if (size(snapshot) > MODEL_CAPTURE_LIMITS.totalBytes) refuse('Computational snapshot exceeds64MiB.'); return snapshot; },
    summary() { if (!completed) refuse('Model capture is not complete.'); return JSON.parse(serialize(summary)); },
  };
}
