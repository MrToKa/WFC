import type { Pool, PoolClient } from 'pg';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { CABLE_WORKFLOW_READ_LIMITS } from '../../shared/pathfinderCableWorkflowQueries.js';
import type { JobPrincipal } from './jobContracts.js';
import { assertLoginNotExpired } from './auth.js';
import { PathFinderError } from './errors.js';

export const CABLE_WORKFLOW_SQL_BOUNDS = Object.freeze({ acquisitionMilliseconds: 5000, lockMilliseconds: 1000, statementMilliseconds: 3000, readBytes: 32 * 1024 ** 2 });
const fail = (code: string, status = 503): never => { throw new PathFinderError(code, status, 'Cable diagnostics are unavailable. Refresh the current project after signing in.'); };

/** Existing login only. This GET boundary never initializes login/schema or writes state. */
export async function cableWorkflowReadTransaction<T>(pool: Pool, projectId: string, who: JobPrincipal,
  operation: (client: PoolClient, check: () => void) => Promise<T>, externalSignal?: AbortSignal): Promise<T> {
  policyUuidSchema.parse(projectId); policyUuidSchema.parse(who.userId); policyUuidSchema.parse(who.loginId); assertLoginNotExpired(who);
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(new PathFinderError('WORKFLOW_DEADLINE_EXCEEDED', 503)), CABLE_WORKFLOW_READ_LIMITS.deadlineMilliseconds);
  const signal = externalSignal ? AbortSignal.any([externalSignal, controller.signal]) : controller.signal;
  let terminalReadError: PathFinderError | undefined;
  const check = () => { signal.throwIfAborted(); if (terminalReadError) throw terminalReadError; assertLoginNotExpired(who); };
  let client: PoolClient | undefined, released = false, acquisitionTimer: ReturnType<typeof setTimeout> | undefined;
  const release = (discard = false) => { if (client && !released) { released = true; client.release(discard); } };
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => { release(true); rejectAbort(signal.reason); };
  signal.addEventListener('abort', onAbort, { once: true });
  const query = (text: string, values?: unknown[]) => Promise.race([client!.query(text, values), aborted]);
  try {
    check(); let expired = false;
    const pending = pool.connect().then(value => { if (expired || signal.aborted) { value.release(true); return fail('WORKFLOW_DATABASE_BUSY'); } return value; });
    client = await Promise.race([pending, aborted, new Promise<never>((_, reject) => { acquisitionTimer = setTimeout(() => { expired = true; reject(new PathFinderError('WORKFLOW_DATABASE_BUSY', 503)); }, CABLE_WORKFLOW_SQL_BOUNDS.acquisitionMilliseconds); })]);
    clearTimeout(acquisitionTimer); check();
    await query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await query("SET LOCAL lock_timeout='1000ms';SET LOCAL statement_timeout='3000ms';SET LOCAL idle_in_transaction_session_timeout='15000ms'");
    const exists = (await query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [projectId])).rows.length === 1;
    const user = (await query('SELECT is_admin FROM users WHERE id=$1 FOR SHARE', [who.userId])).rows[0] as { is_admin: boolean } | undefined;
    if (!user) return fail('LOGIN_REVOKED', 401); if (!user.is_admin) return fail('ADMIN_REQUIRED', 403);
    const login = (await query('SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings WHERE login_id=$1 FOR SHARE', [who.loginId])).rows[0] as
      { user_id: string; expires_at: Date | string; revoked_at: Date | string | null } | undefined;
    if (!login) return fail('LOGIN_REFRESH_REQUIRED', 401);
    if (login.user_id !== who.userId || login.revoked_at !== null || new Date(login.expires_at).getTime() !== who.loginExpiresAt) return fail('LOGIN_REVOKED', 401);
    check(); if (!exists) return fail('PROJECT_NOT_FOUND', 404);
    let readBytes = 0;
    const read = Object.create(client) as PoolClient;
    read.query = (async (text: string, values?: unknown[]) => {
      check(); const command = text.replace(/^\s*(?:\/\*[\s\S]*?\*\/\s*)*/, '').trimStart();
      // Static internal SQL only; this is a defensive boundary, not a generic SQL sandbox.
      if (!/^SELECT\b/i.test(command) || command.replace(/;\s*$/, '').includes(';') || /\bINTO\b/i.test(command)
        || /\bset_config\s*\(/i.test(command)) return fail('WORKFLOW_NON_READ_OPERATION', 500);
      const result = await query(text, values); check();
      readBytes += Buffer.byteLength(JSON.stringify(result.rows));
      if (readBytes > CABLE_WORKFLOW_SQL_BOUNDS.readBytes) { terminalReadError = new PathFinderError('WORKFLOW_READ_LIMIT', 413); throw terminalReadError; }
      return result;
    }) as PoolClient['query'];
    const result = await Promise.race([operation(read, check), aborted]); check(); await query('COMMIT'); check(); release(); return result;
  } catch (error) {
    if (client && !released) { try { await query('ROLLBACK'); } catch { release(true); } }
    if (signal.aborted) throw signal.reason;
    const code = (error as { code?: string })?.code;
    if (code === '55P03' || code === '57014' || code === '40001') return fail('WORKFLOW_DATABASE_BUSY');
    throw error;
  } finally { clearTimeout(timeout); clearTimeout(acquisitionTimer); signal.removeEventListener('abort', onAbort); release(); }
}
