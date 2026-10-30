import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PathFinderRecalculationPanel, type RecalculationPanelProps } from './PathFinderRecalculationPanel';
import { usePathfinderRecalculations } from './hooks/usePathfinderRecalculations';
import { recalculationFixture, recalculationIds as ids } from '@/test/recalculationFixtures';
import { AUTOMATIC_PAIR_POLICY } from '../../../shared/pathfinderAutomaticPair';
import type { RecalculationContext } from '@/api/pathfinderRecalculations';
import type { RecalculationProgress } from '../../../shared/pathfinderRecalculation';
vi.mock('./hooks/usePathfinderRecalculations', () => ({ usePathfinderRecalculations: vi.fn() }));
const props: RecalculationPanelProps = { projectId: ids.project, loadedProjectId: ids.project, token: 'token', isAdmin: true, active: true, contextKey: 'model', preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true } };
function setup() { const state = { context: recalculationFixture().context, enabled: true, busy: false, pending: null, unknown: false, conflict: false, error: null, identity: 'model', command: vi.fn(), retry: vi.fn(), refresh: vi.fn(), discardConflict: vi.fn() }; vi.mocked(usePathfinderRecalculations).mockReturnValue(state); return state; }
function progressContext(change: Partial<RecalculationProgress> = {}, contextChange: Partial<RecalculationContext> = {}): RecalculationContext {
  const f = recalculationFixture();
  const progress: RecalculationProgress = { schemaVersion: 'wfc.pf.recalculation-progress.v1', jobId: ids.key, generation: '7', total: 2140,
    eligible: 360, blockedInputs: 1780, waiting: 56, running: 1, processed: 303, calculated: 303, saved: 303, saving: 0,
    reviewRequired: 0, refused: 0, authorityExpired: 0, stale: 0, notScheduledForSave: 0, calculationFailed: 0, ...change };
  return { ...f.enabled, status: 'calculating', jobId: ids.key, total: 2140, completed: progress.processed + 1780, readyCables: 360, blockedCables: 1780,
    authority: { ...f.enabled.authority!, expiresAt: '2099-01-01T00:00:00.000Z' }, automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY }, progress, ...contextChange };
}
beforeEach(() => vi.clearAllMocks());
describe('narrow automatic recalculation panel', () => {
  it('explains missing barrier configuration separately from a valid timeout and links to the required action', () => {
    const state = setup(), configure = vi.fn();
    render(<PathFinderRecalculationPanel {...props} preferences={null} configurationMessage="Save obstacles or choose Declare no barriers in Barriers." onConfigureCalculation={configure} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Save obstacles or choose Declare no barriers');
    expect(screen.queryByText(/timeout from 100/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Configure automatic calculation' })); expect(configure).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Enable for 30 minutes' })).toBeDisabled(); expect(state.command).not.toHaveBeenCalled();
  });
  it('requires explicit finite enrollment with current preferences and never submits on mount', () => {
    const state = setup(); render(<PathFinderRecalculationPanel {...props} />); expect(state.command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enable for 30 minutes' }));
    expect(state.command).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: 'wfc.pf.recalculation-command.v2', action: 'enable', expectedControlRevision: '4', preferences: props.preferences, timeoutMilliseconds: 60000, idempotencyKey: expect.any(String), automaticPairPolicy: AUTOMATIC_PAIR_POLICY }));
    expect(screen.getByText(/Manually edited cable values still require Review and Apply/)).toBeVisible();
    expect(screen.getByText(/separate Background model recalculation setting calculates proposals only/)).toBeVisible();
    expect(screen.getByText(/Resume and Retry keep the original end time/)).toBeVisible();
  });
  it('shows truthful server progress and reasons without enabling unsupported or uncertain changes', () => {
    const state = setup(), f = recalculationFixture();
    vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: { ...f.enabled, status: 'blocked', reasonCodes: ['ENDPOINTS_REQUIRED'] }, pending: f.command, unknown: true });
    render(<PathFinderRecalculationPanel {...props} />);
    expect(screen.getByText('endpoints required')).toBeVisible(); expect(screen.getByText(/Detailed progress for the current calculation is not available/)).toBeVisible();
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
  it('distinguishes a legacy proposal-only setting from the explicitly enabled automatic output policy', () => {
    const state = setup(), f = recalculationFixture();
    vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: f.enabled });
    const view = render(<PathFinderRecalculationPanel {...props} />);
    expect(screen.getByText(/Automatic Cable list updates are off/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry recalculation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enable for 30 minutes' })).toBeEnabled();
    vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: { ...f.enabled, automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } } });
    view.rerender(<PathFinderRecalculationPanel {...props} />);
    expect(screen.getByText(/Saved Cable list policy: update empty or unchanged automatic/)).toBeVisible();
    expect(screen.queryByText(/Automatic Cable list updates are off/)).not.toBeInTheDocument();
    expect(state.command).not.toHaveBeenCalled();
  });
  it('keeps pause v1 and requires existing policy on v2 resume/retry without adding enable preferences', () => {
    const state = setup(), f = recalculationFixture();
    vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: { ...f.enabled, automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } } });
    const view = render(<PathFinderRecalculationPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause automatic recalculation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry recalculation' }));
    vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: { ...f.enabled, paused: true, status: 'paused', automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } } });
    view.rerender(<PathFinderRecalculationPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume automatic recalculation' }));
    expect(state.command.mock.calls.map(([body]) => body.action)).toEqual(['pause', 'retry', 'resume']);
    for (const [body] of state.command.mock.calls) {
      expect(body.schemaVersion).toBe(body.action === 'pause' ? 'wfc.pf.recalculation-command.v1' : 'wfc.pf.recalculation-command.v2');
      if (body.action === 'pause') expect(body).not.toHaveProperty('automaticPairPolicy');
      else expect(body.automaticPairPolicy).toEqual(AUTOMATIC_PAIR_POLICY);
      expect(body).not.toHaveProperty('preferences'); expect(body).not.toHaveProperty('timeoutMilliseconds');
    }
  });
  it('shows an indeterminate indicator while collecting current inputs without claiming old totals', () => {
    const state = setup(), f = recalculationFixture();
    vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: { ...f.enabled, status: 'collecting',
      authority: { ...f.enabled.authority!, expiresAt: '2099-01-01T00:00:00.000Z' } } });
    render(<PathFinderRecalculationPanel {...props} />);
    expect(screen.getByText('Preparing automatic calculation…')).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'Preparing automatic calculation' })).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByText(/Ready:/)).not.toBeInTheDocument(); expect(screen.queryByText(/Processed/)).not.toBeInTheDocument();
    expect(state.command).not.toHaveBeenCalled();
  });
  it('counts processed eligible cables separately from excluded inputs and actual Cable list saves', () => {
    const state = setup(); vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: progressContext() });
    render(<PathFinderRecalculationPanel {...props} />);
    const bar = screen.getByRole('progressbar', { name: 'Eligible cable calculation' });
    expect(bar).toHaveAttribute('aria-valuenow', '303'); expect(bar).toHaveAttribute('aria-valuemax', '360');
    expect(screen.getByText('Processed 303 / 360 eligible cables.')).toBeVisible();
    expect(screen.getByText('Calculated routes: 303. Saved in Cable list: 303.')).toBeVisible();
    expect(screen.getByText('Not eligible before calculation: 1780 of 2140 cables.')).toBeVisible();
    expect(screen.getByText('Calculating routes…')).toBeVisible(); expect(screen.queryByText(/Ready:/)).not.toBeInTheDocument();
  });
  it('keeps saving visible after calculations reach100 percent and finishes only after all saves settle', () => {
    const state = setup(), counters = { waiting: 0, running: 0, processed: 360, calculated: 360, saved: 303, saving: 57 };
    vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: progressContext(counters, { status: 'complete' }) });
    const view = render(<PathFinderRecalculationPanel {...props} />);
    expect(screen.getByText('Saving or confirming calculated results…')).toBeVisible(); expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.getByText('Waiting for saving or confirmation: 57.')).toBeVisible();
    vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: progressContext({ ...counters, saved: 360, saving: 0 }, { status: 'complete' }) });
    view.rerender(<PathFinderRecalculationPanel {...props} />);
    expect(screen.getByText('All calculated routes have been saved in Cable list.')).toBeVisible();
    expect(screen.queryByText('Saving or confirming calculated results…')).not.toBeInTheDocument();
  });
  it.each(['generation', 'job', 'enrollment'] as const)('does not display previous calculation counts when %s is stale', kind => {
    const state = setup(), context = progressContext();
    if (kind === 'generation') context.progress!.generation = '6';
    if (kind === 'job') context.progress!.jobId = ids.actor;
    if (kind === 'enrollment') context.enrolledGeneration = '6';
    vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context }); render(<PathFinderRecalculationPanel {...props} />);
    expect(screen.queryByText(/Processed 303/)).not.toBeInTheDocument(); expect(screen.queryByText(/Saved in Cable list: 303/)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Preparing automatic calculation' })).not.toHaveAttribute('aria-valuenow');
  });
  it.each(['paused', 'awaiting_authority', 'failed', 'superseded'] as const)('retains counts without an active spinner when %s', status => {
    const state = setup(); vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: progressContext({}, { status, paused: status === 'paused' }) });
    render(<PathFinderRecalculationPanel {...props} />);
    expect(screen.getByText('Processed 303 / 360 eligible cables.')).toBeVisible();
    expect(screen.queryByText('Calculating routes…')).not.toBeInTheDocument();
    expect(screen.getByText(/Progress is retained. Processing and automatic saving are not currently active/)).toBeVisible();
  });
  it('shows saved completion even after the period ended without treating it as a new saving operation', () => {
    const state = setup(); vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: progressContext({ waiting: 0, running: 0, processed: 360, calculated: 360, saved: 360 },
      { status: 'awaiting_authority', automaticPairPolicy: undefined, authority: { kind: 'current-login', actorId: ids.actor, currentLogin: true, expiresAt: '2020-01-01T00:00:00.000Z' } }) });
    render(<PathFinderRecalculationPanel {...props} />);
    expect(screen.getByText('All calculated routes have been saved in Cable list.')).toBeVisible();
    expect(screen.getByText(/automatic recalculation period ended/)).toBeVisible(); expect(screen.getByText(/Previous enablement ended at/)).toBeVisible();
    expect(screen.queryByText('Saving or confirming calculated results…')).not.toBeInTheDocument();
  });
  it('does not wait for automatic writes when the current mode only calculates proposals', () => {
    const state = setup(); vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: progressContext({ waiting: 0, running: 0, processed: 360, calculated: 360, saved: 0, notScheduledForSave: 360 }, { status: 'complete', automaticPairPolicy: undefined }) });
    render(<PathFinderRecalculationPanel {...props} />);
    expect(screen.getByText('Proposals calculated. Automatic saving is off.')).toBeVisible();
    expect(screen.getByText('Proposals without automatic saving: 360.')).toBeVisible();
    expect(screen.queryByText('Saving or confirming calculated results…')).not.toBeInTheDocument();
  });
  it('retains unconfirmed output counts without an active saving spinner after only output permission ends', () => {
    const state = setup(); vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: progressContext({ waiting: 0, running: 0, processed: 360, calculated: 360,
      saved: 303, saving: 57 }, { status: 'complete', automaticPairPolicy: undefined }) });
    render(<PathFinderRecalculationPanel {...props} />);
    expect(screen.getByText('Calculation finished. Automatic saving is off; some results are unconfirmed.')).toBeVisible();
    expect(screen.getByText('Waiting for saving or confirmation: 57.')).toBeVisible();
    expect(screen.queryByText('Saving or confirming calculated results…')).not.toBeInTheDocument();
    expect(screen.getByText(/Progress is retained. Processing and automatic saving are not currently active/)).toBeVisible();
  });
  it('separates review, refusals and other outcomes instead of calling every processed cable saved', () => {
    const state = setup(); vi.mocked(usePathfinderRecalculations).mockReturnValue({ ...state, context: progressContext({ waiting: 0, running: 0, processed: 360, calculated: 350,
      saved: 340, reviewRequired: 2, refused: 3, authorityExpired: 1, stale: 1, notScheduledForSave: 3, calculationFailed: 10 }, { status: 'complete' }) });
    render(<PathFinderRecalculationPanel {...props} />);
    expect(screen.getByText('Calculations finished. Some results need attention.')).toBeVisible();
    expect(screen.getByText('Calculated routes: 350. Saved in Cable list: 340.')).toBeVisible();
    expect(screen.getByText('Review and Apply required: 2.')).toBeVisible(); expect(screen.getByText('Automatic saving refused: 3.')).toBeVisible();
    expect(screen.getByText('Other outcomes needing attention: 10.')).toBeVisible(); expect(screen.queryByText('Complete')).not.toBeInTheDocument();
  });
});
