import type { ProjectCableCategorySettings } from '@/api/types';
import type { CableCategoryKey } from '@/pages/ProjectDetails/hooks/cableLayoutDefaults';

const STORAGE_KEY = 'wfc:tray-bundle-overrides';

/**
 * Custom bundle size range for cable diameter grouping.
 * Used to override the default bundle size ranges per category.
 */
export type CustomBundleRange = {
  id: string;
  min: number;
  max: number;
  maxRows?: number | null;
};

/**
 * Validates that custom bundle ranges don't overlap and have proper gaps.
 * Returns an error message if invalid ranges are found, null otherwise.
 * 
 * Rules:
 * - min and max must be positive numbers
 * - max must be greater than min (e.g., min: 8, max: 8 is invalid)
 * - Ranges must not overlap (current.max > next.min is an overlap)
 * - Next range's min should be at least 0.1 greater than previous range's max
 *   (e.g., if range ends at 8, next should start at 8.1 or higher)
 */
export const validateBundleRanges = (
  ranges: CustomBundleRange[]
): string | null => {
  if (ranges.length === 0) {
    return null;
  }

  // Check for invalid min/max values
  for (const range of ranges) {
    if (range.min < 0 || range.max < 0) {
      return 'Bundle range values must be positive numbers.';
    }
    if (range.min >= range.max) {
      return `Invalid range: min (${range.min}) must be less than max (${range.max}). Use ${range.min + 0.1} as minimum for the next range.`;
    }
    if (range.maxRows !== undefined && range.maxRows !== null) {
      if (!Number.isInteger(range.maxRows)) {
        return `Invalid max rows for range ${range.min}-${range.max}: enter a whole number.`;
      }
      if (range.maxRows < 1 || range.maxRows > 1_000) {
        return `Invalid max rows for range ${range.min}-${range.max}: value must be between 1 and 1000.`;
      }
    }
  }

  // Sort ranges by min value to check for overlaps
  const sorted = [...ranges].sort((a, b) => a.min - b.min);

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    // Check if current range overlaps with next range
    // Ranges overlap if current.max >= next.min (they touch or overlap)
    if (current.max >= next.min) {
      const suggestedMin = current.max + 0.1;
      return `Ranges overlap or touch: [${current.min}-${current.max}] and [${next.min}-${next.max}]. Next range should start at ${suggestedMin} or higher.`;
    }
  }

  return null;
};

/**
 * Generates a unique ID for a new bundle range.
 */
export const generateBundleRangeId = (): string =>
  `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/**
 * Converts custom bundle ranges to a label for the bundle key.
 */
export const getBundleRangeLabel = (range: CustomBundleRange): string =>
  `${range.min}-${range.max}`;

/**
 * Determines which custom bundle range a diameter falls into.
 * Returns the range label if found, null otherwise.
 */
export const findCustomBundleRange = (
  diameter: number,
  ranges: CustomBundleRange[]
): string | null => {
  if (ranges.length === 0 || !Number.isFinite(diameter) || diameter <= 0) {
    return null;
  }

  for (const range of ranges) {
    if (diameter >= range.min && diameter <= range.max) {
      return getBundleRangeLabel(range);
    }
  }

  return null;
};

type StoredMap = Record<
  string,
  {
    useCustom: boolean;
    categories: Partial<Record<CableCategoryKey, ProjectCableCategorySettings>>;
    customBundleRanges?: Partial<Record<CableCategoryKey, CustomBundleRange[]>>;
  }
>;

export type TrayBundleOverride = {
  useCustom: boolean;
  categories: Partial<Record<CableCategoryKey, ProjectCableCategorySettings>>;
  customBundleRanges?: Partial<Record<CableCategoryKey, CustomBundleRange[]>>;
};

const isBrowserEnvironment =
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const buildKey = (projectId: string, trayId: string): string =>
  `${projectId}:${trayId}`;

const loadOverrides = (): StoredMap => {
  if (!isBrowserEnvironment) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }

    return parsed as StoredMap;
  } catch (error) {
    console.warn('Failed to read stored tray bundle overrides', error);
    return {};
  }
};

const persistOverrides = (map: StoredMap) => {
  if (!isBrowserEnvironment) {
    return;
  }

  try {
    if (Object.keys(map).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (error) {
    console.warn('Failed to persist tray bundle overrides', error);
  }
};

export const getTrayBundleOverrides = (
  projectId: string | null | undefined,
  trayId: string | null | undefined
): TrayBundleOverride | null => {
  if (!projectId || !trayId) {
    return null;
  }

  const map = loadOverrides();
  const key = buildKey(projectId, trayId);
  const value = map[key];

  if (!value) {
    return null;
  }

  return {
    useCustom: Boolean(value.useCustom),
    categories: value.categories ?? {},
    customBundleRanges: value.customBundleRanges ?? {}
  };
};

export const setTrayBundleOverrides = (
  projectId: string | null | undefined,
  trayId: string | null | undefined,
  override: TrayBundleOverride
): TrayBundleOverride => {
  if (!projectId || !trayId) {
    return override;
  }

  const map = loadOverrides();
  const key = buildKey(projectId, trayId);

  map[key] = {
    useCustom: Boolean(override.useCustom),
    categories: override.categories ?? {},
    customBundleRanges: override.customBundleRanges ?? {}
  };

  persistOverrides(map);
  return map[key];
};

export const clearTrayBundleOverrides = (
  projectId: string | null | undefined,
  trayId: string | null | undefined
): void => {
  if (!projectId || !trayId) {
    return;
  }

  const map = loadOverrides();
  const key = buildKey(projectId, trayId);

  if (!(key in map)) {
    return;
  }

  delete map[key];
  persistOverrides(map);
};
