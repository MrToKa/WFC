import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteController } from '../routes.mjs';

const bindings = (roots = ['dbid:2', 'dbid:3']) => ({
  schemaVersion: 'wfc.viewer.routing-bindings.v1', modelVersionId: '22222222-2222-4222-8222-222222222222',
  contentFingerprint: 'a'.repeat(64), selectionRevision: '12', aggregateId: '33333333-3333-4333-8333-333333333333',
  bindings: [{ routeName: '/A105', rootObjectIds: roots }],
});

function fixture(t, nodes = { 1: { name: 'Model', parent: null }, 2: { name: '/A105-x', parent: 1, fragment: true }, 3: { name: '/A105-y', parent: 1, fragment: true } }) {
  const previous = { window: globalThis.window, Autodesk: globalThis.Autodesk };
  const facts = { isolates: [], fits: [], meshes: [], removed: [], vertices: [], disposed: 0, materialWrites: 0 };
  class Vector {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(value) { return this.set(value.x, value.y, value.z); }
    clone() { return new Vector(this.x, this.y, this.z); }
    add(value) { return this.set(this.x + value.x, this.y + value.y, this.z + value.z); }
    sub(value) { return this.set(this.x - value.x, this.y - value.y, this.z - value.z); }
    multiplyScalar(value) { return this.set(this.x * value, this.y * value, this.z * value); }
    length() { return Math.hypot(this.x, this.y, this.z); }
  }
  class Resource { constructor(options) { this.options = options; } dispose() { facts.disposed++; } }
  class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.position = new Vector(); this.scale = new Vector(); this.quaternion = { setFromUnitVectors() {} }; } }
  const tree = {
    getRootId: () => 1, getNodeParentId: id => nodes[id]?.parent, getNodeName: id => nodes[id]?.name,
    getChildCount: id => Object.values(nodes).filter(value => value.parent === id).length,
    enumNodeChildren(id, callback, recursive) {
      const visit = parent => {
        for (const key of Object.keys(nodes)) if (nodes[key].parent === parent) {
          const child = Number(key); if (callback(child)) return true;
          if (recursive && visit(child)) return true;
        }
        return false;
      };
      visit(id);
    },
    enumNodeFragments(id, callback) { if (nodes[id]?.fragment) callback(id); },
  };
  const model = { getInstanceTree: () => tree, getFragmentList: () => ({ getGeometry: id => ({ id }), getWorldMatrix() {} }) };
  const viewer = { model, prefs: { get: () => true },
    impl: { showGhosting: false, fadeMaterial: { opacity: 0.4, variants: [{ opacity: 0.5 }] }, toggleGhosting(value) { this.showGhosting = value; }, invalidate() {} },
    overlays: { addScene() {}, removeScene() {}, addMesh(mesh) { facts.meshes.push(mesh); }, removeMesh(mesh) { facts.removed.push(mesh); } },
    isolate(ids) { facts.isolates.push(ids); }, fitToView(ids) { facts.fits.push(ids); }, clearSelection() {}, setGhosting() {}, setThemingColor() { facts.materialWrites++; },
  };
  globalThis.window = { THREE: { Matrix4: class {}, Vector3: Vector, MeshBasicMaterial: Resource, CylinderGeometry: Resource, SphereGeometry: Resource, Mesh } };
  globalThis.Autodesk = { Viewing: { Private: { enumMeshVertices(geometry, callback) {
    facts.vertices.push(geometry.id);
    const start = (geometry.id - 2) * 10;
    for (const x of [start, start + 10]) for (const y of [-0.2, 0.2]) for (const z of [-0.05, 0.05]) callback({ x, y, z });
  } } } };
  const controller = createRouteController(viewer);
  t.after(() => { controller.dispose(); Object.assign(globalThis, previous); });
  return { controller, viewer, tree, facts, nodes };
}

test('published multiple roots resolve one unchanged project code without suffix guessing', async t => {
  const f = fixture(t);
  const missing = await f.controller.showRoute('/A105');
  assert.equal(missing.segments[0].status, 'missing'); assert.equal(missing.lineCount, 0);
  const result = await f.controller.showRoute('/A105', { routingBindings: bindings() });
  assert.equal(result.segments.length, 1); assert.equal(result.segments[0].status, 'found');
  assert.equal(result.segments[0].count, 1); assert.equal(result.segments[0].mapped, true); assert.equal(result.segments[0].drawable, true);
  assert.deepEqual(result.segments[0].ids, [2, 3]); assert.equal(result.matchedCount, 1); assert.equal(result.drawableCount, 1); assert.ok(result.lineCount > 0);
  assert.deepEqual(f.facts.isolates.at(-1), [2, 3]); assert.deepEqual(f.facts.fits.at(-1), [2, 3]);
  assert.deepEqual(f.facts.vertices, [2, 3]);
});

test('mapped leaf geometry keeps original colors, a yellow line and filled Ghost; Clear restores appearance', async t => {
  const f = fixture(t); await f.controller.showRoute('/A105', { routingBindings: bindings(['dbid:2']) });
  assert.equal(f.facts.materialWrites, 0); assert.ok(f.facts.meshes.length > 0);
  assert.ok(f.facts.meshes.every(mesh => mesh.material.options.color === 0xffe600));
  assert.equal(f.viewer.impl.showGhosting, true); assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.025);
  assert.equal(f.viewer.impl.fadeMaterial.variants[0].opacity, 0.025);
  f.controller.clearRoute();
  assert.deepEqual(f.facts.isolates.at(-1), []); assert.equal(f.viewer.impl.showGhosting, false);
  assert.equal(f.viewer.impl.fadeMaterial.opacity, 0.4); assert.equal(f.viewer.impl.fadeMaterial.variants[0].opacity, 0.5);
  assert.equal(f.facts.removed.length, f.facts.meshes.length); assert.equal(f.facts.disposed, 3);
});

test('unmapped routes retain exact normalized-name fallback and occurrence order', async t => {
  const f = fixture(t); const response = { ...bindings(), bindings: [] };
  const result = await f.controller.showRoute('/A105-x/A105-x/MISSING', { routingBindings: response });
  assert.deepEqual(result.segments.map(value => [value.token, value.status, value.count, value.mapped]), [['A105-x', 'found', 1, undefined], ['A105-x', 'found', 1, undefined], ['MISSING', 'missing', 0, undefined]]);
  assert.deepEqual(f.facts.isolates.at(-1), [2]);
});

test('missing/global/nested mapped roots fail before isolation or geometry reads', async t => {
  const f = fixture(t);
  for (const roots of [['dbid:999'], ['dbid:1']]) await assert.rejects(f.controller.showRoute('/A105', { routingBindings: bindings(roots) }), { code: 'ROUTING_BINDINGS_INVALID' });
  f.nodes[3].parent = 2;
  await assert.rejects(f.controller.showRoute('/A105', { routingBindings: bindings() }), { code: 'ROUTING_BINDINGS_INVALID' });
  assert.equal(f.facts.vertices.length, 0); assert.equal(f.facts.isolates.length, 0);
});

test('ancestry is checked for cycles, unavailable parents and exact-fallback overlaps', async t => {
  const f = fixture(t); await f.controller.prepareIndex();
  f.tree.getNodeParentId = id => id === 2 ? 3 : id === 3 ? 2 : null;
  await assert.rejects(f.controller.showRoute('/A105', { routingBindings: bindings(['dbid:2']) }), { code: 'ROUTING_BINDINGS_INVALID' });
  f.tree.getNodeParentId = () => undefined;
  await assert.rejects(f.controller.showRoute('/A105', { routingBindings: bindings(['dbid:2']) }), { code: 'ROUTING_BINDINGS_INVALID' });
  f.tree.getNodeParentId = id => id === 3 ? 2 : id === 2 ? 1 : null;
  await assert.rejects(f.controller.showRoute('/A105/A105-y', { routingBindings: bindings(['dbid:2']) }), { code: 'ROUTING_BINDINGS_INVALID' });
  assert.equal(f.facts.vertices.length, 0); assert.equal(f.facts.isolates.length, 0);
});

test('all published ownership is checked even when the requested route uses an unmapped name', async t => {
  const f = fixture(t);
  await assert.rejects(f.controller.showRoute('/A105-x', { routingBindings: bindings(['dbid:999']) }), { code: 'ROUTING_BINDINGS_INVALID' });
  assert.equal(f.facts.isolates.length, 0);
});

test('logical multi-root segments retain the shared 128-profile budget', async t => {
  const nodes = { 1: { name: 'Model', parent: null }, 2: { name: '/A105-x', parent: 1 }, 3: { name: '/A105-y', parent: 1 } };
  for (let i = 0; i < 129; i++) nodes[i + 4] = { name: `Part-${i}`, parent: i < 65 ? 2 : 3, fragment: true };
  const f = fixture(t, nodes);
  await assert.rejects(f.controller.showRoute('/A105', { routingBindings: bindings() }), { code: 'ROUTING_BINDINGS_INVALID' });
  assert.equal(f.facts.isolates.length, 0);
});

test('published roots cannot bypass the existing 1,024-descendant bound', async t => {
  const nodes = { 1: { name: 'Model', parent: null }, 2: { name: '/A105-x', parent: 1 } };
  for (let i = 0; i < 1025; i++) nodes[i + 3] = { name: `Part-${i}`, parent: 2 };
  const f = fixture(t, nodes);
  await assert.rejects(f.controller.showRoute('/A105', { routingBindings: bindings(['dbid:2']) }));
  assert.equal(f.facts.isolates.length, 0); assert.equal(f.facts.vertices.length, 0);
});
