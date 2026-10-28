// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {schedulerTransaction} from './schedulerTransaction.js';

function fixture(failures:Record<string,unknown>={}){
  const calls:string[]=[],release=vi.fn();
  const query=vi.fn(async(sql:string)=>{calls.push(sql);if(Object.hasOwn(failures,sql))throw failures[sql];return {rows:[]};});
  const client={query,release} as unknown as PoolClient;
  const connect=vi.fn(async()=>client),pool={connect} as unknown as Pool;
  return {calls,query,release,client,connect,pool};
}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());

describe('bounded scheduler transaction transport (mocked connection and clock)',()=>{
  it('sets bounded SQL limits before the operation and commits only its exact returned result',async()=>{
    const db=fixture(),value={generation:'7'},operation=vi.fn(async(c:PoolClient)=>{expect(c).toBe(db.client);expect(db.calls).toHaveLength(2);expect(db.calls[0]).toBe('BEGIN');return value;});
    expect(await schedulerTransaction(db.pool,operation)).toBe(value);
    expect(db.calls[1]).toContain("lock_timeout='3000ms'");expect(db.calls[1]).toContain("statement_timeout='15000ms'");expect(db.calls[1]).toContain("idle_in_transaction_session_timeout='30000ms'");
    expect(db.calls.at(-1)).toBe('COMMIT');expect(db.calls).not.toContain('ROLLBACK');expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses an already cancelled request before acquiring a connection',async()=>{
    const db=fixture(),controller=new AbortController(),reason=new Error('Synthetic cancellation.');controller.abort(reason);const operation=vi.fn();
    await expect(schedulerTransaction(db.pool,operation,controller.signal)).rejects.toBe(reason);
    expect(db.connect).not.toHaveBeenCalled();expect(operation).not.toHaveBeenCalled();expect(db.release).not.toHaveBeenCalled();
  });

  it('rechecks cancellation after acquisition and before the operation',async()=>{
    const db=fixture(),controller=new AbortController(),reason=new Error('Cancelled during acquisition.');
    db.connect.mockImplementation(async()=>{controller.abort(reason);return db.client;});const operation=vi.fn();
    await expect(schedulerTransaction(db.pool,operation,controller.signal)).rejects.toBe(reason);
    expect(operation).not.toHaveBeenCalled();expect(db.calls.at(-1)).toBe('ROLLBACK');expect(db.calls).not.toContain('COMMIT');expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('rolls back cancellation raised by the operation rather than committing its provisional result',async()=>{
    const db=fixture(),controller=new AbortController(),reason=new Error('Cancelled after provisional write.');
    const operation=vi.fn(async(c:PoolClient)=>{await c.query('SYNTHETIC OWNED WRITE');controller.abort(reason);return 'not committed';});
    await expect(schedulerTransaction(db.pool,operation,controller.signal)).rejects.toBe(reason);
    expect(db.calls).toContain('SYNTHETIC OWNED WRITE');expect(db.calls.at(-1)).toBe('ROLLBACK');expect(db.calls).not.toContain('COMMIT');expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('retains the original precommit error after a confirmed rollback and reuses only that clean connection',async()=>{
    const db=fixture(),failure=new Error('Synthetic operation refusal.');
    await expect(schedulerTransaction(db.pool,async()=>{throw failure;})).rejects.toBe(failure);
    expect(db.calls.at(-1)).toBe('ROLLBACK');expect(db.calls).not.toContain('COMMIT');expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('discards an unconfirmed rollback while retaining its original operation error',async()=>{
    const failure=new Error('Synthetic operation refusal.'),db=fixture({ROLLBACK:new Error('Synthetic lost rollback acknowledgement.')});
    await expect(schedulerTransaction(db.pool,async()=>{throw failure;})).rejects.toBe(failure);
    expect(db.calls.at(-1)).toBe('ROLLBACK');expect(db.calls).not.toContain('COMMIT');expect(db.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each([false,true])('reports an unknown COMMIT and discards its connection even when rollback failure is %s',async rollbackFails=>{
    const db=fixture({COMMIT:new Error('Synthetic lost COMMIT acknowledgement.'),...(rollbackFails?{ROLLBACK:new Error('Synthetic rollback transport failure.')}:{})});
    await expect(schedulerTransaction(db.pool,async()=>({provisional:'receipt'}))).rejects.toMatchObject({code:'SCHEDULER_COMMIT_OUTCOME_UNKNOWN',status:503});
    expect(db.calls.slice(-2)).toEqual(['COMMIT','ROLLBACK']);expect(db.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('does not invoke the operation when BEGIN refuses, and requires rollback before reuse',async()=>{
    const failure=new Error('Synthetic BEGIN failure.'),db=fixture({BEGIN:failure}),operation=vi.fn();
    await expect(schedulerTransaction(db.pool,operation)).rejects.toBe(failure);
    expect(db.calls).toEqual(['BEGIN','ROLLBACK']);expect(operation).not.toHaveBeenCalled();expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('rolls back a refused limit configuration before any operation can run',async()=>{
    const db=fixture(),failure=new Error('Synthetic SET failure.'),operation=vi.fn();
    db.query.mockImplementation(async(sql:string)=>{db.calls.push(sql);if(sql.startsWith('SET LOCAL'))throw failure;return{rows:[]};});
    await expect(schedulerTransaction(db.pool,operation)).rejects.toBe(failure);
    expect(operation).not.toHaveBeenCalled();expect(db.calls.at(-1)).toBe('ROLLBACK');expect(db.release).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('refuses a connection acquisition after five seconds and releases a late arrival without running SQL',async()=>{
    const db=fixture(),pending=deferred<PoolClient>(),operation=vi.fn();db.connect.mockImplementation(()=>pending.promise);
    const result=schedulerTransaction(db.pool,operation),rejected=expect(result).rejects.toMatchObject({code:'SCHEDULER_DATABASE_BUSY',status:503});
    await vi.advanceTimersByTimeAsync(4999);expect(db.release).not.toHaveBeenCalled();expect(operation).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);await rejected;
    expect(db.query).not.toHaveBeenCalled();expect(db.release).not.toHaveBeenCalled();
    pending.resolve(db.client);await vi.advanceTimersByTimeAsync(0);
    expect(db.release).toHaveBeenCalledExactlyOnceWith();expect(db.query).not.toHaveBeenCalled();expect(operation).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a connection refusal and clears the timeout without claiming ownership of a nonexistent client',async()=>{
    const db=fixture(),failure=new Error('Synthetic connection refusal.'),operation=vi.fn();db.connect.mockRejectedValue(failure);
    await expect(schedulerTransaction(db.pool,operation)).rejects.toBe(failure);
    expect(operation).not.toHaveBeenCalled();expect(db.query).not.toHaveBeenCalled();expect(db.release).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
});
