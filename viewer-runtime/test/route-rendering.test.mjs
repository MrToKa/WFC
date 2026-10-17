import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteController } from '../routes.mjs';

function fixture(t, { preference = true, renderPass = false, resetPassOnIsolation = false } = {}) {
  const calls = [], meshes = [], disposed = [];
  const originalMaterials = [{ color: 0x00a060, opacity: 1 }, { color: 0x3060ff, opacity: 1 }, { color: 0xb03030, opacity: 1 }];
  const beforeMaterials = structuredClone(originalMaterials);
  const baseFade = { opacity: 0.1 }, initialVariant = { opacity: 0.3 };
  baseFade.variants = [initialVariant];
  const vertices = start => [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z => [start + x * 10, y, z])));
  const geometries = [vertices(0), vertices(10), vertices(30)];
  const descendants = { 1: [2, 20, 3, 30, 4, 40], 2: [20], 3: [30], 4: [40] };
  const names = { 1: 'MODEL', 2: 'BC1', 20: 'Part A', 3: 'BC2', 30: 'Part B', 4: 'CONTEXT', 40: 'Context part' };
  const fragmentIds = { 20: [0], 30: [1], 40: [2] };
  const tree = {
    getRootId: () => 1,
    getNodeName: id => names[id],
    enumNodeChildren(id, callback) { for (const child of descendants[id] ?? []) if (callback(child)) break; },
    enumNodeFragments(id, callback) { for (const fragId of fragmentIds[id] ?? []) callback(fragId); },
  };
  const fragments = {
    getGeometry: id => geometries[id], getWorldMatrix() {}, getMaterial: id => originalMaterials[id],
  };
  const model = { getInstanceTree: () => tree, getFragmentList: () => fragments };
  const viewer = {
    model, isolated: [], preference,
    prefs: { get(key) { assert.equal(key, 'ghosting'); return viewer.preference; } },
    impl: {
      fadeMaterial: baseFade, showGhosting: renderPass,
      toggleGhosting(enabled) { calls.push(['render-pass', enabled]); this.showGhosting = enabled; },
      invalidate() {},
    },
    setGhosting(enabled) {
      calls.push(['preference', enabled]);
      // Like the pinned SDK, an unchanged preference does not notify its listener.
      if (this.preference === enabled) return;
      this.preference = enabled; this.impl.toggleGhosting(enabled);
    },
    isolate(ids, selectedModel) {
      assert.equal(selectedModel, model); this.isolated = [...ids]; calls.push(['isolate', [...ids]]);
      if (resetPassOnIsolation) this.impl.toggleGhosting(false);
    },
    clearSelection() {},
    fitToView(ids = [], selectedModel) { if (selectedModel) assert.equal(selectedModel, model); calls.push(['fit', [...ids]]); },
    overlays: {
      addScene() {}, removeScene() {},
      addMesh(mesh) { meshes.push(mesh); },
      removeMesh(mesh) { const index = meshes.indexOf(mesh); if (index >= 0) meshes.splice(index, 1); },
    },
  };
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    copy(value) { this.x = value.x; this.y = value.y; this.z = value.z; return this; }
    sub(value) { this.x -= value.x; this.y -= value.y; this.z -= value.z; return this; }
    add(value) { this.x += value.x; this.y += value.y; this.z += value.z; return this; }
    multiplyScalar(value) { this.x *= value; this.y *= value; this.z *= value; return this; }
    length() { return Math.hypot(this.x, this.y, this.z); }
  }
  class Resource {
    constructor(options) { if (options && typeof options === 'object') Object.assign(this, options); }
    dispose() { disposed.push(this); }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry; this.material = material; this.position = new Vector3();
      this.scale = { set() {} }; this.quaternion = { setFromUnitVectors() {} };
    }
  }
  const savedWindow = globalThis.window, savedAutodesk = globalThis.Autodesk;
  globalThis.window = { THREE: { Vector3, Matrix4: class {}, MeshBasicMaterial: Resource, CylinderGeometry: Resource, SphereGeometry: Resource, Mesh } };
  globalThis.Autodesk = { Viewing: { Private: { enumMeshVertices(points, callback) { for (const [x, y, z] of points) callback({ x, y, z }); } } } };
  t.after(() => { globalThis.window = savedWindow; globalThis.Autodesk = savedAutodesk; });
  const controller = createRouteController(viewer);
  return { controller, viewer, calls, meshes, disposed, baseFade, initialVariant, model, originalMaterials, beforeMaterials };
}

test('enforces the Ghost render pass without reducing native material opacity when a true preference does not notify', async t => {
  const f = fixture(t, { preference: true, renderPass: false, resetPassOnIsolation: true });
  const result = await f.controller.showRoute('BC1/BC2');
  assert.equal(result.drawableCount, 2); assert.equal(result.lineCount, 1);
  assert.deepEqual(f.viewer.isolated, [2, 3]);
  assert.equal(f.viewer.preference, true); assert.equal(f.viewer.impl.showGhosting, true);
  assert.equal(f.baseFade.opacity, 0.1); assert.equal(f.initialVariant.opacity, 0.3);
  assert.ok(f.calls.findIndex(call => call[0] === 'isolate') < f.calls.findLastIndex(call => call[0] === 'render-pass' && call[1] === true));
  assert.deepEqual(f.originalMaterials, f.beforeMaterials);
  assert.ok(f.meshes.length > 0);
  for (const mesh of f.meshes) {
    assert.equal(mesh.material.color, 0xffe600); assert.equal(mesh.material.depthTest, false); assert.equal(mesh.material.depthWrite, false); assert.equal(mesh.renderOrder, 1000);
  }
  f.controller.clearRoute();
  assert.deepEqual(f.viewer.isolated, []); assert.equal(f.viewer.impl.showGhosting, false); assert.equal(f.viewer.preference, true);
  assert.equal(f.baseFade.opacity, 0.1); assert.equal(f.initialVariant.opacity, 0.3); assert.equal(f.meshes.length, 0);
  assert.deepEqual(f.calls.at(-1), ['fit', []]);
  const before = f.calls.length; f.controller.fitRoute(); assert.equal(f.calls.length, before);
  assert.deepEqual(f.originalMaterials, f.beforeMaterials);
});

test('repeated A→B preserves native fade opacity and restores exact original preference/pass and all variants', async t => {
  const f = fixture(t, { preference: false, renderPass: false });
  await f.controller.showRoute('BC1');
  const lateVariant = { opacity: 0.65 }; f.baseFade.variants.push(lateVariant);
  await f.controller.showRoute('BC2');
  assert.deepEqual(f.viewer.isolated, [3]); assert.equal(f.viewer.impl.showGhosting, true); assert.equal(lateVariant.opacity, 0.65);
  f.controller.fitRoute(); assert.deepEqual(f.calls.at(-1), ['fit', [3]]);
  f.controller.clearRoute();
  assert.equal(f.viewer.preference, false); assert.equal(f.viewer.impl.showGhosting, false);
  assert.equal(f.baseFade.opacity, 0.1); assert.equal(f.initialVariant.opacity, 0.3); assert.equal(lateVariant.opacity, 0.65);
  assert.deepEqual(f.originalMaterials, f.beforeMaterials);
  const count = f.calls.length; f.controller.clearRoute();
  assert.equal(f.calls.slice(count).filter(call => call[0] === 'preference' || call[0] === 'render-pass').length, 0);
});

test('dispose restores the pre-route enabled pass, preference and opacity even if isolation changes the pass', async t => {
  const f = fixture(t, { preference: false, renderPass: true, resetPassOnIsolation: true });
  await f.controller.showRoute('BC1'); f.controller.dispose();
  assert.deepEqual(f.viewer.isolated, []); assert.equal(f.viewer.preference, false); assert.equal(f.viewer.impl.showGhosting, true);
  assert.equal(f.baseFade.opacity, 0.1); assert.equal(f.initialVariant.opacity, 0.3); assert.equal(f.meshes.length, 0);
  assert.equal(f.disposed.length, 3); const calls = f.calls.length; f.controller.dispose(); assert.equal(f.calls.length, calls);
});

test('Clear during a replacement route cancels its commit and cannot re-enable Ghost or old bounds', async t => {
  const f = fixture(t, { preference: false, renderPass: false });
  await f.controller.showRoute('BC1');
  const replacing = f.controller.showRoute('BC2', { onProgress: progress => { if (typeof progress === 'string') f.controller.clearRoute(); } });
  await assert.rejects(replacing, { name: 'AbortError' });
  assert.deepEqual(f.viewer.isolated, []); assert.equal(f.viewer.preference, false); assert.equal(f.viewer.impl.showGhosting, false);
  assert.equal(f.baseFade.opacity, 0.1); assert.equal(f.meshes.length, 0);
  const count = f.calls.length; f.controller.fitRoute(); assert.equal(f.calls.length, count);
});

test('dispose during route work prevents a late visual commit and does not mutate untouched state', async t => {
  const f = fixture(t, { preference: true, renderPass: false });
  const showing = f.controller.showRoute('BC1', { onProgress: progress => { if (typeof progress === 'string') f.controller.dispose(); } });
  await assert.rejects(showing, { name: 'AbortError' });
  assert.equal(f.viewer.preference, true); assert.equal(f.viewer.impl.showGhosting, false);
  assert.equal(f.baseFade.opacity, 0.1); assert.equal(f.initialVariant.opacity, 0.3);
  assert.equal(f.calls.some(call => call[0] === 'isolate' && call[1].length), false); assert.equal(f.meshes.length, 0);
});

test('a new route captures current pre-route preferences after a completed Clear', async t => {
  const f = fixture(t, { preference: false, renderPass: false });
  await f.controller.showRoute('BC1'); f.controller.clearRoute();
  f.viewer.preference = true; f.viewer.impl.showGhosting = true; f.baseFade.opacity = 0.45;
  await f.controller.showRoute('BC2'); f.controller.clearRoute();
  assert.equal(f.viewer.preference, true); assert.equal(f.viewer.impl.showGhosting, true); assert.equal(f.baseFade.opacity, 0.45);
});
