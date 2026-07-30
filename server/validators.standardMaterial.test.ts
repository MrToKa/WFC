import { describe, expect, it } from 'vitest';
import {
  createMaterialCableInstallationMaterialSchema,
  createMaterialCableTypeSchema,
  createMaterialSupportSchema,
  createMaterialTraySchema,
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

describe('Material minimum order validators', () => {
  const materialInputs = [
    {
      schema: createMaterialCableTypeSchema,
      input: { name: 'Power cable' },
    },
    {
      schema: createMaterialCableInstallationMaterialSchema,
      input: { type: 'Ferrule' },
    },
    {
      schema: createMaterialTraySchema,
      input: { type: 'Tray' },
    },
    {
      schema: createMaterialSupportSchema,
      input: { type: 'Support' },
    },
  ] as const;

  it.each(materialInputs)(
    'accepts a positive minimum and supported measurement',
    ({ schema, input }) => {
      expect(
        schema.safeParse({
          ...input,
          minimumOrderQuantity: 50,
          orderMeasurement: 'pcs',
          packaging: 'Box',
        }).success,
      ).toBe(true);
    },
  );

  it.each(materialInputs)(
    'rejects an invalid minimum or measurement',
    ({ schema, input }) => {
      expect(
        schema.safeParse({
          ...input,
          minimumOrderQuantity: 0,
          orderMeasurement: 'boxes',
          packaging: 'Bag',
        }).success,
      ).toBe(false);
    },
  );
});
