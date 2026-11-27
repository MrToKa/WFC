import { projectTrayProfile, routingTrayProfile } from './trayProfile.js';
import { createHash, randomUUID } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { requireAdmin } from '../middleware.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { trayLengthCalculationSchema } from '../../shared/trayAutoLength.js';
import { getInstanceCadPorts } from '../../shared/cadLengths.js';
import { recordTrayChanges } from '../services/trayChangeLogService.js';
import type { TrayRow } from '../models/tray.js';
import { groupInputs, publicationTransaction, PublicationError, routePort, resolveCadRouteMaterial, type CadRoutePath, type PublicationInstance, type PublicationTransition } from './routePublication.js';

export const cadRouteTrayExportsRouter=Router({mergeParams:true});
const input=z.object({expectedRevision:z.number().int().positive()}).strict();
const hash=(value:unknown)=>createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const fail=(code:string,message:string):never=>{throw new PublicationError(code,message);};
type Group={id:string;name:string;purpose:string;revision:number;status?:string;project_tray_id?:string|null;publication?:unknown};
type Chain={points:[number,number,number][];lengthMetres:number;paths?:CadRoutePath[]};
type ExportLink={substitute_step?:boolean;project_id:string;design_id:string;route_group_id:string;tray_id:string;source_sha256:string;source_proof:unknown;projection:unknown};
type Projection={name:string;purpose:string|null;trayType:string|null;widthMm:number|null;heightMm:number|null;lengthMm:number|null;lengthSource:string;lengthCalculation:unknown};
const numeric=(value:unknown):number|null=>value==null||!Number.isFinite(Number(value))?null:Number(value);
export function cadTrayProjection(row:TrayRow):Projection {
  return {name:row.name,purpose:row.purpose,trayType:row.tray_type,widthMm:numeric(row.width_mm),heightMm:numeric(row.height_mm),lengthMm:numeric(row.length_mm),
    lengthSource:row.length_source??'manual',lengthCalculation:row.length_calculation??null};
}
export function deriveCadTrayExport(projectId:string,designId:string,group:Group,instances:PublicationInstance[],chain:Chain,transitions:PublicationTransition[]=[]) {
  const first=instances.find(row=>row.component_kind==='straight')??instances[0];
  if(!first)return fail('CAD_ROUTE_PART_LIMIT','Connect at least one component before adding the route to the Trays list.');
  const profile=routePort(first,'start');
  const centerlineSha256=hash(chain.paths??chain.points),lengthMm=chain.lengthMetres*1000;
  const hasTee=instances.some(row=>getInstanceCadPorts(row.original_filename,row.source_sha256,row.cut_length_mm).length===3);
  const material=hasTee?resolveCadRouteMaterial(instances):{trayType:first.part_number,widthMm:profile.widthMetres*1000,heightMm:profile.heightMetres*1000};
  const fields={name:group.name,purpose:group.purpose,...material,lengthMm};
  const source={schemaVersion:chain.paths?'wfc.cad.route-tray-source.v2':'wfc.cad.route-tray-source.v1',projectId,designId,routeId:group.id,...fields,centerlineSha256,centerlineMetres:chain.points,
    ...(chain.paths?{centerlineGraph:chain.paths}:{}),
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
/** Caller owns the design transaction; refresh only the exact owned Trays row. */
export async function writeCadTrayExport(client:PoolClient,projectId:string,designId:string,routeId:string,userId:string,expectedRevision?:number) {
    const {group,instances,chain,transitions}=await groupInputs(client,projectId,designId,routeId);
    if(expectedRevision!==undefined&&group.revision!==expectedRevision)return fail('STALE_CAD_ROUTE','The route changed. Refresh before adding it to the Trays list.');
    if(group.revision_of_route_id)return fail('CAD_ROUTE_REVISION_REVIEW_REQUIRED','The Trays entry updates when this route revision is published.');
    const desired=deriveCadTrayExport(projectId,designId,group,instances,chain,transitions);
    let saved=await readCadTrayExport(client,projectId,designId,routeId);
    let adoptedPublishedRow=false;
    const response=(trayId:string,created:boolean,reused:boolean)=>({routeId,trayId,name:desired.fields.name,purpose:desired.fields.purpose,type:saved?.link.substitute_step ? saved.row.tray_type : desired.fields.trayType,
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
    const profile = routingTrayProfile(desired.fields, saved);
    const values=[projectId,trayId,desired.fields.name,desired.fields.purpose,profile.trayType,profile.widthMm,profile.heightMm,desired.fields.lengthMm,JSON.stringify(calculation)];
    const written=saved?await client.query<TrayRow>(`UPDATE trays SET name=$3,purpose=$4,tray_type=$5,width_mm=$6,height_mm=$7,length_mm=$8,
      length_source='auto',length_calculation=$9::jsonb,updated_at=now() WHERE project_id=$1 AND id=$2 RETURNING *`,values):
      await client.query<TrayRow>(`INSERT INTO trays(project_id,id,name,purpose,tray_type,width_mm,height_mm,length_mm,length_source,length_calculation)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'auto',$9::jsonb) RETURNING *`,values);
    const row=written.rows[0];if(!row)return fail('CAD_ROUTE_TRAY_CONFLICT','The Trays row changed. Refresh and retry.');
    await recordTrayChanges(client,userId,saved?.row??null,row);
    const proof={source:desired.source,capturedRouteRevision:group.revision,calculatedAt:calculation.calculatedAt};
    await client.query(`INSERT INTO cad_route_tray_exports(project_id,design_id,route_group_id,tray_id,source_sha256,source_proof,projection,created_by)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
      ON CONFLICT(project_id,design_id,route_group_id) DO UPDATE SET source_sha256=EXCLUDED.source_sha256,source_proof=EXCLUDED.source_proof,
        projection=EXCLUDED.projection,updated_at=now()`,[projectId,designId,routeId,trayId,desired.sourceSha256,JSON.stringify(proof),JSON.stringify(cadTrayProjection(row)),userId]);
    return response(trayId,!saved,false);
}

/** Membership and both derived list projections commit together. A listed
 * section stays listed when moved into a previously unlisted destination. */
export async function synchronizeCadTrayExportsAfterTransfer(client:PoolClient,projectId:string,designId:string,sourceRouteId:string|null,targetRouteId:string,userId:string):Promise<void> {
  const source=sourceRouteId?await readCadTrayExport(client,projectId,designId,sourceRouteId):null;
  const target=await readCadTrayExport(client,projectId,designId,targetRouteId);
  if(!source&&!target)return;
  const refresh=async(routeId:string,saved:Awaited<ReturnType<typeof readCadTrayExport>>)=>{
    const group=(await client.query<{status:string}>('SELECT status FROM cad_route_groups WHERE project_id=$1 AND design_id=$2 AND id=$3 FOR UPDATE',[projectId,designId,routeId])).rows[0];
    if(!group||group.status!=='draft')return fail('CAD_ROUTE_PUBLISHED','Withdraw the route before transferring its listed sections.');
    const membership=(await client.query<{member_count:number}>(`SELECT COUNT(*)::int AS member_count FROM cad_route_group_members
      WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3`,[projectId,designId,routeId])).rows[0];
    if(!membership)return fail('CAD_ROUTE_TRAY_CONFLICT','The route membership is unavailable. Retry the transfer.');
    if(membership.member_count===0){
      if(!saved)return;
      await client.query(`DELETE FROM cad_route_tray_exports WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3 AND tray_id=$4`,[projectId,designId,routeId,saved.row.id]);
      if (saved.link.substitute_step) return;
      const removed=await client.query('DELETE FROM trays WHERE project_id=$1 AND id=$2 RETURNING id',[projectId,saved.row.id]);
      if(!removed.rows[0])return fail('CAD_ROUTE_TRAY_CONFLICT','The Trays row changed. Retry the transfer.');
    }else await writeCadTrayExport(client,projectId,designId,routeId,userId);
  };
  if(source&&sourceRouteId)await refresh(sourceRouteId,source);
  await refresh(targetRouteId,target);
}

const substituteInput = z.object({
  expectedRevision: z.number().int().positive(),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

cadRouteTrayExportsRouter.post('/designs/:designId/routes/:routeId/substitute-step', requireAdmin, safe(async (req, res) => {
  const parsed = substituteInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ code: 'INVALID_CAD_PROFILE_REVIEW' }); return; }
  const { projectId, designId, routeId } = req.params;
  const result = await publicationTransaction(req, async client => {
    const { group, instances, chain, transitions } = await groupInputs(client, projectId, designId, routeId);
    if (group.revision !== parsed.data.expectedRevision || group.revision_of_route_id)
      return fail('STALE_CAD_ROUTE', 'Select the current saved route to review its profile.');
    const link = (await client.query<ExportLink>(
      'SELECT * FROM cad_route_tray_exports WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3 FOR UPDATE',
      [projectId, designId, routeId])).rows[0];
    const trayId = link?.tray_id ?? group.project_tray_id;
    if (!trayId || (group.status === 'published' && group.project_tray_id !== trayId))
      return fail('CAD_ROUTE_TRAY_EXPORT_INTEGRITY', 'Add the route to the Trays list before selecting its real profile.');
    const row = (await client.query<TrayRow>('SELECT * FROM trays WHERE project_id=$1 AND id=$2 FOR UPDATE', [projectId, trayId])).rows[0];
    if (!row) return fail('CAD_ROUTE_TRAY_EXPORT_INTEGRITY', 'The linked Trays row is missing.');
    const real = projectTrayProfile(row);
    const desired = deriveCadTrayExport(projectId, designId, group, instances, chain, transitions);
    const { trayType, widthMm, heightMm } = desired.fields;
    const step = { trayType, widthMm, heightMm };
    const projection = cadTrayProjection(row);
    if (link) {
      const proof = link.source_proof as { source?: unknown };
      if (!proof?.source || hash(proof.source) !== link.source_sha256)
        return fail('CAD_ROUTE_TRAY_EXPORT_INTEGRITY', 'The saved CAD source could not be verified.');
      if (hash({ ...(link.projection as Projection), ...real }) !== hash(projection))
        return fail('CAD_ROUTE_TRAY_EDITED', 'Resolve changes to the name, purpose or length before confirming the profile.');
    }
    const publication = group.publication as { traySnapshot?: { id: string; name: string; purpose: string; lengthMm: number }; baseArtifactId: string } | null;
    const snapshot = publication?.traySnapshot;
    if (group.status === 'published' && (!snapshot || snapshot.id !== trayId || snapshot.name !== row.name ||
        snapshot.purpose !== row.purpose || snapshot.lengthMm !== projection.lengthMm))
      return fail('CAD_ROUTE_CATALOG_CHANGED', 'The published route also differs in identity, purpose or length.');
    const reviewToken = hash({ projectId, designId, routeId, revision: group.revision, trayId, projection, publication,
      geometry: desired.sourceSha256, exportSource: link?.source_sha256 ?? null });
    if (!parsed.data.reviewToken) return { step, real, reviewToken };
    if (parsed.data.reviewToken !== reviewToken) return fail('CAD_ROUTE_REVIEW_CHANGED', 'The route or Trays row changed. Review the profiles again.');
    if (link?.substitute_step && hash(link.projection) === hash(projection) &&
        (group.status !== 'published' || hash(snapshot) === hash({ ...snapshot, ...real })))
      return { step, real, confirmed: true };
    if ((await client.query('SELECT id FROM cad_route_groups WHERE project_id=$1 AND design_id=$2 AND revision_of_route_id=$3 LIMIT 1',
      [projectId, designId, routeId])).rows.length)
      return fail('CAD_ROUTE_REVISION_IN_PROGRESS', 'Finish the open revision before changing the profile mapping.');
    const keys = [projectId, designId, routeId];
    if (link) {
      await client.query(`UPDATE cad_route_tray_exports SET substitute_step=true,projection=$4,updated_at=now()
        WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3`, [...keys, projection]);
    } else {
      await client.query(`INSERT INTO cad_route_tray_exports(project_id,design_id,route_group_id,tray_id,source_sha256,source_proof,projection,created_by,substitute_step)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`, [...keys, trayId, desired.sourceSha256,
        { source: desired.source, capturedRouteRevision: group.revision }, projection, req.userId]);
    }
    if (publication && group.status === 'published') {
      const updated = { ...publication, traySnapshot: { ...snapshot, ...real }, trayExportSourceSha256: link?.source_sha256 ?? desired.sourceSha256 };
      await client.query(`INSERT INTO cad_route_network_publication_history(id,project_id,design_id,route_group_id,previous_revision,
        base_artifact_id,previous_publication,publication,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [randomUUID(), ...keys, group.revision, publication.baseArtifactId, publication, updated, req.userId]);
      await client.query('UPDATE cad_route_groups SET publication=$4,revision=revision+1,updated_at=now() WHERE project_id=$1 AND design_id=$2 AND id=$3', [...keys, updated]);
    } else {
      await client.query('UPDATE cad_route_groups SET revision=revision+1,updated_at=now() WHERE project_id=$1 AND design_id=$2 AND id=$3', keys);
    }
    return { step, real, confirmed: true };
  });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(result);
}));

cadRouteTrayExportsRouter.post('/designs/:designId/routes/:routeId/trays-list',requireAdmin,safe(async(req,res)=>{
  const parsed=input.safeParse(req.body);if(!parsed.success){res.status(400).json({code:'INVALID_CAD_ROUTE_TRAY_EXPORT',message:'A current saved route revision is required.'});return;}
  const result=await publicationTransaction(req,async client=>{
    const {projectId,designId,routeId}=req.params;
    return writeCadTrayExport(client,projectId,designId,routeId,req.userId!,parsed.data.expectedRevision);
  });res.setHeader('Cache-Control','private, no-store');res.json(result);
}));
