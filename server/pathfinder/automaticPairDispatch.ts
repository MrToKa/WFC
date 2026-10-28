import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { automaticPairStatuses, type AutomaticPairOutcome } from '../../shared/pathfinderAutomaticPair.js';
import { schedulerTransaction } from './schedulerTransaction.js';
import { PathFinderError } from './errors.js';
import type { AutomaticPairClaim, AutomaticPairRecoveryKey } from './automaticPairWriter.js';

type Row = Record<string, any>;
const fail = (): never => { throw new PathFinderError('AUTOMATIC_PAIR_CLAIM_FENCED', 409); };
/** Durable bookkeeping only; every business update is separately authorized. */
export function createAutomaticPairDispatch(pool: Pool) {
  return {
    /** At most one exhausted command per tick. This changes bookkeeping only;
     * the callback is forbidden to submit another business write attempt. */
    async reconcileNext(inspect: (client: PoolClient, key: AutomaticPairRecoveryKey, signal?: AbortSignal) => Promise<AutomaticPairOutcome>, signal?: AbortSignal): Promise<AutomaticPairOutcome | null> {
      return schedulerTransaction(pool, async client => {
        const row = (await client.query<Row>(`/* automatic-pair:recovery-candidate */ SELECT project_id,job_id,cable_id FROM pf_automatic_pair_dispatch
          WHERE status='unknown' AND attempts=3 AND owner_token IS NULL AND lease_until IS NULL
          AND (not_before<=clock_timestamp() OR not_before IS NULL AND updated_at<=clock_timestamp()-interval '60 seconds')
          ORDER BY COALESCE(not_before,updated_at),project_id,job_id,cable_id LIMIT 1`)).rows[0];
        if (!row) return null;
        const key = { projectId: row.project_id, jobId: row.job_id, cableId: row.cable_id };
        const project = await client.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [key.projectId]);
        if (project.rows.length !== 1) return null;
        const current = (await client.query<Row>(`/* automatic-pair:recovery-lock */ SELECT status,attempts,owner_token,lease_until FROM pf_automatic_pair_dispatch
          WHERE project_id=$1 AND job_id=$2 AND cable_id=$3 AND status='unknown' AND attempts=3 AND owner_token IS NULL AND lease_until IS NULL
          AND (not_before<=clock_timestamp() OR not_before IS NULL AND updated_at<=clock_timestamp()-interval '60 seconds') FOR UPDATE`,
        [key.projectId, key.jobId, key.cableId])).rows[0];
        if (!current || current.status !== 'unknown' || current.attempts !== 3 || current.owner_token !== null || current.lease_until !== null) return null;
        await client.query('SAVEPOINT automatic_pair_reconciliation');
        let outcome: AutomaticPairOutcome;
        try {
          outcome = await inspect(client, key, signal);
          if (!['already-written', 'refused'].includes(outcome.status) || (outcome.status === 'already-written') !== Boolean(outcome.receiptId))
            throw new PathFinderError('AUTOMATIC_PAIR_RECOVERY_INTEGRITY', 409);
          await client.query('RELEASE SAVEPOINT automatic_pair_reconciliation');
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT automatic_pair_reconciliation');
          await client.query('RELEASE SAVEPOINT automatic_pair_reconciliation');
          outcome = { status: 'unknown', receiptId: null, code: error instanceof PathFinderError && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code)
            ? error.code : 'AUTOMATIC_PAIR_RECOVERY_UNAVAILABLE' };
        }
        signal?.throwIfAborted();
        await client.query(`/* automatic-pair:recovery-finish */ UPDATE pf_automatic_pair_dispatch SET status=$4,receipt_id=$5,reason_code=$6,
          not_before=CASE WHEN $4='unknown' THEN clock_timestamp()+interval '60 seconds' ELSE NULL END,updated_at=clock_timestamp()
          WHERE project_id=$1 AND job_id=$2 AND cable_id=$3 AND status='unknown' AND attempts=3 AND owner_token IS NULL AND lease_until IS NULL`,
        [key.projectId, key.jobId, key.cableId, outcome.status, outcome.receiptId, outcome.code ?? null]);
        return outcome;
      }, signal);
    },
    async discover(signal?: AbortSignal) { return schedulerTransaction(pool, async client => {
      const result = await client.query(`/* automatic-pair:terminal-dispatch */ UPDATE pf_automatic_pair_dispatch d SET status='refused',
        reason_code='AUTOMATIC_PAIR_NO_CURRENT_RESULT',not_before=NULL,updated_at=clock_timestamp()
        FROM pf_jobs j,pf_job_items i WHERE d.project_id=j.project_id AND d.job_id=j.id AND i.project_id=d.project_id AND i.job_id=d.job_id AND i.cable_id=d.cable_id
        AND d.status='pending' AND d.attempts=0 AND (j.cancel_requested OR j.state IN('failed','cancelled') OR i.state='blocked'
          OR i.state='complete' AND i.status<>'calculated' AND NOT (i.status='no_path' AND EXISTS(
            SELECT 1 FROM pf_proposals p WHERE p.project_id=i.project_id AND p.job_id=i.job_id AND p.cable_id=i.cable_id AND p.status='no_path'
              AND p.result->>'calculationMode'='calculate' AND p.result->'trayCapacity'->>'outcome'='no-capacity'
              AND p.dependencies->'settings'->'trayCapacity'->>'enabled'='true')))`);
      return result.rowCount ?? 0;
    }, signal); },
    async claim(signal?: AbortSignal): Promise<AutomaticPairClaim | null> { return schedulerTransaction(pool, async client => {
      await client.query(`/* automatic-pair:exhausted */ WITH exhausted AS(SELECT project_id,job_id,cable_id FROM pf_automatic_pair_dispatch
        WHERE status IN('running','unknown') AND attempts>=3 AND lease_until<=clock_timestamp() ORDER BY lease_until,project_id,job_id,cable_id LIMIT 10 FOR UPDATE SKIP LOCKED)
        UPDATE pf_automatic_pair_dispatch d SET status='unknown',reason_code='AUTOMATIC_PAIR_RECOVERY_LIMIT',owner_token=NULL,lease_until=NULL,not_before=NULL,updated_at=clock_timestamp()
        FROM exhausted x WHERE d.project_id=x.project_id AND d.job_id=x.job_id AND d.cable_id=x.cable_id`);
      const row = (await client.query<Row>(`/* automatic-pair:claim */ SELECT d.project_id,d.job_id,d.cable_id FROM pf_automatic_pair_dispatch d
        JOIN pf_job_items i ON i.project_id=d.project_id AND i.job_id=d.job_id AND i.cable_id=d.cable_id
        JOIN pf_proposals p ON p.project_id=i.project_id AND p.job_id=i.job_id AND p.cable_id=i.cable_id
        JOIN pf_revision_results r ON r.project_id=p.project_id AND r.proposal_id=p.id AND r.cable_id=p.cable_id
        WHERE d.status IN('pending','running','unknown') AND d.attempts<3 AND d.not_before<=clock_timestamp()
          AND (d.lease_until IS NULL OR d.lease_until<=clock_timestamp()) AND i.state='complete'
          AND (i.status='calculated' AND p.status='calculated' OR i.status='no_path' AND p.status='no_path'
            AND p.result->>'calculationMode'='calculate' AND p.result->'trayCapacity'->>'outcome'='no-capacity'
            AND p.dependencies->'settings'->'trayCapacity'->>'enabled'='true')
        ORDER BY d.not_before,d.project_id,d.job_id,d.cable_id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`)).rows[0];
      if (!row) return null;
      const ownerToken = randomUUID(), leaseExpiresAt = new Date(Date.now() + 60000).toISOString();
      await client.query(`UPDATE pf_automatic_pair_dispatch SET status='running',attempts=attempts+1,owner_token=$4,lease_until=$5,updated_at=clock_timestamp()
        WHERE project_id=$1 AND job_id=$2 AND cable_id=$3`, [row.project_id, row.job_id, row.cable_id, ownerToken, leaseExpiresAt]);
      return { projectId: row.project_id, jobId: row.job_id, cableId: row.cable_id, ownerToken, leaseExpiresAt };
    }, signal); },
    async fence(client: PoolClient, claim: AutomaticPairClaim) {
      const row = (await client.query<Row>(`/* automatic-pair:dispatch-fence */ SELECT status,owner_token,lease_until FROM pf_automatic_pair_dispatch
        WHERE project_id=$1 AND job_id=$2 AND cable_id=$3 FOR UPDATE`, [claim.projectId, claim.jobId, claim.cableId])).rows[0];
      if (!row || row.status !== 'running' || row.owner_token !== claim.ownerToken || new Date(row.lease_until).toISOString() !== claim.leaseExpiresAt
        || Date.now() >= Date.parse(claim.leaseExpiresAt)) return fail();
    },
    async finish(claim: AutomaticPairClaim, outcome: AutomaticPairOutcome) {
      if (!automaticPairStatuses.includes(outcome.status) || ['pending', 'running'].includes(outcome.status)
        || ['written', 'already-written'].includes(outcome.status) !== Boolean(outcome.receiptId)) return fail();
      return schedulerTransaction(pool, async client => {
        await client.query(`/* automatic-pair:finish */ UPDATE pf_automatic_pair_dispatch SET status=$4,receipt_id=$5,reason_code=$6,
          owner_token=NULL,lease_until=NULL,not_before=CASE WHEN $4='unknown' AND attempts<3 THEN clock_timestamp()+interval '5 seconds' ELSE NULL END,
          updated_at=clock_timestamp() WHERE project_id=$1 AND job_id=$2 AND cable_id=$3 AND owner_token=$7 AND status='running'`,
        [claim.projectId, claim.jobId, claim.cableId, outcome.status, outcome.receiptId, outcome.code ?? null, claim.ownerToken]);
      });
    },
  };
}
export type AutomaticPairDispatch = ReturnType<typeof createAutomaticPairDispatch>;
