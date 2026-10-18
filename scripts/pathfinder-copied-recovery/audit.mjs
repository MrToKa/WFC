import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ROOT, contained } from '../pathfinder-local/runtime-lib.mjs';
import { assertCanonicalPath } from '../operations/archives.mjs';
import { bind, SOURCE } from './binding.mjs';
import { LIMITS, TABLE_KEYS, AUTH, BUCKETS, hash, fail, validateSnapshot, validateCaptureBinding, validateAllowedAuth, compareSnapshots, summarize } from './audit-lib.mjs';

const execute = promisify(execFile), scratch = path.join(ROOT, 'pathfinder-engine/.scratch');
const requireThat = (ok, code) => { if (!ok) fail(code); };
const relative = file => path.relative(ROOT, file).replaceAll('\\', '/');
export async function durable(file, bytes) {
  const buffer = bytes instanceof Uint8Array ? bytes : Buffer.from(typeof bytes === 'string' ? bytes : JSON.stringify(bytes, null, 2) + '\n');
  requireThat(buffer.length <= LIMITS.diffBytes, 'RECOVERY_AUDIT_OUTPUT_LIMIT');
  const handle = await fs.open(file, 'wx', 0o600); try { await handle.writeFile(buffer); await handle.sync(); } finally { await handle.close(); }
  const check = await fs.readFile(file); requireThat(check.length === buffer.length && hash(check) === hash(buffer), 'RECOVERY_AUDIT_OUTPUT_READBACK');
  return { path: relative(file), bytes: buffer.length, sha256: hash(buffer) };
}
async function privateDirectory() {
  const directory = path.join(scratch, 'copied-recovery-audit-' + randomUUID()); await assertCanonicalPath(scratch, { directory: true }); await fs.mkdir(directory, { mode: 0o700 });
  if (process.platform === 'win32') await execute('icacls', [directory, '/inheritance:r', '/grant:r', process.env.USERDOMAIN + '\\' + process.env.USERNAME + ':(OI)(CI)(F)'], { windowsHide: true, timeout: 5000, maxBuffer: 8192 });
  return directory;
}
function captureBinding(value, kind, backupId) {
  return validateCaptureBinding({ kind, runtime: relative(value.state.runtime), owner: value.state.owner, project: value.state.project, port: value.state.port, backupId: kind === 'target' ? backupId : null,
    apiId: value.api.id, apiImage: value.api.image, pgId: value.pg.id, pgImage: value.pg.image, webId: value.web.id, webImage: value.web.image, minioId: value.minio.id, minioImage: value.minio.image, pgAddress: value.pgAddress,
    startedAt: { api: value.api.startedAt, web: value.web.startedAt, postgres: value.pg.startedAt, minio: value.minio.startedAt } });
}

/** Serialized, read-only helper; no application bootstrap, lifecycle action or raw-object content read. */
export async function collectRecoverySnapshot(config, context = {}) {
  const value = { schemaVersion: 'pathfinder.copied-recovery.snapshot.v1', projection: 'lossless-postgresql-jsonb-text', status: 'FAIL', capture: config.capture, capturedAt: new Date().toISOString(), groups: {}, auth: {}, storage: {}, phase: 'initializing' }; context.partial = value;
  const safe = (ok, code) => { if (!ok) throw Object.assign(Error(code), { safeCode: code }); };
  let client, listing;
  try {
    safe(config.tables && Object.keys(config.tables).length === 27 && config.auth.length === 2 && config.buckets.length === 3 && config.capture.pgAddress && config.copiedProject.projectId, 'CONFIG');
    const { Client } = await import('pg'), { parse } = await import('pg-connection-string'); const parsed = parse(process.env.DATABASE_URL ?? '');
    safe(parsed.host === 'postgres' && parsed.port === '5432' && parsed.database === 'wfc_pathfinder_local' && parsed.user === 'pf_local' && /^[a-f0-9]{64}$/.test(parsed.password ?? ''), 'DATABASE_ENDPOINT');
    client = new Client({ host: 'postgres', port: 5432, database: 'wfc_pathfinder_local', user: 'pf_local', password: parsed.password, connectionTimeoutMillis: 5000, query_timeout: 6000, application_name: 'wfc-copied-recovery-readonly-audit', options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=8000' });
    let lost = false; client.on('error', () => { lost = true; }); await client.connect();
    const quiet = async () => (await client.query("SELECT (SELECT count(*)::text FROM pf_jobs WHERE state IN ('queued','running')) AS \"activePathfinderJobs\",(SELECT count(*)::text FROM model_import_jobs WHERE state NOT IN ('complete','failed')) AS \"activeModelImports\"")).rows[0];
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); value.phase = 'database';
    const identity = (await client.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('transaction_read_only') AS ro,transaction_timestamp()::text AS captured_at,pg_current_snapshot()::text AS snapshot")).rows[0];
    safe(identity?.database === 'wfc_pathfinder_local' && identity.address === config.capture.pgAddress && identity.port === 5432 && identity.ro === 'on', 'DATABASE_IDENTITY');
    value.identity = { database: identity.database, address: identity.address, port: identity.port, readOnly: true, capturedAt: identity.captured_at, transactionSnapshot: identity.snapshot };
    const probe = (await client.query('SELECT to_jsonb(1.00000000000000001::numeric) AS na,to_jsonb(1.00000000000000002::numeric) AS nb,to_jsonb(1.00000000000000001::numeric)::text AS nta,to_jsonb(1.00000000000000002::numeric)::text AS ntb,to_jsonb(9007199254740992::bigint) AS ia,to_jsonb(9007199254740993::bigint) AS ib,to_jsonb(9007199254740992::bigint)::text AS ita,to_jsonb(9007199254740993::bigint)::text AS itb')).rows[0];
    value.precisionControl = { numericDecodedEqual: probe.na === probe.nb, bigintDecodedEqual: probe.ia === probe.ib, numericTextA: probe.nta, numericTextB: probe.ntb, bigintTextA: probe.ita, bigintTextB: probe.itb };
    value.quiescence = { before: await quiet() }; safe(value.quiescence.before.activePathfinderJobs === '0' && value.quiescence.before.activeModelImports === '0', 'JOBS_BUSY');
    const copied = (await client.query('SELECT s.project_id AS "projectId",s.active_model_version_id AS "modelVersionId",s.selection_revision::text AS "selectionRevision",v.content_fingerprint AS fingerprint,(SELECT count(*)::text FROM cables WHERE project_id=s.project_id) AS cables,(SELECT count(*)::text FROM cable_types WHERE project_id=s.project_id) AS types,(SELECT count(*)::text FROM pf_synthetic_projects WHERE project_id=s.project_id) AS "syntheticMarkers" FROM project_model_selections s LEFT JOIN model_versions v ON v.id=s.active_model_version_id AND v.project_id=s.project_id WHERE s.project_id=$1', [config.copiedProject.projectId])).rows;
    safe(copied.length === 1, 'COPIED_PROJECT'); value.copiedProject = copied[0];
    let totalRows = 0, rowBytes = 0;
    for (const [table, keys] of Object.entries(config.tables)) {
      safe(/^[a-z_]+$/.test(table) && Array.isArray(keys) && keys.every(key => /^[a-z_]+$/.test(key)), 'TABLE_IDENTIFIER');
      const budget = (await client.query('SELECT count(*)::text AS rows,COALESCE(sum(octet_length(to_jsonb(t)::text)),0)::text AS bytes FROM (SELECT * FROM ' + table + ' LIMIT ' + (config.limits.rowsPerTable + 1) + ') t')).rows[0];
      safe(Number(budget.rows) <= config.limits.rowsPerTable && (totalRows += Number(budget.rows)) <= config.limits.totalRows && (rowBytes += Number(budget.bytes)) <= config.limits.rawBytes / 2, 'ROW_BUDGET');
      const expression = 'jsonb_build_array(' + keys.map(key => 't.' + key).join(',') + ')::text';
      value.groups[table] = (await client.query('SELECT ' + expression + ' AS key,to_jsonb(t)::text AS row_text FROM ' + table + ' t ORDER BY (' + expression + ') COLLATE "C" LIMIT ' + (config.limits.rowsPerTable + 1))).rows;
      safe(value.groups[table].length === Number(budget.rows) && value.groups[table].every(row => Buffer.byteLength(row.row_text) <= config.limits.rowBytes), 'ROW_COUNT_OR_SIZE');
    }
    for (const table of config.auth) {
      safe(['viewer_login_bindings', 'viewer_resource_sessions'].includes(table), 'AUTH_IDENTIFIER'); const resource = table === 'viewer_resource_sessions';
      const budget = (await client.query('SELECT count(*)::text AS rows,COALESCE(sum(octet_length(to_jsonb(t)::text)),0)::text AS bytes FROM (SELECT * FROM ' + table + ' LIMIT ' + (config.limits.rowsPerTable + 1) + ') t')).rows[0];
      safe(Number(budget.rows) <= config.limits.rowsPerTable && (totalRows += Number(budget.rows)) <= config.limits.totalRows && (rowBytes += Number(budget.bytes) * 2) <= config.limits.rawBytes / 2, 'AUTH_BUDGET');
      value.auth[table] = (await client.query('SELECT ' + (resource ? 'id' : 'login_id') + '::text AS key,to_jsonb(t)::text AS row_text,(to_jsonb(t)-\'revoked_at\'' + (resource ? '-\'revoke_reason\'' : '') + ')::text AS immutable_text,to_jsonb(t)->>\'revoked_at\' AS revoked_at,' + (resource ? 'revoke_reason' : 'NULL::text') + ' AS revoke_reason FROM ' + table + ' t ORDER BY (' + (resource ? 'id' : 'login_id') + '::text) COLLATE "C" LIMIT ' + (config.limits.rowsPerTable + 1))).rows;
      safe(value.auth[table].length === Number(budget.rows), 'AUTH_COUNT');
    }
    safe(!lost, 'DATABASE_CONNECTION'); await client.query('COMMIT'); value.phase = 'storage';
    safe(process.env.MINIO_ENDPOINT === 'minio' && process.env.WFC_MODEL_BUCKET === 'pf-local-models' && process.env.MINIO_BUCKET_PROJECTS === 'pf-local-project-files' && process.env.MINIO_BUCKET_TEMPLATES === 'pf-local-template-files', 'STORAGE_ENDPOINT');
    const { Client: Minio } = await import('minio'); const storage = new Minio({ endPoint: 'minio', port: 9000, useSSL: false, accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY, retryOptions: { disableRetry: true } });
    let totalObjects = 0, storageBytes = 0; // All storage work shares the outer fixed helper watchdog.
    for (const bucket of config.buckets) {
      safe(['pf-local-models', 'pf-local-project-files', 'pf-local-template-files'].includes(bucket), 'BUCKET_IDENTIFIER'); const rows = []; value.storage[bucket] = rows; listing = storage.listObjectsV2(bucket, '', true);
      for await (const object of listing) {
        safe(rows.length < config.limits.objectsPerBucket && ++totalObjects <= config.limits.totalObjects, 'STORAGE_ROW_BUDGET');
        const stat = await storage.statObject(bucket, object.name), metadata = Object.fromEntries(Object.entries(stat.metaData ?? {}).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(([key, v]) => { safe(typeof v === 'string' && key.length <= 512 && v.length <= 4096, 'STORAGE_METADATA'); return [key, v]; }));
        const row = { key: object.name, size: String(stat.size), etag: stat.etag, lastModified: stat.lastModified?.toISOString() ?? null, metadata };
        safe(Buffer.byteLength(JSON.stringify(metadata)) <= 16384 && (storageBytes += Buffer.byteLength(JSON.stringify(row))) <= config.limits.rawBytes / 4 && object.size === stat.size && object.etag === stat.etag, 'STORAGE_INVENTORY_CHANGED_OR_BUDGET'); rows.push(row);
      }
      listing = undefined; rows.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
    }
    value.quiescence.after = await quiet(); safe(value.quiescence.after.activePathfinderJobs === '0' && value.quiescence.after.activeModelImports === '0' && !lost, 'JOBS_BUSY_AFTER');
    value.phase = 'complete'; value.status = 'PASS'; value.finishedAt = new Date().toISOString(); safe(Buffer.byteLength(JSON.stringify(value)) <= config.limits.rawBytes, 'OUTPUT_BUDGET');
  } catch (error) { value.status = 'FAIL'; value.error = /^[A-Z_]+$/.test(error?.safeCode ?? '') ? 'RECOVERY_HELPER_' + error.safeCode : 'RECOVERY_HELPER_FAILED'; }
  finally { try { listing?.destroy(); } catch { /* Preserve the original bounded helper result. */ } if (client) await client.end().catch(() => {}); }
  return value;
}
export function helperProgram({ milliseconds = LIMITS.helperMilliseconds } = {}) {
  requireThat(Number.isInteger(milliseconds) && milliseconds > 0 && milliseconds <= LIMITS.helperMilliseconds, 'RECOVERY_AUDIT_HELPER_TIME');
  return `const context={};let emitted=false;const emit=value=>{if(!emitted){emitted=true;process.stdout.write(JSON.stringify(value));}};const watchdog=setTimeout(()=>{try{emit({...context.partial,status:'FAIL',error:'RECOVERY_HELPER_DEADLINE'});}finally{process.exit(2);}},${milliseconds});try{let raw='';for await(const part of process.stdin){raw+=part;if(raw.length>65536)throw Error('INPUT_LIMIT');}const value=await(${collectRecoverySnapshot.toString()})(JSON.parse(raw),context);await new Promise((resolve,reject)=>{emitted=true;process.stdout.write(JSON.stringify(value),error=>error?reject(error):resolve());});if(value.status!=='PASS')process.exitCode=1;}catch{emit({...context.partial,status:'FAIL',error:'RECOVERY_HELPER_FAILED'});process.exitCode=1;}finally{clearTimeout(watchdog);}`;
}
async function capture(bound, binding, signal) {
  const config = { capture: binding, copiedProject: { projectId: SOURCE.projectId }, tables: TABLE_KEYS, auth: AUTH, buckets: BUCKETS, limits: LIMITS };
  const child = execFile('docker', ['exec', '-i', bound.api.id, 'node', '--input-type=module', '-e', helperProgram()], { windowsHide: true, timeout: LIMITS.hostMilliseconds, maxBuffer: LIMITS.rawBytes, encoding: 'buffer', signal });
  child.stdin.end(JSON.stringify(config)); const chunks = []; let bytes = 0, stderrBytes = 0;
  child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes <= LIMITS.rawBytes) chunks.push(chunk); else child.kill(); }); child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
  const result = await new Promise(resolve => { let failed = false; child.once('error', () => { failed = true; }); child.once('close', (code, term) => resolve({ exitCode: failed ? 'PROCESS_ERROR' : code ?? 'SIGNAL', signal: term })); });
  return { raw: Buffer.concat(chunks), transport: { ...result, stdoutBytes: bytes, stderrBytes, outputLimited: bytes > LIMITS.rawBytes } };
}
async function readPinned(file, expectedHash, maximum) {
  await assertCanonicalPath(file); const stat = await fs.lstat(file); requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size > 0 && stat.size <= maximum, 'RECOVERY_AUDIT_BASELINE_FILE');
  const bytes = await fs.readFile(file); requireThat(bytes.length === stat.size && hash(bytes) === expectedHash, 'RECOVERY_AUDIT_BASELINE_HASH'); return bytes;
}
export async function main(argv = process.argv.slice(2)) {
  const receipt = { schemaVersion: 'pathfinder.copied-recovery.audit.v1', status: 'FAIL', startedAt: new Date().toISOString(), projection: 'lossless-postgresql-jsonb-text', storageProof: 'object-key-size-etag-lastModified-user-metadata-only', atomicStorageDatabaseSnapshot: false, rawModelArtifactShaProof: 'NOT_PERFORMED_BY_THIS_TOOL', engineeringAccepted: false };
  let directory; const interrupt = new AbortController(), timer = setTimeout(() => interrupt.abort(), LIMITS.totalMilliseconds), abort = () => interrupt.abort(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    receipt.sourceFiles = await Promise.all(['audit.mjs', 'audit-lib.mjs', 'binding.mjs'].map(async name => ({ path: 'scripts/pathfinder-copied-recovery/' + name, sha256: hash(await fs.readFile(new URL(name, import.meta.url))) })));
    const { values } = parseArgs({ args: argv, strict: true, options: Object.fromEntries(['runtime', 'kind', 'owner', 'backup-id', 'phase', 'baseline', 'baseline-sha256', 'comparison', 'allowed-auth-file', 'allowed-auth-sha256'].map(name => [name, { type: 'string' }])) });
    requireThat(values.runtime && values.owner && ['source', 'target'].includes(values.kind) && /^[a-z0-9-]{1,48}$/.test(values.phase ?? ''), 'RECOVERY_AUDIT_ARGUMENT');
    const comparison = values.comparison ?? 'exact'; requireThat(['exact', 'restore-fence', 'owned-auth', 'business-only'].includes(comparison) && (values.baseline ? /^[a-f0-9]{64}$/.test(values['baseline-sha256'] ?? '') : !values.comparison), 'RECOVERY_AUDIT_BASELINE_ARGUMENT');
    receipt.operation = values.baseline ? 'capture_and_compare' : 'capture_only';
    directory = await privateDirectory(); const options = { runtime: values.runtime, owner: values.owner, kind: values.kind, backupId: values['backup-id'], signal: interrupt.signal };
    const before = await bind(options), identity = captureBinding(before, values.kind, values['backup-id']); receipt.target = identity; receipt.phase = values.phase;
    await durable(path.join(directory, 'owner.private.json'), { schemaVersion: 'pathfinder.copied-recovery.audit-owner.v1', directory: relative(directory), target: identity, phase: values.phase });
    const result = await capture(before, identity, interrupt.signal); receipt.transport = result.transport;
    receipt.raw = await durable(path.join(directory, 'snapshot.private.json'), result.raw); // Retain all returned bytes before status/schema assertions.
    requireThat(result.transport.exitCode === 0 && !result.transport.outputLimited, 'RECOVERY_AUDIT_CAPTURE_PROCESS');
    const snapshot = JSON.parse(result.raw.toString('utf8')); validateSnapshot(snapshot); receipt.summary = summarize(snapshot);
    if (values.baseline) {
      const file = path.resolve(values.baseline); requireThat(contained(path.join(ROOT, 'docs/pathfinder/evidence/copied-recovery'), file), 'RECOVERY_AUDIT_BASELINE_PATH');
      const oldReceiptBytes = await readPinned(file, values['baseline-sha256'], LIMITS.manifestBytes), oldReceipt = JSON.parse(oldReceiptBytes.toString());
      requireThat(oldReceipt.schemaVersion === receipt.schemaVersion && oldReceipt.status === 'PASS' && oldReceipt.raw && oldReceipt.target, 'RECOVERY_AUDIT_BASELINE_STATUS');
      const oldPath = path.resolve(ROOT, oldReceipt.raw.path); requireThat(contained(scratch, oldPath) && /^copied-recovery-audit-[a-f0-9-]{36}$/.test(path.basename(path.dirname(oldPath))) && path.basename(oldPath) === 'snapshot.private.json', 'RECOVERY_AUDIT_RAW_PATH');
      const oldRaw = await readPinned(oldPath, oldReceipt.raw.sha256, LIMITS.rawBytes); requireThat(oldRaw.length === oldReceipt.raw.bytes, 'RECOVERY_AUDIT_RAW_BYTES');
      const previous = JSON.parse(oldRaw.toString()); requireThat(hash(previous.capture) === hash(oldReceipt.target), 'RECOVERY_AUDIT_BASELINE_BINDING');
      let allowedAuth;
      if (comparison === 'owned-auth') {
        const allowedPath = path.resolve(values['allowed-auth-file'] ?? ''); requireThat(values['allowed-auth-file'] && /^[a-f0-9]{64}$/.test(values['allowed-auth-sha256'] ?? '') && contained(scratch, allowedPath) && path.basename(allowedPath) === 'allowed-auth.private.json', 'RECOVERY_AUTH_METADATA_PATH');
        const allowedBytes = await readPinned(allowedPath, values['allowed-auth-sha256'], 16384); allowedAuth = validateAllowedAuth(JSON.parse(allowedBytes.toString()), identity); receipt.allowedAuth = { path: relative(allowedPath), bytes: allowedBytes.length, sha256: hash(allowedBytes) };
      } else requireThat(!values['allowed-auth-file'] && !values['allowed-auth-sha256'], 'RECOVERY_AUTH_METADATA_UNUSED');
      receipt.baseline = { path: relative(file), sha256: hash(oldReceiptBytes), raw: oldReceipt.raw };
      receipt.comparisonInput = await durable(path.join(directory, 'comparison-input.private.json'), { baseline: receipt.baseline, current: receipt.raw, comparison, allowedAuth: receipt.allowedAuth ?? null });
      const difference = compareSnapshots(previous, snapshot, { comparison, allowedAuth });
      receipt.difference = await durable(path.join(directory, 'difference.private.json'), difference); // Preserve full raw differences before a FAIL assertion.
      receipt.summary = summarize(snapshot, difference);
      requireThat(difference.status === 'PASS', 'RECOVERY_AUDIT_COMPARISON_FAILED');
    }
    const after = await bind(options), last = captureBinding(after, values.kind, values['backup-id']); requireThat(hash(last) === hash(identity), 'RECOVERY_AUDIT_TARGET_CHANGED');
    receipt.status = 'PASS';
  } catch (error) { receipt.error = /^RECOVERY_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'RECOVERY_AUDIT_FAILED'; }
  finally { clearTimeout(timer); process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
  receipt.finishedAt = new Date().toISOString(); receipt.finalSourceFiles = await Promise.all(['audit.mjs', 'audit-lib.mjs', 'binding.mjs'].map(async name => ({ path: 'scripts/pathfinder-copied-recovery/' + name, sha256: hash(await fs.readFile(new URL(name, import.meta.url))) })));
  if (receipt.sourceFiles && hash(receipt.sourceFiles) !== hash(receipt.finalSourceFiles)) { receipt.status = 'FAIL'; receipt.error = 'RECOVERY_AUDIT_SOURCE_CHANGED'; }
  if (directory) receipt.privateDirectory = relative(directory);
  const output = path.join(ROOT, 'docs/pathfinder/evidence/copied-recovery/audit-' + Date.now() + '-' + randomUUID().slice(0, 8) + '.json'); await fs.mkdir(path.dirname(output), { recursive: true }); const saved = await durable(output, receipt);
  console.log(JSON.stringify({ status: receipt.status, file: saved.path, sha256: saved.sha256, phase: receipt.phase ?? null, error: receipt.error ?? null })); return receipt.status === 'PASS' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
