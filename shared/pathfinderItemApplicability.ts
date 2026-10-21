import { z } from 'zod';
import { policyHashSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';

/** Display proof only. Server write paths revalidate the exact item and authority. */
export const sealedCableItemApplicabilityV1Schema = z.object({
  schemaVersion: z.literal('wfc.pf.sealed-cable-applicability.v1'),
  dependencyVersion: z.literal('pathfinder.dependencies.v7'),
  projectId: policyUuidSchema, jobId: policyUuidSchema, cableId: policyUuidSchema,
  proposalId: policyUuidSchema, dependencyHash: policyHashSchema,
  scope: z.literal('sealed-cable-item'),
}).strict();
export const sealedCableItemApplicabilityV2Schema = z.object({
  schemaVersion: z.literal('wfc.pf.sealed-cable-applicability.v2'),
  dependencyVersion: z.literal('pathfinder.dependencies.v8'),
  projectId: policyUuidSchema, jobId: policyUuidSchema, cableId: policyUuidSchema,
  proposalId: policyUuidSchema, dependencyHash: policyHashSchema,
  scope: z.literal('sealed-cable-item'),
}).strict();
export const sealedCableItemApplicabilitySchema = z.union([sealedCableItemApplicabilityV1Schema, sealedCableItemApplicabilityV2Schema]);
export type SealedCableItemApplicabilityV1 = z.infer<typeof sealedCableItemApplicabilityV1Schema>;
export type SealedCableItemApplicabilityV2 = z.infer<typeof sealedCableItemApplicabilityV2Schema>;
export type SealedCableItemApplicability = z.infer<typeof sealedCableItemApplicabilitySchema>;
