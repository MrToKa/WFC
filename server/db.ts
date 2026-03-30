import { Pool } from 'pg';
import { config } from './config.js';
import { CABLE_MTO_VALUES } from './models/cable.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
});

const cableMtoConstraintValues = CABLE_MTO_VALUES.map((value) => `'${value}'`).join(', ');
const cableVersionChangeTypeConstraintValues = ["'create'", "'update'"].join(', ');
const cableVersionChangeSourceConstraintValues = ["'manual'", "'import'"].join(', ');

export async function initializeDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY,
      project_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      customer TEXT NOT NULL,
      manager TEXT,
      description TEXT,
      secondary_tray_length NUMERIC,
      support_distance NUMERIC,
      support_weight NUMERIC,
      tray_load_safety_factor NUMERIC,
      cable_layout_settings JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS manager TEXT;
  `);

  await pool.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS secondary_tray_length NUMERIC;
  `);

  await pool.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS support_distance NUMERIC;
  `);

  await pool.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS support_weight NUMERIC;
  `);

  await pool.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS tray_load_safety_factor NUMERIC;
  `);

  await pool.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS cable_layout_settings JSONB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_support_distances (
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      tray_type TEXT NOT NULL,
      support_distance NUMERIC NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project_id, tray_type)
    );
  `);

  await pool.query(`
    ALTER TABLE project_support_distances
    ALTER COLUMN support_distance DROP NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_files (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      object_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_type TEXT,
      size_bytes BIGINT,
      uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS project_files_project_id_idx
      ON project_files (project_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS project_files_uploaded_at_idx
      ON project_files (uploaded_at DESC);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS project_files_project_file_name_lower_idx
      ON project_files (project_id, LOWER(file_name));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_tray_purpose_templates (
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      tray_purpose TEXT NOT NULL,
      project_file_id UUID NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project_id, tray_purpose)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS project_tray_purpose_templates_file_idx
      ON project_tray_purpose_templates (project_file_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_file_versions (
      id UUID PRIMARY KEY,
      project_file_id UUID NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      object_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_type TEXT,
      size_bytes BIGINT,
      uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS project_file_versions_file_version_idx
      ON project_file_versions (project_file_id, version_number);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cable_types (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      tag TEXT,
      purpose TEXT,
      diameter_mm NUMERIC,
      weight_kg_per_m NUMERIC,
      from_location TEXT,
      to_location TEXT,
      routing TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cable_types_project_name_idx
      ON cable_types (project_id, lower(name));
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cable_types_project_id_idx
      ON cable_types (project_id);
  `);

  await pool.query(`
    ALTER TABLE cable_types
    ADD COLUMN IF NOT EXISTS material TEXT;
  `);

  await pool.query(`
    ALTER TABLE cable_types
    ADD COLUMN IF NOT EXISTS description TEXT;
  `);

  await pool.query(`
    ALTER TABLE cable_types
    ADD COLUMN IF NOT EXISTS manufacturer TEXT;
  `);

  await pool.query(`
    ALTER TABLE cable_types
    ADD COLUMN IF NOT EXISTS part_no TEXT;
  `);

  await pool.query(`
    ALTER TABLE cable_types
    ADD COLUMN IF NOT EXISTS remarks TEXT;
  `);

  await pool.query(`
    UPDATE cable_types AS ct
    SET
      material = COALESCE(ct.material, m.material),
      description = COALESCE(ct.description, m.description),
      manufacturer = COALESCE(ct.manufacturer, m.manufacturer),
      part_no = COALESCE(ct.part_no, m.part_no),
      remarks = COALESCE(ct.remarks, m.remarks)
    FROM material_cable_types AS m
    WHERE regexp_replace(lower(trim(ct.name)), '\\s+', ' ', 'g') =
        regexp_replace(lower(trim(m.name)), '\\s+', ' ', 'g');
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cable_type_default_materials (
      id UUID PRIMARY KEY,
      cable_type_id UUID NOT NULL REFERENCES cable_types(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      quantity NUMERIC,
      unit TEXT,
      remarks TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cable_type_default_materials_cable_type_id_idx
      ON cable_type_default_materials (cable_type_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_cable_types (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      purpose TEXT,
      material TEXT,
      description TEXT,
      manufacturer TEXT,
      part_no TEXT,
      remarks TEXT,
      diameter_mm NUMERIC,
      weight_kg_per_m NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE material_cable_types
    ADD COLUMN IF NOT EXISTS material TEXT;
  `);

  await pool.query(`
    ALTER TABLE material_cable_types
    ADD COLUMN IF NOT EXISTS description TEXT;
  `);

  await pool.query(`
    ALTER TABLE material_cable_types
    ADD COLUMN IF NOT EXISTS manufacturer TEXT;
  `);

  await pool.query(`
    ALTER TABLE material_cable_types
    ADD COLUMN IF NOT EXISTS part_no TEXT;
  `);

  await pool.query(`
    ALTER TABLE material_cable_types
    ADD COLUMN IF NOT EXISTS remarks TEXT;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_cable_types_name_lower_idx
      ON material_cable_types (LOWER(name));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_cable_installation_materials (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL,
      purpose TEXT,
      material TEXT,
      description TEXT,
      manufacturer TEXT,
      part_no TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE material_cable_installation_materials
    ADD COLUMN IF NOT EXISTS purpose TEXT;
  `);

  await pool.query(`
    ALTER TABLE material_cable_installation_materials
    ADD COLUMN IF NOT EXISTS material TEXT;
  `);

  await pool.query(`
    ALTER TABLE material_cable_installation_materials
    ADD COLUMN IF NOT EXISTS description TEXT;
  `);

  await pool.query(`
    ALTER TABLE material_cable_installation_materials
    ADD COLUMN IF NOT EXISTS manufacturer TEXT;
  `);

  await pool.query(`
    ALTER TABLE material_cable_installation_materials
    ADD COLUMN IF NOT EXISTS part_no TEXT;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_cable_installation_materials_type_lower_idx
      ON material_cable_installation_materials (LOWER(type));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cables (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      cable_id INTEGER NOT NULL,
      revision TEXT,
      mto TEXT,
      tag TEXT,
      cable_type_id UUID NOT NULL REFERENCES cable_types(id) ON DELETE CASCADE,
      from_location TEXT,
      to_location TEXT,
      routing TEXT,
      design_length INTEGER,
      install_length INTEGER,
      materials_initialized BOOLEAN NOT NULL DEFAULT FALSE,
      materials_customized BOOLEAN NOT NULL DEFAULT FALSE,
      pull_date DATE,
      connected_from DATE,
      connected_to DATE,
      tested DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cables_project_cable_id_idx
      ON cables (project_id, cable_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cables_project_id_idx
      ON cables (project_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cables_cable_type_id_idx
      ON cables (cable_type_id);
  `);

  await pool.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS revision TEXT;
  `);

  await pool.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS mto TEXT;
  `);

  await pool.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS design_length INTEGER;
  `);

  await pool.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS install_length INTEGER;
  `);

  await pool.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS materials_initialized BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS materials_customized BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS pull_date DATE;
  `);

  await pool.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS connected_from DATE;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'cables_mto_check'
          AND table_name = 'cables'
      ) THEN
        ALTER TABLE cables
          ADD CONSTRAINT cables_mto_check
          CHECK (mto IS NULL OR mto IN (${cableMtoConstraintValues}));
      END IF;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS connected_to DATE;
  `);

  await pool.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS tested DATE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cable_versions (
      id UUID PRIMARY KEY,
      cable_id UUID NOT NULL REFERENCES cables(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      change_type TEXT NOT NULL,
      change_source TEXT NOT NULL,
      cable_number INTEGER NOT NULL,
      revision TEXT,
      mto TEXT,
      tag TEXT,
      cable_type_id UUID NOT NULL,
      cable_type_name TEXT NOT NULL,
      from_location TEXT,
      to_location TEXT,
      routing TEXT,
      design_length INTEGER,
      install_length INTEGER,
      pull_date DATE,
      connected_from DATE,
      connected_to DATE,
      tested DATE,
      changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cable_versions_cable_version_idx
      ON cable_versions (cable_id, version_number);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cable_versions_cable_id_idx
      ON cable_versions (cable_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cable_versions_changed_by_idx
      ON cable_versions (changed_by);
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'cable_versions_change_type_check'
          AND table_name = 'cable_versions'
      ) THEN
        ALTER TABLE cable_versions
          ADD CONSTRAINT cable_versions_change_type_check
          CHECK (change_type IN (${cableVersionChangeTypeConstraintValues}));
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'cable_versions_change_source_check'
          AND table_name = 'cable_versions'
      ) THEN
        ALTER TABLE cable_versions
          ADD CONSTRAINT cable_versions_change_source_check
          CHECK (change_source IN (${cableVersionChangeSourceConstraintValues}));
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'cable_versions_mto_check'
          AND table_name = 'cable_versions'
      ) THEN
        ALTER TABLE cable_versions
          ADD CONSTRAINT cable_versions_mto_check
          CHECK (mto IS NULL OR mto IN (${cableMtoConstraintValues}));
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cable_materials (
      id UUID PRIMARY KEY,
      cable_id UUID NOT NULL REFERENCES cables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      quantity NUMERIC,
      unit TEXT,
      remarks TEXT,
      source TEXT,
      cable_type_default_material_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE cable_materials
    ADD COLUMN IF NOT EXISTS source TEXT;
  `);

  await pool.query(`
    ALTER TABLE cable_materials
    ADD COLUMN IF NOT EXISTS cable_type_default_material_id UUID;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'cable_materials_source_check'
          AND table_name = 'cable_materials'
      ) THEN
        ALTER TABLE cable_materials
          ADD CONSTRAINT cable_materials_source_check
          CHECK (source IS NULL OR source IN ('default', 'manual'));
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'cable_materials_cable_type_default_material_id_fkey'
          AND table_name = 'cable_materials'
      ) THEN
        ALTER TABLE cable_materials
          ADD CONSTRAINT cable_materials_cable_type_default_material_id_fkey
          FOREIGN KEY (cable_type_default_material_id)
          REFERENCES cable_type_default_materials(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cable_materials_cable_id_idx
      ON cable_materials (cable_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS cable_materials_cable_type_default_material_id_idx
      ON cable_materials (cable_type_default_material_id);
  `);

  await pool.query(`
    WITH default_materials_ranked AS (
      SELECT
        c.id AS cable_id,
        dm.id AS default_material_id,
        lower(trim(dm.name)) AS material_name_key,
        dm.quantity,
        coalesce(lower(trim(dm.unit)), '') AS unit_key,
        coalesce(lower(trim(dm.remarks)), '') AS remarks_key,
        ROW_NUMBER() OVER (
          PARTITION BY
            c.id,
            lower(trim(dm.name)),
            dm.quantity,
            coalesce(lower(trim(dm.unit)), ''),
            coalesce(lower(trim(dm.remarks)), '')
          ORDER BY dm.created_at ASC, dm.id ASC
        ) AS row_rank
      FROM cables c
      JOIN cable_type_default_materials dm ON dm.cable_type_id = c.cable_type_id
    ),
    cable_materials_ranked AS (
      SELECT
        cm.id AS cable_material_id,
        cm.cable_id,
        lower(trim(cm.name)) AS material_name_key,
        cm.quantity,
        coalesce(lower(trim(cm.unit)), '') AS unit_key,
        coalesce(lower(trim(cm.remarks)), '') AS remarks_key,
        ROW_NUMBER() OVER (
          PARTITION BY
            cm.cable_id,
            lower(trim(cm.name)),
            cm.quantity,
            coalesce(lower(trim(cm.unit)), ''),
            coalesce(lower(trim(cm.remarks)), '')
          ORDER BY cm.created_at ASC, cm.id ASC
        ) AS row_rank
      FROM cable_materials cm
      WHERE cm.source IS NULL
        AND cm.cable_type_default_material_id IS NULL
    ),
    matches AS (
      SELECT
        cmr.cable_material_id,
        dmr.default_material_id
      FROM cable_materials_ranked cmr
      JOIN default_materials_ranked dmr
        ON dmr.cable_id = cmr.cable_id
       AND dmr.material_name_key = cmr.material_name_key
       AND dmr.quantity IS NOT DISTINCT FROM cmr.quantity
       AND dmr.unit_key = cmr.unit_key
       AND dmr.remarks_key = cmr.remarks_key
       AND dmr.row_rank = cmr.row_rank
    )
    UPDATE cable_materials cm
    SET
      source = 'default',
      cable_type_default_material_id = matches.default_material_id
    FROM matches
    WHERE cm.id = matches.cable_material_id;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trays (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      tray_type TEXT,
      purpose TEXT,
      width_mm NUMERIC,
      height_mm NUMERIC,
      length_mm NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE trays
    ADD COLUMN IF NOT EXISTS include_grounding_cable BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE trays
    ADD COLUMN IF NOT EXISTS grounding_cable_type_id UUID;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'trays_grounding_cable_type_id_fkey'
          AND table_name = 'trays'
      ) THEN
        ALTER TABLE trays
          ADD CONSTRAINT trays_grounding_cable_type_id_fkey
          FOREIGN KEY (grounding_cable_type_id)
          REFERENCES cable_types(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS trays_project_name_idx
      ON trays (project_id, lower(name));
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS trays_project_id_idx
      ON trays (project_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_trays (
      id UUID PRIMARY KEY,
      tray_type TEXT NOT NULL UNIQUE,
      manufacturer TEXT,
      height_mm NUMERIC,
      rung_height_mm NUMERIC,
      width_mm NUMERIC,
      weight_kg_per_m NUMERIC,
      load_curve_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_trays_type_lower_idx
      ON material_trays (LOWER(tray_type));
  `);

  await pool.query(`
      ALTER TABLE material_trays
      ADD COLUMN IF NOT EXISTS rung_height_mm NUMERIC;
    `);

  await pool.query(`
      ALTER TABLE material_trays
      ADD COLUMN IF NOT EXISTS manufacturer TEXT;
    `);

  await pool.query(`
    ALTER TABLE material_trays
    ADD COLUMN IF NOT EXISTS load_curve_id UUID;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'material_trays_load_curve_id_fkey'
          AND table_name = 'material_trays'
      ) THEN
        ALTER TABLE material_trays
          ADD CONSTRAINT material_trays_load_curve_id_fkey
          FOREIGN KEY (load_curve_id)
          REFERENCES material_load_curves(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS material_trays_load_curve_id_idx
      ON material_trays (load_curve_id);
  `);

  await pool.query(`
    UPDATE material_trays mt
    SET load_curve_id = lc.id
    FROM material_load_curves lc
    WHERE lc.tray_id = mt.id
      AND mt.load_curve_id IS NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_supports (
      id UUID PRIMARY KEY,
      support_type TEXT NOT NULL UNIQUE,
      manufacturer TEXT,
      height_mm NUMERIC,
      width_mm NUMERIC,
      length_mm NUMERIC,
      weight_kg NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_supports_type_lower_idx
      ON material_supports (LOWER(support_type));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_load_curves (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      tray_id UUID REFERENCES material_trays(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_load_curves_name_lower_idx
      ON material_load_curves (LOWER(name));
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS material_load_curves_tray_id_idx
      ON material_load_curves (tray_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_load_curve_points (
      id UUID PRIMARY KEY,
      load_curve_id UUID NOT NULL REFERENCES material_load_curves(id) ON DELETE CASCADE,
      point_order INTEGER NOT NULL,
      span_m NUMERIC NOT NULL,
      load_kn_per_m NUMERIC NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_load_curve_points_curve_order_idx
      ON material_load_curve_points (load_curve_id, point_order);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS material_load_curve_points_curve_id_idx
      ON material_load_curve_points (load_curve_id);
  `);

  await pool.query(`
    ALTER TABLE project_support_distances
    ADD COLUMN IF NOT EXISTS support_id UUID REFERENCES material_supports(id) ON DELETE SET NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_files (
      id UUID PRIMARY KEY,
      object_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_type TEXT,
      size_bytes BIGINT,
      uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS template_files_uploaded_at_idx
      ON template_files (uploaded_at DESC);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS template_files_file_name_lower_idx
      ON template_files (LOWER(file_name));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS template_file_versions (
      id UUID PRIMARY KEY,
      template_id UUID NOT NULL REFERENCES template_files(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      object_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_type TEXT,
      size_bytes BIGINT,
      uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS template_file_versions_template_version_idx
      ON template_file_versions (template_id, version_number);
  `);

  await pool.query(`
    ALTER TABLE material_trays
    ADD COLUMN IF NOT EXISTS image_template_id UUID REFERENCES template_files(id) ON DELETE SET NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS material_trays_image_template_id_idx
      ON material_trays (image_template_id);
  `);

  await pool.query(`
    ALTER TABLE material_supports
    ADD COLUMN IF NOT EXISTS manufacturer TEXT;
  `);

  await pool.query(`
    ALTER TABLE material_supports
    ADD COLUMN IF NOT EXISTS image_template_id UUID REFERENCES template_files(id) ON DELETE SET NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS material_supports_image_template_id_idx
      ON material_supports (image_template_id);
  `);
}

export async function shutdownDatabase(): Promise<void> {
  await pool.end();
}
