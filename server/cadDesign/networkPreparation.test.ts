// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { PoolClient } from 'pg';
import { geometryTraceFixture } from '../pathfinder/geometryTraceFixtures.js';
import { buildGeometryTrace } from '../pathfinder/geometryTraceBuilder.js';
import { STRAIGHT_SOURCE_SHA256 } from '../../shared/cadLengths.js';
import type { PublicationInstance } from './routePublication.js';
import type { TrayRow } from '../models/tray.js';
import { createHash } from 'node:crypto';
import { canonicalPurposeJson, catalogRoutingHashInput } from '../../shared/pathfinderPurposePolicy.js';
import { projectRoutingCatalogRows } from '../pathfinder/catalog.js';

const mocks = vi.hoisted(() => ({transaction:vi.fn(),inputs:vi.fn(),export:vi.fn(),policy:vi.fn(),prepared:vi.fn(),execute:vi.fn(),dirty:vi.fn()}));
vi.mock('../db.js', () => ({pool:{query:vi.fn(),connect:vi.fn()}}));
vi.mock('../config.js', () => ({config:{jwtSecret:'test-only',bcryptRounds:4}}));
vi.mock('../pathfinder/auth.js', async original => ({...await original<typeof import('../pathfinder/auth.js')>(),principalTransaction:mocks.transaction}));
vi.mock('../pathfinder/purposePolicy.js', () => ({readRoutingPolicyScope:mocks.policy}));
vi.mock('../pathfinder/routingScope.js', async original => ({...await original<typeof import('../pathfinder/routingScope.js')>(),requirePreparedRoutingScope:mocks.prepared}));
vi.mock('../pathfinder/recalculationSchema.js', () => ({markRecalculationDirty:mocks.dirty}));
vi.mock('../pathfinder/runtime.js', () => ({getPathFinderRuntime:() => ({worker:{executePreparation:mocks.execute}})}));
vi.mock('./routePublication.js', async original => ({...await original<typeof import('./routePublication.js')>(),groupInputs:mocks.inputs}));
vi.mock('./routeTrayExports.js', async original => ({...await original<typeof import('./routeTrayExports.js')>(),compatibleCadTrayExport:mocks.export}));
vi.mock('../middleware.js', () => ({requireAdmin:(req:express.Request,res:express.Response,next:express.NextFunction) => {
  if (req.header('x-test-admin') === 'yes') next(); else res.status(403).json({code:'ADMIN_REQUIRED'});
}}));
import { buildCadChain } from './routePublication.js';
import { cadTrayProjection } from './routeTrayExports.js';
import { cadNetworkPreparationRouter, prepareCadDesignNetwork } from './networkPreparation.js';

const id = (n:number) => `f1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixture = geometryTraceFixture();
const projectId = fixture.aggregate.projectId, modelId = fixture.aggregate.modelVersionId, designId = id(1);
const who = {userId:id(2),loginId:id(3),loginExpiresAt:Date.now()+3600000};
const input = {expectedArtifactId:fixture.aggregate.artifactId,expectedSnapshotSha256:fixture.aggregate.projection.sha256};
type Group = {id:string;name:string;tag:string;purpose:string;status:string;revision:number;project_tray_id:string|null;publication:unknown};
type Link = {row:TrayRow;sourceSha256:string;projection:unknown};
let groups:Group[], instances:Map<string,PublicationInstance[]>, trays:Map<string,TrayRow>, links:Map<string,Link>, history:unknown[][];
let base:{id:string;snapshot_sha256:string;model_version_id:string;manifest:typeof fixture.aggregate;routing_scope:Record<string,string>;producer_version:string;resolution_revision:string;geometry_revision:string};
let model:{model_version_id:string;selection_revision:string;content_fingerprint:string} | null;
let trace:ReturnType<typeof buildGeometryTrace>['manifest'];
let rules:Map<string,string[]>, txDepth:number;
const query = vi.fn(async (sql:string, values:unknown[] = []):Promise<{rows:unknown[]}> => {
  if (sql.startsWith('/* cad-network-design */')) return {rows:model ? [structuredClone(model)] : []};
  if (sql.startsWith('/* cad-network-base */')) return {rows:[structuredClone(base)]};
  if (sql.startsWith('/* cad-network-trace */')) return {rows:[{id:trace.id,manifest:structuredClone(trace)}]};
  if (sql.startsWith('/* cad-network-groups */')) return {rows:groups.filter(group => group.status === 'published' || links.has(group.id))
    .map(group => ({id:group.id,status:group.status,publication:structuredClone(group.publication),exported_tray_id:links.get(group.id)?.row.id ?? null}))};
  if (sql.startsWith('/* cad-network-purpose */')) return {rows:rules.has(String(values[1])) ? [{allowed_categories:rules.get(String(values[1]))}] : []};
  if (sql.startsWith('/* cad-network-tray */')) return {rows:trays.has(String(values[1])) ? [structuredClone(trays.get(String(values[1]))!)] : []};
  if (sql.startsWith('SELECT producer_version,routing_scope FROM pf_artifact_routing_scopes')) return {rows:[{producer_version:base.producer_version,routing_scope:base.routing_scope}]};
  if (sql.startsWith('SELECT snapshot_sha256,model_version_id FROM pf_artifacts')) return {rows:[{snapshot_sha256:base.snapshot_sha256,model_version_id:base.model_version_id}]};
  if (sql.startsWith('SELECT status,project_tray_id,publication FROM cad_route_groups')) return {rows:groups.filter(group => group.publication !== null).map(group => structuredClone(group))};
  if (sql.startsWith('SELECT id::text,name,purpose,tray_type,width_mm,height_mm,length_mm FROM trays')) return {rows:[...trays.values()].filter(row => (values[1] as string[]).includes(row.id))};
  if (sql.startsWith('SELECT id::text,name,purpose FROM trays')) return {rows:[...trays.values()].filter(row => !(values[1] as string[]).includes(row.id)).map(({id,name,purpose}) => ({id,name,purpose}))};
  if (sql.startsWith('INSERT INTO cad_route_network_publication_history')) { history.push(structuredClone(values)); return {rows:[]}; }
  if (sql.startsWith('UPDATE cad_route_groups SET')) {
    const group = groups.find(value => value.id === values[2] && value.revision === values[5]);
    if (!group) return {rows:[]};
    group.status = 'published';group.project_tray_id = String(values[3]);group.publication = JSON.parse(String(values[4]));group.revision++;
    return {rows:[{id:group.id}]};
  }
  throw Error('Unexpected SQL: '+sql.slice(0,70));
});
const instance = (n:number):PublicationInstance => ({id:id(n),catalog_item_id:id(n+100),material_asset_id:id(n+200),revision:1,
  part_number:'KL 60.303 F',material_tray_id:id(n+300),material_tray_type:'KL 60.303 F',material_width_mm:300,material_height_mm:60,
  original_filename:'NDX_KL_60-303_F_MED_214.step',source_sha256:STRAIGHT_SOURCE_SHA256,component_kind:'straight',cut_length_mm:1500,
  x_mm:n*100,y_mm:0,z_mm:0,qx:0,qy:0,qz:0,qw:1});
const tray = (n:number,name:string):TrayRow => ({id:id(n),project_id:projectId,name,purpose:'Control',tray_type:'KL 60.303 F',width_mm:300,height_mm:60,length_mm:1500,
  length_source:'auto',length_calculation:null,include_grounding_cable:true,grounding_cable_type_id:null,use_trefoil_clamps:true,
  trefoil_clamp_spacing_mm:500,created_at:'2026-11-17T00:00:00.000Z',updated_at:'2026-11-17T00:00:00.000Z'});
const snapshot = (row:TrayRow) => ({id:row.id,name:row.name,purpose:row.purpose,trayType:row.tray_type,widthMm:Number(row.width_mm),heightMm:Number(row.height_mm),lengthMm:Number(row.length_mm)});
const prepare = () => prepareCadDesignNetwork(projectId,designId,who,input);
const assignedTee = () => {
  const group = {...groups[1],name:'BC027-1',tag:'BC027-1'};
  const placed:PublicationInstance = {...instance(91),part_number:'KSLT 60.303 S',component_kind:'tee',cut_length_mm:null,
    original_filename:'NDX_KLT_60-303_MED_214.step',source_sha256:'d2d9934607cc4a8aac6331e732522541fe23afce08a4c621685092188b5d936f',
    material_tray_id:null,material_tray_type:null,material_width_mm:null,material_height_mm:null};
  const row = {...tray(71,group.name),tray_type:placed.part_number,length_mm:buildCadChain([placed],[]).lengthMetres*1000};
  groups=[group];instances=new Map([[group.id,[placed]]]);trays=new Map([[row.id,row]]);
  links=new Map([[group.id,{row,sourceSha256:'e'.repeat(64),projection:cadTrayProjection(row)}]]);
  return {group,row,placed};
};

beforeEach(() => {
  vi.clearAllMocks();query.mockClear();history=[];txDepth=0;
  const aggregate = structuredClone(fixture.aggregate);
  base={id:aggregate.artifactId,snapshot_sha256:aggregate.projection.sha256,model_version_id:modelId,manifest:aggregate,
    routing_scope:{catalogRevision:aggregate.catalogRevision,routingContentSha256:aggregate.routingContentSha256,
      routingPolicyRevision:aggregate.routingPolicyRevision,routingPolicySha256:aggregate.routingPolicySha256},producer_version:'pathfinder.catalog-preparation.v1',
    resolution_revision:aggregate.resolutionRevision,geometry_revision:aggregate.geometryRevision};
  model={model_version_id:modelId,selection_revision:aggregate.selectionRevision,content_fingerprint:aggregate.contentFingerprint};
  trace=buildGeometryTrace(fixture).manifest;rules=new Map([['Control',['Control']]]);
  const a=tray(70,'BC901'), b=tray(71,'BC902');trays=new Map([[a.id,a],[b.id,b]]);
  groups=[{id:id(10),name:'BC901',tag:'BC901',purpose:'Control',status:'published',revision:5,project_tray_id:a.id,
    publication:{schemaVersion:'wfc.cad.route-publication.v1',mode:'automatic',baseArtifactId:id(999),overlay:{historical:true},trayInBaseCatalog:false,traySnapshot:snapshot(a)}},
  {id:id(11),name:'BC902',tag:'BC902',purpose:'Control',status:'draft',revision:7,project_tray_id:null,publication:null}];
  instances=new Map(groups.map((group,index) => [group.id,[instance(90+index)]]));
  links=new Map([[groups[1].id,{row:b,sourceSha256:'e'.repeat(64),projection:cadTrayProjection(b)}]]);
  mocks.inputs.mockImplementation(async (_client,_project,_design,routeId:string) => {
    const group=structuredClone(groups.find(value => value.id === routeId)!);
    const placed=structuredClone(instances.get(routeId)!);
    return {group,instances:placed,chain:buildCadChain(placed,[]),transitions:[]};
  });
  mocks.export.mockImplementation(async (_client,_project,_design,group:Group) => structuredClone(links.get(group.id) ?? null));
  mocks.policy.mockImplementation(async () => structuredClone(base.routing_scope));
  mocks.transaction.mockImplementation(async (_pool,_project,_who,work:(client:PoolClient) => Promise<unknown>) => {
    const before={groups:structuredClone(groups),history:structuredClone(history)};txDepth++;
    try { return await work({query} as unknown as PoolClient); }
    catch (error) { groups=before.groups;history=before.history;throw error; }
    finally { txDepth--; }
  });
  mocks.prepared.mockResolvedValue(base.routing_scope);mocks.dirty.mockResolvedValue(undefined);
  mocks.execute.mockImplementation(async (request:{requestId:string;snapshotId:string;snapshotSha256:string;cadOverlay:{payloadBase64:string}}) => {
    expect(txDepth).toBe(0);
    const overlay=JSON.parse(Buffer.from(request.cadOverlay.payloadBase64,'base64').toString('utf8'));
    return {requestId:request.requestId,status:'prepared',model:{projectId,modelVersionId:modelId,contentSha256:fixture.aggregate.contentFingerprint},
      prepared:{key:'f'.repeat(64),segmentCount:fixture.aggregate.counts.physicalLeaves+overlay.segments.length}};
  });
});

describe('saved CAD network preparation with verified composite and CAS publication', () => {
  it('prepares an assigned tee as three arms while retaining one tray and stable duplicate proof', async () => {
    const tee=assignedTee();
    expect(await prepare()).toMatchObject({publishedCount:1,revalidatedCount:0,routeCount:1,duplicate:false});
    const overlay=JSON.parse(Buffer.from(mocks.execute.mock.calls[0][0].cadOverlay.payloadBase64,'base64').toString('utf8'));
    expect(overlay.segments).toHaveLength(3);
    expect(new Set(overlay.segments.map((segment:{id:string})=>segment.id)).size).toBe(3);
    expect(overlay.segments.some((segment:{id:string})=>segment.id===`cad:${tee.group.id}`)).toBe(true);
    expect(overlay.segments.every((segment:{name:string;ports:unknown[]})=>segment.name==='/BC027-1'&&segment.ports.length===1)).toBe(true);
    expect(groups[0].project_tray_id).toBe(tee.row.id);
    expect(trays.size).toBe(1);expect(history).toHaveLength(1);
    expect(groups[0].publication).toMatchObject({traySnapshot:{id:tee.row.id,lengthMm:tee.row.length_mm},
      networkPreparationProof:{segmentCount:fixture.aggregate.counts.physicalLeaves+3}});
    const before=structuredClone(groups);
    expect(await prepare()).toMatchObject({publishedCount:0,revalidatedCount:0,routeCount:1,duplicate:true});
    expect(groups).toEqual(before);expect(history).toHaveLength(1);expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it('rejects a tee proof that counts routes instead of emitted arm segments', async () => {
    assignedTee();const execute=mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async request=>{
      const proof=await execute(request);proof.prepared.segmentCount=fixture.aggregate.counts.physicalLeaves+1;return proof;
    });
    await expect(prepare()).rejects.toMatchObject({code:'CAD_ROUTE_ENGINE_PROOF_REQUIRED'});
    expect(groups[0].status).toBe('draft');expect(history).toEqual([]);expect(mocks.dirty).not.toHaveBeenCalled();
  });
  it('refuses a tee source revision change between three-arm verification and publication', async () => {
    const tee=assignedTee(),execute=mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async request=>{
      const proof=await execute(request);instances.get(tee.group.id)![0].revision++;return proof;
    });
    await expect(prepare()).rejects.toMatchObject({code:'CAD_ROUTE_CHANGED_DURING_PROOF'});
    expect(groups[0].status).toBe('draft');expect(groups[0].revision).toBe(7);
    expect(history).toEqual([]);expect(mocks.dirty).not.toHaveBeenCalled();
  });
  it('verifies the current base plus published and exported draft routes before publishing exact existing tray ids', async () => {
    const old=structuredClone(groups[0].publication);
    const result=await prepare();
    expect(result).toEqual({artifactId:input.expectedArtifactId,snapshotSha256:input.expectedSnapshotSha256,publishedCount:1,revalidatedCount:1,routeCount:2,duplicate:false});
    const request=mocks.execute.mock.calls[0][0];
    expect(request).toMatchObject({operation:'prepare',snapshotId:input.expectedArtifactId,snapshotSha256:input.expectedSnapshotSha256,modelVersionId:modelId});
    const overlay=JSON.parse(Buffer.from(request.cadOverlay.payloadBase64,'base64').toString('utf8'));
    expect(overlay.segments.map((segment:{name:string}) => segment.name)).toEqual(['/BC901','/BC902']);
    expect(groups.map(group => group.project_tray_id)).toEqual([id(70),id(71)]);
    expect(groups.map(group => group.revision)).toEqual([6,8]);
    expect(groups.every(group => (group.publication as {baseArtifactId:string;trayInBaseCatalog:boolean}).baseArtifactId === input.expectedArtifactId
      && (group.publication as {trayInBaseCatalog:boolean}).trayInBaseCatalog)).toBe(true);
    expect(history).toHaveLength(2);expect(JSON.parse(String(history[0][6]))).toEqual(old);expect(history[1][6]).toBeNull();
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO trays'))).toBe(false);
    expect(mocks.prepared).toHaveBeenCalledWith(expect.anything(),projectId,input.expectedArtifactId);
    expect(mocks.dirty).toHaveBeenCalledOnce();
  });
  it('does not include arbitrary draft groups without an exact Trays list link', async () => {
    groups.push({...groups[1],id:id(12),tag:'UNSAVED',name:'UNSAVED'});
    expect((await prepare()).routeCount).toBe(2);expect(mocks.inputs.mock.calls.map(call => call[3])).not.toContain(id(12));
    expect(groups[2].status).toBe('draft');
  });
  it('retries already verified current sources without another worker or revision/history change', async () => {
    await prepare();const before=structuredClone(groups);const result=await prepare();
    expect(result).toMatchObject({duplicate:true,publishedCount:0,revalidatedCount:0,routeCount:2});
    expect(groups).toEqual(before);expect(history).toHaveLength(2);expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it('passes the existing immutable routing-scope and CAD overlay validators after refreshing both proofs', async () => {
    const projection=projectRoutingCatalogRows([...trays.values()].map(({id,name,purpose}) => ({id,name,purpose})));
    const hash=createHash('sha256').update(canonicalPurposeJson(catalogRoutingHashInput(projectId,projection.rows,projection.diagnostics))).digest('hex');
    base.routing_scope.routingContentSha256=hash;base.manifest.routingContentSha256=hash;
    const actual=await vi.importActual<typeof import('../pathfinder/routingScope.js')>('../pathfinder/routingScope.js');
    mocks.prepared.mockImplementation(actual.requirePreparedRoutingScope);
    expect((await prepare()).routeCount).toBe(2);
    const value=await mocks.prepared({query},projectId,base.id);
    expect(JSON.parse(Buffer.from(value.cadOverlay.payloadBase64,'base64').toString('utf8')).segments.map((segment:{name:string}) => segment.name)).toEqual(['/BC901','/BC902']);
  });
  it.each(['count','request','model','content','status'])('does not write any publication when worker %s proof is wrong', async kind => {
    const execute=mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async request => {
      const proof=await execute(request);
      if(kind==='count')proof.prepared.segmentCount--;
      if(kind==='request')proof.requestId=id(888);
      if(kind==='model')proof.model.modelVersionId=id(888);
      if(kind==='content')proof.model.contentSha256='0'.repeat(64);
      if(kind==='status')proof.status='failed';
      return proof;
    });
    const before=structuredClone(groups);await expect(prepare()).rejects.toMatchObject({code:'CAD_ROUTE_ENGINE_PROOF_REQUIRED'});
    expect(groups).toEqual(before);expect(history).toEqual([]);expect(mocks.dirty).not.toHaveBeenCalled();
  });
  it.each(['revision','source','transform','model','base','export'])('refuses a concurrent %s change after native verification', async kind => {
    const execute=mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async request => {
      const proof=await execute(request);
      if(kind==='revision')groups[1].revision++;
      if(kind==='source')instances.get(groups[1].id)![0].revision++;
      if(kind==='transform')instances.get(groups[1].id)![0].x_mm++;
      if(kind==='model')model=null;
      if(kind==='base')base.id=id(888);
      if(kind==='export')links.get(groups[1].id)!.sourceSha256='a'.repeat(64);
      return proof;
    });
    await expect(prepare()).rejects.toMatchObject({status:409});
    expect(groups[0].revision).toBe(5);expect(groups[1].status).toBe('draft');expect(history).toEqual([]);expect(mocks.dirty).not.toHaveBeenCalled();
  });
  it('rolls back both proofs and history if final routing scope validation fails', async () => {
    mocks.prepared.mockRejectedValue(Error('Final scope refused'));const before=structuredClone(groups);
    await expect(prepare()).rejects.toThrow('Final scope refused');expect(groups).toEqual(before);expect(history).toEqual([]);
  });
  it.each(['resolution','geometry','policy','trace'])('refuses stale %s preparation before invoking the worker', async kind => {
    if(kind==='resolution')base.resolution_revision='99';
    if(kind==='geometry')base.geometry_revision='99';
    if(kind==='policy')mocks.policy.mockResolvedValue({...base.routing_scope,routingPolicyRevision:'99'});
    if(kind==='trace')trace.counts.objects++;
    await expect(prepare()).rejects.toMatchObject({status:409});expect(mocks.execute).not.toHaveBeenCalled();expect(history).toEqual([]);
  });
  it('keeps excluded saved draft geometry assigned and outside the calculation overlay', async () => {
    groups[1].purpose='Excluded';rules.set('Excluded',[]);
    const result=await prepare();expect(result.routeCount).toBe(1);expect(result.publishedCount).toBe(0);
    expect(groups[1].status).toBe('draft');
  });
  it('refuses excluded published geometry instead of silently retaining its stale overlay', async () => {
    rules.set('Control',[]);await expect(prepare()).rejects.toMatchObject({code:'CAD_ROUTE_PURPOSE_EXCLUDED'});expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('prepares actual PostgreSQL-shaped rows without hashing their Date metadata', async () => {
    for (const group of groups) Object.assign(group, { created_at:new Date('2026-11-17T00:00:00Z'),updated_at:new Date('2026-11-17T00:00:00Z') });
    for (const rows of instances.values()) for (const row of rows) Object.assign(row, {created_at:new Date('2026-11-17T00:00:00Z'),updated_at:new Date('2026-11-17T00:00:00Z')});
    await expect(prepare()).resolves.toMatchObject({publishedCount:1,revalidatedCount:1});
    expect(history).toHaveLength(2);
  });
  it('retains a previously withdrawn proof in history when a linked saved route is added again', async () => {
    groups[1].publication={withdrawnAt:'2026-11-17T00:00:00Z',baseArtifactId:id(555)};
    await prepare();expect(JSON.parse(String(history[1][6]))).toEqual({withdrawnAt:'2026-11-17T00:00:00Z',baseArtifactId:id(555)});
  });
});

let server:Server, endpoint:string;
beforeAll(async () => {
  const app=express();app.use(express.json());app.use((req,_res,next) => {req.userId=who.userId;req.loginId=who.loginId;req.loginExpiresAt=who.loginExpiresAt;next();});
  app.use('/projects/:projectId/cad-design',cadNetworkPreparationRouter);
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve => server.once('listening',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('Missing address');
  endpoint=`http://127.0.0.1:${address.port}/projects/${projectId}/cad-design/designs/${designId}/prepare-network`;
});
afterAll(async () => {server.closeAllConnections();await new Promise<void>((resolve,reject) => server.close(error => error?reject(error):resolve()));});
describe('CAD network preparation HTTP boundary', () => {
  it('requires admin and an exact typed current base request', async () => {
    const denied=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    expect(denied.status).toBe(403);
    const invalid=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-test-admin':'yes'},body:JSON.stringify({...input,mode:'unsafe'})});
    expect(invalid.status).toBe(400);expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('returns verified artifact and publication counts without cacheable responses', async () => {
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-test-admin':'yes'},body:JSON.stringify(input)});
    expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({artifactId:input.expectedArtifactId,publishedCount:1,revalidatedCount:1,routeCount:2});
  });
});
