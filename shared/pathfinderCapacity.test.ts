import { describe, expect, it } from 'vitest';
import { PREPARATION_LIMITS } from './pathfinderPreparation.js';
import {
  LEGACY_PREPARATION_CAPACITY_PROFILE,
  LARGE_PREPARATION_CAPACITY_PROFILE,
  preparationCapacity,
  preparationCapacityProfileSchema,
  type PreparationCapacityProfile,
} from './pathfinderCapacity.js';

describe('versioned preparation input capacity', () => {
  it('retains the legacy default and distinguishes the explicit larger envelope', () => {
    expect(PREPARATION_LIMITS.validationInputBytes).toBe(32 * 1024 ** 2);
    expect(preparationCapacity(LEGACY_PREPARATION_CAPACITY_PROFILE)).toEqual({ validationInputBytes: 32 * 1024 ** 2, projectionInputBytes: 32 * 1024 ** 2 });
    expect(preparationCapacity(LARGE_PREPARATION_CAPACITY_PROFILE)).toEqual({ validationInputBytes: 128 * 1024 ** 2, projectionInputBytes: 128 * 1024 ** 2 });
    expect(PREPARATION_LIMITS.partBytes).toBe(64 * 1024 ** 2);
    expect(PREPARATION_LIMITS.unionBytes).toBe(256 * 1024 ** 2);
    expect(PREPARATION_LIMITS.validationMilliseconds).toBe(120000);
  });

  it('returns immutable stable profiles, with no client-adjustable numeric fields', () => {
    for (const profile of [LEGACY_PREPARATION_CAPACITY_PROFILE, LARGE_PREPARATION_CAPACITY_PROFILE]) {
      const capacity = preparationCapacity(profile);
      expect(Object.isFrozen(capacity)).toBe(true);
      expect(preparationCapacity(profile)).toBe(capacity);
      expect(Reflect.set(capacity, 'validationInputBytes', Infinity)).toBe(false);
      expect(capacity.validationInputBytes).toBe(profile === LEGACY_PREPARATION_CAPACITY_PROFILE ? 32 * 1024 ** 2 : 128 * 1024 ** 2);
    }
  });

  it.each([undefined, null, '', 'unlimited', 'wfc.pf.bounded-128m-capture-and-model.v2\n', 128 * 1024 ** 2, { validationInputBytes: 128 * 1024 ** 2 }])('refuses missing or unknown profile evidence (%j)', profile => {
    expect(preparationCapacityProfileSchema.safeParse(profile).success).toBe(false);
    expect(() => preparationCapacity(profile as PreparationCapacityProfile)).toThrow();
  });
});
