import type { PublicTray } from '../models/tray.js';
import type {
  CableBundleSpacing,
  PublicCableLayout
} from '../models/project.js';

export type TrayCableForFreeSpace = {
  routing: string | null;
  purpose: string | null;
  diameterMm: number | null;
};

export type CableCategoryKey = 'mv' | 'power' | 'vfd' | 'control';

const CABLE_CATEGORY_ORDER: CableCategoryKey[] = [
  'mv',
  'power',
  'vfd',
  'control'
];

const DEFAULT_CATEGORY_SETTINGS: Record<
  CableCategoryKey,
  {
    maxRows: number;
    maxColumns: number;
    bundleSpacing: CableBundleSpacing;
  }
> = {
  mv: { maxRows: 2, maxColumns: 2, bundleSpacing: '2D' },
  power: { maxRows: 3, maxColumns: 20, bundleSpacing: '2D' },
  vfd: { maxRows: 3, maxColumns: 20, bundleSpacing: '2D' },
  control: { maxRows: 7, maxColumns: 20, bundleSpacing: '2D' }
};

const DEFAULT_CABLE_SPACING = 1;

const MV_TYPE_A_PURPOSE = 'type a (pink color) for mv cables';

const BUNDLE_GROUP_LABELS = {
  range0_8: '0-8',
  range8_1_15: '8.1-15',
  range15_1_21: '15.1-21',
  range21_1_30: '21.1-30',
  range30_1_40: '30.1-40',
  range40_1_45: '40.1-45',
  range45_1_60: '45.1-60',
  range60Plus: '60+'
} as const;

type BundleLabel = (typeof BUNDLE_GROUP_LABELS)[keyof typeof BUNDLE_GROUP_LABELS];

type FreeSpaceCalculationParams = {
  tray: PublicTray | null;
  cables: TrayCableForFreeSpace[];
  layout: PublicCableLayout | null | undefined;
  spacingBetweenCablesMm: number;
  considerBundleSpacingAsFree: boolean;
};

type TrayFreeSpaceMetrics = {
  occupiedWidthMm: number | null;
  freeWidthPercent: number | null;
  calculationAvailable: boolean;
};

const determineCableDiameterGroup = (
  diameter: number | null | undefined
): BundleLabel => {
  if (diameter === null || diameter === undefined || Number.isNaN(diameter) || diameter <= 0) {
    return BUNDLE_GROUP_LABELS.range0_8;
  }

  if (diameter <= 8) return BUNDLE_GROUP_LABELS.range0_8;
  if (diameter <= 15) return BUNDLE_GROUP_LABELS.range8_1_15;
  if (diameter <= 21) return BUNDLE_GROUP_LABELS.range15_1_21;
  if (diameter <= 30) return BUNDLE_GROUP_LABELS.range21_1_30;
  if (diameter <= 40) return BUNDLE_GROUP_LABELS.range30_1_40;
  if (diameter <= 45) return BUNDLE_GROUP_LABELS.range40_1_45;
  if (diameter <= 60) return BUNDLE_GROUP_LABELS.range45_1_60;
  return BUNDLE_GROUP_LABELS.range60Plus;
};

const routingContainsTray = (
  routing: string | null | undefined,
  trayName: string
): boolean => {
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

const filterCablesByTray = (
  cables: TrayCableForFreeSpace[],
  trayName: string
): TrayCableForFreeSpace[] =>
  cables.filter((cable) => routingContainsTray(cable.routing, trayName));

const isGroundingPurpose = (purpose: string | null | undefined): boolean =>
  purpose !== null && purpose !== undefined && purpose.trim().toLowerCase() === 'grounding';

const resolveBundleSpacingValue = (
  bundleSpacing: CableBundleSpacing | null | undefined,
  maxDiameter: number,
  spacingBetweenCablesMm: number
): number => {
  if (bundleSpacing === '1D') {
    return maxDiameter > 0 ? maxDiameter : spacingBetweenCablesMm;
  }

  if (bundleSpacing === '2D') {
    if (maxDiameter > 0) {
      return maxDiameter * 2;
    }
    return spacingBetweenCablesMm * 2;
  }

  return spacingBetweenCablesMm;
};

const ensurePositiveInteger = (value: number | null | undefined, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
};

const matchCableCategory = (purpose: string | null | undefined): CableCategoryKey | null => {
  if (!purpose) {
    return null;
  }

  const normalized = purpose.trim().toLowerCase();
  if (normalized === '') {
    return null;
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

const calculateTrayFreeSpaceMetrics = ({
  tray,
  cables,
  layout,
  spacingBetweenCablesMm,
  considerBundleSpacingAsFree
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

  const normalizedSpacing =
    Number.isFinite(spacingBetweenCablesMm) && spacingBetweenCablesMm >= 0
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
    const freePercent = trayWidthValue !== null ? 100 : null;
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
    const maxRows = ensurePositiveInteger(layoutSettings?.maxRows ?? null, ensurePositiveInteger(defaults.maxRows, 1));
    const maxColumns = ensurePositiveInteger(
      layoutSettings?.maxColumns ?? null,
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

        const columns = Math.max(1, maxColumns);
        const rows = Math.max(1, maxRows);
        const columnsInUse = Math.ceil(bundle.length / rows);
        const slotsFilled = Math.min(bundle.length, columns * rows);
        const spacingWithinBundle = Math.max(0, slotsFilled - 1) * normalizedSpacing;

        totalBottomRowDiameter += bottomRowDiameters.reduce((sum, diameter) => sum + diameter, 0);
        totalSpacingWithinBundles += spacingWithinBundle;

        const isLastBundle = groupIndex === groupEntries.length - 1 && subBundleIndex === subBundles.length - 1;
        if (!isLastBundle) {
          totalBundleSpacing += bundleSpacingValue;
        }
      });
    });
  }

  const occupiedWidthMm =
    totalBottomRowDiameter +
    totalSpacingWithinBundles +
    (considerBundleSpacingAsFree ? 0 : totalBundleSpacing);

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
};

const resolveCableSpacing = (layout: PublicCableLayout | null | undefined): number => {
  const spacing = layout?.cableSpacing;
  if (typeof spacing === 'number' && Number.isFinite(spacing) && spacing >= 0) {
    return spacing;
  }
  return DEFAULT_CABLE_SPACING;
};

export const computeTrayFreeSpacePercent = ({
  tray,
  cables,
  layout
}: {
  tray: PublicTray;
  cables: TrayCableForFreeSpace[];
  layout: PublicCableLayout | null | undefined;
}): number | null => {
  const nonGroundingCables = filterCablesByTray(cables, tray.name).filter(
    (cable) => !isGroundingPurpose(cable.purpose)
  );

  const metrics = calculateTrayFreeSpaceMetrics({
    tray,
    cables: nonGroundingCables,
    layout,
    spacingBetweenCablesMm: resolveCableSpacing(layout),
    considerBundleSpacingAsFree: Boolean(layout?.considerBundleSpacingAsFree)
  });

  if (!metrics.calculationAvailable || metrics.freeWidthPercent === null) {
    return null;
  }

  return metrics.freeWidthPercent;
};

export const computeTrayFreeSpaceByTrayId = ({
  trays,
  cables,
  layout
}: {
  trays: PublicTray[];
  cables: TrayCableForFreeSpace[];
  layout: PublicCableLayout | null | undefined;
}): Record<string, number | null> => {
  return trays.reduce<Record<string, number | null>>((acc, tray) => {
    acc[tray.id] = computeTrayFreeSpacePercent({ tray, cables, layout });
    return acc;
  }, {});
};
