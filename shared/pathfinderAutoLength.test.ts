import { describe, expect, it } from 'vitest';
import { autoLengthViewSchema, emptyAutoLengthView } from './pathfinderAutoLength.js';

describe('small public Auto length view', () => {
  const checked = { autoCalculatedLength: 54, autoLengthStatus: 'calculated', autoLengthCalculatedAt: '2026-10-21T16:00:00.000Z',
    autoLengthBarrierStatus: 'clear', autoLengthMatchesLatestRequest: true };
  it('does not replace a missing PF result with zero or a legacy tray estimate', () => {
    expect(autoLengthViewSchema.parse(emptyAutoLengthView())).toEqual({ autoCalculatedLength: null, autoLengthStatus: 'not-calculated',
      autoLengthCalculatedAt: null, autoLengthBarrierStatus: null, autoLengthMatchesLatestRequest: false });
  });
  it('retains exact safe whole numbers including legitimate zero', () => {
    for (const value of [0, 54, 1_000_000]) expect(autoLengthViewSchema.parse({ ...checked, autoCalculatedLength: value }).autoCalculatedLength).toBe(value);
  });
  it.each([-1, 1.1, 1_000_001, NaN, Infinity, '54'])('rejects an unsafe displayed length %s', value => {
    expect(autoLengthViewSchema.safeParse({ ...checked, autoCalculatedLength: value }).success).toBe(false);
  });
  it.each(['pending', 'blocked', 'failed', 'cancelled', 'stale', 'unavailable', 'last-successful'])('preserves a checked earlier length during %s', autoLengthStatus => {
    expect(autoLengthViewSchema.parse({ ...checked, autoLengthStatus, autoLengthMatchesLatestRequest: false }).autoCalculatedLength).toBe(54);
  });
  it('requires honest paired metadata and a real latest success for calculated', () => {
    for (const patch of [{ autoCalculatedLength: null }, { autoLengthCalculatedAt: null }, { autoLengthBarrierStatus: null },
      { autoLengthMatchesLatestRequest: false }, { autoLengthStatus: 'not-calculated' }])
      expect(autoLengthViewSchema.safeParse({ ...checked, ...patch }).success).toBe(false);
    expect(autoLengthViewSchema.safeParse({ ...emptyAutoLengthView(), autoLengthStatus: 'last-successful' }).success).toBe(false);
  });
  it('does not expose source identifiers, object coordinates or authority fields', () => {
    for (const field of ['proposalId', 'jobId', 'modelId', 'point', 'token', 'canApply', 'isAdmin'])
      expect(autoLengthViewSchema.safeParse({ ...checked, [field]: field }).success).toBe(false);
  });
});
