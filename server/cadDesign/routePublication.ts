import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware.js';
import { principalTransaction, requestPrincipal } from '../pathfinder/auth.js';
import { latestArtifact } from '../pathfinder/repository.js';
import { requirePreparedRoutingScope } from '../pathfinder/routingScope.js';
import { readRoutingPolicyScope } from '../pathfinder/purposePolicy.js';
import { cadOverlayPayloadSchema, type CadOverlaySegment } from '../../shared/pathfinderCadOverlay.js';
import { geometryObjectRevisionSchema } from '../../shared/pathfinderGeometryTrace.js';
import { canonicalPurposeJson, normalizeCatalogKey } from '../../shared/pathfinderPurposePolicy.js';
import { getInstanceCadPorts, supportsStraightCut } from '../../shared/cadLengths.js';
import { composeTransform, rotateVector, connectorAlignmentIsValid, type RigidTransform } from '../../shared/cadTransforms.js';
import { MATE_OPPOSING_FACE } from '../../shared/cadPocPorts.js';
import { recordTrayChanges } from '../services/trayChangeLogService.js';
import type { TrayRow } from '../models/tray.js';
import { encodeCadOverlay } from '../pathfinder/cadOverlay.js';
import { PathFinderError } from '../pathfinder/errors.js';

export const cadRoutePublicationRouter = Router({ mergeParams:true });
const uuid = z.string().uuid();
const revision = z.number().int().positive();
const attachmentInput = z.object({instanceId:uuid,portName:z.enum(['start','end']),targetObjectRevisionId:uuid,targetPortIndex:z.number().int().min(0).max(1)}).strict();
const publishInput = z.object({expectedRevision:revision,attachments:z.array(attachmentInput).min(1).max(2)}).strict();
const withdrawInput = z.object({expectedRevision:revision}).strict();
type Point = [number,number,number];
export type PublicationInstance = {id:string;catalog_item_id:string;material_asset_id:string;revision:number;
  part_number:string;
  material_tray_id?:string|null;material_tray_type?:string|null;material_width_mm?:number|string|null;material_height_mm?:number|string|null;
  original_filename:string;source_sha256:string;component_kind:string;cut_length_mm:number|null;
  x_mm:number;y_mm:number;z_mm:number;qx:number;qy:number;qz:number;qw:number};
export type PublicationConnection = {source_instance_id:string;target_instance_id:string;source_name:string;target_name:string};
export type PublicationTransition = PublicationConnection & {id?:string;kind:'routing-transition'};
export const MAX_CAD_TRANSITION_GAP_MM=300;
type Group = {id:string;name:string;tag:string;purpose:string;status:string;revision:number;project_tray_id:string|null;publication:unknown};
export class PublicationError extends Error {
  constructor(readonly code:string, message:string, readonly status=409, readonly diagnostics?:unknown) {super(message);}
}
const refuse = (code:string,message:string,status=409,diagnostics?:unknown):never => {throw new PublicationError(code,message,status,diagnostics);};
const safe = (work:(req:Request,res:Response)=>Promise<void>) => (req:Request,res:Response,next:NextFunction):void => {
  void work(req,res).catch((error:unknown) => {
    if (error instanceof PublicationError) {res.status(error.status).json({code:error.code,message:error.message,...(error.diagnostics?{diagnostics:error.diagnostics}:{})});return;}
    if (error instanceof PathFinderError) {res.status(error.status).json({code:error.code,message:error.message});return;}
    const code=(error as {code?:string})?.code;
    if (code==='40P01'||code==='40001') {res.status(409).json({code:'CAD_DESIGN_CONFLICT',message:'The design changed during publication. Refresh and retry.'});return;}
    next(error);
  });
};
const world = (row:PublicationInstance):RigidTransform => ({position:{x:row.x_mm,y:row.y_mm,z:row.z_mm},rotation:{x:row.qx,y:row.qy,z:row.qz,w:row.qw}});
const metres = (p:{x:number;y:number;z:number}):Point => [p.x/1000,p.y/1000,p.z/1000];
const distance = (a:Point,b:Point) => Math.hypot(...a.map((v,i)=>v-b[i]));
export function validateCadAttachment(source:CadOverlaySegment['ports'][number],target:CadOverlaySegment['ports'][number]):void {
  const dot=(a:Point,b:Point)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
  const gap=distance(source.pointMetres,target.pointMetres),outwardDot=dot(source.outward,target.outward);
  const aligned=outwardDot<=-.9999&&Math.abs(dot(source.u,target.u))>=.9999&&Math.abs(dot(source.v,target.v))>=.9999;
  const profile=Math.abs(source.widthMetres-target.widthMetres)<=.001&&Math.abs(source.heightMetres-target.heightMetres)<=.001;
  if(gap>.001||!aligned||!profile)return refuse('CAD_ROUTE_ATTACHMENT_NOT_ALIGNED',
    'Align the route end with a matching network profile and port orientation before publishing.',409,
    {gapMetres:gap,outwardDot,widthMetres:target.widthMetres,heightMetres:target.heightMetres,profileMatches:profile});
}
function ports(row:PublicationInstance) {
  const available=getInstanceCadPorts(row.original_filename,row.source_sha256,row.cut_length_mm);
  if (available.length!==2 || !((row.component_kind==='straight'&&supportsStraightCut(row.original_filename,row.source_sha256)) ||
      (row.component_kind==='bend'&&row.cut_length_mm==null&&row.source_sha256==='7a5cf4947a9ea5fa213ceef84ba952fe2a9a63dee752f0c23a598320802c0014')))
    refuse('CAD_ROUTE_UNSUPPORTED_GEOMETRY','Publish only the verified straight and bend STEP samples. Other components need verified routing centerlines.');
  return available.map(port => ({...port,world:composeTransform(world(row),port.local)}));
}
export function routePort(row:PublicationInstance,name:string) {
  const selected=ports(row).find(port=>port.id===name);
  if (!selected) return refuse('CAD_ROUTE_INVALID_PORT','The saved connection references an unsupported port.');
  const direction=(v:{x:number;y:number;z:number})=>{const p=rotateVector(v,selected.world.rotation);return [p.x,p.y,p.z] as Point;};
  return {pointMetres:metres(selected.world.position),outward:direction({x:0,y:0,z:1}),u:direction({x:1,y:0,z:0}),v:direction({x:0,y:1,z:0}),widthMetres:0.3,heightMetres:0.06};
}
/** Approved source-specific centerlines; never replace a bend by its shorter chord. */
function centerline(row:PublicationInstance):Point[] {
  ports(row);
  // The hash-pinned STEP's 500/800 mm coaxial surfaces establish R650,
  // center (-500,-145), with 145 mm straight legs at both ends.
  const local = row.component_kind==='straight' ? [{x:0,y:30,z:0},{x:0,y:30,z:row.cut_length_mm??6000}] :
    [{x:150,y:30,z:0},...Array.from({length:257},(_,index)=>{const angle=index*Math.PI/512;return {x:-500+650*Math.cos(angle),y:30,z:-145-650*Math.sin(angle)};}),{x:-645,y:30,z:-795}];
  return local.map(position=>metres(composeTransform(world(row),{position,rotation:{x:0,y:0,z:0,w:1}}).position));
}
export function resolveCadRouteMaterial(instances:PublicationInstance[]) {
  const material=instances.find(row=>row.component_kind==='straight'&&row.material_tray_id&&row.material_tray_type);
  if(!material)return refuse('CAD_ROUTE_MATERIAL_REQUIRED','Publishing requires a straight component linked to the Materials tray catalog. Bend-only groups can remain saved drafts.');
  if(Number(material.material_width_mm)!==300||Number(material.material_height_mm)!==60||
    material.material_tray_type!.trim().toUpperCase()!==material.part_number.trim().toUpperCase())
    return refuse('CAD_ROUTE_MATERIAL_PROFILE_CHANGED','The straight Materials identity or dimensions no longer match the pinned 300 × 60 mm source. Select its current catalog reference.');
  return {trayType:material.part_number,widthMm:300,heightMm:60};
}
export function buildCadChain(instances:PublicationInstance[],connections:PublicationConnection[],transitions:PublicationTransition[]=[]) {
  if (!instances.length||instances.length>32) return refuse('CAD_ROUTE_PART_LIMIT','A published route must contain 1–32 verified components.');
  const rows=new Map(instances.map(row=>[row.id,row]));
  const used=new Set<string>();const adjacency=new Map<string,Array<{other:string;name:string;otherName:string}>>();
  for (const row of instances) {ports(row);adjacency.set(row.id,[]);}
  const edges=[...connections.map(connection=>({...connection,kind:'physical' as const})),...transitions];
  for (const connection of edges) {
    const source=rows.get(connection.source_instance_id),target=rows.get(connection.target_instance_id);
    if (!source||!target) return refuse('CAD_ROUTE_CROSS_GROUP_CONNECTION','All connected components must belong to this route group.');
    const a=ports(source).find(p=>p.id===connection.source_name),b=ports(target).find(p=>p.id===connection.target_name);
    if (!a||!b)
      return refuse('CAD_ROUTE_INVALID_PORT','The saved route references an unsupported endpoint.');
    if(connection.kind==='routing-transition'){
      const gapMm=distance(metres(a.world.position),metres(b.world.position))*1000;
      if(gapMm>MAX_CAD_TRANSITION_GAP_MM+1e-6)
        return refuse('CAD_ROUTE_TRANSITION_TOO_LONG','A logical routing transition exceeds the verified profile installation zone.',409,{gapMm,maximumGapMm:MAX_CAD_TRANSITION_GAP_MM});
    } else if (!connectorAlignmentIsValid(world(source),a.local,world(target),b.local,MATE_OPPOSING_FACE))
      return refuse('CAD_ROUTE_CONNECTION_NOT_ALIGNED','Saved component ports are no longer aligned. Reconnect them before publishing.');
    for (const key of [`${source.id}:${a.id}`,`${target.id}:${b.id}`]) {if(used.has(key))return refuse('CAD_ROUTE_NOT_CHAIN','A route port cannot have multiple connections.');used.add(key);}
    adjacency.get(source.id)!.push({other:target.id,name:a.id,otherName:b.id});
    adjacency.get(target.id)!.push({other:source.id,name:b.id,otherName:a.id});
  }
  const endpoints=instances.flatMap(row=>ports(row).filter(p=>!used.has(`${row.id}:${p.id}`)).map(p=>({instanceId:row.id,portName:p.id,pointMetres:metres(p.world.position)})));
  if (edges.length!==instances.length-1||endpoints.length!==2||[...adjacency.values()].some(edges=>edges.length>2))
    return refuse('CAD_ROUTE_NOT_CHAIN','The group must be one connected open chain. Snap and connect every component first.');
  const points:Point[]=[];const visited=new Set<string>();let cursor=endpoints[0].instanceId,entry=endpoints[0].portName;
  while (!visited.has(cursor)) {
    visited.add(cursor);const line=centerline(rows.get(cursor)!);if(entry==='end')line.reverse();
    // Keep a real admitted connector gap in the measured route; skip only the
    // numerically identical join point, never a distinct component endpoint.
    points.push(...(points.length&&distance(points[points.length-1],line[0])<1e-9?line.slice(1):line));
    const next=adjacency.get(cursor)!.find(edge=>edge.name!==entry);
    if (!next) break;cursor=next.other;entry=next.otherName as 'start'|'end';
  }
  if (visited.size!==instances.length) return refuse('CAD_ROUTE_NOT_CHAIN','The route contains disconnected components or a loop.');
  const lengthMetres=points.slice(1).reduce((sum,p,index)=>sum+distance(p,points[index]),0);
  return {endpoints,points,lengthMetres,instances:rows};
}

export async function groupRawInputs(client:PoolClient,projectId:string,designId:string,routeId:string) {
  const group=(await client.query<Group>('SELECT * FROM cad_route_groups WHERE project_id=$1 AND design_id=$2 AND id=$3 FOR UPDATE',[projectId,designId,routeId])).rows[0];
  if (!group) return refuse('CAD_ROUTE_NOT_FOUND','Route group not found.',404);
  const instances=(await client.query<PublicationInstance>(`SELECT i.*,c.original_filename,c.source_sha256,c.part_number,
    c.material_component_cad_asset_id AS material_asset_id,p.component_kind,p.material_tray_id,
    mt.tray_type AS material_tray_type,mt.width_mm AS material_width_mm,mt.height_mm AS material_height_mm FROM cad_route_group_members m
    JOIN cad_design_instances i ON i.project_id=m.project_id AND i.design_id=m.design_id AND i.id=m.instance_id
    JOIN cad_catalog_items c ON c.project_id=i.project_id AND c.id=i.catalog_item_id
    JOIN material_component_cad_assets a ON a.id=c.material_component_cad_asset_id
    JOIN material_components p ON p.id=a.component_id
    LEFT JOIN material_trays mt ON mt.id=p.material_tray_id
    WHERE m.project_id=$1 AND m.design_id=$2 AND m.route_group_id=$3 ORDER BY i.id FOR SHARE OF i`,[projectId,designId,routeId])).rows;
  // The canonical joins must not turn a mixed legacy group into a smaller,
  // apparently valid route. Every scoped member needs the same source proof.
  const membership=(await client.query<{member_count:number}>(`SELECT COUNT(*)::int AS member_count FROM cad_route_group_members
    WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3`,[projectId,designId,routeId])).rows[0];
  if(!membership||membership.member_count!==instances.length)
    return refuse('CAD_ROUTE_UNSUPPORTED_GEOMETRY','Every route member must reference a verified Materials CAD revision. Legacy or unbacked members cannot be omitted.');
  const ids=instances.map(row=>row.id);
  const connections=(await client.query<PublicationConnection>(`SELECT cc.source_instance_id,cc.target_instance_id,s.name AS source_name,t.name AS target_name
    FROM cad_design_connections cc JOIN cad_catalog_ports s ON s.id=cc.source_port_id JOIN cad_catalog_ports t ON t.id=cc.target_port_id
    WHERE cc.project_id=$1 AND cc.design_id=$2 AND (cc.source_instance_id=ANY($3::uuid[]) OR cc.target_instance_id=ANY($3::uuid[]))`,[projectId,designId,ids])).rows;
  const transitions=(await client.query<PublicationTransition>(`SELECT id,kind,source_instance_id,target_instance_id,source_port_name AS source_name,target_port_name AS target_name
    FROM cad_route_transition_links WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3 ORDER BY id FOR SHARE`,[projectId,designId,routeId])).rows;
  return {group,instances,connections,transitions};
}
export async function groupInputs(client:PoolClient,projectId:string,designId:string,routeId:string) {
  const {group,instances,connections,transitions}=await groupRawInputs(client,projectId,designId,routeId);
  return {group,chain:buildCadChain(instances,connections,transitions),instances,transitions};
}
export async function publicationTransaction<T>(req:Request,work:(client:PoolClient)=>Promise<T>) {
  const {projectId,designId,routeId}=req.params;
  if (![projectId,designId,routeId].every(id=>uuid.safeParse(id).success))return refuse('INVALID_CAD_ROUTE_ID','Invalid route identifier.',400);
  return principalTransaction(pool,projectId,requestPrincipal(req),async client=>{
    if (!(await client.query(`SELECT d.id FROM cad_designs d JOIN project_model_selections s ON s.project_id=d.project_id AND s.active_model_version_id=d.model_version_id
      JOIN model_versions v ON v.project_id=d.project_id AND v.id=d.model_version_id WHERE d.project_id=$1 AND d.id=$2 AND d.status='proposed'
      AND v.state='ready' AND v.health='healthy' FOR UPDATE OF d FOR SHARE OF s,v`,[projectId,designId])).rows[0])return refuse('INACTIVE_DESIGN','Select an active healthy proposed design.');
    return work(client);
  });
}
export async function networkOptions(client:PoolClient,projectId:string,modelId:string) {
  const artifact=await latestArtifact(client,projectId,modelId);
  if(!artifact)return refuse('CAD_ROUTE_NETWORK_REQUIRED','Prepare the existing Path Finder network first.');
  const routing=await requirePreparedRoutingScope(client,projectId,artifact.id);
  const records=(await client.query<{record:unknown}>(`SELECT o.record FROM pf_geometry_object_revisions o JOIN pf_geometry_trace_sets t ON t.project_id=o.project_id AND t.id=o.trace_id
    JOIN pf_project_preparations p ON p.project_id=t.project_id AND p.current_aggregate_id=t.aggregate_id
    WHERE o.project_id=$1 AND p.current_artifact_id=$2 AND t.id=(SELECT id FROM pf_geometry_trace_sets
      WHERE project_id=t.project_id AND aggregate_id=t.aggregate_id ORDER BY created_at DESC,id DESC LIMIT 1)
    ORDER BY o.object_id LIMIT 10001`,[projectId,artifact.id])).rows;
  if (!records.length||records.length>10000)return refuse('CAD_ROUTE_NETWORK_TRACE_REQUIRED','Prepare the current network geometry trace before selecting an attachment.');
  const options=records.flatMap(row=>{
    const record=geometryObjectRevisionSchema.parse(row.record),fitted=record.geometry.fitted;
    return fitted&&/^\/[A-Z0-9][A-Z0-9_.-]*$/.test(fitted.routeCode)&&fitted.routeCode!=='/SECONDARY'
      ? fitted.ports.map((port,portIndex)=>({objectRevisionId:record.id,objectId:record.identity.objectId,portIndex,pointMetres:port.pointMetres,routeCode:fitted.routeCode,port})):[];
  });
  if(!options.length)return refuse('CAD_ROUTE_NETWORK_PORTS_REQUIRED','The current network has no verified physical ports available for attachment.');
  return {artifact,options,routing,segmentCount:records.filter(row=>geometryObjectRevisionSchema.parse(row.record).geometry.fitted!==null).length};
}
const prefix='/designs/:designId/routes/:routeId';
cadRoutePublicationRouter.get(`${prefix}/attachment-options`,requireAdmin,safe(async(req,res)=>{
  const result=await publicationTransaction(req,async client=>{
    const {chain}=await groupInputs(client,req.params.projectId,req.params.designId,req.params.routeId);
    const model=(await client.query<{model_version_id:string}>('SELECT model_version_id FROM cad_designs WHERE project_id=$1 AND id=$2',[req.params.projectId,req.params.designId])).rows[0];
    const {artifact,options}=await networkOptions(client,req.params.projectId,model.model_version_id);
    return {options:options.map(({port:_port,...option})=>option),endpoints:chain.endpoints,baseArtifactId:artifact.id};
  });
  res.setHeader('Cache-Control','private, no-store');res.json(result);
}));
cadRoutePublicationRouter.post(`${prefix}/publish`,requireAdmin,safe(async(req,res)=>{
  const parsed=publishInput.safeParse(req.body);if(!parsed.success)return refuse('INVALID_CAD_ROUTE_PUBLICATION','Select at least one endpoint and an existing network port.',400);
  const freeze=async(client:PoolClient)=>{
    const {projectId,designId,routeId}=req.params;
    const {group,chain,instances,transitions}=await groupInputs(client,projectId,designId,routeId);
    if(group.revision!==parsed.data.expectedRevision)return refuse('STALE_CAD_ROUTE','The route changed. Refresh and retry.');
    if(group.status!=='draft')return refuse('CAD_ROUTE_PUBLISHED','Withdraw the route before publishing another revision.');
    const material=resolveCadRouteMaterial(instances);
    const model=(await client.query<{model_version_id:string}>('SELECT model_version_id FROM cad_designs WHERE project_id=$1 AND id=$2',[projectId,designId])).rows[0];
    const {artifact,options,routing,segmentCount}=await networkOptions(client,projectId,model.model_version_id);
    const rules=(await client.query<{allowed_categories:string[]}>(`SELECT r.allowed_categories FROM pf_routing_purpose_rules r JOIN pf_catalog_purpose_incarnations i
      ON i.project_id=r.project_id AND i.purpose_key=r.purpose_key AND i.incarnation_id=r.purpose_incarnation_id
      WHERE r.project_id=$1 AND r.purpose_key=$2 AND i.active AND i.row_count>0`,[projectId,normalizeCatalogKey(group.purpose)])).rows[0];
    if(!rules?.allowed_categories.length)return refuse('CAD_ROUTE_PURPOSE_REQUIRED','Choose an existing configured routing purpose before publishing.');
    const unique=new Set<string>();const selectedPorts=[];
    for(const attachment of parsed.data.attachments){
      const endpoint=chain.endpoints.find(end=>end.instanceId===attachment.instanceId&&end.portName===attachment.portName);
      const target=options.find(option=>option.objectRevisionId===attachment.targetObjectRevisionId&&option.portIndex===attachment.targetPortIndex);
      if(!endpoint||!target)return refuse('CAD_ROUTE_ATTACHMENT_STALE','Refresh attachment choices from the current network.');
      const key=`${endpoint.instanceId}:${endpoint.portName}`;if(unique.has(key))return refuse('CAD_ROUTE_DUPLICATE_ATTACHMENT','Each route end can be attached once.');unique.add(key);
      const source=routePort(chain.instances.get(endpoint.instanceId)!,endpoint.portName);
      validateCadAttachment(source,target.port);
      selectedPorts.push(source);
    }
    if((await client.query("SELECT id FROM trays WHERE project_id=$1 AND upper(btrim(btrim(btrim(name),'/')))=$2",[projectId,group.tag])).rows.length)
      return refuse('CAD_ROUTE_TAG_CONFLICT','A project tray already uses this route tag.');
    // As in preparationPlans.ts, current policy values are cable purposes,
    // not engine classes. Per-calculation allowedRouteCodes enforces purpose.
    const mask=7;
    const segment:CadOverlaySegment={id:`cad:${group.id}`,name:`/${group.tag}`,allowedCategoryMask:mask,pointsMetres:chain.points,ports:selectedPorts};
    const overlay=cadOverlayPayloadSchema.parse({schemaVersion:'wfc.pf.cad-overlay-payload.v1',projectId,modelVersionId:model.model_version_id,baseSnapshotSha256:artifact.snapshot_sha256,segments:[segment]});
    const previous=routing.cadOverlay?cadOverlayPayloadSchema.parse(JSON.parse(Buffer.from(routing.cadOverlay.payloadBase64,'base64').toString('utf8'))).segments:[];
    const verifiedOverlay=encodeCadOverlay({...overlay,segments:[...previous,...overlay.segments]});
    const fingerprint=createHash('sha256').update(canonicalPurposeJson({group:{id:group.id,revision:group.revision,tag:group.tag,purpose:group.purpose},material,routing,transitions,
      artifactId:artifact.id,verifiedOverlay,sources:instances.map(row=>({id:row.id,revision:row.revision,assetId:row.material_asset_id,sha256:row.source_sha256,lengthMm:row.cut_length_mm}))})).digest('hex');
    return {group,chain,instances,transitions,material,artifact,overlay,verifiedOverlay,modelId:model.model_version_id,expectedSegments:segmentCount+previous.length+1,fingerprint};
  };
  // Release all database locks while the private worker validates geometry.
  // A running calculation may itself need the project mutex to finish.
  const frozen=await publicationTransaction(req,freeze);
  const {getPathFinderRuntime}=await import('../pathfinder/runtime.js');
  const proof=await getPathFinderRuntime().worker.executePreparation({schemaVersion:'pathfinder.model.runner.v1',requestId:randomUUID(),operation:'prepare',
    projectId:req.params.projectId,modelVersionId:frozen.modelId,snapshotId:frozen.artifact.id,snapshotSha256:frozen.artifact.snapshot_sha256,
    cadOverlay:frozen.verifiedOverlay,timeoutMilliseconds:120000},AbortSignal.timeout(125000));
  const prepared=proof.prepared as {segmentCount?:number}|undefined;
  if(proof.status!=='prepared'||prepared?.segmentCount!==frozen.expectedSegments)
    return refuse('CAD_ROUTE_ENGINE_PROOF_REQUIRED','The current routing engine did not verify the proposed composite network. No route was published.');
  const result=await publicationTransaction(req,async client=>{
    const current=await freeze(client);
    if(current.fingerprint!==frozen.fingerprint)return refuse('CAD_ROUTE_CHANGED_DURING_PROOF','The network or route changed during verification. Refresh and publish again.');
    const {projectId,designId,routeId}=req.params;
    const {group,chain,instances,transitions,material,artifact,overlay}=current;
    const trayId=randomUUID();
    const traySnapshot={id:trayId,name:group.tag,purpose:normalizeCatalogKey(group.purpose),...material,lengthMm:chain.lengthMetres*1000};
    const inserted=await client.query<TrayRow>('INSERT INTO trays(id,project_id,name,purpose,tray_type,width_mm,height_mm,length_mm) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[trayId,projectId,traySnapshot.name,traySnapshot.purpose,material.trayType,material.widthMm,material.heightMm,traySnapshot.lengthMm]);
    await recordTrayChanges(client,req.userId!,null,inserted.rows[0]);
    const publication={schemaVersion:'wfc.cad.route-publication.v1',baseArtifactId:artifact.id,overlay,traySnapshot,attachments:parsed.data.attachments,
      routingTransitions:transitions.map(link=>({id:link.id,kind:link.kind,sourceInstanceId:link.source_instance_id,sourcePortName:link.source_name,
        targetInstanceId:link.target_instance_id,targetPortName:link.target_name,
        pointsMetres:[routePort(chain.instances.get(link.source_instance_id)!,link.source_name).pointMetres,routePort(chain.instances.get(link.target_instance_id)!,link.target_name).pointMetres]})),
      sources:instances.map(row=>({instanceId:row.id,instanceRevision:row.revision,catalogItemId:row.catalog_item_id,assetId:row.material_asset_id,sha256:row.source_sha256,lengthMm:row.cut_length_mm})),publishedAt:new Date().toISOString()};
    await client.query(`UPDATE cad_route_groups SET status='published',project_tray_id=$4,publication=$5::jsonb,revision=revision+1,updated_at=now()
      WHERE project_id=$1 AND design_id=$2 AND id=$3`,[projectId,designId,routeId,trayId,JSON.stringify(publication)]);
    // Validate the exact composite scope before committing a claim of usability.
    await requirePreparedRoutingScope(client,projectId,artifact.id);
    return {id:routeId,status:'published',revision:group.revision+1,projectTrayId:trayId,lengthMetres:chain.lengthMetres};
  });
  res.json(result);
}));
cadRoutePublicationRouter.post(`${prefix}/withdraw`,requireAdmin,safe(async(req,res)=>{
  const parsed=withdrawInput.safeParse(req.body);if(!parsed.success)return refuse('INVALID_CAD_ROUTE_PUBLICATION','A current route revision is required.',400);
  const result=await publicationTransaction(req,async client=>{
    const {projectId,designId,routeId}=req.params;
    const group=(await client.query<Group>('SELECT * FROM cad_route_groups WHERE project_id=$1 AND design_id=$2 AND id=$3 FOR UPDATE',[projectId,designId,routeId])).rows[0];
    if(!group)return refuse('CAD_ROUTE_NOT_FOUND','Route group not found.',404);
    if(group.revision!==parsed.data.expectedRevision)return refuse('STALE_CAD_ROUTE','The route changed. Refresh and retry.');
    if(group.status!=='published'||!group.project_tray_id)return refuse('CAD_ROUTE_NOT_PUBLISHED','This route is not published.');
    if ((await client.query(`SELECT c.id FROM cables c WHERE c.project_id=$1 AND EXISTS(
      SELECT 1 FROM regexp_split_to_table(upper(COALESCE(c.routing,'')),'/') AS part(value) WHERE btrim(part.value)=$2) LIMIT 1`,[projectId,group.tag])).rows.length)
      return refuse('CAD_ROUTE_IN_USE','Cables currently use this route. Reassign or recalculate their routing before withdrawing it.');
    await client.query(`UPDATE cad_route_groups SET status='draft',project_tray_id=NULL,publication=publication || jsonb_build_object('withdrawnAt',now()),revision=revision+1,updated_at=now()
      WHERE project_id=$1 AND design_id=$2 AND id=$3`,[projectId,designId,routeId]);
    await client.query('DELETE FROM trays WHERE project_id=$1 AND id=$2',[projectId,group.project_tray_id]);
    await readRoutingPolicyScope(client,projectId);
    return {id:routeId,status:'draft',revision:group.revision+1};
  });res.json(result);
}));
