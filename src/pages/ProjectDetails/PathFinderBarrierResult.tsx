import { Body1, Caption1 } from '@fluentui/react-components';
import { supportedBarrierExecutionSchema as barrierExecutionSchema, type AnyBarrierExecution as BarrierExecution,
  sameSupportedBarrierAdmissionIntent as sameBarrierAdmissionIntent, type AnyBarrierAdmissionIntent as BarrierAdmissionIntent } from '../../../shared/pathfinderBarrierSupported';
import { MIXED_BARRIER_POLICY } from '../../../shared/pathfinderBarrierMixed';

type Props = { execution?: BarrierExecution | null; stale?: boolean; currentIntent?: BarrierAdmissionIntent | null };
const label = (value: BarrierExecution) => {
  switch (value.diagnostics.status) {
    case 'clear': return 'Clear against registered barriers';
    case 'bypassed': return 'Barrier checks bypassed for drilling';
    case 'no-barriers-declared': return 'No barriers declared for this calculation';
    case 'blocked': return value.proof?.status === 'blocked' ? 'Route intersects registered barrier material' : 'No clear route found in the checked search';
    case 'indeterminate': return 'Barrier check inconclusive';
    case 'search-incomplete': return 'Barrier search incomplete';
    default: return 'Barrier check unavailable';
  }
};
const explanation = (value: BarrierExecution) => {
  switch (value.diagnostics.status) {
    case 'clear': return value.schemaVersion === 'wfc.pf.barrier-execution.v2'
      ? value.proof?.routePointCount === 1 ? 'The final point was checked for contact with every provided original surface and occupancy inside independently qualified closed solids.'
        : 'Every final route segment was checked against all provided original surfaces and independently qualified closed-solid occupancy.'
      : value.proof?.routePointCount === 1 ? 'The final point was checked for occupancy against the registered selected objects.'
      : 'Every final route segment was checked against the registered selected objects.';
    case 'bypassed': return 'Drill through the walls was enabled for this calculation. Checks against all registered obstacles were bypassed, including pipes and tanks. This result does not certify a collision-free route.';
    case 'no-barriers-declared': return 'The administrator declared an empty registered scope. This does not certify that the model has no walls, floors, ceilings or other obstacles.';
    case 'blocked': return value.proof?.status === 'blocked'
      ? value.schemaVersion === 'wfc.pf.barrier-execution.v2'
        ? 'The recorded mixed check found original-surface contact or qualified-solid contact or occupancy. It does not identify an exact contact point.'
        : 'The recorded shell check found contact or containment. It does not identify an exact surface point or hit triangle.'
      : 'A verified route was not found in the checked candidate domain. Search diagnostics do not identify a hit on a final route.';
    case 'indeterminate': return 'A barrier query could not produce a conclusive result. This does not authorize the route.';
    case 'search-incomplete': return value.diagnostics.reasonCode === 'LOCAL_CANDIDATE_DOMAIN_EXHAUSTED'
      ? 'The bounded local search domain was exhausted. Another installable route may exist outside that domain.'
      : 'The bounded search stopped before finding a verified route. Another installable route may exist.';
    default: return 'A completed barrier check is unavailable. Resolve the reported reason and calculate a fresh route.';
  }
};

/** Recorded result metadata only. This component performs no collision math,
 * chooses no model objects and never authorizes engineering acceptance or Apply. */
export function PathFinderBarrierResult({ execution, stale = false, currentIntent }: Props) {
  if (execution === null || execution === undefined) return <section aria-label="Barrier routing result">
    <h5>Barrier check not recorded</h5>
    <Caption1>This historical or unchecked result has no recorded barrier check. Calculate a fresh route with the current barrier settings.</Caption1>
  </section>;
  const parsed = barrierExecutionSchema.safeParse(execution);
  if (!parsed.success) return <section aria-label="Barrier routing result"><h5>Barrier check unavailable</h5>
    <Caption1>The recorded barrier evidence could not be read. Refresh this result and calculate again.</Caption1></section>;
  const value = parsed.data, { binding } = value.context, proof = value.proof;
  const recordedIntent = { ...(value.schemaVersion === 'wfc.pf.barrier-execution.v2'
    ? { schemaVersion: 'wfc.pf.barrier-admission-intent.v2', geometryPolicy: MIXED_BARRIER_POLICY }
    : { schemaVersion: 'wfc.pf.barrier-admission-intent.v1' }), scope: binding.scope,
    expectedRegistryRevision: binding.registryRevision, expectedSnapshot: binding.snapshot, drillThroughWalls: binding.policy.drillThroughWalls };
  const changed = currentIntent !== undefined && currentIntent !== null && !sameBarrierAdmissionIntent(currentIntent, recordedIntent);
  const outdated = stale || changed, direct = value.directSecondary;
  const fallback = direct?.mode === 'tray-network' && direct.distanceDecision.mode === 'direct-secondary'
    ? direct.directCheck?.status === 'blocked' ? 'The direct SECONDARY candidate was blocked. A tray route was attempted instead.'
      : direct.directCheck?.status === 'indeterminate' ? 'The direct SECONDARY candidate was inconclusive. A tray route was attempted instead.'
        : 'The direct SECONDARY candidate could not be checked. A tray route was attempted instead.' : null;
  return <section aria-label="Barrier routing result">
    <h5>{outdated ? 'Recorded barrier check is outdated' : label(value)}</h5>
    <Body1>{explanation(value)}</Body1>
    {fallback ? <Caption1>{fallback}</Caption1> : null}
    {outdated ? <Caption1 role="status">The model, barrier scope or calculation policy changed. Calculate again before using this result.</Caption1> : null}
    {currentIntent === null ? <Caption1>Current barrier settings are unavailable. This is a recorded result.</Caption1> : null}
    <Caption1>Centreline checks cover registered selected objects only. Physical cable clearance and engineering acceptance are not established.</Caption1>
    <details><summary>Barrier calculation details</summary>
      <p>Calculation policy: Drill through the walls {binding.policy.drillThroughWalls ? 'enabled' : 'disabled'}. Registered revision {binding.registryRevision}; scope {binding.snapshot?.mode ?? 'unpublished'}.</p>
      <p>Reason: {value.diagnostics.reasonCode}.</p>
      {direct ? <p>Direct SECONDARY decision: {direct.mode}; reason {direct.reasonCode}. {direct.directCheck
        ? `Candidate check: ${direct.directCheck.status}; ${direct.directCheck.checkedSegments} / ${direct.directCheck.totalSegments} conclusive checks.`
        : direct.distanceDecision.mode === 'direct-secondary' ? 'No physical direct-candidate check is recorded.'
          : 'No direct candidate collision check was needed because the distance comparison did not qualify it.'} This candidate evidence is separate from the final route proof.</p> : null}
      {proof ? <p>{proof.routePointCount === 1 ? value.schemaVersion === 'wfc.pf.barrier-execution.v2' ? 'Final point mixed contact/occupancy' : 'Final point occupancy' : 'Final route'}: {proof.checkedSegments} / {proof.totalSegments} conclusive checks. Recorded outcome: {proof.status}.</p>
        : <p>No final route proof is recorded. Search counts are not a final-route certificate.</p>}
      <p>Search decision: {value.diagnostics.searchComplete ? 'completed within its candidate domain' : 'incomplete'}. Candidate set {value.diagnostics.candidatesTruncated ? 'truncated' : 'not truncated'}; {value.diagnostics.pairAttempts} pair attempts; {value.diagnostics.collisionQueries} collision queries; {value.diagnostics.work} work units.</p>
      <p>Local connectors: {value.diagnostics.localPhaseUsed ? 'attempted' : 'not used'}; {value.diagnostics.plannerAttempts} plans; {value.diagnostics.localEdgeChecks} edge checks. Straight approach phase {value.diagnostics.straightPhaseTruncated ? 'truncated' : 'not truncated'}.</p>
      {(['from', 'to'] as const).map(side => {
        const plan = value.connectors[side];
        return plan ? <p key={side}>{side === 'from' ? 'From' : 'To'} connector: {plan.lengthMeters} m; local domain [{plan.domain.minimum.join(', ')}] to [{plan.domain.maximum.join(', ')}] m, step {plan.domain.stepMeters} m. {plan.reasonCode}.</p> : null;
      })}
      {proof?.blocking ? <p>{'componentId' in proof.blocking ? `Blocking original component: ${proof.blocking.componentId} (${proof.blocking.kind})`
        : `Blocking computational shell: ${proof.blocking.computationalMeshId}`}; route segment {proof.blocking.segmentIndex + 1}. Its {proof.blocking.parentSelectionIds.length} parent memberships and {proof.blocking.fragmentIds.length} fragment memberships do not identify a precise hit fragment or point.</p> : null}
      <p>Collision policy {binding.policy.collisionVersion}; numerical contact tolerance {binding.policy.numericToleranceMetres} m. This tolerance is not physical cable clearance.</p>
      <p>Model {binding.scope.modelVersionId}; frame {binding.scope.captureFrameId}; snapshot {binding.snapshot?.snapshotId ?? 'none'}.</p>
    </details>
  </section>;
}
