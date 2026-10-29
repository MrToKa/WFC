/** Focused actual SQL/HTTP checks. Execute only after an exclusive release on the owned local synthetic fixture. */
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { signAccessToken } from '../auth.js';
import { syntheticLookupSnapshot } from './lookupFixture.js';
import { pathFinderRoot,readSnapshot,snapshotFilename } from './storage.js';

type Row=Record<string,any>;
export async function runLookupIntegration(projectId:string) {
  assert.equal(process.env.PF_LOCAL_DEMO,'true','Explicit isolated local demo required');
  assert.equal(projectId,'54cfad40-bd12-41e9-ab24-d90bdaafc993','Only the already owned synthetic fixture is permitted');
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name,'wfc_pathfinder_local');
  assert.equal((await pool.query('SELECT fixture_id FROM pf_synthetic_projects WHERE project_id=$1',[projectId])).rows[0]?.fixture_id,'pf-local-straight-v1');
  const origin=process.env.PF_TEST_API_ORIGIN??'http://127.0.0.1:4000',webOrigin=process.env.PF_LOOKUP_TEST_WEB_ORIGIN??'http://web';
  const apiUrl=new URL(origin),webUrl=new URL(webOrigin);assert.equal(apiUrl.protocol,'http:');assert.ok(['127.0.0.1','localhost'].includes(apiUrl.hostname));assert.equal(apiUrl.port,'4000');assert.equal(apiUrl.pathname,'/');
  assert.equal(webUrl.protocol,'http:');assert.equal(webUrl.hostname,'web');assert.equal(webUrl.pathname,'/');assert.ok(!webUrl.port||webUrl.port==='80');
  const model=(await pool.query(`SELECT v.id,v.content_fingerprint,s.selection_revision::text FROM model_versions v JOIN project_model_selections s ON s.project_id=v.project_id AND s.active_model_version_id=v.id
    WHERE v.project_id=$1 AND v.state='ready' AND v.health='healthy'`,[projectId])).rows[0];assert.ok(model,'An actually imported ready fixture model is required');
  const originalGap=(await pool.query('SELECT connection_gap::text FROM projects WHERE id=$1',[projectId])).rows[0].connection_gap;
  const actorId=randomUUID(),email=actorId+'@pf-lookup-integration.invalid',checks:Row[]=[],cleanup:Row[]=[];
  await pool.query('INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,$2,$3,true,$4)',[actorId,email,'Owned isolated lookup integration; no usable password.','admin']);
  const token=signAccessToken(actorId,email,true).token,loginId=(jwt.decode(token) as jwt.JwtPayload).jti!,base=`/api/projects/${projectId}/pathfinder`;
  const snapshot=syntheticLookupSnapshot(projectId,model.id,model.content_fingerprint);let forward:Row|undefined;
  async function request(method:string,url:string,body?:unknown,bearer=token,target=origin) {
    const response=await fetch(target+url,{method,headers:{Authorization:`Bearer ${bearer}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    let value:Row={};if(response.status!==204) {const text=await response.text();try {value=JSON.parse(text);}catch {value={message:text.slice(0,500)};}}return {status:response.status,value};
  }
  async function api(method:string,url:string,body?:unknown,target=origin) {const response=await request(method,url,body,token,target);assert.ok(response.status>=200&&response.status<300,`${method} ${url}: ${response.status} ${response.value.code??''}`);return response.value;}
  async function waitFor<T>(action:()=>Promise<T|undefined>,milliseconds=30000):Promise<T> {const end=Date.now()+milliseconds;while(Date.now()<end){const value=await action();if(value!==undefined)return value;await delay(50);}throw Error('Owned lookup did not settle before its deadline.');}
  async function lookup(reverse=false,scope=snapshot,routeText='/BC001') {
    const accepted=await api('POST',base+'/lookups',{routeText,reverse,expectedSelectionRevision:model.selection_revision,snapshot:scope});
    return waitFor(async()=>{const job=await api('GET',base+'/lookups/'+accepted.jobId);if(['failed','cancelled'].includes(job.status))throw Error('Lookup stopped: '+job.failure);return job.status==='complete'?job:undefined;});
  }
  async function invariants() {
    return (await pool.query(`SELECT (SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1) AS registry,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'sha',snapshot_sha256) ORDER BY created_at,id),'[]') FROM pf_artifacts WHERE project_id=$1 AND purpose='planning') AS planning,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'routing',routing,'design',design_length,'install',install_length,'revision',cable_write_revision) ORDER BY id),'[]') FROM cables WHERE project_id=$1) AS cables,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'revision',revision) ORDER BY id),'[]') FROM pf_locations WHERE project_id=$1) AS locations,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('location',location_id,'model',model_version_id,'revision',revision,'point',point,'artifact',artifact_id) ORDER BY location_id,model_version_id),'[]') FROM pf_location_bindings WHERE project_id=$1) AS bindings,
      (SELECT count(*)::int FROM pf_apply_receipts WHERE project_id=$1) AS applies`,[projectId])).rows[0];
  }
  async function test(name:string,run:()=>Promise<unknown>) {const started=Date.now();try{const details=await run();checks.push({name,status:'PASS',milliseconds:Date.now()-started,...(details===undefined?{}:{details})});}catch(error){checks.push({name,status:'FAIL',milliseconds:Date.now()-started,message:error instanceof Error?error.message:'Unknown failure'});}}
  async function headersOnly(target:string,length:number,bearer?:string) {
    return new Promise<number>((resolve,reject)=>{const request=http.request(target+base+'/lookups',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':length,Connection:'close',...(bearer?{Authorization:'Bearer '+bearer}:{})}},response=>{const status=response.statusCode!;response.resume();response.once('end',()=>{resolve(status);request.destroy();});});request.on('error',reject);request.setTimeout(5000,()=>request.destroy(Error('No pre-body response')));request.flushHeaders();});
  }
  const before=await invariants();
  try {
    await test('private parser returns distinct canonical capture scope while preserving original ordered lookup text',async()=>{
      const value=await api('POST',base+'/lookups/plan',{routeText:'/secondary/BC001/BC001',expectedSelectionRevision:model.selection_revision});assert.deepEqual(value.routeCodes,['/BC001']);assert.equal(value.connectionGap,originalGap);assert.equal(value.selectionRevision,model.selection_revision);
      assert.equal((await request('POST',base+'/lookups/plan',{routeText:'/SECONDARY',expectedSelectionRevision:model.selection_revision})).status,400);return value;
    });
    await test('actual API and nginx reject anonymous and oversized capture headers before body upload',async()=>{
      const values={apiAnonymous:await headersOnly(origin,11*1024*1024),webAnonymous:await headersOnly(webOrigin,11*1024*1024),apiOversize:await headersOnly(origin,256*1024*1024+1,token),webOversize:await headersOnly(webOrigin,256*1024*1024+1,token)};
      assert.deepEqual(values,{apiAnonymous:401,webAnonymous:401,apiOversize:413,webOversize:413});return values;
    });
    await test('independent capture computes exact 10m lookup without planning promotion, endpoint matching or cable writes',async()=>{
      forward=await lookup();assert.equal(forward.kind,'lookup');assert.equal(forward.result.status,'calculated');assert.equal(forward.result.route.lengthMeters,10);assert.equal(forward.result.route.routeText,'/BC001');assert.equal(forward.result.design,null);assert.equal(forward.result.engineeringAccepted,false);assert.equal(forward.result.acceptanceScope,'diagnostic-lookup');assert.equal(forward.result.connectionGap,originalGap);assert.equal(forward.result.stale,false);assert.equal(forward.result.diagnostics.geometryLeavesUsed,1);assert.equal(forward.result.lookupScope.resolvedOwnerCount,1);assert.equal(forward.result.lookupScope.resolvedLeafCount,1);
      assert.deepEqual(await invariants(),before);const job=(await pool.query('SELECT diagnostic_input FROM pf_jobs WHERE id=$1',[forward.id])).rows[0];const artifact=(await pool.query('SELECT id,purpose,capture,snapshot_sha256 FROM pf_artifacts WHERE project_id=$1 AND id=$2',[projectId,job.diagnostic_input.artifactId])).rows[0];assert.equal(artifact.purpose,'lookup');assert.deepEqual(artifact.capture.lookupRouteCodes,['/BC001']);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM pf_job_items WHERE job_id=$1',[forward.id])).rows[0].count,0);
      assert.equal((await request('GET',base+'/proposals/'+forward.id)).status,404);assert.equal((await request('POST',base+'/proposals/'+forward.id+'/review',{expectedProposalHash:'a'.repeat(64)})).status,404);
      return {jobId:forward.id,artifactId:artifact.id,snapshotSha256:artifact.snapshot_sha256,lengthMeters:10,diagnostics:forward.result.diagnostics,lookupScope:forward.result.lookupScope};
    });
    await test('Reverse and repeated capture reuse exact lookup bytes and preserve metric semantics',async()=>{
      assert.ok(forward);const reverse=await lookup(true);assert.equal(reverse.result.route.lengthMeters,10);assert.deepEqual(reverse.result.route.points,[...forward.result.route.points].reverse());assert.equal(reverse.result.connectionGap,originalGap);
      const artifacts=(await pool.query("SELECT id FROM pf_artifacts WHERE project_id=$1 AND created_by=$2 AND purpose='lookup'",[projectId,actorId])).rows;assert.equal(artifacts.length,1);return {reverseJob:reverse.id,artifacts:artifacts.map(value=>value.id),points:reverse.result.route.points};
    });
    await test('native SECONDARY and adjacent duplicate lookup semantics retain 10m geometry without design allowances',async()=>{
      const result=await lookup(false,snapshot,'/SECONDARY/BC001/BC001');assert.equal(result.result.route.lengthMeters,10);assert.equal(result.result.design,null);assert.equal(result.result.route.routeText,'/BC001');return {jobId:result.id,lengthMeters:result.result.route.lengthMeters};
    });
    await test('bounded lookup capture passes nginx and API limits beyond the prior 10 MiB transport ceiling',async()=>{
      const large=structuredClone(snapshot);large.objects[0].fragments[0].vertices=Array.from({length:1_200_000},(_,index)=>index%2?[10,.5,1]:[0,-.5,0]);
      const body={routeText:'/BC001',reverse:false,expectedSelectionRevision:model.selection_revision,snapshot:large},bytes=Buffer.byteLength(JSON.stringify(body));assert.ok(bytes>10*1024*1024);const accepted=await api('POST',base+'/lookups',body,webOrigin);
      const result=await waitFor(async()=>{const job=await api('GET',base+'/lookups/'+accepted.jobId);if(job.status==='failed')throw Error('Large capture failed: '+job.failure);return job.status==='complete'?job:undefined;},60000);assert.equal(result.result.route.lengthMeters,10);return {jobId:result.id,bytes};
    });
    await test('lookup scope cannot become a planning artifact or a standalone calculate request',async()=>{
      const current=await api('GET',base+'/state');assert.equal((await request('POST',base+'/artifacts',{modelVersionId:model.id,expectedSelectionRevision:model.selection_revision,expectedRegistryRevision:current.registryRevision,snapshot})).status,400);
      const artifact=(await pool.query("SELECT id FROM pf_artifacts WHERE project_id=$1 AND created_by=$2 AND purpose='lookup' ORDER BY created_at LIMIT 1",[projectId,actorId])).rows[0];assert.ok(artifact);
      const response=await request('POST',base+'/previews',{from:{name:'Start',point:[0,0,.5]},to:{name:'End',point:[10,0,.5]},category:'Control',reverse:false,artifactId:artifact.id,expectedSelectionRevision:model.selection_revision,expectedRegistryRevision:current.registryRevision,expectedSettingsRevision:current.settings.revision});assert.equal(response.status,409);assert.equal(response.value.code,'MODEL_INDEX_CONFLICT');return {lookupArtifactId:artifact.id};
    });
    await test('project/model identity, client gap and current selection overrides fail before new storage',async()=>{
      const count=(await pool.query('SELECT count(*)::int AS count FROM pf_artifacts WHERE created_by=$1',[actorId])).rows[0].count;
      for(const modelPatch of [{projectId:randomUUID()},{modelVersionId:randomUUID()},{contentSha256:'f'.repeat(64)}]){const wrong=structuredClone(snapshot);Object.assign(wrong.model,modelPatch);assert.equal((await request('POST',base+'/lookups',{routeText:'/BC001',reverse:false,expectedSelectionRevision:model.selection_revision,snapshot:wrong})).status,409);}
      assert.equal((await request('POST',base+'/lookups',{routeText:'/BC001',reverse:false,expectedSelectionRevision:model.selection_revision,snapshot,connectionGap:99})).status,400);
      assert.equal((await request('POST',base+'/lookups',{routeText:'/BC001',reverse:false,expectedSelectionRevision:'9223372036854775807',snapshot})).status,409);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM pf_artifacts WHERE created_by=$1',[actorId])).rows[0].count,count);
    });
    await test('current administrator and login revocation remain enforced on independent lookup',async()=>{
      await pool.query("UPDATE users SET is_admin=false,role='engineer' WHERE id=$1",[actorId]);try{assert.equal((await request('POST',base+'/lookups/plan',{routeText:'/BC001',expectedSelectionRevision:model.selection_revision})).status,403);assert.equal(await headersOnly(webOrigin,11*1024*1024,token),403);}finally{await pool.query("UPDATE users SET is_admin=true,role='admin' WHERE id=$1",[actorId]);}
      await pool.query('UPDATE viewer_login_bindings SET revoked_at=NOW() WHERE login_id=$1 AND user_id=$2',[loginId,actorId]);try{assert.equal((await request('POST',base+'/lookups/plan',{routeText:'/BC001',expectedSelectionRevision:model.selection_revision})).status,401);assert.equal(await headersOnly(webOrigin,11*1024*1024,token),401);}finally{await pool.query('UPDATE viewer_login_bindings SET revoked_at=NULL WHERE login_id=$1 AND user_id=$2',[loginId,actorId]);}
    });
    await test('completed lookup exposes frozen used gap and becomes stale after Project Details changes',async()=>{
      assert.ok(forward);await pool.query('UPDATE projects SET connection_gap=$2 WHERE id=$1',[projectId,originalGap==='1'?'0.5':'1']);const result=await api('GET',base+'/lookups/'+forward.id);assert.equal(result.result.stale,true);assert.equal(result.result.connectionGap,originalGap);return {jobId:forward.id,frozenGap:result.result.connectionGap,stale:true};
    });
  } finally {
    await pool.query("UPDATE users SET is_admin=true,role='admin' WHERE id=$1",[actorId]);await pool.query('UPDATE projects SET connection_gap=$2 WHERE id=$1',[projectId,originalGap]);
    await pool.query("UPDATE pf_jobs SET cancel_requested=true WHERE requested_by=$1 AND state IN ('queued','running')",[actorId]);
    await waitFor(async()=>(await pool.query("SELECT 1 FROM pf_jobs WHERE requested_by=$1 AND state='running'",[actorId])).rows.length?undefined:true,15000).catch(error=>cleanup.push({name:'owned jobs stopped',status:'FAIL',message:error.message}));
    await pool.query('DELETE FROM pf_jobs WHERE requested_by=$1',[actorId]);
    const artifacts=(await pool.query("DELETE FROM pf_artifacts WHERE project_id=$1 AND created_by=$2 AND purpose='lookup' RETURNING id,snapshot_sha256",[projectId,actorId])).rows;
    for(const artifact of artifacts){await readSnapshot(artifact.id,artifact.snapshot_sha256);await fs.unlink(await snapshotFilename(artifact.id));}
    await pool.query('DELETE FROM viewer_login_bindings WHERE user_id=$1',[actorId]);await pool.query('DELETE FROM users WHERE id=$1',[actorId]);
    const after=await invariants();assert.deepEqual(after,before);assert.equal((await pool.query('SELECT count(*)::int AS count FROM pf_jobs WHERE requested_by=$1',[actorId])).rows[0].count,0);
    cleanup.push({name:'owned actor/login/jobs/results/lookup artifacts and exact snapshot files removed; planning/registry/bindings/cables/Apply unchanged; Details gap restored',status:'PASS',artifactsRemoved:artifacts.map(value=>value.id)});
  }
  const receipt={schemaVersion:'pathfinder.lookup.integration.v1',recordedAtUtc:new Date().toISOString(),projectId,modelVersionId:model.id,scope:'separate owned synthetic 10m fixture; adapter DTO uses converted shape with every engineering/native proof false',
    status:checks.every(value=>value.status==='PASS')&&cleanup.every(value=>value.status==='PASS')?'PASS':'FAIL',passed:checks.filter(value=>value.status==='PASS').length,total:checks.length,checks,cleanup,
    noPlanningArtifactLiveCase:'NOT_RUN: this fixture has existing immutable planning history. Source tests independently prove no planning artifact/registry query is required. No history was relabeled or deleted.',
    nativeParity:'NOT_PERFORMED; no user engineering acceptance or real-model Apply',sourceSha256:createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex')};
  const directory=path.join(await pathFinderRoot(),'integration');await fs.mkdir(directory,{recursive:true});const evidence=path.join(directory,'lookup-integration-'+randomUUID()+'.json');await fs.writeFile(evidence,JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify({...receipt,evidence}));return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const receipt=await runLookupIntegration(process.argv[2]);process.exitCode=receipt.status==='PASS'?0:1;}catch(error){console.error(error instanceof Error?error.message:'Focused owned lookup integration failed.');process.exitCode=1;}finally{await pool.end();}}
