import { createHash } from 'node:crypto';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PathFinderBarrierResult } from './PathFinderBarrierResult';
import { BARRIER_RUNTIME_PROFILE, barrierRouteHashInput, createBarrierRuntimePolicy, type BarrierExecution } from '../../../shared/pathfinderBarrierRuntime';
import type { BarrierAdmissionIntent } from '../../../shared/pathfinderBarrierAdmission';
import { canonicalPurposeJson } from '../../../shared/pathfinderPurposePolicy';
import { MIXED_BARRIER_POLICY, MIXED_BARRIER_QUERY_DOMAIN, MIXED_BARRIER_RUNTIME_PROFILE, createMixedBarrierRuntimePolicy,
  type MixedBarrierExecution } from '../../../shared/pathfinderBarrierMixed';

const id = (n: number) => `bc600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
/** Display-only synthetic facts. No real geometry/SDK/engineering acceptance. */
function execution(status: BarrierExecution['diagnostics']['status'] = 'clear'): BarrierExecution {
  const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '3', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  const policy = createBarrierRuntimePolicy(status === 'bypassed'), mode = status === 'no-barriers-declared' ? 'explicit-empty' as const : 'mesh-set' as const;
  const context = { schemaVersion: 'wfc.pf.barrier-runtime.v1' as const, binding: { scope, registryRevision: '4', snapshot: { snapshotId: id(4), scope, registryRevision: '4', contentSha256: 'c'.repeat(64), mode }, policy, policySha256: hash(policy) },
    profile: structuredClone(BARRIER_RUNTIME_PROFILE), profileSha256: hash(BARRIER_RUNTIME_PROFILE), storage: { intentId: id(5), manifest: { blobId: id(6), sha256: 'd'.repeat(64), bytes: 1000 }, capture: mode === 'mesh-set' ? { blobId: id(7), sha256: 'e'.repeat(64), bytes: 2000 } : null } };
  const proofStatus = status === 'clear' ? 'clear-selected-scope' as const : status === 'search-incomplete' ? null : status;
  const membership = { computationalMeshId: 'shell:000001', parentSelectionIds: [id(8)], fragmentIds: [11, 12] };
  const reason = { clear: 'REGISTERED_SCOPE_CLEAR', blocked: 'REGISTERED_BARRIER_INTERSECTION', indeterminate: 'BARRIER_QUERY_INDETERMINATE',
    bypassed: 'EXPLICIT_DRILLING_BYPASS', 'no-barriers-declared': 'EXPLICIT_EMPTY_SCOPE', unavailable: 'FINAL_CHECK_UNAVAILABLE', 'search-incomplete': 'LOCAL_CANDIDATE_DOMAIN_EXHAUSTED' }[status];
  return { schemaVersion: 'wfc.pf.barrier-execution.v1', context,
    proof: proofStatus === null ? null : { schemaVersion: 'wfc.pf.barrier-check-proof.v2', binding: context.binding, routeSha256: hash(barrierRouteHashInput([[0, 0, 0], [1, 0, 0]])),
      status: proofStatus, routePointCount: 2, totalSegments: 1, checkedSegments: status === 'clear' || status === 'blocked' ? 1 : 0,
      blocking: status === 'blocked' ? { ...membership, segmentIndex: 0, reason: 'surface-or-containment', surfaceWitness: null } : null,
      failedSegmentIndex: status === 'indeterminate' ? 0 : null, reasonCode: reason, coverage: 'registered-selected-objects-only', engineeringAccepted: false },
    directSecondary: null, diagnostics: { status, reasonCode: reason, searchComplete: ['clear', 'bypassed', 'no-barriers-declared'].includes(status),
      candidatesTruncated: false, pairAttempts: 2, collisionQueries: 7, work: '300', plannerAttempts: 0, straightPairAttempts: 2, localEdgeChecks: 0, localPhaseUsed: false, straightPhaseTruncated: false },
    connectors: { from: null, to: null }, qualification: ['clear', 'blocked', 'indeterminate'].includes(status) ? { captureSha256: 'e'.repeat(64), pureVerificationSha256: 'f'.repeat(64), decompositionSha256: '1'.repeat(64), computationalMemberships: [membership] } : null };
}
const intent = (value: BarrierExecution): BarrierAdmissionIntent => ({ schemaVersion: 'wfc.pf.barrier-admission-intent.v1', scope: value.context.binding.scope,
  expectedRegistryRevision: value.context.binding.registryRevision, expectedSnapshot: value.context.binding.snapshot, drillThroughWalls: value.context.binding.policy.drillThroughWalls });
function mixedExecution(blocked = false): MixedBarrierExecution {
  const old = execution(blocked ? 'blocked' : 'clear'), policy = createMixedBarrierRuntimePolicy(false), scope = old.context.binding.scope;
  if (!old.context.binding.snapshot || !old.proof) throw Error('fixture');
  const binding = { ...old.context.binding, schemaVersion: 'wfc.pf.barrier-calculation-binding.v2' as const, policy, policySha256: hash(policy),
    snapshot: { ...old.context.binding.snapshot, schemaVersion: 'wfc.pf.barrier-snapshot-reference.v2' as const, geometryPolicy: MIXED_BARRIER_POLICY, mode: 'mixed-mesh-set' as const } };
  const context = { ...old.context, schemaVersion: 'wfc.pf.barrier-runtime.v2' as const, binding, profile: structuredClone(MIXED_BARRIER_RUNTIME_PROFILE), profileSha256: hash(MIXED_BARRIER_RUNTIME_PROFILE) };
  const membership = { componentId: 'component:000000', kind: 'original-surface' as const, parentSelectionIds: [id(8)], fragmentIds: [11, 12], triangleCount: 2, sourceMembershipSha256: 'f'.repeat(64) };
  const flags = { ownTerminalExemptionsSupported: false as const, engineeringAccepted: false as const, authority: 'none' as const };
  return { ...old, schemaVersion: 'wfc.pf.barrier-execution.v2', context, directSecondary: null, ...flags,
    proof: { ...old.proof, schemaVersion: 'wfc.pf.barrier-mixed-check-proof.v2', binding, domain: MIXED_BARRIER_QUERY_DOMAIN,
      globalModelCoverageVerified: false, physicalCableRadiusChecked: false, ...flags,
      blocking: blocked ? { ...membership, segmentIndex: 0, reason: 'original-surface-contact', surfaceWitness: null } : null },
    qualification: { captureSha256: 'e'.repeat(64), evidence: { captureId: id(5), scope, originalSurfaceComponents: 1, qualifiedClosedSolidComponents: 0,
      fragmentCount: 2, vertexCount: 6, triangleCount: 2, originalGeometrySha256: 'e'.repeat(64), verificationSha256: 'd'.repeat(64), numericToleranceMetres: 1e-7,
      componentMemberships: [membership], inputSchemaVersion: 'wfc.pf.barrier-capture.v1', policyVersion: MIXED_BARRIER_POLICY,
      coverage: 'provided-fragments-only', geometryProvenance: 'capture-bound-provided-original-triangles', sdkCoverageVerified: false, sdkSourceBytesVerified: false,
      currentFrameVerified: false, ...flags } } };
}
afterEach(cleanup);

describe('recorded barrier calculation explanation', () => {
  it('shows mixed original-surface/closed-solid coverage without treating a v1 intent as its current policy', () => {
    const value = mixedExecution(), binding = value.context.binding;
    const currentIntent = { schemaVersion: 'wfc.pf.barrier-admission-intent.v2' as const, geometryPolicy: MIXED_BARRIER_POLICY, scope: binding.scope,
      expectedRegistryRevision: binding.registryRevision, expectedSnapshot: binding.snapshot, drillThroughWalls: false };
    const view = render(<PathFinderBarrierResult execution={value} currentIntent={currentIntent} />);
    expect(screen.getByRole('heading', { name: 'Clear against registered barriers' })).toBeVisible();
    expect(screen.getByText(/Every final route segment/)).toHaveTextContent('all provided original surfaces and independently qualified closed-solid occupancy');
    view.rerender(<PathFinderBarrierResult execution={value} currentIntent={intent(execution())} />);
    expect(screen.getByRole('heading', { name: 'Recorded barrier check is outdated' })).toBeVisible();
  });
  it('names an original mixed blocking component without inventing a contact point or shell', () => {
    render(<PathFinderBarrierResult execution={mixedExecution(true)} />);
    expect(screen.getByText(/Blocking original component:/)).toHaveTextContent('component:000000 (original-surface)');
    expect(screen.getByText(/recorded mixed check/)).toHaveTextContent('does not identify an exact contact point');
    expect(screen.queryByText(/Blocking computational shell:/)).not.toBeInTheDocument();
  });
  it('labels absent historical evidence unchecked and offers no write or viewer actions', () => {
    render(<PathFinderBarrierResult />);
    expect(screen.getByRole('heading', { name: 'Barrier check not recorded' })).toBeVisible();
    expect(screen.getByText(/historical or unchecked/)).toBeVisible(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('limits a clear label to the registered selected scope and separates exact proof from aggregate search work', () => {
    render(<PathFinderBarrierResult execution={execution()} />);
    expect(screen.getByRole('heading', { name: 'Clear against registered barriers' })).toBeVisible();
    expect(screen.getByText(/Every final route segment/)).toHaveTextContent('registered selected objects');
    expect(screen.getByText(/Final route:/)).toHaveTextContent('1 / 1 conclusive checks');
    expect(screen.getByText(/Search decision:/)).toHaveTextContent('7 collision queries; 300 work units');
    expect(screen.getByText(/Physical cable clearance and engineering acceptance/)).toBeVisible();
  });
  it('does not call an explicit drilling bypass clear', () => {
    render(<PathFinderBarrierResult execution={execution('bypassed')} />);
    expect(screen.getByRole('heading', { name: 'Barrier checks bypassed for drilling' })).toBeVisible();
    expect(screen.getByText(/Drill through the walls was enabled/)).toHaveTextContent('does not certify a collision-free route');
    expect(screen.getByText(/Drill through the walls was enabled/)).toHaveTextContent('for this calculation. Checks against all registered obstacles were bypassed, including pipes and tanks');
    expect(screen.getByText(/Calculation policy:/)).toHaveTextContent('enabled');
    expect(screen.queryByRole('heading', { name: 'Clear against registered barriers' })).not.toBeInTheDocument();
  });
  it('describes a one-point route as an occupancy check instead of a non-existent line segment', () => {
    const value = execution(); value.proof!.routePointCount = 1;
    value.proof!.routeSha256 = hash(barrierRouteHashInput([[0, 0, 0]]));
    render(<PathFinderBarrierResult execution={value} />);
    expect(screen.getByText(/The final point was checked for occupancy/)).toBeVisible();
    expect(screen.getByText(/Final point occupancy:/)).toHaveTextContent('1 / 1 conclusive checks');
  });
  it('keeps an explicit empty selected scope distinct from a model without walls', () => {
    render(<PathFinderBarrierResult execution={execution('no-barriers-declared')} />);
    expect(screen.getByRole('heading', { name: 'No barriers declared for this calculation' })).toBeVisible();
    expect(screen.getByText(/administrator declared an empty/)).toHaveTextContent('does not certify that the model has no walls');
  });
  it('describes shell contact honestly without inventing a hit fragment or surface point', () => {
    render(<PathFinderBarrierResult execution={execution('blocked')} />);
    expect(screen.getByRole('heading', { name: 'Route intersects registered barrier material' })).toBeVisible();
    expect(screen.getByText(/recorded shell check/)).toHaveTextContent('does not identify an exact surface point or hit triangle');
    expect(screen.getByText(/Blocking computational shell:/)).toHaveTextContent('fragment memberships do not identify a precise hit fragment or point');
  });
  it('does not turn failure-only search diagnostics into final-route collision evidence', () => {
    const value = execution('blocked'); value.proof = null;
    render(<PathFinderBarrierResult execution={value} />);
    expect(screen.getByRole('heading', { name: 'No clear route found in the checked search' })).toBeVisible();
    expect(screen.getByText(/Search diagnostics do not identify a hit/)).toBeVisible();
    expect(screen.getByText(/No final route proof/)).toBeInTheDocument(); expect(screen.queryByText(/Blocking computational shell:/)).not.toBeInTheDocument();
  });
  it.each(['blocked','indeterminate','unavailable'] as const)('keeps direct SECONDARY %s fallback counts separate from the final clear route', status => {
    const value = execution(), candidate = execution(status).proof!;
    value.proof = { ...value.proof!, routePointCount: 4, totalSegments: 3, checkedSegments: 3,
      routeSha256: hash(barrierRouteHashInput([[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]])) };
    value.directSecondary = { schemaVersion: 'wfc.pf.constrained-direct-secondary.v2', policyVersion: 'nearest-eligible-tray-or-registered-barriers.v2',
      distanceDecision: { schemaVersion: 'wfc.pf.direct-secondary.v1', policyVersion: 'nearest-eligible-tray-or.v1', coordinateFrame: 'canonical-world-metres', mode: 'direct-secondary',
        fromPoint: [0, 0, 0], toPoint: [1, 0, 0], distanceMeters: 1, nearestFromMeters: 2, nearestToMeters: 3, eligibleTrays: 1, comparison: 'both' },
      binding: value.context.binding, directRouteSha256: candidate.routeSha256, mode: 'tray-network', directCheck: candidate,
      reasonCode: status === 'blocked' ? 'DIRECT_SECONDARY_BLOCKED_TRAY_FALLBACK' : status === 'indeterminate' ? 'DIRECT_SECONDARY_INDETERMINATE_TRAY_FALLBACK' : 'DIRECT_SECONDARY_UNAVAILABLE_TRAY_FALLBACK' };
    render(<PathFinderBarrierResult execution={value} />);
    expect(screen.getByRole('heading', { name: 'Clear against registered barriers' })).toBeVisible();
    expect(screen.getByText(/The direct SECONDARY candidate/)).toHaveTextContent('A tray route was attempted instead');
    expect(screen.getByText(/Direct SECONDARY decision:/)).toHaveTextContent(`Candidate check: ${status}; ${status === 'blocked' ? 1 : 0} / 1 conclusive checks`);
    expect(screen.getByText(/Direct SECONDARY decision:/)).toHaveTextContent('separate from the final route proof');
    expect(screen.getByText(/Final route:/)).toHaveTextContent('3 / 3 conclusive checks');
  });
  it.each([['indeterminate', 'Barrier check inconclusive'], ['search-incomplete', 'Barrier search incomplete'], ['unavailable', 'Barrier check unavailable']] as const)('keeps %s distinct from clear', (status, heading) => {
    render(<PathFinderBarrierResult execution={execution(status)} />); expect(screen.getByRole('heading', { name: heading })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Clear against registered barriers' })).not.toBeInTheDocument();
  });
  it('shows bounded local exhaustion and exact connector domain without claiming no global route exists', () => {
    const value = execution('search-incomplete'); value.diagnostics.localPhaseUsed = true; value.diagnostics.candidatesTruncated = true; value.diagnostics.straightPhaseTruncated = true;
    value.connectors.from = { policyVersion: BARRIER_RUNTIME_PROFILE.localConnectors.policyVersion, status: 'clear', reasonCode: 'LOCAL_CONNECTOR_CLEAR', points: [[0, 0, 0], [1, 0, 0]], lengthMeters: 1, directDistanceMeters: 1, isDetour: false,
      searchComplete: true, domain: { minimum: [-1, -1, -1], maximum: [2, 1, 1], stepMeters: 0.25 }, edgeChecks: 3, queries: 5, work: '40' };
    render(<PathFinderBarrierResult execution={value} />);
    expect(screen.getByText(/bounded local search domain was exhausted/)).toHaveTextContent('Another installable route may exist outside that domain');
    expect(screen.getByText(/From connector:/)).toHaveTextContent('[-1, -1, -1] to [2, 1, 1] m, step 0.25 m');
    expect(screen.getByText(/Local connectors:/)).toHaveTextContent('Straight approach phase truncated');
    expect(screen.getByText(/Search decision:/)).toHaveTextContent('Candidate set truncated');
  });
  it('does not relabel stale or different-policy evidence as a current clear result', () => {
    const value = execution(), current = { ...intent(value), drillThroughWalls: true };
    const view = render(<PathFinderBarrierResult execution={value} currentIntent={current} />);
    expect(screen.getByRole('heading', { name: 'Recorded barrier check is outdated' })).toBeVisible();
    view.rerender(<PathFinderBarrierResult execution={value} currentIntent={intent(value)} stale />);
    expect(screen.getByRole('heading', { name: 'Recorded barrier check is outdated' })).toBeVisible();
    view.rerender(<PathFinderBarrierResult execution={value} currentIntent={null} />);
    expect(screen.getByText(/Current barrier settings are unavailable/)).toBeVisible();
  });
  it('does not call a truncated candidate domain exhausted', () => {
    const value = execution('search-incomplete'); value.diagnostics.reasonCode = 'CANDIDATE_DOMAIN_TRUNCATED'; value.diagnostics.candidatesTruncated = true;
    render(<PathFinderBarrierResult execution={value} />);
    expect(screen.getByText(/bounded search stopped/)).toBeVisible();
    expect(screen.queryByText(/bounded local search domain was exhausted/)).not.toBeInTheDocument();
  });
  it('refuses malformed display evidence rather than presenting an invented clear label', () => {
    const value = execution(); value.proof = null;
    render(<PathFinderBarrierResult execution={value} />); expect(screen.getByRole('heading', { name: 'Barrier check unavailable' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Clear against registered barriers' })).not.toBeInTheDocument();
  });
  it('does not explain a missing qualified direct check as a failed distance comparison', () => {
    const value = execution();
    value.directSecondary = { schemaVersion: 'wfc.pf.constrained-direct-secondary.v2', policyVersion: 'nearest-eligible-tray-or-registered-barriers.v2',
      distanceDecision: { schemaVersion: 'wfc.pf.direct-secondary.v1', policyVersion: 'nearest-eligible-tray-or.v1', coordinateFrame: 'canonical-world-metres', mode: 'direct-secondary',
        fromPoint: [0, 0, 0], toPoint: [1, 0, 0], distanceMeters: 1, nearestFromMeters: 2, nearestToMeters: 3, eligibleTrays: 1, comparison: 'both' },
      binding: value.context.binding, directRouteSha256: value.proof!.routeSha256, mode: 'tray-network', directCheck: null, reasonCode: 'DIRECT_SECONDARY_UNAVAILABLE_TRAY_FALLBACK' };
    render(<PathFinderBarrierResult execution={value} />);
    // The current closed contract refuses a distance-qualified null check; the
    // fallback wording must remain honest if that representation is extended.
    expect(screen.getByRole('heading', { name: 'Barrier check unavailable' })).toBeVisible();
    expect(screen.queryByText(/distance comparison did not qualify/)).not.toBeInTheDocument();
  });
});
