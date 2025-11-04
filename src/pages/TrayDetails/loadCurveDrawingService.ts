import type { MaterialLoadCurvePoint } from '@/api/client';

export type LoadCurveMarker = {
  span: number;
  load: number;
  color?: string;
  clamp?: boolean;
  label?: string;
};

export type LoadCurveLimitHighlight = {
  span: number;
  load: number;
  type: 'min' | 'max';
  color?: string;
  label?: string;
};

export type LoadCurveVerticalLine = {
  span: number;
  toLoad: number;
  color?: string;
  label?: string;
};

export type LoadCurveHorizontalLine = {
  load: number;
  toSpan: number;
  color?: string;
  label?: string;
};

const CHART_MARGIN_LEFT = 100;
const CHART_MARGIN_RIGHT = 120;
const CHART_MARGIN_TOP = 100;
const CHART_MARGIN_BOTTOM = 80;
const GRID_STEP = 0.5;
const TITLE_FONT = 'bold 18px "Segoe UI", Arial, sans-serif';
const AXIS_LABEL_FONT = '14px "Segoe UI", Arial, sans-serif';
const TICK_LABEL_FONT = '12px "Segoe UI", Arial, sans-serif';
const LEGEND_FONT = '11px "Segoe UI", Arial, sans-serif';

const formatTick = (value: number): string => {
  if (Math.abs(value) >= 100) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
};

const buildTicks = (min: number, max: number, step: number): number[] => {
  if (step <= 0) {
    return [min];
  }

  const ticks: number[] = [];
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;

  for (let current = start; current <= end + 1e-8; current += step) {
    const rounded = Number(current.toFixed(10));
    ticks.push(rounded);
  }

  return ticks;
};

export class LoadCurveDrawingService {
  private resolveColor(input: string | undefined, fallback: string): string {
    const candidate = input?.trim();
    if (!candidate || candidate.length === 0) {
      return fallback;
    }

    if (candidate.startsWith('var(')) {
      const match = candidate.match(/var\((--[^,\)]+)(?:,\s*([^\)]+))?\)/i);
      const [, variableName, defaultValue] = match ?? [];

      if (variableName && typeof window !== 'undefined' && typeof document !== 'undefined') {
        const computed = getComputedStyle(document.documentElement)
          .getPropertyValue(variableName)
          ?.trim();
        if (computed) {
          return computed;
        }
      }

      if (defaultValue && defaultValue.trim().length > 0) {
        return defaultValue.trim();
      }

      return fallback;
    }

    return candidate;
  }

  drawLoadCurve(
    canvas: HTMLCanvasElement | null,
    points: MaterialLoadCurvePoint[],
    title?: string,
    marker?: LoadCurveMarker | null,
    limitHighlight?: LoadCurveLimitHighlight | null,
    verticalLines?: LoadCurveVerticalLine[] | null,
    horizontalLines?: LoadCurveHorizontalLine[] | null,
    summaryText?: string | null,
    summaryColor?: string
  ): void {
    if (!canvas) {
      throw new Error('Canvas cannot be null');
    }

    if (points.length === 0) {
      this.drawEmptyState(canvas);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to acquire 2D canvas context');
    }

    // Process data
    const sorted = [...points].sort((a, b) => a.spanM - b.spanM);
    const minSpan = Math.min(...sorted.map((point) => point.spanM));
    const maxSpan = Math.max(...sorted.map((point) => point.spanM));
    const maxLoad = Math.max(...sorted.map((point) => point.loadKnPerM));

    const domainSpanMin = Math.max(0, Math.floor(minSpan / GRID_STEP) * GRID_STEP);
    const domainSpanMax = Math.max(GRID_STEP, Math.ceil(maxSpan / GRID_STEP) * GRID_STEP);
    const domainLoadMin = 0;
    const domainLoadMax = Math.max(GRID_STEP, Math.ceil(maxLoad / GRID_STEP) * GRID_STEP);

    const spanTicks = buildTicks(domainSpanMin, domainSpanMax, GRID_STEP);
    const loadTicks = buildTicks(domainLoadMin, domainLoadMax, GRID_STEP);

    // Set canvas size
  const chartWidth = 1000;
    const chartHeight = 500;
    const canvasWidth = chartWidth + CHART_MARGIN_LEFT + CHART_MARGIN_RIGHT;
    const canvasHeight = chartHeight + CHART_MARGIN_TOP + CHART_MARGIN_BOTTOM;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Define plot area
    const plotLeft = CHART_MARGIN_LEFT;
    const plotRight = canvasWidth - CHART_MARGIN_RIGHT;
    const plotTop = CHART_MARGIN_TOP;
    const plotBottom = canvasHeight - CHART_MARGIN_BOTTOM;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;

    // Scale functions
    const xScale = (value: number): number => {
      if (domainSpanMax === domainSpanMin) {
        return plotLeft;
      }
      return plotLeft + ((value - domainSpanMin) / (domainSpanMax - domainSpanMin)) * plotWidth;
    };

    const yScale = (value: number): number => {
      if (domainLoadMax === domainLoadMin) {
        return plotBottom;
      }
      return plotBottom - ((value - domainLoadMin) / (domainLoadMax - domainLoadMin)) * plotHeight;
    };

    // Draw title if provided
    if (title) {
      ctx.save();
      ctx.font = TITLE_FONT;
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title, canvasWidth / 2, 40);
      ctx.restore();
    }

    // Draw grid lines
    ctx.save();
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    spanTicks.forEach((tick, index) => {
      if (index === 0 || index === spanTicks.length - 1) {
        return;
      }
      const x = xScale(tick);
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
    });

    loadTicks.forEach((tick, index) => {
      if (index === 0 || index === loadTicks.length - 1) {
        return;
      }
      const y = yScale(tick);
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
    });

    ctx.restore();

    // Draw axes
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    // Y-axis
    ctx.beginPath();
    ctx.moveTo(plotLeft, plotTop);
    ctx.lineTo(plotLeft, plotBottom);
    ctx.stroke();

    // X-axis
    ctx.beginPath();
    ctx.moveTo(plotLeft, plotBottom);
    ctx.lineTo(plotRight, plotBottom);
    ctx.stroke();

    ctx.restore();

    // Draw axis labels
    ctx.save();
    ctx.font = AXIS_LABEL_FONT;
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // X-axis label
    ctx.fillText('Support spacing L (m)', (plotLeft + plotRight) / 2, canvasHeight - 30);

    // Y-axis label (rotated)
    ctx.translate(30, (plotTop + plotBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Load q (kN/m)', 0, 0);

    ctx.restore();

    // Draw tick labels
    ctx.save();
    ctx.font = TICK_LABEL_FONT;
    ctx.fillStyle = '#333333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    spanTicks.forEach((tick) => {
      const x = xScale(tick);
      ctx.fillText(formatTick(tick), x, plotBottom + 8);
    });

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    loadTicks.forEach((tick) => {
      const y = yScale(tick);
      ctx.fillText(formatTick(tick), plotLeft - 8, y);
    });

    ctx.restore();

    // Draw horizontal lines (load limit at span) - draw before curve
    if (horizontalLines && horizontalLines.length > 0) {
      horizontalLines.forEach((line) => {
        if (!Number.isFinite(line.load) || !Number.isFinite(line.toSpan)) {
          return;
        }

        const load = Math.min(Math.max(line.load, domainLoadMin), domainLoadMax);
        const span = Math.min(Math.max(line.toSpan, domainSpanMin), domainSpanMax);
        const y = yScale(load);
        const x = xScale(span);
  const color = this.resolveColor(line.color, '#d13438');

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 4]);
        
        // Horizontal line from left edge to calculated point
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(x, y);
        ctx.stroke();

        // Circle at intersection
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Label
        if (line.label) {
          ctx.font = '12px "Segoe UI", Arial, sans-serif';
          ctx.fillStyle = color;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(line.label, x + 10, y - 8);
        }

        ctx.restore();
      });
    }

    // Draw load curve
    ctx.save();
    ctx.strokeStyle = '#0078d4';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    sorted.forEach((point, index) => {
      const x = xScale(point.spanM);
      const y = yScale(point.loadKnPerM);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    ctx.restore();

    // Draw limit highlight (max allowable span)
    if (limitHighlight && Number.isFinite(limitHighlight.span) && Number.isFinite(limitHighlight.load)) {
      const span = Math.min(Math.max(limitHighlight.span, domainSpanMin), domainSpanMax);
      const load = Math.min(Math.max(limitHighlight.load, domainLoadMin), domainLoadMax);
      const x = xScale(span);
      const y = yScale(load);
      const color = this.resolveColor(
        limitHighlight.color,
        limitHighlight.type === 'max' ? '#d13438' : '#107c10'
      );

      ctx.save();

      // Draw vertical dashed line from point to bottom axis
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();

      // Draw circle at the point
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      if (limitHighlight.label) {
        ctx.font = '12px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(limitHighlight.label, x + 10, y - 8);
      }

      ctx.restore();
    }

    // Draw vertical lines (not currently used in this context, but kept for completeness)
    if (verticalLines && verticalLines.length > 0) {
      verticalLines.forEach((line, index) => {
        if (!Number.isFinite(line.span) || !Number.isFinite(line.toLoad)) {
          return;
        }

        const span = Math.min(Math.max(line.span, domainSpanMin), domainSpanMax);
        const load = Math.min(Math.max(line.toLoad, domainLoadMin), domainLoadMax);
        const x = xScale(span);
        const y = yScale(load);
  const color = this.resolveColor(line.color, '#f7630c');

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 4]);
        
        ctx.beginPath();
        ctx.moveTo(x, plotBottom);
        ctx.lineTo(x, y);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (line.label) {
          ctx.font = '12px "Segoe UI", Arial, sans-serif';
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          const offsetDirection = index % 2 === 0 ? -1 : 1;
          ctx.textBaseline = offsetDirection < 0 ? 'bottom' : 'top';
          ctx.fillText(line.label, x, y + offsetDirection * 12);
        }

        ctx.restore();
      });
    }

    // Draw marker (calculated point)
    if (marker && Number.isFinite(marker.span) && Number.isFinite(marker.load)) {
      const shouldClamp = marker.clamp !== false;
      const rawSpan = marker.span;
      const rawLoad = marker.load;
      const clampedSpan = shouldClamp
        ? Math.min(Math.max(rawSpan, domainSpanMin), domainSpanMax)
        : rawSpan;
      const clampedLoad = shouldClamp
        ? Math.min(Math.max(rawLoad, domainLoadMin), domainLoadMax)
        : rawLoad;

      const x = xScale(clampedSpan);
      const y = yScale(clampedLoad);
  const color = this.resolveColor(marker.color, '#107c10');

      ctx.save();

      // Dashed lines with the marker color
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 4]);

      // Vertical line from bottom to point
      ctx.beginPath();
      ctx.moveTo(x, plotBottom);
      ctx.lineTo(x, y);
      ctx.stroke();

      // Horizontal line from left to point
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(x, y);
      ctx.stroke();

      // Circle marker
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label - position it to the bottom left of the marker
      if (marker.label) {
  ctx.font = '12px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(marker.label, x + 8, y + 8);
      }

      // Warning if clamped
      const spanClamped = shouldClamp && (rawSpan < domainSpanMin || rawSpan > domainSpanMax);
      const loadClamped = shouldClamp && (rawLoad < domainLoadMin || rawLoad > domainLoadMax);

      if (spanClamped || loadClamped) {
        ctx.font = '10px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Value outside curve domain', x, y - 18);
      }

      ctx.restore();
    }

    // Draw summary text
    if (summaryText && !summaryText.toLowerCase().includes('max allowable span')) {
      ctx.save();
      ctx.font = LEGEND_FONT;
      ctx.fillStyle = this.resolveColor(summaryColor, '#333333');
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(summaryText, plotRight, plotTop + 4);
      ctx.restore();
    }
  }

  private drawEmptyState(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const width = canvas.width || 800;
    const height = canvas.height || 500;
    canvas.width = width;
    canvas.height = height;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#605e5c';
    ctx.font = '16px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No curve data available.', width / 2, height / 2);
  }
}
