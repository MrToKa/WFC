import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@fluentui/react-components';
import type { PathFinderPreferences } from '@/api/pathfinder';
import { fetchPathFinderCableWorkflowDetail, type CableWorkflowRow } from '@/api/pathfinderCableWorkflow';
import { fetchLocationImpacts } from '@/api/pathfinderLocationImpacts';
import type { CableEndpointReceipt } from '@/api/pathfinderCableEndpoints';
import { usePathfinderLocationImpactProgress } from '@/hooks/usePathfinderLocationImpactProgress';
import { usePathfinderInitialFillProgress } from '@/hooks/usePathfinderInitialFillProgress';
import type { EndpointCurrentScope } from '../../../shared/pathfinderEndpointBindings';
import type { LocationImpactCalculation } from '../../../shared/pathfinderLocationImpacts';
import { classifyCableWorkflow } from '../../../shared/pathfinderCableWorkflow';
import type { usePathFinder } from '@/pages/ProjectDetails/hooks/usePathFinder';
import { PathFinderNeedsRoutingList } from './PathFinderNeedsRoutingList';
import { PathFinderCableRoutingPanel } from './PathFinderCableRoutingPanel';

type Access = { projectId: string | null; loadedProjectId: string | null; accountId: string | null; token: string | null; isAdmin: boolean };
export type PathFinderCableWorkspaceProps = Access & { pf: ReturnType<typeof usePathFinder>; active: boolean;
  preferences: PathFinderPreferences | null; selectedCableId?: string | null; refreshKey?: number; onSelect: (row: CableWorkflowRow) => void };
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
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const callbacks = useRef(props); callbacks.current = props;
  const alive = useRef(false), read = useRef<AbortController | null>(null), historyRead = useRef<AbortController | null>(null);
  const lastCalculation = useRef(''), lastWrite = useRef('');
  const lastExternalRefresh = useRef(props.refreshKey);
  const model = props.pf.data?.activeModel, preferences = props.preferences;
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
    } catch { if (alive.current && !ticket.signal.aborted) setNotice('The saved operation is retained. Refresh this cable to check its current routing state.'); }
    finally { if (read.current === ticket) read.current = null; }
  }, []);
  const refreshDiagnostics = useCallback(() => { if (alive.current) { setRevision(value => value + 1); void refreshSelected(); } }, [refreshSelected]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; read.current?.abort(); historyRead.current?.abort(); }; }, []);
  useEffect(() => {
    if (lastExternalRefresh.current === props.refreshKey) return;
    if (!props.active) return;
    lastExternalRefresh.current = props.refreshKey; refreshDiagnostics();
  }, [props.active, props.refreshKey, refreshDiagnostics]);
  useEffect(() => {
    if (!props.active) read.current?.abort();
    if (props.selectedCableId !== undefined && selectedRef.current && props.selectedCableId !== selectedRef.current.cable.id) {
      read.current?.abort(); selectedRef.current = null; setSelected(null); setOpen(false);
    }
  }, [props.active, props.selectedCableId]);
  // Restore only the most recent matching owned impact from a bounded history page.
  // Its original authority is never renewed by this GET or a browser reload.
  useEffect(() => {
    if (!enabled || impact || !props.projectId || !props.token || !props.accountId || !preferences) return;
    const ticket = new AbortController(); historyRead.current = ticket;
    void fetchLocationImpacts(props.projectId, props.token, props.accountId, { limit: 25 }, ticket.signal).then(page => {
      if (!alive.current || ticket.signal.aborted || historyRead.current !== ticket) return;
      const found = page.impacts.find(item => item.modelVersionId === model?.modelVersionId && item.selectionRevision === model?.selectionRevision
        && item.contentFingerprint === model?.contentFingerprint && item.calculation?.preferences.secondaryDistanceMeters === preferences.secondaryDistanceMeters
        && item.calculation.preferences.preferVerticalApproach === preferences.preferVerticalApproach);
      if (found) setImpact({ id: found.id, current: found.current, calculation: found.calculation, originCableId: null });
    }).catch(() => { /* Explicit progress refresh remains available; no automatic retry storm. */ });
    return () => { ticket.abort(); if (historyRead.current === ticket) historyRead.current = null; };
  }, [enabled, impact, props.projectId, props.token, props.accountId, model?.modelVersionId, model?.selectionRevision, model?.contentFingerprint, preferences?.secondaryDistanceMeters, preferences?.preferVerticalApproach]);
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
  return <section aria-label="Cable routing workspace">
    <PathFinderNeedsRoutingList {...props} active={enabled} modelScopeKey={JSON.stringify([props.owner, revision])}
      preferences={preferences ?? { secondaryDistanceMeters: 2, preferVerticalApproach: true }} selectedCableId={selected?.cable.id ?? null}
      onAuthorityLost={authorityLost} onSelect={row => { read.current?.abort(); setSelected(row); selectedRef.current = row; setOpen(true); setNotice(null); props.onSelect(row); }} />
    {notice ? <p role="status">{notice}</p> : null}
    {selected ? <p role="status">Selected cable: {selected.cable.tag ?? 'Untagged cable'} — {selectedStatus?.status === 'up-to-date' ? 'Updated in Cable list'
      : selectedStatus?.status === 'ready-for-review' ? 'Ready for review; existing values remain until Apply' : selectedStatus?.status === 'calculating' ? 'Recalculating' : 'Needs routing or attention'}.</p> : null}
    {selected && !open ? <Button onClick={() => setOpen(true)}>Open selected cable</Button> : null}
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
    <PathFinderCableRoutingPanel cable={selected} open={open && props.active} onClose={() => setOpen(false)} access={{ ...props,
      active: enabled, model: model?.modelVersionId && model.contentFingerprint ? { modelVersionId: model.modelVersionId,
        selectionRevision: model.selectionRevision, contentFingerprint: model.contentFingerprint } : null,
      preparationKey: JSON.stringify([props.pf.preparationViewerGeneration, props.pf.data?.artifacts.map(item => [item.id, item.snapshotSha256])]),
      calculation, initialFill: { mode: 'when-both-empty' }, readSelection: props.pf.readSelection, onSaved: saved, onAuthorityLost: authorityLost,
    }} />
  </section>;
}
