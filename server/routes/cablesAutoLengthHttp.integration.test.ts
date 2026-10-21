// @vitest-environment node
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import express, { Router } from 'express';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import type { AutoLengthView } from '../../shared/pathfinderAutoLength.js';

const owned = vi.hoisted(() => ({ pool: undefined as Pool | undefined }));
// Only the database binding changes. Authentication, current-role/project
// gates, ordinary route handlers, Auto SQL reader and PF gate are production code.
vi.mock('../db.js', () => ({ get pool() {
  if (!owned.pool) throw new Error('The owned HTTP fixture has not been initialized.');
  return owned.pool;
} }));

/** Opt-in actual HTTP + SQL permission/projection regression. The compact Auto
 * source below is explicitly seeded synthetic read-model metadata, not an engine
 * execution, real model, publication/currentness proof, native parity or Apply.
 * Exact producer/publication/transaction proof belongs to autoLengthSql tests.
 * No running WFC installation, browser session or existing account is used. */
const fixturePath = process.env.PF_B7A_SQL_FIXTURE;
const SCHEMA = 'pfb7a_http';
const id = (last: number) => `b7a10000-0000-4000-8000-${String(last).padStart(12, '0')}`;
const PROJECT = id(1), CABLE = id(2), TYPE = id(3), BASIC = id(4), ENGINEER = id(5), UNASSIGNED = id(6),
  ADMISSION = id(7), JOB = id(8), PROPOSAL = id(9);
const hash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const EXPECTED_AUTO: AutoLengthView = { autoCalculatedLength: 7, autoLengthStatus: 'last-successful',
  autoLengthCalculatedAt: '2026-10-21T16:00:00.000Z', autoLengthBarrierStatus: 'no-barriers-declared', autoLengthMatchesLatestRequest: true };
let pool: Pool, server: Server | undefined, address = '';
let sign: typeof import('../auth.js')['signAccessToken'];
let queryObserver: MockInstance<Pool['query']>;
let tokens: { basic: string; engineer: string; unassigned: string; staleAdmin: string };

// Minimal actual ordinary-cable schema plus the immutable scalar tables needed
// by the real compact reader. No model/geometry/session tables are created:
// accidental access to them fails rather than silently supplying fake geometry.
const SQL = `
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,email text NOT NULL,first_name text,last_name text,
 is_admin boolean NOT NULL,role text NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id uuid PRIMARY KEY,change_log jsonb DEFAULT '[]',project_number text,name text,customer text,
 manager text,description text,secondary_tray_length numeric,connection_gap numeric,support_distance numeric,support_weight numeric,
 tray_load_safety_factor numeric,end_connection_length numeric,additional_bending_percent numeric,cable_layout_settings jsonb,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS user_project_access(user_id uuid REFERENCES users(id),project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,project_id));
CREATE TABLE IF NOT EXISTS material_supports(id uuid PRIMARY KEY,support_type text);
CREATE TABLE IF NOT EXISTS project_support_distances(project_id uuid REFERENCES projects(id) ON DELETE CASCADE,tray_type text,
 support_distance numeric,support_id uuid);
CREATE TABLE IF NOT EXISTS project_files(id uuid PRIMARY KEY,file_name text,content_type text);
CREATE TABLE IF NOT EXISTS project_tray_purpose_templates(project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
 tray_purpose text,project_file_id uuid);
CREATE TABLE IF NOT EXISTS cable_types(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
 name text,purpose text,material text,description text,manufacturer text,part_no text,remarks text,diameter_mm numeric,weight_kg_per_m numeric);
CREATE TABLE IF NOT EXISTS cables(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 cable_id integer NOT NULL,revision text,mto text,tag text,cable_type_id uuid REFERENCES cable_types(id),from_location text,to_location text,
 routing text,delivery text,design_length integer,install_length integer,pull_date date,connected_from date,connected_to date,tested date,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),cable_write_revision bigint NOT NULL DEFAULT 0,
 UNIQUE(project_id,id));
CREATE TABLE IF NOT EXISTS cable_versions(id uuid PRIMARY KEY,cable_id uuid REFERENCES cables(id) ON DELETE CASCADE,version_number integer,
 change_type text,change_source text,cable_number integer,revision text,mto text,tag text,cable_type_id uuid,cable_type_name text,
 from_location text,to_location text,routing text,delivery text,design_length integer,install_length integer,pull_date date,
 connected_from date,connected_to date,tested date,changed_by uuid,changed_by_snapshot jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS pf_jobs(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id) ON DELETE CASCADE,state text,cancel_requested boolean,
 UNIQUE(project_id,id));
CREATE TABLE IF NOT EXISTS pf_revision_admissions(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id) ON DELETE CASCADE,job_id uuid,
 UNIQUE(project_id,id));
CREATE TABLE IF NOT EXISTS pf_revision_baselines(project_id uuid,admission_id uuid,cable_id uuid,status text,
 PRIMARY KEY(project_id,admission_id,cable_id));
CREATE TABLE IF NOT EXISTS pf_job_items(project_id uuid,job_id uuid,cable_id uuid,state text,status text,
 PRIMARY KEY(project_id,job_id,cable_id));
CREATE TABLE IF NOT EXISTS pf_proposals(id uuid PRIMARY KEY,project_id uuid,job_id uuid,cable_id uuid,status text,proposal_hash text,
 dependency_hash text,result jsonb,UNIQUE(project_id,id));
CREATE TABLE IF NOT EXISTS pf_revision_results(project_id uuid,admission_id uuid,job_id uuid,cable_id uuid,proposal_id uuid,
 record_sha256 text,engine_result_sha256 text,dependency_sha256 text,ledger_sha256 text,record jsonb,PRIMARY KEY(project_id,proposal_id));
`;

async function seed() {
  await pool.query('INSERT INTO projects(id,project_number,name,customer) VALUES($1,\'SYNTHETIC\',\'Synthetic HTTP project\',\'Test\')', [PROJECT]);
  for (const [user, role] of [[BASIC, 'basic'], [ENGINEER, 'engineer'], [UNASSIGNED, 'basic']])
    await pool.query('INSERT INTO users VALUES($1,$2,\'Synthetic\',\'Reader\',false,$3)', [user, `${user}@example.test`, role]);
  await pool.query('INSERT INTO user_project_access VALUES($1,$3),($2,$3)', [BASIC, ENGINEER, PROJECT]);
  await pool.query('INSERT INTO cable_types(id,project_id,name,purpose,diameter_mm,weight_kg_per_m) VALUES($1,$2,\'Synthetic type\',\'power\',10,0.3)', [TYPE, PROJECT]);
  await pool.query(`INSERT INTO cables(id,project_id,cable_id,revision,mto,tag,cable_type_id,from_location,to_location,routing,design_length,install_length)
    VALUES($1,$2,1,'A','LV','Synthetic cable',$3,'FROM','TO','/SYNTHETIC',99,123)`, [CABLE, PROJECT, TYPE]);
  await pool.query("INSERT INTO pf_jobs VALUES($1,$2,'running',false)", [JOB, PROJECT]);
  await pool.query('INSERT INTO pf_revision_admissions VALUES($1,$2,$3)', [ADMISSION, PROJECT, JOB]);
  await pool.query("INSERT INTO pf_revision_baselines VALUES($1,$2,$3,'ready')", [PROJECT, ADMISSION, CABLE]);
  await pool.query("INSERT INTO pf_job_items VALUES($1,$2,$3,'complete','calculated')", [PROJECT, JOB, CABLE]);
  const source = { schemaVersion: 'wfc.pf.auto-length-source.v1', projectId: PROJECT, cableId: CABLE, admissionId: ADMISSION,
    admissionOrdinal: '', jobId: JOB, proposalId: PROPOSAL, proposalHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64),
    engineResultHash: 'c'.repeat(64), revisionResultHash: 'd'.repeat(64), ledgerHash: 'e'.repeat(64), barrierEvidenceHash: 'f'.repeat(64),
    lengthMetersText: '7', calculatedAt: EXPECTED_AUTO.autoLengthCalculatedAt, barrierStatus: EXPECTED_AUTO.autoLengthBarrierStatus };
  await pool.query("INSERT INTO pf_proposals VALUES($1,$2,$3,$4,'calculated',$5,$6,$7)", [PROPOSAL, PROJECT, JOB, CABLE,
    source.proposalHash, source.dependencyHash, { barriers: { diagnostics: { status: source.barrierStatus } } }]);
  await pool.query('INSERT INTO pf_revision_results VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [PROJECT, ADMISSION, JOB, CABLE, PROPOSAL,
    source.revisionResultHash, source.engineResultHash, source.dependencyHash, source.ledgerHash,
    { summary: { designLengthMeters: '7' }, createdAt: source.calculatedAt }]);
  const ordinal = (await pool.query(`INSERT INTO pf_auto_length_admissions(project_id,admission_id,job_id,target_count,targets_sha256)
    VALUES($1,$2,$3,1,$4) RETURNING ordinal::text`, [PROJECT, ADMISSION, JOB, hash([CABLE])])).rows[0].ordinal as string;
  source.admissionOrdinal = ordinal;
  await pool.query('INSERT INTO pf_auto_length_targets VALUES($1,$2,$3)', [PROJECT, CABLE, ordinal]);
  await pool.query('INSERT INTO pf_auto_lengths VALUES($1,$2,$3,$4,$5,$6,$7)', [PROJECT, CABLE, ordinal, PROPOSAL, '7', source, hash(source)]);
  tokens = { basic: sign(BASIC, 'basic@example.test', false).token, engineer: sign(ENGINEER, 'engineer@example.test', false).token,
    unassigned: sign(UNASSIGNED, 'unassigned@example.test', false).token, staleAdmin: sign(ENGINEER, 'engineer@example.test', true).token };
}

async function call(route: string, token?: string, body?: unknown, method = 'GET') {
  const response = await fetch(address + route, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000), redirect: 'error' });
  return { status: response.status, body: await response.json() as Record<string, any> };
}
const cablePath = `/api/projects/${PROJECT}/cables`;

describe.runIf(Boolean(fixturePath))('PF-B7a owned actual ordinary HTTP authentication, project gates and Auto SQL projection', () => {
  beforeAll(async () => {
    const scratch = await realpath(fileURLToPath(new URL('../../pathfinder-engine/.scratch/', import.meta.url))), resolved = await realpath(fixturePath!);
    const relative = path.relative(scratch, resolved), parts = relative.split(path.sep);
    if (path.isAbsolute(relative) || relative.startsWith('..') || parts.length !== 2
      || !/^barrier-auto-length-20261021-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(parts[0]) || !/^[A-Za-z0-9_-]+[.]private[.]json$/.test(parts[1]))
      throw new Error('Refuse an HTTP fixture outside the newly owned B7a scratch directory.');
    const config = JSON.parse(await readFile(resolved, 'utf8')) as { database: string; url: string; owner: string };
    if (!/^wfc_pfb7a_[a-f0-9_]+$/.test(config.database) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.owner))
      throw new Error('Invalid B7a HTTP fixture identity.');
    const url = new URL(config.url);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.port !== '55442' || decodeURIComponent(url.pathname.slice(1)) !== config.database)
      throw new Error('Refuse a nonlocal or wrong-port HTTP fixture database.');
    pool = new Pool({ connectionString: config.url, options: `-c search_path=${SCHEMA},pg_catalog`, max: 5,
      connectionTimeoutMillis: 3000, query_timeout: 10_000 });
    const ownership = (await pool.query('SELECT current_database() AS db,owner FROM public.pfb7a_fixture_owner')).rows;
    if (ownership.length !== 1 || ownership[0].db !== config.database || ownership[0].owner !== config.owner)
      throw new Error('HTTP fixture ownership mismatch before DDL.');
    owned.pool = pool;
    // These values belong only to this in-memory test server. They are never
    // saved, printed, accepted by a running WFC or reused from a real account.
    vi.stubEnv('DATABASE_URL', config.url); vi.stubEnv('JWT_SECRET', randomBytes(48).toString('hex'));
    vi.stubEnv('MINIO_ACCESS_KEY', 'pfb7a-http-test'); vi.stubEnv('MINIO_SECRET_KEY', randomBytes(48).toString('hex'));
    vi.stubEnv('MINIO_ENDPOINT', '127.0.0.1'); vi.stubEnv('MINIO_PORT', '1'); vi.stubEnv('API_USE_HTTPS', 'false');
    const [{ initializeAutoLengthSchema }, middleware, { cablesRouter }, { createPurposePolicyRouter }, auth] = await Promise.all([
      import('../pathfinder/autoLengthSchema.js'), import('../middleware.js'), import('./cablesRoutes.js'),
      import('../pathfinder/purposePolicyRoutes.js'), import('../auth.js'),
    ]);
    sign = auth.signAccessToken;
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`); await pool.query(SQL); await initializeAutoLengthSchema(pool);
    const triggerSource = await readFile(new URL('../pathfinder/schema.ts', import.meta.url), 'utf8'),
      start = triggerSource.indexOf('CREATE OR REPLACE FUNCTION own_cable_write_revision()'),
      end = triggerSource.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS cables_project_record_identity', start);
    if (start < 0 || end < start) throw new Error('Production cable revision trigger is unavailable.');
    await pool.query(triggerSource.slice(start, end));
    const app = express();
    // Same relevant mount order and exact middleware functions as app.ts and
    // projectsRoutes.ts. Unrelated app sections/runtime lifecycle are excluded.
    app.use('/api/projects/:projectId/pathfinder', createPurposePolicyRouter(pool));
    app.use(express.json());
    const projects = Router();
    projects.use(middleware.authenticate, middleware.loadCurrentUserRole, middleware.requireProjectReadOnly);
    projects.use('/:projectId', middleware.requireProjectAccess);
    projects.use('/:projectId/cables', cablesRouter);
    app.use('/api/projects', projects);
    server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); listening.once('error', reject);
    });
    const bound = server.address(); if (!bound || typeof bound === 'string' || bound.address !== '127.0.0.1') throw new Error('HTTP fixture did not bind loopback.');
    address = `http://127.0.0.1:${bound.port}`;
    queryObserver = vi.spyOn(pool, 'query');
  });

  beforeEach(async () => {
    // The deliberately minimal scalar source tables do not model every
    // production FK. Reset them explicitly inside this owned schema as well.
    await pool.query(`TRUNCATE ${SCHEMA}.projects,${SCHEMA}.users,${SCHEMA}.pf_revision_baselines,
      ${SCHEMA}.pf_job_items,${SCHEMA}.pf_proposals,${SCHEMA}.pf_revision_results CASCADE`);
    await seed(); queryObserver.mockClear();
  });
  afterAll(async () => {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); }
    queryObserver?.mockRestore(); await pool?.end(); owned.pool = undefined; vi.unstubAllEnvs();
  });

  it.each(['basic', 'engineer'] as const)('allows an assigned ordinary %s to read only the five compact Auto fields alongside existing cable values', async role => {
    const response = await call(cablePath, tokens[role]); expect(response.status).toBe(200);
    expect(response.body.cables).toHaveLength(1); const cable = response.body.cables[0] as Record<string, unknown>;
    expect(cable).toMatchObject({ ...EXPECTED_AUTO, routing: '/SYNTHETIC', designLength: 99, installLength: 123 });
    expect(Object.keys(cable).filter(key => key.startsWith('auto')).sort()).toEqual(Object.keys(EXPECTED_AUTO).sort());
    for (const key of ['dependencies', 'barriers', 'model', 'geometry', 'source', 'record', 'proposalId', 'barrierEvidenceHash']) expect(cable).not.toHaveProperty(key);
    const queries = queryObserver.mock.calls.map(([sql]) => String(sql));
    expect(queries.some(sql => sql.includes('auto-length:read'))).toBe(true);
    expect(queries.every(sql => /^\s*(?:\/\*[\s\S]*?\*\/\s*)?SELECT\b/i.test(sql))).toBe(true);
    expect(queries.join('\n')).not.toMatch(/\b(?:model_versions|pf_artifacts|pf_barrier_heads|pf_model_objects|pf_location_bindings|viewer_login_bindings)\b/);
  });

  it('requires a bearer before any ordinary cable or Auto query', async () => {
    expect((await call(cablePath)).status).toBe(401); expect(queryObserver).not.toHaveBeenCalled();
    expect((await call(cablePath, 'synthetic-invalid-token')).status).toBe(401); expect(queryObserver).not.toHaveBeenCalled();
  });

  it('requires a basic reader project assignment before the ordinary cable and Auto read', async () => {
    const response = await call(cablePath, tokens.unassigned); expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain('autoCalculatedLength');
    expect(queryObserver.mock.calls.map(([sql]) => String(sql)).join('\n')).not.toContain('auto-length:read');
  });

  it('denies PF access to ordinary readers and ignores a stale JWT admin claim using the current account role', async () => {
    for (const token of [tokens.basic, tokens.engineer, tokens.staleAdmin]) {
      const response = await call(`/api/projects/${PROJECT}/pathfinder/routing-permissions`, token);
      expect(response.status).toBe(403); expect(response.body.code).toBe('ADMIN_REQUIRED');
      expect(JSON.stringify(response.body)).not.toMatch(/autoCalculatedLength|source|barrierEvidence|contentFingerprint/);
    }
    expect((await call(cablePath, tokens.staleAdmin)).status).toBe(200);
  });

  it.each(['autoCalculatedLength', 'autoLengthStatus', 'autoLengthCalculatedAt', 'autoLengthBarrierStatus', 'autoLengthMatchesLatestRequest'])(
    'rejects injectable %s on an otherwise authorized engineer PATCH without changing any saved cable/Auto value', async field => {
      const before = (await pool.query('SELECT to_jsonb(c) AS value FROM cables c WHERE id=$1', [CABLE])).rows[0].value;
      const response = await call(`${cablePath}/${CABLE}`, tokens.engineer, { designLength: 41, [field]: 999 }, 'PATCH');
      expect(response.status).toBe(400);
      expect((await pool.query('SELECT to_jsonb(c) AS value FROM cables c WHERE id=$1', [CABLE])).rows[0].value).toEqual(before);
      const read = await call(cablePath, tokens.basic); expect(read.body.cables[0]).toMatchObject({ ...EXPECTED_AUTO, designLength: 99 });
      expect((await pool.query('SELECT count(*)::int count FROM cable_versions')).rows[0].count).toBe(0);
    });

  it('permits an assigned engineer Design edit while retaining the checked Auto value, installed length and separate manual history', async () => {
    const response = await call(`${cablePath}/${CABLE}`, tokens.engineer, { designLength: 41 }, 'PATCH');
    expect(response.status).toBe(200); expect(response.body.cable).toMatchObject({ ...EXPECTED_AUTO, designLength: 41, installLength: 123 });
    const saved = (await pool.query('SELECT design_length,install_length,cable_write_revision::text FROM cables WHERE id=$1', [CABLE])).rows[0];
    expect(saved).toEqual({ design_length: 41, install_length: 123, cable_write_revision: '1' });
    const history = (await pool.query('SELECT change_source,design_length,install_length FROM cable_versions')).rows;
    expect(history).toEqual([{ change_source: 'manual', design_length: 41, install_length: 123 }]);
    expect((await pool.query('SELECT length_text FROM pf_auto_lengths')).rows).toEqual([{ length_text: '7' }]);
  });

  it('immediately denies Design writes after a current-role downgrade despite the still valid old token', async () => {
    await pool.query("UPDATE users SET role='basic',is_admin=false WHERE id=$1", [ENGINEER]);
    expect((await call(`${cablePath}/${CABLE}`, tokens.staleAdmin, { designLength: 41 }, 'PATCH')).status).toBe(403);
    expect((await call(cablePath, tokens.staleAdmin)).status).toBe(200);
    expect((await pool.query('SELECT design_length FROM cables WHERE id=$1', [CABLE])).rows[0].design_length).toBe(99);
  });
});
