import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderCalculationGrantPanel, type CalculationGrantPanelProps } from './PathFinderCalculationGrantPanel';
import { usePathfinderCalculationGrants } from './hooks/usePathfinderCalculationGrants';
import { calculationGrantFixture, calculationGrantIds as ids } from '@/test/calculationGrantFixtures';
vi.mock('./hooks/usePathfinderCalculationGrants', () => ({ usePathfinderCalculationGrants: vi.fn() }));
const props: CalculationGrantPanelProps = { projectId: ids.project, loadedProjectId: ids.project, token: 'token', accountId: ids.actor, isAdmin: true, active: true, contextKey: 'model', preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true } };
function setup() {
  const state = { context: calculationGrantFixture().context, enabled: true, busy: false, error: null, conflict: false, identity: 'model', pending: null, unknown: false, command: vi.fn(), refresh: vi.fn(), retry: vi.fn(), discardConflict: vi.fn() };
  vi.mocked(usePathfinderCalculationGrants).mockReturnValue(state); return state;
}
beforeEach(() => vi.clearAllMocks());
describe('explicit calculation-only project grant panel', () => {
  it('requires the checkbox and explicit save, never creating authority on mount', () => {
    const state = setup(); render(<PathFinderCalculationGrantPanel {...props} />);
    expect(state.command).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Save background calculation setting' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Automatically recalculate model revisions' })); expect(state.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save background calculation setting' }));
    expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'enable', expectedControlRevision: '0', idempotencyKey: expect.any(String), preferences: props.preferences, timeoutMilliseconds: 60000 }));
    expect(screen.getByText(/engineering review and Apply remain manual/)).toBeVisible(); expect(screen.getByText('Model preparation not qualified')).toBeVisible();
  });
  it('shows blocked preparation honestly and sends disable without reusing enable settings', () => {
    const state = setup(), f = calculationGrantFixture();
    vi.mocked(usePathfinderCalculationGrants).mockReturnValue({ ...state, context: { ...f.enabled, status: 'blocked', reasonCodes: ['MODEL_GEOMETRY_REQUIRED'], producer: { status: 'blocked', reasonCode: 'PRODUCER_NOT_QUALIFIED' } } });
    render(<PathFinderCalculationGrantPanel {...props} />);
    expect(screen.getByText('Geometry pending — model preparation blocked')).toBeVisible(); expect(screen.getByText('model geometry required')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Automatically recalculate model revisions' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save background calculation setting' })).toBeDisabled(); expect(state.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Automatically recalculate model revisions' })); fireEvent.click(screen.getByRole('button', { name: 'Save background calculation setting' }));
    expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'disable', expectedControlRevision: '1' }));
    expect(state.command.mock.calls[0][0]).not.toHaveProperty('preferences');
  });
  it.each(['restore-fenced', 'revoked'] as const)('requires explicit reactivation of a historical enabled %s grant even with identical preferences', status => {
    const state = setup(), f = calculationGrantFixture();
    vi.mocked(usePathfinderCalculationGrants).mockReturnValue({ ...state, context: { ...f.enabled, status,
      reasonCodes: [status === 'restore-fenced' ? 'CALCULATION_GRANT_RESTORE_FENCED' : 'CALCULATION_GRANT_ISSUER_REVOKED'] } });
    render(<PathFinderCalculationGrantPanel {...props} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Automatically recalculate model revisions' }), save = screen.getByRole('button', { name: 'Save background calculation setting' });
    expect(checkbox).not.toBeChecked(); expect(save).toBeDisabled(); expect(state.command).not.toHaveBeenCalled();
    expect(screen.getByRole('spinbutton')).toHaveValue(f.enabled.grant!.timeoutMilliseconds);
    expect(screen.getByText(status === 'restore-fenced' ? 'Enable again after restore' : 'Administrator authorization revoked')).toBeVisible();
    fireEvent.click(checkbox); expect(checkbox).toBeChecked(); expect(save).toBeEnabled(); expect(state.command).not.toHaveBeenCalled();
    fireEvent.click(save);
    expect(state.command).toHaveBeenCalledOnce();
    expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ action: 'enable', expectedControlRevision: f.enabled.controlRevision,
      idempotencyKey: expect.any(String), preferences: f.enabled.grant!.preferences, timeoutMilliseconds: f.enabled.grant!.timeoutMilliseconds }));
  });
  it.each(['restore-fenced', 'revoked'] as const)('discards an earlier checked draft when authorization becomes %s without a control revision change', status => {
    const state = setup(), f = calculationGrantFixture();
    vi.mocked(usePathfinderCalculationGrants).mockReturnValue({ ...state, context: f.enabled });
    const view = render(<PathFinderCalculationGrantPanel {...props} />), checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox); fireEvent.click(checkbox); expect(checkbox).toBeChecked();
    vi.mocked(usePathfinderCalculationGrants).mockReturnValue({ ...state, context: { ...f.enabled, status } });
    view.rerender(<PathFinderCalculationGrantPanel {...props} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(screen.getByRole('button', { name: 'Save background calculation setting' })).toBeDisabled();
    expect(state.command).not.toHaveBeenCalled();
  });
  it('freezes uncertain inputs and offers only exact saved-command reconciliation', () => {
    const state = setup(), f = calculationGrantFixture();
    vi.mocked(usePathfinderCalculationGrants).mockReturnValue({ ...state, pending: f.command, unknown: true });
    render(<PathFinderCalculationGrantPanel {...props} />);
    expect(screen.getByRole('checkbox')).toBeDisabled(); expect(screen.getByRole('spinbutton')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Save background calculation setting' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved background command' })); expect(state.retry).toHaveBeenCalledOnce(); expect(state.command).not.toHaveBeenCalled();
  });
  it('rejects invalid preferences/timeout and hides controls after administrator access is lost', () => {
    const state = setup(), view = render(<PathFinderCalculationGrantPanel {...props} />);
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '99' } }); expect(screen.getByRole('button', { name: 'Save background calculation setting' })).toBeDisabled();
    view.rerender(<PathFinderCalculationGrantPanel {...props} preferences={null} />); expect(state.command).not.toHaveBeenCalled();
    vi.mocked(usePathfinderCalculationGrants).mockReturnValue({ ...state, enabled: false }); view.rerender(<PathFinderCalculationGrantPanel {...props} isAdmin={false} />);
    expect(screen.queryByRole('region', { name: 'Background model recalculation' })).toBeNull();
  });
});
