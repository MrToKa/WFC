import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTrays, exportTrays, fetchTrayAutoLength } from './trays';
import { request } from './http';
vi.mock('./http', async () => ({ ...await vi.importActual<typeof import('./http')>('./http'), request: vi.fn() }));
const id='11111111-1111-1111-1111-111111111111';
function metrics() { return {project:{id,projectNumber:'Synthetic',name:'Synthetic',customer:'Synthetic',manager:null,description:null,connectionGap:1,secondaryTrayLength:null,supportDistance:null,supportWeight:null,additionalBendingPercent:10,endConnectionLength:5,trayLoadSafetyFactor:null,supportDistanceOverrides:{},trayPurposeTemplates:{},cableLayout:{cableSpacing:null,considerBundleSpacingAsFree:null,minFreeSpacePercent:null,maxFreeSpacePercent:null,mv:null,power:null,vfd:null,control:null,customBundleRanges:null},createdAt:'2026',updatedAt:'2026'},trays:[],freeSpaceByTrayId:{},provenance:[],revisions:{catalogRevision:'1',drawingPolicyRevision:'2',drawingInputRevision:'3'},layoutAlgorithmVersion:'wfc-tray-placement-v2'}; }
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('authoritative tray drawing metrics',()=>{
  it('requests server metrics with explicit read authority while ordinary navigation remains light',async()=>{
    vi.mocked(request).mockResolvedValue(metrics());await fetchTrays(id,{drawingMetrics:true,token:'reader'});
    expect(request).toHaveBeenLastCalledWith(`/api/projects/${id}/trays?drawingMetrics=1`,{token:'reader'});
    await fetchTrays(id);expect(request).toHaveBeenLastCalledWith(`/api/projects/${id}/trays`,{token:undefined});
  });
  it('refuses incomplete provenance and invalid or unrelated occupancy values',async()=>{
    vi.mocked(request).mockResolvedValue({...metrics(),freeSpaceByTrayId:{[id]:90}});
    await expect(fetchTrays(id,{drawingMetrics:true})).rejects.toThrow('Shared drawing metrics');
    vi.mocked(request).mockResolvedValue({...metrics(),layoutAlgorithmVersion:'unknown'});
    await expect(fetchTrays(id,{drawingMetrics:true})).rejects.toThrow();
  });
  it('never sends caller occupancy claims to export',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('synthetic'));vi.stubGlobal('fetch',fetch);
    await (exportTrays as (...args: unknown[])=>Promise<Blob>)('login',id,{freeSpaceByTrayId:{[id]:99}});
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({});
  });
});

describe('tray centerline length preview', () => {
  const measurement = {
    lengthMm: 12035.127,
    elementCount: 3,
    modelVersionId: id,
    geometryRevision: '2',
    aggregateId: '22222222-2222-4222-8222-222222222222',
    traceId: '33333333-3333-4333-8333-333333333333',
  };

  it('reads the measurement and its model reference without writing the tray', async () => {
    vi.mocked(request).mockResolvedValue({ autoLength: measurement });
    await expect(fetchTrayAutoLength('editor', id, id)).resolves.toEqual(measurement);
    expect(request).toHaveBeenCalledWith(`/api/projects/${id}/trays/${id}/auto-length`, { token: 'editor' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete measurements instead of supplying a usable zero or unverified value', async () => {
    for (const invalid of [
      { ...measurement, lengthMm: null },
      { ...measurement, lengthMm: -1 },
      { ...measurement, elementCount: 0 },
      { ...measurement, traceId: undefined },
    ]) {
      vi.mocked(request).mockResolvedValue({ autoLength: invalid });
      await expect(fetchTrayAutoLength('editor', id, id)).rejects.toMatchObject({ status: 502 });
    }
  });

  it('preserves an actionable unavailable-network error from the server', async () => {
    const unavailable = new Error('Prepare the routing network with centerline data before using Auto-length.');
    vi.mocked(request).mockRejectedValue(unavailable);
    await expect(fetchTrayAutoLength('editor', id, id)).rejects.toBe(unavailable);
  });
});
