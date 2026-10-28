import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { resolveUserRole, type UserRow } from '../models/user.js';
import { ViewerSessionError } from './errors.js';
import type { AuthorizedViewerResource, ResourceIdentity, ViewerPrincipal, ViewerSessionDto, ViewerVersion } from './types.js';
import { readViewerRoutingBindings } from './routingBindings.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
type Row = Record<string, any>;
type AuthorizedViewerCapability = Pick<AuthorizedViewerResource, 'session'>;
type AuthorizedViewerRow = { session: ViewerSessionDto; versionRow: Row };
export function viewerUuid(input: unknown): string {
  if (typeof input !== 'string' || !UUID.test(input)) throw new ViewerSessionError('INVALID_VIEWER_REQUEST');
  return input.toLowerCase();
}
const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');
const iso = (value: unknown): string => new Date(value as string).toISOString();
function dto(row: Row): ViewerSessionDto {
  return { sessionId: row.id, projectId: row.project_id, modelVersionId: row.model_version_id, loadId: row.load_id,
    expiresAt: iso(row.expires_at), absoluteExpiresAt: iso(row.absolute_expires_at) };
}
function version(row: Row): ViewerVersion {
  return { id: row.id, projectId: row.project_id, contentFingerprint: row.content_fingerprint, supportProfile: row.support_profile,
    format: row.format, sdkVersion: row.sdk_version, entrypoint: row.entrypoint, resourceCount: row.resource_count,
    totalBytes: Number(row.total_bytes), manifest: row.manifest, storagePrefix: row.storage_prefix };
}
function unwrap<T>(value: T | ViewerSessionError): T { if (value instanceof ViewerSessionError) throw value; return value; }

export function createViewerSessionService(options: { pool: Pool; clock?: () => number }) {
  const { pool } = options, now = options.clock ?? Date.now;
  async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { try { await client.query('ROLLBACK'); } catch { /* Fail closed; never assume a grant. */ } throw error; }
    finally { client.release(); }
  }
  function principal(input: ViewerPrincipal): ViewerPrincipal {
    if (!input?.loginId || !UUID.test(input.loginId)) throw new ViewerSessionError('LOGIN_REFRESH_REQUIRED', 401);
    const value = { userId: viewerUuid(input.userId), loginId: viewerUuid(input.loginId), loginExpiresAt: input.loginExpiresAt };
    if (!Number.isSafeInteger(value.loginExpiresAt) || value.loginExpiresAt <= now()) throw new ViewerSessionError('AUTH_REQUIRED', 401);
    return value;
  }
  async function currentRead(client: PoolClient, projectId: string, userId: string): Promise<void> {
    const result = await client.query<Row>(`SELECT u.is_admin,u.role,
      EXISTS(SELECT 1 FROM user_project_access a WHERE a.user_id=u.id AND a.project_id=p.id) AS assigned
      FROM projects p CROSS JOIN users u WHERE p.id=$1 AND u.id=$2`, [projectId,userId]);
    if (!result.rows[0]) throw new ViewerSessionError('AUTH_REQUIRED', 401);
    const role = resolveUserRole(result.rows[0] as Pick<UserRow,'is_admin'|'role'>);
    if (role !== 'admin' && role !== 'engineer' && !result.rows[0].assigned) throw new ViewerSessionError('ACCESS_REVOKED', 403);
  }
  async function login(client: PoolClient, who: ViewerPrincipal): Promise<ViewerSessionError | null> {
    await client.query(`INSERT INTO viewer_login_bindings(login_id,user_id,expires_at) VALUES($1,$2,$3)
      ON CONFLICT(login_id) DO NOTHING`, [who.loginId,who.userId,new Date(who.loginExpiresAt)]);
    const row = (await client.query<Row>('SELECT * FROM viewer_login_bindings WHERE login_id=$1 FOR UPDATE', [who.loginId])).rows[0];
    if (!row || row.user_id !== who.userId || new Date(row.expires_at).getTime() !== who.loginExpiresAt || row.revoked_at) {
      return new ViewerSessionError('SESSION_REVOKED', 410);
    }
    return null;
  }
  async function revokeRow(client: PoolClient, id: string, reason: string): Promise<void> {
    await client.query(`UPDATE viewer_resource_sessions SET revoked_at=$2,revoke_reason=$3 WHERE id=$1 AND revoked_at IS NULL`, [id,new Date(now()),reason]);
  }
  async function authorizeRow(client: PoolClient, input: ResourceIdentity, mode: 'resource' | 'capability' = 'resource'): Promise<AuthorizedViewerRow | ViewerSessionError> {
    const projectId = viewerUuid(input.projectId), modelVersionId = viewerUuid(input.modelVersionId), sessionId = viewerUuid(input.sessionId);
    if (!secretPattern.test(input.cookieSecret ?? '')) return new ViewerSessionError('AUTH_REQUIRED', 401);
    // Capability checks need live model health, never its large resource manifest.
    // Only this private literal mode selects the projection; all authority joins,
    // guards and locks below are shared with the full resource authorization.
    const versionProjection = mode === 'capability' ? "json_build_object('state', v.state, 'health', v.health)" : 'row_to_json(v)';
    const result = await client.query<Row>(`SELECT row_to_json(s) AS session,row_to_json(l) AS login,
      ${versionProjection} AS version,u.is_admin,u.role,pms.active_model_version_id,pms.selection_revision,
      EXISTS(SELECT 1 FROM user_project_access a WHERE a.user_id=u.id AND a.project_id=s.project_id) AS assigned
      FROM viewer_resource_sessions s
      JOIN viewer_login_bindings l ON l.login_id=s.login_id AND l.user_id=s.user_id
      JOIN users u ON u.id=s.user_id JOIN projects p ON p.id=s.project_id
      JOIN model_versions v ON v.id=s.model_version_id AND v.project_id=s.project_id
      JOIN project_model_selections pms ON pms.project_id=s.project_id
      WHERE s.id=$1 AND s.project_id=$2 AND s.model_version_id=$3 AND s.secret_hash=$4
      FOR UPDATE OF s`, [sessionId,projectId,modelVersionId,hashSecret(input.cookieSecret)]);
    const row = result.rows[0];
    if (!row) return new ViewerSessionError('SESSION_NOT_FOUND', 401);
    const s = row.session as Row;
    if (s.revoke_reason === 'selection' || row.active_model_version_id !== modelVersionId || row.selection_revision !== s.selection_revision) {
      await revokeRow(client, sessionId, 'selection'); return new ViewerSessionError('MODEL_SELECTION_CHANGED', 409);
    }
    if (row.version.state !== 'ready' || row.version.health !== 'healthy' || s.revoke_reason === 'unavailable') {
      await revokeRow(client, sessionId, 'unavailable'); return new ViewerSessionError('MODEL_UNAVAILABLE', 409);
    }
    if (s.revoked_at || row.login.revoked_at) return new ViewerSessionError('SESSION_REVOKED', 410);
    if (new Date(s.expires_at).getTime() <= now() || new Date(s.absolute_expires_at).getTime() <= now() || new Date(row.login.expires_at).getTime() <= now()) {
      return new ViewerSessionError('SESSION_EXPIRED', 410);
    }
    const role = resolveUserRole(row as Pick<UserRow,'is_admin'|'role'>);
    if (role !== 'admin' && role !== 'engineer' && !row.assigned) {
      await revokeRow(client, sessionId, 'access'); return new ViewerSessionError('ACCESS_REVOKED', 403);
    }
    return { session: dto(s), versionRow: row.version };
  }
  async function authorize(client: PoolClient, input: ResourceIdentity): Promise<AuthorizedViewerResource | ViewerSessionError> {
    const authorized = await authorizeRow(client,input);
    if (authorized instanceof ViewerSessionError) return authorized;
    return { session: authorized.session, version: version(authorized.versionRow) };
  }
  async function authorizeCapability(client: PoolClient, input: ResourceIdentity): Promise<AuthorizedViewerCapability | ViewerSessionError> {
    const authorized = await authorizeRow(client,input,'capability');
    if (authorized instanceof ViewerSessionError) return authorized;
    return { session: authorized.session };
  }
  return {
    async create(input: { principal: ViewerPrincipal; projectId: string; modelVersionId: string; loadId: string }): Promise<{ session: ViewerSessionDto; cookieSecret: string }> {
      const who = principal(input.principal), projectId = viewerUuid(input.projectId), modelVersionId = viewerUuid(input.modelVersionId), loadId = viewerUuid(input.loadId);
      const cookieSecret = randomBytes(32).toString('base64url');
      const result = await transaction(async client => {
        const project = await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
        if (!project.rows.length) throw new ViewerSessionError('PROJECT_NOT_FOUND', 404);
        await currentRead(client,projectId,who.userId);
        const denied = await login(client,who); if (denied) return denied;
        const selected = (await client.query<Row>(`SELECT pms.*,v.state,v.health FROM project_model_selections pms
          LEFT JOIN model_versions v ON v.project_id=pms.project_id AND v.id=pms.active_model_version_id WHERE pms.project_id=$1`, [projectId])).rows[0];
        if (!selected || selected.active_model_version_id !== modelVersionId) throw new ViewerSessionError('MODEL_SELECTION_CHANGED', 409);
        if (selected.state !== 'ready' || selected.health !== 'healthy') throw new ViewerSessionError('MODEL_UNAVAILABLE', 409);
        const at = now(), absolute = Math.min(at + 30*60_000,who.loginExpiresAt), expires = Math.min(at + 5*60_000,absolute);
        if (expires <= at) throw new ViewerSessionError('AUTH_REQUIRED',401);
        const row = (await client.query<Row>(`INSERT INTO viewer_resource_sessions(id,user_id,login_id,project_id,model_version_id,load_id,
          selection_revision,secret_hash,created_at,expires_at,absolute_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [randomUUID(),who.userId,who.loginId,projectId,modelVersionId,loadId,selected.selection_revision,hashSecret(cookieSecret),new Date(at),new Date(expires),new Date(absolute)])).rows[0];
        return { session: dto(row),cookieSecret };
      });
      return unwrap(result);
    },
    async authorizeResource(input: ResourceIdentity): Promise<AuthorizedViewerResource> { return unwrap(await transaction(client => authorize(client,input))); },
    async routingBindings(input: ResourceIdentity) {
      return transaction(async client => {
        const current = unwrap(await authorize(client,input));
        const result = await readViewerRoutingBindings(client, { projectId: current.session.projectId,
          modelVersionId: current.session.modelVersionId, contentFingerprint: current.version.contentFingerprint });
        // This read grants the ordinary model-view projection only. Recheck the
        // live session/selection/login/assignment before its transaction commits.
        const checked = unwrap(await authorize(client,input));
        if (checked.version.contentFingerprint !== current.version.contentFingerprint || checked.session.loadId !== current.session.loadId)
          throw new ViewerSessionError('MODEL_SELECTION_CHANGED',409);
        return result;
      });
    },
    async authorizePathFinder(input: ResourceIdentity): Promise<{ authorized: true; loadId: string }> {
      return transaction(async client => {
        const current = unwrap(await authorizeCapability(client,input));
        const user = await client.query<{ is_admin: boolean }>(`SELECT u.is_admin FROM users u
          JOIN viewer_resource_sessions s ON s.user_id=u.id WHERE s.id=$1 FOR SHARE OF u`,[current.session.sessionId]);
        if (user.rows[0]?.is_admin !== true) throw new ViewerSessionError('ACCESS_REVOKED',403);
        unwrap(await authorizeCapability(client,input));
        return { authorized: true, loadId: current.session.loadId };
      });
    },
    async renew(input: ResourceIdentity & { principal: ViewerPrincipal }): Promise<ViewerSessionDto> {
      const who = principal(input.principal);
      return unwrap(await transaction(async client => {
        const project = await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[viewerUuid(input.projectId)]);
        if (!project.rows.length) throw new ViewerSessionError('PROJECT_NOT_FOUND',404);
        const denied = await login(client,who); if (denied) return denied;
        const authorized = await authorize(client,input); if (authorized instanceof ViewerSessionError) return authorized;
        const owned = await client.query(`SELECT 1 FROM viewer_resource_sessions WHERE id=$1 AND user_id=$2 AND login_id=$3`, [input.sessionId,who.userId,who.loginId]);
        if (!owned.rows.length) return new ViewerSessionError('AUTH_REQUIRED',401);
        const at = now(),expires = Math.min(at+5*60_000,new Date(authorized.session.absoluteExpiresAt).getTime(),who.loginExpiresAt);
        if (expires <= at) return new ViewerSessionError('SESSION_EXPIRED',410);
        const row = (await client.query<Row>('UPDATE viewer_resource_sessions SET expires_at=$2 WHERE id=$1 RETURNING *',[input.sessionId,new Date(expires)])).rows[0];
        return dto(row);
      }));
    },
    async revoke(input: { principal: ViewerPrincipal; projectId: string; modelVersionId: string; sessionId: string }): Promise<void> {
      const who = principal(input.principal);
      await pool.query(`UPDATE viewer_resource_sessions SET revoked_at=COALESCE(revoked_at,$6),revoke_reason=COALESCE(revoke_reason,'closed')
        WHERE id=$1 AND project_id=$2 AND model_version_id=$3 AND user_id=$4 AND login_id=$5`,
      [viewerUuid(input.sessionId),viewerUuid(input.projectId),viewerUuid(input.modelVersionId),who.userId,who.loginId,new Date(now())]);
    },
    async revokeLogin(input: ViewerPrincipal): Promise<void> {
      const who = principal(input);
      await transaction(async client => {
        // A durable tombstone also fences create racing with logout before its first session.
        await login(client,who);
        await client.query('UPDATE viewer_login_bindings SET revoked_at=COALESCE(revoked_at,$2) WHERE login_id=$1 AND user_id=$3',[who.loginId,new Date(now()),who.userId]);
        await client.query("UPDATE viewer_resource_sessions SET revoked_at=$2,revoke_reason='logout' WHERE login_id=$1 AND user_id=$3 AND revoked_at IS NULL",[who.loginId,new Date(now()),who.userId]);
      });
    },
    async markUnavailable(projectId: string,modelVersionId: string): Promise<void> {
      await transaction(async client => {
        // Match selection/create lock ordering: no new grant can observe stale
        // health while this durable downgrade is awaiting publication.
        await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[viewerUuid(projectId)]);
        await client.query("UPDATE model_versions SET health='unavailable' WHERE project_id=$1 AND id=$2 AND state='ready'",[projectId,viewerUuid(modelVersionId)]);
      });
    },
  };
}
export type ViewerSessionService = ReturnType<typeof createViewerSessionService>;
