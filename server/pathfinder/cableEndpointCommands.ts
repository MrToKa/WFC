import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { CABLE_ENDPOINT_LIMITS, cableEndpointCommandSchema, cableEndpointContextHashInput, cableEndpointContextSchema,
  cableEndpointEndSchema, cableEndpointImpactSchema, cableEndpointReceiptSchema, cableEndpointRecoverySchema,
  cableEndpointClosedSchema, cableEndpointSdkObjectIdSchema, cableEndpointSelectionResponseSchema,
  type CableEndpointCommand, type CableEndpointContext } from '../../shared/pathfinderCableEndpoints.js';
import { ENDPOINT_ANCHOR_RULE, endpointBindingSchema, endpointLocationNameSchema, endpointLocationSchema } from '../../shared/pathfinderEndpointBindings.js';
import { assertLoginNotExpired } from './auth.js';
import type { JobPrincipal } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { normalizeLocation } from './matching.js';
import { cableWorkflowReadTransaction } from './cableWorkflowRead.js';
import { confirmEndpointBindingChangeInTransaction, endpointBindingHash, endpointBindingTransaction,
  readCurrentEndpointBindingContext } from './endpointBindingRepository.js';
import { readCableEndpointSelection } from './cableEndpointSelection.js';

const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'The cable endpoint changed or is unavailable. Refresh its context; retain an uncertain command until it is saved or explicitly closed.'); };
const budget = <T>(value: T): T => { if (Buffer.byteLength(canonicalPurposeJson(value)) > CABLE_ENDPOINT_LIMITS.responseBytes) return fail('CABLE_ENDPOINT_RESPONSE_LIMIT', 413); return value; };
type End = z.infer<typeof cableEndpointEndSchema>;
const owner = (cableId: string, end: End, command: CableEndpointCommand) => ({ schemaVersion: 'wfc.pf.cable-endpoint-command-owner.v1', cableId, end, command });

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
  const draft = cableEndpointContextSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-context.v1', projectId, cableId, end,
    cableWriteRevision: cable.cable_write_revision, logicalName, logicalKey, mto: cable.mto, canBind: reasons.length === 0,
    reasonCodes: reasons, registryRevision: registry.revision, location, head, current, contextSha256: '0'.repeat(64) });
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
      const binding = await confirmEndpointBindingChangeInTransaction(client, projectId, who, locationId, command.selection.mode === 'object-derived'
        ? { ...common, mode: 'object-derived', object: command.selection.object, anchorRule: ENDPOINT_ANCHOR_RULE }
        : { ...common, mode: 'fixed-world', pointProjectMetres: command.selection.pointProjectMetres, derivation: command.selection.derivation, provenanceObject: null }, signal);
      const receipt = cableEndpointReceiptSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-receipt.v1', projectId, actorId: who.userId, cableId, end, logicalName: value.logicalName,
        idempotencyKey: command.idempotencyKey, commandSha256: endpointBindingHash(command), expectedCableWriteRevision: command.expectedCableWriteRevision,
        expectedContextSha256: command.expectedContextSha256, locationId, binding, impact: affected, duplicate: false });
      check(); await store(client, projectId, who, cableId, end, command, { schemaVersion: 'wfc.pf.cable-endpoint-stored.v1', status: 'saved', receipt }); return budget(receipt);
    }, signal);
  };
  return { authorize, context: read, selection,
    save: (projectId: string, who: JobPrincipal, cableId: string, end: unknown, command: unknown, signal?: AbortSignal) => write(projectId, who, cableId, end, command, signal, false) as Promise<z.infer<typeof cableEndpointReceiptSchema>>,
    close: (projectId: string, who: JobPrincipal, cableId: string, end: unknown, command: unknown, signal?: AbortSignal) => write(projectId, who, cableId, end, command, signal, true) as Promise<z.infer<typeof cableEndpointRecoverySchema>> };
}
export type CableEndpointCommands = ReturnType<typeof createCableEndpointCommands>;
