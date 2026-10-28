// ROOT-only actual PostgreSQL qualification for an already created disposable U7
// fixture. This never controls Docker or an application and never creates Ready
// model metadata. Run only after owned-pg.mjs created its guarded public schema.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { compareCurrentInventories } from '../pathfinder-copied-recovery/current-inventory-lib.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SCRATCH = path.join(ROOT, 'pathfinder-engine/.scratch');
const KIND = 'synthetic-cable-workflow-u7';
const IMAGE = 'sha256:9a2e0383c38afd52cff14eeefe2b806fcde406b317002cd13ce513d309942751';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const run = promisify(execFile);
const sha = value => createHash('sha256').update(value).digest('hex');
const need = (condition, code) => { if (!condition) throw Object.assign(Error(code), { code }); };
const id = n => `97000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PRECISION = '9007199254740993.123456789012345678901234567890';
const CHANGED_PRECISION = '9007199254740993.123456789012345678901234567891';

async function canonical(filename, directory) {
  need(path.isAbsolute(filename) && path.resolve(filename) === filename, 'U7_INVENTORY_PATH');
  for (let part = filename;; part = path.dirname(part)) {
    const stat = await fs.lstat(part);
    need(!stat.isSymbolicLink() && (part === filename && !directory ? stat.isFile() && stat.nlink === 1 : stat.isDirectory()), 'U7_INVENTORY_PATH');
    need(path.resolve(await fs.realpath(part)) === part, 'U7_INVENTORY_PATH');
    if (path.dirname(part) === part) break;
  }
  return filename;
}

async function configuration(filename) {
  await canonical(filename, false);
  const stat = await fs.stat(filename); need(stat.size > 0 && stat.size < 32 * 1024, 'U7_INVENTORY_CONFIG');
  const raw = await fs.readFile(filename), config = JSON.parse(raw.toString('utf8'));
  const directory = path.dirname(filename);
  need(path.basename(filename) === 'fixture.private.json' && config.schemaVersion === 'wfc.pf.u7-chain-fixture.v1' && UUID.test(config.owner ?? '')
    && path.dirname(directory) === SCRATCH && path.basename(directory) === 'cable-workflow-u7-' + config.owner
    && config.database === 'wfc_pfu7_' + config.owner.replaceAll('-', '')
    && config.containerName === 'pfu7-pg-' + config.owner.replaceAll('-', '').slice(0, 12)
    && config.compiledRoot === path.join(ROOT, 'server/dist') && config.storageRoot === path.join(directory, 'storage'), 'U7_INVENTORY_CONFIG');
  await canonical(directory, true); await canonical(config.compiledRoot, true);
  const url = new URL(config.databaseUrl);
  need(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && url.pathname === '/' + config.database
    && url.username === 'pfu7' && Boolean(url.password) && /^\d{1,5}$/.test(url.port) && Number(url.port) > 0 && Number(url.port) <= 65535
    && !url.search && !url.hash, 'U7_INVENTORY_DATABASE');
  const output = await run('docker', ['inspect', config.containerName], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  const containers = JSON.parse(output.stdout), container = containers[0], ports = container?.NetworkSettings?.Ports?.['5432/tcp'];
  need(containers.length === 1 && container.Name === '/' + config.containerName && container.Image === IMAGE
    && container.Config?.Labels?.['wfc.pathfinder.owner'] === config.owner && container.Config?.Labels?.['wfc.pathfinder.fixture'] === KIND
    && container.State?.Running === true && container.Mounts.every(mount => mount.Type === 'tmpfs')
    && container.HostConfig.Privileged === false && container.HostConfig.RestartPolicy.Name === 'no'
    && ports?.length === 1 && ports[0].HostIp === '127.0.0.1' && ports[0].HostPort === url.port, 'U7_INVENTORY_CONTAINER');
  return { config, directory, configSha256: sha(raw), containerId: container.Id };
}

async function qualify(filename) {
  const owned = await configuration(filename), { config, directory } = owned;
  const receiptFile = path.join(directory, 'inventory-qualification.private.json');
  // Reserve the receipt path before SQL; failure cannot overwrite older proof.
  const reservation = await fs.open(receiptFile, 'wx', 0o600);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 300000);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 5000,
    statement_timeout: 15000, query_timeout: 20000, idle_in_transaction_session_timeout: 30000, application_name: 'pf-u7-inventory-qualification' });
  const checks = [], captures = [];
  let client, lock = false, transaction = false, sourceHashes;
  const query = async (sql, args) => { controller.signal.throwIfAborted(); const value = await client.query(sql, args); controller.signal.throwIfAborted(); return value; };
  const guard = async () => {
    const response = await query("SELECT current_database() AS database,(SELECT count(*)::text FROM public.pfu7_fixture_owner) AS owners,EXISTS(SELECT 1 FROM public.pfu7_fixture_owner WHERE owner=$1 AND fixture_kind=$2) AS owned", [config.owner, KIND]);
    need(response.rows.length === 1 && response.rows[0].database === config.database && response.rows[0].owners === '1' && response.rows[0].owned === true, 'U7_INVENTORY_OWNER_MARKER');
  };
  const mutate = async (sql, args) => { await guard(); return query(sql, args); };
  const compare = async (before, after, comparison = 'exact', targetId) => compareCurrentInventories(before.directory, after.directory, {
    comparison, beforeOwnerId: config.owner, afterOwnerId: config.owner, targetId, signal: controller.signal });
  try {
    client = await pool.connect(); await guard();
    lock = (await query("SELECT pg_try_advisory_lock(hashtextextended('wfc.pf.u7-inventory-qualification.v1',0)) AS locked")).rows[0]?.locked === true;
    need(lock, 'U7_INVENTORY_BUSY');
    const paths = { operator: fileURLToPath(import.meta.url), helper: path.join(config.compiledRoot, 'server/operations/losslessInventory.js'),
      fence: path.join(config.compiledRoot, 'server/operations/service.js'), comparator: path.join(ROOT, 'scripts/pathfinder-copied-recovery/current-inventory-lib.mjs') };
    sourceHashes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, value]) => { await canonical(value, false); return [key, sha(await fs.readFile(value))]; })));
    Object.assign(process.env, { DATABASE_URL: config.databaseUrl, JWT_SECRET: config.jwtSecret, MINIO_ACCESS_KEY: config.minioAccessKey,
      MINIO_SECRET_KEY: config.minioSecretKey, MINIO_ENDPOINT: '127.0.0.1', MINIO_PORT: '1', MINIO_USE_SSL: 'false',
      PF_ROOT: config.storageRoot, PF_ENGINE_DLL: config.engineDll, PF_ENGINE_MODE: 'oneshot' });
    const { captureLosslessInventory } = await import(pathToFileURL(paths.helper).href);
    const { fenceRestored } = await import(pathToFileURL(paths.fence).href);
    const capture = async label => {
      await guard(); const destination = path.join(directory, 'inventory-qualification-' + label + '-' + randomUUID());
      const manifest = await captureLosslessInventory(pool, { allowedRoot: directory, directory: destination, ownerId: config.owner, signal: controller.signal });
      const value = { label, directory: destination, manifest }; captures.push(value); return value;
    };
    need((await query("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'pfu7_inventory_%'")).rows[0].count === '0', 'U7_INVENTORY_PROBES_EXIST');
    await mutate('BEGIN'); transaction = true;
    await mutate(`CREATE TABLE public.pfu7_inventory_precision(id bigint PRIMARY KEY,amount numeric(60,30) NOT NULL,document jsonb NOT NULL);
      CREATE TABLE public.pfu7_inventory_duplicates(label text NOT NULL,amount numeric(60,30) NOT NULL);
      CREATE TABLE public.pfu7_inventory_empty(id text PRIMARY KEY,description text)`);
    await mutate('INSERT INTO public.pfu7_inventory_precision VALUES($1::bigint,$2::numeric,$3::jsonb)', ['9007199254740993', PRECISION, '{"bigint":9007199254740993,"decimal":' + PRECISION + '}']);
    await mutate("INSERT INTO public.pfu7_inventory_duplicates VALUES('duplicate',$1::numeric),('duplicate',$1::numeric),('another',$1::numeric)", [PRECISION]);
    // Fresh deterministic synthetic principal only. No account login or token is
    // performed; expired/tombstoned rows deliberately exercise restore fencing.
    await mutate("INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,'pfu7-inventory@example.invalid','synthetic-no-login',true,'admin')", [id(1)]);
    await mutate("INSERT INTO viewer_login_bindings(login_id,user_id,created_at,expires_at,revoked_at) VALUES($1,$3,'2030-01-01T00:00:00Z','2030-01-01T00:30:00Z',NULL),($2,$3,'2030-01-01T00:00:00Z','2030-01-01T00:30:00Z','2030-01-01T00:01:00Z')", [id(2), id(3), id(1)]);
    // A genuine pre-existing synthetic import may have been created by ROOT's
    // chain operator. We never construct a verification report or Ready model.
    const ready = (await query("SELECT v.id,v.project_id,COALESCE(s.selection_revision,0) AS selection_revision FROM model_versions v JOIN model_import_jobs j ON j.id=v.owner_import_id AND j.project_id=v.project_id JOIN model_storage_ownership o ON o.import_id=j.id AND o.model_version_id=v.id AND o.published LEFT JOIN project_model_selections s ON s.project_id=v.project_id WHERE v.state='ready' AND v.health='healthy' AND j.state='complete' ORDER BY v.id LIMIT 1")).rows[0];
    if (ready) {
      await mutate(`INSERT INTO viewer_resource_sessions(id,user_id,login_id,project_id,model_version_id,load_id,selection_revision,secret_hash,created_at,expires_at,absolute_expires_at,revoked_at,revoke_reason)
        VALUES($1,$3,$4,$6,$7,$8,$9,$10,'2030-01-01T00:00:00Z','2030-01-01T00:15:00Z','2030-01-01T00:30:00Z',NULL,NULL),
        ($2,$3,$5,$6,$7,$8,$9,$10,'2030-01-01T00:00:00Z','2030-01-01T00:15:00Z','2030-01-01T00:30:00Z','2030-01-01T00:01:00Z','closed')`,
      [id(4), id(5), id(1), id(2), id(3), ready.project_id, ready.id, id(6), ready.selection_revision, sha('synthetic-inventory-resource-secret')]);
    }
    await query('COMMIT'); transaction = false;
    checks.push({ name: 'synthetic-probes', status: 'PASS', precisionType: 'SQL bigint+numeric+raw-jsonb', duplicateRows: 2, emptyTable: true });
    const baseline = await capture('baseline'), stable = await capture('stable');
    const exact = await compare(baseline, stable); need(exact.status === 'PASS', 'U7_INVENTORY_STABLE_MISMATCH');
    const regularCount = (await query("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")).rows[0].count;
    need(String(baseline.manifest.tables.length) === regularCount, 'U7_INVENTORY_TABLE_COMPLETENESS');
    const preciseTable = baseline.manifest.tables.find(table => table.table === 'pfu7_inventory_precision');
    const preciseLines = (await fs.readFile(path.join(baseline.directory, preciseTable.file.path), 'utf8')).trim().split('\n');
    need(preciseLines.length === 1, 'U7_INVENTORY_PRECISION_COUNT'); const precise = JSON.parse(preciseLines[0]);
    need(precise.key === '["9007199254740993"]' && precise.rowText.includes('9007199254740993') && precise.rowText.includes(PRECISION), 'U7_INVENTORY_PRECISION_LOST');
    need(baseline.manifest.tables.find(table => table.table === 'pfu7_inventory_duplicates')?.rows === '3'
      && baseline.manifest.tables.find(table => table.table === 'pfu7_inventory_duplicates')?.keyMode === 'row-multiset'
      && baseline.manifest.tables.find(table => table.table === 'pfu7_inventory_empty')?.rows === '0', 'U7_INVENTORY_PROBES_LOST');
    checks.push({ name: 'all-public-stable-lossless', status: 'PASS', tables: regularCount, comparison: exact });
    await mutate('UPDATE public.pfu7_inventory_precision SET amount=$1::numeric WHERE id=$2::bigint', [CHANGED_PRECISION, '9007199254740993']);
    const precisionChange = await capture('precision-change'), precisionDifference = await compare(baseline, precisionChange);
    need(precisionDifference.status === 'FAIL' && precisionDifference.failures.some(value => value.table === 'pfu7_inventory_precision' && value.code === 'ROW_CONTENT_CHANGED'), 'U7_INVENTORY_PRECISION_FALSE_PASS');
    checks.push({ name: 'precision-change-refused', status: 'PASS', observedComparison: 'FAIL', failures: precisionDifference.failures });
    await mutate('UPDATE public.pfu7_inventory_precision SET amount=$1::numeric WHERE id=$2::bigint', [PRECISION, '9007199254740993']);
    await mutate('CREATE TABLE public.pfu7_inventory_schema_added(id text PRIMARY KEY)');
    const schemaChange = await capture('schema-change'), schemaDifference = await compare(baseline, schemaChange);
    need(schemaDifference.status === 'FAIL' && schemaDifference.failures.some(value => value.table === 'pfu7_inventory_schema_added' && value.code === 'TABLE_SET_CHANGED'), 'U7_INVENTORY_SCHEMA_FALSE_PASS');
    checks.push({ name: 'extra-empty-table-refused', status: 'PASS', observedComparison: 'FAIL', failures: schemaDifference.failures });
    await mutate('DROP TABLE public.pfu7_inventory_schema_added'); // Only the just-created empty owned probe.
    const restored = await capture('baseline-restored'), restoredDifference = await compare(baseline, restored);
    need(restoredDifference.status === 'PASS', 'U7_INVENTORY_BASELINE_NOT_RESTORED'); checks.push({ name: 'synthetic-baseline-restored', status: 'PASS', comparison: restoredDifference });
    await guard(); const targetId = randomUUID();
    const fenced = await fenceRestored(pool, { WFC_OPS_QUARANTINE: 'true', WFC_OPS_TARGET_ID: targetId });
    need(fenced.status === 'PASS' && fenced.fencingDelta.installation.rotated, 'U7_INVENTORY_FENCE_NOT_ROTATED');
    const afterFence = await capture('fenced'), fencingComparison = await compare(restored, afterFence, 'restore-fence', targetId);
    need(fencingComparison.status === 'PASS', 'U7_INVENTORY_FENCE_MISMATCH');
    const loginDelta = fencingComparison.tables.find(table => table.table === 'viewer_login_bindings');
    const resourceDelta = fencingComparison.tables.find(table => table.table === 'viewer_resource_sessions');
    need(BigInt(loginDelta?.changedRows ?? '0') >= 1n, 'U7_INVENTORY_LOGIN_FENCE_UNEXERCISED');
    if (ready) need(BigInt(resourceDelta?.changedRows ?? '0') >= 1n, 'U7_INVENTORY_RESOURCE_FENCE_UNEXERCISED');
    checks.push({ name: 'production-restore-fence-delta', status: 'PASS', comparison: fencingComparison });
    checks.push({ name: 'two-auth-groups', status: ready ? 'PASS' : 'NOT_RUN', basis: ready ? 'Existing genuinely imported synthetic model; one active and one tombstoned row in each group.' : 'No genuinely imported Ready synthetic model was available. No model/report was fabricated; resource-session row transitions remain unexercised.' });
    for (const [key, value] of Object.entries(paths)) need(sha(await fs.readFile(value)) === sourceHashes[key], 'U7_INVENTORY_OPERATOR_CHANGED');
    await guard();
    const receipt = { schemaVersion: 'wfc.pf.u7-inventory-qualification.v1', status: ready ? 'PASS' : 'PARTIAL', synthetic: true,
      owner: config.owner, database: config.database, containerId: owned.containerId, configSha256: owned.configSha256, sourceHashes,
      scope: 'Actual compiled dynamic public-table catalog/cursor and comparator readback plus production restore-fence; not backup/restore, engine routing, browser, or engineering acceptance.',
      checks, captures: captures.map(value => ({ label: value.label, directory: value.directory, contentSha256: value.manifest.contentSha256, tables: value.manifest.tables.length })) };
    await reservation.writeFile(JSON.stringify(receipt, null, 2) + '\n'); await reservation.sync();
    console.log(JSON.stringify({ status: receipt.status, synthetic: true, checks: checks.map(({ name, status }) => ({ name, status })), tables: regularCount, receipt: receiptFile }));
  } catch (error) {
    if (transaction && client) await client.query('ROLLBACK').catch(() => undefined);
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'U7_INVENTORY_QUALIFICATION_FAILED';
    await reservation.writeFile(JSON.stringify({ schemaVersion: 'wfc.pf.u7-inventory-qualification.v1', status: 'FAIL', synthetic: true, owner: config.owner,
      database: config.database, code, sourceHashes, checks, captures: captures.map(value => ({ label: value.label, directory: value.directory, contentSha256: value.manifest.contentSha256 })) }, null, 2) + '\n');
    await reservation.sync(); console.log(JSON.stringify({ status: 'FAIL', code, receipt: receiptFile })); process.exitCode = 1;
  } finally {
    clearTimeout(timer); if (lock && client) await client.query("SELECT pg_advisory_unlock(hashtextextended('wfc.pf.u7-inventory-qualification.v1',0))").catch(() => undefined);
    client?.release(); await pool.end(); await reservation.close();
  }
}

if (process.argv.length !== 3) { console.log(JSON.stringify({ status: 'FAIL', code: 'U7_INVENTORY_ARGUMENTS' })); process.exitCode = 1; }
else {
  try { await qualify(path.resolve(process.argv[2])); }
  catch (error) { console.log(JSON.stringify({ status: 'FAIL', code: typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'U7_INVENTORY_START_REFUSED' })); process.exitCode = 1; }
}
