import { useMemo } from 'react';
import { tokens } from '@fluentui/react-components';
import { MaterialLoadCurve } from '../../../api/client';
import { ChartEvaluation, LoadCurveChartStatus } from '../TrayDetails.types';
import { FLOAT_TOLERANCE } from '../TrayDetails.utils';

export const useLoadCurveEvaluation = (
  selectedLoadCurveId: string | null,
  selectedLoadCurve: MaterialLoadCurve | null,
  chartSpanMeters: number | null,
  safetyAdjustedLoadKnPerM: number | null,
  safetyFactorMultiplier: number | null,
  safetyFactorStatusMessage: string | null
) => {
  const chartLoadCurvePoints = selectedLoadCurve?.points ?? [];

  const chartEvaluation = useMemo<ChartEvaluation>(() => {
    if (!selectedLoadCurveId) {
      return {
        status: 'no-curve' as LoadCurveChartStatus,
        message: 'The selected tray type is not linked to a load curve.',
        marker: null,
        limitHighlight: null,
        minSpan: null,
        maxSpan: null,
        allowableLoadAtSpan: null
      };
    }

    if (!selectedLoadCurve) {
      return {
        status: 'loading' as LoadCurveChartStatus,
        message: 'Loading load curve...',
        marker: null,
        limitHighlight: null,
        minSpan: null,
        maxSpan: null,
        allowableLoadAtSpan: null
      };
    }

    if (chartLoadCurvePoints.length === 0) {
      return {
        status: 'no-points' as LoadCurveChartStatus,
        message: 'The assigned load curve has no data points.',
        marker: null,
        limitHighlight: null,
        minSpan: null,
        maxSpan: null,
        allowableLoadAtSpan: null
      };
    }

    const sortedPoints = [...chartLoadCurvePoints].sort((a, b) => a.spanM - b.spanM);
    const minSpan = sortedPoints[0].spanM;
    const maxSpan = sortedPoints[sortedPoints.length - 1].spanM;
    const maxLoad = sortedPoints.reduce(
      (currentMax, point) => Math.max(currentMax, point.loadKnPerM),
      Number.NEGATIVE_INFINITY
    );

    const computeLoadAtSpan = (span: number): number | null => {
      if (span <= sortedPoints[0].spanM + FLOAT_TOLERANCE) {
        return sortedPoints[0].loadKnPerM;
      }

      for (let index = 1; index < sortedPoints.length; index += 1) {
        const previous = sortedPoints[index - 1];
        const current = sortedPoints[index];

        if (span <= current.spanM + FLOAT_TOLERANCE) {
          const spanDelta = current.spanM - previous.spanM;
          if (Math.abs(spanDelta) <= FLOAT_TOLERANCE) {
            return current.loadKnPerM;
          }
          const ratio = (span - previous.spanM) / spanDelta;
          return previous.loadKnPerM + ratio * (current.loadKnPerM - previous.loadKnPerM);
        }
      }

      return sortedPoints[sortedPoints.length - 1].loadKnPerM;
    };

    const computeMaxSpanForLoad = (
      targetLoad: number
    ): { span: number; load: number } | null => {
      if (targetLoad > maxLoad + FLOAT_TOLERANCE) {
        return { span: minSpan, load: sortedPoints[0].loadKnPerM };
      }

      for (let index = 1; index < sortedPoints.length; index += 1) {
        const previous = sortedPoints[index - 1];
        const current = sortedPoints[index];
        const prevLoad = previous.loadKnPerM;
        const currLoad = current.loadKnPerM;

        const crosses =
          (prevLoad >= targetLoad && currLoad <= targetLoad) ||
          (prevLoad <= targetLoad && currLoad >= targetLoad);

        if (!crosses) {
          continue;
        }

        const loadDelta = currLoad - prevLoad;
        if (Math.abs(loadDelta) <= FLOAT_TOLERANCE) {
          return { span: current.spanM, load: currLoad };
        }

        const ratio = (targetLoad - prevLoad) / loadDelta;
        const span = previous.spanM + ratio * (current.spanM - previous.spanM);
        return { span, load: targetLoad };
      }

      return { span: maxSpan, load: sortedPoints[sortedPoints.length - 1].loadKnPerM };
    };

    if (safetyFactorMultiplier === null) {
      return {
        status: 'awaiting-data' as LoadCurveChartStatus,
        message:
          safetyFactorStatusMessage ??
          'Set a safety factor in Project details to evaluate the load curve.',
        marker: null,
        limitHighlight: null,
        minSpan,
        maxSpan,
        allowableLoadAtSpan: null
      };
    }

    if (chartSpanMeters === null || safetyAdjustedLoadKnPerM === null) {
      return {
        status: 'awaiting-data' as LoadCurveChartStatus,
        message: 'Provide tray weight and support spacing data to plot the point.',
        marker: null,
        limitHighlight: null,
        minSpan,
        maxSpan,
        allowableLoadAtSpan: null
      };
    }

    const maxSpanForLoad = computeMaxSpanForLoad(safetyAdjustedLoadKnPerM);
    const allowableLoadAtSpan = computeLoadAtSpan(chartSpanMeters);

    let status: LoadCurveChartStatus = 'ok';
    let message = 'Support spacing is within the load curve limits.';
    let highlight: { span: number; load: number; type: 'min' | 'max'; label: string } | null =
      maxSpanForLoad
        ? {
            span: maxSpanForLoad.span,
            load: maxSpanForLoad.load,
            type: 'max',
            label: 'Max allowable span'
          }
        : null;

    if (safetyAdjustedLoadKnPerM > maxLoad + FLOAT_TOLERANCE) {
      status = 'load-too-high';
      message = 'Calculated load exceeds the maximum load defined by the curve.';
      highlight = {
        span: minSpan,
        load: sortedPoints[0].loadKnPerM,
        type: 'max',
        label: 'Max allowable span'
      };
    } else if (chartSpanMeters < minSpan - FLOAT_TOLERANCE) {
      status = 'too-short';
      message = 'Support spacing is below the minimum span covered by the curve.';
      highlight = {
        span: minSpan,
        load: sortedPoints[0].loadKnPerM,
        type: 'min',
        label: 'Min allowable span'
      };
    } else if (maxSpanForLoad && chartSpanMeters > maxSpanForLoad.span + FLOAT_TOLERANCE) {
      status = 'too-long';
      message = 'Support spacing exceeds the allowable span for the calculated load.';
      highlight = {
        span: maxSpanForLoad.span,
        load: maxSpanForLoad.load,
        type: 'max',
        label: 'Max allowable span'
      };
    }

    const markerColor =
      status === 'ok'
        ? tokens.colorPaletteGreenForeground1
        : status === 'too-short'
        ? tokens.colorPaletteMarigoldForeground2
        : tokens.colorPaletteRedForeground1;

    const marker =
      chartSpanMeters !== null && safetyAdjustedLoadKnPerM !== null
        ? {
            span: chartSpanMeters,
            load: safetyAdjustedLoadKnPerM,
            color: markerColor,
            label: 'Calculated point'
          }
        : null;

    return {
      status,
      message,
      marker,
      limitHighlight: highlight,
      minSpan,
      maxSpan,
      allowableLoadAtSpan
    };
  }, [
    selectedLoadCurveId,
    selectedLoadCurve,
    chartLoadCurvePoints,
    chartSpanMeters,
    safetyAdjustedLoadKnPerM,
    safetyFactorMultiplier,
    safetyFactorStatusMessage
  ]);

  return chartEvaluation;
};
