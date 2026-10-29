import type { CategoryLayoutConfig, CableBundleMap, TrayDrawingLayout } from './trayDrawing/index.js';
import { determineCableDiameterGroupWithCustomRanges } from './trayDrawing/index.js';
import type { TrayDrawingResponse, TrayBundleOverride, TrayDrawingSnapshot } from './trayDrawingSnapshot.js';
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

/** Only these facts are consumed by placement; ordinary full drawing readers remain compatible. */
export type TrayDrawingPlacementData = Pick<TrayDrawingResponse['data'], 'tray' | 'trayCables' | 'materialTrays'>
  & { project: Pick<TrayDrawingResponse['data']['project'], 'cableLayout'> };

/** The same diagnostic gate is shared by drawings, reports and routing capacity. */
export function trayDrawingDiagnostics(data: Pick<TrayDrawingPlacementData, 'tray' | 'trayCables'>, layout: TrayDrawingLayout) {
  const diagnostics: TrayDrawingSnapshot['diagnostics'] = [...layout.diagnostics];
  if (!data.tray.purpose?.trim()) diagnostics.push({ code: 'MISSING_TRAY_PURPOSE', cableIds: [], message: 'This tray uses the default layout because its purpose is missing.' });
  const unknown = data.trayCables.filter(v => !drawingCategory(v.purpose)).map(v => v.id);
  if (unknown.length) diagnostics.push({ code: 'UNKNOWN_DRAWING_CATEGORY', cableIds: unknown, message: 'Resolve the drawing purpose of these cables; they were not reclassified.' });
  const invalidDiameter = data.trayCables.filter(v => v.diameterMm == null || v.diameterMm <= 0).map(v => v.id);
  if (invalidDiameter.length) diagnostics.push({ code: 'MISSING_CABLE_DIAMETER', cableIds: invalidDiameter, message: 'Provide positive cable diameters before exporting this drawing.' });
  const fatalCodes = new Set(['DIVIDER_GAP_UNAVAILABLE', 'DRAWING_OVERFLOW', 'DRAWING_OVERLAP', 'TRAY_OVERFLOW', 'SIDE_OVERLAP', 'DRAWING_CANVAS_LIMIT', 'DRAWING_COMMAND_LIMIT']);
  const blocked = !layout.summary || unknown.length > 0 || invalidDiameter.length > 0 || diagnostics.some(d => fatalCodes.has(d.code) || /OVERLAP|OVERFLOW|INVALID|LIMIT/.test(d.code));
  return { diagnostics, blocked };
}

/** Same full-input category/range/settings interpretation for server snapshots and local drafts. */
export function makeTrayDrawingInput(data: TrayDrawingPlacementData, override: TrayBundleOverride | null, modes: DrawingCategoryModes) {
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
