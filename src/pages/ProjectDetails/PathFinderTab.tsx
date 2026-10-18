import { useEffect, useRef, useState } from 'react';
import { Body1, Button, Caption1, Field, Input, Spinner, Textarea, makeStyles, tokens } from '@fluentui/react-components';
import type { PathFinderCable, PathFinderLocation } from '@/api/pathfinder';
import type { CanonicalPoint, ViewerModelObject, ViewerModelObjectsPage } from '../../../viewer-runtime/protocol.mjs';
import { isCanonicalPoint } from '../../../viewer-runtime/protocol.mjs';
import { usePathFinder } from './hooks/usePathFinder';
import { useRoutingsViewerHeight } from './hooks/useRoutingsViewerHeight';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';
import { PathFinderResults } from './PathFinderResults';
import { PathFinderLookup } from './PathFinderLookup';

const useStyles = makeStyles({
  heading: { margin: 0, fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  warning: { backgroundColor: tokens.colorNeutralBackground2, padding: '0.75rem', borderRadius: tokens.borderRadiusMedium },
  form: { display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: '0.75rem' },
  coordinates: { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '0.375rem', '& input': { minWidth: 0, width: '100%' } },
  select: { maxWidth: '100%', minWidth: 0, padding: '0.5rem', color: tokens.colorNeutralForeground1, backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium },
  row: { display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%', textAlign: 'left' },
  candidate: { padding: '0.5rem', border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium },
});
type Props = { projectId: string | null; loadedProjectId: string | null; token: string | null; isAdmin: boolean };
type Draft = { locationId: string | null; name: string; aliases: string; coordinates: [string, string, string]; objectId: string | null; externalId: string | null; derivation: string; bindingDerivation: 'manual-world-point' | 'picked-surface-point' | 'equipment-bottom-aabb' };
const emptyDraft = (): Draft => ({ locationId: null, name: '', aliases: '', coordinates: ['', '', ''], objectId: null, externalId: null, derivation: 'Manual world coordinates in metres', bindingDerivation: 'manual-world-point' });
const normalized = (value: string) => value.normalize('NFC').trim().toUpperCase();
const cableLabel = (cable: PathFinderCable) => cable.tag || cable.cableId;

/** Keep all hooks and the protected frame unmounted when administrator access is absent. */
export function PathFinderTab(props: Props) {
  return props.isAdmin ? <AdminPathFinderTab {...props} /> : <Body1>PathFinder is available only to administrators.</Body1>;
}
function AdminPathFinderTab({ projectId, loadedProjectId, token, isAdmin }: Props) {
  const styles = useRoutingsViewerStyles(), extra = useStyles();
  const anchor = useRef<HTMLElement>(null), container = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const height = useRoutingsViewerHeight(anchor);
  const pf = usePathFinder({ projectId, loadedProjectId, token, isAdmin, container });
  const [search, setSearch] = useState(''), [onlyProblems, setOnlyProblems] = useState(false), [selectedCableId, setSelectedCableId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft), [notice, setNotice] = useState<string | null>(null), [localError, setLocalError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false), [query, setQuery] = useState(''), [candidates, setCandidates] = useState<ViewerModelObjectsPage | null>(null), [searching, setSearching] = useState(false);
  const [captureRoutes, setCaptureRoutes] = useState(''), [captureCategories, setCaptureCategories] = useState<('MV' | 'LV' | 'Control')[]>([]), [preparing, setPreparing] = useState(false);
  const data = pf.data, active = Boolean(data?.activeModel.modelVersionId), selected = data?.cables.find(cable => cable.id === selectedCableId);
  useEffect(() => { setDraft(emptyDraft()); setCandidates(null); setPicking(false); setNotice(null); }, [data?.activeModel.modelVersionId]);
  const artifact = data?.artifacts[0];
  const rows = (data?.cables ?? []).filter(cable => (!onlyProblems || cable.fromMatch.status !== 'matched' || cable.toMatch.status !== 'matched') && `${cableLabel(cable)} ${cable.fromLocation ?? ''} ${cable.toLocation ?? ''}`.toUpperCase().includes(search.toUpperCase()));
  const formPoint = draft.coordinates.map(value => value.trim() ? Number(value) : NaN);
  const canSave = Boolean(active && draft.name.trim() && isCanonicalPoint(formPoint) && formPoint.every(value => Math.abs(value) <= 1e9) && !pf.busy && !picking);
  const fillLocation = (location: PathFinderLocation | undefined, name = '') => {
    pf.cancelPicking(); setPicking(false);
    setDraft(location ? { locationId: location.id, name: location.name, aliases: location.aliases.join('\n'), coordinates: location.binding ? location.binding.point.map(String) as Draft['coordinates'] : ['', '', ''],
      objectId: location.binding?.objectId ?? null, externalId: location.binding?.externalId ?? null, bindingDerivation: location.binding?.derivation ?? 'manual-world-point', derivation: location.binding?.status === 'stale' ? 'Stale binding: confirm against the active model' : 'Confirm or replace the shared location' } : { ...emptyDraft(), name });
    setQuery(name || location?.name || ''); setCandidates(null); setNotice(null); setLocalError(null);
  };
  const resolve = (endpoint: 'from' | 'to') => {
    if (!selected) return;
    const name = (endpoint === 'from' ? selected.fromLocation : selected.toLocation) ?? '', match = endpoint === 'from' ? selected.fromMatch : selected.toMatch;
    if (!name.trim()) return;
    const location = data?.locations.find(value => value.id === match.locationId) ?? data?.locations.find(value => [value.name, ...value.aliases].some(alias => normalized(alias) === normalized(name)));
    fillLocation(location, name);
  };
  const selectCandidate = (candidate: ViewerModelObject) => {
    if (!candidate.bottomCentre) return;
    setDraft(previous => ({ ...previous, coordinates: candidate.bottomCentre!.map(String) as Draft['coordinates'], objectId: `dbid:${candidate.objectId}`, externalId: candidate.externalId, bindingDerivation: 'equipment-bottom-aabb', derivation: 'Display bounding-box bottom centre; native visibility is unknown. Confirm before saving.' }));
  };
  const pick = async () => {
    setPicking(true); setNotice('Click a surface in the 3D model. Dragging continues to navigate.');
    try {
      const result = await pf.pickPoint();
      if (result) { setDraft(previous => ({ ...previous, coordinates: result.point.map(String) as Draft['coordinates'], objectId: `dbid:${result.objectId}`, externalId: null, bindingDerivation: 'picked-surface-point', derivation: 'Picked model surface point; confirm before saving' })); setNotice('Point selected. Save the shared location to reuse it for other cables.'); }
    } finally { setPicking(false); }
  };
  const findCandidates = async (cursor = 0) => {
    setSearching(true); setLocalError(null);
    try { const result = await pf.readObjects(query, cursor); if (result) setCandidates(result); }
    finally { setSearching(false); }
  };
  const save = async () => {
    if (!canSave) return;
    const name = draft.name.trim();
    const affected = (data?.cables ?? []).filter(cable => [cable.fromLocation, cable.toLocation].some(value => value && [name, ...draft.aliases.split(/\r?\n|;/).map(alias => alias.trim()).filter(Boolean)].some(alias => normalized(alias) === normalized(value)))).length;
    const result = await pf.saveLocation({ name, aliases: [...new Set(draft.aliases.split(/\r?\n|;/).map(alias => alias.trim()).filter(Boolean))], locationId: draft.locationId,
      point: formPoint as CanonicalPoint, objectId: draft.objectId, externalId: draft.externalId, derivation: draft.bindingDerivation });
    if (result) { if (typeof result.locationId === 'string') setDraft(previous => ({ ...previous, locationId: result.locationId as string })); setNotice(`Shared location saved. ${affected} ${affected === 1 ? 'cable can' : 'cables can'} reuse this location at either endpoint.`); }
  };
  const importSnapshot = async (file: File | undefined) => {
    if (!file) return;
    setLocalError(null); setNotice(null);
    try {
      if (file.size > 250 * 1024 * 1024) throw new Error('The canonical snapshot must be smaller than 250 MiB.');
      const snapshot: unknown = JSON.parse(await file.text());
      if (!snapshot || typeof snapshot !== 'object' || !('schemaVersion' in snapshot) || snapshot.schemaVersion !== 'pathfinder.model.snapshot.v1') throw new Error('Select an exported canonical PathFinder snapshot JSON file.');
      const result = await pf.uploadSnapshot(snapshot);
      if (result) setNotice('Model snapshot imported. Review the route and length before applying results.');
    } catch (error) { setLocalError(error instanceof Error ? error.message : 'The snapshot could not be read.'); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  };
  const prepareModel = async () => {
    setLocalError(null); setNotice(null);
    const routeCodes = [...new Set(captureRoutes.split(/[\/\s,;]+/).map(value => value.trim()).filter(value => value && value.toUpperCase() !== 'SECONDARY'))];
    const cables = selected ? [selected] : data?.cables ?? [];
    const equipmentNames = [...new Set(cables.flatMap(cable => [cable.fromLocation, cable.toLocation]).filter((value): value is string => Boolean(value?.trim())).map(value => value.trim()))];
    if (!routeCodes.length || routeCodes.length > 100 || routeCodes.some(value => value.length > 256) || !captureCategories.length) { setLocalError('Choose 1–100 exact network codes and explicitly select their allowed cable categories.'); return; }
    if (equipmentNames.length > 256 || equipmentNames.some(value => value.length > 256)) { setLocalError('The equipment scope exceeds 256 names. Select one cable to prepare its endpoint candidates.'); return; }
    setPreparing(true);
    try {
      const result = await pf.prepareModel({ routeCodes, equipmentNames, allowedCategories: captureCategories });
      if (result) setNotice('Selected routing geometry and endpoint candidates were prepared from the protected model. Native visibility and engineering acceptance remain unverified.');
    } finally { setPreparing(false); }
  };
  return <section ref={anchor} aria-label="PathFinder" data-testid="pathfinder-tab">
    <div className={styles.layout} style={{ height }}>
      <div className={styles.controls}>
        <h2 className={extra.heading}>PathFinder</h2>
        <div role="status" aria-live="polite" data-testid="pathfinder-status" data-phase={pf.viewerPhase}>
          {pf.loading || pf.viewerPhase === 'loading' ? <Spinner size="tiny" label={pf.viewerMessage} /> : <Body1>{pf.viewerMessage}</Body1>}
        </div>
        <div className={styles.actions}><Button disabled={pf.busy} onClick={pf.refresh}>Refresh PathFinder</Button><Button disabled={pf.busy} onClick={pf.reloadViewer}>Reload model</Button></div>
        {pf.error || localError ? <Body1 role="alert" className={styles.error}>{localError ?? pf.error}</Body1> : null}
        {notice ? <Body1 role="status">{notice}</Body1> : null}
        <div className={extra.warning} data-testid="pathfinder-readiness">
          <Body1>{artifact ? `Model snapshot: ${artifact.objectCount.toLocaleString()} objects. Review the route and length before applying.` : 'Prepare the selected model network or import a canonical snapshot for automatic routing.'}</Body1>
          <Caption1>Calculations create proposals. Cable values change only after review and Apply.</Caption1>
        </div>
        <details open={!artifact}><summary>Model preparation and project values</summary>
          <Caption1>Connection gap: {data?.settings.connectionGap ?? 'Not set'} m; SECONDARY: {data?.settings.secondaryTrayLength ?? 'Not set'} m; connection reserve: {data?.settings.endConnectionLength ?? 'Not set'} m; increase: {data?.settings.additionalBendingPercent ?? 'Not set'}%. Change these in Project Details.</Caption1>
          <Field label="Routing network codes" hint="Exact model identifiers separated by /, spaces or commas. SECONDARY is an allowance."><Textarea aria-label="Routing network codes" maxLength={8000} rows={3} value={captureRoutes} onChange={(_, value) => setCaptureRoutes(value.value)} /></Field>
          <Button disabled={!selected?.routing || preparing} onClick={() => setCaptureRoutes(selected?.routing ?? '')}>Use selected cable routing</Button>
          <fieldset disabled={pf.busy}><legend>Allowed cable categories for this network</legend>{(['MV', 'LV', 'Control'] as const).map(category => <label key={category} style={{ display: 'block' }}><input type="checkbox" checked={captureCategories.includes(category)} onChange={event => setCaptureCategories(previous => event.target.checked ? [...previous, category] : previous.filter(value => value !== category))} /> {category}{category === 'Control' ? ' (including Instrumentation)' : ''}</label>)}</fieldset>
          <Caption1>{selected ? 'The selected cable’s From/To names are included as equipment candidates.' : 'Project From/To names are included as equipment candidates, up to 256 unique names.'} This prepares only the selected network. Review its category assignments and locations.</Caption1>
          <Button appearance="primary" disabled={pf.viewerPhase !== 'ready' || pf.busy || !captureRoutes.trim() || !captureCategories.length} onClick={() => void prepareModel()}>Prepare selected model network</Button>
          {preparing ? <Button onClick={pf.clear}>Cancel model preparation</Button> : null}
          <details><summary>Import an existing canonical snapshot</summary>
          <Field label="Canonical model snapshot"><input ref={fileInput} aria-label="Canonical model snapshot" type="file" accept=".json,application/json" disabled={!active || pf.busy} onChange={event => void importSnapshot(event.target.files?.[0])} /></Field>
          </details>
        </details>
        <div className={styles.actions}>
          <Button disabled={!active || pf.busy} onClick={() => void pf.matchAll()}>Match all locations</Button>
          <Button disabled={pf.viewerPhase !== 'ready'} onClick={pf.clear}>Clear</Button>
          <Button disabled={pf.viewerPhase !== 'ready'} onClick={pf.zoom}>Zoom to path</Button>
        </div>
        <Field label="Search cables"><Input aria-label="Search PathFinder cables" value={search} onChange={(_, value) => setSearch(value.value)} /></Field>
        <label><input type="checkbox" checked={onlyProblems} onChange={event => setOnlyProblems(event.target.checked)} /> Show unresolved endpoints</label>
        <Caption1>{rows.length} of {data?.cables.length ?? 0} cables</Caption1>
        <ul className={styles.cableList} aria-label="PathFinder cables">
          {rows.map(cable => <li key={cable.id}><Button className={styles.cableRow} appearance={selectedCableId === cable.id ? 'secondary' : 'subtle'} aria-pressed={selectedCableId === cable.id} data-cable-id={cable.id} onClick={() => { setSelectedCableId(cable.id); setNotice(null); }}>
            <span className={extra.row}><span>{cableLabel(cable)}</span><Caption1>From: {cable.fromMatch.status}; To: {cable.toMatch.status}</Caption1></span>
          </Button></li>)}
        </ul>
        {selected ? <div className={extra.form} data-testid="pathfinder-selected-cable">
          <Body1>Selected: {cableLabel(selected)}</Body1>
          <Body1>From: {selected.fromLocation || 'Not set'} — {selected.fromMatch.status}</Body1>
          <Body1>To: {selected.toLocation || 'Not set'} — {selected.toMatch.status}</Body1>
          <Body1>Category: {selected.mto || 'Not set'}{selected.mto === 'Instrumentation' ? ' (uses Control rules)' : ''}</Body1>
          {!selected.fromLocation?.trim() || !selected.toLocation?.trim() ? <Body1>Set an explicit From/To name before resolving a blank endpoint. <a href={`/projects/${projectId}/cables/${selected.id}`}>Edit cable endpoints</a></Body1> : null}
          {!selected.mto || !['MV', 'LV', 'Control', 'Instrumentation'].includes(selected.mto) ? <Body1>Choose a supported category before calculation. <a href={`/projects/${projectId}/cables/${selected.id}`}>Edit cable category</a></Body1> : null}
          <div className={styles.actions}><Button disabled={pf.busy || !selected.fromLocation?.trim()} onClick={() => resolve('from')}>Resolve From</Button><Button disabled={pf.busy || !selected.toLocation?.trim()} onClick={() => resolve('to')}>Resolve To</Button></div>
        </div> : null}
        <div className={extra.form}>
          <h3 className={extra.heading}>Shared project location</h3>
          <Field label="Saved location"><select aria-label="Saved location" className={extra.select} value={draft.locationId ?? ''} onChange={event => fillLocation(data?.locations.find(value => value.id === event.target.value))}>
            <option value="">New location</option>{data?.locations.map(location => <option key={location.id} value={location.id}>{location.name}{location.binding?.status === 'stale' ? ' — stale' : ''}</option>)}
          </select></Field>
          <Field label="Location name"><Input aria-label="Location name" value={draft.name} onChange={(_, value) => setDraft(previous => ({ ...previous, name: value.value }))} /></Field>
          <Field label="Aliases" hint="One alias per line. Names are reused for both From and To."><Textarea aria-label="Location aliases" rows={2} value={draft.aliases} onChange={(_, value) => setDraft(previous => ({ ...previous, aliases: value.value }))} /></Field>
          <div className={extra.coordinates}>{(['X', 'Y', 'Z'] as const).map((axis, index) => <Field key={axis} label={`${axis} (m)`}><Input aria-label={`Location ${axis} in metres`} value={draft.coordinates[index]} onChange={(_, value) => setDraft(previous => ({ ...previous, coordinates: previous.coordinates.map((coordinate, i) => i === index ? value.value : coordinate) as Draft['coordinates'], objectId: null, externalId: null, bindingDerivation: 'manual-world-point', derivation: 'Manual world coordinates in metres' }))} /></Field>)}</div>
          <Caption1>{draft.derivation}</Caption1>
          {draft.objectId ? <><Caption1>An object binding requires this object in the prepared snapshot. You can save the point as manual coordinates without an object binding.</Caption1><Button onClick={() => setDraft(previous => ({ ...previous, objectId: null, externalId: null, derivation: `${previous.derivation}; saved as coordinates without an object binding` }))}>Use as manual coordinates</Button></> : null}
          <div className={styles.actions}>
            <Button disabled={pf.viewerPhase !== 'ready' || picking || pf.busy} onClick={() => void pick()}>Pick point in model</Button>
            {picking ? <Button onClick={() => { pf.cancelPicking(); setPicking(false); setNotice('Point picking cancelled.'); }}>Cancel picking</Button> : null}
            <Button appearance="primary" disabled={!canSave} onClick={() => void save()}>Save shared location</Button>
          </div>
        </div>
        <details className={extra.form}><summary>Find model candidates</summary>
          <Field label="Model name"><Input aria-label="Model candidate query" value={query} onChange={(_, value) => setQuery(value.value)} /></Field>
          <Button disabled={pf.viewerPhase !== 'ready' || searching || pf.busy || !query.trim()} onClick={() => void findCandidates()}>Find candidates</Button>
          {searching ? <Spinner size="tiny" label="Reading protected model candidates…" /> : null}
          {candidates?.objects.map(candidate => <div key={candidate.objectId} className={extra.candidate}><Body1>{candidate.name}</Body1><Caption1>Object {candidate.objectId}; native visibility unknown.</Caption1>
            <Button disabled={!candidate.bottomCentre} onClick={() => selectCandidate(candidate)}>Use bottom centre</Button></div>)}
          {candidates && !candidates.objects.length ? <Body1>No candidates found.</Body1> : null}
          {candidates?.nextCursor != null ? <Button disabled={searching} onClick={() => void findCandidates(candidates.nextCursor!)}>Next candidates</Button> : null}
        </details>
        <PathFinderResults pf={pf} selectedCableId={selectedCableId} />
        <PathFinderLookup pf={pf} selectedCable={selected} />
      </div>
      <div className={styles.host} ref={container} data-testid="pathfinder-model-host" />
    </div>
  </section>;
}
