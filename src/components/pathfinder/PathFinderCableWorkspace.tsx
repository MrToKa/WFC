import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Portal } from '@fluentui/react-components';
import { requestFloatingCableWindow, type FloatingCableWindowRequest } from '@/hooks/useFloatingCablePanel';
import { useCableInformationPanelStyles } from '@/pages/ProjectDetails/CableInformationPanel.styles';
import type { PathFinderPreferences } from '@/api/pathfinder';
import { sameBarrierAdmissionIntent } from '../../../shared/pathfinderBarrierAdmission';
import { fetchPathFinderCableWorkflowDetail, type CableWorkflowRow } from '@/api/pathfinderCableWorkflow';
import { fetchLocationImpacts } from '@/api/pathfinderLocationImpacts';
import type { CableEndpointReceipt } from '@/api/pathfinderCableEndpoints';
import { usePathfinderLocationImpactProgress } from '@/hooks/usePathfinderLocationImpactProgress';
import { usePathfinderInitialFillProgress } from '@/hooks/usePathfinderInitialFillProgress';
import type { EndpointCurrentScope } from '../../../shared/pathfinderEndpointBindings';
import type { LocationImpactCalculation } from '../../../shared/pathfinderLocationImpacts';
import { classifyCableWorkflow } from '../../../shared/pathfinderCableWorkflow';
import type { usePathFinder } from '@/pages/ProjectDetails/hooks/usePathFinder';
import type { PathFinderWorkflowDisplay, PathFinderWorkflowReview } from '@/pages/ProjectDetails/PathFinderResults';
import { cableWorkflowReason, PathFinderNeedsRoutingList } from './PathFinderNeedsRoutingList';
import { PathFinderCableRoutingPanel } from './PathFinderCableRoutingPanel';

type Access = { projectId: string | null; loadedProjectId: string | null; accountId: string | null; token: string | null; isAdmin: boolean };
export type PathFinderCableWorkspaceProps = Access & { pf: ReturnType<typeof usePathFinder>; active: boolean;
  preferences: PathFinderPreferences | null; selectedCableId?: string | null; refreshKey?: number; onSelect: (row: CableWorkflowRow) => void;
  display?: PathFinderWorkflowDisplay; onTogglePath?: (cableId: string) => void; review?: PathFinderWorkflowReview | null;
  onCalculationStart?: (cableId: string) => void };
type Impact = { id: string; current: EndpointCurrentScope; calculation: LocationImpactCalculation | null; originCableId: string | null };

/** One account/model/preferences owns this workspace. No action here uses full-state polling. */
export function PathFinderCableWorkspace(props: PathFinderCableWorkspaceProps) {
  const access = props.pf.preparationAccess, model = props.pf.data?.activeModel;
  const owner = JSON.stringify([props.projectId, props.loadedProjectId, props.accountId, props.token, props.isAdmin, model, props.preferences]);
  if (!props.isAdmin || !props.accountId || !props.token || !props.projectId || props.projectId !== props.loadedProjectId
    || access?.projectId !== props.projectId || access.loadedProjectId !== props.projectId || access.token !== props.token || !access.isAdmin) return null;
  return <OwnedWorkspace key={owner} {...props} owner={owner} />;
}
function OwnedWorkspace(props: PathFinderCableWorkspaceProps & { owner: string }) {
  const [selected, setSelected] = useState<CableWorkflowRow | null>(null), [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null), [revision, setRevision] = useState(0), [notice, setNotice] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [submittedCalculation, setSubmittedCalculation] = useState<{ cableId: string; jobId: string | null;
    previousJobId: string | null; previousProposalId: string | null } | null>(null);
  const submittedRef = useRef(submittedCalculation); submittedRef.current = submittedCalculation;
  const [popup, setPopup] = useState<FloatingCableWindowRequest | null>(null), popupRef = useRef<FloatingCableWindowRequest | null>(null);
  const [preview, setPreview] = useState<{ row: CableWorkflowRow; anchor: HTMLElement } | null>(null);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null), leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimers = useCallback(() => { if (dwell.current) clearTimeout(dwell.current); if (leave.current) clearTimeout(leave.current); dwell.current = null; leave.current = null; }, []);
  const dismissPreview = useCallback(() => { stopTimers(); setPreview(null); }, [stopTimers]);
  const leavePreview = useCallback(() => { if (dwell.current) clearTimeout(dwell.current); dwell.current = null; if (leave.current) clearTimeout(leave.current);
    leave.current = setTimeout(() => { setPreview(null); leave.current = null; }, 150); }, []);
  const keepPreview = useCallback(() => { if (leave.current) clearTimeout(leave.current); leave.current = null; }, []);
  const previewCable = (row: CableWorkflowRow, anchor: HTMLElement) => {
    stopTimers(); if (open || !enabled) return;
    dwell.current = setTimeout(() => { dwell.current = null; if (callbacks.current.active && anchor.isConnected) setPreview({ row, anchor }); }, 1000);
  };
  const openCable = (row: CableWorkflowRow) => {
    if (!enabled || row.projectId !== props.projectId || !['LV', 'Control', 'Instrumentation'].includes(row.mto ?? '')) return;
    // User activation belongs to this click, before the editor is mounted.
    const request = requestFloatingCableWindow({ title: row.cable.tag || 'Cable routing' }, popupRef.current);
    popupRef.current = request; setPopup(request); dismissPreview();
    read.current?.abort(); setSelected(row); selectedRef.current = row; setOpen(true); setNotice(null);
    setSubmittedCalculation(previous => previous?.cableId === row.cable.id ? previous : null); props.onSelect(row);
  };
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const callbacks = useRef(props); callbacks.current = props;
  const alive = useRef(false), read = useRef<AbortController | null>(null), historyRead = useRef<AbortController | null>(null);
  const lastCalculation = useRef(''), lastWrite = useRef('');
  const lastExternalRefresh = useRef(props.refreshKey);
  const model = props.pf.data?.activeModel, preferences = props.preferences;
  const barrierPreferenceKey = JSON.stringify(preferences?.barrierRouting);
  const enabled = props.active && props.pf.viewerPhase === 'ready' && Boolean(preferences && model?.modelVersionId);
  const calculation = preferences ? { preferences, timeoutMilliseconds: 120000 } : null;
  const authorityLost = useCallback(() => callbacks.current.pf.refresh(), []);
  const refreshSelected = useCallback(async () => {
    const row = selectedRef.current, current = callbacks.current;
    if (!alive.current || !row || !current.active || !current.preferences || !current.projectId || !current.token) return;
    read.current?.abort(); const ticket = new AbortController(); read.current = ticket;
    try {
      const detail = await fetchPathFinderCableWorkflowDetail(current.projectId, current.token, row.cable.id, current.preferences, ticket.signal);
      if (!alive.current || ticket.signal.aborted || read.current !== ticket || selectedRef.current?.cable.id !== row.cable.id || !callbacks.current.active
        || callbacks.current.selectedCableId !== undefined && callbacks.current.selectedCableId !== row.cable.id) return;
      setSelected(detail.row); current.onSelect(detail.row);
      const submitted = submittedRef.current, observed = detail.row.calculation;
      if (submitted?.cableId === row.cable.id && (submitted.jobId ? observed.jobId === submitted.jobId : observed.jobId !== null && observed.jobId !== submitted.previousJobId)
        && ['complete', 'failed', 'cancelled'].includes(observed.jobStatus ?? '')
        && (observed.outcome !== 'calculated' || observed.proposalId !== submitted.previousProposalId)) setSubmittedCalculation(null);
    } catch { if (alive.current && !ticket.signal.aborted) setNotice('The saved operation is retained. Refresh this cable to check its current routing state.'); }
    finally { if (read.current === ticket) read.current = null; }
  }, []);
  const refreshDiagnostics = useCallback(() => { if (alive.current) { setRevision(value => value + 1); void refreshSelected(); } }, [refreshSelected]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; read.current?.abort(); historyRead.current?.abort(); stopTimers();
    if (popupRef.current?.window && !popupRef.current.window.closed) popupRef.current.window.close(); }; }, [stopTimers]);
  useEffect(() => { if (!props.active) { dismissPreview(); if (popupRef.current?.window && !popupRef.current.window.closed) popupRef.current.window.close(); } }, [props.active, dismissPreview]);
  useEffect(() => {
    if (lastExternalRefresh.current === props.refreshKey) return;
    if (!props.active) return;
    lastExternalRefresh.current = props.refreshKey; refreshDiagnostics();
  }, [props.active, props.refreshKey, refreshDiagnostics]);
  useEffect(() => {
    if (!props.active) read.current?.abort();
    if (props.selectedCableId !== undefined && selectedRef.current && props.selectedCableId !== selectedRef.current.cable.id) {
      read.current?.abort(); selectedRef.current = null; setSelected(null); setOpen(false);
      setSubmittedCalculation(null);
    }
  }, [props.active, props.selectedCableId]);
  // Restore only the most recent matching owned impact from a bounded history page.
  // Its original authority is never renewed by this GET or a browser reload.
  useEffect(() => {
    if (!enabled || impact || !props.projectId || !props.token || !props.accountId || !preferences) return;
    const expectedBarrierIntent: unknown = barrierPreferenceKey === undefined ? undefined : JSON.parse(barrierPreferenceKey);
    const ticket = new AbortController(); historyRead.current = ticket;
    void fetchLocationImpacts(props.projectId, props.token, props.accountId, { limit: 25 }, ticket.signal).then(page => {
      if (!alive.current || ticket.signal.aborted || historyRead.current !== ticket) return;
      const found = page.impacts.find(item => item.modelVersionId === model?.modelVersionId && item.selectionRevision === model?.selectionRevision
        && item.contentFingerprint === model?.contentFingerprint && item.calculation?.preferences.secondaryDistanceMeters === preferences.secondaryDistanceMeters
        && item.calculation.preferences.preferVerticalApproach === preferences.preferVerticalApproach
        && sameBarrierAdmissionIntent((item.calculation.preferences as PathFinderPreferences).barrierRouting, expectedBarrierIntent));
      if (found) setImpact({ id: found.id, current: found.current, calculation: found.calculation, originCableId: null });
    }).catch(() => { /* Explicit progress refresh remains available; no automatic retry storm. */ });
    return () => { ticket.abort(); if (historyRead.current === ticket) historyRead.current = null; };
  }, [enabled, impact, props.projectId, props.token, props.accountId, model?.modelVersionId, model?.selectionRevision, model?.contentFingerprint, preferences?.secondaryDistanceMeters, preferences?.preferVerticalApproach, barrierPreferenceKey]);
  const calculationChanged = useCallback((value: NonNullable<ReturnType<typeof usePathfinderLocationImpactProgress>['impact']>) => {
      const key = JSON.stringify([value.id, value.status, value.completed, value.readyCables, value.blockedCables]);
      if (key === lastCalculation.current) return; lastCalculation.current = key;
      if (['complete', 'blocked', 'superseded', 'cancelled', 'failed', 'awaiting-authority', 'restore-fenced'].includes(value.status)) refreshDiagnostics();
  }, [refreshDiagnostics]);
  const writeChanged = useCallback((value: NonNullable<ReturnType<typeof usePathfinderInitialFillProgress>['progress']>) => {
      const key = JSON.stringify([value.impactId, value.outstanding, value.counters]);
      if (key === lastWrite.current) return; lastWrite.current = key;
      if (!value.outstanding || value.counters.written + value.counters['already-written'] > 0) refreshDiagnostics();
  }, [refreshDiagnostics]);
  const progress = usePathfinderLocationImpactProgress({ ...props, active: enabled && Boolean(impact), current: impact?.current ?? null,
    calculation: impact?.calculation ?? null, impactId: impact?.id ?? null, onAuthorityLost: authorityLost, onChanged: calculationChanged });
  const writes = usePathfinderInitialFillProgress({ ...props, active: enabled && Boolean(impact), impactId: impact?.id ?? null,
    cableId: selected?.cable.id === impact?.originCableId ? selected?.cable.id ?? null : null, onAuthorityLost: authorityLost, onChanged: writeChanged });
  // First reads may already be terminal: observing them must also refresh the
  // receipt-backed cable row, without waiting for a change that will never come.
  useEffect(() => { if (progress.impact) calculationChanged(progress.impact); }, [progress.impact, calculationChanged]);
  useEffect(() => { if (writes.progress) writeChanged(writes.progress); }, [writes.progress, writeChanged]);
  const saved = useCallback((receipt: CableEndpointReceipt, current?: EndpointCurrentScope, originalCalculation?: LocationImpactCalculation | null) => {
    if (!alive.current) return;
    setNotice('Shared location saved. Only affected non-MV cables will be recalculated. Existing cable values require review.');
    if (receipt.locationImpact && current) { lastCalculation.current = ''; lastWrite.current = ''; setImpact({ id: receipt.locationImpact.id, current, calculation: originalCalculation ?? null, originCableId: receipt.cableId }); }
    refreshDiagnostics();
  }, [refreshDiagnostics]);
  const selectedStatus = selected ? classifyCableWorkflow(selected) : null;
  // Follow only an explicitly submitted selected-cable calculation. This is a
  // bounded read of its current metadata, never a second calculation or write.
  useEffect(() => {
    if (!submittedCalculation || calculating || !enabled || !props.projectId || !props.token || !preferences) return;
    const submitted = submittedCalculation, projectId = props.projectId, token = props.token, ticket = new AbortController();
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, reads = 0;
    const deadline = Date.now() + 120000;
    const poll = async () => {
      try {
        const detail = await fetchPathFinderCableWorkflowDetail(projectId, token, submitted.cableId, preferences, ticket.signal);
        const current = callbacks.current;
        if (stopped || ticket.signal.aborted || !alive.current || !current.active || selectedRef.current?.cable.id !== submitted.cableId
          || current.selectedCableId !== undefined && current.selectedCableId !== submitted.cableId) return;
        if (detail.projectId !== projectId || detail.cableId !== submitted.cableId || detail.row.projectId !== projectId || detail.row.cable.id !== submitted.cableId)
          throw new Error('CALCULATION_SCOPE_CHANGED');
        const observed = detail.row.calculation, ownsNewJob = submitted.jobId ? observed.jobId === submitted.jobId
          : observed.jobId !== null && observed.jobId !== submitted.previousJobId;
        if (ownsNewJob) {
          setSelected(detail.row); selectedRef.current = detail.row; current.onSelect(detail.row);
          if (['complete', 'failed', 'cancelled'].includes(observed.jobStatus ?? '')) {
            if (observed.outcome === 'calculated' && observed.proposalId === submitted.previousProposalId) throw new Error('EARLIER_PROPOSAL_RETAINED');
            setSubmittedCalculation(null); setRevision(value => value + 1);
            setNotice(observed.jobStatus === 'complete' ? 'The new calculation is ready. Compare the current and proposed values in this cable window, then use Show, Review and Apply.'
              : 'The new calculation stopped without an applicable result. Existing Cable list values were retained.');
            return;
          }
        }
        reads++;
        if (reads >= 80 || Date.now() >= deadline) { setNotice('The calculation outcome is not confirmed. Refresh the selected cable to inspect its current job; no new calculation or Apply was sent.'); return; }
        timer = setTimeout(() => void poll(), 1500);
      } catch (error) {
        if (!stopped && !ticket.signal.aborted && error && typeof error === 'object' && 'status' in error && [401, 403].includes(Number(error.status))) authorityLost();
        if (!stopped && !ticket.signal.aborted && alive.current) setNotice('The new calculation could not be checked. Refresh this cable before reviewing a result. Existing values were retained.');
      }
    };
    void poll();
    return () => { stopped = true; ticket.abort(); if (timer) clearTimeout(timer); };
  }, [submittedCalculation, calculating, enabled, props.projectId, props.token, barrierPreferenceKey,
    preferences?.secondaryDistanceMeters, preferences?.preferVerticalApproach, authorityLost]);
  const calculateSelected = async () => {
    const row = selectedRef.current, current = callbacks.current;
    if (!enabled || calculating || submittedRef.current || !row || !current.preferences || row.calculation.jobStatus === 'queued' || row.calculation.jobStatus === 'running') return;
    const submitted = { cableId: row.cable.id, jobId: null as string | null, previousJobId: row.calculation.jobId, previousProposalId: row.calculation.proposalId };
    submittedRef.current = submitted;
    setSubmittedCalculation(submitted); setCalculating(true); setNotice(null); current.onCalculationStart?.(row.cable.id);
    try {
      const result = await current.pf.calculate([row.cable.id], true, current.preferences);
      if (alive.current && selectedRef.current?.cable.id === row.cable.id) setSubmittedCalculation({ ...submitted,
        jobId: result && typeof result.jobId === 'string' ? result.jobId : null });
    }
    catch { if (alive.current && selectedRef.current?.cable.id === row.cable.id) setNotice('Routing could not be calculated. Refresh this cable and try again.'); }
    finally { if (alive.current) setCalculating(false); }
  };
  const popupReview = props.review && selected && props.review.cableId === selected.cable.id
    && (props.review.pending || !submittedCalculation && props.review.proposalId === selected.calculation.proposalId) ? props.review : null;
  return <section aria-label="Cable routing workspace">
    <PathFinderNeedsRoutingList {...props} active={enabled} modelScopeKey={JSON.stringify([props.owner, revision])}
      preferences={preferences ?? { secondaryDistanceMeters: 2, preferVerticalApproach: true }} selectedCableId={selected?.cable.id ?? null}
      onAuthorityLost={authorityLost} onSelect={openCable} onPreview={previewCable} onPreviewLeave={leavePreview} />
    {preview && !open && props.active ? <CableHoverPreview row={preview.row} anchor={preview.anchor} onEnter={keepPreview} onLeave={leavePreview}
      onClose={dismissPreview} onOpen={() => openCable(preview.row)} /> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {selected ? <p role="status">Selected cable: {selected.cable.tag ?? 'Untagged cable'} — {selectedStatus?.status === 'up-to-date' ? 'Updated in Cable list'
      : selectedStatus?.status === 'ready-for-review' ? 'Ready for review; existing values remain until Apply' : selectedStatus?.status === 'calculating' ? 'Recalculating' : 'Needs routing or attention'}.</p> : null}
    {selected && !open ? <Button onClick={() => openCable(selected)}>Open selected cable</Button> : null}
    {selected ? <Button disabled={!enabled} onClick={() => { refreshDiagnostics(); void progress.refresh(); void writes.refresh(); }}>Refresh selected cable</Button> : null}
    {impact ? <section aria-label="Affected cable progress">
      <h4>Shared location progress</h4>
      {progress.impact ? <p role="status">{progress.impact.status === 'complete' ? 'Calculation complete' : progress.impact.status.replaceAll('-', ' ')}: {progress.impact.completed} / {progress.impact.total} affected cables.</p> : <p>Reading affected calculation…</p>}
      {progress.error ? <p role="alert">{progress.error}</p> : null}
      {writes.progress ? <p role="status">Cable list updates: {writes.progress.counters.written + writes.progress.counters['already-written']} written; {writes.progress.counters['review-required']} require review.
        {writes.progress.outstanding ? ' Automatic updates are still being processed.' : ' Automatic update processing has stopped.'}</p> : null}
      {writes.progress?.selected?.reasonCode ? <p>Update needs attention: {writes.progress.selected.reasonCode.toLowerCase().replaceAll('_', ' ')}.</p> : null}
      {writes.error ? <p role="alert">{writes.error}</p> : null}
      <details><summary>Advanced progress details</summary><p>Calculation and conditional initial fill are separate. Updated is shown only after live cable evidence confirms the receipt-backed values.</p>
        <p>History reads do not renew the original administrator permission.</p>
        {progress.impact?.reasonCodes.map(code => <p key={code}>{code}</p>)}
      </details>
    </section> : null}
    <PathFinderCableRoutingPanel requestedPopup={popup} cable={selected} open={open && props.active} onClose={() => setOpen(false)} access={{ ...props,
      active: enabled, model: model?.modelVersionId && model.contentFingerprint ? { modelVersionId: model.modelVersionId,
        selectionRevision: model.selectionRevision, contentFingerprint: model.contentFingerprint } : null,
      preparationKey: JSON.stringify([props.pf.preparationViewerGeneration, props.pf.data?.artifacts.map(item => [item.id, item.snapshotSha256])]),
      calculation, initialFill: { mode: 'when-both-empty' }, readSelection: props.pf.readSelection, onSaved: saved, onAuthorityLost: authorityLost,
    }} onCalculate={enabled && !submittedCalculation && selected?.calculation.jobStatus !== 'queued' && selected?.calculation.jobStatus !== 'running' ? calculateSelected : undefined}
      onTogglePath={selected && props.onTogglePath ? () => props.onTogglePath?.(selected.cable.id) : undefined}
      pathVisible={props.display?.cableId === selected?.cable.id && props.display?.visible}
      calculatedRouting={props.display?.cableId === selected?.cable.id ? props.display?.routing : undefined}
      calculatedDesignLength={props.display?.cableId === selected?.cable.id ? props.display?.designLength : undefined}
      review={popupReview}
      calculationPending={submittedCalculation?.cableId === selected?.cable.id}
      actionsBusy={calculating || props.pf.busy} />
  </section>;
}

/** Hover is a read-only preview. It never reads selection, changes the route or replaces an editor draft. */
function CableHoverPreview({ row, anchor, onEnter, onLeave, onClose, onOpen }: { row: CableWorkflowRow; anchor: HTMLElement;
  onEnter: () => void; onLeave: () => void; onClose: () => void; onOpen: () => void }) {
  const styles = useCableInformationPanelStyles(), rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right + 12, window.innerWidth - 436)), top = Math.max(8, Math.min(rect.top, window.innerHeight - 300));
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); } };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape); }, [onClose]);
  return <Portal><div role="dialog" aria-modal="false" aria-label={row.cable.tag || 'Cable preview'} className={styles.panel}
    style={{ left, top, width: 'min(420px, calc(100vw - 16px))', maxHeight: 'calc(100vh - 16px)' }}
    onPointerEnter={onEnter} onPointerLeave={onLeave} onFocus={onEnter} onBlur={onLeave} data-cable-preview="true">
    <h3 className={styles.heading}>{row.cable.tag || 'Cable preview'}</h3>
    <p>From: {row.cable.fromLocation || 'No location name'}<br />To: {row.cable.toLocation || 'No location name'}</p>
    <p>{cableWorkflowReason(row)}</p><p>Routing: {row.cable.routing || 'Not set'}<br />Design length: {row.cable.designLength ?? 'Not set'} m</p>
    <div className={styles.actions}><Button onClick={onOpen}>Open cable in separate window</Button><Button onClick={onClose}>Close preview</Button></div>
  </div></Portal>;
}
