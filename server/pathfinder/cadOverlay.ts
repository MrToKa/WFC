import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { cadOverlayEnvelopeSchema, cadOverlayPayloadSchema, type CadOverlayEnvelope } from '../../shared/pathfinderCadOverlay.js';
import { canonicalPurposeJson, catalogRoutingHashInput } from '../../shared/pathfinderPurposePolicy.js';
import { projectRoutingCatalogRows } from './catalog.js';
import { PathFinderError } from './errors.js';
import type { RoutingScope } from './routingScope.js';
import { cadDesignEnabled } from '../cadDesign/configuration.js';

const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
export function encodeCadOverlay(value: unknown): CadOverlayEnvelope {
  const parsed = cadOverlayPayloadSchema.parse(value);
  const payload={...parsed,segments:[...parsed.segments].sort((a,b)=>a.id.localeCompare(b.id,'en'))};
  const bytes = Buffer.from(canonicalPurposeJson(payload));
  if (bytes.length > 384*1024) throw new PathFinderError('CAD_OVERLAY_LIMIT',413);
  return cadOverlayEnvelopeSchema.parse({schemaVersion:'wfc.pf.cad-overlay.v1',sha256:createHash('sha256').update(bytes).digest('hex'),payloadBase64:bytes.toString('base64')});
}

/** A current computational view, never a rewrite of sealed publication bytes.
 * Historical v1/v2 envelopes remain readable by their original native policy. */
export function automaticCadOverlayView(value:unknown){
  const parsed=cadOverlayPayloadSchema.parse(value);
  return cadOverlayPayloadSchema.parse({...parsed,schemaVersion:'wfc.pf.cad-overlay-payload.v3',segments:parsed.segments.map(segment=>{
    const {independent:_historicalIsolation,...automatic}=segment;return automatic;
  })});
}

/** The published preparation plan records all catalog rows, including excluded trays. */
export async function readUnpreparedCadTrayExports(client: PoolClient, projectId: string, artifactId: string, modelVersionId: string): Promise<string[]> {
  const { rows } = await client.query<{ tray_id: string }>(
    `/* cad-unprepared-tray-exports */
     WITH prepared_scope AS MATERIALIZED (
       SELECT s.plan->'requestedScope' AS requested
       FROM pf_artifact_routing_scopes r
       JOIN pf_preparation_aggregates a ON a.project_id=r.project_id AND a.artifact_id=r.artifact_id
       JOIN pf_preparation_sessions s ON s.project_id=a.project_id AND s.id=a.session_id
       WHERE r.project_id=$1 AND r.artifact_id=$2 AND a.model_version_id=$3
         AND s.state='published' AND s.published_aggregate_id=a.id
         AND s.plan->>'orderedPlanSha256'=a.manifest->>'orderedPlanSha256'
         AND s.plan->'requestedScope'->>'scopeSha256'=a.manifest->>'orderedScopeSha256'
         AND s.plan->>'catalogRevision'=r.routing_scope->>'catalogRevision'
         AND s.plan->>'routingContentSha256'=r.routing_scope->>'routingContentSha256'
     ), prepared_trays AS (
       SELECT (tray->>'projectTrayId')::uuid AS id
       FROM prepared_scope CROSS JOIN LATERAL jsonb_array_elements(requested->'trays') AS tray
       UNION ALL
       SELECT id::uuid
       FROM prepared_scope CROSS JOIN LATERAL jsonb_array_elements_text(requested->'excludedProjectTrayIds') AS ids(id)
     )
     SELECT e.tray_id FROM cad_route_tray_exports e
     JOIN cad_route_groups g ON g.project_id=e.project_id AND g.design_id=e.design_id AND g.id=e.route_group_id
     JOIN cad_designs d ON d.project_id=g.project_id AND d.id=g.design_id
     WHERE e.project_id=$1 AND d.model_version_id=$3 AND d.status='proposed' AND g.status='draft'
       AND EXISTS (SELECT 1 FROM prepared_scope)
       AND NOT EXISTS (SELECT 1 FROM prepared_trays p WHERE p.id=e.tray_id)
     ORDER BY e.tray_id`,
    [projectId, artifactId, modelVersionId],
  );
  return rows.map(({ tray_id }) => tray_id);
}

/** Additive provenance: the old immutable artifact is never restamped with new tokens.
 * Every non-CAD catalog row must still have the exact originally prepared projection. */
export async function readCadOverlay(client: PoolClient, projectId: string, artifactId: string,
  snapshotSha256: string, modelVersionId: string, prepared: RoutingScope, current: RoutingScope, options: {lock?:boolean} = {}): Promise<CadOverlayEnvelope | 'base-catalog-proof' | null> {
  if (!cadDesignEnabled()) return null;
  const groups = await client.query<{status:string;project_tray_id:string|null;publication:unknown}>(
    `SELECT status,project_tray_id,publication FROM cad_route_groups WHERE project_id=$1 AND publication IS NOT NULL ORDER BY id${options.lock===false?'':' FOR SHARE'}`,[projectId]);
  const active=groups.rows.filter(row=>row.status==='published');
  const retired=groups.rows.filter(row=>row.status==='draft'&&(row.publication as {baseArtifactId?:string})?.baseArtifactId===artifactId);
  const hasPublications = active.length > 0 || retired.length > 0;
  if (!hasPublications && prepared.catalogRevision === current.catalogRevision &&
      prepared.routingContentSha256 === current.routingContentSha256) return null;
  const owned = active.map(row => row.project_tray_id!);
  // Exclude rows already proven to be additive by their verified publication.
  const additions=active.filter(row=>(row.publication as {trayInBaseCatalog?:boolean})?.trayInBaseCatalog!==true).map(row=>row.project_tray_id!);
  const actualTrays = (await client.query<{id:string;name:string;purpose:string|null;tray_type:string|null;width_mm:string|number|null;height_mm:string|number|null;length_mm:string|number|null}>(
    `SELECT id::text,name,purpose,tray_type,width_mm,height_mm,length_mm FROM trays WHERE project_id=$1 AND id=ANY($2::uuid[]) ORDER BY id${options.lock===false?'':' FOR SHARE'}`,[projectId,owned])).rows;
  for (const group of active) {
    const saved=(group.publication as {traySnapshot?:{id:string;name:string;purpose:string;trayType:string;widthMm:number;heightMm:number;lengthMm:number}})?.traySnapshot;
    const actual=actualTrays.find(row=>row.id===group.project_tray_id);
    if (!saved || !actual || saved.id!==actual.id || saved.name!==actual.name || saved.purpose!==actual.purpose || saved.trayType!==actual.tray_type ||
      saved.widthMm!==Number(actual.width_mm) || saved.heightMm!==Number(actual.height_mm) || saved.lengthMm!==Number(actual.length_mm))
      throw new PathFinderError('CAD_ROUTE_CATALOG_CHANGED',409,'A published CAD route catalog row changed. Withdraw and republish it before calculating.');
  }
  const source = await client.query<{id:string;name:string;purpose:string|null}>(
    'SELECT id::text,name,purpose FROM trays WHERE project_id=$1 AND NOT(id=ANY($2::uuid[])) ORDER BY id',[projectId,additions]);
  const catalogHash = (rows: typeof source.rows) => {
    const base = projectRoutingCatalogRows(rows);
    return digest(catalogRoutingHashInput(projectId, base.rows, base.diagnostics));
  };
  let baseHash = catalogHash(source.rows);
  let hasListAdditions = false;
  if (baseHash !== prepared.routingContentSha256) {
    const listOnly = new Set(await readUnpreparedCadTrayExports(client, projectId, artifactId, modelVersionId));
    if (listOnly.size) {
      baseHash = catalogHash(source.rows.filter(row => !listOnly.has(row.id)));
      hasListAdditions = baseHash === prepared.routingContentSha256;
    }
  }
  if (!hasPublications && !hasListAdditions) return null;
  if (prepared.routingPolicyRevision !== current.routingPolicyRevision || prepared.routingPolicySha256 !== current.routingPolicySha256 ||
      baseHash !== prepared.routingContentSha256)
    throw new PathFinderError('ROUTING_PREPARATION_REQUIRED',409,'The base network or routing permissions changed. Prepare the project network again.');
  const segments = [];
  for (const row of [...active,...retired]) {
    const publication = row.publication as {baseArtifactId?:string;overlay?:unknown};
    if (publication?.baseArtifactId !== artifactId) throw new PathFinderError('CAD_ROUTE_BASE_CHANGED',409,'Withdraw and republish CAD routes against the current prepared network.');
    const payload = automaticCadOverlayView(publication.overlay);
    if (payload.projectId!==projectId || payload.modelVersionId!==modelVersionId || payload.baseSnapshotSha256!==snapshotSha256)
      throw new PathFinderError('CAD_ROUTE_BASE_CHANGED',409);
    if(row.status==='published')segments.push(...payload.segments);
  }
  if(!segments.length)return 'base-catalog-proof';
  return encodeCadOverlay({schemaVersion:'wfc.pf.cad-overlay-payload.v3',projectId,modelVersionId,baseSnapshotSha256:snapshotSha256,segments});
}
