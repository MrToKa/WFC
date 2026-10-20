import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { canonicalPurposeJson, policyUuidSchema, policyHashSchema } from '../../shared/pathfinderPurposePolicy.js';
import { PREPARATION_LIMITS, preparationPlanSchema, preparationCountsSchema } from '../../shared/pathfinderPreparation.js';
import { createOwnedPreparationMerge } from '../../shared/preparationMerge.js';
import { snapshotSchema, snapshotObject, type ComputationalSnapshot } from './contracts.js';
import { validateSnapshotStructure } from './matching.js';
import { preparationCapacity, preparationCapacityProfileSchema } from '../../shared/pathfinderCapacity.js';
import { preparationPlanHashInput, type PreparationPlan } from '../../shared/pathfinderPreparation.js';
import { createHash } from 'node:crypto';

// stagedInputBytes retains the historical default; each frozen plan supplies the effective input bound.
export const preparationUnionPolicy=Object.freeze({stagedInputBytes:PREPARATION_LIMITS.validationInputBytes,oldGenerationMiB:512,milliseconds:120000,rssBytes:2*1024**3,rssIntervalMilliseconds:100,joinMilliseconds:10000});
const blob=z.object({schemaVersion:z.string().min(1).max(256),payloadRef:policyUuidSchema,sha256:policyHashSchema,bytes:z.number().int().positive().max(PREPARATION_LIMITS.unionBytes)}).strict();
export const preparationUnionResultSchema=z.object({snapshotId:policyUuidSchema,projection:blob.extend({schemaVersion:z.literal('pathfinder.model.snapshot.v1')}),traceIndex:blob.extend({schemaVersion:z.literal('wfc.pf.preparation-trace-index.v1')}),counts:preparationCountsSchema}).strict().refine(value=>value.snapshotId===value.projection.payloadRef&&value.traceIndex.payloadRef!==value.snapshotId&&value.counts.physicalLeaves>0);
export type PreparationUnionResult=z.infer<typeof preparationUnionResultSchema>;
const inlinePart=z.object({partId:policyUuidSchema,payload:z.unknown()}).strict().refine(value=>Object.hasOwn(value,'payload'));
const partReference=z.object({payloadRef:policyUuidSchema,sha256:policyHashSchema,bytes:z.number().int().positive().max(PREPARATION_LIMITS.partBytes)}).strict();
const referencedPart=z.object({partId:policyUuidSchema,reference:partReference}).strict();
const taskFields={requestId:policyUuidSchema,snapshotId:policyUuidSchema,plan:preparationPlanSchema,storageLockBuffer:z.instanceof(SharedArrayBuffer).refine(value=>value.byteLength===4)};
export const preparationUnionInputSchema=z.discriminatedUnion('schemaVersion',[
 z.object({...taskFields,schemaVersion:z.literal('wfc.pf.preparation-union-task.v1'),parts:z.array(inlinePart).min(1).max(PREPARATION_LIMITS.parts)}).strict(),
 z.object({...taskFields,schemaVersion:z.literal('wfc.pf.preparation-union-task.v2'),parts:z.array(referencedPart).min(1).max(PREPARATION_LIMITS.parts)}).strict(),
]);
export const preparationUnionMessageSchema=z.discriminatedUnion('type',[
 z.object({schemaVersion:z.literal('wfc.pf.preparation-union-message.v1'),requestId:policyUuidSchema,type:z.literal('result'),result:preparationUnionResultSchema}).strict(),
 z.object({schemaVersion:z.literal('wfc.pf.preparation-union-message.v1'),requestId:policyUuidSchema,type:z.literal('error'),code:z.enum(['PREPARATION_UNION_INVALID','PREPARATION_UNION_LIMIT','PREPARATION_UNION_STORAGE','PREPARATION_UNION_FAILED'])}).strict(),
]);
export type PreparationUnionTaskInput=z.infer<typeof preparationUnionInputSchema>;
type Stored={sha256:string;bytes:number};
type Blob={payloadRef:string;sha256:string;bytes:number};
export type PreparationUnionPartReference=Blob;
export type PreparationUnionParts={partId:string;payload:ComputationalSnapshot}[]|{partId:string;reference:PreparationUnionPartReference}[];
export interface PreparationUnionTaskStorage {
 storeSnapshot:(id:string,value:unknown)=>Promise<Stored>;
 storePreparationBlob:(projectId:string,sessionId:string,id:string,value:unknown,limit:number)=>Promise<Blob>;
 readPreparationBlob?:(projectId:string,sessionId:string,reference:PreparationUnionPartReference,limit:number)=>Promise<Buffer>;
 storeSnapshotBytes?:(id:string,value:Buffer)=>Promise<Stored>;
 storePreparationBytes?:(projectId:string,sessionId:string,id:string,value:Buffer,limit:number)=>Promise<Blob>;
}

/** Also enforces the effective input ceiling inside the isolated thread. */
export function checkPreparationUnionInputBytes(plan:unknown,parts:unknown):'inline'|'references' {
 const profile=preparationCapacityProfileSchema.safeParse((plan as Partial<PreparationPlan>|null)?.limitsProfile);
 if(!profile.success)throw new Error('PREPARATION_UNION_LIMIT');
 const maximum=preparationCapacity(profile.data).validationInputBytes;
 if(Buffer.byteLength(JSON.stringify(plan))>PREPARATION_LIMITS.controlBytes)throw new Error('PREPARATION_UNION_LIMIT');
 const parsed=preparationPlanSchema.safeParse(plan);if(!parsed.success||createHash('sha256').update(canonicalPurposeJson(preparationPlanHashInput(parsed.data))).digest('hex')!==parsed.data.orderedPlanSha256)throw new Error('PREPARATION_UNION_LIMIT');
 if(!Array.isArray(parts)||!parts.length||parts.length>PREPARATION_LIMITS.parts)throw new Error('PREPARATION_UNION_LIMIT');
 const mode=Object.hasOwn(parts[0]??{},'reference')?'references':'inline',schema=mode==='references'?referencedPart:inlinePart;
 if(mode==='references'&&parts.length!==parsed.data.partPlan.length)throw new Error('PREPARATION_UNION_LIMIT');
 const expected=new Set(parsed.data.partPlan.map(part=>part.partId)),seen=new Set<string>();
 let bytes=0;
 for(const part of parts){
  const entry=schema.safeParse(part);if(!entry.success||!expected.has(entry.data.partId)||mode==='references'&&seen.has(entry.data.partId))throw new Error('PREPARATION_UNION_LIMIT');seen.add(entry.data.partId);
  bytes+='reference' in entry.data?entry.data.reference.bytes:Buffer.byteLength(JSON.stringify(entry.data.payload));if(bytes>maximum)throw new Error('PREPARATION_UNION_LIMIT');
 }
 if(seen.size!==expected.size)throw new Error('PREPARATION_UNION_LIMIT');
 return mode;
}

const snapshotHeaderSchema=snapshotSchema.omit({objects:true});
const snapshotObjectSlots=z.array(z.unknown()).min(1).max(PREPARATION_LIMITS.objects);
/** Parse the existing strict DTO one object at a time, retaining its transformations.
 * Only freshly decoded, privately owned reference inputs may relinquish raw slots. */
export function parseOwnedPreparationSnapshot(value:unknown):ComputationalSnapshot {
 if(!value||typeof value!=='object'||Array.isArray(value))return snapshotSchema.parse(value);
 const {objects,...header}=value as Record<string,unknown>,parsedHeader=snapshotHeaderSchema.parse(header),slots=snapshotObjectSlots.parse(objects);
 for(let index=0;index<slots.length;index++){slots[index]=snapshotObject.parse(slots[index]);(objects as unknown[])[index]=undefined;}
 return {...parsedHeader,objects:slots as ComputationalSnapshot['objects']};
}
/** Strict snapshot members have fixed nonnumeric keys. Reorder these owned records
 * in place; geometry arrays and binary64 values are never copied or reordered. */
function canonicalizeOwned(value:unknown):void {
 if(Array.isArray(value)){for(let index=0;index<value.length;index++)if(value[index]!==null&&typeof value[index]==='object')canonicalizeOwned(value[index]);return;}
 if(!value||typeof value!=='object')return;
 const record=value as Record<string,unknown>,keys=Object.keys(record).sort(),members=keys.map(key=>record[key]);
 for(const key of keys)delete record[key];
 for(let index=0;index<keys.length;index++){canonicalizeOwned(members[index]);record[keys[index]]=members[index];}
}

/** All expensive geometry parsing/copying/canonicalization stays off the HTTP loop. */
export async function executePreparationUnionTask(input:PreparationUnionTaskInput,storage:PreparationUnionTaskStorage):Promise<PreparationUnionResult> {
 if(createHash('sha256').update(canonicalPurposeJson(preparationPlanHashInput(input.plan))).digest('hex')!==input.plan.orderedPlanSha256)throw new Error('PREPARATION_UNION_INVALID');
 checkPreparationUnionInputBytes(input.plan,input.parts);
 const merge=createOwnedPreparationMerge(input.plan),byId=new Map<string,PreparationUnionTaskInput['parts'][number][]>();
 for(const part of input.parts)byId.set(part.partId,[...(byId.get(part.partId)??[]),part]);
 for(const planned of input.plan.partPlan){
  const entries=byId.get(planned.partId)!,part=entries[0];
  if('reference' in part){
   if(!storage.readPreparationBlob)throw new Error('PREPARATION_UNION_STORAGE');
   const payload=await storage.readPreparationBlob(input.plan.projectId,input.plan.id,part.reference,PREPARATION_LIMITS.partBytes);
   if(payload.length!==part.reference.bytes||createHash('sha256').update(payload).digest('hex')!==part.reference.sha256)throw new Error('PREPARATION_UNION_STORAGE');
   const snapshot=parseOwnedPreparationSnapshot(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload)));merge.addPart(part.partId,snapshot);
  }else{
   const snapshot=snapshotSchema.parse(part.payload);
   // Legacy v1 allowed exact replay entries; strict parsing precedes comparison,
   // preserving identity transforms and the original deterministic deduplication.
   for(const duplicate of entries.slice(1))if(!('payload' in duplicate)||JSON.stringify(snapshot)!==JSON.stringify(snapshotSchema.parse(duplicate.payload)))throw new Error('PREPARATION_UNION_INVALID');
   merge.addPart(part.partId,snapshot);
  }
 }
 const merged=merge.finish();
 if(!merged.counts.physicalLeaves)throw new Error('PREPARATION_UNION_INVALID');
 // Each object/header was parsed strictly once. The merge changes only trusted
 // aggregate proof fields and finite ancestor boxes; no full-geometry reparse.
 const snapshot=merged.snapshot;canonicalizeOwned(snapshot);
 validateSnapshotStructure(snapshot);
 // Count/fsync the private projection before creating its computation-cache copy.
 // Thus every new snapshot has quota-accounted backing even if a later step fails.
 if(Boolean(storage.storePreparationBytes)!==Boolean(storage.storeSnapshotBytes))throw new Error('PREPARATION_UNION_STORAGE');
 const limit=preparationCapacity(input.plan.limitsProfile).projectionInputBytes;
 let projection:Blob,saved:Stored;
 if(storage.storePreparationBytes&&storage.storeSnapshotBytes){
  const bytes=Buffer.from(JSON.stringify(snapshot));if(!bytes.length||bytes.length>limit)throw new Error('PREPARATION_UNION_LIMIT');
  projection=await storage.storePreparationBytes(input.plan.projectId,input.plan.id,input.snapshotId,bytes,limit);
  saved=await storage.storeSnapshotBytes(input.snapshotId,bytes);
 }else{
  projection=await storage.storePreparationBlob(input.plan.projectId,input.plan.id,input.snapshotId,snapshot,limit);
  saved=await storage.storeSnapshot(input.snapshotId,snapshot);
 }
 if(saved.sha256!==projection.sha256||saved.bytes!==projection.bytes)throw new Error('PREPARATION_UNION_STORAGE');
 const {randomUUID}=await import('node:crypto');
 const trace=await storage.storePreparationBlob(input.plan.projectId,input.plan.id,randomUUID(),merged.traceIndex,PREPARATION_LIMITS.unionBytes);
 return preparationUnionResultSchema.parse({snapshotId:input.snapshotId,projection:{schemaVersion:snapshot.schemaVersion,...projection},traceIndex:{schemaVersion:merged.traceIndex.schemaVersion,...trace},counts:merged.counts});
}

if(!isMainThread&&parentPort&&['wfc.pf.preparation-union-task.v1','wfc.pf.preparation-union-task.v2'].includes(workerData?.schemaVersion)){
 const port=parentPort;
 void(async()=>{
  let requestId:string|undefined;
  try{
   const input=preparationUnionInputSchema.parse(workerData);requestId=input.requestId;
   // Must precede the FIRST import of quota storage in this thread.
   (globalThis as typeof globalThis&{__wfcPreparationStorageLock?:SharedArrayBuffer}).__wfcPreparationStorageLock=input.storageLockBuffer;
   const storage=await import('./storage.js'),preparation=await import('./preparationStorage.js');
   const result=await executePreparationUnionTask(input,{storeSnapshot:storage.storeSnapshot,storePreparationBlob:preparation.storePreparationBlob,readPreparationBlob:preparation.readPreparationBlob,storeSnapshotBytes:storage.storeSnapshotBytes,storePreparationBytes:preparation.storePreparationBytes});
   port.postMessage({schemaVersion:'wfc.pf.preparation-union-message.v1',requestId,type:'result',result});
  }catch(error){
   const raw=error instanceof Error?error.message:'';
   const code=raw==='PREPARATION_UNION_LIMIT'?'PREPARATION_UNION_LIMIT':raw==='PREPARATION_UNION_STORAGE'?'PREPARATION_UNION_STORAGE':raw==='PREPARATION_UNION_INVALID'||error instanceof z.ZodError||['PreparationMergeError','PathFinderError'].includes((error as Error)?.name)?'PREPARATION_UNION_INVALID':'PREPARATION_UNION_FAILED';
   if(requestId)port.postMessage({schemaVersion:'wfc.pf.preparation-union-message.v1',requestId,type:'error',code});
   process.exitCode=1;
  }finally{port.close();}
 })();
}
