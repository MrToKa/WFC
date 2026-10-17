import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchRoutingCables, RoutingCableApiError, type RoutingCable } from '@/api/routingCables';
import { hasCableTag, projectCableRows } from '../routingCableList';

type Scope = { projectId: string | null; token: string | null };
type State = {
  scope: Scope; cables: RoutingCable[]; snapshotGeneration: number; hasSnapshot: boolean; hasActivated: boolean; loading: boolean; refreshing: boolean;
  stale: boolean; error: string | null; search: string; selectedCableId: string | null; notice: string | null;
};
type Run = { scope: Scope; closed: boolean; accessBlocked: boolean; readId: number; request: { abort: AbortController; promise: Promise<void> } | null };
type Options = Scope & {
  active: boolean;
  onAccessFailure(code: string, status: number | null): void;
  onCableInvalidated(id: string, oldRouting: string | null): void;
};
const initial = (scope: Scope): State => ({ scope, cables: [], snapshotGeneration: 0, hasSnapshot: false, hasActivated: false, loading: false, refreshing: false,
  stale: true, error: null, search: '', selectedCableId: null, notice: null });

export function useRoutingCables({ projectId, token, active, onAccessFailure, onCableInvalidated }: Options) {
  const scope = useMemo(() => ({ projectId, token }), [projectId, token]);
  const latestScope = useRef(scope); latestScope.current = scope;
  const activeRef = useRef(active); activeRef.current = active;
  const actions = useRef({ onAccessFailure, onCableInvalidated }); actions.current = { onAccessFailure, onCableInvalidated };
  const runRef = useRef<Run | null>(null);
  const [state, setState] = useState(() => initial(scope));
  const stateRef = useRef(state);
  const current = useCallback((run: Run) => !run.closed && latestScope.current === run.scope && runRef.current === run, []);
  const update = useCallback((run: Run, next: State) => {
    if (!current(run)) return;
    stateRef.current = next; setState(next);
  }, [current]);
  const read = useCallback((run: Run, explicit = false): Promise<void> => {
    if (!current(run) || !run.scope.projectId || !run.scope.token || run.accessBlocked && !explicit) return Promise.resolve();
    if (run.request) return run.request.promise;
    const readId = ++run.readId; const abort = new AbortController(); run.accessBlocked = false;
    const previous = stateRef.current.scope === run.scope ? stateRef.current : initial(run.scope);
    update(run, { ...previous, hasActivated: true, loading: !previous.hasSnapshot, refreshing: previous.hasSnapshot, error: null });
    // Install a request synchronously, before any continuation can start another read.
    const request = { abort, promise: Promise.resolve() };
    run.request = request;
    request.promise = (async () => {
      try {
        const cables = await fetchRoutingCables(run.scope.projectId!, run.scope.token!, { signal: abort.signal });
        if (!current(run) || run.readId !== readId || abort.signal.aborted) return;
        const previous = stateRef.current;
        const selected = previous.cables.find(cable => cable.id === previous.selectedCableId);
        const replacement = cables.find(cable => cable.id === previous.selectedCableId);
        let selectedCableId = previous.selectedCableId, notice = previous.notice;
        if (selected && (!replacement || !hasCableTag(replacement))) {
          actions.current.onCableInvalidated(selected.id, selected.routing);
          selectedCableId = null; notice = 'The selected cable is no longer available in this list. Select another cable.';
        } else if (selected && replacement && selected.routing !== replacement.routing) {
          actions.current.onCableInvalidated(selected.id, selected.routing);
          notice = 'The selected cable routing changed. Select the cable again to show its current route.';
        }
        update(run, { ...previous, cables, snapshotGeneration: previous.snapshotGeneration + 1, selectedCableId, notice, hasSnapshot: true, loading: false, refreshing: false, stale: false, error: null });
      } catch (error) {
        if (!current(run) || run.readId !== readId || abort.signal.aborted) return;
        const previous = stateRef.current;
        if (error instanceof RoutingCableApiError && error.accessFailure) {
          run.accessBlocked = true;
          update(run, { ...initial(run.scope), hasActivated: true, error: error.message });
          actions.current.onAccessFailure(error.code, error.status);
        } else update(run, { ...previous, loading: false, refreshing: false, stale: true,
          error: error instanceof RoutingCableApiError ? error.message : 'The cable list could not be loaded. Try again.' });
      } finally { if (run.request === request) run.request = null; }
    })();
    return request.promise;
  }, [current, update]);

  useEffect(() => {
    const run: Run = { scope, closed: false, accessBlocked: false, readId: 0, request: null };
    runRef.current = run; update(run, initial(scope));
    if (activeRef.current) void read(run);
    const reveal = () => { if (activeRef.current && !document.hidden) void read(run); };
    window.addEventListener('focus', reveal); document.addEventListener('visibilitychange', reveal);
    return () => {
      run.closed = true; ++run.readId; run.request?.abort.abort();
      window.removeEventListener('focus', reveal); document.removeEventListener('visibilitychange', reveal);
      if (runRef.current === run) runRef.current = null;
    };
  }, [scope, current, read, update]);
  useEffect(() => {
    const run = runRef.current;
    if (active && run?.scope === scope && current(run)) void read(run);
  }, [active, scope, current, read]);

  const refresh = useCallback(async () => {
    const run = runRef.current;
    if (run?.scope === scope && current(run)) await read(run, true);
  }, [scope, current, read]);
  const setSearch = useCallback((search: string) => {
    const run = runRef.current;
    if (run?.scope === scope && current(run)) update(run, { ...stateRef.current, search });
  }, [scope, current, update]);
  const confirmedCable = useCallback((id: string | null): RoutingCable | null => {
    const run = runRef.current; const value = stateRef.current;
    if (!id || run?.scope !== scope || !current(run) || run.request || value.scope !== scope || !value.hasSnapshot || value.stale) return null;
    const cable = value.cables.find(cable => cable.id === id);
    return cable && hasCableTag(cable) ? { ...cable } : null;
  }, [scope, current]);
  const select = useCallback((id: string): RoutingCable | null => {
    const cable = confirmedCable(id); const run = runRef.current;
    if (cable && run?.scope === scope && current(run)) update(run, { ...stateRef.current, selectedCableId: id, notice: null });
    return cable;
  }, [scope, current, update, confirmedCable]);
  const getSelectedForRetry = useCallback(() => confirmedCable(stateRef.current.scope === scope ? stateRef.current.selectedCableId : null), [scope, confirmedCable]);
  const visible = state.scope === scope ? state : initial(scope);
  const { rows, omittedCount, taggedCount } = projectCableRows(visible.cables, visible.search);
  const selectedCable = visible.cables.find(cable => cable.id === visible.selectedCableId && hasCableTag(cable)) ?? null;
  return { ...visible, rows, omittedCount, taggedCount, selectedCable, selectedHidden: Boolean(selectedCable && !rows.some(cable => cable.id === selectedCable.id)),
    canActivate: visible.hasSnapshot && !visible.loading && !visible.refreshing && !visible.stale, setSearch, select, refresh, getSelectedForRetry };
}
