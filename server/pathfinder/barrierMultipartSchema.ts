import type { Pool } from 'pg';

/** Additive and deliberately NOT called by the application initializer in B13b.
 * Retained reservations include cancelled, uncertain and orphaned allocations. */
export const BARRIER_MULTIPART_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pf_barrier_multipart_sessions (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), actor_id uuid NOT NULL REFERENCES users(id), login_id uuid NOT NULL,
 idempotency_key uuid NOT NULL, request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 command jsonb NOT NULL, frozen jsonb NOT NULL, state text NOT NULL CHECK(state IN ('admitted','staging','cancelled')),
 session_revision bigint NOT NULL DEFAULT 0 CHECK(session_revision>=0),
 reserved_bytes bigint NOT NULL CHECK(reserved_bytes>0 AND reserved_bytes<=8589934592),
 reserved_files integer NOT NULL CHECK(reserved_files>=2 AND reserved_files<=49999),
 charged_bytes bigint NOT NULL DEFAULT 0 CHECK(charged_bytes>=0 AND charged_bytes<=reserved_bytes),
 charged_files integer NOT NULL DEFAULT 0 CHECK(charged_files>=0 AND charged_files<=reserved_files),
 job_deadline timestamptz NOT NULL, lease_token uuid, lease_expires_at timestamptz, pending_allocation uuid,
 counts jsonb NOT NULL, roots jsonb NOT NULL,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(project_id,id), UNIQUE(project_id,actor_id,idempotency_key),
 CHECK((lease_token IS NULL)=(lease_expires_at IS NULL)),
 CHECK((pending_allocation IS NULL)=(lease_token IS NULL)), CHECK(lease_expires_at IS NULL OR lease_expires_at<=job_deadline)
);
CREATE TABLE IF NOT EXISTS pf_barrier_multipart_allocations (
 id uuid PRIMARY KEY, project_id uuid NOT NULL, session_id uuid NOT NULL, actor_id uuid NOT NULL, login_id uuid NOT NULL,
 idempotency_key uuid NOT NULL, request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'), command jsonb NOT NULL,
 ticket jsonb NOT NULL, summary jsonb NOT NULL, item_kind text NOT NULL CHECK(item_kind IN ('page','seal','part')),
 stream_kind text CHECK(stream_kind IN ('nodes','fragments','geometry-ranges','plan')), item_index integer NOT NULL CHECK(item_index>=0),
 first_ordinal bigint, record_count integer, content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 lease_token uuid NOT NULL, lease_expires_at timestamptz NOT NULL, expected_revision bigint NOT NULL CHECK(expected_revision>=0),
 state text NOT NULL CHECK(state IN ('pending','stored')),
 FOREIGN KEY(project_id,session_id) REFERENCES pf_barrier_multipart_sessions(project_id,id),
 UNIQUE(project_id,actor_id,idempotency_key), UNIQUE(session_id,item_kind,stream_kind,item_index),
 CHECK(item_kind<>'page' OR (stream_kind IS NOT NULL AND first_ordinal>=0 AND record_count BETWEEN 1 AND 512)),
 CHECK(item_kind<>'seal' OR stream_kind IS NOT NULL), CHECK(item_kind<>'part' OR stream_kind IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS pf_barrier_multipart_part_slot ON pf_barrier_multipart_allocations(session_id,item_index) WHERE item_kind='part';
CREATE UNIQUE INDEX IF NOT EXISTS pf_barrier_multipart_blob_identity ON pf_barrier_multipart_allocations((ticket->>'blobId'));
CREATE TABLE IF NOT EXISTS pf_barrier_multipart_receipts (
 project_id uuid NOT NULL, session_id uuid NOT NULL, actor_id uuid NOT NULL, login_id uuid NOT NULL, idempotency_key uuid NOT NULL,
 allocation_id uuid UNIQUE, request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'), command jsonb NOT NULL, receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(project_id,actor_id,idempotency_key),
 FOREIGN KEY(project_id,session_id) REFERENCES pf_barrier_multipart_sessions(project_id,id),
 FOREIGN KEY(allocation_id) REFERENCES pf_barrier_multipart_allocations(id)
);
CREATE OR REPLACE FUNCTION pf_barrier_multipart_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Immutable multipart evidence'; END $$;
CREATE OR REPLACE FUNCTION pf_barrier_multipart_session_update() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
 IF (to_jsonb(NEW)-ARRAY['state','session_revision','charged_bytes','charged_files','lease_token','lease_expires_at','pending_allocation','counts','roots','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','session_revision','charged_bytes','charged_files','lease_token','lease_expires_at','pending_allocation','counts','roots','updated_at'])
   OR OLD.state='cancelled' OR NEW.session_revision<OLD.session_revision OR NEW.session_revision>OLD.session_revision+1
   OR NEW.charged_bytes<OLD.charged_bytes OR NEW.charged_files<OLD.charged_files OR NEW.updated_at<OLD.updated_at
 THEN RAISE EXCEPTION 'Immutable multipart session identity'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(OLD.roots) entry WHERE entry.value<>'null'::jsonb AND NEW.roots->entry.key IS DISTINCT FROM entry.value)
 THEN RAISE EXCEPTION 'Immutable multipart stream root'; END IF;
 RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION pf_barrier_multipart_allocation_update() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR OLD.state<>'pending' OR NEW.state<>'stored'
 THEN RAISE EXCEPTION 'Immutable multipart allocation'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS pf_barrier_multipart_session_update ON pf_barrier_multipart_sessions;
CREATE TRIGGER pf_barrier_multipart_session_update BEFORE UPDATE ON pf_barrier_multipart_sessions FOR EACH ROW EXECUTE FUNCTION pf_barrier_multipart_session_update();
DROP TRIGGER IF EXISTS pf_barrier_multipart_session_delete ON pf_barrier_multipart_sessions;
CREATE TRIGGER pf_barrier_multipart_session_delete BEFORE DELETE ON pf_barrier_multipart_sessions FOR EACH ROW EXECUTE FUNCTION pf_barrier_multipart_immutable();
DROP TRIGGER IF EXISTS pf_barrier_multipart_allocation_update ON pf_barrier_multipart_allocations;
CREATE TRIGGER pf_barrier_multipart_allocation_update BEFORE UPDATE ON pf_barrier_multipart_allocations FOR EACH ROW EXECUTE FUNCTION pf_barrier_multipart_allocation_update();
DROP TRIGGER IF EXISTS pf_barrier_multipart_allocation_delete ON pf_barrier_multipart_allocations;
CREATE TRIGGER pf_barrier_multipart_allocation_delete BEFORE DELETE ON pf_barrier_multipart_allocations FOR EACH ROW EXECUTE FUNCTION pf_barrier_multipart_immutable();
DROP TRIGGER IF EXISTS pf_barrier_multipart_receipt_update ON pf_barrier_multipart_receipts;
CREATE TRIGGER pf_barrier_multipart_receipt_update BEFORE UPDATE OR DELETE ON pf_barrier_multipart_receipts FOR EACH ROW EXECUTE FUNCTION pf_barrier_multipart_immutable();
CREATE TABLE IF NOT EXISTS pf_barrier_multipart_viewer_contexts (
 intent_id uuid PRIMARY KEY, project_id uuid NOT NULL, viewer_session_id uuid NOT NULL, actor_id uuid NOT NULL, login_id uuid NOT NULL,
 model_version_id uuid NOT NULL, model_load_id uuid NOT NULL, scope_sha256 text NOT NULL CHECK(scope_sha256 ~ '^[a-f0-9]{64}$'),
 command_sha256 text NOT NULL CHECK(command_sha256 ~ '^[a-f0-9]{64}$'), frame_sha256 text NOT NULL CHECK(frame_sha256 ~ '^[a-f0-9]{64}$'),
 frame_observation jsonb NOT NULL, producer_profile jsonb NOT NULL, context_sha256 text NOT NULL CHECK(context_sha256 ~ '^[a-f0-9]{64}$'),
 effective_deadline timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,intent_id) REFERENCES pf_barrier_multipart_sessions(project_id,id)
);
DROP TRIGGER IF EXISTS pf_barrier_multipart_viewer_context_update ON pf_barrier_multipart_viewer_contexts;
CREATE TRIGGER pf_barrier_multipart_viewer_context_update BEFORE UPDATE OR DELETE ON pf_barrier_multipart_viewer_contexts FOR EACH ROW EXECUTE FUNCTION pf_barrier_multipart_immutable();
CREATE TABLE IF NOT EXISTS pf_barrier_multipart_producer_completions (
 project_id uuid NOT NULL, session_id uuid NOT NULL, actor_id uuid NOT NULL, login_id uuid NOT NULL,
 idempotency_key uuid NOT NULL, request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 command jsonb NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(project_id,session_id), UNIQUE(project_id,actor_id,idempotency_key),
 FOREIGN KEY(project_id,session_id) REFERENCES pf_barrier_multipart_sessions(project_id,id),
 FOREIGN KEY(project_id,actor_id,idempotency_key) REFERENCES pf_barrier_multipart_receipts(project_id,actor_id,idempotency_key)
);
DROP TRIGGER IF EXISTS pf_barrier_multipart_producer_completion_update ON pf_barrier_multipart_producer_completions;
CREATE TRIGGER pf_barrier_multipart_producer_completion_update BEFORE UPDATE OR DELETE ON pf_barrier_multipart_producer_completions FOR EACH ROW EXECUTE FUNCTION pf_barrier_multipart_immutable();
`;
export async function initializeBarrierMultipartSchema(pool: Pool): Promise<void> {
  await pool.query(BARRIER_MULTIPART_SCHEMA_SQL);
}
