import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PathFinderDirectSecondary } from './PathFinderDirectSecondary';
import type { DirectSecondaryDecision } from '../../../shared/pathfinderDirectSecondary';

const decision = (): DirectSecondaryDecision => ({ schemaVersion: 'wfc.pf.direct-secondary.v1', policyVersion: 'nearest-eligible-tray-or.v1',
  coordinateFrame: 'canonical-world-metres', mode: 'direct-secondary', fromPoint: [0, 0, 0], toPoint: [3, 0, 0], distanceMeters: 3,
  nearestFromMeters: 7, nearestToMeters: 8, eligibleTrays: 2, comparison: 'both' });
afterEach(cleanup);
describe('recorded direct SECONDARY explanation', () => {
  it('does not relabel historical calculations without an explicit decision', () => {
    const { container } = render(<PathFinderDirectSecondary />); expect(container).toBeEmptyDOMElement();
  });
  it.each(['both', 'from-approach', 'to-approach'] as const)('explains the recorded %s comparison without changing cable values', comparison => {
    render(<PathFinderDirectSecondary decision={{ ...decision(), comparison }} />);
    expect(screen.getByRole('heading', { name: 'Direct SECONDARY connection' })).toBeVisible();
    expect(screen.getByText(/From to To: 3 m/)).toHaveTextContent('From: 7 m; from To: 8 m');
    expect(screen.getByText(/The direct distance is shorter/)).toHaveTextContent(comparison === 'both' ? 'both approaches' : comparison === 'from-approach' ? 'the From approach' : 'the To approach');
    expect(screen.getByText(/Design length:/)).toHaveTextContent('Secondary tray length and extra connection gaps are not added');
    expect(screen.getByText(/Check that the direct connection/)).toHaveTextContent('does not verify obstacles or clearance');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('explains normal routing when neither approach authorizes a shortcut', () => {
    render(<PathFinderDirectSecondary decision={{ ...decision(), mode: 'tray-network', nearestFromMeters: 1, nearestToMeters: 2, comparison: null }} />);
    expect(screen.getByRole('heading', { name: 'Tray network route' })).toBeVisible();
    expect(screen.getByText(/Neither nearest approach/)).toHaveTextContent('Normal tray routing applies');
    expect(screen.queryByText(/Design length:/)).not.toBeInTheDocument();
  });
  it('does not present missing eligible geometry as proof of a direct connection', () => {
    render(<PathFinderDirectSecondary decision={{ ...decision(), mode: 'tray-network', eligibleTrays: 0, nearestFromMeters: null, nearestToMeters: null, comparison: null }} />);
    expect(screen.getByText(/Eligible tray geometry/)).toHaveTextContent('cannot authorize a direct connection');
    expect(screen.getByText(/From to To:/)).toHaveTextContent('from From: Unavailable; from To: Unavailable');
  });
});
