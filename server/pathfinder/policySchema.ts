import type { Pool,PoolClient } from 'pg';
import { PathFinderError } from './errors.js';

export type PurposePolicyState={catalogRevision:string;routingPolicyRevision:string;drawingPolicyRevision:string;drawingInputRevision:string};
export type ActivePurposeIncarnation={purposeKey:string;incarnationId:string;rowCount:number};

/** Schema construction only. Runtime caller owns the isolated database boundary. */
export const PURPOSE_POLICY_SCHEMA_SQL=String.raw`
CREATE TABLE IF NOT EXISTS pf_purpose_project_state(
 project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 catalog_revision bigint NOT NULL DEFAULT 0 CHECK(catalog_revision>=0),
 routing_policy_revision bigint NOT NULL DEFAULT 0 CHECK(routing_policy_revision>=0),
 drawing_policy_revision bigint NOT NULL DEFAULT 0 CHECK(drawing_policy_revision>=0),
 drawing_input_revision bigint NOT NULL DEFAULT 0 CHECK(drawing_input_revision>=0),updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pf_purpose_project_state(project_id) SELECT id FROM projects ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION pf_catalog_key(value text) RETURNS text LANGUAGE SQL IMMUTABLE STRICT AS $$
 SELECT btrim(normalize(value,NFC),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
CREATE TABLE IF NOT EXISTS pf_catalog_purpose_incarnations(
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,purpose_key text NOT NULL,
 incarnation_id uuid NOT NULL DEFAULT gen_random_uuid(),active boolean NOT NULL DEFAULT true,row_count bigint NOT NULL CHECK(row_count>=0),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,purpose_key,incarnation_id),CHECK(active=(row_count>0))
);
CREATE UNIQUE INDEX IF NOT EXISTS pf_catalog_active_purpose ON pf_catalog_purpose_incarnations(project_id,purpose_key) WHERE active;
INSERT INTO pf_catalog_purpose_incarnations(project_id,purpose_key,row_count)
 SELECT project_id,pf_catalog_key(purpose),count(*) FROM trays WHERE purpose IS NOT NULL AND pf_catalog_key(purpose)<>'' GROUP BY project_id,pf_catalog_key(purpose)
 ON CONFLICT(project_id,purpose_key) WHERE active DO NOTHING;
CREATE TABLE IF NOT EXISTS pf_catalog_snapshots(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,catalog_revision bigint NOT NULL,drawing_input_revision bigint NOT NULL,
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),public_catalog jsonb NOT NULL,
 source_projection_text text NOT NULL,dependency_facts_text text NOT NULL,routing_projection_text text NOT NULL,full_hash_input_text text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id),UNIQUE(project_id,catalog_revision,drawing_input_revision,content_sha256)
);
CREATE TABLE IF NOT EXISTS pf_catalog_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 catalog_revision bigint NOT NULL,drawing_input_revision bigint NOT NULL,kind text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION pf_catalog_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Catalog proofs/events are immutable';END $$;
DROP TRIGGER IF EXISTS pf_catalog_snapshot_immutable ON pf_catalog_snapshots;
CREATE TRIGGER pf_catalog_snapshot_immutable BEFORE UPDATE OR DELETE ON pf_catalog_snapshots FOR EACH ROW EXECUTE FUNCTION pf_catalog_immutable();
DROP TRIGGER IF EXISTS pf_catalog_event_immutable ON pf_catalog_events;
CREATE TRIGGER pf_catalog_event_immutable BEFORE UPDATE OR DELETE ON pf_catalog_events FOR EACH ROW EXECUTE FUNCTION pf_catalog_immutable();
CREATE OR REPLACE FUNCTION pf_catalog_project_initialize() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO pf_purpose_project_state(project_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_catalog_project_initialize ON projects;
CREATE TRIGGER pf_catalog_project_initialize AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION pf_catalog_project_initialize();
CREATE OR REPLACE FUNCTION pf_catalog_epoch_delta(pid uuid,pkey text,delta integer) RETURNS void LANGUAGE plpgsql AS $$
 DECLARE active_id uuid;BEGIN
 IF pkey IS NULL OR pkey='' OR NOT EXISTS(SELECT 1 FROM projects WHERE id=pid) THEN RETURN;END IF;
 SELECT incarnation_id INTO active_id FROM pf_catalog_purpose_incarnations WHERE project_id=pid AND purpose_key=pkey AND active FOR UPDATE;
 IF delta>0 THEN
  IF active_id IS NULL THEN INSERT INTO pf_catalog_purpose_incarnations(project_id,purpose_key,row_count) VALUES(pid,pkey,1);
  ELSE UPDATE pf_catalog_purpose_incarnations SET row_count=row_count+1 WHERE project_id=pid AND purpose_key=pkey AND incarnation_id=active_id;END IF;
 ELSE
  IF active_id IS NULL THEN RAISE EXCEPTION 'Catalog purpose count is inconsistent';END IF;
  UPDATE pf_catalog_purpose_incarnations SET active=(row_count>1),row_count=row_count-1 WHERE project_id=pid AND purpose_key=pkey AND incarnation_id=active_id;
 END IF;END $$;
CREATE OR REPLACE FUNCTION pf_catalog_bump(pid uuid,routing_changed boolean,drawing_changed boolean,reason text) RETURNS void LANGUAGE plpgsql AS $$
 DECLARE cr bigint;dr bigint;BEGIN
 IF NOT EXISTS(SELECT 1 FROM projects WHERE id=pid) THEN RETURN;END IF;
 INSERT INTO pf_purpose_project_state(project_id) VALUES(pid) ON CONFLICT DO NOTHING;
 UPDATE pf_purpose_project_state SET catalog_revision=catalog_revision+CASE WHEN routing_changed THEN 1 ELSE 0 END,
 drawing_input_revision=drawing_input_revision+CASE WHEN drawing_changed THEN 1 ELSE 0 END,updated_at=now() WHERE project_id=pid
 RETURNING catalog_revision,drawing_input_revision INTO cr,dr;
 INSERT INTO pf_catalog_events(project_id,catalog_revision,drawing_input_revision,kind) VALUES(pid,cr,dr,reason);END $$;
CREATE OR REPLACE FUNCTION pf_catalog_tray_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE old_pid uuid;new_pid uuid;pid uuid;old_key text;new_key text;routing_changed boolean;drawing_changed boolean;BEGIN
 IF TG_OP<>'INSERT' THEN old_pid=OLD.project_id;old_key=pf_catalog_key(OLD.purpose);END IF;
 IF TG_OP<>'DELETE' THEN new_pid=NEW.project_id;new_key=pf_catalog_key(NEW.purpose);END IF;
 IF TG_OP='UPDATE' THEN
  routing_changed=ROW(OLD.id,OLD.project_id,OLD.name,OLD.purpose) IS DISTINCT FROM ROW(NEW.id,NEW.project_id,NEW.name,NEW.purpose);
  drawing_changed=routing_changed OR ROW(OLD.tray_type,OLD.width_mm,OLD.height_mm,OLD.length_mm,OLD.length_source,OLD.length_calculation,OLD.include_grounding_cable,OLD.grounding_cable_type_id,OLD.use_trefoil_clamps,OLD.trefoil_clamp_spacing_mm)
   IS DISTINCT FROM ROW(NEW.tray_type,NEW.width_mm,NEW.height_mm,NEW.length_mm,NEW.length_source,NEW.length_calculation,NEW.include_grounding_cable,NEW.grounding_cable_type_id,NEW.use_trefoil_clamps,NEW.trefoil_clamp_spacing_mm);
 ELSE routing_changed=true;drawing_changed=true;END IF;
 IF NOT routing_changed AND NOT drawing_changed THEN RETURN COALESCE(NEW,OLD);END IF;
 FOR pid IN SELECT DISTINCT value FROM unnest(ARRAY[old_pid,new_pid]) value WHERE value IS NOT NULL ORDER BY value LOOP
  PERFORM pf_catalog_bump(pid,routing_changed,drawing_changed,'tray-'||lower(TG_OP));END LOOP;
 IF old_pid IS DISTINCT FROM new_pid OR old_key IS DISTINCT FROM new_key THEN
  IF old_pid IS NOT NULL THEN PERFORM pf_catalog_epoch_delta(old_pid,old_key,-1);END IF;
  IF new_pid IS NOT NULL THEN PERFORM pf_catalog_epoch_delta(new_pid,new_key,1);END IF;
 END IF;
 RETURN COALESCE(NEW,OLD);END $$;
DROP TRIGGER IF EXISTS pf_catalog_tray_mutation ON trays;
CREATE TRIGGER pf_catalog_tray_mutation AFTER INSERT OR UPDATE OR DELETE ON trays FOR EACH ROW EXECUTE FUNCTION pf_catalog_tray_mutation();
CREATE OR REPLACE FUNCTION pf_catalog_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Use transactional DELETE so catalog revisions are retained';END $$;
DROP TRIGGER IF EXISTS pf_catalog_no_truncate ON trays;
CREATE TRIGGER pf_catalog_no_truncate BEFORE TRUNCATE ON trays FOR EACH STATEMENT EXECUTE FUNCTION pf_catalog_no_truncate();
CREATE OR REPLACE FUNCTION pf_catalog_drawing_dependency() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE before_value jsonb;after_value jsonb;pid uuid;target_file_id uuid;is_source boolean;is_generated boolean;BEGIN
 IF TG_OP<>'INSERT' THEN before_value=to_jsonb(OLD)-ARRAY['created_at','updated_at','change_log'];END IF;
 IF TG_OP<>'DELETE' THEN after_value=to_jsonb(NEW)-ARRAY['created_at','updated_at','change_log'];END IF;
 IF before_value IS NOT DISTINCT FROM after_value THEN RETURN COALESCE(NEW,OLD);END IF;
 IF TG_TABLE_NAME IN ('project_files','project_file_versions') AND to_regclass('pf_drawing_generated_files') IS NOT NULL THEN
  target_file_id=CASE WHEN TG_TABLE_NAME='project_files' THEN COALESCE(after_value->>'id',before_value->>'id')::uuid ELSE COALESCE(after_value->>'project_file_id',before_value->>'project_file_id')::uuid END;
  SELECT EXISTS(SELECT 1 FROM project_tray_purpose_templates WHERE project_file_id=target_file_id) INTO is_source;
  SELECT EXISTS(SELECT 1 FROM pf_drawing_generated_files g WHERE g.file_id=target_file_id) INTO is_generated;
  -- Trusted export code sets this transaction-local marker only while writing its
  -- generated output closure. Existing referenced source/template files are fenced.
  IF NOT is_source AND (is_generated OR NULLIF(current_setting('wfc.drawing_export_id',true),'') IS NOT NULL) THEN RETURN COALESCE(NEW,OLD);END IF;
 END IF;
 IF TG_TABLE_NAME='projects' THEN
  IF (before_value->'support_distance',before_value->'support_weight',before_value->'tray_load_safety_factor',before_value->'cable_layout_settings') IS NOT DISTINCT FROM
     (after_value->'support_distance',after_value->'support_weight',after_value->'tray_load_safety_factor',after_value->'cable_layout_settings') THEN RETURN COALESCE(NEW,OLD);END IF;
  PERFORM pf_catalog_bump(NEW.id,false,true,'project-drawing-facts');
 ELSIF TG_TABLE_NAME IN ('cable_types','cables','project_support_distances','project_tray_purpose_templates','project_files') THEN
  FOR pid IN SELECT DISTINCT value::uuid FROM unnest(ARRAY[before_value->>'project_id',after_value->>'project_id']) value WHERE value IS NOT NULL ORDER BY value::uuid LOOP
   PERFORM pf_catalog_bump(pid,false,true,'drawing-'||TG_TABLE_NAME);END LOOP;
 ELSE
  -- Conservative drawing-only invalidation. Never locks business project/cable rows.
  FOR pid IN SELECT project_id FROM pf_purpose_project_state ORDER BY project_id LOOP
   PERFORM pf_catalog_bump(pid,false,true,'drawing-'||TG_TABLE_NAME);END LOOP;
 END IF;RETURN COALESCE(NEW,OLD);END $$;
`;

const dependencyTables=['projects','cable_types','cable_type_default_materials','cables','project_support_distances','project_tray_purpose_templates','project_files','project_file_versions','material_cable_types','material_trays','material_supports','material_load_curves','material_load_curve_points','material_cable_type_standard_materials','material_tray_standard_materials','material_support_standard_materials','material_cable_installation_materials','material_cable_installation_standard_materials','template_files','template_file_versions'] as const;
export async function initializePurposePolicySchema(pool:Pool):Promise<void> {
  const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-purpose-policy-schema-v1'))");
    // Existing writers do not take the schema advisory lock. Freeze project/tray writes,
    // in the normal project-before-tray order, before seeding counters or incarnations.
    await client.query('LOCK TABLE projects,trays IN SHARE ROW EXCLUSIVE MODE');await client.query(PURPOSE_POLICY_SCHEMA_SQL);
    for(const table of dependencyTables){await client.query(`DROP TRIGGER IF EXISTS pf_catalog_drawing_dependency ON ${table}`);await client.query(`CREATE TRIGGER pf_catalog_drawing_dependency AFTER ${table==='projects'?'UPDATE':'INSERT OR UPDATE OR DELETE'} ON ${table} FOR EACH ROW EXECUTE FUNCTION pf_catalog_drawing_dependency()`);}
    await client.query('COMMIT');}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
export async function readPurposePolicyState(client:PoolClient,projectId:string,{lock=false}:{lock?:boolean}={}):Promise<PurposePolicyState> {
  const row=(await client.query<{catalog_revision:string;routing_policy_revision:string;drawing_policy_revision:string;drawing_input_revision:string}>(`SELECT catalog_revision::text,routing_policy_revision::text,drawing_policy_revision::text,drawing_input_revision::text FROM pf_purpose_project_state WHERE project_id=$1${lock?' FOR UPDATE':''}`,[projectId])).rows[0];
  if(!row)throw new PathFinderError('PROJECT_NOT_FOUND',404);
  return {catalogRevision:row.catalog_revision,routingPolicyRevision:row.routing_policy_revision,drawingPolicyRevision:row.drawing_policy_revision,drawingInputRevision:row.drawing_input_revision};
}
export async function readActivePurposeIncarnations(client:PoolClient,projectId:string):Promise<ActivePurposeIncarnation[]> {
  const result=await client.query<{purpose_key:string;incarnation_id:string;row_count:string}>('SELECT purpose_key,incarnation_id::text,row_count::text FROM pf_catalog_purpose_incarnations WHERE project_id=$1 AND active ORDER BY purpose_key COLLATE "C"',[projectId]);
  return result.rows.map(row=>({purposeKey:row.purpose_key,incarnationId:row.incarnation_id,rowCount:Number(row.row_count)}));
}
