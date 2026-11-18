import type { PoolClient } from 'pg';
import { z } from 'zod';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { cableEndpointCommandSchema, cableEndpointEndSchema, cableEndpointReceiptSchema,
  cableEndpointConfirmedDisplaySelectionSchema, type CableEndpointContext } from '../../shared/pathfinderCableEndpoints.js';
import { endpointBindingSchema, type EndpointBinding, type EndpointCurrentScope } from '../../shared/pathfinderEndpointBindings.js';
import { endpointBindingHash } from './endpointBindingRepository.js';
import { readMatchedLocationDisplay, readPreservedLocationDisplay } from './modelLocationMatchDisplay.js';
import { readNumericalLocationMatchDisplay } from './numericalLocationMatchDisplay.js';

const ownerSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-command-owner.v1'),
  cableId: policyUuidSchema, end: cableEndpointEndSchema, command: cableEndpointCommandSchema }).strict();
const storedSchema = z.object({ schemaVersion: z.literal('wfc.pf.cable-endpoint-stored.v1'), status: z.literal('saved'), receipt: cableEndpointReceiptSchema }).strict();
type Row = { actor_id: unknown; idempotency_key: unknown; kind: unknown; request_sha256: unknown; request: unknown; receipt: unknown };
const same = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);

async function readDisplayCommands(client: PoolClient, projectId: string, locationId: string, head: EndpointBinding) {
  // Select the last successful per-end command, including an explicit null hint.
  // Outer pair receipts and closure records never qualify. Transfer is byte bounded.
  return (await client.query<Row>(`/* cable-endpoint:display-command */ SELECT actor_id,idempotency_key,kind,request_sha256,
    CASE WHEN octet_length(request::text)<=65536 THEN request ELSE NULL END AS request,
    CASE WHEN octet_length(receipt::text)<=1048576 THEN receipt ELSE NULL END AS receipt
    FROM pf_endpoint_binding_commands WHERE project_id=$1 AND kind='confirm'
      AND request->>'schemaVersion'='wfc.pf.cable-endpoint-command-owner.v1'
      AND receipt->>'schemaVersion'='wfc.pf.cable-endpoint-stored.v1' AND receipt->>'status'='saved'
      AND receipt#>>'{receipt,locationId}'=$2 AND receipt#>>'{receipt,binding,binding,id}'=$3
      AND receipt#>>'{receipt,binding,binding,contentSha256}'=$4
    ORDER BY created_at DESC,actor_id DESC,idempotency_key DESC LIMIT 1 FOR SHARE`,
  [projectId, locationId, head.id, head.contentSha256])).rows;
}

/** Read-only recovery from the successful command ledger. Never turns an SDK hint into geometry authority. */
export async function readCableEndpointDisplay(client: PoolClient, input: { projectId: string; current: EndpointCurrentScope;
  location: NonNullable<CableEndpointContext['location']>; head: EndpointBinding }, check: () => void): Promise<NonNullable<CableEndpointContext['confirmedDisplaySelection']> | null> {
  const { projectId, current, location, head } = input;
  const { contentSha256, ...headBody } = head;
  if (head.projectId !== projectId || head.locationId !== location.id || head.locationRevision !== location.revision
    || head.status !== 'confirmed' || head.mode !== 'fixed-world' || head.sourceObject !== null || head.attachment !== null
    || head.modelVersionId !== current.modelVersionId || head.aggregateId !== current.aggregateId || head.artifactId !== current.artifactId
    || head.captureFrameId !== current.captureFrameId || head.projectionSha256 !== current.projectionSha256
    || endpointBindingHash(headBody) !== contentSha256) return null;
  check();
  if (head.sameModelReuse && (head.sameModelReuse.targetTraceId !== current.traceId
    || head.sameModelReuse.contentFingerprint !== current.contentFingerprint)) return null;
  if (['matched-model-bottom-aabb.v1', 'matched-model-centre-fallback.v1'].includes(head.derivation)) return readMatchedLocationDisplay(client, input, check);
  let savedHead = head;
  let rows = await readDisplayCommands(client, projectId, location.id, savedHead);
  check();
  // A no-op save may explicitly change or clear the object on any revision.
  // Follow only verified carry-forward links and stop at the first such save.
  while (!rows.length && savedHead.sameModelReuse) {
    const reuse = savedHead.sameModelReuse;
    const prior = (await client.query<{ record: unknown; record_sha256: string }>(
      `/* cable-endpoint:display-source */ SELECT record,record_sha256 FROM pf_endpoint_binding_revisions
        WHERE project_id=$1 AND location_id=$2 AND id=$3 AND octet_length(record::text)<=65536 FOR SHARE`,
      [projectId, location.id, reuse.sourceBindingId])).rows[0];
    check();
    const parsed = endpointBindingSchema.safeParse(prior?.record);
    if (!parsed.success) return null;
    const source = parsed.data, { contentSha256, ...body } = source;
    if (contentSha256 !== prior.record_sha256 || contentSha256 !== reuse.sourceBindingSha256 || endpointBindingHash(body) !== contentSha256
      || source.id !== reuse.sourceBindingId || source.projectId !== projectId || source.locationId !== location.id
      || source.locationRevision !== head.locationRevision || BigInt(source.bindingRevision) + 1n !== BigInt(savedHead.bindingRevision)
      || source.modelVersionId !== current.modelVersionId || reuse.contentFingerprint !== current.contentFingerprint
      || source.aggregateId !== reuse.sourceAggregateId || source.artifactId !== reuse.sourceArtifactId
      || source.projectionSha256 !== reuse.sourceProjectionSha256 || source.captureFrameId !== reuse.sourceCaptureFrameId
      || (source.sameModelReuse?.originalBindingId ?? source.id) !== reuse.originalBindingId
      || (source.sameModelReuse?.originalBindingSha256 ?? contentSha256) !== reuse.originalBindingSha256
      || source.status !== 'confirmed' || source.mode !== 'fixed-world' || source.sourceObject !== null || source.attachment !== null
      || source.derivation !== head.derivation || !same(source.pointProjectMetres, head.pointProjectMetres)) return null;
    savedHead = source;
    rows = await readDisplayCommands(client, projectId, location.id, savedHead);
    check();
  }
  if (rows.length !== 1) {
    if (rows.length !== 0) return null;
    return await readPreservedLocationDisplay(client,input,check) ?? readNumericalLocationMatchDisplay(client,input,check);
  }
  const row = rows[0], parsed = ownerSchema.safeParse(row.request), stored = storedSchema.safeParse(row.receipt);
  if (row.kind !== 'confirm' || !parsed.success || !stored.success
    || row.request_sha256 !== endpointBindingHash(parsed.data)) return null;
  const request = parsed.data, command = request.command, receipt = stored.data.receipt, selection = command.selection;
  const names = [location.name, ...location.aliases].map(value => value.normalize('NFC').trim().toUpperCase());
  if (receipt.projectId !== projectId || receipt.actorId !== row.actor_id || receipt.idempotencyKey !== row.idempotency_key
    || receipt.cableId !== request.cableId || receipt.end !== request.end || receipt.idempotencyKey !== command.idempotencyKey
    || receipt.logicalName !== command.expectedLogicalName || !names.includes(receipt.logicalName.normalize('NFC').trim().toUpperCase())
    || receipt.locationId !== location.id || command.expectedLocationId !== null && command.expectedLocationId !== location.id
    || receipt.commandSha256 !== endpointBindingHash(command) || receipt.expectedContextSha256 !== command.expectedContextSha256
    || receipt.expectedCableWriteRevision !== command.expectedCableWriteRevision || !receipt.impact.cableIds.includes(request.cableId)
    || !same(receipt.binding.binding, savedHead)
    || selection.mode !== 'fixed-world' || selection.derivation !== head.derivation || !same(selection.pointProjectMetres, head.pointProjectMetres)
  ) return null;
  const savedScope = command.expectedCurrent;
  if (savedScope.modelVersionId !== current.modelVersionId || savedScope.contentFingerprint !== current.contentFingerprint
    || savedScope.aggregateId !== savedHead.aggregateId || savedScope.artifactId !== savedHead.artifactId
    || savedScope.projectionSha256 !== savedHead.projectionSha256 || savedScope.captureFrameId !== savedHead.captureFrameId
    || selection.displaySdkObjectId === null)
    return readPreservedLocationDisplay(client, input, check, { actorId: receipt.actorId, idempotencyKey: receipt.idempotencyKey });
  return cableEndpointConfirmedDisplaySelectionSchema.parse({ source: 'confirmed-display-only', mode: 'fixed-world',
    sdkObjectId: selection.displaySdkObjectId, ...(selection.displayObjectName === undefined ? {} : { name: selection.displayObjectName }),
    pointProjectMetres: head.pointProjectMetres, current, bindingId: head.id, bindingContentSha256: head.contentSha256, commandSha256: receipt.commandSha256 });
}
