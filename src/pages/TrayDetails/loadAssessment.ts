import type { ChartEvaluation } from './TrayDetails.types';
import { FLOAT_TOLERANCE, KN_PER_KG } from './TrayDetails.utils';

export const isValidWeight = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Supports are a separate weight inventory, not a load carried by the tray span.
export const calculateTraySpanLoad = (
  trayWeight: number | null,
  cableWeight: number | null,
): number | null =>
  isValidWeight(trayWeight) && isValidWeight(cableWeight)
    ? (trayWeight + cableWeight) * KN_PER_KG
    : null;

type CurvePoint = { spanM: number; loadKnPerM: number };

export const evaluateLoadCurve = (
  curveId: string | null,
  points: CurvePoint[] | null,
  span: number | null,
  designLoad: number | null,
  multiplier: number | null,
  missingFactorMessage: string | null,
): ChartEvaluation => {
  const empty: ChartEvaluation = {
    status: 'awaiting-data',
    message: '',
    marker: null,
    limitHighlight: null,
    minSpan: null,
    maxSpan: null,
    allowableLoadAtSpan: null,
    maxAllowableSpan: null,
    interpolation: null,
  };
  if (!curveId)
    return {
      ...empty,
      status: 'no-curve',
      message: 'The selected tray type is not linked to a load curve.',
    };
  if (!points) return { ...empty, status: 'loading', message: 'Loading load curve...' };
  if (!points.length)
    return {
      ...empty,
      status: 'no-points',
      message: 'The assigned load curve has no data points.',
    };
  const sorted = [...points].sort((a, b) => a.spanM - b.spanM);
  if (
    sorted.some(
      (point, index) =>
        !Number.isFinite(point.spanM) ||
        point.spanM <= 0 ||
        !isValidWeight(point.loadKnPerM) ||
        (index > 0 && point.spanM - sorted[index - 1].spanM <= FLOAT_TOLERANCE),
    )
  ) {
    return {
      ...empty,
      status: 'invalid-curve',
      message: 'Load curve points must have distinct positive spans and finite non-negative loads.',
    };
  }
  const minSpan = sorted[0].spanM;
  const maxSpan = sorted[sorted.length - 1].spanM;
  const base = { ...empty, minSpan, maxSpan };
  if (multiplier === null || !Number.isFinite(multiplier) || multiplier < 1) {
    return {
      ...base,
      message:
        missingFactorMessage ??
        'Set a valid safety factor in Project details to evaluate the load curve.',
    };
  }
  if (span === null || !Number.isFinite(span) || span <= 0 || !isValidWeight(designLoad)) {
    return {
      ...base,
      message:
        'Provide complete cable weights, tray weight and positive support spacing to evaluate the load curve.',
    };
  }
  const marker = { span, load: designLoad, color: '', label: 'Calculated point' };
  // Never extrapolate capacity outside the manufacturer's documented range.
  if (span < minSpan - FLOAT_TOLERANCE || span > maxSpan + FLOAT_TOLERANCE) {
    const below = span < minSpan;
    return {
      ...base,
      marker,
      status: below ? 'too-short' : 'too-long',
      message:
        'Support spacing is outside the span range covered by the load curve. Capacity cannot be verified.',
      limitHighlight: {
        span: below ? minSpan : maxSpan,
        load: below ? sorted[0].loadKnPerM : sorted[sorted.length - 1].loadKnPerM,
        type: below ? 'min' : 'max',
        label: below ? 'Min documented span' : 'Max documented span',
      },
    };
  }
  const exact = sorted.find((point) => Math.abs(point.spanM - span) <= FLOAT_TOLERANCE);
  let allowableLoadAtSpan: number;
  let interpolation: ChartEvaluation['interpolation'] = null;
  if (exact) {
    allowableLoadAtSpan = exact.loadKnPerM;
    interpolation = { from: exact, to: exact };
  } else {
    const upperIndex = sorted.findIndex((point) => point.spanM > span);
    const from = sorted[upperIndex - 1];
    const to = sorted[upperIndex];
    allowableLoadAtSpan =
      from.loadKnPerM +
      ((span - from.spanM) / (to.spanM - from.spanM)) * (to.loadKnPerM - from.loadKnPerM);
    interpolation = { from, to };
  }
  let maxAllowableSpan: number | null = null;
  for (let index = 0; index < sorted.length; index += 1) {
    const point = sorted[index];
    if (point.loadKnPerM >= designLoad) maxAllowableSpan = point.spanM;
    const next = sorted[index + 1];
    if (next && (point.loadKnPerM - designLoad) * (next.loadKnPerM - designLoad) < 0) {
      maxAllowableSpan =
        point.spanM +
        ((designLoad - point.loadKnPerM) / (next.loadKnPerM - point.loadKnPerM)) *
          (next.spanM - point.spanM);
    }
  }
  const overloaded = designLoad > allowableLoadAtSpan + FLOAT_TOLERANCE;
  const aboveAll =
    designLoad > Math.max(...sorted.map((point) => point.loadKnPerM)) + FLOAT_TOLERANCE;
  return {
    ...base,
    marker,
    allowableLoadAtSpan,
    maxAllowableSpan,
    interpolation,
    status: overloaded ? (aboveAll ? 'load-too-high' : 'too-long') : 'ok',
    message: overloaded
      ? 'Design load exceeds the allowable load at the selected support spacing.'
      : 'Design load is within the allowable load at the selected support spacing.',
    limitHighlight:
      maxAllowableSpan === null
        ? null
        : {
            span: maxAllowableSpan,
            load: designLoad,
            type: 'max',
            label: 'Max allowable span within curve range',
          },
  };
};

export const getLoadCapacityMetrics = (evaluation: ChartEvaluation, designLoad: number | null) => {
  const capacity = evaluation.allowableLoadAtSpan;
  if (
    !isValidWeight(designLoad) ||
    capacity === null ||
    !Number.isFinite(capacity) ||
    capacity <= 0
  ) {
    return { utilizationPercent: null, reserveKnPerM: null, reservePercent: null };
  }
  const utilizationPercent = (designLoad / capacity) * 100;
  return {
    utilizationPercent,
    reserveKnPerM: capacity - designLoad,
    reservePercent: 100 - utilizationPercent,
  };
};
