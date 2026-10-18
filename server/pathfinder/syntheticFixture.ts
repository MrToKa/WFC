import type { ComputationalSnapshot } from './contracts.js';

/** A new local mathematical demonstration, not a PF-0 golden or converted/native acceptance. */
export function syntheticStraightSnapshot(projectId:string,modelVersionId:string,contentFingerprint:string):ComputationalSnapshot {
  const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  return {schemaVersion:'pathfinder.model.snapshot.v1',model:{projectId,modelVersionId,contentSha256:contentFingerprint},
    capture:{adapterVersion:'pf-local-straight-v1',sourceKind:'synthetic',inventoryComplete:true,geometryComplete:true,unitsVerified:true,transformsVerified:true,
      planningVisibilityKnown:true,sourceLinkVerified:false,evidenceSha256:[]},
    coordinates:{vertexFrame:'canonical-world-metres',sourceUnits:'metres',metresPerSourceUnit:1,sourceToWorldMetres:identity,globalOffsetMetres:[0,0,0],displayToWorldMetres:identity},
    objects:[{id:'synthetic:tray-1',parentId:null,externalId:null,dbId:null,name:'STRAIGHT',geometryRole:'routing-leaf',leafToRootNames:['STRAIGHT','/BC001'],
      properties:[],nativeHidden:false,planningExcluded:false,routeName:'/BC001',shapeName:'STRAIGHT',categoryAssignmentSource:'synthetic',allowedCategories:['Control'],
      bounds:{minimum:[0,-0.5,0],maximum:[10,0.5,1]},fragments:[{id:'synthetic:fragment-1',vertices:[[0,-0.5,0],[10,-0.5,0],[0,0.5,0]],triangleIndices:[0,1,2],fragmentToWorldMetres:identity,transformAlreadyApplied:true}]},
    ...[0,10].map((x,index) => ({id:`synthetic:equipment-${index}`,parentId:null,externalId:null,dbId:null,name:index ? '=PF-SYNTHETIC-TO' : '=PF-SYNTHETIC-FROM',
      geometryRole:'object' as const,leafToRootNames:[index ? '=PF-SYNTHETIC-TO' : '=PF-SYNTHETIC-FROM'],properties:[],nativeHidden:false,planningExcluded:false,
      categoryAssignmentSource:'synthetic' as const,allowedCategories:[],bounds:{minimum:[x,0,.5] as [number,number,number],maximum:[x,0,.5] as [number,number,number]},fragments:[]}))]};
}
