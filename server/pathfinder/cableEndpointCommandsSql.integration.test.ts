// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cableEndpointCommandSchema, type CableEndpointContext } from '../../shared/pathfinderCableEndpoints.js';
import { createCableEndpointCommands } from './cableEndpointCommands.js';
import { initializeEndpointBindingSchema } from './endpointBindingSchema.js';
import { CABLE_ENDPOINT_SELECTION_INDEX_SQL } from './cableEndpointSelectionSchema.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace } from './geometryTraceBuilder.js';

// Actual command/auth/transaction/helper slice in a separate owned test schema.
// Every geometry record and anchor is produced by the genuine synthetic builder.
// No engineering adapter, principal check or binding writer is mocked. This does
// not prove HTTP/UI behavior, a complete deployed schema or real-model acceptance.
const fixturePath = process.env.PF_U2_SQL_FIXTURE;
const id = (n: number) => `cb200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const logicalName = 'CABLE LOGICAL ENDPOINT', alias = 'Shared endpoint alias';
const who = { userId: id(2), loginId: id(3), loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
const other = { userId: id(4), loginId: id(5), loginExpiresAt: who.loginExpiresAt };
let pool: Pool, commands: ReturnType<typeof createCableEndpointCommands>, sample: ReturnType<typeof geometryTraceFixture>;
const schema = `
CREATE TABLE projects(id uuid PRIMARY KEY);
CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL);
CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
CREATE TABLE cables(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),cable_write_revision bigint NOT NULL DEFAULT 7,
 from_location text,to_location text,mto text,routing text,design_length numeric,install_length numeric,revision text,
 UNIQUE(project_id,id));
CREATE TABLE pf_project_state(project_id uuid PRIMARY KEY REFERENCES projects(id),registry_revision bigint NOT NULL,updated_at timestamptz DEFAULT now());
CREATE TABLE pf_locations(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),name text NOT NULL,revision bigint NOT NULL DEFAULT 1,
 created_by uuid NOT NULL,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(project_id,id));
CREATE TABLE pf_location_aliases(project_id uuid,normalized_alias text,display_alias text,location_id uuid,
 PRIMARY KEY(project_id,normalized_alias),FOREIGN KEY(project_id,location_id) REFERENCES pf_locations(project_id,id) ON DELETE CASCADE);
CREATE TABLE project_model_selections(project_id uuid PRIMARY KEY REFERENCES projects(id),active_model_version_id uuid,selection_revision bigint);
CREATE TABLE model_versions(project_id uuid REFERENCES projects(id),id uuid,content_fingerprint text,state text,health text,PRIMARY KEY(project_id,id));
CREATE TABLE pf_project_preparations(project_id uuid PRIMARY KEY REFERENCES projects(id),current_aggregate_id uuid,current_artifact_id uuid,geometry_revision bigint);
CREATE TABLE pf_preparation_aggregates(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),session_id uuid,model_version_id uuid,
 artifact_id uuid,geometry_revision bigint,manifest jsonb NOT NULL,UNIQUE(project_id,id));
CREATE TABLE pf_artifacts(project_id uuid REFERENCES projects(id),id uuid,model_version_id uuid,snapshot_sha256 text,snapshot_bytes bigint,
 content_fingerprint text,PRIMARY KEY(project_id,id));
CREATE TABLE pf_geometry_trace_sets(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),aggregate_id uuid,model_version_id uuid,manifest jsonb NOT NULL,
 created_at timestamptz DEFAULT now(),UNIQUE(project_id,id),FOREIGN KEY(project_id,aggregate_id) REFERENCES pf_preparation_aggregates(project_id,id));
CREATE TABLE pf_model_objects(project_id uuid,artifact_id uuid,object_id text,db_id integer,geometry_role text,visibility text,
 PRIMARY KEY(project_id,artifact_id,object_id),FOREIGN KEY(project_id,artifact_id) REFERENCES pf_artifacts(project_id,id));
CREATE TABLE pf_geometry_object_revisions(id uuid PRIMARY KEY,project_id uuid,trace_id uuid,object_id text,summary jsonb NOT NULL,record jsonb NOT NULL,
 UNIQUE(project_id,trace_id,object_id),FOREIGN KEY(project_id,trace_id) REFERENCES pf_geometry_trace_sets(project_id,id));
CREATE TABLE pf_location_bindings(project_id uuid,location_id uuid,model_version_id uuid,revision bigint,point jsonb,object_id text,derivation text,
 confirmed_at timestamptz,PRIMARY KEY(project_id,location_id,model_version_id));
`;
const cableIds = Array.from({ length: 20 }, (_, at) => id(100 + at));

async function seed(useAliases = false) {
  sample = geometryTraceFixture(); const built = buildGeometryTrace(sample), aggregate = sample.aggregate, projectId = aggregate.projectId;
  await pool.query('INSERT INTO projects VALUES($1)', [projectId]);
  for (const principal of [who, other]) {
    await pool.query('INSERT INTO users VALUES($1,true)', [principal.userId]);
    await pool.query('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)', [principal.loginId, principal.userId, new Date(principal.loginExpiresAt)]);
  }
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
  const rows = cableIds.map((cableId, at) => ({ id: cableId,
    from: at < 5 || at >= 10 && at < 15 || at === 19 ? useAliases && at >= 10 && at < 15 ? alias : logicalName : 'OTHER',
    to: at >= 5 && at < 10 || at >= 15 ? useAliases && at >= 15 ? alias : logicalName : 'OTHER' }));
  await pool.query(`INSERT INTO cables(id,project_id,from_location,to_location,mto,routing,design_length,install_length,revision)
    SELECT id,$1,"from","to",'LV','/EXISTING/SECONDARY',42,39,'original-business-revision'
    FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,"from" text,"to" text)`, [projectId, JSON.stringify(rows)]);
  if (useAliases) {
    await pool.query('INSERT INTO pf_locations(id,project_id,name,revision,created_by) VALUES($1,$2,$3,1,$4)', [id(8), projectId, logicalName, who.userId]);
    for (const display of [logicalName, alias]) await pool.query('INSERT INTO pf_location_aliases VALUES($1,$2,$3,$4)', [projectId, display.toUpperCase(), display, id(8)]);
  }
}
async function state() {
  return (await pool.query(`SELECT
    (SELECT registry_revision::text FROM pf_project_state WHERE project_id=$1) AS registry,
    (SELECT count(*)::int FROM pf_locations) AS locations,(SELECT count(*)::int FROM pf_location_aliases) AS aliases,
    (SELECT count(*)::int FROM pf_endpoint_binding_revisions) AS revisions,(SELECT count(*)::int FROM pf_endpoint_binding_heads) AS heads,
    (SELECT count(*)::int FROM pf_endpoint_binding_commands) AS commands,
    (SELECT md5(string_agg(to_jsonb(c)::text,E'\\n' ORDER BY id)) FROM cables c) AS cable_hash`, [sample.aggregate.projectId])).rows[0];
}
async function commandFor(cableId = cableIds[0], end: 'from' | 'to' = 'from', principal = who, key = id(50)) {
  const projectId = sample.aggregate.projectId, context = await commands.context(projectId, principal, cableId, end);
  if (!context.current || !context.logicalName) throw new Error('Synthetic fixture must be bindable.');
  const selected = await commands.selection(projectId, principal, cableId, end, 5, context.contextSha256);
  if (selected.selection.status !== 'available' || !selected.selection.object) throw new Error('Synthetic fixture must retain its equipment anchor.');
  return { context, command: fromContext(context, key, selected.selection.object) };
}
function fromContext(context: CableEndpointContext, key: string, object: { traceId: string; objectRevisionId: string; recordSha256: string }) {
  return cableEndpointCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-command.v1', idempotencyKey: key,
    expectedContextSha256: context.contextSha256, expectedCableWriteRevision: context.cableWriteRevision, expectedLogicalName: context.logicalName,
    expectedRegistryRevision: context.registryRevision, expectedLocationId: context.location?.id ?? null, expectedLocationRevision: context.location?.revision ?? null,
    expectedHeadId: context.head?.id ?? null, expectedCurrent: context.current, reason: 'Synthetic SQL shared endpoint validation.',
    selection: { mode: 'object-derived', sdkObjectId: 5, object } });
}

describe.runIf(Boolean(fixturePath))('PF-U2 real atomic cable endpoint commands in their separately owned schema', () => {
  beforeAll(async () => {
    const config = JSON.parse(await readFile(fixturePath!, 'utf8')) as { database: string; url: string; owner: string };
    if (!/^wfc_pfu2_[a-f0-9_]+$/.test(config.database) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(config.owner))
      throw new Error('Refuse a nonfixture database or ownership capability.');
    const url = new URL(config.url);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || decodeURIComponent(url.pathname.slice(1)) !== config.database) throw new Error('Refuse a nonlocal or mismatched fixture URL.');
    pool = new Pool({ connectionString: config.url, options: '-c search_path=pfu2_commands,pg_catalog', max: 3, connectionTimeoutMillis: 3000, query_timeout: 20000 });
    const identity = (await pool.query('SELECT current_database() AS db,owner FROM public.pfu2_fixture_owner')).rows;
    if (identity.length !== 1 || identity[0].db !== config.database || identity[0].owner !== config.owner) throw new Error('Fixture ownership mismatch before schema creation.');
    await pool.query('CREATE SCHEMA pfu2_commands');
    await pool.query(schema); await pool.query(CABLE_ENDPOINT_SELECTION_INDEX_SQL);
    // Use the actual additive FK/immutable ledger initialization, not a mock or
    // handwritten approximation of binding commands/revisions/heads.
    await initializeEndpointBindingSchema(pool); commands = createCableEndpointCommands(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE pfu2_commands.projects,pfu2_commands.users,pfu2_commands.viewer_login_bindings CASCADE');
    await seed();
  });
  afterAll(async () => { await pool?.end(); });

  it('atomically creates one shared logical location/head/command for20cables, preserving every cable column', async () => {
    const before = await state(), { command } = await commandFor(), projectId = sample.aggregate.projectId;
    const receipt = await commands.save(projectId, who, cableIds[0], 'from', command), after = await state();
    expect(receipt).toMatchObject({ actorId: who.userId, logicalName, duplicate: false,
      binding: { registryRevision: '5', locationRevision: '1', binding: { mode: 'object-derived', pointProjectMetres: [21, 3, 1], confirmedBy: who.userId } },
      impact: { fromOccurrences: 11, toOccurrences: 10, distinctCables: 20, cableIds } });
    expect(after).toMatchObject({ registry: '5', locations: 1, aliases: 1, revisions: 1, heads: 1, commands: 1, cable_hash: before.cable_hash });
    const location = (await pool.query('SELECT name FROM pf_locations WHERE id=$1', [receipt.locationId])).rows[0];
    expect(location.name).toBe(logicalName); expect(location.name).not.toBe('EQ01');
    const toContext = await commands.context(projectId, who, cableIds[5], 'to');
    expect(toContext.location?.id).toBe(receipt.locationId); expect(toContext.head?.id).toBe(receipt.binding.binding.id);
  });
  it('reuses an existing canonical location through either endpoint alias and deduplicates both-end usage', async () => {
    await pool.query('TRUNCATE pfu2_commands.projects,pfu2_commands.users,pfu2_commands.viewer_login_bindings CASCADE'); await seed(true);
    const before = await state(), { command, context } = await commandFor(cableIds[10]), projectId = sample.aggregate.projectId;
    expect(context.logicalName).toBe(alias); expect(context.location?.name).toBe(logicalName);
    const receipt = await commands.save(projectId, who, cableIds[10], 'from', command);
    expect(receipt.locationId).toBe(id(8)); expect(receipt.logicalName).toBe(alias);
    expect(receipt.impact).toEqual({ fromOccurrences: 11, toOccurrences: 10, distinctCables: 20, cableIds });
    expect(await state()).toMatchObject({ registry: '5', locations: 1, aliases: 2, revisions: 1, heads: 1, commands: 1, cable_hash: before.cable_hash });
    const aliases = (await pool.query('SELECT display_alias FROM pf_location_aliases ORDER BY normalized_alias')).rows.map(value => value.display_alias);
    expect(aliases).toEqual([logicalName, alias]);
    const otherEnd = await commands.context(projectId, who, cableIds[19], 'to');
    expect(otherEnd.logicalName).toBe(alias); expect(otherEnd.location?.id).toBe(id(8)); expect(otherEnd.head?.id).toBe(receipt.binding.binding.id);
  });
  it('replays the exact committed receipt after the cable context changes without writing the cable again', async () => {
    const { command } = await commandFor(), projectId = sample.aggregate.projectId;
    const receipt = await commands.save(projectId, who, cableIds[0], 'from', command);
    await pool.query("UPDATE cables SET from_location='Changed outside this command',cable_write_revision=8 WHERE id=$1", [cableIds[0]]);
    const beforeReplay = await state(), replay = await commands.save(projectId, who, cableIds[0], 'from', command);
    expect(replay).toEqual({ ...receipt, duplicate: true }); expect(await state()).toEqual(beforeReplay);
    const closed = await commands.close(projectId, who, cableIds[0], 'from', command);
    expect(closed).toMatchObject({ status: 'saved', receipt: { ...receipt, duplicate: true } }); expect(await state()).toEqual(beforeReplay);
  });
  it('commits an explicit closure before a late original save and permanently refuses that exact command', async () => {
    const { command } = await commandFor(), before = await state(), projectId = sample.aggregate.projectId;
    const result = await commands.close(projectId, who, cableIds[0], 'from', command);
    expect(result).toMatchObject({ status: 'closed', closure: { actorId: who.userId, idempotencyKey: command.idempotencyKey } });
    await expect(commands.save(projectId, who, cableIds[0], 'from', command)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_COMMAND_CLOSED' });
    expect(await commands.close(projectId, who, cableIds[0], 'from', command)).toEqual(result);
    expect(await state()).toMatchObject({ registry: '4', locations: 0, aliases: 0, revisions: 0, heads: 0, commands: 1, cable_hash: before.cable_hash });
  });
  it('separates the same idempotency key across two real current administrator principals', async () => {
    const projectId = sample.aggregate.projectId, first = await commandFor(), receipt = await commands.save(projectId, who, cableIds[0], 'from', first.command);
    await expect(commands.save(projectId, other, cableIds[0], 'from', first.command)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_CONTEXT_CHANGED' });
    const next = await commandFor(cableIds[0], 'from', other, first.command.idempotencyKey);
    const before = await state(), own = await commands.save(projectId, other, cableIds[0], 'from', next.command);
    expect(own.actorId).toBe(other.userId); expect(own.actorId).not.toBe(receipt.actorId); expect(own.duplicate).toBe(false);
    expect(own.binding.duplicate).toBe(true); expect(await state()).toEqual({ ...before, commands: 2 });
    const owners = (await pool.query('SELECT actor_id FROM pf_endpoint_binding_commands ORDER BY actor_id')).rows.map(value => value.actor_id);
    expect(owners).toEqual([who.userId, other.userId]);
  });
  it('saves an explicitly manual fixed-world point with no retained object-following authority', async () => {
    const { command } = await commandFor(), before = await state(), projectId = sample.aggregate.projectId;
    const manual = cableEndpointCommandSchema.parse({ ...command, selection: { mode: 'fixed-world', pointProjectMetres: [3, 4, 5],
      derivation: 'manual-world-point', displaySdkObjectId: 5 } });
    const receipt = await commands.save(projectId, who, cableIds[0], 'from', manual);
    expect(receipt.binding.binding).toMatchObject({ mode: 'fixed-world', pointProjectMetres: [3, 4, 5], derivation: 'manual-world-point',
      sourceObject: null, attachment: null, qualifiedProjectFrameId: null });
    expect((await state()).cable_hash).toBe(before.cable_hash);
  });
  it('rolls back new location, aliases, head, revision and registry when actual command receipt insertion fails', async () => {
    const { command } = await commandFor(), before = await state(), projectId = sample.aggregate.projectId;
    await pool.query(`CREATE FUNCTION pfu2_commands.reject_endpoint_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic stored receipt failure'; END $$;
      CREATE TRIGGER pfu2_reject_endpoint_receipt BEFORE INSERT ON pf_endpoint_binding_commands FOR EACH ROW EXECUTE FUNCTION pfu2_commands.reject_endpoint_receipt()`);
    try {
      await expect(commands.save(projectId, who, cableIds[0], 'from', command)).rejects.toMatchObject({ code: 'P0001' });
      expect(await state()).toEqual(before);
    } finally { await pool.query('DROP TRIGGER pfu2_reject_endpoint_receipt ON pf_endpoint_binding_commands; DROP FUNCTION pfu2_commands.reject_endpoint_receipt()'); }
    expect((await commands.save(projectId, who, cableIds[0], 'from', command)).duplicate).toBe(false);
  });
  it.each(['role', 'login'] as const)('refuses real %s revocation before any binding/command writes', async kind => {
    const { command } = await commandFor(), projectId = sample.aggregate.projectId, before = await state();
    if (kind === 'role') await pool.query('UPDATE users SET is_admin=false WHERE id=$1', [who.userId]);
    else await pool.query('UPDATE viewer_login_bindings SET revoked_at=clock_timestamp() WHERE login_id=$1', [who.loginId]);
    await expect(commands.save(projectId, who, cableIds[0], 'from', command)).rejects.toMatchObject({ code: kind === 'role' ? 'ADMIN_REQUIRED' : 'LOGIN_REVOKED' });
    await expect(commands.context(projectId, who, cableIds[0], 'from')).rejects.toMatchObject({ code: kind === 'role' ? 'ADMIN_REQUIRED' : 'LOGIN_REVOKED' });
    expect(await state()).toEqual(before);
  });
});
