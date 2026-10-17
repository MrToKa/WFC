const EPSILON = 1e-9;
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, s) => a.map(v => v * s);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const norm = a => Math.hypot(...a);
const unit = a => { const n = norm(a); return n > EPSILON ? scale(a, 1 / n) : [1, 0, 0]; };
const distance = (a, b) => norm(sub(a, b));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function boundsOf(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], point[i]); max[i] = Math.max(max[i], point[i]); }
  return { min, max };
}

// Jacobi diagonalisation is stable for axis-aligned geometry and repeated eigenvalues.
function principalAxes(points, center) {
  const a = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (const point of points) {
    const p = sub(point, center);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += p[i] * p[j];
  }
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let iteration = 0; iteration < 32; iteration++) {
    let p = 0, q = 1;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) <= Math.max(EPSILON, Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2])) * 1e-12) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle);
    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    for (let k = 0; k < 3; k++) if (k !== p && k !== q) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = a[p][k] = c * akp - s * akq;
      a[k][q] = a[q][k] = s * akp + c * akq;
    }
    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = a[q][p] = 0;
    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p], vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
  }
  return [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]).map(i => unit(v.map(row => row[i])));
}

function project(point, center, axes) { const p = sub(point, center); return axes.map(axis => dot(p, axis)); }
function unproject(point, center, axes) { return axes.reduce((p, axis, i) => add(p, scale(axis, point[i])), center.slice()); }

function stableNormal(points, proposed) {
  let normal = proposed, lo = Infinity, hi = -Infinity;
  for (const point of points) { const value = dot(point, proposed); lo = Math.min(lo, value); hi = Math.max(hi, value); }
  let thickness = hi - lo;
  const bounds = boundsOf(points);
  for (let i = 0; i < 3; i++) {
    const range = bounds.max[i] - bounds.min[i];
    if (range <= thickness * (1 + 1e-7)) { normal = [0, 0, 0]; normal[i] = 1; thickness = range; }
  }
  return normal;
}

function planarRectangle(points, center, axes) {
  const normal = stableNormal(points, axes[2]);
  const u = unit(sub(axes[0], scale(normal, dot(axes[0], normal)))), v = unit(cross(normal, u));
  const base = [u, v, normal], local = points.map(p => project(p, center, base));
  const projected = new Map(), precision = Math.max(distance(boundsOf(local).min, boundsOf(local).max) * 1e-7, 1e-10);
  for (const p of local) projected.set(`${Math.round(p[0] / precision)},${Math.round(p[1] / precision)}`, [p[0], p[1]]);
  const sorted = [...projected.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lower = [], upper = [];
  for (const p of sorted) { while (lower.length >= 2 && turn(lower.at(-2), lower.at(-1), p) <= 1e-12) lower.pop(); lower.push(p); }
  for (const p of [...sorted].reverse()) { while (upper.length >= 2 && turn(upper.at(-2), upper.at(-1), p) <= 1e-12) upper.pop(); upper.push(p); }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let best;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length], d = [q[0] - p[0], q[1] - p[1]], length = Math.hypot(...d);
    if (length < EPSILON) continue;
    const dir = d.map(value => value / length), perpendicular = [-dir[1], dir[0]];
    const rectangleAxes = [add(scale(u, dir[0]), scale(v, dir[1])), add(scale(u, perpendicular[0]), scale(v, perpendicular[1])), normal];
    const b = boundsOf(points.map(p => project(p, center, rectangleAxes))), ranges = b.max.map((value, k) => value - b.min[k]);
    const area = ranges[0] * ranges[1];
    if (!best || area < best.area * (1 - 1e-8)) best = { axes: rectangleAxes, bounds: b, ranges, area };
  }
  return best;
}

function straightOptions(points, center, axes) {
  const rectangle = planarRectangle(points, center, axes);
  if (!rectangle) return [];
  const { bounds, ranges } = rectangle;
  return [0, 1].map(along => {
    const a = bounds.min.map((value, i) => (value + bounds.max[i]) / 2), b = a.slice();
    a[along] = bounds.min[along]; b[along] = bounds.max[along];
    const start = unproject(a, center, rectangle.axes), end = unproject(b, center, rectangle.axes);
    return { start, end, axis: unit(sub(end, start)), width: ranges[1 - along], height: ranges[2], length: ranges[along], centerline: [start, end], method: 'mesh-footprint' };
  }).sort((a, b) => b.length - a.length);
}

function minimalAngularInterval(angles) {
  const sorted = angles.map(v => (v + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
  let largest = -1, end = 0;
  for (let i = 0; i < sorted.length; i++) {
    const gap = (i === sorted.length - 1 ? sorted[0] + 2 * Math.PI : sorted[i + 1]) - sorted[i];
    if (gap > largest) { largest = gap; end = i; }
  }
  const start = sorted[(end + 1) % sorted.length];
  return [start, start + 2 * Math.PI - largest];
}

function concentricCircleCenter(local, initial) {
  // Bend meshes contain several concentric flange edges. A circle through
  // three points on one edge recovers their shared centre; fitting every
  // vertex to a single circle incorrectly pulls it into a wide tray.
  const unique = [], seen = new Set();
  const box = boundsOf(local), size = Math.max(distance(box.min, box.max), EPSILON), precision = size * 1e-6;
  for (const p of local) {
    const key = `${Math.round(p[0] / precision)},${Math.round(p[1] / precision)}`;
    if (!seen.has(key)) { seen.add(key); unique.push(p); }
  }
  const sample = unique.length > 192 ? Array.from({ length: 192 }, (_, i) => unique[Math.floor(i * unique.length / 192)]) : unique;
  let best, bestScore = Infinity;
  const assess = candidate => {
    const [x, y] = candidate;
    if (![x, y].every(Number.isFinite)) return;
    const radii = sample.map(p => Math.hypot(p[0] - x, p[1] - y));
    let lo = Infinity, hi = -Infinity;
    for (const radius of radii) { lo = Math.min(lo, radius); hi = Math.max(hi, radius); }
    if (hi > size * 30 || hi <= EPSILON) return;
    const [a, b] = minimalAngularInterval(sample.map(p => Math.atan2(p[1] - y, p[0] - x))), span = b - a;
    if (span < Math.PI / 40 || span > Math.PI * 1.05) return;
    const centers = Array.from({ length: 4 }, (_, i) => lo + (hi - lo) * i / 3);
    let error = 0;
    for (let iteration = 0; iteration < 7; iteration++) {
      const sums = [0, 0, 0, 0], counts = [0, 0, 0, 0]; error = 0;
      for (const radius of radii) {
        let index = 0;
        for (let i = 1; i < 4; i++) if (Math.abs(radius - centers[i]) < Math.abs(radius - centers[index])) index = i;
        sums[index] += radius; counts[index]++; error += (radius - centers[index]) ** 2;
      }
      for (let i = 0; i < 4; i++) if (counts[i]) centers[i] = sums[i] / counts[i];
    }
    const score = error / radii.length / (size * size);
    if (score < bestScore) { bestScore = score; best = candidate; }
  };
  assess(initial);
  let seed = 8675309 + sample.length;
  const randomIndex = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * sample.length); };
  for (let attempt = 0; attempt < 384 && sample.length >= 3; attempt++) {
    const a = sample[randomIndex()], b = sample[randomIndex()], c = sample[randomIndex()];
    const bx = b[0] - a[0], by = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1], det = 2 * (bx * cy - by * cx);
    if (Math.abs(det) < size * size * 1e-8) continue;
    const bq = bx * bx + by * by, cq = cx * cx + cy * cy;
    assess([a[0] + (bq * cy - cq * by) / det, a[1] + (cq * bx - bq * cx) / det]);
  }
  return bestScore < 0.002 ? best : null;
}

function circularCenterline(local, center, axes) {
  // Algebraic circle fit in the bend plane. The two radial tray edges are
  // concentric; their midpoint radius provides a provisional centre line.
  let xx = 0, xy = 0, yy = 0, xq = 0, yq = 0;
  for (const [x, y] of local) { const q = x * x + y * y; xx += x * x; xy += x * y; yy += y * y; xq += x * q; yq += y * q; }
  const det = xx * yy - xy * xy;
  if (Math.abs(det) <= Math.max(EPSILON, xx * yy) * 1e-10) return null;
  const fitted = concentricCircleCenter(local, [(xq * yy - yq * xy) / (2 * det), (yq * xx - xq * xy) / (2 * det)]);
  if (!fitted) return null;
  const [x, y] = fitted;
  let minRadius = Infinity, maxRadius = -Infinity;
  for (const p of local) { const radius = Math.hypot(p[0] - x, p[1] - y); minRadius = Math.min(minRadius, radius); maxRadius = Math.max(maxRadius, radius); }
  const radius = (minRadius + maxRadius) / 2;
  const [start, end] = minimalAngularInterval(local.map(p => Math.atan2(p[1] - y, p[0] - x)));
  const span = end - start;
  const radialWidth = maxRadius - minRadius;
  const normalBounds = boundsOf(local);
  if (!Number.isFinite(radius) || radius <= EPSILON || span < Math.PI / 30 || span > Math.PI * 1.1 || radialWidth > radius * 1.8) return null;
  const z = (normalBounds.min[2] + normalBounds.max[2]) / 2;
  const count = Math.max(12, Math.ceil(span * 24));
  const points = Array.from({ length: count + 1 }, (_, i) => {
    const angle = start + span * i / count;
    return unproject([x + radius * Math.cos(angle), y + radius * Math.sin(angle), z], center, axes);
  });
  return { points, width: Math.max(radialWidth, normalBounds.max[2] - normalBounds.min[2]), method: 'mesh-arc' };
}

function slicedCenterline(local, center, axes) {
  const bounds = boundsOf(local), range = bounds.max[0] - bounds.min[0];
  if (range <= EPSILON) return [];
  const bins = Array.from({ length: 16 }, () => []);
  for (const point of local) bins[Math.min(bins.length - 1, Math.floor((point[0] - bounds.min[0]) / range * bins.length))].push(point);
  return bins.flatMap(bin => {
    if (!bin.length) return [];
    const b = boundsOf(bin);
    return [unproject(b.min.map((v, i) => (v + b.max[i]) / 2), center, axes)];
  });
}

export function profileGeometry(points, { id, name = '' } = {}) {
  const finite = points.filter(p => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(Number.isFinite)).map(p => p.slice(0, 3));
  if (!finite.length) throw new Error(`Липсва геометрия за ${name || id || 'елемента'}.`);
  const bounds = boundsOf(finite), diagonal = distance(bounds.min, bounds.max);
  const quantum = Math.max(diagonal * 1e-7, 1e-8), seen = new Set(), unique = [];
  for (const p of finite) {
    const key = p.map((v, i) => Math.round((v - bounds.min[i]) / quantum)).join(',');
    if (!seen.has(key)) { seen.add(key); unique.push(p); }
  }
  const center = scale(unique.reduce((sum, p) => add(sum, p), [0, 0, 0]), 1 / unique.length);
  let axes = principalAxes(unique, center);
  const normal = stableNormal(unique, axes[2]), u = unit(sub(axes[0], scale(normal, dot(axes[0], normal))));
  axes = [u, unit(cross(normal, u)), normal];
  const local = unique.map(p => project(p, center, axes));
  const localBounds = boundsOf(local);
  const transverse = [0, (localBounds.min[1] + localBounds.max[1]) / 2, (localBounds.min[2] + localBounds.max[2]) / 2];
  const start = unproject([localBounds.min[0], transverse[1], transverse[2]], center, axes);
  const end = unproject([localBounds.max[0], transverse[1], transverse[2]], center, axes);
  const kind = /\bBEND\b|BEND[_\s-]?\d/i.test(name) ? 'bend' : 'straight';
  let width = Math.max(localBounds.max[1] - localBounds.min[1], localBounds.max[2] - localBounds.min[2], diagonal * 1e-6);
  let centerline = [start, end], method = 'principal-axis', axisOptions;
  if (kind === 'straight') {
    axisOptions = straightOptions(unique, center, axes);
    if (axisOptions.length) { centerline = axisOptions[0].centerline; width = axisOptions[0].width; method = axisOptions[0].method; }
  }
  if (kind === 'bend') {
    const arc = circularCenterline(local, center, axes);
    if (arc) { centerline = arc.points; width = Math.max(arc.width, diagonal * 1e-6); method = arc.method; }
    else { const sliced = slicedCenterline(local, center, axes); if (sliced.length >= 2) centerline = sliced; method = 'mesh-slices'; }
  }
  return { id, name, kind, points: unique, centerline, start: centerline[0].slice(), end: centerline.at(-1).slice(), axis: unit(sub(centerline.at(-1), centerline[0])), center, bounds, width, method, axisOptions, normal: axes[2] };
}

const oriented = (profile, reverse) => ({ profile, reverse, start: reverse ? profile.end : profile.start, end: reverse ? profile.start : profile.end });

function calibrateSections(groups) {
  const templates = [];
  for (const profile of groups.flatMap(group => group.profiles)) {
    if (profile.kind !== 'straight') continue;
    const option = profile.axisOptions?.[0];
    const length = option?.length || distance(profile.start, profile.end), width = option?.width || profile.width;
    const ranges = profile.bounds.max.map((value, i) => value - profile.bounds.min[i]);
    const height = option?.height || Math.min(...ranges);
    if (length >= width * 4 && width > EPSILON && height > EPSILON) templates.push({ width, height });
  }
  return groups.map(group => ({ ...group, profiles: group.profiles.map(profile => {
    if (profile.kind !== 'straight' || !profile.axisOptions?.length || !templates.length) return profile;
    let best, bestScore = Infinity;
    for (const option of profile.axisOptions) for (const template of templates) {
      const score = Math.log(Math.max(option.width, EPSILON) / template.width) ** 2 + Math.log(Math.max(option.height, EPSILON) / template.height) ** 2;
      if (score < bestScore) { best = option; bestScore = score; }
    }
    return bestScore < 0.08 ? { ...profile, ...best, method: 'section-axis' } : profile;
  }) }));
}

function nearestOnSegment(point, a, b, low = 0, high = 1) {
  const direction = sub(b, a), squared = dot(direction, direction);
  const t = squared > EPSILON * EPSILON ? clamp(dot(sub(point, a), direction) / squared, low, high) : 0;
  return add(a, scale(direction, t));
}

function junctionPorts(a, b) {
  const aStraight = a.profile.kind === 'straight', bStraight = b.profile.kind === 'straight';
  const extension = Math.max(a.profile.width, b.profile.width) * 0.65;
  const aLength = Math.max(distance(a.start, a.end), EPSILON), bLength = Math.max(distance(b.start, b.end), EPSILON);
  if (!aStraight && !bStraight) return { a: a.end, b: b.start, distance: distance(a.end, b.start), trim: 0 };
  if (!aStraight) {
    const point = nearestOnSegment(a.end, b.start, b.end, -extension / bLength, 1);
    return { a: a.end, b: point, distance: distance(a.end, point), trim: distance(b.start, point) };
  }
  if (!bStraight) {
    const point = nearestOnSegment(b.start, a.start, a.end, 0, 1 + extension / aLength);
    return { a: point, b: b.start, distance: distance(point, b.start), trim: distance(a.end, point) };
  }
  const u = sub(a.end, a.start), v = sub(b.end, b.start), w = sub(a.start, b.start);
  const aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w), denominator = aa * cc - bb * bb;
  const lowA = 0, highA = 1 + extension / aLength, lowB = -extension / bLength, highB = 1;
  const candidates = [];
  const include = (pointA, pointB) => candidates.push({ a: pointA, b: pointB, distance: distance(pointA, pointB), trim: distance(a.end, pointA) + distance(b.start, pointB) });
  if (Math.abs(denominator) > aa * cc * 1e-10) {
    let t = clamp((bb * ee - cc * dd) / denominator, lowA, highA), s = clamp((aa * ee - bb * dd) / denominator, lowB, highB);
    for (let iteration = 0; iteration < 3; iteration++) {
      t = clamp((bb * s - dd) / Math.max(aa, EPSILON * EPSILON), lowA, highA);
      s = clamp((bb * t + ee) / Math.max(cc, EPSILON * EPSILON), lowB, highB);
    }
    include(add(a.start, scale(u, t)), add(b.start, scale(v, s)));
  }
  for (const pointA of [a.end, a.start]) include(pointA, nearestOnSegment(pointA, b.start, b.end, lowB, highB));
  for (const pointB of [b.start, b.end]) include(nearestOnSegment(pointB, a.start, a.end, lowA, highA), pointB);
  return candidates.reduce((best, candidate) => candidate.distance + candidate.trim * 0.002 < best.distance + best.trim * 0.002 ? candidate : best);
}

const orderingCostCache = new WeakMap();
function directionAt(step, atEnd) {
  if (step.profile.kind === 'straight') return unit(sub(step.end, step.start));
  const points = step.profile.centerline, last = points.length - 1;
  const direction = step.reverse
    ? atEnd ? sub(points[0], points[1]) : sub(points[last - 1], points[last])
    : atEnd ? sub(points[last], points[last - 1]) : sub(points[1], points[0]);
  return unit(direction);
}
function connectionCost(a, b) {
  let targets = orderingCostCache.get(a.profile);
  if (!targets) { targets = new WeakMap(); orderingCostCache.set(a.profile, targets); }
  let values = targets.get(b.profile);
  if (!values) { values = []; targets.set(b.profile, values); }
  const index = Number(a.reverse) * 2 + Number(b.reverse);
  if (values[index] === undefined) {
    const ports = junctionPorts(a, b), width = Math.max(a.profile.width, b.profile.width);
    // A connector across a genuine model gap must not bias the orientation of
    // otherwise connected pieces toward the nearer side of that empty gap.
    if (ports.distance > connectionTolerance(a.profile, b.profile)) values[index] = width * 1000;
    else {
      const backtrack = Math.max(0, -dot(directionAt(a, true), directionAt(b, false)));
      values[index] = ports.distance + ports.trim * 0.002 + backtrack * width * 2;
    }
  }
  return values[index];
}

const internalCostCache = new WeakMap();
function internalConnectionCost(a, b) {
  let targets = internalCostCache.get(a.profile);
  if (!targets) { targets = new WeakMap(); internalCostCache.set(a.profile, targets); }
  let values = targets.get(b.profile);
  if (!values) { values = []; targets.set(b.profile, values); }
  const index = Number(a.reverse) * 2 + Number(b.reverse);
  if (values[index] === undefined) {
    const backtrack = Math.max(0, -dot(directionAt(a, true), directionAt(b, false)));
    values[index] = distance(a.end, b.start) + backtrack * Math.max(a.profile.width, b.profile.width) * 2;
  }
  return values[index];
}

function coherentCandidates(candidates) {
  const minimum = candidates.reduce((value, candidate) => Math.min(value, candidate.cost), Infinity);
  const tolerance = Math.max(EPSILON, minimum * 1e-7);
  return candidates.filter(candidate => candidate.cost <= minimum + tolerance);
}

function groupCandidates(profiles) {
  if (profiles.length === 1) return [false, true].map(reverse => ({ path: [oriented(profiles[0], reverse)], cost: 0 }));
  // The supplied model has at most nine pieces per tray identifier. Bound the
  // exact search for much larger future groups, then retain a deterministic
  // nearest-port fallback rather than allocating an unbounded subset table.
  if (profiles.length > 10) {
    const candidates = [];
    for (let first = 0; first < profiles.length; first++) for (const reverse of [false, true]) {
      const path = [oriented(profiles[first], reverse)], left = profiles.filter((_, i) => i !== first);
      let cost = 0;
      while (left.length) {
        let best, bestIndex, bestDistance = Infinity;
        for (let i = 0; i < left.length; i++) for (const direction of [false, true]) {
          const next = oriented(left[i], direction), gap = internalConnectionCost(path.at(-1), next);
          if (gap < bestDistance) { best = next; bestIndex = i; bestDistance = gap; }
        }
        path.push(best); left.splice(bestIndex, 1); cost += bestDistance;
      }
      candidates.push({ path, cost });
    }
    return coherentCandidates(candidates);
  }
  const n = profiles.length, count = 1 << n, candidates = [];
  for (let first = 0; first < n; first++) for (let firstReverse = 0; firstReverse < 2; firstReverse++) {
    const states = new Map(), startKey = (1 << first) * n * 2 + first * 2 + firstReverse;
    states.set(startKey, { cost: 0, path: [oriented(profiles[first], !!firstReverse)] });
    for (let mask = 1; mask < count; mask++) {
      if (!(mask & (1 << first))) continue;
      for (let last = 0; last < n; last++) for (let reverse = 0; reverse < 2; reverse++) {
        const state = states.get(mask * n * 2 + last * 2 + reverse);
        if (!state) continue;
        if (mask === count - 1) { candidates.push(state); continue; }
        for (let next = 0; next < n; next++) if (!(mask & (1 << next))) for (const nextReverse of [false, true]) {
          const step = oriented(profiles[next], nextReverse), cost = state.cost + internalConnectionCost(state.path.at(-1), step);
          const key = (mask | (1 << next)) * n * 2 + next * 2 + Number(nextReverse);
          if (!states.has(key) || cost < states.get(key).cost) states.set(key, { cost, path: [...state.path, step] });
        }
      }
    }
  }
  return coherentCandidates(candidates);
}

function orderGroups(groups) {
  let previous = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    const candidates = groupCandidates(group.profiles).map(candidate => ({ ...candidate, path: candidate.path.map(step => ({ ...step, token: group.token, groupIndex })) }));
    const current = candidates.map(candidate => {
      let best, cost = Infinity;
      if (!previous.length) return { ...candidate, chain: candidate.path, total: candidate.cost };
      for (const state of previous) {
        const total = state.total + connectionCost(state.chain.at(-1), candidate.path[0]) + candidate.cost;
        if (total < cost) { cost = total; best = state; }
      }
      return { ...candidate, chain: [...best.chain, ...candidate.path], total: cost };
    });
    previous = current;
  }
  return previous.reduce((best, candidate) => !best || candidate.total < best.total ? candidate : best, null)?.chain || [];
}

function connectionTolerance(a, b) {
  const scaleHint = Math.max(distance(a.bounds.min, a.bounds.max), distance(b.bounds.min, b.bounds.max));
  return Math.max(Math.max(a.width, b.width) * 0.8, scaleHint * 1e-5, EPSILON * 10);
}

function bendBetweenPorts(step, before, after) {
  if (!before || !after || before.profile.kind !== 'straight' || after.profile.kind !== 'straight') return null;
  const p0 = before.end, p1 = after.start;
  const tolerance = Math.max(connectionTolerance(step.profile, before.profile), connectionTolerance(step.profile, after.profile));
  if (distance(p0, step.start) > tolerance * 1.5 || distance(p1, step.end) > tolerance * 1.5) return null;
  const a = unit(sub(before.end, before.start)), b = unit(sub(after.end, after.start)), chord = sub(p1, p0), length = norm(chord);
  if (step.profile.normal && (Math.abs(dot(a, step.profile.normal)) > 0.1 || Math.abs(dot(b, step.profile.normal)) > 0.1)) return null;
  const theta = Math.acos(clamp(dot(a, b), -1, 1));
  if (length <= EPSILON || theta < Math.PI / 90 || theta > Math.PI * 0.95 || dot(a, unit(chord)) < 0.02 || dot(b, unit(chord)) < 0.02) return null;
  const radius = length / (2 * Math.sin(theta / 2)), handle = (4 / 3) * radius * Math.tan(theta / 4);
  const pA = add(p0, scale(a, handle)), pB = sub(p1, scale(b, handle));
  const count = Math.max(12, Math.ceil(theta * 24));
  const points = Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count, s = 1 - t;
    return add(add(scale(p0, s * s * s), scale(pA, 3 * s * s * t)), add(scale(pB, 3 * s * t * t), scale(p1, t * t * t)));
  });
  // Only interpolate inside the actual bend neighbourhood, never across an
  // unrelated pipe or an unmodelled large connection.
  const margin = Math.max(step.profile.width, EPSILON);
  if (points.some(p => p.some((v, i) => v < step.profile.bounds.min[i] - margin || v > step.profile.bounds.max[i] + margin))) return null;
  return points;
}

function closestFiniteSegments(a0, a1, b0, b1) {
  const u = sub(a1, a0), v = sub(b1, b0), w = sub(a0, b0);
  const aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w), determinant = aa * cc - bb * bb;
  const candidates = [];
  const include = (a, b) => candidates.push({ a, b, distance: distance(a, b), trim: distance(a1, a) + distance(b0, b) });
  if (aa > EPSILON * EPSILON && cc > EPSILON * EPSILON && Math.abs(determinant) > aa * cc * 1e-10) {
    let t = clamp((bb * ee - cc * dd) / determinant, 0, 1), s = clamp((aa * ee - bb * dd) / determinant, 0, 1);
    for (let iteration = 0; iteration < 3; iteration++) { t = clamp((bb * s - dd) / aa, 0, 1); s = clamp((bb * t + ee) / cc, 0, 1); }
    include(add(a0, scale(u, t)), add(b0, scale(v, s)));
  }
  for (const a of [a1, a0]) include(a, nearestOnSegment(a, b0, b1));
  for (const b of [b0, b1]) include(nearestOnSegment(b, a0, a1), b);
  return candidates.reduce((best, candidate) => candidate.distance < best.distance - EPSILON || Math.abs(candidate.distance - best.distance) <= EPSILON && candidate.trim < best.trim ? candidate : best);
}

function appendDistinct(points, point) {
  if (!points.length || distance(points.at(-1), point) > EPSILON) points.push(point.slice());
}

function pathStations(points) {
  const stations = [0];
  for (let i = 1; i < points.length; i++) stations.push(stations.at(-1) + distance(points[i - 1], points[i]));
  return stations;
}

function nearestGroupJunction(a, b) {
  let best;
  for (let i = 0; i < Math.max(1, a.points.length - 1); i++) for (let j = 0; j < Math.max(1, b.points.length - 1); j++) {
    const ports = closestFiniteSegments(a.points[i], a.points[i + 1] || a.points[i], b.points[j], b.points[j + 1] || b.points[j]);
    const fromStation = a.stations[i] + distance(a.points[i], ports.a), toStation = b.stations[j] + distance(b.points[j], ports.b);
    const trim = a.length - fromStation + toStation;
    if (!best || ports.distance < best.distance - EPSILON || Math.abs(ports.distance - best.distance) <= EPSILON && trim < best.trim) best = { ...ports, fromStation, toStation, trim };
  }
  return best;
}

function atStation(group, station) {
  const value = clamp(station, 0, group.length);
  for (let i = 1; i < group.points.length; i++) if (value <= group.stations[i]) {
    const length = group.stations[i] - group.stations[i - 1], t = length > EPSILON ? (value - group.stations[i - 1]) / length : 0;
    return add(group.points[i - 1], scale(sub(group.points[i], group.points[i - 1]), t));
  }
  return group.points.at(-1).slice();
}

function clipGroupsToJunctions(pieces) {
  const groups = [];
  for (const piece of pieces) {
    let group = groups.at(-1);
    if (!group || group.index !== piece.groupIndex) { group = { index: piece.groupIndex, token: piece.token, points: [], pieces: [] }; groups.push(group); }
    const before = pathStations(group.points).at(-1) || 0;
    const start = before + (group.points.length ? distance(group.points.at(-1), piece.points[0]) : 0);
    for (const point of piece.points) appendDistinct(group.points, point);
    group.pieces.push({ ...piece, from: start, to: pathStations(group.points).at(-1) || 0 });
  }
  for (const group of groups) { group.stations = pathStations(group.points); group.length = group.stations.at(-1); group.entry = 0; group.exit = group.length; }
  const junctions = [];
  for (let i = 0; i + 1 < groups.length; i++) {
    const before = groups[i], after = groups[i + 1], junction = nearestGroupJunction(before, after);
    before.exit = junction.fromStation; after.entry = junction.toStation;
    junctions.push({ from: before.token, to: after.token, fromPoint: junction.a, toPoint: junction.b, distance: junction.distance });
  }
  // Terminal orientation is determined by the actual junction, not by the
  // arbitrary direction of an exported mesh or an otherwise equal-cost path.
  // Continue to the more distant endpoint instead of leaving a short stub.
  if (groups.length > 1) {
    const first = groups[0], last = groups.at(-1);
    first.entry = first.exit >= first.length / 2 ? 0 : first.length;
    last.exit = last.entry <= last.length / 2 ? last.length : 0;
  }
  for (const group of groups) {
    const low = Math.min(group.entry, group.exit), high = Math.max(group.entry, group.exit), clipped = [];
    appendDistinct(clipped, atStation(group, low));
    for (let i = 0; i < group.points.length; i++) if (group.stations[i] > low + EPSILON && group.stations[i] < high - EPSILON) appendDistinct(clipped, group.points[i]);
    appendDistinct(clipped, atStation(group, high));
    if (group.entry > group.exit) clipped.reverse();
    group.clipped = clipped;
    group.skippedProfileIds = group.pieces.filter(piece => Math.min(piece.to, high) - Math.max(piece.from, low) <= EPSILON).map(piece => piece.profile.id);
  }
  return { groups, junctions };
}

export function buildRouteLines(groups) {
  const warnings = [], clean = groups.filter(group => Array.isArray(group.profiles) && group.profiles.length);
  const omittedTokens = groups.filter(group => !Array.isArray(group.profiles) || !group.profiles.length).map(group => group.token);
  if (!clean.length) return { polylines: [], warnings, diagnostics: { profileCount: 0, breaks: [], connectors: [], omittedTokens, bends: { interpolated: 0, meshFit: 0, fallback: 0 } } };
  const chain = orderGroups(calibrateSections(clean)).map(step => ({ ...step, start: step.start.slice(), end: step.end.slice() })), connectors = [], bends = { interpolated: 0, meshFit: 0, fallback: 0 };
  // Preserve complete component paths here. Projection and trimming belong to
  // junctions between groups; applying them to adjacent parts inside a group
  // can collapse an otherwise continuous tray into a point.
  const pieces = chain.map((step, i) => {
    let points = step.profile.kind === 'straight' ? [step.start, step.end] : step.reverse ? [...step.profile.centerline].reverse() : [...step.profile.centerline];
    if (step.profile.kind === 'bend') {
      const between = bendBetweenPorts(step, chain[i - 1], chain[i + 1]);
      if (between) { points = between; bends.interpolated++; }
      else if (step.profile.method === 'mesh-arc') bends.meshFit++;
      else { bends.fallback++; warnings.push(`Линията в коляното „${step.token}“ е приблизителна; провери я спрямо модела.`); }
    }
    return { ...step, points: points.map(p => p.slice()) };
  });
  const clipped = clipGroupsToJunctions(pieces), polylines = [];
  let line = [];
  for (let i = 0; i < clipped.groups.length; i++) {
    const group = clipped.groups[i];
    if (line.length) {
      const previous = clipped.groups[i - 1], gap = distance(line.at(-1), group.clipped[0]);
      const tolerance = Math.max(...previous.pieces.flatMap(a => group.pieces.map(b => connectionTolerance(a.profile, b.profile))));
      if (gap > tolerance) {
        // The user requests one continuous route. Retain a direct connector
        // across unmodelled gaps and record it without changing model data.
        connectors.push({ from: previous.token, to: group.token, fromPoint: line.at(-1).slice(), toPoint: group.clipped[0].slice(), distance: gap, tolerance, reason: 'connected-gap' });
      }
    }
    for (const point of group.clipped) appendDistinct(line, point);
  }
  if (line.length >= 2) polylines.push(line);
  return {
    polylines, warnings: [...new Set(warnings)].slice(0, 6),
    diagnostics: {
      profileCount: chain.length, breaks: [], connectors, omittedTokens, bends,
      order: chain.map(step => ({ id: step.profile.id, token: step.token, reverse: step.reverse, method: step.profile.method, start: step.start, end: step.end, width: step.profile.width })),
      junctions: clipped.junctions,
      groupClips: clipped.groups.map(group => ({ token: group.token, entry: group.clipped[0], exit: group.clipped.at(-1), skippedProfileIds: group.skippedProfileIds }))
    }
  };
}
