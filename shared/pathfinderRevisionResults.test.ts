import { describe, expect, it } from 'vitest';
import { REVISION_RESULTS_LIMITS, revisionAdmissionsPageSchema, revisionBaselineSchema, revisionResultDetailSchema, revisionResultsPageSchema,
  revisionStoredDecimalSchema } from './pathfinderRevisionResults.js';

const id = (n: number) => 'd9100000-0000-4000-8000-' + n.toString(16).padStart(12, '0'), hash = (n: string) => n.repeat(64);
const baseline = () => ({ schemaVersion: 'wfc.pf.cable-revision-baseline.v1', currentCable: { id: id(3), tag: null, fromLocation: null, toLocation: null,
  routing: null, designLength: '9007199254740993.00000001', installLength: null, cableWriteRevision: '9007199254740993' }, lastAcceptedApply: null, acceptedMatchesCurrent: false });
const row = () => ({ cableId: id(3), baseline: baseline(), baselineHash: hash('a'), status: 'location_required', message: 'Confirm the location.', result: null,
  currentness: { state: 'unavailable', reasonCodes: ['CALCULATION_OUTPUT_UNAVAILABLE'] } });

describe('strict bounded revision results wire contracts', () => {
  it('retains stored numeric text and never invents a legacy accepted baseline', () => {
    const value = revisionBaselineSchema.parse(baseline()); expect(value.currentCable.designLength).toBe('9007199254740993.00000001'); expect(value.lastAcceptedApply).toBeNull();
    expect(revisionBaselineSchema.safeParse({ ...baseline(), acceptedMatchesCurrent: true }).success).toBe(false);
    expect(revisionStoredDecimalSchema.safeParse('1e3').success).toBe(false); expect(revisionStoredDecimalSchema.safeParse('1\n').success).toBe(false);
  });
  it('requires stable tenant and generation admission identities, with no manufactured all-blocked job', () => {
    const admission = { id: id(2), projectId: id(1), jobId: null, generation: '17', kind: 'automatic', inputSha256: hash('b'), total: 2140, modelRef: null, createdAt: '2026-10-19T12:00:00Z' };
    expect(revisionAdmissionsPageSchema.parse({ schemaVersion: 'wfc.pf.revision-admissions-page.v1', projectId: id(1), admissions: [admission], nextCursor: null }).admissions[0].jobId).toBeNull();
    expect(revisionAdmissionsPageSchema.safeParse({ schemaVersion: 'wfc.pf.revision-admissions-page.v1', projectId: id(4), admissions: [admission], nextCursor: null }).success).toBe(false);
    expect(revisionAdmissionsPageSchema.safeParse({ schemaVersion: 'wfc.pf.revision-admissions-page.v1', projectId: id(1), admissions: [admission], nextCursor: 'abc\n' }).success).toBe(false);
  });
  it('refuses duplicate, unordered, foreign-cable or >100 result rows', () => {
    const page = { schemaVersion: 'wfc.pf.revision-results-page.v1', projectId: id(1), admissionId: id(2), rows: [row()], nextAfterCableId: null };
    expect(revisionResultsPageSchema.safeParse(page).success).toBe(true);
    expect(revisionResultsPageSchema.safeParse({ ...page, rows: [row(), row()] }).success).toBe(false);
    expect(revisionResultsPageSchema.safeParse({ ...page, rows: [{ ...row(), cableId: id(4) }] }).success).toBe(false);
    expect(revisionResultsPageSchema.safeParse({ ...page, rows: Array.from({ length: 101 }, row) }).success).toBe(false);
    expect(REVISION_RESULTS_LIMITS.pageSize).toBe(100);
  });
  it('allows blocked detail without engine output but refuses a claimed result without its envelope', () => {
    const value = { schemaVersion: 'wfc.pf.revision-result-detail.v1', projectId: id(1), admissionId: id(2), row: row(), envelope: null, engineResult: null, dependencies: null };
    expect(revisionResultDetailSchema.safeParse(value).success).toBe(true);
    expect(revisionResultDetailSchema.safeParse({ ...value, unknown: true }).success).toBe(false);
  });
});
