import type { PoolClient } from 'pg';
import { z } from 'zod';
import { modelLocationMatchAssignSchema, modelLocationMatchReceiptSchema } from '../../shared/pathfinderModelLocationMatch.js';
import { normalizeEndpointLocation, type EndpointBinding, type EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { cableEndpointConfirmedDisplaySelectionSchema, type CableEndpointContext } from '../../shared/pathfinderCableEndpoints.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { endpointBindingHash } from './endpointBindingRepository.js';

const owner = z.object({ schemaVersion: z.literal('wfc.pf.model-location-match-owner.v1'), command: modelLocationMatchAssignSchema }).strict();
const same = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
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
  const candidates = command.scan.candidates.filter(c => c.matchedNames.some(n => normalizeEndpointLocation(n) === evidence.logicalKey));
  const result = receipt.results.find(r => normalizeEndpointLocation(r.name) === evidence.logicalKey);
  if (receipt.projectId !== projectId || receipt.idempotencyKey !== evidence.operationId || command.idempotencyKey !== evidence.operationId
    || endpointBindingHash(command) !== evidence.commandSha256 || receipt.commandSha256 !== evidence.commandSha256
    || endpointBindingHash(command.scan) !== evidence.scanSha256 || command.namesSha256 !== evidence.namesSha256
    || !same(command.current, current) || command.scan.matchingPolicyVersion !== evidence.matchingPolicyVersion
    || command.scan.visibilityScope.contentSha256 !== evidence.visibilityScopeSha256
    || candidates.length !== 1 || candidates[0].objectId !== evidence.sdkObjectId || candidates[0].name !== evidence.objectName
    || !same(candidates[0].bounds, evidence.bounds) || !same(candidates[0].bottomCentre, head.pointProjectMetres)
    || !result || result.status !== 'assigned' || result.locationId !== location.id || result.bindingId !== head.id
    || !same(result.candidateObjectIds, [evidence.sdkObjectId]) || BigInt(receipt.registryRevision) < BigInt(head.locationRegistryRevision)) return null;
  return cableEndpointConfirmedDisplaySelectionSchema.parse({ source: 'confirmed-display-only', mode: 'fixed-world', sdkObjectId: evidence.sdkObjectId,
    name: evidence.objectName, pointProjectMetres: head.pointProjectMetres, current, bindingId: head.id,
    bindingContentSha256: head.contentSha256, commandSha256: evidence.commandSha256 });
}
