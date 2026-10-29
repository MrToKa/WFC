import { isCanonicalPoint } from './protocol.mjs';
import { PREPARATION_VIEWER_LIMITS, PREPARATION_MATCHING_POLICY, validatePreparationDiscoveryRequest, validatePreparationDiscoveryPage } from './preparation-input.mjs';
import { modelEquipmentMatchKeys, humanScalarPropertyValues } from './equipment-names.mjs';
import { captureDisplayVisibility, sameDisplayVisibility } from './display-visibility.mjs';

const fail = code => Object.assign(new Error('The requested PathFinder viewer operation could not be completed.'), { code });
const abortError = () => new DOMException('Operation cancelled.', 'AbortError');
const positiveId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const displayPoint = value => Array.isArray(value) && value.length === 3 && value.every(item => Number.isFinite(item) && Math.abs(item) <= 1e12);
const TUBE_SIDES = 8, SEGMENTS_PER_MESH = 2000, TUBE_VERTICES = TUBE_SIDES * 2 + 2;
const APPEARANCE_LIMITS = Object.freeze({ fragments: 1000000, materials: 4096, foregroundFragments: 8192 });
// Per active model, including a conservative charge for Map/array entries and
// UTF-16 strings. The SDK's complete-property proof is retained even when no
// requested name matches; a refused/aborted build is never a reusable index.
const EQUIPMENT_INDEX_LIMITS = Object.freeze({ bytes: 256 * 1024 ** 2, keys: 1000000, postings: 4000000, rawPropertiesPerRow: 1000000, scannedProperties: 32000000, eligiblePropertiesPerRow: 4096, valueCharacters: 65536 });

/** Visual thickness only: each cylinder axis is exactly one supplied segment. */
export function createExactPathBatches(points, radius) {
  if (!Array.isArray(points) || points.length < 1 || points.length > 20000 || !points.every(displayPoint) || !Number.isFinite(radius) || radius <= 0 || radius > 1e12) throw fail('PATH_INVALID');
  const origin = [...points[0]], batches = [];
  let segments = [], segmentCount = 0;
  const flush = () => {
    if (!segments.length) return;
    const positions = new Float32Array(segments.length * TUBE_VERTICES * 3), indices = new Uint16Array(segments.length * TUBE_SIDES * 12);
    let write = 0;
    for (let index = 0; index < segments.length; index++) {
      const [a, b, direction, length] = segments[index], unit = direction.map(value => value / length);
      // Choose a stable perpendicular frame, including vertical segments.
      const side = Math.abs(unit[2]) < 0.9 ? [-unit[1], unit[0], 0] : [-unit[2], 0, unit[0]], sideLength = Math.hypot(...side), u = side.map(value => value / sideLength);
      const v = [unit[1] * u[2] - unit[2] * u[1], unit[2] * u[0] - unit[0] * u[2], unit[0] * u[1] - unit[1] * u[0]], base = index * TUBE_VERTICES;
      for (let end = 0; end < 2; end++) {
        const centre = end ? b : a;
        for (let ring = 0; ring < TUBE_SIDES; ring++) {
          const angle = ring * Math.PI * 2 / TUBE_SIDES;
          for (let axis = 0; axis < 3; axis++) positions[(base + end * TUBE_SIDES + ring) * 3 + axis] = centre[axis] - origin[axis] + radius * (u[axis] * Math.cos(angle) + v[axis] * Math.sin(angle));
        }
        for (let axis = 0; axis < 3; axis++) positions[(base + TUBE_SIDES * 2 + end) * 3 + axis] = centre[axis] - origin[axis];
      }
      for (let ring = 0; ring < TUBE_SIDES; ring++) {
        const next = (ring + 1) % TUBE_SIDES, a0 = base + ring, a1 = base + next, b0 = a0 + TUBE_SIDES, b1 = a1 + TUBE_SIDES;
        for (const vertex of [a0, b0, a1, a1, b0, b1, base + TUBE_SIDES * 2, a1, a0, base + TUBE_SIDES * 2 + 1, b0, b1]) indices[write++] = vertex;
      }
    }
    batches.push({ positions, indices }); segments = [];
  };
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], direction = b.map((value, axis) => value - a[axis]), length = Math.hypot(...direction);
    if (!length) continue;
    segments.push([a, b, direction, length]); segmentCount++;
    if (segments.length === SEGMENTS_PER_MESH) flush();
  }
  flush();
  return { origin, batches, segmentCount, markerRadius: segmentCount ? null : radius };
}

/** The SDK has already applied root placement. Rebase and scale exactly once. */
export function modelCoordinates(model) {
  const scale = model.getUnitScale?.(), up = model.getUpVector?.();
  const raw = model.getGlobalOffset?.() ?? model.getData?.()?.globalOffset;
  const offset = Array.isArray(raw) ? [...raw] : raw && [raw.x, raw.y, raw.z];
  if (!Number.isFinite(scale) || scale <= 0 || !up || up.length !== 3 || !up.every(Number.isFinite) || Math.abs(up[0]) > 1e-12 || Math.abs(up[1]) > 1e-12 || Math.abs(up[2] - 1) > 1e-12 || !displayPoint(offset)) throw fail('COORDINATES_UNSUPPORTED');
  const globalOffsetMetres = offset.map(value => value * scale);
  if (!isCanonicalPoint(globalOffsetMetres)) throw fail('COORDINATES_UNSUPPORTED');
  return {
    scale, globalOffsetMetres,
    toCanonical(point) {
      const values = Array.isArray(point) ? point : [point?.x, point?.y, point?.z];
      if (!displayPoint(values)) throw fail('COORDINATES_UNSUPPORTED');
      const result = values.map((value, i) => (value + offset[i]) * scale);
      if (!isCanonicalPoint(result)) throw fail('COORDINATES_UNSUPPORTED');
      return result;
    },
    toDisplay(point) {
      if (!isCanonicalPoint(point)) throw fail('COORDINATES_UNSUPPORTED');
      const result = point.map((value, i) => value / scale - offset[i]);
      if (!displayPoint(result)) throw fail('COORDINATES_UNSUPPORTED');
      return result;
    },
  };
}

export function createPathFinderController(viewer, { window, signal } = {}) {
  const model = viewer.model, THREE = window.THREE, sceneName = 'wfc-computed-path';
  let disposed = false, overlays = [], geometries = [], material, ghost, bounds, pick, inventoryPromise, externalPromise, preparationEquipment, preparationSubtree;
  let appearance, pathObjectIds = [], viewGeneration = 0, transparencyOperation = 0, materialSerial = 0, sceneActive = false, recoveryRequired = false, baselineVisibilityUnknown = false;
  const pendingCloneCleanup = new Set();
  const active = operationSignal => { if (disposed || signal?.aborted || operationSignal?.aborted) throw abortError(); };
  function callback(work, operationSignal, timeout = 15000, diagnostics) {
    active(operationSignal);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true; clearTimeout(timer);
        signal?.removeEventListener('abort', abort); operationSignal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve(value);
      };
      const abort = () => finish(abortError());
      const timer = setTimeout(() => finish(fail(diagnostics?.timeout ?? 'EXTRACTION_FAILED')), timeout);
      signal?.addEventListener('abort', abort, { once: true }); operationSignal?.addEventListener('abort', abort, { once: true });
      try { work(value => finish(null, value), () => finish(fail(diagnostics?.failed ?? 'EXTRACTION_FAILED'))); }
      catch (error) { finish(diagnostics && error?.name !== 'AbortError' ? fail(diagnostics.failed) : error); }
    });
  }
  function captureGhost() {
    if (!ghost) {
      const visibility = model.visibilityManager;
      ghost = { preference: viewer.prefs?.get('ghosting'), pass: viewer.impl.showGhosting, materials: new Map(),
        visibility: typeof visibility?.getDefaultVisibility === 'function' && typeof visibility?.getVisibility === 'function' && typeof visibility?.setVisibility === 'function'
          ? { defaultVisible: visibility.getDefaultVisibility(), states: visibility.getVisibility().map(entry => [...entry]) } : null };
      if (!ghost.visibility) baselineVisibilityUnknown = true;
    }
    for (const item of [viewer.impl.fadeMaterial, ...(viewer.impl.fadeMaterial?.variants ?? [])].filter(Boolean)) {
      if (!ghost.materials.has(item)) ghost.materials.set(item, item.opacity);
      item.opacity = 0.025;
    }
  }
  const materialState = item => ({ opacity: item.opacity, transparent: item.transparent, depthWrite: item.depthWrite });
  const applyMaterialState = (item, state) => { Object.assign(item, state); item.needsUpdate = true; };
  const restoreFailure = cause => Object.assign(fail('APPEARANCE_RESTORE_FAILED'), cause === undefined ? {} : { cause });
  const terminalOrAbort = error => error?.name === 'AbortError' || ['ACCESS_REVOKED', 'SESSION_EXPIRED', 'MODEL_SELECTION_CHANGED', 'MODEL_UNAVAILABLE', 'RESOURCE_FAILED'].includes(error?.code);
  function restoreState(state) {
    let failed = false; state.restoring = true;
    const rememberFailure = error => { failed = true; state.lastRestoreError ??= error; };
    // Delete a saved entry only after its SDK operation succeeds, so Clear can retry failures.
    for (const [id, original] of state.foreground) {
      try { state.fragments.setMaterial(id, original); state.foreground.delete(id); } catch (error) { rememberFailure(error); }
    }
    for (const [item, saved] of state.materials) {
      try { applyMaterialState(item, saved); state.materials.delete(item); } catch (error) { rememberFailure(error); }
    }
    const stillBound = new Set(state.foreground.values());
    for (const [original, entry] of state.clones) {
      if (stillBound.has(original)) continue; // Never dispose a material still used by an unrestored fragment.
      if (entry.registered) {
        try { state.manager.removeMaterial(entry.name); entry.registered = false; } catch (error) { rememberFailure(error); continue; }
      }
      try { entry.clone.dispose(); state.clones.delete(original); } catch (error) { rememberFailure(error); }
    }
    return !failed && !state.foreground.size && !state.materials.size && !state.clones.size;
  }
  function releaseDetachedClones(state) {
    // Preflight has not touched these original materials/fragments; another command may now own them.
    state.foreground.clear(); state.materials.clear();
    if (!restoreState(state)) { pendingCloneCleanup.add(state); recoveryRequired = true; return false; }
    return true;
  }
  function restoreAppearance() {
    let failed = false;
    if (appearance) { if (restoreState(appearance)) appearance = undefined; else failed = true; }
    for (const state of pendingCloneCleanup) { if (restoreState(state)) pendingCloneCleanup.delete(state); else failed = true; }
    if (failed) { recoveryRequired = true; throw restoreFailure(appearance?.lastRestoreError ?? [...pendingCloneCleanup][0]?.lastRestoreError); }
  }
  function clear() {
    viewGeneration++; transparencyOperation++;
    let failed = false, firstError;
    const attempt = work => { try { work(); return true; } catch (error) { failed = true; firstError ??= error; return false; } };
    attempt(restoreAppearance); pathObjectIds = []; bounds = undefined;
    overlays = overlays.filter(overlay => !attempt(() => viewer.overlays.removeMesh(overlay, sceneName)));
    geometries = geometries.filter(geometry => overlays.some(overlay => overlay.geometry === geometry) || !attempt(() => geometry.dispose()));
    if (!overlays.length && material && attempt(() => material.dispose())) material = undefined;
    if (!overlays.length && sceneActive && attempt(() => viewer.overlays.removeScene(sceneName))) sceneActive = false;
    if (ghost) {
      const prior = ghost;
      if (!prior.visibilityRestored && attempt(() => prior.visibility ? model.visibilityManager.setVisibility(prior.visibility.defaultVisible, prior.visibility.states) : viewer.isolate([], model))) prior.visibilityRestored = true;
      for (const [item, opacity] of prior.materials) if (attempt(() => { item.opacity = opacity; })) prior.materials.delete(item);
      if (!prior.preferenceRestored && attempt(() => { if (typeof prior.preference === 'boolean') viewer.setGhosting(prior.preference); })) prior.preferenceRestored = true;
      if (!prior.passRestored && attempt(() => { if (typeof prior.pass === 'boolean') viewer.impl.toggleGhosting(prior.pass); })) prior.passRestored = true;
      if (prior.visibilityRestored && !prior.materials.size && prior.preferenceRestored && prior.passRestored) ghost = undefined;
    }
    attempt(() => viewer.clearSelection()); attempt(() => viewer.impl.invalidate(true, true, true));
    recoveryRequired = failed;
    if (failed) throw restoreFailure(firstError);
  }
  function prepareForVisibilityObservation() {
    active();
    // Legacy Clear may fall back to show-all, but that cannot reconstruct user
    // hiding from before PF appearance. A fresh model/controller is required.
    if (baselineVisibilityUnknown) throw fail('PREPARATION_VISIBILITY_UNAVAILABLE');
    if (ghost || appearance || pendingCloneCleanup.size || recoveryRequired || overlays.length || geometries.length || bounds || material || sceneActive) clear();
  }
  function showPath({ points, objectIds }) {
    active();
    const coordinates = modelCoordinates(model);
    const local = points.map(point => coordinates.toDisplay(point));
    if (local.length < 1 || local.length > 20000 || !Array.isArray(objectIds) || objectIds.length > 512 || !objectIds.every(positiveId)) throw fail('PATH_INVALID');
    if (!objectIds.length && (typeof model.visibilityManager?.setAllVisibility !== 'function' || typeof model.visibilityManager?.getVisibility !== 'function' || typeof model.visibilityManager?.getDefaultVisibility !== 'function' || typeof model.visibilityManager?.setVisibility !== 'function')) throw fail('SDK_UNSUPPORTED');
    const tubes = createExactPathBatches(local, 0.02 / coordinates.scale);
    clear();
    pathObjectIds = [...objectIds];
    bounds = new THREE.Box3();
    for (const point of local) bounds.expandByPoint(new THREE.Vector3(...point));
    material = new THREE.MeshBasicMaterial({ color: 0xffe600, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    viewer.overlays.addScene(sceneName);
    sceneActive = true;
    for (const batch of tubes.batches) {
      const geometry = new THREE.BufferGeometry(); geometries.push(geometry);
      const positions = new THREE.BufferAttribute(batch.positions, 3), indices = new THREE.BufferAttribute(batch.indices, 1);
      if (typeof geometry.setAttribute === 'function') geometry.setAttribute('position', positions); else geometry.addAttribute('position', positions);
      if (typeof geometry.setIndex === 'function') geometry.setIndex(indices); else geometry.addAttribute('index', indices);
      const overlay = new THREE.Mesh(geometry, material); overlay.position.set(...tubes.origin); overlay.renderOrder = 1000; overlay.frustumCulled = false;
      overlays.push(overlay); viewer.overlays.addMesh(overlay, sceneName);
    }
    if (tubes.markerRadius !== null) {
      const radius = tubes.markerRadius, geometry = new THREE.SphereGeometry(radius, 8, 6); geometries.push(geometry);
      const marker = new THREE.Mesh(geometry, material); marker.position.set(...tubes.origin); marker.renderOrder = 1000; marker.frustumCulled = false;
      overlays.push(marker); viewer.overlays.addMesh(marker, sceneName);
      for (const sign of [-1, 1]) bounds.expandByPoint(new THREE.Vector3(...tubes.origin.map(value => value + sign * radius)));
    }
    captureGhost(); viewer.clearSelection();
    if (objectIds.length) viewer.isolate(objectIds, model); else model.visibilityManager.setAllVisibility(false);
    viewer.setGhosting(true); captureGhost(); viewer.impl.toggleGhosting(true);
    viewer.impl.invalidate(true, true, true); fit();
    return { pointCount: points.length };
  }
  function fit() { if (bounds) viewer.navigation.fitBounds(false, bounds); }
  async function setTransparency(percent, operationSignal, beforeCommit = async () => {}) {
    active(operationSignal);
    if (recoveryRequired || appearance?.restoring || pendingCloneCleanup.size) throw restoreFailure();
    if (!ghost || !bounds || !Number.isSafeInteger(percent) || percent < 0 || percent > 100) throw fail('PATH_INVALID');
    const generation = viewGeneration, operation = ++transparencyOperation, previous = appearance;
    const current = () => {
      active(operationSignal);
      if (viewer.model !== model || generation !== viewGeneration || operation !== transparencyOperation) throw abortError();
      if (recoveryRequired || appearance?.restoring || pendingCloneCleanup.size) throw restoreFailure();
    };
    let prepared = previous;
    try {
      if (!prepared) {
        const fragments = model.getFragmentList(), manager = viewer.impl.matman?.(), count = fragments?.getCount?.(), tree = await callback((yes, no) => model.getObjectTree(yes, no), operationSignal, 45000);
        if (!Number.isSafeInteger(count) || count < 0 || count > APPEARANCE_LIMITS.fragments || !tree || !ghost.visibility || typeof fragments.getMaterial !== 'function' || typeof fragments.setMaterial !== 'function' || typeof manager?.cloneMaterial !== 'function' || typeof manager.addMaterial !== 'function' || typeof manager.removeMaterial !== 'function' || typeof model.unconsolidate !== 'function' || pathObjectIds.length && typeof viewer.show !== 'function') throw fail('SDK_UNSUPPORTED');
        prepared = { fragments, manager, materials: new Map(), foreground: new Map(), clones: new Map() };
        const remember = item => {
          if (!item || prepared.materials.has(item)) return;
          if (!Number.isFinite(item.opacity) || item.opacity < 0 || item.opacity > 1 || typeof item.transparent !== 'boolean' || typeof item.depthWrite !== 'boolean' || item.originModelId !== undefined && item.originModelId !== model.id || item._sharedBy?.some(id => id !== model.id)) throw fail('SDK_UNSUPPORTED');
          prepared.materials.set(item, materialState(item));
          if (prepared.materials.size > APPEARANCE_LIMITS.materials) throw fail('SDK_UNSUPPORTED');
          for (const variant of item.variants ?? []) remember(variant);
        };
        // Read only current-model fragment materials. No geometry or full fragment copy is retained.
        for (let id = 0; id < count; id++) {
          current(); remember(fragments.getMaterial(id));
          if (id % 8192 === 0) await pause();
        }
        for (const objectId of pathObjectIds) tree.enumNodeFragments(objectId, id => {
          current();
          if (!Number.isSafeInteger(id) || id < 0 || id >= count) throw fail('SDK_UNSUPPORTED');
          const original = fragments.getMaterial(id); if (!original) throw fail('SDK_UNSUPPORTED');
          prepared.foreground.set(id, original);
          if (prepared.foreground.size > APPEARANCE_LIMITS.foregroundFragments) throw fail('SDK_UNSUPPORTED');
        }, true);
        for (const original of new Set(prepared.foreground.values())) {
          current(); const clone = manager.cloneMaterial(original, model);
          if (!clone || clone === original || typeof clone.dispose !== 'function') throw fail('SDK_UNSUPPORTED');
          prepared.clones.set(original, { clone, name: `${sceneName}-material-${++materialSerial}`, registered: false });
          applyMaterialState(clone, { opacity: 1, transparent: false, depthWrite: true });
        }
      }
      current(); await beforeCommit(); current();
      const rollback = new Map([...prepared.materials.keys()].map(item => [item, materialState(item)]));
      const rollbackView = { defaultVisible: model.visibilityManager.getDefaultVisibility(), states: model.visibilityManager.getVisibility().map(entry => [...entry]), preference: viewer.prefs?.get('ghosting'), pass: viewer.impl.showGhosting };
      try {
        if (!previous) {
          // Pinned SDK material changes require unconsolidation; Clear restores appearance, not this optimization.
          model.unconsolidate(); appearance = prepared;
          for (const entry of prepared.clones.values()) { entry.registered = true; managerAdd(prepared.manager, entry); }
          for (const [id, original] of prepared.foreground) prepared.fragments.setMaterial(id, prepared.clones.get(original).clone);
        }
        for (const item of prepared.materials.keys()) applyMaterialState(item, { opacity: (100 - percent) / 100, transparent: percent > 0, depthWrite: percent === 0 });
        // Explicit percentages use original coloured materials, never the black Ghost override shader.
        model.visibilityManager.setVisibility(ghost.visibility.defaultVisible, ghost.visibility.states);
        if (pathObjectIds.length) viewer.show(pathObjectIds, model);
        viewer.setGhosting(false); viewer.impl.toggleGhosting(false); viewer.impl.invalidate(true, true, true);
      } catch (error) {
        let restoreFailed = false;
        const attempt = work => { try { work(); } catch { restoreFailed = true; } };
        if (previous) for (const [item, state] of rollback) attempt(() => applyMaterialState(item, state));
        else attempt(restoreAppearance);
        attempt(() => model.visibilityManager.setVisibility(rollbackView.defaultVisible, rollbackView.states));
        if (typeof rollbackView.preference === 'boolean') attempt(() => viewer.setGhosting(rollbackView.preference));
        if (typeof rollbackView.pass === 'boolean') attempt(() => viewer.impl.toggleGhosting(rollbackView.pass));
        attempt(() => viewer.impl.invalidate(true, true, true));
        if (restoreFailed) { recoveryRequired = true; throw terminalOrAbort(error) ? error : restoreFailure(error); }
        throw error;
      }
    } catch (error) {
      if (prepared && prepared !== previous && prepared !== appearance && !releaseDetachedClones(prepared) && !terminalOrAbort(error)) throw restoreFailure(error);
      throw error;
    }
  }
  function managerAdd(manager, entry) {
    manager.addMaterial(entry.name, entry.clone, true);
    applyMaterialState(entry.clone, { opacity: 1, transparent: false, depthWrite: true });
  }
  async function inventory(operationSignal) {
    if (!inventoryPromise) inventoryPromise = (async () => {
      const tree = await callback((yes, no) => model.getObjectTree(yes, no), operationSignal, 45000);
      const ids = [tree.getRootId()], seen = new Set(ids);
      tree.enumNodeChildren(ids[0], id => { if (!seen.has(id)) { seen.add(id); ids.push(id); } return ids.length > 1000000; }, true);
      if (ids.length > 1000000 || !ids.every(id => Number.isSafeInteger(id) && id >= 0 && id <= 2147483647)) throw fail('EXTRACTION_FAILED');
      const names = [];
      for (let index = 0; index < ids.length; index++) {
        active(operationSignal);
        const name = tree.getNodeName(ids[index]) || '';
        if (typeof name !== 'string' || name.length > 2048 || /[\u0000-\u001f\u007f]/.test(name)) throw fail('EXTRACTION_FAILED');
        names.push(name);
        if (index % 8192 === 0) await pause();
      }
      const indexById = new Map(); for (let index = 0; index < ids.length; index++) indexById.set(ids[index], index);
      return { tree, ids, names, indexById };
    })().catch(error => { inventoryPromise = undefined; throw error; });
    return inventoryPromise;
  }
  async function externalIds(operationSignal) {
    if (!externalPromise) externalPromise = callback((yes, no) => model.getExternalIdMapping(yes, no), operationSignal, 45000).then(mapping => {
      const result = new Map();
      for (const [externalId, id] of Object.entries(mapping)) {
        if (externalId.length > 2048 || /[\u0000-\u001f\u007f]/.test(externalId)) continue;
        // Non-unique external identities remain unavailable instead of choosing the first.
        result.set(id, result.has(id) ? null : externalId);
      }
      return result;
    }).catch(error => { externalPromise = undefined; throw error; });
    return externalPromise;
  }
  async function readPreparationObjects(input, operationSignal) {
    if (!validatePreparationDiscoveryRequest(input)) throw fail('PREPARATION_SCOPE_INVALID');
    prepareForVisibilityObservation();
    const request = JSON.parse(JSON.stringify(input)), started = Date.now();
    const check = () => { active(operationSignal); if (viewer.model !== model) { preparationEquipment = undefined; throw fail('MODEL_SELECTION_CHANGED'); } if (Date.now() - started > 300000) throw fail('PREPARATION_DISCOVERY_DEADLINE'); };
    check(); const indexed = await inventory(operationSignal), { tree, ids, names } = indexed; check();
    if (request.cursor > ids.length) throw fail('PREPARATION_SCOPE_INVALID');
    const visibility = await captureDisplayVisibility(viewer, tree, ids, { check, pause, indexById: indexed.indexById });
    if (request.visibilityScope && !sameDisplayVisibility(request.visibilityScope, visibility.scope)) throw fail('PREPARATION_VISIBILITY_CHANGED');
    const indexById = indexed.indexById, matching = new Map(); let propertyScan = null, candidateIndices;
    const normalEquipment = value => String(value).normalize('NFC').trim().toUpperCase();
    if (request.mode === 'subtree' || request.mode === 'subtrees' || request.mode === 'ancestors') {
      const roots = request.mode === 'subtrees' ? request.rootObjectIds : [request.rootObjectId];
      if (!roots.every(id => indexById.has(id))) throw fail('PREPARATION_SCOPE_INVALID');
      const queryKey = JSON.stringify([request.mode, roots]);
      if (preparationSubtree?.queryKey !== queryKey) {
        const selected = new Set();
        for (const root of roots) {
          check(); selected.add(root);
          if (request.mode !== 'ancestors') tree.enumNodeChildren(root, id => { check(); if (!indexById.has(id)) throw fail('EXTRACTION_FAILED'); selected.add(id); return false; }, true);
          let id = root, depth = 0; const seen = new Set();
          while (id !== ids[0]) {
            if (++depth > PREPARATION_VIEWER_LIMITS.depth || seen.has(id)) throw fail('EXTRACTION_FAILED'); seen.add(id);
            const parent = tree.getNodeParentId(id); if (!indexById.has(parent) || parent === id) throw fail('EXTRACTION_FAILED'); selected.add(parent); id = parent;
          }
        }
        preparationSubtree = { queryKey, indices:[...selected].map(id => indexById.get(id)).sort((a,b) => a-b) };
      }
      candidateIndices = preparationSubtree.indices;
    } else if (request.mode === 'equipment') {
      // Retain matching postings only for this bounded project name universe.
      // Small query pages still echo/filter only their own names, and reobserve
      // live visibility before returning any cached property candidates.
      const indexNames = request.indexNames ?? request.names;
      const queryKey = JSON.stringify(indexNames.map(normalEquipment));
      if (!preparationEquipment || preparationEquipment.queryKey !== queryKey) {
        const state = { promise:null, queryKey }; preparationEquipment = state;
        state.promise = (async () => {
          const values = new Map(), requested = new Set(indexNames.map(normalEquipment)), returned = new Uint8Array(ids.length);
          let returnedCount = 0, accountedBytes = returned.byteLength, postings = 0, scannedProperties = 0;
          const charge = bytes => { accountedBytes += bytes; if (accountedBytes > EQUIPMENT_INDEX_LIMITS.bytes) throw fail('PREPARATION_EQUIPMENT_INDEX_LIMIT'); };
          const indexValue = (raw, id, seen) => {
            const text = String(raw ?? '');
            for (const key of modelEquipmentMatchKeys(text)) {
              if (!requested.has(key) || seen.has(key)) continue;
              if (text.length > EQUIPMENT_INDEX_LIMITS.valueCharacters) throw fail('PREPARATION_EQUIPMENT_ROW_LIMIT');
              seen.add(key);
              let matches = values.get(key);
              if (!matches) {
                if (values.size >= EQUIPMENT_INDEX_LIMITS.keys) throw fail('PREPARATION_EQUIPMENT_INDEX_LIMIT');
                charge(192 + key.length * 2); matches = []; values.set(key, matches);
              }
              if (++postings > EQUIPMENT_INDEX_LIMITS.postings) throw fail('PREPARATION_EQUIPMENT_INDEX_LIMIT');
              charge(16); matches.push(id);
            }
          };
          for (let start = 0; start < ids.length; start += 512) {
            check(); const batch = ids.slice(start, start + 512), allowed = new Set(batch);
            const rows = await callback((yes, no) => model.getBulkProperties(batch, { ignoreHidden:false, needsExternalId:false }, yes, no), operationSignal, 45000,
              { timeout:'PREPARATION_EQUIPMENT_PROPERTIES_TIMEOUT', failed:'PREPARATION_EQUIPMENT_PROPERTIES_FAILED' }); check();
            if (!Array.isArray(rows) || rows.length > batch.length) throw fail('PREPARATION_EQUIPMENT_PROPERTIES_INVALID');
            for (const row of rows) {
              if (!row || !allowed.has(row.dbId) || returned[indexById.get(row.dbId)] || !Array.isArray(row.properties)) throw fail('PREPARATION_EQUIPMENT_PROPERTIES_INVALID');
              if (row.properties.length > EQUIPMENT_INDEX_LIMITS.rawPropertiesPerRow) throw fail('PREPARATION_EQUIPMENT_ROW_LIMIT');
              scannedProperties += row.properties.length;
              if (scannedProperties > EQUIPMENT_INDEX_LIMITS.scannedProperties) throw fail('PREPARATION_EQUIPMENT_SCAN_LIMIT');
              returned[indexById.get(row.dbId)] = 1; returnedCount++;
              const seen = new Set(); indexValue(names[indexById.get(row.dbId)], row.dbId, seen);
              const humanValues = humanScalarPropertyValues(row.properties);
              if (humanValues.length > EQUIPMENT_INDEX_LIMITS.eligiblePropertiesPerRow) throw fail('PREPARATION_EQUIPMENT_ROW_LIMIT');
              for (const value of humanValues) indexValue(value, row.dbId, seen);
            }
            await pause();
          }
          check();
          return { values, propertyScan:{ attemptedObjectCount:ids.length, returnedObjectCount:returnedCount, omittedObjectCount:ids.length-returnedCount, complete:returnedCount===ids.length } };
        })().catch(error => { if (preparationEquipment === state) preparationEquipment = undefined; throw error; });
      }
      const data = await preparationEquipment.promise; check(); propertyScan = data.propertyScan;
      for (const name of request.names) for (const id of data.values.get(normalEquipment(name)) ?? []) {
        const matched = matching.get(id) ?? []; matched.push(name); matching.set(id, matched);
      }
      candidateIndices = [...matching.keys()].map(id => indexById.get(id)).sort((a,b)=>a-b);
    }
    const result = { schemaVersion:'wfc.pf.viewer-discovery.v1', mode:request.mode, names:request.names, rootObjectId:request.rootObjectId, cursor:request.cursor, matchingPolicyVersion:PREPARATION_MATCHING_POLICY, visibilityScope:visibility.scope, indexedObjectCount:ids.length, propertyScan, objects:[], nextCursor:null, complete:true, ...(request.mode === 'subtrees' ? {rootObjectIds:[...request.rootObjectIds]} : {}), ...(request.includeAnchors ? {includeAnchors:true} : {}) };
    // An explicit location search observes approximate display bounds only.
    // It never creates an object-derived/native geometry qualification.
    const coordinates = request.includeAnchors ? modelCoordinates(model) : null;
    const observedAnchor = id => {
      let count = 0;
      try {
        const box = new THREE.Box3(), fragments = model.getFragmentList();
        tree.enumNodeFragments(id, fragment => {
          check(); if (++count > 8192) return true;
          const part = new THREE.Box3(); fragments.getWorldBounds(fragment, part); box.union(part);
        }, true);
        if (count > 8192 || box.isEmpty()) return {bounds:null,bottomCentre:null};
        const bounds = {minimum:coordinates.toCanonical(box.min),maximum:coordinates.toCanonical(box.max)};
        if (!bounds.minimum.every((n,i)=>Number.isFinite(n)&&Number.isFinite(bounds.maximum[i])&&Math.abs(n)<=1e9&&Math.abs(bounds.maximum[i])<=1e9&&n<=bounds.maximum[i])
          || !bounds.minimum.some((n,i)=>n<bounds.maximum[i])) return {bounds:null,bottomCentre:null};
        return {bounds,bottomCentre:[(bounds.minimum[0]+bounds.maximum[0])/2,(bounds.minimum[1]+bounds.maximum[1])/2,bounds.minimum[2]]};
      } catch (error) { if (terminalOrAbort(error) || error?.code === 'PREPARATION_DISCOVERY_DEADLINE') throw error; return {bounds:null,bottomCentre:null}; }
    };
    let cursor = request.cursor;
    function* candidates() {
      if (candidateIndices) {
        let low = 0, high = candidateIndices.length;
        while (low < high) { const middle = Math.floor((low+high)/2); if (candidateIndices[middle] < request.cursor) low = middle+1; else high = middle; }
        for (let index=low;index<candidateIndices.length;index++) yield candidateIndices[index];
      } else for (let index=request.cursor;index<ids.length;index++) yield index;
    }
    const iterator = candidates();
    const exactNames = new Set(request.names);
    let finished = true;
    for (let next=iterator.next();!next.done;next=iterator.next()) {
      const index = next.value;
      cursor = index; check(); const id = ids[cursor];
      let matchedNames = [];
      if (request.mode === 'equipment') matchedNames = matching.get(id) ?? [];
      else if (request.mode === 'names') { const normalized = names[cursor].normalize('NFC').trim(); if (exactNames.has(normalized)) matchedNames = [normalized]; }
      if (request.mode === 'names' && matchedNames.length === 0) { if (cursor % 8192 === 0) await pause(); continue; }
      const eligible = request.mode !== 'equipment' || visibility.equipmentEligibility(id);
      // The independent assignment report retains ineligible exact matches as
      // unavailable, so a hidden duplicate cannot silently become a unique hit.
      // Existing preparation discovery keeps its original visible-only policy.
      if (!eligible && !request.includeAnchors) continue;
      let hasGeometry = false; tree.enumNodeFragments(id, () => { hasGeometry = true; }, false);
      const parent = id === ids[0] ? null : tree.getNodeParentId(id);
      if (parent !== null && (!indexById.has(parent) || parent === id)) throw fail('EXTRACTION_FAILED');
      const object = { objectId:id, parentId:parent, name:names[cursor], hasGeometry, isPhysicalLeaf:hasGeometry && tree.getChildCount(id) === 0, orderIndex:cursor, matchedNames, ...(request.includeAnchors ? eligible ? observedAnchor(id) : {bounds:null,bottomCentre:null} : {}) };
      const candidate = { ...result, objects:[...result.objects, object], nextCursor:cursor+1, complete:false };
      if (new TextEncoder().encode(JSON.stringify(candidate)).length > PREPARATION_VIEWER_LIMITS.pageBytes) { if (!result.objects.length) throw fail('PREPARATION_PAGE_TOO_LARGE'); finished = false; break; }
      result.objects.push(object); if (result.objects.length >= request.limit) { cursor++; finished = iterator.next().done === true; break; }
    }
    result.nextCursor = finished ? null : cursor; result.complete = result.nextCursor === null;
    check(); const finalVisibility = await visibility.refresh();
    if (!sameDisplayVisibility(visibility.scope, finalVisibility.scope)) throw fail('PREPARATION_VISIBILITY_CHANGED');
    if (!validatePreparationDiscoveryPage(result)) throw fail('PREPARATION_DISCOVERY_RESULT_INVALID'); return result;
  }
  async function readObjects({ cursor, limit, query }, operationSignal, selectedIds) {
    active(operationSignal);
    const coordinates = modelCoordinates(model), indexed = await inventory(operationSignal), tree = indexed.tree, ids = selectedIds ?? indexed.ids, names = selectedIds ? selectedIds.map(id => tree.getNodeName(id) ?? '') : indexed.names, external = await externalIds(operationSignal);
    if (cursor > ids.length) throw fail('EXTRACTION_FAILED');
    const objects = [], search = query.normalize('NFC').trim().toUpperCase();
    let index = cursor;
    for (; index < ids.length; index++) {
      active(operationSignal);
      if (search && !names[index].normalize('NFC').toUpperCase().includes(search)) { if (index % 8192 === 0) await pause(); continue; }
      const id = ids[index], box = new THREE.Box3(), fragments = model.getFragmentList();
      let fragmentCount = 0;
      tree.enumNodeFragments(id, fragmentId => {
        if (++fragmentCount > 8192) return true;
        const fragmentBounds = new THREE.Box3(); fragments.getWorldBounds(fragmentId, fragmentBounds); box.union(fragmentBounds);
      }, true);
      const objectBounds = fragmentCount > 8192 || box.isEmpty() ? null : { minimum: coordinates.toCanonical(box.min), maximum: coordinates.toCanonical(box.max) };
      const raw = await callback((yes, no) => model.getProperties(id, yes, no), operationSignal);
      const properties = [], rawProperties = Array.isArray(raw?.properties) ? raw.properties : [];
      let propertiesTruncated = false;
      for (const property of rawProperties) {
        const name = property?.displayName, value = String(property?.displayValue ?? '');
        if (properties.length === 8 || typeof name !== 'string' || name.length > 256 || value.length > 768 || /[\u0000-\u001f\u007f]/.test(name + value)) { propertiesTruncated = true; continue; }
        properties.push({ name, value });
      }
      const parentId = tree.getNodeParentId(id);
      const object = { objectId: id, parentId: positiveId(parentId) ? parentId : null, name: names[index], externalId: external.get(id) ?? null, bounds: objectBounds,
        bottomCentre: objectBounds ? [(objectBounds.minimum[0] + objectBounds.maximum[0]) / 2, (objectBounds.minimum[1] + objectBounds.maximum[1]) / 2, objectBounds.minimum[2]] : null,
        derivation: 'display-aabb-bottom-centre', nativeVisibility: 'unknown', properties, propertiesTruncated };
      // Leave room for the complete identity envelope, even with long Unicode properties.
      if (new TextEncoder().encode(JSON.stringify([...objects, object])).byteLength > 48000) { if (!objects.length) throw fail('EXTRACTION_FAILED'); break; }
      objects.push(object);
      if (objects.length >= limit) { index++; break; }
    }
    active(operationSignal);
    return { cursor, nextCursor: index >= ids.length ? null : index, complete: index >= ids.length, query, coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: coordinates.scale, globalOffsetMetres: coordinates.globalOffsetMetres, objects };
  }
  function selectionIds() {
    active();
    const aggregate = viewer.getAggregateSelection?.();
    if (aggregate && (!Array.isArray(aggregate) || aggregate.some(entry => entry.model !== model && entry.selection?.length))) throw fail('EXTRACTION_FAILED');
    const ids = aggregate ? aggregate.flatMap(entry => entry.model === model ? entry.selection : []) : viewer.getSelection?.();
    if (!Array.isArray(ids) || !ids.every(positiveId) || new Set(ids).size !== ids.length) throw fail('EXTRACTION_FAILED');
    if (ids.length > 16) throw fail('SELECTION_TOO_LARGE');
    return [...ids];
  }
  async function readSelection(operationSignal) {
    const ids = selectionIds(), indexed = await inventory(operationSignal);
    if (ids.some(id => !indexed.ids.includes(id))) throw fail('EXTRACTION_FAILED');
    const page = await readObjects({ cursor: 0, limit: 16, query: '' }, operationSignal, ids);
    active(operationSignal);
    if (!page.complete || JSON.stringify(selectionIds()) !== JSON.stringify(ids)) throw fail('EXTRACTION_FAILED');
    return { coordinateFrame: page.coordinateFrame, metresPerDisplayUnit: page.metresPerDisplayUnit, globalOffsetMetres: page.globalOffsetMetres, objects: page.objects };
  }
  function trayRootSelectionIds(operationSignal) {
    active(operationSignal);
    if (viewer.model !== model) throw fail('MODEL_SELECTION_CHANGED');
    try {
      const aggregate = viewer.getAggregateSelection?.();
      if (aggregate !== undefined && (!Array.isArray(aggregate) || aggregate.some(entry => !entry || !Array.isArray(entry.selection)
        || entry.model !== model && entry.selection.length > 0))) throw fail('TRAY_ROOT_SELECTION_UNAVAILABLE');
      const ids = aggregate === undefined ? viewer.getSelection?.() : aggregate.flatMap(entry => entry.model === model ? entry.selection : []);
      if (!Array.isArray(ids) || !ids.every(positiveId) || new Set(ids).size !== ids.length) throw fail('TRAY_ROOT_SELECTION_UNAVAILABLE');
      if (ids.length > 512) throw fail('TRAY_ROOT_SELECTION_TOO_LARGE');
      return [...ids];
    } catch (error) {
      if (terminalOrAbort(error) || error?.code === 'TRAY_ROOT_SELECTION_TOO_LARGE') throw error;
      throw fail('TRAY_ROOT_SELECTION_UNAVAILABLE');
    }
  }
  async function readTrayRootSelection(operationSignal, beforeCommit = async () => {}) {
    const ids = trayRootSelectionIds(operationSignal);
    // The pinned SDK exposes constant-time membership on its already loaded
    // tree. Root selection must never build inventory or read physical bounds.
    let tree;
    if (ids.length) {
      try { tree = model.getInstanceTree?.() ?? await callback((yes, no) => model.getObjectTree(yes, no), operationSignal, 10000); }
      catch (error) { if (terminalOrAbort(error)) throw error; throw fail('TRAY_ROOT_SELECTION_UNAVAILABLE'); }
    }
    active(operationSignal);
    if (viewer.model !== model) throw fail('MODEL_SELECTION_CHANGED');
    try {
      if (ids.length && (typeof tree?.getNodeIndex !== 'function' || ids.some(id => {
        const index = tree.getNodeIndex(id); return !Number.isSafeInteger(index) || index < 0;
      }))) throw fail('TRAY_ROOT_SELECTION_UNAVAILABLE');
    } catch (error) { if (terminalOrAbort(error)) throw error; throw fail('TRAY_ROOT_SELECTION_UNAVAILABLE'); }
    await beforeCommit();
    if (JSON.stringify(trayRootSelectionIds(operationSignal)) !== JSON.stringify(ids)) throw fail('TRAY_ROOT_SELECTION_CHANGED');
    return { objects: ids.map(objectId => ({ objectId })) };
  }
  function pickPoint(operationSignal) {
    active(operationSignal); pick?.cancel();
    const coordinates = modelCoordinates(model), canvas = viewer.canvas;
    if (!canvas || typeof viewer.hitTest !== 'function') throw fail('PICK_UNAVAILABLE');
    return new Promise((resolve, reject) => {
      let start;
      const finish = (error, result) => {
        if (pick?.finish !== finish) return;
        pick = undefined; clearTimeout(timer);
        canvas.removeEventListener('pointerdown', down, true); canvas.removeEventListener('click', click, true);
        signal?.removeEventListener('abort', abort); operationSignal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve(result);
      };
      const abort = () => finish(abortError());
      const down = event => { start = event.button === 0 ? [event.clientX, event.clientY] : undefined; };
      const click = event => {
        if (event.button !== 0 || !start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 5) return;
        try {
          active(operationSignal);
          const rectangle = canvas.getBoundingClientRect(), hit = viewer.hitTest(event.clientX - rectangle.left, event.clientY - rectangle.top, false);
          if (!hit || hit.model !== model || !positiveId(hit.dbId)) return;
          const point = coordinates.toCanonical(hit.intersectPoint ?? hit.point);
          event.preventDefault(); event.stopImmediatePropagation();
          finish(null, { objectId: hit.dbId, point, derivation: 'picked-surface-point' });
        } catch (error) { finish(error); }
      };
      const timer = setTimeout(() => finish(fail('PICK_TIMEOUT')), 120000);
      pick = { finish, cancel: abort };
      canvas.addEventListener('pointerdown', down, true); canvas.addEventListener('click', click, true);
      signal?.addEventListener('abort', abort, { once: true }); operationSignal?.addEventListener('abort', abort, { once: true });
    });
  }
  return { showPath, fit, clear, prepareForVisibilityObservation, readObjects, readPreparationObjects, readSelection, readTrayRootSelection, setTransparency, pickPoint, dispose() { if (disposed) return; pick?.cancel(); try { clear(); } catch (error) { if (error?.code !== 'APPEARANCE_RESTORE_FAILED') throw error; /* The adapter still finishes the SDK viewer; attached materials remain owned by that SDK teardown. */ } finally { disposed = true; inventoryPromise = externalPromise = preparationEquipment = preparationSubtree = undefined; } } };
}
