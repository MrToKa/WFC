import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {PROJECT_ID,MODEL_ID,canonical,hash,bytesHash,statements,diffRows,diffSnapshots,targetGuard,exclusive,classify,phaseGate,validatedCapture,retirementGuard} from './lib.mjs';
const clone=value=>structuredClone(value);
function base() {
  const groups=Object.fromEntries(Object.keys(statements).map(name=>[name,[]]));
  groups.settings=[{id:PROJECT_ID,connection_gap:'1',secondary_tray_length:'3',end_connection_length:'5',additional_bending_percent:'10',pf_settings_revision:'2'}];
  groups.selection=[{project_id:PROJECT_ID,active_model_version_id:MODEL_ID,selection_revision:'1'}];groups.registry=[{project_id:PROJECT_ID,registry_revision:'3'}];
  groups.planningArtifacts=[{id:'artifact',model_version_id:MODEL_ID,snapshot_sha256:'sha',content_fingerprint:'content'}];
  groups.cables=[{id:'cable',cable_id:1,cable_type_id:'type',mto:'Control',from_location:'FROM',to_location:'TO',cable_write_revision:'0',routing:null,design_length:null,install_length:77}];
  groups.aliases=[{normalized_alias:'FROM',location_id:'from'},{normalized_alias:'TO',location_id:'to'}];
  groups.bindings=[{location_id:'from',model_version_id:MODEL_ID,revision:'1',point:[0,0,0],artifact_id:null},{location_id:'to',model_version_id:MODEL_ID,revision:'1',point:[10,0,0],artifact_id:null}];
  return {groups,aux:{jobs:[],items:[],results:[],matches:[],events:[],models:[{id:MODEL_ID,state:'ready',health:'healthy',content_fingerprint:'content'}]}};
}
function addition(before=base()) {
  const after=clone(before),c=after.groups.cables[0],s=after.groups.settings[0],options={connectionToleranceMeters:1};
  const dependencies={schemaVersion:'pathfinder.dependencies.v1',engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1',projectId:PROJECT_ID,cableId:c.id,cableWriteRevision:'0',cableInputs:{fromLocation:c.from_location,toLocation:c.to_location,mto:c.mto,cableTypeId:c.cable_type_id},registryRevision:'3',model:{id:MODEL_ID,selectionRevision:'1',contentFingerprint:'content'},artifact:{id:'artifact',sha256:'sha'},settings:{revision:s.pf_settings_revision,connectionGap:'1',secondaryTrayLength:'3',endConnectionLength:'5',additionalBendingPercent:'10'},options,from:{locationId:'from',bindingRevision:'1',point:[0,0,0]},to:{locationId:'to',bindingRevision:'1',point:[10,0,0]}};
  const result={engineeringAccepted:false,route:{success:true,lengthMeters:35.30345579516123},design:{designLengthMeters:'45'},calculationMode:'design'},geometry={...dependencies};delete geometry.settings;delete geometry.registryRevision;delete geometry.cableWriteRevision;
  const item={job_id:'job',cable_id:'cable',state:'complete',status:'calculated',dependencies};
  const job={id:'job',kind:'calculate',actorFingerprint:'actor',loginFingerprint:'login',authority:{currentAdmin:true,currentLogin:true},state:'complete',completed:1,total:1,cancel_requested:false,options,timeout_ms:60000,request_hash:hash({timeoutMilliseconds:60000,items:[{id:'cable',dependencies,status:'ready',cableWriteRevision:'0'}]})};
  after.aux.jobs.push(job);after.aux.items.push(item);after.groups.proposals.push({id:'proposal',job_id:'job',cable_id:'cable',status:'calculated',dependencies,result,dependency_hash:hash(dependencies),geometry_hash:hash(geometry),proposal_hash:hash({dependencies,result})});return after;
}
function previewAddition() {
  const before=base();before.groups.aliases.push({normalized_alias:'=PF-DEMO-NETWORK-START',location_id:'from'},{normalized_alias:'=PF-DEMO-NETWORK-END',location_id:'to'});for(const binding of before.groups.bindings)binding.object_id=null;
  const after=clone(before),options={connectionToleranceMeters:1,secondaryDistanceMeters:2,preferVerticalApproach:true};
  const input={from:{name:'=PF-DEMO-NETWORK-START'},to:{name:'=PF-DEMO-NETWORK-END'},category:'Control',reverse:false,artifactId:'artifact',expectedSelectionRevision:'1',expectedSettingsRevision:'2',expectedRegistryRevision:'3',secondaryDistanceMeters:2,preferVerticalApproach:true};
  const d={schemaVersion:'pathfinder.preview.dependencies.v1',engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1',projectId:PROJECT_ID,modelVersionId:MODEL_ID,selectionRevision:'1',contentFingerprint:'content',artifactId:'artifact',snapshotSha256:'sha',registryRevision:'3',settings:{revision:'2',connectionGap:'1',secondaryTrayLength:'3',endConnectionLength:'5',additionalBendingPercent:'10'},options,input,from:{name:input.from.name,point:[0,0,0],source:'shared-location',locationId:'from',bindingRevision:'1',objectId:null},to:{name:input.to.name,point:[10,0,0],source:'shared-location',locationId:'to',bindingRevision:'1',objectId:null}};
  after.aux.jobs.push({id:'preview',kind:'preview',actorFingerprint:'actor',loginFingerprint:'login',authority:{currentAdmin:true,currentLogin:true},state:'complete',completed:1,total:1,cancel_requested:false,options,diagnostic_input:d,request_hash:hash({kind:'preview',dependencies:d})});
  after.aux.results.push({job_id:'preview',dependencies:d,stale_at_completion:false,result:{status:'calculated',route:{lengthMeters:35.30345579516123,connectionGapCount:4,connectionGapLengthMeters:0.9840583861033791},design:{designLengthMeters:'45'}}});
  return {before,after};
}
const assess=(before,after)=>classify(before,after,diffSnapshots(before,after),'actor');
test('canonical preserves array order and NULL while sorting object keys',()=>{assert.equal(canonical({b:null,a:[2,1]}),'{"a":[2,1],"b":null}');assert.notEqual(hash([2,1]),hash([1,2]));});
test('exact ordered12 statements match production source',async()=>{const source=await fs.readFile(new URL('../../server/pathfinder/lookupAudit.ts',import.meta.url),'utf8');const block=source.match(/const statements:Record<string,string>=\{([\s\S]*?)\n    \};/)[1];const actual=Function('return ({'+block+'})')();assert.deepEqual(statements,actual);});
test('row diff separates addition deletion NULL changes and column identity',()=>{const d=diffRows('cables',[{id:'a',x:null},{id:'b'}],[{id:'a',x:0},{id:'c'}]);assert.equal(d.added.length,1);assert.equal(d.removed.length,1);assert.deepEqual(d.changed[0].columns,['x']);});
test('duplicate row identity is refused',()=>assert.throws(()=>diffRows('cables',[{id:'a'},{id:'a'}],[]),/DUPLICATE/));
test('exact immutable fixture passes',()=>{const b=base();assert.equal(assess(b,clone(b)).status,'PASS');});
test('current fully attributed automatic proposal addition passes',()=>{const b=base();assert.equal(assess(b,addition(b)).status,'PASS');});
test('orphan added item on an old job fails attribution',()=>{const b=addition(),a=clone(b);a.aux.items.push({...a.aux.items[0],cable_id:'unrelated'});assert.equal(assess(b,a).status,'FAIL');});
test('old same-content planning artifact cannot authorize fresh proposal',()=>{const b=base();b.groups.planningArtifacts.push({...b.groups.planningArtifacts[0],id:'newer'});assert.equal(assess(b,addition(b)).status,'FAIL');});
test('standalone preview has exact current QA provenance and no cable items/proposals',()=>{const {before,after}=previewAddition();assert.equal(assess(before,after).status,'PASS');});
for(const [label,mutate]of Object.entries({model:d=>{d.modelVersionId='other';},inputArtifact:d=>{d.input.artifactId='other';},inputRevision:d=>{d.input.expectedSettingsRevision='old';},object:d=>{d.from.objectId='other';},endpointName:d=>{d.to.name='contradictory';},category:d=>{d.input.category='MV';}}))test('rejects contradictory preview '+label+' even with self-consistent hash',()=>{const{before,after}=previewAddition(),job=after.aux.jobs[0];mutate(job.diagnostic_input);job.request_hash=hash({kind:'preview',dependencies:job.diagnostic_input});assert.equal(assess(before,after).status,'FAIL');});
for(const [name,mutate] of Object.entries({authority:a=>{a.aux.jobs[0].authority.currentLogin=false;},actor:a=>{a.aux.jobs[0].actorFingerprint='foreign';},hash:a=>{a.groups.proposals[0].proposal_hash='wrong';},dependency:a=>{a.groups.proposals[0].dependencies.model.id='other';},scope:a=>{a.aux.items=[];},result:a=>{a.groups.proposals[0].result.design.designLengthMeters='46';},review:a=>{a.groups.reviews.push({id:'review'});},apply:a=>{a.groups.applies.push({id:'apply'});},cable:a=>{a.groups.cables[0].routing='CHANGED';},registry:a=>{a.groups.registry[0].registry_revision='4';}})) test('rejects '+name+' provenance/business change',()=>{const b=base(),a=addition(b);mutate(a);assert.equal(assess(b,a).status,'FAIL');});
test('existing proposal status is immutable',()=>{const b=addition(),a=clone(b);a.groups.proposals[0].status='stale';assert.equal(assess(b,a).status,'FAIL');});
test('ordered immutable group rows cannot silently reorder',()=>{const b=base(),a=clone(b);a.groups.aliases.reverse();assert.equal(assess(b,a).status,'FAIL');});
test('wrong target primary port or archive is refused',()=>{const s={port:5191,project:'wfc-pathfinder-local-012345abcdef',owner:'11111111-1111-1111-1111-111111111111',restore:{backupId:'3db9fa33-c10e-4646-82bc-fe99f3d8af35',inventoriesEqual:true}};targetGuard(s);for(const patch of [{port:5190},{project:'wfc-pathfinder-local'},{restore:{backupId:'other',inventoriesEqual:true}}])assert.throws(()=>targetGuard({...s,...patch}));});
test('exclusive evidence retains original bytes after overwrite refusal',async()=>{const file=path.join(os.tmpdir(),'pf-ui-exclusive-'+randomUUID()+'.json');try{await exclusive(file,Buffer.from('{"failure":null}'));await assert.rejects(()=>exclusive(file,'replacement'),{code:'EEXIST'});assert.equal(await fs.readFile(file,'utf8'),'{"failure":null}');}finally{await fs.unlink(file);}});
test('cleanup cannot precede complete durable evidence and parent disposition',()=>{const r={target:{owner:'own'},durable:true,status:'PASS',phases:['A0','A1','A2','A3']},d={decision:'retire-owned-target',targetOwner:'own'};retirementGuard(d,r);for(const x of [{...r,durable:false},{...r,status:'FAIL'},{...r,phases:['A0']}])assert.throws(()=>retirementGuard(d,x));assert.throws(()=>retirementGuard({...d,targetOwner:'foreign'},r));assert.throws(()=>retirementGuard(null,r));});
test('strict A1 accepts exactly one automatic calculate and rejects vacuous or preview observation',()=>{const b=base(),a=addition(b);assert.equal(phaseGate('A1',b,a,diffSnapshots(b,a)),true);assert.equal(phaseGate('A1',b,b,diffSnapshots(b,b)),false);a.aux.jobs[0].kind='preview';assert.equal(phaseGate('A1',b,a,diffSnapshots(b,a)),false);});
test('strict A2 accepts one preview/result and rejects an additional automatic calculation',()=>{const b=addition(),a=clone(b);a.aux.jobs.push({id:'preview',kind:'preview',state:'complete'});a.aux.results.push({job_id:'preview'});assert.equal(phaseGate('A2',b,a,diffSnapshots(b,a)),true);a.groups.proposals.push({...a.groups.proposals[0],id:'extra'});assert.equal(phaseGate('A2',b,a,diffSnapshots(b,a)),false);});
test('strict A3 Clear requires zero persisted changes',()=>{const b=addition(),a=clone(b);assert.equal(phaseGate('A3',b,a,diffSnapshots(b,a)),true);a.aux.jobs[0].cancel_requested=true;assert.equal(phaseGate('A3',b,a,diffSnapshots(b,a)),false);});
test('phase chain validates durable raw hash identity chronology and expected label',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pf-ui-chain-')),file=path.join(directory,'A0-test.private.json'),sidecar=file.replace('.private.json','.receipt.json');
  const target={owner:'own',apiId:'api',apiImage:'image'},modules={runner:'dll'},raw={capture:{phase:'A0',target},moduleHashes:modules,identity:{captured_at:'2026-01-01T00:00:00.000Z'}},bytes=Buffer.from(JSON.stringify(raw));
  const receipt={phase:'A0',status:'PASS',durable:true,target,raw:{file,bytes:bytes.length,sha256:bytesHash(bytes)},source:{modules}};
  const current={capture:{phase:'A1',target},moduleHashes:modules,identity:{captured_at:'2026-01-01T00:01:00.000Z'}};
  try {
    await exclusive(file,bytes);await exclusive(sidecar,JSON.stringify(receipt));assert.deepEqual(await validatedCapture(file,'A0',current),raw);
    await assert.rejects(()=>validatedCapture(file,'A1',current),/CHAIN/);
    await assert.rejects(()=>validatedCapture(file,'A0',{...current,capture:{target:{...target,apiId:'changed'}}}),/BINDING/);
    await assert.rejects(()=>validatedCapture(file,'A0',{...current,moduleHashes:{runner:'other'}}),/BINDING/);
    await assert.rejects(()=>validatedCapture(file,'A0',{...current,identity:raw.identity}),/ORDER/);
    await fs.writeFile(file,Buffer.concat([bytes,Buffer.from(' ')]));await assert.rejects(()=>validatedCapture(file,'A0',current),/CHAIN/);
  }finally{await fs.unlink(file);await fs.unlink(sidecar);await fs.rmdir(directory);}
});
