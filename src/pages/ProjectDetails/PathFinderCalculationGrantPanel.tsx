import { generateId } from '@/utils/generateId';
import { useState } from 'react';
import { Button, Caption1, Checkbox, Spinner } from '@fluentui/react-components';
import { usePathfinderCalculationGrants, type CalculationGrantAccess } from './hooks/usePathfinderCalculationGrants';
import type { CalculationGrantCommand } from '@/api/pathfinderCalculationGrants';
import { recalculationPreferencesSchema, recalculationTimeoutSchema } from '../../../shared/pathfinderRecalculation';
import type { PathFinderPreferences } from '@/api/pathfinder';
import { sameSupportedBarrierAdmissionIntent as sameBarrierAdmissionIntent } from '../../../shared/pathfinderBarrierSupported';

export type CalculationGrantPanelProps = CalculationGrantAccess & {
  preferences: PathFinderPreferences | null | undefined; className?: string;
};
const statusLabels = { disabled: 'Disabled', enabled: 'Enabled', revoked: 'Administrator authorization revoked', 'restore-fenced': 'Enable again after restore', blocked: 'Action required' };
const producerLabels = { unqualified: 'Model preparation not qualified', ready: 'Model preparation ready', running: 'Preparing model', blocked: 'Geometry pending — model preparation blocked', quarantined: 'Model preparation stopped' };
const reasonLabel = (value: string) => value.toLowerCase().replaceAll('_', ' ');

/** Explicit project setting. This panel neither schedules work nor grants Review/Apply authority. */
export function PathFinderCalculationGrantPanel(props: CalculationGrantPanelProps) {
  const state = usePathfinderCalculationGrants(props), [timeout, setTimeout] = useState('60000');
  const [draft, setDraft] = useState<{ key: string; checked: boolean } | null>(null);
  if (!state.enabled) return null;
  const context = state.context, grant = context?.grant;
  const persistedEnabled = Boolean(grant?.enabled && context?.status !== 'restore-fenced' && context?.status !== 'revoked');
  const key = JSON.stringify([props.projectId, props.accountId, props.token, context?.controlRevision, persistedEnabled]);
  const checked = draft?.key === key ? draft.checked : persistedEnabled;
  const frozen = state.busy || Boolean(state.pending), unavailable = !props.active || !context || frozen || state.conflict;
  const timeoutValue = timeout.trim() ? Number(timeout) : NaN;
  const validOptions = recalculationPreferencesSchema.safeParse(props.preferences).success && recalculationTimeoutSchema.safeParse(timeoutValue).success;
  const samePreferences = Boolean(grant && props.preferences && grant.preferences.secondaryDistanceMeters === props.preferences.secondaryDistanceMeters && grant.preferences.preferVerticalApproach === props.preferences.preferVerticalApproach
    && sameBarrierAdmissionIntent(grant.preferences.barrierRouting,props.preferences.barrierRouting) && grant.timeoutMilliseconds === timeoutValue);
  const changed = checked !== persistedEnabled || checked && !samePreferences;
  const save = () => {
    if (unavailable || !context || !changed || checked && !validOptions) return;
    const common = { schemaVersion: 'wfc.pf.calculation-grant-command.v1' as const, expectedControlRevision: context.controlRevision, idempotencyKey: generateId(), reason: `Administrator requested ${checked ? 'enable' : 'disable'} for background model recalculation.` };
    const command: CalculationGrantCommand = checked ? { ...common, action: 'enable', preferences: { ...props.preferences! }, timeoutMilliseconds: timeoutValue } : { ...common, action: 'disable' };
    state.command(command);
  };
  return <section className={props.className} aria-label="Background model recalculation" style={{ display: 'grid', gap: 8, minWidth: 0, overflowWrap: 'anywhere' }}>
    <h3>Background model recalculation</h3>
    <Checkbox label="Automatically recalculate model revisions" checked={checked} disabled={unavailable} onChange={(_, value) => setDraft({ key, checked: value.checked === true })} />
    <Caption1>Calculates proposals for this project and its active model, including while this page is closed. Model preparation requires an available, qualified preparation service.</Caption1>
    <Caption1>Calculation only. Shared location confirmations, engineering review and Apply remain manual. Cable routing and lengths are not applied automatically.</Caption1>
    {context ? <>
      <div role="status">{statusLabels[context.status]}</div>
      <Caption1>{producerLabels[context.producer.status]}</Caption1>
      {context.producer.status !== 'ready' && context.producer.status !== 'running' ? <Caption1>Geometry pending: new model revisions cannot be prepared until this condition is resolved. Enabling the setting does not mark preparation as ready.</Caption1> : null}
      {grant ? <>
        <Caption1>Grant revision {grant.grantRevision}; control revision {context.controlRevision}. Scope: current project and active model.</Caption1>
        <Caption1>Enabled by administrator {grant.enabledBy} at {grant.enabledAt}. Updated {grant.updatedAt}.</Caption1>
        <Caption1>Saved SECONDARY trigger: {grant.preferences.secondaryDistanceMeters} m; vertical approach {grant.preferences.preferVerticalApproach ? 'preferred' : 'not preferred'}. Timeout: {grant.timeoutMilliseconds} ms.</Caption1>
      </> : <Caption1>No background calculation authorization has been saved.</Caption1>}
      {context.reasonCodes.length || context.producer.reasonCode ? <ul aria-label="Background calculation reasons">{[...new Set([...context.reasonCodes, ...(context.producer.reasonCode ? [context.producer.reasonCode] : [])])].map(reason => <li key={reason}>{reasonLabel(reason)}</li>)}</ul> : null}
    </> : null}
    <label>Background calculation timeout (ms)<input aria-label="Background calculation timeout (ms)" type="number" min="100" max="120000" step="100" value={timeout} disabled={frozen || !props.active} onChange={event => setTimeout(event.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} /></label>
    {checked && !validOptions ? <Caption1>Use valid Path preferences and a timeout from 100 to 120000 ms before enabling background calculation.</Caption1> : null}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <Button appearance="primary" disabled={unavailable || !changed || checked && !validOptions} onClick={save}>Save background calculation setting</Button>
      <Button disabled={frozen || !props.active} onClick={() => void state.refresh()}>Refresh background status</Button>
    </div>
    {state.busy ? <Spinner size="tiny" label="Saving background calculation setting…" /> : null}
    {state.unknown ? <><p role="alert">The command outcome is unknown. Reconcile the same saved command before changing this setting.</p><Button disabled={!props.active || state.busy || !context} onClick={state.retry}>Retry saved background command</Button></> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.conflict ? <Button disabled={state.busy || !props.active} onClick={state.discardConflict}>Discard refused background command and refresh</Button> : null}
  </section>;
}
