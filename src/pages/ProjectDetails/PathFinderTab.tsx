import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Body1, Button, Caption1, Field, Input, Spinner, Tab, TabList, Textarea, makeStyles, tokens } from '@fluentui/react-components';
import type { PathFinderCable, PathFinderLocation, PathFinderPreferences } from '@/api/pathfinder';
import { CAPTURE_INPUT_LIMITS } from '../../../viewer-runtime/capture-input.mjs';
import { usePathFinder } from './hooks/usePathFinder';
import { useRoutingsViewerHeight } from './hooks/useRoutingsViewerHeight';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';
import { PathFinderResults } from './PathFinderResults';
import { PathFinderLookup } from './PathFinderLookup';
import { PathFinderRoutes } from './PathFinderRoutes';
import { PathFinderPreview } from './PathFinderPreview';
import { EndpointBindingPanel } from './EndpointBindingPanel';
import { PathFinderCalculationGrantPanel } from './PathFinderCalculationGrantPanel';

const useStyles = makeStyles({
  heading: { margin: 0, fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  warning: { backgroundColor: tokens.colorNeutralBackground2, padding: '0.75rem', borderRadius: tokens.borderRadiusMedium },
  form: { display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: '0.75rem' },
  coordinates: { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '0.375rem', '& input': { minWidth: 0, width: '100%' } },
  select: { maxWidth: '100%', minWidth: 0, padding: '0.5rem', color: tokens.colorNeutralForeground1, backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: tokens.borderRadiusMedium },
  row: { display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%', textAlign: 'left' },
  candidate: { padding: '0.5rem', border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium },
  panel: { flexDirection: 'column', gap: '0.75rem', minWidth: 0 },
});
type Props = { projectId: string | null; loadedProjectId: string | null; token: string | null; isAdmin: boolean; accountId?: string | null };
type Draft = { locationId: string | null; name: string };
const emptyDraft = (): Draft => ({locationId: null, name: ''});
const normalized = (value: string) => value.normalize('NFC').trim().toUpperCase();
const cableLabel = (cable: PathFinderCable) => cable.tag || cable.cableId;

/** Keep all hooks and the protected frame unmounted when administrator access is absent. */
export function PathFinderTab(props: Props) {
  return props.isAdmin ? <AdminPathFinderTab {...props} /> : <Body1>Path Finder is available only to administrators.</Body1>;
}
function AdminPathFinderTab({ projectId, loadedProjectId, token, isAdmin, accountId }: Props) {
  const styles = useRoutingsViewerStyles(), extra = useStyles();
  const anchor = useRef<HTMLElement>(null), container = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const height = useRoutingsViewerHeight(anchor);
  const pf = usePathFinder({ projectId, loadedProjectId, token, isAdmin, container });
  const panelId = useId();
  const [mode, setMode] = useState<'routes' | 'path' | 'lookup'>('path');
  const [lookupBusy, setLookupBusy] = useState(false);
  const displayGeneration = useRef(0), [displayOwner, setDisplayOwner] = useState<'none' | 'proposal' | 'lookup' | 'standalone'>('none');
  const [secondaryDistance, setSecondaryDistance] = useState('2'), [preferVertical, setPreferVertical] = useState(true), [transparency, setTransparency] = useState('75');
  const [standaloneNames, setStandaloneNames] = useState<string[]>([]);
  const updateStandaloneNames = useCallback((names: string[]) => setStandaloneNames(previous => previous.length === names.length && previous.every((name, index) => name === names[index]) ? previous : names), []);
  const [routeRulesDirty, setRouteRulesDirty] = useState(false), [externalSnapshotRevision, setExternalSnapshotRevision] = useState(0);
  const secondaryValue = secondaryDistance.trim() ? Number(secondaryDistance) : NaN;
  const preferences: PathFinderPreferences | null = Number.isFinite(secondaryValue) && secondaryValue >= 0 && secondaryValue <= 1_000_000 ? { secondaryDistanceMeters: secondaryValue, preferVerticalApproach: preferVertical } : null;
  const transparencyValue = transparency.trim() ? Number(transparency) : NaN;
  const claimViewer = (owner: typeof displayOwner) => {
    const current = ++displayGeneration.current; setDisplayOwner(owner); pf.cancelPicking(); pf.clear();
    return () => displayGeneration.current === current;
  };
  const restoreView = () => { claimViewer('none'); pf.cancelOperation(); setNotice(null); };
  const [search, setSearch] = useState(''), [onlyProblems, setOnlyProblems] = useState(false), [selectedCableId, setSelectedCableId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft), [notice, setNotice] = useState<string | null>(null), [localError, setLocalError] = useState<string | null>(null);
  const [endpointPending, setEndpointPending] = useState(false);
  const [captureRoutes, setCaptureRoutes] = useState(''), [captureCategories, setCaptureCategories] = useState<('MV' | 'LV' | 'Control')[]>([]), [preparing, setPreparing] = useState(false);
  const data = pf.data, active = Boolean(data?.activeModel.modelVersionId), selected = data?.cables.find(cable => cable.id === selectedCableId);
  useEffect(() => { setDraft(emptyDraft()); setNotice(null); }, [data?.activeModel.modelVersionId, data?.activeModel.selectionRevision]);
  const changeMode = (next: 'routes' | 'path' | 'lookup') => {
    if (next === mode) return;
    restoreView(); setLocalError(null); setMode(next);
  };
  const artifact = data?.artifacts[0];
  const rows = (data?.cables ?? []).filter(cable => (!onlyProblems || cable.fromMatch.status !== 'matched' || cable.toMatch.status !== 'matched') && `${cableLabel(cable)} ${cable.fromLocation ?? ''} ${cable.toLocation ?? ''}`.toUpperCase().includes(search.toUpperCase()));
  const fillLocation = (location: PathFinderLocation | undefined, name = '') => {
    pf.cancelPicking(); setDraft({locationId: location?.id ?? null, name: location?.name ?? name});
    setNotice(null); setLocalError(null);
  };
  const resolve = (endpoint: 'from' | 'to') => {
    if (!selected) return;
    const name = (endpoint === 'from' ? selected.fromLocation : selected.toLocation) ?? '', match = endpoint === 'from' ? selected.fromMatch : selected.toMatch;
    if (!name.trim()) return;
    const location = data?.locations.find(value => value.id === match.locationId) ?? data?.locations.find(value => [value.name, ...value.aliases].some(alias => normalized(alias) === normalized(name)));
    fillLocation(location, name);
  };
  const importSnapshot = async (file: File | undefined) => {
    if (!file) return;
    setLocalError(null); setNotice(null);
    try {
      if (file.size > 250 * 1024 * 1024) throw new Error('The canonical snapshot must be smaller than 250 MiB.');
      const snapshot: unknown = JSON.parse(await file.text());
      if (!snapshot || typeof snapshot !== 'object' || !('schemaVersion' in snapshot) || snapshot.schemaVersion !== 'pathfinder.model.snapshot.v1') throw new Error('Select an exported canonical Path Finder snapshot JSON file.');
      const result = await pf.uploadSnapshot(snapshot);
      if (result) { setExternalSnapshotRevision(value => value + 1); setRouteRulesDirty(false); setNotice('Model snapshot imported. Review the route and length before applying results.'); }
    } catch (error) { setLocalError(error instanceof Error ? error.message : 'The snapshot could not be read.'); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  };
  const prepareModel = async () => {
    setLocalError(null); setNotice(null);
    const routeCodes = [...new Set(captureRoutes.split(/[\/\s,;]+/).map(value => value.trim()).filter(value => value && value.toUpperCase() !== 'SECONDARY'))];
    const cables = selected ? [selected] : data?.cables ?? [];
    const equipmentNames = [...new Set([...standaloneNames, ...cables.flatMap(cable => [cable.fromLocation, cable.toLocation]).filter((value): value is string => Boolean(value?.trim())).map(value => value.trim())])];
    if (!routeCodes.length || routeCodes.length > 100 || routeCodes.some(value => value.length > 256) || !captureCategories.length) { setLocalError('Choose 1–100 exact network codes and explicitly select their allowed cable categories.'); return; }
    if (equipmentNames.length > CAPTURE_INPUT_LIMITS.names || equipmentNames.some(value => value.length > 256)) { setLocalError('Use at most 4,096 equipment names, each up to 256 characters. Reduce the selected endpoint scope.'); return; }
    setPreparing(true);
    try {
      const result = await pf.prepareModel({ routeCodes, equipmentNames, allowedCategories: captureCategories });
      if (result) { setExternalSnapshotRevision(value => value + 1); setRouteRulesDirty(false); setNotice('Selected routing geometry and endpoint candidates were prepared from the protected model. Native visibility and engineering acceptance remain unverified.'); }
    } finally { setPreparing(false); }
  };
  return <section ref={anchor} aria-label="Path Finder" data-testid="pathfinder-tab">
    <div className={styles.layout} style={{ height }}>
      <div className={styles.controls}>
        <h2 className={extra.heading}>Path Finder</h2>
        <div role="status" aria-live="polite" data-testid="pathfinder-status" data-phase={pf.viewerPhase}>
          {pf.loading || pf.viewerPhase === 'loading' ? <Spinner size="tiny" label={pf.viewerMessage} /> : <Body1>{pf.viewerMessage}</Body1>}
        </div>
        {routeRulesDirty ? <Body1 role="alert">Route rules have changed. Prepare all rules in Routes or discard the draft before calculating, reviewing or applying Path results. Path lookup uses the active model independently.</Body1> : null}
        <div className={styles.actions}><Button disabled={pf.busy} onClick={pf.refresh}>Refresh Path Finder</Button><Button disabled={pf.busy} onClick={pf.reloadViewer}>Reload model</Button></div>
        {pf.error || localError ? <Body1 role="alert" className={styles.error}>{localError ?? pf.error}</Body1> : null}
        {notice ? <Body1 role="status">{notice}</Body1> : null}
        <div className={extra.warning} data-testid="pathfinder-readiness">
          {mode === 'lookup' ? <><Body1>Path lookup reads the ordered route geometry from the active model. Routes preparation and category drafts are independent.</Body1><Caption1>This tool does not change cable endpoints, routes or lengths.</Caption1></> : <><Body1>{artifact ? `Model snapshot: ${artifact.objectCount.toLocaleString()} objects. Review the route and length before applying.` : 'Prepare the selected model network or import a canonical snapshot for automatic routing.'}</Body1><Caption1>Calculations create proposals. Cable values change only after review and Apply.</Caption1></>}
        </div>
        {mode !== 'lookup' ? <Caption1>Connection gap: {data?.settings.connectionGap ?? 'Not set'} m; SECONDARY: {data?.settings.secondaryTrayLength ?? 'Not set'} m; connection reserve: {data?.settings.endConnectionLength ?? 'Not set'} m; increase: {data?.settings.additionalBendingPercent ?? 'Not set'}%. Change these in Project Details.</Caption1> : null}
        <div className={styles.actions}>
          <Button disabled={pf.viewerPhase !== 'ready'} onClick={restoreView}>Clear</Button>
          <Button disabled={pf.viewerPhase !== 'ready'} onClick={pf.zoom}>Zoom to path</Button>
          <Button disabled={pf.viewerPhase !== 'ready'} onClick={restoreView}>Restore view</Button>
        </div>
        <details><summary>Background model recalculation</summary><PathFinderCalculationGrantPanel
          projectId={projectId} loadedProjectId={loadedProjectId} token={token} accountId={accountId ?? null} isAdmin={isAdmin}
          active={active} contextKey={JSON.stringify([data?.activeModel.modelVersionId,data?.activeModel.selectionRevision,data?.activeModel.contentFingerprint])}
          preferences={preferences} onChanged={pf.refresh} onAuthorityLost={pf.refresh}
        /></details>
        <TabList aria-label="Path Finder tools" selectedValue={mode} onTabSelect={(_, value) => changeMode(value.value as 'routes' | 'path' | 'lookup')}>
          <Tab id={`${panelId}-routes-tab`} value="routes" aria-controls={`${panelId}-routes-panel`}>Routes</Tab>
          <Tab id={`${panelId}-path-tab`} value="path" aria-controls={`${panelId}-path-panel`}>Path</Tab>
          <Tab id={`${panelId}-lookup-tab`} value="lookup" aria-controls={`${panelId}-lookup-panel`}>Path lookup</Tab>
        </TabList>
        <div className={extra.panel} style={{ display: mode === 'routes' ? 'none' : 'flex' }}>
          <Field label="Background transparency to apply (%)"><Input aria-label="Background transparency to apply percent" disabled={pf.busy || mode === 'lookup' && lookupBusy} value={transparency} onChange={(_, value) => setTransparency(value.value)} /></Field>
          <div className={styles.actions}>
            <Button disabled={pf.busy || mode === 'lookup' && lookupBusy || pf.viewerPhase !== 'ready' || displayOwner === 'none' || !Number.isInteger(transparencyValue) || transparencyValue < 0 || transparencyValue > 100} onClick={() => void pf.setPathTransparency(transparencyValue)}>Apply transparency</Button>
            <Button disabled={pf.busy || mode === 'lookup' && lookupBusy || pf.viewerPhase !== 'ready' || displayOwner === 'none'} onClick={() => { setTransparency('0'); void pf.setPathTransparency(0); }}>Opaque background</Button>
          </div>
        </div>
        <div id={`${panelId}-routes-panel`} role="tabpanel" aria-labelledby={`${panelId}-routes-tab`} className={extra.panel} style={{ display: mode === 'routes' ? 'flex' : 'none' }}>
        <PathFinderRoutes key={externalSnapshotRevision} pf={pf} active={mode === 'routes'} selectedCable={selected} standaloneNames={standaloneNames} onRulesDirtyChange={dirty => { setRouteRulesDirty(dirty); if (dirty) restoreView(); }} />
        <details><summary>Advanced model preparation and import</summary>
          <Field label="Routing network codes" hint="Exact model identifiers separated by /, spaces or commas. SECONDARY is an allowance."><Textarea aria-label="Routing network codes" maxLength={8000} rows={3} value={captureRoutes} onChange={(_, value) => setCaptureRoutes(value.value)} /></Field>
          <Button disabled={!selected?.routing || preparing} onClick={() => setCaptureRoutes(selected?.routing ?? '')}>Use selected cable routing</Button>
          <fieldset disabled={pf.busy}><legend>Allowed cable categories for this network</legend>{(['MV', 'LV', 'Control'] as const).map(category => <label key={category} style={{ display: 'block' }}><input type="checkbox" checked={captureCategories.includes(category)} onChange={event => setCaptureCategories(previous => event.target.checked ? [...previous, category] : previous.filter(value => value !== category))} /> {category}{category === 'Control' ? ' (including Instrumentation)' : ''}</label>)}</fieldset>
           <Caption1>{selected ? 'The selected cable’s From/To names are included as equipment candidates.' : 'Project From/To names are collected in bounded chunks, up to 4,096 requested names.'} This prepares only the selected network. Review its category assignments and locations.</Caption1>
          <Button appearance="primary" disabled={routeRulesDirty || pf.viewerPhase !== 'ready' || pf.busy || !captureRoutes.trim() || !captureCategories.length} onClick={() => void prepareModel()}>Prepare selected model network</Button>
          {preparing ? <Button onClick={restoreView}>Cancel model preparation</Button> : null}
          <details><summary>Import an existing canonical snapshot</summary>
          <Field label="Canonical model snapshot"><input ref={fileInput} aria-label="Canonical model snapshot" type="file" accept=".json,application/json" disabled={routeRulesDirty || !active || pf.busy} onChange={event => void importSnapshot(event.target.files?.[0])} /></Field>
          </details>
        </details>
        </div>
        <div id={`${panelId}-path-panel`} role="tabpanel" aria-labelledby={`${panelId}-path-tab`} className={extra.panel} style={{ display: mode === 'path' ? 'flex' : 'none' }}>
        <Field label="SECONDARY trigger distance (m)" hint="Approaches longer than this distance use the SECONDARY length from Project Details."><Input aria-label="SECONDARY trigger distance in metres" value={secondaryDistance} onChange={(_, value) => { restoreView(); setSecondaryDistance(value.value); }} /></Field>
        {!preferences ? <Body1 role="alert">Enter a SECONDARY trigger distance from 0 to 1,000,000 metres.</Body1> : null}
        <label><input type="checkbox" checked={preferVertical} onChange={event => { restoreView(); setPreferVertical(event.target.checked); }} />Prefer vertical approach</label>
        <PathFinderPreview pf={pf} active={mode === 'path'} displayOwned={mode === 'path' && displayOwner === 'standalone'} claimViewer={() => claimViewer('standalone')} options={routeRulesDirty ? null : preferences} onInputChange={restoreView} onEndpointNamesChange={updateStandaloneNames} />
        <details open><summary>Project cables and shared locations</summary>
        <div className={styles.actions}>
          <Button disabled={!active || pf.busy} onClick={() => void pf.matchAll()}>Match all locations</Button>
        </div>
        <Field label="Search cables"><Input aria-label="Search Path Finder cables" value={search} onChange={(_, value) => setSearch(value.value)} /></Field>
        <label><input type="checkbox" checked={onlyProblems} onChange={event => setOnlyProblems(event.target.checked)} /> Show unresolved endpoints</label>
        <Caption1>{rows.length} of {data?.cables.length ?? 0} cables</Caption1>
        <ul className={styles.cableList} aria-label="Path Finder cables">
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
          <div className={styles.actions}><Button disabled={pf.busy || endpointPending || !selected.fromLocation?.trim()} onClick={() => resolve('from')}>Resolve From</Button><Button disabled={pf.busy || endpointPending || !selected.toLocation?.trim()} onClick={() => resolve('to')}>Resolve To</Button></div>
        </div> : null}
        <div className={extra.form}>
          <h3 className={extra.heading}>Shared project location</h3>
          <Field label="Saved location"><select aria-label="Saved location" className={extra.select} disabled={endpointPending} value={draft.locationId ?? ''} onChange={event => fillLocation(data?.locations.find(value => value.id === event.target.value))}>
            <option value="">New location</option>{data?.locations.map(location => <option key={location.id} value={location.id}>{location.name}{location.binding?.status === 'stale' ? ' — stale' : ''}</option>)}
          </select></Field>
          <EndpointBindingPanel
            projectId={projectId} loadedProjectId={loadedProjectId} token={token} isAdmin={isAdmin}
            locationId={draft.locationId} initialName={draft.name}
            contextKey={JSON.stringify([data?.activeModel.modelVersionId, data?.activeModel.selectionRevision,
              data?.activeModel.contentFingerprint, artifact?.id, artifact?.snapshotSha256,
              pf.preparationViewerGeneration, mode, displayGeneration.current])}
            pickPoint={pf.pickPoint} cancelPicking={pf.cancelPicking}
            onSaved={receipt => { setDraft(previous => ({...previous, locationId: receipt.locationId})); pf.refresh(); }}
            onAuthorityLost={() => { pf.cancelPicking(); pf.refresh(); }}
            onRecoveryPendingChange={setEndpointPending}
          />
        </div>
        </details>
        <PathFinderResults pf={pf} accountId={accountId} selectedCableId={selectedCableId} active={mode === 'path' && !routeRulesDirty} displayOwned={mode === 'path' && displayOwner === 'proposal'} claimViewer={() => claimViewer('proposal')} options={routeRulesDirty ? null : preferences} />
        </div>
        <div id={`${panelId}-lookup-panel`} role="tabpanel" aria-labelledby={`${panelId}-lookup-tab`} className={extra.panel} style={{ display: mode === 'lookup' ? 'flex' : 'none' }}>
          <PathFinderLookup pf={pf} selectedCable={selected} active={mode === 'lookup'} displayOwned={mode === 'lookup' && displayOwner === 'lookup'} claimViewer={() => claimViewer('lookup')} onInputChange={restoreView} onBusyChange={setLookupBusy} />
        </div>
      </div>
      <div className={styles.host} ref={container} data-testid="pathfinder-model-host" />
    </div>
  </section>;
}
