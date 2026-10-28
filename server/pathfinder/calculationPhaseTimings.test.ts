import { describe, expect, it } from 'vitest';
import { createCalculationPhaseTimings, type CalculationTimingRecord } from './calculationPhaseTimings.js';
const jobId = '11111111-2222-4333-8444-555555555555';
describe('bounded calculation phase diagnostics', () => {
  it('records completed and rejected phases without changing their values', async () => {
    const records: CalculationTimingRecord[] = []; let at = 0;
    const timing = createCalculationPhaseTimings(jobId, { enabled: true, now: () => at, emit: row => records.push(row) });
    expect(await timing.measure('native', async () => { at += 12; return 7; })).toBe(7);
    const refusal = new Error('original refusal');
    await expect(timing.measure('settlement', async () => { at += 5; throw refusal; })).rejects.toBe(refusal);
    at += 3; timing.finish('failed'); timing.finish('completed');
    expect(records).toEqual([{ schemaVersion: 'wfc.pf.calculation-phase-timings.v1', jobId, outcome: 'failed', wallMilliseconds: 20,
      phases: { native: { calls: 1, milliseconds: 12 }, settlement: { calls: 1, milliseconds: 5 } } }]);
  });
  it('does not read the clock or emit without explicit opt-in and a bounded job identity', async () => {
    const clock = () => { throw new Error('not called'); }, emit = () => { throw new Error('not emitted'); };
    for (const timing of [createCalculationPhaseTimings(jobId, { enabled: false, now: clock, emit }),
      createCalculationPhaseTimings('client supplied text', { enabled: true, now: clock, emit })]) {
      expect(await timing.measure('native', async () => 4)).toBe(4); timing.finish('completed');
    }
  });
  it('a failed diagnostic clock or sink cannot replace successful work', async () => {
    const timing = createCalculationPhaseTimings(jobId, { enabled: true, now: () => { throw Error('clock'); }, emit: () => { throw Error('sink'); } });
    expect(await timing.measure('native', async () => 9)).toBe(9); expect(() => timing.finish('completed')).not.toThrow();
  });
});
