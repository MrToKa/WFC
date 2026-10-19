import { useState } from 'react';
import { Button, Caption1, Spinner } from '@fluentui/react-components';
import { usePathfinderRecalculations, type RecalculationAccess } from './hooks/usePathfinderRecalculations';
import type { RecalculationCommand } from '@/api/pathfinderRecalculations';
import { recalculationPreferencesSchema, recalculationTimeoutSchema } from '../../../shared/pathfinderRecalculation';

export type RecalculationPanelProps = RecalculationAccess & { preferences: { secondaryDistanceMeters: number; preferVerticalApproach: boolean } | null | undefined };
const labels: Record<string, string> = {
  disabled: 'Disabled', awaiting_authority: 'Administrator enablement required', paused: 'Paused', debouncing: 'Collecting recent changes',
  collecting: 'Checking project inputs', queued: 'Queued', calculating: 'Calculating', complete: 'Complete', blocked: 'Action required', superseded: 'Newer changes pending', failed: 'Calculation failed',
};
export function PathFinderRecalculationPanel(props: RecalculationPanelProps) {
  const state = usePathfinderRecalculations(props), [timeout, setTimeout] = useState('60000');
  if (!state.enabled) return null;
  const context = state.context;
  const frozen = state.busy || Boolean(state.pending), unavailable = !props.active || !context || frozen || state.conflict;
  const timeoutValue = Number(timeout), validOptions = recalculationPreferencesSchema.safeParse(props.preferences).success && recalculationTimeoutSchema.safeParse(timeoutValue).success;
  const send = (action: RecalculationCommand['action']) => {
    if (unavailable || !context || action === 'enable' && !validOptions) return;
    const common = { schemaVersion: 'wfc.pf.recalculation-command.v1' as const, expectedControlRevision: context.controlRevision, idempotencyKey: crypto.randomUUID(), reason: `Administrator requested ${action} from Path Finder.` };
    state.command(action === 'enable' ? { ...common, action, preferences: { ...props.preferences! }, timeoutMilliseconds: timeoutValue } : { ...common, action });
  };
  const differentPreferences = context?.preferences && props.preferences && (context.preferences.secondaryDistanceMeters !== props.preferences.secondaryDistanceMeters || context.preferences.preferVerticalApproach !== props.preferences.preferVerticalApproach);
  return <section aria-label="Automatic recalculation" style={{ display: 'grid', gap: 8, minWidth: 0, overflowWrap: 'anywhere' }}>
    <h4>Automatic recalculation</h4>
    <Caption1>Enable for 30 minutes using this administrator login. Results remain proposals; review and Apply are separate decisions.</Caption1>
    {context ? <>
      <div role="status">{labels[context.status] ?? context.status}</div>
      <Caption1>Progress: {context.completed} / {context.total} cables. Ready: {context.readyCables}; blocked: {context.blockedCables}.</Caption1>
      <Caption1>Project changes: {context.desiredGeneration}; enrolled: {context.enrolledGeneration ?? 'None'}.</Caption1>
      {context.authority ? <Caption1>Enabled until {context.authority.expiresAt}{context.authority.currentLogin ? ' with this login.' : ' with another login; this does not grant this account authority.'}</Caption1> : <Caption1>No current login enablement.</Caption1>}
      {context.preferences ? <Caption1>Saved SECONDARY trigger: {context.preferences.secondaryDistanceMeters} m; vertical approach {context.preferences.preferVerticalApproach ? 'preferred' : 'not preferred'}. Timeout: {context.timeoutMilliseconds} ms.</Caption1> : null}
      {differentPreferences ? <Caption1>The Path values differ from the saved automatic preferences. Enable again to use the current values.</Caption1> : null}
      {context.reasonCodes.length ? <ul aria-label="Recalculation reasons">{context.reasonCodes.map(reason => <li key={reason}>{reason.toLowerCase().replaceAll('_', ' ')}</li>)}</ul> : null}
    </> : null}
    <label>Automatic calculation timeout (ms)<input aria-label="Automatic calculation timeout (ms)" type="number" min="100" max="120000" step="100" value={timeout} disabled={frozen || !props.active} onChange={event => setTimeout(event.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} /></label>
    {!validOptions ? <Caption1>Enter valid Path preferences and a timeout from 100 to 120000 ms before enabling.</Caption1> : null}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <Button disabled={unavailable || !validOptions} onClick={() => send('enable')}>Enable for 30 minutes</Button>
      <Button disabled={unavailable || !context?.enabled || context.paused} onClick={() => send('pause')}>Pause automatic recalculation</Button>
      <Button disabled={unavailable || !context?.enabled || !context.paused} onClick={() => send('resume')}>Resume automatic recalculation</Button>
      <Button disabled={unavailable || !context?.enabled || context.paused} onClick={() => send('retry')}>Retry recalculation</Button>
      <Button disabled={unavailable || !context?.enabled} onClick={() => send('disable')}>Disable automatic recalculation</Button>
      <Button disabled={frozen || !props.active} onClick={() => void state.refresh()}>Refresh recalculation status</Button>
    </div>
    {state.busy ? <Spinner size="tiny" label="Saving recalculation command…" /> : null}
    {state.unknown ? <><p role="alert">The command outcome is unknown. Changes are locked until the same command is reconciled. Changing model or Path values does not replace it.</p><Button disabled={!props.active || state.busy || !context} onClick={state.retry}>Retry saved command</Button></> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.conflict ? <Button disabled={state.busy || !props.active} onClick={state.discardConflict}>Discard refused command and refresh</Button> : null}
  </section>;
}
