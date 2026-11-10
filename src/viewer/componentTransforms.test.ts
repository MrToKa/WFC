import { describe, expect, it } from 'vitest';
import { alignConnectorPorts, composeTransform, IDENTITY_TRANSFORM, invertTransform, normalizeQuaternion, rotateVector } from './componentTransforms';

const identity = IDENTITY_TRANSFORM;
const position = (x: number, y: number, z: number) => ({ x, y, z });
const rotZ90 = { x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) };
const rotZ180 = { x: 0, y: 0, z: 1, w: 0 };

describe('component placement transforms', () => {
  it('composes translation in the rotated local coordinate frame', () => {
    const world = composeTransform(
      { position: position(1000, 2000, 3000), rotation: rotZ90 },
      { position: position(300, 0, 0), rotation: identity.rotation },
    );
    expect(world.position.x).toBeCloseTo(1000, 8);
    expect(world.position.y).toBeCloseTo(2300, 8);
    expect(world.position.z).toBeCloseTo(3000, 8);
  });

  it('returns identity when composed with its inverse', () => {
    const transform = { position: position(500, -200, 1500), rotation: rotZ90 };
    const result = composeTransform(transform, invertTransform(transform));
    expect(result.position.x).toBeCloseTo(0, 8);
    expect(result.position.y).toBeCloseTo(0, 8);
    expect(result.position.z).toBeCloseTo(0, 8);
    expect(result.rotation.w).toBeCloseTo(1, 8);
  });

  it('aligns a source port to a target using an explicit mating rotation', () => {
    const target = { position: position(15000, 8000, 4500), rotation: identity.rotation };
    const targetPort = { position: position(3000, 0, 0), rotation: identity.rotation };
    const sourcePort = { position: position(0, 0, 0), rotation: identity.rotation };
    const mate = { position: position(0, 0, 0), rotation: rotZ180 };
    const sourceWorld = alignConnectorPorts(target, targetPort, sourcePort, mate);
    expect(sourceWorld.position).toEqual(position(18000, 8000, 4500));
    expect(rotateVector(position(1, 0, 0), sourceWorld.rotation).x).toBeCloseTo(-1, 8);
  });

  it('rejects invalid transforms rather than writing bad coordinates', () => {
    expect(() => normalizeQuaternion({ x: 0, y: 0, z: 0, w: 0 })).toThrow(RangeError);
    expect(() => composeTransform(
      { position: position(Number.NaN, 0, 0), rotation: identity.rotation },
      identity,
    )).toThrow(RangeError);
  });
});
