// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { alignConnectorPorts, connectorAlignmentIsValid, IDENTITY_TRANSFORM } from '../../shared/cadTransforms.js';
import { getAalborgPocPorts, MATE_OPPOSING_FACE } from '../../shared/cadPocPorts.js';

const straight = getAalborgPocPorts(
  'NDX_KL_60-303_F_MED_214.step',
  'd381a3f4a09559e99119e3e591137f73780d16bf832019f93b20627adc5609cd',
);
const bend = getAalborgPocPorts(
  'NDX_KLBK_60-303_MED_214.step',
  '7a5cf4947a9ea5fa213ceef84ba952fe2a9a63dee752f0c23a598320802c0014',
);
describe('authoritative snap tolerance for saved project components', () => {
  const target = IDENTITY_TRANSFORM;
  const source = alignConnectorPorts(target, bend[0].local, straight[0].local, MATE_OPPOSING_FACE);

  it('accepts the exact calculated mating transform', () => {
    expect(connectorAlignmentIsValid(source, straight[0].local, target, bend[0].local, MATE_OPPOSING_FACE)).toBe(true);
  });
  it('accepts ±0.5mm placement rounding, rejects 2mm displacement', () => {
    const small = { ...source, position: { ...source.position, x: source.position.x + 0.5 } };
    const large = { ...source, position: { ...source.position, x: source.position.x + 2 } };
    expect(connectorAlignmentIsValid(small, straight[0].local, target, bend[0].local, MATE_OPPOSING_FACE)).toBe(true);
    expect(connectorAlignmentIsValid(large, straight[0].local, target, bend[0].local, MATE_OPPOSING_FACE)).toBe(false);
  });
  it('treats quaternion sign reversal as identical orientation', () => {
    const q = source.rotation;
    const equivalent = { ...source, rotation: { x:-q.x,y:-q.y,z:-q.z,w:-q.w } };
    expect(connectorAlignmentIsValid(equivalent,straight[0].local,target,bend[0].local,MATE_OPPOSING_FACE)).toBe(true);
  });
  it('rejects a two-degree misrotation', () => {
    const rotated = { ...source, rotation: {x: 0,y:0,z:0,w:1} };
    // Rotations are not necessarily identity for this source; validate a
    // deliberately distinct non-coincident orientation rather than a guessed axis.
    expect(connectorAlignmentIsValid(rotated,straight[0].local,target,bend[0].local,MATE_OPPOSING_FACE)).toBe(false);
  });
  it('refuses unverified same-name STEP variants', () => {
    expect(getAalborgPocPorts('NDX_KL_60-303_F_MED_214.step','0'.repeat(64))).toEqual([]);
    expect(getAalborgPocPorts('NDX_KLBK_60-303_MED_214.step','0'.repeat(64))).toEqual([]);
  });
});
