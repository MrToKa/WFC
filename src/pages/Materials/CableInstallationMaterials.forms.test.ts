import { describe, expect, it } from 'vitest';
import {
  buildMaterialCableInstallationMaterialInput,
  emptyCableInstallationMaterialForm,
  toCableInstallationMaterialFormState,
} from './CableInstallationMaterials.forms';

describe('cable installation material form', () => {
  it('maps dimension and weight through edit and save values', () => {
    const form = toCableInstallationMaterialFormState({
      id: '00000000-0000-4000-8000-000000000001',
      type: 'Cable gland',
      purpose: null,
      material: null,
      description: null,
      manufacturer: null,
      partNo: null,
      dimensionMm: '32 × 45',
      weightKg: 0.18,
      minimumOrderQuantity: 1,
      orderMeasurement: 'pcs',
      packaging: 'pcs',
      unitPrice: 12.5,
      source: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(form).toMatchObject({
      dimensionMm: '32 × 45',
      weightKg: '0.18',
      unitPrice: '12.5',
    });
    expect(buildMaterialCableInstallationMaterialInput(form)).toMatchObject({
      input: { dimensionMm: '32 × 45', weightKg: 0.18, unitPrice: 12.5 },
      errors: {},
    });
  });

  it('rejects a negative weight', () => {
    const result = buildMaterialCableInstallationMaterialInput({
      ...emptyCableInstallationMaterialForm,
      type: 'Cable gland',
      weightKg: '-0.1',
    });

    expect(result.errors.weightKg).toBe('Weight must be a non-negative number');
  });

  it('allows weight to be empty and saves it as null', () => {
    const result = buildMaterialCableInstallationMaterialInput({
      ...emptyCableInstallationMaterialForm,
      type: 'Cable gland',
      weightKg: '',
    });

    expect(result.errors.weightKg).toBeUndefined();
    expect(result.input.weightKg).toBeNull();
  });

  it('rejects a negative or empty price', () => {
    const negative = buildMaterialCableInstallationMaterialInput({
      ...emptyCableInstallationMaterialForm,
      type: 'Cable gland',
      unitPrice: '-0.1',
    });
    const empty = buildMaterialCableInstallationMaterialInput({
      ...emptyCableInstallationMaterialForm,
      type: 'Cable gland',
      unitPrice: '',
    });

    expect(negative.errors.unitPrice).toBe('Price must be a non-negative number');
    expect(empty.errors.unitPrice).toBe('Price must be a non-negative number');
  });
});
