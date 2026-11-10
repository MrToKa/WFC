import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPathFinderJob, submitAllPathFinderCalculations, type PathFinderJob, type PathFinderState } from '@/api/pathfinder';
import { barrierCalculationFixture } from '@/test/pathfinderBarrierFixtures';
import { AUTOMATIC_PAIR_POLICY } from '../../../shared/pathfinderAutomaticPair';
import { backgroundCalculationCounts, PathFinderRecalculateAll } from './PathFinderRecalculateAll';
vi.mock('@/api/pathfinder', async original => ({ ...await original<typeof import('@/api/pathfinder')>(), fetchPathFinderJob: vi.fn(), submitAllPathFinderCalculations: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const preferences = barrierCalculationFixture(id).preferences;
const current = { projectId: id(1), registryRevision: '12', activeModel: { modelVersionId: id(8), selectionRevision: '1', contentFingerprint: 'a'.repeat(64) }, settings: { connectionGap: '1.5' } } as PathFinderState;
const item = (status: string, output?: string) => ({ cableId: id(30), state: 'complete', status, message: null,
  ...(output ? { automaticUpdate: { status: output, receiptId: output === 'written' ? id(40) : null, reasonCode: null } } : {}) }) as NonNullable<PathFinderJob['items']>[number];
const makeJob = (status: PathFinderJob['status'], items: NonNullable<PathFinderJob['items']> = []) => ({ id: id(20), projectId: id(1), kind: 'calculate', status, total: 3, completed: items.length, cancelRequested: false, failure: null, attempts: 1, createdAt: '', updatedAt: '', items }) as PathFinderJob;
function setup() {
  const props = { projectId: id(1), accountId: id(2), token: 'token', modelKey: 'model', preferences, disabled: false, blocker: null,
    refreshState: vi.fn().mockResolvedValue(current), onChanged: vi.fn() };
  vi.mocked(submitAllPathFinderCalculations).mockResolvedValue({ kind: 'acknowledged', jobId: id(20), registryRevision: '12', duplicate: false });
  vi.mocked(fetchPathFinderJob).mockResolvedValue(makeJob('running'));
  return props;
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('whole-project background pass', () => {
  it('submits all cables exactly once with fresh registry and automatic output policy, without waiting for the engine', async () => {
    const props = setup(); render(<PathFinderRecalculateAll {...props} />);
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate all the cables' }));
    await waitFor(() => expect(fetchPathFinderJob).toHaveBeenCalled());
    expect(submitAllPathFinderCalculations).toHaveBeenCalledExactlyOnceWith(id(1), 'token', {
      expectedRegistryRevision: '12', force: true, automaticPairPolicy: AUTOMATIC_PAIR_POLICY,
      options: { connectionToleranceMeters: 1.5, sampleSpacingMeters: 0.125, maxGraphNodes: 200000, maxGraphConnections: 1000000, ...preferences },
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText(/Recalculating cables in the background/)).toBeVisible();
    expect(screen.getByRole('button')).toBeDisabled(); expect(props.refreshState).toHaveBeenCalledOnce();
  });
  it('continues GET-only polling after calculation completion until automatic saves finish', async () => {
    vi.useFakeTimers(); const props = setup();
    vi.mocked(fetchPathFinderJob).mockResolvedValueOnce(makeJob('complete', [item('calculated', 'pending')]))
      .mockResolvedValue(makeJob('complete', [item('calculated', 'written'), item('missing_from'), item('calculated', 'review-required')]));
    render(<PathFinderRecalculateAll {...props} />);
    await act(async () => fireEvent.click(screen.getByRole('button')));
    expect(screen.getByText(/Saving calculated routes/)).toBeVisible(); expect(screen.getByRole('button')).toBeDisabled();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText(/Background recalculation finished/)).toBeVisible(); expect(screen.getByRole('button')).toBeEnabled();
    expect(screen.getByText(/saved: 1; saving: 0; need review: 1; skipped or failed: 1/)).toBeVisible();
    expect(props.onChanged).toHaveBeenCalled(); expect(submitAllPathFinderCalculations).toHaveBeenCalledOnce();
  });
  it('restores exact job progress after reopening without submitting or following another global job', async () => {
    const props = setup(); localStorage.setItem(`wfc.recalculate-all:${id(1)}:${id(2)}`, id(20));
    render(<PathFinderRecalculateAll {...props} />);
    await waitFor(() => expect(fetchPathFinderJob).toHaveBeenCalledWith(id(1), 'token', id(20), expect.any(AbortSignal)));
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
  });
  it('refuses stale model options before any POST and leaves a retry possible', async () => {
    const props = setup(); props.refreshState.mockResolvedValue({ ...current, activeModel: { ...current.activeModel, modelVersionId: id(99) } });
    render(<PathFinderRecalculateAll {...props} />); fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('active model changed'));
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled(); expect(screen.getByRole('button')).toBeEnabled();
  });
  it('never replays uncertain admission and keeps the popup outside its lock', async () => {
    const props = setup(); vi.mocked(submitAllPathFinderCalculations).mockResolvedValue({ kind: 'unknown', code: 'CALCULATION_SUBMISSION_UNKNOWN' });
    render(<><button>Assign From</button><PathFinderRecalculateAll {...props} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate all the cables' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not confirmed'));
    expect(screen.getByRole('button', { name: 'Assign From' })).toBeEnabled(); expect(submitAllPathFinderCalculations).toHaveBeenCalledOnce();
  });
  it('does not call manual or uncertain output saved', () => {
    expect(backgroundCalculationCounts(makeJob('complete', [item('calculated'), item('calculated', 'unknown'), item('calculated', 'review-required')]))).toMatchObject({ saved: 0, review: 1, unsaved: 2 });
    expect(backgroundCalculationCounts(makeJob('complete', [{ ...item('locations_required'), state: 'blocked' }]))).toMatchObject({ blocked: 1, calculated: 0 });
  });
  it('retains uncertain admission across reload and model changes rather than issuing another forced POST', async () => {
    const props = setup(); vi.mocked(submitAllPathFinderCalculations).mockResolvedValue({ kind: 'unknown', code: 'CALCULATION_SUBMISSION_UNKNOWN' });
    const view = render(<PathFinderRecalculateAll {...props} />); fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not confirmed'));
    view.unmount(); render(<PathFinderRecalculateAll {...props} modelKey="another-model-revision" />);
    expect(screen.getByRole('button')).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent('individual cables');
    expect(submitAllPathFinderCalculations).toHaveBeenCalledOnce();
  });
  it('stops before POST when pending ownership cannot be saved', async () => {
    const props = setup(); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    render(<PathFinderRecalculateAll {...props} />); fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Enable site storage'));
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled(); expect(screen.getByRole('button')).toBeEnabled();
  });
  it('keeps observing an uncertain automatic write until its receipt is confirmed', async () => {
    vi.useFakeTimers(); const props = setup();
    vi.mocked(fetchPathFinderJob).mockResolvedValueOnce(makeJob('complete', [item('calculated', 'unknown')]))
      .mockResolvedValue(makeJob('complete', [item('calculated', 'written')]));
    render(<PathFinderRecalculateAll {...props} />); await act(async () => fireEvent.click(screen.getByRole('button')));
    expect(screen.queryByText(/Background recalculation finished/)).toBeNull(); expect(screen.getByRole('button')).toBeDisabled();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText(/Background recalculation finished/)).toBeVisible(); expect(screen.getByText(/saved: 1/)).toBeVisible();
    expect(submitAllPathFinderCalculations).toHaveBeenCalledOnce();
  });
  it('recovers a failed progress GET automatically without starting another pass', async () => {
    vi.useFakeTimers(); const props = setup();
    vi.mocked(fetchPathFinderJob).mockRejectedValueOnce(new TypeError('Offline')).mockResolvedValue(makeJob('complete', [item('calculated', 'written')]));
    render(<PathFinderRecalculateAll {...props} />);
    await act(async () => fireEvent.click(screen.getByRole('button')));
    expect(screen.getByRole('alert')).toHaveTextContent('Checking again automatically');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.getByText(/Background recalculation finished/)).toBeVisible();
    expect(submitAllPathFinderCalculations).toHaveBeenCalledOnce(); expect(fetchPathFinderJob).toHaveBeenCalledTimes(2);
  });
  it('aborts only its reads on project change and ignores the old project response', async () => {
    const props = setup(); let finish!: (value: PathFinderJob) => void;
    vi.mocked(fetchPathFinderJob).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<PathFinderRecalculateAll {...props} />); fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(fetchPathFinderJob).toHaveBeenCalledOnce());
    const signal = vi.mocked(fetchPathFinderJob).mock.calls[0][3]!;
    view.rerender(<PathFinderRecalculateAll {...props} projectId={id(99)} />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish(makeJob('complete', [item('calculated', 'written')])));
    expect(screen.queryByText(/Background recalculation finished/)).toBeNull(); expect(props.onChanged).not.toHaveBeenCalled();
  });
});
