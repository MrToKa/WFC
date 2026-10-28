import { useState } from 'react';
import { Button, Caption1, ProgressBar, Spinner } from '@fluentui/react-components';
import { usePathfinderRecalculations, type RecalculationAccess } from './hooks/usePathfinderRecalculations';
import type { RecalculationCommand } from '@/api/pathfinderRecalculations';
import { recalculationPreferencesSchema, recalculationTimeoutSchema } from '../../../shared/pathfinderRecalculation';
import { AUTOMATIC_PAIR_POLICY } from '../../../shared/pathfinderAutomaticPair';

export type RecalculationPanelProps = RecalculationAccess & { preferences: { secondaryDistanceMeters: number; preferVerticalApproach: boolean } | null | undefined };
const labels: Record<string, string> = {
  disabled: 'Disabled', awaiting_authority: 'Automatic recalculation needs enabling again', paused: 'Paused', debouncing: 'Collecting recent changes',
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
    if ((action === 'resume' || action === 'retry') && !context.automaticPairPolicy) return;
    state.command(action === 'enable' ? { ...common, schemaVersion: 'wfc.pf.recalculation-command.v2', action,
      preferences: { ...props.preferences! }, timeoutMilliseconds: timeoutValue, automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } }
      : action === 'resume' || action === 'retry' ? { ...common, schemaVersion: 'wfc.pf.recalculation-command.v2', action, automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } }
        : { ...common, action });
  };
  const differentPreferences = context?.preferences && props.preferences && (context.preferences.secondaryDistanceMeters !== props.preferences.secondaryDistanceMeters || context.preferences.preferVerticalApproach !== props.preferences.preferVerticalApproach);
  const progress = context?.progress && context.progress.jobId === context.jobId
    && context.progress.generation === context.desiredGeneration && context.enrolledGeneration === context.desiredGeneration ? context.progress : null;
  const expired = Boolean(context?.authority && Date.parse(context.authority.expiresAt) <= Date.now());
  const stopped = !context?.enabled || context.paused || expired || ['disabled', 'awaiting_authority', 'paused', 'blocked', 'superseded', 'failed'].includes(context.status);
  const preparing = !progress && Boolean(context?.enabled && !stopped && ['debouncing', 'collecting', 'queued', 'calculating'].includes(context.status));
  const processing = Boolean(progress && progress.waiting + progress.running > 0), saving = Boolean(progress?.saving);
  const working = props.active && !stopped && (preparing || processing || saving && Boolean(context?.automaticPairPolicy));
  const needsAttention = progress ? progress.calculationFailed + progress.reviewRequired + progress.refused + progress.authorityExpired + progress.stale
    + (context?.automaticPairPolicy ? progress.notScheduledForSave : 0) : 0;
  const progressLabel = preparing ? 'Preparing automatic calculation…'
    : processing ? 'Calculating routes…'
      : saving ? context?.automaticPairPolicy ? 'Saving or confirming calculated results…' : 'Calculation finished. Automatic saving is off; some results are unconfirmed.'
        : progress?.eligible === 0 ? 'No cables are eligible for calculation.'
          : needsAttention ? 'Calculations finished. Some results need attention.'
            : progress && progress.saved === progress.calculated && progress.calculated > 0 ? 'All calculated routes have been saved in Cable list.'
              : progress ? 'Proposals calculated. Automatic saving is off.' : null;
  const statusLabel = context ? expired ? 'The automatic recalculation period ended. Enable again for new changes.'
    : context.status === 'complete' ? 'Calculation finished. Detailed saving status is unavailable.' : labels[context.status] ?? context.status : null;
  return <section aria-label="Automatic recalculation" style={{ display: 'grid', gap: 8, minWidth: 0, overflowWrap: 'anywhere' }}>
    <h4>Automatic recalculation</h4>
    <Caption1>Enable for 30 minutes using this administrator login. Empty Routing and Design length fields, or unchanged values previously saved automatically by Path Finder, update automatically. Manually edited cable values still require Review and Apply.</Caption1>
    <Caption1>The separate Background model recalculation setting calculates proposals only.</Caption1>
    <Caption1>Resume and Retry keep the original end time for automatic Cable list updates. Enable again starts a new period of up to 30 minutes.</Caption1>
    {context ? <>
      <div role="status">{working ? <Spinner size="tiny" label={progressLabel!} /> : !stopped && progress ? progressLabel : statusLabel}</div>
      {progress ? <div aria-label="Automatic calculation progress" aria-live="polite">
        <p>Processed {progress.processed} / {progress.eligible} eligible cables.</p>
        <ProgressBar aria-label="Eligible cable calculation" max={Math.max(1, progress.eligible)} value={progress.processed}
          aria-valuetext={`${progress.processed} of ${progress.eligible} eligible cables processed`} />
        <p>Calculated routes: {progress.calculated}. Saved in Cable list: {progress.saved}.</p>
        <Caption1>Not eligible before calculation: {progress.blockedInputs} of {progress.total} cables.</Caption1>
        {stopped && !processing && !saving && progressLabel ? <p role="status">{progressLabel}</p> : null}
        {!working && (processing || saving) ? <Caption1>Progress is retained. Processing and automatic saving are not currently active.</Caption1> : null}
        {progress.saving > 0 ? <p>Waiting for saving or confirmation: {progress.saving}.</p> : null}
        {progress.reviewRequired > 0 ? <p>Review and Apply required: {progress.reviewRequired}.</p> : null}
        {progress.refused > 0 ? <p>Automatic saving refused: {progress.refused}.</p> : null}
        {progress.authorityExpired > 0 ? <p>Automatic saving period ended before saving: {progress.authorityExpired}.</p> : null}
        {progress.stale > 0 ? <p>Results no longer current: {progress.stale}.</p> : null}
        {progress.notScheduledForSave > 0 ? <p>{context.automaticPairPolicy ? 'Results not scheduled for automatic saving' : 'Proposals without automatic saving'}: {progress.notScheduledForSave}.</p> : null}
        {progress.calculationFailed > 0 ? <p>Other outcomes needing attention: {progress.calculationFailed}.</p> : null}
      </div> : preparing ? <>
        <ProgressBar aria-label="Preparing automatic calculation" />
        <Caption1>Eligible cables and saved results will appear after the current project inputs have been checked.</Caption1>
      </> : <Caption1>Detailed progress for the current calculation is not available yet.</Caption1>}
      {context.authority ? <Caption1>{expired ? 'Previous enablement ended at ' : 'Enabled until '}{context.authority.expiresAt}{context.authority.currentLogin ? ' with this login.' : ' with another login; this does not grant this account authority.'}</Caption1> : <Caption1>No current login enablement.</Caption1>}
      {context.preferences ? <Caption1>Saved SECONDARY trigger: {context.preferences.secondaryDistanceMeters} m; vertical approach {context.preferences.preferVerticalApproach ? 'preferred' : 'not preferred'}. Timeout: {context.timeoutMilliseconds} ms.</Caption1> : null}
      {context.enabled ? <Caption1>{context.automaticPairPolicy
        ? 'Saved Cable list policy: update empty or unchanged automatic Routing and Design length values. Manually edited values are kept for Review and Apply.'
        : 'Automatic Cable list updates are off. Choose Enable for 30 minutes again before resuming or retrying with automatic updates.'}</Caption1> : null}
      {differentPreferences ? <Caption1>The Path values differ from the saved automatic preferences. Enable again to use the current values.</Caption1> : null}
      {context.reasonCodes.length ? <ul aria-label="Recalculation reasons">{context.reasonCodes.map(reason => <li key={reason}>{reason.toLowerCase().replaceAll('_', ' ')}</li>)}</ul> : null}
    </> : null}
    {!context && props.active && !state.error && !state.busy && !state.unknown ? <Spinner size="tiny" label="Loading automatic calculation status…" /> : null}
    <label>Automatic calculation timeout (ms)<input aria-label="Automatic calculation timeout (ms)" type="number" min="100" max="120000" step="100" value={timeout} disabled={frozen || !props.active} onChange={event => setTimeout(event.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} /></label>
    {!validOptions ? <Caption1>Enter valid Path preferences and a timeout from 100 to 120000 ms before enabling.</Caption1> : null}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <Button disabled={unavailable || !validOptions} onClick={() => send('enable')}>Enable for 30 minutes</Button>
      <Button disabled={unavailable || !context?.enabled || context.paused} onClick={() => send('pause')}>Pause automatic recalculation</Button>
      <Button disabled={unavailable || !context?.enabled || !context.paused || !context.automaticPairPolicy} onClick={() => send('resume')}>Resume automatic recalculation</Button>
      <Button disabled={unavailable || !context?.enabled || context.paused || !context.automaticPairPolicy} onClick={() => send('retry')}>Retry recalculation</Button>
      <Button disabled={unavailable || !context?.enabled} onClick={() => send('disable')}>Disable automatic recalculation</Button>
      <Button disabled={state.busy || !props.active} onClick={() => void state.refresh()}>Refresh recalculation status</Button>
    </div>
    {state.busy ? <Spinner size="tiny" label="Saving recalculation command…" /> : null}
    {state.unknown ? <><p role="alert">The command outcome is unknown. Changes are locked until the same command is reconciled. Changing model or Path values does not replace it.</p><Button disabled={!props.active || state.busy || !context} onClick={state.retry}>Retry saved command</Button></> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.conflict ? <Button disabled={state.busy || !props.active} onClick={state.discardConflict}>Discard refused command and refresh</Button> : null}
  </section>;
}
