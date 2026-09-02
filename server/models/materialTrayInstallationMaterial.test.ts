import { describe, expect, it } from 'vitest';
import { mapMaterialTrayInstallationMaterialRow } from './materialTrayInstallationMaterial.js';

describe('mapMaterialTrayInstallationMaterialRow', () => {
  it('maps database names, numeric values, and timestamps to the public contract', () => {
    expect(
      mapMaterialTrayInstallationMaterialRow({
        id: '00000000-0000-4000-8000-000000000001',
        type: 'Tray splice connector',
        purpose: 'Joining',
        material: 'Stainless steel',
        description: null,
        manufacturer: 'Example',
        part_no: 'TS-1',
        dimension_mm: '40 x 20',
        weight_kg: '0.125',
        minimum_order_quantity: '25',
        order_measurement: 'pcs',
        packaging: 'Box',
        source: 'https://manufacturer.example/ts-1',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: '2026-01-02T00:00:00.000Z',
      }),
    ).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      type: 'Tray splice connector',
      purpose: 'Joining',
      material: 'Stainless steel',
      description: null,
      manufacturer: 'Example',
      partNo: 'TS-1',
      dimensionMm: '40 x 20',
      weightKg: 0.125,
      minimumOrderQuantity: 25,
      orderMeasurement: 'pcs',
      packaging: 'Box',
      source: 'https://manufacturer.example/ts-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });
});
