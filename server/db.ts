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
      install_length INTEGER,
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
    ADD COLUMN IF NOT EXISTS install_length INTEGER;
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
    CREATE UNIQUE INDEX IF NOT EXISTS trays_project_name_idx
      ON trays (project_id, lower(name));
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS trays_project_id_idx
      ON trays (project_id);
  `);
}

export async function shutdownDatabase(): Promise<void> {
  await pool.end();
}
