import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { barrierCalculationFixture } from '@/test/pathfinderBarrierFixtures';
import { PathFinderObstacleList } from './PathFinderObstacleList';
import type { AnyBarrierExecution } from '../../../shared/pathfinderBarrierSupported';

const id = (n: number) => `bc800000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function execution(crossings: number[] = [], blockers: number[] = [], drill = false): AnyBarrierExecution {
  const value = barrierCalculationFixture(id, drill).barriers;
  value.obstacleReport = { status: 'complete', crossedParentSelectionIds: crossings.map(number => id(number + 200)),
    blockingParentSelectionIds: blockers.map(number => id(number + 200)), checkedSegments: 1, totalSegments: 1,
    reasonCode: 'OBSTACLE_REPORT_COMPLETE', selectedParents: [...new Set([...crossings, ...blockers])].map(number => ({
      selectionId: id(number + 200), dbId: number, objectId: `dbid:${number}`, name: `Model object ${number}`, kind: 'obstacle', externalId: null,
      identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments',
    })) };
  return value;
}
function Location() { return <output data-testid="location">{JSON.stringify(useLocation())}</output>; }

describe('visible recorded obstacle list', () => {
  it('always shows both groups with explicit recorded zero findings', () => {
    render(<PathFinderObstacleList execution={execution()} />);
    expect(screen.getByRole('heading', { name: 'Obstacles crossed by this route (0)' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Obstacles blocking checked routing candidates (0)' })).toBeVisible();
    expect(screen.getByText('No registered obstacles intersect this route.')).toBeVisible();
    expect(screen.getByText('No blocking obstacles were recorded in the checked routing candidates.')).toBeVisible();
  });

  it('shows sorted crossing and blocking counts with links to their recorded model', () => {
    const value = execution([42, 18], [7]);
    render(<MemoryRouter><PathFinderObstacleList execution={value} /><Location /></MemoryRouter>);
    const crossed = within(screen.getByRole('region', { name: 'Crossed route obstacles' }));
    expect(crossed.getByRole('heading', { name: 'Obstacles crossed by this route (2)' })).toBeVisible();
    expect(crossed.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Obstacle #18 · Model object 18 (obstacle)', 'Obstacle #42 · Model object 42 (obstacle)',
    ]);
    expect(screen.getByRole('heading', { name: 'Obstacles blocking checked routing candidates (1)' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show obstacle #18 in 3D' }));
    const target = JSON.parse(screen.getByTestId('location').textContent!);
    expect(target.state.pathfinderObstacle).toMatchObject({ ...value.context.binding.scope, dbId: 18 });
  });

  it('distinguishes drilling candidate checks from a completed zero-crossing observation', () => {
    render(<PathFinderObstacleList execution={execution([], [], true)} />);
    expect(screen.getByRole('heading', { name: 'Obstacles crossed by this route (0)' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Obstacles blocking checked routing candidates (Not checked)' })).toBeVisible();
    expect(screen.getByText(/Routing candidates were not checked.*Drill through the walls/)).toBeVisible();
    expect(screen.getByText('No registered obstacles intersect this route.')).toBeVisible();
  });

  it('keeps historical unknown findings distinct from recorded zero', () => {
    render(<PathFinderObstacleList />);
    expect(screen.getByRole('heading', { name: 'Obstacles crossed by this route (Not recorded)' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Obstacles blocking checked routing candidates (Not recorded)' })).toBeVisible();
    expect(screen.getAllByText(/Numbered obstacle findings were not recorded/)).toHaveLength(2);
    expect(screen.queryByText('No registered obstacles intersect this route.')).toBeNull();
  });

  it('explains an explicit empty registered scope without inventing historic observations', () => {
    render(<PathFinderObstacleList execution={barrierCalculationFixture(id).barriers} />);
    expect(screen.getAllByText(/No obstacles were registered for this calculation/)).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Obstacles crossed by this route (Not recorded)' })).toBeVisible();
  });

  it.each(['partial', 'unavailable'] as const)('shows incomplete %s zero as detected observations, never clearance', status => {
    const value = execution(); value.obstacleReport = { ...value.obstacleReport!, status, checkedSegments: 0 };
    render(<PathFinderObstacleList execution={value} />);
    expect(screen.getByRole('heading', { name: 'Obstacles crossed by this route (0 detected)' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Additional intersections may exist');
    expect(screen.queryByText('No registered obstacles intersect this route.')).toBeNull();
  });

  it('retains known findings during a partial observation and labels aggregate blocker membership honestly', () => {
    const value = execution([42], [7, 18]);
    value.obstacleReport = { ...value.obstacleReport!, status: 'partial', checkedSegments: 0, blockingAttribution: 'component-membership' };
    render(<PathFinderObstacleList execution={value} />);
    expect(screen.getByRole('heading', { name: 'Obstacles crossed by this route (1 detected)' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Selected objects associated with blocking geometry (2 detected)' })).toBeVisible();
    expect(screen.getByText(/cannot identify which individual object was touched/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: /Obstacles blocking checked routing candidates/ })).toBeNull();
  });

  it('does not call a missing final route a zero-crossing result', () => {
    const value = execution([], [18]); value.obstacleReport = { ...value.obstacleReport!, checkedSegments: 0, totalSegments: 0 };
    render(<PathFinderObstacleList execution={value} />);
    expect(screen.getByRole('heading', { name: 'Obstacles crossed by this route (Not checked)' })).toBeVisible();
    expect(screen.getByText('No final route was available for an intersection check.')).toBeVisible();
    expect(screen.getByText('Obstacle #18 · Model object 18 (obstacle)')).toBeVisible();
    expect(screen.queryByText('No registered obstacles intersect this route.')).toBeNull();
  });

  it('keeps groups visible while loading and hides earlier findings', () => {
    render(<PathFinderObstacleList execution={execution([18])} loading />);
    expect(screen.getAllByRole('heading', { name: /Not recorded/ })).toHaveLength(2);
    expect(screen.queryByText(/Model object 18/)).toBeNull();
    expect(screen.getByText('Reading obstacle findings…')).toBeVisible();
  });

  it('shows a read error and both unknown groups without reviving earlier findings', () => {
    const retry = vi.fn();
    render(<PathFinderObstacleList execution={execution([18])} error="Saved obstacle list could not be read." onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Saved obstacle list could not be read.');
    expect(screen.getAllByRole('heading', { name: /Not recorded/ })).toHaveLength(2);
    expect(screen.queryByText(/Model object 18/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry obstacle list' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('does not display malformed identities as numbered hits', () => {
    const value = execution([18]); value.obstacleReport!.crossedParentSelectionIds = [id(999)];
    render(<PathFinderObstacleList execution={value} />);
    expect(screen.getAllByText(/recorded obstacle evidence could not be read/)).toHaveLength(2);
    expect(screen.queryByText(/Model object 18/)).toBeNull();
  });
});
