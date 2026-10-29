import type { PoolClient } from 'pg';
import { policyRevisionSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { type AutomaticPairOwnership } from '../../shared/pathfinderAutomaticPair.js';
import { classifyCableCategory } from '../../shared/pathfinderCableWorkflow.js';
import { automaticPairDecimalEqual, createAutomaticPairReceiptProofReader, type AutomaticPairReceiptFact } from './automaticPairReceiptProof.js';
import { PathFinderError } from './errors.js';

type Row = Record<string, any>;
export type AutomaticPairOwnershipDecision = AutomaticPairOwnership | { kind: 'review-required'; reasonCode: string };
export type AutomaticPairOwnershipAdapters = { proof?: (input: { projectId: string; cableId: string; receiptId: string }) => Promise<AutomaticPairReceiptFact | null> };
/** Caller owns the current cable lock. Revision and audit identity are required,
 * so equal restored values never infer automatic ownership. */
export async function readAutomaticPairOwnership(client: PoolClient, input: { projectId: string; cableId: string; currentSnapshot: Row },
  check: () => void = () => undefined, adapters: AutomaticPairOwnershipAdapters = {}): Promise<AutomaticPairOwnershipDecision> {
  policyUuidSchema.parse(input.projectId); policyUuidSchema.parse(input.cableId); check(); const c = input.currentSnapshot;
  const refuse = (reasonCode: string): AutomaticPairOwnershipDecision => ({ kind: 'review-required', reasonCode });
  if (!c || c.id !== input.cableId || c.project_id !== input.projectId || !policyRevisionSchema.safeParse(c.cable_write_revision).success
    || classifyCableCategory(c.mto).status !== 'eligible') return refuse('AUTOMATIC_PAIR_CABLE_INVALID');
  const receipts = (await client.query<Row>(`/* automatic-pair:latest-receipt */ SELECT id,provenance->>'schemaVersion' AS provenance_version FROM pf_apply_receipts
    WHERE project_id=$1 AND cable_id=$2 ORDER BY applied_at DESC,id DESC LIMIT 1`, [input.projectId, input.cableId])).rows; check();
  const blank = c.design_length === null && (c.routing === null || typeof c.routing === 'string' && c.routing.trim() === '');
  if (blank && receipts.length === 0) return { kind: 'empty' };
  if (blank && (c.routing !== null || receipts[0]?.provenance_version !== 'pathfinder.automatic-pair-capacity-clear.v1'))
    return refuse('AUTOMATIC_PAIR_MANUAL_CLEAR');
  if (receipts.length !== 1) return refuse('AUTOMATIC_PAIR_ORIGIN_UNPROVEN');
  let fact: AutomaticPairReceiptFact | null;
  try { fact = await (adapters.proof ?? createAutomaticPairReceiptProofReader(client, check))({ projectId: input.projectId, cableId: input.cableId, receiptId: receipts[0].id }); }
  catch (error) { if (error instanceof PathFinderError && /PROOF_(READ|LINEAGE)_LIMIT/.test(error.code)) return refuse(error.code); throw error; } check();
  if (!fact) return refuse('AUTOMATIC_PAIR_ORIGIN_UNPROVEN');
  if (blank && fact.clearedForCapacity !== true) return refuse('AUTOMATIC_PAIR_MANUAL_CLEAR');
  if (fact.after.cable_write_revision !== c.cable_write_revision || fact.after.routing !== c.routing
    || !(fact.clearedForCapacity === true && fact.after.design_length === null && c.design_length === null
      || automaticPairDecimalEqual(fact.after.design_length, c.design_length))) return refuse('AUTOMATIC_PAIR_MANUAL_CHANGE');
  const latest = (await client.query<Row>(`/* automatic-pair:latest-history */ SELECT id,version_number::text AS version,change_source
    FROM cable_versions WHERE cable_id=$1 ORDER BY version_number DESC LIMIT 1`, [input.cableId])).rows; check();
  if (latest.length !== 1 || latest[0].change_source !== 'pathfinder' || latest[0].id !== fact.history.id || latest[0].version !== fact.history.version)
    return refuse('AUTOMATIC_PAIR_HISTORY_CHANGED');
  return { kind: 'automatic', originReceiptId: fact.originReceiptId, previousReceiptId: fact.receiptId,
    previousReceiptSha256: fact.receiptSha256, afterCableWriteRevision: c.cable_write_revision, history: fact.history };
}
