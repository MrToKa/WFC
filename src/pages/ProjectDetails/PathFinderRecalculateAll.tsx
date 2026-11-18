import { useEffect, useRef, useState } from 'react';
import { Button, Caption1, ProgressBar, Spinner } from '@fluentui/react-components';
import { bulkCalculationRequestSchema, fetchLegacyBulkCalculationJob, fetchPathFinderJob, PathFinderApiError, submitAllPathFinderCalculations, type PathFinderCalculationSubmission, type PathFinderJob, type PathFinderPreferences, type PathFinderState } from '@/api/pathfinder';
import { AUTOMATIC_PAIR_POLICY } from '../../../shared/pathfinderAutomaticPair';
import { BULK_CALCULATION_SUBMISSION_LIMITS } from '../../../shared/pathfinderCalculationSubmission';
import { pathFinderRequestDeadline } from '@/api/pathfinderRequestDeadline';
import { generateId } from '@/utils/generateId';

type Props = {
  projectId: string; accountId: string; token: string; modelKey: string;
  preferences: PathFinderPreferences | null; disabled: boolean; blocker: string | null;
  refreshState: () => Promise<PathFinderState | null>; onChanged: () => void;
  onReviewReady?: (jobId: string) => void;
};
export function backgroundCalculationCounts(job: PathFinderJob) {
  const items = job.items ?? [];
  const saved = items.filter(item => ['written', 'already-written'].includes(item.automaticUpdate?.status ?? '')).length;
  const pendingUpdates = items.filter(item => ['pending', 'running', 'unknown'].includes(item.automaticUpdate?.status ?? '')).length;
  const saving = items.filter(item => item.status === 'calculated' && ['pending', 'running'].includes(item.automaticUpdate?.status ?? '')).length;
  const calculated = items.filter(item => item.status === 'calculated').length;
  const review = items.filter(item => item.automaticUpdate?.status === 'review-required').length;
  const blocked = items.filter(item => ['complete', 'blocked', 'cancelled', 'failed'].includes(item.state) && item.status !== 'calculated').length;
  const unsaved = items.filter(item => item.status === 'calculated' && (!item.automaticUpdate
    || ['refused', 'stale', 'authority-expired', 'unknown'].includes(item.automaticUpdate.status))).length;
  return { saved, saving, pendingUpdates, calculated, review, blocked, unsaved };
}

/** Owns only its submission and lightweight progress reads. Never owns the
 * viewer, popup selection, global busy flag or the continuous automatic mode. */
export function PathFinderRecalculateAll(props: Props) {
  const identity = JSON.stringify([props.projectId, props.accountId, props.token, props.modelKey]);
  return <BackgroundPass key={identity} {...props} />;
}
type BulkRequest = ReturnType<typeof bulkCalculationRequestSchema.parse>;
const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unknownMessage = 'The server has not confirmed this request. Retry the same request to recover its status. You can continue working with individual cables.';
const legacyMessage = 'The previous request was not confirmed. Check the server for its job before starting another recalculation.';

function pendingRequest(value: string | null, projectId: string): BulkRequest | 'legacy' | null {
  if (!value || jobIdPattern.test(value)) return null;
  try {
    const request = bulkCalculationRequestSchema.parse(JSON.parse(value));
    return request.options.barrierRouting.scope.projectId === projectId ? request : 'legacy';
  } catch { return 'legacy'; }
}

function BackgroundPass({ projectId, accountId, token, preferences, disabled, blocker, refreshState, onChanged, onReviewReady }: Props) {
  const storageKey = `wfc.recalculate-all:${projectId}:${accountId}`;
  const [stored] = useState(() => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  });
  const [jobId, setJobId] = useState<string | null>(() => stored && jobIdPattern.test(stored) ? stored : null);
  const [job, setJob] = useState<PathFinderJob | null>(null);
  const [pending, setPending] = useState(() => pendingRequest(stored, projectId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef(new AbortController());
  const submittingRef = useRef(false), changed = useRef(onChanged), refresh = useRef(refreshState), lastSaved = useRef(0);
  const reviewReady = useRef(onReviewReady);
  reviewReady.current = onReviewReady;
  changed.current = onChanged; refresh.current = refreshState;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const counts = job ? backgroundCalculationCounts(job) : null;
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
        setJob(next); setError(null);
        const progress = backgroundCalculationCounts(next);
        if (progress.saved !== lastSaved.current) { lastSaved.current = progress.saved; changed.current(); }
        again = ['queued', 'running'].includes(next.status) || progress.pendingUpdates > 0;
        if (!again) {
          changed.current();
          if (next.status === 'complete' && progress.review > 0) reviewReady.current?.(next.id);
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof PathFinderApiError ? cause.message : 'Progress is temporarily unavailable. Checking again automatically; no new calculation was submitted.');
        if (cause instanceof PathFinderApiError && cause.code === 'JOB_NOT_FOUND' && cause.status === 404) {
          try {
            if (localStorage.getItem(storageKey) === jobId) localStorage.removeItem(storageKey);
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
  const observeJob = (id: string | null) => {
    lastSaved.current = 0;
    setJob(null); setJobId(id); setPending(null);
  };
  const readStoredSubmission = (value: string | null) => {
    observeJob(value && jobIdPattern.test(value) ? value : null);
    setPending(pendingRequest(value, projectId));
  };
  const submit = async (body: BulkRequest, marker: string, signal: AbortSignal) => {
    const deadline = pathFinderRequestDeadline(signal, BULK_CALCULATION_SUBMISSION_LIMITS.responseMilliseconds, () => new Error('Calculation admission timed out.'));
    let result: PathFinderCalculationSubmission;
    try { result = await deadline.wait(() => submitAllPathFinderCalculations(projectId, token, body, { signal: deadline.signal })); }
    catch { result = { kind: 'unknown', code: 'CALCULATION_SUBMISSION_UNKNOWN' }; }
    finally { deadline.dispose(); }
    if (signal.aborted) return;
    if (result.kind === 'acknowledged') {
      try {
        if (localStorage.getItem(storageKey) === marker) localStorage.setItem(storageKey, result.jobId);
      } catch { /* The persisted request still identifies the same job. */ }
      observeJob(result.jobId);
    } else if (result.kind === 'unknown') {
      setJob(null); setJobId(null); setPending(body);
      setError(result.code === 'RECALCULATION_COLLECTION_DEADLINE'
        ? 'The server reached its time limit while preparing the cable list. Retry the same request to check or restart that preparation.'
        : unknownMessage);
    } else {
      if (localStorage.getItem(storageKey) === marker) localStorage.removeItem(storageKey);
      observeJob(null);
      setError(new PathFinderApiError(result.code, result.kind === 'rejected' ? result.status : 0).message);
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
  const start = async () => {
    if (submittingRef.current || running || pending || disabled || !preferences?.barrierRouting) return;
    submittingRef.current = true; setSubmitting(true); setError(null);
    const signal = lifetime.current.signal;
    try {
      const existing = localStorage.getItem(storageKey);
      if (existing && existing !== jobId) { readStoredSubmission(existing); return; }
      const frozen = structuredClone(preferences);
      const current = await refresh.current();
      if (signal.aborted) return;
      if (!current) { setError('The current project could not be read. Try again when the connection is available.'); return; }
      const scope = frozen.barrierRouting!.scope;
      if (current.projectId !== projectId || current.activeModel.modelVersionId !== scope.modelVersionId
        || current.activeModel.selectionRevision !== scope.selectionRevision || current.activeModel.contentFingerprint !== scope.contentFingerprint) {
        setError('The active model changed. Refresh Path Finder and configure its obstacles before recalculating.'); return;
      }
      const body = bulkCalculationRequestSchema.parse({
        submissionId: generateId(),
        expectedRegistryRevision: current.registryRevision, force: true, automaticPairPolicy: AUTOMATIC_PAIR_POLICY,
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
    } catch {
      if (!signal.aborted) setError('The current project could not be read. No new calculation was submitted. Try again.');
    } finally { submittingRef.current = false; if (!signal.aborted) setSubmitting(false); }
  };
  return <section aria-label="Recalculate all cables">
    <Button appearance="primary" disabled={disabled || !preferences || submitting || running || Boolean(pending)} onClick={() => void start()}>Recalculate all the cables</Button>
    {pending ? <Button disabled={submitting} onClick={() => void recover()}>{pending === 'legacy' ? 'Find previous recalculation' : 'Retry same recalculation request'}</Button> : null}
    <Caption1 block>Recalculates the complete cable list in the background. You can continue working with the open cable.</Caption1>
    <Caption1 block>Current Routing and Design length update automatically for unprotected cables. Protected routes remain unchanged; automatic results are retained separately. Cables with missing locations or unsupported purposes are skipped; MV is excluded.</Caption1>
    {blocker ? <Caption1 block>{blocker}</Caption1> : null}
    <div role="status" aria-live="polite">
      {submitting ? <Spinner size="tiny" label="Starting background recalculation…" /> : running ? <Spinner size="tiny" label={job?.status === 'complete' ? 'Saving calculated routes…' : 'Recalculating cables in the background…'} /> : job ? <Caption1 block>{job.status === 'complete' ? 'Background recalculation finished.' : `Background recalculation ${job.status}.`}</Caption1> : null}
      {!submitting && !pending && job && counts ? <>
        <ProgressBar value={job.total ? job.completed / job.total : 1} />
        <Caption1 block>Processed: {job.completed} / {job.total}. Calculated: {counts.calculated}; saved: {counts.saved}; saving: {counts.saving}; need review: {counts.review}; skipped or failed: {counts.blocked}; not saved by this run: {counts.unsaved}.</Caption1>
        {counts.unsaved > 0 ? <Caption1 block>Not saved by this run does not mean the cable has no saved route. Existing routes remain in Cable list; inspect the update reason and protection for each cable before retrying.</Caption1> : null}
        {job.failure ? <Caption1 block>{job.failure}</Caption1> : null}
        {networkBlocked ? <Caption1 block>Open Routes and choose Regenerate network, then recalculate the cables again.</Caption1> : null}
      </> : null}
    </div>
    {error || pending && !submitting ? <Caption1 block role="alert">{error ?? (pending === 'legacy' ? legacyMessage : unknownMessage)}</Caption1> : null}
  </section>;
}
