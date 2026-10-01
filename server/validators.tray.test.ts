import { describe, expect, it } from 'vitest';
import { createTraySchema, updateTraySchema } from './validators.js';

describe('tray clamp preference validators', () => {
  it('accepts existing create inputs without clamp preferences', () => {
    expect(createTraySchema.parse({ name: 'T1' })).toEqual({ name: 'T1' });
  });

  it('accepts explicit clamp preferences on creation', () => {
    expect(
      createTraySchema.safeParse({
        name: 'T1',
        useTrefoilClamps: true,
        trefoilClampSpacingMm: 600,
      }).success,
    ).toBe(true);
  });

  it.each([{ useTrefoilClamps: false }, { trefoilClampSpacingMm: 0.5 }])(
    'accepts a clamp preference update on its own',
    (input) => {
      expect(updateTraySchema.safeParse(input).success).toBe(true);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1_000_001, null, '600'])(
    'rejects invalid clamp spacing %s on create and update',
    (trefoilClampSpacingMm) => {
      expect(createTraySchema.safeParse({ name: 'T1', trefoilClampSpacingMm }).success).toBe(false);
      expect(updateTraySchema.safeParse({ trefoilClampSpacingMm }).success).toBe(false);
    },
  );

  it('rejects an empty update', () => {
    expect(updateTraySchema.safeParse({}).success).toBe(false);
  });
});
