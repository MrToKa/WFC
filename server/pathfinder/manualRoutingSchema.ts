import type { Pool } from 'pg';
import { schedulerTransaction } from './schedulerTransaction.js';

export const MANUAL_ROUTING_SQL = `
ALTER TABLE pf_manual_route_jobs ADD COLUMN IF NOT EXISTS generation bigint NOT NULL DEFAULT 1;
ALTER TABLE pf_manual_route_jobs ADD COLUMN IF NOT EXISTS owner_token uuid;
ALTER TABLE pf_manual_route_jobs ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE pf_manual_route_jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE pf_manual_route_jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE pf_manual_route_jobs ADD COLUMN IF NOT EXISTS input_sha256 text;
ALTER TABLE pf_manual_route_jobs ADD COLUMN IF NOT EXISTS result_id uuid;
ALTER TABLE pf_manual_route_jobs ADD COLUMN IF NOT EXISTS automatic_authority jsonb;
ALTER TABLE pf_manual_route_jobs ADD COLUMN IF NOT EXISTS authority_admin_revision bigint;
ALTER TABLE pf_manual_route_jobs ADD COLUMN IF NOT EXISTS authority_installation_epoch uuid;
CREATE TABLE IF NOT EXISTS pf_manual_route_results(
 id uuid PRIMARY KEY,project_id uuid NOT NULL,cable_id uuid NOT NULL,manual_revision bigint NOT NULL,generation bigint NOT NULL,
 actor_id uuid NOT NULL,login_id uuid NOT NULL,input_sha256 text NOT NULL,record_sha256 text NOT NULL,
 projection jsonb CHECK(octet_length(projection::text)<=8192),projection_sha256 text,
 record jsonb NOT NULL CHECK(octet_length(record::text)<=4194304),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(project_id,cable_id) REFERENCES pf_cable_routing_controls(project_id,cable_id) ON DELETE CASCADE);
ALTER TABLE pf_manual_route_results ADD COLUMN IF NOT EXISTS projection jsonb CHECK(octet_length(projection::text)<=8192);
ALTER TABLE pf_manual_route_results ADD COLUMN IF NOT EXISTS projection_sha256 text;
CREATE OR REPLACE FUNCTION pf_manual_route_result_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM cables WHERE project_id=OLD.project_id AND id=OLD.cable_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Manual routing result is immutable'; END $$;
DROP TRIGGER IF EXISTS pf_manual_route_result_immutable ON pf_manual_route_results;
CREATE TRIGGER pf_manual_route_result_immutable BEFORE UPDATE OR DELETE ON pf_manual_route_results FOR EACH ROW EXECUTE FUNCTION pf_manual_route_result_immutable();
CREATE OR REPLACE FUNCTION pf_manual_route_invalidate(pid uuid,cid uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 UPDATE pf_manual_route_jobs SET generation=generation+1,state=CASE WHEN length_metres IS NULL THEN 'pending' ELSE 'stale' END,
  owner_token=NULL,lease_until=NULL,attempts=0,next_attempt_at=clock_timestamp()+interval '500 milliseconds',
  diagnostics='["MANUAL_ROUTE_INPUTS_CHANGED"]'::jsonb,updated_at=clock_timestamp()
 WHERE project_id=pid AND (cid IS NULL OR cable_id=cid); END $$;
CREATE OR REPLACE FUNCTION pf_manual_route_global_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.reason='CABLE_TYPE_PURPOSE_CHANGED' THEN
  UPDATE pf_manual_route_jobs j SET generation=generation+1,state=CASE WHEN length_metres IS NULL THEN 'pending' ELSE 'stale' END,
   owner_token=NULL,lease_until=NULL,attempts=0,next_attempt_at=clock_timestamp()+interval '500 milliseconds',diagnostics='["MANUAL_ROUTE_PURPOSE_CHANGED"]'::jsonb
  FROM cables c WHERE j.project_id=NEW.project_id AND c.project_id=j.project_id AND c.id=j.cable_id AND c.cable_type_id::text=NEW.source_revision;
 ELSIF NEW.domain IN('model','geometry','routing','settings','barriers','engine','endpoints','preferences') AND NEW.reason<>'ENDPOINT_BINDING_CHANGED'
 THEN PERFORM pf_manual_route_invalidate(NEW.project_id);END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_manual_route_global_event ON pf_recalculation_events;
CREATE TRIGGER pf_manual_route_global_event AFTER INSERT ON pf_recalculation_events FOR EACH ROW EXECUTE FUNCTION pf_manual_route_global_event();
CREATE OR REPLACE FUNCTION pf_manual_route_cable_inputs() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.from_location,NEW.to_location,NEW.cable_type_id,NEW.mto) IS DISTINCT FROM (OLD.from_location,OLD.to_location,OLD.cable_type_id,OLD.mto)
 THEN PERFORM pf_manual_route_invalidate(NEW.project_id,NEW.id);END IF; RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_manual_route_cable_inputs ON cables;
CREATE TRIGGER pf_manual_route_cable_inputs AFTER UPDATE ON cables FOR EACH ROW EXECUTE FUNCTION pf_manual_route_cable_inputs();
CREATE OR REPLACE FUNCTION pf_manual_route_binding_inputs() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE pid uuid;lid uuid;BEGIN
 pid=COALESCE(NEW.project_id,OLD.project_id);lid=COALESCE(NEW.location_id,OLD.location_id);
 UPDATE pf_manual_route_jobs j SET generation=generation+1,state=CASE WHEN length_metres IS NULL THEN 'pending' ELSE 'stale' END,
 owner_token=NULL,lease_until=NULL,attempts=0,next_attempt_at=clock_timestamp()+interval '500 milliseconds',
 diagnostics='["MANUAL_ROUTE_ENDPOINT_CHANGED"]'::jsonb,updated_at=clock_timestamp()
 FROM cables c WHERE j.project_id=pid AND c.project_id=j.project_id AND c.id=j.cable_id AND EXISTS(
 SELECT 1 FROM pf_location_aliases a WHERE a.project_id=pid AND a.location_id=lid AND
 (a.normalized_alias=normalize(upper(btrim(c.from_location)),NFC) OR a.normalized_alias=normalize(upper(btrim(c.to_location)),NFC)))
 OR j.project_id=pid AND c.project_id=j.project_id AND c.id=j.cable_id AND (c.from_location ~ '[^ -~]' OR c.to_location ~ '[^ -~]');
 RETURN COALESCE(NEW,OLD);END $$;
DROP TRIGGER IF EXISTS pf_manual_route_binding_inputs ON pf_endpoint_binding_heads;
CREATE TRIGGER pf_manual_route_binding_inputs AFTER INSERT OR UPDATE OR DELETE ON pf_endpoint_binding_heads FOR EACH ROW EXECUTE FUNCTION pf_manual_route_binding_inputs();
CREATE OR REPLACE FUNCTION pf_manual_route_tray_inputs() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'UPDATE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN PERFORM pf_manual_route_invalidate(COALESCE(NEW.project_id,OLD.project_id));END IF;
 RETURN COALESCE(NEW,OLD);END $$;
DROP TRIGGER IF EXISTS pf_manual_route_tray_inputs ON trays;
CREATE TRIGGER pf_manual_route_tray_inputs AFTER INSERT OR UPDATE OR DELETE ON trays FOR EACH ROW EXECUTE FUNCTION pf_manual_route_tray_inputs();
-- A protection-only release can leave the business pair unchanged. Retain its
-- new policy generation even then; the normal scheduler still respects OFF.
CREATE OR REPLACE FUNCTION pf_manual_route_control_changed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT NEW.manual_protected AND NOT NEW.execution_locked AND
 (OLD.manual_protected,OLD.execution_locked,OLD.manual_routing,OLD.execution_routing) IS DISTINCT FROM
 (NEW.manual_protected,NEW.execution_locked,NEW.manual_routing,NEW.execution_routing)
 THEN PERFORM pf_recalculation_dirty(NEW.project_id,'manual','ROUTING_CONTROL_CHANGED',NEW.revision::text);END IF;
 RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_manual_route_control_changed ON pf_cable_routing_controls;
CREATE TRIGGER pf_manual_route_control_changed AFTER UPDATE ON pf_cable_routing_controls FOR EACH ROW EXECUTE FUNCTION pf_manual_route_control_changed();
`;
export async function initializeManualRoutingSchema(pool: Pool) {
  await schedulerTransaction(pool,async client=>{await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-manual-routing-schema-v1'))");await client.query(MANUAL_ROUTING_SQL);});
}
