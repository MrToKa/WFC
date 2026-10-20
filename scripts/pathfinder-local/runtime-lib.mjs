import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDocker, command, jsonCommand, writePrivateJson } from '../operations/docker.mjs';
import { assertCanonicalPath, hashFile } from '../operations/archives.mjs';
import { verifyImageArchive } from '../operations/manifest.mjs';
import { validateRestoreFencing, validateRestoredInventory, validateInventoryEnvelope } from '../operations/restore-fencing.mjs';
import {createProducerProfile,assertProducerContainer} from '../pathfinder-background/container-profile.mjs';
import { assertProducerEnvironment } from './producer-environment.mjs';
import {localCapacityProfile,assertCapacityEnvironment,capacityProfileTransition,LEGACY_CAPACITY_PROFILE} from './capacity-environment.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_RUNTIME = path.join(ROOT, 'pathfinder-engine/.scratch/pathfinder-local');
const PROJECT = /^wfc-pathfinder-local(?:-[a-f0-9]{12})?$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const ROLES = ['postgres', 'minio', 'storage-ready', 'api', 'web'];
const VOLUMES = ['postgres', 'minio', 'staging', 'pathfinder'];
const COMPOSE = path.join(ROOT, 'docker/pathfinder.compose.yml');
const DOCKERFILE = path.join(ROOT, 'docker/pathfinder.Dockerfile');
const PUBLIC_PACKAGE = { bytes: 439112840, sha256: 'e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922', fingerprint: 'b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34' };
export const fail = code => { throw Object.assign(Error(code), { code }); };
const canonical = value => JSON.stringify(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mount = (source, target, readOnly = true, type = 'bind') => ({ Type: type, Source: source, Target: target, ReadOnly: readOnly });
const labels = state => ({ 'wfc.pathfinder.owner': state.owner, 'wfc.pathfinder.project': state.project, 'wfc.pathfinder.isolated': 'true' });
const owned = (value, state) => Object.entries(labels(state)).every(([key, expected]) => value?.[key] === expected);
export function contained(parent, target) { const relative = path.relative(path.resolve(parent), path.resolve(target)); return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
export function validProject(project) { if (!PROJECT.test(project ?? '')) fail('PF_PROJECT_INVALID'); return project; }
export function claimsProject(item, state) {
  return item.Config?.Labels?.['com.docker.compose.project'] === state.project || item.Config?.Labels?.['wfc.pathfinder.project'] === state.project || ROLES.some(role => item.Name === `/${state.project}-${role}-1`);
}
const portValue = port => { port = Number(port); if (!Number.isInteger(port) || port < 1024 || port > 65535 || [5180, 8082, 8083, 9000, 9001, 5434].includes(port)) fail('PF_PORT_INVALID'); return port; };
export function validateState(state, runtime) {
  if (!state || state.format !== 'WFC-PF-LOCAL' || state.schemaVersion !== 1 || !UUID.test(state.owner ?? '') || !PROJECT.test(state.project ?? '') || state.root !== ROOT || state.runtime !== path.resolve(runtime) || !contained(path.join(ROOT, 'pathfinder-engine/.scratch'), state.runtime)) fail('PF_OWNED_RUNTIME_REQUIRED');
  portValue(state.port);
  for (const role of ['api', 'web']) if (!new RegExp(`^wfc-pathfinder-${role}:${state.owner.replaceAll('-', '').slice(0, 12)}-[a-z0-9-]+$`).test(state.tags?.[role] ?? '')) fail('PF_IMAGE_TAG_INVALID');
  if (!SHA.test(state.envSha256 ?? '')) fail('PF_ENV_IDENTITY_MISSING');
  return state;
}
async function safeNew(directory) {
  await assertCanonicalPath(path.dirname(directory), { directory: true });
  try { await fs.lstat(directory); fail('PF_TARGET_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(directory, { mode: 0o700 });
}
async function privateFile(filename, bytes) {
  const handle = await fs.open(filename, 'wx', 0o600); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  if (process.platform === 'win32') await new Promise((resolve, reject) => {
    const child = spawn('icacls', [filename, '/inheritance:r', '/grant:r', process.env.USERDOMAIN + '\\' + process.env.USERNAME + ':(R,W)'], { windowsHide: true, stdio: 'ignore' });
    child.once('error', () => reject(Error('PF_PRIVATE_ACL_FAILED'))); child.once('exit', code => code === 0 ? resolve() : reject(Error('PF_PRIVATE_ACL_FAILED')));
  });
}
const stateFile = state => path.join(state.runtime, 'runtime-state.json');
export async function save(state) { validateState(state, state.runtime); await fs.writeFile(stateFile(state), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); }
function envText(state, settings) {
  const values = { PF_PROJECT: state.project, PF_OWNER: state.owner, PF_HTTP_PORT: state.port, PF_API_IMAGE: settings.apiImage ?? state.tags.api, PF_WEB_IMAGE: settings.webImage ?? state.tags.web, PF_POSTGRES_IMAGE: settings.postgresImage ?? 'postgres:18@sha256:9a2e0383c38afd52cff14eeefe2b806fcde406b317002cd13ce513d309942751', PF_MINIO_IMAGE: settings.minioImage ?? 'minio/minio:latest@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e', PF_DATABASE_PASSWORD: settings.databasePassword, PF_STORAGE_PASSWORD: settings.storagePassword, PF_JWT_SECRET: settings.jwtSecret };
  if(settings.capacityProfile!==undefined)values.PF_PREPARATION_CAPACITY_PROFILE=localCapacityProfile(settings.capacityProfile);
  if(settings.producer){
    const p=settings.producer;
    if(!SHA.test(p.key??'')||p.owner!==state.owner||p.project!==state.project||!/^sha256:[a-f0-9]{64}$/.test(p.image??'')||!SHA.test(p.runtimeInventorySha256??'')||p.expectedSha256!==undefined&&!SHA.test(p.expectedSha256)||p.qualifyProject!==undefined&&!UUID.test(p.qualifyProject))fail('PF_PRODUCER_CONFIG_INVALID');
    Object.assign(values,{PF_PRODUCER_CONTROL_KEY:p.key,PF_PRODUCER_OWNER:p.owner,PF_PRODUCER_PROJECT:p.project,PF_PRODUCER_IMAGE:p.image,PF_PRODUCER_RUNTIME_SHA256:p.runtimeInventorySha256,
      ...(p.expectedSha256?{PF_PRODUCER_QUALIFICATION_SHA256:p.expectedSha256}:{}),...(p.qualifyProject?{PF_PRODUCER_QUALIFY_PROJECT:p.qualifyProject}:{})});
  }
  if (Object.values(values).some(value => typeof value !== 'number' && (typeof value !== 'string' || !/^[A-Za-z0-9:/@._-]+$/.test(value)))) fail('PF_PRIVATE_CONFIG_INVALID');
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
}
async function writeEnv(state, settings, { replace = false } = {}) {
  const filename = path.join(state.runtime, 'runtime.env'), text = envText(state, settings);
  if (replace) {
    const temp = path.join(state.runtime, `runtime-${randomUUID()}.env`); await privateFile(temp, text); await fs.rename(temp, filename);
  } else await privateFile(filename, text);
  state.envSha256 = digest(text); state.settings = undefined;
}
export async function readSettings(state) {
  const raw = await fs.readFile(path.join(state.runtime, 'runtime.env'), 'utf8'); if (digest(raw) !== state.envSha256) fail('PF_PRIVATE_ENV_CHANGED');
  const env = Object.fromEntries(raw.trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
  const settings = { databasePassword: env.PF_DATABASE_PASSWORD, storagePassword: env.PF_STORAGE_PASSWORD, jwtSecret: env.PF_JWT_SECRET, apiImage: env.PF_API_IMAGE, webImage: env.PF_WEB_IMAGE, postgresImage: env.PF_POSTGRES_IMAGE, minioImage: env.PF_MINIO_IMAGE };
  if(Object.hasOwn(env,'PF_PREPARATION_CAPACITY_PROFILE'))settings.capacityProfile=localCapacityProfile(env.PF_PREPARATION_CAPACITY_PROFILE);
  if(env.PF_PRODUCER_CONTROL_KEY)settings.producer={key:env.PF_PRODUCER_CONTROL_KEY,owner:env.PF_PRODUCER_OWNER,project:env.PF_PRODUCER_PROJECT,image:env.PF_PRODUCER_IMAGE,runtimeInventorySha256:env.PF_PRODUCER_RUNTIME_SHA256,
    ...(env.PF_PRODUCER_QUALIFICATION_SHA256?{expectedSha256:env.PF_PRODUCER_QUALIFICATION_SHA256}:{}),...(env.PF_PRODUCER_QUALIFY_PROJECT?{qualifyProject:env.PF_PRODUCER_QUALIFY_PROJECT}:{})};
  if (envText(state, settings) !== raw) fail('PF_PRIVATE_ENV_INVALID'); return settings;
}
/** Explicit local-only configuration; restores start with no host credential or qualification. */
export async function configureManagedProducer(state,producer){
  validateState(state,state.runtime);await configuration(state);await ownership(state);
  const settings=await readSettings(state);await writeEnv(state,{...settings,producer:producer??undefined},{replace:true});await save(state);
  return{configured:Boolean(producer),owner:state.owner,project:state.project};
}
/** Explicit local trial selection; legacy env files and default remain unchanged. */
export async function configurePreparationCapacityProfile(state,profile){
  const selected=localCapacityProfile(profile);validateState(state,state.runtime);await configuration(state);const resources=await ownership(state);
  const settings=await readSettings(state),transition=capacityProfileTransition(settings.capacityProfile,selected,resources.containers.some(item=>item.role==='api'));
  if(!transition.changed)return{profile:selected,owner:state.owner,project:state.project};
  await writeEnv(state,{...settings,capacityProfile:selected===LEGACY_CAPACITY_PROFILE?undefined:selected},{replace:true});await save(state);
  return{profile:selected,owner:state.owner,project:state.project};
}
export async function load(runtime = DEFAULT_RUNTIME) {
  const location = path.resolve(runtime); await assertCanonicalPath(location, { directory: true });
  const file = path.join(location, 'runtime-state.json'); await assertCanonicalPath(file);
  const raw = await fs.readFile(file); if (raw.length > 1024 ** 2) fail('PF_STATE_LIMIT');
  const state = validateState(JSON.parse(raw), location); await readSettings(state); return state;
}
export async function init({ runtime = DEFAULT_RUNTIME, project = 'wfc-pathfinder-local', port = 5190 } = {}) {
  const location = path.resolve(runtime); if (!contained(path.join(ROOT, 'pathfinder-engine/.scratch'), location)) fail('PF_RUNTIME_OUTSIDE_SCRATCH');
  validProject(project); portValue(port);
  await fs.mkdir(path.dirname(location), { recursive: true }); await safeNew(location);
  const owner = randomUUID(), token = owner.replaceAll('-', '').slice(0, 12);
  const state = { format: 'WFC-PF-LOCAL', schemaVersion: 1, owner, project, root: ROOT, runtime: location, port: Number(port), createdAt: new Date().toISOString(), tags: { api: `wfc-pathfinder-api:${token}-initial`, web: `wfc-pathfinder-web:${token}-initial` }, status: 'initialized' };
  await writeEnv(state, { databasePassword: randomBytes(32).toString('hex'), storagePassword: randomBytes(32).toString('hex'), jwtSecret: randomBytes(64).toString('hex') });
  await save(state); return state;
}
export const composeArgs = state => ['compose', '--env-file', path.join(state.runtime, 'runtime.env'), '--project-name', state.project, '--file', COMPOSE];
export async function configuration(state) {
  const settings = await readSettings(state);
  const value = JSON.parse((await command([...composeArgs(state), 'config', '--format', 'json'])).toString());
  if (value.name !== state.project || Object.keys(value.services).sort().join() !== [...ROLES].sort().join() || Object.keys(value.volumes).sort().join() !== [...VOLUMES].sort().join() || Object.keys(value.networks).sort().join() !== 'backend,front') fail('PF_COMPOSE_PROFILE_CHANGED');
  for (const [role, service] of Object.entries(value.services)) {
    if (!owned(service.labels, state) || service.container_name || service.build || service.network_mode || service.privileged || service.devices || service.volumes?.some(item => item.type !== 'volume' || !VOLUMES.includes(item.source))) fail('PF_COMPOSE_UNSAFE_SERVICE');
    const ports = service.ports ?? [];
    if (role === 'web' ? ports.length !== 1 || ports[0].host_ip !== '127.0.0.1' || Number(ports[0].published) !== state.port || ports[0].target !== 80 : ports.length !== 0) fail('PF_COMPOSE_PORT_UNSAFE');
    if (role !== 'web' && Object.keys(service.networks).join() !== 'backend' || role === 'web' && Object.keys(service.networks).sort().join() !== 'backend,front') fail('PF_COMPOSE_NETWORK_UNSAFE');
  }
  for (const [name, network] of Object.entries(value.networks)) if (network.external || !owned(network.labels, state) || network.name !== `${state.project}_${name}` || Boolean(network.internal) !== (name === 'backend')) fail('PF_COMPOSE_NETWORK_UNSAFE');
  for (const [name, volume] of Object.entries(value.volumes)) if (volume.external || !owned(volume.labels, state) || volume.name !== `${state.project}_${name}` || volume.driver_opts) fail('PF_COMPOSE_VOLUME_UNSAFE');
  const env = value.services.api.environment;
  assertProducerEnvironment(env, settings.producer);
  assertCapacityEnvironment(env,settings.capacityProfile);
  if (!/^postgresql:\/\/pf_local:[a-f0-9]{64}@postgres:5432\/wfc_pathfinder_local$/.test(env.DATABASE_URL ?? '') || env.MINIO_ENDPOINT !== 'minio' || env.PF_ROOT !== '/var/lib/wfc/pathfinder' || env.PF_ENGINE_DLL !== '/opt/pathfinder/PathFinder.ModelRunner.dll') fail('PF_COMPOSE_ENDPOINT_UNSAFE');
  if (Number(value.services.api.mem_limit) !== 4 * 1024 ** 3 || value.services.api.pids_limit !== 256 || env.NODE_OPTIONS !== '--max-old-space-size=1536' || Number(value.services.postgres.mem_limit) !== 1024 ** 3 || Number(value.services.minio.mem_limit) !== 1024 ** 3 || Number(value.services.web.mem_limit) !== 256 * 1024 ** 2) fail('PF_RESOURCE_CEILINGS_CHANGED');
  return { status: 'PASS', project: state.project, origin: `http://127.0.0.1:${state.port}`, services: ROLES, volumes: VOLUMES, privateBackend: true, publishedPorts: [state.port] };
}
export async function ownership(state, { fresh = false } = {}) {
  const docker = await createDocker(), found = { containers: [], volumes: [], networks: [] }, settings = await readSettings(state);
  for (const item of await docker.containers()) {
    if (!claimsProject(item, state)) continue;
    // A separately owned network-none helper is not a Compose service. Ignore
    // it only after its complete immutable factory profile has been verified.
    if(settings.producer&&item.Config?.Labels?.['wfc.pathfinder.role']==='managed-producer'&&!item.Config.Labels['com.docker.compose.project']){
      const seccompBytes=await fs.readFile(path.join(ROOT,'docker/pathfinder-producer/seccomp-default.json')),
        profile=createProducerProfile({owner:state.owner,project:state.project,attemptId:item.Config.Labels['wfc.pathfinder.producer.attempt'],image:settings.producer.image,mode:'run',defaultSeccompBytes:seccompBytes,defaultSeccompSha256:'6416b47770785a41ac59073cdc77d9fe98517df2799dc83ef207e622de3053f6'});
      assertProducerContainer(profile,item);continue;
    }
    if (!owned(item.Config.Labels, state) || !ROLES.includes(item.Config.Labels['com.docker.compose.service']) || item.Config.Labels['com.docker.compose.project'] !== state.project) fail('PF_FOREIGN_CONTAINER_REFUSED');
    const role = item.Config.Labels['com.docker.compose.service'];
    if (item.Name !== `/${state.project}-${role}-1` || found.containers.some(value => value.role === role)) fail('PF_CONTAINER_IDENTITY_REFUSED');
    if (item.Mounts.some(entry => entry.Type !== 'volume' || !VOLUMES.some(name => entry.Name === state.project + '_' + name))) fail('PF_FOREIGN_MOUNT_REFUSED');
    if (Object.keys(item.NetworkSettings.Networks).some(name => !['backend', 'front'].some(part => name === state.project + '_' + part))) fail('PF_FOREIGN_NETWORK_REFUSED');
    const expectedMounts = { postgres: [['postgres', '/var/lib/postgresql']], minio: [['minio', '/data']], api: [['staging', '/var/lib/wfc/model-imports'], ['pathfinder', '/var/lib/wfc/pathfinder']], web: [], 'storage-ready': [] }[role];
    if (item.Mounts.length !== expectedMounts.length || expectedMounts.some(([name, destination]) => !item.Mounts.some(value => value.Name === state.project + '_' + name && value.Destination === destination && value.RW))) fail('PF_MOUNT_BINDING_CHANGED');
    const env = Object.fromEntries(item.Config.Env.map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
    if (role === 'api') assertProducerEnvironment(item.Config.Env, settings.producer);
    if (role === 'api') assertCapacityEnvironment(item.Config.Env,settings.capacityProfile);
    if (role === 'api' && (env.DATABASE_URL !== `postgresql://pf_local:${settings.databasePassword}@postgres:5432/wfc_pathfinder_local` || env.MINIO_ENDPOINT !== 'minio' || env.MINIO_SECRET_KEY !== settings.storagePassword || env.PF_ROOT !== '/var/lib/wfc/pathfinder')) fail('PF_ENDPOINT_BINDING_CHANGED');
    const ports = Object.values(item.HostConfig.PortBindings ?? {}).flat();
    if (role === 'web' ? ports.length !== 1 || ports[0].HostIp !== '127.0.0.1' || Number(ports[0].HostPort) !== state.port : ports.length !== 0) fail('PF_CONTAINER_PORT_CHANGED');
    found.containers.push({ role, id: item.Id, image: item.Image, name: item.Name.slice(1), running: item.State.Running, startedAt: item.State.StartedAt });
  }
  for (const name of VOLUMES) {
    const candidates = (await command(['volume', 'ls', '--quiet', '--filter', `name=^${state.project}_${name}$`])).toString().trim();
    if (!candidates) continue; const value = (await jsonCommand(['volume', 'inspect', `${state.project}_${name}`]))[0];
    if (value.Name !== `${state.project}_${name}` || !owned(value.Labels, state)) fail('PF_FOREIGN_VOLUME_REFUSED'); found.volumes.push(value.Name);
  }
  for (const name of ['front', 'backend']) {
    const candidates = (await command(['network', 'ls', '--quiet', '--filter', `name=^${state.project}_${name}$`])).toString().trim();
    if (!candidates) continue; const value = (await jsonCommand(['network', 'inspect', `${state.project}_${name}`]))[0];
    if (value.Name !== `${state.project}_${name}` || !owned(value.Labels, state) || Boolean(value.Internal) !== (name === 'backend') || Object.keys(value.Containers ?? {}).some(id => !found.containers.some(item => item.id === id))) fail('PF_FOREIGN_NETWORK_REFUSED'); found.networks.push({ id: value.Id, name: value.Name });
  }
  if (fresh && (found.containers.length || found.volumes.length || found.networks.length)) fail('PF_FRESH_RESOURCES_REQUIRED'); return found;
}
export async function build(state) {
  await configuration(state); await ownership(state);
  await assertCanonicalPath(path.join(ROOT, 'pathfinder-engine/tools/PathFinder.ModelRunner/PathFinder.ModelRunner.csproj'));
  const stamp = Date.now().toString(36), token = state.owner.replaceAll('-', '').slice(0, 12), settings = await readSettings(state);
  state.tags = { api: `wfc-pathfinder-api:${token}-${stamp}`, web: `wfc-pathfinder-web:${token}-${stamp}` };
  const sourceFiles = ['docker/pathfinder.Dockerfile', 'docker/pathfinder.Dockerfile.dockerignore', 'docker/pathfinder.compose.yml', 'docker/pathfinder.nginx.conf'];
  const before = await Promise.all(sourceFiles.map(async file => ({ path: file, ...await hashFile(path.join(ROOT, file)) })));
  for (const role of ['api', 'web']) {
    const logFile = path.join(state.runtime, `build-${stamp}-${role}.log`), out = await fs.open(logFile, 'wx', 0o600);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn('docker', ['build', '--progress=plain', '--label', `wfc.pathfinder.owner=${state.owner}`, '--label', `wfc.pathfinder.project=${state.project}`, '--target', role === 'api' ? 'api-runtime' : 'web-runtime', '--tag', state.tags[role], '--file', DOCKERFILE, ROOT], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let chain = Promise.resolve(); for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { chain = chain.then(() => out.write(chunk)); });
        child.once('error', () => reject(Error('PF_BUILD_FAILED'))); child.once('close', code => void chain.then(() => code === 0 ? resolve() : reject(Error('PF_BUILD_FAILED'))));
      });
    } finally { await out.close(); }
  }
  const after = await Promise.all(sourceFiles.map(async file => ({ path: file, ...await hashFile(path.join(ROOT, file)) })));
  if (canonical(before) !== canonical(after)) fail('PF_BUILD_CONFIGURATION_CHANGED');
  state.images = {};
  for (const role of ['api', 'web']) { const image = (await jsonCommand(['image', 'inspect', state.tags[role]]))[0]; if (image.Config.Labels?.['wfc.pathfinder.owner'] !== state.owner) fail('PF_IMAGE_OWNERSHIP_LOST'); state.images[role] = image.Id; }
  await writeEnv(state, { ...settings, apiImage: state.images.api, webImage: state.images.web }, { replace: true });
  state.build = { finishedAt: new Date().toISOString(), files: after }; state.status = 'built'; await save(state);
  return { status: 'PASS', images: state.images, tags: state.tags };
}
async function freePort(port) { await new Promise((resolve, reject) => { const listener = net.createServer(); listener.once('error', () => reject(Error('PF_PORT_IN_USE'))); listener.listen(port, '127.0.0.1', () => listener.close(resolve)); }); }
async function waitHealth(state) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${state.port}/health`, { redirect: 'error', signal: AbortSignal.timeout(3000) }); const text = await response.text(); if (response.ok && text.length < 4096 && JSON.parse(text).status === 'ok') return; } catch { /* bounded startup */ }
    await sleep(500);
  }
  fail('PF_LOOPBACK_HEALTH_FAILED');
}
export async function start(state) {
  if (['quarantine', 'failed-quarantine'].includes(state.status)) fail('PF_RESTORE_QUARANTINED');
  if (state.status === 'retired') fail('PF_RETIRED_RUNTIME');
  await configuration(state); const previous = await ownership(state);
  if (!state.images?.api || !state.images.web) fail('PF_BUILD_REQUIRED');
  if (!previous.containers.some(item => item.role === 'web' && item.running)) await freePort(state.port);
  await command([...composeArgs(state), 'up', '-d', '--no-build', '--pull', 'never'], { maxBytes: 1024 ** 2 });
  await waitHealth(state); state.resources = await ownership(state);
  const docker = await createDocker(), expectedLimits = { api: [4 * 1024 ** 3, 256], postgres: [1024 ** 3, 128], minio: [1024 ** 3, 256], web: [256 * 1024 ** 2, 128] };
  for (const item of state.resources.containers) if (expectedLimits[item.role]) { const actual = await docker.inspect(item.id), expected = expectedLimits[item.role]; if (actual.HostConfig.Memory !== expected[0] || actual.HostConfig.PidsLimit !== expected[1] || item.role === 'api' && !actual.Config.Env.includes('NODE_OPTIONS=--max-old-space-size=1536')) fail('PF_ACTUAL_RESOURCE_CEILINGS_DIFFER'); }
  state.resourceCeilingsVerifiedAt = new Date().toISOString(); state.status = 'running'; await save(state); return { status: 'PASS', origin: `http://127.0.0.1:${state.port}`, resources: state.resources };
}
export async function stop(state) {
  const resources = await ownership(state), docker = await createDocker();
  for (const role of ['web', 'api', 'storage-ready', 'minio', 'postgres']) for (const item of resources.containers.filter(value => value.role === role && value.running)) await docker.stop(item.id, 45);
  state.resources = await ownership(state); state.status = 'stopped'; await save(state); return { status: 'PASS', retainedVolumes: state.resources.volumes, containersStopped: state.resources.containers.every(item => !item.running) };
}
export async function info(state) { return { status: 'PASS', project: state.project, owner: state.owner, origin: `http://127.0.0.1:${state.port}`, runtime: state.runtime, state: state.status, resources: await ownership(state) }; }
export function validateRuntimeRestoreFencingRecord(state, raw) {
  validateState(state, state.runtime);
  if (!Buffer.isBuffer(raw) || raw.length > 65 * 1024 ** 2 || !SHA.test(state.restore?.fencingRecordSha256 ?? '') || digest(raw) !== state.restore.fencingRecordSha256) fail('PF_VERIFIED_RESTORE_FIXTURE_REQUIRED');
  let record; try { record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { fail('PF_VERIFIED_RESTORE_FIXTURE_REQUIRED'); }
  if (record?.format !== 'WFC-PF-RESTORE-FENCING' || record.schemaVersion !== 1 || record.owner !== state.owner || record.project !== state.project || record.runtime !== state.runtime || record.port !== state.port || record.backupId !== state.restore.backupId) fail('PF_VERIFIED_RESTORE_FIXTURE_REQUIRED');
  const validation = validateRestoreFencing(record.beforeInventory, record.afterInventory, record.receipt, state.owner);
  if (canonical(validation) !== canonical(record.validation) || canonical(validation) !== canonical(state.restore.fencingValidation)) fail('PF_VERIFIED_RESTORE_FIXTURE_REQUIRED');
  return validation;
}
export async function retire(state) {
  if (state.project === 'wfc-pathfinder-local' || Number(state.port) === 5191 || state.status === 'failed-quarantine' || !state.restore?.inventoriesEqual && state.restore?.fencingValidated !== true) fail('PF_VERIFIED_RESTORE_FIXTURE_REQUIRED');
  if (state.restore.fencingValidated === true) {
    try {
      validateState(state, state.runtime); const filename = await assertCanonicalPath(path.join(state.runtime, 'restore-fencing.json'));
      if ((await fs.stat(filename)).size > 65 * 1024 ** 2) fail('PF_VERIFIED_RESTORE_FIXTURE_REQUIRED');
      validateRuntimeRestoreFencingRecord(state, await fs.readFile(filename));
    } catch { fail('PF_VERIFIED_RESTORE_FIXTURE_REQUIRED'); }
  }
  await stop(state); const resources = await ownership(state), docker = await createDocker();
  if (resources.containers.some(item => item.running)) fail('PF_RETIRE_RUNNING_REFUSED');
  for (const item of resources.containers) {
    const actual = await docker.inspect(item.id); if (actual.State.Running || !owned(actual.Config.Labels, state)) fail('PF_RETIRE_OWNERSHIP_LOST');
    await docker.remove(item.id);
  }
  for (const item of resources.networks) {
    const actual = (await jsonCommand(['network', 'inspect', item.id]))[0]; if (!owned(actual.Labels, state) || Object.keys(actual.Containers ?? {}).length) fail('PF_RETIRE_OWNERSHIP_LOST');
    await command(['network', 'rm', item.id]);
  }
  for (const name of resources.volumes) {
    const actual = (await jsonCommand(['volume', 'inspect', name]))[0]; if (!owned(actual.Labels, state)) fail('PF_RETIRE_OWNERSHIP_LOST');
    await command(['volume', 'rm', name]);
  }
  state.status = 'retired'; state.retirement = { at: new Date().toISOString(), resources }; state.resources = await ownership(state); await save(state);
  return { status: 'PASS', project: state.project, removedVerifiedRestoreFixtureOnly: true, resources: state.resources };
}
export async function request(state, route, { token, body, method = 'GET' } = {}) {
  const response = await fetch(`http://127.0.0.1:${state.port}${route}`, { method, redirect: 'error', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const text = await response.text(); if (text.length > 4 * 1024 ** 2) fail('PF_HTTP_LIMIT'); let value; try { value = JSON.parse(text); } catch { fail('PF_HTTP_INVALID'); } return { status: response.status, value };
}
export async function bootstrap(state) {
  await ownership(state); await waitHealth(state); if (state.demo) fail('PF_DEMO_ALREADY_BOOTSTRAPPED');
  const docker = await createDocker(), resources = await ownership(state), pg = resources.containers.find(value => value.role === 'postgres'); if (!pg) fail('PF_DATABASE_REQUIRED');
  const count = (await command(['exec', pg.id, 'psql', '--no-password', '--no-psqlrc', '--tuples-only', '--no-align', '-U', 'pf_local', '-d', 'wfc_pathfinder_local', '-c', 'SELECT COUNT(*) FROM users'])).toString().trim(); if (count !== '0') fail('PF_EMPTY_DEMO_DATABASE_REQUIRED');
  const credentials = { email: 'admin@pathfinder.local', password: randomBytes(24).toString('base64url') };
  const registered = await request(state, '/api/auth/register', { method: 'POST', body: { ...credentials, firstName: 'PathFinder', lastName: 'Local demo' } });
  if (registered.status !== 201 || registered.value.user?.isAdmin !== true) fail('PF_ADMIN_BOOTSTRAP_FAILED');
  const settings = { secondaryTrayLength: 3, endConnectionLength: 5, additionalBendingPercent: 10 };
  const created = await request(state, '/api/projects', { token: registered.value.token, method: 'POST', body: { projectNumber: 'PF-LOCAL-DEMO', name: 'PathFinder isolated demonstration', customer: 'Local synthetic fixture', description: 'Separate local development only. Project allowances are explicit synthetic demo settings.', ...settings } });
  if (created.status !== 201 || !UUID.test(created.value.project?.id ?? '')) fail('PF_PROJECT_BOOTSTRAP_FAILED');
  await writePrivateJson(path.join(state.runtime, 'demo.private.json'), credentials);
  state.demo = { projectId: created.value.project.id, adminUserId: registered.value.user.id, syntheticSettings: settings, createdAt: new Date().toISOString() }; await save(state); return { status: 'PASS', ...state.demo, credentialsFile: path.join(state.runtime, 'demo.private.json') };
}
export async function demoLogin(state) { if (!state.demo) fail('PF_DEMO_REQUIRED'); const credentials = JSON.parse(await fs.readFile(path.join(state.runtime, 'demo.private.json'), 'utf8')); const logged = await request(state, '/api/auth/login', { method: 'POST', body: credentials }); if (logged.status !== 200 || logged.value.user?.id !== state.demo.adminUserId || logged.value.user?.isAdmin !== true) fail('PF_DEMO_LOGIN_FAILED'); return logged.value.token; }
export async function importModel(state, zip) {
  await ownership(state); if (!state.demo) fail('PF_DEMO_REQUIRED'); await assertCanonicalPath(zip);
  const identity = await hashFile(zip); if (identity.bytes !== PUBLIC_PACKAGE.bytes || identity.sha256 !== PUBLIC_PACKAGE.sha256) fail('PF_DEMO_PACKAGE_IDENTITY_CHANGED');
  const copy = path.join(state.runtime, 'aalborg-portable.zip'); await fs.copyFile(zip, copy, (await import('node:fs')).constants.COPYFILE_EXCL); if (canonical(await hashFile(copy)) !== canonical(identity)) fail('PF_DEMO_COPY_CHANGED');
  const token = await demoLogin(state), projectPath = `/api/projects/${state.demo.projectId}`;
  const response = await fetch(`http://127.0.0.1:${state.port}${projectPath}/model-imports`, { method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/zip', 'Content-Length': String(identity.bytes), 'Idempotency-Key': randomUUID(), 'X-Package-SHA256': identity.sha256 }, body: createReadStream(copy), duplex: 'half', signal: AbortSignal.timeout(900000) });
  if (response.status !== 202) fail('PF_MODEL_UPLOAD_FAILED'); const accepted = await response.json(), deadline = Date.now() + 900000; let modelVersionId;
  while (Date.now() < deadline) { const progress = await request(state, `${projectPath}/model-imports/${accepted.importId}`, { token }); if (progress.status !== 200 || progress.value.job?.state === 'failed') fail('PF_MODEL_IMPORT_FAILED'); if (progress.value.job.state === 'complete') { modelVersionId = progress.value.job.modelVersionId; break; } await sleep(500); }
  if (!modelVersionId) fail('PF_MODEL_IMPORT_TIMEOUT');
  const listed = await request(state, projectPath + '/model-versions', { token }), version = listed.value.versions?.find(item => item.id === modelVersionId);
  if (listed.status !== 200 || version?.contentFingerprint !== PUBLIC_PACKAGE.fingerprint || version?.resourceCount !== 342) fail('PF_MODEL_IMPORTED_IDENTITY_CHANGED');
  const selected = await request(state, projectPath + '/active-model', { token, method: 'PATCH', body: { modelVersionId, expectedSelectionRevision: listed.value.selection.selectionRevision } }); if (selected.status !== 200) fail('PF_MODEL_SELECTION_FAILED');
  state.demo.model = { versionId: modelVersionId, contentFingerprint: version.contentFingerprint, package: identity, resources: version.resourceCount }; await save(state); return { status: 'PASS', projectId: state.demo.projectId, model: state.demo.model };
}
export async function helper(state, cmd, { mounts = [], network, env = [] } = {}) { return await (await createDocker()).run(state.images.api, { cmd, mounts, network, env, labels: labels(state) }); }
function apiEnv(state, settings) { return [`DATABASE_URL=postgresql://pf_local:${settings.databasePassword}@postgres:5432/wfc_pathfinder_local`, `JWT_SECRET=${settings.jwtSecret}`, 'MINIO_ENDPOINT=minio', 'MINIO_PORT=9000', 'MINIO_USE_SSL=false', 'MINIO_ACCESS_KEY=pf_local_storage', `MINIO_SECRET_KEY=${settings.storagePassword}`, 'MINIO_BUCKET_PROJECTS=pf-local-project-files', 'MINIO_BUCKET_TEMPLATES=pf-local-template-files', 'WFC_MODEL_BUCKET=pf-local-models', 'WFC_MODEL_IMPORT_ROOT=/var/lib/wfc/model-imports']; }
async function operation(state, name, settings = undefined) { const result = await helper(state, ['node', 'server/dist/server/operations/cli.js', name], { network: state.project + '_backend', env: [...apiEnv(state, settings ?? await readSettings(state)), ...(name === 'fence-restored' ? ['WFC_OPS_QUARANTINE=true', 'WFC_OPS_TARGET_ID=' + state.owner] : [])] }); if (result.status !== 'PASS') fail('PF_OPERATION_FAILED'); return result; }
/** Private PF artifacts can retain mixed ownership. The explicitly bounded
 * operator profile grants only this exact read-only inventory DAC_OVERRIDE;
 * a failed audit is never archived. */
export async function artifactAudit(state, { docker: suppliedDocker } = {}) {
  const docker = suppliedDocker ?? await createDocker();
  const result = await docker.run(state.images.api, { cmd: ['node', 'scripts/pathfinder-local/container-ops.mjs', 'inventory', '/source'],
    mounts: [mount(state.project + '_pathfinder', '/source', true, 'volume')], user: '0', labels: labels(state) });
  if (result?.status !== 'PASS') fail('PF_ARTIFACT_AUDIT_FAILED');
  return result;
}
async function boundedStop(docker, item) { if (!item.running) return; await docker.stop(item.id, 45); const after = await docker.inspect(item.id); if (after.State.Running || after.State.ExitCode !== 0 || after.State.OOMKilled) fail('PF_UNCLEAN_STOP'); }
async function waitStorage(state) {
  await helper(state, ['node', '--input-type=module', '-e', "for(let i=0;i<120;i++){try{const r=await fetch('http://minio:9000/minio/health/ready',{signal:AbortSignal.timeout(1500)});if(r.ok){console.log(JSON.stringify({status:'PASS'}));process.exit(0);}}catch{}await new Promise(r=>setTimeout(r,500));}console.log(JSON.stringify({status:'FAIL'}));process.exit(1);"], { network: state.project + '_backend' });
}
async function resume(state, original) {
  const docker = await createDocker();
  for (const role of ['postgres', 'minio', 'api', 'web']) for (const item of original.filter(value => value.role === role && value.running)) {
    const current = await docker.inspect(item.id); if (!current.State.Running) await docker.start(item.id);
    if (role === 'minio') await waitStorage(state);
    if (role === 'api') {
      const deadline = Date.now() + 180000;
      for (;;) { const latest = await docker.inspect(item.id); if (!latest.State.Running) fail('PF_API_RESUME_FAILED'); if (latest.State.Health?.Status === 'healthy') break; if (Date.now() > deadline) fail('PF_API_RESUME_TIMEOUT'); await sleep(500); }
    }
  }
  if (original.some(value => value.role === 'web' && value.running)) await waitHealth(state);
}
const POSTGRES_IMAGE_VOLUME_PATHS = new Set(['/var/lib/postgresql', '/var/lib/postgresql/data']);
/** Pure local-operator construction seam. Shadow every declared PostgreSQL
 * image volume so a read-only TOC helper cannot allocate an anonymous volume. */
export function databaseDumpHelperConfiguration(state, postgres, directory, image) {
  const volumes = image?.Config?.Volumes;
  if (image?.Id !== postgres.image || image.Os !== 'linux' || !volumes || typeof volumes !== 'object' || Array.isArray(volumes)) fail('PF_BACKUP_POSTGRES_IMAGE_VOLUMES');
  const targets = Object.keys(volumes).sort();
  if (targets.length < 1 || targets.length > 2 || targets.some(target => !POSTGRES_IMAGE_VOLUME_PATHS.has(target) || !volumes[target] || typeof volumes[target] !== 'object' || Array.isArray(volumes[target]) || Object.keys(volumes[target]).length)) fail('PF_BACKUP_POSTGRES_IMAGE_VOLUMES');
  return { config: { Image: postgres.image, User: '0', Entrypoint: ['pg_restore'], Cmd: ['--list', '/backup/database.dump'],
    Labels: { ...labels(state), 'wfc.operations.temporary': 'true', 'wfc.operations.purpose': 'pg-restore-mounted-file-verification' }, AttachStdout: true, AttachStderr: true,
    HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Memory: 128 * 1024 ** 2, PidsLimit: 32, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'],
      Mounts: [mount(directory, '/backup'), ...targets.map(Target => ({ Type: 'tmpfs', Target, ReadOnly: true, TmpfsOptions: { SizeBytes: 1024 ** 2, Mode: 0o755 } }))] } }, targets };
}
function exactDockerBindSource(actual, requested) {
  if (actual === requested) return true;
  if (typeof actual !== 'string' || typeof requested !== 'string' || !/^[a-z]:[\\/]/i.test(requested)) return false;
  const components = requested.slice(3).split(/[\\/]/);
  return components.every(part => part && part !== '.' && part !== '..') && actual === '/run/desktop/mnt/host/' + requested[0].toLowerCase() + '/' + components.join('/');
}
export function assertDatabaseDumpHelperMounts(actual, directory, targets) {
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 2 || new Set(targets).size !== targets.length || targets.some(target => !POSTGRES_IMAGE_VOLUME_PATHS.has(target)) || !Array.isArray(actual?.Mounts) || actual.Mounts.length !== targets.length + 1) fail('PF_BACKUP_DUMP_HELPER_MOUNTS');
  const backup = actual.Mounts.filter(item => item.Destination === '/backup');
  if (backup.length !== 1 || backup[0].Type !== 'bind' || backup[0].RW !== false || !exactDockerBindSource(backup[0].Source, directory)) fail('PF_BACKUP_DUMP_HELPER_MOUNTS');
  for (const target of targets) {
    const effective = actual.Mounts.filter(item => item.Destination === target);
    const configured = actual.HostConfig?.Mounts?.filter(item => item.Target === target);
    if (effective.length !== 1 || effective[0].Type !== 'tmpfs' || effective[0].RW !== false || effective[0].Source || effective[0].Name || configured?.length !== 1 || configured[0].Type !== 'tmpfs' || configured[0].ReadOnly !== true || configured[0].TmpfsOptions?.SizeBytes !== 1024 ** 2 || configured[0].TmpfsOptions?.Mode !== 0o755) fail('PF_BACKUP_DUMP_HELPER_MOUNTS');
  }
}
/** pg_restore --list may close stdin after its TOC; use a mounted file, never a dump pipe. */
export async function verifyDatabaseDump(state, directory) {
  const target = path.resolve(directory);
  if (!contained(path.join(ROOT, 'pathfinder-engine/.scratch'), target)) fail('PF_BACKUP_DESTINATION_INVALID');
  await assertCanonicalPath(target, { directory: true });
  const filename = path.join(target, 'database.dump'); await assertCanonicalPath(filename);
  const stat = await fs.stat(filename); if (!stat.isFile() || !stat.size) fail('PF_BACKUP_DATABASE_EMPTY');
  const resources = await ownership(state), postgres = resources.containers.find(item => item.role === 'postgres');
  if (!postgres) fail('PF_COMPLETE_STACK_REQUIRED');
  const docker = await createDocker(), image = await docker.inspectImage(postgres.image);
  const name = 'wfc-pf-dump-' + randomUUID(), purpose = 'pg-restore-mounted-file-verification';
  const spec = databaseDumpHelperConfiguration(state, postgres, target, image);
  const created = await docker.create(name, spec.config);
  try {
    assertDatabaseDumpHelperMounts(await docker.inspect(created.Id), target, spec.targets);
    await docker.start(created.Id); const exited = await docker.wait(created.Id);
    const toc = await command(['logs', created.Id], { maxBytes: 32 * 1024 ** 2 });
    if (exited.StatusCode !== 0 || !toc.length) fail('PF_BACKUP_DATABASE_INVALID');
    return { status: 'PASS', method: 'pg_restore-list-mounted-file', tocBytes: toc.length, tocSha256: digest(toc) };
  } finally {
    const current = await docker.inspect(created.Id);
    if (current.Image !== postgres.image || current.Name !== '/' + name || !owned(current.Config.Labels, state) || current.Config.Labels['wfc.operations.purpose'] !== purpose) fail('PF_BACKUP_HELPER_OWNERSHIP_LOST');
    if (current.State.Running) await docker.stop(created.Id, 10);
    await docker.remove(created.Id);
  }
}
/** @typedef {'backup-before-dump'|'restore-before-fence'|'restore-after-fence'} ColdObservationPhase */
/** @typedef {Readonly<{schemaVersion:'wfc.pf.cold-observation.v1',phase:ColdObservationPhase,backupId:string,runtime:string,owner:string,project:string,port:number,apiImage:string}>} ColdObservation */
/** @typedef {(observation:ColdObservation)=>void|Promise<void>} ColdObserver */
function requireColdObserver(observer) {
  if (observer !== undefined && typeof observer !== 'function') fail('PF_COLD_OBSERVER_INVALID');
}
/** Trusted local observation only: no mutable state, credentials or callback
 * return value enters an archive or authorizes restore/fencing. Exported for
 * pure contract tests; the command-line interface does not accept callbacks.
 * @param {ColdObserver|undefined} observer
 * @param {ColdObservationPhase} phase
 */
export async function observeColdRuntime(observer, phase, state, backupId) {
  requireColdObserver(observer); if (observer === undefined) return;
  if (!['backup-before-dump', 'restore-before-fence', 'restore-after-fence'].includes(phase) || !UUID.test(backupId ?? '') || typeof state?.runtime !== 'string') fail('PF_COLD_OBSERVATION_INVALID');
  validateState(state, state.runtime);
  if (!/^sha256:[a-f0-9]{64}$(?![\s\S])/.test(state.images?.api ?? '')) fail('PF_COLD_OBSERVATION_IMAGE_INVALID');
  const observation = Object.freeze({ schemaVersion: 'wfc.pf.cold-observation.v1', phase, backupId, runtime: state.runtime,
    owner: state.owner, project: state.project, port: Number(state.port), apiImage: state.images.api });
  await observer(observation);
}
/** A trusted local provider, never an archive-supplied function or CLI option.
 * Its module is archived for offline readers; its host capture callback remains
 * explicit operator code and must independently prove the raw table contents. */
export async function validateInventoryProvider(provider) {
  if (provider === undefined) return null;
  if (!provider || typeof provider !== 'object' || Array.isArray(provider) || ![Object.prototype, null].includes(Object.getPrototypeOf(provider)) ||
    Object.keys(provider).sort().join() !== 'capture,modulePath,sha256' || typeof provider.capture !== 'function' || typeof provider.modulePath !== 'string' ||
    !path.isAbsolute(provider.modulePath) || path.resolve(provider.modulePath) !== provider.modulePath || !SHA.test(provider.sha256 ?? '')) fail('PF_INVENTORY_PROVIDER_INVALID');
  await assertCanonicalPath(provider.modulePath);
  const stat = await fs.stat(provider.modulePath); if (!stat.isFile() || stat.size < 1 || stat.size > 2 * 1024 ** 2) fail('PF_INVENTORY_PROVIDER_MODULE_INVALID');
  const raw = await fs.readFile(provider.modulePath); if (digest(raw) !== provider.sha256) fail('PF_INVENTORY_PROVIDER_MODULE_CHANGED');
  return Object.freeze({ modulePath: provider.modulePath, sha256: provider.sha256, capture: provider.capture, bytes: raw.length });
}
export async function captureInventoryWithProvider(provider, phase, state, backupId) {
  if (!provider || !['backup-before-audit', 'backup-after-audit', 'restore-before-fence', 'restore-after-fence'].includes(phase) ||
    !UUID.test(backupId ?? '') || !SHA.test(provider.sha256 ?? '') || typeof provider.capture !== 'function') fail('PF_INVENTORY_PROVIDER_INVALID');
  validateState(state, state.runtime); if (!/^sha256:[a-f0-9]{64}$(?![\s\S])/.test(state.images?.api ?? '')) fail('PF_INVENTORY_PROVIDER_IMAGE_INVALID');
  await assertCanonicalPath(provider.modulePath); if ((await hashFile(provider.modulePath)).sha256 !== provider.sha256) fail('PF_INVENTORY_PROVIDER_MODULE_CHANGED');
  const observation = Object.freeze({ phase, backupId, runtime: state.runtime, owner: state.owner, project: state.project, port: Number(state.port),
    apiImage: state.images.api, moduleSha256: provider.sha256 });
  const value = await provider.capture(observation);
  try { validateInventoryEnvelope(value); validateRestoredInventory(value, value); } catch { fail('PF_INVENTORY_PROVIDER_RESULT_INVALID'); }
  if (value.schemaVersion !== 2 || value.moduleSha256 !== provider.sha256) fail('PF_INVENTORY_PROVIDER_RESULT_INVALID');
  // The envelope is small and has only scalar table pins. Detach it from the
  // callback so later trusted-host activity cannot alter an accepted receipt.
  return JSON.parse(JSON.stringify(value));
}
export function validateRestoreInventoryProvider(manifest, provider) {
  if (manifest.schemaVersion === 1) { if (provider) fail('PF_LEGACY_BACKUP_PROVIDER_REFUSED'); return; }
  if (manifest.schemaVersion !== 2 || !provider || provider.sha256 !== manifest.inventoryModule?.sha256 ||
    provider.bytes !== manifest.inventoryModule?.bytes) fail('PF_RESTORE_INVENTORY_PROVIDER_REQUIRED');
}
const runtimeInventory = async (provider, phase, state, backupId, settings) => provider
  ? await captureInventoryWithProvider(provider, phase, state, backupId) : await operation(state, 'inventory', settings);
/** @param {{observeCold?:ColdObserver,inventoryProvider?:{modulePath:string,sha256:string,capture:Function}}} [options] */
export async function backup(state, directory, privateConfig, { observeCold, inventoryProvider } = {}) {
  requireColdObserver(observeCold);
  const provider = await validateInventoryProvider(inventoryProvider);
  const target = path.resolve(directory), privatePath = path.resolve(privateConfig); if (!contained(path.join(ROOT, 'pathfinder-engine/.scratch'), target) || contained(target, privatePath)) fail('PF_BACKUP_DESTINATION_INVALID');
  const resources = await ownership(state), docker = await createDocker(); if (resources.containers.filter(item => ['api', 'web', 'minio', 'postgres'].includes(item.role)).length !== 4 || !resources.containers.find(item => item.role === 'postgres')?.running) fail('PF_COMPLETE_STACK_REQUIRED');
  await safeNew(target); await assertCanonicalPath(path.dirname(privatePath), { directory: true }); const settings = await readSettings(state), backupId = randomUUID();
  let inventoryModule;
  if (provider) {
    const raw = await fs.readFile(provider.modulePath); if (digest(raw) !== provider.sha256) fail('PF_INVENTORY_PROVIDER_MODULE_CHANGED');
    await fs.writeFile(path.join(target, 'losslessInventory.mjs'), raw, { flag: 'wx', mode: 0o600 });
    inventoryModule = { path: 'losslessInventory.mjs', ...await hashFile(path.join(target, 'losslessInventory.mjs')) };
  }
  await writePrivateJson(privatePath, { format: 'WFC-PF-LOCAL-PRIVATE', schemaVersion: 1, backupId, settings, ...(state.demo ? { demo: state.demo, credentials: JSON.parse(await fs.readFile(path.join(state.runtime, 'demo.private.json'), 'utf8')) } : {}), ...(state.syntheticDemo ? { syntheticDemo: state.syntheticDemo } : {}) });
  let completed = false, failure;
  try {
    for (const role of ['web', 'api']) await boundedStop(docker, resources.containers.find(item => item.role === role));
    const pg = resources.containers.find(item => item.role === 'postgres');
    const fence = (await command(['exec', pg.id, 'psql', '--no-password', '--no-psqlrc', '--tuples-only', '--no-align', '-U', 'pf_local', '-d', 'wfc_pathfinder_local', '-c', "SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()"])).toString().trim(); if (fence !== '0') fail('PF_EXTERNAL_DATABASE_WRITER');
    const inventory = await runtimeInventory(provider, 'backup-before-audit', state, backupId), audit = await operation(state, 'audit-models'), artifacts = await artifactAudit(state);
    const inventoryAfter = await runtimeInventory(provider, 'backup-after-audit', state, backupId);
    if (provider) validateRestoredInventory(inventory, inventoryAfter);
    if (inventory.businessSha256 !== inventoryAfter.businessSha256 || inventory.registrySha256 !== inventoryAfter.registrySha256) fail('PF_BACKUP_DATABASE_CHANGED');
    await boundedStop(docker, resources.containers.find(item => item.role === 'minio'));
    await observeColdRuntime(observeCold, 'backup-before-dump', state, backupId);
    await command(['exec', pg.id, 'pg_dump', '--no-password', '--format=custom', '--no-owner', '--no-acl', '-U', 'pf_local', '-d', 'wfc_pathfinder_local'], { output: path.join(target, 'database.dump') });
    const databaseDumpVerification = await verifyDatabaseDump(state, target);
    const manifest = { format: 'WFC-PF-LOCAL-BACKUP', schemaVersion: provider ? 2 : 1, profile: provider ? 'cold-pg-minio-staging-pathfinder-v2' : 'cold-pg-minio-staging-pathfinder-v1',
      backupId, createdAt: new Date().toISOString(), sourceProject: state.project, sourceOwner: state.owner, inventory, artifacts, modelAudit: audit, databaseDumpVerification,
      ...(provider ? { inventoryModule } : {}), files: [], images: [] };
    for (const role of ['minio', 'staging', 'pathfinder']) {
      const captured = await helper(state, ['node', 'scripts/operations/archives.mjs', 'capture', '/source', '/backup/' + role + '.wfcops'], { mounts: [mount(state.project + '_' + role, '/source', true, 'volume'), mount(target, '/backup', false)] });
      const verified = await helper(state, ['node', 'scripts/operations/archives.mjs', 'verify', '/backup/' + role + '.wfcops', captured.sha256], { mounts: [mount(target, '/backup')] }); if (verified.status !== 'PASS') fail('PF_BACKUP_ARCHIVE_FAILED');
    }
    for (const role of ['api', 'web', 'postgres', 'minio']) {
      const id = resources.containers.find(item => item.role === role).image, image = (await jsonCommand(['image', 'inspect', id]))[0], record = { role, id, os: image.Os, architecture: image.Architecture, exportMode: 'id-only', archive: role + '-image.tar' };
      await command(['image', 'save', '--output', path.join(target, record.archive), id]); await verifyImageArchive(path.join(target, record.archive), record); manifest.images.push(record);
    }
    for (const filename of ['database.dump', 'minio.wfcops', 'staging.wfcops', 'pathfinder.wfcops', ...manifest.images.map(item => item.archive), ...(provider ? ['losslessInventory.mjs'] : [])]) manifest.files.push({ path: filename, ...await hashFile(path.join(target, filename)) });
    await resume(state, resources.containers);
    await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(target, 'complete.json'), JSON.stringify({ format: manifest.format, backupId, manifest: await hashFile(path.join(target, 'manifest.json')) }) + '\n', { flag: 'wx', mode: 0o600 });
    const verified = await verifyBackup(target); completed = true; return verified;
  } catch (error) { failure = error.code ?? 'PF_BACKUP_FAILED'; throw error; }
  finally { await resume(state, resources.containers); await fs.writeFile(path.join(target, 'resume.json'), JSON.stringify({ completed, failure, restoredOriginalRunningState: true, at: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 }); }
}
/** Pure version/member boundary; archive file/image bytes are verified separately. */
export function validateBackupInventoryContract(manifest) {
  const version2 = manifest?.schemaVersion === 2;
  if (!manifest || ![1, 2].includes(manifest.schemaVersion) || manifest.profile !== (version2 ? 'cold-pg-minio-staging-pathfinder-v2' : 'cold-pg-minio-staging-pathfinder-v1') ||
    !Array.isArray(manifest.files) || manifest.files.length !== (version2 ? 9 : 8)) fail('PF_BACKUP_INVALID');
  if (!version2) { if (Object.hasOwn(manifest, 'inventoryModule')) fail('PF_BACKUP_INVENTORY_MODULE_INVALID'); return false; }
  try { validateInventoryEnvelope(manifest.inventory); validateRestoredInventory(manifest.inventory, manifest.inventory); } catch { fail('PF_BACKUP_INVENTORY_INVALID'); }
  const module = manifest.inventoryModule;
  if (manifest.inventory.schemaVersion !== 2 || !module || typeof module !== 'object' || Array.isArray(module) || Object.keys(module).sort().join() !== 'bytes,path,sha256' ||
    module.path !== 'losslessInventory.mjs' || !Number.isSafeInteger(module.bytes) || module.bytes < 1 || module.bytes > 2 * 1024 ** 2 || !SHA.test(module.sha256 ?? '') ||
    module.sha256 !== manifest.inventory.moduleSha256 || canonical(manifest.files.find(item => item.path === module.path)) !== canonical(module)) fail('PF_BACKUP_INVENTORY_MODULE_INVALID');
  return true;
}
export async function verifyBackup(directory) {
  const target = path.resolve(directory); await assertCanonicalPath(target, { directory: true }); const markerRaw = await fs.readFile(path.join(target, 'complete.json')), raw = await fs.readFile(path.join(target, 'manifest.json')); if (markerRaw.length > 4096 || raw.length > 64 * 1024 ** 2) fail('PF_BACKUP_MANIFEST_LIMIT');
  const marker = JSON.parse(markerRaw), manifest = JSON.parse(raw), version2 = validateBackupInventoryContract(manifest);
  if (manifest.format !== 'WFC-PF-LOCAL-BACKUP' || !UUID.test(manifest.backupId ?? '') || marker.format !== manifest.format || marker.backupId !== manifest.backupId || canonical(marker.manifest) !== canonical(await hashFile(path.join(target, 'manifest.json'))) || !Array.isArray(manifest.images) || manifest.images.length !== 4) fail('PF_BACKUP_INVALID');
  if (!PROJECT.test(manifest.sourceProject ?? '') || !UUID.test(manifest.sourceOwner ?? '') || !SHA.test(manifest.inventory?.businessSha256 ?? '') || !SHA.test(manifest.inventory?.registrySha256 ?? '') || !SHA.test(manifest.artifacts?.sha256 ?? '') || manifest.images.map(image => image.role).sort().join() !== 'api,minio,postgres,web') fail('PF_BACKUP_INVALID');
  const expected = ['database.dump', 'minio.wfcops', 'staging.wfcops', 'pathfinder.wfcops', 'api-image.tar', 'web-image.tar', 'postgres-image.tar', 'minio-image.tar', ...(version2 ? ['losslessInventory.mjs'] : [])];
  if (manifest.files.map(item => item.path).sort().join() !== expected.sort().join()) fail('PF_BACKUP_MEMBERS_INVALID');
  for (const item of manifest.files) if (!SHA.test(item.sha256 ?? '') || canonical(await hashFile(path.join(target, item.path))) !== canonical({ bytes: item.bytes, sha256: item.sha256 })) fail('PF_BACKUP_FILE_CHANGED');
  for (const image of manifest.images) { if (!['api', 'web', 'postgres', 'minio'].includes(image.role) || image.archive !== image.role + '-image.tar') fail('PF_BACKUP_IMAGE_INVALID'); await verifyImageArchive(path.join(target, image.archive), image); }
  return { status: 'PASS', directory: target, manifest };
}
/** activate:false retains a successfully verified, fenced target in quarantine;
 * PostgreSQL/storage may run, but this restore never starts API/web. This is an
 * operator foundation only, not proof of U8 delivery or browser acceptance.
 * @param {{backup?:string,privateConfig?:string,runtime?:string,port?:number|string,observeCold?:ColdObserver,activate?:boolean,inventoryProvider?:{modulePath:string,sha256:string,capture:Function}}} [options] */
export async function restore({ backup: source, privateConfig, runtime, port = 5191, observeCold, activate = true, inventoryProvider } = {}) {
  if (typeof activate !== 'boolean') fail('PF_RESTORE_ACTIVATION_INVALID');
  requireColdObserver(observeCold);
  const provider = await validateInventoryProvider(inventoryProvider);
  const verified = await verifyBackup(source), manifest = verified.manifest; validateRestoreInventoryProvider(manifest, provider);
  await assertCanonicalPath(privateConfig); const privateBytes = await fs.readFile(privateConfig); if (privateBytes.length > 1024 ** 2) fail('PF_PRIVATE_CONFIG_LIMIT'); const config = JSON.parse(privateBytes);
  if (config.format !== 'WFC-PF-LOCAL-PRIVATE' || config.schemaVersion !== 1 || config.backupId !== manifest.backupId) fail('PF_PRIVATE_CONFIG_INVALID');
  const token = randomBytes(6).toString('hex'), state = await init({ runtime: runtime ?? path.join(ROOT, 'pathfinder-engine/.scratch/pathfinder-local-restore-' + token), project: 'wfc-pathfinder-local-' + token, port });
  await ownership(state, { fresh: true }); await freePort(state.port); state.images = Object.fromEntries(manifest.images.filter(item => ['api', 'web'].includes(item.role)).map(item => [item.role, item.id]));
  for (const image of manifest.images) { try { await jsonCommand(['image', 'inspect', image.id]); } catch { await command(['image', 'load', '--input', path.join(verified.directory, image.archive)]); } }
  const settings = { ...config.settings, producer:undefined, jwtSecret: randomBytes(64).toString('hex'), apiImage: state.images.api, webImage: state.images.web, postgresImage: manifest.images.find(item => item.role === 'postgres').id, minioImage: manifest.images.find(item => item.role === 'minio').id };
  await writeEnv(state, settings, { replace: true }); state.status = 'quarantine'; await save(state); await configuration(state);
  await command([...composeArgs(state), 'create', '--no-build', '--pull', 'never', 'postgres', 'minio', 'storage-ready'], { maxBytes: 1024 ** 2 });
  // Compose creates only referenced volumes here; explicitly create the two application volumes with the same ownership labels.
  const docker = await createDocker(); for (const role of ['staging', 'pathfinder']) await docker.request('POST', '/volumes/create', { Name: state.project + '_' + role, Labels: { ...labels(state), 'com.docker.compose.project': state.project, 'com.docker.compose.volume': role } });
  try {
    await ownership(state);
    for (const role of ['minio', 'staging', 'pathfinder']) { const item = manifest.files.find(value => value.path === role + '.wfcops'); await helper(state, ['node', 'scripts/operations/archives.mjs', 'restore', '/backup/' + item.path, '/target', item.sha256], { mounts: [mount(verified.directory, '/backup'), mount(state.project + '_' + role, '/target', false, 'volume')] }); }
    await command([...composeArgs(state), 'start', 'postgres', 'minio']);
    const resources = await ownership(state), pg = resources.containers.find(item => item.role === 'postgres'), deadline = Date.now() + 120000;
    for (;;) { try { await command(['exec', pg.id, 'pg_isready', '-U', 'pf_local', '-d', 'wfc_pathfinder_local']); break; } catch { if (Date.now() > deadline) fail('PF_RESTORE_DATABASE_TIMEOUT'); await sleep(500); } }
    await command(['exec', '-i', pg.id, 'pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '-U', 'pf_local', '-d', 'wfc_pathfinder_local'], { input: path.join(verified.directory, 'database.dump') });
    await waitStorage(state); await operation(state, 'audit-models', settings);
    const inventory = await runtimeInventory(provider, 'restore-before-fence', state, manifest.backupId, settings), artifacts = await artifactAudit(state);
    validateRestoredInventory(manifest.inventory, inventory);
    if (inventory.businessSha256 !== manifest.inventory.businessSha256 || inventory.registrySha256 !== manifest.inventory.registrySha256 || artifacts.sha256 !== manifest.artifacts.sha256) fail('PF_RESTORE_DATA_MISMATCH');
    await observeColdRuntime(observeCold, 'restore-before-fence', state, manifest.backupId);
    const fenced = await operation(state, 'fence-restored', settings), after = await runtimeInventory(provider, 'restore-after-fence', state, manifest.backupId, settings);
    const fencingValidation = validateRestoreFencing(inventory, after, fenced, state.owner);
    const fencingRecord = JSON.stringify({ format: 'WFC-PF-RESTORE-FENCING', schemaVersion: 1, owner: state.owner, project: state.project, runtime: state.runtime, port: state.port, backupId: manifest.backupId,
      beforeInventory: inventory, afterInventory: after, receipt: fenced, validation: fencingValidation }) + '\n';
    await fs.writeFile(path.join(state.runtime, 'restore-fencing.json'), fencingRecord, { flag: 'wx', mode: 0o600 });
    if (config.demo) { state.demo = config.demo; await writePrivateJson(path.join(state.runtime, 'demo.private.json'), config.credentials); }
    if (config.syntheticDemo) state.syntheticDemo = config.syntheticDemo;
    state.restore = { backupId: manifest.backupId, artifactsSha256: artifacts.sha256, jwtRotated: true, sessionsFenced: true,
      inventoriesEqual: inventory.businessSha256 === after.businessSha256, fencingValidated: true, fencingValidation, fencingRecordSha256: digest(fencingRecord) }; state.status = 'verified-quarantine'; await save(state);
    await observeColdRuntime(observeCold, 'restore-after-fence', state, manifest.backupId);
    if (activate) await start(state);
    return { status: 'PASS', runtime: state.runtime, project: state.project, origin: `http://127.0.0.1:${state.port}`,
      ...(activate ? {} : { activated: false }), restore: state.restore };
  } catch (error) { state.status = 'failed-quarantine'; await save(state); throw error; }
}
