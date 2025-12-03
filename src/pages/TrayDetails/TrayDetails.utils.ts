import { Tray, Cable, TrayInput, ProjectCableLayout } from '../../api/client';
import {
  CABLE_CATEGORY_ORDER,
  DEFAULT_CATEGORY_SETTINGS,
  type CableCategoryKey
} from '../ProjectDetails/hooks/cableLayoutDefaults';
import { determineCableDiameterGroup, type TrayLayoutSummary } from './trayDrawingService';
import { TrayFormState, TrayFormErrors } from './TrayDetails.types';

export const KN_PER_KG = 9.80665 / 1000;
export const FLOAT_TOLERANCE = 1e-6;

export const toNullableString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export const toTrayFormState = (tray: Tray): TrayFormState => ({
  name: tray.name,
  type: tray.type ?? '',
  purpose: tray.purpose ?? '',
  widthMm: tray.widthMm !== null ? String(tray.widthMm) : '',
  heightMm: tray.heightMm !== null ? String(tray.heightMm) : '',
  lengthMm: tray.lengthMm !== null ? String(tray.lengthMm) : '',
  weightKgPerM: ''
});

export const parseNumberInput = (value: string): { numeric: number | null; error?: string } => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { numeric: null };
  }
  const normalised = trimmed.replace(',', '.');
  const parsed = Number(normalised);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { numeric: null, error: 'Enter a valid non-negative number' };
  }
  return { numeric: parsed };
};

export const routingContainsTray = (routing: string | null, trayName: string): boolean => {
  if (!routing) {
    return false;
  }

  const target = trayName.trim().toLowerCase();
  if (!target) {
    return false;
  }

  return routing
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .some((segment) => segment === target);
};

export const filterCablesByTray = (cables: Cable[], trayName: string): Cable[] =>
  cables.filter((cable) => routingContainsTray(cable.routing, trayName));

export const isGroundingPurpose = (purpose: string | null): boolean =>
  purpose !== null && purpose.trim().toLowerCase() === 'grounding';

export const formatDimensionValue = (value: number | null | undefined): string =>
  value === null || value === undefined || Number.isNaN(value) ? '' : String(value);

export const formatWeightValue = (value: number | null | undefined): string =>
  value === null || value === undefined || Number.isNaN(value) ? '' : value.toFixed(3);

export const buildTrayInput = (values: TrayFormState): { input: TrayInput; errors: TrayFormErrors } => {
  const errors: TrayFormErrors = {};

  const name = values.name.trim();
  if (name === '') {
    errors.name = 'Name is required';
  }

  const widthResult = parseNumberInput(values.widthMm);
  if (widthResult.error) {
    errors.widthMm = widthResult.error;
  }

  const heightResult = parseNumberInput(values.heightMm);
  if (heightResult.error) {
    errors.heightMm = heightResult.error;
  }

  const lengthResult = parseNumberInput(values.lengthMm);
  if (lengthResult.error) {
    errors.lengthMm = lengthResult.error;
  }

  const input: TrayInput = {
    name,
    type: toNullableString(values.type),
    purpose: toNullableString(values.purpose),
    widthMm: widthResult.numeric,
    heightMm: heightResult.numeric,
    lengthMm: lengthResult.numeric
  };

  return { input, errors };
};

export const sortTrays = (items: Tray[]): Tray[] =>
  [...items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

const MV_TYPE_A_PURPOSE = 'type a (pink color) for mv cables';

type FreeSpaceCalculationParams = {
  tray: Tray | null;
  cables: Cable[];
  layout: ProjectCableLayout | null | undefined;
  spacingBetweenCablesMm: number;
  considerBundleSpacingAsFree: boolean;
  layoutSummary?: TrayLayoutSummary | null;
};

export type TrayFreeSpaceMetrics = {
  occupiedWidthMm: number | null;
  freeWidthPercent: number | null;
  calculationAvailable: boolean;
};

const resolveBundleSpacingValue = (
  bundleSpacing: string | null | undefined,
  maxDiameter: number,
  spacingBetweenCablesMm: number
): number => {
  if (bundleSpacing === '0') {
    return 0;
  }

  if (bundleSpacing === '1D') {
    return maxDiameter > 0 ? maxDiameter : spacingBetweenCablesMm;
  }

  if (bundleSpacing === '2D') {
    if (maxDiameter > 0) {
      return maxDiameter * 2;
    }
    return spacingBetweenCablesMm * 2;
  }

  // Treat null/undefined as the base spacing between cables
  return spacingBetweenCablesMm;
};

const ensurePositiveInteger = (value: number | null | undefined, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
};

export const matchCableCategory = (purpose: string | null): CableCategoryKey | null => {
  if (!purpose) {
    return null;
  }

  const normalized = purpose.trim().toLowerCase();
  if (normalized === '') {
    return null;
  }

  if (normalized.includes('ground')) {
    return 'mv';
  }

  if (normalized.startsWith('mv') || normalized.includes('medium voltage')) {
    return 'mv';
  }

  if (normalized.includes('vfd')) {
    return 'vfd';
  }

  if (normalized.startsWith('power') || normalized.includes(' power')) {
    return 'power';
  }

  if (normalized.includes('control')) {
    return 'control';
  }

  return null;
};

export const calculateTrayFreeSpaceMetrics = ({
  tray,
  cables,
  layout,
  spacingBetweenCablesMm,
  considerBundleSpacingAsFree,
  layoutSummary
}: FreeSpaceCalculationParams): TrayFreeSpaceMetrics => {
  if (!tray) {
    return { occupiedWidthMm: null, freeWidthPercent: null, calculationAvailable: false };
  }

  if (tray.purpose && tray.purpose.trim().toLowerCase() === MV_TYPE_A_PURPOSE) {
    return { occupiedWidthMm: null, freeWidthPercent: null, calculationAvailable: false };
  }

  const trayWidthValue =
    typeof tray.widthMm === 'number' && Number.isFinite(tray.widthMm) && tray.widthMm > 0
      ? tray.widthMm
      : null;

  if (layoutSummary) {
    const occupiedWidthMm = considerBundleSpacingAsFree
      ? layoutSummary.occupiedWidthWithoutBundleSpacingMm
      : layoutSummary.occupiedWidthWithBundleSpacingMm;

    if (trayWidthValue === null) {
      return {
        occupiedWidthMm,
        freeWidthPercent: null,
        calculationAvailable: true
      };
    }

    const freeWidthPercent = trayWidthValue > 0
      ? Math.max(0, ((trayWidthValue - occupiedWidthMm) / trayWidthValue) * 100)
      : null;

    return {
      occupiedWidthMm,
      freeWidthPercent,
      calculationAvailable: true
    };
  }

  const normalizedSpacing = Number.isFinite(spacingBetweenCablesMm) && spacingBetweenCablesMm >= 0
    ? spacingBetweenCablesMm
    : 0;

  const categoryGroups = CABLE_CATEGORY_ORDER.reduce<Record<CableCategoryKey, Record<string, number[]>>>(
    (acc, key) => {
      acc[key] = {};
      return acc;
    },
    {} as Record<CableCategoryKey, Record<string, number[]>>
  );

  let hasDiameters = false;
  let missingDiameters = false;

  for (const cable of cables) {
    const category = matchCableCategory(cable.purpose);
    if (!category) {
      continue;
    }

    const diameter =
      typeof cable.diameterMm === 'number' && Number.isFinite(cable.diameterMm) && cable.diameterMm > 0
        ? cable.diameterMm
        : null;

    if (diameter === null) {
      missingDiameters = true;
      continue;
    }

    const groupKey = determineCableDiameterGroup(diameter);
    if (!categoryGroups[category][groupKey]) {
      categoryGroups[category][groupKey] = [];
    }

    categoryGroups[category][groupKey].push(diameter);
    hasDiameters = true;
  }

  if (missingDiameters) {
    return { occupiedWidthMm: null, freeWidthPercent: null, calculationAvailable: false };
  }

  if (!hasDiameters) {
    const trayWidth = typeof tray.widthMm === 'number' && tray.widthMm > 0 ? tray.widthMm : null;
    const freePercent = trayWidth !== null ? 100 : null;
    return { occupiedWidthMm: 0, freeWidthPercent: freePercent, calculationAvailable: true };
  }

  let totalBottomRowDiameter = 0;
  let totalSpacingWithinBundles = 0;
  let totalBundleSpacing = 0;

  for (const key of CABLE_CATEGORY_ORDER) {
    const groups = categoryGroups[key];
    const groupEntries = Object.entries(groups).filter(([, diameters]) => diameters.length > 0);

    if (groupEntries.length === 0) {
      continue;
    }

    const defaults = DEFAULT_CATEGORY_SETTINGS[key];
    const layoutSettings = layout?.[key] ?? null;
    const maxRows = ensurePositiveInteger(layoutSettings?.maxRows, ensurePositiveInteger(defaults.maxRows, 1));
    const maxColumns = ensurePositiveInteger(
      layoutSettings?.maxColumns,
      ensurePositiveInteger(defaults.maxColumns, 1)
    );
    const bundleSpacingSetting = layoutSettings?.bundleSpacing ?? defaults.bundleSpacing;
    const bundleCapacity = Math.max(1, maxRows * maxColumns);

    groupEntries.sort(([, diametersA], [, diametersB]) => {
      const maxA = Math.max(...diametersA);
      const maxB = Math.max(...diametersB);
      return maxB - maxA;
    });

    groupEntries.forEach(([, diameters], groupIndex) => {
      const sortedDiameters = [...diameters].sort((a, b) => b - a);
      const bundleSpacingValue = resolveBundleSpacingValue(
        bundleSpacingSetting,
        sortedDiameters[0] ?? 0,
        normalizedSpacing
      );

      const subBundles: number[][] = [];
      for (let i = 0; i < sortedDiameters.length; i += bundleCapacity) {
        subBundles.push(sortedDiameters.slice(i, i + bundleCapacity));
      }

      subBundles.forEach((bundle, subBundleIndex) => {
        const bottomSlots = Math.min(bundle.length, maxColumns);
        const bottomRowDiameters = bundle.slice(0, bottomSlots);
        totalBottomRowDiameter += bottomRowDiameters.reduce((sum, value) => sum + value, 0);
        totalSpacingWithinBundles += Math.max(bottomSlots - 1, 0) * normalizedSpacing;

        if (subBundleIndex < subBundles.length - 1) {
          totalBundleSpacing += bundleSpacingValue;
        }
      });

      if (groupIndex < groupEntries.length - 1) {
        totalBundleSpacing += bundleSpacingValue;
      }
    });
  }

  const baseOccupiedWidth = totalBottomRowDiameter + totalSpacingWithinBundles;
  const occupiedWidthMm = considerBundleSpacingAsFree
    ? baseOccupiedWidth
    : baseOccupiedWidth + totalBundleSpacing;

  if (trayWidthValue === null) {
    return { occupiedWidthMm, freeWidthPercent: null, calculationAvailable: true };
  }

  const freeWidthPercent = trayWidthValue > 0
    ? Math.max(0, ((trayWidthValue - occupiedWidthMm) / trayWidthValue) * 100)
    : null;

  return {
    occupiedWidthMm,
    freeWidthPercent,
    calculationAvailable: true
  };
};
