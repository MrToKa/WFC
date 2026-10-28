import { Button, Checkbox, Spinner, tokens } from '@fluentui/react-components';
import { useRoutingPurposePolicy } from '@/pages/ProjectDetails/hooks/useRoutingPurposePolicy';

type Props = { projectId: string | null; loadedProjectId: string | null; token: string | null; isAdmin: boolean; className?: string };

/** Preserve distinct purpose keys while explaining names whose spacing can look alike. */
export function routingPurposeDisplayLabels(keys: readonly (string | null)[]): Map<string, { label: string; variant: string; exactSpacing: string }> {
  const groups = new Map<string, string[]>();
  for (const key of keys) {
    if (key === null) continue;
    const group = key.replace(/\s+/gu, ' ');
    groups.set(group, [...new Set([...(groups.get(group) ?? []), key])]);
  }
  const labels = new Map<string, { label: string; variant: string; exactSpacing: string }>();
  for (const keys of groups.values()) {
    if (keys.length < 2) continue;
    keys.sort();
    keys.forEach((key, index) => {
      const variant = `Spacing variant ${index + 1} of ${keys.length}`;
      labels.set(key, { label: `${key} (${variant})`, variant, exactSpacing: key.replace(/\s/gu, '·') });
    });
  }
  return labels;
}

export function RoutingPurposePolicyCard({ projectId, loadedProjectId, token, isAdmin, className }: Props) {
  const state = useRoutingPurposePolicy({ projectId, loadedProjectId, token, isAdmin });
  const displayLabels = routingPurposeDisplayLabels(state.rows.map(row => row.purposeKey));
  if (!isAdmin || !projectId || projectId !== loadedProjectId || !token) return null;
  return <section className={className} aria-label="Path Finder routing permissions">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <h2 style={{ fontSize: tokens.fontSizeBase400, margin: 0 }}>Path Finder routing permissions</h2>
      <Button onClick={() => void state.refresh()} disabled={state.busy || state.uncertain}>Refresh permissions</Button>
    </div>
    <p>Choose which cable purposes may use each purpose in the project tray catalog. Columns come from Purpose in the project Cable types.</p>
    <p style={{ color: tokens.colorNeutralForeground3 }}>Unconfigured purposes allow no routing. Excluded purposes deliberately allow none. Reset returns a purpose to Unconfigured.</p>
    {state.loading ? <Spinner size="tiny" label="Loading routing permissions..." /> : null}
    {state.refreshing ? <p role="status">Refreshing current routing permissions...</p> : null}
    {state.saving ? <p role="status">Saving routing permissions...</p> : null}
    {state.notice ? <p role="status">{state.notice}</p> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.conflict ? <div role="alert"><p>{state.conflict}</p><Button onClick={() => void state.refresh(true)} disabled={state.busy}>Discard changes and refresh</Button></div> : null}
    {state.uncertain ? <Button appearance="primary" onClick={() => void state.retrySave()} disabled={!state.canRetrySave}>Retry the same save</Button> : null}
    {state.refreshPrompt ? <div role="alert">
      <p>Refreshing will discard your unsaved permission changes.</p>
      <Button onClick={() => void state.refresh(true)} disabled={state.busy}>Discard changes and refresh</Button>{' '}
      <Button onClick={state.cancelRefresh}>Keep changes</Button>
    </div> : null}
    {state.snapshot ? <>
      <p>{state.snapshot.catalog.rowCount} trays · {state.rows.filter(row => row.purposeKey !== null).length} purposes · Policy revision {state.snapshot.policy.routingPolicyRevision}</p>
      {state.invalidCablePurposeCount > 0 ? <p role="alert">{state.invalidCablePurposeCount} invalid Purpose {state.invalidCablePurposeCount === 1 ? 'value is' : 'values are'} unavailable for routing. Correct the Purpose in Cable types, then refresh permissions.</p> : null}
      {!state.cablePurposes.length ? <p>No cable purposes are available. Add a Purpose to the project Cable types, then refresh permissions.</p> : null}
      {state.snapshot.catalog.diagnostics.length ? <div role="alert">
        <p>Tray catalog diagnostics are shown below. Routing identity issues block the affected purposes; drawing dimension issues do not block routing permissions.</p>
        <ul>{state.snapshot.catalog.diagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.message}</li>)}</ul>
      </div> : null}
      {state.rows.length ? <div style={{ overflowX: 'auto', maxHeight: 480 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }} aria-label="Cable purposes by tray purpose">
          <thead><tr><th scope="col" style={{ textAlign: 'left' }}>Tray purpose</th><th scope="col">Trays</th>
            {state.cablePurposes.map(category => <th key={category} scope="col" style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{category}</th>)}<th scope="col">State</th><th scope="col">Actions</th></tr></thead>
          <tbody>{state.rows.map(row => {
            const label = row.purposeKey ?? 'Missing purpose';
            const display = row.purposeKey === null ? undefined : displayLabels.get(row.purposeKey);
            const accessibleLabel = display?.label ?? label;
            const unavailable = row.categories.filter(category => !state.cablePurposes.includes(category));
            const activeCategories = row.categories.filter(category => state.cablePurposes.includes(category));
            return <tr key={row.purposeKey ?? 'missing-purpose'} style={{ borderTop: `1px solid ${tokens.colorNeutralStroke2}` }}>
              <th scope="row" style={{ textAlign: 'left', fontWeight: tokens.fontWeightRegular, padding: '8px 4px', overflowWrap: 'anywhere' }}>
                <span style={{ whiteSpace: 'pre-wrap' }}>{label}</span>
                {display ? <div style={{ fontSize: tokens.fontSizeBase200 }}>{display.variant} · Spaces shown as dots: <span style={{ whiteSpace: 'pre-wrap' }}>{display.exactSpacing}</span></div> : null}
              </th>
              <td style={{ textAlign: 'center' }}>{row.trayCount}</td>
              {state.cablePurposes.map(category => <td key={category} style={{ textAlign: 'center' }}><Checkbox
                aria-label={`${category} for ${accessibleLabel}`} checked={row.categories.includes(category)} disabled={!state.canEdit || row.blocked}
                onChange={(_, data) => { if (row.purposeKey !== null) state.toggle(row.purposeKey, category, data.checked === true); }} /></td>)}
              <td>{row.configured ? activeCategories.length ? 'Configured' : unavailable.length ? 'Needs configuration' : 'Excluded' : 'Unconfigured'}{row.blocked ? ' · Routing identity issue' : ''}{row.dirty ? ' · Unsaved' : ''}
                {unavailable.length ? <div style={{ fontSize: tokens.fontSizeBase200 }}>No matching Cable types Purpose: {unavailable.join(', ')}. Select current purposes or reset this row.</div> : null}
              </td>
              <td><div style={{ display: 'flex', gap: 4 }}><Button size="small" aria-label={`Exclude ${accessibleLabel}`} disabled={!state.canEdit || row.blocked || row.configured && !row.categories.length}
                onClick={() => { if (row.purposeKey !== null) state.exclude(row.purposeKey); }}>Exclude</Button>
                <Button size="small" aria-label={`Reset ${accessibleLabel}`} disabled={!state.canEdit || row.blocked || !row.configured}
                  onClick={() => { if (row.purposeKey !== null) state.reset(row.purposeKey); }}>Reset</Button></div></td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <p>No trays are available in this project.</p>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
        <Button appearance="primary" onClick={() => void state.save()} disabled={!state.canSave}>Save routing permissions</Button>
        {state.dirty ? <span>Unsaved changes</span> : null}
      </div>
      <p style={{ color: tokens.colorNeutralForeground3 }}>Changing permissions requires a matching routing-network preparation. Calculated routes remain proposals for review and Apply.</p>
      <details><summary>Permission history</summary>
        <Button onClick={() => void state.refreshHistory()} disabled={state.historyLoading || state.saving}>Refresh history</Button>
        {state.historyLoading ? <p role="status">Loading permission history...</p> : null}
        {state.historyError ? <p role="alert">{state.historyError}</p> : null}
        {state.history && !state.history.events.length ? <p>No routing permission changes have been recorded.</p> : null}
        <ol>{state.history?.events.map(event => <li key={event.auditId}>Revision {event.revision} · {event.occurredAt} · Administrator {event.actorId}</li>)}</ol>
        {state.history?.nextBeforeRevision ? <Button onClick={() => void state.moreHistory()} disabled={state.historyLoading || state.saving}>Load older changes</Button> : null}
      </details>
    </> : null}
  </section>;
}
