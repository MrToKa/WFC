import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {load,ownership,ROOT,contained} from '../pathfinder-local/runtime-lib.mjs';
import {createDocker} from '../operations/docker.mjs';
import {assertCanonicalPath} from '../operations/archives.mjs';
import {PROJECT_ID,statements,hash,exclusive,targetGuard,fail} from './lib.mjs';
const {values}=parseArgs({strict:true,options:{runtime:{type:'string'},'evidence-root':{type:'string'}}});
if(!values.runtime||!values['evidence-root'])fail('UI_QUIET_ARGUMENT');
const failureContext={observations:[]};
try {
const target=await load(values.runtime);targetGuard(target);
const directory=path.resolve(values['evidence-root']);if(!contained(path.join(ROOT,'pathfinder-engine/.scratch'),directory))fail('UI_QUIET_EVIDENCE_PATH');await assertCanonicalPath(directory,{directory:true});
const marker=JSON.parse(await fs.readFile(path.join(directory,'owner.json'),'utf8'));if(marker.format!=='WFC-PF-UI-PRESERVATION'||marker.owner!==target.owner||marker.project!==target.project||marker.runtime!==target.runtime)fail('UI_QUIET_EVIDENCE_OWNER');
const docker=await createDocker(),resources=await ownership(target),api=resources.containers.find(row=>row.role==='api');if(!api?.running)fail('UI_QUIET_API');
const program=`import{pool}from'/app/server/dist/server/db.js';import{hash}from'/app/server/dist/server/pathfinder/dependencies.js';const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET LOCAL statement_timeout='5s'");const summary={};for(const[n,q]of Object.entries(${JSON.stringify(statements)})){const r=(await c.query(q,[${JSON.stringify(PROJECT_ID)}])).rows;if(r.length>20000)throw Error('ROW_BUDGET');summary[n]={count:r.length,sha256:hash(JSON.parse(JSON.stringify(r)))}};const jobs=(await c.query("SELECT id,kind,state,total,completed,cancel_requested,request_hash,updated_at FROM pf_jobs WHERE project_id=$1 ORDER BY id LIMIT 20001",[${JSON.stringify(PROJECT_ID)}])).rows,items=(await c.query('SELECT job_id,cable_id,state,status FROM pf_job_items WHERE project_id=$1 ORDER BY job_id,cable_id LIMIT 20001',[${JSON.stringify(PROJECT_ID)}])).rows,results=(await c.query('SELECT job_id,result,stale_at_completion FROM pf_lookup_results WHERE project_id=$1 ORDER BY job_id LIMIT 20001',[${JSON.stringify(PROJECT_ID)}])).rows;if(Math.max(jobs.length,items.length,results.length)>20000)throw Error('ROW_BUDGET');await c.query('COMMIT');console.log(JSON.stringify({status:'PASS',summary,auxSha256:hash(JSON.parse(JSON.stringify({jobs,items,results}))),pendingJobs:jobs.filter(j=>['queued','running'].includes(j.state)).map(j=>j.id),pendingItems:items.filter(i=>['waiting','running'].includes(i.state)).map(i=>({jobId:i.job_id,cableId:i.cable_id}))}));}catch(e){await c.query('ROLLBACK').catch(()=>{});console.log(JSON.stringify({status:'FAIL'}));}finally{c.release();await pool.end();}`;
const started=Date.now(),observations=failureContext.observations;let stableSince=null,lastHash=null,status='FAIL';
while(Date.now()-started<90000){
  const raw=await docker.command(['exec',api.id,'node','--input-type=module','-e',program],{maxBytes:1024**2,signal:AbortSignal.timeout(15000)});
  const observed=Date.now(),rawFile=path.join(directory,'quiet-'+observed+'.private.json'),record=await exclusive(rawFile,raw);
  failureContext.raw={file:rawFile,...record};
  const value=JSON.parse(raw),digest=hash({summary:value.summary,auxSha256:value.auxSha256});
  const okay=value.status==='PASS'&&!value.pendingJobs.length&&!value.pendingItems.length;
  if(!okay||digest!==lastHash)stableSince=okay?observed:null;
  lastHash=digest;observations.push({observedAt:new Date(observed).toISOString(),file:rawFile,...record,quiet:okay,stateSha256:digest});
  if(okay&&observed-stableSince>=16500){status='PASS';break;}
  await new Promise(resolve=>setTimeout(resolve,2000));
}
const final=await ownership(target);if(!final.containers.some(row=>row.id===api.id&&row.running))status='FAIL';
const receipt={schemaVersion:'pathfinder.ui-preservation.quiescence.v1',status,recordedAt:new Date().toISOString(),target:{owner:target.owner,apiId:api.id},scope:'Observed stable read-only workflow/job state across >15-second automatic scan cadence; no permanent-silence claim.',durationMilliseconds:Date.now()-started,stableMilliseconds:stableSince===null?0:Date.now()-stableSince,observations,targetRetired:false};
const file=path.join(ROOT,'docs/pathfinder/evidence/ui-preservation','quiet-'+Date.now()+'.json');await exclusive(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify({status,receipt:file}));if(status!=='PASS')process.exitCode=1;
}catch(error){
  const directory=path.join(ROOT,'docs/pathfinder/evidence/ui-preservation');await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'quiet-failure-'+Date.now()+'-'+randomUUID().slice(0,8)+'.json');
  const code=/^[A-Z0-9_]+$/.test(error.code??error.message)?error.code??error.message:'UI_QUIET_FAILED';await exclusive(file,JSON.stringify({schemaVersion:'pathfinder.ui-preservation.quiescence.v1',status:'FAIL',recordedAt:new Date().toISOString(),code,...failureContext,targetRetired:false},null,2));
  console.log(JSON.stringify({status:'FAIL',code,receipt:file,targetRetired:false}));process.exitCode=1;
}
