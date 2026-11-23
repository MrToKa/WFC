import { generateId } from '@/utils/generateId';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Caption1, ProgressBar, Spinner } from '@fluentui/react-components';
import { usePathfinderRecalculations, type RecalculationAccess } from './hooks/usePathfinderRecalculations';
import type { RecalculationCommand } from '@/api/pathfinderRecalculations';
import type { PathFinderPreferences } from '@/api/pathfinder';
import { recalculationPreferencesSchema, recalculationTimeoutSchema } from '../../../shared/pathfinderRecalculation';
import { AUTOMATIC_PAIR_POLICY } from '../../../shared/pathfinderAutomaticPair';

export type RecalculationPanelProps = RecalculationAccess & { preferences: PathFinderPreferences | null | undefined;
  configurationMessage?: string | null; onConfigureCalculation?: () => void;
  prepareEnable?: (signal: AbortSignal) => Promise<PathFinderPreferences>; preparationAvailable?: boolean;
  onReviewReady?: (jobId: string) => void };
const labels: Record<string, string> = {
  disabled: 'Disabled', awaiting_authority: 'Automatic recalculation needs enabling again', paused: 'Paused', debouncing: 'Collecting recent changes',
  collecting: 'Checking project inputs', queued: 'Queued', calculating: 'Calculating', complete: 'Complete', blocked: 'Action required', superseded: 'Newer changes pending', failed: 'Calculation failed',
};
export function PathFinderRecalculationPanel(props: RecalculationPanelProps) {
  const state = usePathfinderRecalculations(props), [timeout, setTimeout] = useState('60000');
  const context = state.context;
  const { prepareEnable, preparationAvailable } = props;
  const owner = JSON.stringify([props.projectId, props.loadedProjectId, props.accountId, props.token, props.contextKey, props.active]);
  const latestOwner = useRef(owner); latestOwner.current = owner;
  const [networkAction, setNetworkAction] = useState<{ owner: string; working: boolean; error: string | null } | null>(null);
  const currentNetworkAction = networkAction?.owner === owner ? networkAction : null;
  const activePreparation = useRef<AbortController | null>(null);
  useEffect(() => () => {
    activePreparation.current?.abort(); activePreparation.current = null;
  }, [owner]);
  const prepareNetwork = useCallback(async (then: (preferences: PathFinderPreferences) => void) => {
    if (!prepareEnable || activePreparation.current) return;
    const controller = new AbortController(), { signal } = controller;
    activePreparation.current = controller;
    setNetworkAction({ owner, working: true, error: null });
    try {
      const preferences = await prepareEnable(signal);
      if (!signal.aborted && latestOwner.current === owner) { setNetworkAction(null); then(preferences); }
    } catch (error) {
      if (!signal.aborted && latestOwner.current === owner) setNetworkAction({ owner, working: false,
        error: error instanceof Error ? error.message : 'Routing preparation could not be completed.' });
    } finally {
      if (activePreparation.current === controller) activePreparation.current = null;
    }
  }, [owner, prepareEnable]);
  const frozen = state.busy || Boolean(state.pending) || Boolean(currentNetworkAction?.working);
  const unavailable = !props.active || !context || frozen || state.conflict;
  const expired = Boolean(context?.authority && Date.parse(context.authority.expiresAt) <= Date.now());
  const requiresPauseBeforeEnable = Boolean(prepareEnable && context?.enabled && !context.paused
    && !expired && context.status !== 'awaiting_authority');
  const prepareResume = context?.automaticRunUntil === 'login-expiry';
  const canPrepareResume = !prepareResume || Boolean(prepareEnable && preparationAvailable);
  const timeoutValue = Number(timeout), validPreferences = recalculationPreferencesSchema.safeParse(props.preferences).success,
    validTimeout = recalculationTimeoutSchema.safeParse(timeoutValue).success,
    validOptions = validTimeout && (prepareEnable ? Boolean(preparationAvailable) : validPreferences);
  const send = (action: RecalculationCommand['action']) => {
    if (unavailable || !context || action === 'enable' && (!validOptions || requiresPauseBeforeEnable)
      || action === 'resume' && !canPrepareResume) return;
    const common = { schemaVersion: 'wfc.pf.recalculation-command.v1' as const, expectedControlRevision: context.controlRevision, idempotencyKey: generateId(), reason: `Administrator requested ${action} from Path Finder.` };
    if ((action === 'resume' || action === 'retry') && !context.automaticPairPolicy) return;
    if (action === 'enable') {
      const enable = (preferences: PathFinderPreferences) => state.command({ ...common, schemaVersion: 'wfc.pf.recalculation-command.v2', action,
        preferences, timeoutMilliseconds: timeoutValue, automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY }, runUntil: 'login-expiry' });
      if (prepareEnable) void prepareNetwork(enable);
      else enable({ ...props.preferences! });
      return;
    }
    const command: RecalculationCommand = action === 'resume' || action === 'retry'
      ? { ...common, schemaVersion: 'wfc.pf.recalculation-command.v2', action, automaticPairPolicy: { ...AUTOMATIC_PAIR_POLICY } }
      : { ...common, action };
    if (action === 'resume' && prepareResume) void prepareNetwork(() => state.command(command));
    else state.command(command);
  };
  const differentPreferences = context?.preferences && props.preferences && (context.preferences.secondaryDistanceMeters !== props.preferences.secondaryDistanceMeters || context.preferences.preferVerticalApproach !== props.preferences.preferVerticalApproach);
  const progress = context?.progress && context.progress.jobId === context.jobId
    && context.progress.generation === context.desiredGeneration && context.enrolledGeneration === context.desiredGeneration ? context.progress : null;
  const reviewJob = state.enabled && context?.status === 'complete' && progress && progress.reviewRequired > 0
    && progress.waiting + progress.running + progress.saving === 0 ? progress.jobId : null;
  const reportedReview = useRef<string | null>(null);
  const { onReviewReady } = props;
  useEffect(() => {
    if (!reviewJob || reportedReview.current === reviewJob || !onReviewReady) return;
    reportedReview.current = reviewJob;
    onReviewReady(reviewJob);
  }, [reviewJob, onReviewReady]);
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
  const statusLabel = context ? expired ? 'Automatic recalculation authorization ended. Enable again for new changes.'
    : context.status === 'complete' ? 'Calculation finished. Detailed saving status is unavailable.' : labels[context.status] ?? context.status : null;
  if (!state.enabled) return null;
  return <section aria-label="Automatic recalculation" style={{ display: 'grid', gap: 8, minWidth: 0, overflowWrap: 'anywhere' }}>
    <h4>Automatic recalculation</h4>
    <Caption1>Automatic recalculation runs while the enabling administrator’s login is valid, including while this page is closed.</Caption1>
    <Caption1>Automatically saves Routing and Design length in Cable list for eligible cables with an empty or unchanged automatic route. Cables with manual or execution protection keep their current routes.</Caption1>
    <Caption1>The separate Background model recalculation setting calculates proposals only.</Caption1>
    <Caption1>Resume and Retry keep the original authorization end time.</Caption1>
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
        {progress.reviewRequired > 0 ? <p>Protected or requiring review: {progress.reviewRequired}.</p> : null}
        {progress.refused > 0 ? <p>Automatic saving refused: {progress.refused}.</p> : null}
        {progress.authorityExpired > 0 ? <p>Automatic saving authorization expired ({progress.authorityExpired}).</p> : null}
        {progress.stale > 0 ? <p>Results no longer current: {progress.stale}.</p> : null}
        {(progress.unchanged ?? 0) > 0 ? <p>Unchanged cable values: {progress.unchanged}.</p> : null}
        {progress.notScheduledForSave > 0 ? <p>{context.automaticPairPolicy ? 'Results not scheduled for automatic saving' : 'Proposals without automatic saving'}: {progress.notScheduledForSave}.</p> : null}
        {progress.calculationFailed > 0 ? <p>Other outcomes needing attention: {progress.calculationFailed}.</p> : null}
      </div> : preparing ? <>
        <ProgressBar aria-label="Preparing automatic calculation" />
        <Caption1>Eligible cables and saved results will appear after the current project inputs have been checked.</Caption1>
      </> : <Caption1>Detailed progress for the current calculation is not available yet.</Caption1>}
      {context.authority ? <Caption1>{expired ? 'Previous enablement ended at ' : 'Enabled until '}{context.authority.expiresAt}{context.authority.currentLogin ? ' with this login.' : ' with another login; this does not grant this account authority.'}</Caption1> : <Caption1>No current login enablement.</Caption1>}
      {context.preferences ? <Caption1>The saved SECONDARY trigger is {context.preferences.secondaryDistanceMeters} m. Vertical approach is {context.preferences.preferVerticalApproach ? 'preferred' : 'not preferred'}. The timeout per cable is {context.timeoutMilliseconds} ms.</Caption1> : null}
      {context.enabled ? <Caption1>{context.automaticPairPolicy
        ? 'Saved Cable list policy: update unprotected cables. Manual and execution protection retain the used route.'
        : 'Automatic Cable list updates are off. Choose Enable automatic recalculation to authorize automatic updates.'}</Caption1> : null}
      {differentPreferences ? <Caption1>The Path values differ from the saved automatic preferences. Enable again to use the current values.</Caption1> : null}
      {context.reasonCodes.length ? <ul aria-label="Recalculation reasons">{context.reasonCodes.map(reason => <li key={reason}>{reason.toLowerCase().replaceAll('_', ' ')}</li>)}</ul> : null}
    </> : null}
    {!context && props.active && !state.error && !state.busy && !state.unknown ? <Spinner size="tiny" label="Loading automatic calculation status…" /> : null}
    <label>Calculation timeout per cable (ms)<input type="number" min="100" max="120000" step="100" value={timeout} disabled={frozen || !props.active} onChange={event => setTimeout(event.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} /></label>
    {!validPreferences ? <div role="alert"><Caption1>{props.configurationMessage ?? 'Configure the Path settings and Barriers before enabling automatic recalculation.'}</Caption1>
      {props.onConfigureCalculation ? <Button onClick={props.onConfigureCalculation}>Configure automatic calculation</Button> : null}</div> : null}
    {!validTimeout ? <Caption1 role="alert">Enter a timeout from 100 to 120000 ms per cable.</Caption1> : null}
    {requiresPauseBeforeEnable ? <Caption1>Pause automatic recalculation before preparing the network to enable it again.</Caption1> : null}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <Button disabled={unavailable || !validOptions || requiresPauseBeforeEnable} onClick={() => send('enable')}>Enable automatic recalculation</Button>
      <Button disabled={unavailable || !context?.enabled || context.paused} onClick={() => send('pause')}>Pause automatic recalculation</Button>
      <Button disabled={unavailable || !context?.enabled || !context.paused || !context.automaticPairPolicy || !canPrepareResume} onClick={() => send('resume')}>Resume automatic recalculation</Button>
      <Button disabled={unavailable || !context?.enabled || context.paused || !context.automaticPairPolicy} onClick={() => send('retry')}>Retry recalculation</Button>
      <Button disabled={unavailable || !context?.enabled} onClick={() => send('disable')}>Disable automatic recalculation</Button>
      <Button disabled={state.busy || !props.active} onClick={() => void state.refresh()}>Refresh recalculation status</Button>
    </div>
    {state.busy ? <Spinner size="tiny" label="Saving recalculation command…" /> : null}
    {currentNetworkAction?.working ? <Spinner size="tiny" label="Checking trays and From/To locations…" /> : null}
    {currentNetworkAction?.error ? <Caption1 role="alert">{currentNetworkAction.error}</Caption1> : null}
    {state.unknown ? <><p role="alert">The command outcome is unknown. Changes are locked until the same command is reconciled. Changing model or Path values does not replace it.</p><Button disabled={!props.active || state.busy || !context} onClick={state.retry}>Retry saved command</Button></> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.conflict ? <Button disabled={state.busy || !props.active} onClick={state.discardConflict}>Discard refused command and refresh</Button> : null}
  </section>;
}
