import type { ViewerDescriptor } from './protocol.mjs';
import type { BarrierMultipartStart, BarrierMultipartStatus, BarrierMultipartProducerProfile } from './barrier-multipart-protocol.mjs';
import type { BarrierFrameObservation } from './barrier-capture.mjs';
import type { createBarrierMultipartTransport } from './barrier-multipart-transport.mjs';
export function createBarrierMultipartRuntime(viewer:unknown, options:{descriptor:ViewerDescriptor;isCurrent:()=>boolean;signal?:AbortSignal}):{
  readFrame(request:{projectId:string;modelVersionId:string;contentFingerprint:string},signal?:AbortSignal):Promise<{frameObservation:BarrierFrameObservation;producerProfile:BarrierMultipartProducerProfile}>;
  start(request:BarrierMultipartStart,transport:ReturnType<typeof createBarrierMultipartTransport>,signal?:AbortSignal):Promise<BarrierMultipartStatus>;
  status(request:{intentId:string}):BarrierMultipartStatus;
  cancel(request:{intentId:string},signal?:AbortSignal):Promise<BarrierMultipartStatus>;
  reconcile(request:{intentId:string},signal?:AbortSignal):Promise<BarrierMultipartStatus>;
  dispose():void;
};
