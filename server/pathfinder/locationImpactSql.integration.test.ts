// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cableEndpointCommandSchema } from '../../shared/pathfinderCableEndpoints.js';
import { createCableEndpointCommands } from './cableEndpointCommands.js';
import { initializeEndpointBindingSchema } from './endpointBindingSchema.js';
import { CABLE_ENDPOINT_SELECTION_INDEX_SQL } from './cableEndpointSelectionSchema.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace } from './geometryTraceBuilder.js';
import { initializeLocationImpactSchema } from './locationImpactSchema.js';
import { cancelLocationImpactForJob, createLocationImpactRepository, readLocationImpactJobAuthority } from './locationImpactRepository.js';
import { createLocationImpactProducer } from './locationImpactProducer.js';
import { RECALCULATION_SQL } from './recalculationSchema.js';
import { PathFinderError } from './errors.js';

// Actual PostgreSQL slice: real v2 endpoint commands, principal transactions,
// immutable geometry, deferred latest-target FK, intent/member/enrollment schema,
// claim/producer and finite authority checks. The admission callback is explicitly
// synthetic: it writes minimal owned jobs/items, without engine/dependency work.
// The genuine row-event function writes a test journal rather than a scheduler.
// This is not full deployed-schema, HTTP/UI, calculation or engineering parity.
const fixturePath = process.env.PF_U3_SQL_FIXTURE;
const id = (n: number) => `af310000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const who = { userId: id(2), loginId: id(3), loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
const schemaName = 'pfu3_impacts', logicalName = 'SHARED LOCATION';
const cableIds = Array.from({ length: 20 }, (_, at) => id(100 + at));
let pool: Pool, commands: ReturnType<typeof createCableEndpointCommands>, sample: ReturnType<typeof geometryTraceFixture>;
let repository: ReturnType<typeof createLocationImpactRepository>, admittedScopes: string[][];
const schema = `
CREATE TABLE projects(id uuid PRIMARY KEY);
CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL,pf_admin_revision bigint NOT NULL DEFAULT 0);
CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
CREATE TABLE cables(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),cable_write_revision bigint NOT NULL DEFAULT 7,
 from_location text,to_location text,mto text,routing text,design_length numeric,install_length numeric,revision text,UNIQUE(project_id,id));
CREATE TABLE pf_project_state(project_id uuid PRIMARY KEY REFERENCES projects(id),registry_revision bigint NOT NULL,updated_at timestamptz DEFAULT now());
CREATE TABLE pf_locations(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),name text NOT NULL,revision bigint NOT NULL DEFAULT 1,
 created_by uuid NOT NULL,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(project_id,id));
CREATE TABLE pf_location_aliases(project_id uuid,normalized_alias text,display_alias text,location_id uuid,PRIMARY KEY(project_id,normalized_alias),
 FOREIGN KEY(project_id,location_id) REFERENCES pf_locations(project_id,id) ON DELETE CASCADE);
CREATE TABLE project_model_selections(project_id uuid PRIMARY KEY REFERENCES projects(id),active_model_version_id uuid,selection_revision bigint);
CREATE TABLE model_versions(project_id uuid REFERENCES projects(id),id uuid,content_fingerprint text,state text,health text,PRIMARY KEY(project_id,id));
CREATE TABLE pf_project_preparations(project_id uuid PRIMARY KEY REFERENCES projects(id),current_aggregate_id uuid,current_artifact_id uuid,geometry_revision bigint);
CREATE TABLE pf_preparation_aggregates(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),session_id uuid,model_version_id uuid,
 artifact_id uuid,geometry_revision bigint,manifest jsonb NOT NULL,UNIQUE(project_id,id));
CREATE TABLE pf_artifacts(project_id uuid REFERENCES projects(id),id uuid,model_version_id uuid,snapshot_sha256 text,snapshot_bytes bigint,content_fingerprint text,PRIMARY KEY(project_id,id));
CREATE TABLE pf_geometry_trace_sets(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),aggregate_id uuid,model_version_id uuid,
 manifest jsonb NOT NULL,created_at timestamptz DEFAULT now(),UNIQUE(project_id,id),FOREIGN KEY(project_id,aggregate_id) REFERENCES pf_preparation_aggregates(project_id,id));
CREATE TABLE pf_model_objects(project_id uuid,artifact_id uuid,object_id text,db_id integer,geometry_role text,visibility text,
 PRIMARY KEY(project_id,artifact_id,object_id),FOREIGN KEY(project_id,artifact_id) REFERENCES pf_artifacts(project_id,id));
CREATE TABLE pf_geometry_object_revisions(id uuid PRIMARY KEY,project_id uuid,trace_id uuid,object_id text,summary jsonb NOT NULL,record jsonb NOT NULL,
 UNIQUE(project_id,trace_id,object_id),FOREIGN KEY(project_id,trace_id) REFERENCES pf_geometry_trace_sets(project_id,id));
CREATE TABLE pf_location_bindings(project_id uuid,location_id uuid,model_version_id uuid,revision bigint,point jsonb,object_id text,derivation text,confirmed_at timestamptz,
 PRIMARY KEY(project_id,location_id,model_version_id));
CREATE TABLE pf_installation_state(singleton boolean PRIMARY KEY CHECK(singleton),installation_epoch uuid NOT NULL);
CREATE TABLE pf_jobs(project_id uuid NOT NULL REFERENCES projects(id),id uuid NOT NULL,requested_by uuid NOT NULL,login_id uuid NOT NULL,
 login_expires_at timestamptz NOT NULL,authority_kind text NOT NULL,state text NOT NULL,cancel_requested boolean NOT NULL DEFAULT false,completed integer NOT NULL DEFAULT 0,
 PRIMARY KEY(project_id,id));
CREATE TABLE pf_job_items(project_id uuid NOT NULL,job_id uuid NOT NULL,cable_id uuid NOT NULL,state text NOT NULL DEFAULT 'waiting',
 PRIMARY KEY(project_id,job_id,cable_id),FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id));
CREATE TABLE pfu3_event_journal(project_id uuid,domain text,reason text,source_revision text);
CREATE OR REPLACE FUNCTION pf_recalculation_dirty(pid uuid,kind text,why text,source_value text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN INSERT INTO pfu3_event_journal VALUES(pid,kind,why,source_value);END $$;
`;
async function seed() {
  sample = geometryTraceFixture(); const built = buildGeometryTrace(sample), aggregate = sample.aggregate, projectId = aggregate.projectId;
  await pool.query('INSERT INTO projects VALUES($1)', [projectId]); await pool.query('INSERT INTO users VALUES($1,true,8)', [who.userId]);
  await pool.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)', [who.loginId, who.userId, new Date(who.loginExpiresAt)]);
  await pool.query('INSERT INTO pf_installation_state VALUES(true,$1)', [id(4)]);
  await pool.query('INSERT INTO pf_project_state(project_id,registry_revision) VALUES($1,4)', [projectId]);
  await pool.query('INSERT INTO project_model_selections VALUES($1,$2,$3)', [projectId, aggregate.modelVersionId, aggregate.selectionRevision]);
  await pool.query("INSERT INTO model_versions VALUES($1,$2,$3,'ready','healthy')", [projectId, aggregate.modelVersionId, aggregate.contentFingerprint]);
  await pool.query('INSERT INTO pf_artifacts VALUES($1,$2,$3,$4,$5,$6)', [projectId, aggregate.artifactId, aggregate.modelVersionId,
    aggregate.projection.sha256, aggregate.projection.bytes, aggregate.contentFingerprint]);
  await pool.query('INSERT INTO pf_preparation_aggregates VALUES($1,$2,$3,$4,$5,$6,$7)', [aggregate.id, projectId, aggregate.sessionId,
    aggregate.modelVersionId, aggregate.artifactId, aggregate.geometryRevision, aggregate]);
  await pool.query('INSERT INTO pf_project_preparations VALUES($1,$2,$3,$4)', [projectId, aggregate.id, aggregate.artifactId, aggregate.geometryRevision]);
  await pool.query('INSERT INTO pf_geometry_trace_sets(id,project_id,aggregate_id,model_version_id,manifest) VALUES($1,$2,$3,$4,$5)',
    [sample.traceId, projectId, aggregate.id, aggregate.modelVersionId, built.manifest]);
  for (const [at, record] of built.records.entries()) {
    await pool.query("INSERT INTO pf_model_objects VALUES($1,$2,$3,$4,$5,'unknown')", [projectId, aggregate.artifactId, record.identity.objectId, record.identity.dbId, record.geometry.role]);
    await pool.query('INSERT INTO pf_geometry_object_revisions VALUES($1,$2,$3,$4,$5,$6)', [record.id, projectId, sample.traceId, record.identity.objectId, built.summaries[at], record]);
  }
  for (const [at, cableId] of cableIds.entries()) await pool.query(`INSERT INTO cables VALUES($1,$2,7,$3,$4,$5,'/EXISTING/SECONDARY',42,39,'business-original')`,
    [cableId, projectId, at % 2 ? 'OTHER' : logicalName, at % 2 ? logicalName : 'OTHER', at === 3 ? 'MV' : at === 4 ? 'Unknown' : at === 1 ? 'Control' : at === 2 ? 'Instrumentation' : 'LV']);
  await pool.query('TRUNCATE pfu3_event_journal');
  admittedScopes = [];
  repository = createLocationImpactRepository(pool, { admitInTransaction: async (client, input) => {
    input.signal.throwIfAborted(); await input.beforeInsert(); const jobId = randomUUID(); admittedScopes.push([...input.cableIds]);
    await client.query("INSERT INTO pf_jobs(project_id,id,requested_by,login_id,login_expires_at,authority_kind,state) VALUES($1,$2,$3,$4,$5,'current-login','queued')",
      [input.projectId, jobId, input.principal.userId, input.principal.loginId, new Date(input.principal.loginExpiresAt)]);
    await client.query('INSERT INTO pf_job_items(project_id,job_id,cable_id) SELECT $1,$2,unnest($3::uuid[])', [input.projectId, jobId, input.cableIds]);
    return { jobId, inputSha256: 'e'.repeat(64), total: input.cableIds.length, readyCables: input.cableIds.length, blockedCables: 0 };
  } });
}
async function state() {
  return (await pool.query(`SELECT
    (SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1) registry,
    (SELECT count(*)::int FROM pf_endpoint_binding_revisions) bindings,(SELECT count(*)::int FROM pf_endpoint_binding_commands) commands,
    (SELECT count(*)::int FROM pf_location_impacts) impacts,(SELECT count(*)::int FROM pf_location_impact_items) items,
    (SELECT count(*)::int FROM pf_location_impact_targets) targets,(SELECT count(*)::int FROM pf_location_impact_enrollments) enrollments,
    (SELECT count(*)::int FROM pf_jobs) jobs,(SELECT count(*)::int FROM pfu3_event_journal) events,
    (SELECT md5(string_agg(to_jsonb(c)::text,E'\\n' ORDER BY id)) FROM cables c) cable_hash`, [sample.aggregate.projectId])).rows[0];
}
async function commandFor(cableId = cableIds[0], end: 'from' | 'to' = 'from', version: 'v1' | 'v2' = 'v2') {
  const projectId = sample.aggregate.projectId, context = await commands.context(projectId, who, cableId, end);
  if (!context.current || !context.logicalName) throw new Error('Synthetic context must be bindable.');
  const selected = await commands.selection(projectId, who, cableId, end, 5, context.contextSha256);
  if (selected.selection.status !== 'available' || !selected.selection.object) throw new Error('Synthetic retained object must be available.');
  return cableEndpointCommandSchema.parse({ schemaVersion: `wfc.pf.cable-endpoint-command.${version}`, idempotencyKey: randomUUID(),
    expectedContextSha256: context.contextSha256, expectedCableWriteRevision: context.cableWriteRevision, expectedLogicalName: context.logicalName,
    expectedRegistryRevision: context.registryRevision, expectedLocationId: context.location?.id ?? null, expectedLocationRevision: context.location?.revision ?? null,
    expectedHeadId: context.head?.id ?? null, expectedCurrent: context.current, reason: 'Synthetic SQL scoped location recalculation.',
    selection: { mode: 'object-derived', sdkObjectId: 5, object: selected.selection.object },
    ...(version === 'v2' ? { calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 } } : {}) });
}
async function save(cableId = cableIds[0], end: 'from' | 'to' = 'from', version: 'v1' | 'v2' = 'v2') {
  return commands.save(sample.aggregate.projectId, who, cableId, end, await commandFor(cableId, end, version));
}
async function due() { await pool.query("UPDATE pf_location_impact_dispatch SET due_at=clock_timestamp()-interval '1 second' WHERE status='pending'"); }
async function admitted() {
  await due(); const claim = await repository.claimNext(); if (!claim) throw new Error('Synthetic intent must be claimable.');
  const result = await repository.enrollClaim(claim); if (!result.jobId) throw new Error('Synthetic admission must retain its linked job.');
  return { claim, result, jobId: result.jobId };
}

describe.runIf(Boolean(fixturePath))('PF-U3 actual same-transaction location impact and targeted producer slice in an owned schema', () => {
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
    pool = new Pool({ connectionString: config.url, options: `-c search_path=${schemaName},pg_catalog`, max: 3, connectionTimeoutMillis: 3000, query_timeout: 20000 });
    const identity = (await pool.query('SELECT current_database() AS db,owner FROM public.pfu3_fixture_owner')).rows;
    if (identity.length !== 1 || identity[0].db !== config.database || identity[0].owner !== config.owner) throw new Error('Fixture owner mismatch before any DDL.');
    await pool.query(`CREATE SCHEMA ${schemaName}`); await pool.query(schema); await pool.query(CABLE_ENDPOINT_SELECTION_INDEX_SQL);
    await initializeEndpointBindingSchema(pool); await initializeLocationImpactSchema(pool); commands = createCableEndpointCommands(pool);
    const start = RECALCULATION_SQL.indexOf('CREATE OR REPLACE FUNCTION pf_recalculation_row_event()');
    const end = RECALCULATION_SQL.indexOf('CREATE OR REPLACE FUNCTION pf_recalculation_cable_insert()', start);
    if (start < 0 || end <= start) throw new Error('Production row-event function boundary changed; review this slice.');
    await pool.query(RECALCULATION_SQL.slice(start, end));
    for (const table of ['pf_project_state', 'pf_endpoint_binding_heads']) await pool.query(`CREATE TRIGGER pfu3_event AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION pf_recalculation_row_event()`);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE pfu3_impacts.projects,pfu3_impacts.users,pfu3_impacts.viewer_login_bindings,pfu3_impacts.pf_installation_state CASCADE'); await seed();
  });
  afterAll(async () => { await pool?.end(); });

  it('v2 save atomically records one shared impact with exact category targets and no cable/global scheduler changes', async () => {
    const before = await state(), command = await commandFor(), receipt = await commands.save(sample.aggregate.projectId, who, cableIds[0], 'from', command);
    expect(receipt.locationImpact).toMatchObject({ status: 'pending', eligibleCables: 18, excludedMvCables: 1, blockedCategoryCables: 1 });
    expect(await state()).toMatchObject({ registry: '5', bindings: 1, commands: 1, impacts: 1, items: 19, targets: 19, jobs: 0, enrollments: 0, events: 0, cable_hash: before.cable_hash });
    expect(await commands.save(sample.aggregate.projectId, who, cableIds[0], 'from', command)).toEqual({ ...receipt, duplicate: true });
    expect((await state()).impacts).toBe(1);
    const targets = (await pool.query('SELECT cable_id,generation::text FROM pf_location_impact_targets ORDER BY cable_id')).rows;
    expect(targets.map(row => row.cable_id)).not.toContain(cableIds[3]); expect(targets.every(row => row.generation === '1')).toBe(true);
  });
  it('v1 retains global row events and v2 local suppression never leaks to later transactions', async () => {
    const before = await state(); const legacy = await save(cableIds[0], 'from', 'v1'); expect(legacy.locationImpact).toBeUndefined();
    expect(await state()).toMatchObject({ impacts: 0, jobs: 0, events: 2, cable_hash: before.cable_hash });
    await pool.query('TRUNCATE pfu3_event_journal'); await save(); expect((await state()).events).toBe(0);
    await pool.query('UPDATE pf_project_state SET registry_revision=registry_revision+1 WHERE project_id=$1', [sample.aggregate.projectId]);
    expect((await state()).events).toBe(1);
  });
  it('actual producer claims and enrolls one exact nonMV scope into one linked job without a browser or cable writes', async () => {
    await save(); const before = await state(); await due(); const producer = createLocationImpactProducer(repository);
    try { await producer.tick(); } finally { await producer.stop(); }
    expect(admittedScopes).toHaveLength(1); expect(admittedScopes[0]).toHaveLength(18); expect(admittedScopes[0]).not.toContain(cableIds[3]); expect(admittedScopes[0]).not.toContain(cableIds[4]);
    expect(await state()).toMatchObject({ jobs: 1, enrollments: 1, events: 0, cable_hash: before.cable_hash });
    const enrollment = (await pool.query('SELECT job_id,total,ready_cables FROM pf_location_impact_enrollments')).rows[0];
    expect(enrollment).toMatchObject({ total: 18, ready_cables: 18 });
    const client = await pool.connect(); try { expect(await readLocationImpactJobAuthority(client, { projectId: sample.aggregate.projectId, jobId: enrollment.job_id, cableId: cableIds[0] })).toMatchObject({ scope: 'location-impact', valid: true }); } finally { client.release(); }
  });
  it('two overlapping endpoint saves supersede only shared cable0 while cable1 remains current in the older job', async () => {
    await pool.query("UPDATE cables SET from_location='OTHER',to_location='OTHER'");
    await pool.query("UPDATE cables SET from_location='LOCATION A',to_location='LOCATION B',mto='LV' WHERE id=$1", [cableIds[0]]);
    await pool.query("UPDATE cables SET from_location='LOCATION A',mto='LV' WHERE id=$1", [cableIds[1]]);
    await pool.query("UPDATE cables SET to_location='LOCATION B',mto='LV' WHERE id=$1", [cableIds[2]]);
    await save(); const first = await admitted(); await save(cableIds[0], 'to'); const second = await admitted();
    expect(admittedScopes).toEqual([[cableIds[0], cableIds[1]], [cableIds[0], cableIds[2]]]);
    const client = await pool.connect(); try {
      expect(await readLocationImpactJobAuthority(client, { projectId: sample.aggregate.projectId, jobId: first.jobId, cableId: cableIds[0] })).toMatchObject({ valid: false, code: 'LOCATION_IMPACT_TARGET_SUPERSEDED' });
      expect(await readLocationImpactJobAuthority(client, { projectId: sample.aggregate.projectId, jobId: first.jobId, cableId: cableIds[1] })).toMatchObject({ valid: true });
      expect(await readLocationImpactJobAuthority(client, { projectId: sample.aggregate.projectId, jobId: first.jobId })).toMatchObject({ valid: true });
      expect(await readLocationImpactJobAuthority(client, { projectId: sample.aggregate.projectId, jobId: second.jobId, cableId: cableIds[0] })).toMatchObject({ valid: true });
    } finally { client.release(); }
    expect((await pool.query('SELECT generation::text FROM pf_location_impact_targets WHERE cable_id=$1', [cableIds[0]])).rows[0].generation).toBe('2');
  });
  it.each(['admin', 'login', 'restore'] as const)('fences a claimed intent after actual %s revocation with no admitted job', async kind => {
    await save(); await due(); const claim = await repository.claimNext(); expect(claim).not.toBeNull();
    if (kind === 'admin') await pool.query('UPDATE users SET pf_admin_revision=pf_admin_revision+1 WHERE id=$1', [who.userId]);
    if (kind === 'login') await pool.query('UPDATE viewer_login_bindings SET revoked_at=now() WHERE login_id=$1', [who.loginId]);
    if (kind === 'restore') await pool.query('UPDATE pf_installation_state SET installation_epoch=$1', [randomUUID()]);
    await expect(repository.enrollClaim(claim!)).rejects.toMatchObject({ code: kind === 'restore' ? 'LOCATION_IMPACT_RESTORE_FENCED' : kind === 'login' ? 'LOGIN_REVOKED' : 'LOCATION_IMPACT_AUTHORITY_EXPIRED' });
    expect(await state()).toMatchObject({ jobs: 0, enrollments: 0 }); expect(admittedScopes).toEqual([]);
    expect((await pool.query('SELECT status,due_at FROM pf_location_impact_dispatch')).rows[0]).toMatchObject({ status: kind === 'restore' ? 'restore-fenced' : 'awaiting-authority', due_at: null });
  });
  it.each(['deleted', 'MV'])('a live %s cable revokes only its item without blocking a surviving sibling', async kind => {
    await save(); const own = await admitted();
    if (kind === 'deleted') await pool.query('DELETE FROM cables WHERE id=$1', [cableIds[0]]);
    else await pool.query("UPDATE cables SET mto='MV' WHERE id=$1", [cableIds[0]]);
    const client = await pool.connect(); try {
      expect(await readLocationImpactJobAuthority(client, { projectId: sample.aggregate.projectId, jobId: own.jobId, cableId: cableIds[0] })).toMatchObject({ valid: false, code: 'LOCATION_IMPACT_TARGET_SUPERSEDED' });
      expect(await readLocationImpactJobAuthority(client, { projectId: sample.aggregate.projectId, jobId: own.jobId, cableId: cableIds[1] })).toMatchObject({ valid: true });
      expect(await readLocationImpactJobAuthority(client, { projectId: sample.aggregate.projectId, jobId: own.jobId })).toMatchObject({ valid: true });
    } finally { client.release(); }
  });
  it('terminal no_path/timeout admission errors cannot create an automatic retry storm', async () => {
    await save(); await due(); const claim = await repository.claimNext(); expect(claim).not.toBeNull();
    await repository.recordFailure(claim!, new PathFinderError('ENGINE_TIMEOUT', 503)); await due();
    expect(await repository.claimNext()).toBeNull(); expect((await pool.query('SELECT status,attempts,due_at FROM pf_location_impact_dispatch')).rows[0]).toMatchObject({ status: 'blocked', attempts: 1, due_at: null });
    expect(await state()).toMatchObject({ jobs: 0, enrollments: 0 });
  });
  it('cancellation clears only its enrolled dispatch and a late transient failure cannot revive it', async () => {
    await save(); const own = await admitted(), client = await pool.connect();
    try { expect(await cancelLocationImpactForJob(client, { projectId: sample.aggregate.projectId, jobId: own.jobId })).toBe(true); }
    finally { client.release(); }
    await repository.recordFailure(own.claim, new PathFinderError('ENDPOINT_DATABASE_BUSY', 503));
    expect((await pool.query('SELECT status,due_at,owner_token FROM pf_location_impact_dispatch')).rows[0]).toMatchObject({ status: 'cancelled', due_at: null, owner_token: null });
    expect((await state()).jobs).toBe(1);
  });
  it('retained immutable intent/member/enrollment rows reject updates and an explicit close creates no impact', async () => {
    const command = await commandFor(); await commands.close(sample.aggregate.projectId, who, cableIds[0], 'from', command);
    await expect(commands.save(sample.aggregate.projectId, who, cableIds[0], 'from', command)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_COMMAND_CLOSED' });
    expect((await state()).impacts).toBe(0); await save(); await admitted();
    for (const table of ['pf_location_impacts', 'pf_location_impact_items', 'pf_location_impact_enrollments'])
      await expect(pool.query(`UPDATE ${table} SET project_id=project_id`)).rejects.toThrow('immutable');
  });
});
