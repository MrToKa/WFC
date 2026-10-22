// Protected selected-barrier observations. Importing this module does not read SDK globals.
// Neither capture completeness nor its hashes establish producer/server authority.
import { BARRIER_CAPTURE_ERROR_CODES, BARRIER_CAPTURE_ERROR_MESSAGES } from './barrier-capture-errors.mjs';
export const BARRIER_CAPTURE_VIEWER_LIMITS = Object.freeze({ requestBytes: 48 * 1024, eventBytes: 24 * 1024,
  totalBytes: 32 * 1024 ** 2, events: 3000, selectedParents: 128, fragments: 8192,
  vertices: 500000, triangles: 250000, closureObjects: 65536, enumerationWork: 2000000,
  depth: 512, milliseconds: 300000, callbackMilliseconds: 45000 });
const L = BARRIER_CAPTURE_VIEWER_LIMITS, encoder = new TextEncoder();
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const integer = (value, maximum = 2147483647) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const ownRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, fields) => ownRecord(value) && Object.keys(value).length === fields.length
  && fields.every(field => Object.hasOwn(value, field) && Object.getOwnPropertyDescriptor(value, field)?.get === undefined);
const unique = values => new Set(values).size === values.length;
const validText = (value, maximum = 2048) => typeof value === 'string' && value.length > 0 && value.length <= maximum
  && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  && [...value].every(character => character.length !== 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff);
const canonicalPoint = value => Array.isArray(value) && value.length === 3 && value.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9);
const rawPoint = value => Array.isArray(value) && value.length === 3 && value.every(n => Number.isFinite(n) && Math.abs(n) <= 1e12);
const matrix = value => Array.isArray(value) && value.length === 16 && value.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9)
  && value[3] === 0 && value[7] === 0 && value[11] === 0 && value[15] === 1
  && value[0] * (value[5] * value[10] - value[9] * value[6]) - value[4] * (value[1] * value[10] - value[9] * value[2])
    + value[8] * (value[1] * value[6] - value[5] * value[2]) !== 0;
const scopeFields = ['projectId', 'modelVersionId', 'contentFingerprint', 'selectionRevision', 'captureFrameId', 'captureFrameSha256', 'coordinateFrame'];
const scope = value => exact(value, scopeFields) && uuid(value.projectId) && uuid(value.modelVersionId) && hash(value.contentFingerprint)
  && typeof value.selectionRevision === 'string' && /^(?:0|[1-9][0-9]{0,18})$/u.test(value.selectionRevision) && BigInt(value.selectionRevision) <= 9223372036854775807n
  && uuid(value.captureFrameId) && hash(value.captureFrameSha256) && value.coordinateFrame === 'canonical-world-metres';
const parentFields = ['selectionId', 'kind', 'objectId', 'dbId', 'externalId', 'name', 'identityBasis', 'inclusion'];
const parent = value => exact(value, parentFields) && uuid(value.selectionId) && ['wall', 'partition', 'floor', 'ceiling', 'obstacle'].includes(value.kind)
  && integer(value.dbId) && value.objectId === 'dbid:' + value.dbId && (value.externalId === null || validText(value.externalId))
  && validText(value.name) && value.identityBasis === 'version-local-only' && value.inclusion === 'own-and-all-descendant-fragments';
const parents = value => Array.isArray(value) && value.length > 0 && value.length <= L.selectedParents && value.every(parent)
  && unique(value.map(item => item.selectionId)) && unique(value.map(item => item.dbId));
const captureError = code => { const safeCode = BARRIER_CAPTURE_ERROR_CODES.includes(code) ? code : 'BARRIER_CAPTURE_INVALID';
  return Object.assign(new Error(BARRIER_CAPTURE_ERROR_MESSAGES[safeCode]), { code: safeCode }); };
const fail = (_message, code = 'BARRIER_CAPTURE_INVALID') => { throw captureError(code); };
const requireThat = (condition, message, code = 'BARRIER_CAPTURE_INVALID') => { if (!condition) fail(message, code); };
export function barrierCanonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { requireThat(Number.isFinite(value), 'Nonfinite barrier JSON.'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(barrierCanonicalJson).join(',') + ']';
  if (ownRecord(value)) return '{' + Object.keys(value).sort().map(key => {
    requireThat(Object.getOwnPropertyDescriptor(value, key)?.get === undefined, 'Barrier data cannot contain accessors.');
    return JSON.stringify(key) + ':' + barrierCanonicalJson(value[key]);
  }).join(',') + '}';
  return fail('Unsupported barrier JSON value.');
}
const bytes = value => encoder.encode(barrierCanonicalJson(value)).byteLength;
const digest = async value => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(barrierCanonicalJson(value))))]
  .map(value => value.toString(16).padStart(2, '0')).join('');
export function validateBarrierCaptureRequest(value) {
  try { return exact(value, ['captureId', 'scope', 'selectedParents']) && uuid(value.captureId) && scope(value.scope)
    && parents(value.selectedParents) && bytes(value) <= L.requestBytes; } catch { return false; }
}
const frameFields = ['schemaVersion', 'projectId', 'modelVersionId', 'contentFingerprint', 'loadId', 'sdkVersion', 'matrixPrecision',
  'coordinateFrame', 'sourceUnits', 'metresPerDisplayUnit', 'upVector', 'globalOffsetDisplayUnits', 'globalOffsetMetres',
  'displayToWorldMetres', 'modelTransform', 'placementTransform', 'contentSha256'];
export function barrierFrameObservationHashInput(value) {
  const { contentSha256: _hash, ...input } = value; return input;
}
export function validateBarrierFrameObservation(value) {
  return exact(value, frameFields) && value.schemaVersion === 'wfc.pf.barrier-frame-observation.v1'
    && uuid(value.projectId) && uuid(value.modelVersionId) && hash(value.contentFingerprint) && uuid(value.loadId)
    && value.sdkVersion === '7.130.0' && value.matrixPrecision === 'binary64' && value.coordinateFrame === 'canonical-world-metres'
    && validText(value.sourceUnits, 64) && Number.isFinite(value.metresPerDisplayUnit) && value.metresPerDisplayUnit > 0 && value.metresPerDisplayUnit <= 1e6
    && rawPoint(value.upVector) && Math.abs(value.upVector[0]) <= 1e-12 && Math.abs(value.upVector[1]) <= 1e-12 && Math.abs(value.upVector[2] - 1) <= 1e-12
    && rawPoint(value.globalOffsetDisplayUnits) && canonicalPoint(value.globalOffsetMetres) && matrix(value.displayToWorldMetres)
    && (value.modelTransform === null || matrix(value.modelTransform)) && (value.placementTransform === null || matrix(value.placementTransform))
    && hash(value.contentSha256);
}
export function validateBarrierCaptureEvent(value) {
  try {
    if (!uuid(value?.captureId) || bytes(value) > L.eventBytes) return false;
    if (value.type === 'metadata') return exact(value, ['type', 'captureId', 'schemaVersion', 'scope', 'selectedParentCount', 'frameObservation'])
      && value.schemaVersion === 'wfc.pf.barrier-capture.events.v1' && scope(value.scope)
      && integer(value.selectedParentCount, L.selectedParents) && value.selectedParentCount > 0 && validateBarrierFrameObservation(value.frameObservation);
    if (value.type === 'capture-part') return exact(value, ['type', 'captureId', 'partIndex', 'final', 'text'])
      && integer(value.partIndex, L.events - 1) && typeof value.final === 'boolean' && typeof value.text === 'string' && value.text.length > 0;
    return value.type === 'complete' && exact(value, ['type', 'captureId', 'captureSha256', 'fragmentCount', 'vertexCount', 'triangleCount'])
      && hash(value.captureSha256) && integer(value.fragmentCount, L.fragments) && value.fragmentCount > 0
      && integer(value.vertexCount, L.vertices) && integer(value.triangleCount, L.triangles);
  } catch { return false; }
}
const bounds = value => exact(value, ['minimum', 'maximum']) && canonicalPoint(value.minimum) && canonicalPoint(value.maximum)
  && value.minimum.every((n, index) => n <= value.maximum[index]);
const fragmentSourceFields = ['fragmentId', 'ownerObjectId', 'parentSelectionIds', 'sourceUnits', 'metresPerSourceUnit', 'sourceToWorldMetres', 'transformSha256'];
function fragment(value) {
  if (!exact(value, ['source', 'bounds', 'verticesMetres', 'triangleIndices']) || !exact(value.source, fragmentSourceFields)) return false;
  const source = value.source;
  if (!integer(source.fragmentId) || !/^dbid:(?:0|[1-9][0-9]*)$/u.test(source.ownerObjectId ?? '') || !integer(Number(source.ownerObjectId.slice(5)))
    || !Array.isArray(source.parentSelectionIds) || source.parentSelectionIds.length < 1 || source.parentSelectionIds.length > L.selectedParents
    || !source.parentSelectionIds.every(uuid) || !unique(source.parentSelectionIds) || !validText(source.sourceUnits, 64)
    || !Number.isFinite(source.metresPerSourceUnit) || source.metresPerSourceUnit <= 0 || source.metresPerSourceUnit > 1e6
    || !matrix(source.sourceToWorldMetres) || !hash(source.transformSha256) || !bounds(value.bounds)
    || !Array.isArray(value.verticesMetres) || value.verticesMetres.length < 3 || value.verticesMetres.length > L.vertices
    || !value.verticesMetres.every(canonicalPoint) || value.verticesMetres.some(point => point.some((n, axis) => n < value.bounds.minimum[axis] || n > value.bounds.maximum[axis]))
    || !Array.isArray(value.triangleIndices) || !value.triangleIndices.length || value.triangleIndices.length % 3 || value.triangleIndices.length > L.triangles * 3
    || !value.triangleIndices.every(index => integer(index, value.verticesMetres.length - 1))) return false;
  for (let i = 0; i < value.triangleIndices.length; i += 3) if (!unique(value.triangleIndices.slice(i, i + 3))) return false;
  return true;
}
export function barrierEnumerationHashInput(capture) {
  return { selectedParents: capture.selectedParents, enumeratedFragmentIds: capture.observation.enumeratedFragmentIds,
    membership: capture.fragments.map(item => ({ fragmentId: item.source.fragmentId, ownerObjectId: item.source.ownerObjectId, parentSelectionIds: item.source.parentSelectionIds })) };
}
function validateCompleteCapture(value) {
  if (!exact(value, ['schemaVersion', 'captureId', 'scope', 'selectedParents', 'fragments', 'observation'])
    || value.schemaVersion !== 'wfc.pf.barrier-capture.v1' || !uuid(value.captureId) || !scope(value.scope) || !parents(value.selectedParents)
    || !Array.isArray(value.fragments) || !value.fragments.length || value.fragments.length > L.fragments || !value.fragments.every(fragment)
    || !unique(value.fragments.map(item => item.source.fragmentId))
    || !exact(value.observation, ['state', 'verification', 'enumeratedFragmentIds', 'unavailableFragmentIds', 'enumerationSha256'])
    || value.observation.state !== 'reported-complete' || value.observation.verification !== 'unverified'
    || !Array.isArray(value.observation.unavailableFragmentIds) || value.observation.unavailableFragmentIds.length !== 0
    || !Array.isArray(value.observation.enumeratedFragmentIds) || value.observation.enumeratedFragmentIds.length !== value.fragments.length
    || !hash(value.observation.enumerationSha256)) return false;
  const parentIds = new Set(value.selectedParents.map(item => item.selectionId));
  return value.fragments.every((item, index) => item.source.fragmentId === value.observation.enumeratedFragmentIds[index]
    && item.source.parentSelectionIds.every(id => parentIds.has(id)))
    && value.selectedParents.every(parent => value.fragments.some(item => item.source.parentSelectionIds.includes(parent.selectionId)))
    && value.fragments.reduce((n, item) => n + item.verticesMetres.length, 0) <= L.vertices
    && value.fragments.reduce((n, item) => n + item.triangleIndices.length / 3, 0) <= L.triangles;
}
const pointValues = value => Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : [value?.x, value?.y, value?.z];
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const clone = value => JSON.parse(barrierCanonicalJson(value));

export async function* captureSelectedBarriers(viewer, input, { loadId, signal, onProgress = () => {}, startedAt = Date.now(), eventLimit = L.events } = {}) {
  requireThat(validateBarrierCaptureRequest(input) && uuid(loadId), 'A bounded selected barrier request and trusted load identity are required.');
  requireThat(Number.isFinite(startedAt) && startedAt <= Date.now() && integer(eventLimit, L.events) && eventLimit >= 3, 'Invalid barrier capture deadline or response budget.');
  const request = clone(input), model = viewer?.model;
  requireThat(model, 'The selected model is not loaded.', 'BARRIER_CAPTURE_MODEL_CHANGED');
  const active = () => {
    if (signal?.aborted) throw new DOMException('Barrier capture cancelled.', 'AbortError');
    requireThat(viewer.model === model, 'The barrier model changed.', 'BARRIER_CAPTURE_MODEL_CHANGED');
    requireThat(Date.now() - startedAt < L.milliseconds, 'The barrier capture deadline expired.', 'BARRIER_CAPTURE_DEADLINE');
  };
  active();
  const sdk = globalThis.Autodesk?.Viewing?.Private;
  requireThat(String(globalThis.LMV_VIEWER_VERSION ?? '') === '7.130.0' && typeof sdk?.LmvMatrix4 === 'function'
    && typeof sdk.enumMeshVertices === 'function' && typeof sdk.enumMeshTriangles === 'function', 'The pinned binary64 triangle capture SDK is required.', 'BARRIER_CAPTURE_FRAME_UNSUPPORTED');
  const newMatrix = () => { const result = new sdk.LmvMatrix4(true); requireThat(result.elements instanceof Float64Array && result.elements.length === 16, 'Binary64 matrices are required.', 'BARRIER_CAPTURE_FRAME_UNSUPPORTED'); return result; };
  async function callback(invoke, unavailableCode) {
    active(); return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
      const abort = () => finish(new DOMException('Barrier capture cancelled.', 'AbortError'));
      const timer = setTimeout(() => finish(captureError('BARRIER_CAPTURE_DEADLINE')), Math.min(L.callbackMilliseconds, Math.max(1, L.milliseconds - (Date.now() - startedAt))));
      signal?.addEventListener('abort', abort, { once: true });
      try { invoke(value => { try { active(); finish(null, value); } catch (error) { finish(error); } }, () => finish(captureError(unavailableCode))); }
      catch (error) { finish(error?.name === 'AbortError' ? new DOMException('Barrier capture cancelled.', 'AbortError')
        : captureError(BARRIER_CAPTURE_ERROR_CODES.includes(error?.code) ? error.code : unavailableCode)); }
    });
  }
  const tree = await callback((yes, no) => model.getObjectTree(yes, no), 'BARRIER_CAPTURE_TREE_UNAVAILABLE');
  requireThat(tree, 'The current model tree is unavailable.', 'BARRIER_CAPTURE_TREE_UNAVAILABLE');
  const list = model.getFragmentList?.(), fragmentCount = list?.getCount?.();
  requireThat(tree && typeof tree.getRootId === 'function' && typeof tree.getNodeParentId === 'function' && typeof tree.getNodeName === 'function'
    && typeof tree.enumNodeChildren === 'function' && typeof tree.enumNodeFragments === 'function' && integer(fragmentCount, 1000000)
    && typeof list.getGeometry === 'function' && typeof list.getWorldMatrix === 'function' && typeof list.getOriginalWorldMatrix === 'function', 'Complete current selected hierarchy, original physical transforms and geometry APIs are required.', 'BARRIER_CAPTURE_FRAME_UNSUPPORTED');
  const rootId = tree.getRootId(); requireThat(integer(rootId), 'Invalid current model root.');
  const externalParents = request.selectedParents.filter(parent => parent.externalId !== null);
  if (externalParents.length) {
    // Pinned SDK7.130 Model.getBulkProperties discards needsExternalId, while
    // an empty propFilter excludes externalId even after its table is loaded.
    // The v2 API preserves the explicit load option and requests only identity.
    requireThat(typeof model.getBulkProperties2 === 'function', 'Selected external identities require bounded current property evidence.', 'BARRIER_CAPTURE_IDENTITY_UNAVAILABLE');
    const rows = await callback((yes, no) => model.getBulkProperties2(externalParents.map(parent => parent.dbId),
      { propFilter: ['externalId'], ignoreHidden: false, needsExternalId: true }, yes, no), 'BARRIER_CAPTURE_IDENTITY_UNAVAILABLE');
    requireThat(Array.isArray(rows) && rows.length === externalParents.length, 'Selected external identity evidence is incomplete.', 'BARRIER_CAPTURE_IDENTITY_UNAVAILABLE');
    const seen = new Set();
    for (const row of rows) { active(); const expected = externalParents.find(parent => parent.dbId === row?.dbId);
      requireThat(expected && !seen.has(row.dbId) && typeof row.externalId === 'string' && row.externalId.length > 0,
        'Selected external identity evidence is missing or inconsistent.', 'BARRIER_CAPTURE_IDENTITY_UNAVAILABLE');
      requireThat(row.externalId === expected.externalId, 'Selected external identity changed.', 'BARRIER_CAPTURE_MODEL_CHANGED'); seen.add(row.dbId); }
  }
  async function observeFrame() {
    active(); const scale = model.getUnitScale?.(), sourceUnits = model.getUnitString?.();
    const up = pointValues(model.getUpVector?.()), offset = pointValues(model.getGlobalOffset?.() ?? model.getData?.()?.globalOffset);
    requireThat(validText(sourceUnits, 64) && Number.isFinite(scale) && scale > 0 && scale <= 1e6 && rawPoint(up)
      && Math.abs(up[0]) <= 1e-12 && Math.abs(up[1]) <= 1e-12 && Math.abs(up[2] - 1) <= 1e-12 && rawPoint(offset), 'Actual finite units, Z-up and global offset are required.', 'BARRIER_CAPTURE_FRAME_UNSUPPORTED');
    const display = newMatrix().makeScale(scale, scale, scale); for (let axis = 0; axis < 3; axis++) display.elements[12 + axis] = offset[axis] * scale;
    const optionalTransform = getter => { const result = getter?.call(model); if (result === null || result === undefined) return null; const values = Array.from(result.elements ?? []); requireThat(matrix(values), 'A returned model placement transform is invalid.', 'BARRIER_CAPTURE_FRAME_UNSUPPORTED'); return values; };
    const value = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1', projectId: request.scope.projectId, modelVersionId: request.scope.modelVersionId,
      contentFingerprint: request.scope.contentFingerprint, loadId, sdkVersion: '7.130.0', matrixPrecision: 'binary64', coordinateFrame: 'canonical-world-metres',
      sourceUnits, metresPerDisplayUnit: scale, upVector: up, globalOffsetDisplayUnits: offset, globalOffsetMetres: offset.map(n => n * scale),
      displayToWorldMetres: Array.from(display.elements), modelTransform: optionalTransform(model.getModelTransform), placementTransform: optionalTransform(model.getPlacementTransform) };
    const result = { ...value, contentSha256: await digest(value) }; active(); requireThat(validateBarrierFrameObservation(result), 'Observed barrier frame is unsupported.', 'BARRIER_CAPTURE_FRAME_UNSUPPORTED'); return result;
  }
  const frameObservation = await observeFrame();
  function physicalWorld(fragmentId) {
    active(); const original = newMatrix(), world = newMatrix(); list.getOriginalWorldMatrix(fragmentId, original); list.getWorldMatrix(fragmentId, world);
    requireThat(matrix(Array.from(original.elements)) && matrix(Array.from(world.elements)), 'Selected original/world fragment transform is invalid.', 'BARRIER_CAPTURE_FRAME_UNSUPPORTED');
    // Pinned SDK 7.130.0 getWorldMatrix = modelMatrix * animation * original.
    // getModelTransform exposes that modelMatrix; placement already present in
    // the original/model composition must never be multiplied for a second time.
    const expected = frameObservation.modelTransform === null ? newMatrix().copy(original) : (() => {
      const modelMatrix = newMatrix(); modelMatrix.elements.set(frameObservation.modelTransform); return modelMatrix.multiply(original);
    })();
    requireThat(barrierCanonicalJson(Array.from(world.elements)) === barrierCanonicalJson(Array.from(expected.elements)),
      'Animated or exploded fragment transforms cannot define a physical barrier capture. Restore the physical model first.', 'BARRIER_CAPTURE_FRAME_UNSUPPORTED');
    return world;
  }
  let eventCount = 0, transportBytes = 0;
  const emit = event => { active(); requireThat(bytes(event) <= L.eventBytes, 'Barrier event exceeds its byte limit.', 'BARRIER_CAPTURE_PAYLOAD_LIMIT');
    requireThat(validateBarrierCaptureEvent(event), 'Invalid barrier capture event.');
    requireThat(++eventCount <= eventLimit && (transportBytes += bytes(event)) <= L.totalBytes, 'Barrier capture exceeds its bounded event transport.', 'BARRIER_CAPTURE_PAYLOAD_LIMIT'); return event; };
  yield emit({ type: 'metadata', captureId: request.captureId, schemaVersion: 'wfc.pf.barrier-capture.events.v1', scope: request.scope,
    selectedParentCount: request.selectedParents.length, frameObservation });
  let work = 0, yieldedWork = 0; const known = new Set(), owners = new Map(), membership = new Map(), nodeSnapshots = new Map();
  const spend = () => { active(); requireThat(++work <= L.enumerationWork, 'Selected barrier hierarchy work exceeds its limit.', 'BARRIER_CAPTURE_HIERARCHY_LIMIT'); };
  const checkAncestry = (id, expectedName) => {
    const seen = new Set(); let current = id;
    while (true) { spend(); requireThat(integer(current) && !seen.has(current), 'Selected barrier hierarchy is invalid or cyclic.'); requireThat(seen.size < L.depth, 'Selected barrier ancestry exceeds its depth limit.', 'BARRIER_CAPTURE_HIERARCHY_LIMIT'); seen.add(current);
      if (current === rootId) break; const next = tree.getNodeParentId(current); requireThat(integer(next) && next !== current, 'Selected barrier is not attached to the current root.'); current = next; }
    requireThat(tree.getNodeName(id) === expectedName, 'The selected parent name changed before capture.', 'BARRIER_CAPTURE_MODEL_CHANGED');
  };
  for (const parent of request.selectedParents) {
    checkAncestry(parent.dbId, parent.name); const seen = new Set(), stack = [{ id: parent.dbId, depth: 0 }];
    while (stack.length) {
      spend(); const { id, depth } = stack.pop(); requireThat(!seen.has(id), 'Selected barrier descendants are cyclic.'); requireThat(depth < L.depth, 'Selected barrier descendants exceed their depth limit.', 'BARRIER_CAPTURE_HIERARCHY_LIMIT'); seen.add(id); known.add(id);
      requireThat(known.size <= L.closureObjects, 'Selected barrier hierarchy exceeds its bounded closure.', 'BARRIER_CAPTURE_HIERARCHY_LIMIT');
      const localFragments = new Set();
      tree.enumNodeFragments(id, fragmentId => {
        spend(); requireThat(integer(fragmentId, fragmentCount - 1) && !localFragments.has(fragmentId), 'Invalid or repeated own fragment identity.'); localFragments.add(fragmentId);
        const owner = owners.get(fragmentId); requireThat(owner === undefined || owner === id, 'One physical fragment has conflicting hierarchy owners.'); owners.set(fragmentId, id);
        if (!membership.has(fragmentId)) membership.set(fragmentId, new Set()); membership.get(fragmentId).add(parent.selectionId);
        requireThat(membership.size <= L.fragments, 'Selected barrier fragment limit exceeded.', 'BARRIER_CAPTURE_FRAGMENT_LIMIT');
      }, false);
      const children = new Set(); tree.enumNodeChildren(id, child => {
        spend(); requireThat(integer(child) && !children.has(child) && child !== id && tree.getNodeParentId(child) === id, 'Invalid selected barrier child identity.'); children.add(child);
        // Earlier siblings are already in stack; count each pending node once.
        requireThat(stack.length < L.closureObjects, 'Selected barrier pending hierarchy exceeds its limit.', 'BARRIER_CAPTURE_HIERARCHY_LIMIT'); stack.push({ id: child, depth: depth + 1 }); return false;
      }, false);
      const nodeSnapshot = { parentId: tree.getNodeParentId(id), name: tree.getNodeName(id), fragments: [...localFragments].sort((a, b) => a - b), children: [...children].sort((a, b) => a - b) };
      requireThat(typeof nodeSnapshot.name === 'string' && (nodeSnapshot.name === '' || validText(nodeSnapshot.name)), 'Selected barrier descendants require bounded current names.');
      if (nodeSnapshots.has(id)) requireThat(barrierCanonicalJson(nodeSnapshots.get(id)) === barrierCanonicalJson(nodeSnapshot), 'Selected barrier hierarchy changed during enumeration.', 'BARRIER_CAPTURE_MODEL_CHANGED');
      else nodeSnapshots.set(id, nodeSnapshot);
      if (work - yieldedWork >= 1024) { yieldedWork = work; onProgress({ phase: 'index', loaded: known.size, total: known.size }); await pause(); }
    }
  }
  requireThat(membership.size > 0 && request.selectedParents.every(parent => [...membership.values()].some(ids => ids.has(parent.selectionId))), 'Every selected barrier parent requires physical triangle geometry.', 'BARRIER_CAPTURE_EMPTY_SELECTION');
  const display = newMatrix(); display.elements.set(frameObservation.displayToWorldMetres);
  const fragments = [], matrixByFragment = new Map(), geometryByFragment = new Map(); let verticesTotal = 0, trianglesTotal = 0;
  for (const fragmentId of [...membership.keys()].sort((a, b) => a - b)) {
    active(); const geometry = list.getGeometry(fragmentId); requireThat(geometry, 'Every selected barrier fragment must have resident geometry.', 'BARRIER_CAPTURE_GEOMETRY_NOT_RESIDENT');
    // SDK 7.130.0 wide-line meshes can clear isLines after expansion; their
    // rendering triangles still cannot describe a physical barrier surface.
    requireThat(!geometry.isLines && !geometry.isWideLines && !geometry.isPoints && !geometry.is2d, 'Every selected barrier fragment must be a triangle mesh.', 'BARRIER_CAPTURE_UNSUPPORTED_PRIMITIVE');
    geometryByFragment.set(fragmentId, geometry);
    const world = physicalWorld(fragmentId);
    const canonical = newMatrix().copy(display).multiply(world), canonicalValues = Array.from(canonical.elements);
    requireThat(matrix(canonicalValues), 'Selected fragment canonical transform is invalid.', 'BARRIER_CAPTURE_FRAME_UNSUPPORTED'); matrixByFragment.set(fragmentId, canonicalValues);
    const verticesMetres = [], triangleIndices = [], box = { minimum: [Infinity, Infinity, Infinity], maximum: [-Infinity, -Infinity, -Infinity] };
    sdk.enumMeshVertices(geometry, (value, _normal, _uv, index) => {
      active(); requireThat(integer(index) && !Object.hasOwn(verticesMetres, index), 'Selected mesh has invalid or duplicate vertex indices.');
      requireThat(index < L.vertices, 'Selected mesh vertex index exceeds its vertex budget.', 'BARRIER_CAPTURE_VERTEX_LIMIT');
      const local = pointValues(value); requireThat(rawPoint(local), 'Selected mesh vertex is nonfinite or outside source bounds.', 'BARRIER_CAPTURE_FRAME_UNSUPPORTED');
      const p = [0, 1, 2].map(axis => canonicalValues[axis] * local[0] + canonicalValues[4 + axis] * local[1] + canonicalValues[8 + axis] * local[2] + canonicalValues[12 + axis]);
      requireThat(canonicalPoint(p), 'Selected canonical vertex exceeds its finite coordinate limit.', 'BARRIER_CAPTURE_FRAME_UNSUPPORTED');
      requireThat(++verticesTotal <= L.vertices, 'Selected canonical vertex budget exceeded.', 'BARRIER_CAPTURE_VERTEX_LIMIT'); verticesMetres[index] = p;
      for (let axis = 0; axis < 3; axis++) { box.minimum[axis] = Math.min(box.minimum[axis], p[axis]); box.maximum[axis] = Math.max(box.maximum[axis], p[axis]); }
    });
    requireThat(verticesMetres.length >= 3 && Object.keys(verticesMetres).length === verticesMetres.length, 'Selected mesh has sparse or incomplete indexed vertices.');
    sdk.enumMeshTriangles(geometry, (_a, _b, _c, a, b, c) => {
      active(); requireThat([a, b, c].every(index => integer(index, verticesMetres.length - 1)) && unique([a, b, c]), 'Selected mesh triangle indices are invalid.');
      requireThat(++trianglesTotal <= L.triangles, 'Selected aggregate triangle budget exceeded.', 'BARRIER_CAPTURE_TRIANGLE_LIMIT'); triangleIndices.push(a, b, c);
    });
    requireThat(triangleIndices.length > 0, 'Selected fragment has no original triangle indices.');
    fragments.push({ source: { fragmentId, ownerObjectId: 'dbid:' + owners.get(fragmentId), parentSelectionIds: [...membership.get(fragmentId)].sort(),
      sourceUnits: frameObservation.sourceUnits, metresPerSourceUnit: frameObservation.metresPerDisplayUnit, sourceToWorldMetres: canonicalValues, transformSha256: await digest(canonicalValues) }, bounds: box, verticesMetres, triangleIndices });
    active(); onProgress({ phase: 'geometry', loaded: fragments.length, total: membership.size }); await pause();
  }
  requireThat(barrierCanonicalJson(await observeFrame()) === barrierCanonicalJson(frameObservation), 'The SDK frame changed during barrier capture.', 'BARRIER_CAPTURE_MODEL_CHANGED');
  for (const [id, expected] of nodeSnapshots) {
    spend(); const own = [], children = [];
    tree.enumNodeFragments(id, value => { spend(); requireThat(integer(value, fragmentCount - 1), 'Invalid final selected fragment enumeration.'); requireThat(own.length < L.fragments, 'Final selected fragment count exceeds its limit.', 'BARRIER_CAPTURE_FRAGMENT_LIMIT'); own.push(value); }, false);
    tree.enumNodeChildren(id, value => { spend(); requireThat(integer(value), 'Invalid final selected child enumeration.'); requireThat(children.length < L.closureObjects, 'Final selected child count exceeds its limit.', 'BARRIER_CAPTURE_HIERARCHY_LIMIT'); children.push(value); return false; }, false);
    const observed = { parentId: tree.getNodeParentId(id), name: tree.getNodeName(id), fragments: own.sort((a, b) => a - b), children: children.sort((a, b) => a - b) };
    requireThat(barrierCanonicalJson(observed) === barrierCanonicalJson(expected), 'Selected barrier hierarchy or fragments changed during capture.', 'BARRIER_CAPTURE_MODEL_CHANGED');
    if (work - yieldedWork >= 1024) { yieldedWork = work; await pause(); }
  }
  for (const [fragmentId, expected] of matrixByFragment) { active(); const world = physicalWorld(fragmentId);
    const geometry = list.getGeometry(fragmentId); requireThat(geometry, 'Selected barrier geometry became unavailable during capture.', 'BARRIER_CAPTURE_GEOMETRY_BECAME_UNAVAILABLE');
    requireThat(geometry === geometryByFragment.get(fragmentId), 'Selected barrier geometry changed during capture.', 'BARRIER_CAPTURE_MODEL_CHANGED');
    const observed = Array.from(newMatrix().copy(display).multiply(world).elements); requireThat(barrierCanonicalJson(observed) === barrierCanonicalJson(expected), 'A selected fragment moved during capture.', 'BARRIER_CAPTURE_MODEL_CHANGED'); }
  requireThat(barrierCanonicalJson(await observeFrame()) === barrierCanonicalJson(frameObservation), 'The SDK frame changed during final barrier verification.', 'BARRIER_CAPTURE_MODEL_CHANGED');
  const capture = { schemaVersion: 'wfc.pf.barrier-capture.v1', captureId: request.captureId, scope: request.scope, selectedParents: request.selectedParents, fragments,
    observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: fragments.map(item => item.source.fragmentId), unavailableFragmentIds: [], enumerationSha256: '0'.repeat(64) } };
  capture.observation.enumerationSha256 = await digest(barrierEnumerationHashInput(capture));
  requireThat(validateCompleteCapture(capture), 'Selected barrier capture did not complete its structural closure.');
  const body = barrierCanonicalJson(capture); requireThat(encoder.encode(body).byteLength <= L.totalBytes, 'Selected barrier capture exceeds its complete payload limit.', 'BARRIER_CAPTURE_PAYLOAD_LIMIT');
  const captureSha256 = await digest(capture); let cursor = 0, partIndex = 0;
  while (cursor < body.length) {
    let end = Math.min(cursor + 16384, body.length), event;
    for (;;) { if (end < body.length && /[\uD800-\uDBFF]/u.test(body[end - 1])) end--;
      event = { type: 'capture-part', captureId: request.captureId, partIndex, final: end === body.length, text: body.slice(cursor, end) };
      if (bytes(event) <= L.eventBytes) break; end = cursor + Math.floor((end - cursor) / 2); requireThat(end > cursor, 'Barrier text part cannot fit its envelope.', 'BARRIER_CAPTURE_PAYLOAD_LIMIT'); }
    yield emit(event); cursor = end; partIndex++;
  }
  yield emit({ type: 'complete', captureId: request.captureId, captureSha256, fragmentCount: fragments.length, vertexCount: verticesTotal, triangleCount: trianglesTotal });
}

export function createBarrierCaptureAssembler({ expectedRequest, loadId, eventLimit = L.events } = {}) {
  requireThat(validateBarrierCaptureRequest(expectedRequest) && (loadId === undefined || uuid(loadId)) && integer(eventLimit, L.events) && eventLimit >= 3, 'A bounded expected barrier request is required.');
  const expected = clone(expectedRequest); let metadata, complete, failed = false, final = false, count = 0, total = 0, part = 0, textBytes = 0; const texts = [];
  return {
    accept(event) {
      try {
        requireThat(!failed && !complete && validateBarrierCaptureEvent(event) && event.captureId === expected.captureId && ++count <= eventLimit && (total += bytes(event)) <= L.totalBytes, 'Invalid, stale, duplicate or oversized barrier event.');
        const value = clone(event);
        if (value.type === 'metadata') { requireThat(!metadata && part === 0 && barrierCanonicalJson(value.scope) === barrierCanonicalJson(expected.scope)
          && value.selectedParentCount === expected.selectedParents.length && (loadId === undefined || value.frameObservation.loadId === loadId)
          && value.frameObservation.projectId === expected.scope.projectId && value.frameObservation.modelVersionId === expected.scope.modelVersionId
          && value.frameObservation.contentFingerprint === expected.scope.contentFingerprint, 'Barrier metadata differs from the expected model/load/selection.'); metadata = value; }
        else if (value.type === 'capture-part') { requireThat(metadata && !final && value.partIndex === part++ && (textBytes += encoder.encode(value.text).byteLength) <= L.totalBytes, 'Missing, duplicate or out-of-order barrier text part.'); texts.push(value.text); final = value.final; }
        else { requireThat(metadata && final && part > 0, 'Incomplete barrier capture cannot complete.'); complete = value; }
      } catch (error) { failed = true; throw error; }
    },
    async finish() {
      try {
        requireThat(!failed && metadata && complete && final, 'Barrier capture is incomplete.');
        const body = texts.join(''), capture = JSON.parse(body);
        requireThat(validateCompleteCapture(capture) && capture.captureId === expected.captureId && barrierCanonicalJson(capture.scope) === barrierCanonicalJson(expected.scope)
          && barrierCanonicalJson(capture.selectedParents) === barrierCanonicalJson(expected.selectedParents) && barrierCanonicalJson(capture) === body
          && complete.fragmentCount === capture.fragments.length && complete.vertexCount === capture.fragments.reduce((n, item) => n + item.verticesMetres.length, 0)
          && complete.triangleCount === capture.fragments.reduce((n, item) => n + item.triangleIndices.length / 3, 0), 'Barrier capture payload, canonical encoding or totals do not match.');
        requireThat(await digest(capture) === complete.captureSha256 && await digest(barrierEnumerationHashInput(capture)) === capture.observation.enumerationSha256
          && await digest(barrierFrameObservationHashInput(metadata.frameObservation)) === metadata.frameObservation.contentSha256, 'Barrier capture integrity hash differs.');
        for (const item of capture.fragments) requireThat(await digest(item.source.sourceToWorldMetres) === item.source.transformSha256
          && item.source.sourceUnits === metadata.frameObservation.sourceUnits && item.source.metresPerSourceUnit === metadata.frameObservation.metresPerDisplayUnit, 'Barrier fragment transform integrity or frame unit differs.');
        requireThat(!failed, 'Barrier assembler was invalidated during verification.');
        return { capture, frameObservation: clone(metadata.frameObservation) };
      } catch (error) { failed = true; throw error; }
    },
  };
}
