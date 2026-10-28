// Real PostgreSQL ordering/constraint qualification in a NEW owned U7 fixture.
// All context, impacts and jobs in the random schema are synthetic. No app,
// HTTP server, browser, credential session, engine or admission collector runs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { validatePairSqlFixture, loadOwnedPairSqlFixture, readOwnedSqlClosure } from './pair-sql-qualification.mjs';

const KIND = 'synthetic-cable-workflow-u7', RUN_KIND = 'synthetic-origin-priority-sql';
const sha = value => createHash('sha256').update(value).digest('hex');
const need = (condition, code) => { if (!condition) throw Object.assign(Error(code), { code }); };
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const id = n => `b2730000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), origin = id(999), siblings = [id(101), id(102)], actorId = id(2), loginId = id(3);

// Pure validation entry for pre-connection negative controls.
export const validatePrioritySqlFixture = (config, filename) => validatePairSqlFixture(config, filename);
const CONTEXT_SQL = `CREATE TABLE projects(id uuid PRIMARY KEY);
CREATE TABLE cables(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,mto text,UNIQUE(project_id,id));
CREATE TABLE pf_jobs(project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id uuid NOT NULL,state text NOT NULL,
 cancel_requested boolean NOT NULL DEFAULT false,PRIMARY KEY(project_id,id));
CREATE TABLE pf_job_items(project_id uuid NOT NULL,job_id uuid NOT NULL,cable_id uuid NOT NULL,state text NOT NULL DEFAULT 'waiting',
 PRIMARY KEY(project_id,job_id,cable_id),FOREIGN KEY(project_id,job_id) REFERENCES pf_jobs(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,cable_id) REFERENCES cables(project_id,id) ON DELETE CASCADE);`;

export async function qualifyPrioritySql(filename) {
  const owned = await loadOwnedPairSqlFixture(filename), { config, directory } = owned;
  validatePrioritySqlFixture(config, filename);
  const runId = randomUUID(), schema = 'pfu7_priority_' + runId.replaceAll('-', '');
  const output = path.join(directory, 'priority-sql-qualification-' + runId + '.private.json');
  const reservation = await fs.open(output, 'wx', 0o600), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000), check = () => controller.signal.throwIfAborted();
  const options = { connectionString: config.databaseUrl, max: 3, connectionTimeoutMillis: 5000, statement_timeout: 15000,
    query_timeout: 20000, idle_in_transaction_session_timeout: 30000, application_name: 'pf-u7-priority-sql-qualification' };
  const publicPool = new Pool(options), pool = new Pool({ ...options, options: '-c search_path=' + schema + ',pg_catalog' });
  const checks = []; let publicBefore, publicAfter, sourceHashes, schemaCreated = false, schemaRemoved = false;
  const guard = async (bounded = true) => {
    if (bounded) check();
    const rows = (await publicPool.query(`SELECT current_database() AS db,(SELECT count(*)::text FROM public.pfu7_fixture_owner) AS owners,
      EXISTS(SELECT 1 FROM public.pfu7_fixture_owner WHERE owner=$1 AND fixture_kind=$2) AS owned`, [config.owner, KIND])).rows;
    need(rows.length === 1 && rows[0].db === config.database && rows[0].owners === '1' && rows[0].owned === true, 'U7_PRIORITY_OWNER_MARKER');
  };
  const sql = async (text, values) => { await guard(); const value = await pool.query(text, values); check(); return value; };
  const cleanup = async () => {
    if (!schemaCreated || schemaRemoved) return;
    await guard(false);
    const marker = (await pool.query('SELECT owner,fixture_kind,run_id FROM priority_fixture_owner')).rows;
    need(marker.length === 1 && marker[0].owner === config.owner && marker[0].fixture_kind === RUN_KIND && marker[0].run_id === runId, 'U7_PRIORITY_CLEANUP_OWNER');
    need(schema === 'pfu7_priority_' + runId.replaceAll('-', ''), 'U7_PRIORITY_CLEANUP_SCOPE');
    await publicPool.query('DROP SCHEMA ' + quote(schema) + ' CASCADE'); schemaRemoved = true;
  };
  try {
    await guard(); publicBefore = await readOwnedSqlClosure(publicPool, 'public', check);
    const files = { scheduling: path.join(config.compiledRoot, 'server/pathfinder/workerScheduling.js'),
      repository: path.join(config.compiledRoot, 'server/pathfinder/locationImpactRepository.js'),
      schema: path.join(config.compiledRoot, 'server/pathfinder/locationImpactSchema.js'),
      bindingHash: path.join(config.compiledRoot, 'server/pathfinder/endpointBindingRepository.js'),
      contracts: path.join(config.compiledRoot, 'shared/pathfinderLocationImpacts.js'),
      canonical: path.join(config.compiledRoot, 'shared/pathfinderPurposePolicy.js'),
      operator: fileURLToPath(import.meta.url), fixtureGuard: fileURLToPath(new URL('./pair-sql-qualification.mjs', import.meta.url)) };
    for (const filename of Object.values(files)) {
      const stat = await fs.lstat(filename);
      need(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && path.resolve(await fs.realpath(filename)) === filename, 'U7_PRIORITY_SOURCE_PATH');
    }
    sourceHashes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, filename]) => [name, sha(await fs.readFile(filename))])));
    Object.assign(process.env, { DATABASE_URL: config.databaseUrl, JWT_SECRET: config.jwtSecret, MINIO_ACCESS_KEY: config.minioAccessKey,
      MINIO_SECRET_KEY: config.minioSecretKey, MINIO_ENDPOINT: '127.0.0.1', MINIO_PORT: '1', MINIO_USE_SSL: 'false',
      PF_ROOT: config.storageRoot, PF_ENGINE_DLL: config.engineDll, PF_ENGINE_MODE: 'oneshot' });
    const load = name => import(pathToFileURL(files[name]).href);
    const [{ nextCalculationItem }, { initializeLocationImpactSchema }, { locationImpactRecordSchema, locationImpactItemSchema }, { canonicalPurposeJson }] = await Promise.all([
      load('scheduling'), load('schema'), load('contracts'), load('canonical')]);
    const digest = value => sha(canonicalPurposeJson(value));
    const client = await pool.connect();
    try {
      await guard(); await client.query('BEGIN'); await client.query('CREATE SCHEMA ' + quote(schema));
      await client.query('CREATE TABLE priority_fixture_owner(owner uuid PRIMARY KEY,fixture_kind text NOT NULL,run_id uuid NOT NULL)');
      await client.query('INSERT INTO priority_fixture_owner VALUES($1,$2,$3)', [config.owner, RUN_KIND, runId]);
      await client.query('COMMIT'); schemaCreated = true;
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
    await sql(CONTEXT_SQL); await guard(); await initializeLocationImpactSchema(pool);
    const perform = async (name, work) => { check(); const started = performance.now(); await work(); checks.push({ name, status: 'PASS', milliseconds: Math.round(performance.now() - started) }); };
    const reset = async () => {
      await sql('TRUNCATE projects CASCADE'); await sql('INSERT INTO projects VALUES($1)', [projectId]);
      await sql("INSERT INTO cables(id,project_id,mto) SELECT unnest($1::uuid[]),$2,'LV'", [[...siblings, origin], projectId]);
    };
    const append = async ({ impactId = id(10), eligible = [...siblings, origin], legacy = false, badHash = false } = {}) => {
      eligible = [...eligible].sort(); const now = new Date();
      const draft = locationImpactRecordSchema.parse({ ...(legacy ? { schemaVersion: 'wfc.pf.location-impact-record.v1' }
        : { schemaVersion: 'wfc.pf.location-impact-record.v2', originCableId: origin }), id: impactId, projectId, actorId, actorAdminRevision: '1', loginId,
        loginExpiresAt: new Date(now.getTime() + 3600000).toISOString(), authorityExpiresAt: new Date(now.getTime() + 1800000).toISOString(),
        installationEpoch: runId, idempotencyKey: randomUUID(), commandSha256: 'a'.repeat(64), locationId: id(4), bindingId: id(5),
        bindingContentSha256: 'b'.repeat(64), observedRegistryRevision: '7',
        current: { modelVersionId: id(6), selectionRevision: '1', contentFingerprint: 'c'.repeat(64), aggregateId: id(7), artifactId: id(8),
          captureFrameId: id(9), projectionSha256: 'd'.repeat(64), geometryRevision: '1', traceId: null }, calculation: null,
        eligibleCableIds: eligible, excludedMvCableIds: [], blockedCategoryCableIds: [], createdAt: now.toISOString(), contentSha256: '0'.repeat(64) });
      const { contentSha256: _old, ...body } = draft, record = { ...draft, contentSha256: digest(body) };
      await sql('INSERT INTO pf_location_impacts(project_id,id,actor_id,login_id,idempotency_key,command_sha256,record_sha256,record,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [projectId, impactId, actorId, loginId, record.idempotencyKey, record.commandSha256, badHash ? 'f'.repeat(64) : record.contentSha256, record, now]);
      for (const cableId of eligible) {
        const previous = (await sql('SELECT generation::text FROM pf_location_impact_targets WHERE project_id=$1 AND cable_id=$2', [projectId, cableId])).rows[0];
        const generation = (BigInt(previous?.generation ?? '0') + 1n).toString();
        const draft = locationImpactItemSchema.parse({ schemaVersion: 'wfc.pf.location-impact-item.v1', projectId, impactId, cableId, generation,
          cableWriteRevision: '7', fromLogicalKey: 'SHARED', toLogicalKey: 'OTHER', category: 'LV', eligible: true, contentSha256: '0'.repeat(64) });
        const { contentSha256: _hash, ...body } = draft, item = { ...draft, contentSha256: digest(body) };
        await sql('INSERT INTO pf_location_impact_items(project_id,impact_id,cable_id,generation,eligible,record_sha256,record) VALUES($1,$2,$3,$4,true,$5,$6)',
          [projectId, impactId, cableId, generation, item.contentSha256, item]);
        await sql(`INSERT INTO pf_location_impact_targets(project_id,cable_id,generation,impact_id) VALUES($1,$2,$3,$4)
          ON CONFLICT(project_id,cable_id) DO UPDATE SET generation=EXCLUDED.generation,impact_id=EXCLUDED.impact_id`, [projectId, cableId, generation, impactId]);
      }
      await sql("INSERT INTO pf_location_impact_dispatch(project_id,impact_id,status) VALUES($1,$2,'pending')", [projectId, impactId]); return record;
    };
    const enroll = async (impactId = id(10), jobId = id(20)) => {
      const ids = (await sql(`SELECT i.cable_id FROM pf_location_impact_items i JOIN pf_location_impact_targets t
        ON t.project_id=i.project_id AND t.cable_id=i.cable_id AND t.impact_id=i.impact_id AND t.generation=i.generation
        WHERE i.project_id=$1 AND i.impact_id=$2 ORDER BY i.cable_id`, [projectId, impactId])).rows.map(row => row.cable_id);
      await sql("INSERT INTO pf_jobs(project_id,id,state) VALUES($1,$2,'queued')", [projectId, jobId]);
      await sql('INSERT INTO pf_job_items(project_id,job_id,cable_id) SELECT $1,$2,unnest($3::uuid[])', [projectId, jobId, ids]);
      await sql('INSERT INTO pf_location_impact_enrollments(project_id,impact_id,job_id,input_sha256,total,ready_cables,blocked_cables) VALUES($1,$2,$3,$4,$5,$5,0)',
        [projectId, impactId, jobId, 'e'.repeat(64), ids.length]);
      await sql("UPDATE pf_location_impact_dispatch SET status='enrolled' WHERE project_id=$1 AND impact_id=$2", [projectId, impactId]); return ids;
    };
    const next = async (jobId = id(20), markRunning = false) => {
      await guard(); const client = await pool.connect();
      try { await client.query('BEGIN'); await client.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE', [projectId]);
        const value = await nextCalculationItem(client, { project_id: projectId, id: jobId });
        if (markRunning && value) await client.query("UPDATE pf_job_items SET state='running' WHERE project_id=$1 AND job_id=$2 AND cable_id=$3", [projectId, jobId, value.cable_id]);
        await client.query('COMMIT'); check(); return value;
      } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
    };
    const originState = state => sql('UPDATE pf_job_items SET state=$4 WHERE project_id=$1 AND job_id=$2 AND cable_id=$3', [projectId, id(20), origin, state]);
    const itemRows = () => sql('SELECT job_id,cable_id,state FROM pf_job_items ORDER BY job_id,cable_id');
    await perform('compiled selector chooses UUID-last origin, holds running siblings, then releases them after terminal completion', async () => {
      await reset(); await append(); await enroll(); assert.equal((await next(id(20), true)).cable_id, origin);
      assert.equal(await next(), undefined); assert.equal((await itemRows()).rows.filter(row => row.state === 'waiting').length, 2);
      await originState('complete'); assert.equal((await next()).cable_id, siblings[0]);
    });
    await perform('lease recovery reselects the exact origin without duplicate or dropped items', async () => {
      await reset(); await append(); await enroll(); assert.equal((await next(id(20), true)).cable_id, origin); assert.equal(await next(), undefined);
      await originState('waiting'); assert.equal((await next(id(20), true)).cable_id, origin); await originState('blocked');
      assert.equal((await next()).cable_id, siblings[0]); assert.equal((await itemRows()).rows.length, 3);
    });
    await perform('paired-overlap earlier siblings wait on the latest origin target in the other enrolled job', async () => {
      await reset(); await append({ eligible: [siblings[0], origin] }); await append({ impactId: id(11), eligible: [siblings[1], origin] });
      assert.deepEqual(await enroll(), [siblings[0]]); assert.deepEqual(await enroll(id(11), id(21)), [siblings[1], origin]);
      const target = (await sql('SELECT impact_id,generation::text FROM pf_location_impact_targets WHERE project_id=$1 AND cable_id=$2', [projectId, origin])).rows[0];
      assert.deepEqual(target, { impact_id: id(11), generation: '2' }); assert.equal(await next(), undefined);
      assert.equal((await next(id(21), true)).cable_id, origin); assert.equal(await next(), undefined); assert.equal(await next(id(21)), undefined);
      await sql("UPDATE pf_job_items SET state='complete' WHERE project_id=$1 AND job_id=$2 AND cable_id=$3", [projectId, id(21), origin]);
      assert.equal((await next()).cable_id, siblings[0]); assert.equal((await next(id(21))).cable_id, siblings[1]);
    });
    await perform('legacy v1 and unenrolled jobs retain UUID ordering', async () => {
      await reset(); await append({ legacy: true }); await enroll(); assert.equal((await next()).cable_id, siblings[0]);
      await sql("INSERT INTO pf_jobs(project_id,id,state) VALUES($1,$2,'queued')", [projectId, id(22)]);
      await sql('INSERT INTO pf_job_items(project_id,job_id,cable_id) SELECT $1,$2,unnest($3::uuid[])', [projectId, id(22), [...siblings, origin]]);
      assert.equal((await next(id(22))).cable_id, siblings[0]);
    });
    await perform('a cancellation request is not terminal; completed cancellation releases waiting siblings', async () => {
      await reset(); await append(); await enroll(); await next(id(20), true);
      await sql("UPDATE pf_jobs SET state='running',cancel_requested=true WHERE project_id=$1 AND id=$2", [projectId, id(20)]);
      await sql("UPDATE pf_location_impact_dispatch SET status='cancelled' WHERE project_id=$1", [projectId]); assert.equal(await next(), undefined);
      await sql("UPDATE pf_jobs SET state='cancelled' WHERE project_id=$1 AND id=$2", [projectId, id(20)]); assert.equal((await next()).cable_id, siblings[0]);
    });
    await perform('immutable and latest-target constraints refuse edits; bad stored hash refuses selection without item changes', async () => {
      await reset(); await append(); await enroll();
      await assert.rejects(sql('UPDATE pf_location_impacts SET record=record'), error => error.code === 'P0001');
      await assert.rejects(sql('UPDATE pf_location_impact_targets SET impact_id=$1 WHERE cable_id=$2', [id(9999), origin]), error => error.code === '23503');
      await reset(); await append({ badHash: true }); await enroll(); const before = (await itemRows()).rows;
      await assert.rejects(next(), error => error.code === 'LOCATION_IMPACT_INTEGRITY'); assert.deepEqual((await itemRows()).rows, before);
    });
    for (const [name, filename] of Object.entries(files)) need(sha(await fs.readFile(filename)) === sourceHashes[name], 'U7_PRIORITY_SOURCE_CHANGED');
    await cleanup(); await guard(); publicAfter = await readOwnedSqlClosure(publicPool, 'public', check);
    assert.equal(publicAfter.contentSha256, publicBefore.contentSha256);
    checks.push({ name: 'owned random schema removed and complete preexisting public table closure unchanged', status: 'PASS', tables: publicBefore.tables.length });
    const receipt = { schemaVersion: 'wfc.pf.u7-priority-sql-qualification.v1', status: 'PASS', synthetic: true, owner: config.owner, runId,
      database: config.database, containerId: owned.containerId, configSha256: owned.configSha256, schema, schemaRemoved, sourceHashes, checks, publicBefore, publicAfter,
      scope: 'Actual PostgreSQL compiled priority reader/selector SQL and production impact DDL/immutability/latest-target FK in an owned isolated schema with synthetic context and enrollment.',
      notProven: ['Engine calculation or process joining', 'Real application authority/admission', 'HTTP/browser behavior', 'Real model geometry', 'Production schema or automatic cable writes'] };
    await reservation.writeFile(JSON.stringify(receipt, null, 2) + '\n'); await reservation.sync();
    console.log(JSON.stringify({ status: 'PASS', synthetic: true, checks: checks.length, schemaRemoved, receipt: output })); return receipt;
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,96}$/.test(error.code) ? error.code : 'U7_PRIORITY_QUALIFICATION_FAILED';
    const recoveryUntil = Date.now() + 30000, recoveryCheck = () => need(Date.now() <= recoveryUntil, 'U7_PRIORITY_RECOVERY_DEADLINE');
    let cleanupCode;
    try { await cleanup(); } catch (failure) { cleanupCode = typeof failure?.code === 'string' ? failure.code : 'U7_PRIORITY_CLEANUP_FAILED'; }
    if (publicBefore) try { recoveryCheck(); await guard(false); publicAfter = await readOwnedSqlClosure(publicPool, 'public', recoveryCheck); } catch { /* Unavailable is not unchanged. */ }
    await reservation.writeFile(JSON.stringify({ schemaVersion: 'wfc.pf.u7-priority-sql-qualification.v1', status: 'FAIL', synthetic: true,
      owner: config.owner, runId, schema, schemaRemoved, code, cleanupCode, checks, sourceHashes, publicBefore, publicAfter }, null, 2) + '\n'); await reservation.sync();
    console.log(JSON.stringify({ status: 'FAIL', synthetic: true, code, cleanupCode, schemaRemoved, receipt: output })); throw Object.assign(Error(code), { code });
  } finally { clearTimeout(timer); controller.abort(); await Promise.allSettled([pool.end(), publicPool.end()]); await reservation.close(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  need(process.argv.length === 4 && process.argv[2] === '--fixture', 'U7_PRIORITY_ARGUMENTS');
  await qualifyPrioritySql(path.resolve(process.argv[3])).catch(() => { process.exitCode = 1; });
}
