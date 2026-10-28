import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ROOT, load, readSettings, contained } from '../pathfinder-local/runtime-lib.mjs';
import { assertCanonicalPath, hashFile } from '../operations/archives.mjs';
import { verifyPackage } from '../../server/vendor/routings-model-package/index.mjs';
import { validateSeedTarget } from './seed-lib.mjs';
import { IMPORT_LIMITS, IMPORT_PINS, digest, refuse, validateImportInputs, assertTargetBinding, executeNormalImport } from './import-lib.mjs';

const execute = promisify(execFile), scratch = path.join(ROOT, 'pathfinder-engine/.scratch');
const sourcePath = 'pathfinder-engine/.scratch/current-inputs-2b20a8ae-a435-4d4d-aec4-005bb021a715/current-inputs.private.json';
const sourceReceiptPath = 'docs/pathfinder/evidence/current-inputs/source-copy-fullname-20261018T1533Z.json';
const archivePath = 'pathfinder-engine/.scratch/pathfinder-local/aalborg-portable.zip';
const requireThat = (ok, code) => { if (!ok) refuse(code); };
const relative = value => path.relative(ROOT, value).replaceAll('\\', '/');
async function fileBytes(file, limit = IMPORT_LIMITS.jsonBytes) {
  await assertCanonicalPath(file); const st = await fs.lstat(file);
  requireThat(st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.size > 0 && st.size <= limit, 'IMPORT_FILE_BOUND');
  const bytes = await fs.readFile(file); requireThat(bytes.length === st.size, 'IMPORT_FILE_CHANGED'); return bytes;
}
async function writeDurable(file, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); requireThat(bytes.length <= IMPORT_LIMITS.jsonBytes, 'IMPORT_PRIVATE_OUTPUT_LIMIT');
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  const readback = await fileBytes(file); requireThat(digest(readback) === digest(bytes), 'IMPORT_PRIVATE_READBACK');
  return { path: relative(file), bytes: bytes.length, sha256: digest(bytes) };
}
async function dockerJson(args, signal, input) {
  const child = execFile('docker', args, { windowsHide: true, timeout: IMPORT_LIMITS.processMilliseconds, maxBuffer: IMPORT_LIMITS.responseBytes, signal });
  if (input !== undefined) child.stdin.end(JSON.stringify(input));
  else child.stdin.end();
  const raw = await new Promise((resolve, reject) => { let stdout = '', count = 0; child.stdout.on('data', bytes => { count += Buffer.byteLength(bytes); if (count > IMPORT_LIMITS.responseBytes) child.kill(); else stdout += bytes; }); child.once('error', () => reject(Object.assign(Error('IMPORT_DOCKER_FAILED'), { code: 'IMPORT_DOCKER_FAILED' }))); child.once('close', code => code === 0 && count <= IMPORT_LIMITS.responseBytes ? resolve(stdout) : reject(Object.assign(Error('IMPORT_DOCKER_FAILED'), { code: 'IMPORT_DOCKER_FAILED', raw: stdout }))); });
  try { return JSON.parse(raw); } catch { refuse('IMPORT_DOCKER_JSON'); }
}
async function targetBinding(state, signal) {
  const roles = ['api', 'postgres', 'web', 'minio', 'storage-ready'];
  const inspected = await dockerJson(['inspect', ...roles.map(role => state.project + '-' + role + '-1')], signal);
  requireThat(Array.isArray(inspected) && inspected.length === roles.length, 'IMPORT_CONTAINER_COUNT');
  const rows = inspected.map(c => ({ id: c.Id, name: c.Name, image: c.Image, startedAt: c.State?.StartedAt, running: c.State?.Running, labels: c.Config?.Labels, networks: c.NetworkSettings?.Networks, ports: c.HostConfig?.PortBindings, mounts: c.Mounts }));
  const networkRaw = await dockerJson(['network', 'inspect', state.project + '_backend'], signal);
  requireThat(Array.isArray(networkRaw) && networkRaw.length === 1, 'IMPORT_NETWORK_COUNT'); const raw = networkRaw[0];
  const network = { id: raw.Id, name: raw.Name, labels: raw.Labels, internal: raw.Internal, containers: Object.keys(raw.Containers ?? {}) };
  const bound = validateSeedTarget(state, rows.filter(row => ['api', 'postgres', 'web'].some(role => row.name === '/' + state.project + '-' + role + '-1')), network);
  for (const row of rows) requireThat(roles.some(role => row.name === '/' + state.project + '-' + role + '-1' && row.labels?.['com.docker.compose.service'] === role) && row.labels?.['wfc.pathfinder.owner'] === state.owner && row.labels?.['wfc.pathfinder.project'] === state.project && row.labels?.['wfc.pathfinder.isolated'] === 'true' && row.labels?.['com.docker.compose.project'] === state.project, 'IMPORT_CONTAINER_OWNERSHIP');
  requireThat(network.containers.every(id => rows.some(row => row.id === id)), 'IMPORT_FOREIGN_NETWORK_MEMBER');
  const minio = rows.find(row => row.name.endsWith('-minio-1'));
  requireThat(minio?.running === true && Object.keys(minio.networks).join() === state.project + '_backend' && minio.networks[state.project + '_backend'].NetworkID === network.id && Object.values(minio.ports ?? {}).flat().length === 0 && minio.mounts.length === 1 && minio.mounts[0].Type === 'volume' && minio.mounts[0].Name === state.project + '_minio' && minio.mounts[0].Destination === '/data' && minio.mounts[0].RW === true, 'IMPORT_STORAGE_TARGET');
  const env = Object.fromEntries(inspected.find(c => c.Id === bound.apiId).Config.Env.map(value => { const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)]; })), settings = await readSettings(state);
  requireThat(env.DATABASE_URL === 'postgresql://pf_local:' + settings.databasePassword + '@postgres:5432/wfc_pathfinder_local' && env.MINIO_ENDPOINT === 'minio' && env.MINIO_SECRET_KEY === settings.storagePassword && env.WFC_MODEL_BUCKET === 'pf-local-models', 'IMPORT_ENDPOINT_CHANGED');
  return { ...bound, runtime: relative(state.runtime), minioId: minio.id, minioImage: minio.image, minioStartedAt: minio.startedAt };
}

/** Serialized into the owned API container. Only pg/pg-connection-string are imported; every SQL transaction is read-only. */
export async function registryProjection(config) {
  const { Client } = await import('pg'), { parse } = await import('pg-connection-string');
  const parsed = parse(process.env.DATABASE_URL ?? ''), safe = (ok, code) => { if (!ok) throw Error(code); };
  safe(parsed.host === 'postgres' && parsed.port === '5432' && parsed.database === 'wfc_pathfinder_local' && parsed.user === 'pf_local' && /^[a-f0-9]{64}$/.test(parsed.password ?? ''), 'ENDPOINT');
  safe(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.projectId) && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.idempotencyKey), 'INPUT');
  const client = new Client({ host: 'postgres', port: 5432, database: 'wfc_pathfinder_local', user: 'pf_local', password: parsed.password, connectionTimeoutMillis: 5000, query_timeout: 6000, application_name: 'wfc-copied-model-import-observer', options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c idle_in_transaction_session_timeout=8000' });
  let transportFailed = false; client.on('error', () => { transportFailed = true; });
  try {
    await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const observed = (await client.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('transaction_read_only') AS ro")).rows[0];
    safe(observed?.database === 'wfc_pathfinder_local' && observed.address === config.serverAddress && observed.port === 5432 && observed.ro === 'on', 'DATABASE');
    const projectId = config.projectId;
    const one = async sql => { const rows = (await client.query(sql, [projectId])).rows; safe(rows.length <= 1, 'ONE_ROW'); return rows[0] ?? null; };
    const many = async sql => { const rows = (await client.query(sql, [projectId])).rows; safe(rows.length < 5, 'ROW_BUDGET'); return rows; };
    const project = await one('SELECT id,project_number AS "projectNumber",name,description,secondary_tray_length::text AS "secondaryTrayLength",end_connection_length::text AS "endConnectionLength",additional_bending_percent::text AS "additionalBendingPercent",connection_gap::text AS "connectionGap" FROM projects WHERE id=$1');
    const countsRaw = await one('SELECT (SELECT count(*)::text FROM cable_types WHERE project_id=$1) AS types,(SELECT count(*)::text FROM cables WHERE project_id=$1) AS cables,(SELECT count(*)::text FROM pf_synthetic_projects WHERE project_id=$1) AS synthetic');
    const selection = await one('SELECT project_id AS "projectId",active_model_version_id AS "activeModelVersionId",selection_revision::text AS "selectionRevision" FROM project_model_selections WHERE project_id=$1');
    const jobs = await many('SELECT id,project_id AS "projectId",requested_by AS "requestedBy",idempotency_key AS "idempotencyKey",archive_sha256 AS "archiveSha256",expected_bytes::text AS "expectedBytes",received_bytes::text AS "receivedBytes",state,model_version_id AS "modelVersionId",duplicate,failure->>\'code\' AS "failureCode" FROM model_import_jobs WHERE project_id=$1 ORDER BY created_at,id LIMIT 5');
    const versions = await many('SELECT id,project_id AS "projectId",package_id AS "packageId",content_fingerprint AS "contentFingerprint",source,imported_by AS "importedBy",state,health,support_profile AS "supportProfile",sdk_version AS "sdkVersion",entrypoint,resource_count AS "resourceCount",total_bytes::text AS "totalBytes",storage_prefix AS "storagePrefix",owner_import_id AS "ownerImportId",validation_report_id AS "validationReportId",manifest->\'resources\' AS resources FROM model_versions WHERE project_id=$1 ORDER BY id LIMIT 5');
    const ownership = await many('SELECT import_id AS "importId",project_id AS "projectId",model_version_id AS "modelVersionId",storage_prefix AS "storagePrefix",published,cleaned_at AS "cleanedAt" FROM model_storage_ownership WHERE project_id=$1 ORDER BY import_id LIMIT 5');
    const reservations = await many('SELECT project_id AS "projectId",import_id AS "importId",model_version_id AS "modelVersionId" FROM model_content_reservations WHERE project_id=$1 ORDER BY import_id LIMIT 5');
    const aliases = await many('SELECT project_id AS "projectId",package_id AS "packageId",model_version_id AS "modelVersionId" FROM model_package_aliases WHERE project_id=$1 ORDER BY package_id LIMIT 5');
    const validations = await many('SELECT r.id,r.report,r.report->>\'status\' AS status,r.report->>\'contentFingerprint\' AS "contentFingerprint",r.report->\'package\'->>\'sha256\' AS "archiveSha256",r.report->\'package\'->>\'bytes\' AS "archiveBytes",(r.report->>\'resourceCount\')::int AS "resourceCount",r.report->>\'totalRawBytes\' AS "totalRawBytes",r.storage_readback AS "storageReadback" FROM model_validation_reports r JOIN model_versions v ON v.validation_report_id=r.id WHERE v.project_id=$1 ORDER BY r.id LIMIT 5');
    safe(!transportFailed, 'CONNECTION'); await client.query('COMMIT');
    const result = { identity: { database: observed.database, address: observed.address, port: observed.port, readOnly: true }, expectedServerAddress: config.serverAddress, project, counts: { types: Number(countsRaw?.types), cables: Number(countsRaw?.cables), syntheticMarkers: Number(countsRaw?.synthetic) }, selection, jobs, versions, ownership, reservations, aliases, validations };
    safe(Buffer.byteLength(JSON.stringify(result)) <= 2 * 1024 ** 2, 'OUTPUT_BUDGET'); return result;
  } finally { await client.end().catch(() => {}); }
}

export function projectionProgram({ watchdogMilliseconds = 30000 } = {}) {
  requireThat(Number.isInteger(watchdogMilliseconds) && watchdogMilliseconds > 0 && watchdogMilliseconds <= 30000, 'IMPORT_HELPER_DEADLINE');
  return `const watchdog=setTimeout(()=>process.exit(2),${watchdogMilliseconds});try{let input='';for await(const part of process.stdin){input+=part;if(input.length>65536)process.exit(2);}const result=await(${registryProjection.toString()})(JSON.parse(input));await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(result),error=>error?reject(error):resolve()));}catch{process.stdout.write(JSON.stringify({error:'IMPORT_PROJECTION_FAILED'}));process.exitCode=1;}finally{clearTimeout(watchdog);}`;
}

export async function journalAt(directory, intent, marker, { create = false, acquireLock = async () => {} } = {}) {
  if (create) {
    await fs.mkdir(directory, { mode: 0o700 });
    if (process.platform === 'win32') await execute('icacls', [directory, '/inheritance:r', '/grant:r', process.env.USERDOMAIN + '\\' + process.env.USERNAME + ':(OI)(CI)(F)'], { windowsHide: true, timeout: 5000, maxBuffer: 8192 });
    await writeDurable(path.join(directory, 'owner.private.json'), marker); await writeDurable(path.join(directory, 'intent.private.json'), intent);
  }
  await assertCanonicalPath(directory, { directory: true });
  const savedMarker = JSON.parse((await fileBytes(path.join(directory, 'owner.private.json'))).toString());
  const savedIntentBytes = await fileBytes(path.join(directory, 'intent.private.json')), savedIntent = JSON.parse(savedIntentBytes.toString());
  requireThat(digest(savedMarker) === digest(marker) && savedIntent.schemaVersion === intent.schemaVersion && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(savedIntent.idempotencyKey ?? '') && savedIntent.planSha256 === intent.planSha256 && savedIntent.receiptSha256 === intent.receiptSha256 && savedIntent.projectId === intent.projectId && savedIntent.actorId === intent.actorId && savedIntent.archiveSha256 === intent.archiveSha256 && savedIntent.contextSha256 === intent.contextSha256, 'IMPORT_JOURNAL_OWNER');
  await acquireLock(); // Serialize before reading history; another completed run may have appended an uncertain upload.
  const names = (await fs.readdir(directory)).filter(name => /^event-\d{4}\.private\.json$/.test(name)).sort(); requireThat(names.length <= IMPORT_LIMITS.journalEvents, 'IMPORT_JOURNAL_LIMIT');
  let previousSha256 = digest(savedIntentBytes), totalBytes = savedIntentBytes.length; const history = [], records = [];
  for (let index = 0; index < names.length; index++) { const file = path.join(directory, names[index]), bytes = await fileBytes(file), event = JSON.parse(bytes.toString()); requireThat(names[index] === 'event-' + String(index).padStart(4, '0') + '.private.json' && event.sequence === index && event.previousSha256 === previousSha256 && event.schemaVersion === 'pathfinder.copied-project.import-event.v1', 'IMPORT_JOURNAL_CHAIN'); previousSha256 = digest(bytes); totalBytes += bytes.length; history.push(event); records.push({ path: relative(file), bytes: bytes.length, sha256: previousSha256 }); }
  requireThat(totalBytes <= IMPORT_LIMITS.journalBytes, 'IMPORT_JOURNAL_LIMIT');
  const append = async (type, value) => { requireThat(records.length < IMPORT_LIMITS.journalEvents, 'IMPORT_JOURNAL_LIMIT'); const event = { schemaVersion: 'pathfinder.copied-project.import-event.v1', sequence: records.length, previousSha256, type, recordedAt: new Date().toISOString(), value }; requireThat(totalBytes + Buffer.byteLength(JSON.stringify(event, null, 2) + '\n') <= IMPORT_LIMITS.journalBytes, 'IMPORT_JOURNAL_LIMIT'); const record = await writeDurable(path.join(directory, 'event-' + String(records.length).padStart(4, '0') + '.private.json'), event); records.push(record); history.push(event); totalBytes += record.bytes; previousSha256 = record.sha256; };
  return { intent: savedIntent, history, append, summary: () => ({ directory: relative(directory), intent: { path: relative(path.join(directory, 'intent.private.json')), bytes: savedIntentBytes.length, sha256: digest(savedIntentBytes) }, events: records.length, bytes: totalBytes, finalSha256: previousSha256, recordsSha256: digest(records) }) };
}

export async function readHttp(baseUrl, route, { method = 'GET', token, body, milliseconds = IMPORT_LIMITS.requestMilliseconds, signal, stream, headers = {}, journal, operation, privateLogin = false } = {}) {
  let reader;
  try {
    const response = await fetch(new URL(route, baseUrl), { method, redirect: 'error', credentials: 'omit', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(stream ? { body: stream, duplex: 'half' } : body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([signal, AbortSignal.timeout(milliseconds)].filter(Boolean)) });
    reader = response.body?.getReader(); const chunks = []; let bytes = 0;
    if (reader) for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > IMPORT_LIMITS.responseBytes) refuse('IMPORT_HTTP_LIMIT'); chunks.push(part.value); }
    const raw = Buffer.concat(chunks).toString('utf8'); if (!privateLogin) await journal.append('http_raw_' + operation, { status: response.status, raw });
    let value; try { value = JSON.parse(raw); } catch { refuse('IMPORT_HTTP_JSON'); } return { status: response.status, value };
  } finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } stream?.destroy(); }
}

export async function main(argv = process.argv.slice(2)) {
  const publicReceipt = { schemaVersion: 'pathfinder.copied-project.import-receipt.v1', status: 'FAIL', startedAt: new Date().toISOString(), engineeringAccepted: false, syntheticMarker: false };
  let journal, workRoot, runLock, lockBytes; const outer = new AbortController(), deadline = setTimeout(() => outer.abort(), IMPORT_LIMITS.totalMilliseconds);
  const interrupted = () => outer.abort(); process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  try {
    const { values } = parseArgs({ args: argv, strict: true, options: Object.fromEntries(['runtime', 'owner', 'plan', 'plan-sha256', 'seed-receipt', 'seed-receipt-sha256', 'admin-id', 'work-root'].map(name => [name, { type: 'string' }]).concat([['inspect-only', { type: 'boolean', default: false }]])) });
    requireThat(['runtime', 'owner', 'plan', 'plan-sha256', 'seed-receipt', 'seed-receipt-sha256', 'admin-id', 'work-root'].every(name => typeof values[name] === 'string'), 'IMPORT_OPTIONS_REQUIRED');
    const state = await load(values.runtime); requireThat(state.owner === values.owner && state.owner === IMPORT_PINS.owner && state.project === IMPORT_PINS.project && state.port === 5191, 'IMPORT_TARGET_REFUSED');
    const planPath = path.resolve(values.plan), receiptPath = path.resolve(values['seed-receipt']); workRoot = path.resolve(values['work-root']);
    requireThat(contained(scratch, planPath) && contained(path.join(ROOT, 'docs/pathfinder/evidence/copied-project'), receiptPath) && contained(scratch, workRoot) && path.dirname(workRoot) === scratch && /^copied-import-[a-f0-9-]{36}$/.test(path.basename(workRoot)), 'IMPORT_PATH_REFUSED');
    await assertCanonicalPath(path.dirname(workRoot), { directory: true });
    const planBytes = await fileBytes(planPath), receiptBytes = await fileBytes(receiptPath), sourceBytes = await fileBytes(path.join(ROOT, sourcePath)), sourceReceiptBytes = await fileBytes(path.join(ROOT, sourceReceiptPath));
    const packageFile = path.join(ROOT, archivePath); await assertCanonicalPath(packageFile); const beforeArchive = await hashFile(packageFile); requireThat(beforeArchive.bytes === IMPORT_PINS.archiveBytes && beforeArchive.sha256 === IMPORT_PINS.archiveSha256, 'IMPORT_ARCHIVE_PIN');
    const archiveReport = await verifyPackage(packageFile, { signal: outer.signal });
    const context = validateImportInputs({ planBytes, planSha256: values['plan-sha256'], receiptBytes, receiptSha256: values['seed-receipt-sha256'], sourceBytes, sourceReceiptBytes, archiveReport, actorId: values['admin-id'] });
    requireThat(JSON.parse(receiptBytes.toString()).plan.path === relative(planPath) && relative(state.runtime) === context.target.runtime, 'IMPORT_PLAN_PATH_LINK');
    const binding = assertTargetBinding(context, await targetBinding(state, outer.signal));
    const marker = { schemaVersion: 'pathfinder.copied-project.import-owner.v1', owner: state.owner, targetProject: state.project, projectId: context.project.id, planSha256: context.planSha256, workRoot: relative(workRoot) };
    const intent = { schemaVersion: 'pathfinder.copied-project.import-intent.v1', idempotencyKey: randomUUID(), createdAt: new Date().toISOString(), projectId: context.project.id, actorId: context.actorId, planSha256: context.planSha256, receiptSha256: context.receiptSha256, archiveSha256: context.archive.sha256, contextSha256: digest(context), target: binding };
    let exists = true; try { await fs.lstat(workRoot); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
    journal = await journalAt(workRoot, intent, marker, { create: !exists, acquireLock: async () => { lockBytes = JSON.stringify({ owner: state.owner, projectId: context.project.id, pid: process.pid, runId: randomUUID() }); runLock = path.join(workRoot, 'run.lock'); const lock = await fs.open(runLock, 'wx', 0o600); try { await lock.writeFile(lockBytes); await lock.sync(); } finally { await lock.close(); } } }); assertTargetBinding(context, binding, journal.intent.target);
    await journal.append('invocation_started', { inspectOnly: values['inspect-only'], archive: beforeArchive, target: binding });
    publicReceipt.projectId = context.project.id; publicReceipt.target = binding; publicReceipt.plan = { path: relative(planPath), bytes: planBytes.length, sha256: context.planSha256 }; publicReceipt.seedReceipt = { path: relative(receiptPath), sha256: context.receiptSha256 }; publicReceipt.idempotencyKeySha256 = digest(journal.intent.idempotencyKey);
    if (values['inspect-only']) { publicReceipt.status = 'PASS'; publicReceipt.operation = 'preflight_only_no_http_or_sql'; }
    else {
      const guard = async () => { const current = await targetBinding(state, outer.signal); assertTargetBinding(context, current, journal.intent.target); return current; };
      const observe = async ({ projectId, idempotencyKey }) => {
        const target = await guard(), config = { projectId, idempotencyKey, serverAddress: target.serverAddress };
        const program = projectionProgram();
        try { return await dockerJson(['exec', '-i', target.apiId, 'node', '--input-type=module', '-e', program], outer.signal, config); }
        catch (error) { await journal.append('projection_process_failure', { code: 'IMPORT_PROJECTION_FAILED', raw: typeof error.raw === 'string' ? error.raw : null }); throw error; }
      };
      const baseUrl = 'http://127.0.0.1:5191', projectRoute = '/api/projects/' + context.project.id;
      const http = (route, options) => readHttp(baseUrl, route, { ...options, signal: outer.signal, journal });
      publicReceipt.result = await executeNormalImport({ context, intent: journal.intent, history: [...journal.history], io: {
        signal: outer.signal, now: Date.now, guard, observe, append: journal.append,
        async login() { const credentialsBytes = await fileBytes(path.join(state.runtime, 'demo.private.json'), 16384), credentials = JSON.parse(credentialsBytes.toString()); requireThat(Object.keys(credentials).sort().join() === 'email,password' && typeof credentials.email === 'string' && typeof credentials.password === 'string', 'IMPORT_GENERATED_LOGIN_REQUIRED'); const response = await http('/api/auth/login', { method: 'POST', body: credentials, privateLogin: true }); return { status: response.status, user: response.value.user, token: response.value.token }; },
        async upload({ token, idempotencyKey }) { await assertCanonicalPath(packageFile); const current = await hashFile(packageFile); requireThat(current.bytes === context.archive.bytes && current.sha256 === context.archive.sha256, 'IMPORT_ARCHIVE_CHANGED'); await guard(); return http(projectRoute + '/model-imports', { operation: 'upload', method: 'POST', token, milliseconds: IMPORT_LIMITS.uploadMilliseconds, stream: createReadStream(packageFile), headers: { 'Content-Type': 'application/zip', 'Content-Length': String(context.archive.bytes), 'Idempotency-Key': idempotencyKey, 'X-Package-SHA256': context.archive.sha256 } }); },
        poll: ({ token, importId }) => http(projectRoute + '/model-imports/' + importId, { operation: 'poll', token }),
        listVersions: ({ token }) => http(projectRoute + '/model-versions', { operation: 'versions', token }),
        select: ({ token, modelVersionId, expectedSelectionRevision }) => http(projectRoute + '/active-model', { operation: 'selection', method: 'PATCH', token, body: { modelVersionId, expectedSelectionRevision } }),
        sleep: milliseconds => new Promise((resolve, reject) => { const timer = setTimeout(done, milliseconds), aborted = () => { clearTimeout(timer); outer.signal.removeEventListener('abort', aborted); reject(Object.assign(Error('IMPORT_INTERRUPTED'), { code: 'IMPORT_INTERRUPTED' })); }; function done() { outer.signal.removeEventListener('abort', aborted); resolve(); } outer.signal.addEventListener('abort', aborted, { once: true }); if (outer.signal.aborted) aborted(); }),
      } }); publicReceipt.status = 'PASS'; publicReceipt.operation = 'normal_protected_import_and_selection';
    }
  } catch (error) {
    publicReceipt.error = /^IMPORT_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'IMPORT_TOOL_FAILURE';
    if (journal) { try { await journal.append('invocation_failed', { code: publicReceipt.error, interrupted: outer.signal.aborted }); } catch { publicReceipt.failureJournalWrite = 'FAILED'; } }
  } finally {
    clearTimeout(deadline); process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    if (runLock && lockBytes) { try { if ((await fs.readFile(runLock, 'utf8')) === lockBytes) await fs.unlink(runLock); else publicReceipt.lockCleanup = 'OWNER_MISMATCH_RETAINED'; } catch { publicReceipt.lockCleanup = 'RETAINED'; } }
  }
  if (journal) publicReceipt.privateJournal = journal.summary(); publicReceipt.finishedAt = new Date().toISOString();
  const output = path.join(ROOT, 'docs/pathfinder/evidence/copied-project/import-' + Date.now() + '-' + randomUUID() + '.json'); await fs.mkdir(path.dirname(output), { recursive: true }); const saved = await writeDurable(output, publicReceipt);
  console.log(JSON.stringify({ status: publicReceipt.status, file: saved.path, sha256: saved.sha256, projectId: publicReceipt.projectId ?? null, error: publicReceipt.error ?? null })); return publicReceipt.status === 'PASS' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
