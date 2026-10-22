// Concrete root-only B9 operations. No runtime action happens at import time.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as runtime from '../pathfinder-local/runtime-lib.mjs';
import { createDocker, command, jsonCommand, writePrivateJson } from '../operations/docker.mjs';
import { assertCanonicalPath, hashFile } from '../operations/archives.mjs';
import { withBoundedDockerExecution } from '../operations/docker-bounds.mjs';
import { compareCurrentInventories } from '../pathfinder-copied-recovery/current-inventory-lib.mjs';
import { createRawInventoryProvider } from '../pathfinder-cable-workflow/raw-inventory-provider.mjs';
import { SOURCE, need, same, digest, pin, assertSource, assertTarget, assertOperation, claimBuildChild, assertConservationPolicy } from './owned-update-v3.mjs';
import { selectDeliveryPolicy as selectV4DeliveryPolicy } from './delivery-policy-selector-v4.mjs';
import { selectDeliveryPolicy as selectV5DeliveryPolicy } from './delivery-policy-selector-v5.mjs';
import { outsideIdentity } from '../pathfinder-cable-workflow/owned-update-v2.mjs';
import { projectNetworkResource, sortCanonicalRecords } from './network-resource-identity.mjs';

const ROOT = runtime.ROOT, SCRATCH = path.join(ROOT, 'pathfinder-engine/.scratch');
const SHA = /^[a-f0-9]{64}$(?![\s\S])/, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$(?![\s\S])/;
export const BOUNDS = Object.freeze({ operationTimeoutMs: 7_200_000, commandTimeoutMs: 3_600_000, requestTimeoutMs: 180_000,
  helperTimeoutMs: 300_000, helperMemoryBytes: 1024 ** 3, pidsLimit: 128, nanoCpus: 2_000_000_000,
  tmpBytes: 320 * 1024 ** 2, archiveOutputBytes: 32 * 1024 ** 3, archiveOwnership: 'preserve-posix' });
/** Backup retention is never permission to start a new implementation. */
export function classifyQuiescence(counts, mode) {
  const keys = ['jobs', 'imports', 'orphanImports', 'preparations', 'passivePreparations', 'impacts', 'initialFill', 'recalculation', 'grants', 'leases'];
  const valid = ['cold-backup', 'protected-runtime'].includes(mode) && counts !== null && typeof counts === 'object' && !Array.isArray(counts)
    && Object.keys(counts).length === keys.length && keys.every(key => Object.hasOwn(counts, key) && /^(0|[1-9][0-9]{0,6})$/.test(counts[key]) && typeof counts[key] === 'string');
  if (!valid) throw Object.assign(Error('B9_QUIESCENCE_RESPONSE'), {code: 'B9_QUIESCENCE_RESPONSE'});
  const blocking = keys.filter(key => key !== 'passivePreparations' && !(key === 'grants' && mode === 'cold-backup'));
  return {schemaVersion: 'wfc.pf.b9.quiescence.v1', status: blocking.every(key => counts[key] === '0') ? 'PASS' : 'FAIL', mode, counts,
    retained: {expiredHumanPreparations: counts.passivePreparations, persistentGrants: mode === 'cold-backup' ? counts.grants : '0'},
    grantPolicy: mode === 'cold-backup' ? 'retained-in-cold-backup-no-runtime-permission' : 'enabled-current-grants-refused', sourceUpgradeAuthorized: false};
}
export function assertQuiescenceScope(mode, label, state) {
  need(['cold-backup', 'protected-runtime'].includes(mode) && (mode !== 'cold-backup' || ['source-backup', 'source-backup-cold'].includes(label)
    && state.owner === SOURCE.owner && state.project === SOURCE.project && state.runtime === SOURCE.runtime && state.port === SOURCE.port), 'B9_QUIESCENCE_SCOPE');
  return mode;
}
const ownedFile = (config, name) => path.join(config.directory, name);
const moduleFile = name => path.join(ROOT, 'scripts/pathfinder-barriers', name);
const read = async filename => { await assertCanonicalPath(filename); need((await fs.stat(filename)).size <= 32 * 1024 ** 2, 'B9_RECORD_LIMIT'); return JSON.parse(await fs.readFile(filename, 'utf8')); };
const exists = async filename => fs.lstat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const mount = (Source, Target, ReadOnly = true) => ({ Type: 'bind', Source, Target, ReadOnly });
const normalize = item => ({ id: item.Id, name: item.Name, image: item.Image, config: item.Config, host: item.HostConfig,
  mounts: [...item.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination)),
  networks: Object.entries(item.NetworkSettings.Networks ?? {}).sort(([a], [b]) => a.localeCompare(b)), running: item.State.Running, startedAt: item.State.StartedAt });
export function pristineDatabase(operationId) { need(UUID.test(operationId), 'B9_PRISTINE_IDENTITY'); return 'wfc_pfb9_pristine_' + operationId.replaceAll('-', ''); }
function databaseUrl(settings, database) {
  need(database === 'wfc_pathfinder_local' || /^wfc_pfb9_pristine_[a-f0-9]{32}$(?![\s\S])/.test(database), 'B9_DATABASE_REQUIRED');
  return 'postgresql://pf_local:' + settings.databasePassword + '@postgres:5432/' + database;
}
export function safeContext(config, phase, state, backupId, candidate, engineIdentitySha256) {
  need(['target-migration', 'target-runtime', 'source-runtime'].includes(phase) && UUID.test(backupId) && SHA.test(engineIdentitySha256), 'B9_QUALIFIER_SCOPE');
  phase === 'source-runtime' ? assertSource(state) : assertTarget(config, state);
  return { operationId: config.operationId, phase, runtime: state.runtime, owner: state.owner, project: state.project, port: state.port,
    backupId, candidate, engineIdentitySha256 };
}
function helperEnv(settings, database = 'wfc_pathfinder_local') {
  return ['DATABASE_URL=' + databaseUrl(settings, database), 'JWT_SECRET=' + settings.jwtSecret,
    'MINIO_ENDPOINT=minio', 'MINIO_PORT=9000', 'MINIO_USE_SSL=false', 'MINIO_ACCESS_KEY=pf_local_storage', 'MINIO_SECRET_KEY=' + settings.storagePassword,
    'MINIO_BUCKET_PROJECTS=pf-local-project-files', 'MINIO_BUCKET_TEMPLATES=pf-local-template-files', 'WFC_MODEL_BUCKET=pf-local-models', 'WFC_MODEL_IMPORT_ROOT=/var/lib/wfc/model-imports'];
}
export const SCHEMA_HELPER = `
const database=new URL(process.env.DATABASE_URL).pathname.slice(1);
if(database!==process.env.EXPECTED_DATABASE)throw Error('B9_DATABASE_MISMATCH');
if(process.env.PF_ROOT||process.env.PF_ENGINE_DLL)throw Error('B9_RUNTIME_ENV_REFUSED');
const {initializeDatabase,shutdownDatabase,pool}=await import('/app/server/dist/server/db.js');
try{const id=await pool.query('SELECT current_database() name');if(id.rows[0]?.name!==database)throw Error('B9_DATABASE_MISMATCH');
if(process.env.PRISTINE_OPERATION){const marker=await pool.query('SELECT operation_id::text,owner_id::text FROM pfb9_owner.owner');if(marker.rows.length!==1||marker.rows[0].operation_id!==process.env.PRISTINE_OPERATION||marker.rows[0].owner_id!==process.env.OWNER_ID)throw Error('B9_PRISTINE_MARKER');}
await initializeDatabase();console.log(JSON.stringify({status:'PASS',database,scope:'schema-only-no-runtime'}));}
catch{console.log(JSON.stringify({status:'FAIL',code:'B9_SCHEMA_INITIALIZATION_FAILED'}));process.exitCode=1;}
finally{await shutdownDatabase();}
`;
export const CAPTURE_HELPER = `
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire('/app/node_modules/pg/lib/index.js'),{Pool}=require('/app/node_modules/pg/lib/index.js');
for(const [filename,key] of [['/qualified/losslessInventory.mjs','INVENTORY_SHA'],['/qualified/global-sql-v2.mjs','GLOBALS_SHA']])if(createHash('sha256').update(await fs.readFile(filename)).digest('hex')!==process.env[key])throw Error('B9_CAPTURE_MODULE_HASH');
const {captureLosslessInventory}=await import('/qualified/losslessInventory.mjs'),{capturePublicGlobals}=await import('/qualified/global-sql-v2.mjs');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000});
try{
const identity=await pool.query("SELECT current_database() name,(SELECT count(*)::text FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()) others");
if(identity.rows[0]?.name!==process.env.EXPECTED_DATABASE||identity.rows[0]?.others!=='0')throw Error('B9_CAPTURE_NOT_ISOLATED');
if(process.env.PRISTINE_OPERATION){const marker=await pool.query('SELECT operation_id::text,owner_id::text FROM pfb9_owner.owner');if(marker.rows.length!==1||marker.rows[0].operation_id!==process.env.PRISTINE_OPERATION||marker.rows[0].owner_id!==process.env.OWNER_ID)throw Error('B9_PRISTINE_MARKER');}
const manifest=await captureLosslessInventory(pool,{allowedRoot:'/private',directory:'/private/'+process.env.CAPTURE_NAME,ownerId:process.env.OWNER_ID,signal:AbortSignal.timeout(180000)});
const globals=await capturePublicGlobals(pool,{signal:AbortSignal.timeout(120000)});
const finalIdentity=await pool.query("SELECT current_database() name,(SELECT count(*)::text FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()) others");
if(finalIdentity.rows[0]?.name!==process.env.EXPECTED_DATABASE||finalIdentity.rows[0]?.others!=='0')throw Error('B9_CAPTURE_NOT_ISOLATED');
const raw=JSON.stringify(globals)+'\\n';await fs.writeFile('/private/'+process.env.CAPTURE_NAME+'.globals.private.json',raw,{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:'PASS',contentSha256:manifest.contentSha256,tables:manifest.tables.length,globalSha256:createHash('sha256').update(raw).digest('hex')}));
}catch{throw Error('B9_CAPTURE_FAILED');}finally{await pool.end();}
`;
export const QUIESCENCE_HELPER = `
import {createRequire} from 'node:module';const require=createRequire('/app/node_modules/pg/lib/index.js'),{Pool}=require('/app/node_modules/pg/lib/index.js');
const classify=${classifyQuiescence.toString()};
if(!['cold-backup','protected-runtime'].includes(process.env.QUIESCENCE_SCOPE))throw Error('B9_QUIESCENCE_SCOPE');
const {PREPARATION_LIMITS}=await import('/app/server/dist/shared/pathfinderPreparation.js');
if(PREPARATION_LIMITS.sessionMilliseconds!==1800000)throw Error('B9_PREPARATION_DEADLINE_CHANGED');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:15000});
try{const id=await pool.query('SELECT current_database() name');if(id.rows[0]?.name!=='wfc_pathfinder_local')throw Error('B9_DATABASE_MISMATCH');
const queries={jobs:"SELECT count(*)::text n FROM pf_jobs WHERE state IN('queued','running')",imports:"SELECT count(*)::text n FROM model_import_jobs WHERE staging_cleaned_at IS NULL OR(state<>'complete' AND cleaned_at IS NULL)",
orphanImports:"SELECT count(*)::text n FROM model_storage_ownership WHERE published=FALSE AND cleaned_at IS NULL",
preparations:"SELECT count(*)::text n FROM pf_preparation_sessions WHERE state IN('planned','collecting','validating') AND NOT(grant_provenance IS NULL AND state IN('planned','collecting') AND created_at+interval '30 minutes'<clock_timestamp() AND(validation_expires_at IS NULL OR validation_expires_at<=clock_timestamp()))",
passivePreparations:"SELECT count(*)::text n FROM pf_preparation_sessions WHERE grant_provenance IS NULL AND state IN('planned','collecting') AND created_at+interval '30 minutes'<clock_timestamp() AND(validation_expires_at IS NULL OR validation_expires_at<=clock_timestamp())",
impacts:"SELECT count(*)::text n FROM pf_location_impact_dispatch WHERE status IN('pending','collecting')",initialFill:"SELECT count(*)::text n FROM pf_initial_fill_dispatch WHERE status IN('pending','running','unknown')",
recalculation:"SELECT count(*)::text n FROM pf_recalculation_state WHERE enabled AND NOT paused AND authority_expires_at>clock_timestamp() OR status IN('collecting','queued','calculating')",
grants:"SELECT count(*)::text n FROM pf_calculation_grant_heads h JOIN pf_calculation_grant_revisions r ON r.project_id=h.project_id AND r.id=h.grant_id AND r.grant_revision=h.control_revision WHERE r.installation_epoch=(SELECT installation_epoch FROM pf_installation_state WHERE singleton) AND r.record->>'enabled'='true'",
leases:"SELECT count(*)::text n FROM pf_calculation_grant_leases WHERE installation_epoch=(SELECT installation_epoch FROM pf_installation_state WHERE singleton) AND state IN('active','quarantined')"};
const counts={};for(const [key,sql] of Object.entries(queries)){const r=await pool.query(sql);if(!/^(0|[1-9][0-9]{0,6})$/.test(r.rows[0]?.n))throw Error('B9_QUIESCENCE_RESPONSE');counts[key]=r.rows[0].n;}
console.log(JSON.stringify(classify(counts,process.env.QUIESCENCE_SCOPE)));
}finally{await pool.end();}
`;
async function privateDirectory(directory) {
  await fs.mkdir(directory, { mode: 0o700 });
  if (process.platform === 'win32') await new Promise((resolve, reject) => {
    const child = spawn('icacls', [directory, '/inheritance:r', '/grant:r', process.env.USERDOMAIN + '\\' + process.env.USERNAME + ':(OI)(CI)F'], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(Error('B9_PRIVATE_ACL_TIMEOUT')); }, 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('B9_PRIVATE_ACL_FAILED')); });
  });
}
async function immutableCopy(config, name, filename) {
  const original = await pin(filename), output = ownedFile(config, name);
  await fs.writeFile(output, await fs.readFile(filename), { flag: 'wx', mode: 0o600 });
  const saved = await pin(output); need(saved.sha256 === original.sha256, 'B9_PRIVATE_COPY_CHANGED'); return saved;
}
async function snapshot(state, target) {
  await runtime.configuration(state); const owned = await runtime.ownership(state), docker = await createDocker(), all = await docker.containers();
  const ids = new Set(owned.containers.map(item => item.id));
  const sort = sortCanonicalRecords;
  const networks = (await jsonCommand(['network', 'inspect', ...owned.networks.map(item => item.id)]))
    .map(({ Containers, ...value }) => projectNetworkResource(value));
  return { owned, services: sort(all.filter(item => ids.has(item.Id)).map(normalize)),
    outside: sort(all.filter(item => !ids.has(item.Id) && (!target || !runtime.claimsProject(item, target))).map(normalize)),
    volumes: sort(await jsonCommand(['volume', 'inspect', ...owned.volumes])),
    networks: sort(networks.map(value => value.identity)), networkAllocations: sort(networks.map(value => value.allocation)) };
}
async function sourceConserved(config, { target, updated = false, stopped = false } = {}) {
  const state = assertSource(await runtime.load(SOURCE.runtime)), view = await snapshot(state, target), before = config.baseline;
  await writePrivateJson(ownedFile(config, 'source-network-observation-' + randomUUID() + '.private.json'), {
    schemaVersion: 'wfc.pf.b9.network-allocation-observation.v1', operationId: config.operationId, at: new Date().toISOString(),
    source: SOURCE, allocation: view.networkAllocations });
  if (updated) {
    const installed = await read(ownedFile(config, 'source-image-install.result.private.json'));
    need(installed.status === 'PASS' && installed.operationId === config.operationId
      && (await pin(path.join(state.runtime, 'runtime-state.json'))).sha256 === installed.stateSha256
      && (await pin(path.join(state.runtime, 'runtime.env'))).sha256 === installed.envSha256
      && ['api', 'web'].every(role => state.images[role] === installed.images?.[role]
        && view.owned.containers.find(item => item.role === role)?.image === installed.images[role]), 'B9_INSTALLED_SOURCE_CHANGED');
  }
  need(view.owned.containers.map(item => item.role).sort().join() === 'api,minio,postgres,storage-ready,web' && view.owned.volumes.length === 4
    && view.owned.networks.length === 2, 'B9_COMPLETE_SOURCE_REQUIRED');
  need(same(view.outside.map(outsideIdentity), before.outside.map(outsideIdentity)), 'B9_OUTSIDE_IDENTITY_CHANGED');
  need(same(view.volumes, before.volumes) && same(view.networks, before.networks), 'B9_DATA_RESOURCES_CHANGED');
  const normalized = value => { const { startedAt, networks, ...rest } = value; return { ...rest, networks: networks.map(([name, network]) => [name, network.NetworkID]) }; };
  for (const previous of before.services) {
    const role = previous.config.Labels['com.docker.compose.service'], actual = view.services.find(item => item.name === previous.name);
    need(actual, 'B9_SOURCE_SERVICE_MISSING');
    if (updated && ['api', 'web'].includes(role)) continue;
    const expected = stopped && ['api', 'web'].includes(role) ? { ...previous, running: false } : previous;
    need(same(normalized(actual), normalized(expected)), 'B9_SOURCE_SERVICE_CHANGED');
  }
  const settings = await runtime.readSettings(state);
  for (const name of ['databasePassword', 'storagePassword', 'jwtSecret', 'postgresImage', 'minioImage', 'producer', 'capacityProfile'])
    need(same(settings[name], config.settings[name]), 'B9_SOURCE_PRIVATE_CONFIGURATION_CHANGED');
  if (!updated) need((await pin(path.join(state.runtime, 'runtime-state.json'))).sha256 === config.originalState.sha256
    && (await pin(path.join(state.runtime, 'runtime.env'))).sha256 === config.originalEnv.sha256, 'B9_SOURCE_STATE_CHANGED');
  return { state, view };
}
async function targetState(config, passes) {
  const state = assertTarget(config, await runtime.load(config.targetRuntime)), record = passes['restore-quarantine'].result;
  need(state.owner === record.target.owner && state.project === record.target.project && state.restore?.backupId === passes.backup.result.backupId
    && state.restore.fencingValidated === true, 'B9_RESTORED_TARGET_CHANGED'); await runtime.ownership(state); return state;
}
async function capture(config, state, label, image, database = 'wfc_pathfinder_local') {
  need(/^[a-z][a-z0-9-]{0,80}$/.test(label), 'B9_CAPTURE_LABEL');
  const output = ownedFile(config, 'captures'); await fs.mkdir(output, { recursive: true, mode: 0o700 });
  const settings = await runtime.readSettings(state), globals = await pin(moduleFile('global-sql-v2.mjs'));
  const result = await runtime.helper({ ...state, images: { ...state.images, api: image } }, ['node', '--input-type=module', '-e', CAPTURE_HELPER], {
    network: state.project + '_backend', mounts: [mount(ownedFile(config, 'qualified-losslessInventory.mjs'), '/qualified/losslessInventory.mjs'),
      mount(globals.path, '/qualified/global-sql-v2.mjs'), mount(output, '/private', false)],
    env: [...helperEnv(settings, database), 'EXPECTED_DATABASE=' + database, 'OWNER_ID=' + state.owner, 'CAPTURE_NAME=' + label,
      'INVENTORY_SHA=' + config.inventory.sha256, 'GLOBALS_SHA=' + globals.sha256,
      ...(database !== 'wfc_pathfinder_local' ? ['PRISTINE_OPERATION=' + config.operationId] : [])] });
  need(result.status === 'PASS', 'B9_CAPTURE_FAILED');
  const directory = path.join(output, label), manifest = await pin(path.join(directory, 'manifest.json'));
  const reference = { directory, ownerId: state.owner, manifest, globals: await pin(path.join(output, label + '.globals.private.json')), contentSha256: result.contentSha256 };
  need((await read(manifest.path)).contentSha256 === reference.contentSha256, 'B9_CAPTURE_HASH_CHANGED'); return reference;
}
async function quiescence(config, state, label, image, mode = 'protected-runtime') {
  assertQuiescenceScope(mode, label, state);
  const result = await runtime.helper({ ...state, images: { ...state.images, api: image } }, ['node', '--input-type=module', '-e', QUIESCENCE_HELPER], {
    network: state.project + '_backend', env: [...helperEnv(await runtime.readSettings(state)), 'QUIESCENCE_SCOPE=' + mode] });
  await writePrivateJson(ownedFile(config, label + '.quiescence.private.json'), result);
  need(same(result, classifyQuiescence(result.counts, mode)) && result.status === 'PASS', 'B9_RUNNABLE_WORK_REFUSED'); return pin(ownedFile(config, label + '.quiescence.private.json'));
}
async function schemaOnly(config, state, label, image, database = 'wfc_pathfinder_local') {
  const result = await runtime.helper({ ...state, images: { ...state.images, api: image } }, ['node', '--input-type=module', '-e', SCHEMA_HELPER], {
    network: state.project + '_backend', env: [...helperEnv(await runtime.readSettings(state), database), 'EXPECTED_DATABASE=' + database, 'OWNER_ID=' + state.owner,
      ...(database !== 'wfc_pathfinder_local' ? ['PRISTINE_OPERATION=' + config.operationId] : [])] });
  await writePrivateJson(ownedFile(config, label + '.schema.private.json'), result);
  need(result.status === 'PASS' && result.database === database && result.scope === 'schema-only-no-runtime', 'B9_SCHEMA_FAILED');
  return pin(ownedFile(config, label + '.schema.private.json'));
}
async function stopApiWeb(state) {
  const docker = await createDocker(), resources = await runtime.ownership(state);
  const prior = resources.containers.filter(item => ['api', 'web'].includes(item.role));
  for (const item of prior) if (item.running) { await docker.stop(item.id, 125); const after = await docker.inspect(item.id);
    need(!after.State.Running && after.State.ExitCode === 0 && !after.State.OOMKilled, 'B9_UNCLEAN_STOP'); }
  return prior;
}
async function resumeServices(state, prior) {
  const docker = await createDocker();
  for (const role of ['api', 'web']) { const item = prior.find(value => value.role === role); if (!item?.running) continue;
    const actual = await docker.inspect(item.id); need(actual.Id === item.id && actual.Image === item.image && actual.Config.Labels['wfc.pathfinder.owner'] === state.owner, 'B9_RESUME_IDENTITY');
    if (!actual.State.Running) await docker.start(item.id); }
}
async function health(state, candidate) {
  const docker = await createDocker(), deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const resources = await runtime.ownership(state); let ready = true;
    for (const role of ['api', 'web']) { const value = resources.containers.find(item => item.role === role);
      if (!value?.running || value.image !== candidate[role] || (await docker.inspect(value.id)).State.Health?.Status !== 'healthy') ready = false; }
    if (ready) try { const response = await fetch('http://127.0.0.1:' + state.port + '/health', { redirect: 'error', signal: AbortSignal.timeout(3000) });
      const bytes = await response.text(); if (response.ok && bytes.length <= 4096 && JSON.parse(bytes).status === 'ok') return;
    } catch { /* Bounded health polling tolerates startup transport failures only. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  need(false, 'B9_HEALTH_FAILED');
}
async function createPristine(config, state) {
  const database = pristineDatabase(config.operationId), pg = (await runtime.ownership(state)).containers.find(item => item.role === 'postgres');
  need(pg?.running && state.port === 5192 && state.owner !== SOURCE.owner, 'B9_PRISTINE_TARGET_REQUIRED');
  await writePrivateJson(ownedFile(config, 'pristine.begin.private.json'), { database, pgId: pg.id, owner: state.owner, operationId: config.operationId });
  await command(['exec', pg.id, 'psql', '--no-password', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '-U', 'pf_local', '-d', 'postgres', '-c', 'CREATE DATABASE "' + database + '" OWNER pf_local']);
  await command(['exec', pg.id, 'psql', '--no-password', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '-U', 'pf_local', '-d', database, '-c',
    "CREATE SCHEMA pfb9_owner;CREATE TABLE pfb9_owner.owner(operation_id uuid PRIMARY KEY,owner_id uuid NOT NULL);INSERT INTO pfb9_owner.owner VALUES('" + config.operationId + "','" + state.owner + "')"]);
  return database;
}
function selectDeliveryPolicy(value) {
  const profile = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'profile')?.value : undefined;
  return profile === 'post-b20-terminal-closure-additive-v5' ? selectV5DeliveryPolicy(value) : selectV4DeliveryPolicy(value);
}
/** This same choice is used for first qualification and every later recheck.
 * Absence alone selects unchanged B9; a present invalid v4 binding is fatal. */
export async function qualificationModule(config) {
  const binding = assertConservationPolicy(config);
  if (!binding) return { module: await import('./migration-qualification.mjs'), qualifierSha256: (await pin(moduleFile('migration-qualification.mjs'))).sha256 };
  const selected = selectDeliveryPolicy(binding.selection);
  need(selected.qualifierFilename === path.basename(binding.qualifier.path)
    && same(await pin(binding.selector.path), binding.selector) && same(await pin(binding.qualifier.path), binding.qualifier), 'B9_CONSERVATION_POLICY_SOURCE_CHANGED');
  return { module: selected.qualifier, qualifierSha256: binding.qualifier.sha256 };
}
async function qualify(config, input, runtimeGate) {
  const { module, qualifierSha256 } = await qualificationModule(config);
  const request = { ...input, qualifierSha256, operationDirectory: config.directory };
  const result = await (runtimeGate ? module.qualifyRuntimeInventories(request) : module.qualifyMigrationInventories(request));
  await module.assertQualificationReceipt(result, request);
  await writePrivateJson(ownedFile(config, input.context.phase + '.qualification-input.private.json'), request);
  const filename = ownedFile(config, input.context.phase + '.qualification.private.json'); await writePrivateJson(filename, result);
  return pin(filename);
}
async function requalify(config, phase) {
  const { module, qualifierSha256 } = await qualificationModule(config), input = await read(ownedFile(config, phase + '.qualification-input.private.json'));
  need(input.operationDirectory === config.directory && input.context.operationId === config.operationId
    && input.context.phase === phase && input.qualifierSha256 === qualifierSha256, 'B9_QUALIFIER_SCOPE_CHANGED');
  const recorded = await read(ownedFile(config, phase + '.qualification.private.json'));
  module.assertQualificationReceipt(recorded, input);
  const actual = await (phase === 'target-migration' ? module.qualifyMigrationInventories(input) : module.qualifyRuntimeInventories(input));
  module.assertQualificationReceipt(actual, input); need(same(actual, recorded), 'B9_QUALIFICATION_CHANGED');
}
const capturePins = reference => [reference.manifest, reference.globals];
function runtimeWindow(phase, engineIdentitySha256, startedAt, stoppedAt) {
  need(Date.parse(stoppedAt) >= Date.parse(startedAt) && Date.parse(stoppedAt) - Date.parse(startedAt) <= 300000, 'B9_RUNTIME_WINDOW_EXCEEDED');
  return { schemaVersion: 'wfc.pf.b9.runtime-window.v1', mode: 'engine-observer-and-proven-expired-authority-only', phase, engineIdentitySha256, startedAt, stoppedAt };
}
async function sourceNoDrift(config, passes, state, candidate) {
  const before = passes.backup.result.before, after = await capture(config, state, 'source-before-update', candidate.api);
  const result = await compareCurrentInventories(before.directory, after.directory, { comparison: 'exact', beforeOwnerId: SOURCE.owner, afterOwnerId: SOURCE.owner });
  need(result.status === 'PASS' && same(await read(before.globals.path), await read(after.globals.path)), 'B9_SOURCE_DRIFT_NEW_BACKUP_REQUIRED');
  const artifacts = await runtime.artifactAudit(state); need(artifacts.status === 'PASS' && artifacts.sha256 === passes.backup.result.artifactsSha256, 'B9_SOURCE_ARTIFACT_DRIFT');
  const record = ownedFile(config, 'source-no-drift.private.json'); await writePrivateJson(record, { status: 'PASS', before, after, result, artifacts });
  return { capture: after, evidence: await pin(record) };
}
async function provider(config, postUpdateApiImage) {
  const outputRoot = ownedFile(config, 'raw-inventory-captures'); await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  return createRawInventoryProvider({ source: SOURCE, targetRuntime: config.targetRuntime, outputRoot,
    modulePath: ownedFile(config, 'qualified-losslessInventory.mjs'), sha256: config.inventory.sha256,
    apiImage: config.baseline.owned.containers.find(item => item.role === 'api').image, ...(postUpdateApiImage ? { postUpdateApiImage } : {}) });
}
async function observe(config, observation) {
  need(['backup-before-dump', 'restore-before-fence', 'restore-after-fence'].includes(observation.phase) && UUID.test(observation.backupId ?? ''), 'B9_OBSERVATION_INVALID');
  const state = await runtime.load(observation.runtime); observation.phase === 'backup-before-dump' ? assertSource(state) : assertTarget(config, state);
  need(same(observation, { schemaVersion: 'wfc.pf.cold-observation.v1', phase: observation.phase, backupId: observation.backupId,
    runtime: state.runtime, owner: state.owner, project: state.project, port: state.port, apiImage: state.images.api }), 'B9_OBSERVATION_IDENTITY');
  if (observation.phase !== 'backup-before-dump') need(observation.backupId === (await runtime.verifyBackup(config.backup)).manifest.backupId, 'B9_OBSERVATION_BACKUP_CHANGED');
  const owned = await runtime.ownership(state); need(!owned.containers.some(item => ['api', 'web'].includes(item.role) && item.running), 'B9_OBSERVATION_NOT_COLD');
  if (observation.phase === 'backup-before-dump') await quiescence(config, state, 'source-backup-cold', state.images.api, 'cold-backup');
  const reference = await capture(config, state, observation.phase, state.images.api);
  await writePrivateJson(ownedFile(config, observation.phase + '.capture.private.json'), reference);
  if (observation.phase === 'restore-before-fence' || observation.phase === 'restore-after-fence') {
    const beforePhase = observation.phase === 'restore-before-fence' ? 'backup-before-dump' : 'restore-before-fence';
    const before = await read(ownedFile(config, beforePhase + '.capture.private.json'));
    const result = await compareCurrentInventories(before.directory, reference.directory, { comparison: observation.phase === 'restore-before-fence' ? 'exact' : 'restore-fence',
      beforeOwnerId: before.ownerId, afterOwnerId: state.owner, ...(observation.phase === 'restore-after-fence' ? { targetId: state.owner } : {}) });
    need(result.status === 'PASS' && same(await read(before.globals.path), await read(reference.globals.path)), 'B9_RESTORE_OBSERVATION_CHANGED');
    await writePrivateJson(ownedFile(config, observation.phase + '.comparison.private.json'), result);
  }
}
async function buildContext() {
  const patterns = (await fs.readFile(path.join(ROOT, 'docker/pathfinder.Dockerfile.dockerignore'), 'utf8')).split(/\r?\n/).filter(Boolean);
  need(patterns.every(value => !/[!#?[\]\\]/.test(value) && !value.startsWith('/') && !value.endsWith('/')), 'B9_DOCKERIGNORE_REFUSED');
  const rules = patterns.map(value => { const anchored = value.includes('/') && !value.startsWith('**/');
    const body = (value.match(/\*\*\/|\*\*|\*|[^*]+/g) ?? []).map(token => token === '**/' ? '(?:.*/)?' : token === '**' ? '.*' : token === '*' ? '[^/]*' : token.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('');
    return new RegExp((anchored ? '^' : '(?:^|/)') + body + '$'); });
  const files = []; let total = 0;
  async function walk(directory, prefix = '') { for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix + entry.name; if (rules.some(rule => rule.test(relative))) continue;
    need(!entry.isSymbolicLink(), 'B9_BUILD_LINK_REFUSED');
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
    else { need(entry.isFile(), 'B9_BUILD_SPECIAL_REFUSED'); const record = await hashFile(path.join(directory, entry.name)); files.push({ path: relative, ...record }); total += record.bytes;
      need(files.length <= 30000 && total <= 8 * 1024 ** 3, 'B9_BUILD_CONTEXT_LIMIT'); }
  } }
  await walk(ROOT); return { files, bytes: total, sha256: digest(JSON.stringify(files)) };
}
export async function collectSourceClosure(seeds) {
  const pending = [...seeds], result = new Map();
  while (pending.length) {
    const filename = path.resolve(pending.shift());
    need(runtime.contained(ROOT, filename), 'B9_SOURCE_IMPORT_BOUNDARY');
    if (result.has(filename)) continue;
    const record = await pin(filename); need(record.bytes <= 4 * 1024 ** 2 && result.size < 128, 'B9_SOURCE_CLOSURE_LIMIT'); result.set(filename, record);
    if (!filename.endsWith('.mjs')) continue;
    const raw = await fs.readFile(filename, 'utf8');
    for (const match of raw.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(filename), match[1]);
      need(target.endsWith('.mjs'), 'B9_SOURCE_IMPORT_KIND'); pending.push(target);
    }
  }
  return [...result.values()].sort((a, b) => a.path.localeCompare(b.path));
}
async function initialize(directory, inventoryPath, expectedSha, conservationProfile) {
  const selected = conservationProfile === undefined ? null : selectDeliveryPolicy({ schemaVersion: 'wfc.pf.delivery-policy-selection.v1', profile: conservationProfile });
  const operationId = path.basename(directory).slice(-36);
  need(UUID.test(operationId) && path.dirname(directory) === SCRATCH && ['barrier-delivery-' + operationId, 'barrier-delivery-20261021-' + operationId].includes(path.basename(directory))
    && SHA.test(expectedSha ?? '') && path.isAbsolute(inventoryPath ?? '') && !await exists(directory), 'B9_FRESH_OPERATION_REQUIRED');
  if (selected) need(path.basename(directory) === 'barrier-delivery-' + operationId, 'B9_CONSERVATION_POLICY_OPERATION_REQUIRED');
  await assertCanonicalPath(SCRATCH, { directory: true }); await assertCanonicalPath(inventoryPath);
  const inventory = await pin(inventoryPath), raw = await fs.readFile(inventoryPath);
  need(inventory.sha256 === expectedSha && (await fs.stat(inventoryPath)).mtimeMs >= (await fs.stat(path.join(ROOT, 'server/operations/losslessInventory.ts'))).mtimeMs
    && !/\bfrom\s*['"](?!node:)/.test(raw.toString('utf8')), 'B9_FRESH_STANDALONE_INVENTORY_REQUIRED');
  await privateDirectory(directory); await writePrivateJson(path.join(directory, 'init.begin.private.json'), { operationId, phase: 'init', status: 'BEGIN', at: new Date().toISOString(),
    ...(selected ? { qualificationSelection: { schemaVersion: selected.schemaVersion, profile: selected.profile } } : {}) });
  const state = assertSource(await runtime.load(SOURCE.runtime)), settings = await runtime.readSettings(state), baseline = await snapshot(state);
  need(baseline.owned.containers.length === 5 && baseline.owned.volumes.length === 4 && baseline.owned.networks.length === 2, 'B9_SOURCE_INCOMPLETE');
  const shell = { directory }, originalState = await pin(path.join(state.runtime, 'runtime-state.json')), originalEnv = await pin(path.join(state.runtime, 'runtime.env'));
  await immutableCopy(shell, 'original.runtime-state.private.json', originalState.path); await immutableCopy(shell, 'original.runtime.env', originalEnv.path);
  await fs.writeFile(path.join(directory, 'qualified-losslessInventory.mjs'), raw, { flag: 'wx', mode: 0o600 });
  const sourceClosure = await collectSourceClosure(['scripts/pathfinder-barriers/owned-update-v3.mjs', 'scripts/pathfinder-barriers/owned-update-v3-runtime.mjs',
    'scripts/pathfinder-barriers/migration-qualification.mjs', 'scripts/pathfinder-barriers/global-sql-v2.mjs', 'scripts/pathfinder-local/runtime-lib.mjs',
    'scripts/pathfinder-cable-workflow/owned-update-v2.mjs', 'scripts/pathfinder-cable-workflow/raw-inventory-provider.mjs',
    'scripts/pathfinder-copied-recovery/current-inventory-lib.mjs', 'scripts/operations/docker.mjs', 'scripts/operations/docker-bounds.mjs',
    'scripts/operations/archives.mjs', 'scripts/operations/restore-fencing.mjs', 'server/operations/losslessInventory.ts',
    'docker/pathfinder.compose.yml', 'docker/pathfinder.Dockerfile', 'docker/pathfinder.Dockerfile.dockerignore', 'docker/pathfinder.nginx.conf'].map(name => path.join(ROOT, name)));
  const qualificationPolicy = selected ? { schemaVersion: 'wfc.pf.owned-update-policy-binding.v1',
    selection: { schemaVersion: selected.schemaVersion, profile: selected.profile },
    selector: await pin(moduleFile(selected.profile === 'post-b20-terminal-closure-additive-v5' ? 'delivery-policy-selector-v5.mjs' : 'delivery-policy-selector-v4.mjs')), qualifier: await pin(moduleFile(selected.qualifierFilename)) } : null;
  const config = { schemaVersion: 'wfc.pf.owned-update.v3', operationId, directory, source: SOURCE, baseline, settings, originalState, originalEnv,
    operatorSha256: (await pin(moduleFile('owned-update-v3.mjs'))).sha256, sourceClosure, buildContext: await buildContext(), inventory,
    backup: path.join(directory, 'backup'), companion: path.join(directory, 'backup-companion.private.json'), targetRuntime: path.join(directory, 'restore-5192'),
    ...(qualificationPolicy ? { qualificationPolicy } : {}) };
  assertOperation(config, directory); await writePrivateJson(path.join(directory, 'operation.private.json'), config);
  await fs.writeFile(path.join(directory, 'operation.sha256'), (await pin(path.join(directory, 'operation.private.json'))).sha256 + '\n', { flag: 'wx', mode: 0o600 });
  await writePrivateJson(path.join(directory, 'init.pass.private.json'), { schemaVersion: 'wfc.pf.owned-update-phase.v3', operationId, phase: 'init', status: 'PASS', prerequisites: [],
    result: { status: 'PASS', evidence: [await pin(path.join(directory, 'original.runtime-state.private.json')), await pin(path.join(directory, 'original.runtime.env'))],
      ...(qualificationPolicy ? { qualificationPolicy } : {}) } });
  return { status: 'PASS', operationId, phase: 'init', next: 'backup' };
}
async function buildChild(config) {
  need(await exists(ownedFile(config, 'candidate-build.begin.private.json')) && await exists(ownedFile(config, 'phase.lock')) && !await exists(ownedFile(config, 'candidate-build.result.private.json')), 'B9_BUILD_BEGIN_REQUIRED');
  await claimBuildChild(config);
  return withBoundedDockerExecution(BOUNDS, async () => {
    need(same(await buildContext(), config.buildContext), 'B9_BUILD_CONTEXT_CHANGED');
    const state = assertTarget(config, await runtime.load(config.targetRuntime)); await sourceConserved(config, { target: state });
    const result = await runtime.build(state); need(same(await buildContext(), config.buildContext), 'B9_BUILD_CONTEXT_CHANGED');
    const engine = await runtime.helper(state, ['node', '--input-type=module', '-e',
      "const {barrierCalculationEngineIdentity}=await import('/app/server/dist/server/pathfinder/calculationEngineIdentity.js');const result=await barrierCalculationEngineIdentity();console.log(JSON.stringify({status:'PASS',identity:result}));"],
    { env: ['PF_ENGINE_DLL=/opt/pathfinder/PathFinder.ModelRunner.dll'] });
    need(engine.status === 'PASS' && SHA.test(engine.identity?.contentSha256 ?? ''), 'B9_ENGINE_IDENTITY');
    await writePrivateJson(ownedFile(config, 'candidate-build.result.private.json'), { status: 'PASS', candidate: result.images, engineIdentitySha256: engine.identity.contentSha256,
      target: { owner: state.owner, project: state.project, runtime: state.runtime, port: state.port }, state: await pin(path.join(state.runtime, 'runtime-state.json')), env: await pin(path.join(state.runtime, 'runtime.env')),
      stateCopy: await immutableCopy(config, 'candidate.runtime-state.private.json', path.join(state.runtime, 'runtime-state.json')),
      envCopy: await immutableCopy(config, 'candidate.runtime.env', path.join(state.runtime, 'runtime.env')) });
    return { status: 'PASS' };
  });
}
async function supervisedBuild(config) {
  const output = await fs.open(ownedFile(config, 'candidate-build.supervisor.private.log'), 'wx', 0o600);
  let timeout, monitor, child, uncertain = false, checking = false;
  try {
    child = spawn(process.execPath, [moduleFile('owned-update-v3.mjs'), '__candidate-build', '--operation', config.directory], { cwd: ROOT, windowsHide: true, stdio: ['ignore', output.fd, output.fd] });
    let resolveDeadline;
    const deadline = new Promise(resolve => { resolveDeadline = resolve; });
    const interrupt = () => { if (uncertain) return; uncertain = true;
      if (process.platform === 'win32') { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => {}); }
      else child.kill('SIGKILL');
      setTimeout(() => resolveDeadline({ code: null, signal: 'UNCONFIRMED' }), 15000).unref();
    };
    const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    timeout = setTimeout(interrupt, 2700000);
    monitor = setInterval(() => { if (checking) return; checking = true;
      void (async () => { let size = (await output.stat()).size;
        for (const name of await fs.readdir(config.targetRuntime)) if (/^build-[a-z0-9]+-(api|web)\.log$/.test(name)) size += (await fs.stat(path.join(config.targetRuntime, name))).size;
        if (size > 64 * 1024 ** 2) interrupt(); })().catch(interrupt).finally(() => { checking = false; });
    }, 1000);
    const result = await Promise.race([ended, deadline]); if (uncertain) child.unref();
    need(!uncertain && result.code === 0 && result.signal === null, 'B9_BUILD_UNCONFIRMED_INSPECT_REQUIRED');
    return await read(ownedFile(config, 'candidate-build.result.private.json'));
  } finally { clearTimeout(timeout); clearInterval(monitor); await output.close(); }
}
async function execute(phase, config, passes) {
  if (phase === 'candidate-build') { const value = await supervisedBuild(config); return { ...value, evidence: [await pin(ownedFile(config, 'candidate-build.result.private.json')), value.stateCopy, value.envCopy] }; }
  return withBoundedDockerExecution(BOUNDS, async () => {
    if (phase === 'backup') {
      const { state } = await sourceConserved(config); await quiescence(config, state, 'source-backup', state.images.api, 'cold-backup');
      const verified = await runtime.backup(state, config.backup, config.companion, { observeCold: value => observe(config, value), inventoryProvider: await provider(config) });
      await sourceConserved(config);
      return { status: 'PASS', backupId: verified.manifest.backupId, artifactsSha256: verified.manifest.artifacts.sha256,
        before: await read(ownedFile(config, 'backup-before-dump.capture.private.json')),
        evidence: [await pin(path.join(config.backup, 'manifest.json')), await pin(path.join(config.backup, 'complete.json')), await pin(config.companion)] };
    }
    const backup = await runtime.verifyBackup(config.backup); need(backup.manifest.backupId === passes.backup.result.backupId, 'B9_BACKUP_CHANGED');
    if (phase === 'restore-quarantine') {
      await sourceConserved(config);
      const result = await runtime.restore({ backup: config.backup, privateConfig: config.companion, runtime: config.targetRuntime, port: 5192, activate: false,
        observeCold: value => observe(config, value), inventoryProvider: await provider(config) });
      const state = assertTarget(config, await runtime.load(config.targetRuntime)), resources = await runtime.ownership(state);
      need(result.activated === false && !resources.containers.some(item => ['api', 'web'].includes(item.role)), 'B9_RESTORE_NOT_QUARANTINED');
      await sourceConserved(config, { target: state });
      return { status: 'PASS', target: { owner: state.owner, project: state.project, runtime: state.runtime, port: 5192 },
        evidence: [await immutableCopy(config, 'restored.runtime-state.private.json', path.join(state.runtime, 'runtime-state.json')),
          await immutableCopy(config, 'restored.runtime.env', path.join(state.runtime, 'runtime.env')), await pin(path.join(state.runtime, 'restore-fencing.json'))] };
    }
    const target = await targetState(config, passes), built = passes['candidate-build'].result, candidate = built.candidate;
    need(same(target.images, candidate) && same(await pin(path.join(target.runtime, 'runtime-state.json')), built.state)
      && same(await pin(path.join(target.runtime, 'runtime.env')), built.env), 'B9_QUALIFIED_TARGET_IMAGE_STATE_CHANGED');
    const context = selectedPhase => safeContext(config, selectedPhase, target, backup.manifest.backupId, candidate, built.engineIdentitySha256);
    if (phase === 'target-migration') {
      await sourceConserved(config, { target }); await quiescence(config, target, 'target-migration', candidate.api);
      const before = await capture(config, target, 'target-before-migration', candidate.api), database = await createPristine(config, target);
      const pristineSchema = await schemaOnly(config, target, 'pristine', candidate.api, database), pristine = await capture(config, target, 'pristine-final-schema', candidate.api, database);
      const first = await schemaOnly(config, target, 'target-migration-first', candidate.api), after = await capture(config, target, 'target-after-migration', candidate.api);
      const qualification = await qualify(config, { context: context(phase), before, after, pristine }, false);
      const second = await schemaOnly(config, target, 'target-migration-second', candidate.api), idempotent = await capture(config, target, 'target-after-idempotence', candidate.api);
      const exact = await compareCurrentInventories(after.directory, idempotent.directory, { comparison: 'exact', beforeOwnerId: target.owner, afterOwnerId: target.owner });
      need(exact.status === 'PASS' && same(await read(after.globals.path), await read(idempotent.globals.path)), 'B9_MIGRATION_NOT_IDEMPOTENT');
      await sourceConserved(config, { target });
      return { status: 'PASS', candidate, before, after: idempotent, pristine, qualification, evidence: [qualification,
        await pin(ownedFile(config, phase + '.qualification-input.private.json')), pristineSchema, first, second,
        ...capturePins(before), ...capturePins(after), ...capturePins(idempotent), ...capturePins(pristine)] };
    }
    if (phase === 'target-runtime') {
      await sourceConserved(config, { target }); const quiet = await quiescence(config, target, 'target-runtime', candidate.api);
      const before = await capture(config, target, 'target-before-runtime', candidate.api);
      let after, stoppedAt; const startedAt = new Date().toISOString();
      try { await command([...runtime.composeArgs(target), 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'api', 'web']); await health(target, candidate); }
      finally { await stopApiWeb(target); stoppedAt = new Date().toISOString(); after = await capture(config, target, 'target-after-runtime', candidate.api); }
      const policy = runtimeWindow(phase, built.engineIdentitySha256, startedAt, stoppedAt);
      const qualification = await qualify(config, { context: context(phase), before, after, pristine: passes['target-migration'].result.pristine, policy }, true);
      await sourceConserved(config, { target }); return { status: 'PASS', candidate, before, after, policy, qualification,
        evidence: [quiet, qualification, await pin(ownedFile(config, phase + '.qualification-input.private.json')), ...capturePins(before), ...capturePins(after)] };
    }
    if (phase === 'update-source') {
      await requalify(config, 'target-migration'); await requalify(config, 'target-runtime');
      const { state } = await sourceConserved(config, { target }), prior = await stopApiWeb(state); let installed = false;
      try {
        await sourceConserved(config, { target, stopped: true }); const quiet = await quiescence(config, state, 'source-before-update', candidate.api);
        const conserved = await sourceNoDrift(config, passes, state, candidate);
        const intent = { operationId: config.operationId, source: SOURCE, candidate, expectedStateSha256: (await pin(path.join(state.runtime, 'runtime-state.json'))).sha256,
          expectedEnvSha256: (await pin(path.join(state.runtime, 'runtime.env'))).sha256,
          expectedCandidateStateSha256: built.state.sha256, expectedCandidateEnvSha256: built.env.sha256, target: built.target };
        await writePrivateJson(ownedFile(config, 'source-image-install.begin.private.json'), intent);
        const result = await runtime.installRuntimeImages(state, { expectedStateSha256: intent.expectedStateSha256, expectedEnvSha256: intent.expectedEnvSha256,
          expectedCandidateStateSha256: intent.expectedCandidateStateSha256, expectedCandidateEnvSha256: intent.expectedCandidateEnvSha256,
          images: candidate, candidate: built.target, operationId: config.operationId });
        installed = true; await writePrivateJson(ownedFile(config, 'source-image-install.result.private.json'), result);
        const installedState = assertSource(await runtime.load(SOURCE.runtime)), startedAt = new Date().toISOString(); let stoppedAt;
        try { await command([...runtime.composeArgs(installedState), 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'api', 'web']); await health(installedState, candidate); }
        finally { await stopApiWeb(installedState); stoppedAt = new Date().toISOString(); }
        const policy = runtimeWindow('source-runtime', built.engineIdentitySha256, startedAt, stoppedAt);
        const after = await capture(config, installedState, 'source-after-runtime', candidate.api);
        await sourceConserved(config, { target, updated: true });
        return { status: 'PASS', candidate, before: conserved.capture, after, policy,
          evidence: [quiet, conserved.evidence, ...capturePins(conserved.capture), ...capturePins(after), await pin(ownedFile(config, 'source-image-install.begin.private.json')),
            await pin(ownedFile(config, 'source-image-install.result.private.json'))] };
      } finally { if (!installed) {
        // A partially installed env/state pair is uncertain; never restart old services against it.
        if ((await pin(path.join(state.runtime, 'runtime-state.json'))).sha256 === config.originalState.sha256
          && (await pin(path.join(state.runtime, 'runtime.env'))).sha256 === config.originalEnv.sha256) await resumeServices(state, prior);
      } }
    }
    if (phase === 'source-runtime') {
      const { state } = await sourceConserved(config, { target, updated: true });
      need(!(await runtime.ownership(state)).containers.some(item => ['api', 'web'].includes(item.role) && item.running), 'B9_SOURCE_QUALIFICATION_NOT_COLD');
      const after = await capture(config, state, 'source-qualification-cold', candidate.api), frozen = passes['update-source'].result.after;
      const unchanged = await compareCurrentInventories(frozen.directory, after.directory, { comparison: 'exact', beforeOwnerId: state.owner, afterOwnerId: state.owner });
      need(unchanged.status === 'PASS' && same(await read(frozen.globals.path), await read(after.globals.path)), 'B9_SOURCE_CHANGED_DURING_QUARANTINE');
        const qualification = await qualify(config, { context: safeContext(config, phase, state, backup.manifest.backupId, candidate, built.engineIdentitySha256),
          before: passes['update-source'].result.before, after: frozen, pristine: passes['target-migration'].result.pristine, policy: passes['update-source'].result.policy }, true);
        const artifacts = await runtime.artifactAudit({ ...state, images: { ...state.images, api: config.baseline.owned.containers.find(item => item.role === 'api').image } });
        need(artifacts.status === 'PASS' && artifacts.sha256 === passes.backup.result.artifactsSha256, 'B9_SOURCE_ARTIFACT_CHANGED');
        await command([...runtime.composeArgs(state), 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'api', 'web']); await health(state, candidate);
        await sourceConserved(config, { target, updated: true });
        return { status: 'PASS', candidate, after, qualification,
          evidence: [qualification, await pin(ownedFile(config, phase + '.qualification-input.private.json')), ...capturePins(after)] };
    }
    if (phase === 'retire-target') {
      await sourceConserved(config, { target, updated: true });
      need(target.restore?.fencingValidated === true && target.owner === built.target.owner, 'B9_VERIFIED_RETIRE_TARGET_REQUIRED');
      const result = await runtime.retire(target); need(!result.resources.containers.length && !result.resources.volumes.length && !result.resources.networks.length, 'B9_RETIRE_NOT_CONFIRMED');
      await sourceConserved(config, { updated: true }); return { status: 'PASS', evidence: [], target: built.target, retirement: result };
    }
    need(false, 'B9_PHASE_INVALID');
  });
}
export function createConcreteRuntime() {
  return { initialize: (...args) => withBoundedDockerExecution(BOUNDS, () => initialize(...args)), execute, buildChild };
}
