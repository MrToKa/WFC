// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrayRow } from '../models/tray.js';
import { STRAIGHT_SOURCE_SHA256 } from '../../shared/cadLengths.js';
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
import { cadRouteTrayExportsRouter, deriveCadTrayExport, compatibleCadTrayExport, cadTrayProjection } from './routeTrayExports.js';

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

describe('server-derived route-list source and projection',()=>{
  it('selects the first placed straight SKU, preserving source order instead of sorting UUIDs',()=>{
    const bend={...instance(5),component_kind:'bend',part_number:'BEND-SKU'};
    const first={...instance(99),part_number:'FIRST-PLACED-STRAIGHT'},second={...instance(10),part_number:'LATER-STRAIGHT'};
    expect(deriveCadTrayExport(projectId,designId,group,[bend,first,second],{points:[[0,0,0],[0,0,1]],lengthMetres:1}).fields.trayType).toBe('FIRST-PLACED-STRAIGHT');
    expect(deriveCadTrayExport(projectId,designId,group,[bend],{points:[[0,0,0],[0,0,1]],lengthMetres:1}).fields.trayType).toBe('BEND-SKU');
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
