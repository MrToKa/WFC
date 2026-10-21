import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { autoLengthBarrierStatusSchema, autoLengthViewSchema, emptyAutoLengthView, type AutoLengthView } from '../../shared/pathfinderAutoLength.js';
import { canonicalPurposeJson, policyHashSchema as digestSchema, policyRevisionSchema as revision, policyUuidSchema as uuid } from '../../shared/pathfinderPurposePolicy.js';
import { revisionResultEnvelopeSchema } from '../../shared/pathfinderRevisionResults.js';
import { canonicalDecimalString } from '../../shared/pathfinderLengthLedger.js';
import { requireBarrierWriteEvidence } from './barrierWrites.js';
import { PathFinderError } from './errors.js';

type Queryable = Pick<PoolClient, 'query'>;
type Row = Record<string, unknown>;
export const AUTO_LENGTH_LIMITS = Object.freeze({ admissionCables: 10_000, readCables: 10_000, readChunk: 500,
  sourceBytes: 16_384, persistedPayloadBytes: 32 * 1024 ** 2 });
const digest = (value: unknown): string => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const same = (left: unknown, right: unknown): boolean => canonicalPurposeJson(left) === canonicalPurposeJson(right);
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'The exact calculated Auto length could not be verified. Its previous successful value is retained.'); };
const timestamp = z.string().datetime({ offset: false }).refine(value => value.endsWith('Z'));
// Preserve the exact C# decimal text privately. Only mathematically whole values
// within the product limit may cross the public boundary as an exact Number.
const lengthText = z.string().max(100).regex(/^(?:0|[1-9][0-9]{0,6})(?:[.]0+)?$(?![\s\S])/)
  .refine(value => BigInt(value.split('.')[0]) <= 1_000_000n);
const positiveOrdinal = revision.refine(value => BigInt(value) > 0n);
export const autoLengthSourceSchema = z.object({
  schemaVersion: z.literal('wfc.pf.auto-length-source.v1'), projectId: uuid, cableId: uuid,
  admissionId: uuid, admissionOrdinal: positiveOrdinal, jobId: uuid, proposalId: uuid,
  proposalHash: digestSchema, dependencyHash: digestSchema, engineResultHash: digestSchema,
  revisionResultHash: digestSchema, ledgerHash: digestSchema, barrierEvidenceHash: digestSchema,
  lengthMetersText: lengthText, calculatedAt: timestamp, barrierStatus: autoLengthBarrierStatusSchema,
}).strict();
export type AutoLengthSource = z.infer<typeof autoLengthSourceSchema>;
const registerInput = z.object({ projectId: uuid, admissionId: uuid, jobId: uuid.nullable(),
  cableIds: z.array(uuid).min(1).max(AUTO_LENGTH_LIMITS.admissionCables)
    .refine(values => new Set(values).size === values.length) }).strict();
export type RegisterAutoLengthAdmissionInput = z.infer<typeof registerInput>;
export type AutoLengthAdmissionRegistration = { admissionOrdinal: string; duplicate: boolean };

/** Caller owns the NEW admission's existing project/authority transaction. An
 * exact replay returns its old order and never revives an older target. The xmin
 * check refuses attaching an order to historical pre-B7a admissions. */
export async function registerAutoLengthAdmission(client: Queryable, raw: RegisterAutoLengthAdmissionInput): Promise<AutoLengthAdmissionRegistration> {
  const input = registerInput.parse(raw), cableIds = [...input.cableIds].sort(), targetHash = digest(cableIds);
  const admission = (await client.query<Row>(`/* auto-length:registration */ SELECT a.id,a.job_id,a.total,
    a.xmin::text AS created_xid,(txid_current()%4294967296)::text AS transaction_xid,
    o.ordinal::text,o.target_count,o.targets_sha256
    FROM pf_revision_admissions a LEFT JOIN pf_auto_length_admissions o ON o.project_id=a.project_id AND o.admission_id=a.id
    WHERE a.project_id=$1 AND a.id=$2`, [input.projectId, input.admissionId])).rows[0];
  if (!admission || admission.id !== input.admissionId || admission.job_id !== input.jobId || admission.total !== cableIds.length)
    return fail('AUTO_LENGTH_ADMISSION_SCOPE');
  const members = (await client.query<{ cable_id: string }>(`/* auto-length:members */ SELECT cable_id FROM pf_revision_baselines
    WHERE project_id=$1 AND admission_id=$2 ORDER BY cable_id LIMIT 10001`, [input.projectId, input.admissionId])).rows;
  if (members.length !== cableIds.length || members.some((member, at) => member.cable_id !== cableIds[at])) return fail('AUTO_LENGTH_ADMISSION_MEMBERS');
  if (admission.ordinal !== null && admission.ordinal !== undefined) {
    if (admission.target_count !== cableIds.length || admission.targets_sha256 !== targetHash) return fail('AUTO_LENGTH_ADMISSION_CONFLICT');
    return { admissionOrdinal: positiveOrdinal.parse(admission.ordinal), duplicate: true };
  }
  if (admission.created_xid !== admission.transaction_xid) return fail('AUTO_LENGTH_NEW_ADMISSION_REQUIRED');
  const inserted = (await client.query<{ ordinal: string }>(`/* auto-length:order */ INSERT INTO pf_auto_length_admissions
    (project_id,admission_id,job_id,target_count,targets_sha256) VALUES($1,$2,$3,$4,$5) RETURNING ordinal::text`,
    [input.projectId, input.admissionId, input.jobId, cableIds.length, targetHash])).rows[0];
  const ordinal = positiveOrdinal.parse(inserted?.ordinal);
  await client.query(`/* auto-length:targets */ INSERT INTO pf_auto_length_targets(project_id,cable_id,admission_ordinal)
    SELECT $1,x,$3::bigint FROM unnest($2::uuid[]) x
    ON CONFLICT(project_id,cable_id) DO UPDATE SET admission_ordinal=EXCLUDED.admission_ordinal
    WHERE pf_auto_length_targets.admission_ordinal<EXCLUDED.admission_ordinal`, [input.projectId, cableIds, ordinal]);
  return { admissionOrdinal: ordinal, duplicate: false };
}

export type PublishAutoLengthInput = { projectId: string; jobId: string; cableId: string; proposalId: string;
  dependencies: unknown; result: unknown; seal: unknown };
export type AutoLengthPublication = { status: 'published' | 'duplicate' | 'superseded'; admissionOrdinal: string }
  | { status: 'historical-unregistered'; admissionOrdinal: null };

/** Pure exact-source recognition, also used after loading a stored replay. It
 * conveys no human review, Apply, initial-fill or engineering authority. */
function exactAutoLengthResult(input: PublishAutoLengthInput): Omit<AutoLengthSource, 'admissionOrdinal'> {
  const projectId = uuid.parse(input.projectId), jobId = uuid.parse(input.jobId), cableId = uuid.parse(input.cableId), proposalId = uuid.parse(input.proposalId),
    seal = revisionResultEnvelopeSchema.parse(input.seal);
  const { revisionResultSha256, ...body } = seal;
  const evidence = requireBarrierWriteEvidence(input.dependencies, input.result);
  const output = input.result as { design?: { designLengthMeters?: unknown }; lengthLedger?: unknown };
  const exactLength = lengthText.parse(output.design?.designLengthMeters);
  if (digest(body) !== revisionResultSha256 || seal.projectId !== projectId || seal.jobId !== jobId || seal.cableId !== cableId || seal.proposalId !== proposalId
    || evidence.projectId !== projectId || evidence.cableId !== cableId || seal.dependencyHash !== evidence.dependencySha256
    || seal.engineResultSha256 !== evidence.engineResultSha256 || seal.summary.calculationMode !== 'calculate'
    || seal.summary.designLengthMeters !== exactLength || !seal.lengthLedger || !seal.ledgerHash
    || digest(seal.lengthLedger) !== seal.ledgerHash || digest(output.lengthLedger) !== seal.ledgerHash
    || seal.lengthLedger.designLengthMeters !== canonicalDecimalString(exactLength)
    || seal.proposalHash !== digest({ dependencies: input.dependencies, result: input.result, baselineHash: seal.baselineHash }))
    return fail('AUTO_LENGTH_RESULT_PROOF');
  return autoLengthSourceSchema.omit({ admissionOrdinal: true }).parse({ schemaVersion: 'wfc.pf.auto-length-source.v1', projectId, cableId,
    admissionId: seal.admissionId, jobId, proposalId, proposalHash: seal.proposalHash,
    dependencyHash: seal.dependencyHash, engineResultHash: seal.engineResultSha256, revisionResultHash: seal.revisionResultSha256,
    ledgerHash: seal.ledgerHash, barrierEvidenceHash: digest(evidence), lengthMetersText: exactLength,
    calculatedAt: seal.createdAt, barrierStatus: evidence.status });
}
export function buildAutoLengthSource(input: PublishAutoLengthInput & { admissionOrdinal: string }): AutoLengthSource {
  const source = autoLengthSourceSchema.parse({ ...exactAutoLengthResult(input), admissionOrdinal: positiveOrdinal.parse(input.admissionOrdinal) });
  if (Buffer.byteLength(canonicalPurposeJson(source)) > AUTO_LENGTH_LIMITS.sourceBytes) return fail('AUTO_LENGTH_SOURCE_BYTES', 413);
  return source;
}

/** Call only after final dependency/currentness checks, exact sealing and a
 * successful complete/calculated item transition, inside the same transaction;
 * retain all existing authority/cancel/expiry fences through its final COMMIT.
 * This function never updates cables, their business revision or history. */
export async function publishAutoLength(client: Queryable, input: PublishAutoLengthInput): Promise<AutoLengthPublication> {
  const projectId = uuid.parse(input.projectId), jobId = uuid.parse(input.jobId), cableId = uuid.parse(input.cableId), proposalId = uuid.parse(input.proposalId);
  const row = (await client.query<Row>(`/* auto-length:publish-source */ SELECT p.project_id,p.job_id,p.cable_id,p.id,p.status,p.proposal_hash,p.dependency_hash,
    CASE WHEN octet_length(p.dependencies::text)<=$5 THEN p.dependencies END AS dependencies,
    CASE WHEN octet_length(p.result::text)<=$5 THEN p.result END AS result,s.record AS seal,
    o.ordinal::text,o.admission_id,s.admission_id AS sealed_admission_id,t.admission_ordinal::text AS target_ordinal,j.state AS job_state,j.cancel_requested,
    i.state AS item_state,i.status AS item_status
    FROM pf_proposals p JOIN pf_revision_results s ON s.project_id=p.project_id AND s.proposal_id=p.id
    LEFT JOIN pf_auto_length_admissions o ON o.project_id=s.project_id AND o.admission_id=s.admission_id AND o.job_id=s.job_id
    LEFT JOIN pf_auto_length_targets t ON t.project_id=p.project_id AND t.cable_id=p.cable_id
    JOIN pf_jobs j ON j.project_id=p.project_id AND j.id=p.job_id
    JOIN pf_job_items i ON i.project_id=p.project_id AND i.job_id=p.job_id AND i.cable_id=p.cable_id
    WHERE p.project_id=$1 AND p.job_id=$2 AND p.cable_id=$3 AND p.id=$4`,
    [projectId, jobId, cableId, proposalId, AUTO_LENGTH_LIMITS.persistedPayloadBytes])).rows[0];
  if (!row || row.project_id !== projectId || row.job_id !== jobId || row.cable_id !== cableId || row.id !== proposalId) return fail('AUTO_LENGTH_STORED_SOURCE_REQUIRED');
  if (row.status !== 'calculated' || row.item_state !== 'complete' || row.item_status !== 'calculated'
    || !['queued', 'running', 'complete'].includes(String(row.job_state)) || row.cancel_requested !== false) return fail('AUTO_LENGTH_ITEM_NOT_CURRENT');
  // An existing proposal after an unknown COMMIT is the only authoritative
  // response. Never attach freshly computed output to its original seal.
  if (!row.dependencies || !row.result || !row.seal || !same(row.dependencies, input.dependencies) || !same(row.result, input.result) || !same(row.seal, input.seal))
    return fail('AUTO_LENGTH_STORED_SOURCE_CHANGED');
  const exact = exactAutoLengthResult({ projectId, jobId, cableId, proposalId, dependencies: row.dependencies, result: row.result, seal: row.seal });
  if (exact.admissionId !== row.sealed_admission_id || exact.proposalHash !== row.proposal_hash || exact.dependencyHash !== row.dependency_hash) return fail('AUTO_LENGTH_STORED_SOURCE_CHANGED');
  if (row.ordinal === null || row.ordinal === undefined) {
    if (row.admission_id !== null && row.admission_id !== undefined) return fail('AUTO_LENGTH_ADMISSION_SCOPE');
    // A legitimate v8 job admitted before this additive feature remains a real
    // completed calculation. It gains neither a new order nor an Auto backfill.
    return { status: 'historical-unregistered', admissionOrdinal: null };
  }
  const ordinal = positiveOrdinal.parse(row.ordinal);
  if (exact.admissionId !== row.admission_id || row.target_ordinal === null || row.target_ordinal === undefined) return fail('AUTO_LENGTH_ADMISSION_SCOPE');
  // Lock a present target explicitly: PostgreSQL cannot lock the nullable side
  // of the historical-compatible LEFT JOIN above. Existing project mutex and
  // the target row are retained until the caller's final authority/COMMIT fence.
  const lockedTarget = (await client.query<{ admission_ordinal: string }>(`/* auto-length:target-lock */ SELECT admission_ordinal::text
    FROM pf_auto_length_targets WHERE project_id=$1 AND cable_id=$2 FOR UPDATE`, [projectId, cableId])).rows[0];
  const target = positiveOrdinal.parse(lockedTarget?.admission_ordinal);
  if (BigInt(ordinal) < BigInt(target)) return { status: 'superseded', admissionOrdinal: ordinal };
  if (ordinal !== target) return fail('AUTO_LENGTH_ADMISSION_SCOPE');
  const source = autoLengthSourceSchema.parse({ ...exact, admissionOrdinal: ordinal });
  const old = (await client.query<Row>(`/* auto-length:existing */ SELECT admission_ordinal::text,proposal_id,length_text,source,source_sha256
    FROM pf_auto_lengths WHERE project_id=$1 AND cable_id=$2 FOR UPDATE`, [projectId, cableId])).rows[0];
  if (old) {
    const prior = autoLengthSourceSchema.parse(old.source);
    if (old.source_sha256 !== digest(prior) || old.length_text !== prior.lengthMetersText || old.admission_ordinal !== prior.admissionOrdinal
      || old.proposal_id !== prior.proposalId || prior.projectId !== projectId || prior.cableId !== cableId) return fail('AUTO_LENGTH_SOURCE_INTEGRITY', 500);
    if (BigInt(prior.admissionOrdinal) > BigInt(ordinal)) return { status: 'superseded', admissionOrdinal: ordinal };
    if (prior.admissionOrdinal === ordinal) {
      if (!same(prior, source)) return fail('AUTO_LENGTH_SOURCE_CONFLICT');
      return { status: 'duplicate', admissionOrdinal: ordinal };
    }
  }
  const written = await client.query(`/* auto-length:publish */ INSERT INTO pf_auto_lengths
    (project_id,cable_id,admission_ordinal,proposal_id,length_text,source,source_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(project_id,cable_id) DO UPDATE SET admission_ordinal=EXCLUDED.admission_ordinal,proposal_id=EXCLUDED.proposal_id,
      length_text=EXCLUDED.length_text,source=EXCLUDED.source,source_sha256=EXCLUDED.source_sha256
    WHERE pf_auto_lengths.admission_ordinal<EXCLUDED.admission_ordinal RETURNING cable_id`,
    [projectId, cableId, ordinal, proposalId, source.lengthMetersText, source, digest(source)]);
  if (written.rows.length !== 1) return fail('AUTO_LENGTH_PUBLICATION_CONFLICT');
  return { status: 'published', admissionOrdinal: ordinal };
}

/** Small private source validation against immutable seal columns and summary.
 * It does not read meshes, mutable auth or executable identities. */
function retainedSource(row: Row, projectId: string, cableId: string): AutoLengthSource | null {
  if (row.source === null || row.source === undefined) return null;
  if (Buffer.byteLength(canonicalPurposeJson(row.source)) > AUTO_LENGTH_LIMITS.sourceBytes) return fail('AUTO_LENGTH_SOURCE_BYTES', 500);
  const source = autoLengthSourceSchema.parse(row.source);
  if (row.source_sha256 !== digest(source) || source.projectId !== projectId || source.cableId !== cableId
    || source.admissionOrdinal !== row.source_ordinal || source.proposalId !== row.source_proposal_id || source.lengthMetersText !== row.length_text
    || source.admissionId !== row.source_admission_id || source.jobId !== row.source_job_id
    || source.admissionId !== row.source_order_admission_id || source.jobId !== row.source_order_job_id
    || source.proposalHash !== row.source_proposal_hash || source.dependencyHash !== row.source_dependency_hash || row.source_proposal_status !== 'calculated'
    || source.revisionResultHash !== row.seal_hash || source.engineResultHash !== row.seal_engine_result_hash
    || source.dependencyHash !== row.seal_dependency_hash || source.ledgerHash !== row.seal_ledger_hash
    || source.lengthMetersText !== row.seal_design_text || source.calculatedAt !== row.seal_calculated_at
    || source.barrierStatus !== row.seal_barrier_status) return fail('AUTO_LENGTH_SOURCE_INTEGRITY', 500);
  return source;
}
const pendingStates = new Set(['queued', 'running', 'waiting', 'calculating']);
/** Status describes the latest recorded request, not current Review/Apply
 * authority. An earlier success remains visible during newer failures/pending
 * work. No Design, routing, installLength or cable revision enters this view. */
export function projectAutoLengthView(row: Row, projectId: string, cableId: string): AutoLengthView {
  try {
    const source = retainedSource(row, projectId, cableId), latest = row.latest_ordinal === null || row.latest_ordinal === undefined ? null : positiveOrdinal.parse(row.latest_ordinal);
    if (!latest) return source ? { ...emptyAutoLengthView(), autoLengthStatus: 'unavailable' } : emptyAutoLengthView();
    if (source && BigInt(source.admissionOrdinal) > BigInt(latest)) return { ...emptyAutoLengthView(), autoLengthStatus: 'unavailable' };
    const matches = Boolean(source && source.admissionOrdinal === latest), base: AutoLengthView = { autoCalculatedLength: source ? Number(source.lengthMetersText) : null,
      autoLengthCalculatedAt: source?.calculatedAt ?? null, autoLengthBarrierStatus: source?.barrierStatus ?? null,
      autoLengthMatchesLatestRequest: matches, autoLengthStatus: 'unavailable' };
    const job = row.latest_job_state, item = row.latest_item_state, status = row.latest_item_status ?? row.latest_baseline_status;
    if (row.latest_cancel_requested === true || job === 'cancelled') base.autoLengthStatus = matches ? 'last-successful' : 'cancelled';
    else if (job === 'failed') base.autoLengthStatus = matches ? 'last-successful' : 'failed';
    else if (status === 'stale' || status === 'superseded') base.autoLengthStatus = 'stale';
    // Matching the newest recorded request is not a fresh physical read. The
    // ordinary API deliberately does no geometry/current-identity collection;
    // retain the checked number and label it as the last successful result.
    else if (matches && item === 'complete' && status === 'calculated' && ['queued', 'running', 'complete'].includes(String(job))) base.autoLengthStatus = 'last-successful';
    else if (item === 'blocked' || row.latest_job_id === null || item === 'complete' && status !== 'calculated'
      || job === 'complete' && status !== 'calculated') base.autoLengthStatus = 'blocked';
    else if (item === 'complete' && status === 'calculated') base.autoLengthStatus = 'unavailable';
    else if (pendingStates.has(String(item)) || pendingStates.has(String(job))) base.autoLengthStatus = 'pending';
    return autoLengthViewSchema.parse(base);
  } catch { return { ...emptyAutoLengthView(), autoLengthStatus: 'unavailable' }; }
}

const readSql = `/* auto-length:read */ SELECT r.cable_id,
 t.admission_ordinal::text AS latest_ordinal,a.job_id AS latest_job_id,j.state AS latest_job_state,j.cancel_requested AS latest_cancel_requested,
 i.state AS latest_item_state,i.status AS latest_item_status,b.status AS latest_baseline_status,
 v.admission_ordinal::text AS source_ordinal,v.proposal_id AS source_proposal_id,v.length_text,v.source,v.source_sha256,
 s.admission_id AS source_admission_id,s.job_id AS source_job_id,sa.admission_id AS source_order_admission_id,sa.job_id AS source_order_job_id,
 p.proposal_hash AS source_proposal_hash,p.dependency_hash AS source_dependency_hash,p.status AS source_proposal_status,
 s.record_sha256 AS seal_hash,s.engine_result_sha256 AS seal_engine_result_hash,s.dependency_sha256 AS seal_dependency_hash,s.ledger_sha256 AS seal_ledger_hash,
 s.record#>>'{summary,designLengthMeters}' AS seal_design_text,s.record->>'createdAt' AS seal_calculated_at,
 p.result#>>'{barriers,diagnostics,status}' AS seal_barrier_status
 FROM unnest($2::uuid[]) r(cable_id)
 LEFT JOIN pf_auto_length_targets t ON t.project_id=$1 AND t.cable_id=r.cable_id
 LEFT JOIN pf_auto_length_admissions a ON a.project_id=t.project_id AND a.ordinal=t.admission_ordinal
 LEFT JOIN pf_revision_baselines b ON b.project_id=a.project_id AND b.admission_id=a.admission_id AND b.cable_id=r.cable_id
 LEFT JOIN pf_jobs j ON j.project_id=a.project_id AND j.id=a.job_id
 LEFT JOIN pf_job_items i ON i.project_id=a.project_id AND i.job_id=a.job_id AND i.cable_id=r.cable_id
 LEFT JOIN pf_auto_lengths v ON v.project_id=$1 AND v.cable_id=r.cable_id
 LEFT JOIN pf_auto_length_admissions sa ON sa.project_id=v.project_id AND sa.ordinal=v.admission_ordinal
 LEFT JOIN pf_revision_results s ON s.project_id=v.project_id AND s.proposal_id=v.proposal_id AND s.cable_id=v.cable_id
 LEFT JOIN pf_proposals p ON p.project_id=s.project_id AND p.id=s.proposal_id
 ORDER BY r.cable_id`;
/** Normal authorized cable APIs can use Pool or PoolClient after their existing
 * project read guard. No PF admin transaction, geometry collection, automatic
 * calculation or authority renewal occurs here. Missing Auto rows stay null. */
export async function readAutoLengths(client: Queryable, projectId: string, cableIds: string[]): Promise<Map<string, AutoLengthView>> {
  uuid.parse(projectId);
  const ids = z.array(uuid).max(AUTO_LENGTH_LIMITS.readCables).parse(cableIds);
  if (new Set(ids).size !== ids.length) return fail('AUTO_LENGTH_READ_DUPLICATE_CABLE', 400);
  const output = new Map(ids.map(id => [id, emptyAutoLengthView()]));
  for (let at = 0; at < ids.length; at += AUTO_LENGTH_LIMITS.readChunk) {
    const chunk = ids.slice(at, at + AUTO_LENGTH_LIMITS.readChunk), allowed = new Set(chunk), seen = new Set<string>();
    const rows = (await client.query<Row>(readSql, [projectId, chunk])).rows;
    if (rows.length !== chunk.length) return fail('AUTO_LENGTH_READ_SCOPE', 500);
    for (const row of rows) {
      if (typeof row.cable_id !== 'string' || !allowed.has(row.cable_id) || seen.has(row.cable_id)) return fail('AUTO_LENGTH_READ_SCOPE', 500);
      seen.add(row.cable_id); output.set(row.cable_id, projectAutoLengthView(row, projectId, row.cable_id));
    }
  }
  return output;
}
