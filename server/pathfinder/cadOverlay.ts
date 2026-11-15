import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { cadOverlayEnvelopeSchema, cadOverlayPayloadSchema, type CadOverlayEnvelope } from '../../shared/pathfinderCadOverlay.js';
import { canonicalPurposeJson, catalogRoutingHashInput } from '../../shared/pathfinderPurposePolicy.js';
import { projectRoutingCatalogRows } from './catalog.js';
import { PathFinderError } from './errors.js';
import type { RoutingScope } from './routingScope.js';

const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
export function encodeCadOverlay(value: unknown): CadOverlayEnvelope {
  const parsed = cadOverlayPayloadSchema.parse(value);
  const payload={...parsed,segments:[...parsed.segments].sort((a,b)=>a.id.localeCompare(b.id,'en'))};
  const bytes = Buffer.from(canonicalPurposeJson(payload));
  if (bytes.length > 384*1024) throw new PathFinderError('CAD_OVERLAY_LIMIT',413);
  return cadOverlayEnvelopeSchema.parse({schemaVersion:'wfc.pf.cad-overlay.v1',sha256:createHash('sha256').update(bytes).digest('hex'),payloadBase64:bytes.toString('base64')});
}

/** Additive provenance: the old immutable artifact is never restamped with new tokens.
 * Every non-CAD catalog row must still have the exact originally prepared projection. */
export async function readCadOverlay(client: PoolClient, projectId: string, artifactId: string,
  snapshotSha256: string, modelVersionId: string, prepared: RoutingScope, current: RoutingScope): Promise<CadOverlayEnvelope | 'retired-base-proof' | null> {
  if (process.env.WFC_CAD_DESIGN_ENABLED !== 'true') return null;
  const groups = await client.query<{status:string;project_tray_id:string|null;publication:unknown}>(
    `SELECT status,project_tray_id,publication FROM cad_route_groups WHERE project_id=$1 AND publication IS NOT NULL ORDER BY id FOR SHARE`,[projectId]);
  if (!groups.rows.length) return null;
  const active=groups.rows.filter(row=>row.status==='published');
  const retired=groups.rows.filter(row=>row.status==='draft'&&(row.publication as {baseArtifactId?:string})?.baseArtifactId===artifactId);
  if(!active.length&&!retired.length)return null;
  const owned = active.map(row => row.project_tray_id!);
  // A previously exported list row was part of the frozen base catalogue.
  // Only rows created by this publication are an additive catalogue delta.
  const additions=active.filter(row=>(row.publication as {trayInBaseCatalog?:boolean})?.trayInBaseCatalog!==true).map(row=>row.project_tray_id!);
  const actualTrays = (await client.query<{id:string;name:string;purpose:string|null;tray_type:string|null;width_mm:string|number|null;height_mm:string|number|null;length_mm:string|number|null}>(
    'SELECT id::text,name,purpose,tray_type,width_mm,height_mm,length_mm FROM trays WHERE project_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE',[projectId,owned])).rows;
  for (const group of active) {
    const saved=(group.publication as {traySnapshot?:{id:string;name:string;purpose:string;trayType:string;widthMm:number;heightMm:number;lengthMm:number}})?.traySnapshot;
    const actual=actualTrays.find(row=>row.id===group.project_tray_id);
    if (!saved || !actual || saved.id!==actual.id || saved.name!==actual.name || saved.purpose!==actual.purpose || saved.trayType!==actual.tray_type ||
      saved.widthMm!==Number(actual.width_mm) || saved.heightMm!==Number(actual.height_mm) || saved.lengthMm!==Number(actual.length_mm))
      throw new PathFinderError('CAD_ROUTE_CATALOG_CHANGED',409,'A published CAD route catalog row changed. Withdraw and republish it before calculating.');
  }
  const source = await client.query<{id:string;name:string;purpose:string|null}>(
    'SELECT id::text,name,purpose FROM trays WHERE project_id=$1 AND NOT(id=ANY($2::uuid[])) ORDER BY id',[projectId,additions]);
  const base = projectRoutingCatalogRows(source.rows);
  if (prepared.routingPolicyRevision !== current.routingPolicyRevision || prepared.routingPolicySha256 !== current.routingPolicySha256 ||
      digest(catalogRoutingHashInput(projectId,base.rows,base.diagnostics)) !== prepared.routingContentSha256)
    throw new PathFinderError('ROUTING_PREPARATION_REQUIRED',409,'The base network or routing permissions changed. Prepare the project network again.');
  const segments = [];
  for (const row of [...active,...retired]) {
    const publication = row.publication as {baseArtifactId?:string;overlay?:unknown};
    if (publication?.baseArtifactId !== artifactId) throw new PathFinderError('CAD_ROUTE_BASE_CHANGED',409,'Withdraw and republish CAD routes against the current prepared network.');
    const payload = cadOverlayPayloadSchema.parse(publication.overlay);
    if (payload.projectId!==projectId || payload.modelVersionId!==modelVersionId || payload.baseSnapshotSha256!==snapshotSha256)
      throw new PathFinderError('CAD_ROUTE_BASE_CHANGED',409);
    if(row.status==='published')segments.push(...payload.segments);
  }
  if(!segments.length)return 'retired-base-proof';
  return encodeCadOverlay({schemaVersion:'wfc.pf.cad-overlay-payload.v1',projectId,modelVersionId,baseSnapshotSha256:snapshotSha256,segments});
}
