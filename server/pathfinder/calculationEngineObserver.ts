import type { Pool } from 'pg';
import { barrierCalculationEngineIdentity as calculationEngineIdentity } from './calculationEngineIdentity.js';
import { markRecalculationEngineIdentity, markRecalculationEngineUnavailable } from './recalculationSchema.js';
import { schedulerTransaction as transaction } from './schedulerTransaction.js';
import { PathFinderError } from './errors.js';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';

/** Observe in separate short transactions before enrollment; never roll back the new digest with an obsolete claim. */
export function createCalculationEngineObserver(pool:Pool,unavailable:()=>string|null=()=>null){
  return async(signal:AbortSignal):Promise<void>=>{
    signal.throwIfAborted();let digest:string|null=null,code:string|null=null;
    code=unavailable();
    if(!code){try{digest=(await calculationEngineIdentity()).contentSha256;}
      catch(error){code=error instanceof PathFinderError?error.code:'CALCULATION_ENGINE_UNAVAILABLE';}}
    const projects=(await pool.query<{project_id:string}>(`SELECT project_id FROM pf_recalculation_state
      WHERE CASE WHEN $1::text IS NOT NULL THEN engine_identity_sha256 IS DISTINCT FROM $1 OR engine_unavailable_code IS NOT NULL
        ELSE engine_unavailable_code IS DISTINCT FROM $2 END ORDER BY project_id LIMIT $3`,[digest,code,RECALCULATION_LIMITS.producerProjectsPerTick])).rows;
    for(const row of projects){
      signal.throwIfAborted();
      await transaction(pool,async c=>{
        await c.query("SET LOCAL lock_timeout='1000ms';SET LOCAL statement_timeout='3000ms'");
        if(digest)await markRecalculationEngineIdentity(c,row.project_id,digest);
        else await markRecalculationEngineUnavailable(c,row.project_id,code!);
        signal.throwIfAborted();
      },signal);
    }
    if(!digest)throw new PathFinderError(code!,503);
  };
}
