import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCadTreeController, CAD_TREE_ROOT } from '../cad-tree.mjs';
import {
  nativeTreeSdk,
  nativeSetObjectTree,
  nativeSetDbId,
  nativeFragmentIds,
  sdkDeclaration,
  sdkSource,
} from './sdk-object-tree-fixture.mjs';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const route = (n, name = 'BC182') => ({ id: uuid(n), name, purpose: 'LV cable tray' });
const metadata = (n, length = 1500) => ({
  instanceId: uuid(n),
  name: 'BC182 / ' + uuid(n),
  actualLengthMm: length,
  widthMm: 300,
  heightMm: 60,
  partNumber: 'KL 60.303 F',
  manufacturer: 'Niedax',
  purpose: 'LV cable tray',
  componentKind: 'straight',
  cadAssetId: uuid(90),
  cadRevision: 1,
});
function fixture() {
  const frames = new Map(),
    visibility = new Map([
      [0, true],
      [1, true],
      [2, true],
    ]),
    sourceTree = {};
  const collection = {
    fragments: { fragId2dbId: [], dbId2fragId: [] },
    setDbId: nativeSetDbId,
    _dbIdToInstanceIds: nativeFragmentIds,
    getOriginalWorldBounds(id, result) {
      for (let i = 0; i < 6; i++) result[i] = [id * 10, 0, 0, id * 10 + 10, 1, 1][i];
    },
  };
  const events = [],
    data = { loadOptions: {} };
  const model = {
    id: 99,
    getData: () => data,
    getInstances: () => collection,
    getObjectTree: () => data.instanceTree,
    setObjectTree: nativeSetObjectTree,
    _dispatchEvent: (event) => events.push(event),
    isLoadDone: () => true,
    isInitialized: () => true,
    getRootId: () => data.instanceTree?.getRootId() ?? 0,
    getFragmentList: () => collection,
    is2d: () => false,
    setVisibility: (id, visible) => visibility.set(id, visible),
    setAllVisibility: (visible) => {
      for (const id of visibility.keys()) visibility.set(id, visible);
    },
  };
  const source = {
    id: 1,
    getObjectTree: () => sourceTree,
    getData: () => ({ loadOptions: { modelNameOverride: 'Original SVF' } }),
  };
  const viewer = {
    selection: [],
    getAggregateSelection() {
      return this.selection;
    },
    setAggregateSelection(rows) {
      this.selection = rows.filter((row) => row.selection.length);
    },
    getExtension: () => null,
  };
  let frameId = 0;
  const window = {
    requestAnimationFrame(callback) {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  const tree = createCadTreeController(viewer, nativeTreeSdk, model, window);
  const props = new Map();
  function add(n, fragment, group, length = 1500) {
    const value = { metadata: metadata(n, length), route: group };
    props.set(uuid(n), value);
    return tree.upsert(uuid(n), fragment, value);
  }
  return {
    tree,
    viewer,
    model,
    source,
    sourceTree,
    collection,
    events,
    frames,
    visibility,
    props,
    add,
  };
}
const children = (tree, id) => {
  const result = [];
  tree.enumNodeChildren(id, (value) => {
    result.push(value);
  });
  return result;
};
const fragments = (tree, id) => {
  const result = [];
  tree.enumNodeFragments(
    id,
    (value) => {
      result.push(value);
    },
    true,
  );
  return result;
};

test('real pinned SDK builds separate Proposed trays → route → numbered SKU/length sections, including fragment0', () => {
  const f = fixture(),
    a = f.add(1, 0, route(11)),
    b = f.add(2, 1, route(11), 3750),
    c = f.add(3, 2, route(12, 'BC183'));
  const native = f.model.getObjectTree(),
    root = native.getRootId(),
    groups = children(native, root);
  assert.equal(CAD_TREE_ROOT, 'Proposed trays');
  assert.equal(native.getNodeName(root), CAD_TREE_ROOT);
  assert.equal(f.model.getData().loadOptions.modelNameOverride, CAD_TREE_ROOT);
  assert.deepEqual(
    groups.map((id) => native.getNodeName(id)),
    ['BC182', 'BC183'],
  );
  assert.deepEqual(children(native, groups[0]), [a, b]);
  assert.deepEqual(children(native, groups[1]), [c]);
  assert.equal(native.getNodeName(a), 'Section 1 · KL 60.303 F · 1500 mm');
  assert.equal(native.getNodeName(b), 'Section 2 · KL 60.303 F · 3750 mm');
  assert.deepEqual(fragments(native, a), [0]);
  assert.deepEqual(fragments(native, groups[0]), [0, 1]);
  assert.deepEqual(fragments(native, root), [0, 1, 2]);
  assert.equal(
    native.findNodeForSelection(a, 1),
    a,
    'A 3D click must select the section, not its route.',
  );
  assert.equal(native.findNodeForSelection(groups[0], 1), groups[0]);
  assert.equal(f.source.getObjectTree(), f.sourceTree);
  assert.equal(f.source.getData().loadOptions.modelNameOverride, 'Original SVF');
  assert.equal(f.events.at(-1).type, 'object-tree-created');
});

test('actual SDK tree visibility isolates, hides and restores correct route fragments instead of offset neighbors', () => {
  const f = fixture(),
    a = f.add(1, 0, route(11));
  f.add(2, 1, route(11));
  f.add(3, 2, route(12, 'BC183'));
  const native = f.model.getObjectTree(),
    group = native.getNodeParentId(a);
  const NativeVisibility = Function(
    'Gt',
    'pg',
    'mg',
    `return (${sdkDeclaration('class yk{')});`,
  )(-1, 'hide', 'show');
  const visibility = new NativeVisibility(
    { api: { dispatchEvent() {} }, sceneUpdated() {} },
    f.model,
  );
  visibility.isolate([group]);
  assert.deepEqual([...f.visibility.values()], [true, true, false]);
  visibility.hide(a);
  assert.deepEqual([...f.visibility.values()], [false, true, false]);
  visibility.show(a);
  assert.deepEqual([...f.visibility.values()], [true, true, false]);
  visibility.isolate([]);
  assert.deepEqual([...f.visibility.values()], [true, true, true]);
  assert.equal(f.model.getObjectTree(), native);
});

test('actual SDK selection and focus resolve leaf/group tree nodes to their correct world fragments', () => {
  const f = fixture(),
    a = f.add(1, 0, route(11));
  f.add(2, 1, route(11));
  f.add(3, 2, route(12, 'BC183'));
  const native = f.model.getObjectTree(),
    group = native.getNodeParentId(a),
    highlighted = [];
  const select = Function(
    'gk',
    `return ({${sdkDeclaration('_select(e,t,i){')}})._select;`,
  )({ REGULAR: 1 });
  const selector = {
    _model: f.model,
    selectedObjectIds: {},
    selectionCount: 0,
    defaultSelectionType: 1,
    isNodeSelectionLocked: () => false,
    getObjectTree: () => native,
    _getSelectionMode: () => 1,
    _isSelected: () => false,
    _markObject: (id) => highlighted.push(...fragments(native, id)),
  };
  select.call(selector, a);
  assert.deepEqual(highlighted, [0]);
  assert.ok(selector.selectedObjectIds[a]);
  highlighted.length = 0;
  select.call(selector, group);
  assert.deepEqual(highlighted, [0, 1]);
  class Box {
    constructor() {
      this.min = { x: Infinity, y: Infinity, z: Infinity };
      this.max = { x: -Infinity, y: -Infinity, z: -Infinity };
    }
    union(other) {
      for (const key of ['x', 'y', 'z']) {
        this.min[key] = Math.min(this.min[key], other.min[key]);
        this.max[key] = Math.max(this.max[key], other.max[key]);
      }
      return this;
    }
  }
  const read = [];
  f.collection.getWorldBounds = (id, box) => {
    read.push(id);
    box.min = { x: id * 10, y: 0, z: 0 };
    box.max = { x: id * 10 + 10, y: 1, z: 1 };
  };
  const bounds = Function(
    '_',
    `return ({${sdkDeclaration('get3DBounds(e){')}}).get3DBounds;`,
  )(() => ({ Box3: Box }));
  const result = bounds.call({}, [{ model: f.model, selection: [group] }]);
  assert.deepEqual(read, [0, 1]);
  assert.deepEqual(result.min, { x: 0, y: 0, z: 0 });
  assert.equal(result.max.x, 20);
});

test('new and reassigned sections inherit hidden routes, isolated visible routes stay visible, deleted isolation retires only own tracking', () => {
  const f = fixture(),
    a = f.add(1, 0, route(11)),
    b = f.add(2, 1, route(12, 'BC183'));
  const NativeVisibility = Function(
    'Gt',
    'pg',
    'mg',
    `return (${sdkDeclaration('class yk{')});`,
  )(-1, 'hide', 'show');
  const visibility = new NativeVisibility(
    { api: { dispatchEvent() {} }, sceneUpdated() {} },
    f.model,
  );
  f.viewer.getIsolatedNodes = () => visibility.getIsolatedNodes();
  f.viewer.getHiddenNodes = () => visibility.getHiddenNodes();
  f.viewer.isolate = (ids, model) => {
    assert.equal(model, f.model);
    visibility.isolate(ids);
  };
  f.viewer.show = (ids, model) => {
    assert.equal(model, f.model);
    visibility.show(ids);
  };
  const group = f.model.getObjectTree().getNodeParentId(a);
  visibility.hide(group);
  const c = f.add(3, 2, route(11));
  assert.equal(f.model.getObjectTree().isNodeHidden(c), true);
  assert.equal(f.visibility.get(2), false);
  f.tree.setProperties(uuid(2), { metadata: metadata(2), route: route(11) });
  f.tree.flush();
  assert.equal(f.model.getObjectTree().isNodeHidden(b), true);
  assert.equal(f.visibility.get(1), false);
  visibility.isolate([group]);
  f.tree.setProperties(uuid(1), { metadata: metadata(1, 3750), route: route(11) });
  f.tree.flush();
  assert.equal(f.model.getObjectTree().isNodeHidden(a), false);
  assert.equal(f.visibility.get(0), true);
  for (const n of [1, 2, 3]) {
    f.tree.setProperties(uuid(n), { metadata: metadata(n), route: route(15, 'MOVED') });
  }
  f.tree.flush();
  assert.deepEqual(visibility.getIsolatedNodes(), []);
  assert.deepEqual([...f.visibility.values()], [true, true, true]);
  assert.equal(f.source.getObjectTree(), f.sourceTree);
  assert.equal(f.model.getObjectTree().getNodeIndex(group), undefined);
});

test('renames and route reassignment preserve leaf IDs, hidden flags, metadata, source selection and native group membership', () => {
  const f = fixture(),
    a = f.add(1, 0, route(11)),
    b = f.add(2, 1, route(11));
  f.model.getObjectTree().setNodeHidden(a, true);
  const originalGroup = f.model.getObjectTree().getNodeParentId(a);
  f.viewer.selection = [
    { model: f.source, selection: [91] },
    { model: f.model, selection: [b] },
  ];
  const updated = {
    metadata: { ...metadata(1), purpose: 'Control' },
    route: { ...route(12, 'CONTROL'), purpose: 'Control' },
  };
  f.props.set(uuid(1), updated);
  f.tree.setProperties(uuid(1), updated);
  f.tree.flush();
  const native = f.model.getObjectTree();
  const newGroup = native.getNodeParentId(a);
  assert.equal(f.tree.objectId(uuid(1)), a);
  assert.equal(native.getNodeName(native.getNodeParentId(a)), 'CONTROL');
  assert.deepEqual(fragments(native, originalGroup), [1]);
  assert.equal(native.isNodeHidden(a), true);
  assert.equal(f.visibility.get(0), false);
  assert.deepEqual(f.viewer.selection, [
    { model: f.source, selection: [91] },
    { model: f.model, selection: [b] },
  ]);
  assert.deepEqual(f.tree.lookup(native.getNodeParentId(a), f.props).members, [
    { objectId: a, section: updated },
  ]);
  f.tree.setProperties(uuid(1), {
    ...updated,
    route: { ...updated.route, name: 'CONTROL-RENAMED' },
  });
  f.tree.flush();
  assert.equal(f.model.getObjectTree().getNodeName(newGroup), 'CONTROL-RENAMED');
});

test('removal removes only own section/empty route and cannot retarget a recycled fragment or stale selection', () => {
  const f = fixture(),
    a = f.add(1, 0, route(11)),
    b = f.add(2, 1, route(12, 'BC183'));
  const group = f.model.getObjectTree().getNodeParentId(a);
  f.viewer.selection = [
    { model: f.source, selection: [91] },
    { model: f.model, selection: [group, b] },
  ];
  f.collection.setDbId(0, 0);
  f.tree.remove(uuid(1));
  assert.deepEqual(f.viewer.selection, [
    { model: f.source, selection: [91] },
    { model: f.model, selection: [b] },
  ]);
  assert.equal(f.model.getObjectTree().getNodeIndex(group), undefined);
  const c = f.add(3, 0, route(13, 'BC184'));
  assert.notEqual(c, a);
  assert.deepEqual(fragments(f.model.getObjectTree(), c), [0]);
  assert.equal(f.tree.lookup(a, f.props), null);
  assert.deepEqual(f.viewer.selection, [
    { model: f.source, selection: [91] },
    { model: f.model, selection: [b] },
  ]);
});

test('metadata-less sections are explicitly unassigned and disposal cancels pending tree publication', () => {
  const f = fixture();
  const id = f.tree.upsert(uuid(1), 0);
  const native = f.model.getObjectTree();
  assert.equal(native.getNodeName(native.getNodeParentId(id)), 'Unassigned components');
  assert.equal(native.getNodeName(id), 'Section 1');
  f.tree.setProperties(uuid(1), { metadata: metadata(1), route: route(11) });
  assert.equal(f.frames.size, 1);
  const count = f.events.length;
  f.tree.dispose();
  assert.equal(f.frames.size, 0);
  f.tree.flush();
  assert.equal(f.events.length, count);
  assert.throws(() => f.tree.upsert(uuid(2), 1), /disposed/);
});

test('native tree refresh preserves expanded owned routes and never changes the source delegate', () => {
  const f = fixture(),
    a = f.add(1, 0, route(11));
  const group = f.model.getObjectTree().getNodeParentId(a),
    root = f.model.getObjectTree().getRootId();
  const ownedDelegate = { model: f.model },
    sourceDelegate = { model: f.source };
  const ownedExpanded = new Set([root, group]),
    sourceExpanded = new Set([91]);
  const writes = [];
  f.viewer.modelstructure = {
    tree: {
      getDelegate: (modelId) => {
        assert.equal(modelId, f.model.id);
        return ownedDelegate;
      },
      isCollapsed: (delegate, id) => {
        assert.equal(delegate, ownedDelegate);
        return !ownedExpanded.has(id);
      },
      setCollapsed: (delegate, id, collapsed) => {
        writes.push({ delegate, id, collapsed });
        assert.equal(delegate, ownedDelegate);
        if (collapsed) ownedExpanded.delete(id);
        else ownedExpanded.add(id);
      },
    },
  };
  const dispatch = f.model._dispatchEvent;
  f.model._dispatchEvent = (event) => {
    dispatch(event);
    ownedExpanded.clear();
    ownedExpanded.add(root);
  };
  f.tree.setProperties(uuid(1), { metadata: metadata(1, 3750), route: route(11, 'RENAMED') });
  f.tree.flush();
  assert.equal(f.model.getObjectTree().getNodeName(group), 'RENAMED');
  assert.deepEqual([...ownedExpanded], [root, group]);
  assert.deepEqual([...sourceExpanded], [91]);
  assert.ok(writes.every((row) => row.delegate !== sourceDelegate));
  ownedExpanded.delete(group);
  writes.length = 0;
  f.tree.setProperties(uuid(1), { metadata: metadata(1, 1000), route: route(11, 'RENAMED') });
  f.tree.flush();
  assert.equal(ownedExpanded.has(group), false);
  assert.ok(writes.every((row) => row.id !== group));
});

test('topology refresh preserves a manually closed Properties panel while restoring own and source selection', () => {
  const f = fixture(),
    a = f.add(1, 0, route(11));
  const panel = {
    visible: false,
    isVisible() {
      return this.visible;
    },
    setVisible(value) {
      this.visible = value;
    },
  };
  f.viewer.getExtension = () => ({ getPanel: () => panel });
  f.viewer.selection = [
    { model: f.source, selection: [91] },
    { model: f.model, selection: [a] },
  ];
  const select = f.viewer.setAggregateSelection.bind(f.viewer);
  f.viewer.setAggregateSelection = (rows) => {
    select(rows);
    panel.visible = rows.some((row) => row.selection.length);
  };
  f.tree.setProperties(uuid(1), { metadata: metadata(1), route: route(12, 'RENAMED') });
  f.tree.flush();
  assert.equal(panel.visible, false);
  assert.deepEqual(f.viewer.selection, [
    { model: f.source, selection: [91] },
    { model: f.model, selection: [a] },
  ]);
});

test('pinned native model browser follows real tree-created events and displays an owned model label', () => {
  for (const contract of [
    'ObjectTreeBuilder:()=>BL',
    'MK._onObjectTreeCreated=function(e)',
    'refreshTreeUI?.(e.model)',
    'loadOptions.modelNameOverride',
    'for(;n>0;)',
    'this.viewer.modelstructure=e',
    'getDelegate(e){return this.idToDelegate[parseInt(e)]}',
  ]) {
    assert.ok(sdkSource.includes(contract), contract);
  }
});
