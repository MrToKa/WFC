import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Body1, Button, Caption1, Checkbox, Field, Input, Spinner, Tab, TabList, makeStyles, tokens } from '@fluentui/react-components';
import type { PathFinderCable, PathFinderLocation, PathFinderPreferences } from '@/api/pathfinder';
import { usePathFinder } from './hooks/usePathFinder';
import { ModelLocationMatchPanel } from './ModelLocationMatchPanel';
import { useRoutingsViewerHeight } from './hooks/useRoutingsViewerHeight';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';
import { PathFinderResults } from './PathFinderResults';
import { PathFinderLookup } from './PathFinderLookup';
import { PathFinderRoutes } from './PathFinderRoutes';
import { PathFinderPreview } from './PathFinderPreview';
import { useProjectCablePurposes } from './hooks/useProjectCablePurposes';
import { EndpointBindingPanel } from './EndpointBindingPanel';
import { PathFinderCalculationGrantPanel } from './PathFinderCalculationGrantPanel';
import { notEvaluatedCalculationAvailability, type CalculationAvailability } from '../../../shared/pathfinderCalculationAvailability';
import { PathFinderCableWorkspace } from '@/components/pathfinder/PathFinderCableWorkspace';
import type { CableWorkflowRow } from '@/api/pathfinderCableWorkflow';
import type { PathFinderWorkflowDisplay, PathFinderWorkflowDisplayRequest, PathFinderWorkflowReview, PathFinderWorkflowCalculationPreferences } from './PathFinderResults';
import { PathFinderBarriersPanel } from './PathFinderBarriersPanel';
import { createSupportedBarrierAdmissionIntent as createBarrierAdmissionIntent, type AnyBarrierRegistry as BarrierRegistry } from '../../../shared/pathfinderBarrierSupported';
import { usePathfinderAutoLengthRead, type PathFinderCalculatedItemIdentity } from './hooks/usePathfinderAutoLengthRead';
import type { PathFinderEndpointForegroundContexts } from './pathFinderEndpointVisibility';

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
const noCalculationPoint = notEvaluatedCalculationAvailability();
const pointLabels: Record<CalculationAvailability['status'], string> = {
  'confirmed-ready': 'Confirmed calculation point',
  'automatic-ready': 'Automatic model point (approximate, unconfirmed)',
  missing: 'No model point found',
  ambiguous: 'Multiple model points; resolve manually',
  'saved-binding-required': 'Saved binding needs confirmation',
  'object-unverified': 'Model point is unverified',
  'preparation-required': 'Current preparation required',
  'not-evaluated': 'Calculation point not evaluated',
};

/** Keep all hooks and the protected frame unmounted when administrator access is absent. */
export function PathFinderTab(props: Props) {
  return props.isAdmin ? <AdminPathFinderTab {...props} /> : <Body1>Path Finder is available only to administrators.</Body1>;
}
function AdminPathFinderTab({ projectId, loadedProjectId, token, isAdmin, accountId }: Props) {
  const cablePurposes = useProjectCablePurposes({ projectId, loadedProjectId, token, isAdmin });
  const styles = useRoutingsViewerStyles(), extra = useStyles();
  const anchor = useRef<HTMLElement>(null), container = useRef<HTMLDivElement>(null);
  const barrierConfiguration = useRef<HTMLDivElement>(null);
  const configureCalculation = useCallback(() => {
    const target = barrierConfiguration.current;
    if (!target) return;
    try { target.ownerDocument.defaultView?.focus(); } catch { /* Focus can be restricted by the browser. */ }
    target.scrollIntoView?.({ block: 'start' });
    target.focus({ preventScroll: true });
  }, []);
  const height = useRoutingsViewerHeight(anchor);
  const [batchBusy, setBatchBusy] = useState(false);
  const controller = usePathFinder({ projectId, loadedProjectId, token, isAdmin, container, automaticStatePolling: false });
  const pf = { ...controller, busy: controller.busy || batchBusy };
  const panelId = useId();
  const [mode, setMode] = useState<'routes' | 'path' | 'lookup'>('path');
  const [networkCheckBusy, setNetworkCheckBusy] = useState(false), [locationCheckBusy, setLocationCheckBusy] = useState(false);
  const [barrierRefreshKey, setBarrierRefreshKey] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const displayGeneration = useRef(0), [displayOwner, setDisplayOwner] = useState<'none' | 'proposal' | 'lookup' | 'standalone'>('none');
  const [secondaryDistance, setSecondaryDistance] = useState('2'), [preferVertical, setPreferVertical] = useState(true), [transparency, setTransparency] = useState('75');
  const [barrierAuthoring, setBarrierAuthoring] = useState<{ registry: BarrierRegistry | null; dirty: boolean; pending: boolean }>({ registry: null, dirty: false, pending: false });
  const barrierStateChanged = useCallback((value: typeof barrierAuthoring) => setBarrierAuthoring(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value), []);
  const currentBarrierRegistry = barrierAuthoring.registry && barrierAuthoring.registry.scope.projectId === projectId
    && barrierAuthoring.registry.scope.modelVersionId === controller.data?.activeModel.modelVersionId
    && barrierAuthoring.registry.scope.selectionRevision === controller.data?.activeModel.selectionRevision
    && barrierAuthoring.registry.scope.contentFingerprint === controller.data?.activeModel.contentFingerprint ? barrierAuthoring.registry : null;
  const barrierOwner = JSON.stringify([projectId, accountId, token, controller.preparationViewerGeneration, controller.data?.activeModel, currentBarrierRegistry?.scope, currentBarrierRegistry?.registryRevision]);
  const [drillDraft, setDrillDraft] = useState<{ owner: string; checked: boolean } | null>(null);
  const drillThroughWalls = drillDraft?.owner === barrierOwner && drillDraft.checked;
  useEffect(() => { setDrillDraft(previous => previous && previous.owner !== barrierOwner ? null : previous); }, [barrierOwner]);
  const barrierRouting = createBarrierAdmissionIntent(currentBarrierRegistry, drillThroughWalls);
  const secondaryValue = secondaryDistance.trim() ? Number(secondaryDistance) : NaN;
  const validSecondary = Number.isFinite(secondaryValue) && secondaryValue >= 0 && secondaryValue <= 1_000_000;
  const readPreferences = validSecondary ? { secondaryDistanceMeters: secondaryValue, preferVerticalApproach: preferVertical } : null;
  const preferences: PathFinderPreferences | null = validSecondary && barrierRouting && !barrierAuthoring.dirty && !barrierAuthoring.pending
    ? { secondaryDistanceMeters: secondaryValue, preferVerticalApproach: preferVertical, barrierRouting } : null;
  const backgroundBarrierRouting = createBarrierAdmissionIntent(currentBarrierRegistry, false);
  const backgroundPreferences = preferences && backgroundBarrierRouting ? { ...preferences, barrierRouting: backgroundBarrierRouting } : null;
  const calculationBlocker = !validSecondary ? 'Enter a SECONDARY trigger distance from 0 to 1,000,000 metres in Path.'
    : barrierAuthoring.pending ? 'Wait for the saved barrier command to finish, or use Retry saved command in Barriers if its outcome is unknown.'
      : barrierAuthoring.dirty ? 'Save the obstacle selection in Barriers before calculating.'
        : !backgroundBarrierRouting ? 'Configure Barriers: save the selected obstacles, or enter an Explicit empty reason and choose Declare no barriers to calculate without obstacle checks.'
          : null;
  const getCableCalculationPreferences = useCallback((drill: boolean): PathFinderPreferences | null => {
    const intent = createBarrierAdmissionIntent(currentBarrierRegistry, drill);
    return validSecondary && intent && !barrierAuthoring.dirty && !barrierAuthoring.pending
      ? { secondaryDistanceMeters: secondaryValue, preferVerticalApproach: preferVertical, barrierRouting: intent } : null;
  }, [currentBarrierRegistry, validSecondary, secondaryValue, preferVertical, barrierAuthoring.dirty, barrierAuthoring.pending]);
  const transparencyValue = transparency.trim() ? Number(transparency) : NaN;
  const claimViewer = (owner: typeof displayOwner, clear = true) => {
    const current = ++displayGeneration.current; setDisplayOwner(owner); pf.cancelPicking(); if (clear) pf.clear();
    return () => displayGeneration.current === current;
  };
  const clearView = () => { claimViewer('none'); pf.cancelOperation(); setNotice(null); };
  const restoreView = () => { clearView(); pf.clear({ preserveCamera: false }); };
  const [search, setSearch] = useState(''), [onlyProblems, setOnlyProblems] = useState(false), [selectedCableId, setSelectedCableId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft), [notice, setNotice] = useState<string | null>(null), [localError, setLocalError] = useState<string | null>(null);
  const [endpointPending, setEndpointPending] = useState(false);
  const [workflowSelection, setWorkflowSelection] = useState<CableWorkflowRow | null>(null);
  const [workflowCalculationPreferences, setWorkflowCalculationPreferences] = useState<PathFinderWorkflowCalculationPreferences | null>(null);
  const workflowConfigurationReady = Boolean(getCableCalculationPreferences(workflowCalculationPreferences?.preferences.barrierRouting?.drillThroughWalls === true));
  const [workflowDisplay, setWorkflowDisplay] = useState<PathFinderWorkflowDisplay>({ cableId: null, jobId: null, proposalId: null, proposalHash: null,
    ready: false, visible: false, routing: null, designLength: null });
  const [workflowDisplayRequest, setWorkflowDisplayRequest] = useState<PathFinderWorkflowDisplayRequest | null>(null);
  const [endpointForegroundContexts, setEndpointForegroundContexts] = useState<PathFinderEndpointForegroundContexts | null>(null);
  const endpointForegroundChanged = useCallback((value: PathFinderEndpointForegroundContexts | null) => {
    setEndpointForegroundContexts(previous => previous === value || previous && value
      && previous.accountId === value.accountId && previous.token === value.token && previous.projectId === value.projectId
      && previous.cableId === value.cableId && previous.modelVersionId === value.modelVersionId
      && previous.selectionRevision === value.selectionRevision && previous.contentFingerprint === value.contentFingerprint
      && previous.preparationKey === value.preparationKey && previous.from.contextSha256 === value.from.contextSha256
      && previous.to.contextSha256 === value.to.contextSha256 ? previous : value);
  }, []);
  const [workflowReview, setWorkflowReview] = useState<PathFinderWorkflowReview | null>(null);
  const [calculatedItem, setCalculatedItem] = useState<PathFinderCalculatedItemIdentity | null>(null);
  const calculationCommitted = useCallback((value: PathFinderCalculatedItemIdentity) => {
    setCalculatedItem(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value);
  }, []);
  const workflowReviewChanged = useCallback((value: PathFinderWorkflowReview | null) => setWorkflowReview(value), []);
  const workflowCalculationStarted = useCallback((cableId: string) => {
    setWorkflowSelection(null);
    setWorkflowDisplay({ cableId, jobId: null, proposalId: null, proposalHash: null, ready: false, visible: false, routing: null, designLength: null });
    setWorkflowReview(null);
    setCalculatedItem(null);
    setWorkflowDisplayRequest(previous => ({ cableId, requestId: (previous?.requestId ?? 0) + 1, action: 'hide' }));
  }, []);
  const workflowDisplayChanged = useCallback((value: PathFinderWorkflowDisplay) => setWorkflowDisplay(previous => previous.cableId === value.cableId
    && previous.jobId === value.jobId && previous.proposalId === value.proposalId && previous.proposalHash === value.proposalHash && previous.ready === value.ready
    && previous.visible === value.visible && previous.routing === value.routing && previous.designLength === value.designLength
    && previous.verifiedScope === value.verifiedScope && previous.verifiedRow === value.verifiedRow
    && previous.checking === value.checking && previous.message === value.message ? previous : value), []);
  const [cableWriteRefresh, setCableWriteRefresh] = useState(0);
  const cableValuesChanged = useCallback(() => setCableWriteRefresh(value => value + 1), []);
  const autoLengthRead = usePathfinderAutoLengthRead({ projectId, loadedProjectId, accountId: accountId ?? null, token, isAdmin,
    active: mode === 'path', selectedCableId, item: calculatedItem, writeRefreshKey: cableWriteRefresh });
  const popupReview = useMemo<PathFinderWorkflowReview | null>(() => workflowReview ? {
    ...workflowReview, autoLength: autoLengthRead.view, autoLengthLoading: autoLengthRead.loading,
    autoLengthError: autoLengthRead.error, refreshAutoLength: autoLengthRead.refresh,
  } : null, [workflowReview, autoLengthRead.view, autoLengthRead.loading, autoLengthRead.error, autoLengthRead.refresh]);
  const data = pf.data, active = Boolean(data?.activeModel.modelVersionId), selected = data?.cables.find(cable => cable.id === selectedCableId);
  useEffect(() => { setDraft(emptyDraft()); setNotice(null); }, [data?.activeModel.modelVersionId, data?.activeModel.selectionRevision]);
  useEffect(() => { setWorkflowSelection(null); }, [projectId, accountId, token, data?.activeModel.modelVersionId, data?.activeModel.selectionRevision]);
  useEffect(() => { setWorkflowCalculationPreferences(null); }, [projectId, accountId, token, data?.activeModel.modelVersionId, data?.activeModel.selectionRevision, pf.preparationViewerGeneration]);
  const changeMode = (next: 'routes' | 'path' | 'lookup') => {
    if (next === mode) return;
    clearView(); setLocalError(null); setMode(next);
  };
  const artifact = data?.artifacts[0];
  const locationPoints = new Map((data?.locations ?? []).map(location => [location.id, location.calculationAvailability ?? noCalculationPoint]));
  // Use the server's unique location match only; a name/alias collision must not
  // borrow a point from one of its candidates. Legacy binding labels are separate.
  const endpointPoint = (match: PathFinderCable['fromMatch']) => match.locationId ? locationPoints.get(match.locationId) ?? noCalculationPoint : noCalculationPoint;
  const rows = (data?.cables ?? []).filter(cable => (!onlyProblems || !endpointPoint(cable.fromMatch).pointAvailable || !endpointPoint(cable.toMatch).pointAvailable) && `${cableLabel(cable)} ${cable.fromLocation ?? ''} ${cable.toLocation ?? ''}`.toUpperCase().includes(search.toUpperCase()));
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
  return <section ref={anchor} aria-label="Path Finder" data-testid="pathfinder-tab">
    <div className={styles.layout} style={{ height }}>
      <div className={styles.controls}>
        <h2 className={extra.heading}>Path Finder</h2>
        <div role="status" aria-live="polite" data-testid="pathfinder-status" data-phase={pf.viewerPhase}>
          {pf.loading || pf.viewerPhase === 'loading' ? <Spinner size="tiny" label={pf.viewerMessage} /> : <Body1>{pf.viewerMessage}</Body1>}
        </div>
        {mode !== 'routes' || pf.viewerPhase !== 'ready' ? <div className={styles.actions}><Button disabled={pf.busy} onClick={pf.refresh}>Refresh Path Finder</Button><Button disabled={pf.busy} onClick={pf.reloadViewer}>Reload model</Button></div> : null}
        {pf.error || localError ? <Body1 role="alert" className={styles.error}>{localError ?? pf.error}</Body1> : null}
        {notice ? <Body1 role="status">{notice}</Body1> : null}
        <div className={extra.warning} data-testid="pathfinder-readiness" style={{ display: mode === 'routes' ? 'none' : undefined }}>
          {mode === 'lookup' ? <><Body1>Path lookup reads the ordered route geometry from the active model. Routes preparation and category drafts are independent.</Body1><Caption1>This tool does not change cable endpoints, routes or lengths.</Caption1></> : <><Body1>{artifact ? `Model snapshot: ${artifact.objectCount.toLocaleString()} objects.` : 'Check project trays in Routes to prepare the routing network.'}</Body1><Caption1>After you assign a shared endpoint, successful current results can fill cables with both routing and design length empty. Existing or partially filled values require Review and Apply.</Caption1></>}
        </div>
        {mode === 'path' ? <Caption1>Connection gap: {data?.settings.connectionGap ?? 'Not set'} m; SECONDARY: {data?.settings.secondaryTrayLength ?? 'Not set'} m; connection reserve: {data?.settings.endConnectionLength ?? 'Not set'} m; increase: {data?.settings.additionalBendingPercent ?? 'Not set'}%. Change these in Project Details.</Caption1> : null}
        <div style={{ display: mode === 'routes' ? 'none' : 'block' }}>
        <div className={styles.actions}>
          <Button disabled={pf.viewerPhase !== 'ready'} onClick={clearView}>Clear</Button>
          <Button disabled={pf.viewerPhase !== 'ready'} onClick={pf.zoom}>Zoom to path</Button>
          <Button disabled={pf.viewerPhase !== 'ready'} onClick={restoreView}>Restore view</Button>
        </div>
        <div ref={barrierConfiguration} tabIndex={-1} role="region" aria-label="Routing barrier configuration">
          <PathFinderBarriersPanel projectId={projectId} loadedProjectId={loadedProjectId} token={token} isAdmin={isAdmin} pf={pf} onStateChange={barrierStateChanged} refreshKey={barrierRefreshKey} />
        </div>
        <Checkbox label="Drill through the walls" checked={drillThroughWalls} disabled={pf.busy || barrierAuthoring.pending || !currentBarrierRegistry}
          onChange={(_, value) => setDrillDraft({ owner: barrierOwner, checked: value.checked === true })} />
        <Caption1>For this calculation only, ignore all registered obstacles, including walls, partitions, floors, ceilings, pipes and tanks. Existing results keep their original setting.</Caption1>
        {!barrierRouting ? <Caption1>Configure the registered barriers before calculating, or explicitly enable drilling for this calculation.</Caption1> : null}
        <details><summary>Background model recalculation</summary><PathFinderCalculationGrantPanel
          projectId={projectId} loadedProjectId={loadedProjectId} token={token} accountId={accountId ?? null} isAdmin={isAdmin}
          active={active} contextKey={JSON.stringify([data?.activeModel.modelVersionId,data?.activeModel.selectionRevision,data?.activeModel.contentFingerprint])}
          preferences={backgroundPreferences} onChanged={pf.refresh} onAuthorityLost={pf.refresh}
        /></details>
        </div>
        <div style={{ display: mode === 'lookup' ? 'none' : 'block' }}>
          <ModelLocationMatchPanel pf={{ ...pf, busy: pf.busy || networkCheckBusy }} accountId={accountId ?? null} active={mode !== 'lookup'} onChanged={cableValuesChanged} onBusyChange={setLocationCheckBusy} />
        </div>
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
        <PathFinderRoutes pf={{ ...pf, busy: pf.busy || locationCheckBusy }} active={mode === 'routes'} onBusyChange={setNetworkCheckBusy} onNetworkReady={setBarrierRefreshKey} />
        </div>
        <div id={`${panelId}-path-panel`} role="tabpanel" aria-labelledby={`${panelId}-path-tab`} className={extra.panel} style={{ display: mode === 'path' ? 'flex' : 'none' }}>
        <Field label="SECONDARY trigger distance (m)" hint="Approaches longer than this distance use the SECONDARY length from Project Details."><Input aria-label="SECONDARY trigger distance in metres" value={secondaryDistance} onChange={(_, value) => { clearView(); setSecondaryDistance(value.value); }} /></Field>
        {!validSecondary ? <Body1 role="alert">Enter a SECONDARY trigger distance from 0 to 1,000,000 metres.</Body1> : null}
        <label><input type="checkbox" checked={preferVertical} onChange={event => { clearView(); setPreferVertical(event.target.checked); }} />Prefer vertical approach</label>
        <PathFinderCableWorkspace projectId={projectId} loadedProjectId={loadedProjectId} accountId={accountId ?? null} token={token} isAdmin={isAdmin}
          pf={pf} active={mode === 'path'} selectedCableId={selectedCableId} refreshKey={cableWriteRefresh} preferences={backgroundPreferences} readPreferences={backgroundPreferences ?? readPreferences} onConfigureCalculation={configureCalculation}
          getCalculationPreferences={getCableCalculationPreferences} onCalculationPreferences={setWorkflowCalculationPreferences}
          display={workflowDisplay} review={popupReview} onCalculationStart={workflowCalculationStarted} onTogglePath={cableId => setWorkflowDisplayRequest(previous => ({ cableId, requestId: (previous?.requestId ?? 0) + 1,
            action: workflowDisplay.cableId === cableId && workflowDisplay.visible ? 'hide' : 'show' }))}
          onEndpointForegroundContexts={endpointForegroundChanged}
          onSelect={row => { setSelectedCableId(row.cable.id); setWorkflowSelection(row);
            setWorkflowCalculationPreferences(previous => previous?.cableId === row.cable.id ? previous : null); }} />
        <details><summary>Advanced standalone path</summary><PathFinderPreview {...cablePurposes} pf={pf} active={mode === 'path'} displayOwned={mode === 'path' && displayOwner === 'standalone'} claimViewer={() => claimViewer('standalone')} options={preferences} onInputChange={clearView} onEndpointNamesChange={() => {}} /></details>
        <details><summary>Advanced project cables and shared locations</summary>
        <Field label="Search cables"><Input aria-label="Search Path Finder cables" value={search} onChange={(_, value) => setSearch(value.value)} /></Field>
        <label><input type="checkbox" checked={onlyProblems} onChange={event => setOnlyProblems(event.target.checked)} /> Without a calculation point</label>
        <Caption1>Automatic model points are approximate and unconfirmed. Point availability does not guarantee a route or authorize Apply.</Caption1>
        <Caption1>{rows.length} of {data?.cables.length ?? 0} cables</Caption1>
        <ul className={styles.cableList} aria-label="Path Finder cables">
          {rows.map(cable => <li key={cable.id}><Button className={styles.cableRow} appearance={selectedCableId === cable.id ? 'secondary' : 'subtle'} aria-pressed={selectedCableId === cable.id} data-cable-id={cable.id} onClick={() => { setSelectedCableId(cable.id); setWorkflowSelection(null); setNotice(null); }}>
            <span className={extra.row}><span>{cableLabel(cable)}</span><Caption1>From: {pointLabels[endpointPoint(cable.fromMatch).status]}; To: {pointLabels[endpointPoint(cable.toMatch).status]}</Caption1><Caption1>Saved bindings — From: {cable.fromMatch.status}; To: {cable.toMatch.status}</Caption1></span>
          </Button></li>)}
        </ul>
        {selected ? <div className={extra.form} data-testid="pathfinder-selected-cable">
          <Body1>Selected: {cableLabel(selected)}</Body1>
          <Body1>From: {selected.fromLocation || 'Not set'} — {pointLabels[endpointPoint(selected.fromMatch).status]}</Body1>
          <Caption1>From saved binding: {selected.fromMatch.status}</Caption1>
          <Body1>To: {selected.toLocation || 'Not set'} — {pointLabels[endpointPoint(selected.toMatch).status]}</Body1>
          <Caption1>To saved binding: {selected.toMatch.status}</Caption1>
          <Body1>MTO: {selected.mto || 'Not set (optional)'}</Body1>
          {!selected.fromLocation?.trim() || !selected.toLocation?.trim() ? <Body1>Set an explicit From/To name before resolving a blank endpoint. <a href={`/projects/${projectId}/cables/${selected.id}`}>Edit cable endpoints</a></Body1> : null}
          <Body1>Routing permissions use Purpose from the selected Cable type. MTO is optional.</Body1>
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
        <PathFinderResults pf={pf} accountId={accountId} selectedCableId={selectedCableId} workflowSelection={workflowSelection} workflowCalculationPreferences={workflowCalculationPreferences} workflowConfigurationReady={workflowConfigurationReady} onCableValuesChanged={cableValuesChanged} active={mode === 'path'} displayOwned={mode === 'path' && displayOwner === 'proposal'} claimViewer={() => claimViewer('proposal', false)} options={preferences} backgroundOptions={backgroundPreferences} readPreferences={preferences ?? readPreferences} onBatchBusyChange={setBatchBusy}
          calculationBlocker={calculationBlocker} onConfigureCalculation={validSecondary ? configureCalculation : undefined}
          workflowDisplayRequest={workflowDisplayRequest} onWorkflowDisplayChange={workflowDisplayChanged} onWorkflowReviewChange={workflowReviewChanged}
          endpointForegroundContexts={endpointForegroundContexts}
          onCalculationCommitted={calculationCommitted} />
        </div>
        <div id={`${panelId}-lookup-panel`} role="tabpanel" aria-labelledby={`${panelId}-lookup-tab`} className={extra.panel} style={{ display: mode === 'lookup' ? 'flex' : 'none' }}>
          <PathFinderLookup pf={pf} selectedCable={selected} active={mode === 'lookup'} displayOwned={mode === 'lookup' && displayOwner === 'lookup'} claimViewer={() => claimViewer('lookup')} onInputChange={clearView} onBusyChange={setLookupBusy} />
        </div>
      </div>
      <div className={styles.host} style={{ position: 'relative' }}>
        <div ref={container} data-testid="pathfinder-model-host" style={{ height: '100%' }} />
        {pf.viewerPhase === 'error' ? <div role="alert" style={{ position: 'absolute', inset: 0, padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: tokens.colorNeutralForeground1, backgroundColor: tokens.colorNeutralBackground1 }}>
          <Body1>{pf.viewerMessage}</Body1>
          <Button onClick={pf.reloadViewer}>Reload protected model</Button>
          <Caption1>Reloading checks your current access again. Calculated proposals are retained.</Caption1>
        </div> : null}
      </div>
    </div>
  </section>;
}
