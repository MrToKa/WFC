import { z } from 'zod';
import { policyHashSchema } from './pathfinderPurposePolicy.js';
import { computeTrayDrawing } from './trayDrawing/index.js';
import { makeTrayDrawingInput, trayDrawingDiagnostics, type TrayDrawingPlacementData } from './trayDrawingInputs.js';
import { DEFAULT_DRAWING_MODES, type DrawingCategoryModes } from './pathfinderDrawingPolicy.js';
import type { TrayBundleOverride } from './trayDrawingSnapshot.js';

export const TRAY_CAPACITY_TOLERANCE_PERCENTAGE_POINTS = 3 as const;
export const TRAY_CAPACITY_DIAGNOSTICS_VERSION = 'wfc.pf.tray-capacity-diagnostics.v1' as const;
export const trayCapacityStatusSchema = z.enum(['fits', 'below-minimum', 'unavailable']);
const code = z.string().min(1).max(2048);
const percent = z.number().finite().min(0).max(100);
export const trayCapacityDiagnosticsSchema = z.object({
  schemaVersion: z.literal(TRAY_CAPACITY_DIAGNOSTICS_VERSION),
  minimumFreeSpacePercent: percent.nullable(), effectiveMinimumFreeSpacePercent: percent.nullable(),
  tolerancePercentagePoints: z.literal(TRAY_CAPACITY_TOLERANCE_PERCENTAGE_POINTS),
  occupancySha256: policyHashSchema, groupCableCount: z.number().int().min(1).max(100000),
  restrictionEnabled: z.boolean().optional(),
  blockedRouteCodes: z.array(code).max(4096), unavailableRouteCodes: z.array(code).max(4096),
  trays: z.array(z.object({ routeCode: code, freeSpacePercent: percent.nullable(), status: trayCapacityStatusSchema,
    occupancyPercent: z.number().finite().nonnegative().nullable().optional(),
    diagnosticCodes: z.array(z.string().min(1).max(100)).max(4).optional() }).strict()).max(4096),
  policyIssue: z.enum(['CAPACITY_MINIMUM_REQUIRED', 'CAPACITY_INPUT_LIMIT', 'CAPACITY_GROUP_UNAVAILABLE']).optional(),
}).strict();
export type TrayCapacityDiagnostics = z.infer<typeof trayCapacityDiagnosticsSchema>;
export type TrayCapacityAssessment = { status: z.infer<typeof trayCapacityStatusSchema>; freeSpacePercent: number | null;
  occupancyPercent: number | null; diagnosticCodes: string[] };

export const effectiveTrayCapacityMinimum = (minimum: number | null | undefined): number | null =>
  typeof minimum === 'number' && Number.isFinite(minimum) && minimum >= 0 && minimum <= 100
    ? Math.max(0, minimum - TRAY_CAPACITY_TOLERANCE_PERCENTAGE_POINTS) : null;

/** Uses the authoritative placement/diagnostic path; it never invents cable diameters or free space. */
export function assessTrayCapacity(input: {
  data: TrayDrawingPlacementData; override?: TrayBundleOverride | null; categoryModes?: DrawingCategoryModes;
  minimumFreeSpacePercent: number | null; restrictionEnabled?: boolean; unavailableDiagnostic?: string;
}): TrayCapacityAssessment {
  const minimum = effectiveTrayCapacityMinimum(input.minimumFreeSpacePercent);
  const restrictionEnabled = input.restrictionEnabled !== false;
  const unavailable = (diagnosticCodes: string[]): TrayCapacityAssessment => ({ status: 'unavailable', freeSpacePercent: null, occupancyPercent: null, diagnosticCodes });
  if (restrictionEnabled && minimum === null) return unavailable(['CAPACITY_MINIMUM_REQUIRED']);
  if (input.unavailableDiagnostic) return unavailable([input.unavailableDiagnostic]);
  // Type A/MV has no report capacity interpretation; keep its existing exclusion explicit.
  if (input.data.tray.purpose?.trim().toLowerCase() === 'type a (pink color) for mv cables') return unavailable(['CAPACITY_MV_TRAY_EXCLUDED']);
  try {
    const layout = computeTrayDrawing(makeTrayDrawingInput(input.data, input.override ?? null, input.categoryModes ?? { ...DEFAULT_DRAWING_MODES }));
    const { diagnostics, blocked } = trayDrawingDiagnostics(input.data, layout);
    const allDiagnosticCodes = [...new Set(diagnostics.map(value => value.code))];
    const diagnosticCodes = allDiagnosticCodes.slice(0, 4);
    const unknownInputs = allDiagnosticCodes.some(value => ['UNKNOWN_DRAWING_CATEGORY', 'MISSING_CABLE_DIAMETER', 'CABLE_DIAMETER_DEFAULTED'].includes(value));
    if (unknownInputs || !layout.summary) return unavailable(diagnosticCodes.length ? diagnosticCodes : ['CAPACITY_DRAWING_UNAVAILABLE']);
    const width = input.data.tray.widthMm;
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return unavailable(['TRAY_DIMENSIONS_REQUIRED']);
    const occupied = input.data.project.cableLayout.considerBundleSpacingAsFree
      ? layout.summary.occupiedWidthWithoutBundleSpacingMm : layout.summary.occupiedWidthWithBundleSpacingMm;
    const occupancyPercent = occupied / width * 100;
    if (!Number.isFinite(occupancyPercent)) return unavailable(['CAPACITY_DRAWING_INVALID']);
    const freeSpacePercent = Math.max(0, Math.min(100, (width - occupied) / width * 100));
    const provenOverflow = allDiagnosticCodes.some(value => /OVERFLOW/.test(value));
    if (restrictionEnabled && (provenOverflow || freeSpacePercent + 1e-9 < minimum!)) return { status: 'below-minimum', freeSpacePercent, occupancyPercent, diagnosticCodes };
    if (blocked && !provenOverflow) return unavailable(diagnosticCodes.length ? diagnosticCodes : ['CAPACITY_DRAWING_UNAVAILABLE']);
    return { status: 'fits', freeSpacePercent, occupancyPercent, diagnosticCodes };
  } catch {
    return unavailable(['CAPACITY_DRAWING_INVALID']);
  }
}
