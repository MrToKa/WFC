import type { Pool } from 'pg';
import { schedulerTransaction } from './schedulerTransaction.js';

/** A separate finite capture capability; no human users, logins or raw owner secrets. */
export const PRODUCER_RESOURCE_SQL = `
CREATE TABLE IF NOT EXISTS pf_producer_resource_sessions (
 id uuid PRIMARY KEY,project_id uuid NOT NULL,model_version_id uuid NOT NULL,load_id uuid NOT NULL,
 lease_id uuid NOT NULL UNIQUE,installation_epoch uuid NOT NULL,selection_revision bigint NOT NULL CHECK(selection_revision>=0),
 content_fingerprint text NOT NULL CHECK(content_fingerprint~'^[a-f0-9]{64}$'),
 capability_sha256 text NOT NULL CHECK(capability_sha256~'^[a-f0-9]{64}$'),
 grant_ref jsonb NOT NULL CHECK(octet_length(grant_ref::text)<=65536),
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz,
 FOREIGN KEY(project_id,model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,lease_id) REFERENCES pf_calculation_grant_leases(project_id,id) ON DELETE CASCADE,
 CHECK(created_at<expires_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE INDEX IF NOT EXISTS pf_producer_resource_project ON pf_producer_resource_sessions(project_id);
CREATE OR REPLACE FUNCTION pf_producer_resource_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(OLD)-'revoked_at') IS DISTINCT FROM (to_jsonb(NEW)-'revoked_at') OR OLD.revoked_at IS NOT NULL
 THEN RAISE EXCEPTION 'Producer resource identity is immutable'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS pf_producer_resource_identity ON pf_producer_resource_sessions;
CREATE TRIGGER pf_producer_resource_identity BEFORE UPDATE ON pf_producer_resource_sessions FOR EACH ROW EXECUTE FUNCTION pf_producer_resource_identity();
`;
export async function initializeProducerResourceSchema(pool: Pool): Promise<void> {
  await schedulerTransaction(pool, async c => { await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-producer-resource-schema-v1'))"); await c.query(PRODUCER_RESOURCE_SQL); });
}
