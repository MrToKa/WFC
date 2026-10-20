import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { fetchPathFinderState, fetchPathFinderProposal, fetchPathFinderJob, fetchPathFinderLookup, fetchPathFinderLookupPlan, fetchPathFinderPreview, parsePathFinderProposal, pathFinderRequest, PathFinderApiError, type PathFinderState, type PathFinderProposal, type PathFinderPreferences, type PathFinderPreviewInput } from '@/api/pathfinder';
import { fetchProjectModels } from '@/api/projectModels';
import { ViewerController, type ViewerEvent } from '@/viewer/ViewerController';
import { ViewerAccessError } from '@/viewer/sessionApi';
import type { CanonicalPoint, ComputedPath, PickedPoint, ViewerModelObjectsPage, ModelCaptureRequest } from '../../../../viewer-runtime/protocol.mjs';
import type { PreparationDiscoveryRequest, PreparationDiscoveryPage } from '../../../../viewer-runtime/preparation-input.mjs';
import type { PreparationScope } from '../../../../shared/pathfinderPreparation';
import { pathFinderRequestDeadline } from '@/api/pathfinderRequestDeadline';

export type ProjectPreparationViewer = {
  readSelection: ViewerController['readSelection'];
  discover: (request: PreparationDiscoveryRequest) => Promise<PreparationDiscoveryPage>;
  capture: (request: ModelCaptureRequest) => ReturnType<ViewerController['captureModel']>;
  assertCurrent: () => void;
};

type Options = { projectId: string | null; loadedProjectId: string | null; token: string | null; isAdmin: boolean; container: RefObject<HTMLDivElement | null> };
type View = { data: PathFinderState | null; loading: boolean; busy: boolean; error: string | null; viewerPhase: 'loading' | 'ready' | 'no-model' | 'error'; viewerMessage: string };
type Run = { closed: boolean; abort: AbortController; viewer: ViewerController | null; modelVersionId: string | null; selectionRevision: string | null; contentFingerprint: string | null; generation: number; captureProgressAt: number | null; stateRead: Promise<PathFinderState | null> | null };
// Cosmetic text only. Capture protocol, geometry assembly and terminal/auth
// updates retain their original delivery; dropping progress needs no timer.
const CAPTURE_PROGRESS_INTERVAL_MILLISECONDS = 1000;
const ENTITY_READ_TIMEOUT_MILLISECONDS = 30_000;
const initial: View = { data: null, loading: true, busy: false, error: null, viewerPhase: 'loading', viewerMessage: 'Checking the active model…' };
const message = (error: unknown) => error instanceof PathFinderApiError ? error.message : error instanceof ViewerAccessError && error.code === 'APPEARANCE_RESTORE_FAILED' ? new PathFinderApiError(error.code, 0).message : error instanceof ViewerAccessError && error.code === 'LOOKUP_GEOMETRY_NOT_FOUND' ? 'No display-visible route geometry matches the lookup. Check the route names and model visibility.' : error instanceof ViewerAccessError && error.code === 'CAPTURE_RELOAD_REQUIRED' ? 'Reload the model before preparing another snapshot; the bounded command budget has been reached.' : error instanceof ViewerAccessError && error.code === 'EXTRACTION_FAILED' ? 'The selected model capture could not be completed within its limits. Reduce the network or equipment scope and try again.' : error instanceof DOMException && error.name === 'AbortError' ? 'The operation was cancelled.' : 'The operation could not be completed. Refresh Path Finder and try again.';

export function usePathFinder({ projectId, loadedProjectId, token, isAdmin, container }: Options) {
  const scope = useMemo(() => ({ projectId, loadedProjectId, token, isAdmin }), [projectId, loadedProjectId, token, isAdmin]);
  const latest = useRef(scope); latest.current = scope;
  const renderedScope = useRef(scope);
  const runRef = useRef<Run | null>(null), dataRef = useRef<PathFinderState | null>(null);
  const lookupCapture = useRef<AbortController | null>(null);
  const planningCapture = useRef<AbortController | null>(null);
  const projectPreparationCapture = useRef<AbortController | null>(null);
  const entityReads = useRef<{ proposal: AbortController | null; job: AbortController | null }>({ proposal: null, job: null });
  const [revision, setRevision] = useState(0), [view, setView] = useState<View>(initial);
  const live = useCallback((run: Run) => !run.closed && runRef.current === run && latest.current === scope, [scope]);
  const update = useCallback((run: Run, patch: Partial<View>) => { if (live(run)) setView(previous => ({ ...previous, ...patch })); }, [live]);
  const captureProgress = useCallback((run: Run, text: () => string) => {
    if (!live(run)) return;
    const measured = performance.now(), now = Number.isFinite(measured) ? Math.max(0, measured) : run.captureProgressAt ?? 0;
    if (run.captureProgressAt !== null && now - run.captureProgressAt < CAPTURE_PROGRESS_INTERVAL_MILLISECONDS) return;
    run.captureProgressAt = now;
    update(run, { viewerMessage: text() });
  }, [live, update]);
  const accessFailure = useCallback((run: Run, error: unknown) => {
    if (error instanceof PathFinderApiError && [401, 403, 404].includes(error.status)) { run.viewer?.dispose('reload'); dataRef.current = null; update(run, { data: null, busy: false, loading: false, error: error.message, viewerPhase: 'error', viewerMessage: error.message }); run.closed = true; run.abort.abort(); }
  }, [update]);
  const refresh = useCallback(async (run = runRef.current, afterWrite = false): Promise<PathFinderState | null> => {
    if (!run || !live(run) || !projectId || !token || !isAdmin) return null;
    if (run.stateRead) {
      if (!afterWrite) return run.stateRead;
      // An earlier poll can describe the state before a just-completed mutation.
      // Wait for it, then coalesce a fresh read with other post-write refreshes.
      await run.stateRead;
      return live(run) ? refresh(run) : null;
    }
    const pending = (async () => {
      try {
        const data = await fetchPathFinderState(projectId, token, run.abort.signal);
        if (!live(run)) return null;
        dataRef.current = data; update(run, { data, loading: false, error: null });
        if (run.modelVersionId !== data.activeModel.modelVersionId || run.selectionRevision !== data.activeModel.selectionRevision) {
          run.viewer?.dispose('reload'); setRevision(value => value + 1);
        }
        return data;
      } catch (error) { if (live(run)) { accessFailure(run, error); update(run, { loading: false, error: message(error) }); } return null; }
    })();
    run.stateRead = pending;
    try { return await pending; }
    finally { if (run.stateRead === pending) run.stateRead = null; }
  }, [accessFailure, isAdmin, live, projectId, token, update]);
  useEffect(() => {
    const run: Run = { closed: false, abort: new AbortController(), viewer: null, modelVersionId: null, selectionRevision: null, contentFingerprint:null, generation: revision, captureProgressAt: null, stateRead: null };
    runRef.current = run; dataRef.current = null; renderedScope.current = scope; setView(initial);
    if (!projectId || !token || !isAdmin || projectId !== loadedProjectId || !container.current) {
      update(run, { loading: false, viewerPhase: 'error', viewerMessage: 'Current administrator project access is required.', error: 'Path Finder is available only to administrators.' });
      return () => { run.closed = true; run.abort.abort(); };
    }
    void (async () => {
      try {
        const [data, models] = await Promise.all([fetchPathFinderState(projectId, token, run.abort.signal), fetchProjectModels(projectId, token, { signal: run.abort.signal })]);
        if (!live(run)) return;
        dataRef.current = data; run.modelVersionId = data.activeModel.modelVersionId; run.selectionRevision = data.activeModel.selectionRevision; run.contentFingerprint=data.activeModel.contentFingerprint;
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
          if (event.type === 'MODEL_CAPTURE_PROGRESS') captureProgress(run, () => `Preparing ${event.payload.phase === 'properties' ? 'equipment candidates' : event.payload.phase === 'geometry' ? 'routing geometry' : 'model identifiers'}: ${Number(event.payload.loaded).toLocaleString()} / ${Number(event.payload.total).toLocaleString()}…`);
          if (event.type === 'ERROR') {
            const code = String(event.payload.code), terminal = event.payload.operation === 'viewer' || ['SESSION_EXPIRED', 'ACCESS_REVOKED', 'MODEL_SELECTION_CHANGED', 'MODEL_UNAVAILABLE', 'RESOURCE_FAILED'].includes(code);
            update(run, terminal ? { viewerPhase: 'error', viewerMessage: 'Model access ended or the model changed. Refresh Path Finder to reload.', error: 'The protected viewer operation could not be completed.' }
              : { viewerMessage: 'The active model is ready.', error: message(new ViewerAccessError(code, 0)) });
          }
        };
        run.viewer = new ViewerController({ container: container.current!, projectId, token, onEvent,
          onCaptureTiming: timing => { console.debug('WFC capture host timing', timing); } });
      } catch (error) { if (live(run)) { accessFailure(run, error); update(run, { loading: false, viewerPhase: 'error', viewerMessage: 'The active model is unavailable. Refresh to check again.', error: message(error) }); } }
    })();
    return () => { run.closed = true; run.abort.abort(); run.viewer?.dispose('unmount'); };
  }, [accessFailure, captureProgress, container, isAdmin, live, loadedProjectId, projectId, refresh, revision, scope, token, update]);
  const perform = useCallback(async <T,>(operation: (data: PathFinderState, run: Run) => Promise<T>, options: { refresh?: boolean } = {}): Promise<T | null> => {
    const run = runRef.current, data = dataRef.current;
    if (!run || !data || !live(run) || !isAdmin || projectPreparationCapture.current) return null;
    update(run, { busy: true, error: null });
    try { const result = await operation(data, run); if (!live(run)) return null; if (options.refresh !== false) await refresh(run, true); return result; }
    catch (error) { if (live(run)) { accessFailure(run, error); update(run, { error: message(error) }); } return null; }
    finally { update(run, { busy: false }); }
  }, [accessFailure, isAdmin, live, refresh, update]);
  const action = useCallback((path: string, body?: unknown, method: 'POST' | 'PUT' | 'DELETE' = 'POST') => perform(async (_data, run) => pathFinderRequest(projectId!, token!, path, method, body, run.abort.signal)), [perform, projectId, token]);
  // The owner of a bounded batch refreshes once after its immutable commands.
  // Server auth, exact review identities, dependency checks and transactions are unchanged.
  const actionWithoutRefresh = useCallback((path: string, body?: unknown, method: 'POST' | 'PUT' | 'DELETE' = 'POST') => perform(async (_data, run) => pathFinderRequest(projectId!, token!, path, method, body, run.abort.signal), { refresh: false }), [perform, projectId, token]);
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
  // Inspection already checks current server authority. It must not wait for a
  // second, project-wide state read or block every mutation while loading one row.
  const readEntity = useCallback(async <T,>(kind: 'proposal' | 'job', read: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    const run = runRef.current;
    if (!run || !dataRef.current || !live(run) || !isAdmin || projectPreparationCapture.current) return null;
    entityReads.current[kind]?.abort();
    const controller = new AbortController(); entityReads.current[kind] = controller;
    const deadline = pathFinderRequestDeadline(AbortSignal.any([run.abort.signal, controller.signal]), ENTITY_READ_TIMEOUT_MILLISECONDS,
      () => new Error('Path Finder detail request timed out. Try opening the result again.'));
    update(run, { error: null });
    try {
      const result = await deadline.wait(() => read(deadline.signal));
      return live(run) && entityReads.current[kind] === controller ? result : null;
    } catch (error) {
      if (live(run) && entityReads.current[kind] === controller && !controller.signal.aborted) {
        // A deleted proposal/job is not a revoked project or model permission.
        const missingEntity = error instanceof PathFinderApiError && error.status === 404 && error.code === (kind === 'proposal' ? 'PROPOSAL_NOT_FOUND' : 'JOB_NOT_FOUND');
        if (error instanceof PathFinderApiError && ([401, 403].includes(error.status) || error.status === 404 && !missingEntity)) accessFailure(run, error);
        else update(run, { error: deadline.signal.aborted ? 'The result took too long to load. Try opening it again.' : missingEntity ? 'This result is no longer available. Refresh Path Finder and select another result.' : message(error) });
      }
      return null;
    } finally { deadline.dispose(); if (entityReads.current[kind] === controller) entityReads.current[kind] = null; }
  }, [accessFailure, isAdmin, live, update]);
  const readProposal = useCallback((proposalId: string) => readEntity('proposal', signal => fetchPathFinderProposal(projectId!, token!, proposalId, signal)), [readEntity, projectId, token]);
  const readJob = useCallback((jobId: string) => readEntity('job', signal => fetchPathFinderJob(projectId!, token!, jobId, signal)), [readEntity, projectId, token]);
  const reviewProposal = useCallback((proposal: PathFinderProposal) => perform(async (_data, run) => {
    const result = await pathFinderRequest(projectId!, token!, `/proposals/${proposal.id}/review`, 'POST', { expectedProposalHash: proposal.proposalHash }, run.abort.signal);
    if (typeof result.reviewId !== 'string') throw new Error('Invalid review response');
    const reviewed = parsePathFinderProposal(result.proposal);
    if (reviewed.id !== proposal.id || reviewed.projectId !== projectId || reviewed.proposalHash !== proposal.proposalHash) throw new Error('Review identity mismatch');
    return { reviewId: result.reviewId, proposal: reviewed };
  }, { refresh: false }), [perform, projectId, token]);
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
      const captured = await run.viewer.captureModel(request, progress => captureProgress(run, () => `Preparing the selected model: ${progress.index + 1} data batches…`));
      current();
      const latestData = await fetchPathFinderState(projectId!, token!, AbortSignal.any([run.abort.signal, operation.signal]));
      current();
      if (dependencies(latestData) !== frozenDependencies || dataRef.current && dependencies(dataRef.current) !== frozenDependencies)
        throw new PathFinderApiError('CAPTURE_INPUT_CHANGED', 409);
      const result = await pathFinderRequest(projectId!, token!, '/artifacts', 'POST', { modelVersionId: data.activeModel.modelVersionId, expectedSelectionRevision: data.activeModel.selectionRevision, expectedRegistryRevision: data.registryRevision, snapshot: captured.snapshot }, run.abort.signal);
      return { ...result, captureSummary: captured.summary };
    } finally { if (planningCapture.current === operation) planningCapture.current = null; if (run.viewer.getLoadSnapshot()?.ready) update(run, { viewerMessage: 'The active model is ready.' }); }
  }), [captureProgress, live, perform, projectId, token, update]);
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
      const captured = await run.viewer.captureModel({ lookupRouteCodes: plan.routeCodes, equipmentNames: [] }, progress => captureProgress(run, () => `Reading lookup geometry: ${progress.index + 1} data batches…`));
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
  }), [captureProgress, live, perform, projectId, token, update]);
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
  useEffect(() => {
    const run = runRef.current; if (!run || !live(run)) return;
    let closed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (closed || !live(run)) return;
      if (run.selectionRevision !== null) await refresh(run);
      if (!closed && live(run)) timer = setTimeout(() => void poll(), running ? 2000 : 15000);
    };
    timer = setTimeout(() => void poll(), running ? 2000 : 15000);
    return () => { closed = true; clearTimeout(timer); };
  }, [live, refresh, revision, running]);
  const viewerAction = useCallback(async <T,>(operation: (viewer: ViewerController) => Promise<T>): Promise<T | null> => {
    const run = runRef.current; if (!run || !live(run) || !run.viewer || projectPreparationCapture.current) return null;
    try { const result = await operation(run.viewer); return live(run) ? result : null; } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) update(run, { error: message(error) }); return null; }
  }, [live, update]);
  const runProjectPreparation = useCallback(async <T,>(expected:Pick<PreparationScope,'modelVersionId'|'selectionRevision'|'contentFingerprint'>, operation: (viewer: ProjectPreparationViewer) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const run = runRef.current;
    if (!run || !live(run) || !isAdmin || !run.viewer?.getLoadSnapshot()?.ready || projectPreparationCapture.current || planningCapture.current || lookupCapture.current)
      throw new Error('Load the active model and finish the current operation before preparing the project.');
    const controller = new AbortController(); projectPreparationCapture.current = controller;
    const combined = AbortSignal.any([run.abort.signal, controller.signal, ...(signal ? [signal] : [])]);
    const model = run.modelVersionId, selection = run.selectionRevision;
    const current = () => {
      if (combined.aborted || !live(run) || projectPreparationCapture.current !== controller || run.modelVersionId !== model || run.selectionRevision !== selection || run.modelVersionId!==expected.modelVersionId || run.selectionRevision!==expected.selectionRevision || run.contentFingerprint!==expected.contentFingerprint || !run.viewer?.getLoadSnapshot()?.ready)
        throw new DOMException('Project preparation paused because the model or operation changed.', 'AbortError');
    };
    update(run, { busy: true, error: null });
    try {
      current();
      const value = await operation({ assertCurrent: current,
        readSelection:async()=>{current();const result=await run.viewer!.readSelection();current();return result;},
        discover: async request => { current(); const page = await run.viewer!.discoverPreparationObjects(request, { signal: combined, isCurrent: () => { try { current(); return true; } catch { return false; } } }); current(); return page; },
        capture: async request => { current(); const capture = await run.viewer!.captureModel(request, progress => captureProgress(run, () => `Collecting project geometry: ${progress.index + 1} data batches…`), { signal: combined, isCurrent: () => { try { current(); return true; } catch { return false; } } }); current(); return capture; },
      });
      current(); return value;
    } finally {
      if (projectPreparationCapture.current === controller) projectPreparationCapture.current = null;
      update(run, { busy: false, viewerMessage: run.viewer?.getLoadSnapshot()?.ready ? 'The active model is ready.' : 'Reload the active model to continue preparation.' });
    }
  }, [captureProgress, isAdmin, live, update]);
  const visible = renderedScope.current === scope ? view : initial;
  const clear = useCallback(() => { try { runRef.current?.viewer?.clear(); } catch { /* A terminal viewer is already closed. */ } }, []);
  return { ...visible, preparationAccess: scope, preparationViewerGeneration: visible.viewerPhase === 'ready' ? runRef.current?.generation ?? -1 : -1, runProjectPreparation, refresh: () => { if (visible.viewerPhase === 'error') setRevision(value => value + 1); else void refresh(runRef.current, true); }, reloadViewer: () => setRevision(value => value + 1), action, actionWithoutRefresh, matchAll, saveLocation, uploadSnapshot, calculate, readProposal, readJob, reviewProposal, prepareModel, startLookup, readLookup, startPreview, readPreview,
    pickPoint: (): Promise<PickedPoint | null> => viewerAction(viewer => viewer.pickPoint()), cancelPicking: () => runRef.current?.viewer?.cancelPicking(),
    readObjects: (query: string, cursor = 0): Promise<ViewerModelObjectsPage | null> => viewerAction(viewer => viewer.readModelObjects(cursor, query)),
    readSelection: () => viewerAction(viewer => viewer.readSelection()),
    setPathTransparency: (percent: number) => viewerAction(viewer => viewer.setPathTransparency(percent)),
    cancelOperation: () => { projectPreparationCapture.current?.abort(); planningCapture.current?.abort(); lookupCapture.current?.abort(); entityReads.current.proposal?.abort(); entityReads.current.job?.abort(); runRef.current?.viewer?.cancelPicking(); clear(); },
    showPath: (path: ComputedPath) => viewerAction(viewer => viewer.showComputedPath(path)), clear, zoom: () => { try { runRef.current?.viewer?.zoom(); } catch { /* No committed path. */ } } };
}
