import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { fetchProjectModels, ProjectModelApiError, type ProjectModelVersion } from '@/api/projectModels';
import { ViewerController, type ViewerEvent } from '@/viewer/ViewerController';
import { generateId } from '@/utils/generateId';
type Scope = { projectId: string | null; loadedProjectId: string | null; token: string | null };
export type RoutingViewerPhase = 'metadata' | 'loading' | 'ready' | 'no-model' | 'missing-model' | 'unavailable' | 'access-denied' | 'login-required' | 'error';
type State = { scope: Scope; lifecycleKey: string | null; phase: RoutingViewerPhase; message: string; model: ProjectModelVersion | null };
type Load = NonNullable<ReturnType<ViewerController['getLoadSnapshot']>>;
type Run = { scope: Scope; closed: boolean; metadata: AbortController; controller: ViewerController | null };
const initial = (scope: Scope): State => ({ scope, lifecycleKey: null, phase: 'metadata', message: 'Checking the active model…', model: null });
const errors: Record<string, string> = {
  LOGIN_REFRESH_REQUIRED: 'Sign in again to open the protected model.',
  AUTH_REQUIRED: 'Sign in again to open the protected model.',
  SESSION_EXPIRED: 'Your viewer session has expired. Retry to check your access and reload the model.',
  ACCESS_REVOKED: 'Access to this project has ended.', ACCESS_DENIED: 'Access to this project has ended.',
  PROJECT_NOT_FOUND: 'This project is no longer available.',
  MODEL_SELECTION_CHANGED: 'The active model selection changed. Retry to load the current selection.',
  MODEL_UNAVAILABLE: 'The active model is unavailable. Retry to check its availability.',
  VIEWER_ORIGIN_DENIED: 'The 3D viewer is not enabled for this server address. Check the server\'s viewer address settings, then retry. (VIEWER_ORIGIN_DENIED)',
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
  const fail = useCallback((run: Run, code: string, status?: number | null) => {
    if (!current(run)) return;
    run.metadata.abort(); run.controller?.dispose('reload');
    const phase = ['LOGIN_REFRESH_REQUIRED', 'AUTH_REQUIRED'].includes(code) || status === 401 ? 'login-required'
      : ['ACCESS_REVOKED', 'ACCESS_DENIED', 'PROJECT_NOT_FOUND'].includes(code) || status === 403 || status === 404 ? 'access-denied'
        : code === 'MODEL_UNAVAILABLE' ? 'unavailable' : 'error';
    update(run, { lifecycleKey: null, phase, message: loadFailureMessage(code) });
    run.closed = true;
  }, [current, update]);
  useEffect(() => {
    const run: Run = { scope, closed: false, metadata: new AbortController(), controller: null };
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
            update(run, { lifecycleKey: generateId(), phase: 'loading', message: 'Loading the model, identifiers and properties…' });
          } else if (event.type === 'MODEL_LOADED') {
            const loaded = run.controller?.getLoadSnapshot();
            if (!loaded?.ready || loaded.modelVersionId !== model.id || loaded.projectId !== scope.projectId || !identityMatches(event, loaded)) return;
            update(run, { phase: 'ready', message: 'The model and its identifiers are ready.' });
          } else if (event.type === 'MODEL_PROGRESS') {
            const loading = run.controller?.getLoadSnapshot();
            if (loading && !loading.ready) {
              update(run, { phase: 'loading', message: 'Loading the model, identifiers and properties…' });
            }
          } else if (event.type === 'ERROR') {
            // A failed dynamic CAD overlay must not retire the healthy client model.
            if (String(event.payload.code) === 'CAD_COMPONENT_FAILED' &&
                String(event.payload.operation).startsWith('CAD_')) {
              update(run, { message: 'The client model is ready; a CAD component could not be displayed.' });
            } else fail(run, String(event.payload.code));
          }
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
      run.closed = true; run.metadata.abort(); run.controller?.dispose('unmount');
      if (runRef.current === run) runRef.current = null;
    };
  }, [scope, retryId, container, current, update, fail]);

  const retry = useCallback(() => {
    const run = runRef.current;
    if (latestScope.current !== scope || run && run.scope !== scope) return;
    if (run) { run.closed = true; run.metadata.abort(); run.controller?.dispose('reload'); }
    setState(initial(scope)); setRetryId(value => value + 1);
  }, [scope]);
  const pickCadAnchor = useCallback(async (): ReturnType<ViewerController['pickPoint']> => {
    const run = runRef.current;
    if (!run || run.scope !== scope || !current(run) || !run.controller?.getLoadSnapshot()?.ready) {
      throw new Error('Active model unavailable for point selection.');
    }
    return run.controller.pickPoint();
  }, [scope, current]);
  const showCadComponent = useCallback(async (...args: Parameters<ViewerController['showCadComponent']>): Promise<void> => {
    const run = runRef.current;
    if (!run || run.scope !== scope || !current(run) || !run.controller?.getLoadSnapshot()?.ready) throw new Error('Active model unavailable.');
    await run.controller.showCadComponent(...args);
  }, [scope, current]);
  const moveCadComponent = useCallback(async (...args: Parameters<ViewerController['moveCadComponent']>): Promise<void> => {
    const run = runRef.current;
    if (!run || run.scope !== scope || !current(run) || !run.controller?.getLoadSnapshot()?.ready) throw new Error('Active model unavailable.');
    await run.controller.moveCadComponent(...args);
  }, [scope, current]);
  const removeCadComponent = useCallback(async (...args: Parameters<ViewerController['removeCadComponent']>): Promise<void> => {
    const run = runRef.current;
    if (!run || run.scope !== scope || !current(run) || !run.controller?.getLoadSnapshot()?.ready) return;
    await run.controller.removeCadComponent(...args);
  }, [scope, current]);
  const focusCadComponent = useCallback(async (componentId: string): Promise<void> => {
    const run = runRef.current;
    if (!run || run.scope !== scope || !current(run) || !run.controller?.getLoadSnapshot()?.ready) throw new Error('Active model unavailable.');
    await run.controller.focusCadComponent(componentId);
  }, [scope, current]);
  const setCadComponentColor = useCallback(async (...args: Parameters<ViewerController['setCadComponentColor']>): Promise<void> => {
    const run = runRef.current;
    if (!run || run.scope !== scope || !current(run) || !run.controller?.getLoadSnapshot()?.ready) throw new Error('Active model unavailable.');
    await run.controller.setCadComponentColor(...args);
  }, [scope, current]);
  const setCadComponentVisibility = useCallback(async (...args: Parameters<ViewerController['setCadComponentVisibility']>): Promise<void> => {
    const run = runRef.current;
    if (!run || run.scope !== scope || !current(run) || !run.controller?.getLoadSnapshot()?.ready) throw new Error('Active model unavailable.');
    await run.controller.setCadComponentVisibility(...args);
  }, [scope, current]);
  const setCadComponentProperties = useCallback(async (...args: Parameters<ViewerController['setCadComponentProperties']>): Promise<void> => {
    const run = runRef.current;
    if (!run || run.scope !== scope || !current(run) || !run.controller?.getLoadSnapshot()?.ready) throw new Error('Active model unavailable.');
    await run.controller.setCadComponentProperties(...args);
  }, [scope, current]);
  const visible = state.scope === scope ? state : initial(scope);
  return { ...visible, pickCadAnchor, showCadComponent, moveCadComponent, removeCadComponent, focusCadComponent,
    setCadComponentColor, setCadComponentVisibility, setCadComponentProperties, retry, canShow: visible.phase === 'ready' };
}
