import { z } from 'zod';
import { policyUuidSchema as uuid } from './pathfinderPurposePolicy.js';
import { initialFillMandateReferenceSchema } from './pathfinderInitialFill.js';

export const INITIAL_FILL_PROGRESS_LIMITS = Object.freeze({ cables: 10000, responseBytes: 16384, pollMilliseconds: 2000 });
export const initialFillProgressStatuses = ['pending', 'running', 'written', 'already-written', 'review-required', 'stale', 'authority-expired', 'refused', 'unknown', 'awaiting-result', 'not-applicable'] as const;
export const initialFillProgressStatusSchema = z.enum(initialFillProgressStatuses);
export type InitialFillProgressStatus = z.infer<typeof initialFillProgressStatusSchema>;
const count = z.number().int().min(0).max(INITIAL_FILL_PROGRESS_LIMITS.cables);
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/).nullable();
const counters = z.object({ pending: count, running: count, written: count, 'already-written': count, 'review-required': count, stale: count,
  'authority-expired': count, refused: count, unknown: count, 'awaiting-result': count, 'not-applicable': count }).strict();
export const initialFillProgressQuerySchema = z.object({ impactId: uuid, cableId: uuid.optional() }).strict();
export type InitialFillProgressQuery = z.infer<typeof initialFillProgressQuerySchema>;
/** Observation only: authorized identifies a retained mandate, never permission for a new write. */
export const initialFillProgressSchema = z.object({ schemaVersion: z.literal('wfc.pf.initial-fill-progress.v1'), projectId: uuid, actorId: uuid, impactId: uuid,
  mandate: initialFillMandateReferenceSchema.nullable(), authorized: z.boolean(), currentAuthority: z.boolean(), eligibleCables: count,
  counters, retryableUnknown: count, outstanding: count,
  selected: z.object({ cableId: uuid, status: z.union([initialFillProgressStatusSchema, z.literal('not-authorized')]), reasonCode: reason, receiptId: uuid.nullable() }).strict().nullable(),
}).strict().superRefine((value, context) => {
  const sum = Object.values(value.counters).reduce((total, n) => total + n, 0);
  if (value.authorized !== (value.mandate !== null) || value.mandate !== null && value.mandate.impactId !== value.impactId
    || value.currentAuthority && !value.authorized || value.retryableUnknown > value.counters.unknown
    || value.outstanding !== value.counters.pending + value.counters.running + value.retryableUnknown + value.counters['awaiting-result']
    || sum > value.eligibleCables || value.authorized && sum !== value.eligibleCables
    || !value.authorized && (sum !== 0 || value.outstanding !== 0 || value.selected !== null && value.selected.status !== 'not-authorized')
    || value.selected?.status === 'not-authorized' && value.authorized
    || value.selected !== null && (['written', 'already-written'].includes(value.selected.status) !== (value.selected.receiptId !== null))) {
    context.addIssue({ code: 'custom', message: 'Initial-fill observations must match one bounded explicit mandate and actual outstanding work.' });
  }
});
export type InitialFillProgress = z.infer<typeof initialFillProgressSchema>;
export const emptyInitialFillCounters = (): InitialFillProgress['counters'] => ({ pending: 0, running: 0, written: 0, 'already-written': 0,
  'review-required': 0, stale: 0, 'authority-expired': 0, refused: 0, unknown: 0, 'awaiting-result': 0, 'not-applicable': 0 });
