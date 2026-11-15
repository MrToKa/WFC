import { z } from 'zod';
import { preparationObjectIdSchema, preparationScopeSchema, preparationTrayCandidateGroupSchema, preparationTrayCandidateGroupsValid } from './pathfinderPreparation.js';
import { policyRevisionSchema, policyUuidSchema, policyHashSchema } from './pathfinderPurposePolicy.js';

const roots = z.array(preparationObjectIdSchema).max(100000).refine(values => new Set(values).size === values.length);
const match = z.object({ projectTrayId: policyUuidSchema, rootObjectIds: roots }).strict();
const inputMatch=match.extend({candidateRootGroups:z.array(preparationTrayCandidateGroupSchema).max(100000).optional()}).strict()
  .refine(value=>preparationTrayCandidateGroupsValid(value.rootObjectIds,value.candidateRootGroups));
export const preparationTrayMatchesWriteSchema = z.object({
  schemaVersion: z.literal('wfc.pf.preparation-tray-matches.write.v1'),
  expected: preparationScopeSchema, idempotencyKey: policyUuidSchema,
  matchingPolicyVersion: z.literal('wfc.pf.project-exact-candidates.v3'), complete: z.literal(true),
  matches: z.array(inputMatch).max(100000).refine(values => new Set(values.map(value => value.projectTrayId)).size === values.length),
}).strict();
export const preparationTrayMatchResultSchema = match.extend({ status: z.enum(['assigned', 'kept', 'missing', 'ambiguous']) }).strict()
  .refine(value => value.status !== 'assigned' || value.rootObjectIds.length > 0)
  .refine(value => value.status !== 'missing' || value.rootObjectIds.length === 0);
const count = z.number().int().nonnegative().max(100000);
export const preparationTrayMatchesReceiptSchema = z.object({
  schemaVersion: z.literal('wfc.pf.preparation-tray-matches-receipt.v1'), resolutionRevision: policyRevisionSchema,
  idempotencyKey:policyUuidSchema,commandSha256:policyHashSchema,
  results: z.array(preparationTrayMatchResultSchema).max(100000).refine(values => new Set(values.map(value => value.projectTrayId)).size === values.length),
  counts: z.object({ assigned: count, kept: count, missing: count, ambiguous: count }).strict(), duplicate: z.boolean(),
}).strict().refine(value => (['assigned', 'kept', 'missing', 'ambiguous'] as const)
  .every(status => value.counts[status] === value.results.filter(result => result.status === status).length));
export type PreparationTrayMatchesWrite = z.infer<typeof preparationTrayMatchesWriteSchema>;
export type PreparationTrayMatchesReceipt = z.infer<typeof preparationTrayMatchesReceiptSchema>;
