import { useMemo } from 'react';
import { tokens } from '@fluentui/react-components';
import { MaterialLoadCurve } from '../../../api/client';
import { evaluateLoadCurve } from '../loadAssessment';

export const useLoadCurveEvaluation = (
  selectedLoadCurveId: string | null,
  selectedLoadCurve: MaterialLoadCurve | null,
  chartSpanMeters: number | null,
  safetyAdjustedLoadKnPerM: number | null,
  safetyFactorMultiplier: number | null,
  safetyFactorStatusMessage: string | null,
) =>
  useMemo(() => {
    const evaluation = evaluateLoadCurve(
      selectedLoadCurveId,
      selectedLoadCurve?.points ?? null,
      chartSpanMeters,
      safetyAdjustedLoadKnPerM,
      safetyFactorMultiplier,
      safetyFactorStatusMessage,
    );
    if (evaluation.marker) {
      evaluation.marker.color =
        evaluation.status === 'ok'
          ? tokens.colorPaletteGreenForeground1
          : evaluation.status === 'too-short'
            ? tokens.colorPaletteMarigoldForeground2
            : tokens.colorPaletteRedForeground1;
    }
    return evaluation;
  }, [
    selectedLoadCurveId,
    selectedLoadCurve,
    chartSpanMeters,
    safetyAdjustedLoadKnPerM,
    safetyFactorMultiplier,
    safetyFactorStatusMessage,
  ]);
