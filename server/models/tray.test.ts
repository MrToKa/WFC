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

describe('tray length source', () => {
  const calculation = {
    lengthMm: 3000.123, elementCount: 2, modelVersionId: '00000000-0000-4000-8000-000000000001',
    geometryRevision: '2', aggregateId: '00000000-0000-4000-8000-000000000002',
    traceId: '00000000-0000-4000-8000-000000000003', calculatedAt: '2026-10-29T12:00:00.000Z',
  };
  it('treats existing lengths without provenance as manual', () => {
    expect(mapTrayRow({ ...tray, length_mm: '3000.123' })).toMatchObject({ lengthMm: 3000.123, lengthSource: 'manual', lengthCalculation: null });
  });
  it('returns a validated saved measurement without rounding away its precision', () => {
    expect(mapTrayRow({ ...tray, length_mm: '3000.123', length_source: 'auto', length_calculation: calculation })).toMatchObject({ lengthSource: 'auto', lengthCalculation: calculation });
  });
  it.each([null, { ...calculation, lengthMm: 5 }, { ...calculation, traceId: 'invalid' }])('does not label mismatched calculation metadata as automatic', (length_calculation) => {
    expect(mapTrayRow({ ...tray, length_mm: 3000.123, length_source: 'auto', length_calculation })).toMatchObject({ lengthSource: 'manual', lengthCalculation: null });
  });
});
