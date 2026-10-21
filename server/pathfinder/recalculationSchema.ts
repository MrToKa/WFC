import type { Pool, PoolClient } from 'pg';

/** Additive Level-A scheduling; this stores neither a bearer nor an R8 grant. */
export const RECALCULATION_SQL = `
CREATE TABLE IF NOT EXISTS pf_recalculation_state (
 project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 control_revision bigint NOT NULL DEFAULT 0 CHECK(control_revision>=0),desired_generation bigint NOT NULL DEFAULT 0 CHECK(desired_generation>=0),
 enrolled_generation bigint,authority_epoch bigint NOT NULL DEFAULT 0 CHECK(authority_epoch>=0),
 enabled boolean NOT NULL DEFAULT false,paused boolean NOT NULL DEFAULT false,
 actor_id uuid,login_id uuid,login_expires_at timestamptz,authority_expires_at timestamptz,
 preferences jsonb,timeout_ms integer CHECK(timeout_ms BETWEEN 100 AND 120000),
 status text NOT NULL DEFAULT 'disabled' CHECK(status IN('disabled','awaiting_authority','paused','debouncing','collecting','queued','calculating','complete','blocked','superseded','failed')),
 reason_codes jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(reason_codes)='array' AND jsonb_array_length(reason_codes)<=64),
 first_dirty_at timestamptz,due_at timestamptz,attempt_generation bigint,attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 engine_identity_sha256 text CHECK(engine_identity_sha256~'^[a-f0-9]{64}$'),
 engine_unavailable_code text CHECK(engine_unavailable_code~'^[A-Z][A-Z0-9_]{0,95}$'),
 current_job_id uuid,completed integer NOT NULL DEFAULT 0,total integer NOT NULL DEFAULT 0,ready_cables integer NOT NULL DEFAULT 0,blocked_cables integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,current_job_id) REFERENCES pf_jobs(project_id,id),
 CHECK((actor_id IS NULL)=(login_id IS NULL)),CHECK((login_id IS NULL)=(login_expires_at IS NULL)),
 CHECK((login_id IS NULL)=(authority_expires_at IS NULL)),CHECK(authority_expires_at IS NULL OR authority_expires_at<=login_expires_at)
);
ALTER TABLE pf_recalculation_state ADD COLUMN IF NOT EXISTS engine_unavailable_code text CHECK(engine_unavailable_code~'^[A-Z][A-Z0-9_]{0,95}$');
INSERT INTO pf_recalculation_state(project_id) SELECT id FROM projects ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS pf_recalculation_claims (
 project_id uuid PRIMARY KEY REFERENCES pf_recalculation_state(project_id) ON DELETE CASCADE,
 generation bigint NOT NULL CHECK(generation>=0),control_revision bigint NOT NULL,authority_epoch bigint NOT NULL,
 claim_id uuid NOT NULL UNIQUE,owner_token uuid NOT NULL,lease_until timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pf_recalculation_enrollments (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,generation bigint NOT NULL CHECK(generation>=0),
 control_revision bigint NOT NULL,authority_epoch bigint NOT NULL,actor_id uuid NOT NULL,login_id uuid NOT NULL,
 authority_expires_at timestamptz NOT NULL,job_id uuid,input_sha256 text NOT NULL CHECK(input_sha256~'^[a-f0-9]{64}$'),
 total integer NOT NULL CHECK(total BETWEEN 0 AND 10000),ready_cables integer NOT NULL CHECK(ready_cables>=0),blocked_cables integer NOT NULL CHECK(blocked_cables>=0),
 reason_codes jsonb NOT NULL CHECK(jsonb_typeof(reason_codes)='array'),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,generation),UNIQUE(project_id,job_id),FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE,
 CHECK(ready_cables+blocked_cables=total),CHECK((job_id IS NULL)=(ready_cables=0))
);
CREATE TABLE IF NOT EXISTS pf_recalculation_commands (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,actor_id uuid NOT NULL,idempotency_key uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),request jsonb NOT NULL CHECK(octet_length(request::text)<=65536),
 receipt jsonb NOT NULL CHECK(octet_length(receipt::text)<=1048576),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,actor_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS pf_recalculation_events (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,generation bigint NOT NULL,
 domain text NOT NULL CHECK(domain IN('model','geometry','routing','endpoints','settings','cables','engine','manual','preferences','barriers')),
 reason text NOT NULL CHECK(reason~'^[A-Z][A-Z0-9_]{0,95}$'),source_revision text CHECK(octet_length(source_revision)<=256),
 occurred_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,generation)
);
CREATE INDEX IF NOT EXISTS pf_recalculation_due ON pf_recalculation_state(due_at,project_id) WHERE enabled AND NOT paused;
-- Existing installations retain the old generated CHECK until deliberately migrated.
ALTER TABLE pf_recalculation_events DROP CONSTRAINT IF EXISTS pf_recalculation_events_domain_check;
ALTER TABLE pf_recalculation_events ADD CONSTRAINT pf_recalculation_events_domain_check CHECK(domain IN('model','geometry','routing','endpoints','settings','cables','engine','manual','preferences','barriers'));
CREATE OR REPLACE FUNCTION pf_recalculation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Recalculation command/enrollment is immutable';END $$;
DROP TRIGGER IF EXISTS pf_recalculation_commands_immutable ON pf_recalculation_commands;
CREATE TRIGGER pf_recalculation_commands_immutable BEFORE UPDATE OR DELETE ON pf_recalculation_commands FOR EACH ROW EXECUTE FUNCTION pf_recalculation_immutable();
DROP TRIGGER IF EXISTS pf_recalculation_enrollments_immutable ON pf_recalculation_enrollments;
CREATE TRIGGER pf_recalculation_enrollments_immutable BEFORE UPDATE OR DELETE ON pf_recalculation_enrollments FOR EACH ROW EXECUTE FUNCTION pf_recalculation_immutable();
DROP TRIGGER IF EXISTS pf_recalculation_event_update ON pf_recalculation_events;
CREATE TRIGGER pf_recalculation_event_update BEFORE UPDATE ON pf_recalculation_events FOR EACH ROW EXECUTE FUNCTION pf_recalculation_immutable();
CREATE OR REPLACE FUNCTION pf_recalculation_dirty(pid uuid,kind text,why text,source_value text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
 DECLARE gen bigint;BEGIN
 IF NOT EXISTS(SELECT 1 FROM projects WHERE id=pid) THEN RETURN;END IF;
 IF kind NOT IN('model','geometry','routing','endpoints','settings','cables','engine','manual','preferences','barriers') OR why!~'^[A-Z][A-Z0-9_]{0,95}$' OR octet_length(source_value)>256 THEN RAISE EXCEPTION 'Invalid recalculation event';END IF;
 INSERT INTO pf_recalculation_state(project_id) VALUES(pid) ON CONFLICT DO NOTHING;
 UPDATE pf_recalculation_state SET desired_generation=desired_generation+1,
 first_dirty_at=COALESCE(first_dirty_at,clock_timestamp()),
 due_at=LEAST(COALESCE(first_dirty_at,clock_timestamp())+interval '5 seconds',clock_timestamp()+interval '500 milliseconds'),
 attempts=0,attempt_generation=NULL,
 reason_codes=(SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]'::jsonb) FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(reason_codes||jsonb_build_array(why)) value ORDER BY value LIMIT 64) reasons),
 status=CASE WHEN NOT enabled THEN 'disabled' WHEN paused THEN 'paused' WHEN authority_expires_at<=clock_timestamp() THEN 'awaiting_authority' ELSE 'debouncing' END,
 updated_at=clock_timestamp() WHERE project_id=pid RETURNING desired_generation INTO gen;
 INSERT INTO pf_recalculation_events(project_id,generation,domain,reason,source_revision) VALUES(pid,gen,kind,why,source_value);
 -- A bounded scheduler journal, not the immutable engineering/Apply history.
 DELETE FROM pf_recalculation_events WHERE project_id=pid AND generation<=gen-1024;
 END $$;
CREATE OR REPLACE FUNCTION pf_recalculation_project_init() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO pf_recalculation_state(project_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_recalculation_project_init ON projects;
CREATE TRIGGER pf_recalculation_project_init AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION pf_recalculation_project_init();
CREATE OR REPLACE FUNCTION pf_recalculation_row_event() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE b jsonb;a jsonb;pid uuid;changed boolean:=false;kind text;why text;source_value text;BEGIN
 IF TG_OP<>'INSERT' THEN b=to_jsonb(OLD);END IF;IF TG_OP<>'DELETE' THEN a=to_jsonb(NEW);END IF;
 -- Only the versioned endpoint command owns a same-transaction scoped impact.
 -- Legacy endpoint writers and every other global dependency retain their events.
 IF TG_TABLE_NAME IN('pf_project_state','pf_endpoint_binding_heads') AND current_setting('wfc.pathfinder_location_impact',true)='1' THEN RETURN COALESCE(NEW,OLD);END IF;
 pid=COALESCE(a->>'project_id',b->>'project_id')::uuid;
 CASE TG_TABLE_NAME
 WHEN 'projects' THEN pid=COALESCE(a->>'id',b->>'id')::uuid;kind='settings';why='PROJECT_SETTINGS_CHANGED';changed=(b->'connection_gap',b->'secondary_tray_length',b->'end_connection_length',b->'additional_bending_percent') IS DISTINCT FROM (a->'connection_gap',a->'secondary_tray_length',a->'end_connection_length',a->'additional_bending_percent');
 WHEN 'project_model_selections' THEN kind='model';why='MODEL_SELECTION_CHANGED';changed=(b->'active_model_version_id',b->'selection_revision') IS DISTINCT FROM (a->'active_model_version_id',a->'selection_revision');
 WHEN 'model_versions' THEN kind='model';why='ACTIVE_MODEL_STATE_CHANGED';changed=(b->'state',b->'health',b->'content_fingerprint') IS DISTINCT FROM (a->'state',a->'health',a->'content_fingerprint') AND EXISTS(SELECT 1 FROM project_model_selections WHERE project_id=pid AND active_model_version_id=COALESCE(a->>'id',b->>'id')::uuid);
 WHEN 'pf_project_preparations' THEN kind='geometry';why='PREPARATION_CHANGED';changed=(b->'current_aggregate_id',b->'current_artifact_id',b->'geometry_revision') IS DISTINCT FROM (a->'current_aggregate_id',a->'current_artifact_id',a->'geometry_revision');
 WHEN 'pf_purpose_project_state' THEN kind='routing';why='ROUTING_SCOPE_CHANGED';changed=(b->'catalog_revision',b->'routing_policy_revision') IS DISTINCT FROM (a->'catalog_revision',a->'routing_policy_revision');
 WHEN 'pf_project_state' THEN kind='endpoints';why='LOCATION_REGISTRY_CHANGED';changed=b->'registry_revision' IS DISTINCT FROM a->'registry_revision';
 WHEN 'pf_endpoint_binding_heads' THEN kind='endpoints';why='ENDPOINT_BINDING_CHANGED';changed=(b->'binding_id',b->'binding_revision') IS DISTINCT FROM (a->'binding_id',a->'binding_revision');
 WHEN 'pf_barrier_heads' THEN kind='barriers';why='BARRIER_SCOPE_CHANGED';changed=(b->'revision',b->'snapshot_id') IS DISTINCT FROM (a->'revision',a->'snapshot_id') AND COALESCE(a->>'snapshot_id',b->>'snapshot_id') IS NOT NULL;
 WHEN 'pf_revision_comparison_targets' THEN kind='geometry';why='COMPARISON_SCOPE_CHANGED';changed=(b->'current_comparison_id',b->'comparison_revision',b->'decision_set_sha256') IS DISTINCT FROM (a->'current_comparison_id',a->'comparison_revision',a->'decision_set_sha256');
 WHEN 'pf_revision_comparison_intents' THEN kind='geometry';why='COMPARISON_INTENT_CHANGED';changed=(b->'id',b->'state') IS DISTINCT FROM (a->'id',a->'state');
 ELSE RAISE EXCEPTION 'Unknown recalculation trigger';END CASE;
 IF TG_TABLE_NAME IN('pf_revision_comparison_targets','pf_revision_comparison_intents') THEN
 changed=changed AND EXISTS(SELECT 1 FROM pf_project_preparations p JOIN project_model_selections s USING(project_id) WHERE p.project_id=pid AND p.current_aggregate_id=COALESCE(a->>'target_aggregate_id',b->>'target_aggregate_id')::uuid AND s.active_model_version_id=COALESCE(a->>'target_model_version_id',b->>'target_model_version_id')::uuid);
 END IF;
 source_value=CASE TG_TABLE_NAME WHEN 'projects' THEN COALESCE(a,b)->>'pf_settings_revision'
 WHEN 'project_model_selections' THEN COALESCE(a,b)->>'selection_revision'
 WHEN 'model_versions' THEN (COALESCE(a,b)->>'id')||':'||(COALESCE(a,b)->>'state')||':'||(COALESCE(a,b)->>'health')
 WHEN 'pf_project_preparations' THEN (COALESCE(a,b)->>'geometry_revision')||':'||COALESCE(COALESCE(a,b)->>'current_aggregate_id','none')
 WHEN 'pf_purpose_project_state' THEN (COALESCE(a,b)->>'catalog_revision')||':'||(COALESCE(a,b)->>'routing_policy_revision')
 WHEN 'pf_project_state' THEN COALESCE(a,b)->>'registry_revision'
 WHEN 'pf_endpoint_binding_heads' THEN (COALESCE(a,b)->>'binding_revision')||':'||(COALESCE(a,b)->>'binding_id')
 WHEN 'pf_barrier_heads' THEN (COALESCE(a,b)->>'revision')||':'||COALESCE(COALESCE(a,b)->>'snapshot_id','none')
 WHEN 'pf_revision_comparison_targets' THEN (COALESCE(a,b)->>'comparison_revision')||':'||COALESCE(COALESCE(a,b)->>'current_comparison_id','none')
 WHEN 'pf_revision_comparison_intents' THEN (COALESCE(a,b)->>'id')||':'||(COALESCE(a,b)->>'state') END;
 IF changed THEN PERFORM pf_recalculation_dirty(pid,kind,why,source_value);END IF;RETURN COALESCE(NEW,OLD);END $$;
CREATE OR REPLACE FUNCTION pf_recalculation_cable_insert() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE pid uuid;BEGIN
 IF current_setting('wfc.pathfinder_apply',true)='1' THEN RETURN NULL;END IF;
 FOR pid IN SELECT DISTINCT project_id FROM pf_recalc_new ORDER BY project_id LOOP PERFORM pf_recalculation_dirty(pid,'cables','CABLE_INPUTS_CHANGED','tx:'||txid_current()::text);END LOOP;RETURN NULL;END $$;
CREATE OR REPLACE FUNCTION pf_recalculation_cable_delete() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE pid uuid;BEGIN
 FOR pid IN SELECT DISTINCT project_id FROM pf_recalc_old ORDER BY project_id LOOP PERFORM pf_recalculation_dirty(pid,'cables','CABLE_INPUTS_CHANGED','tx:'||txid_current()::text);END LOOP;RETURN NULL;END $$;
CREATE OR REPLACE FUNCTION pf_recalculation_cable_update() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE pid uuid;BEGIN
 IF current_setting('wfc.pathfinder_apply',true)='1' THEN RETURN NULL;END IF;
 FOR pid IN SELECT DISTINCT value FROM (SELECT n.project_id AS value FROM pf_recalc_new n JOIN pf_recalc_old o USING(id) WHERE (n.project_id,n.cable_write_revision) IS DISTINCT FROM (o.project_id,o.cable_write_revision) UNION SELECT o.project_id FROM pf_recalc_new n JOIN pf_recalc_old o USING(id) WHERE (n.project_id,n.cable_write_revision) IS DISTINCT FROM (o.project_id,o.cable_write_revision)) changed ORDER BY value LOOP PERFORM pf_recalculation_dirty(pid,'cables','CABLE_INPUTS_CHANGED','tx:'||txid_current()::text);END LOOP;RETURN NULL;END $$;
CREATE OR REPLACE FUNCTION pf_recalculation_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Use transactional DELETE so recalculation events are retained';END $$;
DROP TRIGGER IF EXISTS pf_recalculation_no_truncate ON cables;
CREATE TRIGGER pf_recalculation_no_truncate BEFORE TRUNCATE ON cables FOR EACH STATEMENT EXECUTE FUNCTION pf_recalculation_no_truncate();
DROP TRIGGER IF EXISTS pf_recalculation_cable_insert ON cables;
CREATE TRIGGER pf_recalculation_cable_insert AFTER INSERT ON cables REFERENCING NEW TABLE AS pf_recalc_new FOR EACH STATEMENT EXECUTE FUNCTION pf_recalculation_cable_insert();
DROP TRIGGER IF EXISTS pf_recalculation_cable_update ON cables;
CREATE TRIGGER pf_recalculation_cable_update AFTER UPDATE ON cables REFERENCING OLD TABLE AS pf_recalc_old NEW TABLE AS pf_recalc_new FOR EACH STATEMENT EXECUTE FUNCTION pf_recalculation_cable_update();
DROP TRIGGER IF EXISTS pf_recalculation_cable_delete ON cables;
CREATE TRIGGER pf_recalculation_cable_delete AFTER DELETE ON cables REFERENCING OLD TABLE AS pf_recalc_old FOR EACH STATEMENT EXECUTE FUNCTION pf_recalculation_cable_delete();
`;

const rowTables = ['projects','project_model_selections','model_versions','pf_project_preparations','pf_purpose_project_state','pf_project_state','pf_endpoint_binding_heads','pf_barrier_heads','pf_revision_comparison_targets','pf_revision_comparison_intents'] as const;
export async function initializeRecalculationSchema(pool: Pool): Promise<void> {
  const c = await pool.connect(); let discard = false, committing = false;
  try {
    await c.query('BEGIN'); await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-recalculation-schema-v1'))");
    await c.query('LOCK TABLE projects,cables IN SHARE ROW EXCLUSIVE MODE');
    await c.query(RECALCULATION_SQL);
    for (const table of rowTables) {
      await c.query(`DROP TRIGGER IF EXISTS pf_recalculation_row_event ON ${table}`);
      await c.query(`CREATE TRIGGER pf_recalculation_row_event AFTER ${table === 'projects' ? 'UPDATE' : 'INSERT OR UPDATE OR DELETE'} ON ${table} FOR EACH ROW EXECUTE FUNCTION pf_recalculation_row_event()`);
    }
    committing = true; await c.query('COMMIT');
  } catch (error) { discard = committing; try { await c.query('ROLLBACK'); } catch { discard = true; } throw error; }
  finally { c.release(discard ? true : undefined); }
}

export type RecalculationDirtyInput = { projectId: string; domain: 'model'|'geometry'|'routing'|'endpoints'|'settings'|'cables'|'engine'|'manual'|'preferences'|'barriers'; reason: string; sourceRevision?: string };
export async function markRecalculationDirty(client: PoolClient, input: RecalculationDirtyInput): Promise<void> {
  await client.query('SELECT pf_recalculation_dirty($1,$2,$3,$4)', [input.projectId,input.domain,input.reason,input.sourceRevision ?? null]);
}
/** Caller supplies the actual frozen computational identity; a startup is not itself a change. */
export async function markRecalculationEngineIdentity(client: PoolClient, projectId: string, identitySha256: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$(?![\s\S])/.test(identitySha256)) throw new Error('Invalid computational identity digest.');
  const changed = await client.query('UPDATE pf_recalculation_state SET engine_identity_sha256=$2,engine_unavailable_code=NULL WHERE project_id=$1 AND (engine_identity_sha256 IS DISTINCT FROM $2 OR engine_unavailable_code IS NOT NULL) RETURNING project_id', [projectId,identitySha256]);
  if (changed.rows.length) await markRecalculationDirty(client,{projectId,domain:'engine',reason:'ENGINE_IDENTITY_CHANGED',sourceRevision:identitySha256});
  return changed.rows.length > 0;
}

/** Same repeated observer refusal is visible but creates no generation/event storm. */
export async function markRecalculationEngineUnavailable(client: PoolClient, projectId: string, code: string): Promise<boolean> {
  if (!/^[A-Z][A-Z0-9_]{0,95}$(?![\s\S])/.test(code)) throw new Error('Invalid engine unavailability code.');
  const changed=await client.query('UPDATE pf_recalculation_state SET engine_unavailable_code=$2 WHERE project_id=$1 AND engine_unavailable_code IS DISTINCT FROM $2 RETURNING project_id',[projectId,code]);
  if(changed.rows.length){
    await markRecalculationDirty(client,{projectId,domain:'engine',reason:'ENGINE_UNAVAILABLE',sourceRevision:code});
    await client.query("UPDATE pf_recalculation_state SET status=CASE WHEN NOT enabled THEN 'disabled' WHEN paused THEN 'paused' ELSE 'blocked' END,reason_codes=$2 WHERE project_id=$1",[projectId,JSON.stringify([code])]);
  }
  return changed.rows.length>0;
}
