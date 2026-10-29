import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import * as api from '@/api/pathfinderGeometryTrace';
import {geometryTraceFixture} from '@/test/geometryTraceFixtures';
import {preparationIds as ids} from '@/test/preparationFixtures';
import {useGeometryTrace} from './useGeometryTrace';
import type {usePathFinder} from './usePathFinder';
vi.mock('@/api/pathfinderGeometryTrace',async original=>({...await original<typeof api>(),fetchGeometryTraces:vi.fn(),fetchGeometryTraceManifest:vi.fn(),fetchGeometryTraceObjects:vi.fn(),fetchGeometryObjectRevision:vi.fn(),createGeometryTrace:vi.fn()}));
function setup(){const fixture=geometryTraceFixture();vi.mocked(api.fetchGeometryTraces).mockResolvedValue(fixture.list);vi.mocked(api.fetchGeometryTraceManifest).mockResolvedValue(fixture.manifest);vi.mocked(api.fetchGeometryTraceObjects).mockResolvedValue(fixture.page);vi.mocked(api.fetchGeometryObjectRevision).mockResolvedValue(fixture.record);const pf={preparationAccess:{projectId:ids.project,loadedProjectId:ids.project,token:'current',isAdmin:true},data:{activeModel:{modelVersionId:ids.model,selectionRevision:'1'}},preparationViewerGeneration:1,cancelOperation:vi.fn(),refresh:vi.fn()} as unknown as ReturnType<typeof usePathFinder>;return {...fixture,pf};}
beforeEach(()=>vi.clearAllMocks());
describe('immutable traceability lifecycle',()=>{
 it('freezes and retries the exact unknown trace intent, then refreshes current state',async()=>{
  const {pf,manifest}=setup();vi.mocked(api.createGeometryTrace).mockRejectedValueOnce(new TypeError('Lost acknowledgement')).mockResolvedValueOnce({schemaVersion:'wfc.pf.geometry-trace-receipt.v1',trace:manifest,duplicate:true});
  const {result}=renderHook(()=>useGeometryTrace(pf,true));await waitFor(()=>expect(result.current.list).not.toBeNull());await act(()=>result.current.create(manifest.aggregateId,manifest.projection.sha256));expect(result.current.unknown).toBe(true);const command=vi.mocked(api.createGeometryTrace).mock.calls[0][2];await act(()=>result.current.create(ids.part,'b'.repeat(64)));expect(api.createGeometryTrace).toHaveBeenCalledTimes(1);await act(()=>result.current.retry());expect(vi.mocked(api.createGeometryTrace).mock.calls[1][2]).toBe(command);expect(result.current.unknown).toBe(false);
 });
 it('discards late results after the protected viewer generation changes',async()=>{
  const {pf,list}=setup();let finish!:(value:typeof list)=>void;vi.mocked(api.fetchGeometryTraces).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  const {result,rerender}=renderHook(({current})=>useGeometryTrace(current,true),{initialProps:{current:pf}});rerender({current:{...pf,preparationViewerGeneration:2}});await act(async()=>finish({...list,traces:[]}));await waitFor(()=>expect(result.current.list?.traces).toHaveLength(1));
 });
 it('refuses object bytes inconsistent with their saved index SHA',async()=>{
  const {pf,manifest,record}=setup();const {result}=renderHook(()=>useGeometryTrace(pf,true));await waitFor(()=>expect(result.current.list).not.toBeNull());await act(()=>result.current.open(manifest.id));vi.mocked(api.fetchGeometryObjectRevision).mockResolvedValue({...record,historicalModel:{...record.historicalModel,name:'Different record'}});await act(()=>result.current.inspect(record.id));expect(result.current.object).toBeNull();expect(result.current.error).toContain('immutable trace');
 });
});
