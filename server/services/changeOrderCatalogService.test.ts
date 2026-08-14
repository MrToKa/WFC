import { describe, expect, it } from 'vitest';
import {
  resolveChangeOrderCatalogSnapshot,
  snapshotCableInstallationMaterial,
  snapshotCableType,
  snapshotSupport,
  snapshotTray,
} from './changeOrderCatalogService.js';
import {
  calculateInheritedChangeOrderQuantities,
  calculateMinimumOrder,
} from './changeOrderService.js';

describe('Change Order catalog snapshots', () => {
  it('multiplies inherited quantities for piece-based parent materials', () => {
    expect(
      calculateInheritedChangeOrderQuantities(
        'cable-installation-material',
        4,
        5,
        2,
        'pcs',
      ),
    ).toEqual({
      designQuantity: 8,
      orderQuantity: 10,
    });
  });

  it('counts Cable Type Standard Materials per cable line rather than per metre', () => {
    expect(calculateInheritedChangeOrderQuantities('cable-type', 200, 240, 4, 'pcs')).toEqual({
      designQuantity: 4,
      orderQuantity: 4,
    });
  });

  it('multiplies Cable Type pcs/m materials by cable length', () => {
    expect(calculateInheritedChangeOrderQuantities('cable-type', 200, 240, 2, 'pcs/m')).toEqual({
      designQuantity: 400,
      orderQuantity: 480,
    });
  });

  it('rounds required quantities to complete minimum-order packs', () => {
    expect(calculateMinimumOrder(24, 24, 50)).toEqual({
      orderQuantity: 24,
      packageCount: 1,
      spareQuantity: 26,
    });
    expect(calculateMinimumOrder(51, 51, 50)).toEqual({
      orderQuantity: 51,
      packageCount: 2,
      spareQuantity: 49,
    });
    expect(calculateMinimumOrder(75, 75, 50)).toEqual({
      orderQuantity: 75,
      packageCount: 2,
      spareQuantity: 25,
    });
    expect(calculateMinimumOrder(104, 104, 1)).toEqual({
      orderQuantity: 104,
      packageCount: 104,
      spareQuantity: 0,
    });
    expect(calculateMinimumOrder(50, 52, 1)).toEqual({
      orderQuantity: 52,
      packageCount: 52,
      spareQuantity: 2,
    });
  });
  it('maps cable types and does not change a snapshot when its source changes later', () => {
    const source = {
      id: 'cable-id',
      name: 'Power cable',
      purpose: 'Feeder',
      material: 'Copper',
      description: 'Low-smoke cable',
      manufacturer: 'Cable Co',
      part_no: 'C-1',
      diameter_mm: '12.5',
      weight_kg_per_m: '0.25',
      minimum_order_quantity: '50',
      order_measurement: 'meters' as const,
      packaging: 'Drum' as const,
    };
    const snapshot = snapshotCableType(source);
    source.name = 'Renamed cable';
    source.manufacturer = 'Another maker';

    expect(snapshot).toMatchObject({
      sourceCatalog: 'cable-type',
      descriptionEn: 'Power cable',
      clearDescription: 'Low-smoke cable',
      dimensionMm: '12.5',
      material: 'Copper',
      weightKg: 0.25,
      manufacturer: 'Cable Co',
      manufacturerPartNo: 'C-1',
      unit: 'meters',
      minimumOrderQuantity: 50,
      orderMeasurement: 'meters',
      packaging: 'Drum',
    });
  });

  it('maps installation materials and preserves missing optional fields', () => {
    expect(
      snapshotCableInstallationMaterial({
        id: 'install-id',
        type: 'Cable tie',
        purpose: null,
        material: null,
        description: null,
        manufacturer: null,
        part_no: null,
        minimum_order_quantity: 50,
        order_measurement: 'pcs',
        packaging: 'Package',
      }),
    ).toMatchObject({
      sourceCatalog: 'cable-installation-material',
      descriptionEn: 'Cable tie',
      clearDescription: null,
      material: null,
      weightKg: null,
      manufacturer: null,
      manufacturerPartNo: null,
      unit: 'pcs',
      minimumOrderQuantity: 50,
      orderMeasurement: 'pcs',
      packaging: 'Package',
    });
  });

  it('maps only the available tray and support dimensions', () => {
    expect(
      snapshotTray({
        id: 'tray-id',
        tray_type: 'KL 60',
        manufacturer: 'Niedax',
        height_mm: 60,
        rung_height_mm: null,
        width_mm: 300,
        weight_kg_per_m: 2.2,
        minimum_order_quantity: 1,
        order_measurement: 'meters',
        packaging: 'm',
      }).dimensionMm,
    ).toBe('H 60 × W 300');
    expect(
      snapshotSupport({
        id: 'support-id',
        support_type: 'U profile',
        manufacturer: 'Niedax',
        height_mm: 40,
        width_mm: 60,
        length_mm: 3000,
        weight_kg: 3.3,
        minimum_order_quantity: 10,
        order_measurement: 'pcs',
        packaging: 'Box',
      }),
    ).toMatchObject({
      sourceCatalog: 'support',
      dimensionMm: 'H 40 × W 60 × L 3000',
      weightKg: 3.3,
      unit: 'pcs',
    });
  });

  it('rejects a source material that does not exist', async () => {
    const queryable = {
      query: async () => ({ rows: [] }),
    };
    await expect(resolveChangeOrderCatalogSnapshot(queryable, 'tray', 'missing')).rejects.toThrow(
      'Source material not found',
    );
  });
});
