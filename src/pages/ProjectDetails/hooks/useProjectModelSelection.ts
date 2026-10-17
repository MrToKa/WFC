import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchProjectModels, setProjectActiveModel, ProjectModelApiError, type ProjectModelSnapshot } from '@/api/projectModels';

type Scope = { projectId: string | null; token: string | null };
type State = {
  scope: Scope; snapshot: ProjectModelSnapshot | null; draftId: string | null | undefined; baseRevision: number | null;
  loading: boolean; refreshing: boolean; saving: boolean; reconciling: boolean; stale: boolean;
  conflict: string | null; notice: string | null; error: string | null;
};
type Run = { scope: Scope; closed: boolean; readId: number; read?: AbortController; save?: AbortController; mutation: boolean; queuedRefresh: boolean };
type Outcome = 'conflict' | 'unknown' | 'unavailable';
const conflictText = 'The model selection changed elsewhere. Review the latest selection before saving.';
const uncertainText = 'The save response could not be confirmed. Review the current server selection before saving again.';
const initial = (scope: Scope): State => ({ scope, snapshot: null, draftId: undefined, baseRevision: null, loading: false, refreshing: false, saving: false, reconciling: false, stale: true, conflict: null, notice: null, error: null });
const safeMessage = (error: unknown) => error instanceof ProjectModelApiError ? error.message : 'The model data could not be refreshed. Try again.';
const activeMissing = (snapshot: ProjectModelSnapshot | null) => Boolean(snapshot?.selection.activeModelVersionId && !snapshot.versions.some(version => version.id === snapshot.selection.activeModelVersionId));
const validDraft = (snapshot: ProjectModelSnapshot | null, id: string | null | undefined) => id === null || id !== undefined && Boolean(snapshot?.versions.some(version => version.id === id && version.state === 'ready' && version.health === 'healthy'));

export function useProjectModelSelection({ projectId, token, canEdit }: Scope & { canEdit: boolean }) {
  const scope = useMemo(() => ({ projectId, token }), [projectId, token]);
  const latestScope = useRef(scope); latestScope.current = scope;
  const editable = useRef(canEdit); editable.current = canEdit;
  const runRef = useRef<Run | null>(null);
  const [state, setState] = useState(() => initial(scope));
  const stateRef = useRef(state);
  const current = useCallback((run: Run) => !run.closed && latestScope.current === run.scope && runRef.current === run, []);
  const update = useCallback((run: Run, change: (previous: State) => State) => {
    if (!current(run)) return;
    const next = change(stateRef.current.scope === run.scope ? stateRef.current : initial(run.scope));
    stateRef.current = next; setState(next);
  }, [current]);

  const refreshRun = useCallback(async (run: Run, outcome?: Outcome): Promise<void> => {
    if (!current(run) || !run.scope.projectId || !run.scope.token) return;
    if (run.mutation) { run.queuedRefresh = true; return; }
    const readId = ++run.readId; run.read?.abort();
    const abort = new AbortController(); run.read = abort; run.queuedRefresh = false;
    update(run, previous => ({ ...previous, loading: !previous.snapshot, refreshing: Boolean(previous.snapshot), error: null,
      reconciling: outcome === 'unknown' || previous.reconciling,
      conflict: outcome === 'conflict' ? conflictText : outcome === 'unknown' ? uncertainText : previous.conflict,
      notice: outcome === 'unknown' ? 'The save response was lost. Reading the current server selection without repeating the save.' : previous.notice }));
    try {
      const snapshot = await fetchProjectModels(run.scope.projectId, run.scope.token, { signal: abort.signal });
      if (!current(run) || run.readId !== readId || abort.signal.aborted) return;
      update(run, previous => {
        const dirty = previous.draftId !== undefined && previous.draftId !== previous.snapshot?.selection.activeModelVersionId;
        const changed = previous.snapshot && (snapshot.selection.selectionRevision !== previous.snapshot.selection.selectionRevision || snapshot.selection.activeModelVersionId !== previous.snapshot.selection.activeModelVersionId);
        const conflict = previous.conflict ?? (dirty && changed ? conflictText : null);
        const keepDraft = dirty || Boolean(conflict);
        return { ...previous, snapshot, draftId: keepDraft ? previous.draftId : snapshot.selection.activeModelVersionId,
          baseRevision: keepDraft ? previous.baseRevision : snapshot.selection.selectionRevision, stale: false, loading: false, refreshing: false, reconciling: false, conflict,
          notice: !dirty && changed && previous.notice === 'Model selection saved.' ? null : previous.notice,
          error: outcome === 'unavailable' ? 'This model is unavailable. The active selection has not been replaced.' : null };
      });
    } catch (error) {
      if (!current(run) || run.readId !== readId || abort.signal.aborted) return;
      update(run, previous => ({ ...previous, stale: true, loading: false, refreshing: false, reconciling: false, error: safeMessage(error) }));
    } finally { if (current(run) && run.readId === readId) run.read = undefined; }
  }, [current, update]);

  useEffect(() => {
    const run: Run = { scope, closed: false, readId: 0, mutation: false, queuedRefresh: false };
    runRef.current = run; update(run, () => initial(scope));
    void refreshRun(run);
    const focus = () => { if (!document.hidden) void refreshRun(run); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    return () => { run.closed = true; run.read?.abort(); run.save?.abort(); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); if (runRef.current === run) runRef.current = null; };
  }, [scope, update, refreshRun]);

  const refresh = useCallback(async () => { const run = runRef.current; if (run && current(run)) await refreshRun(run); }, [current, refreshRun]);
  const changeDraft = useCallback((id: string | null) => {
    const run = runRef.current; if (!run || !current(run) || run.mutation || !editable.current) return;
    update(run, previous => validDraft(previous.snapshot, id) ? { ...previous, draftId: id, notice: null, error: null } : { ...previous, error: 'Choose an available model version.' });
  }, [current, update]);
  const useLatestSelection = useCallback(() => {
    const run = runRef.current; if (!run || !current(run) || run.mutation) return;
    update(run, previous => previous.snapshot && !previous.stale ? { ...previous, draftId: previous.snapshot.selection.activeModelVersionId, baseRevision: previous.snapshot.selection.selectionRevision, conflict: null, notice: null, error: null } : previous);
  }, [current, update]);
  const confirmDraftAgainstLatest = useCallback(() => {
    const run = runRef.current; if (!run || !current(run) || run.mutation || !editable.current) return;
    update(run, previous => previous.snapshot && !previous.stale && !activeMissing(previous.snapshot) && validDraft(previous.snapshot, previous.draftId) ?
      { ...previous, baseRevision: previous.snapshot.selection.selectionRevision, conflict: null, notice: 'Review your choice and select Save to apply it.', error: null } : previous);
  }, [current, update]);

  const canSaveState = (value: State) => Boolean(projectId && token && editable.current && value.scope === scope && value.snapshot && !value.stale && !value.loading && !value.refreshing && !value.saving && !value.reconciling && !value.conflict && !activeMissing(value.snapshot) &&
    validDraft(value.snapshot, value.draftId) && value.draftId !== value.snapshot.selection.activeModelVersionId && value.baseRevision === value.snapshot.selection.selectionRevision);
  const save = useCallback(async (): Promise<void> => {
    const run = runRef.current;
    if (!run || !current(run) || run.mutation || !editable.current || !run.scope.projectId || !run.scope.token) return;
    const previous = stateRef.current;
    if (!previous.snapshot || previous.scope !== run.scope || previous.stale || previous.loading || previous.refreshing || previous.saving || previous.reconciling || previous.conflict || activeMissing(previous.snapshot) || !validDraft(previous.snapshot, previous.draftId) || previous.draftId === previous.snapshot.selection.activeModelVersionId || previous.baseRevision !== previous.snapshot.selection.selectionRevision) return;
    const id = previous.draftId as string | null, revision = previous.snapshot.selection.selectionRevision;
    run.mutation = true; ++run.readId; run.read?.abort(); run.read = undefined;
    const abort = new AbortController(); run.save = abort;
    update(run, value => ({ ...value, saving: true, notice: null, error: null }));
    let outcome: Outcome | undefined;
    try {
      const result = await setProjectActiveModel(run.scope.projectId, run.scope.token, { modelVersionId: id, expectedSelectionRevision: revision }, { signal: abort.signal });
      if (!current(run) || abort.signal.aborted) return;
      update(run, value => ({ ...value, snapshot: { versions: value.snapshot!.versions, selection: result.selection }, draftId: id, baseRevision: result.selection.selectionRevision, saving: false, conflict: null, notice: 'Model selection saved.', error: null }));
    } catch (error) {
      if (!current(run) || abort.signal.aborted) return;
      outcome = error instanceof ProjectModelApiError && error.code === 'SELECTION_CONFLICT' ? 'conflict' : error instanceof ProjectModelApiError && ['MODEL_UNAVAILABLE', 'MODEL_NOT_SELECTABLE', 'VERSION_NOT_READY', 'MODEL_NOT_FOUND'].includes(error.code) ? 'unavailable' :
        !(error instanceof ProjectModelApiError) || error.status === null || error.status >= 500 ? 'unknown' : undefined;
      update(run, value => ({ ...value, saving: false, reconciling: outcome === 'unknown', stale: outcome ? value.stale : true, error: safeMessage(error),
        conflict: outcome === 'conflict' ? conflictText : outcome === 'unknown' ? uncertainText : value.conflict }));
    } finally { run.mutation = false; run.save = undefined; }
    if (!current(run)) return;
    if (outcome || run.queuedRefresh) await refreshRun(run, outcome);
  }, [current, refreshRun, update]);

  const view = state.scope === scope ? state : initial(scope);
  return { snapshot: view.snapshot, draftId: view.draftId, loading: view.loading, refreshing: view.refreshing, saving: view.saving, reconciling: view.reconciling, stale: view.stale,
    activeMissing: activeMissing(view.snapshot), conflict: view.conflict, notice: view.notice, error: view.error, canSave: canSaveState(view),
    changeDraft, refresh, save, useLatestSelection, confirmDraftAgainstLatest };
}
