import { useEffect, useRef, useState } from 'react';
import { Body1, Button, Caption1, Field, Input, Spinner } from '@fluentui/react-components';
import type { PathFinderPreferences, PathFinderPreview as Preview, PathFinderPreviewInput } from '@/api/pathfinder';
import { isCanonicalPoint, MAX_PATH_POINTS, type CanonicalPoint } from '../../../viewer-runtime/protocol.mjs';
import type { usePathFinder } from './hooks/usePathFinder';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';

type Endpoint = { name: string; coordinates: [string, string, string] };
type Props = { pf: ReturnType<typeof usePathFinder>; active: boolean; displayOwned: boolean; claimViewer: () => () => boolean; options: PathFinderPreferences | null; onInputChange: () => void; onEndpointNamesChange: (names: string[]) => void };
const emptyEndpoint = (): Endpoint => ({ name: '', coordinates: ['', '', ''] });
function endpointInput(value: Endpoint): { name: string; point?: CanonicalPoint } | null {
  const name = value.name.trim(); if (name.length > 500) return null;
  if (value.coordinates.every(coordinate => !coordinate.trim())) return name ? { name } : null;
  const point = value.coordinates.map(coordinate => coordinate.trim() ? Number(coordinate) : NaN);
  return isCanonicalPoint(point) ? { name, point } : null;
}

/** Standalone native-style path calculation never writes cable endpoints or cable lengths. */
export function PathFinderPreview({ pf, active, displayOwned, claimViewer, options, onInputChange, onEndpointNamesChange }: Props) {
  const styles = useRoutingsViewerStyles(), latest = useRef(pf); latest.current = pf;
  const generation = useRef(0), displayGuard = useRef<() => boolean>(() => false);
  const [from, setFrom] = useState<Endpoint>(emptyEndpoint), [to, setTo] = useState<Endpoint>(emptyEndpoint), [category, setCategory] = useState<PathFinderPreviewInput['category']>('LV');
  const [jobId, setJobId] = useState<string | null>(null), [preview, setPreview] = useState<Preview | null>(null), [working, setWorking] = useState(false), [cancelRequested, setCancelRequested] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const dependencyKey = JSON.stringify([pf.data?.activeModel, pf.data?.registryRevision, pf.data?.settings, pf.data?.artifacts.map(artifact => artifact.id), options]);
  useEffect(() => { onEndpointNamesChange([...new Set([from.name.trim(), to.name.trim()].filter(Boolean))]); }, [from.name, to.name, onEndpointNamesChange]);
  useEffect(() => { generation.current++; setJobId(null); setPreview(null); setWorking(false); setCancelRequested(false); setNotice(null); return () => { generation.current++; }; }, [active, dependencyKey]);
  useEffect(() => { if (!displayOwned) { generation.current++; setJobId(null); setPreview(null); setWorking(false); setNotice(null); } }, [displayOwned]);
  const invalidate = () => { generation.current++; setJobId(null); setPreview(null); setWorking(false); setCancelRequested(false); setNotice(null); };
  const setEndpoint = (side: 'from' | 'to', value: Endpoint) => { onInputChange(); invalidate(); (side === 'from' ? setFrom : setTo)(value); };
  const assignSelection = async (side: 'from' | 'to') => {
    if (!active || pf.busy || working) return;
    const current = ++generation.current; setWorking(true); setNotice(null);
    try {
      const selection = await pf.readSelection(); if (generation.current !== current) return;
      if (selection?.objects.length !== 1 || !selection.objects[0].bottomCentre) { setNotice('Select exactly one model object with geometry for this endpoint.'); return; }
      const object = selection.objects[0]; setEndpoint(side, { name: object.name, coordinates: object.bottomCentre!.map(String) as Endpoint['coordinates'] });
      setNotice(`${side === 'from' ? 'From' : 'To'} uses the selected object’s bounding-box bottom centre. Confirm the point before calculating.`);
    } finally { if (generation.current === current) setWorking(false); }
  };
  const run = async (input?: PathFinderPreviewInput) => {
    if (!active || !options || pf.busy) return;
    const fromInput = endpointInput(from), toInput = endpointInput(to);
    if (!input && (!fromInput || !toInput)) return;
    const current = ++generation.current; displayGuard.current = claimViewer(); setPreview(null); setJobId(null); setWorking(true); setCancelRequested(false); setNotice(null);
    try {
      const id = await pf.startPreview(input ?? { from: fromInput!, to: toInput!, category, reverse: false, ...options });
      if (generation.current === current && displayGuard.current() && id) setJobId(id);
    } finally { if (generation.current === current) setWorking(false); }
  };
  useEffect(() => {
    if (!jobId || !active) return;
    const current = generation.current; let closed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const result = await latest.current.readPreview(jobId);
      if (closed || current !== generation.current || !displayGuard.current()) return;
      if (!result) { setJobId(null); setNotice('The path preview could not be read. Refresh access and calculate again.'); return; }
      setPreview(result);
      if (result.status === 'queued' || result.status === 'running') { timer = setTimeout(() => void poll(), 1500); return; }
      if (result.result?.stale) { setNotice('The model, locations or project values changed. Calculate a fresh path.'); return; }
      const route = result.result?.route;
      if (result.status !== 'complete' || !route?.success) return;
      if (route.points.length < 1 || route.points.length > MAX_PATH_POINTS) { setNotice('The exact path exceeds the viewer point budget. Its result is retained without truncation.'); return; }
      const objectIds = [...new Set(route.objectIds.filter(value => /^dbid:[1-9][0-9]*$/.test(value)).map(value => Number(value.slice(5))))];
      if (objectIds.length > 512) { setNotice('The exact path exceeds the viewer object budget. Its result is retained without truncation.'); return; }
      setWorking(true);
      try {
        const displayed = await latest.current.showPath({ pathId: result.id, points: route.points, objectIds });
        if (!closed && current === generation.current && displayGuard.current()) setNotice(displayed ? 'The exact standalone path is displayed. Review its route and length.' : 'The result is retained. Reload the model and calculate again to display it.');
      } finally { if (!closed && current === generation.current) setWorking(false); }
    };
    void poll(); return () => { closed = true; clearTimeout(timer); };
  }, [active, jobId]);
  const pending = Boolean(jobId && (!preview || ['queued', 'running'].includes(preview.status)));
  const endpointsValid = Boolean(endpointInput(from) && endpointInput(to));
  return <section className={styles.result} aria-label="Standalone path">
    <h3>Find path</h3>
    <Caption1>Use equipment names, saved shared locations, selected model objects or explicit coordinates. Names without coordinates use confirmed shared locations or prepared equipment candidates. After entering new equipment names, prepare routes in Routes so those names are included.</Caption1>
    {(['from', 'to'] as const).map(side => {
      const value = side === 'from' ? from : to, title = side === 'from' ? 'From' : 'To';
      return <fieldset key={side} disabled={working || pending || pf.busy}><legend>{title}</legend>
        <Field label={`${title} location`}><Input aria-label={`Path ${title} location`} maxLength={500} value={value.name} onChange={(_, input) => setEndpoint(side, { ...value, name: input.value })} /></Field>
        <Field label={`${title} saved location`}><select aria-label={`Path ${title} saved location`} value="" onChange={event => { const location = pf.data?.locations.find(item => item.id === event.target.value); if (location) setEndpoint(side, { name: location.name, coordinates: ['', '', ''] }); }}>
          <option value="">Choose a shared location</option>{pf.data?.locations.map(location => <option key={location.id} value={location.id}>{location.name}{location.binding?.status === 'stale' ? ' — stale' : ''}</option>)}
        </select></Field>
        <Button disabled={!active || pf.viewerPhase !== 'ready'} onClick={() => void assignSelection(side)}>Use selection as {title}</Button>
        <details><summary>{title} coordinates (metres)</summary><Caption1>Leave all coordinates blank to resolve the name automatically.</Caption1>
          {(['X', 'Y', 'Z'] as const).map((axis, index) => <Field key={axis} label={`${axis} (m)`}><Input aria-label={`Path ${title} ${axis} in metres`} value={value.coordinates[index]} onChange={(_, input) => setEndpoint(side, { ...value, coordinates: value.coordinates.map((coordinate, i) => i === index ? input.value : coordinate) as Endpoint['coordinates'] })} /></Field>)}
        </details>
      </fieldset>;
    })}
    <Field label="Cable type"><select aria-label="Path cable type" value={category} disabled={working || pending || pf.busy} onChange={event => { onInputChange(); invalidate(); setCategory(event.target.value as PathFinderPreviewInput['category']); }}>
      {(['MV', 'LV', 'Control', 'Instrumentation'] as const).map(value => <option key={value} value={value}>{value}{value === 'Instrumentation' ? ' (Control rules)' : ''}</option>)}
    </select></Field>
    <div className={styles.actions}>
      <Button appearance="primary" disabled={!active || !pf.data?.artifacts.length || !options || !endpointsValid || working || pending || pf.busy} onClick={() => void run()}>Calculate path</Button>
      {preview?.result?.route?.success && !preview.result.stale ? <Button disabled={working || pending || pf.busy} onClick={() => void run({ ...preview.input, reverse: !preview.input.reverse })}>Reverse path</Button> : null}
      {pending ? <Button disabled={cancelRequested || pf.busy} onClick={() => { setCancelRequested(true); void pf.action(`/jobs/${jobId}`, undefined, 'DELETE'); }}>Cancel path calculation</Button> : null}
    </div>
    {working || pending ? <Spinner size="tiny" label={cancelRequested ? 'Waiting for the path calculation to stop…' : working ? 'Preparing or displaying the exact path…' : 'Calculating the path…'} /> : null}
    {notice ? <Body1 role="status">{notice}</Body1> : null}
    {preview ? <section className={styles.result} aria-label="Standalone path result" data-testid="pathfinder-preview" data-state={preview.status}>
      <Body1>{preview.status === 'complete' ? 'Path calculation complete' : preview.status === 'cancelled' ? 'Path calculation cancelled' : preview.status === 'failed' ? 'Path calculation failed' : 'Path calculation in progress'}</Body1>
      <Caption1>Original endpoints: From {preview.input.from.name || 'manual point'}; To {preview.input.to.name || 'manual point'}. {preview.input.reverse ? 'Reverse preview' : 'Forward preview'}.</Caption1>
      {preview.failure ? <Body1 role="alert">{preview.failure}</Body1> : null}
      {preview.result ? <><Body1>{preview.result.message}</Body1>{preview.result.stale ? <Body1 role="alert">This path is outdated. Calculate again before using it.</Body1> : null}
        {preview.result.route ? <><Body1>Geometric length: {preview.result.route.lengthMeters} m</Body1><Caption1>From approach: {preview.result.route.fromDistanceMeters} m{preview.result.route.fromRequiresSecondary ? ' (SECONDARY)' : ''}; To approach: {preview.result.route.toDistanceMeters} m{preview.result.route.toRequiresSecondary ? ' (SECONDARY)' : ''}</Caption1><Caption1>Connection gaps: {preview.result.route.connectionGapCount}; total gap length: {preview.result.route.connectionGapLengthMeters} m</Caption1><details><summary>Standalone route text</summary><p style={{ overflowWrap: 'anywhere' }}>{preview.result.route.routeText}</p></details></> : null}
        {preview.result.design ? <><Caption1>Before percentage: {preview.result.design.lengthBeforePercentageMeters} m; before rounding: {preview.result.design.unroundedLengthMeters} m</Caption1><Body1>Design length: {preview.result.design.designLengthMeters} m</Body1></> : null}
      </> : null}
      <Caption1>Standalone preview only. Cable values are changed through Calculate and review below.</Caption1>
    </section> : null}
  </section>;
}
