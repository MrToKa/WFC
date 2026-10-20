// @vitest-environment node
import {EventEmitter} from 'node:events';
import type {Request,Response} from 'express';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createLocationImpactReadHandlers} from './locationImpactRoutes.js';
import {PathFinderError} from './errors.js';
const id=(n:number)=>`db400000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
  const list=vi.fn().mockResolvedValue({fixture:'bounded-summary'}),progress=vi.fn().mockResolvedValue({fixture:'bounded-progress'});
  const req=Object.assign(new EventEmitter(),{params:{projectId:id(1),impactId:id(2)},query:{},userId:id(3),loginId:id(4),loginExpiresAt:Date.now()+60000}) as unknown as Request;
  const res=Object.assign(new EventEmitter(),{setHeader:vi.fn(),status:vi.fn(),json:vi.fn(),destroyed:false,writableEnded:false}) as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res);vi.mocked(res.json).mockImplementation(()=>{Object.defineProperty(res,'writableEnded',{value:true,writable:true});return res;});
  return {req,res,list,progress,handlers:createLocationImpactReadHandlers({list,progress})};
}
beforeEach(()=>vi.useRealTimers());afterEach(()=>vi.useRealTimers());
describe('bounded location impact GET handlers (mocked repository, no HTTP listener)',()=>{
  it('reads only the exact owned impact using authenticated principal and no-store',async()=>{
    const f=fixture();await f.handlers.progress(f.req,f.res);
    expect(f.progress).toHaveBeenCalledWith(id(1),{userId:id(3),loginId:id(4),loginExpiresAt:f.req.loginExpiresAt},id(2),expect.any(AbortSignal));
    expect(f.list).not.toHaveBeenCalled();expect(f.res.setHeader).toHaveBeenCalledWith('Cache-Control','private, no-store');
  });
  it('coerces a bounded history page without reading job items',async()=>{
    const f=fixture();f.req.query={beforeId:id(7),limit:'25'};await f.handlers.list(f.req,f.res);
    expect(f.list).toHaveBeenCalledWith(id(1),expect.anything(),{beforeId:id(7),limit:25},expect.any(AbortSignal));expect(f.progress).not.toHaveBeenCalled();
  });
  it.each([{limit:'101'},{actorId:id(8)},{beforeId:'bad'},{limit:['1','2']}])('refuses malformed/unowned history query %j',async query=>{
    const f=fixture();f.req.query=query as Request['query'];await f.handlers.list(f.req,f.res);expect(f.res.status).toHaveBeenCalledWith(400);expect(f.list).not.toHaveBeenCalled();
  });
  it('rejects query/body actor alternatives on exact progress',async()=>{
    const f=fixture();f.req.query={userId:id(8)};await f.handlers.progress(f.req,f.res);expect(f.res.status).toHaveBeenCalledWith(400);expect(f.progress).not.toHaveBeenCalled();
  });
  it.each([401,403,404,409])('preserves a bounded server refusal %s without private messages',async status=>{
    const f=fixture();f.progress.mockRejectedValue(new PathFinderError('FIXTURE_REFUSAL',status,'private fixture detail'));
    await f.handlers.progress(f.req,f.res);expect(f.res.status).toHaveBeenCalledWith(status);expect(JSON.stringify(vi.mocked(f.res.json).mock.calls)).not.toContain('private fixture detail');
  });
  it('caps materialized output instead of returning an item array',async()=>{
    const f=fixture();f.progress.mockResolvedValue({fixture:'x'.repeat(1024*1024)});await f.handlers.progress(f.req,f.res);expect(f.res.status).toHaveBeenCalledWith(413);
  });
  it('bounds a stalled dependency even if it ignores the abort signal',async()=>{
    vi.useFakeTimers();const f=fixture();f.progress.mockImplementation(()=>new Promise(()=>{}));const pending=f.handlers.progress(f.req,f.res);
    await vi.advanceTimersByTimeAsync(15000);await pending;expect(f.res.status).toHaveBeenCalledWith(503);
    expect((f.progress.mock.calls[0][3] as AbortSignal).aborted).toBe(true);
  });
});
