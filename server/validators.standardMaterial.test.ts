import { describe, expect, it } from 'vitest';
import {
  createStandardMaterialSchema,
  updateStandardMaterialSchema,
} from './validators.js';

describe('Standard Material validators', () => {
  it('accepts canonical units and a finite positive quantity', () => {
    expect(
      createStandardMaterialSchema.safeParse({
        referencedMaterialId: '00000000-0000-4000-8000-000000000001',
        quantity: 2,
        unit: 'pcs/m',
        remarks: null,
      }).success,
    ).toBe(true);
  });

  it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects invalid quantity %s',
    (quantity) => {
      expect(
        createStandardMaterialSchema.safeParse({
          referencedMaterialId: '00000000-0000-4000-8000-000000000001',
          quantity,
          unit: 'pcs',
        }).success,
      ).toBe(false);
    },
  );

  it('rejects an empty update', () => {
    expect(updateStandardMaterialSchema.safeParse({}).success).toBe(false);
  });
});
