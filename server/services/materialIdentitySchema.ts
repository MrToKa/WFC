import type { Pool } from 'pg';

export const materialIdentityTables = [
  'material_cable_types',
  'material_cable_installation_materials',
  'material_tray_installation_materials',
  'material_instruments',
  'material_instrument_installation_materials',
] as const;

/** Preserve legacy duplicates while preventing new ones, including concurrent writes.
 * Clean catalogs use a unique index. Conflicted catalogs temporarily reserve each
 * product identity in a unique registry, maintained by database triggers.
 */
export async function initializeMaterialIdentity(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Also serializes concurrent startup migrations and registry reconstruction.
    await client.query(`LOCK TABLE ${materialIdentityTables.join(', ')} IN ACCESS EXCLUSIVE MODE`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS material_product_identities (
        catalog TEXT NOT NULL,
        manufacturer TEXT NOT NULL,
        part_no TEXT NOT NULL,
        reference_count INTEGER NOT NULL CHECK (reference_count >= 0),
        PRIMARY KEY (catalog, manufacturer, part_no)
      );
      CREATE OR REPLACE FUNCTION enforce_material_product_identity()
      RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        old_manufacturer TEXT;
        old_part_no TEXT;
        new_manufacturer TEXT;
        new_part_no TEXT;
        identity_count INTEGER;
      BEGIN
        IF TG_OP <> 'INSERT' AND OLD.obsolete_at IS NULL THEN
          old_manufacturer := NULLIF(LOWER(BTRIM(OLD.manufacturer)), '');
          old_part_no := NULLIF(LOWER(BTRIM(OLD.part_no)), '');
        END IF;
        IF TG_OP <> 'DELETE' AND NEW.obsolete_at IS NULL THEN
          new_manufacturer := NULLIF(LOWER(BTRIM(NEW.manufacturer)), '');
          new_part_no := NULLIF(LOWER(BTRIM(NEW.part_no)), '');
        END IF;
        IF TG_OP = 'UPDATE'
          AND old_manufacturer IS NOT DISTINCT FROM new_manufacturer
          AND old_part_no IS NOT DISTINCT FROM new_part_no THEN
          RETURN NEW;
        END IF;
        IF old_manufacturer IS NOT NULL AND old_part_no IS NOT NULL THEN
          UPDATE material_product_identities SET reference_count = reference_count - 1
          WHERE catalog = TG_TABLE_NAME AND manufacturer = old_manufacturer AND part_no = old_part_no;
          DELETE FROM material_product_identities
          WHERE catalog = TG_TABLE_NAME AND manufacturer = old_manufacturer
            AND part_no = old_part_no AND reference_count = 0;
        END IF;
        IF new_manufacturer IS NOT NULL AND new_part_no IS NOT NULL THEN
          INSERT INTO material_product_identities AS identity (catalog, manufacturer, part_no, reference_count)
          VALUES (TG_TABLE_NAME, new_manufacturer, new_part_no, 1)
          ON CONFLICT (catalog, manufacturer, part_no) DO UPDATE
            SET reference_count = identity.reference_count + 1
          RETURNING reference_count INTO identity_count;
          IF identity_count > 1 THEN
            RAISE EXCEPTION 'A material with this Manufacturer + Part No. already exists'
              USING ERRCODE = '23505';
          END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE OR REPLACE FUNCTION prevent_catalog_material_delete()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'Catalog materials must be marked obsolete, not physically deleted'
          USING ERRCODE = '23514';
      END $$;
    `);
    for (const table of materialIdentityTables) {
      await client.query(`
        ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS obsolete_at TIMESTAMPTZ;
        ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS obsolete_by UUID;
        DROP TRIGGER IF EXISTS prevent_material_delete ON ${table};
        CREATE TRIGGER prevent_material_delete BEFORE DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION prevent_catalog_material_delete();
      `);
      const duplicates = await client.query(`
        SELECT 1 FROM ${table}
        WHERE obsolete_at IS NULL
          AND NULLIF(BTRIM(manufacturer), '') IS NOT NULL AND NULLIF(BTRIM(part_no), '') IS NOT NULL
        GROUP BY LOWER(BTRIM(manufacturer)), LOWER(BTRIM(part_no))
        HAVING COUNT(*) > 1 LIMIT 1
      `);
      await client.query(`
        DROP TRIGGER IF EXISTS material_product_identity_guard ON ${table};
        DELETE FROM material_product_identities WHERE catalog = '${table}';
      `);
      if (duplicates.rows.length > 0) {
        await client.query(`
          INSERT INTO material_product_identities (catalog, manufacturer, part_no, reference_count)
          SELECT '${table}', LOWER(BTRIM(manufacturer)), LOWER(BTRIM(part_no)), COUNT(*)::integer
          FROM ${table}
          WHERE obsolete_at IS NULL
            AND NULLIF(BTRIM(manufacturer), '') IS NOT NULL AND NULLIF(BTRIM(part_no), '') IS NOT NULL
          GROUP BY LOWER(BTRIM(manufacturer)), LOWER(BTRIM(part_no));
          CREATE TRIGGER material_product_identity_guard
          AFTER INSERT OR UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION enforce_material_product_identity();
        `);
        console.warn(
          `${table}: existing Manufacturer + Part No. duplicates need correction; database protection against new duplicates is active.`,
        );
      } else {
        await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS ${table}_active_product_idx
          ON ${table} (
            NULLIF(LOWER(BTRIM(manufacturer)), ''),
            NULLIF(LOWER(BTRIM(part_no)), '')
          ) WHERE obsolete_at IS NULL;
        `);
      }
      await client.query(
        `DROP INDEX IF EXISTS ${table}_${table === 'material_cable_types' ? 'name' : 'type'}_lower_idx`,
      );
      await client.query(`DROP INDEX IF EXISTS ${table}_manufacturer_part_no_idx`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
