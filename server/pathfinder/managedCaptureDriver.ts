import {randomUUID} from 'node:crypto';
import {validateEnvelope,type BridgeEnvelope,type ModelCaptureRequest} from '../../viewer-runtime/protocol.mjs';
import {planModelCaptureInput,validateModelCaptureInputAck,validateModelCaptureInputScope} from '../../viewer-runtime/capture-input.mjs';
import {createModelCaptureAssembler} from '../../viewer-runtime/model-capture.mjs';
import {verifyCompletedCaptureEvidence,bindCompletedCaptureEvidence} from '../../viewer-runtime/capture-evidence.mjs';
import {validatePreparationDiscoveryPage,validatePreparationDiscoveryRequest,type PreparationDiscoveryRequest} from '../../viewer-runtime/preparation-input.mjs';
import {snapshotSchema} from './contracts.js';
import {PathFinderError} from './errors.js';

type Identity={instanceId:string;projectId:string;modelVersionId:string;loadId:string;sessionId:string};
const fail=(code:string):never=>{throw new PathFinderError(code,502,'The protected managed capture is incomplete or changed.');};
/** Same staged input, pure assembler and evidence validators as the human Viewer.
 * Only fixed capture bridge envelopes cross the transport. */
export function createManagedCaptureDriver(options:{identity:Identity;selectionRevision:string;contentFingerprint:string;signal:AbortSignal;
 exchange(envelope:BridgeEnvelope):Promise<unknown>;close():Promise<{joined:true}>}){
  const identity=Object.freeze({...options.identity});let closed=false,responses=0,closing:Promise<{joined:true}>|undefined;
  const close=()=>{closed=true;options.signal.removeEventListener('abort',aborted);return closing??=options.close();};
  const aborted=()=>{void close().catch(()=>undefined);};
  options.signal.addEventListener('abort',aborted,{once:true});if(options.signal.aborted)aborted();
  const current=()=>{options.signal.throwIfAborted();if(closed)fail('MANAGED_CAPTURE_CLOSED');};
  const round=async(type:string,payload:Record<string,unknown>,expected:string)=>{
    current();if(++responses>4096)fail('MANAGED_CAPTURE_COMMAND_LIMIT');
    const envelope={channel:'wfc-routings-viewer',protocolVersion:1,...identity,requestId:randomUUID(),type,payload};
    const {sessionId:_session,...message}=envelope;
    if(!validateEnvelope(message,'parent-to-frame'))fail('MANAGED_CAPTURE_COMMAND_INVALID');
    const reply=validateEnvelope(await options.exchange(message as BridgeEnvelope),'frame-to-parent');current();
    if(!reply||reply.type!==expected||reply.requestId!==message.requestId||['instanceId','projectId','modelVersionId','loadId'].some(key=>reply[key as keyof typeof reply]!==identity[key as keyof Identity]))return fail('MANAGED_CAPTURE_RESPONSE_INVALID');
    return reply;
  };
  return Object.freeze({identity,assertCurrent:current,
    async discover(request:PreparationDiscoveryRequest){
      if(!validatePreparationDiscoveryRequest(request))fail('MANAGED_DISCOVERY_REQUEST_INVALID');
      const reply=await round('READ_PREPARATION_OBJECTS',{...request},'PREPARATION_OBJECTS');
      if(!validatePreparationDiscoveryPage(reply.payload))return fail('MANAGED_DISCOVERY_RESPONSE_INVALID');return reply.payload;
    },
    async capture(request:ModelCaptureRequest){
      current();if('lookupRouteCodes'in request||!request.preparationSlice)return fail('MANAGED_CAPTURE_PREPARATION_ONLY');
      const slice=request.preparationSlice;
      const {sessionId:_session,...envelopeIdentity}=identity;
      const captureId=randomUUID(),plan=await planModelCaptureInput(request,{captureId,envelopeIdentity,signal:options.signal});current();
      let count=0;
      const captureRound=async(type:string,payload:Record<string,unknown>,expected:string)=>{if(++count>3000)fail('MANAGED_CAPTURE_RESPONSE_LIMIT');return round(type,payload,expected);};
      const acknowledged=(reply:BridgeEnvelope,received:number)=>{
        const ack=reply.payload,ready=received===plan.descriptor.equipmentNameCount;
        if(!validateModelCaptureInputAck(ack)||ack.captureId!==captureId||ack.receivedNameCount!==received||ack.phase!==(ready?'ready':'receiving')||
          ack.scopeSha256!==(ready?plan.descriptor.scopeSha256:null)||ack.equipmentNamesSha256!==(ready?plan.descriptor.equipmentNamesSha256:null))fail('MANAGED_CAPTURE_INPUT_MISMATCH');
      };
      acknowledged(await captureRound('START_MODEL_CAPTURE',plan.startPayload,'MODEL_CAPTURE_INPUT_ACK'),0);
      for(const chunk of plan.chunks)acknowledged(await captureRound('READ_MODEL_CAPTURE',{...chunk},'MODEL_CAPTURE_INPUT_ACK'),chunk.equipmentOffset+chunk.equipmentNames.length);
      const assembler=createModelCaptureAssembler({eventLimit:3000-1-plan.descriptor.chunkCount});
      for(let index=0;index<3000;index++){
        const reply=await captureRound('READ_MODEL_CAPTURE',{captureId,index},'MODEL_CAPTURE_EVENT');
        if(reply.payload.captureId!==captureId||reply.payload.index!==index)fail('MANAGED_CAPTURE_EVENT_MISMATCH');
        const event=JSON.parse(String(reply.payload.eventJson));assembler.accept(event);
        if(reply.payload.done===true){
          if(event.type!=='complete')fail('MANAGED_CAPTURE_COMPLETION_MISMATCH');
          const snapshot=snapshotSchema.parse(assembler.finish()),summary=assembler.summary(),scope=snapshot.capture.inputScope;
          if(!validateModelCaptureInputScope(scope)||Object.entries(plan.descriptor).some(([key,value])=>scope[key as keyof typeof scope]!==value))fail('MANAGED_CAPTURE_SCOPE_MISMATCH');
          const rawScope=summary.scope as Record<string,unknown>|undefined;
          if(!rawScope||JSON.stringify(rawScope.preparationSlice)!==JSON.stringify(plan.request.preparationSlice)||JSON.stringify(rawScope.equipmentNames)!==JSON.stringify(plan.request.equipmentNames)||JSON.stringify(rawScope.inputScope)!==JSON.stringify(scope))fail('MANAGED_CAPTURE_SUMMARY_MISMATCH');
          const evidence=summary.completedEvidence;
          if(!evidence||!await verifyCompletedCaptureEvidence(evidence)||evidence.binding.projectId!==identity.projectId||evidence.binding.modelVersionId!==identity.modelVersionId||
            evidence.binding.contentFingerprint!==options.contentFingerprint||evidence.binding.loadId!==identity.loadId||evidence.binding.captureId!==captureId||
            evidence.binding.sessionId!==slice.sessionId||evidence.binding.partId!==slice.partId||evidence.binding.planSha256!==slice.planSha256||evidence.binding.coordinateFrameId!==slice.coordinateFrameId)return fail('MANAGED_CAPTURE_EVIDENCE_MISMATCH');
          const bound=await bindCompletedCaptureEvidence(evidence,{selectionRevision:options.selectionRevision,partPayloadSha256:null});current();return{snapshot,evidence:bound};
        }
        if(event.type==='complete')fail('MANAGED_CAPTURE_COMPLETION_MISMATCH');
      }
      return fail('MANAGED_CAPTURE_EVENT_LIMIT');
    },
    close,
  });
}
