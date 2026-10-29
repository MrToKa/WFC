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

/** Two explicitly synthetic 10m straight trays separated by a measured 0.5m gap. */
export function syntheticGapSnapshot(projectId:string,modelVersionId:string,contentFingerprint:string):ComputationalSnapshot {
  const snapshot=syntheticStraightSnapshot(projectId,modelVersionId,contentFingerprint);
  const second=structuredClone(snapshot.objects[0]);
  second.id='synthetic:tray-2';second.routeName='/BC002';second.leafToRootNames=['STRAIGHT','/BC002'];
  second.bounds={minimum:[10.5,-.5,0],maximum:[20.5,.5,1]};
  second.fragments[0].id='synthetic:fragment-2';
  second.fragments[0].vertices=second.fragments[0].vertices.map(([x,y,z])=>[x+10.5,y,z]);
  snapshot.objects.splice(1,0,second);
  const endpoint=snapshot.objects.at(-1)!;endpoint.bounds={minimum:[20.5,0,.5],maximum:[20.5,0,.5]};
  return snapshot;
}
