import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { hasBoundedDockerExecution, boundedDockerCommand, boundedDockerRequest, cleanupBoundedDockerHelper, isDockerBoundsError } from './docker-bounds.mjs';

export class DockerError extends Error { constructor(code) { super(code); this.code=code; } }
const fail=code=>{throw new DockerError(code);};
export const imageId=value=>{if(!/^sha256:[a-f0-9]{64}$/.test(value??''))fail('EXACT_IMAGE_REQUIRED');return value;};
export async function command(args,options={}) {
  if(hasBoundedDockerExecution())return await boundedDockerCommand(args,options);
  const {input,output,maxBytes=16*1024**2,signal}=options;
  const child=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const chunks=[];let count=0,stderrBytes=0;
  child.stderr.on('data',bytes=>{stderrBytes+=bytes.length;}); // Foreign Docker errors can contain private configuration.
  const exited=new Promise((resolve,reject)=>{child.once('error',()=>reject(new DockerError('DOCKER_UNAVAILABLE')));child.once('exit',(code,term)=>resolve({code,term}));});
  const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let reader;
  if(output)reader=pipeline(child.stdout,createWriteStream(output,{flags:'wx',mode:0o600}));
  else reader=(async()=>{for await(const bytes of child.stdout){count+=bytes.length;if(count>maxBytes){child.kill();fail('DOCKER_OUTPUT_LIMIT');}chunks.push(bytes);}})();
  const writer=input?pipeline(typeof input==='string'?createReadStream(input):input,child.stdin):Promise.resolve(child.stdin.end());
  const settled=await Promise.allSettled([reader,writer,exited]);signal?.removeEventListener('abort',abort);
  if(signal?.aborted)fail('OPERATIONS_INTERRUPTED');
  for(const item of settled)if(item.status==='rejected')throw item.reason;
  if(settled[2].value.code!==0)fail('DOCKER_COMMAND_FAILED');
  return Buffer.concat(chunks);
}
export async function jsonCommand(args,options){let value;try{value=JSON.parse((await command(args,options)).toString('utf8'));}catch(error){if(error instanceof DockerError||isDockerBoundsError(error))throw error;fail('DOCKER_RESPONSE_INVALID');}return value;}
export async function createDocker() {
  const context=(await command(['context','inspect','--format','{{(index .Endpoints "docker").Host}}'],{maxBytes:4096})).toString().trim();
  let socketPath;if(context.startsWith('npipe:////./pipe/'))socketPath='\\\\.\\pipe\\'+context.slice('npipe:////./pipe/'.length);else if(context.startsWith('unix://'))socketPath=context.slice(7);else fail('LOCAL_DOCKER_CONTEXT_REQUIRED');
  async function request(method,url,body,{timeoutMs=120000}={}){
    if(hasBoundedDockerExecution())return await boundedDockerRequest(socketPath,method,url,body,{timeoutMs});
    const encoded=body===undefined?undefined:Buffer.from(JSON.stringify(body));
    return await new Promise((resolve,reject)=>{const req=http.request({socketPath,path:'/v1.47'+url,method,headers:encoded?{'Content-Type':'application/json','Content-Length':encoded.length}:{},timeout:timeoutMs},res=>{const chunks=[];let length=0;res.on('data',bytes=>{length+=bytes.length;if(length>32*1024**2){req.destroy();reject(new DockerError('DOCKER_OUTPUT_LIMIT'));}else chunks.push(bytes);});res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(new DockerError('DOCKER_REQUEST_FAILED'));const raw=Buffer.concat(chunks);if(!raw.length)return resolve(null);try{resolve(JSON.parse(raw.toString()));}catch{reject(new DockerError('DOCKER_RESPONSE_INVALID'));}});});req.on('timeout',()=>req.destroy());req.on('error',()=>reject(new DockerError('DOCKER_REQUEST_FAILED')));req.end(encoded);});
  }
  const inspect=async name=>(await jsonCommand(['inspect',name]))[0];
  const inspectImage=async id=>(await jsonCommand(['image','inspect',imageId(id)]))[0];
  const all=async()=>await jsonCommand(['ps','--all','--no-trunc','--format','json']).catch(async()=>{
    const rows=(await command(['ps','--all','--quiet','--no-trunc'])).toString().trim().split(/\r?\n/).filter(Boolean);return await Promise.all(rows.map(inspect));
  });
  return {request,inspect,inspectImage,all,command,
    async containers(){const ids=(await command(['ps','--all','--quiet','--no-trunc'])).toString().trim().split(/\r?\n/).filter(Boolean);return await Promise.all(ids.map(inspect));},
    async create(name,config){if(!/^[a-z0-9][a-z0-9_.-]{0,120}$/.test(name))fail('DOCKER_NAME_INVALID');return await request('POST','/containers/create?name='+encodeURIComponent(name),config);},
    async start(id){await request('POST','/containers/'+id+'/start');},
    async stop(id,seconds=45){await request('POST','/containers/'+id+'/stop?t='+seconds);},
    async remove(id){await request('DELETE','/containers/'+id+'?v=false');},
    async wait(id){return await request('POST','/containers/'+id+'/wait?condition=not-running',undefined,{timeoutMs:4*60*60*1000});},
    async run(image,{env=[],mounts=[],network,cmd,labels={},user='0'}={}){
      await inspectImage(image);const name='wfc-ops-'+randomUUID(),created=await request('POST','/containers/create?name='+name,{Image:image,User:user,Env:env,Cmd:cmd,Labels:{'wfc.operations.temporary':'true',...labels},HostConfig:{NetworkMode:network??'none',Mounts:mounts,AutoRemove:false,ReadonlyRootfs:false},AttachStdout:true,AttachStderr:true});
      if(hasBoundedDockerExecution()){
        let result,primary,failed=false;
        try{await request('POST','/containers/'+created.Id+'/start');const exited=await request('POST','/containers/'+created.Id+'/wait?condition=not-running');const bytes=await command(['logs',created.Id],{maxBytes:32*1024**2});try{result=JSON.parse(bytes.toString().trim());}catch{fail('HELPER_RESPONSE_INVALID');}if(exited.StatusCode!==0&&result.status!=='FAIL'&&result.status!=='DEFERRED')fail('HELPER_FAILED');}
        catch(error){failed=true;primary=error;}
        try{await cleanupBoundedDockerHelper(created.Id);}catch(error){throw new AggregateError(failed?[primary,error]:[error],'Bounded helper cleanup is unconfirmed.');}
        if(failed)throw primary;return result;
      }
      try{await request('POST','/containers/'+created.Id+'/start');const exited=await request('POST','/containers/'+created.Id+'/wait?condition=not-running',undefined,{timeoutMs:4*60*60*1000});const bytes=await command(['logs',created.Id],{maxBytes:32*1024**2});let result;try{result=JSON.parse(bytes.toString().trim());}catch{fail('HELPER_RESPONSE_INVALID');}if(exited.StatusCode!==0&&result.status!=='FAIL'&&result.status!=='DEFERRED')fail('HELPER_FAILED');return result;}finally{const current=await inspect(created.Id).catch(()=>null);if(current?.State?.Running)await request('POST','/containers/'+created.Id+'/stop?t=45').catch(()=>undefined);await request('DELETE','/containers/'+created.Id+'?v=false').catch(()=>undefined);}
    }
  };
}
export function environment(config){const result=new Map();for(const value of config.Config?.Env??[]){const index=value.indexOf('=');if(index>0)result.set(value.slice(0,index),value.slice(index+1));}return result;}
export function publicContainer(container){return{id:container.Id,name:container.Name.replace(/^\//,''),image:container.Image,running:container.State.Running,startedAt:container.State.StartedAt,exitCode:container.State.ExitCode,oomKilled:container.State.OOMKilled,platform:container.Platform,mounts:(container.Mounts??[]).map(({Type,Name,Source,Destination,RW})=>({type:Type,...(Name?{name:Name}:{}),...(Type==='bind'?{source:Source}:{}),destination:Destination,writable:RW}))};}
export function dataMount(container,destination){const mount=container.Mounts?.find(item=>item.Destination===destination);if(!mount||!['bind','volume'].includes(mount.Type))fail('DATA_MOUNT_REQUIRED');return{Type:mount.Type,Source:mount.Type==='volume'?mount.Name:mount.Source,Target:'/source',ReadOnly:true};}
export async function writePrivateJson(filename,value){const handle=await fs.open(filename,'wx',0o600);try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}if(process.platform==='win32'){
  // ACL changes receive only the current account and file path; private values never become arguments.
  const account=process.env.USERDOMAIN+'\\'+process.env.USERNAME;
  await new Promise((resolve,reject)=>{const child=spawn('icacls',[filename,'/inheritance:r','/grant:r',account+':(R,W)'],{windowsHide:true,stdio:'ignore'});child.once('error',()=>reject(new DockerError('PRIVATE_ACL_FAILED')));child.once('exit',code=>code===0?resolve():reject(new DockerError('PRIVATE_ACL_FAILED')));});
}}
