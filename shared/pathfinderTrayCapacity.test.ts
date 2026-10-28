import { describe, expect, it } from 'vitest';
import { assessTrayCapacity, effectiveTrayCapacityMinimum, trayCapacityDiagnosticsSchema } from './pathfinderTrayCapacity.js';
import { computeTrayDrawing } from './trayDrawing/index.js';
import { makeTrayDrawingInput, trayDrawingDiagnostics, type TrayDrawingPlacementData } from './trayDrawingInputs.js';
import { DEFAULT_DRAWING_MODES } from './pathfinderDrawingPolicy.js';

const id = (n: number) => `99999999-9999-4999-8999-${String(n).padStart(12, '0')}`;
const dates = { createdAt: '2026-10-24', updatedAt: '2026-10-24' };
const category = { maxRows: 1, maxColumns: 100, bundleSpacing: '0' as const, trefoil: false, trefoilSpacingBetweenBundles: false, applyPhaseRotation: false };
function data(diameters = [73]): TrayDrawingPlacementData {
  return { project: { cableLayout: { cableSpacing: 0, considerBundleSpacingAsFree: false, minFreeSpacePercent: 30, maxFreeSpacePercent: 80,
    mv: null, power: { ...category }, vfd: null, control: { ...category }, customBundleRanges: null } },
  tray: { id: id(1), projectId: id(2), name: '/T1', type: null, purpose: 'Shared', widthMm: 100, heightMm: 300,
    lengthMm: 1000, includeGroundingCable: false, groundingCableTypeId: null, ...dates },
  trayCables: diameters.map((diameter, index) => ({ id: id(index + 10), projectId: id(2), cableId: index + 1, cableTypeId: id(3),
    typeName: 'Synthetic', purpose: 'Power', diameterMm: diameter, weightKgPerM: 1, fromLocation: 'A', toLocation: 'B', routing: '/T1', ...dates })),
  materialTrays: [] };
}

describe('project free-space routing evaluator', () => {
  it('uses the configured minimum minus three percentage points; equality is accepted', () => {
    expect(effectiveTrayCapacityMinimum(30)).toBe(27);
    expect(effectiveTrayCapacityMinimum(45)).toBe(42);
    expect(effectiveTrayCapacityMinimum(2)).toBe(0);
    expect(assessTrayCapacity({ data: data([73]), minimumFreeSpacePercent: 30 })).toMatchObject({ status: 'fits', freeSpacePercent: 27 });
    expect(assessTrayCapacity({ data: data([74]), minimumFreeSpacePercent: 30 })).toMatchObject({ status: 'below-minimum', freeSpacePercent: 26 });
    expect(assessTrayCapacity({ data: data([60]), minimumFreeSpacePercent: 45 })).toMatchObject({ status: 'below-minimum', freeSpacePercent: 40 });
  });
  it('shares the actual drawing placement and per-tray override interpretation', () => {
    const input = data([20, 20, 20, 20]);
    const override = { useCustom: true, categories: { power: { ...category, maxRows: 2 } } };
    const layout = computeTrayDrawing(makeTrayDrawingInput(input, override, { ...DEFAULT_DRAWING_MODES }));
    expect(trayDrawingDiagnostics(input, layout).blocked).toBe(false);
    const expected = (100 - layout.summary!.occupiedWidthWithBundleSpacingMm) / 100 * 100;
    expect(assessTrayCapacity({ data: input, override, minimumFreeSpacePercent: 30 }).freeSpacePercent).toBe(expected);
    expect(assessTrayCapacity({ data: input, minimumFreeSpacePercent: 30 }).freeSpacePercent).not.toBe(expected);
  });
  it('honors the project choice for treating gaps between bundles as free', () => {
    const input = data([10, 20]); input.project.cableLayout.power = { ...category, bundleSpacing: '2D' };
    const layout = computeTrayDrawing(makeTrayDrawingInput(input, null, { ...DEFAULT_DRAWING_MODES }));
    const ordinary = assessTrayCapacity({ data: input, minimumFreeSpacePercent: 30 });
    input.project.cableLayout.considerBundleSpacingAsFree = true;
    const freeGaps = assessTrayCapacity({ data: input, minimumFreeSpacePercent: 30 });
    expect(ordinary.freeSpacePercent).toBe(Math.max(0, (100 - layout.summary!.occupiedWidthWithBundleSpacingMm) / 100 * 100));
    expect(freeGaps.freeSpacePercent).toBe(Math.max(0, (100 - layout.summary!.occupiedWidthWithoutBundleSpacingMm) / 100 * 100));
    expect(freeGaps.freeSpacePercent!).toBeGreaterThan(ordinary.freeSpacePercent!);
  });
  it('keeps missing dimensions, diameters and unknown purposes unavailable', () => {
    const width = data(); width.tray.widthMm = null;
    expect(assessTrayCapacity({ data: width, minimumFreeSpacePercent: 30 }).status).toBe('unavailable');
    const diameter = data(); diameter.trayCables[0].diameterMm = null;
    expect(assessTrayCapacity({ data: diameter, minimumFreeSpacePercent: 30 }).diagnosticCodes).toContain('MISSING_CABLE_DIAMETER');
    const purpose = data(); purpose.trayCables[0].purpose = 'Unrecognized';
    expect(assessTrayCapacity({ data: purpose, minimumFreeSpacePercent: 30 }).diagnosticCodes).toContain('UNKNOWN_DRAWING_CATEGORY');
    expect(assessTrayCapacity({ data: data(), minimumFreeSpacePercent: null })).toMatchObject({ status: 'unavailable', diagnosticCodes: ['CAPACITY_MINIMUM_REQUIRED'] });
  });
  it('never substitutes success for proven overflow and retains MV reporting exclusion', () => {
    expect(assessTrayCapacity({ data: data([130]), minimumFreeSpacePercent: 30 }).status).toBe('below-minimum');
    const mv = data(); mv.tray.purpose = 'Type A (Pink color) for MV cables';
    expect(assessTrayCapacity({ data: mv, minimumFreeSpacePercent: 30 })).toMatchObject({ status: 'unavailable', diagnosticCodes: ['CAPACITY_MV_TRAY_EXCLUDED'] });
  });
  it('measures true overfill even with the minimum checkbox off or no minimum configured', () => {
    const first = assessTrayCapacity({ data: data([130]), minimumFreeSpacePercent: null, restrictionEnabled: false });
    const second = assessTrayCapacity({ data: data([300]), minimumFreeSpacePercent: null, restrictionEnabled: false });
    expect(first).toMatchObject({ status: 'fits', freeSpacePercent: 0, occupancyPercent: 130 });
    expect(second).toMatchObject({ status: 'fits', freeSpacePercent: 0, occupancyPercent: 300 });
  });
  it('bounds the shared result metadata', () => {
    const body = { schemaVersion: 'wfc.pf.tray-capacity-diagnostics.v1', minimumFreeSpacePercent: 30, effectiveMinimumFreeSpacePercent: 27,
      tolerancePercentagePoints: 3, occupancySha256: 'a'.repeat(64), groupCableCount: 2, blockedRouteCodes: [], unavailableRouteCodes: [], trays: [] };
    expect(trayCapacityDiagnosticsSchema.safeParse(body).success).toBe(true);
    expect(trayCapacityDiagnosticsSchema.safeParse({ ...body, tolerancePercentagePoints: 4 }).success).toBe(false);
    expect(trayCapacityDiagnosticsSchema.safeParse({ ...body, blockedRouteCodes: Array(4097).fill('/T1') }).success).toBe(false);
  });
});
