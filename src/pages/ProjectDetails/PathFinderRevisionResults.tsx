import { useEffect, useId, useRef, useState } from 'react';
import { Button, Caption1, Spinner } from '@fluentui/react-components';
import { usePathfinderRevisionResults, type RevisionResultsAccess } from './hooks/usePathfinderRevisionResults';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';
import type { RevisionResultDetail } from '@/api/pathfinderRevisionResults';

export type PathFinderRevisionResultsProps = RevisionResultsAccess & {
  onOpenProposal: (proposalId: string) => void | Promise<void>; busy?: boolean;
};
type Model = NonNullable<RevisionResultDetail['row']['result']>['newModel'];
const unavailable = 'Unavailable';
const text = (value: string | null | undefined) => value ?? unavailable;
const metres = (value: string | number | null | undefined) => value === null || value === undefined ? unavailable : `${value} m`;
const signedMetres = (value: string | number | null | undefined) => value === null || value === undefined ? unavailable
  : `${typeof value === 'number' ? value > 0 ? '+' : '' : !value.startsWith('-') && !/^0(?:\.0+)?$/.test(value) ? '+' : ''}${value} m`;
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ');
const model = (value: Model) => value ? `${value.id} · selection ${value.selectionRevision}` : unavailable;
const status = (value: string) => ({ calculated: 'Ready for review', locations_required: 'Resolve locations', no_path: 'No connected path',
  settings_required: 'Project values required', category_required: 'Cable category required', stale: 'Outdated', invalid_request: 'Review the input',
  deadline_exceeded: 'Calculation timed out', resource_limit: 'Calculation limit reached' }[value] ?? label(value));
function gaps(result: unknown): { count: number; metres: number } | null {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !('route' in result)) return null;
  const route = result.route;
  if (!route || typeof route !== 'object' || Array.isArray(route) || !('connectionGapCount' in route) || !('connectionGapLengthMeters' in route)) return null;
  return typeof route.connectionGapCount === 'number' && Number.isSafeInteger(route.connectionGapCount) && route.connectionGapCount >= 0
    && typeof route.connectionGapLengthMeters === 'number' && Number.isFinite(route.connectionGapLengthMeters) && route.connectionGapLengthMeters >= 0
    ? { count: route.connectionGapCount, metres: route.connectionGapLengthMeters } : null;
}
function RouteText({ value }: { value: string | null | undefined }) {
  return <details><summary>Exact route</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text(value)}</p></details>;
}
function LengthComponents({ detail }: { detail: RevisionResultDetail }) {
  const ledger = detail.envelope?.lengthLedger, gap = gaps(detail.engineResult);
  if (!ledger) return <p>Exact length components are unavailable for this historical or unsuccessful result.</p>;
  const values: Array<[string, string]> = [
    ['Formula', ledger.formulaVersion], ['Project Details revision', ledger.settingsRevision],
    ['Raw geometric length', metres(ledger.raw.lengthMeters)], ['Raw From approach', metres(ledger.raw.fromDistanceMeters)], ['Raw To approach', metres(ledger.raw.toDistanceMeters)],
    ['C# decimal geometric length', metres(ledger.rawLengthDecimalMeters)],
    ['From uses SECONDARY', ledger.from.requiresSecondary ? 'Yes' : 'No'], ['Removed From approach', metres(ledger.from.removedApproachMeters)],
    ['To uses SECONDARY', ledger.to.requiresSecondary ? 'Yes' : 'No'], ['Removed To approach', metres(ledger.to.removedApproachMeters)],
    ['Secondary tray length', metres(ledger.settings.secondaryTrayLengthMeters)], ['SECONDARY ends', String(ledger.secondaryEnds)],
    ['SECONDARY replacement', metres(ledger.replacementMeters)], ['Before clamp', metres(ledger.beforeClampMeters)],
    ['Clamp adjustment', metres(ledger.clampAdjustmentMeters)], ['After clamp', metres(ledger.afterClampMeters)],
    ['For end connection', metres(ledger.settings.endConnectionLengthMeters)], ['Before percentage', metres(ledger.beforePercentageMeters)],
    ['Additional % for bending', `${ledger.settings.additionalBendingPercent}%`], ['Bending increment', metres(ledger.bendingIncrementMeters)],
    ['Unrounded length', metres(ledger.unroundedMeters)], ['Ceiling increment', metres(ledger.ceilingIncrementMeters)], ['Final design length', metres(ledger.designLengthMeters)],
  ];
  return <section aria-label="Exact length components">
    <h5>Exact length components</h5>
    <Caption1>Recorded calculation values are shown exactly. SECONDARY replaces the flagged approach; end connection is added once before bending and final rounding.</Caption1>
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '4px 12px', overflowWrap: 'anywhere' }}>
      {values.map(([name, value]) => <div key={name} style={{ display: 'contents' }}><dt>{name}</dt><dd style={{ margin: 0 }}>{value}</dd></div>)}
    </dl>
    <p>Connection gaps are already included in raw geometry and are not added again.</p>
    <Caption1>Recorded gaps: {gap ? `${gap.count}; total ${gap.metres} m` : unavailable}.</Caption1>
  </section>;
}

/** Paged inspection only; opening a proposal delegates the existing protected review flow. */
export function PathFinderRevisionResults(props: PathFinderRevisionResultsProps) {
  const state = usePathfinderRevisionResults(props), styles = useRoutingsViewerStyles(), selectId = useId();
  const [opening, setOpening] = useState(false), [openError, setOpenError] = useState<string | null>(null);
  const owner = JSON.stringify([props.projectId, props.loadedProjectId, props.accountId, props.token, props.isAdmin, props.active, props.contextKey,
    state.admission?.id, state.detail?.row.cableId, state.detail?.row.baselineHash, state.detail?.row.result?.revisionResultSha256]);
  const latestOwner = useRef(owner); latestOwner.current = owner;
  const generation = useRef(0);
  useEffect(() => { generation.current++; setOpening(false); setOpenError(null); return () => { generation.current++; }; }, [owner]);
  if (!state.enabled || !props.isAdmin || !props.accountId || !props.token || props.projectId !== props.loadedProjectId) return null;
  const loading = state.admissionsLoading || state.pageLoading || state.detailLoading;
  const frozen = !props.active || props.busy || loading || opening;
  const choices = state.admission && !state.admissions.some(value => value.id === state.admission?.id) ? [state.admission, ...state.admissions] : state.admissions;
  const detail = state.detail, row = detail?.row, baseline = row?.baseline, accepted = baseline?.lastAcceptedApply, result = row?.result;
  const open = async () => {
    if (frozen || !result || !detail?.envelope || !props.isAdmin || !props.accountId || props.projectId !== props.loadedProjectId) return;
    const started = owner, atGeneration = generation.current; setOpening(true); setOpenError(null);
    try { await props.onOpenProposal(result.proposalId); }
    catch { if (latestOwner.current === started && generation.current === atGeneration) setOpenError('The exact proposal could not be opened. Refresh this calculation scope and try again.'); }
    finally { if (latestOwner.current === started && generation.current === atGeneration) setOpening(false); }
  };
  return <section className={styles.result} aria-label="Cable revision results">
    <h3>Cable revision results</h3>
    <Caption1>Inspect a saved calculation scope, including blocked cables. New calculations do not replace the selected page. Review and Apply remain explicit in the existing proposal Viewer.</Caption1>
    <label htmlFor={selectId}>Calculation scope</label>
    <select id={selectId} value={state.admission?.id ?? ''} disabled={frozen || choices.length === 0} onChange={event => state.selectAdmission(event.target.value)} style={{ width: '100%', minWidth: 0 }}>
      {!state.admission ? <option value="">Choose a calculation</option> : null}
      {choices.map(value => <option key={value.id} value={value.id}>{value.kind === 'automatic' ? `Generation ${value.generation}` : 'Manual calculation'} · {value.createdAt} · {value.total} cables</option>)}
    </select>
    <div className={styles.actions}>
      <Button disabled={frozen || !state.previousAdmissions} onClick={state.previousAdmissionsPage}>Previous calculations</Button>
      <Button disabled={frozen || !state.nextAdmissionsCursor} onClick={state.nextAdmissions}>More calculations</Button>
      <Button disabled={frozen} onClick={state.refresh}>Refresh revision results</Button>
    </div>
    {loading || opening ? <Spinner size="tiny" label={opening ? 'Opening the exact proposal…' : 'Reading cable revision results…'} /> : null}
    {state.error ? <p role="alert">{state.error}</p> : null}
    {openError ? <p role="alert">{openError}</p> : null}
    {!loading && choices.length === 0 ? <p>No saved calculation scopes are available.</p> : null}
    {state.admission ? <>
      <Caption1>{state.admission.total} cables in this immutable scope. {state.admission.jobId ? `Job ${state.admission.jobId}.` : 'This blocked generation has no calculation job.'}</Caption1>
      <Caption1>Page contains {state.page?.rows.length ?? 0} cables; at most 100 per page.</Caption1>
      <div style={{ overflowX: 'auto', minWidth: 0 }}>
        <table className={styles.table} aria-label="Cable revision result page" style={{ minWidth: 360 }}>
          <thead><tr><th scope="col">Cable / From → To</th><th scope="col">Outcome and length changes</th><th scope="col">Inspect</th></tr></thead>
          <tbody>{state.page?.rows.map(value => <tr key={value.cableId}>
            <th scope="row">{text(value.baseline.currentCable.tag)}<br /><Caption1>{text(value.baseline.currentCable.fromLocation)} → {text(value.baseline.currentCable.toLocation)}</Caption1></th>
            <td>{status(value.status)}<br /><Caption1>Current design: {metres(value.baseline.currentCable.designLength)}<br />New design: {metres(value.result?.designLengthMeters)}<br />Design delta: {signedMetres(value.result?.delta.designLengthMeters)}<br />Geometry delta: {signedMetres(value.result?.delta.rawLengthMeters)}</Caption1>
              <p>{value.currentness.state === 'current' ? 'Current inputs' : label(value.currentness.state)}</p>
              {value.result?.reasonCodes.length ? <Caption1>{value.result.reasonCodes.map(label).join('; ')}</Caption1> : null}
            </td>
            <td><Button disabled={frozen} aria-pressed={detail?.row.cableId === value.cableId} onClick={() => void state.readDetail(value.cableId)}>Inspect {value.baseline.currentCable.tag ?? 'cable'}</Button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className={styles.actions}>
        <Button disabled={frozen || !state.previousPage} onClick={state.previousResultsPage}>Previous cable page</Button>
        <Button disabled={frozen || !state.page?.nextAfterCableId} onClick={state.nextPage}>Next cable page</Button>
      </div>
    </> : null}
    {detail && row && baseline ? <section aria-label="Cable revision detail" className={styles.result} style={{ overflowWrap: 'anywhere' }}>
      <h4>{text(baseline.currentCable.tag)} — {status(row.status)}</h4>
      <p>{row.message}</p>
      {row.currentness.state !== 'current' ? <p role="alert">Currentness: {label(row.currentness.state)}. {row.currentness.reasonCodes.map(label).join('; ')}. Opening a result does not authorize Apply.</p> : null}
      <section aria-label="Current cable at admission"><h5>Current cable at admission</h5>
        <p>From {text(baseline.currentCable.fromLocation)} → To {text(baseline.currentCable.toLocation)}</p>
        <Caption1>Write revision: {baseline.currentCable.cableWriteRevision}. Model: {baseline.acceptedMatchesCurrent ? model(accepted?.modelRef ?? null) : unavailable}.</Caption1>
        <p>Geometric length: {metres(baseline.acceptedMatchesCurrent ? accepted?.rawLengthMeters : null)}; design length: {metres(baseline.currentCable.designLength)}; installed length: {metres(baseline.currentCable.installLength)}.</p>
        <RouteText value={baseline.currentCable.routing} />
      </section>
      <section aria-label="Last accepted Path Finder result"><h5>Last accepted Path Finder result</h5>
        {accepted ? <><p>{baseline.acceptedMatchesCurrent ? 'This accepted result matches the current cable snapshot.' : 'Historical accepted result: later cable edits mean it does not describe the current cable geometry.'}</p>
          <Caption1>Model: {model(accepted.modelRef)}; applied {accepted.appliedAt}.</Caption1>
          <p>Geometric length: {metres(accepted.rawLengthMeters)}; unrounded length: {metres(accepted.unroundedMeters)}; design length: {metres(accepted.designLengthMeters)}.</p><RouteText value={accepted.routeText} />
        </> : <p>No linked accepted result. Old model, geometry and exact components are unavailable; current cable values are retained above.</p>}
      </section>
      <section aria-label="New calculated result"><h5>New calculated result</h5>
        {result ? <><Caption1>Model: {model(result.newModel)}. {result.calculationMode === 'design' ? 'Design length only; verified geometry reused.' : 'Full route calculation.'}</Caption1>
          <p>Geometric length: {metres(result.rawLengthMeters)}; unrounded length: {metres(result.unroundedMeters)}; design length: {metres(result.designLengthMeters)}.</p>
          <p>Geometry delta: {signedMetres(result.delta.rawLengthMeters)}; unrounded delta: {signedMetres(result.delta.unroundedMeters)}; design delta: {signedMetres(result.delta.designLengthMeters)}.</p>
          <Caption1>Recorded delta baseline: {label(result.delta.baseline)}. An unavailable old geometry is never estimated from rounded design length.</Caption1>
          <RouteText value={result.routeText} />
        </> : <p>No calculated output is available for this cable. Its frozen input and diagnostic remain available.</p>}
      </section>
      <section aria-label="Revision reasons"><h5>Recorded reasons</h5>
        {result?.reasonCodes.length ? <ul>{result.reasonCodes.map(reason => <li key={reason}>{label(reason)}</li>)}</ul> : <p>No cable-specific reason is recorded.</p>}
        {detail.envelope?.observedEvents.length ? <><Caption1>Project observations are context; they do not prove this cable or equipment physically moved.</Caption1><ul>{detail.envelope.observedEvents.map((event, index) => <li key={`${event.generation}-${event.domain}-${index}`}>Generation {event.generation}: {label(event.reason)}</li>)}</ul></> : null}
      </section>
      <LengthComponents detail={detail} />
      <details><summary>Recorded provenance</summary>
        <p>Baseline hash: {row.baselineHash}</p>
        {result ? <><p>Proposal hash: {result.proposalHash}</p><p>Revision-result hash: {result.revisionResultSha256}</p><p>Engine-result hash: {result.engineResultSha256}</p><p>Length-component hash: {text(result.ledgerHash)}</p><p>Dependency hash: {result.dependencyHash}</p></> : null}
        <Caption1>Installed length is preserved. Native parity and wider model acceptance are not established by this result.</Caption1>
      </details>
      <Button appearance="primary" disabled={frozen || !result || !detail.envelope} onClick={() => void open()}>Open exact proposal in Viewer</Button>
      <Caption1>The existing protected proposal flow checks the exact path and current authority before human Review and Apply.</Caption1>
    </section> : null}
  </section>;
}
