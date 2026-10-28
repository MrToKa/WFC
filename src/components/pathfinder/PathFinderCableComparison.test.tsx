import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PathFinderCableComparison } from './PathFinderCableComparison';
import type { CableComparisonInput } from '../../../shared/pathfinderCableComparison';

const id = (value: number) => `92000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
function input(): CableComparisonInput {
  const cable = { id: id(2), tag: 'C-1', fromLocation: 'Panel', toLocation: 'Motor', routing: '/A/B/A/SECONDARY', designLength: '12.00000000000000000001', installLength: '9.2500', cableWriteRevision: '8' };
  return { projectId: id(1), cableId: id(2), current: { source: 'live-cable-read', contextSha256: 'a'.repeat(64), mto: 'Control', cable },
    proposal: { projectId: id(1), cableId: id(2), proposalId: id(3), proposalHash: 'b'.repeat(64), revisionResultHash: 'c'.repeat(64), cableWriteRevision: '8', routing: '/A/A/B/SECONDARY', designLength: '13' },
    admissionBaseline: { admissionId: id(4), baselineHash: 'd'.repeat(64), cable: { ...cable, routing: '/AT-ADMISSION', designLength: '7', cableWriteRevision: '6' } } };
}
describe('read-only exact cable comparison', () => {
  it('shows exact live and proposed values, signed decimal delta and repeated ordered occurrence positions', () => {
    render(<PathFinderCableComparison input={input()} />);
    expect(screen.getByRole('region', { name: 'Current cable values' })).toHaveTextContent('12.00000000000000000001 m');
    expect(screen.getByRole('region', { name: 'Current cable values' })).toHaveTextContent('9.2500 m');
    expect(screen.getByRole('region', { name: 'Proposed cable values' })).toHaveTextContent('13 m');
    expect(screen.getByText('Design length delta: +0.99999999999999999999 m')).toBeVisible();
    expect(screen.getByText('Reordered B: old position 2 → new position 3.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Current cable values' })).toHaveTextContent('/A/B/A/SECONDARY');
    expect(screen.getByRole('region', { name: 'Proposed cable values' })).toHaveTextContent('/A/A/B/SECONDARY');
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('labels the admission baseline as historical rather than substituting it for live current values', () => {
    render(<PathFinderCableComparison input={input()} />); fireEvent.click(screen.getByText('Values at calculation admission'));
    expect(screen.getByText(/This frozen baseline is historical/)).toBeVisible(); expect(screen.getByText('/AT-ADMISSION')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Current cable values' })).queryByText('/AT-ADMISSION')).toBeNull();
  });
  it('describes both-empty as a candidate only, never as permission or a completed write', () => {
    const value = input(); value.current.cable = { ...value.current.cable, routing: ' \t\n\u00a0', designLength: null };
    render(<PathFinderCableComparison input={value} />);
    expect(screen.getByText(/separate current administrator mandate and server checks are required/)).toBeVisible();
    expect(screen.getByText('Whitespace only; exact text is retained below.')).toBeVisible(); expect(screen.queryByRole('button')).toBeNull();
  });
  it.each(['0', ''])('retains defined length %j when routing is blank', designLength => {
    const value = input(); value.current.cable = { ...value.current.cable, routing: null, designLength };
    render(<PathFinderCableComparison input={value} />);
    expect(screen.getByText('Existing or partial cable values are retained until explicit human Review and Apply.')).toBeVisible();
    expect(screen.queryByText(/Both current fields are empty/)).toBeNull();
    if (designLength === '') expect(screen.getByText('Design length: Empty string — a defined stored value')).toBeVisible();
  });
  it('shows stale and unavailable states without synthesizing a blank current record', () => {
    const value = input(); value.current.cable.cableWriteRevision = '9'; const view = render(<PathFinderCableComparison input={value} />);
    expect(screen.getByRole('alert')).toHaveTextContent('current cable revision differs');
    view.rerender(<PathFinderCableComparison input={null} />); expect(screen.getByRole('alert')).toHaveTextContent('Current cable values or their exact proposal references are unavailable');
    expect(screen.queryByRole('region', { name: 'Current cable values' })).toBeNull(); expect(screen.queryByText(/Both current fields are empty/)).toBeNull();
  });
  it('shows full raw route strings when bounded ordered alignment is unavailable', () => {
    const value = input(); value.current.cable.routing = '/A'.repeat(1100); value.proposal.routing = '/B'.repeat(1100);
    render(<PathFinderCableComparison input={value} />);
    expect(screen.getByRole('status')).toHaveTextContent('comparison work limit');
    expect(screen.getByText(value.current.cable.routing).textContent).toBe(value.current.cable.routing);
    expect(screen.getByText(value.proposal.routing).textContent).toBe(value.proposal.routing);
    expect(screen.queryByRole('list', { name: 'Route occurrence changes' })).toBeNull();
  });
  it('performs no network, calculation, review or writes', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    try { render(<PathFinderCableComparison input={input()} />); expect(fetch).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull(); }
    finally { vi.unstubAllGlobals(); }
  });
});
