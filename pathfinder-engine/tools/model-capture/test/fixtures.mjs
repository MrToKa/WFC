import { encode,hash,multiply,apply } from '../normalize-lib.mjs';
import { identityHash,nativeIdentity,convertedIdentity } from '../compare-lib.mjs';
export const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function fixture(){
  const display=[0,1,0,0,-1,0,0,0,0,0,1,0,10,20,0,1];
  const toWorld=[.001,0,0,0,0,.001,0,0,0,0,.001,0,1000000,-2000000,3,1];
  const world=multiply(toWorld,display),local=[[0,0,0],[1000,0,0],[0,1000,0]],vertices=local.map(p=>apply(world,p));
  const minimum=[0,1,2].map(axis=>Math.min(...vertices.map(p=>p[axis]))),maximum=[0,1,2].map(axis=>Math.max(...vertices.map(p=>p[axis])));
  const object={id:'dbid:1',dbId:1,parentId:'dbid:2',name:'FTUBE',hierarchy:[{dbId:1,name:'FTUBE',displayHidden:true},{dbId:2,name:'/A',displayHidden:false}],
    externalIds:['instance-1'],propertyExternalId:'instance-1',ownerIds:[2],routeNames:['/A'],nativeHidden:null,displayHidden:true,planningExcluded:false,
    categoryAssignmentSource:'unassigned',allowedCategories:[],properties:[{category:'Identity',name:'Guid',value:'instance-1'}],bounds:{minimum,maximum},sdkCanonicalBounds:{minimum,maximum},
    bottomCentreMetres:[(minimum[0]+maximum[0])/2,(minimum[1]+maximum[1])/2,minimum[2]],
    fragments:[{id:'fragment:7',fragmentId:7,vertices,triangleIndices:[0,1,2],fragmentToWorldMetres:world,transformAlreadyApplied:true,
      sdkOriginalWorldMatrix:display,sdkDisplayWorldMatrix:display,sourceLocalSample:[...local[0]],canonicalSample:[...vertices[0]],inverseError:0,localVertexCount:3}]};
  const partValue={schemaVersion:'pathfinder.converted.mesh-object.v1',captureId:'synthetic-capture-1',caseId:'synthetic-pair-01',object};
  const partBytes=encode(partValue);
  const raw={schemaVersion:'pathfinder.converted.mesh-capture.v1',sdkVersion:'7.130.0',captureId:partValue.captureId,caseId:partValue.caseId,routeText:'/A',
    package:{contentFingerprint:'a'.repeat(64),packageSha256:'b'.repeat(64),source:{sha256:'c'.repeat(64)}},capturedObjects:1,selectedObjectCount:1,
    metadata:{captureKind:'synthetic',upVector:[0,0,1],distanceUnit:'mm',metresPerDisplayUnit:.001,globalOffsetMetres:[1000000,-2000000,3],
      displayToWorldMetres:toWorld,sourceToWorldMetres:[.001,0,0,0,0,.001,0,0,0,0,.001,0,0,0,0,1]},parts:[{name:'synthetic-object.json',bytes:partBytes.length,sha256:hash(partBytes)}]};
  const mainBytes=encode(raw);
  const loaded={main:{value:raw,sha256:hash(mainBytes),bytes:mainBytes.length},parts:[{value:partValue,sha256:hash(partBytes),bytes:partBytes.length}],inventory:null};
  const leaf={id:'n1',leafToRoot:[{displayName:'FTUBE',className:'Geometry',instanceGuid:'instance-1',siblingIndex:0},{displayName:'/A',className:'Group',instanceGuid:'owner-1',siblingIndex:0}],
    worldMinimum:minimum,worldMinimumR:minimum.map(String),worldMaximum:maximum,worldMaximumR:maximum.map(String),effectivelyVisible:true};
  const port={point:vertices[0],pointR:vertices[0].map(String),outward:[1,0,0],outwardR:['1','0','0'],u:[0,1,0],uR:['0','1','0'],v:[0,0,1],vR:['0','0','1'],width:.4,widthR:'0.4',height:.1,heightR:'0.1'};
  const route={success:true,routeText:'/A',routeCodes:['/A'],segmentIds:['n1'],pathPoints:vertices.slice(0,2),pathPointsR:vertices.slice(0,2).map(p=>p.map(String)),
    lengthMeters:1,lengthMetersR:'1',fromDistanceMeters:0,fromDistanceMetersR:'0',toDistanceMeters:0,toDistanceMetersR:'0',fromRequiresSecondary:false,toRequiresSecondary:false,connectionGapCount:0,connectionGapLengthMeters:0,connectionGapLengthMetersR:'0'};
  const options={connectionToleranceMeters:.25,sampleSpacingMeters:.125,secondaryDistanceMeters:2,preferVerticalApproach:true,maxGraphNodes:100000,maxGraphConnections:250000};
  const settings={revision:'synthetic-settings',secondaryTrayLength:'5',endConnectionLength:'6',additionalBendingPercent:'5',source:'explicit synthetic test'};
  const automatic={caseId:'synthetic-pair-01-secondary',category:'Control',projectSettings:settings,options,from:vertices[0],to:vertices[1],route,design:{lengthBeforePercentageMeters:'7',unroundedLengthMeters:'7.35',designLengthMeters:'8'}};
  const segment={id:'n1',routeCode:'/A',connectionsAtEndsOnly:false,points:vertices.slice(0,2),verifiedPorts:[port],connectionSurfaceCount:1};
  const nativeValue={schemaVersion:'native-oracle.capture.v1',sourceCommit:'45c24bf5f433f13e102600b36f20327c77961d0a',status:'captured',synthetic:true,requests:[{caseId:raw.caseId,routeText:'/A',options,leafEvidence:[leaf],
    inputs:[{id:'n1',minimum,maximum,routeName:'/A',shapeName:'FTUBE',categories:7,meshFragments:[{vertices,verticesR:vertices.map(p=>p.map(String)),triangleIndices:[0,1,2]}]}],fittedSegments:[segment],lookup:route,automaticCases:[automatic]}]};
  const nativeBytes=encode(nativeValue),native={value:nativeValue,sha256:hash(nativeBytes)};
  const pairMap={schemaVersion:'pathfinder.converted.native-pairs.v1',nativeCaptureSha256:native.sha256,convertedCaptureSha256:loaded.main.sha256,caseId:raw.caseId,pairs:[{nativeId:'n1',convertedId:object.id,nativeIdentitySha256:identityHash(nativeIdentity(leaf)),convertedIdentitySha256:identityHash(convertedIdentity(object)),decision:'Synthetic reviewed identity pair for comparator controls only.'}]};
  const mappedRoute={...route,segmentIds:[object.id]};
  const evaluation=structuredClone({schemaVersion:'pathfinder.converted.engine-evaluation.v1',captureReceiptSha256:loaded.main.sha256,caseId:raw.caseId,options,
    fittedSegments:[{...segment,id:object.id}],lookup:mappedRoute,automaticCases:[{...automatic,route:mappedRoute}]});
  return {loaded,raw,object,partValue,partBytes,mainBytes,native,nativeBytes,pairMap,evaluation};
}
