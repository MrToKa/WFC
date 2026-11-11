import { describe, expect, it } from 'vitest';
import { mapTrayRow, type TrayRow } from './tray.js';
import {
  trayAutoLengthMeasurementSchema,
  trayAutoLengthReferenceSchema,
  trayLengthCalculationSchema,
} from '../../shared/trayAutoLength.js';
import { createTraySchema, updateTraySchema } from '../validators.js';

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
    lengthMm: 3000.123,
    elementCount: 2,
    modelVersionId: '00000000-0000-4000-8000-000000000001',
    geometryRevision: '2',
    aggregateId: '00000000-0000-4000-8000-000000000002',
    traceId: '00000000-0000-4000-8000-000000000003',
    calculatedAt: '2026-10-29T12:00:00.000Z',
  };
  it('treats existing lengths without provenance as manual', () => {
    expect(mapTrayRow({ ...tray, length_mm: '3000.123' })).toMatchObject({
      lengthMm: 3000.123,
      lengthSource: 'manual',
      lengthCalculation: null,
    });
  });
  it('returns a validated saved measurement without rounding away its precision', () => {
    expect(
      mapTrayRow({
        ...tray,
        length_mm: '3000.123',
        length_source: 'auto',
        length_calculation: calculation,
      }),
    ).toMatchObject({ lengthSource: 'auto', lengthCalculation: calculation });
  });
  it.each([null, { ...calculation, lengthMm: 5 }, { ...calculation, traceId: 'invalid' }])(
    'does not label mismatched calculation metadata as automatic',
    (length_calculation) => {
      expect(
        mapTrayRow({ ...tray, length_mm: 3000.123, length_source: 'auto', length_calculation }),
      ).toMatchObject({ lengthSource: 'manual', lengthCalculation: null });
    },
  );
});

describe('stored CAD route automatic length provenance', () => {
  const calculation = {
    source: 'cad-route',
    designId: '00000000-0000-4000-8000-000000000001',
    routeId: '00000000-0000-4000-8000-000000000002',
    routeRevision: 8,
    centerlineSha256: 'a'.repeat(64),
    lengthMm: 2680.123456,
    elementCount: 2,
    calculatedAt: '2026-11-11T12:00:00.000Z',
  };
  it('maps a matching server-stored route calculation as automatic without losing precision or source pins', () => {
    expect(trayLengthCalculationSchema.parse(calculation)).toEqual(calculation);
    expect(
      mapTrayRow({
        ...tray,
        length_mm: '2680.123456',
        length_source: 'auto',
        length_calculation: calculation,
      }),
    ).toMatchObject({
      lengthMm: 2680.123456,
      lengthSource: 'auto',
      lengthCalculation: calculation,
    });
  });
  it.each([
    { ...calculation, lengthMm: 2680 },
    { ...calculation, designId: 'invalid' },
    { ...calculation, routeId: 'invalid' },
    { ...calculation, routeRevision: 0 },
    { ...calculation, routeRevision: 1.5 },
    { ...calculation, centerlineSha256: 'bad-hash' },
    { ...calculation, elementCount: 0 },
    { ...calculation, calculatedAt: 'yesterday' },
    { ...calculation, untrustedGeometry: [] },
  ])(
    'does not present invalid or length-mismatched CAD metadata as an authenticated automatic measurement',
    (length_calculation) => {
      expect(
        mapTrayRow({
          ...tray,
          length_mm: calculation.lengthMm,
          length_source: 'auto',
          length_calculation,
        }),
      ).toMatchObject({ lengthSource: 'manual', lengthCalculation: null });
    },
  );
  it('does not relabel an explicitly manual stored length because CAD metadata happens to exist', () => {
    expect(
      mapTrayRow({
        ...tray,
        length_mm: calculation.lengthMm,
        length_source: 'manual',
        length_calculation: calculation,
      }),
    ).toMatchObject({ lengthSource: 'manual', lengthCalculation: null });
  });
  it('rejects zero, nonfinite and excessive CAD centerline lengths even when the stored numeric length matches', () => {
    for (const lengthMm of [0, -1, NaN, Infinity, 1000001]) {
      expect(trayLengthCalculationSchema.safeParse({ ...calculation, lengthMm }).success).toBe(
        false,
      );
      expect(
        mapTrayRow({
          ...tray,
          length_mm: lengthMm,
          length_source: 'auto',
          length_calculation: { ...calculation, lengthMm },
        }),
      ).toMatchObject({ lengthSource: 'manual', lengthCalculation: null });
    }
  });
  it('rejects CAD provenance as a user-supplied automatic-length reference or measurement', () => {
    const {
      lengthMm: _length,
      elementCount: _count,
      calculatedAt: _date,
      ...reference
    } = calculation;
    expect(trayAutoLengthReferenceSchema.safeParse(reference).success).toBe(false);
    expect(
      trayAutoLengthMeasurementSchema.safeParse({
        ...reference,
        lengthMm: calculation.lengthMm,
        elementCount: 2,
      }).success,
    ).toBe(false);
    expect(
      updateTraySchema.safeParse({
        lengthMm: calculation.lengthMm,
        lengthSource: 'auto',
        autoLengthReference: reference,
      }).success,
    ).toBe(false);
    expect(
      createTraySchema.safeParse({
        name: 'CAD-01',
        lengthMm: calculation.lengthMm,
        lengthSource: 'auto',
        lengthCalculation: calculation,
      }).success,
    ).toBe(false);
    expect(
      updateTraySchema.safeParse({ lengthMm: calculation.lengthMm, lengthCalculation: calculation })
        .success,
    ).toBe(false);
  });
});
