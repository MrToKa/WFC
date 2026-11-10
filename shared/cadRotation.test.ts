// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { composeTransform, rotateVector, type Quaternion } from './cadTransforms.js';
import { eulerDegreesToQuaternion, orientAboutLocalPivot, quaternionToEulerDegrees, rotateAboutLocalAxis } from './cadRotation.js';

function equivalent(a: Quaternion, b: Quaternion) {
  // Compare transformed independent axes, not angle labels or quaternion signs.
  for (const axis of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]) {
    const actual = rotateVector(axis, a), expected = rotateVector(axis, b);
    expect(actual.x).toBeCloseTo(expected.x, 7);
    expect(actual.y).toBeCloseTo(expected.y, 7);
    expect(actual.z).toBeCloseTo(expected.z, 7);
  }
}

describe('CAD angle and local-axis rotation', () => {
  it.each([
    [90, 90, 0], [90, -90, 0], [90, 90, 90], [-90, -90, -90], [90, -90, 90],
    [35, 90, 70], [-120, -90, 145],
    [35, 89.999999, 70], [-120, -89.999999, 145],
    [35, 90.000001, 70], [-120, -90.000001, 145],
    [90, 89.9999999999, -45], [90, -89.9999999999, -45],
    [25, 35, -70], [170, 120, -160], [0, 0, 0], [180, 180, 180],
  ])('round trips orientation at Rx=%s Ry=%s Rz=%s', (rx, ry, rz) => {
    const q = eulerDegreesToQuaternion(rx, ry, rz);
    const angles = quaternionToEulerDegrees(q);
    equivalent(eulerDegreesToQuaternion(angles.rx, angles.ry, angles.rz), q);
    equivalent(eulerDegreesToQuaternion(angles.rx, angles.ry, angles.rz), { x: -q.x, y: -q.y, z: -q.z, w: -q.w });
  });
  it.each([90, -90])('chooses Rz=0 at Ry=%s without losing orientation', ry => {
    const q = eulerDegreesToQuaternion(65, ry, 30);
    const angles = quaternionToEulerDegrees(q);
    expect(angles.rz).toBe(0);
    expect(angles.ry).toBeCloseTo(ry, 10);
    equivalent(eulerDegreesToQuaternion(angles.rx, angles.ry, angles.rz), q);
  });
  it('uses world XYZ order for the screenshot orientation', () => {
    const q = eulerDegreesToQuaternion(90, 90, 0);
    const localY = rotateVector({ x: 0, y: 1, z: 0 }, q);
    expect(localY.x).toBeCloseTo(1);
    expect(localY.y).toBeCloseTo(0);
    expect(localY.z).toBeCloseTo(0);
  });
  it('rotates about local X rather than world X and preserves the input', () => {
    const q = eulerDegreesToQuaternion(0, 0, 90);
    const before = { ...q };
    const local = rotateAboutLocalAxis(q, 'x', 90);
    const world = eulerDegreesToQuaternion(90, 0, 90);
    // These Euler angles also describe qZ * qX, while qX * qZ is world-X rotation.
    equivalent(local, world);
    const worldApplied = composeTransform({ position: { x: 0, y: 0, z: 0 }, rotation: eulerDegreesToQuaternion(90, 0, 0) },
      { position: { x: 0, y: 0, z: 0 }, rotation: q }).rotation;
    const localZ = rotateVector({ x: 0, y: 0, z: 1 }, local);
    const worldZ = rotateVector({ x: 0, y: 0, z: 1 }, worldApplied);
    expect(localZ.x).toBeCloseTo(1);
    expect(worldZ.y).toBeCloseTo(-1);
    expect(q).toEqual(before);
    expect(Math.hypot(local.x, local.y, local.z, local.w)).toBeCloseTo(1, 12);
  });
  it.each(['x', 'y', 'z'] as const)('local %s increments cancel and repeat correctly', axis => {
    const initial = eulerDegreesToQuaternion(33, 47, 16);
    equivalent(rotateAboutLocalAxis(rotateAboutLocalAxis(initial, axis, 15), axis, -15), initial);
    let result = initial;
    for (let i = 0; i < 24; i++) result = rotateAboutLocalAxis(result, axis, 15);
    equivalent(result, initial);
  });
  it('accepts finite non-unit quaternions without overflow or underflow', () => {
    for (const scale of [7, 1e308, 1e-308]) {
      const angles = quaternionToEulerDegrees({ x: 0, y: 0, z: scale, w: scale });
      equivalent(eulerDegreesToQuaternion(angles.rx, angles.ry, angles.rz), eulerDegreesToQuaternion(0, 0, 90));
    }
    equivalent(eulerDegreesToQuaternion(Number.MAX_VALUE, 0, 0), eulerDegreesToQuaternion(Number.MAX_VALUE % 360, 0, 0));
  });
  it.each([NaN, Infinity, -Infinity])('rejects nonfinite angles %s', angle => {
    expect(() => eulerDegreesToQuaternion(angle, 0, 0)).toThrow(RangeError);
    expect(() => eulerDegreesToQuaternion(0, angle, 0)).toThrow(RangeError);
    expect(() => eulerDegreesToQuaternion(0, 0, angle)).toThrow(RangeError);
    expect(() => rotateAboutLocalAxis({ x: 0, y: 0, z: 0, w: 1 }, 'x', angle)).toThrow(RangeError);
  });
  it.each([{ x: 0, y: 0, z: 0, w: 0 }, { x: NaN, y: 0, z: 0, w: 1 }, { x: 0, y: Infinity, z: 0, w: 1 }])('rejects invalid quaternion %j', q => {
    expect(() => quaternionToEulerDegrees(q)).toThrow(RangeError);
    expect(() => rotateAboutLocalAxis(q, 'y', 90)).toThrow(RangeError);
  });
  it('rejects an unknown axis at the runtime boundary', () => {
    expect(() => rotateAboutLocalAxis({ x: 0, y: 0, z: 0, w: 1 }, 'bad' as 'x', 90)).toThrow(RangeError);
  });
});

describe('CAD rotation pivot', () => {
  const position = { x: 1234, y: -5678, z: 910 };
  const initial = { position, rotation: eulerDegreesToQuaternion(90, 90, 0) };
  const pivots = [
    { name: 'start', local: { x: 0, y: 30, z: 0 } },
    { name: 'center', local: { x: 0, y: 30, z: 750 } },
    { name: 'end', local: { x: 0, y: 30, z: 1500 } },
  ];
  it.each(pivots)('holds the $name pivot at its original world point from a rotated initial placement', ({ local }) => {
    const before = composeTransform(initial, { position: local, rotation: eulerDegreesToQuaternion(0, 0, 0) }).position;
    const rotation = rotateAboutLocalAxis(initial.rotation, 'x', 90);
    const result = orientAboutLocalPivot(initial, rotation, local);
    const after = composeTransform(result, { position: local, rotation: eulerDegreesToQuaternion(0, 0, 0) }).position;
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
    equivalent(result.rotation, rotation);
    const reversed = orientAboutLocalPivot(result, rotateAboutLocalAxis(result.rotation, 'x', -90), local);
    expect(reversed.position.x).toBeCloseTo(position.x, 9);
    expect(reversed.position.y).toBeCloseTo(position.y, 9);
    expect(reversed.position.z).toBeCloseTo(position.z, 9);
    equivalent(reversed.rotation, initial.rotation);
    expect(initial.position).toEqual(position);
  });
  it('leaves the component origin fixed when selected as pivot', () => {
    const result = orientAboutLocalPivot(initial, eulerDegreesToQuaternion(5, 15, 25), { x: 0, y: 0, z: 0 });
    expect(result.position).toEqual(position);
  });
  it('computes a known end rotation without translating the fixed end', () => {
    const result = orientAboutLocalPivot({ position: { x: 10, y: 20, z: 30 }, rotation: eulerDegreesToQuaternion(0, 0, 0) },
      eulerDegreesToQuaternion(0, 90, 0), { x: 0, y: 0, z: 1500 });
    expect(result.position.x).toBeCloseTo(-1490);
    expect(result.position.y).toBeCloseTo(20);
    expect(result.position.z).toBeCloseTo(1530);
  });
  it.each([{ x: NaN, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0 }, { x: 0, y: 0, z: 1e9 + 1 }])('rejects invalid local pivot %j', pivot => {
    expect(() => orientAboutLocalPivot(initial, initial.rotation, pivot)).toThrow(RangeError);
  });
  it('validates both orientations, original anchor and resulting position', () => {
    const zero = { x: 0, y: 0, z: 0, w: 0 };
    expect(() => orientAboutLocalPivot({ ...initial, rotation: zero }, initial.rotation, pivots[0].local)).toThrow(RangeError);
    expect(() => orientAboutLocalPivot(initial, zero, pivots[0].local)).toThrow(RangeError);
    expect(() => orientAboutLocalPivot({ ...initial, position: { ...position, x: Infinity } }, initial.rotation, pivots[0].local)).toThrow(RangeError);
    expect(() => orientAboutLocalPivot({ position: { x: 1e9, y: 0, z: 0 }, rotation: eulerDegreesToQuaternion(0, 90, 0) },
      eulerDegreesToQuaternion(0, -90, 0), { x: 0, y: 0, z: 1500 })).toThrow(RangeError);
  });
});
