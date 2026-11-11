// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRAIGHT_SOURCE_SHA256 } from '../../shared/cadLengths.js';
import type { CadExportPart } from './scopedExports.js';

const mocks=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),assembly:vi.fn(),source:vi.fn()}));
vi.mock('../db.js',()=>({pool:{query:mocks.query,connect:mocks.connect}}));
vi.mock('../config.js',()=>({config:{jwtSecret:'test-only',bcryptRounds:4}}));
vi.mock('../services/objectStorageService.js',()=>({getObjectStream:vi.fn(),getProjectBucket:vi.fn()}));
vi.mock('./stepAssemblyClient.js',()=>({exportStepAssembly:mocks.assembly,readBoundedSource:mocks.source}));
import { cadDesignRouter } from './routes.js';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const projectId=id(1),designId=id(2),modelId=id(3),routeA=id(4),routeB=id(5);
const part=(n:number,sku:string,category=100,length:number|null=1500):CadExportPart=>({id:id(n),revision:2,catalog_item_id:id(category),catalog_id:id(category),
  manufacturer:'Niedax',part_number:sku,family:'Ladder',original_filename:'NDX_KL_60-303_F_MED_214.step',source_sha256:STRAIGHT_SOURCE_SHA256,
  source_object_key:`immutable/${category}.step`,material_asset_id:id(category+100),cad_revision:3,component_kind:'straight',cut_length_mm:length,
  x_mm:n*100,y_mm:-n*20,z_mm:n*30,qx:0,qy:0,qz:0,qw:1});
type State={exists:boolean;revision:number;routes:Array<{id:string;name:string;revision:number;members:string[]}>;parts:CadExportPart[]};
let state:State,mutateDuringRead:(()=>void)|undefined;
let server:Server,base:string;
const clients:Array<{query:ReturnType<typeof vi.fn>;release:ReturnType<typeof vi.fn>}>=[];
beforeAll(async()=>{
  const app=express();app.use('/api/projects/:projectId/cad-design',cadDesignRouter);
  app.use((_error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(500).json({code:'UNHANDLED_TEST_ERROR'}));
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing test address');
  base=`http://127.0.0.1:${address.port}/api/projects/${projectId}/cad-design/designs/${designId}`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
beforeEach(()=>{
  vi.clearAllMocks();clients.length=0;mutateDuringRead=undefined;
  state={exists:true,revision:11,routes:[{id:routeA,name:'BC182',revision:3,members:[id(10),id(11)]},{id:routeB,name:'OTHER',revision:7,members:[id(12)]}],
    parts:[part(10,'SKU-A',100,1500),part(11,'SKU-A',100,2000),part(12,'SKU-B',101,1000),part(13,'UNASSIGNED',102,null)]};
  mocks.assembly.mockResolvedValue(Buffer.from('ISO-10303-21;SCOPED-CAD-TEST'));
  mocks.connect.mockImplementation(async()=>{
    let frozen:State;
    const query=vi.fn(async(sql:string,values:unknown[]=[])=>{
      if(sql.startsWith('BEGIN')){frozen=structuredClone(state);return {rows:[]};}
      if(sql.startsWith('SELECT model_version_id,revision FROM cad_designs'))return {rows:frozen.exists&&values[0]===projectId&&values[1]===designId?[{model_version_id:modelId,revision:frozen.revision}]:[]};
      if(sql.startsWith('SELECT id,name,revision FROM cad_route_groups')){
        const route=frozen.routes.find(row=>row.id===values[2]);return {rows:values[0]===projectId&&values[1]===designId&&route?[{id:route.id,name:route.name,revision:route.revision}]:[]};
      }
      if(sql.startsWith('SELECT instance_id FROM cad_route_group_members'))return {rows:frozen.routes.find(row=>row.id===values[2])?.members.map(instance_id=>({instance_id}))??[]};
      if(sql.startsWith('SELECT id FROM cad_design_instances'))return {rows:frozen.parts.map(row=>({id:row.id}))};
      if(sql.startsWith('SELECT i.id,i.revision,i.catalog_item_id')){
        const selected=values[2] as string[];const rows=frozen.parts.filter(row=>selected.includes(row.id));mutateDuringRead?.();return {rows};
      }
      if(sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
      throw Error('Unexpected export SQL: '+sql.slice(0,60));
    });
    const client={query,release:vi.fn()};clients.push(client);return client;
  });
});
const get=(format:'step'|'csv',query='')=>fetch(`${base}/${format==='step'?'assembly.step':'materials.csv'}${query}`);
describe('route-scoped and complete-proposal CAD deliverables',()=>{
  it('exports only authoritative members of the selected route with pinned lengths, assets and saved transforms',async()=>{
    const response=await get('step',`?routeId=${routeA}`);expect(response.status).toBe(200);
    expect(mocks.assembly).toHaveBeenCalledWith(state.parts.slice(0,2));
    expect(mocks.assembly.mock.calls[0][0].map((row:CadExportPart)=>row.cut_length_mm)).toEqual([1500,2000]);
    expect(response.headers.get('x-wfc-export-scope')).toBe('route');expect(response.headers.get('x-wfc-route-id')).toBe(routeA);
    expect(response.headers.get('x-wfc-route-revision')).toBe('3');expect(response.headers.get('x-wfc-design-revision')).toBe('11');
    expect(response.headers.get('content-disposition')).toContain('wfc-route-BC182-cable-trays.step');
    expect(clients).toHaveLength(2);expect(clients[0].query).toHaveBeenCalledWith(expect.stringContaining('FROM cad_route_group_members'),[projectId,designId,routeA]);
    for(const client of clients){expect(client.query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');expect(client.release).toHaveBeenCalledOnce();}
  });
  it('keeps a second route isolated and includes both routes plus unassigned pieces when scope is omitted',async()=>{
    expect((await get('step',`?routeId=${routeB}`)).status).toBe(200);expect(mocks.assembly.mock.calls[0][0].map((row:CadExportPart)=>row.id)).toEqual([id(12)]);
    mocks.assembly.mockClear();const all=await get('step');expect(all.status).toBe(200);expect(mocks.assembly).toHaveBeenCalledWith(state.parts);
    expect(all.headers.get('x-wfc-export-scope')).toBe('proposal');expect(all.headers.get('x-wfc-route-id')).toBeNull();
    expect(all.headers.get('content-disposition')).toContain('wfc-proposed-cable-trays.step');
  });
  it('produces exact scoped and all-proposal material quantities, separate cut lengths and pinned revision columns',async()=>{
    const selected=await get('csv',`?routeId=${routeA}`),csv=await selected.text();
    expect(selected.status).toBe(200);expect(csv).toContain('"CAD asset","CAD revision","Source SHA-256"');
    expect(csv.match(/"SKU-A"/g)).toHaveLength(2);expect(csv).toContain('"1","1500","1.5"');expect(csv).toContain('"1","2000","2"');
    expect(csv).toContain(`"${id(200)}","3","${STRAIGHT_SOURCE_SHA256}"`);expect(csv).not.toContain('SKU-B');expect(csv).not.toContain('UNASSIGNED');
    const all=await get('csv'),whole=await all.text();expect(whole).toContain('SKU-A');expect(whole).toContain('SKU-B');expect(whole).toContain('UNASSIGNED');
    expect(all.headers.get('content-disposition')).toContain('wfc-proposed-tray-mto.csv');
  });
  it.each(['','?routeId=','?routeId=all','?routeId=invalid',`?routeId=${routeA}&routeId=${routeB}`,`?routeId[]=${routeA}`,`?routeId=${routeA}&all=true`].slice(1))('rejects invalid, repeated or unknown query fields without falling back to all: %s',async query=>{
    for(const format of ['step','csv'] as const){const response=await get(format,query);expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:'INVALID_CAD_EXPORT_SCOPE'});}
    expect(mocks.connect).not.toHaveBeenCalled();expect(mocks.assembly).not.toHaveBeenCalled();
  });
  it.each(['step','csv'] as const)('returns 404 for an unknown, foreign-project or other-design route in %s',async format=>{
    const response=await get(format,`?routeId=${id(999)}`);expect(response.status).toBe(404);expect(await response.json()).toMatchObject({code:'CAD_ROUTE_NOT_FOUND'});
    expect(mocks.assembly).not.toHaveBeenCalled();expect(clients[0].query.mock.calls.some(([sql])=>String(sql).startsWith('SELECT id FROM cad_design_instances'))).toBe(false);
  });
  it.each(['step','csv'] as const)('refuses a missing design and empty route without exporting another scope in %s',async format=>{
    state.exists=false;expect((await get(format)).status).toBe(404);state.exists=true;
    state.routes[0].members=[];const response=await get(format,`?routeId=${routeA}`);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'EMPTY_CAD_ROUTE'});
    state.parts=[];expect((await get(format)).status).toBe(409);expect(mocks.assembly).not.toHaveBeenCalled();
  });
  it('rejects missing membership rows and catalog joins instead of silently exporting a smaller assembly',async()=>{
    state.routes[0].members.push(id(99));expect((await get('step',`?routeId=${routeA}`)).status).toBe(409);
    state.routes[0].members.pop();state.parts[0].catalog_id=null;
    const response=await get('csv',`?routeId=${routeA}`);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'CAD_EXPORT_SOURCE_UNAVAILABLE'});
    expect(mocks.assembly).not.toHaveBeenCalled();
  });
  it('retains legitimate legacy project sources without inventing missing canonical asset metadata',async()=>{
    state.parts[0].material_asset_id=null;state.parts[0].cad_revision=null;state.parts[0].component_kind=null;
    const response=await get('csv',`?routeId=${routeA}`);expect(response.status).toBe(200);expect(await response.text()).toContain(`"","","${STRAIGHT_SOURCE_SHA256}"`);
    expect((await get('step',`?routeId=${routeA}`)).status).toBe(200);expect(mocks.assembly.mock.calls[0][0]).toHaveLength(2);
  });
  it('fails explicitly when the complete proposal exceeds the kernel part limit while a smaller selected route remains exportable',async()=>{
    state.parts=Array.from({length:129},(_,index)=>part(index+10,`SKU-${index}`,index+100));
    const all=await get('step');expect(all.status).toBe(413);expect(await all.json()).toMatchObject({code:'CAD_EXPORT_PART_LIMIT'});expect(mocks.assembly).not.toHaveBeenCalled();
    expect((await get('step',`?routeId=${routeA}`)).status).toBe(200);expect(mocks.assembly.mock.calls[0][0]).toHaveLength(2);
    const csv=await get('csv');expect(csv.status).toBe(200);expect((await csv.text()).split('\r\n').filter(Boolean)).toHaveLength(130);
  });
  it.each(['proposal','route'])('accepts exactly 128 %s parts through both pre- and post-generation checks',async scope=>{
    state.parts=Array.from({length:128},(_,index)=>part(index+10,'REPEATED-SKU',100));
    state.routes[0].members=state.parts.map(row=>row.id);
    const response=await get('step',scope==='route'?`?routeId=${routeA}`:'');expect(response.status).toBe(200);
    expect(mocks.assembly.mock.calls[0][0]).toHaveLength(128);expect(clients).toHaveLength(2);
  });
  it('rejects 129 selected route members before conversion and a 129th addition during conversion as stale',async()=>{
    state.parts=Array.from({length:129},(_,index)=>part(index+10,'SKU',100));state.routes[0].members=state.parts.map(row=>row.id);
    expect((await get('step',`?routeId=${routeA}`)).status).toBe(413);expect(mocks.assembly).not.toHaveBeenCalled();
    state.parts.pop();state.routes[0].members.pop();mocks.assembly.mockImplementation(async()=>{
      const added=part(999,'SKU',100);state.parts.push(added);state.routes[0].members.push(added.id);return Buffer.from('ISO-10303-21;');
    });
    const response=await get('step',`?routeId=${routeA}`);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'DESIGN_CHANGED_DURING_EXPORT'});
  });
  it.each(['design','route','membership','placement'])('rejects a %s change during isolated STEP conversion',async changed=>{
    mocks.assembly.mockImplementation(async()=>{
      if(changed==='design')state.revision++;
      if(changed==='route')state.routes[0].revision++;
      if(changed==='membership')state.routes[0].members=[id(10),id(13)];
      if(changed==='placement')state.parts[0].x_mm++;
      return Buffer.from('ISO-10303-21;');
    });
    const response=await get('step',`?routeId=${routeA}`);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'DESIGN_CHANGED_DURING_EXPORT'});
  });
  it('uses one coherent read snapshot for CSV even if another edit commits while material rows are read',async()=>{
    mutateDuringRead=()=>{state.revision++;state.routes[0].revision++;state.routes[0].members=[id(13)];};
    const response=await get('csv',`?routeId=${routeA}`),csv=await response.text();expect(response.status).toBe(200);
    expect(csv.match(/SKU-A/g)).toHaveLength(2);expect(csv).not.toContain('UNASSIGNED');
    expect(response.headers.get('x-wfc-design-revision')).toBe('11');expect(response.headers.get('x-wfc-route-revision')).toBe('3');expect(clients).toHaveLength(1);
  });
  it('sanitizes legacy route labels for download headers while keeping exact scope identity',async()=>{
    state.routes[0].name='../../BC182"\r\nX-Injected: yes/Трасе';
    const response=await get('csv',`?routeId=${routeA}`);expect(response.status).toBe(200);
    expect(response.headers.get('x-injected')).toBeNull();expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="wfc-route-[A-Za-z0-9_.-]+-materials\.csv"$/);
    expect(response.headers.get('x-wfc-route-id')).toBe(routeA);
  });
});
