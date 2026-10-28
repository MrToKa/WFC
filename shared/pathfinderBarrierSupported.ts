import { z } from 'zod';
import { barrierAdmissionPolicySchema, barrierCalculationBindingSchema, barrierCanonicalJson, barrierCaptureCommandSchema,
  barrierRegistryCommandSchema, barrierRegistrySchema, barrierSnapshotReferenceSchema, barrierSnapshotSchema,
  barrierSnapshotHashInput, verifyBarrierSnapshot } from './pathfinderBarriers.js';
import { barrierAdmissionIntentSchema, createBarrierAdmissionIntent } from './pathfinderBarrierAdmission.js';
import { barrierRuntimeContextSchema, barrierExecutionSchema, verifyBarrierRuntimeContext } from './pathfinderBarrierRuntime.js';
import { barrierEngineIdentitySchema, verifyBarrierEngineIdentity } from './pathfinderEngineIdentity.js';
import { barrierPublicationReceiptSchema, barrierPublicationRefusalReceiptSchema, barrierPublishedOutcomeSchema } from './pathfinderBarrierOutcomes.js';
import { barrierWriteEvidenceSchema } from './pathfinderBarrierWrites.js';
import { policyHashSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';
import { MIXED_BARRIER_POLICY, mixedBarrierAdmissionPolicySchema, mixedBarrierAdmissionIntentSchema,
  mixedBarrierCalculationBindingSchema, mixedBarrierCaptureCommandSchema, mixedBarrierRegistryCommandSchema,
  mixedBarrierSnapshotSchema, mixedBarrierSnapshotReferenceSchema, mixedBarrierRegistrySchema,
  mixedBarrierRuntimeContextSchema, mixedBarrierExecutionSchema, mixedBarrierEngineIdentitySchema,
  mixedBarrierPublicationReceiptSchema, mixedBarrierSnapshotHashInput, createMixedBarrierAdmissionIntent,
  mixedBarrierWriteEvidenceSchema, verifyMixedBarrierSnapshot, verifyMixedBarrierRuntimeContext, verifyMixedBarrierEngineIdentity } from './pathfinderBarrierMixed.js';

/** Explicit supported lanes only. No old schema is widened, no command is
 * rewritten, and parsing never promotes capture observations to qualification. */
export const supportedBarrierCaptureCommandSchema = z.union([barrierCaptureCommandSchema, mixedBarrierCaptureCommandSchema]);
export const supportedBarrierRegistryCommandSchema = z.union([barrierRegistryCommandSchema, mixedBarrierRegistryCommandSchema]);
export const supportedBarrierSnapshotSchema = z.union([barrierSnapshotSchema, mixedBarrierSnapshotSchema]);
export const supportedBarrierSnapshotReferenceSchema = z.union([barrierSnapshotReferenceSchema, mixedBarrierSnapshotReferenceSchema]);
export const supportedBarrierRegistrySchema = z.union([barrierRegistrySchema, mixedBarrierRegistrySchema]);
export const supportedBarrierAdmissionPolicySchema = z.union([barrierAdmissionPolicySchema, mixedBarrierAdmissionPolicySchema]);
export const supportedBarrierAdmissionIntentSchema = z.union([barrierAdmissionIntentSchema, mixedBarrierAdmissionIntentSchema]);
export const supportedBarrierCalculationBindingSchema = z.union([barrierCalculationBindingSchema, mixedBarrierCalculationBindingSchema]);
export const supportedBarrierRuntimeContextSchema = z.union([barrierRuntimeContextSchema, mixedBarrierRuntimeContextSchema]);
export const supportedBarrierExecutionSchema = z.union([barrierExecutionSchema, mixedBarrierExecutionSchema]);
export const supportedBarrierEngineIdentitySchema = z.union([barrierEngineIdentitySchema, mixedBarrierEngineIdentitySchema]);
export const supportedBarrierWriteEvidenceSchema = z.union([barrierWriteEvidenceSchema, mixedBarrierWriteEvidenceSchema]);
export const supportedBarrierPublicationReceiptSchema = z.union([barrierPublicationReceiptSchema, mixedBarrierPublicationReceiptSchema]);
export const supportedBarrierPublicationOutcomeSchema = z.union([barrierPublicationReceiptSchema, mixedBarrierPublicationReceiptSchema, barrierPublicationRefusalReceiptSchema]);

// Match the existing legacy HTTP receipt identity syntax exactly. In particular,
// a v1 receipt contains only a v1 command, even after mixed support is installed.
const legacyIntentIdentity = { id: z.string().uuid(), snapshotId: z.string().uuid(), captureBlobId: z.string().uuid(),
  manifestBlobId: z.string().uuid(), createdBy: z.string().uuid(), loginId: z.string().uuid() };
export const barrierCaptureIntentSchema = z.object({ ...legacyIntentIdentity, command: barrierCaptureCommandSchema }).strict();
export const barrierIntentReceiptSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-intent-receipt.v1'),
  intent: barrierCaptureIntentSchema, state: z.enum(['pending', 'complete']), duplicate: z.boolean() }).strict();
const mixedIntentIdentity = { id: policyUuidSchema, snapshotId: policyUuidSchema, captureBlobId: policyUuidSchema,
  manifestBlobId: policyUuidSchema, createdBy: policyUuidSchema, loginId: policyUuidSchema };
export const mixedBarrierCaptureIntentSchema = z.object({ ...mixedIntentIdentity, command: mixedBarrierCaptureCommandSchema }).strict();
export const mixedBarrierIntentReceiptSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-intent-receipt.v2'),
  intent: mixedBarrierCaptureIntentSchema, state: z.enum(['pending', 'complete']), duplicate: z.boolean() }).strict();
export const supportedBarrierCaptureIntentSchema = z.union([barrierCaptureIntentSchema, mixedBarrierCaptureIntentSchema]);
export const supportedBarrierIntentReceiptSchema = z.union([barrierIntentReceiptSchema, mixedBarrierIntentReceiptSchema]);

/** Historical success identifies the exact command/capture and published
 * snapshot. Neither success receipt retained a retrievable full-frame digest;
 * the new lane must not manufacture one from a scope or verification hash. */
export const mixedBarrierPublishedOutcomeSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-capture-outcome.v2'), outcome: z.literal('published'),
  intentId: policyUuidSchema, commandSha256: policyHashSchema, captureSha256: policyHashSchema,
  frameBinding: z.literal('not-recorded'), frameSha256: z.null(), publication: mixedBarrierPublicationReceiptSchema }).strict();
export const supportedBarrierCaptureOutcomeSchema = z.union([barrierPublishedOutcomeSchema, mixedBarrierPublishedOutcomeSchema,
  barrierPublicationRefusalReceiptSchema]).nullable();

export type AnyBarrierCaptureCommand = z.infer<typeof supportedBarrierCaptureCommandSchema>;
export type AnyBarrierRegistryCommand = z.infer<typeof supportedBarrierRegistryCommandSchema>;
export type AnyBarrierSnapshot = z.infer<typeof supportedBarrierSnapshotSchema>;
export type AnyBarrierSnapshotReference = z.infer<typeof supportedBarrierSnapshotReferenceSchema>;
export type AnyBarrierRegistry = z.infer<typeof supportedBarrierRegistrySchema>;
export type AnyBarrierAdmissionPolicy = z.infer<typeof supportedBarrierAdmissionPolicySchema>;
export type AnyBarrierAdmissionIntent = z.infer<typeof supportedBarrierAdmissionIntentSchema>;
export type AnyBarrierCalculationBinding = z.infer<typeof supportedBarrierCalculationBindingSchema>;
export type AnyBarrierRuntimeContext = z.infer<typeof supportedBarrierRuntimeContextSchema>;
export type AnyBarrierExecution = z.infer<typeof supportedBarrierExecutionSchema>;
export type AnyBarrierEngineIdentity = z.infer<typeof supportedBarrierEngineIdentitySchema>;
export type AnyBarrierWriteEvidence = z.infer<typeof supportedBarrierWriteEvidenceSchema>;
export type AnyBarrierPublicationReceipt = z.infer<typeof supportedBarrierPublicationReceiptSchema>;
export type AnyBarrierPublicationOutcome = z.infer<typeof supportedBarrierPublicationOutcomeSchema>;
export type AnyBarrierCaptureIntent = z.infer<typeof supportedBarrierCaptureIntentSchema>;
export type AnyBarrierIntentReceipt = z.infer<typeof supportedBarrierIntentReceiptSchema>;
export type AnyBarrierCaptureOutcomeResponse = z.infer<typeof supportedBarrierCaptureOutcomeSchema>;
export type AnyBarrierCaptureOutcome = NonNullable<AnyBarrierCaptureOutcomeResponse>;
export type MixedBarrierCaptureIntent = z.infer<typeof mixedBarrierCaptureIntentSchema>;
export type MixedBarrierIntentReceipt = z.infer<typeof mixedBarrierIntentReceiptSchema>;
export type MixedBarrierPublishedOutcome = z.infer<typeof mixedBarrierPublishedOutcomeSchema>;

export function supportedBarrierSnapshotReference(value: AnyBarrierSnapshot): AnyBarrierSnapshotReference {
  const snapshot = supportedBarrierSnapshotSchema.parse(value);
  const common = { snapshotId: snapshot.snapshotId, scope: snapshot.scope, registryRevision: snapshot.registryRevision,
    contentSha256: snapshot.contentSha256, mode: snapshot.geometry.mode };
  return snapshot.schemaVersion === 'wfc.pf.barrier-snapshot.v2'
    ? mixedBarrierSnapshotReferenceSchema.parse({ ...common, schemaVersion: 'wfc.pf.barrier-snapshot-reference.v2', geometryPolicy: MIXED_BARRIER_POLICY })
    : barrierSnapshotReferenceSchema.parse(common);
}
export function supportedBarrierSnapshotHashInput(value: AnyBarrierSnapshot): unknown {
  const snapshot = supportedBarrierSnapshotSchema.parse(value);
  return snapshot.schemaVersion === 'wfc.pf.barrier-snapshot.v2' ? mixedBarrierSnapshotHashInput(snapshot) : barrierSnapshotHashInput(snapshot);
}
export function verifySupportedBarrierSnapshot(value: unknown, hashCanonical: (value: string) => string): value is AnyBarrierSnapshot {
  const snapshot = supportedBarrierSnapshotSchema.safeParse(value);
  return snapshot.success && (snapshot.data.schemaVersion === 'wfc.pf.barrier-snapshot.v2'
    ? verifyMixedBarrierSnapshot(snapshot.data, hashCanonical) : verifyBarrierSnapshot(snapshot.data, hashCanonical));
}
export function createSupportedBarrierAdmissionIntent(registry: unknown, drillThroughWalls: boolean): AnyBarrierAdmissionIntent | null {
  const current = supportedBarrierRegistrySchema.safeParse(registry);
  if (!current.success) return null;
  return current.data.schemaVersion === 'wfc.pf.barrier-registry.v2'
    ? createMixedBarrierAdmissionIntent(current.data, drillThroughWalls) : createBarrierAdmissionIntent(current.data, drillThroughWalls);
}
export function sameSupportedBarrierAdmissionIntent(left: unknown, right: unknown): boolean {
  if (left === undefined && right === undefined) return true;
  const first = supportedBarrierAdmissionIntentSchema.safeParse(left), last = supportedBarrierAdmissionIntentSchema.safeParse(right);
  return first.success && last.success && barrierCanonicalJson(first.data) === barrierCanonicalJson(last.data);
}
export function verifySupportedBarrierRuntimeContext(value: unknown, hashCanonical: (value: string) => string): value is AnyBarrierRuntimeContext {
  const context = supportedBarrierRuntimeContextSchema.safeParse(value);
  return context.success && (context.data.schemaVersion === 'wfc.pf.barrier-runtime.v2'
    ? verifyMixedBarrierRuntimeContext(context.data, hashCanonical) : verifyBarrierRuntimeContext(context.data, hashCanonical));
}
export function verifySupportedBarrierEngineIdentity(value: unknown, hashCanonical: (value: string) => string): value is AnyBarrierEngineIdentity {
  const identity = supportedBarrierEngineIdentitySchema.safeParse(value);
  return identity.success && (identity.data.schemaVersion === 'wfc.pf.engine-identity.v3'
    ? verifyMixedBarrierEngineIdentity(identity.data, hashCanonical) : verifyBarrierEngineIdentity(identity.data, hashCanonical));
}
