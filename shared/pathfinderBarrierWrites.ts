import { z } from 'zod';
import { policyHashSchema as digest, policyRevisionSchema as revision, policyUuidSchema as uuid } from './pathfinderPurposePolicy.js';

/** Small immutable receipt reference. Referenced dependencies/result retain the
 * actual context, meshes and ordered checks; these digests do not certify them. */
export const barrierWriteEvidenceSchema = z.object({
  schemaVersion:z.literal('wfc.pf.barrier-write-evidence.v1'),
  dependencyVersion:z.literal('pathfinder.dependencies.v8'),responseVersion:z.literal('pathfinder.model.response.v3'),
  projectId:uuid,cableId:uuid,dependencySha256:digest,engineIdentitySha256:digest,
  engineResultSha256:digest,contextSha256:digest,executionSha256:digest,routeSha256:digest,
  policySha256:digest,profileSha256:digest,registryRevision:revision,
  snapshotId:uuid.nullable(),snapshotSha256:digest.nullable(),drillThroughWalls:z.boolean(),
  status:z.enum(['clear','bypassed','no-barriers-declared']),
}).strict().superRefine((value,context)=>{
  if((value.snapshotId===null)!==(value.snapshotSha256===null))context.addIssue({code:'custom',message:'An exact snapshot reference is paired.'});
  if((value.status==='bypassed')!==value.drillThroughWalls)context.addIssue({code:'custom',message:'Only explicit drilling may carry a bypassed result.'});
  if(value.status!=='bypassed'&&value.snapshotId===null)context.addIssue({code:'custom',message:'Protected or explicitly empty writes retain a publication.'});
});
export type BarrierWriteEvidence=z.infer<typeof barrierWriteEvidenceSchema>;
