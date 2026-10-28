import { describe, expect, it } from 'vitest';
import { calculationAvailabilitySchema, notEvaluatedCalculationAvailability } from './pathfinderCalculationAvailability';

const automatic = { status: 'automatic-ready', pointAvailable: true, source: 'automatic-model-candidate',
  approximate: true, candidateObjectIds: ['dbid:17'], reasonCode: null, engineeringAccepted: false };
describe('display calculation-point evidence', () => {
  it('keeps an approximate usable point separate from engineering acceptance', () => {
    expect(calculationAvailabilitySchema.parse(automatic)).toEqual(automatic);
    expect(calculationAvailabilitySchema.parse({ ...automatic, status: 'confirmed-ready', source: 'confirmed-shared-location', approximate: false })).toMatchObject({ pointAvailable: true, engineeringAccepted: false });
    expect(notEvaluatedCalculationAvailability()).toMatchObject({ status: 'not-evaluated', pointAvailable: false, source: null, approximate: false });
  });
  it.each([{ pointAvailable: false }, { source: 'confirmed-shared-location' }, { source: null },
    { approximate: false }, { reasonCode: 'UNKNOWN' }, { candidateObjectIds: [] },
    { candidateObjectIds: ['dbid:17', 'dbid:18'] }, { engineeringAccepted: true },
    { point: [1, 2, 3] }])('refuses contradictory or extra ready evidence %j', change => {
    expect(calculationAvailabilitySchema.safeParse({ ...automatic, ...change }).success).toBe(false);
  });
  it('requires explicit blocked reasons and refuses silent candidate truncation', () => {
    const blocked = notEvaluatedCalculationAvailability('AVAILABILITY_DISPLAY_LIMIT');
    expect(calculationAvailabilitySchema.safeParse({ ...blocked, reasonCode: null }).success).toBe(false);
    expect(calculationAvailabilitySchema.safeParse({ ...blocked, reasonCode: 'AVAILABILITY_DISPLAY_LIMIT\n' }).success).toBe(false);
    expect(calculationAvailabilitySchema.safeParse({ ...blocked, source: 'automatic-model-candidate' }).success).toBe(false);
    expect(calculationAvailabilitySchema.safeParse({ ...blocked, candidateObjectIds: ['dbid:1', 'dbid:1'] }).success).toBe(false);
    expect(calculationAvailabilitySchema.safeParse({ ...blocked, candidateObjectIds: Array.from({ length: 2049 }, (_, n) => 'dbid:' + n) }).success).toBe(false);
  });
});
