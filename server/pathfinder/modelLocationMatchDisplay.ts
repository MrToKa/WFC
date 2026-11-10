import type { PoolClient } from 'pg';
import { z } from 'zod';
import { modelLocationMatchAssignSchema, modelLocationMatchReceiptSchema } from '../../shared/pathfinderModelLocationMatch.js';
import { normalizeEndpointLocation, type EndpointBinding, type EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { cableEndpointConfirmedDisplaySelectionSchema, cableEndpointDisplayObjectNameSchema, type CableEndpointContext } from '../../shared/pathfinderCableEndpoints.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { endpointBindingHash } from './endpointBindingRepository.js';
import { groupModelLocationMatchCandidates } from './modelLocationMatchCandidates.js';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';

const owner = z.object({ schemaVersion: z.literal('wfc.pf.model-location-match-owner.v1'), command: modelLocationMatchAssignSchema }).strict();
const same = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
const displayLabel = (name: string) => cableEndpointDisplayObjectNameSchema.safeParse(name).success ? { name } : {};
type DisplayInput = { projectId: string; current: EndpointCurrentScope;
  location: NonNullable<CableEndpointContext['location']>; head: EndpointBinding };
export type EndpointDisplayCommandBoundary = { actorId: string; idempotencyKey: string };

/** A later successful Find may restore presentation for a preserved manual
 * point. It neither replaces that point nor supplies calculation authority. */
export async function readPreservedLocationDisplay(client: PoolClient, input: DisplayInput, check: () => void,
  after: EndpointDisplayCommandBoundary | null = null): Promise<NonNullable<CableEndpointContext['confirmedDisplaySelection']> | null> {
  const { projectId, current, location, head } = input, { contentSha256, ...headBody } = head;
  if (head.projectId !== projectId || head.locationId !== location.id || head.locationRevision !== location.revision
    || head.status !== 'confirmed' || head.mode !== 'fixed-world' || head.derivation === 'matched-model-bottom-aabb.v1'
    || head.sourceObject !== null || head.attachment !== null || head.modelVersionId !== current.modelVersionId
    || head.aggregateId !== current.aggregateId || head.artifactId !== current.artifactId
    || head.captureFrameId !== current.captureFrameId || head.projectionSha256 !== current.projectionSha256
    || endpointBindingHash(headBody) !== contentSha256) return null;
  check();
  const rows = (await client.query<{ actor_id: unknown; idempotency_key: unknown; kind: unknown; request_sha256: unknown; request: unknown; receipt: unknown }>(
    `/* model-location-match:preserved-display */ SELECT actor_id,idempotency_key,kind,request_sha256,
      CASE WHEN octet_length(request::text)<=1048576 THEN request ELSE NULL END AS request,
      CASE WHEN octet_length(receipt::text)<=1048576 THEN receipt ELSE NULL END AS receipt
      FROM pf_endpoint_binding_commands WHERE project_id=$1 AND kind='confirm'
        AND request->>'schemaVersion'='wfc.pf.model-location-match-owner.v1'
        AND receipt->>'schemaVersion'='wfc.pf.model-location-match-receipt.v1'
        AND request#>'{command,current}'=$4::jsonb
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(receipt->'results')='array'
          THEN receipt->'results' ELSE '[]'::jsonb END) result
          WHERE result->>'locationId'=$2 AND result->>'bindingId'=$3)
        AND ($5::uuid IS NULL OR (created_at,actor_id,idempotency_key)>
          (SELECT created_at,actor_id,idempotency_key FROM pf_endpoint_binding_commands
            WHERE project_id=$1 AND actor_id=$5 AND idempotency_key=$6))
      ORDER BY created_at DESC,actor_id DESC,idempotency_key DESC LIMIT 1 FOR SHARE`,
    [projectId, location.id, head.id, current, after?.actorId ?? null, after?.idempotencyKey ?? null])).rows;
  check(); if (rows.length !== 1) return null;
  const row = rows[0], request = owner.safeParse(row.request), saved = modelLocationMatchReceiptSchema.safeParse(row.receipt);
  if (row.kind !== 'confirm' || !policyUuidSchema.safeParse(row.actor_id).success || !request.success || !saved.success
    || row.request_sha256 !== endpointBindingHash(request.data)) return null;
  const command = request.data.command, receipt = saved.data, commandSha256 = endpointBindingHash(command);
  if (row.idempotency_key !== command.idempotencyKey || receipt.idempotencyKey !== command.idempotencyKey
    || receipt.projectId !== projectId || receipt.commandSha256 !== commandSha256 || !same(command.current, current)
    || BigInt(command.expectedRegistryRevision) < BigInt(head.locationRegistryRevision)
    || BigInt(receipt.registryRevision) < BigInt(command.expectedRegistryRevision)
    || receipt.results.length !== command.names.length
    || !same(receipt.results.map(result => normalizeEndpointLocation(result.name)).sort(), command.names.map(normalizeEndpointLocation).sort())) return null;
  const names = new Set([location.name, ...location.aliases].map(normalizeEndpointLocation));
  const results = receipt.results.filter(result => names.has(normalizeEndpointLocation(result.name)));
  if (!results.length) return null;
  let selected: ReturnType<typeof groupModelLocationMatchCandidates>[number] | undefined;
  for (const result of results) {
    const key = normalizeEndpointLocation(result.name), raw = command.scan.candidates.filter(candidate => candidate.matchedNames.some(name => normalizeEndpointLocation(name) === key));
    if (result.locationId !== location.id || result.bindingId !== head.id || result.status !== 'preserved' || result.reasonCode !== 'EXISTING_LOCATION_BINDING_PRESERVED'
      || !same(result.candidateObjectIds, raw.map(candidate => candidate.objectId).sort((a, b) => a - b)) || !raw.length) return null;
    const identity = raw[0].objectIdentity;
    if (!identity || raw.some(candidate => !candidate.objectIdentity || !same(candidate.objectIdentity, identity))) return null;
    let candidates: ReturnType<typeof groupModelLocationMatchCandidates>;
    try { candidates = groupModelLocationMatchCandidates(command.scan.candidates, key); } catch { return null; }
    const candidate = candidates[0];
    if (candidates.length !== 1 || !candidate || candidate.objectId <= 0 || !candidate.bounds || !candidate.bottomCentre
      || Math.hypot(...candidate.bottomCentre.map((value, axis) => value - head.pointProjectMetres[axis])) > 1e-6
      || selected && !same(selected, candidate)) return null;
    selected = candidate;
  }
  if (!selected) return null;
  const display = cableEndpointConfirmedDisplaySelectionSchema.safeParse({ source: 'confirmed-display-only', mode: 'fixed-world',
    sdkObjectId: selected.objectId, ...displayLabel(selected.name), ...(selected.objectGroup
      ? { sdkObjectIds: selected.objectGroup.objectIds, preservedMatchObjectGroup: selected.objectGroup } : {}),
    pointProjectMetres: head.pointProjectMetres, current, bindingId: head.id, bindingContentSha256: head.contentSha256, commandSha256 });
  return display.success ? display.data : null;
}
/** Recover only presentation identity from the exact successful bulk command. */
export async function readMatchedLocationDisplay(client: PoolClient, input: { projectId: string; current: EndpointCurrentScope;
  location: NonNullable<CableEndpointContext['location']>; head: EndpointBinding }, check: () => void) {
  const { projectId, current, location, head } = input, evidence = head.autoMatchEvidence;
  if (!evidence || !same(evidence.current, current) || ![location.name, ...location.aliases].map(normalizeEndpointLocation).includes(evidence.logicalKey)) return null;
  const rows = (await client.query<{ actor_id: unknown; idempotency_key: unknown; kind: unknown; request_sha256: unknown; request: unknown; receipt: unknown }>(
    "/* model-location-match:display */ SELECT actor_id,idempotency_key,kind,request_sha256,CASE WHEN octet_length(request::text)<=1048576 THEN request ELSE NULL END AS request,CASE WHEN octet_length(receipt::text)<=1048576 THEN receipt ELSE NULL END AS receipt FROM pf_endpoint_binding_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 AND kind='confirm' AND request->>'schemaVersion'='wfc.pf.model-location-match-owner.v1' LIMIT 1 FOR SHARE",
    [projectId, head.confirmedBy, evidence.operationId])).rows;
  check(); if (rows.length !== 1) return null;
  const row = rows[0], request = owner.safeParse(row.request), saved = modelLocationMatchReceiptSchema.safeParse(row.receipt);
  if (!request.success || !saved.success || row.kind !== 'confirm' || row.actor_id !== head.confirmedBy || row.idempotency_key !== evidence.operationId
    || row.request_sha256 !== endpointBindingHash(request.data)) return null;
  const command = request.data.command, receipt = saved.data;
  let candidates: ReturnType<typeof groupModelLocationMatchCandidates>;
  try { candidates = groupModelLocationMatchCandidates(command.scan.candidates, evidence.logicalKey); }
  catch { return null; }
  const result = receipt.results.find(r => normalizeEndpointLocation(r.name) === evidence.logicalKey);
  if (receipt.projectId !== projectId || receipt.idempotencyKey !== evidence.operationId || command.idempotencyKey !== evidence.operationId
    || endpointBindingHash(command) !== evidence.commandSha256 || receipt.commandSha256 !== evidence.commandSha256
    || endpointBindingHash(command.scan) !== evidence.scanSha256 || command.namesSha256 !== evidence.namesSha256
    || !same(command.current, current) || command.scan.matchingPolicyVersion !== evidence.matchingPolicyVersion
    || command.scan.visibilityScope.contentSha256 !== evidence.visibilityScopeSha256
    || candidates.length !== 1 || candidates[0].objectId !== evidence.sdkObjectId || candidates[0].name !== evidence.objectName
    || !same(candidates[0].objectGroup ?? null, evidence.objectGroup ?? null)
    || !same(candidates[0].bounds, evidence.bounds) || !same(candidates[0].bottomCentre, head.pointProjectMetres)
    || !result || result.status !== 'assigned' || result.locationId !== location.id || result.bindingId !== head.id
    || !same(result.candidateObjectIds, [evidence.sdkObjectId]) || BigInt(receipt.registryRevision) < BigInt(head.locationRegistryRevision)) return null;
  const display = cableEndpointConfirmedDisplaySelectionSchema.safeParse({ source: 'confirmed-display-only', mode: 'fixed-world', sdkObjectId: evidence.sdkObjectId,
    ...(evidence.objectGroup ? { sdkObjectIds: evidence.objectGroup.objectIds } : {}),
    ...displayLabel(evidence.objectName), pointProjectMetres: head.pointProjectMetres, current, bindingId: head.id,
    bindingContentSha256: head.contentSha256, commandSha256: evidence.commandSha256 });
  return display.success ? display.data : null;
}
