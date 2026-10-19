import type { Pool } from 'pg';

export const GEOMETRY_TRACE_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS pf_preparation_aggregate_tenant_identity ON pf_preparation_aggregates(project_id,id);
CREATE TABLE IF NOT EXISTS pf_geometry_trace_intents (
 id uuid PRIMARY KEY,project_id uuid NOT NULL,aggregate_id uuid NOT NULL,derivation_version text NOT NULL,
 input_sha256 text NOT NULL CHECK(input_sha256~'^[a-f0-9]{64}$'),frozen jsonb NOT NULL,
 state text NOT NULL CHECK(state IN('pending','complete')),lease_token uuid NOT NULL,lease_expires_at timestamptz NOT NULL,
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,id),UNIQUE(project_id,aggregate_id,derivation_version),
 FOREIGN KEY(project_id,aggregate_id) REFERENCES pf_preparation_aggregates(project_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pf_geometry_trace_sets (
 id uuid PRIMARY KEY,project_id uuid NOT NULL,aggregate_id uuid NOT NULL,model_version_id uuid NOT NULL,
 derivation_version text NOT NULL,manifest jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,id),UNIQUE(project_id,aggregate_id,derivation_version),
 FOREIGN KEY(project_id,id) REFERENCES pf_geometry_trace_intents(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,aggregate_id) REFERENCES pf_preparation_aggregates(project_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pf_geometry_object_revisions (
 id uuid PRIMARY KEY,project_id uuid NOT NULL,trace_id uuid NOT NULL,object_id text NOT NULL,order_index int NOT NULL CHECK(order_index>=0),
 project_tray_id uuid,summary jsonb NOT NULL,record jsonb NOT NULL,
 UNIQUE(project_id,trace_id,object_id),UNIQUE(project_id,trace_id,order_index),
 FOREIGN KEY(project_id,trace_id) REFERENCES pf_geometry_trace_sets(project_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pf_geometry_trace_receipts (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,actor_id uuid NOT NULL,idempotency_key uuid NOT NULL,
 request_sha256 text NOT NULL,request jsonb NOT NULL,receipt jsonb NOT NULL,
 PRIMARY KEY(project_id,actor_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS pf_geometry_trace_diagnostics (
 project_id uuid NOT NULL,trace_id uuid NOT NULL,order_index int NOT NULL CHECK(order_index>=0),message text NOT NULL,
 PRIMARY KEY(project_id,trace_id,order_index),FOREIGN KEY(project_id,trace_id) REFERENCES pf_geometry_trace_sets(project_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pf_capture_evidence (
 project_id uuid NOT NULL,session_id uuid NOT NULL,part_id uuid NOT NULL,receipt jsonb NOT NULL,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,session_id,part_id),FOREIGN KEY(session_id,part_id) REFERENCES pf_preparation_parts(session_id,part_id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,session_id) REFERENCES pf_preparation_sessions(project_id,id) ON DELETE CASCADE
);
CREATE OR REPLACE FUNCTION pf_geometry_trace_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Geometry trace proof is immutable';END $$;
CREATE OR REPLACE FUNCTION pf_geometry_trace_intent_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state='complete' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Completed geometry trace intent is immutable';END IF;
 IF ROW(NEW.id,NEW.project_id,NEW.aggregate_id,NEW.derivation_version,NEW.input_sha256,NEW.frozen,NEW.created_by,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.project_id,OLD.aggregate_id,OLD.derivation_version,OLD.input_sha256,OLD.frozen,OLD.created_by,OLD.created_at)
 THEN RAISE EXCEPTION 'Geometry trace intent identity is immutable';END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_geometry_trace_intent_immutable ON pf_geometry_trace_intents;
CREATE TRIGGER pf_geometry_trace_intent_immutable BEFORE UPDATE ON pf_geometry_trace_intents FOR EACH ROW EXECUTE FUNCTION pf_geometry_trace_intent_immutable();
DROP TRIGGER IF EXISTS pf_geometry_trace_intent_delete ON pf_geometry_trace_intents;
CREATE TRIGGER pf_geometry_trace_intent_delete BEFORE DELETE ON pf_geometry_trace_intents FOR EACH ROW EXECUTE FUNCTION pf_geometry_trace_immutable();
`;
export async function initializeGeometryTraceSchema(pool: Pool): Promise<void> {
  const client = await pool.connect(); let commitStarted = false, discardConnection = false;
  try { await client.query('BEGIN'); await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-purpose-policy-schema-v1'))"); await client.query(GEOMETRY_TRACE_SQL);
    for (const table of ['pf_geometry_trace_sets', 'pf_geometry_object_revisions', 'pf_geometry_trace_receipts', 'pf_geometry_trace_diagnostics', 'pf_capture_evidence']) { await client.query(`DROP TRIGGER IF EXISTS pf_geometry_trace_immutable ON ${table}`); await client.query(`CREATE TRIGGER pf_geometry_trace_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION pf_geometry_trace_immutable()`); }
    commitStarted = true; await client.query('COMMIT');
  } catch (error) { discardConnection = commitStarted; try { await client.query('ROLLBACK'); } catch { discardConnection = true; } throw error; } finally { client.release(discardConnection ? true : undefined); }
}
