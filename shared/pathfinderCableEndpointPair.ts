import { z } from 'zod';
import { canonicalPurposeJson, policyHashSchema, policyRevisionSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';
import { cableEndpointCommandSchema, cableEndpointReceiptSchema, type CableEndpointCommand } from './pathfinderCableEndpoints.js';

export const CABLE_ENDPOINT_PAIR_LIMITS = Object.freeze({ controlBytes: 131072, responseBytes: 2 * 1024 * 1024 });
const contexts = z.object({ from: policyHashSchema, to: policyHashSchema }).strict();
const command = cableEndpointCommandSchema.refine((value): value is Extract<CableEndpointCommand, { schemaVersion: 'wfc.pf.cable-endpoint-command.v3' }> =>
  value.schemaVersion === 'wfc.pf.cable-endpoint-command.v3', 'A new pair save requires the explicit current policy contract.');
const entry = z.object({ end: z.enum(['from', 'to']), command }).strict();
const automaticCommand = cableEndpointCommandSchema.refine((value): value is Extract<CableEndpointCommand, { schemaVersion: 'wfc.pf.cable-endpoint-command.v4' }> =>
  value.schemaVersion === 'wfc.pf.cable-endpoint-command.v4', 'A new automatic pair save requires the explicit v4 policy contract.');
const automaticEntry = z.object({ end: z.enum(['from', 'to']), command: automaticCommand }).strict();
/** Both original contexts are frozen even when only one endpoint has a draft. */
const legacyPairCommand = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-pair-command.v1'),
  idempotencyKey: policyUuidSchema, expectedContexts: contexts, endpoints: z.array(entry).min(1).max(2),
}).strict();
const automaticPairCommand = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-pair-command.v2'),
  idempotencyKey: policyUuidSchema, expectedContexts: contexts, endpoints: z.array(automaticEntry).min(1).max(2),
}).strict();
export const cableEndpointPairCommandSchema = z.union([legacyPairCommand, automaticPairCommand]).superRefine((value, ctx) => {
  // Zod also runs outer refinements for dirty (already refused) child values.
  const expected = value.schemaVersion === 'wfc.pf.cable-endpoint-pair-command.v1' ? 'wfc.pf.cable-endpoint-command.v3' : 'wfc.pf.cable-endpoint-command.v4';
  if (!value.endpoints.length || value.endpoints.some(item => item.command.schemaVersion !== expected)) return;
  const keys = [value.idempotencyKey, ...value.endpoints.map(item => item.command.idempotencyKey)];
  if (new Set(keys).size !== keys.length || value.endpoints.length === 2 && (value.endpoints[0].end !== 'from' || value.endpoints[1].end !== 'to'))
    ctx.addIssue({ code: 'custom', message: 'The pair retains distinct keys and unique endpoints in From/To order.' });
  const first = value.endpoints[0].command;
  for (const item of value.endpoints) {
    const selected = item.command;
    if (selected.expectedContextSha256 !== value.expectedContexts[item.end]
      || selected.expectedCableWriteRevision !== first.expectedCableWriteRevision || selected.expectedRegistryRevision !== first.expectedRegistryRevision
      || canonicalPurposeJson(selected.expectedCurrent) !== canonicalPurposeJson(first.expectedCurrent)
      || canonicalPurposeJson(selected.calculation) !== canonicalPurposeJson(first.calculation)
      || canonicalPurposeJson(selected.initialFill) !== canonicalPurposeJson(first.initialFill)
      || ('automaticPairPolicy' in selected && 'automaticPairPolicy' in first
        && canonicalPurposeJson(selected.automaticPairPolicy) !== canonicalPurposeJson(first.automaticPairPolicy)))
      ctx.addIssue({ code: 'custom', message: 'All pair drafts retain the same original cable, registry, model and explicit policies.' });
  }
});
export type CableEndpointPairCommand = z.infer<typeof cableEndpointPairCommandSchema>;
export const cableEndpointPairCommandHashInput = (value: CableEndpointPairCommand) => cableEndpointPairCommandSchema.parse(value);
const disposition = { projectId: policyUuidSchema, actorId: policyUuidSchema, cableId: policyUuidSchema, idempotencyKey: policyUuidSchema,
  commandSha256: policyHashSchema, expectedCableWriteRevision: policyRevisionSchema, expectedContexts: contexts };
export const cableEndpointPairReceiptSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-pair-receipt.v1'), ...disposition,
  finalRegistryRevision: policyRevisionSchema, receipts: z.array(cableEndpointReceiptSchema).min(1).max(2), duplicate: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (!policyRevisionSchema.safeParse(value.finalRegistryRevision).success
    || value.receipts.some(receipt => !policyRevisionSchema.safeParse(receipt.binding.registryRevision).success)) return;
  if (value.receipts.length === 2 && (value.receipts[0].end !== 'from' || value.receipts[1].end !== 'to')
    || value.receipts.some(receipt => receipt.projectId !== value.projectId || receipt.actorId !== value.actorId || receipt.cableId !== value.cableId
      || receipt.expectedCableWriteRevision !== value.expectedCableWriteRevision || receipt.expectedContextSha256 !== value.expectedContexts[receipt.end]
      || BigInt(receipt.binding.registryRevision) > BigInt(value.finalRegistryRevision)))
    ctx.addIssue({ code: 'custom', message: 'A pair receipt covers its exact ordered cable endpoints and final registry.' });
});
export type CableEndpointPairReceipt = z.infer<typeof cableEndpointPairReceiptSchema>;
export const cableEndpointPairClosedSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-pair-closed.v1'), ...disposition }).strict();
export const cableEndpointPairRecoverySchema = z.discriminatedUnion('status', [
  z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-pair-recovery.v1'), status: z.literal('saved'), receipt: cableEndpointPairReceiptSchema }).strict(),
  z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-pair-recovery.v1'), status: z.literal('closed'), closure: cableEndpointPairClosedSchema }).strict(),
]);
export type CableEndpointPairRecovery = z.infer<typeof cableEndpointPairRecoverySchema>;
