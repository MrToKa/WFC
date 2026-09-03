import { describe, expect, it } from 'vitest';
import {
  createMaterialCableInstallationMaterialSchema,
  createMaterialCableTypeSchema,
  createMaterialSupportSchema,
  createMaterialTrayInstallationMaterialSchema,
  createMaterialTraySchema,
  createStandardMaterialSchema,
  updateMaterialCableInstallationMaterialSchema,
  updateMaterialCableTypeSchema,
  updateMaterialSupportSchema,
  updateMaterialTrayInstallationMaterialSchema,
  updateMaterialTraySchema,
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

describe('Material catalog validators', () => {
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
      schema: createMaterialTrayInstallationMaterialSchema,
      input: { type: 'Tray splice connector' },
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
    'accepts a finite unit price, positive minimum, and supported measurement',
    ({ schema, input }) => {
      expect(
        schema.safeParse({
          ...input,
          unitPrice: 12.5,
          minimumOrderQuantity: 50,
          orderMeasurement: 'pcs',
          packaging: 'Box',
        }).success,
      ).toBe(true);
    },
  );

  it.each(materialInputs)('rejects an invalid minimum or measurement', ({ schema, input }) => {
    expect(
      schema.safeParse({
        ...input,
        minimumOrderQuantity: 0,
        orderMeasurement: 'boxes',
        packaging: 'Bag',
      }).success,
    ).toBe(false);
  });

  it.each(materialInputs)('accepts zero as a unit price', ({ schema, input }) => {
    expect(schema.safeParse({ ...input, unitPrice: 0 }).success).toBe(true);
  });

  it.each(materialInputs)('rejects invalid unit prices', ({ schema, input }) => {
    for (const unitPrice of [-1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(schema.safeParse({ ...input, unitPrice }).success).toBe(false);
    }
  });

  it.each(materialInputs)('accepts an HTTP source link', ({ schema, input }) => {
    expect(
      schema.safeParse({
        ...input,
        source: 'https://manufacturer.example/material',
      }).success,
    ).toBe(true);
  });

  it.each(materialInputs)('rejects a non-internet source', ({ schema, input }) => {
    expect(
      schema.safeParse({
        ...input,
        source: 'manufacturer.example/material',
      }).success,
    ).toBe(false);
  });

  it.each([
    updateMaterialCableTypeSchema,
    updateMaterialCableInstallationMaterialSchema,
    updateMaterialTrayInstallationMaterialSchema,
    updateMaterialTraySchema,
    updateMaterialSupportSchema,
  ])('accepts a price-only catalog update', (schema) => {
    expect(schema.safeParse({ unitPrice: 8.75 }).success).toBe(true);
  });
});
