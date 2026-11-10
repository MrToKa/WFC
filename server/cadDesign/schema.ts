import type { Pool } from 'pg';

/**
 * Additive POC tables. The original model registry, model resources and WFC project
 * records remain untouched. Called after initializeModelRegistry(), when
 * model_versions and project_model_selections already exist.
 */
export async function initializeCadDesignSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cad_catalog_items (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      manufacturer TEXT NOT NULL CHECK (length(trim(manufacturer)) BETWEEN 1 AND 100),
      part_number TEXT NOT NULL CHECK (length(trim(part_number)) BETWEEN 1 AND 160),
      family TEXT NOT NULL CHECK (length(trim(family)) BETWEEN 1 AND 100),
      original_filename TEXT NOT NULL,
      source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
      source_object_key TEXT NOT NULL UNIQUE,
      source_bytes BIGINT NOT NULL CHECK (source_bytes BETWEEN 1 AND 52428800),
      mesh_object_key TEXT,
      mesh_metadata JSONB,
      conversion_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (conversion_status IN ('pending', 'ready', 'failed')),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (conversion_status <> 'ready' OR (mesh_object_key IS NOT NULL AND mesh_metadata IS NOT NULL)),
      UNIQUE (project_id, source_sha256),
      UNIQUE (project_id, id)
    );

    CREATE TABLE IF NOT EXISTS cad_designs (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      model_version_id UUID NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed','approved','archived')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (project_id, model_version_id),
      UNIQUE (project_id, id),
      FOREIGN KEY (project_id, model_version_id)
        REFERENCES model_versions(project_id, id)
    );

    CREATE TABLE IF NOT EXISTS cad_design_instances (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL,
      design_id UUID NOT NULL,
      catalog_item_id UUID NOT NULL,
      x_mm DOUBLE PRECISION NOT NULL CHECK (x_mm BETWEEN -1000000000 AND 1000000000),
      y_mm DOUBLE PRECISION NOT NULL CHECK (y_mm BETWEEN -1000000000 AND 1000000000),
      z_mm DOUBLE PRECISION NOT NULL CHECK (z_mm BETWEEN -1000000000 AND 1000000000),
      qx DOUBLE PRECISION NOT NULL CHECK (qx BETWEEN -1 AND 1),
      qy DOUBLE PRECISION NOT NULL CHECK (qy BETWEEN -1 AND 1),
      qz DOUBLE PRECISION NOT NULL CHECK (qz BETWEEN -1 AND 1),
      qw DOUBLE PRECISION NOT NULL CHECK (qw BETWEEN -1 AND 1),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (project_id, id),
      UNIQUE (project_id, design_id, id, catalog_item_id),
      FOREIGN KEY (project_id, design_id) REFERENCES cad_designs(project_id, id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, catalog_item_id) REFERENCES cad_catalog_items(project_id, id),
      CONSTRAINT cad_unit_quaternion CHECK (
        qx*qx + qy*qy + qz*qz + qw*qw BETWEEN 0.999999 AND 1.000001
      )
    );

    CREATE INDEX IF NOT EXISTS cad_design_instances_design_idx
      ON cad_design_instances(project_id, design_id, created_at, id);

    CREATE TABLE IF NOT EXISTS cad_catalog_ports (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL,
      catalog_item_id UUID NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
      port_type TEXT NOT NULL CHECK (length(trim(port_type)) BETWEEN 1 AND 80),
      local_transform JSONB NOT NULL CHECK (jsonb_typeof(local_transform) = 'object'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (catalog_item_id, name),
      UNIQUE (project_id, catalog_item_id, id),
      FOREIGN KEY (project_id, catalog_item_id) REFERENCES cad_catalog_items(project_id, id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cad_design_connections (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL,
      design_id UUID NOT NULL,
      source_instance_id UUID NOT NULL,
      source_catalog_item_id UUID NOT NULL,
      source_port_id UUID NOT NULL,
      target_instance_id UUID NOT NULL,
      target_catalog_item_id UUID NOT NULL,
      target_port_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (source_instance_id <> target_instance_id),
      UNIQUE (project_id, source_instance_id, source_port_id),
      UNIQUE (project_id, target_instance_id, target_port_id),
      FOREIGN KEY (project_id, design_id) REFERENCES cad_designs(project_id, id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, design_id, source_instance_id, source_catalog_item_id)
        REFERENCES cad_design_instances(project_id, design_id, id, catalog_item_id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, design_id, target_instance_id, target_catalog_item_id)
        REFERENCES cad_design_instances(project_id, design_id, id, catalog_item_id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, source_catalog_item_id, source_port_id)
        REFERENCES cad_catalog_ports(project_id, catalog_item_id, id),
      FOREIGN KEY (project_id, target_catalog_item_id, target_port_id)
        REFERENCES cad_catalog_ports(project_id, catalog_item_id, id)
    );

    -- The client must not pick a CAD revision number. Every persisted placement
    -- or connection advances the export proposal revision atomically.
    CREATE OR REPLACE FUNCTION cad_touch_design_revision() RETURNS TRIGGER
    LANGUAGE plpgsql AS $cad$
    DECLARE v_project UUID; v_design UUID;
    BEGIN
      IF TG_OP = 'DELETE' THEN v_project := OLD.project_id; v_design := OLD.design_id;
      ELSE v_project := NEW.project_id; v_design := NEW.design_id; END IF;
      UPDATE cad_designs SET revision=revision+1, updated_at=now()
        WHERE project_id=v_project AND id=v_design;
      RETURN NULL;
    END;
    $cad$;

    DROP TRIGGER IF EXISTS cad_instance_revision_trigger ON cad_design_instances;
    CREATE TRIGGER cad_instance_revision_trigger
      AFTER INSERT OR UPDATE OR DELETE ON cad_design_instances
      FOR EACH ROW EXECUTE FUNCTION cad_touch_design_revision();

    DROP TRIGGER IF EXISTS cad_connection_revision_trigger ON cad_design_connections;
    CREATE TRIGGER cad_connection_revision_trigger
      AFTER INSERT OR UPDATE OR DELETE ON cad_design_connections
      FOR EACH ROW EXECUTE FUNCTION cad_touch_design_revision();
  `);
}
