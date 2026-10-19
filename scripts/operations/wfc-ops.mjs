import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomUUID,randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDocker,environment,publicContainer,dataMount,imageId,writePrivateJson } from './docker.mjs';
import { assertCanonicalPath } from './archives.mjs';
import { FORMAT,writeJsonNew,recordFile,completeBackup,verifyBackup,assertFreshTarget,newTargetMarker,readTarget,verifyImageArchive } from './manifest.mjs';
import { validateRestoreFencing } from './restore-fencing.mjs';

export class OperationsError extends Error {constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new OperationsError(code);};
const CLI=['node','server/dist/server/operations/cli.js'];
const PACK=['node','scripts/operations/archives.mjs'];
const labels=id=>({'wfc.operations.target':id,'wfc.operations.owned':'true'});
const mount=(source,target,readOnly=true,type='bind')=>({Type:type,Source:source,Target:target,ReadOnly:readOnly});
const privateEnv=config=>[...environment(config)].map(([key,value])=>key+'='+value);
const safeJSON=value=>JSON.parse(JSON.stringify(value));
export async function bundleOperatorModules(directory){
  const sourceRoot=path.dirname(fileURLToPath(import.meta.url)),records=[];
  for(const name of ['wfc-ops.mjs','docker.mjs','manifest.mjs','archives.mjs','restore-fencing.mjs']){const source=path.join(sourceRoot,name);await assertCanonicalPath(source);const before=await recordFile(sourceRoot,name,'source');await fs.copyFile(source,path.join(directory,name),1);const copied=await recordFile(directory,name,'source'),after=await recordFile(sourceRoot,name,'source');if(copied.sha256!==before.sha256||copied.bytes!==before.bytes||after.sha256!==before.sha256||after.bytes!==before.bytes)fail('OPERATOR_SOURCE_CHANGED');records.push(copied);}
  return records;
}
export function pathContained(parent,candidate){const normalize=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value),relative=path.relative(normalize(parent),normalize(candidate));return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
export function assertDestinationOutsideSources(source,destination,privateConfig){
  for(const container of [source.postgres,source.minio,...source.apps])for(const item of container.Mounts??[])if(item.Type==='bind'&&(pathContained(item.Source,destination)||pathContained(item.Source,privateConfig)))fail('BACKUP_DESTINATION_INSIDE_SOURCE');
}
function privateRole(container){return{image:container.Image,config:{Env:container.Config.Env,Entrypoint:container.Config.Entrypoint,Cmd:container.Config.Cmd,User:container.Config.User,WorkingDir:container.Config.WorkingDir,Healthcheck:container.Config.Healthcheck,StopSignal:container.Config.StopSignal,StopTimeout:45}};}
async function freePort(port){await new Promise((resolve,reject)=>{const socket=net.createServer();socket.once('error',()=>reject(new OperationsError('RESTORE_PORT_IN_USE')));socket.listen(port,'127.0.0.1',()=>socket.close(resolve));});}
async function helper(docker,id,api,command,{network,mounts=[],targetId,apply=false,allowFailure=false}={}){
  const env=privateEnv(api).filter(value=>!/^WFC_OPS_/.test(value));if(targetId)env.push('WFC_OPS_TARGET_ID='+targetId,'WFC_OPS_QUARANTINE=true');
  const result=await docker.run(id,{env,network,cmd:[...CLI,command,...(apply?['--apply']:[])],mounts});
  if(!result||result.schemaVersion!==1||result.command!==command||!['PASS','FAIL','DEFERRED'].includes(result.status)||!allowFailure&&result.status!=='PASS')fail('HELPER_VALIDATION_FAILED');return result;
}
function sourceNetwork(api){const networks=Object.keys(api.NetworkSettings.Networks);if(networks.length!==1)fail('SOURCE_NETWORK_AMBIGUOUS');return networks[0];}
async function boundedStopped(docker,container,seconds){if(!container.State.Running)return{...publicContainer(container),stoppedByOperation:false};await docker.stop(container.Id,seconds);const after=await docker.inspect(container.Id);if(after.State.Running)fail('SOURCE_WRITER_STILL_RUNNING');return{...publicContainer(after),stoppedByOperation:true,forcedOrUnclean:after.State.ExitCode!==0||after.State.OOMKilled};}
export async function fenceDatabaseClients(docker,source){
  const query=async sql=>{const raw=await docker.command(['exec',source.postgres.Id,'psql','--no-password','--no-psqlrc','--quiet','--tuples-only','--no-align','--set=ON_ERROR_STOP=1','--username='+decodeURIComponent(source.database.username),'--dbname='+decodeURIComponent(source.database.pathname.slice(1)),'--command',"SET statement_timeout='60s'; "+sql],{maxBytes:65536});let value;try{value=JSON.parse(raw.toString().trim());}catch{fail('DATABASE_FENCE_RESPONSE_INVALID');}return value;};
  const condition="datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()",countSql="SELECT json_build_object('clients',COUNT(*)) FROM pg_stat_activity WHERE "+condition;
  const before=await query(countSql);if(!Number.isInteger(before.clients)||before.clients<0||before.clients>128)fail('DATABASE_CLIENT_LIMIT');
  let terminated=0;
  if(before.clients){const result=await query("WITH targets AS MATERIALIZED (SELECT pid FROM pg_stat_activity WHERE "+condition+" ORDER BY (cardinality(pg_blocking_pids(pid))>0) DESC,pid LIMIT 129), stopped AS MATERIALIZED (SELECT pg_terminate_backend(pid,5000) AS done FROM targets) SELECT json_build_object('requested',COUNT(*),'terminated',COUNT(*) FILTER(WHERE done),'failed',COUNT(*) FILTER(WHERE NOT done)) FROM stopped");if(!Number.isInteger(result.requested)||result.requested>128||result.failed!==0||result.terminated!==result.requested)fail('DATABASE_CLIENT_FENCE_FAILED');terminated=result.terminated;}
  const after=await query(countSql);if(after.clients!==0)fail('DATABASE_CLIENTS_REMAIN');
  return{status:'PASS',clientsBefore:before.clients,terminated,remaining:0,maxClients:128,perBackendTimeoutMs:5000,statementTimeoutMs:60000,basis:'After every declared application worker stops, terminate remaining client backends of this exact database only; confirm zero in a fresh server query. External reconnecting writers must remain excluded for maintenance.'};
}
export function isDatabaseClient(current,postgres,database){
  const connection=environment(current).get('DATABASE_URL');if(!connection)return false;let parsed;try{parsed=new URL(connection);}catch{return false;}
  if(!['postgres:','postgresql:'].includes(parsed.protocol)||decodeURIComponent(parsed.pathname)!==decodeURIComponent(database.pathname))return false;
  try{assertEndpointBinding(current,postgres,parsed.hostname,Number(parsed.port||5432),5432);return true;}catch(error){if(error.code==='SOURCE_ENDPOINT_UNBOUND')return false;throw error;}
}
function isMinioClient(current,minio){const settings=environment(current);if(!settings.get('MINIO_ENDPOINT'))return false;try{assertEndpointBinding(current,minio,settings.get('MINIO_ENDPOINT'),Number(settings.get('MINIO_PORT')||9000),9000);return true;}catch(error){if(error.code==='SOURCE_ENDPOINT_UNBOUND')return false;throw error;}}
export async function createImageLease(docker,image,backupId){
  imageId(image);const name='wfc-ops-lease-'+backupId,created=await docker.create(name,{Image:image,Cmd:['node','-e','process.exit(0)'],Env:[],Labels:{'wfc.operations.lease':backupId,'wfc.operations.owned':'true'},HostConfig:{NetworkMode:'none'}});
  return{id:created.Id,async release(){const current=await docker.inspect(created.Id);if(current.Name!=='/'+name||current.Image!==image||current.State.Running||current.Config.Labels?.['wfc.operations.lease']!==backupId||current.Config.Labels?.['wfc.operations.owned']!=='true')fail('HELPER_LEASE_OWNERSHIP_LOST');await docker.remove(created.Id);}};
}
export async function discoverSource(docker,options){
  const [postgres,minio,...apps]=await Promise.all([options.postgresContainer,options.minioContainer,...options.appContainers,...options.webContainers].map(name=>docker.inspect(name)));
  const api=apps[0],web=apps[options.appContainers.length];if(!api||!web||!postgres||!minio)fail('SOURCE_CONTAINERS_REQUIRED');
  if(new Set([postgres,minio,...apps].map(item=>item.Id)).size!==apps.length+2)fail('SOURCE_CONTAINER_DUPLICATE');
  const apiEnv=environment(api),connection=apiEnv.get('DATABASE_URL');if(!connection||!apiEnv.get('MINIO_ENDPOINT'))fail('SOURCE_CONFIG_INVALID');const database=new URL(connection);if(!['postgres:','postgresql:'].includes(database.protocol))fail('SOURCE_CONFIG_INVALID');
  const writers=apps.slice(0,options.appContainers.length),known=new Set(writers.map(item=>item.Id));
  for(const current of await docker.containers())if(current.State.Running&&!known.has(current.Id)){if(isDatabaseClient(current,postgres,database))fail('UNDECLARED_DATABASE_WRITER');if(isMinioClient(current,minio))fail('UNDECLARED_STORAGE_CLIENT');}
  const modelMount=api.Mounts.find(item=>item.Destination===(apiEnv.get('WFC_MODEL_IMPORT_ROOT')||'/var/lib/wfc/model-imports'));if(!modelMount)fail('SOURCE_STAGING_MOUNT_REQUIRED');
  const sharedSettings=['DATABASE_URL','MINIO_ENDPOINT','MINIO_PORT','MINIO_USE_SSL','MINIO_ACCESS_KEY','MINIO_SECRET_KEY','MINIO_BUCKET_PROJECTS','MINIO_BUCKET_TEMPLATES','WFC_MODEL_BUCKET','WFC_MODEL_IMPORT_ROOT'];
  const sameMount=(left,right)=>['Type','Name','Source','Destination','RW'].every(key=>left?.[key]===right?.[key]);
  for(const worker of writers){const workerEnv=environment(worker);if(sharedSettings.some(key=>workerEnv.get(key)!==apiEnv.get(key))||worker.Mounts.length!==1||!sameMount(worker.Mounts[0],modelMount))fail('SOURCE_WORKER_MISMATCH');}
  const minioMount=dataMount(minio,'/data'),stagingMount=dataMount(api,modelMount.Destination);
  if(apps.slice(options.appContainers.length).some(item=>item.Mounts.length)||writers.some(item=>item.Mounts.length!==1)||minio.Mounts.length!==1)fail('SOURCE_EXTRA_MOUNT_UNSUPPORTED');
  for(const current of await docker.containers())for(const existing of current.Mounts??[])if(current.State.Running&&existing.RW&&((existing.Type===minioMount.Type&&(existing.Name||existing.Source)===minioMount.Source&&current.Id!==minio.Id)||(existing.Type===stagingMount.Type&&(existing.Name||existing.Source)===stagingMount.Source&&!known.has(current.Id))))fail('UNDECLARED_STORAGE_WRITER');
  const network=sourceNetwork(api);
  assertEndpointBinding(api,postgres,database.hostname,Number(database.port||5432),5432);
  const minioHost=apiEnv.get('MINIO_ENDPOINT'),minioPort=Number(apiEnv.get('MINIO_PORT')||9000);assertEndpointBinding(api,minio,minioHost,minioPort,9000);
  return{postgres,minio,api,web,apps,writers,network,minioMount,stagingMount,database};
}
export function assertEndpointBinding(api,service,host,port,internalPort){
  if(!host||!Number.isInteger(port)||port<1||port>65535)fail('SOURCE_ENDPOINT_UNBOUND');
  if(['host.docker.internal','gateway.docker.internal'].includes(host)){
    const bindings=service.NetworkSettings.Ports?.[internalPort+'/tcp']??[];
    if(!bindings.some(item=>Number(item.HostPort)===port&&['','0.0.0.0','::','127.0.0.1'].includes(item.HostIp)))fail('SOURCE_ENDPOINT_UNBOUND');return;
  }
  const names=new Set([service.Name.replace(/^\//,''),service.Id,service.Id.slice(0,12)]);let shared=false;
  for(const[name,endpoint]of Object.entries(service.NetworkSettings.Networks)){if(api.NetworkSettings.Networks[name]){shared=true;for(const alias of [...endpoint.Aliases??[],...endpoint.DNSNames??[],endpoint.IPAddress])if(alias)names.add(alias);}}
  if(!shared||port!==internalPort||!names.has(host))fail('SOURCE_ENDPOINT_UNBOUND');
}
export async function backup(options,{docker:provided}={}){
  const docker=provided??await createDocker();imageId(options.helperImage);if(!options.appContainers?.length||!options.webContainers?.length||!options.privateConfigOut||!options.sourceInventory)fail('BACKUP_ARGUMENT_REQUIRED');
  await assertCanonicalPath(options.sourceInventory);
  const source=await discoverSource(docker,options);const timeout=Number(options.stopTimeoutSeconds??45);if(!Number.isInteger(timeout)||timeout<40||timeout>600)fail('STOP_TIMEOUT_INVALID');
  const parent=await assertCanonicalPath(options.destinationRoot,{directory:true}),backupId=randomUUID(),directory=path.join(parent,'wfc-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+backupId.slice(0,8));
  const privatePath=path.resolve(options.privateConfigOut);if(pathContained(parent,privatePath))fail('PRIVATE_CONFIG_MUST_BE_SEPARATE');
  assertDestinationOutsideSources(source,parent,privatePath);
  await assertCanonicalPath(path.dirname(privatePath),{directory:true});await fs.mkdir(directory,{mode:0o700});await writeJsonNew(path.join(directory,'incomplete.json'),{format:FORMAT,schemaVersion:1,backupId,state:'incomplete',startedAt:new Date().toISOString()});
  const stopped=[],resumeErrors=[],leaseReceipt={released:false};let completed=false,lease;
  try{
    lease=await createImageLease(docker,options.helperImage,backupId);leaseReceipt.id=lease.id;
    const roles=[['api',source.api.Image],['web',source.web.Image],['postgres',source.postgres.Image],['minio',source.minio.Image],['helper',options.helperImage]],images=[];
    for(const [role,id]of roles){const inspected=await docker.inspectImage(id);if(inspected.Os!=='linux'||!['amd64','arm64'].includes(inspected.Architecture))fail('IMAGE_PLATFORM_MISMATCH');images.push({role,id,os:inspected.Os,architecture:inspected.Architecture,archive:role+'-image.tar',exportMode:'id-only'});}
    if(new Set(images.map(item=>item.architecture)).size!==1)fail('IMAGE_PLATFORM_MISMATCH');
    const sizes=[];for(const sourceMount of [source.minioMount,source.stagingMount])sizes.push(await docker.run(options.helperImage,{mounts:[sourceMount],cmd:[...PACK,'measure','/source']}));
    const databaseSize=Number((await docker.command(['exec',source.postgres.Id,'psql','--no-password','--no-psqlrc','--tuples-only','--no-align','--username='+decodeURIComponent(source.database.username),'--dbname='+decodeURIComponent(source.database.pathname.slice(1)),'--command=SELECT pg_database_size(current_database())'])).toString().trim());
    let imageBytes=0;for(const image of images)imageBytes+=(await docker.inspectImage(image.id)).Size;
    const needed=Math.ceil((sizes.reduce((sum,item)=>sum+item.totalBytes,0)+databaseSize+imageBytes)*1.3)+512*1024**2,space=await fs.statfs(directory,{bigint:true});
    if(!Number.isSafeInteger(needed)||needed<1||BigInt(needed)>space.bavail*space.bsize)fail('BACKUP_SPACE_INSUFFICIENT');
    const spaceProof={status:'PASS',basis:'Cold file inventories plus database physical size and all exact image sizes, 30% margin and 512MiB reserve.',requiredBytes:needed,availableBytes:String(space.bavail*space.bsize)};
    await writePrivateJson(privatePath,{format:'WFC-OFFLINE-PRIVATE',schemaVersion:1,backupId,roles:{api:privateRole(source.api),web:privateRole(source.web),postgres:privateRole(source.postgres),minio:privateRole(source.minio)}});
    // All application workers stop before either database inventory or object audit.
    for(const container of [...source.apps].reverse())stopped.push(await boundedStopped(docker,container,timeout));
    const databaseFence=await fenceDatabaseClients(docker,source);
    const before=await helper(docker,options.helperImage,source.api,'inventory',{network:source.network,mounts:[{...source.stagingMount,Target:environment(source.api).get('WFC_MODEL_IMPORT_ROOT')||'/var/lib/wfc/model-imports'}]});
    const audit=await helper(docker,options.helperImage,source.api,'audit-models',{network:source.network});
    const inventory=await helper(docker,options.helperImage,source.api,'inventory',{network:source.network});
    if(before.businessSha256!==inventory.businessSha256||before.registrySha256!==inventory.registrySha256)fail('SOURCE_CHANGED_DURING_AUDIT');
    stopped.push(await boundedStopped(docker,source.minio,timeout));
    // Logical dump is made only after all declared and detected WFC writers are down.
    if(!source.postgres.State.Running)fail('SOURCE_DATABASE_NOT_RUNNING');
    const user=decodeURIComponent(source.database.username),database=decodeURIComponent(source.database.pathname.slice(1));if(!user||!database||user.startsWith('-')||database.startsWith('-')||options.postgresUser&&options.postgresUser!==user||options.postgresDatabase&&options.postgresDatabase!==database)fail('SOURCE_CONFIG_INVALID');
    await docker.command(['exec',source.postgres.Id,'pg_dump','--no-password','--format=custom','--no-owner','--no-acl','--username='+user,'--dbname='+database],{output:path.join(directory,'database.dump')});
    await docker.command(['exec','--interactive',source.postgres.Id,'pg_restore','--list'],{input:path.join(directory,'database.dump'),maxBytes:16*1024**2});
    for(const [name,sourceMount]of [['minio',source.minioMount],['staging',source.stagingMount]]){
      const capture=await docker.run(options.helperImage,{mounts:[sourceMount,mount(directory,'/backup',false)],cmd:[...PACK,'capture','/source','/backup/'+name+'.wfcops']});
      if(capture.status!=='PASS')fail('CAPTURE_FAILED');
      const verified=await docker.run(options.helperImage,{mounts:[mount(directory,'/backup')],cmd:[...PACK,'verify','/backup/'+name+'.wfcops',capture.sha256]});if(verified.status!=='PASS'||verified.sha256!==capture.sha256)fail('CAPTURE_READBACK_FAILED');
    }
    await writeJsonNew(path.join(directory,'inventory.json'),inventory);await writeJsonNew(path.join(directory,'model-audit.json'),audit);await writeJsonNew(path.join(directory,'space-check.json'),spaceProof);await writeJsonNew(path.join(directory,'database-fence.json'),databaseFence);
    await fs.copyFile(options.sourceInventory,path.join(directory,'source-inventory.json'),1);
    const operatorFiles=await bundleOperatorModules(directory);
    const manifest={format:FORMAT,schemaVersion:1,profile:'cold-wfc-pg-custom-minio-staging-v1',backupId,state:'complete',createdAt:new Date().toISOString(),source:{cold:true,writerCount:source.writers.length,containers:[source.postgres,source.minio,...source.apps].map(publicContainer),stopped,stagingPolicy:inventory.stagingPolicy},inventory:{businessSha256:inventory.businessSha256,registrySha256:inventory.registrySha256},images,files:[]};
    for(const image of images){await docker.command(['image','save','--output',path.join(directory,image.archive),image.id]);await verifyImageArchive(path.join(directory,image.archive),image);}
    for(const [name,role]of [['database.dump','database'],['minio.wfcops','minio'],['staging.wfcops','staging'],['inventory.json','inventory'],['model-audit.json','audit'],['space-check.json','source'],['database-fence.json','source'],['source-inventory.json','source'],...images.map(item=>[item.archive,'image'])])manifest.files.push(await recordFile(directory,name,role));
    manifest.files.push(...operatorFiles);
    for(const container of [source.minio,...source.apps])if(container.State.Running){const current=await docker.inspect(container.Id);if(!current.State.Running)await docker.start(container.Id);if(container.State.Health?.Status==='healthy')await ready(docker,container.Id);else if(!(await docker.inspect(container.Id)).State.Running)fail('SOURCE_RESUME_FAILED');}
    await completeBackup(directory,manifest);await verifyBackup(directory);completed=true;
    return{schemaVersion:1,command:'backup',status:'PASS',backupId,directory,manifest:'manifest.json',complete:true,sourceCold:true,privateConfigurationSeparate:true,forcedOrUnclean:stopped.filter(item=>item.forcedOrUnclean).map(item=>item.id),sourceResume:{attempted:true,errors:resumeErrors},helperLease:leaseReceipt};
  }finally{
    // Preserve the exact pre-backup running/stopped states. Never start an originally stopped service.
    for(const container of [source.minio,...source.apps])if(container.State.Running){try{const current=await docker.inspect(container.Id);if(!current.State.Running)await docker.start(container.Id);if(container.State.Health?.Status==='healthy')await ready(docker,container.Id);else if(!(await docker.inspect(container.Id)).State.Running)fail('SOURCE_RESUME_FAILED');}catch{resumeErrors.push(container.Id);}}
    if(lease)try{await lease.release();leaseReceipt.released=true;}catch{leaseReceipt.cleanupCode='HELPER_LEASE_RETAINED';}
    await writeJsonNew(path.join(directory,'resume.json'),{status:resumeErrors.length?'FAIL':'PASS',complete:completed,resumedOriginalRunningState:resumeErrors.length===0,failedContainerIds:resumeErrors,helperLease:leaseReceipt}).catch(()=>undefined);
    if(resumeErrors.length)fail('SOURCE_RESUME_FAILED');
  }
}
async function ready(docker,id,seconds=120){const deadline=Date.now()+seconds*1000;while(Date.now()<deadline){const value=await docker.inspect(id);if(!value.State.Running)fail('TARGET_SERVICE_STOPPED');if(value.State.Health?.Status==='healthy'||!value.Config.Healthcheck&&value.State.Running){return value;}await new Promise(resolve=>setTimeout(resolve,500));}fail('TARGET_HEALTH_TIMEOUT');}
async function waitPg(docker,id,user,database){const deadline=Date.now()+120000;while(Date.now()<deadline){try{await docker.command(['exec',id,'pg_isready','--username='+user,'--dbname='+database],{maxBytes:4096});return;}catch{await new Promise(resolve=>setTimeout(resolve,500));}}fail('TARGET_DATABASE_TIMEOUT');}
export function restoreNetworkConfiguration(project,role){const privateName=project+'-private',frontName=project+'-front';return{mode:role==='web'?frontName:privateName,endpoints:role==='web'?{[frontName]:{Aliases:[role]},[privateName]:{Aliases:[role]}}:{[privateName]:{Aliases:[role]}}};}
export async function verifyLoopbackHealthResponse(response){
  if(response.status!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))fail('RESTORE_HTTP_HEALTH_INVALID');
  let bytes=0;const parts=[];for await(const chunk of response.body??[]){bytes+=chunk.length;if(bytes>4096)fail('RESTORE_HTTP_HEALTH_INVALID');parts.push(chunk);}let value;try{value=JSON.parse(Buffer.concat(parts));}catch{fail('RESTORE_HTTP_HEALTH_INVALID');}if(value?.status!=='ok')fail('RESTORE_HTTP_HEALTH_INVALID');
}
async function waitLoopbackHealth(origin){const deadline=Date.now()+120000;while(Date.now()<deadline){try{await verifyLoopbackHealthResponse(await fetch(origin+'/health',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(3000)}));return{status:'PASS',path:'/health',publishedLoopbackVerified:true};}catch{await new Promise(resolve=>setTimeout(resolve,250));}}fail('RESTORE_HTTP_HEALTH_TIMEOUT');}
function replaceEnv(base,values){const map=new Map(base.map(item=>{const at=item.indexOf('=');return[item.slice(0,at),item.slice(at+1)];}));for(const[key,value]of Object.entries(values))map.set(key,String(value));return[...map].map(([key,value])=>key+'='+value);}
export async function restore(options,{docker:provided}={}){
  const docker=provided??await createDocker(),verified=await verifyBackup(options.backup),manifest=verified.manifest;
  // Validate image envelopes and full file identities before any target data is written.
  for(const image of manifest.images)await verifyImageArchive(path.join(verified.directory,image.archive),image);
  const target=await assertFreshTarget(options.targetRoot,options.project,Number(options.httpPort));await freePort(Number(options.httpPort));
  if((await docker.containers()).some(item=>item.Config.Labels?.['com.docker.compose.project']===options.project||item.Config.Labels?.['wfc.operations.project']===options.project))fail('RESTORE_PROJECT_EXISTS');
  let privateConfig;try{await assertCanonicalPath(options.privateConfig);const raw=await fs.readFile(options.privateConfig);if(raw.length>1024**2)fail('PRIVATE_CONFIG_INVALID');privateConfig=JSON.parse(raw);}catch{fail('PRIVATE_CONFIG_INVALID');}
  if(privateConfig.format!=='WFC-OFFLINE-PRIVATE'||privateConfig.schemaVersion!==1||privateConfig.backupId!==manifest.backupId)fail('PRIVATE_CONFIG_INVALID');
  const helperImage=manifest.images.find(item=>item.role==='helper').id;if(options.helperImage&&options.helperImage!==helperImage)fail('HELPER_IMAGE_MISMATCH');
  for(const image of manifest.images){const local=await docker.inspectImage(image.id).catch(()=>null);if(!local)await docker.command(['image','load','--input',path.join(verified.directory,image.archive)]);const loaded=await docker.inspectImage(image.id);if(loaded.Os!==image.os||loaded.Architecture!==image.architecture)fail('IMAGE_PLATFORM_MISMATCH');}
  const marker=newTargetMarker({backupId:manifest.backupId,project:options.project,port:Number(options.httpPort)});await fs.mkdir(target,{mode:0o700});await writeJsonNew(path.join(target,'target.json'),marker);
  const ownedLabels={...labels(marker.targetId),'wfc.operations.project':options.project},networkName=options.project+'-private',frontName=options.project+'-front',created=[];
  const volumeNames=Object.fromEntries(['postgres','minio','staging'].map(name=>[name,options.project+'-'+name]));
  for(const name of Object.values(volumeNames)){const found=await docker.command(['volume','ls','--quiet','--filter','name=^'+name+'$']);if(found.toString().trim())fail('RESTORE_VOLUME_EXISTS');}
  const network=await docker.request('POST','/networks/create',{Name:networkName,CheckDuplicate:true,Internal:true,Labels:ownedLabels});
  const front=await docker.request('POST','/networks/create',{Name:frontName,CheckDuplicate:true,Internal:false,Labels:ownedLabels});
  for(const name of Object.values(volumeNames))await docker.request('POST','/volumes/create',{Name:name,Labels:ownedLabels});
  marker.network={id:network.Id,name:networkName};marker.frontNetwork={id:front.Id,name:frontName};marker.volumes=volumeNames;
  const origin='http://127.0.0.1:'+options.httpPort,newJwt=randomBytes(64).toString('hex'),apiPrivate=privateConfig.roles.api.config,sourceConnection=new URL(environment({Config:apiPrivate}).get('DATABASE_URL'));
  sourceConnection.hostname='postgres';sourceConnection.port='5432';
  const apiEnv=replaceEnv(apiPrivate.Env,{DATABASE_URL:sourceConnection.toString(),MINIO_ENDPOINT:'minio',MINIO_PORT:9000,MINIO_USE_SSL:'false',JWT_SECRET:newJwt,WFC_VIEWER_ALLOWED_ORIGINS:origin,WFC_VIEWER_ALLOW_HTTP_LOOPBACK:'true',WFC_VIEWER_TRUST_PROXY:'true',WFC_MODEL_IMPORT_ROOT:'/var/lib/wfc/model-imports'});
  const apiPseudo={Config:{...apiPrivate,Env:apiEnv}};
  const saveMarker=async()=>{await fs.writeFile(path.join(target,'target.json'),JSON.stringify(marker,null,2)+'\n',{mode:0o600});};
  const create=async(role,config,host)=>{const image=manifest.images.find(item=>item.role===role).id,name=options.project+'-'+role,topology=restoreNetworkConfiguration(options.project,role);const result=await docker.create(name,{...config,Image:image,Labels:ownedLabels,HostConfig:{NetworkMode:topology.mode,RestartPolicy:{Name:'no'},...host},NetworkingConfig:{EndpointsConfig:topology.endpoints}});created.push({role,id:result.Id});marker.containers=safeJSON(created);await saveMarker();return result.Id;};
  try{
    // Fresh MinIO/staging volumes are populated while every application worker remains absent.
    for(const role of ['minio','staging']){const file=manifest.files.find(item=>item.role===role);const check=await docker.run(helperImage,{mounts:[mount(verified.directory,'/backup'),mount(volumeNames[role],'/target',false,'volume')],cmd:[...PACK,'measure','/target']});if(check.status!=='PASS'||BigInt(check.availableBytes)<BigInt(file.bytes)*2n+512n*1024n**2n)fail('RESTORE_SPACE_INSUFFICIENT');const result=await docker.run(helperImage,{mounts:[mount(verified.directory,'/backup'),mount(volumeNames[role],'/target',false,'volume')],cmd:[...PACK,'restore','/backup/'+file.path,'/target',file.sha256]});if(result.status!=='PASS')fail('RESTORE_ARCHIVE_FAILED');}
    const pg=privateConfig.roles.postgres.config,pgEnv=environment({Config:pg}),pgUser=pgEnv.get('POSTGRES_USER')||'postgres',pgDb=pgEnv.get('POSTGRES_DB')||pgUser;
    const pgId=await create('postgres',pg,{Mounts:[mount(volumeNames.postgres,'/var/lib/postgresql',false,'volume')]});await docker.start(pgId);await waitPg(docker,pgId,pgUser,pgDb);
    // A custom dump must be parseable by the transported PostgreSQL image before restore.
    const dump=path.join(verified.directory,manifest.files.find(item=>item.role==='database').path);await docker.command(['exec','--interactive',pgId,'pg_restore','--list'],{input:dump,maxBytes:16*1024**2});
    await docker.command(['exec','--interactive',pgId,'pg_restore','--exit-on-error','--no-owner','--no-acl','--username='+pgUser,'--dbname='+pgDb],{input:dump,maxBytes:16*1024**2});
    const minioId=await create('minio',privateConfig.roles.minio.config,{Mounts:[mount(volumeNames.minio,'/data',false,'volume')]});await docker.start(minioId);await ready(docker,minioId);
    const inventory=await helper(docker,helperImage,apiPseudo,'inventory',{network:networkName});await writeJsonNew(path.join(target,'inventory-before-fencing.json'),inventory);
    if(inventory.businessSha256!==manifest.inventory.businessSha256||inventory.registrySha256!==manifest.inventory.registrySha256)fail('RESTORE_INVENTORY_MISMATCH');
    const fenced=await helper(docker,helperImage,apiPseudo,'fence-restored',{network:networkName,targetId:marker.targetId});await writeJsonNew(path.join(target,'session-fencing.json'),fenced);
    const audited=await helper(docker,helperImage,apiPseudo,'audit-models',{network:networkName,allowFailure:true});await writeJsonNew(path.join(target,'model-audit.json'),audited);if(audited.status!=='PASS')fail('RESTORE_MODEL_AUDIT_FAILED');
    const after=await helper(docker,helperImage,apiPseudo,'inventory',{network:networkName});
    const fencingValidation=validateRestoreFencing(inventory,after,fenced,marker.targetId);await writeJsonNew(path.join(target,'fencing-validation.json'),fencingValidation);
    await writeJsonNew(path.join(target,'inventory-after-fencing.json'),after);
    const recovery=await helper(docker,helperImage,apiPseudo,'recover',{network:networkName,mounts:[mount(volumeNames.staging,'/var/lib/wfc/model-imports',false,'volume')],targetId:marker.targetId});await writeJsonNew(path.join(target,'recovery-dry-run.json'),recovery);
    marker.state='verified-quarantine';await saveMarker();
    // Expose only after full inventory, durable fencing and every ready raw resource SHA have passed.
    const apiId=await create('api',{...apiPrivate,Env:apiEnv},{Mounts:[mount(volumeNames.staging,'/var/lib/wfc/model-imports',false,'volume')],StopTimeout:45});await docker.start(apiId);await ready(docker,apiId);
    await freePort(Number(options.httpPort));const webId=await create('web',privateConfig.roles.web.config,{PortBindings:{'80/tcp':[{HostIp:'127.0.0.1',HostPort:String(options.httpPort)}]}});await docker.start(webId);const web=await ready(docker,webId);if(!(web.NetworkSettings.Ports?.['80/tcp']??[]).some(item=>item.HostIp==='127.0.0.1'&&item.HostPort===String(options.httpPort)))fail('RESTORE_PORT_NOT_PUBLISHED');marker.httpHealth=await waitLoopbackHealth(origin);
    marker.state='ready';marker.jwtRotated=true;marker.oldSessionBindingsRetainedAndRevoked=true;await saveMarker();
    return{schemaVersion:1,command:'restore',status:'PASS',targetId:marker.targetId,project:marker.project,origin,targetRoot:target,quarantineGatesPassed:true,offlineImages:true,sourceUnchanged:true,modelAudit:audited.totals,sessionFencing:fenced};
  }catch(error){marker.state='failed-quarantine';marker.failure='RESTORE_GATE_FAILED';await saveMarker().catch(()=>undefined);for(const entry of created.filter(item=>['api','web'].includes(item.role)))await docker.stop(entry.id,45).catch(()=>undefined);throw error;}
}
export async function targetCommand(options,command,{docker:provided}={}){
  const docker=provided??await createDocker(),{root,marker}=await readTarget(options.targetRoot);if(marker.state!=='ready'&&marker.state!=='verified-quarantine')fail('TARGET_NOT_VERIFIED');
  const api=await validateOwnedTarget(docker,marker);
  if(command==='recover'&&options.apply&&api.State.Running)fail('TARGET_API_MUST_BE_STOPPED');
  const helperImage=imageId(options.helperImage);return{...await helper(docker,helperImage,api,command,{network:marker.network.name,mounts:[mount(marker.volumes.staging,'/var/lib/wfc/model-imports',!!(!options.apply),'volume')],targetId:marker.targetId,apply:!!options.apply}),targetRoot:root};
}
export async function validateOwnedTarget(docker,marker){
  const owned=value=>value?.['wfc.operations.target']===marker.targetId&&value?.['wfc.operations.project']===marker.project&&value?.['wfc.operations.owned']==='true';
  if(!Array.isArray(marker.containers)||marker.containers.length!==4||new Set(marker.containers.map(item=>item.id)).size!==4||!marker.network||marker.network.name!==marker.project+'-private'||!marker.frontNetwork||marker.frontNetwork.name!==marker.project+'-front'||marker.frontNetwork.id===marker.network.id)fail('OWNED_TARGET_REQUIRED');
  for(const role of ['postgres','minio','staging']){const expected=marker.project+'-'+role;if(marker.volumes?.[role]!==expected)fail('OWNED_TARGET_REQUIRED');const volume=await docker.request('GET','/volumes/'+encodeURIComponent(expected));if(volume.Name!==expected||!owned(volume.Labels))fail('OWNED_TARGET_REQUIRED');}
  const network=await docker.request('GET','/networks/'+encodeURIComponent(marker.network.id));if(network.Id!==marker.network.id||network.Name!==marker.network.name||!network.Internal||!owned(network.Labels))fail('OWNED_TARGET_REQUIRED');
  const front=await docker.request('GET','/networks/'+encodeURIComponent(marker.frontNetwork.id));if(front.Id!==marker.frontNetwork.id||front.Name!==marker.frontNetwork.name||front.Internal||!owned(front.Labels))fail('OWNED_TARGET_REQUIRED');
  const containers={};
  for(const role of ['postgres','minio','api','web']){const entry=marker.containers.find(item=>item.role===role);if(!entry)fail('OWNED_TARGET_REQUIRED');const value=await docker.inspect(entry.id);if(value.Id!==entry.id||value.Name!=='/'+marker.project+'-'+role||!owned(value.Config.Labels)||Object.keys(value.NetworkSettings.Networks).length!==(role==='web'?2:1)||value.NetworkSettings.Networks[marker.network.name]?.NetworkID!==network.Id||role==='web'&&value.NetworkSettings.Networks[marker.frontNetwork.name]?.NetworkID!==front.Id)fail('OWNED_TARGET_REQUIRED');containers[role]=value;}
  for(const[role,volume,destination]of [['api','staging','/var/lib/wfc/model-imports'],['postgres','postgres','/var/lib/postgresql'],['minio','minio','/data']]){const actual=containers[role].Mounts;if(actual.length!==1||actual[0].Type!=='volume'||actual[0].Name!==marker.volumes[volume]||actual[0].Destination!==destination)fail('OWNED_TARGET_REQUIRED');}
  if(containers.web.Mounts.length)fail('OWNED_TARGET_REQUIRED');
  const database=new URL(environment(containers.api).get('DATABASE_URL'));
  for(const current of await docker.containers())if(current.State.Running&&current.Id!==containers.api.Id){if(isDatabaseClient(current,containers.postgres,database))fail('UNDECLARED_DATABASE_WRITER');if(isMinioClient(current,containers.minio))fail('UNDECLARED_STORAGE_CLIENT');}
  return containers.api;
}
function argumentsFrom(args){const options={appContainers:[],webContainers:[]};const names={'destination-root':'destinationRoot','postgres-container':'postgresContainer','minio-container':'minioContainer','helper-image':'helperImage','private-config-out':'privateConfigOut','source-inventory':'sourceInventory','postgres-user':'postgresUser','postgres-database':'postgresDatabase','stop-timeout-seconds':'stopTimeoutSeconds','target-root':'targetRoot','private-config':'privateConfig','http-port':'httpPort',backup:'backup',project:'project'};for(let i=0;i<args.length;i++){const key=args[i].slice(2);if(!args[i].startsWith('--'))fail('ARGUMENT_INVALID');if(key==='apply'){options.apply=true;continue;}const value=args[++i];if(!value||value.startsWith('--'))fail('ARGUMENT_INVALID');if(key==='app-container')options.appContainers.push(value);else if(key==='web-container')options.webContainers.push(value);else if(names[key]&&options[names[key]]===undefined)options[names[key]]=value;else fail('ARGUMENT_INVALID');}return options;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const[command,...args]=process.argv.slice(2),options=argumentsFrom(args);let result;if(command==='backup')result=await backup(options);else if(command==='verify'){const verified=await verifyBackup(options.backup);for(const image of verified.manifest.images)await verifyImageArchive(path.join(verified.directory,image.archive),image);result={schemaVersion:1,command,status:'PASS',backupId:verified.manifest.backupId,files:verified.manifest.files.length};}else if(command==='restore')result=await restore(options);else if(command==='audit-models'||command==='recover')result=await targetCommand(options,command);else fail('COMMAND_INVALID');console.log(JSON.stringify(result));}catch(error){console.log(JSON.stringify({schemaVersion:1,status:'FAIL',code:/^[A-Z0-9_]{3,80}$/.test(error.code??'')?error.code:'OPERATIONS_FAILED'}));process.exitCode=1;}
}
