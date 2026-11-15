import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { trayAutoLengthMeasurementSchema, type TrayAutoLengthMeasurement } from '../../shared/trayAutoLength.js';
import { preparationAggregateSchema, preparationPlanSchema, preparationPlanHashInput, preparationResolutionSchema } from '../../shared/pathfinderPreparation.js';
import { GEOMETRY_TRACE_DERIVATION, geometryObjectRevisionSchema, geometryObjectSummarySchema, geometryTraceManifestSchema, geometryTraceContentHashInput } from '../../shared/pathfinderGeometryTrace.js';
import { canonicalPurposeJson, normalizeCatalogKey, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { TrayAutoLengthError } from './trayAutoLengthErrors.js';
import { readCapturedTrayAutoLength } from './trayAutoLengthCaptureService.js';
export { TrayAutoLengthError } from './trayAutoLengthErrors.js';

type QueryClient = Pick<PoolClient, 'query'>;
type ScopeRow = {
  tray_name: string; active_model_version_id: string | null; selection_revision: string; content_fingerprint: string | null;
  model_state: string | null; model_health: string | null; current_aggregate_id: string | null; current_artifact_id: string | null;
  geometry_revision: string; resolution_revision: string; aggregate_id: string | null; aggregate_model_id: string | null;
  session_id: string | null; artifact_id: string | null; aggregate_geometry_revision: string | null;
  aggregate_manifest: unknown; plan: unknown; session_state: string | null; published_aggregate_id: string | null;
  artifact_model_id: string | null; snapshot_sha256: string | null; snapshot_bytes: string | null;
  trace_id: string | null; trace_model_id: string | null; trace_manifest: unknown; resolution: unknown; publication_proof: boolean;
};
const hash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const same = (left: unknown, right: unknown) => canonicalPurposeJson(left) === canonicalPurposeJson(right);
const prepareMessage = 'Prepare the routing network with centerline data in Path Finder, then try Auto-length again.';
const staleMessage = 'The model or tray assignment changed. Prepare the current routing network, then try Auto-length again.';
const invalidMessage = 'The saved tray centerline data is incomplete or invalid. Prepare the routing network again.';

const fail = (code: string, message = invalidMessage, status = 409): never => { throw new TrayAutoLengthError(code, message, status); };

/** Read the exact persisted Path Finder leaf polylines. The caller owns project
 * access; a write caller must keep its transaction open through the tray save.
 * No engine process, model load, graph connection or box approximation is used.
 */
export async function readCurrentTrayAutoLength(client: QueryClient, projectId: string, trayId: string): Promise<TrayAutoLengthMeasurement> {
  if (!policyUuidSchema.safeParse(projectId).success || !policyUuidSchema.safeParse(trayId).success)
    return fail('TRAY_AUTO_LENGTH_INVALID', invalidMessage, 400);
  const captured = await readCapturedTrayAutoLength(client, projectId, trayId);
  if (captured) return captured;
  const scopeRows = (await client.query<ScopeRow>(`/* tray-auto-length:publication */ SELECT tr.name AS tray_name,
    sel.active_model_version_id,sel.selection_revision::text,ver.content_fingerprint,ver.state AS model_state,ver.health AS model_health,
    p.current_aggregate_id,p.current_artifact_id,p.geometry_revision::text,p.resolution_revision::text,
    a.id AS aggregate_id,a.model_version_id AS aggregate_model_id,a.session_id,a.artifact_id,a.geometry_revision::text AS aggregate_geometry_revision,
    CASE WHEN octet_length(a.manifest::text)<=1048576 THEN a.manifest END AS aggregate_manifest,
    CASE WHEN octet_length(s.plan::text)<=16777216 THEN s.plan END AS plan,s.state AS session_state,s.published_aggregate_id,
    f.model_version_id AS artifact_model_id,f.snapshot_sha256,f.snapshot_bytes::text,
    t.id AS trace_id,t.model_version_id AS trace_model_id,
    CASE WHEN octet_length(t.manifest::text)<=262144 THEN t.manifest END AS trace_manifest,r.resolution,
    EXISTS(SELECT 1 FROM pf_preparation_commands command WHERE command.project_id=a.project_id AND command.kind='publish'
      AND command.receipt->>'sessionId'=a.session_id::text AND command.receipt->'aggregate'=a.manifest) AS publication_proof
    FROM trays tr LEFT JOIN project_model_selections sel ON sel.project_id=tr.project_id
    LEFT JOIN model_versions ver ON ver.project_id=sel.project_id AND ver.id=sel.active_model_version_id
    LEFT JOIN pf_project_preparations p ON p.project_id=tr.project_id
    LEFT JOIN pf_preparation_aggregates a ON a.project_id=p.project_id AND a.id=p.current_aggregate_id
    LEFT JOIN pf_preparation_sessions s ON s.project_id=a.project_id AND s.id=a.session_id
    LEFT JOIN pf_artifacts f ON f.project_id=a.project_id AND f.id=a.artifact_id
    LEFT JOIN pf_geometry_trace_sets t ON t.project_id=a.project_id AND t.aggregate_id=a.id AND t.derivation_version=$3
    LEFT JOIN pf_preparation_resolutions r ON r.project_id=tr.project_id AND r.project_tray_id=tr.id
    WHERE tr.project_id=$1 AND tr.id=$2 LIMIT 2`, [projectId, trayId, GEOMETRY_TRACE_DERIVATION])).rows;
  if (scopeRows.length !== 1) return fail('TRAY_AUTO_LENGTH_UNAVAILABLE', prepareMessage);
  const row = scopeRows[0];
  if (!row.current_aggregate_id || !row.active_model_version_id || !row.trace_id)
    return fail('TRAY_AUTO_LENGTH_UNAVAILABLE', prepareMessage);
  if (row.model_state !== 'ready' || row.model_health !== 'healthy') return fail('TRAY_AUTO_LENGTH_STALE', staleMessage);
  const parsedAggregate = preparationAggregateSchema.safeParse(row.aggregate_manifest), parsedPlan = preparationPlanSchema.safeParse(row.plan);
  const parsedTrace = geometryTraceManifestSchema.safeParse(row.trace_manifest);
  if (!parsedAggregate.success || !parsedPlan.success || !parsedTrace.success) return fail('TRAY_AUTO_LENGTH_INVALID');
  const aggregate = parsedAggregate.data, plan = parsedPlan.data, trace = parsedTrace.data;
  if (aggregate.modelVersionId !== row.active_model_version_id || aggregate.selectionRevision !== row.selection_revision
    || aggregate.contentFingerprint !== row.content_fingerprint) return fail('TRAY_AUTO_LENGTH_STALE', staleMessage);
  if (aggregate.projectId !== projectId || aggregate.id !== row.current_aggregate_id || aggregate.id !== row.aggregate_id
    || aggregate.modelVersionId !== row.aggregate_model_id || aggregate.sessionId !== row.session_id || aggregate.artifactId !== row.artifact_id
    || aggregate.artifactId !== row.current_artifact_id || aggregate.geometryRevision !== row.geometry_revision
    || aggregate.geometryRevision !== row.aggregate_geometry_revision || row.session_state !== 'published'
    || row.published_aggregate_id !== aggregate.id || !row.publication_proof || row.artifact_model_id !== aggregate.modelVersionId
    || row.snapshot_sha256 !== aggregate.projection.sha256 || row.snapshot_bytes !== String(aggregate.projection.bytes)
    || plan.projectId !== projectId || plan.id !== aggregate.sessionId || plan.orderedPlanSha256 !== aggregate.orderedPlanSha256
    || plan.orderedPlanSha256 !== hash(preparationPlanHashInput(plan)) || plan.diagnostics.length
    || aggregate.orderedScopeSha256 !== plan.requestedScope.scopeSha256) return fail('TRAY_AUTO_LENGTH_INVALID');
  const { scopeSha256: _scopeHash, ...requestedScope } = plan.requestedScope;
  if (hash(requestedScope) !== plan.requestedScope.scopeSha256) return fail('TRAY_AUTO_LENGTH_INVALID');
  for (const key of ['modelVersionId', 'contentFingerprint', 'selectionRevision', 'catalogRevision', 'routingContentSha256', 'routingPolicyRevision', 'routingPolicySha256', 'resolutionRevision'] as const)
    if (aggregate[key] !== plan[key]) return fail('TRAY_AUTO_LENGTH_INVALID');
  if (trace.id !== row.trace_id || trace.projectId !== projectId || trace.aggregateId !== aggregate.id
    || trace.modelVersionId !== aggregate.modelVersionId || row.trace_model_id !== aggregate.modelVersionId
    || trace.geometryRevision !== aggregate.geometryRevision || trace.sessionId !== aggregate.sessionId
    || trace.captureFrameId !== aggregate.coordinateFrameId || !same(trace.projection, {
      payloadRef: aggregate.projection.payloadRef, sha256: aggregate.projection.sha256, bytes: aggregate.projection.bytes,
    })
    || trace.counts.segments !== aggregate.counts.physicalLeaves || trace.counts.objects !== aggregate.counts.objects
    || trace.contentSha256 !== hash(geometryTraceContentHashInput(trace))) return fail('TRAY_AUTO_LENGTH_INVALID');

  const target = plan.requestedScope.trays.find(tray => tray.projectTrayId === trayId);
  if (!target || !target.orderedRootObjectIds.length) return fail('TRAY_AUTO_LENGTH_UNAVAILABLE', prepareMessage);
  if (normalizeCatalogKey(row.tray_name) !== normalizeCatalogKey(target.rawName)) return fail('TRAY_AUTO_LENGTH_STALE', staleMessage);
  if (row.resolution !== null && row.resolution !== undefined) {
    const parsed = preparationResolutionSchema.safeParse(row.resolution);
    if (!parsed.success) return fail('TRAY_AUTO_LENGTH_INVALID');
    const resolution = parsed.data;
    if (resolution.projectTrayId !== trayId || resolution.mode !== 'roots' || resolution.scope.modelVersionId !== aggregate.modelVersionId
      || resolution.scope.contentFingerprint !== aggregate.contentFingerprint || resolution.scope.selectionRevision !== aggregate.selectionRevision
      || !same([...resolution.rootObjectIds].sort(), [...target.orderedRootObjectIds].sort())) return fail('TRAY_AUTO_LENGTH_STALE', staleMessage);
  } else if (target.ownershipDecisionId !== null) return fail('TRAY_AUTO_LENGTH_STALE', staleMessage);

  const planned = new Map<string, { rootObjectId: string; routeName: string }>(), allLeaves = new Set<string>(), usedRoots = new Set<string>();
  const manifest = new Map(plan.objectManifest.map(object => [object.objectId, object]));
  for (const part of plan.partPlan) for (const object of part.objects) {
    const id = 'dbid:' + object.objectId;
    if (allLeaves.has(id)) return fail('TRAY_AUTO_LENGTH_INVALID');
    allLeaves.add(id);
    if (object.projectTrayId !== trayId) continue;
    const rootObjectId = 'dbid:' + object.rootObjectId, leaf = manifest.get(id);
    if (!leaf?.hasGeometry || !leaf.isPhysicalLeaf || !target.orderedRootObjectIds.includes(rootObjectId) || object.routeName !== target.routeName)
      return fail('TRAY_AUTO_LENGTH_INVALID');
    const seen = new Set<string>(); let ancestor: string | null = id;
    while (ancestor !== rootObjectId) {
      if (ancestor === null || seen.has(ancestor) || seen.size >= 512 || !manifest.has(ancestor)) return fail('TRAY_AUTO_LENGTH_INVALID');
      seen.add(ancestor); ancestor = manifest.get(ancestor)!.parentId;
    }
    planned.set(id, { rootObjectId, routeName: object.routeName }); usedRoots.add(rootObjectId);
  }
  if (allLeaves.size !== aggregate.counts.physicalLeaves || allLeaves.size !== plan.requestedScope.orderedPhysicalLeafIds.length
    || plan.requestedScope.orderedPhysicalLeafIds.some(id => !allLeaves.has(id))) return fail('TRAY_AUTO_LENGTH_INVALID');
  if (!planned.size || usedRoots.size !== target.orderedRootObjectIds.length) return fail('TRAY_AUTO_LENGTH_UNAVAILABLE', prepareMessage);
  const rows = (await client.query<{ object_id: string; record: unknown; summary: unknown }>(`/* tray-auto-length:leaves */ SELECT object_id,
    CASE WHEN octet_length(record::text)<=524288 THEN record END AS record,summary
    FROM pf_geometry_object_revisions WHERE project_id=$1 AND trace_id=$2 AND project_tray_id=$3
    ORDER BY order_index LIMIT $4`, [projectId, trace.id, trayId, planned.size + 1])).rows;
  if (rows.length !== planned.size) return fail('TRAY_AUTO_LENGTH_INVALID');
  const seen = new Set<string>(); let metres = 0, points = 0;
  for (const source of rows) {
    const parsedRecord = geometryObjectRevisionSchema.safeParse(source.record), parsedSummary = geometryObjectSummarySchema.safeParse(source.summary);
    if (!parsedRecord.success || !parsedSummary.success) return fail('TRAY_AUTO_LENGTH_INVALID');
    const record = parsedRecord.data, summary = parsedSummary.data, expected = planned.get(source.object_id), fitted = record.geometry.fitted;
    if (!expected || seen.has(source.object_id) || record.identity.objectId !== source.object_id || record.projectId !== projectId
      || record.traceId !== trace.id || record.aggregateId !== aggregate.id || record.modelVersionId !== aggregate.modelVersionId
      || record.catalog.projectTrayId !== trayId || record.catalog.rootObjectId !== expected.rootObjectId
      || record.geometry.role !== 'routing-leaf' || !fitted || fitted.objectId !== source.object_id || fitted.routeCode !== expected.routeName
      || summary.id !== record.id || summary.objectId !== source.object_id || summary.projectTrayId !== trayId
      || summary.geometryRole !== 'routing-leaf' || summary.geometricLengthMetres !== fitted.geometricLengthMetres
      || summary.recordSha256 !== hash(record) || record.provenance.sessionId !== aggregate.sessionId
      || record.provenance.projectionSha256 !== aggregate.projection.sha256 || record.provenance.contentFingerprint !== aggregate.contentFingerprint
      || !same(record.geometry.mesh.projection, trace.projection)) return fail('TRAY_AUTO_LENGTH_INVALID');
    seen.add(source.object_id); points += fitted.pointsMetres.length;
    if (points > 5_000_000) return fail('TRAY_AUTO_LENGTH_LIMIT', 'This tray contains too much centerline data for Auto-length.', 413);
    let measured = 0;
    for (let index = 1; index < fitted.pointsMetres.length; index++)
      measured += Math.hypot(...fitted.pointsMetres[index].map((value, axis) => value - fitted.pointsMetres[index - 1][axis]));
    if (!Number.isFinite(measured) || Math.abs(measured - fitted.geometricLengthMetres) > Math.max(1e-9, measured * 1e-12))
      return fail('TRAY_AUTO_LENGTH_INVALID');
    // Each source leaf is already a complete independent polyline. Never add
    // distance from one leaf to another, endpoint allowances or graph links.
    metres += fitted.geometricLengthMetres;
  }
  const lengthMm = Math.round(metres * 1_000_000) / 1000;
  if (!Number.isFinite(lengthMm) || lengthMm < 0 || lengthMm > 1_000_000)
    return fail('TRAY_AUTO_LENGTH_LIMIT', 'The calculated length exceeds the supported tray length.', 413);

  // A write transaction retains these latches until COMMIT. Match preparation's
  // model-selection/model-version -> preparation-state order; do not lock trays
  // or catalogue policy rows here. Pool-based previews are rechecked on Save.
  const model = (await client.query<{ active_model_version_id: string; selection_revision: string; content_fingerprint: string; state: string; health: string }>(`/* tray-auto-length:model-fence */
    SELECT sel.active_model_version_id,sel.selection_revision::text,ver.content_fingerprint,ver.state,ver.health
    FROM project_model_selections sel JOIN model_versions ver ON ver.project_id=sel.project_id AND ver.id=sel.active_model_version_id
    WHERE sel.project_id=$1 FOR SHARE OF sel,ver`, [projectId])).rows[0];
  const preparation = (await client.query<{ current_aggregate_id: string; current_artifact_id: string; geometry_revision: string; resolution_revision: string }>(`/* tray-auto-length:preparation-fence */
    SELECT current_aggregate_id,current_artifact_id,geometry_revision::text,resolution_revision::text
    FROM pf_project_preparations WHERE project_id=$1 FOR SHARE`, [projectId])).rows[0];
  if (!model || model.active_model_version_id !== aggregate.modelVersionId || model.selection_revision !== aggregate.selectionRevision
    || model.content_fingerprint !== aggregate.contentFingerprint || model.state !== 'ready' || model.health !== 'healthy'
    || !preparation || preparation.current_aggregate_id !== aggregate.id || preparation.current_artifact_id !== aggregate.artifactId
    || preparation.geometry_revision !== aggregate.geometryRevision || preparation.resolution_revision !== row.resolution_revision)
    return fail('TRAY_AUTO_LENGTH_STALE', staleMessage);
  return trayAutoLengthMeasurementSchema.parse({ lengthMm, elementCount: seen.size, modelVersionId: aggregate.modelVersionId,
    geometryRevision: aggregate.geometryRevision, aggregateId: aggregate.id, traceId: trace.id });
}
