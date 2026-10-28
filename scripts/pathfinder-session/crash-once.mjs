import fs from 'node:fs/promises';
import { load, ownership, request, demoLogin } from '../pathfinder-local/runtime-lib.mjs';
import { createDocker } from '../operations/docker.mjs';
import { parseOutput, fail, sha256, unfinishedBatch } from './lib.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const literal=id=>{if(!UUID.test(id))fail('SESSION_CRASH_UUID');return "'"+id+"'";};
const target=await load(process.argv[2]),oldJob=process.argv[3];literal(oldJob);
if(process.argv.length!==4||target.port!==5191||target.project==='wfc-pathfinder-local'||!target.restore?.inventoriesEqual)fail('SESSION_CRASH_EXTRA_TARGET');
const docker=await createDocker(),resources=await ownership(target),api=resources.containers.find(c=>c.role==='api'),pg=resources.containers.find(c=>c.role==='postgres'),projectId=target.syntheticDemo.projectId;
const receipt={schemaVersion:'pathfinder.session.crash-once.v1',status:'FAIL',startedAt:new Date().toISOString(),targetProject:target.project,apiId:api.id,image:api.image,oldJobId:oldJob,scope:'One explicit new force job reusing exactly64 owned prior fixture cables. Parallel read-only SQL/process observations; no delay, lease edit or hidden calculation replay.',checks:[]};
const check=(name,value,details={})=>{receipt.checks.push({...details,name,status:value?'PASS':'FAIL'});if(!value)fail('SESSION_CRASH_'+name.toUpperCase().replaceAll('-','_'));};
async function sql(query){return parseOutput(await docker.command(['exec',pg.id,'psql','--no-password','--no-psqlrc','--quiet','--tuples-only','--no-align','--set=ON_ERROR_STOP=1','-U','pf_local','-d','wfc_pathfinder_local','-c',"SET statement_timeout='10s'; "+query],{maxBytes:1024**2,signal:AbortSignal.timeout(15000)}),1024**2);}
async function top(){const v=await docker.request('GET','/containers/'+api.id+'/top?ps_args='+encodeURIComponent('-eo pid,ppid,comm'));return v.Processes.map(r=>({pid:Number(r[0]),parentPid:Number(r[1]),command:r[2]}));}
const pair=rows=>rows.length===2&&rows.filter(row=>rows.some(parent=>parent.pid===row.parentPid)).length===1;
async function health(){for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:5191/health',{signal:AbortSignal.timeout(2000)})).status===200)return true;}catch{}await new Promise(r=>setTimeout(r,100));}return false;}
const observationSelect="'state',state,'completed',completed,'total',total,'attempts',attempts,'ownerToken',owner_token::text,'completeItems',(SELECT COUNT(*) FROM pf_job_items WHERE job_id=j.id AND state='complete'),'runningItems',(SELECT COUNT(*) FROM pf_job_items WHERE job_id=j.id AND state='running'),'waitingItems',(SELECT COUNT(*) FROM pf_job_items WHERE job_id=j.id AND state='waiting')";
const publicProgress=value=>{const {ownerToken,...fields}=value;return {...fields,ownerTokenFingerprint:sha256(String(ownerToken))};};
let token,jobId,killed=false;
try{
  const initial=await docker.inspect(api.id);check('mode-and-owner',initial.Config.Env.includes('PF_ENGINE_MODE=session')&&initial.Config.Labels['wfc.pathfinder.owner']===target.owner&&initial.Config.Labels['wfc.pathfinder.project']===target.project);
  token=await demoLogin(target);const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));literal(claims.jti);
  const fixture=await sql(`SELECT json_build_object('ids',(SELECT json_agg(c.id ORDER BY c.id) FROM cables c JOIN pf_job_items i ON i.cable_id=c.id AND i.project_id=c.project_id WHERE i.job_id=${literal(oldJob)} AND c.project_id=${literal(projectId)} AND c.tag LIKE 'PF-CRASH-%' AND c.install_length=77 AND c.routing IS NULL AND c.design_length IS NULL AND c.cable_write_revision=0),'marked',EXISTS(SELECT 1 FROM pf_synthetic_projects s JOIN projects p ON p.id=s.project_id WHERE s.project_id=${literal(projectId)} AND p.project_number LIKE 'PF-SYNTHETIC-%' AND p.name LIKE 'Synthetic PathFinder%'))`);
  check('exact-prior64-owned-cables',fixture.marked===true&&fixture.ids?.length===64&&new Set(fixture.ids).size===64);receipt.cableIds=fixture.ids;
  const state=await request(target,`/api/projects/${projectId}/pathfinder/state`,{token});
  // All expensive full ownership checks are completed before enqueue. No inventory audit in the active window.
  const created=await request(target,`/api/projects/${projectId}/pathfinder/jobs`,{token,method:'POST',body:{cableIds:fixture.ids,expectedRegistryRevision:state.value.registryRevision,force:true}});
  check('explicit-new-job',created.status===202&&UUID.test(created.value.jobId??'')&&created.value.jobId!==oldJob);jobId=created.value.jobId;receipt.jobId=jobId;
  let observed;const until=Date.now()+25000;
  while(Date.now()<until){
    const [job,rows,inspected]=await Promise.all([sql(`SELECT json_build_object(${observationSelect}) FROM pf_jobs j WHERE id=${literal(jobId)} AND project_id=${literal(projectId)}`),top(),docker.inspect(api.id)]);
    const dotnet=rows.filter(r=>r.command==='dotnet');
    if(job.state==='running'&&job.completed<64&&job.runningItems>=1&&pair(dotnet)){
      if(inspected.Id!==api.id||inspected.Image!==api.image||inspected.Config.Labels['wfc.pathfinder.owner']!==target.owner||inspected.Config.Labels['wfc.pathfinder.project']!==target.project||!inspected.State.Running)fail('SESSION_CRASH_BINDING_CHANGED');
      observed={job,processes:dotnet,checkedAt:new Date().toISOString()};break;
    }
    if(['complete','failed','cancelled'].includes(job.state))break;
    await new Promise(r=>setTimeout(r,20));
  }
  if(!observed){receipt.status='NOT_RUN';receipt.reason='The one new bounded64-cable attempt completed or left the active state before both a running item and exact pair were observed; no crash performed.';}
  else{
    receipt.observed={...observed,job:publicProgress(observed.job)};
    await docker.command(['kill','--signal=KILL',api.id]);killed=true;
    const stopped=await docker.inspect(api.id);check('namespace-killed',!stopped.State.Running&&stopped.State.Pid===0&&stopped.State.ExitCode===137&&!stopped.State.OOMKilled);
    const persisted=await sql(`SELECT json_build_object(${observationSelect}) FROM pf_jobs j WHERE id=${literal(jobId)}`);receipt.persistedAtCrash=publicProgress(persisted);
    check('actual-unfinished-batch-persisted',unfinishedBatch(persisted)&&persisted.attempts===observed.job.attempts&&persisted.ownerToken===observed.job.ownerToken,{boundary:'Between items is permitted; no exact Core execution instant claimed.'});
    await docker.start(api.id);check('restarted-healthy',await health());
    const recoveryStart=Date.now(),end=recoveryStart+180000;let complete;
    while(Date.now()<end){const value=await sql(`SELECT json_build_object('state',state,'completed',completed,'total',total,'attempts',attempts,'failedItems',(SELECT COUNT(*) FROM pf_job_items WHERE job_id=j.id AND(state<>'complete' OR status<>'calculated'))) FROM pf_jobs j WHERE id=${literal(jobId)}`);if(value.state==='complete'){complete=value;break;}if(['failed','cancelled'].includes(value.state))fail('SESSION_CRASH_RECOVERY_TERMINAL');await new Promise(r=>setTimeout(r,300));}
    check('natural-lease-new-attempt-complete64',complete?.completed===64&&complete.total===64&&complete.attempts===persisted.attempts+1&&complete.failedItems===0,{result:complete,elapsedAfterRestartMilliseconds:Date.now()-recoveryStart});
    const closure=await sql(`SELECT json_build_object('proposals',(SELECT COUNT(*) FROM pf_proposals WHERE job_id=${literal(jobId)}),'distinctCables',(SELECT COUNT(DISTINCT cable_id) FROM pf_proposals WHERE job_id=${literal(jobId)}),'unchangedCables',(SELECT COUNT(*) FROM cables WHERE id=ANY(ARRAY[${fixture.ids.map(literal).join(',')}]::uuid[]) AND install_length=77 AND routing IS NULL AND design_length IS NULL AND cable_write_revision=0),'adminCurrent',EXISTS(SELECT 1 FROM users WHERE id=${literal(target.syntheticDemo.actorId)} AND is_admin),'loginCurrent',EXISTS(SELECT 1 FROM viewer_login_bindings WHERE login_id=${literal(claims.jti)} AND user_id=${literal(target.syntheticDemo.actorId)} AND revoked_at IS NULL AND expires_at=to_timestamp(${claims.exp}) AND expires_at>NOW()))`);
    check('unique-publication-noapply-current-authority',closure.proposals===64&&closure.distinctCables===64&&closure.unchangedCables===64&&closure.adminCurrent&&closure.loginCurrent,{closure});
    check('old-host-pids-absent',!(await top()).some(row=>observed.processes.some(old=>old.pid===row.pid)));receipt.status='PASS';
  }
}catch(error){receipt.error=error.code??error.name??'SESSION_CRASH_FAILED';receipt.status='FAIL';}
finally{
  if(killed&&!(await docker.inspect(api.id)).State.Running){await docker.start(api.id);await health();}
  if(jobId&&token){const cancelled=await request(target,`/api/projects/${projectId}/pathfinder/jobs/${jobId}`,{token,method:'DELETE'});receipt.durableCancelStatus=cancelled.status;if(cancelled.status!==200)receipt.status='FAIL';}
  receipt.finishedAt=new Date().toISOString();const file='docs/pathfinder/evidence/session/crash-once-'+Date.now()+'.json';await fs.writeFile(file,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:receipt.status,file,jobId,error:receipt.error,checks:receipt.checks.length}));
}
process.exitCode=receipt.status==='FAIL'?1:0;
