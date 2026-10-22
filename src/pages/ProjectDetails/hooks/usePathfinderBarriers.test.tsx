import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/pathfinderBarriers';
import { usePathfinderBarriers, type BarrierSelectedParent } from './usePathfinderBarriers';
import type { ProjectPreparationViewer } from './usePathFinder';
import type { BarrierRegistry, BarrierSnapshot } from '../../../../shared/pathfinderBarriers';
import type { ViewerSelection } from '../../../../viewer-runtime/protocol.mjs';
import { BARRIER_CAPTURE_ERROR_MESSAGES } from '../../../../viewer-runtime/barrier-capture-errors.mjs';

vi.mock('@/api/pathfinderBarriers', async original => ({ ...await original<typeof api>(), getBarrierRegistry: vi.fn(), getBarrierSnapshot: vi.fn(), getLatestBarrierSnapshot: vi.fn(), beginBarrierCapture: vi.fn(), changeBarrierRegistry: vi.fn() }));
const id = (n: number) => `b5000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
const parent = (n: number): BarrierSelectedParent => ({ selectionId: id(n + 1000), kind: 'wall', objectId: `dbid:${n}`, dbId: n, externalId: null, name: `Selected parent ${n}`, identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' });
function registry(parents: BarrierSelectedParent[] = [], revision = '1'): BarrierRegistry {
  return { schemaVersion: 'wfc.pf.barrier-registry.v1', scope: structuredClone(scope), registryRevision: revision, state: parents.length ? 'ready' : 'unconfigured', selectedParents: structuredClone(parents),
    snapshot: parents.length ? { snapshotId: id(10), scope: structuredClone(scope), registryRevision: revision, contentSha256: 'c'.repeat(64), mode: 'mesh-set' } : null, reasonCodes: parents.length ? [] : ['NO_BARRIER_SCOPE_CONFIGURED'] };
}
function manifest(value: BarrierRegistry, emptyReason = 'Reviewed empty scope'): BarrierSnapshot {
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (value.snapshot!.mode === 'explicit-empty') return { schemaVersion: 'wfc.pf.barrier-snapshot.v1', snapshotId: value.snapshot!.snapshotId, scope: value.scope, registryRevision: value.registryRevision, contentSha256: value.snapshot!.contentSha256, selectedParents: [], capture: null,
    geometry: { mode: 'explicit-empty', declarationId: id(31), declaration: 'administrator-declared-no-selected-barriers', reason: emptyReason }, coverage: 'registered-selected-objects-only', engineeringAccepted: false };
  return { schemaVersion: 'wfc.pf.barrier-snapshot.v1', snapshotId: value.snapshot!.snapshotId, scope: value.scope, registryRevision: value.registryRevision, contentSha256: value.snapshot!.contentSha256, selectedParents: value.selectedParents,
    capture: { captureId: value.snapshot!.snapshotId === id(21) ? id(20) : id(11), payloadSha256: 'd'.repeat(64) }, geometry: { mode: 'mesh-set', fragments: value.selectedParents.map((p, index) => ({ source: { fragmentId: index, ownerObjectId: p.objectId, parentSelectionIds: [p.selectionId], sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: matrix, transformSha256: 'e'.repeat(64) }, bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] }, mesh: { blobId: id(100 + index), sha256: 'f'.repeat(64), bytes: 256 }, vertices: 8, triangles: 12 })),
      verification: { producerVersion: 'wfc.pf.barrier-verifier.v1', selectionClosure: 'complete-selected-scope', topology: 'qualified-closed-consistent-two-manifold', selfIntersection: 'bounded-verification-passed', computationalMeshes: value.selectedParents.length, verifiedCaptureSha256: 'd'.repeat(64), verificationSha256: 'a'.repeat(64) } }, coverage: 'registered-selected-objects-only', engineeringAccepted: false };
}
function selection(...numbers: number[]): ViewerSelection {
  return { coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: numbers.map(n => ({ objectId: n, parentId: n === 8 ? 7 : null, name: `Selected parent ${n}`, externalId: null, bounds: null, bottomCentre: null, derivation: 'display-aabb-bottom-centre', nativeVisibility: 'unknown', properties: [], propertiesTruncated: false })) };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((done, refuse) => { resolve = done; reject = refuse; }); return { promise, resolve, reject }; }
type Options = Parameters<typeof usePathfinderBarriers>[0];
function fixture(initial: number[] = []) {
  let current = registry(initial.map(parent)); let lastRequest: Parameters<ProjectPreparationViewer['captureBarriers']>[0] | null = null; let currentEmptyReason = '';
  const readSelection = vi.fn().mockResolvedValue(selection(7));
  // These are protected-facade transport observations only. Geometry/topology is
  // not qualified by these hook fixtures; B1/B2 own that independent evidence.
  const observation = { capture: {}, frameObservation: { syntheticControlFixture: true } } as unknown as Awaited<ReturnType<ProjectPreparationViewer['captureBarriers']>>;
  const makeObservation = (request: Parameters<ProjectPreparationViewer['captureBarriers']>[0]) => {
    lastRequest = request; const parents = request.selectedParents.map(p => p.selectionId); const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    observation.capture = { schemaVersion: 'wfc.pf.barrier-capture.v1', captureId: request.captureId, scope: request.scope, selectedParents: request.selectedParents,
      fragments: [{ source: { fragmentId: 0, ownerObjectId: request.selectedParents[0].objectId, parentSelectionIds: parents, sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: matrix, transformSha256: 'e'.repeat(64) }, bounds: { minimum: [0, 0, 0], maximum: [1, 1, 0] }, verticesMetres: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangleIndices: [0, 1, 2] }],
      observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: [0], unavailableFragmentIds: [], enumerationSha256: 'f'.repeat(64) } }; return observation;
  };
  const captureBarriers = vi.fn(async (request: Parameters<ProjectPreparationViewer['captureBarriers']>[0]) => makeObservation(request));
  const publishBarriers = vi.fn(async (intentId: string, publishedObservation: typeof observation) => {
    if (intentId !== id(20) || publishedObservation !== observation) throw new Error('Publisher received a different protected observation');
    if (!lastRequest) throw new Error('No protected capture was requested');
    current = registry(lastRequest.selectedParents, String(Number(current.registryRevision) + 1));
    current.snapshot!.snapshotId = id(21);
    return { schemaVersion: 'wfc.pf.barrier-publication-receipt.v1' as const, snapshot: current.snapshot!, duplicate: false };
  });
  const appearance = { clear: vi.fn(), showPath: vi.fn(), showRoute: vi.fn(), applyTransparency: vi.fn(), restore: vi.fn() };
  const runProjectPreparation = vi.fn(async (_expected: unknown, operation: (viewer: ProjectPreparationViewer) => Promise<unknown>, signal?: AbortSignal) => {
    const assertCurrent = () => { if (signal?.aborted) throw new DOMException('Scope changed', 'AbortError'); };
    assertCurrent(); const result = await operation({ assertCurrent, readSelection, captureBarriers, publishBarriers, ...appearance } as unknown as ProjectPreparationViewer); assertCurrent(); return result;
  });
  const pf = { data: { activeModel: { modelVersionId: scope.modelVersionId, selectionRevision: '1', contentFingerprint: scope.contentFingerprint } }, viewerPhase: 'ready', preparationViewerGeneration: 1, busy: false, readSelection, runProjectPreparation, ...appearance } as unknown as Options['pf'];
  const options: Options = { projectId: scope.projectId, loadedProjectId: scope.projectId, token: 'synthetic-login', isAdmin: true, pf };
  vi.mocked(api.getBarrierRegistry).mockImplementation(async () => structuredClone(current));
  vi.mocked(api.getLatestBarrierSnapshot).mockResolvedValue(null);
  vi.mocked(api.getBarrierSnapshot).mockImplementation(async () => manifest(current, currentEmptyReason));
  vi.mocked(api.beginBarrierCapture).mockImplementation(async (_project, _token, command) => ({ schemaVersion: 'wfc.pf.barrier-intent-receipt.v1', state: 'pending', duplicate: false,
    intent: { id: id(20), snapshotId: id(21), captureBlobId: id(22), manifestBlobId: id(23), command, createdBy: id(24), loginId: id(25) } }));
  vi.mocked(api.changeBarrierRegistry).mockImplementation(async (_project, _token, command) => {
    if (command.action === 'declare-empty') currentEmptyReason = command.reason;
    const snapshot = { snapshotId: id(30), scope: command.scope, registryRevision: String(Number(current.registryRevision) + 1), contentSha256: 'e'.repeat(64), mode: 'explicit-empty' as const };
    current = { ...current, registryRevision: snapshot.registryRevision, state: 'ready', selectedParents: [], snapshot, reasonCodes: [] };
    return { schemaVersion: 'wfc.pf.barrier-publication-receipt.v1', snapshot, duplicate: false };
  });
  return { options, pf, readSelection, runProjectPreparation, captureBarriers, publishBarriers, appearance, observation, makeObservation, getRegistry: () => current, setRegistry: (value: BarrierRegistry) => { current = value; } };
}
beforeEach(() => vi.clearAllMocks());
async function mounted(f: ReturnType<typeof fixture>) {
  const view = renderHook((options: Options) => usePathfinderBarriers(options), { initialProps: f.options });
  await waitFor(() => expect(view.result.current.registry).not.toBeNull()); return view;
}
async function add(view: Awaited<ReturnType<typeof mounted>>) { await act(() => view.result.current.addSelection()); }
const frameUnavailable = () => Object.assign(new Error('Prepare the current frame'), { code: 'BARRIER_CURRENT_FRAME_UNAVAILABLE', status: 409 });

describe('saved barrier selection persistence and historical display', () => {
  it('restores a published set on remount and Viewer generation change without any capture or write', async () => {
    const f = fixture([7]), first = await mounted(f);
    expect(first.result.current.saved).toMatchObject({ status: 'current', manifest: { selectedParents: [parent(7)] } });
    first.unmount(); const second = await mounted(f);
    expect(second.result.current.draftParents).toEqual([parent(7)]);
    second.rerender({ ...f.options, pf: { ...f.pf, preparationViewerGeneration: 2 } });
    await waitFor(() => expect(second.result.current.saved?.status).toBe('current'));
    expect(second.result.current.saved?.manifest.selectedParents).toEqual([parent(7)]);
    expect(api.beginBarrierCapture).not.toHaveBeenCalled(); expect(api.changeBarrierRegistry).not.toHaveBeenCalled(); expect(f.captureBarriers).not.toHaveBeenCalled();
  });
  it('keeps Add-only changes distinct from saved publication and does not pretend they survive remount', async () => {
    const f = fixture(), first = await mounted(f); await add(first);
    expect(first.result.current.dirty).toBe(true); expect(first.result.current.saved).toBeNull(); first.unmount();
    const second = await mounted(f); expect(second.result.current.draftParents).toEqual([]); expect(second.result.current.saved).toBeNull();
    expect(api.beginBarrierCapture).not.toHaveBeenCalled(); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
  });
  it('shows stale saved names separately and never seeds a current capture from their old object IDs', async () => {
    const f = fixture([7]), published = manifest(f.getRegistry());
    f.setRegistry({ ...f.getRegistry(), scope: { ...scope, captureFrameId: id(900) }, state: 'stale', reasonCodes: ['BARRIER_MODEL_SCOPE_CHANGED'] });
    vi.mocked(api.getBarrierSnapshot).mockResolvedValue(published);
    const view = await mounted(f);
    expect(view.result.current.saved).toEqual({ manifest: published, status: 'recapture-required' });
    expect(view.result.current.draftParents).toEqual([]); expect(view.result.current.dirty).toBe(false);
    await act(() => view.result.current.save()); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
    f.readSelection.mockResolvedValue(selection(8)); await add(view);
    expect(view.result.current.draftParents.map(value => value.dbId)).toEqual([8]);
    expect(view.result.current.saved?.manifest.selectedParents.map(value => value.dbId)).toEqual([7]);
    expect(f.runProjectPreparation).toHaveBeenCalledWith(expect.objectContaining({ captureFrameId: id(900) }), expect.any(Function), expect.any(AbortSignal));
    expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
  it('withholds current ready admission during and after a failed refresh but retains last verified names', async () => {
    const f = fixture([7]), view = await mounted(f), read = deferred<BarrierRegistry>();
    vi.mocked(api.getBarrierRegistry).mockReturnValueOnce(read.promise);
    let refreshing!: Promise<void>; act(() => { refreshing = view.result.current.refresh(); });
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.saved?.status).toBe('unavailable'); expect(view.result.current.canAuthor).toBe(false);
    await act(async () => { read.reject(new Error('Temporary read failure')); await refreshing; });
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.manifest).toBeNull();
    expect(view.result.current.saved?.manifest.selectedParents).toEqual([parent(7)]); expect(api.getLatestBarrierSnapshot).not.toHaveBeenCalled();
    await act(() => view.result.current.save()); expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
  it('uses one historical fallback for a cold missing frame, with saved names display-only and no current draft', async () => {
    const f = fixture([7]), published = manifest(f.getRegistry());
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable()); vi.mocked(api.getLatestBarrierSnapshot).mockResolvedValueOnce(published);
    const view = renderHook(() => usePathfinderBarriers(f.options));
    await waitFor(() => expect(view.result.current.saved).toEqual({ manifest: published, status: 'unavailable' }));
    expect(api.getLatestBarrierSnapshot).toHaveBeenCalledExactlyOnceWith(id(1), 'synthetic-login', expect.any(AbortSignal));
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.draftParents).toEqual([]); expect(view.result.current.canAuthor).toBe(false);
    await act(() => view.result.current.addSelection()); await act(() => view.result.current.save());
    expect(f.runProjectPreparation).not.toHaveBeenCalled(); expect(api.beginBarrierCapture).not.toHaveBeenCalled(); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
  });
  it('reports empty saved history without creating an empty declaration', async () => {
    const f = fixture(); vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable());
    const view = renderHook(() => usePathfinderBarriers(f.options));
    await waitFor(() => expect(api.getLatestBarrierSnapshot).toHaveBeenCalledOnce());
    await waitFor(() => expect(view.result.current.busy).toBe(false));
    expect(view.result.current.saved).toBeNull(); expect(view.result.current.message).toContain('No saved barrier snapshot was found');
    expect(api.changeBarrierRegistry).not.toHaveBeenCalled(); expect(view.result.current.registry).toBeNull();
  });
  it('shows the latest explicit-empty history instead of retaining a previous nonempty set', async () => {
    const f = fixture([7]), view = await mounted(f), empty = registry([], '2');
    empty.state = 'ready'; empty.reasonCodes = []; empty.snapshot = { snapshotId: id(30), scope, registryRevision: '2', contentSha256: 'e'.repeat(64), mode: 'explicit-empty' };
    const publishedEmpty = manifest(empty, 'Saved reviewed empty scope');
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable()); vi.mocked(api.getLatestBarrierSnapshot).mockResolvedValueOnce(publishedEmpty);
    await act(() => view.result.current.refresh());
    expect(view.result.current.saved?.manifest.selectedParents).toEqual([]);
    expect(view.result.current.saved?.manifest.geometry).toMatchObject({ mode: 'explicit-empty', reason: 'Saved reviewed empty scope' });
    expect(view.result.current.registry).toBeNull(); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
  });
  it.each([401, 403])('clears saved values on HTTP %s and never attempts historical fallback', async status => {
    const f = fixture([7]), view = await mounted(f);
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(Object.assign(new Error('Access unavailable'), { status }));
    await act(() => view.result.current.refresh());
    expect(view.result.current.saved).toBeNull(); expect(view.result.current.draftParents).toEqual([]); expect(view.result.current.registry).toBeNull();
    expect(api.getLatestBarrierSnapshot).not.toHaveBeenCalled(); expect(view.result.current.canAuthor).toBe(false);
  });
  it('clears retained saved names if historical fallback itself denies access', async () => {
    const f = fixture([7]), view = await mounted(f);
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable());
    vi.mocked(api.getLatestBarrierSnapshot).mockRejectedValueOnce(Object.assign(new Error('Access unavailable'), { status: 403 }));
    await act(() => view.result.current.refresh()); expect(view.result.current.saved).toBeNull(); expect(view.result.current.registry).toBeNull();
    expect(view.result.current.canRetry).toBe(false); expect(api.getLatestBarrierSnapshot).toHaveBeenCalledOnce();
  });
  it.each(['token', 'project', 'model', 'role'] as const)('fences late historical names after %s ownership changes', async kind => {
    const f = fixture([7]), published = manifest(f.getRegistry()), history = deferred<BarrierSnapshot | null>();
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable()).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.getLatestBarrierSnapshot).mockReturnValueOnce(history.promise);
    const view = renderHook((options: Options) => usePathfinderBarriers(options), { initialProps: f.options });
    await waitFor(() => expect(api.getLatestBarrierSnapshot).toHaveBeenCalledOnce());
    const next = kind === 'token' ? { ...f.options, token: 'new-login' } : kind === 'project' ? { ...f.options, projectId: id(999), loadedProjectId: id(999) }
      : kind === 'role' ? { ...f.options, isAdmin: false } : { ...f.options, pf: { ...f.pf, data: { ...f.pf.data!, activeModel: { ...f.pf.data!.activeModel, modelVersionId: id(999) } } } };
    view.rerender(next); await act(async () => history.resolve(published));
    expect(view.result.current.saved).toBeNull(); expect(view.result.current.registry).toBeNull(); expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
  it('retains a dirty draft base through failed reads and refuses to rebase its IDs into a changed frame', async () => {
    const f = fixture([7]), view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view);
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(new Error('Temporary read failure')); await act(() => view.result.current.refresh());
    const changed = registry([parent(7)]); changed.scope.captureFrameId = id(900); changed.snapshot!.scope.captureFrameId = id(900); f.setRegistry(changed);
    await act(() => view.result.current.refresh()); expect(view.result.current.phase).toBe('stale');
    expect(view.result.current.draftParents.map(value => value.dbId)).toEqual([7, 8]);
    await act(() => view.result.current.save()); expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
  it('keeps an uncertain command and exact retry key unsettled through historical fallback', async () => {
    const f = fixture([7]), view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view);
    vi.mocked(api.beginBarrierCapture).mockRejectedValueOnce(new TypeError('Lost acknowledgement')); await act(() => view.result.current.save());
    const command = vi.mocked(api.beginBarrierCapture).mock.calls[0][2], published = manifest(f.getRegistry());
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable()); vi.mocked(api.getLatestBarrierSnapshot).mockResolvedValueOnce(published);
    await act(() => view.result.current.refresh());
    expect(view.result.current.phase).toBe('unknown'); expect(view.result.current.pending).toBe(true); expect(view.result.current.canRetry).toBe(true);
    expect(view.result.current.registry).toBeNull(); expect(api.beginBarrierCapture).toHaveBeenCalledOnce();
    await act(() => view.result.current.retry()); expect(vi.mocked(api.beginBarrierCapture).mock.calls[1][2]).toBe(command);
  });
});

describe('administrator barrier authoring lifecycle', () => {
  it('does not read or write when administrator access is absent', async () => {
    const f = fixture(); const view = renderHook(() => usePathfinderBarriers({ ...f.options, isAdmin: false }));
    await act(() => view.result.current.refresh()); await act(() => view.result.current.addSelection()); await act(() => view.result.current.save());
    expect(api.getBarrierRegistry).not.toHaveBeenCalled(); expect(f.runProjectPreparation).not.toHaveBeenCalled(); expect(api.beginBarrierCapture).not.toHaveBeenCalled(); expect(view.result.current.canAuthor).toBe(false);
  });
  it('reads the authoritative frame and exposes no invented manifest counts for an unconfigured scope', async () => {
    const f = fixture(); const view = await mounted(f); expect(view.result.current.registry?.scope).toEqual(scope); expect(view.result.current.manifest).toBeNull(); expect(api.getBarrierSnapshot).not.toHaveBeenCalled();
    expect(api.getBarrierRegistry).toHaveBeenCalledWith(id(1), 'synthetic-login', expect.any(AbortSignal));
  });
  it('preserves parent identity and overlapping parent choices while deduplicating exact selections', async () => {
    const f = fixture(); const view = await mounted(f); f.readSelection.mockResolvedValue(selection(7, 8)); await add(view); const original = structuredClone(view.result.current.draftParents);
    await add(view); expect(view.result.current.draftParents).toEqual(original); expect(original.map(p => p.objectId)).toEqual(['dbid:7', 'dbid:8']);
    expect(original.every(p => p.inclusion === 'own-and-all-descendant-fragments')).toBe(true); expect(f.readSelection).toHaveBeenCalledTimes(2);
    expect(f.runProjectPreparation.mock.calls[0][0]).toMatchObject({ modelVersionId: id(2), selectionRevision: '1', contentFingerprint: scope.contentFingerprint });
  });
  it('accumulates at most128 parents and retains the earlier draft when the limit is exceeded', async () => {
    const f = fixture(); const view = await mounted(f);
    for (let page = 0; page < 8; page++) { f.readSelection.mockResolvedValue(selection(...Array.from({ length: 16 }, (_, i) => 1 + page * 16 + i))); await add(view); }
    expect(view.result.current.draftParents).toHaveLength(128); const original = structuredClone(view.result.current.draftParents);
    f.readSelection.mockResolvedValue(selection(129)); await add(view); expect(view.result.current.draftParents).toEqual(original); expect(view.result.current.error).toBeTruthy();
  });
  it('keeps the previous published head while a changed draft is not yet saved', async () => {
    const f = fixture([7]); const view = await mounted(f); const old = view.result.current.registry!.snapshot; f.readSelection.mockResolvedValue(selection(8)); await add(view);
    expect(view.result.current.dirty).toBe(true); expect(view.result.current.registry!.snapshot).toEqual(old); expect(api.beginBarrierCapture).not.toHaveBeenCalled(); expect(f.publishBarriers).not.toHaveBeenCalled();
  });
  it('freezes exact current frame/revision/parents and publishes only the protected capture result', async () => {
    const f = fixture(); const view = await mounted(f); await add(view); const parents = structuredClone(view.result.current.draftParents); await act(() => view.result.current.save());
    const command = vi.mocked(api.beginBarrierCapture).mock.calls[0][2]; expect(command).toMatchObject({ scope, expectedRegistryRevision: '1', selectedParents: parents }); expect(command.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.captureBarriers).toHaveBeenCalledWith(expect.objectContaining({ captureId: id(20), scope, selectedParents: parents }));
    expect(f.publishBarriers).toHaveBeenCalledWith(id(20), f.observation); expect(view.result.current.pending).toBe(false); expect(view.result.current.dirty).toBe(false);
  });
  it('does not clear, Ghost, hide or redraw the model when reading or assigning selected barriers', async () => {
    const f = fixture(); const view = await mounted(f); await add(view); expect(f.readSelection).toHaveBeenCalled(); for (const operation of Object.values(f.appearance)) expect(operation).not.toHaveBeenCalled();
  });
  it('retains an uncertain begin command and retries its original key instead of minting a replacement', async () => {
    const f = fixture(); const view = await mounted(f); await add(view); vi.mocked(api.beginBarrierCapture).mockRejectedValueOnce(new TypeError('Lost acknowledgement'));
    await act(() => view.result.current.save()); expect(view.result.current.pending).toBe(true); expect(view.result.current.phase).toBe('unknown'); const command = vi.mocked(api.beginBarrierCapture).mock.calls[0][2];
    await act(() => view.result.current.refresh()); expect(view.result.current.pending).toBe(true); await act(() => view.result.current.discardPending()); expect(view.result.current.pending).toBe(true);
    await act(() => view.result.current.retry()); expect(vi.mocked(api.beginBarrierCapture).mock.calls[1][2]).toBe(command); expect(f.captureBarriers).toHaveBeenCalledTimes(1);
  });
  it.each((['begin', 'publication', 'empty'] as const).flatMap(stage => (['mismatched frame', 'manifest404', 'read403'] as const).map(kind => ({ stage, kind }))))('retains unknown $stage through an unrelated $kind display failure', async ({ stage, kind }) => {
    const f = fixture([7]); const view = await mounted(f); const old = view.result.current.registry!.snapshot;
    if (stage === 'empty') {
      await act(() => view.result.current.removeParent(parent(7).selectionId)); act(() => view.result.current.setEmptyReason('Reviewed empty scope'));
      vi.mocked(api.changeBarrierRegistry).mockRejectedValueOnce(new TypeError('Lost empty acknowledgement'));
    } else {
      f.readSelection.mockResolvedValue(selection(8)); await add(view);
      if (stage === 'begin') vi.mocked(api.beginBarrierCapture).mockRejectedValueOnce(new TypeError('Lost command acknowledgement'));
      else f.publishBarriers.mockRejectedValueOnce(new TypeError('Lost publication acknowledgement'));
    }
    await act(() => view.result.current.save()); expect(view.result.current.phase).toBe('unknown');
    const command = stage === 'empty' ? vi.mocked(api.changeBarrierRegistry).mock.calls[0][2] : vi.mocked(api.beginBarrierCapture).mock.calls[0][2];
    if (kind === 'mismatched frame') {
      const otherFrame = manifest(f.getRegistry()); otherFrame.scope = { ...otherFrame.scope, captureFrameId: id(999) };
      vi.mocked(api.getBarrierSnapshot).mockResolvedValueOnce(otherFrame);
    } else {
      vi.mocked(api.getBarrierSnapshot).mockRejectedValueOnce(Object.assign(new Error('Display read denied'), { status: kind === 'read403' ? 403 : 404, code: kind === 'read403' ? 'ADMIN_REQUIRED' : 'BARRIER_SNAPSHOT_NOT_FOUND' }));
    }
    await act(() => view.result.current.refresh());
    expect(view.result.current.phase).toBe('unknown'); expect(view.result.current.pending).toBe(true);
    if (kind === 'read403') { expect(view.result.current.registry).toBeNull(); expect(view.result.current.draftParents).toHaveLength(0); expect(view.result.current.canAuthor).toBe(false); }
    else { expect(view.result.current.registry).toBeNull(); expect(view.result.current.saved?.manifest.snapshotId).toBe(old!.snapshotId); expect(view.result.current.canRetry).toBe(true); }
    await act(() => view.result.current.discardPending()); await act(() => view.result.current.save());
    expect(view.result.current.phase).toBe('unknown'); expect(view.result.current.pending).toBe(true);
    expect(api.beginBarrierCapture).toHaveBeenCalledTimes(stage === 'empty' ? 0 : 1); expect(api.changeBarrierRegistry).toHaveBeenCalledTimes(stage === 'empty' ? 1 : 0);
    expect(stage === 'empty' ? vi.mocked(api.changeBarrierRegistry).mock.calls[0][2] : vi.mocked(api.beginBarrierCapture).mock.calls[0][2]).toBe(command);
    expect(f.captureBarriers).toHaveBeenCalledTimes(stage === 'publication' ? 1 : 0); expect(f.publishBarriers).toHaveBeenCalledTimes(stage === 'publication' ? 1 : 0);
  });
  it('retains a completed observation after an uncertain publish and reconciles it without recapture', async () => {
    const f = fixture([7]); const view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view); const old = view.result.current.registry!.snapshot;
    f.publishBarriers.mockRejectedValueOnce(new TypeError('Lost publication acknowledgement')); await act(() => view.result.current.save());
    expect(view.result.current.phase).toBe('unknown'); expect(view.result.current.pending).toBe(true); expect(view.result.current.registry!.snapshot).toEqual(old);
    const first = f.publishBarriers.mock.calls[0]; await act(() => view.result.current.retry()); expect(f.captureBarriers).toHaveBeenCalledTimes(1); expect(f.publishBarriers.mock.calls[1]).toEqual(first);
  });
  it('keeps the old good head when protected geometry capture refuses', async () => {
    const f = fixture([7]); const view = await mounted(f); const old = view.result.current.registry!.snapshot; f.readSelection.mockResolvedValue(selection(8)); await add(view);
    f.captureBarriers.mockRejectedValueOnce(new Error('Selected parent has unavailable geometry')); await act(() => view.result.current.save());
    expect(f.publishBarriers).not.toHaveBeenCalled(); expect(view.result.current.registry!.snapshot).toEqual(old); expect(view.result.current.dirty).toBe(true); expect(view.result.current.error).toBeTruthy();
  });
  it.each(['BARRIER_CAPTURE_HIERARCHY_LIMIT', 'BARRIER_CAPTURE_FRAGMENT_LIMIT'] as const)('presents %s safely and retains the exact saved intent and old publication', async code => {
    const f = fixture([7]), view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view);
    const old = view.result.current.registry!.snapshot;
    f.captureBarriers.mockRejectedValueOnce(Object.assign(Error('private RVM object details'), { code }));
    await act(() => view.result.current.save());
    expect(view.result.current.error).toBe(BARRIER_CAPTURE_ERROR_MESSAGES[code]); expect(view.result.current.error).not.toContain('private RVM');
    expect(view.result.current.registry?.snapshot).toEqual(old); expect(view.result.current.pending).toBe(true);
    expect(view.result.current.canRetry).toBe(true); expect(view.result.current.phase).toBe('refused'); expect(f.publishBarriers).not.toHaveBeenCalled();
    const command = vi.mocked(api.beginBarrierCapture).mock.calls[0][2], captured = f.captureBarriers.mock.calls[0][0];
    await act(() => view.result.current.retry());
    expect(api.beginBarrierCapture).toHaveBeenCalledOnce(); expect(f.captureBarriers.mock.calls[1][0]).toEqual(captured);
    expect(f.captureBarriers.mock.calls[1][0].scope).toEqual(command.scope); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
  });
  it('does not expose an unknown barrier-capture code or its raw SDK text', async () => {
    const f = fixture(), view = await mounted(f); await add(view);
    f.captureBarriers.mockRejectedValueOnce(Object.assign(Error('private SDK path'), { code: 'BARRIER_CAPTURE_PRIVATE_DETAIL' }));
    await act(() => view.result.current.save());
    expect(view.result.current.error).toContain('could not be read completely'); expect(view.result.current.error).not.toContain('private SDK');
    expect(f.publishBarriers).not.toHaveBeenCalled(); expect(view.result.current.pending).toBe(true);
  });
  it('retains a valid old head and the exact saved command after a structurally valid partial capture', async () => {
    const f = fixture([7]); const view = await mounted(f); const old = view.result.current.registry!.snapshot; f.readSelection.mockResolvedValue(selection(8)); await add(view);
    f.captureBarriers.mockImplementationOnce(async request => { const value = f.makeObservation(request); value.capture.observation.state = 'partial'; return value; });
    await act(() => view.result.current.save()); expect(view.result.current.phase).toBe('partial'); expect(view.result.current.pending).toBe(true);
    expect(view.result.current.registry!.snapshot).toEqual(old); expect(f.publishBarriers).not.toHaveBeenCalled();
  });
  it('removes a subset by recapturing all remaining parents rather than sending a remove mutation', async () => {
    const f = fixture([7, 8]); const view = await mounted(f); await act(() => view.result.current.removeParent(parent(7).selectionId)); expect(view.result.current.draftParents.map(p => p.dbId)).toEqual([8]);
    expect(api.changeBarrierRegistry).not.toHaveBeenCalled(); await act(() => view.result.current.save());
    expect(vi.mocked(api.beginBarrierCapture).mock.calls[0][2].selectedParents.map(p => p.dbId)).toEqual([8]); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
  });
  it('requires an explicit reason before declaring the last removed parent scope empty', async () => {
    const f = fixture([7]); const view = await mounted(f); await act(() => view.result.current.removeParent(parent(7).selectionId)); await act(() => view.result.current.save()); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
    act(() => view.result.current.setEmptyReason('   ')); await act(() => view.result.current.save()); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
    act(() => view.result.current.setEmptyReason('Reviewed selected scope has no barriers')); await act(() => view.result.current.save());
    expect(vi.mocked(api.changeBarrierRegistry).mock.calls[0][2]).toMatchObject({ action: 'declare-empty', scope, expectedRegistryRevision: '1', reason: 'Reviewed selected scope has no barriers' }); expect(f.captureBarriers).not.toHaveBeenCalled();
  });
  it('reconciles an unknown empty declaration with the original frozen reason and key', async () => {
    const f = fixture([7]); const view = await mounted(f); await act(() => view.result.current.removeParent(parent(7).selectionId)); act(() => view.result.current.setEmptyReason('Original reviewed reason'));
    vi.mocked(api.changeBarrierRegistry).mockRejectedValueOnce(new TypeError('Unknown write outcome')); await act(() => view.result.current.save()); const command = vi.mocked(api.changeBarrierRegistry).mock.calls[0][2];
    expect(view.result.current.pending).toBe(true); act(() => view.result.current.setEmptyReason('Later draft reason')); await act(() => view.result.current.retry()); expect(vi.mocked(api.changeBarrierRegistry).mock.calls[1][2]).toBe(command);
  });
  it.each(['role', 'token', 'project', 'model', 'generation'] as const)('aborts and fences a late capture after %s changes', async kind => {
    const f = fixture(); const view = await mounted(f); await add(view); const late = deferred<typeof f.observation>(); f.captureBarriers.mockReturnValueOnce(late.promise);
    let saving!: Promise<unknown>; act(() => { saving = view.result.current.save(); }); await waitFor(() => expect(f.captureBarriers).toHaveBeenCalled()); const signal = f.runProjectPreparation.mock.calls.at(-1)![2];
    let options = f.options;
    if (kind === 'role') options = { ...options, isAdmin: false };
    if (kind === 'token') options = { ...options, token: 'another-login' };
    if (kind === 'project') options = { ...options, projectId: id(999), loadedProjectId: id(999) };
    if (kind === 'model') options = { ...options, pf: { ...options.pf, data: { ...options.pf.data!, activeModel: { modelVersionId: id(999), selectionRevision: '2', contentFingerprint: 'f'.repeat(64) } } } };
    if (kind === 'generation') options = { ...options, pf: { ...options.pf, preparationViewerGeneration: 2 } };
    view.rerender(options); await act(async () => { late.resolve(f.observation); await saving; }); expect(signal?.aborted).toBe(true); expect(f.publishBarriers).not.toHaveBeenCalled();
  });
  it('accepts a late successful publication across an ordinary same-identity facade renewal', async () => {
    const f = fixture(); const view = await mounted(f); await add(view); const late = deferred<Awaited<ReturnType<typeof f.publishBarriers>>>(); f.publishBarriers.mockReturnValueOnce(late.promise);
    let saving!: Promise<unknown>; act(() => { saving = view.result.current.save(); }); await waitFor(() => expect(f.publishBarriers).toHaveBeenCalled());
    const renewed = { ...f.options, pf: { ...f.pf, data: structuredClone(f.pf.data) } }; view.rerender(renewed);
    const next = registry(view.result.current.draftParents, '2'); next.snapshot!.snapshotId = id(21); f.setRegistry(next); await act(async () => { late.resolve({ schemaVersion: 'wfc.pf.barrier-publication-receipt.v1', snapshot: next.snapshot!, duplicate: false }); await saving; });
    expect(view.result.current.pending).toBe(false); expect(view.result.current.registry!.snapshot).toEqual(next.snapshot);
  });
  it('retains a dirty draft but refuses to save against a newly observed prepared frame', async () => {
    const f = fixture([7]); const view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view); const draft = structuredClone(view.result.current.draftParents);
    const changed = registry([parent(7)]); changed.scope.captureFrameId = id(900); changed.snapshot!.scope.captureFrameId = id(900); f.setRegistry(changed);
    await act(() => view.result.current.refresh()); expect(view.result.current.phase).toBe('stale'); expect(view.result.current.draftParents).toEqual(draft);
    await act(() => view.result.current.save()); expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
});
