import { barrierCanonicalJson } from '../../shared/pathfinderBarriers.js';
import { barrierRouteHashInput, verifyBarrierExecutionRoute, verifyBarrierRuntimeContext, type BarrierRuntimeContext } from '../../shared/pathfinderBarrierRuntime.js';
import { constrainedDirectSecondaryRouteIssue, verifyBarrierCheckProofV2 } from '../../shared/pathfinderBarrierDecisions.js';
import type { EngineResponse } from './jobContracts.js';
import { barrierBytesHash } from './barrierStorage.js';
import { PathFinderError } from './errors.js';

const digest = (text: string) => barrierBytesHash(Buffer.from(text));
const fail = (): never => { throw new PathFinderError('ENGINE_BARRIER_STRATEGY_INVALID',502,
  'The result does not retain the exact admitted barrier scope and computation. Calculate a current route.'); };
/** The pinned C# AppendPoint omits points at binary64 zero distance, including
 * squared-distance underflow. No epsilon or alternative distance metric. */
const sameEndpoint = (actual: [number,number,number], expected: [number,number,number]) => {
  const dx=actual[0]-expected[0],dy=actual[1]-expected[1],dz=actual[2]-expected[2];
  return dx*dx+dy*dy+dz*dz===0;
};

/** Explicit version pair and exact input binding. A legacy error/result cannot
 * silently become an obstacle-aware result. No JavaScript collision/length math. */
export function requireBarrierEngineStrategy(response: EngineResponse, input: { context: BarrierRuntimeContext; category: string | null;
  fromPoint: [number,number,number]; toPoint: [number,number,number]; reverse?: boolean }): void {
  if (response.schemaVersion !== 'pathfinder.model.response.v3' || !verifyBarrierRuntimeContext(input.context,digest)
    || barrierCanonicalJson(response.barriers.context) !== barrierCanonicalJson(input.context)) return fail();
  // Qualification can refuse the geometry before category/candidate evaluation.
  // Keep that honest typed failure; it is never a successful physical proof.
  if (response.status === 'no_path' && !response.route?.success
    && response.barriers.diagnostics.status === 'unavailable' && !response.barriers.proof) return;
  if (!['calculated','no_path'].includes(response.status) && !response.route?.success) return;
  const expectedCategory = input.category === 'Instrumentation' ? 'Control' : input.category;
  if (response.effectiveCategory !== expectedCategory) return fail();
  const from = input.reverse ? input.toPoint : input.fromPoint, to = input.reverse ? input.fromPoint : input.toPoint;
  if(response.route?.success){
    const points=response.route.pathPoints;
    if(!points.length||!sameEndpoint([points[0].x,points[0].y,points[0].z],from)
      ||!sameEndpoint([points.at(-1)!.x,points.at(-1)!.y,points.at(-1)!.z],to))return fail();
  }
  const decision = response.barriers.directSecondary;
  if (['LV','Control'].includes(expectedCategory ?? '') && !decision) return fail();
  if (decision) {
    if (!decision.distanceDecision.fromPoint.every((value,at) => value === from[at])
      || !decision.distanceDecision.toPoint.every((value,at) => value === to[at])) return fail();
    const points = decision.distanceDecision.distanceMeters === 0 ? [from] : [from,to];
    const directHash = digest(barrierCanonicalJson(barrierRouteHashInput(points)));
    if (decision.directRouteSha256 !== directHash || decision.directCheck && !verifyBarrierCheckProofV2(decision.directCheck,
      { binding: input.context.binding, routeSha256: directHash, routePointCount: points.length,
        computationalMemberships: response.barriers.qualification?.computationalMemberships ?? [] }, digest)) return fail();
    if (response.route && constrainedDirectSecondaryRouteIssue(decision,{...response.route,
      points:response.route.pathPoints.map(point => [point.x,point.y,point.z])})) return fail();
  }
  if (response.route?.success && !verifyBarrierExecutionRoute(response.barriers,{ context: input.context,
    points: response.route.pathPoints.map(point => [point.x,point.y,point.z]) },digest)) return fail();
  if (response.status === 'calculated' && !response.route?.success) return fail();
}
