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
  { label: string; showTrefoil: boolean; allowTrefoilSpacing: boolean }
> = {
  mv: { label: 'MV cables', showTrefoil: true, allowTrefoilSpacing: false },
  power: { label: 'Power cables', showTrefoil: true, allowTrefoilSpacing: true },
  vfd: { label: 'VFD cables', showTrefoil: true, allowTrefoilSpacing: true },
  control: { label: 'Control cables', showTrefoil: false, allowTrefoilSpacing: false }
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
  }
> = {
  mv: { maxRows: 2, maxColumns: 2, bundleSpacing: '2D', trefoil: true, trefoilSpacingBetweenBundles: false },
  power: { maxRows: 3, maxColumns: 20, bundleSpacing: '2D', trefoil: true, trefoilSpacingBetweenBundles: false },
  vfd: { maxRows: 3, maxColumns: 20, bundleSpacing: '2D', trefoil: true, trefoilSpacingBetweenBundles: false },
  control: { maxRows: 7, maxColumns: 20, bundleSpacing: '2D', trefoil: true, trefoilSpacingBetweenBundles: false }
};
