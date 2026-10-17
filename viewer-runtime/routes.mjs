import { profileGeometry, buildRouteLines } from './route-geometry.mjs';

export function normalizeIdentifier(value) {
  return String(value).normalize('NFKC').trim().replace(/^\/+|\/+$/g, '').toUpperCase();
}

export function parseRoute(text) {
  if (typeof text !== 'string' || text.length > 8000) throw new Error('Маршрутът е твърде дълъг. Въведи до 100 участъка.');
  const tokens = text.split('/').map(part => part.trim()).filter(Boolean).filter(part => normalizeIdentifier(part) !== 'SECONDARY');
  if (!tokens.length) throw new Error('Въведи означенията на трасетата, разделени с /.');
  if (tokens.length > 100) throw new Error('Въведи до 100 участъка в един маршрут.');
  return tokens;
}

const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0));

export function createRouteController(viewer, { signal } = {}) {
  const THREE = window.THREE;
  const model = viewer.model;
  const sceneName = 'aalborg-route-line';
  let nameIndex;
  let indexPromise;
  let routeIds = [];
  let overlayMeshes = [];
  let overlayResources = [];
  let disposed = false;
  let generation = 0;
  const profileCache = new Map();
  let ghostState;

  function captureGhostState() {
    if (!ghostState) ghostState = { preference: viewer.prefs?.get('ghosting'), renderPass: viewer.impl.showGhosting, materials: new Map() };
    const materials = [viewer.impl.fadeMaterial, ...(viewer.impl.fadeMaterial?.variants || [])].filter(Boolean);
    for (const material of materials) if (!ghostState.materials.has(material)) ghostState.materials.set(material, material.opacity);
  }

  function enableGhostContext() {
    captureGhostState();
    viewer.setGhosting(true);
    captureGhostState();
    // The adapter pins WebGL for filled Ghost surfaces. Match the proof of
    // concept's opacity without making dense overlapping geometry too dark.
    for (const material of ghostState.materials.keys()) material.opacity = 0.025;
    // setGhosting writes a preference and may be a no-op when it is already true.
    // Enforce this viewer's actual hidden-object render pass after isolation too.
    viewer.impl.toggleGhosting(true);
  }

  function restoreGhostContext() {
    if (!ghostState) return;
    const previous = ghostState; ghostState = undefined;
    for (const [material, opacity] of previous.materials) material.opacity = opacity;
    if (typeof previous.preference === 'boolean') viewer.setGhosting(previous.preference);
    if (typeof previous.renderPass === 'boolean') viewer.impl.toggleGhosting(previous.renderPass);
  }

  function active(ticket) {
    if (disposed || signal?.aborted || (ticket !== undefined && ticket !== generation)) throw new DOMException('Операцията е прекратена.', 'AbortError');
  }

  async function getTree() {
    active();
    const existing = model.getInstanceTree();
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, tree) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve(tree);
      };
      const abort = () => finish(new DOMException('Операцията е прекратена.', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('Свойствата на модела не се заредиха. Опитай отново.')), 45000);
      signal?.addEventListener('abort', abort, { once: true });
      model.getObjectTree(tree => { try { active(); finish(null, tree); } catch (error) { finish(error); } }, () => finish(new Error('Локалните означения на трасетата не могат да се прочетат.')));
    });
  }

  async function indexNames(onProgress) {
    if (nameIndex) return nameIndex;
    if (!indexPromise) indexPromise = (async () => {
      onProgress?.({ loaded: 0, total: null });
      await nextFrame();
      const tree = await getTree();
      const index = new Map();
      const nodes = [tree.getRootId()];
      tree.enumNodeChildren(tree.getRootId(), id => { nodes.push(id); }, true);
      const add = id => {
        const key = normalizeIdentifier(tree.getNodeName(id) || '');
        if (!key) return;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(id);
      };
      for (let i = 0; i < nodes.length; i++) {
        active();
        add(nodes[i]);
        if ((i + 1) % 4096 === 0) { onProgress?.({ loaded: i + 1, total: nodes.length }); await nextFrame(); }
      }
      active();
      onProgress?.({ loaded: nodes.length, total: nodes.length });
      nameIndex = index;
      return index;
    })().catch(error => { indexPromise = null; throw error; });
    return indexPromise;
  }

  function collectProfiles(tree, groupId) {
    const nodes = [];
    // A truthy callback return stops Autodesk's tree traversal.
    tree.enumNodeChildren(groupId, id => { nodes.push(id); return nodes.length > 1024; }, true);
    if (nodes.length > 1024) throw new Error('Означението обхваща твърде голяма част от модела. Въведи имената на отделните трасета.');
    const fragments = model.getFragmentList();
    const profiles = [];
    for (const id of nodes) {
      const fragIds = [];
      tree.enumNodeFragments(id, fragId => { fragIds.push(fragId); }, false);
      if (!fragIds.length) continue;
      if (profileCache.has(id)) { profiles.push(profileCache.get(id)); continue; }
      const points = [];
      const seen = new Set();
      const matrix = new THREE.Matrix4();
      for (const fragId of fragIds) {
        const geometry = fragments.getGeometry(fragId);
        if (!geometry) continue;
        fragments.getWorldMatrix(fragId, matrix);
        Autodesk.Viewing.Private.enumMeshVertices(geometry, vertex => {
          if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) return;
          const key = `${vertex.x.toFixed(5)},${vertex.y.toFixed(5)},${vertex.z.toFixed(5)}`;
          if (!seen.has(key)) { seen.add(key); points.push([vertex.x, vertex.y, vertex.z]); }
        }, matrix);
      }
      if (points.length < 2) continue;
      if (profiles.length >= 128) throw new Error('Този участък съдържа твърде много части. Раздели маршрута на по-малки участъци.');
      const profile = profileGeometry(points, { id, name: tree.getNodeName(id) || '' });
      profileCache.set(id, profile);
      profiles.push(profile);
    }
    return profiles;
  }

  function removeOverlay() {
    for (const mesh of overlayMeshes) viewer.overlays.removeMesh(mesh, sceneName);
    overlayMeshes = [];
    for (const resource of overlayResources) resource.dispose();
    overlayResources = [];
    viewer.overlays.removeScene(sceneName);
  }

  function drawLines(polylines, profiles) {
    removeOverlay();
    if (!polylines.length) return;
    viewer.overlays.addScene(sceneName);
    const widths = profiles.map(profile => profile.width).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    const radius = (widths[Math.floor(widths.length / 2)] || 0.3) * 0.055;
    const material = new THREE.MeshBasicMaterial({ color: 0xffe600, depthTest: false, depthWrite: false });
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
    const sphere = new THREE.SphereGeometry(1, 8, 6);
    overlayResources = [material, cylinder, sphere];
    const up = new THREE.Vector3(0, 1, 0);
    const add = mesh => { mesh.renderOrder = 1000; overlayMeshes.push(mesh); viewer.overlays.addMesh(mesh, sceneName); };
    for (const polyline of polylines) {
      for (let i = 0; i < polyline.length; i++) {
        const current = new THREE.Vector3(...polyline[i]);
        if (i) {
          const previous = new THREE.Vector3(...polyline[i - 1]);
          const direction = current.clone().sub(previous);
          const length = direction.length();
          if (length > 1e-7) {
            const mesh = new THREE.Mesh(cylinder, material);
            mesh.position.copy(current).add(previous).multiplyScalar(0.5);
            mesh.scale.set(radius, length, radius);
            mesh.quaternion.setFromUnitVectors(up, direction.multiplyScalar(1 / length));
            add(mesh);
          }
        }
        const joint = new THREE.Mesh(sphere, material);
        joint.position.copy(current);
        joint.scale.set(radius, radius, radius);
        add(joint);
      }
    }
    viewer.impl.invalidate(true, true, true);
  }

  function clearRoute() {
    generation++;
    removeOverlay();
    viewer.isolate([], model);
    restoreGhostContext();
    viewer.clearSelection();
    routeIds = [];
    viewer.fitToView();
    viewer.impl.invalidate(true, true, true);
  }

  async function showRoute(text, { onProgress } = {}) {
    const tokens = parseRoute(text);
    const ticket = ++generation;
    const index = await indexNames(onProgress);
    const tree = await getTree();
    active(ticket);
    const segments = tokens.map(token => {
      const ids = index.get(normalizeIdentifier(token)) || [];
      return { token, ids, count: ids.length, status: ids.length === 1 ? 'found' : ids.length ? 'ambiguous' : 'missing' };
    });
    const found = segments.filter(segment => segment.status === 'found');
    if (!found.length) return { segments: segments.map(segment => ({ ...segment, drawable: false })), matchedCount: 0, drawableCount: 0, lineCount: 0, warnings: [], diagnostics: { connectors: [] } };
    const groups = [];
    for (let i = 0; i < segments.length; i++) {
      active(ticket);
      const segment = segments[i];
      onProgress?.(`Проследяване на трасетата… ${i + 1}/${segments.length}`);
      // Unresolved names stay in the result list; the line joins known parts.
      groups.push({ token: segment.token, profiles: segment.status === 'found' ? collectProfiles(tree, segment.ids[0]) : [] });
      await nextFrame();
    }
    const line = buildRouteLines(groups);
    active(ticket);
    const ids = [...new Set(found.map(segment => segment.ids[0]))];
    viewer.clearSelection();
    captureGhostState();
    viewer.isolate(ids, model);
    enableGhostContext();
    drawLines(line.polylines, groups.flatMap(group => group.profiles));
    routeIds = ids;
    viewer.fitToView(ids, model);
    const warnings = [...line.warnings];
    if (segments.some(segment => segment.status !== 'found')) warnings.unshift('Ненамерените или нееднозначните означения се пропускат. Линията свързва намерените участъци в зададения ред.');
    return { segments: segments.map((segment, index) => ({ ...segment, drawable: groups[index].profiles.length > 0 })), matchedCount: found.length, drawableCount: groups.filter(group => group.profiles.length).length, lineCount: line.polylines.length, warnings, diagnostics: line.diagnostics };
  }

  function fitRoute() { if (routeIds.length) viewer.fitToView(routeIds, model); }
  function dispose() {
    if (disposed) return;
    disposed = true; generation++; removeOverlay();
    if (ghostState) viewer.isolate([], model);
    restoreGhostContext();
    routeIds = []; profileCache.clear(); nameIndex = null;
  }
  return { prepareIndex: indexNames, showRoute, clearRoute, fitRoute, dispose };
}
