import type { Pool } from 'pg';
import { MATERIAL_CAPABILITIES } from './materialCapabilities.js';

/** Upgrade existing assignments in place; keep category-qualified FK integrity. */
export async function initializeStandardMaterialCategories(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const capabilities = Object.values(MATERIAL_CAPABILITIES);
    await client.query(
      `LOCK TABLE ${capabilities.flatMap((c) => [c.ownerTable, c.assignmentTable]).join(', ')} IN ACCESS EXCLUSIVE MODE`,
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS standard_material_references (
        category TEXT NOT NULL,
        id UUID NOT NULL,
        PRIMARY KEY (category, id)
      );
      CREATE OR REPLACE FUNCTION sync_standard_material_reference() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          DELETE FROM standard_material_references WHERE category = TG_ARGV[0] AND id = OLD.id;
          RETURN OLD;
        END IF;
        INSERT INTO standard_material_references (category, id) VALUES (TG_ARGV[0], NEW.id)
          ON CONFLICT DO NOTHING;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    for (const c of capabilities) {
      await client.query(`
        INSERT INTO standard_material_references (category, id)
          SELECT '${c.category}', id FROM ${c.ownerTable} ON CONFLICT DO NOTHING;
        DROP TRIGGER IF EXISTS standard_material_reference_sync ON ${c.ownerTable};
        CREATE TRIGGER standard_material_reference_sync AFTER INSERT OR DELETE ON ${c.ownerTable}
          FOR EACH ROW EXECUTE FUNCTION sync_standard_material_reference('${c.category}');
      `);
    }
    for (const c of capabilities) {
      await client.query(`
        ALTER TABLE ${c.assignmentTable} ADD COLUMN IF NOT EXISTS referenced_material_category TEXT
          NOT NULL DEFAULT '${c.category === 'tray' || c.category === 'support' ? 'cable-installation-material' : c.referencedMaterialCategory}';
        ALTER TABLE ${c.assignmentTable} ALTER COLUMN referenced_material_category SET DEFAULT '${c.referencedMaterialCategory}';
        DO $$ DECLARE constraint_row RECORD; BEGIN
          FOR constraint_row IN
            SELECT conname FROM pg_constraint
            WHERE conrelid = '${c.assignmentTable}'::regclass AND (
              (contype = 'f' AND confrelid <> 'standard_material_references'::regclass
                AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = '${c.assignmentTable}'::regclass AND attname = 'referenced_material_id')]::smallint[])
              OR (contype = 'u' AND array_length(conkey, 1) = 2)
              OR (contype = 'c' AND pg_get_constraintdef(oid) LIKE '%<> referenced_material_id%'
                  AND pg_get_constraintdef(oid) NOT LIKE '%referenced_material_category%')
            )
          LOOP
            EXECUTE format('ALTER TABLE ${c.assignmentTable} DROP CONSTRAINT %I', constraint_row.conname);
          END LOOP;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '${c.assignmentTable}'::regclass AND conname = 'standard_material_category_reference_fk') THEN
            ALTER TABLE ${c.assignmentTable} ADD CONSTRAINT standard_material_category_reference_fk
              FOREIGN KEY (referenced_material_category, referenced_material_id)
              REFERENCES standard_material_references(category, id) ON DELETE NO ACTION;
            ALTER TABLE ${c.assignmentTable} ADD CONSTRAINT ${c.category.replaceAll('-', '_')}_sm_category_unique
              UNIQUE (${c.assignmentOwnerColumn}, referenced_material_category, referenced_material_id);
            ALTER TABLE ${c.assignmentTable} ADD CONSTRAINT standard_material_category_self_check
              CHECK (referenced_material_category <> '${c.category}' OR ${c.assignmentOwnerColumn} <> referenced_material_id);
          END IF;
        END $$;
      `);
    }
    // A common projection for displaying and expanding references from every catalog.
    const selects = capabilities.map((c) => {
      const structural = c.category === 'tray' || c.category === 'support';
      const cable = c.category === 'cable-type';
      return `SELECT '${c.category}'::text AS category, id, ${c.ownerNameColumn} AS type,
        ${structural ? 'NULL::text' : 'purpose'} AS purpose,
        ${structural ? 'NULL::text' : 'material'} AS material,
        ${structural ? 'NULL::text' : 'description'} AS description,
        ${structural || cable ? 'NULL::text' : 'dimension_mm'} AS dimension_mm,
        ${cable || c.category === 'tray' ? 'weight_kg_per_m' : 'weight_kg'} AS weight_kg,
        unit_price, manufacturer, ${structural ? 'NULL::text' : 'part_no'} AS part_no,
        minimum_order_quantity, order_measurement, packaging FROM ${c.ownerTable}`;
    });
    await client.query(
      `CREATE OR REPLACE VIEW standard_material_catalog AS ${selects.join(' UNION ALL ')}`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
