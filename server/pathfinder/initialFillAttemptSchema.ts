import type {Pool} from 'pg';
import {schedulerTransaction} from './schedulerTransaction.js';
export const INITIAL_FILL_ATTEMPT_SQL=`
CREATE TABLE IF NOT EXISTS pf_initial_fill_attempts(
 project_id uuid NOT NULL,actor_id uuid NOT NULL,idempotency_key uuid NOT NULL,mandate_id uuid NOT NULL,proposal_id uuid NOT NULL,cable_id uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),request jsonb NOT NULL CHECK(octet_length(request::text)<=4096),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,actor_id,idempotency_key),UNIQUE(project_id,mandate_id,proposal_id),
 FOREIGN KEY(project_id,mandate_id) REFERENCES pf_initial_fill_mandates(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,proposal_id) REFERENCES pf_proposals(project_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS pf_initial_fill_dispatch(
 project_id uuid NOT NULL,actor_id uuid NOT NULL,idempotency_key uuid NOT NULL,status text NOT NULL DEFAULT 'pending'
 CHECK(status IN('pending','running','written','already-written','review-required','stale','authority-expired','refused','unknown')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),owner_token uuid,lease_until timestamptz,not_before timestamptz DEFAULT now(),
 reason_code text CHECK(reason_code~'^[A-Z][A-Z0-9_]{0,95}$'),receipt_id uuid,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,actor_id,idempotency_key),CHECK((owner_token IS NULL)=(lease_until IS NULL)),
 FOREIGN KEY(project_id,actor_id,idempotency_key) REFERENCES pf_initial_fill_attempts(project_id,actor_id,idempotency_key) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS pf_initial_fill_due ON pf_initial_fill_dispatch(not_before,project_id,idempotency_key) WHERE status IN('pending','running','unknown');
CREATE OR REPLACE FUNCTION pf_initial_fill_attempt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Initial-fill attempt is immutable';END $$;
DROP TRIGGER IF EXISTS pf_initial_fill_attempt_immutable ON pf_initial_fill_attempts;
CREATE TRIGGER pf_initial_fill_attempt_immutable BEFORE UPDATE OR DELETE ON pf_initial_fill_attempts FOR EACH ROW EXECUTE FUNCTION pf_initial_fill_attempt_immutable();
`;
export async function initializeInitialFillAttemptSchema(pool:Pool){
  await schedulerTransaction(pool,async client=>{await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-initial-fill-attempt-schema-v1'))");await client.query(INITIAL_FILL_ATTEMPT_SQL);});
}
