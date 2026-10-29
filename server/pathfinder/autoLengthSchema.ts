import type { Pool } from 'pg';

/** Install AFTER revisionResultSchema. No backfill: existing jobs and estimates
 * never acquire a new Auto value or a newer admission order during migration. */
export const AUTO_LENGTH_SQL = `
CREATE TABLE IF NOT EXISTS pf_auto_length_admissions (
 ordinal bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY CHECK(ordinal > 0),
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 admission_id uuid NOT NULL, job_id uuid,
 target_count int NOT NULL CHECK(target_count BETWEEN 1 AND 10000),
 targets_sha256 text NOT NULL CHECK(targets_sha256~'^[a-f0-9]{64}$'),
 registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(project_id,admission_id), UNIQUE(project_id,ordinal),
 FOREIGN KEY(project_id,admission_id) REFERENCES pf_revision_admissions(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS pf_auto_length_admission_job ON pf_auto_length_admissions(project_id,job_id) WHERE job_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS pf_auto_length_targets (
 project_id uuid NOT NULL, cable_id uuid NOT NULL, admission_ordinal bigint NOT NULL CHECK(admission_ordinal>0),
 PRIMARY KEY(project_id,cable_id),
 FOREIGN KEY(project_id,cable_id) REFERENCES cables(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,admission_ordinal) REFERENCES pf_auto_length_admissions(project_id,ordinal) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pf_auto_length_targets_admission ON pf_auto_length_targets(project_id,admission_ordinal,cable_id);
CREATE TABLE IF NOT EXISTS pf_auto_lengths (
 project_id uuid NOT NULL, cable_id uuid NOT NULL, admission_ordinal bigint NOT NULL CHECK(admission_ordinal>0),
 proposal_id uuid NOT NULL,
 length_text text NOT NULL CHECK(octet_length(length_text)<=100 AND length_text~'^(0|[1-9][0-9]{0,6})([.]0+)?$'
   AND length_text::numeric BETWEEN 0 AND 1000000),
 source jsonb NOT NULL CHECK(octet_length(source::text)<=16384),
 source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),
 PRIMARY KEY(project_id,cable_id), UNIQUE(project_id,proposal_id),
 FOREIGN KEY(project_id,cable_id) REFERENCES cables(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,admission_ordinal) REFERENCES pf_auto_length_admissions(project_id,ordinal) ON DELETE CASCADE,
 FOREIGN KEY(project_id,proposal_id) REFERENCES pf_revision_results(project_id,proposal_id) ON DELETE CASCADE,
 CHECK((source->>'projectId'=project_id::text AND source->>'cableId'=cable_id::text
   AND source->>'admissionOrdinal'=admission_ordinal::text AND source->>'proposalId'=proposal_id::text
   AND source->>'lengthMetersText'=length_text) IS TRUE)
);
CREATE OR REPLACE FUNCTION pf_auto_length_admission_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Auto length admission order is immutable'; END $$;
DROP TRIGGER IF EXISTS pf_auto_length_admission_immutable ON pf_auto_length_admissions;
CREATE TRIGGER pf_auto_length_admission_immutable BEFORE UPDATE OR DELETE ON pf_auto_length_admissions
 FOR EACH ROW EXECUTE FUNCTION pf_auto_length_admission_immutable();
`;
export async function initializeAutoLengthSchema(pool: Pick<Pool, 'query'>): Promise<void> {
  await pool.query(AUTO_LENGTH_SQL);
}
