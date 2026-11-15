import { randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { getInstanceCadPorts } from '../../shared/cadLengths.js';
import { MATE_OPPOSING_FACE } from '../../shared/cadPocPorts.js';
import { connectorAlignmentIsValid, type RigidTransform } from '../../shared/cadTransforms.js';
import {
  buildCadChain, groupRawInputs, networkOptions, publicationTransaction, PublicationError,
  routePort, validateCadAttachment, MAX_CAD_TRANSITION_GAP_MM, type PublicationConnection, type PublicationInstance, type PublicationTransition,
} from './routePublication.js';

export const cadRouteAutoConnectionsRouter=Router({mergeParams:true});
const input=z.object({expectedRevision:z.number().int().positive()}).strict();
type PortName='start'|'end';
type Endpoint={instanceId:string;portName:PortName;pointMetres:[number,number,number]};
type Connection=PublicationConnection;
type Port=ReturnType<typeof routePort>;
type NetworkOption={objectRevisionId:string;objectId:string;portIndex:number;pointMetres:[number,number,number];routeCode:string;port:Port};
const fail=(code:string,message:string,diagnostics?:unknown):never=>{throw new PublicationError(code,message,409,diagnostics);};
const key=(id:string,name:string)=>`${id}:${name}`;
const world=(row:PublicationInstance):RigidTransform=>({position:{x:row.x_mm,y:row.y_mm,z:row.z_mm},rotation:{x:row.qx,y:row.qy,z:row.qz,w:row.qw}});
const portNames=['start','end'] as const;

/** Preserve physical mates and separately describe bounded logical installation joins.
 * Neither kind translates or rotates a member or invents a manufacturer fitting. */
export function inferCadConnections(instances:PublicationInstance[],existing:Connection[],transitions:PublicationTransition[]=[]) {
  if(instances.length<1||instances.length>32)fail('CAD_ROUTE_PART_LIMIT','Choose 1–32 verified components for automatic connection.');
  const rows=new Map(instances.map(row=>[row.id,row]));
  if(rows.size!==instances.length)fail('CAD_ROUTE_INVALID_MEMBERS','The route contains duplicate component identities.');
  const ports=instances.flatMap(row=>portNames.map(portName=>({row,portName,frame:routePort(row,portName),
    local:getInstanceCadPorts(row.original_filename,row.source_sha256,row.cut_length_mm).find(p=>p.id===portName)!.local})));
  const byKey=new Map(ports.map(port=>[key(port.row.id,port.portName),port]));
  const used=new Set<string>(),parents=new Map(instances.map(row=>[row.id,row.id]));
  const find=(id:string):string=>{while(parents.get(id)!==id)id=parents.get(id)!;return id;};
  const unite=(a:string,b:string)=>{const first=find(a),last=find(b);if(first===last)fail('CAD_ROUTE_AUTO_CONNECT_LOOP','The route forms a closed loop. Keep an open route chain before publishing.');parents.set(last,first);};
  const aligned=(first:typeof ports[number],last:typeof ports[number],gap=1)=>connectorAlignmentIsValid(world(first.row),first.local,world(last.row),last.local,MATE_OPPOSING_FACE,gap,.1);
  const gapBetween=(first:typeof ports[number],last:typeof ports[number])=>Math.hypot(...first.frame.pointMetres.map((value,index)=>(value-last.frame.pointMetres[index])*1000));
  for(const connection of [...existing.map(edge=>({...edge,kind:'physical' as const})),...transitions]){
    if(!rows.has(connection.source_instance_id)||!rows.has(connection.target_instance_id))
      fail('CAD_ROUTE_CROSS_GROUP_CONNECTION','A component connects outside this group. Group all connected components together first.');
    const first=byKey.get(key(connection.source_instance_id,connection.source_name)),last=byKey.get(key(connection.target_instance_id,connection.target_name));
    if(!first||!last)return fail('CAD_ROUTE_INVALID_PORT','A saved route link has an unsupported endpoint.');
    if(connection.kind==='routing-transition'){
      if(gapBetween(first,last)>MAX_CAD_TRANSITION_GAP_MM+1e-6)return fail('CAD_ROUTE_TRANSITION_TOO_LONG','A logical installation transition is longer than the permitted 300 mm profile zone.');
    }else if(!aligned(first,last))return fail('CAD_ROUTE_CONNECTION_NOT_ALIGNED','An existing physical connection is no longer aligned. No automatic changes were made.');
    for(const port of [first,last]){const id=key(port.row.id,port.portName);if(used.has(id))fail('CAD_ROUTE_AUTO_CONNECT_AMBIGUOUS','A component port already has multiple connections.');used.add(id);}
    unite(first.row.id,last.row.id);
  }
  const open=ports.filter(port=>!used.has(key(port.row.id,port.portName)));
  const candidates=new Map<string,typeof ports>();
  for(const first of open)for(const last of open){
    if(first.row.id===last.row.id||!aligned(first,last))continue;
    const id=key(first.row.id,first.portName),matches=candidates.get(id)??[];matches.push(last);candidates.set(id,matches);
  }
  for(const [port,matches] of candidates)if(matches.length>1)
    fail('CAD_ROUTE_AUTO_CONNECT_AMBIGUOUS','More than one component port fits the same open end. Move the intended parts apart before connecting.',{port,candidateCount:matches.length});
  const missing:Connection[]=[];
  for(const first of open){
    const firstKey=key(first.row.id,first.portName),last=candidates.get(firstKey)?.[0];
    if(!last||used.has(firstKey))continue;
    const lastKey=key(last.row.id,last.portName);unite(first.row.id,last.row.id);used.add(firstKey);used.add(lastKey);
    missing.push({source_instance_id:first.row.id,source_name:first.portName,target_instance_id:last.row.id,target_name:last.portName});
  }
  const missingTransitions:PublicationTransition[]=[],ambiguousPorts=new Set<string>();
  for(let pass=0;pass<instances.length;pass++){
    ambiguousPorts.clear();
    const free=ports.filter(port=>!used.has(key(port.row.id,port.portName)));
    const nearest=new Map<string,typeof ports[number]>();
    for(const first of free){
      const possible=free.filter(last=>find(first.row.id)!==find(last.row.id)&&gapBetween(first,last)<=MAX_CAD_TRANSITION_GAP_MM+1e-6)
        .sort((a,b)=>gapBetween(first,a)-gapBetween(first,b)||key(a.row.id,a.portName).localeCompare(key(b.row.id,b.portName)));
      if(!possible.length)continue;
      const firstKey=key(first.row.id,first.portName);
      if(possible[1]&&Math.abs(gapBetween(first,possible[0])-gapBetween(first,possible[1]))<=.001){ambiguousPorts.add(firstKey);continue;}
      nearest.set(firstKey,possible[0]);
    }
    let added=0;
    for(const first of free){
      const firstKey=key(first.row.id,first.portName),last=nearest.get(firstKey);if(!last||used.has(firstKey))continue;
      const lastKey=key(last.row.id,last.portName),reciprocal=nearest.get(lastKey);
      if(!reciprocal||key(reciprocal.row.id,reciprocal.portName)!==firstKey||used.has(lastKey))continue;
      unite(first.row.id,last.row.id);used.add(firstKey);used.add(lastKey);added++;
      missingTransitions.push({kind:'routing-transition',source_instance_id:first.row.id,source_name:first.portName,target_instance_id:last.row.id,target_name:last.portName});
    }
    if(!added)break;
  }
  const components=new Map<string,string[]>();
  for(const row of instances){const id=find(row.id),members=components.get(id)??[];members.push(row.id);components.set(id,members);}
  const connected=components.size===1;
  // A complete result must satisfy the identical publication chain validator.
  if(connected)buildCadChain(instances,[...existing,...missing],[...transitions,...missingTransitions]);
  const free=ports.filter(port=>!used.has(key(port.row.id,port.portName)));
  const endpoints:Endpoint[]=free.map(port=>({instanceId:port.row.id,portName:port.portName,pointMetres:port.frame.pointMetres}));
  const nearestGaps=[];
  for(let firstIndex=0;firstIndex<free.length;firstIndex++)for(let lastIndex=firstIndex+1;lastIndex<free.length;lastIndex++){
    const first=free[firstIndex],last=free[lastIndex];
    if(find(first.row.id)===find(last.row.id))continue;
    const gapMm=Math.hypot(...first.frame.pointMetres.map((value,index)=>(value-last.frame.pointMetres[index])*1000));
    nearestGaps.push({sourceInstanceId:first.row.id,sourcePortName:first.portName,targetInstanceId:last.row.id,targetPortName:last.portName,
      sourceIndex:instances.findIndex(row=>row.id===first.row.id)+1,targetIndex:instances.findIndex(row=>row.id===last.row.id)+1,
      sourcePartNumber:first.row.part_number,targetPartNumber:last.row.part_number,
      gapMm,aligned:aligned(first,last),orientationAligned:aligned(first,last,2e9)});
  }
  nearestGaps.sort((a,b)=>a.gapMm-b.gapMm||a.sourceInstanceId.localeCompare(b.sourceInstanceId));
  const diagnostics={componentCount:components.size,unconnectedComponents:[...components.values()].map(ids=>ids.sort()),nearestGaps:nearestGaps.slice(0,12),
    ambiguousPorts:[...ambiguousPorts],logicalTransitions:[...transitions,...missingTransitions].map(edge=>({sourceInstanceId:edge.source_instance_id,sourcePortName:edge.source_name,targetInstanceId:edge.target_instance_id,targetPortName:edge.target_name,
      kind:'routing-transition',sourceIndex:instances.findIndex(row=>row.id===edge.source_instance_id)+1,targetIndex:instances.findIndex(row=>row.id===edge.target_instance_id)+1,
      sourcePartNumber:rows.get(edge.source_instance_id)!.part_number,targetPartNumber:rows.get(edge.target_instance_id)!.part_number,
      gapMm:gapBetween(byKey.get(key(edge.source_instance_id,edge.source_name))!,byKey.get(key(edge.target_instance_id,edge.target_name))!)})),
    message:connected?`The components form one route with ${transitions.length+missingTransitions.length} logical installation transitions. Component geometry was preserved.`:
      `${components.size} separate component groups remain. ${ambiguousPorts.size?'Some nearby ends are equally close and cannot be selected safely.':`The nearest remaining open ends are ${nearestGaps[0]?.gapMm.toFixed(1)??'unknown'} mm apart.`} Automatic connection does not move or rotate components.`};
  return {missing,missingTransitions,connected,endpoints,diagnostics};
}

/** Suggest actual retained network ports, never invented points or SVF identities. */
export function selectAutoAttachments(instances:PublicationInstance[],endpoints:Endpoint[],options:NetworkOption[]) {
  const rows=new Map(instances.map(row=>[row.id,row]));
  const dot=(a:number[],b:number[])=>a.reduce((sum,value,index)=>sum+value*b[index],0);
  const canonicalOptions=[...options].sort((a,b)=>a.objectRevisionId.localeCompare(b.objectRevisionId)||a.portIndex-b.portIndex);
  const uniqueOptions:NetworkOption[]=[],spatial=new Map<string,NetworkOption[]>();
  for(const option of canonicalOptions){
    const cell=option.port.pointMetres.map(value=>Math.floor(value/.000001)),nearby:NetworkOption[]=[];
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)nearby.push(...(spatial.get(`${cell[0]+x}|${cell[1]+y}|${cell[2]+z}`)??[]));
    const alias=nearby.some(old=>Math.hypot(...old.port.pointMetres.map((value,index)=>value-option.port.pointMetres[index]))<=.000001&&
      dot(old.port.outward,option.port.outward)>.999999&&Math.abs(dot(old.port.u,option.port.u))>.999999&&Math.abs(dot(old.port.v,option.port.v))>.999999&&
      Math.abs(old.port.widthMetres-option.port.widthMetres)<.000001&&Math.abs(old.port.heightMetres-option.port.heightMetres)<.000001);
    if(!alias){uniqueOptions.push(option);const cellKey=cell.join('|'),bucket=spatial.get(cellKey)??[];bucket.push(option);spatial.set(cellKey,bucket);}
  }
  const candidates=endpoints.flatMap(endpoint=>{
    const row=rows.get(endpoint.instanceId);if(!row)return [];
    const source=routePort(row,endpoint.portName);
    return uniqueOptions.filter(option=>Math.abs(option.port.widthMetres-source.widthMetres)<=.001&&Math.abs(option.port.heightMetres-source.heightMetres)<=.001)
      .map(option=>{let aligned=true;try{validateCadAttachment(source,option.port);}catch{aligned=false;}
        const gapMm=Math.hypot(...source.pointMetres.map((value,index)=>(value-option.port.pointMetres[index])*1000));
        return {endpoint,option,aligned,gapMm};});
  });
  const aligned=candidates.filter(candidate=>candidate.aligned);
  const ambiguousAligned=endpoints.some(endpoint=>aligned.filter(candidate=>candidate.endpoint.instanceId===endpoint.instanceId&&candidate.endpoint.portName===endpoint.portName).length>1);
  const describe=(selected:typeof candidates)=>({attachments:selected.map(({endpoint,option,gapMm})=>({instanceId:endpoint.instanceId,portName:endpoint.portName,targetObjectRevisionId:option.objectRevisionId,targetPortIndex:option.portIndex,
    targetRouteCode:option.routeCode,targetPointMetres:option.pointMetres,gapMm})),
    matched:selected.map(({endpoint,option,gapMm})=>({instanceId:endpoint.instanceId,portName:endpoint.portName,routeTag:option.routeCode,objectId:option.objectId,
      objectRevisionId:option.objectRevisionId,portIndex:option.portIndex,pointMetres:option.pointMetres,gapMm}))});
  if(ambiguousAligned)return {status:'ambiguous' as const,attachments:[],diagnostics:{message:'Several existing network ports fit the same route end. An unambiguous physical connection is required.'}};
  if(aligned.length)return {status:'aligned' as const,...describe(aligned),diagnostics:{message:'Matching network connection points are already aligned.'}};
  candidates.sort((a,b)=>a.gapMm-b.gapMm||a.option.objectRevisionId.localeCompare(b.option.objectRevisionId)||a.option.portIndex-b.option.portIndex);
  if(!candidates.length)return {status:'unavailable' as const,attachments:[],diagnostics:{message:'No existing network port has a matching verified 300 × 60 mm profile.'}};
  if(candidates[1]&&Math.abs(candidates[0].gapMm-candidates[1].gapMm)<=.001)
    return {status:'ambiguous' as const,attachments:[],diagnostics:{message:'Two network connections are equally close. Move the route nearer the intended connection before automatic selection.'}};
  return {status:'alignment-required' as const,...describe([candidates[0]]),diagnostics:{message:`The nearest compatible network point is ${candidates[0].gapMm.toFixed(1)} mm away. Align the whole route before publishing.`}};
}

const safe=(work:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction):void=>{
  void work(req,res).catch((error:unknown)=>{
    if(error instanceof PublicationError||error instanceof PathFinderError){res.status(error.status).json({code:error.code,message:error.message,...(error instanceof PublicationError&&error.diagnostics?{diagnostics:error.diagnostics}:{})});return;}
    const code=(error as {code?:string})?.code;
    if(code==='40P01'||code==='40001'){res.status(409).json({code:'CAD_DESIGN_CONFLICT',message:'The design changed during connection. Refresh and retry.'});return;}
    if(code==='23503'){res.status(409).json({code:'CAD_ROUTE_MEMBERSHIP_CONFLICT',message:'A selected route component is no longer available. Refresh before connecting.'});return;}
    if(code==='23505'||code==='23514'){res.status(409).json({code:'CAD_ROUTE_CONNECTION_CONFLICT',message:'A route endpoint is already occupied or its publication state changed. Refresh before connecting.'});return;}
    next(error);
  });
};
const prefix='/designs/:designId/routes/:routeId';
cadRouteAutoConnectionsRouter.post(`${prefix}/auto-connect`,requireAdmin,safe(async(req,res)=>{
  const parsed=input.safeParse(req.body);if(!parsed.success){res.status(400).json({code:'INVALID_CAD_ROUTE_AUTO_CONNECT',message:'A current saved route revision is required.'});return;}
  const result=await publicationTransaction(req,async client=>{
    const {projectId,designId,routeId}=req.params;
    const {group,instances,connections,transitions=[]}=await groupRawInputs(client,projectId,designId,routeId);
    if(group.revision!==parsed.data.expectedRevision)fail('STALE_CAD_ROUTE','The route changed. Refresh before connecting.');
    if(group.status!=='draft')fail('CAD_ROUTE_PUBLISHED','Withdraw the published route before changing connections.');
    const members=(await client.query<{instance_id:string}>('SELECT instance_id FROM cad_route_group_members WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3',[projectId,designId,routeId])).rows;
    if(members.length!==instances.length)fail('CAD_ROUTE_UNSUPPORTED_GEOMETRY','Some group members have no verified Materials CAD reference. No automatic changes were made.');
    const inferred=inferCadConnections(instances,connections,transitions);
    if(inferred.missing.length){
      const portRows=(await client.query<{id:string;catalog_item_id:string;name:string;port_type:string}>(`SELECT id,catalog_item_id,name,port_type FROM cad_catalog_ports
        WHERE project_id=$1 AND catalog_item_id=ANY($2::uuid[]) AND name IN('start','end') FOR SHARE`,[projectId,[...new Set(instances.map(row=>row.catalog_item_id))]])).rows;
      const rows=new Map(instances.map(row=>[row.id,row]));
      const verified=inferred.missing.map(connection=>{
        const source=rows.get(connection.source_instance_id)!,target=rows.get(connection.target_instance_id)!;
        const first=portRows.find(port=>port.catalog_item_id===source.catalog_item_id&&port.name===connection.source_name),last=portRows.find(port=>port.catalog_item_id===target.catalog_item_id&&port.name===connection.target_name);
        if(!first||!last||first.port_type!==last.port_type)return fail('CAD_ROUTE_PORTS_REQUIRED','The project catalog has no matching verified connection ports. No automatic changes were made.');
        return {source,target,first,last};
      });
      for(const pair of verified)await client.query(`INSERT INTO cad_design_connections(id,project_id,design_id,source_instance_id,source_catalog_item_id,source_port_id,
        target_instance_id,target_catalog_item_id,target_port_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[randomUUID(),projectId,designId,pair.source.id,pair.source.catalog_item_id,pair.first.id,pair.target.id,pair.target.catalog_item_id,pair.last.id]);
    }
    for(const link of inferred.missingTransitions)await client.query(`INSERT INTO cad_route_transition_links(id,project_id,design_id,route_group_id,source_instance_id,source_port_name,
      target_instance_id,target_port_name,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'routing-transition')`,[randomUUID(),projectId,designId,routeId,link.source_instance_id,link.source_name,link.target_instance_id,link.target_name]);
    const changed=Boolean(inferred.missing.length||inferred.missingTransitions.length);
    if(changed)await client.query('UPDATE cad_route_groups SET revision=revision+1,updated_at=now() WHERE project_id=$1 AND design_id=$2 AND id=$3',[projectId,designId,routeId]);
    const network=(await client.query<{current_artifact_id:string|null}>('SELECT current_artifact_id FROM pf_project_preparations WHERE project_id=$1',[projectId])).rows[0];
    return {routeId,revision:group.revision+(changed?1:0),connectionsCreated:inferred.missing.length,routingTransitionsCreated:inferred.missingTransitions.length,connected:inferred.connected,
      endpoints:inferred.endpoints,diagnostics:{...inferred.diagnostics,networkRequired:!network?.current_artifact_id}};
  });res.setHeader('Cache-Control','private, no-store');res.json(result);
}));
cadRouteAutoConnectionsRouter.get(`${prefix}/auto-attachments`,requireAdmin,safe(async(req,res)=>{
  const result=await publicationTransaction(req,async client=>{
    const {projectId,designId,routeId}=req.params;
    const {group,instances,connections,transitions=[]}=await groupRawInputs(client,projectId,designId,routeId);
    const inferred=inferCadConnections(instances,connections,transitions);
    // A read suggests internal joins but never saves them or invents a two-end chain.
    if(!inferred.connected||inferred.missing.length||inferred.missingTransitions.length)return {status:'incomplete',attachments:[],routeId,revision:group.revision,endpoints:inferred.endpoints,
      diagnostics:{...inferred.diagnostics,message:inferred.missing.length||inferred.missingTransitions.length?'Internal physical joins or bounded logical installation transitions are available. Use Auto-select connection points to save them without moving components.':inferred.diagnostics.message}};
    const model=(await client.query<{model_version_id:string}>('SELECT model_version_id FROM cad_designs WHERE project_id=$1 AND id=$2',[projectId,designId])).rows[0];
    try{
      const network=await networkOptions(client,projectId,model.model_version_id);
      const selection=selectAutoAttachments(instances,inferred.endpoints,network.options);
      return {...selection,diagnostics:{...inferred.diagnostics,...selection.diagnostics},routeId,revision:group.revision,endpoints:inferred.endpoints};
    }catch(error){
      if(error instanceof PublicationError&&['CAD_ROUTE_NETWORK_REQUIRED','CAD_ROUTE_NETWORK_TRACE_REQUIRED','CAD_ROUTE_NETWORK_PORTS_REQUIRED'].includes(error.code))
        return {status:'network-required',attachments:[],routeId,revision:group.revision,endpoints:inferred.endpoints,diagnostics:{...inferred.diagnostics,networkRequired:true,code:error.code,message:error.message}};
      throw error;
    }
  });res.setHeader('Cache-Control','private, no-store');res.json(result);
}));
