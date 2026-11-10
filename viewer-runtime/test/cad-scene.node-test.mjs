import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCadSceneController } from '../cad-scene.mjs';

class FakeGeometry {
  attributes = {};
  indices = null;
  setAttribute(name, value) { this.attributes[name] = value; }
  setIndices(value) { this.indices = value; }
}
class FakeAttribute {
  constructor(values, itemSize) { this.values = values; this.itemSize = itemSize; }
}
class FakeMaterial {
  constructor(options) { this.options = options; }
}
class FakeVector3 {
  constructor(x, y, z) { Object.assign(this, { x, y, z }); }
}
class FakeQuaternion {
  constructor(x, y, z, w) { Object.assign(this, { x, y, z, w }); }
}
class FakeMatrix4 {
  compose(translation, rotation, scale) { Object.assign(this, { translation, rotation, scale }); return this; }
}
class FakeInstances {
  nextId = 0;
  records = new Map();
  add(geometry, material, transform) {
    const id = this.nextId++;
    this.records.set(id, { geometry, material, transform });
    return id;
  }
  remove(id) { this.records.delete(id); }
  setTransformWorld(id, matrix) {
    if (!this.records.has(id)) throw new Error('unknown instance');
    this.records.get(id).transform = matrix;
  }
}
class FakeModel {
  instances = new FakeInstances();
  id = 99;
  getInstances() { return this.instances; }
}
function fixture() {
  const sourceModel = {
    getUnitScale: () => 1,
    getUpVector: () => [0, 0, 1],
    getGlobalOffset: () => [100, 200, 300],
  };
  const viewer = {
    model: sourceModel,
    shown: [],
    hidden: [],
    unloaded: [],
    focused: [],
    refreshCount: 0,
    showModel(model) { this.shown.push(model); },
    hideModel(id) { this.hidden.push(id); },
    unloadModel(model) { this.unloaded.push(model); },
    fitToView(ids, model) { this.focused.push({ ids, model }); },
    refresh() { this.refreshCount++; },
  };
  const window = { Autodesk: { Viewing: {
    Scene: { BufferGeometry: FakeGeometry, BufferAttribute: FakeAttribute, StandardMaterial: FakeMaterial, Side: { Double: 'double' } },
    Math: { Matrix4: FakeMatrix4, Vector3: FakeVector3, Quaternion: FakeQuaternion },
    Model: FakeModel,
  } } };
  const mesh = {
    schemaVersion: 1, units: 'mm', triangleCount: 1,
    positions: [0, 0, 0, 300, 0, 0, 0, 60, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2],
  };
  const transform = {
    positionMm: { x: 125000, y: 220000, z: 340000 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  };
  return { sourceModel, viewer, window, mesh, transform };
}

test('dynamic STEP mesh uses world-mm to model-unit conversion without mutating the source SVF', () => {
  const f = fixture();
  const scene = createCadSceneController(f.viewer, { window: f.window, sourceModel: f.sourceModel });
  scene.add('tray-1', f.mesh, f.transform);
  assert.equal(f.viewer.model, f.sourceModel);
  assert.equal(f.viewer.shown.length, 1);
  const saved = [...f.viewer.shown[0].instances.records.values()][0];
  assert.ok(saved);
  assert.deepEqual([saved.transform.translation.x, saved.transform.translation.y, saved.transform.translation.z], [25, 20, 40]);
  assert.deepEqual([saved.transform.scale.x, saved.transform.scale.y, saved.transform.scale.z], [0.001, 0.001, 0.001]);
  assert.deepEqual([...saved.geometry.indices], [0, 1, 2]);
  assert.equal(saved.geometry.attributes.position.itemSize, 3);
  assert.ok(f.viewer.refreshCount > 0);
});

test('updating and removing CAD instances does not touch source model', () => {
  const f = fixture();
  const scene = createCadSceneController(f.viewer, { window: f.window, sourceModel: f.sourceModel });
  scene.add('straight', f.mesh, f.transform);
  scene.update('straight', { ...f.transform, positionMm: { x: 100000, y: 200000, z: 300000 } });
  const [rendered] = [...f.viewer.shown[0].instances.records.values()];
  assert.equal(rendered.transform.translation.x, 0);
  assert.equal(rendered.transform.translation.y, 0);
  assert.equal(rendered.transform.translation.z, 0);
  scene.remove('straight');
  assert.equal(f.viewer.shown[0].instances.records.size, 0);
  scene.dispose();
  assert.deepEqual(f.viewer.unloaded, [f.viewer.shown[0]]);
  assert.deepEqual(f.viewer.hidden, []);
  assert.equal(f.viewer.model, f.sourceModel);
});

test('rotation update forwards the complete quaternion without moving the anchor or changing mesh dimensions', () => {
  const f = fixture();
  const scene = createCadSceneController(f.viewer, { window: f.window, sourceModel: f.sourceModel });
  scene.add('rotating', f.mesh, f.transform);
  scene.add('stationary', f.mesh, f.transform);
  const [rendered, stationary] = [...f.viewer.shown[0].instances.records.values()];
  const geometry = rendered.geometry;
  const positions = [...geometry.attributes.position.values];
  const normals = [...geometry.attributes.normal.values];
  const indices = [...geometry.indices];
  const anchor = { ...rendered.transform.translation };
  const scale = { ...rendered.transform.scale };
  const stationaryTransform = stationary.transform;
  const refreshBefore = f.viewer.refreshCount;
  // World XYZ angles (90, 90, 0): every quaternion component matters.
  const rotation = { x: 0.5, y: 0.5, z: -0.5, w: 0.5 };
  const transform = { ...f.transform, rotation };
  scene.update('rotating', transform);
  assert.deepEqual({ ...rendered.transform.rotation }, rotation);
  assert.deepEqual({ ...rendered.transform.translation }, anchor);
  assert.deepEqual({ ...rendered.transform.scale }, scale);
  assert.equal(rendered.geometry, geometry);
  assert.deepEqual([...geometry.attributes.position.values], positions);
  assert.deepEqual([...geometry.attributes.normal.values], normals);
  assert.deepEqual([...geometry.indices], indices);
  assert.equal(stationary.transform, stationaryTransform);
  assert.deepEqual(transform, { ...f.transform, rotation: { x: 0.5, y: 0.5, z: -0.5, w: 0.5 } });
  assert.equal(f.viewer.refreshCount, refreshBefore + 1);
  assert.equal(f.viewer.model, f.sourceModel);
  scene.dispose();
});

test('disposal unloads the owned dynamic model exactly once and never the source model', () => {
  const f = fixture();
  const scene = createCadSceneController(f.viewer, { window: f.window, sourceModel: f.sourceModel });
  scene.add('straight', f.mesh, f.transform);
  scene.dispose();
  scene.dispose();
  assert.deepEqual(f.viewer.unloaded, [f.viewer.shown[0]]);
  assert.ok(!f.viewer.unloaded.includes(f.sourceModel));
  assert.throws(() => scene.add('after-dispose', f.mesh, f.transform), /disposed/);
});

test('malformed CAD geometry refuses to render', () => {
  const f = fixture();
  const scene = createCadSceneController(f.viewer, { window: f.window, sourceModel: f.sourceModel });
  assert.throws(() => scene.add('broken', { ...f.mesh, indices: [0, 1, -1] }, f.transform), /invalid|limits/);
  assert.equal(f.viewer.shown.length, 0);
});

test('focus resolves only the owned CAD instance and model, never source SVF IDs', () => {
  const f = fixture();
  const scene = createCadSceneController(f.viewer, { window: f.window, sourceModel: f.sourceModel });
  scene.add('straight', f.mesh, f.transform);
  scene.add('bend', f.mesh, f.transform);
  scene.focus('bend');
  assert.deepEqual(f.viewer.focused, [{ ids: [1], model: f.viewer.shown[0] }]);
  assert.equal(f.viewer.model, f.sourceModel);
  assert.throws(() => scene.focus('foreign'), /Unknown CAD/);
  scene.remove('bend');
  assert.throws(() => scene.focus('bend'), /Unknown CAD/);
  scene.dispose();
  assert.throws(() => scene.focus('straight'), /Unknown CAD/);
  assert.equal(f.viewer.focused.length, 1);
});

test('dynamic model cannot take ownership of the source model identity', () => {
  const f = fixture();
  f.viewer.showModel = function (model) { this.model = model; this.shown.push(model); };
  const scene = createCadSceneController(f.viewer, { window: f.window, sourceModel: f.sourceModel });
  assert.throws(() => scene.add('tray', f.mesh, f.transform), /identity/);
  assert.deepEqual(f.viewer.unloaded, [f.viewer.shown[0]]);
});
