// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTrayDrawingSnapshot, verifyTrayDrawingResponse, saveTrayDrawingSettings } from './trayDrawing';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy';
import { DEFAULT_DRAWING_MODES } from '../../shared/pathfinderDrawingPolicy';
import { drawingInputHashInput, drawingSettingsHashInput, drawingContentHashInput } from '../../shared/trayDrawingSnapshot';
const projectId='11111111-1111-1111-1111-111111111111', trayId='22222222-2222-2222-2222-222222222222';
const hash=(value: unknown)=>createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
function fixture() {
  const dates={createdAt:'2026-01-01',updatedAt:'2026-01-01'};
  const data={project:{id:projectId,projectNumber:'synthetic',name:'Synthetic',customer:'Synthetic',manager:null,description:null,connectionGap:1,secondaryTrayLength:null,supportDistance:null,supportWeight:null,additionalBendingPercent:10,endConnectionLength:5,trayLoadSafetyFactor:null,supportDistanceOverrides:{},trayPurposeTemplates:{},cableLayout:{cableSpacing:null,considerBundleSpacingAsFree:null,minFreeSpacePercent:null,maxFreeSpacePercent:null,mv:null,power:null,vfd:null,control:null,customBundleRanges:null},...dates},tray:{id:trayId,projectId,name:'Synthetic',type:null,purpose:null,widthMm:100,heightMm:50,lengthMm:null,includeGroundingCable:false,groundingCableTypeId:null,...dates},reportTrays:[] as {id:string;projectId:string;name:string;type:null;purpose:null;widthMm:number;heightMm:number;lengthMm:null;includeGroundingCable:boolean;groundingCableTypeId:null;createdAt:string;updatedAt:string}[],cables:[],trayCables:[],materialTrays:[],materialSupports:[],cableTypes:[],loadCurves:[]};
  data.reportTrays.push(data.tray);
  const override={revision:'0',value:null}; const sourceSha256='a'.repeat(64);
  const layout={schemaVersion:'wfc.tray-drawing-layout.v1',algorithmVersion:'wfc-tray-placement-v2',widthPx:100,heightPx:50,commands:[],summary:null,diagnostics:[],placements:[]};
  const snapshot={schemaVersion:'pathfinder.tray-drawing-snapshot.v1' as const,projectId,projectTrayId:trayId,snapshotId:projectId,catalogRevision:'1',drawingPolicyRevision:'0',drawingInputRevision:'1',layoutAlgorithmVersion:'wfc-tray-placement-v2' as const,contentSha256:'0'.repeat(64),purposeKey:null,categoryModes:{...DEFAULT_DRAWING_MODES},legacySidePolicyVersion:'wfc-tray-sides-v1' as const,settingsSha256:hash(drawingSettingsHashInput(override,{...DEFAULT_DRAWING_MODES})),inputSha256:hash(drawingInputHashInput(data,sourceSha256)),orderedCableIds:[],state:'ready' as const,diagnostics:[]};
  snapshot.contentSha256=hash(drawingContentHashInput(snapshot,layout));
  return {schemaVersion:'pathfinder.tray-drawing-response.v1',snapshot,data,override,sourceSha256,permissions:{canEdit:true},layout};
}
afterEach(()=>vi.unstubAllGlobals());
describe('shared drawing snapshot boundary',()=>{
  it('verifies one consistent snapshot and preserves its identity for read-only viewers',async()=>{
    const value=fixture(); const first=await verifyTrayDrawingResponse(value,projectId,trayId);
    const second=await verifyTrayDrawingResponse({...value,permissions:{canEdit:false}},projectId,trayId);
    expect(first.snapshot).toEqual(second.snapshot);expect(second.permissions.canEdit).toBe(false);
  });
  it('rejects cross-project identities, mixed source inputs and unsafe layout commands without fallback',async()=>{
    const value=fixture(); await expect(verifyTrayDrawingResponse(value,trayId,trayId)).rejects.toThrow();
    await expect(verifyTrayDrawingResponse({...value,data:{...value.data,tray:{...value.data.tray,widthMm:200}}},projectId,trayId)).rejects.toMatchObject({code:'DRAWING_SNAPSHOT_MISMATCH'});
    await expect(verifyTrayDrawingResponse({...value,layout:{...value.layout,commands:[{op:'eval',args:['bad']}]}},projectId,trayId)).rejects.toMatchObject({code:'INVALID_LAYOUT'});
  });
  it('uses a fixed path and rejects duplicate wire members or invalid identities',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('{"x":1,"\\u0078":2}'));vi.stubGlobal('fetch',fetch);
    await expect(fetchTrayDrawingSnapshot(projectId,trayId,'login')).rejects.toThrow();
    expect(fetch.mock.calls[0][0]).toMatch(new RegExp(`/api/projects/${projectId}/trays/${trayId}/drawing-snapshot$`));
    await expect(fetchTrayDrawingSnapshot(projectId+'\n',trayId,'login')).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('returns the confirmed current PUT snapshot without a second read that could misclassify its outcome',async()=>{
    const value=fixture();const fetch=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify(value))));vi.stubGlobal('fetch',fetch);
    const body={schemaVersion:'pathfinder.tray-drawing-settings.write.v1' as const,expectedDrawingInputRevision:'1',expectedRevision:'0',idempotencyKey:trayId,value:null};
    await saveTrayDrawingSettings(projectId,trayId,'login',body);
    expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1].method).toBe('PUT');
    await expect(saveTrayDrawingSettings(projectId,trayId,'login',{...body,unknown:true} as never)).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
  });
});
