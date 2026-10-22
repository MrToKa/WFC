import type { Pool } from 'pg';

export const BARRIER_REGISTRY_SQL = `
CREATE TABLE IF NOT EXISTS pf_barrier_heads (
 project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),snapshot_id uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pf_barrier_capture_intents (
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL,login_id uuid NOT NULL,idempotency_key uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),request jsonb NOT NULL,frozen jsonb NOT NULL,
 state text NOT NULL CHECK(state IN('pending','complete')),capture_sha256 text CHECK(capture_sha256~'^[a-f0-9]{64}$'),
 allocation jsonb,lease_token uuid,lease_expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,id),UNIQUE(project_id,actor_id,idempotency_key),
 CHECK((capture_sha256 IS NULL)=(allocation IS NULL)),CHECK((lease_token IS NULL)=(lease_expires_at IS NULL))
);
CREATE TABLE IF NOT EXISTS pf_barrier_snapshots (
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 model_version_id uuid NOT NULL,registry_revision bigint NOT NULL CHECK(registry_revision>0),
 storage_intent_id uuid NOT NULL,manifest_blob jsonb NOT NULL,manifest jsonb NOT NULL,
 created_by uuid NOT NULL,login_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,id),UNIQUE(project_id,registry_revision),
 FOREIGN KEY(project_id,model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pf_barrier_receipts (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,actor_id uuid NOT NULL,idempotency_key uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),request jsonb NOT NULL,receipt jsonb NOT NULL,
 PRIMARY KEY(project_id,actor_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS pf_barrier_command_closures (
 project_id uuid NOT NULL,command_sha256 text NOT NULL,id uuid NOT NULL,
 record_sha256 text NOT NULL,record jsonb NOT NULL,closed_by uuid NOT NULL,login_id uuid NOT NULL,closed_at timestamptz NOT NULL,
 CONSTRAINT pf_barrier_command_closures_pkey PRIMARY KEY(project_id,command_sha256),
 CONSTRAINT pf_barrier_closure_tenant_id UNIQUE(project_id,id),
 CONSTRAINT pf_barrier_closure_project_fk FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
 CONSTRAINT pf_barrier_closure_command_hash CHECK(command_sha256~'^[a-f0-9]{64}$'),
 CONSTRAINT pf_barrier_closure_record_hash CHECK(record_sha256~'^[a-f0-9]{64}$'),
 CONSTRAINT pf_barrier_closure_record_bytes CHECK(octet_length(record::text)<=16384)
);
CREATE INDEX IF NOT EXISTS pf_barrier_capture_intents_command_sha256_lookup ON pf_barrier_capture_intents(project_id,request_sha256);
CREATE INDEX IF NOT EXISTS pf_barrier_receipts_command_sha256_lookup ON pf_barrier_receipts(project_id,request_sha256);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='pf_barrier_heads'::regclass AND conname='pf_barrier_head_tenant_snapshot') THEN
  ALTER TABLE pf_barrier_heads ADD CONSTRAINT pf_barrier_head_tenant_snapshot FOREIGN KEY(project_id,snapshot_id) REFERENCES pf_barrier_snapshots(project_id,id);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION pf_barrier_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Barrier publication evidence is immutable';END $$;
CREATE OR REPLACE FUNCTION pf_barrier_intent_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state='complete' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Completed barrier intent is immutable';END IF;
 IF ROW(NEW.id,NEW.project_id,NEW.actor_id,NEW.login_id,NEW.idempotency_key,NEW.request_sha256,NEW.request,NEW.frozen,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.actor_id,OLD.login_id,OLD.idempotency_key,OLD.request_sha256,OLD.request,OLD.frozen,OLD.created_at)
 THEN RAISE EXCEPTION 'Barrier intent identity is immutable';END IF;
 IF OLD.capture_sha256 IS NOT NULL AND ROW(NEW.capture_sha256,NEW.allocation) IS DISTINCT FROM ROW(OLD.capture_sha256,OLD.allocation)
 THEN RAISE EXCEPTION 'Barrier capture allocation is immutable';END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_barrier_intent_immutable ON pf_barrier_capture_intents;
CREATE TRIGGER pf_barrier_intent_immutable BEFORE UPDATE ON pf_barrier_capture_intents FOR EACH ROW EXECUTE FUNCTION pf_barrier_intent_immutable();
DROP TRIGGER IF EXISTS pf_barrier_intent_delete ON pf_barrier_capture_intents;
CREATE TRIGGER pf_barrier_intent_delete BEFORE DELETE ON pf_barrier_capture_intents FOR EACH ROW EXECUTE FUNCTION pf_barrier_immutable();
DROP TRIGGER IF EXISTS pf_barrier_command_closure_immutable ON pf_barrier_command_closures;
CREATE TRIGGER pf_barrier_command_closure_immutable BEFORE UPDATE OR DELETE ON pf_barrier_command_closures FOR EACH ROW EXECUTE FUNCTION pf_barrier_immutable();
`;

/** Caller runs this additive initializer only against the explicitly owned installation. */
export async function initializeBarrierRegistrySchema(pool: Pool): Promise<void> {
  const client = await pool.connect(); let commitStarted = false, discardConnection = false;
  try {
    await client.query('BEGIN'); await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-purpose-policy-schema-v1'))");
    await client.query(BARRIER_REGISTRY_SQL);
    for (const table of ['pf_barrier_snapshots', 'pf_barrier_receipts']) {
      await client.query(`DROP TRIGGER IF EXISTS pf_barrier_immutable ON ${table}`);
      await client.query(`CREATE TRIGGER pf_barrier_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION pf_barrier_immutable()`);
    }
    commitStarted = true; await client.query('COMMIT');
  } catch (error) {
    discardConnection = commitStarted; try { await client.query('ROLLBACK'); } catch { discardConnection = true; } throw error;
  } finally { client.release(discardConnection ? true : undefined); }
}
