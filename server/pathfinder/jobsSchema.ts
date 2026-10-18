import type { Pool } from 'pg';

export async function initializePathFinderJobs(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-jobs-schema-v1'))");
    await client.query(`
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS pf_settings_revision BIGINT NOT NULL DEFAULT 0 CHECK(pf_settings_revision >= 0);
      CREATE OR REPLACE FUNCTION own_pf_settings_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        NEW.pf_settings_revision := OLD.pf_settings_revision;
        IF ROW(NEW.secondary_tray_length,NEW.end_connection_length,NEW.additional_bending_percent)
          IS DISTINCT FROM ROW(OLD.secondary_tray_length,OLD.end_connection_length,OLD.additional_bending_percent)
        THEN NEW.pf_settings_revision := OLD.pf_settings_revision + 1; END IF; RETURN NEW;
      END $$;
      DROP TRIGGER IF EXISTS pf_settings_revision_owned ON projects;
      CREATE TRIGGER pf_settings_revision_owned BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION own_pf_settings_revision();
      CREATE TABLE IF NOT EXISTS pf_jobs (
        id UUID PRIMARY KEY, project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, requested_by UUID NOT NULL,
        login_id UUID NOT NULL, login_expires_at TIMESTAMPTZ NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','running','complete','cancelled','failed')),
        total INTEGER NOT NULL CHECK(total BETWEEN 1 AND 10000),completed INTEGER NOT NULL DEFAULT 0 CHECK(completed >= 0),
        cancel_requested BOOLEAN NOT NULL DEFAULT FALSE, owner_token UUID, lease_until TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0,
        options JSONB NOT NULL,timeout_ms INTEGER NOT NULL CHECK(timeout_ms BETWEEN 100 AND 120000), failure TEXT,request_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(project_id,id)
      );
      CREATE TABLE IF NOT EXISTS pf_job_items (
        project_id UUID NOT NULL,job_id UUID NOT NULL,cable_id UUID NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('waiting','running','complete','blocked')),dependencies JSONB,status TEXT NOT NULL,message TEXT NOT NULL,
        PRIMARY KEY(project_id,job_id,cable_id),FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE,
        FOREIGN KEY(project_id,cable_id) REFERENCES cables(project_id,id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS pf_proposals (
        id UUID PRIMARY KEY,project_id UUID NOT NULL,job_id UUID NOT NULL,cable_id UUID NOT NULL,
        status TEXT NOT NULL,dependencies JSONB NOT NULL,dependency_hash TEXT NOT NULL,geometry_hash TEXT NOT NULL,
        result JSONB NOT NULL,proposal_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(project_id,id),UNIQUE(project_id,job_id,cable_id),
        FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE,FOREIGN KEY(project_id,cable_id) REFERENCES cables(project_id,id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS pf_jobs_claim ON pf_jobs(state,lease_until,created_at);
      ALTER TABLE pf_jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'calculate' CHECK(kind IN ('calculate','lookup'));
      ALTER TABLE pf_jobs ADD COLUMN IF NOT EXISTS diagnostic_input JSONB;
      CREATE TABLE IF NOT EXISTS pf_lookup_results (
        project_id UUID NOT NULL,job_id UUID NOT NULL,dependencies JSONB NOT NULL,result JSONB NOT NULL,stale_at_completion BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(project_id,job_id),
        FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS pf_proposals_cable ON pf_proposals(project_id,cable_id,created_at DESC,id);
      CREATE TABLE IF NOT EXISTS pf_synthetic_projects (
        project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        fixture_id TEXT NOT NULL CHECK(fixture_id='pf-local-straight-v1'),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS pf_synthetic_proofs (
        project_id UUID NOT NULL,artifact_id UUID NOT NULL,fixture_id TEXT NOT NULL CHECK(fixture_id='pf-local-straight-v1'),
        snapshot_sha256 TEXT NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
        seeded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(project_id,artifact_id),
        FOREIGN KEY(project_id,artifact_id) REFERENCES pf_artifacts(project_id,id) ON DELETE CASCADE,
        FOREIGN KEY(project_id) REFERENCES pf_synthetic_projects(project_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS pf_reviews (
        id UUID PRIMARY KEY,project_id UUID NOT NULL,proposal_id UUID NOT NULL,actor_id UUID NOT NULL,proposal_hash TEXT NOT NULL,
        reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(project_id,id),
        FOREIGN KEY(project_id,proposal_id) REFERENCES pf_proposals(project_id,id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS pf_apply_receipts (
        id UUID PRIMARY KEY,project_id UUID NOT NULL,actor_id UUID NOT NULL,idempotency_key UUID NOT NULL,payload_hash TEXT NOT NULL,
        proposal_id UUID NOT NULL,cable_id UUID NOT NULL,before_snapshot JSONB NOT NULL,after_snapshot JSONB NOT NULL,provenance JSONB NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(project_id,actor_id,idempotency_key),
        FOREIGN KEY(project_id,proposal_id) REFERENCES pf_proposals(project_id,id) ON DELETE CASCADE,FOREIGN KEY(project_id,cable_id) REFERENCES cables(project_id,id) ON DELETE CASCADE
      );
      CREATE OR REPLACE FUNCTION protect_pf_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'PathFinder immutable record cannot be updated'; END $$;
      DROP TRIGGER IF EXISTS pf_artifact_immutable ON pf_artifacts;
      CREATE TRIGGER pf_artifact_immutable BEFORE UPDATE ON pf_artifacts FOR EACH ROW EXECUTE FUNCTION protect_pf_immutable_record();
      DROP TRIGGER IF EXISTS pf_proposal_immutable ON pf_proposals;
      CREATE TRIGGER pf_proposal_immutable BEFORE UPDATE ON pf_proposals FOR EACH ROW EXECUTE FUNCTION protect_pf_immutable_record();
      DROP TRIGGER IF EXISTS pf_proof_immutable ON pf_synthetic_proofs;
      CREATE TRIGGER pf_proof_immutable BEFORE UPDATE ON pf_synthetic_proofs FOR EACH ROW EXECUTE FUNCTION protect_pf_immutable_record();
      DROP TRIGGER IF EXISTS pf_synthetic_project_immutable ON pf_synthetic_projects;
      CREATE TRIGGER pf_synthetic_project_immutable BEFORE UPDATE ON pf_synthetic_projects FOR EACH ROW EXECUTE FUNCTION protect_pf_immutable_record();
      DROP TRIGGER IF EXISTS pf_receipt_immutable ON pf_apply_receipts;
      CREATE TRIGGER pf_receipt_immutable BEFORE UPDATE ON pf_apply_receipts FOR EACH ROW EXECUTE FUNCTION protect_pf_immutable_record();
      DROP TRIGGER IF EXISTS pf_review_immutable ON pf_reviews;
      CREATE TRIGGER pf_review_immutable BEFORE UPDATE ON pf_reviews FOR EACH ROW EXECUTE FUNCTION protect_pf_immutable_record();
      DROP TRIGGER IF EXISTS pf_lookup_immutable ON pf_lookup_results;
      CREATE TRIGGER pf_lookup_immutable BEFORE UPDATE ON pf_lookup_results FOR EACH ROW EXECUTE FUNCTION protect_pf_immutable_record();
      ALTER TABLE cable_versions DROP CONSTRAINT IF EXISTS cable_versions_change_source_check;
      ALTER TABLE cable_versions ADD CONSTRAINT cable_versions_change_source_check CHECK(change_source IN ('manual','import','pathfinder'));
    `); await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK').catch(() => undefined); throw error;} finally {client.release();}
}
