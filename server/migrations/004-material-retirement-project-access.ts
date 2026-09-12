import type { Queryable } from './schemaInspection.js';

// Immutable after application. Existing materials remain active; no project
// values, identities, or snapshots are reconstructed or rewritten.
export const applyMaterialRetirementProjectAccess = async (client: Queryable): Promise<void> => {
  const tables = ['material_cable_types', 'material_cable_installation_materials',
    'material_tray_installation_materials', 'material_instruments',
    'material_instrument_installation_materials', 'material_trays', 'material_supports'];
  await client.query(`CREATE FUNCTION prevent_catalog_material_delete() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'Catalog materials must be marked obsolete, not physically deleted'
        USING ERRCODE = '23514';
    END $$`);
  for (const table of tables) {
    await client.query(`ALTER TABLE ${table}
      ADD COLUMN obsolete_at TIMESTAMPTZ,
      ADD COLUMN obsolete_by UUID REFERENCES users(id) ON DELETE SET NULL`);
    await client.query(`CREATE TRIGGER prevent_material_delete BEFORE DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION prevent_catalog_material_delete()`);
  }
  await client.query(`CREATE TABLE project_engineers (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
  ); CREATE INDEX project_engineers_user_idx ON project_engineers(user_id)`);
};
