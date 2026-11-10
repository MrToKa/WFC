import { describe, expect, it } from 'vitest';
import { alignConnectorPorts, IDENTITY_TRANSFORM, composeTransform } from './componentTransforms';
import { getAalborgPocPorts, MATE_OPPOSING_FACE } from './pocConnectorCatalog';

describe('verified-geometry Aalborg PoC connector anchors', () => {
  it('exposes exactly two end faces for each supplied STEP and no others', () => {
    expect(getAalborgPocPorts('NDX_KL_60-303_F_MED_214.step', 'd381a3f4a09559e99119e3e591137f73780d16bf832019f93b20627adc5609cd')).toHaveLength(2);
    expect(getAalborgPocPorts('NDX_KLBK_60-303_MED_214.step', '7a5cf4947a9ea5fa213ceef84ba952fe2a9a63dee752f0c23a598320802c0014')).toHaveLength(2);
    expect(getAalborgPocPorts('different.step', 'invalid')).toHaveLength(0);
  });

  it('aligns the straight ladder to the bend end port in world mm', () => {
    const target = getAalborgPocPorts('NDX_KLBK_60-303_MED_214.step', '7a5cf4947a9ea5fa213ceef84ba952fe2a9a63dee752f0c23a598320802c0014')[0];
    const source = getAalborgPocPorts('NDX_KL_60-303_F_MED_214.step', 'd381a3f4a09559e99119e3e591137f73780d16bf832019f93b20627adc5609cd')[0];
    const sourceWorld = alignConnectorPorts(IDENTITY_TRANSFORM, target.local, source.local, MATE_OPPOSING_FACE);
    const from = composeTransform(sourceWorld, source.local).position;
    const to = target.local.position;
    expect(from.x).toBeCloseTo(to.x, 7);
    expect(from.y).toBeCloseTo(to.y, 7);
    expect(from.z).toBeCloseTo(to.z, 7);
  });
});
