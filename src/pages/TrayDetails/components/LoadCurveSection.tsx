import React, { useRef, useEffect, useCallback } from 'react';
import { Caption1, Body1, Spinner } from '@fluentui/react-components';
import { MaterialLoadCurve, MaterialTray, MaterialLoadCurvePoint } from '../../../api/client';
import { ChartEvaluation } from '../TrayDetails.types';
import { LoadCurveDrawingService } from '../loadCurveDrawingService';

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
  refreshKey?: string;
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
  styles,
  refreshKey
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingServiceRef = useRef<LoadCurveDrawingService | null>(null);

  const drawLoadCurve = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || chartLoadCurvePoints.length === 0) {
      return false;
    }

    if (!drawingServiceRef.current) {
      drawingServiceRef.current = new LoadCurveDrawingService();
    }

    try {
      const title = selectedMaterialTray?.loadCurveName 
        ? `Load Curve: ${selectedMaterialTray.loadCurveName}`
        : undefined;

      drawingServiceRef.current.drawLoadCurve(
        canvas,
        chartLoadCurvePoints,
        title,
        chartEvaluation.marker,
        chartEvaluation.limitHighlight,
        chartVerticalLines,
        chartHorizontalLines,
        chartSummary.text,
        chartSummary.color
      );
      return true;
    } catch (error) {
      console.error('Failed to render load curve', error);
      return false;
    }
  }, [
    chartLoadCurvePoints,
    chartEvaluation.marker,
    chartEvaluation.limitHighlight,
    chartVerticalLines,
    chartHorizontalLines,
    chartSummary.text,
    chartSummary.color,
    selectedMaterialTray?.loadCurveName
  ]);

  useEffect(() => {
    if (chartLoadCurvePoints.length === 0) {
      return;
    }

    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 5;
    const timeouts: Array<ReturnType<typeof setTimeout>> = [];

    const scheduleAttempt = () => {
      if (cancelled || attempt >= maxAttempts) {
        return;
      }
      const delay = 100 * (attempt + 1);
      attempt += 1;
      const timeoutId = setTimeout(() => {
        if (!cancelled) {
          if (!drawLoadCurve()) {
            scheduleAttempt();
          }
        }
      }, delay);
      timeouts.push(timeoutId);
    };

    if (!drawLoadCurve()) {
      scheduleAttempt();
    }

    return () => {
      cancelled = true;
      for (const timeoutId of timeouts) {
        clearTimeout(timeoutId);
      }
    };
  }, [drawLoadCurve, chartLoadCurvePoints.length, refreshKey]);

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
            <canvas 
              ref={canvasRef} 
              className={styles.chartCanvas}
              style={{ 
                display: 'block', 
                width: '100%', 
                maxWidth: '100%',
                border: '1px solid #e0e0e0',
                backgroundColor: '#ffffff'
              }}
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
