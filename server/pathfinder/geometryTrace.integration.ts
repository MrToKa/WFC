/** Root-only invocation in the guarded isolated Linux runtime; importing this module executes nothing. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { policyUuidSchema, policyHashSchema, canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { geometryTraceCreateSchema } from '../../shared/pathfinderGeometryTrace.js';
import { createGeometryTraceRepository, geometryTraceTransaction, GEOMETRY_TRACE_SQL_BOUNDS, type GeometryTraceRepository, type GeometryTraceAdapters } from './geometryTraceRepository.js';

const PROJECT = '56eadef6-8382-49f8-a652-c8f12026602e';
const MODEL = '098a7e6f-6e39-4935-a98b-ba3b683875a5';
const ACTOR = '9ac1ea26-8bee-4719-87c5-1693df5682b4';
const EMAIL = `${ACTOR}@pf-r3-ui.invalid`;
const phases = ['read', 'refusal', 'immutability', 'history-independence', 'auth-role', 'auth-login', 'auth-expiry', 'fencing-role', 'fencing-selection', 'fencing-registry', 'fencing-timeout'] as const;
const inputSchema = z.object({
  schemaVersion: z.literal('wfc.pf.geometry-trace-control-input.v1'), phase: z.enum(phases), phaseIntentId: policyUuidSchema, intentCreatedAt: z.string().datetime(),
  projectId: z.literal(PROJECT), modelVersionId: z.literal(MODEL), actorEmail: z.literal(EMAIL), aggregateId: policyUuidSchema, traceId: policyUuidSchema, expectedProjectionSha256: policyHashSchema,
  principal: z.object({ userId: z.literal(ACTOR), loginId: policyUuidSchema, loginExpiresAt: z.number().int().positive() }).strict(), command: geometryTraceCreateSchema,
  expectedDatabaseUser: z.literal('pf_local'), expectedServerAddress: z.string().min(1).max(64), crossProjectId: policyUuidSchema.optional(),
}).strict().refine(v => v.command.aggregateId === v.aggregateId && v.command.expectedProjectionSha256 === v.expectedProjectionSha256 && v.crossProjectId !== PROJECT);
export type GeometryTraceControlInput = z.infer<typeof inputSchema>;
type Check = { name: string; status: 'PASS'; scope: string };
const sha = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const note = (checks: Check[], name: string, scope: string) => checks.push({ name, status: 'PASS', scope });

async function rollbackAndRelease(client: PoolClient, message: string): Promise<void> {
  let discard = false;
  try { await client.query('ROLLBACK'); }
  catch (error) { discard = true; throw new Error(message, { cause: error }); }
  finally { client.release(discard); }
}
async function direct(pool: Pool, operation: (client: PoolClient) => Promise<void>): Promise<void> {
  const c = await pool.connect(); let discard = false;
  try { await c.query('BEGIN'); await c.query("SET LOCAL lock_timeout='3500ms';SET LOCAL statement_timeout='5000ms';SET LOCAL idle_in_transaction_session_timeout='12000ms'"); await operation(c); await c.query('COMMIT'); }
  catch (error) { try { await c.query('ROLLBACK'); } catch { discard = true; throw new Error('Owned control transaction rollback is unconfirmed.', { cause: error }); } throw error; } finally { c.release(discard); }
}
async function guardFixture(pool: Pool, input: GeometryTraceControlInput): Promise<void> {
  assert.ok(pool.options.max !== undefined && pool.options.max >= 3 && pool.options.max <= 6, 'Use a dedicated bounded control pool.');
  assert.ok(pool.options.connectionTimeoutMillis !== undefined && pool.options.connectionTimeoutMillis > 0 && pool.options.connectionTimeoutMillis <= 5000);
  assert.ok(pool.options.query_timeout !== undefined && pool.options.query_timeout > 0 && pool.options.query_timeout <= 6000);
  assert.ok(input.principal.loginExpiresAt > Date.now() + 60000, 'Root must supply a fresh fixture login.');
  assert.ok(Math.abs(Date.now() - Date.parse(input.intentCreatedAt)) < 24 * 60 * 60_000, 'Root must persist a current private phase intent before execution.');
  await direct(pool, async c => {
    const database = (await c.query<{ database: string; username: string; address: string; port: number }>('SELECT current_database() AS database,current_user AS username,inet_server_addr()::text AS address,inet_server_port() AS port')).rows[0];
    assert.equal(database.database, 'wfc_pathfinder_local'); assert.equal(database.username, input.expectedDatabaseUser); assert.equal(database.address, input.expectedServerAddress); assert.equal(database.port, 5432);
    const project = (await c.query<{ project_number: string; name: string; model_id: string; state: string; health: string; manifest: Record<string, unknown> }>(`SELECT p.project_number,p.name,v.id AS model_id,v.state,v.health,a.manifest
      FROM projects p JOIN model_versions v ON v.project_id=p.id AND v.id=$2 JOIN pf_preparation_aggregates a ON a.project_id=p.id AND a.id=$3 AND a.model_version_id=v.id WHERE p.id=$1`, [PROJECT, MODEL, input.aggregateId])).rows[0];
    assert.ok(project); assert.equal(project.project_number, `PF-R3-UI-${PROJECT}`); assert.equal(project.name, project.project_number); assert.equal(project.model_id, MODEL); assert.equal(project.state, 'ready'); assert.equal(project.health, 'healthy');
    const manifest = project.manifest as { projectId: string; modelVersionId: string; id: string; projection: { sha256: string }; counts: { objects: number; physicalLeaves: number } };
    assert.equal(manifest.id, input.aggregateId); assert.equal(manifest.projectId, PROJECT); assert.equal(manifest.modelVersionId, MODEL); assert.equal(manifest.projection.sha256, input.expectedProjectionSha256); assert.equal(manifest.counts.objects, 13); assert.equal(manifest.counts.physicalLeaves, 6);
    const actor = (await c.query<{ email: string; is_admin: boolean; role: string }>('SELECT email,is_admin,role FROM users WHERE id=$1', [ACTOR])).rows[0];
    assert.deepEqual(actor, { email: EMAIL, is_admin: true, role: 'admin' });
    const trace = (await c.query<{ project_id: string; aggregate_id: string; model_version_id: string }>('SELECT project_id,aggregate_id,model_version_id FROM pf_geometry_trace_sets WHERE project_id=$1 AND id=$2', [PROJECT, input.traceId])).rows[0];
    assert.deepEqual(trace, { project_id: PROJECT, aggregate_id: input.aggregateId, model_version_id: MODEL });
  });
}
async function preservation(pool: Pool) {
  const row = (await pool.query<{ proof: unknown }>(`SELECT jsonb_build_object(
    'preparation',(SELECT to_jsonb(s) FROM pf_project_preparations s WHERE s.project_id=$1),
    'selection',(SELECT to_jsonb(s) FROM project_model_selections s WHERE s.project_id=$1),
    'policy',(SELECT to_jsonb(s) FROM pf_purpose_project_state s WHERE s.project_id=$1),
    'registry',(SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1),
    'artifacts',(SELECT count(*) FROM pf_artifacts WHERE project_id=$1),
    'aggregates',(SELECT count(*) FROM pf_preparation_aggregates WHERE project_id=$1),
    'applies',(SELECT count(*) FROM pf_apply_receipts WHERE project_id=$1),
    'traces',(SELECT count(*) FROM pf_geometry_trace_sets WHERE project_id=$1),
    'objects',(SELECT count(*) FROM pf_geometry_object_revisions WHERE project_id=$1),
    'receipts',(SELECT count(*) FROM pf_geometry_trace_receipts WHERE project_id=$1)
    ) AS proof`, [PROJECT])).rows[0];
  assert.ok(row); return sha(row.proof);
}
async function denied(operation: () => Promise<unknown>, code: string) {
  await assert.rejects(operation, error => (error as { code?: string }).code === code);
}
async function immutable(pool: Pool, input: GeometryTraceControlInput, kind: 'set' | 'object') {
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='5000ms'");
    const sql = kind === 'set' ? 'UPDATE pf_geometry_trace_sets SET manifest=manifest WHERE project_id=$1 AND id=$2' : 'UPDATE pf_geometry_object_revisions SET summary=summary WHERE project_id=$1 AND trace_id=$2';
    await assert.rejects(() => c.query(sql, [PROJECT, input.traceId]), error => (error as { code?: string }).code === 'P0001' && /Geometry trace proof is immutable/.test((error as Error).message));
  } finally { await rollbackAndRelease(c, 'Immutable-row probe rollback is unconfirmed.'); }
}
async function authProbe(pool: Pool, repository: GeometryTraceRepository, input: GeometryTraceControlInput) {
  const who = input.principal, login = (await pool.query<{ user_id: string; expires_at: Date; revoked_at: Date | null }>('SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings WHERE login_id=$1', [who.loginId])).rows[0];
  assert.ok(login); assert.equal(login.user_id, ACTOR); assert.equal(new Date(login.expires_at).getTime(), who.loginExpiresAt); assert.equal(login.revoked_at, null);
  if (input.phase === 'auth-expiry') {
    await denied(() => repository.get(PROJECT, { ...who, loginExpiresAt: Date.now() - 1000 }, input.traceId), 'LOGIN_EXPIRED'); return;
  }
  let attempted = false;
  try {
    attempted = true;
    await direct(pool, async c => {
      await c.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [PROJECT]);
      const actor = (await c.query<{ email: string; is_admin: boolean; role: string }>('SELECT email,is_admin,role FROM users WHERE id=$1 FOR UPDATE', [ACTOR])).rows[0]; assert.deepEqual(actor, { email: EMAIL, is_admin: true, role: 'admin' });
      const changed = input.phase === 'auth-role'
        ? await c.query('UPDATE users SET is_admin=false WHERE id=$1 AND email=$2 AND is_admin=true AND role=$3', [ACTOR, EMAIL, 'admin'])
        : await c.query('UPDATE viewer_login_bindings SET revoked_at=$4 WHERE login_id=$1 AND user_id=$2 AND expires_at=$3 AND revoked_at IS NULL', [who.loginId, ACTOR, new Date(who.loginExpiresAt), new Date(input.intentCreatedAt)]);
      assert.equal(changed.rowCount, 1);
    });
    await denied(() => repository.get(PROJECT, who, input.traceId), input.phase === 'auth-role' ? 'ADMIN_REQUIRED' : 'LOGIN_REVOKED');
  } finally {
    // Reconcile even a lost mutation COMMIT acknowledgement; restore only the exact
    // proven owned actor/login state, never another account or outside edit.
    if (attempted) await direct(pool, async c => {
      await c.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [PROJECT]);
      const actor = (await c.query<{ email: string; is_admin: boolean; role: string }>('SELECT email,is_admin,role FROM users WHERE id=$1 FOR UPDATE', [ACTOR])).rows[0];
      assert.ok(actor); assert.equal(actor.email, EMAIL); assert.equal(actor.role, 'admin');
      if (input.phase === 'auth-role') {
        if (actor.is_admin === false) assert.equal((await c.query('UPDATE users SET is_admin=true WHERE id=$1 AND email=$2 AND is_admin=false AND role=$3', [ACTOR, EMAIL, 'admin'])).rowCount, 1);
        else assert.equal(actor.is_admin, true);
      } else {
        assert.equal(actor.is_admin, true);
        const current = (await c.query<{ user_id: string; expires_at: Date; revoked_at: Date | null }>('SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings WHERE login_id=$1 FOR UPDATE', [who.loginId])).rows[0];
        assert.ok(current); assert.equal(current.user_id, ACTOR); assert.equal(new Date(current.expires_at).getTime(), who.loginExpiresAt);
        if (current.revoked_at !== null) {
          assert.equal(new Date(current.revoked_at).getTime(), Date.parse(input.intentCreatedAt));
          assert.equal((await c.query('UPDATE viewer_login_bindings SET revoked_at=NULL WHERE login_id=$1 AND user_id=$2 AND expires_at=$3 AND revoked_at=$4', [who.loginId, ACTOR, new Date(who.loginExpiresAt), new Date(input.intentCreatedAt)])).rowCount, 1);
        }
      }
    });
  }
  await repository.authorize(PROJECT, who);
}
async function blockedBy(observer: PoolClient, writerPid: number, holderPid: number) {
  const deadline = performance.now() + 1200;
  while (performance.now() < deadline) {
    const blockers = (await observer.query<{ blockers: number[] }>('SELECT pg_blocking_pids($1) AS blockers', [writerPid])).rows[0].blockers;
    if (blockers.includes(holderPid)) return;
    await delay(25);
  }
  assert.fail('The intended production transaction did not fence the competing owned edit.');
}
async function fence(pool: Pool, input: GeometryTraceControlInput) {
  const writer = await pool.connect(); let observer: PoolClient | undefined, release!: () => void, entered!: (pid: number) => void;
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<number>(r => { entered = r; });
  let primary: Promise<unknown> | undefined, mutation: Promise<unknown> | undefined;
  try {
    observer = await pool.connect();
    await writer.query('BEGIN'); await writer.query("SET LOCAL lock_timeout='4000ms';SET LOCAL statement_timeout='5000ms';SET LOCAL idle_in_transaction_session_timeout='12000ms'");
    const writerPid = (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    if (input.phase === 'fencing-timeout') {
      await writer.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [PROJECT]); const started = performance.now();
      await denied(() => geometryTraceTransaction(pool, PROJECT, input.principal, async () => assert.fail('Blocked admission callback must not run.')), 'GEOMETRY_TRACE_DATABASE_BUSY');
      assert.ok(performance.now() - started < GEOMETRY_TRACE_SQL_BOUNDS.lockMilliseconds + 2500); return;
    }
    primary = geometryTraceTransaction(pool, PROJECT, input.principal, async c => {
      assert.equal((await c.query('SELECT id FROM pf_geometry_trace_sets WHERE project_id=$1 AND id=$2 FOR SHARE', [PROJECT, input.traceId])).rows.length, 1);
      entered((await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid); await gate;
    });
    // Never leave an unhandled primary rejection while waiting for the observation.
    const holderPid = await Promise.race([ready, primary.then(() => { throw Error('Missing held transaction barrier.'); })]);
    mutation = input.phase === 'fencing-role'
      ? writer.query('UPDATE users SET is_admin=false WHERE id=$1 AND email=$2', [ACTOR, EMAIL])
      : (async () => { await writer.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [PROJECT]); return input.phase === 'fencing-selection'
        ? writer.query('UPDATE project_model_selections SET selection_revision=selection_revision+1 WHERE project_id=$1', [PROJECT])
        : writer.query('UPDATE pf_project_state SET registry_revision=registry_revision+1 WHERE project_id=$1', [PROJECT]); })();
    // Observe both promise paths immediately, then prove the exact PostgreSQL blocker.
    void mutation.catch(() => undefined); await blockedBy(observer, writerPid, holderPid); release(); await primary; await mutation;
  } finally {
    release?.(); await primary?.catch(() => undefined); await mutation?.catch(() => undefined);
    try { await rollbackAndRelease(writer, 'Competing edit rollback is unconfirmed.'); }
    finally { observer?.release(); }
  }
}

async function historyIndependence(pool: Pool, input: GeometryTraceControlInput, adapters?: GeometryTraceAdapters) {
  const client = await pool.connect(); let baseline: { active_model_version_id: string; revision: string } | undefined;
  try {
    await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='5000ms';SET LOCAL idle_in_transaction_session_timeout='12000ms'");
    await client.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [PROJECT]);
    assert.equal((await client.query<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id=$1 FOR SHARE', [ACTOR])).rows[0].is_admin, true);
    const login = (await client.query<{ user_id: string; revoked_at: Date | null }>('SELECT user_id,revoked_at FROM viewer_login_bindings WHERE login_id=$1 FOR SHARE', [input.principal.loginId])).rows[0]; assert.ok(login); assert.equal(login.user_id, ACTOR); assert.equal(login.revoked_at, null);
    baseline = (await client.query<{ active_model_version_id: string; revision: string }>('SELECT active_model_version_id,selection_revision::text AS revision FROM project_model_selections WHERE project_id=$1 FOR UPDATE', [PROJECT])).rows[0]; assert.ok(baseline); assert.equal(baseline.active_model_version_id, MODEL);
    assert.equal((await client.query('UPDATE project_model_selections SET active_model_version_id=NULL,selection_revision=selection_revision+1 WHERE project_id=$1', [PROJECT])).rowCount, 1);
    await client.query('UPDATE pf_purpose_project_state SET catalog_revision=catalog_revision+1,routing_policy_revision=routing_policy_revision+1 WHERE project_id=$1', [PROJECT]);
    await client.query('UPDATE pf_project_state SET registry_revision=registry_revision+1 WHERE project_id=$1', [PROJECT]);
    const facade = Object.create(client) as PoolClient;
    facade.query = (async (...args: unknown[]) => {
      const sql = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string } | undefined)?.text;
      if (sql === 'BEGIN') return client.query('SAVEPOINT geometry_trace_history_control');
      if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT geometry_trace_history_control');
      if (sql === 'ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT geometry_trace_history_control'); return client.query('RELEASE SAVEPOINT geometry_trace_history_control'); }
      return Reflect.apply(client.query, client, args) as unknown;
    }) as PoolClient['query'];
    facade.release = () => undefined;
    const repository = createGeometryTraceRepository({ connect: async () => facade } as Pool, adapters ?? {
      getRuntimeFingerprint: async () => { throw Error('Historical read unexpectedly requested an engine fingerprint.'); },
      exportFittedTrace: async () => { throw Error('Historical read unexpectedly invoked the engine.'); },
    });
    const manifest = await repository.get(PROJECT, input.principal, input.traceId); assert.equal(manifest.aggregateId, input.aggregateId); assert.equal(manifest.modelVersionId, MODEL);
    const history = await repository.list(PROJECT, input.principal, { aggregateId: input.aggregateId }); assert.ok(history.traces.some(t => t.id === input.traceId));
    const page = await repository.objects(PROJECT, input.principal, input.traceId, { limit: 1 }); assert.equal(page.objects.length, 1);
    const object = await repository.object(PROJECT, input.principal, input.traceId, page.objects[0].id); assert.equal(object.aggregateId, input.aggregateId); assert.equal(object.modelVersionId, MODEL);
  } finally { await rollbackAndRelease(client, 'Historical read context rollback is unconfirmed.'); }
  const after = (await pool.query<{ active_model_version_id: string; revision: string }>('SELECT active_model_version_id,selection_revision::text AS revision FROM project_model_selections WHERE project_id=$1', [PROJECT])).rows[0];
  assert.deepEqual(after, baseline, 'The alternate read context must leave no committed model switch or revision change.');
}

/** Independently callable phases fit the root operator's bounded transport. Never starts an engine or applies cables. */
export async function runGeometryTraceControlPhase(pool: Pool, repository: GeometryTraceRepository, raw: unknown, adapters?: GeometryTraceAdapters) {
  const input = inputSchema.parse(raw), started = performance.now(), checks: Check[] = [];
  await guardFixture(pool, input); await repository.authorize(PROJECT, input.principal); const before = await preservation(pool);
  const manifest = await repository.get(PROJECT, input.principal, input.traceId);
  assert.equal(manifest.aggregateId, input.aggregateId); assert.equal(manifest.modelVersionId, MODEL); assert.equal(manifest.projection.sha256, input.expectedProjectionSha256);
  if (input.phase === 'read') {
    assert.equal(manifest.counts.objects, 13); assert.equal(manifest.counts.segments, 6); assert.equal(manifest.qualifiedProjectFrame, null); assert.equal(manifest.engineeringAccepted, false); assert.equal(manifest.nativeParity, 'not-performed');
    const page = await repository.objects(PROJECT, input.principal, input.traceId, { offset: 0, limit: 50 }); assert.equal(page.total, 13); assert.equal(page.objects.length, 13); assert.equal(page.nextOffset, null); assert.equal(new Set(page.objects.map(o => o.id)).size, 13);
    for (const summary of page.objects) {
      const object = await repository.object(PROJECT, input.principal, input.traceId, summary.id); assert.equal(object.traceId, input.traceId); assert.equal(object.identity.objectId, summary.objectId); assert.equal(object.signatures.intrinsicShapeSha256, null); assert.equal(object.signatures.placementSha256, null); assert.equal(object.coordinates.qualifiedProjectFrame, null);
      if (object.geometry.fitted) { assert.equal(object.geometry.fitted.geometricLengthMetres, summary.geometricLengthMetres); assert.equal(Number(object.geometry.fitted.geometricLengthRoundTrip), summary.geometricLengthMetres); }
    }
    const history = await repository.list(PROJECT, input.principal, { aggregateId: input.aggregateId, modelVersionId: MODEL, limit: 50 }); assert.ok(history.traces.some(t => t.id === input.traceId));
    note(checks, 'bounded manifest/pages/object records/history retain exact source references and unknown engineering facts', 'actual repository/CSharp-derived immutable trace; no native/engineering acceptance');
  } else if (input.phase === 'refusal') {
    const replay = await repository.create(PROJECT, input.principal, input.command); assert.equal(replay.duplicate, true); assert.equal(replay.trace.id, input.traceId);
    await denied(() => repository.create(PROJECT, input.principal, { ...input.command, expectedProjectionSha256: input.expectedProjectionSha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64) }), 'GEOMETRY_TRACE_IDEMPOTENCY_CONFLICT');
    assert.ok(input.crossProjectId, 'Root must name an existing different isolated project for the tenant refusal.'); assert.equal((await pool.query('SELECT id FROM projects WHERE id=$1', [input.crossProjectId])).rows.length, 1);
    await denied(() => repository.get(input.crossProjectId!, input.principal, input.traceId), 'GEOMETRY_TRACE_NOT_FOUND');
    note(checks, 'exact command replay, same-key conflict and cross-project trace refusal', 'actual current-admin repository; original command only');
  } else if (input.phase === 'immutability') {
    await immutable(pool, input, 'set'); await immutable(pool, input, 'object'); note(checks, 'immutable trace and object row triggers reject UPDATE before any mutation', 'actual PostgreSQL; rollback only');
  } else if (input.phase === 'history-independence') {
    await historyIndependence(pool, input, adapters); note(checks, 'historical GET/list/object remain independent of alternate active model and routing/location revisions', 'actual repository SQL inside savepoint-backed rollback context; NOT trace publication or a committed model switch');
  } else if (input.phase.startsWith('auth-')) {
    await authProbe(pool, repository, input); note(checks, 'fresh administrator role/login/expiry enforcement with guarded owned-account restoration', 'actual repository current-authority refusal; exact retained UI actor only');
  } else {
    await fence(pool, input); note(checks, 'bounded production transaction lock/commit fence against rollback-only competing edit', 'geometryTraceTransaction primitive; NOT actual trace-publication concurrency');
  }
  assert.equal(await preservation(pool), before, 'Trace controls must preserve routing/drawing/geometry/registry tokens, artifacts, aggregates, Apply and prior proof counts.');
  assert.ok(performance.now() - started < 25000, 'Root operator phase budget exceeded.');
  return { schemaVersion: 'wfc.pf.geometry-trace-control-receipt.v1', phase: input.phase, phaseIntentId: input.phaseIntentId, recordedAtUtc: new Date().toISOString(), status: 'PASS', elapsedMilliseconds: performance.now() - started, checks, preservationSha256: before, appEngineStarted: false, cableApply: 'NOT_PERFORMED', nativeParity: 'NOT_PERFORMED', engineeringAcceptance: false };
}
