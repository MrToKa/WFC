import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http';
import { fetchTrayAutoLength, fetchTrayAutoLengthCaptureContext, measureCapturedTrayAutoLength } from '../api/trays';
import { ViewerController } from './ViewerController';
import { resolveTrayAutoLength } from './trayAutoLength';

vi.mock('../api/trays', () => ({ fetchTrayAutoLength: vi.fn(), fetchTrayAutoLengthCaptureContext: vi.fn(), measureCapturedTrayAutoLength: vi.fn() }));
vi.mock('./ViewerController', () => ({ ViewerController: vi.fn() }));
const projectId = '11111111-1111-4111-8111-111111111111', trayId = '22222222-2222-4222-8222-222222222222', modelVersionId = '33333333-3333-4333-8333-333333333333';
const context = { projectId, trayId, modelVersionId, selectionRevision: '2', contentFingerprint: 'a'.repeat(64), rootObjectIds: [23, 24], assignmentSha256: 'b'.repeat(64) };
const measurement = { source: 'tray-capture' as const, modelVersionId, selectionRevision: '2', assignmentSha256: context.assignmentSha256,
  measurementId: '44444444-4444-4444-8444-444444444444', lengthMm: 1234.567, elementCount: 2 };
const snapshot = { synthetic: true };
let holdLoad = false, captureFailure: Error | null = null;
let viewer: { load: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; captureModel: ReturnType<typeof vi.fn>; getLoadSnapshot: ReturnType<typeof vi.fn> };

beforeEach(() => {
  holdLoad = false; captureFailure = null;
  vi.mocked(fetchTrayAutoLength).mockRejectedValue(new ApiError(409, 'No current network.'));
  vi.mocked(fetchTrayAutoLengthCaptureContext).mockResolvedValue(context);
  vi.mocked(measureCapturedTrayAutoLength).mockResolvedValue(measurement);
  vi.mocked(ViewerController).mockImplementation(function(options) {
    viewer = { load: vi.fn(async () => { if (!holdLoad) options.onEvent({ type: 'MODEL_LOADED', payload: {} }); }), dispose: vi.fn(),
      captureModel: vi.fn(async () => { if (captureFailure) throw captureFailure; return { snapshot }; }), getLoadSnapshot: vi.fn(() => ({ projectId, modelVersionId, selectionRevision: 2, ready: true })) };
    queueMicrotask(() => options.onEvent({ type: 'RUNTIME_READY', payload: {} }));
    return viewer as unknown as ViewerController;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); document.body.innerHTML = ''; });

describe('independent tray Auto-length', () => {
  it('uses a current cached measurement without creating a viewer or preparing a project network', async () => {
    vi.mocked(fetchTrayAutoLength).mockResolvedValue(measurement);
    await expect(resolveTrayAutoLength('editor', projectId, trayId, { signal: new AbortController().signal })).resolves.toEqual(measurement);
    expect(ViewerController).not.toHaveBeenCalled(); expect(fetchTrayAutoLengthCaptureContext).not.toHaveBeenCalled();
  });
  it('captures only the assigned roots, measures through the server and releases the model', async () => {
    const signal = new AbortController().signal, onProgress = vi.fn();
    await expect(resolveTrayAutoLength('editor', projectId, trayId, { signal, onProgress })).resolves.toEqual(measurement);
    expect(viewer.load).toHaveBeenCalledWith(modelVersionId);
    expect(viewer.captureModel).toHaveBeenCalledWith({ equipmentNames: [], routeRules: [{ id: trayId, objectIds: [23, 24], allowedCategories: ['MV', 'LV', 'Control'] }] }, expect.any(Function), { signal });
    expect(measureCapturedTrayAutoLength).toHaveBeenCalledWith('editor', context, snapshot, signal);
    expect(onProgress).toHaveBeenLastCalledWith('Measuring the tray centerlines…');
    expect(viewer.dispose).toHaveBeenCalled(); expect(document.body.children).toHaveLength(0);
  });
  it('rejects a model selection change before reading any geometry', async () => {
    const signal = new AbortController().signal;
    vi.mocked(ViewerController).mockImplementation(function(options) {
      viewer = { load: vi.fn(async () => { options.onEvent({ type: 'MODEL_LOADED', payload: {} }); }), dispose: vi.fn(), captureModel: vi.fn(),
        getLoadSnapshot: vi.fn(() => ({ projectId, modelVersionId, selectionRevision: 3, ready: true })) };
      queueMicrotask(() => options.onEvent({ type: 'RUNTIME_READY', payload: {} })); return viewer as unknown as ViewerController;
    });
    await expect(resolveTrayAutoLength('editor', projectId, trayId, { signal })).rejects.toThrow('active model changed');
    expect(viewer.captureModel).not.toHaveBeenCalled(); expect(measureCapturedTrayAutoLength).not.toHaveBeenCalled(); expect(viewer.dispose).toHaveBeenCalled();
  });
  it('does not turn an access denial into a model capture', async () => {
    vi.mocked(fetchTrayAutoLength).mockRejectedValue(new ApiError(403, 'Access denied'));
    await expect(resolveTrayAutoLength('editor', projectId, trayId, { signal: new AbortController().signal })).rejects.toThrow('Access denied');
    expect(ViewerController).not.toHaveBeenCalled();
  });
  it('cancels a pending model load and removes its viewer without posting a measurement', async () => {
    holdLoad = true;
    const abort = new AbortController();
    const pending = resolveTrayAutoLength('editor', projectId, trayId, { signal: abort.signal });
    await vi.waitFor(() => expect(ViewerController).toHaveBeenCalled());
    abort.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(viewer.dispose).toHaveBeenCalled(); expect(measureCapturedTrayAutoLength).not.toHaveBeenCalled(); expect(document.body.children).toHaveLength(0);
  });
  it('releases model resources after a geometry capture failure', async () => {
    captureFailure = new Error('Selected geometry unavailable');
    const pending = resolveTrayAutoLength('editor', projectId, trayId, { signal: new AbortController().signal });
    await expect(pending).rejects.toThrow('Selected geometry unavailable');
    expect(measureCapturedTrayAutoLength).not.toHaveBeenCalled();
    expect(viewer.dispose).toHaveBeenCalled(); expect(document.body.children).toHaveLength(0);
  });
});
