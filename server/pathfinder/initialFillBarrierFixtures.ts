import {createHash} from 'node:crypto';
import {barrierCanonicalJson} from '../../shared/pathfinderBarriers.js';
import {barrierRouteHashInput,createBarrierRuntimePolicy} from '../../shared/pathfinderBarrierRuntime.js';
import {DIRECT_SECONDARY_POLICY} from '../../shared/pathfinderDirectSecondary.js';
import {syntheticBarrierEngineIdentity,syntheticDrillingRuntime} from './calculationFixtures.js';
import {engineResponseSchema,type BarrierDependencySnapshot,type EngineResponse,type ScopedDependencySnapshot} from './jobContracts.js';

/** Synthetic unit/SQL fixture only. Never imported by a production writer or
 * used as evidence of actual geometry, capture, process or engineering review. */
export function syntheticInitialFillBarrierInputs(legacy:ScopedDependencySnapshot,response:EngineResponse):{
  dependencies:BarrierDependencySnapshot;result:EngineResponse&{calculationMode:'calculate'};
}{
  if(!response.route?.success||response.route.pathPoints.length!==2)throw new Error('This explicit synthetic fixture requires a two-point tray route.');
  const digest=(value:unknown)=>createHash('sha256').update(barrierCanonicalJson(value)).digest('hex');
  const scope={projectId:legacy.projectId,modelVersionId:legacy.model.id,selectionRevision:legacy.model.selectionRevision,contentFingerprint:legacy.model.contentFingerprint,
    captureFrameId:legacy.preparation.captureFrameId,captureFrameSha256:'8'.repeat(64),coordinateFrame:'canonical-world-metres' as const};
  const context=syntheticDrillingRuntime(scope),policy=createBarrierRuntimePolicy(false);
  context.binding={scope,registryRevision:'1',snapshot:{snapshotId:'bf710000-0000-4000-8000-000000000001',scope,registryRevision:'1',contentSha256:'9'.repeat(64),mode:'explicit-empty'},policy,policySha256:digest(policy)};
  context.storage={intentId:'bf710000-0000-4000-8000-000000000002',manifest:{blobId:'bf710000-0000-4000-8000-000000000003',sha256:'a'.repeat(64),bytes:1024},capture:null};
  const points=response.route.pathPoints.map(point=>[point.x,point.y,point.z] as [number,number,number]);
  const routeSha256=digest(barrierRouteHashInput(points));
  const {schemaVersion:_version,engineIdentity:_identity,...body}=legacy;
  const dependencies:BarrierDependencySnapshot={...body,schemaVersion:'pathfinder.dependencies.v8',engineIdentity:syntheticBarrierEngineIdentity(),barriers:context,
    from:{...body.from,point:points[0]},to:{...body.to,point:points[1]},options:{...body.options,barrierRouting:{schemaVersion:'wfc.pf.barrier-admission-intent.v1',scope,
      expectedRegistryRevision:'1',expectedSnapshot:context.binding.snapshot,drillThroughWalls:false}}};
  const distance=Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1],points[1][2]-points[0][2]);
  const result=engineResponseSchema.parse({...response,schemaVersion:'pathfinder.model.response.v3',effectiveCategory:legacy.cableInputs.mto==='Instrumentation'?'Control':legacy.cableInputs.mto,
    barriers:{schemaVersion:'wfc.pf.barrier-execution.v1',context,proof:{schemaVersion:'wfc.pf.barrier-check-proof.v2',binding:context.binding,routeSha256,
      status:'no-barriers-declared',routePointCount:2,totalSegments:1,checkedSegments:0,blocking:null,failedSegmentIndex:null,reasonCode:'EXPLICIT_EMPTY_SCOPE',coverage:'registered-selected-objects-only',engineeringAccepted:false},
      directSecondary:{schemaVersion:'wfc.pf.constrained-direct-secondary.v2',policyVersion:'nearest-eligible-tray-or-registered-barriers.v2',binding:context.binding,
        directRouteSha256:routeSha256,mode:'tray-network',directCheck:null,reasonCode:'DISTANCE_NOT_QUALIFIED',distanceDecision:{schemaVersion:'wfc.pf.direct-secondary.v1',policyVersion:DIRECT_SECONDARY_POLICY,
          coordinateFrame:'canonical-world-metres',mode:'tray-network',fromPoint:points[0],toPoint:points[1],distanceMeters:distance,nearestFromMeters:0,nearestToMeters:0,eligibleTrays:1,comparison:null}},
      diagnostics:{status:'no-barriers-declared',reasonCode:'DRILLING_BYPASS',searchComplete:true,candidatesTruncated:false,pairAttempts:0,collisionQueries:0,work:'0',plannerAttempts:0,
        straightPairAttempts:0,localEdgeChecks:0,localPhaseUsed:false,straightPhaseTruncated:false},connectors:{from:null,to:null},qualification:null}});
  return {dependencies,result:{...result,calculationMode:'calculate'}};
}
