import {createHash} from 'node:crypto';
import {setTimeout as defaultDelay} from 'node:timers/promises';
import {createProducerProfile} from './container-profile.mjs';
import {openManagedClient} from './managed-client.mjs';
import {createManagedResourceBroker} from './resource-broker.mjs';
import {validateManagedIdentity} from './managed-runner.mjs';

const ORIGIN='http://127.0.0.1:5191',PREFIX='/api/pathfinder-producer-control';
const fail=code=>Object.assign(new Error(code),{code});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const boundedJson=async response=>{
  let size=0;const chunks=[];for await(const bytes of response.body){size+=bytes.length;if(size>96*1024)throw fail('PRODUCER_CONTROL_RESPONSE_LIMIT');chunks.push(bytes);}
  if(!response.ok)throw fail('PRODUCER_CONTROL_UNAVAILABLE');return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
/** One local installation daemon; helpers have no network/socket/credentials.
 * This service cannot enable grants or invoke human APIs. */
export async function runManagedHostWorker({configuration,seccompBytes,seccompSha256,journal,beforeStart,signal,observe=()=>{}},dependencies={}){
  const {openClient=openManagedClient,createBroker=createManagedResourceBroker,delay=defaultDelay,fetch=globalThis.fetch}=dependencies;
  if(!configuration||!/^[a-f0-9]{64}$/.test(configuration.key??'')||sha(seccompBytes)!==seccompSha256||typeof beforeStart!=='function'||!journal||['list','retain','retire'].some(key=>typeof journal[key]!=='function'))throw fail('PRODUCER_HOST_CONFIGURATION');
  let stopped=false,current,lastErrorCode=null;
  const control=async(path,body)=>{
    if(!/^\/(?:claim|[a-f0-9-]{36}\/(?:next|reply|fault|joined))$/.test(path))throw fail('PRODUCER_CONTROL_PATH_REFUSED');
    return boundedJson(await fetch(ORIGIN+PREFIX+path,{method:body===undefined?'GET':'POST',headers:{Origin:ORIGIN,'X-WFC-PF-Control-Key':configuration.key,...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10000)}));
  };
  const flushProofs=async()=>{
    const retained=await journal.list();
    for(const record of retained.slice(0,5)){
      const receipt=await control('/'+record.attemptId+'/joined',record.proof);
      if(receipt.acknowledged!==true)throw fail('PRODUCER_JOIN_ACK_UNKNOWN');await journal.retire(record,receipt);
    }
    if((await journal.list()).length)throw fail('PRODUCER_JOIN_ACK_PENDING');
  };
  const one=async attempt=>{
    const identity=validateManagedIdentity(attempt.identity);
    if(attempt.owner!==configuration.owner||attempt.project!==configuration.project||attempt.image!==configuration.image||attempt.runtimeInventorySha256!==configuration.runtimeInventorySha256||
      attempt.resources?.projectId!==identity.projectId||attempt.resources?.modelVersionId!==identity.modelVersionId||attempt.resources?.sessionId!==identity.sessionId||
      !/^[A-Za-z0-9_-]{43}$/.test(attempt.resources?.capability??'')||!/^[a-f0-9-]{36}$/.test(attempt.attemptId??''))throw fail('PRODUCER_HOST_SCOPE_INVALID');
    const deadline=AbortSignal.timeout(15*60000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
    const headers={Origin:ORIGIN,'X-WFC-PF-Producer-Capability':attempt.resources.capability};
    const base=`/api/projects/${identity.projectId}/model-versions/${identity.modelVersionId}/producer-sessions/${identity.sessionId}/`;
    const broker=createBroker({identity:{projectId:identity.projectId,modelVersionId:identity.modelVersionId,sessionId:identity.sessionId},helperOrigin:'http://127.0.0.1:41733',sourceOrigin:ORIGIN,signal:combined,
      async authorize(_identity,requestSignal){const response=await fetch(ORIGIN+base+'pathfinder-authorization',{headers,redirect:'error',signal:requestSignal});const value=await boundedJson(response);if(value.authorized!==true||value.loadId!==identity.loadId)throw fail('PRODUCER_RESOURCE_AUTHORITY_REVOKED');},
      async readResource(request){
        if(!request.path.startsWith(base))throw fail('PRODUCER_RESOURCE_SCOPE_INVALID');
        const response=await fetch(ORIGIN+request.path,{method:request.method,headers:{...headers,...(request.range?{Range:request.range}:{})},redirect:'error',signal:request.signal});
        const length=response.headers.get('content-length');if(!/^(?:0|[1-9][0-9]{0,10})$/.test(length??'')){await response.body?.cancel();throw fail('PRODUCER_RESOURCE_LENGTH_INVALID');}
        const totalBytes=request.method==='HEAD'||response.status===304?0:Number(length);
        const reader=response.body?.getReader();let readerReleased=false;
        const body={async *[Symbol.asyncIterator](){if(!reader)return;try{for(;;){const value=await reader.read();if(value.done)return;yield value.value;}}finally{reader.releaseLock();readerReleased=true;}}};
        return{status:response.status,headers:Object.fromEntries(response.headers),totalBytes,body,
          async close(){if(readerReleased)await response.body?.cancel();else await reader?.cancel();}};
      },
    });
    const profile=createProducerProfile({owner:configuration.owner,project:configuration.project,attemptId:attempt.attemptId,image:configuration.image,mode:'run',defaultSeccompBytes:seccompBytes,defaultSeccompSha256:seccompSha256});
    let client,failure,joined;
    try{
      // Retain the exact planned helper before Docker can create anything.
      // A duplicate old intent is recovery work, never another fresh launch.
      await beforeStart({attemptId:attempt.attemptId,identity,profile});
      client=await openClient({profile,identity,runtimeInventorySha256:attempt.runtimeInventorySha256,broker,signal:combined,observe});current=client;
      const replies=new Map();
      while(!combined.aborted){
        const next=await control('/'+attempt.attemptId+'/next');if(next.quarantined)throw fail('PRODUCER_SERVER_QUARANTINED');if(next.joined)break;
        const command=next.command;if(!command){await delay(200,undefined,{signal:combined});continue;}
        let value=replies.get(command.requestId);
        if(value===undefined){
          if(command.kind==='close'){joined=await client.close();value=joined;}
          else if(command.kind==='exchange')value=await client.exchange(command.envelope);
          else throw fail('PRODUCER_HOST_COMMAND_INVALID');
          if(replies.size>=4096)throw fail('PRODUCER_HOST_MESSAGE_LIMIT');replies.set(command.requestId,value);
        }
        // Keep the exact reply after an unknown HTTP ACK; never rerun capture.
        let acknowledged=false;
        for(let retry=0;retry<3&&!acknowledged;retry++)try{const receipt=await control('/'+attempt.attemptId+'/reply',{requestId:command.requestId,value});acknowledged=receipt.acknowledged===true;}catch(error){if(retry===2)throw error;await delay(500,undefined,{signal:combined});}
        if(!acknowledged)throw fail('PRODUCER_REPLY_OUTCOME_UNKNOWN');if(command.kind==='close')break;
      }
      if(combined.aborted)throw fail('PRODUCER_HOST_CANCELLED');
    }catch(error){failure=error;if(error?.joinProof?.joined===true&&error.joinProof.removed===true)joined=error.joinProof;
      await control('/'+attempt.attemptId+'/fault',{}).catch(()=>undefined);}
    finally{
      current=undefined;
      if(client&&!joined)try{joined=await client.close();}catch(error){failure??=error;if(error?.joinProof?.joined===true&&error.joinProof.removed===true)joined=error.joinProof;}
      if(joined?.joined===true&&joined.removed===true){let retained=false;try{
        // Durable before POST: a lost cleanup ACK can only replay this proof,
        // never launch a replacement helper or rerun captured work.
        await journal.retain({attemptId:attempt.attemptId,proof:joined});retained=true;
      }catch(error){
        const fatal=fail('PRODUCER_JOIN_PROOF_PERSISTENCE_UNKNOWN');
        Object.defineProperty(fatal,'recoveryProof',{value:Object.freeze({attemptId:attempt.attemptId,proof:joined}),enumerable:false});
        Object.defineProperty(fatal,'fatalCleanup',{value:true,enumerable:false});failure=fatal;
      }if(retained)await flushProofs().catch(error=>{failure??=error;});}
      await broker.dispose().catch(error=>{failure??=error;});
    }
    if(failure)throw failure;
  };
  try{while(!stopped&&!signal?.aborted){
    try{await flushProofs();const value=await control('/claim');if(value.attempt)await one(value.attempt);lastErrorCode=null;}
    catch(error){const code=typeof error?.code==='string'&&/^PRODUCER_[A-Z0-9_]+$/.test(error.code)?error.code:'PRODUCER_HOST_UNAVAILABLE';if(code!==lastErrorCode)observe({type:'host-refused',code});lastErrorCode=code;if(error?.fatalCleanup)throw error;}
    await delay(lastErrorCode?10000:1000,undefined,{signal}).catch(()=>{stopped=true;});
  }}finally{stopped=true;if(current)await current.close();}
  return{stopped:true,lastErrorCode};
}
