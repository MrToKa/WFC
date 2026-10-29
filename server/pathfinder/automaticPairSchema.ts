import type { Pool } from 'pg';
import { schedulerTransaction } from './schedulerTransaction.js';

export const AUTOMATIC_PAIR_SQL = `
CREATE TABLE IF NOT EXISTS pf_automatic_pair_mandates(
 project_id uuid NOT NULL,job_id uuid NOT NULL,cable_id uuid NOT NULL,id uuid NOT NULL,
 actor_id uuid NOT NULL,login_id uuid NOT NULL,record_sha256 text NOT NULL CHECK(record_sha256~'^[a-f0-9]{64}$'),
 record jsonb NOT NULL CHECK(octet_length(record::text)<=65536),created_at timestamptz NOT NULL,
 PRIMARY KEY(project_id,job_id,cable_id),UNIQUE(project_id,id),
 FOREIGN KEY(project_id,job_id,cable_id) REFERENCES pf_job_items(project_id,job_id,cable_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS pf_automatic_pair_dispatch(
 project_id uuid NOT NULL,job_id uuid NOT NULL,cable_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','running','written','already-written','review-required','stale','authority-expired','refused','unknown')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),owner_token uuid,lease_until timestamptz,not_before timestamptz DEFAULT clock_timestamp(),
 reason_code text CHECK(reason_code~'^[A-Z][A-Z0-9_]{0,95}$'),receipt_id uuid,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(project_id,job_id,cable_id),CHECK((owner_token IS NULL)=(lease_until IS NULL)),
 FOREIGN KEY(project_id,job_id,cable_id) REFERENCES pf_automatic_pair_mandates(project_id,job_id,cable_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS pf_automatic_pair_due ON pf_automatic_pair_dispatch(not_before,project_id,job_id,cable_id)
 WHERE status IN('pending','running','unknown');
CREATE OR REPLACE FUNCTION pf_automatic_pair_mandate_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Automatic pair mandate is immutable';END $$;
DROP TRIGGER IF EXISTS pf_automatic_pair_mandate_immutable ON pf_automatic_pair_mandates;
CREATE TRIGGER pf_automatic_pair_mandate_immutable BEFORE UPDATE OR DELETE ON pf_automatic_pair_mandates
 FOR EACH ROW EXECUTE FUNCTION pf_automatic_pair_mandate_immutable();
`;
/** Isolated bootstrap export. Importing it performs no database operation. */
export async function initializeAutomaticPairSchema(pool: Pool): Promise<void> {
  await schedulerTransaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-automatic-pair-schema-v1'))");
    await client.query(AUTOMATIC_PAIR_SQL);
  });
}
