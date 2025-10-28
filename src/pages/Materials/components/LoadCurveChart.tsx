import { memo, useMemo } from 'react';
import { Body2, tokens } from '@fluentui/react-components';
import type { MaterialLoadCurvePoint } from '@/api/client';

type LoadCurveMarker = {
  span: number;
  load: number;
  color?: string;
  clamp?: boolean;
  label?: string;
};

type LoadCurveLimitHighlight = {
  span: number;
  load: number;
  type: 'min' | 'max';
  color?: string;
  label?: string;
};

type LoadCurveVerticalLine = {
  span: number;
  toLoad: number;
  color?: string;
  label?: string;
};

type LoadCurveHorizontalLine = {
  load: number;
  toSpan: number;
  color?: string;
  label?: string;
};

type LoadCurveChartProps = {
  points: MaterialLoadCurvePoint[];
  className?: string;
  marker?: LoadCurveMarker | null;
  limitHighlight?: LoadCurveLimitHighlight | null;
  verticalLines?: LoadCurveVerticalLine[] | null;
  horizontalLines?: LoadCurveHorizontalLine[] | null;
  summaryText?: string | null;
  summaryColor?: string;
};

const CHART_WIDTH = 500;
const CHART_HEIGHT = 310;
const MARGIN = 75;
const GRID_STEP = 0.5;

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

export const LoadCurveChart = memo(
  ({
    points,
    className,
    marker,
    limitHighlight,
    verticalLines,
    horizontalLines,
    summaryText,
    summaryColor
  }: LoadCurveChartProps) => {
  const processed = useMemo(() => {
    if (points.length === 0) {
      return null;
    }

    const sorted = [...points].sort((a, b) => a.spanM - b.spanM);
    const minSpan = Math.min(...sorted.map((point) => point.spanM));
    const maxSpan = Math.max(...sorted.map((point) => point.spanM));
    const maxLoad = Math.max(...sorted.map((point) => point.loadKnPerM));

    const domainSpanMin = Math.max(0, Math.floor(minSpan / GRID_STEP) * GRID_STEP);
    const domainSpanMax = Math.max(GRID_STEP, Math.ceil(maxSpan / GRID_STEP) * GRID_STEP);
    const domainLoadMin = 0;
    const domainLoadMax = Math.max(
      GRID_STEP,
      Math.ceil(maxLoad / GRID_STEP) * GRID_STEP
    );

    const spanTicks = buildTicks(domainSpanMin, domainSpanMax, GRID_STEP);
    const loadTicks = buildTicks(domainLoadMin, domainLoadMax, GRID_STEP);

    const width = CHART_WIDTH - MARGIN * 2;
    const height = CHART_HEIGHT - MARGIN * 2;

    const xScale = (value: number): number => {
      if (domainSpanMax === domainSpanMin) {
        return MARGIN;
      }
      return (
        MARGIN +
        ((value - domainSpanMin) / (domainSpanMax - domainSpanMin)) * width
      );
    };

    const yScale = (value: number): number => {
      if (domainLoadMax === domainLoadMin) {
        return CHART_HEIGHT - MARGIN;
      }
      return (
        CHART_HEIGHT -
        MARGIN -
        ((value - domainLoadMin) / (domainLoadMax - domainLoadMin)) * height
      );
    };

    const pointsAttribute = sorted
      .map((point) => `${xScale(point.spanM)},${yScale(point.loadKnPerM)}`)
      .join(' ');

    return {
      spanTicks,
      loadTicks,
      xScale,
      yScale,
      pointsAttribute,
      domainSpanMin,
      domainSpanMax,
      domainLoadMin,
      domainLoadMax
    };
  }, [points]);

  if (!processed) {
    return <Body2>No curve data available.</Body2>;
  }

  const {
    spanTicks,
    loadTicks,
    xScale,
    yScale,
    pointsAttribute,
    domainSpanMin,
    domainSpanMax,
    domainLoadMin,
    domainLoadMax
  } = processed;
  
  const summaryDisplay = summaryText ?? (limitHighlight?.label);
  const summaryFill = summaryColor ?? tokens.colorNeutralForeground2;

  const markerData = (() => {
    if (!marker) {
      return null;
    }

    if (!Number.isFinite(marker.span) || !Number.isFinite(marker.load)) {
      return null;
    }

    const shouldClamp = marker.clamp !== false;
    const rawSpan = marker.span;
    const rawLoad = marker.load;
    const clampedSpan = shouldClamp
      ? Math.min(Math.max(rawSpan, domainSpanMin), domainSpanMax)
      : rawSpan;
    const clampedLoad = shouldClamp
      ? Math.min(Math.max(rawLoad, domainLoadMin), domainLoadMax)
      : rawLoad;

    return {
      rawSpan,
      rawLoad,
      clampedSpan,
      clampedLoad,
      spanClamped: shouldClamp && (rawSpan < domainSpanMin || rawSpan > domainSpanMax),
      loadClamped: shouldClamp && (rawLoad < domainLoadMin || rawLoad > domainLoadMax),
      color: marker.color ?? tokens.colorPaletteDarkOrangeForeground1,
      label: marker.label
    };
  })();

  const limitHighlightData = (() => {
    if (!limitHighlight) {
      return null;
    }

    if (!Number.isFinite(limitHighlight.span) || !Number.isFinite(limitHighlight.load)) {
      return null;
    }

    const span = Math.min(Math.max(limitHighlight.span, domainSpanMin), domainSpanMax);
    const load = Math.min(Math.max(limitHighlight.load, domainLoadMin), domainLoadMax);
    const color =
      limitHighlight.color ??
      (limitHighlight.type === 'max'
        ? tokens.colorPaletteRedForeground1
        : tokens.colorPaletteGreenForeground2);

    return {
      span,
      load,
      color,
      label:
        limitHighlight.label ??
        (limitHighlight.type === 'max'
          ? 'Maximum allowable point'
          : 'Minimum allowable point')
    };
  })();

  const verticalLinesData = useMemo(() => {
    if (!verticalLines || verticalLines.length === 0) {
      return [];
    }

    return verticalLines
      .map((line, index) => {
        if (!Number.isFinite(line.span) || !Number.isFinite(line.toLoad)) {
          return null;
        }

        const span = Math.min(Math.max(line.span, domainSpanMin), domainSpanMax);
        const load = Math.min(Math.max(line.toLoad, domainLoadMin), domainLoadMax);
        return {
          key: `vertical-${index}`,
          span,
          load,
          color: line.color ?? tokens.colorPaletteDarkOrangeForeground1,
          label: line.label
        };
      })
      .filter(Boolean) as {
      key: string;
      span: number;
      load: number;
      color: string;
      label?: string;
    }[];
  }, [verticalLines, domainSpanMin, domainSpanMax, domainLoadMin, domainLoadMax]);

  const horizontalLinesData = useMemo(() => {
    if (!horizontalLines || horizontalLines.length === 0) {
      return [];
    }

    return horizontalLines
      .map((line, index) => {
        if (!Number.isFinite(line.load) || !Number.isFinite(line.toSpan)) {
          return null;
        }

        const load = Math.min(Math.max(line.load, domainLoadMin), domainLoadMax);
        const span = Math.min(Math.max(line.toSpan, domainSpanMin), domainSpanMax);
        return {
          key: `horizontal-${index}`,
          load,
          span,
          color: line.color ?? tokens.colorPalettePurpleForeground2,
          label: line.label
        };
      })
      .filter(Boolean) as {
      key: string;
      load: number;
      span: number;
      color: string;
      label?: string;
    }[];
  }, [horizontalLines, domainLoadMin, domainLoadMax, domainSpanMin, domainSpanMax]);

  return (
    <svg
      className={className}
      width="auto"
      height="auto"
      viewBox={`0 0 ${CHART_WIDTH + MARGIN} ${CHART_HEIGHT}`}
      role='img'
      aria-label='Load curve chart'
    >
      {/* Grid lines */}
      {spanTicks.map((tick, index) => {
        if (index === 0 || index === spanTicks.length - 1) {
          return null;
        }
        const x = xScale(tick);
        return (
          <line
            key={`v-${tick}`}
            x1={x}
            x2={x}
            y1={MARGIN}
            y2={CHART_HEIGHT - MARGIN}
            stroke={tokens.colorNeutralStroke3}
            strokeWidth={1}
            strokeDasharray='4 4'
          />
        );
      })}

      {loadTicks.map((tick, index) => {
        if (index === 0 || index === loadTicks.length - 1) {
          return null;
        }
        const y = yScale(tick);
        return (
          <line
            key={`h-${tick}`}
            x1={MARGIN}
            x2={CHART_WIDTH - MARGIN}
            y1={y}
            y2={y}
            stroke={tokens.colorNeutralStroke3}
            strokeWidth={1}
            strokeDasharray='4 4'
          />
        );
      })}

      {/* Axes */}
      <line
        x1={MARGIN}
        x2={MARGIN}
        y1={MARGIN}
        y2={CHART_HEIGHT - MARGIN}
        stroke={tokens.colorNeutralStroke1}
        strokeWidth={1.5}
      />
      <line
        x1={MARGIN}
        x2={CHART_WIDTH - MARGIN}
        y1={CHART_HEIGHT - MARGIN}
        y2={CHART_HEIGHT - MARGIN}
        stroke={tokens.colorNeutralStroke1}
        strokeWidth={1.5}
      />

      {/* Axis labels */}
      <text
        x={CHART_WIDTH / 2}
        y={CHART_HEIGHT - 40}
        textAnchor='middle'
        fontSize='12'
        fill={tokens.colorNeutralForeground2}
      >
        Support spacing L (m)
      </text>
      <text
          x={MARGIN - 60}
          y={CHART_HEIGHT / 2}
          textAnchor='middle'
          fontSize='12'
          fill={tokens.colorNeutralForeground2}
          transform={`rotate(-90 ${MARGIN - 60} ${CHART_HEIGHT / 2})`}
        >
          Load q (kN/m)
        </text>

      {/* Tick labels */}
      {spanTicks.map((tick, idx) => {
        const x = xScale(tick);
        return (
          <text
            key={`xtick-${tick}`}
            x={x}
            y={CHART_HEIGHT - MARGIN + 16}
            textAnchor='middle'
            fontSize='11'
            fill={tokens.colorNeutralForeground2}
          >
            {formatTick(tick)}
          </text>
        );
      })}        {loadTicks.map((tick, idx) => {
          const y = yScale(tick);
          // Swap the text of the 35th <text> (idx === 34) with the <text> inside the 37th <g>
          let textContent = formatTick(tick);
          if (idx === 34 && verticalLinesData.length >= 37) {
            // Swap with the label of the 37th vertical line
            textContent = verticalLinesData[36].label || textContent;
          }
          return (
            <text
              key={`ytick-${tick}`}
              x={MARGIN - 32}
              y={y + 4}
              textAnchor='end'
              fontSize='11'
              fill={tokens.colorNeutralForeground2}
            >
              {textContent}
            </text>
          );
        })}

      {/* Curve */}
      <polyline
        points={pointsAttribute}
        fill='none'
        stroke={tokens.colorPaletteBlueForeground2}
        strokeWidth={2}
        strokeLinejoin='round'
        strokeLinecap='round'
      />

      {limitHighlightData ? (
        <>
          <circle
            cx={xScale(limitHighlightData.span)}
            cy={yScale(limitHighlightData.load)}
            r={5}
            fill={limitHighlightData.color}
          />
          <text
            x={xScale(limitHighlightData.span) + 10}
            y={yScale(limitHighlightData.load) - 10}
            fontSize='10'
            fill={limitHighlightData.color}
          >
            {limitHighlightData.label}
          </text>
        </>
      ) : null}

      {markerData ? (
        <>
          <line
            x1={xScale(markerData.clampedSpan)}
            x2={xScale(markerData.clampedSpan)}
            y1={CHART_HEIGHT - MARGIN}
            y2={yScale(markerData.clampedLoad)}
            stroke={markerData.color}
            strokeWidth={1.5}
            strokeDasharray='6 4'
          />
          <line
            x1={MARGIN}
            x2={xScale(markerData.clampedSpan)}
            y1={yScale(markerData.clampedLoad)}
            y2={yScale(markerData.clampedLoad)}
            stroke={markerData.color}
            strokeWidth={1.5}
            strokeDasharray='6 4'
          />
          <circle
            cx={xScale(markerData.clampedSpan)}
            cy={yScale(markerData.clampedLoad)}
            r={4}
            fill={markerData.color}
            stroke={tokens.colorNeutralBackground1}
            strokeWidth={1}
          />
          {markerData.label ? (
            <text
              x={xScale(markerData.clampedSpan) + 8}
              y={yScale(markerData.clampedLoad) + 12}
              fontSize='10'
              fill={markerData.color}
            >
              {markerData.label}
            </text>
          ) : null}
          {markerData.spanClamped || markerData.loadClamped ? (
            <text
              x={xScale(markerData.clampedSpan)}
              y={yScale(markerData.clampedLoad) - 18}
              fontSize='9'
              textAnchor='middle'
              fill={markerData.color}
            >
              Value outside curve domain
            </text>
          ) : null}
        </>
      ) : null}

      {verticalLinesData.map((line, index) => {
        const baseY = yScale(domainLoadMin);
        const targetY = yScale(line.load);
        const offsetDirection = index % 2 === 0 ? -1 : 1;
        let labelContent = line.label;
        return (
          <g key={line.key}>
            <line
              x1={xScale(line.span)}
              x2={xScale(line.span)}
              y1={baseY}
              y2={targetY}
              stroke={line.color}
              strokeWidth={1.5}
              strokeDasharray='4 4'
            />
            <circle
              cx={xScale(line.span)}
              cy={targetY}
              r={4}
              fill={line.color}
              stroke={tokens.colorNeutralBackground1}
              strokeWidth={1}
            />
            {labelContent ? (
              <text
                x={xScale(line.span)}
                y={targetY + offsetDirection * 16}
                textAnchor='middle'
                fontSize='10'
                fill={line.color}
              >
                {labelContent}
              </text>
            ) : null}
          </g>
        );
      })}      {horizontalLinesData.map((line, index) => {
        const baseX = xScale(domainSpanMin);
        const targetX = xScale(line.span);
        const y = yScale(line.load);
        const offsetDirection = index % 2 === 0 ? -1 : 1;
        return (
          <g key={line.key}>
            <line
              x1={baseX}
              x2={targetX}
              y1={y}
              y2={y}
              stroke={line.color}
              strokeWidth={1.5}
              strokeDasharray='4 4'
            />
            <circle
              cx={targetX}
              cy={y}
              r={4}
              fill={line.color}
              stroke={tokens.colorNeutralBackground1}
              strokeWidth={1}
            />
            {line.label ? (
              <text
                x={targetX + 10}
                y={y + offsetDirection * 16}
                textAnchor='start'
                fontSize='10'
                fill={line.color}
              >
                {line.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* Domain summary */}
      {summaryDisplay && !summaryDisplay.includes('Max allowable span') ? (
        <text
          x={CHART_WIDTH - MARGIN}
          y={MARGIN + 4}
          textAnchor='end'
          fontSize='10'
          fill={summaryFill}
        >
          {summaryDisplay}
        </text>
      ) : null}
    </svg>
  );
});

LoadCurveChart.displayName = 'LoadCurveChart';
