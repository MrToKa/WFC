import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalPurposeJson, policyUuidSchema, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import { ENDPOINT_BINDING_LIMITS, ENDPOINT_ANCHOR_RULE, endpointBindingSchema, endpointBindingWriteSchema, endpointBindingContextSchema, endpointLocationSchema, endpointBindingPageSchema, endpointBindingSummarySchema, endpointBindingReceiptSchema, endpointBindingHistorySchema, endpointMigrationWriteSchema, endpointMigrationDecisionSchema, endpointMigrationConfirmSchema, endpointMigrationEvaluationSchema, endpointCurrentScopeSchema, type EndpointBinding, type EndpointBindingWrite, type EndpointBindingContext, type EndpointCurrentScope, type EndpointObjectRef, type EndpointMigrationEvaluation } from '../../shared/pathfinderEndpointBindings.js';
import { preparationAggregateSchema } from '../../shared/pathfinderPreparation.js';
import { geometryObjectRevisionSchema, geometryTraceManifestSchema, type GeometryObjectRevision } from '../../shared/pathfinderGeometryTrace.js';
import { normalizeLocation } from './matching.js';
import { assertLoginNotExpired, requireCurrentLogin } from './auth.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { deriveEquipmentBottomAnchor, evaluateEndpointMigration } from '../../shared/pathfinderEndpointAttachment.js';

const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'The endpoint binding is unavailable or changed. Refresh its context; retain an uncertain save command for reconciliation.'); };
export const endpointBindingHash = (value: unknown): string => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
export const ENDPOINT_BINDING_SQL_BOUNDS = Object.freeze({ acquisitionMilliseconds: 5000, lockMilliseconds: 3000, statementMilliseconds: 15000, idleMilliseconds: 30000 });
async function connect(pool: Pool): Promise<PoolClient> {
  let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
  const pending = pool.connect().then(c => { if (expired) { c.release(); return fail('ENDPOINT_DATABASE_BUSY', 503); } return c; });
  try { return await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new PathFinderError('ENDPOINT_DATABASE_BUSY', 503)); }, ENDPOINT_BINDING_SQL_BOUNDS.acquisitionMilliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}
/** The project mutex is acquired first; project existence is disclosed only after current authority. */
export async function endpointBindingTransaction<T>(pool: Pool, projectId: string, who: JobPrincipal, operation: (client: PoolClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
  policyUuidSchema.parse(projectId); policyUuidSchema.parse(who.userId); policyUuidSchema.parse(who.loginId); assertLoginNotExpired(who); signal?.throwIfAborted();
  const c = await connect(pool); let commitStarted = false, discard = false;
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='30000ms'");
    const exists = (await c.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [projectId])).rows.length === 1;
    const user = (await c.query<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id=$1 FOR SHARE', [who.userId])).rows[0];
    if (!user) return fail('LOGIN_REVOKED', 401); if (!user.is_admin) return fail('ADMIN_REQUIRED', 403); await requireCurrentLogin(c, who); if (!exists) return fail('PROJECT_NOT_FOUND', 404);
    signal?.throwIfAborted(); const result = await operation(c); signal?.throwIfAborted(); assertLoginNotExpired(who); commitStarted = true; await c.query('COMMIT'); return result;
  } catch (error) {
    discard = commitStarted; try { await c.query('ROLLBACK'); } catch { discard = true; }
    if (commitStarted) return fail('ENDPOINT_COMMIT_OUTCOME_UNKNOWN', 503);
    const code = (error as { code?: string })?.code; if (code === '55P03' || code === '57014') return fail('ENDPOINT_DATABASE_BUSY', 503); if (code === '23505') return fail('ENDPOINT_WRITE_CONFLICT'); throw error;
  } finally { c.release(discard ? true : undefined); }
}
function budget<T>(value: T): T { if (Buffer.byteLength(canonicalPurposeJson(value)) > ENDPOINT_BINDING_LIMITS.responseBytes) return fail('ENDPOINT_RESPONSE_LIMIT', 413); return value; }
function increment(value: string): string { const next = BigInt(policyRevisionSchema.parse(value)) + 1n; if (next > 9223372036854775807n) return fail('ENDPOINT_REVISION_LIMIT'); return next.toString(); }
function validHash<T extends { contentSha256: string }>(value: T): T { const { contentSha256, ...body } = value; if (endpointBindingHash(body) !== contentSha256) return fail('ENDPOINT_EVIDENCE_INTEGRITY'); return value; }
function record(raw: unknown): EndpointBinding { return validHash(endpointBindingSchema.parse(raw)); }
async function registry(c: PoolClient, projectId: string, expected?: string): Promise<string> { const row = (await c.query<{ revision: string }>('SELECT registry_revision::text AS revision FROM pf_project_state WHERE project_id=$1 FOR UPDATE', [projectId])).rows[0]; if (!row) return fail('PROJECT_NOT_FOUND', 404); if (expected !== undefined && row.revision !== expected) return fail('REGISTRY_CONFLICT'); return row.revision; }
async function location(c: PoolClient, projectId: string, id: string): Promise<EndpointBindingContext['location']> {
  const row = (await c.query<{ id: string; name: string; revision: string }>('SELECT id,name,revision::text FROM pf_locations WHERE project_id=$1 AND id=$2 FOR UPDATE', [projectId, id])).rows[0]; if (!row) return null;
  const names = (await c.query<{ display_alias: string }>('SELECT display_alias FROM pf_location_aliases WHERE project_id=$1 AND location_id=$2 ORDER BY normalized_alias', [projectId, id])).rows.map(r => r.display_alias).filter(a => normalizeLocation(a) !== normalizeLocation(row.name));
  return endpointLocationSchema.parse({ ...row, aliases: names });
}
async function head(c: PoolClient, projectId: string, locationId: string): Promise<EndpointBinding | null> {
  const row = (await c.query<{ binding_id: string; binding_revision: string; record_sha256: string; record: unknown }>('SELECT h.binding_id,h.binding_revision::text,r.record_sha256,r.record FROM pf_endpoint_binding_heads h JOIN pf_endpoint_binding_revisions r ON r.project_id=h.project_id AND r.location_id=h.location_id AND r.id=h.binding_id WHERE h.project_id=$1 AND h.location_id=$2 FOR UPDATE OF h FOR SHARE OF r', [projectId, locationId])).rows[0];
  if (!row) return null; const value = record(row.record); if (value.id !== row.binding_id || value.projectId !== projectId || value.locationId !== locationId || value.bindingRevision !== row.binding_revision || value.contentSha256 !== row.record_sha256) return fail('ENDPOINT_HEAD_INTEGRITY'); return value;
}
/** Caller holds the normal project mutex. Location changes do not invalidate geometry itself. */
export async function readCurrentEndpointBindingContext(c: PoolClient, projectId: string): Promise<EndpointBindingContext['current']> {
  policyUuidSchema.parse(projectId);
  const selected = (await c.query<{ active_model_version_id: string | null; selection_revision: string }>('SELECT active_model_version_id,selection_revision::text FROM project_model_selections WHERE project_id=$1 FOR SHARE', [projectId])).rows[0]; if (!selected?.active_model_version_id) return null;
  const model = (await c.query<{ state: string; health: string; content_fingerprint: string }>('SELECT state,health,content_fingerprint FROM model_versions WHERE project_id=$1 AND id=$2 FOR SHARE', [projectId, selected.active_model_version_id])).rows[0]; if (!model || model.state !== 'ready' || model.health !== 'healthy') return null;
  const row = (await c.query<{ current_aggregate_id: string | null; current_artifact_id: string | null; geometry_revision: string; manifest: unknown; snapshot_sha256: string }>('SELECT p.current_aggregate_id,p.current_artifact_id,p.geometry_revision::text,a.manifest,f.snapshot_sha256 FROM pf_project_preparations p LEFT JOIN pf_preparation_aggregates a ON a.project_id=p.project_id AND a.id=p.current_aggregate_id LEFT JOIN pf_artifacts f ON f.project_id=p.project_id AND f.id=p.current_artifact_id WHERE p.project_id=$1 FOR SHARE OF p', [projectId])).rows[0];
  if (!row?.current_aggregate_id || !row.current_artifact_id) return null;
  await c.query('SELECT id FROM pf_preparation_aggregates WHERE project_id=$1 AND id=$2 FOR SHARE', [projectId, row.current_aggregate_id]);
  await c.query('SELECT id FROM pf_artifacts WHERE project_id=$1 AND id=$2 FOR SHARE', [projectId, row.current_artifact_id]);
  const aggregate = preparationAggregateSchema.parse(row.manifest);
  if (aggregate.projectId !== projectId || aggregate.id !== row.current_aggregate_id || aggregate.artifactId !== row.current_artifact_id || aggregate.geometryRevision !== row.geometry_revision || aggregate.projection.sha256 !== row.snapshot_sha256) return fail('ENDPOINT_PREPARATION_INTEGRITY');
  if (aggregate.modelVersionId !== selected.active_model_version_id || aggregate.contentFingerprint !== model.content_fingerprint) return null;
  const trace = (await c.query<{ id: string; manifest: unknown }>('SELECT id,manifest FROM pf_geometry_trace_sets WHERE project_id=$1 AND aggregate_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE', [projectId, aggregate.id])).rows[0];
  if (trace) { const proof = validHash(geometryTraceManifestSchema.parse(trace.manifest)); if (proof.id !== trace.id || proof.projectId !== projectId || proof.aggregateId !== aggregate.id || proof.projection.sha256 !== aggregate.projection.sha256) return fail('ENDPOINT_TRACE_INTEGRITY'); }
  return endpointCurrentScopeSchema.parse({ modelVersionId: aggregate.modelVersionId, selectionRevision: selected.selection_revision, contentFingerprint: model.content_fingerprint, aggregateId: aggregate.id, artifactId: aggregate.artifactId, projectionSha256: aggregate.projection.sha256, captureFrameId: aggregate.coordinateFrameId, geometryRevision: aggregate.geometryRevision, traceId: trace?.id ?? null });
}
export type EndpointBindingScopeResult = { status: 'confirmed'; binding: EndpointBinding } | { status: 'missing' | 'stale' | 'unsupported'; code: string };
export async function readEndpointBindingScope(c: PoolClient, input: { projectId: string; locationId: string; modelVersionId: string; aggregateId: string; projectionSha256: string; captureFrameId: string }): Promise<EndpointBindingScopeResult> {
  const value = await head(c, input.projectId, input.locationId); if (!value) return { status: 'missing', code: 'ENDPOINT_BINDING_REQUIRED' };
  const location = (await c.query<{ revision: string }>('SELECT revision::text FROM pf_locations WHERE project_id=$1 AND id=$2 FOR SHARE', [input.projectId, input.locationId])).rows[0];
  if (!location || location.revision !== value.locationRevision) return { status: 'stale', code: 'ENDPOINT_LOCATION_CHANGED' };
  if (value.status !== 'confirmed') return { status: value.status === 'unsupported-attachment' ? 'unsupported' : 'stale', code: 'ENDPOINT_BINDING_UNCONFIRMED' };
  if (value.modelVersionId !== input.modelVersionId || value.aggregateId !== input.aggregateId || value.projectionSha256 !== input.projectionSha256 || value.captureFrameId !== input.captureFrameId) return { status: 'stale', code: 'ENDPOINT_BINDING_STALE' };
  if (value.mode === 'object-attached') return { status: 'unsupported', code: 'ENDPOINT_ATTACHMENT_EVIDENCE_UNAVAILABLE' };
  return { status: 'confirmed', binding: value };
}
/** A single bounded join for the legacy state projection; never promotes a v1 row. */
export async function readEndpointBindingHeads(c: PoolClient, projectId: string, current?: EndpointBindingContext['current']): Promise<Map<string, { binding: EndpointBinding; ready: boolean }>> {
  policyUuidSchema.parse(projectId); const selected = current === undefined ? await readCurrentEndpointBindingContext(c, projectId) : current;
  const rows = (await c.query<{ location_id: string; location_revision: string; binding_id: string; binding_revision: string; record_sha256: string; record: unknown }>('SELECT h.location_id,l.revision::text AS location_revision,h.binding_id,h.binding_revision::text,r.record_sha256,r.record FROM pf_endpoint_binding_heads h JOIN pf_locations l ON l.project_id=h.project_id AND l.id=h.location_id JOIN pf_endpoint_binding_revisions r ON r.project_id=h.project_id AND r.location_id=h.location_id AND r.id=h.binding_id WHERE h.project_id=$1 ORDER BY h.location_id LIMIT 10001 FOR SHARE OF h,r,l', [projectId])).rows;
  if (rows.length > 10000) return fail('ENDPOINT_HEAD_LIMIT', 413); const result = new Map<string, { binding: EndpointBinding; ready: boolean }>();
  for (const row of rows) { const binding = record(row.record); if (binding.projectId !== projectId || binding.locationId !== row.location_id || binding.id !== row.binding_id || binding.bindingRevision !== row.binding_revision || binding.contentSha256 !== row.record_sha256 || result.has(row.location_id)) return fail('ENDPOINT_HEAD_INTEGRITY'); result.set(row.location_id, { binding, ready: readiness(binding, selected, row.location_revision).calculationReady }); }
  return result;
}

type CableEndpoint = { id: string; from_location: string | null; to_location: string | null };
async function cableEndpoints(c: PoolClient, projectId: string): Promise<CableEndpoint[]> { const rows = (await c.query<CableEndpoint>('SELECT id,from_location,to_location FROM cables WHERE project_id=$1 ORDER BY id LIMIT 100001', [projectId])).rows; if (rows.length > 100000) return fail('ENDPOINT_PROJECT_CABLE_LIMIT', 413); return rows; }
function usageIndex(cables: CableEndpoint[]) {
  const index = new Map<string, { from: Set<string>; to: Set<string> }>();
  for (const cable of cables) for (const direction of ['from', 'to'] as const) { const name = direction === 'from' ? cable.from_location : cable.to_location; if (!name || !normalizeLocation(name)) continue; const key = normalizeLocation(name), value = index.get(key) ?? { from: new Set<string>(), to: new Set<string>() }; value[direction].add(cable.id); index.set(key, value); }
  return (value: EndpointBindingContext['location']): EndpointBindingContext['usage'] => { const from = new Set<string>(), to = new Set<string>(); for (const name of value ? [value.name, ...value.aliases] : []) { const entry = index.get(normalizeLocation(name)); for (const id of entry?.from ?? []) from.add(id); for (const id of entry?.to ?? []) to.add(id); } return { fromOccurrences: from.size, toOccurrences: to.size, distinctCables: new Set([...from, ...to]).size }; };
}
const legacySchema = endpointBindingContextSchema.innerType().shape.legacy;
async function legacy(c: PoolClient, projectId: string, locationId: string, modelId: string | null): Promise<EndpointBindingContext['legacy']> {
  const row = (await c.query<{ model_version_id: string; revision: string; point: unknown; object_id: string | null; derivation: string }>('SELECT model_version_id,revision::text,point,object_id,derivation FROM pf_location_bindings WHERE project_id=$1 AND location_id=$2 ORDER BY (model_version_id=$3) DESC,confirmed_at DESC,model_version_id LIMIT 1 FOR SHARE', [projectId, locationId, modelId])).rows[0];
  return row ? legacySchema.parse({ modelVersionId: row.model_version_id, revision: row.revision, pointProjectMetres: row.point, objectId: row.object_id, derivation: row.derivation }) : null;
}
function readiness(binding: EndpointBinding | null, current: EndpointBindingContext['current'], locationRevision: string | null): EndpointBindingContext['readiness'] {
  if (!current) return { status: 'stale', calculationReady: false, reasonCodes: ['ENDPOINT_PREPARATION_REQUIRED'] };
  if (!binding) return { status: 'missing', calculationReady: false, reasonCodes: ['ENDPOINT_BINDING_REQUIRED'] };
  if (binding.locationRevision !== locationRevision) return { status: 'stale', calculationReady: false, reasonCodes: ['ENDPOINT_LOCATION_CHANGED'] };
  if (binding.modelVersionId !== current.modelVersionId || binding.aggregateId !== current.aggregateId || binding.projectionSha256 !== current.projectionSha256 || binding.captureFrameId !== current.captureFrameId) return { status: 'stale', calculationReady: false, reasonCodes: ['ENDPOINT_BINDING_STALE'] };
  if (binding.mode === 'object-attached') return { status: 'unsupported-attachment', calculationReady: false, reasonCodes: ['ENDPOINT_ATTACHMENT_EVIDENCE_UNAVAILABLE'] };
  return binding.status === 'confirmed' ? { status: 'confirmed', calculationReady: true, reasonCodes: [] } : { status: binding.status, calculationReady: false, reasonCodes: ['ENDPOINT_BINDING_UNCONFIRMED'] };
}
const summary = (b: EndpointBinding) => endpointBindingSummarySchema.parse({ id: b.id, bindingRevision: b.bindingRevision, status: b.status, mode: b.mode, pointProjectMetres: b.pointProjectMetres, modelVersionId: b.modelVersionId, aggregateId: b.aggregateId, captureFrameId: b.captureFrameId, sourceObjectRevisionId: b.sourceObject?.objectRevisionId ?? null, confirmedBy: b.confirmedBy, confirmedAt: b.confirmedAt, contentSha256: b.contentSha256 });
async function objectEvidence(c: PoolClient, projectId: string, current: EndpointCurrentScope, ref: EndpointObjectRef): Promise<GeometryObjectRevision> {
  const row = (await c.query<{ record: unknown; record_sha256: string; manifest: unknown }>("SELECT o.record,o.summary->>'recordSha256' AS record_sha256,t.manifest FROM pf_geometry_object_revisions o JOIN pf_geometry_trace_sets t ON t.project_id=o.project_id AND t.id=o.trace_id WHERE o.project_id=$1 AND o.trace_id=$2 AND o.id=$3 FOR SHARE OF o,t", [projectId, ref.traceId, ref.objectRevisionId])).rows[0]; if (!row) return fail('ENDPOINT_OBJECT_NOT_FOUND', 404);
  const value = geometryObjectRevisionSchema.parse(row.record), trace = validHash(geometryTraceManifestSchema.parse(row.manifest));
  if (endpointBindingHash(value) !== ref.recordSha256 || row.record_sha256 !== ref.recordSha256 || value.id !== ref.objectRevisionId || value.traceId !== ref.traceId || trace.id !== ref.traceId || value.projectId !== projectId || trace.projectId !== projectId || value.modelVersionId !== current.modelVersionId || value.aggregateId !== current.aggregateId || trace.aggregateId !== current.aggregateId || value.coordinates.captureFrameId !== current.captureFrameId || value.provenance.projectionSha256 !== current.projectionSha256 || trace.projection.sha256 !== current.projectionSha256) return fail('ENDPOINT_OBJECT_SCOPE');
  return value;
}
function assertScope(current: EndpointBindingContext['current'], input: Pick<EndpointBindingWrite, 'modelVersionId' | 'expectedSelectionRevision' | 'aggregateId' | 'projectionSha256' | 'captureFrameId'>): asserts current is EndpointCurrentScope { if (!current || current.modelVersionId !== input.modelVersionId || current.selectionRevision !== input.expectedSelectionRevision || current.aggregateId !== input.aggregateId || current.projectionSha256 !== input.projectionSha256 || current.captureFrameId !== input.captureFrameId) return fail('ENDPOINT_CONTEXT_CHANGED'); }
async function oldCommand(c: PoolClient, projectId: string, who: JobPrincipal, key: string, kind: string, command: unknown): Promise<unknown | null> {
  const row = (await c.query<{ kind: string; request_sha256: string; request: unknown; receipt: unknown }>('SELECT kind,request_sha256,request,receipt FROM pf_endpoint_binding_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, key])).rows[0]; if (!row) return null;
  if (row.kind !== kind || row.request_sha256 !== endpointBindingHash(command) || canonicalPurposeJson(row.request) !== canonicalPurposeJson(command)) return fail('ENDPOINT_IDEMPOTENCY_CONFLICT'); return row.receipt;
}
async function saveCommand(c: PoolClient, projectId: string, who: JobPrincipal, key: string, kind: string, command: unknown, receipt: unknown) { await c.query('INSERT INTO pf_endpoint_binding_commands(project_id,actor_id,idempotency_key,kind,request_sha256,request,receipt) VALUES($1,$2,$3,$4,$5,$6,$7)', [projectId, who.userId, key, kind, endpointBindingHash(command), command, budget(receipt)]); }

type BindingProposal = Pick<EndpointBinding, 'mode' | 'pointProjectMetres' | 'derivation' | 'sourceObject' | 'attachment' | 'qualifiedProjectFrameId' | 'sourceDecisionId'>;
async function checkLocation(c: PoolClient, pid: string, id: string, expectedLocationRevision: string | null, expectedHeadId: string | null) {
  const value = await location(c, pid, id), previous = value ? await head(c, pid, id) : null;
  if (expectedLocationRevision === null ? value !== null : !value || value.revision !== expectedLocationRevision) return fail('ENDPOINT_LOCATION_CONFLICT');
  if ((previous?.id ?? null) !== expectedHeadId) return fail('ENDPOINT_HEAD_CONFLICT'); return { value, previous };
}
async function observeLegacy(c: PoolClient, pid: string, locationId: string, current: EndpointCurrentScope): Promise<{ id: string; point: EndpointBinding['pointProjectMetres'] } | null> {
  const value = await legacy(c, pid, locationId, current.modelVersionId); if (!value) return null;
  const original = (await c.query<{ row_text: string }>('SELECT row_to_json(b)::text AS row_text FROM pf_location_bindings b WHERE project_id=$1 AND location_id=$2 AND model_version_id=$3 AND revision=$4 FOR SHARE', [pid, locationId, value.modelVersionId, value.revision])).rows[0]; if (!original || Buffer.byteLength(original.row_text) > 65536) return fail('ENDPOINT_LEGACY_INTEGRITY');
  const evidence = { schemaVersion: 'wfc.pf.endpoint-legacy-observation.v1', projectId: pid, locationId, modelVersionId: value.modelVersionId, legacyRevision: value.revision, sourceRowText: original.row_text, authority: 'historical-observation-only', modeInterpretation: 'fixed-world', frameQualification: null }, sha = endpointBindingHash(evidence);
  const old = (await c.query<{ id: string; record_sha256: string; record: unknown }>('SELECT id,record_sha256,record FROM pf_endpoint_legacy_observations WHERE project_id=$1 AND location_id=$2 AND model_version_id=$3 AND legacy_revision=$4', [pid, locationId, value.modelVersionId, value.revision])).rows[0];
  if (old) { if (old.record_sha256 !== sha || endpointBindingHash(old.record) !== sha) return fail('ENDPOINT_LEGACY_INTEGRITY'); return { id: old.id, point: value.pointProjectMetres }; }
  const id = randomUUID(); await c.query('INSERT INTO pf_endpoint_legacy_observations(id,project_id,location_id,model_version_id,legacy_revision,record_sha256,record) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, pid, locationId, value.modelVersionId, value.revision, sha, evidence]); return { id, point: value.pointProjectMetres };
}
async function commitBinding(c: PoolClient, pid: string, who: JobPrincipal, locationId: string, names: { name: string; aliases: string[] }, current: EndpointCurrentScope, before: { value: EndpointBindingContext['location']; previous: EndpointBinding | null }, revision: string, reason: string, proposal: BindingProposal, signal?: AbortSignal) {
  const { value, previous } = before;
  const same = value && previous && previous.status === 'confirmed' && previous.locationRevision === value.revision && value.name === names.name && canonicalPurposeJson([...value.aliases].sort()) === canonicalPurposeJson([...names.aliases].sort()) && previous.modelVersionId === current.modelVersionId && previous.aggregateId === current.aggregateId && previous.artifactId === current.artifactId && previous.projectionSha256 === current.projectionSha256 && previous.captureFrameId === current.captureFrameId && Object.entries(proposal).every(([key, desired]) => canonicalPurposeJson(previous[key as keyof EndpointBinding]) === canonicalPurposeJson(desired));
  if (same) return endpointBindingReceiptSchema.parse({ schemaVersion: 'wfc.pf.endpoint-binding-receipt.v1', projectId: pid, locationId, registryRevision: previous.locationRegistryRevision, locationRevision: previous.locationRevision, binding: previous, duplicate: true });
  const normalized = [names.name, ...names.aliases].map(normalizeLocation);
  const conflict = await c.query('SELECT location_id FROM pf_location_aliases WHERE project_id=$1 AND location_id<>$2 AND normalized_alias=ANY($3::text[]) LIMIT 1', [pid, locationId, normalized]); if (conflict.rows.length) return fail('LOCATION_ALIAS_CONFLICT');
  const legacyObservation = value ? await observeLegacy(c, pid, locationId, current) : null;
  const locationRevision = value ? increment(value.revision) : '1', bindingRevision = previous ? increment(previous.bindingRevision) : '1', nextRegistry = increment(revision), priorPoint = previous?.pointProjectMetres ?? legacyObservation?.point ?? null;
  const priorCaptureFrameId = previous?.captureFrameId ?? null, sameFrame = priorPoint !== null && priorCaptureFrameId === current.captureFrameId;
  const displacement = sameFrame ? proposal.pointProjectMetres.map((n, i) => n - priorPoint[i]) : null;
  const draft = endpointBindingSchema.parse({ schemaVersion: 'wfc.pf.endpoint-binding.v1', id: randomUUID(), projectId: pid, locationId, locationRevision, bindingRevision, locationRegistryRevision: nextRegistry, modelVersionId: current.modelVersionId, aggregateId: current.aggregateId, artifactId: current.artifactId, projectionSha256: current.projectionSha256, captureFrameId: current.captureFrameId, status: 'confirmed', ...proposal, supersedesBindingId: previous?.id ?? null, legacyObservationId: legacyObservation?.id ?? null, priorPointProjectMetres: priorPoint, priorCaptureFrameId, displacementBasis: priorPoint === null ? 'none' : sameFrame ? 'same-capture-frame' : 'unverified-frames', displacementVectorMetres: displacement, displacementMetres: displacement ? Math.hypot(...displacement) : null, confirmedBy: who.userId, confirmedAt: new Date().toISOString(), reason, contentSha256: '0'.repeat(64) });
  const { contentSha256: _sha, ...body } = draft, binding = endpointBindingSchema.parse({ ...draft, contentSha256: endpointBindingHash(body) }); if (Buffer.byteLength(canonicalPurposeJson(binding)) > ENDPOINT_BINDING_LIMITS.controlBytes) return fail('ENDPOINT_BINDING_LIMIT', 413);
  signal?.throwIfAborted(); assertLoginNotExpired(who);
  if (value) await c.query('UPDATE pf_locations SET name=$3,revision=$4,updated_at=NOW() WHERE project_id=$1 AND id=$2', [pid, locationId, names.name, locationRevision]);
  else await c.query('INSERT INTO pf_locations(id,project_id,name,revision,created_by) VALUES($1,$2,$3,$4,$5)', [locationId, pid, names.name, locationRevision, who.userId]);
  await c.query('DELETE FROM pf_location_aliases WHERE project_id=$1 AND location_id=$2', [pid, locationId]);
  for (const display of [names.name, ...names.aliases]) { signal?.throwIfAborted(); assertLoginNotExpired(who); await c.query('INSERT INTO pf_location_aliases(project_id,normalized_alias,display_alias,location_id) VALUES($1,$2,$3,$4)', [pid, normalizeLocation(display), display, locationId]); }
  await c.query('INSERT INTO pf_endpoint_binding_revisions(id,project_id,location_id,model_version_id,aggregate_id,binding_revision,trace_id,object_revision_id,record_sha256,record,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [binding.id, pid, locationId, current.modelVersionId, current.aggregateId, bindingRevision, binding.sourceObject?.traceId ?? null, binding.sourceObject?.objectRevisionId ?? null, binding.contentSha256, binding, who.userId]);
  signal?.throwIfAborted(); assertLoginNotExpired(who);
  await c.query('INSERT INTO pf_endpoint_binding_heads(project_id,location_id,binding_id,binding_revision) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,location_id) DO UPDATE SET binding_id=EXCLUDED.binding_id,binding_revision=EXCLUDED.binding_revision', [pid, locationId, binding.id, bindingRevision]);
  await c.query('UPDATE pf_project_state SET registry_revision=$2,updated_at=NOW() WHERE project_id=$1', [pid, nextRegistry]);
  return endpointBindingReceiptSchema.parse({ schemaVersion: 'wfc.pf.endpoint-binding-receipt.v1', projectId: pid, locationId, registryRevision: nextRegistry, locationRevision, binding, duplicate: false });
}

export interface EndpointBindingAdapters { evaluateMigration?: (client: PoolClient, source: EndpointBinding, target: EndpointCurrentScope, command: z.infer<typeof endpointMigrationWriteSchema>) => Promise<EndpointMigrationEvaluation>; }
export function createEndpointBindingRepository(pool: Pool, adapters: EndpointBindingAdapters = {}) {
  const tx = <T>(pid: string, who: JobPrincipal, operation: (c: PoolClient) => Promise<T>, signal?: AbortSignal) => endpointBindingTransaction(pool, pid, who, operation, signal);
  const authorize = (pid: string, who: JobPrincipal) => tx(pid, who, async () => undefined);
  async function context(pid: string, who: JobPrincipal, locationId: string) { policyUuidSchema.parse(locationId); return tx(pid, who, async c => {
    const revision = await registry(c, pid), selected = await readCurrentEndpointBindingContext(c, pid), value = await location(c, pid, locationId), binding = value ? await head(c, pid, locationId) : null;
    const hasEquipment = !!selected?.traceId && (await c.query("SELECT id FROM pf_geometry_object_revisions WHERE project_id=$1 AND trace_id=$2 AND record#>>'{geometry,role}'='object' AND record#>'{geometry,equipmentAnchor}' IS NOT NULL AND record#>'{geometry,equipmentAnchor}'<>'null'::jsonb LIMIT 1", [pid, selected.traceId])).rows.length === 1;
    return budget(endpointBindingContextSchema.parse({ schemaVersion: 'wfc.pf.endpoint-binding-context.v1', projectId: pid, locationId, registryRevision: revision, location: value, current: selected, head: binding, legacy: value ? await legacy(c, pid, locationId, selected?.modelVersionId ?? null) : null, capabilities: [{ mode: 'fixed-world', supported: selected !== null, reasonCodes: selected ? [] : ['ENDPOINT_PREPARATION_REQUIRED'] }, { mode: 'object-derived', supported: hasEquipment, reasonCodes: hasEquipment ? [] : ['ENDPOINT_EQUIPMENT_ANCHOR_REQUIRED'] }, { mode: 'object-attached', supported: false, reasonCodes: ['ENDPOINT_ATTACHMENT_EVIDENCE_UNAVAILABLE'] }], readiness: readiness(binding, selected, value?.revision ?? null), usage: usageIndex(await cableEndpoints(c, pid))(value) }));
  }); }
  async function confirm(pid: string, who: JobPrincipal, locationId: string, raw: unknown, signal?: AbortSignal) {
    await authorize(pid, who); policyUuidSchema.parse(locationId); const input = endpointBindingWriteSchema.parse(raw), command = { locationId, input };
    return tx(pid, who, async c => {
      const old = await oldCommand(c, pid, who, input.idempotencyKey, 'confirm', command); if (old) return endpointBindingReceiptSchema.parse({ ...old as object, duplicate: true });
      const revision = await registry(c, pid, input.expectedRegistryRevision), before = await checkLocation(c, pid, locationId, input.expectedLocationRevision, input.expectedHeadId), current = await readCurrentEndpointBindingContext(c, pid); assertScope(current, input);
      let proposal: BindingProposal;
      if (input.mode === 'object-attached') return fail('ENDPOINT_ATTACHMENT_EVIDENCE_UNAVAILABLE');
      if (input.mode === 'fixed-world') { if (input.provenanceObject) await objectEvidence(c, pid, current, input.provenanceObject); proposal = { mode: input.mode, pointProjectMetres: input.pointProjectMetres, derivation: input.derivation, sourceObject: input.provenanceObject, attachment: null, qualifiedProjectFrameId: null, sourceDecisionId: null }; }
      else { const object = await objectEvidence(c, pid, current, input.object); if (object.geometry.role !== 'object' || !object.geometry.equipmentAnchor) return fail('ENDPOINT_EQUIPMENT_ANCHOR_REQUIRED'); const point = deriveEquipmentBottomAnchor(object.geometry.bounds); if (canonicalPurposeJson(point) !== canonicalPurposeJson(object.geometry.equipmentAnchor.pointMetres)) return fail('ENDPOINT_OBJECT_ANCHOR_INTEGRITY'); proposal = { mode: input.mode, pointProjectMetres: point, derivation: ENDPOINT_ANCHOR_RULE, sourceObject: input.object, attachment: null, qualifiedProjectFrameId: null, sourceDecisionId: null }; }
      const receipt = await commitBinding(c, pid, who, locationId, input.location, current, before, revision, input.reason, proposal, signal); await saveCommand(c, pid, who, input.idempotencyKey, 'confirm', command, receipt); return receipt;
    }, signal);
  }
  async function list(pid: string, who: JobPrincipal, raw: { offset?: number; limit?: number } = {}) { return tx(pid, who, async c => {
    const { offset, limit } = z.object({ offset: z.number().int().nonnegative().max(1_000_000).default(0), limit: z.number().int().min(1).max(100).default(25) }).strict().parse(raw), revision = await registry(c, pid), selected = await readCurrentEndpointBindingContext(c, pid), usage = usageIndex(await cableEndpoints(c, pid));
    const total = Number((await c.query<{ count: string }>('SELECT count(*)::text AS count FROM pf_locations WHERE project_id=$1', [pid])).rows[0].count); if (!Number.isSafeInteger(total) || total > 1_000_000) return fail('ENDPOINT_LOCATION_LIMIT', 413);
    const rows = (await c.query<{ id: string }>('SELECT id FROM pf_locations WHERE project_id=$1 ORDER BY name,id LIMIT $2 OFFSET $3', [pid, limit, offset])).rows, locations = [];
    for (const row of rows) { assertLoginNotExpired(who); const value = await location(c, pid, row.id); if (!value) return fail('ENDPOINT_LOCATION_CHANGED'); const binding = await head(c, pid, row.id); locations.push({ location: value, head: binding ? summary(binding) : null, readiness: readiness(binding, selected, value.revision), usage: usage(value) }); }
    return budget(endpointBindingPageSchema.parse({ schemaVersion: 'wfc.pf.endpoint-binding-page.v1', projectId: pid, registryRevision: revision, offset, limit, total, nextOffset: offset + rows.length < total ? offset + rows.length : null, locations }));
  }); }
  async function history(pid: string, who: JobPrincipal, locationId: string, raw: { beforeRevision?: string; limit?: number } = {}) { policyUuidSchema.parse(locationId); return tx(pid, who, async c => {
    const { beforeRevision, limit } = z.object({ beforeRevision: policyRevisionSchema.optional(), limit: z.number().int().min(1).max(100).default(25) }).strict().parse(raw); if (!await location(c, pid, locationId)) return fail('LOCATION_NOT_FOUND', 404);
    const rows = (await c.query<{ record: unknown }>('SELECT record FROM pf_endpoint_binding_revisions WHERE project_id=$1 AND location_id=$2 AND ($3::bigint IS NULL OR binding_revision<$3) ORDER BY binding_revision DESC LIMIT $4', [pid, locationId, beforeRevision ?? null, limit + 1])).rows;
    const bindings: EndpointBinding[] = []; let bytes = 1024;
    for (const row of rows.slice(0, limit)) { const value = record(row.record), size = Buffer.byteLength(canonicalPurposeJson(value)); if (bytes + size > ENDPOINT_BINDING_LIMITS.responseBytes) break; bindings.push(value); bytes += size; }
    if (rows.length && !bindings.length) return fail('ENDPOINT_RESPONSE_LIMIT', 413);
    return budget(endpointBindingHistorySchema.parse({ schemaVersion: 'wfc.pf.endpoint-binding-history.v1', projectId: pid, locationId, bindings, nextBeforeRevision: rows.length > bindings.length ? bindings.at(-1)?.bindingRevision ?? null : null }));
  }); }
  async function migrate(pid: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal) {
    await authorize(pid, who); const input = endpointMigrationWriteSchema.parse(raw);
    return tx(pid, who, async c => {
      const old = await oldCommand(c, pid, who, input.idempotencyKey, 'migration', input); if (old) return validHash(endpointMigrationDecisionSchema.parse(old));
      await registry(c, pid, input.expectedRegistryRevision);
      const row = (await c.query<{ record: unknown }>('SELECT record FROM pf_endpoint_binding_revisions WHERE project_id=$1 AND id=$2 FOR SHARE', [pid, input.sourceBindingId])).rows[0]; if (!row) return fail('ENDPOINT_SOURCE_BINDING_NOT_FOUND', 404); const source = record(row.record);
      if (source.id !== input.sourceBindingId || source.projectId !== pid) return fail('ENDPOINT_SOURCE_BINDING_INTEGRITY');
      const before = await checkLocation(c, pid, source.locationId, input.expectedLocationRevision, input.expectedHeadId); if (before.previous?.id !== source.id) return fail('ENDPOINT_HEAD_CONFLICT');
      const target = await readCurrentEndpointBindingContext(c, pid); assertScope(target, { modelVersionId: input.targetModelVersionId, aggregateId: input.targetAggregateId, projectionSha256: input.targetProjectionSha256, captureFrameId: input.targetCaptureFrameId, expectedSelectionRevision: input.expectedSelectionRevision });
      if (!adapters.evaluateMigration && (input.objectDecisionId !== null || input.frameDecisionId !== null)) return fail('ENDPOINT_MIGRATION_EVIDENCE_UNAVAILABLE');
      const evaluation = endpointMigrationEvaluationSchema.parse(adapters.evaluateMigration ? await adapters.evaluateMigration(c, source, target, input) : evaluateEndpointMigration({ sourceBinding: source, targetAggregate: target, objectMapping: null, frameMapping: null, sourceObject: null, targetObject: null, validationPolicy: null }));
      if (evaluation.sourceBindingId !== source.id || canonicalPurposeJson(evaluation.sourcePointProjectMetres) !== canonicalPurposeJson(source.pointProjectMetres)) return fail('ENDPOINT_MIGRATION_INTEGRITY');
      const { idempotencyKey: _key, ...identity } = input, inputSha = endpointBindingHash({ input: identity, sourceSha256: source.contentSha256, target, evaluation });
      const existing = (await c.query<{ record: unknown; record_sha256: string }>('SELECT record,record_sha256 FROM pf_endpoint_migration_decisions WHERE project_id=$1 AND input_sha256=$2', [pid, inputSha])).rows[0];
      let decision;
      if (existing) { decision = validHash(endpointMigrationDecisionSchema.parse(existing.record)); if (decision.contentSha256 !== existing.record_sha256) return fail('ENDPOINT_MIGRATION_INTEGRITY'); }
      else {
        const draft = endpointMigrationDecisionSchema.parse({ schemaVersion: 'wfc.pf.endpoint-migration-decision.v1', id: randomUUID(), projectId: pid, locationId: source.locationId, sourceBindingId: source.id, sourceHeadId: input.expectedHeadId, expectedLocationRevision: input.expectedLocationRevision, expectedRegistryRevision: input.expectedRegistryRevision, target, evaluation, createdBy: who.userId, createdAt: new Date().toISOString(), reason: input.reason, contentSha256: '0'.repeat(64) }); const { contentSha256: _sha, ...body } = draft;
        decision = endpointMigrationDecisionSchema.parse({ ...draft, contentSha256: endpointBindingHash(body) });
        await c.query('INSERT INTO pf_endpoint_migration_decisions(id,project_id,location_id,source_binding_id,target_aggregate_id,input_sha256,record_sha256,record,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [decision.id, pid, source.locationId, source.id, target.aggregateId, inputSha, decision.contentSha256, decision, who.userId]);
      }
      await saveCommand(c, pid, who, input.idempotencyKey, 'migration', input, decision); return budget(decision);
    }, signal);
  }
  async function confirmMigration(pid: string, who: JobPrincipal, decisionId: string, raw: unknown, signal?: AbortSignal) {
    await authorize(pid, who); policyUuidSchema.parse(decisionId); const input = endpointMigrationConfirmSchema.parse(raw), command = { decisionId, input };
    return tx(pid, who, async c => {
      const old = await oldCommand(c, pid, who, input.idempotencyKey, 'migration-confirm', command); if (old) return endpointBindingReceiptSchema.parse({ ...old as object, duplicate: true });
      const revision = await registry(c, pid, input.expectedRegistryRevision), row = (await c.query<{ record: unknown; record_sha256: string }>('SELECT record,record_sha256 FROM pf_endpoint_migration_decisions WHERE project_id=$1 AND id=$2 FOR SHARE', [pid, decisionId])).rows[0]; if (!row) return fail('ENDPOINT_MIGRATION_NOT_FOUND', 404);
      const decision = validHash(endpointMigrationDecisionSchema.parse(row.record)); if (decision.projectId !== pid || decision.id !== decisionId || row.record_sha256 !== decision.contentSha256 || input.expectedDecisionSha256 !== decision.contentSha256) return fail('ENDPOINT_MIGRATION_INTEGRITY');
      const before = await checkLocation(c, pid, decision.locationId, input.expectedLocationRevision, input.expectedHeadId); if (!before.value || before.previous?.id !== decision.sourceHeadId || input.expectedHeadId !== decision.sourceHeadId || input.expectedLocationRevision !== decision.expectedLocationRevision || input.expectedRegistryRevision !== decision.expectedRegistryRevision) return fail('ENDPOINT_MIGRATION_STALE');
      const current = await readCurrentEndpointBindingContext(c, pid); if (!current || current.selectionRevision !== input.expectedSelectionRevision || canonicalPurposeJson(current) !== canonicalPurposeJson(decision.target)) return fail('ENDPOINT_CONTEXT_CHANGED');
      const { proposal, targetPointProjectMetres } = decision.evaluation;
      if (!proposal || !targetPointProjectMetres || !['carried-fixed', 'carried-rigid', 'rederived'].includes(decision.evaluation.disposition) || decision.evaluation.reasonCodes.length || decision.evaluation.status !== 'suggested') return fail('ENDPOINT_MIGRATION_REQUIRES_RESOLUTION');
      if (proposal.mode === 'object-attached') return fail('ENDPOINT_ATTACHMENT_EVIDENCE_UNAVAILABLE');
      if (proposal.sourceObject) { const object = await objectEvidence(c, pid, current, proposal.sourceObject); if (proposal.mode === 'object-derived' && (object.geometry.role !== 'object' || !object.geometry.equipmentAnchor || canonicalPurposeJson(targetPointProjectMetres) !== canonicalPurposeJson(deriveEquipmentBottomAnchor(object.geometry.bounds)) || canonicalPurposeJson(targetPointProjectMetres) !== canonicalPurposeJson(object.geometry.equipmentAnchor.pointMetres))) return fail('ENDPOINT_EQUIPMENT_ANCHOR_REQUIRED'); }
      const receipt = await commitBinding(c, pid, who, decision.locationId, before.value, current, before, revision, input.reason, { ...proposal, pointProjectMetres: targetPointProjectMetres, sourceDecisionId: decision.id }, signal);
      await saveCommand(c, pid, who, input.idempotencyKey, 'migration-confirm', command, receipt); return receipt;
    }, signal);
  }
  return { authorize, context, list, history, confirm, migrate, confirmMigration };
}
export type EndpointBindingRepository = ReturnType<typeof createEndpointBindingRepository>;
