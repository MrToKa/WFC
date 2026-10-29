import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BARRIER_COLLISION_VERSION, BARRIER_ROUTING_POLICY, barrierCanonicalJson, barrierCheckProofSchema,
  type BarrierCalculationBinding,
} from './pathfinderBarriers.js';
import { DIRECT_SECONDARY_POLICY, directSecondaryDecisionSchema, type DirectSecondaryDecision } from './pathfinderDirectSecondary.js';
import {
  BARRIER_CHECK_PROOF_V2, CONSTRAINED_DIRECT_SECONDARY_POLICY, CONSTRAINED_DIRECT_SECONDARY_VERSION,
  barrierCheckProofV2Schema, barrierComputationalMembershipSchema, constrainedDirectSecondaryDecisionSchema,
  constrainedDirectSecondaryRouteIssue, verifyBarrierCheckProofV2,
  type BarrierCheckProofV2, type BarrierComputationalMembership, type ConstrainedDirectSecondaryDecision,
} from './pathfinderBarrierDecisions.js';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const member = (): BarrierComputationalMembership => ({ computationalMeshId: 'shell:000001', parentSelectionIds: [id(7), id(8)], fragmentIds: [11, 12] });
function binding(mode: 'mesh-set' | 'explicit-empty' | null = 'mesh-set', drill = false): BarrierCalculationBinding {
  const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  const policy = { schemaVersion: 'wfc.pf.barrier-routing-policy.v1' as const, policyVersion: BARRIER_ROUTING_POLICY, drillThroughWalls: drill, collisionVersion: BARRIER_COLLISION_VERSION, numericToleranceMetres: 1e-7,
    physicalClearance: { mode: 'centreline-only' as const, radiusMetres: 0 as const, diameterSource: 'not-qualified' as const } };
  return { scope, registryRevision: '1', snapshot: mode === null ? null : { snapshotId: id(4), scope, registryRevision: '1', contentSha256: 'c'.repeat(64), mode }, policy, policySha256: hash(barrierCanonicalJson(policy)) };
}
function proof(status: BarrierCheckProofV2['status'] = 'clear-selected-scope'): BarrierCheckProofV2 {
  const value: BarrierCheckProofV2 = { schemaVersion: BARRIER_CHECK_PROOF_V2, binding: binding(), routeSha256: 'd'.repeat(64), status,
    routePointCount: 2, totalSegments: 1, checkedSegments: 1, blocking: null, failedSegmentIndex: null,
    reasonCode: 'REGISTERED_SCOPE_CLEAR', coverage: 'registered-selected-objects-only', engineeringAccepted: false };
  if (status === 'blocked') { value.blocking = { ...member(), segmentIndex: 0, reason: 'surface-or-containment', surfaceWitness: null }; value.reasonCode = 'REGISTERED_BARRIER_INTERSECTION'; }
  if (status === 'indeterminate') { value.checkedSegments = 0; value.failedSegmentIndex = 0; value.reasonCode = 'BARRIER_QUERY_INDETERMINATE'; }
  if (status === 'bypassed') { value.binding = binding('mesh-set', true); value.checkedSegments = 0; value.reasonCode = 'EXPLICIT_DRILLING_BYPASS'; }
  if (status === 'unavailable') { value.binding = binding(null); value.checkedSegments = 0; value.reasonCode = 'BARRIER_REGISTRY_UNAVAILABLE'; }
  if (status === 'no-barriers-declared') { value.binding = binding('explicit-empty'); value.checkedSegments = 0; value.reasonCode = 'EXPLICIT_EMPTY_SCOPE'; }
  return value;
}
const distanceDecision = (): DirectSecondaryDecision => ({ schemaVersion: 'wfc.pf.direct-secondary.v1', policyVersion: DIRECT_SECONDARY_POLICY,
  coordinateFrame: 'canonical-world-metres', mode: 'direct-secondary', fromPoint: [0, 0, 0], toPoint: [0, 3, 4], distanceMeters: 5,
  nearestFromMeters: 6, nearestToMeters: 7, eligibleTrays: 1, comparison: 'both' });
function decision(status: BarrierCheckProofV2['status'] = 'clear-selected-scope'): ConstrainedDirectSecondaryDecision {
  const check = proof(status), direct = ['clear-selected-scope', 'bypassed', 'no-barriers-declared'].includes(status);
  const reasons = { 'clear-selected-scope': 'DIRECT_SECONDARY_CLEAR', blocked: 'DIRECT_SECONDARY_BLOCKED_TRAY_FALLBACK', indeterminate: 'DIRECT_SECONDARY_INDETERMINATE_TRAY_FALLBACK',
    bypassed: 'DIRECT_SECONDARY_DRILLING_BYPASS', unavailable: 'DIRECT_SECONDARY_UNAVAILABLE_TRAY_FALLBACK', 'no-barriers-declared': 'DIRECT_SECONDARY_EXPLICIT_EMPTY_SCOPE' } as const;
  return { schemaVersion: CONSTRAINED_DIRECT_SECONDARY_VERSION, policyVersion: CONSTRAINED_DIRECT_SECONDARY_POLICY, distanceDecision: distanceDecision(), binding: check.binding,
    directRouteSha256: check.routeSha256, mode: direct ? 'direct-secondary' : 'tray-network', directCheck: check, reasonCode: reasons[status] };
}
const expected = (value: BarrierCheckProofV2) => ({ binding: value.binding, routeSha256: value.routeSha256, routePointCount: value.routePointCount, computationalMemberships: [member()] });

describe('v2 exact-route barrier evidence without invented contact points', () => {
  it.each(['clear-selected-scope', 'blocked', 'indeterminate', 'bypassed', 'unavailable', 'no-barriers-declared'] as const)('accepts structurally consistent %s evidence', status => {
    const value = proof(status); expect(barrierCheckProofV2Schema.parse(value)).toEqual(value); expect(verifyBarrierCheckProofV2(value, expected(value), hash)).toBe(true);
  });
  it('records the complete shell membership while explicitly carrying no precise surface witness', () => {
    const value = proof('blocked'); expect(value.blocking).toEqual({ computationalMeshId: 'shell:000001', parentSelectionIds: [id(7), id(8)], fragmentIds: [11, 12], segmentIndex: 0, reason: 'surface-or-containment', surfaceWitness: null });
    expect(barrierCheckProofSchema.safeParse(value).success).toBe(false);
  });
  it.each(['point', 'fragment', 'witness'] as const)('refuses a fabricated precise %s on a shell-level result', kind => {
    const value = proof('blocked'), block = value.blocking! as unknown as Record<string, unknown>;
    if (kind === 'point') block.pointMetres = [1, 2, 3];
    if (kind === 'fragment') block.fragmentId = 11;
    if (kind === 'witness') block.surfaceWitness = { pointMetres: [1, 2, 3], fragmentId: 11 };
    expect(barrierCheckProofV2Schema.safeParse(value).success).toBe(false);
  });
  it.each([
    { computationalMeshId: '' }, { computationalMeshId: 'shell\nwrong' }, { parentSelectionIds: [] }, { parentSelectionIds: [id(7), id(7)] },
    { parentSelectionIds: ['foreign'] }, { fragmentIds: [] }, { fragmentIds: [11, 11] }, { fragmentIds: [-1] }, { fragmentIds: [0.5] },
    { fragmentIds: [2147483648] }, { exactHit: true },
  ])('rejects invalid or misleading shell membership %j', change => {
    expect(barrierComputationalMembershipSchema.safeParse({ ...member(), ...change }).success).toBe(false);
  });
  it('requires exact complete B2 membership, allowing set order but rejecting subsets and unknown shell IDs', () => {
    const value = proof('blocked'), wanted = expected(value);
    value.blocking!.parentSelectionIds.reverse(); value.blocking!.fragmentIds.reverse(); expect(verifyBarrierCheckProofV2(value, wanted, hash)).toBe(true);
    value.blocking!.fragmentIds = [11]; expect(verifyBarrierCheckProofV2(value, wanted, hash)).toBe(false);
    value.blocking = { ...member(), segmentIndex: 0, reason: 'surface-or-containment', surfaceWitness: null };
    expect(verifyBarrierCheckProofV2(value, { ...wanted, computationalMemberships: [] }, hash)).toBe(false);
    expect(verifyBarrierCheckProofV2(value, { ...wanted, computationalMemberships: [member(), member()] }, hash)).toBe(false);
  });
  it('requires all exact ordered segments for clear and the checked blocking prefix for blocked', () => {
    const clear = { ...proof(), routePointCount: 4, totalSegments: 3, checkedSegments: 3 };
    expect(barrierCheckProofV2Schema.safeParse(clear).success).toBe(true);
    expect(barrierCheckProofV2Schema.safeParse({ ...clear, checkedSegments: 2 }).success).toBe(false);
    const blocked = { ...proof('blocked'), routePointCount: 4, totalSegments: 3, checkedSegments: 2, blocking: { ...proof('blocked').blocking!, segmentIndex: 1 } };
    expect(barrierCheckProofV2Schema.safeParse(blocked).success).toBe(true);
    expect(barrierCheckProofV2Schema.safeParse({ ...blocked, checkedSegments: 1 }).success).toBe(false);
    expect(barrierCheckProofV2Schema.safeParse({ ...blocked, checkedSegments: 3 }).success).toBe(false);
  });
  it('distinguishes a failed query after the clear prefix from no admitted query', () => {
    const value = { ...proof('indeterminate'), routePointCount: 4, totalSegments: 3, checkedSegments: 2, failedSegmentIndex: 2 };
    expect(barrierCheckProofV2Schema.safeParse(value).success).toBe(true);
    expect(barrierCheckProofV2Schema.safeParse({ ...value, failedSegmentIndex: 1 }).success).toBe(false);
    expect(barrierCheckProofV2Schema.safeParse({ ...value, failedSegmentIndex: 3 }).success).toBe(false);
    expect(barrierCheckProofV2Schema.safeParse({ ...proof('unavailable'), checkedSegments: 1 }).success).toBe(false);
  });
  it.each(['clear-selected-scope', 'blocked', 'indeterminate'] as const)('checks one-point occupancy rather than treating a zero-length %s route as an empty path', status => {
    const value = { ...proof(status), routePointCount: 1 }; expect(barrierCheckProofV2Schema.safeParse(value).success).toBe(true);
    expect(barrierCheckProofV2Schema.safeParse({ ...value, totalSegments: 0 }).success).toBe(false);
    expect(barrierCheckProofV2Schema.safeParse({ ...value, routePointCount: 0 }).success).toBe(false);
  });
  it.each([
    { status: 'clear-selected-scope', checkedSegments: 0 }, { coverage: 'all-model-objects' }, { engineeringAccepted: true }, { schemaVersion: 'wfc.pf.barrier-check-proof.v1' },
    { reasonCode: 'bad reason' }, { routePointCount: Infinity }, { routeSha256: 'caller' }, { failedSegmentIndex: 0 },
  ])('rejects inconsistent or unsupported proof evidence %j', change => {
    expect(barrierCheckProofV2Schema.safeParse({ ...proof(), ...change }).success).toBe(false);
  });
  it('never labels drilling, explicit emptiness or unavailable geometry as a collision-clear scope', () => {
    for (const value of [proof('bypassed'), proof('no-barriers-declared'), proof('unavailable')])
      expect(barrierCheckProofV2Schema.safeParse({ ...value, status: 'clear-selected-scope', checkedSegments: 1, reasonCode: 'REGISTERED_SCOPE_CLEAR' }).success).toBe(false);
    expect(barrierCheckProofV2Schema.safeParse({ ...proof('bypassed'), binding: binding() }).success).toBe(false);
    expect(barrierCheckProofV2Schema.safeParse({ ...proof('no-barriers-declared'), binding: binding() }).success).toBe(false);
  });
  it('binds exact scope, policy, route hash and route point count without asserting producer authenticity', () => {
    const value = proof('blocked'), wanted = expected(value);
    expect(verifyBarrierCheckProofV2(value, { ...wanted, routeSha256: 'e'.repeat(64) }, hash)).toBe(false);
    expect(verifyBarrierCheckProofV2(value, { ...wanted, routePointCount: 3 }, hash)).toBe(false);
    expect(verifyBarrierCheckProofV2(value, { ...wanted, binding: { ...wanted.binding, scope: { ...wanted.binding.scope, projectId: id(99) } } }, hash)).toBe(false);
    const tampered = proof(); tampered.binding.policySha256 = '0'.repeat(64);
    expect(verifyBarrierCheckProofV2(tampered, expected(tampered), hash)).toBe(false);
    expect(verifyBarrierCheckProofV2(value, wanted, () => { throw Error('hash unavailable'); })).toBe(false);
  });
});

describe('versioned constrained direct SECONDARY decisions preserve legacy strict double arithmetic', () => {
  it.each(['clear-selected-scope', 'blocked', 'indeterminate', 'bypassed', 'unavailable', 'no-barriers-declared'] as const)('uses a distance-qualified %s result to choose direct or tray attempt truthfully', status => {
    const value = decision(status); expect(constrainedDirectSecondaryDecisionSchema.parse(value)).toEqual(value);
    expect(value.distanceDecision.mode).toBe('direct-secondary');
    if (['blocked', 'indeterminate', 'unavailable'].includes(status)) expect(value.mode).toBe('tray-network'); else expect(value.mode).toBe('direct-secondary');
  });
  it('keeps the old mode iff distance rule inside v1, while v2 can describe a blocked qualifying direct candidate', () => {
    const value = decision('blocked'); expect(directSecondaryDecisionSchema.parse(value.distanceDecision).mode).toBe('direct-secondary');
    expect(directSecondaryDecisionSchema.safeParse({ ...value.distanceDecision, mode: 'tray-network' }).success).toBe(false);
    expect(constrainedDirectSecondaryDecisionSchema.safeParse(value).success).toBe(true);
    expect(constrainedDirectSecondaryDecisionSchema.safeParse({ ...value, mode: 'direct-secondary' }).success).toBe(false);
  });
  it.each([[6, 4, 'from-approach'], [4, 6, 'to-approach'], [6, 7, 'both']] as const)('preserves strict OR branch %s/%s', (from, to, comparison) => {
    const value = decision(); value.distanceDecision = { ...value.distanceDecision, nearestFromMeters: from, nearestToMeters: to, comparison };
    expect(constrainedDirectSecondaryDecisionSchema.safeParse(value).success).toBe(true);
  });
  it('keeps equality in the tray strategy and never changes it using evidence tolerance', () => {
    const value = decision(); value.distanceDecision = { ...value.distanceDecision, mode: 'tray-network', nearestFromMeters: 5, nearestToMeters: 5, comparison: null };
    value.mode = 'tray-network'; value.directCheck = null; value.reasonCode = 'DISTANCE_NOT_QUALIFIED'; expect(constrainedDirectSecondaryDecisionSchema.safeParse(value).success).toBe(true);
    expect(constrainedDirectSecondaryDecisionSchema.safeParse({ ...value, directCheck: proof() }).success).toBe(false);
    const oneUlp = decision(); oneUlp.distanceDecision.nearestFromMeters = 5 + Number.EPSILON * 4; oneUlp.distanceDecision.nearestToMeters = 5; oneUlp.distanceDecision.comparison = 'from-approach';
    expect(constrainedDirectSecondaryDecisionSchema.safeParse(oneUlp).success).toBe(true);
  });
  it('does not authorize direct SECONDARY without eligible fitted trays', () => {
    const value = decision(); value.distanceDecision = { ...value.distanceDecision, eligibleTrays: 0, nearestFromMeters: null, nearestToMeters: null, mode: 'tray-network', comparison: null };
    value.mode = 'tray-network'; value.directCheck = null; value.reasonCode = 'DISTANCE_NOT_QUALIFIED';
    expect(constrainedDirectSecondaryDecisionSchema.safeParse(value).success).toBe(true);
    expect(constrainedDirectSecondaryDecisionSchema.safeParse({ ...value, mode: 'direct-secondary' }).success).toBe(false);
  });
  it('preserves C# sqrt-square underflow and zero-distance single-point route evidence', () => {
    for (const toPoint of [[0, 0, 0], [1e-200, 0, 0]] as [number, number, number][]) {
      const value = decision(); value.distanceDecision.toPoint = toPoint; value.distanceDecision.distanceMeters = 0; value.directCheck!.routePointCount = 1;
      expect(constrainedDirectSecondaryDecisionSchema.safeParse(value).success).toBe(true);
    }
    const wrong = decision(); wrong.distanceDecision.toPoint = [1e-10, 0, 0]; wrong.distanceDecision.distanceMeters = 0;
    expect(constrainedDirectSecondaryDecisionSchema.safeParse(wrong).success).toBe(false);
  });
  it.each(['binding', 'hash', 'points', 'mode', 'reason', 'missing'] as const)('refuses inconsistent direct check %s', kind => {
    const value = decision();
    if (kind === 'binding') value.directCheck = { ...value.directCheck!, binding: binding('explicit-empty') };
    if (kind === 'hash') value.directRouteSha256 = 'e'.repeat(64);
    if (kind === 'points') value.directCheck!.routePointCount = 1;
    if (kind === 'mode') value.mode = 'tray-network';
    if (kind === 'reason') value.reasonCode = 'DISTANCE_NOT_QUALIFIED';
    if (kind === 'missing') value.directCheck = null;
    expect(constrainedDirectSecondaryDecisionSchema.safeParse(value).success).toBe(false);
  });
  it('keeps explicit drilling on the unconstrained direct strategy and refuses a collision label under bypass', () => {
    expect(constrainedDirectSecondaryDecisionSchema.safeParse(decision('bypassed')).success).toBe(true);
    const value = decision('unavailable'); value.binding = binding(null, true); value.directCheck!.binding = value.binding;
    expect(constrainedDirectSecondaryDecisionSchema.safeParse(value).success).toBe(false);
  });
  it('does not confuse the direct-candidate hash with a later fallback tray-route hash', () => {
    const value = decision('blocked'); expect(constrainedDirectSecondaryDecisionSchema.safeParse(value).success).toBe(true);
    expect(constrainedDirectSecondaryDecisionSchema.safeParse({ ...value, directRouteSha256: 'f'.repeat(64) }).success).toBe(false);
  });
  it('reuses exact direct-route ledger evidence without implementing decimal allowances in JavaScript', () => {
    const value = decision(), direct = value.distanceDecision;
    const route = { success: true, routeText: '/SECONDARY', routeCodes: ['/SECONDARY'], segmentIds: [], points: [direct.fromPoint, direct.toPoint], lengthMeters: 5,
      fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 };
    expect(constrainedDirectSecondaryRouteIssue(value, route)).toBeNull();
    for (const change of [{ lengthMeters: 5.000000000000001 }, { fromDistanceMeters: 1 }, { toRequiresSecondary: true }, { segmentIds: ['tray'] }, { connectionGapLengthMeters: 1 }, { points: [...route.points].reverse() }])
      expect(constrainedDirectSecondaryRouteIssue(value, { ...route, ...change })).not.toBeNull();
    // A tray fallback has its own final-route proof; its ledger is not validated as a direct route here.
    expect(constrainedDirectSecondaryRouteIssue(decision('blocked'), { ...route, routeText: '/TRAY' })).toBeNull();
  });
  it.each([{}, { mode: 'tray-network' }, { ...decision('blocked'), directRouteSha256: 'f'.repeat(64) }])('refuses an unparsed malformed runtime decision rather than treating fallback as valid %j', malformed => {
    const input = decision().distanceDecision;
    const route = { success: true, routeText: '/SECONDARY', routeCodes: ['/SECONDARY'], segmentIds: [], points: [input.fromPoint, input.toPoint], lengthMeters: 5,
      fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 };
    expect(constrainedDirectSecondaryRouteIssue(malformed as ConstrainedDirectSecondaryDecision, route)).not.toBeNull();
  });
});
