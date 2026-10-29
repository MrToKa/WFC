// @vitest-environment node
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeRevisionResultSchema, REVISION_RESULT_SQL } from './revisionResultSchema.js';

// Actual PostgreSQL schema-migration slice, separately owned from pfu3_impacts.
// Records are deliberately minimal synthetic DB constraint inputs, not claimed
// application-level engineering proofs, engine results, HTTP or runtime evidence.
const fixturePath = process.env.PF_U3_SQL_FIXTURE, schemaName = 'pfu3_revision_migration';
const id = (n: number) => `af320000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), jobId = id(10), cableId = id(20), proposalId = id(30), admissionId = id(40);
let pool: Pool, legacyBefore: string, legacyAfter: string;
const baseSchema = `
CREATE TABLE projects(id uuid PRIMARY KEY);
CREATE TABLE pf_jobs(project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id uuid NOT NULL,PRIMARY KEY(project_id,id));
CREATE TABLE pf_apply_receipts(project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,cable_id uuid NOT NULL,
 applied_at timestamptz NOT NULL DEFAULT now(),id uuid NOT NULL,PRIMARY KEY(project_id,id));
CREATE TABLE pf_proposals(project_id uuid NOT NULL,job_id uuid NOT NULL,cable_id uuid NOT NULL,id uuid PRIMARY KEY,
 FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE);
`;
async function seed() {
  await pool.query('INSERT INTO projects VALUES($1)', [projectId]);
  await pool.query('INSERT INTO pf_jobs SELECT $1,unnest($2::uuid[])', [projectId, [jobId, id(11), id(12)]]);
}
async function admission(input: { id?: string; kind?: string; generation?: number | null; jobId?: string | null } = {}) {
  await pool.query(`INSERT INTO pf_revision_admissions(id,project_id,job_id,generation,kind,input_sha256,options,model_ref,total,observed_events)
    VALUES($1,$2,$3,$4,$5,$6,'{}',NULL,1,'[]')`,
  [input.id ?? admissionId, projectId, input.jobId === undefined ? jobId : input.jobId, input.generation ?? null, input.kind ?? 'location-impact', 'a'.repeat(64)]);
}
async function admissionHash() {
  return (await pool.query("SELECT md5(string_agg(to_jsonb(a)::text,E'\\n' ORDER BY id)) AS hash FROM pf_revision_admissions a")).rows[0].hash as string;
}
async function baseline(value = { currentCable: { id: cableId } }, selectedCableId = cableId) {
  await pool.query('INSERT INTO pf_revision_baselines(project_id,admission_id,cable_id,baseline_sha256,baseline,status,message) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [projectId, admissionId, selectedCableId, 'a'.repeat(64), value, 'calculated', 'Synthetic DB baseline.']);
}
function resultRecord(overrides: Record<string, unknown> = {}) {
  return { projectId, admissionId, jobId, cableId, proposalId, baselineHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64),
    engineResultSha256: 'c'.repeat(64), revisionResultSha256: 'd'.repeat(64), ledgerHash: null, ...overrides };
}
async function result(input: { id?: string; admissionId?: string; jobId?: string; cableId?: string; proposalId?: string; record?: unknown } = {}) {
  await pool.query(`INSERT INTO pf_revision_results(id,project_id,admission_id,job_id,cable_id,proposal_id,
    baseline_sha256,dependency_sha256,engine_result_sha256,ledger_sha256,record_sha256,record)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11)`,
  [input.id ?? id(50), projectId, input.admissionId ?? admissionId, input.jobId ?? jobId, input.cableId ?? cableId, input.proposalId ?? proposalId,
    'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64), input.record ?? resultRecord()]);
}
async function proposal() { await pool.query('INSERT INTO pf_proposals VALUES($1,$2,$3,$4)', [projectId, jobId, cableId, proposalId]); }

describe.runIf(Boolean(fixturePath))('PF-U3 actual revision admission-kind migration and preserved SQL constraints in an owned schema', () => {
  beforeAll(async () => {
    const scratch = await realpath(fileURLToPath(new URL('../../pathfinder-engine/.scratch/', import.meta.url)));
    const resolved = await realpath(fixturePath!), relative = path.relative(scratch, resolved), parts = relative.split(path.sep);
    if (path.isAbsolute(relative) || relative.startsWith('..') || parts.length !== 2 || !/^location-impact-u3-[a-f0-9-]{36}$/.test(parts[0]) || !parts[1].endsWith('.private.json'))
      throw new Error('Refuse a fixture context outside its newly owned U3 scratch directory.');
    const config = JSON.parse(await readFile(resolved, 'utf8')) as { database: string; url: string; owner: string };
    if (!/^wfc_pfu3_[a-f0-9_]+$/.test(config.database) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(config.owner)) throw new Error('Refuse a nonfixture database or owner capability.');
    const url = new URL(config.url);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || decodeURIComponent(url.pathname.slice(1)) !== config.database)
      throw new Error('Refuse a nonlocal or mismatched fixture URL.');
    pool = new Pool({ connectionString: config.url, options: `-c search_path=${schemaName},pg_catalog`, max: 2, connectionTimeoutMillis: 3000, query_timeout: 20000 });
    const identity = (await pool.query('SELECT current_database() AS db,owner FROM public.pfu3_fixture_owner')).rows;
    if (identity.length !== 1 || identity[0].db !== config.database || identity[0].owner !== config.owner) throw new Error('Fixture owner mismatch before any DDL.');
    await pool.query(`CREATE SCHEMA ${schemaName}`); await pool.query(baseSchema);
    const start = REVISION_RESULT_SQL.indexOf('CREATE TABLE IF NOT EXISTS pf_revision_admissions');
    const end = REVISION_RESULT_SQL.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS pf_revision_admission_job', start);
    if (start < 0 || end <= start) throw new Error('Original admission DDL boundary changed; review the migration fixture.');
    // This is the actual old two-kind table definition in the production SQL,
    // not a hand-written approximation of PostgreSQL generated check names.
    await pool.query(REVISION_RESULT_SQL.slice(start, end)); await seed();
    await admission({ id: id(60), kind: 'manual' }); await admission({ id: id(61), kind: 'automatic', generation: 7, jobId: null });
    legacyBefore = await admissionHash(); await initializeRevisionResultSchema(pool); legacyAfter = await admissionHash();
  });
  beforeEach(async () => { await pool.query(`TRUNCATE ${schemaName}.projects CASCADE`); await seed(); });
  afterAll(async () => { await pool?.end(); });

  it('migrates the actual old two-kind constraints without changing existing manual/automatic records', async () => {
    expect(legacyAfter).toBe(legacyBefore); expect(legacyAfter).toMatch(/^[a-f0-9]{32}$/);
    const constraints = (await pool.query("SELECT conname FROM pg_constraint WHERE conrelid='pf_revision_admissions'::regclass")).rows.map(row => row.conname);
    expect(constraints).toContain('pf_revision_admission_kind_v2'); expect(constraints).toContain('pf_revision_admission_scope_v2');
    expect(constraints).not.toContain('pf_revision_admissions_kind_check'); expect(constraints).not.toContain('pf_revision_admissions_check');
    await admission({ kind: 'location-impact' });
  });
  it('normal schema initialization is idempotent and preserves both current records and one immutable trigger per table', async () => {
    await admission(); const before = await admissionHash(); await initializeRevisionResultSchema(pool); await initializeRevisionResultSchema(pool);
    expect(await admissionHash()).toBe(before);
    const triggers = (await pool.query(`SELECT c.relname,count(*)::int count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE t.tgname='pf_revision_result_immutable' AND c.relnamespace=$1::regnamespace GROUP BY c.relname ORDER BY c.relname`, [schemaName])).rows;
    expect(triggers).toEqual(['pf_revision_admissions', 'pf_revision_baselines', 'pf_revision_results'].map(relname => ({ relname, count: 1 })));
  });
  it('accepts manual/automatic/location-impact only with their exact generation/job scope', async () => {
    await admission({ id: id(60), kind: 'manual', jobId }); await admission({ id: id(61), kind: 'automatic', generation: 0, jobId: null });
    await admission({ id: id(62), kind: 'location-impact', jobId: id(11) });
    expect((await pool.query('SELECT kind,generation::text,job_id FROM pf_revision_admissions ORDER BY id')).rows).toEqual([
      { kind: 'manual', generation: null, job_id: jobId }, { kind: 'automatic', generation: '0', job_id: null },
      { kind: 'location-impact', generation: null, job_id: id(11) }]);
  });
  it('refuses invented kinds/generations and unowned nonautomatic jobs', async () => {
    for (const input of [{ kind: 'unknown' }, { kind: 'manual', generation: 1 }, { kind: 'location-impact', generation: 1 },
      { kind: 'manual', jobId: null }, { kind: 'location-impact', jobId: null }, { kind: 'automatic', generation: null },
      { kind: 'automatic', generation: -1 }, { kind: 'location-impact', jobId: id(999) }])
      await expect(admission(input)).rejects.toMatchObject({ code: input.jobId === id(999) ? '23503' : '23514' });
    expect((await pool.query('SELECT count(*)::int count FROM pf_revision_admissions')).rows[0].count).toBe(0);
  });
  it('retains one admission per job and one automatic admission per generation without constraining unrelated location impacts', async () => {
    await admission({ id: id(60) }); await expect(admission({ id: id(61) })).rejects.toMatchObject({ code: '23505' });
    await admission({ id: id(62), kind: 'automatic', generation: 9, jobId: null });
    await expect(admission({ id: id(63), kind: 'automatic', generation: 9, jobId: null })).rejects.toMatchObject({ code: '23505' });
    await admission({ id: id(64), jobId: id(11) }); expect((await pool.query('SELECT count(*)::int count FROM pf_revision_admissions')).rows[0].count).toBe(3);
  });
  it('retains immutable admission/baseline/result rows after the kind migration', async () => {
    await admission(); await baseline(); await proposal(); await result();
    for (const table of ['pf_revision_admissions', 'pf_revision_baselines', 'pf_revision_results']) {
      await expect(pool.query(`UPDATE ${table} SET project_id=project_id`)).rejects.toThrow('immutable');
      await expect(pool.query(`DELETE FROM ${table}`)).rejects.toThrow('immutable');
    }
    expect((await pool.query('SELECT count(*)::int count FROM pf_revision_results')).rows[0].count).toBe(1);
  });
  it('retains exact baseline cable identity and admission/job/cable/proposal foreign-key boundaries', async () => {
    await admission(); await expect(baseline({ currentCable: { id: id(999) } })).rejects.toMatchObject({ code: '23514' });
    await baseline(); await proposal();
    await expect(result({ jobId: id(11), record: resultRecord({ jobId: id(11) }) })).rejects.toMatchObject({ code: '23503' });
    await expect(result({ cableId: id(21), record: resultRecord({ cableId: id(21) }) })).rejects.toMatchObject({ code: '23503' });
    await expect(result({ proposalId: id(31), record: resultRecord({ proposalId: id(31) }) })).rejects.toMatchObject({ code: '23503' });
    await result();
  });
  it('retains exact result scope/hash/nullable-ledger closure instead of admitting a superficially linked JSON body', async () => {
    await admission(); await baseline(); await proposal();
    for (const record of [resultRecord({ engineResultSha256: 'f'.repeat(64) }), resultRecord({ baselineHash: 'f'.repeat(64) }),
      resultRecord({ revisionResultSha256: 'f'.repeat(64) }), resultRecord({ ledgerHash: 'f'.repeat(64) }), resultRecord({ projectId: id(999) }), {}])
      await expect(result({ record })).rejects.toMatchObject({ code: '23514' });
    await result(); await expect(result({ id: id(51) })).rejects.toMatchObject({ code: '23505' });
  });
});
