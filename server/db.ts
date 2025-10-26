import { Pool } from 'pg';
import { config } from './config.js';

export const pool = new Pool({
  connectionString: config.databaseUrl
});

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
    CREATE TABLE IF NOT EXISTS cables (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      cable_id TEXT NOT NULL,
      tag TEXT,
      cable_type_id UUID NOT NULL REFERENCES cable_types(id) ON DELETE CASCADE,
      from_location TEXT,
      to_location TEXT,
      routing TEXT,
      design_length INTEGER,
      install_length INTEGER,
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
      ON cables (project_id, lower(cable_id));
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
    ADD COLUMN IF NOT EXISTS design_length INTEGER;
  `);

  await pool.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS install_length INTEGER;
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
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS connected_to DATE;
  `);

  await pool.query(`
    ALTER TABLE cables
    ADD COLUMN IF NOT EXISTS tested DATE;
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
      height_mm NUMERIC,
      width_mm NUMERIC,
      weight_kg_per_m NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS material_trays_type_lower_idx
      ON material_trays (LOWER(tray_type));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_supports (
      id UUID PRIMARY KEY,
      support_type TEXT NOT NULL UNIQUE,
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
    ALTER TABLE project_support_distances
    ADD COLUMN IF NOT EXISTS support_id UUID REFERENCES material_supports(id) ON DELETE SET NULL;
  `);
}

export async function shutdownDatabase(): Promise<void> {
  await pool.end();
}
