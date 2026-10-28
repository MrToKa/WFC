import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { endpointCurrentScopeSchema, type EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { geometryObjectRevisionSchema, geometryTraceManifestSchema, GEOMETRY_TRACE_LIMITS } from '../../shared/pathfinderGeometryTrace.js';
import { deriveEquipmentBottomAnchor } from '../../shared/pathfinderEndpointAttachment.js';
import { cableEndpointSelectionEvidenceSchema, type CableEndpointSelectionEvidence } from '../../shared/pathfinderCableEndpoints.js';

export const CABLE_ENDPOINT_SELECTION_LIMITS = Object.freeze({ candidates: 2, objectBytes: GEOMETRY_TRACE_LIMITS.objectBytes, traceBytes: GEOMETRY_TRACE_LIMITS.manifestBytes });
const sdkObjectIdSchema = z.number().int().positive().max(2147483647);
const digest = (value: unknown): string => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const same = (left: unknown, right: unknown): boolean => canonicalPurposeJson(left) === canonicalPurposeJson(right);
const encodedBytes = (value: unknown): number | null => { try { return Buffer.byteLength(canonicalPurposeJson(value)); } catch { return null; } };
type Data = Record<string, unknown>;

/**
 * Caller owns the current administrator/project/login transaction. Only exact
 * retained geometry can authorize an object-derived binding; SDK bounds are
 * never inputs to this reader, and absence never becomes an invented point.
 */
export async function readCableEndpointSelection(client: PoolClient, input: {
  projectId: string; current: EndpointCurrentScope; sdkObjectId: number;
}, check: () => void): Promise<CableEndpointSelectionEvidence> {
  const projectId = policyUuidSchema.parse(input.projectId), current = endpointCurrentScopeSchema.parse(input.current),
    sdkObjectId = sdkObjectIdSchema.parse(input.sdkObjectId);
  const unavailable = (reason: string, status: 'unavailable' | 'ambiguous' | 'unsupported' = 'unavailable') =>
    cableEndpointSelectionEvidenceSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-selection.v1', projectId, current, sdkObjectId,
      status, reasonCodes: [reason], object: null, pointProjectMetres: null, bounds: null, approximate: true, derivation: null });
  check();
  if (current.traceId === null) return unavailable('CURRENT_GEOMETRY_TRACE_REQUIRED');

  // Validate live publication ownership before considering any selected object.
  // Extract only needed aggregate metadata; do not load its entire part plan.
  const scopes = (await client.query<Data>(`/* cable-endpoint-selection:scope */ SELECT s.active_model_version_id,s.selection_revision::text,
    v.content_fingerprint,v.state,v.health,g.current_aggregate_id,g.current_artifact_id,g.geometry_revision::text,f.snapshot_sha256,f.content_fingerprint AS artifact_content_fingerprint,
    a.session_id,a.model_version_id AS aggregate_model_version_id,a.artifact_id AS aggregate_artifact_id,a.geometry_revision::text AS aggregate_geometry_revision,
    a.manifest->>'selectionRevision' AS aggregate_selection_revision,a.manifest->>'contentFingerprint' AS aggregate_content_fingerprint,
    a.manifest#>>'{projection,sha256}' AS aggregate_projection_sha256,a.manifest->>'coordinateFrameId' AS aggregate_capture_frame_id,
    t.id AS trace_id,t.aggregate_id AS trace_aggregate_id,t.model_version_id AS trace_model_version_id,
    CASE WHEN octet_length(t.manifest::text)<=$3 THEN t.manifest ELSE NULL END AS manifest
    FROM project_model_selections s JOIN model_versions v ON v.project_id=s.project_id AND v.id=s.active_model_version_id
    JOIN pf_project_preparations g ON g.project_id=s.project_id
    JOIN pf_preparation_aggregates a ON a.project_id=g.project_id AND a.id=g.current_aggregate_id
    JOIN pf_artifacts f ON f.project_id=g.project_id AND f.id=g.current_artifact_id AND f.model_version_id=s.active_model_version_id
    JOIN pf_geometry_trace_sets t ON t.project_id=g.project_id AND t.id=$2 AND t.aggregate_id=g.current_aggregate_id
    WHERE s.project_id=$1 LIMIT 2 FOR SHARE OF s,v,g,a,f,t`, [projectId, current.traceId, CABLE_ENDPOINT_SELECTION_LIMITS.traceBytes])).rows;
  check();
  if (scopes.length !== 1) return unavailable('CURRENT_GEOMETRY_SCOPE_UNAVAILABLE');
  const scope = scopes[0];
  if (scope.active_model_version_id !== current.modelVersionId || scope.selection_revision !== current.selectionRevision
    || scope.content_fingerprint !== current.contentFingerprint || scope.state !== 'ready' || scope.health !== 'healthy'
    || scope.current_aggregate_id !== current.aggregateId || scope.current_artifact_id !== current.artifactId || scope.geometry_revision !== current.geometryRevision
    || scope.snapshot_sha256 !== current.projectionSha256 || scope.artifact_content_fingerprint !== current.contentFingerprint || scope.aggregate_model_version_id !== current.modelVersionId
    || scope.aggregate_artifact_id !== current.artifactId || scope.aggregate_geometry_revision !== current.geometryRevision
    || scope.aggregate_selection_revision !== current.selectionRevision || scope.aggregate_content_fingerprint !== current.contentFingerprint
    || scope.aggregate_projection_sha256 !== current.projectionSha256 || scope.aggregate_capture_frame_id !== current.captureFrameId
    || scope.trace_id !== current.traceId || scope.trace_aggregate_id !== current.aggregateId || scope.trace_model_version_id !== current.modelVersionId)
    return unavailable('CURRENT_GEOMETRY_SCOPE_CHANGED');
  const traceBytes = encodedBytes(scope.manifest);
  if (traceBytes === null) return unavailable('CURRENT_GEOMETRY_TRACE_INVALID');
  if (scope.manifest === null || traceBytes > CABLE_ENDPOINT_SELECTION_LIMITS.traceBytes)
    return unavailable('CURRENT_GEOMETRY_TRACE_LIMIT');
  const parsedTrace = geometryTraceManifestSchema.safeParse(scope.manifest);
  if (!parsedTrace.success) return unavailable('CURRENT_GEOMETRY_TRACE_INVALID');
  const trace = parsedTrace.data, { contentSha256, ...traceBody } = trace;
  if (digest(traceBody) !== contentSha256 || trace.id !== current.traceId || trace.projectId !== projectId || trace.modelVersionId !== current.modelVersionId
    || trace.aggregateId !== current.aggregateId || trace.geometryRevision !== current.geometryRevision || trace.captureFrameId !== current.captureFrameId
    || trace.projection.sha256 !== current.projectionSha256 || trace.sessionId !== scope.session_id)
    return unavailable('CURRENT_GEOMETRY_TRACE_INVALID');

  // The SDK integer and retained object identifier are distinct identities. Use
  // the indexed SDK column, including valid custom/external object identifiers.
  const candidates = (await client.query<Data>(`/* cable-endpoint-selection:objects */ SELECT
    CASE WHEN octet_length(object_id)<=1024 THEN object_id ELSE NULL END AS object_id,db_id,geometry_role,visibility
    FROM pf_model_objects WHERE project_id=$1 AND artifact_id=$2 AND db_id=$3 ORDER BY object_id LIMIT 2 FOR SHARE`,
  [projectId, current.artifactId, sdkObjectId])).rows;
  check();
  if (candidates.length > 1) return unavailable('SDK_OBJECT_ID_AMBIGUOUS', 'ambiguous');
  if (candidates.length === 0) return unavailable('SDK_OBJECT_NOT_RETAINED');
  const candidate = candidates[0];
  if (candidate.db_id !== sdkObjectId || typeof candidate.object_id !== 'string' || !candidate.object_id.length || candidate.object_id.length > 256)
    return unavailable('SDK_OBJECT_IDENTITY_INVALID');
  if (!['visible', 'hidden', 'unknown'].includes(String(candidate.visibility))) return unavailable('SDK_OBJECT_VISIBILITY_INVALID');
  if (candidate.visibility === 'hidden') return unavailable('SDK_OBJECT_HIDDEN', 'unsupported');
  if (candidate.geometry_role !== 'object') return unavailable('SDK_OBJECT_EQUIPMENT_GEOMETRY_REQUIRED', 'unsupported');

  const records = (await client.query<Data>(`/* cable-endpoint-selection:record */ SELECT id,project_id,trace_id,object_id,
    CASE WHEN octet_length(record::text)<=$4 THEN record ELSE NULL END AS record,summary->>'recordSha256' AS record_sha256
    FROM pf_geometry_object_revisions WHERE project_id=$1 AND trace_id=$2 AND object_id=$3 ORDER BY id LIMIT 2 FOR SHARE`,
  [projectId, current.traceId, candidate.object_id, CABLE_ENDPOINT_SELECTION_LIMITS.objectBytes])).rows;
  check();
  if (records.length > 1) return unavailable('SDK_OBJECT_EVIDENCE_AMBIGUOUS', 'ambiguous');
  if (records.length === 0) return unavailable('SDK_OBJECT_GEOMETRY_NOT_RETAINED');
  const row = records[0];
  const objectBytes = encodedBytes(row.record);
  if (objectBytes === null) return unavailable('SDK_OBJECT_EVIDENCE_INVALID');
  if (row.record === null || objectBytes > CABLE_ENDPOINT_SELECTION_LIMITS.objectBytes)
    return unavailable('SDK_OBJECT_EVIDENCE_LIMIT');
  const parsed = geometryObjectRevisionSchema.safeParse(row.record);
  if (!parsed.success) return unavailable('SDK_OBJECT_EVIDENCE_INVALID');
  const object = parsed.data;
  if (row.project_id !== projectId || row.trace_id !== current.traceId || row.object_id !== candidate.object_id || row.id !== object.id
    || digest(object) !== row.record_sha256 || object.projectId !== projectId || object.traceId !== current.traceId || object.modelVersionId !== current.modelVersionId
    || object.aggregateId !== current.aggregateId || object.identity.objectId !== candidate.object_id || object.identity.dbId !== sdkObjectId
    || object.geometry.mesh.objectId !== candidate.object_id || !same(object.geometry.mesh.projection, trace.projection)
    || object.coordinates.captureFrameId !== current.captureFrameId || object.provenance.projectionSha256 !== current.projectionSha256
    || object.provenance.contentFingerprint !== current.contentFingerprint || object.provenance.sessionId !== trace.sessionId
    || object.provenance.fittedTraceSha256 !== trace.fittedTrace.sha256 || digest(object.identity) !== object.signatures.identityEvidenceSha256
    || digest(object.catalog) !== object.signatures.policySha256)
    return unavailable('SDK_OBJECT_EVIDENCE_SCOPE_INVALID');
  const { derivationSha256: _derivation, ...traceEngine } = trace.runtimeFingerprint;
  if (!same(object.provenance.engine, traceEngine)) return unavailable('SDK_OBJECT_PRODUCER_INVALID');
  if (object.geometry.role !== 'object' || object.geometry.fitted !== null || object.geometry.equipmentAnchor === null)
    return unavailable('SDK_OBJECT_EQUIPMENT_ANCHOR_REQUIRED', 'unsupported');
  const pointProjectMetres = deriveEquipmentBottomAnchor(object.geometry.bounds);
  if (!same(pointProjectMetres, object.geometry.equipmentAnchor.pointMetres)) return unavailable('SDK_OBJECT_ANCHOR_INVALID');
  check();
  return cableEndpointSelectionEvidenceSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-selection.v1', projectId, current, sdkObjectId,
    status: 'available', reasonCodes: [], object: { traceId: current.traceId, objectRevisionId: object.id, recordSha256: String(row.record_sha256) },
    pointProjectMetres, bounds: object.geometry.bounds, approximate: true, derivation: 'equipment-bottom-aabb.v1' });
}
