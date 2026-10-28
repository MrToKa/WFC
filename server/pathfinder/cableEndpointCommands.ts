import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { CABLE_ENDPOINT_LIMITS, cableEndpointCommandSchema, cableEndpointContextHashInput, cableEndpointContextSchema,
  cableEndpointEndSchema, cableEndpointImpactSchema, cableEndpointReceiptSchema, cableEndpointRecoverySchema,
  cableEndpointClosedSchema, cableEndpointSdkObjectIdSchema, cableEndpointSelectionResponseSchema,
  type CableEndpointCommand, type CableEndpointContext } from '../../shared/pathfinderCableEndpoints.js';
import { ENDPOINT_ANCHOR_RULE, endpointBindingSchema, endpointLocationNameSchema, endpointLocationSchema, type EndpointObjectRef } from '../../shared/pathfinderEndpointBindings.js';
import { assertLoginNotExpired } from './auth.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { normalizeLocation } from './matching.js';
import { cableWorkflowReadTransaction } from './cableWorkflowRead.js';
import { confirmEndpointBindingChangeInTransaction, endpointBindingHash, endpointBindingTransaction,
  readCurrentEndpointBindingContext } from './endpointBindingRepository.js';
import { readCableEndpointSelection } from './cableEndpointSelection.js';
import { appendLocationImpactInTransaction } from './locationImpactRepository.js';
import { appendInitialFillMandateInTransaction } from './initialFillMandates.js';
import { readAutomaticNamedEndpointCandidate } from './automaticEndpointCandidates.js';
import { readCableEndpointDisplay } from './cableEndpointDisplay.js';
import { collectBarrierCalculationScope } from './barrierCalculationScope.js';
import { CABLE_ENDPOINT_PAIR_LIMITS, cableEndpointPairCommandSchema, cableEndpointPairReceiptSchema,
  cableEndpointPairClosedSchema, cableEndpointPairRecoverySchema, type CableEndpointPairCommand } from '../../shared/pathfinderCableEndpointPair.js';

const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'The cable endpoint changed or is unavailable. Refresh its context; retain an uncertain command until it is saved or explicitly closed.'); };
const budget = <T>(value: T): T => { if (Buffer.byteLength(canonicalPurposeJson(value)) > CABLE_ENDPOINT_LIMITS.responseBytes) return fail('CABLE_ENDPOINT_RESPONSE_LIMIT', 413); return value; };
type End = z.infer<typeof cableEndpointEndSchema>;
const owner = (cableId: string, end: End, command: CableEndpointCommand) => ({ schemaVersion: 'wfc.pf.cable-endpoint-command-owner.v1', cableId, end, command });

/** Historical receipt recovery remains above this guard. Fresh calculation
 * requests must retain and verify their exact barrier scope before any head or
 * outbox write. An explicit null calculation is an endpoint-only save. */
async function requireFreshCalculationBarriers(client: PoolClient, projectId: string, command: CableEndpointCommand,
  check: () => void, signal?: AbortSignal, checked = new Set<string>()): Promise<void> {
  if (command.schemaVersion === 'wfc.pf.cable-endpoint-command.v1' || command.calculation === null) return;
  const intent = command.calculation.preferences.barrierRouting;
  if (!intent) return fail('BARRIER_ROUTING_INTENT_REQUIRED');
  const key = canonicalPurposeJson(intent); if (checked.has(key)) return;
  check(); await collectBarrierCalculationScope(client, projectId, intent, { signal }); check(); checked.add(key);
}

/** The caller separately verifies this immutable record through the retained reader. */
async function objectDisplay(client: PoolClient, projectId: string, object: EndpointObjectRef, check: () => void) {
  const names = (await client.query<{ name: string | null; sdk_object_id: unknown }>(`/* cable-endpoint:automatic-name */ SELECT
    CASE WHEN octet_length(record#>>'{historicalModel,name}')<=8192 THEN record#>>'{historicalModel,name}' ELSE NULL END AS name,
    record#>'{identity,dbId}' AS sdk_object_id FROM pf_geometry_object_revisions
    WHERE project_id=$1 AND trace_id=$2 AND id=$3 AND summary->>'recordSha256'=$4 LIMIT 2 FOR SHARE`,
  [projectId, object.traceId, object.objectRevisionId, object.recordSha256])).rows; check();
  if (names.length !== 1 || typeof names[0].name !== 'string' || names[0].name.length > 2048
    || !cableEndpointSdkObjectIdSchema.safeParse(names[0].sdk_object_id).success) return null;
  return { name: names[0].name, sdkObjectId: names[0].sdk_object_id as number };
}

/** Bounded cable snapshot; the logical endpoint always comes from this cable, never a selected object's label. */
async function context(client: PoolClient, projectId: string, cableId: string, end: End, check: () => void): Promise<CableEndpointContext> {
  check();
  const cable = (await client.query<{ cable_write_revision: string; from_location: string | null; to_location: string | null; mto: string | null; oversized: boolean }>(
    `/* cable-endpoint:cable */ SELECT c.cable_write_revision::text,
      CASE WHEN octet_length(c.from_location)<=4096 THEN c.from_location ELSE NULL END AS from_location,
      CASE WHEN octet_length(c.to_location)<=4096 THEN c.to_location ELSE NULL END AS to_location,
      CASE WHEN octet_length(c.mto)<=96 THEN c.mto ELSE NULL END AS mto,
      (coalesce(octet_length(c.from_location),0)>4096 OR coalesce(octet_length(c.to_location),0)>4096 OR coalesce(octet_length(c.mto),0)>96) AS oversized
      FROM cables c WHERE c.project_id=$1 AND c.id=$2 FOR SHARE OF c`, [projectId, cableId])).rows[0];
  if (!cable) return fail('CABLE_NOT_FOUND', 404); if (cable.oversized) return fail('CABLE_ENDPOINT_NAME_LIMIT', 413);
  const registry = (await client.query<{ revision: string }>('SELECT registry_revision::text AS revision FROM pf_project_state WHERE project_id=$1 FOR SHARE', [projectId])).rows[0];
  if (!registry) return fail('CABLE_ENDPOINT_STATE_REQUIRED');
  const logicalName = (end === 'from' ? cable.from_location : cable.to_location)?.normalize('NFC').trim() || null;
  const logicalKey = logicalName ? normalizeLocation(logicalName) : null;
  // Immutable retained manifests are checked before transfer through the shared context reader.
  const sizes = (await client.query<{ oversized: boolean }>(`/* cable-endpoint:context-budget */ SELECT
    (coalesce(octet_length(a.manifest::text),0)>4194304 OR coalesce((SELECT max(octet_length(t.manifest::text)) FROM
      (SELECT manifest FROM pf_geometry_trace_sets WHERE project_id=$1 AND aggregate_id=p.current_aggregate_id ORDER BY created_at DESC,id DESC LIMIT 1) t),0)>4194304) AS oversized
    FROM pf_project_preparations p LEFT JOIN pf_preparation_aggregates a ON a.project_id=p.project_id AND a.id=p.current_aggregate_id WHERE p.project_id=$1`, [projectId])).rows[0];
  if (sizes?.oversized) return fail('CABLE_ENDPOINT_CONTEXT_LIMIT', 413);
  const current = await readCurrentEndpointBindingContext(client, projectId);
  let location: CableEndpointContext['location'] = null, head: CableEndpointContext['head'] = null;
  if (logicalKey) {
    const matches = (await client.query<{ location_id: string }>('/* cable-endpoint:alias */ SELECT location_id FROM pf_location_aliases WHERE project_id=$1 AND normalized_alias=$2 ORDER BY location_id LIMIT 2 FOR SHARE', [projectId, logicalKey])).rows;
    if (matches.length > 1) return fail('CABLE_ENDPOINT_ALIAS_AMBIGUOUS');
    if (matches[0]) {
      const row = (await client.query<{ id: string; name: string | null; revision: string; oversized: boolean }>(`/* cable-endpoint:location */ SELECT id,
        CASE WHEN octet_length(name)<=2000 THEN name ELSE NULL END AS name,revision::text,(octet_length(name)>2000) AS oversized
        FROM pf_locations WHERE project_id=$1 AND id=$2 FOR SHARE`, [projectId, matches[0].location_id])).rows[0];
      if (!row || row.oversized) return fail('CABLE_ENDPOINT_LOCATION_INTEGRITY');
      const aliases = (await client.query<{ display_alias: string | null; normalized_alias: string; oversized: boolean }>(`/* cable-endpoint:aliases */ SELECT
        CASE WHEN octet_length(display_alias)<=2000 THEN display_alias ELSE NULL END AS display_alias,
        CASE WHEN octet_length(normalized_alias)<=2000 THEN normalized_alias ELSE NULL END AS normalized_alias,
        (octet_length(display_alias)>2000 OR octet_length(normalized_alias)>2000) AS oversized
        FROM pf_location_aliases WHERE project_id=$1 AND location_id=$2 ORDER BY normalized_alias LIMIT 102 FOR SHARE`, [projectId, row.id])).rows;
      if (aliases.length > 101 || aliases.some(a => a.oversized || !a.display_alias || normalizeLocation(a.display_alias) !== a.normalized_alias)
        || !aliases.some(a => a.normalized_alias === logicalKey) || !aliases.some(a => a.normalized_alias === normalizeLocation(row.name!))) return fail('CABLE_ENDPOINT_LOCATION_INTEGRITY');
      location = endpointLocationSchema.parse({ id: row.id, name: row.name, revision: row.revision,
        aliases: aliases.filter(a => a.normalized_alias !== normalizeLocation(row.name!)).map(a => a.display_alias) });
      const stored = (await client.query<{ binding_id: string; binding_revision: string; record_sha256: string; record: unknown }>(`/* cable-endpoint:head */ SELECT
        h.binding_id,h.binding_revision::text,r.record_sha256,
        CASE WHEN octet_length(r.record::text)<=65536 THEN r.record ELSE NULL END AS record
        FROM pf_endpoint_binding_heads h JOIN pf_endpoint_binding_revisions r ON r.project_id=h.project_id AND r.location_id=h.location_id AND r.id=h.binding_id
        WHERE h.project_id=$1 AND h.location_id=$2 FOR SHARE OF h,r`, [projectId, row.id])).rows[0];
      if (stored) {
        const parsed = endpointBindingSchema.safeParse(stored.record); if (!parsed.success) return fail('CABLE_ENDPOINT_HEAD_INTEGRITY');
        head = parsed.data; const { contentSha256, ...body } = head;
        if (head.projectId !== projectId || head.locationId !== row.id || head.id !== stored.binding_id || head.bindingRevision !== stored.binding_revision
          || head.contentSha256 !== stored.record_sha256 || endpointBindingHash(body) !== contentSha256) return fail('CABLE_ENDPOINT_HEAD_INTEGRITY');
      }
    }
  }
  check(); const reasons: string[] = [];
  if (!logicalName) reasons.push('CABLE_ENDPOINT_NAME_REQUIRED');
  else if (logicalName.length > 500) reasons.push('CABLE_ENDPOINT_NAME_LIMIT');
  else if (!endpointLocationNameSchema.safeParse(logicalName).success) reasons.push('CABLE_ENDPOINT_NAME_INVALID');
  if (cable.mto === 'MV') reasons.push('CABLE_ENDPOINT_MV_EXCLUDED');
  else if (!['LV', 'Control', 'Instrumentation'].includes(cable.mto ?? '')) reasons.push('CABLE_ENDPOINT_CATEGORY_REQUIRED');
  if (!current) reasons.push('ENDPOINT_PREPARATION_REQUIRED');
  let automaticSelection: CableEndpointContext['automaticSelection'] = null, confirmedSelection: CableEndpointContext['confirmedSelection'] = null;
  if (!head && reasons.length === 0 && current && logicalName) {
    const candidate = await readAutomaticNamedEndpointCandidate(client, { projectId, current, name: logicalName }); check();
    if (candidate.status === 'automatic-ready' && candidate.objectId && candidate.point) {
      const sdkObjectId = Number(candidate.objectId.slice(5));
      if (cableEndpointSdkObjectIdSchema.safeParse(sdkObjectId).success) {
        const selected = await readCableEndpointSelection(client, { projectId, current, sdkObjectId }, check);
        if (selected.status === 'available' && selected.object && selected.pointProjectMetres
          && canonicalPurposeJson(selected.pointProjectMetres) === canonicalPurposeJson(candidate.point)) {
          const display = await objectDisplay(client, projectId, selected.object, check);
          if (display?.sdkObjectId === sdkObjectId)
            automaticSelection = { source: 'automatic-unconfirmed', sdkObjectId, name: display.name, object: selected.object,
              pointProjectMetres: selected.pointProjectMetres, approximate: true, confirmed: false };
        }
      }
    }
  }
  if (head?.status === 'confirmed' && head.mode === 'object-derived' && head.sourceObject && reasons.length === 0 && current
    && head.modelVersionId === current.modelVersionId && head.aggregateId === current.aggregateId && head.artifactId === current.artifactId
    && head.projectionSha256 === current.projectionSha256 && head.captureFrameId === current.captureFrameId) {
    const display = await objectDisplay(client, projectId, head.sourceObject, check);
    if (display) {
      const selected = await readCableEndpointSelection(client, { projectId, current, sdkObjectId: display.sdkObjectId }, check);
      if (selected.status === 'available' && selected.object && canonicalPurposeJson(selected.object) === canonicalPurposeJson(head.sourceObject)
        && canonicalPurposeJson(selected.pointProjectMetres) === canonicalPurposeJson(head.pointProjectMetres))
        confirmedSelection = { source: 'confirmed', ...display, object: selected.object, pointProjectMetres: head.pointProjectMetres, approximate: true, confirmed: true };
    }
  }
  const confirmedDisplaySelection = head && location && current && reasons.length === 0
    ? await readCableEndpointDisplay(client, { projectId, head, location, current }, check) : null;
  const draft = cableEndpointContextSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-context.v1', projectId, cableId, end,
    cableWriteRevision: cable.cable_write_revision, logicalName, logicalKey, mto: cable.mto, canBind: reasons.length === 0,
    reasonCodes: reasons, registryRevision: registry.revision, location, head, current, automaticSelection, confirmedSelection,
    confirmedDisplaySelection, contextSha256: '0'.repeat(64) });
  return budget(cableEndpointContextSchema.parse({ ...draft, contextSha256: endpointBindingHash(cableEndpointContextHashInput(draft)) }));
}

/** Counts every shared-name occurrence on either end, including MV; U3 alone decides calculation eligibility. */
async function impact(client: PoolClient, projectId: string, names: string[], check: () => void) {
  const rows = (await client.query<{ id: string; from_location: string | null; to_location: string | null; oversized: boolean; total_text_bytes: string }>(`/* cable-endpoint:impact */ SELECT id,
    CASE WHEN total_text_bytes<=8388608 AND octet_length(from_location)<=4096 THEN from_location ELSE NULL END AS from_location,
    CASE WHEN total_text_bytes<=8388608 AND octet_length(to_location)<=4096 THEN to_location ELSE NULL END AS to_location,
    (coalesce(octet_length(from_location),0)>4096 OR coalesce(octet_length(to_location),0)>4096) AS oversized,total_text_bytes::text
    FROM (SELECT id,from_location,to_location,sum(coalesce(octet_length(from_location),0)+coalesce(octet_length(to_location),0)) OVER() AS total_text_bytes
      FROM (SELECT id,from_location,to_location FROM cables WHERE project_id=$1 ORDER BY id LIMIT 10001 FOR SHARE) locked_cables) budgeted_cables
    ORDER BY id`, [projectId])).rows;
  if (rows.length > CABLE_ENDPOINT_LIMITS.projectCables) return fail('CABLE_ENDPOINT_PROJECT_CABLE_LIMIT', 413);
  if (rows.some(row => !/^(?:0|[1-9][0-9]{0,18})$/.test(row.total_text_bytes) || BigInt(row.total_text_bytes) > BigInt(CABLE_ENDPOINT_LIMITS.impactTextBytes))) return fail('CABLE_ENDPOINT_IMPACT_LIMIT', 413);
  const normalized = new Set(names.map(normalizeLocation)), from = new Set<string>(), to = new Set<string>();
  for (const row of rows) { check(); if (row.oversized) return fail('CABLE_ENDPOINT_NAME_LIMIT', 413); policyUuidSchema.parse(row.id);
    if (row.from_location && normalized.has(normalizeLocation(row.from_location))) from.add(row.id);
    if (row.to_location && normalized.has(normalizeLocation(row.to_location))) to.add(row.id); }
  const cableIds = [...new Set([...from, ...to])].sort();
  return cableEndpointImpactSchema.parse({ fromOccurrences: from.size, toOccurrences: to.size, distinctCables: cableIds.length, cableIds });
}

async function previous(client: PoolClient, projectId: string, who: JobPrincipal, cableId: string, end: End, command: CableEndpointCommand) {
  const row = (await client.query<{ kind: string; request_sha256: string; request: unknown; receipt: unknown }>(`/* cable-endpoint:command */ SELECT kind,request_sha256,
    CASE WHEN octet_length(request::text)<=65536 THEN request ELSE NULL END AS request,
    CASE WHEN octet_length(receipt::text)<=1048576 THEN receipt ELSE NULL END AS receipt
    FROM pf_endpoint_binding_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3`, [projectId, who.userId, command.idempotencyKey])).rows[0];
  if (!row) return null;
  const request = owner(cableId, end, command);
  if (row.kind !== 'confirm' || row.request_sha256 !== endpointBindingHash(request) || canonicalPurposeJson(row.request) !== canonicalPurposeJson(request)) return fail('CABLE_ENDPOINT_IDEMPOTENCY_CONFLICT');
  const stored = z.discriminatedUnion('status', [z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-stored.v1'), status: z.literal('saved'), receipt: cableEndpointReceiptSchema }).strict(),
    z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-stored.v1'), status: z.literal('closed'), closure: cableEndpointClosedSchema }).strict()]).safeParse(row.receipt);
  if (!stored.success) return fail('CABLE_ENDPOINT_COMMAND_INTEGRITY');
  const proof = stored.data.status === 'saved' ? stored.data.receipt : stored.data.closure;
  if (proof.projectId !== projectId || proof.actorId !== who.userId || proof.cableId !== cableId || proof.end !== end || proof.idempotencyKey !== command.idempotencyKey
    || proof.commandSha256 !== endpointBindingHash(command) || proof.expectedContextSha256 !== command.expectedContextSha256
    || proof.expectedCableWriteRevision !== command.expectedCableWriteRevision) return fail('CABLE_ENDPOINT_COMMAND_INTEGRITY');
  return stored.data;
}
async function store(client: PoolClient, projectId: string, who: JobPrincipal, cableId: string, end: End, command: CableEndpointCommand, disposition: unknown) {
  const request = owner(cableId, end, command);
  await client.query('INSERT INTO pf_endpoint_binding_commands(project_id,actor_id,idempotency_key,kind,request_sha256,request,receipt) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [projectId, who.userId, command.idempotencyKey, 'confirm', endpointBindingHash(request), request, budget(disposition)]);
}

const pairOwner = (cableId: string, command: CableEndpointPairCommand) => ({ schemaVersion: 'wfc.pf.cable-endpoint-pair-owner.v1', cableId, command });
const pairBudget = <T>(value: T): T => { if (Buffer.byteLength(canonicalPurposeJson(value)) > CABLE_ENDPOINT_PAIR_LIMITS.responseBytes) return fail('CABLE_ENDPOINT_RESPONSE_LIMIT', 413); return value; };
const pairStoredSchema = z.discriminatedUnion('status', [
  z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-pair-stored.v1'), status: z.literal('saved'), receipt: cableEndpointPairReceiptSchema }).strict(),
  z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-pair-stored.v1'), status: z.literal('closed'), closure: cableEndpointPairClosedSchema }).strict(),
]);
async function previousPair(client: PoolClient, projectId: string, who: JobPrincipal, cableId: string, command: CableEndpointPairCommand) {
  const row = (await client.query<{ kind: string; request_sha256: string; request: unknown; receipt: unknown }>(`/* cable-endpoint:pair-command */ SELECT kind,request_sha256,
    CASE WHEN octet_length(request::text)<=131072 THEN request ELSE NULL END AS request,
    CASE WHEN octet_length(receipt::text)<=2097152 THEN receipt ELSE NULL END AS receipt
    FROM pf_endpoint_binding_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3`, [projectId, who.userId, command.idempotencyKey])).rows[0];
  if (!row) return null;
  const request = pairOwner(cableId, command);
  if (row.kind !== 'confirm' || row.request_sha256 !== endpointBindingHash(request) || canonicalPurposeJson(row.request) !== canonicalPurposeJson(request)) return fail('CABLE_ENDPOINT_IDEMPOTENCY_CONFLICT');
  const stored = pairStoredSchema.safeParse(row.receipt); if (!stored.success) return fail('CABLE_ENDPOINT_COMMAND_INTEGRITY');
  const proof = stored.data.status === 'saved' ? stored.data.receipt : stored.data.closure;
  if (proof.projectId !== projectId || proof.actorId !== who.userId || proof.cableId !== cableId || proof.idempotencyKey !== command.idempotencyKey
    || proof.commandSha256 !== endpointBindingHash(command) || proof.expectedCableWriteRevision !== command.endpoints[0].command.expectedCableWriteRevision
    || canonicalPurposeJson(proof.expectedContexts) !== canonicalPurposeJson(command.expectedContexts)) return fail('CABLE_ENDPOINT_COMMAND_INTEGRITY');
  if (stored.data.status === 'saved' && (stored.data.receipt.receipts.length !== command.endpoints.length || stored.data.receipt.receipts.some((receipt, at) => {
    const entry = command.endpoints[at]; return receipt.end !== entry.end || receipt.idempotencyKey !== entry.command.idempotencyKey
      || receipt.commandSha256 !== endpointBindingHash(entry.command) || receipt.logicalName !== entry.command.expectedLogicalName;
  }))) return fail('CABLE_ENDPOINT_COMMAND_INTEGRITY');
  return stored.data;
}
async function storePair(client: PoolClient, projectId: string, who: JobPrincipal, cableId: string, command: CableEndpointPairCommand, disposition: unknown) {
  const request = pairOwner(cableId, command);
  await client.query('INSERT INTO pf_endpoint_binding_commands(project_id,actor_id,idempotency_key,kind,request_sha256,request,receipt) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [projectId, who.userId, command.idempotencyKey, 'confirm', endpointBindingHash(request), request, pairBudget(disposition)]);
}
function assertOriginalContext(value: CableEndpointContext, command: CableEndpointCommand) {
  if (value.contextSha256 !== command.expectedContextSha256 || value.cableWriteRevision !== command.expectedCableWriteRevision
    || value.logicalName !== command.expectedLogicalName || value.registryRevision !== command.expectedRegistryRevision
    || (value.location?.id ?? null) !== command.expectedLocationId || (value.location?.revision ?? null) !== command.expectedLocationRevision
    || (value.head?.id ?? null) !== command.expectedHeadId || canonicalPurposeJson(value.current) !== canonicalPurposeJson(command.expectedCurrent)) return fail('CABLE_ENDPOINT_CONTEXT_CHANGED');
  if (!value.canBind || !value.current || !value.logicalName) return fail('CABLE_ENDPOINT_UNAVAILABLE');
}
const bindingGroupKey = (value: CableEndpointContext) => value.location ? `location:${value.location.id}` : `logical:${value.logicalKey}`;

export function createCableEndpointCommands(pool: Pool) {
  const checkOwner = (projectId: string, cableId: string, end: unknown) => { policyUuidSchema.parse(projectId); policyUuidSchema.parse(cableId); return cableEndpointEndSchema.parse(end); };
  const authorize = (projectId: string, who: JobPrincipal, signal?: AbortSignal) => cableWorkflowReadTransaction(pool, projectId, who, async () => undefined, signal);
  const read = (projectId: string, who: JobPrincipal, cableId: string, rawEnd: unknown, signal?: AbortSignal) => {
    const end = checkOwner(projectId, cableId, rawEnd);
    return cableWorkflowReadTransaction(pool, projectId, who, (client, check) => context(client, projectId, cableId, end, check), signal);
  };
  const selection = (projectId: string, who: JobPrincipal, cableId: string, rawEnd: unknown, sdkObjectId: number, expectedContextSha256: string, signal?: AbortSignal) => {
    const end = checkOwner(projectId, cableId, rawEnd); cableEndpointSdkObjectIdSchema.parse(sdkObjectId);
    return cableWorkflowReadTransaction(pool, projectId, who, async (client, check) => {
      const value = await context(client, projectId, cableId, end, check);
      if (value.contextSha256 !== expectedContextSha256) return fail('CABLE_ENDPOINT_CONTEXT_CHANGED');
      if (!value.canBind || !value.current) return fail('CABLE_ENDPOINT_UNAVAILABLE');
      const evidence = await readCableEndpointSelection(client, { projectId, current: value.current, sdkObjectId }, check);
      return budget(cableEndpointSelectionResponseSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-selection-response.v1', projectId, cableId, end, contextSha256: value.contextSha256, selection: evidence }));
    }, signal);
  };
  const write = async (projectId: string, who: JobPrincipal, cableId: string, rawEnd: unknown, rawCommand: unknown, signal?: AbortSignal, close = false) => {
    const end = checkOwner(projectId, cableId, rawEnd), command = cableEndpointCommandSchema.parse(rawCommand);
    if (Buffer.byteLength(canonicalPurposeJson(command)) > CABLE_ENDPOINT_LIMITS.controlBytes - 1024) return fail('CABLE_ENDPOINT_BODY_LIMIT', 413);
    return endpointBindingTransaction(pool, projectId, who, async client => {
      const check = () => { signal?.throwIfAborted(); assertLoginNotExpired(who); }; check();
      const old = await previous(client, projectId, who, cableId, end, command);
      if (old) {
        if (close) return cableEndpointRecoverySchema.parse(old.status === 'saved'
          ? { schemaVersion: 'wfc.pf.cable-endpoint-recovery.v1', status: 'saved', receipt: { ...old.receipt, duplicate: true } }
          : { schemaVersion: 'wfc.pf.cable-endpoint-recovery.v1', status: 'closed', closure: old.closure });
        if (old.status === 'closed') return fail('CABLE_ENDPOINT_COMMAND_CLOSED');
        return cableEndpointReceiptSchema.parse({ ...old.receipt, duplicate: true });
      }
      if (close) {
        const closure = cableEndpointClosedSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-closed.v1', projectId, actorId: who.userId, cableId, end,
          idempotencyKey: command.idempotencyKey, commandSha256: endpointBindingHash(command), expectedCableWriteRevision: command.expectedCableWriteRevision,
          expectedContextSha256: command.expectedContextSha256 });
        await store(client, projectId, who, cableId, end, command, { schemaVersion: 'wfc.pf.cable-endpoint-stored.v1', status: 'closed', closure });
        return cableEndpointRecoverySchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-recovery.v1', status: 'closed', closure });
      }
      await requireFreshCalculationBarriers(client, projectId, command, check, signal);
      const value = await context(client, projectId, cableId, end, check);
      if (value.contextSha256 !== command.expectedContextSha256 || value.cableWriteRevision !== command.expectedCableWriteRevision
        || value.logicalName !== command.expectedLogicalName || value.registryRevision !== command.expectedRegistryRevision
        || value.location?.id !== (command.expectedLocationId ?? undefined) || (value.location?.revision ?? null) !== command.expectedLocationRevision
        || (value.head?.id ?? null) !== command.expectedHeadId || canonicalPurposeJson(value.current) !== canonicalPurposeJson(command.expectedCurrent)) return fail('CABLE_ENDPOINT_CONTEXT_CHANGED');
      if (!value.canBind || !value.current || !value.logicalName) return fail('CABLE_ENDPOINT_UNAVAILABLE');
      if (command.selection.mode === 'object-derived') {
        const evidence = await readCableEndpointSelection(client, { projectId, current: value.current, sdkObjectId: command.selection.sdkObjectId }, check);
        if (evidence.status !== 'available' || canonicalPurposeJson(evidence.object) !== canonicalPurposeJson(command.selection.object)) return fail('CABLE_ENDPOINT_SELECTION_CHANGED');
      }
      const names = value.location ? { name: value.location.name, aliases: value.location.aliases } : { name: value.logicalName, aliases: [] };
      const affected = await impact(client, projectId, [names.name, ...names.aliases], check), locationId = value.location?.id ?? randomUUID();
      const common = { schemaVersion: 'wfc.pf.endpoint-binding-write.v1', expectedRegistryRevision: command.expectedRegistryRevision,
        expectedLocationRevision: command.expectedLocationRevision, expectedHeadId: command.expectedHeadId,
        expectedSelectionRevision: value.current.selectionRevision, modelVersionId: value.current.modelVersionId, aggregateId: value.current.aggregateId,
        projectionSha256: value.current.projectionSha256, captureFrameId: value.current.captureFrameId, idempotencyKey: command.idempotencyKey,
        reason: command.reason, location: names };
      if (command.schemaVersion !== 'wfc.pf.cable-endpoint-command.v1') await client.query("SET LOCAL wfc.pathfinder_location_impact='1'");
      const binding = await confirmEndpointBindingChangeInTransaction(client, projectId, who, locationId, command.selection.mode === 'object-derived'
        ? { ...common, mode: 'object-derived', object: command.selection.object, anchorRule: ENDPOINT_ANCHOR_RULE }
        : { ...common, mode: 'fixed-world', pointProjectMetres: command.selection.pointProjectMetres, derivation: command.selection.derivation, provenanceObject: null }, signal);
      const locationImpact = command.schemaVersion !== 'wfc.pf.cable-endpoint-command.v1' ? await appendLocationImpactInTransaction(client, {
        projectId, principal: who, idempotencyKey: command.idempotencyKey, commandSha256: endpointBindingHash(command), binding, current: value.current,
        affectedCableIds: affected.cableIds, originCableId: cableId, calculation: command.calculation,
        ...(command.schemaVersion === 'wfc.pf.cable-endpoint-command.v4' ? {automaticPairPolicy:command.automaticPairPolicy} : {}) }, check) : undefined;
      const initialFillMandate = command.schemaVersion === 'wfc.pf.cable-endpoint-command.v3' && command.initialFill && locationImpact
        ? await appendInitialFillMandateInTransaction(client, { projectId, principal: who, impactId: locationImpact.id, commandSha256: endpointBindingHash(command),
          idempotencyKey: command.idempotencyKey, command }, check) : undefined;
      const receipt = cableEndpointReceiptSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-receipt.v1', projectId, actorId: who.userId, cableId, end, logicalName: value.logicalName,
        idempotencyKey: command.idempotencyKey, commandSha256: endpointBindingHash(command), expectedCableWriteRevision: command.expectedCableWriteRevision,
        expectedContextSha256: command.expectedContextSha256, locationId, binding, impact: affected, ...(locationImpact ? { locationImpact } : {}),
        ...(initialFillMandate ? { initialFillMandate } : {}), duplicate: false });
      check(); await store(client, projectId, who, cableId, end, command, { schemaVersion: 'wfc.pf.cable-endpoint-stored.v1', status: 'saved', receipt }); return budget(receipt);
    }, signal);
  };
  const writePair = async (projectId: string, who: JobPrincipal, cableId: string, rawCommand: unknown, signal?: AbortSignal, close = false) => {
    policyUuidSchema.parse(projectId); policyUuidSchema.parse(cableId); const command = cableEndpointPairCommandSchema.parse(rawCommand);
    if (Buffer.byteLength(canonicalPurposeJson(command)) > CABLE_ENDPOINT_PAIR_LIMITS.controlBytes - 1024) return fail('CABLE_ENDPOINT_BODY_LIMIT', 413);
    return endpointBindingTransaction(pool, projectId, who, async client => {
      const check = () => { signal?.throwIfAborted(); assertLoginNotExpired(who); }; check();
      const old = await previousPair(client, projectId, who, cableId, command);
      if (old) {
        if (close) return cableEndpointPairRecoverySchema.parse(old.status === 'saved'
          ? { schemaVersion: 'wfc.pf.cable-endpoint-pair-recovery.v1', status: 'saved', receipt: { ...old.receipt, duplicate: true } }
          : { schemaVersion: 'wfc.pf.cable-endpoint-pair-recovery.v1', status: 'closed', closure: old.closure });
        if (old.status === 'closed') return fail('CABLE_ENDPOINT_COMMAND_CLOSED');
        return cableEndpointPairReceiptSchema.parse({ ...old.receipt, duplicate: true });
      }
      // Never adopt an independently committed child as an allegedly atomic pair.
      for (const entry of command.endpoints) if (await previous(client, projectId, who, cableId, entry.end, entry.command)) return fail('CABLE_ENDPOINT_PAIR_CHILD_ALREADY_USED');
      const disposition = { projectId, actorId: who.userId, cableId, idempotencyKey: command.idempotencyKey,
        commandSha256: endpointBindingHash(command), expectedCableWriteRevision: command.endpoints[0].command.expectedCableWriteRevision, expectedContexts: command.expectedContexts };
      if (close) {
        for (const entry of command.endpoints) {
          const input = entry.command, closure = cableEndpointClosedSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-closed.v1', projectId, actorId: who.userId, cableId, end: entry.end,
            idempotencyKey: input.idempotencyKey, commandSha256: endpointBindingHash(input), expectedCableWriteRevision: input.expectedCableWriteRevision, expectedContextSha256: input.expectedContextSha256 });
          await store(client, projectId, who, cableId, entry.end, input, { schemaVersion: 'wfc.pf.cable-endpoint-stored.v1', status: 'closed', closure });
        }
        const closure = cableEndpointPairClosedSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-pair-closed.v1', ...disposition });
        await storePair(client, projectId, who, cableId, command, { schemaVersion: 'wfc.pf.cable-endpoint-pair-stored.v1', status: 'closed', closure });
        return cableEndpointPairRecoverySchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-pair-recovery.v1', status: 'closed', closure });
      }
      const checkedBarriers = new Set<string>();
      for (const entry of command.endpoints) await requireFreshCalculationBarriers(client, projectId, entry.command, check, signal, checkedBarriers);
      const originals = { from: await context(client, projectId, cableId, 'from', check), to: await context(client, projectId, cableId, 'to', check) };
      if (originals.from.contextSha256 !== command.expectedContexts.from || originals.to.contextSha256 !== command.expectedContexts.to) return fail('CABLE_ENDPOINT_CONTEXT_CHANGED');
      const groups = new Map<string, { value: CableEndpointContext; selection: CableEndpointCommand['selection']; locationId: string; affected: Awaited<ReturnType<typeof impact>>; binding?: Awaited<ReturnType<typeof confirmEndpointBindingChangeInTransaction>> }>();
      for (const entry of command.endpoints) {
        const value = originals[entry.end], input = entry.command; assertOriginalContext(value, input);
        if (input.selection.mode === 'object-derived') {
          const evidence = await readCableEndpointSelection(client, { projectId, current: value.current!, sdkObjectId: input.selection.sdkObjectId }, check);
          if (evidence.status !== 'available' || canonicalPurposeJson(evidence.object) !== canonicalPurposeJson(input.selection.object)) return fail('CABLE_ENDPOINT_SELECTION_CHANGED');
        }
        const key = bindingGroupKey(value), prior = groups.get(key);
        if (prior) { if (canonicalPurposeJson(prior.selection) !== canonicalPurposeJson(input.selection)) return fail('CABLE_ENDPOINT_PAIR_LOCATION_CONFLICT'); continue; }
        const names = value.location ? [value.location.name, ...value.location.aliases] : [value.logicalName!];
        groups.set(key, { value, selection: input.selection, locationId: value.location?.id ?? randomUUID(), affected: await impact(client, projectId, names, check) });
      }
      // All original CAS/evidence/budget checks finish before the first write.
      await client.query("SET LOCAL wfc.pathfinder_location_impact='1'");
      let revision = command.endpoints[0].command.expectedRegistryRevision;
      for (const group of groups.values()) {
        const value = group.value, input = command.endpoints.find(entry => originals[entry.end] === value)!.command;
        const common = { schemaVersion: 'wfc.pf.endpoint-binding-write.v1', expectedRegistryRevision: revision,
          expectedLocationRevision: value.location?.revision ?? null, expectedHeadId: value.head?.id ?? null,
          expectedSelectionRevision: value.current!.selectionRevision, modelVersionId: value.current!.modelVersionId, aggregateId: value.current!.aggregateId,
          projectionSha256: value.current!.projectionSha256, captureFrameId: value.current!.captureFrameId, idempotencyKey: input.idempotencyKey,
          reason: input.reason, location: value.location ? { name: value.location.name, aliases: value.location.aliases } : { name: value.logicalName!, aliases: [] } };
        group.binding = await confirmEndpointBindingChangeInTransaction(client, projectId, who, group.locationId, group.selection.mode === 'object-derived'
          ? { ...common, mode: 'object-derived', object: group.selection.object, anchorRule: ENDPOINT_ANCHOR_RULE }
          : { ...common, mode: 'fixed-world', pointProjectMetres: group.selection.pointProjectMetres, derivation: group.selection.derivation, provenanceObject: null }, signal);
        // A no-op may return its historical binding revision. Read the actual
        // current revision; only our preceding writes can advance it under lock.
        const next = (await client.query<{ revision: string }>('SELECT registry_revision::text AS revision FROM pf_project_state WHERE project_id=$1 FOR SHARE', [projectId])).rows[0];
        if (!next) return fail('CABLE_ENDPOINT_STATE_REQUIRED'); revision = next.revision; check();
      }
      const receipts = [];
      // Producers cannot observe an intent until both heads and the outer receipt
      // commit together. Existing target generations coalesce overlapping scopes.
      for (const entry of command.endpoints) {
        const value = originals[entry.end], input = entry.command, group = groups.get(bindingGroupKey(value))!, binding = group.binding!;
        const locationImpact = await appendLocationImpactInTransaction(client, { projectId, principal: who, idempotencyKey: input.idempotencyKey,
          commandSha256: endpointBindingHash(input), binding, current: value.current!, affectedCableIds: group.affected.cableIds, originCableId: cableId, calculation: input.calculation,
          ...(input.schemaVersion === 'wfc.pf.cable-endpoint-command.v4' ? {automaticPairPolicy:input.automaticPairPolicy} : {}) }, check);
        const initialFillMandate = input.initialFill ? await appendInitialFillMandateInTransaction(client, { projectId, principal: who, impactId: locationImpact.id,
          commandSha256: endpointBindingHash(input), idempotencyKey: input.idempotencyKey, command: input }, check) : undefined;
        const receipt = cableEndpointReceiptSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-receipt.v1', projectId, actorId: who.userId, cableId, end: entry.end,
          logicalName: value.logicalName, idempotencyKey: input.idempotencyKey, commandSha256: endpointBindingHash(input), expectedCableWriteRevision: input.expectedCableWriteRevision,
          expectedContextSha256: input.expectedContextSha256, locationId: group.locationId, binding, impact: group.affected, locationImpact,
          ...(initialFillMandate ? { initialFillMandate } : {}), duplicate: false });
        await store(client, projectId, who, cableId, entry.end, input, { schemaVersion: 'wfc.pf.cable-endpoint-stored.v1', status: 'saved', receipt }); receipts.push(receipt); check();
      }
      const receipt = pairBudget(cableEndpointPairReceiptSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-pair-receipt.v1', ...disposition,
        finalRegistryRevision: revision, receipts, duplicate: false }));
      await storePair(client, projectId, who, cableId, command, { schemaVersion: 'wfc.pf.cable-endpoint-pair-stored.v1', status: 'saved', receipt }); check(); return receipt;
    }, signal);
  };
  return { authorize, context: read, selection,
    save: (projectId: string, who: JobPrincipal, cableId: string, end: unknown, command: unknown, signal?: AbortSignal) => write(projectId, who, cableId, end, command, signal, false) as Promise<z.infer<typeof cableEndpointReceiptSchema>>,
    close: (projectId: string, who: JobPrincipal, cableId: string, end: unknown, command: unknown, signal?: AbortSignal) => write(projectId, who, cableId, end, command, signal, true) as Promise<z.infer<typeof cableEndpointRecoverySchema>>,
    savePair: (projectId: string, who: JobPrincipal, cableId: string, command: unknown, signal?: AbortSignal) => writePair(projectId, who, cableId, command, signal) as Promise<z.infer<typeof cableEndpointPairReceiptSchema>>,
    closePair: (projectId: string, who: JobPrincipal, cableId: string, command: unknown, signal?: AbortSignal) => writePair(projectId, who, cableId, command, signal, true) as Promise<z.infer<typeof cableEndpointPairRecoverySchema>> };
}
export type CableEndpointCommands = ReturnType<typeof createCableEndpointCommands>;
