import { isCanonicalPoint } from './protocol.mjs';
import { modelCoordinates } from './pathfinder.mjs';

const unavailable = () => Object.assign(new Error('The saved project point could not be shown.'), { code: 'LOCATION_UNAVAILABLE' });

/** A presentation marker owns no model identity, route or visibility state. */
export function createLocationPointController(viewer, { window, signal } = {}) {
  const model = viewer.model, scene = 'wfc-location-point';
  let marker, sceneActive = false, disposed = false;
  const current = () => {
    if (disposed || signal?.aborted) throw new DOMException('Location display cancelled.', 'AbortError');
    if (viewer.model !== model) throw Object.assign(unavailable(), { code: 'MODEL_SELECTION_CHANGED' });
  };
  function clear() {
    if (marker) {
      viewer.overlays.removeMesh(marker, scene);
      marker.geometry.dispose(); marker.material.dispose(); marker = undefined;
    }
    if (sceneActive) { viewer.overlays.removeScene(scene); sceneActive = false; }
  }
  return {
    clear,
    show(point) {
      current();
      if (!isCanonicalPoint(point)) throw unavailable();
      const coordinates = modelCoordinates(model), local = coordinates.toDisplay(point), THREE = window?.THREE;
      if (!THREE || typeof viewer.navigation?.fitBounds !== 'function') throw unavailable();
      // Keep enough surrounding context visible, independent of the model's units.
      const bounds = new THREE.Box3(), margin = 0.75 / coordinates.scale;
      for (const sign of [-1, 1]) bounds.expandByPoint(new THREE.Vector3(...local.map(n => n + sign * margin)));
      const geometry = new THREE.SphereGeometry(0.08 / coordinates.scale, 12, 8);
      const material = new THREE.MeshBasicMaterial({ color: 0x35a7ff, depthTest: false, depthWrite: false });
      const next = new THREE.Mesh(geometry, material);
      next.position.set(...local); next.renderOrder = 1001; next.frustumCulled = false;
      try {
        current(); clear();
        viewer.overlays.addScene(scene); sceneActive = true;
        marker = next; viewer.overlays.addMesh(marker, scene);
        viewer.navigation.fitBounds(false, bounds);
        viewer.impl.invalidate(true, true, true);
      } catch (error) {
        if (marker === next) clear(); else { geometry.dispose(); material.dispose(); }
        throw error;
      }
    },
    dispose() { if (disposed) return; disposed = true; clear(); },
  };
}
