import { z } from 'zod';
import { BARRIER_LIMITS, barrierModelScopeSchema } from './pathfinderBarriers.js';
import { policyRevisionSchema, policyUuidSchema } from './pathfinderPurposePolicy.js';

export const cableObstacleLinkSchema = z.object({
  selectionId: policyUuidSchema, dbId: z.number().int().nonnegative().max(2147483647),
  name: z.string().min(1).max(2048), kind: z.enum(['wall', 'partition', 'floor', 'ceiling', 'obstacle']),
}).strict();
export const cableObstacleLinksSchema = z.object({
  schemaVersion: z.literal('wfc.pf.cable-obstacle-links.v1'),
  projectId: policyUuidSchema, cableId: policyUuidSchema, cableWriteRevision: policyRevisionSchema,
  remarks: z.string().max(32767).nullable(), status: z.enum(['recorded', 'unverified', 'none']),
  source: z.object({ kind: z.enum(['apply-receipt', 'manual-result']), id: policyUuidSchema, proposalId: policyUuidSchema.optional() }).strict().nullable(),
  scope: barrierModelScopeSchema.nullable(), obstacles: z.array(cableObstacleLinkSchema).max(BARRIER_LIMITS.selectedParents),
}).strict().superRefine((value, context) => {
  if (value.status === 'recorded' ? !value.source || !value.scope || !value.obstacles.length || value.scope.projectId !== value.projectId
    : value.source !== null || value.scope !== null || value.obstacles.length !== 0)
    context.addIssue({ code: 'custom', message: 'Only verified saved reports supply recorded obstacle identities and scope.' });
  if (new Set(value.obstacles.map(row => row.selectionId)).size !== value.obstacles.length || new Set(value.obstacles.map(row => row.dbId)).size !== value.obstacles.length)
    context.addIssue({ code: 'custom', message: 'Recorded obstacle identities must be unique.' });
});
export type CableObstacleLink = z.infer<typeof cableObstacleLinkSchema>;
export type CableObstacleLinks = z.infer<typeof cableObstacleLinksSchema>;
