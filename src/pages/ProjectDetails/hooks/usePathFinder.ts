import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { fetchPathFinderState, fetchPathFinderProposal, fetchPathFinderJob, fetchPathFinderLookup, fetchPathFinderLookupPlan, fetchPathFinderPreview, parsePathFinderProposal, pathFinderRequest, PathFinderApiError, type PathFinderState, type PathFinderProposal, type PathFinderPreferences, type PathFinderPreviewInput } from '@/api/pathfinder';
import { fetchProjectModels } from '@/api/projectModels';
import { ViewerController, type ViewerEvent } from '@/viewer/ViewerController';
import { ViewerAccessError } from '@/viewer/sessionApi';
import type { CanonicalPoint, ComputedPath, PickedPoint, ViewerModelObjectsPage, ModelCaptureRequest } from '../../../../viewer-runtime/protocol.mjs';

type Options = { projectId: string | null; loadedProjectId: string | null; token: string | null; isAdmin: boolean; container: RefObject<HTMLDivElement | null> };
type View = { data: PathFinderState | null; loading: boolean; busy: boolean; error: string | null; viewerPhase: 'loading' | 'ready' | 'no-model' | 'error'; viewerMessage: string };
type Run = { closed: boolean; abort: AbortController; viewer: ViewerController | null; modelVersionId: string | null; selectionRevision: string | null };
const initial: View = { data: null, loading: true, busy: false, error: null, viewerPhase: 'loading', viewerMessage: 'Checking the active model…' };
const message = (error: unknown) => error instanceof PathFinderApiError ? error.message : error instanceof ViewerAccessError && error.code === 'APPEARANCE_RESTORE_FAILED' ? new PathFinderApiError(error.code, 0).message : error instanceof ViewerAccessError && error.code === 'LOOKUP_GEOMETRY_NOT_FOUND' ? 'No display-visible route geometry matches the lookup. Check the route names and model visibility.' : error instanceof ViewerAccessError && error.code === 'CAPTURE_RELOAD_REQUIRED' ? 'Reload the model before preparing another snapshot; the bounded command budget has been reached.' : error instanceof ViewerAccessError && error.code === 'EXTRACTION_FAILED' ? 'The selected model capture could not be completed within its limits. Reduce the network or equipment scope and try again.' : error instanceof DOMException && error.name === 'AbortError' ? 'The operation was cancelled.' : 'The operation could not be completed. Refresh Path Finder and try again.';

export function usePathFinder({ projectId, loadedProjectId, token, isAdmin, container }: Options) {
  const scope = useMemo(() => ({ projectId, loadedProjectId, token, isAdmin }), [projectId, loadedProjectId, token, isAdmin]);
  const latest = useRef(scope); latest.current = scope;
  const renderedScope = useRef(scope);
  const runRef = useRef<Run | null>(null), dataRef = useRef<PathFinderState | null>(null);
  const lookupCapture = useRef<AbortController | null>(null);
  const planningCapture = useRef<AbortController | null>(null);
  const [revision, setRevision] = useState(0), [view, setView] = useState<View>(initial);
  const live = useCallback((run: Run) => !run.closed && runRef.current === run && latest.current === scope, [scope]);
  const update = useCallback((run: Run, patch: Partial<View>) => { if (live(run)) setView(previous => ({ ...previous, ...patch })); }, [live]);
  const accessFailure = useCallback((run: Run, error: unknown) => {
    if (error instanceof PathFinderApiError && [401, 403, 404].includes(error.status)) { run.viewer?.dispose('reload'); dataRef.current = null; update(run, { data: null, busy: false, loading: false, error: error.message, viewerPhase: 'error', viewerMessage: error.message }); run.closed = true; run.abort.abort(); }
  }, [update]);
  const refresh = useCallback(async (run = runRef.current): Promise<PathFinderState | null> => {
    if (!run || !live(run) || !projectId || !token || !isAdmin) return null;
    try {
      const data = await fetchPathFinderState(projectId, token, run.abort.signal);
      if (!live(run)) return null;
      dataRef.current = data; update(run, { data, loading: false, error: null });
      if (run.modelVersionId !== data.activeModel.modelVersionId || run.selectionRevision !== data.activeModel.selectionRevision) {
        run.viewer?.dispose('reload'); setRevision(value => value + 1);
      }
      return data;
    } catch (error) { if (live(run)) { accessFailure(run, error); update(run, { loading: false, error: message(error) }); } return null; }
  }, [accessFailure, isAdmin, live, projectId, token, update]);
  useEffect(() => {
    const run: Run = { closed: false, abort: new AbortController(), viewer: null, modelVersionId: null, selectionRevision: null };
    runRef.current = run; dataRef.current = null; renderedScope.current = scope; setView(initial);
    if (!projectId || !token || !isAdmin || projectId !== loadedProjectId || !container.current) {
      update(run, { loading: false, viewerPhase: 'error', viewerMessage: 'Current administrator project access is required.', error: 'Path Finder is available only to administrators.' });
      return () => { run.closed = true; run.abort.abort(); };
    }
    void (async () => {
      try {
        const [data, models] = await Promise.all([fetchPathFinderState(projectId, token, run.abort.signal), fetchProjectModels(projectId, token, { signal: run.abort.signal })]);
        if (!live(run)) return;
        dataRef.current = data; run.modelVersionId = data.activeModel.modelVersionId; run.selectionRevision = data.activeModel.selectionRevision;
        update(run, { data, loading: false });
        const model = models.versions.find(value => value.id === run.modelVersionId);
        if (!run.modelVersionId) { update(run, { viewerPhase: 'no-model', viewerMessage: 'Select a prepared model in Project Details.' }); return; }
        if (!model || model.health !== 'healthy' || models.selection.activeModelVersionId !== run.modelVersionId || String(models.selection.selectionRevision) !== run.selectionRevision) throw new Error('Active model unavailable');
        const onEvent = (event: ViewerEvent) => {
          if (!live(run)) return;
          if (event.type === 'RUNTIME_READY' && run.modelVersionId) void run.viewer?.load(run.modelVersionId);
          if (event.type === 'MODEL_LOADING') update(run, { viewerPhase: 'loading', viewerMessage: 'Loading the protected model…' });
          if (event.type === 'MODEL_LOADED') update(run, { viewerPhase: 'ready', viewerMessage: 'The active model is ready.' });
          if (event.type === 'ROUTE_CLEARED') update(run, { error: null });
          if (event.type === 'MODEL_CAPTURE_PROGRESS') update(run, { viewerMessage: `Preparing ${event.payload.phase === 'properties' ? 'equipment candidates' : event.payload.phase === 'geometry' ? 'routing geometry' : 'model identifiers'}: ${Number(event.payload.loaded).toLocaleString()} / ${Number(event.payload.total).toLocaleString()}…` });
          if (event.type === 'ERROR') {
            const code = String(event.payload.code), terminal = event.payload.operation === 'viewer' || ['SESSION_EXPIRED', 'ACCESS_REVOKED', 'MODEL_SELECTION_CHANGED', 'MODEL_UNAVAILABLE', 'RESOURCE_FAILED'].includes(code);
            update(run, terminal ? { viewerPhase: 'error', viewerMessage: 'Model access ended or the model changed. Refresh Path Finder to reload.', error: 'The protected viewer operation could not be completed.' }
              : { viewerMessage: 'The active model is ready.', error: message(new ViewerAccessError(code, 0)) });
          }
        };
        run.viewer = new ViewerController({ container: container.current!, projectId, token, onEvent });
      } catch (error) { if (live(run)) { accessFailure(run, error); update(run, { loading: false, viewerPhase: 'error', viewerMessage: 'The active model is unavailable. Refresh to check again.', error: message(error) }); } }
    })();
    let pollTimer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!live(run)) return;
      if (run.selectionRevision !== null) await refresh(run);
      if (live(run)) pollTimer = setTimeout(() => void poll(), dataRef.current?.jobs.some(job => ['queued', 'running'].includes(job.status)) ? 2000 : 15000);
    };
    pollTimer = setTimeout(() => void poll(), 15000);
    return () => { clearTimeout(pollTimer); run.closed = true; run.abort.abort(); run.viewer?.dispose('unmount'); };
  }, [accessFailure, container, isAdmin, live, loadedProjectId, projectId, refresh, revision, scope, token, update]);
  const perform = useCallback(async <T,>(operation: (data: PathFinderState, run: Run) => Promise<T>): Promise<T | null> => {
    const run = runRef.current, data = dataRef.current;
    if (!run || !data || !live(run) || !isAdmin) return null;
    update(run, { busy: true, error: null });
    try { const result = await operation(data, run); if (!live(run)) return null; await refresh(run); return result; }
    catch (error) { if (live(run)) { accessFailure(run, error); update(run, { error: message(error) }); } return null; }
    finally { update(run, { busy: false }); }
  }, [accessFailure, isAdmin, live, refresh, update]);
  const action = useCallback((path: string, body?: unknown, method: 'POST' | 'PUT' | 'DELETE' = 'POST') => perform(async (_data, run) => pathFinderRequest(projectId!, token!, path, method, body, run.abort.signal)), [perform, projectId, token]);
  const matchAll = useCallback(() => perform((data, run) => pathFinderRequest(projectId!, token!, '/match', 'POST', { expectedRegistryRevision: data.registryRevision }, run.abort.signal)), [perform, projectId, token]);
  const saveLocation = useCallback((input: { name: string; aliases: string[]; locationId: string | null; point: CanonicalPoint; objectId: string | null; externalId: string | null; derivation?: 'manual-world-point' | 'picked-surface-point' | 'equipment-bottom-aabb' }) => perform(async (data, run) => {
    let locationId = input.locationId, current = data;
    if (!locationId) {
      const created = await pathFinderRequest(projectId!, token!, '/locations', 'POST', { name: input.name, aliases: input.aliases, expectedRegistryRevision: current.registryRevision }, run.abort.signal);
      if (typeof created.locationId !== 'string') throw new Error('Invalid location response'); locationId = created.locationId;
      current = await fetchPathFinderState(projectId!, token!, run.abort.signal);
    } else {
      const existing = current.locations.find(item => item.id === locationId);
      if (existing && (existing.name !== input.name || JSON.stringify(existing.aliases) !== JSON.stringify(input.aliases))) {
        await pathFinderRequest(projectId!, token!, `/locations/${locationId}`, 'PUT', { name: input.name, aliases: input.aliases, expectedRegistryRevision: current.registryRevision }, run.abort.signal);
        current = await fetchPathFinderState(projectId!, token!, run.abort.signal);
      }
    }
    if (!current.activeModel.modelVersionId) throw new Error('No active model');
    return pathFinderRequest(projectId!, token!, `/locations/${locationId}/binding`, 'PUT', { modelVersionId: current.activeModel.modelVersionId,
      expectedSelectionRevision: current.activeModel.selectionRevision, expectedRegistryRevision: current.registryRevision, point: input.point, objectId: input.objectId, externalId: input.externalId, derivation: input.derivation ?? 'manual-world-point' }, run.abort.signal);
  }), [perform, projectId, token]);
  const uploadSnapshot = useCallback((snapshot: unknown) => perform((data, run) => pathFinderRequest(projectId!, token!, '/artifacts', 'POST', { modelVersionId: data.activeModel.modelVersionId, expectedSelectionRevision: data.activeModel.selectionRevision, expectedRegistryRevision: data.registryRevision, snapshot }, run.abort.signal)), [perform, projectId, token]);
  const calculate = useCallback((cableIds?: string[], force = false, preferences?: PathFinderPreferences) => perform((data, run) => pathFinderRequest(projectId!, token!, '/jobs', 'POST', {
    ...(cableIds ? { cableIds } : {}), expectedRegistryRevision: data.registryRevision, force,
    ...(preferences ? { options: { connectionToleranceMeters: Number(data.settings.connectionGap), sampleSpacingMeters: 0.125, maxGraphNodes: 200_000, maxGraphConnections: 1_000_000, ...preferences } } : {}),
  }, run.abort.signal)), [perform, projectId, token]);
  const readProposal = useCallback((proposalId: string) => perform((_data, run) => fetchPathFinderProposal(projectId!, token!, proposalId, run.abort.signal)), [perform, projectId, token]);
  const readJob = useCallback((jobId: string) => perform((_data, run) => fetchPathFinderJob(projectId!, token!, jobId, run.abort.signal)), [perform, projectId, token]);
  const reviewProposal = useCallback((proposal: PathFinderProposal) => perform(async (_data, run) => {
    const result = await pathFinderRequest(projectId!, token!, `/proposals/${proposal.id}/review`, 'POST', { expectedProposalHash: proposal.proposalHash }, run.abort.signal);
    if (typeof result.reviewId !== 'string') throw new Error('Invalid review response');
    const reviewed = parsePathFinderProposal(result.proposal);
    if (reviewed.id !== proposal.id || reviewed.projectId !== projectId || reviewed.proposalHash !== proposal.proposalHash) throw new Error('Review identity mismatch');
    return { reviewId: result.reviewId, proposal: reviewed };
  }), [perform, projectId, token]);
  const prepareModel = useCallback((request: ModelCaptureRequest, isCurrent: () => boolean = () => true) => perform(async (data, run) => {
    if (!run.viewer || !run.viewer.getLoadSnapshot()?.ready) throw new Error('The protected model is not ready');
    planningCapture.current?.abort();
    const operation = new AbortController(); planningCapture.current = operation;
    const current = () => { if (operation.signal.aborted || !live(run) || planningCapture.current !== operation || !isCurrent()) throw new DOMException('Model capture cancelled.', 'AbortError'); };
    // Cable spelling and ownership are captured inputs; late state changes require
    // a new preparation, even when the model selection itself did not change.
    const dependencies = (value: PathFinderState) => JSON.stringify({ projectId: value.projectId, activeModel: value.activeModel, registryRevision: value.registryRevision,
      cables: value.cables.map(cable => [cable.id, cable.fromLocation, cable.toLocation]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) });
    const frozenDependencies = dependencies(data);
    try {
      current();
      const captured = await run.viewer.captureModel(request, progress => update(run, { viewerMessage: `Preparing the selected model: ${progress.index + 1} data batches…` }));
      current();
      const latestData = await fetchPathFinderState(projectId!, token!, AbortSignal.any([run.abort.signal, operation.signal]));
      current();
      if (dependencies(latestData) !== frozenDependencies || dataRef.current && dependencies(dataRef.current) !== frozenDependencies)
        throw new PathFinderApiError('CAPTURE_INPUT_CHANGED', 409);
      const result = await pathFinderRequest(projectId!, token!, '/artifacts', 'POST', { modelVersionId: data.activeModel.modelVersionId, expectedSelectionRevision: data.activeModel.selectionRevision, expectedRegistryRevision: data.registryRevision, snapshot: captured.snapshot }, run.abort.signal);
      return { ...result, captureSummary: captured.summary };
    } finally { if (planningCapture.current === operation) planningCapture.current = null; if (run.viewer.getLoadSnapshot()?.ready) update(run, { viewerMessage: 'The active model is ready.' }); }
  }), [live, perform, projectId, token, update]);
  const startLookup = useCallback((routeText: string, reverse: boolean) => perform(async (data, run) => {
    if (!run.viewer?.getLoadSnapshot()?.ready || !routeText.trim() || routeText.length > 8000) throw new Error('Load the active model and enter a bounded route');
    lookupCapture.current?.abort();
    const operation = new AbortController(); lookupCapture.current = operation;
    const stop = () => operation.abort(); run.abort.signal.addEventListener('abort', stop, { once: true });
    const current = () => { if (operation.signal.aborted || !live(run) || lookupCapture.current !== operation) throw new DOMException('Lookup capture cancelled.', 'AbortError'); };
    try {
      update(run, { viewerMessage: 'Finding the requested logical routes…' });
      const plan = await fetchPathFinderLookupPlan(projectId!, token!, routeText, data.activeModel.selectionRevision, operation.signal);
      current();
      const captured = await run.viewer.captureModel({ lookupRouteCodes: plan.routeCodes, equipmentNames: [] }, progress => update(run, { viewerMessage: `Reading lookup geometry: ${progress.index + 1} data batches…` }));
      current();
      // Once upload begins, keep its scope signal so a deliberate cancellation can
      // receive the accepted job identity and cancel that job, rather than lose it.
      const result = await pathFinderRequest(projectId!, token!, '/lookups', 'POST', { routeText, reverse, expectedSelectionRevision: data.activeModel.selectionRevision, snapshot: captured.snapshot }, run.abort.signal);
      if (typeof result.jobId !== 'string') throw new Error('Invalid lookup response');
      if (operation.signal.aborted && live(run)) await pathFinderRequest(projectId!, token!, `/jobs/${result.jobId}`, 'DELETE', undefined, run.abort.signal);
      current(); return result.jobId;
    } finally {
      run.abort.signal.removeEventListener('abort', stop);
      if (lookupCapture.current === operation) lookupCapture.current = null;
      if (run.viewer?.getLoadSnapshot()?.ready) update(run, { viewerMessage: 'The active model is ready.' });
    }
  }), [live, perform, projectId, token, update]);
  const readLookup = useCallback(async (jobId: string) => {
    const run = runRef.current; if (!run || !live(run) || !projectId || !token || !dataRef.current) return null;
    try { const value = await fetchPathFinderLookup(projectId, token, jobId, run.abort.signal); return live(run) ? value : null; }
    catch (error) { if (live(run)) { accessFailure(run, error); update(run, { error: message(error) }); } return null; }
  }, [accessFailure, live, projectId, token, update]);
  const startPreview = useCallback((input: PathFinderPreviewInput) => perform(async (data, run) => {
    const artifactId = data.artifacts[0]?.id;
    if (!artifactId) throw new Error('Prepare the selected model network before calculating a path');
    const result = await pathFinderRequest(projectId!, token!, '/previews', 'POST', { ...input, artifactId,
      expectedSelectionRevision: data.activeModel.selectionRevision, expectedSettingsRevision: data.settings.revision, expectedRegistryRevision: data.registryRevision }, run.abort.signal);
    if (typeof result.jobId !== 'string') throw new Error('Invalid path preview response'); return result.jobId;
  }), [perform, projectId, token]);
  const readPreview = useCallback(async (jobId: string) => {
    const run = runRef.current; if (!run || !live(run) || !projectId || !token || !dataRef.current) return null;
    try { const value = await fetchPathFinderPreview(projectId, token, jobId, run.abort.signal); return live(run) ? value : null; }
    catch (error) { if (live(run)) { accessFailure(run, error); update(run, { error: message(error) }); } return null; }
  }, [accessFailure, live, projectId, token, update]);
  const running = view.data?.jobs.some(job => ['queued', 'running'].includes(job.status)) ?? false;
  useEffect(() => { if (!running) return; const timer = setInterval(() => void refresh(), 2000); return () => clearInterval(timer); }, [refresh, running]);
  const viewerAction = useCallback(async <T,>(operation: (viewer: ViewerController) => Promise<T>): Promise<T | null> => {
    const run = runRef.current; if (!run || !live(run) || !run.viewer) return null;
    try { const result = await operation(run.viewer); return live(run) ? result : null; } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) update(run, { error: message(error) }); return null; }
  }, [live, update]);
  const visible = renderedScope.current === scope ? view : initial;
  const clear = useCallback(() => { try { runRef.current?.viewer?.clear(); } catch { /* A terminal viewer is already closed. */ } }, []);
  return { ...visible, refresh: () => { if (visible.viewerPhase === 'error') setRevision(value => value + 1); else void refresh(); }, reloadViewer: () => setRevision(value => value + 1), action, matchAll, saveLocation, uploadSnapshot, calculate, readProposal, readJob, reviewProposal, prepareModel, startLookup, readLookup, startPreview, readPreview,
    pickPoint: (): Promise<PickedPoint | null> => viewerAction(viewer => viewer.pickPoint()), cancelPicking: () => runRef.current?.viewer?.cancelPicking(),
    readObjects: (query: string, cursor = 0): Promise<ViewerModelObjectsPage | null> => viewerAction(viewer => viewer.readModelObjects(cursor, query)),
    readSelection: () => viewerAction(viewer => viewer.readSelection()),
    setPathTransparency: (percent: number) => viewerAction(viewer => viewer.setPathTransparency(percent)),
    cancelOperation: () => { planningCapture.current?.abort(); lookupCapture.current?.abort(); runRef.current?.viewer?.cancelPicking(); clear(); },
    showPath: (path: ComputedPath) => viewerAction(viewer => viewer.showComputedPath(path)), clear, zoom: () => { try { runRef.current?.viewer?.zoom(); } catch { /* No committed path. */ } } };
}
