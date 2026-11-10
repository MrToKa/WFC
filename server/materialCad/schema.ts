import type { Pool } from 'pg';

/**
 * Global Materials is the source of truth for catalogue STEP assets.
 * Each CAD component is immutable and versioned; project designs pin one asset.
 * This additive PoC migration runs only when WFC_CAD_DESIGN_ENABLED=true.
 */
export async function initializeMaterialTrayCadSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_tray_cad_assets (
      id UUID PRIMARY KEY,
      material_tray_id UUID NOT NULL REFERENCES material_trays(id) ON DELETE RESTRICT,
      part_number TEXT NOT NULL CHECK (length(trim(part_number)) BETWEEN 1 AND 160),
      component_kind TEXT NOT NULL CHECK (
        component_kind IN ('straight','bend','tee','reducer','connector','accessory','other')
      ),
      revision INTEGER NOT NULL CHECK (revision > 0),
      original_filename TEXT NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 200),
      source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
      source_bytes BIGINT NOT NULL CHECK (source_bytes BETWEEN 1 AND 8388608),
      source_object_key TEXT NOT NULL UNIQUE,
      mesh_object_key TEXT NOT NULL UNIQUE,
      mesh_metadata JSONB NOT NULL CHECK (jsonb_typeof(mesh_metadata) = 'object'),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (material_tray_id,part_number,revision),
      UNIQUE (material_tray_id,id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS material_tray_cad_active_part
      ON material_tray_cad_assets(material_tray_id,part_number) WHERE active;
    CREATE INDEX IF NOT EXISTS material_tray_cad_by_material
      ON material_tray_cad_assets(material_tray_id,created_at DESC);

    -- The existing POC catalogue acts as a per-project reference to a single
    -- Materials CAD revision, not a second source of product master data.
    -- This FK intentionally prohibits removing a CAD revision used in a design.
  `);
}
