import { describe, expect, it } from 'vitest';
import { AUTOMATIC_PAIR_POLICY, automaticPairPolicySchema, automaticPairMandateSchema } from './pathfinderAutomaticPair.js';

const id = (n: number) => `ba000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.UTC(2026, 9, 23), iso = (n: number) => new Date(now + n).toISOString();
function mandate() { return { schemaVersion: 'wfc.pf.automatic-pair-mandate.v1', id: id(1), projectId: id(2), jobId: id(3), cableId: id(4),
  actorId: id(5), actorAdminRevision: '0', loginId: id(6), loginExpiresAt: iso(3600000), authorityExpiresAt: iso(60000), installationEpoch: id(7), createdAt: iso(0),
  policy: AUTOMATIC_PAIR_POLICY, source: { kind: 'explicit-job' }, requestSha256: 'a'.repeat(64), dependencyHash: 'b'.repeat(64), cableWriteRevision: '7',
  baselineSha256: 'c'.repeat(64), ownership: { kind: 'empty' }, contentSha256: 'd'.repeat(64) }; }
describe('explicit versioned automatic pair policy', () => {
  it('accepts only the exact supported policy without defaulting missing authority', () => {
    expect(automaticPairPolicySchema.parse(AUTOMATIC_PAIR_POLICY)).toEqual(AUTOMATIC_PAIR_POLICY); expect(Object.isFrozen(AUTOMATIC_PAIR_POLICY)).toBe(true);
    for (const value of [null, {}, { mode: AUTOMATIC_PAIR_POLICY.mode }, { ...AUTOMATIC_PAIR_POLICY, schemaVersion: 'v2' }, { ...AUTOMATIC_PAIR_POLICY, apply: true }])
      expect(automaticPairPolicySchema.safeParse(value).success).toBe(false);
  });
  it('accepts bounded explicit authority', () => expect(automaticPairMandateSchema.parse(mandate()).ownership.kind).toBe('empty'));
  it.each(['expired', 'over login', 'over bound'] as const)('refuses %s authority', kind => {
    const m = mandate(); m.authorityExpiresAt = iso(kind === 'expired' ? 0 : kind === 'over login' ? 3600001 : 1800001);
    expect(automaticPairMandateSchema.safeParse(m).success).toBe(false);
  });
  it('never extends an earlier Save deadline', () => {
    const m = { ...mandate(), source: { kind: 'location-impact', impactId: id(8), createdAt: iso(-60000), authorityExpiresAt: iso(30000) } };
    expect(automaticPairMandateSchema.safeParse(m).success).toBe(false);
    m.authorityExpiresAt = iso(30000); expect(automaticPairMandateSchema.safeParse(m).success).toBe(true);
  });
});
