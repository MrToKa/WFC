import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware.js';
import { principalTransaction, requestPrincipal } from '../pathfinder/auth.js';
import type { JobPrincipal } from '../pathfinder/jobContracts.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { readRoutingPolicyScope } from '../pathfinder/purposePolicy.js';
import { equalRoutingScope, requirePreparedRoutingScope, routingScopeSchema } from '../pathfinder/routingScope.js';
import { encodeCadOverlay } from '../pathfinder/cadOverlay.js';
import { markRecalculationDirty } from '../pathfinder/recalculationSchema.js';
import { preparationAggregateSchema } from '../../shared/pathfinderPreparation.js';
import { GEOMETRY_TRACE_DERIVATION, geometryTraceManifestSchema } from '../../shared/pathfinderGeometryTrace.js';
import { cadOverlayPayloadSchema } from '../../shared/pathfinderCadOverlay.js';
import { canonicalPurposeJson, normalizeCatalogKey } from '../../shared/pathfinderPurposePolicy.js';
import { groupInputs, resolveCadRouteMaterial, cadRouteSegments, PublicationError } from './routePublication.js';
import { cadTrayProjection, compatibleCadTrayExport } from './routeTrayExports.js';
import type { PublicationInstance } from './routePublication.js';
import type { TrayRow } from '../models/tray.js';

const uuid = z.string().uuid();
export const cadNetworkPreparationInputSchema = z.object({
  expectedArtifactId: uuid,
  expectedSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type Input = z.infer<typeof cadNetworkPreparationInputSchema>;
const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const refuse = (code: string, message: string): never => { throw new PathFinderError(code, 409, message); };

// PostgreSQL row timestamps are Date objects and are not computational source facts.
// Hash only the geometry/material fields consumed by CAD preparation.
const sourceInstance = (row: PublicationInstance) => ({
  id:row.id,catalogItemId:row.catalog_item_id,assetId:row.material_asset_id,revision:row.revision,
  partNumber:row.part_number,materialTrayId:row.material_tray_id ?? null,materialTrayType:row.material_tray_type ?? null,
  widthMm:row.material_width_mm ?? null,heightMm:row.material_height_mm ?? null,originalFilename:row.original_filename,
  sourceSha256:row.source_sha256,componentKind:row.component_kind,lengthMm:row.cut_length_mm,
  positionMm:[row.x_mm,row.y_mm,row.z_mm],rotation:[row.qx,row.qy,row.qz,row.qw],
});

async function freeze(client: PoolClient, projectId: string, designId: string, input: Input) {
  const model = (await client.query<{model_version_id:string;selection_revision:string;content_fingerprint:string}>(
    `/* cad-network-design */ SELECT d.model_version_id,s.selection_revision::text,v.content_fingerprint FROM cad_designs d
      JOIN project_model_selections s ON s.project_id=d.project_id AND s.active_model_version_id=d.model_version_id
      JOIN model_versions v ON v.project_id=d.project_id AND v.id=d.model_version_id
      WHERE d.project_id=$1 AND d.id=$2 AND d.status='proposed' AND v.state='ready' AND v.health='healthy'
      FOR UPDATE OF d FOR SHARE OF s,v`, [projectId,designId])).rows[0];
  if (!model) return refuse('INACTIVE_DESIGN', 'Select the active healthy saved design before preparing its routes.');
  const base = (await client.query<{id:string;snapshot_sha256:string;model_version_id:string;manifest:unknown;routing_scope:unknown;producer_version:string;resolution_revision:string;geometry_revision:string}>(
    `/* cad-network-base */ SELECT a.id,a.snapshot_sha256,a.model_version_id,g.manifest,r.routing_scope,r.producer_version,p.resolution_revision::text,p.geometry_revision::text
      FROM pf_project_preparations p JOIN pf_preparation_aggregates g ON g.project_id=p.project_id AND g.id=p.current_aggregate_id
      JOIN pf_artifacts a ON a.project_id=p.project_id AND a.id=p.current_artifact_id AND a.id=g.artifact_id
      JOIN pf_artifact_routing_scopes r ON r.project_id=a.project_id AND r.artifact_id=a.id
      WHERE p.project_id=$1 FOR SHARE OF p,g,a,r`, [projectId])).rows[0];
  if (!base || base.id !== input.expectedArtifactId || base.snapshot_sha256 !== input.expectedSnapshotSha256
    || base.model_version_id !== model.model_version_id)
    return refuse('CAD_ROUTE_BASE_CHANGED', 'The prepared network changed. Generate the current network before preparing its saved routes.');
  const aggregate = preparationAggregateSchema.parse(base.manifest);
  const current = routingScopeSchema.parse(await readRoutingPolicyScope(client, projectId));
  const prepared = routingScopeSchema.parse(base.routing_scope);
  if (base.producer_version !== 'pathfinder.catalog-preparation.v1' || prepared.cadOverlay
    || !equalRoutingScope(current, prepared) || aggregate.projectId !== projectId || aggregate.artifactId !== base.id
    || aggregate.modelVersionId !== model.model_version_id || aggregate.selectionRevision !== model.selection_revision
    || aggregate.resolutionRevision !== base.resolution_revision
    || aggregate.geometryRevision !== base.geometry_revision
    || aggregate.contentFingerprint !== model.content_fingerprint || aggregate.projection.sha256 !== base.snapshot_sha256
    || aggregate.catalogRevision !== current.catalogRevision || aggregate.routingContentSha256 !== current.routingContentSha256
    || aggregate.routingPolicyRevision !== current.routingPolicyRevision || aggregate.routingPolicySha256 !== current.routingPolicySha256)
    return refuse('ROUTING_PREPARATION_REQUIRED', 'Generate the current project network before preparing its saved CAD routes.');
  const traceRow = (await client.query<{id:string;manifest:unknown}>(
    `/* cad-network-trace */ SELECT id,manifest FROM pf_geometry_trace_sets WHERE project_id=$1 AND aggregate_id=$2
      AND derivation_version=$3 ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE`, [projectId,aggregate.id,GEOMETRY_TRACE_DERIVATION])).rows[0];
  const trace = geometryTraceManifestSchema.safeParse(traceRow?.manifest);
  if (!trace.success || trace.data.id !== traceRow?.id || trace.data.projectId !== projectId
    || trace.data.aggregateId !== aggregate.id || trace.data.modelVersionId !== model.model_version_id
    || trace.data.sessionId !== aggregate.sessionId || trace.data.geometryRevision !== aggregate.geometryRevision
    || trace.data.captureFrameId !== aggregate.coordinateFrameId || trace.data.projection.payloadRef !== aggregate.projection.payloadRef
    || trace.data.projection.sha256 !== aggregate.projection.sha256 || trace.data.projection.bytes !== aggregate.projection.bytes
    || trace.data.derivationVersion !== GEOMETRY_TRACE_DERIVATION || trace.data.counts.objects !== aggregate.counts.objects
    || trace.data.counts.segments !== aggregate.counts.physicalLeaves)
    return refuse('CAD_ROUTE_NETWORK_TRACE_REQUIRED', 'Finish the current network geometry trace before preparing its saved CAD routes.');
  const listed = (await client.query<{id:string;status:string;publication:unknown;exported_tray_id:string|null}>(
    `/* cad-network-groups */ SELECT g.id,g.status,g.publication,e.tray_id AS exported_tray_id FROM cad_route_groups g
      LEFT JOIN cad_route_tray_exports e ON e.project_id=g.project_id AND e.design_id=g.design_id AND e.route_group_id=g.id
      WHERE g.project_id=$1 AND g.design_id=$2 AND (g.status='published' OR e.tray_id IS NOT NULL)
      ORDER BY g.id LIMIT 1001 FOR UPDATE OF g`, [projectId,designId])).rows;
  if (listed.length > 1000) return refuse('CAD_ROUTE_GROUP_LIMIT', 'The saved CAD route list is too large to prepare in one network.');
  const routes = [];
  for (const row of listed) {
    const source = await groupInputs(client, projectId, designId, row.id);
    const {group,instances,chain,transitions} = source;
    if (group.status !== row.status || !['draft','published'].includes(group.status))
      return refuse('CAD_ROUTE_CHANGED_DURING_PROOF', 'The saved CAD routes changed. Refresh and generate the network again.');
    if (group.status === 'published' && (group.publication as {mode?:string})?.mode !== 'automatic')
      return refuse('CAD_ROUTE_REPREPARATION_UNSUPPORTED', 'This historical CAD route needs an explicit current publication before network regeneration.');
    const rule = (await client.query<{allowed_categories:string[]}>(
      `/* cad-network-purpose */ SELECT r.allowed_categories FROM pf_routing_purpose_rules r JOIN pf_catalog_purpose_incarnations i
        ON i.project_id=r.project_id AND i.purpose_key=r.purpose_key AND i.incarnation_id=r.purpose_incarnation_id
        WHERE r.project_id=$1 AND r.purpose_key=$2 AND i.active AND i.row_count>0`, [projectId,normalizeCatalogKey(group.purpose)])).rows[0];
    if (rule && Array.isArray(rule.allowed_categories) && rule.allowed_categories.length === 0) {
      if (group.status === 'draft') continue;
      return refuse('CAD_ROUTE_PURPOSE_EXCLUDED', 'A published CAD route is excluded by its routing permissions. Reconcile its publication before regenerating the network.');
    }
    if (!rule || !Array.isArray(rule.allowed_categories) || !rule.allowed_categories.length)
      return refuse('CAD_ROUTE_PURPOSE_REQUIRED', 'Configure routing permissions for every saved CAD route before generating its network.');
    const exported = await compatibleCadTrayExport(client,projectId,designId,group,instances,chain,transitions);
    if (group.status === 'draft' && (!exported || exported.row.id !== row.exported_tray_id))
      return refuse('CAD_ROUTE_TRAY_EXPORT_INTEGRITY', 'The saved CAD route needs its exact Trays list link before network generation.');
    if (exported && normalizeCatalogKey(group.name).replace(/^\/+|\/+$/g, '').trim().toUpperCase() !== group.tag)
      return refuse('CAD_ROUTE_TRAY_NAME_TAG_MISMATCH', 'Use one route identifier and refresh its Trays list row before network generation.');
    const material = resolveCadRouteMaterial(instances);
    const trayId = exported?.row.id ?? group.project_tray_id;
    if (!trayId) return refuse('CAD_ROUTE_TRAY_EXPORT_INTEGRITY', 'A saved CAD route has no verified Trays list row.');
    if (group.status === 'published' && group.project_tray_id !== trayId)
      return refuse('CAD_ROUTE_TRAY_EXPORT_INTEGRITY', 'The published CAD route and saved Trays link refer to different rows.');
    const tray = exported?.row ?? (await client.query<TrayRow>(
      '/* cad-network-tray */ SELECT * FROM trays WHERE project_id=$1 AND id=$2 FOR SHARE', [projectId,trayId])).rows[0];
    const traySnapshot = {id:trayId,name:exported?.row.name ?? group.tag,purpose:exported?.row.purpose ?? normalizeCatalogKey(group.purpose),
      ...material,lengthMm:chain.lengthMetres*1000};
    if (!tray || tray.name !== traySnapshot.name || tray.purpose !== traySnapshot.purpose || tray.tray_type !== traySnapshot.trayType
      || Number(tray.width_mm) !== traySnapshot.widthMm || Number(tray.height_mm) !== traySnapshot.heightMm || Number(tray.length_mm) !== traySnapshot.lengthMm
      || group.status === 'published' && digest((group.publication as {traySnapshot?:unknown})?.traySnapshot ?? null) !== digest(traySnapshot))
      return refuse('CAD_ROUTE_CATALOG_CHANGED', 'The CAD route and its Trays row differ. Refresh the saved route values before generating its network.');
    const overlay = cadOverlayPayloadSchema.parse({schemaVersion:'wfc.pf.cad-overlay-payload.v3',projectId,
      modelVersionId:model.model_version_id,baseSnapshotSha256:base.snapshot_sha256,segments:cadRouteSegments(group,chain)});
    const sourceSha256 = digest({identity:{id:group.id,name:group.name,tag:group.tag,purpose:group.purpose},instances:instances.map(sourceInstance),
      chain:{points:chain.points,endpoints:chain.endpoints,lengthMetres:chain.lengthMetres,...(chain.paths?{paths:chain.paths}:{})},transitions,material,
      tray:cadTrayProjection(tray),exportSourceSha256:exported?.sourceSha256 ?? null});
    const previous = group.publication as {baseArtifactId?:string;overlay?:unknown;networkPreparationSourceSha256?:string} | null;
    const unchanged = group.status === 'published' && previous?.baseArtifactId === base.id
      && previous.networkPreparationSourceSha256 === sourceSha256 && digest(previous.overlay) === digest(overlay);
    routes.push({group,instances,transitions,traySnapshot,trayId,overlay,sourceSha256,unchanged,exported});
    if (routes.length > 32) return refuse('CAD_OVERLAY_LIMIT', 'A calculation network can include at most 32 saved CAD routes.');
  }
  const overlay = routes.length ? encodeCadOverlay({schemaVersion:'wfc.pf.cad-overlay-payload.v3',projectId,
    modelVersionId:model.model_version_id,baseSnapshotSha256:base.snapshot_sha256,segments:routes.flatMap(route => route.overlay.segments)}) : null;
  const fingerprint = digest({model,aggregate,trace:trace.data,prepared,current,
    routes:routes.map(({group,sourceSha256,traySnapshot,overlay}) => ({group:{id:group.id,name:group.name,tag:group.tag,purpose:group.purpose,status:group.status,
      revision:group.revision,projectTrayId:group.project_tray_id,publication:group.publication},sourceSha256,traySnapshot,overlay}))});
  return {base,model,aggregate,trace:trace.data,routes,overlay,fingerprint,duplicate:routes.every(route => route.unchanged)};
}

/** Revalidate all assigned saved CAD routes as one exact composite, without holding locks during the worker. */
export async function prepareCadDesignNetwork(projectId: string, designId: string, who: JobPrincipal, input: Input) {
  const transaction = <T,>(work: (client: PoolClient) => Promise<T>) => principalTransaction(pool,projectId,who,work);
  const frozen = await transaction(client => freeze(client,projectId,designId,input));
  const response = (publishedCount:number,revalidatedCount:number,duplicate:boolean) => ({artifactId:frozen.base.id,
    snapshotSha256:frozen.base.snapshot_sha256,publishedCount,revalidatedCount,routeCount:frozen.routes.length,duplicate});
  if (frozen.duplicate) {
    await transaction(async client => { const checked = await freeze(client,projectId,designId,input);
      if (checked.fingerprint !== frozen.fingerprint) return refuse('CAD_ROUTE_CHANGED_DURING_PROOF', 'The saved network changed while checking its CAD routes.');
      await requirePreparedRoutingScope(client,projectId,frozen.base.id); });
    return response(0,0,true);
  }
  const requestId = randomUUID();
  const {getPathFinderRuntime} = await import('../pathfinder/runtime.js');
  const proof = await getPathFinderRuntime().worker.executePreparation({schemaVersion:'pathfinder.model.runner.v1',requestId,
    operation:'prepare',projectId,modelVersionId:frozen.model.model_version_id,snapshotId:frozen.base.id,
    snapshotSha256:frozen.base.snapshot_sha256,cadOverlay:frozen.overlay!,timeoutMilliseconds:120000},AbortSignal.timeout(125000));
  const verified = z.object({requestId:uuid,status:z.literal('prepared'),model:z.object({projectId:uuid,modelVersionId:uuid,
    contentSha256:z.string()}),prepared:z.object({segmentCount:z.number().int().nonnegative(),key:z.string()})}).passthrough().safeParse(proof);
  if (!verified.success || verified.data.requestId !== requestId || verified.data.model.projectId !== projectId
    || verified.data.model.modelVersionId !== frozen.model.model_version_id || verified.data.model.contentSha256 !== frozen.model.content_fingerprint
    || verified.data.prepared.segmentCount !== frozen.aggregate.counts.physicalLeaves + frozen.routes.reduce((sum,route)=>sum+route.overlay.segments.length,0))
    return refuse('CAD_ROUTE_ENGINE_PROOF_REQUIRED', 'The routing engine could not verify the complete saved CAD network. No CAD routes were published.');
  return transaction(async client => {
    const current = await freeze(client,projectId,designId,input);
    if (current.fingerprint !== frozen.fingerprint)
      return refuse('CAD_ROUTE_CHANGED_DURING_PROOF', 'The saved CAD routes or base network changed during verification. Generate the network again.');
    const verifiedAt = new Date().toISOString();
    for (const route of current.routes) {
      const publication = {schemaVersion:'wfc.cad.route-publication.v1',baseArtifactId:current.base.id,overlay:route.overlay,
        traySnapshot:route.traySnapshot,trayInBaseCatalog:true,trayExportSourceSha256:route.exported?.sourceSha256 ?? null,
        attachments:[],routingTransitions:route.transitions,mode:'automatic',
        sources:route.instances.map(row => ({instanceId:row.id,instanceRevision:row.revision,catalogItemId:row.catalog_item_id,
          assetId:row.material_asset_id,sha256:row.source_sha256,lengthMm:row.cut_length_mm})),
        networkPreparationSourceSha256:route.sourceSha256,networkPreparationProof:{requestId,preparedKey:verified.data.prepared.key,
          segmentCount:verified.data.prepared.segmentCount,verifiedAt},publishedAt:verifiedAt};
      await client.query(`INSERT INTO cad_route_network_publication_history(id,project_id,design_id,route_group_id,previous_revision,
        base_artifact_id,previous_publication,publication,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
      [randomUUID(),projectId,designId,route.group.id,route.group.revision,current.base.id,
        route.group.publication === null ? null : JSON.stringify(route.group.publication),JSON.stringify(publication),who.userId]);
      const updated = await client.query(`UPDATE cad_route_groups SET status='published',project_tray_id=$4,publication=$5::jsonb,
        revision=revision+1,updated_at=now() WHERE project_id=$1 AND design_id=$2 AND id=$3 AND revision=$6 RETURNING id`,
      [projectId,designId,route.group.id,route.trayId,JSON.stringify(publication),route.group.revision]);
      if (updated.rows.length !== 1) return refuse('CAD_ROUTE_CHANGED_DURING_PROOF', 'A saved CAD route changed during publication.');
    }
    await requirePreparedRoutingScope(client,projectId,current.base.id);
    await markRecalculationDirty(client,{projectId,domain:'geometry',reason:'CAD_NETWORK_PREPARED',sourceRevision:digest({artifactId:current.base.id,overlay:current.overlay})});
    return response(current.routes.filter(route => route.group.status === 'draft').length,
      current.routes.filter(route => route.group.status === 'published').length,false);
  });
}

export const cadNetworkPreparationRouter = Router({mergeParams:true});
cadNetworkPreparationRouter.post('/designs/:designId/prepare-network',requireAdmin,(req:Request,res:Response,next:NextFunction):void => {
  const parsed = cadNetworkPreparationInputSchema.safeParse(req.body);
  if (!parsed.success || !uuid.safeParse(req.params.projectId).success || !uuid.safeParse(req.params.designId).success) {
    res.status(400).json({code:'INVALID_CAD_NETWORK_PREPARATION',message:'Use the current saved network artifact and snapshot.'}); return;
  }
  void prepareCadDesignNetwork(req.params.projectId,req.params.designId,requestPrincipal(req),parsed.data).then(result => {
    res.setHeader('Cache-Control','private, no-store');res.json(result);
  }).catch((error:unknown) => {
    if (error instanceof PathFinderError || error instanceof PublicationError) { res.status(error.status).json({code:error.code,message:error.message}); return; }
    if (['23503','23505','23514','40P01','40001'].includes((error as {code?:string})?.code ?? '')) {
      res.status(409).json({code:'CAD_NETWORK_PREPARATION_CONFLICT',message:'The saved CAD design changed. Refresh and regenerate its network.'}); return;
    }
    next(error);
  });
});
