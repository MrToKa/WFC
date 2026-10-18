import { useEffect, useRef, useState } from 'react';
import { Body1, Button, Caption1, Field, Spinner, Textarea } from '@fluentui/react-components';
import type { PathFinderCable, PathFinderLookup as Lookup } from '@/api/pathfinder';
import { MAX_PATH_POINTS } from '../../../viewer-runtime/protocol.mjs';
import type { usePathFinder } from './hooks/usePathFinder';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';

type Props = { pf: ReturnType<typeof usePathFinder>; selectedCable?: PathFinderCable; active?: boolean; displayOwned?: boolean; claimViewer?: () => () => boolean };
export function PathFinderLookup({ pf, selectedCable, active = true, displayOwned = true, claimViewer }: Props) {
  const styles = useRoutingsViewerStyles(), latest = useRef(pf); latest.current = pf;
  const [routeText, setRouteText] = useState(''), [reverse, setReverse] = useState(false), [jobId, setJobId] = useState<string | null>(null), [lookup, setLookup] = useState<Lookup | null>(null);
  const [notice, setNotice] = useState<string | null>(null), [originalEnds, setOriginalEnds] = useState<{ from: string | null; to: string | null } | null>(null), [cancelRequested, setCancelRequested] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const generation = useRef(0), displayGuard = useRef<() => boolean>(() => true), activeModel = pf.data?.activeModel.modelVersionId, selectionRevision = pf.data?.activeModel.selectionRevision, connectionGap = pf.data?.settings.connectionGap, hasData = Boolean(pf.data), hasArtifact = Boolean(pf.data?.artifacts.length);
  useEffect(() => { generation.current++; setJobId(null); setLookup(null); setNotice(null); setCancelRequested(false); setPreviewLoading(false); latest.current.clear(); }, [active, activeModel, selectionRevision, connectionGap]);
  useEffect(() => { if (!displayOwned) { generation.current++; setJobId(null); setLookup(null); setPreviewLoading(false); } }, [displayOwned]);
  useEffect(() => {
    if (!jobId || !hasData) return;
    const current = generation.current; let closed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const result = await latest.current.readLookup(jobId);
      if (closed || current !== generation.current || !displayGuard.current()) return;
      if (!result) { setJobId(null); setNotice('The lookup could not be read. Run it again after refreshing access.'); return; }
      setLookup(result);
      if (result.status === 'queued' || result.status === 'running') { timer = setTimeout(() => void poll(), 1500); return; }
      if (result.result?.stale) { setNotice('The active model or lookup dependencies changed. Run a fresh lookup before displaying it.'); return; }
      if (result.status !== 'complete' || !result.result?.route?.success) return;
      const route = result.result.route;
      if (route.points.length < 1 || route.points.length > MAX_PATH_POINTS) { setNotice('This exact lookup path is outside the viewer point budget. The result is retained without truncation.'); return; }
      const objectIds = [...new Set(route.objectIds.filter(value => /^dbid:[1-9][0-9]*$/.test(value)).map(value => Number(value.slice(5))))];
      if (objectIds.length > 512) { setNotice('This exact lookup exceeds the viewer object budget. The result is retained without truncation.'); return; }
      setPreviewLoading(true);
      try {
        const displayed = await latest.current.showPath({ pathId: result.id, points: route.points, objectIds });
        if (!closed && current === generation.current && displayGuard.current()) setNotice(displayed ? 'The exact ordered lookup is displayed. This diagnostic preview cannot be applied to a cable.' : 'The result is retained. Reload the model and run the lookup again to display it.');
      } finally { if (!closed && current === generation.current) setPreviewLoading(false); }
    };
    void poll(); return () => { closed = true; clearTimeout(timer); };
  }, [jobId, hasData]);
  const run = async (input = routeText, reversed = reverse, preserveLabels = false) => {
    if (!active) return;
    displayGuard.current = claimViewer?.() ?? (() => true);
    const current = ++generation.current; setNotice(null); setLookup(null); setJobId(null); setCancelRequested(false); setPreviewLoading(false); latest.current.clear();
    if (!preserveLabels) setOriginalEnds(selectedCable ? { from: selectedCable.fromLocation, to: selectedCable.toLocation } : null);
    const id = await latest.current.startLookup(input, reversed);
    if (generation.current === current && id) setJobId(id);
  };
  const pending = Boolean(jobId && (!lookup || lookup.status === 'queued' || lookup.status === 'running'));
  return <details className={styles.result}>
    <summary>Manual ordered lookup and reverse preview</summary>
    <Caption1>This runs the original Path Finder ordered lookup. It does not infer equipment approaches, SECONDARY allowances or a cable design length.</Caption1>
    <Field label="Ordered route" hint="Separate exact tray identifiers with /."><Textarea aria-label="Path Finder ordered route" rows={3} maxLength={8000} value={routeText} onChange={(_, value) => setRouteText(value.value)} /></Field>
    <Button disabled={!selectedCable?.routing || pending || previewLoading || pf.busy} onClick={() => setRouteText(selectedCable?.routing ?? '')}>Use cable routing for lookup</Button>
    <label><input type="checkbox" checked={reverse} onChange={event => setReverse(event.target.checked)} /> Reverse route order</label>
    <Caption1>Connection gap: {connectionGap ?? 'Not set'} m. Change this in Project Details. Larger values permit larger unmodelled gaps.</Caption1>
    <div className={styles.actions}>
      <Button disabled={!active || !hasArtifact || !routeText.trim() || !connectionGap || pending || previewLoading || pf.busy} onClick={() => void run()}>Run ordered lookup</Button>
      {lookup?.result?.route?.success ? <Button disabled={!active || pending || previewLoading || pf.busy} onClick={() => void run(lookup.input.routeText, !lookup.input.reverse, true)}>Reverse preview</Button> : null}
      {pending ? <Button disabled={cancelRequested || pf.busy} onClick={() => { setCancelRequested(true); void pf.action(`/jobs/${jobId}`, undefined, 'DELETE'); }}>Cancel lookup</Button> : null}
    </div>
    {pending ? <Spinner size="tiny" label={cancelRequested ? 'Waiting for the lookup to stop…' : 'Calculating the ordered lookup…'} /> : null}
    {previewLoading ? <Spinner size="tiny" label="Loading the exact lookup path…" /> : null}
    {originalEnds ? <Caption1>Original cable labels: From {originalEnds.from || 'Not set'}; To {originalEnds.to || 'Not set'}. Reversing this preview does not edit those labels.</Caption1> : <Caption1>No cable From/To endpoints are assigned to this diagnostic lookup.</Caption1>}
    {notice ? <Body1 role="status">{notice}</Body1> : null}
    {lookup ? <section className={styles.result} aria-label="Ordered lookup result" data-testid="pathfinder-lookup" data-state={lookup.status}>
      <Body1>{lookup.status === 'complete' ? 'Lookup complete' : lookup.status === 'cancelled' ? 'Lookup cancelled' : lookup.status === 'failed' ? 'Lookup failed' : 'Lookup in progress'} — {lookup.input.reverse ? 'reverse preview' : 'forward preview'}</Body1>
      {lookup.failure ? <Body1>{lookup.failure}</Body1> : null}
      {lookup.result ? <><Body1>{lookup.result.message}</Body1>{lookup.result.stale ? <Body1 role="alert">The active model or input dependencies changed. Run a fresh lookup.</Body1> : null}
        {lookup.result.route ? <><Body1>Ordered network length: {lookup.result.route.lengthMeters} m</Body1><Caption1>Connection gaps: {lookup.result.route.connectionGapCount}; total gap length: {lookup.result.route.connectionGapLengthMeters} m</Caption1><details><summary>Lookup route text</summary><p style={{ overflowWrap: 'anywhere' }}>{lookup.result.route.routeText}</p></details></> : null}
        <Caption1>Diagnostic only. This lookup does not assign cable endpoints or a design length. Apply is unavailable for ordered lookups.</Caption1></> : null}
    </section> : null}
  </details>;
}
