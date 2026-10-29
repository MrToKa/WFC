import type {PoolClient} from 'pg';
import {CALCULATION_GRANT_LIMITS,type CalculationGrant} from '../../shared/pathfinderCalculationGrant.js';
import {RECALCULATION_LIMITS,recalculationPreferencesSchema,recalculationTimeoutSchema,recalculationReasonSchema,type RecalculationPreferences} from '../../shared/pathfinderRecalculation.js';
import {policyRevisionSchema,policyHashSchema,policyUuidSchema,canonicalPurposeJson} from '../../shared/pathfinderPurposePolicy.js';
import {requireCalculationGrant,calculationGrantProvenance,validateCalculationGrantRecord,type CalculationGrantAuthority} from './calculationAuthority.js';
import {grantOperationPrincipal,type OperationPrincipal} from './operationAuthority.js';
import type {RecalculationJobAdmission} from './recalculationRepository.js';
import {PathFinderError} from './errors.js';
import {schedulerTransaction} from './schedulerTransaction.js';
import type {Pool} from 'pg';

export type GrantRecalculationAdapter={createInTransaction(c:PoolClient,input:{projectId:string;principal:OperationPrincipal;scope:'project';preferences:RecalculationPreferences;
  timeoutMilliseconds:number;signal:AbortSignal;beforeInsert():Promise<void>}):Promise<RecalculationJobAdmission>};
function fail(code:string,status=409):never{throw new PathFinderError(code,status,'The grant calculation generation changed or is unavailable. Its current project state must be reconciled before work can continue.');}
export type GrantGenerationCandidate={projectId:string;grant:CalculationGrant;modelVersionId:string;selectionRevision:string;contentFingerprint:string;
  generation:string;controlRevision:string;authorityEpoch:string};
/** Bounded suggestions only. A candidate is not authority; claim and final admission independently revalidate it. */
export async function readGrantGenerationCandidates(pool:Pool,options:{limit?:number;afterProjectId?:string|null;signal?:AbortSignal}={}):Promise<GrantGenerationCandidate[]>{
  const limit=options.limit??RECALCULATION_LIMITS.producerProjectsPerTick;
  if(!Number.isSafeInteger(limit)||limit<1||limit>RECALCULATION_LIMITS.producerProjectsPerTick)fail('CALCULATION_GRANT_CANDIDATE_LIMIT',400);
  const after=options.afterProjectId==null?null:policyUuidSchema.parse(options.afterProjectId);
  return schedulerTransaction(pool,async c=>{
    await c.query('SET TRANSACTION READ ONLY');
    const rows=(await c.query<Record<string,any>>(`SELECT r.project_id,r.id,r.grant_revision::text,r.grant_epoch::text,r.installation_epoch,r.issuer_id,r.issuer_admin_revision::text,r.record,r.record_sha256,
      s.desired_generation::text,s.control_revision::text,s.authority_epoch::text,p.active_model_version_id,p.selection_revision::text,m.content_fingerprint
      FROM pf_recalculation_state s JOIN pf_calculation_grant_heads h USING(project_id)
      JOIN pf_calculation_grant_revisions r ON r.project_id=h.project_id AND r.id=h.grant_id AND r.grant_revision=h.control_revision AND r.grant_epoch=h.grant_epoch
      JOIN pf_installation_state i ON i.singleton=true AND i.installation_epoch=r.installation_epoch
      JOIN users u ON u.id=r.issuer_id AND u.is_admin=true AND u.pf_admin_revision=r.issuer_admin_revision
      JOIN project_model_selections p ON p.project_id=s.project_id
      JOIN model_versions m ON m.project_id=p.project_id AND m.id=p.active_model_version_id AND m.state='ready' AND m.health='healthy'
      WHERE r.record->>'enabled'='true' AND NOT s.enabled AND NOT s.paused AND s.actor_id IS NULL AND s.login_id IS NULL
        AND s.login_expires_at IS NULL AND s.authority_expires_at IS NULL AND s.engine_unavailable_code IS NULL
        AND (s.due_at IS NULL OR s.due_at<=clock_timestamp())
        AND s.desired_generation IS DISTINCT FROM s.enrolled_generation
        AND ($2::uuid IS NULL OR s.project_id>$2)
      ORDER BY s.project_id LIMIT $1`,[limit,after])).rows;
    if(rows.length>limit)fail('CALCULATION_GRANT_CANDIDATE_INTEGRITY',500);
    return rows.map(row=>({projectId:policyUuidSchema.parse(row.project_id),grant:validateCalculationGrantRecord(row as Parameters<typeof validateCalculationGrantRecord>[0]),
      modelVersionId:policyUuidSchema.parse(row.active_model_version_id),selectionRevision:policyRevisionSchema.parse(row.selection_revision),contentFingerprint:policyHashSchema.parse(row.content_fingerprint),
      generation:policyRevisionSchema.parse(row.desired_generation),controlRevision:policyRevisionSchema.parse(row.control_revision),authorityEpoch:policyRevisionSchema.parse(row.authority_epoch)}));
  },options.signal);
}
/** No transaction or engine is created here. Caller owns project/issuer transaction and its finite operation lease. */
export async function enrollGrantGenerationInTransaction(c:PoolClient,input:{authority:CalculationGrantAuthority;generation:string;controlRevision:string;authorityEpoch:string;
  preferences:RecalculationPreferences;timeoutMilliseconds:number;signal:AbortSignal;adapter:GrantRecalculationAdapter}):Promise<{status:'enrolled'|'blocked'|'duplicate';generation:string;jobId:string|null}>{
  const {authority}=input,projectId=authority.projectId,generation=policyRevisionSchema.parse(input.generation),control=policyRevisionSchema.parse(input.controlRevision),
    epoch=policyRevisionSchema.parse(input.authorityEpoch),preferences=recalculationPreferencesSchema.parse(input.preferences),timeout=recalculationTimeoutSchema.parse(input.timeoutMilliseconds),
    provenance=calculationGrantProvenance(authority);
  input.signal.throwIfAborted();const grant=await requireCalculationGrant(c,authority,'calculate');
  if(canonicalPurposeJson(grant.preferences)!==canonicalPurposeJson(preferences)||grant.timeoutMilliseconds!==timeout)fail('CALCULATION_GRANT_PREFERENCES_CHANGED');
  const prior=(await c.query<{job_id:string|null;grant_provenance:unknown}>('SELECT job_id,grant_provenance FROM pf_recalculation_enrollments WHERE project_id=$1 AND generation=$2',[projectId,generation])).rows[0];
  if(prior){
    if(canonicalPurposeJson(prior.grant_provenance)!==canonicalPurposeJson(provenance))fail('RECALCULATION_GENERATION_AUTHORITY_CONFLICT');
    return{status:'duplicate',generation,jobId:prior.job_id};
  }
  let guarded=false;
  const beforeInsert=async()=>{
    if(guarded)fail('RECALCULATION_ADAPTER_GUARD_REUSED',500);input.signal.throwIfAborted();
    // Shared order: business/dependency locks → live grant/lease → scheduler latch.
    await requireCalculationGrant(c,authority,'calculate',{lock:true});
    const state=(await c.query<{desired_generation:string;control_revision:string;authority_epoch:string;enabled:boolean;paused:boolean;actor_id:string|null;login_id:string|null;login_expires_at:Date|null;authority_expires_at:Date|null;engine_unavailable_code:string|null}>(
      'SELECT desired_generation::text,control_revision::text,authority_epoch::text,enabled,paused,actor_id,login_id,login_expires_at,authority_expires_at,engine_unavailable_code FROM pf_recalculation_state WHERE project_id=$1 FOR UPDATE',[projectId])).rows[0];
    if(!state||state.desired_generation!==generation||state.control_revision!==control||state.authority_epoch!==epoch)fail('AUTOMATIC_GENERATION_SUPERSEDED');
    if(state.enabled||state.paused||state.actor_id!==null||state.login_id!==null||state.login_expires_at!==null||state.authority_expires_at!==null)fail('RECALCULATION_AUTHORITY_MODE_CONFLICT');
    if(state.engine_unavailable_code)fail('ENGINE_IDENTITY_UNAVAILABLE',503);guarded=true;
  };
  const admission=await input.adapter.createInTransaction(c,{projectId,principal:grantOperationPrincipal(authority),scope:'project',preferences,timeoutMilliseconds:timeout,signal:input.signal,beforeInsert});
  input.signal.throwIfAborted();if(!guarded)fail('RECALCULATION_ADAPTER_GUARD_MISSING',500);
  if(admission.duplicate||!policyHashSchema.safeParse(admission.inputSha256).success||!Number.isSafeInteger(admission.total)||admission.total<0||admission.total>RECALCULATION_LIMITS.cables
    ||!Number.isSafeInteger(admission.readyCables)||admission.readyCables<0||!Number.isSafeInteger(admission.blockedCables)||admission.blockedCables<0
    ||admission.readyCables+admission.blockedCables!==admission.total||(admission.jobId===null)!==(admission.readyCables===0))fail('RECALCULATION_ADAPTER_RESULT_INVALID',500);
  if(admission.jobId)policyUuidSchema.parse(admission.jobId);
  if(!Array.isArray(admission.reasonCodes)||admission.reasonCodes.length>CALCULATION_GRANT_LIMITS.reasonCodes)fail('RECALCULATION_ADAPTER_RESULT_INVALID',500);
  const reasons=[...new Set(admission.reasonCodes.map(code=>recalculationReasonSchema.parse(code)))];
  await c.query(`INSERT INTO pf_recalculation_enrollments(project_id,generation,control_revision,authority_epoch,actor_id,login_id,authority_expires_at,grant_provenance,job_id,input_sha256,total,ready_cables,blocked_cables,reason_codes)
    VALUES($1,$2,$3,$4,$5,NULL,NULL,$6,$7,$8,$9,$10,$11,$12)`,[projectId,generation,control,epoch,authority.issuerId,provenance,admission.jobId,admission.inputSha256,admission.total,admission.readyCables,admission.blockedCables,JSON.stringify(reasons)]);
  await c.query(`UPDATE pf_recalculation_state SET enrolled_generation=$2,current_job_id=$3,status=$4,reason_codes=$5,total=$6,completed=$7,ready_cables=$8,blocked_cables=$9,
    first_dirty_at=NULL,due_at=NULL,updated_at=clock_timestamp() WHERE project_id=$1`,[projectId,generation,admission.jobId,admission.jobId?'queued':'blocked',JSON.stringify(reasons),admission.total,admission.blockedCables,admission.readyCables,admission.blockedCables]);
  input.signal.throwIfAborted();await requireCalculationGrant(c,authority,'calculate',{lock:true});input.signal.throwIfAborted();
  return{status:admission.jobId?'enrolled':'blocked',generation,jobId:admission.jobId};
}
