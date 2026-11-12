// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { GEOMETRY_TRACE_DERIVATION } from '../../shared/pathfinderGeometryTrace.js';
import { buildGeometryTrace, geometryTraceFrozenSchema, geometryTraceHash } from './geometryTraceBuilder.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { initializeGeometryTraceSchema } from './geometryTraceSchema.js';

const databaseUrl = process.env.WFC_GEOMETRY_TRACE_RUNTIME_TEST_DATABASE_URL;
type TestDatabase = Parameters<Parameters<typeof withDatabase>[0]>[0];

async function withDatabase(run: (f: {
  pool: Pool; control: Client; projectId: string; otherProjectId: string; actorId: string;
  sample: ReturnType<typeof geometryTraceFixture>; legacy: ReturnType<typeof geometryTraceFrozenSchema.parse>;
  legacyInputSha256: string; beforeMigration: Record<string, unknown>;
}) => Promise<void>) {
  const url = new URL(databaseUrl!);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55446' ||
      url.pathname !== '/wfc_geometry_trace_runtime_test' || url.search || url.hash)
    throw new Error('Use only the disposable local wfc_geometry_trace_runtime_test database on port 55446.');
  const schema = 'pf_trace_runtime_' + randomUUID().replaceAll('-', '');
  if (!/^pf_trace_runtime_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid owned schema.');
  const control = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 5000,
    options: `-c search_path=${schema},pg_catalog`, application_name: schema, max: 3 });
  let connected = false, created = false;
  try {
    await control.connect(); connected = true;
    expect((await control.query('SELECT current_database() AS name')).rows[0].name).toBe('wfc_geometry_trace_runtime_test');
    await control.query(`CREATE SCHEMA "${schema}"`); created = true;
    await control.query("SELECT set_config('search_path',$1,false)", [schema + ',pg_catalog']);
    await control.query(`CREATE TABLE projects(id uuid PRIMARY KEY);
      CREATE TABLE pf_preparation_sessions(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),UNIQUE(project_id,id));
      CREATE TABLE pf_preparation_parts(session_id uuid NOT NULL,part_id uuid NOT NULL,PRIMARY KEY(session_id,part_id));
      CREATE TABLE pf_preparation_aggregates(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id));
      CREATE UNIQUE INDEX pf_preparation_aggregate_tenant_identity ON pf_preparation_aggregates(project_id,id);
      CREATE TABLE pf_geometry_trace_intents (
        id uuid PRIMARY KEY,project_id uuid NOT NULL,aggregate_id uuid NOT NULL,derivation_version text NOT NULL,
        input_sha256 text NOT NULL CHECK(input_sha256~'^[a-f0-9]{64}$'),frozen jsonb NOT NULL,
        state text NOT NULL CHECK(state IN('pending','complete')),lease_token uuid NOT NULL,lease_expires_at timestamptz NOT NULL,
        created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(project_id,id),UNIQUE(project_id,aggregate_id,derivation_version),
        FOREIGN KEY(project_id,aggregate_id) REFERENCES pf_preparation_aggregates(project_id,id) ON DELETE CASCADE)`);
    const sample = geometryTraceFixture(), projectId = sample.aggregate.projectId, otherProjectId = randomUUID(), actorId = randomUUID();
    const legacy = geometryTraceFrozenSchema.parse({ traceId: randomUUID(), exportId: randomUUID(), fittedBlobId: randomUUID(),
      recordsBlobId: randomUUID(), frozenBlobId: randomUUID(), aggregate: sample.aggregate, plan: sample.plan,
      runtimeFingerprint: sample.runtimeFingerprint, declaredLengths: sample.declaredLengths, evidence: [], createdAt: sample.createdAt, createdBy: actorId });
    const legacyInputSha256 = geometryTraceHash({ aggregate: legacy.aggregate, derivationVersion: GEOMETRY_TRACE_DERIVATION, fingerprint: legacy.runtimeFingerprint });
    await control.query('INSERT INTO projects VALUES($1),($2)', [projectId, otherProjectId]);
    await control.query('INSERT INTO pf_preparation_sessions VALUES($1,$2)', [sample.aggregate.sessionId, projectId]);
    await control.query('INSERT INTO pf_preparation_aggregates VALUES($1,$2)', [sample.aggregate.id, projectId]);
    await control.query(`INSERT INTO pf_geometry_trace_intents(id,project_id,aggregate_id,derivation_version,input_sha256,frozen,state,lease_token,lease_expires_at,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10)`, [legacy.traceId, projectId, sample.aggregate.id, GEOMETRY_TRACE_DERIVATION,
      legacyInputSha256, legacy, randomUUID(), new Date(Date.now() + 60000), actorId, new Date(sample.createdAt)]);
    const beforeMigration = (await control.query('SELECT * FROM pf_geometry_trace_intents WHERE id=$1', [legacy.traceId])).rows[0];
    await initializeGeometryTraceSchema(pool); await initializeGeometryTraceSchema(pool);
    await run({ pool, control, projectId, otherProjectId, actorId, sample, legacy, legacyInputSha256, beforeMigration });
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

async function addRuntimeIntent(f: TestDatabase, protocol = 'runtime-v2', runtimeMarker = '0') {
  const frozen = { ...f.legacy, traceId: randomUUID(), exportId: randomUUID(), fittedBlobId: randomUUID(), recordsBlobId: randomUUID(), frozenBlobId: randomUUID(),
    runtimeFingerprint: { ...f.legacy.runtimeFingerprint, derivationSha256: runtimeMarker.repeat(64) } };
  const inputSha256 = geometryTraceHash({ aggregate: frozen.aggregate, derivationVersion: GEOMETRY_TRACE_DERIVATION, fingerprint: frozen.runtimeFingerprint });
  await f.pool.query(`INSERT INTO pf_geometry_trace_intents(id,project_id,aggregate_id,derivation_version,input_sha256,frozen,state,lease_token,lease_expires_at,created_by,admission_protocol)
    VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10)`, [frozen.traceId, f.projectId, frozen.aggregate.id, GEOMETRY_TRACE_DERIVATION,
    inputSha256, frozen, randomUUID(), new Date(Date.now() + 60000), f.actorId, protocol]);
  return { frozen, inputSha256 };
}

describe.skipIf(!databaseUrl).sequential('runtime trace migration against dedicated PostgreSQL', () => {
  it('migrates the original uniqueness idempotently and preserves every retained pending field', async () => {
    await withDatabase(async f => {
      const after = (await f.pool.query('SELECT * FROM pf_geometry_trace_intents WHERE id=$1', [f.legacy.traceId])).rows[0];
      expect(after).toEqual({ ...f.beforeMigration, admission_protocol: 'legacy-v1' });
      const uniqueColumns = async (table: string) => (await f.pool.query<{ columns: string[] }>(`SELECT ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ordinality) AS columns
        FROM pg_constraint c WHERE c.conrelid=$1::regclass AND c.contype='u'`, [table])).rows.map(row => row.columns);
      expect(await uniqueColumns('pf_geometry_trace_intents')).not.toContainEqual(['project_id', 'aggregate_id', 'derivation_version']);
      expect(await uniqueColumns('pf_geometry_trace_sets')).toContainEqual(['project_id', 'aggregate_id', 'derivation_version']);
      const indexes = (await f.pool.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename='pf_geometry_trace_intents'")).rows.map(row => row.indexdef).join('\n');
      expect(indexes).toContain('(project_id, aggregate_id, derivation_version, input_sha256)');
      expect(indexes).toContain("WHERE (admission_protocol = 'legacy-v1'::text)");
    });
  }, 15000);

  it('allows a new runtime generation while excluding duplicates and a second legacy namespace', async () => {
    await withDatabase(async f => {
      const current = await addRuntimeIntent(f);
      expect((await f.pool.query('SELECT count(*)::int AS count FROM pf_geometry_trace_intents WHERE project_id=$1', [f.projectId])).rows[0].count).toBe(2);
      expect((await f.pool.query('SELECT frozen FROM pf_geometry_trace_intents WHERE id=$1', [f.legacy.traceId])).rows[0].frozen).toEqual(f.legacy);
      await expect(addRuntimeIntent(f)).rejects.toMatchObject({ code: '23505' });
      await expect(addRuntimeIntent(f, 'legacy-v1', '1')).rejects.toMatchObject({ code: '23505' });
      expect((await f.pool.query('SELECT input_sha256 FROM pf_geometry_trace_intents WHERE id=$1', [current.frozen.traceId])).rows[0].input_sha256).toBe(current.inputSha256);
    });
  }, 15000);

  it('keeps intent identity immutable while allowing pending lease renewal and freezing completed work', async () => {
    await withDatabase(async f => {
      for (const sql of ["UPDATE pf_geometry_trace_intents SET input_sha256=repeat('f',64) WHERE id=$1",
        "UPDATE pf_geometry_trace_intents SET frozen=frozen || '{\"changed\":true}'::jsonb WHERE id=$1",
        "UPDATE pf_geometry_trace_intents SET admission_protocol='runtime-v2' WHERE id=$1"])
        await expect(f.pool.query(sql, [f.legacy.traceId])).rejects.toMatchObject({ code: 'P0001' });
      const lease = randomUUID(), deadline = new Date(Date.now() + 120000);
      await f.pool.query('UPDATE pf_geometry_trace_intents SET lease_token=$2,lease_expires_at=$3 WHERE id=$1', [f.legacy.traceId, lease, deadline]);
      expect((await f.pool.query('SELECT lease_token,lease_expires_at FROM pf_geometry_trace_intents WHERE id=$1', [f.legacy.traceId])).rows[0])
        .toEqual({ lease_token: lease, lease_expires_at: deadline });
      await f.pool.query("UPDATE pf_geometry_trace_intents SET state='complete' WHERE id=$1", [f.legacy.traceId]);
      await expect(f.pool.query('UPDATE pf_geometry_trace_intents SET lease_token=$2 WHERE id=$1', [f.legacy.traceId, randomUUID()])).rejects.toMatchObject({ code: 'P0001' });
    });
  }, 15000);

  it('binds immutable actor command admissions to an intent in the same tenant', async () => {
    await withDatabase(async f => {
      const current = await addRuntimeIntent(f), key = randomUUID();
      const command = { schemaVersion: 'wfc.pf.geometry-trace-create.v2', aggregateId: f.sample.aggregate.id, expectedProjectionSha256: f.sample.aggregate.projection.sha256,
        derivationVersion: GEOMETRY_TRACE_DERIVATION, expectedRuntimeFingerprintSha256: geometryTraceHash(current.frozen.runtimeFingerprint), idempotencyKey: key };
      const insert = (project: string, actor: string) => f.pool.query(`INSERT INTO pf_geometry_trace_admissions(project_id,actor_id,idempotency_key,request_sha256,request,intent_id,input_sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [project, actor, key, geometryTraceHash(command), command, current.frozen.traceId, current.inputSha256]);
      await insert(f.projectId, f.actorId);
      await expect(insert(f.projectId, f.actorId)).rejects.toMatchObject({ code: '23505' });
      await insert(f.projectId, randomUUID());
      await expect(insert(f.otherProjectId, f.actorId)).rejects.toMatchObject({ code: '23503' });
      for (const sql of ["UPDATE pf_geometry_trace_admissions SET request='{}'::jsonb WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3",
        'UPDATE pf_geometry_trace_admissions SET intent_id=$3 WHERE project_id=$1 AND actor_id=$2',
        'DELETE FROM pf_geometry_trace_admissions WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3'])
        await expect(f.pool.query(sql, [f.projectId, f.actorId, key])).rejects.toMatchObject({ code: 'P0001' });
      expect((await f.pool.query('SELECT request,intent_id,input_sha256 FROM pf_geometry_trace_admissions WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [f.projectId, f.actorId, key])).rows[0])
        .toEqual({ request: command, intent_id: current.frozen.traceId, input_sha256: current.inputSha256 });
    });
  }, 15000);

  it('retains a single immutable completed historical set across runtime generations', async () => {
    await withDatabase(async f => {
      const current = await addRuntimeIntent(f), historical = buildGeometryTrace({ ...f.sample, ...f.legacy }).manifest;
      await f.pool.query("UPDATE pf_geometry_trace_intents SET state='complete' WHERE id=$1", [f.legacy.traceId]);
      const insert = (id: string, manifest: unknown) => f.pool.query(`INSERT INTO pf_geometry_trace_sets(id,project_id,aggregate_id,model_version_id,derivation_version,manifest)
        VALUES($1,$2,$3,$4,$5,$6)`, [id, f.projectId, f.sample.aggregate.id, f.sample.aggregate.modelVersionId, GEOMETRY_TRACE_DERIVATION, manifest]);
      await insert(f.legacy.traceId, historical);
      await expect(insert(current.frozen.traceId, buildGeometryTrace({ ...f.sample, ...current.frozen }).manifest)).rejects.toMatchObject({ code: '23505' });
      await expect(f.pool.query('UPDATE pf_geometry_trace_sets SET manifest=manifest WHERE project_id=$1 AND id=$2', [f.projectId, f.legacy.traceId])).rejects.toMatchObject({ code: 'P0001' });
      await expect(f.pool.query('DELETE FROM pf_geometry_trace_sets WHERE project_id=$1 AND id=$2', [f.projectId, f.legacy.traceId])).rejects.toMatchObject({ code: 'P0001' });
      expect((await f.pool.query('SELECT manifest FROM pf_geometry_trace_sets WHERE project_id=$1 AND id=$2', [f.projectId, f.legacy.traceId])).rows[0].manifest).toEqual(historical);
      expect((await f.pool.query('SELECT state FROM pf_geometry_trace_intents WHERE id=$1', [current.frozen.traceId])).rows[0].state).toBe('pending');
    });
  }, 15000);
});
