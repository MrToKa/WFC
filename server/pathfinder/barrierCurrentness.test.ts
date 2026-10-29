// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isExpectedBarrierCurrentnessError } from './barrierCurrentness.js';
import { PathFinderError } from './errors.js';

describe('explicit barrier currentness refusal classification', () => {
  it.each([
    ['BARRIER_CALCULATION_SCOPE_CHANGED',409],['BARRIER_CONTEXT_CHANGED',409],['BARRIER_CURRENT_FRAME_UNAVAILABLE',409],
    ['BARRIER_CALCULATION_STORAGE_INVALID',409],['BARRIER_BLOB_INTEGRITY',409],['BARRIER_READY_SNAPSHOT_REQUIRED',409],
    ['BARRIER_CALCULATION_DEADLINE',503],['BARRIER_STORAGE_BUSY',503],
  ] as const)('classifies only the exact %s/%s typed refusal', (code,status) => {
    expect(isExpectedBarrierCurrentnessError(new PathFinderError(code,status))).toBe(true);
    expect(isExpectedBarrierCurrentnessError(new PathFinderError(code,status === 409 ? 503 : 409))).toBe(false);
    expect(isExpectedBarrierCurrentnessError(Object.assign(new Error('Untyped refusal.'),{code,status}))).toBe(false);
    expect(isExpectedBarrierCurrentnessError({code,status})).toBe(false);
  });
  it.each([
    new PathFinderError('ADMIN_REQUIRED',403),new PathFinderError('LOGIN_REVOKED',401),new PathFinderError('JOB_FENCED',409),
    new PathFinderError('CALCULATION_GRANT_SCOPE_DENIED',403),new PathFinderError('LOCATION_IMPACT_TARGET_SUPERSEDED',409),
    new PathFinderError('CALCULATION_ENGINE_UNAVAILABLE',503),new PathFinderError('ENGINE_IMPLEMENTATION_RESTART_REQUIRED',503),
    new PathFinderError('ENGINE_SESSION_REAP_FAILED',503),new PathFinderError('BARRIER_IDENTITY_UPGRADE_REQUIRED',409),
    new PathFinderError('BARRIER_UNKNOWN_FAILURE',409),new PathFinderError('PATHFINDER_COMMIT_OUTCOME_UNKNOWN',503),
    Object.assign(new Error('Missing raw file is normalized only by its storage reader.'),{code:'ENOENT'}),
    Object.assign(new Error('Cancelled.'),{name:'AbortError'}),new TypeError('Invalid projection.'),null,
  ])('does not hide unrelated failures %s', failure => {
    expect(isExpectedBarrierCurrentnessError(failure)).toBe(false);
  });
});
