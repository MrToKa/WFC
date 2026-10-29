import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { canonicalPurposeJson, policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { canonicalDecimalString } from '../../shared/pathfinderLengthLedger.js';
import { AUTOMATIC_PAIR_LIMITS, automaticPairHistorySchema, automaticPairMandateSchema, automaticPairMandateHashInput,
  automaticPairProvenanceSchema, automaticPairCapacityClearProvenanceSchema, type AutomaticPairHistory, type AutomaticPairWriteRequest } from '../../shared/pathfinderAutomaticPair.js';
import { initialFillProvenanceSchema } from '../../shared/pathfinderInitialFill.js';
import { hash } from './dependencies.js';
import { readInitialFillReceiptProof } from './initialFillReceiptProof.js';
import { verifyRevisionResultForProposal } from './revisionResultRepository.js';
import { requireBarrierWriteEvidence } from './barrierWrites.js';
import { requireCalculationLengthLedger } from './lengthLedger.js';
import { designLengthCompatibilityIssue, routeCompatibilityIssue, type DependencySnapshot, type EngineResponse } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { automaticPairCapacityClearTransition, validCapacityClearEvidence } from './capacityClearWrite.js';

type Row = Record<string, any>;
export const automaticPairHash = (value: unknown): string => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
export function automaticPairIdempotencyKey(input: Omit<AutomaticPairWriteRequest, 'idempotencyKey'>): string {
  const bytes = createHash('sha1').update('wfc.pf.automatic-pair-write.v1\0').update(canonicalPurposeJson(input)).digest().subarray(0, 16);
  bytes[6] = bytes[6] & 15 | 80; bytes[8] = bytes[8] & 63 | 128; const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const automaticPairDecimalEqual = (a: unknown, b: unknown): boolean => {
  try { return typeof a === 'string' && typeof b === 'string' && canonicalDecimalString(a) === canonicalDecimalString(b); } catch { return false; }
};
const same = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
/** PostgreSQL snapshots retain microseconds; Date.parse alone loses the last
 * three digits and cannot enforce the lineage's exact timestamp bounds. */
function snapshotTimestamp(value: unknown): bigint | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const milliseconds = Date.parse(parts[1] + 'Z');
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 19) !== parts[1]) return null;
  const zone = parts[3], hours = zone === 'Z' ? 0 : Number(zone.slice(1, 3)), minutes = zone === 'Z' ? 0 : Number(zone.slice(4));
  if (hours > 23 || minutes > 59) return null;
  const offset = BigInt((hours * 60 + minutes) * (zone[0] === '-' ? -1 : 1));
  return BigInt(milliseconds) * 1000n + BigInt((parts[2] ?? '').padEnd(6, '0')) - offset * 60_000_000n;
}
/** Default material initialization/synchronization touches its nonengineering
 * flag and timestamp, including true-to-true synchronization without a cable
 * revision. Keep all other values and receipt/hash/history lineage exact. */
function continuesAutomaticSnapshot(previous: Row, before: Row, authorizedAt: string): boolean {
  if (same(previous, before)) return true;
  if (typeof previous.materials_initialized !== 'boolean' || before.materials_initialized !== true
    || previous.materials_customized !== false || before.materials_customized !== false
    || typeof previous.updated_at !== 'string' || typeof before.updated_at !== 'string'
    || !same(Object.keys(previous).sort(), Object.keys(before).sort())) return false;
  const from = snapshotTimestamp(previous.updated_at), to = snapshotTimestamp(before.updated_at), limit = snapshotTimestamp(authorizedAt);
  return from !== null && to !== null && limit !== null && from <= to && to <= limit
    && Object.keys(previous).every(key => key === 'materials_initialized' || key === 'updated_at' || same(previous[key], before[key]));
}
export function automaticPairOwnTransition(projectId: string, cableId: string, before: Row, after: Row): boolean {
  try {
    const allowed = new Set(['routing', 'design_length', 'updated_at', 'cable_write_revision']);
    return before?.id === cableId && after?.id === cableId && before.project_id === projectId && after.project_id === projectId
      && policyRevisionSchema.safeParse(before.cable_write_revision).success && policyRevisionSchema.safeParse(after.cable_write_revision).success
      && BigInt(after.cable_write_revision) === BigInt(before.cable_write_revision) + 1n
      && typeof after.routing === 'string' && !routeCompatibilityIssue(after.routing) && typeof after.design_length === 'string'
      && !designLengthCompatibilityIssue(canonicalDecimalString(after.design_length)) && Object.hasOwn(before, 'install_length') && Object.hasOwn(after, 'install_length')
      && same(Object.keys(before).sort(), Object.keys(after).sort()) && Object.keys(before).every(key => allowed.has(key) || same(before[key], after[key]));
  } catch { return false; }
}
const historyFields = ['revision', 'mto', 'tag', 'cable_type_id', 'from_location', 'to_location', 'routing', 'delivery', 'pull_date', 'connected_from', 'connected_to', 'tested'] as const;
/** Audit values corroborate an exact transaction timestamp/revision; they never establish origin alone. */
export function automaticPairHistoryMatches(row: Row, after: Row, actorId: string): boolean {
  const scalar = (v: unknown) => v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : v;
  return row.change_source === 'pathfinder' && row.changed_by === actorId && String(row.cable_number) === String(after.cable_id)
    && historyFields.every(key => Object.hasOwn(after, key) && Object.hasOwn(row, key) && same(scalar(row[key]), scalar(after[key])))
    && ['design_length', 'install_length'].every(key => after[key] === null ? row[key] === null : automaticPairDecimalEqual(String(row[key]), after[key]));
}
export type AutomaticPairReceiptFact = { receiptId: string; receiptSha256: string; originReceiptId: string; before: Row; after: Row; history: AutomaticPairHistory; clearedForCapacity?: true };
export type AutomaticPairProofAdapters = { seal?: typeof verifyRevisionResultForProposal; initialProof?: typeof readInitialFillReceiptProof };
/** Bounded historical proof. No current authority is acquired or renewed. */
export function createAutomaticPairReceiptProofReader(client: PoolClient, check: () => void = () => undefined, adapters: AutomaticPairProofAdapters = {}) {
  let bytes = 0;
  const cache = new Map<string, Promise<AutomaticPairReceiptFact | null>>();
  const query = async (sql: string, args: unknown[]) => { check(); const result = await client.query<Row>(sql, args);
    bytes += Buffer.byteLength(JSON.stringify(result.rows)); if (bytes > AUTOMATIC_PAIR_LIMITS.proofBytes) throw new PathFinderError('AUTOMATIC_PAIR_PROOF_READ_LIMIT', 413); check(); return result.rows; };
  async function read(projectId: string, cableId: string, receiptId: string, seen: Set<string>): Promise<AutomaticPairReceiptFact | null> {
    if (seen.has(receiptId)) return null;
    if (seen.size >= AUTOMATIC_PAIR_LIMITS.lineage) throw new PathFinderError('AUTOMATIC_PAIR_PROOF_LINEAGE_LIMIT', 413);
    const next = new Set(seen); next.add(receiptId);
    const rows = await query(`/* automatic-pair:receipt-proof */ SELECT r.id,r.project_id,r.cable_id,r.actor_id,r.idempotency_key,r.payload_hash,r.proposal_id,
      CASE WHEN octet_length(r.before_snapshot::text)+octet_length(r.after_snapshot::text)+octet_length(r.provenance::text)<=$4 THEN r.before_snapshot ELSE NULL END AS before_snapshot,
      CASE WHEN octet_length(r.before_snapshot::text)+octet_length(r.after_snapshot::text)+octet_length(r.provenance::text)<=$4 THEN r.after_snapshot ELSE NULL END AS after_snapshot,
      CASE WHEN octet_length(r.before_snapshot::text)+octet_length(r.after_snapshot::text)+octet_length(r.provenance::text)<=$4 THEN r.provenance ELSE NULL END AS provenance,
      CASE WHEN octet_length(p.dependencies::text)+octet_length(p.result::text)<=$4 THEN p.dependencies ELSE NULL END AS dependencies,
      CASE WHEN octet_length(p.dependencies::text)+octet_length(p.result::text)<=$4 THEN p.result ELSE NULL END AS result,p.proposal_hash,p.dependency_hash,p.job_id,p.status,
      r.applied_at::text AS applied_at_exact FROM pf_apply_receipts r JOIN pf_proposals p ON p.project_id=r.project_id AND p.id=r.proposal_id AND p.cable_id=r.cable_id
      WHERE r.project_id=$1 AND r.cable_id=$2 AND r.id=$3`, [projectId, cableId, receiptId, AUTOMATIC_PAIR_LIMITS.receiptBytes]);
    if (rows.length !== 1) return null; const r = rows[0], before = r.before_snapshot, after = r.after_snapshot;
    const clear = automaticPairCapacityClearProvenanceSchema.safeParse(r.provenance);
    if (r.id !== receiptId || r.project_id !== projectId || r.cable_id !== cableId
      || (clear.success ? r.status !== 'no_path' || !automaticPairCapacityClearTransition(projectId, cableId, before, after)
        : r.status !== 'calculated' || !automaticPairOwnTransition(projectId, cableId, before, after)) || !r.dependencies || !r.result) return null;
    const dependencies = r.dependencies as DependencySnapshot, result = r.result as EngineResponse;
    if (hash(dependencies) !== r.dependency_hash || dependencies.projectId !== projectId || dependencies.cableId !== cableId
      || dependencies.cableWriteRevision !== before.cable_write_revision || (clear.success
        ? !validCapacityClearEvidence(dependencies as any, result, clear.data.capacityEvidence)
        : after.routing !== result.route?.routeText || !automaticPairDecimalEqual(after.design_length, result.design?.designLengthMeters))) return null;
    const seal = await (adapters.seal ?? verifyRevisionResultForProposal)(client, { projectId, proposalId: r.proposal_id,
      dependencies, result, proposalHash: r.proposal_hash }); check(); if (!seal) return null;
    let originReceiptId: string, history: AutomaticPairHistory;
    const initial = initialFillProvenanceSchema.safeParse(r.provenance);
    if (initial.success && !clear.success) {
      if (!await (adapters.initialProof ?? readInitialFillReceiptProof)(client, { projectId, cableId, receiptId, proposalId: r.proposal_id,
        actorId: r.actor_id, idempotencyKey: r.idempotency_key, payloadHash: r.payload_hash, before, after, provenance: r.provenance, dependencies, result, seal })) return null;
      const histories = await query(`/* automatic-pair:initial-history */ SELECT *,design_length::text,install_length::text,version_number::text AS version
        FROM cable_versions WHERE cable_id=$1 AND change_source='pathfinder' AND created_at=$2::timestamptz ORDER BY version_number DESC LIMIT 2`, [cableId, r.applied_at_exact]);
      if (histories.length !== 1 || !automaticPairHistoryMatches(histories[0], after, r.actor_id)) return null;
      history = automaticPairHistorySchema.parse({ id: histories[0].id, version: histories[0].version }); originReceiptId = receiptId;
    } else {
      const p = clear.success ? clear.data : automaticPairProvenanceSchema.parse(r.provenance), m = p.mandate;
      const { idempotencyKey, ...requestBody } = p.request;
      if (automaticPairHash(automaticPairMandateHashInput(m)) !== m.contentSha256 || p.request.proposalId !== r.proposal_id
        || idempotencyKey !== automaticPairIdempotencyKey(requestBody) || idempotencyKey !== r.idempotency_key || automaticPairHash(p.request) !== r.payload_hash || m.actorId !== r.actor_id
        || m.baselineSha256 !== automaticPairHash(before) || !same(p.dependencies, dependencies)
        || (p.schemaVersion === 'pathfinder.automatic-pair-capacity-clear.v1'
          ? !validCapacityClearEvidence(dependencies as any, result, p.capacityEvidence) || seal.ledgerHash !== null
          : !same(p.barrierEvidence, requireBarrierWriteEvidence(dependencies, result)) || !requireCalculationLengthLedger(result, dependencies.settings))
        || p.revisionResult.revisionResultSha256 !== seal.revisionResultSha256 || p.revisionResult.admissionId !== seal.admissionId
        || p.revisionResult.baselineHash !== seal.baselineHash || p.revisionResult.engineResultSha256 !== seal.engineResultSha256
        || p.revisionResult.ledgerHash !== seal.ledgerHash || p.revisionResult.dependencyHash !== seal.dependencyHash) return null;
      const stored = await query(`/* automatic-pair:historical-mandate */ SELECT record,record_sha256 FROM pf_automatic_pair_mandates
        WHERE project_id=$1 AND job_id=$2 AND cable_id=$3 AND id=$4`, [projectId, m.jobId, cableId, m.id]);
      if (stored.length !== 1 || !same(automaticPairMandateSchema.parse(stored[0].record), m) || stored[0].record_sha256 !== m.contentSha256) return null;
      if (m.ownership.kind === 'automatic') {
        const previous = await read(projectId, cableId, m.ownership.previousReceiptId, next);
        if (!previous || previous.receiptSha256 !== m.ownership.previousReceiptSha256 || previous.originReceiptId !== m.ownership.originReceiptId
          || previous.after.cable_write_revision !== before.cable_write_revision || !continuesAutomaticSnapshot(previous.after, before, p.authorizedAt)
          || !same(previous.history, m.ownership.history)) return null;
        originReceiptId = previous.originReceiptId;
      } else {
        if (before.design_length !== null || before.routing !== null && (typeof before.routing !== 'string' || before.routing.trim() !== '')) return null;
        originReceiptId = receiptId;
      }
      const histories = await query(`/* automatic-pair:recorded-history */ SELECT *,design_length::text,install_length::text,version_number::text AS version
        FROM cable_versions WHERE cable_id=$1 AND id=$2 AND version_number=$3`, [cableId, p.history.id, p.history.version]);
      if (histories.length !== 1 || !automaticPairHistoryMatches(histories[0], after, r.actor_id)) return null;
      history = p.history;
    }
    return { receiptId, receiptSha256: automaticPairHash({ id: r.id, projectId, cableId, actorId: r.actor_id,
      idempotencyKey: r.idempotency_key, payloadHash: r.payload_hash, proposalId: r.proposal_id, before, after, provenance: r.provenance }), originReceiptId, before, after, history,
      ...(clear.success ? { clearedForCapacity: true as const } : {}) };
  }
  return async (input: { projectId: string; cableId: string; receiptId: string }): Promise<AutomaticPairReceiptFact | null> => {
    for (const id of Object.values(input)) policyUuidSchema.parse(id); const key = canonicalPurposeJson(input);
    if (!cache.has(key)) cache.set(key, read(input.projectId, input.cableId, input.receiptId, new Set()).catch(error => {
      if (error instanceof PathFinderError && /READ_LIMIT|LINEAGE_LIMIT|DEADLINE|DATABASE_BUSY|ABORT/.test(error.code)) throw error; return null;
    })); return cache.get(key)!;
  };
}
export async function readAutomaticPairReceiptProof(client: PoolClient, input: { projectId: string; cableId: string; receiptId: string }) {
  return createAutomaticPairReceiptProofReader(client)(input);
}
