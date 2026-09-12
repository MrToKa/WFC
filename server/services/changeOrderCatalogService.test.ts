import { describe, expect, it, vi } from 'vitest';
import {
  resolveChangeOrderCatalogSnapshot,
  CatalogMaterialNotFoundError,
  snapshotCableInstallationMaterial,
  snapshotCableType,
  snapshotSupport,
  snapshotTray,
  snapshotTrayInstallationMaterial,
} from './changeOrderCatalogService.js';
import {
  calculateInheritedChangeOrderQuantities,
  calculateMinimumOrder,
  snapshotExpandedStandardMaterial,
} from './changeOrderService.js';

describe('Change Order catalog snapshots', () => {
  it('multiplies inherited quantities for piece-based parent materials', () => {
    expect(
      calculateInheritedChangeOrderQuantities('cable-installation-material', 4, 5, 2, 'pcs'),
    ).toEqual({
      designQuantity: 8,
      orderQuantity: 10,
    });
  });

  it.each(['instrument', 'instrument-installation-material'] as const)(
    'multiplies inherited quantities for %s parents',
    (category) => {
      expect(calculateInheritedChangeOrderQuantities(category, 4, 5, 2, 'pcs')).toEqual({
        designQuantity: 8,
        orderQuantity: 10,
      });
    },
  );

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

  it('keeps Tray Installation Standard Materials in the tray installation catalog', () => {
    expect(
      snapshotExpandedStandardMaterial({
        referencedMaterialCategory: 'tray-installation-material',
        referencedMaterialId: 'tray-fastener-id',
        name: 'Tray fastener',
        purpose: 'Tray mounting',
        material: 'Steel',
        description: 'M8 tray fastener',
        dimensionMm: '8 x 40',
        weightKg: 0.04,
        unitPrice: 1.25,
        manufacturer: 'Tray Co',
        partNo: 'TF-8',
        minimumOrderQuantity: 25,
        orderMeasurement: 'pcs',
        packaging: 'Box',
        quantity: 4,
        unit: 'pcs',
        remarks: null,
        sourceAssignmentIds: ['assignment-id'],
        depth: 1,
      }),
    ).toMatchObject({
      sourceCatalog: 'tray-installation-material',
      sourceMaterialId: 'tray-fastener-id',
      descriptionEn: 'Tray fastener',
      dimensionMm: '8 x 40',
      weightKg: 0.04,
      unitPrice: 1.25,
      manufacturerPartNo: 'TF-8',
    });
  });

  it('rounds required quantities to complete minimum-order packs', () => {
    expect(calculateMinimumOrder(4, 4, 100)).toEqual({
      orderQuantity: 4,
      packageCount: 1,
      spareQuantity: 96,
    });
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
      unit_price: '7.5',
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
      unitPrice: 7.5,
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
        dimension_mm: null,
        weight_kg: null,
        unit_price: '0.35',
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
      unitPrice: 0.35,
      manufacturer: null,
      manufacturerPartNo: null,
      unit: 'pcs',
      minimumOrderQuantity: 50,
      orderMeasurement: 'pcs',
      packaging: 'Package',
    });
  });

  it('maps tray installation materials into their own source catalog', () => {
    expect(
      snapshotTrayInstallationMaterial({
        id: 'tray-install-id',
        type: 'Tray connector',
        purpose: 'Tray joining',
        material: 'Steel',
        description: 'Connector plate',
        manufacturer: 'Tray Co',
        part_no: 'TC-1',
        dimension_mm: '100 x 40',
        weight_kg: '0.25',
        unit_price: '3.75',
        minimum_order_quantity: '10',
        order_measurement: 'pcs',
        packaging: 'Box',
      }),
    ).toMatchObject({
      sourceCatalog: 'tray-installation-material',
      sourceMaterialId: 'tray-install-id',
      descriptionEn: 'Tray connector',
      clearDescription: 'Connector plate',
      dimensionMm: '100 x 40',
      material: 'Steel',
      weightKg: 0.25,
      unitPrice: 3.75,
      manufacturer: 'Tray Co',
      manufacturerPartNo: 'TC-1',
      unit: 'pcs',
      minimumOrderQuantity: 10,
      orderMeasurement: 'pcs',
      packaging: 'Box',
    });
  });

  it('resolves tray installation materials from their catalog table', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'tray-install-id',
          type: 'Tray connector',
          purpose: null,
          material: null,
          description: null,
          manufacturer: null,
          part_no: null,
          dimension_mm: null,
          weight_kg: null,
          unit_price: '2.5',
          minimum_order_quantity: 1,
          order_measurement: 'pcs',
          packaging: 'pcs',
        },
      ],
    });

    await expect(
      resolveChangeOrderCatalogSnapshot({ query }, 'tray-installation-material', 'tray-install-id'),
    ).resolves.toMatchObject({
      sourceCatalog: 'tray-installation-material',
      sourceMaterialId: 'tray-install-id',
      descriptionEn: 'Tray connector',
      unitPrice: 2.5,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM material_tray_installation_materials'),
      ['tray-install-id'],
    );
  });

  it.each([
    ['instrument', 'material_instruments'],
    ['instrument-installation-material', 'material_instrument_installation_materials'],
  ] as const)(
    'resolves %s with its own catalog and a complete independent snapshot',
    async (category, table) => {
      const source = {
        id: 'instrument-material-id',
        type: ' Pressure transmitter ',
        purpose: 'Pressure measurement',
        material: ' Stainless steel ',
        description: ' Process pressure ',
        manufacturer: ' Instrument Co ',
        part_no: ' PT-1 ',
        dimension_mm: ' 50 x 100 ',
        weight_kg: '0.75',
        unit_price: '125.5',
        minimum_order_quantity: '5',
        order_measurement: 'pcs',
        packaging: 'Box',
      };
      const query = vi.fn().mockResolvedValue({ rows: [source] });

      const snapshot = await resolveChangeOrderCatalogSnapshot({ query }, category, source.id);
      source.type = 'Renamed';
      source.unit_price = '999';

      expect(snapshot).toEqual({
        sourceCatalog: category,
        sourceMaterialId: 'instrument-material-id',
        unit: 'pcs',
        descriptionEn: 'Pressure transmitter',
        clearDescription: 'Process pressure',
        dimensionMm: '50 x 100',
        material: 'Stainless steel',
        weightKg: 0.75,
        unitPrice: 125.5,
        manufacturer: 'Instrument Co',
        manufacturerPartNo: 'PT-1',
        minimumOrderQuantity: 5,
        orderMeasurement: 'pcs',
        packaging: 'Box',
      });
      expect(query).toHaveBeenCalledWith(expect.stringContaining(`FROM ${table} WHERE id = $1`), [
        'instrument-material-id',
      ]);
    },
  );

  it.each(['instrument', 'instrument-installation-material'] as const)(
    'rejects a missing %s without falling back to another catalog',
    async (category) => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      await expect(
        resolveChangeOrderCatalogSnapshot({ query }, category, 'missing'),
      ).rejects.toBeInstanceOf(CatalogMaterialNotFoundError);
      expect(query).toHaveBeenCalledOnce();
    },
  );

  it('keeps inherited instrument installation materials in their catalog', () => {
    expect(
      snapshotExpandedStandardMaterial({
        referencedMaterialCategory: 'instrument-installation-material',
        referencedMaterialId: 'bracket-id',
        name: 'Instrument bracket',
        purpose: 'Mounting',
        material: 'Steel',
        description: 'Instrument mounting bracket',
        dimensionMm: '40 x 80',
        weightKg: 0.2,
        unitPrice: 12,
        manufacturer: 'Instrument Co',
        partNo: 'IB-1',
        minimumOrderQuantity: 5,
        orderMeasurement: 'pcs',
        packaging: 'Box',
        quantity: 2,
        unit: 'pcs',
        remarks: null,
        sourceAssignmentIds: ['assignment-id'],
        depth: 1,
      }),
    ).toMatchObject({
      sourceCatalog: 'instrument-installation-material',
      sourceMaterialId: 'bracket-id',
      descriptionEn: 'Instrument bracket',
      unitPrice: 12,
      manufacturerPartNo: 'IB-1',
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
        unit_price: 12.5,
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
        unit_price: 8.75,
        minimum_order_quantity: 10,
        order_measurement: 'pcs',
        packaging: 'Box',
      }),
    ).toMatchObject({
      sourceCatalog: 'support',
      dimensionMm: 'H 40 × W 60 × L 3000',
      weightKg: 3.3,
      unitPrice: 8.75,
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
