import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { profileGeometry, buildRouteLines } from '../route-geometry.mjs';

const actualC = JSON.parse(readFileSync(new URL('./fixtures/route-c-regression.json', import.meta.url), 'utf8'));

const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
function tube(a, b, width = 0.2, name = 'FTUBE', id = 1, height = width) {
  const axis = b.map((v, i) => v - a[i]), length = Math.hypot(...axis), u = axis.map(v => v / length);
  let v = Math.abs(u[2]) < 0.9 ? [-u[1], u[0], 0] : [1, 0, 0];
  const n = Math.hypot(...v); v = v.map(x => x / n);
  const w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const points = [];
  for (const p of [a, b]) for (const s of [-1, 1]) for (const t of [-1, 1]) points.push(p.map((value, i) => value + width / 2 * s * v[i] + height / 2 * t * w[i]));
  return profileGeometry(points, { name, id });
}
function bend(id = 2) {
  const points = [];
  for (let i = 0; i <= 24; i++) for (const radius of [0.9, 1.1]) for (const z of [-0.1, 0.1]) {
    const theta = -Math.PI / 2 + Math.PI / 2 * i / 24;
    points.push([radius * Math.cos(theta), 1 + radius * Math.sin(theta), z]);
  }
  return profileGeometry(points, { name: 'BEND 90', id });
}

test('straight centreline follows a rotated prism axis rather than its world bounding box diagonal', () => {
  const p = tube([3, 4, 5], [7, 7, 7]);
  assert.equal(p.kind, 'straight');
  const endpoints = [p.start, p.end].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < 3; i++) { near(endpoints[0][i], [3, 4, 5][i]); near(endpoints[1][i], [7, 7, 7][i]); }
  near(p.width, 0.2);
});

test('duplicate mesh vertices do not pull the centreline toward a frequently triangulated corner', () => {
  const p = tube([0, 0, 0], [10, 0, 0]);
  const points = [...p.points, ...Array.from({ length: 200 }, () => p.points[0])];
  const duplicate = profileGeometry(points, { name: 'FTUBE' });
  near(duplicate.start[1], 0); near(duplicate.start[2], 0); near(duplicate.end[1], 0); near(duplicate.end[2], 0);
});

test('a curved mesh has a sampled arc rather than a straight chord', () => {
  const p = bend();
  assert.equal(p.kind, 'bend');
  assert.equal(p.method, 'mesh-arc');
  assert.ok(p.centerline.length > 12);
  assert.ok(p.centerline.some(point => point[0] > 0.65 && point[1] < 0.35));
});

test('pieces within each identifier are reordered and oriented while preserving identifier order', () => {
  const a = tube([0, 0, 0], [3, 0, 0], 0.2, 'FTUBE', 1);
  const b = tube([3, 0, 0], [6, 0, 0], 0.2, 'FTUBE', 2);
  const c = tube([6, 0, 0], [9, 0, 0], 0.2, 'FTUBE', 3);
  const route = buildRouteLines([{ token: 'A', profiles: [a] }, { token: 'B', profiles: [c, b] }]);
  assert.equal(route.polylines.length, 1);
  assert.deepEqual(route.diagnostics.order.map(p => p.id), [1, 2, 3]);
  near(route.polylines[0][0][0], 0); near(route.polylines[0].at(-1)[0], 9);
});

test('a 90-degree bend joins adjacent straight ports tangentially', () => {
  const a = tube([-3, 0, 0], [0, 0, 0], 0.2, 'FTUBE', 1);
  const arc = bend(2);
  const b = tube([1, 1, 0], [1, 4, 0], 0.2, 'FTUBE', 3);
  const route = buildRouteLines([{ token: 'A', profiles: [a] }, { token: 'B', profiles: [b, arc] }]);
  assert.equal(route.polylines.length, 1);
  assert.equal(route.diagnostics.bends.interpolated, 1);
  assert.ok(route.polylines[0].some(p => p[0] > 0.65 && p[0] < 0.8 && p[1] > 0.2 && p[1] < 0.4));
  assert.equal(route.warnings.length, 0);
});

test('disconnected pieces remain one continuous yellow line with a recorded connector', () => {
  const a = tube([0, 0, 0], [3, 0, 0], 0.2, 'FTUBE', 1);
  const b = tube([20, 0, 0], [24, 0, 0], 0.2, 'FTUBE', 2);
  const route = buildRouteLines([{ token: 'A', profiles: [a] }, { token: 'B', profiles: [b] }]);
  assert.equal(route.polylines.length, 1);
  assert.equal(route.diagnostics.breaks.length, 0);
  assert.equal(route.diagnostics.connectors.length, 1);
  assert.equal(route.warnings.length, 0);
  assert.deepEqual(route.polylines[0].map(point => Math.round(point[0])), [0, 3, 20, 24]);
});

test('coordinate scale does not change route topology', () => {
  for (const factor of [0.001, 1000]) {
    const a = tube([0, 0, 0], [3 * factor, 0, 0], 0.2 * factor, 'FTUBE', 1);
    const b = tube([3 * factor, 0, 0], [6 * factor, 0, 0], 0.2 * factor, 'FTUBE', 2);
    assert.equal(buildRouteLines([{ token: 'A', profiles: [a, b] }]).polylines.length, 1);
  }
});

test('an unresolved identifier is omitted while the known pieces remain connected', () => {
  const a = tube([0, 0, 0], [3, 0, 0], 0.2, 'FTUBE', 1);
  const b = tube([3, 0, 0], [6, 0, 0], 0.2, 'FTUBE', 2);
  const route = buildRouteLines([{ token: 'A', profiles: [a] }, { token: 'UNKNOWN', profiles: [] }, { token: 'B', profiles: [b] }]);
  assert.equal(route.polylines.length, 1);
  assert.deepEqual(route.diagnostics.omittedTokens, ['UNKNOWN']);
  assert.equal(route.diagnostics.breaks.length, 0);
  assert.equal(route.diagnostics.profileCount, 2);
  assert.equal(route.warnings.length, 0);
});

test('empty routes and malformed geometry are handled predictably', () => {
  assert.deepEqual(buildRouteLines([]).polylines, []);
  assert.throws(() => profileGeometry([[NaN, 1, 2]], { name: 'FTUBE' }), /Липсва геометрия/);
});

test('short wide tray pieces use the section dimensions instead of travelling across their width', () => {
  const long = tube([0, 0, 0], [3, 0, 0], 0.64, 'FTUBE', 1, 0.1);
  const short = tube([3, 0, 0], [3.171, 0, 0], 0.64, 'FTUBE', 2, 0.1);
  const route = buildRouteLines([{ token: 'A', profiles: [long] }, { token: 'B', profiles: [short] }]);
  assert.equal(route.polylines.length, 1);
  assert.ok(route.polylines[0].every(point => Math.abs(point[1]) < 1e-6));
  near(route.polylines[0].at(-1)[0], 3.171);
});

test('a branch meeting a longer tray clips its entry at the interior junction', () => {
  const branch = tube([0, -3, 0], [0, -0.2, 0], 0.64, 'FTUBE', 1, 0.1);
  const through = tube([-1, 0, 0], [3, 0, 0], 0.64, 'FTUBE', 2, 0.1);
  const route = buildRouteLines([{ token: 'A', profiles: [branch] }, { token: 'B', profiles: [through] }]);
  assert.equal(route.polylines.length, 1);
  assert.ok(route.polylines[0].every(point => point[0] >= -1e-6));
  assert.ok(route.polylines[0].some(point => Math.hypot(point[0], point[1], point[2]) < 1e-6));
});

test('entry to a vertical riser is clipped to the route elevation', () => {
  const horizontal = tube([-3, 0, 0], [0, 0, 0], 0.64, 'FTUBE', 1, 0.1);
  const vertical = tube([0, 0, -2], [0, 0, 3], 0.64, 'FTUBE', 2, 0.1);
  const route = buildRouteLines([{ token: 'A', profiles: [horizontal] }, { token: 'B', profiles: [vertical] }]);
  assert.equal(route.polylines.length, 1);
  assert.ok(route.polylines[0].every(point => point[2] >= -1e-6));
});

test('a real gap does not make the next group double back over its short first piece', () => {
  const beforeGap = tube([1.5, 2, -2], [1.5, 2, 1], 0.64, 'FTUBE', 1, 0.1);
  const short = tube([0, 0, 0], [0.171, 0, 0], 0.64, 'FTUBE', 2, 0.1);
  const long = tube([0.171, 0, 0], [4, 0, 0], 0.64, 'FTUBE', 3, 0.1);
  const route = buildRouteLines([{ token: 'A', profiles: [beforeGap] }, { token: 'B', profiles: [long, short] }]);
  assert.equal(route.polylines.length, 1);
  assert.equal(route.diagnostics.connectors.length, 1);
  const ordered = route.diagnostics.order.filter(piece => piece.token === 'B');
  assert.ok((ordered[0].end[0] - ordered[0].start[0]) * (ordered[1].end[0] - ordered[1].start[0]) > 0);
});

test('a riser connects directly to the interior of a later piece and skips the group prefix', () => {
  const riser = tube([5.524287, 11.50713, -1.195], [5.524287, 11.50713, 0.905], 0.64, 'FTUBE', 1, 0.1);
  const short = tube([4.555096, 10.43413, 1.28], [4.726096, 10.43413, 1.28], 0.64, 'FTUBE', 2, 0.1);
  const long = tube([4.726096, 10.43413, 1.28], [7.726096, 10.43413, 1.28], 0.64, 'FTUBE', 3, 0.1);
  const outgoing = tube([7.726096, 10.43413, 1.28], [10.685096, 10.43413, 1.28], 0.64, 'FTUBE', 4, 0.1);
  const route = buildRouteLines([{ token: 'B002', profiles: [riser] }, { token: 'B107-1', profiles: [short, long] }, { token: 'B107-2', profiles: [outgoing] }]);
  const target = route.diagnostics.groupClips.find(group => group.token === 'B107-1');
  near(target.entry[0], 5.524287); near(target.entry[1], 10.43413); near(target.entry[2], 1.28);
  assert.deepEqual(target.skippedProfileIds, [2]);
  assert.equal(route.polylines.length, 1);
  assert.ok(route.polylines[0].every(point => point[0] >= 5.524287 - 1e-6));
  const connector = route.diagnostics.connectors.find(item => item.to === 'B107-1');
  near(connector.fromPoint[0], connector.toPoint[0]);
});

test('a group exits at an interior junction before unused suffix pieces', () => {
  const first = tube([0, 0, 0], [3, 0, 0], 0.64, 'FTUBE', 1, 0.1);
  const suffix = tube([3, 0, 0], [4, 0, 0], 0.64, 'FTUBE', 2, 0.1);
  const next = tube([2, 2, 0], [2, 5, 0], 0.64, 'FTUBE', 3, 0.1);
  const route = buildRouteLines([{ token: 'A', profiles: [first, suffix] }, { token: 'B', profiles: [next] }]);
  const source = route.diagnostics.groupClips[0];
  near(source.exit[0], 2); near(source.exit[1], 0);
  assert.deepEqual(source.skippedProfileIds, [2]);
  assert.ok(route.polylines[0].every(point => point[0] <= 2 + 1e-6));
});

test('a wide 30-degree bend is fitted using concentric edges instead of a biased single circle', () => {
  const points = [];
  for (let i = 0; i <= 24; i++) for (const radius of [0.68, 1.32]) for (const z of [-0.05, 0.05]) {
    const angle = -Math.PI / 2 + Math.PI / 6 * i / 24;
    points.push([radius * Math.cos(angle), 1 + radius * Math.sin(angle), z]);
  }
  const profile = profileGeometry(points, { name: '/BEND_30_1_of_PIPE_A' });
  assert.equal(profile.method, 'mesh-arc');
  for (const point of profile.centerline) near(Math.hypot(point[0], point[1] - 1), 1, 1e-5);
});

test('a vertical approach does not bend a horizontal elbow out of its own plane', () => {
  const vertical = tube([0, 0, -3], [0, 0, 0], 0.2, 'FTUBE', 1, 0.1);
  const arc = bend(2);
  const outgoing = tube([1, 1, 0], [1, 4, 0], 0.2, 'FTUBE', 3, 0.1);
  const route = buildRouteLines([{ token: 'A', profiles: [vertical] }, { token: 'B', profiles: [arc, outgoing] }]);
  assert.equal(route.diagnostics.bends.interpolated, 0);
  assert.equal(route.diagnostics.bends.meshFit, 1);
  assert.ok(route.polylines.flat().filter(point => point[0] > 0.01).every(point => Math.abs(point[2]) < 1e-6));
});

test('actual consecutive DFC trays retain their physical chains and join the riser near the far end', () => {
  const route = buildRouteLines(actualC.linearGroups);
  const clips = new Map(route.diagnostics.groupClips.map(group => [group.token, group]));
  assert.equal(route.polylines.length, 1);
  for (const token of ['DFC001', 'DFC002', 'DFC003']) {
    const group = clips.get(token);
    assert.ok(Math.abs(group.exit[0] - group.entry[0]) > 2, `${token} collapsed to a point or lost its long component`);
  }
  const junction = route.diagnostics.junctions.find(item => item.from === 'DFC003');
  near(junction.fromPoint[0], 5.524287223815918); near(junction.fromPoint[1], 12.302129745483398);
  near(junction.toPoint[0], 5.524287223815918); near(junction.toPoint[1], 11.20712947845459);
  near(junction.distance, 1.0950002670288086);
  assert.ok(!route.diagnostics.connectors.some(item => item.from === 'DFC001' || item.from === 'DFC002'));
});

test('actual reversed terminal BC023-4 extends from its entry to its far endpoint', () => {
  const route = buildRouteLines(actualC.terminalGroups);
  const terminal = route.diagnostics.groupClips.at(-1);
  assert.equal(terminal.token, 'BC023-4');
  near(terminal.entry[0], 15.645326554775238); near(terminal.exit[0], 17.145326673984528);
  assert.deepEqual(terminal.skippedProfileIds, []);
  near(route.polylines[0].at(-1)[0], 17.145326673984528);
});

test('a reversed first group starts at the endpoint farthest from its outgoing junction', () => {
  const first = tube([0, 0, 0], [5, 0, 0], 0.64, 'FTUBE', 1, 0.1);
  const next = tube([0.5, 2, 0], [0.5, 5, 0], 0.64, 'FTUBE', 2, 0.1);
  const route = buildRouteLines([{ token: 'A', profiles: [first] }, { token: 'B', profiles: [next] }]);
  near(route.polylines[0][0][0], 5);
  near(route.diagnostics.groupClips[0].exit[0], 0.5);
});
