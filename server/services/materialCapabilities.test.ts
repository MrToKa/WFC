import { describe, expect, it } from 'vitest';
import type { StandardMaterialOwnerCategory } from '../models/standardMaterial.js';
import { MATERIAL_CAPABILITIES } from './materialCapabilities.js';

describe('Standard Material catalog capabilities', () => {
  it.each<StandardMaterialOwnerCategory>(['instrument', 'instrument-installation-material'])(
    'uses Instrument Installation Materials as children of %s',
    (category) => {
      expect(MATERIAL_CAPABILITIES[category]).toMatchObject({
        referencedMaterialCategory: 'instrument-installation-material',
        referencedMaterialTable: 'material_instrument_installation_materials',
      });
    },
  );

  it.each<StandardMaterialOwnerCategory>(['tray', 'support', 'tray-installation-material'])(
    'uses Tray Installation Materials for %s',
    (category) => {
      expect(MATERIAL_CAPABILITIES[category]).toMatchObject({
        referencedMaterialCategory: 'tray-installation-material',
        referencedMaterialTable: 'material_tray_installation_materials',
      });
    },
  );

  it.each<StandardMaterialOwnerCategory>(['cable-type', 'cable-installation-material'])(
    'keeps Cable Installation Materials as children of %s',
    (category) => {
      expect(MATERIAL_CAPABILITIES[category]).toMatchObject({
        referencedMaterialCategory: 'cable-installation-material',
        referencedMaterialTable: 'material_cable_installation_materials',
      });
    },
  );
});
