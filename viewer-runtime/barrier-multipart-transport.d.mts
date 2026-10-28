import type { BarrierMultipartAdmitCommand, BarrierMultipartAdmitReceipt, BarrierMultipartStageReceipt, BarrierMultipartCancelReceipt,
  BarrierMultipartMutationCommand, BarrierMultipartProducerCompletionReceipt } from '../shared/pathfinderBarrierMultipartSessions.js';
import type { BarrierMultipartPage, BarrierMultipartSeal, BarrierMultipartSha256 } from '../shared/pathfinderBarrierMultipart.js';
import type { BarrierFrameObservation } from './barrier-capture.mjs';
import type { BarrierMultipartStart, BarrierMultipartContext, BarrierMultipartStatus, BarrierMultipartProducerCompletionEvidence } from './barrier-multipart-protocol.mjs';
export type BarrierMultipartTransportEvent = {kind:'page';page:BarrierMultipartPage}|{kind:'seal';seal:BarrierMultipartSeal}|{kind:'part';partIndex:number;planSealSha256:string;bytes:Uint8Array};
export type BarrierMultipartPendingCommand = {command:BarrierMultipartMutationCommand;commandSha256:string;rawBytes:number;rawSha256:string|null};
export type BarrierMultipartWriter = Readonly<{context:BarrierMultipartContext;
  snapshot():BarrierMultipartStatus;
  stage(event:BarrierMultipartTransportEvent,options?:{signal?:AbortSignal}):Promise<BarrierMultipartStageReceipt>;
  readPages(kind:BarrierMultipartPage['kind'],options?:{signal?:AbortSignal}):AsyncGenerator<BarrierMultipartPage,void>;
  completeProducer(evidence:BarrierMultipartProducerCompletionEvidence,options?:{signal?:AbortSignal}):Promise<BarrierMultipartProducerCompletionReceipt>;
  readCompletion(options?:{signal?:AbortSignal}):Promise<BarrierMultipartProducerCompletionReceipt|null>;
  completion():BarrierMultipartProducerCompletionReceipt|null;
  cancel(options?:{signal?:AbortSignal}):Promise<BarrierMultipartCancelReceipt>;
  reconcile(idempotencyKey:string,options?:{signal?:AbortSignal}):Promise<BarrierMultipartStageReceipt|BarrierMultipartCancelReceipt|BarrierMultipartProducerCompletionReceipt>;
  upload(events:AsyncIterable<BarrierMultipartTransportEvent>|Iterable<BarrierMultipartTransportEvent>,options?:{signal?:AbortSignal}):Promise<BarrierMultipartStatus>;
  pending():BarrierMultipartPendingCommand[];
  refresh(options?:{signal?:AbortSignal}):Promise<BarrierMultipartStatus>;
}>;
/** Trusted owning bridge arguments, never the parsed postMessage payload. */
export function createBarrierMultipartTransport(options:{origin:string;projectId:string;modelVersionId:string;sessionId:string;loadId:string;
  isCurrent:()=>boolean;fetchImpl?:typeof fetch;sha256?:BarrierMultipartSha256;randomUUID?:()=>string;signal?:AbortSignal}):Readonly<{
  admit(command:BarrierMultipartAdmitCommand,frameObservation:BarrierFrameObservation,options?:{signal?:AbortSignal}):Promise<BarrierMultipartAdmitReceipt>;
  open(start:BarrierMultipartStart,options?:{signal?:AbortSignal}):Promise<BarrierMultipartWriter>;
}>;
