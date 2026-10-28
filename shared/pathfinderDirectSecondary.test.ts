import { describe, expect, it } from 'vitest';
import { DIRECT_SECONDARY_POLICY, directSecondaryDecisionSchema, directSecondaryRouteIssue, type DirectSecondaryDecision } from './pathfinderDirectSecondary.js';

const decision = (): DirectSecondaryDecision => ({ schemaVersion: 'wfc.pf.direct-secondary.v1', policyVersion: DIRECT_SECONDARY_POLICY,
  coordinateFrame: 'canonical-world-metres', mode: 'direct-secondary', fromPoint: [0, 0, 0], toPoint: [0, 3, 4], distanceMeters: 5,
  nearestFromMeters: 6, nearestToMeters: 7, eligibleTrays: 1, comparison: 'both' });
describe('versioned direct SECONDARY evidence', () => {
  it.each([[6, 4, 'from-approach'], [4, 6, 'to-approach'], [6, 7, 'both']] as const)('accepts either strict OR branch %s/%s', (from, to, comparison) => {
    expect(directSecondaryDecisionSchema.parse({ ...decision(), nearestFromMeters: from, nearestToMeters: to, comparison }).mode).toBe('direct-secondary');
  });
  it('retains equality and graph-only shorter cases as tray-network', () => {
    for (const [from, to] of [[5, 5], [4, 5], [1, 1]]) {
      expect(directSecondaryDecisionSchema.parse({ ...decision(), nearestFromMeters: from, nearestToMeters: to, mode: 'tray-network', comparison: null }).mode).toBe('tray-network');
      expect(directSecondaryDecisionSchema.safeParse({ ...decision(), nearestFromMeters: from, nearestToMeters: to }).success).toBe(false);
    }
  });
  it('allows zero distance, no fixed upper direct distance, and absent eligible geometry only as unavailable fallback', () => {
    expect(directSecondaryDecisionSchema.safeParse({ ...decision(), toPoint: [0, 0, 0], distanceMeters: 0 }).success).toBe(true);
    expect(directSecondaryDecisionSchema.safeParse({ ...decision(), toPoint: [1e9, 0, 0], distanceMeters: 1e9, nearestFromMeters: 2e9, nearestToMeters: 3e9 }).success).toBe(true);
    const missing = { ...decision(), eligibleTrays: 0, nearestFromMeters: null, nearestToMeters: null, mode: 'tray-network', comparison: null };
    expect(directSecondaryDecisionSchema.safeParse(missing).success).toBe(true);
    expect(directSecondaryDecisionSchema.safeParse({ ...missing, mode: 'direct-secondary' }).success).toBe(false);
  });
  it.each([
    { coordinateFrame: 'display' }, { policyVersion: 'future' }, { distanceMeters: 4.99 }, { distanceMeters: Infinity },
    { fromPoint: [NaN, 0, 0] }, { nearestFromMeters: null }, { nearestToMeters: -1 }, { comparison: 'from-approach' },
    { eligibleTrays: 0 }, { eligibleTrays: 1.5 }, { collisionFree: true }, { mode: 'tray-network', comparison: null },
  ])('refuses inconsistent, nonfinite or unsupported evidence %j', change => {
    expect(directSecondaryDecisionSchema.safeParse({ ...decision(), ...change }).success).toBe(false);
  });
  it('never turns equality into strict inequality using the 3D evidence comparison tolerance', () => {
    expect(directSecondaryDecisionSchema.safeParse({ ...decision(), nearestFromMeters: 5, nearestToMeters: 5, comparison: 'both' }).success).toBe(false);
    expect(directSecondaryDecisionSchema.safeParse({ ...decision(), nearestFromMeters: 5 + Number.EPSILON * 4, nearestToMeters: 5, comparison: 'from-approach' }).success).toBe(true);
  });
  it('preserves the Core distance overflow and tiny-square underflow boundary', () => {
    expect(directSecondaryDecisionSchema.safeParse({ ...decision(), toPoint: [1e-200, 0, 0], distanceMeters: 0 }).success).toBe(true);
    expect(directSecondaryDecisionSchema.safeParse({ ...decision(), toPoint: [1e-10, 0, 0], distanceMeters: 0 }).success).toBe(false);
    expect(directSecondaryDecisionSchema.safeParse({ ...decision(), toPoint: [1e308, 0, 0], distanceMeters: 1e308, nearestFromMeters: 1e308, nearestToMeters: 1e308, mode: 'tray-network', comparison: null }).success).toBe(false);
  });
  it('checks direct ordered points, zero-length single point and no fabricated tray/gap additions', () => {
    const evidence = decision(), route = { success: true, routeText: '/SECONDARY', routeCodes: ['/SECONDARY'], segmentIds: [], points: [evidence.fromPoint, evidence.toPoint],
      lengthMeters: 5, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 };
    expect(directSecondaryRouteIssue(evidence, route)).toBeNull();
    expect(directSecondaryRouteIssue(evidence, { ...route, points: [...route.points].reverse() })).not.toBeNull();
    expect(directSecondaryRouteIssue(evidence, { ...route, segmentIds: ['fake'] })).not.toBeNull();
    expect(directSecondaryRouteIssue(evidence, { ...route, connectionGapLengthMeters: 1 })).not.toBeNull();
    const zero: DirectSecondaryDecision = { ...evidence, toPoint: [0, 0, 0], distanceMeters: 0 };
    expect(directSecondaryRouteIssue(zero, { ...route, points: [zero.fromPoint], lengthMeters: 0 })).toBeNull();
    expect(directSecondaryRouteIssue(zero, { ...route, points: [zero.fromPoint, zero.toPoint], lengthMeters: 0 })).not.toBeNull();
  });
});
