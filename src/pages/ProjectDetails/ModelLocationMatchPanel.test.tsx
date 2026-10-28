import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelLocationMatchPanel } from './ModelLocationMatchPanel';
import { useModelLocationMatch } from './hooks/useModelLocationMatch';
import type { usePathFinder } from './hooks/usePathFinder';
vi.mock('./hooks/useModelLocationMatch', () => ({ useModelLocationMatch: vi.fn() }));
function setup(change: Partial<ReturnType<typeof useModelLocationMatch>> = {}) {
  const state = { owner: 'scope', storageReady: true, busy: false, phase: 'idle', progress: null, error: null, notice: null,
    pending: null, results: [], totalNames: 0, complete: false, allowed: true, canStart: true, start: vi.fn(), retry: vi.fn(), cancel: vi.fn(), ...change } as ReturnType<typeof useModelLocationMatch>;
  vi.mocked(useModelLocationMatch).mockReturnValue(state);
  render(<ModelLocationMatchPanel pf={{} as ReturnType<typeof usePathFinder>} accountId="account" active />);
  return state;
}
beforeEach(() => vi.clearAllMocks());
describe('independent From/To control', () => {
  it('offers one separate action without the long implementation description', () => {
    const state = setup(); fireEvent.click(screen.getByRole('button', { name: 'Find and assign From/To' }));
    expect(state.start).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/does not change the tray network or start routing calculations/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Find and assign From/To' })).toBeVisible();
  });
  it('reports its active work so tray preparation can wait for location assignments', () => {
    setup({ busy: true }); const onBusyChange = vi.fn();
    const view = render(<ModelLocationMatchPanel pf={{} as ReturnType<typeof usePathFinder>} accountId="account" active onBusyChange={onBusyChange} />);
    expect(onBusyChange).toHaveBeenLastCalledWith(true); view.unmount(); expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
  it('shows progress immediately with cancellation while the operation is running', () => {
    const state = setup({ busy: true, canStart: false, phase: 'finding', progress: 'Finding From/To locations: 128 of 150 names checked.' });
    expect(screen.getByRole('button', { name: 'Find and assign From/To' })).toBeDisabled();
    expect(screen.getByText('Finding From/To locations: 128 of 150 names checked.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel finding locations' })); expect(state.cancel).toHaveBeenCalledTimes(1);
  });
  it('offers only the saved assignment retry while its outcome is unknown', () => {
    const state = setup({ canStart: false, pending: {} as NonNullable<ReturnType<typeof useModelLocationMatch>['pending']>, error: 'Assignment is unconfirmed.' });
    expect(screen.getByRole('button', { name: 'Find and assign From/To' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved location assignment' }));
    expect(state.retry).toHaveBeenCalledTimes(1); expect(state.start).not.toHaveBeenCalled();
  });
  it('keeps the confirmed prefix and actual busy failure visible while recovery is paused', () => {
    setup({ canStart: false, pending: {} as NonNullable<ReturnType<typeof useModelLocationMatch>['pending']>, totalNames: 1478,
      progress: '640 of 1478 names confirmed. Project busy (PREFLIGHT_DATABASE_BUSY; HTTP 503).',
      error: 'Project busy (PREFLIGHT_DATABASE_BUSY; HTTP 503). The assignment outcome is unconfirmed.',
      results: Array.from({ length: 640 }, (_, i) => ({ name: `TAG-${i}`, status: 'preserved', candidateObjectIds: [], locationId: null, bindingId: null, reasonCode: 'MANUAL_ASSIGNMENT_PRESERVED' })) });
    expect(screen.getByRole('alert')).toHaveTextContent('PREFLIGHT_DATABASE_BUSY; HTTP 503');
    expect(screen.getByText(/Last progress: 640 of 1478 names confirmed/)).toBeVisible();
    expect(screen.getByText(/640 of 1478 names processed. Assigned: 0; kept: 640/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry saved location assignment' })).toBeEnabled();
  });
  it('distinguishes assigned, preserved and unresolved locations without hiding failed names', () => {
    const results = (['assigned', 'preserved', 'missing', 'ambiguous', 'unavailable'] as const).map((status, index) => ({ name: `TAG-${index}`, status,
      candidateObjectIds: status === 'ambiguous' ? [1, 2] : [], locationId: null, bindingId: null, reasonCode: null }));
    setup({ complete: true, totalNames: 5, results });
    expect(screen.getByText(/5 of 5 names processed. Assigned: 1; kept: 1; not found: 1; multiple matches: 1; unavailable or hidden: 1/)).toBeVisible();
    fireEvent.click(screen.getByText('Locations that need attention (3)'));
    expect(screen.getByText(/TAG-2: not found/)).toBeVisible(); expect(screen.getByText(/TAG-3: multiple matching objects/)).toBeVisible();
    expect(screen.getByText(/TAG-4: the matching object is hidden or has no usable location/)).toBeVisible();
  });
  it('does not show the write control without current administrator access', () => {
    setup({ allowed: false, canStart: false }); expect(screen.queryByRole('button', { name: 'Find and assign From/To' })).not.toBeInTheDocument();
  });
});
