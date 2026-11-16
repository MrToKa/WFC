import type { Pool } from 'pg';
import { schedulerTransaction } from './schedulerTransaction.js';
import { repairAutomaticRoutingMigrationControls } from './automaticRoutingMigrationRepair.js';

export const CABLE_ROUTING_CONTROL_SQL = `
CREATE TABLE IF NOT EXISTS pf_cable_routing_controls(
 project_id uuid NOT NULL,cable_id uuid NOT NULL,revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 manual_revision bigint NOT NULL DEFAULT 1 CHECK(manual_revision>0),
 manual_routing text CHECK(octet_length(manual_routing)<=65536),manual_protected boolean NOT NULL DEFAULT false,
 execution_locked boolean NOT NULL DEFAULT false,execution_routing text CHECK(octet_length(execution_routing)<=65536),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(project_id,cable_id),FOREIGN KEY(project_id,cable_id) REFERENCES cables(project_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS pf_cable_routing_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,project_id uuid NOT NULL,cable_id uuid NOT NULL,
 actor_id uuid,reason text NOT NULL,control_revision bigint NOT NULL,record jsonb NOT NULL CHECK(octet_length(record::text)<=524288),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(project_id,cable_id) REFERENCES pf_cable_routing_controls(project_id,cable_id) ON DELETE CASCADE);
ALTER TABLE pf_cable_routing_events DROP CONSTRAINT IF EXISTS pf_cable_routing_events_record_check;
ALTER TABLE pf_cable_routing_events ADD CONSTRAINT pf_cable_routing_events_record_check CHECK(octet_length(record::text)<=524288);
ALTER TABLE pf_cable_routing_controls ADD COLUMN IF NOT EXISTS manual_revision bigint NOT NULL DEFAULT 1 CHECK(manual_revision>0);
CREATE TABLE IF NOT EXISTS pf_manual_route_jobs(
 project_id uuid NOT NULL,cable_id uuid NOT NULL,manual_revision bigint NOT NULL CHECK(manual_revision>0),
 actor_id uuid,login_id uuid,login_expires_at timestamptz,
 generation bigint NOT NULL DEFAULT 1,owner_token uuid,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),automatic_authority jsonb,
 authority_admin_revision bigint,authority_installation_epoch uuid,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','running','stale','calculated','invalid')),
 length_metres integer CHECK(length_metres BETWEEN 0 AND 1000000),diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(project_id,cable_id),FOREIGN KEY(project_id,cable_id) REFERENCES pf_cable_routing_controls(project_id,cable_id) ON DELETE CASCADE);
-- The conflict clause is the one-time migration marker for each existing cable.
-- Subsequent starts never turn a future automatic result into a manual route.
INSERT INTO pf_cable_routing_controls(project_id,cable_id,manual_routing,manual_protected,execution_locked,execution_routing)
 SELECT project_id,id,NULLIF(btrim(routing),''),NULLIF(btrim(routing),'') IS NOT NULL,
 (coalesce(install_length,0)>0 OR pull_date IS NOT NULL OR connected_from IS NOT NULL OR connected_to IS NOT NULL OR tested IS NOT NULL),
 CASE WHEN coalesce(install_length,0)>0 OR pull_date IS NOT NULL OR connected_from IS NOT NULL OR connected_to IS NOT NULL OR tested IS NOT NULL THEN routing ELSE NULL END
 FROM cables ON CONFLICT(project_id,cable_id) DO NOTHING
 RETURNING project_id,cable_id,manual_protected,execution_locked,'routing-control-bootstrap.v1' AS migration_kind;
INSERT INTO pf_manual_route_jobs(project_id,cable_id,manual_revision)
 SELECT project_id,cable_id,manual_revision FROM pf_cable_routing_controls WHERE manual_routing IS NOT NULL
 ON CONFLICT(project_id,cable_id) DO NOTHING;
CREATE OR REPLACE FUNCTION pf_cable_routing_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO pf_cable_routing_controls(project_id,cable_id,manual_routing,manual_protected,execution_locked,execution_routing)
 VALUES(NEW.project_id,NEW.id,NULLIF(btrim(NEW.routing),''),NULLIF(btrim(NEW.routing),'') IS NOT NULL,
 coalesce(NEW.install_length,0)>0 OR NEW.pull_date IS NOT NULL OR NEW.connected_from IS NOT NULL OR NEW.connected_to IS NOT NULL OR NEW.tested IS NOT NULL,
 CASE WHEN coalesce(NEW.install_length,0)>0 OR NEW.pull_date IS NOT NULL OR NEW.connected_from IS NOT NULL OR NEW.connected_to IS NOT NULL OR NEW.tested IS NOT NULL THEN NEW.routing ELSE NULL END)
 ON CONFLICT DO NOTHING; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS pf_cable_routing_insert ON cables;
CREATE TRIGGER pf_cable_routing_insert AFTER INSERT ON cables FOR EACH ROW EXECUTE FUNCTION pf_cable_routing_insert();
CREATE OR REPLACE FUNCTION pf_cable_routing_execution_fence() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE locked boolean; BEGIN
 SELECT execution_locked INTO locked FROM pf_cable_routing_controls WHERE project_id=OLD.project_id AND cable_id=OLD.id;
 IF (coalesce(locked,false) OR coalesce(OLD.install_length,0)>0 OR OLD.pull_date IS NOT NULL OR OLD.connected_from IS NOT NULL OR OLD.connected_to IS NOT NULL OR OLD.tested IS NOT NULL)
 AND NEW.routing IS DISTINCT FROM OLD.routing THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ROUTING_EXECUTION_PROTECTED'; END IF;
 RETURN NEW; END $$;
DROP TRIGGER IF EXISTS pf_cable_routing_execution_fence ON cables;
CREATE TRIGGER pf_cable_routing_execution_fence BEFORE UPDATE ON cables FOR EACH ROW EXECUTE FUNCTION pf_cable_routing_execution_fence();
CREATE OR REPLACE FUNCTION pf_cable_routing_execution_latch() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE previous_record jsonb;latched_revision bigint; BEGIN
 IF coalesce(NEW.install_length,0)>0 OR NEW.pull_date IS NOT NULL OR NEW.connected_from IS NOT NULL OR NEW.connected_to IS NOT NULL OR NEW.tested IS NOT NULL THEN
  SELECT jsonb_build_object('manualRouting',manual_routing,'manualProtected',manual_protected,'executionLocked',execution_locked,'executionRouting',execution_routing)
  INTO previous_record FROM pf_cable_routing_controls WHERE project_id=NEW.project_id AND cable_id=NEW.id AND NOT execution_locked;
  UPDATE pf_cable_routing_controls SET execution_locked=true,execution_routing=NEW.routing,revision=revision+1,updated_at=clock_timestamp()
  WHERE project_id=NEW.project_id AND cable_id=NEW.id AND NOT execution_locked RETURNING revision INTO latched_revision;
  IF latched_revision IS NOT NULL THEN
   INSERT INTO pf_cable_routing_events(project_id,cable_id,reason,control_revision,record) VALUES(NEW.project_id,NEW.id,'Execution facts recorded',latched_revision,
    jsonb_build_object('before',previous_record,'after',previous_record||jsonb_build_object('executionLocked',true,'executionRouting',NEW.routing)));
  END IF;
 END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS pf_cable_routing_execution_latch ON cables;
CREATE TRIGGER pf_cable_routing_execution_latch AFTER UPDATE ON cables FOR EACH ROW EXECUTE FUNCTION pf_cable_routing_execution_latch();
`;
export async function initializeCableRoutingControlSchema(pool: Pool) {
  await schedulerTransaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-cable-routing-control-schema-v1'))");
    const migration = await client.query(CABLE_ROUTING_CONTROL_SQL);
    // Only controls created by this bootstrap are candidates here. Existing
    // controls require an explicitly scoped repair; restarts never reclassify them.
    const results = Array.isArray(migration) ? migration : [migration];
    const fresh = results.flatMap(result => result.rows).filter(row => row.migration_kind === 'routing-control-bootstrap.v1'
      && row.manual_protected === true && row.execution_locked === false) as { project_id: string; cable_id: string }[];
    if (fresh.length > 10000) throw new Error('Automatic routing bootstrap repair exceeds its bounded scope.');
    const byProject = new Map<string, string[]>();
    for (const row of fresh) byProject.set(row.project_id, [...(byProject.get(row.project_id) ?? []), row.cable_id]);
    const repairDeadline = Date.now() + 30000;
    const check = () => { if (Date.now() >= repairDeadline) throw new Error('Automatic routing bootstrap repair deadline exceeded.'); };
    for (const [projectId, cableIds] of byProject) {
      for (let start = 0; start < cableIds.length; start += 500)
        await repairAutomaticRoutingMigrationControls(client, { projectId, cableIds: cableIds.slice(start, start + 500), dryRun: false }, check);
    }
  });
}
