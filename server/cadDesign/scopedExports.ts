import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { supportsStraightCut } from '../../shared/cadLengths.js';
import { getAalborgPocPorts } from '../../shared/cadPocPorts.js';
import { MAX_STEP_ASSEMBLY_PARTS } from '../../shared/cadExportLimits.js';

export class CadExportError extends Error {
  constructor(readonly code:string,readonly status:number,message=code){super(message);}
}
const scopeInput=z.object({routeId:z.string().uuid().optional()}).strict();
export function parseCadExportScope(query:unknown):string|undefined {
  const parsed=scopeInput.safeParse(query);
  if(!parsed.success)throw new CadExportError('INVALID_CAD_EXPORT_SCOPE',400,'Use one valid routeId, or omit it for the complete proposal.');
  return parsed.data.routeId;
}
export type CadExportPart={
  id:string;revision:number;catalog_item_id:string;catalog_id:string|null;
  manufacturer:string;part_number:string;family:string;original_filename:string;source_sha256:string;source_object_key:string;
  material_asset_id:string|null;cad_revision:number|null;component_kind:string|null;cut_length_mm:number|null;
  width_mm?:number|null;height_mm?:number|null;
  x_mm:number;y_mm:number;z_mm:number;qx:number;qy:number;qz:number;qw:number;
};
export type CadExportRoute={id:string;name:string;revision:number;purpose:string|null};
export type CadSectionMetadata={instanceId:string;name:string;actualLengthMm:number|null;widthMm:number|null;heightMm:number|null;
  partNumber:string;manufacturer:string;purpose:string|null;componentKind:string|null;cadAssetId:string|null;cadRevision:number|null};
export type CadSectionRoute={id:string|null;name:string;purpose:string|null};
export type CadExportSnapshot={
  projectId:string;designId:string;modelVersionId:string;designRevision:number;
  route:null|CadExportRoute;routes:CadExportRoute[];memberships:Array<{route_group_id:string;instance_id:string}>;
  memberIds:string[];parts:CadExportPart[];fingerprint:string;
};
/** A coherent read, with no long-lived DB locks during isolated CAD conversion. */
export async function readCadExportSnapshot(pool:Pick<Pool,'connect'>,projectId:string,designId:string,routeId?:string,maxParts?:number):Promise<CadExportSnapshot> {
  const client=await pool.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const design=(await client.query<{model_version_id:string;revision:number}>(
      'SELECT model_version_id,revision FROM cad_designs WHERE project_id=$1 AND id=$2',[projectId,designId])).rows[0];
    if(!design)throw new CadExportError('CAD_DESIGN_NOT_FOUND',404);
    let route:CadExportSnapshot['route']=null;
    if(routeId){
      route=(await client.query<CadExportRoute>(
        'SELECT id,name,revision,purpose FROM cad_route_groups WHERE project_id=$1 AND design_id=$2 AND id=$3',[projectId,designId,routeId])).rows[0]??null;
      if(!route)throw new CadExportError('CAD_ROUTE_NOT_FOUND',404);
    }
    const routes=route?[route]:(await client.query<CadExportRoute>(
      'SELECT id,name,revision,purpose FROM cad_route_groups WHERE project_id=$1 AND design_id=$2 ORDER BY id',[projectId,designId])).rows;
    const memberships=(await client.query<{route_group_id:string;instance_id:string}>(`SELECT route_group_id,instance_id FROM cad_route_group_members
      WHERE project_id=$1 AND design_id=$2 ${routeId?'AND route_group_id=$3':''} ORDER BY route_group_id,instance_id`,routeId?[projectId,designId,routeId]:[projectId,designId])).rows;
    const ids=routeId?(await client.query<{instance_id:string}>(`SELECT instance_id FROM cad_route_group_members
      WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3 ORDER BY instance_id LIMIT 10001`,[projectId,designId,routeId])).rows.map(row=>row.instance_id):
      (await client.query<{id:string}>('SELECT id FROM cad_design_instances WHERE project_id=$1 AND design_id=$2 ORDER BY created_at,id LIMIT 10001',[projectId,designId])).rows.map(row=>row.id);
    if(!ids.length)throw new CadExportError(routeId?'EMPTY_CAD_ROUTE':'EMPTY_CAD_DESIGN',409);
    if(ids.length>10000)throw new CadExportError('CAD_EXPORT_INSTANCE_LIMIT',413);
    if(maxParts!==undefined&&ids.length>maxParts)throw new CadExportError('CAD_EXPORT_PART_LIMIT',413,`STEP assembly export supports at most ${MAX_STEP_ASSEMBLY_PARTS} selected components.`);
    const parts=(await client.query<CadExportPart>(`SELECT i.id,i.revision,i.catalog_item_id,c.id AS catalog_id,
      c.manufacturer,c.part_number,c.family,c.original_filename,c.source_sha256,c.source_object_key,
      c.material_component_cad_asset_id AS material_asset_id,a.revision AS cad_revision,p.component_kind,
      COALESCE(p.width_mm,t.width_mm) AS width_mm,COALESCE(p.height_mm,t.height_mm) AS height_mm,
      i.cut_length_mm,i.x_mm,i.y_mm,i.z_mm,i.qx,i.qy,i.qz,i.qw
      FROM cad_design_instances i LEFT JOIN cad_catalog_items c ON c.project_id=i.project_id AND c.id=i.catalog_item_id
      LEFT JOIN material_component_cad_assets a ON a.id=c.material_component_cad_asset_id
      LEFT JOIN material_components p ON p.id=a.component_id
      LEFT JOIN material_trays t ON t.id=p.material_tray_id
      WHERE i.project_id=$1 AND i.design_id=$2 AND i.id=ANY($3::uuid[]) ORDER BY i.created_at,i.id`,[projectId,designId,ids])).rows;
    const selected=new Set(ids),returned=new Set(parts.map(part=>part.id));
    if(selected.size!==ids.length||parts.length!==ids.length||returned.size!==selected.size||parts.some(part=>!selected.has(part.id)||!part.catalog_id||
      !part.original_filename||!part.source_object_key||!part.source_sha256||!part.part_number||(part.material_asset_id!=null&&part.cad_revision==null)))
      throw new CadExportError('CAD_EXPORT_SOURCE_UNAVAILABLE',409,'Every selected component must retain its pinned catalogue source. No partial export was generated.');
    const knownRoutes=new Set(routes.map(row=>row.id)),assigned=new Set<string>();
    for(const membership of memberships){
      if(!knownRoutes.has(membership.route_group_id)||!selected.has(membership.instance_id)||assigned.has(membership.instance_id))
        throw new CadExportError('CAD_EXPORT_MEMBERSHIP_UNAVAILABLE',409,'Route membership is inconsistent. No partial export was generated.');
      assigned.add(membership.instance_id);
    }
    if(route&&assigned.size!==selected.size)throw new CadExportError('CAD_EXPORT_MEMBERSHIP_UNAVAILABLE',409);
    const body={projectId,designId,modelVersionId:design.model_version_id,designRevision:design.revision,route,routes,memberships,memberIds:[...ids].sort(),parts};
    const result={...body,fingerprint:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}

/** Per-occurrence identity is independent of the deduplicated source geometry. */
export function cadAssemblyParts(snapshot:CadExportSnapshot) {
  const routes=new Map(snapshot.routes.map(route=>[route.id,route]));
  const membership=new Map(snapshot.memberships.map(row=>[row.instance_id,row.route_group_id]));
  const dimension=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:null;
  return snapshot.parts.map(part=>{
    const group=routes.get(membership.get(part.id)??'');
    const route:CadSectionRoute={id:group?.id??null,name:group?.name??'Unassigned components',purpose:group?.purpose??null};
    let actualLengthMm:number|null=null;
    if(part.component_kind==='straight'&&supportsStraightCut(part.original_filename,part.source_sha256))actualLengthMm=part.cut_length_mm??6000;
    else if(part.component_kind==='bend'&&part.cut_length_mm==null&&getAalborgPocPorts(part.original_filename,part.source_sha256).length&&
      part.original_filename.trim().toUpperCase()==='NDX_KLBK_60-303_MED_214.STEP')actualLengthMm=290+650*Math.PI/2;
    const metadata:CadSectionMetadata={instanceId:part.id,name:`${route.name} / ${part.id}`,actualLengthMm,
      widthMm:dimension(part.width_mm),heightMm:dimension(part.height_mm),partNumber:part.part_number,manufacturer:part.manufacturer,
      purpose:route.purpose,componentKind:part.component_kind,cadAssetId:part.material_asset_id,cadRevision:part.cad_revision};
    return {...part,metadata,route};
  });
}
export async function assertCadExportCurrent(pool:Pick<Pool,'connect'>,snapshot:CadExportSnapshot):Promise<void> {
  let current:CadExportSnapshot;
  try{current=await readCadExportSnapshot(pool,snapshot.projectId,snapshot.designId,snapshot.route?.id,MAX_STEP_ASSEMBLY_PARTS);}
  catch(error){if(error instanceof CadExportError)throw new CadExportError('DESIGN_CHANGED_DURING_EXPORT',409);throw error;}
  if(current.fingerprint!==snapshot.fingerprint)throw new CadExportError('DESIGN_CHANGED_DURING_EXPORT',409);
}
export function cadExportFilename(snapshot:CadExportSnapshot,format:'step'|'csv'):string {
  if(!snapshot.route)return format==='step'?'wfc-proposed-cable-trays.step':'wfc-proposed-tray-mto.csv';
  const label=snapshot.route.name.normalize('NFKD').replace(/[^A-Za-z0-9_.-]+/g,'_').replace(/^[._-]+|[._-]+$/g,'').slice(0,80)||snapshot.route.id;
  return `wfc-route-${label}-${format==='step'?'cable-trays.step':'materials.csv'}`;
}
export function cadMaterialRows(parts:CadExportPart[]) {
  const groups=new Map<string,{part:CadExportPart;quantity:number;lengthMm:number|null}>();
  for(const part of parts){
    const lengthMm=part.component_kind==='straight'&&supportsStraightCut(part.original_filename,part.source_sha256)?part.cut_length_mm??6000:null;
    const key=JSON.stringify([part.catalog_item_id,part.material_asset_id,lengthMm]);
    const group=groups.get(key);if(group)group.quantity++;else groups.set(key,{part,quantity:1,lengthMm});
  }
  return [...groups.values()].sort((a,b)=>a.part.manufacturer.localeCompare(b.part.manufacturer)||a.part.part_number.localeCompare(b.part.part_number)||(a.lengthMm??0)-(b.lengthMm??0));
}
