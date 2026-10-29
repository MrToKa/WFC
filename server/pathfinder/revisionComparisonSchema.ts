import type { Pool } from 'pg';

/** Additive state. Historic observations and endpoint records are never upgraded in place. */
export const REVISION_COMPARISON_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS pf_geometry_trace_tenant_aggregate ON pf_geometry_trace_sets(project_id,id,aggregate_id);
CREATE TABLE IF NOT EXISTS pf_revision_comparison_state (
 project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 comparison_revision bigint NOT NULL DEFAULT 0 CHECK(comparison_revision>=0)
);
INSERT INTO pf_revision_comparison_state(project_id) SELECT id FROM projects ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS pf_revision_comparison_intents (
 id uuid PRIMARY KEY,admission_order bigint GENERATED ALWAYS AS IDENTITY,project_id uuid NOT NULL,source_aggregate_id uuid NOT NULL,target_aggregate_id uuid NOT NULL,
 source_trace_id uuid NOT NULL,target_trace_id uuid NOT NULL,target_model_version_id uuid NOT NULL,
 actor_id uuid NOT NULL,idempotency_key uuid NOT NULL,input_sha256 text NOT NULL CHECK(input_sha256~'^[a-f0-9]{64}$'),
 request jsonb NOT NULL,frozen jsonb NOT NULL,state text NOT NULL CHECK(state IN('pending','complete')),
 lease_token uuid NOT NULL,lease_expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,id),UNIQUE(project_id,actor_id,idempotency_key),
 FOREIGN KEY(project_id,source_trace_id,source_aggregate_id) REFERENCES pf_geometry_trace_sets(project_id,id,aggregate_id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,target_trace_id,target_aggregate_id) REFERENCES pf_geometry_trace_sets(project_id,id,aggregate_id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,target_model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE,
 CHECK(source_aggregate_id<>target_aggregate_id)
);
CREATE TABLE IF NOT EXISTS pf_revision_comparison_sets (
 id uuid PRIMARY KEY,project_id uuid NOT NULL,source_aggregate_id uuid NOT NULL,target_aggregate_id uuid NOT NULL,
 source_trace_id uuid NOT NULL,target_trace_id uuid NOT NULL,target_model_version_id uuid NOT NULL,
 manifest jsonb NOT NULL CHECK(octet_length(manifest::text)<=262144),rows_blob jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id),UNIQUE(project_id,id,target_aggregate_id,target_model_version_id),
 FOREIGN KEY(project_id,id) REFERENCES pf_revision_comparison_intents(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,source_trace_id,source_aggregate_id) REFERENCES pf_geometry_trace_sets(project_id,id,aggregate_id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,target_trace_id,target_aggregate_id) REFERENCES pf_geometry_trace_sets(project_id,id,aggregate_id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,target_model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pf_revision_comparison_targets (
 project_id uuid NOT NULL,target_aggregate_id uuid NOT NULL,target_model_version_id uuid NOT NULL,
 comparison_revision bigint NOT NULL DEFAULT 0 CHECK(comparison_revision>=0),current_comparison_id uuid,
 decision_set_sha256 text NOT NULL CHECK(decision_set_sha256~'^[a-f0-9]{64}$'),
 PRIMARY KEY(project_id,target_aggregate_id,target_model_version_id),
 FOREIGN KEY(project_id,target_aggregate_id) REFERENCES pf_preparation_aggregates(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,target_model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,current_comparison_id,target_aggregate_id,target_model_version_id)
  REFERENCES pf_revision_comparison_sets(project_id,id,target_aggregate_id,target_model_version_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pf_revision_comparison_changes (
 project_id uuid NOT NULL,comparison_id uuid NOT NULL,row_index int NOT NULL CHECK(row_index>=0),
 record_sha256 text NOT NULL CHECK(record_sha256~'^[a-f0-9]{64}$'),record jsonb NOT NULL CHECK(octet_length(record::text)<=1048576),
 PRIMARY KEY(project_id,comparison_id,row_index),
 FOREIGN KEY(project_id,comparison_id) REFERENCES pf_revision_comparison_sets(project_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pf_revision_comparison_decisions (
 id uuid PRIMARY KEY,project_id uuid NOT NULL,comparison_id uuid NOT NULL,subject_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN('object-mapping','frame-mapping','binding-frame-qualification')),
 decision_revision bigint NOT NULL CHECK(decision_revision>0),comparison_revision bigint NOT NULL CHECK(comparison_revision>0),
 previous_decision_id uuid,source_binding_id uuid,frame_decision_id uuid,
 record_sha256 text NOT NULL CHECK(record_sha256~'^[a-f0-9]{64}$'),record jsonb NOT NULL CHECK(octet_length(record::text)<=65536),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id),UNIQUE(project_id,comparison_id,id),UNIQUE(project_id,comparison_id,subject_key,id),
 UNIQUE(project_id,comparison_id,subject_key,decision_revision),
 FOREIGN KEY(project_id,comparison_id) REFERENCES pf_revision_comparison_sets(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,comparison_id,subject_key,previous_decision_id) REFERENCES pf_revision_comparison_decisions(project_id,comparison_id,subject_key,id),
 FOREIGN KEY(project_id,source_binding_id) REFERENCES pf_endpoint_binding_revisions(project_id,id),
 FOREIGN KEY(project_id,comparison_id,frame_decision_id) REFERENCES pf_revision_comparison_decisions(project_id,comparison_id,id),
 CHECK((kind='binding-frame-qualification')=(source_binding_id IS NOT NULL)),
 CHECK((kind='binding-frame-qualification')=(frame_decision_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS pf_revision_comparison_decision_heads (
 project_id uuid NOT NULL,comparison_id uuid NOT NULL,subject_key text NOT NULL,decision_id uuid NOT NULL,
 PRIMARY KEY(project_id,comparison_id,subject_key),
 FOREIGN KEY(project_id,comparison_id,subject_key,decision_id) REFERENCES pf_revision_comparison_decisions(project_id,comparison_id,subject_key,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pf_revision_comparison_decision_objects (
 project_id uuid NOT NULL,decision_id uuid NOT NULL,side text NOT NULL CHECK(side IN('source','target')),
 trace_id uuid NOT NULL,object_revision_id uuid NOT NULL,member_index int NOT NULL CHECK(member_index>=0),
 PRIMARY KEY(project_id,decision_id,side,member_index),UNIQUE(project_id,decision_id,side,object_revision_id),
 FOREIGN KEY(project_id,decision_id) REFERENCES pf_revision_comparison_decisions(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,trace_id,object_revision_id) REFERENCES pf_geometry_object_revisions(project_id,trace_id,id)
);
CREATE TABLE IF NOT EXISTS pf_revision_comparison_commands (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,actor_id uuid NOT NULL,idempotency_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('create','decision')),request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),
 request jsonb NOT NULL,receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,actor_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS pf_revision_binding_frame_qualifications (
 project_id uuid NOT NULL,comparison_id uuid NOT NULL,decision_id uuid NOT NULL,source_binding_id uuid NOT NULL,
 record_sha256 text NOT NULL CHECK(record_sha256~'^[a-f0-9]{64}$'),record jsonb NOT NULL CHECK(octet_length(record::text)<=65536),
 PRIMARY KEY(project_id,decision_id),
 FOREIGN KEY(project_id,comparison_id) REFERENCES pf_revision_comparison_sets(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,comparison_id,decision_id) REFERENCES pf_revision_comparison_decisions(project_id,comparison_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,source_binding_id) REFERENCES pf_endpoint_binding_revisions(project_id,id)
);
CREATE OR REPLACE FUNCTION pf_revision_comparison_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Revision comparison evidence is immutable';END $$;
CREATE OR REPLACE FUNCTION pf_revision_decision_object_scope() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE expected_trace uuid; BEGIN
 SELECT CASE WHEN NEW.side='source' THEN s.source_trace_id ELSE s.target_trace_id END INTO expected_trace
 FROM pf_revision_comparison_decisions d JOIN pf_revision_comparison_sets s ON s.project_id=d.project_id AND s.id=d.comparison_id
 WHERE d.project_id=NEW.project_id AND d.id=NEW.decision_id AND d.kind='object-mapping';
 IF expected_trace IS NULL OR expected_trace<>NEW.trace_id THEN RAISE EXCEPTION 'Comparison object evidence is outside its exact side';END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_revision_decision_object_scope ON pf_revision_comparison_decision_objects;
CREATE TRIGGER pf_revision_decision_object_scope BEFORE INSERT ON pf_revision_comparison_decision_objects FOR EACH ROW EXECUTE FUNCTION pf_revision_decision_object_scope();
CREATE OR REPLACE FUNCTION pf_revision_binding_qualification_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pf_revision_comparison_decisions d WHERE d.project_id=NEW.project_id AND d.comparison_id=NEW.comparison_id AND d.id=NEW.decision_id AND d.source_binding_id=NEW.source_binding_id AND d.kind='binding-frame-qualification')
 THEN RAISE EXCEPTION 'Binding frame qualification is outside its exact decision';END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_revision_binding_qualification_scope ON pf_revision_binding_frame_qualifications;
CREATE TRIGGER pf_revision_binding_qualification_scope BEFORE INSERT ON pf_revision_binding_frame_qualifications FOR EACH ROW EXECUTE FUNCTION pf_revision_binding_qualification_scope();
CREATE OR REPLACE FUNCTION pf_revision_comparison_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state='complete' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Completed comparison intent is immutable';END IF;
 IF ROW(NEW.id,NEW.admission_order,NEW.project_id,NEW.source_aggregate_id,NEW.target_aggregate_id,NEW.source_trace_id,NEW.target_trace_id,
 NEW.target_model_version_id,NEW.actor_id,NEW.idempotency_key,NEW.input_sha256,NEW.request,NEW.frozen,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.admission_order,OLD.project_id,OLD.source_aggregate_id,OLD.target_aggregate_id,OLD.source_trace_id,OLD.target_trace_id,
 OLD.target_model_version_id,OLD.actor_id,OLD.idempotency_key,OLD.input_sha256,OLD.request,OLD.frozen,OLD.created_at)
 THEN RAISE EXCEPTION 'Comparison intent identity is immutable';END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_revision_comparison_intent_guard ON pf_revision_comparison_intents;
CREATE TRIGGER pf_revision_comparison_intent_guard BEFORE UPDATE ON pf_revision_comparison_intents FOR EACH ROW EXECUTE FUNCTION pf_revision_comparison_intent_guard();
DROP TRIGGER IF EXISTS pf_revision_comparison_intent_delete ON pf_revision_comparison_intents;
CREATE TRIGGER pf_revision_comparison_intent_delete BEFORE DELETE ON pf_revision_comparison_intents FOR EACH ROW EXECUTE FUNCTION pf_revision_comparison_immutable();
DROP TRIGGER IF EXISTS pf_revision_comparison_target_delete ON pf_revision_comparison_targets;
CREATE TRIGGER pf_revision_comparison_target_delete BEFORE DELETE ON pf_revision_comparison_targets FOR EACH ROW EXECUTE FUNCTION pf_revision_comparison_immutable();
`;

export async function initializeRevisionComparisonSchema(pool: Pool): Promise<void> {
  const c = await pool.connect(); let commitStarted = false, discard = false;
  try {
    await c.query('BEGIN'); await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-purpose-policy-schema-v1'))");
    await c.query(REVISION_COMPARISON_SQL);
    for (const table of ['pf_revision_comparison_sets','pf_revision_comparison_changes','pf_revision_comparison_decisions','pf_revision_comparison_decision_objects','pf_revision_comparison_commands','pf_revision_binding_frame_qualifications']) {
      await c.query(`DROP TRIGGER IF EXISTS pf_revision_comparison_immutable ON ${table}`);
      await c.query(`CREATE TRIGGER pf_revision_comparison_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION pf_revision_comparison_immutable()`);
    }
    commitStarted = true; await c.query('COMMIT');
  } catch (error) { discard = commitStarted; try { await c.query('ROLLBACK'); } catch { discard = true; } throw error; }
  finally { c.release(discard ? true : undefined); }
}
