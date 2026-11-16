import { getStraightSource } from './cadStraightSources.js';

/** Common, pure CAD port contract shared by browser and Node backend. */
type Quaternion = Readonly<{ x: number; y: number; z: number; w: number }>;
type RigidTransform = Readonly<{
  position: Readonly<{ x: number; y: number; z: number }>;
  rotation: Quaternion;
}>;

/**
 * Aalborg two-part PoC: preliminary connector anchors measured from the
 * original STEP B-Rep envelope and terminal sections, in LOCAL millimetres.
 * Installation clearances, connector plates, fit and vendor compatibility
 * remain unverified. Never use these as automatic manufacturer CAD rules.
 */
export type PocPort = Readonly<{
  id: 'start' | 'end';
  label: string;
  profile: string;
  local: RigidTransform;
}>;

const identity: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
const faceReverse: Quaternion = { x: 0, y: 1, z: 0, w: 0 };
const s = Math.SQRT1_2;
const turnLeft: Quaternion = { x: 0, y: -s, z: 0, w: s };

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
  const source = getStraightSource(originalFilename, sourceSha256);
  if (source) {
    const profile = `${source.heightMm}x${source.widthMm}`;
    return [
      { id: 'start', label: 'Start end-face (Z=0)', profile,
        local: { position: { x: source.centerXmm, y: source.centerYmm, z: 0 }, rotation: faceReverse } },
      { id: 'end', label: `End end-face (Z=${source.lengthMm})`, profile,
        local: { position: { x: source.centerXmm, y: source.centerYmm, z: source.lengthMm }, rotation: identity } },
    ];
  }
  if (canonical === 'NDX_KLBK_60-303_MED_214.STEP' &&
      sourceSha256 === '7a5cf4947a9ea5fa213ceef84ba952fe2a9a63dee752f0c23a598320802c0014') return bend;
  return [];
}
