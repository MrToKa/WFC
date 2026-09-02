import { describe, expect, it } from 'vitest';
import { MATERIAL_DETAILS_CAPABILITIES, materialsBackPath } from './materialCapabilities';
import { parseMaterialsTab } from './Materials.types';

describe('Material Details navigation', () => {
  it.each([
    ['cable-type', '/materials/cable-types/id', 'cableTypes'],
    [
      'cable-installation-material',
      '/materials/cable-installation-materials/id',
      'cableInstallationMaterials',
    ],
    [
      'tray-installation-material',
      '/materials/tray-installation-materials/id',
      'trayInstallationMaterials',
    ],
    ['tray', '/materials/trays/id', 'trays'],
    ['support', '/materials/supports/id', 'supports'],
  ] as const)(
    'builds the %s details route and tab-preserving Back route',
    (category, route, tab) => {
      const capability = MATERIAL_DETAILS_CAPABILITIES[category];
      expect(capability.route('id')).toBe(route);
      expect(materialsBackPath(capability.tab)).toBe(`/materials?tab=${tab}`);
    },
  );

  it('falls back safely for an invalid tab query value', () => {
    expect(parseMaterialsTab('unknown')).toBe('cableTypes');
    expect(parseMaterialsTab(null)).toBe('cableTypes');
    expect(parseMaterialsTab('supports')).toBe('supports');
    expect(parseMaterialsTab('trayInstallationMaterials')).toBe('trayInstallationMaterials');
  });
});
