import { Button, Checkbox, Spinner, tokens } from '@fluentui/react-components';
import { useEffect, useRef } from 'react';
import { useDrawingPurposePolicy } from '@/pages/ProjectDetails/hooks/useDrawingPurposePolicy';
import { routingPurposeDisplayLabels } from './RoutingPurposePolicyCard';
type Props = { projectId: string | null; loadedProjectId: string | null; token: string | null; isAdmin: boolean; className?: string; onSaved?: () => void };
export function CablePositioningCard(props: Props) {
  const state = useDrawingPurposePolicy(props);
  const observed = useRef<{ context: string; revision: string } | null>(null);
  const revision = state.snapshot ? `${state.snapshot.catalog.catalogRevision}/${state.snapshot.policy.drawingPolicyRevision}/${state.snapshot.policy.cablePurposesSha256 ?? ''}` : null;
  const context = JSON.stringify([props.projectId, props.loadedProjectId, props.token, props.isAdmin]);
  useEffect(() => {
    if (!revision) { observed.current = null; return; }
    if (observed.current?.context === context && observed.current.revision !== revision) props.onSaved?.();
    observed.current = { context, revision };
  }, [context, revision, props.onSaved]);
  if (!props.isAdmin || !props.token || !props.projectId || props.projectId !== props.loadedProjectId) return null;
  const variants = routingPurposeDisplayLabels(state.rows.map(row => row.purposeKey));
  const cableVariants = routingPurposeDisplayLabels(state.cablePurposes);
  return <section className={props.className} aria-label="Cable positioning">
    <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
      <h2 style={{ fontSize: tokens.fontSizeBase400 }}>Cable positioning</h2>
      <Button onClick={() => void state.refresh()} disabled={state.busy || state.uncertain}>Refresh positioning</Button>
    </div>
    <p>Choose the drawing side for each cable purpose and tray purpose. Columns come from Purpose in the project Cable types. Use default layout keeps the established drawing arrangement.</p>
    <p>Each cable purpose has its own positioning. Existing cable packing rules are retained. These choices affect drawings only.</p>
    {state.loading ? <Spinner size="tiny" label="Loading cable positioning..." /> : null}
    {state.refreshing ? <p role="status">Refreshing current cable positioning...</p> : null}
    {state.saving ? <p role="status">Saving cable positioning...</p> : null}
    {state.notice ? <p role="status">{state.notice}</p> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.conflict ? <div role="alert"><p>{state.conflict}</p><Button disabled={state.busy} onClick={() => void state.refresh(true)}>Discard changes and refresh</Button></div> : null}
    {state.uncertain ? <Button appearance="primary" disabled={!state.canRetrySave} onClick={() => void state.retrySave()}>Retry the same save</Button> : null}
    {state.refreshPrompt ? <div role="alert"><p>Refreshing will discard your unsaved positioning changes.</p>
      <Button disabled={state.busy} onClick={() => void state.refresh(true)}>Discard changes and refresh</Button><Button onClick={state.cancelRefresh}>Keep changes</Button></div> : null}
    {state.snapshot ? <>
      <p>{state.snapshot.catalog.rowCount} trays · {state.rows.filter(row => row.purposeKey !== null).length} purposes · Drawing policy revision {state.snapshot.policy.drawingPolicyRevision}</p>
      {state.invalidCablePurposeCount > 0 ? <p role="alert">{state.invalidCablePurposeCount} invalid Purpose values are unavailable for positioning. Correct Purpose in Cable types, then refresh positioning.</p> : null}
      {!state.cablePurposes.length ? <p>No cable purposes are available. Add a Purpose to the project Cable types, then refresh positioning.</p> : null}
      {state.snapshot.catalog.diagnostics.length ? <div><p>Purpose identity issues block the affected rows. Drawing dimensions and routing names do not block positioning choices.</p>
        <ul>{state.snapshot.catalog.diagnostics.map((item, index) => <li key={index}>{item.message}</li>)}</ul></div> : null}
      <div style={{ overflowX: 'auto', maxHeight: 600 }}><table style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="Cable positioning by tray purpose">
        <thead><tr><th scope="col">Tray purpose</th><th scope="col">Trays</th>{state.cablePurposes.map(category => <th scope="col" key={category} style={{ whiteSpace: 'pre-wrap' }}>{category}{cableVariants.get(category) ? <div>{cableVariants.get(category)!.variant} · {cableVariants.get(category)!.exactSpacing}</div> : null}</th>)}<th scope="col">Actions</th></tr></thead>
        <tbody>{state.rows.map(row => {
          const label = row.purposeKey ?? 'Missing purpose'; const variant = row.purposeKey === null ? undefined : variants.get(row.purposeKey); const accessible = variant?.label ?? label;
          return <tr key={row.purposeKey ?? 'missing-purpose'} style={{ borderTop: `1px solid ${tokens.colorNeutralStroke2}` }}>
            <th scope="row" style={{ textAlign: 'left', overflowWrap: 'anywhere', padding: 8 }}><span style={{ whiteSpace: 'pre-wrap' }}>{label}</span>
              {variant ? <div>{variant.variant} · Spaces shown as dots: {variant.exactSpacing}</div> : null}
              <div>{row.configured ? 'Custom positioning' : 'Use default layout'}{row.blocked ? ' · Purpose unavailable' : ''}{row.dirty ? ' · Unsaved' : ''}</div></th>
            <td>{row.trayCount}</td>{state.cablePurposes.map(category => <td key={category} style={{ minWidth: 160 }}>
              {(['left', 'right'] as const).map(mode => <Checkbox key={mode} label={mode === 'left' ? 'Left' : 'Right'} aria-label={`${cableVariants.get(category)?.label ?? category} ${mode === 'left' ? 'Left' : 'Right'} for ${accessible}`}
                checked={row.purposeModes[category] === mode} disabled={!state.canEdit || row.blocked} onChange={(_, data) => { if (row.purposeKey !== null) state.setMode(row.purposeKey, category, data.checked === true ? mode : 'use-default'); }} />)}
              <Button size="small" aria-label={`Use default layout for ${cableVariants.get(category)?.label ?? category} in ${accessible}`} disabled={!state.canEdit || row.blocked || row.purposeModes[category] === 'use-default'}
                onClick={() => { if (row.purposeKey !== null) state.setMode(row.purposeKey, category, 'use-default'); }}>Use default layout</Button>
              {row.purposeModes[category] === 'use-default' ? <div>Using default layout</div> : null}
            </td>)}<td><Button size="small" aria-label={`Reset positioning for ${accessible}`} disabled={!state.canEdit || row.blocked || !row.configured}
              onClick={() => { if (row.purposeKey !== null) state.reset(row.purposeKey); }}>Reset all to default</Button></td>
          </tr>;
        })}</tbody></table></div>
      {!state.rows.length ? <p>No trays are available in this project.</p> : null}
      <Button appearance="primary" disabled={!state.canSave} onClick={() => void state.save()}>Save cable positioning</Button>{state.dirty ? <span> Unsaved changes</span> : null}
      <details><summary>Positioning history</summary><Button disabled={state.historyLoading || state.saving} onClick={() => void state.refreshHistory()}>Refresh history</Button>
        {state.historyLoading ? <p role="status">Loading positioning history...</p> : null}{state.historyError ? <p role="alert">{state.historyError}</p> : null}
        {state.history && !state.history.events.length ? <p>No positioning changes have been recorded.</p> : null}
        <ol>{state.history?.events.map(event => <li key={event.auditId}>Revision {event.revision} · {event.occurredAt} · Administrator {event.actorId}</li>)}</ol>
        {state.history?.nextBeforeRevision ? <Button disabled={state.historyLoading || state.saving} onClick={() => void state.moreHistory()}>Load older changes</Button> : null}
      </details>
    </> : null}
  </section>;
}
