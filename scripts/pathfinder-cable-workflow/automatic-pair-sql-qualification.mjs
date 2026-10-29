// Actual PostgreSQL automatic-pair SQL in a NEW owned U7 fixture only.
// Base context and sealed engine observations are explicitly synthetic. No
// application, HTTP service, browser, engine or installed project is accessed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { validatePairSqlFixture, loadOwnedPairSqlFixture, readOwnedSqlClosure } from './pair-sql-qualification.mjs';

const KIND = 'synthetic-cable-workflow-u7', RUN_KIND = 'synthetic-automatic-pair-sql';
const sha = value => createHash('sha256').update(value).digest('hex');
const need = (condition, code) => { if (!condition) throw Object.assign(Error(code), { code }); };
const quote = value => '"' + value.replaceAll('"', '""') + '"';
export const validateAutomaticPairSqlFixture = (config, filename) => validatePairSqlFixture(config, filename);
/** Reuse the exact compiled production trigger without executing the full bootstrap. */
export function extractAutomaticPairRevisionSql(source) {
  const start = 'CREATE OR REPLACE FUNCTION own_cable_write_revision()';
  const end = 'CREATE UNIQUE INDEX IF NOT EXISTS cables_project_record_identity';
  const at = source.indexOf(start), until = source.indexOf(end, at);
  need(at >= 0 && until > at && source.indexOf(start, at + start.length) === -1 && until - at < 4096, 'U7_AUTOMATIC_REVISION_SOURCE');
  const sql = source.slice(at, until);
  need(!/[`]|\$\{/.test(sql) && sql.includes("current_setting('wfc.pathfinder_apply',true)='1'")
    && sql.includes('CREATE TRIGGER cable_write_revision_owned BEFORE INSERT OR UPDATE ON cables')
    && sql.trimEnd().endsWith('EXECUTE FUNCTION own_cable_write_revision();'), 'U7_AUTOMATIC_REVISION_SOURCE');
  return sql;
}

/** Pure, explicitly synthetic failed-search observation. It supplies no model or
 * collision evidence; production writer/receipt checks still interpret it. */
export function syntheticCapacityNoPathObservation(dependencies, result, restrictionEnabled = true) {
  need(dependencies?.schemaVersion === 'pathfinder.dependencies.v8' && dependencies.settings
    && result?.schemaVersion === 'pathfinder.model.response.v3' && result.status === 'calculated'
    && result.calculationMode === 'calculate' && result.route?.success === true && result.barriers
    && typeof result.barriers === 'object' && !Array.isArray(result.barriers) && typeof restrictionEnabled === 'boolean',
  'U7_AUTOMATIC_CAPACITY_FIXTURE');
  const nextDependencies = structuredClone(dependencies), nextResult = structuredClone(result);
  const layoutSha256 = sha('Explicitly synthetic minimum-free-space SQL observation');
  nextDependencies.settings.routingBalance = { mode: 'destination-groups-v1', layoutSha256 };
  if (restrictionEnabled) nextDependencies.settings.trayCapacity = { enabled: true,
    minimumFreeSpacePercent: 42, tolerancePercentagePoints: 3, layoutSha256 };
  else delete nextDependencies.settings.trayCapacity;
  const verifiedExclusions = { schemaVersion: 'wfc.pf.tray-capacity-diagnostics.v1', minimumFreeSpacePercent: 42,
    effectiveMinimumFreeSpacePercent: 39, tolerancePercentagePoints: 3, restrictionEnabled,
    occupancySha256: sha('Explicitly synthetic tray occupancy; not real geometry or placement'), groupCableCount: 1,
    blockedRouteCodes: ['/A'], unavailableRouteCodes: [], trays: [{ routeCode: '/A', freeSpacePercent: 20, status: 'below-minimum' }] };
  Object.assign(nextResult, { status: 'no_path', message: 'Explicitly synthetic capacity no-path SQL observation.',
    trayCapacity: { ...verifiedExclusions, outcome: 'no-capacity', attempts: 2, excludedRouteCodes: ['/A'] } });
  delete nextResult.route; delete nextResult.design; delete nextResult.lengthLedger;
  Object.assign(nextResult.barriers, { proof: null, qualification: null, directSecondary: null, connectors: { from: null, to: null },
    diagnostics: { ...nextResult.barriers.diagnostics, status: 'blocked' } });
  return { dependencies: nextDependencies, result: nextResult, verifiedExclusions };
}

// Deliberately simulated base metadata; the new feature/job/result DDL, cable
// revision trigger and every writer/history/receipt query come from production.
const CONTEXT_SQL = `
CREATE TABLE projects(id uuid PRIMARY KEY,connection_gap numeric,secondary_tray_length numeric,end_connection_length numeric,additional_bending_percent numeric);
CREATE TABLE users(id uuid PRIMARY KEY,is_admin boolean NOT NULL,pf_admin_revision bigint NOT NULL DEFAULT 0,first_name text,last_name text,email text);
CREATE TABLE viewer_login_bindings(login_id uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz);
CREATE TABLE cable_types(id uuid PRIMARY KEY,name text NOT NULL);
CREATE TABLE cables(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,cable_id integer NOT NULL,
 revision text,mto text,tag text,cable_type_id uuid NOT NULL REFERENCES cable_types(id),from_location text,to_location text,routing text,delivery text,
 design_length integer,install_length integer,materials_initialized boolean NOT NULL DEFAULT false,materials_customized boolean NOT NULL DEFAULT false,
 pull_date date,connected_from date,connected_to date,tested date,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 change_log jsonb NOT NULL DEFAULT '[]',cable_write_revision bigint NOT NULL DEFAULT 0 CHECK(cable_write_revision>=0),UNIQUE(project_id,id));
CREATE TABLE cable_versions(id uuid PRIMARY KEY,cable_id uuid NOT NULL REFERENCES cables(id) ON DELETE CASCADE,version_number integer NOT NULL,
 change_type text NOT NULL,change_source text NOT NULL,cable_number integer NOT NULL,revision text,mto text,tag text,cable_type_id uuid NOT NULL,cable_type_name text NOT NULL,
 from_location text,to_location text,routing text,delivery text,design_length integer,install_length integer,pull_date date,connected_from date,connected_to date,tested date,
 changed_by uuid REFERENCES users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),changed_by_snapshot jsonb,UNIQUE(cable_id,version_number));
CREATE TABLE pf_artifacts(project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,id uuid NOT NULL,PRIMARY KEY(project_id,id));
CREATE TABLE pf_installation_state(singleton boolean PRIMARY KEY CHECK(singleton),installation_epoch uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE pf_location_impact_enrollments(project_id uuid NOT NULL,job_id uuid NOT NULL,impact_id uuid NOT NULL);
CREATE TABLE pf_recalculation_enrollments(project_id uuid NOT NULL,job_id uuid NOT NULL,actor_id uuid NOT NULL,login_id uuid NOT NULL);
`;

export async function qualifyAutomaticPairSql(filename) {
  const owned = await loadOwnedPairSqlFixture(filename), { config, directory } = owned;
  validateAutomaticPairSqlFixture(config, filename);
  const runId = randomUUID(), schema = 'pfu7_auto_pair_' + runId.replaceAll('-', '');
  const output = path.join(directory, 'automatic-pair-sql-qualification-' + runId + '.private.json');
  const reservation = await fs.open(output, 'wx', 0o600), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000), check = () => controller.signal.throwIfAborted();
  const options = { connectionString: config.databaseUrl, max: 3, connectionTimeoutMillis: 5000, statement_timeout: 15000,
    query_timeout: 20000, idle_in_transaction_session_timeout: 30000, application_name: 'pf-u7-automatic-pair-sql-qualification' };
  const publicPool = new Pool(options), pool = new Pool({ ...options, options: '-c search_path=' + schema + ',pg_catalog' });
  const checks = []; let publicBefore, publicAfter, sourceHashes, schemaCreated = false, schemaRemoved = false;
  const guard = async (bounded = true) => {
    if (bounded) check();
    const rows = (await publicPool.query(`SELECT current_database() AS db,(SELECT count(*)::text FROM public.pfu7_fixture_owner) AS owners,
      EXISTS(SELECT 1 FROM public.pfu7_fixture_owner WHERE owner=$1 AND fixture_kind=$2) AS owned`, [config.owner, KIND])).rows;
    need(rows.length === 1 && rows[0].db === config.database && rows[0].owners === '1' && rows[0].owned === true, 'U7_AUTOMATIC_OWNER_MARKER');
  };
  const sql = async (text, values) => { await guard(); const value = await pool.query(text, values); check(); return value; };
  const cleanup = async () => {
    if (!schemaCreated || schemaRemoved) return;
    await guard(false);
    const marker = (await pool.query('SELECT owner,fixture_kind,run_id FROM automatic_pair_fixture_owner')).rows;
    need(marker.length === 1 && marker[0].owner === config.owner && marker[0].fixture_kind === RUN_KIND && marker[0].run_id === runId, 'U7_AUTOMATIC_CLEANUP_OWNER');
    need(schema === 'pfu7_auto_pair_' + runId.replaceAll('-', ''), 'U7_AUTOMATIC_CLEANUP_SCOPE');
    await publicPool.query('DROP SCHEMA ' + quote(schema) + ' CASCADE'); schemaRemoved = true;
  };
  try {
    await guard(); publicBefore = await readOwnedSqlClosure(publicPool, 'public', check);
    const names = ['automaticPairSchema', 'automaticPairMandates', 'automaticPairOwnership', 'automaticPairDispatch', 'automaticPairWriter',
      'automaticPairReceiptProof', 'jobsSchema', 'revisionResultSchema', 'cableWriteHistory', 'endpointBindingRepository', 'schedulerTransaction',
      'auth', 'schema', 'barrierWriteFixtures', 'initialFillBarrierFixtures', 'barrierWrites', 'lengthLedger', 'capacityClearWrite'];
    const files = Object.fromEntries(names.map(name => [name, path.join(config.compiledRoot, 'server/pathfinder', name + '.js')]));
    files.contracts = path.join(config.compiledRoot, 'shared/pathfinderAutomaticPair.js');
    files.operator = fileURLToPath(import.meta.url); files.fixtureGuard = fileURLToPath(new URL('./pair-sql-qualification.mjs', import.meta.url));
    for (const filename of Object.values(files)) {
      const stat = await fs.lstat(filename);
      need(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && path.resolve(await fs.realpath(filename)) === filename, 'U7_AUTOMATIC_SOURCE_PATH');
    }
    sourceHashes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, filename]) => [name, sha(await fs.readFile(filename))])));
    const revisionSql = extractAutomaticPairRevisionSql(await fs.readFile(files.schema, 'utf8'));
    Object.assign(process.env, { DATABASE_URL: config.databaseUrl, JWT_SECRET: config.jwtSecret, MINIO_ACCESS_KEY: config.minioAccessKey,
      MINIO_SECRET_KEY: config.minioSecretKey, MINIO_ENDPOINT: '127.0.0.1', MINIO_PORT: '1', MINIO_USE_SSL: 'false',
      PF_ROOT: config.storageRoot, PF_ENGINE_DLL: config.engineDll, PF_ENGINE_MODE: 'oneshot' });
    const load = name => import(pathToFileURL(files[name]).href);
    const [{ initializeAutomaticPairSchema }, { appendAutomaticPairMandatesInTransaction }, { readAutomaticPairOwnership },
      { createAutomaticPairDispatch }, { createAutomaticPairWriter }, { createAutomaticPairReceiptProofReader, automaticPairHash },
      { initializePathFinderJobs }, { initializeRevisionResultSchema }, { endpointBindingTransaction },
      { syntheticBarrierWriteInputs }, { syntheticInitialFillBarrierInputs }, { AUTOMATIC_PAIR_POLICY },
      { validCapacityClearEvidence }] = await Promise.all([
      load('automaticPairSchema'), load('automaticPairMandates'), load('automaticPairOwnership'), load('automaticPairDispatch'), load('automaticPairWriter'),
      load('automaticPairReceiptProof'), load('jobsSchema'), load('revisionResultSchema'), load('endpointBindingRepository'),
      load('barrierWriteFixtures'), load('initialFillBarrierFixtures'), load('contracts'), load('capacityClearWrite')]);
    const create = await pool.connect();
    try {
      await guard(); await create.query('BEGIN'); await create.query('CREATE SCHEMA ' + quote(schema));
      await create.query('CREATE TABLE automatic_pair_fixture_owner(owner uuid PRIMARY KEY,fixture_kind text NOT NULL,run_id uuid NOT NULL)');
      await create.query('INSERT INTO automatic_pair_fixture_owner VALUES($1,$2,$3)', [config.owner, RUN_KIND, runId]);
      await create.query('COMMIT'); schemaCreated = true;
    } catch (error) { await create.query('ROLLBACK').catch(() => undefined); throw error; } finally { create.release(); }
    await sql(CONTEXT_SQL); await sql(revisionSql); await guard(); await initializePathFinderJobs(pool);
    await sql("ALTER TABLE pf_jobs ADD COLUMN authority_kind text NOT NULL DEFAULT 'current-login',ADD COLUMN grant_provenance jsonb");
    await guard(); await initializeRevisionResultSchema(pool); await guard(); await initializeAutomaticPairSchema(pool);
    const fixture = syntheticBarrierWriteInputs(), id = fixture.id, projectId = fixture.dependencies.projectId, cableId = fixture.dependencies.cableId;
    const who = { userId: id(130), loginId: id(140), loginExpiresAt: Date.now() + 600000 }, seals = new Map(), capacityObservations = new Map(), positiveCapacityObservations = new Map();
    let capacityObservationReads = 0;
    const seal = async (_client, input) => seals.get(input.proposalId) ?? null;
    const proof = (client, input) => createAutomaticPairReceiptProofReader(client, check, { seal })(input);
    const ownership = (client, input, bounded = check) => readAutomaticPairOwnership(client, input, bounded,
      { proof: createAutomaticPairReceiptProofReader(client, bounded, { seal }) });
    const readCable = async (client = pool) => (await client.query(`SELECT to_jsonb(c)||jsonb_build_object('design_length',c.design_length::text,
      'install_length',c.install_length::text,'cable_write_revision',c.cable_write_revision::text) AS value FROM cables c WHERE project_id=$1 AND id=$2`, [projectId, cableId])).rows[0]?.value;
    const dispatch = createAutomaticPairDispatch(pool);
    // Only external prepared geometry/seals/currentness are simulated. The
    // production immutable proof reader, ownership and current-login fences run.
    // Capacity input is also simulated: only this exact fixture job's retained
    // diagnostics can be returned through the production evidence-validation seam.
    const writer = createAutomaticPairWriter(pool, { proof, ownership, seal, snapshot: async () => ({}),
      barrierFence: async (_client, dependencies) => dependencies.engineIdentity, applicability: async () => ({ applicable: true }),
      clearApplicability: async () => true,
      capacityEvidence: async (_client, input) => {
        check(); capacityObservationReads++;
        const observation = capacityObservations.get(input.jobId);
        if (!observation || automaticPairHash(input.dependencies) !== observation.dependencySha256
          || automaticPairHash(input.result) !== observation.engineResultSha256
          || !validCapacityClearEvidence(input.dependencies, input.result, observation)) return null;
        return structuredClone(observation);
      },
      currentPositiveCapacity: async (_client, input) => {
        check(); const observation = positiveCapacityObservations.get(input.jobId);
        if (!observation || automaticPairHash(input.dependencies) !== observation.dependencySha256
          || automaticPairHash(input.result) !== observation.engineResultSha256) return false;
        // Explicitly simulated placement race, never a claim about real trays.
        return observation.answers[Math.min(observation.reads++, observation.answers.length - 1)];
      },
      collect: async (client, _project, _cable, _options, _version, _lock, _identity) => {
        const row = await readCable(client), latest = [...seals.values()].at(-1);
        return { dependencies: latest?.dependencies, cable: row };
      } });
    need(typeof writer.inspectInTransaction === 'function' && typeof dispatch.reconcileNext === 'function', 'U7_AUTOMATIC_RECONCILIATION_BUILD_REQUIRED');
    let serial = 200;
    const seed = async (routing = null, design = null) => {
      await sql('TRUNCATE projects,cable_types,users,viewer_login_bindings,pf_installation_state CASCADE'); seals.clear(); capacityObservations.clear(); positiveCapacityObservations.clear();
      await sql('INSERT INTO projects(id) VALUES($1)', [projectId]);
      await sql("INSERT INTO users(id,is_admin,pf_admin_revision,first_name,last_name,email) VALUES($1,true,2,'Synthetic','Qualifier','synthetic.invalid')", [who.userId]);
      await sql('INSERT INTO viewer_login_bindings VALUES($1,$2,$3,NULL)', [who.loginId, who.userId, new Date(who.loginExpiresAt)]);
      await sql('INSERT INTO pf_installation_state(singleton,installation_epoch) VALUES(true,$1)', [runId]);
      await sql("INSERT INTO cable_types(id,name) VALUES($1,'Synthetic cable type')", [id(17)]);
      await sql(`INSERT INTO cables(id,project_id,cable_id,revision,mto,tag,cable_type_id,from_location,to_location,routing,design_length,install_length)
        VALUES($1,$2,1,'business-revision','LV','Synthetic cable',$3,'FROM','TO',$4,$5,99)`, [cableId, projectId, id(17), routing, design]);
    };
    const observe = async ({ route = '/A', longer = false, admitted = true, capacityNoPath = false, capacityPositive = false, restrictionEnabled = true } = {}) => {
      need(!(capacityNoPath && capacityPositive), 'U7_AUTOMATIC_CAPACITY_FIXTURE');
      const before = await readCable(), legacy = structuredClone(fixture.legacy), response = structuredClone(fixture.response);
      legacy.cableWriteRevision = before.cable_write_revision; response.route.routeText = route;
      if (longer) {
        response.route.lengthMeters = 10; response.route.pathPoints[1].x = 10;
        response.design = { lengthBeforePercentageMeters: '11', unroundedLengthMeters: '12.1', designLengthMeters: '13' };
        Object.assign(response.lengthLedger, { rawLengthDecimalMeters: '10', beforeClampMeters: '10', afterClampMeters: '10',
          beforePercentageMeters: '11', bendingIncrementMeters: '1.1', unroundedMeters: '12.1', ceilingIncrementMeters: '0.9', designLengthMeters: '13' });
        response.lengthLedger.raw.lengthMeters = 10;
      }
      let { dependencies, result } = syntheticInitialFillBarrierInputs(legacy, response);
      const capacity = capacityNoPath || capacityPositive ? syntheticCapacityNoPathObservation(dependencies, result, restrictionEnabled) : null;
      if (capacity) {
        dependencies = capacity.dependencies;
        if (capacityNoPath) result = capacity.result;
        else result.trayCapacity = { ...capacity.verifiedExclusions, blockedRouteCodes: [],
          trays: result.route.routeCodes.map(routeCode => ({ routeCode, freeSpacePercent: 50, status: 'fits' })),
          outcome: 'fits', attempts: 1, excludedRouteCodes: [] };
      }
      const jobId = id(serial++), proposalId = id(serial++), admissionId = id(serial++);
      const dependencyHash = automaticPairHash(dependencies), proposalHash = automaticPairHash({ synthetic: true, dependencies, result });
      const requestSha256 = automaticPairHash({ syntheticSqlObservation: jobId, policy: AUTOMATIC_PAIR_POLICY, dependencyHash });
      await sql(`INSERT INTO pf_jobs(id,project_id,requested_by,login_id,login_expires_at,state,total,completed,options,timeout_ms,request_hash)
        VALUES($1,$2,$3,$4,$5,'complete',1,1,$6,60000,$7)`, [jobId, projectId, who.userId, who.loginId, new Date(who.loginExpiresAt), dependencies.options, requestSha256]);
      await sql("INSERT INTO pf_job_items(project_id,job_id,cable_id,state,dependencies,status,message) VALUES($1,$2,$3,'complete',$4,$5,'Explicitly synthetic engine result')", [projectId, jobId, cableId, dependencies, result.status]);
      await sql(`INSERT INTO pf_proposals(id,project_id,job_id,cable_id,status,dependencies,dependency_hash,geometry_hash,result,proposal_hash)
        VALUES($1,$2,$3,$4,$9,$5,$6,$6,$7,$8)`, [proposalId, projectId, jobId, cableId, dependencies, dependencyHash, result, proposalHash, result.status]);
      const evidence = { projectId, jobId, cableId, admissionId, proposalId, baselineHash: automaticPairHash(before), dependencyHash,
        engineResultSha256: automaticPairHash(result), ledgerHash: result.lengthLedger ? automaticPairHash(result.lengthLedger) : null,
        revisionResultSha256: automaticPairHash({ syntheticSeal: proposalId }), dependencies };
      // Production FK/CHECK/immutable storage, but deliberately synthetic seal
      // interpretation through the explicit external-seal adapter above.
      await sql(`INSERT INTO pf_revision_admissions(id,project_id,job_id,kind,input_sha256,options,total,observed_events)
        VALUES($1,$2,$3,'manual',$4,$5,1,'[]')`, [admissionId, projectId, jobId, requestSha256, dependencies.options]);
      await sql(`INSERT INTO pf_revision_baselines(project_id,admission_id,cable_id,baseline_sha256,baseline,status,message)
        VALUES($1,$2,$3,$4,$5,'ready','Synthetic SQL observation')`, [projectId, admissionId, cableId, evidence.baselineHash, { currentCable: before }]);
      await sql(`INSERT INTO pf_revision_results(id,project_id,admission_id,job_id,cable_id,proposal_id,baseline_sha256,dependency_sha256,
        engine_result_sha256,ledger_sha256,record_sha256,record) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id(serial++), projectId, admissionId, jobId, cableId, proposalId, evidence.baselineHash, dependencyHash,
        evidence.engineResultSha256, evidence.ledgerHash, evidence.revisionResultSha256, evidence]);
      seals.set(proposalId, evidence);
      if (capacityNoPath) capacityObservations.set(jobId, { schemaVersion: 'wfc.pf.capacity-clear-evidence.v1', projectId, cableId,
        dependencySha256: dependencyHash, engineResultSha256: evidence.engineResultSha256, verifiedExclusions: capacity.verifiedExclusions });
      if (capacityPositive) positiveCapacityObservations.set(jobId, { dependencySha256: dependencyHash,
        engineResultSha256: evidence.engineResultSha256, answers: [true, false], reads: 0 });
      let mandates = 0;
      if (admitted) { await guard(); mandates = await endpointBindingTransaction(pool, projectId, who, client => appendAutomaticPairMandatesInTransaction(client,
        { projectId, jobId, principal: who, policy: AUTOMATIC_PAIR_POLICY, requestSha256, source: { kind: 'explicit-job' },
          items: [{ cableId, cableWriteRevision: before.cable_write_revision, dependencyHash }] }, check, { ownership }), controller.signal); }
      return { jobId, proposalId, dependencies, result, mandates, before };
    };
    const perform = async (name, work) => { check(); const started = performance.now(); await work(); checks.push({ name, status: 'PASS', milliseconds: Math.round(performance.now() - started) }); };
    const applyNext = async () => {
      await guard(); const claim = await dispatch.claim(controller.signal); assert.ok(claim);
      const outcome = await writer.apply(claim, dispatch.fence, controller.signal); await dispatch.finish(claim, outcome); return { claim, outcome };
    };
    const counts = async () => (await sql(`SELECT (SELECT count(*)::int FROM pf_apply_receipts) AS receipts,(SELECT count(*)::int FROM cable_versions) AS histories`)).rows[0];
    const readOwnership = async () => { await guard(); const client = await pool.connect(); try { return await ownership(client, { projectId, cableId, currentSnapshot: await readCable(client) }); } finally { client.release(); } };
    const exhaustClaims = async () => {
      for (let attempt = 0; attempt < 3; attempt++) { assert.ok(await dispatch.claim(controller.signal)); await sql("UPDATE pf_automatic_pair_dispatch SET lease_until=clock_timestamp()-interval '1 second'"); }
      assert.equal(await dispatch.claim(controller.signal), null);
    };
    // Move only synthetic bookkeeping time; no waiting or claim/write retry is
    // used to qualify the separate sixty-second read reconciliation path.
    const dueUnknown = () => sql(`UPDATE pf_automatic_pair_dispatch SET status='unknown',attempts=3,receipt_id=NULL,
      owner_token=NULL,lease_until=NULL,not_before=NULL,reason_code='AUTOMATIC_PAIR_RECOVERY_LIMIT',updated_at=clock_timestamp()-interval '61 seconds'`);
    const dispatchState = async () => (await sql(`SELECT status,reason_code,attempts,owner_token,lease_until,receipt_id,not_before,
      EXTRACT(EPOCH FROM(not_before-updated_at))::double precision AS backoff_seconds FROM pf_automatic_pair_dispatch`)).rows[0];

    await perform('production empty-pair mandate, dispatch, atomic writer, audit and immutable receipt SQL', async () => {
      await seed(); const observed = await observe(); assert.equal(observed.mandates, 1); const { outcome } = await applyNext(); assert.equal(outcome.status, 'written');
      const cable = await readCable(); assert.equal(cable.routing, '/A'); assert.equal(cable.design_length, '7'); assert.equal(cable.install_length, '99');
      assert.equal(cable.revision, 'business-revision'); assert.equal(cable.cable_write_revision, '1'); assert.deepEqual(await counts(), { receipts: 1, histories: 1 });
      assert.equal((await readOwnership()).kind, 'automatic');
    });
    await perform('unchanged automatic pair replaces route and Design length using a real prior receipt/history chain', async () => {
      await seed(); await observe(); await applyNext(); const second = await observe({ route: '/B', longer: true }); assert.equal(second.mandates, 1);
      assert.equal((await applyNext()).outcome.status, 'written'); const cable = await readCable(); assert.equal(cable.routing, '/B');
      assert.equal(cable.design_length, '13'); assert.equal(cable.install_length, '99'); assert.equal(cable.cable_write_revision, '2');
      assert.deepEqual(await counts(), { receipts: 2, histories: 2 }); assert.equal((await readOwnership()).kind, 'automatic');
    });
    let capacityClearOriginReceipt;
    await perform('capacity ON clears only the automatic route/design pair with real audit and null-ledger capacity provenance', async () => {
      await seed(); await observe(); const original = await applyNext(); capacityClearOriginReceipt = original.outcome.receiptId;
      const observed = await observe({ capacityNoPath: true }); assert.equal(observed.mandates, 1);
      assert.equal(observed.dependencies.settings.trayCapacity.enabled, true); assert.equal(observed.result.status, 'no_path');
      const reads = capacityObservationReads, { claim, outcome } = await applyNext(); assert.equal(outcome.status, 'written');
      assert.equal(capacityObservationReads - reads, 2);
      const cable = await readCable(); assert.equal(cable.routing, null); assert.equal(cable.design_length, null);
      assert.equal(cable.install_length, '99'); assert.equal(cable.revision, 'business-revision'); assert.equal(cable.cable_write_revision, '2');
      assert.deepEqual(await counts(), { receipts: 2, histories: 2 });
      const receipt = (await sql('SELECT before_snapshot,after_snapshot,provenance FROM pf_apply_receipts WHERE id=$1', [outcome.receiptId])).rows[0];
      assert.equal(receipt.before_snapshot.routing, '/A'); assert.equal(receipt.after_snapshot.routing, null);
      assert.equal(receipt.after_snapshot.design_length, null); assert.equal(receipt.after_snapshot.install_length, '99');
      assert.equal(receipt.provenance.schemaVersion, 'pathfinder.automatic-pair-capacity-clear.v1');
      assert.equal(receipt.provenance.validationMethod, 'automatic-owned-capacity-clear');
      assert.equal(receipt.provenance.revisionResult.ledgerHash, null); assert.equal(Object.hasOwn(receipt.provenance, 'barrierEvidence'), false);
      assert.equal(receipt.provenance.capacityEvidence.verifiedExclusions.restrictionEnabled, true);
      const owned = await readOwnership(); assert.equal(owned.kind, 'automatic');
      assert.equal(owned.originReceiptId, capacityClearOriginReceipt); assert.equal(owned.previousReceiptId, outcome.receiptId);
      assert.deepEqual(await writer.apply(claim, dispatch.fence, controller.signal), { status: 'already-written', receiptId: outcome.receiptId });
      assert.deepEqual(await counts(), { receipts: 2, histories: 2 }); assert.deepEqual(await readCable(), cable);
    });
    await perform('a later calculated route refills the cleared pair through its original automatic ownership chain', async () => {
      const observed = await observe({ route: '/B', longer: true }); assert.equal(observed.mandates, 1);
      assert.equal((await applyNext()).outcome.status, 'written');
      const cable = await readCable(); assert.equal(cable.routing, '/B'); assert.equal(cable.design_length, '13');
      assert.equal(cable.install_length, '99'); assert.equal(cable.cable_write_revision, '3');
      assert.deepEqual(await counts(), { receipts: 3, histories: 3 });
      const owned = await readOwnership(); assert.equal(owned.kind, 'automatic'); assert.equal(owned.originReceiptId, capacityClearOriginReceipt);
    });
    await perform('capacity no-path retains manually changed route/design values without admitting a clear mandate', async () => {
      await seed(); await observe(); await applyNext();
      await sql("UPDATE cables SET routing='/MANUAL',design_length=44 WHERE id=$1", [cableId]);
      const before = await readCable(), observed = await observe({ capacityNoPath: true });
      assert.equal(observed.mandates, 0); assert.equal((await readOwnership()).kind, 'review-required');
      assert.equal(await dispatch.claim(controller.signal), null); assert.deepEqual(await readCable(), before);
      assert.deepEqual(await counts(), { receipts: 1, histories: 1 });
    });
    await perform('capacity OFF refuses a synthetic no-capacity result before automatic dispatch and preserves the earlier route', async () => {
      await seed(); await observe(); await applyNext(); const before = await readCable(), reads = capacityObservationReads;
      const observed = await observe({ capacityNoPath: true, restrictionEnabled: false }); assert.equal(observed.mandates, 1);
      assert.equal(Object.hasOwn(observed.dependencies.settings, 'trayCapacity'), false);
      assert.equal(observed.result.trayCapacity.restrictionEnabled, false);
      assert.equal(await dispatch.discover(controller.signal), 1); assert.equal(await dispatch.claim(controller.signal), null);
      const state = (await sql('SELECT status,reason_code FROM pf_automatic_pair_dispatch WHERE project_id=$1 AND job_id=$2 AND cable_id=$3',
        [projectId, observed.jobId, cableId])).rows[0];
      assert.deepEqual(state, { status: 'refused', reason_code: 'AUTOMATIC_PAIR_NO_CURRENT_RESULT' });
      assert.equal(capacityObservationReads, reads); assert.deepEqual(await readCable(), before);
      assert.deepEqual(await counts(), { receipts: 1, histories: 1 });
    });
    await perform('positive capacity ON final-fence refusal rolls back the actual route/design, audit and receipt SQL', async () => {
      await seed(); await observe(); await applyNext(); const before = await readCable(), audit = await counts();
      const observed = await observe({ route: '/B', longer: true, capacityPositive: true }); assert.equal(observed.mandates, 1);
      assert.equal(observed.dependencies.settings.trayCapacity.enabled, true); assert.equal(observed.result.status, 'calculated');
      const claim = await dispatch.claim(controller.signal); assert.ok(claim);
      await assert.rejects(writer.apply(claim, dispatch.fence, controller.signal), error => error.code === 'AUTOMATIC_PAIR_CAPACITY_CHANGED');
      assert.equal(positiveCapacityObservations.get(observed.jobId).reads, 2);
      assert.deepEqual(await readCable(), before); assert.deepEqual(await counts(), audit); assert.deepEqual(audit, { receipts: 1, histories: 1 });
      await dispatch.finish(claim, { status: 'refused', receiptId: null, code: 'AUTOMATIC_PAIR_CAPACITY_CHANGED' });
      assert.deepEqual((await sql('SELECT status,reason_code FROM pf_automatic_pair_dispatch WHERE project_id=$1 AND job_id=$2 AND cable_id=$3',
        [projectId, observed.jobId, cableId])).rows[0], { status: 'refused', reason_code: 'AUTOMATIC_PAIR_CAPACITY_CHANGED' });
      assert.equal(await dispatch.claim(controller.signal), null);
    });
    await perform('manual change-and-restore cannot reacquire automatic ownership from equal restored values', async () => {
      await seed(); await observe(); await applyNext(); await sql("UPDATE cables SET routing='/MANUAL' WHERE id=$1", [cableId]);
      await sql("UPDATE cables SET routing='/A' WHERE id=$1", [cableId]); const before = await readCable(); assert.equal(before.cable_write_revision, '3');
      assert.deepEqual(await readOwnership(), { kind: 'review-required', reasonCode: 'AUTOMATIC_PAIR_MANUAL_CHANGE' });
      assert.equal((await observe({ route: '/B', longer: true })).mandates, 0); assert.equal(await dispatch.claim(controller.signal), null);
      assert.deepEqual(await readCable(), before); assert.deepEqual(await counts(), { receipts: 1, histories: 1 });
    });
    await perform('manual clearing of both previously written fields requires confirmation and cannot restart automatic initial fill', async () => {
      await seed(); await observe(); await applyNext();
      await sql('UPDATE cables SET routing=NULL,design_length=NULL WHERE id=$1', [cableId]); const before = await readCable();
      assert.equal(before.routing, null); assert.equal(before.design_length, null); assert.equal(before.cable_write_revision, '2');
      assert.deepEqual(await readOwnership(), { kind: 'review-required', reasonCode: 'AUTOMATIC_PAIR_MANUAL_CLEAR' });
      const next = await observe({ route: '/B', longer: true }); assert.equal(next.mandates, 0);
      assert.equal((await sql('SELECT count(*)::int AS count FROM pf_automatic_pair_mandates WHERE job_id=$1', [next.jobId])).rows[0].count, 0);
      assert.equal(await dispatch.claim(controller.signal), null);
      assert.deepEqual(await readCable(), before); assert.deepEqual(await counts(), { receipts: 1, histories: 1 });
    });
    await perform('manual edit after admission preserves current cable values and refuses the frozen pair', async () => {
      await seed(); await observe(); await sql("UPDATE cables SET design_length=44 WHERE id=$1", [cableId]); const before = await readCable();
      assert.equal((await applyNext()).outcome.status, 'stale'); assert.deepEqual(await readCable(), before); assert.deepEqual(await counts(), { receipts: 0, histories: 0 });
    });
    await perform('receipt insertion failure rolls back the real pair UPDATE and production history together', async () => {
      await seed(); await observe(); const before = await readCable();
      await sql(`CREATE FUNCTION synthetic_receipt_refusal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt refusal'; END $$;
        CREATE TRIGGER synthetic_receipt_refusal BEFORE INSERT ON pf_apply_receipts FOR EACH ROW EXECUTE FUNCTION synthetic_receipt_refusal()`);
      const claim = await dispatch.claim(controller.signal); assert.ok(claim);
      try { await assert.rejects(writer.apply(claim, dispatch.fence, controller.signal), error => error.code === 'P0001'); }
      finally { await sql('DROP TRIGGER synthetic_receipt_refusal ON pf_apply_receipts; DROP FUNCTION synthetic_receipt_refusal()'); }
      assert.deepEqual(await readCable(), before); assert.deepEqual(await counts(), { receipts: 0, histories: 0 });
    });
    await perform('committed receipt replay reconciles before expired authority without another business write', async () => {
      await seed(); await observe(); const { claim, outcome } = await applyNext(), before = await readCable();
      await sql('UPDATE viewer_login_bindings SET revoked_at=clock_timestamp() WHERE login_id=$1', [who.loginId]);
      assert.deepEqual(await writer.apply(claim, dispatch.fence, controller.signal), { status: 'already-written', receiptId: outcome.receiptId });
      assert.deepEqual(await readCable(), before); assert.deepEqual(await counts(), { receipts: 1, histories: 1 });
    });
    await perform('real claim lease recovery fences the former owner and bounded exhaustion never writes a cable', async () => {
      await seed(); await observe(); const first = await dispatch.claim(controller.signal); assert.ok(first); assert.equal(await dispatch.claim(controller.signal), null);
      await sql("UPDATE pf_automatic_pair_dispatch SET lease_until=clock_timestamp()-interval '1 second'");
      const second = await dispatch.claim(controller.signal); assert.ok(second); assert.notEqual(first.ownerToken, second.ownerToken);
      const client = await pool.connect(); try { await assert.rejects(dispatch.fence(client, first), error => error.code === 'AUTOMATIC_PAIR_CLAIM_FENCED'); } finally { client.release(); }
      assert.equal((await writer.apply(second, dispatch.fence, controller.signal)).status, 'written');
      await seed(); await observe();
      await exhaustClaims();
      const exhausted = (await sql('SELECT status,reason_code,attempts,owner_token,lease_until,not_before FROM pf_automatic_pair_dispatch')).rows[0];
      assert.deepEqual(exhausted, { status: 'unknown', reason_code: 'AUTOMATIC_PAIR_RECOVERY_LIMIT', attempts: 3, owner_token: null, lease_until: null, not_before: null });
      assert.deepEqual(await counts(), { receipts: 0, histories: 0 });
    });
    await perform('three exhausted attempts reconcile a confirmed absent receipt without a fourth pair write', async () => {
      await seed(); await observe(); await exhaustClaims(); await dueUnknown(); const before = await readCable(), audit = await counts();
      const outcome = await dispatch.reconcileNext(writer.inspectInTransaction, controller.signal);
      assert.deepEqual(outcome, { status: 'refused', receiptId: null, code: 'AUTOMATIC_PAIR_NOT_WRITTEN_CONFIRMED' });
      const state = await dispatchState(); assert.equal(state.status, 'refused'); assert.equal(state.attempts, 3);
      assert.equal(state.reason_code, 'AUTOMATIC_PAIR_NOT_WRITTEN_CONFIRMED'); assert.equal(state.receipt_id, null);
      assert.equal(state.owner_token, null); assert.equal(state.lease_until, null); assert.equal(state.not_before, null);
      assert.deepEqual(await readCable(), before); assert.deepEqual(await counts(), audit); assert.deepEqual(audit, { receipts: 0, histories: 0 });
      assert.equal(await dispatch.claim(controller.signal), null); assert.equal(await dispatch.reconcileNext(writer.inspectInTransaction, controller.signal), null);
    });
    await perform('exhausted unknown status recognizes an actual committed receipt after a later manual change without overwriting it', async () => {
      await seed(); await observe(); const { outcome: committed } = await applyNext();
      await sql("UPDATE cables SET routing='/AFTER-COMMIT-MANUAL',design_length=44 WHERE id=$1", [cableId]);
      await sql('UPDATE viewer_login_bindings SET revoked_at=clock_timestamp() WHERE login_id=$1', [who.loginId]);
      await dueUnknown(); const before = await readCable(), audit = await counts();
      const outcome = await dispatch.reconcileNext(writer.inspectInTransaction, controller.signal);
      assert.deepEqual(outcome, { status: 'already-written', receiptId: committed.receiptId });
      const state = await dispatchState(); assert.equal(state.status, 'already-written'); assert.equal(state.attempts, 3); assert.equal(state.receipt_id, committed.receiptId);
      assert.equal(state.owner_token, null); assert.equal(state.lease_until, null); assert.equal(state.not_before, null);
      assert.deepEqual(await readCable(), before); assert.equal(before.routing, '/AFTER-COMMIT-MANUAL'); assert.equal(before.design_length, '44');
      assert.deepEqual(await counts(), audit); assert.deepEqual(audit, { receipts: 1, histories: 1 }); assert.equal(await dispatch.claim(controller.signal), null);
    });
    await perform('unavailable historical proof retains exhausted unknown status with a sixty-second read-only backoff', async () => {
      await seed(); await observe(); await applyNext(); await dueUnknown(); seals.clear();
      const before = await readCable(), audit = await counts();
      const outcome = await dispatch.reconcileNext(writer.inspectInTransaction, controller.signal);
      assert.equal(outcome.status, 'unknown'); assert.equal(outcome.receiptId, null);
      const state = await dispatchState(); assert.equal(state.status, 'unknown'); assert.equal(state.attempts, 3);
      assert.equal(state.owner_token, null); assert.equal(state.lease_until, null); assert.equal(state.receipt_id, null);
      assert.equal(Math.round(state.backoff_seconds), 60); assert.ok(state.not_before instanceof Date && state.not_before.getTime() > Date.now());
      assert.deepEqual(await readCable(), before); assert.deepEqual(await counts(), audit); assert.deepEqual(audit, { receipts: 1, histories: 1 });
      assert.equal(await dispatch.claim(controller.signal), null); assert.equal(await dispatch.reconcileNext(writer.inspectInTransaction, controller.signal), null);
    });
    await perform('production mandate immutability, exact item FK, status CHECK and pending terminal discovery', async () => {
      await seed(); const observed = await observe();
      await assert.rejects(sql('UPDATE pf_automatic_pair_mandates SET record=record'), error => error.code === 'P0001');
      await assert.rejects(sql('DELETE FROM pf_automatic_pair_mandates'), error => error.code === 'P0001');
      await assert.rejects(sql("UPDATE pf_automatic_pair_dispatch SET status='invalid'"), error => error.code === '23514');
      await assert.rejects(sql(`INSERT INTO pf_automatic_pair_dispatch(project_id,job_id,cable_id) VALUES($1,$2,$3)`, [projectId, observed.jobId, id(9999)]), error => error.code === '23503');
      await sql('UPDATE pf_jobs SET cancel_requested=true WHERE id=$1', [observed.jobId]); assert.equal(await dispatch.discover(controller.signal), 1);
      assert.equal((await sql('SELECT status FROM pf_automatic_pair_dispatch')).rows[0].status, 'refused');
      assert.deepEqual(await counts(), { receipts: 0, histories: 0 });
    });
    for (const [name, filename] of Object.entries(files)) need(sha(await fs.readFile(filename)) === sourceHashes[name], 'U7_AUTOMATIC_SOURCE_CHANGED');
    await cleanup(); await guard(); publicAfter = await readOwnedSqlClosure(publicPool, 'public', check);
    assert.equal(publicAfter.contentSha256, publicBefore.contentSha256);
    checks.push({ name: 'owned random schema removed and complete preexisting public table closure unchanged', status: 'PASS', tables: publicBefore.tables.length });
    const receipt = { schemaVersion: 'wfc.pf.u7-automatic-pair-sql-qualification.v1', status: 'PASS', synthetic: true, owner: config.owner, runId,
      database: config.database, containerId: owned.containerId, configSha256: owned.configSha256, schema, schemaRemoved, sourceHashes, checks, publicBefore, publicAfter,
      scope: 'Actual PostgreSQL production automatic-pair mandate/ownership/dispatch/writer/receipt-proof/history, automatic capacity-clear and refill lineage, read-only exhausted-outcome reconciliation SQL, production job/result/automatic-pair DDL and exact cable revision trigger in synthetic isolated context.',
      simulated: ['Base project/user/login/cable metadata', 'Engine calculation and sealed-result observations', 'Dependency collection and applicability', 'Current barrier runtime and artifact snapshot', 'Exact synthetic capacity exclusion observations through the production validation seam; not real tray placement or geometry', 'Exact-job positive capacity probe changes from fits to blocked at the final fence; placement itself is simulated', 'Unknown dispatch state and due time after actual committed or absent writes'],
      notProven: ['Real application authentication/HTTP/browser', 'Engine output or true result seals', 'Real model geometry or collision safety', 'Full application bootstrap or installed schema', 'Lost transport COMMIT acknowledgment'] };
    await reservation.writeFile(JSON.stringify(receipt, null, 2) + '\n'); await reservation.sync();
    console.log(JSON.stringify({ status: 'PASS', synthetic: true, checks: checks.length, schemaRemoved, receipt: output })); return receipt;
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,96}$/.test(error.code) ? error.code : 'U7_AUTOMATIC_QUALIFICATION_FAILED';
    const recoveryUntil = Date.now() + 30000, recoveryCheck = () => need(Date.now() <= recoveryUntil, 'U7_AUTOMATIC_RECOVERY_DEADLINE');
    let cleanupCode;
    try { await cleanup(); } catch (failure) { cleanupCode = typeof failure?.code === 'string' ? failure.code : 'U7_AUTOMATIC_CLEANUP_FAILED'; }
    if (publicBefore) try { recoveryCheck(); await guard(false); publicAfter = await readOwnedSqlClosure(publicPool, 'public', recoveryCheck); } catch { /* Unavailable is not unchanged. */ }
    await reservation.writeFile(JSON.stringify({ schemaVersion: 'wfc.pf.u7-automatic-pair-sql-qualification.v1', status: 'FAIL', synthetic: true,
      owner: config.owner, runId, schema, schemaRemoved, code, cleanupCode, checks, sourceHashes, publicBefore, publicAfter }, null, 2) + '\n'); await reservation.sync();
    console.log(JSON.stringify({ status: 'FAIL', synthetic: true, code, cleanupCode, schemaRemoved, receipt: output })); throw Object.assign(Error(code), { code });
  } finally { clearTimeout(timer); controller.abort(); await Promise.allSettled([pool.end(), publicPool.end()]); await reservation.close(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  need(process.argv.length === 4 && process.argv[2] === '--fixture', 'U7_AUTOMATIC_ARGUMENTS');
  await qualifyAutomaticPairSql(path.resolve(process.argv[3])).catch(() => { process.exitCode = 1; });
}
