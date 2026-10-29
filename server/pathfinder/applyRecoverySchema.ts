import type { Pool } from 'pg';

export const APPLY_RECOVERY_SQL = `
CREATE TABLE IF NOT EXISTS pf_apply_abandonments (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL, idempotency_key uuid NOT NULL, proposal_id uuid NOT NULL, review_id uuid NOT NULL,
 expected_cable_write_revision bigint NOT NULL CHECK(expected_cable_write_revision>=0),
 payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,actor_id,idempotency_key),
 FOREIGN KEY(project_id,proposal_id) REFERENCES pf_proposals(project_id,id) ON DELETE CASCADE
);
CREATE OR REPLACE FUNCTION pf_apply_abandonment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'PathFinder Apply abandonment is immutable'; END $$;
DROP TRIGGER IF EXISTS pf_apply_abandonment_immutable ON pf_apply_abandonments;
CREATE TRIGGER pf_apply_abandonment_immutable BEFORE UPDATE OR DELETE ON pf_apply_abandonments
 FOR EACH ROW EXECUTE FUNCTION pf_apply_abandonment_immutable();
`;

/** Additive closure records never replace, delete or synthesize an Apply receipt. */
export async function initializeApplyRecoverySchema(pool: Pool): Promise<void> {
  const client = await pool.connect(); let commitStarted = false, discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-apply-recovery-schema-v1'))");
    await client.query(APPLY_RECOVERY_SQL);
    commitStarted = true; await client.query('COMMIT');
  } catch (error) {
    discard = commitStarted; try { await client.query('ROLLBACK'); } catch { discard = true; } throw error;
  } finally { client.release(discard ? true : undefined); }
}
