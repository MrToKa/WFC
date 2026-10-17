import type { Pool } from 'pg';

/** Startup-only schema installation; no cloud or object-storage work. */
export async function initializeModelRegistry(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-model-registry-schema-v1'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS model_package_identities (
        package_id UUID PRIMARY KEY,
        content_fingerprint TEXT NOT NULL CHECK (content_fingerprint ~ '^[0-9a-f]{64}$'),
        support_profile TEXT NOT NULL CHECK (support_profile = 'svf-local-7.130.0-v1'),
        source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
        source_bytes BIGINT NOT NULL CHECK (source_bytes >= 0),
        source_identity_basis TEXT NOT NULL CHECK (source_identity_basis IN ('observed-local-file','captured-at-conversion'))
      );
      CREATE TABLE IF NOT EXISTS model_validation_reports (
        id UUID PRIMARY KEY,
        report JSONB NOT NULL,
        storage_readback JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS model_import_jobs (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        requested_by UUID NOT NULL,
        idempotency_key UUID NOT NULL,
        archive_sha256 TEXT NOT NULL CHECK (archive_sha256 ~ '^[0-9a-f]{64}$'),
        expected_bytes BIGINT CHECK (expected_bytes >= 0 AND expected_bytes <= 2147483648),
        owner_token UUID NOT NULL,
        received_bytes BIGINT NOT NULL DEFAULT 0 CHECK (received_bytes >= 0 AND received_bytes <= 2147483648),
        state TEXT NOT NULL CHECK (state IN ('receiving','staging','validating','publishing','complete','failed')),
        model_version_id UUID,
        failure JSONB,
        verification_report JSONB,
        duplicate BOOLEAN NOT NULL DEFAULT FALSE,
        cleaned_at TIMESTAMPTZ,
        staging_cleaned_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (project_id, requested_by, idempotency_key),
        UNIQUE (project_id, id),
        CHECK ((state = 'failed') = (failure IS NOT NULL)),
        CHECK (state <> 'complete' OR model_version_id IS NOT NULL),
        CHECK (expected_bytes IS NULL OR received_bytes <= expected_bytes)
      );
      CREATE TABLE IF NOT EXISTS model_versions (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        package_id UUID NOT NULL REFERENCES model_package_identities(package_id),
        content_fingerprint TEXT NOT NULL CHECK (content_fingerprint ~ '^[0-9a-f]{64}$'),
        label TEXT NOT NULL,
        source JSONB NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        support_profile TEXT NOT NULL CHECK (support_profile = 'svf-local-7.130.0-v1'),
        format TEXT NOT NULL CHECK (format = 'svf'),
        sdk_version TEXT NOT NULL CHECK (sdk_version = '7.130.0'),
        entrypoint TEXT NOT NULL CHECK (entrypoint = 'resources/output/0/0.svf'),
        prepared_at TIMESTAMPTZ NOT NULL,
        imported_at TIMESTAMPTZ,
        imported_by UUID NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('staging','validating','ready','failed')),
        health TEXT NOT NULL CHECK (health IN ('unchecked','healthy','unavailable')),
        resource_count INTEGER NOT NULL CHECK (resource_count > 0 AND resource_count <= 100000),
        total_bytes BIGINT NOT NULL CHECK (total_bytes >= 0 AND total_bytes <= 8589934592),
        validation_report_id UUID REFERENCES model_validation_reports(id),
        failure JSONB,
        manifest JSONB NOT NULL,
        storage_prefix TEXT NOT NULL UNIQUE,
        owner_import_id UUID NOT NULL,
        UNIQUE (project_id, id),
        FOREIGN KEY (project_id, owner_import_id) REFERENCES model_import_jobs(project_id,id) ON DELETE CASCADE,
        CHECK (storage_prefix = 'projects/' || project_id::text || '/versions/' || id::text || '/'),
        CHECK (state <> 'ready' OR (health IN ('healthy','unavailable') AND imported_at IS NOT NULL AND validation_report_id IS NOT NULL AND failure IS NULL)),
        CHECK (state = 'ready' OR health = 'unchecked'),
        CHECK ((state = 'failed') = (failure IS NOT NULL))
      );
      ALTER TABLE model_import_jobs ADD COLUMN IF NOT EXISTS cleaned_at TIMESTAMPTZ;
      ALTER TABLE model_import_jobs ADD COLUMN IF NOT EXISTS staging_cleaned_at TIMESTAMPTZ;
      ALTER TABLE model_validation_reports ADD COLUMN IF NOT EXISTS storage_readback JSONB;
      ALTER TABLE model_validation_reports ALTER COLUMN storage_readback SET NOT NULL;
      ALTER TABLE model_validation_reports DROP CONSTRAINT IF EXISTS model_validation_report_verified;
      ALTER TABLE model_validation_reports ADD CONSTRAINT model_validation_report_verified CHECK ((
        report->>'reportSchemaVersion' = '1' AND report->>'status' = 'PASS' AND report->>'operation' = 'verify'
        AND report->'checks'->>'portableManifest' = 'PASS' AND report->'checks'->>'safeArchive' = 'PASS'
        AND report->'checks'->>'rawInventory' = 'PASS' AND report->'checks'->>'fingerprint' = 'PASS'
        AND report->'checks'->>'supportedProfile' = 'PASS' AND report->'checks'->>'nestedReferences' = 'PASS'
        AND jsonb_typeof(report->'resourceCount') = 'number' AND (report->>'resourceCount')::numeric BETWEEN 1 AND 100000
        AND (report->>'resourceCount')::numeric = trunc((report->>'resourceCount')::numeric)
        AND jsonb_typeof(report->'totalRawBytes') = 'number' AND (report->>'totalRawBytes')::numeric BETWEEN 0 AND 8589934592
        AND (report->>'totalRawBytes')::numeric = trunc((report->>'totalRawBytes')::numeric)
      ) IS TRUE);
      ALTER TABLE model_validation_reports DROP CONSTRAINT IF EXISTS model_storage_readback_verified;
      ALTER TABLE model_validation_reports ADD CONSTRAINT model_storage_readback_verified CHECK ((
        storage_readback->>'status' = 'PASS' AND storage_readback->>'algorithm' = 'SHA-256'
        AND jsonb_typeof(storage_readback->'resourceCount') = 'number' AND (storage_readback->>'resourceCount')::numeric BETWEEN 1 AND 100000
        AND (storage_readback->>'resourceCount')::numeric = trunc((storage_readback->>'resourceCount')::numeric)
        AND jsonb_typeof(storage_readback->'totalBytes') = 'number' AND (storage_readback->>'totalBytes')::numeric BETWEEN 0 AND 8589934592
        AND (storage_readback->>'totalBytes')::numeric = trunc((storage_readback->>'totalBytes')::numeric)
        AND jsonb_typeof(storage_readback->'verifiedAt') = 'string'
      ) IS TRUE);
      CREATE INDEX IF NOT EXISTS model_import_jobs_staging_cleanup ON model_import_jobs(updated_at,id) WHERE staging_cleaned_at IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS model_versions_ready_fingerprint
        ON model_versions(project_id,content_fingerprint) WHERE state = 'ready';
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'model_import_jobs_version_project_fk' AND conrelid = 'model_import_jobs'::regclass) THEN
          ALTER TABLE model_import_jobs ADD CONSTRAINT model_import_jobs_version_project_fk
            FOREIGN KEY(project_id,model_version_id) REFERENCES model_versions(project_id,id) DEFERRABLE INITIALLY DEFERRED;
        END IF;
      END $$;
      CREATE TABLE IF NOT EXISTS model_content_reservations (
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        content_fingerprint TEXT NOT NULL,
        import_id UUID NOT NULL,
        model_version_id UUID NOT NULL,
        owner_token UUID NOT NULL,
        PRIMARY KEY (project_id,content_fingerprint),
        FOREIGN KEY(project_id,import_id) REFERENCES model_import_jobs(project_id,id) ON DELETE CASCADE,
        FOREIGN KEY(project_id,model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS model_package_aliases (
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        package_id UUID NOT NULL REFERENCES model_package_identities(package_id),
        model_version_id UUID NOT NULL,
        PRIMARY KEY(project_id,package_id),
        FOREIGN KEY(project_id,model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE
      );
      -- Deliberately retained after a project/job/version cascade. Published resources are never generic garbage.
      CREATE TABLE IF NOT EXISTS model_storage_ownership (
        import_id UUID PRIMARY KEY,
        project_id UUID NOT NULL,
        model_version_id UUID NOT NULL UNIQUE,
        storage_prefix TEXT NOT NULL UNIQUE,
        owner_token UUID NOT NULL,
        published BOOLEAN NOT NULL DEFAULT FALSE,
        cleaned_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (storage_prefix = 'projects/' || project_id::text || '/versions/' || model_version_id::text || '/'),
        CHECK (NOT published OR cleaned_at IS NULL)
      );
      CREATE TABLE IF NOT EXISTS project_model_selections (
        project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        active_model_version_id UUID,
        selection_revision INTEGER NOT NULL DEFAULT 0 CHECK (selection_revision >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        FOREIGN KEY(project_id,active_model_version_id) REFERENCES model_versions(project_id,id) DEFERRABLE INITIALLY DEFERRED
      );
      INSERT INTO project_model_selections(project_id) SELECT id FROM projects ON CONFLICT DO NOTHING;
      CREATE OR REPLACE FUNCTION initialize_project_model_selection() RETURNS trigger AS $$
      BEGIN
        INSERT INTO project_model_selections(project_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS initialize_model_selection ON projects;
      CREATE TRIGGER initialize_model_selection AFTER INSERT ON projects
        FOR EACH ROW EXECUTE FUNCTION initialize_project_model_selection();
      CREATE OR REPLACE FUNCTION validate_project_model_selection() RETURNS trigger AS $$
      BEGIN
        IF NEW.active_model_version_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM model_versions WHERE id = NEW.active_model_version_id AND project_id = NEW.project_id
            AND state = 'ready' AND health = 'healthy'
        ) THEN
          RAISE EXCEPTION 'Model must be ready and healthy in this project' USING ERRCODE = '23514', CONSTRAINT = 'model_selection_ready_healthy';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS validate_model_selection ON project_model_selections;
      CREATE TRIGGER validate_model_selection BEFORE INSERT OR UPDATE OF active_model_version_id ON project_model_selections
        FOR EACH ROW EXECUTE FUNCTION validate_project_model_selection();
      CREATE OR REPLACE FUNCTION protect_ready_model_metadata() RETURNS trigger AS $$
      BEGIN
        IF OLD.state = 'ready' AND (to_jsonb(OLD) - 'health') IS DISTINCT FROM (to_jsonb(NEW) - 'health') THEN
          RAISE EXCEPTION 'Ready model metadata is immutable' USING ERRCODE = '23514', CONSTRAINT = 'model_ready_metadata_immutable';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS protect_ready_model ON model_versions;
      CREATE TRIGGER protect_ready_model BEFORE UPDATE ON model_versions
        FOR EACH ROW EXECUTE FUNCTION protect_ready_model_metadata();
      CREATE OR REPLACE FUNCTION require_ready_model_validation() RETURNS trigger AS $$
      DECLARE validation model_validation_reports%ROWTYPE;
      BEGIN
        IF NEW.state = 'ready' THEN
          SELECT * INTO validation FROM model_validation_reports WHERE id = NEW.validation_report_id;
          IF NOT FOUND OR NOT ((
            validation.report->'package'->>'packageId' = NEW.package_id::text
            AND validation.report->>'contentFingerprint' = NEW.content_fingerprint
            AND (validation.report->>'resourceCount')::numeric = NEW.resource_count
            AND (validation.report->>'totalRawBytes')::numeric = NEW.total_bytes
            AND (validation.storage_readback->>'resourceCount')::numeric = NEW.resource_count
            AND (validation.storage_readback->>'totalBytes')::numeric = NEW.total_bytes
            AND validation.report->'manifest' = NEW.manifest
            AND validation.report->'manifest'->'source' = NEW.source
            AND validation.report->'manifest'->>'label' = NEW.label
            AND validation.report->'manifest'->>'packageId' = NEW.package_id::text
            AND validation.report->'manifest'->>'contentFingerprint' = NEW.content_fingerprint
            AND validation.report->'manifest'->>'supportProfile' = NEW.support_profile
          ) IS TRUE) THEN
            RAISE EXCEPTION 'Ready model must match its validation and stored-resource receipt' USING ERRCODE = '23514', CONSTRAINT = 'model_ready_validation_matches';
          END IF;
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS require_ready_validation ON model_versions;
      CREATE TRIGGER require_ready_validation BEFORE INSERT OR UPDATE ON model_versions
        FOR EACH ROW EXECUTE FUNCTION require_ready_model_validation();
      CREATE OR REPLACE FUNCTION protect_model_validation_report() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Validation reports are immutable' USING ERRCODE = '23514', CONSTRAINT = 'model_validation_report_immutable';
      END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS protect_validation_report ON model_validation_reports;
      CREATE TRIGGER protect_validation_report BEFORE UPDATE ON model_validation_reports
        FOR EACH ROW EXECUTE FUNCTION protect_model_validation_report();
      CREATE OR REPLACE FUNCTION protect_model_storage_ownership() RETURNS trigger AS $$
      BEGIN
        IF OLD.published OR (to_jsonb(OLD) - 'published' - 'cleaned_at') IS DISTINCT FROM (to_jsonb(NEW) - 'published' - 'cleaned_at')
          OR OLD.cleaned_at IS NOT NULL THEN
          RAISE EXCEPTION 'Storage ownership is immutable after publication or cleanup' USING ERRCODE = '23514', CONSTRAINT = 'model_storage_ownership_immutable';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS protect_storage_ownership ON model_storage_ownership;
      CREATE TRIGGER protect_storage_ownership BEFORE UPDATE ON model_storage_ownership
        FOR EACH ROW EXECUTE FUNCTION protect_model_storage_ownership();
    `);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    client.release();
  }
}
