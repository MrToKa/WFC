// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
const tx=vi.hoisted(()=>vi.fn());
vi.mock('./auth.js',()=>({principalTransaction:tx}));
import { checkedAcceptedBaseline, prefetchAcceptedRows, readAcceptedRows, type AcceptedRows } from './acceptedBaselineRows.js';

const who={userId:'actor',loginId:'login',loginExpiresAt:Date.parse('2099-01-01')};
afterEach(()=>{vi.restoreAllMocks();tx.mockReset();});
describe('bounded background baseline reads',()=>{
  it('finishes 1223 cables beyond the old two-minute limit in separate snapshots, retaining compact checked facts',async()=>{
    const ids=Array.from({length:1223},(_,i)=>String(i));
    let elapsed=0,inTransaction=false;
    const clock=vi.spyOn(Date,'now').mockImplementation(()=>elapsed);
    const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
      if(sql.startsWith('SELECT id FROM cables'))return {rows:ids.map(id=>({id}))};
      if(sql.includes('revision:latest-accepted'))return {rows:(args[1] as string[]).map(id=>({cable_id:id,row_version:'v1',body:'x'.repeat(20000)}))};
      return {rows:[]};
    });
    const client={query} as unknown as PoolClient;
    tx.mockImplementation(async(_pool,_project,_who,run,options)=>{
      expect(options).toEqual({snapshot:true,persistedLogin:true});
      inTransaction=true;try{return await run(client);}finally{inTransaction=false;}
    });
    const report=vi.fn(async()=>{expect(inTransaction).toBe(false);});
    const prepare=vi.fn(async(_client,rows)=>{
      expect(inTransaction).toBe(true);elapsed+=3000;
      return rows.map((row:Record<string,unknown>)=>({cable_id:row.cable_id,row_version:row.row_version,[checkedAcceptedBaseline]:{receiptId:'checked'}}));
    });
    const cache=await prefetchAcceptedRows({} as Pool,'project',who,undefined,22,1800000,report,prepare);
    expect(elapsed).toBeGreaterThan(120000);expect(cache.size).toBe(1223);
    expect(tx).toHaveBeenCalledTimes(57);expect(report).toHaveBeenLastCalledWith(1223,1223);
    expect(cache.get('1222')?.[checkedAcceptedBaseline]).toEqual({receiptId:'checked'});
    expect(cache.get('1222')).not.toHaveProperty('body');clock.mockRestore();
  });
  it('stops after cancellation without dispatching the next batch',async()=>{
    const controller=new AbortController();
    const query=vi.fn(async(sql:string)=>sql.startsWith('SELECT id FROM cables')?{rows:[{id:'a'},{id:'b'}]}:{rows:[]});
    tx.mockImplementation(async(_p,_id,_who,run)=>run({query}));
    const report=vi.fn(async(done:number)=>{if(done===1)controller.abort();});
    await expect(prefetchAcceptedRows({} as Pool,'project',who,undefined,1,Date.now()+1800000,report,undefined,controller.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(query.mock.calls.filter(([sql])=>sql.includes('revision:latest-accepted'))).toHaveLength(1);
  });
  it('refuses a finite expired budget and never queries cable history',async()=>{
    const query=vi.fn();tx.mockImplementation(async(_p,_id,_who,run)=>run({query}));
    await expect(prefetchAcceptedRows({} as Pool,'project',who,undefined,1,Date.now()-1,async()=>{})).rejects.toMatchObject({code:'RECALCULATION_COLLECTION_DEADLINE'});
    expect(query).not.toHaveBeenCalled();
  });
  it.each([0,-1,NaN,Infinity])('rejects invalid batch size %s before issuing queries',async chunk=>{
    await expect(prefetchAcceptedRows({} as Pool,'project',who,undefined,chunk,Date.now()+1800000,async()=>{})).rejects.toMatchObject({code:'BULK_PREPARATION_BOUNDS_INVALID'});
    expect(tx).not.toHaveBeenCalled();
  });
  it('invalidates changed, newly accepted, and deleted receipts while reusing only matching versions',async()=>{
    const cache:AcceptedRows=new Map([
      ['same',{cable_id:'same',row_version:'v1',[checkedAcceptedBaseline]:{receiptId:'cached'}}],
      ['changed',{cable_id:'changed',row_version:'v1'}],['new',null],['deleted',{cable_id:'deleted',row_version:'v1'}],['none',null],
    ]);
    const query=vi.fn(async(sql:string,args:unknown[])=>sql.includes('revision:latest-accepted')
      ?{rows:(args[1] as string[]).filter(id=>id!=='deleted').map(id=>({cable_id:id,row_version:'v2'}))}
      :{rows:[{cable_id:'same',row_version:'v1'},{cable_id:'changed',row_version:'v2'},{cable_id:'new',row_version:'v2'}]});
    const rows=await readAcceptedRows({query} as unknown as PoolClient,'project',[...cache.keys()],cache);
    expect(query.mock.calls[1][1][1]).toEqual(['changed','new','deleted']);
    expect(rows.map(row=>row.cable_id)).toEqual(['same','changed','new']);
    expect(rows[0]).toBe(cache.get('same'));
  });
});
