// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Client, Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { principalTransaction } from './auth.js';
import type { JobPrincipal } from './jobContracts.js';

const databaseUrl = process.env.WFC_PREPARATION_CONTENTION_TEST_DATABASE_URL;

async function withDatabase(run: (f: {
  pool: Pool; control: Client; projectId: string; who: JobPrincipal; application: string;
}) => Promise<void>) {
  // Never fall back to an application database or accept a remote host.
  const url = new URL(databaseUrl!);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55446' ||
      url.pathname !== '/wfc_preparation_contention_test' || url.search || url.hash)
    throw new Error('Use only the disposable local wfc_preparation_contention_test database on port 55446.');
  const schema = 'pf_preparation_contention_' + randomUUID().replaceAll('-', '');
  if (!/^pf_preparation_contention_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid owned schema.');
  const application = schema;
  const control = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 3000 });
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 3000,
    options: `-c search_path=${schema},pg_catalog`, application_name: application, max: 4 });
  let connected = false, created = false;
  try {
    await control.connect(); connected = true;
    expect((await control.query('SELECT current_database() AS name')).rows[0].name).toBe('wfc_preparation_contention_test');
    await control.query(`CREATE SCHEMA "${schema}"`); created = true;
    await control.query("SELECT set_config('search_path',$1,false)", [schema + ',pg_catalog']);
    await control.query(`CREATE TABLE projects(id uuid PRIMARY KEY, label text NOT NULL);
      CREATE TABLE users(id uuid PRIMARY KEY, is_admin boolean NOT NULL);
      CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,
        expires_at timestamptz NOT NULL,revoked_at timestamptz)`);
    const projectId = randomUUID(), who: JobPrincipal = {
      userId: randomUUID(), loginId: randomUUID(), loginExpiresAt: Date.now() + 60000,
    };
    await control.query('INSERT INTO projects VALUES($1,$2)', [projectId, 'published-before']);
    await control.query('INSERT INTO users VALUES($1,true)', [who.userId]);
    await control.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)',
      [who.loginId, who.userId, new Date(who.loginExpiresAt)]);
    await run({ pool, control, projectId, who, application });
  } finally {
    // Release any control transaction before waiting for pooled transactions.
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
    const locked = await control.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [application]);
    if (locked.rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected transaction did not wait on its authority/mutation lock.');
}

describe.skipIf(!databaseUrl)('preparation status concurrency against dedicated PostgreSQL', () => {
  it('reads committed status while publication owns the project mutation lock', async () => {
    await withDatabase(async ({ pool, control, projectId, who }) => {
      await control.query('BEGIN');
      await control.query('UPDATE projects SET label=$2 WHERE id=$1', [projectId, 'uncommitted-publication']);
      const result = await principalTransaction(pool, projectId, who, async client =>
        (await client.query('SELECT label FROM projects WHERE id=$1', [projectId])).rows[0].label, { snapshot: true });
      expect(result).toBe('published-before');
      await control.query('ROLLBACK');
    });
  }, 10000);

  it('keeps one coherent status snapshot when publication commits between reads', async () => {
    await withDatabase(async ({ pool, control, projectId, who }) => {
      const labels = await principalTransaction(pool, projectId, who, async client => {
        const before = (await client.query('SELECT label FROM projects WHERE id=$1', [projectId])).rows[0].label;
        await control.query('UPDATE projects SET label=$2 WHERE id=$1', [projectId, 'published-after']);
        const after = (await client.query('SELECT label FROM projects WHERE id=$1', [projectId])).rows[0].label;
        return [before, after];
      }, { snapshot: true });
      expect(labels).toEqual(['published-before', 'published-before']);
      expect((await control.query('SELECT label FROM projects WHERE id=$1', [projectId])).rows[0].label).toBe('published-after');
    });
  }, 10000);

  it('still serializes default mutations behind the publication owner', async () => {
    await withDatabase(async ({ pool, control, projectId, who, application }) => {
      await control.query('BEGIN');
      await control.query('UPDATE projects SET label=$2 WHERE id=$1', [projectId, 'other-writer']);
      let entered = false;
      const mutation = principalTransaction(pool, projectId, who, async client => {
        entered = true;
        await client.query('UPDATE projects SET label=$2 WHERE id=$1', [projectId, 'next-writer']);
      });
      // Attach a rejection handler before inspecting the blocked transaction.
      const outcome = mutation.then(() => null, error => error);
      try {
        await waitForLock(control, application);
        expect(entered).toBe(false);
      } finally { await control.query('ROLLBACK'); }
      expect(await outcome).toBeNull();
      expect(entered).toBe(true);
    });
  }, 10000);

  it('holds login authority through snapshot completion and rejects revoked logins', async () => {
    await withDatabase(async ({ pool, control, projectId, who, application }) => {
      let revoker: PoolClient | undefined;
      let revokeOutcome: Promise<unknown> | undefined;
      try {
        await principalTransaction(pool, projectId, who, async () => {
          revoker = await pool.connect();
          await revoker.query("SELECT set_config('application_name',$1,false)", [application.slice(0, 40) + '_revoke']);
          await revoker.query('BEGIN');
          revokeOutcome = revoker.query('UPDATE viewer_login_bindings SET revoked_at=now() WHERE login_id=$1', [who.loginId])
            .then(() => null, error => error);
          await waitForLock(control, application.slice(0, 40) + '_revoke');
        }, { snapshot: true });
        expect(await revokeOutcome).toBeNull();
        await revoker!.query('COMMIT');
        await expect(principalTransaction(pool, projectId, who, async () => 'must-not-run', { snapshot: true }))
          .rejects.toMatchObject({ code: 'LOGIN_REVOKED', status: 401 });
      } finally {
        if (revoker) {
          let broken = false;
          try { await revoker.query('ROLLBACK'); }
          catch { broken = true; }
          finally { revoker.release(broken); }
        }
      }
    });
  }, 10000);
});
