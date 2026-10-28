import { recalculationContextSchema, type RecalculationCommand, type RecalculationContext } from './pathfinderRecalculation.js';

/** Synthetic contract inputs only; no application data or observed module digests. */
export const RECALCULATION_FIXTURE_PROJECT = '70000000-0000-4000-a000-000000000001';
export const RECALCULATION_FIXTURE_ACTOR = '70000000-0000-4000-a000-000000000002';
export const RECALCULATION_FIXTURE_KEY = '70000000-0000-4000-a000-000000000003';
export function recalculationFixture(overrides: Partial<RecalculationContext> = {}): RecalculationContext {
  return recalculationContextSchema.parse({
    schemaVersion: 'wfc.pf.recalculation-context.v1', projectId: RECALCULATION_FIXTURE_PROJECT,
    controlRevision: '0', desiredGeneration: '0', enrolledGeneration: null,
    status: 'disabled', enabled: false, paused: false, authority: null, reasonCodes: [], jobId: null,
    completed: 0, total: 0, readyCables: 0, blockedCables: 0, updatedAt: '2026-01-01T00:00:00.000Z',
    preferences: null, timeoutMilliseconds: null, ...overrides,
  });
}
export function recalculationEnableFixture(): Extract<RecalculationCommand, { action: 'enable' }> {
  return {
    schemaVersion: 'wfc.pf.recalculation-command.v1', action: 'enable', expectedControlRevision: '0',
    idempotencyKey: RECALCULATION_FIXTURE_KEY, reason: 'Synthetic current-login enrollment.',
    preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60_000,
  };
}
