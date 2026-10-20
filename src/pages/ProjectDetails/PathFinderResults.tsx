import { useCallback, useEffect, useRef, useState } from 'react';
import { Body1, Button, Caption1, Spinner } from '@fluentui/react-components';
import type { PathFinderJob, PathFinderProposal } from '@/api/pathfinder';
import { MAX_PATH_POINTS } from '../../../viewer-runtime/protocol.mjs';
import type { usePathFinder } from './hooks/usePathFinder';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';
import { PathFinderRecalculationPanel } from './PathFinderRecalculationPanel';
import { PathFinderRevisionResults, type PathFinderCalculationScope } from './PathFinderRevisionResults';
import { usePathfinderPendingApply } from './hooks/usePathfinderPendingApply';
import { usePathfinderBatchReview } from './hooks/usePathfinderBatchReview';
import { PathFinderBatchReview } from './PathFinderBatchReview';
import { computedPathObjectIds, proposalEndpointObjectIds } from './pathFinderEndpointVisibility';
import { sealedCableItemApplicabilitySchema } from '../../../shared/pathfinderItemApplicability';

type Props = { pf: ReturnType<typeof usePathFinder>; selectedCableId: string | null; accountId?: string | null; active?: boolean; displayOwned?: boolean; claimViewer?: () => () => boolean; options?: { secondaryDistanceMeters: number; preferVerticalApproach: boolean } | null; onBatchBusyChange?: (busy: boolean) => void };
const resultLabel = (status: string) => ({ calculated: 'Ready for review', model_needs_review: 'Model review required', no_path: 'No connected path', settings_required: 'Project values required', category_required: 'Cable category required', locations_required: 'Resolve locations', stale: 'Outdated', deadline_exceeded: 'Calculation timed out', resource_limit: 'Calculation limit reached', invalid_request: 'Review the input' }[status] ?? 'Review required');
function hasExactItemApplicability(proposal: PathFinderProposal | null, projectId: string | null | undefined) {
  const proof = sealedCableItemApplicabilitySchema.safeParse(proposal?.itemApplicability);
  return Boolean(proposal && projectId && proof.success && proposal.provenance?.dependencyVersion === 'pathfinder.dependencies.v7'
    && proposal.projectId === projectId && proof.data.projectId === projectId && proof.data.jobId === proposal.jobId
    && proof.data.cableId === proposal.cableId && proof.data.proposalId === proposal.id && proof.data.dependencyHash === proposal.provenance.dependencyHash);
}
export function PathFinderResults({ pf, selectedCableId, accountId, active = true, displayOwned = true, claimViewer, options, onBatchBusyChange }: Props) {
  const styles = useRoutingsViewerStyles();
  const [proposal, setProposal] = useState<PathFinderProposal | null>(null), [job, setJob] = useState<PathFinderJob | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null), [pathDisplayed, setPathDisplayed] = useState(false), [applied, setApplied] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [scopeReadiness, setScopeReadiness] = useState<PathFinderCalculationScope>({ admissionId: null, jobId: null, ready: false, message: 'Choose a completed calculation in Cable revision results below.' });
  const scope = useRef(scopeReadiness);
  const [notice, setNotice] = useState<string | null>(null), data = pf.data;
  const pendingApply = usePathfinderPendingApply({
    projectId: pf.preparationAccess?.projectId ?? null, loadedProjectId: pf.preparationAccess?.loadedProjectId ?? null,
    token: pf.preparationAccess?.token ?? null, isAdmin: pf.preparationAccess?.isAdmin ?? false,
    accountId: accountId ?? null, active, action: (path, body) => (pf.actionWithoutRefresh ?? pf.action)(path, body),
  });
  const ownershipKey = JSON.stringify([accountId, pf.preparationAccess]);
  const batch = usePathfinderBatchReview({ identityKey: ownershipKey,
    contextKey: JSON.stringify([data?.activeModel, data?.registryRevision, data?.settings, data?.artifacts.map(item => [item.id, item.snapshotSha256])]),
    active, blocked: !active || options === null || pf.viewerPhase === 'error' || pf.viewerPhase === 'loading', options,
    readProposal: pf.readProposal, reviewProposal: pf.reviewProposal, pendingApply, onApplied: pf.refresh,
  });
  useEffect(() => { onBatchBusyChange?.(batch.busy); return () => onBatchBusyChange?.(false); }, [batch.busy, onBatchBusyChange]);
  const operation = useRef(0), reviewContext = useRef(''), endpointRead = useRef<AbortController | null>(null);
  const displayed = useRef({ owned: displayOwned, path: pathDisplayed, clear: pf.clear });
  displayed.current = { owned: displayOwned, path: pathDisplayed, clear: pf.clear };
  const receiveScope = useCallback((value: PathFinderCalculationScope) => {
    const previous = scope.current;
    scope.current = value;
    if (previous.admissionId === value.admissionId && previous.jobId === value.jobId && previous.ready === value.ready && previous.message === value.message
      && previous.wholeJobReady === value.wholeJobReady && previous.jobStatus === value.jobStatus && previous.cancelRequested === value.cancelRequested) return;
    setScopeReadiness(value);
    if (previous.admissionId === value.admissionId && previous.jobId === value.jobId) return;
    endpointRead.current?.abort(); operation.current++;
    setProposal(null); setReviewId(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(false); setNotice(null);
    if (displayed.current.owned && displayed.current.path) displayed.current.clear();
  }, []);
  useEffect(() => { endpointRead.current?.abort(); operation.current++; setProposal(null); setReviewId(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(false); setNotice(null); return () => { endpointRead.current?.abort(); operation.current++; }; }, [ownershipKey, selectedCableId, data?.activeModel.modelVersionId, data?.activeModel.selectionRevision]);
  useEffect(() => { endpointRead.current?.abort(); operation.current++; setReviewId(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(false); setNotice(null); return () => { endpointRead.current?.abort(); operation.current++; }; }, [active]);
  useEffect(() => { if (!displayOwned) { endpointRead.current?.abort(); operation.current++; setReviewId(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(false); setNotice(null); } }, [displayOwned]);
  const optionsKey = JSON.stringify(options);
  useEffect(() => { endpointRead.current?.abort(); operation.current++; setReviewId(null); setPathDisplayed(false); setApplied(false); setNotice(null); }, [optionsKey]);
  const selectedRevision = data?.cables.find(cable => cable.id === proposal?.cableId)?.cableWriteRevision;
  const settingsKey = JSON.stringify(data?.settings);
  const dependencyNotice = useRef<{ proposalId: string | null; key: string } | null>(null);
  useEffect(() => {
    const proposalId = proposal?.id ?? null, key = JSON.stringify([data?.registryRevision, data?.activeModel.selectionRevision, settingsKey, selectedRevision]);
    const previous = dependencyNotice.current; dependencyNotice.current = { proposalId, key };
    // The first proposal read also resolves selectedRevision. Preserve a notice
    // from that same read, and do not race a newly confirmed review. Opening a
    // different proposal already resets review state synchronously above.
    if (previous?.proposalId === proposalId && previous.key !== key) { setReviewId(null); setApplied(false); setNotice(null); }
  }, [data?.registryRevision, data?.activeModel.selectionRevision, settingsKey, selectedRevision, proposal?.id]);
  const openProposal = async (id: string, expectedJobId: string) => {
    const selectedScope = scope.current;
    if (!active || !selectedScope.admissionId || selectedScope.jobId !== expectedJobId) return;
    const currentDisplay = claimViewer?.() ?? (() => true);
    const current = ++operation.current;
    endpointRead.current?.abort(); const controller = new AbortController(); endpointRead.current = controller;
    setNotice(null); setProposal(null); setReviewId(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(true);
    try {
      const detail = await pf.readProposal(id); if (!detail || operation.current !== current || !currentDisplay()) return;
      if (scope.current.admissionId !== selectedScope.admissionId || scope.current.jobId !== expectedJobId) return;
      if (detail.id !== id || detail.jobId !== expectedJobId) { setNotice('This proposal does not belong to the selected calculation. Open a result from that calculation again.'); return; }
      setProposal(detail);
      if (!detail.route?.success || detail.route.points.length < 1) { pf.clear(); setNotice('This proposal has no drawable path. Its diagnostic is shown below.'); return; }
      if (detail.route.points.length > MAX_PATH_POINTS) { setNotice('This exact path exceeds the viewer point budget. The result is retained without truncation.'); return; }
      const access = pf.preparationAccess;
      const endpointIds = data && access?.projectId && access.token
        ? await proposalEndpointObjectIds(detail, data, { projectId: access.projectId, token: access.token }, controller.signal) : [];
      if (controller.signal.aborted || operation.current !== current || !currentDisplay()) return;
      const objectIds = computedPathObjectIds(detail.route.objectIds, endpointIds);
      if (!objectIds) { setNotice('This path and its From/To objects exceed the viewer object budget. The result is retained without truncation.'); return; }
      const displayed = await pf.showPath({ pathId: detail.id, points: detail.route.points, objectIds });
      if (operation.current !== current || !currentDisplay()) return;
      if (displayed) setPathDisplayed(true); else setNotice('The proposal is available below. Load the active model and reopen it to view the exact path before confirming review.');
    } catch (error) {
      if (controller.signal.aborted || operation.current !== current || !currentDisplay()) return;
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      if (status === 401 || status === 403) { pf.refresh(); setNotice('Current administrator access is required to show the From/To objects.'); }
      else setNotice('The From/To objects could not be checked. Open the path again.');
    } finally { if (endpointRead.current === controller) endpointRead.current = null; if (operation.current === current) setPreviewLoading(false); }
  };
  const confirmReview = async () => {
    if (!active || !displayOwned || !proposal || !pathDisplayed || !effectiveCanApply || stale || pf.busy || !pendingApply.canStart) return;
    const current = operation.current, context = reviewContext.current, target = proposal;
    const reviewed = await pf.reviewProposal(target);
    if (!reviewed || operation.current !== current || reviewContext.current !== context || reviewed.proposal.id !== target.id || reviewed.proposal.proposalHash !== target.proposalHash) return;
    setProposal(reviewed.proposal); setReviewId(reviewed.reviewId); setNotice('Review confirmed for this immutable proposal.');
  };
  const apply = async () => {
    if (!active || !displayOwned || !proposal || !reviewId || !effectiveCanApply || stale || !pendingApply.canStart || pf.busy) return;
    const current = operation.current;
    const confirmed = await pendingApply.start({ proposalId: proposal.id, proposalHash: proposal.proposalHash, cableId: proposal.cableId,
      reviewId, expectedCableWriteRevision: proposal.cableWriteRevision, revisionResultHash: proposal.revisionResultHash ?? null });
    if (confirmed) { if (operation.current === current) setApplied(true); pf.refresh(); }
  };
  const summary = data?.proposals.find(value => value.id === proposal?.id), stale = proposal?.stale || summary?.stale || false;
  const preferencesMatch = options === undefined || Boolean(options && proposal?.routingPreferences && options.secondaryDistanceMeters === proposal.routingPreferences.secondaryDistanceMeters && options.preferVerticalApproach === proposal.routingPreferences.preferVerticalApproach);
  const proposalJob = data?.jobs.find(value => value.id === proposal?.jobId);
  const checkedJobStatus = proposalJob?.status ?? scopeReadiness.jobStatus;
  const calculationCancelled = Boolean(proposalJob?.cancelRequested || scopeReadiness.cancelRequested || checkedJobStatus === 'cancelled' || scopeReadiness.jobStatus === 'cancelled');
  const calculationFailed = proposalJob?.status === 'failed' || scopeReadiness.jobStatus === 'failed';
  const wholeJobReady = scopeReadiness.wholeJobReady ?? scopeReadiness.ready;
  const sealedItemReady = ['queued', 'running'].includes(checkedJobStatus ?? '') && hasExactItemApplicability(proposal, pf.preparationAccess?.projectId);
  const effectiveCanApply = Boolean(proposal && proposal.status === 'calculated' && scopeReadiness.admissionId && proposal.jobId === scopeReadiness.jobId && !calculationCancelled
    && !calculationFailed && (wholeJobReady && (!checkedJobStatus || checkedJobStatus === 'complete') || sealedItemReady) && preferencesMatch && !stale && !proposal.compatibilityIssue
    && proposal.canApply && !(summary && summary.proposalHash === proposal.proposalHash && !summary.canApply));
  const proposalJobIssue = !proposal || effectiveCanApply ? null : calculationCancelled
    ? 'This calculation was cancelled. Its saved path can be inspected, but cannot be reviewed or applied. Choose a completed calculation in Cable revision results, or calculate non-MV cables again if needed.'
    : calculationFailed ? 'This calculation failed. Its saved path can be inspected, but cannot be reviewed or applied. Calculate again before reviewing the result.'
    : checkedJobStatus && checkedJobStatus !== 'complete'
      ? `This calculation is ${checkedJobStatus}. Review and Apply require a completed calculation or this cable's individually sealed, current result. Calculate again after a failed job, or wait for the current job to finish.`
      : !proposalJob && !scopeReadiness.ready ? 'This calculation is outside the recent job list. Its current state could not be confirmed here. Check the calculation state in Cable revision results below.' : null;
  const nonMvCableIds = (data?.cables ?? []).filter(value => ['LV', 'Control', 'Instrumentation'].includes(value.mto ?? '')).map(value => value.id);
  const selectedCable = data?.cables.find(value => value.id === selectedCableId);
  const selectedCategoryAllowed = Boolean(selectedCable && ['LV', 'Control', 'Instrumentation'].includes(selectedCable.mto ?? ''));
  reviewContext.current = JSON.stringify([ownershipKey, active, displayOwned, selectedCableId, scopeReadiness.admissionId, scopeReadiness.jobId, data?.activeModel, data?.registryRevision, settingsKey, optionsKey, selectedRevision, proposal?.id, proposal?.proposalHash, proposal?.revisionResultHash, stale, effectiveCanApply]);
  const proposals = (data?.proposals ?? []).filter(value => scopeReadiness.jobId !== null && value.jobId === scopeReadiness.jobId && (!selectedCableId || value.cableId === selectedCableId));
  return <section className={styles.result} aria-label="Path Finder calculations">
    <h3>Calculate and review</h3>
    <Body1>Calculate proposals manually or explicitly enable automatic recalculation.</Body1>
    {pendingApply.pending ? <section aria-label="Pending Apply reconciliation" className={styles.result}>
      <h4>Pending Apply</h4>
      <Body1>The exact Apply command is retained for this account and project. Its outcome must be confirmed before another proposal can be reviewed or applied.</Body1>
      <Caption1>Proposal {pendingApply.pending.proposalId}; original cable revision {pendingApply.pending.expectedCableWriteRevision}. Current model or cable changes do not replace this command.</Caption1>
      <Button disabled={!pendingApply.canRetry || pf.busy} onClick={() => void pendingApply.retry()}>Retry pending Apply</Button>
      <Button disabled={!pendingApply.canRetry || pf.busy} onClick={() => void pendingApply.close().then(confirmed => { if (confirmed) setReviewId(null); })}>Close pending request</Button>
      <Caption1>Closing reconciles an existing Apply receipt or records that this exact request cannot apply later. It does not apply a replacement result.</Caption1>
    </section> : null}
    {pendingApply.busy ? <Spinner size="tiny" label="Reconciling the exact Apply command…" /> : null}
    {pendingApply.error ? <Body1 role="alert">{pendingApply.error}</Body1> : null}
    {pendingApply.message ? <Body1 role="status">{pendingApply.message}</Body1> : null}
    {pf.preparationAccess ? <PathFinderRecalculationPanel {...pf.preparationAccess} accountId={accountId ?? null} active={active} preferences={options}
      contextKey={JSON.stringify([data?.activeModel, pf.preparationViewerGeneration, options])}
      onChanged={pf.refresh} onAuthorityLost={pf.cancelOperation} /> : null}
    <PathFinderBatchReview batch={batch} disabled={pf.busy || !active || !pendingApply.canStart || !scopeReadiness.ready}
      disabledReason={!active ? 'Open Path with current administrator access to review results.' : !pendingApply.canStart ? 'Reconcile any pending Apply request before reviewing another result.' : scopeReadiness.message} />
    {pf.preparationAccess ? <PathFinderRevisionResults {...pf.preparationAccess} accountId={accountId??null} active={active && Boolean(data)} busy={pf.busy || batch.busy}
      contextKey={JSON.stringify([data?.activeModel, data?.registryRevision, settingsKey, optionsKey])}
      onAuthorityLost={pf.cancelOperation} onOpenProposal={openProposal} batch={batch} cables={data?.cables ?? []} jobs={data?.jobs ?? []}
      readJob={pf.readJob} onScopeReadinessChange={receiveScope} /> : null}
    <Caption1>Calculations use the active model, shared locations, connection gap and allowances from Project Details. Instrumentation follows Control.</Caption1>
    <div className={styles.actions}>
      <Button disabled={options === null || !data?.artifacts.length || pf.busy || !nonMvCableIds.length || nonMvCableIds.length > 10000} onClick={() => void (options ? pf.calculate(nonMvCableIds, true, options) : pf.calculate(nonMvCableIds, true))}>Calculate non-MV cables</Button>
      <Button disabled={options === null || !data?.artifacts.length || pf.busy || !selectedCableId || !selectedCategoryAllowed} onClick={() => void (options ? pf.calculate([selectedCableId!], true, options) : pf.calculate([selectedCableId!], true))}>Calculate selected cable</Button>
    </div>
    <Caption1>Manual calculation includes LV, Control and Instrumentation only. MV and unknown categories are excluded. For cancelled results, choose a completed calculation or calculate non-MV cables again if needed.</Caption1>
    {pf.busy ? <Spinner size="tiny" label="Saving or checking Path Finder data…" /> : null}
    {previewLoading ? <Spinner size="tiny" label="Loading the exact computed path…" /> : null}
    {notice ? <Body1 role="status">{notice}</Body1> : null}
    <details open={Boolean(data?.jobs.length)}><summary>Calculation jobs</summary>
      {(data?.jobs ?? []).slice(0, 5).map(item => <div key={item.id} className={styles.result} data-testid="pathfinder-job" data-state={item.status}>
        <Body1>{item.kind === 'lookup' ? 'Ordered lookup — ' : item.kind === 'preview' ? 'Standalone path — ' : ''}{item.status === 'running' || item.status === 'queued' ? 'Calculating' : item.status === 'complete' ? 'Complete' : item.status === 'cancelled' ? 'Cancelled' : 'Failed'}: {item.completed} / {item.total}{item.kind === 'lookup' || item.kind === 'preview' ? ' result' : ' cables'}</Body1>
        {item.cancelRequested && item.status !== 'cancelled' ? <Caption1>Cancellation requested; waiting for the calculation to stop.</Caption1> : null}
        {item.failure ? <Caption1>{item.failure}</Caption1> : null}
        <div className={styles.actions}><Button disabled={pf.busy} onClick={() => void pf.readJob(item.id).then(result => { if (result) setJob(result); })}>Job details</Button>
          {['queued', 'running'].includes(item.status) ? <Button disabled={pf.busy || item.cancelRequested} onClick={() => void pf.action(`/jobs/${item.id}`, undefined, 'DELETE')}>Cancel job</Button> : null}</div>
      </div>)}
      {job?.items ? <ul aria-label="Calculation outcomes">{job.items.map(item => <li key={item.cableId}>{data?.cables.find(cable => cable.id === item.cableId)?.tag ?? 'Cable'}: {resultLabel(item.status)}{item.message ? ` — ${item.message}` : ''}</li>)}</ul> : null}
    </details>
    <ul className={styles.cableList} aria-label="Path Finder proposals">
      {proposals.slice(0, 5).map(item => <li key={item.id}><Button disabled={pf.busy || batch.busy || previewLoading} aria-pressed={proposal?.id === item.id} onClick={() => void openProposal(item.id, item.jobId)}>
        {data?.cables.find(cable => cable.id === item.cableId)?.tag ?? 'Cable'} — {item.stale ? 'Outdated' : item.status === 'calculated' && !item.canApply ? 'Review blocked' : resultLabel(item.status)}{item.synthetic ? ' — local synthetic fixture' : ''}
      </Button></li>)}
    </ul>
    <Caption1>{proposals.length ? 'Recent proposals from the selected calculation are shown here.' : 'Use Inspect, then Open exact proposal in Viewer in the selected calculation above.'} Cable revision results contains every cable in that calculation, with pages of up to 100.</Caption1>
    {proposal ? <section className={styles.result} aria-label="Proposal review" data-testid="pathfinder-proposal" data-stale={String(stale)}>
      <h4>Proposal review</h4>
      <Body1>Cable: {data?.cables.find(cable => cable.id === proposal.cableId)?.tag ?? proposal.cableId}</Body1>
      <Body1>{proposal.synthetic ? 'Local synthetic fixture for demonstration.' : 'Review the route and length before applying.'}</Body1>
      {stale ? <Body1 role="alert">This result is outdated. Calculate a new proposal before reviewing or applying it.</Body1> : null}
      <Body1>{proposal.message}</Body1>
      {proposalJobIssue ? <Body1 role="alert">{proposalJobIssue}</Body1> : null}
      {proposal.routingPreferences ? <Caption1>Calculated with SECONDARY trigger {proposal.routingPreferences.secondaryDistanceMeters} m; vertical approach {proposal.routingPreferences.preferVerticalApproach ? 'preferred' : 'not preferred'}.</Caption1> : <Caption1>The original routing preferences are unavailable.</Caption1>}
      {options !== null && !preferencesMatch ? <Body1 role="alert">This proposal uses different routing preferences. Calculate a new proposal with the current Path values before reviewing or applying.</Body1> : null}
      {proposal.compatibilityIssue ? <Body1 role="alert">{proposal.compatibilityIssue}</Body1> : null}
      <Caption1>Calculation mode: {proposal.calculationMode === 'design' ? 'Design length only; verified route reused' : proposal.calculationMode === 'calculate' ? 'Full route calculation' : 'Unavailable for this historical result'}.</Caption1>
      {proposal.provenance ? <details style={{ minWidth: 0, overflowWrap: 'anywhere' }}><summary>Calculation provenance</summary>
        <Caption1>Dependency version: {proposal.provenance.dependencyVersion}; digest: {proposal.provenance.dependencyHash}.</Caption1>
        <Caption1>Recorded engine digest: {proposal.provenance.engineIdentity?.contentSha256 ?? 'Unavailable for this historical result'}.</Caption1>
        {proposal.provenance.dependencyVersion === 'pathfinder.dependencies.v7' ? <Caption1>Shared location calculation. {hasExactItemApplicability(proposal, pf.preparationAccess?.projectId) ? 'An individually sealed cable result is recorded.' : 'Individual applicability is not confirmed.'} Human review and current server checks are still required.</Caption1>
          : proposal.provenance.automatic ? <Caption1>Automatic generation: {proposal.provenance.automatic.generation}; authority epoch: {proposal.provenance.automatic.authorityEpoch}; {proposal.provenance.automatic.current ? 'current' : 'no longer current'}{proposal.provenance.automatic.reasonCode ? ` — ${proposal.provenance.automatic.reasonCode.toLowerCase().replaceAll('_', ' ')}` : ''}.</Caption1> : <Caption1>No durable automatic enrollment recorded.</Caption1>}
        <Caption1>These recorded facts do not replace human review or grant Apply authority.</Caption1>
      </details> : <Caption1>Calculation provenance is unavailable for this historical result.</Caption1>}
      {proposal.route ? <><Body1>Geometric length: {proposal.route.lengthMeters} m</Body1><Caption1>From approach: {proposal.route.fromDistanceMeters} m{proposal.route.fromRequiresSecondary ? ' (SECONDARY)' : ''}; To approach: {proposal.route.toDistanceMeters} m{proposal.route.toRequiresSecondary ? ' (SECONDARY)' : ''}</Caption1><Caption1>Connection gaps: {proposal.route.connectionGapCount}; total gap length: {proposal.route.connectionGapLengthMeters} m</Caption1><details><summary>Exact route text</summary><p style={{ overflowWrap: 'anywhere' }}>{proposal.route.routeText}</p></details></> : null}
      {proposal.design ? <><Body1>Before percentage: {proposal.design.lengthBeforePercentageMeters} m</Body1><Caption1>Before rounding: {proposal.design.unroundedLengthMeters} m</Caption1><Body1>Design length: {proposal.design.designLengthMeters} m</Body1></> : null}
      {proposal.lengthLedger ? <details><summary>Exact length components</summary>
        <p>Raw geometry: {proposal.lengthLedger.rawLengthDecimalMeters} m. Connection gaps are already included.</p>
        <p>Removed From approach: {proposal.lengthLedger.from.removedApproachMeters} m; removed To approach: {proposal.lengthLedger.to.removedApproachMeters} m.</p>
        <p>SECONDARY ends: {proposal.lengthLedger.secondaryEnds}; replacement: {proposal.lengthLedger.replacementMeters} m; Secondary tray length: {proposal.lengthLedger.settings.secondaryTrayLengthMeters??'Not required'}.</p>
        <p>Before clamp: {proposal.lengthLedger.beforeClampMeters} m; clamp adjustment: {proposal.lengthLedger.clampAdjustmentMeters} m; after clamp: {proposal.lengthLedger.afterClampMeters} m.</p>
        <p>For end connection: {proposal.lengthLedger.settings.endConnectionLengthMeters} m; Additional % for bending: {proposal.lengthLedger.settings.additionalBendingPercent}%.</p>
        <p>Bending increment: {proposal.lengthLedger.bendingIncrementMeters} m; ceiling increment: {proposal.lengthLedger.ceilingIncrementMeters} m.</p>
        <Caption1>Project Details revision: {proposal.lengthLedger.settingsRevision}; immutable result: {proposal.revisionResultHash??'Unavailable'}.</Caption1>
      </details> : <Caption1>Exact length components are unavailable for this historical or unsuccessful result.</Caption1>}
      <Caption1>Installed length is not changed by Apply.</Caption1>
      <div className={styles.actions}>
        <Button disabled={!active || !displayOwned || pf.busy || batch.busy || previewLoading || stale || !pathDisplayed || !effectiveCanApply || Boolean(reviewId) || !pendingApply.canStart} onClick={() => void confirmReview()}>Confirm proposal review</Button>
        <Button appearance="primary" disabled={!active || !displayOwned || pf.busy || batch.busy || stale || !reviewId || !effectiveCanApply || applied || !pendingApply.canStart} onClick={() => void apply()}>Apply reviewed result</Button>
      </div>
      {!pathDisplayed && !previewLoading ? <Caption1>The exact path has not been displayed. Load the model and use Open path again before confirming individual review.</Caption1> : null}
      <Button disabled={!active || pf.busy || batch.busy || previewLoading || pf.viewerPhase === 'error'} onClick={() => void openProposal(proposal.id, proposal.jobId)}>Open path again</Button>
      {!effectiveCanApply && !stale ? <Caption1>{proposal.engineeringMessage}</Caption1> : null}
    </section> : null}
  </section>;
}
