import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { load, ownership, demoLogin, request } from '../pathfinder-local/runtime-lib.mjs';
import { crashRecovery } from '../pathfinder-local/crash-recovery.mjs';
import { createDocker, publicContainer } from '../operations/docker.mjs';
import { canonical, sha256, parseOutput, equality, fail } from './lib.mjs';

const runtime=process.argv[2],bundle=process.argv[3];
if(!runtime||!bundle||process.argv.length!==4)fail('SESSION_OPS_ARGUMENT');
const target=await load(runtime);if(target.port!==5191||target.project==='wfc-pathfinder-local'||!target.restore?.inventoriesEqual)fail('SESSION_OPS_EXTRA_TARGET_REQUIRED');
const docker=await createDocker(),resources=await ownership(target),api=resources.containers.find(c=>c.role==='api'),pg=resources.containers.find(c=>c.role==='postgres');
const actual=await docker.inspect(api.id);if(!actual.Config.Env.includes('PF_ENGINE_MODE=session'))fail('SESSION_OPS_SESSION_REQUIRED');
const receipt={schemaVersion:'pathfinder.session.target-ops.v1',startedAt:new Date().toISOString(),status:'FAIL',targetProject:target.project,targetRuntime:target.runtime,images:target.images,apiId:api.id,postgresId:pg.id,checks:[],scope:{noApply:true,noSource5190Writes:true,crashScope:'Observed active durable batch plus supervisor/worker pair, not an exact Core/frame instruction.'}};
const check=(name,value,details={})=>{receipt.checks.push({...details,name,status:value?'PASS':'FAIL'});if(!value)fail('SESSION_OPS_'+name.toUpperCase().replaceAll('-','_'));};
async function sql(query){return parseOutput(await docker.command(['exec',pg.id,'psql','--no-password','--no-psqlrc','--quiet','--tuples-only','--no-align','--set=ON_ERROR_STOP=1','-U','pf_local','-d','wfc_pathfinder_local','-c',"SET statement_timeout='10s'; "+query],{signal:AbortSignal.timeout(15000)}),1024**2);}
async function top(){const value=await docker.request('GET','/containers/'+api.id+'/top?ps_args='+encodeURIComponent('-eo pid,ppid,comm'));return value.Processes.map(r=>({pid:Number(r[0]),parentPid:Number(r[1]),command:r[2]}));}
const exactPair=rows=>rows.length===2&&rows.filter(row=>rows.some(parent=>parent.pid===row.parentPid)).length===1;
async function healthy(){const end=Date.now()+30000;while(Date.now()<end){try{if((await fetch('http://127.0.0.1:5191/health',{signal:AbortSignal.timeout(2000)})).status===200)return true;}catch{}await new Promise(r=>setTimeout(r,150));}return false;}
async function holders(){return await sql("SELECT json_build_object('pids',COALESCE(json_agg(pid),'[]'::json)) FROM(SELECT DISTINCT a.pid FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE l.locktype='advisory' AND l.granted AND a.datname='wfc_pathfinder_local' AND a.usename='pf_local' AND a.query LIKE '%pg_try_advisory_lock%wfc-pathfinder-engine-worker-v1%')s");}
try{
  const token=await demoLogin(target),realRequest=parseOutput(await fs.readFile(bundle+'/real/request.json'),1024**2),reference=parseOutput(await fs.readFile(bundle+'/real/reference.json'),32*1024**2);
  // Uses the exact built target DLL/client, bypassing HTTP presentation only. No DB writes.
  const program=`import fs from 'node:fs/promises';import {createHash,randomUUID} from 'node:crypto';import {createSessionEngineExecutor} from '/app/server/dist/server/pathfinder/engineSession.js';let text='';for await(const chunk of process.stdin)text+=chunk;const request=JSON.parse(text),events=[],executor=createSessionEngineExecutor({observe:event=>events.push(event)});let result;try{const a=await executor.execute({...request,requestId:randomUUID()},new AbortController().signal),b=await executor.execute({...request,requestId:randomUUID()},new AbortController().signal);result={a,b,events,runnerSha256:createHash('sha256').update(await fs.readFile(process.env.PF_ENGINE_DLL)).digest('hex')};}finally{await executor.close();}console.log(JSON.stringify(result));`;
  const bytes=await docker.command(['exec','-i',api.id,'node','--input-type=module','-e',program],{input:Readable.from([JSON.stringify(realRequest)]),maxBytes:32*1024**2,signal:AbortSignal.timeout(45000)});
  const real=parseOutput(bytes,32*1024**2);receipt.real=real;receipt.realRawSha256=sha256(bytes);
  const projected=r=>({route:r.route,design:r.design,effectiveCategory:r.effectiveCategory});
  check('rebuilt-dll-full-real-route-design-reference',canonical(projected(real.a))===canonical(projected(reference)),{runnerSha256:real.runnerSha256,lengthMeters:real.a.route?.lengthMeters,design:real.a.design});
  check('rebuilt-dll-full-dto-repeat-equality',equality(real.a,real.b));
  check('rebuilt-dll-actual-memory-reuse',real.events.filter(e=>e.type==='result').length===2&&real.events.filter(e=>e.type==='result')[1].preparedReuse==='memory'&&new Set(real.events.filter(e=>e.type==='spawn').map(e=>e.pid)).size===1);
  const projectId=target.syntheticDemo.projectId;
  async function warm(label){
    const state=await request(target,`/api/projects/${projectId}/pathfinder/state`,{token});
    const body={from:{name:'',point:[0,0,.5]},to:{name:'',point:[10,0,.5]},category:'Control',reverse:false,artifactId:state.value.artifacts[0].id,expectedSelectionRevision:state.value.activeModel.selectionRevision,expectedSettingsRevision:state.value.settings.revision,expectedRegistryRevision:state.value.registryRevision};
    const create=await request(target,`/api/projects/${projectId}/pathfinder/previews`,{token,method:'POST',body});check(label+'-preview-enqueued',create.status===202,{httpStatus:create.status,jobId:create.value.jobId});
    let preview;const end=Date.now()+30000;
    while(Date.now()<end){const value=await request(target,`/api/projects/${projectId}/pathfinder/previews/${create.value.jobId}`,{token});if(value.value.result){preview=value.value;break;}await new Promise(r=>setTimeout(r,150));}
    check(label+'-preview-known-maths',preview?.result?.route?.lengthMeters===10&&preview?.result?.design?.designLengthMeters==='18',{actualStatus:preview?.status,design:preview?.result?.design});
  }
  await warm('lock-loss');const lockProcesses=(await top()).filter(row=>row.command==='dotnet');check('lock-loss-observed-owned-pair',exactPair(lockProcesses),{processes:lockProcesses});
  const held=await holders();check('lock-loss-unique-holder',held.pids.length===1&&Number.isSafeInteger(held.pids[0]),{postgresPids:held.pids});
  const terminated=await sql(`SELECT json_build_object('terminated',pg_terminate_backend(pid)) FROM pg_stat_activity WHERE pid=${held.pids[0]} AND pid<>pg_backend_pid() AND usename='pf_local' AND datname='wfc_pathfinder_local'`);check('lock-loss-backend-terminated',terminated.terminated===true);
  const reapDeadline=Date.now()+11000;let remaining=[];while(Date.now()<reapDeadline){remaining=(await top()).filter(row=>lockProcesses.some(old=>old.pid===row.pid));if(!remaining.length)break;await new Promise(r=>setTimeout(r,100));}
  check('lock-loss-joined-old-lane',remaining.length===0);check('lock-loss-api-remains-healthy',await healthy());
  await new Promise(r=>setTimeout(r,5200));const afterLoss=await holders();check('lock-loss-quarantined-no-reacquire',afterLoss.pids.length===0,{observationMilliseconds:5200,scope:'Worker requires explicit backend restart; no same-process automatic recovery claim.'});
  await ownership(target);await docker.stop(api.id,45);await docker.start(api.id);check('lock-loss-explicit-restart-healthy',await healthy());
  await warm('graceful');const renewed=await holders();check('lock-loss-restart-new-owner',renewed.pids.length===1&&renewed.pids[0]!==held.pids[0],{newPostgresPids:renewed.pids});
  const beforeStop=(await top()).filter(row=>row.command==='dotnet');check('graceful-observed-owned-pair',exactPair(beforeStop),{processes:beforeStop});
  await ownership(target);const stoppedAt=performance.now();await docker.stop(api.id,45);const stopped=await docker.inspect(api.id);
  check('graceful-normal-exit',!stopped.State.Running&&stopped.State.ExitCode===0&&!stopped.State.OOMKilled,{elapsedMilliseconds:performance.now()-stoppedAt,state:{running:stopped.State.Running,exitCode:stopped.State.ExitCode,pid:stopped.State.Pid,oomKilled:stopped.State.OOMKilled}});
  const lock=await sql("SELECT json_build_object('available',pg_try_advisory_lock(hashtext('wfc-pathfinder-engine-worker-v1'))) ");check('graceful-advisory-released',lock.available===true);
  let refused=false;try{await top();}catch{refused=true;}check('graceful-namespace-reaped',refused);
  await docker.start(api.id);check('graceful-restarted-healthy',await healthy());
  check('graceful-old-host-pids-absent',!(await top()).some(row=>beforeStop.some(old=>old.pid===row.pid)));
  receipt.crash=await crashRecovery(target,token,'http://127.0.0.1:5190');check('actual-64-cable-crash-recovery',receipt.crash.status==='PASS',{actualStatus:receipt.crash.status});
  check('final-target-healthy',await healthy());receipt.status='PASS';
}catch(error){receipt.error=error.code??error.name??'SESSION_TARGET_OPS_FAILED';}
finally{receipt.finishedAt=new Date().toISOString();receipt.api=publicContainer(await docker.inspect(api.id));const file='docs/pathfinder/evidence/session/target-ops-'+Date.now()+'.json';await fs.writeFile(file,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:receipt.status,file,error:receipt.error,checks:receipt.checks.length}));}
process.exitCode=receipt.status==='PASS'?0:1;
