import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  MODEL_LOCATION_MATCH_LIMITS, modelLocationMatchAssignSchema, modelLocationMatchReceiptSchema, modelLocationMatchSummarySchema,
  modelLocationMatchCounts, type ModelLocationMatchContext, type ModelLocationMatchResult,
} from '../../shared/pathfinderModelLocationMatch.js';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { endpointBindingSchema, normalizeEndpointLocation, type EndpointBinding } from '../../shared/pathfinderEndpointBindings.js';
import { PathFinderError } from './errors.js';

const hash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const same = (left: unknown, right: unknown) => canonicalPurposeJson(left) === canonicalPurposeJson(right);
const invalid = (): never => { throw new PathFinderError('MODEL_LOCATION_MATCH_SUMMARY_INTEGRITY', 409, 'Saved matching results could not be verified.'); };
const limited = (): never => { throw new PathFinderError('MODEL_LOCATION_MATCH_SUMMARY_LIMIT', 413, 'Saved matching results exceed the supported read size.'); };
// PostgreSQL jsonb text includes separator spaces absent from canonical JSON.
// Bound that stored representation before reading; retain admission limits on
// the verified canonical request and receipt after materialization.
const storedRequestBytes = MODEL_LOCATION_MATCH_LIMITS.bodyBytes * 2;
const storedReceiptBytes = MODEL_LOCATION_MATCH_LIMITS.responseBytes * 2;
type Saved = { actor_id: string; idempotency_key: string; kind: string; request_sha256: string; request: unknown; receipt: unknown };
type Latest = Pick<Saved, 'actor_id' | 'idempotency_key'> & { name: string; request_bytes: number; receipt_bytes: number };
const indexPageNames = MODEL_LOCATION_MATCH_LIMITS.names + 1;

/** Latest successful receipt for each name in this model. Network regeneration
 * and additional cable names do not erase model observations. Read metadata first, then verify each contributing immutable
 * command once. Failed/unknown requests have no receipt and add no coverage. */
export async function readModelLocationMatchSummary(client: PoolClient, context: ModelLocationMatchContext, check: () => void) {
  const wanted = new Set(context.names.map(normalizeEndpointLocation)), latest = new Map<string, Latest>();
  // Historical spelling variants share one logical name. Page the bounded
  // metadata in receipt order and use the same Unicode normalization as the
  // command/context contracts before applying the logical-name limit. SQL
  // upper()/collation rules need not match JavaScript's toUpperCase().
  // Materialize byte sizes once per command before expanding its result names.
  // Otherwise PostgreSQL can stringify the full captured request for every
  // name in a page, exhausting the read deadline despite a small result.
  for (let offset = 0; ; offset += indexPageNames) {
    const page = (await client.query<Latest>(`/* model-location-match:summary-index */ SELECT indexed.* FROM (WITH matching_commands AS MATERIALIZED (
    SELECT actor_id,idempotency_key,created_at,receipt,
      octet_length(request::text) AS request_bytes,octet_length(receipt::text) AS receipt_bytes
    FROM pf_endpoint_binding_commands
    WHERE project_id=$1 AND kind='confirm' AND request->>'schemaVersion'='wfc.pf.model-location-match-owner.v1'
      AND receipt->>'schemaVersion'='wfc.pf.model-location-match-receipt.v1'
      AND request#>>'{command,current,modelVersionId}'=$2 AND request#>>'{command,current,contentFingerprint}'=$3
  ) SELECT selected.* FROM (
    SELECT DISTINCT ON (result->>'name') actor_id,idempotency_key,result->>'name' AS name,created_at,
      request_bytes,receipt_bytes
    FROM matching_commands
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(receipt->'results')='array' THEN receipt->'results' ELSE '[]'::jsonb END) result
    ORDER BY result->>'name',created_at DESC,actor_id DESC,idempotency_key DESC
  ) selected ORDER BY created_at DESC,actor_id DESC,idempotency_key DESC,name COLLATE "C" LIMIT ${indexPageNames} OFFSET $4) indexed`,
    [context.projectId, context.current.modelVersionId, context.current.contentFingerprint, offset])).rows; check();
    for (const row of page) {
      if (!policyUuidSchema.safeParse(row.actor_id).success || !policyUuidSchema.safeParse(row.idempotency_key).success
        || typeof row.name !== 'string') return invalid();
      const name = normalizeEndpointLocation(row.name);
      if (!wanted.has(name)) continue;
      if (!latest.has(name)) latest.set(name, row);
    }
    if (latest.size > MODEL_LOCATION_MATCH_LIMITS.names) return limited();
    if (page.length < indexPageNames) break;
  }
  const commands = new Map<string, Latest>();
  let bytes = 0;
  for (const row of latest.values()) {
    const key = row.actor_id + ':' + row.idempotency_key;
    if (commands.has(key)) continue;
    if (!Number.isSafeInteger(row.request_bytes) || row.request_bytes <= 0 || row.request_bytes > storedRequestBytes
      || !Number.isSafeInteger(row.receipt_bytes) || row.receipt_bytes <= 0 || row.receipt_bytes > storedReceiptBytes) return limited();
    bytes += row.request_bytes + row.receipt_bytes;
    if (bytes > 24 * 1024 ** 2) return limited();
    commands.set(key, row);
  }
  const receipts = new Map<string, Map<string, ModelLocationMatchResult>>();
  for (const [key, row] of commands) {
    const rows = (await client.query<Saved>(`/* model-location-match:summary-command */ SELECT actor_id,idempotency_key,kind,request_sha256,
      CASE WHEN octet_length(request::text)<=${storedRequestBytes} THEN request ELSE NULL END AS request,
      CASE WHEN octet_length(receipt::text)<=${storedReceiptBytes} THEN receipt ELSE NULL END AS receipt
      FROM pf_endpoint_binding_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 LIMIT 1`,
    [context.projectId, row.actor_id, row.idempotency_key])).rows; check();
    const saved = rows[0]; if (rows.length !== 1 || !saved) return invalid();
    const raw = saved.request as { schemaVersion?: unknown; command?: unknown } | null;
    const parsed = modelLocationMatchAssignSchema.safeParse(raw?.command), receipt = modelLocationMatchReceiptSchema.safeParse(saved.receipt);
    if (raw && Buffer.byteLength(canonicalPurposeJson(raw)) > MODEL_LOCATION_MATCH_LIMITS.bodyBytes
      || receipt.success && Buffer.byteLength(canonicalPurposeJson(receipt.data)) > MODEL_LOCATION_MATCH_LIMITS.responseBytes) return limited();
    if (!raw || raw.schemaVersion !== 'wfc.pf.model-location-match-owner.v1' || Object.keys(raw).sort().join() !== 'command,schemaVersion'
      || saved.kind !== 'confirm' || saved.actor_id !== row.actor_id || saved.idempotency_key !== row.idempotency_key
      || !parsed.success || !receipt.success || saved.request_sha256 !== hash(raw)) return invalid();
    const command = parsed.data, result = receipt.data;
    if (command.current.modelVersionId !== context.current.modelVersionId || command.current.contentFingerprint !== context.current.contentFingerprint
      || command.idempotencyKey !== row.idempotency_key
      || result.projectId !== context.projectId || result.idempotencyKey !== row.idempotency_key || result.commandSha256 !== hash(command)
      || BigInt(result.registryRevision) < BigInt(command.expectedRegistryRevision) || BigInt(result.registryRevision) > BigInt(context.registryRevision)
      || !same(result.results.map(value => normalizeEndpointLocation(value.name)).sort(), command.names.map(normalizeEndpointLocation).sort())) return invalid();
    receipts.set(key, new Map(result.results.map(value => [normalizeEndpointLocation(value.name), value])));
  }
  const results = new Map<string, ModelLocationMatchResult>();
  for (const row of latest.values()) {
    const key = normalizeEndpointLocation(row.name), result = receipts.get(row.actor_id + ':' + row.idempotency_key)?.get(key);
    if (!result) return invalid();
    if (!results.has(key)) results.set(key, result);
  }
  // A shared location can be changed manually after the immutable matching
  // receipt. Read its current head rather than resurrecting the earlier point.
  type Head = { normalized_alias: string; location_id: string; location_revision: string; binding_id: string | null; record_sha256: string | null; record: unknown; total_bytes: string; has_legacy: boolean };
  const heads = (await client.query<Head>(`/* model-location-match:summary-heads */ SELECT normalized_alias,location_id,location_revision,binding_id,record_sha256,has_legacy,
    CASE WHEN total_bytes<=25165824 AND octet_length(record::text)<=65536 THEN record ELSE NULL END AS record,total_bytes::text
    FROM (SELECT a.normalized_alias,l.id AS location_id,l.revision::text AS location_revision,h.binding_id,r.record_sha256,r.record,
      EXISTS(SELECT 1 FROM pf_location_bindings legacy WHERE legacy.project_id=l.project_id AND legacy.location_id=l.id AND legacy.model_version_id=$3) AS has_legacy,
      sum(coalesce(octet_length(r.record::text),0)) OVER() AS total_bytes
      FROM pf_location_aliases a JOIN pf_locations l ON l.project_id=a.project_id AND l.id=a.location_id
      LEFT JOIN pf_endpoint_binding_heads h ON h.project_id=l.project_id AND h.location_id=l.id
      LEFT JOIN pf_endpoint_binding_revisions r ON r.project_id=h.project_id AND r.location_id=h.location_id AND r.id=h.binding_id
      WHERE a.project_id=$1 AND a.normalized_alias=ANY($2::text[]) ORDER BY a.normalized_alias LIMIT 4097) selected`,
  [context.projectId, [...wanted], context.current.modelVersionId])).rows; check();
  if (heads.length > MODEL_LOCATION_MATCH_LIMITS.names) return limited();
  const live = new Map<string, { locationId: string; binding: EndpointBinding | null; legacy: boolean }>();
  for (const row of heads) {
    if (!wanted.has(row.normalized_alias) || live.has(row.normalized_alias) || !policyUuidSchema.safeParse(row.location_id).success) return invalid();
    if (!/^(?:0|[1-9][0-9]*)$/.test(row.total_bytes) || BigInt(row.total_bytes) > 25165824n) return limited();
    let binding: EndpointBinding | null = null;
    if (row.binding_id) {
      const parsed = endpointBindingSchema.safeParse(row.record); if (!parsed.success) return invalid();
      const { contentSha256, ...body } = parsed.data;
      if (parsed.data.id !== row.binding_id || parsed.data.projectId !== context.projectId || parsed.data.locationId !== row.location_id
        || contentSha256 !== row.record_sha256 || hash(body) !== contentSha256) return invalid();
      if (parsed.data.status === 'confirmed' && parsed.data.locationRevision === row.location_revision
        && parsed.data.modelVersionId === context.current.modelVersionId
        && (!parsed.data.autoMatchEvidence || parsed.data.autoMatchEvidence.current.contentFingerprint === context.current.contentFingerprint)) binding = parsed.data;
    }
    live.set(row.normalized_alias, { locationId: row.location_id, binding, legacy: !row.binding_id && row.has_legacy === true });
  }
  const ordered = context.names.flatMap(name => {
    const key = normalizeEndpointLocation(name), result = results.get(key), current = live.get(key);
    if (current?.binding) {
      if (result?.bindingId === current.binding.id && result.locationId === current.locationId) return [{ ...result, name }];
      return [{ name, status: 'preserved' as const, candidateObjectIds: current.binding.autoMatchEvidence ? [current.binding.autoMatchEvidence.sdkObjectId] : [],
        locationId: current.locationId, bindingId: current.binding.id, reasonCode: 'EXISTING_LOCATION_BINDING_PRESERVED' }];
    }
    if (current?.legacy) return [{ name, status: 'preserved' as const, candidateObjectIds: result?.candidateObjectIds ?? [],
      locationId: current.locationId, bindingId: null, reasonCode: 'EXISTING_LOCATION_BINDING_PRESERVED' }];
    // Stale or removed heads invalidate this name alone. Negative model search
    // results remain reusable until the model itself changes.
    if (!result || result.status === 'assigned' || result.status === 'preserved') return [];
    return [{ ...result, name }];
  });
  const summary = modelLocationMatchSummarySchema.parse({ schemaVersion: 'wfc.pf.model-location-match-summary.v1', context,
    results: ordered, counts: modelLocationMatchCounts(ordered), complete: ordered.length === context.names.length });
  if (Buffer.byteLength(canonicalPurposeJson(summary)) > MODEL_LOCATION_MATCH_LIMITS.responseBytes) return limited();
  return summary;
}
