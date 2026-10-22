import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePathFinder } from './usePathFinder';
import { fetchPathFinderState, fetchPathFinderLookupPlan, fetchPathFinderProposal, fetchPathFinderJob, pathFinderRequest, submitPathFinderCalculation, PathFinderApiError, type PathFinderState, type PathFinderProposal, type PathFinderPreferences } from '@/api/pathfinder';
import { fetchProjectModels } from '@/api/projectModels';
import { ViewerAccessError } from '@/viewer/sessionApi';
import type { ViewerController } from '@/viewer/ViewerController';
import { BARRIER_CAPTURE_ERROR_CODES, BARRIER_CAPTURE_ERROR_MESSAGES, barrierCaptureErrorMessage } from '../../../../viewer-runtime/barrier-capture-errors.mjs';

const facts = vi.hoisted(() => ({ disposed: vi.fn(), load: vi.fn(), capture: vi.fn(), barrierCapture: vi.fn(), barrierPublish: vi.fn(), readSelection: vi.fn(), transparency: vi.fn(), clear: vi.fn(), cancelPicking: vi.fn(), instances: 0, events: [] as ((event: { type: string; payload: Record<string, unknown> }) => void)[] }));
vi.mock('@/api/pathfinder', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/pathfinder')>();
  return { ...original, fetchPathFinderState: vi.fn(), fetchPathFinderLookupPlan: vi.fn(), fetchPathFinderProposal: vi.fn(), fetchPathFinderJob: vi.fn(), pathFinderRequest: vi.fn(), submitPathFinderCalculation: vi.fn() };
});
vi.mock('@/api/projectModels', () => ({ fetchProjectModels: vi.fn() }));
vi.mock('@/viewer/ViewerController', () => ({ ViewerController: class {
  constructor(options: { onEvent: (event: { type: string; payload: Record<string, unknown> }) => void }) { facts.instances++; facts.events.push(options.onEvent); } dispose = facts.disposed; load = facts.load;
  readSelection = facts.readSelection; setPathTransparency = facts.transparency; clear = facts.clear; cancelPicking = facts.cancelPicking;
  captureModel = facts.capture; getLoadSnapshot = () => ({ ready: true });
  captureBarriers = facts.barrierCapture; publishBarriers = facts.barrierPublish;
} }));
const projectId = '11111111-1111-4111-8111-111111111111', modelId = '22222222-2222-4222-8222-222222222222', locationId = '33333333-3333-4333-8333-333333333333';
function barrierRequest(): Parameters<ViewerController['captureBarriers']>[0] { return {
  captureId: locationId, scope: { projectId, modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64),
    captureFrameId: '44444444-4444-4444-8444-444444444444', captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' },
  selectedParents: [{ selectionId: '55555555-5555-4555-8555-555555555555', kind: 'wall', objectId: 'dbid:44', dbId: 44,
    externalId: null, name: 'Synthetic selected wall', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }],
}; }
function state(): PathFinderState { return { schemaVersion: 1, projectId, registryRevision: '3', activeModel: { modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) },
  settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '4', endConnectionLength: '2', additionalBendingPercent: '5' }, cables: [], artifacts: [], jobs: [], proposals: [],
  locations: [{ id: locationId, name: 'EQ-001', aliases: ['Equipment A'], revision: '1', binding: null }] }; }
let container: { current: HTMLDivElement };
beforeEach(() => {
  vi.clearAllMocks(); facts.instances = 0; facts.events.length = 0; container = { current: document.createElement('div') }; document.body.append(container.current);
  vi.mocked(fetchPathFinderState).mockResolvedValue(state()); vi.mocked(pathFinderRequest).mockResolvedValue({ locationId });
  vi.mocked(submitPathFinderCalculation).mockReset().mockResolvedValue({ kind: 'acknowledged', jobId: locationId, registryRevision: '8', duplicate: false });
  vi.mocked(fetchPathFinderProposal).mockReset(); vi.mocked(fetchPathFinderJob).mockReset();
  vi.mocked(fetchPathFinderLookupPlan).mockReset().mockResolvedValue({ routeCodes: ['/BC1', '/BC2'], selectionRevision: '2', connectionGap: '0.250' });
  facts.capture.mockReset().mockResolvedValue({ snapshot: { lookup: 'owned-protected-capture' }, summary: {} });
  facts.barrierCapture.mockReset().mockResolvedValue({ capture: { fixture: 'opaque protected barrier observation' }, frameObservation: {} });
  facts.barrierPublish.mockReset().mockResolvedValue({ fixture: 'opaque protected publication receipt' });
  vi.mocked(fetchProjectModels).mockResolvedValue({ selection: { projectId, activeModelVersionId: modelId, selectionRevision: 2, updatedAt: '2026-10-18T00:00:00Z' }, versions: [{ id: modelId, projectId, label: 'Model', source: { name: 'test.nwd', bytes: 1, sha256: 'a'.repeat(64), identityBasis: 'observed-local-file' }, preparedAt: '2026-10-18T00:00:00Z', importedAt: null, state: 'ready', health: 'healthy' }] });
});

describe('fresh popup calculation submission without Viewer appearance changes', () => {
  const mount = () => renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container, automaticStatePolling: false }));
  const preferences = (): PathFinderPreferences => ({ secondaryDistanceMeters: 2, preferVerticalApproach: true,
    barrierRouting: { schemaVersion: 'wfc.pf.barrier-admission-intent.v1', scope: barrierRequest().scope,
      expectedRegistryRevision: '0', expectedSnapshot: null, drillThroughWalls: true } });
  it('refreshes a changed endpoint registry once before the sole POST and keeps the same Viewer', async () => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1));
    vi.mocked(fetchPathFinderState).mockResolvedValueOnce({ ...state(), registryRevision: '8', settings: { ...state().settings, revision: '2', connectionGap: '0.250' } });
    let result: Awaited<ReturnType<typeof view.result.current.submitCalculation>> | undefined;
    await act(async () => { result = await view.result.current.submitCalculation([locationId], preferences()); });
    expect(result).toEqual({ kind: 'acknowledged', jobId: locationId, registryRevision: '8', duplicate: false });
    expect(fetchPathFinderState).toHaveBeenCalledTimes(2);
    expect(submitPathFinderCalculation).toHaveBeenCalledExactlyOnceWith(projectId, 'token', expect.objectContaining({ cableIds: [locationId], expectedRegistryRevision: '8', force: true,
      options: expect.objectContaining({ connectionToleranceMeters: 0.25, secondaryDistanceMeters: 2 }) }), expect.objectContaining({ signal: expect.any(AbortSignal), isCurrent: expect.any(Function) }));
    expect(vi.mocked(fetchPathFinderState).mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(submitPathFinderCalculation).mock.invocationCallOrder[0]);
    expect(pathFinderRequest).not.toHaveBeenCalled(); expect(facts.instances).toBe(1); expect(facts.disposed).not.toHaveBeenCalled(); expect(facts.clear).not.toHaveBeenCalled(); expect(facts.transparency).not.toHaveBeenCalled();
    view.unmount();
  });
  it('reports a failed preflight read as positively not submitted', async () => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1));
    vi.mocked(fetchPathFinderState).mockRejectedValueOnce(new PathFinderApiError('TEMPORARY_READ_FAILURE', 503));
    await act(async () => { expect(await view.result.current.submitCalculation([locationId], preferences())).toEqual({ kind: 'not-submitted', code: 'CALCULATION_PREFLIGHT_FAILED' }); });
    expect(submitPathFinderCalculation).not.toHaveBeenCalled(); expect(view.result.current.busy).toBe(false); view.unmount();
  });
  it.each(['model', 'selection', 'fingerprint'] as const)('does not POST across a %s change discovered by the fresh read', async field => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1));
    const next = state(); if (field === 'model') next.activeModel.modelVersionId = locationId;
    if (field === 'selection') next.activeModel.selectionRevision = '77'; if (field === 'fingerprint') next.activeModel.contentFingerprint = 'f'.repeat(64);
    vi.mocked(fetchPathFinderState).mockResolvedValueOnce(next);
    await act(async () => { expect((await view.result.current.submitCalculation([locationId], preferences())).kind).toBe('not-submitted'); });
    expect(submitPathFinderCalculation).not.toHaveBeenCalled(); view.unmount();
  });
  it('freezes cable IDs and preferences before waiting for current state', async () => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1));
    let finish!: (value: PathFinderState) => void; vi.mocked(fetchPathFinderState).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const ids = [locationId], draft = preferences(); let pending!: ReturnType<typeof view.result.current.submitCalculation>;
    act(() => { pending = view.result.current.submitCalculation(ids, draft); });
    ids[0] = modelId; draft.secondaryDistanceMeters = 99; draft.barrierRouting!.drillThroughWalls = false;
    await act(async () => { finish({ ...state(), registryRevision: '8' }); await pending; });
    expect(submitPathFinderCalculation).toHaveBeenCalledWith(projectId, 'token', expect.objectContaining({ cableIds: [locationId],
      options: expect.objectContaining({ secondaryDistanceMeters: 2, barrierRouting: expect.objectContaining({ drillThroughWalls: true }) }) }), expect.any(Object));
    view.unmount();
  });
  it('does not borrow a fresh response from an earlier authenticated owner', async () => {
    const view = renderHook(({ token }) => usePathFinder({ projectId, loadedProjectId: projectId, token, isAdmin: true, container, automaticStatePolling: false }), { initialProps: { token: 'old-token' } });
    await waitFor(() => expect(facts.instances).toBe(1)); let finish!: (value: PathFinderState) => void;
    vi.mocked(fetchPathFinderState).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: ReturnType<typeof view.result.current.submitCalculation>; act(() => { pending = view.result.current.submitCalculation([locationId], preferences()); });
    view.rerender({ token: 'new-token' }); await act(async () => { finish(state()); expect((await pending).kind).toBe('not-submitted'); });
    expect(submitPathFinderCalculation).not.toHaveBeenCalled(); view.unmount();
  });
  it('retains a positive ACK independently of a later failing state refresh', async () => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1));
    vi.mocked(fetchPathFinderState).mockResolvedValueOnce({ ...state(), registryRevision: '8' }).mockRejectedValueOnce(new PathFinderApiError('READ_FAILED', 503));
    let result: Awaited<ReturnType<typeof view.result.current.submitCalculation>> | undefined;
    await act(async () => { result = await view.result.current.submitCalculation([locationId], preferences()); });
    expect(result?.kind).toBe('acknowledged'); expect(fetchPathFinderState).toHaveBeenCalledTimes(2);
    await act(async () => { view.result.current.refresh(); });
    expect(result?.kind).toBe('acknowledged'); expect(submitPathFinderCalculation).toHaveBeenCalledOnce(); view.unmount();
  });
  it.each(['not-submitted', 'rejected', 'unknown'] as const)('preserves typed %s evidence without generic perform swallowing it', async kind => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1));
    const outcome = kind === 'rejected' ? { kind, status: 409 as const, code: 'REGISTRY_CONFLICT' } : { kind, code: 'SYNTHETIC_PHASE_EVIDENCE' };
    vi.mocked(submitPathFinderCalculation).mockResolvedValueOnce(outcome);
    await act(async () => { expect(await view.result.current.submitCalculation([locationId], preferences())).toEqual(outcome); });
    expect(submitPathFinderCalculation).toHaveBeenCalledOnce(); expect(pathFinderRequest).not.toHaveBeenCalled(); view.unmount();
  });
});
describe('bounded detail inspection and state polling', () => {
  const mount = (automaticStatePolling?: boolean) => renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container, automaticStatePolling }));
  const detail = (): PathFinderProposal => ({ id: locationId, projectId, cableId: modelId, jobId: projectId, status: 'calculated',
    proposalHash: 'b'.repeat(64), cableWriteRevision: '9', stale: false, synthetic: false, engineeringAccepted: false,
    acceptanceScope: 'manual-review', canApply: true, compatibilityIssue: null, message: 'Review required.', engineeringMessage: 'Manual review required.',
    design: { lengthBeforePercentageMeters: '10', unroundedLengthMeters: '11', designLengthMeters: '11' }, route: null,
    routingPreferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, createdAt: '2026-10-20T00:00:00Z' });
  it.each(['proposal', 'job'] as const)('returns a %s GET without another full state read or global busy lock', async kind => {
    const view = mount(); await waitFor(() => expect(view.result.current.data).not.toBeNull());
    const reads = vi.mocked(fetchPathFinderState).mock.calls.length;
    const value = kind === 'proposal' ? detail() : { id: locationId };
    if (kind === 'proposal') vi.mocked(fetchPathFinderProposal).mockResolvedValueOnce(value as PathFinderProposal);
    else vi.mocked(fetchPathFinderJob).mockResolvedValueOnce(value as Awaited<ReturnType<typeof fetchPathFinderJob>>);
    // A full state refresh would stall inspection indefinitely.
    vi.mocked(fetchPathFinderState).mockImplementation(() => new Promise(() => {}));
    await act(async () => { expect(await (kind === 'proposal' ? view.result.current.readProposal(locationId) : view.result.current.readJob(locationId))).toEqual(value); });
    expect(fetchPathFinderState).toHaveBeenCalledTimes(reads); expect(view.result.current.busy).toBe(false); expect(facts.disposed).not.toHaveBeenCalled(); view.unmount();
  });
  it.each(['proposal', 'job'] as const)('preserves the protected model when a selected %s no longer exists', async kind => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1));
    act(() => facts.events[0]({ type: 'MODEL_LOADED', payload: {} }));
    const failure = new PathFinderApiError(kind === 'proposal' ? 'PROPOSAL_NOT_FOUND' : 'JOB_NOT_FOUND', 404);
    if (kind === 'proposal') vi.mocked(fetchPathFinderProposal).mockRejectedValueOnce(failure); else vi.mocked(fetchPathFinderJob).mockRejectedValueOnce(failure);
    await act(async () => { expect(await (kind === 'proposal' ? view.result.current.readProposal(locationId) : view.result.current.readJob(locationId))).toBeNull(); });
    expect(view.result.current.data).not.toBeNull(); expect(view.result.current.viewerPhase).toBe('ready');
    expect(view.result.current.error).toContain('result is no longer available'); expect(facts.disposed).not.toHaveBeenCalled(); view.unmount();
  });
  it.each([401, 403])('still clears data and the protected model on a current detail authority refusal (%s)', async status => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1));
    vi.mocked(fetchPathFinderProposal).mockRejectedValueOnce(new PathFinderApiError('ADMIN_REQUIRED', status));
    await act(() => view.result.current.readProposal(locationId));
    expect(view.result.current.data).toBeNull(); expect(view.result.current.viewerPhase).toBe('error'); expect(facts.disposed).toHaveBeenCalledWith('reload'); view.unmount();
  });
  it('retains the terminal project-not-found boundary when a detail request loses its project scope', async () => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1));
    vi.mocked(fetchPathFinderProposal).mockRejectedValueOnce(new PathFinderApiError('PROJECT_NOT_FOUND', 404));
    await act(() => view.result.current.readProposal(locationId));
    expect(view.result.current.data).toBeNull(); expect(view.result.current.viewerPhase).toBe('error'); expect(facts.disposed).toHaveBeenCalledWith('reload'); view.unmount();
  });
  it('aborts a superseded proposal read and ignores its late response without another model load', async () => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1));
    let finish!: (value: PathFinderProposal) => void;
    vi.mocked(fetchPathFinderProposal).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(detail());
    let first!: ReturnType<typeof view.result.current.readProposal>, second!: ReturnType<typeof view.result.current.readProposal>;
    act(() => { first = view.result.current.readProposal(modelId); });
    const oldSignal = vi.mocked(fetchPathFinderProposal).mock.calls[0][3]!;
    await act(async () => { second = view.result.current.readProposal(locationId); expect(await first).toBeNull(); expect(await second).toEqual(detail()); });
    expect(oldSignal.aborted).toBe(true);
    await act(async () => finish({ ...detail(), id: modelId }));
    expect(view.result.current.error).toBeNull(); expect(facts.instances).toBe(1); expect(facts.disposed).not.toHaveBeenCalled(); view.unmount();
  });
  it('releases an unresponsive detail read at its deadline and ignores the late rejection', async () => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1));
    vi.useFakeTimers(); let reject!: (error: Error) => void;
    vi.mocked(fetchPathFinderProposal).mockImplementationOnce(() => new Promise((_resolve, refuse) => { reject = refuse; }));
    let pending!: ReturnType<typeof view.result.current.readProposal>;
    try {
      act(() => { pending = view.result.current.readProposal(locationId); });
      await act(async () => { await vi.advanceTimersByTimeAsync(30_001); expect(await pending).toBeNull(); });
      expect(view.result.current.error).toContain('took too long'); expect(view.result.current.busy).toBe(false); expect(facts.disposed).not.toHaveBeenCalled();
      await act(async () => reject(new Error('late transport failure'))); expect(view.result.current.error).toContain('took too long');
    } finally { view.unmount(); vi.useRealTimers(); }
  });
  it('cancels detail inspection explicitly without treating it as access loss', async () => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1));
    vi.mocked(fetchPathFinderProposal).mockImplementationOnce(() => new Promise(() => {}));
    let pending!: ReturnType<typeof view.result.current.readProposal>;
    act(() => { pending = view.result.current.readProposal(locationId); });
    await act(async () => { view.result.current.cancelOperation(); expect(await pending).toBeNull(); });
    expect(view.result.current.error).toBeNull(); expect(facts.disposed).not.toHaveBeenCalled(); view.unmount();
  });
  it('does not refresh all state after an exact review or a batch-owned action, while normal mutations still refresh', async () => {
    const view = mount(); await waitFor(() => expect(facts.instances).toBe(1)); const reads = vi.mocked(fetchPathFinderState).mock.calls.length;
    vi.mocked(pathFinderRequest).mockResolvedValueOnce({ reviewId: modelId, proposal: detail() });
    await act(async () => expect(await view.result.current.reviewProposal(detail())).toEqual({ reviewId: modelId, proposal: detail() }));
    expect(fetchPathFinderState).toHaveBeenCalledTimes(reads);
    vi.mocked(pathFinderRequest).mockResolvedValueOnce({ receipt: 'exact-server-receipt' });
    await act(async () => expect(await view.result.current.actionWithoutRefresh(`/proposals/${locationId}/apply`, { exact: 'retained-command' })).toEqual({ receipt: 'exact-server-receipt' }));
    expect(fetchPathFinderState).toHaveBeenCalledTimes(reads);
    await act(() => view.result.current.matchAll()); expect(fetchPathFinderState).toHaveBeenCalledTimes(reads + 1); view.unmount();
  });
  it('uses one completion-scheduled poll and serializes one fresh explicit read after an older active poll', async () => {
    vi.useFakeTimers();
    const running = { ...state(), jobs: [{ id: locationId, projectId, status: 'running' as const, total: 1, completed: 0, cancelRequested: false, failure: null, attempts: 1, createdAt: '', updatedAt: '' }] };
    vi.mocked(fetchPathFinderState).mockResolvedValue(running); const view = mount();
    try {
      await act(async () => {}); expect(view.result.current.data).not.toBeNull();
      let finish!: (value: PathFinderState) => void;
      vi.mocked(fetchPathFinderState).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      await act(() => vi.advanceTimersByTimeAsync(2000)); expect(fetchPathFinderState).toHaveBeenCalledTimes(2);
      act(() => { view.result.current.refresh(); view.result.current.refresh(); });
      await act(() => vi.advanceTimersByTimeAsync(10_000)); expect(fetchPathFinderState).toHaveBeenCalledTimes(2);
      await act(async () => finish(running));
      expect(fetchPathFinderState).toHaveBeenCalledTimes(3);
      await act(() => vi.advanceTimersByTimeAsync(1999)); expect(fetchPathFinderState).toHaveBeenCalledTimes(3);
      await act(() => vi.advanceTimersByTimeAsync(1)); expect(fetchPathFinderState).toHaveBeenCalledTimes(4);
    } finally { view.unmount(); vi.useRealTimers(); }
  });
  it.each([false, true])('does not poll full state when disabled, including active jobs=%s', async active => {
    vi.useFakeTimers(); const current = state();
    if (active) current.jobs = [{ id: locationId, projectId, status: 'running', total: 1, completed: 0, cancelRequested: false, failure: null, attempts: 1, createdAt: '', updatedAt: '' }];
    vi.mocked(fetchPathFinderState).mockResolvedValue(current); const view = mount(false);
    try {
      await act(async () => {}); expect(view.result.current.data).toEqual(current); expect(facts.instances).toBe(1);
      await act(() => vi.advanceTimersByTimeAsync(60_000)); expect(fetchPathFinderState).toHaveBeenCalledOnce();
      expect(view.result.current.busy).toBe(false); expect(facts.disposed).not.toHaveBeenCalled();
    } finally { view.unmount(); vi.useRealTimers(); }
  });
  it('keeps the legacy idle fifteen-second poll by default', async () => {
    vi.useFakeTimers(); const view = mount();
    try {
      await act(async () => {}); expect(fetchPathFinderState).toHaveBeenCalledOnce();
      await act(() => vi.advanceTimersByTimeAsync(14_999)); expect(fetchPathFinderState).toHaveBeenCalledOnce();
      await act(() => vi.advanceTimersByTimeAsync(1)); expect(fetchPathFinderState).toHaveBeenCalledTimes(2);
      expect(facts.instances).toBe(1); expect(facts.disposed).not.toHaveBeenCalled();
    } finally { view.unmount(); vi.useRealTimers(); }
  });
  it('retains coalesced explicit and post-mutation reads with automatic state polling disabled', async () => {
    vi.useFakeTimers(); const view = mount(false);
    try {
      await act(async () => {}); let finish!: (value: PathFinderState) => void;
      vi.mocked(fetchPathFinderState).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      act(() => { view.result.current.refresh(); }); expect(fetchPathFinderState).toHaveBeenCalledTimes(2);
      act(() => { view.result.current.refresh(); view.result.current.refresh(); });
      expect(fetchPathFinderState).toHaveBeenCalledTimes(2);
      await act(async () => finish(state())); expect(fetchPathFinderState).toHaveBeenCalledTimes(3);
      await act(() => view.result.current.matchAll()); expect(fetchPathFinderState).toHaveBeenCalledTimes(4);
      await act(() => vi.advanceTimersByTimeAsync(60_000)); expect(fetchPathFinderState).toHaveBeenCalledTimes(4);
      expect(facts.instances).toBe(1); expect(facts.disposed).not.toHaveBeenCalled();
    } finally { view.unmount(); vi.useRealTimers(); }
  });
  it('changes only the polling schedule when toggled and never recreates or disposes the protected model', async () => {
    vi.useFakeTimers(); const current = { ...state(), jobs: [{ id: locationId, projectId, status: 'running' as const, total: 1, completed: 0, cancelRequested: false, failure: null, attempts: 1, createdAt: '', updatedAt: '' }] };
    vi.mocked(fetchPathFinderState).mockResolvedValue(current);
    const view = renderHook(({ automaticStatePolling }) => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container, automaticStatePolling }),
      { initialProps: { automaticStatePolling: false } });
    try {
      await act(async () => {}); view.rerender({ automaticStatePolling: true });
      await act(() => vi.advanceTimersByTimeAsync(2000)); expect(fetchPathFinderState).toHaveBeenCalledTimes(2);
      view.rerender({ automaticStatePolling: false }); await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(fetchPathFinderState).toHaveBeenCalledTimes(2); expect(facts.instances).toBe(1); expect(facts.disposed).not.toHaveBeenCalled();
    } finally { view.unmount(); vi.useRealTimers(); }
  });
  it('does not reschedule an older in-flight poll after the workspace disables full-state polling', async () => {
    vi.useFakeTimers(); const current = { ...state(), jobs: [{ id: locationId, projectId, status: 'running' as const, total: 1, completed: 0, cancelRequested: false, failure: null, attempts: 1, createdAt: '', updatedAt: '' }] };
    vi.mocked(fetchPathFinderState).mockResolvedValue(current);
    const view = renderHook(({ automaticStatePolling }) => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container, automaticStatePolling }),
      { initialProps: { automaticStatePolling: true } });
    try {
      await act(async () => {}); let finish!: (value: PathFinderState) => void;
      vi.mocked(fetchPathFinderState).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      await act(() => vi.advanceTimersByTimeAsync(2000)); expect(fetchPathFinderState).toHaveBeenCalledTimes(2);
      view.rerender({ automaticStatePolling: false }); await act(async () => finish(current));
      await act(() => vi.advanceTimersByTimeAsync(60_000)); expect(fetchPathFinderState).toHaveBeenCalledTimes(2);
      expect(facts.instances).toBe(1); expect(facts.disposed).not.toHaveBeenCalled();
    } finally { view.unmount(); vi.useRealTimers(); }
  });
  it('still reloads an actually changed model selection after explicit refresh with polling disabled', async () => {
    const view = mount(false); await waitFor(() => expect(facts.instances).toBe(1));
    const oldSignal = vi.mocked(fetchPathFinderState).mock.calls[0][2]!, changed = { ...state(), activeModel: { ...state().activeModel, selectionRevision: '3' } };
    vi.mocked(fetchPathFinderState).mockResolvedValue(changed);
    const models = await vi.mocked(fetchProjectModels).mock.results[0].value;
    vi.mocked(fetchProjectModels).mockResolvedValue({ ...models, selection: { ...models.selection, selectionRevision: 3 } });
    act(() => view.result.current.refresh()); await waitFor(() => expect(facts.instances).toBe(2));
    expect(oldSignal.aborted).toBe(true); expect(facts.disposed).toHaveBeenCalledWith('reload');
    expect(view.result.current.data?.activeModel.selectionRevision).toBe('3'); view.unmount();
  });
  it('still clears current data and the protected frame on explicit current-role refusal with polling disabled', async () => {
    const view = mount(false); await waitFor(() => expect(facts.instances).toBe(1));
    vi.mocked(fetchPathFinderState).mockRejectedValueOnce(new PathFinderApiError('ADMIN_REQUIRED', 403));
    act(() => view.result.current.refresh()); await waitFor(() => expect(view.result.current.data).toBeNull());
    expect(view.result.current.viewerPhase).toBe('error'); expect(facts.disposed).toHaveBeenCalledWith('reload'); view.unmount();
  });
});
afterEach(() => { document.body.replaceChildren(); });
describe('PathFinder scope and shared-location orchestration', () => {
  it.each(['model', 'lookup', 'project'] as const)('coalesces only %s capture progress across both callback sources while terminal updates and captured data remain immediate', async kind => {
    let now = 0, finish!: (value: { snapshot: unknown; summary: Record<string, unknown> }) => void;
    let progress!: (value: { index: number; type: string }) => void;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    facts.capture.mockImplementationOnce((_request, onProgress) => { progress = onProgress; return new Promise(resolve => { finish = resolve; }); });
    vi.mocked(pathFinderRequest).mockResolvedValue({ jobId: locationId });
    const captured = { snapshot: { retained: 'all original captured data' }, summary: {} };
    const { result, unmount } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    try {
      await waitFor(() => expect(facts.events.length).toBe(1));
      act(() => facts.events[0]({ type: 'MODEL_LOADED', payload: {} }));
      let pending!: Promise<unknown>;
      const request = { routeCodes: ['BC1'], allowedCategories: ['Control'] as ('Control')[], equipmentNames: ['EQ-001'] };
      act(() => {
        pending = kind === 'model' ? result.current.prepareModel(request) : kind === 'lookup' ? result.current.startLookup('/BC1', false)
          : result.current.runProjectPreparation({ modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) }, viewer => viewer.capture(request));
      });
      await waitFor(() => expect(facts.capture).toHaveBeenCalledOnce());
      const prefix = kind === 'model' ? 'Preparing the selected model' : kind === 'lookup' ? 'Reading lookup geometry' : 'Collecting project geometry';
      act(() => progress({ index: 0, type: 'object-part' }));
      expect(result.current.viewerMessage).toBe(`${prefix}: 1 data batches…`);
      now = 900;
      act(() => { for (let index = 1; index <= 50; index++) progress({ index, type: 'object-part' }); });
      expect(result.current.viewerMessage).toBe(`${prefix}: 1 data batches…`);
      now = 999;
      act(() => facts.events[0]({ type: 'MODEL_CAPTURE_PROGRESS', payload: { phase: 'properties', loaded: 222, total: 777 } }));
      expect(result.current.viewerMessage).toBe(`${prefix}: 1 data batches…`);
      now = 1000;
      act(() => facts.events[0]({ type: 'MODEL_CAPTURE_PROGRESS', payload: { phase: 'properties', loaded: 222, total: 777 } }));
      expect(result.current.viewerMessage).toBe('Preparing equipment candidates: 222 / 777…');
      act(() => progress({ index: 999, type: 'object-part' }));
      expect(result.current.viewerMessage).toBe('Preparing equipment candidates: 222 / 777…');
      now = 1001;
      act(() => facts.events[0]({ type: 'MODEL_LOADED', payload: {} }));
      expect(result.current.viewerMessage).toBe('The active model is ready.');
      now = 1002;
      act(() => facts.events[0]({ type: 'ERROR', payload: { code: 'EXTRACTION_FAILED', operation: 'START_MODEL_CAPTURE' } }));
      expect(result.current.error).toContain('could not be completed within its limits');
      expect(result.current.viewerPhase).toBe('ready');
      now = 2000;
      act(() => progress({ index: 999, type: 'object-part' }));
      expect(result.current.viewerMessage).toBe(`${prefix}: 1000 data batches…`);
      await act(async () => { finish(captured); if (kind === 'project') expect(await pending).toEqual(captured); else await pending; });
      expect(result.current.viewerMessage).toBe('The active model is ready.'); expect(result.current.busy).toBe(false);
      if (kind !== 'project') expect(pathFinderRequest).toHaveBeenCalledWith(projectId, 'token', kind === 'model' ? '/artifacts' : '/lookups', 'POST', expect.objectContaining({ snapshot: captured.snapshot }), expect.any(AbortSignal));
      else expect(pathFinderRequest).not.toHaveBeenCalled();
    } finally { unmount(); clock.mockRestore(); }
  });
  it('does not share cosmetic progress timestamps or late progress across login runs', async () => {
    let now = 0; const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { result, rerender, unmount } = renderHook(({ token }) => usePathFinder({ projectId, loadedProjectId: projectId, token, isAdmin: true, container }), { initialProps: { token: 'first-login' } });
    try {
      await waitFor(() => expect(facts.events.length).toBe(1));
      const oldEvent = facts.events[0];
      act(() => oldEvent({ type: 'MODEL_CAPTURE_PROGRESS', payload: { phase: 'geometry', loaded: 1, total: 9 } }));
      expect(result.current.viewerMessage).toBe('Preparing routing geometry: 1 / 9…');
      now = 100; rerender({ token: 'second-login' });
      await waitFor(() => expect(facts.events.length).toBe(2));
      act(() => facts.events[1]({ type: 'MODEL_CAPTURE_PROGRESS', payload: { phase: 'properties', loaded: 2, total: 9 } }));
      expect(result.current.viewerMessage).toBe('Preparing equipment candidates: 2 / 9…');
      now = 2000;
      act(() => oldEvent({ type: 'MODEL_CAPTURE_PROGRESS', payload: { phase: 'geometry', loaded: 8, total: 9 } }));
      expect(result.current.viewerMessage).toBe('Preparing equipment candidates: 2 / 9…');
    } finally { unmount(); clock.mockRestore(); }
  });
  it('refuses attributing the loaded viewer to another model, fingerprint or selection before any protected command',async()=>{
    const {result}=renderHook(()=>usePathFinder({projectId,loadedProjectId:projectId,token:'token',isAdmin:true,container}));
    await waitFor(()=>expect(result.current.data).not.toBeNull());
    const expected={modelVersionId:modelId,selectionRevision:'2',contentFingerprint:'a'.repeat(64)},operation=vi.fn(async()=>true);
    for(const patch of [{modelVersionId:locationId},{selectionRevision:'3'},{contentFingerprint:'b'.repeat(64)}])await act(async()=>{await expect(result.current.runProjectPreparation({...expected,...patch},operation)).rejects.toThrow();});
    expect(operation).not.toHaveBeenCalled();expect(facts.capture).not.toHaveBeenCalled();expect(facts.readSelection).not.toHaveBeenCalled();
    await act(async()=>{await expect(result.current.runProjectPreparation(expected,operation)).resolves.toBe(true);});
  });
  it('cancels a late planning capture before it can upload', async () => {
    let finish!: (value: { snapshot: unknown; summary: Record<string, unknown> }) => void;
    facts.capture.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    let pending!: Promise<unknown>; act(() => { pending = result.current.prepareModel({ routeCodes: ['BC1'], allowedCategories: ['Control'], equipmentNames: ['EQ-001'] }); });
    await waitFor(() => expect(facts.capture).toHaveBeenCalledOnce());
    act(() => result.current.cancelOperation());
    await act(async () => { finish({ snapshot: {}, summary: {} }); await pending; });
    expect(pathFinderRequest).not.toHaveBeenCalled();
  });
  it('refuses changed registry inputs and revoked access before planning artifact upload', async () => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    vi.mocked(fetchPathFinderState).mockResolvedValueOnce({ ...state(), registryRevision: '4' });
    await act(() => result.current.prepareModel({ routeCodes: ['BC1'], allowedCategories: ['Control'], equipmentNames: ['EQ-001'] }));
    expect(pathFinderRequest).not.toHaveBeenCalled();
    vi.mocked(fetchPathFinderState).mockRejectedValueOnce(new PathFinderApiError('ADMIN_REQUIRED', 403));
    await act(() => result.current.prepareModel({ routeCodes: ['BC1'], allowedCategories: ['Control'], equipmentNames: ['EQ-001'] }));
    expect(pathFinderRequest).not.toHaveBeenCalled(); expect(facts.disposed).toHaveBeenCalledWith('reload');
  });
  it('rejects a changed cable endpoint even when the selection and registry revisions stay equal', async () => {
    const baseline = state(); baseline.cables = [{ id: locationId, cableId: 1, tag: '=QA', fromLocation: 'FROM', toLocation: 'TO', mto: 'Control', routing: null, designLength: null, installLength: null, cableWriteRevision: '1',
      fromMatch: { status: 'missing', locationId: null, candidates: [] }, toMatch: { status: 'missing', locationId: null, candidates: [] } }];
    vi.mocked(fetchPathFinderState).mockResolvedValue(baseline);
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data?.cables).toHaveLength(1));
    vi.mocked(fetchPathFinderState).mockResolvedValueOnce({ ...baseline, cables: [{ ...baseline.cables[0], toLocation: 'CHANGED' }] });
    await act(() => result.current.prepareModel({ routeCodes: ['BC1'], allowedCategories: ['Control'], equipmentNames: ['FROM', 'TO'] }));
    expect(pathFinderRequest).not.toHaveBeenCalled(); expect(result.current.error).toMatch(/project changed/i);
  });
  it('checks the frozen local endpoint/rule scope after the final server read and before upload', async () => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    let valid = true;
    vi.mocked(fetchPathFinderState).mockImplementationOnce(async () => { valid = false; return state(); });
    await act(() => result.current.prepareModel({ routeCodes: ['BC1'], allowedCategories: ['Control'], equipmentNames: ['EQ-001'] }, () => valid));
    expect(pathFinderRequest).not.toHaveBeenCalled();
  });
  it('does not request admin data or create a frame for a non-admin or mismatched project', async () => {
    const { result, rerender } = renderHook(({ isAdmin, loadedProjectId }) => usePathFinder({ projectId, loadedProjectId, token: 'token', isAdmin, container }), { initialProps: { isAdmin: false, loadedProjectId: projectId } });
    expect(result.current.data).toBeNull(); expect(fetchPathFinderState).not.toHaveBeenCalled(); expect(facts.instances).toBe(0);
    rerender({ isAdmin: true, loadedProjectId: modelId }); expect(fetchPathFinderState).not.toHaveBeenCalled(); expect(facts.instances).toBe(0);
  });
  it('updates aliases then binds once using the fresh registry revision and active model selection', async () => {
    vi.mocked(fetchPathFinderState).mockResolvedValueOnce(state()).mockResolvedValue({ ...state(), registryRevision: '4' });
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data?.registryRevision).toBe('3'));
    await act(() => result.current.saveLocation({ locationId, name: 'EQ-001', aliases: ['Equipment A', 'Alias B'], point: [1.25, -2, 3], objectId: null, externalId: null }));
    expect(pathFinderRequest).toHaveBeenNthCalledWith(1, projectId, 'token', `/locations/${locationId}`, 'PUT', { name: 'EQ-001', aliases: ['Equipment A', 'Alias B'], expectedRegistryRevision: '3' }, expect.any(AbortSignal));
    expect(pathFinderRequest).toHaveBeenNthCalledWith(2, projectId, 'token', `/locations/${locationId}/binding`, 'PUT', { modelVersionId: modelId, expectedSelectionRevision: '2', expectedRegistryRevision: '4', point: [1.25, -2, 3], objectId: null, externalId: null, derivation: 'manual-world-point' }, expect.any(AbortSignal));
  });
  it('a current-role refusal clears all cached PF data and disposes the protected viewer', async () => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    vi.mocked(pathFinderRequest).mockRejectedValueOnce(new PathFinderApiError('ADMIN_REQUIRED', 403));
    await act(() => result.current.matchAll());
    expect(result.current.data).toBeNull(); expect(result.current.viewerPhase).toBe('error'); expect(result.current.busy).toBe(false); expect(facts.disposed).toHaveBeenCalledWith('reload');
  });
  it('scope changes synchronously hide the old data and ignore a late previous-login response', async () => {
    const { result, rerender } = renderHook(({ token }) => usePathFinder({ projectId, loadedProjectId: projectId, token, isAdmin: true, container }), { initialProps: { token: 'old-token' } });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    let finish!: (value: PathFinderState) => void; vi.mocked(fetchPathFinderState).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    rerender({ token: 'new-token' }); expect(result.current.data).toBeNull(); expect(facts.disposed).toHaveBeenCalledWith('unmount');
    await act(async () => finish(state())); await waitFor(() => expect(result.current.data?.projectId).toBe(projectId));
    expect(facts.instances).toBe(2);
  });
  it('a bounded extraction failure leaves the live model ready so the admin can reduce scope and retry', async () => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(facts.events.length).toBe(1));
    act(() => facts.events[0]({ type: 'MODEL_LOADED', payload: {} }));
    act(() => facts.events[0]({ type: 'ERROR', payload: { code: 'EXTRACTION_FAILED', operation: 'READ_MODEL_CAPTURE' } }));
    expect(result.current.viewerPhase).toBe('ready'); expect(result.current.error).toContain('Reduce the network or equipment scope'); expect(facts.disposed).not.toHaveBeenCalled();
  });
  it.each(BARRIER_CAPTURE_ERROR_CODES.filter(code => code !== 'BARRIER_CAPTURE_MODEL_CHANGED'))('shows the safe %s reason while keeping the live model available', async code => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(facts.events.length).toBe(1));
    act(() => facts.events[0]({ type: 'MODEL_LOADED', payload: {} }));
    act(() => facts.events[0]({ type: 'ERROR', payload: { code, message: 'private SDK object details', operation: 'START_BARRIER_CAPTURE' } }));
    expect(result.current.viewerPhase).toBe('ready'); expect(result.current.error).toBe(barrierCaptureErrorMessage(code));
    expect(result.current.error).not.toContain('private SDK'); expect(facts.disposed).not.toHaveBeenCalled();
  });
  it.each(['index', 'geometry'] as const)('renders barrier %s counts and immediately replaces progress with a specific refusal', async phase => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(facts.events.length).toBe(1)); act(() => facts.events[0]({ type: 'MODEL_LOADED', payload: {} }));
    act(() => facts.events[0]({ type: 'BARRIER_CAPTURE_PROGRESS', payload: { captureId: locationId, phase, loaded: 123, total: 456 } }));
    expect(result.current.viewerMessage).toBe(`Reading ${phase === 'geometry' ? 'barrier geometry' : 'barrier object hierarchy'}: 123 / 456…`);
    act(() => facts.events[0]({ type: 'ERROR', payload: { code: 'BARRIER_CAPTURE_FRAGMENT_LIMIT', operation: 'READ_BARRIER_CAPTURE' } }));
    expect(result.current.viewerMessage).toBe('The active model is ready.'); expect(result.current.error).toBe(BARRIER_CAPTURE_ERROR_MESSAGES.BARRIER_CAPTURE_FRAGMENT_LIMIT);
    expect(result.current.viewerPhase).toBe('ready'); expect(facts.disposed).not.toHaveBeenCalled();
  });
  it('retains the model after a partial appearance restore, offers Clear retry and clears the error after acknowledgement', async () => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(facts.events.length).toBe(1));
    act(() => facts.events[0]({ type: 'MODEL_LOADED', payload: {} }));
    act(() => facts.events[0]({ type: 'ERROR', payload: { code: 'APPEARANCE_RESTORE_FAILED', operation: 'CLEAR_ROUTE' } }));
    expect(result.current.viewerPhase).toBe('ready'); expect(result.current.error).toContain('Press Clear again'); expect(facts.disposed).not.toHaveBeenCalled();
    act(() => result.current.clear()); expect(facts.clear).toHaveBeenCalledOnce();
    act(() => facts.events[0]({ type: 'ROUTE_CLEARED', payload: {} })); expect(result.current.error).toBeNull(); expect(facts.instances).toBe(1);
  });
  it('only explicitly requested retries force a new calculation job', async () => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(() => result.current.calculate()); await act(() => result.current.calculate([locationId], true));
    expect(pathFinderRequest).toHaveBeenNthCalledWith(1, projectId, 'token', '/jobs', 'POST', { expectedRegistryRevision: '3', force: false }, expect.any(AbortSignal));
    expect(pathFinderRequest).toHaveBeenNthCalledWith(2, projectId, 'token', '/jobs', 'POST', { cableIds: [locationId], expectedRegistryRevision: '3', force: true }, expect.any(AbortSignal));
  });
  it('captures an independent lookup without a planning artifact and keeps gap resolution in Project Details', async () => {
    const current: PathFinderState = { ...state(), settings: { ...state().settings, connectionGap: '0.250' }, artifacts: [] };
    vi.mocked(fetchPathFinderState).mockResolvedValue(current); vi.mocked(pathFinderRequest).mockResolvedValue({ jobId: locationId });
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container })); await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(() => result.current.startLookup('/BC1/BC2', false));
    expect(fetchPathFinderLookupPlan).toHaveBeenCalledExactlyOnceWith(projectId, 'token', '/BC1/BC2', '2', expect.any(AbortSignal));
    expect(facts.capture).toHaveBeenCalledWith({ lookupRouteCodes: ['/BC1', '/BC2'], equipmentNames: [] }, expect.any(Function));
    expect(pathFinderRequest).toHaveBeenCalledExactlyOnceWith(projectId, 'token', '/lookups', 'POST', { routeText: '/BC1/BC2', reverse: false, expectedSelectionRevision: '2', snapshot: { lookup: 'owned-protected-capture' } }, expect.any(AbortSignal));
    expect(result.current.data?.settings.connectionGap).toBe('0.250'); expect(result.current.data?.registryRevision).toBe('3'); expect(result.current.data?.artifacts).toEqual([]);
  });
  it('does not capture or enqueue after a cancelled lookup plan resolves late', async () => {
    let finish!: (value: Awaited<ReturnType<typeof fetchPathFinderLookupPlan>>) => void;
    vi.mocked(fetchPathFinderLookupPlan).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    let pending!: ReturnType<typeof result.current.startLookup>;
    act(() => { pending = result.current.startLookup('/BC1/BC2', false); });
    await waitFor(() => expect(fetchPathFinderLookupPlan).toHaveBeenCalledOnce());
    act(() => result.current.cancelOperation());
    await act(async () => { finish({ routeCodes: ['/BC1', '/BC2'], selectionRevision: '2', connectionGap: '1' }); expect(await pending).toBeNull(); });
    expect(facts.capture).not.toHaveBeenCalled(); expect(pathFinderRequest).not.toHaveBeenCalled(); expect(result.current.busy).toBe(false); expect(facts.disposed).not.toHaveBeenCalled();
  });
  it('does not enqueue a late protected capture after Cancel', async () => {
    let finish!: (value: unknown) => void; facts.capture.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    let pending!: ReturnType<typeof result.current.startLookup>; act(() => { pending = result.current.startLookup('/BC1', false); });
    await waitFor(() => expect(facts.capture).toHaveBeenCalledOnce()); act(() => result.current.cancelOperation());
    await act(async () => { finish({ snapshot: { late: true }, summary: {} }); expect(await pending).toBeNull(); });
    expect(pathFinderRequest).not.toHaveBeenCalled(); expect(result.current.error).toBe('The operation was cancelled.'); expect(result.current.busy).toBe(false);
  });
  it('durably cancels an accepted lookup job when Cancel races its creation response', async () => {
    let finish!: (value: Record<string, unknown>) => void;
    vi.mocked(pathFinderRequest).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({});
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    let pending!: ReturnType<typeof result.current.startLookup>; act(() => { pending = result.current.startLookup('/BC1', false); });
    await waitFor(() => expect(pathFinderRequest).toHaveBeenCalledOnce()); act(() => result.current.cancelOperation());
    await act(async () => { finish({ jobId: locationId }); expect(await pending).toBeNull(); });
    expect(pathFinderRequest).toHaveBeenLastCalledWith(projectId, 'token', `/jobs/${locationId}`, 'DELETE', undefined, expect.any(AbortSignal)); expect(result.current.busy).toBe(false);
  });
  it('keeps lookup discovery refusals safe and distinguishes missing visible geometry from quota errors', async () => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    facts.capture.mockRejectedValueOnce(new ViewerAccessError('LOOKUP_GEOMETRY_NOT_FOUND', 0));
    await act(() => result.current.startLookup('/BC999', false));
    expect(result.current.error).toBe('No display-visible route geometry matches the lookup. Check the route names and model visibility.'); expect(facts.disposed).not.toHaveBeenCalled(); expect(pathFinderRequest).not.toHaveBeenCalled();
    vi.mocked(fetchPathFinderLookupPlan).mockRejectedValueOnce(new PathFinderApiError('ADMIN_REQUIRED', 403));
    await act(() => result.current.startLookup('/BC1', false));
    expect(result.current.data).toBeNull(); expect(facts.disposed).toHaveBeenCalledWith('reload'); expect(pathFinderRequest).not.toHaveBeenCalled();
  });
  it('binds a standalone path to current project inputs even when a caller supplies stale managed fields', async () => {
    const current: PathFinderState = { ...state(), settings: { ...state().settings, revision: '9007199254740993' }, artifacts: [{ id: locationId, modelVersionId: modelId, snapshotSha256: 'a'.repeat(64), objectCount: 2, engineeringAccepted: false, readiness: 'needs_review', capture: {}, coordinates: {}, createdAt: '2026-10-18T00:00:00Z' }] };
    vi.mocked(fetchPathFinderState).mockResolvedValue(current); vi.mocked(pathFinderRequest).mockResolvedValue({ jobId: locationId });
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container })); await waitFor(() => expect(result.current.data).not.toBeNull());
    const input = { from: { name: 'Equipment A' }, to: { name: '', point: [10, 0, 0] as [number, number, number] }, category: 'Instrumentation' as const, reverse: true, secondaryDistanceMeters: 3, preferVerticalApproach: false,
      artifactId: modelId, expectedSelectionRevision: '0', expectedSettingsRevision: '0', expectedRegistryRevision: '0' };
    await act(() => result.current.startPreview(input));
    expect(pathFinderRequest).toHaveBeenCalledExactlyOnceWith(projectId, 'token', '/previews', 'POST', { ...input, artifactId: locationId, expectedSelectionRevision: '2', expectedSettingsRevision: '9007199254740993', expectedRegistryRevision: '3' }, expect.any(AbortSignal));
  });
  it('keeps bounded native routing preferences while reading the current Details gap for cable jobs', async () => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container })); await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(() => result.current.calculate([locationId], true, { secondaryDistanceMeters: 0, preferVerticalApproach: false }));
    expect(pathFinderRequest).toHaveBeenCalledExactlyOnceWith(projectId, 'token', '/jobs', 'POST', { cableIds: [locationId], expectedRegistryRevision: '3', force: true,
      options: { connectionToleranceMeters: 1, sampleSpacingMeters: 0.125, maxGraphNodes: 200000, maxGraphConnections: 1000000, secondaryDistanceMeters: 0, preferVerticalApproach: false } }, expect.any(AbortSignal));
  });
  it('serializes barrier capture and publication through the scoped protected facade', async () => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const request = barrierRequest();
    await act(async () => {
      await result.current.runProjectPreparation(request.scope, async viewer => {
        const observed = await viewer.captureBarriers(request);
        expect(Object.keys(viewer).sort()).toEqual(['assertCurrent', 'capture', 'captureBarriers', 'discover', 'publishBarriers', 'readSelection']);
        return viewer.publishBarriers(locationId, observed);
      });
    });
    expect(facts.barrierCapture).toHaveBeenCalledExactlyOnceWith(request, expect.objectContaining({ signal: expect.any(AbortSignal), isCurrent: expect.any(Function) }));
    expect(facts.barrierPublish).toHaveBeenCalledExactlyOnceWith(locationId, await facts.barrierCapture.mock.results[0].value, expect.any(AbortSignal));
    expect(facts.capture).not.toHaveBeenCalled(); expect(facts.clear).not.toHaveBeenCalled(); expect(facts.instances).toBe(1);
  });
  it('fences late barrier geometry after administrator loss before publication', async () => {
    let resolveCapture!: (value: unknown) => void;
    facts.barrierCapture.mockImplementationOnce(() => new Promise(resolve => { resolveCapture = resolve; }));
    const view = renderHook(({ isAdmin }) => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin, container }), { initialProps: { isAdmin: true } });
    await waitFor(() => expect(view.result.current.data).not.toBeNull());
    const request = barrierRequest(); let operation!: Promise<unknown>; let refused!: Promise<void>;
    act(() => { operation = view.result.current.runProjectPreparation(request.scope, async viewer => viewer.publishBarriers(locationId, await viewer.captureBarriers(request))); refused = expect(operation).rejects.toThrow(); });
    await waitFor(() => expect(facts.barrierCapture).toHaveBeenCalledOnce());
    view.rerender({ isAdmin: false });
    await act(async () => { resolveCapture({ fixture: 'late opaque observation' }); await refused; });
    expect(facts.barrierPublish).not.toHaveBeenCalled();
    expect(facts.barrierCapture.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('retains the explicit barrier admission when submitting selected cable calculation', async () => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const barrierRouting = { schemaVersion: 'wfc.pf.barrier-admission-intent.v1' as const, scope: barrierRequest().scope,
      expectedRegistryRevision: '0', expectedSnapshot: null, drillThroughWalls: true };
    vi.mocked(pathFinderRequest).mockClear();
    await act(async () => { await result.current.calculate([locationId], true, { secondaryDistanceMeters: 2, preferVerticalApproach: true, barrierRouting }); });
    expect(pathFinderRequest).toHaveBeenCalledWith(projectId, 'token', '/jobs', 'POST', expect.objectContaining({
      options: expect.objectContaining({ barrierRouting }), cableIds: [locationId],
    }), expect.any(AbortSignal));
  });
  it('uses the protected controller for selection/transparency and cancels pending viewer work', async () => {
    const selected = { coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [] };
    facts.readSelection.mockResolvedValue(selected); facts.transparency.mockResolvedValue(undefined);
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container })); await waitFor(() => expect(facts.instances).toBe(1));
    await act(async () => { expect(await result.current.readSelection()).toEqual(selected); await result.current.setPathTransparency(75); result.current.cancelOperation(); });
    expect(facts.readSelection).toHaveBeenCalledOnce(); expect(facts.transparency).toHaveBeenCalledWith(75); expect(facts.cancelPicking).toHaveBeenCalledOnce(); expect(facts.clear).toHaveBeenCalledOnce(); expect(facts.instances).toBe(1);
  });
});
