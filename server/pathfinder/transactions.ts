import type { Pool, PoolClient } from 'pg';
import { PathFinderError } from './errors.js';

/** A lost COMMIT acknowledgement cannot authorize a retry with replacement inputs. */
export async function transaction<T>(pool:Pool,operation:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await pool.connect();
  let commitStarted=false,discard=false;
  try {
    await client.query('BEGIN');
    const value=await operation(client);
    commitStarted=true;
    await client.query('COMMIT');
    return value;
  } catch(error) {
    if(commitStarted){
      // COMMIT may already have persisted. A subsequent ROLLBACK cannot prove
      // otherwise; discard this transport and let the caller reconcile its
      // original immutable intent against committed state.
      discard=true;
      throw new PathFinderError('PATHFINDER_COMMIT_OUTCOME_UNKNOWN',503,
        'The transaction acknowledgement was lost. Retain the original request and reconcile its saved result before retrying.');
    }
    try {await client.query('ROLLBACK');} catch {discard=true;}
    throw error;
  } finally {client.release(discard?true:undefined);}
}
