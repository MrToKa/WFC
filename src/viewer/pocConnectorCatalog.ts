import type { Quaternion, RigidTransform } from './componentTransforms';

/**
 * Aalborg two-part PoC: preliminary connector anchors measured from the
 * original STEP B-Rep envelope and terminal sections, in LOCAL millimetres.
 * Installation clearances, connector plates, fit and vendor compatibility
 * remain unverified. Never use these as automatic manufacturer CAD rules.
 */
export type PocPort = Readonly<{
  id: 'start' | 'end';
  label: string;
  profile: '60x300';
  local: RigidTransform;
}>;

const identity: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
const faceReverse: Quaternion = { x: 0, y: 1, z: 0, w: 0 };
const s = Math.SQRT1_2;
const turnLeft: Quaternion = { x: 0, y: -s, z: 0, w: s };

const straight: readonly PocPort[] = Object.freeze([
  { id: 'start', label: 'Start end-face (Z=0)', profile: '60x300',
    local: { position: { x: 0, y: 30, z: 0 }, rotation: faceReverse } },
  { id: 'end', label: 'End end-face (Z=6000)', profile: '60x300',
    local: { position: { x: 0, y: 30, z: 6000 }, rotation: identity } },
]);

const bend: readonly PocPort[] = Object.freeze([
  { id: 'start', label: 'Bend end-face (Z=0)', profile: '60x300',
    local: { position: { x: 150, y: 30, z: 0 }, rotation: identity } },
  { id: 'end', label: 'Bend end-face (X=-645)', profile: '60x300',
    local: { position: { x: -645, y: 30, z: -795 }, rotation: turnLeft } },
]);

export const MATE_OPPOSING_FACE: RigidTransform = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }), rotation: faceReverse,
});

export function getAalborgPocPorts(originalFilename: string, sourceSha256: string): readonly PocPort[] {
  const canonical = originalFilename.trim().toUpperCase();
  if (canonical === 'NDX_KL_60-303_F_MED_214.STEP' &&
      sourceSha256 === 'd381a3f4a09559e99119e3e591137f73780d16bf832019f93b20627adc5609cd') return straight;
  if (canonical === 'NDX_KLBK_60-303_MED_214.STEP' &&
      sourceSha256 === '7a5cf4947a9ea5fa213ceef84ba952fe2a9a63dee752f0c23a598320802c0014') return bend;
  return [];
}
