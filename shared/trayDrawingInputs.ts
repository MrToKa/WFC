import type { CategoryLayoutConfig, CableBundleMap } from './trayDrawing/index.js';
import { determineCableDiameterGroupWithCustomRanges } from './trayDrawing/index.js';
import type { TrayDrawingResponse, TrayBundleOverride } from './trayDrawingSnapshot.js';
import type { DrawingCategoryModes } from './pathfinderDrawingPolicy.js';

export const DRAWING_DEFAULTS = {
  mv: { maxRows: 2, maxColumns: 2, bundleSpacing: '2D', trefoil: true, trefoilSpacingBetweenBundles: false, applyPhaseRotation: true },
  power: { maxRows: 3, maxColumns: 20, bundleSpacing: '2D', trefoil: true, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false },
  vfd: { maxRows: 3, maxColumns: 20, bundleSpacing: '2D', trefoil: true, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false },
  control: { maxRows: 7, maxColumns: 20, bundleSpacing: '2D', trefoil: true, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false },
} as const;
export function drawingCategory(purpose: string | null | undefined): keyof typeof DRAWING_DEFAULTS | null {
  const p = purpose?.trim().toLowerCase();
  if (!p) return null;
  if (p.includes('ground') || p.startsWith('mv') || p.includes('medium voltage')) return 'mv';
  if (p.includes('vfd')) return 'vfd';
  if (p.startsWith('power') || p.includes(' power')) return 'power';
  if (p.includes('control')) return 'control';
  return null;
}
export const drawingRoutingContainsTray = (routing: string | null, trayName: string): boolean => !!routing && !!trayName.trim() && routing.split('/').some(v => v.trim().toLowerCase() === trayName.trim().toLowerCase());

/** Same full-input category/range/settings interpretation for server snapshots and local drafts. */
export function makeTrayDrawingInput(data: TrayDrawingResponse['data'], override: TrayBundleOverride | null, modes: DrawingCategoryModes) {
  const base = data.project.cableLayout;
  const spacingMm = base.cableSpacing ?? 1;
  const customRanges = override?.useCustom ? override.customBundleRanges ?? {} : base.customBundleRanges ?? {};
  const layoutConfig = {} as CategoryLayoutConfig;
  const cableBundles: CableBundleMap = {};
  for (const category of ['mv', 'power', 'vfd', 'control'] as const) {
    const defaults = DRAWING_DEFAULTS[category];
    const merged = { ...(base[category] ?? {}), ...(override?.useCustom ? override.categories[category] ?? {} : {}) };
    layoutConfig[category] = {
      maxRows: merged.maxRows ?? defaults.maxRows, maxColumns: merged.maxColumns ?? defaults.maxColumns,
      bundleSpacing: merged.bundleSpacing ?? defaults.bundleSpacing, cableSpacing: spacingMm,
      trefoil: category === 'control' ? false : merged.trefoil ?? defaults.trefoil,
      trefoilSpacingBetweenBundles: category === 'control' ? false : merged.trefoilSpacingBetweenBundles ?? defaults.trefoilSpacingBetweenBundles,
      applyPhaseRotation: category === 'control' ? false : merged.applyPhaseRotation ?? defaults.applyPhaseRotation,
      bundleMaxRowsByKey: Object.fromEntries((customRanges[category] ?? []).filter(v => v.maxRows != null).map(v => [`${v.min}-${v.max}`, v.maxRows!])),
    };
  }
  for (const cable of data.trayCables) {
    const category = drawingCategory(cable.purpose);
    if (!category) continue; // Snapshot emits an explicit diagnostic; never reclassify as Control.
    const key = determineCableDiameterGroupWithCustomRanges(cable.diameterMm, customRanges[category]);
    ((cableBundles[category] ??= {})[key] ??= []).push(cable);
  }
  return { tray: data.tray, cablesOnTray: data.trayCables.filter(c => drawingCategory(c.purpose) !== null), cableBundles, canvasScale: 6, spacingMm, layoutConfig,
    options: { rungHeightMm: data.materialTrays[0]?.rungHeightMm ?? 15, useTrefoilClamps: data.tray.useTrefoilClamps ?? false, categoryModes: modes, customRanges } };
}
