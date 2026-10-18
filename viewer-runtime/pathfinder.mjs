import { isCanonicalPoint } from './protocol.mjs';

const fail = code => Object.assign(new Error('The requested PathFinder viewer operation could not be completed.'), { code });
const abortError = () => new DOMException('Operation cancelled.', 'AbortError');
const positiveId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const displayPoint = value => Array.isArray(value) && value.length === 3 && value.every(item => Number.isFinite(item) && Math.abs(item) <= 1e12);
const TUBE_SIDES = 8, SEGMENTS_PER_MESH = 2000, TUBE_VERTICES = TUBE_SIDES * 2 + 2;

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
  let disposed = false, overlays = [], geometries = [], material, ghost, bounds, pick, inventoryPromise, externalPromise, fadeOpacity = 0.025;
  const active = operationSignal => { if (disposed || signal?.aborted || operationSignal?.aborted) throw abortError(); };
  function callback(work, operationSignal, timeout = 15000) {
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
      const timer = setTimeout(() => finish(fail('EXTRACTION_FAILED')), timeout);
      signal?.addEventListener('abort', abort, { once: true }); operationSignal?.addEventListener('abort', abort, { once: true });
      try { work(value => finish(null, value), () => finish(fail('EXTRACTION_FAILED'))); } catch (error) { finish(error); }
    });
  }
  function captureGhost() {
    if (!ghost) {
      const visibility = model.visibilityManager;
      ghost = { preference: viewer.prefs?.get('ghosting'), pass: viewer.impl.showGhosting, materials: new Map(),
        visibility: typeof visibility?.getDefaultVisibility === 'function' && typeof visibility?.getVisibility === 'function' && typeof visibility?.setVisibility === 'function'
          ? { defaultVisible: visibility.getDefaultVisibility(), states: visibility.getVisibility().map(entry => [...entry]) } : null };
    }
    for (const item of [viewer.impl.fadeMaterial, ...(viewer.impl.fadeMaterial?.variants ?? [])].filter(Boolean)) {
      if (!ghost.materials.has(item)) ghost.materials.set(item, item.opacity);
      item.opacity = fadeOpacity;
    }
  }
  function clear() {
    for (const overlay of overlays) viewer.overlays.removeMesh(overlay, sceneName);
    for (const geometry of geometries) geometry.dispose(); if (material) material.dispose();
    if (overlays.length) viewer.overlays.removeScene(sceneName);
    overlays = []; geometries = []; material = bounds = undefined;
    if (ghost) {
      const prior = ghost; ghost = undefined;
      if (prior.visibility) model.visibilityManager.setVisibility(prior.visibility.defaultVisible, prior.visibility.states);
      else viewer.isolate([], model);
      for (const [item, opacity] of prior.materials) item.opacity = opacity;
      if (typeof prior.preference === 'boolean') viewer.setGhosting(prior.preference);
      if (typeof prior.pass === 'boolean') viewer.impl.toggleGhosting(prior.pass);
      viewer.clearSelection(); viewer.impl.invalidate(true, true, true);
    }
  }
  function showPath({ points, objectIds }) {
    active();
    const coordinates = modelCoordinates(model);
    const local = points.map(point => coordinates.toDisplay(point));
    if (local.length < 1 || local.length > 20000 || !Array.isArray(objectIds) || objectIds.length > 512 || !objectIds.every(positiveId)) throw fail('PATH_INVALID');
    if (!objectIds.length && (typeof model.visibilityManager?.setAllVisibility !== 'function' || typeof model.visibilityManager?.getVisibility !== 'function' || typeof model.visibilityManager?.getDefaultVisibility !== 'function' || typeof model.visibilityManager?.setVisibility !== 'function')) throw fail('SDK_UNSUPPORTED');
    const tubes = createExactPathBatches(local, 0.02 / coordinates.scale);
    clear();
    bounds = new THREE.Box3();
    for (const point of local) bounds.expandByPoint(new THREE.Vector3(...point));
    material = new THREE.MeshBasicMaterial({ color: 0xffe600, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    viewer.overlays.addScene(sceneName);
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
  function setTransparency(percent) {
    active();
    if (!ghost || !bounds || !Number.isSafeInteger(percent) || percent < 0 || percent > 100) throw fail('PATH_INVALID');
    fadeOpacity = (100 - percent) / 100; captureGhost(); viewer.impl.invalidate(true, true, true);
  }
  async function inventory(operationSignal) {
    if (!inventoryPromise) inventoryPromise = (async () => {
      const tree = await callback((yes, no) => model.getObjectTree(yes, no), operationSignal, 45000);
      const ids = [tree.getRootId()], seen = new Set(ids);
      tree.enumNodeChildren(ids[0], id => { if (!seen.has(id)) { seen.add(id); ids.push(id); } return ids.length > 1000000; }, true);
      if (ids.length > 1000000 || !ids.every(positiveId)) throw fail('EXTRACTION_FAILED');
      const names = [];
      for (let index = 0; index < ids.length; index++) {
        active(operationSignal);
        const name = tree.getNodeName(ids[index]) || '';
        if (typeof name !== 'string' || name.length > 2048 || /[\u0000-\u001f\u007f]/.test(name)) throw fail('EXTRACTION_FAILED');
        names.push(name);
        if (index % 8192 === 0) await pause();
      }
      return { tree, ids, names };
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
  return { showPath, fit, clear, readObjects, readSelection, setTransparency, pickPoint, dispose() { if (disposed) return; pick?.cancel(); clear(); disposed = true; inventoryPromise = externalPromise = undefined; } };
}
