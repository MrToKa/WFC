// ROOT executes this operator against an already owned disposable U7 database.
// It qualifies actual PostgreSQL pair transactions, not the complete engine chain.
// The separate schema deliberately simulates model-readiness/preparation metadata;
// no public Ready model, package validation PASS, geometry acceptance or human
// engineering approval is constructed. No worker, engine, HTTP server or producer runs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { Pool } from 'pg';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SCRATCH = path.join(ROOT, 'pathfinder-engine/.scratch');
const KIND = 'synthetic-cable-workflow-u7';
const IMAGE = 'sha256:9a2e0383c38afd52cff14eeefe2b806fcde406b317002cd13ce513d309942751';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const run = promisify(execFile), sha = value => createHash('sha256').update(value).digest('hex');
const need = (condition, code) => { if (!condition) throw Object.assign(Error(code), { code }); };
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const id = n => `98000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function validatePairSqlFixture(config, filename) {
  const directory = path.dirname(path.resolve(filename));
  need(path.isAbsolute(filename) && path.resolve(filename) === filename && path.basename(filename) === 'fixture.private.json'
    && config?.schemaVersion === 'wfc.pf.u7-chain-fixture.v1' && UUID.test(config.owner ?? '')
    && path.dirname(directory) === SCRATCH && path.basename(directory) === 'cable-workflow-u7-' + config.owner
    && config.database === 'wfc_pfu7_' + config.owner.replaceAll('-', '')
    && config.containerName === 'pfu7-pg-' + config.owner.replaceAll('-', '').slice(0, 12)
    && config.compiledRoot === path.join(ROOT, 'server/dist') && config.storageRoot === path.join(directory, 'storage'), 'U7_PAIR_CONFIGURATION');
  const url = new URL(config.databaseUrl);
  need(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && url.pathname === '/' + config.database
    && url.username === 'pfu7' && Boolean(url.password) && /^\d{1,5}$/.test(url.port) && Number(url.port) > 0 && Number(url.port) <= 65535
    && !url.search && !url.hash, 'U7_PAIR_DATABASE_DESTINATION');
  return { directory, url };
}
async function canonical(filename, directory = false) {
  need(path.isAbsolute(filename) && path.resolve(filename) === filename, 'U7_PAIR_PATH');
  for (let current = filename;; current = path.dirname(current)) {
    const stat = await fs.lstat(current);
    need(!stat.isSymbolicLink() && (current === filename && !directory ? stat.isFile() && stat.nlink === 1 : stat.isDirectory())
      && path.resolve(await fs.realpath(current)) === current, 'U7_PAIR_PATH');
    if (path.dirname(current) === current) break;
  }
}
async function configuration(filename) {
  await canonical(filename); const stat = await fs.stat(filename); need(stat.size > 0 && stat.size < 32768, 'U7_PAIR_CONFIGURATION');
  const bytes = await fs.readFile(filename), config = JSON.parse(bytes.toString('utf8')), { directory, url } = validatePairSqlFixture(config, filename);
  await canonical(directory, true); await canonical(config.compiledRoot, true);
  const output = await run('docker', ['inspect', config.containerName], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  const containers = JSON.parse(output.stdout), container = containers[0], ports = container?.NetworkSettings?.Ports?.['5432/tcp'];
  need(containers.length === 1 && container.Name === '/' + config.containerName && container.Image === IMAGE && container.State?.Running === true
    && container.Config?.Labels?.['wfc.pathfinder.owner'] === config.owner && container.Config?.Labels?.['wfc.pathfinder.fixture'] === KIND
    && container.Mounts.every(mount => mount.Type === 'tmpfs') && !container.HostConfig.Privileged && container.HostConfig.RestartPolicy.Name === 'no'
    && ports?.length === 1 && ports[0].HostIp === '127.0.0.1' && ports[0].HostPort === url.port, 'U7_PAIR_CONTAINER');
  return { config, directory, configSha256: sha(bytes), containerId: container.Id };
}

// Explicitly simulated read-context tables, not a model registry replacement.
// Binding/impact/mandate tables below are initialized by their production modules.
const CONTEXT_SCHEMA = `
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
CREATE TABLE pf_preparation_sessions(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),plan jsonb NOT NULL);
CREATE TABLE pf_preparation_aggregates(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),session_id uuid,model_version_id uuid,
 artifact_id uuid,geometry_revision bigint,manifest jsonb NOT NULL,UNIQUE(project_id,id));
CREATE TABLE pf_artifacts(project_id uuid REFERENCES projects(id),id uuid,model_version_id uuid,snapshot_sha256 text,snapshot_bytes bigint,
 content_fingerprint text,PRIMARY KEY(project_id,id));
CREATE TABLE pf_geometry_trace_sets(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),aggregate_id uuid,model_version_id uuid,manifest jsonb NOT NULL,
 created_at timestamptz DEFAULT now(),UNIQUE(project_id,id),FOREIGN KEY(project_id,aggregate_id) REFERENCES pf_preparation_aggregates(project_id,id));
CREATE TABLE pf_model_objects(project_id uuid,artifact_id uuid,object_id text,db_id integer,geometry_role text,visibility text,match_names jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(project_id,artifact_id,object_id),FOREIGN KEY(project_id,artifact_id) REFERENCES pf_artifacts(project_id,id));
CREATE TABLE pf_geometry_object_revisions(id uuid PRIMARY KEY,project_id uuid,trace_id uuid,object_id text,summary jsonb NOT NULL,record jsonb NOT NULL,
 UNIQUE(project_id,trace_id,object_id),FOREIGN KEY(project_id,trace_id) REFERENCES pf_geometry_trace_sets(project_id,id));
CREATE TABLE pf_location_bindings(project_id uuid,location_id uuid,model_version_id uuid,revision bigint,point jsonb,object_id text,derivation text,
 confirmed_at timestamptz,PRIMARY KEY(project_id,location_id,model_version_id));
CREATE TABLE pf_jobs(project_id uuid NOT NULL,id uuid NOT NULL,PRIMARY KEY(project_id,id));
CREATE TABLE pf_installation_state(singleton boolean PRIMARY KEY CHECK(singleton),installation_epoch uuid NOT NULL,updated_at timestamptz DEFAULT now());
`;

/** Raw SQL text, duplicate-preserving order and framed hashes; no JSON numeric roundtrip. */
async function tableHash(client, schema, table, check) {
  check(); const values = (await client.query(`SELECT octet_length(raw)::text AS bytes,CASE WHEN octet_length(raw)<=1048576 THEN raw ELSE NULL END AS raw
    FROM (SELECT to_jsonb(r)::text AS raw FROM ${quote(schema)}.${quote(table)} r ORDER BY (to_jsonb(r)::text) COLLATE "C" LIMIT 10001) v`)).rows;
  need(values.length <= 10000, 'U7_PAIR_CLOSURE_LIMIT'); const hash = createHash('sha256'); let bytes = 0;
  for (const row of values) { check(); need(typeof row.raw === 'string' && /^\d+$/.test(row.bytes), 'U7_PAIR_CLOSURE_ROW');
    bytes += Buffer.byteLength(row.raw); need(bytes <= 32 * 1024 ** 2, 'U7_PAIR_CLOSURE_LIMIT'); hash.update(row.bytes + '\n').update(row.raw).update('\n'); }
  return { rows: values.length, sha256: hash.digest('hex') };
}
async function closure(pool, schema, check) {
  const client = await pool.connect(); try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const names = (await client.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN('r','p') ORDER BY c.relname COLLATE \"C\"", [schema])).rows;
    need(names.length > 0 && names.length <= 256, 'U7_PAIR_CLOSURE_TABLES'); const tables = [];
    for (const { relname } of names) tables.push({ table: relname, ...await tableHash(client, schema, relname, check) });
    await client.query('COMMIT'); return { schema, tables, contentSha256: sha(JSON.stringify(tables)) };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
}

export async function qualifyPairSql(filename) {
  const owned = await configuration(filename), { config, directory } = owned, runId = randomUUID(), schema = 'pfu7_pair_' + runId.replaceAll('-', '');
  const receiptFile = path.join(directory, 'pair-sql-qualification-' + runId + '.private.json'), reservation = await fs.open(receiptFile, 'wx', 0o600);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180000), check = () => controller.signal.throwIfAborted();
  const poolOptions = { connectionString: config.databaseUrl, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 15000,
    query_timeout: 20000, idle_in_transaction_session_timeout: 30000, application_name: 'pf-u7-pair-sql-qualification' };
  const publicPool = new Pool(poolOptions), pool = new Pool({ ...poolOptions, options: '-c search_path=' + schema + ',pg_catalog' });
  const checks = []; let publicBefore, publicAfter, sourceHashes, activeSave;
  const guard = async () => { check(); const rows = (await publicPool.query(`SELECT current_database() AS db,
    (SELECT count(*)::text FROM public.pfu7_fixture_owner) AS owners,EXISTS(SELECT 1 FROM public.pfu7_fixture_owner WHERE owner=$1 AND fixture_kind=$2) AS owned`, [config.owner, KIND])).rows;
    need(rows.length === 1 && rows[0].db === config.database && rows[0].owners === '1' && rows[0].owned === true, 'U7_PAIR_OWNER_MARKER'); };
  const sql = async (text, values) => { await guard(); const value = await pool.query(text, values); check(); return value; };
  try {
    await guard(); publicBefore = await closure(publicPool, 'public', check);
    const modules = ['cableEndpointCommands', 'endpointBindingRepository', 'endpointBindingSchema', 'cableEndpointSelection', 'automaticEndpointCandidates',
      'locationImpactRepository', 'locationImpactSchema', 'initialFillMandates', 'initialFillMandateSchema', 'geometryTraceFixtures', 'geometryTraceBuilder', 'cableWorkflowRead', 'auth'];
    const paths = Object.fromEntries(modules.map(name => [name, path.join(config.compiledRoot, 'server/pathfinder', name + '.js')]));
    paths.pairContract = path.join(config.compiledRoot, 'shared/pathfinderCableEndpointPair.js'); paths.operator = fileURLToPath(import.meta.url);
    sourceHashes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, value]) => { await canonical(value); return [name, sha(await fs.readFile(value))]; })));
    Object.assign(process.env, { DATABASE_URL: config.databaseUrl, JWT_SECRET: config.jwtSecret, MINIO_ACCESS_KEY: config.minioAccessKey,
      MINIO_SECRET_KEY: config.minioSecretKey, MINIO_ENDPOINT: '127.0.0.1', MINIO_PORT: '1', MINIO_USE_SSL: 'false', PF_ROOT: config.storageRoot,
      PF_ENGINE_DLL: config.engineDll, PF_ENGINE_MODE: 'oneshot' });
    const load = name => import(pathToFileURL(paths[name]).href);
    const [{ createCableEndpointCommands }, { initializeEndpointBindingSchema }, { initializeLocationImpactSchema }, { initializeInitialFillMandateSchema },
      { geometryTraceFixture }, { buildGeometryTrace }, { cableEndpointPairCommandSchema }] = await Promise.all([
      load('cableEndpointCommands'), load('endpointBindingSchema'), load('locationImpactSchema'), load('initialFillMandateSchema'), load('geometryTraceFixtures'), load('geometryTraceBuilder'), load('pairContract')]);
    await guard(); await publicPool.query('CREATE SCHEMA ' + quote(schema));
    await sql('CREATE TABLE pair_fixture_owner(owner uuid PRIMARY KEY,fixture_kind text NOT NULL,run_id uuid NOT NULL)');
    await sql('INSERT INTO pair_fixture_owner VALUES($1,$2,$3)', [config.owner, 'simulated-context-actual-pair-sql', runId]);
    await sql(CONTEXT_SCHEMA); await initializeEndpointBindingSchema(pool); await initializeLocationImpactSchema(pool); await initializeInitialFillMandateSchema(pool);
    const commands = createCableEndpointCommands(pool), sample = geometryTraceFixture(), built = buildGeometryTrace(sample), a = sample.aggregate;
    const who = { userId: id(1), loginId: id(2), loginExpiresAt: Date.now() + 10 * 60000 }, other = { userId: id(3), loginId: id(4), loginExpiresAt: who.loginExpiresAt };
    const cableIds = Array.from({ length: 22 }, (_, at) => id(100 + at)), fromName = 'PAIR SYNTHETIC FROM', toName = 'PAIR SYNTHETIC TO';
    const seed = async (aliases = false) => {
      await sql(`TRUNCATE ${quote(schema)}.projects,${quote(schema)}.users,${quote(schema)}.viewer_login_bindings,${quote(schema)}.pf_installation_state CASCADE`);
      await sql('INSERT INTO projects VALUES($1)', [a.projectId]);
      for (const principal of [who, other]) { await sql('INSERT INTO users VALUES($1,true,0)', [principal.userId]);
        await sql('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)', [principal.loginId, principal.userId, new Date(principal.loginExpiresAt)]); }
      await sql('INSERT INTO pf_installation_state VALUES(true,$1,now())', [runId]); await sql('INSERT INTO pf_project_state VALUES($1,4,now())', [a.projectId]);
      // This table is a deliberately simulated metadata projection in THIS schema.
      // No model registry, validation report, storage readback or public Ready row.
      await sql("INSERT INTO model_versions VALUES($1,$2,$3,'ready','healthy')", [a.projectId, a.modelVersionId, a.contentFingerprint]);
      await sql('INSERT INTO project_model_selections VALUES($1,$2,$3)', [a.projectId, a.modelVersionId, a.selectionRevision]);
      await sql('INSERT INTO pf_artifacts VALUES($1,$2,$3,$4,$5,$6)', [a.projectId, a.artifactId, a.modelVersionId, a.projection.sha256, a.projection.bytes, a.contentFingerprint]);
      await sql('INSERT INTO pf_preparation_sessions VALUES($1,$2,$3)', [a.sessionId, a.projectId, sample.plan]);
      await sql('INSERT INTO pf_preparation_aggregates VALUES($1,$2,$3,$4,$5,$6,$7)', [a.id, a.projectId, a.sessionId, a.modelVersionId, a.artifactId, a.geometryRevision, a]);
      await sql('INSERT INTO pf_project_preparations VALUES($1,$2,$3,$4)', [a.projectId, a.id, a.artifactId, a.geometryRevision]);
      await sql('INSERT INTO pf_geometry_trace_sets(id,project_id,aggregate_id,model_version_id,manifest) VALUES($1,$2,$3,$4,$5)', [sample.traceId, a.projectId, a.id, a.modelVersionId, built.manifest]);
      for (const [at, record] of built.records.entries()) {
        await sql("INSERT INTO pf_model_objects VALUES($1,$2,$3,$4,$5,'unknown','{}')", [a.projectId, a.artifactId, record.identity.objectId, record.identity.dbId, record.geometry.role]);
        await sql('INSERT INTO pf_geometry_object_revisions VALUES($1,$2,$3,$4,$5,$6)', [record.id, a.projectId, sample.traceId, record.identity.objectId, built.summaries[at], record]);
      }
      for (const [at, cableId] of cableIds.entries()) await sql(`INSERT INTO cables VALUES($1,$2,7,$3,$4,$5,$6,$7,39.125,'business-revision-preserved')`,
        [cableId, a.projectId, at % 2 ? toName : fromName, at % 2 ? fromName : toName,
          at === 20 ? 'MV' : at === 21 ? null : ['LV', 'Control', 'Instrumentation'][at % 3], at === 16 ? '/EXISTING' : at === 17 ? '/PARTIAL' : null,
          at === 16 ? 42 : at === 18 ? 50 : at === 19 ? 0 : null]);
      if (aliases) { await sql('INSERT INTO pf_locations(id,project_id,name,created_by) VALUES($1,$2,$3,$4)', [id(10), a.projectId, fromName, who.userId]);
        for (const name of [fromName, toName]) await sql('INSERT INTO pf_location_aliases VALUES($1,$2,$3,$4)', [a.projectId, name, name, id(10)]); }
    };
    let serial = 1000;
    const pair = async (equalPoints = false) => {
      const from = await commands.context(a.projectId, who, cableIds[0], 'from'), to = await commands.context(a.projectId, who, cableIds[0], 'to');
      return cableEndpointPairCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-pair-command.v1', idempotencyKey: id(serial++),
        expectedContexts: { from: from.contextSha256, to: to.contextSha256 }, endpoints: [['from', from], ['to', to]].map(([end, c]) => ({ end, command: {
          schemaVersion: 'wfc.pf.cable-endpoint-command.v3', idempotencyKey: id(serial++), expectedContextSha256: c.contextSha256,
          expectedCableWriteRevision: c.cableWriteRevision, expectedLogicalName: c.logicalName, expectedRegistryRevision: c.registryRevision,
          expectedLocationId: c.location?.id ?? null, expectedLocationRevision: c.location?.revision ?? null, expectedHeadId: c.head?.id ?? null, expectedCurrent: c.current,
          reason: 'Explicit synthetic actual SQL pair transaction qualification.', selection: { mode: 'fixed-world', pointProjectMetres: end === 'from' || equalPoints ? [1, 2, 3] : [4, 5, 6],
            derivation: 'manual-world-point', displaySdkObjectId: null }, calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 }, initialFill: { mode: 'when-both-empty' },
        } })) });
    };
    const state = async () => { const closed = await closure(pool, schema, check); return { sha256: closed.contentSha256,
      counts: Object.fromEntries(closed.tables.map(table => [table.table, table.rows])), cableSha256: closed.tables.find(table => table.table === 'cables')?.sha256 }; };
    const save = input => commands.savePair(a.projectId, who, cableIds[0], input, controller.signal);
    const perform = async (name, operation) => { check(); const started = performance.now(); await operation(); checks.push({ name, status: 'PASS', milliseconds: Math.round(performance.now() - started) }); };

    await perform('actual atomic heads, exact shared fanout, mandates and untouched cable columns', async () => {
      await seed(); const input = await pair(), before = await state(), receipt = await save(input), after = await state();
      assert.equal(receipt.finalRegistryRevision, '6'); assert.equal(receipt.receipts.length, 2); assert.equal(after.counts.pf_endpoint_binding_heads, 2);
      assert.equal(after.counts.pf_endpoint_binding_commands, 3); assert.equal(after.counts.pf_location_impacts, 2); assert.equal(after.counts.pf_initial_fill_mandates, 2);
      assert.equal(after.cableSha256, before.cableSha256); assert.equal(after.counts.pf_jobs, 0);
      for (const child of receipt.receipts) assert.deepEqual(child.impact, { fromOccurrences: 11, toOccurrences: 11, distinctCables: 22, cableIds });
      for (const child of receipt.receipts) assert.deepEqual({ eligibleCables: child.locationImpact.eligibleCables, excludedMvCables: child.locationImpact.excludedMvCables,
        blockedCategoryCables: child.locationImpact.blockedCategoryCables }, { eligibleCables: 20, excludedMvCables: 1, blockedCategoryCables: 1 });
      const targets = (await sql('SELECT generation::text,count(*)::int AS count FROM pf_location_impact_targets GROUP BY generation')).rows;
      assert.deepEqual(targets, [{ generation: '2', count: 21 }]);
    });
    await perform('second binding failure rolls back both heads, registry, impacts, mandates and receipts', async () => {
      await seed(); const input = await pair(), before = await state();
      await sql(`CREATE FUNCTION reject_second_pair_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF (SELECT count(*) FROM pf_endpoint_binding_revisions)=1 THEN RAISE EXCEPTION 'PF_U7_EXPECTED_SECOND_BINDING_FAILURE';END IF;RETURN NEW;END $$;
        CREATE TRIGGER reject_second_pair_binding BEFORE INSERT ON pf_endpoint_binding_revisions FOR EACH ROW EXECUTE FUNCTION reject_second_pair_binding()`);
      try { await assert.rejects(save(input), error => error.code === 'P0001'); assert.equal((await state()).sha256, before.sha256); }
      finally { await sql('DROP TRIGGER reject_second_pair_binding ON pf_endpoint_binding_revisions;DROP FUNCTION reject_second_pair_binding()'); }
      assert.equal((await save(input)).duplicate, false);
    });
    await perform('outer receipt failure rolls back both heads, both intents and child command receipts', async () => {
      await seed(); const input = await pair(), before = await state();
      await sql(`CREATE FUNCTION reject_outer_pair_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.request->>'schemaVersion'='wfc.pf.cable-endpoint-pair-owner.v1' THEN RAISE EXCEPTION 'PF_U7_EXPECTED_OUTER_RECEIPT_FAILURE';END IF;RETURN NEW;END $$;
        CREATE TRIGGER reject_outer_pair_receipt BEFORE INSERT ON pf_endpoint_binding_commands FOR EACH ROW EXECUTE FUNCTION reject_outer_pair_receipt()`);
      try { await assert.rejects(save(input), error => error.code === 'P0001'); assert.equal((await state()).sha256, before.sha256); }
      finally { await sql('DROP TRIGGER reject_outer_pair_receipt ON pf_endpoint_binding_commands;DROP FUNCTION reject_outer_pair_receipt()'); }
    });
    await perform('exact replay and saved close recover committed pair after context edits', async () => {
      await seed(); const input = await pair(), receipt = await save(input);
      await sql("UPDATE cables SET from_location='Changed after confirmed save',cable_write_revision=8 WHERE id=$1", [cableIds[0]]); const before = await state();
      assert.deepEqual(await save(input), { ...receipt, duplicate: true });
      assert.deepEqual(await commands.closePair(a.projectId, who, cableIds[0], input), { schemaVersion: 'wfc.pf.cable-endpoint-pair-recovery.v1', status: 'saved', receipt: { ...receipt, duplicate: true } });
      assert.equal((await state()).sha256, before.sha256);
      const changed = structuredClone(input); changed.endpoints[1].command.reason = 'Different original command'; await assert.rejects(save(changed), error => error.code === 'CABLE_ENDPOINT_IDEMPOTENCY_CONFLICT');
    });
    await perform('immutable pair and child tombstones refuse all late writes after stale context', async () => {
      await seed(); const input = await pair(); await sql("UPDATE cables SET to_location='Changed before close',cable_write_revision=8 WHERE id=$1", [cableIds[0]]);
      const before = await state(), closed = await commands.closePair(a.projectId, who, cableIds[0], input); assert.equal(closed.status, 'closed');
      await assert.rejects(save(input), error => error.code === 'CABLE_ENDPOINT_COMMAND_CLOSED');
      for (const child of input.endpoints) await assert.rejects(commands.save(a.projectId, who, cableIds[0], child.end, child.command), error => error.code === 'CABLE_ENDPOINT_COMMAND_CLOSED');
      assert.deepEqual(await commands.closePair(a.projectId, who, cableIds[0], input), closed); const after = await state();
      assert.equal(after.counts.pf_endpoint_binding_commands, 3); assert.equal(after.counts.pf_endpoint_binding_heads, 0); assert.equal(after.counts.pf_location_impacts, 0); assert.equal(after.cableSha256, before.cableSha256);
    });
    await perform('same canonical location aliases deduplicate the physical head while retaining exact child authority', async () => {
      await seed(true); const before = await state(), receipt = await save(await pair(true)), after = await state();
      assert.equal(after.counts.pf_locations, 1); assert.equal(after.counts.pf_endpoint_binding_heads, 1); assert.equal(after.counts.pf_endpoint_binding_revisions, 1);
      assert.equal(after.counts.pf_location_aliases, 2); assert.equal(receipt.finalRegistryRevision, '5'); assert.equal(receipt.receipts[0].locationId, receipt.receipts[1].locationId);
      assert.equal(after.counts.pf_location_impacts, 2); assert.equal(after.counts.pf_initial_fill_mandates, 2); assert.equal(after.cableSha256, before.cableSha256);
    });
    await perform('conflicting alias drafts and stale untouched opposite context are refused before mutation', async () => {
      await seed(true); const conflicting = await pair(), before = await state(); await assert.rejects(save(conflicting), error => error.code === 'CABLE_ENDPOINT_PAIR_LOCATION_CONFLICT');
      assert.equal((await state()).sha256, before.sha256);
      await seed(); const input = await pair(); input.endpoints.pop(); await sql("UPDATE cables SET to_location='Changed opposite end',cable_write_revision=8 WHERE id=$1", [cableIds[0]]);
      const changed = await state(); await assert.rejects(save(input), error => error.code === 'CABLE_ENDPOINT_CONTEXT_CHANGED'); assert.equal((await state()).sha256, changed.sha256);
    });
    await perform('actual role and login revocation prevent save and recovery without writes', async () => {
      for (const kind of ['role', 'login']) {
        await seed(); const input = await pair();
        await sql(kind === 'role' ? 'UPDATE users SET is_admin=false WHERE id=$1' : 'UPDATE viewer_login_bindings SET revoked_at=clock_timestamp() WHERE login_id=$1', [kind === 'role' ? who.userId : who.loginId]);
        const before = await state(); await assert.rejects(save(input), error => error.status === (kind === 'role' ? 403 : 401));
        await assert.rejects(commands.closePair(a.projectId, who, cableIds[0], input), error => error.status === (kind === 'role' ? 403 : 401)); assert.equal((await state()).sha256, before.sha256);
      }
    });
    await perform('same key under another real principal cannot replay the first administrator receipt', async () => {
      await seed(); const input = await pair(); await save(input); const before = await state();
      await assert.rejects(commands.savePair(a.projectId, other, cableIds[0], input), error => error.code === 'CABLE_ENDPOINT_CONTEXT_CHANGED'); assert.equal((await state()).sha256, before.sha256);
    });
    await perform('MVCC hides intermediate first head while second head waits on a genuine PostgreSQL lock', async () => {
      await seed(); const input = await pair(), observer = await pool.connect(), lockA = 950720, lockB = parseInt(runId.replaceAll('-', '').slice(0, 6), 16);
      let locked = false;
      await sql(`CREATE FUNCTION pause_second_pair_head() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF (SELECT count(*) FROM pf_endpoint_binding_heads)=1 THEN PERFORM pg_advisory_xact_lock(${lockA},${lockB});END IF;RETURN NEW;END $$;
        CREATE TRIGGER pause_second_pair_head BEFORE INSERT ON pf_endpoint_binding_heads FOR EACH ROW EXECUTE FUNCTION pause_second_pair_head()`);
      try {
        await observer.query('SELECT pg_advisory_lock($1,$2)', [lockA, lockB]); locked = true; activeSave = save(input);
        // Consume rejection immediately; its exact outcome is still awaited below.
        void activeSave.catch(() => undefined); const until = Date.now() + 2500; let waiting = false;
        while (!waiting && Date.now() < until) { check(); waiting = (await observer.query('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype=\'advisory\' AND classid=$1::oid AND objid=$2::oid AND NOT granted) AS waiting', [lockA, lockB])).rows[0].waiting;
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 25)); }
        need(waiting, 'U7_PAIR_CONCURRENCY_WAIT_NOT_OBSERVED');
        const visible = (await observer.query('SELECT (SELECT count(*)::int FROM pf_endpoint_binding_heads) AS heads,(SELECT count(*)::int FROM pf_location_impacts) AS impacts,(SELECT count(*)::int FROM pf_endpoint_binding_commands) AS commands')).rows[0];
        assert.deepEqual(visible, { heads: 0, impacts: 0, commands: 0 });
        await observer.query('SELECT pg_advisory_unlock($1,$2)', [lockA, lockB]); locked = false;
        assert.equal((await activeSave).receipts.length, 2); activeSave = undefined;
      } finally { if (locked) await observer.query('SELECT pg_advisory_unlock($1,$2)', [lockA, lockB]); await activeSave?.catch(() => undefined); activeSave = undefined;
        observer.release(); await sql('DROP TRIGGER pause_second_pair_head ON pf_endpoint_binding_heads;DROP FUNCTION pause_second_pair_head()'); }
    });
    for (const [name, filename] of Object.entries(paths)) need(sha(await fs.readFile(filename)) === sourceHashes[name], 'U7_PAIR_SOURCE_CHANGED');
    await guard(); publicAfter = await closure(publicPool, 'public', check); assert.equal(publicAfter.contentSha256, publicBefore.contentSha256);
    checks.push({ name: 'all preexisting public table rows and table set remain exactly unchanged', status: 'PASS', tables: publicBefore.tables.length });
    const receipt = { schemaVersion: 'wfc.pf.u7-pair-sql-qualification.v1', status: 'PASS', synthetic: true, owner: config.owner, runId, schema,
      database: config.database, containerId: owned.containerId, configSha256: owned.configSha256, sourceHashes,
      scope: 'Actual PostgreSQL compiled savePair/closePair, authority, binding helper, impact/mandate/FK/immutable ledger and rollback; explicitly simulated read-context metadata in a separate schema.',
      notProven: ['Full production-schema business integration', 'Actual package import or Ready validation', 'C# calculation/admission/seal/initial-fill writer', 'Automatic matching or live SDK selection', 'HTTP/browser/real-model engineering acceptance'],
      checks, publicBefore, publicAfter, retainedSchema: true };
    await reservation.writeFile(JSON.stringify(receipt, null, 2) + '\n'); await reservation.sync();
    console.log(JSON.stringify({ status: 'PASS', synthetic: true, checks: checks.length, schema, receipt: receiptFile })); return receipt;
  } catch (error) {
    await activeSave?.catch(() => undefined); const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,96}$/.test(error.code) ? error.code : 'U7_PAIR_QUALIFICATION_FAILED';
    if (publicBefore) try { publicAfter = await closure(publicPool, 'public', () => undefined); } catch { /* Preserve the original failure; no invented unchanged verdict. */ }
    await reservation.writeFile(JSON.stringify({ schemaVersion: 'wfc.pf.u7-pair-sql-qualification.v1', status: 'FAIL', synthetic: true, owner: config.owner, runId, schema,
      code, checks, sourceHashes, publicBefore, publicAfter, retainedSchema: true }, null, 2) + '\n'); await reservation.sync();
    console.log(JSON.stringify({ status: 'FAIL', synthetic: true, code, checks: checks.length, receipt: receiptFile })); throw Object.assign(Error(code), { code });
  } finally { clearTimeout(timer); controller.abort(); await activeSave?.catch(() => undefined); await Promise.allSettled([pool.end(), publicPool.end()]); await reservation.close(); }
}

// Reused by narrower owned-fixture SQL qualifications; the original validators
// and duplicate-preserving public closure remain the single implementation.
export { configuration as loadOwnedPairSqlFixture, closure as readOwnedSqlClosure };

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  need(process.argv.length === 4 && process.argv[2] === '--fixture', 'U7_PAIR_ARGUMENTS');
  await qualifyPairSql(path.resolve(process.argv[3])).catch(() => { process.exitCode = 1; });
}
