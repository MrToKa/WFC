import { modelCoordinates } from './pathfinder.mjs';
import { installCadPropertyPanel, validateCadProperties } from './cad-properties.mjs';
import { createCadTreeController } from './cad-tree.mjs';

/**
 * Dynamic Scene API model layered over the currently loaded client SVF.
 * Input mesh coordinates are local CAD millimetres; input translation is
 * canonical world millimetres (Z-up). Nothing mutates the original SVF model.
 */
export function createCadSceneController(viewer, { window, sourceModel }) {
  const av = window.Autodesk.Viewing;
  const scene = av.Scene;
  const math = av.Math;
  if (
    !scene?.BufferGeometry ||
    !scene?.BufferAttribute ||
    !scene?.UnlitMaterial ||
    !math?.Matrix4 ||
    !math?.Quaternion ||
    !math?.Vector3
  ) {
    throw new Error('CAD Scene API is unavailable in this Viewer build.');
  }
  const coordinates = modelCoordinates(sourceModel);
  const localMeshScale = 0.001 / coordinates.scale;
  let dynamicModel = null;
  const registry = new Map();
  const colors = new Map();
  const properties = new Map();
  let propertyPanel;
  let tree;
  let disposed = false;

  function cadMaterial(color) {
    // SDK 7.130 Scene.UnlitMaterial is MeshBasicMaterial with environment maps
    // disabled. Keep annotation RGB stable under the source model's HDR lights
    // and fog while retaining normal depth occlusion against its geometry.
    return new scene.UnlitMaterial({
      color,
      side: scene.Side.Double,
      opacity: 1,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      fog: false,
    });
  }

  function releaseDynamicModel() {
    if (!dynamicModel) return;
    const owned = dynamicModel;
    dynamicModel = null;
    // hideModel retains the model and GPU resources in the hidden-model queue.
    // Unload only the model created by this controller, never the client SVF.
    try {
      viewer.unloadModel(owned);
    } catch {
      // Adapter teardown immediately calls viewer.finish(), which completes cleanup.
      try {
        viewer.hideModel(owned.id);
      } catch {
        /* Best effort during teardown */
      }
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
      tree = createCadTreeController(viewer, av, dynamicModel, window);
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
    if (
      !mesh ||
      mesh.schemaVersion !== 1 ||
      mesh.units !== 'mm' ||
      !Number.isInteger(mesh.triangleCount) ||
      mesh.triangleCount < 1 ||
      mesh.triangleCount > 20000 ||
      !Array.isArray(mesh.positions) ||
      !Array.isArray(mesh.normals) ||
      !Array.isArray(mesh.indices) ||
      mesh.positions.length !== mesh.triangleCount * 9 ||
      mesh.normals.length !== mesh.positions.length ||
      mesh.indices.length !== mesh.triangleCount * 3 ||
      mesh.positions.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e9) ||
      mesh.normals.some((v) => !Number.isFinite(v) || Math.abs(v) > 1.001) ||
      mesh.indices.some((id, i) => id !== i)
    ) {
      throw new Error('The component mesh was invalid or exceeded its limits.');
    }
  }

  function add(componentId, mesh, transform) {
    // Rehydration after switching tabs may reuse the same component UUID.
    // Replace only this dynamic instance, never mutate the client SVF.
    const savedColor = colors.get(componentId);
    const savedProperties = properties.get(componentId);
    validateMesh(mesh);
    const selection = registry.has(componentId) ? remove(componentId, true) : null;
    const instances = ensureScene();
    const geometry = new scene.BufferGeometry();
    geometry.setAttribute(
      'position',
      new scene.BufferAttribute(new Float32Array(mesh.positions), 3),
    );
    geometry.setAttribute('normal', new scene.BufferAttribute(new Float32Array(mesh.normals), 3));
    const ids =
      mesh.indices.length <= 65535 ? new Uint16Array(mesh.indices) : new Uint32Array(mesh.indices);
    geometry.setIndices(ids);
    const material = cadMaterial(
      savedColor == null ? 0xd9ab33 : Number.parseInt(savedColor.slice(1), 16),
    );
    const instanceId = instances.add(geometry, material, matrix(transform));
    if (instanceId < 0) throw new Error('The Viewer rejected CAD geometry.');
    registry.set(componentId, instanceId);
    if (savedColor != null) colors.set(componentId, savedColor);
    if (savedProperties) properties.set(componentId, savedProperties);
    tree.upsert(componentId, instanceId, savedProperties);
    restoreOwnedSelection(selection);
    viewer.refresh(true);
  }

  function update(componentId, transform) {
    const id = registry.get(componentId);
    if (id === undefined || !dynamicModel) throw new Error('Unknown CAD instance.');
    // Autodesk does not guarantee a boolean return value for this mutation.
    dynamicModel.getInstances().setTransformWorld(id, matrix(transform));
    viewer.refresh(true);
  }

  function clearOwnedSelection() {
    const selected = viewer.getAggregateSelection?.() ?? [];
    const own = selected.find((row) => row.model === dynamicModel);
    if (!own?.selection.length) return null;
    const visible = viewer
      .getExtension?.('Autodesk.PropertiesManager')
      ?.getPanel?.()
      ?.isVisible?.();
    viewer.setAggregateSelection(
      selected.map((row) =>
        row.model === dynamicModel ? { model: dynamicModel, selection: [] } : row,
      ),
    );
    return { ids: [...own.selection], visible };
  }

  function restoreOwnedSelection(selection) {
    if (!selection || !dynamicModel) return;
    const selected = viewer.getAggregateSelection();
    const ids = selection.ids.filter((id) => dynamicModel.getObjectTree()?.getNodeIndex(id));
    viewer.setAggregateSelection([
      ...selected.filter((row) => row.model !== dynamicModel),
      { model: dynamicModel, selection: ids },
    ]);
    if (selection.visible === false)
      viewer.getExtension('Autodesk.PropertiesManager')?.getPanel?.()?.setVisible(false);
  }

  function remove(componentId, keepIdentity = false) {
    const id = registry.get(componentId);
    if (id === undefined || !dynamicModel) {
      tree?.remove(componentId);
      return null;
    }
    // Unmark old group/leaf highlights before the SDK releases the fragment.
    // Restore every surviving owned node afterwards, keeping source selection.
    const selection = clearOwnedSelection();
    dynamicModel.getInstances().remove(id);
    registry.delete(componentId);
    colors.delete(componentId);
    properties.delete(componentId);
    tree.remove(componentId, keepIdentity);
    if (!keepIdentity) restoreOwnedSelection(selection);
    propertyPanel?.refresh();
    viewer.refresh(true);
    return selection;
  }

  function setColor(componentId, color) {
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color))
      throw new Error('Invalid CAD color.');
    const id = registry.get(componentId);
    if (disposed || id === undefined || !dynamicModel) throw new Error('Unknown CAD instance.');
    const material = cadMaterial(Number.parseInt(color.slice(1), 16));
    // Scene instance materials belong exclusively to our dynamic model. Source
    // SVF object IDs and source-model theming are never used here.
    if (dynamicModel.getInstances().setMaterial(id, material) === false)
      throw new Error('The Viewer rejected the CAD material.');
    colors.set(componentId, color);
    viewer.refresh(true);
  }

  function focus(componentId) {
    const id = registry.get(componentId);
    if (disposed || id === undefined || !dynamicModel) throw new Error('Unknown CAD instance.');
    tree.flush();
    const objectId = tree.objectId(componentId);
    viewer.fitToView([objectId], dynamicModel);
    viewer.select?.([objectId], dynamicModel);
  }

  function setProperties(componentId, metadata, route) {
    if (disposed || !registry.has(componentId) || !dynamicModel)
      throw new Error('Unknown CAD instance.');
    if (!validateCadProperties(componentId, metadata, route))
      throw new Error('Invalid CAD properties.');
    properties.set(componentId, {
      metadata: structuredClone(metadata),
      route: structuredClone(route),
    });
    tree.setProperties(componentId, properties.get(componentId));
    if (!propertyPanel)
      propertyPanel = installCadPropertyPanel(viewer, av, (model, instanceId) => {
        if (model !== dynamicModel) return undefined;
        return tree.lookup(instanceId, properties);
      });
    propertyPanel.refresh();
  }

  return {
    add,
    update,
    remove,
    focus,
    setColor,
    setProperties,
    dispose() {
      disposed = true;
      registry.clear();
      colors.clear();
      properties.clear();
      propertyPanel?.dispose();
      propertyPanel = undefined;
      tree?.dispose();
      tree = undefined;
      releaseDynamicModel();
    },
  };
}
