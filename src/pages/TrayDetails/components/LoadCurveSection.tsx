import React from 'react';
import { Caption1, Body1, Spinner } from '@fluentui/react-components';
import { MaterialLoadCurve, MaterialTray, MaterialLoadCurvePoint } from '../../../api/client';
import { ChartEvaluation } from '../TrayDetails.types';
import { LoadCurveChart } from '../../Materials/components/LoadCurveChart';

interface LoadCurveSectionProps {
  selectedMaterialTray: MaterialTray | null;
  safetyFactorPercent: number | null;
  safetyFactorStatusMessage: string | null;
  loadCurveError: string | null;
  selectedLoadCurveId: string | null;
  loadCurveLoadingId: string | null;
  selectedLoadCurve: MaterialLoadCurve | null;
  chartLoadCurvePoints: MaterialLoadCurvePoint[];
  chartEvaluation: ChartEvaluation;
  chartStatusColor: string;
  chartPointSpanDisplay: string;
  chartPointLoadDisplay: string;
  chartVerticalLines: Array<{ span: number; toLoad: number; color: string }> | null;
  chartHorizontalLines: Array<{ load: number; toSpan: number; color: string; label: string }> | null;
  chartSummary: { text: string | null; color: string | undefined };
  numberFormatter: Intl.NumberFormat;
  styles: Record<string, string>;
}

export const LoadCurveSection: React.FC<LoadCurveSectionProps> = ({
  selectedMaterialTray,
  safetyFactorPercent,
  safetyFactorStatusMessage,
  loadCurveError,
  selectedLoadCurveId,
  loadCurveLoadingId,
  selectedLoadCurve,
  chartLoadCurvePoints,
  chartEvaluation,
  chartStatusColor,
  chartPointSpanDisplay,
  chartPointLoadDisplay,
  chartVerticalLines,
  chartHorizontalLines,
  chartSummary,
  numberFormatter,
  styles
}) => {
  return (
    <div className={styles.section}>
      <Caption1>Tray load curve</Caption1>
      <div className={styles.grid}>
        <div className={styles.field}>
          <Caption1>Assigned load curve</Caption1>
          <Body1>{selectedMaterialTray?.loadCurveName ?? 'Not assigned'}</Body1>
        </div>
        <div className={styles.field}>
          <Caption1>Safety factor [%]</Caption1>
          <Body1>
            {safetyFactorPercent !== null
              ? numberFormatter.format(safetyFactorPercent)
              : 'Not set'}
          </Body1>
        </div>
      </div>
      {safetyFactorStatusMessage ? (
        <Body1 className={styles.errorText}>{safetyFactorStatusMessage}</Body1>
      ) : null}
      {loadCurveError ? (
        <Body1 className={styles.errorText}>{loadCurveError}</Body1>
      ) : null}
      {selectedLoadCurveId === null ? (
        <Body1 className={styles.emptyState}>
          Assign a load curve to this tray type to visualise support limits.
        </Body1>
      ) : loadCurveLoadingId === selectedLoadCurveId ? (
        <Spinner label="Loading load curve..." />
      ) : selectedLoadCurve === null ? (
        <Body1 className={styles.emptyState}>
          Unable to display load curve data. Try refreshing the page.
        </Body1>
      ) : chartLoadCurvePoints.length === 0 ? (
        <Body1 className={styles.emptyState}>
          The assigned load curve has no data points.
        </Body1>
      ) : (
        <>
          <div className={styles.chartWrapper}>
            <LoadCurveChart
              points={chartLoadCurvePoints}
              className={styles.chartCanvas}
              marker={chartEvaluation.marker}
              limitHighlight={chartEvaluation.limitHighlight}
              verticalLines={chartVerticalLines}
              horizontalLines={chartHorizontalLines}
              summaryText={chartSummary.text}
              summaryColor={chartSummary.color}
            />
          </div>
          <Body1 className={styles.chartStatus} style={{ color: chartStatusColor }}>
            {chartEvaluation.message}
          </Body1>
          <div className={styles.chartMeta}>
            <div className={styles.field}>
              <Caption1>Calculated point span [m]</Caption1>
              <Body1>{chartPointSpanDisplay}</Body1>
            </div>
            <div className={styles.field}>
              <Caption1>Calculated point load [kN/m]</Caption1>
              <Body1>{chartPointLoadDisplay}</Body1>
            </div>
            {chartEvaluation.limitHighlight ? (
              <div className={styles.field}>
                <Caption1>{chartEvaluation.limitHighlight.label} [m]</Caption1>
                <Body1>
                  {numberFormatter.format(chartEvaluation.limitHighlight.span)}
                </Body1>
              </div>
            ) : null}
            {chartEvaluation.allowableLoadAtSpan !== null ? (
              <div className={styles.field}>
                <Caption1>Allowable load at span [kN/m]</Caption1>
                <Body1>{numberFormatter.format(chartEvaluation.allowableLoadAtSpan)}</Body1>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};
