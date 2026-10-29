import { describe, expect, it } from 'vitest';
import { requireCalculationLengthLedger } from './lengthLedger.js';
import type { EngineResponse, ProjectSettings } from './jobContracts.js';
import type { LengthLedger } from '../../shared/pathfinderLengthLedger.js';
import { DIRECT_SECONDARY_POLICY } from '../../shared/pathfinderDirectSecondary.js';

const settings:ProjectSettings={revision:'2',connectionGap:'1',secondaryTrayLength:null,endConnectionLength:'2.00',additionalBendingPercent:'10.0'};
const ledger:LengthLedger={schemaVersion:'wfc.pf.length-components.v1',formulaVersion:'pathfinder-45c24bf5',settingsRevision:'2',
  raw:{lengthMeters:3,fromDistanceMeters:1,toDistanceMeters:1},rawLengthDecimalMeters:'3',
  from:{requiresSecondary:false,removedApproachMeters:'0'},to:{requiresSecondary:false,removedApproachMeters:'0'},
  settings:{secondaryTrayLengthMeters:null,endConnectionLengthMeters:'2',additionalBendingPercent:'10'},secondaryEnds:0,replacementMeters:'0',
  beforeClampMeters:'3',clampAdjustmentMeters:'0',afterClampMeters:'3',beforePercentageMeters:'5',bendingIncrementMeters:'0.5',unroundedMeters:'5.5',ceilingIncrementMeters:'0.5',designLengthMeters:'6',gapAccounting:'already-in-raw-geometry'};
const response=():EngineResponse=>({schemaVersion:'pathfinder.model.response.v1',requestId:'00000000-0000-4000-8000-000000000001',status:'calculated',message:'',engineeringAccepted:false,
  route:{success:true,message:'',routeText:'/A',routeCodes:['A'],segmentIds:['id'],pathPoints:[],lengthMeters:3,fromDistanceMeters:1,toDistanceMeters:1,fromRequiresSecondary:false,toRequiresSecondary:false,connectionGapCount:1,connectionGapLengthMeters:0.5},
  design:{lengthBeforePercentageMeters:'5.00',unroundedLengthMeters:'5.50',designLengthMeters:'6'},lengthLedger:structuredClone(ledger)});
const directResponse = (): EngineResponse => {
  const directSecondary = { schemaVersion: 'wfc.pf.direct-secondary.v1' as const, policyVersion: DIRECT_SECONDARY_POLICY, coordinateFrame: 'canonical-world-metres' as const,
    mode: 'direct-secondary' as const, fromPoint: [0, 0, 0] as [number, number, number], toPoint: [3, 0, 0] as [number, number, number], distanceMeters: 3,
    nearestFromMeters: 4, nearestToMeters: 5, eligibleTrays: 1, comparison: 'both' as const };
  return { ...response(), schemaVersion: 'pathfinder.model.response.v2', status: 'calculated', effectiveCategory: 'LV', directSecondary,
    route: { ...response().route!, routeText: '/SECONDARY', routeCodes: ['/SECONDARY'], segmentIds: [], pathPoints: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }],
      fromDistanceMeters: 0, toDistanceMeters: 0, connectionGapCount: 0, connectionGapLengthMeters: 0 },
    lengthLedger: { ...structuredClone(ledger), schemaVersion: 'wfc.pf.length-components.v2', formulaVersion: 'direct-secondary-3d.v1',
      raw: { lengthMeters: 3, fromDistanceMeters: 0, toDistanceMeters: 0 }, directSecondary: structuredClone(directSecondary) } };
};

describe('length observer response binding',()=>{
  it('retains exact C# components and tolerates stored setting scale only',()=>{
    const value=response();expect(requireCalculationLengthLedger(value,settings)).toEqual(ledger);
    expect(value.route?.connectionGapLengthMeters).toBe(0.5);
  });
  it('refuses a missing or cross-settings ledger for an opted-in success',()=>{
    const absent=response();delete absent.lengthLedger;
    expect(()=>requireCalculationLengthLedger(absent,settings)).toThrowError(/components/);
    expect(()=>requireCalculationLengthLedger(response(),{...settings,revision:'3'})).toThrow();
    expect(()=>requireCalculationLengthLedger(response(),{...settings,endConnectionLength:'3'})).toThrow();
    expect(()=>requireCalculationLengthLedger(response(),{...settings,secondaryTrayLength:'0'})).toThrow();
  });
  it('refuses exchanged result totals, raw geometry and SECONDARY flags',()=>{
    const total=response();total.design!.unroundedLengthMeters='5.500001';expect(()=>requireCalculationLengthLedger(total,settings)).toThrow();
    const raw=response();raw.route!.lengthMeters=4;expect(()=>requireCalculationLengthLedger(raw,settings)).toThrow();
    const secondary=response();secondary.route!.fromRequiresSecondary=true;expect(()=>requireCalculationLengthLedger(secondary,settings)).toThrow();
  });
  it('allows no ledger on failed calculations and rejects contradictory components',()=>{
    const failed=response();failed.status='no_path';delete failed.lengthLedger;expect(requireCalculationLengthLedger(failed,settings)).toBeNull();
    failed.lengthLedger=ledger;expect(()=>requireCalculationLengthLedger(failed,settings)).toThrow();
    const malformed=response();malformed.lengthLedger!.from.removedApproachMeters='1';expect(()=>requireCalculationLengthLedger(malformed,settings)).toThrow();
    const count=response();count.lengthLedger!.secondaryEnds=2;expect(()=>requireCalculationLengthLedger(count,settings)).toThrow();
  });
  it('binds a direct v2 ledger to exact decision, endpoints, no gaps and current audit-only S', () => {
    const value = directResponse(); expect(requireCalculationLengthLedger(value, settings)).toEqual(value.lengthLedger);
    expect(() => requireCalculationLengthLedger(value, { ...settings, secondaryTrayLength: '7' })).toThrow();
    value.lengthLedger!.settings.secondaryTrayLengthMeters = '7';
    expect(requireCalculationLengthLedger(value, { ...settings, secondaryTrayLength: '7' })?.designLengthMeters).toBe('6');
  });
  it.each(['legacy-response', 'legacy-ledger', 'decision', 'point', 'route', 'segment', 'gap', 'old-flag'] as const)('refuses cross-strategy direct proof: %s', change => {
    const value = directResponse();
    if (change === 'legacy-response') Object.assign(value, { schemaVersion: 'pathfinder.model.response.v1' });
    if (change === 'legacy-ledger') value.lengthLedger = structuredClone(ledger);
    if (change === 'decision' && value.schemaVersion === 'pathfinder.model.response.v2') value.directSecondary.nearestFromMeters = 100;
    if (change === 'point') value.route!.pathPoints[1].x = 4;
    if (change === 'route') value.route!.routeText = '/A';
    if (change === 'segment') value.route!.segmentIds.push('imaginary-tray');
    if (change === 'gap') value.route!.connectionGapLengthMeters = 1;
    if (change === 'old-flag') value.route!.fromRequiresSecondary = true;
    expect(() => requireCalculationLengthLedger(value, settings)).toThrow();
  });
});
