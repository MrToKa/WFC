import { barrierCanonicalJson } from '../../shared/pathfinderBarriers.js';
import { barrierRouteHashInput, verifyBarrierExecutionRoute } from '../../shared/pathfinderBarrierRuntime.js';
import { supportedBarrierExecutionSchema, verifySupportedBarrierRuntimeContext, type AnyBarrierRuntimeContext as BarrierRuntimeContext } from '../../shared/pathfinderBarrierSupported.js';
import { mixedBarrierVerifierEvidenceSchema, verifyMixedBarrierCheckProof, verifyMixedBarrierExecutionRoute,
  type MixedBarrierVerifierEvidence } from '../../shared/pathfinderBarrierMixed.js';
import { constrainedDirectSecondaryRouteIssue, verifyBarrierCheckProofV2 } from '../../shared/pathfinderBarrierDecisions.js';
import { directSecondaryRouteIssue } from '../../shared/pathfinderDirectSecondary.js';
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
export function requireBarrierEngineStrategy(response: EngineResponse, input: { context: BarrierRuntimeContext; qualification?: MixedBarrierVerifierEvidence | null; category: string | null;
  fromPoint: [number,number,number]; toPoint: [number,number,number]; reverse?: boolean }): void {
  if (response.schemaVersion !== 'pathfinder.model.response.v3' || !verifySupportedBarrierRuntimeContext(input.context,digest)) return fail();
  const parsed = supportedBarrierExecutionSchema.safeParse(response.barriers);
  if (!parsed.success || barrierCanonicalJson(parsed.data.context) !== barrierCanonicalJson(input.context)) return fail();
  const execution = parsed.data;
  let trustedQualification: MixedBarrierVerifierEvidence | null = null;
  if (input.context.schemaVersion === 'wfc.pf.barrier-runtime.v2') {
    if (execution.schemaVersion !== 'wfc.pf.barrier-execution.v2' || !Object.prototype.hasOwnProperty.call(input,'qualification')) return fail();
    const evidence = mixedBarrierVerifierEvidenceSchema.nullable().safeParse(input.qualification);
    if (!evidence.success) return fail();
    trustedQualification = evidence.data;
    const physical = !input.context.binding.policy.drillThroughWalls && input.context.binding.snapshot?.mode === 'mixed-mesh-set';
    if (physical !== (trustedQualification !== null)) return fail();
    if (trustedQualification && (barrierCanonicalJson(trustedQualification.scope) !== barrierCanonicalJson(input.context.binding.scope)
      || trustedQualification.captureId !== input.context.storage?.intentId || !input.context.storage?.capture
      || trustedQualification.numericToleranceMetres < input.context.profile.qualification.numericToleranceMetres)) return fail();
    if (execution.qualification && (execution.qualification.captureSha256 !== input.context.storage?.capture?.sha256
      || barrierCanonicalJson(execution.qualification.evidence) !== barrierCanonicalJson(trustedQualification))) return fail();
    const physicalStatuses = ['clear-selected-scope','blocked','indeterminate'];
    if ((physicalStatuses.includes(execution.proof?.status ?? '') || physicalStatuses.includes(execution.directSecondary?.directCheck?.status ?? ''))
      && !execution.qualification) return fail();
  } else if (execution.schemaVersion !== 'wfc.pf.barrier-execution.v1' || Object.prototype.hasOwnProperty.call(input,'qualification')) return fail();
  // Qualification can refuse the geometry before category/candidate evaluation.
  // Keep that honest typed failure; it is never a successful physical proof.
  if (response.status === 'no_path' && !response.route?.success
    && execution.diagnostics.status === 'unavailable' && !execution.proof) return;
  if (!['calculated','no_path'].includes(response.status) && !response.route?.success) return;
  const expectedCategory = input.category === 'Instrumentation' ? 'Control' : input.category;
  if (response.effectiveCategory !== expectedCategory) return fail();
  const from = input.reverse ? input.toPoint : input.fromPoint, to = input.reverse ? input.fromPoint : input.toPoint;
  if(response.route?.success){
    const points=response.route.pathPoints;
    if(!points.length||!sameEndpoint([points[0].x,points[0].y,points[0].z],from)
      ||!sameEndpoint([points.at(-1)!.x,points.at(-1)!.y,points.at(-1)!.z],to))return fail();
  }
  const decision = execution.directSecondary;
  if (['LV','Control'].includes(expectedCategory ?? '') && !decision) return fail();
  if (decision) {
    if (!decision.distanceDecision.fromPoint.every((value,at) => value === from[at])
      || !decision.distanceDecision.toPoint.every((value,at) => value === to[at])) return fail();
    const points = decision.distanceDecision.distanceMeters === 0 ? [from] : [from,to];
    const directHash = digest(barrierCanonicalJson(barrierRouteHashInput(points)));
    if (decision.directRouteSha256 !== directHash) return fail();
    const route = response.route ? {...response.route,points:response.route.pathPoints.map((point):[number,number,number] => [point.x,point.y,point.z])} : null;
    if (input.context.schemaVersion === 'wfc.pf.barrier-runtime.v2') {
      if (execution.schemaVersion !== 'wfc.pf.barrier-execution.v2' || execution.directSecondary?.schemaVersion !== 'wfc.pf.mixed-constrained-direct-secondary.v2') return fail();
      const current = execution.directSecondary;
      if (current.directCheck && !verifyMixedBarrierCheckProof(current.directCheck,{binding:input.context.binding,routeSha256:directHash,
        routePointCount:points.length,componentMemberships:trustedQualification?.componentMemberships ?? []},digest)) return fail();
      if (route && current.mode === 'direct-secondary' && directSecondaryRouteIssue(current.distanceDecision,route)) return fail();
    } else {
      if (execution.schemaVersion !== 'wfc.pf.barrier-execution.v1' || !execution.directSecondary) return fail();
      const current = execution.directSecondary;
      if (current.directCheck && !verifyBarrierCheckProofV2(current.directCheck,{binding:input.context.binding,routeSha256:directHash,
        routePointCount:points.length,computationalMemberships:execution.qualification?.computationalMemberships ?? []},digest)) return fail();
      if (route && constrainedDirectSecondaryRouteIssue(current,route)) return fail();
    }
  }
  if (response.route?.success) {
    const points = response.route.pathPoints.map(point => [point.x,point.y,point.z]);
    if (input.context.schemaVersion === 'wfc.pf.barrier-runtime.v2') {
      if (!verifyMixedBarrierExecutionRoute(execution,{context:input.context,points,qualificationEvidence:trustedQualification,
        componentMemberships:trustedQualification?.componentMemberships ?? []},digest)) return fail();
    } else if (!verifyBarrierExecutionRoute(execution,{context:input.context,points},digest)) return fail();
  }
  if (response.status === 'calculated' && !response.route?.success) return fail();
}
