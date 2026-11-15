import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocationPointController } from '../location-point.mjs';

function fixture() {
  class Vector3 { constructor(...values) { this.set(...values); } set(...values) { this.values = values; } }
  class Box3 { points = []; expandByPoint(point) { this.points.push(point.values); } }
  class Disposable { constructor(options) { this.options = options; } dispose() { this.disposed = true; } }
  class Mesh { constructor(geometry, material) { Object.assign(this, { geometry, material, position: new Vector3() }); } }
  const THREE = { Vector3, Box3, SphereGeometry: Disposable, MeshBasicMaterial: Disposable, Mesh };
  const meshes = [], scenes = new Set(), fits = [];
  const model = { getUnitScale: () => 0.001, getUpVector: () => [0, 0, 1], getGlobalOffset: () => [1000.125, -2000.5, 3000.75] };
  const viewer = { model, overlays: { addScene: name => scenes.add(name), removeScene: name => scenes.delete(name),
    addMesh: mesh => meshes.push(mesh), removeMesh: mesh => meshes.splice(meshes.indexOf(mesh), 1) },
    navigation: { fitBounds: (animate, bounds) => fits.push({ animate, bounds }) }, impl: { invalidate() {} },
    clearSelection() { throw Error('Must preserve selection'); }, isolate() { throw Error('Must preserve isolation'); },
    setGhosting() { throw Error('Must preserve Ghost'); } };
  const abort = new AbortController(), controller = createLocationPointController(viewer, { window: { THREE }, signal: abort.signal });
  return { viewer, model, meshes, scenes, fits, controller, abort };
}
test('saved-point marker converts project metres exactly once and preserves route/visibility/selection', () => {
  const f = fixture(), route = { existing: 'route overlay' }; f.meshes.push(route);
  f.controller.show([3.001125, -1.9965, 3.00675]);
  assert.equal(f.meshes[0], route); assert.equal(f.meshes.length, 2);
  assert.ok(f.meshes[1].position.values.every((n, i) => Math.abs(n - [2001, 4, 6][i]) < 1e-9));
  assert.equal(f.meshes[1].geometry.options, 80); assert.equal(f.meshes[1].material.options.depthTest, false);
  assert.deepEqual(f.fits[0].bounds.points.map(p => p.map(Math.round)), [[1251, -746, -744], [2751, 754, 756]]);
  assert.deepEqual([...f.scenes], ['wfc-location-point']);
});
test('next point replaces and releases only its own marker; clear and unload dispose exactly that scene', () => {
  const f = fixture(), route = { route: true }; f.meshes.push(route);
  f.controller.show([1, 2, 3]); const first = f.meshes[1];
  f.controller.show([2, 3, 4]); assert.equal(first.geometry.disposed, true); assert.equal(first.material.disposed, true);
  assert.equal(f.meshes.length, 2); const second = f.meshes[1]; f.controller.clear();
  assert.deepEqual(f.meshes, [route]); assert.equal(second.geometry.disposed, true); assert.equal(f.scenes.size, 0);
  f.controller.show([1, 2, 3]); const third = f.meshes[1]; f.controller.dispose(); f.controller.dispose();
  assert.deepEqual(f.meshes, [route]); assert.equal(third.material.disposed, true);
  assert.throws(() => f.controller.show([1, 2, 3]), { name: 'AbortError' });
});
test('bad coordinates, unsupported frames, changed model and aborted load never move the camera', () => {
  const f = fixture();
  for (const point of [[NaN, 0, 0], [Infinity, 1, 2], [1e9 + 1, 0, 0], [1, 2], ['1', 2, 3]]) assert.throws(() => f.controller.show(point), { code: 'LOCATION_UNAVAILABLE' });
  f.model.getUpVector = () => [0, 1, 0]; assert.throws(() => f.controller.show([1, 2, 3]), { code: 'COORDINATES_UNSUPPORTED' });
  f.viewer.model = {}; assert.throws(() => f.controller.show([1, 2, 3]), { code: 'MODEL_SELECTION_CHANGED' });
  f.viewer.model = f.model; f.abort.abort(); assert.throws(() => f.controller.show([1, 2, 3]), { name: 'AbortError' });
  assert.equal(f.fits.length, 0); assert.equal(f.meshes.length, 0);
});
