/** Root-only PostgreSQL mechanics controls. Importing this module never opens a connection. */
import assert from 'node:assert/strict';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { policyHashSchema, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { revisionComparisonManifestSchema, revisionComparisonDecisionSchema, type RevisionComparisonManifest } from '../../shared/pathfinderRevisionComparison.js';
import { readComparisonDependency, requireCurrentComparisonScope, revisionComparisonTransaction, REVISION_COMPARISON_SQL_BOUNDS } from './revisionComparisonRepository.js';
import { revisionComparisonHash } from './revisionComparisonPublisher.js';

const PROJECT = '56eadef6-8382-49f8-a652-c8f12026602e', MODEL = '098a7e6f-6e39-4935-a98b-ba3b683875a5', ACTOR = '9ac1ea26-8bee-4719-87c5-1693df5682b4';
const EMAIL = `${ACTOR}@pf-r3-ui.invalid`;
const phases = ['read-ready', 'pending', 'decision-integrity', 'other-target', 'immutable', 'foreign-key', 'auth-admin', 'auth-login', 'auth-expiry', 'abort', 'commit-unknown', 'fencing-role', 'fencing-login', 'fencing-target', 'fencing-timeout'] as const;
export const revisionComparisonControlInputSchema = z.object({
  schemaVersion: z.literal('wfc.pf.revision-comparison-control.v1'), phase: z.enum(phases), phaseIntentId: policyUuidSchema, intentCreatedAt: z.string().datetime(),
  projectId: z.literal(PROJECT), actorEmail: z.literal(EMAIL), expectedActiveModelVersionId: z.literal(MODEL),
  principal: z.object({ userId: z.literal(ACTOR), loginId: policyUuidSchema, loginExpiresAt: z.number().int().positive() }).strict(),
  expectedDatabaseUser: z.literal('pf_local'), expectedServerAddress: z.string().min(1).max(64).refine(value => { const parts = value.split('/'), family = isIP(parts[0]); return parts.length <= 2 && family !== 0 && (parts.length === 1 || parts[1] === (family === 4 ? '32' : '128')); }),
  comparisonId: policyUuidSchema, expectedContentSha256: policyHashSchema,
  ownedIds: z.object({ pendingIntentId: policyUuidSchema, decisionId: policyUuidSchema, commandKey: policyUuidSchema }).strict(),
}).strict().superRefine((v, c) => { const ids = [v.phaseIntentId, v.comparisonId, v.principal.loginId, ...Object.values(v.ownedIds)]; if (new Set(ids).size !== ids.length || ids.includes(PROJECT) || ids.includes(MODEL) || ids.includes(ACTOR)) c.addIssue({ code: 'custom', message: 'Each control must have distinct host-owned identities, separate from the retained fixture.' }); });
export type RevisionComparisonControlInput = z.infer<typeof revisionComparisonControlInputSchema>;
type Check = { name: string; status: 'PASS'; scope: string };
const note = (checks: Check[], name: string, scope: string) => checks.push({ name, status: 'PASS', scope });
const code = (error: unknown) => (error as { code?: string })?.code;
const denied = (fn: () => Promise<unknown>, expected: string) => assert.rejects(fn, e => code(e) === expected);

/** No uncertain cleanup is converted into a PASS; the broken connection is discarded. */
export async function rollbackRevisionComparisonControl(client: PoolClient): Promise<void> {
  let discard = false;
  try { await client.query('ROLLBACK'); }
  catch (error) { discard = true; throw new Error('Owned revision comparison control rollback is unconfirmed.', { cause: error }); }
  finally { client.release(discard ? true : undefined); }
}
async function rollbackOnly<T>(pool: Pool, operation: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('BEGIN'); await c.query("SET LOCAL lock_timeout='3500ms';SET LOCAL statement_timeout='5000ms';SET LOCAL idle_in_transaction_session_timeout='12000ms'"); return await operation(c); }
  finally { await rollbackRevisionComparisonControl(c); }
}
async function pgRefusal(c: PoolClient, operation: () => Promise<unknown>, expected: string): Promise<void> {
  await c.query('SAVEPOINT revision_control_refusal');
  try { await denied(operation, expected); }
  finally { await c.query('ROLLBACK TO SAVEPOINT revision_control_refusal'); await c.query('RELEASE SAVEPOINT revision_control_refusal'); }
}
const tables = ['pf_revision_comparison_state', 'pf_revision_comparison_targets', 'pf_revision_comparison_intents', 'pf_revision_comparison_sets', 'pf_revision_comparison_changes', 'pf_revision_comparison_decisions', 'pf_revision_comparison_decision_heads', 'pf_revision_comparison_decision_objects', 'pf_revision_comparison_commands', 'pf_revision_binding_frame_qualifications'] as const;
async function preservation(pool: Pool, input: RevisionComparisonControlInput): Promise<string> {
  const select = tables.map(table => `'${table}',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM ${table} r WHERE project_id=$1)`);
  const row = (await pool.query<{ proof: unknown }>(`SELECT jsonb_build_object(${select.join(',')},
    'project',(SELECT to_jsonb(r) FROM projects r WHERE id=$1),
    'selection',(SELECT to_jsonb(r) FROM project_model_selections r WHERE project_id=$1),
    'preparation',(SELECT to_jsonb(r) FROM pf_project_preparations r WHERE project_id=$1),
    'policy',(SELECT to_jsonb(r) FROM pf_purpose_project_state r WHERE project_id=$1),
    'actor',(SELECT to_jsonb(r) FROM users r WHERE id=$2),
    'login',(SELECT to_jsonb(r) FROM viewer_login_bindings r WHERE login_id=$3),
    'cables',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM cables r WHERE project_id=$1),
    'bindings',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM pf_endpoint_binding_revisions r WHERE project_id=$1),
    'applies',(SELECT count(*) FROM pf_apply_receipts WHERE project_id=$1)) AS proof`, [PROJECT, ACTOR, input.principal.loginId])).rows[0];
  assert.ok(row); return revisionComparisonHash(row.proof);
}
async function guard(pool: Pool, input: RevisionComparisonControlInput): Promise<RevisionComparisonManifest> {
  assert.ok(pool.options.max !== undefined && pool.options.max >= 3 && pool.options.max <= 6);
  assert.ok(pool.options.connectionTimeoutMillis !== undefined && pool.options.connectionTimeoutMillis > 0 && pool.options.connectionTimeoutMillis <= 5000);
  assert.ok(pool.options.query_timeout !== undefined && pool.options.query_timeout > 0 && pool.options.query_timeout <= 6000);
  assert.ok(input.principal.loginExpiresAt > Date.now() + 60000);
  assert.ok(Math.abs(Date.now() - Date.parse(input.intentCreatedAt)) < 24 * 60 * 60_000);
  return rollbackOnly(pool, async c => {
    const db = (await c.query('SELECT current_database() AS database,current_user AS username,inet_server_addr()::text AS address,inet_server_port() AS port')).rows[0];
    assert.deepEqual(db, { database: 'wfc_pathfinder_local', username: input.expectedDatabaseUser, address: input.expectedServerAddress, port: 5432 });
    assert.deepEqual((await c.query('SELECT project_number,name FROM projects WHERE id=$1', [PROJECT])).rows[0], { project_number: `PF-R3-UI-${PROJECT}`, name: `PF-R3-UI-${PROJECT}` });
    assert.deepEqual((await c.query('SELECT email,is_admin,role FROM users WHERE id=$1', [ACTOR])).rows[0], { email: EMAIL, is_admin: true, role: 'admin' });
    const login = (await c.query<{ user_id: string; expires_at: Date; revoked_at: Date | null }>('SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings WHERE login_id=$1', [input.principal.loginId])).rows[0]; assert.ok(login); assert.equal(login.user_id, ACTOR); assert.equal(login.revoked_at, null); assert.equal(new Date(login.expires_at).getTime(), input.principal.loginExpiresAt);
    assert.equal((await c.query('SELECT active_model_version_id FROM project_model_selections WHERE project_id=$1', [PROJECT])).rows[0]?.active_model_version_id, MODEL);
    const record = (await c.query<{ manifest: unknown }>('SELECT manifest FROM pf_revision_comparison_sets WHERE project_id=$1 AND id=$2', [PROJECT, input.comparisonId])).rows[0]; assert.ok(record);
    const m = revisionComparisonManifestSchema.parse(record.manifest), { contentSha256, ...body } = m;
    assert.equal(m.projectId, PROJECT); assert.equal(m.id, input.comparisonId); assert.equal(contentSha256, input.expectedContentSha256); assert.equal(revisionComparisonHash(body), contentSha256); assert.equal(m.engineeringAccepted, false); assert.notEqual(m.source.aggregateId, m.target.aggregateId); assert.ok(m.counts.sourceObjects > 0 && m.counts.targetObjects > 0 && m.counts.changes > 0);
    const retained = new Set([m.source.aggregateId, m.target.aggregateId, m.source.modelVersionId, m.target.modelVersionId, m.source.traceId, m.target.traceId, m.source.captureFrameId, m.target.captureFrameId]); assert.ok(Object.values(input.ownedIds).every(value => !retained.has(value)));
    for (const side of [m.source, m.target]) assert.equal((await c.query('SELECT id FROM model_versions WHERE project_id=$1 AND id=$2', [PROJECT, side.modelVersionId])).rows.length, 1);
    assert.equal((await c.query('SELECT id FROM pf_revision_comparison_intents WHERE id=ANY($1::uuid[])', [Object.values(input.ownedIds)])).rows.length, 0);
    assert.equal((await c.query('SELECT id FROM pf_revision_comparison_decisions WHERE id=$1', [input.ownedIds.decisionId])).rows.length, 0);
    assert.equal((await c.query('SELECT 1 FROM pf_revision_comparison_commands WHERE project_id=$1 AND idempotency_key=$2', [PROJECT, input.ownedIds.commandKey])).rows.length, 0);
    return m;
  });
}
const dependencyInput = (m: RevisionComparisonManifest) => ({ projectId: PROJECT, currentAggregateId: m.target.aggregateId, currentModelVersionId: m.target.modelVersionId });
async function locked(c: PoolClient, input: RevisionComparisonControlInput): Promise<void> {
  assert.equal((await c.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [PROJECT])).rows.length, 1);
  assert.deepEqual((await c.query('SELECT email,is_admin FROM users WHERE id=$1 FOR SHARE', [ACTOR])).rows[0], { email: EMAIL, is_admin: true });
  const login = (await c.query<{ user_id: string; expires_at: Date; revoked_at: Date | null }>('SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings WHERE login_id=$1 FOR SHARE', [input.principal.loginId])).rows[0]; assert.ok(login); assert.equal(login.user_id, ACTOR); assert.equal(login.revoked_at, null); assert.equal(new Date(login.expires_at).getTime(), input.principal.loginExpiresAt); assert.ok(input.principal.loginExpiresAt > Date.now());
}
async function insertPending(c: PoolClient, input: RevisionComparisonControlInput, m: RevisionComparisonManifest, wrongTrace = false): Promise<void> {
  const marker = { schemaVersion: 'wfc.pf.revision-control-synthetic.v1', phaseIntentId: input.phaseIntentId, phase: input.phase, scope: 'rollback-only SQL mechanics, not production publication' };
  // Explicit rollback-only order avoids PostgreSQL's nontransactional identity-sequence advancement.
  assert.equal((await c.query(`INSERT INTO pf_revision_comparison_intents(id,admission_order,project_id,source_aggregate_id,target_aggregate_id,source_trace_id,target_trace_id,target_model_version_id,actor_id,idempotency_key,input_sha256,request,frozen,state,lease_token,lease_expires_at) OVERRIDING SYSTEM VALUE
    VALUES($1,(SELECT COALESCE(MAX(admission_order),0)+1 FROM pf_revision_comparison_intents WHERE project_id=$2),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,'pending',$12,$13)`, [input.ownedIds.pendingIntentId, PROJECT, m.source.aggregateId, m.target.aggregateId, wrongTrace ? m.target.traceId : m.source.traceId, m.target.traceId, m.target.modelVersionId, ACTOR, input.ownedIds.commandKey, revisionComparisonHash(marker), marker, input.phaseIntentId, new Date(Date.now() + 60000)])).rowCount, 1);
}
async function insertSyntheticDecision(c: PoolClient, input: RevisionComparisonControlInput, m: RevisionComparisonManifest) {
  const source = (await c.query<{ id: string }>('SELECT id FROM pf_geometry_object_revisions WHERE project_id=$1 AND trace_id=$2 ORDER BY id LIMIT 1', [PROJECT, m.source.traceId])).rows[0];
  const target = (await c.query<{ id: string }>('SELECT id FROM pf_geometry_object_revisions WHERE project_id=$1 AND trace_id=$2 ORDER BY id LIMIT 1', [PROJECT, m.target.traceId])).rows[0]; assert.ok(source && target);
  const subjectKey = 'control:' + input.phaseIntentId;
  const draft = revisionComparisonDecisionSchema.parse({ schemaVersion: 'wfc.pf.revision-comparison-decision.v1', id: input.ownedIds.decisionId, projectId: PROJECT, comparisonId: m.id, comparisonRevision: '1', subjectKey, decisionRevision: '1', previousDecisionId: null, createdBy: ACTOR, createdAt: input.intentCreatedAt, reason: 'PF-R6 rollback-only synthetic SQL mechanics; not a reviewed physical association.', contentSha256: '0'.repeat(64), kind: 'object-mapping', qualification: 'admin-reviewed-correspondence', body: { sourceObjectRevisionIds: [source.id], targetObjectRevisionIds: [target.id], disposition: 'unique', evidenceText: 'Synthetic constraint fixture, rolled back; no engineering identity assertion.' } });
  const { contentSha256: _hash, ...body } = draft, record = { ...draft, contentSha256: revisionComparisonHash(body) };
  assert.equal((await c.query('INSERT INTO pf_revision_comparison_decisions(id,project_id,comparison_id,subject_key,kind,decision_revision,comparison_revision,record_sha256,record) VALUES($1,$2,$3,$4,$5,1,1,$6,$7)', [record.id, PROJECT, m.id, subjectKey, record.kind, record.contentSha256, record])).rowCount, 1);
  return { source, target, record };
}
function outerTransactionPool(client: PoolClient): Pool {
  const proxy = Object.create(client) as PoolClient;
  proxy.query = (async (...args: unknown[]) => {
    const sql = typeof args[0] === 'string' ? args[0] : (args[0] as { text?: string } | undefined)?.text;
    if (sql === 'BEGIN') return client.query('SAVEPOINT revision_control_authority');
    if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT revision_control_authority');
    if (sql === 'ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT revision_control_authority'); return client.query('RELEASE SAVEPOINT revision_control_authority'); }
    return Reflect.apply(client.query, client, args) as unknown;
  }) as PoolClient['query'];
  proxy.release = () => undefined;
  return { connect: async () => proxy } as unknown as Pool;
}
async function fence(pool: Pool, input: RevisionComparisonControlInput, m: RevisionComparisonManifest): Promise<void> {
  const writer = await pool.connect(); let observer: PoolClient | undefined, primary: Promise<unknown> | undefined, mutation: Promise<unknown> | undefined, release!: () => void, entered!: (pid: number) => void;
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<number>(r => { entered = r; });
  try {
    observer = await pool.connect(); await writer.query('BEGIN'); await writer.query("SET LOCAL lock_timeout='4000ms';SET LOCAL statement_timeout='5000ms';SET LOCAL idle_in_transaction_session_timeout='12000ms'");
    if (input.phase === 'fencing-timeout') { await writer.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [PROJECT]); const at = performance.now(); await denied(() => revisionComparisonTransaction(pool, PROJECT, input.principal, async () => assert.fail('Blocked callback must not run.')), 'REVISION_COMPARISON_DATABASE_BUSY'); assert.ok(performance.now() - at < REVISION_COMPARISON_SQL_BOUNDS.lockMilliseconds + 2500); return; }
    primary = revisionComparisonTransaction(pool, PROJECT, input.principal, async c => { assert.equal((await readComparisonDependency(c, dependencyInput(m))).readiness, 'ready'); entered((await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid); await gate; });
    const holderPid = await Promise.race([ready, primary.then(() => { throw Error('Production transaction never entered the held barrier.'); })]);
    const writerPid = (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    mutation = input.phase === 'fencing-role' ? writer.query('UPDATE users SET is_admin=is_admin WHERE id=$1 AND email=$2', [ACTOR, EMAIL]) : input.phase === 'fencing-login' ? writer.query('UPDATE viewer_login_bindings SET expires_at=expires_at WHERE login_id=$1 AND user_id=$2', [input.principal.loginId, ACTOR]) : writer.query('UPDATE pf_revision_comparison_targets SET comparison_revision=comparison_revision WHERE project_id=$1 AND target_aggregate_id=$2 AND target_model_version_id=$3', [PROJECT, m.target.aggregateId, m.target.modelVersionId]);
    void mutation.catch(() => undefined);
    const until = performance.now() + 1500; let observed = false;
    while (performance.now() < until) { const row = (await observer.query<{ blockers: number[] }>('SELECT pg_blocking_pids($1) AS blockers', [writerPid])).rows[0]; if (row.blockers.includes(holderPid)) { observed = true; break; } await delay(25); }
    assert.ok(observed, 'The exact production transaction must block the owned competing row edit.'); release(); await primary; await mutation;
  } finally { release(); await primary?.catch(() => undefined); await mutation?.catch(() => undefined); try { await rollbackRevisionComparisonControl(writer); } finally { observer?.release(); } }
}

/** Independent phases are bounded and never invoke a producer, Apply, HTTP, model selection or file storage. */
export async function runRevisionComparisonControl(pool: Pool, raw: unknown) {
  const input = revisionComparisonControlInputSchema.parse(raw), started = performance.now(), checks: Check[] = [], m = await guard(pool, input);
  const before = await preservation(pool, input);
  if (input.phase === 'read-ready') {
    await revisionComparisonTransaction(pool, PROJECT, input.principal, async c => { const value = await requireCurrentComparisonScope(c, { projectId: PROJECT, targetAggregateId: m.target.aggregateId, targetModelVersionId: m.target.modelVersionId }); assert.equal(value.readiness, 'ready'); assert.equal(value.scope?.comparisonId, m.id); assert.equal(value.scope?.contentSha256, m.contentSha256); assert.equal(value.scope?.sourceAggregateId, m.source.aggregateId); await denied(() => requireCurrentComparisonScope(c, { projectId: PROJECT, targetAggregateId: m.target.aggregateId, targetModelVersionId: m.target.modelVersionId, expected: null }), 'REVISION_COMPARISON_SCOPE_CHANGED'); });
    note(checks, 'Current target comparison scope is readable under current authority', 'actual production transaction and caller-client reader; existing normal comparison only');
  } else if (input.phase === 'pending') {
    await rollbackOnly(pool, async c => { await locked(c, input); await insertPending(c, input, m); const value = await readComparisonDependency(c, dependencyInput(m)); assert.equal(value.applicability, 'required'); assert.equal(value.readiness, 'pending'); assert.equal(value.scope, null); await denied(() => requireCurrentComparisonScope(c, { projectId: PROJECT, targetAggregateId: m.target.aggregateId, targetModelVersionId: m.target.modelVersionId }), 'REVISION_COMPARISON_PENDING'); });
    note(checks, 'A later pending intent cannot be represented by comparison:null not-required authority', 'actual rollback-only synthetic intent and production dependency reader; no producer publication');
  } else if (input.phase === 'decision-integrity') {
    await rollbackOnly(pool, async c => { await locked(c, input); const before = await readComparisonDependency(c, dependencyInput(m)); assert.equal(before.readiness, 'ready'); const forged = before.scope!.decisionSetSha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64); assert.equal((await c.query('UPDATE pf_revision_comparison_targets SET decision_set_sha256=$4 WHERE project_id=$1 AND target_aggregate_id=$2 AND target_model_version_id=$3', [PROJECT, m.target.aggregateId, m.target.modelVersionId, forged])).rowCount, 1); await denied(() => readComparisonDependency(c, dependencyInput(m)), 'REVISION_COMPARISON_DECISION_SET_INTEGRITY'); });
    note(checks, 'A target head cannot claim a foreign decision-set hash', 'actual rollback-only SQL corruption probe and fail-closed reader');
  } else if (input.phase === 'other-target') {
    await rollbackOnly(pool, async c => { await locked(c, input); const original = await readComparisonDependency(c, dependencyInput(m)); assert.equal(original.readiness, 'ready'); await c.query('INSERT INTO pf_revision_comparison_targets(project_id,target_aggregate_id,target_model_version_id,decision_set_sha256) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [PROJECT, m.source.aggregateId, m.source.modelVersionId, revisionComparisonHash([])]); await c.query('UPDATE pf_revision_comparison_targets SET comparison_revision=comparison_revision+1 WHERE project_id=$1 AND target_aggregate_id=$2 AND target_model_version_id=$3', [PROJECT, m.source.aggregateId, m.source.modelVersionId]); await c.query('UPDATE pf_revision_comparison_state SET comparison_revision=comparison_revision+1 WHERE project_id=$1', [PROJECT]); assert.deepEqual(await readComparisonDependency(c, dependencyInput(m)), original); });
    note(checks, 'An unrelated historical target/global author token does not stale this target scope', 'actual rollback-only unrelated target mechanics; all original heads preserved');
  } else if (input.phase === 'immutable') {
    await rollbackOnly(pool, async c => { await locked(c, input); await pgRefusal(c, () => c.query('UPDATE pf_revision_comparison_sets SET manifest=manifest WHERE project_id=$1 AND id=$2', [PROJECT, m.id]), 'P0001'); await pgRefusal(c, () => c.query('UPDATE pf_revision_comparison_changes SET record=record WHERE project_id=$1 AND comparison_id=$2 AND row_index=0', [PROJECT, m.id]), 'P0001'); await insertPending(c, input, m); await pgRefusal(c, () => c.query('UPDATE pf_revision_comparison_intents SET frozen=$3 WHERE project_id=$1 AND id=$2', [PROJECT, input.ownedIds.pendingIntentId, { forbidden: input.phaseIntentId }]), 'P0001'); await pgRefusal(c, () => c.query('DELETE FROM pf_revision_comparison_intents WHERE project_id=$1 AND id=$2', [PROJECT, input.ownedIds.pendingIntentId]), 'P0001'); await insertSyntheticDecision(c, input, m); await pgRefusal(c, () => c.query('UPDATE pf_revision_comparison_decisions SET record=record WHERE project_id=$1 AND id=$2', [PROJECT, input.ownedIds.decisionId]), 'P0001'); const marker = { control: input.phaseIntentId }; await c.query("INSERT INTO pf_revision_comparison_commands(project_id,actor_id,idempotency_key,kind,request_sha256,request,receipt) VALUES($1,$2,$3,'decision',$4,$5,$5)", [PROJECT, ACTOR, input.ownedIds.commandKey, revisionComparisonHash(marker), marker]); await pgRefusal(c, () => c.query('DELETE FROM pf_revision_comparison_commands WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [PROJECT, ACTOR, input.ownedIds.commandKey]), 'P0001'); });
    note(checks, 'Comparison, row, intent, decision and command evidence refuse rewriting/deletion', 'actual trigger probes; synthetic decision/intent/command exist only inside confirmed rollback; qualification sidecar not claimed');
  } else if (input.phase === 'foreign-key') {
    await rollbackOnly(pool, async c => { await locked(c, input); await pgRefusal(c, () => insertPending(c, input, m, true), '23503'); const fixture = await insertSyntheticDecision(c, input, m); await pgRefusal(c, () => c.query("INSERT INTO pf_revision_comparison_decision_objects(project_id,decision_id,side,trace_id,object_revision_id,member_index) VALUES($1,$2,'source',$3,$4,0)", [PROJECT, fixture.record.id, m.source.traceId, fixture.target.id]), '23503'); await pgRefusal(c, () => c.query("INSERT INTO pf_revision_comparison_decision_objects(project_id,decision_id,side,trace_id,object_revision_id,member_index) VALUES($1,$2,'source',$3,$4,0)", [PROJECT, fixture.record.id, m.target.traceId, fixture.target.id]), 'P0001'); await pgRefusal(c, () => c.query('INSERT INTO pf_revision_comparison_decision_heads(project_id,comparison_id,subject_key,decision_id) VALUES($1,$2,$3,$4)', [PROJECT, m.id, 'foreign:' + input.phaseIntentId, fixture.record.id]), '23503'); });
    note(checks, 'Exact trace/aggregate, trace/object and decision/subject composite references reject forged pairs', 'actual rollback-only PostgreSQL foreign-key probes; no new object relation retained');
  } else if (input.phase === 'auth-admin' || input.phase === 'auth-login') {
    await rollbackOnly(pool, async c => { await locked(c, input); if (input.phase === 'auth-admin') assert.equal((await c.query('UPDATE users SET is_admin=false WHERE id=$1 AND email=$2', [ACTOR, EMAIL])).rowCount, 1); else assert.equal((await c.query('UPDATE viewer_login_bindings SET revoked_at=$3 WHERE login_id=$1 AND user_id=$2', [input.principal.loginId, ACTOR, new Date(input.intentCreatedAt)])).rowCount, 1); await denied(() => revisionComparisonTransaction(outerTransactionPool(c), PROJECT, input.principal, async () => assert.fail('Revoked-authority callback must not execute.')), input.phase === 'auth-admin' ? 'ADMIN_REQUIRED' : 'LOGIN_REVOKED'); });
    note(checks, 'Production authority checks reject the current revoked role/login', 'actual same-client savepoint context with rollback-only demotion/revocation; no committed role change or full HTTP race claim');
  } else if (input.phase === 'auth-expiry') {
    await denied(() => revisionComparisonTransaction(pool, PROJECT, { ...input.principal, loginExpiresAt: Date.now() - 1 }, async () => assert.fail('Expired-authority callback must not execute.')), 'LOGIN_EXPIRED'); note(checks, 'Expired signed-principal lifetime refuses admission', 'production transaction guard; no login mutation');
  } else if (input.phase === 'abort') {
    const controller = new AbortController(); let callback = false; await assert.rejects(() => revisionComparisonTransaction(pool, PROJECT, input.principal, async c => { callback = true; await readComparisonDependency(c, dependencyInput(m)); controller.abort(); }, controller.signal), e => (e as Error).name === 'AbortError'); assert.equal(callback, true); note(checks, 'Cancellation after real locked reads rolls the production transaction back', 'actual PostgreSQL transaction primitive; no publication callback or business write');
  } else if (input.phase === 'commit-unknown') {
    let committed = false, discarded = false, callback = false;
    const proxyPool = { connect: async () => { const c = await pool.connect(), proxy = Object.create(c) as PoolClient; proxy.query = (async (...args: unknown[]) => { const result = await Reflect.apply(c.query, c, args); if (args[0] === 'COMMIT') { committed = true; throw Error('Injected lost acknowledgement after an actual read-only COMMIT.'); } return result; }) as PoolClient['query']; proxy.release = (error?: Error | boolean) => { discarded = error === true; c.release(error); }; return proxy; } } as unknown as Pool;
    await denied(() => revisionComparisonTransaction(proxyPool, PROJECT, input.principal, async c => { callback = true; assert.equal((await readComparisonDependency(c, dependencyInput(m))).readiness, 'ready'); }), 'REVISION_COMPARISON_COMMIT_OUTCOME_UNKNOWN'); assert.ok(committed && discarded && callback); note(checks, 'Lost read-only COMMIT acknowledgement remains unknown and discards its connection', 'fault-injected transport after actual PostgreSQL COMMIT; not a full comparison publication failure/recovery claim');
  } else { await fence(pool, input, m); note(checks, 'Production project/role/login/target locks fence competing edits or time out', 'actual pg_blocking_pids with the exact transaction holder; competing edit always rolls back; primitive-only proof'); }
  assert.equal(await preservation(pool, input), before, 'All retained state, roles, login and cable values must remain exactly unchanged.');
  assert.ok(performance.now() - started < 25000, 'A single phase exceeded the bounded operator profile.');
  return { schemaVersion: 'wfc.pf.revision-comparison-control-receipt.v1', status: 'PASS', phase: input.phase, phaseIntentId: input.phaseIntentId, checks, beforeSha256: before, afterSha256: before, elapsedMilliseconds: Math.round(performance.now() - started), engineeringAccepted: false, productionComparisonPublicationTested: false, automaticApplyPerformed: false };
}
export const revisionComparisonControlFixture = Object.freeze({ projectId: PROJECT, activeModelVersionId: MODEL, actorId: ACTOR, actorEmail: EMAIL, phases });
