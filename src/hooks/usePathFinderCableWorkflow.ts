import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchPathFinderCableWorkflowPage, fetchPathFinderCableWorkflowDetail, PathFinderCableWorkflowApiError,
  type CableWorkflowPage, type CableWorkflowQuery, type CableWorkflowDetail,
} from '@/api/pathfinderCableWorkflow';
import { cableWorkflowQuerySchema } from '../../shared/pathfinderCableWorkflowQueries';

export type PathFinderCableWorkflowAccess = {
  projectId: string | null; loadedProjectId: string | null; accountId: string | null; token: string | null;
  isAdmin: boolean; active: boolean; modelScopeKey: string; query?: Partial<Omit<CableWorkflowQuery, 'cursor'>>;
  onAuthorityLost?: () => void;
};
type State = { identity: string; page: CableWorkflowPage | null; detail: CableWorkflowDetail | null;
  loading: boolean; detailLoading: boolean; error: string | null; hasPrevious: boolean };
type Selection = { identity: string; cursor: string | null; history: Array<string | null>; context: string | null;
  queryHash: string | null; page: CableWorkflowPage | null };
const initial = (identity: string): State => ({ identity, page: null, detail: null, loading: false, detailLoading: false, error: null, hasPrevious: false });
const selected = (identity: string): Selection => ({ identity, cursor: null, history: [], context: null, queryHash: null, page: null });
const changed = () => new PathFinderCableWorkflowApiError('WORKFLOW_CONTEXT_CHANGED', 409, 'The project changed. Refresh the cable list before continuing.');

/** One owned read at a time. These display-only pages never authorize a write. */
export function usePathFinderCableWorkflow(access: PathFinderCableWorkflowAccess) {
  const parsedQuery = cableWorkflowQuerySchema.safeParse(access.query ?? {});
  const queryKey = parsedQuery.success && parsedQuery.data.cursor === undefined ? JSON.stringify(parsedQuery.data) : null;
  const account = JSON.stringify([access.projectId, access.loadedProjectId, access.accountId, access.token, access.isAdmin]);
  const identity = JSON.stringify([account, access.active, access.modelScopeKey, queryKey]);
  const allowed = Boolean(access.active && access.isAdmin && access.accountId && access.token && access.projectId && access.projectId === access.loadedProjectId && queryKey !== null);
  const [state, setState] = useState<State>(() => initial(identity));
  const latest = useRef(identity); latest.current = identity;
  const callbacks = useRef(access); callbacks.current = access;
  const selection = useRef(selected(identity)), inFlight = useRef<AbortController | null>(null);
  const previousAccount = useRef(account), deniedAccount = useRef<string | null>(null);
  const canRead = useCallback(() => allowed && latest.current === identity && selection.current.identity === identity && deniedAccount.current !== account,
    [allowed, identity, account]);
  const failure = useCallback((error: unknown) => {
    if (error instanceof PathFinderCableWorkflowApiError && [401, 403].includes(error.status ?? 0)) {
      deniedAccount.current = account; selection.current = selected(identity);
      setState({ ...initial(identity), error: error.message }); callbacks.current.onAuthorityLost?.();
    } else if (error instanceof PathFinderCableWorkflowApiError && error.status === 409) {
      selection.current = selected(identity); setState({ ...initial(identity), error: error.message });
    } else setState(value => ({ ...value, loading: false, detailLoading: false,
      error: error instanceof PathFinderCableWorkflowApiError ? error.message : 'Cable diagnostics could not be read. Refresh the list to try again.' }));
  }, [account, identity]);
  const load = useCallback(async (cursor: string | null, history: Array<string | null>, reset = false) => {
    if (!canRead() || inFlight.current || queryKey === null) return;
    const abort = new AbortController(); inFlight.current = abort;
    const before = selection.current;
    setState(value => ({ ...value, page: null, detail: null, loading: true, detailLoading: false, error: null, hasPrevious: history.length > 0 }));
    try {
      const query: CableWorkflowQuery = JSON.parse(queryKey);
      const page = await fetchPathFinderCableWorkflowPage(access.projectId!, access.token!, { ...query, ...(cursor ? { cursor } : {}) }, abort.signal);
      if (latest.current !== identity || abort.signal.aborted) return;
      if (!reset && before.context !== null && (before.context !== page.contextSha256 || before.queryHash !== page.querySha256)) throw changed();
      if (page.nextCursor !== null && (page.nextCursor === cursor || history.includes(page.nextCursor))) throw changed();
      if (page.scannedCount !== 0 && cursor !== null && cursor === before.page?.nextCursor && before.page.scannedThroughCableId !== null
        && (page.scannedThroughCableId === null || page.scannedThroughCableId <= before.page.scannedThroughCableId
          || page.rows.some(row => row.cable.id <= before.page!.scannedThroughCableId!))) throw changed();
      selection.current = { identity, cursor, history, context: page.contextSha256, queryHash: page.querySha256, page };
      setState({ ...initial(identity), page, hasPrevious: history.length > 0 });
    } catch (error) { if (latest.current === identity && !abort.signal.aborted) failure(error); }
    finally { if (inFlight.current === abort) inFlight.current = null; }
  }, [canRead, queryKey, access.projectId, access.token, identity, failure]);
  useEffect(() => {
    inFlight.current?.abort(); inFlight.current = null;
    if (previousAccount.current !== account) deniedAccount.current = null;
    previousAccount.current = account; selection.current = selected(identity); setState(initial(identity));
    if (allowed && deniedAccount.current !== account) void load(null, [], true);
    return () => { inFlight.current?.abort(); inFlight.current = null; };
  }, [identity, account, allowed, load]);
  const readDetail = useCallback(async (cableId: string): Promise<CableWorkflowDetail | null> => {
    if (!canRead() || inFlight.current || queryKey === null) return null;
    const page = selection.current.page, row = page?.rows.find(value => value.cable.id === cableId);
    if (!page || !row) return null;
    const abort = new AbortController(); inFlight.current = abort;
    setState(value => ({ ...value, detail: null, detailLoading: true, error: null }));
    try {
      const query: CableWorkflowQuery = JSON.parse(queryKey);
      const detail = await fetchPathFinderCableWorkflowDetail(access.projectId!, access.token!, cableId,
        { secondaryDistanceMeters: query.secondaryDistanceMeters, preferVerticalApproach: query.preferVerticalApproach }, abort.signal);
      if (latest.current !== identity || abort.signal.aborted) return null;
      if (detail.contextSha256 !== page.contextSha256 || JSON.stringify(detail.row.cable) !== JSON.stringify(row.cable) || detail.row.mto !== row.mto) throw changed();
      setState(value => ({ ...value, detail, detailLoading: false })); return detail;
    } catch (error) { if (latest.current === identity && !abort.signal.aborted) failure(error); return null; }
    finally { if (inFlight.current === abort) inFlight.current = null; }
  }, [canRead, queryKey, access.projectId, access.token, identity, failure]);
  const current = state.identity === identity && allowed ? state : { ...initial(identity),
    error: queryKey === null ? 'Choose supported cable filters before loading the list.' : null };
  return { ...current, enabled: allowed && deniedAccount.current !== account, readDetail,
    busy: current.loading || current.detailLoading,
    refresh: () => { if (canRead()) void load(null, [], true); },
    nextPage: () => { const page = selection.current.page; if (canRead() && page?.nextCursor) void load(page.nextCursor, [...selection.current.history, selection.current.cursor]); },
    previousPage: () => { if (!canRead() || !selection.current.history.length) return; const history = [...selection.current.history], cursor = history.pop() ?? null; void load(cursor, history); },
  };
}
