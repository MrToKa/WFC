import { z } from 'zod';

export const DIRECT_SECONDARY_POLICY = 'nearest-eligible-tray-or.v1' as const;
export const directSecondaryPolicySchema = z.literal(DIRECT_SECONDARY_POLICY);
const point = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
/** Evidence comparison only; C# remains the sole engineering calculator. */
export function directSecondaryNumberMatches(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Number.isFinite(expected)
    && Math.abs(actual - expected) <= 1e-12 * Math.max(Math.abs(actual), Math.abs(expected));
}
export const directSecondaryDecisionSchema = z.object({
  schemaVersion: z.literal('wfc.pf.direct-secondary.v1'), policyVersion: directSecondaryPolicySchema,
  coordinateFrame: z.literal('canonical-world-metres'), mode: z.enum(['direct-secondary', 'tray-network']),
  fromPoint: point, toPoint: point, distanceMeters: z.number().finite().nonnegative(),
  nearestFromMeters: z.number().finite().nonnegative().nullable(), nearestToMeters: z.number().finite().nonnegative().nullable(),
  eligibleTrays: z.number().int().min(0).max(1_000_000), comparison: z.enum(['from-approach', 'to-approach', 'both']).nullable(),
}).strict().superRefine((value, context) => {
  const [x, y, z] = value.fromPoint.map((number, index) => number - value.toPoint[index]);
  const distance = Math.sqrt(x * x + y * y + z * z);
  if (!directSecondaryNumberMatches(value.distanceMeters, distance)) context.addIssue({ code: 'custom', message: 'Direct distance must match its finite canonical 3D endpoints.' });
  if (value.eligibleTrays === 0) {
    if (value.nearestFromMeters !== null || value.nearestToMeters !== null || value.mode !== 'tray-network' || value.comparison !== null)
      context.addIssue({ code: 'custom', message: 'Missing eligible geometry cannot authorize direct SECONDARY.' });
    return;
  }
  if (value.nearestFromMeters === null || value.nearestToMeters === null) {
    context.addIssue({ code: 'custom', message: 'Both exact nearest eligible tray distances are required.' }); return;
  }
  // Strict comparisons use the recorded C# doubles, never the evidence tolerance.
  const from = value.distanceMeters < value.nearestFromMeters, to = value.distanceMeters < value.nearestToMeters;
  if (value.mode !== (from || to ? 'direct-secondary' : 'tray-network')
    || value.comparison !== (from && to ? 'both' : from ? 'from-approach' : to ? 'to-approach' : null))
    context.addIssue({ code: 'custom', message: 'Direct SECONDARY requires the strict nearest-approach OR decision.' });
});
export type DirectSecondaryDecision = z.infer<typeof directSecondaryDecisionSchema>;
type DirectRouteEvidence = {
  success: boolean; routeText: string; routeCodes: readonly string[]; segmentIds: readonly string[];
  points: ReadonlyArray<readonly [number, number, number]>; lengthMeters: number; fromDistanceMeters: number; toDistanceMeters: number;
  fromRequiresSecondary: boolean; toRequiresSecondary: boolean; connectionGapCount: number; connectionGapLengthMeters: number;
};
/** Shape/evidence validation, not a replacement for the C# routing or length calculation. */
export function directSecondaryRouteIssue(decision: DirectSecondaryDecision, route: DirectRouteEvidence): string | null {
  if (decision.mode !== 'direct-secondary') return null;
  if (!route.success || route.routeText !== '/SECONDARY' || route.routeCodes.length !== 1 || route.routeCodes[0] !== '/SECONDARY'
    || route.segmentIds.length !== 0 || route.lengthMeters !== decision.distanceMeters || route.fromDistanceMeters !== 0 || route.toDistanceMeters !== 0
    || route.fromRequiresSecondary || route.toRequiresSecondary || route.connectionGapCount !== 0 || route.connectionGapLengthMeters !== 0)
    return 'Direct SECONDARY must retain its exact raw distance without tray IDs, legacy allowances or extra gaps.';
  const points = decision.distanceMeters === 0 ? [decision.fromPoint] : [decision.fromPoint, decision.toPoint];
  return route.points.length !== points.length || route.points.some((value, at) => value.length !== 3 || value.some((number, axis) => number !== points[at][axis]))
    ? 'Direct SECONDARY must retain the exact ordered canonical endpoint points.' : null;
}
