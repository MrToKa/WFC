import { generateId } from '@/utils/generateId';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createRef, useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectModelApiError, type ProjectModelSnapshot } from '@/api/projectModels';
import { RoutingTrayApiError } from '@/api/routingTrays';
import type { ViewerEvent, ViewerLoadSnapshot } from '@/viewer/ViewerController';
import { parseRouting } from '../../../../viewer-runtime/protocol.mjs';
import { useRoutingsViewer } from './useRoutingsViewer';

type ControllerFixture = {
  options: { onEvent(event: ViewerEvent): void }; snapshot: { -readonly [Key in keyof ViewerLoadSnapshot]: ViewerLoadSnapshot[Key] };
  load: ReturnType<typeof vi.fn>; showRoute: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; zoom: ReturnType<typeof vi.fn>;
  requests: { raw: string; id: string; source: 'manual' | 'cable'; cableId: string | null }[];
};
const mocks = vi.hoisted(() => ({ metadata: vi.fn(), trays: vi.fn(), controllers: [] as ControllerFixture[] }));
vi.mock('@/api/projectModels', async original => ({ ...await original<typeof import('@/api/projectModels')>(), fetchProjectModels: mocks.metadata }));
vi.mock('@/api/routingTrays', async original => ({ ...await original<typeof import('@/api/routingTrays')>(), fetchRoutingTrays: mocks.trays }));
vi.mock('@/viewer/ViewerController', () => ({ ViewerController: class {
  options; snapshot; requests: ControllerFixture['requests'] = [];
  constructor(options: { projectId: string; onEvent(event: ViewerEvent): void }) {
    this.options = options;
    this.snapshot = { instanceId: generateId(), projectId: options.projectId, modelVersionId: '', loadId: '', selectionRevision: 1, ready: false };
    mocks.controllers.push(this as ControllerFixture);
  }
  load = vi.fn(async (id: string) => { this.snapshot.modelVersionId = id; this.snapshot.loadId = generateId(); });
  showRoute = vi.fn(async (raw: string, source: 'manual' | 'cable' = 'manual', cableId: string | null = null) => { const id = generateId(); this.requests.push({ raw, id, source, cableId }); return id; });
  clear = vi.fn(() => generateId()); cancel = vi.fn(); zoom = vi.fn();
  dispose = vi.fn(() => { this.snapshot.ready = false; });
  getLoadSnapshot() { return { ...this.snapshot }; }
} }));
const projectId = '11111111-1111-4111-8111-111111111111';
const modelId = '22222222-2222-4222-8222-222222222222';
const trayId = '33333333-3333-4333-8333-333333333333';
const stamp = '2026-10-16T12:00:00Z';
const snapshot = (): ProjectModelSnapshot => ({ selection: { projectId, activeModelVersionId: modelId, selectionRevision: 1, updatedAt: stamp }, versions: [{
  id: modelId, projectId, label: 'Aalborg', source: { name: 'source.nwd', bytes: 1, sha256: 'a'.repeat(64), identityBasis: 'observed-local-file' },
  state: 'ready', health: 'healthy', preparedAt: stamp, importedAt: stamp,
}] });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const start = (props = { projectId: projectId as string | null, loadedProjectId: projectId as string | null, token: 'current-token' as string | null }) => {
  const container = createRef<HTMLDivElement>(); container.current = document.createElement('div');
  return renderHook(value => useRoutingsViewer({ ...value, container }), { initialProps: props });
};
const emit = (controller: ControllerFixture, type: string, payload: Record<string, unknown> = {}, requestId: string = generateId()) => {
  const { instanceId, projectId, modelVersionId, loadId } = controller.snapshot;
  controller.options.onEvent({ type, payload, requestId, identity: { protocolVersion: 1, instanceId, projectId, modelVersionId, loadId, requestId } });
};
async function loaded(hook: Pick<ReturnType<typeof start>, 'result'>, controllerCount = 1) {
  await waitFor(() => expect(mocks.controllers).toHaveLength(controllerCount));
  const controller = mocks.controllers[controllerCount - 1];
  await act(async () => { emit(controller, 'RUNTIME_READY'); });
  act(() => { controller.snapshot.ready = true; emit(controller, 'MODEL_LOADED'); });
  expect(hook.result.current.canShow).toBe(true);
  return controller;
}
const result = (controller: ControllerFixture, index = controller.requests.length - 1, change: Record<string, unknown> = {}) => {
  const { raw, id, source, cableId } = controller.requests[index];
  const parsed = parseRouting(raw);
  emit(controller, 'ROUTE_RESULT', { rawRouting: raw, source, cableId,
    segments: parsed.segments.map(segment => ({ ...segment, model: { state: 'found', matchCount: 1, drawable: true } })),
    ignored: parsed.ignored, drawableCount: parsed.segments.length, lineCount: 1, warnings: [], ...change }, id);
};
beforeEach(() => { vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) }); vi.clearAllMocks(); mocks.controllers.length = 0; mocks.metadata.mockResolvedValue(snapshot()); mocks.trays.mockResolvedValue([{ id: trayId, projectId, name: 'BC001' }]); });

afterEach(() => { vi.unstubAllGlobals(); });

describe('manual Routings viewer lifecycle', () => {
  it('exposes a separate information lifecycle which survives route operations and retires on model loading', async () => {
    const h = start(), controller = await loaded(h); const first = h.result.current.lifecycleKey;
    expect(first).toEqual(expect.any(String));
    await act(() => h.result.current.show('/BC001')); await act(async () => { result(controller); });
    act(() => h.result.current.zoom()); act(() => h.result.current.clear());
    await act(() => h.result.current.showCable({ id: trayId, projectId, routing: '/BC001' }));
    expect(h.result.current.lifecycleKey).toBe(first);
    act(() => { controller.snapshot.ready = false; controller.snapshot.loadId = generateId(); emit(controller, 'MODEL_LOADING'); });
    const loadingKey = h.result.current.lifecycleKey; expect(loadingKey).not.toBe(first); expect(loadingKey).not.toBeNull();
    act(() => { controller.snapshot.ready = true; emit(controller, 'MODEL_LOADED'); });
    expect(h.result.current.lifecycleKey).toBe(loadingKey);
    act(() => h.result.current.terminateAccess('ACCESS_DENIED', 403)); expect(h.result.current.lifecycleKey).toBeNull();
  });
  it('replaces the public information lifecycle on explicit Retry and masks it on scope loss', async () => {
    const h = start(); await loaded(h); const previous = h.result.current.lifecycleKey;
    act(() => h.result.current.retry()); await waitFor(() => expect(mocks.controllers).toHaveLength(2));
    expect(h.result.current.lifecycleKey).not.toBe(previous); expect(h.result.current.lifecycleKey).not.toBeNull();
    h.rerender({ projectId, loadedProjectId: projectId, token: null });
    expect(h.result.current.lifecycleKey).not.toBe(previous); expect(h.result.current.canShow).toBe(false);
  });
  it('uses the current project token and enables Show only after actual MODEL_LOADED', async () => {
    const h = start(); await waitFor(() => expect(mocks.controllers).toHaveLength(1));
    expect(mocks.metadata).toHaveBeenCalledWith(projectId, 'current-token', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const controller = mocks.controllers[0];
    await act(async () => { emit(controller, 'RUNTIME_READY'); });
    expect(controller.load).toHaveBeenCalledWith(modelId); expect(h.result.current.canShow).toBe(false);
    await act(() => h.result.current.show('/BC001')); expect(mocks.trays).not.toHaveBeenCalled();
    act(() => { controller.snapshot.ready = true; emit(controller, 'MODEL_LOADED'); });
    expect(h.result.current.canShow).toBe(true);
  });
  it.each(['no-model', 'missing-model', 'unavailable'] as const)('keeps %s separate and creates no frame/session', async phase => {
    const value = snapshot(); if (phase === 'no-model') value.selection.activeModelVersionId = null;
    else if (phase === 'missing-model') value.versions = []; else value.versions[0].health = 'unavailable';
    mocks.metadata.mockResolvedValue(value); const h = start();
    await waitFor(() => expect(h.result.current.phase).toBe(phase)); expect(mocks.controllers).toHaveLength(0); expect(h.result.current.canShow).toBe(false);
  });
  it('does not borrow access from another route project or a missing login', async () => {
    for (const props of [{ projectId, loadedProjectId: modelId, token: 'token' }, { projectId, loadedProjectId: projectId, token: null }]) {
      const h = start(props); await waitFor(() => expect(h.result.current.phase).toBe('access-denied')); h.unmount();
    }
    expect(mocks.metadata).not.toHaveBeenCalled(); expect(mocks.controllers).toHaveLength(0);
  });
  it('does not mistake metadata failure for no active model and Retry creates a fresh controller', async () => {
    mocks.metadata.mockRejectedValueOnce(new ProjectModelApiError('NETWORK_ERROR'));
    const h = start(); await waitFor(() => expect(h.result.current.phase).toBe('error'));
    expect(h.result.current.message).toContain('Project model information could not be read');
    act(() => h.result.current.retry()); await loaded(h);
    const old = mocks.controllers[0]; act(() => emit(old, 'ERROR', { code: 'RESOURCE_FAILED' }));
    expect(h.result.current.message).toContain('protected model could not be loaded');
    expect(old.dispose).toHaveBeenCalled(); expect(h.result.current.result).toBeNull();
    act(() => h.result.current.retry()); await waitFor(() => expect(mocks.controllers).toHaveLength(2));
    act(() => { old.snapshot.ready = true; emit(old, 'MODEL_LOADED'); }); expect(h.result.current.canShow).toBe(false);
  });
  it('requires sign-in for legacy login and does not retry automatically', async () => {
    const h = start(); const controller = await loaded(h);
    act(() => emit(controller, 'ERROR', { code: 'LOGIN_REFRESH_REQUIRED' }));
    expect(h.result.current.phase).toBe('login-required'); expect(h.result.current.message).toContain('Sign in again');
    expect(mocks.metadata).toHaveBeenCalledTimes(1); expect(controller.dispose).toHaveBeenCalled();
  });
  it('distinguishes a refused server address from a missing login or revoked project access', async () => {
    const h = start(); await waitFor(() => expect(mocks.controllers).toHaveLength(1));
    const controller = mocks.controllers[0];
    await act(async () => { emit(controller, 'RUNTIME_READY'); });
    act(() => emit(controller, 'ERROR', { code: 'VIEWER_ORIGIN_DENIED' }));
    expect(h.result.current.phase).toBe('error');
    expect(h.result.current.message).toBe('The 3D viewer is not enabled for this server address. Check the server\'s viewer address settings, then retry. (VIEWER_ORIGIN_DENIED)');
    expect(h.result.current.canShow).toBe(false); expect(controller.dispose).toHaveBeenCalled();
    expect(mocks.metadata).toHaveBeenCalledTimes(1);
    act(() => h.result.current.retry()); await loaded(h, 2);
    expect(h.result.current.phase).toBe('ready');
  });
  it.each(['RESOURCE_FAILED', 'SESSION_FAILED', 'MODEL_TIMEOUT'])('shows the public %s load diagnostic without raw server details', async code => {
    const h = start(); const controller = await loaded(h);
    act(() => emit(controller, 'ERROR', { code, message: 'private raw failure detail' }));
    expect(h.result.current.message).toContain(`(${code})`);
    expect(h.result.current.message).not.toContain('private raw failure detail');
    expect(h.result.current.canShow).toBe(false);
  });
  it('does not expose unrecognized error codes or arbitrary server messages', async () => {
    const h = start(); const controller = await loaded(h);
    act(() => emit(controller, 'ERROR', { code: 'PRIVATE_BACKEND_DETAIL', message: 'private raw failure detail' }));
    expect(h.result.current.message).toBe('The protected model could not be loaded. Retry to check the active model and your access.');
    expect(h.result.current.canShow).toBe(false);
  });
  it('invalidates and aborts a previous metadata read immediately when Retry starts', async () => {
    const old = deferred<ProjectModelSnapshot>(); mocks.metadata.mockReturnValueOnce(old.promise);
    const h = start(); await waitFor(() => expect(mocks.metadata).toHaveBeenCalledTimes(1));
    const signal = mocks.metadata.mock.calls[0][2].signal as AbortSignal;
    act(() => h.result.current.retry()); expect(signal.aborted).toBe(true);
    await loaded(h);
    const stale = snapshot(); stale.selection.activeModelVersionId = null;
    await act(async () => { old.resolve(stale); }); expect(h.result.current.phase).toBe('ready'); expect(mocks.controllers).toHaveLength(1);
  });
  it('runs fresh DB/model halves in parallel and buffers a response before the show Promise binds', async () => {
    const h = start(); const controller = await loaded(h); const sent = deferred<string>(); const id = generateId();
    controller.showRoute.mockImplementationOnce((raw: string) => { controller.requests.push({ raw, id, source: 'manual', cableId: null }); result(controller); return sent.promise; });
    let showing!: Promise<void>; act(() => { showing = h.result.current.show('/BC001/SECONDARY/BC001'); });
    expect(mocks.trays).toHaveBeenCalledWith(projectId, 'current-token', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(h.result.current.result).toBeNull();
    await act(async () => { sent.resolve(id); await showing; });
    expect(h.result.current.result?.status).toBe('complete'); expect(h.result.current.result?.segments.map(value => value.segmentIndex)).toEqual([0, 2]);
    expect(h.result.current.canZoom).toBe(true);
  });
  it('never promotes A after B, including identical text with a fresh operation and DB request', async () => {
    const a = deferred<[]>(); const b = deferred<[]>(); mocks.trays.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const h = start(); const controller = await loaded(h);
    await act(() => h.result.current.show('/BC001')); act(() => result(controller, 0));
    await act(() => h.result.current.show('/BC001')); const bSignal = mocks.trays.mock.calls[1][2].signal;
    expect(mocks.trays.mock.calls[0][2].signal.aborted).toBe(true); expect(bSignal.aborted).toBe(false); expect(h.result.current.result).toBeNull();
    act(() => result(controller, 1)); await act(async () => { b.resolve([]); });
    const currentId = h.result.current.operationId; expect(h.result.current.result?.status).toBe('partial');
    await act(async () => { a.resolve([]); result(controller, 0); });
    expect(h.result.current.operationId).toBe(currentId); expect(mocks.trays).toHaveBeenCalledTimes(2);
  });
  it('Clear cancels both pending halves and late results cannot restore zoom or success', async () => {
    const pending = deferred<[]>(); mocks.trays.mockReturnValue(pending.promise); const h = start(); const controller = await loaded(h);
    await act(() => h.result.current.show('/BC001')); act(() => h.result.current.clear());
    expect(mocks.trays.mock.calls[0][2].signal.aborted).toBe(true); expect(controller.cancel).toHaveBeenCalled();
    await act(async () => { pending.resolve([]); result(controller); });
    expect(h.result.current.result).toBeNull(); expect(h.result.current.canZoom).toBe(false);
  });
  it.each(['', '///', '/SECONDARY', '/ＢＣ／００１', 'x'.repeat(8001)])('clears previous visualization for local input %j without a DB read', async raw => {
    const h = start(); const controller = await loaded(h); await act(() => h.result.current.show(raw));
    expect(controller.clear).toHaveBeenCalled(); expect(controller.showRoute).not.toHaveBeenCalled(); expect(mocks.trays).not.toHaveBeenCalled();
    expect(h.result.current.result?.status).toBe(raw.includes('／') || raw.length > 8000 ? 'invalid' : 'empty'); expect(h.result.current.canZoom).toBe(false);
  });
  it('keeps drawable model geometry when project checking is unavailable or a tray is missing', async () => {
    const h = start(); const controller = await loaded(h);
    mocks.trays.mockRejectedValueOnce(new RoutingTrayApiError('TIMEOUT'));
    await act(() => h.result.current.show('/BC001')); act(() => result(controller));
    expect(h.result.current.result?.databaseCheck).toBe('unavailable'); expect(h.result.current.result?.status).toBe('partial'); expect(h.result.current.canZoom).toBe(true);
    mocks.trays.mockResolvedValueOnce([]); await act(() => h.result.current.show('/BC001')); act(() => result(controller));
    expect(h.result.current.result?.warnings.some(warning => warning.message === 'BC001 does not exist in this project.')).toBe(true);
    expect(h.result.current.result?.segments[0].model.drawable).toBe(true); expect(controller.dispose).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404])('immediately disposes for tray access HTTP %s while model result is still pending', async status => {
    const h = start(); const controller = await loaded(h); controller.showRoute.mockReturnValue(new Promise(() => {}));
    mocks.trays.mockRejectedValueOnce(new RoutingTrayApiError(status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'ACCESS_DENIED' : 'PROJECT_NOT_FOUND', status));
    act(() => { void h.result.current.show('/BC001'); });
    await waitFor(() => expect(controller.dispose).toHaveBeenCalled()); expect(h.result.current.result).toBeNull(); expect(h.result.current.canShow).toBe(false);
    expect(h.result.current.phase).toBe(status === 401 ? 'login-required' : 'access-denied');
  });
  it('fails closed on current malformed result instead of combining wrong raw input', async () => {
    const h = start(); const controller = await loaded(h); await act(() => h.result.current.show('/BC001'));
    act(() => result(controller, 0, { rawRouting: '/OTHER' }));
    expect(h.result.current.phase).toBe('error'); expect(h.result.current.message).toContain('did not match'); expect(h.result.current.canZoom).toBe(false);
  });
  it('invalidates previous result on a new load and waits again for MODEL_LOADED', async () => {
    const h = start(); const controller = await loaded(h); await act(() => h.result.current.show('/BC001')); act(() => result(controller));
    expect(h.result.current.result?.status).toBe('complete');
    controller.cancel.mockClear();
    act(() => { controller.snapshot.loadId = generateId(); controller.snapshot.ready = false; emit(controller, 'MODEL_LOADING'); });
    expect(h.result.current.result).toBeNull(); expect(h.result.current.canShow).toBe(false);
    expect(controller.cancel).not.toHaveBeenCalled();
    act(() => { controller.snapshot.ready = true; emit(controller, 'MODEL_LOADED'); }); expect(h.result.current.canShow).toBe(true); expect(h.result.current.canZoom).toBe(false);
  });
  it('disposes and ignores previous token/project/unmount completions', async () => {
    const pending = deferred<[]>(); mocks.trays.mockReturnValueOnce(pending.promise);
    const h = start(); const controller = await loaded(h); await act(() => h.result.current.show('/BC001'));
    h.rerender({ projectId, loadedProjectId: projectId, token: 'new-token' });
    expect(controller.dispose).toHaveBeenCalled(); expect(h.result.current.result).toBeNull(); expect(h.result.current.canShow).toBe(false);
    await act(async () => { pending.resolve([]); result(controller); }); expect(h.result.current.result).toBeNull();
    await waitFor(() => expect(mocks.controllers).toHaveLength(2)); h.unmount(); expect(mocks.controllers[1].dispose).toHaveBeenCalled();
  });
});

const cableA = '44444444-4444-4444-8444-444444444444';
const cableB = '55555555-5555-4555-8555-555555555555';
const cable = (id = cableA, routing: string | null = '/BC001') => ({ id, projectId, routing });

describe('shared manual and cable route pipeline', () => {
  it('captures a frozen cable source snapshot immediately and carries exact UUID/raw data through the shared halves', async () => {
    const h = start(), controller = await loaded(h), row = cable(), pending = deferred<[]>(); mocks.trays.mockReturnValueOnce(pending.promise);
    await act(() => h.result.current.showCable(row));
    const current = h.result.current.currentRoute!; expect(Object.isFrozen(current)).toBe(true);
    expect(current).toEqual({ operationId: expect.any(String), rawRouting: '/BC001', source: 'cable', cableId: cableA });
    row.id = cableB; row.routing = '/OTHER';
    expect(controller.showRoute).toHaveBeenCalledWith('/BC001', 'cable', cableA);
    expect(mocks.trays).toHaveBeenCalledWith(projectId, 'current-token', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    act(() => result(controller)); expect(h.result.current.result).toBeNull();
    await act(async () => { pending.resolve([]); });
    expect(h.result.current.result).toMatchObject({ source: 'cable', cableId: cableA, rawRouting: '/BC001', status: 'partial' });
    expect(h.result.current.currentRoute).toBe(current); expect(h.result.current.operationId).toBe(current.operationId);
    expect(mocks.controllers).toHaveLength(1);
  });

  it.each(['db-first', 'model-first'] as const)('combines cable results only after both current halves: %s', async order => {
    const h = start(), controller = await loaded(h), pending = deferred<{ id: string; projectId: string; name: string }[]>();
    mocks.trays.mockReturnValueOnce(pending.promise); await act(() => h.result.current.showCable(cable()));
    if (order === 'db-first') await act(async () => { pending.resolve([{ id: trayId, projectId, name: 'BC001' }]); });
    else act(() => result(controller));
    expect(h.result.current.result).toBeNull(); expect(h.result.current.checking).toBe(true);
    if (order === 'db-first') act(() => result(controller));
    else await act(async () => { pending.resolve([{ id: trayId, projectId, name: 'BC001' }]); });
    expect(h.result.current.result).toMatchObject({ status: 'complete', source: 'cable', cableId: cableA });
  });

  it('last cable wins even with identical routing, a late model/DB response and a repeated UUID click', async () => {
    const h = start(), controller = await loaded(h), a = deferred<[]>(), b = deferred<[]>();
    mocks.trays.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await act(() => h.result.current.showCable(cable(cableA))); const first = h.result.current.currentRoute!;
    await act(() => h.result.current.showCable(cable(cableB))); const second = h.result.current.currentRoute!;
    expect(second.operationId).not.toBe(first.operationId); expect(mocks.trays.mock.calls[0][2].signal.aborted).toBe(true);
    act(() => result(controller, 1)); await act(async () => { b.resolve([]); });
    await act(async () => { a.resolve([]); result(controller, 0); });
    expect(h.result.current.result?.cableId).toBe(cableB); expect(h.result.current.operationId).toBe(second.operationId);
    await act(() => h.result.current.showCable(cable(cableB))); act(() => result(controller, 2));
    expect(h.result.current.currentRoute?.operationId).not.toBe(second.operationId); expect(mocks.trays).toHaveBeenCalledTimes(3);
    expect(mocks.controllers).toHaveLength(1); expect(controller.load).toHaveBeenCalledTimes(1);
  });

  it.each([null, '', '///', '/SECONDARY', '/ＢＣ／００１', 'x'.repeat(8001)])('replaces an old successful cable with local cable input %j without a stale line or DB read', async raw => {
    const h = start(), controller = await loaded(h); await act(() => h.result.current.showCable(cable())); act(() => result(controller, 0));
    expect(h.result.current.canZoom).toBe(true); mocks.trays.mockClear(); controller.showRoute.mockClear();
    const row = cable(cableB, raw); await act(() => h.result.current.showCable(row)); act(() => result(controller, 0));
    const invalid = typeof raw === 'string' && (raw.includes('／') || raw.length > 8000);
    expect(h.result.current.result).toMatchObject({ source: 'cable', cableId: cableB, rawRouting: raw ?? '', status: invalid ? 'invalid' : 'empty' });
    expect(h.result.current.currentRoute?.cableId).toBe(cableB); expect(h.result.current.canZoom).toBe(false);
    expect(controller.clear).toHaveBeenCalled(); expect(controller.showRoute).not.toHaveBeenCalled(); expect(mocks.trays).not.toHaveBeenCalled(); expect(row.routing).toBe(raw);
  });

  it('keeps the new cable identity for a no-drawable model result instead of retaining the previous route', async () => {
    const h = start(), controller = await loaded(h); await act(() => h.result.current.showCable(cable())); act(() => result(controller));
    await act(() => h.result.current.showCable(cable(cableB)));
    act(() => result(controller, 1, { segments: [{ segmentIndex: 0, token: 'BC001', key: 'BC001', model: { state: 'missing', matchCount: 0, drawable: false } }], drawableCount: 0, lineCount: 0 }));
    await waitFor(() => expect(h.result.current.result?.status).toBe('none'));
    expect(h.result.current.result?.cableId).toBe(cableB); expect(h.result.current.canZoom).toBe(false);
  });

  it('retries a cable only from the matching latest confirmed snapshot, including current nullable routing', async () => {
    const h = start(), controller = await loaded(h); mocks.trays.mockRejectedValueOnce(new RoutingTrayApiError('TIMEOUT'));
    await act(() => h.result.current.showCable(cable())); act(() => result(controller));
    expect(h.result.current.result?.databaseCheck).toBe('unavailable');
    await act(() => h.result.current.retryRoute()); await act(() => h.result.current.retryRoute(null));
    await act(() => h.result.current.retryRoute(cable(cableB))); await act(() => h.result.current.retryRoute({ ...cable(), projectId: modelId }));
    expect(controller.showRoute).toHaveBeenCalledTimes(1);
    await act(() => h.result.current.retryRoute(cable(cableA, '/BC001/BC001'))); act(() => result(controller));
    expect(controller.showRoute).toHaveBeenLastCalledWith('/BC001/BC001', 'cable', cableA);
    expect(h.result.current.result).toMatchObject({ source: 'cable', cableId: cableA, rawRouting: '/BC001/BC001', status: 'complete' });
    await act(() => h.result.current.retryRoute(cable(cableA, null)));
    expect(h.result.current.result).toMatchObject({ source: 'cable', cableId: cableA, rawRouting: '', status: 'empty' });
    expect(h.result.current.canZoom).toBe(false); expect(controller.showRoute).toHaveBeenCalledTimes(2);
  });

  it('manual retry keeps the last checked manual text and never converts it into a remembered cable', async () => {
    const h = start(), controller = await loaded(h); await act(() => h.result.current.show('/BC001')); act(() => result(controller));
    await act(() => h.result.current.retryRoute(cable(cableB, '/OTHER'))); act(() => result(controller));
    expect(controller.showRoute).toHaveBeenLastCalledWith('/BC001', 'manual', null);
    expect(h.result.current.currentRoute).toMatchObject({ rawRouting: '/BC001', source: 'manual', cableId: null });
  });

  it('invalidates only the current matching cable and preserves a newer Manual operation even before rerender', async () => {
    const h = start(), controller = await loaded(h); await act(() => h.result.current.showCable(cable())); act(() => result(controller));
    const clearCount = controller.clear.mock.calls.length;
    let showing!: Promise<void>;
    act(() => {
      showing = h.result.current.show('/BC001');
      h.result.current.invalidateCableRoute(cableA, '/BC001');
      h.result.current.zoom(); // Previous React result must not provide bounds to this pending attempt.
    });
    await act(async () => { await showing; });
    expect(h.result.current.currentRoute?.source).toBe('manual'); expect(controller.clear).toHaveBeenCalledTimes(clearCount);
    expect(controller.zoom).not.toHaveBeenCalled(); expect(mocks.trays.mock.calls[1][2].signal.aborted).toBe(false);
    act(() => result(controller)); expect(h.result.current.result?.source).toBe('manual');
    act(() => h.result.current.invalidateCableRoute(cableA)); expect(h.result.current.canZoom).toBe(true);
  });

  it('matches the exact original nullable routing for refresh invalidation and never revives an invalidated cable on Retry', async () => {
    const h = start(), controller = await loaded(h); await act(() => h.result.current.showCable(cable(cableA, null)));
    act(() => h.result.current.invalidateCableRoute(cableA, '')); expect(h.result.current.currentRoute?.cableId).toBe(cableA);
    act(() => h.result.current.invalidateCableRoute(cableA, null)); expect(h.result.current.currentRoute).toBeNull();
    await act(() => h.result.current.retryRoute(cable())); expect(controller.showRoute).not.toHaveBeenCalled();
    await act(() => h.result.current.showCable(cable())); await act(() => h.result.current.showCable(cable(cableA, '/BC001/BC001')));
    act(() => h.result.current.invalidateCableRoute(cableA, '/BC001')); expect(h.result.current.currentRoute?.rawRouting).toBe('/BC001/BC001');
    act(() => h.result.current.invalidateCableRoute(cableB)); expect(h.result.current.currentRoute?.cableId).toBe(cableA);
    act(() => h.result.current.invalidateCableRoute(cableA, '/BC001/BC001')); expect(h.result.current.currentRoute).toBeNull();
    expect(mocks.trays.mock.calls[1][2].signal.aborted).toBe(true);
  });

  it('clears pending cable halves and does not silently replay them after Clear or a model reload', async () => {
    const h = start(), controller = await loaded(h), pending = deferred<[]>(); mocks.trays.mockReturnValueOnce(pending.promise);
    await act(() => h.result.current.showCable(cable())); act(() => h.result.current.clear());
    await act(async () => { pending.resolve([]); result(controller); }); expect(h.result.current.currentRoute).toBeNull(); expect(h.result.current.result).toBeNull();
    await act(() => h.result.current.showCable(cable())); act(() => result(controller));
    act(() => { controller.snapshot.loadId = generateId(); controller.snapshot.ready = false; emit(controller, 'MODEL_LOADING'); });
    expect(h.result.current.currentRoute).toBeNull(); expect(h.result.current.canZoom).toBe(false);
    await act(() => h.result.current.showCable(cable(cableB))); expect(controller.showRoute).toHaveBeenCalledTimes(2);
    act(() => { controller.snapshot.ready = true; emit(controller, 'MODEL_LOADED'); });
    expect(controller.showRoute).toHaveBeenCalledTimes(2); expect(h.result.current.result).toBeNull(); expect(h.result.current.canShow).toBe(true);
  });

  it('fails closed when a current model result carries a different cable UUID', async () => {
    const h = start(), controller = await loaded(h); await act(() => h.result.current.showCable(cable())); act(() => result(controller, 0, { cableId: cableB }));
    expect(h.result.current.phase).toBe('error'); expect(h.result.current.currentRoute).toBeNull(); expect(controller.dispose).toHaveBeenCalled();
  });

  it.each([401, 403, 404])('terminal cable-list HTTP%s stops the same viewer and its pending DB half', async status => {
    const h = start(), controller = await loaded(h), pending = deferred<[]>(); mocks.trays.mockReturnValueOnce(pending.promise);
    await act(() => h.result.current.showCable(cable()));
    act(() => h.result.current.terminateAccess(status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'ACCESS_DENIED' : 'PROJECT_NOT_FOUND', status));
    expect(controller.dispose).toHaveBeenCalled(); expect(mocks.trays.mock.calls[0][2].signal.aborted).toBe(true);
    expect(h.result.current.currentRoute).toBeNull(); expect(h.result.current.phase).toBe(status === 401 ? 'login-required' : 'access-denied');
    await act(async () => { pending.resolve([]); result(controller); }); expect(h.result.current.result).toBeNull();
  });

  it('does not terminate the current route for list timeout or HTTP503 and rejects foreign/non-UUID cable activation', async () => {
    const h = start(), controller = await loaded(h); await act(() => h.result.current.show('/BC001')); act(() => result(controller));
    const current = h.result.current.currentRoute;
    act(() => { h.result.current.terminateAccess('TIMEOUT', null); h.result.current.terminateAccess('SERVICE_FAILED', 503); });
    await act(() => h.result.current.showCable({ ...cable(), id: '123' })); await act(() => h.result.current.showCable({ ...cable(), projectId: modelId }));
    expect(h.result.current.currentRoute).toBe(current); expect(controller.dispose).not.toHaveBeenCalled(); expect(controller.showRoute).toHaveBeenCalledTimes(1);
  });

  it('retained callbacks from the previous login cannot clear, retry, activate or terminate the new current run', async () => {
    const h = start(); await loaded(h); const old = h.result.current;
    h.rerender({ projectId, loadedProjectId: projectId, token: 'new-token' }); const controller = await loaded(h, 2);
    await act(() => h.result.current.show('/BC001')); act(() => result(controller)); const current = h.result.current.currentRoute;
    controller.dispose.mockClear(); controller.clear.mockClear(); controller.cancel.mockClear();
    const reads = mocks.metadata.mock.calls.length, checks = mocks.trays.mock.calls.length;
    await act(async () => {
      await old.show('/OTHER'); await old.showCable(cable()); await old.retryRoute(cable());
      old.clear(); old.zoom(); old.invalidateCableRoute(cableA); old.terminateAccess('ACCESS_DENIED', 403); old.retry();
    });
    expect(h.result.current.currentRoute).toBe(current); expect(h.result.current.phase).toBe('ready');
    expect(controller.dispose).not.toHaveBeenCalled(); expect(controller.clear).not.toHaveBeenCalled(); expect(controller.cancel).not.toHaveBeenCalled(); expect(controller.zoom).not.toHaveBeenCalled();
    expect(mocks.metadata).toHaveBeenCalledTimes(reads); expect(mocks.trays).toHaveBeenCalledTimes(checks);
  });

  it.each(['different-cable', 'same-cable'] as const)('binds an early current cable reply by exact request ID despite late old replies: %s', async identity => {
    const h = start(), controller = await loaded(h), pending = deferred<string>();
    await act(() => h.result.current.showCable(cable())); act(() => result(controller, 0));
    const id = generateId(), nextCable = identity === 'same-cable' ? cableA : cableB;
    controller.showRoute.mockImplementationOnce((raw: string, source: 'manual' | 'cable', cableId: string | null) => {
      controller.requests.push({ raw, id, source, cableId });
      result(controller, 0);
      result(controller, 1);
      return pending.promise;
    });
    let showing!: Promise<void>; act(() => { showing = h.result.current.showCable(cable(nextCable)); });
    expect(h.result.current.checking).toBe(true); expect(h.result.current.result).toBeNull();
    await act(async () => { pending.resolve(id); await showing; });
    expect(h.result.current.result).toMatchObject({ source: 'cable', cableId: nextCable, requestId: id, status: 'complete' });
    expect(controller.dispose).not.toHaveBeenCalled();
    act(() => result(controller, 0)); expect(h.result.current.result?.requestId).toBe(id);
  });

  it('still rejects an early malformed payload for the exact current request', async () => {
    const h = start(), controller = await loaded(h), pending = deferred<string>(), id = generateId();
    controller.showRoute.mockImplementationOnce((raw: string, source: 'manual' | 'cable', cableId: string | null) => {
      controller.requests.push({ raw, id, source, cableId }); result(controller, 0, { rawRouting: '/OTHER' }); return pending.promise;
    });
    let showing!: Promise<void>; act(() => { showing = h.result.current.showCable(cable()); });
    await act(async () => { pending.resolve(id); await showing; });
    expect(h.result.current.phase).toBe('error'); expect(h.result.current.currentRoute).toBeNull(); expect(controller.dispose).toHaveBeenCalled();
  });

  it('bounds early candidates and accepts the current reply after stale candidate churn', async () => {
    const h = start(), controller = await loaded(h), pending = deferred<string>(), id = generateId();
    controller.showRoute.mockImplementationOnce((raw: string, source: 'manual' | 'cable', cableId: string | null) => {
      controller.requests.push({ raw, id, source, cableId });
      for (let index = 0; index < 20; index++) {
        const staleId = generateId();
        emit(controller, 'ROUTE_RESULT', { rawRouting: raw, source, cableId, segments: [], ignored: [], drawableCount: 0, lineCount: 0, warnings: [] }, staleId);
      }
      result(controller); return pending.promise;
    });
    let showing!: Promise<void>; act(() => { showing = h.result.current.showCable(cable()); });
    await act(async () => { pending.resolve(id); await showing; });
    expect(h.result.current.result).toMatchObject({ requestId: id, source: 'cable', status: 'complete' }); expect(controller.dispose).not.toHaveBeenCalled();
  });

  it('masks the old route during render and guards old callbacks before passive scope cleanup', async () => {
    const container = createRef<HTMLDivElement>(); container.current = document.createElement('div');
    let old: ReturnType<typeof useRoutingsViewer> | null = null;
    let observed: { phase: string; result: unknown; currentRoute: unknown; canShow: boolean; oldDisposed: number; oldCleared: number } | null = null;
    const h = renderHook(props => {
      const viewer = useRoutingsViewer({ ...props, container });
      useLayoutEffect(() => {
        if (props.token === 'new-token' && old && !observed) {
          observed = { phase: viewer.phase, result: viewer.result, currentRoute: viewer.currentRoute, canShow: viewer.canShow,
            oldDisposed: mocks.controllers[0].dispose.mock.calls.length, oldCleared: mocks.controllers[0].clear.mock.calls.length };
          old.clear(); old.zoom(); old.invalidateCableRoute(cableA); old.terminateAccess('ACCESS_DENIED', 403); old.retry();
          void old.show('/OTHER'); void old.showCable(cable()); void old.retryRoute(cable());
          expect(mocks.controllers[0].dispose).toHaveBeenCalledTimes(observed.oldDisposed);
          expect(mocks.controllers[0].clear).toHaveBeenCalledTimes(observed.oldCleared);
        }
      }, [props.token, viewer]);
      return viewer;
    }, { initialProps: { projectId, loadedProjectId: projectId, token: 'current-token' } });
    const controller = await loaded(h); await act(() => h.result.current.showCable(cable())); act(() => result(controller)); old = h.result.current;
    const checks = mocks.trays.mock.calls.length;
    await act(async () => { h.rerender({ projectId, loadedProjectId: projectId, token: 'new-token' }); });
    expect(observed).toMatchObject({ phase: 'metadata', result: null, currentRoute: null, canShow: false });
    expect(mocks.trays).toHaveBeenCalledTimes(checks); expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(['project-change', 'logout', 'unmount'] as const)('aborts a pending cable route and rejects its late halves after %s', async transition => {
    const h = start(), controller = await loaded(h), pending = deferred<[]>(); mocks.trays.mockReturnValueOnce(pending.promise);
    await act(() => h.result.current.showCable(cable())); const old = h.result.current;
    if (transition === 'unmount') h.unmount();
    else h.rerender({ projectId: transition === 'project-change' ? modelId : projectId, loadedProjectId: transition === 'project-change' ? modelId : projectId, token: transition === 'logout' ? null : 'current-token' });
    expect(mocks.trays.mock.calls[0][2].signal.aborted).toBe(true); expect(controller.dispose).toHaveBeenCalled();
    await act(async () => { pending.resolve([]); result(controller); await old.showCable(cable(cableB)); await old.retryRoute(cable()); old.clear(); old.retry(); });
    expect(controller.showRoute).toHaveBeenCalledTimes(1);
    if (transition !== 'unmount') { expect(h.result.current.currentRoute).toBeNull(); expect(h.result.current.result).toBeNull(); expect(h.result.current.canZoom).toBe(false); }
  });
});
