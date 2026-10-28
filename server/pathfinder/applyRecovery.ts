import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { principalTransaction } from './auth.js';
import { uuid } from './contracts.js';
import { hash } from './dependencies.js';
import { PathFinderError } from './errors.js';
import { applySchema, type JobPrincipal } from './jobContracts.js';
import { requireHumanPrincipal } from './operationAuthority.js';

type ApplyInput = z.infer<typeof applySchema>;
type ReceiptRow = {
  id: string; project_id: string; proposal_id: string; cable_id: string; payload_hash: string;
  before_snapshot: unknown; after_snapshot: unknown; provenance: unknown; applied_at: Date | string;
};
function receiptDto(row: ReceiptRow) {
  return { id: row.id, projectId: row.project_id, proposalId: row.proposal_id, cableId: row.cable_id,
    before: row.before_snapshot, after: row.after_snapshot, provenance: row.provenance, appliedAt: row.applied_at };
}
export type ApplyRecoveryResult = {
  schemaVersion: 'wfc.pf.apply-recovery.v1'; projectId: string; proposalId: string; idempotencyKey: string;
  reviewId: string; expectedCableWriteRevision: string; status: 'already-applied' | 'closed-without-apply';
  duplicate: boolean; receipt: ReturnType<typeof receiptDto> | null;
};

/** Call after receipt reconciliation under the same project lock used by Apply. */
export async function readApplyAbandonment(client: PoolClient, input: {
  projectId: string; actorId: string; idempotencyKey: string; payloadHash: string;
}): Promise<boolean> {
  const row = (await client.query<{ payload_hash: string }>(`SELECT payload_hash FROM pf_apply_abandonments
    WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 FOR SHARE`,
  [input.projectId, input.actorId, input.idempotencyKey])).rows[0];
  if (!row) return false;
  if (row.payload_hash !== input.payloadHash)
    throw new PathFinderError('IDEMPOTENCY_CONFLICT', 409, 'This idempotency key was used for a different Apply request.');
  return true;
}

/** Explicitly closes an uncommitted intent; currentness is unnecessary because closure writes no cable values. */
export function createPathFinderApplyRecovery(pool: Pool) {
  return async (projectId: string, who: JobPrincipal, proposalId: string, raw: ApplyInput): Promise<ApplyRecoveryResult> => {
    requireHumanPrincipal(who);
    const input = applySchema.parse(raw), project = uuid.parse(projectId), proposal = uuid.parse(proposalId);
    return principalTransaction(pool, project, who, async client => {
      const payloadHash = hash({ proposalId: proposal, ...input });
      const response = (status: ApplyRecoveryResult['status'], duplicate: boolean, receipt: ApplyRecoveryResult['receipt'] = null): ApplyRecoveryResult => ({
        schemaVersion: 'wfc.pf.apply-recovery.v1', projectId: project, proposalId: proposal, ...input, status, duplicate, receipt,
      });
      // An acknowledged or previously unacknowledged committed Apply always wins over abandonment.
      const previous = (await client.query<ReceiptRow>('SELECT * FROM pf_apply_receipts WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 FOR SHARE',
        [project, who.userId, input.idempotencyKey])).rows[0];
      if (previous) {
        if (previous.payload_hash !== payloadHash)
          throw new PathFinderError('IDEMPOTENCY_CONFLICT', 409, 'This idempotency key was used for a different Apply request.');
        return response('already-applied', true, receiptDto(previous));
      }
      if (await readApplyAbandonment(client, { projectId: project, actorId: who.userId, idempotencyKey: input.idempotencyKey, payloadHash }))
        return response('closed-without-apply', true);
      const existing = (await client.query<{ proposal_hash: string }>('SELECT proposal_hash FROM pf_proposals WHERE project_id=$1 AND id=$2 FOR SHARE',
        [project, proposal])).rows[0];
      if (!existing) throw new PathFinderError('PROPOSAL_NOT_FOUND', 404);
      const review = (await client.query<{ actor_id: string; proposal_id: string; proposal_hash: string }>(
        'SELECT actor_id,proposal_id,proposal_hash FROM pf_reviews WHERE project_id=$1 AND id=$2 FOR SHARE', [project, input.reviewId])).rows[0];
      // The review may belong to a previous login, but never to a different actor or proposal.
      if (!review || review.actor_id !== who.userId || review.proposal_id !== proposal || review.proposal_hash !== existing.proposal_hash)
        throw new PathFinderError('REVIEW_REQUIRED', 409, 'Only the administrator who reviewed this exact proposal may close its pending Apply request.');
      await client.query(`INSERT INTO pf_apply_abandonments(project_id,actor_id,idempotency_key,proposal_id,review_id,expected_cable_write_revision,payload_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [project, who.userId, input.idempotencyKey, proposal, input.reviewId, input.expectedCableWriteRevision, payloadHash]);
      return response('closed-without-apply', false);
    });
  };
}
