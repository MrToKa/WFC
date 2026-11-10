// Public facade for engineering component placement used by the frontend.
export {
  validatePosition, normalizeQuaternion, IDENTITY_TRANSFORM, rotateVector,
  composeTransform, invertTransform, alignConnectorPorts,
} from '../../shared/cadTransforms.js';
export type { Vec3, Quaternion, RigidTransform } from '../../shared/cadTransforms.js';
