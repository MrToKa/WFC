import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {fixture} from './fixtures.mjs';
import {normalizeCapture,readCapture,readJson,encode,hash} from '../normalize-lib.mjs';
import {compareReferences} from '../compare-lib.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const scratch=path.join(root,'pathfinder-engine/.scratch/pf2-converted/normalizer-tests',crypto.randomUUID());
await fs.mkdir(scratch,{recursive:true});
const results=[];
function check(name,fn){test(name,async()=>{try{await fn();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',message:error.message});throw error;}});}
const normalize=value=>normalizeCapture(value,{projectId:'synthetic-project',modelVersionId:'synthetic-model'});
check('synthetic raw capture maps strict selected canonical snapshot without a second transform',()=>{
  const f=fixture(),result=normalize(f.loaded);
  assert.equal(result.snapshot.schemaVersion,'pathfinder.model.snapshot.v1');assert.equal(result.snapshot.capture.sourceKind,'synthetic');
  assert.deepEqual(result.snapshot.objects[0].fragments[0].vertices,f.object.fragments[0].vertices);
  assert.equal(result.snapshot.objects[0].geometryRole,'routing-leaf');assert.equal(result.snapshot.objects[0].parentId,'dbid:2');
  assert.equal(result.snapshot.capture.inventoryComplete,false);assert.equal(result.snapshot.capture.geometryComplete,false);
  assert.equal(result.report.maximumTransformResidual,0);
});
check('display hiding and supplied ready booleans cannot promote native planning proofs',()=>{
  const f=fixture();Object.assign(f.raw.metadata,{unitsVerified:true,transformsVerified:true,sourceLinkVerified:true,planningVisibilityKnown:true});
  Object.assign(f.object,{nativeHidden:false,categoryAssignmentSource:'explicit-planning',allowedCategories:['Control']});
  const r=normalize(f.loaded);assert.equal(r.snapshot.objects[0].nativeHidden,null);assert.deepEqual(r.snapshot.objects[0].allowedCategories,[]);
  assert.equal(r.snapshot.objects[0].categoryAssignmentSource,'unassigned');
  for(const field of ['unitsVerified','transformsVerified','sourceLinkVerified','planningVisibilityKnown'])assert.equal(r.snapshot.capture[field],false);
  assert.equal(r.snapshot.model.sourceContentSha256,undefined);
});
check('ambiguous external identities are retained in provenance and not chosen',()=>{
  const f=fixture();f.object.externalIds.push('another-instance');const r=normalize(f.loaded);
  assert.equal(r.snapshot.objects[0].externalId,undefined);assert.ok(r.report.diagnostics.some(value=>value.code==='external_identity_ambiguous'));
});
check('double-applied fragment transform is rejected',()=>{const f=fixture();f.object.fragments[0].fragmentToWorldMetres[12]+=1;assert.throws(()=>normalize(f.loaded),/composition differs/);});
check('null matrix coordinates from nonfinite SDK serialization are rejected',()=>{const f=fixture();f.raw.metadata.displayToWorldMetres[12]=null;assert.throws(()=>normalize(f.loaded),/16 finite/);});
check('wrong canonical sample is rejected',()=>{const f=fixture();f.object.fragments[0].canonicalSample[0]+=1;assert.throws(()=>normalize(f.loaded),/sample disagrees/);});
check('unapplied canonical transform is rejected',()=>{const f=fixture();f.object.fragments[0].transformAlreadyApplied=false;assert.throws(()=>normalize(f.loaded),/Unapplied/);});
check('invalid triangle index is rejected',()=>{const f=fixture();f.object.fragments[0].triangleIndices[2]=3;assert.throws(()=>normalize(f.loaded),/Triangle index/);});
check('canonical vertex outside declared bounds is rejected',()=>{const f=fixture();f.object.bounds.maximum[0]-=2;assert.throws(()=>normalize(f.loaded),/Inverted|outside declared/);});
check('partial selected capture count is rejected',()=>{const f=fixture();f.raw.selectedObjectCount=2;assert.throws(()=>normalize(f.loaded),/incomplete or count differs/);});
check('cyclic hierarchy is rejected without dropping parents',()=>{const f=fixture();f.object.hierarchy.push({...f.object.hierarchy[0]});assert.throws(()=>normalize(f.loaded),/Cyclic/);});
check('completed inventory identity is checked independently of selected geometry completeness',()=>{
  const f=fixture();f.loaded.inventory={receipt:{sha256:'d'.repeat(64)},objects:new Map([[f.object.id,{id:f.object.id,dbId:1,parentId:'dbid:2',name:'FTUBE',fragmentIds:[7]}],['dbid:2',{id:'dbid:2',dbId:2,parentId:null,name:'/A',fragmentIds:[]}]])};
  const r=normalize(f.loaded);assert.equal(r.report.completeInventorySeparatelyVerified,true);assert.equal(r.snapshot.capture.inventoryComplete,false);
  f.loaded.inventory.objects.get(f.object.id).name='different';assert.throws(()=>normalize(f.loaded),/inventory identity/);
});
check('hash-bound raw file loading detects corruption and path traversal',async()=>{
  const f=fixture();const dir=path.join(scratch,'hash-closure');await fs.mkdir(dir);
  await fs.writeFile(path.join(dir,'synthetic-object.json'),f.partBytes);await fs.writeFile(path.join(dir,'receipt.json'),f.mainBytes);
  const loaded=await readCapture(path.join(dir,'receipt.json'));assert.equal(normalize(loaded).snapshot.objects.length,1);
  await fs.appendFile(path.join(dir,'synthetic-object.json'),' ');await assert.rejects(readCapture(path.join(dir,'receipt.json')),/hash\/byte/);
  f.raw.parts[0].name='../outside.json';await fs.writeFile(path.join(dir,'receipt.json'),encode(f.raw));await assert.rejects(readCapture(path.join(dir,'receipt.json')),/Unsafe/);
});
check('duplicate JSON keys are rejected before information is lost',async()=>{const file=path.join(scratch,'duplicate.json');await fs.writeFile(file,'{"schemaVersion":1,"schemaVersion":2}');await assert.rejects(readJson(file),/Duplicate JSON/);});
async function inventoryChain(length,order){
  const f=fixture(),directory=path.join(scratch,`inventory-depth-${length}-${order}`);await fs.mkdir(directory);
  await fs.writeFile(path.join(directory,'synthetic-object.json'),f.partBytes);await fs.writeFile(path.join(directory,'mesh-receipt.json'),f.mainBytes);
  let objects=Array.from({length},(_,index)=>({id:`dbid:${index+1}`,dbId:index+1,parentId:index===0?null:`dbid:${index}`,name:`node-${index+1}`,fragmentIds:[]}));
  if(order==='deep-first')objects.reverse();
  const part={schemaVersion:'pathfinder.converted.inventory-part.v1',captureId:'synthetic-inventory-depth',offset:0,objects};
  const bytes=encode(part);await fs.writeFile(path.join(directory,'inventory-part.json'),bytes);
  const receipt={schemaVersion:'pathfinder.converted.inventory.v1',captureId:part.captureId,inventoryComplete:true,objectCount:length,package:f.raw.package,
    parts:[{name:'inventory-part.json',bytes:bytes.length,sha256:hash(bytes)}]};
  await fs.writeFile(path.join(directory,'inventory-receipt.json'),encode(receipt));
  return()=>readCapture(path.join(directory,'mesh-receipt.json'),path.join(directory,'inventory-receipt.json'));
}
check('root-first complete inventory cannot bypass depth cap through memoized ancestors',async()=>{const read=await inventoryChain(513,'root-first');await assert.rejects(read(),/over-depth/);});
check('deep-first complete inventory rejects the same over-depth chain',async()=>{const read=await inventoryChain(513,'deep-first');await assert.rejects(read(),/over-depth/);});
check('root-first complete inventory accepts exactly 512 nodes of total depth',async()=>{const read=await inventoryChain(512,'root-first');assert.equal((await read()).inventory.objects.size,512);});
check('deep-first complete inventory accepts exactly 512 nodes of total depth',async()=>{const read=await inventoryChain(512,'deep-first');assert.equal((await read()).inventory.objects.size,512);});
check('explicit pair map required; matching name candidates are never accepted automatically',()=>{
  const f=fixture(),r=compareReferences(f.native,f.loaded,null);assert.equal(r.status,'BLOCKED');assert.equal(r.candidatePairs[0].candidates.length,1);assert.equal(r.candidatePairs[0].automaticallyAccepted,false);
});
check('complete synthetic geometry/port/path/decimal comparison passes its explicit limited scope',()=>{
  const f=fixture(),r=compareReferences(f.native,f.loaded,f.pairMap,f.evaluation);assert.equal(r.status,'PASS');assert.equal(r.scope,'synthetic-comparator-controls');assert.equal(r.engineeringWriteAuthorized,false);
  assert.ok(r.checks.some(value=>value.field.includes('port[0]')));assert.ok(r.checks.some(value=>value.field.includes('design.designLengthMeters')));
});
check('stale reviewed identity hash is rejected',()=>{const f=fixture();f.pairMap.pairs[0].nativeIdentitySha256='0'.repeat(64);assert.throws(()=>compareReferences(f.native,f.loaded,f.pairMap,f.evaluation),/identity hash/);});
check('native null numeric evidence is rejected instead of becoming zero',()=>{const f=fixture();f.native.value.requests[0].leafEvidence[0].worldMinimumR[0]=null;assert.throws(()=>compareReferences(f.native,f.loaded,f.pairMap,f.evaluation),/finite numeric/);});
check('missing route flags on both sides are rejected instead of comparing equal absence',()=>{const f=fixture();delete f.native.value.requests[0].lookup.fromRequiresSecondary;delete f.evaluation.lookup.fromRequiresSecondary;assert.throws(()=>compareReferences(f.native,f.loaded,f.pairMap,f.evaluation),/typed route/);});
check('missing computed ports/routes stays blocked rather than claiming model parity',()=>{const f=fixture(),r=compareReferences(f.native,f.loaded,f.pairMap);assert.equal(r.status,'BLOCKED');assert.ok(r.checks.some(value=>value.field==='fittedPortsAndRoutes'&&value.status==='NOT_RUN'));});
check('route gap metrics, SECONDARY flags and decimal design changes are detected',()=>{
  for(const mutate of [e=>e.lookup.connectionGapCount=1,e=>e.lookup.fromRequiresSecondary=true,e=>e.automaticCases[0].design.designLengthMeters='9']){
    const f=fixture();mutate(f.evaluation);assert.equal(compareReferences(f.native,f.loaded,f.pairMap,f.evaluation).status,'FAIL');
  }
});
check('changed triangle topology and world point precision are detected',()=>{
  const f=fixture();f.object.fragments[0].triangleIndices=[0,2,1];f.evaluation.lookup.pathPoints[0][0]+=0.000001;
  const r=compareReferences(f.native,f.loaded,f.pairMap,f.evaluation);assert.equal(r.status,'FAIL');assert.ok(r.checks.some(value=>value.field.includes('triangleIndices')&&value.status==='FAIL'));
});
check('CLI creates fresh owned snapshot/receipt and preserves canonical geometry',async()=>{
  const f=fixture(),dir=path.join(scratch,'cli');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'synthetic-object.json'),f.partBytes);await fs.writeFile(path.join(dir,'receipt.json'),f.mainBytes);
  const result=JSON.parse(execFileSync(process.execPath,[path.join(root,'pathfinder-engine/tools/model-capture/normalize.mjs'),path.join(dir,'receipt.json'),'synthetic-project','synthetic-model'],{encoding:'utf8'}));
  const snapshot=await readJson(path.join(result.output,'snapshot.json'));assert.equal(snapshot.sha256,result.snapshotSha256);assert.equal(snapshot.value.objects[0].fragments[0].vertices[0][0],f.object.fragments[0].vertices[0][0]);
  await fs.writeFile(path.join(scratch,'interop-snapshot.json'),encode(snapshot.value));
});
after(async()=>{
  const output=path.join(root,'docs/pathfinder/evidence/pf2',`converted-normalizer-tests-${Date.now()}.json`);await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,encode({schemaVersion:'pathfinder.converted.normalizer-tests.v1',observedAt:new Date().toISOString(),scope:'synthetic-normalization-comparator-controls',status:results.every(value=>value.status==='PASS')?'PASS':'FAIL',passedChecks:results.filter(value=>value.status==='PASS').length,failedChecks:results.filter(value=>value.status==='FAIL').length,checks:results,scratch,
    realNativeConvertedParity:'BLOCKED: native entitlement unavailable; no actual paired reference capture.',limitations:['Synthetic raw transport and reference outputs only; not an actual Autodesk SDK capture or independent engineering oracle.']}),{flag:'wx'});
  console.log('Retained synthetic normalizer evidence: '+output+'; strict Model interop input: '+path.join(scratch,'interop-snapshot.json'));
});
