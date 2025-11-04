import type { CableBundleSpacing } from '@/api/types';

export type CableCategoryKey = 'mv' | 'power' | 'vfd' | 'control';

export const CABLE_CATEGORY_ORDER: CableCategoryKey[] = [
  'mv',
  'power',
  'vfd',
  'control'
];

export const CABLE_CATEGORY_CONFIG: Record<
  CableCategoryKey,
  {
    label: string;
    showTrefoil: boolean;
    allowTrefoilSpacing: boolean;
    allowPhaseRotation: boolean;
  }
> = {
  mv: {
    label: 'MV cables',
    showTrefoil: true,
    allowTrefoilSpacing: true,
    allowPhaseRotation: true
  },
  power: {
    label: 'Power cables',
    showTrefoil: true,
    allowTrefoilSpacing: true,
    allowPhaseRotation: false
  },
  vfd: {
    label: 'VFD cables',
    showTrefoil: true,
    allowTrefoilSpacing: true,
    allowPhaseRotation: false
  },
  control: {
    label: 'Control cables',
    showTrefoil: false,
    allowTrefoilSpacing: false,
    allowPhaseRotation: false
  }
};

export const DEFAULT_CABLE_SPACING = 1;

export const DEFAULT_CATEGORY_SETTINGS: Record<
  CableCategoryKey,
  {
    maxRows: number;
    maxColumns: number;
    bundleSpacing: CableBundleSpacing;
    trefoil: boolean;
    trefoilSpacingBetweenBundles: boolean;
    applyPhaseRotation: boolean;
  }
> = {
  mv: {
    maxRows: 2,
    maxColumns: 2,
    bundleSpacing: '2D',
    trefoil: true,
    trefoilSpacingBetweenBundles: false,
    applyPhaseRotation: true
  },
  power: {
    maxRows: 3,
    maxColumns: 20,
    bundleSpacing: '2D',
    trefoil: true,
    trefoilSpacingBetweenBundles: false,
    applyPhaseRotation: false
  },
  vfd: {
    maxRows: 3,
    maxColumns: 20,
    bundleSpacing: '2D',
    trefoil: true,
    trefoilSpacingBetweenBundles: false,
    applyPhaseRotation: false
  },
  control: {
    maxRows: 7,
    maxColumns: 20,
    bundleSpacing: '2D',
    trefoil: true,
    trefoilSpacingBetweenBundles: false,
    applyPhaseRotation: false
  }
};
