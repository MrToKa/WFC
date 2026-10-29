import type { PoolClient } from 'pg';
import { supportedBarrierWriteEvidenceSchema as barrierWriteEvidenceSchema,type AnyBarrierWriteEvidence as BarrierWriteEvidence,
  type AnyBarrierEngineIdentity as BarrierEngineIdentity,supportedBarrierAdmissionIntentSchema as barrierAdmissionIntentSchema } from '../../shared/pathfinderBarrierSupported.js';
import { MIXED_BARRIER_POLICY,mixedBarrierVerifierEvidenceSchema } from '../../shared/pathfinderBarrierMixed.js';
import { barrierCalculationEngineIdentity,mixedBarrierCalculationEngineIdentity } from './calculationEngineIdentity.js';
import { collectBarrierCalculationScope,collectBarrierCalculationState } from './barrierCalculationScope.js';
import { hash } from './dependencies.js';
import { engineResponseSchema,optionsSchema,type BarrierDependencySnapshot } from './jobContracts.js';
import { requireVersionedCalculationScope } from './routingScope.js';
import { requireBarrierEngineStrategy } from './barrierStrategy.js';
import { requireCalculationLengthLedger } from './lengthLedger.js';
import { PathFinderError } from './errors.js';

const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
export const BARRIER_WRITE_UNVERIFIED_MESSAGE='This historical or unverified calculation cannot update Cable list. Calculate a fresh route with the current registered barriers and review its exact outcome.';
const refused=():never=>{throw new PathFinderError('BARRIER_WRITE_PROOF_REQUIRED',409,BARRIER_WRITE_UNVERIFIED_MESSAGE);};

/** Pure immutable proof recognition. No live role, filesystem or SQL access, so
 * a committed receipt can be reconciled after its old scope becomes stale. */
export function readBarrierWriteEvidence(rawDependencies:unknown,rawResult:unknown):BarrierWriteEvidence|null {
  try {
    const body=object(rawDependencies),retained=object(rawResult);
    if(body?.schemaVersion!=='pathfinder.dependencies.v8'||!retained||retained.calculationMode!=='calculate')return null;
    const dependencies=body as unknown as BarrierDependencySnapshot;
    if(!['LV','Control','Instrumentation'].includes(dependencies.cableInputs?.mto??''))return null;
    requireVersionedCalculationScope(dependencies);
    const mixed=dependencies.barriers.schemaVersion==='wfc.pf.barrier-runtime.v2';
    const hasQualification=Object.prototype.hasOwnProperty.call(body,'barrierQualification');
    if(mixed?!hasQualification||!mixedBarrierVerifierEvidenceSchema.nullable().safeParse(dependencies.barrierQualification).success:hasQualification)return null;
    if(!optionsSchema.safeParse(dependencies.options).success||!barrierAdmissionIntentSchema.safeParse(dependencies.options.barrierRouting).success)return null;
    const {calculationMode:_mode,...responseBody}=retained,response=engineResponseSchema.parse(responseBody);
    if(response.schemaVersion!=='pathfinder.model.response.v3'||response.status!=='calculated'||!response.route?.success||!response.design
      ||!['clear','bypassed','no-barriers-declared'].includes(response.barriers.diagnostics.status)||!response.barriers.proof)return null;
    requireBarrierEngineStrategy(response,{context:dependencies.barriers,...(mixed?{qualification:dependencies.barrierQualification}:{}),
      category:dependencies.cableInputs.mto,fromPoint:dependencies.from.point,toPoint:dependencies.to.point});
    if(!requireCalculationLengthLedger(response,dependencies.settings))return null;
    const context=dependencies.barriers;
    return barrierWriteEvidenceSchema.parse({schemaVersion:mixed?'wfc.pf.barrier-write-evidence.v2':'wfc.pf.barrier-write-evidence.v1',
      ...(mixed?{geometryPolicy:MIXED_BARRIER_POLICY,ownTerminalExemptionsSupported:false}:{}),dependencyVersion:dependencies.schemaVersion,responseVersion:response.schemaVersion,
      projectId:dependencies.projectId,cableId:dependencies.cableId,dependencySha256:hash(dependencies),engineIdentitySha256:dependencies.engineIdentity.contentSha256,
      engineResultSha256:hash(rawResult),contextSha256:hash(context),executionSha256:hash(response.barriers),routeSha256:response.barriers.proof.routeSha256,
      policySha256:context.binding.policySha256,profileSha256:context.profileSha256,registryRevision:context.binding.registryRevision,
      snapshotId:context.binding.snapshot?.snapshotId??null,snapshotSha256:context.binding.snapshot?.contentSha256??null,
      drillThroughWalls:context.binding.policy.drillThroughWalls,status:response.barriers.diagnostics.status});
  }catch{return null;}
}
export function requireBarrierWriteEvidence(dependencies:unknown,result:unknown):BarrierWriteEvidence {
  return readBarrierWriteEvidence(dependencies,result)??refused();
}

/** Current caller-owned principal/project transaction, no nested transaction and
 * no cable write. Use before full dependency collection and again at the final
 * write boundary: the writer's own cable revision must not invalidate this fence. */
export async function requireCurrentBarrierWriteScope(client:PoolClient,dependencies:BarrierDependencySnapshot,
  options:{signal?:AbortSignal;deadline?:number}={}):Promise<BarrierEngineIdentity> {
  if(dependencies.schemaVersion!=='pathfinder.dependencies.v8')return refused();
  requireVersionedCalculationScope(dependencies);options.signal?.throwIfAborted();
  const mixed=dependencies.barriers.schemaVersion==='wfc.pf.barrier-runtime.v2';
  const hasQualification=Object.prototype.hasOwnProperty.call(dependencies,'barrierQualification');
  if(mixed?!hasQualification||!mixedBarrierVerifierEvidenceSchema.nullable().safeParse(dependencies.barrierQualification).success:hasQualification)return refused();
  const identity=await(mixed?mixedBarrierCalculationEngineIdentity({force:true}):barrierCalculationEngineIdentity({force:true}));options.signal?.throwIfAborted();
  if(hash(identity)!==hash(dependencies.engineIdentity))throw new PathFinderError('PROPOSAL_STALE',409,'The calculation implementation changed. Calculate and review a fresh result.');
  const intent=barrierAdmissionIntentSchema.parse(dependencies.options.barrierRouting);
  if(mixed){
    const current=await collectBarrierCalculationState(client,dependencies.projectId,intent,options);options.signal?.throwIfAborted();
    if(hash(current.context)!==hash(dependencies.barriers)||hash(current.qualification)!==hash(dependencies.barrierQualification))
      throw new PathFinderError('PROPOSAL_STALE',409,'The retained original barrier qualification or policy changed. Calculate and review a fresh result.');
  }else{
    const current=await collectBarrierCalculationScope(client,dependencies.projectId,intent,options);options.signal?.throwIfAborted();
    if(hash(current)!==hash(dependencies.barriers))throw new PathFinderError('PROPOSAL_STALE',409,'The registered barrier scope or policy changed. Calculate and review a fresh result.');
  }
  return identity;
}
