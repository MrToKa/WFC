import { fetchRoutingTrays, RoutingTrayApiError, type RoutingTray } from '@/api/routingTrays';
import { generateId } from '@/utils/generateId';
import type { ViewerController, ViewerEvent, ViewerLoadSnapshot } from './ViewerController';
import { aggregateRouteCheck, buildProjectRouteCheck, createLocalRouteCheck, parseRouteInput,
  type RouteAttempt, type RouteCheckResult } from './routeValidation';
import { pathFinderRequestDeadline } from '@/api/pathfinderRequestDeadline';
import { isUuid, type ComputedPath, type SavedRouteEndpoints } from '../../viewer-runtime/protocol.mjs';

type Viewer = Pick<ViewerController, 'getLoadSnapshot' | 'showRoute' | 'cancel' | 'clear'>;
type PreviewOptions = { signal?: AbortSignal; endpoints?: SavedRouteEndpoints };
type Pending = { load: ViewerLoadSnapshot; raw: string; cableId: string; operationId: string; requestId: string | null;
  abort: AbortController; early: Map<string, ViewerEvent>; event?: ViewerEvent; trays?: RoutingTray[] | null; databaseDone: boolean;
  finish: (result: RouteCheckResult | null, error?: unknown) => void };
const sameLoad = (a: ViewerLoadSnapshot | null, b: ViewerLoadSnapshot) => Boolean(a?.ready && b.ready
  && a.instanceId === b.instanceId && a.projectId === b.projectId && a.modelVersionId === b.modelVersionId
  && a.loadId === b.loadId && a.selectionRevision === b.selectionRevision);
const sameEvent = (event: ViewerEvent, load: ViewerLoadSnapshot) => Boolean(event.identity?.protocolVersion === 1
  && event.identity.instanceId === load.instanceId && event.identity.projectId === load.projectId
  && event.identity.modelVersionId === load.modelVersionId && event.identity.loadId === load.loadId);

/** Display-only SDK name/root lookup. No Path Finder jobs, lengths or write authority. */
export function createStoredRouteDisplay(options: { viewer: Viewer; projectId: string; token: string; isCurrent: () => boolean;
  prepare?: () => Promise<boolean>;
  fetchTrays?: typeof fetchRoutingTrays; onAccessFailure?: (error: RoutingTrayApiError) => void }) {
  let pending: Pending | null = null, displayed: ViewerLoadSnapshot | null = null;
  let recording: { load: ViewerLoadSnapshot; abort: AbortController } | null = null;
  const current = (load: ViewerLoadSnapshot) => options.isCurrent() && sameLoad(options.viewer.getLoadSnapshot(), load);
  const cancel = (clear = false) => {
    const old = pending, owned = recording?.load ?? old?.load ?? displayed;
    recording?.abort.abort(); recording = null; pending = null; displayed = null;
    if (old) { old.abort.abort(); old.early.clear(); old.finish(null); if (old.requestId) options.viewer.cancel(old.requestId); }
    if (clear && owned && current(owned)) options.viewer.clear('user', { preserveCamera: true });
  };
  const combine = (attempt: Pending) => {
    if (pending !== attempt) return;
    if (!current(attempt.load)) { cancel(); return; }
    if (!attempt.requestId || !attempt.event || !attempt.databaseDone) return;
    try {
      const expected: RouteAttempt = { protocolVersion: 1, ...attempt.load, modelVersionId: attempt.load.modelVersionId!,
        loadId: attempt.load.loadId!, requestId: attempt.requestId, operationId: attempt.operationId,
        rawRouting: attempt.raw, source: 'cable', cableId: attempt.cableId };
      const result = aggregateRouteCheck(expected, attempt.event, buildProjectRouteCheck(expected, attempt.trays ?? null));
      pending = null; displayed = attempt.load; attempt.finish(result);
    } catch (error) {
      pending = null; displayed = null; attempt.abort.abort();
      if (current(attempt.load)) options.viewer.clear('user', { preserveCamera: true });
      attempt.finish(null, error);
    }
  };
  const display = {
    cancel,
    clear: () => cancel(true),
    onEvent(event: ViewerEvent) {
      if (event.type === 'MODEL_LOADING') { cancel(); return; }
      const attempt = pending;
      if (event.type === 'ROUTE_CLEARED') {
        // showRoute's own CLEAR acknowledgement may arrive after its SHOW ID
        // or result. Ownership is retired explicitly by the host's next tool,
        // not by an uncorrelated asynchronous CLEAR reply.
        return;
      }
      if (!attempt) return;
      if (!current(attempt.load)) { cancel(); return; }
      if (event.type === 'ERROR' && (event.payload.operation === 'viewer' || event.requestId === attempt.requestId)) {
        const error = new Error('The saved route could not be displayed in the current model.');
        pending = null; displayed = null; attempt.abort.abort(); attempt.finish(null, error); return;
      }
      if (event.type === 'ERROR' && event.requestId && !attempt.requestId && sameEvent(event, attempt.load)) {
        if (attempt.early.size < 8) attempt.early.set(event.requestId, event);
        return;
      }
      if (event.type !== 'ROUTE_RESULT' || !event.requestId || !sameEvent(event, attempt.load)) return;
      if (!attempt.requestId) {
        if (attempt.early.size < 8) attempt.early.set(event.requestId, event);
        return;
      }
      if (event.requestId !== attempt.requestId || attempt.event) return;
      attempt.event = event; combine(attempt);
    },
    show(raw: string, cableId: string, { signal, endpoints }: PreviewOptions = {}): Promise<RouteCheckResult | null> {
      cancel(true);
      const load = options.viewer.getLoadSnapshot();
      if (!load?.ready || !current(load) || signal?.aborted) return Promise.resolve(null);
      if (!isUuid(cableId) || typeof raw !== 'string') return Promise.reject(new Error('Invalid saved cable routing.'));
      const operationId = generateId(), parsed = parseRouteInput(raw);
      if (parsed.status !== 'valid' || !parsed.segments.length) return Promise.resolve(createLocalRouteCheck({ protocolVersion: 1,
        ...load, modelVersionId: load.modelVersionId!, loadId: load.loadId!, requestId: generateId(), operationId,
        rawRouting: raw, source: 'cable', cableId }));
      return new Promise((resolve, reject) => {
        let settled = false;
        const abort = () => { if (pending === attempt) cancel(true); };
        const timer = setTimeout(() => {
          if (pending !== attempt) return;
          pending = null; displayed = null; attempt.abort.abort();
          if (attempt.requestId) options.viewer.cancel(attempt.requestId);
          if (current(load)) options.viewer.clear('user', { preserveCamera: true });
          attempt.finish(null, new Error('The saved route display timed out.'));
        }, 75_000);
        const attempt: Pending = { load, raw, cableId, operationId, requestId: null, abort: new AbortController(), early: new Map(), databaseDone: false,
          finish(result, error) {
            if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
            attempt.abort.abort(); attempt.early.clear(); if (error) reject(error); else resolve(result);
          } };
        pending = attempt; signal?.addEventListener('abort', abort, { once: true });
        void (options.fetchTrays ?? fetchRoutingTrays)(options.projectId, options.token, { signal: attempt.abort.signal }).then(trays => {
          if (pending !== attempt) return; attempt.trays = trays; attempt.databaseDone = true; combine(attempt);
        }, error => {
          if (pending !== attempt) return;
          if (error instanceof RoutingTrayApiError && error.accessFailure) {
            pending = null; displayed = null; attempt.finish(null, error); options.onAccessFailure?.(error); return;
          }
          attempt.trays = null; attempt.databaseDone = true; combine(attempt);
        });
        const showRoute = () => endpoints ? options.viewer.showRoute(raw, 'cable', cableId, endpoints)
          : options.viewer.showRoute(raw, 'cable', cableId);
        const request = options.prepare ? options.prepare().then(ready => {
          if (pending !== attempt || !current(load)) return null;
          if (!ready) throw new Error('The current saved CAD geometry could not be synchronized. Refresh the model before showing this route.');
          return showRoute();
        }) : showRoute();
        void request.then(requestId => {
          if (pending !== attempt || !current(load)) {
            if (requestId) options.viewer.cancel(requestId);
            if (pending === attempt) cancel(); return;
          }
          if (!requestId) { cancel(); return; }
          attempt.requestId = requestId;
          const early = attempt.early.get(requestId); attempt.early.clear();
          if (early?.type === 'ERROR') { pending = null; attempt.finish(null, new Error('The saved route could not be displayed in the current model.')); return; }
          attempt.event = early; combine(attempt);
        }, error => {
          if (pending !== attempt) return;
          pending = null; displayed = null; attempt.finish(null, error);
        });
      });
    },
  };
  return {
    ...display,
    async showSaved(raw: string, cableId: string, readPath: (signal: AbortSignal) => Promise<ComputedPath | null>,
      draw: (path: ComputedPath) => Promise<string | null>, { signal, endpoints }: PreviewOptions = {}): Promise<RouteCheckResult | {status: 'historical'} | null> {
      cancel(true);
      const load = options.viewer.getLoadSnapshot();
      if (!load?.ready || !current(load) || signal?.aborted) return null;
      const attempt = { load, abort: new AbortController() };
      recording = attempt;
      const abort = () => { if (recording === attempt) cancel(true); };
      signal?.addEventListener('abort', abort, { once: true });
      const deadline = pathFinderRequestDeadline(attempt.abort.signal, 75000, () => new Error('The saved route display timed out.'));
      const owned = () => recording === attempt && current(load);
      try {
        const path = await deadline.wait(() => readPath(deadline.signal));
        if (!owned()) return null;
        if (!path) {
          recording = null;
          return display.show(raw, cableId, { signal, endpoints });
        }
        const shown = await deadline.wait(() => draw(path));
        if (!shown || !owned()) return null;
        displayed = load;
        return {status: 'historical'};
      } catch (error) {
        if (!owned()) return null;
        options.viewer.clear('user', { preserveCamera: true });
        throw error;
      } finally {
        if (recording === attempt) recording = null;
        deadline.dispose();
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}
export type StoredRouteDisplay = ReturnType<typeof createStoredRouteDisplay>;
