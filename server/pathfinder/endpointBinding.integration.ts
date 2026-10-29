/** Root-only actual controls. Importing this module never connects, seeds or executes a phase. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { endpointBindingWriteSchema } from '../../shared/pathfinderEndpointBindings.js';
import { createEndpointBindingRepository, endpointBindingTransaction, readCurrentEndpointBindingContext, endpointBindingHash } from './endpointBindingRepository.js';

const PROJECT = '56eadef6-8382-49f8-a652-c8f12026602e', MODEL = '098a7e6f-6e39-4935-a98b-ba3b683875a5', ACTOR = '9ac1ea26-8bee-4719-87c5-1693df5682b4';
const EMAIL = `${ACTOR}@pf-r3-ui.invalid`;
const phases = ['confirm', 'replay', 'no-op', 'conflict', 'old-key', 'usage', 'legacy', 'immutable', 'fk', 'rollback', 'auth-expiry', 'fencing-role', 'fencing-selection', 'fencing-registry', 'fencing-timeout', 'migration-refusal'] as const;
export const endpointBindingControlInputSchema = z.object({
  schemaVersion: z.literal('wfc.pf.endpoint-control-input.v1'), phase: z.enum(phases), phaseIntentId: policyUuidSchema, intentCreatedAt: z.string().datetime(),
  projectId: z.literal(PROJECT), modelVersionId: z.literal(MODEL), actorEmail: z.literal(EMAIL),
  principal: z.object({ userId: z.literal(ACTOR), loginId: policyUuidSchema, loginExpiresAt: z.number().int().positive() }).strict(),
  expectedDatabaseUser: z.literal('pf_local'), expectedServerAddress: z.string().min(1).max(64),
  ownedLocations: z.object({ a: policyUuidSchema, b: policyUuidSchema, legacy: policyUuidSchema }).strict(), locationId: policyUuidSchema,
  cableIds: z.array(policyUuidSchema).length(3), command: endpointBindingWriteSchema, previousCommand: endpointBindingWriteSchema.nullable(),
  migrationIdempotencyKey: policyUuidSchema.optional(), migrationConfirmIdempotencyKey: policyUuidSchema.optional(),
}).strict().superRefine((v, ctx) => {
  const ids = Object.values(v.ownedLocations); if (new Set(ids).size !== 3 || !ids.includes(v.locationId) || new Set(v.cableIds).size !== 3 || v.command.modelVersionId !== MODEL || v.previousCommand && v.previousCommand.modelVersionId !== MODEL) ctx.addIssue({ code: 'custom', message: 'Only the explicit owned fixture identities are allowed.' });
  const name = v.locationId === v.ownedLocations.a ? 'PF-R5-A' : v.locationId === v.ownedLocations.b ? 'PF-R5-B' : 'PF-R5-LEGACY';
  const ownedName = (command: { location: { name: string; aliases: string[] } }) => command.location.name === name && command.location.aliases.every(a => a === 'PF-R5-A-ALIAS') && (name === 'PF-R5-A' || command.location.aliases.length === 0);
  if (!ownedName(v.command) || v.previousCommand && !ownedName(v.previousCommand) || v.phase === 'old-key' && !v.previousCommand || v.phase === 'legacy' && (v.locationId !== v.ownedLocations.legacy || v.command.expectedHeadId !== null) || v.phase === 'migration-refusal' && (!v.migrationIdempotencyKey || !v.migrationConfirmIdempotencyKey)) ctx.addIssue({ code: 'custom', message: 'Fixture commands must retain the exact generated namespace.' });
});
export type EndpointBindingControlInput = z.infer<typeof endpointBindingControlInputSchema>;
type Check = { name: string; status: 'PASS'; scope: string };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const note = (checks: Check[], name: string, scope: string) => checks.push({ name, status: 'PASS', scope });
async function direct<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>, rollbackOnly = false): Promise<T> {
  const c = await pool.connect(); let commitStarted = false, discard = false;
  try { await c.query('BEGIN'); await c.query("SET LOCAL lock_timeout='3500ms';SET LOCAL statement_timeout='5000ms';SET LOCAL idle_in_transaction_session_timeout='12000ms'"); const value = await operation(c); if (rollbackOnly) await c.query('ROLLBACK'); else { commitStarted = true; await c.query('COMMIT'); } return value; }
  catch (error) { discard = commitStarted; try { await c.query('ROLLBACK'); } catch { discard = true; } throw error; } finally { c.release(discard ? true : undefined); }
}
async function guard(pool: Pool, input: EndpointBindingControlInput): Promise<void> {
  assert.ok(pool.options.max !== undefined && pool.options.max >= 3 && pool.options.max <= 6); assert.ok(pool.options.connectionTimeoutMillis !== undefined && pool.options.connectionTimeoutMillis > 0 && pool.options.connectionTimeoutMillis <= 5000); assert.ok(pool.options.query_timeout !== undefined && pool.options.query_timeout > 0 && pool.options.query_timeout <= 6000);
  assert.ok(input.principal.loginExpiresAt > Date.now() + 60000); assert.ok(Math.abs(Date.now() - Date.parse(input.intentCreatedAt)) < 24 * 60 * 60_000);
  await direct(pool, async c => {
    const database = (await c.query<{ database: string; username: string; address: string; port: number }>('SELECT current_database() AS database,current_user AS username,inet_server_addr()::text AS address,inet_server_port() AS port')).rows[0]; assert.deepEqual(database, { database: 'wfc_pathfinder_local', username: input.expectedDatabaseUser, address: input.expectedServerAddress, port: 5432 });
    const project = (await c.query<{ project_number: string; name: string; model_id: string; state: string; health: string }>('SELECT p.project_number,p.name,v.id AS model_id,v.state,v.health FROM projects p JOIN model_versions v ON v.project_id=p.id AND v.id=$2 WHERE p.id=$1', [PROJECT, MODEL])).rows[0]; assert.deepEqual(project, { project_number: `PF-R3-UI-${PROJECT}`, name: `PF-R3-UI-${PROJECT}`, model_id: MODEL, state: 'ready', health: 'healthy' });
    assert.deepEqual((await c.query('SELECT email,is_admin,role FROM users WHERE id=$1', [ACTOR])).rows[0], { email: EMAIL, is_admin: true, role: 'admin' });
    const current = await readCurrentEndpointBindingContext(c, PROJECT); assert.ok(current); assert.equal(current.modelVersionId, MODEL); assert.equal(current.aggregateId, input.command.aggregateId); assert.equal(current.projectionSha256, input.command.projectionSha256); assert.equal(current.captureFrameId, input.command.captureFrameId);
    const cables = (await c.query<{ id: string; from_location: string | null; to_location: string | null }>('SELECT id,from_location,to_location FROM cables WHERE project_id=$1 AND id=ANY($2::uuid[])', [PROJECT, input.cableIds])).rows; assert.equal(cables.length, 3); assert.deepEqual(new Set(cables.map(c => c.id)), new Set(input.cableIds));
    const names = new Set(['PF-R5-A', 'PF-R5-A-ALIAS', 'PF-R5-B']); for (const cable of cables) for (const endpoint of [cable.from_location, cable.to_location]) assert.ok(endpoint === null || names.has(endpoint));
    const locations = (await c.query<{ id: string; name: string; created_by: string }>('SELECT id,name,created_by FROM pf_locations WHERE id=ANY($1::uuid[])', [Object.values(input.ownedLocations)])).rows;
    for (const location of locations) { assert.equal(location.created_by, ACTOR); assert.equal(location.name, location.id === input.ownedLocations.a ? 'PF-R5-A' : location.id === input.ownedLocations.b ? 'PF-R5-B' : 'PF-R5-LEGACY'); assert.equal((await c.query('SELECT id FROM pf_locations WHERE project_id=$1 AND id=$2', [PROJECT, location.id])).rows.length, 1); }
  });
}
async function preservation(pool: Pool): Promise<string> {
  const value = (await pool.query<{ proof: string }>(`SELECT jsonb_build_object(
    'project',(SELECT to_jsonb(p) FROM projects p WHERE p.id=$1),'selection',(SELECT to_jsonb(s) FROM project_model_selections s WHERE s.project_id=$1),
    'preparation',(SELECT to_jsonb(s) FROM pf_project_preparations s WHERE s.project_id=$1),'policy',(SELECT to_jsonb(s) FROM pf_purpose_project_state s WHERE s.project_id=$1),
    'cables',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM cables c WHERE c.project_id=$1),
    'legacy',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.location_id,b.model_version_id) FROM pf_location_bindings b WHERE b.project_id=$1),
    'artifacts',(SELECT count(*) FROM pf_artifacts WHERE project_id=$1),'aggregates',(SELECT count(*) FROM pf_preparation_aggregates WHERE project_id=$1),
    'traces',(SELECT count(*) FROM pf_geometry_trace_sets WHERE project_id=$1),'objects',(SELECT count(*) FROM pf_geometry_object_revisions WHERE project_id=$1),
    'applies',(SELECT count(*) FROM pf_apply_receipts WHERE project_id=$1))::text AS proof`, [PROJECT])).rows[0]; assert.ok(value); return sha(value.proof);
}
async function endpointState(pool: Pool, locationId: string) { const row = (await pool.query<{ proof: string }>(`SELECT jsonb_build_object('registry',(SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1),'location',(SELECT to_jsonb(l) FROM pf_locations l WHERE l.project_id=$1 AND l.id=$2),'aliases',(SELECT jsonb_agg(to_jsonb(a) ORDER BY normalized_alias) FROM pf_location_aliases a WHERE a.project_id=$1 AND a.location_id=$2),'head',(SELECT to_jsonb(h) FROM pf_endpoint_binding_heads h WHERE h.project_id=$1 AND h.location_id=$2),'bindings',(SELECT count(*) FROM pf_endpoint_binding_revisions WHERE project_id=$1 AND location_id=$2))::text AS proof`, [PROJECT, locationId])).rows[0]; return sha(row.proof); }
const denied = (operation: () => Promise<unknown>, code: string) => assert.rejects(operation, error => (error as { code?: string }).code === code);
async function immutable(pool: Pool, input: EndpointBindingControlInput) {
  for (const table of ['pf_endpoint_binding_revisions', 'pf_endpoint_binding_commands', 'pf_endpoint_legacy_observations', 'pf_endpoint_migration_decisions']) {
    await direct(pool, async c => {
      const row = (await c.query(`SELECT 1 FROM ${table} WHERE project_id=$1 LIMIT 1`, [PROJECT])).rows[0]; if (!row) return;
      await assert.rejects(() => c.query(`DELETE FROM ${table} WHERE project_id=$1`, [PROJECT]), error => (error as { code?: string }).code === 'P0001');
    }, true);
  }
  const context = await createEndpointBindingRepository(pool).context(PROJECT, input.principal, input.locationId); assert.ok(context.head);
}
async function fk(pool: Pool, input: EndpointBindingControlInput) {
  await direct(pool, async c => {
    const head = (await c.query<{ binding_id: string }>('SELECT binding_id FROM pf_endpoint_binding_heads WHERE project_id=$1 AND location_id=$2', [PROJECT, input.ownedLocations.a])).rows[0]; assert.ok(head);
    assert.equal((await c.query('SELECT 1 FROM pf_endpoint_binding_heads WHERE project_id=$1 AND location_id=$2', [PROJECT, input.ownedLocations.b])).rows.length, 1);
    await assert.rejects(() => c.query('UPDATE pf_endpoint_binding_heads SET binding_id=$3 WHERE project_id=$1 AND location_id=$2', [PROJECT, input.ownedLocations.b, head.binding_id]), error => (error as { code?: string }).code === '23503');
  }, true);
  await direct(pool, async c => {
    const object = (await c.query<{ id: string; trace_id: string }>('SELECT id,trace_id FROM pf_geometry_object_revisions WHERE project_id=$1 ORDER BY trace_id,id LIMIT 1', [PROJECT])).rows[0]; assert.ok(object);
    const other = (await c.query<{ id: string }>('SELECT id FROM pf_geometry_trace_sets WHERE project_id=$1 AND id<>$2 ORDER BY id LIMIT 1', [PROJECT, object.trace_id])).rows[0]; assert.ok(other, 'Retained R4 first/current trace pair is required.');
    await assert.rejects(() => c.query(`INSERT INTO pf_endpoint_binding_revisions(id,project_id,location_id,model_version_id,aggregate_id,binding_revision,trace_id,object_revision_id,record_sha256,record,created_by)
      SELECT $3,project_id,location_id,model_version_id,aggregate_id,binding_revision+1000000,$4,$5,record_sha256,record,created_by FROM pf_endpoint_binding_revisions WHERE project_id=$1 AND location_id=$2 ORDER BY binding_revision DESC LIMIT 1`, [PROJECT, input.ownedLocations.a, randomUUID(), other.id, object.id]), error => (error as { code?: string }).code === '23503');
  }, true);
}
/** Cleanup is observable: an uncertain rollback never becomes a control PASS. */
export async function rollbackEndpointControlWriter(writer: PoolClient): Promise<void> {
  let discard = false; try { await writer.query('ROLLBACK'); } catch (error) { discard = true; throw new Error('Owned endpoint control rollback is unconfirmed.', { cause: error }); } finally { writer.release(discard ? true : undefined); }
}
async function fence(pool: Pool, input: EndpointBindingControlInput) {
  const writer = await pool.connect(); let observer: PoolClient | undefined, primary: Promise<unknown> | undefined, mutation: Promise<unknown> | undefined, releaseGate!: () => void, entered!: (pid: number) => void;
  const gate = new Promise<void>(r => { releaseGate = r; }), ready = new Promise<number>(r => { entered = r; });
  try {
    observer = await pool.connect();
    await writer.query('BEGIN'); await writer.query("SET LOCAL lock_timeout='4000ms';SET LOCAL statement_timeout='5000ms';SET LOCAL idle_in_transaction_session_timeout='12000ms'");
    if (input.phase === 'fencing-timeout') { await writer.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [PROJECT]); await denied(() => endpointBindingTransaction(pool, PROJECT, input.principal, async () => assert.fail('Blocked callback must not run.')), 'ENDPOINT_DATABASE_BUSY'); return; }
    primary = endpointBindingTransaction(pool, PROJECT, input.principal, async c => { await c.query('SELECT registry_revision FROM pf_project_state WHERE project_id=$1 FOR SHARE', [PROJECT]); await readCurrentEndpointBindingContext(c, PROJECT); entered((await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid); await gate; });
    const holderPid = await Promise.race([ready, primary.then(() => { throw Error('The production transaction ended without entering its fence.'); })]), writerPid = (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    mutation = writer.query(input.phase === 'fencing-role' ? 'UPDATE users SET is_admin=is_admin WHERE id=$1' : input.phase === 'fencing-selection' ? 'UPDATE project_model_selections SET selection_revision=selection_revision WHERE project_id=$1' : 'UPDATE pf_project_state SET registry_revision=registry_revision WHERE project_id=$1', [input.phase === 'fencing-role' ? ACTOR : PROJECT]);
    void mutation.catch(() => undefined);
    const deadline = performance.now() + 1500; let blocked = false;
    while (performance.now() < deadline) { const row = (await observer.query<{ blockers: number[] }>('SELECT pg_blocking_pids($1) AS blockers', [writerPid])).rows[0]; if (row.blockers.includes(holderPid)) { blocked = true; break; } await delay(25); }
    assert.ok(blocked, 'The intended production transaction must fence the competing owned edit.'); releaseGate(); await primary; await mutation;
  } finally { releaseGate(); await primary?.catch(() => undefined); await mutation?.catch(() => undefined); try { await rollbackEndpointControlWriter(writer); } finally { observer?.release(true); } }
}

export async function runEndpointBindingControl(pool: Pool, raw: unknown) {
  const input = endpointBindingControlInputSchema.parse(raw), started = performance.now(), checks: Check[] = [], repository = createEndpointBindingRepository(pool);
  await guard(pool, input); await repository.authorize(PROJECT, input.principal); const before = await preservation(pool), stateBefore = await endpointState(pool, input.locationId);
  if (input.phase === 'confirm' || input.phase === 'legacy') {
    const result = await repository.confirm(PROJECT, input.principal, input.locationId, input.command); assert.equal(result.binding.mode, input.command.mode); assert.equal(result.binding.qualifiedProjectFrameId, null);
    if (input.phase === 'legacy') { assert.ok(result.binding.legacyObservationId); assert.equal(result.binding.mode, 'fixed-world'); assert.equal(result.binding.attachment, null); assert.equal(result.binding.priorCaptureFrameId, null); assert.equal(result.binding.displacementBasis, 'unverified-frames'); assert.equal(result.binding.displacementVectorMetres, null); assert.equal(result.binding.displacementMetres, null); const row = (await pool.query<{ record: unknown; record_sha256: string }>('SELECT record,record_sha256 FROM pf_endpoint_legacy_observations WHERE project_id=$1 AND id=$2', [PROJECT, result.binding.legacyObservationId])).rows[0]; assert.ok(row); assert.equal(endpointBindingHash(row.record), row.record_sha256); }
    note(checks, 'Atomic explicit shared location/head confirmation', 'actual production repository and PostgreSQL; no cable Apply or frame qualification');
  } else if (input.phase === 'replay' || input.phase === 'old-key') {
    const command = input.phase === 'old-key' ? input.previousCommand! : input.command;
    const result = await repository.confirm(PROJECT, input.principal, input.locationId, command); assert.equal(result.duplicate, true); assert.equal(await endpointState(pool, input.locationId), stateBefore);
    if (input.phase === 'old-key') assert.notEqual(result.binding.id, (await repository.context(PROJECT, input.principal, input.locationId)).head?.id);
    note(checks, 'Exact historical command reconciliation before current CAS', 'actual immutable command receipt; no new binding or revision');
  } else if (input.phase === 'no-op') {
    const beforeContext = await repository.context(PROJECT, input.principal, input.locationId); assert.ok(beforeContext.head); const result = await repository.confirm(PROJECT, input.principal, input.locationId, input.command); assert.equal(result.duplicate, true); assert.equal(result.binding.id, beforeContext.head.id); assert.equal(await endpointState(pool, input.locationId), stateBefore);
    note(checks, 'New-key equal semantics keep one binding and registry revision', 'actual PostgreSQL; only its exact command receipt may be added');
  } else if (input.phase === 'conflict') {
    const base = input.previousCommand ?? input.command; assert.equal(base.mode, 'fixed-world'); const modified = { ...base, pointProjectMetres: [123, 456, 789] };
    await denied(() => repository.confirm(PROJECT, input.principal, input.locationId, modified), 'ENDPOINT_IDEMPOTENCY_CONFLICT'); assert.equal(await endpointState(pool, input.locationId), stateBefore);
    note(checks, 'Same-key conflicting body refuses without changing shared state', 'actual command replay refusal');
  } else if (input.phase === 'usage') {
    const context = await repository.context(PROJECT, input.principal, input.ownedLocations.a); assert.ok(context.head); assert.ok(context.usage.fromOccurrences >= 1 && context.usage.toOccurrences >= 1 && context.usage.distinctCables >= 2); assert.equal(context.readiness.calculationReady, true);
    note(checks, 'Shared alias counts include both cable ends and multiple cables', 'actual all-project cable usage; independent of selected UI cables');
  } else if (input.phase === 'immutable') { await immutable(pool, input); note(checks, 'Immutable records refuse deletion', 'actual PostgreSQL rollback-only probes; absent optional record families are not separately claimed'); }
  else if (input.phase === 'fk') { await fk(pool, input); note(checks, 'Head location and exact trace/object membership foreign keys refuse forged pairs', 'actual PostgreSQL rollback-only probes'); }
  else if (input.phase === 'rollback') {
    const abort = new AbortController(); let injected = false;
    const wrapped = { connect: async () => { const c = await pool.connect(), proxy = Object.create(c) as PoolClient; proxy.query = (async (...args: unknown[]) => { const result = await Reflect.apply(c.query, c, args); if (typeof args[0] === 'string' && args[0].startsWith('INSERT INTO pf_endpoint_binding_revisions')) { injected = true; abort.abort(); } return result; }) as PoolClient['query']; proxy.release = c.release.bind(c); return proxy; } } as unknown as Pool;
    await assert.rejects(() => createEndpointBindingRepository(wrapped).confirm(PROJECT, input.principal, input.locationId, input.command, abort.signal), error => (error as { name?: string }).name === 'AbortError'); assert.equal(injected, true); assert.equal(await endpointState(pool, input.locationId), stateBefore);
    note(checks, 'Cancellation after actual revision INSERT rolls back the full confirmation', 'fault-injected production transaction; no persistent partial location/head/alias/registry change');
  } else if (input.phase === 'auth-expiry') { await denied(() => repository.confirm(PROJECT, { ...input.principal, loginExpiresAt: Date.now() - 1 }, input.locationId, input.command), 'LOGIN_EXPIRED'); note(checks, 'Expired principal cannot confirm a binding', 'actual production authority guard'); }
  else if (input.phase.startsWith('fencing-')) { await fence(pool, input); note(checks, 'Current authority/current model/registry transaction locks fence the competing edit', 'actual production transaction primitive ONLY; not a paused full confirmation race'); }
  else if (input.phase === 'migration-refusal') {
    const context = await repository.context(PROJECT, input.principal, input.locationId); assert.ok(context.head && context.location && context.current); const current = context.current, sourceHead = context.head, sourceLocation = context.location;
    const decision = await repository.migrate(PROJECT, input.principal, { schemaVersion: 'wfc.pf.endpoint-migration-write.v1', sourceBindingId: context.head.id, expectedRegistryRevision: context.registryRevision, expectedLocationRevision: context.location.revision, expectedHeadId: context.head.id, expectedSelectionRevision: current.selectionRevision, targetModelVersionId: MODEL, targetAggregateId: current.aggregateId, targetProjectionSha256: current.projectionSha256, targetCaptureFrameId: current.captureFrameId, objectDecisionId: null, frameDecisionId: null, idempotencyKey: input.migrationIdempotencyKey, reason: 'Owned R5 unqualified migration refusal control' });
    assert.equal(decision.evaluation.disposition, 'frame-unverified'); assert.equal(decision.evaluation.proposal, null);
    await denied(() => repository.confirmMigration(PROJECT, input.principal, decision.id, { schemaVersion: 'wfc.pf.endpoint-migration-confirm.v1', expectedDecisionSha256: decision.contentSha256, expectedRegistryRevision: context.registryRevision, expectedLocationRevision: sourceLocation.revision, expectedHeadId: sourceHead.id, expectedSelectionRevision: current.selectionRevision, idempotencyKey: input.migrationConfirmIdempotencyKey, reason: 'Owned R5 no fabricated frame confirmation' }), 'ENDPOINT_MIGRATION_REQUIRES_RESOLUTION'); assert.equal(await endpointState(pool, input.locationId), stateBefore);
    note(checks, 'Missing frame evidence stays an immutable explicit unresolved migration', 'actual default repository path; no fabricated identity/frame mapping or binding update');
  }
  assert.equal(await preservation(pool), before); assert.ok(performance.now() - started < 20000, 'A phase must fit its bounded root helper budget.');
  return { schemaVersion: 'wfc.pf.endpoint-control-receipt.v1', phase: input.phase, phaseIntentId: input.phaseIntentId, recordedAtUtc: new Date().toISOString(), status: 'PASS', elapsedMilliseconds: performance.now() - started, checks, preservationSha256: before, cableApply: 'NOT_PERFORMED', nativeParity: 'NOT_PERFORMED', engineeringAcceptance: false };
}

export const endpointBindingControlFixture = Object.freeze({ projectId: PROJECT, modelVersionId: MODEL, actorId: ACTOR, actorEmail: EMAIL, phases });
