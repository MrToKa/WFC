import { useEffect, useRef, useState } from 'react';
import { Button, Caption1, ProgressBar, Spinner } from '@fluentui/react-components';
import { fetchPathFinderJob, PathFinderApiError, submitAllPathFinderCalculations, type PathFinderCalculationSubmission, type PathFinderJob, type PathFinderPreferences, type PathFinderState } from '@/api/pathfinder';
import { AUTOMATIC_PAIR_POLICY } from '../../../shared/pathfinderAutomaticPair';
import { pathFinderRequestDeadline } from '@/api/pathfinderRequestDeadline';

type Props = {
  projectId: string; accountId: string; token: string; modelKey: string;
  preferences: PathFinderPreferences | null; disabled: boolean; blocker: string | null;
  refreshState: () => Promise<PathFinderState | null>; onChanged: () => void;
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
function BackgroundPass({ projectId, accountId, token, preferences, disabled, blocker, refreshState, onChanged }: Props) {
  // Persist before POST, across reloads/model revisions. An uncertain forced
  // submission must never silently become a second whole-project calculation.
  const storageKey = `wfc.recalculate-all:${projectId}:${accountId}`;
  const [stored] = useState(() => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  });
  const validJobId = (value: string | null) => Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
  const [jobId, setJobId] = useState<string | null>(() => validJobId(stored) ? stored : null);
  const [job, setJob] = useState<PathFinderJob | null>(null);
  const [submitting, setSubmitting] = useState(false), [unknown, setUnknown] = useState(Boolean(stored && !validJobId(stored)));
  const unknownMessage = 'The server has not confirmed this request. Do not start another pass until its outcome is known. You can continue working with individual cables.';
  const [error, setError] = useState<string | null>(stored && !validJobId(stored) ? unknownMessage : null);
  const lifetime = useRef(new AbortController());
  const submittingRef = useRef(false), changed = useRef(onChanged), refresh = useRef(refreshState), lastSaved = useRef(0);
  changed.current = onChanged; refresh.current = refreshState;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const counts = job ? backgroundCalculationCounts(job) : null;
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
        if (!again) changed.current();
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof PathFinderApiError ? cause.message : 'Progress is temporarily unavailable. Checking again automatically; no new calculation was submitted.');
        if (cause instanceof PathFinderApiError && [401, 403, 404].includes(cause.status)) again = false;
      } finally { deadline.dispose(); }
      if (again && !controller.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [projectId, token, jobId]);
  const start = async () => {
    if (submittingRef.current || running || unknown || disabled || !preferences?.barrierRouting) return;
    submittingRef.current = true; setSubmitting(true); setError(null);
    const signal = lifetime.current.signal;
    try {
      const existing = localStorage.getItem(storageKey);
      if (existing && !validJobId(existing)) { setUnknown(true); setError(unknownMessage); return; }
      if (existing && existing !== jobId) { setJob(null); setJobId(existing); return; }
      const frozen = structuredClone(preferences);
      const current = await refresh.current();
      if (signal.aborted) return;
      if (!current) { setError('The current project could not be read. Try again when the connection is available.'); return; }
      const scope = frozen.barrierRouting!.scope;
      if (current.projectId !== projectId || current.activeModel.modelVersionId !== scope.modelVersionId
        || current.activeModel.selectionRevision !== scope.selectionRevision || current.activeModel.contentFingerprint !== scope.contentFingerprint) {
        setError('The active model changed. Refresh Path Finder and configure its obstacles before recalculating.'); return;
      }
      const body = {
        expectedRegistryRevision: current.registryRevision, force: true, automaticPairPolicy: AUTOMATIC_PAIR_POLICY,
        options: { connectionToleranceMeters: Number(current.settings.connectionGap), sampleSpacingMeters: 0.125,
          maxGraphNodes: 200_000, maxGraphConnections: 1_000_000, ...frozen },
      };
      // If storage is unavailable, stop before submitting rather than losing
      // ownership of an uncertain write when the page is reloaded.
      try {
        const beforePost = localStorage.getItem(storageKey);
        if (beforePost !== existing) { setUnknown(true); setError('Another background request was started. Reload to check its progress; no second calculation was submitted.'); return; }
        localStorage.setItem(storageKey, 'pending');
      } catch { setError('Browser storage is unavailable. Enable site storage before starting background recalculation. No calculation was submitted.'); return; }
      const deadline = pathFinderRequestDeadline(signal, 30_000, () => new Error('Calculation admission timed out.'));
      let result: PathFinderCalculationSubmission;
      try { result = await deadline.wait(() => submitAllPathFinderCalculations(projectId, token, body, { signal: deadline.signal })); }
      catch { result = { kind: 'unknown', code: 'CALCULATION_SUBMISSION_UNKNOWN' }; }
      finally { deadline.dispose(); }
      if (signal.aborted) return;
      if (result.kind === 'acknowledged') {
        lastSaved.current = 0; setJob(null); setJobId(result.jobId);
        try { localStorage.setItem(storageKey, result.jobId); } catch { /* The durable pending marker still prevents replay. */ }
      } else {
        setUnknown(result.kind === 'unknown');
        if (result.kind !== 'unknown') localStorage.removeItem(storageKey);
        setError(result.kind === 'unknown' ? unknownMessage
          : new PathFinderApiError(result.code, result.kind === 'rejected' ? result.status : 0).message);
      }
    } catch {
      if (!signal.aborted) setError('The current project could not be read. No new calculation was submitted. Try again.');
    } finally { submittingRef.current = false; if (!signal.aborted) setSubmitting(false); }
  };
  return <section aria-label="Recalculate all cables">
    <Button appearance="primary" disabled={disabled || !preferences || submitting || running || unknown} onClick={() => void start()}>Recalculate all the cables</Button>
    <Caption1 block>Recalculates the complete cable list in the background. You can continue working with the open cable.</Caption1>
    <Caption1 block>Empty or previously automatic Routing and Design length update automatically. Manual changes require Review and Apply. Cables with missing locations or unsupported purposes are skipped; MV is excluded.</Caption1>
    {blocker ? <Caption1 block>{blocker}</Caption1> : null}
    <div role="status" aria-live="polite">
      {submitting ? <Spinner size="tiny" label="Starting background recalculation…" /> : running ? <Spinner size="tiny" label={job?.status === 'complete' ? 'Saving calculated routes…' : 'Recalculating cables in the background…'} /> : job ? <Caption1 block>{job.status === 'complete' ? 'Background recalculation finished.' : `Background recalculation ${job.status}.`}</Caption1> : null}
      {job && counts ? <>
        <ProgressBar value={job.total ? job.completed / job.total : 1} />
        <Caption1 block>Processed: {job.completed} / {job.total}. Calculated: {counts.calculated}; saved: {counts.saved}; saving: {counts.saving}; need review: {counts.review}; skipped or failed: {counts.blocked}; not saved: {counts.unsaved}.</Caption1>
        {job.failure ? <Caption1 block>{job.failure}</Caption1> : null}
      </> : null}
    </div>
    {error ? <Caption1 block role="alert">{error}</Caption1> : null}
  </section>;
}
