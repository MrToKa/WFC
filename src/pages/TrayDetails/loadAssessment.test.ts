import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { calculateTraySpanLoad, evaluateLoadCurve, getLoadCapacityMetrics } from './loadAssessment';
import { useTrayCalculations } from './hooks/useTrayCalculations';
import type { Cable, Project, Tray } from '@/api/client';

const points = [
  { spanM: 1, loadKnPerM: 1 },
  { spanM: 2, loadKnPerM: 0.5 },
  { spanM: 3, loadKnPerM: 0.25 },
];
const evaluate = (span: number | null, load: number | null, data = points) =>
  evaluateLoadCurve('curve', data, span, load, 1.2, null);
const cable = (weight: number | null, purpose = 'LV') =>
  ({ cableId: 1, weightKgPerM: weight, purpose }) as Cable;
const project = { supportDistance: 2, supportWeight: 100, supportDistanceOverrides: {} } as Project;
const tray = { type: 'test', lengthMm: 10000 } as Tray;

describe('tray load calculation', () => {
  it('converts cable plus tray mass to kN/m', () => {
    expect(calculateTraySpanLoad(5, 15)).toBeCloseTo(0.196133, 8);
  });
  it.each([null, NaN, Infinity, -1])('cannot calculate with invalid weight %s', (weight) => {
    expect(calculateTraySpanLoad(weight, 15)).toBeNull();
  });
  it('excludes supports from the span load but includes them in total inventory', () => {
    const { result } = renderHook(() =>
      useTrayCalculations(project, tray, [cable(15)], {}, 5, null),
    );
    expect(result.current.supportCalculations.totalWeightKg).toBe(600);
    expect(result.current.totalWeightKg).toBe(800);
    expect(result.current.traySpanLoadKnPerM).toBeCloseTo(0.196133, 8);
  });
  it('can evaluate the tray even when support unit weight is missing', () => {
    const { result } = renderHook(() =>
      useTrayCalculations({ ...project, supportWeight: null }, tray, [cable(15)], {}, 5, null),
    );
    expect(result.current.totalWeightKg).toBeNull();
    expect(result.current.traySpanLoadKnPerM).toBeCloseTo(0.196133, 8);
  });
  it('refuses partial cable weight totals', () => {
    const { result } = renderHook(() =>
      useTrayCalculations(project, tray, [cable(15), cable(null)], {}, 5, null),
    );
    expect(result.current.cablesWeightLoadPerMeterKg).toBeNull();
    expect(result.current.traySpanLoadKnPerM).toBeNull();
  });
  it('requires the grounding cable weight when grounding is enabled', () => {
    const { result } = renderHook(() =>
      useTrayCalculations(project, tray, [cable(15)], {}, 5, null, true),
    );
    expect(result.current.traySpanLoadKnPerM).toBeNull();
  });
  it('keeps routed grounding cables in schedule order and counts their weight with the option disabled', () => {
    const grounding = { ...cable(2, 'Grounding'), cableId: 642 };
    const mv = { ...cable(15, 'MV'), cableId: 1 };
    const cables = [grounding, mv];
    const { result } = renderHook(() =>
      useTrayCalculations(project, tray, cables, {}, 5, null, false),
    );
    expect(result.current.sortedTrayCables).toEqual([mv, grounding]);
    expect(cables).toEqual([grounding, mv]);
    expect(result.current.cablesWeightLoadPerMeterKg).toBe(17);
    expect(result.current.traySpanLoadKnPerM).toBeCloseTo(calculateTraySpanLoad(5, 17)!);
  });
  it('refuses partial totals when a routed grounding cable has no weight', () => {
    const { result } = renderHook(() =>
      useTrayCalculations(project, tray, [cable(15, 'MV'), cable(null, 'Grounding')], {}, 5, null),
    );
    expect(result.current.cablesWeightLoadPerMeterKg).toBeNull();
    expect(result.current.traySpanLoadKnPerM).toBeNull();
  });
  it('adds the optional tray grounding conductor once alongside routed grounding cables', () => {
    const { result } = renderHook(() =>
      useTrayCalculations(project, tray, [cable(15), cable(2, 'Grounding')], {}, 5, 2, true),
    );
    expect(result.current.cablesWeightLoadPerMeterKg).toBe(19);
  });
  it('uses zero cable mass for an empty tray', () => {
    const { result } = renderHook(() => useTrayCalculations(project, tray, [], {}, 5, null));
    expect(result.current.cablesWeightLoadPerMeterKg).toBe(0);
    expect(result.current.traySpanLoadKnPerM).toBeCloseTo(0.04903325, 8);
  });
  it('includes clamps once in cable load, total weight and span assessment', () => {
    const { result } = renderHook(() =>
      useTrayCalculations(project, tray, [cable(15), cable(2, 'Grounding')], {}, 5, 2, true, 0.5112),
    );
    expect(result.current.cablesWeightLoadPerMeterKg).toBeCloseTo(19.5112);
    expect(result.current.cablesTotalWeightKg).toBeCloseTo(195.112);
    expect(result.current.totalWeightKg).toBeCloseTo(845.112);
    expect(result.current.traySpanLoadKnPerM).toBeCloseTo(calculateTraySpanLoad(5, 19.5112)!);
  });
  it('refuses a partial assessment when enabled clamp mass is unknown', () => {
    const { result } = renderHook(() =>
      useTrayCalculations(project, tray, [cable(15)], {}, 5, null, false, null),
    );
    expect(result.current.cablesWeightLoadPerMeterKg).toBeNull();
    expect(result.current.totalWeightKg).toBeNull();
    expect(result.current.traySpanLoadKnPerM).toBeNull();
  });
});

describe('manufacturer curve verification', () => {
  it('interpolates capacity and exposes the calculation inputs', () => {
    const result = evaluate(1.5, 0.6);
    expect(result.status).toBe('ok');
    expect(result.allowableLoadAtSpan).toBe(0.75);
    expect(result.maxAllowableSpan).toBeCloseTo(1.8);
    expect(result.interpolation).toEqual({ from: points[0], to: points[1] });
    expect(getLoadCapacityMetrics(result, 0.6).utilizationPercent).toBeCloseTo(80);
    expect(getLoadCapacityMetrics(result, 0.6).reserveKnPerM).toBeCloseTo(0.15);
  });
  it('uses a published point exactly at its span', () => {
    expect(evaluate(2, 0.5).allowableLoadAtSpan).toBe(0.5);
    expect(evaluate(2, 0.5).status).toBe('ok');
  });
  it('fails a load exceeding the local capacity and retains the signed deficit', () => {
    const result = evaluate(2, 0.6);
    expect(result.status).toBe('too-long');
    expect(getLoadCapacityMetrics(result, 0.6).utilizationPercent).toBe(120);
    expect(getLoadCapacityMetrics(result, 0.6).reserveKnPerM).toBeCloseTo(-0.1);
  });
  it.each([0.9, 3.1, Infinity])('does not extrapolate for span %s', (span) => {
    const result = evaluate(span, 0.1);
    expect(result.status).not.toBe('ok');
    expect(result.allowableLoadAtSpan).toBeNull();
    expect(getLoadCapacityMetrics(result, 0.1).utilizationPercent).toBeNull();
  });
  it('does not fabricate an allowable span above all curve loads', () => {
    const result = evaluate(2, 1.1);
    expect(result.status).toBe('load-too-high');
    expect(result.maxAllowableSpan).toBeNull();
    expect(result.limitHighlight).toBeNull();
  });
  it('does not pass a dip in a non-monotone curve based on a later safe span', () => {
    const result = evaluate(2, 0.6, [points[0], points[1], { spanM: 3, loadKnPerM: 1 }]);
    expect(result.maxAllowableSpan).toBe(3);
    expect(result.status).toBe('too-long');
  });
  it.each(
    [
      [
        { spanM: 1, loadKnPerM: 1 },
        { spanM: 1, loadKnPerM: 0.5 },
      ],
      [{ spanM: 1, loadKnPerM: NaN }],
      [{ spanM: 0, loadKnPerM: 1 }],
      [{ spanM: 1, loadKnPerM: -1 }],
    ].map((data) => [data]),
  )('rejects invalid curve points', (data) =>
    expect(evaluate(1, 0.1, data).status).toBe('invalid-curve'),
  );
  it('does not divide by zero capacity', () => {
    const result = evaluate(1, 0, [{ spanM: 1, loadKnPerM: 0 }]);
    expect(getLoadCapacityMetrics(result, 0).utilizationPercent).toBeNull();
  });
  it('requires a valid safety allowance and complete load data', () => {
    expect(evaluateLoadCurve('curve', points, 2, 0.1, null, null).status).toBe('awaiting-data');
    expect(evaluate(2, null).status).toBe('awaiting-data');
  });
});
