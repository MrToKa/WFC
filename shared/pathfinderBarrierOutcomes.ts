import { z } from 'zod';
import { barrierSnapshotReferenceSchema } from './pathfinderBarriers.js';
import { policyHashSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';

// Preserve the existing successful publication wire representation exactly.
export const barrierPublicationReceiptSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-publication-receipt.v1'),
  snapshot: barrierSnapshotReferenceSchema, duplicate: z.boolean() }).strict();

/** Persisted terminal refusal for one exact original command/capture/full frame.
 * These hashes are server-derived evidence, not admission or SDK attestation. */
export const barrierPublicationRefusalReceiptSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-publication-refusal.v1'),
  outcome: z.literal('not-published'), intentId: policyUuidSchema, commandSha256: policyHashSchema,
  captureSha256: policyHashSchema, frameSha256: policyHashSchema, implementationSha256: policyHashSchema,
  reasonCode: z.literal('BARRIER_GEOMETRY_REFUSED'), duplicate: z.boolean() }).strict();

// Caller hashes select an exact historical read; they never mint a receipt.
export const barrierCaptureOutcomeQuerySchema = z.object({ commandSha256: policyHashSchema,
  captureSha256: policyHashSchema, frameSha256: policyHashSchema }).strict();

/** Existing successful receipts did not retain a retrievable full-frame digest.
 * Verify their exact original intent/capture without inventing frame binding. */
export const barrierPublishedOutcomeSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-capture-outcome.v1'), outcome: z.literal('published'),
  intentId: policyUuidSchema, commandSha256: policyHashSchema, captureSha256: policyHashSchema,
  frameBinding: z.literal('not-recorded'), frameSha256: z.null(), publication: barrierPublicationReceiptSchema }).strict();

export const barrierPublicationOutcomeSchema = z.union([barrierPublicationReceiptSchema, barrierPublicationRefusalReceiptSchema]);
// Null is pending/unsettled, never affirmative evidence that nothing committed.
export const barrierCaptureOutcomeSchema = z.union([barrierPublishedOutcomeSchema, barrierPublicationRefusalReceiptSchema]).nullable();
export type BarrierPublicationReceipt = z.infer<typeof barrierPublicationReceiptSchema>;
export type BarrierPublicationRefusalReceipt = z.infer<typeof barrierPublicationRefusalReceiptSchema>;
export type BarrierPublicationOutcome = z.infer<typeof barrierPublicationOutcomeSchema>;
export type BarrierCaptureOutcomeQuery = z.infer<typeof barrierCaptureOutcomeQuerySchema>;
export type BarrierCaptureOutcome = z.infer<typeof barrierPublishedOutcomeSchema> | BarrierPublicationRefusalReceipt;
export type BarrierCaptureOutcomeResponse = z.infer<typeof barrierCaptureOutcomeSchema>;
