import { modelCoordinates } from './pathfinder.mjs';

/**
 * Dynamic Scene API model layered over the currently loaded client SVF.
 * Input mesh coordinates are local CAD millimetres; input translation is
 * canonical world millimetres (Z-up). Nothing mutates the original SVF model.
 */
export function createCadSceneController(viewer, { window, sourceModel }) {
  const av = window.Autodesk.Viewing;
  const scene = av.Scene;
  const math = av.Math;
  if (!scene?.BufferGeometry || !scene?.BufferAttribute || !scene?.UnlitMaterial ||
      !math?.Matrix4 || !math?.Quaternion || !math?.Vector3) {
    throw new Error('CAD Scene API is unavailable in this Viewer build.');
  }
  const coordinates = modelCoordinates(sourceModel);
  const localMeshScale = 0.001 / coordinates.scale;
  let dynamicModel = null;
  const registry = new Map();
  const colors = new Map();
  let disposed = false;

  function cadMaterial(color) {
    // SDK 7.130 Scene.UnlitMaterial is MeshBasicMaterial with environment maps
    // disabled. Keep annotation RGB stable under the source model's HDR lights
    // and fog while retaining normal depth occlusion against its geometry.
    return new scene.UnlitMaterial({
      color, side: scene.Side.Double, opacity: 1, transparent: false,
      depthTest: true, depthWrite: true, fog: false,
    });
  }

  function releaseDynamicModel() {
    if (!dynamicModel) return;
    const owned = dynamicModel;
    dynamicModel = null;
    // hideModel retains the model and GPU resources in the hidden-model queue.
    // Unload only the model created by this controller, never the client SVF.
    try { viewer.unloadModel(owned); }
    catch {
      // Adapter teardown immediately calls viewer.finish(), which completes cleanup.
      try { viewer.hideModel(owned.id); } catch { /* Best effort during teardown */ }
    }
  }

  function ensureScene() {
    if (disposed) throw new Error('CAD scene is disposed.');
    if (!dynamicModel) {
      dynamicModel = new av.Model();
      viewer.showModel(dynamicModel);
      // Preserve the client model as the authoritative WFC active model.
      if (viewer.model !== sourceModel) {
        releaseDynamicModel();
        throw new Error('The dynamic model changed the client model identity.');
      }
    }
    return dynamicModel.getInstances();
  }

  function matrix(transform) {
    const [x, y, z] = coordinates.toDisplay([
      transform.positionMm.x / 1000,
      transform.positionMm.y / 1000,
      transform.positionMm.z / 1000,
    ]);
    const q = transform.rotation;
    return new math.Matrix4().compose(
      new math.Vector3(x, y, z),
      new math.Quaternion(q.x, q.y, q.z, q.w),
      new math.Vector3(localMeshScale, localMeshScale, localMeshScale),
    );
  }

  function validateMesh(mesh) {
    if (!mesh || mesh.schemaVersion !== 1 || mesh.units !== 'mm' ||
        !Number.isInteger(mesh.triangleCount) || mesh.triangleCount < 1 || mesh.triangleCount > 20000 ||
        !Array.isArray(mesh.positions) || !Array.isArray(mesh.normals) || !Array.isArray(mesh.indices) ||
        mesh.positions.length !== mesh.triangleCount * 9 ||
        mesh.normals.length !== mesh.positions.length || mesh.indices.length !== mesh.triangleCount * 3 ||
        mesh.positions.some(v => !Number.isFinite(v) || Math.abs(v) > 1e9) ||
        mesh.normals.some(v => !Number.isFinite(v) || Math.abs(v) > 1.001) ||
        mesh.indices.some((id, i) => id !== i)) {
      throw new Error('The component mesh was invalid or exceeded its limits.');
    }
  }

  function add(componentId, mesh, transform) {
    // Rehydration after switching tabs may reuse the same component UUID.
    // Replace only this dynamic instance, never mutate the client SVF.
    const savedColor = colors.get(componentId);
    if (registry.has(componentId)) remove(componentId);
    validateMesh(mesh);
    const instances = ensureScene();
    const geometry = new scene.BufferGeometry();
    geometry.setAttribute('position', new scene.BufferAttribute(new Float32Array(mesh.positions), 3));
    geometry.setAttribute('normal', new scene.BufferAttribute(new Float32Array(mesh.normals), 3));
    const ids = mesh.indices.length <= 65535 ? new Uint16Array(mesh.indices) : new Uint32Array(mesh.indices);
    geometry.setIndices(ids);
    const material = cadMaterial(savedColor == null ? 0xd9ab33 : Number.parseInt(savedColor.slice(1), 16));
    const instanceId = instances.add(geometry, material, matrix(transform));
    if (instanceId < 0) throw new Error('The Viewer rejected CAD geometry.');
    registry.set(componentId, instanceId);
    if (savedColor != null) colors.set(componentId, savedColor);
    viewer.refresh(true);
  }

  function update(componentId, transform) {
    const id = registry.get(componentId);
    if (id === undefined || !dynamicModel) throw new Error('Unknown CAD instance.');
    // Autodesk does not guarantee a boolean return value for this mutation.
    dynamicModel.getInstances().setTransformWorld(id, matrix(transform));
    viewer.refresh(true);
  }

  function remove(componentId) {
    const id = registry.get(componentId);
    if (id === undefined || !dynamicModel) return;
    dynamicModel.getInstances().remove(id);
    registry.delete(componentId);
    colors.delete(componentId);
    viewer.refresh(true);
  }

  function setColor(componentId, color) {
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Invalid CAD color.');
    const id = registry.get(componentId);
    if (disposed || id === undefined || !dynamicModel) throw new Error('Unknown CAD instance.');
    const material = cadMaterial(Number.parseInt(color.slice(1), 16));
    // Scene instance materials belong exclusively to our dynamic model. Source
    // SVF object IDs and source-model theming are never used here.
    if (dynamicModel.getInstances().setMaterial(id, material) === false) throw new Error('The Viewer rejected the CAD material.');
    colors.set(componentId, color);
    viewer.refresh(true);
  }

  function focus(componentId) {
    const id = registry.get(componentId);
    if (disposed || id === undefined || !dynamicModel) throw new Error('Unknown CAD instance.');
    // For a dynamic model without an object tree the SDK resolves this owned
    // instance ID as its fragment ID. Never accept caller-supplied SVF IDs.
    viewer.fitToView([id], dynamicModel);
  }

  return {
    add, update, remove, focus, setColor,
    dispose() {
      disposed = true;
      registry.clear();
      colors.clear();
      releaseDynamicModel();
    },
  };
}
