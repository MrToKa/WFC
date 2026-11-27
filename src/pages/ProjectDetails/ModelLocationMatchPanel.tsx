import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Button, Caption1, Input, Spinner } from '@fluentui/react-components';
import type { usePathFinder } from './hooks/usePathFinder';
import { useModelLocationMatch } from './hooks/useModelLocationMatch';
import { modelLocationMatchCounts, type ModelLocationMatchResult } from '../../../shared/pathfinderModelLocationMatch';
import { normalizeEndpointLocation } from '../../../shared/pathfinderEndpointBindings';

export type MatchBeforeCalculation = ReturnType<typeof useModelLocationMatch>['beforeCalculation'];
type Props = { pf: ReturnType<typeof usePathFinder>; accountId: string | null; active: boolean; refreshRevision?: number; onChanged?: () => void;
  onBusyChange?: (busy: boolean) => void; calculationMatchRef?: Ref<MatchBeforeCalculation>;
  locationReport?: { editing: boolean; switchingDisabled?: boolean; selectedName?: string; lastSavedName?: string | null;
    onOpen: (name: string, anchor: HTMLButtonElement) => void; canOpen: (name: string) => boolean;
    onShow?: (item: ModelLocationMatchResult) => void; showing?: string; showMessage?: { text: string; error: boolean } };
};
export function ModelLocationMatchPanel(props: Props) {
  const match = useModelLocationMatch(props);
  useImperativeHandle(props.calculationMatchRef, () => match.beforeCalculation, [match.beforeCalculation]);
  const [shown, setShown] = useState(128);
  const [shownAssigned, setShownAssigned] = useState(128);
  const [query, setQuery] = useState('');
  const assignedDetails = useRef<HTMLDetailsElement>(null);
  useEffect(() => { props.onBusyChange?.(match.busy); return () => props.onBusyChange?.(false); }, [match.busy, props.onBusyChange]);
  useEffect(() => { setShown(128); setShownAssigned(128); }, [match.owner, match.complete]);
  const problems = match.results.filter(item => !['assigned', 'preserved'].includes(item.status));
  const assigned = match.results.filter(item => item.status === 'assigned' || item.status === 'preserved');
  const searchKey = normalizeEndpointLocation(query);
  const matchingAssigned = searchKey ? assigned.filter(item => normalizeEndpointLocation(item.name).includes(searchKey)) : assigned;
  const counts = { assigned: 0, preserved: 0, missing: 0, ambiguous: 0, unavailable: 0 };
  for (const item of match.results) counts[item.status]++;
  const summary = modelLocationMatchCounts(match.results);
  if (!match.allowed) return null;
  const report = props.locationReport;
  const showDisabled = !props.active || report?.switchingDisabled || match.busy || match.summaryLoading
    || Boolean(match.pending) || Boolean(report?.showing);
  const label = (item: ModelLocationMatchResult) => {
    if (item.status === 'assigned') return 'assigned';
    if (item.status === 'preserved') return 'existing assignment kept';
    if (item.status === 'missing') return 'not found';
    if (item.status === 'ambiguous') return `multiple matching objects (${item.candidateObjectIds.length})`;
    return 'the matching object is hidden or has no usable location';
  };
  const row = (item: ModelLocationMatchResult, searchable = false) => (
    <li key={item.name}>
      {report?.canOpen(item.name) ? <Button appearance="subtle" size="small"
        aria-current={report.selectedName === item.name || undefined}
        disabled={!props.active || report.switchingDisabled || match.busy || Boolean(match.pending)}
        onClick={event => report.onOpen(item.name, event.currentTarget)}>{item.name}</Button> : item.name}
      {': '}{label(item)}.
      {searchable && report?.onShow ? <Button appearance="subtle" size="small" disabled={showDisabled}
        aria-label={`Show ${item.name} in 3D`} onClick={() => report.onShow?.(item)}>Show in 3D</Button> : null}
    </li>
  );
  return <section aria-label="Find and assign model locations" style={{ marginBlock: 12 }}>
    <h3>From/To locations</h3>
    {report ? <p>Select a location from the report to verify or change its model object.</p> :
      <p>Locations are saved and shared by all cables using the same From/To name. Finding locations keeps current assignments and checks missing names and assignments from an older model. A unique matching object within 25 cm of the previous location is assigned automatically. A manual change updates the shared location.</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBlock: 8 }}>
      <Button appearance="primary" disabled={!match.canStart || report?.editing} onClick={() => void match.start()}>
        {report ? 'Assign from/to locations' : 'Find and assign From/To'}
      </Button>
      {match.busy ? <Button onClick={match.cancel}>Cancel finding locations</Button> : null}
      {match.pending ? <Button disabled={match.busy || match.summaryLoading || !props.active || !match.storageReady || report?.editing} onClick={() => void match.retry()}>Retry saved location assignment</Button> : null}
    </div>
    {match.busy ? <Spinner size="tiny" label={match.progress ?? 'Finding project From/To locations…'} /> : null}
    {match.summaryLoading ? <Spinner size="tiny" label={match.progress ?? 'Reading saved From/To matching results…'} /> : null}
    {match.error ? <p role="alert">{match.error}</p> : null}
    {match.notice ? <p role="status">{match.notice}</p> : null}
    {report?.lastSavedName ? <p role="status">Saved location {report.lastSavedName}.</p> : null}
    {!match.busy && !match.summaryLoading && match.progress && !match.complete ? <Caption1>Last progress: {match.progress}</Caption1> : null}
    {match.totalNames > 0 ? <p role="status">
      Searched: {summary.searched} of {match.totalNames}; found in model: {summary.found}; assigned: {summary.assigned}; kept: {summary.preserved}; manual attention: {summary.manualAttention}.
    </p> : null}
    {match.totalNames > 0 ? <p>Not found: {counts.missing}; multiple matches: {counts.ambiguous}; unavailable or hidden: {counts.unavailable}.
      {!match.busy && !match.complete ? ' Partial results; remaining names have no saved matching result.' : ''}
      {' '}Only saved matching results are counted. Found includes multiple or unavailable model matches.
    </p> : null}
    {report?.onShow ? <form aria-label="Search assigned locations" onSubmit={event => {
      event.preventDefault();
      if (!searchKey || showDisabled) return;
      const exact = matchingAssigned.find(item => normalizeEndpointLocation(item.name) === searchKey);
      const target = exact ?? (matchingAssigned.length === 1 ? matchingAssigned[0] : undefined);
      if (target) report.onShow?.(target);
      else if (assignedDetails.current) assignedDetails.current.open = true;
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBlock: 8 }}>
        <Input type="search" aria-label="Search assigned locations by tag" placeholder="Enter an instrument tag" value={query}
          onChange={(_, data) => {
            setQuery(data.value);
            setShownAssigned(128);
            if (normalizeEndpointLocation(data.value) && assignedDetails.current) assignedDetails.current.open = true;
          }} />
        <Button type="submit" disabled={!searchKey || !matchingAssigned.length || showDisabled}>Search</Button>
      </div>
      {searchKey && !matchingAssigned.length ? <p role="status">No assigned location matches this tag.</p> : null}
      {report.showing ? <Spinner size="tiny" label={`Showing ${report.showing} in 3D…`} /> : null}
      {report.showMessage ? <p role={report.showMessage.error ? 'alert' : 'status'}>{report.showMessage.text}</p> : null}
    </form> : null}
    {problems.length ? <details open={report ? true : undefined}>
      <summary>{report ? 'Unassigned locations' : 'Locations that need attention'} ({problems.length})</summary>
      <ul>{problems.slice(0, shown).map(item => row(item))}</ul>
      {shown < problems.length ? <Button onClick={() => setShown(value => value + 128)}>Show more locations</Button> : null}
    </details> : null}
    {report && assigned.length ? <details ref={assignedDetails}><summary>Assigned locations ({searchKey ? `${matchingAssigned.length} of ` : ''}{assigned.length})</summary>
      {matchingAssigned.length ? <ul>{matchingAssigned.slice(0, shownAssigned).map(item => row(item, Boolean(searchKey)))}</ul> : null}
      {shownAssigned < matchingAssigned.length ? <Button onClick={() => setShownAssigned(value => value + 128)}>Show more locations</Button> : null}
    </details> : null}
  </section>;
}
