import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { load,ownership,ROOT,contained } from '../pathfinder-local/runtime-lib.mjs';
import { createDocker } from '../operations/docker.mjs';
import { assertCanonicalPath } from '../operations/archives.mjs';
import { PROJECT_ID,MODEL_ID,statements,hash,bytesHash,exclusive,targetGuard,diffSnapshots,classify,phaseGate,validatedCapture,fail } from './lib.mjs';

const {values}=parseArgs({strict:true,options:{runtime:{type:'string'},phase:{type:'string'},'evidence-root':{type:'string'},baseline:{type:'string'},previous:{type:'string'}}});
if(!values.runtime||!['A0','A1','A2','A3'].includes(values.phase)||!values['evidence-root'])fail('UI_AUDIT_ARGUMENT');
const failureContext={phase:values.phase};
try {
const state=await load(values.runtime);targetGuard(state);
const directory=path.resolve(values['evidence-root']);
if(!contained(path.join(ROOT,'pathfinder-engine/.scratch'),directory))fail('UI_AUDIT_PRIVATE_PATH');
await assertCanonicalPath(path.dirname(directory),{directory:true});
if(values.phase==='A0') {
  await fs.mkdir(directory,{mode:0o700});
  await exclusive(path.join(directory,'owner.json'),JSON.stringify({format:'WFC-PF-UI-PRESERVATION',owner:state.owner,project:state.project,runtime:state.runtime}));
} else {
  await assertCanonicalPath(directory,{directory:true});
  const marker=JSON.parse(await fs.readFile(path.join(directory,'owner.json'),'utf8'));
  if(marker.format!=='WFC-PF-UI-PRESERVATION'||marker.owner!==state.owner||marker.runtime!==state.runtime)fail('UI_AUDIT_EVIDENCE_OWNER');
  if(!values.baseline||!values.previous)fail('UI_AUDIT_BASELINES_REQUIRED');
}
const docker=await createDocker(),resources=await ownership(state),api=resources.containers.find(row=>row.role==='api');
if(!api?.running)fail('UI_AUDIT_API_REQUIRED');
const inspect=await docker.inspect(api.id);
if(!inspect.Config.Env.includes('PF_ENGINE_MODE=session'))fail('UI_AUDIT_SESSION_REQUIRED');
const targetIdentity={owner:state.owner,project:state.project,runtime:state.runtime,apiId:api.id,apiImage:api.image,webImage:resources.containers.find(row=>row.role==='web')?.image};
const program=`import {pool} from '/app/server/dist/server/db.js';import {hash} from '/app/server/dist/server/pathfinder/dependencies.js';import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
const project=${JSON.stringify(PROJECT_ID)},statements=${JSON.stringify(statements)},client=await pool.connect();
try {await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL statement_timeout='10s'");await client.query("SET LOCAL lock_timeout='2s'");
const identity=(await client.query('SELECT current_database() AS database,inet_server_addr()::text AS address,inet_server_port() AS port,pg_current_snapshot()::text AS snapshot,transaction_timestamp() AS captured_at')).rows[0];if(identity.database!=='wfc_pathfinder_local')throw Error('WRONG_DATABASE');
const groups={},summary={};for(const [name,sql] of Object.entries(statements)){const rows=(await client.query(sql,[project])).rows;if(rows.length>20000)throw Error('ROW_BUDGET');groups[name]=rows;summary[name]={count:rows.length,sha256:hash(JSON.parse(JSON.stringify(rows)))}};
const queries={
jobs:"SELECT j.*,EXISTS(SELECT 1 FROM users u WHERE u.id=j.requested_by AND u.is_admin) AS current_admin,EXISTS(SELECT 1 FROM viewer_login_bindings l WHERE l.login_id=j.login_id AND l.user_id=j.requested_by AND l.revoked_at IS NULL AND l.expires_at=j.login_expires_at AND l.expires_at>NOW()) AND j.login_expires_at>NOW() AS current_login FROM pf_jobs j WHERE j.project_id=$1 ORDER BY j.id LIMIT 20001",
items:'SELECT * FROM pf_job_items WHERE project_id=$1 ORDER BY job_id,cable_id LIMIT 20001',
results:'SELECT * FROM pf_lookup_results WHERE project_id=$1 ORDER BY job_id LIMIT 20001',
matches:'SELECT * FROM pf_location_matches WHERE project_id=$1 ORDER BY location_id,model_version_id LIMIT 20001',
events:'SELECT id,project_id,location_id,model_version_id,kind,registry_revision,event_data,created_at FROM pf_location_events WHERE project_id=$1 ORDER BY id LIMIT 20001',
models:'SELECT id,project_id,state,health,content_fingerprint FROM model_versions WHERE project_id=$1 ORDER BY id LIMIT 20001'};
const aux={};for(const [name,sql]of Object.entries(queries)){let rows=(await client.query(sql,[project])).rows;if(rows.length>20000)throw Error('ROW_BUDGET');if(name==='jobs')rows=rows.map(row=>{const {requested_by,login_id,login_expires_at,owner_token,current_admin,current_login,...safe}=row;return {...safe,actorFingerprint:hash('actor:'+requested_by),loginFingerprint:hash('actor-login:'+requested_by+':'+login_id),ownerFingerprint:owner_token?hash('owner:'+owner_token):null,authority:{currentAdmin:current_admin,currentLogin:current_login}}});aux[name]=rows;}
await client.query('COMMIT');const hashes={};for(const file of ['server/dist/server/pathfinder/worker.js','server/dist/server/pathfinder/engineSession.js'])hashes[file]=createHash('sha256').update(await fs.readFile('/app/'+file)).digest('hex');hashes.runner=createHash('sha256').update(await fs.readFile(process.env.PF_ENGINE_DLL)).digest('hex');
console.log(JSON.stringify({schemaVersion:'pathfinder.ui-preservation.snapshot.v1',capture:${JSON.stringify({phase:values.phase,target:targetIdentity})},identity,projectId:project,groups,summary,aux,moduleHashes:hashes}));
}catch(error){await client.query('ROLLBACK').catch(()=>undefined);console.log(JSON.stringify({status:'FAIL',code:/^[A-Z0-9_]+$/.test(error.code??error.message)?error.code??error.message:'AUDIT_FAILED'}));}finally{client.release();await pool.end();}`;
const stamp=Date.now()+'-'+randomUUID().slice(0,8),prefix=values.phase+'-'+stamp;
const raw=await docker.command(['exec',api.id,'node','--input-type=module','-e',program],{maxBytes:32*1024**2,signal:AbortSignal.timeout(90000)});
// Durability precedes JSON/schema/diff/provenance assertions. Failure never retires the target.
const rawFile=path.join(directory,prefix+'.private.json'),rawRecord=await exclusive(rawFile,raw);
failureContext.raw={file:rawFile,...rawRecord};
const snapshot=JSON.parse(raw.toString('utf8'));
if(snapshot.schemaVersion!=='pathfinder.ui-preservation.snapshot.v1')fail('UI_AUDIT_CAPTURE_FAILED_RETAINED');
const receipt={schemaVersion:'pathfinder.ui-preservation.capture.v1',phase:values.phase,recordedAt:new Date().toISOString(),status:'FAIL',target:targetIdentity,source:{head:(await import('node:child_process')).execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,windowsHide:true,encoding:'utf8'}).trim(),modules:snapshot.moduleHashes},raw:{file:rawFile,...rawRecord},summary:snapshot.summary,auxCounts:Object.fromEntries(Object.entries(snapshot.aux).map(([name,rows])=>[name,rows.length])),durable:true};
receipt.source.tools=Object.fromEntries(await Promise.all(['capture.mjs','lib.mjs','lib.test.mjs','quiesce.mjs','retire.mjs'].map(async name=>[name,bytesHash(await fs.readFile(new URL(name,import.meta.url)))])));
const baselineChecks=[snapshot.projectId===PROJECT_ID,snapshot.groups.selection.length===1,snapshot.groups.selection[0].active_model_version_id===MODEL_ID,snapshot.groups.settings.length===1,snapshot.groups.settings[0].connection_gap==='1',snapshot.groups.settings[0].secondary_tray_length==='3',snapshot.groups.settings[0].end_connection_length==='5',snapshot.groups.settings[0].additional_bending_percent==='10',snapshot.groups.cables.length===1];
receipt.preconditions=baselineChecks.every(Boolean)?'PASS':'FAIL';
if(values.phase!=='A0') {
  let previous,previousDiff;
  for(const [label,file]of [['fromA0',values.baseline],['fromPrevious',values.previous]]){
    await assertCanonicalPath(file);if(!contained(directory,path.resolve(file)))fail('UI_AUDIT_BASELINE_OUTSIDE_OWNER');
    const expected=label==='fromA0'?'A0':{A1:'A0',A2:'A1',A3:'A2'}[values.phase];
    const before=await validatedCapture(path.resolve(file),expected,snapshot),diff=diffSnapshots(before,snapshot),diffFile=path.join(directory,prefix+'-'+label+'.diff.private.json');
    const difference=await exclusive(diffFile,JSON.stringify(diff));
    (failureContext.differences??=[]).push({file:diffFile,...difference});
    receipt[label]={difference:{file:diffFile,...difference},...classify(before,snapshot,diff,hash('actor:'+state.demo.adminUserId))};
    if(label==='fromPrevious'){previous=before;previousDiff=diff;}
  }
  receipt.phaseShape=phaseGate(values.phase,previous,snapshot,previousDiff);
  receipt.status=receipt.preconditions==='PASS'&&receipt.fromA0.status==='PASS'&&receipt.fromPrevious.status==='PASS'&&receipt.phaseShape?'PASS':'FAIL';
} else receipt.status=receipt.preconditions;
const privateReceipt=path.join(directory,prefix+'.receipt.json');await exclusive(privateReceipt,JSON.stringify(receipt,null,2));
const publicDirectory=path.join(ROOT,'docs/pathfinder/evidence/ui-preservation');await fs.mkdir(publicDirectory,{recursive:true});
const publicFile=path.join(publicDirectory,prefix+'.json');await exclusive(publicFile,JSON.stringify(receipt,null,2));
console.log(JSON.stringify({status:receipt.status,phase:values.phase,rawFile,receipt:publicFile,rawSha256:rawRecord.sha256}));
if(receipt.status!=='PASS')process.exitCode=1;
}catch(error){
  const publicDirectory=path.join(ROOT,'docs/pathfinder/evidence/ui-preservation');await fs.mkdir(publicDirectory,{recursive:true});
  const file=path.join(publicDirectory,'capture-failure-'+Date.now()+'-'+randomUUID().slice(0,8)+'.json');
  const code=/^[A-Z0-9_]+$/.test(error.code??error.message)?error.code??error.message:'UI_AUDIT_CAPTURE_ERROR';
  await exclusive(file,JSON.stringify({schemaVersion:'pathfinder.ui-preservation.failure.v1',status:'FAIL',recordedAt:new Date().toISOString(),code,...failureContext,targetRetired:false},null,2));
  console.log(JSON.stringify({status:'FAIL',code,receipt:file,targetRetired:false}));process.exitCode=1;
}
