import { describe, expect, it } from 'vitest';
import { canonicalDecimalString, decimalDifference, signedCanonicalAmountSchema, canonicalAmountSchema, lengthLedgerSchema } from './pathfinderLengthLedger.js';
import { DIRECT_SECONDARY_POLICY } from './pathfinderDirectSecondary.js';

describe('exact revision comparison decimals', () => {
  it('normalizes stored scale without a binary64 conversion', () => {
    expect(canonicalDecimalString('7.00')).toBe('7');
    expect(canonicalDecimalString('-0.000')).toBe('0');
    expect(canonicalDecimalString('79228162514264337593543950335.00')).toBe('79228162514264337593543950335');
    expect(() => canonicalDecimalString('1e3')).toThrow();
    expect(() => canonicalDecimalString('01')).toThrow();
  });
  it('subtracts exact signed display deltas including large or tiny stored values', () => {
    expect(decimalDifference('9007199254740993.000001', '9007199254740993.000000')).toBe('0.000001');
    expect(decimalDifference('7', '10.25')).toBe('-3.25');
    expect(decimalDifference('0', '-0.000001')).toBe('0.000001');
    expect(decimalDifference('7.00', '7')).toBe('0');
  });
  it('keeps signed pre-clamp amounts separate from nonnegative totals', () => {
    expect(signedCanonicalAmountSchema.safeParse('-0.000001').success).toBe(true);
    expect(canonicalAmountSchema.safeParse('-0.000001').success).toBe(false);
    for (const invalid of ['-0', '7.00', '1e-6', '0.000000', '\n7']) expect(signedCanonicalAmountSchema.safeParse(invalid).success).toBe(false);
  });
});

const directLedgerFixture = () => ({ schemaVersion: 'wfc.pf.length-components.v2' as const, formulaVersion: 'direct-secondary-3d.v1' as const, settingsRevision: '2',
  raw: { lengthMeters: 3, fromDistanceMeters: 0, toDistanceMeters: 0 }, rawLengthDecimalMeters: '3',
  from: { requiresSecondary: false, removedApproachMeters: '0' }, to: { requiresSecondary: false, removedApproachMeters: '0' },
  settings: { secondaryTrayLengthMeters: '7', endConnectionLengthMeters: '2', additionalBendingPercent: '10' }, secondaryEnds: 0, replacementMeters: '0',
  beforeClampMeters: '3', clampAdjustmentMeters: '0', afterClampMeters: '3', beforePercentageMeters: '5', bendingIncrementMeters: '0.5',
  unroundedMeters: '5.5', ceilingIncrementMeters: '0.5', designLengthMeters: '6', gapAccounting: 'already-in-raw-geometry' as const,
  directSecondary: { schemaVersion: 'wfc.pf.direct-secondary.v1' as const, policyVersion: DIRECT_SECONDARY_POLICY, coordinateFrame: 'canonical-world-metres' as const,
    mode: 'direct-secondary' as const, fromPoint: [0, 0, 0] as [number, number, number], toPoint: [3, 0, 0] as [number, number, number],
    distanceMeters: 3, nearestFromMeters: 4, nearestToMeters: 5, eligibleTrays: 1, comparison: 'both' as const } });
describe('direct SECONDARY length observation contract', () => {
  it('retains Details S as unused audit input with no old secondary-end replacement', () => {
    expect(lengthLedgerSchema.parse(directLedgerFixture())).toEqual(directLedgerFixture());
    expect(lengthLedgerSchema.parse({ ...directLedgerFixture(), settings: { ...directLedgerFixture().settings, secondaryTrayLengthMeters: null } }).replacementMeters).toBe('0');
  });
  it.each([
    { formulaVersion: 'pathfinder-45c24bf5' }, { secondaryEnds: 1 }, { replacementMeters: '7' },
    { from: { requiresSecondary: true, removedApproachMeters: '0' } }, { to: { requiresSecondary: false, removedApproachMeters: '1' } },
    { raw: { lengthMeters: 3, fromDistanceMeters: 1, toDistanceMeters: 0 } }, { rawLengthDecimalMeters: '4' },
    { beforeClampMeters: '2' }, { afterClampMeters: '4' }, { clampAdjustmentMeters: '1' },
    { schemaVersion: 'wfc.pf.length-components.v1' }, { extraAllowance: 1 },
  ])('refuses forged direct observations %j', change => {
    expect(lengthLedgerSchema.safeParse({ ...directLedgerFixture(), ...change }).success).toBe(false);
  });
  it('does not silently upgrade old strict ledgers or infer direct mode from route text', () => {
    const { directSecondary: _decision, ...legacy } = directLedgerFixture();
    const value = { ...legacy, schemaVersion: 'wfc.pf.length-components.v1', formulaVersion: 'pathfinder-45c24bf5' };
    expect(lengthLedgerSchema.parse(value)).toEqual(value);
    expect(lengthLedgerSchema.safeParse({ ...value, directSecondary: directLedgerFixture().directSecondary }).success).toBe(false);
    expect(lengthLedgerSchema.safeParse({ ...directLedgerFixture(), directSecondary: { ...directLedgerFixture().directSecondary, mode: 'tray-network', nearestFromMeters: 1, nearestToMeters: 1, comparison: null } }).success).toBe(false);
  });
});
