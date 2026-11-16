// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeAutomaticPairSchema } from './automaticPairSchema.js';
import { appendAutomaticPairAdmissionDecision, readAutomaticPairAdmissionDecision } from './automaticPairAdmissionDecisions.js';

// Opt in only against the explicitly verified loopback test PostgreSQL container.
// Each suite owns a new database; application tables/databases are never used.
describe.skipIf(process.env.WFC_AUTOMATIC_PAIR_DECISIONS_POSTGRES !== '1')('automatic pair admission decisions in PostgreSQL', () => {
  const database = 'wfc_pair_decisions_' + randomUUID().replaceAll('-', '');
  const marker = 'automatic-pair-decisions-test:' + randomUUID();
  let pool: Pool | undefined, admin: Pool | undefined, created = false;
  beforeAll(async () => {
    const inspected = JSON.parse(execFileSync(process.env.WFC_TEST_DOCKER ?? 'docker', ['inspect', 'wfc-test-postgres'], { encoding: 'utf8' }))[0];
    const ports = inspected.NetworkSettings.Ports['5432/tcp'];
    if (!Array.isArray(ports) || ports.length !== 1 || ports[0].HostIp !== '127.0.0.1' || ports[0].HostPort !== '55432')
      throw Error('Unexpected isolated PostgreSQL boundary.');
    const environment = Object.fromEntries(inspected.Config.Env.map((value: string) => {
      const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)];
    }));
    const config = { host: '127.0.0.1', port: 55432, user: environment.POSTGRES_USER ?? 'postgres',
      password: environment.POSTGRES_PASSWORD, connectionTimeoutMillis: 5000, statement_timeout: 10000, lock_timeout: 3000 };
    admin = new Pool({ ...config, database: 'postgres', max: 1 });
    if (!/^wfc_pair_decisions_[a-f0-9]{32}$/.test(database) || !/^automatic-pair-decisions-test:[a-f0-9-]{36}$/.test(marker))
      throw Error('Invalid disposable database ownership.');
    await admin.query(`CREATE DATABASE ${database}`); created = true;
    await admin.query(`COMMENT ON DATABASE ${database} IS '${marker}'`);
    pool = new Pool({ ...config, database, max: 2 });
    expect((await pool.query('SELECT current_database() AS name')).rows[0].name).toBe(database);
    await pool.query(`CREATE TABLE projects(id uuid PRIMARY KEY);
      CREATE TABLE pf_job_items(project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        job_id uuid NOT NULL,cable_id uuid NOT NULL,state text NOT NULL DEFAULT 'complete',status text NOT NULL DEFAULT 'calculated',
        PRIMARY KEY(project_id,job_id,cable_id));`);
    await initializeAutomaticPairSchema(pool);
  });
  afterAll(async () => {
    await pool?.end();
    try {
      if (created) {
        const owner = (await admin!.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1", [database])).rows[0];
        if (owner?.marker !== marker) throw Error('Disposable database ownership marker changed; cleanup refused.');
        await admin!.query(`DROP DATABASE ${database} WITH (FORCE)`);
        expect((await admin!.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount).toBe(0);
      }
    } finally { await admin?.end(); }
  });
  beforeEach(async () => { await pool!.query('DELETE FROM projects'); });
  async function seed(projectId = randomUUID(), jobId = randomUUID(), cableId = randomUUID()) {
    await pool!.query('INSERT INTO projects VALUES($1) ON CONFLICT DO NOTHING', [projectId]);
    await pool!.query('INSERT INTO pf_job_items(project_id,job_id,cable_id) VALUES($1,$2,$3)', [projectId, jobId, cableId]);
    return { projectId, jobId, cableId };
  }
  async function record(key: Awaited<ReturnType<typeof seed>>, reasonCode = 'ROUTING_MANUAL_PROTECTED') {
    const client = await pool!.connect();
    try { await appendAutomaticPairAdmissionDecision(client, { ...key, reasonCode }); }
    finally { client.release(); }
  }
  async function outcome(projectId: string, jobId: string) {
    // Same exact project/job/cable join and dispatch-first projection as jobs.get.
    return (await pool!.query(`SELECT i.cable_id,
      COALESCE(d.status,CASE WHEN a.reason_code IS NOT NULL THEN 'review-required' END) AS automatic_update_status,
      CASE WHEN d.status IS NOT NULL THEN d.reason_code ELSE a.reason_code END AS automatic_update_reason
      FROM pf_job_items i LEFT JOIN pf_automatic_pair_dispatch d
        ON d.project_id=i.project_id AND d.job_id=i.job_id AND d.cable_id=i.cable_id
      LEFT JOIN pf_automatic_pair_admission_decisions a
        ON a.project_id=i.project_id AND a.job_id=i.job_id AND a.cable_id=i.cable_id
      WHERE i.project_id=$1 AND i.job_id=$2 ORDER BY i.cable_id`, [projectId, jobId])).rows;
  }
  it('records protected review without creating authority, and cannot dispatch from a refusal', async () => {
    const key = await seed(); await record(key);
    const client = await pool!.connect();
    try { expect(await readAutomaticPairAdmissionDecision(client, key)).toEqual({ status: 'review-required', reasonCode: 'ROUTING_MANUAL_PROTECTED' }); }
    finally { client.release(); }
    for (const table of ['pf_automatic_pair_mandates', 'pf_automatic_pair_dispatch'])
      expect((await pool!.query(`SELECT 1 FROM ${table} WHERE project_id=$1`, [key.projectId])).rowCount).toBe(0);
    await expect(pool!.query('INSERT INTO pf_automatic_pair_dispatch(project_id,job_id,cable_id) VALUES($1,$2,$3)',
      [key.projectId, key.jobId, key.cableId])).rejects.toMatchObject({ code: '23503' });
    expect(await outcome(key.projectId, key.jobId)).toEqual([{ cable_id: key.cableId,
      automatic_update_status: 'review-required', automatic_update_reason: 'ROUTING_MANUAL_PROTECTED' }]);
  });
  it('enforces exact item scope, reason-code constraints and immutable admission evidence', async () => {
    const key = await seed(); await record(key); const values = [key.projectId, key.jobId, key.cableId];
    await expect(pool!.query('UPDATE pf_automatic_pair_admission_decisions SET reason_code=reason_code WHERE project_id=$1',
      [key.projectId])).rejects.toThrow('Automatic pair admission decision is immutable');
    await expect(pool!.query('DELETE FROM pf_automatic_pair_admission_decisions WHERE project_id=$1',
      [key.projectId])).rejects.toThrow('Automatic pair admission decision is immutable');
    await expect(pool!.query('DELETE FROM pf_job_items WHERE project_id=$1',
      [key.projectId])).rejects.toThrow('Automatic pair admission decision is immutable');
    await expect(pool!.query("INSERT INTO pf_automatic_pair_admission_decisions(project_id,job_id,cable_id,reason_code) VALUES($1,$2,$3,'invalid-reason')",
      values)).rejects.toMatchObject({ code: '23514' });
    await expect(pool!.query("INSERT INTO pf_automatic_pair_admission_decisions(project_id,job_id,cable_id,reason_code) VALUES($1,$2,$3,'ROUTING_MANUAL_PROTECTED')",
      [key.projectId, randomUUID(), key.cableId])).rejects.toMatchObject({ code: '23503' });
    const before = (await pool!.query('SELECT * FROM pf_automatic_pair_admission_decisions')).rows;
    await initializeAutomaticPairSchema(pool!); await initializeAutomaticPairSchema(pool!);
    expect((await pool!.query('SELECT * FROM pf_automatic_pair_admission_decisions')).rows).toEqual(before);
  });
  it('does not leak a refusal across another job, project or cable', async () => {
    const key = await seed(); await record(key);
    const otherJob = await seed(key.projectId, randomUUID(), key.cableId);
    const otherProject = await seed(randomUUID(), key.jobId, key.cableId);
    const otherCable = await seed(key.projectId, key.jobId, randomUUID());
    expect(await outcome(otherJob.projectId, otherJob.jobId)).toEqual([{ cable_id: otherJob.cableId, automatic_update_status: null, automatic_update_reason: null }]);
    expect(await outcome(otherProject.projectId, otherProject.jobId)).toEqual([{ cable_id: otherProject.cableId, automatic_update_status: null, automatic_update_reason: null }]);
    expect((await outcome(key.projectId, key.jobId)).find(row => row.cable_id === otherCable.cableId))
      .toEqual({ cable_id: otherCable.cableId, automatic_update_status: null, automatic_update_reason: null });
  });
  it('retains an actual dispatch outcome in preference to admission-only projection', async () => {
    const key = await seed(); await record(key);
    // Synthetic bookkeeping fixture; it is not an authorized engineering write.
    await pool!.query(`INSERT INTO pf_automatic_pair_mandates(project_id,job_id,cable_id,id,actor_id,login_id,record_sha256,record,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'{}',clock_timestamp())`,
    [key.projectId, key.jobId, key.cableId, randomUUID(), randomUUID(), randomUUID(), 'a'.repeat(64)]);
    await pool!.query(`INSERT INTO pf_automatic_pair_dispatch(project_id,job_id,cable_id,status,reason_code)
      VALUES($1,$2,$3,'refused','AUTOMATIC_PAIR_NO_CURRENT_RESULT')`, [key.projectId, key.jobId, key.cableId]);
    expect(await outcome(key.projectId, key.jobId)).toEqual([{ cable_id: key.cableId,
      automatic_update_status: 'refused', automatic_update_reason: 'AUTOMATIC_PAIR_NO_CURRENT_RESULT' }]);
    await pool!.query(`UPDATE pf_automatic_pair_dispatch SET status='written',reason_code=NULL,receipt_id=$4
      WHERE project_id=$1 AND job_id=$2 AND cable_id=$3`, [key.projectId,key.jobId,key.cableId,randomUUID()]);
    expect(await outcome(key.projectId, key.jobId)).toEqual([{ cable_id: key.cableId,
      automatic_update_status: 'written', automatic_update_reason: null }]);
  });
  it('allows whole-project deletion to clean up its admission evidence normally', async () => {
    const key = await seed(); await record(key);
    await pool!.query('DELETE FROM projects WHERE id=$1', [key.projectId]);
    expect((await pool!.query('SELECT 1 FROM pf_automatic_pair_admission_decisions WHERE project_id=$1', [key.projectId])).rowCount).toBe(0);
    expect((await pool!.query('SELECT 1 FROM pf_job_items WHERE project_id=$1', [key.projectId])).rowCount).toBe(0);
  });
});
