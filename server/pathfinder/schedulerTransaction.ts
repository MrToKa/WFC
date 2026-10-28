import type { Pool, PoolClient } from 'pg';
import { PathFinderError } from './errors.js';

/** Scheduler bookkeeping has no user grant. Discard uncertain transports rather than recycling them. */
export async function schedulerTransaction<T>(pool:Pool,operation:(c:PoolClient)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();let expired=false,timer:ReturnType<typeof setTimeout>|undefined;
  const acquisition=pool.connect().then(c=>{if(expired){c.release();throw new PathFinderError('SCHEDULER_DATABASE_BUSY',503);}return c;});
  let c:PoolClient;
  try{c=await Promise.race([acquisition,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new PathFinderError('SCHEDULER_DATABASE_BUSY',503));},5000);})]);}
  finally{if(timer)clearTimeout(timer);}
  let committing=false,discard=false;
  try{
    await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='30000ms'");
    signal?.throwIfAborted();const value=await operation(c);signal?.throwIfAborted();committing=true;await c.query('COMMIT');return value;
  }catch(error){discard=committing;try{await c.query('ROLLBACK');}catch{discard=true;}
    if(committing)throw new PathFinderError('SCHEDULER_COMMIT_OUTCOME_UNKNOWN',503);throw error;
  }finally{c.release(discard?true:undefined);}
}
