import { z } from 'zod';
import { BARRIER_LIMITS, barrierSelectedParentSchema } from './pathfinderBarriers.js';
import { policyUuidSchema } from './pathfinderPurposePolicy.js';

const ids = z.array(policyUuidSchema).max(BARRIER_LIMITS.selectedParents).refine(values => new Set(values).size === values.length);
/** Observations of the exact final polyline and rejected candidates. This
 * informational report confers no clearance proof or write authority. */
export const obstacleReportSchema = z.object({
  status: z.enum(['complete', 'partial', 'unavailable']),
  blockingAttribution: z.enum(['exact', 'component-membership']).optional(),
  crossedParentSelectionIds: ids, blockingParentSelectionIds: ids,
  checkedSegments: z.number().int().nonnegative().max(BARRIER_LIMITS.routeSegments),
  totalSegments: z.number().int().nonnegative().max(BARRIER_LIMITS.routeSegments),
  reasonCode: z.string().min(1).max(96).regex(/^[A-Z][A-Z0-9_]*$/),
  selectedParents: z.array(barrierSelectedParentSchema).max(BARRIER_LIMITS.selectedParents),
}).strict().superRefine((value, context) => {
  const parents = new Set(value.selectedParents.map(parent => parent.selectionId));
  if (parents.size !== value.selectedParents.length || new Set(value.selectedParents.map(parent => parent.dbId)).size !== value.selectedParents.length
    || [...value.crossedParentSelectionIds, ...value.blockingParentSelectionIds].some(id => !parents.has(id)))
    context.addIssue({ code: 'custom', message: 'Every observed obstacle retains its unique captured parent identity.' });
  if (value.checkedSegments > value.totalSegments || value.status === 'complete' && value.checkedSegments !== value.totalSegments)
    context.addIssue({ code: 'custom', message: 'Complete observations close over every final route segment.' });
});
export type ObstacleReport = z.infer<typeof obstacleReportSchema>;
