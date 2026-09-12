import type { PoolClient } from 'pg';

export const applyMaterialFoundations = async (client: Pick<PoolClient, 'query'>): Promise<void> => {
  await client.query(`
    ALTER TABLE cable_types ADD COLUMN material_snapshot JSONB;
    ALTER TABLE cable_type_default_materials
      ADD COLUMN current_material_id UUID REFERENCES material_cable_installation_materials(id) ON DELETE SET NULL,
      ADD COLUMN material_snapshot JSONB,
      ADD COLUMN inherited_override BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE cable_materials
      ADD COLUMN current_material_id UUID REFERENCES material_cable_installation_materials(id) ON DELETE SET NULL,
      ADD COLUMN material_snapshot JSONB,
      ADD COLUMN origin_kind TEXT CHECK (origin_kind IN ('catalog-inherited', 'project-added', 'cable-added')),
      ADD COLUMN inherited_override BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  // Unknown legacy identity/snapshot/origin remains unknown. Never fill historical
  // copied attributes by reading today's catalog or guessing from display names.
  await client.query(`
    UPDATE cable_materials SET origin_kind = 'cable-added' WHERE source = 'manual';
    UPDATE cable_materials cm SET origin_kind = CASE
      WHEN dm.source_kind = 'manual' THEN 'project-added'
      WHEN dm.source_kind = 'standard-material' THEN 'catalog-inherited'
      ELSE NULL END,
      inherited_override = cm.name IS DISTINCT FROM dm.name
        OR cm.quantity IS DISTINCT FROM dm.quantity OR cm.unit IS DISTINCT FROM dm.unit
        OR cm.remarks IS DISTINCT FROM dm.remarks
    FROM cable_type_default_materials dm
    WHERE cm.source = 'default' AND cm.cable_type_default_material_id = dm.id;
  `);
  await client.query(`
    DO $$ DECLARE fk RECORD;
    BEGIN
      FOR fk IN
        SELECT k.conname FROM pg_constraint k
        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY(k.conkey)
        WHERE k.conrelid = 'cables'::regclass AND k.contype = 'f' AND a.attname = 'cable_type_id'
      LOOP
        EXECUTE format('ALTER TABLE cables DROP CONSTRAINT %I', fk.conname);
      END LOOP;
      ALTER TABLE cables ADD CONSTRAINT cables_cable_type_id_fkey
        FOREIGN KEY (cable_type_id) REFERENCES cable_types(id) ON DELETE RESTRICT;
    END $$;
    CREATE TABLE mutation_revisions (
      resource_type TEXT NOT NULL, resource_id UUID NOT NULL,
      revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
      PRIMARY KEY (resource_type, resource_id)
    );
    CREATE TABLE mutation_receipts (
      actor_id UUID NOT NULL, resource_type TEXT NOT NULL, resource_id UUID NOT NULL,
      idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, result JSONB NOT NULL,
      revision BIGINT NOT NULL CHECK (revision >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (actor_id, resource_type, resource_id, idempotency_key)
    );
    CREATE TABLE mutation_history (
      resource_type TEXT NOT NULL, resource_id UUID NOT NULL,
      revision BIGINT NOT NULL CHECK (revision >= 0), actor_id UUID NOT NULL,
      snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (resource_type, resource_id, revision)
    );
  `);
};
