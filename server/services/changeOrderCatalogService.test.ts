import { describe, expect, it } from 'vitest';
import {
  resolveChangeOrderCatalogSnapshot,
  snapshotCableInstallationMaterial,
  snapshotCableType,
  snapshotSupport,
  snapshotTray,
} from './changeOrderCatalogService.js';

describe('Change Order catalog snapshots', () => {
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
      unit: 'm',
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
