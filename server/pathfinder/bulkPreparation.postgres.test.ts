// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bulkPreparationSql, createBulkPreparationQueue } from './bulkPreparation.js';
import { principalTransaction } from './auth.js';
import { PathFinderError } from './errors.js';
import { defaultOptions } from './jobContracts.js';
import { hash } from './dependencies.js';
import { AUTOMATIC_PAIR_POLICY } from '../../shared/pathfinderAutomaticPair.js';
import { MAX_ACCEPTED_BASELINE_BATCH } from './acceptedBaselineRows.js';

describe.skipIf(!process.env.PF_BULK_TEST_DATABASE_URL)(
  'durable bulk admission in PostgreSQL',
  () => {
    const schema = 'pf_bulk_' + randomUUID().replaceAll('-', ''),
      project = randomUUID();
    const who = {
      userId: randomUUID(),
      loginId: randomUUID(),
      loginExpiresAt: Date.now() + 3600000,
    };
    const scope = {
      projectId: project,
      modelVersionId: randomUUID(),
      contentFingerprint: 'a'.repeat(64),
      selectionRevision: '1',
      captureFrameId: randomUUID(),
      captureFrameSha256: 'b'.repeat(64),
      coordinateFrame: 'canonical-world-metres' as const,
    };
    const request = () => ({
      submissionId: randomUUID(),
      force: true,
      expectedRegistryRevision: '1',
      automaticPairPolicy: AUTOMATIC_PAIR_POLICY,
      options: {
        ...defaultOptions,
        barrierRouting: {
          schemaVersion: 'wfc.pf.barrier-admission-intent.v1' as const,
          scope,
          expectedRegistryRevision: '1',
          drillThroughWalls: false,
          expectedSnapshot: {
            snapshotId: randomUUID(),
            scope,
            registryRevision: '1',
            contentSha256: 'c'.repeat(64),
            mode: 'explicit-empty' as const,
          },
        },
      },
    });
    let admin: Pool, pool: Pool;
    beforeAll(async () => {
      const connectionString = process.env.PF_BULK_TEST_DATABASE_URL;
      admin = new Pool({ connectionString });
      await admin.query('CREATE SCHEMA ' + schema);
      pool = new Pool({ connectionString, options: '-c search_path=' + schema });
      await pool.query(`CREATE TABLE projects(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean);
      CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid,expires_at timestamptz,revoked_at timestamptz);
      CREATE TABLE cables(id uuid PRIMARY KEY,project_id uuid,routing text);
      CREATE TABLE pf_jobs(id uuid PRIMARY KEY, project_id uuid,requested_by uuid,bulk_submission_sha256 text,bulk_submission_registry_revision bigint);`);
      await pool.query(bulkPreparationSql);
      await pool.query('INSERT INTO projects VALUES($1)', [project]);
      await pool.query('INSERT INTO users VALUES($1,true)', [who.userId]);
    });
    afterAll(async () => {
      await pool?.end();
      if (admin) {
        await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
        await admin.end();
      }
    });
    it('replays a lost acknowledgement, recovers an abandoned claim and publishes once', async () => {
      const input = request();
      const queue = createBulkPreparationQueue(pool, async (pid, actor, body, prep) =>
        principalTransaction(
          pool,
          pid,
          actor,
          async (c) => {
            await prep.report(1, 2);
            expect(
              (await queue.pending(pid, actor, input.submissionId))?.preparation.prepared,
            ).toBe(1);
            await c.query('INSERT INTO pf_jobs VALUES($1,$2,$3,$4,1)', [
              body.submissionId,
              pid,
              actor.userId,
              hash(body),
            ]);
            await prep.finish(c);
          },
          { persistedLogin: true },
        ),
      );
      const results = await Promise.all([
        queue.enqueue(project, who, input),
        queue.enqueue(project, who, input),
      ]);
      expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
      await expect(
        queue.enqueue(project, who, { ...input, expectedRegistryRevision: '2' }),
      ).rejects.toMatchObject({ code: 'BULK_SUBMISSION_CONFLICT' });
      await pool.query(
        "UPDATE pf_bulk_preparations SET state='preparing',claim=$2,available_at=now()-interval '1 second' WHERE id=$1",
        [input.submissionId, randomUUID()],
      );
      await Promise.all([queue.runOne(), queue.runOne()]);
      expect(await queue.pending(project, who, input.submissionId)).toBeNull();
      expect((await queue.enqueue(project, who, input)).duplicate).toBe(true);
      expect(
        (await pool.query('SELECT id FROM pf_jobs WHERE id=$1', [input.submissionId])).rowCount,
      ).toBe(1);
    });
    it('fences publication after Stop and accepts a fresh request immediately', async () => {
      const input = request(),
        fresh = request();
      const queue = createBulkPreparationQueue(pool, async (pid, actor, body, prep) =>
        principalTransaction(
          pool,
          pid,
          actor,
          async (c) => {
            await c.query('INSERT INTO pf_jobs VALUES($1,$2,$3,$4,1)', [
              body.submissionId,
              pid,
              actor.userId,
              hash(body),
            ]);
            expect(
              (await queue.pending(pid, actor, input.submissionId, true))?.cancelRequested,
            ).toBe(true);
            await queue.enqueue(pid, actor, fresh);
            await prep.finish(c);
          },
          { persistedLogin: true },
        ),
      );
      await queue.enqueue(project, who, input);
      await queue.runOne();
      expect((await queue.pending(project, who, input.submissionId))?.status).toBe('cancelled');
      expect(
        (await pool.query('SELECT id FROM pf_jobs WHERE id=$1', [input.submissionId])).rowCount,
      ).toBe(0);
      expect((await queue.pending(project, who, fresh.submissionId, true))?.status).toBe(
        'cancelled',
      );
    });
    it('retries SQL timeouts with smaller groups and gives a terminal reason after three attempts', async () => {
      const input = request(),
        sizes: number[] = [];
      const queue = createBulkPreparationQueue(pool, async (_project, _who, _input, prep) => {
        sizes.push(prep.chunk);
        throw new PathFinderError('ACCEPTED_BASELINES_TIMEOUT', 503);
      });
      await queue.enqueue(project, who, input);
      for (let i = 0; i < 3; i++) {
        await pool.query('UPDATE pf_bulk_preparations SET available_at=now() WHERE id=$1', [
          input.submissionId,
        ]);
        await queue.runOne();
      }
      expect(sizes).toEqual([0,1,2].map(at=>Math.floor(MAX_ACCEPTED_BASELINE_BATCH / 2 ** at)));
      expect(await queue.pending(project, who, input.submissionId)).toMatchObject({
        status: 'failed',
        failure: 'ACCEPTED_BASELINES_TIMEOUT',
      });
    });
    it('checks the original login again after enqueue and never registers a missing worker login', async () => {
      const input = request(),
        actor = { ...who, loginId: randomUUID() };
      const queue = createBulkPreparationQueue(pool, async (pid, original, _body, prep) =>
        principalTransaction(pool, pid, original, (c) => prep.finish(c), { persistedLogin: true }),
      );
      await queue.enqueue(project, actor, input);
      await pool.query('DELETE FROM viewer_login_bindings WHERE login_id=$1', [actor.loginId]);
      await queue.runOne();
      expect(
        (
          await pool.query('SELECT failure FROM pf_bulk_preparations WHERE id=$1', [
            input.submissionId,
          ])
        ).rows[0].failure,
      ).toBe('LOGIN_REVOKED');
      expect(
        (await pool.query('SELECT 1 FROM viewer_login_bindings WHERE login_id=$1', [actor.loginId]))
          .rowCount,
      ).toBe(0);
    });
    it('renews a slow proof batch, prevents another worker claiming it, and observes Stop without a progress report', async () => {
      const input=request();
      let started!:()=>void;
      const entered=new Promise<void>(resolve=>{started=resolve;});
      let observed:AbortSignal|undefined;
      const create=vi.fn(async (_pid,_actor,_body,prep)=>{
        observed=prep.signal; started();
        await new Promise<void>((_resolve,reject)=>prep.signal.addEventListener('abort',()=>reject(prep.signal.reason),{once:true}));
      });
      const queue=createBulkPreparationQueue(pool,create);
      await queue.enqueue(project,who,input);
      const running=queue.runOne();await entered;
      // Force a lease almost due; the independent heartbeat must renew it.
      await pool.query("UPDATE pf_bulk_preparations SET available_at=now()+interval '2 seconds' WHERE id=$1",[input.submissionId]);
      await new Promise(resolve=>setTimeout(resolve,1200));
      expect((await pool.query('SELECT available_at>now()+interval \'2 minutes\' AS renewed FROM pf_bulk_preparations WHERE id=$1',[input.submissionId])).rows[0].renewed).toBe(true);
      await queue.runOne();expect(create).toHaveBeenCalledTimes(1);
      await queue.pending(project,who,input.submissionId,true);
      await running;
      expect(observed?.aborted).toBe(true);
      expect((await queue.pending(project,who,input.submissionId))?.status).toBe('cancelled');
      expect((await pool.query('SELECT id FROM pf_jobs WHERE id=$1',[input.submissionId])).rowCount).toBe(0);
    });
    it('bounds recovery attempts even when previous workers crashed before handling their error', async () => {
      const input=request(),create=vi.fn(),queue=createBulkPreparationQueue(pool,create);
      await queue.enqueue(project,who,input);
      await pool.query("UPDATE pf_bulk_preparations SET state='preparing',attempt=3,available_at=now()-interval '1 second' WHERE id=$1",[input.submissionId]);
      await queue.runOne();
      expect(create).not.toHaveBeenCalled();
      expect(await queue.pending(project,who,input.submissionId)).toMatchObject({status:'failed',failure:'BULK_PREPARATION_ATTEMPTS_EXHAUSTED'});
    });
    it('allows a cable assignment to commit while a background proof snapshot remains open', async () => {
      const cable=randomUUID();await pool.query('INSERT INTO cables VALUES($1,$2,$3)',[cable,project,'/OLD']);
      let release!:()=>void,started!:()=>void;
      const hold=new Promise<void>(resolve=>{release=resolve;});
      const entered=new Promise<void>(resolve=>{started=resolve;});
      const reading=principalTransaction(pool,project,who,async c=>{
        await c.query('SELECT routing FROM cables WHERE id=$1',[cable]);started();await hold;
      },{snapshot:true,persistedLogin:true});
      await entered;
      try {
        await principalTransaction(pool,project,who,async c=>{
          await c.query("SET LOCAL lock_timeout='500ms'");
          await c.query('UPDATE cables SET routing=$2 WHERE id=$1',[cable,'/ASSIGNED']);
        });
        expect((await pool.query('SELECT routing FROM cables WHERE id=$1',[cable])).rows[0].routing).toBe('/ASSIGNED');
      } finally {release();await reading;}
    });
  },
);
