import { useEffect, useRef, useState } from 'react';
import { Body1, Button, Caption1, Spinner } from '@fluentui/react-components';
import type { PathFinderJob, PathFinderProposal } from '@/api/pathfinder';
import { MAX_PATH_POINTS } from '../../../viewer-runtime/protocol.mjs';
import type { usePathFinder } from './hooks/usePathFinder';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';

type Props = { pf: ReturnType<typeof usePathFinder>; selectedCableId: string | null; active?: boolean; displayOwned?: boolean; claimViewer?: () => () => boolean; options?: { secondaryDistanceMeters: number; preferVerticalApproach: boolean } | null };
const resultLabel = (status: string) => ({ calculated: 'Ready for review', model_needs_review: 'Model review required', no_path: 'No connected path', settings_required: 'Project values required', category_required: 'Cable category required', locations_required: 'Resolve locations', stale: 'Outdated', deadline_exceeded: 'Calculation timed out', resource_limit: 'Calculation limit reached', invalid_request: 'Review the input' }[status] ?? 'Review required');
export function PathFinderResults({ pf, selectedCableId, active = true, displayOwned = true, claimViewer, options }: Props) {
  const styles = useRoutingsViewerStyles(), lastAutomatic = useRef<string | null>(null);
  const [proposal, setProposal] = useState<PathFinderProposal | null>(null), [job, setJob] = useState<PathFinderJob | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null), [applyKey, setApplyKey] = useState<string | null>(null), [pathDisplayed, setPathDisplayed] = useState(false), [applied, setApplied] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null), data = pf.data;
  const operation = useRef(0), reviewContext = useRef('');
  useEffect(() => { operation.current++; setProposal(null); setReviewId(null); setApplyKey(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(false); setNotice(null); return () => { operation.current++; }; }, [selectedCableId, data?.activeModel.modelVersionId, data?.activeModel.selectionRevision]);
  useEffect(() => { operation.current++; setReviewId(null); setApplyKey(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(false); setNotice(null); return () => { operation.current++; }; }, [active]);
  useEffect(() => { if (!displayOwned) { operation.current++; setReviewId(null); setApplyKey(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(false); setNotice(null); } }, [displayOwned]);
  const optionsKey = JSON.stringify(options);
  useEffect(() => { operation.current++; setReviewId(null); setApplyKey(null); setPathDisplayed(false); setApplied(false); setNotice(null); }, [optionsKey]);
  const selectedRevision = data?.cables.find(cable => cable.id === proposal?.cableId)?.cableWriteRevision;
  const settingsKey = JSON.stringify(data?.settings);
  useEffect(() => { setReviewId(null); setApplyKey(null); setApplied(false); setNotice(null); }, [data?.registryRevision, data?.activeModel.selectionRevision, settingsKey, selectedRevision]);
  const automaticKey = data ? JSON.stringify([data.registryRevision, data.activeModel, data.settings, options, data.artifacts.map(value => value.id), data.cables.map(value => [value.id, value.cableWriteRevision])]) : null;
  const hasReadyCable = data?.cables.some(cable => cable.fromMatch.status === 'matched' && cable.toMatch.status === 'matched' && ['MV', 'LV', 'Control', 'Instrumentation'].includes(cable.mto ?? '')) ?? false;
  useEffect(() => {
    if (!automaticKey || options === null || lastAutomatic.current === automaticKey || !data?.artifacts.length || !hasReadyCable || pf.busy || !data.cables.length || data.cables.length > 10000) return;
    lastAutomatic.current = automaticKey; if (options) void pf.calculate(undefined, false, options); else void pf.calculate();
  }, [automaticKey, data, hasReadyCable, options, pf.busy, pf.calculate]);
  const openProposal = async (id: string) => {
    if (!active) return;
    const currentDisplay = claimViewer?.() ?? (() => true);
    const current = ++operation.current;
    setNotice(null); setReviewId(null); setApplyKey(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(true); pf.clear();
    try {
      const detail = await pf.readProposal(id); if (!detail || operation.current !== current || !currentDisplay()) return; setProposal(detail);
      if (!detail.route?.success || detail.route.points.length < 1) return;
      if (detail.route.points.length > MAX_PATH_POINTS) { setNotice('This exact path exceeds the viewer point budget. The result is retained without truncation.'); return; }
      const objectIds = [...new Set(detail.route.objectIds.filter(value => /^dbid:[1-9][0-9]*$/.test(value)).map(value => Number(value.slice(5))))];
      if (objectIds.length > 512) { setNotice('This path exceeds the viewer object budget. The result is retained without truncation.'); return; }
      const displayed = await pf.showPath({ pathId: detail.id, points: detail.route.points, objectIds });
      if (operation.current !== current || !currentDisplay()) return;
      if (displayed) setPathDisplayed(true); else setNotice('The proposal is available below. Load the active model and reopen it to view the exact path before confirming review.');
    } finally { if (operation.current === current) setPreviewLoading(false); }
  };
  const confirmReview = async () => {
    if (!active || !displayOwned || !proposal || !pathDisplayed || !effectiveCanApply || stale || pf.busy) return;
    const current = operation.current, context = reviewContext.current, target = proposal;
    const reviewed = await pf.reviewProposal(target);
    if (!reviewed || operation.current !== current || reviewContext.current !== context || reviewed.proposal.id !== target.id || reviewed.proposal.proposalHash !== target.proposalHash) return;
    setProposal(reviewed.proposal); setReviewId(reviewed.reviewId); setApplyKey(crypto.randomUUID()); setNotice('Review confirmed for this immutable proposal.');
  };
  const apply = async () => {
    if (!active || !displayOwned || !proposal || !reviewId || !applyKey || !effectiveCanApply || stale) return;
    const current = operation.current;
    const result = await pf.action(`/proposals/${proposal.id}/apply`, { idempotencyKey: applyKey, reviewId, expectedCableWriteRevision: proposal.cableWriteRevision });
    if (result && operation.current === current) { setApplied(true); setNotice('Routing and design length applied together. Installed length was preserved.'); }
  };
  const summary = data?.proposals.find(value => value.id === proposal?.id), stale = proposal?.stale || summary?.stale || false;
  const preferencesMatch = options === undefined || Boolean(options && proposal?.routingPreferences && options.secondaryDistanceMeters === proposal.routingPreferences.secondaryDistanceMeters && options.preferVerticalApproach === proposal.routingPreferences.preferVerticalApproach);
  const effectiveCanApply = preferencesMatch && (summary && summary.proposalHash === proposal?.proposalHash ? summary.canApply : proposal?.canApply);
  reviewContext.current = JSON.stringify([active, displayOwned, selectedCableId, data?.activeModel, data?.registryRevision, settingsKey, optionsKey, selectedRevision, proposal?.id, proposal?.proposalHash, stale, effectiveCanApply]);
  const proposals = (data?.proposals ?? []).filter(value => !selectedCableId || value.cableId === selectedCableId);
  return <section className={styles.result} aria-label="Path Finder calculations">
    <h3>Calculate and review</h3>
    <Body1>Ready cables are calculated automatically as proposals.</Body1>
    <Caption1>Calculations use the active model, shared locations, connection gap and allowances from Project Details. Instrumentation follows Control.</Caption1>
    <div className={styles.actions}>
      <Button disabled={options === null || !data?.artifacts.length || pf.busy || !data.cables.length || data.cables.length > 10000} onClick={() => void (options ? pf.calculate(undefined, true, options) : pf.calculate(undefined, true))}>Calculate all cables</Button>
      <Button disabled={options === null || !data?.artifacts.length || pf.busy || !selectedCableId} onClick={() => void (options ? pf.calculate([selectedCableId!], true, options) : pf.calculate([selectedCableId!], true))}>Calculate selected cable</Button>
    </div>
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
      {proposals.slice(0, 30).map(item => <li key={item.id}><Button disabled={pf.busy} aria-pressed={proposal?.id === item.id} onClick={() => void openProposal(item.id)}>
        {data?.cables.find(cable => cable.id === item.cableId)?.tag ?? 'Cable'} — {item.stale ? 'Outdated' : resultLabel(item.status)}{item.synthetic ? ' — local synthetic fixture' : ''}
      </Button></li>)}
    </ul>
    {proposal ? <section className={styles.result} aria-label="Proposal review" data-testid="pathfinder-proposal" data-stale={String(stale)}>
      <h4>Proposal review</h4>
      <Body1>Cable: {data?.cables.find(cable => cable.id === proposal.cableId)?.tag ?? proposal.cableId}</Body1>
      <Body1>{proposal.synthetic ? 'Local synthetic fixture for demonstration.' : 'Review the route and length before applying.'}</Body1>
      {stale ? <Body1 role="alert">This result is outdated. Calculate a new proposal before reviewing or applying it.</Body1> : null}
      <Body1>{proposal.message}</Body1>
      {proposal.routingPreferences ? <Caption1>Calculated with SECONDARY trigger {proposal.routingPreferences.secondaryDistanceMeters} m; vertical approach {proposal.routingPreferences.preferVerticalApproach ? 'preferred' : 'not preferred'}.</Caption1> : <Caption1>The original routing preferences are unavailable.</Caption1>}
      {options !== null && !preferencesMatch ? <Body1 role="alert">This proposal uses different routing preferences. Calculate a new proposal with the current Path values before reviewing or applying.</Body1> : null}
      {proposal.compatibilityIssue ? <Body1 role="alert">{proposal.compatibilityIssue}</Body1> : null}
      {proposal.route ? <><Body1>Geometric length: {proposal.route.lengthMeters} m</Body1><Caption1>From approach: {proposal.route.fromDistanceMeters} m{proposal.route.fromRequiresSecondary ? ' (SECONDARY)' : ''}; To approach: {proposal.route.toDistanceMeters} m{proposal.route.toRequiresSecondary ? ' (SECONDARY)' : ''}</Caption1><Caption1>Connection gaps: {proposal.route.connectionGapCount}; total gap length: {proposal.route.connectionGapLengthMeters} m</Caption1><details><summary>Exact route text</summary><p style={{ overflowWrap: 'anywhere' }}>{proposal.route.routeText}</p></details></> : null}
      {proposal.design ? <><Body1>Before percentage: {proposal.design.lengthBeforePercentageMeters} m</Body1><Caption1>Before rounding: {proposal.design.unroundedLengthMeters} m</Caption1><Body1>Design length: {proposal.design.designLengthMeters} m</Body1></> : null}
      <Caption1>Installed length is not changed by Apply.</Caption1>
      <div className={styles.actions}>
        <Button disabled={!active || !displayOwned || pf.busy || stale || !pathDisplayed || !effectiveCanApply || Boolean(reviewId)} onClick={() => void confirmReview()}>Confirm proposal review</Button>
        <Button appearance="primary" disabled={!active || !displayOwned || pf.busy || stale || !reviewId || !effectiveCanApply || applied} onClick={() => void apply()}>Apply reviewed result</Button>
      </div>
      {!effectiveCanApply && !stale ? <Caption1>{proposal.engineeringMessage}</Caption1> : null}
    </section> : null}
  </section>;
}
