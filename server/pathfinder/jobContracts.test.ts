import { describe, expect, it } from 'vitest';
import { engineResponseSchema } from './jobContracts.js';
import { DIRECT_SECONDARY_POLICY } from '../../shared/pathfinderDirectSecondary.js';

const decision = () => ({ schemaVersion: 'wfc.pf.direct-secondary.v1', policyVersion: DIRECT_SECONDARY_POLICY, coordinateFrame: 'canonical-world-metres',
  mode: 'direct-secondary', fromPoint: [0, 0, 0], toPoint: [3, 0, 0], distanceMeters: 3, nearestFromMeters: 4, nearestToMeters: 5, eligibleTrays: 1, comparison: 'both' });
const route = () => ({ success: true, message: '', routeText: '/SECONDARY', routeCodes: ['/SECONDARY'], segmentIds: [], pathPoints: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }],
  lengthMeters: 3, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 });
const response = () => ({ schemaVersion: 'pathfinder.model.response.v2', requestId: '61000000-0000-4000-8000-000000000001', status: 'calculated', message: '', engineeringAccepted: false,
  effectiveCategory: 'Control', directSecondary: decision(), route: route(), design: { lengthBeforePercentageMeters: '5', unroundedLengthMeters: '5.5', designLengthMeters: '6' } });
describe('versioned direct engine response contract', () => {
  it('accepts opted executed strategy and retained-design success without a duplicated route', () => {
    expect(engineResponseSchema.parse(response()).schemaVersion).toBe('pathfinder.model.response.v2');
    const { route: _route, ...retained } = response(); expect(engineResponseSchema.parse(retained).status).toBe('calculated');
  });
  it('preserves byte-shaped early legacy failures and disallows a direct field on old v1 responses', () => {
    const legacy = { schemaVersion: 'pathfinder.model.response.v1', requestId: response().requestId, status: 'settings_required', message: 'Missing E', engineeringAccepted: false };
    expect(engineResponseSchema.parse(legacy)).toEqual(legacy);
    expect(engineResponseSchema.safeParse({ ...legacy, directSecondary: decision() }).success).toBe(false);
    expect(engineResponseSchema.safeParse({ ...response(), directSecondary: undefined }).success).toBe(false);
  });
  it.each([
    { effectiveCategory: 'MV' }, { effectiveCategory: null }, { effectiveCategory: undefined }, { status: 'no_path' }, { status: 'prepared' }, { status: 'lookup_planned' },
    { directSecondary: { ...decision(), distanceMeters: 2 } }, { route: { ...route(), routeCodes: ['SECONDARY'] } },
    { route: { ...route(), pathPoints: [{ x: 0, y: 0, z: 0 }] } }, { route: { ...route(), toRequiresSecondary: true } },
    { route: { ...route(), connectionGapCount: 1 } }, { route: { ...route(), segmentIds: ['fake'] } },
  ])('refuses forged branch/category/path evidence %j', change => {
    expect(engineResponseSchema.safeParse({ ...response(), ...change }).success).toBe(false);
  });
  it('allows no-path fallback only with truthful network evidence', () => {
    expect(engineResponseSchema.safeParse({ ...response(), status: 'no_path', route: undefined, design: null,
      directSecondary: { ...decision(), mode: 'tray-network', nearestFromMeters: 1, nearestToMeters: 1, comparison: null } }).success).toBe(true);
  });
});
