import { describe, expect, it } from 'vitest';
import { locationImpactCalculationSchema, locationImpactItemSchema, locationImpactPageQuerySchema, locationImpactRecordSchema, locationImpactSummarySchema } from './pathfinderLocationImpacts.js';
const id = (n: number) => `f3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const current = { modelVersionId: id(2), selectionRevision: '1', contentFingerprint: 'a'.repeat(64), aggregateId: id(3), artifactId: id(4), captureFrameId: id(5), projectionSha256: 'b'.repeat(64), geometryRevision: '2', traceId: id(6) };
const record = () => ({ schemaVersion: 'wfc.pf.location-impact-record.v1', id: id(10), projectId: id(1), actorId: id(7), actorAdminRevision: '0', loginId: id(8),
  loginExpiresAt: '2026-10-20T23:00:00.000Z', authorityExpiresAt: '2026-10-20T22:30:00.000Z', installationEpoch: id(9), idempotencyKey: id(11), commandSha256: 'c'.repeat(64),
  locationId: id(12), bindingId: id(13), bindingContentSha256: 'd'.repeat(64), observedRegistryRevision: '12', current,
  calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 }, eligibleCableIds: [id(20), id(21)],
  excludedMvCableIds: [id(22)], blockedCategoryCableIds: [id(23)], createdAt: '2026-10-20T22:00:00.000Z', contentSha256: 'e'.repeat(64) });
const item = () => ({ schemaVersion: 'wfc.pf.location-impact-item.v1', projectId: id(1), impactId: id(10), cableId: id(20), generation: '1', cableWriteRevision: '9007199254740993',
  fromLogicalKey: 'EQUIPMENT', toLogicalKey: 'OTHER', category: 'LV', eligible: true, contentSha256: 'f'.repeat(64) });
describe('scoped impact contracts', () => {
  it('requires explicit finite preferences and timeout, never supplies defaults', () => { expect(locationImpactCalculationSchema.safeParse({}).success).toBe(false); expect(locationImpactCalculationSchema.safeParse(record().calculation).success).toBe(true); });
  it.each([{ preferences: { secondaryDistanceMeters: NaN, preferVerticalApproach: true }, timeoutMilliseconds: 60000 }, { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 0 }])('refuses invalid config %j', value => expect(locationImpactCalculationSchema.safeParse(value).success).toBe(false));
  it('retains disjoint eligible/MV/unknown groups and missing configuration as explicit null', () => { expect(locationImpactRecordSchema.safeParse(record()).success).toBe(true); expect(locationImpactRecordSchema.safeParse({ ...record(), calculation: null }).success).toBe(true); });
  it.each(['duplicate', 'order', 'expiry', 'duration'] as const)('refuses inconsistent scope %s', kind => {
    const r = record(); if (kind === 'duplicate') r.excludedMvCableIds = [id(20)]; if (kind === 'order') r.eligibleCableIds.reverse();
    if (kind === 'expiry') r.authorityExpiresAt = '2026-10-21T00:00:00.000Z'; if (kind === 'duration') r.authorityExpiresAt = '2026-10-20T22:30:00.001Z'; expect(locationImpactRecordSchema.safeParse(r).success).toBe(false);
  });
  it('does not re-NFC normalize already produced uppercase Greek keys', () => {
    const fromLogicalKey = 'ΐ'.normalize('NFC').trim().toUpperCase(); expect(fromLogicalKey.normalize('NFC')).not.toBe(fromLogicalKey);
    expect(locationImpactItemSchema.safeParse({ ...item(), fromLogicalKey }).success).toBe(true);
  });
  it.each(['MV', null, 'Unknown', 'Instrumentation'])('requires exact eligibility for category %s', category => {
    expect(locationImpactItemSchema.safeParse({ ...item(), category, eligible: category === 'Instrumentation' }).success).toBe(category !== 'MV');
  });
  it('preserves large CAS and target generations as decimal strings and rejects generation0', () => { expect(locationImpactItemSchema.parse(item()).cableWriteRevision).toBe('9007199254740993'); expect(locationImpactItemSchema.safeParse({ ...item(), generation: '0' }).success).toBe(false); });
  it('bounds rediscovery pages without loading full project state', () => { expect(locationImpactPageQuerySchema.parse({})).toEqual({ limit: 25 }); for (const limit of [0, 101]) expect(locationImpactPageQuerySchema.safeParse({ limit }).success).toBe(false); });
  it('summary cannot change the declared model scope or fabricate an ETA field', () => {
    const r = record(), summary = { id: r.id, projectId: r.projectId, actorId: r.actorId, modelVersionId: current.modelVersionId, selectionRevision: current.selectionRevision,
      contentFingerprint: current.contentFingerprint, current, calculation: r.calculation, status: 'queued', reasonCodes: [], eligibleCables: 2, excludedMvCables: 1,
      blockedCategoryCables: 1, currentTargetCables: 2, completed: 0, total: 2, readyCables: 2, blockedCables: 0, jobId: id(30), createdAt: r.createdAt,
      updatedAt: r.createdAt, admittedAt: r.createdAt, authorityExpiresAt: r.authorityExpiresAt, currentAuthority: true, elapsedMilliseconds: 0, admissionElapsedMilliseconds: 0 };
    expect(locationImpactSummarySchema.safeParse(summary).success).toBe(true); expect(locationImpactSummarySchema.safeParse({ ...summary, current: { ...current, selectionRevision: '2' } }).success).toBe(false);
    expect(locationImpactSummarySchema.safeParse({ ...summary, eta: 10 }).success).toBe(false);
  });
});
