import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod';
import { REVISION_RESULTS_LIMITS } from '../../shared/pathfinderRevisionResults.js';
import { principalTransaction } from './auth.js';
import { hash } from './dependencies.js';
import { PathFinderError } from './errors.js';
import { createJobSchema, type JobPrincipal } from './jobContracts.js';
import type { BulkPreparation } from './jobs.js';

export const bulkPreparationSql = `
  CREATE TABLE IF NOT EXISTS pf_bulk_preparations (
    id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL, login_id uuid NOT NULL, expires_at timestamptz NOT NULL,
    request_sha256 text NOT NULL, request jsonb, registry_revision bigint NOT NULL,
    state text NOT NULL CHECK(state IN ('waiting','preparing','submitted','cancelled','failed')),
    attempt integer NOT NULL DEFAULT 0, claim uuid, available_at timestamptz NOT NULL DEFAULT now(),
    prepared integer NOT NULL DEFAULT 0, total integer NOT NULL DEFAULT 0, stage text NOT NULL DEFAULT 'reading', failure text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS pf_bulk_preparations_due ON pf_bulk_preparations(available_at,created_at,id)
    WHERE state IN ('waiting','preparing');`;

type Request = z.infer<typeof createJobSchema>;
type Create = (
  project: string,
  who: JobPrincipal,
  input: Request,
  preparation: BulkPreparation,
) => Promise<unknown>;
type Row = {
  id: string;
  project_id: string;
  actor_id: string;
  login_id: string;
  expires_at: Date;
  request: unknown;
  request_sha256: string;
  state: string;
  stage: string;
  attempt: number;
  prepared: number;
  total: number;
  failure: string | null;
  created_at: Date;
  updated_at: Date;
  registry_revision: string;
};

function status(row: Row) {
  const active = row.state === 'waiting' || row.state === 'preparing';
  return {
    id: row.id,
    projectId: row.project_id,
    kind: 'calculate',
    status: active ? 'queued' : row.state,
    preparation: {
      phase: row.state,
      stage: row.stage,
      prepared: row.prepared,
      total: row.total,
      attempt: row.attempt,
    },
    total: 0,
    completed: 0,
    cancelRequested: row.state === 'cancelled',
    failure: row.failure,
    attempts: row.attempt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: [],
  };
}

export async function readPendingPreparation(
  client: PoolClient,
  project: string,
  actor: string,
  id: string,
) {
  const row = (
    await client.query<Row>(
      `SELECT id,project_id,state,stage,attempt,prepared,total,failure,created_at,updated_at
    FROM pf_bulk_preparations WHERE project_id=$1 AND id=$2 AND actor_id=$3 AND state<>'submitted'`,
      [project, id, actor],
    )
  ).rows[0];
  return row ? status(row) : null;
}

export function createBulkPreparationQueue(
  pool: Pool,
  create: Create,
  makeControlPool?: () => Pool,
) {
  let dedicated: Pool | undefined;
  const control = () => (makeControlPool ? (dedicated ??= makeControlPool()) : pool);
  async function enqueue(project: string, who: JobPrincipal, input: Request) {
    if (!input.submissionId || !input.options?.barrierRouting)
      throw new PathFinderError(
        'BARRIER_ROUTING_INTENT_REQUIRED',
        409,
        'Refresh the routing settings before starting.',
      );
    const id = input.submissionId,
      digest = hash(input);
    return principalTransaction(
      pool,
      project,
      who,
      async (client) => {
        // Recover an acknowledgement issued by a version predating this queue.
        const previous = (
          await client.query(
            'SELECT requested_by,bulk_submission_sha256,bulk_submission_registry_revision::text AS revision FROM pf_jobs WHERE project_id=$1 AND id=$2',
            [project, id],
          )
        ).rows[0];
        if (previous) {
          if (previous.requested_by !== who.userId || previous.bulk_submission_sha256 !== digest)
            throw new PathFinderError('BULK_SUBMISSION_CONFLICT', 409);
          return { jobId: id, duplicate: true, registryRevision: previous.revision };
        }
        const inserted = await client.query(
          `INSERT INTO pf_bulk_preparations
        (id,project_id,actor_id,login_id,expires_at,request_sha256,request,registry_revision,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'waiting') ON CONFLICT (id) DO NOTHING`,
          [
            id,
            project,
            who.userId,
            who.loginId,
            new Date(who.loginExpiresAt),
            digest,
            input,
            input.expectedRegistryRevision,
          ],
        );
        const row = (
          await client.query<Pick<Row, 'actor_id' | 'request_sha256' | 'registry_revision'>>(
            'SELECT actor_id,request_sha256,registry_revision::text FROM pf_bulk_preparations WHERE project_id=$1 AND id=$2',
            [project, id],
          )
        ).rows[0];
        if (!row || row.actor_id !== who.userId || row.request_sha256 !== digest)
          throw new PathFinderError('BULK_SUBMISSION_CONFLICT', 409);
        return {
          jobId: id,
          duplicate: inserted.rowCount === 0,
          registryRevision: row.registry_revision,
        };
      },
      { sharedProject: true },
    );
  }

  // A submitted row and its actual job become visible in one commit. Once
  // submitted, GET and Stop use the ordinary job and its write protections.
  async function pending(project: string, who: JobPrincipal, id: string, cancel = false) {
    return principalTransaction(
      pool,
      project,
      who,
      async (client) => {
        if (cancel)
          await client.query(
            `UPDATE pf_bulk_preparations SET state='cancelled',request=NULL,claim=NULL,updated_at=now()
        WHERE project_id=$1 AND id=$2 AND actor_id=$3 AND state IN ('waiting','preparing')`,
            [project, id, who.userId],
          );
        return readPendingPreparation(client, project, who.userId, id);
      },
      { sharedProject: true },
    );
  }

  async function runOne() {
    const claim = randomUUID();
    const row = (
      await control().query<Row>(
        `WITH next AS (
      SELECT id FROM pf_bulk_preparations WHERE state IN ('waiting','preparing') AND available_at<=now()
      ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE pf_bulk_preparations q SET state='preparing',claim=$1,attempt=attempt+1,
        prepared=0,total=0,stage='reading',available_at=now()+interval '3 minutes',updated_at=now() FROM next WHERE q.id=next.id RETURNING q.*`,
        [claim],
      )
    ).rows[0];
    if (!row) return;
    const fenced = () => new PathFinderError('BULK_PREPARATION_SUPERSEDED', 409);
    try {
      const input = createJobSchema.parse(row.request);
      if (input.submissionId !== row.id || hash(input) !== row.request_sha256)
        throw new PathFinderError('BULK_SUBMISSION_CONFLICT', 409);
      await create(
        row.project_id,
        { userId: row.actor_id, loginId: row.login_id, loginExpiresAt: row.expires_at.getTime() },
        input,
        {
          chunk: Math.max(
            1,
            Math.floor(REVISION_RESULTS_LIMITS.chunk / 2 ** Math.min(2, row.attempt - 1)),
          ),
          async report(done, total, stage = 'validating') {
            const result = await control().query(
              `UPDATE pf_bulk_preparations SET prepared=$3,total=$4,stage=$5,updated_at=now(),
            available_at=now()+interval '3 minutes' WHERE id=$1 AND claim=$2 AND state='preparing'`,
              [row.id, claim, done, total, stage],
            );
            if (!result.rowCount) throw fenced();
          },
          async finish(client) {
            const result = await client.query(
              `UPDATE pf_bulk_preparations SET state='submitted',request=NULL,claim=NULL,updated_at=now()
            WHERE id=$1 AND claim=$2 AND state='preparing'`,
              [row.id, claim],
            );
            if (!result.rowCount) throw fenced();
          },
        },
      );
    } catch (error) {
      const code = error instanceof PathFinderError ? error.code : 'BULK_PREPARATION_FAILED';
      const retryable =
        code === 'ACCEPTED_BASELINES_TIMEOUT' ||
        code === 'PATHFINDER_COMMIT_OUTCOME_UNKNOWN' ||
        (error instanceof Error &&
          'code' in error &&
          ['40001', '40P01', '55P03'].includes(String(error.code)));
      const retry = retryable && row.attempt < 3 && row.expires_at.getTime() > Date.now();
      if (code !== 'BULK_PREPARATION_SUPERSEDED')
        console.warn('PathFinder bulk preparation', {
          projectId: row.project_id,
          submissionId: row.id,
          attempt: row.attempt,
          code,
          retry,
        });
      await control().query(
        `UPDATE pf_bulk_preparations SET state=CASE WHEN $3 THEN 'waiting' ELSE 'failed' END,
        request=CASE WHEN $3 THEN request ELSE NULL END, failure=CASE WHEN $3 THEN NULL ELSE $4::text END,
        claim=NULL,available_at=now()+interval '2 seconds',updated_at=now() WHERE id=$1 AND claim=$2 AND state='preparing'`,
        [row.id, claim, retry, code],
      );
    }
  }
  let timer: ReturnType<typeof setInterval> | undefined, active: Promise<void> | undefined;
  function tick() {
    if (!active)
      active = runOne()
        .catch(() => console.error('PathFinder bulk preparation queue unavailable.'))
        .finally(() => {
          active = undefined;
        });
  }
  return {
    enqueue,
    pending,
    runOne,
    start() {
      if (!timer) {
        timer = setInterval(tick, 1000);
        timer.unref();
        tick();
      }
    },
    async stop() {
      clearInterval(timer);
      timer = undefined;
      await active;
      await dedicated?.end();
      dedicated = undefined;
    },
  };
}
