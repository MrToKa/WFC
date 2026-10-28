import {randomUUID} from 'node:crypto';
import {createProducerProcess} from './producer-process.mjs';
import {createDockerProducerAdapter} from './docker-adapter.mjs';
import {validateManagedInitialize} from './managed-runner.mjs';
import {validateEnvelope} from '../../viewer-runtime/protocol.mjs';

const fail=code=>Object.assign(new Error(code),{code});
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const commands=new Set(['READ_PREPARATION_OBJECTS','START_MODEL_CAPTURE','READ_MODEL_CAPTURE']);
/** Host-owned fixed wire client. The helper receives neither this broker's
 * credentials nor Docker, application volumes, an arbitrary URL or evaluator. */
export async function openManagedClient({profile,identity,runtimeInventorySha256,broker,signal,observe,adapter}){
  if(profile.mode!=='run'||!broker||typeof broker.request!=='function'||typeof broker.dispose!=='function')throw fail('PRODUCER_CLIENT_CONFIGURATION');
  const configuration=validateManagedInitialize({kind:'initialize',identity,runtimeInventorySha256});
  const pending=new Map(),used=new Set();let closing,closed=false;
  const rejectAll=error=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();};
  let process;
  const onMessage=async message=>{
    if(message.type==='request'){
      if(!message.requestId||message.payload?.kind!=='resource')throw fail('PRODUCER_RESOURCE_REQUEST_INVALID');
      const response=await broker.request(message.requestId,message.payload);
      await process.send({type:'response',requestId:message.requestId,payload:response});return;
    }
    if(message.type==='error'){rejectAll(fail(typeof message.payload?.code==='string'&&/^PRODUCER_[A-Z0-9_]{1,95}$/.test(message.payload.code)?message.payload.code:'PRODUCER_REPORTED_FAILURE'));return;}
    if(message.type!=='response')return;
    const entry=pending.get(message.requestId);if(!entry)throw fail('PRODUCER_RESPONSE_IDENTITY');
    const response=message.payload;
    if(entry.kind==='initialize'){
      if(!exact(response,['kind','value'])||response.kind!=='initialized'||response.value?.schemaVersion!=='wfc.pf.producer-host-ready.v1'||response.value.sdkVersion!=='7.130.0'||
        Object.entries(identity).some(([key,value])=>response.value[key]!==value))throw fail('PRODUCER_RESPONSE_IDENTITY');
    }else{
      const envelope=exact(response,['kind','envelope'])&&response.kind==='exchange'?validateEnvelope(response.envelope,'frame-to-parent'):null;
      if(!envelope||envelope.requestId!==entry.envelope.requestId||['instanceId','projectId','modelVersionId','loadId'].some(key=>envelope[key]!==identity[key]))throw fail('PRODUCER_RESPONSE_IDENTITY');
    }
    clearTimeout(entry.timer);pending.delete(message.requestId);entry.resolve(response);
  };
  const aborted=()=>rejectAll(fail('PRODUCER_CLIENT_CANCELLED'));
  signal?.addEventListener('abort',aborted,{once:true});
  process=createProducerProcess(adapter??await createDockerProducerAdapter(profile),profile,{signal,observe:event=>{
    if(event.faultCode||event.state==='quarantined')rejectAll(fail(event.faultCode??'PRODUCER_JOIN_UNKNOWN'));observe?.(event);
  },onMessage});
  const request=async(payload,envelope)=>{
    if(closed||closing||signal?.aborted||pending.size>=16||used.size>=4096)throw fail('PRODUCER_CLIENT_CLOSED');
    const id=envelope?.requestId??randomUUID();if(used.has(id))throw fail('PRODUCER_COMMAND_REPLAY');used.add(id);
    let timer;const reply=new Promise((resolve,reject)=>{
      // INIT (125s), LOAD_MODEL (300s) and HELLO (15s) are sequential
      // inner deadlines. The owning initialization wait must outlive them.
      timer=setTimeout(()=>{pending.delete(id);reject(fail('PRODUCER_COMMAND_TIMEOUT'));void process.stop().catch(()=>undefined);},payload.kind==='initialize'?450000:125000);
      timer.unref?.();pending.set(id,{resolve,reject,timer,kind:payload.kind,envelope});
    });void reply.catch(()=>undefined);
    try{await process.send({type:'start',requestId:id,payload});return await reply;}
    catch(error){clearTimeout(timer);pending.delete(id);throw error;}
  };
  const close=()=>closing??=(async()=>{
    try{
      if(process.snapshot.state==='running')await process.send({type:'close',payload:{}});
      if(!['joined','quarantined'].includes(process.snapshot.state))await process.completed();
      if(process.snapshot.state!=='joined')throw fail('PRODUCER_JOIN_UNKNOWN');
      await broker.dispose();await process.remove();closed=true;signal?.removeEventListener('abort',aborted);rejectAll(fail('PRODUCER_CLIENT_CLOSED'));
      return{joined:true,containerId:process.snapshot.containerId,removed:process.snapshot.removed};
    }catch(error){
      await process.stop().catch(()=>undefined);let brokerJoined=false;
      try{await broker.dispose();brokerJoined=true;}catch{/* A known Docker join does not certify an unknown resource close. */}
      if(process.snapshot.state==='joined')try{await process.remove();}catch{/* Retain any unknown removal outcome. */}
      if(brokerJoined&&process.snapshot.state==='joined'&&process.snapshot.removed){
        closed=true;signal?.removeEventListener('abort',aborted);
        if(error&&typeof error==='object')Object.defineProperty(error,'joinProof',{value:Object.freeze({joined:true,removed:true,containerId:process.snapshot.containerId}),enumerable:false});
      }
      rejectAll(fail('PRODUCER_JOIN_UNKNOWN'));throw error;
    }
  })();
  try{
    await process.start();await request(configuration);
    return Object.freeze({identity:Object.freeze({...identity}),get snapshot(){return process.snapshot;},async exchange(envelope){
      if(!validateEnvelope(envelope,'parent-to-frame')||!commands.has(envelope.type)||['instanceId','projectId','modelVersionId','loadId'].some(key=>envelope[key]!==identity[key]))throw fail('PRODUCER_COMMAND_REFUSED');
      return(await request({kind:'exchange',envelope},envelope)).envelope;
    },close});
  }catch(error){
    try{const metrics=broker.snapshot;observe?.({type:'initialization-refused',attemptId:profile.attemptId,containerId:process.snapshot.containerId,
      code:typeof error?.code==='string'?error.code:'PRODUCER_INITIALIZE_FAILED',resourceRequests:metrics?.requests,resourceBytes:metrics?.bytes,resourceHandles:metrics?.handles});}catch{/* Diagnostics cannot replace owned cleanup. */}
    await process.stop().catch(()=>undefined);let brokerJoined=false;
    try{await broker.dispose();brokerJoined=true;}catch{/* Preserve uncertain resource ownership. */}
    if(process.snapshot.state==='joined')await process.remove().catch(()=>undefined);
    if(brokerJoined&&process.snapshot.state==='joined'&&process.snapshot.removed&&error&&typeof error==='object')
      Object.defineProperty(error,'joinProof',{value:Object.freeze({joined:true,removed:true,containerId:process.snapshot.containerId}),enumerable:false});
    signal?.removeEventListener('abort',aborted);rejectAll(error);throw error;}
}
