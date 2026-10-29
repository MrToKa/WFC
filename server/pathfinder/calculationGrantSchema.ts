import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {schedulerTransaction} from './schedulerTransaction.js';

/** Additive grants never create a human login or silently enable background work. */
export const CALCULATION_GRANT_SQL=`
ALTER TABLE users ADD COLUMN IF NOT EXISTS pf_admin_revision bigint NOT NULL DEFAULT 0 CHECK(pf_admin_revision>=0);
CREATE OR REPLACE FUNCTION own_pf_admin_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN NEW.pf_admin_revision:=0;ELSE NEW.pf_admin_revision:=OLD.pf_admin_revision;
 IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN NEW.pf_admin_revision:=OLD.pf_admin_revision+1;END IF;END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_admin_revision_owned ON users;
CREATE TRIGGER pf_admin_revision_owned BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION own_pf_admin_revision();
CREATE TABLE IF NOT EXISTS pf_installation_state(singleton boolean PRIMARY KEY CHECK(singleton),installation_epoch uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pf_calculation_grant_revisions(
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id uuid NOT NULL,grant_revision bigint NOT NULL CHECK(grant_revision>0),
 grant_epoch bigint NOT NULL CHECK(grant_epoch>0),installation_epoch uuid NOT NULL,issuer_id uuid NOT NULL,issuer_admin_revision bigint NOT NULL CHECK(issuer_admin_revision>=0),
 record_sha256 text NOT NULL CHECK(record_sha256~'^[a-f0-9]{64}$'),record jsonb NOT NULL CHECK(octet_length(record::text)<=65536),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,grant_revision),UNIQUE(project_id,id,grant_revision));
CREATE TABLE IF NOT EXISTS pf_calculation_grant_heads(
 project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,grant_id uuid,control_revision bigint NOT NULL DEFAULT 0 CHECK(control_revision>=0),
 grant_epoch bigint NOT NULL DEFAULT 0 CHECK(grant_epoch>=0),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,grant_id,control_revision) REFERENCES pf_calculation_grant_revisions(project_id,id,grant_revision),
 CHECK((grant_id IS NULL)=(control_revision=0)),CHECK((grant_id IS NULL)=(grant_epoch=0)));
INSERT INTO pf_calculation_grant_heads(project_id) SELECT id FROM projects ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION initialize_pf_calculation_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO pf_calculation_grant_heads(project_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS initialize_pf_calculation_grant ON projects;
CREATE TRIGGER initialize_pf_calculation_grant AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION initialize_pf_calculation_grant();
CREATE TABLE IF NOT EXISTS pf_calculation_grant_commands(
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,actor_id uuid NOT NULL,idempotency_key uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),request jsonb NOT NULL CHECK(octet_length(request::text)<=65536),
 receipt jsonb NOT NULL CHECK(octet_length(receipt::text)<=1048576),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,actor_id,idempotency_key));
CREATE TABLE IF NOT EXISTS pf_calculation_grant_leases(
 id uuid PRIMARY KEY,project_id uuid NOT NULL,grant_id uuid NOT NULL,grant_revision bigint NOT NULL,grant_epoch bigint NOT NULL,
 installation_epoch uuid NOT NULL,issuer_id uuid NOT NULL,issuer_admin_revision bigint NOT NULL CHECK(issuer_admin_revision>=0),
 operation text NOT NULL CHECK(operation IN('prepare','trace','compare','match-suggest','calculate')),
 model_version_id uuid NOT NULL,selection_revision bigint NOT NULL CHECK(selection_revision>=0),content_fingerprint text NOT NULL CHECK(content_fingerprint~'^[a-f0-9]{64}$'),
 owner_sha256 text NOT NULL CHECK(owner_sha256~'^[a-f0-9]{64}$'),state text NOT NULL CHECK(state IN('active','quarantined','released')),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,closed_at timestamptz,reason_code text,
 UNIQUE(project_id,id),FOREIGN KEY(project_id,grant_id,grant_revision) REFERENCES pf_calculation_grant_revisions(project_id,id,grant_revision),
 FOREIGN KEY(project_id,model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE,
 CHECK(created_at<expires_at AND expires_at<=created_at+interval '15 minutes'),CHECK((state='released')=(closed_at IS NOT NULL)),
 CHECK(reason_code IS NULL OR reason_code~'^[A-Z][A-Z0-9_]{0,95}$'));
-- Restored owners remain truthful audit rows; only the CURRENT installation can
-- authorize them. Never mark an unjoined source process released to free a slot.
DROP INDEX IF EXISTS pf_calculation_grant_one_global_lease;
DROP INDEX IF EXISTS pf_calculation_grant_one_project_lease;
CREATE UNIQUE INDEX IF NOT EXISTS pf_calculation_grant_one_installation_lease ON pf_calculation_grant_leases(installation_epoch) WHERE state IN('active','quarantined');
CREATE UNIQUE INDEX IF NOT EXISTS pf_calculation_grant_one_project_installation_lease ON pf_calculation_grant_leases(project_id,installation_epoch) WHERE state IN('active','quarantined');
CREATE OR REPLACE FUNCTION pf_calculation_grant_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Calculation grant audit is immutable';END $$;
DROP TRIGGER IF EXISTS pf_calculation_grant_revision_immutable ON pf_calculation_grant_revisions;
CREATE TRIGGER pf_calculation_grant_revision_immutable BEFORE UPDATE OR DELETE ON pf_calculation_grant_revisions FOR EACH ROW EXECUTE FUNCTION pf_calculation_grant_immutable();
DROP TRIGGER IF EXISTS pf_calculation_grant_command_immutable ON pf_calculation_grant_commands;
CREATE TRIGGER pf_calculation_grant_command_immutable BEFORE UPDATE OR DELETE ON pf_calculation_grant_commands FOR EACH ROW EXECUTE FUNCTION pf_calculation_grant_immutable();
CREATE OR REPLACE FUNCTION pf_calculation_grant_lease_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(OLD)-ARRAY['state','closed_at','reason_code']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['state','closed_at','reason_code'])
 OR OLD.state='released' OR OLD.state='quarantined' AND NEW.state NOT IN('quarantined','released')
 THEN RAISE EXCEPTION 'Calculation lease identity is immutable';END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS pf_calculation_grant_lease_identity ON pf_calculation_grant_leases;
CREATE TRIGGER pf_calculation_grant_lease_identity BEFORE UPDATE ON pf_calculation_grant_leases FOR EACH ROW EXECUTE FUNCTION pf_calculation_grant_lease_identity();
`;
export async function initializeCalculationGrantSchema(pool:Pool):Promise<void>{
  await schedulerTransaction(pool,async c=>{
    await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-calculation-grant-schema-v1'))");
    await c.query(CALCULATION_GRANT_SQL);
    await c.query('INSERT INTO pf_installation_state(singleton,installation_epoch) VALUES(true,$1) ON CONFLICT(singleton) DO NOTHING',[randomUUID()]);
  });
}
