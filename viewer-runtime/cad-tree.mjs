export const CAD_TREE_ROOT = 'Proposed trays';
export const MAX_CAD_TREE_SECTIONS = 500;
// Node kinds of the pinned public ObjectTreeBuilder contract. Collections are
// skipped by FIRST_OBJECT, keeping a surface click on its individual section.
const MODEL = 5,
  COLLECTION = 3,
  GEOMETRY = 6;

/** A genuine object tree attached exclusively to the owned dynamic Scene model. */
export function createCadTreeController(viewer, av, model, window) {
  if (!av.ObjectTreeBuilder || typeof model.setObjectTree !== 'function')
    throw new Error('CAD model tree is unavailable.');
  const rootId = 1,
    sections = new Map(),
    identities = new Map(),
    groups = new Map();
  let nextId = 2,
    nextNumber = 1,
    disposed = false,
    pending = null;
  let previousLeaves = new Set(),
    previousGroups = new Set(),
    topology = '';
  const data = model.getData();
  data.loadOptions = { ...(data.loadOptions ?? {}), modelNameOverride: CAD_TREE_ROOT };
  const allocate = () => {
    if (nextId > 2147483647) throw new Error('CAD tree identity limit exceeded.');
    return nextId++;
  };
  const groupKey = (row) => row.route?.id ?? 'unassigned';
  const groupName = (row) => (row.route?.id ? row.route.name : 'Unassigned components');
  const label = (row) => {
    const detail = row.metadata?.partNumber;
    const length = row.metadata?.actualLengthMm;
    return `Section ${row.number}${detail ? ` · ${detail}` : ''}${length == null ? '' : ` · ${Number(length.toFixed(3))} mm`}`;
  };

  function flush() {
    if (disposed) return;
    if (pending != null) {
      window.cancelAnimationFrame?.(pending);
      pending = null;
    }
    const old = model.getObjectTree();
    const browser = viewer.modelstructure?.tree;
    const delegate = browser?.getDelegate(model.id);
    const expanded = delegate
      ? [rootId, ...previousGroups].filter((id) => !browser.isCollapsed(delegate, id))
      : [];
    const activeGroups = new Map(),
      leafIds = new Set();
    for (const row of sections.values()) {
      const key = groupKey(row);
      if (!groups.has(key)) groups.set(key, allocate());
      activeGroups.set(groups.get(key), groupName(row));
      leafIds.add(row.objectId);
    }
    const valid = new Set([rootId, ...activeGroups.keys(), ...leafIds]);
    if (old) {
      // Only the owned model's retired nodes are removed from native visibility
      // tracking. Public single-model isolate leaves source models untouched.
      if (viewer.getIsolatedNodes?.(model)?.some((id) => !valid.has(id))) viewer.isolate([], model);
      const hidden =
        viewer.getHiddenNodes?.(model)?.filter((id) => !valid.has(id) && old.getNodeIndex(id)) ??
        [];
      if (hidden.length) viewer.show(hidden, model);
    }
    const builder = old
      ? av.ObjectTreeBuilder.fromObjectTree(old)
      : new av.ObjectTreeBuilder(rootId, CAD_TREE_ROOT);
    builder.setNodeType(rootId, MODEL);
    builder.setNodeName(rootId, CAD_TREE_ROOT);
    for (const [id, name] of activeGroups) {
      if (!previousGroups.has(id)) builder.createNode(id, rootId, name, COLLECTION);
      else builder.setNodeName(id, name);
    }
    for (const row of sections.values()) {
      const parent = groups.get(groupKey(row));
      if (!previousLeaves.has(row.objectId))
        builder.createNode(row.objectId, parent, label(row), GEOMETRY);
      else {
        builder.setParent(row.objectId, parent);
        builder.setNodeName(row.objectId, label(row));
      }
    }
    for (const id of previousLeaves) if (!leafIds.has(id)) builder.removeNode(id);
    for (const id of previousGroups) if (!activeGroups.has(id)) builder.removeNode(id);
    for (const [key, id] of groups) if (!activeGroups.has(id)) groups.delete(key);
    const nextTopology = JSON.stringify(
      [...sections.values()].map((row) => [
        row.objectId,
        row.fragmentId,
        groups.get(groupKey(row)),
      ]),
    );
    const selected = viewer.getAggregateSelection?.() ?? [];
    const own = selected.find((row) => row.model === model);
    const rebuildSelection = own?.selection.length && nextTopology !== topology;
    const propertyPanel = viewer.getExtension?.('Autodesk.PropertiesManager')?.getPanel?.();
    const wasPropertiesVisible = propertyPanel?.isVisible?.();
    if (rebuildSelection)
      viewer.setAggregateSelection(
        selected.map((row) => (row.model === model ? { model, selection: [] } : row)),
      );
    const next = builder.build();
    for (const id of activeGroups.keys())
      if (!previousGroups.has(id) && old?.isNodeHidden(rootId)) next.setNodeHidden(id, true);
    for (const row of sections.values())
      if (next.isNodeHidden(groups.get(groupKey(row)))) next.setNodeHidden(row.objectId, true);
    model.setObjectTree(next);
    // The native model browser collapses its delegate on OBJECT_TREE_CREATED.
    // Preserve only this owned subtree's expanded route/root IDs; the source
    // model's delegate and expansion state are never read or changed.
    const currentBrowser = viewer.modelstructure?.tree;
    const currentDelegate = currentBrowser?.getDelegate(model.id);
    if (currentDelegate)
      for (const id of expanded)
        if (valid.has(id)) currentBrowser.setCollapsed(currentDelegate, id, false);
    // Tree flags survive metadata/geometry refresh; replacement geometry must
    // inherit the old section's visibility rather than briefly becoming visible.
    for (const row of sections.values()) {
      const tree = model.getObjectTree();
      if (old && tree.isNodeHidden(row.objectId)) model.setVisibility(row.fragmentId, false);
    }
    previousLeaves = leafIds;
    previousGroups = new Set(activeGroups.keys());
    topology = nextTopology;
    if (rebuildSelection) {
      viewer.setAggregateSelection(
        selected.map((row) =>
          row.model === model
            ? { model, selection: row.selection.filter((id) => valid.has(id)) }
            : row,
        ),
      );
      if (wasPropertiesVisible === false) propertyPanel.setVisible(false);
    }
  }
  function schedule() {
    if (pending != null || disposed) return;
    if (typeof window.requestAnimationFrame !== 'function') {
      flush();
      return;
    }
    pending = window.requestAnimationFrame(() => {
      pending = null;
      flush();
    });
  }
  return {
    upsert(componentId, fragmentId, properties) {
      if (disposed) throw new Error('CAD tree is disposed.');
      if (!sections.has(componentId) && sections.size >= MAX_CAD_TREE_SECTIONS)
        throw new Error('CAD tree section limit exceeded.');
      if (!identities.has(componentId))
        identities.set(componentId, { objectId: allocate(), number: nextNumber++ });
      const row = { ...identities.get(componentId), componentId, fragmentId, ...properties };
      sections.set(componentId, row);
      model.getInstances().setDbId(fragmentId, row.objectId);
      flush();
      return row.objectId;
    },
    setProperties(componentId, properties) {
      const row = sections.get(componentId);
      if (!row) throw new Error('Unknown CAD tree section.');
      sections.set(componentId, { ...row, ...properties });
      schedule();
    },
    remove(componentId, keepIdentity = false) {
      sections.delete(componentId);
      if (!keepIdentity) identities.delete(componentId);
      if (keepIdentity) schedule();
      else flush();
    },
    objectId: (componentId) => sections.get(componentId)?.objectId,
    lookup(objectId, properties) {
      const leaf = [...sections.values()].find((row) => row.objectId === objectId);
      if (leaf) return properties.get(leaf.componentId) ?? null;
      if (objectId !== rootId && !previousGroups.has(objectId)) return null;
      return {
        members: [...sections.values()]
          .filter((row) => objectId === rootId || groups.get(groupKey(row)) === objectId)
          .map((row) => ({
            objectId: row.objectId,
            section: properties.get(row.componentId) ?? null,
          })),
      };
    },
    flush,
    dispose() {
      disposed = true;
      if (pending != null) window.cancelAnimationFrame?.(pending);
      sections.clear();
      identities.clear();
      groups.clear();
    },
  };
}
