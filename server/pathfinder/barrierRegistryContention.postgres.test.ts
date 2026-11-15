// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Client, Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { barrierCaptureAdapters } from './barrierCaptureAuthority.js';
import { barrierRegistryTransaction, createBarrierRegistryRepository } from './barrierRegistryRepository.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace } from './geometryTraceBuilder.js';
import type { JobPrincipal } from './jobContracts.js';

const databaseUrl = process.env.WFC_BARRIER_CONTENTION_TEST_DATABASE_URL;

async function withDatabase(run: (f: {
  pool: Pool; control: Client; projectId: string; who: JobPrincipal; application: string;
}) => Promise<void>) {
  const url = new URL(databaseUrl!);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55446' ||
      url.pathname !== '/wfc_barrier_contention_test' || url.search || url.hash)
    throw new Error('Use only the disposable local wfc_barrier_contention_test database on port 55446.');
  const schema = 'pf_barrier_contention_' + randomUUID().replaceAll('-', '');
  if (!/^pf_barrier_contention_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid owned schema.');
  const application = schema;
  const control = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 3000 });
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 3000,
    options: `-c search_path=${schema},pg_catalog`, application_name: application, max: 4 });
  let connected = false, created = false;
  try {
    await control.connect(); connected = true;
    expect((await control.query('SELECT current_database() AS name')).rows[0].name).toBe('wfc_barrier_contention_test');
    await control.query(`CREATE SCHEMA "${schema}"`); created = true;
    await control.query("SELECT set_config('search_path',$1,false)", [schema + ',pg_catalog']);
    await control.query(`CREATE TABLE projects(id uuid PRIMARY KEY,label text NOT NULL);
      CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL);
      CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
      CREATE TABLE project_model_selections(project_id uuid PRIMARY KEY,active_model_version_id uuid NOT NULL,selection_revision bigint NOT NULL);
      CREATE TABLE model_versions(project_id uuid NOT NULL,id uuid PRIMARY KEY,content_fingerprint text NOT NULL,state text NOT NULL,health text NOT NULL);
      CREATE TABLE pf_project_preparations(project_id uuid PRIMARY KEY,current_aggregate_id uuid NOT NULL,current_artifact_id uuid NOT NULL);
      CREATE TABLE pf_preparation_aggregates(project_id uuid NOT NULL,id uuid PRIMARY KEY,manifest jsonb NOT NULL);
      CREATE TABLE pf_artifacts(project_id uuid NOT NULL,id uuid PRIMARY KEY,model_version_id uuid NOT NULL,snapshot_sha256 text NOT NULL);
      CREATE TABLE pf_geometry_trace_sets(project_id uuid NOT NULL,id uuid PRIMARY KEY,aggregate_id uuid NOT NULL,manifest jsonb NOT NULL);
      CREATE TABLE pf_geometry_object_revisions(project_id uuid NOT NULL,trace_id uuid NOT NULL,id uuid PRIMARY KEY,summary jsonb NOT NULL,record jsonb NOT NULL);
      CREATE TABLE pf_barrier_heads(project_id uuid PRIMARY KEY,revision bigint NOT NULL,snapshot_id uuid)`);
    const sample = geometryTraceFixture(), built = buildGeometryTrace(sample), aggregate = sample.aggregate;
    const projectId = aggregate.projectId, who: JobPrincipal = {
      userId: randomUUID(), loginId: randomUUID(), loginExpiresAt: Date.now() + 60000,
    };
    await control.query('INSERT INTO projects VALUES($1,$2)', [projectId, 'published-before']);
    await control.query('INSERT INTO users VALUES($1,true)', [who.userId]);
    await control.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)', [who.loginId, who.userId, new Date(who.loginExpiresAt)]);
    await control.query('INSERT INTO project_model_selections VALUES($1,$2,$3)', [projectId, aggregate.modelVersionId, aggregate.selectionRevision]);
    await control.query("INSERT INTO model_versions VALUES($1,$2,$3,'ready','healthy')", [projectId, aggregate.modelVersionId, aggregate.contentFingerprint]);
    await control.query('INSERT INTO pf_project_preparations VALUES($1,$2,$3)', [projectId, aggregate.id, aggregate.artifactId]);
    await control.query('INSERT INTO pf_preparation_aggregates VALUES($1,$2,$3)', [projectId, aggregate.id, aggregate]);
    await control.query('INSERT INTO pf_artifacts VALUES($1,$2,$3,$4)', [projectId, aggregate.artifactId, aggregate.modelVersionId, aggregate.projection.sha256]);
    await control.query('INSERT INTO pf_geometry_trace_sets VALUES($1,$2,$3,$4)', [projectId, built.manifest.id, aggregate.id, built.manifest]);
    for (let index = 0; index < built.records.length; index++)
      await control.query('INSERT INTO pf_geometry_object_revisions VALUES($1,$2,$3,$4,$5)', [projectId, built.manifest.id, built.records[index].id, built.summaries[index], built.records[index]]);
    await control.query('INSERT INTO pf_barrier_heads VALUES($1,0,NULL)', [projectId]);
    await run({ pool, control, projectId, who, application });
  } finally {
    try { if (connected) await control.query('ROLLBACK'); }
    finally {
      try { await pool.end(); }
      finally {
        if (connected) {
          try { if (created) await control.query(`DROP SCHEMA "${schema}" CASCADE`); }
          finally { await control.end(); }
        }
      }
    }
  }
}

async function waitForLock(control: Client, application: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await control.query('SELECT pg_stat_clear_snapshot()');
    if ((await control.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [application])).rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected transaction did not wait on its authority or mutation lock.');
}

describe.skipIf(!databaseUrl)('barrier reads against dedicated PostgreSQL', () => {
  it('reads the committed registry while publication owns project, preparation and barrier-head updates', async () => {
    await withDatabase(async ({ pool, control, projectId, who }) => {
      const repository = createBarrierRegistryRepository(pool, barrierCaptureAdapters());
      await control.query('BEGIN');
      await control.query('UPDATE projects SET label=$2 WHERE id=$1', [projectId, 'uncommitted-publication']);
      await control.query('UPDATE pf_project_preparations SET current_aggregate_id=$2,current_artifact_id=$3 WHERE project_id=$1', [projectId, randomUUID(), randomUUID()]);
      await control.query('UPDATE pf_barrier_heads SET revision=1 WHERE project_id=$1', [projectId]);
      await repository.authorize(projectId, who);
      expect(await repository.get(projectId, who)).toMatchObject({ state: 'unconfigured', registryRevision: '0', snapshot: null,
        scope: { projectId, modelVersionId: geometryTraceFixture().aggregate.modelVersionId } });
      await control.query('ROLLBACK');
    });
  }, 10000);

  it('keeps one coherent read snapshot when a publication commits between reads', async () => {
    await withDatabase(async ({ pool, control, projectId, who }) => {
      const labels = await barrierRegistryTransaction(pool, projectId, who, async client => {
        const before = (await client.query('SELECT label FROM projects WHERE id=$1', [projectId])).rows[0].label;
        await control.query('UPDATE projects SET label=$2 WHERE id=$1', [projectId, 'published-after']);
        const after = (await client.query('SELECT label FROM projects WHERE id=$1', [projectId])).rows[0].label;
        return [before, after];
      }, undefined, undefined, { snapshot: true });
      expect(labels).toEqual(['published-before', 'published-before']);
      expect((await control.query('SELECT label FROM projects WHERE id=$1', [projectId])).rows[0].label).toBe('published-after');
    });
  }, 10000);

  it('still serializes default mutation transactions behind the publication owner', async () => {
    await withDatabase(async ({ pool, control, projectId, who, application }) => {
      await control.query('BEGIN');
      await control.query('UPDATE projects SET label=$2 WHERE id=$1', [projectId, 'other-writer']);
      let entered = false;
      const outcome = barrierRegistryTransaction(pool, projectId, who, async () => { entered = true; })
        .then(() => null, error => error);
      try { await waitForLock(control, application); expect(entered).toBe(false); }
      finally { await control.query('ROLLBACK'); }
      expect(await outcome).toBeNull(); expect(entered).toBe(true);
    });
  }, 10000);

  it.each(['role', 'login'] as const)('holds current %s authority through snapshot completion and refuses its subsequent revocation', async kind => {
    await withDatabase(async ({ pool, control, projectId, who, application }) => {
      let revoker: PoolClient | undefined, revoked: Promise<unknown> | undefined;
      try {
        await barrierRegistryTransaction(pool, projectId, who, async () => {
          revoker = await pool.connect();
          const revokeApplication = application.slice(0, 40) + '_revoke';
          await revoker.query("SELECT set_config('application_name',$1,false)", [revokeApplication]);
          await revoker.query('BEGIN');
          revoked = revoker.query(kind === 'role' ? 'UPDATE users SET is_admin=false WHERE id=$1' : 'UPDATE viewer_login_bindings SET revoked_at=now() WHERE login_id=$1',
            [kind === 'role' ? who.userId : who.loginId]).then(() => null, error => error);
          await waitForLock(control, revokeApplication);
        }, undefined, undefined, { snapshot: true });
        expect(await revoked).toBeNull(); await revoker!.query('COMMIT');
        await expect(createBarrierRegistryRepository(pool, barrierCaptureAdapters()).authorize(projectId, who))
          .rejects.toMatchObject({ code: kind === 'role' ? 'ADMIN_REQUIRED' : 'LOGIN_REVOKED' });
      } finally {
        if (revoker) {
          let broken = false;
          try { await revoker.query('ROLLBACK'); } catch { broken = true; }
          finally { revoker.release(broken); }
        }
      }
    });
  }, 10000);
});
