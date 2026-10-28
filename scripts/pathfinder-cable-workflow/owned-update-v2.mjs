// Explicit ROOT operator. Importing this file performs no Docker, SQL or runtime work.
// Each phase is one-shot. An interrupted/failed phase requires inspection, never retry.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as runtime from '../pathfinder-local/runtime-lib.mjs';
import { createDocker, command, jsonCommand, writePrivateJson } from '../operations/docker.mjs';
import { assertCanonicalPath, hashFile } from '../operations/archives.mjs';
import { withBoundedDockerExecution, getBoundedDockerCleanup } from '../operations/docker-bounds.mjs';
import { compareCurrentInventories } from '../pathfinder-copied-recovery/current-inventory-lib.mjs';
import { createRawInventoryProvider } from './raw-inventory-provider.mjs';

const SELF = fileURLToPath(import.meta.url), ROOT = runtime.ROOT, SCRATCH = path.join(ROOT, 'pathfinder-engine/.scratch');
export const SOURCE = Object.freeze({ owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46', project: 'wfc-pathfinder-local-0cba87606e9b',
  runtime: path.join(SCRATCH, 'batched-capture-runtime-20261018-1600'), port: 5191 });
const SHA = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PHASES = ['backup', 'restore', 'build', 'update', 'validate', 'retire'];
const BOUNDS = Object.freeze({ operationTimeoutMs: 7_200_000, commandTimeoutMs: 3_600_000, requestTimeoutMs: 180_000,
  helperTimeoutMs: 300_000, helperMemoryBytes: 1024 ** 3, pidsLimit: 128, nanoCpus: 2_000_000_000,
  // The actual largest model property resource is233991168bytes. Verified
  // reads spool one resource at a time;320MiB provides bounded headroom.
  tmpBytes: 320 * 1024 ** 2, archiveOutputBytes: 32 * 1024 ** 3, archiveOwnership: 'preserve-posix' });
const need = (condition, code) => { if (!condition) throw Object.assign(Error(code), { code }); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const same = (left, right) => canonical(left) === canonical(right);
const sorted = values => [...values].sort((left, right) => canonical(left).localeCompare(canonical(right)));
const file = (config, name) => path.join(config.directory, name);
const exists = async filename => fs.lstat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const readJson = async filename => { await assertCanonicalPath(filename); const bytes = await fs.readFile(filename); need(bytes.length <= 16 * 1024 ** 2, 'U8_FILE_LIMIT'); return JSON.parse(bytes); };
const pin = async filename => ({ path: filename, ...await hashFile(filename) });
export function outsideIdentity(item) {
  const { running, startedAt, networks, ...identity } = item;
  return { ...identity, networks: networks.map(([name, network]) => [name, network.NetworkID]) };
}
async function buildClosure() {
  // The current ignore file has only exclusions. Refuse new pattern syntax
  // rather than silently approximate a changed Docker build context.
  const patterns = (await fs.readFile(path.join(ROOT, 'docker/pathfinder.Dockerfile.dockerignore'), 'utf8')).split(/\r?\n/).filter(Boolean);
  need(patterns.every(value => !/[!#?[\]\\]/.test(value) && !value.startsWith('/') && !value.endsWith('/')), 'U8_DOCKERIGNORE_UNSUPPORTED');
  const rules = patterns.map(value => {
    const anchored = value.includes('/') && !value.startsWith('**/');
    const tokens = value.match(/\*\*\/|\*\*|\*|[^*]+/g) ?? [];
    const body = tokens.map(token => token === '**/' ? '(?:.*/)?' : token === '**' ? '.*' : token === '*' ? '[^/]*' : token.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('');
    return new RegExp((anchored ? '^' : '(?:^|/)') + body + '$');
  });
  const files = []; let bytes = 0;
  async function walk(directory, prefix = '') {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name; if (rules.some(rule => rule.test(relative))) continue;
      need(!entry.isSymbolicLink(), 'U8_BUILD_SYMLINK_REFUSED');
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
      else { need(entry.isFile(), 'U8_BUILD_SPECIAL_FILE_REFUSED'); const record = await hashFile(path.join(directory, entry.name));
        files.push({ path: relative, ...record }); bytes += record.bytes; need(files.length <= 30_000 && bytes <= 8 * 1024 ** 3, 'U8_BUILD_CONTEXT_LIMIT'); }
    }
  }
  await walk(ROOT); return { files, bytes, sha256: sha(canonical(files)) };
}

export function assertSource(state) {
  need(state?.owner === SOURCE.owner && state.project === SOURCE.project && state.runtime === SOURCE.runtime && Number(state.port) === SOURCE.port,
    'U8_EXACT_5191_SOURCE_REQUIRED');
  runtime.validateState(state, SOURCE.runtime); return state;
}
export function assertTarget(config, state) {
  need(UUID.test(config.operationId ?? '') && state?.runtime === config.targetRuntime && Number(state.port) === 5192 &&
    UUID.test(state.owner ?? '') && state.owner !== SOURCE.owner && state.project !== SOURCE.project && state.project !== 'wfc-pathfinder-local' &&
    state.runtime !== SOURCE.runtime && runtime.contained(config.directory, state.runtime), 'U8_SOURCE_RETIRE_DENIED');
  runtime.validateState(state, state.runtime); return state;
}
export function assertOperation(config, directory) {
  need(config?.schemaVersion === 'wfc.pf.owned-update.v2' && UUID.test(config.operationId ?? '') && same(config.source, SOURCE) &&
    config.directory === path.resolve(directory) && path.basename(config.directory) === 'cable-workflow-u8-' + config.operationId &&
    path.dirname(config.directory) === SCRATCH && config.targetRuntime === path.join(config.directory, 'restore-5192') &&
    config.backup === path.join(config.directory, 'backup') && config.companion === path.join(config.directory, 'backup-companion.private.json') &&
    SHA.test(config.inventory?.sha256 ?? '') && SHA.test(config.operatorSha256 ?? ''), 'U8_OPERATION_CONFIG_INVALID');
  return config;
}

// Raw PostgreSQL text is retained privately; no JSON.parse or numeric JS roundtrip.
const OBSERVER = String.raw`
import fs from 'node:fs/promises'; import {createHash} from 'node:crypto'; import {createRequire} from 'node:module';
const hash=b=>createHash('sha256').update(b).digest('hex'), require=createRequire('/app/node_modules/pg/lib/index.js');
const {Pool}=require('/app/node_modules/pg/lib/index.js');
if(hash(await fs.readFile('/qualified/losslessInventory.mjs'))!==process.env.INVENTORY_SHA)throw Error('U8_HELPER_HASH');
const {captureLosslessInventory}=await import('/qualified/losslessInventory.mjs');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000});
const check=async()=>{const r=await pool.query("SELECT count(*)::text n FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()");if(r.rows[0].n!=='0')throw Error('U8_OTHER_DATABASE_CLIENT');};
try{
 await check();const manifest=await captureLosslessInventory(pool,{allowedRoot:'/private',directory:'/private/'+process.env.CAPTURE_NAME,ownerId:process.env.OWNER_ID,signal:AbortSignal.timeout(180000)});
 const client=await pool.connect();let adjunct;
 try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const routines=await client.query("SELECT jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'kind',p.prokind,'definition',CASE WHEN p.prokind IN ('f','p') THEN pg_get_functiondef(p.oid) ELSE NULL END)::text raw FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname COLLATE \"C\",pg_get_function_identity_arguments(p.oid) COLLATE \"C\"");
  const kinds=await client.query("SELECT DISTINCT p.prokind FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'");if(kinds.rows.some(r=>!['f','p','a','w'].includes(r.prokind)))throw Error('U8_ROUTINE_KIND');
  const seq=await client.query("SELECT sequencename name,jsonb_build_object('name',sequencename,'dataType',data_type::text,'start',start_value::text,'min',min_value::text,'max',max_value::text,'increment',increment_by::text,'cycle',cycle,'cache',cache_size::text)::text raw FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename COLLATE \"C\"");
  const sequences=[];for(const s of seq.rows){const q='"'+s.name.replaceAll('"','""')+'"';const r=await client.query('SELECT jsonb_build_object(\'lastValue\',last_value::text,\'isCalled\',is_called)::text raw FROM public.'+q);sequences.push([s.raw,r.rows[0].raw]);}
  const extensions=await client.query("SELECT jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname)::text raw FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname COLLATE \"C\"");
  adjunct={schemaVersion:'wfc.pf.public-global-sql.v1',routines:routines.rows.map(r=>r.raw),excludedRoutineKinds:['a','w'],sequences,extensions:extensions.rows.map(r=>r.raw)};
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 await check();const raw=JSON.stringify(adjunct)+'\n';await fs.writeFile('/private/'+process.env.CAPTURE_NAME+'.global.private.json',raw,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:'PASS',contentSha256:manifest.contentSha256,globalSha256:hash(raw),tables:manifest.tables.length}));
}finally{await pool.end();}
`;

async function snapshot(state, target) {
  await runtime.configuration(state); const owned = await runtime.ownership(state), docker = await createDocker();
  const all = await docker.containers(), ids = new Set(owned.containers.map(item => item.id));
  const normalized = item => ({ id: item.Id, name: item.Name, image: item.Image, config: item.Config, host: item.HostConfig,
    mounts: sorted(item.Mounts ?? []), networks: Object.entries(item.NetworkSettings.Networks ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    running: item.State.Running, startedAt: item.State.StartedAt });
  const volumes = await jsonCommand(['volume', 'inspect', ...owned.volumes]);
  const networks = await jsonCommand(['network', 'inspect', ...owned.networks.map(item => item.id)]);
  return { owned, services: all.filter(item => ids.has(item.Id)).map(normalized).sort((a, b) => a.name.localeCompare(b.name)),
    outside: all.filter(item => !ids.has(item.Id) && (!target || !runtime.claimsProject(item, target))).map(normalized).sort((a, b) => a.name.localeCompare(b.name)),
    volumes: sorted(volumes), networks: sorted(networks.map(({ Containers, ...value }) => value)) };
}
function completeSource(state, view, expectedImages = state.images) {
  assertSource(state); need(view.owned.containers.map(item => item.role).sort().join() === 'api,minio,postgres,storage-ready,web' &&
    view.owned.volumes.length === 4 && view.owned.networks.length === 2, 'U8_COMPLETE_SOURCE_REQUIRED');
  for (const role of ['api', 'web']) need(view.owned.containers.find(item => item.role === role).image === expectedImages?.[role], 'U8_STATE_IMAGE_MISMATCH');
}
async function sourceUnchanged(config, { updated = false, activated = false, target } = {}) {
  if (target) { assertTarget(config, target); await runtime.ownership(target); }
  const state = assertSource(await runtime.load(SOURCE.runtime)), current = await snapshot(state, target), before = config.baseline;
  const originalImages = Object.fromEntries(before.owned.containers.map(item => [item.role, item.image]));
  completeSource(state, current, activated ? state.images : originalImages);
  need(same(current.outside.map(outsideIdentity), before.outside.map(outsideIdentity)), 'U8_OUTSIDE_RUNTIME_CHANGED');
  if (!same(current.outside, before.outside)) await writePrivateJson(file(config, 'outside-observation-' + randomUUID() + '.private.json'),
    { schemaVersion: 'wfc.pf.external-process-observation.v1', at: new Date().toISOString(), identityPreserved: true,
      note: 'External process running/start/IP observations changed; operator issued no outside mutations.', before: before.outside, after: current.outside });
  need(same(current.volumes, before.volumes) && same(current.networks, before.networks), 'U8_DATA_VOLUME_NETWORK_CHANGED');
  for (const original of before.services) {
    const role = original.config.Labels['com.docker.compose.service'], actual = current.services.find(item => item.name === original.name);
    need(actual && actual.running === original.running, 'U8_RUNNING_STATE_CHANGED');
    if (activated && ['api', 'web'].includes(role)) continue;
    // Backup intentionally restarts source API/web/MinIO; identity/configuration stay exact.
    const stripStart = ({ startedAt, networks, ...rest }) => ({ ...rest, networks: networks.map(([name, network]) => [name, network.NetworkID]) });
    need(same(stripStart(actual), stripStart(original)), 'U8_SOURCE_RESOURCE_CHANGED');
  }
  const settings = await runtime.readSettings(state);
  need(same(settings.producer, config.settings.producer) && same(settings.capacityProfile, config.settings.capacityProfile) &&
    ['databasePassword', 'storagePassword', 'jwtSecret', 'postgresImage', 'minioImage'].every(key => settings[key] === config.settings[key]), 'U8_PRIVATE_SETTINGS_CHANGED');
  if (!updated) need((await hashFile(path.join(state.runtime, 'runtime.env'))).sha256 === config.originalEnv.sha256 &&
    (await hashFile(path.join(state.runtime, 'runtime-state.json'))).sha256 === config.originalState.sha256, 'U8_SOURCE_STATE_CHANGED');
  return { state, view: current };
}
async function restoredTarget(config) {
  const record = await readJson(file(config, 'restore.pass.private.json'));
  const state = assertTarget(config, await runtime.load(config.targetRuntime));
  need(state.owner === record.result.targetOwner && state.project === record.result.targetProject &&
    same(await pin(path.join(state.runtime, 'runtime-state.json')), record.result.targetState) &&
    same(await pin(path.join(state.runtime, 'runtime.env')), record.result.targetEnv), 'U8_RESTORED_TARGET_CHANGED');
  need(same(await runtime.ownership(state), record.result.targetResources), 'U8_RESTORED_RESOURCES_CHANGED'); return state;
}
async function verifiedOperationBackup(config) {
  const saved = await readJson(file(config, 'backup.pass.private.json'));
  need(same(await pin(path.join(config.backup, 'complete.json')), saved.result.complete), 'U8_OPERATION_BACKUP_CHANGED');
  const complete = await readJson(path.join(config.backup, 'complete.json')), manifest = await readJson(path.join(config.backup, 'manifest.json'));
  need(complete.backupId === saved.result.backupId && manifest.backupId === saved.result.backupId && manifest.sourceOwner === SOURCE.owner && manifest.sourceProject === SOURCE.project &&
    same(await hashFile(path.join(config.backup, 'manifest.json')), complete.manifest), 'U8_OPERATION_BACKUP_IDENTITY');
  for (const role of ['api', 'web', 'postgres', 'minio']) need(manifest.images?.find(item => item.role === role)?.id === config.baseline.owned.containers.find(item => item.role === role)?.image,
    'U8_OPERATION_BACKUP_IMAGE_CHANGED');
  return manifest;
}
async function loadOperation(directory) {
  await assertCanonicalPath(directory, { directory: true }); const config = assertOperation(await readJson(path.join(directory, 'operation.private.json')), directory);
  need((await fs.readFile(path.join(directory, 'operation.sha256'), 'utf8')).trim() === (await hashFile(path.join(directory, 'operation.private.json'))).sha256,
    'U8_IMMUTABLE_CONFIG_CHANGED');
  for (const item of config.sourceClosure) need(same(await pin(item.path), item), 'U8_OPERATOR_SOURCE_CHANGED');
  need((await hashFile(SELF)).sha256 === config.operatorSha256 && (await hashFile(file(config, 'qualified-losslessInventory.mjs'))).sha256 === config.inventory.sha256,
    'U8_QUALIFIED_INVENTORY_CHANGED'); return config;
}
async function observation(config, observed) {
  const state = await runtime.load(observed.runtime), source = observed.phase === 'backup-before-dump';
  source ? assertSource(state) : assertTarget(config, state);
  if (!source) need(observed.backupId === (await verifiedOperationBackup(config)).backupId, 'U8_OBSERVER_BACKUP_CHANGED');
  need(same(observed, { schemaVersion: 'wfc.pf.cold-observation.v1', phase: observed.phase, backupId: observed.backupId, runtime: state.runtime,
    owner: state.owner, project: state.project, port: Number(state.port), apiImage: state.images.api }), 'U8_OBSERVER_IDENTITY');
  const owned = await runtime.ownership(state); need(owned.containers.find(item => item.role === 'postgres')?.running &&
    !owned.containers.some(item => ['api', 'web'].includes(item.role) && item.running), 'U8_OBSERVER_NOT_COLD');
  const name = observed.phase, output = file(config, 'observations'); await fs.mkdir(output, { recursive: true, mode: 0o700 });
  const settings = await runtime.readSettings(state);
  const result = await runtime.helper(state, ['node', '--input-type=module', '-e', OBSERVER], { network: state.project + '_backend',
    mounts: [{ Type: 'bind', Source: file(config, 'qualified-losslessInventory.mjs'), Target: '/qualified/losslessInventory.mjs', ReadOnly: true },
      { Type: 'bind', Source: output, Target: '/private', ReadOnly: false }],
    env: ['DATABASE_URL=postgresql://pf_local:' + settings.databasePassword + '@postgres:5432/wfc_pathfinder_local',
      'INVENTORY_SHA=' + config.inventory.sha256, 'CAPTURE_NAME=' + name, 'OWNER_ID=' + state.owner] });
  need(result.status === 'PASS', 'U8_OBSERVER_FAILED');
  await writePrivateJson(file(config, name + '.private.json'), { observed, result });
  if (!source) {
    const before = file(config, 'observations/' + (name === 'restore-before-fence' ? 'backup-before-dump' : 'restore-before-fence'));
    const after = file(config, 'observations/' + name);
    const comparison = await compareCurrentInventories(before, after, { comparison: name === 'restore-before-fence' ? 'exact' : 'restore-fence',
      beforeOwnerId: name === 'restore-before-fence' ? SOURCE.owner : state.owner, afterOwnerId: state.owner,
      ...(name === 'restore-after-fence' ? { targetId: state.owner } : {}) });
    need(comparison.status === 'PASS', 'U8_CURRENT_INVENTORY_MISMATCH');
    need((await hashFile(before + '.global.private.json')).sha256 === (await hashFile(after + '.global.private.json')).sha256, 'U8_GLOBAL_SQL_MISMATCH');
    await writePrivateJson(file(config, name + '-comparison.private.json'), comparison);
  }
}

async function initialize(directory, inventoryPath, expectedSha) {
  const operationId = path.basename(directory).replace(/^cable-workflow-u8-/, '');
  need(UUID.test(operationId) && path.dirname(directory) === SCRATCH && SHA.test(expectedSha ?? '') && !(await exists(directory)), 'U8_FRESH_OPERATION_REQUIRED');
  await assertCanonicalPath(path.dirname(directory), { directory: true }); await assertCanonicalPath(inventoryPath);
  const source = path.join(ROOT, 'server/operations/losslessInventory.ts'), raw = await fs.readFile(inventoryPath);
  need(sha(raw) === expectedSha && (await fs.stat(inventoryPath)).mtimeMs >= (await fs.stat(source)).mtimeMs &&
    !/\bfrom\s*['"](?!node:)/.test(raw.toString('utf8')), 'U8_FRESH_STANDALONE_INVENTORY_REQUIRED');
  await fs.mkdir(directory, { mode: 0o700 });
  if (process.platform === 'win32') await new Promise((resolve, reject) => {
    const child = spawn('icacls', [directory, '/inheritance:r', '/grant:r', process.env.USERDOMAIN + '\\' + process.env.USERNAME + ':(OI)(CI)F'], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(Error('U8_PRIVATE_DIRECTORY_ACL')); }, 15_000);
    child.once('error', () => { clearTimeout(timer); reject(Error('U8_PRIVATE_DIRECTORY_ACL')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('U8_PRIVATE_DIRECTORY_ACL')); });
  });
  await writePrivateJson(path.join(directory, 'init.begin.private.json'), { operationId, phase: 'init', status: 'BEGIN', at: new Date().toISOString() });
  const state = assertSource(await runtime.load(SOURCE.runtime)), settings = await runtime.readSettings(state), baseline = await snapshot(state);
  completeSource(state, baseline);
  const originalEnv = await pin(path.join(state.runtime, 'runtime.env')), originalState = await pin(path.join(state.runtime, 'runtime-state.json'));
  for (const [name, original] of [['original.runtime.env', originalEnv], ['original.runtime-state.private.json', originalState]]) {
    const bytes = await fs.readFile(original.path); await fs.writeFile(path.join(directory, name), bytes, { flag: 'wx', mode: 0o600 });
    need((await hashFile(path.join(directory, name))).sha256 === original.sha256, 'U8_ORIGINAL_COPY_CHANGED');
  }
  await fs.writeFile(path.join(directory, 'qualified-losslessInventory.mjs'), raw, { flag: 'wx', mode: 0o600 });
  const sourceClosure = await Promise.all(['scripts/pathfinder-local/runtime-lib.mjs', 'scripts/operations/docker.mjs', 'scripts/operations/docker-bounds.mjs',
    'scripts/operations/archives.mjs', 'scripts/operations/restore-fencing.mjs', 'scripts/pathfinder-copied-recovery/current-inventory-lib.mjs',
    'server/operations/losslessInventory.ts', 'scripts/pathfinder-cable-workflow/raw-inventory-provider.mjs', 'docker/pathfinder.compose.yml', 'docker/pathfinder.Dockerfile', 'docker/pathfinder.Dockerfile.dockerignore', 'docker/pathfinder.nginx.conf'].map(name => pin(path.join(ROOT, name))));
  const config = { schemaVersion: 'wfc.pf.owned-update.v2', operationId, directory, source: SOURCE, baseline, settings, originalEnv, originalState, buildContext: await buildClosure(),
    operatorSha256: (await hashFile(SELF)).sha256, inventory: { path: inventoryPath, sha256: expectedSha }, sourceClosure,
    backup: path.join(directory, 'backup'), companion: path.join(directory, 'backup-companion.private.json'), targetRuntime: path.join(directory, 'restore-5192') };
  assertOperation(config, directory); await writePrivateJson(path.join(directory, 'operation.private.json'), config);
  await fs.writeFile(path.join(directory, 'operation.sha256'), (await hashFile(path.join(directory, 'operation.private.json'))).sha256 + '\n', { flag: 'wx', mode: 0o600 });
  await writePrivateJson(path.join(directory, 'init.pass.private.json'), { status: 'PASS', at: new Date().toISOString(), storageReadyImage: baseline.owned.containers.find(item => item.role === 'storage-ready').image,
    producerConfigured: Boolean(settings.producer), inventoryQualification: 'operator-supplied-SHA-and-fresh-standalone-build;runtime-qualification-NOT_RUN' });
  return { status: 'PASS', operationId, next: 'backup' };
}

async function supervisedBuild(config) {
  const out = await fs.open(file(config, 'build-supervisor.private.log'), 'wx', 0o600); let timer, monitor, overrun = false, checking = false, expire;
  try {
    const previousLogs = new Set(await fs.readdir(SOURCE.runtime));
    const child = spawn(process.execPath, [SELF, '__build', '--operation', config.directory], { cwd: ROOT, windowsHide: true, stdio: ['ignore', out.fd, out.fd] });
    const terminated = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    const timedOut = new Promise(resolve => { expire = resolve; });
    const interrupt = () => { if (overrun) return; overrun = true; if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => {});
    } else { try { child.kill('SIGKILL'); } catch { /* uncertain remains sticky */ } }
      // A disconnected BuildKit task is never certified cancelled. Release the
      // supervisor after a bounded join and leave this operation permanently blocked.
      setTimeout(() => expire({ code: null, signal: 'UNCONFIRMED' }), 15_000).unref();
    };
    timer = setTimeout(interrupt, 2_700_000);
    monitor = setInterval(() => {
      if (checking) return; checking = true;
      void (async () => { let total = (await out.stat()).size;
        for (const name of await fs.readdir(SOURCE.runtime)) if (!previousLogs.has(name) && /^build-[a-z0-9]+-(api|web)\.log$/.test(name)) total += (await fs.stat(path.join(SOURCE.runtime, name))).size;
        if (total > 64 * 1024 ** 2) interrupt();
      })().catch(interrupt).finally(() => { checking = false; });
    }, 1000);
    const outcome = await Promise.race([terminated, timedOut]);
    if (overrun) child.unref();
    need(!overrun && outcome.code === 0 && outcome.signal === null, 'U8_BUILD_UNCONFIRMED_INSPECT_REQUIRED');
    return await readJson(file(config, 'build-result.private.json'));
  } finally { clearTimeout(timer); clearInterval(monitor); await out.close(); }
}
async function buildChild(config) {
  need(await exists(file(config, 'build.begin.private.json')) && await exists(file(config, 'phase.lock')) && !(await exists(file(config, 'build-result.private.json'))), 'U8_BUILD_PHASE_REQUIRED');
  await withBoundedDockerExecution(BOUNDS, async () => {
    await verifiedOperationBackup(config);
    const target = await restoredTarget(config);
    need(same(await buildClosure(), config.buildContext), 'U8_BUILD_CONTEXT_CHANGED');
    const { state } = await sourceUnchanged(config, { target }); const result = await runtime.build(state);
    need(same(await buildClosure(), config.buildContext), 'U8_BUILD_CONTEXT_CHANGED');
    await writePrivateJson(file(config, 'build-result.private.json'), { ...result, state: await pin(path.join(state.runtime, 'runtime-state.json')),
      env: await pin(path.join(state.runtime, 'runtime.env')), producerRuntimeQualification: 'NOT_QUALIFIED_AFTER_NEW_BUILD;no-new-grant-or-producer-configuration' });
  });
}
async function waitUpdatedHealth(state) {
  const docker = await createDocker(), deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const resources = await runtime.ownership(state); completeSource(state, { owned: resources });
    const services = ['api', 'web'].map(role => resources.containers.find(item => item.role === role));
    const healthy = await Promise.all(services.map(async item => item.running && (await docker.inspect(item.id)).State.Health?.Status === 'healthy'));
    if (healthy.every(Boolean)) {
      try { const response = await fetch('http://127.0.0.1:5191/health', { redirect: 'error', signal: AbortSignal.timeout(3000) });
        const text = await response.text(); if (response.ok && text.length <= 4096 && JSON.parse(text).status === 'ok') return { status: 'PASS', scope: 'unauthenticated-health-only' };
      } catch { /* No login or browser acceptance is inferred from health. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  need(false, 'U8_UPDATED_HEALTH_FAILED');
}
async function inventoryProviderFor(config, postUpdateApiImage) {
  const outputRoot=file(config,'raw-inventory-captures');await fs.mkdir(outputRoot,{recursive:true,mode:0o700});
  return createRawInventoryProvider({source:SOURCE,targetRuntime:config.targetRuntime,outputRoot,
    modulePath:file(config,'qualified-losslessInventory.mjs'),sha256:config.inventory.sha256,
    apiImage:config.baseline.owned.containers.find(item=>item.role==='api').image,
    ...(postUpdateApiImage?{postUpdateApiImage}:{})});
}
async function validateUpdatedData(config, target) {
  const { state, view } = await sourceUnchanged(config, { updated: true, activated: true, target });
  const docker = await createDocker(), services = view.owned.containers.filter(item => ['api', 'web'].includes(item.role));
  const originalImage = config.baseline.owned.containers.find(item => item.role === 'api').image;
  const auditState = { ...state, images: { ...state.images, api: originalImage } }, settings = await runtime.readSettings(state);
  const env = ['DATABASE_URL=postgresql://pf_local:' + settings.databasePassword + '@postgres:5432/wfc_pathfinder_local', 'JWT_SECRET=' + settings.jwtSecret,
    'MINIO_ENDPOINT=minio', 'MINIO_PORT=9000', 'MINIO_USE_SSL=false', 'MINIO_ACCESS_KEY=pf_local_storage', 'MINIO_SECRET_KEY=' + settings.storagePassword,
    'MINIO_BUCKET_PROJECTS=pf-local-project-files', 'MINIO_BUCKET_TEMPLATES=pf-local-template-files', 'WFC_MODEL_BUCKET=pf-local-models', 'WFC_MODEL_IMPORT_ROOT=/var/lib/wfc/model-imports'];
  const observe = name => runtime.helper(auditState, ['node', 'server/dist/server/operations/cli.js', name], { network: state.project + '_backend', env });
  let facts;
  try {
    for (const role of ['web', 'api']) { const item = services.find(value => value.role === role); if (item.running) await docker.stop(item.id, 45);
      const after = await docker.inspect(item.id); need(!after.State.Running && after.State.ExitCode === 0 && !after.State.OOMKilled, 'U8_VALIDATION_UNCLEAN_STOP'); }
    const pg = view.owned.containers.find(item => item.role === 'postgres');
    const clients = (await command(['exec', pg.id, 'psql', '--no-password', '--no-psqlrc', '--tuples-only', '--no-align', '-U', 'pf_local', '-d', 'wfc_pathfinder_local', '-c',
      "SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()"])).toString().trim();
    need(clients === '0', 'U8_VALIDATION_EXTERNAL_DATABASE_CLIENT');
    const backup = await runtime.verifyBackup(config.backup);
    const provider=await inventoryProviderFor(config,state.images.api);
    const capture=phase=>provider.capture({phase,backupId:backup.manifest.backupId,runtime:state.runtime,owner:state.owner,
      project:state.project,port:state.port,apiImage:state.images.api,moduleSha256:config.inventory.sha256});
    const before = await capture('post-update-before-audit'), models = await observe('audit-models'), artifacts = await runtime.artifactAudit(auditState), after = await capture('post-update-after-audit');
    facts = { schemaVersion: 'wfc.pf.post-update-strict-audit.v2', algorithmImage: originalImage, before, models, artifacts, after,
      backupInventory: backup.manifest.inventory, backupArtifactSha256: backup.manifest.artifacts.sha256,
      businessEqual: before.businessSha256 === backup.manifest.inventory.businessSha256 && after.businessSha256 === before.businessSha256,
      registryEqual: before.registrySha256 === backup.manifest.inventory.registrySha256 && after.registrySha256 === before.registrySha256,
      artifactsEqual: artifacts.sha256 === backup.manifest.artifacts.sha256, qualification: 'versioned-streamed-raw-inventory;strict-whole-table-closure;no-migration-delta-allowance' };
    await writePrivateJson(file(config, 'post-update-audit.private.json'), facts);
    need([before, models, artifacts, after].every(item => item.status === 'PASS') && facts.businessEqual && facts.registryEqual && facts.artifactsEqual,
      'U8_POST_UPDATE_DATA_CHANGED_MIGRATION_QUALIFICATION_REQUIRED');
  } finally {
    for (const role of ['api', 'web']) { const item = services.find(value => value.role === role); const current = await docker.inspect(item.id);
      need(current.Id === item.id && current.Image === item.image && current.Config.Labels['wfc.pathfinder.owner'] === SOURCE.owner, 'U8_RESUME_IDENTITY_CHANGED');
      if (item.running && !current.State.Running) await docker.start(item.id); }
    await waitUpdatedHealth(state);
  }
  await sourceUnchanged(config, { updated: true, activated: true, target });
  return { status: 'PASS', deliveryState: 'DATA_VALIDATED', audit: await pin(file(config, 'post-update-audit.private.json')),
    browserAcceptance: 'NOT_RUN', engineeringAcceptance: 'NOT_RUN' };
}
async function executePhase(config, phase) {
  need(PHASES.includes(phase), 'U8_PHASE_INVALID');
  const index = PHASES.indexOf(phase);
  for (const prerequisite of ['init', ...PHASES.slice(0, index)]) need(await exists(file(config, prerequisite + '.pass.private.json')), 'U8_PREVIOUS_PHASE_REQUIRED');
  need(!(await exists(file(config, phase + '.begin.private.json'))), 'U8_PHASE_ALREADY_ATTEMPTED_INSPECT_REQUIRED');
  const nonce = randomUUID(), lock = { operationId: config.operationId, phase, nonce, pid: process.pid };
  await writePrivateJson(file(config, 'phase.lock'), lock);
  await writePrivateJson(file(config, phase + '.begin.private.json'), { ...lock, status: 'BEGIN', at: new Date().toISOString() });
  try {
    let result;
    if (phase !== 'backup') await verifiedOperationBackup(config);
    if (phase === 'build') result = await supervisedBuild(config);
    else result = await withBoundedDockerExecution(BOUNDS, async () => {
      if (phase === 'backup') {
        const { state } = await sourceUnchanged(config); const verified = await runtime.backup(state, config.backup, config.companion, {
          observeCold: value => observation(config, value), inventoryProvider:await inventoryProviderFor(config) });
        need(verified.manifest.sourceOwner === SOURCE.owner && verified.manifest.sourceProject === SOURCE.project &&
          verified.manifest.backupId === (await readJson(file(config, 'backup-before-dump.private.json'))).observed.backupId &&
          ['api', 'web', 'postgres', 'minio'].every(role => verified.manifest.images.find(item => item.role === role)?.id === config.baseline.owned.containers.find(item => item.role === role)?.image), 'U8_BACKUP_SOURCE_MISMATCH');
        await sourceUnchanged(config); return { status: 'PASS', backupId: verified.manifest.backupId, complete: await pin(path.join(config.backup, 'complete.json')) };
      }
      if (phase === 'restore') {
        await sourceUnchanged(config); const restored = await runtime.restore({ backup: config.backup, privateConfig: config.companion,
          runtime: config.targetRuntime, port: 5192, activate: false, observeCold: value => observation(config, value),
          inventoryProvider:await inventoryProviderFor(config) });
        const target = assertTarget(config, await runtime.load(config.targetRuntime)), view = await runtime.ownership(target);
        need(restored.activated === false && !view.containers.some(item => ['api', 'web'].includes(item.role)), 'U8_RESTORE_API_MUST_NOT_EXIST');
        await sourceUnchanged(config, { target }); return { ...restored, targetOwner: target.owner, targetProject: target.project,
          targetState: await pin(path.join(target.runtime, 'runtime-state.json')), targetEnv: await pin(path.join(target.runtime, 'runtime.env')), targetResources: view };
      }
      const target = await restoredTarget(config);
      if (phase === 'validate') return await validateUpdatedData(config, target);
      if (phase === 'retire') {
        await sourceUnchanged(config, { updated: true, activated: true, target }); need(target.status === 'verified-quarantine' && target.restore?.fencingValidated === true, 'U8_VERIFIED_NEW_TARGET_REQUIRED');
        const result = await runtime.retire(target); await sourceUnchanged(config, { updated: true, activated: true }); return result;
      }
      const built = await readJson(file(config, 'build-result.private.json'));
      const { state } = await sourceUnchanged(config, { updated: true, target });
      need(same(await pin(path.join(state.runtime, 'runtime-state.json')), built.state) && same(await pin(path.join(state.runtime, 'runtime.env')), built.env) &&
        same(state.images, built.images), 'U8_NEW_BUILD_CHANGED');
      // Explicit API/web update only. Never runtime.start(), which starts every service.
      await command([...runtime.composeArgs(state), 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'api', 'web']);
      const health = await waitUpdatedHealth(state);
      const after = await sourceUnchanged(config, { updated: true, activated: true, target });
      need(['api', 'web'].every(role => after.view.owned.containers.find(item => item.role === role)?.running), 'U8_UPDATED_SERVICE_NOT_RUNNING');
      return { status: 'PASS', origin: 'http://127.0.0.1:5191', images: state.images, health, producerRuntimeQualification: 'NOT_QUALIFIED_AFTER_NEW_BUILD',
        deliveryState: 'RUNNING_UNVERIFIED', dataValidation: 'REQUIRED_BEFORE_RETIRE',
        browserAcceptance: 'NOT_RUN', authenticatedChecks: 'NOT_RUN', apiSchemaInitializer: 'production-startup-may-migrate;post-update-data-validation-required' };
    });
    await writePrivateJson(file(config, phase + '.pass.private.json'), { status: 'PASS', phase, at: new Date().toISOString(), result });
    need(same(await readJson(file(config, 'phase.lock')), lock), 'U8_PHASE_LOCK_CHANGED'); await fs.unlink(file(config, 'phase.lock'));
    return { status: 'PASS', phase, next: PHASES[index + 1] ?? null, ...(phase === 'update' ? { origin: 'http://127.0.0.1:5191' } : {}) };
  } catch (error) {
    await writePrivateJson(file(config, phase + '.failed.private.json'), { status: 'FAIL', phase, code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'U8_PHASE_FAILED',
      cleanup: getBoundedDockerCleanup(error), requiresInspection: true, automaticRetry: false, at: new Date().toISOString() }); throw error;
  }
}
export async function main(argv) {
  const [phase, ...args] = argv, options = {};
  need(args.length % 2 === 0, 'U8_ARGUMENTS'); for (let i = 0; i < args.length; i += 2) {
    need(['--operation', '--qualified-inventory', '--inventory-sha'].includes(args[i]) && !Object.hasOwn(options, args[i]), 'U8_ARGUMENTS'); options[args[i]] = args[i + 1];
  }
  need(typeof options['--operation'] === 'string' && path.isAbsolute(options['--operation']), 'U8_EXPLICIT_OPERATION_REQUIRED');
  const directory = path.resolve(options['--operation']);
  if (phase === 'init') return await withBoundedDockerExecution(BOUNDS, () => initialize(directory, options['--qualified-inventory'], options['--inventory-sha']));
  need(Object.keys(options).length === 1, 'U8_ARGUMENTS'); const config = await loadOperation(directory);
  if (phase === 'status') return { status: 'READ_ONLY', operationId: config.operationId, phases: await Promise.all(['init', ...PHASES].map(async value => ({ phase: value,
    pass: await exists(file(config, value + '.pass.private.json')), attempted: await exists(file(config, value + '.begin.private.json')), failed: await exists(file(config, value + '.failed.private.json')) }))) };
  if (phase === '__build') return await buildChild(config);
  return await executePhase(config, phase);
}
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).then(result => {
  if (result !== undefined) process.stdout.write(JSON.stringify(result) + '\n');
}, error => { process.stderr.write(JSON.stringify({ status: 'FAIL', code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'U8_OPERATOR_FAILED', requiresInspection: true }) + '\n'); process.exitCode = 1; });
