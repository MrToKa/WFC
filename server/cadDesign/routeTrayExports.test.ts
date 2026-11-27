// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrayRow } from '../models/tray.js';
import { STRAIGHT_SOURCE_SHA256 } from '../../shared/cadLengths.js';
import { STRAIGHT_SOURCES } from '../../shared/cadStraightSources.js';
import { trayLengthCalculationSchema } from '../../shared/trayAutoLength.js';
import type { PublicationInstance, PublicationTransition } from './routePublication.js';

const mocks=vi.hoisted(()=>({query:vi.fn(),transaction:vi.fn(),inputs:vi.fn(),audit:vi.fn()}));
vi.mock('../db.js',()=>({pool:{query:vi.fn(),connect:vi.fn()}}));
vi.mock('../config.js',()=>({config:{jwtSecret:'test-only',bcryptRounds:4}}));
vi.mock('../services/objectStorageService.js',()=>({getObjectStream:vi.fn(),getProjectBucket:vi.fn()}));
vi.mock('../services/trayChangeLogService.js',()=>({recordTrayChanges:mocks.audit}));
vi.mock('../middleware.js',()=>({requireAdmin:(req:express.Request,res:express.Response,next:express.NextFunction)=>{
  if(req.header('x-test-admin')==='yes')next();else res.status(403).json({code:'ADMIN_REQUIRED'});
}}));
vi.mock('./routePublication.js',async original=>({...await original<typeof import('./routePublication.js')>(),groupInputs:mocks.inputs,publicationTransaction:mocks.transaction}));
import { buildCadChain } from './routePublication.js';
import { cadRouteTrayExportsRouter, deriveCadTrayExport, compatibleCadTrayExport, cadTrayProjection, writeCadTrayExport, synchronizeCadTrayExportsAfterTransfer } from './routeTrayExports.js';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const projectId=id(1),designId=id(2),routeId=id(3),actorId=id(4);
const instance=(n=10):PublicationInstance=>({id:id(n),catalog_item_id:id(n+100),material_asset_id:id(n+200),revision:1,part_number:'KL-FIRST',
  original_filename:'NDX_KL_60-303_F_MED_214.step',source_sha256:STRAIGHT_SOURCE_SHA256,component_kind:'straight',cut_length_mm:1500,
  x_mm:0,y_mm:0,z_mm:0,qx:0,qy:0,qz:0,qw:1});
type Group={id:string;name:string;purpose:string;revision:number;status:string;project_tray_id:string|null;publication:unknown};
type Link={project_id:string;design_id:string;route_group_id:string;tray_id:string;source_sha256:string;source_proof:unknown;projection:unknown};
let group:Group,instances:PublicationInstance[],transitions:PublicationTransition[],row:TrayRow|undefined,link:Link|undefined,duplicate:boolean,failLink:boolean;
let server:Server,base:string;
const chain=()=>buildCadChain(instances,[],transitions);
const tray=(trayId:string,values:unknown[]):TrayRow=>({id:trayId,project_id:projectId,name:String(values[2]),purpose:String(values[3]),tray_type:String(values[4]),
  width_mm:Number(values[5]),height_mm:Number(values[6]),length_mm:Number(values[7]),length_source:'auto',length_calculation:JSON.parse(String(values[8])),
  include_grounding_cable:true,grounding_cable_type_id:null,use_trefoil_clamps:true,trefoil_clamp_spacing_mm:500,created_at:'2026-11-11T00:00:00Z',updated_at:'2026-11-11T00:00:00Z'});
beforeAll(async()=>{
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.userId=actorId;next();});
  app.use('/projects/:projectId',cadRouteTrayExportsRouter);
  app.use((_error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(500).json({code:'UNHANDLED_TEST_ERROR'}));
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing test address');
  base=`http://127.0.0.1:${address.port}/projects/${projectId}/designs/${designId}/routes/${routeId}/trays-list`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
beforeEach(()=>{
  vi.resetAllMocks();group={id:routeId,name:'BC182',purpose:'Control',revision:7,status:'draft',project_tray_id:null,publication:null};
  instances=[instance()];transitions=[];row=undefined;link=undefined;duplicate=false;failLink=false;
  mocks.inputs.mockImplementation(async()=>({group,instances,transitions,chain:chain()}));
  mocks.transaction.mockImplementation(async(_req:unknown,work:(client:{query:typeof mocks.query})=>Promise<unknown>)=>{
    const beforeRow=structuredClone(row),beforeLink=structuredClone(link);await mocks.query('BEGIN');
    try{const result=await work({query:mocks.query});await mocks.query('COMMIT');return result;}
    catch(error){row=beforeRow;link=beforeLink;await mocks.query('ROLLBACK');throw error;}
  });
  mocks.query.mockImplementation(async(sql:string,values:unknown[]=[])=>{
    if(sql.startsWith('SELECT * FROM cad_route_tray_exports'))return {rows:link?[link]:[]};
    if(sql.startsWith('UPDATE cad_route_tray_exports SET substitute_step') && link)
      Object.assign(link, { substitute_step: true, projection: values[3] });
    if(sql.startsWith('SELECT * FROM trays'))return {rows:row&&values[0]===projectId&&values[1]===row.id?[row]:[]};
    if(sql.startsWith('SELECT id FROM trays'))return {rows:duplicate?[{id:id(999)}]:[]};
    if(sql.startsWith('INSERT INTO trays')){row=tray(String(values[1]),values);return {rows:[row]};}
    if(sql.startsWith('UPDATE trays')){row={...row!,...tray(String(values[1]),values)};return {rows:[row]};}
    if(sql.startsWith('INSERT INTO cad_route_tray_exports')){
      if(failLink)throw Object.assign(Error('private constraint'),{code:'23505'});
      link={project_id:String(values[0]),design_id:String(values[1]),route_group_id:String(values[2]),tray_id:String(values[3]),source_sha256:String(values[4]),source_proof:JSON.parse(String(values[5])),projection:JSON.parse(String(values[6]))};
    }
    return {rows:[]};
  });
});
const save=(body:unknown={expectedRevision:group.revision},admin=true)=>fetch(base,{method:'POST',headers:{'Content-Type':'application/json','x-test-admin':admin?'yes':'no'},body:JSON.stringify(body)});
const writes=()=>mocks.query.mock.calls.filter(([sql])=>/^INSERT INTO trays|^UPDATE trays|^INSERT INTO cad_route_tray_exports/.test(String(sql)));

const reviewSubstitute = (reviewToken?: string) => fetch(base.replace('/trays-list', '/substitute-step'), {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-admin': 'yes' },
  body: JSON.stringify({ expectedRevision: group.revision, reviewToken }),
});

describe('substitute STEP geometry', () => {
  it('repairs a published profile in place and uses the real profile for subsequent length updates', async () => {
    await save();
    const original = { ...row! };
    group.status = 'published';
    group.project_tray_id = original.id;
    group.publication = { baseArtifactId: id(90), overlay: { segments: ['existing'] },
      traySnapshot: { id: original.id, name: original.name, purpose: original.purpose, lengthMm: original.length_mm,
        trayType: original.tray_type, widthMm: original.width_mm, heightMm: original.height_mm } };
    Object.assign(row!, { tray_type: 'REAL', width_mm: 450, height_mm: 85 });
    const { step, real, reviewToken } = await (await reviewSubstitute()).json();
    expect(step).toMatchObject({ trayType: 'KL-FIRST', widthMm: 300, heightMm: 60 });
    expect(real).toEqual({ trayType: 'REAL', widthMm: 450, heightMm: 85 });
    mocks.query.mockClear();
    expect((await reviewSubstitute(reviewToken)).status).toBe(200);
    expect(mocks.query.mock.calls.some(([sql]) => /^(UPDATE trays|DELETE|INSERT INTO trays)/.test(sql))).toBe(false);
    const published = mocks.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE cad_route_groups SET publication'))!;
    expect(published[1][3]).toMatchObject({ overlay: { segments: ['existing'] }, traySnapshot: { ...real, id: original.id } });
    group.status = 'draft';
    instances[0].cut_length_mm = 990;
    expect((await save()).status).toBe(200);
    expect(row).toMatchObject({ id: original.id, tray_type: 'REAL', width_mm: 450, height_mm: 85, length_mm: 990 });
  });

  it('requires a new review after a profile edit and refuses unrelated edits', async () => {
    await save();
    const { reviewToken } = await (await reviewSubstitute()).json();
    row!.width_mm = 500;
    expect(await (await reviewSubstitute(reviewToken)).json()).toMatchObject({ code: 'CAD_ROUTE_REVIEW_CHANGED' });
    row!.purpose = 'Changed';
    expect(await (await reviewSubstitute()).json()).toMatchObject({ code: 'CAD_ROUTE_TRAY_EDITED' });
  });
});

describe('server-derived route-list source and projection',()=>{
  it('selects the first placed straight SKU, preserving source order instead of sorting UUIDs',()=>{
    const bend={...instance(5),component_kind:'bend',part_number:'BEND-SKU',original_filename:'NDX_KLBK_60-303_MED_214.step',source_sha256:'7a5cf4947a9ea5fa213ceef84ba952fe2a9a63dee752f0c23a598320802c0014',cut_length_mm:null};
    const first={...instance(99),part_number:'FIRST-PLACED-STRAIGHT'},second={...instance(10),part_number:'LATER-STRAIGHT'};
    expect(deriveCadTrayExport(projectId,designId,group,[bend,first,second],{points:[[0,0,0],[0,0,1]],lengthMetres:1}).fields.trayType).toBe('FIRST-PLACED-STRAIGHT');
    expect(deriveCadTrayExport(projectId,designId,group,[bend],{points:[[0,0,0],[0,0,1]],lengthMetres:1}).fields.trayType).toBe('BEND-SKU');
  });
  it.each([
    ['NDX_KL_60-603_E3_MED_214.step',600,60],
    ['NDX_KL_100-403_F_MED_214.step',400,100],
  ] as const)('exports actual %s profile dimensions to Trays', (filename,widthMm,heightMm)=>{
    const source=STRAIGHT_SOURCES.find(part=>part.filename.toUpperCase()===filename.toUpperCase())!;
    instances=[{...instance(),original_filename:source.filename,source_sha256:source.sha256}];
    const result=deriveCadTrayExport(projectId,designId,group,instances,chain());
    expect(result.fields).toMatchObject({widthMm,heightMm,lengthMm:1500});
    expect(result.source).toMatchObject({widthMm,heightMm});
  });
  it('uses the exact saved name/purpose and actual centerline including logical installation gaps',()=>{
    group.name='Legacy descriptive route';group.purpose='Special purpose';
    instances.push({...instance(11),z_mm:1671});transitions=[{kind:'routing-transition',source_instance_id:instances[0].id,source_name:'end',target_instance_id:instances[1].id,target_name:'start'}];
    const result=deriveCadTrayExport(projectId,designId,group,instances,chain(),transitions);
    expect(result.fields).toMatchObject({name:'Legacy descriptive route',purpose:'Special purpose',lengthMm:3171});
    expect(result.source.routingTransitions).toHaveLength(1);expect(result.elementCount).toBe(2);
  });
  it('pins instance and asset revisions while treating a publication-only group revision as unchanged source geometry',()=>{
    const original=deriveCadTrayExport(projectId,designId,group,instances,chain());
    expect(deriveCadTrayExport(projectId,designId,{...group,revision:8},instances,chain()).sourceSha256).toBe(original.sourceSha256);
    expect(deriveCadTrayExport(projectId,designId,group,[{...instances[0],revision:2}],chain()).sourceSha256).not.toBe(original.sourceSha256);
    expect(deriveCadTrayExport(projectId,designId,group,[{...instances[0],material_asset_id:id(999)}],chain()).sourceSha256).not.toBe(original.sourceSha256);
  });
});
describe('Add CAD route to ordinary project Trays list',()=>{
  it('exports a three-arm tee into one ordinary row and reuses its exact graph source proof',async()=>{
    group.name='BC027-1';
    instances=[{...instance(),part_number:'KSLT 60.303 S',component_kind:'tee',cut_length_mm:null,
      original_filename:'NDX_KLT_60-303_MED_214.step',source_sha256:'d2d9934607cc4a8aac6331e732522541fe23afce08a4c621685092188b5d936f'}];
    const response=await save();expect(response.status).toBe(200);
    const result=await response.json();
    expect(result).toMatchObject({name:'BC027-1',type:'KSLT 60.303 S',elementCount:1,created:true,reused:false});
    expect(result.lengthMm).toBeCloseTo(2385,8);
    expect(row).toMatchObject({name:'BC027-1',width_mm:300,height_mm:60});
    expect(Number(row!.length_mm)).toBeCloseTo(2385,8);
    const source=(link!.source_proof as {source:{schemaVersion:string;centerlineGraph:unknown[];centerlineMetres:unknown[]}}).source;
    expect(source.schemaVersion).toBe('wfc.cad.route-tray-source.v2');
    expect(source.centerlineGraph).toHaveLength(3);expect(source.centerlineMetres).toEqual([]);
    expect(writes().filter(([sql])=>String(sql).startsWith('INSERT INTO trays'))).toHaveLength(1);
    const savedId=row!.id,savedProof=structuredClone(link);mocks.query.mockClear();
    expect(await(await save()).json()).toMatchObject({trayId:savedId,lengthMm:result.lengthMm,created:false,reused:true});
    expect(writes()).toEqual([]);expect(link).toEqual(savedProof);expect(group.status).toBe('draft');
  });
  it('requires authority and a strict current revision before any transaction',async()=>{
    expect((await save(undefined,false)).status).toBe(403);
    expect((await save({expectedRevision:7,source:'cad-route',trayId:id(999)})).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('creates one ordinary auto-length row with source proof, independently of any prepared PF network',async()=>{
    const response=await save();expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({name:'BC182',purpose:'Control',type:'KL-FIRST',lengthMm:1500,created:true,reused:false,source:'cad-route'});
    expect(row).toMatchObject({name:'BC182',tray_type:'KL-FIRST',purpose:'Control',length_source:'auto'});
    expect(trayLengthCalculationSchema.parse(row!.length_calculation)).toMatchObject({source:'cad-route',designId,routeId,routeRevision:7,lengthMm:1500,elementCount:1});
    expect(link).toMatchObject({project_id:projectId,design_id:designId,route_group_id:routeId,tray_id:row!.id,projection:cadTrayProjection(row!)});
    expect(mocks.query.mock.calls.every(([sql])=>!String(sql).includes('pf_artifacts')&&!String(sql).includes('pf_project_preparations'))).toBe(true);
    expect(group.status).toBe('draft');expect(group.revision).toBe(7);expect(instances[0].revision).toBe(1);
  });
  it('reuses the same row and proof without writes or timestamp churn on repeated clicks',async()=>{
    await save();const savedId=row!.id,savedProof=structuredClone(link),savedCalculation=structuredClone(row!.length_calculation);
    mocks.query.mockClear();
    const response=await save();expect(await response.json()).toMatchObject({trayId:savedId,created:false,reused:true});
    expect(writes()).toEqual([]);expect(link).toEqual(savedProof);expect(row!.length_calculation).toEqual(savedCalculation);
  });
  it('saves separated sections as one Trays row with the summed cut length and graph proof',async()=>{
    group.name='BC904';instances=[{...instance(),cut_length_mm:1300,x_mm:10400,y_mm:80350,z_mm:17530},
      {...instance(11),cut_length_mm:2050,x_mm:10550,y_mm:80130,z_mm:18600}];
    const positions=structuredClone(instances);
    const response=await save();expect(response.status).toBe(200);
    const result=await response.json();expect(result).toMatchObject({name:'BC904',elementCount:2,created:true});
    expect(result.lengthMm).toBeCloseTo(3350,8);
    expect(row).toMatchObject({name:'BC904',tray_type:'KL-FIRST'});expect(Number(row!.length_mm)).toBeCloseTo(3350,8);
    const source=(link!.source_proof as {source:{centerlineGraph:unknown[];centerlineMetres:unknown[]}}).source;
    expect(source.centerlineGraph).toHaveLength(2);expect(source.centerlineMetres).toEqual([]);
    const savedId=row!.id;mocks.query.mockClear();
    expect(await(await save()).json()).toMatchObject({trayId:savedId,reused:true});
    expect(writes()).toEqual([]);expect(instances).toEqual(positions);
  });
  it('refreshes the same owned row after an explicit click for revised CAD geometry',async()=>{
    await save();const savedId=row!.id,savedHash=link!.source_sha256;
    instances[0]={...instances[0],cut_length_mm:2000,revision:2};group.revision=8;mocks.query.mockClear();
    expect(await (await save()).json()).toMatchObject({trayId:savedId,lengthMm:2000,created:false,reused:false});
    expect(row!.length_mm).toBe(2000);expect(link!.source_sha256).not.toBe(savedHash);
    expect(writes().some(([sql])=>String(sql).startsWith('INSERT INTO trays'))).toBe(false);
    expect(row!.include_grounding_cable).toBe(true);expect(row!.use_trefoil_clamps).toBe(true);
  });
  it('preserves a manually edited linked row instead of overwriting its values',async()=>{
    await save();row!.length_mm=999;mocks.query.mockClear();
    const response=await save();expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'CAD_ROUTE_TRAY_EDITED'});
    expect(writes()).toEqual([]);expect(row!.length_mm).toBe(999);
  });
  it('never adopts an unrelated row with the same name',async()=>{
    duplicate=true;const response=await save();expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:'CAD_ROUTE_TRAY_NAME_CONFLICT'});expect(writes()).toEqual([]);expect(link).toBeUndefined();
  });
  it('rejects stale group revisions and rolls back a failed link publication atomically',async()=>{
    expect((await save({expectedRevision:6})).status).toBe(409);expect(writes()).toEqual([]);
    failLink=true;expect((await save()).status).toBe(409);expect(row).toBeUndefined();expect(link).toBeUndefined();
    expect(mocks.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it('adopts only its matching previously published row, adding auto proof without creating another tray',async()=>{
    const fields=deriveCadTrayExport(projectId,designId,group,instances,chain()).fields;
    const trayId=id(50);row=tray(trayId,[projectId,trayId,fields.name,fields.purpose,fields.trayType,300,60,1500,'null']);row.length_source='manual';
    group.status='published';group.project_tray_id=trayId;group.publication={traySnapshot:{id:trayId,...fields}};
    const response=await save();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({trayId,created:false,reused:false});
    expect(writes().some(([sql])=>String(sql).startsWith('INSERT INTO trays'))).toBe(false);
    expect(row).toMatchObject({id:trayId,name:'BC182',tray_type:'KL-FIRST',length_mm:1500,length_source:'auto'});expect(link!.tray_id).toBe(trayId);
  });
  it('refuses adoption when the published snapshot or row has been changed',async()=>{
    const fields=deriveCadTrayExport(projectId,designId,group,instances,chain()).fields,trayId=id(50);
    row=tray(trayId,[projectId,trayId,'EDITED',fields.purpose,fields.trayType,300,60,1500,'null']);row.length_source='manual';
    group.status='published';group.project_tray_id=trayId;group.publication={traySnapshot:{id:trayId,...fields}};
    expect((await save()).status).toBe(409);expect(writes()).toEqual([]);expect(row.name).toBe('EDITED');
  });
  it('allows publication reuse only for the same semantic source and saved owned projection',async()=>{
    await save();const client={query:mocks.query} as unknown as Parameters<typeof compatibleCadTrayExport>[0];
    expect((await compatibleCadTrayExport(client,projectId,designId,group,instances,chain()))?.row.id).toBe(row!.id);
    instances[0]={...instances[0],revision:2};
    await expect(compatibleCadTrayExport(client,projectId,designId,group,instances,chain())).rejects.toMatchObject({code:'CAD_ROUTE_TRAY_EXPORT_STALE'});
  });
});

describe('automatic list synchronization after section ownership changes',()=>{
  const sourceId=id(60),targetId=routeId;
  async function fixture(listSource=true,listTarget=true){
    const routes=new Map<string,Group>([
      [sourceId,{...group,id:sourceId,name:'SOURCE',revision:3}],
      [targetId,{...group,name:'TARGET',revision:5}],
    ]);
    const moved=instance(11);
    const members=new Map([[sourceId,[instance(10),moved]],[targetId,[instance(12)]]]);
    const rows=new Map<string,TrayRow>(),exports=new Map<string,Link>();
    let failureRoute:string|null=null;
    mocks.inputs.mockImplementation(async(_client,_project,_design,selected:string)=>{
      const placed=members.get(selected)!;
      return {group:routes.get(selected)!,instances:placed,chain:buildCadChain(placed,[]),transitions:[]};
    });
    mocks.query.mockImplementation(async(sql:string,values:unknown[]=[])=>{
      if(sql.startsWith('SELECT * FROM cad_route_tray_exports'))return {rows:exports.has(String(values[2]))?[exports.get(String(values[2]))]:[]};
      if(sql.startsWith('SELECT * FROM trays'))return {rows:rows.has(String(values[1]))?[rows.get(String(values[1]))]:[]};
      if(sql.startsWith('SELECT status FROM cad_route_groups'))return {rows:[routes.get(String(values[2]))!]};
      if(sql.startsWith('SELECT COUNT(*)'))return {rows:[{member_count:members.get(String(values[2]))!.length}]};
      if(sql.startsWith('SELECT id FROM trays'))return {rows:[]};
      if(sql.startsWith('INSERT INTO trays')||sql.startsWith('UPDATE trays')){
        const trayId=String(values[1]),derived=tray(trayId,values);
        const {name,purpose,tray_type,width_mm,height_mm,length_mm,length_source,length_calculation}=derived;
        const written=sql.startsWith('INSERT')?derived:{...rows.get(trayId)!,name,purpose,tray_type,width_mm,height_mm,length_mm,length_source,length_calculation};
        rows.set(trayId,written);return {rows:[written]};
      }
      if(sql.startsWith('INSERT INTO cad_route_tray_exports')){
        if(values[2]===failureRoute)throw Object.assign(Error('Export write failed'),{code:'23505'});
        exports.set(String(values[2]),{project_id:String(values[0]),design_id:String(values[1]),route_group_id:String(values[2]),tray_id:String(values[3]),
          source_sha256:String(values[4]),source_proof:JSON.parse(String(values[5])),projection:JSON.parse(String(values[6]))});
      }
      if(sql.startsWith('DELETE FROM cad_route_tray_exports'))exports.delete(String(values[2]));
      if(sql.startsWith('DELETE FROM trays')){
        const removed=rows.delete(String(values[1]));return {rows:removed?[{id:values[1]}]:[]};
      }
      return {rows:[]};
    });
    const client={query:mocks.query} as unknown as Parameters<typeof writeCadTrayExport>[0];
    if(listSource)await writeCadTrayExport(client,projectId,designId,sourceId,actorId);
    if(listTarget)await writeCadTrayExport(client,projectId,designId,targetId,actorId);
    const sync=()=>synchronizeCadTrayExportsAfterTransfer(client,projectId,designId,sourceId,targetId,actorId);
    const move=()=>{
      members.set(sourceId,[members.get(sourceId)![0]]);members.get(targetId)!.push(moved);
      routes.get(sourceId)!.revision++;routes.get(targetId)!.revision++;
    };
    mocks.query.mockClear();mocks.audit.mockClear();mocks.inputs.mockClear();
    return {routes,members,rows,exports,client,sync,move,setFailure:(selected:string)=>{failureRoute=selected;}};
  }
  it('refreshes both exact owned rows and proofs and can be repeated without duplicate writes',async()=>{
    const state=await fixture(),sourceTray=state.exports.get(sourceId)!.tray_id,targetTray=state.exports.get(targetId)!.tray_id;
    const hashes=[state.exports.get(sourceId)!.source_sha256,state.exports.get(targetId)!.source_sha256];
    state.rows.get(sourceTray)!.include_grounding_cable=false;
    state.move();await state.sync();
    expect(state.rows.size).toBe(2);
    expect(state.exports.get(sourceId)!.tray_id).toBe(sourceTray);expect(state.exports.get(targetId)!.tray_id).toBe(targetTray);
    expect(state.rows.get(sourceTray)).toMatchObject({length_mm:1500,include_grounding_cable:false});
    expect(state.rows.get(targetTray)).toMatchObject({length_mm:3000});
    expect(state.exports.get(sourceId)!.source_sha256).not.toBe(hashes[0]);
    expect(state.exports.get(targetId)!.source_sha256).not.toBe(hashes[1]);
    for(const selected of [sourceId,targetId]){
      const saved=await compatibleCadTrayExport(state.client,projectId,designId,state.routes.get(selected)!,state.members.get(selected)!,buildCadChain(state.members.get(selected)!,[]));
      expect(saved?.row.id).toBe(state.exports.get(selected)!.tray_id);
    }
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    mocks.query.mockClear();await state.sync();expect(writes()).toEqual([]);
  });
  it('keeps transferred listed geometry included by creating the target list row automatically',async()=>{
    const state=await fixture(true,false);state.move();await state.sync();
    expect(state.rows.size).toBe(2);expect(state.exports.has(targetId)).toBe(true);
    expect(state.rows.get(state.exports.get(targetId)!.tray_id)).toMatchObject({name:'TARGET',length_mm:3000});
    expect(writes().filter(([sql])=>String(sql).startsWith('INSERT INTO trays'))).toHaveLength(1);
  });
  it('removes the verified generated source row when its final member leaves, retaining the empty draft',async()=>{
    const state=await fixture(true,false),oldTray=state.exports.get(sourceId)!.tray_id;
    state.members.set(sourceId,[]);state.members.get(targetId)!.push(instance(10),instance(11));
    await state.sync();
    expect(state.rows.has(oldTray)).toBe(false);expect(state.exports.has(sourceId)).toBe(false);
    expect(state.routes.get(sourceId)).toMatchObject({id:sourceId,status:'draft'});
    expect(state.exports.has(targetId)).toBe(true);expect(state.rows.size).toBe(1);
    expect(mocks.inputs.mock.calls.map(call=>call[3])).not.toContain(sourceId);
  });
  it('removes an empty listed target after a membership edit without building empty geometry',async()=>{
    const state=await fixture(false,true),oldTray=state.exports.get(targetId)!.tray_id;
    state.members.set(targetId,[]);
    await synchronizeCadTrayExportsAfterTransfer(state.client,projectId,designId,null,targetId,actorId);
    expect(state.rows.has(oldTray)).toBe(false);expect(state.exports.size).toBe(0);expect(mocks.inputs).not.toHaveBeenCalled();
  });
  it('does not turn unlisted drafts into Trays rows',async()=>{
    const state=await fixture(false,false);state.move();await state.sync();
    expect(state.rows.size).toBe(0);expect(state.exports.size).toBe(0);expect(writes()).toEqual([]);expect(mocks.inputs).not.toHaveBeenCalled();
  });
  it('updates a listed target when the transferred component had no old export',async()=>{
    const state=await fixture(false,true);state.move();await state.sync();
    expect(state.exports.size).toBe(1);expect(state.exports.has(sourceId)).toBe(false);
    expect(state.rows.get(state.exports.get(targetId)!.tray_id)?.length_mm).toBe(3000);
  });
  it.each([sourceId,targetId])('preserves manually edited derived values before changing either export: %s',async selected=>{
    const state=await fixture(),edited=state.rows.get(state.exports.get(selected)!.tray_id)!;
    edited.length_mm=999;state.move();
    await expect(state.sync()).rejects.toMatchObject({code:'CAD_ROUTE_TRAY_EDITED'});
    expect(edited.length_mm).toBe(999);expect(writes()).toEqual([]);
    expect(mocks.query.mock.calls.some(([sql])=>String(sql).startsWith('DELETE'))).toBe(false);
  });
  it('propagates failed target writes so the owning transaction can roll back the complete transfer',async()=>{
    const state=await fixture();state.move();state.setFailure(targetId);
    await expect(state.sync()).rejects.toMatchObject({code:'23505'});
  });
  it('keeps publication immutability when asked to synchronize a published route',async()=>{
    const state=await fixture();state.routes.get(sourceId)!.status='published';state.move();
    await expect(state.sync()).rejects.toMatchObject({code:'CAD_ROUTE_PUBLISHED'});expect(writes()).toEqual([]);
  });
});
