import { useCallback, useEffect, useRef, useState } from 'react';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy';
import { endpointCurrentScopeSchema, type EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings';
import { locationImpactCalculationSchema } from '../../shared/pathfinderLocationImpacts';
import { fetchLocationImpacts, fetchLocationImpactProgress, LocationImpactApiError,
  type LocationImpactSummary, type LocationImpactCalculation } from '@/api/pathfinderLocationImpacts';

export const LOCATION_IMPACT_POLL_MILLISECONDS = 2000;
export type LocationImpactProgressAccess = {
  projectId: string | null; loadedProjectId: string | null; accountId: string | null; token: string | null; isAdmin: boolean;
  active: boolean; current: EndpointCurrentScope | null; calculation: LocationImpactCalculation | null; impactId?: string | null;
  onChanged?: (impact: LocationImpactSummary) => void; onAuthorityLost?: () => void;
};
type State = { identity: string; history: LocationImpactSummary[]; historyChecked: number; nextBeforeId: string | null;
  hasPrevious: boolean; impact: LocationImpactSummary | null; loading: boolean; error: string | null; readMilliseconds: number | null };
type Selection = { identity: string; id: string | null; cursor: string | null; cursors: Array<string | null>;
  boundary: LocationImpactSummary | null; changeKey: string | null; impact: LocationImpactSummary | null };
const initial = (identity: string): State => ({ identity, history: [], historyChecked: 0, nextBeforeId: null, hasPrevious: false, impact: null, loading: false, error: null, readMilliseconds: null });
const selectionFor = (identity: string, id: string | null): Selection => ({ identity, id, cursor: null, cursors: [], boundary: null, changeKey: null, impact: null });
const activeStatus = (value: LocationImpactSummary) => value.currentAuthority && ['pending', 'collecting', 'queued', 'running'].includes(value.status);
const changeKey = (value: LocationImpactSummary) => canonicalPurposeJson({ id: value.id, status: value.status, reasons: value.reasonCodes, completed: value.completed, total: value.total,
  ready: value.readyCables, blocked: value.blockedCables, targets: value.currentTargetCables, jobId: value.jobId, authority: value.currentAuthority });
const before = (a: LocationImpactSummary, b: LocationImpactSummary) => Date.parse(a.createdAt) < Date.parse(b.createdAt) || a.createdAt === b.createdAt && a.id < b.id;

/** Polls only a bounded owned summary. It neither starts work nor writes cable values. */
export function usePathfinderLocationImpactProgress(access: LocationImpactProgressAccess) {
  const account = JSON.stringify([access.projectId, access.loadedProjectId, access.accountId, access.token, access.isAdmin]);
  const parsedScope = endpointCurrentScopeSchema.safeParse(access.current), parsedCalculation = locationImpactCalculationSchema.nullable().safeParse(access.calculation);
  const scopeKey = parsedScope.success && parsedCalculation.success ? canonicalPurposeJson({ current: parsedScope.data, calculation: parsedCalculation.data }) : null;
  const identity = JSON.stringify([account, scopeKey, access.impactId ?? null]);
  const allowed = Boolean(scopeKey !== null && access.isAdmin && access.token && policyUuidSchema.safeParse(access.accountId).success && policyUuidSchema.safeParse(access.projectId).success && access.projectId === access.loadedProjectId);
  const [state, setState] = useState<State>(() => initial(identity)), [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  const latest = useRef({ identity, allowed, active: access.active, hidden }); latest.current = { identity, allowed, active: access.active, hidden };
  const callbacks = useRef(access); callbacks.current = access;
  const selection = useRef(selectionFor(identity, access.impactId ?? null)), mounted = useRef(false), denied = useRef<string | null>(null), suspended = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), request = useRef<{ abort: AbortController; promise: Promise<void> } | null>(null);
  const schedule = useRef<() => void>(() => {}), exactRead = useRef<(id: string) => Promise<void>>(async () => {});
  const current = state.identity === identity && allowed ? state : initial(identity);
  const clearTimer = useCallback(() => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  const live = useCallback(() => mounted.current && latest.current.identity === identity && latest.current.allowed && selection.current.identity === identity, [identity]);
  const canRead = useCallback(() => live() && latest.current.active && !latest.current.hidden && document.visibilityState !== 'hidden' && denied.current !== account, [live, account]);
  const matchesScope = useCallback((value: LocationImpactSummary) => {
    if (scopeKey === null) return false;
    const expected = JSON.parse(scopeKey) as { current: EndpointCurrentScope | null; calculation: LocationImpactCalculation | null };
    return value.projectId === access.projectId && value.actorId === access.accountId && expected.current !== null && value.modelVersionId === expected.current.modelVersionId && value.selectionRevision === expected.current.selectionRevision
      && value.contentFingerprint === expected.current.contentFingerprint && canonicalPurposeJson(value.current) === canonicalPurposeJson(expected.current)
      && canonicalPurposeJson(value.calculation) === canonicalPurposeJson(expected.calculation);
  }, [scopeKey, access.projectId, access.accountId]);
  const accept = useCallback((value: LocationImpactSummary) => {
    const nextKey = changeKey(value), previousKey = selection.current.changeKey;
    selection.current.id = value.id; selection.current.impact = value; selection.current.changeKey = nextKey;
    setState(previous => ({ ...previous, impact: value, error: null }));
    if (previousKey !== null && previousKey !== nextKey) {
      try { callbacks.current.onChanged?.(value); }
      catch { setState(previous => ({ ...previous, error: 'Progress was verified. Refresh the cable diagnostics to update their display.' })); }
    }
  }, []);
  const runRead = useCallback((operation: (signal: AbortSignal) => Promise<void>): Promise<void> => {
    if (!canRead()) return Promise.resolve(); if (request.current) return request.current.promise;
    clearTimer(); const ticket = { abort: new AbortController(), promise: Promise.resolve() }; request.current = ticket;
    const began = performance.now(); setState(previous => ({ ...previous, loading: true, error: null }));
    ticket.promise = (async () => {
      try { await operation(ticket.abort.signal); }
      catch (error) {
        if (!live() || ticket.abort.signal.aborted) return;
        suspended.current = true;
        if (error instanceof LocationImpactApiError && [401, 403].includes(error.status ?? 0)) {
          denied.current = account; selection.current = selectionFor(identity, null); setState({ ...initial(identity), error: error.message }); callbacks.current.onAuthorityLost?.();
        } else setState(previous => ({ ...previous, impact: null, error: error instanceof LocationImpactApiError ? error.message : 'Location progress could not be read. Refresh to try again.' }));
      } finally {
        if (request.current === ticket) {
          request.current = null;
          if (live()) setState(previous => ({ ...previous, loading: false, readMilliseconds: Math.max(0, performance.now() - began) }));
          schedule.current();
        }
      }
    })(); return ticket.promise;
  }, [canRead, clearTimer, live, account, identity]);
  const loadExact = useCallback((id: string) => runRead(async signal => {
    const result = await fetchLocationImpactProgress(access.projectId!, access.token!, access.accountId!, id, signal);
    if (!live() || signal.aborted) return;
    if (!matchesScope(result.impact)) throw new LocationImpactApiError('IMPACT_SCOPE_CHANGED', 409, 'This impact belongs to different model preparation or calculation settings. Select a matching impact from history.');
    accept(result.impact);
  }), [runRead, access.projectId, access.token, access.accountId, live, matchesScope, accept]);
  exactRead.current = loadExact;
  schedule.current = () => {
    clearTimer(); const selected = selection.current;
    if (canRead() && !suspended.current && selected.id && selected.impact && activeStatus(selected.impact)) timer.current = setTimeout(() => { timer.current = null; void exactRead.current(selected.id!); }, LOCATION_IMPACT_POLL_MILLISECONDS);
  };
  const loadHistory = useCallback((cursor: string | null, cursors: Array<string | null>, reset = false) => runRead(async signal => {
    const previous = selection.current, page = await fetchLocationImpacts(access.projectId!, access.token!, access.accountId!, cursor ? { beforeId: cursor } : {}, signal);
    if (!live() || signal.aborted) return;
    if (page.nextBeforeId !== null && (page.nextBeforeId === cursor || cursors.includes(page.nextBeforeId))
      || !reset && cursor !== null && previous.boundary && page.impacts.some(value => !before(value, previous.boundary!))) throw new LocationImpactApiError('IMPACT_CURSOR_CHANGED', 409, 'Impact history did not advance. Refresh its first page.');
    const history = page.impacts.filter(matchesScope);
    selection.current.cursor = cursor; selection.current.cursors = cursors; selection.current.boundary = page.impacts.at(-1) ?? null;
    setState(value => ({ ...value, history, historyChecked: page.impacts.length, nextBeforeId: page.nextBeforeId, hasPrevious: cursors.length > 0 }));
    if (!selection.current.id && history[0]) accept(history[0]);
  }), [runRead, access.projectId, access.token, access.accountId, live, matchesScope, accept]);
  const refresh = useCallback((): Promise<void> => {
    if (!canRead()) return Promise.resolve(); suspended.current = false;
    return selection.current.id ? loadExact(selection.current.id) : loadHistory(selection.current.cursor, [...selection.current.cursors]);
  }, [canRead, loadExact, loadHistory]);
  useEffect(() => {
    const observe = () => setHidden(document.visibilityState === 'hidden'); document.addEventListener('visibilitychange', observe);
    return () => document.removeEventListener('visibilitychange', observe);
  }, []);
  useEffect(() => {
    mounted.current = true; clearTimer(); request.current?.abort.abort(); request.current = null; suspended.current = false;
    selection.current = selectionFor(identity, access.impactId ?? null); setState(initial(identity)); void refresh();
    return () => { mounted.current = false; clearTimer(); request.current?.abort.abort(); request.current = null; };
  }, [identity, clearTimer, access.impactId, refresh]);
  useEffect(() => {
    if (!access.active || hidden) { clearTimer(); request.current?.abort.abort(); request.current = null; if (live()) setState(previous => ({ ...previous, loading: false })); }
    else void refresh();
  }, [access.active, hidden, identity, clearTimer, live, refresh]);
  return { ...current, enabled: allowed && denied.current !== account, paused: !access.active || hidden, refresh,
    refreshHistory: () => { suspended.current = false; return loadHistory(null, [], true); },
    selectImpact: (id: string) => { if (!current.history.some(value => value.id === id) || !canRead()) return Promise.resolve(); suspended.current = false; return loadExact(id); },
    nextHistoryPage: () => { if (!current.nextBeforeId || !canRead()) return Promise.resolve(); suspended.current = false; return loadHistory(current.nextBeforeId, [...selection.current.cursors, selection.current.cursor]); },
    previousHistoryPage: () => { if (!canRead() || !selection.current.cursors.length) return Promise.resolve(); const cursors = [...selection.current.cursors], cursor = cursors.pop() ?? null; suspended.current = false; return loadHistory(cursor, cursors, true); },
  };
}
