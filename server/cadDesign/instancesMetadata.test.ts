// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { STRAIGHT_SOURCE_SHA256 } from '../../shared/cadLengths.js';
const db=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../db.js',()=>({pool:db}));
vi.mock('../config.js',()=>({config:{jwtSecret:'test-only',bcryptRounds:4}}));
vi.mock('../services/objectStorageService.js',()=>({getObjectStream:vi.fn(),getProjectBucket:vi.fn()}));
import { cadDesignRouter } from './routes.js';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const project=id(1),design=id(2),route=id(3);
const row=()=>({id:id(4),catalogItemId:id(5),revision:2,xMm:100,yMm:200,zMm:300,qx:0,qy:0,qz:0,qw:1,
  lengthMm:1500,originalFilename:'NDX_KL_60-303_F_MED_214.step',sourceSha256:STRAIGHT_SOURCE_SHA256,
  manufacturer:'Niedax',partNumber:'KL60.303F',family:'Ladder',conversionStatus:'ready',materialAssetId:id(6),cadRevision:3,componentId:id(7),
  componentKind:'straight',_widthMm:300 as number|null,_heightMm:60 as number|null,_routeId:route as string|null,_routeName:'BC182' as string|null,_routePurpose:'LV' as string|null});
let rows:ReturnType<typeof row>[],server:Server,base:string;
beforeAll(async()=>{
  const app=express();app.use('/api/projects/:projectId/cad-design',cadDesignRouter);
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing address');
  base=`http://127.0.0.1:${address.port}/api/projects/${project}/cad-design/designs/${design}/instances`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
beforeEach(()=>{
  vi.clearAllMocks();rows=[row()];
  db.query.mockImplementation(async(_sql:string,values:string[])=>({rows:values[0]===project&&values[1]===design?structuredClone(rows):[]}));
});
it('enriches saved instances with the same seven canonical STEP properties in one scoped statement',async()=>{
  const response=await fetch(base);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');
  const {instances}=await response.json();
  expect(instances[0]).toMatchObject({id:id(4),catalogItemId:id(5),revision:2,xMm:100,yMm:200,zMm:300,lengthMm:1500,
    metadata:{instanceId:id(4),name:`BC182 / ${id(4)}`,actualLengthMm:1500,widthMm:300,heightMm:60,partNumber:'KL60.303F',manufacturer:'Niedax',purpose:'LV',cadAssetId:id(6),cadRevision:3},
    route:{id:route,name:'BC182',purpose:'LV'}});
  expect(instances[0]).not.toHaveProperty('_widthMm');expect(instances[0]).not.toHaveProperty('_routePurpose');
  expect(db.query).toHaveBeenCalledOnce();const sql=db.query.mock.calls[0][0] as string;
  expect(sql).toContain('COALESCE(p.width_mm,t.width_mm)');
  expect(sql).toContain('m.project_id=i.project_id AND m.design_id=i.design_id AND m.instance_id=i.id');
  expect(sql).toContain('g.project_id=m.project_id AND g.design_id=m.design_id');
  expect(sql).toContain('WHERE i.project_id=$1 AND d.id=$2');
  expect(db.query.mock.calls[0][1]).toEqual([project,design]);
});
it('reflects current route name, Purpose and saved cut length on the next read',async()=>{
  await fetch(base);rows[0]._routeName='BC183';rows[0]._routePurpose='I&C';rows[0].lengthMm=2400;
  const {instances}=await (await fetch(base)).json();
  expect(instances[0].metadata).toMatchObject({name:`BC183 / ${id(4)}`,purpose:'I&C',actualLengthMm:2400});
  expect(instances[0].route).toEqual({id:route,name:'BC183',purpose:'I&C'});
});
it('preserves explicit unknown local dimensions and unassigned identity without inventing dimensions from placement',async()=>{
  rows[0]._routeId=null;rows[0]._routeName=null;rows[0]._routePurpose=null;rows[0]._widthMm=null;rows[0]._heightMm=null;
  rows[0].componentKind='other';
  const {instances}=await (await fetch(base)).json();
  expect(instances[0].route).toEqual({id:null,name:'Unassigned components',purpose:null});
  expect(instances[0].metadata).toMatchObject({actualLengthMm:null,widthMm:null,heightMm:null,purpose:null});
});
it('normalizes omitted numeric metadata to explicit null for older rows and fixtures',async()=>{
  for(const key of ['_widthMm','_heightMm','cadRevision'])Reflect.deleteProperty(rows[0],key);
  const {instances}=await (await fetch(base)).json();
  expect(instances[0].metadata).toMatchObject({widthMm:null,heightMm:null,cadRevision:null});
});
it('keeps empty and out-of-scope designs empty and imposes no 128-part export limit on instance reads',async()=>{
  for(const target of [base.replace(project,id(99)),base.replace(design,id(99))])expect(await (await fetch(target)).json()).toEqual({instances:[]});
  rows=[];expect(await (await fetch(base)).json()).toEqual({instances:[]});
  rows=Array.from({length:129},(_,n)=>({...row(),id:id(n+100)}));
  const {instances}=await (await fetch(base)).json();expect(instances).toHaveLength(129);
  expect(new Set(instances.map((entry:{metadata:{instanceId:string}})=>entry.metadata.instanceId)).size).toBe(129);
});
