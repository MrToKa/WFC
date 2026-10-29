import { generateId } from './generate-id.mjs';
import { validateEnvelope, isUuid, SDK_VERSION } from './protocol.mjs';

const allowed=new Set(['READ_PREPARATION_OBJECTS','START_MODEL_CAPTURE','READ_MODEL_CAPTURE']);
const terminal={INIT:'RUNTIME_READY',LOAD_MODEL:'MODEL_LOADED',READ_PREPARATION_OBJECTS:'PREPARATION_OBJECTS',START_MODEL_CAPTURE:['MODEL_CAPTURE_INPUT_ACK','MODEL_CAPTURE_EVENT'],READ_MODEL_CAPTURE:['MODEL_CAPTURE_INPUT_ACK','MODEL_CAPTURE_EVENT'],DISPOSE:'DISPOSED'};
const fail=code=>Object.assign(new Error(code),{code});

/** A fixed capture-only facade. Neither SDK objects nor a script evaluator are exported. */
export function createProducerHost(window) {
  let configuration,frame,closed=false,helloResolve;
  const pending=new Map(),used=new Set();
  const hello=new Promise(resolve=>{helloResolve=resolve;});
  const receive=event=>{
    if(closed||!configuration||event.origin!==window.location.origin||event.source!==frame?.contentWindow)return;
    const value=validateEnvelope(event.data,'frame-to-parent');
    if(!value||value.projectId!==configuration.projectId||value.instanceId!==configuration.instanceId)return;
    if(value.type==='HELLO'&&value.modelVersionId===null&&value.loadId===null){helloResolve();return;}
    const entry=pending.get(value.requestId);if(!entry)return;
    const handshake=entry.type==='INIT';
    if(value.modelVersionId!==(handshake?null:configuration.modelVersionId)||value.loadId!==(handshake?null:configuration.loadId))return;
    if(value.type==='MODEL_PROGRESS'||value.type==='MODEL_CAPTURE_PROGRESS')return;
    const expected=terminal[entry.type];
    if(value.type!=='ERROR'&&!(Array.isArray(expected)?expected.includes(value.type):expected===value.type))return;
    pending.delete(value.requestId);window.clearTimeout(entry.timer);
    if(value.type==='ERROR')entry.reject(fail(value.payload.code));else entry.resolve(value);
  };
  window.addEventListener('message',receive);
  const exchange=envelope=>{
    if(closed||!configuration||!validateEnvelope(envelope,'parent-to-frame')||envelope.projectId!==configuration.projectId||envelope.instanceId!==configuration.instanceId||used.has(envelope.requestId)||used.size>=4096)throw fail('PRODUCER_COMMAND_REFUSED');
    const handshake=envelope.type==='INIT';
    if(envelope.modelVersionId!==(handshake?null:configuration.modelVersionId)||envelope.loadId!==(handshake?null:configuration.loadId))throw fail('PRODUCER_IDENTITY_MISMATCH');
    if(!terminal[envelope.type])throw fail('PRODUCER_COMMAND_REFUSED');
    used.add(envelope.requestId);
    return new Promise((resolve,reject)=>{
      const timer=window.setTimeout(()=>{pending.delete(envelope.requestId);reject(fail('PRODUCER_COMMAND_TIMEOUT'));},envelope.type==='LOAD_MODEL'?300000:125000);
      pending.set(envelope.requestId,{type:envelope.type,resolve,reject,timer});
      frame.contentWindow.postMessage(envelope,window.location.origin);
    });
  };
  const envelope=(type,payload,handshake=false)=>({channel:'wfc-routings-viewer',protocolVersion:1,instanceId:configuration.instanceId,projectId:configuration.projectId,
    modelVersionId:handshake?null:configuration.modelVersionId,loadId:handshake?null:configuration.loadId,requestId:generateId(window.crypto),type,payload});
  return Object.freeze({
    async initialize(input){
      const keys=['instanceId','projectId','modelVersionId','loadId','sessionId'];
      if(configuration||closed||!input||Object.keys(input).length!==keys.length||!keys.every(key=>isUuid(input[key])))throw fail('PRODUCER_CONFIGURATION_REFUSED');
      configuration=Object.freeze({...input});frame=window.document.createElement('iframe');
      frame.title='Protected managed model';frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.referrerPolicy='same-origin';
      // Extraction reads model-space fragments, never screen pixels. Keep the
      // private software-rendered surface small; exact A/B qualification still
      // checks every captured coordinate and object against the user Viewer.
      frame.style.cssText='display:block;width:320px;height:240px;border:0';
      frame.src=`/viewer-runtime/7.130.0/producer.html?instanceId=${input.instanceId}&projectId=${input.projectId}`;
      window.document.body.append(frame);
      let timer;try{await Promise.race([hello,new Promise((_,reject)=>{timer=window.setTimeout(()=>reject(fail('PRODUCER_HELLO_TIMEOUT')),15000);})]);}finally{window.clearTimeout(timer);}
      const initialized=await exchange(envelope('INIT',{locale:'en',expectedSdkVersion:SDK_VERSION},true));
      if(initialized.payload.sdkVersion!==SDK_VERSION)throw fail('PRODUCER_SDK_MISMATCH');
      await exchange(envelope('LOAD_MODEL',{sessionId:input.sessionId}));
      return {schemaVersion:'wfc.pf.producer-host-ready.v1',...configuration,sdkVersion:SDK_VERSION};
    },
    exchange(value){if(!allowed.has(value?.type))throw fail('PRODUCER_COMMAND_REFUSED');return exchange(value);},
    async dispose(){
      if(closed)return;
      try{if(configuration&&frame)await exchange(envelope('DISPOSE',{reason:'unmount'}));}
      finally{closed=true;window.removeEventListener('message',receive);for(const entry of pending.values()){window.clearTimeout(entry.timer);entry.reject(fail('PRODUCER_CLOSED'));}pending.clear();frame?.remove();}
    },
  });
}

// The helper's fixed page only. This name never exposes Viewer globals.
if(typeof window!=='undefined'&&window.parent===window){
  Object.defineProperty(window,'wfcManagedPreparation',{value:createProducerHost(window),writable:false,configurable:false});
}
