import type { Pool, PoolClient } from 'pg';
import { PathFinderError } from './errors.js';
import type { JobPrincipal } from './jobContracts.js';
import { transaction } from './transactions.js';

/** Authenticated HTTP identity; never accepts an actor or login from a request body. */
export function requestPrincipal(req:{userId?:string;loginId?:string;loginExpiresAt?:number}):JobPrincipal {
  if (!req.userId || !req.loginId || !req.loginExpiresAt) throw new PathFinderError('LOGIN_REFRESH_REQUIRED',401,'Sign in again to refresh the authenticated session.');
  return {userId:req.userId,loginId:req.loginId,loginExpiresAt:req.loginExpiresAt};
}
export function assertLoginNotExpired(who:JobPrincipal):void {
  if (!Number.isSafeInteger(who.loginExpiresAt) || who.loginExpiresAt <= Date.now()) throw new PathFinderError('LOGIN_EXPIRED',401);
}
export async function requireCurrentLogin(client:PoolClient,who:JobPrincipal):Promise<void> {
  assertLoginNotExpired(who);
  await client.query(`INSERT INTO viewer_login_bindings(login_id,user_id,expires_at) VALUES($1,$2,$3)
    ON CONFLICT(login_id) DO NOTHING`,[who.loginId,who.userId,new Date(who.loginExpiresAt)]);
  const binding = (await client.query<{user_id:string;expires_at:Date;revoked_at:Date|null}>(
    'SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings WHERE login_id=$1 FOR SHARE',[who.loginId])).rows[0];
  if (!binding || binding.user_id !== who.userId || binding.revoked_at || new Date(binding.expires_at).getTime() !== who.loginExpiresAt) throw new PathFinderError('LOGIN_REVOKED',401);
}
/** All user-authorized PF transactions share the same locks and final expiry boundary. */
export async function principalTransaction<T>(pool:Pool,projectId:string,who:JobPrincipal,operation:(client:PoolClient)=>Promise<T>):Promise<T> {
  return transaction(pool,async client => {
    // Serialize PF work while allowing unrelated FK KEY SHARE checks during imports/admin assignment.
    if (!(await client.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE',[projectId])).rows.length) throw new PathFinderError('PROJECT_NOT_FOUND',404);
    const user=(await client.query<{is_admin:boolean}>('SELECT is_admin FROM users WHERE id=$1 FOR SHARE',[who.userId])).rows[0];
    if (user?.is_admin !== true) throw new PathFinderError('ADMIN_REQUIRED',403,'Administrator access required.');
    await requireCurrentLogin(client,who);
    const value=await operation(client);assertLoginNotExpired(who);return value;
  });
}
