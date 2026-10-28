import type { Pool } from 'pg';

export const ENDPOINT_BINDING_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS pf_geometry_object_tenant_record ON pf_geometry_object_revisions(project_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS pf_geometry_object_tenant_trace_record ON pf_geometry_object_revisions(project_id,trace_id,id);
CREATE TABLE IF NOT EXISTS pf_endpoint_binding_revisions (
 id uuid PRIMARY KEY,project_id uuid NOT NULL,location_id uuid NOT NULL,model_version_id uuid NOT NULL,aggregate_id uuid NOT NULL,
 binding_revision bigint NOT NULL CHECK(binding_revision>0),trace_id uuid,object_revision_id uuid,record_sha256 text NOT NULL CHECK(record_sha256~'^[a-f0-9]{64}$'),record jsonb NOT NULL CHECK(octet_length(record::text)<=65536),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,id),UNIQUE(project_id,location_id,id),UNIQUE(project_id,location_id,binding_revision),
 FOREIGN KEY(project_id,location_id) REFERENCES pf_locations(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,aggregate_id) REFERENCES pf_preparation_aggregates(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,trace_id) REFERENCES pf_geometry_trace_sets(project_id,id),
 FOREIGN KEY(project_id,trace_id,object_revision_id) REFERENCES pf_geometry_object_revisions(project_id,trace_id,id),
 CHECK((trace_id IS NULL)=(object_revision_id IS NULL))
);
CREATE TABLE IF NOT EXISTS pf_endpoint_binding_heads (
 project_id uuid NOT NULL,location_id uuid NOT NULL,binding_id uuid NOT NULL,binding_revision bigint NOT NULL CHECK(binding_revision>0),
 PRIMARY KEY(project_id,location_id),
 FOREIGN KEY(project_id,location_id,binding_id) REFERENCES pf_endpoint_binding_revisions(project_id,location_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pf_endpoint_binding_commands (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,actor_id uuid NOT NULL,idempotency_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('confirm','migration','migration-confirm')),request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),request jsonb NOT NULL,receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,actor_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS pf_endpoint_legacy_observations (
 id uuid PRIMARY KEY,project_id uuid NOT NULL,location_id uuid NOT NULL,model_version_id uuid NOT NULL,legacy_revision bigint NOT NULL CHECK(legacy_revision>0),
 record_sha256 text NOT NULL CHECK(record_sha256~'^[a-f0-9]{64}$'),record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,id),UNIQUE(project_id,location_id,model_version_id,legacy_revision),
 FOREIGN KEY(project_id,location_id) REFERENCES pf_locations(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pf_endpoint_migration_decisions (
 id uuid PRIMARY KEY,project_id uuid NOT NULL,location_id uuid NOT NULL,source_binding_id uuid NOT NULL,target_aggregate_id uuid NOT NULL,
 input_sha256 text NOT NULL CHECK(input_sha256~'^[a-f0-9]{64}$'),record_sha256 text NOT NULL CHECK(record_sha256~'^[a-f0-9]{64}$'),record jsonb NOT NULL,
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id),UNIQUE(project_id,input_sha256),
 FOREIGN KEY(project_id,location_id,source_binding_id) REFERENCES pf_endpoint_binding_revisions(project_id,location_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,target_aggregate_id) REFERENCES pf_preparation_aggregates(project_id,id) ON DELETE CASCADE
);
CREATE OR REPLACE FUNCTION pf_endpoint_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Endpoint binding evidence is immutable';END $$;
`;

/** Additive initialization; never grants historical v1 points new attachment authority. */
export async function initializeEndpointBindingSchema(pool: Pool): Promise<void> {
  const c = await pool.connect(); let commitStarted = false, discard = false;
  try {
    await c.query('BEGIN'); await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-purpose-policy-schema-v1'))"); await c.query(ENDPOINT_BINDING_SQL);
    for (const table of ['pf_endpoint_binding_revisions', 'pf_endpoint_binding_commands', 'pf_endpoint_legacy_observations', 'pf_endpoint_migration_decisions']) {
      await c.query(`DROP TRIGGER IF EXISTS pf_endpoint_binding_immutable ON ${table}`);
      await c.query(`CREATE TRIGGER pf_endpoint_binding_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION pf_endpoint_binding_immutable()`);
    }
    commitStarted = true; await c.query('COMMIT');
  } catch (error) { discard = commitStarted; try { await c.query('ROLLBACK'); } catch { discard = true; } throw error; }
  finally { c.release(discard ? true : undefined); }
}
