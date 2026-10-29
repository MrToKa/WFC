import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { enumerateTriangleIndices } from '../mesh-indices.mjs';

// Execute the exact checked-in 7.130.0 triangle enumerator, rather than a
// rewritten expectation of SDK control flow. Only its vertex/normal/index
// accessors and reusable vector type are supplied by this isolated fixture.
const sdk = await fs.readFile(new URL('../../../../viewer-runtime/sdk/7.130.0/viewer3D.min.js', import.meta.url), 'utf8');
const start = sdk.indexOf('function jh(e,t){');
const end = sdk.indexOf('function Kh(e,t){', start);
assert.ok(start >= 0 && end > start, 'Pinned SDK enumMeshTriangles implementation changed; audit its callback contract.');
class FixtureVector { constructor() { this.x = 0; this.y = 0; this.z = 0; } }
const enumMeshTriangles = vm.runInNewContext('(' + sdk.slice(start, end) + ')', {
  Dh: null, Uh: null, Rh: null, Fh: null, Oh: null, Nh: null,
  oh: { LmvVector3: FixtureVector },
  Gh: geometry => (index, output) => {
    assert.ok(index >= 0 && index < geometry.vertices.length, 'SDK requested a vertex outside the fixture.');
    [output.x, output.y, output.z] = geometry.vertices[index];
  },
  Hh: () => null,
  zh: geometry => geometry.indices ?? null,
  Th: geometry => geometry.vertices.length
});
const reader = { enumMeshTriangles };
const vertices = count => Array.from({ length: count }, (_, index) => [index, index % 3, 0]);
const collect = geometry => { const output = []; enumerateTriangleIndices(geometry, reader, (...indices) => output.push(indices)); return output; };

test('one nonindexed triangle visits exactly the three original vertices', () => {
  assert.deepEqual(collect({ vertices: vertices(3) }), [[0, 1, 2]]);
});

test('multiple nonindexed triangles retain contiguous original index order', () => {
  assert.deepEqual(collect({ vertices: vertices(9) }), [[0, 1, 2], [3, 4, 5], [6, 7, 8]]);
});

test('indexed triangles retain winding and repeated shared indices', () => {
  assert.deepEqual(collect({ vertices: vertices(4), indices: [2, 0, 1, 2, 1, 3] }), [[2, 0, 1], [2, 1, 3]]);
});

test('indexed SDK groups retain group order and base-vertex offsets', () => {
  assert.deepEqual(collect({ vertices: vertices(8), indices: [0, 1, 2, 2, 1, 0],
    groups: [{ start: 3, count: 3, index: 4 }, { start: 0, count: 3, index: 1 }] }), [[6, 5, 4], [1, 2, 3]]);
});

test('missing pinned triangle API is an explicit failure', () => {
  assert.throws(() => enumerateTriangleIndices({}, {}, () => {}), /triangle enumeration API unavailable/);
});

const actualPart = process.env.PF_MESH_INDEX_ACTUAL_PART;
test('indexed actual captured fragment indices remain byte-order identical', { skip: !actualPart }, async () => {
  const captured = JSON.parse(await fs.readFile(actualPart, 'utf8'));
  assert.equal(captured.schemaVersion, 'pathfinder.converted.mesh-object.v1');
  assert.ok(captured.object.fragments.length > 0);
  for (const fragment of captured.object.fragments) {
    const enumerated = collect({ vertices: fragment.vertices, indices: fragment.triangleIndices }).flat();
    assert.deepEqual(enumerated, fragment.triangleIndices, fragment.id);
  }
});
