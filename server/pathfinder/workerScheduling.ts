import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { schedulerTransaction as transaction } from './schedulerTransaction.js';

type Row=Record<string,any>;
/** Service is project-scoped: creating many jobs cannot buy more engine turns. */
export async function initializeWorkerScheduling(pool:Pool):Promise<void>{
  await transaction(pool,async c=>{
    await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-service-schema-v1'))");
    await c.query(`ALTER TABLE pf_jobs ADD COLUMN IF NOT EXISTS last_served_at timestamptz;
      ALTER TABLE pf_jobs ADD COLUMN IF NOT EXISTS dispatch_slices bigint NOT NULL DEFAULT 0 CHECK(dispatch_slices>=0);
      CREATE TABLE IF NOT EXISTS pf_engine_project_service(project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,last_served_at timestamptz);
      INSERT INTO pf_engine_project_service(project_id) SELECT id FROM projects ON CONFLICT DO NOTHING;
      CREATE OR REPLACE FUNCTION initialize_pf_engine_service() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO pf_engine_project_service(project_id) VALUES(NEW.id) ON CONFLICT DO NOTHING; RETURN NEW; END $$;
      DROP TRIGGER IF EXISTS initialize_pf_engine_service ON projects;
      CREATE TRIGGER initialize_pf_engine_service AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION initialize_pf_engine_service();`);
  });
}

export async function claimCalculationSlice(pool:Pool):Promise<Row|null>{
  return transaction(pool,async c=>{
    const project=(await c.query<{project_id:string}>(`SELECT s.project_id FROM pf_engine_project_service s
      WHERE EXISTS(SELECT 1 FROM pf_jobs j WHERE j.project_id=s.project_id AND (j.state='queued' OR j.state='running' AND j.lease_until<now()))
      ORDER BY s.last_served_at ASC NULLS FIRST,s.project_id FOR UPDATE OF s SKIP LOCKED LIMIT 1`)).rows[0];
    if(!project)return null;
    const row=(await c.query<Row>(`SELECT * FROM pf_jobs WHERE project_id=$1 AND (state='queued' OR state='running' AND lease_until<now())
      ORDER BY last_served_at ASC NULLS FIRST,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,[project.project_id])).rows[0];
    await c.query('UPDATE pf_engine_project_service SET last_served_at=clock_timestamp() WHERE project_id=$1',[project.project_id]);
    if(!row)return null;
    // A clean quantum yield is not a failed recovery attempt.
    const recovery=row.state==='running'||row.attempts===0;
    if(row.cancel_requested||recovery&&row.attempts>=3){
      await c.query('UPDATE pf_jobs SET state=$2,failure=$3,owner_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1',
        [row.id,row.cancel_requested?'cancelled':'failed',row.cancel_requested?'Cancelled.':'Interrupted job exceeded its recovery attempts.']);return null;
    }
    const claimed=(await c.query<Row>(`UPDATE pf_jobs SET state='running',owner_token=$2,lease_until=now()+interval '30 seconds',
      attempts=attempts+$3,last_served_at=clock_timestamp(),dispatch_slices=dispatch_slices+1,updated_at=now() WHERE id=$1 RETURNING *`,[row.id,randomUUID(),recovery?1:0])).rows[0];
    await c.query("UPDATE pf_job_items SET state='waiting' WHERE project_id=$1 AND job_id=$2 AND state='running'",[row.project_id,row.id]);return claimed;
  });
}

/** Caller has fenced the job and checked current authority after its input locks. */
export async function finishCalculationSlice(c:PoolClient,job:Row):Promise<void>{
  const waiting=job.kind==='calculate'&&(await c.query("SELECT 1 FROM pf_job_items WHERE project_id=$1 AND job_id=$2 AND state='waiting' LIMIT 1",[job.project_id,job.id])).rows.length>0;
  await c.query(`UPDATE pf_jobs SET state=$3,owner_token=NULL,lease_until=NULL,updated_at=now()
    WHERE id=$1 AND owner_token=$2`,[job.id,job.owner_token,waiting?'queued':'complete']);
}
