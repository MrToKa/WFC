// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { barrierCanonicalJson, barrierSnapshotSchema } from '../../shared/pathfinderBarriers.js';
import { initializeBarrierRegistrySchema } from './barrierRegistrySchema.js';
import { initializeRecalculationSchema } from './recalculationSchema.js';

/** Real PG18 trigger/transaction checks only. The small prerequisite tables do
 * not contain engineering rows, actor credentials or a geometrical qualifier.
 * No application database singleton or broad initializer is imported. */
const sqlUrl = process.env.PF_B6_SQL_URL;
const schema = `pf_b6_barrier_triggers_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const id = (n: number) => `b6400000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), modelId = id(2), otherProjectId = id(3), otherModelId = id(4);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
let pool: Pool | undefined, sequence = 100;
const nextId = () => id(sequence++);

const prerequisites = `
CREATE TABLE projects(id uuid PRIMARY KEY,connection_gap numeric NOT NULL DEFAULT 1,
 secondary_tray_length numeric NOT NULL DEFAULT 7,end_connection_length numeric NOT NULL DEFAULT 5,
 additional_bending_percent numeric NOT NULL DEFAULT 10,pf_settings_revision bigint NOT NULL DEFAULT 0);
CREATE TABLE pf_jobs(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),UNIQUE(project_id,id));
CREATE TABLE cables(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),cable_write_revision bigint NOT NULL DEFAULT 0);
CREATE TABLE model_versions(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),
 state text NOT NULL DEFAULT 'ready',health text NOT NULL DEFAULT 'healthy',content_fingerprint text NOT NULL,UNIQUE(project_id,id));
CREATE TABLE project_model_selections(project_id uuid PRIMARY KEY REFERENCES projects(id),active_model_version_id uuid,selection_revision bigint NOT NULL DEFAULT 1);
CREATE TABLE pf_project_preparations(project_id uuid PRIMARY KEY REFERENCES projects(id),current_aggregate_id uuid,current_artifact_id uuid,geometry_revision bigint NOT NULL DEFAULT 0);
CREATE TABLE pf_purpose_project_state(project_id uuid PRIMARY KEY REFERENCES projects(id),catalog_revision bigint NOT NULL DEFAULT 0,routing_policy_revision bigint NOT NULL DEFAULT 0);
CREATE TABLE pf_project_state(project_id uuid PRIMARY KEY REFERENCES projects(id),registry_revision bigint NOT NULL DEFAULT 0);
CREATE TABLE pf_endpoint_binding_heads(project_id uuid NOT NULL REFERENCES projects(id),location_id uuid NOT NULL,binding_id uuid,binding_revision bigint NOT NULL DEFAULT 0,PRIMARY KEY(project_id,location_id));
CREATE TABLE pf_revision_comparison_targets(project_id uuid PRIMARY KEY REFERENCES projects(id),current_comparison_id uuid,comparison_revision bigint NOT NULL DEFAULT 0,
 decision_set_sha256 text,target_aggregate_id uuid,target_model_version_id uuid);
CREATE TABLE pf_revision_comparison_intents(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),state text NOT NULL,
 target_aggregate_id uuid,target_model_version_id uuid);
`;
async function transaction(action: (client: PoolClient) => Promise<void>) {
  if (!pool) throw Error('Owned B6 SQL fixture has not been initialized.');
  const client = await pool.connect();
  try { await client.query('BEGIN'); await action(client); }
  finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
}
async function addHead(client: PoolClient, project = projectId) {
  await client.query('INSERT INTO pf_barrier_heads(project_id) VALUES($1)', [project]);
}
async function addSnapshot(client: PoolClient, revision = 1, project = projectId): Promise<string> {
  const snapshotId = nextId(), intentId = nextId();
  const body = { schemaVersion: 'wfc.pf.barrier-snapshot.v1' as const, snapshotId,
    scope: { projectId: project, modelVersionId: project === projectId ? modelId : otherModelId, contentFingerprint: 'a'.repeat(64),
      selectionRevision: '1', captureFrameId: id(5), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const },
    registryRevision: String(revision), selectedParents: [], capture: null,
    geometry: { mode: 'explicit-empty' as const, declarationId: nextId(), declaration: 'administrator-declared-no-selected-barriers' as const,
      reason: 'Synthetic SQL trigger fixture explicitly selects no barriers.' }, coverage: 'registered-selected-objects-only' as const, engineeringAccepted: false as const };
  const manifest = barrierSnapshotSchema.parse({ ...body, contentSha256: hash(barrierCanonicalJson(body)) });
  const bytes = barrierCanonicalJson(manifest);
  await client.query(`INSERT INTO pf_barrier_snapshots(id,project_id,model_version_id,registry_revision,storage_intent_id,manifest_blob,manifest,created_by,login_id)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`, [snapshotId, project, project === projectId ? modelId : otherModelId,
    revision, intentId, JSON.stringify({ blobId: nextId(), sha256: hash(bytes), bytes: Buffer.byteLength(bytes) }), JSON.stringify(manifest), id(6), id(7)]);
  return snapshotId;
}
async function publish(client: PoolClient, snapshotId: string, revision = 1, project = projectId) {
  await client.query('UPDATE pf_barrier_heads SET revision=$2,snapshot_id=$3,updated_at=clock_timestamp() WHERE project_id=$1', [project, revision, snapshotId]);
}
async function observed(client: PoolClient, project = projectId) {
  const result = await client.query(`SELECT h.revision::text AS head_revision,h.snapshot_id,s.desired_generation::text AS generation,
    s.status,s.reason_codes,s.attempts,s.attempt_generation::text,s.first_dirty_at,s.due_at,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('generation',e.generation::text,'domain',e.domain,'reason',e.reason,'source',e.source_revision)
      ORDER BY e.generation),'[]'::jsonb) FROM pf_recalculation_events e WHERE e.project_id=s.project_id) AS events
    FROM pf_recalculation_state s LEFT JOIN pf_barrier_heads h USING(project_id) WHERE s.project_id=$1`, [project]);
  expect(result.rows).toHaveLength(1); return result.rows[0] as { head_revision: string | null; snapshot_id: string | null;
    generation: string; status: string; reason_codes: string[]; attempts: number; attempt_generation: string | null;
    first_dirty_at: Date | null; due_at: Date | null; events: Array<{ generation: string; domain: string; reason: string; source: string }> };
}

describe.runIf(Boolean(sqlUrl))('PF-B6 real PG18 barrier publication and scheduling transactions in explicit owned 55440 fixture', () => {
  beforeAll(async () => {
    const url = new URL(sqlUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== '55440'
      || url.pathname !== '/pf_b6_fixture' || decodeURIComponent(url.username) !== 'pf_b6_fixture' || url.search || url.hash)
      throw Error('Refuse any database other than explicit loopback 55440/pf_b6_fixture.');
    if (!/^pf_b6_barrier_triggers_[a-f0-9]{12}$/.test(schema)) throw Error('Owned fixture schema identity is invalid.');
    pool = new Pool({ connectionString: sqlUrl, max: 1, connectionTimeoutMillis: 3000, query_timeout: 10000,
      options: `-c search_path=${schema},pg_catalog` });
    const identity = (await pool.query<{ database: string; username: string; version: string }>(
      "SELECT current_database() AS database,current_user AS username,current_setting('server_version_num') AS version")).rows;
    if (identity.length !== 1 || identity[0].database !== 'pf_b6_fixture' || identity[0].username !== 'pf_b6_fixture'
      || Number(identity[0].version) < 180000 || Number(identity[0].version) >= 190000)
      throw Error('Refuse a non-PG18 or foreign disposable database identity.');
    // Fresh generated schema, with no DROP/TRUNCATE/reset of an existing table.
    await pool.query(`CREATE SCHEMA ${schema}`);
    expect((await pool.query('SELECT current_schema() AS name')).rows[0].name).toBe(schema);
    await pool.query(prerequisites);
    await pool.query('INSERT INTO projects(id) VALUES($1),($2)', [projectId, otherProjectId]);
    await pool.query('INSERT INTO model_versions(id,project_id,content_fingerprint) VALUES($1,$2,$5),($3,$4,$5)', [modelId, projectId, otherModelId, otherProjectId, 'a'.repeat(64)]);
    await pool.query('INSERT INTO project_model_selections(project_id,active_model_version_id) VALUES($1,$2),($3,$4)', [projectId, modelId, otherProjectId, otherModelId]);
    await initializeBarrierRegistrySchema(pool); await initializeRecalculationSchema(pool);
    await initializeBarrierRegistrySchema(pool); await initializeRecalculationSchema(pool);
  }, 30000);
  afterAll(async () => { await pool?.end(); }); // Root owns eventual fixture retirement; preserve SQL evidence.

  it('initializes twice with exactly one actual head trigger and no fabricated publication or dirty generation', async () => {
    await transaction(async client => {
      const triggers = await client.query(`SELECT tgname FROM pg_trigger WHERE tgrelid='pf_barrier_heads'::regclass AND NOT tgisinternal AND tgname='pf_recalculation_row_event'`);
      expect(triggers.rows).toHaveLength(1); expect(await observed(client)).toMatchObject({ head_revision: null, snapshot_id: null,
        generation: '0', status: 'disabled', reason_codes: [], events: [] });
    });
  });
  it('keeps an unconfigured head insert and timestamp-only update free of barrier events', async () => {
    await transaction(async client => {
      await addHead(client); await client.query('UPDATE pf_barrier_heads SET updated_at=clock_timestamp() WHERE project_id=$1', [projectId]);
      expect(await observed(client)).toMatchObject({ head_revision: '0', snapshot_id: null, generation: '0', events: [], first_dirty_at: null, due_at: null });
    });
  });
  it('stages an immutable snapshot without emitting an event before the head actually changes', async () => {
    await transaction(async client => {
      await addHead(client); await addSnapshot(client);
      expect(await observed(client)).toMatchObject({ head_revision: '0', snapshot_id: null, generation: '0', events: [] });
    });
  });
  it('publishes one non-null head and exactly one barriers/BARRIER_SCOPE_CHANGED scheduling generation atomically', async () => {
    await transaction(async client => {
      await addHead(client); const snapshot = await addSnapshot(client); await publish(client, snapshot);
      const found = await observed(client);
      expect(found).toMatchObject({ head_revision: '1', snapshot_id: snapshot, generation: '1', status: 'disabled', attempts: 0, attempt_generation: null,
        reason_codes: ['BARRIER_SCOPE_CHANGED'], events: [{ generation: '1', domain: 'barriers', reason: 'BARRIER_SCOPE_CHANGED', source: `1:${snapshot}` }] });
      expect(found.first_dirty_at).toBeInstanceOf(Date); expect(found.due_at).toBeInstanceOf(Date);
    });
  });
  it('also emits exactly one generation for an initial directly published head insert', async () => {
    await transaction(async client => {
      const snapshot = await addSnapshot(client);
      await client.query('INSERT INTO pf_barrier_heads(project_id,revision,snapshot_id) VALUES($1,1,$2)', [projectId, snapshot]);
      expect(await observed(client)).toMatchObject({ generation: '1', events: [{ generation: '1', domain: 'barriers', reason: 'BARRIER_SCOPE_CHANGED', source: `1:${snapshot}` }] });
    });
  });
  it('does not create another generation when the exact published head is written again or merely timestamped', async () => {
    await transaction(async client => {
      await addHead(client); const snapshot = await addSnapshot(client); await publish(client, snapshot); const before = await observed(client);
      await publish(client, snapshot); await client.query('UPDATE pf_barrier_heads SET updated_at=clock_timestamp() WHERE project_id=$1', [projectId]);
      expect(await observed(client)).toEqual(before);
    });
  });
  it('keeps pending capture admission, allocation and refused lease cleanup independent of published scope events', async () => {
    await transaction(async client => {
      await addHead(client); const intent = nextId();
      await client.query(`INSERT INTO pf_barrier_capture_intents(id,project_id,actor_id,login_id,idempotency_key,request_sha256,request,frozen,state)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'pending')`, [intent, projectId, id(6), id(7), nextId(), 'c'.repeat(64),
        JSON.stringify({ schemaVersion: 'synthetic-sql-capture-command', note: 'Only trigger isolation is exercised.' }), JSON.stringify({ scope: 'synthetic SQL only' })]);
      await client.query(`UPDATE pf_barrier_capture_intents SET capture_sha256=$2,allocation='[]'::jsonb,lease_token=$3,lease_expires_at=clock_timestamp()+interval '1 minute' WHERE id=$1`,
        [intent, 'd'.repeat(64), nextId()]);
      await client.query('UPDATE pf_barrier_capture_intents SET lease_token=NULL,lease_expires_at=NULL WHERE id=$1', [intent]);
      expect(await observed(client)).toMatchObject({ head_revision: '0', snapshot_id: null, generation: '0', events: [] });
    });
  });
  it('rolls the published head, snapshot, dirty generation and event back together at a real SQL savepoint', async () => {
    await transaction(async client => {
      await addHead(client); const before = await observed(client); await client.query('SAVEPOINT publication');
      const snapshot = await addSnapshot(client); await publish(client, snapshot);
      expect((await observed(client)).generation).toBe('1');
      await client.query('ROLLBACK TO SAVEPOINT publication');
      expect(await observed(client)).toEqual(before);
      expect((await client.query('SELECT id FROM pf_barrier_snapshots WHERE id=$1', [snapshot])).rows).toEqual([]);
    });
  });
  it('cannot emit a publication event when the tenant snapshot foreign key rejects the new head', async () => {
    await transaction(async client => {
      await addHead(client); const foreignSnapshot = await addSnapshot(client, 1, otherProjectId), before = await observed(client);
      await client.query('SAVEPOINT invalid_publication');
      await expect(publish(client, foreignSnapshot)).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK TO SAVEPOINT invalid_publication'); expect(await observed(client)).toEqual(before);
      expect((await observed(client, otherProjectId)).generation).toBe('0');
    });
  });
  it('invalidates again for a genuinely new published snapshot while preserving the previous event and deduplicated reason', async () => {
    await transaction(async client => {
      await addHead(client); const first = await addSnapshot(client); await publish(client, first);
      const second = await addSnapshot(client, 2); expect((await observed(client)).generation).toBe('1'); await publish(client, second, 2);
      expect(await observed(client)).toMatchObject({ head_revision: '2', snapshot_id: second, generation: '2', reason_codes: ['BARRIER_SCOPE_CHANGED'], events: [
        { generation: '1', domain: 'barriers', reason: 'BARRIER_SCOPE_CHANGED', source: `1:${first}` },
        { generation: '2', domain: 'barriers', reason: 'BARRIER_SCOPE_CHANGED', source: `2:${second}` },
      ] });
    });
  });
  it('places enabled current authority into bounded debounce and resets exhausted attempt state on publication', async () => {
    await transaction(async client => {
      await addHead(client); await client.query(`UPDATE pf_recalculation_state SET enabled=true,actor_id=$2,login_id=$3,
        login_expires_at=clock_timestamp()+interval '10 minutes',authority_expires_at=clock_timestamp()+interval '5 minutes',
        attempts=2,attempt_generation=0,status='complete' WHERE project_id=$1`, [projectId, id(6), id(7)]);
      const snapshot = await addSnapshot(client); await publish(client, snapshot); const found = await observed(client);
      expect(found).toMatchObject({ generation: '1', status: 'debouncing', attempts: 0, attempt_generation: null });
      const due = (await client.query(`SELECT due_at>=first_dirty_at AND due_at<=first_dirty_at+interval '5 seconds' AS bounded
        FROM pf_recalculation_state WHERE project_id=$1`, [projectId])).rows[0]; expect(due.bounded).toBe(true);
      expect((await client.query('SELECT id FROM pf_jobs')).rows).toEqual([]);
    });
  });
  it('migrates a real old domain CHECK and remains idempotent without replaying historical head changes', async () => {
    await pool!.query(`ALTER TABLE pf_recalculation_events DROP CONSTRAINT pf_recalculation_events_domain_check;
      ALTER TABLE pf_recalculation_events ADD CONSTRAINT pf_recalculation_events_domain_check
        CHECK(domain IN('model','geometry','routing','endpoints','settings','cables','engine','manual','preferences'));`);
    await transaction(async client => {
      await addHead(client); const snapshot = await addSnapshot(client); await client.query('SAVEPOINT legacy_check');
      await expect(publish(client, snapshot)).rejects.toMatchObject({ code: '23514' }); await client.query('ROLLBACK TO SAVEPOINT legacy_check');
      expect(await observed(client)).toMatchObject({ head_revision: '0', snapshot_id: null, generation: '0', events: [] });
    });
    await initializeRecalculationSchema(pool!); await initializeBarrierRegistrySchema(pool!);
    await initializeRecalculationSchema(pool!); await initializeBarrierRegistrySchema(pool!);
    await transaction(async client => {
      await addHead(client); const snapshot = await addSnapshot(client); await publish(client, snapshot);
      expect(await observed(client)).toMatchObject({ generation: '1', events: [{ domain: 'barriers', reason: 'BARRIER_SCOPE_CHANGED' }] });
    });
    const untouched = await pool!.query('SELECT desired_generation::text AS generation FROM pf_recalculation_state ORDER BY project_id');
    expect(untouched.rows).toEqual([{ generation: '0' }, { generation: '0' }]);
  });
});
