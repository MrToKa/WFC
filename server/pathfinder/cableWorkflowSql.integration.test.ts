// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCableWorkflowRepository } from './cableWorkflowRepository.js';
import { classifyCableWorkflow } from '../../shared/pathfinderCableWorkflow.js';
import { REVISION_RESULT_SQL } from './revisionResultSchema.js';

// Real PostgreSQL read/auth/cursor/metadata slice. Engineering-proof/geometry
// adapters are explicitly mocked here; their mocks do not establish parity.
vi.mock('./dependencies.js', async original => ({ ...await original<typeof import('./dependencies.js')>(),
  collectCommonCalculationInputs: vi.fn(async () => ({ inputs: null, bindingContext: null, status: 'model_required', message: '' })) }));
vi.mock('./endpointBindingRepository.js', () => ({ readCurrentEndpointBindingContext: async () => null,
  readNeededEndpointBindingHeads: async () => new Map() }));
vi.mock('./automaticEndpointCandidates.js', () => ({ readAutomaticEndpointCandidates: async () => new Map() }));
vi.mock('./cableWorkflowProof.js', () => ({ createCableWorkflowProofReader: () => ({ verified: async () => null,
  reviewable: async () => ({ currentness: 'unavailable', reviewable: false, reasonCodes: ['PROPOSAL_PROOF_UNAVAILABLE'] }), accepted: async () => false }) }));

const fixturePath = process.env.PF_U1_SQL_FIXTURE;
const id = (n: number) => 'cf100000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const projectId = id(1), who = { userId: id(2), loginId: id(3), loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
let pool: Pool, readPool: Pool;
const queries: string[] = [];
const schema = `
CREATE TABLE projects(id uuid PRIMARY KEY,pf_settings_revision bigint DEFAULT 0,connection_gap numeric DEFAULT 1,
 secondary_tray_length numeric DEFAULT 7,end_connection_length numeric DEFAULT 5,additional_bending_percent numeric DEFAULT 10);
CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL);
CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid,expires_at timestamptz,revoked_at timestamptz);
CREATE TABLE project_model_selections(project_id uuid PRIMARY KEY,active_model_version_id uuid,selection_revision bigint DEFAULT 0);
CREATE TABLE model_versions(project_id uuid,id uuid,content_fingerprint text,state text,health text);
CREATE TABLE pf_project_state(project_id uuid PRIMARY KEY,registry_revision bigint DEFAULT 0);
CREATE TABLE pf_project_preparations(project_id uuid PRIMARY KEY,current_aggregate_id uuid,current_artifact_id uuid,geometry_revision bigint DEFAULT 0);
CREATE TABLE pf_purpose_project_state(project_id uuid PRIMARY KEY,catalog_revision bigint DEFAULT 0,routing_policy_revision bigint DEFAULT 0);
CREATE TABLE pf_recalculation_state(project_id uuid PRIMARY KEY,desired_generation bigint DEFAULT 0);
CREATE TABLE pf_revision_comparison_targets(project_id uuid,target_aggregate_id uuid,target_model_version_id uuid,current_comparison_id uuid,
 comparison_revision bigint,decision_set_sha256 text);
CREATE TABLE cables(project_id uuid,id uuid PRIMARY KEY,cable_type_id uuid,cable_write_revision bigint DEFAULT 0,
 tag text,from_location text,to_location text,routing text,mto text,design_length numeric,install_length numeric);
CREATE INDEX cables_owned ON cables(project_id,id);
CREATE TABLE pf_revision_admissions(project_id uuid,id uuid PRIMARY KEY,job_id uuid,created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE pf_revision_baselines(project_id uuid,admission_id uuid,cable_id uuid,status text);
CREATE TABLE pf_jobs(project_id uuid,id uuid PRIMARY KEY,state text,cancel_requested boolean DEFAULT false);
CREATE TABLE pf_job_items(project_id uuid,job_id uuid,cable_id uuid,state text,status text);
CREATE TABLE pf_proposals(project_id uuid,id uuid PRIMARY KEY,job_id uuid,cable_id uuid,status text,proposal_hash text);
CREATE TABLE pf_location_aliases(project_id uuid,normalized_alias text,location_id uuid);
CREATE TABLE pf_locations(project_id uuid,id uuid,name text,revision bigint);
CREATE TABLE pf_location_bindings(project_id uuid,location_id uuid);
CREATE TABLE pf_apply_receipts(project_id uuid,cable_id uuid,applied_at timestamptz,id uuid);
`;
async function seed(count = 1, names?: string[]) {
  const data = Array.from({ length: count }, (_, index) => ({ id: id(1000 + index), tag: names?.[index] ?? `Synthetic ${index}` }));
  await pool.query(`INSERT INTO cables(project_id,id,cable_type_id,tag,from_location,to_location,mto)
    SELECT $1,id::uuid,$2,tag,'FROM','TO','LV' FROM jsonb_to_recordset($3::jsonb) AS x(id text,tag text)`, [projectId, id(9), JSON.stringify(data)]);
  return data;
}
const repository = () => createCableWorkflowRepository(readPool, { cursorKey: Buffer.alloc(32, 42) });

describe.runIf(Boolean(fixturePath))('PF-U1 real SQL slice in an explicitly owned disposable database', () => {
  beforeAll(async () => {
    const config = JSON.parse(await readFile(fixturePath!, 'utf8')) as { database: string; url: string; owner: string };
    if (!/^wfc_pfu1_[a-f0-9_]+$/.test(config.database) || !/^[a-f0-9-]{36}$/.test(config.owner)) throw Error('Refuse nonfixture database.');
    pool = new Pool({ connectionString: config.url, options: '-c search_path=pfu1_validation,public', max: 2, connectionTimeoutMillis: 3000, query_timeout: 5000 });
    const identity = (await pool.query('SELECT current_database() AS db,owner FROM public.pfu1_fixture_owner')).rows;
    if (identity.length !== 1 || identity[0].db !== config.database || identity[0].owner !== config.owner) throw Error('Fixture ownership mismatch.');
    // This reset is allowed only after the isolated database and private owner
    // capability match. The repository's GET calls below never perform this DDL.
    await pool.query('DROP SCHEMA IF EXISTS pfu1_validation CASCADE; CREATE SCHEMA pfu1_validation');
    await pool.query(schema);
    const baselineIndex = REVISION_RESULT_SQL.match(/CREATE INDEX IF NOT EXISTS pf_revision_baseline_cable[^;]+;/)?.[0];
    if (!baselineIndex) throw Error('The normal initialization must supply the cable lookup index.');
    await pool.query(baselineIndex);
    readPool = { connect: async () => {
      const client = await pool.connect();
      return { query: async (text: string, values?: unknown[]) => { queries.push(text); return client.query(text, values); }, release: (discard?: boolean) => client.release(discard) } as unknown as PoolClient;
    } } as unknown as Pool;
    await pool.query('INSERT INTO projects(id) VALUES($1)', [projectId]);
    await pool.query('INSERT INTO users VALUES($1,true)', [who.userId]);
    await pool.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)', [who.loginId, who.userId, new Date(who.loginExpiresAt)]);
    for (const table of ['project_model_selections', 'pf_project_state', 'pf_project_preparations', 'pf_purpose_project_state', 'pf_recalculation_state'])
      await pool.query(`INSERT INTO ${table}(project_id) VALUES($1)`, [projectId]);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE cables,pf_revision_admissions,pf_revision_baselines,pf_jobs,pf_job_items,pf_proposals');
    await pool.query('UPDATE users SET is_admin=true');
    await pool.query('UPDATE viewer_login_bindings SET revoked_at=NULL');
    queries.length = 0;
  });
  afterAll(async () => { await pool?.end(); });

  it('finds a literal target beyond the first400 project rows in its first page without DML', async () => {
    const names = Array.from({ length: 405 }, (_, index) => index === 404 ? 'Last_%\\target' : `Earlier ${index}`);
    const data = await seed(405, names), repo = repository();
    await pool.query('UPDATE cables SET tag=$2,mto=$3 WHERE id=$1', [data[403].id, 'Last_%\\target', 'MV']);
    await pool.query(`INSERT INTO cables(project_id,id,cable_type_id,tag,from_location,to_location,mto)
      VALUES($1,$2,$3,$4,'FROM','TO','LV')`, [id(99), id(999), id(9), 'Last_%\\target']);
    queries.length = 0;
    const first = await repo.page(projectId, who, { search: '_%\\target' });
    expect(first.rows.map(row => row.cable.id)).toEqual([data[404].id]); expect(first.scannedCount).toBe(1); expect(first.nextCursor).toBeNull();
    expect(queries.some(sql => /^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql))).toBe(false);
  });
  it('retains ASCII-search Unicode expansions and NFC matching without granting wildcard syntax', async () => {
    const data = await seed(7, ['Straße', 'STRASSE', '\u212aelvin', 'cafe\u0301_%\\', 'CAFÉ_%\\', 'CAFE.*', 'Earlier']);
    const repo = repository();
    const sharpS = await repo.page(projectId, who, { filter: 'all', search: 'strasse' });
    expect(sharpS.rows.map(row => row.cable.id)).toEqual([data[0].id, data[1].id]);
    const kelvin = await repo.page(projectId, who, { filter: 'all', search: 'KELVIN' });
    expect(kelvin.rows.map(row => row.cable.id)).toEqual([data[2].id]);
    const accent = await repo.page(projectId, who, { filter: 'all', search: ' CAFÉ_%\\ ' });
    expect(accent.rows.map(row => row.cable.id)).toEqual([data[3].id, data[4].id]);
    const literal = await repo.page(projectId, who, { filter: 'all', search: 'CAFE.*' });
    expect(literal.rows.map(row => row.cable.id)).toEqual([data[5].id]);
  });
  it('searches all three fields before the candidate limit and resumes matching pages without duplicates', async () => {
    const data = await seed(405);
    await pool.query('UPDATE cables SET from_location=$2 WHERE id=ANY($1::uuid[])', [data.slice(200, 402).map(row => row.id), 'shared-panel']);
    await pool.query('UPDATE cables SET to_location=$2 WHERE id=$1', [data[404].id, 'shared-panel']);
    const repo = repository(), ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await repo.page(projectId, who, { filter: 'all', search: 'SHARED-panel', cursor });
      ids.push(...page.rows.map(row => row.cable.id));
      expect(page.scannedCount).toBeLessThanOrEqual(200);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual([...data.slice(200, 402), data[404]].map(row => row.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('retains existing oversized-input refusal even for an ASCII text nonmatch', async () => {
    const data = await seed(2);
    await pool.query('UPDATE cables SET routing=$2 WHERE id=$1', [data[0].id, 'x'.repeat(8001)]);
    await expect(repository().page(projectId, who, { filter: 'all', search: 'NO-MATCH' }))
      .rejects.toMatchObject({ code: 'WORKFLOW_CABLE_INPUT_LIMIT', status: 413 });
  });
  it('stops at a requested10th match without consuming the next match; excludes MV and retains unknown categories', async () => {
    const data = await seed(22);
    await pool.query('UPDATE cables SET mto=$2 WHERE id=$1', [data[0].id, 'MV']);
    await pool.query('UPDATE cables SET mto=NULL WHERE id=$1', [data[1].id]);
    const repo = repository(), first = await repo.page(projectId, who, { filter: 'all', limit: 10 });
    expect(first.rows).toHaveLength(10); expect(first.scannedThroughCableId).toBe(data[10].id);
    expect(first.rows[0].mto).toBeNull(); expect(classifyCableWorkflow(first.rows[0]).status).toBe('blocked');
    const second = await repo.page(projectId, who, { filter: 'all', limit: 10, cursor: first.nextCursor });
    expect(second.rows[0].cable.id).toBe(data[11].id);
    expect(new Set([...first.rows, ...second.rows].map(row => row.cable.id)).size).toBe(20);
  });
  it('chooses a newer waiting/blocked admission instead of an older successful proposal', async () => {
    const data = await seed(2);
    for (const [n, state] of [[10, 'complete'], [20, 'running']] as const) {
      await pool.query('INSERT INTO pf_jobs(project_id,id,state) VALUES($1,$2,$3)', [projectId, id(n), state]);
      await pool.query('INSERT INTO pf_revision_admissions(project_id,id,job_id,created_at) VALUES($1,$2,$3,$4)', [projectId, id(n + 1), id(n), `2026-10-20T00:${n}:00Z`]);
      for (let index = 0; index < data.length; index++) {
        await pool.query('INSERT INTO pf_revision_baselines VALUES($1,$2,$3,$4)', [projectId, id(n + 1), data[index].id, n === 10 ? 'ready' : 'locations_required']);
        await pool.query('INSERT INTO pf_job_items VALUES($1,$2,$3,$4,$5)', [projectId, id(n), data[index].id,
          n === 10 ? 'complete' : index === 0 ? 'waiting' : 'blocked', n === 10 ? 'calculated' : 'locations_required']);
      }
    }
    await pool.query('INSERT INTO pf_proposals VALUES($1,$2,$3,$4,$5,$6)', [projectId, id(30), id(10), data[0].id, 'calculated', 'a'.repeat(64)]);
    const page = await repository().page(projectId, who, { filter: 'all' });
    expect(page.rows[0].calculation).toMatchObject({ jobId: id(20), jobStatus: 'running', itemState: 'waiting', outcome: 'not-evaluated', proposalId: null });
    expect(classifyCableWorkflow(page.rows[0]).status).toBe('calculating');
    expect(page.rows[1].calculation).toMatchObject({ jobId: id(20), itemState: 'blocked', outcome: 'locations-required', proposalId: null });
    expect(classifyCableWorkflow(page.rows[1]).status).not.toBe('calculating');
  });
  it('binds the cursor to context and detects an added admission even with an older creation timestamp', async () => {
    await seed(201); const repo = repository(), first = await repo.page(projectId, who, { filter: 'all' });
    await pool.query("INSERT INTO pf_revision_admissions(project_id,id,created_at) VALUES($1,$2,'2000-01-01')", [projectId, id(50)]);
    await expect(repo.page(projectId, who, { filter: 'all', cursor: first.nextCursor })).rejects.toMatchObject({ code: 'WORKFLOW_CURSOR_INVALID' });
  });
  it.each(['role', 'login'])('refuses current %s revocation without returning cable rows', async kind => {
    await seed();
    if (kind === 'role') await pool.query('UPDATE users SET is_admin=false');
    else await pool.query('UPDATE viewer_login_bindings SET revoked_at=clock_timestamp()');
    await expect(repository().page(projectId, who, {})).rejects.toMatchObject({ code: kind === 'role' ? 'ADMIN_REQUIRED' : 'LOGIN_REVOKED' });
    expect(queries.some(sql => sql.includes('cable-workflow:candidates'))).toBe(false);
  });
});
