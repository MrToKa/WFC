import type { CalculationGrantAdapters } from './calculationGrantRepository.js';
import { markRecalculationDirty } from './recalculationSchema.js';

/** One generation ledger, with mutually exclusive finite-login and grant producers. */
export const applyCalculationGrantCommand:NonNullable<CalculationGrantAdapters['afterCommand']>=async(c,input)=>{
  await c.query(`UPDATE pf_recalculation_state SET enabled=false,paused=false,actor_id=NULL,login_id=NULL,login_expires_at=NULL,authority_expires_at=NULL,
    control_revision=control_revision+1,authority_epoch=authority_epoch+1,status='disabled',preferences=$2,timeout_ms=$3,
    reason_codes=$4,updated_at=clock_timestamp() WHERE project_id=$1`,[input.projectId,input.grant?.preferences??null,input.grant?.timeoutMilliseconds??null,
    JSON.stringify([input.grant?.enabled?'CALCULATION_GRANT_ENABLED':'CALCULATION_GRANT_DISABLED'])]);
  await c.query(`UPDATE pf_jobs SET cancel_requested=true,updated_at=clock_timestamp() WHERE project_id=$1 AND state IN('queued','running')
    AND id IN(SELECT job_id FROM pf_recalculation_enrollments WHERE project_id=$1)`,[input.projectId]);
  await markRecalculationDirty(c,{projectId:input.projectId,domain:'preferences',reason:input.grant?.enabled?'CALCULATION_GRANT_ENABLED':'CALCULATION_GRANT_DISABLED'});
};
