import { describe, expect, it, vi } from 'vitest';
import type { Cable, Tray } from '@/api/client';
import { TrayDrawingService, type CategoryLayoutConfig } from './trayDrawingService';
import { TREFOIL_CLAMPS } from './trefoilClamps';

const cable = (id: number, diameterMm = 35, purpose = 'power', fromLocation = 'A') =>
  ({ id: `cable-${id}`, cableId: id, diameterMm, purpose, fromLocation, toLocation: 'B' }) as Cable;

const config = (
  purpose: keyof CategoryLayoutConfig,
  phaseRotation = false,
): CategoryLayoutConfig => {
  const normal = {
    maxRows: 2,
    maxColumns: 20,
    bundleSpacing: '0' as const,
    cableSpacing: 15,
    trefoil: false,
    trefoilSpacingBetweenBundles: false,
    applyPhaseRotation: false,
  };
  return {
    power: { ...normal },
    control: { ...normal },
    mv: { ...normal },
    vfd: { ...normal },
    [purpose]: { ...normal, trefoil: true, applyPhaseRotation: phaseRotation },
  };
};

const draw = (
  cables: Cable[],
  purpose: keyof CategoryLayoutConfig = 'power',
  clamps = true,
  phaseRotation = false,
  heightMm = 150,
  extraBundles: Record<string, Record<string, Cable[]>> = {},
) => {
  const arcs: Array<{ x: number; y: number; radius: number }> = [];
  const pathPoints: Array<{ x: number; y: number }> = [];
  const recordPoints = (...coordinates: number[]) => {
    for (let index = 0; index < coordinates.length; index += 2) {
      pathPoints.push({ x: coordinates[index], y: coordinates[index + 1] });
    }
  };
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    moveTo: vi.fn(recordPoints),
    lineTo: vi.fn(recordPoints),
    quadraticCurveTo: vi.fn(recordPoints),
    bezierCurveTo: vi.fn(recordPoints),
    translate: vi.fn(),
    rotate: vi.fn(),
    arc: (x: number, y: number, radius: number) => arcs.push({ x, y, radius }),
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  Object.assign(ctx, { canvas });
  const tray = { widthMm: 600, heightMm, name: 'T1' } as Tray;
  const allCables = [
    ...cables,
    ...Object.values(extraBundles).flatMap((bundles) => Object.values(bundles).flat()),
  ];
  const summary = new TrayDrawingService().drawTrayLayout(
    canvas as unknown as HTMLCanvasElement,
    tray,
    allCables,
    { [purpose]: { '30.1-40': cables }, ...extraBundles },
    1,
    15,
    config(purpose, phaseRotation),
    { useTrefoilClamps: clamps },
  )!;
  return { summary, ctx, canvas, cableArcs: arcs, pathPoints };
};

describe('trefoil clamps in the tray concept', () => {
  it.each(TREFOIL_CLAMPS)('renders $model and reserves its catalog width and height', (clamp) => {
    const diameter = (clamp.minDiameterMm + clamp.maxDiameterMm) / 2;
    const { summary, ctx, canvas, cableArcs, pathPoints } = draw(
      [cable(1, diameter), cable(2, diameter), cable(3, diameter)],
      'power',
      true,
      false,
      50,
    );
    expect(summary.trefoilClamps).toHaveLength(1);
    expect(summary.trefoilClamps?.[0].clamp?.model).toBe(clamp.model);
    expect(summary.occupiedWidthWithBundleSpacingMm).toBeCloseTo(clamp.widthMm);
    expect(summary.totalCableWidthMm).toBeCloseTo(diameter * 2);
    expect(cableArcs).toHaveLength(3);
    expect(ctx.bezierCurveTo).toHaveBeenCalled();
    // Every contour, including the split neck and horizontal closure, fits the
    // catalog footprint. Even the largest model stays below the title.
    const xs = pathPoints.map((point) => point.x);
    const ys = pathPoints.map((point) => point.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(64);
    expect(Math.max(...xs)).toBeLessThanOrEqual(66 + clamp.widthMm);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(49);
    expect(Math.max(...ys)).toBeLessThanOrEqual(51 + clamp.heightMm);
    expect(Math.min(...ys)).toBeLessThanOrEqual(52);
    expect(canvas.height).toBeCloseTo(clamp.heightMm + 115);
    for (const arc of cableArcs) {
      expect(arc.x - arc.radius).toBeGreaterThanOrEqual(65);
      expect(arc.x + arc.radius).toBeLessThanOrEqual(65 + clamp.widthMm);
      expect(arc.y - arc.radius).toBeGreaterThan(50);
      expect(arc.y + arc.radius).toBeLessThan(50 + clamp.heightMm);
    }
  });

  it('records each rendered trefoil and reserves the catalog clamp width', () => {
    const { summary, ctx, cableArcs } = draw([cable(1), cable(2), cable(3)]);
    expect(summary.trefoilClamps).toHaveLength(1);
    expect(summary.trefoilClamps?.[0].clamp?.model).toBe('VRT+04');
    expect(summary.totalCableWidthMm).toBe(70);
    expect(summary.occupiedWidthWithBundleSpacingMm).toBe(86);
    expect(ctx.bezierCurveTo).toHaveBeenCalled();
    expect(cableArcs).toHaveLength(3);
    expect(
      Math.hypot(cableArcs[0].x - cableArcs[1].x, cableArcs[0].y - cableArcs[1].y),
    ).toBeCloseTo(35);
    expect(
      Math.hypot(cableArcs[0].x - cableArcs[2].x, cableArcs[0].y - cableArcs[2].y),
    ).toBeCloseTo(35);
    expect(
      Math.hypot(cableArcs[1].x - cableArcs[2].x, cableArcs[1].y - cableArcs[2].y),
    ).toBeCloseTo(35);
  });

  it('keeps the original cable spacing when clamps are disabled', () => {
    const { summary, ctx, cableArcs } = draw([cable(1), cable(2), cable(3)], 'power', false);
    expect(summary.trefoilClamps).toHaveLength(1);
    expect(summary.occupiedWidthWithBundleSpacingMm).toBe(85);
    expect(cableArcs[1].x - cableArcs[0].x).toBe(50);
    expect(ctx.quadraticCurveTo).not.toHaveBeenCalled();
    expect(ctx.bezierCurveTo).not.toHaveBeenCalled();
  });

  it.each(['power', 'mv', 'vfd'] as const)(
    'records the actual rotated groups for %s cables',
    (purpose) => {
      const { summary, cableArcs } = draw(
        Array.from({ length: 6 }, (_, i) => cable(i + 1, 35, purpose)),
        purpose,
        true,
        true,
      );
      expect(summary.trefoilClamps).toHaveLength(2);
      const ids = summary.trefoilClamps?.map((group) => group.cables.map((item) => item.cableId));
      expect(ids).toEqual([
        [2, 3, 1],
        [6, 5, 4],
      ]);
      expect(cableArcs).toHaveLength(6);
      expect(summary.occupiedWidthWithBundleSpacingMm).toBe(187);
    },
  );

  it('encloses right-side VFD groups when an MV tray is present', () => {
    const vfd = Array.from({ length: 6 }, (_, i) => cable(i + 1, 35, 'vfd'));
    const { summary } = draw(vfd, 'vfd', true, true, 150, { mv: { '0-8': [cable(10, 8, 'mv')] } });
    expect(summary.trefoilClamps?.map((group) => group.cables.map((item) => item.cableId))).toEqual(
      [
        [3, 2, 1],
        [5, 6, 4],
      ],
    );
  });

  it('reports unsupported diameters without drawing a fabricated clamp', () => {
    const { summary, ctx } = draw([cable(1, 105), cable(2, 105), cable(3, 105)]);
    expect(summary.trefoilClamps).toHaveLength(1);
    expect(summary.trefoilClamps?.[0].clamp).toBeNull();
    expect(ctx.quadraticCurveTo).not.toHaveBeenCalled();
    expect(ctx.bezierCurveTo).not.toHaveBeenCalled();
  });

  it('records incomplete MV phase sets as unsupported', () => {
    const { summary, cableArcs } = draw(
      [cable(1, 35, 'mv'), cable(2, 35, 'mv'), cable(3, 35, 'mv'), cable(4, 35, 'mv')],
      'mv',
      true,
      true,
    );
    expect(summary.trefoilClamps?.map((group) => group.cables.length)).toEqual([3, 1]);
    expect(summary.trefoilClamps?.[1].clamp).toBeNull();
    expect(cableArcs).toHaveLength(4);
  });

  it('does not clamp cables that are rendered as ordinary bundles', () => {
    const { summary } = draw([cable(1), cable(2), cable(3, 35, 'power', 'C')]);
    expect(summary.trefoilClamps).toEqual([]);
  });

  it('expands the canvas above a shallow tray so the clamp avoids the title', () => {
    const { pathPoints, canvas } = draw([cable(1), cable(2), cable(3)], 'power', true, false, 50);
    expect(canvas.height).toBe(234);
    expect(Math.min(...pathPoints.map((point) => point.y))).toBeGreaterThanOrEqual(49);
    expect(Math.min(...pathPoints.map((point) => point.y))).toBeLessThanOrEqual(52);
  });

  it('keeps the largest supported cables inside the clamp height with room for the foot', () => {
    const { summary, cableArcs, pathPoints } = draw(
      [cable(1, 101), cable(2, 101), cable(3, 101)],
      'power',
      true,
      false,
      50,
    );
    expect(summary.trefoilClamps?.[0].clamp?.model).toBe('VRT+20');
    const clampTop = 50;
    const clampBottom = clampTop + 230;
    const cableTop = Math.min(...cableArcs.map((arc) => arc.y - arc.radius));
    const cableBottom = Math.max(...cableArcs.map((arc) => arc.y + arc.radius));
    expect(cableTop).toBeGreaterThan(clampTop + 20);
    expect(cableBottom).toBeLessThan(clampBottom - 6);
    expect(Math.min(...pathPoints.map((point) => point.y))).toBeGreaterThanOrEqual(clampTop - 1);
    expect(Math.max(...pathPoints.map((point) => point.y))).toBeLessThanOrEqual(clampBottom + 1);
  });
});
