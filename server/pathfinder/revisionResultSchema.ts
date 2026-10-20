import type { Pool } from 'pg';

export const REVISION_RESULT_SQL = `
CREATE TABLE IF NOT EXISTS pf_revision_admissions (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 job_id uuid, generation bigint CHECK(generation>=0), kind text NOT NULL CHECK(kind IN('manual','automatic')),
 input_sha256 text NOT NULL CHECK(input_sha256~'^[a-f0-9]{64}$'), options jsonb NOT NULL CHECK(octet_length(options::text)<=16384),
 model_ref jsonb CHECK(octet_length(model_ref::text)<=2048), total int NOT NULL CHECK(total BETWEEN 1 AND 10000),
 observed_events jsonb NOT NULL CHECK(jsonb_typeof(observed_events)='array' AND jsonb_array_length(observed_events)<=64),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id,id), UNIQUE(project_id,id,job_id),
 CHECK((kind='automatic' AND generation IS NOT NULL) OR (kind='manual' AND generation IS NULL AND job_id IS NOT NULL)),
 FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pf_revision_admission_job ON pf_revision_admissions(project_id,job_id) WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pf_revision_admission_generation ON pf_revision_admissions(project_id,generation) WHERE kind='automatic';
CREATE INDEX IF NOT EXISTS pf_revision_admission_page ON pf_revision_admissions(project_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS pf_revision_latest_accepted ON pf_apply_receipts(project_id,cable_id,applied_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS pf_revision_baselines (
 project_id uuid NOT NULL, admission_id uuid NOT NULL, cable_id uuid NOT NULL,
 baseline_sha256 text NOT NULL CHECK(baseline_sha256~'^[a-f0-9]{64}$'), baseline jsonb NOT NULL CHECK(octet_length(baseline::text)<=65536),
 status text NOT NULL CHECK(octet_length(status)<=96), message text NOT NULL CHECK(octet_length(message)<=131072),
 PRIMARY KEY(project_id,admission_id,cable_id), CHECK((baseline#>>'{currentCable,id}'=cable_id::text) IS TRUE),
 FOREIGN KEY(project_id,admission_id) REFERENCES pf_revision_admissions(project_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pf_revision_baseline_cable ON pf_revision_baselines(project_id,cable_id,admission_id);
CREATE UNIQUE INDEX IF NOT EXISTS pf_revision_proposal_identity ON pf_proposals(project_id,job_id,cable_id,id);
CREATE TABLE IF NOT EXISTS pf_revision_results (
 id uuid PRIMARY KEY, project_id uuid NOT NULL, admission_id uuid NOT NULL, job_id uuid NOT NULL, cable_id uuid NOT NULL, proposal_id uuid NOT NULL,
 baseline_sha256 text NOT NULL CHECK(baseline_sha256~'^[a-f0-9]{64}$'), dependency_sha256 text NOT NULL CHECK(dependency_sha256~'^[a-f0-9]{64}$'),
 engine_result_sha256 text NOT NULL CHECK(engine_result_sha256~'^[a-f0-9]{64}$'), ledger_sha256 text CHECK(ledger_sha256~'^[a-f0-9]{64}$'),
 record_sha256 text NOT NULL CHECK(record_sha256~'^[a-f0-9]{64}$'), record jsonb NOT NULL CHECK(octet_length(record::text)<=131072),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id,id), UNIQUE(project_id,proposal_id), UNIQUE(project_id,job_id,cable_id),
 FOREIGN KEY(project_id,admission_id,job_id) REFERENCES pf_revision_admissions(project_id,id,job_id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,admission_id,cable_id) REFERENCES pf_revision_baselines(project_id,admission_id,cable_id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,job_id,cable_id,proposal_id) REFERENCES pf_proposals(project_id,job_id,cable_id,id) ON DELETE CASCADE,
 CHECK((record->>'projectId'=project_id::text AND record->>'admissionId'=admission_id::text AND record->>'jobId'=job_id::text
   AND record->>'cableId'=cable_id::text AND record->>'proposalId'=proposal_id::text AND record->>'baselineHash'=baseline_sha256
   AND record->>'dependencyHash'=dependency_sha256 AND record->>'engineResultSha256'=engine_result_sha256
   AND record->>'revisionResultSha256'=record_sha256 AND (record->>'ledgerHash') IS NOT DISTINCT FROM ledger_sha256) IS TRUE)
);
CREATE OR REPLACE FUNCTION pf_revision_result_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Cable revision admission, baseline and result are immutable'; END $$;
`;
export async function initializeRevisionResultSchema(pool: Pool): Promise<void> {
  const client = await pool.connect(); let commitStarted = false, discard = false;
  try {
    await client.query('BEGIN'); await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-revision-results-schema-v1'))");
    await client.query(REVISION_RESULT_SQL);
    for (const table of ['pf_revision_admissions', 'pf_revision_baselines', 'pf_revision_results']) {
      await client.query(`DROP TRIGGER IF EXISTS pf_revision_result_immutable ON ${table}`);
      await client.query(`CREATE TRIGGER pf_revision_result_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION pf_revision_result_immutable()`);
    }
    commitStarted = true; await client.query('COMMIT');
  } catch (error) { discard = commitStarted; try { await client.query('ROLLBACK'); } catch { discard = true; } throw error; }
  finally { client.release(discard ? true : undefined); }
}
