import type { Pool } from 'pg';
import { schedulerTransaction } from './schedulerTransaction.js';

/** Explicit nullable-login variants. Historical rows retain their original login identity. */
export const GRANT_OPERATION_SQL = `
ALTER TABLE pf_jobs ADD COLUMN IF NOT EXISTS authority_kind text NOT NULL DEFAULT 'current-login',
 ADD COLUMN IF NOT EXISTS grant_provenance jsonb,ADD COLUMN IF NOT EXISTS not_before timestamptz,
 ALTER COLUMN login_id DROP NOT NULL,ALTER COLUMN login_expires_at DROP NOT NULL;
ALTER TABLE pf_jobs DROP CONSTRAINT IF EXISTS pf_job_authority_kind;
ALTER TABLE pf_jobs ADD CONSTRAINT pf_job_authority_kind CHECK((
 (authority_kind='current-login' AND grant_provenance IS NULL AND login_id IS NOT NULL AND login_expires_at IS NOT NULL) OR
 (authority_kind='calculation-grant' AND login_id IS NULL AND login_expires_at IS NULL AND kind='calculate'
 AND jsonb_typeof(grant_provenance)='object' AND octet_length(grant_provenance::text)<=65536
 AND grant_provenance->>'kind'='calculation-grant' AND grant_provenance->>'projectId'=project_id::text
 AND grant_provenance->>'issuerId'=requested_by::text)) IS TRUE);
ALTER TABLE pf_recalculation_enrollments ADD COLUMN IF NOT EXISTS grant_provenance jsonb,
 ALTER COLUMN login_id DROP NOT NULL,ALTER COLUMN authority_expires_at DROP NOT NULL;
ALTER TABLE pf_recalculation_enrollments DROP CONSTRAINT IF EXISTS pf_enrollment_authority_kind;
ALTER TABLE pf_recalculation_enrollments ADD CONSTRAINT pf_enrollment_authority_kind CHECK((
 (grant_provenance IS NULL AND login_id IS NOT NULL AND authority_expires_at IS NOT NULL) OR
 (login_id IS NULL AND authority_expires_at IS NULL AND jsonb_typeof(grant_provenance)='object'
 AND octet_length(grant_provenance::text)<=65536 AND grant_provenance->>'kind'='calculation-grant'
 AND grant_provenance->>'projectId'=project_id::text AND grant_provenance->>'issuerId'=actor_id::text)) IS TRUE);
CREATE OR REPLACE FUNCTION pf_job_original_authority_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(OLD.project_id,OLD.id,OLD.requested_by,OLD.login_id,OLD.login_expires_at,OLD.authority_kind,OLD.grant_provenance)
 IS DISTINCT FROM ROW(NEW.project_id,NEW.id,NEW.requested_by,NEW.login_id,NEW.login_expires_at,NEW.authority_kind,NEW.grant_provenance)
 THEN RAISE EXCEPTION 'Calculation job original authority is immutable';END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_job_original_authority_immutable ON pf_jobs;
CREATE TRIGGER pf_job_original_authority_immutable BEFORE UPDATE ON pf_jobs FOR EACH ROW EXECUTE FUNCTION pf_job_original_authority_immutable();
ALTER TABLE pf_preparation_sessions ADD COLUMN IF NOT EXISTS grant_provenance jsonb,
 ADD COLUMN IF NOT EXISTS validation_grant_provenance jsonb,ALTER COLUMN login_id DROP NOT NULL;
ALTER TABLE pf_preparation_events ADD COLUMN IF NOT EXISTS grant_provenance jsonb,ALTER COLUMN login_id DROP NOT NULL;
ALTER TABLE pf_preparation_sessions DROP CONSTRAINT IF EXISTS pf_preparation_authority_kind;
ALTER TABLE pf_preparation_sessions ADD CONSTRAINT pf_preparation_authority_kind CHECK((
 (grant_provenance IS NULL AND login_id IS NOT NULL) OR
 (grant_provenance IS NOT NULL AND login_id IS NULL AND grant_provenance->>'kind'='calculation-grant'
 AND grant_provenance->>'projectId'=project_id::text AND grant_provenance->>'issuerId'=actor_id::text)) IS TRUE);
ALTER TABLE pf_preparation_events DROP CONSTRAINT IF EXISTS pf_preparation_event_authority_kind;
ALTER TABLE pf_preparation_events ADD CONSTRAINT pf_preparation_event_authority_kind CHECK((
 (grant_provenance IS NULL AND login_id IS NOT NULL) OR
 (grant_provenance IS NOT NULL AND login_id IS NULL AND grant_provenance->>'kind'='calculation-grant'
 AND grant_provenance->>'projectId'=project_id::text AND grant_provenance->>'issuerId'=actor_id::text)) IS TRUE);
CREATE OR REPLACE FUNCTION pf_preparation_plan_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(OLD.plan,OLD.project_id,OLD.id,OLD.actor_id,OLD.login_id,OLD.grant_provenance,OLD.created_at)
 IS DISTINCT FROM ROW(NEW.plan,NEW.project_id,NEW.id,NEW.actor_id,NEW.login_id,NEW.grant_provenance,NEW.created_at)
 THEN RAISE EXCEPTION 'Preparation plan and original authority are immutable';END IF;RETURN NEW;END $$;
`;
export async function initializeGrantOperationSchema(pool:Pool):Promise<void> {
  await schedulerTransaction(pool,async c=>{
    await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-grant-operations-v1'))");
    await c.query(GRANT_OPERATION_SQL);
  });
}
