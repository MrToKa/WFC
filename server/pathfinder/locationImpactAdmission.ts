import { collectDependencyBatchInTransaction } from './dependencyBatch.js';
import { defaultOptions } from './jobContracts.js';
import { hash } from './dependencies.js';
import { insertCalculationBatch } from './jobs.js';
import type { LocationImpactAdapter } from './locationImpactRepository.js';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';
import { PathFinderError } from './errors.js';

/** Exact affected ids only: no project matching, whole-project request or global cancel gate. */
export const locationImpactAdmission:LocationImpactAdapter['admitInTransaction']=async(client,input)=>{
  const deadline=Date.now()+RECALCULATION_LIMITS.collectionMilliseconds;
  const batch=await collectDependencyBatchInTransaction(client,{projectId:input.projectId,
    options:{...defaultOptions,...input.preferences},cableIds:input.cableIds,
    signal:input.signal,deadline,dependencyVersion:'pathfinder.dependencies.v7'});
  if(batch.items.some(item=>!['LV','Control','Instrumentation'].includes(item.cable.mto)))
    throw new PathFinderError('LOCATION_IMPACT_CATEGORY_CHANGED',409);
  const inputSha256=hash({schemaVersion:'wfc.pf.location-impact-admission.v1',impactId:input.impactId,
    timeoutMilliseconds:input.timeoutMilliseconds,items:batch.items.map(item=>({id:item.id,dependencies:item.dependencies,
      status:item.status,cableWriteRevision:item.cable.cable_write_revision}))});
  const readyCables=batch.items.filter(item=>item.dependencies!==null).length;
  input.signal.throwIfAborted();if(Date.now()>deadline)throw new PathFinderError('RECALCULATION_COLLECTION_DEADLINE',503);
  await input.beforeInsert();
  // Even all-blocked input gets a real completed job/baseline. Old success must
  // never look like the newest result when a newly assigned pair cannot route.
  const jobId=await insertCalculationBatch(client,input.projectId,input.principal,batch,input.timeoutMilliseconds,
    inputSha256,{signal:input.signal,deadline},{kind:'location-impact',generation:null});
  const admission=(await client.query<{id:string}>('SELECT id FROM pf_revision_admissions WHERE project_id=$1 AND job_id=$2',
    [input.projectId,jobId])).rows[0];
  if(!admission)throw new PathFinderError('REVISION_ADMISSION_REQUIRED',409);
  return {jobId,admissionId:admission.id,inputSha256,total:batch.items.length,readyCables,
    blockedCables:batch.items.length-readyCables,
    reasonCodes:[...new Set(batch.items.filter(item=>!item.dependencies).map(item=>item.status.toUpperCase()))].sort().slice(0,64)};
};
