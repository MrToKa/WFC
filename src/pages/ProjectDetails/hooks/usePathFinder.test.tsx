import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePathFinder } from './usePathFinder';
import { fetchPathFinderState, fetchPathFinderLookupPlan, pathFinderRequest, PathFinderApiError, type PathFinderState } from '@/api/pathfinder';
import { fetchProjectModels } from '@/api/projectModels';
import { ViewerAccessError } from '@/viewer/sessionApi';

const facts = vi.hoisted(() => ({ disposed: vi.fn(), load: vi.fn(), capture: vi.fn(), readSelection: vi.fn(), transparency: vi.fn(), clear: vi.fn(), cancelPicking: vi.fn(), instances: 0, events: [] as ((event: { type: string; payload: Record<string, unknown> }) => void)[] }));
vi.mock('@/api/pathfinder', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/pathfinder')>();
  return { ...original, fetchPathFinderState: vi.fn(), fetchPathFinderLookupPlan: vi.fn(), pathFinderRequest: vi.fn() };
});
vi.mock('@/api/projectModels', () => ({ fetchProjectModels: vi.fn() }));
vi.mock('@/viewer/ViewerController', () => ({ ViewerController: class {
  constructor(options: { onEvent: (event: { type: string; payload: Record<string, unknown> }) => void }) { facts.instances++; facts.events.push(options.onEvent); } dispose = facts.disposed; load = facts.load;
  readSelection = facts.readSelection; setPathTransparency = facts.transparency; clear = facts.clear; cancelPicking = facts.cancelPicking;
  captureModel = facts.capture; getLoadSnapshot = () => ({ ready: true });
} }));
const projectId = '11111111-1111-4111-8111-111111111111', modelId = '22222222-2222-4222-8222-222222222222', locationId = '33333333-3333-4333-8333-333333333333';
function state(): PathFinderState { return { schemaVersion: 1, projectId, registryRevision: '3', activeModel: { modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) },
  settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '4', endConnectionLength: '2', additionalBendingPercent: '5' }, cables: [], artifacts: [], jobs: [], proposals: [],
  locations: [{ id: locationId, name: 'EQ-001', aliases: ['Equipment A'], revision: '1', binding: null }] }; }
let container: { current: HTMLDivElement };
beforeEach(() => {
  vi.clearAllMocks(); facts.instances = 0; facts.events.length = 0; container = { current: document.createElement('div') }; document.body.append(container.current);
  vi.mocked(fetchPathFinderState).mockResolvedValue(state()); vi.mocked(pathFinderRequest).mockResolvedValue({ locationId });
  vi.mocked(fetchPathFinderLookupPlan).mockReset().mockResolvedValue({ routeCodes: ['/BC1', '/BC2'], selectionRevision: '2', connectionGap: '0.250' });
  facts.capture.mockReset().mockResolvedValue({ snapshot: { lookup: 'owned-protected-capture' }, summary: {} });
  vi.mocked(fetchProjectModels).mockResolvedValue({ selection: { projectId, activeModelVersionId: modelId, selectionRevision: 2, updatedAt: '2026-10-18T00:00:00Z' }, versions: [{ id: modelId, projectId, label: 'Model', source: { name: 'test.nwd', bytes: 1, sha256: 'a'.repeat(64), identityBasis: 'observed-local-file' }, preparedAt: '2026-10-18T00:00:00Z', importedAt: null, state: 'ready', health: 'healthy' }] });
});
afterEach(() => { document.body.replaceChildren(); });
describe('PathFinder scope and shared-location orchestration', () => {
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
  it('uses the protected controller for selection/transparency and cancels pending viewer work', async () => {
    const selected = { coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [] };
    facts.readSelection.mockResolvedValue(selected); facts.transparency.mockResolvedValue(undefined);
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container })); await waitFor(() => expect(facts.instances).toBe(1));
    await act(async () => { expect(await result.current.readSelection()).toEqual(selected); await result.current.setPathTransparency(75); result.current.cancelOperation(); });
    expect(facts.readSelection).toHaveBeenCalledOnce(); expect(facts.transparency).toHaveBeenCalledWith(75); expect(facts.cancelPicking).toHaveBeenCalledOnce(); expect(facts.clear).toHaveBeenCalledOnce(); expect(facts.instances).toBe(1);
  });
});
