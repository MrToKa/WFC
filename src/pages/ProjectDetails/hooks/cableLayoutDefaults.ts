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
  { label: string; showTrefoil: boolean }
> = {
  mv: { label: 'MV cables', showTrefoil: true },
  power: { label: 'Power cables', showTrefoil: true },
  vfd: { label: 'VFD cables', showTrefoil: true },
  control: { label: 'Control cables', showTrefoil: false }
};

export const DEFAULT_CABLE_SPACING = 1;

export const DEFAULT_CATEGORY_SETTINGS: Record<
  CableCategoryKey,
  {
    maxRows: number;
    maxColumns: number;
    bundleSpacing: CableBundleSpacing;
    trefoil: boolean;
  }
> = {
  mv: { maxRows: 2, maxColumns: 2, bundleSpacing: '2D', trefoil: true },
  power: { maxRows: 3, maxColumns: 20, bundleSpacing: '2D', trefoil: true },
  vfd: { maxRows: 3, maxColumns: 20, bundleSpacing: '2D', trefoil: true },
  control: { maxRows: 7, maxColumns: 20, bundleSpacing: '2D', trefoil: true }
};

