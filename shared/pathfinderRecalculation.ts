import { z } from 'zod';
import { canonicalPurposeJson, policyRevisionSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';

/** New refusal bounds, not a claim that full-scale runtime capacity is proven. */
export const RECALCULATION_LIMITS = Object.freeze({
  authorityMilliseconds: 1_800_000,
  collectionMilliseconds: 30_000,
  dependencyBytes: 32 * 1024 ** 2,
  neededLocationBytes: 32 * 1024 ** 2,
  cables: 10_000,
  neededLocations: 20_000,
  cableChunk: 250,
  headChunk: 500,
  producerProjectsPerTick: 5,
  itemQuantum: 1,
  controlBytes: 64 * 1024,
  responseBytes: 1024 * 1024,
  reasons: 64,
} as const);

const text = (maximum: number) => z.string().max(maximum).refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  && [...value].every(character => character.length !== 1 || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff));
const reasonText = text(2048).refine(value => value.trim().length > 0);
const timestamp = z.string().datetime({ offset: false }).refine(value => value.endsWith('Z') && !/[\u0000-\u0020]/u.test(value));
const count = z.number().int().nonnegative().max(RECALCULATION_LIMITS.cables);
export const recalculationReasonSchema = z.string().max(96).refine(value => /^[A-Z][A-Z0-9_]{0,95}$/.exec(value)?.[0] === value);
export const recalculationDomainSchema = z.enum(['model', 'geometry', 'routing', 'endpoints', 'settings', 'cables', 'engine', 'manual', 'preferences']);
export const recalculationStatusSchema = z.enum(['disabled', 'awaiting_authority', 'paused', 'debouncing', 'collecting', 'queued', 'calculating', 'complete', 'blocked', 'superseded', 'failed']);
export const recalculationPreferencesSchema = z.object({
  secondaryDistanceMeters: z.number().finite().min(0).max(1_000_000),
  preferVerticalApproach: z.boolean(),
}).strict();
export const recalculationTimeoutSchema = z.number().int().min(100).max(120_000);
export const recalculationAuthoritySchema = z.object({
  kind: z.literal('current-login'),
  actorId: policyUuidSchema,
  expiresAt: timestamp,
  /** Identity comparison for this reader; never a substitute for server authorization. */
  currentLogin: z.boolean(),
}).strict();
export const recalculationContextSchema = z.object({
  schemaVersion: z.literal('wfc.pf.recalculation-context.v1'),
  projectId: policyUuidSchema,
  controlRevision: policyRevisionSchema,
  desiredGeneration: policyRevisionSchema,
  enrolledGeneration: policyRevisionSchema.nullable(),
  status: recalculationStatusSchema,
  enabled: z.boolean(),
  paused: z.boolean(),
  authority: recalculationAuthoritySchema.nullable(),
  reasonCodes: z.array(recalculationReasonSchema).max(RECALCULATION_LIMITS.reasons).refine(values => new Set(values).size === values.length),
  jobId: policyUuidSchema.nullable(),
  completed: count,
  total: count,
  readyCables: count,
  blockedCables: count,
  updatedAt: timestamp,
  preferences: recalculationPreferencesSchema.nullable(),
  timeoutMilliseconds: recalculationTimeoutSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.completed > value.total || value.readyCables + value.blockedCables > value.total) context.addIssue({ code: 'custom', message: 'Progress cannot exceed the complete bounded cable scope.' });
  if (value.enrolledGeneration !== null && BigInt(value.enrolledGeneration) > BigInt(value.desiredGeneration)) context.addIssue({ code: 'custom', message: 'An enrolled generation cannot be newer than the desired generation.' });
  if ((value.preferences === null) !== (value.timeoutMilliseconds === null)) context.addIssue({ code: 'custom', message: 'Saved preferences and timeout are present together.' });
  if (value.enabled && value.preferences === null) context.addIssue({ code: 'custom', message: 'Enabled recalculation requires saved preferences.' });
  if (value.paused && !value.enabled || value.status === 'disabled' && value.enabled || value.status === 'paused' && !value.paused) context.addIssue({ code: 'custom', message: 'Durable enabled and paused state must agree with the status.' });
});

const commandBase = {
  schemaVersion: z.literal('wfc.pf.recalculation-command.v1'),
  expectedControlRevision: policyRevisionSchema,
  idempotencyKey: policyUuidSchema,
  reason: reasonText,
};
export const recalculationCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...commandBase, action: z.literal('enable'), preferences: recalculationPreferencesSchema, timeoutMilliseconds: recalculationTimeoutSchema }).strict(),
  z.object({ ...commandBase, action: z.literal('pause') }).strict(),
  z.object({ ...commandBase, action: z.literal('resume') }).strict(),
  z.object({ ...commandBase, action: z.literal('retry') }).strict(),
  z.object({ ...commandBase, action: z.literal('disable') }).strict(),
]);
export const recalculationReceiptSchema = z.object({
  schemaVersion: z.literal('wfc.pf.recalculation-command-receipt.v1'),
  duplicate: z.boolean(),
  context: recalculationContextSchema,
}).strict();
export const recalculationErrorSchema = z.object({
  schemaVersion: z.literal('wfc.pf.recalculation-error.v1'),
  code: recalculationReasonSchema,
  message: text(2048),
  outcome: z.enum(['refused', 'unknown']),
  currentControlRevision: policyRevisionSchema.nullable(),
}).strict();
export type RecalculationContext = z.infer<typeof recalculationContextSchema>;
export type RecalculationCommand = z.infer<typeof recalculationCommandSchema>;
export type RecalculationReceipt = z.infer<typeof recalculationReceiptSchema>;
export type RecalculationError = z.infer<typeof recalculationErrorSchema>;
export type RecalculationPreferences = z.infer<typeof recalculationPreferencesSchema>;
export type RecalculationStatus = z.infer<typeof recalculationStatusSchema>;
export type RecalculationReason = z.infer<typeof recalculationReasonSchema>;
export type RecalculationDomain = z.infer<typeof recalculationDomainSchema>;

export function recalculationCommandCanonicalJson(command: RecalculationCommand): string {
  return canonicalPurposeJson(recalculationCommandSchema.parse(command));
}

export const recalculationImpactChangeSchema = z.enum(['drawing-only', 'declared-length-only', 'allowances-only', 'model', 'geometry', 'routing', 'endpoints', 'gap', 'preferences', 'cables', 'engine', 'manual', 'unknown']);
export type RecalculationImpactChange = z.infer<typeof recalculationImpactChangeSchema>;
export type RecalculationImpactPlan = {
  schedule: boolean;
  scope: 'none' | 'all-project-ready';
  mode: null | 'full-route' | 'design-only-candidate';
};
/** A candidate is never authorization to reuse a route: exact server proof is still required. */
export function planRecalculationImpact(changes: readonly RecalculationImpactChange[]): RecalculationImpactPlan {
  const parsed = z.array(recalculationImpactChangeSchema).max(10_000).parse(changes);
  const engineering = parsed.filter(change => change !== 'drawing-only' && change !== 'declared-length-only');
  if (engineering.length === 0) return { schedule: false, scope: 'none', mode: null };
  return { schedule: true, scope: 'all-project-ready', mode: engineering.every(change => change === 'allowances-only') ? 'design-only-candidate' : 'full-route' };
}
