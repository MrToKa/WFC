// @vitest-environment node
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { hash } from './dependencies.js';
import { principalTransaction } from './auth.js';
import { PathFinderError } from './errors.js';
import { initializeRevisionResultSchema } from './revisionResultSchema.js';
import { sealRevisionResult } from './revisionResultRepository.js';
import { revisionBaselineSchema } from '../../shared/pathfinderRevisionResults.js';
import { initializeAutoLengthSchema } from './autoLengthSchema.js';
import { publishAutoLength, readAutoLengths, registerAutoLengthAdmission } from './autoLengthStore.js';

/** Opt-in actual PostgreSQL store/immutable-seal/transaction/revision tests.
 * Every engine/capture/identity value is explicitly synthetic. This suite is
 * not actual model geometry, a whole production worker, normal HTTP permissions,
 * a human Apply, a background grant execution, or engineering acceptance. */
const fixturePath = process.env.PF_B7A_SQL_FIXTURE, schemaName = 'pfb7a_autolengths';
let pool: Pool;
type Row = Record<string, any>;
const schema = `
CREATE TABLE IF NOT EXISTS projects(id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,is_admin boolean NOT NULL);
CREATE TABLE IF NOT EXISTS viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS cables(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 cable_write_revision bigint NOT NULL DEFAULT 0,cable_id text,revision text,mto text,tag text,cable_type_id uuid,
 from_location text,to_location text,routing text,delivery text,design_length numeric,install_length numeric,pull_date date,
 connected_from boolean,connected_to boolean,tested boolean,updated_at timestamptz DEFAULT now(),UNIQUE(project_id,id));
CREATE TABLE IF NOT EXISTS cable_versions(id bigserial PRIMARY KEY,snapshot jsonb);
CREATE TABLE IF NOT EXISTS pf_jobs(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 state text NOT NULL,cancel_requested boolean NOT NULL DEFAULT false,total int NOT NULL DEFAULT 2,completed int NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id));
CREATE TABLE IF NOT EXISTS pf_job_items(project_id uuid NOT NULL,job_id uuid NOT NULL,cable_id uuid NOT NULL,
 state text NOT NULL,status text NOT NULL,dependencies jsonb,PRIMARY KEY(project_id,job_id,cable_id),
 FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,cable_id) REFERENCES cables(project_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS pf_proposals(id uuid PRIMARY KEY,project_id uuid NOT NULL,job_id uuid NOT NULL,cable_id uuid NOT NULL,
 status text NOT NULL,dependencies jsonb NOT NULL,dependency_hash text NOT NULL,geometry_hash text NOT NULL,
 result jsonb NOT NULL,proposal_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,id),
 UNIQUE(project_id,job_id,cable_id),FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS pf_apply_receipts(id uuid PRIMARY KEY,project_id uuid,cable_id uuid,applied_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS pfb7a_scope(project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,context jsonb NOT NULL);
`;
type Fixture = Awaited<ReturnType<typeof seed>>;
type Request = Awaited<ReturnType<typeof admission>>;

async function seed() {
  const f = syntheticBarrierWriteInputs(), projectId = f.dependencies.projectId, cableId = f.dependencies.cableId;
  const who = { userId: f.id(301), loginId: f.id(302), loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
  await pool.query('INSERT INTO projects VALUES($1)', [projectId]);
  await pool.query('INSERT INTO users VALUES($1,true)', [who.userId]);
  await pool.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)', [who.loginId, who.userId, new Date(who.loginExpiresAt)]);
  await pool.query(`INSERT INTO cables(id,project_id,cable_id,tag,revision,mto,cable_type_id,from_location,to_location,routing,design_length,install_length)
    VALUES($1,$2,'SYNTHETIC-01','Unchanged synthetic tag','engineering-1','LV',$3,'FROM','TO','/EXISTING',99,123.45)`,
    [cableId, projectId, f.dependencies.cableInputs.cableTypeId]);
  f.dependencies.cableWriteRevision = '0';
  await pool.query('INSERT INTO pfb7a_scope VALUES($1,$2)', [projectId, f.dependencies.barriers]);
  const cable = async () => (await pool.query(`SELECT to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,
    'install_length',c.install_length::text,'cable_write_revision',c.cable_write_revision::text) AS value
    FROM cables c WHERE project_id=$1 AND id=$2`, [projectId, cableId])).rows[0].value as Row;
  const counts = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM pf_auto_lengths) AS auto,
    (SELECT count(*)::int FROM pf_proposals) AS proposals,(SELECT count(*)::int FROM pf_revision_results) AS seals,
    (SELECT count(*)::int FROM cable_versions) AS history,(SELECT count(*)::int FROM pf_apply_receipts) AS receipts`)).rows[0];
  return { ...f, projectId, cableId, who, cable, counts };
}
async function admission(f: Fixture, options: { blocked?: boolean; register?: boolean } = {}) {
  const admissionId = randomUUID(), jobId = options.blocked ? null : randomUUID(), proposalId = randomUUID();
  return principalTransaction(pool, f.projectId, f.who, async client => {
    if (jobId) await client.query("INSERT INTO pf_jobs(id,project_id,state) VALUES($1,$2,'running')", [jobId, f.projectId]);
    const current = await f.cable();
    const baseline = revisionBaselineSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-baseline.v1', currentCable: {
      id: f.cableId, tag: current.tag, fromLocation: current.from_location, toLocation: current.to_location, routing: current.routing,
      designLength: current.design_length, installLength: current.install_length, cableWriteRevision: current.cable_write_revision },
    lastAcceptedApply: null, acceptedMatchesCurrent: false });
    const baselineHash = hash(baseline);
    // A nullable-job all-blocked automatic request must still fence older jobs.
    const generation = options.blocked ? String(Date.now()) : null;
    await client.query(`INSERT INTO pf_revision_admissions(id,project_id,job_id,generation,kind,input_sha256,options,model_ref,total,observed_events)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,'[]')`, [admissionId, f.projectId, jobId, generation, options.blocked ? 'automatic' : 'manual',
      hash({ admissionId }), f.dependencies.options, f.dependencies.model]);
    await client.query(`INSERT INTO pf_revision_baselines(project_id,admission_id,cable_id,baseline_sha256,baseline,status,message)
      VALUES($1,$2,$3,$4,$5,$6,'Synthetic calculation admission')`, [f.projectId, admissionId, f.cableId, baselineHash, baseline, options.blocked ? 'locations_required' : 'ready']);
    if (jobId) await client.query(`INSERT INTO pf_job_items(project_id,job_id,cable_id,state,status,dependencies) VALUES($1,$2,$3,'running','calculating',$4)`,
      [f.projectId, jobId, f.cableId, f.dependencies]);
    const input = { projectId: f.projectId, admissionId, jobId, cableIds: [f.cableId] };
    const order = options.register === false ? null : await registerAutoLengthAdmission(client, input);
    return { ...input, proposalId, baselineHash, ordinal: order?.admissionOrdinal ?? null };
  });
}
async function currentSyntheticFence(client: PoolClient, f: Fixture, request: Request) {
  const state = (await client.query('SELECT state,cancel_requested FROM pf_jobs WHERE project_id=$1 AND id=$2 FOR UPDATE', [f.projectId, request.jobId])).rows[0];
  if (!state || state.cancel_requested || ['failed', 'cancelled'].includes(state.state)) throw new PathFinderError('JOB_FENCED', 409);
  const scope = (await client.query('SELECT context FROM pfb7a_scope WHERE project_id=$1 FOR SHARE', [f.projectId])).rows[0];
  if (!scope || hash(scope.context) !== hash(f.dependencies.barriers)) throw new PathFinderError('PROPOSAL_STALE', 409);
}
async function complete(f: Fixture, request: Request, options: { using?: Pool; afterPublish?: (client: PoolClient) => Promise<void> } = {}) {
  if (!request.jobId) throw new Error('A blocked request cannot execute.');
  return principalTransaction(options.using ?? pool, f.projectId, f.who, async client => {
    await currentSyntheticFence(client, f, request);
    const prior = (await client.query('SELECT dependencies,result FROM pf_proposals WHERE project_id=$1 AND id=$2', [f.projectId, request.proposalId])).rows[0];
    const dependencies = prior?.dependencies ?? f.dependencies, result = prior?.result ?? f.result;
    const proposalHash = hash({ dependencies, result, baselineHash: request.baselineHash });
    await client.query(`INSERT INTO pf_proposals(id,project_id,job_id,cable_id,status,dependencies,dependency_hash,geometry_hash,result,proposal_hash)
      VALUES($1,$2,$3,$4,'calculated',$5,$6,$7,$8,$9) ON CONFLICT(project_id,job_id,cable_id) DO NOTHING`,
      [request.proposalId, f.projectId, request.jobId, f.cableId, dependencies, hash(dependencies), 'a'.repeat(64), result, proposalHash]);
    const seal = await sealRevisionResult(client, { projectId: f.projectId, jobId: request.jobId!, cableId: f.cableId,
      proposalId: request.proposalId, dependencyHash: hash(dependencies), dependencies, result });
    await client.query("UPDATE pf_job_items SET state='complete',status='calculated' WHERE project_id=$1 AND job_id=$2 AND cable_id=$3", [f.projectId, request.jobId, f.cableId]);
    const published = await publishAutoLength(client, { projectId: f.projectId, jobId: request.jobId!, cableId: f.cableId,
      proposalId: request.proposalId, dependencies, result, seal });
    await options.afterPublish?.(client);
    await currentSyntheticFence(client, f, request);
    return { published, seal };
  });
}
const view = async (f: Fixture) => (await readAutoLengths(pool, f.projectId, [f.cableId])).get(f.cableId)!;

describe.runIf(Boolean(fixturePath))('PF-B7a owned actual SQL Auto result projection with explicitly synthetic engine and currentness boundaries', () => {
  beforeAll(async () => {
    const scratch = await realpath(fileURLToPath(new URL('../../pathfinder-engine/.scratch/', import.meta.url))), resolved = await realpath(fixturePath!);
    const relative = path.relative(scratch, resolved), parts = relative.split(path.sep);
    if (path.isAbsolute(relative) || relative.startsWith('..') || parts.length !== 2
      || !/^barrier-auto-length-20261021-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(parts[0]) || !/^[A-Za-z0-9_-]+[.]private[.]json$/.test(parts[1]))
      throw new Error('Refuse a fixture outside a newly owned B7a task scratch directory.');
    const config = JSON.parse(await readFile(resolved, 'utf8')) as { database: string; url: string; owner: string };
    if (!/^wfc_pfb7a_[a-f0-9_]+$/.test(config.database) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.owner)) throw new Error('Invalid B7a fixture identity.');
    const url = new URL(config.url);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port !== '55442'
      || decodeURIComponent(url.pathname.slice(1)) !== config.database) throw new Error('Refuse a nonlocal or wrong-port B7a fixture.');
    pool = new Pool({ connectionString: config.url, options: `-c search_path=${schemaName},pg_catalog`, max: 5, connectionTimeoutMillis: 3000, query_timeout: 10000 });
    const ownership = (await pool.query('SELECT current_database() AS db,owner FROM public.pfb7a_fixture_owner')).rows;
    if (ownership.length !== 1 || ownership[0].db !== config.database || ownership[0].owner !== config.owner) throw new Error('B7a fixture ownership mismatch before DDL.');
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`); await pool.query(schema);
    const source = await readFile(new URL('./schema.ts', import.meta.url), 'utf8'), start = source.indexOf('CREATE OR REPLACE FUNCTION own_cable_write_revision()'),
      end = source.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS cables_project_record_identity', start);
    if (start < 0 || end < start) throw new Error('Production cable-write revision trigger is unavailable.');
    await pool.query(source.slice(start, end));
    await initializeRevisionResultSchema(pool); await initializeAutoLengthSchema(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE pfb7a_autolengths.projects,pfb7a_autolengths.users,pfb7a_autolengths.viewer_login_bindings,pfb7a_autolengths.cable_versions,pfb7a_autolengths.pf_apply_receipts CASCADE');
  });
  afterAll(async () => { await pool?.end(); });

  it('starts with no Auto and refuses lazy historical admission backfill after schema initialization', async () => {
    const f = await seed(), request = await admission(f, { register: false }); expect((await view(f)).autoCalculatedLength).toBeNull();
    await initializeAutoLengthSchema(pool);
    await expect(principalTransaction(pool, f.projectId, f.who, c => registerAutoLengthAdmission(c, {
      projectId: f.projectId, admissionId: request.admissionId, jobId: request.jobId, cableIds: [f.cableId] }))).rejects.toMatchObject({ code: 'AUTO_LENGTH_NEW_ADMISSION_REQUIRED' });
    expect((await f.counts()).auto).toBe(0); expect((await f.cable()).design_length).toBe('99');
  });
  it('makes one checked item immediately readable while its parent runs, with no cable, revision, history or receipt changes', async () => {
    const f = await seed(), before = await f.cable(), request = await admission(f), completed = await complete(f, request);
    expect(completed.published.status).toBe('published');
    expect((await pool.query('SELECT state FROM pf_jobs WHERE id=$1', [request.jobId])).rows[0].state).toBe('running');
    expect(await view(f)).toMatchObject({ autoCalculatedLength: 7, autoLengthStatus: 'last-successful', autoLengthBarrierStatus: 'no-barriers-declared', autoLengthMatchesLatestRequest: true });
    expect(await f.cable()).toEqual(before); expect(await f.counts()).toEqual({ auto: 1, proposals: 1, seals: 1, history: 0, receipts: 0 });
  });
  it('finishes a real exact pre-feature unregistered v8 calculation without backfilling Auto ordering or a value', async () => {
    const f = await seed(), request = await admission(f, { register: false }), before = await f.cable();
    const completed = await complete(f, request);
    expect(completed.published).toEqual({ status: 'historical-unregistered', admissionOrdinal: null });
    expect(await f.counts()).toEqual({ auto: 0, proposals: 1, seals: 1, history: 0, receipts: 0 });
    expect((await pool.query('SELECT count(*)::int AS n FROM pf_auto_length_admissions')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM pf_auto_length_targets')).rows[0].n).toBe(0);
    expect((await view(f)).autoCalculatedLength).toBeNull(); expect(await f.cable()).toEqual(before);
  });
  it('keeps a newer successful source when an older admitted job finishes afterwards', async () => {
    const f = await seed(), older = await admission(f), newer = await admission(f); expect(BigInt(newer.ordinal!)).toBeGreaterThan(BigInt(older.ordinal!));
    expect((await complete(f, newer)).published.status).toBe('published');
    const before = (await pool.query('SELECT source,source_sha256 FROM pf_auto_lengths')).rows[0];
    expect((await complete(f, older)).published.status).toBe('superseded');
    expect((await pool.query('SELECT source,source_sha256 FROM pf_auto_lengths')).rows[0]).toEqual(before);
    expect((await view(f)).autoLengthMatchesLatestRequest).toBe(true);
  });
  it.each(['failed', 'cancelled', 'all-blocked'] as const)('a newer %s request fences an older completion without deleting an earlier published value', async outcome => {
    const f = await seed(), initial = await admission(f); await complete(f, initial);
    const slow = await admission(f), newer = await admission(f, { blocked: outcome === 'all-blocked' });
    if (newer.jobId) await pool.query('UPDATE pf_jobs SET state=$2,cancel_requested=$3 WHERE id=$1', [newer.jobId, outcome, outcome === 'cancelled']);
    expect((await complete(f, slow)).published.status).toBe('superseded');
    expect(await view(f)).toMatchObject({ autoCalculatedLength: 7, autoLengthStatus: outcome === 'all-blocked' ? 'blocked' : outcome, autoLengthMatchesLatestRequest: false });
    const source = (await pool.query('SELECT admission_ordinal::text FROM pf_auto_lengths')).rows[0]; expect(source.admission_ordinal).toBe(initial.ordinal);
  });
  it('replays exact admission and publication identities without advancing their target or rewriting the source', async () => {
    const f = await seed(), request = await admission(f); await complete(f, request);
    const before = (await pool.query('SELECT source,source_sha256 FROM pf_auto_lengths')).rows[0];
    await expect(principalTransaction(pool, f.projectId, f.who, c => registerAutoLengthAdmission(c, { projectId: f.projectId,
      admissionId: request.admissionId, jobId: request.jobId, cableIds: [f.cableId] }))).resolves.toEqual({ admissionOrdinal: request.ordinal, duplicate: true });
    expect((await complete(f, request)).published.status).toBe('duplicate');
    expect((await pool.query('SELECT source,source_sha256 FROM pf_auto_lengths')).rows[0]).toEqual(before);
    expect(await f.counts()).toEqual({ auto: 1, proposals: 1, seals: 1, history: 0, receipts: 0 });
  });
  it.each(['scope', 'cancel'] as const)('rolls back proposal, seal, completed item and Auto when the final %s fence fails after publication', async kind => {
    const f = await seed(), request = await admission(f), before = await f.cable(); let sawAuto = false;
    await expect(complete(f, request, { afterPublish: async c => {
      sawAuto = (await c.query('SELECT count(*)::int AS n FROM pf_auto_lengths')).rows[0].n === 1;
      if (kind === 'scope') await c.query("UPDATE pfb7a_scope SET context=jsonb_set(context,'{profileSha256}',to_jsonb($2::text)) WHERE project_id=$1", [f.projectId, '1'.repeat(64)]);
      else await c.query('UPDATE pf_jobs SET cancel_requested=true WHERE id=$1', [request.jobId]);
    } })).rejects.toMatchObject({ code: kind === 'scope' ? 'PROPOSAL_STALE' : 'JOB_FENCED' });
    expect(sawAuto).toBe(true); expect(await f.counts()).toEqual({ auto: 0, proposals: 0, seals: 0, history: 0, receipts: 0 });
    expect((await pool.query('SELECT state,status FROM pf_job_items')).rows[0]).toEqual({ state: 'running', status: 'calculating' }); expect(await f.cable()).toEqual(before);
  });
  it('reconciles a real durable COMMIT after an injected lost application acknowledgment with no second result or source write', async () => {
    const f = await seed(), request = await admission(f); let lost = false;
    const uncertain = { connect: async () => { const c = await pool.connect(); return { query: async (sql: string, values?: unknown[]) => {
      const result = await c.query(sql, values); if (sql === 'COMMIT' && !lost) { lost = true; throw new Error('Synthetic ACK loss after actual durable COMMIT.'); } return result;
    }, release: (discard?: boolean) => c.release(discard) } as unknown as PoolClient; } } as unknown as Pool;
    await expect(complete(f, request, { using: uncertain })).rejects.toMatchObject({ code: 'PATHFINDER_COMMIT_OUTCOME_UNKNOWN' });
    expect(lost).toBe(true); expect((await f.counts()).auto).toBe(1); expect((await complete(f, request)).published.status).toBe('duplicate');
    expect(await f.counts()).toEqual({ auto: 1, proposals: 1, seals: 1, history: 0, receipts: 0 });
  });
  it('keeps Auto byte-identical after a manual Design change and the normal paired routing/Design revision transition', async () => {
    const f = await seed(), request = await admission(f); await complete(f, request);
    const before = (await pool.query('SELECT source,source_sha256 FROM pf_auto_lengths')).rows[0];
    await pool.query('UPDATE cables SET design_length=111 WHERE id=$1', [f.cableId]); expect((await f.cable()).cable_write_revision).toBe('1');
    // Exercise the production trigger used by Apply, not a human review here;
    // protected human Apply correctness is covered independently by B7 SQL.
    await principalTransaction(pool, f.projectId, f.who, async c => { await c.query("SET LOCAL wfc.pathfinder_apply='1'");
      await c.query("UPDATE cables SET routing='/REVIEWED',design_length=7 WHERE id=$1", [f.cableId]); });
    expect((await f.cable()).cable_write_revision).toBe('2'); expect((await f.cable()).install_length).toBe('123.45');
    expect((await pool.query('SELECT source,source_sha256 FROM pf_auto_lengths')).rows[0]).toEqual(before); expect((await view(f)).autoCalculatedLength).toBe(7);
  });
  it.each(['failed', 'cancelled'] as const)('retains a committed item success when its parent later becomes %s', async status => {
    const f = await seed(), request = await admission(f); await complete(f, request); await pool.query('UPDATE pf_jobs SET state=$2 WHERE id=$1', [request.jobId, status]);
    expect(await view(f)).toMatchObject({ autoCalculatedLength: 7, autoLengthStatus: 'last-successful', autoLengthMatchesLatestRequest: true });
  });
  it('shows a terminal failed item as blocked before its parent and siblings finish', async () => {
    const f = await seed(), request = await admission(f); await pool.query("UPDATE pf_job_items SET state='complete',status='no_path' WHERE job_id=$1", [request.jobId]);
    expect(await view(f)).toMatchObject({ autoCalculatedLength: null, autoLengthStatus: 'blocked' }); expect((await f.counts()).auto).toBe(0);
  });
  it.each(['admin', 'login'] as const)('refuses current %s revocation without an Auto side effect', async kind => {
    const f = await seed(), request = await admission(f);
    if (kind === 'admin') await pool.query('UPDATE users SET is_admin=false WHERE id=$1', [f.who.userId]);
    else await pool.query('UPDATE viewer_login_bindings SET revoked_at=now() WHERE login_id=$1', [f.who.loginId]);
    await expect(complete(f, request)).rejects.toMatchObject({ code: kind === 'admin' ? 'ADMIN_REQUIRED' : 'LOGIN_REVOKED' });
    expect((await f.counts()).auto).toBe(0); expect((await f.counts()).proposals).toBe(0);
  });
  it('ordinary display has only compact public fields and detects a rehashed false source label against immutable scalars', async () => {
    const f = await seed(), request = await admission(f); await complete(f, request);
    const result = await view(f); expect(Object.keys(result).sort()).toEqual(['autoCalculatedLength', 'autoLengthBarrierStatus', 'autoLengthCalculatedAt', 'autoLengthMatchesLatestRequest', 'autoLengthStatus']);
    expect(JSON.stringify(result)).not.toContain(f.projectId); expect(JSON.stringify(result)).not.toContain(f.cableId);
    const row = (await pool.query('SELECT source FROM pf_auto_lengths')).rows[0], changed = { ...row.source, barrierStatus: 'bypassed' };
    await pool.query('UPDATE pf_auto_lengths SET source=$1,source_sha256=$2', [changed, hash(changed)]);
    expect(await view(f)).toMatchObject({ autoCalculatedLength: null, autoLengthStatus: 'unavailable', autoLengthMatchesLatestRequest: false });
    const otherProject = randomUUID(); await pool.query('INSERT INTO projects VALUES($1)', [otherProject]);
    expect((await readAutoLengths(pool, otherProject, [f.cableId])).get(f.cableId)!.autoCalculatedLength).toBeNull();
  });
});
