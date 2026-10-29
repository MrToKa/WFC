/** Additive startup-only index; exact SDK reads never create schema. */
export const CABLE_ENDPOINT_SELECTION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS pf_model_object_sdk
  ON pf_model_objects(project_id,artifact_id,db_id,object_id) WHERE db_id IS NOT NULL;`;
