import { useEffect, useId, useRef, useState } from 'react';
import { Button, Caption1, Spinner } from '@fluentui/react-components';
import { usePathfinderRevisionResults, type RevisionResultsAccess } from './hooks/usePathfinderRevisionResults';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';
import type { RevisionResultDetail } from '@/api/pathfinderRevisionResults';
import type { PathFinderCable, PathFinderJob } from '@/api/pathfinder';
import type { BatchReviewCandidate } from './hooks/usePathfinderBatchReview';
import type { BatchReviewController } from './PathFinderBatchReview';
import { sealedCableItemApplicabilitySchema } from '../../../shared/pathfinderItemApplicability';
import { PathFinderDirectSecondary } from './PathFinderDirectSecondary';

export type PathFinderCalculationScope = { admissionId: string | null; jobId: string | null; ready: boolean; message: string | null;
  wholeJobReady?: boolean; jobStatus?: PathFinderJob['status'] | null; cancelRequested?: boolean };
export type PathFinderRevisionResultsProps = RevisionResultsAccess & {
  onOpenProposal: (proposalId: string, expectedJobId: string) => void | Promise<void>; busy?: boolean;
  batch?: BatchReviewController; cables?: PathFinderCable[]; jobs?: PathFinderJob[];
  readJob?: (jobId: string) => Promise<PathFinderJob | null>;
  onScopeReadinessChange?: (value: PathFinderCalculationScope) => void;
  onHistorySelection?: () => void;
};
type Model = NonNullable<RevisionResultDetail['row']['result']>['newModel'];
const unavailable = 'Unavailable';
const text = (value: string | null | undefined) => value ?? unavailable;
const metres = (value: string | number | null | undefined) => value === null || value === undefined ? unavailable : `${value} m`;
const signedMetres = (value: string | number | null | undefined) => value === null || value === undefined ? unavailable
  : `${typeof value === 'number' ? value > 0 ? '+' : '' : !value.startsWith('-') && !/^0(?:\.0+)?$/.test(value) ? '+' : ''}${value} m`;
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const model = (value: Model) => value ? `${value.id} · selection ${value.selectionRevision}` : unavailable;
const status = (value: string) => ({ calculated: 'Ready for review', locations_required: 'Resolve locations', no_path: 'No connected path',
  settings_required: 'Project values required', category_required: 'Cable category required', stale: 'Outdated', invalid_request: 'Review the input',
  deadline_exceeded: 'Calculation timed out', resource_limit: 'Calculation limit reached' }[value] ?? label(value));
const calculationLabel = (value: { kind: string; generation: string | null }) => value.kind === 'automatic' ? `Generation ${value.generation}`
  : value.kind === 'location-impact' ? 'Shared location calculation' : 'Manual calculation';
function hasExactItemApplicability(row: RevisionResultDetail['row'], projectId: string | null, jobId: string | null | undefined) {
  const proof = sealedCableItemApplicabilitySchema.safeParse(row.itemApplicability);
  return Boolean(proof.success && proof.data.schemaVersion === 'wfc.pf.sealed-cable-applicability.v2'
    && proof.data.dependencyVersion === 'pathfinder.dependencies.v8' && projectId && jobId && row.result && proof.data.projectId === projectId && proof.data.jobId === jobId
    && proof.data.cableId === row.cableId && proof.data.proposalId === row.result.proposalId && proof.data.dependencyHash === row.result.dependencyHash);
}
function gaps(result: unknown): { count: number; metres: number } | null {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !('route' in result)) return null;
  const route = result.route;
  if (!route || typeof route !== 'object' || Array.isArray(route) || !('connectionGapCount' in route) || !('connectionGapLengthMeters' in route)) return null;
  return typeof route.connectionGapCount === 'number' && Number.isSafeInteger(route.connectionGapCount) && route.connectionGapCount >= 0
    && typeof route.connectionGapLengthMeters === 'number' && Number.isFinite(route.connectionGapLengthMeters) && route.connectionGapLengthMeters >= 0
    ? { count: route.connectionGapCount, metres: route.connectionGapLengthMeters } : null;
}
function RouteText({ value }: { value: string | null | undefined }) {
  return <details><summary>Exact route</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text(value)}</p></details>;
}
function LengthComponents({ detail }: { detail: RevisionResultDetail }) {
  const ledger = detail.envelope?.lengthLedger, gap = gaps(detail.engineResult);
  if (!ledger) return <p>Exact length components are unavailable for this historical or unsuccessful result.</p>;
  const values: Array<[string, string]> = [
    ['Formula', ledger.formulaVersion], ['Project Details revision', ledger.settingsRevision],
    ['Raw geometric length', metres(ledger.raw.lengthMeters)], ['Raw From approach', metres(ledger.raw.fromDistanceMeters)], ['Raw To approach', metres(ledger.raw.toDistanceMeters)],
    ['C# decimal geometric length', metres(ledger.rawLengthDecimalMeters)],
    ['From uses SECONDARY', ledger.from.requiresSecondary ? 'Yes' : 'No'], ['Removed From approach', metres(ledger.from.removedApproachMeters)],
    ['To uses SECONDARY', ledger.to.requiresSecondary ? 'Yes' : 'No'], ['Removed To approach', metres(ledger.to.removedApproachMeters)],
    ['Secondary tray length', metres(ledger.settings.secondaryTrayLengthMeters)], ['SECONDARY ends', String(ledger.secondaryEnds)],
    ['SECONDARY replacement', metres(ledger.replacementMeters)], ['Before clamp', metres(ledger.beforeClampMeters)],
    ['Clamp adjustment', metres(ledger.clampAdjustmentMeters)], ['After clamp', metres(ledger.afterClampMeters)],
    ['For end connection', metres(ledger.settings.endConnectionLengthMeters)], ['Before percentage', metres(ledger.beforePercentageMeters)],
    ['Additional % for bending', `${ledger.settings.additionalBendingPercent}%`], ['Bending increment', metres(ledger.bendingIncrementMeters)],
    ['Unrounded length', metres(ledger.unroundedMeters)], ['Ceiling increment', metres(ledger.ceilingIncrementMeters)], ['Final design length', metres(ledger.designLengthMeters)],
  ];
  return <section aria-label="Exact length components">
    <h5>Exact length components</h5>
    {ledger.schemaVersion === 'wfc.pf.length-components.v2' ? <>
      <PathFinderDirectSecondary decision={ledger.directSecondary} />
      <Caption1>Recorded calculation values are shown exactly. Secondary tray length is recorded for audit only and is unused for this direct connection. End connection is added once before bending and final rounding.</Caption1>
    </> : <Caption1>Recorded calculation values are shown exactly. SECONDARY replaces the flagged approach; end connection is added once before bending and final rounding.</Caption1>}
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '4px 12px', overflowWrap: 'anywhere' }}>
      {values.map(([name, value]) => <div key={name} style={{ display: 'contents' }}><dt>{name}</dt><dd style={{ margin: 0 }}>{value}</dd></div>)}
    </dl>
    <p>Connection gaps are already included in raw geometry and are not added again.</p>
    <Caption1>Recorded gaps: {gap ? `${gap.count}; total ${gap.metres} m` : unavailable}.</Caption1>
  </section>;
}

/** Paged inspection only; opening a proposal delegates the existing protected review flow. */
export function PathFinderRevisionResults(props: PathFinderRevisionResultsProps) {
  const state = usePathfinderRevisionResults(props), styles = useRoutingsViewerStyles(), selectId = useId();
  const admission = useRef<string | null>(null);
  useEffect(() => {
    if (state.admission?.id && admission.current !== state.admission.id) {
      if (admission.current !== null) props.batch?.clearSelection();
      admission.current = state.admission.id;
    }
  }, [state.admission?.id, props.batch]);
  const [opening, setOpening] = useState(false), [openError, setOpenError] = useState<string | null>(null);
  const owner = JSON.stringify([props.projectId, props.loadedProjectId, props.accountId, props.token, props.isAdmin, props.active, props.contextKey,
    state.admission?.id, state.detail?.row.cableId, state.detail?.row.baselineHash, state.detail?.row.result?.revisionResultSha256]);
  const latestOwner = useRef(owner); latestOwner.current = owner;
  const generation = useRef(0);
  useEffect(() => { generation.current++; setOpening(false); setOpenError(null); return () => { generation.current++; }; }, [owner]);
  const knownJob = props.jobs?.find(item => item.id === state.admission?.jobId);
  const knownJobKey = JSON.stringify(knownJob && [knownJob.id, knownJob.status, knownJob.cancelRequested]);
  const jobOwner = JSON.stringify([props.projectId, props.loadedProjectId, props.accountId, props.token, props.isAdmin,
    props.active, props.contextKey, state.admission?.id, state.admission?.jobId]);
  const [jobAttempt, setJobAttempt] = useState(0);
  const [jobRead, setJobRead] = useState<{ owner: string; value: PathFinderJob | null; loading: boolean; error: boolean }>({ owner: '', value: null, loading: false, error: false });
  useEffect(() => {
    let closed = false;
    const jobId = state.admission?.jobId;
    if (!state.enabled || !props.active || !jobId || knownJob) {
      setJobRead({ owner: jobOwner, value: null, loading: false, error: false }); return;
    }
    if (!props.readJob) { setJobRead({ owner: jobOwner, value: null, loading: false, error: true }); return; }
    setJobRead({ owner: jobOwner, value: null, loading: true, error: false });
    void props.readJob(jobId).then(value => {
      if (!closed) setJobRead({ owner: jobOwner, value: value?.id === jobId && value.projectId === props.projectId ? value : null,
        loading: false, error: !value || value.id !== jobId || value.projectId !== props.projectId });
    }).catch(() => { if (!closed) setJobRead({ owner: jobOwner, value: null, loading: false, error: true }); });
    return () => { closed = true; };
    // Polling may replace the jobs array without changing the selected job state.
    // A missing historical job is read once per owned scope or explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobOwner, knownJobKey, props.readJob, props.active, state.enabled, jobAttempt]);
  const ownedJobRead = jobRead.owner === jobOwner ? jobRead : null;
  const scopeJob = knownJob ?? ownedJobRead?.value;
  const ownsScope = Boolean(state.enabled && props.isAdmin && props.accountId && props.token && props.projectId === props.loadedProjectId);
  const wholeJobReady = Boolean(props.active && ownsScope && scopeJob?.status === 'complete' && !scopeJob.cancelRequested);
  const activeParent = Boolean(props.active && ownsScope && scopeJob && ['queued', 'running'].includes(scopeJob.status) && !scopeJob.cancelRequested);
  const itemReady = (value: RevisionResultDetail['row']) => value.itemApplicability?.schemaVersion !== 'wfc.pf.sealed-cable-applicability.v1' && (wholeJobReady || activeParent
    && hasExactItemApplicability(value, props.projectId, state.admission?.jobId));
  const scopeReady = wholeJobReady || Boolean(activeParent && [...(state.page?.rows ?? []), ...(state.detail ? [state.detail.row] : [])]
    .some(value => value.status === 'calculated' && value.currentness.state === 'current' && itemReady(value)));
  const scopeIssue = !ownsScope ? 'Administrator access is required. Refresh your account before continuing.'
    : !state.admission ? state.admissionsLoading ? 'Loading calculation scopes…' : 'Choose a completed calculation below. No saved calculation is currently selected.'
      : !state.admission.jobId ? 'This calculation has no job or applicable output. Choose a completed calculation, or calculate non-MV cables again if needed.'
        : scopeJob?.cancelRequested || scopeJob?.status === 'cancelled'
          ? 'This calculation was cancelled. Its saved results can be inspected, but cannot be reviewed or applied. Choose a completed calculation, or calculate non-MV cables again if needed.'
          : scopeReady && !wholeJobReady ? `This calculation is ${scopeJob!.status}. Only individually sealed, current cable results can be reviewed while other cables are calculating.`
          : activeParent ? `This calculation is ${scopeJob!.status}. Review and Apply require a completed calculation or an individually sealed, current cable result.`
          : scopeJob && scopeJob.status !== 'complete'
            ? `This calculation is ${scopeJob.status}. Review and Apply require a completed calculation. Wait for it to finish, or calculate again after a failed job.`
            : !scopeJob ? ownedJobRead?.loading ? 'Checking the selected calculation state…'
              : 'The selected calculation state is unavailable. Check it again before selecting results for review.' : null;
  const scopeAdmissionId = ownsScope ? state.admission?.id ?? null : null, scopeJobId = ownsScope ? state.admission?.jobId ?? null : null;
  const scopeJobStatus = ownsScope ? scopeJob?.status ?? null : null, scopeCancelRequested = Boolean(ownsScope && scopeJob?.cancelRequested);
  useEffect(() => { props.onScopeReadinessChange?.({ admissionId: scopeAdmissionId, jobId: scopeJobId, ready: scopeReady, message: scopeIssue,
    wholeJobReady, jobStatus: scopeJobStatus, cancelRequested: scopeCancelRequested }); },
    [props.onScopeReadinessChange, scopeAdmissionId, scopeJobId, scopeReady, scopeIssue, wholeJobReady, scopeJobStatus, scopeCancelRequested]);
  if (!props.isAdmin || !props.accountId || !props.token || props.projectId !== props.loadedProjectId) return null;
  if (!state.enabled) return <section aria-label="Cable revision results" className={styles.result}><h3>Cable revision results</h3>
    <p role="alert">Administrator access is required. Refresh your account before continuing.</p></section>;
  const loading = state.admissionsLoading || state.pageLoading || state.detailLoading || Boolean(ownedJobRead?.loading);
  const frozen = !props.active || props.busy || loading || opening;
  const choices = state.admission && !state.admissions.some(value => value.id === state.admission?.id) ? [state.admission, ...state.admissions] : state.admissions;
  const detail = state.detail, row = detail?.row, baseline = row?.baseline, accepted = baseline?.lastAcceptedApply, result = row?.result;
  const resultBelongsToScope = Boolean(state.admission?.jobId && detail?.admissionId === state.admission.id
    && detail.envelope?.jobId === state.admission.jobId);
  const candidate = (value: RevisionResultDetail['row']): BatchReviewCandidate | null => {
    const cable = props.cables?.find(item => item.id === value.cableId), output = value.result;
    if (!itemReady(value)) return null;
    if (!cable || !['LV', 'Control', 'Instrumentation'].includes(cable.mto ?? '') || value.status !== 'calculated'
      || value.currentness.state !== 'current' || !output?.ledgerHash || !output.routeText || output.designLengthMeters === null) return null;
    return { cableId: value.cableId, cableWriteRevision: value.baseline.currentCable.cableWriteRevision,
      proposalId: output.proposalId, proposalHash: output.proposalHash, revisionResultHash: output.revisionResultSha256,
      tag: value.baseline.currentCable.tag ?? value.cableId, routeText: output.routeText, designLength: output.designLengthMeters };
  };
  const rowStatus = (value: RevisionResultDetail['row']) => value.status !== 'calculated' ? status(value.status)
    : value.itemApplicability?.schemaVersion === 'wfc.pf.sealed-cable-applicability.v1' ? 'Historical — fresh barrier calculation required'
    : !itemReady(value) ? scopeJob?.cancelRequested || scopeJob?.status === 'cancelled' ? 'Review blocked — cancelled calculation'
      : scopeJob ? 'Review blocked — incomplete calculation' : 'Review blocked — calculation state unknown'
      : value.currentness.state !== 'current' ? 'Outdated — review blocked' : status(value.status);
  const selectable = (state.page?.rows ?? []).map(candidate).filter((value): value is BatchReviewCandidate => value !== null);
  const open = async () => {
    const expectedJobId = state.admission?.jobId;
    if (frozen || !result || !detail?.envelope || !expectedJobId || !resultBelongsToScope || !props.isAdmin || !props.accountId || props.projectId !== props.loadedProjectId) return;
    props.onHistorySelection?.();
    const started = owner, atGeneration = generation.current; setOpening(true); setOpenError(null);
    try { await props.onOpenProposal(result.proposalId, expectedJobId); }
    catch { if (latestOwner.current === started && generation.current === atGeneration) setOpenError('The exact proposal could not be opened. Refresh this calculation scope and try again.'); }
    finally { if (latestOwner.current === started && generation.current === atGeneration) setOpening(false); }
  };
  return <section className={styles.result} aria-label="Cable revision results">
    <h3>Cable revision results</h3>
    <Caption1>Inspect a saved calculation scope, including blocked cables. New calculations do not replace the selected page. Review and Apply remain explicit, individually or for a selected batch.</Caption1>
    <label htmlFor={selectId}>Calculation scope</label>
    <select id={selectId} value={state.admission?.id ?? ''} disabled={frozen || choices.length === 0} onChange={event => { props.onHistorySelection?.(); state.selectAdmission(event.target.value); }} style={{ width: '100%', minWidth: 0 }}>
      {!state.admission ? <option value="">Choose a calculation</option> : null}
      {choices.map(value => <option key={value.id} value={value.id}>{calculationLabel(value)} · {value.createdAt} · {value.total} cables{props.jobs?.find(item => item.id === value.jobId)?.status ? ` · ${label(props.jobs.find(item => item.id === value.jobId)!.status)}` : ''}</option>)}
    </select>
    {state.admission ? <p role="status" aria-label="Selected calculation scope">Selected calculation: {calculationLabel(state.admission)} · {state.admission.createdAt} · {state.admission.total} cables. Status: {scopeJob?.cancelRequested ? 'cancellation requested' : scopeJob ? label(scopeJob.status) : state.admission.jobId ? 'checking calculation state' : 'no calculation job'}.</p> : null}
    <div className={styles.actions}>
      <Button disabled={frozen || !state.previousAdmissions} onClick={state.previousAdmissionsPage}>Previous calculations</Button>
      <Button disabled={frozen || !state.nextAdmissionsCursor} onClick={state.nextAdmissions}>More calculations</Button>
      <Button disabled={frozen} onClick={state.refresh}>Refresh revision results</Button>
    </div>
    {loading || opening ? <Spinner size="tiny" label={opening ? 'Opening the exact proposal…' : 'Reading cable revision results…'} /> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {openError ? <p role="alert">{openError}</p> : null}
    {scopeIssue ? <p role="status">{scopeIssue}</p> : null}
    {state.admission?.jobId && !knownJob && !scopeJob ? <Button disabled={frozen || !props.readJob} onClick={() => setJobAttempt(value => value + 1)}>Check calculation state</Button> : null}
    {!loading && choices.length === 0 ? <p>No saved calculation scopes are available.</p> : null}
    {state.admission ? <>
      <Caption1>{state.admission.total} cables in this immutable scope. {state.admission.jobId ? `Job ${state.admission.jobId}.` : 'This blocked generation has no calculation job.'}</Caption1>
      <Caption1>Page contains {state.page?.rows.length ?? 0} cables; at most 100 per page.</Caption1>
      {props.batch ? <div className={styles.actions}>
        <Button disabled={frozen || !selectable.length} onClick={() => selectable.forEach(value => props.batch!.select(value, true))}>Select ready cables on this page</Button>
        <Caption1>Page selection includes current LV, Control and Instrumentation results only. MV cables are excluded. Selection is retained across cable pages; changing the calculation clears unprocessed selections.</Caption1>
      </div> : null}
      <div style={{ overflowX: 'auto', minWidth: 0 }}>
        <table className={styles.table} aria-label="Cable revision result page" style={{ minWidth: 360 }}>
          <thead><tr>{props.batch ? <th scope="col">Select</th> : null}<th scope="col">Cable / From → To</th><th scope="col">Outcome and length changes</th><th scope="col">Inspect</th></tr></thead>
          <tbody>{state.page?.rows.map(value => <tr key={value.cableId}>
            {props.batch ? <td><input type="checkbox" aria-label={`Select ${value.baseline.currentCable.tag ?? value.cableId} for review`}
              disabled={frozen || !candidate(value) || props.batch.entries.some(entry => entry.proposalId === value.result?.proposalId && entry.status === 'applied')}
              checked={props.batch.entries.some(entry => entry.proposalId === value.result?.proposalId)}
              onChange={event => { const selected = candidate(value); if (selected) props.batch!.select(selected, event.target.checked); }} /></td> : null}
            <th scope="row">{text(value.baseline.currentCable.tag)}<br /><Caption1>{text(value.baseline.currentCable.fromLocation)} → {text(value.baseline.currentCable.toLocation)}</Caption1></th>
            <td>{rowStatus(value)}<br /><Caption1>Current design: {metres(value.baseline.currentCable.designLength)}<br />New design: {metres(value.result?.designLengthMeters)}<br />Design delta: {signedMetres(value.result?.delta.designLengthMeters)}<br />Geometry delta: {signedMetres(value.result?.delta.rawLengthMeters)}</Caption1>
              <p>{value.currentness.state === 'current' ? 'Current inputs' : label(value.currentness.state)}</p>
              {value.result?.reasonCodes.length ? <Caption1>{value.result.reasonCodes.map(label).join('; ')}</Caption1> : null}
            </td>
            <td><Button disabled={frozen} aria-pressed={detail?.row.cableId === value.cableId} onClick={() => { props.onHistorySelection?.(); void state.readDetail(value.cableId); }}>Inspect {value.baseline.currentCable.tag ?? 'cable'}</Button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className={styles.actions}>
        <Button disabled={frozen || !state.previousPage} onClick={state.previousResultsPage}>Previous cable page</Button>
        <Button disabled={frozen || !state.page?.nextAfterCableId} onClick={state.nextPage}>Next cable page</Button>
      </div>
    </> : null}
    {detail && row && baseline ? <section aria-label="Cable revision detail" className={styles.result} style={{ overflowWrap: 'anywhere' }}>
      <h4>{text(baseline.currentCable.tag)} — {rowStatus(row)}</h4>
      <p>{row.message}</p>
      {row.currentness.state !== 'current' ? <p role="alert">Currentness: {label(row.currentness.state)}. {row.currentness.reasonCodes.map(label).join('; ')}. Opening a result does not authorize Apply.</p> : null}
      <section aria-label="Current cable at admission"><h5>Current cable at admission</h5>
        <p>From {text(baseline.currentCable.fromLocation)} → To {text(baseline.currentCable.toLocation)}</p>
        <Caption1>Write revision: {baseline.currentCable.cableWriteRevision}. Model: {baseline.acceptedMatchesCurrent ? model(accepted?.modelRef ?? null) : unavailable}.</Caption1>
        <p>Geometric length: {metres(baseline.acceptedMatchesCurrent ? accepted?.rawLengthMeters : null)}; design length: {metres(baseline.currentCable.designLength)}; installed length: {metres(baseline.currentCable.installLength)}.</p>
        <RouteText value={baseline.currentCable.routing} />
      </section>
      <section aria-label="Last accepted Path Finder result"><h5>Last accepted Path Finder result</h5>
        {accepted ? <><p>{baseline.acceptedMatchesCurrent ? 'This accepted result matches the current cable snapshot.' : 'Historical accepted result: later cable edits mean it does not describe the current cable geometry.'}</p>
          <Caption1>Model: {model(accepted.modelRef)}; applied {accepted.appliedAt}.</Caption1>
          <p>Geometric length: {metres(accepted.rawLengthMeters)}; unrounded length: {metres(accepted.unroundedMeters)}; design length: {metres(accepted.designLengthMeters)}.</p><RouteText value={accepted.routeText} />
        </> : <p>No linked accepted result. Old model, geometry and exact components are unavailable; current cable values are retained above.</p>}
      </section>
      <section aria-label="New calculated result"><h5>New calculated result</h5>
        {result ? <><Caption1>Model: {model(result.newModel)}. {result.calculationMode === 'design' ? 'Design length only; verified geometry reused.' : 'Full route calculation.'}</Caption1>
          <p>Geometric length: {metres(result.rawLengthMeters)}; unrounded length: {metres(result.unroundedMeters)}; design length: {metres(result.designLengthMeters)}.</p>
          <p>Geometry delta: {signedMetres(result.delta.rawLengthMeters)}; unrounded delta: {signedMetres(result.delta.unroundedMeters)}; design delta: {signedMetres(result.delta.designLengthMeters)}.</p>
          <Caption1>Recorded delta baseline: {label(result.delta.baseline)}. An unavailable old geometry is never estimated from rounded design length.</Caption1>
          <RouteText value={result.routeText} />
        </> : <p>No calculated output is available for this cable. Its frozen input and diagnostic remain available.</p>}
      </section>
      <section aria-label="Revision reasons"><h5>Recorded reasons</h5>
        {result?.reasonCodes.length ? <ul>{result.reasonCodes.map(reason => <li key={reason}>{label(reason)}</li>)}</ul> : <p>No cable-specific reason is recorded.</p>}
        {detail.envelope?.observedEvents.length ? <><Caption1>Project observations are context; they do not prove this cable or equipment physically moved.</Caption1><ul>{detail.envelope.observedEvents.map((event, index) => <li key={`${event.generation}-${event.domain}-${index}`}>Generation {event.generation}: {label(event.reason)}</li>)}</ul></> : null}
      </section>
      <LengthComponents detail={detail} />
      <details><summary>Recorded provenance</summary>
        <p>Baseline hash: {row.baselineHash}</p>
        {result ? <><p>Proposal hash: {result.proposalHash}</p><p>Revision-result hash: {result.revisionResultSha256}</p><p>Engine-result hash: {result.engineResultSha256}</p><p>Length-component hash: {text(result.ledgerHash)}</p><p>Dependency hash: {result.dependencyHash}</p></> : null}
        <Caption1>Installed length is preserved. Native parity and wider model acceptance are not established by this result.</Caption1>
      </details>
      {result && detail.envelope && !resultBelongsToScope ? <p role="alert">This saved result does not match the selected calculation. Refresh the selected calculation before opening a proposal.</p> : null}
      <Button appearance="primary" disabled={frozen || !result || !detail.envelope || !resultBelongsToScope} onClick={() => void open()}>Open exact proposal in Viewer</Button>
      <Caption1>The exact proposal is opened from the selected calculation. The protected flow checks its path and current authority before human Review and Apply.</Caption1>
    </section> : null}
  </section>;
}
