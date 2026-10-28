import type { PoolClient } from 'pg';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { calculationGrantProvenanceSchema } from '../../shared/pathfinderCalculationGrant.js';
import { requireCalculationGrantRevision } from './calculationAuthority.js';
import { PathFinderError } from './errors.js';
import type { RecalculationJobAuthority } from './recalculationRepository.js';

/** A grant job can never inherit the legacy successful "manual job" no-op. */
export async function readGrantJobAuthority(c:Pick<PoolClient,'query'>,input:{projectId:string;jobId:string;lock?:boolean}):Promise<RecalculationJobAuthority|null>{
  const row=(await c.query<Record<string,any>>(`SELECT authority_kind,grant_provenance,requested_by FROM pf_jobs WHERE project_id=$1 AND id=$2`,[input.projectId,input.jobId])).rows[0];
  const base={enrolled:true as const,valid:false,generation:'0',authorityEpoch:'0'};
  if(!row)return{...base,code:'JOB_AUTHORITY_REQUIRED'};
  if(row.authority_kind==='current-login')return null;
  if(row.authority_kind!=='calculation-grant')return{...base,code:'JOB_AUTHORITY_INVALID'};
  const ref=calculationGrantProvenanceSchema.safeParse(row.grant_provenance);
  if(!ref.success||ref.data.projectId!==input.projectId||ref.data.issuerId!==row.requested_by)return{...base,code:'CALCULATION_GRANT_PROVENANCE_INVALID'};
  try{
    await requireCalculationGrantRevision(c,ref.data,{lock:input.lock});
    const enrollment=(await c.query<Record<string,any>>(`SELECT e.generation::text,e.authority_epoch::text,e.grant_provenance,e.actor_id,e.login_id,
      s.desired_generation::text,s.enabled,s.paused,s.engine_unavailable_code FROM pf_recalculation_enrollments e
      JOIN pf_recalculation_state s USING(project_id) JOIN pf_jobs j ON j.project_id=e.project_id AND j.id=e.job_id
      WHERE e.project_id=$1 AND e.job_id=$2${input.lock?' FOR SHARE OF e,s,j':''}`,[input.projectId,input.jobId])).rows[0];
    if(!enrollment)return{...base,code:'CALCULATION_GRANT_ENROLLMENT_REQUIRED'};
    const identity={enrolled:true as const,generation:enrollment.generation,authorityEpoch:enrollment.authority_epoch};
    if(enrollment.actor_id!==ref.data.issuerId||enrollment.login_id!==null||canonicalPurposeJson(enrollment.grant_provenance)!==canonicalPurposeJson(ref.data))return{...identity,valid:false,code:'CALCULATION_GRANT_PROVENANCE_INVALID'};
    if(enrollment.generation!==enrollment.desired_generation)return{...identity,valid:false,code:'AUTOMATIC_GENERATION_SUPERSEDED'};
    if(enrollment.enabled||enrollment.paused)return{...identity,valid:false,code:'RECALCULATION_AUTHORITY_MODE_CONFLICT'};
    if(enrollment.engine_unavailable_code)return{...identity,valid:false,code:'ENGINE_IDENTITY_UNAVAILABLE'};
    return{...identity,valid:true,code:'CALCULATION_GRANT_CURRENT'};
  }catch(error){
    if(error instanceof PathFinderError)return{...base,code:error.code};
    throw error;
  }
}
