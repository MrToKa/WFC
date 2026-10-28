import { useMemo, useRef, useState } from 'react';
import { Body1, Button, Caption1, Field, Input, Spinner, Tab, TabList, Textarea } from '@fluentui/react-components';
import type { RouteCheckResult } from '@/viewer/routeValidation';
import { useRoutingsViewer } from './hooks/useRoutingsViewer';
import { useRoutingsViewerHeight } from './hooks/useRoutingsViewerHeight';
import { useRoutingCables } from './hooks/useRoutingCables';
import { useCableInformationPanel } from './hooks/useCableInformationPanel';
import { CableInformationPanel } from './CableInformationPanel';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';

const summaries: Record<RouteCheckResult['status'], string> = {
  complete: 'The route is complete in the project and model.',
  partial: 'The route checks are incomplete. Review the project and model results below.',
  none: 'No drawable route was found in the model.', empty: 'Enter a route.',
  invalid: 'The route is invalid. Check the identifiers and input limits.',
};
type Props = { projectId: string | null; loadedProjectId: string | null; token: string | null };

export function RoutingsViewerTab({ projectId, loadedProjectId, token }: Props) {
  const styles = useRoutingsViewerStyles();
  const anchor = useRef<HTMLElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState({ projectId, token, value: '' });
  const [sourceTab, setSourceTab] = useState({ projectId, token, value: 'manual' });
  const mode = sourceTab.projectId === projectId && sourceTab.token === token ? sourceTab.value : 'manual';
  const routing = draft.projectId === projectId && draft.token === token ? draft.value : '';
  const height = useRoutingsViewerHeight(anchor);
  const viewer = useRoutingsViewer({ projectId, loadedProjectId, token, container });
  const cableReadScope = Boolean(projectId && token && projectId === loadedProjectId && viewer.phase !== 'access-denied' && viewer.phase !== 'login-required');
  const cables = useRoutingCables({ projectId: cableReadScope ? projectId : null, token, active: mode === 'cables' && cableReadScope,
    onAccessFailure: viewer.terminateAccess, onCableInvalidated: viewer.invalidateCableRoute });
  const informationScope = useMemo(() => cableReadScope ? { projectId, token } : null, [cableReadScope, projectId, token]);
  const information = useCableInformationPanel({ scopeIdentity: informationScope, active: mode === 'cables', lifecycleIdentity: viewer.lifecycleKey,
    snapshotGeneration: cables.snapshotGeneration, rows: cables.cables,
    readStatus: !cableReadScope || !cables.hasSnapshot ? 'unavailable' : cables.refreshing ? 'refreshing' : cables.stale ? 'stale' : 'confirmed', searchRef: searchInput });
  const result = viewer.result;
  const loading = viewer.phase === 'metadata' || viewer.phase === 'loading';
  const retryable = !loading && viewer.phase !== 'ready' && viewer.phase !== 'login-required';
  const currentCable = viewer.currentRoute?.source === 'cable' ? cables.cables.find(cable => cable.id === viewer.currentRoute?.cableId) : null;
  const cableState = !cableReadScope ? 'error' : cables.loading || !cables.hasActivated ? 'loading' : cables.refreshing ? 'refreshing' : cables.error ? cables.hasSnapshot ? 'stale' : 'error'
    : cables.cables.length === 0 ? 'empty' : cables.taggedCount === 0 ? 'untagged' : cables.rows.length === 0 ? 'no-match' : 'ready';
  const retryRoute = () => void viewer.retryRoute(viewer.currentRoute?.source === 'cable' ? cables.getSelectedForRetry() : undefined);
  const retryViewer = () => { viewer.retry(); if (cables.hasActivated) void cables.refresh(); };
  return <section ref={anchor} aria-label="Routings viewer" data-testid="routings-viewer-tab">
    <div className={styles.layout} style={{ height }} data-testid="routings-layout">
      <div className={styles.controls}>
        <TabList className={styles.sources} selectedValue={mode} aria-label="Routing source"
          onTabSelect={(_, data) => { if (data.value === 'manual' || data.value === 'cables') setSourceTab({ projectId, token, value: data.value }); }}>
          <Tab value="manual">Manual routing</Tab>
          <Tab value="cables">Cables</Tab>
        </TabList>
        <div className={styles.status} aria-live="polite" aria-atomic="true" data-testid="routings-viewer-status" data-phase={viewer.phase}>
          {loading ? <Spinner size="tiny" label={viewer.message} /> : <Body1>{viewer.message}</Body1>}
          {viewer.model ? <Caption1>Active model: {viewer.model.label}</Caption1> : null}
          {retryable ? <Button onClick={retryViewer}>Retry</Button> : null}
        </div>
        {mode === 'manual' ? <form onSubmit={event => { event.preventDefault(); void viewer.show(routing); }}>
          <Field className={styles.field} label="Manual routing" hint="Separate tray names with /. SECONDARY markers are ignored.">
            <Textarea aria-label="Manual routing" value={routing} maxLength={8000} resize="vertical" rows={4}
              onChange={(_, data) => setDraft({ projectId, token, value: data.value })}
              onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void viewer.show(routing); } }} />
          </Field>
          <div className={styles.actions}>
            <Button type="submit" appearance="primary" disabled={!viewer.canShow}>Show route</Button>
          </div>
        </form> : <div className={styles.cablePanel}>
          <Field className={styles.field} label="Search cable tags">
            <Input ref={searchInput} aria-label="Search cable tags" value={cables.search} onChange={(_, data) => cables.setSearch(data.value)} />
          </Field>
          <div className={styles.actions}>
            <Button disabled={!cableReadScope || cables.loading || cables.refreshing} onClick={() => void cables.refresh()}>Refresh cables</Button>
            {cables.error && cableReadScope ? <Button disabled={cables.loading || cables.refreshing} onClick={() => void cables.refresh()}>Retry cables</Button> : null}
          </div>
          <div role="status" aria-live="polite" data-testid="routing-cables-status" data-state={cableState}>
            {cableState === 'loading' ? <Spinner size="tiny" label="Loading cables…" /> : null}
            {!cableReadScope ? <Body1>Refresh project access or sign in again before loading cables.</Body1> : null}
            {cables.refreshing ? <Body1>Refreshing cables…</Body1> : null}
            {cables.error ? <Body1>{cables.error}</Body1> : null}
            {cables.stale && cables.hasSnapshot ? <Body1>The cable list may be out of date. Refresh before selecting or retrying a cable route.</Body1> : null}
            {cableState === 'empty' ? <Body1>This project has no cables.</Body1> : null}
            {cableState === 'untagged' ? <Body1>All cables in this project are without a tag.</Body1> : null}
            {cableState === 'no-match' ? <Body1>No cable tags match this search.</Body1> : null}
          </div>
          {cableReadScope && cables.hasSnapshot ? <Caption1>{cables.omittedCount} {cables.omittedCount === 1 ? 'cable without a tag is' : 'cables without a tag are'} not shown.</Caption1> : null}
          {!viewer.canShow && cableReadScope ? <Body1>Wait until the model is ready before selecting a cable route.</Body1> : null}
          {cableReadScope && cables.hasSnapshot ? <Caption1>Click a cable to keep its window open. Hover over a tag or press Alt+Enter for cable information.</Caption1> : null}
          <ul className={styles.cableList} aria-label="Project cables">
            {(cableReadScope ? cables.rows : []).map(cable => <li key={cable.id}>
              <Button className={styles.cableRow} appearance={cables.selectedCableId === cable.id ? 'secondary' : 'subtle'}
                aria-pressed={cables.selectedCableId === cable.id} data-cable-id={cable.id}
                {...information.getRowProps(cable.id)} aria-disabled={!viewer.canShow || !cables.canActivate}
                onClick={event => { information.openPinned(cable.id, event.currentTarget);
                  if (!viewer.canShow || !cables.canActivate) return; information.beforeRoute(cable.id);
                  const selected = cables.select(cable.id); if (selected) void viewer.showCable(selected); }}>{cable.tag}</Button>
            </li>)}
          </ul>
        </div>}
        {cableReadScope && cables.selectedCable ? <Caption1 data-testid="selected-routing-cable">Selected cable: {cables.selectedCable.tag}</Caption1> : null}
        {cableReadScope && cables.selectedHidden ? <Caption1>The selected cable is hidden by this filter.</Caption1> : null}
        {cableReadScope && cables.notice ? <Body1 role="status">{cables.notice}</Body1> : null}
        <div className={styles.actions}>
          <Button type="button" disabled={!viewer.canZoom} onClick={viewer.zoom}>Zoom to route</Button>
          <Button type="button" disabled={!viewer.canShow} onClick={viewer.clear}>Clear</Button>
          <Button type="button" disabled={!viewer.canShow} onClick={viewer.clear}>Show entire model</Button>
        </div>
        <Body1 data-testid="current-routing-source" data-source={viewer.currentRoute?.source ?? ''} data-cable-id={viewer.currentRoute?.cableId ?? ''}>
          {viewer.currentRoute ? viewer.currentRoute.source === 'manual' ? 'Manual routing' : `Cable: ${currentCable?.tag ?? 'Selected cable'}` : 'No route is displayed.'}
        </Body1>
        {viewer.checking ? <Body1 role="status">Checking this route against the project and model…</Body1> : null}
        {result ? <section className={styles.result} aria-label="Route check result" aria-live="polite" data-testid="routing-result" data-route-status={result.status} data-operation-id={viewer.operationId} data-source={result.source} data-cable-id={result.cableId ?? ''}>
          <Body1>{result.source === 'cable' && result.status === 'empty' ? 'This cable has no drawable routing.' : summaries[result.status]}</Body1>
          {result.segments.length ? <Caption1>{result.drawableCount} of {result.segments.length} segments drawable; {result.lineCount} yellow line sections.</Caption1> : null}
          {result.ignored.length ? <Caption1>{result.ignored.length} SECONDARY {result.ignored.length === 1 ? 'marker' : 'markers'} ignored.</Caption1> : null}
          {result.warnings.filter(warning => !(result.source === 'cable' && result.status === 'empty' && ['ENTER_ROUTE', 'SECONDARY_ONLY'].includes(warning.code)))
            .map((warning, index) => <Body1 key={`${warning.code}-${warning.segmentIndex}-${index}`}>{warning.message}</Body1>)}
          {result.databaseCheck === 'unavailable' && result.segments.length ? <Button disabled={!viewer.canShow || viewer.checking || result.source === 'cable' && !cables.canActivate} onClick={retryRoute}>Retry route check</Button> : null}
          {result.segments.length ? <details className={styles.details}>
            <summary>Segment details</summary>
            <table className={styles.table}>
              <caption>Independent project and model checks for each occurrence</caption>
              <thead><tr><th scope="col">Occurrence</th><th scope="col">Tray</th><th scope="col">Project</th><th scope="col">Model</th></tr></thead>
              <tbody>{result.segments.map(segment => <tr key={segment.segmentIndex}
                data-segment-index={segment.segmentIndex} data-route-key={segment.key} data-project-state={segment.project.state}
                data-model-state={segment.model.state} data-drawable={String(segment.model.drawable)}>
                <td>{segment.segmentIndex + 1}</td><td>{segment.token}</td>
                <td>{segment.project.state}{segment.project.state === 'ambiguous' ? ` (${segment.project.matchCount} matches)` : ''}</td>
                <td>{segment.model.state}{segment.model.state === 'ambiguous' ? ` (${segment.model.matchCount} matches)` : segment.model.state === 'found' && !segment.model.drawable ? ' — no drawable geometry' : segment.model.drawable ? ' — drawable' : ''}</td>
              </tr>)}</tbody>
            </table>
          </details> : null}
          {result.drawableCount > 0 ? <Caption1>The yellow line and any approximate connectors are visual guidance, not engineering evidence.</Caption1> : null}
        </section> : null}
      </div>
      <div className={styles.host} ref={container} data-testid="routings-model-host" />
    </div>
    {information.panelProps ? <CableInformationPanel {...information.panelProps} /> : null}
  </section>;
}
