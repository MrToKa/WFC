import type { PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalPurposeJson, policyUuidSchema, policyHashSchema } from '../../shared/pathfinderPurposePolicy.js';
import { preparationAggregateSchema, preparationRequestedScopeSchema } from '../../shared/pathfinderPreparation.js';
import { geometryObjectRevisionSchema, geometryTraceManifestSchema, GEOMETRY_TRACE_LIMITS } from '../../shared/pathfinderGeometryTrace.js';
import { endpointCurrentScopeSchema, type EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';
import { modelEquipmentMatchKeys } from '../../viewer-runtime/equipment-names.mjs';
import { createHash } from 'node:crypto';
import { PathFinderError } from './errors.js';
import { normalizeLocation } from './matching.js';
import { automaticEndpointCalculationPointSchema, automaticEndpointContentHash, type AutomaticEndpointCalculationPoint } from './endpointCalculationProvenance.js';

export type AutomaticEndpointCandidateResult = {
  status: 'automatic-ready' | 'missing' | 'ambiguous' | 'saved-binding-required' | 'object-unverified' | 'preparation-required';
  candidateObjectIds: string[]; point: AutomaticEndpointCalculationPoint | null;
};
const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'Automatic endpoint evidence could not be validated. Resolve the shared location or prepare the current model again.'); };
const evidenceSchema = preparationRequestedScopeSchema.innerType().shape.endpointEvidence;
const policySchema = z.enum(['wfc.pf.project-exact-candidates.v1', 'wfc.pf.project-exact-candidates.v2']);
const keys = (value: string, policy: z.infer<typeof policySchema>) => policy === 'wfc.pf.project-exact-candidates.v2'
  ? modelEquipmentMatchKeys(value) : [normalizeLocation(value)].filter(Boolean);
const result = (status: AutomaticEndpointCandidateResult['status'], candidateObjectIds: string[] = []): AutomaticEndpointCandidateResult => ({ status, candidateObjectIds, point: null });

/** SELECT-only. Caller holds the normal project and current-principal locks.
 * A unique approximate model anchor can feed a proposal; it never creates a
 * confirmed location, supersedes a saved point or records a human decision.
 */
export async function readAutomaticEndpointCandidates(client: PoolClient, input: {
  projectId: string; current: EndpointCurrentScope; locationIds: string[]; deadline?: number; signal?: AbortSignal;
}): Promise<Map<string, AutomaticEndpointCandidateResult>> {
  const projectId = policyUuidSchema.parse(input.projectId), current = endpointCurrentScopeSchema.parse(input.current);
  if (input.locationIds.length > RECALCULATION_LIMITS.neededLocations) return fail('ENDPOINT_NEEDED_LOCATION_LIMIT', 413);
  const ids = [...new Set(input.locationIds.map(id => policyUuidSchema.parse(id)))].sort();
  const values = new Map<string, AutomaticEndpointCandidateResult>();
  const deadline = Math.min(input.deadline ?? Infinity, Date.now() + RECALCULATION_LIMITS.collectionMilliseconds);
  const check = () => { input.signal?.throwIfAborted(); if (Date.now() > deadline) fail('RECALCULATION_COLLECTION_DEADLINE', 503); };
  check(); if (!ids.length) return values;
  if (!current.traceId) { for (const id of ids) values.set(id, result('preparation-required')); return values; }
  let bytes = 0;
  const account = (value: unknown) => { bytes += Buffer.byteLength(canonicalPurposeJson(value)); if (bytes > RECALCULATION_LIMITS.neededLocationBytes) fail('ENDPOINT_NEEDED_LOCATION_BYTES', 413); };
  // Do not materialize the full plan's potentially million-object manifest for
  // each cable. Publication already freezes this exact plan/aggregate link.
  const source = (await client.query<Record<string, unknown>>(`/* automatic-endpoints:plan */ SELECT a.manifest,
    s.plan->>'matchingPolicyVersion' AS matching_policy,s.plan->>'orderedPlanSha256' AS ordered_plan_sha256,
    CASE WHEN octet_length((s.plan#>'{requestedScope,endpointEvidence}')::text)<=16777216
      THEN s.plan#>'{requestedScope,endpointEvidence}' ELSE NULL END AS endpoint_evidence
    FROM pf_preparation_aggregates a JOIN pf_preparation_sessions s ON s.project_id=a.project_id AND s.id=a.session_id
    WHERE a.project_id=$1 AND a.id=$2 FOR SHARE OF a,s`, [projectId, current.aggregateId])).rows;
  check(); if (source.length !== 1 || source[0].endpoint_evidence === null) return fail('AUTOMATIC_ENDPOINT_PREPARATION_INTEGRITY');
  account(source[0]);
  const aggregate = preparationAggregateSchema.parse(source[0].manifest), policy = policySchema.parse(source[0].matching_policy),
    planSha = policyHashSchema.parse(source[0].ordered_plan_sha256), evidence = evidenceSchema.parse(source[0].endpoint_evidence);
  if (aggregate.projectId !== projectId || aggregate.id !== current.aggregateId || aggregate.modelVersionId !== current.modelVersionId ||
      aggregate.artifactId !== current.artifactId || aggregate.contentFingerprint !== current.contentFingerprint ||
      aggregate.selectionRevision !== current.selectionRevision || aggregate.geometryRevision !== current.geometryRevision ||
      aggregate.projection.sha256 !== current.projectionSha256 || aggregate.coordinateFrameId !== current.captureFrameId ||
      aggregate.orderedPlanSha256 !== planSha) return fail('AUTOMATIC_ENDPOINT_PREPARATION_INTEGRITY');
  const traceRows = (await client.query<{ manifest: unknown }>('/* automatic-endpoints:trace */ SELECT manifest FROM pf_geometry_trace_sets WHERE project_id=$1 AND id=$2 AND aggregate_id=$3 FOR SHARE',
    [projectId, current.traceId, current.aggregateId])).rows;
  check(); if (traceRows.length !== 1) return fail('AUTOMATIC_ENDPOINT_TRACE_INTEGRITY');
  account(traceRows[0]); const trace = geometryTraceManifestSchema.parse(traceRows[0].manifest);
  const { contentSha256: traceSha, ...traceBody } = trace;
  if (traceSha !== digest(traceBody) || trace.id !== current.traceId || trace.projectId !== projectId ||
      trace.aggregateId !== current.aggregateId || trace.modelVersionId !== current.modelVersionId ||
      trace.projection.sha256 !== current.projectionSha256 || trace.captureFrameId !== current.captureFrameId ||
      trace.geometryRevision !== current.geometryRevision || trace.sessionId !== aggregate.sessionId) return fail('AUTOMATIC_ENDPOINT_TRACE_INTEGRITY');
  const byName = new Map<string, typeof evidence>();
  for (const item of evidence) { check(); const name = normalizeLocation(item.name); byName.set(name, [...(byName.get(name) ?? []), item]); }
  const pending = new Map<string, { revision: string; evidence: typeof evidence; objectId: string }>();
  for (let at = 0; at < ids.length; at += RECALCULATION_LIMITS.headChunk) {
    check(); const selected = ids.slice(at, at + RECALCULATION_LIMITS.headChunk);
    const locations = (await client.query<{ id: string; name: string; revision: string; aliases: string[]; has_head: boolean; has_legacy: boolean }>(`/* automatic-endpoints:locations */ SELECT l.id,l.name,l.revision::text,
      COALESCE((SELECT array_agg(a.normalized_alias ORDER BY a.normalized_alias) FROM pf_location_aliases a WHERE a.project_id=l.project_id AND a.location_id=l.id),ARRAY[]::text[]) AS aliases,
      EXISTS(SELECT 1 FROM pf_endpoint_binding_heads h WHERE h.project_id=l.project_id AND h.location_id=l.id) AS has_head,
      EXISTS(SELECT 1 FROM pf_location_bindings b WHERE b.project_id=l.project_id AND b.location_id=l.id) AS has_legacy
      FROM pf_locations l WHERE l.project_id=$1 AND l.id=ANY($2::uuid[]) ORDER BY l.id FOR SHARE OF l`, [projectId, selected])).rows;
    check(); const seen = new Set<string>();
    for (const row of locations) {
      account(row); if (!selected.includes(row.id) || seen.has(row.id) || typeof row.has_head !== 'boolean' || typeof row.has_legacy !== 'boolean' ||
          !Array.isArray(row.aliases) || row.aliases.some(alias => typeof alias !== 'string')) return fail('AUTOMATIC_ENDPOINT_LOCATION_INTEGRITY');
      seen.add(row.id);
      if (row.has_head || row.has_legacy) { values.set(row.id, result('saved-binding-required')); continue; }
      const names = [...new Set([row.name, ...row.aliases].map(normalizeLocation))];
      const matched = [...new Set(names.flatMap(name => byName.get(name) ?? []))];
      const candidates = [...new Set(matched.flatMap(item => item.candidateObjectIds))].sort();
      if (candidates.length !== 1) { values.set(row.id, result(candidates.length ? 'ambiguous' : 'missing', candidates)); continue; }
      pending.set(row.id, { revision: row.revision, evidence: matched, objectId: candidates[0] });
    }
    for (const id of selected) if (!seen.has(id)) values.set(id, result('missing'));
  }
  const objectIds = [...new Set([...pending.values()].map(value => value.objectId))].sort(), objects = new Map<string, { record: z.infer<typeof geometryObjectRevisionSchema>; sha: string; visibility: string }>();
  for (let at = 0; at < objectIds.length; at += 32) {
    check(); const selected = objectIds.slice(at, at + 32);
    const rows = (await client.query<{ object_id: string; record: unknown; record_sha256: string; visibility: string }>(`/* automatic-endpoints:objects */ SELECT o.object_id,
      CASE WHEN octet_length(o.record::text)<=524288 THEN o.record ELSE NULL END AS record,
      o.summary->>'recordSha256' AS record_sha256,m.visibility
      FROM pf_geometry_object_revisions o JOIN pf_model_objects m ON m.project_id=o.project_id AND m.artifact_id=$3 AND m.object_id=o.object_id
      WHERE o.project_id=$1 AND o.trace_id=$2 AND o.object_id=ANY($4::text[]) ORDER BY o.object_id FOR SHARE OF o,m`,
    [projectId, current.traceId, current.artifactId, selected])).rows;
    check();
    for (const row of rows) {
      account(row); if (!selected.includes(row.object_id) || objects.has(row.object_id) || row.record === null) return fail('AUTOMATIC_ENDPOINT_OBJECT_INTEGRITY');
      if (Buffer.byteLength(canonicalPurposeJson(row.record)) > GEOMETRY_TRACE_LIMITS.objectBytes) return fail('ENDPOINT_NEEDED_LOCATION_BYTES', 413);
      const object = geometryObjectRevisionSchema.parse(row.record);
      if (digest(object) !== row.record_sha256 || object.projectId !== projectId || object.traceId !== current.traceId ||
          object.modelVersionId !== current.modelVersionId || object.aggregateId !== current.aggregateId || object.identity.objectId !== row.object_id ||
          object.coordinates.captureFrameId !== current.captureFrameId || object.provenance.projectionSha256 !== current.projectionSha256 ||
          object.provenance.contentFingerprint !== current.contentFingerprint || object.provenance.sessionId !== aggregate.sessionId ||
          !['visible', 'hidden', 'unknown'].includes(row.visibility)) return fail('AUTOMATIC_ENDPOINT_OBJECT_INTEGRITY');
      objects.set(row.object_id, { record: object, sha: row.record_sha256, visibility: row.visibility });
    }
  }
  for (const [id, candidate] of pending) {
    check(); const saved = objects.get(candidate.objectId), object = saved?.record;
    if (!saved || !object || saved.visibility === 'hidden' || object.geometry.role !== 'object' || !object.geometry.equipmentAnchor) {
      values.set(id, result('object-unverified', [candidate.objectId])); continue;
    }
    const objectKeys = new Set([object.historicalModel.name, ...object.historicalModel.properties
      .filter(property => /^(tag|name|equipment[ _-]?tag|equipment[ _-]?name|location)$/i.test(property.name)).map(property => property.value)]
      .flatMap(value => keys(value, policy)));
    const matchedNames = [...new Set(candidate.evidence.filter(item => item.candidateObjectIds.includes(candidate.objectId))
      .map(item => normalizeLocation(item.name)))].sort();
    if (!matchedNames.length || matchedNames.some(name => !objectKeys.has(name))) { values.set(id, result('object-unverified', [candidate.objectId])); continue; }
    const { minimum, maximum } = object.geometry.bounds;
    const point: [number, number, number] = [(minimum[0] + maximum[0]) / 2, (minimum[1] + maximum[1]) / 2, minimum[2]];
    if (point.some(value => !Number.isFinite(value)) || canonicalPurposeJson(point) !== canonicalPurposeJson(object.geometry.equipmentAnchor.pointMetres)) return fail('AUTOMATIC_ENDPOINT_ANCHOR_INTEGRITY');
    const draft = automaticEndpointCalculationPointSchema.omit({ contentSha256: true }).parse({
      kind: 'automatic-equipment-anchor', locationId: id, locationRevision: candidate.revision, point,
      modelVersionId: current.modelVersionId, artifactId: current.artifactId, aggregateId: current.aggregateId,
      captureFrameId: current.captureFrameId, projectionSha256: current.projectionSha256, traceId: current.traceId,
      traceContentSha256: traceSha, sourceObjectRevisionId: object.id, sourceObjectId: object.identity.objectId,
      sourceObjectRecordSha256: saved.sha, orderedPlanSha256: planSha, matchingEvidenceSha256: digest(candidate.evidence),
      matchingPolicyVersion: policy, matchedNames, derivation: 'equipment-bottom-aabb.v1', approximate: true, engineeringAccepted: false,
    });
    const pointValue = automaticEndpointCalculationPointSchema.parse({ ...draft, contentSha256: automaticEndpointContentHash(draft) });
    account(pointValue); values.set(id, { status: 'automatic-ready', candidateObjectIds: [candidate.objectId], point: pointValue });
  }
  check(); return values;
}
