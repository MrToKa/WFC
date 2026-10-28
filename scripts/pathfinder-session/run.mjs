import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createDocker, publicContainer } from '../operations/docker.mjs';
import { assertContainer, stableContainerMetadata, IMAGE, UUID } from '../pathfinder-capacity/lib.mjs';
import { canonical, sha256, parseOutput, fail } from './lib.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SCRATCH = path.join(ROOT, 'pathfinder-engine/.scratch');
const options = {};
for (let i = 2; i < process.argv.length; i += 2) { const key = process.argv[i]; if (!['--bundle','--mode'].includes(key) || options[key] || !process.argv[i + 1]) fail('SESSION_ARGUMENT'); options[key] = process.argv[i + 1]; }
if (!['age','mixed','policy','rss','deadline'].includes(options['--mode']) || !options['--bundle']) fail('SESSION_ARGUMENT');
const mode = options['--mode'], bundle = path.resolve(options['--bundle']);
if (!path.relative(SCRATCH,bundle) || path.relative(SCRATCH,bundle).startsWith('..') || (await fs.realpath(bundle)).toLowerCase() !== bundle.toLowerCase()) fail('SESSION_BUNDLE_PATH');
const preparation = parseOutput(await fs.readFile(path.join(bundle,'../prepare.json')),4*1024**2); if (preparation.status !== 'PASS' || preparation.bundle !== bundle) fail('SESSION_BUNDLE_NOT_PREPARED');
for (const item of preparation.files) { if (item.source) continue; const bytes = await fs.readFile(path.join(bundle,item.file)); if (sha256(bytes) !== item.sha256) fail('SESSION_BUNDLE_HASH_CHANGED'); }
const source = parseOutput(await fs.readFile(path.join(bundle,'source.json')),1024**2).source, docker = await createDocker();
async function sourceBinding() {
  if (!IMAGE.test(source.apiImage) || !UUID.test(source.owner) || source.project !== 'wfc-pathfinder-local') fail('SESSION_SOURCE_BINDING');
  const api = await docker.inspect(source.apiId), pg = await docker.inspect(source.postgresId), image = await docker.inspectImage(source.apiImage);
  for (const item of [api,pg]) if (item.Config?.Labels?.['wfc.pathfinder.owner'] !== source.owner || item.Config?.Labels?.['wfc.pathfinder.project'] !== source.project || item.Config?.Labels?.['wfc.pathfinder.isolated'] !== 'true' || !item.State.Running) fail('SESSION_SOURCE_OWNER');
  if (api.Image !== source.apiImage || api.HostConfig.Memory !== 4*1024**3 || api.HostConfig.PidsLimit !==256 || image.Config?.Labels?.['wfc.pathfinder.owner'] !==source.owner) fail('SESSION_SOURCE_RESOURCE_IMAGE');
  return { api: stableContainerMetadata(publicContainer(api)), postgres: stableContainerMetadata(publicContainer(pg)), image: image.Id, memoryBytes: api.HostConfig.Memory, pids: api.HostConfig.PidsLimit };
}
const sourceBefore = await sourceBinding(), owner = randomUUID(), token = owner.replaceAll('-','').slice(0,12), project = 'wfc-pathfinder-local-'+token, name = 'wfc-pf-session-'+token;
const work = path.join(path.dirname(bundle),'run-'+mode+'-'+owner); await fs.mkdir(work);
await fs.writeFile(path.join(work,'owner.json'),JSON.stringify({format:'WFC-PF-SESSION-RUN',owner,project,work,bundle,mode,createdAt:new Date().toISOString()}),{flag:'wx'});
const mounts = [{Type:'bind',Source:bundle,Target:'/qualification',ReadOnly:true},{Type:'bind',Source:path.join(bundle,'server'),Target:'/app/server/dist',ReadOnly:true},{Type:'bind',Source:path.join(bundle,'runner'),Target:'/opt/pathfinder',ReadOnly:true},{Type:'bind',Source:work,Target:'/work',ReadOnly:false}];
const config = {Image:source.apiImage,User:'1000:1000',WorkingDir:'/work',Entrypoint:['node','/qualification/scripts/pathfinder-session/qualify.mjs'],Cmd:[mode],Env:['PF_ENGINE_DLL='+(mode==='rss'?'/qualification/fixture/MemoryLane.dll':'/opt/pathfinder/PathFinder.ModelRunner.dll'),'PF_ROOT=/work/data','NODE_OPTIONS=--max-old-space-size=512','HOME=/tmp','TMPDIR=/tmp','DOTNET_CLI_HOME=/tmp/dotnet','DOTNET_GENERATE_ASPNET_CERTIFICATE=false','DOTNET_CLI_TELEMETRY_OPTOUT=1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1'],Labels:{'wfc.pathfinder.owner':owner,'wfc.pathfinder.project':project,'wfc.pathfinder.isolated':'true','wfc.pathfinder.capacity':'true','wfc.pathfinder.session-qualification':'true'},HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Mounts:mounts,Memory:4*1024**3,MemorySwap:4*1024**3,PidsLimit:256,NanoCpus:2e9,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],Init:true,Tmpfs:{'/tmp':'rw,nosuid,nodev,noexec,size=67108864,mode=1777'}}};
const receipt = {schemaVersion:'pathfinder.session.orchestration.v1',mode,startedAt:new Date().toISOString(),status:'FAIL',sourceBefore,bundle,work,owner,project,policy:{memoryBytes:4*1024**3,pids:256,cpus:2,network:'none',timeoutMilliseconds:mode==='age'?660000:180000},cleanup:{status:'NOT_RUN'}};
let expected, timer, interrupted=false, rejectInterrupt;
const stop = () => {interrupted=true;rejectInterrupt?.(new Error('SESSION_INTERRUPTED'));}; process.once('SIGINT',stop);process.once('SIGTERM',stop);
const interrupt = new Promise((_,reject)=>{rejectInterrupt=reject;});interrupt.catch(()=>undefined);
try {
  const created=await docker.create(name,config); expected={id:created.Id,name,image:config.Image,owner,project,mounts}; assertContainer(await docker.inspect(created.Id),expected); receipt.container=expected;
  await fs.writeFile(path.join(work,'running.json'),JSON.stringify({containerId:created.Id,name,mode,owner,project}));
  await docker.start(created.Id);
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SESSION_WHOLE_CONTAINER_DEADLINE')),receipt.policy.timeoutMilliseconds);});deadline.catch(()=>undefined);
  const exit=await Promise.race([docker.wait(created.Id),deadline,interrupt]);clearTimeout(timer);
  const actual=assertContainer(await docker.inspect(created.Id),expected);receipt.exit={code:exit.StatusCode,oomKilled:actual.State.OOMKilled};
  const bytes=await fs.readFile(path.join(work,'result.json')),result=parseOutput(bytes,32*1024**2);
  if(result.schemaVersion!=='pathfinder.session.qualification.v1'||result.mode!==mode||!['PASS','FAIL'].includes(result.status))fail('SESSION_RESULT_SCHEMA');
  receipt.result={path:path.join(work,'result.json'),sha256:sha256(bytes),status:result.status,checks:result.checks.length,error:result.error};receipt.status=exit.StatusCode===0&&!actual.State.OOMKilled?result.status:'FAIL';
} catch(error){receipt.error=error.code??error.message??'SESSION_RUN_FAILED';}
finally {
  clearTimeout(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  if(expected){try {let actual=assertContainer(await docker.inspect(expected.id),expected);if(actual.State.Running){await docker.request('POST','/containers/'+expected.id+'/kill?signal=KILL');await docker.wait(expected.id);actual=assertContainer(await docker.inspect(expected.id),expected);}await docker.remove(expected.id);if(await docker.inspect(expected.id).catch(()=>null))fail('SESSION_CONTAINER_REMAINS');receipt.cleanup={status:'PASS',containerId:expected.id,absent:true,volumesCreated:0,networksCreated:0,imagesCreated:0,interrupted};}catch(error){receipt.cleanup={status:'FAIL',code:error.code??'SESSION_CLEANUP_FAILED'};receipt.status='FAIL';}}
  try{receipt.sourceAfter=await sourceBinding();receipt.sourceUnchanged=canonical(receipt.sourceBefore)===canonical(receipt.sourceAfter);if(!receipt.sourceUnchanged)receipt.status='FAIL';}catch(error){receipt.status='FAIL';receipt.preservationError=error.code??'SESSION_SOURCE_READBACK_FAILED';}
  receipt.finishedAt=new Date().toISOString();await fs.writeFile(path.join(work,'orchestration.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
}
console.log(JSON.stringify({status:receipt.status,mode,work,result:receipt.result,cleanup:receipt.cleanup,error:receipt.error}));process.exitCode=receipt.status==='PASS'?0:1;
