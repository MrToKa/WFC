import type { Pool, PoolClient } from 'pg';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import type { JobPrincipal } from './jobContracts.js';
import { assertLoginNotExpired } from './auth.js';
import { PathFinderError } from './errors.js';

export const PREFLIGHT_AUTHORIZATION_BOUNDS = Object.freeze({ acquisitionMilliseconds: 5000, deadlineMilliseconds: 10000 });
const busy = () => new PathFinderError('PREFLIGHT_DATABASE_BUSY', 503, 'The access check could not finish. Retain any saved command before retrying.');

/** Preliminary access check before reading an HTTP command body. This is not
 * command authority: every real operation retains its locked current-login,
 * project, revision and immutable-command checks. A newly signed login may not
 * have been registered yet; only the real command may register it. */
export async function authorizePathFinderPreflight(pool: Pool, projectId: string, who: JobPrincipal, externalSignal?: AbortSignal): Promise<void> {
  policyUuidSchema.parse(projectId); policyUuidSchema.parse(who.userId); policyUuidSchema.parse(who.loginId);
  assertLoginNotExpired(who); externalSignal?.throwIfAborted();
  const deadline = new AbortController(), signal = externalSignal ? AbortSignal.any([externalSignal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(busy()), PREFLIGHT_AUTHORIZATION_BOUNDS.deadlineMilliseconds);
  let client: PoolClient | undefined, released = false, acquisitionExpired = false, acquisitionTimer: ReturnType<typeof setTimeout> | undefined;
  const release = (discard = false) => { if (client && !released) { released = true; client.release(discard); } };
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => { release(true); rejectAbort(signal.reason); };
  signal.addEventListener('abort', abort, { once: true });
  const check = () => { signal.throwIfAborted(); assertLoginNotExpired(who); };
  const query = (sql: string, args?: unknown[]) => Promise.race([client!.query(sql, args), aborted]);
  try {
    check();
    const acquiring = pool.connect().then(value => {
      if (acquisitionExpired || signal.aborted) { value.release(true); throw busy(); }
      return value;
    });
    client = await Promise.race([acquiring, aborted, new Promise<never>((_, reject) => {
      acquisitionTimer = setTimeout(() => { acquisitionExpired = true; reject(busy()); }, PREFLIGHT_AUTHORIZATION_BOUNDS.acquisitionMilliseconds);
    })]);
    clearTimeout(acquisitionTimer); check();
    await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await query("SET LOCAL lock_timeout='1000ms';SET LOCAL statement_timeout='3000ms';SET LOCAL idle_in_transaction_session_timeout='10000ms'");
    // One MVCC snapshot; no FOR UPDATE/SHARE or project mutex. Background
    // calculations can hold the project's write lock during this preflight.
    const row = (await query(`/* pathfinder:preflight-authorization */ SELECT u.is_admin,l.login_id,l.user_id AS login_user,
      l.expires_at,l.revoked_at,EXISTS(SELECT 1 FROM projects p WHERE p.id=$1) AS project_exists
      FROM users u LEFT JOIN viewer_login_bindings l ON l.login_id=$3 WHERE u.id=$2`, [projectId, who.userId, who.loginId])).rows[0] as {
        is_admin: boolean; login_id: string | null; login_user: string | null; expires_at: Date | string | null;
        revoked_at: Date | string | null; project_exists: boolean;
      } | undefined;
    check();
    if (!row) throw new PathFinderError('LOGIN_REVOKED', 401);
    if (!row.is_admin) throw new PathFinderError('ADMIN_REQUIRED', 403);
    if (row.login_id !== null && (row.login_id !== who.loginId || row.login_user !== who.userId || row.revoked_at !== null
      || row.expires_at === null || new Date(row.expires_at).getTime() !== who.loginExpiresAt))
      throw new PathFinderError('LOGIN_REVOKED', 401);
    // Existence is returned only after administrator and any registered login
    // have been checked. No absent login row is inserted by this read.
    if (!row.project_exists) throw new PathFinderError('PROJECT_NOT_FOUND', 404);
    await query('ROLLBACK'); check(); release();
  } catch (error) {
    if (client && !released) { try { await query('ROLLBACK'); } catch { release(true); } }
    if (signal.aborted) throw signal.reason;
    if (['55P03', '57014', '40001'].includes((error as { code?: string })?.code ?? '')) throw busy();
    throw error;
  } finally { clearTimeout(timer); clearTimeout(acquisitionTimer); signal.removeEventListener('abort', abort); release(); }
}
