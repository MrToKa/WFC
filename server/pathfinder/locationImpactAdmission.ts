import { collectDependencyBatchInTransaction } from './dependencyBatch.js';
import { defaultOptions } from './jobContracts.js';
import { hash } from './dependencies.js';
import { insertCalculationBatch } from './jobs.js';
import type { LocationImpactAdapter } from './locationImpactRepository.js';
import { RECALCULATION_LIMITS, recalculationPreferencesSchema } from '../../shared/pathfinderRecalculation.js';
import { collectBarrierCalculationScope } from './barrierCalculationScope.js';
import { PathFinderError } from './errors.js';
import { appendAutomaticPairMandatesInTransaction } from './automaticPairMandates.js';
import { automaticPairPolicySchema } from '../../shared/pathfinderAutomaticPair.js';

/** Exact affected ids only: no project matching, whole-project request or global cancel gate. */
export const locationImpactAdmission:LocationImpactAdapter['admitInTransaction']=async(client,input)=>{
  const deadline=Date.now()+RECALCULATION_LIMITS.collectionMilliseconds;
  const preferences=recalculationPreferencesSchema.parse(input.preferences);
  if(!preferences.barrierRouting)throw new PathFinderError('BARRIER_ROUTING_INTENT_REQUIRED',409,
    'Refresh Path Finder and choose the current barrier scope before recalculating shared locations.');
  const batch=await collectDependencyBatchInTransaction(client,{projectId:input.projectId,
    options:{...defaultOptions,...preferences},cableIds:input.cableIds,
    signal:input.signal,deadline,dependencyVersion:'pathfinder.dependencies.v8'});
  if(batch.items.some(item=>!['LV','Control','Instrumentation'].includes(item.cable.mto)))
    throw new PathFinderError('LOCATION_IMPACT_CATEGORY_CHANGED',409);
  const automaticPairPolicy=input.automaticPair ? automaticPairPolicySchema.parse(input.automaticPair.policy) : undefined;
  const inputSha256=hash({schemaVersion:automaticPairPolicy?'wfc.pf.location-impact-admission.v2':'wfc.pf.location-impact-admission.v1',impactId:input.impactId,
    ...(automaticPairPolicy?{automaticPairPolicy}:{}),
    timeoutMilliseconds:input.timeoutMilliseconds,items:batch.items.map(item=>({id:item.id,dependencies:item.dependencies,
      status:item.status,cableWriteRevision:item.cable.cable_write_revision}))});
  const readyCables=batch.items.filter(item=>item.dependencies!==null).length;
  if(preferences.barrierRouting){
    // Keep scheduler/claim state last in the transaction lock order. Recheck
    // the exact server publication before taking that final latch; the frame
    // and barrier rows remain locked until the caller commits.
    const current=await collectBarrierCalculationScope(client,input.projectId,preferences.barrierRouting,{signal:input.signal,deadline});
    if(batch.items.some(item=>item.dependencies!==null&&(item.dependencies.schemaVersion!=='pathfinder.dependencies.v8'
      ||hash(item.dependencies.barriers)!==hash(current))))throw new PathFinderError('BARRIER_CALCULATION_SCOPE_CHANGED',409);
  }
  input.signal.throwIfAborted();if(Date.now()>deadline)throw new PathFinderError('RECALCULATION_COLLECTION_DEADLINE',503);
  await input.beforeInsert();
  // Even all-blocked input gets a real completed job/baseline. Old success must
  // never look like the newest result when a newly assigned pair cannot route.
  const jobId=await insertCalculationBatch(client,input.projectId,input.principal,batch,input.timeoutMilliseconds,
    inputSha256,{signal:input.signal,deadline},{kind:'location-impact',generation:null});
  const admission=(await client.query<{id:string}>('SELECT id FROM pf_revision_admissions WHERE project_id=$1 AND job_id=$2',
    [input.projectId,jobId])).rows[0];
  if(!admission)throw new PathFinderError('REVISION_ADMISSION_REQUIRED',409);
  if(automaticPairPolicy&&input.automaticPair&&readyCables>0)await appendAutomaticPairMandatesInTransaction(client,{projectId:input.projectId,jobId,
    principal:input.principal,policy:automaticPairPolicy,requestSha256:inputSha256,source:{kind:'location-impact',impactId:input.impactId,
      createdAt:input.automaticPair.createdAt,authorityExpiresAt:input.automaticPair.authorityExpiresAt},
    items:batch.items.flatMap(item=>item.dependencies?[{cableId:item.id,cableWriteRevision:item.cable.cable_write_revision,
      dependencyHash:hash(item.dependencies)}]:[]).sort((a,b)=>a.cableId<b.cableId?-1:1)},()=>{input.signal.throwIfAborted();if(Date.now()>deadline)throw new PathFinderError('RECALCULATION_COLLECTION_DEADLINE',503);});
  return {jobId,admissionId:admission.id,inputSha256,total:batch.items.length,readyCables,
    blockedCables:batch.items.length-readyCables,
    reasonCodes:[...new Set(batch.items.filter(item=>!item.dependencies).map(item=>item.status.toUpperCase()))].sort().slice(0,64)};
};
