import { describe, expect, it } from 'vitest';
import { mapTrayRow, type TrayRow } from './tray.js';

const tray: TrayRow = {
  id: 'tray',
  project_id: 'project',
  name: 'T1',
  tray_type: null,
  purpose: null,
  width_mm: null,
  height_mm: null,
  length_mm: null,
  include_grounding_cable: false,
  grounding_cable_type_id: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

describe('tray clamp preferences', () => {
  it('defaults legacy rows to disabled clamps spaced at 600 mm', () => {
    expect(mapTrayRow(tray)).toMatchObject({
      useTrefoilClamps: false,
      trefoilClampSpacingMm: 600,
    });
  });

  it('maps stored numeric spacing and the enabled setting', () => {
    expect(
      mapTrayRow({ ...tray, use_trefoil_clamps: true, trefoil_clamp_spacing_mm: '750.50' }),
    ).toMatchObject({ useTrefoilClamps: true, trefoilClampSpacingMm: 750.5 });
  });
});
