import type { Pool } from 'pg';
import { schedulerTransaction } from './schedulerTransaction.js';

export const INITIAL_FILL_MANDATE_SQL = `
CREATE TABLE IF NOT EXISTS pf_initial_fill_mandates(
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id uuid NOT NULL,impact_id uuid NOT NULL,
 actor_id uuid NOT NULL,login_id uuid NOT NULL,idempotency_key uuid NOT NULL,command_sha256 text NOT NULL CHECK(command_sha256~'^[a-f0-9]{64}$'),
 record_sha256 text NOT NULL CHECK(record_sha256~'^[a-f0-9]{64}$'),record jsonb NOT NULL CHECK(octet_length(record::text)<=1048576),created_at timestamptz NOT NULL,
 PRIMARY KEY(project_id,id),UNIQUE(project_id,impact_id),UNIQUE(project_id,actor_id,idempotency_key),
 FOREIGN KEY(project_id,impact_id) REFERENCES pf_location_impacts(project_id,id) ON DELETE CASCADE);
CREATE OR REPLACE FUNCTION pf_initial_fill_mandate_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Initial-fill mandate is immutable';END $$;
DROP TRIGGER IF EXISTS pf_initial_fill_mandate_immutable ON pf_initial_fill_mandates;
CREATE TRIGGER pf_initial_fill_mandate_immutable BEFORE UPDATE OR DELETE ON pf_initial_fill_mandates FOR EACH ROW EXECUTE FUNCTION pf_initial_fill_mandate_immutable();
`;
export async function initializeInitialFillMandateSchema(pool: Pool): Promise<void> {
  await schedulerTransaction(pool, async client => { await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-initial-fill-mandate-schema-v1'))"); await client.query(INITIAL_FILL_MANDATE_SQL); });
}
