import { z } from 'zod';
import { TrayDrawingService, type CableBundleMap, type CategoryLayoutConfig } from './service.js';
import { createRecordingCanvas, replayDrawingCommands, validateDrawingCommands, MAX_CANVAS_AREA, MAX_DRAW_COMPUTE_MS, type DrawingCommand } from './recording.js';
import { CATEGORY_ORDER, DEFAULT_CATEGORY_MODES, type CategoryKey, type DrawingCanvas, type CategoryModes, type DrawingDiagnostic } from './types.js';
import { DEFAULT_RANGE_BOUNDS, getBundleRangeLabel } from './ranges.js';

export * from './types.js';
export * from './ranges.js';
export * from './trefoilClamps.js';
export { TrayDrawingService, determineCableDiameterGroup, determineCableDiameterGroupWithCustomRanges, getCustomBundleKeys, DEFAULT_BUNDLE_TYPES } from './service.js';
export type { CableBundleMap, CategoryLayoutConfig, ProjectLayoutConfig, TrayLayoutSummary } from './service.js';
export type { DrawingCommand } from './recording.js';
export const TRAY_DRAWING_ALGORITHM = 'wfc-tray-placement-v2' as const;
export const TRAY_DRAWING_LIMITS = Object.freeze({ cables: 10000, commands: 500000, canvasDimensionPx: 50000, canvasAreaPx: MAX_CANVAS_AREA, computeMilliseconds: MAX_DRAW_COMPUTE_MS });
/** Retained drawing-purpose classifier, deliberately independent of PF MTO categories. */
export function classifyDrawingCategory(purpose: string | null | undefined): CategoryKey | null {
  const value = purpose?.trim().toLowerCase();
  if (!value) return null;
  if (value.includes('ground') || value.startsWith('mv') || value.includes('medium voltage')) return 'mv';
  if (value.includes('vfd')) return 'vfd';
  if (value.startsWith('power') || value.includes(' power')) return 'power';
  if (value.includes('control')) return 'control';
  return null;
}
const bounded = (max: number) => z.number().finite().min(0).max(max);
const cableSchema = z.object({ id: z.string().min(1).max(200), cableId: z.number().int().safe(), diameterMm: z.number().finite().min(0).max(10000).nullable().optional(), purpose: z.string().max(500).nullable().optional(), fromLocation: z.string().max(1000).nullable().optional(), toLocation: z.string().max(1000).nullable().optional() });
const traySchema = z.object({ id: z.string().max(200).optional(), name: z.string().max(1000), widthMm: bounded(100000).nullable().optional(), heightMm: bounded(100000).nullable().optional(), useTrefoilClamps: z.boolean().optional() });
const categoryModesSchema = z.object({ mv: z.enum(['use-default', 'left', 'right']), power: z.enum(['use-default', 'left', 'right']), vfd: z.enum(['use-default', 'left', 'right']), control: z.enum(['use-default', 'left', 'right']) }).strict();
const configSchema = z.object({ maxRows: z.number().int().min(1).max(1000), maxColumns: z.number().int().min(1).max(1000), bundleSpacing: z.enum(['0', '1D', '2D']), cableSpacing: bounded(10000), trefoil: z.boolean(), trefoilSpacingBetweenBundles: z.boolean(), applyPhaseRotation: z.boolean(), bundleMaxRowsByKey: z.record(z.string().max(100), z.number().int().min(1).max(1000)).optional() }).strict();
const layoutSchema = z.object({ mv: configSchema, power: configSchema, vfd: configSchema, control: configSchema }).strict();
const customRangeSchema = z.object({ id: z.string().min(1).max(100), min: bounded(10000), max: bounded(10000), maxRows: z.number().int().min(1).max(1000).nullable().optional() }).strict().refine(range => range.max > range.min);
const bundleSchema = z.record(z.string().max(100), z.array(cableSchema).max(10000));
const inputSchema = z.object({ tray: traySchema, cablesOnTray: z.array(cableSchema).max(10000), cableBundles: z.record(z.enum(['mv', 'power', 'vfd', 'control']), bundleSchema).optional(), canvasScale: z.number().finite().positive().max(20), spacingMm: bounded(10000).optional(), layoutConfig: layoutSchema.optional(), options: z.object({ rungHeightMm: bounded(10000).nullable().optional(), useTrefoilClamps: z.boolean().optional(), categoryModes: categoryModesSchema.optional(), customRanges: z.record(z.enum(['mv', 'power', 'vfd', 'control']), z.array(customRangeSchema).max(100)).optional() }).strict().optional() }).strict();
export type TrayDrawingInput = z.input<typeof inputSchema>;

export const defaultCategoryLayoutConfig = (spacingMm = 15): CategoryLayoutConfig => Object.fromEntries(CATEGORY_ORDER.map(category => [category, { maxRows: 2, maxColumns: 20, bundleSpacing: '2D', cableSpacing: spacingMm, trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false }])) as CategoryLayoutConfig;
const finite = z.number().finite();
const diagnosticSchema = z.object({ code: z.string().min(1).max(100), cableIds: z.array(z.string().min(1).max(200)).max(10000), message: z.string().max(1000) }).strict();
const clampSchema = z.object({ model: z.string().max(100), minDiameterMm: finite, maxDiameterMm: finite, widthMm: finite, heightMm: finite, depthMm: finite, weightGrams: finite }).strict();
const summarySchema = z.object({ spacingMm: finite.nonnegative(), totalCableWidthMm: finite.nonnegative(), occupiedWidthWithBundleSpacingMm: finite.nonnegative(), occupiedWidthWithoutBundleSpacingMm: finite.nonnegative(), bundleSpacingContributionMm: finite.nonnegative(), segmentCount: z.number().int().nonnegative(), hasBottomRow: z.boolean(), trefoilClamps: z.array(z.object({ cables: z.array(cableSchema).max(3), clamp: clampSchema.nullable() }).strict()).max(10000).optional(), centralFreeGapMm: finite.nonnegative().optional(), overflowMm: finite.nonnegative().optional(), leftOccupiedWidthMm: finite.nonnegative().optional(), rightOccupiedWidthMm: finite.nonnegative().optional() }).strict();
export const trayDrawingLayoutSchema = z.object({ schemaVersion: z.literal('wfc.tray-drawing-layout.v1'), algorithmVersion: z.literal(TRAY_DRAWING_ALGORITHM), widthPx: z.number().int().positive().max(50000), heightPx: z.number().int().positive().max(50000), commands: z.custom<DrawingCommand[]>((value) => { try { validateDrawingCommands(value); return true; } catch { return false; } }), summary: summarySchema.nullable(), diagnostics: z.array(diagnosticSchema).max(10000), placements: z.array(z.object({ cableId: z.string().min(1).max(200), displayNumber: z.number().int().nonnegative(), category: z.enum(['mv', 'power', 'vfd', 'control']), side: z.enum(['left', 'right']), xPx: finite, yPx: finite, radiusPx: finite.nonnegative() }).strict()).max(10000) }).strict().refine(value => value.widthPx * value.heightPx <= MAX_CANVAS_AREA, 'DRAWING_CANVAS_LIMIT');
export type TrayDrawingLayout = z.infer<typeof trayDrawingLayoutSchema>;
export const parseTrayDrawingLayout = (value: unknown): TrayDrawingLayout => trayDrawingLayoutSchema.parse(value);

/** One pure authority used by normal readers, report occupancy and rendering. */
export function computeTrayDrawing(raw: TrayDrawingInput): TrayDrawingLayout {
  const deadline = Date.now() + MAX_DRAW_COMPUTE_MS;
  const input = inputSchema.parse(raw), byId = new Map(input.cablesOnTray.map(cable => [cable.id, cable]));
  if (byId.size !== input.cablesOnTray.length) throw new Error('DRAWING_DUPLICATE_CABLE');
  const seen = new Set<string>(), bundles: CableBundleMap = {}, diagnostics: DrawingDiagnostic[] = [];
  for (const category of CATEGORY_ORDER) {
    const ranges = input.options?.customRanges?.[category] ?? [];
    const sorted = [...ranges].sort((a, b) => a.min - b.min);
    if (sorted.some((range, index) => index > 0 && range.min <= sorted[index - 1].max)) throw new Error('DRAWING_CUSTOM_RANGE_OVERLAP');
    for (const [key, cables] of Object.entries(input.cableBundles?.[category] ?? {})) {
      const custom = ranges.find(range => getBundleRangeLabel(range) === key), bounds = custom ? { min: custom.min, max: custom.max, minInclusive: true } : DEFAULT_RANGE_BOUNDS[key];
      if (!bounds) throw new Error('DRAWING_BUNDLE_RANGE_UNKNOWN');
      for (const cable of cables) {
        const source = byId.get(cable.id);
        if (!source || JSON.stringify(source) !== JSON.stringify(cable) || seen.has(cable.id)) throw new Error('DRAWING_MEMBERSHIP_MISMATCH');
        if (classifyDrawingCategory(cable.purpose) !== category) throw new Error('DRAWING_CATEGORY_MISMATCH');
        const diameter = cable.diameterMm && cable.diameterMm > 0 ? cable.diameterMm : 1;
        if ((bounds.minInclusive ? diameter < bounds.min : diameter <= bounds.min) || bounds.max !== null && diameter > bounds.max) throw new Error('DRAWING_BUNDLE_RANGE_MISMATCH');
        seen.add(cable.id);
      }
      (bundles[category] ??= {})[key] = cables;
    }
  }
  if (seen.size !== byId.size) throw new Error('DRAWING_MEMBERSHIP_MISMATCH');
  for (const cable of input.cablesOnTray) if (!cable.diameterMm) diagnostics.push({ code: 'CABLE_DIAMETER_DEFAULTED', cableIds: [cable.id], message: 'A missing or zero cable diameter uses the retained 1 mm drawing fallback.' });
  const canvas = createRecordingCanvas(deadline), service = new TrayDrawingService();
  const summary = service.drawTrayLayout(canvas.canvas, input.tray, input.cablesOnTray, bundles, input.canvasScale, input.spacingMm, input.layoutConfig,
    { ...input.options, categoryModes: input.options?.categoryModes ?? { ...DEFAULT_CATEGORY_MODES } as CategoryModes });
  if (!summary) diagnostics.push({ code: 'TRAY_DIMENSIONS_REQUIRED', cableIds: [], message: 'Provide tray width and height to render the concept.' });
  // A real Canvas applies integer dimensions. Match it in the headless authority.
  const widthPx = Math.floor(canvas.canvas.width), heightPx = Math.floor(canvas.canvas.height);
  return parseTrayDrawingLayout({ schemaVersion: 'wfc.tray-drawing-layout.v1', algorithmVersion: TRAY_DRAWING_ALGORITHM, widthPx, heightPx, commands: canvas.commands, summary,
    diagnostics: [...diagnostics, ...service.lastDiagnostics], placements: service.lastPlacements });
}

/** Accept only the exact validated version/allowlist, never arbitrary canvas properties or functions. */
export function replayTrayDrawing(canvas: DrawingCanvas, raw: unknown): void {
  const layout = parseTrayDrawingLayout(raw), context = canvas.getContext('2d');
  if (!context) throw new Error('DRAWING_CONTEXT_REQUIRED');
  canvas.width = layout.widthPx; canvas.height = layout.heightPx;
  replayDrawingCommands(context, layout.commands);
}
