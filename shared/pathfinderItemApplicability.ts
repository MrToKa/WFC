import { z } from 'zod';
import { policyHashSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';

/** Display proof only. Server write paths revalidate the exact item and authority. */
export const sealedCableItemApplicabilitySchema = z.object({
  schemaVersion: z.literal('wfc.pf.sealed-cable-applicability.v1'),
  dependencyVersion: z.literal('pathfinder.dependencies.v7'),
  projectId: policyUuidSchema, jobId: policyUuidSchema, cableId: policyUuidSchema,
  proposalId: policyUuidSchema, dependencyHash: policyHashSchema,
  scope: z.literal('sealed-cable-item'),
}).strict();
export type SealedCableItemApplicability = z.infer<typeof sealedCableItemApplicabilitySchema>;
