import type { PoolClient } from 'pg';
import { CABLE_MTO_VALUES } from '../models/cable.js';

// Legacy schema creation/backfills: explicit empty-database migration only.
const cableMtoConstraintValues = CABLE_MTO_VALUES.map((value) => `'${value}'`).join(', ');
const cableVersionChangeTypeConstraintValues = ["'create'", "'update'"].join(', ');
const cableVersionChangeSourceConstraintValues = ["'manual'", "'import'"].join(', ');

export async function applyBaseline(client: Pick<PoolClient, 'query'>): Promise<void> {
  await client.query(`
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

  await client.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await client.query(`
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

  await client.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS manager TEXT;
  `);

  await client.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS secondary_tray_length NUMERIC;
  `);

  await client.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS support_distance NUMERIC;
  `);

  await client.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS support_weight NUMERIC;
  `);

  await client.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS tray_load_safety_factor NUMERIC;
  `);

  await client.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS cable_layout_settings JSONB;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS project_support_distances (
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      tray_type TEXT NOT NULL,
      support_distance NUMERIC NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project_id, tray_type)
    );
  `);

  await client.query(`
    ALTER TABLE project_support_distances
    ALTER COLUMN support_distance DROP NOT NULL;
  `);

  await client.query(`
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

  await client.query(`
    CREATE INDEX IF NOT EXISTS project_files_project_id_idx
      ON project_files (project_id);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS project_files_uploaded_at_idx
      ON project_files (uploaded_at DESC);
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS project_files_project_file_name_lower_idx
      ON project_files (project_id, LOWER(file_name));
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS project_tray_purpose_templates (
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      tray_purpose TEXT NOT NULL,
      project_file_id UUID NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project_id, tray_purpose)
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS project_tray_purpose_templates_file_idx
      ON project_tray_purpose_templates (project_file_id);
  `);

  await client.query(`
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

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS project_file_versions_file_version_idx
      ON project_file_versions (project_file_id, version_number);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS project_roxtec_entries (
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      id INTEGER NOT NULL,
      revision TEXT NOT NULL,
      tag TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project_id, id)
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS project_roxtec_entries_project_id_idx
      ON project_roxtec_entries (project_id);
  `);

  await client.query(`
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

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cable_types_project_name_idx
      ON cable_types (project_id, lower(name));
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS cable_types_project_id_idx
      ON cable_types (project_id);
  `);

  await client.query(`
    ALTER TABLE cable_types
    ADD COLUMN IF NOT EXISTS material TEXT;
  `);

  await client.query(`
    ALTER TABLE cable_types
    ADD COLUMN IF NOT EXISTS description TEXT;
  `);

  await client.query(`
    ALTER TABLE cable_types
    ADD COLUMN IF NOT EXISTS manufacturer TEXT;
  `);

  await client.query(`
    ALTER TABLE cable_types
    ADD COLUMN IF NOT EXISTS part_no TEXT;
  `);

  await client.query(`
    ALTER TABLE cable_types
    ADD COLUMN IF NOT EXISTS remarks TEXT;
  `);

  await client.query(`
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

  await client.query(`
    CREATE INDEX IF NOT EXISTS cable_type_default_materials_cable_type_id_idx
      ON cable_type_default_materials (cable_type_id);
  `);

  await client.query(`
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
      unit_price NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    ALTER TABLE material_cable_types
    ADD COLUMN IF NOT EXISTS material TEXT;
  `);

  await client.query(`
    ALTER TABLE material_cable_types
    ADD COLUMN IF NOT EXISTS description TEXT;
  `);

  await client.query(`
    ALTER TABLE material_cable_types
    ADD COLUMN IF NOT EXISTS manufacturer TEXT;
  `);

  await client.query(`
    ALTER TABLE material_cable_types
    ADD COLUMN IF NOT EXISTS part_no TEXT;
  `);

  await client.query(`
    ALTER TABLE material_cable_types
    ADD COLUMN IF NOT EXISTS remarks TEXT;
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_cable_types_name_lower_idx
      ON material_cable_types (LOWER(name));
  `);

  // Dependency must exist first on a fresh installation. This legacy backfill
  // is never executed when adopting an already-populated database.
  await client.query(`
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

  await client.query(`
    CREATE TABLE IF NOT EXISTS material_cable_installation_materials (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL,
      purpose TEXT,
      material TEXT,
      description TEXT,
      manufacturer TEXT,
      part_no TEXT,
      dimension_mm TEXT,
      weight_kg NUMERIC,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    ALTER TABLE material_cable_installation_materials
    ADD COLUMN IF NOT EXISTS purpose TEXT;
  `);

  await client.query(`
    ALTER TABLE material_cable_installation_materials
    ADD COLUMN IF NOT EXISTS material TEXT;
  `);

  await client.query(`
    ALTER TABLE material_cable_installation_materials
    ADD COLUMN IF NOT EXISTS description TEXT;
  `);

  await client.query(`
    ALTER TABLE material_cable_installation_materials
    ADD COLUMN IF NOT EXISTS manufacturer TEXT;
  `);

  await client.query(`
    ALTER TABLE material_cable_installation_materials
    ADD COLUMN IF NOT EXISTS part_no TEXT;
  `);

  await client.query(`
    ALTER TABLE material_cable_installation_materials
    ADD COLUMN IF NOT EXISTS dimension_mm TEXT;
  `);

  await client.query(`
    ALTER TABLE material_cable_installation_materials
    ADD COLUMN IF NOT EXISTS weight_kg NUMERIC;
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_cable_installation_materials_type_lower_idx
      ON material_cable_installation_materials (LOWER(type));
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS material_tray_installation_materials (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL,
      purpose TEXT,
      material TEXT,
      description TEXT,
      manufacturer TEXT,
      part_no TEXT,
      dimension_mm TEXT,
      weight_kg NUMERIC,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      minimum_order_quantity NUMERIC NOT NULL DEFAULT 1,
      order_measurement TEXT NOT NULL DEFAULT 'pcs',
      packaging TEXT NOT NULL DEFAULT 'pcs',
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT material_tray_installation_materials_minimum_order_quantity_check
        CHECK (minimum_order_quantity > 0 AND minimum_order_quantity < 'Infinity'::numeric),
      CONSTRAINT material_tray_installation_materials_order_measurement_check
        CHECK (order_measurement IN ('pcs', 'pack', 'meters')),
      CONSTRAINT material_tray_installation_materials_packaging_check
        CHECK (packaging IN ('m', 'Package', 'Box', 'Drum', 'pcs'))
    );
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_tray_installation_materials_type_lower_idx
      ON material_tray_installation_materials (LOWER(type));
  `);

  // These catalogs have the same fields as Tray Installation Materials, with
  // separate tables so identifiers and references remain scoped to each catalog.
  for (const table of ['material_instruments', 'material_instrument_installation_materials']) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id UUID PRIMARY KEY,
        type TEXT NOT NULL,
        purpose TEXT,
        material TEXT,
        description TEXT,
        manufacturer TEXT,
        part_no TEXT,
        dimension_mm TEXT,
        weight_kg NUMERIC,
        unit_price NUMERIC NOT NULL DEFAULT 0
          CHECK (unit_price >= 0 AND unit_price < 'Infinity'::numeric),
        minimum_order_quantity NUMERIC NOT NULL DEFAULT 1
          CHECK (minimum_order_quantity > 0 AND minimum_order_quantity < 'Infinity'::numeric),
        order_measurement TEXT NOT NULL DEFAULT 'pcs'
          CHECK (order_measurement IN ('pcs', 'pack', 'meters')),
        packaging TEXT NOT NULL DEFAULT 'pcs'
          CHECK (packaging IN ('m', 'Package', 'Box', 'Drum', 'pcs')),
        source TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ${table}_type_lower_idx ON ${table} (LOWER(type));
    `);
  }

  for (const definition of [
    {
      table: 'material_instrument_standard_materials',
      ownerTable: 'material_instruments',
      ownerColumn: 'instrument_id',
      indexPrefix: 'material_instrument_std',
      selfCheck: '',
    },
    {
      table: 'material_instrument_installation_standard_materials',
      ownerTable: 'material_instrument_installation_materials',
      ownerColumn: 'instrument_installation_material_id',
      indexPrefix: 'material_instrument_installation_std',
      selfCheck: 'CHECK (instrument_installation_material_id <> referenced_material_id),',
    },
  ]) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${definition.table} (
        id UUID PRIMARY KEY,
        ${definition.ownerColumn} UUID NOT NULL
          REFERENCES ${definition.ownerTable}(id) ON DELETE CASCADE,
        referenced_material_id UUID NOT NULL
          REFERENCES material_instrument_installation_materials(id) ON DELETE RESTRICT,
        quantity NUMERIC NOT NULL CHECK (quantity > 0 AND quantity < 'Infinity'::numeric),
        unit TEXT NOT NULL CHECK (unit IN ('pcs', 'meters', 'pcs/m')),
        remarks TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ${definition.selfCheck}
        UNIQUE (${definition.ownerColumn}, referenced_material_id)
      );
      CREATE INDEX IF NOT EXISTS ${definition.indexPrefix}_owner_idx
        ON ${definition.table} (${definition.ownerColumn});
      CREATE INDEX IF NOT EXISTS ${definition.indexPrefix}_reference_idx
        ON ${definition.table} (referenced_material_id);
    `);
  }

  await client.query(`
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
      delivery TEXT,
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

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cables_project_cable_id_idx
      ON cables (project_id, cable_id);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS cables_project_id_idx
      ON cables (project_id);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS cables_cable_type_id_idx
      ON cables (cable_type_id);
  `);

  await client.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS revision TEXT;
  `);

  await client.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS mto TEXT;
  `);

  await client.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS delivery TEXT;
  `);

  await client.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS design_length INTEGER;
  `);

  await client.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS install_length INTEGER;
  `);

  await client.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS materials_initialized BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await client.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS materials_customized BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await client.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS pull_date DATE;
  `);

  await client.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS connected_from DATE;
  `);

  await client.query(`
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

  await client.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS connected_to DATE;
  `);

  await client.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS tested DATE;
  `);

  await client.query(`
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
      delivery TEXT,
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

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cable_versions_cable_version_idx
      ON cable_versions (cable_id, version_number);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS cable_versions_cable_id_idx
      ON cable_versions (cable_id);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS cable_versions_changed_by_idx
      ON cable_versions (changed_by);
  `);

  await client.query(`
    ALTER TABLE cable_versions
    ADD COLUMN IF NOT EXISTS delivery TEXT;
  `);

  await client.query(`
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

  await client.query(`
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

  await client.query(`
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

  await client.query(`
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

  await client.query(`
    ALTER TABLE cable_materials
    ADD COLUMN IF NOT EXISTS source TEXT;
  `);

  await client.query(`
    ALTER TABLE cable_materials
    ADD COLUMN IF NOT EXISTS cable_type_default_material_id UUID;
  `);

  await client.query(`
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

  await client.query(`
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

  await client.query(`
    CREATE INDEX IF NOT EXISTS cable_materials_cable_id_idx
      ON cable_materials (cable_id);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS cable_materials_cable_type_default_material_id_idx
      ON cable_materials (cable_type_default_material_id);
  `);

  await client.query(`
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

  await client.query(`
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

  await client.query(`
    ALTER TABLE trays
    ADD COLUMN IF NOT EXISTS include_grounding_cable BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await client.query(`
    ALTER TABLE trays
    ADD COLUMN IF NOT EXISTS grounding_cable_type_id UUID;
  `);

  await client.query(`
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

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS trays_project_name_idx
      ON trays (project_id, lower(name));
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS trays_project_id_idx
      ON trays (project_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS material_trays (
      id UUID PRIMARY KEY,
      tray_type TEXT NOT NULL UNIQUE,
      manufacturer TEXT,
      height_mm NUMERIC,
      rung_height_mm NUMERIC,
      width_mm NUMERIC,
      weight_kg_per_m NUMERIC,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      load_curve_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_trays_type_lower_idx
      ON material_trays (LOWER(tray_type));
  `);

  await client.query(`
      ALTER TABLE material_trays
      ADD COLUMN IF NOT EXISTS rung_height_mm NUMERIC;
    `);

  await client.query(`
      ALTER TABLE material_trays
      ADD COLUMN IF NOT EXISTS manufacturer TEXT;
    `);

  await client.query(`
    ALTER TABLE material_trays
    ADD COLUMN IF NOT EXISTS load_curve_id UUID;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS material_load_curves (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      tray_id UUID REFERENCES material_trays(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
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

  await client.query(`
    CREATE INDEX IF NOT EXISTS material_trays_load_curve_id_idx
      ON material_trays (load_curve_id);
  `);

  await client.query(`
    UPDATE material_trays mt
    SET load_curve_id = lc.id
    FROM material_load_curves lc
    WHERE lc.tray_id = mt.id
      AND mt.load_curve_id IS NULL;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS material_supports (
      id UUID PRIMARY KEY,
      support_type TEXT NOT NULL UNIQUE,
      manufacturer TEXT,
      height_mm NUMERIC,
      width_mm NUMERIC,
      length_mm NUMERIC,
      weight_kg NUMERIC,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_supports_type_lower_idx
      ON material_supports (LOWER(support_type));
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_load_curves_name_lower_idx
      ON material_load_curves (LOWER(name));
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS material_load_curves_tray_id_idx
      ON material_load_curves (tray_id);
  `);

  await client.query(`
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

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_load_curve_points_curve_order_idx
      ON material_load_curve_points (load_curve_id, point_order);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS material_load_curve_points_curve_id_idx
      ON material_load_curve_points (load_curve_id);
  `);

  await client.query(`
    ALTER TABLE project_support_distances
    ADD COLUMN IF NOT EXISTS support_id UUID REFERENCES material_supports(id) ON DELETE SET NULL;
  `);

  await client.query(`
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

  await client.query(`
    CREATE INDEX IF NOT EXISTS template_files_uploaded_at_idx
      ON template_files (uploaded_at DESC);
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS template_files_file_name_lower_idx
      ON template_files (LOWER(file_name));
  `);

  await client.query(`
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

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS template_file_versions_template_version_idx
      ON template_file_versions (template_id, version_number);
  `);

  await client.query(`
    ALTER TABLE material_trays
    ADD COLUMN IF NOT EXISTS image_template_id UUID REFERENCES template_files(id) ON DELETE SET NULL;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS material_trays_image_template_id_idx
      ON material_trays (image_template_id);
  `);

  await client.query(`
    ALTER TABLE material_supports
    ADD COLUMN IF NOT EXISTS manufacturer TEXT;
  `);

  await client.query(`
    ALTER TABLE material_supports
    ADD COLUMN IF NOT EXISTS image_template_id UUID REFERENCES template_files(id) ON DELETE SET NULL;
  `);

  await client.query(`
    ALTER TABLE material_cable_types
      ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE material_cable_installation_materials
      ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE material_tray_installation_materials
      ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE material_trays
      ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE material_supports
      ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0;
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_cable_types'
          AND constraint_name = 'material_cable_types_unit_price_check'
      ) THEN
        ALTER TABLE material_cable_types
          ADD CONSTRAINT material_cable_types_unit_price_check
          CHECK (unit_price >= 0 AND unit_price < 'Infinity'::numeric);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_cable_installation_materials'
          AND constraint_name = 'material_cable_installation_materials_unit_price_check'
      ) THEN
        ALTER TABLE material_cable_installation_materials
          ADD CONSTRAINT material_cable_installation_materials_unit_price_check
          CHECK (unit_price >= 0 AND unit_price < 'Infinity'::numeric);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_tray_installation_materials'
          AND constraint_name = 'material_tray_installation_materials_unit_price_check'
      ) THEN
        ALTER TABLE material_tray_installation_materials
          ADD CONSTRAINT material_tray_installation_materials_unit_price_check
          CHECK (unit_price >= 0 AND unit_price < 'Infinity'::numeric);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_trays'
          AND constraint_name = 'material_trays_unit_price_check'
      ) THEN
        ALTER TABLE material_trays
          ADD CONSTRAINT material_trays_unit_price_check
          CHECK (unit_price >= 0 AND unit_price < 'Infinity'::numeric);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_supports'
          AND constraint_name = 'material_supports_unit_price_check'
      ) THEN
        ALTER TABLE material_supports
          ADD CONSTRAINT material_supports_unit_price_check
          CHECK (unit_price >= 0 AND unit_price < 'Infinity'::numeric);
      END IF;
    END $$;
  `);

  await client.query(`
    ALTER TABLE material_cable_types
      ADD COLUMN IF NOT EXISTS minimum_order_quantity NUMERIC NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS order_measurement TEXT NOT NULL DEFAULT 'meters',
      ADD COLUMN IF NOT EXISTS packaging TEXT NOT NULL DEFAULT 'm',
      ADD COLUMN IF NOT EXISTS source TEXT;
    ALTER TABLE material_cable_installation_materials
      ADD COLUMN IF NOT EXISTS minimum_order_quantity NUMERIC NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS order_measurement TEXT NOT NULL DEFAULT 'pcs',
      ADD COLUMN IF NOT EXISTS packaging TEXT NOT NULL DEFAULT 'pcs',
      ADD COLUMN IF NOT EXISTS source TEXT;
    ALTER TABLE material_trays
      ADD COLUMN IF NOT EXISTS minimum_order_quantity NUMERIC NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS order_measurement TEXT NOT NULL DEFAULT 'pcs',
      ADD COLUMN IF NOT EXISTS packaging TEXT NOT NULL DEFAULT 'pcs',
      ADD COLUMN IF NOT EXISTS source TEXT;
    ALTER TABLE material_supports
      ADD COLUMN IF NOT EXISTS minimum_order_quantity NUMERIC NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS order_measurement TEXT NOT NULL DEFAULT 'pcs',
      ADD COLUMN IF NOT EXISTS packaging TEXT NOT NULL DEFAULT 'pcs',
      ADD COLUMN IF NOT EXISTS source TEXT;
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_cable_types'
          AND constraint_name = 'material_cable_types_minimum_order_quantity_check'
      ) THEN
        ALTER TABLE material_cable_types
          ADD CONSTRAINT material_cable_types_minimum_order_quantity_check
          CHECK (minimum_order_quantity > 0 AND minimum_order_quantity < 'Infinity'::numeric);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_cable_types'
          AND constraint_name = 'material_cable_types_order_measurement_check'
      ) THEN
        ALTER TABLE material_cable_types
          ADD CONSTRAINT material_cable_types_order_measurement_check
          CHECK (order_measurement IN ('pcs', 'pack', 'meters'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_cable_types'
          AND constraint_name = 'material_cable_types_packaging_check'
      ) THEN
        ALTER TABLE material_cable_types
          ADD CONSTRAINT material_cable_types_packaging_check
          CHECK (packaging IN ('m', 'Package', 'Box', 'Drum', 'pcs'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_cable_installation_materials'
          AND constraint_name = 'material_cable_installation_materials_minimum_order_quantity_check'
      ) THEN
        ALTER TABLE material_cable_installation_materials
          ADD CONSTRAINT material_cable_installation_materials_minimum_order_quantity_check
          CHECK (minimum_order_quantity > 0 AND minimum_order_quantity < 'Infinity'::numeric);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_cable_installation_materials'
          AND constraint_name = 'material_cable_installation_materials_order_measurement_check'
      ) THEN
        ALTER TABLE material_cable_installation_materials
          ADD CONSTRAINT material_cable_installation_materials_order_measurement_check
          CHECK (order_measurement IN ('pcs', 'pack', 'meters'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_cable_installation_materials'
          AND constraint_name = 'material_cable_installation_materials_packaging_check'
      ) THEN
        ALTER TABLE material_cable_installation_materials
          ADD CONSTRAINT material_cable_installation_materials_packaging_check
          CHECK (packaging IN ('m', 'Package', 'Box', 'Drum', 'pcs'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_trays'
          AND constraint_name = 'material_trays_minimum_order_quantity_check'
      ) THEN
        ALTER TABLE material_trays
          ADD CONSTRAINT material_trays_minimum_order_quantity_check
          CHECK (minimum_order_quantity > 0 AND minimum_order_quantity < 'Infinity'::numeric);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_trays'
          AND constraint_name = 'material_trays_order_measurement_check'
      ) THEN
        ALTER TABLE material_trays
          ADD CONSTRAINT material_trays_order_measurement_check
          CHECK (order_measurement IN ('pcs', 'pack', 'meters'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_trays'
          AND constraint_name = 'material_trays_packaging_check'
      ) THEN
        ALTER TABLE material_trays
          ADD CONSTRAINT material_trays_packaging_check
          CHECK (packaging IN ('m', 'Package', 'Box', 'Drum', 'pcs'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_supports'
          AND constraint_name = 'material_supports_minimum_order_quantity_check'
      ) THEN
        ALTER TABLE material_supports
          ADD CONSTRAINT material_supports_minimum_order_quantity_check
          CHECK (minimum_order_quantity > 0 AND minimum_order_quantity < 'Infinity'::numeric);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_supports'
          AND constraint_name = 'material_supports_order_measurement_check'
      ) THEN
        ALTER TABLE material_supports
          ADD CONSTRAINT material_supports_order_measurement_check
          CHECK (order_measurement IN ('pcs', 'pack', 'meters'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'material_supports'
          AND constraint_name = 'material_supports_packaging_check'
      ) THEN
        ALTER TABLE material_supports
          ADD CONSTRAINT material_supports_packaging_check
          CHECK (packaging IN ('m', 'Package', 'Box', 'Drum', 'pcs'));
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS material_supports_image_template_id_idx
      ON material_supports (image_template_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS material_cable_type_standard_materials (
      id UUID PRIMARY KEY,
      cable_type_id UUID NOT NULL
        REFERENCES material_cable_types(id) ON DELETE CASCADE,
      referenced_material_id UUID NOT NULL
        REFERENCES material_cable_installation_materials(id) ON DELETE RESTRICT,
      quantity NUMERIC NOT NULL,
      unit TEXT NOT NULL,
      remarks TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT material_cable_type_standard_materials_quantity_check
        CHECK (quantity > 0 AND quantity < 'Infinity'::numeric),
      CONSTRAINT material_cable_type_standard_materials_unit_check
        CHECK (unit IN ('pcs', 'meters', 'pcs/m')),
      CONSTRAINT material_cable_type_standard_materials_owner_child_unique
        UNIQUE (cable_type_id, referenced_material_id)
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS material_cable_type_standard_materials_owner_idx
      ON material_cable_type_standard_materials (cable_type_id);
    CREATE INDEX IF NOT EXISTS material_cable_type_standard_materials_reference_idx
      ON material_cable_type_standard_materials (referenced_material_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS material_cable_installation_standard_materials (
      id UUID PRIMARY KEY,
      cable_installation_material_id UUID NOT NULL
        REFERENCES material_cable_installation_materials(id) ON DELETE CASCADE,
      referenced_material_id UUID NOT NULL
        REFERENCES material_cable_installation_materials(id) ON DELETE RESTRICT,
      quantity NUMERIC NOT NULL,
      unit TEXT NOT NULL,
      remarks TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT material_cable_installation_standard_materials_quantity_check
        CHECK (quantity > 0 AND quantity < 'Infinity'::numeric),
      CONSTRAINT material_cable_installation_standard_materials_unit_check
        CHECK (unit IN ('pcs', 'meters', 'pcs/m')),
      CONSTRAINT material_cable_installation_standard_materials_self_check
        CHECK (cable_installation_material_id <> referenced_material_id),
      CONSTRAINT material_cable_installation_standard_materials_owner_child_unique
        UNIQUE (cable_installation_material_id, referenced_material_id)
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS material_cable_installation_standard_materials_owner_idx
      ON material_cable_installation_standard_materials (cable_installation_material_id);
    CREATE INDEX IF NOT EXISTS material_cable_installation_standard_materials_reference_idx
      ON material_cable_installation_standard_materials (referenced_material_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS material_tray_installation_standard_materials (
      id UUID PRIMARY KEY,
      tray_installation_material_id UUID NOT NULL
        REFERENCES material_tray_installation_materials(id) ON DELETE CASCADE,
      referenced_material_id UUID NOT NULL
        CONSTRAINT material_tray_installation_standard_materials_reference_fkey
        REFERENCES material_tray_installation_materials(id) ON DELETE RESTRICT,
      quantity NUMERIC NOT NULL,
      unit TEXT NOT NULL,
      remarks TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT material_tray_installation_standard_materials_quantity_check
        CHECK (quantity > 0 AND quantity < 'Infinity'::numeric),
      CONSTRAINT material_tray_installation_standard_materials_unit_check
        CHECK (unit IN ('pcs', 'meters', 'pcs/m')),
      CONSTRAINT material_tray_installation_standard_materials_self_check
        CHECK (tray_installation_material_id <> referenced_material_id),
      CONSTRAINT material_tray_installation_standard_materials_owner_child_unique
        UNIQUE (tray_installation_material_id, referenced_material_id)
    );
  `);

  // Early builds pointed Tray Installation Material compositions at the Cable
  // Installation Material catalog. Preserve those assignments by resolving the
  // old child by normalized type, or by copying it into the tray catalog when
  // there is no equivalent row, before replacing and validating the FK.
  await client.query(`
    DO $$
    DECLARE
      referenced_attnum SMALLINT;
      had_cable_reference_fk BOOLEAN;
      has_correct_reference_fk BOOLEAN;
      has_self_references BOOLEAN;
      migration_required BOOLEAN;
      legacy_assignment RECORD;
      source_material RECORD;
      constraint_to_drop RECORD;
      target_material_id UUID;
      cloned_material_id UUID;
      cloned_type TEXT;
      clone_attempt INTEGER;
    BEGIN
      SELECT attnum
      INTO referenced_attnum
      FROM pg_attribute
      WHERE attrelid = 'material_tray_installation_standard_materials'::regclass
        AND attname = 'referenced_material_id'
        AND NOT attisdropped;

      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'material_tray_installation_standard_materials'::regclass
          AND contype = 'f'
          AND confrelid = 'material_cable_installation_materials'::regclass
          AND conkey = ARRAY[referenced_attnum]::SMALLINT[]
      )
      INTO had_cable_reference_fk;

      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'material_tray_installation_standard_materials'::regclass
          AND contype = 'f'
          AND confrelid = 'material_tray_installation_materials'::regclass
          AND confdeltype = 'r'
          AND conkey = ARRAY[referenced_attnum]::SMALLINT[]
          AND convalidated
      )
      INTO has_correct_reference_fk;

      SELECT EXISTS (
        SELECT 1
        FROM material_tray_installation_standard_materials
        WHERE tray_installation_material_id = referenced_material_id
      )
      INTO has_self_references;

      migration_required :=
        had_cable_reference_fk OR
        NOT has_correct_reference_fk OR
        has_self_references OR
        EXISTS (
          SELECT 1
          FROM material_tray_installation_standard_materials assignment
          LEFT JOIN material_tray_installation_materials referenced
            ON referenced.id = assignment.referenced_material_id
          WHERE referenced.id IS NULL
        );

      IF migration_required THEN
        FOR constraint_to_drop IN
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'material_tray_installation_standard_materials'::regclass
            AND contype = 'f'
            AND conkey = ARRAY[referenced_attnum]::SMALLINT[]
        LOOP
          EXECUTE format(
            'ALTER TABLE material_tray_installation_standard_materials DROP CONSTRAINT %I',
            constraint_to_drop.conname
          );
        END LOOP;

        FOR legacy_assignment IN
          SELECT
            assignment.id,
            assignment.tray_installation_material_id,
            assignment.referenced_material_id
          FROM material_tray_installation_standard_materials assignment
          WHERE had_cable_reference_fk
             OR assignment.tray_installation_material_id = assignment.referenced_material_id
             OR NOT EXISTS (
               SELECT 1
               FROM material_tray_installation_materials referenced
               WHERE referenced.id = assignment.referenced_material_id
             )
          ORDER BY assignment.id
        LOOP
          SELECT candidate.*
          INTO source_material
          FROM (
            SELECT
              0 AS catalog_priority,
              cable.id,
              cable.type,
              cable.purpose,
              cable.material,
              cable.description,
              cable.manufacturer,
              cable.part_no,
              cable.dimension_mm,
              cable.weight_kg,
              cable.minimum_order_quantity,
              cable.order_measurement,
              cable.packaging,
              cable.source,
              cable.created_at,
              cable.updated_at
            FROM material_cable_installation_materials cable
            WHERE cable.id = legacy_assignment.referenced_material_id
            UNION ALL
            SELECT
              1 AS catalog_priority,
              tray.id,
              tray.type,
              tray.purpose,
              tray.material,
              tray.description,
              tray.manufacturer,
              tray.part_no,
              tray.dimension_mm,
              tray.weight_kg,
              tray.minimum_order_quantity,
              tray.order_measurement,
              tray.packaging,
              tray.source,
              tray.created_at,
              tray.updated_at
            FROM material_tray_installation_materials tray
            WHERE tray.id = legacy_assignment.referenced_material_id
          ) candidate
          ORDER BY CASE
            WHEN had_cable_reference_fk THEN candidate.catalog_priority
            ELSE -candidate.catalog_priority
          END
          LIMIT 1;

          IF source_material.id IS NULL THEN
            RAISE EXCEPTION
              'Cannot migrate Tray Installation Standard Material assignment %: referenced material % is missing from both installation catalogs',
              legacy_assignment.id,
              legacy_assignment.referenced_material_id;
          END IF;

          SELECT candidate.id
          INTO target_material_id
          FROM material_tray_installation_materials candidate
          WHERE LOWER(BTRIM(candidate.type)) = LOWER(BTRIM(source_material.type))
            AND candidate.id <> legacy_assignment.tray_installation_material_id
            -- Reusing a composed target could turn legacy cross-catalog links
            -- into a recursive tray cycle. Non-leaf targets are cloned instead.
            AND NOT EXISTS (
              SELECT 1
              FROM material_tray_installation_standard_materials outgoing
              WHERE outgoing.tray_installation_material_id = candidate.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM material_tray_installation_standard_materials duplicate
              WHERE duplicate.tray_installation_material_id =
                    legacy_assignment.tray_installation_material_id
                AND duplicate.referenced_material_id = candidate.id
                AND duplicate.id <> legacy_assignment.id
            )
          ORDER BY
            CASE
              WHEN candidate.id = legacy_assignment.referenced_material_id THEN 0
              ELSE 1
            END,
            candidate.created_at,
            candidate.id
          LIMIT 1;

          IF target_material_id IS NULL THEN
            cloned_material_id := source_material.id;

            IF cloned_material_id = legacy_assignment.tray_installation_material_id
               OR EXISTS (
                 SELECT 1
                 FROM material_tray_installation_materials existing
                 WHERE existing.id = cloned_material_id
               ) THEN
              clone_attempt := 0;
              LOOP
                cloned_material_id := MD5(
                  'wfc:tray-installation-standard-material:' ||
                  legacy_assignment.id::TEXT || ':' || clone_attempt::TEXT
                )::UUID;
                EXIT WHEN cloned_material_id <>
                              legacy_assignment.tray_installation_material_id
                  AND NOT EXISTS (
                    SELECT 1
                    FROM material_tray_installation_materials existing
                    WHERE existing.id = cloned_material_id
                  );
                clone_attempt := clone_attempt + 1;
              END LOOP;
            END IF;

            cloned_type := source_material.type;
            IF EXISTS (
              SELECT 1
              FROM material_tray_installation_materials existing
              WHERE LOWER(BTRIM(existing.type)) = LOWER(BTRIM(cloned_type))
            ) THEN
              clone_attempt := 0;
              LOOP
                cloned_type := RTRIM(source_material.type) ||
                  ' [legacy ' || legacy_assignment.id::TEXT ||
                  CASE
                    WHEN clone_attempt = 0 THEN ''
                    ELSE '-' || clone_attempt::TEXT
                  END || ']';
                EXIT WHEN NOT EXISTS (
                  SELECT 1
                  FROM material_tray_installation_materials existing
                  WHERE LOWER(BTRIM(existing.type)) = LOWER(BTRIM(cloned_type))
                );
                clone_attempt := clone_attempt + 1;
              END LOOP;
            END IF;

            INSERT INTO material_tray_installation_materials (
              id,
              type,
              purpose,
              material,
              description,
              manufacturer,
              part_no,
              dimension_mm,
              weight_kg,
              minimum_order_quantity,
              order_measurement,
              packaging,
              source,
              created_at,
              updated_at
            ) VALUES (
              cloned_material_id,
              cloned_type,
              source_material.purpose,
              source_material.material,
              source_material.description,
              source_material.manufacturer,
              source_material.part_no,
              source_material.dimension_mm,
              source_material.weight_kg,
              source_material.minimum_order_quantity,
              source_material.order_measurement,
              source_material.packaging,
              source_material.source,
              source_material.created_at,
              source_material.updated_at
            );

            target_material_id := cloned_material_id;
          END IF;

          UPDATE material_tray_installation_standard_materials
          SET referenced_material_id = target_material_id,
              updated_at = NOW()
          WHERE id = legacy_assignment.id;
        END LOOP;

        IF EXISTS (
          SELECT 1
          FROM material_tray_installation_standard_materials assignment
          LEFT JOIN material_tray_installation_materials referenced
            ON referenced.id = assignment.referenced_material_id
          WHERE referenced.id IS NULL
             OR assignment.tray_installation_material_id = assignment.referenced_material_id
        ) THEN
          RAISE EXCEPTION
            'Tray Installation Standard Material migration left invalid references';
        END IF;

        ALTER TABLE material_tray_installation_standard_materials
          DROP CONSTRAINT IF EXISTS
            material_tray_installation_standard_materials_reference_fkey;
        ALTER TABLE material_tray_installation_standard_materials
          ADD CONSTRAINT material_tray_installation_standard_materials_reference_fkey
          FOREIGN KEY (referenced_material_id)
          REFERENCES material_tray_installation_materials(id)
          ON DELETE RESTRICT
          NOT VALID;
        ALTER TABLE material_tray_installation_standard_materials
          VALIDATE CONSTRAINT
            material_tray_installation_standard_materials_reference_fkey;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'material_tray_installation_standard_materials'::regclass
          AND conname = 'material_tray_installation_standard_materials_self_check'
          AND contype = 'c'
          AND POSITION(
            'tray_installation_material_id <> referenced_material_id'
            IN pg_get_constraintdef(oid)
          ) > 0
      ) THEN
        ALTER TABLE material_tray_installation_standard_materials
          DROP CONSTRAINT IF EXISTS
            material_tray_installation_standard_materials_self_check;
        ALTER TABLE material_tray_installation_standard_materials
          ADD CONSTRAINT material_tray_installation_standard_materials_self_check
          CHECK (tray_installation_material_id <> referenced_material_id)
          NOT VALID;
      END IF;

      ALTER TABLE material_tray_installation_standard_materials
        VALIDATE CONSTRAINT
          material_tray_installation_standard_materials_self_check;
    END $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS material_tray_installation_standard_materials_owner_idx
      ON material_tray_installation_standard_materials (tray_installation_material_id);
    CREATE INDEX IF NOT EXISTS material_tray_installation_standard_materials_reference_idx
      ON material_tray_installation_standard_materials (referenced_material_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS material_tray_standard_materials (
      id UUID PRIMARY KEY,
      tray_id UUID NOT NULL REFERENCES material_trays(id) ON DELETE CASCADE,
      referenced_material_id UUID NOT NULL
        REFERENCES material_cable_installation_materials(id) ON DELETE RESTRICT,
      quantity NUMERIC NOT NULL,
      unit TEXT NOT NULL,
      remarks TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT material_tray_standard_materials_quantity_check
        CHECK (quantity > 0 AND quantity < 'Infinity'::numeric),
      CONSTRAINT material_tray_standard_materials_unit_check
        CHECK (unit IN ('pcs', 'meters', 'pcs/m')),
      CONSTRAINT material_tray_standard_materials_owner_child_unique
        UNIQUE (tray_id, referenced_material_id)
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS material_tray_standard_materials_owner_idx
      ON material_tray_standard_materials (tray_id);
    CREATE INDEX IF NOT EXISTS material_tray_standard_materials_reference_idx
      ON material_tray_standard_materials (referenced_material_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS material_support_standard_materials (
      id UUID PRIMARY KEY,
      support_id UUID NOT NULL REFERENCES material_supports(id) ON DELETE CASCADE,
      referenced_material_id UUID NOT NULL
        REFERENCES material_cable_installation_materials(id) ON DELETE RESTRICT,
      quantity NUMERIC NOT NULL,
      unit TEXT NOT NULL,
      remarks TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT material_support_standard_materials_quantity_check
        CHECK (quantity > 0 AND quantity < 'Infinity'::numeric),
      CONSTRAINT material_support_standard_materials_unit_check
        CHECK (unit IN ('pcs', 'meters', 'pcs/m')),
      CONSTRAINT material_support_standard_materials_owner_child_unique
        UNIQUE (support_id, referenced_material_id)
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS material_support_standard_materials_owner_idx
      ON material_support_standard_materials (support_id);
    CREATE INDEX IF NOT EXISTS material_support_standard_materials_reference_idx
      ON material_support_standard_materials (referenced_material_id);
  `);

  await client.query(`
    ALTER TABLE cable_types
      ADD COLUMN IF NOT EXISTS source_material_cable_type_id UUID;
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'cable_types_source_material_cable_type_id_fkey'
          AND table_name = 'cable_types'
      ) THEN
        ALTER TABLE cable_types
          ADD CONSTRAINT cable_types_source_material_cable_type_id_fkey
          FOREIGN KEY (source_material_cable_type_id)
          REFERENCES material_cable_types(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS cable_types_source_material_cable_type_id_idx
      ON cable_types (source_material_cable_type_id);
  `);

  await client.query(`
    ALTER TABLE cable_type_default_materials
      ADD COLUMN IF NOT EXISTS source_kind TEXT;
    ALTER TABLE cable_type_default_materials
      ADD COLUMN IF NOT EXISTS source_master_material_id UUID;
    ALTER TABLE cable_type_default_materials
      ADD COLUMN IF NOT EXISTS source_standard_material_assignment_ids UUID[];
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'cable_type_default_materials_source_kind_check'
          AND table_name = 'cable_type_default_materials'
      ) THEN
        ALTER TABLE cable_type_default_materials
          ADD CONSTRAINT cable_type_default_materials_source_kind_check
          CHECK (source_kind IS NULL OR source_kind IN ('manual', 'standard-material'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'cable_type_default_materials_source_master_material_id_fkey'
          AND table_name = 'cable_type_default_materials'
      ) THEN
        ALTER TABLE cable_type_default_materials
          ADD CONSTRAINT cable_type_default_materials_source_master_material_id_fkey
          FOREIGN KEY (source_master_material_id)
          REFERENCES material_cable_installation_materials(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS cable_type_default_materials_source_master_material_id_idx
      ON cable_type_default_materials (source_master_material_id);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS project_change_orders (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL DEFAULT 'change-order',
      title TEXT NOT NULL,
      project_reference TEXT,
      prepared_by TEXT NOT NULL,
      report_date DATE NOT NULL,
      revision TEXT NOT NULL DEFAULT '00',
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT project_change_orders_document_type_check
        CHECK (document_type IN ('change-order', 'internal-ncr')),
      CONSTRAINT project_change_orders_title_not_empty CHECK (btrim(title) <> ''),
      CONSTRAINT project_change_orders_prepared_by_not_empty CHECK (btrim(prepared_by) <> ''),
      CONSTRAINT project_change_orders_revision_not_empty CHECK (btrim(revision) <> '')
    );
  `);

  await client.query(`
    ALTER TABLE project_change_orders
      ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'change-order';
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'project_change_orders_document_type_check'
          AND table_name = 'project_change_orders'
      ) THEN
        ALTER TABLE project_change_orders
          ADD CONSTRAINT project_change_orders_document_type_check
          CHECK (document_type IN ('change-order', 'internal-ncr'));
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS project_change_orders_project_id_idx
      ON project_change_orders (project_id);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS project_change_orders_project_type_idx
      ON project_change_orders (project_id, document_type);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS project_change_order_items (
      id UUID PRIMARY KEY,
      change_order_id UUID NOT NULL REFERENCES project_change_orders(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      source_catalog TEXT NOT NULL,
      source_material_id UUID NOT NULL,
      design_quantity NUMERIC NOT NULL DEFAULT 0,
      order_quantity NUMERIC NOT NULL DEFAULT 0,
      unit TEXT,
      packaging TEXT,
      packaging_quantity NUMERIC,
      packaging_unit TEXT,
      ordered_quantity NUMERIC,
      ordered_unit TEXT,
      sap_number TEXT,
      description_en TEXT NOT NULL,
      description_de TEXT,
      dimension_mm TEXT,
      material TEXT,
      weight_kg NUMERIC,
      clear_description TEXT,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      country_of_origin TEXT,
      hs_code TEXT,
      tag_no TEXT,
      drawing_no TEXT,
      shipping_list TEXT,
      revision_number TEXT,
      client_barcode TEXT,
      manufacturer TEXT,
      manufacturer_part_no TEXT,
      acs_barcode TEXT,
      remarks TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT project_change_order_items_sort_order_positive CHECK (sort_order > 0),
      CONSTRAINT project_change_order_items_source_catalog_check
        CHECK (source_catalog IN (
          'cable-type',
          'cable-installation-material',
          'tray-installation-material',
          'instrument',
          'instrument-installation-material',
          'tray',
          'support'
        )),
      CONSTRAINT project_change_order_items_description_not_empty CHECK (btrim(description_en) <> ''),
      CONSTRAINT project_change_order_items_design_quantity_check
        CHECK (design_quantity >= 0 AND design_quantity < 'Infinity'::numeric),
      CONSTRAINT project_change_order_items_order_quantity_check
        CHECK (order_quantity >= 0 AND order_quantity < 'Infinity'::numeric),
      CONSTRAINT project_change_order_items_packaging_quantity_check
        CHECK (
          packaging_quantity IS NULL OR
          (packaging_quantity >= 0 AND packaging_quantity < 'Infinity'::numeric)
        ),
      CONSTRAINT project_change_order_items_ordered_quantity_check
        CHECK (
          ordered_quantity IS NULL OR
          (ordered_quantity >= 0 AND ordered_quantity < 'Infinity'::numeric)
        ),
      CONSTRAINT project_change_order_items_weight_check
        CHECK (weight_kg IS NULL OR (weight_kg >= 0 AND weight_kg < 'Infinity'::numeric)),
      CONSTRAINT project_change_order_items_unit_price_check
        CHECK (unit_price >= 0 AND unit_price < 'Infinity'::numeric)
    );
  `);

  // CREATE TABLE IF NOT EXISTS does not update the constraint in existing
  // databases, so widen it explicitly when the new catalog is introduced.
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'project_change_order_items_source_catalog_check'
          AND conrelid = 'project_change_order_items'::regclass
          AND pg_get_constraintdef(oid) LIKE '%tray-installation-material%'
          AND pg_get_constraintdef(oid) LIKE '%''instrument''%'
          AND pg_get_constraintdef(oid) LIKE '%instrument-installation-material%'
      ) THEN
        ALTER TABLE project_change_order_items
          DROP CONSTRAINT IF EXISTS project_change_order_items_source_catalog_check;
        ALTER TABLE project_change_order_items
          ADD CONSTRAINT project_change_order_items_source_catalog_check
          CHECK (source_catalog IN (
            'cable-type',
            'cable-installation-material',
            'tray-installation-material',
            'instrument',
            'instrument-installation-material',
            'tray',
            'support'
          ));
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS project_change_order_items_change_order_id_idx
      ON project_change_order_items (change_order_id);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS project_change_order_items_change_order_sort_idx
      ON project_change_order_items (change_order_id, sort_order);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS project_change_order_items_source_idx
      ON project_change_order_items (source_catalog, source_material_id);
  `);

  await client.query(`
    ALTER TABLE project_change_order_items
      ADD COLUMN IF NOT EXISTS line_kind TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE project_change_order_items
      ADD COLUMN IF NOT EXISTS parent_item_id UUID;
    ALTER TABLE project_change_order_items
      ADD COLUMN IF NOT EXISTS quantity_per_parent NUMERIC;
    ALTER TABLE project_change_order_items
      ADD COLUMN IF NOT EXISTS source_standard_material_assignment_ids UUID[];
    ALTER TABLE project_change_order_items
      ADD COLUMN IF NOT EXISTS minimum_order_quantity NUMERIC;
    ALTER TABLE project_change_order_items
      ADD COLUMN IF NOT EXISTS order_measurement TEXT;
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'project_change_order_items_line_kind_check'
          AND table_name = 'project_change_order_items'
      ) THEN
        ALTER TABLE project_change_order_items
          ADD CONSTRAINT project_change_order_items_line_kind_check
          CHECK (line_kind IN ('manual', 'inherited'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'project_change_order_items_parent_item_id_fkey'
          AND table_name = 'project_change_order_items'
      ) THEN
        ALTER TABLE project_change_order_items
          ADD CONSTRAINT project_change_order_items_parent_item_id_fkey
          FOREIGN KEY (parent_item_id)
          REFERENCES project_change_order_items(id)
          ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'project_change_order_items_quantity_per_parent_check'
          AND table_name = 'project_change_order_items'
      ) THEN
        ALTER TABLE project_change_order_items
          ADD CONSTRAINT project_change_order_items_quantity_per_parent_check
          CHECK (
            quantity_per_parent IS NULL OR
            (quantity_per_parent > 0 AND quantity_per_parent < 'Infinity'::numeric)
          );
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'project_change_order_items_minimum_order_quantity_check'
          AND table_name = 'project_change_order_items'
      ) THEN
        ALTER TABLE project_change_order_items
          ADD CONSTRAINT project_change_order_items_minimum_order_quantity_check
          CHECK (
            minimum_order_quantity IS NULL OR
            (minimum_order_quantity > 0 AND minimum_order_quantity < 'Infinity'::numeric)
          );
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'project_change_order_items_order_measurement_check'
          AND table_name = 'project_change_order_items'
      ) THEN
        ALTER TABLE project_change_order_items
          ADD CONSTRAINT project_change_order_items_order_measurement_check
          CHECK (
            order_measurement IS NULL OR
            order_measurement IN ('pcs', 'pack', 'meters')
          );
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS project_change_order_items_parent_item_id_idx
      ON project_change_order_items (parent_item_id);
  `);

  // Inherited Change Order materials always use their parent item's revision.
  await client.query(`
    UPDATE project_change_order_items child
    SET revision_number = parent.revision_number
    FROM project_change_order_items parent
    WHERE child.parent_item_id = parent.id
      AND child.line_kind = 'inherited'
      AND child.revision_number IS DISTINCT FROM parent.revision_number;
  `);

  // Existing Change Order rows stay linked to their catalog entries for
  // commercial ordering metadata. Inherited rows keep their Standard Material
  // consumption unit (pcs or pcs/m). Manual rows use the catalog measurement
  // unless their unit was explicitly customized in the Change Order.
  await client.query(`
    WITH source AS (
      SELECT
        'cable-type'::text AS source_catalog,
        id,
        minimum_order_quantity,
        order_measurement,
        packaging
      FROM material_cable_types
      UNION ALL
      SELECT
        'cable-installation-material'::text,
        id,
        minimum_order_quantity,
        order_measurement,
        packaging
      FROM material_cable_installation_materials
      UNION ALL
      SELECT
        'tray-installation-material'::text,
        id,
        minimum_order_quantity,
        order_measurement,
        packaging
      FROM material_tray_installation_materials
      UNION ALL
      SELECT
        'instrument'::text,
        id,
        minimum_order_quantity,
        order_measurement,
        packaging
      FROM material_instruments
      UNION ALL
      SELECT
        'instrument-installation-material'::text,
        id,
        minimum_order_quantity,
        order_measurement,
        packaging
      FROM material_instrument_installation_materials
      UNION ALL
      SELECT
        'tray'::text,
        id,
        minimum_order_quantity,
        order_measurement,
        packaging
      FROM material_trays
      UNION ALL
      SELECT
        'support'::text,
        id,
        minimum_order_quantity,
        order_measurement,
        packaging
      FROM material_supports
    )
    UPDATE project_change_order_items item
    SET
      unit = CASE
        WHEN item.line_kind = 'manual'
          AND (
            item.order_measurement IS NULL OR
            item.unit IS NOT DISTINCT FROM item.order_measurement
          )
        THEN source.order_measurement
        ELSE item.unit
      END,
      minimum_order_quantity = source.minimum_order_quantity,
      order_measurement = source.order_measurement,
      packaging = source.packaging,
      packaging_quantity = source.minimum_order_quantity,
      packaging_unit = source.order_measurement,
      ordered_quantity = CASE
        WHEN item.order_quantity > 0
        THEN CEIL(item.order_quantity / source.minimum_order_quantity)
        ELSE 0
      END,
      ordered_unit = source.packaging,
      updated_at = NOW()
    FROM source
    WHERE item.source_catalog = source.source_catalog
      AND item.source_material_id = source.id
      AND (
        (
          item.line_kind = 'manual' AND
          (
            item.order_measurement IS NULL OR
            item.unit IS NOT DISTINCT FROM item.order_measurement
          ) AND
          item.unit IS DISTINCT FROM source.order_measurement
        ) OR
        item.minimum_order_quantity IS DISTINCT FROM source.minimum_order_quantity OR
        item.order_measurement IS DISTINCT FROM source.order_measurement OR
        item.packaging IS DISTINCT FROM source.packaging OR
        item.packaging_quantity IS DISTINCT FROM source.minimum_order_quantity OR
        item.packaging_unit IS DISTINCT FROM source.order_measurement OR
        item.ordered_quantity IS DISTINCT FROM CASE
          WHEN item.order_quantity > 0
          THEN CEIL(item.order_quantity / source.minimum_order_quantity)
          ELSE 0
        END OR
        item.ordered_unit IS DISTINCT FROM source.packaging
      );
  `);

  // Cable Type Change Order quantities are lengths in metres. Fixed inherited
  // materials are per cable line, while pcs/m materials follow those lengths.
  // Keep existing snapshots consistent with the live calculation.
  await client.query(`
    WITH required AS (
      SELECT
        child.id,
        CASE
          WHEN child.unit = 'pcs/m'
          THEN parent.design_quantity * child.quantity_per_parent
          ELSE child.quantity_per_parent
        END AS design_quantity,
        CASE
          WHEN child.unit = 'pcs/m'
          THEN parent.order_quantity * child.quantity_per_parent
          ELSE child.quantity_per_parent
        END AS order_quantity
      FROM project_change_order_items child
      JOIN project_change_order_items parent ON parent.id = child.parent_item_id
      WHERE child.line_kind = 'inherited'
        AND child.quantity_per_parent IS NOT NULL
        AND parent.source_catalog = 'cable-type'
    )
    UPDATE project_change_order_items child
    SET
      design_quantity = required.design_quantity,
      order_quantity = GREATEST(required.design_quantity, required.order_quantity),
      ordered_quantity = CASE
        WHEN child.minimum_order_quantity IS NOT NULL
          AND GREATEST(required.design_quantity, required.order_quantity) > 0
        THEN CEIL(
          GREATEST(required.design_quantity, required.order_quantity) /
          child.minimum_order_quantity
        )
        ELSE GREATEST(required.design_quantity, required.order_quantity)
      END,
      updated_at = NOW()
    FROM required
    WHERE child.id = required.id
      AND (
        child.design_quantity IS DISTINCT FROM required.design_quantity OR
        child.order_quantity IS DISTINCT FROM GREATEST(
          required.design_quantity,
          required.order_quantity
        ) OR
        child.ordered_quantity IS DISTINCT FROM CASE
          WHEN child.minimum_order_quantity IS NOT NULL
            AND GREATEST(required.design_quantity, required.order_quantity) > 0
          THEN CEIL(
            GREATEST(required.design_quantity, required.order_quantity) /
            child.minimum_order_quantity
          )
          ELSE GREATEST(required.design_quantity, required.order_quantity)
        END
      );
  `);
}
