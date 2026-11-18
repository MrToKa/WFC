import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStoredRouteDisplay } from './storedRouteDisplay';
import { parseRouteInput } from './routeValidation';
import { RoutingTrayApiError } from '@/api/routingTrays';
import type { ViewerEvent, ViewerLoadSnapshot } from './ViewerController';
import type { SavedRouteEndpoints } from '../../viewer-runtime/protocol.mjs';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function deferred<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; }
function fixture() {
  let load:ViewerLoadSnapshot={instanceId:id(1),projectId:id(2),modelVersionId:id(3),loadId:id(4),selectionRevision:2,ready:true};let current=true;
  const request=deferred<string|null>(),db=deferred<Array<{id:string;projectId:string;name:string}>>();
  const viewer={getLoadSnapshot:()=>load,showRoute:vi.fn(()=>request.promise),cancel:vi.fn(),clear:vi.fn(()=>id(8))};
  const fetchTrays=vi.fn(()=>db.promise),onAccessFailure=vi.fn();
  const display=createStoredRouteDisplay({viewer,projectId:id(2),token:'current-token',isCurrent:()=>current,fetchTrays,onAccessFailure});
  const event=(raw='/BC001',requestId=id(5),state:'found'|'missing'='found'):ViewerEvent=>({type:'ROUTE_RESULT',requestId,
    identity:{protocolVersion:1,instanceId:id(1),projectId:id(2),modelVersionId:id(3),loadId:id(4),requestId},
    payload:{rawRouting:raw,source:'cable',cableId:id(6),segments:parseRouteInput(raw).segments.map(segment=>({...segment,
      model:{state,matchCount:state==='found'?1:0,drawable:state==='found'}})),ignored:[],drawableCount:state==='found'?1:0,lineCount:state==='found'?1:0,warnings:[]}});
  return {viewer,display,request,db,event,fetchTrays,onAccessFailure,setLoad:(next:ViewerLoadSnapshot)=>{load=next;},getLoad:()=>load,setCurrent:(v:boolean)=>{current=v;}};
}
afterEach(()=>vi.useRealTimers());
describe('saved cable routing display without calculation or writes',()=>{
  it('draws the recorded endpoint-to-endpoint geometry before considering tray names and clears it on Hide', async () => {
    const f=fixture(), path={pathId:id(22),points:[[2,3,4],[5,6,7]] as [number,number,number][],objectIds:[]};
    const draw=vi.fn(async()=>id(23));
    expect(await f.display.showSaved('/BC001',id(6),async()=>path,draw)).toEqual({status:'historical'});
    expect(draw).toHaveBeenCalledExactlyOnceWith(path); expect(f.fetchTrays).not.toHaveBeenCalled(); expect(f.viewer.showRoute).not.toHaveBeenCalled();
    f.display.clear(); expect(f.viewer.clear).toHaveBeenCalledOnce();
  });
  it('falls back to current trays with the confirmed points when there is no recorded polyline', async () => {
    const f=fixture(), draw=vi.fn(), endpoints: SavedRouteEndpoints = { from: [2, 3, 4], to: [5, 6, 7] };
    const shown=f.display.showSaved('/BC001',id(6),async()=>null,draw,{ endpoints });
    await vi.waitFor(()=>expect(f.viewer.showRoute).toHaveBeenCalledExactlyOnceWith('/BC001','cable',id(6),endpoints));
    f.request.resolve(id(5));f.db.resolve([{id:id(7),projectId:id(2),name:'BC001'}]);f.display.onEvent(f.event());
    expect((await shown)?.status).toBe('complete');expect(draw).not.toHaveBeenCalled();
  });
  it('a cancelled lookup or superseded model cannot paint a historical result or start a tray fallback',async()=>{
    const f=fixture(), path=deferred<null>(), draw=vi.fn(), abort=new AbortController();
    const shown=f.display.showSaved('/BC001',id(6),()=>path.promise,draw,{ signal: abort.signal });
    abort.abort();expect(await shown).toBeNull();path.resolve(null);await Promise.resolve();
    expect(draw).not.toHaveBeenCalled();expect(f.viewer.showRoute).not.toHaveBeenCalled();
    const next=deferred<null>(), nextShow=f.display.showSaved('/BC001',id(6),()=>next.promise,draw);
    f.setLoad({...f.getLoad(),loadId:id(25)});next.resolve(null);expect(await nextShow).toBeNull();expect(f.viewer.showRoute).not.toHaveBeenCalled();
  });
  it('a replacement clears the in-flight drawing and a late completion cannot clear the new path',async()=>{
    const f=fixture(), firstDraw=deferred<string|null>(), first=vi.fn(()=>firstDraw.promise);
    const path={pathId:id(22),points:[[2,3,4],[5,6,7]] as [number,number,number][],objectIds:[]};
    const a=f.display.showSaved('/A',id(6),async()=>path,first);
    await vi.waitFor(()=>expect(first).toHaveBeenCalledOnce());
    const b=f.display.showSaved('/B',id(7),async()=>({...path,pathId:id(24)}),async()=>id(25));
    expect(await a).toBeNull();expect(await b).toEqual({status:'historical'});
    expect(f.viewer.clear).toHaveBeenCalledOnce();firstDraw.resolve(id(23));await Promise.resolve();
    expect(f.viewer.clear).toHaveBeenCalledOnce();f.display.clear();expect(f.viewer.clear).toHaveBeenCalledTimes(2);
  });
  it('waits for current native geometry synchronization before submitting Show',async()=>{
    const f=fixture(),ready=deferred<boolean>(),prepare=vi.fn(()=>ready.promise);
    const display=createStoredRouteDisplay({viewer:f.viewer,projectId:id(2),token:'token',isCurrent:()=>true,fetchTrays:f.fetchTrays,prepare});
    const shown=display.show('/BC001',id(6));expect(f.viewer.showRoute).not.toHaveBeenCalled();
    ready.resolve(true);await Promise.resolve();expect(f.viewer.showRoute).toHaveBeenCalledOnce();
    f.request.resolve(id(5));f.db.resolve([{id:id(7),projectId:id(2),name:'BC001'}]);display.onEvent(f.event());
    expect((await shown)?.status).toBe('complete');
  });
  it('refuses incomplete CAD synchronization without submitting stale geometry',async()=>{
    const f=fixture(),prepare=vi.fn(async()=>false);
    const display=createStoredRouteDisplay({viewer:f.viewer,projectId:id(2),token:'token',isCurrent:()=>true,fetchTrays:f.fetchTrays,prepare});
    await expect(display.show('/BC001',id(6))).rejects.toThrow('could not be synchronized');
    expect(f.viewer.showRoute).not.toHaveBeenCalled();
  });
  it('cancellation while CAD synchronization is pending never sends an obsolete Show',async()=>{
    const f=fixture(),ready=deferred<boolean>(),prepare=vi.fn(()=>ready.promise);
    const display=createStoredRouteDisplay({viewer:f.viewer,projectId:id(2),token:'token',isCurrent:()=>true,fetchTrays:f.fetchTrays,prepare});
    const abort=new AbortController(),shown=display.show('/BC001',id(6),{signal:abort.signal});abort.abort();
    expect(await shown).toBeNull();ready.resolve(true);await Promise.resolve();expect(f.viewer.showRoute).not.toHaveBeenCalled();
  });
  it('a model change during CAD synchronization cannot display or clear its replacement',async()=>{
    const f=fixture(),ready=deferred<boolean>(),prepare=vi.fn(()=>ready.promise);
    const display=createStoredRouteDisplay({viewer:f.viewer,projectId:id(2),token:'token',isCurrent:()=>true,fetchTrays:f.fetchTrays,prepare});
    const shown=display.show('/BC001',id(6));f.setLoad({...f.getLoad(),loadId:id(80)});ready.resolve(true);
    expect(await shown).toBeNull();expect(f.viewer.showRoute).not.toHaveBeenCalled();expect(f.viewer.clear).not.toHaveBeenCalled();
  });
  it('combines an early exact frame reply with a fresh project GET',async()=>{
    const f=fixture(),shown=f.display.show('/BC001',id(6));f.display.onEvent(f.event());
    f.db.resolve([{id:id(7),projectId:id(2),name:'BC001'}]);f.request.resolve(id(5));
    expect(await shown).toMatchObject({status:'complete',rawRouting:'/BC001',cableId:id(6)});
    expect(f.viewer.showRoute).toHaveBeenCalledExactlyOnceWith('/BC001','cable',id(6));
    expect(f.fetchTrays).toHaveBeenCalledWith(id(2),'current-token',{signal:expect.any(AbortSignal)});
    f.display.clear();expect(f.viewer.clear).toHaveBeenCalledExactlyOnceWith('user',{preserveCamera:true});
  });
  it('does not cancel SHOW when its own delayed CLEAR acknowledgement arrives',async()=>{
    const f=fixture(),shown=f.display.show('/BC001',id(6));f.request.resolve(id(5));await Promise.resolve();
    f.display.onEvent({type:'ROUTE_CLEARED',requestId:id(9),payload:{reason:'selection'}});
    f.db.resolve([{id:id(7),projectId:id(2),name:'BC001'}]);f.display.onEvent(f.event());
    expect((await shown)?.status).toBe('complete');expect(f.viewer.cancel).not.toHaveBeenCalled();
  });
  it('reports missing project/model identifiers without automatic geometry',async()=>{
    const f=fixture(),shown=f.display.show('/BC001',id(6));f.request.resolve(id(5));f.db.resolve([]);f.display.onEvent(f.event('/BC001',id(5),'missing'));
    const result=await shown;expect(result?.status).toBe('none');expect(result?.warnings.map(w=>w.code)).toContain('PROJECT_MISSING');expect(result?.segments[0].model.state).toBe('missing');
  });
  it('rejects a mismatched same-request reply',async()=>{
    const f=fixture(),shown=f.display.show('/BC001',id(6)),rejected=expect(shown).rejects.toMatchObject({code:'ROUTE_RESULT_MISMATCH'});
    f.display.onEvent(f.event('/DIFFERENT'));f.db.resolve([]);f.request.resolve(id(5));await rejected;
  });
  it('ignores foreign load and request replies',async()=>{
    const f=fixture(),shown=f.display.show('/BC001',id(6)),foreign=f.event();foreign.identity={...foreign.identity!,loadId:id(20)};f.display.onEvent(foreign);
    f.display.onEvent(f.event('/DIFFERENT',id(21)));f.request.resolve(id(5));f.db.resolve([{id:id(7),projectId:id(2),name:'BC001'}]);
    await Promise.resolve();f.display.onEvent(f.event());expect((await shown)?.status).toBe('complete');
  });
  it('caller cancellation ignores a late request return',async()=>{
    const f=fixture(),abort=new AbortController(),shown=f.display.show('/BC001',id(6),{signal:abort.signal});abort.abort();
    expect(await shown).toBeNull();f.request.resolve(id(5));await Promise.resolve();expect(f.viewer.cancel).toHaveBeenCalledWith(id(5));expect(f.viewer.clear).toHaveBeenCalledWith('user',{preserveCamera:true});
  });
  it('model replacement cannot clear the replacement view',async()=>{
    const f=fixture(),shown=f.display.show('/BC001',id(6));f.setLoad({...f.getLoad(),loadId:id(30)});f.display.onEvent(f.event());
    expect(await shown).toBeNull();f.display.clear();expect(f.viewer.clear).not.toHaveBeenCalled();
  });
  it('explicit ownership retirement cannot hide a later computed path',async()=>{
    const f=fixture(),shown=f.display.show('/BC001',id(6));f.display.onEvent(f.event());f.db.resolve([{id:id(7),projectId:id(2),name:'BC001'}]);f.request.resolve(id(5));await shown;
    f.display.cancel();f.display.clear();expect(f.viewer.clear).not.toHaveBeenCalled();
  });
  it('bounded timeout releases its promise preserving the camera',async()=>{
    vi.useFakeTimers();const f=fixture(),shown=f.display.show('/BC001',id(6)),rejected=expect(shown).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(75_000);await rejected;expect(f.viewer.clear).toHaveBeenCalledWith('user',{preserveCamera:true});
  });
  it('stale application scope refuses display before GET or viewer command',async()=>{
    const f=fixture();f.setCurrent(false);expect(await f.display.show('/BC001',id(6))).toBeNull();expect(f.viewer.showRoute).not.toHaveBeenCalled();expect(f.fetchTrays).not.toHaveBeenCalled();
  });
  it('nonaccess catalog failure remains unavailable instead of inventing project matches',async()=>{
    const f=fixture(),api=vi.fn().mockRejectedValue(new RoutingTrayApiError('TRAY_SERVICE_FAILED',503));
    const display=createStoredRouteDisplay({viewer:f.viewer,projectId:id(2),token:'token',isCurrent:()=>true,fetchTrays:api});
    const shown=display.show('/BC001',id(6));display.onEvent(f.event());f.request.resolve(id(5));expect(await shown).toMatchObject({databaseCheck:'unavailable',status:'partial'});
  });
});
