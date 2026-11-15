import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { fetchProjectModels, ProjectModelApiError, type ProjectModelVersion } from '@/api/projectModels';
import { fetchRoutingTrays, RoutingTrayApiError, type RoutingTray } from '@/api/routingTrays';
import { ViewerController, type ViewerEvent } from '@/viewer/ViewerController';
import { generateId } from '@/utils/generateId';
import { isUuid } from '../../../../viewer-runtime/protocol.mjs';
import {
  aggregateRouteCheck, buildProjectRouteCheck, createLocalRouteCheck, parseRouteInput,
  type RouteAttempt, type RouteCheckResult,
} from '@/viewer/routeValidation';

type Scope = { projectId: string | null; loadedProjectId: string | null; token: string | null };
export type RoutingViewerPhase = 'metadata' | 'loading' | 'ready' | 'no-model' | 'missing-model' | 'unavailable' | 'access-denied' | 'login-required' | 'error';
export type CableRouteSnapshot = Readonly<{ id: string; projectId: string; routing: string | null }>;
type RouteInput = Readonly<{ rawRouting: string; source: 'manual'; cableId: null } | { rawRouting: string; source: 'cable'; cableId: string }>;
export type CurrentRoute = RouteInput & Readonly<{ operationId: string }>;
type State = { scope: Scope; lifecycleKey: string | null; phase: RoutingViewerPhase; message: string; model: ProjectModelVersion | null; checking: boolean; result: RouteCheckResult | null; operationId: string | null; currentRoute: CurrentRoute | null };
type Load = NonNullable<ReturnType<ViewerController['getLoadSnapshot']>>;
type EarlyReply = { event: ViewerEvent } | { mismatch: true };
type Attempt = { readonly operationId: string; readonly load: Load; readonly input: RouteInput; readonly originalCableRouting?: string | null;
  requestId: string | null; abort: AbortController; earlyReplies: Map<string, EarlyReply>; event?: ViewerEvent; trays?: RoutingTray[] | null; databaseDone: boolean; result?: RouteCheckResult };
type Run = { scope: Scope; closed: boolean; metadata: AbortController; controller: ViewerController | null; attempt: Attempt | null };

const initial = (scope: Scope): State => ({ scope, lifecycleKey: null, phase: 'metadata', message: 'Checking the active model…', model: null, checking: false, result: null, operationId: null, currentRoute: null });
const errors: Record<string, string> = {
  LOGIN_REFRESH_REQUIRED: 'Sign in again to open the protected model.',
  AUTH_REQUIRED: 'Sign in again to open the protected model.',
  SESSION_EXPIRED: 'Your viewer session has expired. Retry to check your access and reload the model.',
  ACCESS_REVOKED: 'Access to this project has ended.', ACCESS_DENIED: 'Access to this project has ended.',
  PROJECT_NOT_FOUND: 'This project is no longer available.',
  MODEL_SELECTION_CHANGED: 'The active model selection changed. Retry to load the current selection.',
  MODEL_UNAVAILABLE: 'The active model is unavailable. Retry to check its availability.',
  VIEWER_ORIGIN_DENIED: 'The 3D viewer is not enabled for this server address. Check the server\'s viewer address settings, then retry. (VIEWER_ORIGIN_DENIED)',
  ROUTE_RESULT_MISMATCH: 'The route response did not match the current check. Retry to reload the model.',
  METADATA_FAILED: 'Project model information could not be read. Retry to check the current active model.',
};
// Show only public, known failure codes; never echo arbitrary server/frame error text.
const loadFailureCodes = new Set(['RUNTIME_TIMEOUT', 'MODEL_TIMEOUT', 'REQUEST_TIMEOUT', 'SESSION_FAILED',
  'SESSION_RENEW_FAILED', 'ACCESS_CHECK_FAILED', 'RESOURCE_FAILED', 'RESOURCE_NOT_FOUND', 'VIEWER_BUSY',
  'VIEWER_STOPPED', 'STORAGE_EXHAUSTED', 'VIEWER_FAILURE', 'INVALID_VIEWER_REQUEST']);
const loadFailureMessage = (code: string): string => errors[code] ??
  `The protected model could not be loaded. Retry to check the active model and your access.${loadFailureCodes.has(code) ? ` (${code})` : ''}`;
const identityMatches = (event: ViewerEvent, load: Load): boolean => Boolean(event.identity &&
  event.identity.protocolVersion === 1 && event.identity.instanceId === load.instanceId && event.identity.projectId === load.projectId &&
  event.identity.modelVersionId === load.modelVersionId && event.identity.loadId === load.loadId);
const routeAttempt = (attempt: Attempt): RouteAttempt => ({
  protocolVersion: 1, instanceId: attempt.load.instanceId, projectId: attempt.load.projectId,
  modelVersionId: attempt.load.modelVersionId!, loadId: attempt.load.loadId!, requestId: attempt.requestId!,
  operationId: attempt.operationId, ...attempt.input,
});

export function useRoutingsViewer({ projectId, loadedProjectId, token, container }: Scope & { container: RefObject<HTMLDivElement | null> }) {
  const scope = useMemo(() => ({ projectId, loadedProjectId, token }), [projectId, loadedProjectId, token]);
  const latestScope = useRef(scope); latestScope.current = scope;
  const runRef = useRef<Run | null>(null);
  const [retryId, setRetryId] = useState(0);
  const [state, setState] = useState(() => initial(scope));
  const current = useCallback((run: Run) => !run.closed && runRef.current === run && latestScope.current === run.scope, []);
  const update = useCallback((run: Run, change: Partial<Omit<State, 'scope'>>) => {
    if (current(run)) setState(previous => ({ ...(previous.scope === run.scope ? previous : initial(run.scope)), ...change }));
  }, [current]);
  const cancelAttempt = useCallback((run: Run, notifyController = true) => {
    const attempt = run.attempt; run.attempt = null;
    attempt?.abort.abort();
    attempt?.earlyReplies.clear();
    if (notifyController && attempt?.requestId) { try { run.controller?.cancel(attempt.requestId); } catch { /* A terminal controller is already retiring. */ } }
  }, []);
  const fail = useCallback((run: Run, code: string, status?: number | null) => {
    if (!current(run)) return;
    cancelAttempt(run);
    run.metadata.abort(); run.controller?.dispose('reload');
    const phase = ['LOGIN_REFRESH_REQUIRED', 'AUTH_REQUIRED'].includes(code) || status === 401 ? 'login-required'
      : ['ACCESS_REVOKED', 'ACCESS_DENIED', 'PROJECT_NOT_FOUND'].includes(code) || status === 403 || status === 404 ? 'access-denied'
        : code === 'MODEL_UNAVAILABLE' ? 'unavailable' : 'error';
    update(run, { lifecycleKey: null, phase, checking: false, result: null, operationId: null, currentRoute: null, message: loadFailureMessage(code) });
    run.closed = true;
  }, [cancelAttempt, current, update]);
  const combine = useCallback((run: Run, attempt: Attempt) => {
    if (!current(run) || run.attempt !== attempt || !attempt.requestId || !attempt.event || !attempt.databaseDone) return;
    try {
      const expected = routeAttempt(attempt);
      const result = aggregateRouteCheck(expected, attempt.event, buildProjectRouteCheck(expected, attempt.trays ?? null));
      attempt.result = result;
      update(run, { checking: false, result, operationId: attempt.operationId });
    } catch { fail(run, 'ROUTE_RESULT_MISMATCH'); }
  }, [current, fail, update]);

  useEffect(() => {
    const run: Run = { scope, closed: false, metadata: new AbortController(), controller: null, attempt: null };
    // Public information UI lifecycle only; it carries no controller/session/private frame state.
    runRef.current = run; update(run, { ...initial(scope), lifecycleKey: generateId() });
    const start = async () => {
      if (!scope.projectId || !scope.token || scope.projectId !== scope.loadedProjectId || !container.current) {
        update(run, { phase: 'access-denied', message: 'Project access must be refreshed before opening the viewer.' }); return;
      }
      try {
        const snapshot = await fetchProjectModels(scope.projectId, scope.token, { signal: run.metadata.signal });
        if (!current(run)) return;
        const id = snapshot.selection.activeModelVersionId;
        if (!id) { update(run, { phase: 'no-model', message: 'No model is selected. Select a prepared model in Details before opening the viewer.' }); return; }
        const model = snapshot.versions.find(version => version.id === id);
        if (!model) { update(run, { phase: 'missing-model', message: 'The selected model is missing from the project model list. Retry to check the current selection.' }); return; }
        if (model.health !== 'healthy') { update(run, { model, phase: 'unavailable', message: 'The active model is unavailable or has not been verified. Retry to check its availability.' }); return; }
        update(run, { model, phase: 'loading', message: 'Loading the model, identifiers and properties…' });
        const onEvent = (event: ViewerEvent) => {
          if (!current(run)) return;
          if (event.type === 'RUNTIME_READY') {
            void run.controller?.load(model.id).catch(() => fail(run, 'RESOURCE_FAILED'));
          } else if (event.type === 'MODEL_LOADING') {
            // The controller has already invalidated the old load and its pending commands.
            cancelAttempt(run, false);
            update(run, { lifecycleKey: generateId(), phase: 'loading', message: 'Loading the model, identifiers and properties…', checking: false, result: null, operationId: null, currentRoute: null });
          } else if (event.type === 'MODEL_LOADED') {
            const loaded = run.controller?.getLoadSnapshot();
            if (!loaded?.ready || loaded.modelVersionId !== model.id || loaded.projectId !== scope.projectId || !identityMatches(event, loaded)) return;
            update(run, { phase: 'ready', message: 'The model and its identifiers are ready.' });
          } else if (event.type === 'MODEL_PROGRESS') {
            const loading = run.controller?.getLoadSnapshot();
            if (loading && !loading.ready) {
              cancelAttempt(run, false);
              update(run, { phase: 'loading', message: 'Loading the model, identifiers and properties…', checking: false, result: null, operationId: null, currentRoute: null });
            }
          } else if (event.type === 'ROUTE_RESULT') {
            const attempt = run.attempt;
            if (!attempt || !event.requestId || !identityMatches(event, attempt.load) || attempt.requestId && event.requestId !== attempt.requestId) return;
            // Match the exact returned request before promoting any reply received during showRoute's access check.
            if (!attempt.requestId) {
              if (attempt.earlyReplies.has(event.requestId)) return;
              if (attempt.earlyReplies.size >= 8) attempt.earlyReplies.delete(attempt.earlyReplies.keys().next().value!);
              const matches = event.payload.rawRouting === attempt.input.rawRouting && event.payload.source === attempt.input.source && event.payload.cableId === attempt.input.cableId;
              attempt.earlyReplies.set(event.requestId, matches ? { event } : { mismatch: true });
              return;
            }
            if (!attempt.event) attempt.event = event;
            combine(run, attempt);
          } else if (event.type === 'ERROR') fail(run, String(event.payload.code));
        };
        run.controller = new ViewerController({ container: container.current!, projectId: scope.projectId, token: scope.token, onEvent });
      } catch (error) {
        if (!current(run) || run.metadata.signal.aborted) return;
        const accessError = error instanceof ProjectModelApiError && ([401, 403, 404].includes(error.status ?? 0) || ['AUTH_REQUIRED', 'ACCESS_DENIED', 'PROJECT_NOT_FOUND'].includes(error.code));
        fail(run, accessError ? error.code : 'METADATA_FAILED', error instanceof ProjectModelApiError ? error.status : null);
      }
    };
    void start();
    return () => {
      run.closed = true; cancelAttempt(run); run.metadata.abort(); run.controller?.dispose('unmount');
      if (runRef.current === run) runRef.current = null;
    };
  }, [scope, retryId, container, current, update, cancelAttempt, combine, fail]);

  const showInput = useCallback(async (input: RouteInput, originalCableRouting?: string | null) => {
    const run = runRef.current;
    const loaded = run?.controller?.getLoadSnapshot();
    if (!run || run.scope !== scope || !current(run) || !loaded?.ready || loaded.projectId !== scope.projectId || !scope.projectId || !scope.token) return;
    cancelAttempt(run);
    const frozenInput = Object.freeze({ ...input });
    const attempt: Attempt = { operationId: generateId(), load: loaded, input: frozenInput, originalCableRouting, requestId: null, abort: new AbortController(), earlyReplies: new Map(), databaseDone: false };
    const currentRoute: CurrentRoute = Object.freeze({ ...frozenInput, operationId: attempt.operationId });
    run.attempt = attempt; update(run, { checking: true, result: null, operationId: null, currentRoute });
    const parsed = parseRouteInput(frozenInput.rawRouting);
    if (parsed.status !== 'valid' || parsed.segments.length === 0) {
      try {
        attempt.requestId = run.controller!.clear(parsed.status === 'invalid' ? 'selection' : 'empty');
        attempt.result = createLocalRouteCheck(routeAttempt(attempt));
        update(run, { checking: false, result: attempt.result, operationId: attempt.operationId });
      } catch { fail(run, 'RESOURCE_FAILED'); }
      return;
    }
    void fetchRoutingTrays(scope.projectId, scope.token, { signal: attempt.abort.signal }).then(trays => {
      if (!current(run) || run.attempt !== attempt) return;
      attempt.trays = trays; attempt.databaseDone = true; combine(run, attempt);
    }, error => {
      if (!current(run) || run.attempt !== attempt || attempt.abort.signal.aborted) return;
      if (error instanceof RoutingTrayApiError && error.accessFailure) { fail(run, error.code, error.status); return; }
      attempt.trays = null; attempt.databaseDone = true; combine(run, attempt);
    });
    try {
      const requestId = await run.controller!.showRoute(frozenInput.rawRouting, frozenInput.source, frozenInput.cableId);
      if (!current(run) || run.attempt !== attempt) return;
      if (!requestId) { cancelAttempt(run); update(run, { checking: false, currentRoute: null }); return; }
      attempt.requestId = requestId;
      const early = attempt.earlyReplies.get(requestId); attempt.earlyReplies.clear();
      if (early && 'mismatch' in early) { fail(run, 'ROUTE_RESULT_MISMATCH'); return; }
      attempt.event = early?.event; combine(run, attempt);
    } catch { if (current(run) && run.attempt === attempt) fail(run, 'RESOURCE_FAILED'); }
  }, [scope, current, cancelAttempt, update, combine, fail]);
  const show = useCallback((rawRouting: string) => showInput({ rawRouting, source: 'manual', cableId: null }), [showInput]);
  const showCable = useCallback((snapshot: CableRouteSnapshot): Promise<void> => {
    if (!snapshot || !isUuid(snapshot.id) || snapshot.projectId !== scope.projectId || !(snapshot.routing === null || typeof snapshot.routing === 'string')) return Promise.resolve();
    return showInput({ rawRouting: snapshot.routing ?? '', source: 'cable', cableId: snapshot.id }, snapshot.routing);
  }, [scope, showInput]);
  const clear = useCallback(() => {
    const run = runRef.current;
    if (!run || run.scope !== scope || !current(run)) return;
    cancelAttempt(run); update(run, { checking: false, result: null, operationId: null, currentRoute: null });
    try { run.controller?.clear('user'); } catch { /* Terminal state already explains why the model is unavailable. */ }
  }, [scope, current, cancelAttempt, update]);
  const invalidateCableRoute = useCallback((cableId: string, expectedOriginalRouting?: string | null) => {
    const run = runRef.current, attempt = run?.attempt;
    if (!run || run.scope !== scope || !current(run) || attempt?.input.source !== 'cable' || attempt.input.cableId !== cableId ||
      expectedOriginalRouting !== undefined && attempt.originalCableRouting !== expectedOriginalRouting) return;
    clear();
  }, [scope, current, clear]);
  const retryRoute = useCallback((latestConfirmedCable?: CableRouteSnapshot | null): Promise<void> => {
    const run = runRef.current, attempt = run?.attempt;
    if (!run || run.scope !== scope || !current(run) || !attempt) return Promise.resolve();
    if (attempt.input.source === 'manual') return show(attempt.input.rawRouting);
    if (!latestConfirmedCable || latestConfirmedCable.id !== attempt.input.cableId) return Promise.resolve();
    return showCable(latestConfirmedCable);
  }, [scope, current, show, showCable]);
  const terminateAccess = useCallback((code: string, status: number | null) => {
    const run = runRef.current;
    if (!run || run.scope !== scope || !current(run) || ![401, 403, 404].includes(status ?? 0)) return;
    const fallback = status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'ACCESS_DENIED' : 'PROJECT_NOT_FOUND';
    fail(run, Object.hasOwn(errors, code) ? code : fallback, status);
  }, [scope, current, fail]);
  const zoom = useCallback(() => {
    const run = runRef.current;
    const result = run?.attempt?.result;
    if (!run || run.scope !== scope || !current(run) || !result || result.drawableCount === 0 || result.lineCount === 0) return;
    try { run.controller?.zoom(); } catch { clear(); }
  }, [scope, current, clear]);
  const retry = useCallback(() => {
    const run = runRef.current;
    if (latestScope.current !== scope || run && run.scope !== scope) return;
    if (run) { run.closed = true; cancelAttempt(run); run.metadata.abort(); run.controller?.dispose('reload'); }
    setState(initial(scope)); setRetryId(value => value + 1);
  }, [scope, cancelAttempt]);
  const visible = state.scope === scope ? state : initial(scope);
  return { ...visible, show, showCable, invalidateCableRoute, retryRoute, terminateAccess, clear, zoom, retry, canShow: visible.phase === 'ready', canZoom: visible.phase === 'ready' && !visible.checking && Boolean(visible.result && visible.result.drawableCount > 0 && visible.result.lineCount > 0) };
}
