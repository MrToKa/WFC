import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createPreparerService } from '../app/service.mjs';
import { createFakeProvider, createFakeCostProvider } from '../index.mjs';
import { simulationResources } from '../app/simulation.mjs';

// These controlled file-handle wrappers exist only in this isolated fixture.
// They pause after actual local bytes, not before entering the operation.
const [phase, action, instanceId] = process.argv.slice(2), emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const dataDirectory='/var/lib/preparer/data', workDirectory='/var/lib/preparer/work', outputDirectory='/var/lib/preparer/outputs';
const accepted=path.join(dataDirectory,'accepted.jsonl'), fixtureFile=path.join(dataDirectory,'fixture.json');
let armed=false, paused=false, currentOp, release, stoppedResolve;
const barrier=new Promise(resolve=>{release=resolve;}), stopped=new Promise(resolve=>{stoppedResolve=resolve;});
async function pause(details) {
  if(!armed || paused)return; paused=true;
  emit({ready:true,phase,...currentOp,...details}); await barrier;
}
const realOpen=fs.promises.open;
fs.promises.open=async function(filename,...args) {
  const handle=await realOpen.call(this,filename,...args), name=String(filename);
  if(action==='run' && phase==='capture' && /\/snapshots\/[^/]+\/\.capture-[^/]+\.tmp$/.test(name)) {
    const write=handle.writeFile.bind(handle);
    handle.writeFile=async(...values)=>{const result=await write(...values);await pause({capturedTemporaryBytes:(await handle.stat()).size});return result;};
  }
  if(action==='run' && phase==='package' && /\/\.routings-stage-[^/]+\/model\.zip$/.test(name)) {
    const write=handle.write.bind(handle);
    handle.write=async(...values)=>{const result=await write(...values);await pause({zipStagingBytes:(await handle.stat()).size});return result;};
  }
  return handle;
};
syncBuiltinESMExports();
const resources=simulationResources(), provider=createFakeProvider({resources,handlers:{
  getStorage:async ctx=>({bucket:ctx.destination.bucket,namespace:ctx.namespace,region:ctx.region}),
  getObject:async ctx=>({objectId:ctx.objectId,bytes:ctx.source.bytes,sha256:ctx.source.sha256}),
  submit:async(ctx,options,fixture)=>{await fsp.appendFile(accepted,JSON.stringify({submissionIdentity:ctx.submissionIdentity,attemptId:options.attemptId})+'\n');return fixture.default();},
  getManifest:async(ctx,_options,fixture)=>{
    try{await fsp.stat(accepted);const observation={status:'success',objectId:ctx.objectId,urn:ctx.urn,submissionIdentity:ctx.submissionIdentity,roots:[{rootId:'root-0',format:'svf',supportProfile:ctx.supportProfile}]};fixture.provider.setManifest(ctx,observation);return observation;}
    catch(error){if(error.code!=='ENOENT')throw error;return fixture.default();}
  },
  readResource:async function*(ctx,options,fixture) {
    if(action==='run' && phase==='download' && armed && options.resourceId==='resource-0') {
      const data=resources[options.resourceId].data, half=Math.floor(data.length/2);
      yield data.subarray(0,half);await pause({resourceId:options.resourceId,partialBytes:half});yield data.subarray(half);
    }else for await(const bytes of fixture.default())yield bytes;
  }
}});
const configuration={mode:'simulation',instanceId,host:'127.0.0.1',port:0,publicOrigin:'http://127.0.0.1:0',dataDirectory,workDirectory,outputDirectory,packageModulePath:'/opt/package/index.mjs',importRoot:null,sourceRoot:null,sdkDirectory:null,configuration:{}};
const service=await createPreparerService({configuration,simulationProvider:provider,simulationCostProvider:createFakeCostProvider(),fault:async(point,details)=>{if(point==='beforeWork')currentOp=details;}});await service.listen();
const csrf=(await(await fetch(service.address+'/api/config')).json()).csrfToken;
async function call(route,input) {
  const response=await fetch(service.address+route,{method:input===undefined?'GET':'POST',headers:input===undefined?{}:{Origin:service.address,'X-Preparer-Token':csrf,'X-Request-Id':randomUUID(),'Content-Type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})});
  const value=await response.json();if(!response.ok)throw new Error(JSON.stringify({status:response.status,route,value}));return value;
}
async function wait(op) {
  for(let n=0;n<1000;n++){const value=(await call('/api/operations/'+op.operationId)).operation;if(!['queued','running'].includes(value.status)){if(value.status!=='succeeded')throw new Error(JSON.stringify(value));return value;}await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Fixture bounded wait exceeded.');
}
async function doAction(jobId,name,awaited=true) {const op=(await call(`/api/jobs/${jobId}/actions`,{action:name})).operation;return awaited?wait(op):op;}
let closing=false;
process.on('SIGTERM',async()=>{if(closing)return;closing=true;const closingService=service.close();release();try{await closingService;emit({stopped:true,phase});process.exitCode=0;}catch(error){emit({stopFailure:error.code||'UNKNOWN'});process.exitCode=1;}finally{stoppedResolve();}});
if(action==='run') {
  if(phase==='capture')armed=true;
  const capture=(await call('/api/simulation/capture',{label:'Docker SIGTERM fixture'})).operation;
  await fsp.writeFile(fixtureFile,JSON.stringify({phase,operationId:capture.operationId,jobId:capture.jobId}));
  if(phase!=='capture') {
    const captured=await wait(capture), jobId=captured.jobId;await doAction(jobId,'approve-cost');await doAction(jobId,'prepare');await doAction(jobId,'reconcile');
    if(phase==='download'){armed=true;const op=await doAction(jobId,'download',false);await fsp.writeFile(fixtureFile,JSON.stringify({phase,operationId:op.operationId,jobId}));}
    else {await doAction(jobId,'download');armed=true;const op=await doAction(jobId,'package',false);await fsp.writeFile(fixtureFile,JSON.stringify({phase,operationId:op.operationId,jobId}));}
  }
  await stopped;
} else {
  const fixture=JSON.parse(await fsp.readFile(fixtureFile)), operation=(await call('/api/operations/'+fixture.operationId)).operation;
  const jobs=(await call('/api/jobs')).jobs, before=jobs.find(job=>job.jobId===fixture.jobId);
  let resumed;
  if(action==='resume' && phase!=='capture')resumed=await doAction(fixture.jobId,phase==='download'?'download':'package');
  let count=0;try{count=(await fsp.readFile(accepted,'utf8')).trim().split('\n').length;}catch(error){if(error.code!=='ENOENT')throw error;}
  const after=(await call('/api/jobs')).jobs.find(job=>job.jobId===fixture.jobId), locks=await fsp.readdir(path.join(dataDirectory,'simulation','core','locks'));
  emit({phase,operationStatus:operation.status,operationError:operation.error?.code??null,jobId:fixture.jobId,jobCount:jobs.length,beforeStatus:before?.status??null,beforeCompleted:before?.facts.download?.completedResources??0,afterStatus:after?.status??null,afterCompleted:after?.facts.download?.completedResources??0,hasPackage:!!after?.facts.package,acceptedCount:count,submitCalls:provider.counts.submit,remainingLocks:locks.length,resumedStatus:resumed?.status??null});
  await service.close();
}
