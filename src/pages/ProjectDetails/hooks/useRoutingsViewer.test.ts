import { generateId } from '@/utils/generateId';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectModelApiError, type ProjectModelSnapshot } from '@/api/projectModels';
import type { ViewerEvent, ViewerLoadSnapshot } from '@/viewer/ViewerController';
import { useRoutingsViewer } from './useRoutingsViewer';

type ControllerFixture = {
  options: { onEvent(event: ViewerEvent): void }; snapshot: { -readonly [Key in keyof ViewerLoadSnapshot]: ViewerLoadSnapshot[Key] };
  load: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>;
  pickPoint: ReturnType<typeof vi.fn>; showCadComponent: ReturnType<typeof vi.fn>; moveCadComponent: ReturnType<typeof vi.fn>;
  removeCadComponent: ReturnType<typeof vi.fn>; focusCadComponent: ReturnType<typeof vi.fn>;
  setCadComponentColor: ReturnType<typeof vi.fn>; setCadComponentProperties: ReturnType<typeof vi.fn>;
};
const mocks = vi.hoisted(() => ({ metadata: vi.fn(), controllers: [] as ControllerFixture[] }));
vi.mock('@/api/projectModels', async original => ({ ...await original<typeof import('@/api/projectModels')>(), fetchProjectModels: mocks.metadata }));
vi.mock('@/viewer/ViewerController', () => ({ ViewerController: class {
  options; snapshot;
  constructor(options: { projectId: string; onEvent(event: ViewerEvent): void }) {
    this.options = options;
    this.snapshot = { instanceId: generateId(), projectId: options.projectId, modelVersionId: '', loadId: '', selectionRevision: 1, ready: false };
    mocks.controllers.push(this as ControllerFixture);
  }
  load = vi.fn(async (id: string) => { this.snapshot.modelVersionId = id; this.snapshot.loadId = generateId(); });
  dispose = vi.fn(() => { this.snapshot.ready = false; });
  pickPoint = vi.fn(async () => ({ x: 1, y: 2, z: 3 }));
  showCadComponent = vi.fn(async () => {}); moveCadComponent = vi.fn(async () => {});
  removeCadComponent = vi.fn(async () => {}); focusCadComponent = vi.fn(async () => {});
  setCadComponentColor = vi.fn(async () => {}); setCadComponentProperties = vi.fn(async () => {});
  getLoadSnapshot() { return { ...this.snapshot }; }
} }));
const projectId = '11111111-1111-4111-8111-111111111111';
const modelId = '22222222-2222-4222-8222-222222222222';
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
beforeEach(() => { vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) }); vi.clearAllMocks(); mocks.controllers.length = 0; mocks.metadata.mockResolvedValue(snapshot()); });

afterEach(() => { vi.unstubAllGlobals(); });

describe('Draw trays viewer lifecycle', () => {
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
    expect(old.dispose).toHaveBeenCalled();
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
  it('disables CAD on a new load until its exact model identity is confirmed', async () => {
    const h = start(), controller = await loaded(h), previousKey = h.result.current.lifecycleKey;
    act(() => { controller.snapshot.ready = false; controller.snapshot.loadId = generateId(); emit(controller, 'MODEL_LOADING'); });
    expect(h.result.current.canShow).toBe(false);
    expect(h.result.current.lifecycleKey).not.toBe(previousKey);
    await expect(h.result.current.pickCadAnchor()).rejects.toThrow('unavailable');
    act(() => { controller.snapshot.ready = true; const valid = controller.snapshot.modelVersionId; controller.snapshot.modelVersionId = projectId; emit(controller, 'MODEL_LOADED'); controller.snapshot.modelVersionId = valid; });
    expect(h.result.current.canShow).toBe(false);
    act(() => emit(controller, 'MODEL_LOADED'));
    expect(h.result.current.canShow).toBe(true);
  });
  it('keeps a healthy model available after a recoverable CAD overlay failure', async () => {
    const h = start(), controller = await loaded(h);
    act(() => emit(controller, 'ERROR', { code: 'CAD_COMPONENT_FAILED', operation: 'CAD_SHOW' }));
    expect(h.result.current.phase).toBe('ready');
    expect(h.result.current.message).toContain('CAD component could not be displayed');
    expect(controller.dispose).not.toHaveBeenCalled();
    await act(() => h.result.current.focusCadComponent('section-a'));
    expect(controller.focusCadComponent).toHaveBeenCalledWith('section-a');
  });
  it('forwards drawing operations only to the current loaded model', async () => {
    const h = start(), controller = await loaded(h);
    const transform = { positionMm: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    const mesh = { vertices: [] };
    await act(async () => {
      expect(await h.result.current.pickCadAnchor()).toEqual({ x: 1, y: 2, z: 3 });
      await h.result.current.showCadComponent('section-a', mesh, transform);
      await h.result.current.moveCadComponent('section-a', transform);
      await h.result.current.setCadComponentColor('section-a', '#ff0000');
      await h.result.current.removeCadComponent('section-a');
    });
    expect(controller.showCadComponent).toHaveBeenCalledWith('section-a', mesh, transform);
    expect(controller.moveCadComponent).toHaveBeenCalledWith('section-a', transform);
    expect(controller.setCadComponentColor).toHaveBeenCalledWith('section-a', '#ff0000');
    expect(controller.removeCadComponent).toHaveBeenCalledWith('section-a');
    const stale = h.result.current;
    await act(async () => { h.rerender({ projectId, loadedProjectId: projectId, token: 'new-token' }); });
    expect(controller.dispose).toHaveBeenCalled();
    await expect(stale.showCadComponent('stale', mesh, transform)).rejects.toThrow('unavailable');
    await expect(stale.pickCadAnchor()).rejects.toThrow('unavailable');
    await stale.removeCadComponent('stale');
    stale.retry();
    expect(controller.showCadComponent).toHaveBeenCalledTimes(1);
    expect(controller.removeCadComponent).toHaveBeenCalledTimes(1);
    await loaded(h, 2);
    act(() => emit(controller, 'ERROR', { code: 'ACCESS_DENIED' }));
    expect(h.result.current.phase).toBe('ready');
    h.unmount();
    expect(mocks.controllers[1].dispose).toHaveBeenCalled();
  });
  it.each([401, 403, 404])('retires the model for metadata access HTTP %s', async status => {
    mocks.metadata.mockRejectedValueOnce(new ProjectModelApiError(status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'ACCESS_DENIED' : 'PROJECT_NOT_FOUND', status));
    const h = start();
    await waitFor(() => expect(h.result.current.phase).toBe(status === 401 ? 'login-required' : 'access-denied'));
    expect(mocks.controllers).toHaveLength(0);
    expect(h.result.current.canShow).toBe(false);
  });
});
