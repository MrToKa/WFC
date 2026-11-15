import { ApiError } from '../api/http';
import { fetchTrayAutoLength, fetchTrayAutoLengthCaptureContext, measureCapturedTrayAutoLength } from '../api/trays';
import { ViewerController } from './ViewerController';
import type { TrayAutoLengthMeasurement } from '../../shared/trayAutoLength';

/** A tray measurement owns a short-lived protected viewer, not the project's
 * preparation or routing state. Cached measurements need no model load. */
export async function resolveTrayAutoLength(token: string, projectId: string, trayId: string,
  options: { signal: AbortSignal; onProgress?: (message: string) => void }): Promise<TrayAutoLengthMeasurement> {
  const { signal, onProgress } = options;
  signal.throwIfAborted();
  try {
    const measurement = await fetchTrayAutoLength(token, projectId, trayId);
    signal.throwIfAborted(); return measurement;
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
  }
  onProgress?.('Reading the objects assigned to this tray…');
  const context = await fetchTrayAutoLengthCaptureContext(token, projectId, trayId, signal);
  signal.throwIfAborted();
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, { position: 'fixed', left: '-10000px', top: '0', width: '800px', height: '600px', visibility: 'hidden', pointerEvents: 'none' });
  document.body.append(container);
  let viewer: ViewerController | undefined;
  let rejectReady: (reason: unknown) => void = () => {};
  const abort = () => { rejectReady(signal.reason); viewer?.dispose('unmount'); };
  const timeout = window.setTimeout(() => rejectReady(new Error('The model took too long to load. Try Auto-length again.')), 180_000);
  signal.addEventListener('abort', abort, { once: true });
  try {
    onProgress?.('Loading the model to measure this tray…');
    await new Promise<void>((resolve, reject) => {
      rejectReady = reject;
      viewer = new ViewerController({ container, projectId, token, onEvent: event => {
        if (signal.aborted) return;
        if (event.type === 'RUNTIME_READY') queueMicrotask(() => { if (!signal.aborted) void viewer?.load(context.modelVersionId).catch(reject); });
        if (event.type === 'MODEL_LOADED') resolve();
        if (event.type === 'ERROR') reject(new Error(typeof event.payload.message === 'string' ? event.payload.message : 'The model could not be loaded for Auto-length.'));
      } });
      if (signal.aborted) abort();
    });
    window.clearTimeout(timeout);
    signal.throwIfAborted();
    const current = viewer!.getLoadSnapshot();
    if (!current?.ready || current.projectId !== projectId || current.modelVersionId !== context.modelVersionId || String(current.selectionRevision) !== context.selectionRevision)
      throw new Error('The active model changed. Try Auto-length again.');
    onProgress?.('Reading only this tray’s assigned geometry…');
    const capture = await viewer!.captureModel({ equipmentNames: [], routeRules: [{ id: trayId, objectIds: context.rootObjectIds, allowedCategories: ['MV', 'LV', 'Control'] }] },
      () => {}, { signal });
    signal.throwIfAborted();
    onProgress?.('Measuring the tray centerlines…');
    return await measureCapturedTrayAutoLength(token, context, capture.snapshot, signal);
  } finally {
    signal.removeEventListener('abort', abort); window.clearTimeout(timeout);
    viewer?.dispose('unmount'); container.remove();
  }
}
