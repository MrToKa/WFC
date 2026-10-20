// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeLocationImpactSchema } from './locationImpactSchema.js';
import { initializeInitialFillMandateSchema } from './initialFillMandateSchema.js';
import { initializeInitialFillAttemptSchema } from './initialFillAttemptSchema.js';
import { createInitialFillProgress } from './initialFillProgress.js';
import { hash } from './dependencies.js';
import { initialFillMandateContentHashInput, initialFillMandateRecordSchema } from '../../shared/pathfinderInitialFill.js';
import { locationImpactRecordSchema } from '../../shared/pathfinderLocationImpacts.js';

// Real PostgreSQL metadata queries, real historical mandate validation and real
// SELECT-only current-admin/login transaction. All records/jobs/results below
// are explicitly seeded synthetic metadata; no engine or write approval claim.
const fixturePath = process.env.PF_U5_SQL_FIXTURE, schemaName = 'pfu5_initialfillprogress';
const id = (n: number) => `f8500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), impactId = id(2), actorId = id(3), loginId = id(4), mandateId = id(5), jobId = id(6), cableIds = [id(7), id(8), id(9)];
const who = { userId: actorId, loginId, loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
const current = { modelVersionId: id(10), selectionRevision: '1', contentFingerprint: 'a'.repeat(64), aggregateId: id(11), artifactId: id(12),
  projectionSha256: 'b'.repeat(64), captureFrameId: id(13), geometryRevision: '1', traceId: id(14) };
let pool: Pool;
const schema = `
CREATE TABLE projects(id uuid PRIMARY KEY);
CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL,pf_admin_revision bigint NOT NULL);
CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
CREATE TABLE pf_installation_state(singleton boolean PRIMARY KEY,installation_epoch uuid NOT NULL);
CREATE TABLE project_model_selections(project_id uuid PRIMARY KEY,active_model_version_id uuid,selection_revision bigint);
CREATE TABLE model_versions(project_id uuid,id uuid,state text,health text,content_fingerprint text,PRIMARY KEY(project_id,id));
CREATE TABLE pf_project_preparations(project_id uuid PRIMARY KEY,current_aggregate_id uuid,current_artifact_id uuid,geometry_revision bigint);
CREATE TABLE pf_preparation_aggregates(project_id uuid,id uuid,manifest jsonb,PRIMARY KEY(project_id,id));
CREATE TABLE pf_artifacts(project_id uuid,id uuid,snapshot_sha256 text,PRIMARY KEY(project_id,id));
CREATE TABLE pf_geometry_trace_sets(project_id uuid,id uuid,aggregate_id uuid,created_at timestamptz DEFAULT now(),PRIMARY KEY(project_id,id));
CREATE TABLE pf_jobs(project_id uuid REFERENCES projects(id),id uuid,state text,cancel_requested boolean,PRIMARY KEY(project_id,id));
CREATE TABLE pf_job_items(project_id uuid,job_id uuid,cable_id uuid,state text,status text,PRIMARY KEY(project_id,job_id,cable_id),FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE);
CREATE TABLE pf_proposals(project_id uuid,id uuid,job_id uuid,cable_id uuid,status text,dependencies jsonb,PRIMARY KEY(project_id,id),UNIQUE(project_id,job_id,cable_id),FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE);
CREATE TABLE pf_apply_receipts(id uuid PRIMARY KEY,project_id uuid,actor_id uuid,idempotency_key uuid,proposal_id uuid,cable_id uuid,
 UNIQUE(project_id,actor_id,idempotency_key));
`;
async function seed(withMandate = true) {
  const now = Date.now(), createdAt = new Date(now).toISOString(), authorityExpiresAt = new Date(now + 1800000).toISOString();
  await pool.query('INSERT INTO projects VALUES($1)', [projectId]); await pool.query('INSERT INTO users VALUES($1,true,2),($2,true,2)', [actorId, id(30)]);
  await pool.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL),($4,$5,$3,NULL)', [loginId, actorId, new Date(who.loginExpiresAt), id(31), id(30)]);
  await pool.query('INSERT INTO pf_installation_state VALUES(true,$1)', [id(15)]); await pool.query('INSERT INTO project_model_selections VALUES($1,$2,1)', [projectId, current.modelVersionId]);
  await pool.query("INSERT INTO model_versions VALUES($1,$2,'ready','healthy',$3)", [projectId, current.modelVersionId, current.contentFingerprint]);
  await pool.query('INSERT INTO pf_project_preparations VALUES($1,$2,$3,1)', [projectId, current.aggregateId, current.artifactId]);
  await pool.query('INSERT INTO pf_preparation_aggregates VALUES($1,$2,$3)', [projectId, current.aggregateId, { coordinateFrameId: current.captureFrameId }]);
  await pool.query('INSERT INTO pf_artifacts VALUES($1,$2,$3)', [projectId, current.artifactId, current.projectionSha256]);
  await pool.query('INSERT INTO pf_geometry_trace_sets(project_id,id,aggregate_id) VALUES($1,$2,$3)', [projectId, current.traceId, current.aggregateId]);
  const impactDraft = locationImpactRecordSchema.parse({ schemaVersion: 'wfc.pf.location-impact-record.v1', id: impactId, projectId, actorId, actorAdminRevision: '2', loginId,
    loginExpiresAt: new Date(who.loginExpiresAt).toISOString(), authorityExpiresAt, installationEpoch: id(15), idempotencyKey: id(16), commandSha256: 'c'.repeat(64),
    locationId: id(17), bindingId: id(18), bindingContentSha256: 'd'.repeat(64), observedRegistryRevision: '3', current,
    calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 }, eligibleCableIds: cableIds, excludedMvCableIds: [id(19)], blockedCategoryCableIds: [], createdAt, contentSha256: '0'.repeat(64) });
  const { contentSha256: _hash, ...impactBody } = impactDraft, impact = { ...impactDraft, contentSha256: hash(impactBody) };
  await pool.query('INSERT INTO pf_location_impacts VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [projectId, impactId, actorId, loginId, impact.idempotencyKey, impact.commandSha256, impact.contentSha256, impact, createdAt]);
  await pool.query("INSERT INTO pf_location_impact_dispatch(project_id,impact_id,status) VALUES($1,$2,'enrolled')", [projectId, impactId]);
  await pool.query("INSERT INTO pf_jobs VALUES($1,$2,'running',false)", [projectId, jobId]);
  await pool.query('INSERT INTO pf_location_impact_enrollments(project_id,impact_id,job_id,input_sha256,total,ready_cables,blocked_cables) VALUES($1,$2,$3,$4,3,2,1)', [projectId, impactId, jobId, 'e'.repeat(64)]);
  for (const [at, cableId] of cableIds.entries()) {
    await pool.query('INSERT INTO pf_job_items VALUES($1,$2,$3,$4,$5)', [projectId, jobId, cableId, at === 0 ? 'waiting' : at === 1 ? 'complete' : 'blocked', at === 0 ? 'waiting' : at === 1 ? 'calculated' : 'no_path']);
    if (at === 1) await pool.query('INSERT INTO pf_proposals VALUES($1,$2,$3,$4,$5,$6)', [projectId, id(40), jobId, cableId, 'calculated', { schemaVersion: 'pathfinder.dependencies.v7' }]);
  }
  if (withMandate) {
    const draft = initialFillMandateRecordSchema.parse({ schemaVersion: 'wfc.pf.initial-fill-mandate.v1', id: mandateId, projectId, impactId, impactContentSha256: impact.contentSha256,
      commandSha256: impact.commandSha256, idempotencyKey: impact.idempotencyKey, mode: 'when-both-empty', actorId, actorAdminRevision: '2', loginId, loginExpiresAt: impact.loginExpiresAt,
      authorityExpiresAt, installationEpoch: impact.installationEpoch, current, eligibleCableIds: cableIds, createdAt, contentSha256: '0'.repeat(64) });
    const record = { ...draft, contentSha256: hash(initialFillMandateContentHashInput(draft)) };
    await pool.query('INSERT INTO pf_initial_fill_mandates VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [projectId, mandateId, impactId, actorId, loginId, draft.idempotencyKey, draft.commandSha256, record.contentSha256, record, createdAt]);
  }
}
const read = (cableId: string | null = cableIds[0]) => createInitialFillProgress(pool).read(projectId, who, { impactId, ...(cableId ? { cableId } : {}) });
async function addAttempt(status = 'unknown', attempts = 2, receipt = false) {
  await pool.query('INSERT INTO pf_initial_fill_attempts(project_id,actor_id,idempotency_key,mandate_id,proposal_id,cable_id,request_sha256,request) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [projectId, actorId, id(41), mandateId, id(40), cableIds[1], 'f'.repeat(64), { synthetic: 'metadata only; never dispatched by this test' }]);
  await pool.query('INSERT INTO pf_initial_fill_dispatch(project_id,actor_id,idempotency_key,status,attempts,not_before,receipt_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [projectId, actorId, id(41), status, attempts, attempts < 3 ? new Date() : null, receipt ? id(42) : null]);
  if (receipt) await pool.query('INSERT INTO pf_apply_receipts VALUES($1,$2,$3,$4,$5,$6)', [id(42), projectId, actorId, id(41), id(40), cableIds[1]]);
}
describe.runIf(Boolean(fixturePath))('PF-U5 actual bounded initial-fill metadata SELECT queries in an owned schema', () => {
  beforeAll(async () => {
    const scratch = await realpath(fileURLToPath(new URL('../../pathfinder-engine/.scratch/', import.meta.url))), resolved = await realpath(fixturePath!);
    const relative = path.relative(scratch, resolved), parts = relative.split(path.sep);
    if (path.isAbsolute(relative) || relative.startsWith('..') || parts.length !== 2 || !/^initial-fill-progress-u5-[a-f0-9-]{36}$/.test(parts[0]) || !parts[1].endsWith('.private.json')) throw Error('Refuse a fixture outside its newly owned U5 scratch directory.');
    const config = JSON.parse(await readFile(resolved, 'utf8')) as { database: string; url: string; owner: string };
    if (!/^wfc_pfu5_[a-f0-9_]+$/.test(config.database) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(config.owner)) throw Error('Refuse a nonfixture database or owner capability.');
    const url = new URL(config.url);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || decodeURIComponent(url.pathname.slice(1)) !== config.database) throw Error('Refuse a nonlocal or mismatched fixture URL.');
    pool = new Pool({ connectionString: config.url, options: `-c search_path=${schemaName},pg_catalog`, max: 3, connectionTimeoutMillis: 3000, query_timeout: 20000 });
    const identity = (await pool.query('SELECT current_database() AS db,owner FROM public.pfu5_fixture_owner')).rows;
    if (identity.length !== 1 || identity[0].db !== config.database || identity[0].owner !== config.owner) throw Error('Fixture owner mismatch before any DDL.');
    await pool.query(`CREATE SCHEMA ${schemaName}`); await pool.query(schema); await initializeLocationImpactSchema(pool); await initializeInitialFillMandateSchema(pool); await initializeInitialFillAttemptSchema(pool);
  });
  beforeEach(async () => { await pool.query('TRUNCATE pfu5_initialfillprogress.projects,pfu5_initialfillprogress.users,pfu5_initialfillprogress.viewer_login_bindings,pfu5_initialfillprogress.pf_installation_state,pfu5_initialfillprogress.project_model_selections,pfu5_initialfillprogress.model_versions,pfu5_initialfillprogress.pf_project_preparations,pfu5_initialfillprogress.pf_preparation_aggregates,pfu5_initialfillprogress.pf_artifacts,pfu5_initialfillprogress.pf_geometry_trace_sets,pfu5_initialfillprogress.pf_job_items,pfu5_initialfillprogress.pf_apply_receipts CASCADE'); await seed(); });
  afterAll(async () => { await pool?.end(); });
  it('separates active waiting, undiscovered calculated and terminal no_path using actual joins and immutable hashes', async () => {
    expect(await read()).toMatchObject({ authorized: true, currentAuthority: true, outstanding: 2, counters: { 'awaiting-result': 2, 'not-applicable': 1 }, selected: { cableId: cableIds[0], status: 'awaiting-result' } });
    expect((await read(cableIds[2])).selected).toMatchObject({ status: 'not-applicable', reasonCode: 'INITIAL_FILL_NO_PATH', receiptId: null });
  });
  it('does not claim a written cable before matching its exact immutable receipt metadata', async () => {
    await addAttempt('written', 1, false); expect((await read(cableIds[1])).selected).toMatchObject({ status: 'unknown', reasonCode: 'INITIAL_FILL_RECEIPT_REQUIRED' });
    await pool.query('INSERT INTO pf_apply_receipts VALUES($1,$2,$3,$4,$5,$6)', [id(42), projectId, actorId, id(41), id(40), cableIds[1]]);
    await pool.query('UPDATE pf_initial_fill_dispatch SET receipt_id=$1', [id(42)]); expect((await read(cableIds[1])).selected).toMatchObject({ status: 'written', receiptId: id(42) });
  });
  it('counts retryable unknown only while an actual retry remains scheduled', async () => {
    await addAttempt(); expect(await read(cableIds[1])).toMatchObject({ retryableUnknown: 1, outstanding: 2, counters: { unknown: 1 } });
    await pool.query('UPDATE pf_initial_fill_dispatch SET attempts=3,not_before=NULL'); expect(await read(cableIds[1])).toMatchObject({ retryableUnknown: 0, outstanding: 1 });
    await pool.query("UPDATE pf_job_items SET state='blocked',status='no_path' WHERE cable_id=$1", [cableIds[0]]); expect((await read()).outstanding).toBe(0);
  });
  it('current role/login and exact actor/impact membership are enforced without creating login rows', async () => {
    const before = (await pool.query('SELECT count(*)::int FROM viewer_login_bindings')).rows[0].count;
    await expect(createInitialFillProgress(pool).read(projectId, { ...who, userId: id(30), loginId: id(31) }, { impactId })).rejects.toMatchObject({ code: 'INITIAL_FILL_IMPACT_NOT_FOUND' });
    await expect(read(id(99))).rejects.toMatchObject({ code: 'INITIAL_FILL_CABLE_OUTSIDE_IMPACT' });
    await pool.query('UPDATE users SET is_admin=false WHERE id=$1', [actorId]); await expect(read()).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    await pool.query('UPDATE users SET is_admin=true WHERE id=$1', [actorId]); await pool.query('UPDATE viewer_login_bindings SET revoked_at=now() WHERE login_id=$1', [loginId]); await expect(read()).rejects.toMatchObject({ code: 'LOGIN_REVOKED' });
    expect((await pool.query('SELECT count(*)::int FROM viewer_login_bindings')).rows[0].count).toBe(before);
  });
  it('a restored epoch stops waiting on results without renewing the original mandate', async () => {
    await pool.query('UPDATE pf_installation_state SET installation_epoch=$1', [randomUUID()]); expect(await read()).toMatchObject({ authorized: true, currentAuthority: false, outstanding: 0, counters: { 'awaiting-result': 0, 'not-applicable': 3 } });
    expect((await pool.query('SELECT count(*)::int FROM pf_initial_fill_mandates')).rows[0].count).toBe(1);
  });
  it('old calculation-only metadata is terminal not-authorized and every diagnostic read preserves stored rows', async () => {
    await pool.query('TRUNCATE pfu5_initialfillprogress.projects,pfu5_initialfillprogress.users,pfu5_initialfillprogress.viewer_login_bindings,pfu5_initialfillprogress.pf_installation_state,pfu5_initialfillprogress.project_model_selections,pfu5_initialfillprogress.model_versions,pfu5_initialfillprogress.pf_project_preparations,pfu5_initialfillprogress.pf_preparation_aggregates,pfu5_initialfillprogress.pf_artifacts,pfu5_initialfillprogress.pf_geometry_trace_sets,pfu5_initialfillprogress.pf_job_items,pfu5_initialfillprogress.pf_apply_receipts CASCADE'); await seed(false);
    const snapshot = async () => (await pool.query(`SELECT (SELECT md5(string_agg(to_jsonb(v)::text,'' ORDER BY login_id)) FROM viewer_login_bindings v) login_hash,
      (SELECT md5(string_agg(record::text,'' ORDER BY id)) FROM pf_location_impacts) impact_hash,(SELECT count(*)::int FROM pf_initial_fill_mandates) mandates,
      (SELECT count(*)::int FROM pf_initial_fill_attempts) attempts,(SELECT count(*)::int FROM pf_initial_fill_dispatch) dispatches`)).rows[0];
    const before = await snapshot(); expect(await read()).toMatchObject({ authorized: false, currentAuthority: false, outstanding: 0, selected: { status: 'not-authorized' } });
    expect((await read(null)).selected).toBeNull(); expect(await snapshot()).toEqual(before);
  });
});
