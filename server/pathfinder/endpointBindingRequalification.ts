import { randomUUID } from 'node:crypto';
import { readCableEndpointSelection } from './cableEndpointSelection.js';
import type { Pool, PoolClient } from 'pg';
import { endpointBindingSchema, endpointRequalifySchema, endpointRequalifyReceiptSchema, type EndpointBinding, type EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { preparationAggregateSchema } from '../../shared/pathfinderPreparation.js';
import { geometryTraceManifestSchema, geometryObjectRevisionSchema, GEOMETRY_TRACE_LIMITS } from '../../shared/pathfinderGeometryTrace.js';
import { canonicalPurposeJson, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import { endpointBindingHash, endpointBindingTransaction, objectEvidence, readCurrentEndpointBindingContext, readNeededEndpointBindingHeads } from './endpointBindingRepository.js';
import { barrierFrameProjectionHash } from './barrierScope.js';
import { normalizeLocation } from './matching.js';
import { assertLoginNotExpired } from './auth.js';
import { PathFinderError } from './errors.js';
import type { JobPrincipal } from './jobContracts.js';

const fail = (code = 'ENDPOINT_REQUALIFICATION_UNAVAILABLE'): never => { throw new PathFinderError(code, 409,
  'The saved location could not be verified against the current model coordinate frame. Its saved point is retained. Check this location before calculating routing.'); };
const same = (left: unknown, right: unknown) => canonicalPurposeJson(left) === canonicalPurposeJson(right);
const scopeMatches = (binding: EndpointBinding, current: EndpointCurrentScope) => binding.modelVersionId === current.modelVersionId
  && binding.aggregateId === current.aggregateId && binding.artifactId === current.artifactId
  && binding.projectionSha256 === current.projectionSha256 && binding.captureFrameId === current.captureFrameId;

/** Verifies a historical/current publication and its actual common world frame.
 * Equal deterministic frame IDs alone never establish this proof. */
export async function readEndpointPublicationFrame(client: PoolClient, projectId: string, aggregateId: string, traceId: string | null = null) {
  const rows = (await client.query<{ aggregate: unknown; trace: unknown; artifact_id: string; snapshot_sha256: string }>(`/* endpoint-requalify:publication */
    SELECT a.manifest AS aggregate,t.manifest AS trace,f.id AS artifact_id,f.snapshot_sha256
    FROM pf_preparation_aggregates a JOIN pf_artifacts f ON f.project_id=a.project_id AND f.id=a.artifact_id
    JOIN pf_geometry_trace_sets t ON t.project_id=a.project_id AND t.aggregate_id=a.id
    WHERE a.project_id=$1 AND a.id=$2 AND ($3::uuid IS NULL OR t.id=$3) AND octet_length(a.manifest::text)<=16777216 AND octet_length(t.manifest::text)<=262144
    ORDER BY t.created_at DESC,t.id DESC LIMIT 1 FOR SHARE OF a,f,t`, [projectId, aggregateId, traceId])).rows;
  if (rows.length !== 1) return fail();
  const a = preparationAggregateSchema.safeParse(rows[0].aggregate), t = geometryTraceManifestSchema.safeParse(rows[0].trace);
  if (!a.success || !t.success) return fail();
  const aggregate = a.data, trace = t.data, { contentSha256, ...body } = trace;
  if (endpointBindingHash(body) !== contentSha256 || aggregate.projectId !== projectId || aggregate.id !== aggregateId || trace.projectId !== projectId || traceId !== null && trace.id !== traceId
    || trace.aggregateId !== aggregate.id || trace.modelVersionId !== aggregate.modelVersionId || trace.captureFrameId !== aggregate.coordinateFrameId
    || trace.projection.sha256 !== aggregate.projection.sha256 || trace.sessionId !== aggregate.sessionId || trace.geometryRevision !== aggregate.geometryRevision
    || aggregate.artifactId !== rows[0].artifact_id || aggregate.projection.sha256 !== rows[0].snapshot_sha256) return fail();
  const frames = (await client.query<{ frame: unknown; record: unknown; record_sha256: string }>(`/* endpoint-requalify:frame */ SELECT DISTINCT ON
    (record->'coordinates'->'displayToWorldMetres',record->'coordinates'->'globalOffsetMetres')
    jsonb_build_object('coordinateFrame','canonical-world-metres','displayToWorldMetres',record->'coordinates'->'displayToWorldMetres',
      'globalOffsetMetres',record->'coordinates'->'globalOffsetMetres') AS frame,
    CASE WHEN octet_length(record::text)<=$3 THEN record ELSE NULL END AS record,summary->>'recordSha256' AS record_sha256
    FROM pf_geometry_object_revisions WHERE project_id=$1 AND trace_id=$2
    ORDER BY record->'coordinates'->'displayToWorldMetres',record->'coordinates'->'globalOffsetMetres',id LIMIT 2`,
  [projectId, trace.id, GEOMETRY_TRACE_LIMITS.objectBytes])).rows;
  if (frames.length !== 1) return fail();
  const parsed = geometryObjectRevisionSchema.safeParse(frames[0].record); if (!parsed.success) return fail();
  const object = parsed.data;
  if (endpointBindingHash(object) !== frames[0].record_sha256 || object.projectId !== projectId || object.traceId !== trace.id
    || object.modelVersionId !== aggregate.modelVersionId || object.aggregateId !== aggregate.id || object.coordinates.captureFrameId !== trace.captureFrameId
    || object.provenance.contentFingerprint !== aggregate.contentFingerprint || object.provenance.projectionSha256 !== aggregate.projection.sha256
    || object.provenance.sessionId !== aggregate.sessionId || object.geometry.mesh.projection.sha256 !== aggregate.projection.sha256
    || object.geometry.mesh.projection.payloadRef !== aggregate.projection.payloadRef || object.geometry.mesh.projection.bytes !== aggregate.projection.bytes) return fail();
  let frameSha256: string;
  try {
    frameSha256 = barrierFrameProjectionHash(frames[0].frame);
    if (frameSha256 !== barrierFrameProjectionHash({ coordinateFrame: 'canonical-world-metres', displayToWorldMetres: object.coordinates.displayToWorldMetres,
      globalOffsetMetres: object.coordinates.globalOffsetMetres })) return fail();
  } catch { return fail(); }
  return { aggregate, trace, frameSha256 };
}

/** Explicit calculation preflight: carry at most this cable's two shared
 * locations or their verified object anchors, retaining the original confirmation. */
export function requalifyCableEndpointBindings(pool: Pool, projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal) {
  endpointRequalifySchema.parse(raw);
  return endpointBindingTransaction(pool, projectId, who, client => requalifyCableEndpointBindingsInTransaction(client, projectId, who, raw, signal));
}

type FrameCache = Map<string, Promise<Awaited<ReturnType<typeof readEndpointPublicationFrame>>>>;
async function publicationPair(client: PoolClient, projectId: string, binding: EndpointBinding, current: EndpointCurrentScope, frames: FrameCache) {
  const frame = (aggregateId: string, traceId: string | null) => {
    const key = aggregateId + ':' + (traceId ?? '');
    if (!frames.has(key)) frames.set(key, readEndpointPublicationFrame(client, projectId, aggregateId, traceId));
    return frames.get(key)!;
  };
  const source = await frame(binding.aggregateId, binding.sourceObject?.traceId ?? binding.sameModelReuse?.targetTraceId ?? null);
  const target = await frame(current.aggregateId, current.traceId);
  if (source.aggregate.modelVersionId !== current.modelVersionId || target.aggregate.modelVersionId !== current.modelVersionId
    || source.aggregate.contentFingerprint !== current.contentFingerprint || target.aggregate.contentFingerprint !== current.contentFingerprint
    || source.aggregate.artifactId !== binding.artifactId || source.aggregate.projection.sha256 !== binding.projectionSha256
    || source.aggregate.coordinateFrameId !== binding.captureFrameId || target.aggregate.artifactId !== current.artifactId
    || target.aggregate.projection.sha256 !== current.projectionSha256 || target.aggregate.coordinateFrameId !== current.captureFrameId
    || target.trace.id !== current.traceId || source.frameSha256 !== target.frameSha256) return fail();
  return { source, target };
}

async function resolveEquipment(client: PoolClient, projectId: string, binding: EndpointBinding, current: EndpointCurrentScope, check: () => void) {
  if (!binding.sourceObject || binding.mode !== 'object-derived' || binding.status !== 'confirmed'
    || binding.projectId !== projectId || binding.sourceDecisionId !== null) return null;
  try {
    const original = await objectEvidence(client, projectId, { ...current, aggregateId: binding.aggregateId,
      projectionSha256: binding.projectionSha256, captureFrameId: binding.captureFrameId }, binding.sourceObject);
    check();
    if (!original.identity.dbId || original.provenance.contentFingerprint !== current.contentFingerprint
      || !same(original.geometry.equipmentAnchor?.pointMetres ?? null, binding.pointProjectMetres)) return null;
    const selected = await readCableEndpointSelection(client, { projectId, current, sdkObjectId: original.identity.dbId }, check);
    if (!selected.object || !same(selected.pointProjectMetres, binding.pointProjectMetres)
      || !same(selected.bounds, original.geometry.bounds)) return null;
    const object = await objectEvidence(client, projectId, current, selected.object);
    return same(original.identity, object.identity) ? selected : null;
  } catch (error) {
    if (error instanceof PathFinderError && ['ENDPOINT_OBJECT_NOT_FOUND', 'ENDPOINT_OBJECT_SCOPE'].includes(error.code)) return null;
    throw error;
  }
}

/** Prove an assigned object for display before its binding is carried for calculation. */
export async function readRequalifiedEndpointObject(client: PoolClient, projectId: string, binding: EndpointBinding, current: EndpointCurrentScope, check: () => void) {
  if (binding.mode !== 'object-derived' || binding.modelVersionId !== current.modelVersionId) return null;
  try {
    await publicationPair(client, projectId, binding, current, new Map()); check();
    return await resolveEquipment(client, projectId, binding, current, check);
  } catch (error) {
    if (error instanceof PathFinderError && error.code === 'ENDPOINT_REQUALIFICATION_UNAVAILABLE') return null;
    throw error;
  }
}

/** Caller owns the project/authority transaction; cached frames are immutable and transaction-local. */
export async function requalifyCableEndpointBindingsInTransaction(client: PoolClient, projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal, frameCache?: FrameCache, onlyLocationId?: string) {
  const command = endpointRequalifySchema.parse(raw), request = { schemaVersion: 'wfc.pf.endpoint-requalify-owner.v1', command,
    ...(onlyLocationId ? { onlyLocationId } : {}) };
  const commandSha256 = endpointBindingHash(command);
    const check = () => { signal?.throwIfAborted(); assertLoginNotExpired(who); }; check();
    const saved = (await client.query<{ kind: string; request_sha256: string; request: unknown; receipt: unknown }>(`/* endpoint-requalify:replay */
      SELECT kind,request_sha256,request,receipt FROM pf_endpoint_binding_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 FOR SHARE`,
    [projectId, who.userId, command.idempotencyKey])).rows[0];
    if (saved) {
      if (saved.kind !== 'confirm' || saved.request_sha256 !== endpointBindingHash(request) || !same(saved.request, request)) return fail('ENDPOINT_REQUALIFICATION_IDEMPOTENCY_CONFLICT');
      const receipt = endpointRequalifyReceiptSchema.parse(saved.receipt);
      if (receipt.projectId !== projectId || receipt.cableId !== command.cableId || receipt.idempotencyKey !== command.idempotencyKey || receipt.commandSha256 !== commandSha256)
        return fail('ENDPOINT_REQUALIFICATION_RECEIPT_INVALID');
      return { ...receipt, duplicate: true };
    }
    const current = await readCurrentEndpointBindingContext(client, projectId);
    if (!current || !same(current, command.expectedCurrent)) return fail('ENDPOINT_REQUALIFICATION_CONTEXT_CHANGED');
    const cable = (await client.query<{ from_location: string | null; to_location: string | null }>(`/* endpoint-requalify:cable */
      SELECT from_location,to_location FROM cables WHERE project_id=$1 AND id=$2 FOR SHARE`, [projectId, command.cableId])).rows[0];
    if (!cable) return fail('CABLE_NOT_FOUND');
    const names = [...new Set([cable.from_location, cable.to_location].filter((name): name is string => Boolean(name?.trim())).map(normalizeLocation))];
    type Head = { normalized_alias: string; location_id: string; location_revision: string; binding_id: string | null; binding_revision: string | null; record_sha256: string | null; record: unknown };
    const rows = (await client.query<Head>(`/* endpoint-requalify:heads */ SELECT a.normalized_alias,l.id AS location_id,l.revision::text AS location_revision,
      h.binding_id,h.binding_revision::text,r.record_sha256,CASE WHEN octet_length(r.record::text)<=65536 THEN r.record ELSE NULL END AS record
      FROM pf_location_aliases a JOIN pf_locations l ON l.project_id=a.project_id AND l.id=a.location_id
      JOIN pf_endpoint_binding_heads h ON h.project_id=l.project_id AND h.location_id=l.id
      JOIN pf_endpoint_binding_revisions r ON r.project_id=h.project_id AND r.location_id=h.location_id AND r.id=h.binding_id
      WHERE a.project_id=$1 AND a.normalized_alias=ANY($2::text[]) ORDER BY l.id,a.normalized_alias LIMIT 3 FOR SHARE OF a,l,h,r`, [projectId, names])).rows;
    if (rows.length > 2 || new Set(rows.map(row => row.normalized_alias)).size !== rows.length) return fail();
    const byLocation = new Map<string, { row: Head; binding: EndpointBinding }>();
    for (const row of rows) {
      if (onlyLocationId && row.location_id !== onlyLocationId) continue;
      const binding = endpointBindingSchema.parse(row.record), { contentSha256, ...body } = binding;
      if (!names.includes(row.normalized_alias) || binding.id !== row.binding_id || binding.projectId !== projectId || binding.locationId !== row.location_id
        || binding.bindingRevision !== row.binding_revision || contentSha256 !== row.record_sha256 || endpointBindingHash(body) !== contentSha256) return fail('ENDPOINT_HEAD_INTEGRITY');
      byLocation.set(row.location_id, { row, binding });
    }
    const updatedLocationIds: string[] = [], frames = frameCache ?? new Map<string, Promise<Awaited<ReturnType<typeof readEndpointPublicationFrame>>>>();
    for (const { row, binding } of byLocation.values()) {
      check();
      if (scopeMatches(binding, current) && (binding.mode !== 'object-derived' || binding.sourceObject?.traceId === current.traceId) && (binding.sameModelReuse
        ? binding.sameModelReuse.targetTraceId === current.traceId && binding.sameModelReuse.contentFingerprint === current.contentFingerprint
        : !['matched-model-bottom-aabb.v1','matched-model-centre-fallback.v1'].includes(binding.derivation) || same(binding.centreFallbackEvidence?.current ?? binding.autoMatchEvidence?.current, current))) continue;
      if (binding.mode === 'object-attached' || binding.status !== 'confirmed' || binding.locationRevision !== row.location_revision
        || binding.mode === 'fixed-world' && binding.sourceObject !== null || binding.attachment !== null || binding.sourceDecisionId !== null || binding.modelVersionId !== current.modelVersionId) return fail();
      const { source, target } = await publicationPair(client, projectId, binding, current, frames); check();
      const derived = binding.mode === 'object-derived'
        ? await resolveEquipment(client, projectId, binding, current, check) : null;
      if (binding.mode === 'object-derived' && !derived?.object) return fail();
      const bindingRevision = (BigInt(policyRevisionSchema.parse(binding.bindingRevision)) + 1n).toString(); policyRevisionSchema.parse(bindingRevision);
      const draft = { ...binding, id: randomUUID(), bindingRevision, aggregateId: current.aggregateId, artifactId: current.artifactId,
        projectionSha256: current.projectionSha256, captureFrameId: current.captureFrameId, supersedesBindingId: binding.id, sourceObject: derived?.object ?? binding.sourceObject,
        sameModelReuse: { schemaVersion: 'wfc.pf.endpoint-same-model-reuse.v1' as const, sourceBindingId: binding.id, sourceBindingSha256: binding.contentSha256,
          originalBindingId: binding.sameModelReuse?.originalBindingId ?? binding.id, originalBindingSha256: binding.sameModelReuse?.originalBindingSha256 ?? binding.contentSha256,
          sourceAggregateId: binding.aggregateId, sourceArtifactId: binding.artifactId, sourceProjectionSha256: binding.projectionSha256, sourceCaptureFrameId: binding.captureFrameId,
          modelVersionId: current.modelVersionId, contentFingerprint: current.contentFingerprint, frameProjectionSha256: source.frameSha256,
          sourceTraceId: source.trace.id, sourceTraceContentSha256: source.trace.contentSha256, targetTraceId: target.trace.id, targetTraceContentSha256: target.trace.contentSha256,
          requalifiedBy: who.userId, requalifiedAt: new Date().toISOString() },
      };
      const { contentSha256: _sha, ...body } = draft;
      const carried = endpointBindingSchema.parse({ ...body, contentSha256: endpointBindingHash(body) });
      if (Buffer.byteLength(canonicalPurposeJson(carried)) > 65536) return fail();
      await client.query(`INSERT INTO pf_endpoint_binding_revisions(id,project_id,location_id,model_version_id,aggregate_id,binding_revision,trace_id,object_revision_id,record_sha256,record,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [carried.id, projectId, carried.locationId, carried.modelVersionId, carried.aggregateId,
      carried.bindingRevision, carried.sourceObject?.traceId ?? null, carried.sourceObject?.objectRevisionId ?? null, carried.contentSha256, carried, who.userId]);
      // Keep the normal head-change trigger: dependency caches must observe the
      // new binding authority even though the shared coordinates did not move.
      await client.query('UPDATE pf_endpoint_binding_heads SET binding_id=$3,binding_revision=$4 WHERE project_id=$1 AND location_id=$2',
        [projectId, carried.locationId, carried.id, carried.bindingRevision]);
      updatedLocationIds.push(carried.locationId);
    }
    const receipt = endpointRequalifyReceiptSchema.parse({ schemaVersion: 'wfc.pf.endpoint-requalify-receipt.v1', projectId,
      cableId: command.cableId, idempotencyKey: command.idempotencyKey, commandSha256, updatedLocationIds, duplicate: false });
    await client.query(`INSERT INTO pf_endpoint_binding_commands(project_id,actor_id,idempotency_key,kind,request_sha256,request,receipt) VALUES($1,$2,$3,'confirm',$4,$5,$6)`,
      [projectId, who.userId, command.idempotencyKey, endpointBindingHash(request), request, receipt]); check();
    return receipt;
}


/** Same-model recovery precedes automatic admission. Changed shared heads dirty the
 * generation normally; caller commits recovery and requests a fresh claim rather
 * than rebasing an admission silently. No legacy point is promoted. */
export async function requalifyAutomaticEndpointBindingsInTransaction(client: PoolClient, projectId: string, who: JobPrincipal, signal: AbortSignal) {
  const check=()=>{signal.throwIfAborted();assertLoginNotExpired(who);};check();
  const cables=(await client.query<{id:string;from_location:string|null;to_location:string|null}>(`/* automatic-endpoint-recovery:cables */ SELECT id,from_location,to_location FROM cables WHERE project_id=$1 AND mto IS DISTINCT FROM 'MV' ORDER BY id LIMIT 10001`,[projectId])).rows;
  if(cables.length>10000)throw new PathFinderError('JOB_CABLE_BUDGET',413);
  if(!cables.length)return 0;
  const current=await readCurrentEndpointBindingContext(client,projectId);if(!current)return 0;
  const names=[...new Set(cables.flatMap(c=>[c.from_location,c.to_location]).filter((n):n is string=>Boolean(n?.trim())).map(normalizeLocation))];
  const aliases=(await client.query<{normalized_alias:string;location_id:string}>(`/* automatic-endpoint-recovery:aliases */ SELECT normalized_alias,location_id FROM pf_location_aliases WHERE project_id=$1 AND normalized_alias=ANY($2::text[]) ORDER BY normalized_alias LIMIT 20001`,[projectId,names])).rows;
  if(aliases.length>20000)throw new PathFinderError('ENDPOINT_NEEDED_LOCATION_LIMIT',413);
  const byName=new Map(aliases.map(a=>[a.normalized_alias,a.location_id]));
  const heads=await readNeededEndpointBindingHeads(client,{projectId,current,locationIds:[...new Set(aliases.map(a=>a.location_id))],deadline:Date.now()+30000,signal});
  const attempted=new Set<string>(),frames:FrameCache=new Map();
  let recovered=0;
  for(const cable of cables){
    check();const ids=[cable.from_location,cable.to_location].map(n=>n?byName.get(normalizeLocation(n)):undefined);
    for(const id of ids){
      const head=id?heads.get(id):undefined;
      if(!id||!head||head.ready||head.binding.modelVersionId!==current.modelVersionId||attempted.has(id))continue;
      attempted.add(id);
      await client.query('SAVEPOINT automatic_endpoint_recovery');
      try{
        const receipt=await requalifyCableEndpointBindingsInTransaction(client,projectId,who,{schemaVersion:'wfc.pf.endpoint-requalify.v1',cableId:cable.id,idempotencyKey:randomUUID(),expectedCurrent:current},signal,frames,id);
        recovered+=receipt.updatedLocationIds.length;
        await client.query('RELEASE SAVEPOINT automatic_endpoint_recovery');
      }catch(error){
        await client.query('ROLLBACK TO SAVEPOINT automatic_endpoint_recovery');await client.query('RELEASE SAVEPOINT automatic_endpoint_recovery');
        if(!(error instanceof PathFinderError&&error.code==='ENDPOINT_REQUALIFICATION_UNAVAILABLE'))throw error;
      }
    }
  }check();return recovered;
}
