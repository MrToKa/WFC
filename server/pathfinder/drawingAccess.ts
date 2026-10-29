import type { Pool, PoolClient } from 'pg';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { resolveUserRole, type UserRole } from '../models/user.js';
import { assertLoginNotExpired, requireCurrentLogin } from './auth.js';
import { PathFinderError } from './errors.js';
import type { JobPrincipal } from './jobContracts.js';

export type DrawingAuthority = { role: UserRole; isAdmin: boolean; canEdit: boolean };
/** Existing project drawing rights, fenced until commit; this grants no PF/model authority. */
export async function drawingAccessTransaction<T>(pool: Pool, projectId: string, who: JobPrincipal, operation: (client: PoolClient, authority: DrawingAuthority) => Promise<T>, { edit = false }: { edit?: boolean } = {}): Promise<T> {
  if (!policyUuidSchema.safeParse(projectId).success) throw new PathFinderError('INVALID_DRAWING_PROJECT', 400, 'Use a valid project identifier.');
  if (!policyUuidSchema.safeParse(who.userId).success || !policyUuidSchema.safeParse(who.loginId).success) throw new PathFinderError('LOGIN_REFRESH_REQUIRED', 401, 'Sign in again.');
  assertLoginNotExpired(who);
  const client = await pool.connect(); let began = false;
  try {
    await client.query('BEGIN'); began = true;
    // Match PF/policy project-first order while allowing FK KEY SHARE operations.
    const exists = (await client.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [projectId])).rows.length === 1;
    const account = (await client.query<{ is_admin: boolean; role: UserRole }>('SELECT is_admin,role FROM users WHERE id=$1 FOR SHARE', [who.userId])).rows[0];
    if (!account) throw new PathFinderError('LOGIN_REVOKED', 401, 'Sign in again.');
    await requireCurrentLogin(client, who);
    const role = resolveUserRole(account), isAdmin = account.is_admin === true;
    // Assignment locking fences revocation for assigned readers and Engineer edits.
    const assigned = isAdmin ? false : (await client.query('SELECT user_id FROM user_project_access WHERE user_id=$1 AND project_id=$2 FOR SHARE', [who.userId, projectId])).rows.length === 1;
    const canRead = isAdmin || role === 'engineer' || assigned;
    const canEdit = isAdmin || role === 'engineer' && assigned;
    if (!canRead || edit && !canEdit) throw new PathFinderError('DRAWING_ACCESS_REQUIRED', 403, edit ? 'Project editing permission is required.' : 'Project drawing access is required.');
    // Unauthorized principals never learn whether a project exists.
    if (!exists) throw new PathFinderError('PROJECT_NOT_FOUND', 404, 'The project is unavailable.');
    const result = await operation(client, { role, isAdmin, canEdit });
    assertLoginNotExpired(who);
    await client.query('COMMIT'); began = false; return result;
  } catch (error) {
    if (began) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
