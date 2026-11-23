import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLegacyBulkCalculationJob, fetchPathFinderJob, PathFinderApiError, submitAllPathFinderCalculations, type PathFinderCable, type PathFinderJob, type PathFinderState } from '@/api/pathfinder';
import { barrierCalculationFixture } from '@/test/pathfinderBarrierFixtures';
import { calculationAvailabilitySchema, missingCalculationLocationsMessage, notEvaluatedCalculationAvailability } from '../../../shared/pathfinderCalculationAvailability';
import { AUTOMATIC_PAIR_POLICY } from '../../../shared/pathfinderAutomaticPair';
import { collectFilteredCableIds } from '@/api/pathfinderCableWorkflow';
import { backgroundCalculationCounts, PathFinderRecalculateAll, PathFinderRecalculationIssueList, useFilteredCableRecalculation } from './PathFinderRecalculateAll';
vi.mock('@/api/pathfinder', async original => ({ ...await original<typeof import('@/api/pathfinder')>(), fetchLegacyBulkCalculationJob: vi.fn(), fetchPathFinderJob: vi.fn(), submitAllPathFinderCalculations: vi.fn() }));
vi.mock('@/api/pathfinderCableWorkflow', async original => ({ ...await original<typeof import('@/api/pathfinderCableWorkflow')>(), collectFilteredCableIds: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const storageKey = `wfc.recalculate-all:${id(1)}:${id(2)}`;
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

const filteredQuery = { filter: 'all', search: 'JB_Prod12_01', limit: 100, secondaryDistanceMeters: 2, preferVerticalApproach: true } as const;
const filterContext = 'b'.repeat(64);
function FilteredAction() {
  const action = useFilteredCableRecalculation()!;
  return <><button disabled={action.disabled} onClick={() => void action.start({ query: filteredQuery, contextSha256: filterContext })}>Recalculate filtered cables</button>{action.progress}</>;
}
describe('filtered background recalculation', () => {
  it('shows grouped server reasons for cables skipped before calculation', async () => {
    const props = setup(), ids = [id(30), id(31), id(32)];
    const location = { ...item('locations_required'), state: 'blocked', message: 'Resolve From locations.' };
    vi.mocked(collectFilteredCableIds).mockResolvedValue(ids);
    vi.mocked(fetchPathFinderJob).mockResolvedValue(makeJob('complete', [
      location, { ...location, cableId: ids[1] },
      { ...item('no_path'), cableId: ids[2], message: 'No connected path was found.' },
    ]));
    render(<PathFinderRecalculateAll {...props}><FilteredAction /></PathFinderRecalculateAll>);
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate filtered cables' }));
    const reasons = await screen.findByRole('list', { name: 'Skipped or failed calculations' });
    expect(reasons).toHaveTextContent('2 cables · Resolve From locations.');
    expect(reasons).toHaveTextContent('1 cable · No connected path was found.');
  });
  it('submits the collected set and retries that exact set without collecting again', async () => {
    const props = setup(), onReviewReady = vi.fn(), ids = [id(30), id(32)];
    vi.mocked(collectFilteredCableIds).mockResolvedValue(ids);
    vi.mocked(submitAllPathFinderCalculations).mockResolvedValueOnce({ kind: 'unknown', code: 'CALCULATION_SUBMISSION_UNKNOWN' });
    vi.mocked(fetchPathFinderJob).mockResolvedValue(makeJob('complete', [item('calculated', 'review-required')]));
    render(<PathFinderRecalculateAll {...props} onReviewReady={onReviewReady}><FilteredAction /></PathFinderRecalculateAll>);
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate filtered cables' }));
    const retry = await screen.findByRole('button', { name: 'Retry same recalculation request' });
    const request = JSON.parse(localStorage.getItem(storageKey)!);
    expect(request.cableIds).toEqual(ids);
    expect(collectFilteredCableIds).toHaveBeenCalledExactlyOnceWith(id(1), 'token', filteredQuery, filterContext, expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeDisabled();
    fireEvent.click(retry);
    await screen.findByText('Background recalculation finished.');
    expect(submitAllPathFinderCalculations).toHaveBeenCalledTimes(2);
    expect(vi.mocked(submitAllPathFinderCalculations).mock.calls.map(call => call[2])).toEqual([request, request]);
    expect(collectFilteredCableIds).toHaveBeenCalledOnce();
    expect(localStorage.getItem(storageKey)).toBe(`filtered:${id(20)}`);
    expect(onReviewReady).not.toHaveBeenCalled();
    expect(props.onChanged).toHaveBeenCalled();
  });
  it('creates no job for an empty filtered set', async () => {
    const props = setup();
    vi.mocked(collectFilteredCableIds).mockResolvedValue([]);
    render(<PathFinderRecalculateAll {...props}><FilteredAction /></PathFinderRecalculateAll>);
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate filtered cables' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No cables match the applied filters.');
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});

describe('whole-project background pass', () => {
  it('submits all cables exactly once with fresh registry and automatic output policy, without waiting for the engine', async () => {
    const props = setup(); render(<PathFinderRecalculateAll {...props} />);
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate all the cables' }));
    await waitFor(() => expect(fetchPathFinderJob).toHaveBeenCalled());
    expect(submitAllPathFinderCalculations).toHaveBeenCalledExactlyOnceWith(id(1), 'token', {
      submissionId: expect.any(String),
      expectedRegistryRevision: '12', force: true, automaticPairPolicy: AUTOMATIC_PAIR_POLICY,
      options: { connectionToleranceMeters: 1.5, sampleSpacingMeters: 0.125, maxGraphNodes: 200000, maxGraphConnections: 1000000, ...preferences },
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText(/Recalculating cables in the background/)).toBeVisible();
    expect(screen.getByRole('button')).toBeDisabled(); expect(props.refreshState).toHaveBeenCalledOnce();
  });
  it('continues GET-only polling after calculation completion until automatic saves finish', async () => {
    vi.useFakeTimers(); const props = setup(), onReviewReady = vi.fn();
    vi.mocked(fetchPathFinderJob).mockResolvedValueOnce(makeJob('complete', [item('calculated', 'pending'), item('calculated', 'review-required')]))
      .mockResolvedValue(makeJob('complete', [item('calculated', 'written'), item('missing_from'), item('calculated', 'review-required')]));
    render(<PathFinderRecalculateAll {...props} onReviewReady={onReviewReady} />);
    await act(async () => fireEvent.click(screen.getByRole('button')));
    expect(screen.getByText(/Saving calculated routes/)).toBeVisible(); expect(screen.getByRole('button')).toBeDisabled();
    expect(onReviewReady).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText(/Background recalculation finished/)).toBeVisible(); expect(screen.getByRole('button')).toBeEnabled();
    expect(screen.getByText(/saved: 1; saving: 0; need review: 1; skipped or failed: 1/)).toBeVisible();
    expect(onReviewReady).toHaveBeenCalledExactlyOnceWith(id(20));
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
  it('shows the server preparation timeout and preserves the original request for retry', async () => {
    const props = setup();
    vi.mocked(submitAllPathFinderCalculations).mockResolvedValue({ kind: 'unknown', code: 'RECALCULATION_COLLECTION_DEADLINE' });
    render(<PathFinderRecalculateAll {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate all the cables' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('time limit while preparing the cable list');
    expect(screen.getByRole('button', { name: 'Retry same recalculation request' })).toBeEnabled();
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(vi.mocked(submitAllPathFinderCalculations).mock.calls[0][2]);
  });
  it('does not call manual or uncertain output saved', () => {
    expect(backgroundCalculationCounts(makeJob('complete', [item('calculated'), item('calculated', 'unknown'), item('calculated', 'review-required')]))).toMatchObject({ saved: 0, review: 1, unsaved: 2 });
    expect(backgroundCalculationCounts(makeJob('complete', [{ ...item('locations_required'), state: 'blocked' }]))).toMatchObject({ blocked: 1, calculated: 0 });
    expect(backgroundCalculationCounts(makeJob('complete', [item('calculated', 'unchanged')]))).toMatchObject({ unchanged: 1, saved: 0, unsaved: 0, pendingUpdates: 0 });
  });
  it('distinguishes a retained manual route from expired writes with and without existing routes', async () => {
    const props = setup(), onReviewReady = vi.fn();
    vi.mocked(fetchPathFinderJob).mockResolvedValue(makeJob('complete', [
      { ...item('calculated', 'review-required'), retainedRoute: 'manual',
        automaticUpdate: { status: 'review-required', receiptId: null, reasonCode: 'ROUTING_MANUAL_PROTECTED' } },
      { ...item('calculated', 'authority-expired'), retainedRoute: 'saved' },
      { ...item('calculated', 'authority-expired'), retainedRoute: 'none' },
    ]));
    render(<PathFinderRecalculateAll {...props} onReviewReady={onReviewReady} />);
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate all the cables' }));
    expect(await screen.findByText('Permission to save automatically expired (2 cables). 1 with an existing route in Cable list, 1 without a saved route.')).toBeVisible();
    expect(screen.getByText('Protected manual route (1 cable). 1 with a retained manual route.')).toBeVisible();
    expect(screen.getByText(/need review: 0;.*not saved by this run: 2/)).toBeVisible();
    expect(onReviewReady).not.toHaveBeenCalled();
  });
  it('opens each result group with its own paginated cables even when diagnostics are unavailable', async () => {
    const props = setup(), openCable = vi.fn(() => true);
    localStorage.setItem(storageKey, id(20));
    const cables = Array.from({ length: 54 }, (_, index) => ({
      id: id(100 + index), cableId: index + 1, tag: `C-${index + 1}`, fromLocation: 'Panel A', toLocation: 'Panel B',
    } as PathFinderCable));
    const blocked = cables.slice(0, 51).map(cable => ({
      ...item('locations_required'), cableId: cable.id, state: 'blocked', message: 'Resolve From locations.',
    }));
    const job = makeJob('complete', [
      ...blocked,
      { ...item('locations_required'), cableId: cables[51].id, state: 'blocked', message: 'Resolve To locations.' },
      { ...item('calculated', 'authority-expired'), cableId: cables[52].id },
      { ...item('calculated', 'written'), cableId: cables[53].id },
    ]);
    vi.mocked(fetchPathFinderJob).mockResolvedValue({ ...job, total: cables.length });
    render(<PathFinderRecalculateAll {...props}>
      <p role="alert">Cable diagnostics are unavailable.</p>
      <PathFinderRecalculationIssueList cables={cables} onOpenCable={openCable} />
    </PathFinderRecalculateAll>);

    const from = await screen.findByRole('button', { name: 'Show cables: Resolve From locations.' });
    fireEvent.click(from);
    expect(screen.getByRole('heading', { name: 'Cables by recalculation result' })).toHaveFocus();
    const table = screen.getByRole('table', { name: 'Cables in the selected result group' });
    expect(within(table).getAllByRole('button')).toHaveLength(50);
    expect(within(table).queryByRole('link')).toBeNull();
    fireEvent.click(within(table).getByRole('button', { name: 'C-1' }));
    expect(openCable).toHaveBeenCalledExactlyOnceWith(cables[0]);
    expect(within(table).queryByRole('button', { name: 'C-51' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next cables' }));
    expect(within(table).getAllByRole('button').map(button => button.textContent)).toEqual(['C-51']);

    fireEvent.click(screen.getByRole('button', { name: 'Show cables: Resolve To locations.' }));
    expect(within(screen.getByRole('table')).getAllByRole('button').map(button => button.textContent)).toEqual(['C-52']);
    const expired = screen.getByRole('button', { name: 'Show cables: Permission to save automatically expired' });
    fireEvent.click(expired);
    expect(within(screen.getByRole('table')).getAllByRole('button').map(button => button.textContent)).toEqual(['C-53']);
    fireEvent.click(screen.getByRole('button', { name: 'Close cable list' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(expired).toHaveFocus();
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
  });
  it('updates every cable sharing an assigned From point and retains unresolved routing issues', async () => {
    const props = setup();
    localStorage.setItem(storageKey, id(20));
    const ready = calculationAvailabilitySchema.parse({
      status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location',
      approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false,
    });
    const location = (n: number, calculationAvailability: typeof ready) => ({
      id: id(n), name: String(n), aliases: [], revision: '1', binding: null, calculationAvailability,
    });
    const matched = (n: number) => ({ status: 'matched' as const, locationId: id(n), candidates: [id(n)] });
    const missing = { status: 'missing' as const, locationId: null, candidates: [] };
    const shared: PathFinderCable[] = Array.from({ length: 10 }, (_, index) => ({
      id: id(100 + index), cableId: index + 1, tag: 'Shared cable ' + (index + 1),
      fromLocation: 'Shared source', toLocation: 'Destination', fromMatch: missing, toMatch: matched(81),
      mto: 'Control', routing: null, designLength: null, installLength: null, cableWriteRevision: '0',
    }));
    const partial = { ...shared[0], id: id(110), cableId: 11, tag: 'Still missing To', toLocation: null, toMatch: missing };
    const noPath = { ...shared[0], id: id(111), cableId: 12, tag: 'Blocked route' };
    const blocked = (cable: PathFinderCable, side: 'From' | 'From and To') => ({
      ...item('locations_required'), state: 'blocked', cableId: cable.id, message: missingCalculationLocationsMessage(side),
    });
    const job = makeJob('complete', [
      ...shared.map(cable => blocked(cable, 'From')),
      blocked(partial, 'From and To'),
      { ...item('no_path'), cableId: noPath.id, message: 'No connected path was found.' },
    ]);
    vi.mocked(fetchPathFinderJob).mockResolvedValue({ ...job, total: job.completed });

    const show = (cables: PathFinderCable[], fromAvailability?: typeof ready) => <PathFinderRecalculateAll {...props}
      endpointState={{ cables, locations: [location(81, ready), ...(fromAvailability ? [location(80, fromAvailability)] : [])] }}>
      <PathFinderRecalculationIssueList cables={cables} onOpenCable={() => true} />
    </PathFinderRecalculateAll>;
    const view = render(show([...shared, partial, noPath]));
    fireEvent.click(await screen.findByRole('button', { name: 'Show cables: ' + missingCalculationLocationsMessage('From') }));
    const result = screen.getByRole('region', { name: 'Cables by recalculation result' });
    expect(within(result).getByText('Showing 1–10 of 10 cables')).toBeVisible();

    const updated = [...shared, partial, noPath].map(cable => ({ ...cable, fromMatch: matched(80) }));
    view.rerender(show(updated, notEvaluatedCalculationAvailability()));
    expect(within(result).getByText('Showing 1–10 of 10 cables')).toBeVisible();
    view.rerender(show(updated, ready));
    expect(within(result).getByText('No cables remain in this group.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Show cables: ' + missingCalculationLocationsMessage('From') })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show cables: ' + missingCalculationLocationsMessage('From and To') })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show cables: ' + missingCalculationLocationsMessage('To') }));
    expect(within(screen.getByRole('table')).getByRole('button', { name: partial.tag! })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show cables: No connected path was found.' }));
    expect(within(screen.getByRole('table')).getByRole('button', { name: noPath.tag! })).toBeVisible();
    expect(fetchPathFinderJob).toHaveBeenCalledOnce();
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
  });
  it('retries the identical command after reopening with uncertain admission', async () => {
    const props = setup(); vi.mocked(submitAllPathFinderCalculations).mockResolvedValue({ kind: 'unknown', code: 'CALCULATION_SUBMISSION_UNKNOWN' });
    const view = render(<PathFinderRecalculateAll {...props} />); fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not confirmed'));
    const submitted = vi.mocked(submitAllPathFinderCalculations).mock.calls[0][2];
    view.unmount(); render(<PathFinderRecalculateAll {...props} modelKey="another-model-revision" />);
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeDisabled();
    expect(submitAllPathFinderCalculations).toHaveBeenCalledOnce();
    vi.mocked(submitAllPathFinderCalculations).mockResolvedValue({ kind: 'acknowledged', jobId: id(20), registryRevision: '12', duplicate: true });
    fireEvent.click(screen.getByRole('button', { name: 'Retry same recalculation request' }));
    await waitFor(() => expect(fetchPathFinderJob).toHaveBeenCalled());
    expect(vi.mocked(submitAllPathFinderCalculations).mock.calls[1][2]).toEqual(submitted);
    expect(props.refreshState).toHaveBeenCalledOnce();
  });
  it('reconciles old pending markers with the server without starting a new pass', async () => {
    const props = setup(); localStorage.setItem(storageKey, 'pending');
    vi.mocked(fetchLegacyBulkCalculationJob).mockResolvedValue(id(20));
    render(<PathFinderRecalculateAll {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find previous recalculation' }));
    await waitFor(() => expect(fetchPathFinderJob).toHaveBeenCalledWith(id(1), 'token', id(20), expect.any(AbortSignal)));
    expect(localStorage.getItem(storageKey)).toBe(id(20));
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
  });
  it('unlocks a legacy marker when the server has no previous bulk job to recover', async () => {
    const props = setup(); localStorage.setItem(storageKey, 'pending');
    vi.mocked(fetchLegacyBulkCalculationJob).mockResolvedValue(null);
    render(<PathFinderRecalculateAll {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find previous recalculation' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeEnabled());
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(submitAllPathFinderCalculations).not.toHaveBeenCalled();
  });
  it('allows a fresh pass when the server confirms a saved job ID is unavailable', async () => {
    const props = setup(); localStorage.setItem(storageKey, id(20));
    vi.mocked(fetchPathFinderJob).mockRejectedValue(new PathFinderApiError('JOB_NOT_FOUND', 404));
    render(<PathFinderRecalculateAll {...props} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(screen.getByRole('button', { name: 'Recalculate all the cables' })).toBeEnabled();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
  it('explains how to proceed when stale network preparation blocks every cable', async () => {
    const props = setup();
    const blocked = [30, 31, 32].map(n => ({ ...item('routing_preparation_required'), cableId: id(n), state: 'blocked' as const }));
    vi.mocked(fetchPathFinderJob).mockResolvedValue(makeJob('complete', blocked));
    render(<PathFinderRecalculateAll {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate all the cables' }));
    expect(await screen.findByText(/Open Routes and choose Regenerate network/)).toBeVisible();
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
