import { describe, expect, it } from 'vitest';
import type { StandardMaterialOwnerCategory } from '../models/standardMaterial.js';
import { MATERIAL_CAPABILITIES } from './materialCapabilities.js';

describe('Standard Material catalog capabilities', () => {
  it('uses Tray Installation Materials as children of the matching owner category', () => {
    expect(MATERIAL_CAPABILITIES['tray-installation-material']).toMatchObject({
      referencedMaterialCategory: 'tray-installation-material',
      referencedMaterialTable: 'material_tray_installation_materials',
    });
  });

  it.each<StandardMaterialOwnerCategory>([
    'cable-type',
    'cable-installation-material',
    'tray',
    'support',
  ])('keeps Cable Installation Materials as children of %s', (category) => {
    expect(MATERIAL_CAPABILITIES[category]).toMatchObject({
      referencedMaterialCategory: 'cable-installation-material',
      referencedMaterialTable: 'material_cable_installation_materials',
    });
  });
});
