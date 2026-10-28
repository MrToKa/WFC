import type { CustomBundleRange } from './types.js';
export type { CustomBundleRange } from './types.js';
export const getBundleRangeLabel = (range: CustomBundleRange): string => `${range.min}-${range.max}`;
export const findCustomBundleRange = (diameter: number, ranges: CustomBundleRange[]): string | null => {
  if (!Number.isFinite(diameter) || diameter <= 0) return null;
  for (const range of ranges) if (diameter >= range.min && diameter <= range.max) return getBundleRangeLabel(range);
  return null;
};
/** Actual bounds, not values inferred from rounded display labels. */
export const DEFAULT_RANGE_BOUNDS: Record<string, { min: number; max: number | null; minInclusive: boolean }> = {
  '0-8': { min: 0, max: 8, minInclusive: false }, '8.1-15': { min: 8, max: 15, minInclusive: false },
  '15.1-21': { min: 15, max: 21, minInclusive: false }, '21.1-30': { min: 21, max: 30, minInclusive: false },
  '30.1-40': { min: 30, max: 40, minInclusive: false }, '40.1-45': { min: 40, max: 45, minInclusive: false },
  '45.1-60': { min: 45, max: 60, minInclusive: false }, '60+': { min: 60, max: null, minInclusive: false },
};
