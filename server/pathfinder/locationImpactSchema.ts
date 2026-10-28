import type { Pool } from 'pg';
import { schedulerTransaction } from './schedulerTransaction.js';

/** Immutable save intent/member/enrollment history; only dispatch and latest cable target are mutable. */
export const LOCATION_IMPACT_SQL = `
CREATE TABLE IF NOT EXISTS pf_location_impacts(
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id uuid NOT NULL,
 actor_id uuid NOT NULL,login_id uuid NOT NULL,idempotency_key uuid NOT NULL,command_sha256 text NOT NULL CHECK(command_sha256~'^[a-f0-9]{64}$'),
 record_sha256 text NOT NULL CHECK(record_sha256~'^[a-f0-9]{64}$'),record jsonb NOT NULL CHECK(octet_length(record::text)<=1048576),created_at timestamptz NOT NULL,
 PRIMARY KEY(project_id,id),UNIQUE(project_id,actor_id,idempotency_key));
CREATE INDEX IF NOT EXISTS pf_location_impact_owner_history ON pf_location_impacts(project_id,actor_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS pf_location_impact_items(
 project_id uuid NOT NULL,impact_id uuid NOT NULL,cable_id uuid NOT NULL,generation bigint NOT NULL CHECK(generation>0),eligible boolean NOT NULL,
 record_sha256 text NOT NULL CHECK(record_sha256~'^[a-f0-9]{64}$'),record jsonb NOT NULL CHECK(octet_length(record::text)<=32768),
 PRIMARY KEY(project_id,impact_id,cable_id),FOREIGN KEY(project_id,impact_id) REFERENCES pf_location_impacts(project_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS pf_location_impact_targets(
 project_id uuid NOT NULL,cable_id uuid NOT NULL,generation bigint NOT NULL CHECK(generation>0),impact_id uuid NOT NULL,
 PRIMARY KEY(project_id,cable_id),FOREIGN KEY(project_id,impact_id,cable_id) REFERENCES pf_location_impact_items(project_id,impact_id,cable_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX IF NOT EXISTS pf_location_impact_target_owner ON pf_location_impact_targets(project_id,impact_id,cable_id);
CREATE TABLE IF NOT EXISTS pf_location_impact_dispatch(
 project_id uuid NOT NULL,impact_id uuid NOT NULL,status text NOT NULL CHECK(status IN('pending','collecting','enrolled','blocked','superseded','cancelled','failed','awaiting-authority','restore-fenced')),
 reason_codes jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(reason_codes)='array' AND jsonb_array_length(reason_codes)<=64),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),owner_token uuid,lease_until timestamptz,due_at timestamptz,
 admitted_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,impact_id),FOREIGN KEY(project_id,impact_id) REFERENCES pf_location_impacts(project_id,id) ON DELETE CASCADE,
 CHECK((owner_token IS NULL)=(lease_until IS NULL)));
CREATE INDEX IF NOT EXISTS pf_location_impact_due ON pf_location_impact_dispatch(due_at,project_id,impact_id) WHERE status IN('pending','collecting');
CREATE TABLE IF NOT EXISTS pf_location_impact_enrollments(
 project_id uuid NOT NULL,impact_id uuid NOT NULL,job_id uuid,input_sha256 text NOT NULL CHECK(input_sha256~'^[a-f0-9]{64}$'),
 admission_id uuid,total integer NOT NULL CHECK(total BETWEEN 0 AND 10000),ready_cables integer NOT NULL CHECK(ready_cables>=0),blocked_cables integer NOT NULL CHECK(blocked_cables>=0),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,impact_id),UNIQUE(project_id,job_id),
 FOREIGN KEY(project_id,impact_id) REFERENCES pf_location_impacts(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE,
 CHECK(ready_cables+blocked_cables=total),CHECK(job_id IS NOT NULL OR ready_cables=0));
CREATE OR REPLACE FUNCTION pf_location_impact_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Location impact intent, member and enrollment are immutable';END $$;
DROP TRIGGER IF EXISTS pf_location_impacts_immutable ON pf_location_impacts;
CREATE TRIGGER pf_location_impacts_immutable BEFORE UPDATE OR DELETE ON pf_location_impacts FOR EACH ROW EXECUTE FUNCTION pf_location_impact_immutable();
DROP TRIGGER IF EXISTS pf_location_impact_items_immutable ON pf_location_impact_items;
CREATE TRIGGER pf_location_impact_items_immutable BEFORE UPDATE OR DELETE ON pf_location_impact_items FOR EACH ROW EXECUTE FUNCTION pf_location_impact_immutable();
DROP TRIGGER IF EXISTS pf_location_impact_enrollments_immutable ON pf_location_impact_enrollments;
CREATE TRIGGER pf_location_impact_enrollments_immutable BEFORE UPDATE OR DELETE ON pf_location_impact_enrollments FOR EACH ROW EXECUTE FUNCTION pf_location_impact_immutable();
`;
export async function initializeLocationImpactSchema(pool: Pool): Promise<void> {
  await schedulerTransaction(pool, async client => { await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-location-impact-schema-v1'))"); await client.query(LOCATION_IMPACT_SQL); });
}
