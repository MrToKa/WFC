// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { repairAutomaticRoutingMigrationControls } from './automaticRoutingMigrationRepair.js';
import type { AutomaticPairReceiptFact } from './automaticPairReceiptProof.js';
import * as receiptProof from './automaticPairReceiptProof.js';
import { initializeCableRoutingControlSchema } from './cableRoutingControlSchema.js';

// This suite verifies real PostgreSQL transactions, SQL, locks and persistence.
// Its explicit proof adapter represents an already-verified historical receipt;
// it does not claim to validate real receipt seals, lineage or barrier evidence.
describe.skipIf(process.env.WFC_ROUTING_REPAIR_POSTGRES !== '1')('automatic routing migration repair in isolated PostgreSQL', () => {
  const database = 'wfc_migration_repair_' + randomUUID().replaceAll('-', '');
  const marker = 'automatic-routing-migration-repair-test:' + randomUUID();
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
    if (!/^wfc_migration_repair_[a-f0-9]{32}$/.test(database) || !/^automatic-routing-migration-repair-test:[a-f0-9-]{36}$/.test(marker))
      throw Error('Invalid disposable database ownership.');
    await admin.query(`CREATE DATABASE ${database}`); created = true;
    await admin.query(`COMMENT ON DATABASE ${database} IS '${marker}'`);
    pool = new Pool({ ...config, database, max: 2 });
    expect((await pool.query('SELECT current_database() AS name')).rows[0].name).toBe(database);
    await pool.query(`CREATE TABLE projects(id uuid PRIMARY KEY);
      CREATE TABLE cables(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        routing text,design_length integer,install_length integer,cable_write_revision bigint NOT NULL,
        pull_date date,connected_from date,connected_to date,tested date);
      CREATE TABLE pf_cable_routing_controls(project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        cable_id uuid NOT NULL REFERENCES cables(id) ON DELETE CASCADE,revision bigint NOT NULL DEFAULT 1,
        manual_revision bigint NOT NULL DEFAULT 1,manual_routing text,manual_protected boolean NOT NULL DEFAULT true,
        execution_locked boolean NOT NULL DEFAULT false,execution_routing text,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(project_id,cable_id));
      CREATE TABLE pf_cable_routing_events(id bigserial PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        cable_id uuid NOT NULL REFERENCES cables(id) ON DELETE CASCADE,actor_id uuid,reason text NOT NULL,control_revision bigint NOT NULL,
        record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
      CREATE TABLE pf_manual_route_jobs(project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        cable_id uuid NOT NULL REFERENCES cables(id) ON DELETE CASCADE,manual_revision bigint NOT NULL,
        PRIMARY KEY(project_id,cable_id));
      CREATE TABLE pf_apply_receipts(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        cable_id uuid NOT NULL REFERENCES cables(id) ON DELETE CASCADE,applied_at timestamptz NOT NULL,provenance jsonb NOT NULL);
      CREATE TABLE cable_versions(id uuid PRIMARY KEY,cable_id uuid NOT NULL REFERENCES cables(id) ON DELETE CASCADE,
        version_number integer NOT NULL,change_source text NOT NULL);`);
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
  async function seed(projectId = randomUUID(), cableId = randomUUID()) {
    const receiptId = randomUUID(), historyId = randomUUID();
    await pool!.query('INSERT INTO projects VALUES($1) ON CONFLICT DO NOTHING', [projectId]);
    await pool!.query("INSERT INTO cables(id,project_id,routing,design_length,cable_write_revision) VALUES($1,$2,'/A/B',24,5)", [cableId, projectId]);
    await pool!.query(`INSERT INTO pf_cable_routing_controls(project_id,cable_id,manual_routing,updated_at)
      VALUES($1,$2,'/A/B','2026-11-16T07:01:58.497123Z') ON CONFLICT(project_id,cable_id) DO UPDATE SET
      manual_routing=EXCLUDED.manual_routing,updated_at=EXCLUDED.updated_at`, [projectId, cableId]);
    await pool!.query('INSERT INTO pf_manual_route_jobs VALUES($1,$2,1)', [projectId, cableId]);
    await pool!.query(`INSERT INTO pf_apply_receipts VALUES($1,$2,$3,'2026-11-10T13:45:00Z','{"schemaVersion":"pathfinder.automatic-pair.v1"}')`,
      [receiptId, projectId, cableId]);
    await pool!.query("INSERT INTO cable_versions VALUES($1,$2,6,'pathfinder')", [historyId, cableId]);
    const after = (await pool!.query(`SELECT to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,
      'install_length',c.install_length::text,'cable_write_revision',c.cable_write_revision::text) AS snapshot FROM cables c WHERE id=$1`, [cableId])).rows[0].snapshot;
    const fact: AutomaticPairReceiptFact = { receiptId, receiptSha256: 'a'.repeat(64), originReceiptId: receiptId,
      before: { ...after, cable_write_revision: '4' }, after, history: { id: historyId, version: '6' } };
    return { projectId, cableId, receiptId, historyId, fact };
  }
  async function transaction<T>(run: (client: PoolClient) => Promise<T>, readOnly = false) {
    const client = await pool!.connect();
    try {
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      try { const result = await run(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
    } finally { client.release(); }
  }
  async function businessSnapshot() {
    return { cables: (await pool!.query('SELECT * FROM cables ORDER BY id')).rows,
      receipts: (await pool!.query('SELECT * FROM pf_apply_receipts ORDER BY id')).rows,
      history: (await pool!.query('SELECT * FROM cable_versions ORDER BY id')).rows };
  }
  it('previews in enforced READ ONLY and applies only audited control metadata while preserving business records', async () => {
    const key = await seed(), before = await businessSnapshot(), proof = async () => key.fact;
    const preview = await transaction(client => repairAutomaticRoutingMigrationControls(client,
      { projectId: key.projectId, cableIds: [key.cableId] }, undefined, { proof }), true);
    expect(preview).toMatchObject({ dryRun: true, eligible: 1, repaired: 0 });
    expect((await pool!.query('SELECT * FROM pf_cable_routing_events')).rowCount).toBe(0);
    expect((await pool!.query('SELECT * FROM pf_manual_route_jobs')).rowCount).toBe(1);
    const applied = await transaction(client => repairAutomaticRoutingMigrationControls(client,
      { projectId: key.projectId, cableIds: [key.cableId], dryRun: false }, undefined, { proof }));
    expect(applied).toMatchObject({ dryRun: false, eligible: 1, repaired: 1 });
    expect((await pool!.query('SELECT revision::text,manual_revision::text,manual_routing,manual_protected,execution_locked,execution_routing FROM pf_cable_routing_controls')).rows)
      .toEqual([{ revision: '2', manual_revision: '2', manual_routing: null, manual_protected: false, execution_locked: false, execution_routing: null }]);
    const audit = (await pool!.query('SELECT actor_id,control_revision::text,record FROM pf_cable_routing_events')).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: null, control_revision: '2', record: {
      schemaVersion: 'wfc.automatic-routing-migration-repair.v1', proof: { receiptId: key.receiptId, historyId: key.historyId },
      before: { manualProtected: true, manualRouting: '/A/B' }, after: { manualProtected: false, manualRouting: null } } });
    expect((await pool!.query('SELECT * FROM pf_manual_route_jobs')).rowCount).toBe(0);
    expect(await businessSnapshot()).toEqual(before);
    const repeat = await transaction(client => repairAutomaticRoutingMigrationControls(client,
      { projectId: key.projectId, cableIds: [key.cableId], dryRun: false }, undefined, { proof }));
    expect(repeat).toMatchObject({ eligible: 0, repaired: 0 });
    expect((await pool!.query('SELECT * FROM pf_cable_routing_events')).rowCount).toBe(1);
  });
  it('rolls back an earlier repair when the second scoped candidate fails unexpectedly', async () => {
    const projectId = randomUUID(), first = await seed(projectId, 'cc000000-0000-4000-8000-000000000001'),
      second = await seed(projectId, 'cc000000-0000-4000-8000-000000000002'), before = await businessSnapshot();
    await expect(transaction(client => repairAutomaticRoutingMigrationControls(client,
      { projectId, cableIds: [second.cableId, first.cableId], dryRun: false }, undefined,
      { proof: async input => { if (input.cableId === second.cableId) throw Error('second proof unavailable'); return first.fact; } })))
      .rejects.toThrow('second proof unavailable');
    expect((await pool!.query('SELECT manual_protected,revision::text FROM pf_cable_routing_controls')).rows)
      .toEqual([{ manual_protected: true, revision: '1' }, { manual_protected: true, revision: '1' }]);
    expect((await pool!.query('SELECT * FROM pf_cable_routing_events')).rowCount).toBe(0);
    expect((await pool!.query('SELECT * FROM pf_manual_route_jobs')).rowCount).toBe(2);
    expect(await businessSnapshot()).toEqual(before);
  });
  it.each(['manual change', 'execution facts', 'execution latch', 'control event', 'changed cable', 'newer receipt'])('retains current protection and values for %s', async change => {
    const key = await seed();
    if (change === 'manual change') await pool!.query('UPDATE pf_cable_routing_controls SET revision=2,manual_revision=2');
    if (change === 'execution facts') await pool!.query('UPDATE cables SET install_length=1');
    if (change === 'execution latch') await pool!.query("UPDATE pf_cable_routing_controls SET execution_locked=true,execution_routing='/A/B'");
    if (change === 'control event') await pool!.query(`INSERT INTO pf_cable_routing_events(project_id,cable_id,reason,control_revision,record)
      VALUES($1,$2,'Explicit manual protection',1,'{}')`, [key.projectId, key.cableId]);
    if (change === 'changed cable') await pool!.query('UPDATE cables SET cable_write_revision=6');
    if (change === 'newer receipt') await pool!.query("UPDATE pf_apply_receipts SET applied_at='2026-11-16T07:01:58.497124Z'");
    const before = await businessSnapshot(), controls = (await pool!.query('SELECT * FROM pf_cable_routing_controls')).rows,
      events = (await pool!.query('SELECT * FROM pf_cable_routing_events')).rows;
    const result = await transaction(client => repairAutomaticRoutingMigrationControls(client,
      { projectId: key.projectId, cableIds: [key.cableId], dryRun: false }, undefined, { proof: async () => key.fact }));
    expect(result).toMatchObject({ eligible: 0, repaired: 0 });
    expect((await pool!.query('SELECT * FROM pf_cable_routing_controls')).rows).toEqual(controls);
    expect((await pool!.query('SELECT * FROM pf_cable_routing_events')).rows).toEqual(events);
    expect((await pool!.query('SELECT * FROM pf_manual_route_jobs')).rowCount).toBe(1);
    expect(await businessSnapshot()).toEqual(before);
  });
  it('uses actual bootstrap RETURNING rows to repair fresh controls only and preserves them across restart', async () => {
    const existing = await seed(), fresh = await seed(existing.projectId), before = await businessSnapshot();
    await pool!.query('DELETE FROM pf_cable_routing_controls WHERE cable_id=$1', [fresh.cableId]);
    const proof = vi.spyOn(receiptProof, 'createAutomaticPairReceiptProofReader').mockImplementation(() => async input => {
      if (input.cableId !== fresh.cableId || input.receiptId !== fresh.receiptId) throw Error('Unexpected bootstrap proof scope');
      return fresh.fact;
    });
    try {
      await initializeCableRoutingControlSchema(pool!);
      expect((await pool!.query('SELECT manual_protected,revision::text FROM pf_cable_routing_controls WHERE cable_id=$1', [fresh.cableId])).rows)
        .toEqual([{ manual_protected: false, revision: '2' }]);
      expect((await pool!.query('SELECT manual_protected,revision::text FROM pf_cable_routing_controls WHERE cable_id=$1', [existing.cableId])).rows)
        .toEqual([{ manual_protected: true, revision: '1' }]);
      expect(proof).toHaveBeenCalledTimes(1);
      const controls = (await pool!.query('SELECT * FROM pf_cable_routing_controls ORDER BY cable_id')).rows,
        events = (await pool!.query('SELECT * FROM pf_cable_routing_events')).rows;
      await initializeCableRoutingControlSchema(pool!);
      expect((await pool!.query('SELECT * FROM pf_cable_routing_controls ORDER BY cable_id')).rows).toEqual(controls);
      expect((await pool!.query('SELECT * FROM pf_cable_routing_events')).rows).toEqual(events);
      expect(proof).toHaveBeenCalledTimes(1);
      expect(await businessSnapshot()).toEqual(before);
    } finally { proof.mockRestore(); }
  });
});
