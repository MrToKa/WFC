// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import type { PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRAIGHT_SOURCE_SHA256 } from '../../shared/cadLengths.js';
import type { TrayRow } from '../models/tray.js';
import type { PublicationInstance } from './routePublication.js';

const mocks=vi.hoisted(()=>({connect:vi.fn(),query:vi.fn(),release:vi.fn(),audit:vi.fn()}));
vi.mock('../db.js',()=>({pool:{connect:mocks.connect,query:vi.fn()}}));
vi.mock('../config.js',()=>({config:{jwtSecret:'test-only',bcryptRounds:4}}));
vi.mock('../services/objectStorageService.js',()=>({getObjectStream:vi.fn(),getProjectBucket:vi.fn()}));
vi.mock('../services/trayChangeLogService.js',()=>({recordTrayChanges:mocks.audit}));
vi.mock('../middleware.js',()=>({
  requireProjectEdit:(_req:express.Request,_res:express.Response,next:express.NextFunction)=>next(),
  requireAdmin:(_req:express.Request,_res:express.Response,next:express.NextFunction)=>next(),
}));
import { cadRouteGroupsRouter } from './routeGroupsRoutes.js';
import { buildCadChain, groupInputs } from './routePublication.js';
import { cadTrayProjection, compatibleCadTrayExport, deriveCadTrayExport } from './routeTrayExports.js';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const projectId=id(1),designId=id(2),sourceId=id(3),targetId=id(4),actorId=id(5),movedId=id(11);
type Group={id:string;name:string;tag:string;purpose:string;color:string;revision:number;status:string;project_tray_id:null;publication:null;instanceIds:string[]};
type Link={project_id:string;design_id:string;route_group_id:string;tray_id:string;source_sha256:string;source_proof:unknown;projection:unknown};
type State={groups:Group[];trays:TrayRow[];links:Link[]};
const placed=(n:number):PublicationInstance=>({id:id(n),catalog_item_id:id(20),material_asset_id:id(21),revision:1,
  part_number:'KL 60.303 F',original_filename:'NDX_KL_60-303_F_MED_214.step',source_sha256:STRAIGHT_SOURCE_SHA256,
  component_kind:'straight',cut_length_mm:1500,x_mm:0,y_mm:0,z_mm:(n-10)*1500,qx:0,qy:0,qz:0,qw:1,
  material_tray_id:id(22),material_tray_type:'KL 60.303 F',material_width_mm:300,material_height_mm:60});
const geometry=[placed(10),placed(11),placed(12)];
const physical=[{source_instance_id:id(10),source_name:'end',target_instance_id:movedId,target_name:'start'}];
let state:State,snapshot:State,server:Server|undefined,failTargetWrite:boolean;
const members=(group:Group)=>geometry.filter(row=>group.instanceIds.includes(row.id));
function exportGroup(group:Group,trayId:string){
  const desired=deriveCadTrayExport(projectId,designId,group,members(group),buildCadChain(members(group),group.id===sourceId?physical:[]));
  const row={id:trayId,project_id:projectId,name:group.name,purpose:group.purpose,tray_type:desired.fields.trayType,
    width_mm:300,height_mm:60,length_mm:desired.fields.lengthMm,length_source:'auto',length_calculation:null,
    include_grounding_cable:false,grounding_cable_type_id:null,use_trefoil_clamps:false,trefoil_clamp_spacing_mm:900,
    created_at:'2026-11-17T00:00:00Z',updated_at:'2026-11-17T00:00:00Z'} satisfies TrayRow;
  state.trays.push(row);
  state.links.push({project_id:projectId,design_id:designId,route_group_id:group.id,tray_id:trayId,source_sha256:desired.sourceSha256,
    source_proof:{source:desired.source},projection:cadTrayProjection(row)});
}
beforeEach(()=>{
  vi.resetAllMocks();failTargetWrite=false;
  const group=(n:number,name:string,instanceIds:string[]):Group=>({id:id(n),name,tag:name,purpose:'Control',color:'#00FFFF',revision:1,status:'draft',project_tray_id:null,publication:null,instanceIds});
  state={groups:[group(3,'BC027-1',[id(10),movedId]),group(4,'BC027-3',[id(12)])],trays:[],links:[]};
  exportGroup(state.groups[0],id(30));exportGroup(state.groups[1],id(31));
  mocks.connect.mockResolvedValue({query:mocks.query,release:mocks.release});
  mocks.query.mockImplementation(async(sql:string,values:unknown[]=[])=>{
    if(sql==='BEGIN')snapshot=structuredClone(state);
    if(sql==='ROLLBACK')state=structuredClone(snapshot);
    const group=state.groups.find(row=>row.id===values[2]);
    if(sql.startsWith('SELECT d.id'))return {rows:[{id:designId}]};
    if(sql.startsWith('SELECT model_version_id FROM cad_designs'))return {rows:[{model_version_id:id(40)}]};
    if(sql.startsWith('SELECT g.id FROM cad_route_groups g JOIN cad_route_tray_exports'))return {rows:state.groups.filter(row=>row.status==='draft'&&state.links.some(link=>link.route_group_id===row.id)).map(row=>({id:row.id}))};
    if(sql.startsWith('SELECT id FROM cad_design_instances'))return {rows:[{id:movedId}]};
    if(sql.startsWith('SELECT g.id')||sql.startsWith('SELECT * FROM cad_route_groups')||sql.startsWith('SELECT status FROM cad_route_groups')||sql.startsWith('SELECT revision,status'))return {rows:group?[structuredClone(group)]:[]};
    if(sql.startsWith('SELECT route_group_id'))return {rows:state.groups.filter(row=>row.instanceIds.includes(movedId)).map(row=>({routeGroupId:row.id}))};
    if(sql.startsWith('SELECT i.*'))return {rows:members(group!)};
    if(sql.startsWith('SELECT COUNT(*)'))return {rows:[{member_count:group!.instanceIds.length}]};
    if(sql.includes('FROM cad_design_connections')){
      const ids=values[2] as string[];
      return {rows:physical.filter(edge=>ids.includes(edge.source_instance_id)||ids.includes(edge.target_instance_id))};
    }
    if(sql.includes('FROM cad_route_transition_links'))return {rows:[]};
    if(sql.startsWith('DELETE FROM cad_route_group_members'))group!.instanceIds=group!.instanceIds.filter(member=>member!==values[3]);
    if(sql.startsWith('INSERT INTO cad_route_group_members'))group!.instanceIds.push(String(values[3]));
    if(sql.startsWith('UPDATE cad_route_groups SET revision=')){
      if(group!.revision!==values[3])return {rows:[]};group!.revision++;return {rows:[{id:group!.id}]};
    }
    if(sql.startsWith('SELECT * FROM cad_route_tray_exports'))return {rows:state.links.filter(row=>row.route_group_id===values[2])};
    if(sql.startsWith('SELECT * FROM trays'))return {rows:state.trays.filter(row=>row.id===values[1])};
    if(sql.startsWith('SELECT id FROM trays'))return {rows:state.trays.filter(row=>row.name===values[1]&&row.id!==values[2])};
    if(sql.startsWith('UPDATE trays SET name=')||sql.startsWith('INSERT INTO trays')){
      if(failTargetWrite&&values[2]==='BC027-3')throw new Error('Simulated storage failure');
      const existing=state.trays.find(row=>row.id===values[1]);
      const row={...(existing??state.trays[0]),id:String(values[1]),project_id:projectId,name:String(values[2]),purpose:String(values[3]),
        tray_type:String(values[4]),width_mm:Number(values[5]),height_mm:Number(values[6]),length_mm:Number(values[7]),
        length_source:'auto',length_calculation:JSON.parse(String(values[8]))} as TrayRow;
      state.trays=state.trays.filter(old=>old.id!==row.id);state.trays.push(row);return {rows:[row]};
    }
    if(sql.startsWith('INSERT INTO cad_route_tray_exports')){
      state.links=state.links.filter(row=>row.route_group_id!==values[2]);
      state.links.push({project_id:projectId,design_id:designId,route_group_id:String(values[2]),tray_id:String(values[3]),
        source_sha256:String(values[4]),source_proof:JSON.parse(String(values[5])),projection:JSON.parse(String(values[6]))});
    }
    if(sql.startsWith('DELETE FROM cad_route_tray_exports'))state.links=state.links.filter(row=>row.route_group_id!==values[2]);
    if(sql.startsWith('DELETE FROM trays')){
      const removed=state.trays.filter(row=>row.id===values[1]);state.trays=state.trays.filter(row=>row.id!==values[1]);return {rows:removed};
    }
    return {rows:[]};
  });
});
afterEach(async()=>{if(server){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));server=undefined;}});
async function post(path:string,body:unknown){
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.userId=actorId;next();});
  app.use('/projects/:projectId/cad',cadRouteGroupsRouter);
  app.use((_error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(500).json({code:'TEST_STORAGE_FAILURE'}));
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing test address');
  return fetch(`http://127.0.0.1:${address.port}/projects/${projectId}/cad/designs/${designId}${path}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  });
}
const transfer=()=>post(`/routes/${targetId}/sections`,{instanceId:movedId,expectedRevision:1,sourceRouteId:sourceId,expectedSourceRevision:1});
async function expectCurrentExports(){
  const client={query:mocks.query} as unknown as PoolClient;
  for(const link of state.links){
    const input=await groupInputs(client,projectId,designId,link.route_group_id);
    const exported=await compatibleCadTrayExport(client,projectId,designId,input.group,input.instances,input.chain,input.transitions);
    expect(exported?.sourceSha256).toBe(link.source_sha256);
    expect(exported?.row.length_mm).toBe(input.chain.lengthMetres*1000);
  }
}
describe('section transfer commits both ordinary Trays projections with membership',()=>{
  it('updates both listed routes before committing, retaining IDs and tray accessory settings',async()=>{
    const response=await transfer();expect(response.status).toBe(200);
    expect(state.groups.map(group=>[...group.instanceIds].sort())).toEqual([[id(10)],[movedId,id(12)]]);
    expect(state.trays.find(row=>row.id===id(30))).toMatchObject({length_mm:1500,include_grounding_cable:false,trefoil_clamp_spacing_mm:900});
    expect(state.trays.find(row=>row.id===id(31))).toMatchObject({length_mm:3000,include_grounding_cable:false,trefoil_clamp_spacing_mm:900});
    expect(state.links).toHaveLength(2);expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    await expectCurrentExports();
    expect(geometry.map(row=>row.revision)).toEqual([1,1,1]);
  });
  it('removes the empty source list entry and lists an unlisted destination in the same transfer',async()=>{
    state.groups[0].instanceIds=[movedId];state.trays=[];state.links=[];
    // This single source has no internal physical mate after scoping.
    const group=state.groups[0],desired=deriveCadTrayExport(projectId,designId,group,[geometry[1]],buildCadChain([geometry[1]],[]));
    const row={id:id(30),project_id:projectId,name:group.name,purpose:'Control',tray_type:'KL 60.303 F',width_mm:300,height_mm:60,length_mm:1500,length_source:'auto',length_calculation:null} as TrayRow;
    state.trays.push(row);state.links.push({project_id:projectId,design_id:designId,route_group_id:sourceId,tray_id:row.id,source_sha256:desired.sourceSha256,source_proof:{source:desired.source},projection:cadTrayProjection(row)});
    expect((await transfer()).status).toBe(200);
    expect(state.groups[0]).toMatchObject({instanceIds:[],status:'draft',revision:2});
    expect(state.trays).toHaveLength(1);expect(state.trays[0].name).toBe('BC027-3');
    expect(state.links.map(link=>link.route_group_id)).toEqual([targetId]);
    await expectCurrentExports();
  });
  it('rolls membership and the already updated source tray back when the destination write fails',async()=>{
    const before=structuredClone(state);failTargetWrite=true;
    expect((await transfer()).status).toBe(500);
    expect(state).toEqual(before);expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('preserves manual tray edits and rejects the transfer atomically instead of leaving stale projections',async()=>{
    state.trays[1].length_mm=1234;const before=structuredClone(state);
    const response=await transfer();expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:'CAD_ROUTE_TRAY_EDITED'});
    expect(state).toEqual(before);expect(mocks.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('automatically repairs previously stale draft entries before network capture',async()=>{
    state.groups[0].instanceIds=[id(10)];state.groups[1].instanceIds.push(movedId);
    state.groups.forEach(group=>group.revision++);
    const response=await post('/synchronize-trays',{expectedModelVersionId:id(40)});
    expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({designId,modelVersionId:id(40),synchronizedRoutes:2});
    await expectCurrentExports();
    expect(state.trays.find(row=>row.id===id(30))!.length_mm).toBe(1500);
    expect(state.trays.find(row=>row.id===id(31))!.length_mm).toBe(3000);
  });
  it('removes a previously emptied draft export before the base catalogue is captured',async()=>{
    state.groups[0].instanceIds=[];state.groups[1].instanceIds.push(id(10),movedId);
    expect((await post('/synchronize-trays',{expectedModelVersionId:id(40)})).status).toBe(200);
    expect(state.trays).toHaveLength(1);expect(state.links).toHaveLength(1);
    expect(state.groups[0].instanceIds).toEqual([]);await expectCurrentExports();
  });
  it('fences synchronization to the observed model before changing any trays',async()=>{
    const before=structuredClone(state);
    const response=await post('/synchronize-trays',{expectedModelVersionId:id(41)});
    expect(response.status).toBe(409);expect(await response.json()).toEqual({code:'INACTIVE_DESIGN'});
    expect(state).toEqual(before);
  });
  it('rejects malformed synchronization commands before opening a transaction',async()=>{
    const response=await post('/synchronize-trays',{expectedModelVersionId:'old-model'});
    expect(response.status).toBe(400);expect(mocks.connect).not.toHaveBeenCalled();
  });
});
