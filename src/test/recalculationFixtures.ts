import { recalculationContextSchema, recalculationCommandSchema, recalculationReceiptSchema } from '../../shared/pathfinderRecalculation';
export const recalculationIds = { project: '11111111-1111-4111-8111-111111111111', actor: '22222222-2222-4222-8222-222222222222', key: '33333333-3333-4333-8333-333333333333' };
export function recalculationFixture() {
  const context = recalculationContextSchema.parse({
    schemaVersion: 'wfc.pf.recalculation-context.v1', projectId: recalculationIds.project, controlRevision: '4', desiredGeneration: '7', enrolledGeneration: null,
    status: 'disabled', enabled: false, paused: false, authority: null, reasonCodes: [], jobId: null, completed: 0, total: 2, readyCables: 1, blockedCables: 1,
    updatedAt: '2026-10-19T00:00:00.000Z', preferences: null, timeoutMilliseconds: null,
  });
  const command = recalculationCommandSchema.parse({ schemaVersion: 'wfc.pf.recalculation-command.v1', action: 'enable', expectedControlRevision: '4', idempotencyKey: recalculationIds.key, reason: 'Enable current project calculation.', preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 });
  const enabled = recalculationContextSchema.parse({ ...context, controlRevision: '5', enabled: true, enrolledGeneration: '7', status: 'queued', preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000, authority: { kind: 'current-login', actorId: recalculationIds.actor, currentLogin: true, expiresAt: '2026-10-19T00:30:00.000Z' } });
  return { context, command, enabled, receipt: recalculationReceiptSchema.parse({ schemaVersion: 'wfc.pf.recalculation-command-receipt.v1', duplicate: false, context: enabled }) };
}
