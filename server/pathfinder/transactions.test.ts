// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PathFinderError } from './errors.js';
import { transaction } from './transactions.js';

function fixture(failures:Record<string,unknown>={}){
  const calls:string[]=[],release=vi.fn();
  const query=vi.fn(async(sql:string)=>{
    calls.push(sql);
    if(Object.hasOwn(failures,sql))throw failures[sql];
    return {rows:[]};
  });
  const client={query,release} as unknown as PoolClient;
  const connect=vi.fn(async()=>client),pool={connect} as unknown as Pool;
  return {calls,release,query,client,connect,pool};
}
function deferred<T>(){
  let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

describe('human Path Finder transaction acknowledgement boundary',()=>{
  it('returns the exact committed result and never rolls back a confirmed commit',async()=>{
    const db=fixture(),value={receiptId:'synthetic-receipt'},operation=vi.fn(async(c:PoolClient)=>{
      expect(c).toBe(db.client);expect(db.calls).toEqual(['BEGIN']);
      await c.query('SYNTHETIC OWNED WRITE');return value;
    });
    expect(await transaction(db.pool,operation)).toBe(value);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(db.calls).toEqual(['BEGIN','SYNTHETIC OWNED WRITE','COMMIT']);
    expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('preserves connection refusal without claiming a client or invoking the operation',async()=>{
    const db=fixture(),failure=new Error('Synthetic acquisition refusal.'),operation=vi.fn();
    db.connect.mockRejectedValue(failure);
    await expect(transaction(db.pool,operation)).rejects.toBe(failure);
    expect(operation).not.toHaveBeenCalled();expect(db.query).not.toHaveBeenCalled();expect(db.release).not.toHaveBeenCalled();
  });

  it('does not invoke the operation when BEGIN fails and reuses only a confirmed clean connection',async()=>{
    const failure=new Error('Synthetic BEGIN refusal.'),db=fixture({BEGIN:failure}),operation=vi.fn();
    await expect(transaction(db.pool,operation)).rejects.toBe(failure);
    expect(db.calls).toEqual(['BEGIN','ROLLBACK']);expect(operation).not.toHaveBeenCalled();
    expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('preserves the original current-authority refusal after its confirmed rollback',async()=>{
    const db=fixture(),failure=new PathFinderError('LOGIN_REVOKED',401);
    await expect(transaction(db.pool,async()=>{throw failure;})).rejects.toBe(failure);
    expect(db.calls).toEqual(['BEGIN','ROLLBACK']);
    expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('rolls back a precommit failure after a provisional write without replacing its original error',async()=>{
    const db=fixture(),failure=new Error('Synthetic second write refusal.');
    await expect(transaction(db.pool,async(c)=>{await c.query('SYNTHETIC OWNED WRITE');throw failure;})).rejects.toBe(failure);
    expect(db.calls).toEqual(['BEGIN','SYNTHETIC OWNED WRITE','ROLLBACK']);
    expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('discards a failed rollback while retaining its original precommit failure',async()=>{
    const failure=new PathFinderError('PROPOSAL_STALE',409),db=fixture({ROLLBACK:new Error('Synthetic rollback acknowledgement loss.')});
    await expect(transaction(db.pool,async()=>{throw failure;})).rejects.toBe(failure);
    expect(db.calls).toEqual(['BEGIN','ROLLBACK']);expect(db.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('classifies a persisted but unacknowledged commit as unknown and never claims a rollback',async()=>{
    const db=fixture();let persisted=false;
    db.query.mockImplementation(async(sql:string)=>{
      db.calls.push(sql);
      if(sql==='COMMIT'){persisted=true;throw new Error('Synthetic lost COMMIT acknowledgement with private transport detail.');}
      return {rows:[]};
    });
    const operation=vi.fn(async(c:PoolClient)=>{await c.query('SYNTHETIC IMMUTABLE PROPOSAL AND SEAL');return {provisional:'result'};});
    const error=await transaction(db.pool,operation).then(()=>null,error=>error);
    expect(persisted).toBe(true);expect(operation).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(PathFinderError);
    expect(error).toMatchObject({code:'PATHFINDER_COMMIT_OUTCOME_UNKNOWN',status:503});
    expect(error.message).not.toContain('private transport detail');
    expect(db.calls).toEqual(['BEGIN','SYNTHETIC IMMUTABLE PROPOSAL AND SEAL','COMMIT']);
    expect(db.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('does not mistake an unacknowledged COMMIT error for an ordinary precommit refusal',async()=>{
    const db=fixture({COMMIT:new PathFinderError('SYNTHETIC_DRIVER_ERROR',500,'Private driver message.')});
    await expect(transaction(db.pool,async()=> 'provisional')).rejects.toMatchObject({code:'PATHFINDER_COMMIT_OUTCOME_UNKNOWN',status:503});
    expect(db.calls).toEqual(['BEGIN','COMMIT']);expect(db.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('awaits the known in-flight operation before committing or releasing its connection',async()=>{
    const db=fixture(),pending=deferred<string>(),entered=deferred<void>();
    const result=transaction(db.pool,async(c)=>{await c.query('SYNTHETIC OWNED WRITE');entered.resolve();return pending.promise;});
    await entered.promise;
    expect(db.calls).toEqual(['BEGIN','SYNTHETIC OWNED WRITE']);expect(db.release).not.toHaveBeenCalled();
    pending.resolve('confirmed');expect(await result).toBe('confirmed');
    expect(db.calls).toEqual(['BEGIN','SYNTHETIC OWNED WRITE','COMMIT']);expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});
