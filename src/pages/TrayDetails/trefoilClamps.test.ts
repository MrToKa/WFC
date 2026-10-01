import { describe, expect, it } from 'vitest';
import type { Cable } from '@/api/client';
import { calculateTrefoilClampWeight, selectTrefoilClamp, TREFOIL_CLAMPS } from './trefoilClamps';

const group = (diameters: Array<number | null>) => ({
  cables: diameters.map((diameterMm) => ({ diameterMm }) as Cable),
  clamp: selectTrefoilClamp(diameters),
});

describe('Vulcan+ trefoil clamps', () => {
  // One independent example for every trefoil model in the supplied DS03E sheet.
  // These midpoint cases also prove overlapping ranges do not hide any catalog model.
  it.each([
    ['VRT+00C', 12.5, 57, 94, 276],
    ['VRT+00A', 16.5, 60, 93, 287],
    ['VRT+00', 21.5, 60, 92, 251],
    ['VRT+01', 25.5, 66, 100, 258],
    ['VRT+02', 29.5, 74, 108, 269],
    ['VRT+03', 32.5, 80, 113, 279],
    ['VRT+04', 35.5, 86, 119, 284],
    ['VRT+05', 39, 94, 125, 319],
    ['VRT+06', 43, 102, 134, 331],
    ['VRT+07', 47, 110, 140, 391],
    ['VRT+08', 51.5, 120, 151, 405],
    ['VRT+09', 54.5, 126, 156, 411],
    ['VRT+10', 58.5, 134, 162, 442],
    ['VRT+11', 62.5, 142, 168, 453],
    ['VRT+12', 66.5, 150, 178, 460],
    ['VRT+13', 70.5, 158, 185, 524],
    ['VRT+14', 74.5, 166, 196, 536],
    ['VRT+15', 78, 174, 202, 542],
    ['VRT+16', 81, 180, 206, 544],
    ['VRT+17', 85, 188, 212, 618],
    ['VRT+18', 89, 196, 217, 628],
    ['VRT+19', 93, 204, 222, 637],
    ['VRT+20', 97, 212, 230, 646],
  ])(
    'selects and weighs %s from the full data sheet catalog',
    (model, diameter, widthMm, heightMm, weightGrams) => {
      const selectedGroup = group([diameter, diameter, diameter]);
      expect(selectedGroup.clamp).toMatchObject({ model, widthMm, heightMm, weightGrams });
      const mass = calculateTrefoilClampWeight([selectedGroup], 1200, 600);
      expect(mass.issues).toEqual([]);
      expect(mass.totalCount).toBe(3);
      expect(mass.totalWeightKg).toBeCloseTo((3 * weightGrams) / 1000);
      expect(mass.rows[0].clamp.model).toBe(model);
    },
  );

  it.each([
    [35, 'VRT+04', 33, 38, 284],
    [40, 'VRT+05', 36, 42, 319],
    [10, 'VRT+00C', 10, 15, 276],
    [101, 'VRT+20', 93, 101, 646],
  ])('selects the catalog clamp for a %s mm cable', (diameter, model, min, max, weight) => {
    expect(selectTrefoilClamp([diameter, diameter, diameter])).toMatchObject({
      model,
      minDiameterMm: min,
      maxDiameterMm: max,
      weightGrams: weight,
    });
  });

  it('requires the selected range to fit all three diameters', () => {
    expect(selectTrefoilClamp([30, 35, 33])?.model).toBe('VRT+03');
    expect(selectTrefoilClamp([30, 40, 35])).toBeNull();
  });

  it('keeps the data sheet gap between 18 and 19 mm', () => {
    expect(selectTrefoilClamp([18.5, 18.5, 18.5])).toBeNull();
  });

  it.each([null, undefined, 0, -1, NaN, Infinity, 9.9, 101.1])(
    'rejects unsupported diameter %s',
    (diameter) => {
      expect(selectTrefoilClamp([diameter, diameter, diameter])).toBeNull();
    },
  );

  it('excludes single-only models and incomplete phase sets', () => {
    expect(TREFOIL_CLAMPS).toHaveLength(23);
    expect(TREFOIL_CLAMPS.some((clamp) => clamp.model === 'VRT+00B')).toBe(false);
    expect(selectTrefoilClamp([35, 35])).toBeNull();
  });
});

describe('trefoil clamp mass', () => {
  it('counts both ends and each interval, grouping equal models', () => {
    const result = calculateTrefoilClampWeight(
      [group([35, 35, 35]), group([35, 35, 35]), group([40, 40, 40])],
      1200,
      600,
    );
    expect(result).toMatchObject({ groupCount: 3, countPerGroup: 3, totalCount: 9, issues: [] });
    expect(result.rows.map((row) => [row.clamp.model, row.groupCount, row.totalCount])).toEqual([
      ['VRT+04', 2, 6],
      ['VRT+05', 1, 3],
    ]);
    expect(result.totalWeightKg).toBeCloseTo(2.661);
    expect(result.weightPerMeterKg).toBeCloseTo(2.2175);
  });

  it('includes an end clamp on a partial final interval and on short trays', () => {
    expect(calculateTrefoilClampWeight([group([35, 35, 35])], 1201).countPerGroup).toBe(4);
    expect(calculateTrefoilClampWeight([group([35, 35, 35])], 100).countPerGroup).toBe(2);
  });

  it('refuses partial mass totals when any group has no catalog fit', () => {
    const result = calculateTrefoilClampWeight([group([35, 35, 35]), group([105, 105, 105])], 1200);
    expect(result.totalWeightKg).toBeNull();
    expect(result.weightPerMeterKg).toBeNull();
    expect(result.totalCount).toBeNull();
    expect(result.rows[0].totalWeightKg).toBeCloseTo(0.852);
    expect(result.issues[0]).toContain('group 2');
  });

  it.each([0, -10, NaN, Infinity, 1_000_001])('rejects invalid spacing %s', (spacing) => {
    const result = calculateTrefoilClampWeight([group([35, 35, 35])], 1200, spacing);
    expect(result.totalWeightKg).toBeNull();
    expect(result.countPerGroup).toBeNull();
  });

  it('distinguishes an empty tray from an unavailable layout', () => {
    expect(calculateTrefoilClampWeight([], null)).toMatchObject({
      totalCount: 0,
      totalWeightKg: 0,
      weightPerMeterKg: 0,
      issues: [],
    });
    expect(calculateTrefoilClampWeight(undefined, 1200).totalWeightKg).toBeNull();
  });

  it.each([null, 0, -1, NaN, Infinity])('requires a valid tray length %s', (length) => {
    expect(calculateTrefoilClampWeight([group([35, 35, 35])], length).totalWeightKg).toBeNull();
  });
});
