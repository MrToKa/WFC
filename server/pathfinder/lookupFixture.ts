import type { ComputationalSnapshot } from './contracts.js';
import { syntheticStraightSnapshot } from './syntheticFixture.js';
/** Mathematical 10m fixture through the dedicated converted-adapter DTO, never actual model or native evidence. */
export function syntheticLookupSnapshot(projectId:string,modelVersionId:string,fingerprint:string):ComputationalSnapshot {
  const snapshot=syntheticStraightSnapshot(projectId,modelVersionId,fingerprint),leaf=snapshot.objects[0];
  snapshot.capture={adapterVersion:'wfc.protected-lookup-capture.v1',sourceKind:'converted',lookupRouteCodes:['/BC001'],inventoryComplete:false,geometryComplete:false,
    unitsVerified:false,transformsVerified:false,planningVisibilityKnown:false,sourceLinkVerified:false,evidenceSha256:[]};
  leaf.name='FTUBE /BC001/123';leaf.parentId='synthetic:lookup-owner';leaf.leafToRootNames=[leaf.name,'/BC001'];leaf.nativeHidden=null;leaf.planningExcluded=false;
  delete leaf.routeName;delete leaf.shapeName;delete leaf.routeBoundaryId;leaf.categoryAssignmentSource='lookup-all-categories';leaf.allowedCategories=['MV','LV','Control'];
  snapshot.objects=[leaf,{id:'synthetic:lookup-owner',parentId:null,name:'/BC001',geometryRole:'hierarchy',leafToRootNames:['/BC001'],properties:[],nativeHidden:null,
    planningExcluded:false,categoryAssignmentSource:'unassigned',allowedCategories:[],bounds:structuredClone(leaf.bounds),fragments:[]}];
  return snapshot;
}
