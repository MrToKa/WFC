import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchRevisionAdmissions, fetchRevisionResultsPage, fetchRevisionResultDetail, RevisionResultsApiError,
  type RevisionAdmissionsPage, type RevisionResultsPage, type RevisionResultDetail,
} from '@/api/pathfinderRevisionResults';
import type { PathFinderJob } from '@/api/pathfinder';

type Admission = RevisionAdmissionsPage['admissions'][number];
type Row = RevisionResultsPage['rows'][number];
export type RevisionResultsAccess = {
  projectId: string | null; loadedProjectId: string | null; token: string | null; accountId: string | null;
  isAdmin: boolean; active: boolean; contextKey: string; onAuthorityLost?: () => void;
  jobs?: ReadonlyArray<Pick<PathFinderJob, 'id' | 'status' | 'cancelRequested'>>;
};
type State = {
  identity: string; admissions: Admission[]; nextAdmissionsCursor: string | null; admission: Admission | null;
  page: RevisionResultsPage | null; detail: RevisionResultDetail | null;
  admissionsLoading: boolean; pageLoading: boolean; detailLoading: boolean; error: string | null;
  previousAdmissions: boolean; previousPage: boolean;
};
type Selection = {
  identity: string; admission: Admission | null; admissionsCursor: string | null; admissionsHistory: Array<string | null>;
  pageCursor: string | null; pageHistory: Array<string | null>; rows: Row[];
};
const initial = (identity: string): State => ({ identity, admissions: [], nextAdmissionsCursor: null, admission: null, page: null, detail: null,
  admissionsLoading: false, pageLoading: false, detailLoading: false, error: null, previousAdmissions: false, previousPage: false });
const selectionFor = (identity: string): Selection => ({ identity, admission: null, admissionsCursor: null, admissionsHistory: [], pageCursor: null, pageHistory: [], rows: [] });
const rowIdentity = (row: Row): string => JSON.stringify([row.cableId, row.baselineHash, row.result?.proposalId, row.result?.proposalHash, row.result?.revisionResultSha256]);

/** Read-only pages. Changing ownership cancels every outstanding read and drops all cursors. */
export function usePathfinderRevisionResults(access: RevisionResultsAccess) {
  const account = JSON.stringify([access.projectId, access.loadedProjectId, access.accountId, access.token, access.isAdmin]);
  const identity = JSON.stringify([account, access.active, access.contextKey]);
  const allowed = Boolean(access.isAdmin && access.accountId && access.token && access.projectId && access.projectId === access.loadedProjectId);
  const [state, setState] = useState<State>(() => initial(identity));
  const latest = useRef(identity); latest.current = identity;
  const callbacks = useRef(access); callbacks.current = access;
  const previousAccount = useRef(account), deniedAccount = useRef<string | null>(null);
  const selection = useRef<Selection>(selectionFor(identity));
  const admissionsAbort = useRef<AbortController | null>(null), pageAbort = useRef<AbortController | null>(null), detailAbort = useRef<AbortController | null>(null);
  const current = state.identity === identity ? state : initial(identity);
  const enabled = allowed && deniedAccount.current !== account;
  const canRead = useCallback(() => allowed && access.active && deniedAccount.current !== account && latest.current === identity && selection.current.identity === identity,
    [allowed, access.active, account, identity]);
  const failure = useCallback((error: unknown) => {
    if (error instanceof RevisionResultsApiError && [401, 403].includes(error.status ?? 0)) {
      deniedAccount.current = account; admissionsAbort.current?.abort(); pageAbort.current?.abort(); detailAbort.current?.abort();
      selection.current = selectionFor(identity);
      setState({ ...initial(identity), error: 'Administrator access is required. Refresh your account before continuing.' });
      callbacks.current.onAuthorityLost?.();
    } else setState(value => ({ ...value, error: error instanceof Error ? error.message : 'Cable revision results could not be read.' }));
  }, [account, identity]);
  const loadPage = useCallback(async (admission: Admission, cursor: string | null, history: Array<string | null>) => {
    if (!canRead()) return;
    pageAbort.current?.abort(); detailAbort.current?.abort(); const abort = new AbortController(); pageAbort.current = abort;
    selection.current = { ...selection.current, admission, pageCursor: cursor, pageHistory: history, rows: [] };
    setState(value => ({ ...value, admission, page: null, detail: null, pageLoading: true, detailLoading: false, previousPage: history.length > 0, error: null }));
    try {
      const page = await fetchRevisionResultsPage(access.projectId!, access.token!, admission.id, cursor ? { afterCableId: cursor } : {}, abort.signal);
      if (latest.current !== identity || abort.signal.aborted) return;
      if (page.rows.some(row => cursor !== null && row.cableId <= cursor)
        || page.nextAfterCableId !== null && page.nextAfterCableId !== page.rows.at(-1)?.cableId) throw new RevisionResultsApiError('INVALID_RESPONSE', null, 'The cable page cursor could not be verified. Refresh this calculation scope.');
      selection.current.rows = page.rows;
      setState(value => ({ ...value, page, pageLoading: false, error: null }));
    } catch (error) { if (latest.current === identity && !abort.signal.aborted) { setState(value => ({ ...value, pageLoading: false })); failure(error); } }
  }, [canRead, access.projectId, access.token, identity, failure]);
  const loadAdmissions = useCallback(async (cursor: string | null, history: Array<string | null>) => {
    if (!canRead()) return;
    admissionsAbort.current?.abort(); const abort = new AbortController(); admissionsAbort.current = abort;
    selection.current.admissionsCursor = cursor; selection.current.admissionsHistory = history;
    setState(value => ({ ...value, admissionsLoading: true, previousAdmissions: history.length > 0, error: null }));
    try {
      const page = await fetchRevisionAdmissions(access.projectId!, access.token!, cursor ? { cursor } : {}, abort.signal);
      if (latest.current !== identity || abort.signal.aborted) return;
      if (page.nextCursor !== null && (page.nextCursor === cursor || history.includes(page.nextCursor))) throw new RevisionResultsApiError('INVALID_RESPONSE', null, 'The calculation page cursor could not be verified. Refresh the calculation list.');
      setState(value => ({ ...value, admissions: page.admissions, nextAdmissionsCursor: page.nextCursor, admissionsLoading: false, error: null }));
      // A later admission never retargets the scope already being reviewed.
      if (!selection.current.admission && page.admissions[0]) {
        // Recent job metadata only guides the first selection. It neither grants
        // Apply authority nor resets a scope when a later poll updates that list.
        const knownComplete = page.admissions.find(admission => admission.jobId !== null
          && callbacks.current.jobs?.some(job => job.id === admission.jobId && job.status === 'complete' && !job.cancelRequested));
        await loadPage(knownComplete ?? page.admissions[0], null, []);
      }
    } catch (error) { if (latest.current === identity && !abort.signal.aborted) { setState(value => ({ ...value, admissionsLoading: false })); failure(error); } }
  }, [canRead, access.projectId, access.token, identity, failure, loadPage]);
  useEffect(() => {
    admissionsAbort.current?.abort(); pageAbort.current?.abort(); detailAbort.current?.abort();
    if (previousAccount.current !== account) deniedAccount.current = null;
    previousAccount.current = account; selection.current = selectionFor(identity); setState(initial(identity));
    if (allowed && access.active && deniedAccount.current !== account) void loadAdmissions(null, []);
    return () => { admissionsAbort.current?.abort(); pageAbort.current?.abort(); detailAbort.current?.abort(); };
  }, [identity, account, allowed, access.active, loadAdmissions]);
  const readDetail = useCallback(async (cableId: string) => {
    if (!canRead()) return;
    const selected = selection.current, row = selected.rows.find(value => value.cableId === cableId);
    if (!selected.admission || !row) return;
    detailAbort.current?.abort(); const abort = new AbortController(); detailAbort.current = abort;
    setState(value => ({ ...value, detail: null, detailLoading: true, error: null }));
    try {
      const detail = await fetchRevisionResultDetail(access.projectId!, access.token!, selected.admission.id, cableId, abort.signal);
      if (latest.current !== identity || abort.signal.aborted) return;
      const currentRow = selection.current.rows.find(value => value.cableId === cableId);
      if (selection.current.admission?.id !== selected.admission.id || !currentRow || rowIdentity(currentRow) !== rowIdentity(row) || rowIdentity(detail.row) !== rowIdentity(row)) {
        throw new RevisionResultsApiError('REVISION_RESULT_CHANGED', 409, 'The selected immutable result no longer matches this page. Refresh the same calculation scope.');
      }
      setState(value => ({ ...value, detail, detailLoading: false, error: null }));
    } catch (error) { if (latest.current === identity && !abort.signal.aborted) { setState(value => ({ ...value, detailLoading: false })); failure(error); } }
  }, [canRead, access.projectId, access.token, identity, failure]);
  const refresh = useCallback(() => {
    if (!canRead()) return;
    const selected = selection.current;
    void loadAdmissions(selected.admissionsCursor, [...selected.admissionsHistory]);
    if (selected.admission) void loadPage(selected.admission, selected.pageCursor, [...selected.pageHistory]);
  }, [canRead, loadAdmissions, loadPage]);
  return {
    ...current, enabled, refresh, readDetail,
    selectAdmission: (id: string) => { const admission = current.admissions.find(value => value.id === id); if (admission && canRead()) void loadPage(admission, null, []); },
    nextAdmissions: () => { if (current.nextAdmissionsCursor && canRead()) void loadAdmissions(current.nextAdmissionsCursor, [...selection.current.admissionsHistory, selection.current.admissionsCursor]); },
    previousAdmissionsPage: () => { if (canRead() && selection.current.admissionsHistory.length) { const history = [...selection.current.admissionsHistory], cursor = history.pop() ?? null; void loadAdmissions(cursor, history); } },
    nextPage: () => { if (canRead() && current.page?.nextAfterCableId && selection.current.admission) void loadPage(selection.current.admission, current.page.nextAfterCableId, [...selection.current.pageHistory, selection.current.pageCursor]); },
    previousResultsPage: () => { if (canRead() && selection.current.admission && selection.current.pageHistory.length) { const history = [...selection.current.pageHistory], cursor = history.pop() ?? null; void loadPage(selection.current.admission, cursor, history); } },
  };
}
