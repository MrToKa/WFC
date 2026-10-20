import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { canonicalPurposeJson, policyUuidSchema, policyHashSchema } from '../../shared/pathfinderPurposePolicy.js';
import { PREPARATION_LIMITS, preparationPlanSchema, preparationCountsSchema } from '../../shared/pathfinderPreparation.js';
import { mergePreparationParts } from '../../shared/preparationMerge.js';
import { snapshotSchema, type ComputationalSnapshot } from './contracts.js';
import { validateSnapshotStructure } from './matching.js';
import { preparationCapacity, preparationCapacityProfileSchema } from '../../shared/pathfinderCapacity.js';
import { preparationPlanHashInput, type PreparationPlan } from '../../shared/pathfinderPreparation.js';
import { createHash } from 'node:crypto';

// stagedInputBytes retains the historical default; each frozen plan supplies the effective input bound.
export const preparationUnionPolicy=Object.freeze({stagedInputBytes:PREPARATION_LIMITS.validationInputBytes,oldGenerationMiB:512,milliseconds:120000,rssBytes:2*1024**3,rssIntervalMilliseconds:100,joinMilliseconds:10000});
const blob=z.object({schemaVersion:z.string().min(1).max(256),payloadRef:policyUuidSchema,sha256:policyHashSchema,bytes:z.number().int().positive().max(PREPARATION_LIMITS.unionBytes)}).strict();
export const preparationUnionResultSchema=z.object({snapshotId:policyUuidSchema,projection:blob.extend({schemaVersion:z.literal('pathfinder.model.snapshot.v1')}),traceIndex:blob.extend({schemaVersion:z.literal('wfc.pf.preparation-trace-index.v1')}),counts:preparationCountsSchema}).strict().refine(value=>value.snapshotId===value.projection.payloadRef&&value.traceIndex.payloadRef!==value.snapshotId&&value.counts.physicalLeaves>0);
export type PreparationUnionResult=z.infer<typeof preparationUnionResultSchema>;
export const preparationUnionInputSchema=z.object({schemaVersion:z.literal('wfc.pf.preparation-union-task.v1'),requestId:policyUuidSchema,snapshotId:policyUuidSchema,plan:preparationPlanSchema,parts:z.array(z.object({partId:policyUuidSchema,payload:z.unknown()}).strict().refine(value=>Object.hasOwn(value,'payload'))).min(1).max(PREPARATION_LIMITS.parts),storageLockBuffer:z.instanceof(SharedArrayBuffer).refine(value=>value.byteLength===4)}).strict();
export const preparationUnionMessageSchema=z.discriminatedUnion('type',[
 z.object({schemaVersion:z.literal('wfc.pf.preparation-union-message.v1'),requestId:policyUuidSchema,type:z.literal('result'),result:preparationUnionResultSchema}).strict(),
 z.object({schemaVersion:z.literal('wfc.pf.preparation-union-message.v1'),requestId:policyUuidSchema,type:z.literal('error'),code:z.enum(['PREPARATION_UNION_INVALID','PREPARATION_UNION_LIMIT','PREPARATION_UNION_STORAGE','PREPARATION_UNION_FAILED'])}).strict(),
]);
export type PreparationUnionTaskInput=z.infer<typeof preparationUnionInputSchema>;
type Stored={sha256:string;bytes:number};
type Blob={payloadRef:string;sha256:string;bytes:number};
export interface PreparationUnionTaskStorage {
 storeSnapshot:(id:string,value:unknown)=>Promise<Stored>;
 storePreparationBlob:(projectId:string,sessionId:string,id:string,value:unknown,limit:number)=>Promise<Blob>;
}

/** Also enforces the effective input ceiling inside the isolated thread. */
export function checkPreparationUnionInputBytes(plan:unknown,parts:{payload?:unknown}[]):void {
 const profile=preparationCapacityProfileSchema.safeParse((plan as Partial<PreparationPlan>|null)?.limitsProfile);
 if(!profile.success)throw new Error('PREPARATION_UNION_LIMIT');
 const maximum=preparationCapacity(profile.data).validationInputBytes;
 if(Buffer.byteLength(JSON.stringify(plan))>PREPARATION_LIMITS.controlBytes)throw new Error('PREPARATION_UNION_LIMIT');
 let bytes=0;for(const part of parts){bytes+=Buffer.byteLength(JSON.stringify(part.payload));if(bytes>maximum)throw new Error('PREPARATION_UNION_LIMIT');}
}

/** All expensive geometry parsing/copying/canonicalization stays off the HTTP loop. */
export async function executePreparationUnionTask(input:PreparationUnionTaskInput,storage:PreparationUnionTaskStorage):Promise<PreparationUnionResult> {
 checkPreparationUnionInputBytes(input.plan,input.parts);
 if(createHash('sha256').update(canonicalPurposeJson(preparationPlanHashInput(input.plan))).digest('hex')!==input.plan.orderedPlanSha256)throw new Error('PREPARATION_UNION_INVALID');
 const parts=input.parts.map(part=>({partId:part.partId,payload:snapshotSchema.parse(part.payload)}));
 const merged=mergePreparationParts(input.plan,parts);
 if(!merged.counts.physicalLeaves)throw new Error('PREPARATION_UNION_INVALID');
 const parsed=snapshotSchema.parse(merged.snapshot);
 // Exactly one canonicalization boundary; object/vertex/triangle array order is retained.
 const snapshot=JSON.parse(canonicalPurposeJson(parsed)) as ComputationalSnapshot;
 validateSnapshotStructure(snapshot);
 // Count/fsync the private projection before creating its computation-cache copy.
 // Thus every new snapshot has quota-accounted backing even if a later step fails.
 const projection=await storage.storePreparationBlob(input.plan.projectId,input.plan.id,input.snapshotId,snapshot,preparationCapacity(input.plan.limitsProfile).projectionInputBytes);
 const saved=await storage.storeSnapshot(input.snapshotId,snapshot);
 if(saved.sha256!==projection.sha256||saved.bytes!==projection.bytes)throw new Error('PREPARATION_UNION_STORAGE');
 const {randomUUID}=await import('node:crypto');
 const trace=await storage.storePreparationBlob(input.plan.projectId,input.plan.id,randomUUID(),merged.traceIndex,PREPARATION_LIMITS.unionBytes);
 return preparationUnionResultSchema.parse({snapshotId:input.snapshotId,projection:{schemaVersion:snapshot.schemaVersion,...projection},traceIndex:{schemaVersion:merged.traceIndex.schemaVersion,...trace},counts:merged.counts});
}

if(!isMainThread&&parentPort&&workerData?.schemaVersion==='wfc.pf.preparation-union-task.v1'){
 const port=parentPort;
 void(async()=>{
  let requestId:string|undefined;
  try{
   const input=preparationUnionInputSchema.parse(workerData);requestId=input.requestId;
   // Must precede the FIRST import of quota storage in this thread.
   (globalThis as typeof globalThis&{__wfcPreparationStorageLock?:SharedArrayBuffer}).__wfcPreparationStorageLock=input.storageLockBuffer;
   const storage=await import('./storage.js'),preparation=await import('./preparationStorage.js');
   const result=await executePreparationUnionTask(input,{storeSnapshot:storage.storeSnapshot,storePreparationBlob:preparation.storePreparationBlob});
   port.postMessage({schemaVersion:'wfc.pf.preparation-union-message.v1',requestId,type:'result',result});
  }catch(error){
   const raw=error instanceof Error?error.message:'';
   const code=raw==='PREPARATION_UNION_LIMIT'?'PREPARATION_UNION_LIMIT':raw==='PREPARATION_UNION_STORAGE'?'PREPARATION_UNION_STORAGE':error instanceof z.ZodError||['PreparationMergeError','PathFinderError'].includes((error as Error)?.name)?'PREPARATION_UNION_INVALID':'PREPARATION_UNION_FAILED';
   if(requestId)port.postMessage({schemaVersion:'wfc.pf.preparation-union-message.v1',requestId,type:'error',code});
   process.exitCode=1;
  }finally{port.close();}
 })();
}
