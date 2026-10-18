import { useEffect, useRef, useState } from 'react';
import { Body1, Button, Caption1, Field, Spinner, Textarea } from '@fluentui/react-components';
import type { PathFinderCable, PathFinderLookup as Lookup } from '@/api/pathfinder';
import { MAX_PATH_POINTS } from '../../../viewer-runtime/protocol.mjs';
import type { usePathFinder } from './hooks/usePathFinder';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';

type Props = { pf: ReturnType<typeof usePathFinder>; selectedCable?: PathFinderCable; active?: boolean; displayOwned?: boolean; claimViewer?: () => () => boolean; onInputChange?: () => void; onBusyChange?: (busy: boolean) => void };
const countText = (value: number | null | undefined) => value == null ? 'Unavailable' : String(value);

/** Independent ordered geometry lookup; the planning snapshot never gates it. */
export function PathFinderLookup({ pf, selectedCable, active = true, displayOwned = true, claimViewer, onInputChange, onBusyChange }: Props) {
  const styles = useRoutingsViewerStyles(), latest = useRef(pf); latest.current = pf;
  const [routeText, setRouteText] = useState(''), [reverse, setReverse] = useState(false), [jobId, setJobId] = useState<string | null>(null), [lookup, setLookup] = useState<Lookup | null>(null);
  const [notice, setNotice] = useState<string | null>(null), [originalEnds, setOriginalEnds] = useState<{ from: string | null; to: string | null } | null>(null);
  const [working, setWorking] = useState(false), [cancelRequested, setCancelRequested] = useState(false);
  const generation = useRef(0), displayGuard = useRef<() => boolean>(() => true), queuedJob = useRef<string | null>(null), cancelled = useRef(false), capturing = useRef(false);
  const activeModel = pf.data?.activeModel.modelVersionId, selectionRevision = pf.data?.activeModel.selectionRevision, connectionGap = pf.data?.settings.connectionGap, settingsRevision = pf.data?.settings.revision;
  const gapValid = Boolean(connectionGap && Number.isFinite(Number(connectionGap)) && Number(connectionGap) > 0 && Number(connectionGap) <= 100);
  const pending = Boolean(jobId && (!lookup || lookup.status === 'queued' || lookup.status === 'running'));
  const locked = working || pending || pf.busy;
  useEffect(() => { onBusyChange?.(locked); return () => onBusyChange?.(false); }, [locked, onBusyChange]);
  const cancelServer = (id: string) => { void latest.current.action(`/jobs/${id}`, undefined, 'DELETE'); };
  const cancelRetainedJob = () => {
    const id = queuedJob.current; queuedJob.current = null;
    if (id) cancelServer(id);
  };
  useEffect(() => {
    generation.current++; setJobId(null); setLookup(null); setNotice(null); setCancelRequested(false); setWorking(false); cancelled.current = false;
    return () => {
      generation.current++;
      if (active) latest.current.clear();
      cancelRetainedJob();
      if (capturing.current) { latest.current.cancelOperation(); capturing.current = false; }
    };
  }, [active, activeModel, selectionRevision, connectionGap, settingsRevision]);
  useEffect(() => { if (!displayOwned) { generation.current++; cancelRetainedJob(); setJobId(null); setLookup(null); setWorking(false); } }, [displayOwned]);
  const edit = () => {
    generation.current++; cancelRetainedJob(); setJobId(null); setLookup(null); setNotice(null); setCancelRequested(false); cancelled.current = false;
    onInputChange?.(); latest.current.clear();
  };
  const run = async (input = routeText, reversed = reverse, preserveLabels = false) => {
    if (!active || !activeModel || pf.viewerPhase !== 'ready' || !gapValid || !input.trim() || locked || capturing.current || queuedJob.current) return;
    displayGuard.current = claimViewer?.() ?? (() => true);
    const current = ++generation.current; setNotice(null); setLookup(null); setJobId(null); setCancelRequested(false); setWorking(true);
    cancelled.current = false; capturing.current = true; latest.current.clear();
    if (!preserveLabels) setOriginalEnds(selectedCable ? { from: selectedCable.fromLocation, to: selectedCable.toLocation } : null);
    try {
      const id = await latest.current.startLookup(input, reversed);
      if (current !== generation.current || !displayGuard.current()) { if (id) cancelServer(id); return; }
      if (id) { queuedJob.current = id; setJobId(id); }
    } finally { capturing.current = false; if (generation.current === current) setWorking(false); }
  };
  useEffect(() => {
    if (!jobId || !active) return;
    const current = generation.current; let closed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const result = await latest.current.readLookup(jobId);
      if (closed || current !== generation.current || !displayGuard.current()) return;
      if (!result) { queuedJob.current = null; setJobId(null); setNotice('The lookup could not be read. Refresh access and run it again.'); return; }
      setLookup(result);
      if (result.status === 'queued' || result.status === 'running') { timer = setTimeout(() => void poll(), 1500); return; }
      queuedJob.current = null;
      if (cancelled.current) { setNotice(result.status === 'complete' ? 'The lookup finished before cancellation. Run it again to display the result.' : 'Lookup cancelled.'); return; }
      if (result.result?.stale) { setNotice('The active model or lookup dependencies changed. Run a fresh lookup before displaying it.'); return; }
      const route = result.result?.route;
      if (result.status !== 'complete' || !route?.success) return;
      if (route.points.length < 1 || route.points.length > MAX_PATH_POINTS) { setNotice('This exact lookup path is outside the viewer point budget. The result is retained without truncation.'); return; }
      const objectIds = [...new Set(route.objectIds.filter(value => /^dbid:[1-9][0-9]*$/.test(value)).map(value => Number(value.slice(5))))];
      if (objectIds.length > 512) { setNotice('This exact lookup exceeds the viewer object budget. The result is retained without truncation.'); return; }
      setWorking(true);
      try {
        const displayed = await latest.current.showPath({ pathId: result.id, points: route.points, objectIds });
        if (!closed && current === generation.current && displayGuard.current() && !cancelled.current) setNotice(displayed ? 'The exact ordered lookup is displayed.' : 'The result is retained. Reload the model and run the lookup again to display it.');
      } finally { if (!closed && current === generation.current) setWorking(false); }
    };
    void poll(); return () => { closed = true; clearTimeout(timer); };
  }, [active, jobId]);
  const cancel = () => {
    generation.current++; cancelled.current = true; setCancelRequested(true); latest.current.cancelOperation();
    const id = queuedJob.current; queuedJob.current = null;
    setJobId(null); setLookup(null); setWorking(false);
    if (id) { cancelServer(id); setNotice('Lookup cancellation requested. The queued calculation will stop without displaying a late result.'); }
    else setNotice('Lookup preparation cancelled. Any request already accepted will also be cancelled.');
  };
  const restore = () => { edit(); latest.current.cancelOperation(); };
  const diagnostics = lookup?.result?.diagnostics;
  const unavailable = !diagnostics || Object.values(diagnostics).some(value => value == null);
  const fallbackUsed = Boolean(diagnostics && [diagnostics.fallbackBends, diagnostics.fallbackStraights, diagnostics.fallbackClearances].some(value => value != null && value > 0));
  return <section className={styles.result} aria-label="Path lookup">
    <h3>Ordered route lookup</h3>
    <Caption1>Read one ordered route directly from the active model. Routes preparation and category rules are independent. Equipment approaches, SECONDARY, cable design length and Apply are unavailable here.</Caption1>
    <Field label="Ordered route" hint="Separate exact tray identifiers with /."><Textarea aria-label="Path Finder ordered route" disabled={locked} rows={3} maxLength={8000} value={routeText} onChange={(_, value) => { edit(); setRouteText(value.value); }} /></Field>
    <Button disabled={!selectedCable?.routing || locked} onClick={() => { edit(); setRouteText(selectedCable?.routing ?? ''); setOriginalEnds(selectedCable ? { from: selectedCable.fromLocation, to: selectedCable.toLocation } : null); }}>Use cable routing for lookup</Button>
    <label><input type="checkbox" checked={reverse} disabled={locked} onChange={event => { edit(); setReverse(event.target.checked); }} /> Reverse route order</label>
    <Caption1>Connection gap: {connectionGap ?? 'Not set'} m. Change this in Project Details. Larger values permit larger unmodelled gaps.</Caption1>
    <div className={styles.actions}>
      <Button disabled={!active || !activeModel || pf.viewerPhase !== 'ready' || !routeText.trim() || !gapValid || locked} onClick={() => void run()}>Show route</Button>
      {lookup?.result?.route?.success ? <Button disabled={!active || locked || lookup.result.stale} onClick={() => { const next = !lookup.input.reverse; setReverse(next); void run(lookup.input.routeText, next, true); }}>Reverse preview</Button> : null}
      <Button disabled={!active || pf.viewerPhase !== 'ready' || locked} onClick={restore}>Restore lookup view</Button>
      {working || pending ? <Button disabled={cancelRequested} onClick={cancel}>Cancel lookup</Button> : null}
    </div>
    {working || pending ? <Spinner size="tiny" label={cancelRequested ? 'Waiting for the lookup to stop…' : working && !jobId ? 'Reading ordered geometry from the protected model…' : 'Calculating the ordered lookup…'} /> : null}
    {originalEnds ? <Caption1>Original cable labels: From {originalEnds.from || 'Not set'}; To {originalEnds.to || 'Not set'}. Reversing this preview does not edit those labels.</Caption1> : <Caption1>No cable From/To endpoints are assigned to this lookup.</Caption1>}
    {notice ? <Body1 role="status">{notice}</Body1> : null}
    {lookup ? <section className={styles.result} aria-label="Ordered lookup result" data-testid="pathfinder-lookup" data-state={lookup.status}>
      <Body1>{lookup.status === 'complete' ? 'Lookup complete' : lookup.status === 'cancelled' ? 'Lookup cancelled' : lookup.status === 'failed' ? 'Lookup failed' : 'Lookup in progress'} — {lookup.input.reverse ? 'reverse preview' : 'forward preview'}</Body1>
      {lookup.failure ? <Body1>{lookup.failure}</Body1> : null}
      {lookup.result ? <><Body1>{lookup.result.message}</Body1>{lookup.result.stale ? <Body1 role="alert">The active model or input dependencies changed. Run a fresh lookup.</Body1> : null}
        <Caption1>Connection gap used: {lookup.result.connectionGap} m</Caption1>
        {lookup.result.route ? <><Body1>Ordered network length: {lookup.result.route.lengthMeters} m</Body1><Caption1>Connection gaps: {lookup.result.route.connectionGapCount}; total gap length: {lookup.result.route.connectionGapLengthMeters} m</Caption1><details><summary>Lookup route text</summary><p style={{ overflowWrap: 'anywhere' }}>{lookup.result.route.routeText}</p></details></> : null}
        <section aria-label="Prepared lookup geometry diagnostics"><Body1>Prepared lookup geometry — leaf count: {countText(diagnostics?.geometryLeavesUsed)}</Body1><Caption1>Prepared geometry fallbacks — bends: {countText(diagnostics?.fallbackBends)}; straights: {countText(diagnostics?.fallbackStraights)}; clearances: {countText(diagnostics?.fallbackClearances)}</Caption1>
          {unavailable ? <Body1>Some prepared geometry diagnostics are unavailable. Missing counts are not assumed to be zero.</Body1> : null}
          {fallbackUsed ? <Body1 role="alert">Fallback geometry exists in the prepared lookup network and may be outside the returned route. Review the relevant geometry against the model.</Body1> : null}
        </section>
        <Caption1>This lookup does not assign cable endpoints or a design length. Apply is unavailable for ordered lookups.</Caption1></> : null}
    </section> : null}
  </section>;
}
