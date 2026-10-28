import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTrays, exportTrays } from './trays';
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
