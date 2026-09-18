import type { Pool } from 'pg';
import { MATERIAL_CAPABILITIES } from './materialCapabilities.js';

// Persist row changes in the same transaction as the edit, including Excel imports
// and FK actions. History survives referenced material/user deletion.
export const initializeMaterialChangeLog = async (pool: Pick<Pool, 'query'>): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_change_logs (
      id BIGSERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      material_id UUID NOT NULL,
      transaction_id BIGINT NOT NULL,
      user_id UUID,
      user_name TEXT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      events JSONB NOT NULL,
      UNIQUE (category, material_id, transaction_id)
    );
    CREATE INDEX IF NOT EXISTS material_change_logs_owner_idx
      ON material_change_logs (category, material_id, id DESC);

    CREATE OR REPLACE FUNCTION record_material_change() RETURNS trigger AS $$
    DECLARE
      previous JSONB;
      current_value JSONB;
      row_data JSONB;
      owner_id UUID;
      actor_id UUID;
      actor_name TEXT;
      item_key TEXT;
      item_label TEXT;
    BEGIN
      IF TG_OP <> 'INSERT' THEN previous := to_jsonb(OLD) - 'created_at' - 'updated_at'; END IF;
      IF TG_OP <> 'DELETE' THEN current_value := to_jsonb(NEW) - 'created_at' - 'updated_at'; END IF;
      IF previous IS NOT DISTINCT FROM current_value THEN RETURN NULL; END IF;
      row_data := COALESCE(current_value, previous);
      owner_id := (row_data ->> TG_ARGV[1])::uuid;
      item_key := CASE WHEN TG_ARGV[2] = 'point' THEN row_data ->> 'point_order'
                       ELSE row_data ->> 'id' END;
      IF TG_ARGV[2] = 'standard-material' THEN
        EXECUTE format('SELECT type FROM %I WHERE id = $1', TG_ARGV[3])
          INTO item_label USING (row_data ->> 'referenced_material_id')::uuid;
      END IF;
      actor_id := NULLIF(current_setting('wfc.material_actor', true), '')::uuid;
      SELECT COALESCE(NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), email)
        INTO actor_name FROM users WHERE id = actor_id;
      IF actor_id IS NOT NULL AND actor_name IS NULL THEN
        RAISE EXCEPTION 'Material change actor not found';
      END IF;
      INSERT INTO material_change_logs
        (category, material_id, transaction_id, user_id, user_name, events)
      VALUES (TG_ARGV[0], owner_id, txid_current(), actor_id, COALESCE(actor_name, 'System'),
        jsonb_build_array(jsonb_build_object(
          'kind', TG_ARGV[2], 'key', item_key, 'label', item_label,
          'before', previous, 'after', current_value)))
      ON CONFLICT (category, material_id, transaction_id) DO UPDATE
        SET events = material_change_logs.events || EXCLUDED.events;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  const targets = [
    ...Object.values(MATERIAL_CAPABILITIES).flatMap((capability) => [
      {
        table: capability.ownerTable,
        category: capability.category,
        owner: 'id',
        kind: 'material',
        reference: '',
      },
      {
        table: capability.assignmentTable,
        category: capability.category,
        owner: capability.assignmentOwnerColumn,
        kind: 'standard-material',
        reference: capability.referencedMaterialTable,
      },
    ]),
    {
      table: 'material_load_curves',
      category: 'load-curve',
      owner: 'id',
      kind: 'material',
      reference: '',
    },
    {
      table: 'material_load_curve_points',
      category: 'load-curve',
      owner: 'load_curve_id',
      kind: 'point',
      reference: '',
    },
  ];
  // Identifiers and arguments below are exclusively server-owned constants.
  for (const target of targets) {
    await pool.query(`
      DROP TRIGGER IF EXISTS material_change_log ON ${target.table};
      CREATE TRIGGER material_change_log AFTER INSERT OR UPDATE OR DELETE ON ${target.table}
        FOR EACH ROW EXECUTE FUNCTION record_material_change(
          '${target.category}', '${target.owner}', '${target.kind}', '${target.reference}');
    `);
  }
};
