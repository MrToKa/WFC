import { composeTransform, normalizeQuaternion, rotateVector, validatePosition,
  type Quaternion, type RigidTransform, type Vec3 } from './cadTransforms.js';

const origin = { x: 0, y: 0, z: 0 };
const degreesPerRadian = 180 / Math.PI;

function radians(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new RangeError('Rotation angles must be finite degrees.');
  return (degrees % 360) / degreesPerRadian;
}

function normalized(q: Quaternion): Quaternion {
  if (![q.x, q.y, q.z, q.w].every(Number.isFinite)) throw new RangeError('Quaternion components must be finite.');
  // Rescaling avoids overflow/underflow when accepting a non-unit quaternion.
  const scale = Math.max(Math.abs(q.x), Math.abs(q.y), Math.abs(q.z), Math.abs(q.w));
  if (scale === 0) throw new RangeError('Quaternion cannot have zero length.');
  return normalizeQuaternion({ x: q.x / scale, y: q.y / scale, z: q.z / scale, w: q.w / scale });
}

/** World/extrinsic XYZ angles: q = Rz(rz) * Ry(ry) * Rx(rx). */
export function eulerDegreesToQuaternion(rx: number, ry: number, rz: number): Quaternion {
  const x = radians(rx) / 2, y = radians(ry) / 2, z = radians(rz) / 2;
  const sx = Math.sin(x), cx = Math.cos(x), sy = Math.sin(y), cy = Math.cos(y), sz = Math.sin(z), cz = Math.cos(z);
  return normalized({
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  });
}

/** Equivalent XYZ angles, with Ry in [-90,90]; at gimbal lock choose Rz=0. */
export function quaternionToEulerDegrees(rotation: Quaternion): { rx: number; ry: number; rz: number } {
  const { x, y, z, w } = normalized(rotation);
  const r11 = 1 - 2 * (y * y + z * z);
  const r21 = 2 * (x * y + w * z);
  const r31 = 2 * (x * z - w * y);
  const r22 = 1 - 2 * (x * x + z * z);
  const r23 = 2 * (y * z - w * x);
  const r32 = 2 * (y * z + w * x);
  const r33 = 1 - 2 * (x * x + y * y);
  const cosY = Math.hypot(r11, r21);
  // atan2 retains the distance to ±90° when asin would round to the singularity.
  const ry = Math.atan2(-r31, cosY);
  const locked = cosY < 1e-10;
  return {
    rx: Math.atan2(locked ? -r23 : r32, locked ? r22 : r33) * degreesPerRadian,
    ry: ry * degreesPerRadian,
    rz: locked ? 0 : Math.atan2(r21, r11) * degreesPerRadian,
  };
}

/** Rotate about a component's own axis: post-multiply q * qAxis. */
export function rotateAboutLocalAxis(q: Quaternion, axis: 'x' | 'y' | 'z', degrees: number): Quaternion {
  if (axis !== 'x' && axis !== 'y' && axis !== 'z') throw new RangeError('Rotation axis must be x, y or z.');
  const halfAngle = radians(degrees) / 2;
  const delta = { x: 0, y: 0, z: 0, w: Math.cos(halfAngle), [axis]: Math.sin(halfAngle) };
  return composeTransform({ position: origin, rotation: normalized(q) }, { position: origin, rotation: delta }).rotation;
}

/** Change orientation while holding the chosen component-local pivot fixed in world space. */
export function orientAboutLocalPivot(transform: RigidTransform, newRotation: Quaternion, pivotLocal: Vec3): RigidTransform {
  validatePosition(transform.position);
  validatePosition(pivotLocal);
  const previous = rotateVector(pivotLocal, normalized(transform.rotation));
  const rotation = normalized(newRotation);
  const next = rotateVector(pivotLocal, rotation);
  return {
    position: validatePosition({
      x: transform.position.x + previous.x - next.x,
      y: transform.position.y + previous.y - next.y,
      z: transform.position.z + previous.z - next.z,
    }),
    rotation,
  };
}
