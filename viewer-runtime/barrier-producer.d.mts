import type { BarrierMultipartScope, BarrierMultipartProfile, BarrierMultipartPage, BarrierMultipartSeal,
  BarrierMultipartSha256 } from '../shared/pathfinderBarrierMultipart.js';
import type { BarrierFrameObservation } from './barrier-capture.mjs';
import type { BarrierMultipartProducerProfile, BarrierMultipartProducerCompletionEvidence } from './barrier-multipart-protocol.mjs';

export const BARRIER_MULTIPART_PRODUCER_LIMITS: Readonly<{ lookupBytes:20971520;metadataBytes:5242880;ancestry:512;chunkBytes:262144;milliseconds:3600000 }>;
export type BarrierMultipartFrameOptions = { loadId:string;isCurrent:()=>boolean;signal?:AbortSignal;startedAt?:number;sha256?:BarrierMultipartSha256 };
export function observeMultipartFrame(viewer:unknown, descriptor:{projectId:string;modelVersionId:string;contentFingerprint:string},
  options:BarrierMultipartFrameOptions):Promise<BarrierFrameObservation>;
export type BarrierMultipartProducerProgress = {phase:'index';nodes:number;fragments:number;lookupBytes:number;metadataBytes:number}
  | {phase:'fragments';loaded:number;total:number} | {phase:'geometry-ranges';loaded:number;fragments:number} | {phase:'parts';loaded:number;total:number};
export type BarrierMultipartProducerOptions = BarrierMultipartFrameOptions & {
  scope:BarrierMultipartScope;profile:BarrierMultipartProfile;frameObservation:BarrierFrameObservation;
  producerProfile?:BarrierMultipartProducerProfile;
  readPages:(kind:'nodes'|'fragments'|'geometry-ranges')=>AsyncIterable<BarrierMultipartPage>|Iterable<BarrierMultipartPage>;
  onProgress?:(value:BarrierMultipartProducerProgress)=>void;
};
export type BarrierMultipartProducerEvent = {kind:'page';page:BarrierMultipartPage}|{kind:'seal';seal:BarrierMultipartSeal};
/** One bounded control event per pull. No geometry codec, collision proof,
 * publication, measured capacity or cable-write authority is produced. */
export function createBarrierMultipartProducer(viewer:unknown, options:BarrierMultipartProducerOptions):AsyncGenerator<BarrierMultipartProducerEvent,void>;
export type BarrierPackedProducerOptions = Omit<BarrierMultipartProducerOptions,'readPages'> & {
  packedContext:{intentId:string;contextSha256:string};
  readPages:(kind:'nodes'|'fragments'|'geometry-ranges'|'plan')=>AsyncIterable<BarrierMultipartPage>|Iterable<BarrierMultipartPage>;
};
export type BarrierPackedProducerEvent = BarrierMultipartProducerEvent | {kind:'part';partIndex:number;planSealSha256:string;bytes:Uint8Array}
  | {kind:'producer-complete';evidence:BarrierMultipartProducerCompletionEvidence};
/** Same-scene bounded original-range payloads; all results remain unqualified. */
export function createBarrierPackedProducer(viewer:unknown,options:BarrierPackedProducerOptions):AsyncGenerator<BarrierPackedProducerEvent,void>;
