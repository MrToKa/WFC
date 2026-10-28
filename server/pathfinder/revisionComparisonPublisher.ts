import { createHash } from 'node:crypto';
import { z } from 'zod';
import { policyHashSchema as hash,policyUuidSchema as uuid,policyRevisionSchema as revision,canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { preparationAggregateSchema,preparationPlanSchema } from '../../shared/pathfinderPreparation.js';
import { geometryTraceManifestSchema } from '../../shared/pathfinderGeometryTrace.js';
import { REVISION_COMPARISON_POLICY,revisionComparisonInputSchema,revisionComparisonRoutingSchema } from '../../shared/pathfinderRevisionComparison.js';

export const revisionComparisonHash=(value:unknown):string=>createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
export const REVISION_COMPARISON_PROFILE=Object.freeze({frozenBytes:1024*1024,manifestBytes:256*1024,inputTotalBytes:32*1024**2,resultBytes:32*1024**2,pageBytes:1024*1024,pageRows:50,pages:4096,milliseconds:120000,leaseMilliseconds:150000});
export const revisionBlobSchema=z.object({payloadRef:uuid,sha256:hash,bytes:z.number().int().positive().max(256*1024**2)}).strict();
export const revisionComparisonFrozenSideSchema=z.object({aggregate:preparationAggregateSchema,plan:preparationPlanSchema,trace:geometryTraceManifestSchema,input:revisionComparisonInputSchema}).strict();
export const revisionComparisonFrozenSchema=z.object({id:uuid,projectId:uuid,source:revisionComparisonFrozenSideSchema,target:revisionComparisonFrozenSideSchema,comparisonRevision:revision,expectedComparisonRevision:revision,routingAtAdmission:revisionComparisonRoutingSchema,selectionAtAdmission:z.object({modelVersionId:uuid.nullable(),revision}).strict(),policyVersion:z.literal(REVISION_COMPARISON_POLICY),frozenBlobId:uuid,rowsBlobId:uuid,createdBy:uuid,createdAt:z.string().datetime(),reason:z.string().min(1).max(2048),decisionSetSha256:hash}).strict();
export type RevisionComparisonFrozen=z.infer<typeof revisionComparisonFrozenSchema>;
export function revisionDerivedId(comparisonId:string,part:string):string{const h=revisionComparisonHash({comparisonId,part});return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
