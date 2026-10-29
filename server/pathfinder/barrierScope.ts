import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { barrierCanonicalJson, barrierModelScopeSchema, type BarrierModelScope } from '../../shared/pathfinderBarriers.js';
import { GEOMETRY_TRACE_LIMITS, geometryObjectRevisionSchema, geometryTraceManifestSchema } from '../../shared/pathfinderGeometryTrace.js';
import { preparationAggregateSchema } from '../../shared/pathfinderPreparation.js';
import { PathFinderError } from './errors.js';

const hash = (value: unknown) => createHash('sha256').update(barrierCanonicalJson(value)).digest('hex');
const coordinate = z.number().finite().min(-1e9).max(1e9);
export const barrierFrameProjectionSchema = z.object({
  coordinateFrame: z.literal('canonical-world-metres'),
  displayToWorldMetres: z.array(coordinate).length(16).refine(value => value[3] === 0 && value[7] === 0 && value[11] === 0 && value[15] === 1
    && value[0] * (value[5] * value[10] - value[9] * value[6]) - value[4] * (value[1] * value[10] - value[9] * value[2])
      + value[8] * (value[1] * value[6] - value[5] * value[2]) !== 0),
  globalOffsetMetres: z.tuple([coordinate, coordinate, coordinate]),
}).strict();
export const barrierFrameProjectionHash = (value: unknown) => hash(barrierFrameProjectionSchema.parse(value));
const unavailable = (): never => { throw new PathFinderError('BARRIER_CURRENT_FRAME_UNAVAILABLE', 409, 'Prepare a current model with consistent coordinate-frame evidence before capturing barriers.'); };

/** Called under the registry's project/admin/login transaction. Current selection,
 * aggregate and trace rows remain locked through publication. No caller-supplied frame authority. */
export async function currentBarrierScope(client: PoolClient, projectId: string): Promise<BarrierModelScope> {
  const rows = (await client.query<{ model_version_id: string; selection_revision: string; content_fingerprint: string;
    state: string; health: string; aggregate: unknown; trace: unknown; artifact_id: string; snapshot_sha256: string }>(`/* barrier:current-scope */
    SELECT s.active_model_version_id AS model_version_id,s.selection_revision::text,v.content_fingerprint,v.state,v.health,
      a.manifest AS aggregate,t.manifest AS trace,f.id AS artifact_id,f.snapshot_sha256
    FROM project_model_selections s
    JOIN model_versions v ON v.project_id=s.project_id AND v.id=s.active_model_version_id
    JOIN pf_project_preparations p ON p.project_id=s.project_id
    JOIN pf_preparation_aggregates a ON a.project_id=p.project_id AND a.id=p.current_aggregate_id
    JOIN pf_artifacts f ON f.project_id=p.project_id AND f.id=p.current_artifact_id AND f.model_version_id=s.active_model_version_id
    JOIN pf_geometry_trace_sets t ON t.project_id=a.project_id AND t.aggregate_id=a.id
    WHERE s.project_id=$1 AND octet_length(a.manifest::text)<=16777216 AND octet_length(t.manifest::text)<=262144
    LIMIT 2 FOR SHARE OF s,v,p,a,f,t`, [projectId])).rows;
  if (rows.length !== 1) return unavailable();
  const row = rows[0], aggregate = preparationAggregateSchema.safeParse(row.aggregate), trace = geometryTraceManifestSchema.safeParse(row.trace);
  if (!aggregate.success || !trace.success || row.state !== 'ready' || row.health !== 'healthy') return unavailable();
  const a = aggregate.data, t = trace.data, { contentSha256, ...traceBody } = t;
  if (hash(traceBody) !== contentSha256 || a.projectId !== projectId || t.projectId !== projectId || t.aggregateId !== a.id
    || a.modelVersionId !== row.model_version_id || t.modelVersionId !== row.model_version_id
    || a.selectionRevision !== row.selection_revision || a.contentFingerprint !== row.content_fingerprint
    || a.artifactId !== row.artifact_id || a.projection.sha256 !== row.snapshot_sha256 || t.projection.sha256 !== a.projection.sha256
    || t.captureFrameId !== a.coordinateFrameId || t.geometryRevision !== a.geometryRevision || t.sessionId !== a.sessionId) return unavailable();
  // Only the common display frame is projected. Per-object source matrices differ
  // legitimately; two different display frames are never silently aligned.
  const frames = (await client.query<{ frame: unknown; record: unknown; record_sha256: string }>(`/* barrier:current-frame */ SELECT DISTINCT ON
    (record->'coordinates'->'displayToWorldMetres',record->'coordinates'->'globalOffsetMetres')
    jsonb_build_object('coordinateFrame','canonical-world-metres','displayToWorldMetres',record->'coordinates'->'displayToWorldMetres',
      'globalOffsetMetres',record->'coordinates'->'globalOffsetMetres') AS frame,
    CASE WHEN octet_length(record::text)<=$3 THEN record ELSE NULL END AS record,summary->>'recordSha256' AS record_sha256
    FROM pf_geometry_object_revisions WHERE project_id=$1 AND trace_id=$2
    ORDER BY record->'coordinates'->'displayToWorldMetres',record->'coordinates'->'globalOffsetMetres',id LIMIT 2`, [projectId, t.id, GEOMETRY_TRACE_LIMITS.objectBytes])).rows;
  if (frames.length !== 1 || !barrierFrameProjectionSchema.safeParse(frames[0].frame).success) return unavailable();
  const object = geometryObjectRevisionSchema.safeParse(frames[0].record);
  if (!object.success || hash(object.data) !== frames[0].record_sha256 || object.data.projectId !== projectId || object.data.traceId !== t.id
    || object.data.modelVersionId !== a.modelVersionId || object.data.aggregateId !== a.id || object.data.coordinates.captureFrameId !== t.captureFrameId
    || object.data.provenance.contentFingerprint !== a.contentFingerprint || object.data.provenance.projectionSha256 !== a.projection.sha256
    || object.data.provenance.sessionId !== a.sessionId || object.data.geometry.mesh.projection.sha256 !== a.projection.sha256
    || object.data.geometry.mesh.projection.payloadRef !== a.projection.payloadRef || object.data.geometry.mesh.projection.bytes !== a.projection.bytes
    || barrierFrameProjectionHash({ coordinateFrame: 'canonical-world-metres', displayToWorldMetres: object.data.coordinates.displayToWorldMetres,
      globalOffsetMetres: object.data.coordinates.globalOffsetMetres }) !== barrierFrameProjectionHash(frames[0].frame)) return unavailable();
  return barrierModelScopeSchema.parse({ projectId, modelVersionId: row.model_version_id, contentFingerprint: row.content_fingerprint,
    selectionRevision: row.selection_revision, captureFrameId: a.coordinateFrameId, captureFrameSha256: barrierFrameProjectionHash(frames[0].frame),
    coordinateFrame: 'canonical-world-metres' });
}
