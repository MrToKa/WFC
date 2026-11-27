import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Caption1, ProgressBar, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, makeStyles, tokens } from '@fluentui/react-components';
import { bulkCalculationRequestSchema, cancelPathFinderJob, fetchLegacyBulkCalculationJob, fetchPathFinderJob, PathFinderApiError, submitAllPathFinderCalculations, type PathFinderCalculationSubmission, type PathFinderCable, type PathFinderJob, type PathFinderPreferences, type PathFinderState } from '@/api/pathfinder';
import { missingCalculationLocationsMessage, type CalculationAvailability } from '../../../shared/pathfinderCalculationAvailability';
import { AUTOMATIC_PAIR_POLICY } from '../../../shared/pathfinderAutomaticPair';
import { BULK_CALCULATION_SUBMISSION_LIMITS, calculationSubmissionRefusalMessage } from '../../../shared/pathfinderCalculationSubmission';
import { pathFinderRequestDeadline } from '@/api/pathfinderRequestDeadline';
import { collectFilteredCableIds, PathFinderCableWorkflowApiError, type CableWorkflowQuery } from '@/api/pathfinderCableWorkflow';
import { generateId } from '@/utils/generateId';

type Credentials = { projectId: string; accountId: string; token: string };
type Props = Credentials & {
  modelKey: string;
  preferences: PathFinderPreferences | null; disabled: boolean; blocker: string | null;
  endpointState?: Pick<PathFinderState, 'cables' | 'locations'> | null;
  refreshState: () => Promise<PathFinderState | null>; onChanged: () => void;
  onReviewReady?: (jobId: string) => void;
  children?: ReactNode;
};
type FilteredSelection = { query: Omit<CableWorkflowQuery, 'cursor'>; contextSha256: string };
type IssueSelection = { kind: 'calculation' | 'saving'; reason: string; trigger: HTMLButtonElement };
type SelectedIssue = { selection: IssueSelection; cableIds: readonly string[] };
const FilteredRecalculation = createContext<{
  disabled: boolean; start: (selection: FilteredSelection) => Promise<void>; progress: ReactNode;
  issue: SelectedIssue | null; closeIssue: () => void;
} | null>(null);
export const useFilteredCableRecalculation = () => useContext(FilteredRecalculation);
type JobItem = NonNullable<PathFinderJob['items']>[number];
const isUnsavedCalculation = (item: JobItem) => item.status === 'calculated' && (!item.automaticUpdate
  || ['refused', 'stale', 'authority-expired', 'unknown'].includes(item.automaticUpdate.status));
const isBlockedCalculation = (item: JobItem) =>
  ['complete', 'blocked', 'cancelled', 'failed'].includes(item.state) && item.status !== 'calculated';

export function backgroundCalculationCounts(job: PathFinderJob) {
  const items = job.items ?? [];
  const saved = items.filter(item => ['written', 'already-written'].includes(item.automaticUpdate?.status ?? '')).length;
  const unchanged = items.filter(item => item.automaticUpdate?.status === 'unchanged').length;
  const pendingUpdates = items.filter(item => {
    const status = item.automaticUpdate?.status;
    return status === 'pending' || status === 'running' || status === 'unknown' && !job.cancelRequested;
  }).length;
  const saving = items.filter(item => item.status === 'calculated' && ['pending', 'running'].includes(item.automaticUpdate?.status ?? '')).length;
  const calculated = items.filter(item => item.status === 'calculated').length;
  const review = items.filter(item => item.automaticUpdate?.status === 'review-required' && item.retainedRoute !== 'manual').length;
  const blocked = items.filter(isBlockedCalculation).length;
  const unsaved = items.filter(isUnsavedCalculation).length;
  return { saved, unchanged, saving, pendingUpdates, calculated, review, blocked, unsaved };
}

function savingReason(update: JobItem['automaticUpdate']) {
  if (!update) return 'No automatic save was scheduled';
  if (update.status === 'authority-expired' || update.reasonCode === 'AUTOMATIC_PAIR_AUTHORITY_EXPIRED')
    return 'Permission to save automatically expired';
  if (update.reasonCode === 'ROUTING_MANUAL_PROTECTED') return 'Protected manual route';
  if (update.reasonCode === 'ROUTING_EXECUTION_PROTECTED') return 'Execution-protected route';
  if (update.status === 'stale') return 'Calculation inputs changed before the save';
  if (update.status === 'review-required') return 'Review required before saving';
  if (update.status === 'unknown') return 'Save outcome is unconfirmed';
  return update.reasonCode ? `Automatic save refused (${update.reasonCode})` : 'Automatic save refused';
}

const retainedRouteLabels = {
  manual: 'with a retained manual route',
  execution: 'with a retained execution-protected route',
  saved: 'with an existing route in Cable list',
  none: 'without a saved route',
  unknown: 'with an unknown saved route status',
};

type SavingIssueGroup = { cableIds: string[]; routes: Map<keyof typeof retainedRouteLabels, number> };

function savingBreakdown(items: PathFinderJob['items']) {
  const groups = new Map<string, SavingIssueGroup>();
  for (const item of items ?? []) {
    if (item.status !== 'calculated' || (!isUnsavedCalculation(item) && item.automaticUpdate?.status !== 'review-required')) continue;
    const reason = savingReason(item.automaticUpdate);
    const group: SavingIssueGroup = groups.get(reason) ?? { cableIds: [], routes: new Map() };
    const route = item.retainedRoute ?? 'unknown';
    group.cableIds.push(item.cableId);
    group.routes.set(route, (group.routes.get(route) ?? 0) + 1);
    groups.set(reason, group);
  }
  return [...groups.entries()].sort(([, first], [, second]) => second.cableIds.length - first.cableIds.length);
}

const locationIssueMessages = new Set((['From', 'To', 'From and To'] as const).map(missingCalculationLocationsMessage));
const noIssueCables: readonly string[] = [];

function endpointReady(match: PathFinderCable['fromMatch'], locations: ReadonlyMap<string, CalculationAvailability | undefined>) {
  if (!match.locationId) return match.status === 'missing' || match.status === 'ambiguous' ? false : undefined;
  const availability = locations.get(match.locationId);
  if (!availability || ['not-evaluated', 'preparation-required'].includes(availability.status)) return undefined;
  return availability.pointAvailable;
}

function blockedCalculationBreakdown(items: PathFinderJob['items'], endpointState: Props['endpointState']) {
  if (!items?.length) return [];
  const cables = new Map(endpointState?.cables.map(cable => [cable.id, cable]));
  const locations = new Map(endpointState?.locations.map(location => [location.id, location.calculationAvailability]));
  const groups = new Map<string, { cableIds: string[] }>();
  for (const item of items) {
    if (!isBlockedCalculation(item)) continue;
    let reason = item.message?.trim() || 'No calculation reason was recorded.';
    // Use current endpoint availability only for the matching recorded blocker.
    if (item.status === 'locations_required' && locationIssueMessages.has(reason)) {
      const cable = cables.get(item.cableId);
      if (cable) {
        const from = endpointReady(cable.fromMatch, locations);
        const to = endpointReady(cable.toMatch, locations);
        if (from === true && to === true) continue;
        if (from !== undefined && to !== undefined)
          reason = missingCalculationLocationsMessage(!from && !to ? 'From and To' : !from ? 'From' : 'To');
      }
    }
    const group = groups.get(reason) ?? { cableIds: [] };
    group.cableIds.push(item.cableId);
    groups.set(reason, group);
  }
  return [...groups.entries()].sort(([, first], [, second]) => second.cableIds.length - first.cableIds.length);
}

/** Owns only its submission and lightweight progress reads. Never owns the
 * viewer, popup selection, global busy flag or the continuous automatic mode. */
export function PathFinderRecalculateAll(props: Omit<Props, keyof Credentials> & { [K in keyof Credentials]: string | null }) {
  if (!props.projectId || !props.accountId || !props.token) return props.children;
  const identity = JSON.stringify([props.projectId, props.accountId, props.token, props.modelKey]);
  return <BackgroundPass key={identity} {...props} projectId={props.projectId} accountId={props.accountId} token={props.token} />;
}
type BulkRequest = ReturnType<typeof bulkCalculationRequestSchema.parse>;
const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const filteredJobPrefix = 'filtered:';
function storedJobId(value: string | null) {
  const id = value?.startsWith(filteredJobPrefix) ? value.slice(filteredJobPrefix.length) : value;
  return id && jobIdPattern.test(id) ? id : null;
}
const unknownMessage = 'The server has not confirmed this request. Retry the same request to recover its status. You can continue working with individual cables.';
const legacyMessage = 'The previous request was not confirmed. Check the server for its job before starting another recalculation.';

function pendingRequest(value: string | null, projectId: string): BulkRequest | 'legacy' | null {
  if (!value || storedJobId(value)) return null;
  try {
    const request = bulkCalculationRequestSchema.parse(JSON.parse(value));
    return request.options.barrierRouting.scope.projectId === projectId ? request : 'legacy';
  } catch { return 'legacy'; }
}

function BackgroundPass({ projectId, accountId, token, preferences, disabled, blocker, endpointState, refreshState, onChanged, onReviewReady, children }: Props) {
  const storageKey = `wfc.recalculate-all:${projectId}:${accountId}`;
  const [stored] = useState(() => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  });
  const [jobId, setJobId] = useState(() => storedJobId(stored));
  const [job, setJob] = useState<PathFinderJob | null>(null);
  const [pending, setPending] = useState(() => pendingRequest(stored, projectId));
  const [displayFiltered, setDisplayFiltered] = useState(() => Boolean(stored?.startsWith(filteredJobPrefix)
    || (pending && pending !== 'legacy' && pending.cableIds)));
  const [submitting, setSubmitting] = useState(false);
  const [findingMatches, setFindingMatches] = useState(false);
  const [issueSelection, setIssueSelection] = useState<IssueSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const stopInFlight = useRef(false);
  const lifetime = useRef(new AbortController());
  const submittingRef = useRef(false), changed = useRef(onChanged), refresh = useRef(refreshState), lastSaved = useRef(0);
  const reviewReady = useRef(onReviewReady);
  const filteredJob = useRef(Boolean(stored?.startsWith(filteredJobPrefix)));
  reviewReady.current = onReviewReady;
  changed.current = onChanged; refresh.current = refreshState;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const counts = job ? backgroundCalculationCounts(job) : null;
  const items = job?.items;
  const saveReasons = useMemo(() => savingBreakdown(items), [items]);
  const blockedReasons = useMemo(() => blockedCalculationBreakdown(items, endpointState), [items, endpointState]);
  const selectedGroup = issueSelection && (issueSelection.kind === 'calculation' ? blockedReasons : saveReasons)
    .find(([reason]) => reason === issueSelection.reason)?.[1];
  const issue = issueSelection ? { selection: issueSelection, cableIds: selectedGroup?.cableIds ?? noIssueCables } : null;
  const closeIssue = () => {
    issueSelection?.trigger.focus();
    setIssueSelection(null);
  };
  const networkBlocked = job?.status === 'complete' && job.total > 0 && job.items?.length === job.total
    && job.items.every(item => item.state === 'blocked' && item.status === 'routing_preparation_required');
  const running = Boolean(jobId && (!job || ['queued', 'running'].includes(job.status) || (counts?.pendingUpdates ?? 0) > 0));
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let again = true;
      const deadline = pathFinderRequestDeadline(controller.signal, 30_000, () => new Error('Progress read timed out.'));
      try {
        const next = await deadline.wait(() => fetchPathFinderJob(projectId, token, jobId, deadline.signal));
        if (controller.signal.aborted) return;
        setJob(current => current?.id === next.id && current.cancelRequested
          ? { ...next, cancelRequested: true } : next);
        setError(null);
        if (next.cancelRequested) setStopError(null);
        const progress = backgroundCalculationCounts(next);
        if (progress.saved !== lastSaved.current) { lastSaved.current = progress.saved; changed.current(); }
        again = ['queued', 'running'].includes(next.status) || progress.pendingUpdates > 0;
        if (!again) {
          changed.current();
          if (next.status === 'complete' && !next.cancelRequested && !stopInFlight.current
            && progress.review > 0 && !filteredJob.current) reviewReady.current?.(next.id);
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof PathFinderApiError ? cause.message : 'Progress is temporarily unavailable. Checking again automatically; no new calculation was submitted.');
        if (cause instanceof PathFinderApiError && cause.code === 'JOB_NOT_FOUND' && cause.status === 404) {
          try {
            if (storedJobId(localStorage.getItem(storageKey)) === jobId) localStorage.removeItem(storageKey);
          } catch { /* The next submission checks browser storage again. */ }
          setJobId(null); setJob(null); again = false;
          setError('This recalculation job is no longer available. You can start a new recalculation.');
        } else if (cause instanceof PathFinderApiError && [401, 403].includes(cause.status)) again = false;
      } finally { deadline.dispose(); }
      if (again && !controller.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [projectId, token, jobId, storageKey]);
  const observeJob = (id: string | null, filtered = false) => {
    lastSaved.current = 0;
    filteredJob.current = filtered;
    setDisplayFiltered(filtered);
    setIssueSelection(null);
    setStopError(null);
    setJob(null); setJobId(id); setPending(null);
  };
  const readStoredSubmission = (value: string | null) => {
    const request = pendingRequest(value, projectId);
    observeJob(storedJobId(value), Boolean(value?.startsWith(filteredJobPrefix) || (request && request !== 'legacy' && request.cableIds)));
    setPending(request);
  };
  const submit = async (body: BulkRequest, marker: string, signal: AbortSignal) => {
    const deadline = pathFinderRequestDeadline(signal, BULK_CALCULATION_SUBMISSION_LIMITS.responseMilliseconds, () => new Error('Calculation admission timed out.'));
    let result: PathFinderCalculationSubmission;
    try { result = await deadline.wait(() => submitAllPathFinderCalculations(projectId, token, body, { signal: deadline.signal })); }
    catch { result = { kind: 'unknown', code: 'CALCULATION_SUBMISSION_UNKNOWN' }; }
    finally { deadline.dispose(); }
    if (signal.aborted) return;
    if (result.kind === 'acknowledged') {
      const filtered = body.cableIds !== undefined;
      try {
        if (localStorage.getItem(storageKey) === marker)
          localStorage.setItem(storageKey, filtered ? filteredJobPrefix + result.jobId : result.jobId);
      } catch { /* The persisted request still identifies the same job. */ }
      observeJob(result.jobId, filtered);
    } else if (result.kind === 'rejected' && result.code === 'ACCEPTED_BASELINES_TIMEOUT') {
      setJob(null); setJobId(null); setPending(body);
      setError(calculationSubmissionRefusalMessage(result.code));
    } else if (result.kind === 'unknown') {
      setJob(null); setJobId(null); setPending(body);
      setError(result.code === 'RECALCULATION_COLLECTION_DEADLINE'
        ? 'The server reached its time limit while preparing the cable list. Retry the same request to check or restart that preparation.'
        : unknownMessage);
    } else {
      if (localStorage.getItem(storageKey) === marker) localStorage.removeItem(storageKey);
      observeJob(null, body.cableIds !== undefined);
      setError(body.cableIds && ['CABLE_NOT_FOUND', 'NO_CABLES'].includes(result.code)
        ? 'The filtered cable list changed. Refresh cables before trying again.'
        : new PathFinderApiError(result.code, result.kind === 'rejected' ? result.status : 0).message);
    }
  };
  const recover = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setError(null);
    const signal = lifetime.current.signal;
    try {
      const marker = localStorage.getItem(storageKey);
      const request = pendingRequest(marker, projectId);
      if (!marker || !request) { readStoredSubmission(marker); return; }
      if (request !== 'legacy') { await submit(request, marker, signal); return; }
      const deadline = pathFinderRequestDeadline(signal, 30_000, () => new Error('Recovery timed out.'));
      let priorJob: string | null;
      try { priorJob = await deadline.wait(() => fetchLegacyBulkCalculationJob(projectId, token, deadline.signal)); }
      finally { deadline.dispose(); }
      if (signal.aborted) return;
      const latest = localStorage.getItem(storageKey);
      if (latest !== marker) { readStoredSubmission(latest); return; }
      if (priorJob) localStorage.setItem(storageKey, priorJob);
      else localStorage.removeItem(storageKey);
      observeJob(priorJob);
    } catch {
      if (!signal.aborted) setError('Could not check the previous recalculation. Try again when the connection is available.');
    } finally { submittingRef.current = false; if (!signal.aborted) setSubmitting(false); }
  };
  const canStop = job != null && running && !job.cancelRequested
    && (job.status === 'queued' || job.status === 'running' || job.status === 'complete');
  const stop = async () => {
    if (!canStop || !job || stopInFlight.current) return;
    const id = job.id;
    const signal = lifetime.current.signal;
    const deadline = pathFinderRequestDeadline(signal, 30_000, () => new Error('Stop request timed out.'));
    stopInFlight.current = true;
    setStopping(true);
    setStopError(null);
    try {
      await deadline.wait(() => cancelPathFinderJob(projectId, token, id, deadline.signal));
      if (!signal.aborted) setJob(current => current?.id === id ? { ...current, cancelRequested: true } : current);
    } catch {
      if (!signal.aborted) setStopError('The server did not confirm the stop request. Check the status or try again.');
    } finally {
      deadline.dispose();
      stopInFlight.current = false;
      if (!signal.aborted) setStopping(false);
    }
  };
  const startDisabled = disabled || !preferences || submitting || stopping || running || Boolean(pending);
  const start = async (selection?: FilteredSelection) => {
    if (submittingRef.current || stopInFlight.current || running || pending || disabled || !preferences?.barrierRouting) return;
    submittingRef.current = true; setSubmitting(true); setError(null);
    const signal = lifetime.current.signal;
    try {
      const existing = localStorage.getItem(storageKey);
      if (existing && (!jobId || storedJobId(existing) !== jobId)) { readStoredSubmission(existing); return; }
      setDisplayFiltered(Boolean(selection));
      const frozen = structuredClone(preferences);
      const current = await refresh.current();
      if (signal.aborted) return;
      if (!current) { setError('The current project could not be read. Try again when the connection is available.'); return; }
      const scope = frozen.barrierRouting!.scope;
      if (current.projectId !== projectId || current.activeModel.modelVersionId !== scope.modelVersionId
        || current.activeModel.selectionRevision !== scope.selectionRevision || current.activeModel.contentFingerprint !== scope.contentFingerprint) {
        setError('The active model changed. Refresh Path Finder and configure its obstacles before recalculating.'); return;
      }
      let cableIds: string[] | undefined;
      if (selection) {
        setFindingMatches(true);
        cableIds = await collectFilteredCableIds(projectId, token, selection.query, selection.contextSha256, signal);
        if (signal.aborted) return;
        setFindingMatches(false);
        if (!cableIds.length) { setError('No cables match the applied filters.'); return; }
      }
      const body = bulkCalculationRequestSchema.parse({
        submissionId: generateId(),
        expectedRegistryRevision: current.registryRevision, force: true, automaticPairPolicy: AUTOMATIC_PAIR_POLICY,
        ...(cableIds ? { cableIds } : {}),
        options: { connectionToleranceMeters: Number(current.settings.connectionGap), sampleSpacingMeters: 0.125,
          maxGraphNodes: 200_000, maxGraphConnections: 1_000_000, ...frozen },
      });
      const marker = JSON.stringify(body);
      try {
        const beforePost = localStorage.getItem(storageKey);
        if (beforePost !== existing) { readStoredSubmission(beforePost); return; }
        localStorage.setItem(storageKey, marker);
      } catch { setError('Browser storage is unavailable. Enable site storage before starting background recalculation. No calculation was submitted.'); return; }
      setPending(body);
      await submit(body, marker, signal);
    } catch (error) {
      if (!signal.aborted) setError(error instanceof PathFinderCableWorkflowApiError
        ? error.message : 'The current project could not be read. No new calculation was submitted. Try again.');
    } finally {
      submittingRef.current = false;
      if (!signal.aborted) { setSubmitting(false); setFindingMatches(false); }
    }
  };
  const showCables = (kind: IssueSelection['kind'], reason: string) => children == null ? null : <>{' '}
    <Button size="small" type="button" aria-label={`Show cables: ${reason}`}
      aria-expanded={issue?.selection.kind === kind && issue.selection.reason === reason}
      onClick={event => setIssueSelection({ kind, reason, trigger: event.currentTarget })}>Show cables</Button>
  </>;
  const progress = <>
    {pending ? <Button disabled={submitting} onClick={() => void recover()}>{pending === 'legacy' ? 'Find previous recalculation' : 'Retry same recalculation request'}</Button> : null}
    {canStop ? <Button type="button" disabled={stopping} onClick={() => void stop()}>Stop recalculation</Button> : null}
    {stopError && !job?.cancelRequested ? <Caption1 block role="alert">{stopError}</Caption1> : null}
    <div role="status" aria-live="polite">
      {submitting ? <Spinner size="tiny" label={findingMatches ? 'Finding all cables that match the filters…' : 'Starting background recalculation…'} />
        : stopping || running ? <Spinner size="tiny" label={stopping || job?.cancelRequested ? 'Stopping recalculation…'
          : job?.preparation?.phase === 'waiting' ? 'Recalculation request saved. Waiting to prepare cables.'
          : job?.preparation ? 'Preparing background recalculation.' : job?.status === 'complete' ? 'Saving calculated routes…' : 'Recalculating cables in the background…'} />
        : job ? <Caption1 block>{job.status === 'cancelled' || (job.status === 'complete' && job.cancelRequested) ? 'Background recalculation stopped.'
          : job.status === 'complete' ? 'Background recalculation finished.' : `Background recalculation ${job.status}.`}</Caption1> : null}
      {job?.preparation && running && <div>
        <ProgressBar value={job.preparation.total ? job.preparation.prepared / job.preparation.total : undefined} />
        {job.preparation.total > 0 && <Caption1 block>{job.preparation.stage === 'reading' ? 'Read accepted routes for' : 'Verified accepted routes for'} {job.preparation.prepared} of {job.preparation.total} cables.</Caption1>}
        {job.preparation.attempt > 1 && <Caption1 block>Preparation attempt {job.preparation.attempt}.</Caption1>}
      </div>}
      {job?.preparation && job.failure && <Caption1 block role="alert">{calculationSubmissionRefusalMessage(job.failure)} ({job.failure})</Caption1>}
      {!submitting && !pending && job && !job.preparation && counts ? <>
        <ProgressBar value={job.total ? job.completed / job.total : 1} />
        <Caption1 block>Processed: {job.completed} / {job.total}. Calculated: {counts.calculated}; saved: {counts.saved}; saving: {counts.saving}; need review: {counts.review}; skipped or failed: {counts.blocked}; not saved by this run: {counts.unsaved}{counts.unchanged > 0 ? `; unchanged: ${counts.unchanged}` : ''}.</Caption1>
        {blockedReasons.length > 0 ? <><Caption1 block>Current calculation issues</Caption1><ul aria-label="Skipped or failed calculations">
          {blockedReasons.map(([reason, { cableIds }]) => <li key={reason}>
            <span>{cableIds.length} {cableIds.length === 1 ? 'cable' : 'cables'} · {reason}</span>
            {showCables('calculation', reason)}
          </li>)}
        </ul></> : null}
        {saveReasons.length > 0 ? <ul aria-label="Calculated routes requiring attention">
          {saveReasons.map(([reason, { cableIds, routes }]) => <li key={reason}>
            <span>{reason} ({cableIds.length} {cableIds.length === 1 ? 'cable' : 'cables'}). {[...routes].map(([route, count]) => `${count} ${retainedRouteLabels[route]}`).join(', ')}.</span>
            {showCables('saving', reason)}
          </li>)}
        </ul> : null}
        {job.failure ? <Caption1 block>{job.failure}</Caption1> : null}
        {networkBlocked ? <Caption1 block>Open Routes and choose Regenerate network, then recalculate the cables again.</Caption1> : null}
      </> : null}
    </div>
    {error || pending && !submitting ? <Caption1 block role="alert">{error ?? (pending === 'legacy' ? legacyMessage : unknownMessage)}</Caption1> : null}
  </>;
  return <><section aria-label="Recalculate all cables">
    <Button appearance="primary" disabled={startDisabled} onClick={() => void start()}>Recalculate all the cables</Button>
    <Caption1 block>Recalculates the complete cable list in the background. You can continue working with the open cable.</Caption1>
    <Caption1 block>Each run recalculates every eligible cable, including previously saved routes. Routing and Design length update together automatically for unprotected cables. Protected routes remain unchanged; automatic results are retained separately. Cables with missing locations or unsupported purposes are skipped; MV is excluded.</Caption1>
    {blocker ? <Caption1 block>{blocker}</Caption1> : null}
    {!displayFiltered ? progress : null}
  </section><FilteredRecalculation.Provider value={{ disabled: startDisabled, start, progress: displayFiltered ? progress : null, issue, closeIssue }}>
    {children}
  </FilteredRecalculation.Provider></>;
}

const issuePageSize = 50;
const useIssueStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, minWidth: 0, overflowWrap: 'anywhere' },
  heading: { margin: 0 },
  controls: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  table: { tableLayout: 'fixed' },
  cableButton: { width: '100%', minWidth: 0, paddingInline: 0, justifyContent: 'flex-start',
    textAlign: 'start', whiteSpace: 'normal', overflowWrap: 'anywhere' },
});

type IssueListProps = {
  cables: readonly PathFinderCable[] | undefined;
  onOpenCable: (cable: PathFinderCable) => boolean;
};

export function PathFinderRecalculationIssueList(props: IssueListProps) {
  const recalculation = useFilteredCableRecalculation();
  const issue = recalculation?.issue;
  if (!issue || !recalculation) return null;
  return <IssueList key={JSON.stringify([issue.selection.kind, issue.selection.reason])}
    {...props} issue={issue} onClose={recalculation.closeIssue} />;
}

function IssueList({ cables, issue, onOpenCable, onClose }: IssueListProps & { issue: SelectedIssue; onClose: () => void }) {
  const styles = useIssueStyles();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [page, setPage] = useState(0);
  const [openFailed, setOpenFailed] = useState(false);
  const { selection, cableIds } = issue;
  useEffect(() => {
    heading.current?.scrollIntoView?.({ block: 'start' });
    heading.current?.focus({ preventScroll: true });
  }, [selection]);
  const cableIndex = useMemo(() => new Map(cables?.map(cable => [cable.id, cable])), [cables]);
  const orderedIds = useMemo(() => [...cableIds].sort((a, b) =>
    (cableIndex.get(a)?.cableId ?? Infinity) - (cableIndex.get(b)?.cableId ?? Infinity)), [cableIds, cableIndex]);
  const lastPage = Math.max(0, Math.ceil(orderedIds.length / issuePageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const first = currentPage * issuePageSize;
  const end = Math.min(first + issuePageSize, orderedIds.length);
  return <section className={styles.root} aria-labelledby={headingId}>
    <h3 className={styles.heading} id={headingId} ref={heading} tabIndex={-1}>Cables by recalculation result</h3>
    <div>{selection.reason}</div>
    <div className={styles.controls}>
      <Caption1 role="status">{orderedIds.length === 0 ? 'No cables remain in this group.'
        : `Showing ${first + 1}–${end} of ${orderedIds.length} ${orderedIds.length === 1 ? 'cable' : 'cables'}`}</Caption1>
      <Button size="small" type="button" onClick={onClose}>Close cable list</Button>
    </div>
    {openFailed && orderedIds.length > 0 ? <Caption1 role="alert">The cable routing window is currently unavailable for this cable.</Caption1> : null}
    {orderedIds.length > 0 ? <Table size="small" className={styles.table} aria-label="Cables in the selected result group">
      <TableHeader><TableRow><TableHeaderCell>Cable</TableHeaderCell><TableHeaderCell>From</TableHeaderCell><TableHeaderCell>To</TableHeaderCell></TableRow></TableHeader>
      <TableBody>{orderedIds.slice(first, end).map(id => {
        const cable = cableIndex.get(id);
        const label = cable?.tag || (cable?.cableId ?? id);
        return <TableRow key={id}>
          <TableCell>{cable ? <Button type="button" size="small" appearance="subtle" className={styles.cableButton}
            aria-haspopup="dialog" onClick={() => setOpenFailed(!onOpenCable(cable))}>{label}</Button> : label}</TableCell>
          <TableCell>{cable?.fromLocation || '—'}</TableCell>
          <TableCell>{cable?.toLocation || '—'}</TableCell>
        </TableRow>;
      })}</TableBody>
    </Table> : null}
    {lastPage > 0 ? <div className={styles.controls}>
      <Button size="small" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous cables</Button>
      <Button size="small" type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next cables</Button>
    </div> : null}
  </section>;
}
