import { z } from 'zod';
import {
  BARRIER_LIMITS, barrierCalculationBindingSchema, barrierCanonicalJson, type BarrierCalculationBinding,
} from './pathfinderBarriers.js';
import {
  directSecondaryDecisionSchema, directSecondaryRouteIssue, type DirectSecondaryDecision,
} from './pathfinderDirectSecondary.js';
import { policyHashSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';

export const BARRIER_CHECK_PROOF_V2 = 'wfc.pf.barrier-check-proof.v2' as const;
export const CONSTRAINED_DIRECT_SECONDARY_VERSION = 'wfc.pf.constrained-direct-secondary.v2' as const;
export const CONSTRAINED_DIRECT_SECONDARY_POLICY = 'nearest-eligible-tray-or-registered-barriers.v2' as const;
const equal = (left: unknown, right: unknown) => barrierCanonicalJson(left) === barrierCanonicalJson(right);
const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
const count = (maximum: number) => z.number().int().nonnegative().max(maximum);
const reasonCode = z.string().min(1).max(96).regex(/^[A-Z][A-Z0-9_]{0,95}$(?![\s\S])/);
const meshId = z.string().min(1).max(256).refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  && [...value].every(character => character.length !== 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff));

/** Complete B2 computational-shell membership, not the identity of a hit triangle.
 * A shell can contain triangles from several fragments/selected parents. */
export const barrierComputationalMembershipSchema = z.object({
  computationalMeshId: meshId,
  parentSelectionIds: z.array(policyUuidSchema).min(1).max(BARRIER_LIMITS.selectedParents).refine(unique),
  fragmentIds: z.array(count(2147483647)).min(1).max(BARRIER_LIMITS.fragments).refine(unique),
}).strict();
export const barrierShellBlockingSchema = barrierComputationalMembershipSchema.extend({
  segmentIndex: count(BARRIER_LIMITS.routeSegments - 1), reason: z.literal('surface-or-containment'),
  // B1 reports shell occupancy/contact; it does not return a precise triangle or contact point.
  surfaceWitness: z.null(),
}).strict();

/** A new proof version. Historical v1, which requires a precise point/fragment,
 * stays unchanged. Parsing is structural; it cannot establish producer authority. */
export const barrierCheckProofV2Schema = z.object({
  schemaVersion: z.literal(BARRIER_CHECK_PROOF_V2), binding: barrierCalculationBindingSchema,
  routeSha256: policyHashSchema,
  status: z.enum(['clear-selected-scope', 'blocked', 'indeterminate', 'bypassed', 'unavailable', 'no-barriers-declared']),
  routePointCount: z.number().int().positive().max(BARRIER_LIMITS.routeSegments + 1),
  totalSegments: z.number().int().positive().max(BARRIER_LIMITS.routeSegments),
  /** Conclusive checks in exact route order; includes the blocking query, excludes an indeterminate query. */
  checkedSegments: count(BARRIER_LIMITS.routeSegments),
  blocking: barrierShellBlockingSchema.nullable(), failedSegmentIndex: count(BARRIER_LIMITS.routeSegments - 1).nullable(),
  reasonCode, coverage: z.literal('registered-selected-objects-only'), engineeringAccepted: z.literal(false),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  const { policy, snapshot } = value.binding;
  if (value.totalSegments !== Math.max(1, value.routePointCount - 1) || value.checkedSegments > value.totalSegments)
    issue('An exact one-point route needs one occupancy query; segment counts must match the exact route.');
  if (value.status !== 'blocked' && value.blocking !== null || value.status !== 'indeterminate' && value.failedSegmentIndex !== null)
    issue('Only the corresponding failed check can carry shell membership or an indeterminate segment index.');
  if (value.status === 'clear-selected-scope' && (policy.drillThroughWalls || snapshot?.mode !== 'mesh-set'
    || value.checkedSegments !== value.totalSegments || value.reasonCode !== 'REGISTERED_SCOPE_CLEAR'))
    issue('A clear result requires every exact segment checked against the current published mesh set.');
  if (value.status === 'blocked' && (policy.drillThroughWalls || snapshot?.mode !== 'mesh-set' || !value.blocking
    || value.blocking.segmentIndex >= value.totalSegments || value.checkedSegments !== value.blocking.segmentIndex + 1
    || value.reasonCode !== 'REGISTERED_BARRIER_INTERSECTION'))
    issue('Blocked evidence identifies the checked shell and ordered segment, without claiming a precise surface hit.');
  if (value.status === 'indeterminate' && (policy.drillThroughWalls || snapshot?.mode !== 'mesh-set'
    || value.failedSegmentIndex === null || value.failedSegmentIndex >= value.totalSegments
    || value.failedSegmentIndex !== value.checkedSegments || value.reasonCode !== 'BARRIER_QUERY_INDETERMINATE'))
    issue('An indeterminate query follows the conclusive clear prefix and never authorizes the route.');
  if (value.status === 'bypassed' && (!policy.drillThroughWalls || value.checkedSegments !== 0 || value.reasonCode !== 'EXPLICIT_DRILLING_BYPASS'))
    issue('Explicit drilling bypasses physical barrier checks; it is not a collision-clear certificate.');
  if (value.status === 'no-barriers-declared' && (policy.drillThroughWalls || snapshot?.mode !== 'explicit-empty'
    || value.checkedSegments !== 0 || value.reasonCode !== 'EXPLICIT_EMPTY_SCOPE'))
    issue('An explicitly empty registered scope is distinct from checked wall geometry.');
  if (value.status === 'unavailable' && (value.checkedSegments !== 0
    || ['REGISTERED_SCOPE_CLEAR', 'REGISTERED_BARRIER_INTERSECTION', 'BARRIER_QUERY_INDETERMINATE', 'EXPLICIT_DRILLING_BYPASS', 'EXPLICIT_EMPTY_SCOPE'].includes(value.reasonCode)))
    issue('Unavailable means no collision query was admitted, not a checked clear prefix or engineering acceptance.');
});
export type BarrierComputationalMembership = z.infer<typeof barrierComputationalMembershipSchema>;
export type BarrierCheckProofV2 = z.infer<typeof barrierCheckProofV2Schema>;

function sameMembers(actual: BarrierComputationalMembership, expected: BarrierComputationalMembership): boolean {
  return actual.computationalMeshId === expected.computationalMeshId
    && equal([...actual.parentSelectionIds].sort(), [...expected.parentSelectionIds].sort())
    && equal([...actual.fragmentIds].sort((a, b) => a - b), [...expected.fragmentIds].sort((a, b) => a - b));
}
/** Currentness/integrity/membership comparison only. The caller must load trusted
 * B2 membership from the exact published capture; neither JSON nor this function runs collision math. */
export function verifyBarrierCheckProofV2(value: unknown, expected: {
  binding: BarrierCalculationBinding; routeSha256: string; routePointCount: number;
  computationalMemberships: readonly BarrierComputationalMembership[];
}, hashCanonicalString: (value: string) => string): value is BarrierCheckProofV2 {
  const proof = barrierCheckProofV2Schema.safeParse(value), binding = barrierCalculationBindingSchema.safeParse(expected.binding);
  if (!proof.success || !binding.success || !policyHashSchema.safeParse(expected.routeSha256).success
    || !Number.isInteger(expected.routePointCount) || expected.routePointCount < 1 || expected.routePointCount > BARRIER_LIMITS.routeSegments + 1) return false;
  try {
    if (hashCanonicalString(barrierCanonicalJson(binding.data.policy)) !== binding.data.policySha256
      || !equal(proof.data.binding, binding.data) || proof.data.routeSha256 !== expected.routeSha256
      || proof.data.routePointCount !== expected.routePointCount) return false;
    const members = z.array(barrierComputationalMembershipSchema).max(BARRIER_LIMITS.computationalMeshes)
      .refine(values => unique(values.map(item => item.computationalMeshId))).parse(expected.computationalMemberships);
    if (proof.data.blocking) {
      const wanted = members.find(item => item.computationalMeshId === proof.data.blocking!.computationalMeshId);
      if (!wanted || !sameMembers(proof.data.blocking, wanted)) return false;
    }
    return true;
  } catch { return false; }
}

export const constrainedDirectSecondaryDecisionSchema = z.object({
  schemaVersion: z.literal(CONSTRAINED_DIRECT_SECONDARY_VERSION), policyVersion: z.literal(CONSTRAINED_DIRECT_SECONDARY_POLICY),
  /** The original immutable v1 decision retains its exact strict double comparison.
   * Evidence tolerance never changes D<F OR D<T, including equality or underflow. */
  distanceDecision: directSecondaryDecisionSchema,
  binding: barrierCalculationBindingSchema, directRouteSha256: policyHashSchema,
  mode: z.enum(['direct-secondary', 'tray-network']), directCheck: barrierCheckProofV2Schema.nullable(),
  reasonCode: z.enum(['DISTANCE_NOT_QUALIFIED', 'DIRECT_SECONDARY_CLEAR', 'DIRECT_SECONDARY_DRILLING_BYPASS',
    'DIRECT_SECONDARY_EXPLICIT_EMPTY_SCOPE', 'DIRECT_SECONDARY_BLOCKED_TRAY_FALLBACK',
    'DIRECT_SECONDARY_INDETERMINATE_TRAY_FALLBACK', 'DIRECT_SECONDARY_UNAVAILABLE_TRAY_FALLBACK']),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (value.distanceDecision.mode !== 'direct-secondary') {
    if (value.mode !== 'tray-network' || value.directCheck !== null || value.reasonCode !== 'DISTANCE_NOT_QUALIFIED')
      issue('Missing eligible trays or a non-qualifying strict distance comparison must retain the tray attempt.');
    return;
  }
  const check = value.directCheck;
  if (!check || !equal(check.binding, value.binding) || check.routeSha256 !== value.directRouteSha256
    || check.routePointCount !== (value.distanceDecision.distanceMeters === 0 ? 1 : 2)) {
    issue('A distance-qualified direct candidate needs exact current binding, ordered direct-route hash and point-count evidence.'); return;
  }
  const decisions = {
    'clear-selected-scope': ['direct-secondary', 'DIRECT_SECONDARY_CLEAR'],
    bypassed: ['direct-secondary', 'DIRECT_SECONDARY_DRILLING_BYPASS'],
    'no-barriers-declared': ['direct-secondary', 'DIRECT_SECONDARY_EXPLICIT_EMPTY_SCOPE'],
    blocked: ['tray-network', 'DIRECT_SECONDARY_BLOCKED_TRAY_FALLBACK'],
    indeterminate: ['tray-network', 'DIRECT_SECONDARY_INDETERMINATE_TRAY_FALLBACK'],
    unavailable: ['tray-network', 'DIRECT_SECONDARY_UNAVAILABLE_TRAY_FALLBACK'],
  } as const;
  const [mode, reason] = decisions[check.status];
  if (value.mode !== mode || value.reasonCode !== reason || value.binding.policy.drillThroughWalls && check.status !== 'bypassed')
    issue('Distance-qualified blocked/uncertain direct candidates need a constrained tray attempt; explicit drilling preserves the bypassed direct strategy.');
});
export type ConstrainedDirectSecondaryDecision = z.infer<typeof constrainedDirectSecondaryDecisionSchema>;

/** Accepts a parsed decision and checks only its direct-route ledger evidence;
 * the defensive parse also refuses malformed runtime inputs. Null on a valid tray
 * fallback means this direct-ledger check is NOT APPLICABLE, never that the fallback
 * route is valid. A tray route requires its own complete ordered final-route proof.
 * C# remains the sole calculator for double-to-decimal length, connection reserve,
 * bending percentage and rounding; there is no JavaScript replacement formula. */
export function constrainedDirectSecondaryRouteIssue(decision: ConstrainedDirectSecondaryDecision,
  route: Parameters<typeof directSecondaryRouteIssue>[1]): string | null {
  const parsed = constrainedDirectSecondaryDecisionSchema.safeParse(decision);
  if (!parsed.success) return 'Constrained direct SECONDARY decision is invalid; validate its exact policy, candidate and check evidence.';
  return parsed.data.mode === 'direct-secondary' ? directSecondaryRouteIssue(parsed.data.distanceDecision as DirectSecondaryDecision, route) : null;
}
