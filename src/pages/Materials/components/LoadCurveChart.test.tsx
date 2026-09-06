import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MaterialLoadCurvePoint } from '@/api/client';
import { LoadCurveChart } from './LoadCurveChart';

const point = (spanM: number, loadKnPerM: number): MaterialLoadCurvePoint => ({
  id: `${spanM}-${loadKnPerM}`,
  order: 0,
  spanM,
  loadKnPerM,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('LoadCurveChart', () => {
  it('keeps large imported ranges readable with a bounded number of grid labels', () => {
    const { container } = render(
      <LoadCurveChart points={[point(0, 1_000_000), point(1_000_000, 0)]} />,
    );
    expect(screen.getByRole('img', { name: 'Load curve chart' })).toBeInTheDocument();
    expect(container.querySelectorAll('text').length).toBeLessThanOrEqual(22);
    expect(container.querySelector('polyline')?.getAttribute('points')).not.toMatch(/NaN|Infinity/);
  });

  it('omits invalid point values and shows an empty state when no valid values remain', () => {
    const { container, rerender } = render(
      <LoadCurveChart points={[point(1, 2), point(Infinity, 3), point(2, NaN)]} />,
    );
    expect(container.querySelector('polyline')?.getAttribute('points')).not.toMatch(/NaN|Infinity/);
    rerender(<LoadCurveChart points={[point(Infinity, 3), point(2, NaN)]} />);
    expect(screen.getByText('No curve data available.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not replace numeric axis values with annotation labels', () => {
    const verticalLines = Array.from({ length: 37 }, (_, index) => ({
      span: 1,
      toLoad: 2,
      label: `Annotation ${index + 1}`,
    }));
    render(<LoadCurveChart points={[point(0, 20), point(2, 1)]} verticalLines={verticalLines} />);
    expect(screen.getAllByText('Annotation 37')).toHaveLength(1);
  });
});
