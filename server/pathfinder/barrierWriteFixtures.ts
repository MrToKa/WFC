import type { EngineResponse, ScopedDependencySnapshot } from './jobContracts.js';
import { defaultOptions } from './jobContracts.js';
import { syntheticEngineIdentity } from './calculationFixtures.js';
import { syntheticInitialFillBarrierInputs } from './initialFillBarrierFixtures.js';

/** Synthetic write-boundary fixture only; not a captured model or engineering evidence. */
export function syntheticBarrierWriteInputs() {
  const id=(n:number)=>`b7700000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const frame=id(10),aggregate=id(8),projection='b'.repeat(64);
  const endpoint=(locationId:string)=>({locationId,locationRevision:'1',bindingRevision:'1',point:[0,0,0] as [number,number,number],bindingId:id(16),bindingContentSha256:'f'.repeat(64),
    mode:'fixed-world' as const,captureFrameId:frame,qualifiedProjectFrameId:null,aggregateId:aggregate,projectionSha256:projection,sourceObjectRevisionId:null,migrationDecisionId:null});
  const legacy:ScopedDependencySnapshot={schemaVersion:'pathfinder.dependencies.v7',projectId:id(1),cableId:id(2),cableWriteRevision:'7',
    model:{id:id(7),selectionRevision:'1',contentFingerprint:'a'.repeat(64)},artifact:{id:id(9),sha256:projection},
    preparation:{aggregateId:aggregate,geometryRevision:'2',captureFrameId:frame,projectionSha256:projection},
    routing:{catalogRevision:'1',routingContentSha256:'a'.repeat(64),routingPolicyRevision:'1',routingPolicySha256:'b'.repeat(64)},
    cableInputs:{fromLocation:'FROM',toLocation:'TO',mto:'LV',cableTypeId:id(17)},
    settings:{revision:'2',connectionGap:'1',secondaryTrayLength:null,endConnectionLength:'1',additionalBendingPercent:'10'},options:{...defaultOptions},
    from:endpoint(id(18)),to:endpoint(id(19)),endpointResolution:{schemaVersion:'pathfinder.endpoint-resolution.v1',matchingPolicy:'nfc-trim-uppercase-v1',from:{logicalKey:'FROM',locationId:id(18)},to:{logicalKey:'TO',locationId:id(19)}},
    comparison:null,engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1',engineIdentity:syntheticEngineIdentity()};
  const response:EngineResponse={schemaVersion:'pathfinder.model.response.v1',requestId:id(20),status:'calculated',message:'Synthetic writer fixture.',engineeringAccepted:false,
    route:{success:true,message:'',routeText:'/A',routeCodes:['A'],segmentIds:['dbid:1'],pathPoints:[{x:0,y:0,z:0},{x:5,y:0,z:0}],lengthMeters:5,fromDistanceMeters:1,toDistanceMeters:1,
      fromRequiresSecondary:false,toRequiresSecondary:false,connectionGapCount:0,connectionGapLengthMeters:0},
    design:{lengthBeforePercentageMeters:'6',unroundedLengthMeters:'6.6',designLengthMeters:'7'},lengthLedger:{schemaVersion:'wfc.pf.length-components.v1',formulaVersion:'pathfinder-45c24bf5',settingsRevision:'2',
      raw:{lengthMeters:5,fromDistanceMeters:1,toDistanceMeters:1},rawLengthDecimalMeters:'5',from:{requiresSecondary:false,removedApproachMeters:'0'},to:{requiresSecondary:false,removedApproachMeters:'0'},
      settings:{secondaryTrayLengthMeters:null,endConnectionLengthMeters:'1',additionalBendingPercent:'10'},secondaryEnds:0,replacementMeters:'0',beforeClampMeters:'5',clampAdjustmentMeters:'0',afterClampMeters:'5',
      beforePercentageMeters:'6',bendingIncrementMeters:'0.6',unroundedMeters:'6.6',ceilingIncrementMeters:'0.4',designLengthMeters:'7',gapAccounting:'already-in-raw-geometry'}};
  return {...syntheticInitialFillBarrierInputs(legacy,response),legacy,response,id};
}
