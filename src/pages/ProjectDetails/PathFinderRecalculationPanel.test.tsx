import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderRecalculationPanel, type RecalculationPanelProps } from './PathFinderRecalculationPanel';
import { usePathfinderRecalculations } from './hooks/usePathfinderRecalculations';
import { recalculationFixture, recalculationIds as ids } from '@/test/recalculationFixtures';
vi.mock('./hooks/usePathfinderRecalculations', () => ({ usePathfinderRecalculations: vi.fn() }));
const props: RecalculationPanelProps = { projectId: ids.project, loadedProjectId: ids.project, token: 'token', isAdmin: true, active: true, contextKey: 'model', preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true } };
function setup() { const state = { context: recalculationFixture().context, enabled: true, busy: false, pending: null, unknown: false, conflict: false, error: null, identity: 'model', command: vi.fn(), retry: vi.fn(), refresh: vi.fn(), discardConflict: vi.fn() }; vi.mocked(usePathfinderRecalculations).mockReturnValue(state); return state; }
beforeEach(() => vi.clearAllMocks());
describe('narrow automatic recalculation panel', () => {
  it('requires explicit finite enrollment with current preferences and never submits on mount', () => {
    const state = setup(); render(<PathFinderRecalculationPanel {...props} />); expect(state.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enable for 30 minutes' }));
    expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'enable', expectedControlRevision: '4', preferences: props.preferences, timeoutMilliseconds: 60000, idempotencyKey: expect.any(String) }));
    expect(screen.getByText(/Results remain proposals/)).toBeVisible();
  });
  it('shows truthful server progress and reasons without enabling unsupported or uncertain changes', () => {
    const state = setup(), f = recalculationFixture();
    vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: { ...f.enabled, status: 'blocked', reasonCodes: ['ENDPOINTS_REQUIRED'] }, pending: f.command, unknown: true });
    render(<PathFinderRecalculationPanel {...props} />);
    expect(screen.getByText('endpoints required')).toBeVisible(); expect(screen.getByText(/Progress: 0 \/ 2/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Enable for 30 minutes' })).toBeDisabled(); expect(screen.getByRole('spinbutton')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved command' })); expect(state.retry).toHaveBeenCalledOnce(); expect(state.command).not.toHaveBeenCalled();
  });
  it('refuses invalid timeout and absent preferences, and hides administrator controls from denied access', () => {
    const state = setup(), view = render(<PathFinderRecalculationPanel {...props} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '99' } }); expect(screen.getByRole('button', { name: 'Enable for 30 minutes' })).toBeDisabled();
    view.rerender(<PathFinderRecalculationPanel {...props} preferences={null} />); expect(state.command).not.toHaveBeenCalled();
    vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, enabled: false }); view.rerender(<PathFinderRecalculationPanel {...props} isAdmin={false} />);
    expect(screen.queryByRole('region', { name: 'Automatic recalculation' })).toBeNull();
  });
});
