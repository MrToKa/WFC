import { z } from 'zod';
import { barrierModelScopeSchema, type BarrierModelScope } from '../../../shared/pathfinderBarriers';
import { policyUuidSchema } from '../../../shared/pathfinderPurposePolicy';

export const pathfinderObstacleRequestSchema = barrierModelScopeSchema.extend({
  dbId: z.number().int().positive().max(2147483647), requestId: policyUuidSchema,
}).strict();
export type PathfinderObstacleRequest = z.infer<typeof pathfinderObstacleRequestSchema>;
const stateSchema = z.object({ pathfinderObstacle: pathfinderObstacleRequestSchema }).strict();

export function createObstacleNavigation(scope: BarrierModelScope, dbId: number) {
  const request = pathfinderObstacleRequestSchema.parse({ ...scope, dbId, requestId: crypto.randomUUID() });
  return { to: `/projects/${request.projectId}?tab=pathfinder`, state: { pathfinderObstacle: request } };
}

export function parseObstacleNavigation(value: unknown, projectId: string | null | undefined): PathfinderObstacleRequest | null {
  const parsed = stateSchema.safeParse(value);
  return parsed.success && parsed.data.pathfinderObstacle.projectId === projectId ? parsed.data.pathfinderObstacle : null;
}
