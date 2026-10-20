import { describe, expect, it } from 'vitest';
import { initialFillProgressSchema, initialFillProgressQuerySchema, emptyInitialFillCounters } from './pathfinderInitialFillProgress.js';
const id = (n: number) => `f8000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function value() { return { schemaVersion: 'wfc.pf.initial-fill-progress.v1', projectId: id(1), actorId: id(2), impactId: id(3),
  mandate: { id: id(4), contentSha256: 'a'.repeat(64), impactId: id(3), mode: 'when-both-empty' }, authorized: true, currentAuthority: true, eligibleCables: 2,
  counters: { ...emptyInitialFillCounters(), pending: 1, unknown: 1 }, retryableUnknown: 0, outstanding: 1, selected: null }; }
describe('bounded initial-fill observation contract', () => {
  it('distinguishes a retained mandate from current authority and retryable work', () => {
    expect(initialFillProgressSchema.parse(value()).outstanding).toBe(1);
    expect(initialFillProgressSchema.parse({ ...value(), currentAuthority: false, retryableUnknown: 1, outstanding: 2 }).authorized).toBe(true);
  });
  it('accepts terminal no-mandate observation without turning old calculation-only intent into permission', () => {
    expect(initialFillProgressSchema.parse({ ...value(), mandate: null, authorized: false, currentAuthority: false, counters: emptyInitialFillCounters(), outstanding: 0,
      selected: { cableId: id(5), status: 'not-authorized', reasonCode: 'INITIAL_FILL_EXPLICIT_MANDATE_REQUIRED', receiptId: null } }).outstanding).toBe(0);
  });
  it.each(['oversized', 'negative', 'sum', 'outstanding', 'retry', 'foreign-impact', 'implicit-authority', 'extra'] as const)('refuses contradictory %s metadata', kind => {
    const v: any = value(); if (kind === 'oversized') v.eligibleCables = 10001; if (kind === 'negative') v.counters.pending = -1; if (kind === 'sum') v.eligibleCables = 1;
    if (kind === 'outstanding') v.outstanding = 2; if (kind === 'retry') v.retryableUnknown = 2; if (kind === 'foreign-impact') v.mandate.impactId = id(99);
    if (kind === 'implicit-authority') v.mandate = null; if (kind === 'extra') v.credentials = 'never'; expect(initialFillProgressSchema.safeParse(v).success).toBe(false);
  });
  it('requires exact receipt metadata for written observations without treating a calculation as Updated', () => {
    const v = { ...value(), selected: { cableId: id(5), status: 'written', reasonCode: null, receiptId: id(6) } };
    expect(initialFillProgressSchema.safeParse(v).success).toBe(true);
    expect(initialFillProgressSchema.safeParse({ ...v, selected: { ...v.selected, receiptId: null } }).success).toBe(false);
    expect(initialFillProgressSchema.safeParse({ ...v, selected: { ...v.selected, status: 'running' } }).success).toBe(false);
  });
  it('rejects unknown query keys and malformed identities', () => {
    expect(initialFillProgressQuerySchema.safeParse({ impactId: id(3), cableId: id(5) }).success).toBe(true);
    expect(initialFillProgressQuerySchema.safeParse({ impactId: '../other' }).success).toBe(false);
    expect(initialFillProgressQuerySchema.safeParse({ impactId: id(3), actorId: id(2) }).success).toBe(false);
  });
});
