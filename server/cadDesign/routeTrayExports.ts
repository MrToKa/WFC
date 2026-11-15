import { createHash, randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { requireAdmin } from '../middleware.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { trayLengthCalculationSchema } from '../../shared/trayAutoLength.js';
import { recordTrayChanges } from '../services/trayChangeLogService.js';
import type { TrayRow } from '../models/tray.js';
import { groupInputs, publicationTransaction, PublicationError, type PublicationInstance, type PublicationTransition } from './routePublication.js';

export const cadRouteTrayExportsRouter=Router({mergeParams:true});
const input=z.object({expectedRevision:z.number().int().positive()}).strict();
const hash=(value:unknown)=>createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const fail=(code:string,message:string):never=>{throw new PublicationError(code,message);};
type Group={id:string;name:string;purpose:string;revision:number;status?:string;project_tray_id?:string|null;publication?:unknown};
type Chain={points:[number,number,number][];lengthMetres:number};
type ExportLink={project_id:string;design_id:string;route_group_id:string;tray_id:string;source_sha256:string;source_proof:unknown;projection:unknown};
type Projection={name:string;purpose:string|null;trayType:string|null;widthMm:number|null;heightMm:number|null;lengthMm:number|null;lengthSource:string;lengthCalculation:unknown};
const numeric=(value:unknown):number|null=>value==null||!Number.isFinite(Number(value))?null:Number(value);
export function cadTrayProjection(row:TrayRow):Projection {
  return {name:row.name,purpose:row.purpose,trayType:row.tray_type,widthMm:numeric(row.width_mm),heightMm:numeric(row.height_mm),lengthMm:numeric(row.length_mm),
    lengthSource:row.length_source??'manual',lengthCalculation:row.length_calculation??null};
}
export function deriveCadTrayExport(projectId:string,designId:string,group:Group,instances:PublicationInstance[],chain:Chain,transitions:PublicationTransition[]=[]) {
  const first=instances.find(row=>row.component_kind==='straight')??instances[0];
  if(!first)return fail('CAD_ROUTE_PART_LIMIT','Connect at least one component before adding the route to the Trays list.');
  const centerlineSha256=hash(chain.points),lengthMm=chain.lengthMetres*1000;
  const fields={name:group.name,purpose:group.purpose,trayType:first.part_number,widthMm:300,heightMm:60,lengthMm};
  const source={schemaVersion:'wfc.cad.route-tray-source.v1',projectId,designId,routeId:group.id,...fields,centerlineSha256,centerlineMetres:chain.points,
    elements:instances.map(row=>({instanceId:row.id,instanceRevision:row.revision,catalogItemId:row.catalog_item_id,assetId:row.material_asset_id,
      sourceSha256:row.source_sha256,originalFilename:row.original_filename,componentKind:row.component_kind,partNumber:row.part_number,lengthMm:row.cut_length_mm,
      positionMm:[row.x_mm,row.y_mm,row.z_mm],rotation:[row.qx,row.qy,row.qz,row.qw]})),
    routingTransitions:transitions.map(link=>({id:link.id??null,kind:link.kind,sourceInstanceId:link.source_instance_id,sourcePortName:link.source_name,
      targetInstanceId:link.target_instance_id,targetPortName:link.target_name}))};
  return {fields,source,sourceSha256:hash(source),centerlineSha256,elementCount:instances.length};
}
export async function readCadTrayExport(client:PoolClient,projectId:string,designId:string,routeId:string) {
  const link=(await client.query<ExportLink>('SELECT * FROM cad_route_tray_exports WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3 FOR UPDATE',[projectId,designId,routeId])).rows[0];
  if(!link)return null;
  const row=(await client.query<TrayRow>('SELECT * FROM trays WHERE project_id=$1 AND id=$2 FOR UPDATE',[projectId,link.tray_id])).rows[0];
  const proof=link.source_proof as {source?:unknown};
  if(!row||!proof?.source||hash(proof.source)!==link.source_sha256)
    return fail('CAD_ROUTE_TRAY_EXPORT_INTEGRITY','The saved route-list source proof is unavailable. Refresh the project before retrying.');
  if(hash(cadTrayProjection(row))!==hash(link.projection))
    return fail('CAD_ROUTE_TRAY_EDITED','The linked Trays row was edited manually. Its values were preserved; resolve those changes before refreshing from the CAD route.');
  return {link,row,projection:cadTrayProjection(row)};
}
/** Both publication phases call this; a list export is never adopted by name. */
export async function compatibleCadTrayExport(client:PoolClient,projectId:string,designId:string,group:Group,instances:PublicationInstance[],chain:Chain,transitions:PublicationTransition[]=[]) {
  const saved=await readCadTrayExport(client,projectId,designId,group.id);
  if(!saved)return null;
  const desired=deriveCadTrayExport(projectId,designId,group,instances,chain,transitions);
  if(saved.link.source_sha256!==desired.sourceSha256)
    return fail('CAD_ROUTE_TRAY_EXPORT_STALE','The CAD route changed after it was added to the Trays list. Use Add to Trays list again before publishing.');
  return {...saved,sourceSha256:desired.sourceSha256};
}
const safe=(work:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction):void=>{
  void work(req,res).catch((error:unknown)=>{
    if(error instanceof PublicationError||error instanceof PathFinderError){res.status(error.status).json({code:error.code,message:error.message});return;}
    const code=(error as {code?:string})?.code;
    if(['23503','23505','23514','40P01','40001'].includes(code??'')){res.status(409).json({code:'CAD_ROUTE_TRAY_CONFLICT',message:'The route or Trays list changed. Refresh and retry.'});return;}
    next(error);
  });
};
cadRouteTrayExportsRouter.post('/designs/:designId/routes/:routeId/trays-list',requireAdmin,safe(async(req,res)=>{
  const parsed=input.safeParse(req.body);if(!parsed.success){res.status(400).json({code:'INVALID_CAD_ROUTE_TRAY_EXPORT',message:'A current saved route revision is required.'});return;}
  const result=await publicationTransaction(req,async client=>{
    const {projectId,designId,routeId}=req.params;
    const {group,instances,chain,transitions}=await groupInputs(client,projectId,designId,routeId);
    if(group.revision!==parsed.data.expectedRevision)return fail('STALE_CAD_ROUTE','The route changed. Refresh before adding it to the Trays list.');
    const desired=deriveCadTrayExport(projectId,designId,group,instances,chain,transitions);
    let saved=await readCadTrayExport(client,projectId,designId,routeId);
    let adoptedPublishedRow=false;
    const response=(trayId:string,created:boolean,reused:boolean)=>({routeId,trayId,name:desired.fields.name,purpose:desired.fields.purpose,type:desired.fields.trayType,
      lengthMm:desired.fields.lengthMm,elementCount:desired.elementCount,created,reused,source:'cad-route'});
    if(saved&&saved.link.source_sha256===desired.sourceSha256)return response(saved.row.id,false,true);
    // An existing network publication may already own the exact ordinary row.
    // Its retained publication proof, rather than a name match, authorizes reuse.
    if(!saved&&group.status==='published'&&group.project_tray_id){
      const row=(await client.query<TrayRow>('SELECT * FROM trays WHERE project_id=$1 AND id=$2 FOR UPDATE',[projectId,group.project_tray_id])).rows[0];
      const snapshot=(group.publication as {traySnapshot?:{id:string;name:string;purpose:string;trayType:string;widthMm:number;heightMm:number;lengthMm:number}})?.traySnapshot;
      if(!row||!snapshot||snapshot.id!==row.id||hash({id:row.id,...desired.fields})!==hash(snapshot)||row.name!==group.name||
        row.purpose!==snapshot.purpose||row.tray_type!==snapshot.trayType||numeric(row.width_mm)!==snapshot.widthMm||numeric(row.height_mm)!==snapshot.heightMm||numeric(row.length_mm)!==snapshot.lengthMm)
        return fail('CAD_ROUTE_TRAY_EDITED','The published row differs from this route. Withdraw and reconcile its name or values before exporting it.');
      saved={link:{project_id:projectId,design_id:designId,route_group_id:routeId,tray_id:row.id,source_sha256:'',source_proof:{},projection:cadTrayProjection(row)},row,projection:cadTrayProjection(row)};
      adoptedPublishedRow=true;
    }
    if(saved&&group.status==='published'&&!adoptedPublishedRow)return fail('CAD_ROUTE_PUBLISHED','Withdraw the route before refreshing changed source values.');
    const trayId=saved?.row.id??randomUUID();
    const duplicate=await client.query('SELECT id FROM trays WHERE project_id=$1 AND upper(btrim(btrim(btrim(name),\'/\')))=upper(btrim(btrim(btrim($2),\'/\'))) AND id<>$3',[projectId,group.name,trayId]);
    if(duplicate.rows.length)return fail('CAD_ROUTE_TRAY_NAME_CONFLICT','Another Trays row already has this route name. Its row was preserved; choose a unique route name.');
    const calculation=trayLengthCalculationSchema.parse({source:'cad-route',designId,routeId,routeRevision:group.revision,centerlineSha256:desired.centerlineSha256,
      lengthMm:desired.fields.lengthMm,elementCount:desired.elementCount,calculatedAt:new Date().toISOString()});
    const values=[projectId,trayId,desired.fields.name,desired.fields.purpose,desired.fields.trayType,desired.fields.widthMm,desired.fields.heightMm,desired.fields.lengthMm,JSON.stringify(calculation)];
    const written=saved?await client.query<TrayRow>(`UPDATE trays SET name=$3,purpose=$4,tray_type=$5,width_mm=$6,height_mm=$7,length_mm=$8,
      length_source='auto',length_calculation=$9::jsonb,updated_at=now() WHERE project_id=$1 AND id=$2 RETURNING *`,values):
      await client.query<TrayRow>(`INSERT INTO trays(project_id,id,name,purpose,tray_type,width_mm,height_mm,length_mm,length_source,length_calculation)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'auto',$9::jsonb) RETURNING *`,values);
    const row=written.rows[0];if(!row)return fail('CAD_ROUTE_TRAY_CONFLICT','The Trays row changed. Refresh and retry.');
    await recordTrayChanges(client,req.userId!,saved?.row??null,row);
    const proof={source:desired.source,capturedRouteRevision:group.revision,calculatedAt:calculation.calculatedAt};
    await client.query(`INSERT INTO cad_route_tray_exports(project_id,design_id,route_group_id,tray_id,source_sha256,source_proof,projection,created_by)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
      ON CONFLICT(project_id,design_id,route_group_id) DO UPDATE SET source_sha256=EXCLUDED.source_sha256,source_proof=EXCLUDED.source_proof,
        projection=EXCLUDED.projection,updated_at=now()`,[projectId,designId,routeId,trayId,desired.sourceSha256,JSON.stringify(proof),JSON.stringify(cadTrayProjection(row)),req.userId??null]);
    return response(trayId,!saved,false);
  });res.setHeader('Cache-Control','private, no-store');res.json(result);
}));
