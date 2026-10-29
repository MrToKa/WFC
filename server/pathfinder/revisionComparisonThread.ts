import { isMainThread,parentPort,workerData } from 'node:worker_threads';
import { z } from 'zod';
import { canonicalPurposeJson,policyUuidSchema as uuid } from '../../shared/pathfinderPurposePolicy.js';
import { geometryObjectRevisionSchema } from '../../shared/pathfinderGeometryTrace.js';
import { compareModelRevisions } from '../../shared/pathfinderRevisionComparator.js';
import { REVISION_COMPARISON_LIMITS,revisionComparisonManifestSchema,revisionComparisonChangeSchema } from '../../shared/pathfinderRevisionComparison.js';
import { REVISION_COMPARISON_PROFILE,revisionBlobSchema,revisionComparisonFrozenSchema,revisionComparisonHash,revisionDerivedId } from './revisionComparisonPublisher.js';
import { parsePolicyJson } from './policyJson.js';

const page=revisionBlobSchema.extend({firstIndex:z.number().int().nonnegative().max(REVISION_COMPARISON_LIMITS.changes),rowCount:z.number().int().positive().max(REVISION_COMPARISON_PROFILE.pageRows)}).refine(v=>v.bytes<=REVISION_COMPARISON_PROFILE.pageBytes);
export const revisionComparisonThreadInputSchema=z.object({schemaVersion:z.literal('wfc.pf.revision-comparison-thread.v1'),requestId:uuid,projectId:uuid,sessionId:uuid,comparisonId:uuid,frozenBlob:revisionBlobSchema.refine(v=>v.bytes<=REVISION_COMPARISON_PROFILE.frozenBytes),storageLockBuffer:z.instanceof(SharedArrayBuffer).refine(v=>v.byteLength===4)}).strict();
export const revisionComparisonThreadResultSchema=z.object({schemaVersion:z.literal('wfc.pf.revision-comparison-build.v1'),comparisonId:uuid,manifest:revisionBlobSchema.refine(v=>v.bytes<=REVISION_COMPARISON_PROFILE.manifestBytes),rows:revisionBlobSchema.refine(v=>v.bytes<=REVISION_COMPARISON_PROFILE.resultBytes),pages:z.array(page).min(1).max(REVISION_COMPARISON_PROFILE.pages),rowCount:z.number().int().positive().max(REVISION_COMPARISON_LIMITS.changes)}).strict().refine(v=>v.pages.reduce((n,p)=>n+p.rowCount,0)===v.rowCount&&v.pages.every((p,i)=>p.firstIndex===(i===0?0:v.pages.slice(0,i).reduce((n,x)=>n+x.rowCount,0))));
export const revisionComparisonThreadMessageSchema=z.discriminatedUnion('type',[
  z.object({schemaVersion:z.literal('wfc.pf.revision-comparison-message.v1'),requestId:uuid,type:z.literal('result'),result:revisionComparisonThreadResultSchema}).strict(),
  z.object({schemaVersion:z.literal('wfc.pf.revision-comparison-message.v1'),requestId:uuid,type:z.literal('error'),code:z.enum(['REVISION_COMPARISON_BUILD_LIMIT','REVISION_COMPARISON_BUILD_INVALID','REVISION_COMPARISON_BUILD_FAILED'])}).strict(),
]);
export type RevisionComparisonThreadInput=z.infer<typeof revisionComparisonThreadInputSchema>;
export type RevisionComparisonThreadResult=z.infer<typeof revisionComparisonThreadResultSchema>;
type Blob=z.infer<typeof revisionBlobSchema>;
export interface RevisionComparisonThreadStorage{readPreparationBlob:(projectId:string,sessionId:string,ref:Blob,limit:number)=>Promise<Buffer>;storePreparationBlob:(projectId:string,sessionId:string,id:string,value:unknown,limit:number)=>Promise<Blob>}
/** Both complete retained record arrays are parsed, validated and compared only in this worker. */
export async function executeRevisionComparisonThread(input:RevisionComparisonThreadInput,storage:RevisionComparisonThreadStorage):Promise<RevisionComparisonThreadResult>{
  const frozen=revisionComparisonFrozenSchema.parse(parsePolicyJson(await storage.readPreparationBlob(input.projectId,input.sessionId,input.frozenBlob,REVISION_COMPARISON_PROFILE.frozenBytes),{maxBytes:REVISION_COMPARISON_PROFILE.frozenBytes}));
  if(frozen.id!==input.comparisonId||frozen.projectId!==input.projectId||frozen.target.aggregate.sessionId!==input.sessionId||frozen.source.trace.objectRecords.bytes+frozen.target.trace.objectRecords.bytes>REVISION_COMPARISON_PROFILE.inputTotalBytes)throw Error('REVISION_COMPARISON_BUILD_LIMIT');
  const load=async(side:typeof frozen.source)=>{
    const {aggregate,trace,input:scope}=side;
    const {contentSha256,...traceBody}=trace;
    if(revisionComparisonHash(traceBody)!==contentSha256||trace.projectId!==input.projectId||trace.aggregateId!==aggregate.id||trace.modelVersionId!==aggregate.modelVersionId||trace.projection.sha256!==aggregate.projection.sha256||scope.aggregateId!==aggregate.id||scope.traceId!==trace.id||scope.traceContentSha256!==contentSha256||scope.projectionSha256!==aggregate.projection.sha256||scope.captureFrameId!==aggregate.coordinateFrameId||scope.modelVersionId!==aggregate.modelVersionId||scope.coverage.includedObjects!==trace.counts.objects)throw Error('REVISION_COMPARISON_BUILD_INVALID');
    const objects=z.array(geometryObjectRevisionSchema).max(REVISION_COMPARISON_LIMITS.objectsPerSide).parse(parsePolicyJson(await storage.readPreparationBlob(input.projectId,aggregate.sessionId,trace.objectRecords,REVISION_COMPARISON_PROFILE.inputTotalBytes),{maxBytes:REVISION_COMPARISON_PROFILE.inputTotalBytes}));
    return{input:scope,objects,qualifications:[]};
  };
  const source=await load(frozen.source),target=await load(frozen.target),built=compareModelRevisions({projectId:input.projectId,source,target,decisions:[],frame:null,validationPolicy:null},{hash:revisionComparisonHash});
  const rows=await storage.storePreparationBlob(input.projectId,input.sessionId,frozen.rowsBlobId,built.changes,REVISION_COMPARISON_PROFILE.resultBytes);
  const draft=revisionComparisonManifestSchema.parse({schemaVersion:'wfc.pf.revision-comparison.v1',id:frozen.id,projectId:input.projectId,comparisonRevision:frozen.comparisonRevision,source:frozen.source.input,target:frozen.target.input,policyVersion:frozen.policyVersion,decisionSetSha256:frozen.decisionSetSha256,changesSha256:rows.sha256,contentSha256:'0'.repeat(64),counts:built.counts,readiness:built.readiness,createdBy:frozen.createdBy,createdAt:frozen.createdAt,reason:frozen.reason,engineeringAccepted:false});
  const {contentSha256:_hash,...body}=draft,manifest=await storage.storePreparationBlob(input.projectId,input.sessionId,revisionDerivedId(input.comparisonId,'manifest'),{...draft,contentSha256:revisionComparisonHash(body)},REVISION_COMPARISON_PROFILE.manifestBytes);
  const pages:z.infer<typeof page>[]=[];let at=0;
  while(at<built.changes.length){const firstIndex=at,records:unknown[]=[];let bytes=2;
    while(at<built.changes.length&&records.length<REVISION_COMPARISON_PROFILE.pageRows){const record=revisionComparisonChangeSchema.parse(built.changes[at]),row={row_index:at,record_sha256:revisionComparisonHash(record),record},size=Buffer.byteLength(canonicalPurposeJson(row))+1;if(bytes+size>REVISION_COMPARISON_PROFILE.pageBytes)break;records.push(row);bytes+=size;at++;}
    if(!records.length||pages.length>=REVISION_COMPARISON_PROFILE.pages)throw Error('REVISION_COMPARISON_BUILD_LIMIT');
    pages.push({...await storage.storePreparationBlob(input.projectId,input.sessionId,revisionDerivedId(input.comparisonId,'page:'+pages.length),records,REVISION_COMPARISON_PROFILE.pageBytes),rowCount:records.length,firstIndex});
  }
  return revisionComparisonThreadResultSchema.parse({schemaVersion:'wfc.pf.revision-comparison-build.v1',comparisonId:input.comparisonId,manifest,rows,pages,rowCount:built.changes.length});
}
if(!isMainThread&&parentPort&&workerData?.schemaVersion==='wfc.pf.revision-comparison-thread.v1'){
  const port=parentPort;void(async()=>{let requestId:string|undefined;
    try{const input=revisionComparisonThreadInputSchema.parse(workerData);requestId=input.requestId;(globalThis as typeof globalThis&{__wfcPreparationStorageLock?:SharedArrayBuffer}).__wfcPreparationStorageLock=input.storageLockBuffer;
      const storage=await import('./preparationStorage.js'),result=await executeRevisionComparisonThread(input,storage);port.postMessage({schemaVersion:'wfc.pf.revision-comparison-message.v1',requestId,type:'result',result});
    }catch(error){const code=error instanceof Error&&/LIMIT|QUOTA|BUDGET/.test(error.message)?'REVISION_COMPARISON_BUILD_LIMIT':error instanceof z.ZodError||(error as {name?:string})?.name==='PathFinderError'?'REVISION_COMPARISON_BUILD_INVALID':'REVISION_COMPARISON_BUILD_FAILED';if(requestId)port.postMessage({schemaVersion:'wfc.pf.revision-comparison-message.v1',requestId,type:'error',code});process.exitCode=1;}finally{port.close();}
  })();
}
