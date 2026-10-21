import type { Pool } from 'pg';
import { CABLE_ENDPOINT_SELECTION_INDEX_SQL } from './cableEndpointSelectionSchema.js';
import { initializeLocationImpactSchema } from './locationImpactSchema.js';
import { initializeInitialFillMandateSchema } from './initialFillMandateSchema.js';
import { initializeInitialFillAttemptSchema } from './initialFillAttemptSchema.js';
import { initializePathFinderJobs } from './jobsSchema.js';
import { initializePurposePolicySchema } from './policySchema.js';
import { initializeArtifactRoutingScope } from './routingScope.js';
import { initializeRoutingPolicySchema } from './purposePolicy.js';
import { initializeDrawingPolicySchema } from './drawingPolicy.js';
import { initializeDrawingSnapshotSchema } from './drawingSnapshots.js';
import { initializeDrawingExportSchema } from './drawingExports.js';
import { initializePreparationSchema } from './preparationSessions.js';
import { initializeGeometryTraceSchema } from './geometryTraceSchema.js';
import { initializeEndpointBindingSchema } from './endpointBindingSchema.js';
import { initializeRevisionComparisonSchema } from './revisionComparisonSchema.js';
import { initializeRecalculationSchema } from './recalculationSchema.js';
import { initializeWorkerScheduling } from './workerScheduling.js';
import { initializeCalculationGrantSchema } from './calculationGrantSchema.js';
import { initializeGrantOperationSchema } from './grantOperationSchema.js';
import { initializeProducerResourceSchema } from './producerResourceSchema.js';
import { initializeRevisionResultSchema } from './revisionResultSchema.js';
import { initializeApplyRecoverySchema } from './applyRecoverySchema.js';
import { initializeBarrierRegistrySchema } from './barrierRegistrySchema.js';

export async function initializePathFinder(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-schema-v1'))");
    await client.query(`
      ALTER TABLE cables ADD COLUMN IF NOT EXISTS cable_write_revision BIGINT NOT NULL DEFAULT 0 CHECK (cable_write_revision >= 0);
      CREATE OR REPLACE FUNCTION own_cable_write_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP = 'INSERT' THEN NEW.cable_write_revision := 0;
        ELSE
          NEW.cable_write_revision := OLD.cable_write_revision;
          IF current_setting('wfc.pathfinder_apply',true)='1' OR ROW(NEW.cable_id,NEW.revision,NEW.mto,NEW.tag,NEW.cable_type_id,NEW.from_location,NEW.to_location,
                 NEW.routing,NEW.delivery,NEW.design_length,NEW.install_length,NEW.pull_date,NEW.connected_from,NEW.connected_to,NEW.tested)
             IS DISTINCT FROM
             ROW(OLD.cable_id,OLD.revision,OLD.mto,OLD.tag,OLD.cable_type_id,OLD.from_location,OLD.to_location,
                 OLD.routing,OLD.delivery,OLD.design_length,OLD.install_length,OLD.pull_date,OLD.connected_from,OLD.connected_to,OLD.tested)
          THEN NEW.cable_write_revision := OLD.cable_write_revision + 1; END IF;
        END IF;
        RETURN NEW;
      END $$;
      DROP TRIGGER IF EXISTS cable_write_revision_owned ON cables;
      CREATE TRIGGER cable_write_revision_owned BEFORE INSERT OR UPDATE ON cables FOR EACH ROW EXECUTE FUNCTION own_cable_write_revision();
      CREATE UNIQUE INDEX IF NOT EXISTS cables_project_record_identity ON cables(project_id,id);
      CREATE TABLE IF NOT EXISTS pf_project_state (
        project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        registry_revision BIGINT NOT NULL DEFAULT 0 CHECK (registry_revision >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO pf_project_state(project_id) SELECT id FROM projects ON CONFLICT DO NOTHING;
      CREATE OR REPLACE FUNCTION initialize_pf_project() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO pf_project_state(project_id) VALUES(NEW.id) ON CONFLICT DO NOTHING; RETURN NEW;
      END $$;
      DROP TRIGGER IF EXISTS initialize_pf_project ON projects;
      CREATE TRIGGER initialize_pf_project AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION initialize_pf_project();
      CREATE TABLE IF NOT EXISTS pf_locations (
        id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 1 CHECK(revision > 0),
        created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(project_id,id)
      );
      CREATE TABLE IF NOT EXISTS pf_location_aliases (
        project_id UUID NOT NULL, normalized_alias TEXT NOT NULL, display_alias TEXT NOT NULL, location_id UUID NOT NULL,
        PRIMARY KEY(project_id,normalized_alias),
        FOREIGN KEY(project_id,location_id) REFERENCES pf_locations(project_id,id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS pf_artifacts (
        id UUID PRIMARY KEY, project_id UUID NOT NULL, model_version_id UUID NOT NULL,
        content_fingerprint TEXT NOT NULL CHECK(content_fingerprint ~ '^[a-f0-9]{64}$'),
        snapshot_sha256 TEXT NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'), snapshot_bytes BIGINT NOT NULL CHECK(snapshot_bytes > 0 AND snapshot_bytes <= 268435456),
        capture JSONB NOT NULL, coordinates JSONB NOT NULL, object_count INTEGER NOT NULL CHECK(object_count > 0 AND object_count <= 1000000),
        engineering_accepted BOOLEAN NOT NULL DEFAULT FALSE CHECK(engineering_accepted = FALSE),
        created_by UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(project_id,id), UNIQUE(project_id,model_version_id,id),
        FOREIGN KEY(project_id,model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE
      );
      ALTER TABLE pf_artifacts ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'planning' CHECK(purpose IN ('planning','lookup'));
      CREATE INDEX IF NOT EXISTS pf_lookup_artifact_content ON pf_artifacts(project_id,model_version_id,content_fingerprint,snapshot_sha256) WHERE purpose='lookup';
      CREATE TABLE IF NOT EXISTS pf_model_objects (
        project_id UUID NOT NULL, artifact_id UUID NOT NULL, object_id TEXT NOT NULL, external_id TEXT, db_id INTEGER,
        name TEXT NOT NULL, geometry_role TEXT NOT NULL CHECK(geometry_role IN ('hierarchy','object','routing-leaf')),
        anchor JSONB NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('visible','hidden','unknown')),
        match_names JSONB NOT NULL, PRIMARY KEY(project_id,artifact_id,object_id),
        FOREIGN KEY(project_id,artifact_id) REFERENCES pf_artifacts(project_id,id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS pf_location_bindings (
        project_id UUID NOT NULL, location_id UUID NOT NULL, model_version_id UUID NOT NULL, artifact_id UUID,
        revision BIGINT NOT NULL DEFAULT 1 CHECK(revision > 0), point JSONB NOT NULL,
        object_id TEXT, external_id TEXT, source TEXT NOT NULL CHECK(source IN ('manual','automatic')),
        confirmed_by UUID NOT NULL, confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(project_id,location_id,model_version_id),
        FOREIGN KEY(project_id,location_id) REFERENCES pf_locations(project_id,id) ON DELETE CASCADE,
        FOREIGN KEY(project_id,model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE,
        FOREIGN KEY(project_id,model_version_id,artifact_id) REFERENCES pf_artifacts(project_id,model_version_id,id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS pf_location_matches (
        project_id UUID NOT NULL, location_id UUID NOT NULL, model_version_id UUID NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('missing','ambiguous','unverified')), candidate_object_ids JSONB NOT NULL,
        PRIMARY KEY(project_id,location_id,model_version_id),
        FOREIGN KEY(project_id,location_id) REFERENCES pf_locations(project_id,id) ON DELETE CASCADE,
        FOREIGN KEY(project_id,model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE
      );
      ALTER TABLE pf_location_bindings ADD COLUMN IF NOT EXISTS derivation TEXT NOT NULL DEFAULT 'manual-world-point'
        CHECK(derivation IN ('manual-world-point','picked-surface-point','equipment-bottom-aabb'));
      ALTER TABLE pf_location_bindings ADD COLUMN IF NOT EXISTS coordinate_frame TEXT NOT NULL DEFAULT 'canonical-world-metres'
        CHECK(coordinate_frame='canonical-world-metres');
      UPDATE pf_location_bindings SET derivation='equipment-bottom-aabb' WHERE source='automatic' AND derivation='manual-world-point';
      CREATE TABLE IF NOT EXISTS pf_location_events (
        id UUID PRIMARY KEY,project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        location_id UUID NOT NULL,model_version_id UUID,actor_id UUID NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('create','update','bind','auto_create','auto_bind')),
        registry_revision BIGINT NOT NULL,event_data JSONB NOT NULL CHECK(octet_length(event_data::text)<=262144),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS pf_location_events_project ON pf_location_events(project_id,created_at,id);
      CREATE OR REPLACE FUNCTION protect_pf_location_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'Location audit events are append-only'; END $$;
      DROP TRIGGER IF EXISTS pf_location_event_append_only ON pf_location_events;
      CREATE TRIGGER pf_location_event_append_only BEFORE UPDATE OR DELETE ON pf_location_events FOR EACH ROW EXECUTE FUNCTION protect_pf_location_event();
      CREATE INDEX IF NOT EXISTS pf_artifacts_model ON pf_artifacts(project_id,model_version_id,created_at DESC,id);
    `);
    await client.query(CABLE_ENDPOINT_SELECTION_INDEX_SQL);
    await initializeArtifactRoutingScope(client);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
  await initializePathFinderJobs(pool);
  await initializePurposePolicySchema(pool);
  await initializeRoutingPolicySchema(pool);
  await initializeDrawingPolicySchema(pool);
  await initializeDrawingSnapshotSchema(pool);
  await initializeDrawingExportSchema(pool);
  await initializePreparationSchema(pool);
  await initializeGeometryTraceSchema(pool);
  await initializeBarrierRegistrySchema(pool);
  await initializeEndpointBindingSchema(pool);
  await initializeRevisionComparisonSchema(pool);
  await initializeWorkerScheduling(pool);
  await initializeRecalculationSchema(pool);
  await initializeCalculationGrantSchema(pool);
  await initializeGrantOperationSchema(pool);
  await initializeProducerResourceSchema(pool);
  await initializeRevisionResultSchema(pool);
  await initializeLocationImpactSchema(pool);
  await initializeInitialFillMandateSchema(pool);
  await initializeInitialFillAttemptSchema(pool);
  await initializeApplyRecoverySchema(pool);
}
