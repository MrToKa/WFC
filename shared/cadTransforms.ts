/**
 * Pure, coordinate-frame-independent geometry for engineering component placement.
 * Coordinates are in project/world millimetres, never viewer camera coordinates.
 * Rotation quaternions are (x, y, z, w). Never persist render-space/globalOffset values.
 */
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type Quaternion = Readonly<{ x: number; y: number; z: number; w: number }>;
export type RigidTransform = Readonly<{ position: Vec3; rotation: Quaternion }>;

const MAX_COORDINATE_MM = 1e9;
const EPS = 1e-12;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export function validatePosition(position: Vec3): Vec3 {
  if (![position.x, position.y, position.z].every(value => finite(value) && Math.abs(value) <= MAX_COORDINATE_MM)) {
    throw new RangeError('Component position must contain bounded, finite world coordinates in millimetres.');
  }
  return position;
}

export function normalizeQuaternion(q: Quaternion): Quaternion {
  if (![q.x, q.y, q.z, q.w].every(finite)) {
    throw new RangeError('Quaternion components must be finite.');
  }
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length < EPS) throw new RangeError('Quaternion cannot have zero length.');
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

export const IDENTITY_TRANSFORM: RigidTransform = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
});

function multiplyQuaternion(a: Quaternion, b: Quaternion): Quaternion {
  return normalizeQuaternion({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}

export function rotateVector(vector: Vec3, rotation: Quaternion): Vec3 {
  validatePosition(vector);
  const q = normalizeQuaternion(rotation);
  const ux = q.x, uy = q.y, uz = q.z;
  const tx = 2 * (uy * vector.z - uz * vector.y);
  const ty = 2 * (uz * vector.x - ux * vector.z);
  const tz = 2 * (ux * vector.y - uy * vector.x);
  return {
    x: vector.x + q.w * tx + uy * tz - uz * ty,
    y: vector.y + q.w * ty + uz * tx - ux * tz,
    z: vector.z + q.w * tz + ux * ty - uy * tx,
  };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return validatePosition({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
}

function negate(v: Vec3): Vec3 { return { x: -v.x, y: -v.y, z: -v.z }; }

export function composeTransform(parent: RigidTransform, local: RigidTransform): RigidTransform {
  validatePosition(parent.position);
  validatePosition(local.position);
  const rotated = rotateVector(local.position, parent.rotation);
  return {
    position: add(parent.position, rotated),
    rotation: multiplyQuaternion(normalizeQuaternion(parent.rotation), normalizeQuaternion(local.rotation)),
  };
}

export function invertTransform(transform: RigidTransform): RigidTransform {
  validatePosition(transform.position);
  const q = normalizeQuaternion(transform.rotation);
  const inverted = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  return {
    position: rotateVector(negate(transform.position), inverted),
    rotation: inverted,
  };
}

/**
 * Align local source port with a target component's local port.
 * The caller must supply a verified mating transform (e.g. 180-degree face flip
 * and manufacturer's clearance); never infer fit merely from bounding boxes.
 */
export function alignConnectorPorts(
  targetComponentWorld: RigidTransform,
  targetPortLocal: RigidTransform,
  sourcePortLocal: RigidTransform,
  matingTransform: RigidTransform,
): RigidTransform {
  return composeTransform(
    composeTransform(
      composeTransform(targetComponentWorld, targetPortLocal),
      matingTransform,
    ),
    invertTransform(sourcePortLocal),
  );
}


/**
 * Verify two saved catalogue ports still form the specified connection.
 * Equivalent quaternions q and -q represent the same orientation.
 */
export function connectorAlignmentIsValid(
  sourceWorld: RigidTransform,
  sourcePort: RigidTransform,
  targetWorld: RigidTransform,
  targetPort: RigidTransform,
  mating: RigidTransform,
  maxGapMm = 1,
  maxAngleDegrees = 0.1,
): boolean {
  const intended = alignConnectorPorts(targetWorld, targetPort, sourcePort, mating);
  const source = normalizeQuaternion(sourceWorld.rotation);
  const desired = normalizeQuaternion(intended.rotation);
  const gap = Math.hypot(
    sourceWorld.position.x - intended.position.x,
    sourceWorld.position.y - intended.position.y,
    sourceWorld.position.z - intended.position.z,
  );
  const dot = Math.abs(source.x * desired.x + source.y * desired.y + source.z * desired.z + source.w * desired.w);
  return gap <= maxGapMm && dot >= Math.cos(maxAngleDegrees * Math.PI / 360);
}
