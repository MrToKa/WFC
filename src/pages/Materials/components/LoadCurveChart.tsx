import { memo, useMemo } from 'react';
import { Body2, tokens } from '@fluentui/react-components';
import type { MaterialLoadCurvePoint } from '@/api/client';

type LoadCurveChartProps = {
  points: MaterialLoadCurvePoint[];
  className?: string;
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

export const LoadCurveChart = memo(({ points, className }: LoadCurveChartProps) => {
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
    domainLoadMax
  } = processed;

  return (
    <svg
      className={className}
      width={CHART_WIDTH}
      height={CHART_HEIGHT}
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
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
        y={CHART_HEIGHT - 4}
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
      {spanTicks.map((tick) => {
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
      })}

      {loadTicks.map((tick) => {
        const y = yScale(tick);
        return (
          <text
            key={`ytick-${tick}`}
            x={MARGIN - 32}
            y={y + 4}
            textAnchor='end'
            fontSize='11'
            fill={tokens.colorNeutralForeground2}
          >
            {formatTick(tick)}
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

      {/* Domain summary */}
      <text
        x={CHART_WIDTH - MARGIN}
        y={MARGIN - 10}
        textAnchor='end'
        fontSize='10'
        fill={tokens.colorNeutralForeground2}
      >
        Span: {formatTick(domainSpanMin)} - {formatTick(domainSpanMax)} m
      </text>
      <text
        x={CHART_WIDTH - MARGIN}
        y={MARGIN + 4}
        textAnchor='end'
        fontSize='10'
        fill={tokens.colorNeutralForeground2}
      >
        Max load: {formatTick(domainLoadMax)} kN/m
      </text>
    </svg>
  );
});

LoadCurveChart.displayName = 'LoadCurveChart';
