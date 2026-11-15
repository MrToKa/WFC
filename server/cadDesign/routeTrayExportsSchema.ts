import type { Pool } from 'pg';

/** An owned project-list projection, not another Materials product catalogue. */
export async function initializeCadRouteTrayExportsSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cad_route_tray_exports (
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      design_id UUID NOT NULL,
      route_group_id UUID NOT NULL,
      tray_id UUID NOT NULL,
      source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
      source_proof JSONB NOT NULL CHECK(jsonb_typeof(source_proof)='object'),
      projection JSONB NOT NULL CHECK(jsonb_typeof(projection)='object'),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(project_id,design_id,route_group_id),
      UNIQUE(project_id,tray_id),
      FOREIGN KEY(project_id,design_id,route_group_id)
        REFERENCES cad_route_groups(project_id,design_id,id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY(project_id,tray_id) REFERENCES trays(project_id,id) ON DELETE CASCADE
    );
  `);
}
