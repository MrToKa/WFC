import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  MODEL_LOCATION_MATCH_LIMITS, modelLocationMatchAssignSchema, modelLocationMatchReceiptSchema, modelLocationMatchSummarySchema,
  modelLocationMatchCounts, type ModelLocationMatchContext, type ModelLocationMatchResult,
} from '../../shared/pathfinderModelLocationMatch.js';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { normalizeEndpointLocation } from '../../shared/pathfinderEndpointBindings.js';
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

/** Latest successful receipt for each name in this exact model/preparation and
 * name universe. Read metadata first, then verify each contributing immutable
 * command once. Failed/unknown requests have no receipt and add no coverage. */
export async function readModelLocationMatchSummary(client: PoolClient, context: ModelLocationMatchContext, check: () => void) {
  const wanted = new Set(context.names.map(normalizeEndpointLocation)), latest = new Map<string, Latest>();
  // Historical spelling variants share one logical name. Page the bounded
  // metadata in receipt order and use the same Unicode normalization as the
  // command/context contracts before applying the logical-name limit. SQL
  // upper()/collation rules need not match JavaScript's toUpperCase().
  for (let offset = 0; ; offset += indexPageNames) {
    const page = (await client.query<Latest>(`/* model-location-match:summary-index */ SELECT selected.* FROM (
    SELECT DISTINCT ON (result->>'name') actor_id,idempotency_key,result->>'name' AS name,created_at,
      octet_length(request::text) AS request_bytes,octet_length(receipt::text) AS receipt_bytes
    FROM pf_endpoint_binding_commands
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(receipt->'results')='array' THEN receipt->'results' ELSE '[]'::jsonb END) result
    WHERE project_id=$1 AND kind='confirm' AND request->>'schemaVersion'='wfc.pf.model-location-match-owner.v1'
      AND receipt->>'schemaVersion'='wfc.pf.model-location-match-receipt.v1'
      AND request#>'{command,current}'=$2::jsonb AND request#>>'{command,namesSha256}'=$3
    ORDER BY result->>'name',created_at DESC,actor_id DESC,idempotency_key DESC
  ) selected ORDER BY created_at DESC,actor_id DESC,idempotency_key DESC,name COLLATE "C" LIMIT ${indexPageNames} OFFSET $4`,
    [context.projectId, context.current, context.namesSha256, offset])).rows; check();
    for (const row of page) {
      if (!policyUuidSchema.safeParse(row.actor_id).success || !policyUuidSchema.safeParse(row.idempotency_key).success
        || typeof row.name !== 'string' || !wanted.has(normalizeEndpointLocation(row.name))) return invalid();
      const name = normalizeEndpointLocation(row.name);
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
    if (!same(command.current, context.current) || command.namesSha256 !== context.namesSha256 || command.idempotencyKey !== row.idempotency_key
      || result.projectId !== context.projectId || result.idempotencyKey !== row.idempotency_key || result.commandSha256 !== hash(command)
      || BigInt(result.registryRevision) < BigInt(command.expectedRegistryRevision) || BigInt(result.registryRevision) > BigInt(context.registryRevision)
      || !same(result.results.map(value => normalizeEndpointLocation(value.name)).sort(), command.names.map(normalizeEndpointLocation).sort())
      || result.results.some(value => !wanted.has(normalizeEndpointLocation(value.name)))) return invalid();
    receipts.set(key, new Map(result.results.map(value => [normalizeEndpointLocation(value.name), value])));
  }
  const results = new Map<string, ModelLocationMatchResult>();
  for (const row of latest.values()) {
    const key = normalizeEndpointLocation(row.name), result = receipts.get(row.actor_id + ':' + row.idempotency_key)?.get(key);
    if (!result) return invalid();
    if (!results.has(key)) results.set(key, result);
  }
  const ordered = context.names.flatMap(name => { const result = results.get(normalizeEndpointLocation(name)); return result ? [{ ...result, name }] : []; });
  const summary = modelLocationMatchSummarySchema.parse({ schemaVersion: 'wfc.pf.model-location-match-summary.v1', context,
    results: ordered, counts: modelLocationMatchCounts(ordered), complete: ordered.length === context.names.length });
  if (Buffer.byteLength(canonicalPurposeJson(summary)) > MODEL_LOCATION_MATCH_LIMITS.responseBytes) return limited();
  return summary;
}
