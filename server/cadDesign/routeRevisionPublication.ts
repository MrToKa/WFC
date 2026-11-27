import { routingTrayProfile } from './trayProfile.js';
import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { cadOverlayPayloadSchema, type CadOverlaySegment } from '../../shared/pathfinderCadOverlay.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { trayLengthCalculationSchema } from '../../shared/trayAutoLength.js';
import { requireAdmin } from '../middleware.js';
import type { TrayRow } from '../models/tray.js';
import { automaticCadOverlayView, encodeCadOverlay } from '../pathfinder/cadOverlay.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { markRecalculationDirty } from '../pathfinder/recalculationSchema.js';
import { requirePreparedRoutingScope } from '../pathfinder/routingScope.js';
import { recordTrayChanges } from '../services/trayChangeLogService.js';
import {
  cadRouteSegments, groupInputs, networkOptions, publicationTransaction, PublicationError, routePort,
} from './routePublication.js';
import {
  assertCadRouteRevisionHasNoExternalMates, CadRouteRevisionError, promoteCadRouteRevisionMembers,
} from './routeRevisionDraft.js';
import { cadTrayProjection, deriveCadTrayExport, readCadTrayExport } from './routeTrayExports.js';

export const cadRouteRevisionPublicationRouter = Router({ mergeParams: true });
const prefix = '/designs/:designId/routes/:routeId/revision';
const reviewInput = z.object({ expectedRevision: z.number().int().positive() }).strict();
const publishInput = reviewInput.extend({ reviewToken: z.string().regex(/^[a-f0-9]{64}$/) });
const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');

type SavedCable = {
  id: string;
  tag: string | null;
  routing: string | null;
  manual_protected?: boolean;
  execution_locked?: boolean;
};
type PublishedRoute = {
  baseArtifactId: string;
  overlay: unknown;
  attachments?: unknown[];
  trayInBaseCatalog?: boolean;
};

function geometryDigest(segments: CadOverlaySegment[]) {
  return digest(segments.map(segment => digest({
    name: segment.name,
    allowedCategoryMask: segment.allowedCategoryMask,
    path: [digest(segment.pointsMetres), digest([...segment.pointsMetres].reverse())].sort(),
    ports: segment.ports.map(port => digest(port)).sort(),
  })).sort());
}

export function reviewCadRouteCables(
  cables: SavedCable[], previous: CadOverlaySegment[], proposed: CadOverlaySegment[],
) {
  const changed = geometryDigest(previous) !== geometryDigest(proposed);
  return cables.map(cable => ({
    id: cable.id,
    tag: cable.tag || cable.id,
    needsRecalculation: changed,
    reason: !changed ? 'The published routing geometry is unchanged.'
      : cable.execution_locked ? 'This installed cable has a locked route. Review it against the new geometry.'
      : cable.manual_protected ? 'This saved manual route is protected. Recheck its length against the new geometry.'
      : 'The route geometry or connection points changed. Recalculate this saved cable route.',
  }));
}

function endpoint(work: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    void work(req, res).catch((error: unknown) => {
      if (error instanceof z.ZodError) {
        res.status(400).json({ code: 'INVALID_CAD_ROUTE_REVISION', message: 'Supply the current draft revision and, when publishing, its review token.' });
        return;
      }
      if (error instanceof PublicationError || error instanceof PathFinderError || error instanceof CadRouteRevisionError) {
        res.status(error.status).json({ code: error.code, message: error.message });
        return;
      }
      if (['23503', '23505', '23514', '40P01', '40001'].includes((error as { code?: string })?.code ?? '')) {
        res.status(409).json({ code: 'CAD_ROUTE_REVISION_CONFLICT', message: 'The design or its routing network changed. Review the revision again.' });
        return;
      }
      next(error);
    });
  };
}

async function readReview(client: PoolClient, req: Request, expectedRevision: number) {
  const { projectId, designId, routeId } = req.params;
  const { group: draft, chain, instances, transitions } = await groupInputs(client, projectId, designId, routeId);
  if (draft.status !== 'draft' || !draft.revision_of_route_id) {
    throw new PublicationError('CAD_ROUTE_REVISION_REQUIRED', 'Select an editable revision draft.');
  }
  if (draft.revision !== expectedRevision) {
    throw new PublicationError('STALE_CAD_ROUTE', 'The draft changed. Save it and review the revision again.');
  }
  const { group: parent } = await groupInputs(client, projectId, designId, draft.revision_of_route_id);
  const trayId = parent.project_tray_id;
  if (parent.status !== 'published' || !trayId || !parent.publication || parent.revision !== draft.revision_base_number) {
    throw new PublicationError('CAD_ROUTE_REVISION_BASE_CHANGED', 'The published route changed. Start a new revision from the current route.');
  }
  const previous = parent.publication as PublishedRoute;
  if (previous.attachments?.length) {
    throw new PublicationError('CAD_ROUTE_REVISION_ATTACHMENTS', 'This route has explicit network attachments that must be preserved. Revision editing is unavailable for this route.');
  }
  await assertCadRouteRevisionHasNoExternalMates(client, projectId, designId, parent.id);
  await assertCadRouteRevisionHasNoExternalMates(client, projectId, designId, draft.id);

  const model = (await client.query<{ model_version_id: string }>(
    'SELECT model_version_id FROM cad_designs WHERE project_id=$1 AND id=$2', [projectId, designId],
  )).rows[0];
  const { artifact, routing, segmentCount } = await networkOptions(client, projectId, model.model_version_id, false);
  if (previous.baseArtifactId !== artifact.id || !routing.cadOverlay) {
    throw new PublicationError('CAD_ROUTE_BASE_CHANGED', 'Refresh the published network before reviewing this revision.');
  }
  const publishedOverlay = automaticCadOverlayView(previous.overlay);
  const composite = cadOverlayPayloadSchema.parse(JSON.parse(Buffer.from(routing.cadOverlay.payloadBase64, 'base64').toString('utf8')));
  const oldIds = new Set(publishedOverlay.segments.map(segment => segment.id));
  const otherSegments = composite.segments.filter(segment => !oldIds.has(segment.id));
  if (composite.segments.length - otherSegments.length !== oldIds.size) {
    throw new PublicationError('CAD_ROUTE_BASE_CHANGED', 'The current network is missing segments from this published route.');
  }
  const proposed = cadRouteSegments(parent, chain);
  // Copy IDs can change CAD path enumeration even when every physical span and
  // port is identical. Keep the existing engine segments in that case.
  const segments = geometryDigest(publishedOverlay.segments) === geometryDigest(proposed)
    ? publishedOverlay.segments : proposed;
  const overlay = { ...publishedOverlay, segments };
  const verifiedOverlay = encodeCadOverlay({ ...composite, segments: [...otherSegments, ...segments] });

  const exported = await readCadTrayExport(client, projectId, designId, parent.id);
  const tray = exported?.row ?? (await client.query<TrayRow>(
    'SELECT * FROM trays WHERE project_id=$1 AND id=$2 FOR UPDATE', [projectId, trayId],
  )).rows[0];
  if (!tray || tray.id !== trayId) {
    throw new PublicationError('CAD_ROUTE_TRAY_EXPORT_INTEGRITY', 'The published route is missing its Trays record.');
  }
  const desired = deriveCadTrayExport(projectId, designId, parent, instances, chain, transitions);
  const { lengthMm } = desired.fields;
  const { trayType, widthMm, heightMm } = routingTrayProfile(desired.fields, exported);
  if (trayType !== tray.tray_type || widthMm !== Number(tray.width_mm) || heightMm !== Number(tray.height_mm)) {
    throw new PublicationError('CAD_ROUTE_REVISION_PROFILE_CHANGED', 'Keep the published tray profile when revising this route.');
  }
  const traySnapshot = { id: trayId, name: tray.name, purpose: tray.purpose, trayType, widthMm, heightMm, lengthMm };

  const { rows: savedCables } = await client.query<SavedCable>(
    `SELECT c.id,c.tag,c.routing,r.manual_protected,r.execution_locked,r.revision::text AS control_revision
     FROM cables c LEFT JOIN pf_cable_routing_controls r ON r.project_id=c.project_id AND r.cable_id=c.id
     WHERE c.project_id=$1 AND EXISTS (
       SELECT 1 FROM regexp_split_to_table(upper(concat_ws('/',c.routing,
         CASE WHEN r.manual_protected THEN r.manual_routing END,
         CASE WHEN r.execution_locked THEN r.execution_routing END)),'/') AS part(value)
       WHERE btrim(part.value)=$2
     ) ORDER BY c.id FOR SHARE OF c`, [projectId, parent.tag],
  );
  const cables = reviewCadRouteCables(savedCables, publishedOverlay.segments, segments);
  const reviewToken = digest({
    projectId, designId, artifactId: artifact.id, currentOverlay: routing.cadOverlay.sha256,
    parent: { id: parent.id, revision: parent.revision }, draft: { id: draft.id, revision: draft.revision },
    verifiedOverlay: verifiedOverlay.sha256, desired: desired.sourceSha256, tray: cadTrayProjection(tray), savedCables,
  });
  return {
    reviewToken, cables, parent, draft, tray, exported, traySnapshot, desired, overlay, verifiedOverlay,
    instances, transitions, chain, artifact, modelVersionId: model.model_version_id,
    previousOverlaySha256: routing.cadOverlay.sha256,
    expectedSegments: segmentCount + otherSegments.length + segments.length,
  };
}

cadRouteRevisionPublicationRouter.post(`${prefix}/preview`, requireAdmin, endpoint(async (req, res) => {
  const input = reviewInput.parse(req.body);
  const result = await publicationTransaction(req, client => readReview(client, req, input.expectedRevision));
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ reviewToken: result.reviewToken, cables: result.cables });
}));

cadRouteRevisionPublicationRouter.post(`${prefix}/publish`, requireAdmin, endpoint(async (req, res) => {
  const input = publishInput.parse(req.body);
  const check = async (client: PoolClient) => {
    const current = await readReview(client, req, input.expectedRevision);
    if (current.reviewToken !== input.reviewToken) {
      throw new PublicationError('CAD_ROUTE_REVISION_REVIEW_CHANGED', 'The draft, network or affected cables changed. Review the revision again.');
    }
    return current;
  };
  const candidate = await publicationTransaction(req, check);
  const { projectId, designId } = req.params;
  const { getPathFinderRuntime } = await import('../pathfinder/runtime.js');
  const proof = await getPathFinderRuntime().worker.executePreparation({
    schemaVersion: 'pathfinder.model.runner.v1',
    requestId: randomUUID(),
    operation: 'prepare',
    projectId,
    modelVersionId: candidate.modelVersionId,
    snapshotId: candidate.artifact.id,
    snapshotSha256: candidate.artifact.snapshot_sha256,
    cadOverlay: candidate.verifiedOverlay,
    timeoutMilliseconds: 120000,
  }, AbortSignal.timeout(125000));
  const prepared = proof.prepared as { segmentCount?: number } | undefined;
  if (proof.status !== 'prepared' || prepared?.segmentCount !== candidate.expectedSegments) {
    throw new PublicationError('CAD_ROUTE_ENGINE_PROOF_REQUIRED', 'The routing engine could not verify the revised network. The published route is still active.');
  }
  const result = await publicationTransaction(req, async client => {
    const current = await check(client);
    const { parent, draft, tray, exported, traySnapshot, desired, chain, transitions, instances, overlay, artifact, cables } = current;
    const revision = parent.revision + 1;
    const publishedAt = new Date().toISOString();
    const calculation = trayLengthCalculationSchema.parse({
      source: 'cad-route', designId, routeId: parent.id, routeRevision: revision,
      centerlineSha256: desired.centerlineSha256, lengthMm: traySnapshot.lengthMm,
      elementCount: desired.elementCount, calculatedAt: publishedAt,
    });
    const { rows: [updatedTray] } = await client.query<TrayRow>(
      `UPDATE trays SET length_mm=$3,length_source='auto',length_calculation=$4::jsonb,updated_at=now()
       WHERE project_id=$1 AND id=$2 RETURNING *`,
      [projectId, tray.id, traySnapshot.lengthMm, JSON.stringify(calculation)],
    );
    if (!updatedTray) {
      throw new PublicationError('CAD_ROUTE_TRAY_EXPORT_INTEGRITY', 'The published route is missing its Trays record.');
    }
    await recordTrayChanges(client, req.userId!, tray, updatedTray);
    if (exported) {
      await client.query(
        `UPDATE cad_route_tray_exports SET source_sha256=$4,source_proof=$5::jsonb,projection=$6::jsonb,updated_at=now()
         WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3`,
        [projectId, designId, parent.id, desired.sourceSha256,
          JSON.stringify({ source: desired.source, capturedRouteRevision: revision, calculatedAt: publishedAt }),
          JSON.stringify(cadTrayProjection(updatedTray))],
      );
    }
    const publication = {
      schemaVersion: 'wfc.cad.route-publication.v1', baseArtifactId: artifact.id, overlay, traySnapshot,
      trayInBaseCatalog: (parent.publication as PublishedRoute).trayInBaseCatalog === true,
      trayExportSourceSha256: exported ? desired.sourceSha256 : null, attachments: [],
      routingTransitions: transitions.map(link => ({
        id: link.id, kind: link.kind, sourceInstanceId: link.source_instance_id, sourcePortName: link.source_name,
        targetInstanceId: link.target_instance_id, targetPortName: link.target_name,
        pointsMetres: [
          routePort(chain.instances.get(link.source_instance_id)!, link.source_name).pointMetres,
          routePort(chain.instances.get(link.target_instance_id)!, link.target_name).pointMetres,
        ],
      })),
      mode: 'automatic', publishedAt,
      sources: instances.map(row => ({
        instanceId: row.id, instanceRevision: row.revision, catalogItemId: row.catalog_item_id,
        assetId: row.material_asset_id, sha256: row.source_sha256, lengthMm: row.cut_length_mm,
      })),
    };
    await promoteCadRouteRevisionMembers(client, projectId, designId, parent.id, draft.id);
    await client.query(`UPDATE cad_route_groups SET status='published',project_tray_id=$4,publication=$5::jsonb,
      revision=$6,color=COALESCE($7,color),updated_at=now() WHERE project_id=$1 AND design_id=$2 AND id=$3`,
      [projectId, designId, parent.id, tray.id, JSON.stringify(publication), revision, draft.color]);
    await client.query(`INSERT INTO cad_route_network_publication_history(id,project_id,design_id,route_group_id,previous_revision,
      base_artifact_id,previous_publication,publication,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
      [randomUUID(), projectId, designId, parent.id, parent.revision, artifact.id,
        JSON.stringify(parent.publication), JSON.stringify(publication), req.userId]);
    await requirePreparedRoutingScope(client, projectId, artifact.id);
    if (current.verifiedOverlay.sha256 !== current.previousOverlaySha256) {
      await markRecalculationDirty(client, {
        projectId, domain: 'geometry', reason: 'CAD_ROUTE_REVISION_PUBLISHED', sourceRevision: `${parent.id}:${revision}`,
      });
    }
    return { id: parent.id, status: 'published', revision, projectTrayId: tray.id, cables };
  });
  res.json(result);
}));
