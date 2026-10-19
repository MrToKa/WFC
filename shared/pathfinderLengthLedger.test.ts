import { describe, expect, it } from 'vitest';
import { canonicalDecimalString, decimalDifference, signedCanonicalAmountSchema, canonicalAmountSchema } from './pathfinderLengthLedger.js';

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
