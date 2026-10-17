import type { Pool } from 'pg';

export async function initializeViewerSessions(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('wfc.viewer-sessions.schema.v1',0))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS viewer_login_bindings (
        login_id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(login_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS viewer_resource_sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        login_id UUID NOT NULL,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        model_version_id UUID NOT NULL,
        load_id UUID NOT NULL,
        selection_revision INTEGER NOT NULL CHECK(selection_revision >= 0),
        secret_hash TEXT NOT NULL CHECK(secret_hash ~ '^[0-9a-f]{64}$'),
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        absolute_expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoke_reason TEXT CHECK(revoke_reason IN ('logout','closed','selection','access','unavailable')),
        FOREIGN KEY(login_id,user_id) REFERENCES viewer_login_bindings(login_id,user_id) ON DELETE CASCADE,
        FOREIGN KEY(project_id,model_version_id) REFERENCES model_versions(project_id,id) ON DELETE CASCADE,
        CHECK(created_at < expires_at AND expires_at <= absolute_expires_at),
        CHECK(absolute_expires_at <= created_at + INTERVAL '30 minutes'),
        CHECK((revoked_at IS NULL) = (revoke_reason IS NULL))
      );
      CREATE INDEX IF NOT EXISTS viewer_sessions_login ON viewer_resource_sessions(login_id) WHERE revoked_at IS NULL;
      CREATE INDEX IF NOT EXISTS viewer_sessions_project ON viewer_resource_sessions(project_id) WHERE revoked_at IS NULL;
      CREATE INDEX IF NOT EXISTS viewer_sessions_expiry ON viewer_resource_sessions(expires_at);
      CREATE OR REPLACE FUNCTION revoke_changed_viewer_selection() RETURNS trigger AS $$
      BEGIN
        IF NEW.active_model_version_id IS DISTINCT FROM OLD.active_model_version_id
          OR NEW.selection_revision IS DISTINCT FROM OLD.selection_revision THEN
          UPDATE viewer_resource_sessions SET revoked_at=clock_timestamp(),revoke_reason='selection'
            WHERE project_id=NEW.project_id AND revoked_at IS NULL;
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS revoke_viewer_selection ON project_model_selections;
      CREATE TRIGGER revoke_viewer_selection AFTER UPDATE ON project_model_selections
        FOR EACH ROW EXECUTE FUNCTION revoke_changed_viewer_selection();
      CREATE OR REPLACE FUNCTION revoke_unavailable_viewer_model() RETURNS trigger AS $$
      BEGIN
        IF NEW.health='unavailable' AND NEW.health IS DISTINCT FROM OLD.health THEN
          UPDATE viewer_resource_sessions SET revoked_at=clock_timestamp(),revoke_reason='unavailable'
            WHERE project_id=NEW.project_id AND model_version_id=NEW.id AND revoked_at IS NULL;
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS revoke_viewer_unavailable ON model_versions;
      CREATE TRIGGER revoke_viewer_unavailable AFTER UPDATE OF health ON model_versions
        FOR EACH ROW EXECUTE FUNCTION revoke_unavailable_viewer_model();
    `);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Startup fails closed. */ }
    throw error;
  } finally { client.release(); }
}
