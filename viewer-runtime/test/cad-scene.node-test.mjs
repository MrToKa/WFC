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
    refreshCount: 0,
    showModel(model) { this.shown.push(model); },
    hideModel(id) { this.hidden.push(id); },
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
  assert.deepEqual(f.viewer.hidden, [99]);
  assert.equal(f.viewer.model, f.sourceModel);
});

test('malformed CAD geometry refuses to render', () => {
  const f = fixture();
  const scene = createCadSceneController(f.viewer, { window: f.window, sourceModel: f.sourceModel });
  assert.throws(() => scene.add('broken', { ...f.mesh, indices: [0, 1, -1] }, f.transform), /invalid|limits/);
  assert.equal(f.viewer.shown.length, 0);
});

test('dynamic model cannot take ownership of the source model identity', () => {
  const f = fixture();
  f.viewer.showModel = function (model) { this.model = model; this.shown.push(model); };
  const scene = createCadSceneController(f.viewer, { window: f.window, sourceModel: f.sourceModel });
  assert.throws(() => scene.add('tray', f.mesh, f.transform), /identity/);
  assert.deepEqual(f.viewer.hidden, [99]);
});
