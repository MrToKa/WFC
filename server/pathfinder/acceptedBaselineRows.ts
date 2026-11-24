import type { Pool, PoolClient } from 'pg';
import { REVISION_RESULTS_LIMITS } from '../../shared/pathfinderRevisionResults.js';
import { principalTransaction } from './auth.js';
import { PathFinderError } from './errors.js';
import type { JobPrincipal } from './jobContracts.js';

type Row = Record<string, unknown>;
export type AcceptedRows = Map<string, Row | null>;
const latest = `WITH latest AS MATERIALIZED (
        SELECT head.id FROM unnest($2::uuid[]) AS wanted(cable_id)
        CROSS JOIN LATERAL (
          SELECT receipt.id FROM pf_apply_receipts receipt
          WHERE receipt.project_id=$1 AND receipt.cable_id=wanted.cable_id
            AND EXISTS (SELECT 1 FROM pf_proposals proposal WHERE proposal.id=receipt.proposal_id
              AND proposal.project_id=receipt.project_id AND proposal.cable_id=receipt.cable_id)
          ORDER BY receipt.applied_at DESC, receipt.id DESC LIMIT 1
        ) AS head
      )`;
const joins = `FROM latest JOIN pf_apply_receipts r ON r.id=latest.id AND r.project_id=$1
      JOIN pf_proposals p ON p.project_id=r.project_id AND p.id=r.proposal_id AND p.cable_id=r.cable_id
      LEFT JOIN pf_revision_results s ON s.project_id=p.project_id AND s.proposal_id=p.id
      LEFT JOIN pf_reviews v ON v.project_id=r.project_id AND v.id::text=r.provenance->>'reviewId'`;
const version = `jsonb_build_array(r.id,r.xmin::text,p.id,p.xmin::text,s.id,s.xmin::text,v.id,v.xmin::text)::text`;
const retainedWriteBody = `r.provenance->>'schemaVersion' IN('pathfinder.initial-fill.v1','pathfinder.initial-fill.v2','pathfinder.apply.v3','pathfinder.automatic-pair.v1','pathfinder.automatic-pair-capacity-clear.v1') AND
    octet_length(r.before_snapshot::text)+octet_length(r.after_snapshot::text)+octet_length(r.provenance::text)
      +octet_length(p.dependencies::text)+octet_length(p.result::text)<=262144`;
// OFFSET 0 keeps PostgreSQL from repeating the size guard for every retained JSON column.
export const acceptedRowsSql = `/* revision:latest-accepted */ ${latest}
      SELECT ${version} AS row_version,r.id AS receipt_id,r.cable_id,r.proposal_id,r.applied_at,
      r.after_snapshot->>'cable_write_revision' AS after_revision,r.after_snapshot->>'routing' AS after_routing,
      r.after_snapshot->>'design_length' AS after_design_length,p.proposal_hash,p.dependency_hash,p.dependencies->'model' AS model_ref,
      p.result#>>'{route,routeText}' AS route_text,p.result#>'{route,lengthMeters}' AS raw_length,
      p.result#>>'{design,designLengthMeters}' AS design_length,p.result#>>'{design,unroundedLengthMeters}' AS unrounded_length,
      s.record_sha256 AS sealed_hash,s.engine_result_sha256,s.ledger_sha256,
      coalesce(r.provenance->>'schemaVersion' LIKE 'pathfinder.initial-fill.%',false) AS initial_fill_kind,
      coalesce(r.provenance->>'schemaVersion' IN('pathfinder.automatic-pair.v1','pathfinder.automatic-pair-capacity-clear.v1'),false) AS automatic_pair_kind,
      coalesce(r.provenance->>'schemaVersion' LIKE 'pathfinder.apply.%' AND (r.provenance->>'schemaVersion' NOT IN('pathfinder.apply.v1','pathfinder.apply.v2')
        OR p.dependencies->>'schemaVersion'='pathfinder.dependencies.v8' OR r.provenance ? 'barrierEvidence'),false) AS protected_apply_kind,
      r.actor_id AS receipt_actor_id,r.idempotency_key AS receipt_idempotency_key,r.payload_hash AS receipt_payload_hash,
      CASE WHEN body.allowed THEN r.before_snapshot ELSE NULL END AS accepted_before,
      CASE WHEN body.allowed THEN r.after_snapshot ELSE NULL END AS accepted_after,
      CASE WHEN body.allowed THEN r.provenance ELSE NULL END AS accepted_provenance,
      CASE WHEN body.allowed THEN p.dependencies ELSE NULL END AS accepted_dependencies,
      CASE WHEN body.allowed THEN p.result ELSE NULL END AS accepted_result,
      v.id AS accepted_review_id,v.actor_id AS accepted_review_actor,v.proposal_id AS accepted_review_proposal,
      v.proposal_hash AS accepted_review_proposal_hash,v.validation_method AS accepted_validation_method,
      v.revision_result_sha256 AS accepted_review_result_sha256,v.review_dependency_sha256 AS accepted_review_dependency_sha256,
      v.review_login_id AS accepted_review_login_id
      ${joins}
      CROSS JOIN LATERAL (SELECT (${retainedWriteBody}) AS allowed OFFSET 0) body
      ORDER BY r.cable_id`;

export function isStatementTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === '57014' &&
    /statement timeout/i.test(error.message)
  );
}

export async function readAcceptedRows(
  client: PoolClient,
  project: string,
  ids: string[],
  cache?: AcceptedRows,
): Promise<Row[]> {
  const load = async (selected: string[]) =>
    (await client.query<Row>(acceptedRowsSql, [project, selected])).rows;
  if (!cache?.size) return load(ids);
  // Compare all joined row identities and MVCC versions in the admission
  // transaction. This also detects a new latest receipt, review or result.
  const versions = (
    await client.query<{ cable_id: string; row_version: string }>(
      `${latest} SELECT r.cable_id,${version} AS row_version ${joins}`,
      [project, ids],
    )
  ).rows;
  const current = new Map(versions.map((row) => [row.cable_id, row.row_version]));
  const reuse: Row[] = [],
    changed: string[] = [];
  for (const id of ids) {
    const stored = cache.get(id);
    if (stored === undefined || stored?.row_version !== current.get(id)) changed.push(id);
    else if (stored) reuse.push(stored);
  }
  return changed.length ? reuse.concat(await load(changed)) : reuse;
}

export async function prefetchAcceptedRows(
  pool: Pool,
  project: string,
  who: JobPrincipal,
  selected: string[] | undefined,
  chunk: number,
  deadline: number,
  report: (done: number, total: number) => Promise<void>,
): Promise<AcceptedRows> {
  const cache: AcceptedRows = new Map();
  const read = <T>(operation: (client: PoolClient) => Promise<T>) =>
    principalTransaction(
      pool,
      project,
      who,
      async (client) => {
        if (Date.now() >= deadline)
          throw new PathFinderError('RECALCULATION_COLLECTION_DEADLINE', 503);
        await client.query("SET LOCAL statement_timeout='15000ms'");
        return operation(client);
      },
      { snapshot: true, persistedLogin: true },
    );
  try {
    const ids = await read(async (client) =>
      (
        await client.query<{ id: string }>(
          `SELECT id FROM cables WHERE project_id=$1
      AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY id LIMIT $3`,
          [project, selected ?? null, REVISION_RESULTS_LIMITS.cables + 1],
        )
      ).rows.map((r) => r.id),
    );
    if (ids.length > REVISION_RESULTS_LIMITS.cables)
      throw new PathFinderError('REVISION_ADMISSION_CABLE_LIMIT', 413);
    await report(0, ids.length);
    // Each group releases its project and authority locks before the next.
    // Fall back to live reads when the worker's retained JSON budget is full.
    let bytes = 0;
    for (let at = 0; at < ids.length; at += chunk) {
      const group = ids.slice(at, at + chunk);
      const rows = await read((client) => readAcceptedRows(client, project, group));
      for (const id of group) cache.set(id, null);
      for (const row of rows) {
        bytes += Buffer.byteLength(JSON.stringify(row));
        if (bytes > 16 * 1024 ** 2) {
          for (const id of group) cache.delete(id);
          return cache;
        }
        cache.set(String(row.cable_id), row);
      }
      await report(at + group.length, ids.length);
    }
    return cache;
  } catch (error) {
    if (isStatementTimeout(error)) throw new PathFinderError('ACCEPTED_BASELINES_TIMEOUT', 503);
    throw error;
  }
}
