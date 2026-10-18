import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { purposeKeySchema, routingCatalogDiagnostics } from '../../../../shared/pathfinderPurposePolicy';
import {
  fetchRoutingPurposeCatalog, fetchRoutingPurposePolicy, fetchRoutingPurposeHistory, saveRoutingPurposePolicy,
  PathFinderPolicyApiError, ROUTING_CATEGORIES,
  type CatalogEnvelope, type RoutingPurposePolicy, type RoutingPurposeWrite, type PolicyHistory, type RoutingCategory,
} from '@/api/pathfinderPolicies';

type Scope = { projectId: string | null; loadedProjectId: string | null; token: string | null; isAdmin: boolean };
type Snapshot = { catalog: CatalogEnvelope; policy: RoutingPurposePolicy };
type Draft = Map<string, RoutingCategory[]>;
type State = { scope: Scope; snapshot: Snapshot | null; draft: Draft; loading: boolean; refreshing: boolean; saving: boolean; stale: boolean;
  uncertain: boolean; conflict: string | null; notice: string | null; error: string | null; refreshPrompt: boolean;
  history: PolicyHistory | null; historyLoading: boolean; historyError: string | null };
type Run = { scope: Scope; closed: boolean; readId: number; historyId: number; read?: AbortController; history?: AbortController; save?: AbortController;
  mutation: boolean; pending?: RoutingPurposeWrite };
export type RoutingPurposeRow = { purposeKey: string | null; trayCount: number; blocked: boolean; categories: RoutingCategory[]; configured: boolean; dirty: boolean };
const initial = (scope: Scope): State => ({ scope, snapshot: null, draft: new Map(), loading: false, refreshing: false, saving: false, stale: true,
  uncertain: false, conflict: null, notice: null, error: null, refreshPrompt: false, history: null, historyLoading: false, historyError: null });
const enabled = (scope: Scope) => Boolean(scope.isAdmin && scope.projectId && scope.token && scope.projectId === scope.loadedProjectId);
const same = (left: RoutingCategory[] | undefined, right: RoutingCategory[] | undefined) => left === undefined ? right === undefined : right !== undefined && left.length === right.length && left.every((value, index) => value === right[index]);
const draftFor = (policy: RoutingPurposePolicy): Draft => new Map(policy.rules.map(rule => [rule.purposeKey, [...rule.allowedCategories]]));
const authorableCache = new WeakMap<Snapshot, Set<string>>();
const authorable = (snapshot: Snapshot, key: string): boolean => {
  const cached = authorableCache.get(snapshot);
  if (cached) return cached.has(key);
  const blocked = new Set(routingCatalogDiagnostics(snapshot.catalog.diagnostics).flatMap(item => item.projectTrayIds));
  const groups = new Map<string, { raw: string | null; blocked: boolean }>();
  for (const row of snapshot.catalog.rows) {
    if (row.purposeKey === null) continue;
    const previous = groups.get(row.purposeKey);
    groups.set(row.purposeKey, { raw: row.rawPurpose, blocked: Boolean(previous?.blocked || blocked.has(row.projectTrayId) || previous && previous.raw !== row.rawPurpose) });
  }
  const keys = new Set([...groups].filter(([purpose, group]) => !group.blocked && purposeKeySchema.safeParse(purpose).success).map(([purpose]) => purpose));
  authorableCache.set(snapshot, keys);
  return keys.has(key);
};
const changedKeys = (state: State): string[] => state.snapshot ? [...new Set([...state.draft.keys(), ...state.snapshot.policy.rules.map(rule => rule.purposeKey)])]
  .filter(key => !same(state.draft.get(key), state.snapshot!.policy.rules.find(rule => rule.purposeKey === key)?.allowedCategories)) : [];
const validChanges = (state: State): boolean => Boolean(state.snapshot && changedKeys(state).every(key => authorable(state.snapshot!, key)));
const dirty = (state: State) => changedKeys(state).length > 0;
const message = (error: unknown) => error instanceof PathFinderPolicyApiError ? error.message : 'Routing permissions could not be loaded. Try again.';
const denied = (error: unknown) => error instanceof PathFinderPolicyApiError && [401, 403].includes(error.status ?? 0);
const conflictText = 'The project or routing permissions changed elsewhere. Discard these changes and refresh before saving.';

export function useRoutingPurposePolicy({ projectId, loadedProjectId, token, isAdmin }: Scope) {
  const scope = useMemo(() => ({ projectId, loadedProjectId, token, isAdmin }), [projectId, loadedProjectId, token, isAdmin]);
  const latest = useRef(scope); latest.current = scope;
  const runRef = useRef<Run | null>(null);
  const [state, setState] = useState<State>(() => initial(scope)); const stateRef = useRef(state);
  const current = useCallback((run: Run) => !run.closed && runRef.current === run && latest.current === run.scope && enabled(run.scope), []);
  const update = useCallback((run: Run, change: (previous: State) => State) => {
    if (!current(run)) return;
    const next = change(stateRef.current.scope === run.scope ? stateRef.current : initial(run.scope));
    stateRef.current = next; setState(next);
  }, [current]);
  const forgetDenied = useCallback((run: Run, error: unknown) => {
    run.pending = undefined;
    update(run, () => ({ ...initial(run.scope), error: message(error) }));
  }, [update]);

  const historyRun = useCallback(async (run: Run, more = false): Promise<void> => {
    if (!current(run) || !run.scope.projectId || !run.scope.token || run.mutation) return;
    const cursor = more ? stateRef.current.history?.nextBeforeRevision : undefined;
    if (more && (!cursor || stateRef.current.historyLoading)) return;
    const id = ++run.historyId; run.history?.abort(); const abort = new AbortController(); run.history = abort;
    update(run, previous => ({ ...previous, historyLoading: true, historyError: null }));
    try {
      const history = await fetchRoutingPurposeHistory(run.scope.projectId, run.scope.token, cursor ?? undefined, abort.signal);
      if (!current(run) || id !== run.historyId || abort.signal.aborted) return;
      update(run, previous => {
        const old = more ? previous.history?.events ?? [] : [];
        if (history.events.some(event => old.some(item => item.auditId === event.auditId))) return { ...previous, historyLoading: false, historyError: 'History changed while loading. Refresh the history.' };
        return { ...previous, history: { ...history, events: [...old, ...history.events] }, historyLoading: false };
      });
    } catch (error) {
      if (!current(run) || id !== run.historyId || abort.signal.aborted) return;
      if (denied(error)) forgetDenied(run, error);
      else update(run, previous => ({ ...previous, historyLoading: false, historyError: 'Permission history could not be loaded. Try again.' }));
    }
  }, [current, forgetDenied, update]);

  const refreshRun = useCallback(async (run: Run, notice: string | null = null): Promise<void> => {
    if (!current(run) || !run.scope.projectId || !run.scope.token || run.mutation || run.pending) return;
    const id = ++run.readId; run.read?.abort(); const abort = new AbortController(); run.read = abort;
    update(run, previous => ({ ...previous, loading: !previous.snapshot, refreshing: Boolean(previous.snapshot), stale: true, error: null, conflict: null, refreshPrompt: false, notice }));
    try {
      let snapshot: Snapshot | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const [catalog, policy]: [CatalogEnvelope, RoutingPurposePolicy] = await Promise.all([fetchRoutingPurposeCatalog(run.scope.projectId, run.scope.token, abort.signal), fetchRoutingPurposePolicy(run.scope.projectId, run.scope.token, abort.signal)]);
        if (catalog.projectId === run.scope.projectId && policy.projectId === run.scope.projectId && catalog.catalogRevision === policy.catalogRevision) { snapshot = { catalog, policy }; break; }
      }
      if (!snapshot) throw new PathFinderPolicyApiError('CATALOG_CHANGED', 409, 'The project changed while loading. Refresh routing permissions.');
      if (!current(run) || id !== run.readId || abort.signal.aborted) return;
      update(run, previous => ({ ...previous, snapshot, draft: draftFor(snapshot.policy), loading: false, refreshing: false, stale: false, conflict: null, error: null, uncertain: false }));
      void historyRun(run);
    } catch (error) {
      if (!current(run) || id !== run.readId || abort.signal.aborted) return;
      if (denied(error)) forgetDenied(run, error);
      else update(run, previous => ({ ...previous, loading: false, refreshing: false, stale: true, error: message(error) }));
    }
  }, [current, forgetDenied, historyRun, update]);

  useEffect(() => {
    const run: Run = { scope, closed: false, readId: 0, historyId: 0, mutation: false };
    runRef.current = run;
    const next = initial(scope); stateRef.current = next; setState(next);
    if (enabled(scope)) void refreshRun(run);
    return () => { run.closed = true; run.read?.abort(); run.history?.abort(); run.save?.abort(); run.pending = undefined; if (runRef.current === run) runRef.current = null; };
  }, [scope, refreshRun]);

  const refresh = useCallback(async (discard = false): Promise<void> => {
    const run = runRef.current;
    if (!run || !current(run) || run.mutation || run.pending) return;
    if (!discard && dirty(stateRef.current)) { update(run, previous => ({ ...previous, refreshPrompt: true })); return; }
    await refreshRun(run);
  }, [current, refreshRun, update]);
  const cancelRefresh = useCallback(() => { const run = runRef.current; if (run) update(run, previous => ({ ...previous, refreshPrompt: false })); }, [update]);
  const change = useCallback((purposeKey: string, categories: RoutingCategory[] | undefined) => {
    const run = runRef.current, previous = stateRef.current;
    if (!run || !current(run) || run.mutation || run.pending || previous.scope !== run.scope || previous.stale || previous.loading || previous.refreshing || previous.conflict || !previous.snapshot) return;
    if (!authorable(previous.snapshot, purposeKey)) return;
    update(run, value => { const draft = new Map(value.draft); if (categories === undefined) draft.delete(purposeKey); else draft.set(purposeKey, ROUTING_CATEGORIES.filter(category => categories.includes(category))); return { ...value, draft, notice: null, error: null }; });
  }, [current, update]);
  const toggle = useCallback((purposeKey: string, category: RoutingCategory, checked: boolean) => {
    const selected = stateRef.current.draft.get(purposeKey) ?? [];
    change(purposeKey, checked ? [...selected, category] : selected.filter(item => item !== category));
  }, [change]);

  const send = useCallback(async (run: Run, body: RoutingPurposeWrite): Promise<void> => {
    if (!current(run) || run.mutation || !run.scope.projectId || !run.scope.token) return;
    run.pending = body; run.mutation = true; ++run.readId; run.read?.abort(); ++run.historyId; run.history?.abort();
    const abort = new AbortController(); run.save = abort;
    update(run, previous => ({ ...previous, saving: true, uncertain: false, historyLoading: false, error: null, notice: null, refreshPrompt: false }));
    let confirmedNotice: string | undefined;
    try {
      const receipt = await saveRoutingPurposePolicy(run.scope.projectId, run.scope.token, body, abort.signal);
      if (!current(run) || abort.signal.aborted) return;
      run.pending = undefined;
      confirmedNotice = receipt.duplicate ? 'This save was already processed. Current permissions have been refreshed.' : 'Routing permissions saved.';
      update(run, previous => ({ ...previous, saving: false, stale: true, uncertain: false, notice: 'Save confirmed. Refreshing current permissions...' }));
    } catch (error) {
      if (!current(run) || abort.signal.aborted) return;
      if (denied(error)) forgetDenied(run, error);
      else if (error instanceof PathFinderPolicyApiError && error.confirmedRejection) {
        run.pending = undefined;
        update(run, previous => ({ ...previous, saving: false, uncertain: false, stale: error.status === 409 || previous.stale,
          conflict: error.status === 409 ? conflictText : null, error: message(error) }));
      } else update(run, previous => ({ ...previous, saving: false, uncertain: true, error: 'The save outcome is unknown. Retry the same save to confirm it before making more changes.' }));
    } finally { run.mutation = false; run.save = undefined; }
    if (confirmedNotice && current(run)) await refreshRun(run, confirmedNotice);
  }, [current, forgetDenied, refreshRun, update]);

  const save = useCallback(async (): Promise<void> => {
    const run = runRef.current, previous = stateRef.current;
    if (!run || !current(run) || run.mutation || run.pending || previous.scope !== run.scope || !previous.snapshot || previous.stale || previous.loading || previous.refreshing || previous.conflict || !validChanges(previous) || !dirty(previous)) return;
    const base = draftFor(previous.snapshot.policy);
    const changes: RoutingPurposeWrite['changes'] = [...new Set([...base.keys(), ...previous.draft.keys()])].sort().flatMap<RoutingPurposeWrite['changes'][number]>(purposeKey => {
      const selected = previous.draft.get(purposeKey);
      if (same(selected, base.get(purposeKey))) return [];
      return selected === undefined ? [{ purposeKey, operation: 'reset' as const }] : [{ purposeKey, operation: 'set' as const, allowedCategories: [...selected] }];
    });
    await send(run, { schemaVersion: 'pathfinder.routing-purpose-policy.write.v1', expectedCatalogRevision: previous.snapshot.catalog.catalogRevision,
      expectedRevision: previous.snapshot.policy.routingPolicyRevision, idempotencyKey: crypto.randomUUID(), changes });
  }, [current, send]);
  const retrySave = useCallback(async (): Promise<void> => { const run = runRef.current; if (run && current(run) && run.pending && !run.mutation) await send(run, run.pending); }, [current, send]);
  const refreshHistory = useCallback(async (): Promise<void> => { const run = runRef.current; if (run) await historyRun(run); }, [historyRun]);
  const moreHistory = useCallback(async (): Promise<void> => { const run = runRef.current; if (run) await historyRun(run, true); }, [historyRun]);

  const view = state.scope === scope && enabled(scope) ? state : initial(scope);
  const rows = useMemo<RoutingPurposeRow[]>(() => {
    if (!view.snapshot) return [];
    const counts = new Map<string | null, number>();
    for (const row of view.snapshot.catalog.rows) counts.set(row.purposeKey, (counts.get(row.purposeKey) ?? 0) + 1);
    return [...counts].sort(([left], [right]) => left === null ? 1 : right === null ? -1 : left < right ? -1 : left > right ? 1 : 0).map(([purposeKey, trayCount]) => ({
      purposeKey, trayCount, blocked: purposeKey === null || !authorable(view.snapshot!, purposeKey), categories: purposeKey === null ? [] : view.draft.get(purposeKey) ?? [],
      configured: purposeKey !== null && view.draft.has(purposeKey), dirty: purposeKey !== null && !same(view.draft.get(purposeKey), view.snapshot!.policy.rules.find(rule => rule.purposeKey === purposeKey)?.allowedCategories),
    }));
  }, [view]);
  const isDirty = dirty(view), busy = view.loading || view.refreshing || view.saving;
  return { ...view, rows, dirty: isDirty, busy, canEdit: enabled(scope) && Boolean(view.snapshot) && !busy && !view.stale && !view.conflict && !view.uncertain,
    canSave: enabled(scope) && Boolean(view.snapshot) && isDirty && !busy && !view.stale && !view.conflict && !view.uncertain && validChanges(view),
    canRetrySave: enabled(scope) && view.uncertain && !view.saving, refresh, cancelRefresh, toggle, reset: (key: string) => change(key, undefined), exclude: (key: string) => change(key, []), save, retrySave, refreshHistory, moreHistory };
}
