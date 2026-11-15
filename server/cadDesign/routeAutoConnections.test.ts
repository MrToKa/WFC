// @vitest-environment node
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRAIGHT_SOURCE_SHA256 } from '../../shared/cadLengths.js';
import type { PublicationConnection, PublicationInstance } from './routePublication.js';

const mocks=vi.hoisted(()=>({raw:vi.fn(),network:vi.fn(),query:vi.fn(),transaction:vi.fn()}));
vi.mock('../db.js',()=>({pool:{query:vi.fn(),connect:vi.fn()}}));
vi.mock('../config.js',()=>({config:{jwtSecret:'test-only',bcryptRounds:4}}));
vi.mock('../services/objectStorageService.js',()=>({getObjectStream:vi.fn(),getProjectBucket:vi.fn()}));
vi.mock('../middleware.js',()=>({requireAdmin:(req:express.Request,res:express.Response,next:express.NextFunction)=>{
  if(req.header('x-test-admin')==='yes')next();else res.status(403).json({code:'ADMIN_REQUIRED'});
}}));
vi.mock('./routePublication.js',async original=>({...await original<typeof import('./routePublication.js')>(),
  groupRawInputs:mocks.raw,networkOptions:mocks.network,publicationTransaction:mocks.transaction}));
import { cadRouteAutoConnectionsRouter, inferCadConnections, selectAutoAttachments } from './routeAutoConnections.js';
import { buildCadChain, PublicationError } from './routePublication.js';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const projectId=id(1),designId=id(2),routeId=id(3),catalogId=id(4);
const row=(n:number,z_mm=0):PublicationInstance=>({id:id(n),catalog_item_id:catalogId,material_asset_id:id(5),revision:1,part_number:'KL 60.303 F',
  original_filename:'NDX_KL_60-303_F_MED_214.step',source_sha256:STRAIGHT_SOURCE_SHA256,component_kind:'straight',cut_length_mm:1500,
  x_mm:0,y_mm:0,z_mm,qx:0,qy:0,qz:0,qw:1});
const pair=(first=10,last=11):PublicationConnection=>({source_instance_id:id(first),source_name:'end',target_instance_id:id(last),target_name:'start'});
const networkPort=(n:number,point:[number,number,number]=[0,.03,0])=>({objectRevisionId:id(n),objectId:`dbid:${n}`,portIndex:0,pointMetres:point,routeCode:`/BASE${n}`,
  port:{pointMetres:point,outward:[0,0,1] as [number,number,number],u:[1,0,0] as [number,number,number],v:[0,1,0] as [number,number,number],widthMetres:.3,heightMetres:.06}});

describe('physical CAD internal connection inference',()=>{
  it('infers only a coincident, opposing verified pair and leaves member poses untouched',()=>{
    const instances=[row(10),row(11,1500)],before=JSON.stringify(instances);
    const result=inferCadConnections(instances,[]);
    expect(result.missing).toEqual([pair()]);expect(result.connected).toBe(true);expect(result.endpoints).toHaveLength(2);
    expect(JSON.stringify(instances)).toBe(before);
  });
  it('preserves valid existing joins and is idempotent',()=>{
    const result=inferCadConnections([row(10),row(11,1500)],[pair()]);
    expect(result.missing).toEqual([]);expect(result.connected).toBe(true);
  });
  it('retains partial verified progress and diagnoses remaining gaps without fabricating a chain',()=>{
    const result=inferCadConnections([row(10),row(11,1500),row(12,3401)],[]);
    expect(result.missing).toEqual([pair()]);expect(result.connected).toBe(false);expect(result.endpoints).toHaveLength(4);
    expect(result.diagnostics.componentCount).toBe(2);
    expect(result.diagnostics.nearestGaps[0].gapMm).toBeCloseTo(401,6);
    expect(result.diagnostics.nearestGaps[0].aligned).toBe(false);
    expect(result.diagnostics.nearestGaps[0].sourcePartNumber).toBe('KL 60.303 F');
  });
  it('keeps rolled contacts out of physical mating while permitting a separate bounded installation transition',()=>{
    const rolled={...row(11,1500),qz:Math.SQRT1_2,qw:Math.SQRT1_2};
    const result=inferCadConnections([row(10),rolled],[]);
    expect(result.missing).toEqual([]);expect(result.connected).toBe(true);expect(result.missingTransitions).toHaveLength(1);
  });
  it('rejects two competing candidates instead of choosing the first component',()=>{
    expect(()=>inferCadConnections([row(10),row(11,1500),row(12,1500)],[])).toThrow('More than one component');
  });
  it('rejects external saved connections and stale saved geometry',()=>{
    expect(()=>inferCadConnections([row(10)],[pair()])).toThrow('outside this group');
    expect(()=>inferCadConnections([row(10),row(11,1502)],[pair()])).toThrow('no longer aligned');
  });
  it('does not admit unsupported source geometry or unbounded groups',()=>{
    expect(()=>inferCadConnections([{...row(10),source_sha256:'0'.repeat(64)}],[])).toThrow('verified straight');
    expect(()=>inferCadConnections([],[])).toThrow('1–32');
  });
  it('adds a bounded 171 mm logical gap without moving either component and includes its actual route length',()=>{
    const instances=[row(10),row(11,1671)],before=JSON.stringify(instances);
    const result=inferCadConnections(instances,[]);
    expect(result.missing).toEqual([]);expect(result.missingTransitions).toHaveLength(1);expect(result.connected).toBe(true);
    const chain=buildCadChain(instances,[],result.missingTransitions);
    expect(chain.lengthMetres).toBeCloseTo(3.171,9);expect(JSON.stringify(instances)).toBe(before);
  });
  it('retains an existing logical transition idempotently and rejects one beyond the profile zone',()=>{
    const transition={...pair(),kind:'routing-transition' as const};
    const result=inferCadConnections([row(10),row(11,1671)],[],[transition]);
    expect(result.missing).toEqual([]);expect(result.missingTransitions).toEqual([]);expect(result.connected).toBe(true);
    expect(()=>inferCadConnections([row(10),row(11,1801)],[],[transition])).toThrow('longer than');
  });
  it('reproduces a five-part installation with one physical join and two logical 90-degree transitions',()=>{
    // Anonymous relative geometry: no project identifiers or absolute site coordinates.
    const first={...row(10),cut_length_mm:null,qx:.5,qy:.5,qz:.5,qw:.5};
    const bend={...row(11),component_kind:'bend',original_filename:'NDX_KLBK_60-303_MED_214.step',
      source_sha256:'7a5cf4947a9ea5fa213ceef84ba952fe2a9a63dee752f0c23a598320802c0014',cut_length_mm:null,
      x_mm:6645,y_mm:-795,z_mm:0,qx:Math.SQRT1_2,qw:Math.SQRT1_2};
    const vertical={...row(12),cut_length_mm:3750,x_mm:7699.071528,y_mm:-6616.906306,z_mm:-3691.014056,qz:-Math.SQRT1_2,qw:Math.SQRT1_2};
    const long={...row(13),cut_length_mm:null,x_mm:6795,y_mm:-795,z_mm:0,qx:Math.SQRT1_2,qw:Math.SQRT1_2};
    const cross={...row(14),cut_length_mm:1000,x_mm:6895,y_mm:-6645,z_mm:0,qx:.5,qy:.5,qz:.5,qw:.5};
    const instances=[first,bend,vertical,long,cross],before=JSON.stringify(instances);
    const existing=[{source_instance_id:long.id,source_name:'start',target_instance_id:bend.id,target_name:'start'}];
    const result=inferCadConnections(instances,existing);
    expect(result.missing).toEqual([{source_instance_id:first.id,source_name:'end',target_instance_id:bend.id,target_name:'end'}]);
    expect(result.missingTransitions).toHaveLength(2);expect(result.connected).toBe(true);expect(result.endpoints).toHaveLength(2);
    const gaps=result.diagnostics.logicalTransitions.map(link=>link.gapMm).sort((a,b)=>a-b);
    expect(gaps[0]).toBeGreaterThan(170);expect(gaps[0]).toBeLessThan(172);expect(gaps[1]).toBeCloseTo(Math.hypot(100,150),6);
    const chain=buildCadChain(instances,[...existing,...result.missing],result.missingTransitions);
    expect(chain.lengthMetres).toBeCloseTo(6+6+3.75+1+(.290+.650*Math.PI/2)+gaps.reduce((sum,gap)=>sum+gap/1000,0),5);
    expect(JSON.stringify(instances)).toBe(before);
  });
});

describe('automatic actual-network endpoint selection',()=>{
  const instances=[row(10)],ends=buildCadChain(instances,[]).endpoints;
  it('prefers an already aligned connection and returns human-readable target metadata',()=>{
    const result=selectAutoAttachments(instances,ends,[networkPort(20,[0,.03,-10]),networkPort(21)]);
    expect(result.status).toBe('aligned');
    expect(result.attachments).toEqual([expect.objectContaining({instanceId:id(10),portName:'start',targetObjectRevisionId:id(21),targetRouteCode:'/BASE21',targetPointMetres:[0,.03,0],gapMm:0})]);
  });
  it('chooses a unique nearest matching target for whole-route alignment only',()=>{
    const result=selectAutoAttachments(instances,ends,[networkPort(20,[0,.03,-1])]);
    expect(result.status).toBe('alignment-required');expect(result.attachments).toHaveLength(1);expect(result.attachments[0].gapMm).toBeCloseTo(1000);
  });
  it('does not guess between equally near distinct physical points',()=>{
    const result=selectAutoAttachments(instances,ends,[networkPort(20,[0,.03,-1]),networkPort(21,[-1,.03,0])]);
    expect(result.status).toBe('ambiguous');expect(result.attachments).toEqual([]);
  });
  it('deduplicates aliases for the identical physical point and frame using a stable canonical identity',()=>{
    const result=selectAutoAttachments(instances,ends,[networkPort(21),networkPort(20)]);
    expect(result.status).toBe('aligned');expect(result.attachments).toHaveLength(1);expect(result.attachments[0].targetObjectRevisionId).toBe(id(20));
  });
  it('rejects incompatible profiles without manufacturing an existing network point',()=>{
    const target=networkPort(20);target.port.widthMetres=.6;
    const result=selectAutoAttachments(instances,ends,[target]);expect(result.status).toBe('unavailable');expect(result.attachments).toEqual([]);
  });
});

let server:Server,base:string;
beforeAll(async()=>{
  const app=express();app.use(express.json());app.use('/projects/:projectId',cadRouteAutoConnectionsRouter);
  app.use((_error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(500).json({code:'UNEXPECTED_TEST_ERROR'}));
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing test address');
  base=`http://127.0.0.1:${address.port}/projects/${projectId}/designs/${designId}/routes/${routeId}`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.raw.mockResolvedValue({group:{id:routeId,revision:3,status:'draft'},instances:[row(10),row(11,1500)],connections:[]});
  mocks.transaction.mockImplementation(async(_req:unknown,work:(client:{query:typeof mocks.query})=>Promise<unknown>)=>{
    await mocks.query('BEGIN');try{const result=await work({query:mocks.query});await mocks.query('COMMIT');return result;}catch(error){await mocks.query('ROLLBACK');throw error;}
  });
  mocks.query.mockImplementation(async(sql:string)=>{
    if(sql.startsWith('SELECT instance_id FROM'))return {rows:[{instance_id:id(10)},{instance_id:id(11)}]};
    if(sql.includes('FROM cad_catalog_ports'))return {rows:[{id:id(30),catalog_item_id:catalogId,name:'start',port_type:'cable-ladder-60x300'},{id:id(31),catalog_item_id:catalogId,name:'end',port_type:'cable-ladder-60x300'}]};
    if(sql.startsWith('SELECT model_version_id'))return {rows:[{model_version_id:id(40)}]};
    return {rows:[]};
  });
  mocks.network.mockRejectedValue(new PublicationError('CAD_ROUTE_NETWORK_REQUIRED','Prepare the existing Path Finder network first.'));
});
const connect=(body:unknown={expectedRevision:3},admin=true)=>fetch(`${base}/auto-connect`,{method:'POST',headers:{'Content-Type':'application/json','x-test-admin':admin?'yes':'no'},body:JSON.stringify(body)});
const writes=()=>mocks.query.mock.calls.filter(([sql])=>/^INSERT|^UPDATE|^DELETE/.test(String(sql)));
describe('automatic connection endpoints',()=>{
  it('requires admin access before opening a transaction',async()=>{expect((await connect(undefined,false)).status).toBe(403);expect(mocks.transaction).not.toHaveBeenCalled();});
  it('requires a strict saved revision before any database access',async()=>{
    expect((await connect({expectedRevision:3,move:true})).status).toBe(400);expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('saves only the missing physical link and bumps group revision once without modifying members or source data',async()=>{
    const response=await connect();expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({routeId,revision:4,connectionsCreated:1,connected:true,diagnostics:{networkRequired:true}});
    expect(writes()).toHaveLength(2);expect(writes()[0][0]).toContain('INSERT INTO cad_design_connections');
    expect(writes()[0][1].slice(1)).toEqual([projectId,designId,id(10),catalogId,id(31),id(11),catalogId,id(30)]);
    expect(writes()[1][0]).toContain('UPDATE cad_route_groups');expect(mocks.query).toHaveBeenLastCalledWith('COMMIT');
    expect(writes().every(([sql])=>!/cad_design_instances|cad_catalog_items|material_|\btrays\b/.test(String(sql)))).toBe(true);
  });
  it('does not duplicate existing joins or bump an unchanged group revision',async()=>{
    mocks.raw.mockResolvedValue({group:{id:routeId,revision:3,status:'draft'},instances:[row(10),row(11,1500)],connections:[pair()]});
    const response=await connect();expect(await response.json()).toMatchObject({connectionsCreated:0,revision:3,connected:true});expect(writes()).toEqual([]);
  });
  it('stores a logical gap in its separate topology table without inventing a physical CAD mate',async()=>{
    mocks.raw.mockResolvedValue({group:{id:routeId,revision:3,status:'draft'},instances:[row(10),row(11,1671)],connections:[],transitions:[]});
    const response=await connect();expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({connectionsCreated:0,routingTransitionsCreated:1,connected:true,revision:4});
    expect(writes()).toHaveLength(2);expect(writes()[0][0]).toContain('INSERT INTO cad_route_transition_links');
    expect(writes().some(([sql])=>String(sql).includes('INSERT INTO cad_design_connections'))).toBe(false);
  });
  it.each([{revision:4,status:'draft'},{revision:3,status:'published'}])('rejects stale or published groups before inserting links',async group=>{
    mocks.raw.mockResolvedValue({group,instances:[row(10)],connections:[]});expect((await connect()).status).toBe(409);expect(writes()).toEqual([]);expect(mocks.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
  it('reads suggestions without saving inferred joins or pretending that network choices exist',async()=>{
    const response=await fetch(`${base}/auto-attachments`,{headers:{'x-test-admin':'yes'}});expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({status:'incomplete',attachments:[]});expect(writes()).toEqual([]);expect(mocks.network).not.toHaveBeenCalled();
  });
  it('reports the missing existing PF network honestly for a complete saved chain',async()=>{
    mocks.raw.mockResolvedValue({group:{id:routeId,revision:3,status:'draft'},instances:[row(10),row(11,1500)],connections:[pair()]});
    const response=await fetch(`${base}/auto-attachments`,{headers:{'x-test-admin':'yes'}});
    expect(await response.json()).toMatchObject({status:'network-required',attachments:[],diagnostics:{networkRequired:true}});expect(writes()).toEqual([]);
  });
  it('retains saved logical installation diagnostics when the real PF network is not prepared',async()=>{
    mocks.raw.mockResolvedValue({group:{id:routeId,revision:3,status:'draft'},instances:[row(10),row(11,1671)],connections:[],transitions:[{...pair(),kind:'routing-transition'}]});
    const response=await fetch(`${base}/auto-attachments`,{headers:{'x-test-admin':'yes'}});
    const result=await response.json();
    expect(result).toMatchObject({status:'network-required',attachments:[],diagnostics:{networkRequired:true,componentCount:1}});
    expect(result.diagnostics.logicalTransitions).toHaveLength(1);
    expect(result.diagnostics.logicalTransitions[0]).toMatchObject({kind:'routing-transition',sourcePartNumber:'KL 60.303 F'});
    expect(result.diagnostics.logicalTransitions[0].gapMm).toBeCloseTo(171,6);expect(writes()).toEqual([]);
  });
  it.each(['23503','23505','23514'])('returns a safe conflict and rolls back a database link constraint %s',async code=>{
    const normal=mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async(sql:string,...args:unknown[])=>{
      if(sql.startsWith('INSERT INTO cad_design_connections'))throw Object.assign(new Error('private database constraint detail'),{code});
      return normal(sql,...args);
    });
    const response=await connect();expect(response.status).toBe(409);
    const body=await response.json();expect(body.message).not.toContain('private database');
    expect(body.code).toBe(code==='23503'?'CAD_ROUTE_MEMBERSHIP_CONFLICT':'CAD_ROUTE_CONNECTION_CONFLICT');
    expect(mocks.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(mocks.query.mock.calls.some(([sql])=>sql==='COMMIT')).toBe(false);
  });
});
