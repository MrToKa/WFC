import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { readPurposePolicyState } from '../pathfinder/policySchema.js';
import { resolveUserRole } from '../models/user.js';

export class TrayPurposeError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export const trayPurposeNameSchema = z.string().transform(v => v.normalize('NFC').trim())
  .pipe(z.string().min(1).max(200).refine(v => !/[\u0000-\u001f\u007f-\u009f]/u.test(v), 'Use a name without control characters.'));
export const PROJECT_TRAY_PURPOSE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_tray_purposes (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 PRIMARY KEY(project_id,name)
);
CREATE TABLE IF NOT EXISTS project_tray_purpose_changes (
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL,operation text NOT NULL,previous_name text,name text,
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO project_tray_purposes(project_id,name)
 SELECT project_id,pf_catalog_key(purpose) FROM trays WHERE purpose IS NOT NULL AND length(pf_catalog_key(purpose)) BETWEEN 1 AND 200
 UNION SELECT project_id,pf_catalog_key(tray_purpose) FROM project_tray_purpose_templates WHERE length(pf_catalog_key(tray_purpose)) BETWEEN 1 AND 200
 ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION retain_project_tray_purpose() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE purpose_name text;BEGIN
 purpose_name=pf_catalog_key(NEW.purpose);
 IF length(purpose_name) BETWEEN 1 AND 200 THEN
 INSERT INTO project_tray_purposes(project_id,name) VALUES(NEW.project_id,purpose_name) ON CONFLICT DO NOTHING;
 END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS retain_project_tray_purpose ON trays;
CREATE TRIGGER retain_project_tray_purpose AFTER INSERT OR UPDATE OF purpose,project_id ON trays
 FOR EACH ROW EXECUTE FUNCTION retain_project_tray_purpose();`;
export async function initializeProjectTrayPurposeSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('wfc-project-tray-purpose-schema-v1'))");
    await client.query('LOCK TABLE projects,trays,project_tray_purpose_templates IN SHARE ROW EXCLUSIVE MODE');
    await client.query(PROJECT_TRAY_PURPOSE_SCHEMA_SQL);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

/** Include historical/imported names without changing project data during a read. */
export async function listProjectTrayPurposes(c: Pick<PoolClient, 'query'>, projectId: string) {
  const rows = (await c.query<{ name: string; tray_count: string }>(`
    WITH names AS (
      SELECT name FROM project_tray_purposes WHERE project_id=$1
      UNION SELECT pf_catalog_key(purpose) FROM trays WHERE project_id=$1 AND purpose IS NOT NULL
      UNION SELECT pf_catalog_key(tray_purpose) FROM project_tray_purpose_templates WHERE project_id=$1
    ) SELECT n.name,(SELECT count(*)::text FROM trays t WHERE t.project_id=$1 AND pf_catalog_key(t.purpose)=n.name) AS tray_count
    FROM names n WHERE n.name<>'' ORDER BY n.name COLLATE "C" LIMIT 4097`, [projectId])).rows;
  if (rows.length > 4096) throw new TrayPurposeError('TRAY_PURPOSE_LIMIT', 413, 'This project has too many tray purposes.');
  return { purposes: rows.map(row => ({ name: row.name, trayCount: Number(row.tray_count) })) };
}

type PurposeChange = { operation: 'create' | 'rename' | 'delete'; name: string; nextName?: string };
/** Caller holds a transaction. Lock the project before policy state, as other PF writers do. */
export async function changeProjectTrayPurpose(c: PoolClient, projectId: string, actorId: string, input: PurposeChange) {
  const name = trayPurposeNameSchema.parse(input.name);
  const nextName = input.operation === 'rename' ? trayPurposeNameSchema.parse(input.nextName) : undefined;
  const exists = (await c.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [projectId])).rows.length > 0;
  const account = (await c.query('SELECT is_admin,role FROM users WHERE id=$1 FOR SHARE', [actorId])).rows[0];
  if (!account) throw new TrayPurposeError('AUTHENTICATION_REQUIRED', 401, 'Sign in again.');
  const assigned = account.is_admin === true ? false : (await c.query('SELECT user_id FROM user_project_access WHERE user_id=$1 AND project_id=$2 FOR SHARE', [actorId, projectId])).rows.length > 0;
  if (account.is_admin !== true && !(resolveUserRole(account) === 'engineer' && assigned))
    throw new TrayPurposeError('PROJECT_EDIT_REQUIRED', 403, 'Project editing permission is required.');
  if (!exists)
    throw new TrayPurposeError('PROJECT_NOT_FOUND', 404, 'The project is unavailable.');
  await readPurposePolicyState(c, projectId, { lock: true });
  const before = await listProjectTrayPurposes(c, projectId);
  const existing = before.purposes.find(p => p.name === name);
  if (input.operation === 'create') {
    if (existing) throw new TrayPurposeError('TRAY_PURPOSE_EXISTS', 409, 'This tray purpose already exists in this project.');
    if (before.purposes.length >= 4096) throw new TrayPurposeError('TRAY_PURPOSE_LIMIT', 413, 'This project has too many tray purposes.');
    await c.query('INSERT INTO project_tray_purposes(project_id,name) VALUES($1,$2)', [projectId, name]);
  } else {
    if (!existing) throw new TrayPurposeError('TRAY_PURPOSE_NOT_FOUND', 404, 'Refresh the tray purposes; this name is no longer available.');
    if (input.operation === 'delete') {
      if (existing.trayCount) throw new TrayPurposeError('TRAY_PURPOSE_IN_USE', 409, `This purpose is used by ${existing.trayCount} trays. Assign those trays another purpose before deleting it.`);
      await c.query('DELETE FROM project_tray_purpose_templates WHERE project_id=$1 AND pf_catalog_key(tray_purpose)=$2', [projectId, name]);
      await c.query('DELETE FROM project_tray_purposes WHERE project_id=$1 AND name=$2', [projectId, name]);
    } else {
      if (nextName === name) return before;
      if (before.purposes.some(p => p.name === nextName)) throw new TrayPurposeError('TRAY_PURPOSE_EXISTS', 409, 'Choose another name; that tray purpose already exists.');
      // Preserve the old active semantics before tray triggers retire its incarnation.
      const routing = (await c.query<{ allowed_categories: unknown }>(`SELECT r.allowed_categories FROM pf_routing_purpose_rules r
        JOIN pf_catalog_purpose_incarnations i ON i.project_id=r.project_id AND i.purpose_key=r.purpose_key AND i.incarnation_id=r.purpose_incarnation_id
        WHERE r.project_id=$1 AND r.purpose_key=$2 AND i.active`, [projectId, name])).rows[0];
      const drawing = (await c.query<{ category_modes: unknown }>(`SELECT r.category_modes FROM pf_drawing_purpose_rules r
        JOIN pf_catalog_purpose_incarnations i ON i.project_id=r.project_id AND i.purpose_key=r.purpose_key AND i.incarnation_id=r.purpose_incarnation_id
        WHERE r.project_id=$1 AND r.purpose_key=$2 AND i.active`, [projectId, name])).rows[0];
      await c.query('UPDATE trays SET purpose=$3,updated_at=now() WHERE project_id=$1 AND pf_catalog_key(purpose)=$2', [projectId, name, nextName]);
      await c.query('UPDATE project_tray_purpose_templates SET tray_purpose=$3,updated_at=now() WHERE project_id=$1 AND pf_catalog_key(tray_purpose)=$2', [projectId, name, nextName]);
      await c.query('DELETE FROM project_tray_purposes WHERE project_id=$1 AND name=$2', [projectId, name]);
      await c.query('INSERT INTO project_tray_purposes(project_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [projectId, nextName]);
      if (routing) await c.query(`INSERT INTO pf_routing_purpose_rules(project_id,purpose_key,purpose_incarnation_id,allowed_categories)
        SELECT project_id,purpose_key,incarnation_id,$3::jsonb FROM pf_catalog_purpose_incarnations
        WHERE project_id=$1 AND purpose_key=$2 AND active`, [projectId, nextName, JSON.stringify(routing.allowed_categories)]);
      if (drawing) await c.query(`INSERT INTO pf_drawing_purpose_rules(project_id,purpose_key,purpose_incarnation_id,category_modes)
        SELECT project_id,purpose_key,incarnation_id,$3::jsonb FROM pf_catalog_purpose_incarnations
        WHERE project_id=$1 AND purpose_key=$2 AND active`, [projectId, nextName, JSON.stringify(drawing.category_modes)]);
      if (routing || drawing) await c.query(`UPDATE pf_purpose_project_state SET
        routing_policy_revision=routing_policy_revision+$2,drawing_policy_revision=drawing_policy_revision+$3,updated_at=now() WHERE project_id=$1`, [projectId, routing ? 1 : 0, drawing ? 1 : 0]);
    }
  }
  await c.query('INSERT INTO project_tray_purpose_changes(id,project_id,actor_id,operation,previous_name,name) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), projectId, actorId, input.operation, input.operation === 'create' ? null : name, input.operation === 'delete' ? null : nextName ?? name]);
  return listProjectTrayPurposes(c, projectId);
}
