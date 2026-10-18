import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePathFinder } from './usePathFinder';
import { fetchPathFinderState, pathFinderRequest, PathFinderApiError, type PathFinderState } from '@/api/pathfinder';
import { fetchProjectModels } from '@/api/projectModels';

const facts = vi.hoisted(() => ({ disposed: vi.fn(), load: vi.fn(), instances: 0, events: [] as ((event: { type: string; payload: Record<string, unknown> }) => void)[] }));
vi.mock('@/api/pathfinder', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/pathfinder')>();
  return { ...original, fetchPathFinderState: vi.fn(), pathFinderRequest: vi.fn() };
});
vi.mock('@/api/projectModels', () => ({ fetchProjectModels: vi.fn() }));
vi.mock('@/viewer/ViewerController', () => ({ ViewerController: class {
  constructor(options: { onEvent: (event: { type: string; payload: Record<string, unknown> }) => void }) { facts.instances++; facts.events.push(options.onEvent); } dispose = facts.disposed; load = facts.load;
} }));
const projectId = '11111111-1111-4111-8111-111111111111', modelId = '22222222-2222-4222-8222-222222222222', locationId = '33333333-3333-4333-8333-333333333333';
function state(): PathFinderState { return { schemaVersion: 1, projectId, registryRevision: '3', activeModel: { modelVersionId: modelId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64) },
  settings: { secondaryTrayLength: '4', endConnectionLength: '2', additionalBendingPercent: '5' }, cables: [], artifacts: [], jobs: [], proposals: [],
  locations: [{ id: locationId, name: 'EQ-001', aliases: ['Equipment A'], revision: '1', binding: null }] }; }
let container: { current: HTMLDivElement };
beforeEach(() => {
  vi.clearAllMocks(); facts.instances = 0; facts.events.length = 0; container = { current: document.createElement('div') }; document.body.append(container.current);
  vi.mocked(fetchPathFinderState).mockResolvedValue(state()); vi.mocked(pathFinderRequest).mockResolvedValue({ locationId });
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
  it('only explicitly requested retries force a new calculation job', async () => {
    const { result } = renderHook(() => usePathFinder({ projectId, loadedProjectId: projectId, token: 'token', isAdmin: true, container }));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(() => result.current.calculate()); await act(() => result.current.calculate([locationId], true));
    expect(pathFinderRequest).toHaveBeenNthCalledWith(1, projectId, 'token', '/jobs', 'POST', { expectedRegistryRevision: '3', force: false }, expect.any(AbortSignal));
    expect(pathFinderRequest).toHaveBeenNthCalledWith(2, projectId, 'token', '/jobs', 'POST', { cableIds: [locationId], expectedRegistryRevision: '3', force: true }, expect.any(AbortSignal));
  });
});
