import { z } from 'zod';
import { canonicalPurposeJson, policyRevisionSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';
import { supportedBarrierAdmissionIntentSchema as barrierAdmissionIntentSchema } from './pathfinderBarrierSupported.js';
import { automaticGenerationAuthorizationSchema, automaticPairPolicySchema } from './pathfinderAutomaticPair.js';

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
export const recalculationDomainSchema = z.enum(['model', 'geometry', 'routing', 'endpoints', 'settings', 'cables', 'engine', 'manual', 'preferences', 'barriers']);
export const recalculationStatusSchema = z.enum(['disabled', 'awaiting_authority', 'paused', 'debouncing', 'collecting', 'queued', 'calculating', 'complete', 'blocked', 'superseded', 'failed']);
export const recalculationPreferencesSchema = z.object({
  secondaryDistanceMeters: z.number().finite().min(0).max(1_000_000),
  preferVerticalApproach: z.boolean(),
  // Absence retains the historical request/hash. Fresh barrier-aware requests
  // must submit the complete strict intent; never infer it from UI defaults.
  barrierRouting: barrierAdmissionIntentSchema.optional(),
}).strict();
/** A finite background grant must never inherit permission to drill from a
 * prior manual calculation. Scoped administrator calculations use the general
 * preference schema above and may carry an explicit true choice. */
export const backgroundRecalculationPreferencesSchema = recalculationPreferencesSchema.refine(
  value => value.barrierRouting?.drillThroughWalls !== true,
  { message: 'Background calculation cannot authorize drilling through barriers.' },
);
export const recalculationTimeoutSchema = z.number().int().min(100).max(120_000);
export const recalculationAuthoritySchema = z.object({
  kind: z.literal('current-login'),
  actorId: policyUuidSchema,
  expiresAt: timestamp,
  /** Identity comparison for this reader; never a substitute for server authorization. */
  currentLogin: z.boolean(),
}).strict();
/** Read-only accounting for one exact current project job. Eligibility, native
 * outcomes and saved Cable list values are intentionally different counters. */
export const recalculationProgressSchema = z.object({
  schemaVersion: z.literal('wfc.pf.recalculation-progress.v1'),
  jobId: policyUuidSchema,
  generation: policyRevisionSchema,
  total: count,
  eligible: count,
  blockedInputs: count,
  waiting: count,
  running: count,
  processed: count,
  calculated: count,
  saved: count,
  saving: count,
  reviewRequired: count,
  refused: count,
  authorityExpired: count,
  stale: count,
  notScheduledForSave: count,
  calculationFailed: count,
}).strict().superRefine((value, context) => {
  if (value.eligible + value.blockedInputs !== value.total
    || value.waiting + value.running + value.processed !== value.eligible
    || value.calculated + value.calculationFailed !== value.processed
    || value.saved + value.saving + value.reviewRequired + value.refused + value.authorityExpired + value.stale + value.notScheduledForSave !== value.calculated)
    context.addIssue({ code: 'custom', message: 'Calculation progress must retain its complete input, outcome and output partitions.' });
});
export type RecalculationProgress = z.infer<typeof recalculationProgressSchema>;
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
  automaticPairPolicy: automaticPairPolicySchema.optional(),
  progress: recalculationProgressSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.completed > value.total || value.readyCables + value.blockedCables > value.total) context.addIssue({ code: 'custom', message: 'Progress cannot exceed the complete bounded cable scope.' });
  if (value.enrolledGeneration !== null && BigInt(value.enrolledGeneration) > BigInt(value.desiredGeneration)) context.addIssue({ code: 'custom', message: 'An enrolled generation cannot be newer than the desired generation.' });
  if ((value.preferences === null) !== (value.timeoutMilliseconds === null)) context.addIssue({ code: 'custom', message: 'Saved preferences and timeout are present together.' });
  if (value.enabled && value.preferences === null) context.addIssue({ code: 'custom', message: 'Enabled recalculation requires saved preferences.' });
  if (value.paused && !value.enabled || value.status === 'disabled' && value.enabled || value.status === 'paused' && !value.paused) context.addIssue({ code: 'custom', message: 'Durable enabled and paused state must agree with the status.' });
  if (value.progress && (value.progress.jobId !== value.jobId || value.progress.generation !== value.desiredGeneration
    || value.enrolledGeneration !== value.desiredGeneration || value.progress.total !== value.total
    || value.progress.eligible !== value.readyCables || value.progress.blockedInputs !== value.blockedCables
    || value.progress.processed + value.progress.blockedInputs !== value.completed))
    context.addIssue({ code: 'custom', message: 'Progress belongs only to the exact current enrolled job and its coherent input and completion counts.' });
});

const commandBase = {
  schemaVersion: z.literal('wfc.pf.recalculation-command.v1'),
  expectedControlRevision: policyRevisionSchema,
  idempotencyKey: policyUuidSchema,
  reason: reasonText,
};
const historicalRecalculationCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...commandBase, action: z.literal('enable'), preferences: backgroundRecalculationPreferencesSchema, timeoutMilliseconds: recalculationTimeoutSchema }).strict(),
  z.object({ ...commandBase, action: z.literal('pause') }).strict(),
  z.object({ ...commandBase, action: z.literal('resume') }).strict(),
  z.object({ ...commandBase, action: z.literal('retry') }).strict(),
  z.object({ ...commandBase, action: z.literal('disable') }).strict(),
]);
export const automaticOutputEnableCommandSchema = z.object({ ...commandBase, schemaVersion: z.literal('wfc.pf.recalculation-command.v2'),
  action: z.literal('enable'), preferences: backgroundRecalculationPreferencesSchema, timeoutMilliseconds: recalculationTimeoutSchema,
  automaticPairPolicy: automaticPairPolicySchema }).strict();
/** Continue a previously enabled output policy; this never creates or renews its authority. */
export const automaticOutputContinuationCommandSchema = z.object({ ...commandBase, schemaVersion: z.literal('wfc.pf.recalculation-command.v2'),
  action: z.enum(['resume', 'retry']), automaticPairPolicy: automaticPairPolicySchema }).strict();
export const recalculationCommandSchema = z.union([historicalRecalculationCommandSchema, automaticOutputEnableCommandSchema, automaticOutputContinuationCommandSchema]);
export const recalculationReceiptSchema = z.object({
  schemaVersion: z.literal('wfc.pf.recalculation-command-receipt.v1'),
  duplicate: z.boolean(),
  context: recalculationContextSchema,
  automaticPairAuthorization: automaticGenerationAuthorizationSchema.optional(),
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
