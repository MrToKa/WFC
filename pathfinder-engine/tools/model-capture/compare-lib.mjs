import { assert,point,hash,encode,readCapture,readJson } from './normalize-lib.mjs';

export const NUMERIC_TOLERANCE_METRES=1e-9;
const same=(a,b)=>{
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  if(Array.isArray(a))return a.length===b.length&&a.every((value,index)=>same(value,b[index]));
  const keys=Object.keys(a).sort(),other=Object.keys(b).sort();return keys.length===other.length&&keys.every((key,index)=>key===other[index]&&same(a[key],b[key]));
};
const orderedNames=leaf=>(leaf.leafToRoot??[]).map(node=>node.displayName);
export const nativeIdentity=leaf=>({id:leaf.id,leafToRoot:(leaf.leafToRoot??[]).map(node=>({displayName:node.displayName,className:node.className??null,instanceGuid:node.instanceGuid??null,siblingIndex:node.siblingIndex??null}))});
export const convertedIdentity=object=>({id:object.id,dbId:object.dbId,externalIds:object.externalIds??[],hierarchy:(object.hierarchy??[]).map(node=>({dbId:node.dbId,name:node.name})),ownerIds:object.ownerIds??[]});
export const identityHash=value=>hash(encode(value));
function roundtripNumber(value){assert((typeof value==='number'&&Number.isFinite(value))||(typeof value==='string'&&/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)&&Number.isFinite(Number(value))),'A finite numeric or round-trip string is required.');return Number(value);}
function coordinates(record,name){const raw=record[name+'R']??record[name];assert(Array.isArray(raw),'Missing coordinate evidence: '+name);return point(raw.map(roundtripNumber),name);}
function numeric(record,name){return roundtripNumber(record[name+'R']??record[name]);}

export function compareReferences(native,loaded,pairMap,evaluation=null){
  assert(native.value.schemaVersion==='native-oracle.capture.v1','Unsupported native oracle schema.');
  if(native.value.status!=='captured')return {schemaVersion:'pathfinder.converted.native-comparison.v1',status:'BLOCKED',scope:'no-complete-native-capture',blockers:['Native oracle did not produce a completed capture.'],nativeCaptureSha256:native.sha256,checks:[]};
  assert(native.value.sourceCommit==='45c24bf5f433f13e102600b36f20327c77961d0a','Native oracle source version does not match the pinned PathFinder reference.');
  const raw=loaded.main.value;
  assert(Array.isArray(native.value.requests),'Native requests array required.');
  const requests=native.value.requests.filter(request=>request.caseId===raw.caseId);
  assert(requests.length===1,'Exactly one matching native case ID required.');
  const request=requests[0],objects=loaded.parts.map(part=>part.value.object);
  assert(Array.isArray(request.inputs)&&request.inputs.length>0&&Array.isArray(request.leafEvidence)&&Array.isArray(request.fittedSegments)&&Array.isArray(request.automaticCases),'Native capture requires complete raw/fitted/automatic record arrays.');
  const inputById=new Map((request.inputs??[]).map(input=>[input.id,input]));
  const leafById=new Map((request.leafEvidence??[]).map(leaf=>[leaf.id,leaf]));
  const convertedById=new Map(objects.map(object=>[object.id,object]));
  assert(inputById.size===request.inputs.length&&leafById.size===request.leafEvidence.length&&convertedById.size===objects.length,'Duplicate comparison identities.');
  const synthetic=native.value.synthetic===true||raw.metadata?.captureKind==='synthetic';
  const result={schemaVersion:'pathfinder.converted.native-comparison.v1',status:'BLOCKED',scope:synthetic?'synthetic-comparator-controls':'real-native-converted-selected-case',caseId:raw.caseId,
    nativeCaptureSha256:native.sha256,convertedCaptureSha256:loaded.main.sha256,numericAbsoluteToleranceMetres:NUMERIC_TOLERANCE_METRES,
    numericPolicy:'Strict 1e-9m diagnostic comparison; synthetic PF math tolerance is not accepted real-model tessellation tolerance.',
    realModelEngineeringTolerance:'NOT_ESTABLISHED',engineeringAcceptance:'NOT_ESTABLISHED',
    blockers:[],checks:[],candidatePairs:[],pairedObjects:[],limitations:['Hash-bound explicit pair decisions do not establish a cloud translation source chain or authorization.',
      'Mesh array/topology comparison is strict and ordered; differing tessellation/order is reported rather than silently equated.',
      'Selected reference comparisons never establish full-model geometry, category, visibility or engineering-write readiness.']};
  for(const leaf of leafById.values()){
    const names=orderedNames(leaf);
    const candidates=objects.filter(object=>same(object.hierarchy.map(node=>node.name),names)).map(object=>({convertedId:object.id,convertedIdentitySha256:identityHash(convertedIdentity(object)),
      nativeIdentitySha256:identityHash(nativeIdentity(leaf)),externalIds:object.externalIds??[],hierarchyExact:true}));
    result.candidatePairs.push({nativeId:leaf.id,nativeIdentitySha256:identityHash(nativeIdentity(leaf)),candidates,automaticallyAccepted:false});
  }
  if(!pairMap){result.blockers.push('An explicit reviewed, hash-bound native/converted identity pairing map is required; candidates are not accepted automatically.');return result;}
  assert(pairMap.schemaVersion==='pathfinder.converted.native-pairs.v1'&&pairMap.nativeCaptureSha256===native.sha256&&pairMap.convertedCaptureSha256===loaded.main.sha256&&pairMap.caseId===raw.caseId,'Pair map does not bind these exact captures/case.');
  assert(Array.isArray(pairMap.pairs)&&pairMap.pairs.length>0&&pairMap.pairs.length<=4096,'Pair count outside budget.');
  const mapping=new Map(),usedConverted=new Set();
  for(const pair of pairMap.pairs){
    const leaf=leafById.get(pair.nativeId),object=convertedById.get(pair.convertedId);
    assert(leaf&&object&&!mapping.has(pair.nativeId)&&!usedConverted.has(pair.convertedId),'Unknown or duplicate explicit pair.');
    assert(pair.nativeIdentitySha256===identityHash(nativeIdentity(leaf))&&pair.convertedIdentitySha256===identityHash(convertedIdentity(object)),'Reviewed identity hash differs.');
    assert(typeof pair.decision==='string'&&pair.decision.trim().length>=10&&pair.decision.length<=2048,'Explicit pairing decision/provenance required.');
    mapping.set(pair.nativeId,pair.convertedId);usedConverted.add(pair.convertedId);
    result.pairedObjects.push({nativeId:pair.nativeId,convertedId:pair.convertedId,decision:pair.decision,nativeIdentity:nativeIdentity(leaf),convertedIdentity:convertedIdentity(object)});
  }
  const check=(field,status,detail)=>result.checks.push({field,status,detail});
  const exact=(field,a,b)=>check(field,same(a,b)?'PASS':'FAIL',{native:a,converted:b});
  const vector=(field,a,b)=>{const x=point(a),y=point(b),d=Math.max(...x.map((value,index)=>Math.abs(value-y[index])));check(field,d<=NUMERIC_TOLERANCE_METRES?'PASS':'FAIL',{maximumAbsoluteDifferenceMetres:d});};
  const number=(field,a,b)=>{assert(Number.isFinite(a)&&Number.isFinite(b),'Nonfinite comparison value.');const d=Math.abs(a-b);check(field,d<=NUMERIC_TOLERANCE_METRES?'PASS':'FAIL',{native:a,converted:b,absoluteDifferenceMetres:d});};
  exact('routeText',request.routeText,raw.routeText);
  for(const [nativeId,convertedId]of mapping){
    const leaf=leafById.get(nativeId),object=convertedById.get(convertedId),input=inputById.get(nativeId),prefix=`object:${nativeId}=>${convertedId}`;
    assert(input,'Native geometry input missing for paired leaf.');
    vector(prefix+'.worldMinimum',coordinates(leaf,'worldMinimum'),object.bounds.minimum);
    vector(prefix+'.worldMaximum',coordinates(leaf,'worldMaximum'),object.bounds.maximum);
    const min=coordinates(leaf,'worldMinimum'),max=coordinates(leaf,'worldMaximum');
    vector(prefix+'.bottomCentre',[(min[0]+max[0])/2,(min[1]+max[1])/2,min[2]],object.bottomCentreMetres);
    exact(prefix+'.leafToRootNames',orderedNames(leaf),object.hierarchy.map(node=>node.name));
    exact(prefix+'.shapeName',input.shapeName,object.name);
    exact(prefix+'.routeName',input.routeName,(object.routeNames??[]).length===1?object.routeNames[0]:null);
    if(object.nativeHidden===null||object.nativeHidden===undefined)check(prefix+'.nativeVisibility','NOT_RUN','SDK display visibility is not a native inherited visibility record.');
    else exact(prefix+'.nativeVisibility',!leaf.effectivelyVisible,object.nativeHidden);
    check(prefix+'.productionCategories','NOT_RUN',{nativeReferenceCategories:input.categories,convertedAssignment:object.categoryAssignmentSource,note:'Reference selection assignments are not automatic production eligibility.'});
    const nativeFragments=input.meshFragments;
    if(!Array.isArray(nativeFragments)){check(prefix+'.mesh','NOT_RUN','Native input did not retain triangle mesh evidence.');continue;}
    exact(prefix+'.fragmentCount',nativeFragments.length,object.fragments.length);
    for(let fi=0;fi<Math.min(nativeFragments.length,object.fragments.length);fi++){
      const nativeFragment=nativeFragments[fi],convertedFragment=object.fragments[fi];
      const vertices=(nativeFragment.verticesR??nativeFragment.vertices).map(vertex=>vertex.map(roundtripNumber));
      exact(prefix+`.fragment[${fi}].vertexCount`,vertices.length,convertedFragment.vertices.length);
      exact(prefix+`.fragment[${fi}].triangleIndices`,nativeFragment.triangleIndices,convertedFragment.triangleIndices);
      if(vertices.length===convertedFragment.vertices.length){let maximum=0;for(let i=0;i<vertices.length;i++){const a=point(vertices[i]),b=point(convertedFragment.vertices[i]);maximum=Math.max(maximum,...a.map((value,axis)=>Math.abs(value-b[axis])));}check(prefix+`.fragment[${fi}].vertices`,maximum<=NUMERIC_TOLERANCE_METRES?'PASS':'FAIL',{maximumAbsoluteDifferenceMetres:maximum});}
      else check(prefix+`.fragment[${fi}].vertices`,'NOT_COMPARABLE','Ordered vertex arrays have different cardinality; no fabricated remapping.');
    }
  }
  if(mapping.size!==inputById.size||usedConverted.size!==convertedById.size)result.blockers.push('Pair mapping does not cover every captured native input and converted selected object.');
  if(!evaluation){result.blockers.push('Converted fitted ports, lookup and automatic route outputs have not been computed for this exact capture.');check('fittedPortsAndRoutes','NOT_RUN','A separately hash-bound engine evaluation artifact is required.');}
  else{
    assert(evaluation.schemaVersion==='pathfinder.converted.engine-evaluation.v1'&&evaluation.captureReceiptSha256===loaded.main.sha256&&evaluation.caseId===raw.caseId,'Converted evaluation does not bind this exact capture/case.');
    const fitted=new Map((evaluation.fittedSegments??[]).map(segment=>[segment.id,segment]));
    for(const nativeSegment of request.fittedSegments??[]){
      const convertedId=mapping.get(nativeSegment.id),segment=fitted.get(convertedId),prefix=`fitted:${nativeSegment.id}=>${convertedId}`;
      if(!segment){check(prefix,'FAIL','Missing converted fitted segment.');continue;}
      exact(prefix+'.routeCode',nativeSegment.routeCode,segment.routeCode);exact(prefix+'.connectionsAtEndsOnly',nativeSegment.connectionsAtEndsOnly,segment.connectionsAtEndsOnly);
      exact(prefix+'.pointCount',nativeSegment.points.length,segment.points.length);
      for(let i=0;i<Math.min(nativeSegment.points.length,segment.points.length);i++)vector(prefix+`.point[${i}]`,(nativeSegment.pointsR??nativeSegment.points)[i].map(roundtripNumber),segment.points[i]);
      exact(prefix+'.verifiedPortCount',nativeSegment.verifiedPorts.length,segment.verifiedPorts.length);
      for(let i=0;i<Math.min(nativeSegment.verifiedPorts.length,segment.verifiedPorts.length);i++)for(const field of ['point','outward','u','v'])vector(prefix+`.port[${i}].${field}`,coordinates(nativeSegment.verifiedPorts[i],field),segment.verifiedPorts[i][field]);
      for(let i=0;i<Math.min(nativeSegment.verifiedPorts.length,segment.verifiedPorts.length);i++)for(const field of ['width','height'])number(prefix+`.port[${i}].${field}`,numeric(nativeSegment.verifiedPorts[i],field),segment.verifiedPorts[i][field]);
      exact(prefix+'.connectionSurfaceCount',nativeSegment.connectionSurfaceCount,segment.connectionSurfaceCount);
    }
    function route(prefix,a,b){
      if(!b){check(prefix,'FAIL','Missing converted route result.');return;}
      for(const value of [a,b])assert(typeof value?.success==='boolean'&&typeof value.routeText==='string'&&Array.isArray(value.routeCodes)&&Array.isArray(value.segmentIds)&&Array.isArray(value.pathPoints)&&typeof value.fromRequiresSecondary==='boolean'&&typeof value.toRequiresSecondary==='boolean'&&Number.isSafeInteger(value.connectionGapCount)&&value.connectionGapCount>=0,'Complete typed route result fields are required.');
      for(const field of ['success','routeText','routeCodes','fromRequiresSecondary','toRequiresSecondary','connectionGapCount'])exact(prefix+'.'+field,a[field],b[field]);
      exact(prefix+'.segmentIds',a.segmentIds.map(id=>mapping.get(id)??`unpaired:${id}`),b.segmentIds);
      for(const field of ['lengthMeters','fromDistanceMeters','toDistanceMeters','connectionGapLengthMeters'])number(prefix+'.'+field,numeric(a,field),b[field]);
      exact(prefix+'.pathPointCount',a.pathPoints.length,b.pathPoints.length);
      for(let i=0;i<Math.min(a.pathPoints.length,b.pathPoints.length);i++)vector(prefix+`.pathPoint[${i}]`,(a.pathPointsR??a.pathPoints)[i].map(roundtripNumber),b.pathPoints[i]);
    }
    exact('lookup.options',request.options,evaluation.options);route('lookup',request.lookup,evaluation.lookup);
    for(const nativeCase of request.automaticCases??[]){
      const compared=(evaluation.automaticCases??[]).filter(value=>value.caseId===nativeCase.caseId);
      if(compared.length!==1){check(nativeCase.caseId,'FAIL','Exactly one converted automatic case required.');continue;}
      const convertedCase=compared[0];
      for(const field of ['category','projectSettings','options'])exact(nativeCase.caseId+'.'+field,nativeCase[field],convertedCase[field]);
      for(const field of ['from','to'])vector(nativeCase.caseId+'.'+field,coordinates(nativeCase,field),convertedCase[field]);
      route(nativeCase.caseId+'.route',nativeCase.route,convertedCase.route);
      for(const field of ['lengthBeforePercentageMeters','unroundedLengthMeters','designLengthMeters'])exact(nativeCase.caseId+'.design.'+field,nativeCase.design?.[field]??null,convertedCase.design?.[field]??null);
    }
  }
  result.status=result.checks.some(value=>value.status==='FAIL')?'FAIL':result.blockers.length?'BLOCKED':'PASS';
  result.engineeringWriteAuthorized=false;
  return result;
}

export async function loadComparison(nativeFile,convertedFile,pairFile,evaluationFile){
  const native=await readJson(nativeFile,256*1024*1024),converted=await readCapture(convertedFile);
  const pair=pairFile?await readJson(pairFile):null,evaluation=evaluationFile?await readJson(evaluationFile,256*1024*1024):null;
  const result=compareReferences(native,converted,pair?.value,evaluation?.value);
  result.pairMapSha256=pair?.sha256??null;result.evaluationSha256=evaluation?.sha256??null;return result;
}
