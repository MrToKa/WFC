import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDocker, environment, dataMount, writePrivateJson } from './foundation/docker.mjs';
import { withBoundedDockerExecution, getBoundedDockerCleanup } from './foundation/docker-bounds.mjs';
import { assertCanonicalPath, hashFile } from './foundation/archives.mjs';
import { writeJsonNew, verifyImageArchive } from './foundation/manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ID = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{64}$/, IMAGE = /^sha256:[a-f0-9]{64}$/;
const HELPER = 'sha256:ac0d16ab1b0f4c92922c20d1a13a5ea142d4c6e92558de1870daf4db7fd60fcf';
const ROLES = ['api', 'web', 'postgres', 'minio'];
const PACK = ['node', 'scripts/operations/archives.mjs'];
export const OFFLINE_SEED_BOUNDS = Object.freeze({ operationTimeoutMs: 7_200_000, commandTimeoutMs: 3_600_000,
  requestTimeoutMs: 180_000, helperTimeoutMs: 3_600_000, helperMemoryBytes: 512 * 1024 ** 2,
  pidsLimit: 128, nanoCpus: 1_000_000_000, tmpBytes: 64 * 1024 ** 2,
  archiveOutputBytes: 32 * 1024 ** 3, archiveOwnership: 'preparer-offline-seed-posix' });
const RECOVERY_BOUNDS = Object.freeze({ ...OFFLINE_SEED_BOUNDS, operationTimeoutMs: 600_000,
  commandTimeoutMs: 180_000, requestTimeoutMs: 180_000, helperTimeoutMs: 180_000 });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const need = (value, code) => { if (!value) throw Object.assign(Error(code), { code }); };
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
export const canonicalSha256 = value => createHash('sha256').update(canonical(value)).digest('hex');
const same = (a, b) => canonical(a) === canonical(b);
const active = container => container.State?.Running === true || container.State?.Restarting === true;
const mounted = mount => mount.Type === 'volume' ? mount.Name : mount.Source;
const normalizedPath = value => { let result = String(value).replaceAll('\\', '/').replace(/\/+$/, '');
  result = result.replace(/^\/run\/desktop\/mnt\/host\/([a-z])\//i, '$1:/');
  return /^[a-z]:\//i.test(result) || result.startsWith('//') ? result.toLowerCase() : result; };
const within = (parent, child) => { const a = normalizedPath(parent), b = normalizedPath(child); return a === b || b.startsWith(a + '/'); };
const overlap = (a, b) => within(a, b) || within(b, a);
const privateMount = (source, target, readOnly = true, type = 'bind') => ({ Type: type, Source: source, Target: target, ReadOnly: readOnly });
const safeCode = error => /^[A-Z0-9_]{3,80}$/.test(error?.code ?? '') ? error.code : 'SP1_SEED_FAILED';

export function validateIntent(value) {
  need(exact(value, ['schemaVersion', 'operationId', 'source', 'helperImage', 'privateCompanion', 'excluded'])
    && value.schemaVersion === 'wfc.preparer.offline-seed-intent.v1' && UUID.test(value.operationId)
    && value.helperImage === HELPER && typeof value.privateCompanion === 'string' && path.isAbsolute(value.privateCompanion), 'SP1_INTENT_INVALID');
  const source = value.source;
  need(exact(source, ['port', 'composeProject', 'roles', 'database', 'minio', 'stagingDestination'])
    && source.port === 5180 && source.composeProject === 'wfc-app' && exact(source.roles, ROLES)
    && exact(source.database, ['host', 'port', 'name']) && source.database.host === 'host.docker.internal'
    && source.database.port === 5434 && source.database.name === 'wfc_app'
    && exact(source.minio, ['host', 'port']) && source.minio.host === 'host.docker.internal' && source.minio.port === 9000
    && source.stagingDestination === '/var/lib/wfc/model-imports', 'SP1_SOURCE_SCOPE_INVALID');
  for (const role of ROLES) {
    const item = source.roles[role];
    need(exact(item, ['id', 'image', 'configSha256', 'hostConfigSha256', 'mountsSha256', 'networksSha256']) && ID.test(item.id) && IMAGE.test(item.image)
      && ['configSha256', 'hostConfigSha256', 'mountsSha256', 'networksSha256'].every(key => SHA.test(item[key])), 'SP1_ROLE_PIN_INVALID');
  }
  need(new Set(ROLES.map(role => source.roles[role].id)).size === 4 && exact(value.excluded, ['containerIds', 'volumeNames', 'bindPaths']), 'SP1_EXCLUSIONS_INVALID');
  for (const key of ['containerIds', 'volumeNames', 'bindPaths']) need(Array.isArray(value.excluded[key]) && value.excluded[key].length <= 1024
    && new Set(value.excluded[key]).size === value.excluded[key].length
    && value.excluded[key].every(item => typeof item === 'string' && item.length > 0 && item.length <= 4096 && !item.includes('\0')), 'SP1_EXCLUSIONS_INVALID');
  need(value.excluded.containerIds.every(item => ID.test(item)) && ROLES.every(role => !value.excluded.containerIds.includes(source.roles[role].id)), 'SP1_EXCLUDED_SOURCE');
  need(value.excluded.volumeNames.every(item => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,255}$/.test(item))
    && value.excluded.bindPaths.every(item => path.isAbsolute(item)), 'SP1_EXCLUSIONS_INVALID');
  return value;
}

function portBound(container, internal, external, loopback = false) {
  const entries = container.HostConfig?.PortBindings?.[internal + '/tcp'];
  return Array.isArray(entries) && entries.length === 1 && entries[0].HostPort === String(external)
    && (loopback ? entries[0].HostIp === '127.0.0.1' : ['', '0.0.0.0', '::', '127.0.0.1'].includes(entries[0].HostIp));
}
// Docker reallocates these endpoint observations when its own stopped source is
// resumed. Attachment names, NetworkID, aliases, IPAMConfig, options and every
// unknown configuration field remain part of identity.
export function networkAttachmentIdentity(container, { allowUnbound = false } = {}) {
  const networks = container.NetworkSettings?.Networks;
  if (allowUnbound && networks === undefined) return null;
  need(record(networks) && (allowUnbound || Object.keys(networks).length > 0) && Object.keys(networks).length <= 32, 'SP1_NETWORK_ATTACHMENTS_INVALID');
  const result = structuredClone(networks);
  for (const [name, attachment] of Object.entries(result)) {
    need(name.length > 0 && name.length <= 256 && record(attachment)
      && (ID.test(attachment.NetworkID ?? '') || allowUnbound && attachment.NetworkID === ''), 'SP1_NETWORK_ATTACHMENTS_INVALID');
    for (const field of ['EndpointID', 'Gateway', 'IPAddress', 'IPPrefixLen', 'IPv6Gateway', 'GlobalIPv6Address', 'GlobalIPv6PrefixLen', 'MacAddress']) delete attachment[field];
  }
  return result;
}
export function sourceWitness(intent, all) {
  validateIntent(intent); need(Array.isArray(all) && all.length <= 1024, 'SP1_CONTAINER_LIMIT');
  const source = {};
  for (const role of ROLES) {
    const pin = intent.source.roles[role], matches = all.filter(item => item.Id === pin.id);
    need(matches.length === 1, 'SP1_SOURCE_MISSING'); const item = matches[0];
    need(item.Image === pin.image && canonicalSha256(item.Config) === pin.configSha256
      && canonicalSha256(item.HostConfig) === pin.hostConfigSha256 && canonicalSha256(item.Mounts) === pin.mountsSha256
      && canonicalSha256(networkAttachmentIdentity(item)) === pin.networksSha256, 'SP1_SOURCE_CAS_CHANGED');
    need(Array.isArray(item.Mounts) && record(item.Config) && record(item.HostConfig) && typeof item.Name === 'string', 'SP1_SOURCE_INSPECT_INVALID');
    source[role] = item;
  }
  need(!active(source.postgres), 'SP1_POSTGRES_MUST_REMAIN_STOPPED');
  for (const [role, service] of [['api', 'backend'], ['web', 'frontend']]) need(source[role].Config.Labels?.['com.docker.compose.project'] === 'wfc-app'
    && source[role].Config.Labels?.['com.docker.compose.service'] === service, 'SP1_MAIN_COMPOSE_REQUIRED');
  need(source.postgres.Name === '/wfc_app' && source.minio.Name === '/wfc-minio'
    && portBound(source.web, 80, 5180, true) && portBound(source.postgres, 5432, 5434) && portBound(source.minio, 9000, 9000), 'SP1_ENDPOINT_BINDING_INVALID');
  const env = environment(source.api); let database;
  try { database = new URL(env.get('DATABASE_URL')); } catch { need(false, 'SP1_DATABASE_CONFIG_INVALID'); }
  need(['postgres:', 'postgresql:'].includes(database.protocol) && database.hostname === intent.source.database.host
    && Number(database.port || 5432) === 5434 && decodeURIComponent(database.pathname) === '/wfc_app'
    && env.get('MINIO_ENDPOINT') === intent.source.minio.host && Number(env.get('MINIO_PORT') || 9000) === 9000
    && env.get('WFC_MODEL_IMPORT_ROOT') === intent.source.stagingDestination, 'SP1_ENDPOINT_CONFIG_CHANGED');
  const destinations = { api: intent.source.stagingDestination, postgres: '/var/lib/postgresql', minio: '/data' };
  for (const [role, destination] of Object.entries(destinations)) {
    const mounts = source[role].Mounts;
    need(mounts.length === 1 && mounts[0].Destination === destination && ['bind', 'volume'].includes(mounts[0].Type)
      && mounts[0].RW === true && typeof mounted(mounts[0]) === 'string' && mounted(mounts[0]).length > 0, 'SP1_MOUNT_SCOPE_INVALID');
    const m = mounts[0];
    need(m.Type === 'volume' ? !intent.excluded.volumeNames.includes(m.Name) : !intent.excluded.bindPaths.some(value => overlap(value, m.Source)), 'SP1_EXCLUDED_SOURCE');
  }
  need(source.web.Mounts.length === 0, 'SP1_WEB_MOUNT_UNSUPPORTED');
  const ids = new Set(ROLES.map(role => source[role].Id)), protectedMounts = Object.keys(destinations).map(role => source[role].Mounts[0]);
  for (let a = 0; a < protectedMounts.length; a++) for (let b = a + 1; b < protectedMounts.length; b++)
    need(protectedMounts[a].Type !== protectedMounts[b].Type || (protectedMounts[a].Type === 'volume'
      ? protectedMounts[a].Name !== protectedMounts[b].Name : !overlap(protectedMounts[a].Source, protectedMounts[b].Source)), 'SP1_SOURCE_STORES_OVERLAP');
  for (const item of all) if (!ids.has(item.Id) && active(item)) {
    for (const current of item.Mounts ?? []) if (current.RW) need(!protectedMounts.some(target => current.Type === target.Type
      && (target.Type === 'volume' ? current.Name === target.Name : overlap(current.Source, target.Source))), 'SP1_UNKNOWN_STORAGE_WRITER');
    const other = environment(item); let connection;
    try { connection = other.has('DATABASE_URL') ? new URL(other.get('DATABASE_URL')) : null; } catch { connection = null; }
    need(!(connection && connection.hostname === intent.source.database.host && Number(connection.port || 5432) === 5434
      && decodeURIComponent(connection.pathname) === '/wfc_app'), 'SP1_UNKNOWN_DATABASE_CLIENT');
    need(!(other.get('MINIO_ENDPOINT') === intent.source.minio.host && Number(other.get('MINIO_PORT') || 9000) === 9000), 'SP1_UNKNOWN_STORAGE_CLIENT');
  }
  return source;
}

const containerIdentity = item => ({ id: item.Id, name: item.Name, image: item.Image, configSha256: canonicalSha256(item.Config),
  hostConfigSha256: canonicalSha256(item.HostConfig), mountsSha256: canonicalSha256(item.Mounts),
  networksSha256: canonicalSha256(networkAttachmentIdentity(item, { allowUnbound: true })) });
function networkIdentity(network) {
  const { Containers, ...identity } = structuredClone(network);
  need(typeof identity.Id === 'string' && ID.test(identity.Id), 'SP1_NETWORK_IDENTITY');
  if (Object.hasOwn(identity, 'Status')) {
    const status = identity.Status;
    need(exact(status, ['IPAM']) && exact(status.IPAM, ['Subnets']) && record(status.IPAM.Subnets)
      && Array.isArray(identity.IPAM?.Config), 'SP1_NETWORK_STATUS_INVALID');
    const configured = identity.IPAM.Config.map(item => item.Subnet), subnets = Object.keys(status.IPAM.Subnets);
    need(configured.every(item => typeof item === 'string' && item.length > 0) && new Set(configured).size === configured.length
      && configured.length === subnets.length && subnets.every(item => configured.includes(item)), 'SP1_NETWORK_STATUS_INVALID');
    for (const subnet of subnets) { const usage = status.IPAM.Subnets[subnet];
      need(exact(usage, ['IPsInUse', 'DynamicIPsAvailable']) && Object.values(usage).every(value => Number.isSafeInteger(value) && value >= 0)
        && Number.isSafeInteger(usage.IPsInUse + usage.DynamicIPsAvailable), 'SP1_NETWORK_STATUS_INVALID');
      delete usage.IPsInUse; delete usage.DynamicIPsAvailable;
    }
  }
  return identity;
}
async function resources(docker, source, expected) {
  const volumeNames = [...new Set(ROLES.flatMap(role => source[role].Mounts.filter(item => item.Type === 'volume').map(item => item.Name)))].sort();
  const networkIds = expected?.networkIds ?? [...new Set(ROLES.flatMap(role => Object.values(source[role].NetworkSettings?.Networks ?? {})
    .map(item => item.NetworkID).filter(item => ID.test(item ?? ''))))].sort();
  const volumes = [], networks = [], allocation = [];
  for (const name of volumeNames) { const volume = await docker.request('GET', '/volumes/' + encodeURIComponent(name)); need(volume?.Name === name, 'SP1_VOLUME_IDENTITY'); volumes.push(volume); }
  for (const id of networkIds) { const network = await docker.request('GET', '/networks/' + id); need(network?.Id === id, 'SP1_NETWORK_IDENTITY');
    networks.push(networkIdentity(network)); allocation.push({ id, status: network.Status ?? null }); }
  return { identity: { volumeNames, networkIds, volumes, networks }, allocation };
}

async function readIntent(filename, expected) {
  await assertCanonicalPath(filename); const bytes = await fs.readFile(filename);
  need(bytes.length > 0 && bytes.length <= 1024 ** 2 && createHash('sha256').update(bytes).digest('hex') === expected, 'SP1_INTENT_HASH_CHANGED');
  let value; try { value = JSON.parse(bytes); } catch { need(false, 'SP1_INTENT_INVALID'); } return validateIntent(value);
}
async function pin(filename) { return { path: filename, ...await hashFile(filename) }; }
async function stopExact(docker, item) {
  if (active(item)) await docker.stop(item.Id, 45);
  const now = await docker.inspect(item.Id);
  need(now.Id === item.Id && !active(now) && same(containerIdentity(now), containerIdentity(item)), 'SP1_SOURCE_STOP_UNCONFIRMED');
}
function assertDestinations(intent, operationDirectory, source) {
  need(!overlap(operationDirectory, intent.privateCompanion), 'SP1_PRIVATE_COMPANION_LOCATION');
  for (const item of Object.values(source)) for (const mount of item.Mounts) if (mount.Type === 'bind') {
    need(!overlap(mount.Source, operationDirectory) && !overlap(mount.Source, intent.privateCompanion), 'SP1_DESTINATION_INSIDE_SOURCE');
  }
  for (const denied of intent.excluded.bindPaths) need(!overlap(denied, operationDirectory) && !overlap(denied, intent.privateCompanion), 'SP1_EXCLUDED_DESTINATION');
}

/** Captures a physical cold seed only. It never starts PostgreSQL or an application helper. */
export async function captureOfflineSeed({ intentPath, intentSha256, operationDirectory }, { docker: supplied, signal, imageArchiveVerifier, testFinalizationObserver } = {}) {
  need(SHA.test(intentSha256 ?? '') && typeof intentPath === 'string' && path.isAbsolute(intentPath)
    && typeof operationDirectory === 'string' && path.isAbsolute(operationDirectory), 'SP1_ARGUMENT_INVALID');
  const intent = await readIntent(intentPath, intentSha256), parent = await assertCanonicalPath(path.join(ROOT, '.preparer-work'), { directory: true });
  need(path.resolve(operationDirectory) === path.join(parent, 'sp1-offline-seed-' + intent.operationId)
    && !within(operationDirectory, intentPath), 'SP1_OPERATION_DIRECTORY_INVALID');
  await assertCanonicalPath(path.dirname(intent.privateCompanion), { directory: true });
  need(!overlap(operationDirectory, intent.privateCompanion), 'SP1_PRIVATE_COMPANION_LOCATION');
  const verifier = imageArchiveVerifier ?? verifyImageArchive, verifierMode = imageArchiveVerifier === undefined ? 'production-default' : 'injected-test-only';
  need(typeof verifier === 'function', 'SP1_VERIFIER_INVALID');
  need(testFinalizationObserver === undefined || typeof testFinalizationObserver === 'function', 'SP1_FINALIZATION_OBSERVER_INVALID');
  const finalizationMode = testFinalizationObserver === undefined ? 'production-default' : 'injected-test-only';
  const sourceClosure = [];
  for (const name of ['offline-seed.mjs', 'foundation/docker.mjs', 'foundation/docker-bounds.mjs', 'foundation/archives.mjs', 'foundation/manifest.mjs', 'foundation/provenance.json']) sourceClosure.push(await pin(path.join(path.dirname(fileURLToPath(import.meta.url)), name)));
  // mkdir without recursive is the immutable attempt latch; any retained directory refuses retry.
  await fs.mkdir(operationDirectory, { mode: 0o700 });
  const file = name => path.join(operationDirectory, name), startedAt = new Date().toISOString();
  // Different operation UUIDs still serialize the same main source. Failure
  // retains this lock for explicit reconciliation; only full success releases it.
  const sourceLockPath = path.join(parent, 'main5180-offline-seed.lock');
  await writeJsonNew(sourceLockPath, { schemaVersion: 'wfc.preparer.offline-seed-source-lock.v1', operationId: intent.operationId,
    intentSha256, operationDirectory, startedAt });
  const sourceLock = await pin(sourceLockPath), sourceLockStat = await fs.lstat(sourceLockPath);
  const evidence = [];
  const proof = async (name, value) => { await writeJsonNew(file(name), value); const ref = await pin(file(name)); evidence.push(ref); return ref; };
  await proof('begin.private.json', { schemaVersion: 'wfc.preparer.offline-seed-attempt.v1', operationId: intent.operationId,
    intent: await pin(intentPath), startedAt, verifierMode, finalizationMode, sourceClosure, sourceLockScope: 'main5180', qualification: 'NOT_RUN' });
  let docker, original, resourceBaseline, outsideBaseline, primary, captured, resume, companionPin;
  const check = () => { signal?.throwIfAborted(); };
  const witness = async () => { check(); await readIntent(intentPath, intentSha256); return sourceWitness(intent, await docker.containers()); };
  try {
    captured = await withBoundedDockerExecution(OFFLINE_SEED_BOUNDS, async () => {
      check(); docker = supplied ?? await createDocker(); const all = await docker.containers(); original = sourceWitness(intent, all);
      assertDestinations(intent, operationDirectory, original);
      resourceBaseline = await resources(docker, original);
      outsideBaseline = all.filter(item => !ROLES.some(role => original[role].Id === item.Id)).map(item => ({ ...containerIdentity(item), active: active(item) })).sort((a,b) => a.id.localeCompare(b.id));
      const roles = Object.fromEntries(ROLES.map(role => [role, { ...containerIdentity(original[role]), wasActive: active(original[role]),
        running: original[role].State.Running === true, restarting: original[role].State.Restarting === true }]));
      await proof('source-before.private.json', { roles, resources: resourceBaseline.identity, allocation: resourceBaseline.allocation });
      await writePrivateJson(intent.privateCompanion, { schemaVersion: 'wfc.preparer.offline-seed-private.v1', operationId: intent.operationId,
        roles: Object.fromEntries(ROLES.map(role => [role, { id: original[role].Id, image: original[role].Image, config: original[role].Config,
          hostConfig: original[role].HostConfig, mounts: original[role].Mounts, networks: original[role].NetworkSettings?.Networks ?? {} }])) });
      companionPin = await pin(intent.privateCompanion);
      const helper = async (command, mounts) => {
        check(); const result = await docker.run(intent.helperImage, { network: 'none', mounts, cmd: [...PACK, ...command],
          labels: { 'wfc.preparer.sp1.operation': intent.operationId, 'wfc.preparer.sp1.purpose': 'offline-seed-archive' } });
        need(result?.status === 'PASS', 'SP1_ARCHIVE_HELPER_FAILED'); return result;
      };
      const mounts = { postgres: dataMount(original.postgres, '/var/lib/postgresql'), minio: dataMount(original.minio, '/data'), staging: dataMount(original.api, intent.source.stagingDestination) };
      let sourceBytes = 0;
      for (const mount of Object.values(mounts)) { const measured = await helper(['measure', '/source'], [mount]);
        need(Number.isSafeInteger(measured.totalBytes) && measured.totalBytes >= 0, 'SP1_MEASUREMENT_INVALID'); sourceBytes += measured.totalBytes; }
      const images = [];
      for (const role of [...ROLES, 'helper']) {
        const id = role === 'helper' ? intent.helperImage : original[role].Image, image = await docker.inspectImage(id);
        need(image.Id === id && image.Os === 'linux' && image.Architecture === 'amd64' && Number.isSafeInteger(image.Size) && image.Size > 0, 'SP1_IMAGE_INVALID');
        images.push({ role, id, os: image.Os, architecture: image.Architecture, exportMode: 'id-only', archive: role + '-image.tar', estimatedBytes: image.Size });
      }
      const required = Math.ceil((sourceBytes + images.reduce((sum, image) => sum + image.estimatedBytes, 0)) * 1.3) + 512 * 1024 ** 2;
      const space = await fs.statfs(operationDirectory, { bigint: true });
      need(Number.isSafeInteger(required) && required > 0 && BigInt(required) <= space.bavail * space.bsize, 'SP1_BACKUP_SPACE_INSUFFICIENT');
      await proof('space.private.json', { requiredBytes: String(required), availableBytes: String(space.bavail * space.bsize) });
      // Immutable image IDs can be exported before downtime. No tag lookup or image load occurs.
      for (const image of images) {
        await witness(); await docker.command(['image', 'save', '--output', file(image.archive), image.id]);
        await verifier(file(image.archive), image); check();
      }
      // PG is stopped before, throughout and after every source operation; there is no PG start path.
      for (const role of ['web', 'api', 'minio']) { const now = (await witness())[role];
        await stopExact(docker, now); }
      const cold = await witness(); need(['api', 'web', 'minio'].every(role => !active(cold[role])), 'SP1_SOURCE_NOT_COLD');
      const archiveRecords = [];
      const assertCold = async () => { const value = await witness(); need(ROLES.every(role => !active(value[role])), 'SP1_SOURCE_NOT_COLD'); return value; };
      for (const [role, mount] of Object.entries(mounts)) {
        await assertCold();
        const name = role + '.wfcops', result = await helper(['capture', '/source', '/backup/' + name], [mount, privateMount(operationDirectory, '/backup', false)]);
        await assertCold();
        const verified = await helper(['verify', '/backup/' + name, result.sha256], [privateMount(operationDirectory, '/backup')]);
        await assertCold();
        const saved = await pin(file(name)); need(saved.sha256 === result.sha256 && verified.sha256 === saved.sha256 && saved.bytes === result.bytes, 'SP1_ARCHIVE_READBACK_MISMATCH');
        archiveRecords.push({ role, file: saved, members: result.members, files: result.files, totalBytes: result.totalBytes });
      }
      const after = await assertCold(), observed = await resources(docker, after, resourceBaseline.identity);
      need(same(resourceBaseline.identity, observed.identity), 'SP1_SOURCE_RESOURCES_CHANGED');
      await proof('source-cold.private.json', { roles: Object.fromEntries(ROLES.map(role => [role, { ...containerIdentity(after[role]), active: active(after[role]) }])),
        resources: observed.identity, allocation: observed.allocation });
      return { archives: archiveRecords, images: await Promise.all(images.map(async image => ({ ...image, file: await pin(file(image.archive)) }))) };
    });
  } catch (error) { primary = error; }
  // Recovery is independently bounded: an expired capture scope cannot suppress source-state restoration.
  if (docker && original) {
    try { resume = await withBoundedDockerExecution(RECOVERY_BOUNDS, async () => {
      const errors = [], resumed = [];
      for (const role of ['minio', 'api', 'web']) {
        try {
          const current = sourceWitness(intent, await docker.containers())[role];
          need(same(containerIdentity(current), containerIdentity(original[role])), 'SP1_RESUME_SOURCE_CHANGED');
          if (active(original[role]) && !active(current)) { await docker.start(current.Id); resumed.push(role); }
          const after = await docker.inspect(current.Id);
          need(active(after) === active(original[role]) && same(containerIdentity(after), containerIdentity(original[role])), 'SP1_RESUME_STATE_UNCONFIRMED');
        } catch (error) { errors.push({ role, code: safeCode(error) }); }
      }
      const all = await docker.containers(), finalSource = sourceWitness(intent, all), finalResources = await resources(docker, finalSource, resourceBaseline?.identity);
      const outside = all.filter(item => !ROLES.some(role => finalSource[role].Id === item.Id)).map(item => ({ ...containerIdentity(item), active: active(item) })).sort((a,b) => a.id.localeCompare(b.id));
      need(!resourceBaseline || same(resourceBaseline.identity, finalResources.identity), 'SP1_SOURCE_RESOURCES_CHANGED');
      need(!outsideBaseline || same(outsideBaseline, outside), 'SP1_OUTSIDE_SOURCE_CHANGED');
      const result = { status: errors.length ? 'FAIL' : 'PASS', resumed, errors, originalPostgresRemainsStopped: true,
        resources: finalResources.identity, allocation: finalResources.allocation };
      await proof('resume.private.json', result); need(!errors.length, 'SP1_SOURCE_RESUME_FAILED'); return result;
    }); } catch (error) { primary = primary ? new AggregateError([primary, error], 'SP1 capture or source recovery failed.') : error; }
  }
  if (primary) {
    await writeJsonNew(file('failure.private.json'), { schemaVersion: 'wfc.preparer.offline-seed-failure.v1', operationId: intent.operationId,
      status: 'FAIL', code: safeCode(primary), cleanup: getBoundedDockerCleanup(primary), sourceResume: resume?.status ?? 'UNCONFIRMED',
      sourceLockRetained: true, at: new Date().toISOString() });
    throw primary;
  }
  need(captured && resume?.status === 'PASS', 'SP1_SEED_INCOMPLETE');
  await readIntent(intentPath, intentSha256);
  for (const expected of sourceClosure) need(same(await pin(expected.path), expected), 'SP1_OPERATOR_SOURCE_CHANGED');
  for (const expected of evidence) need(same(await pin(expected.path), expected), 'SP1_EVIDENCE_CHANGED');
  need(companionPin && same(await pin(intent.privateCompanion), companionPin), 'SP1_PRIVATE_COMPANION_CHANGED');
  for (const item of [...captured.archives, ...captured.images]) need(same(await pin(item.file.path), item.file), 'SP1_CAPTURE_FILE_CHANGED');
  const result = { schemaVersion: 'wfc.preparer.offline-seed.v1', status: 'PASS', operationId: intent.operationId, sourcePort: 5180,
    qualification: 'NOT_RUN', releasableBackup: false, verifierMode, finalizationMode,
    productionSeed: verifierMode === 'production-default' && finalizationMode === 'production-default',
    intent: await pin(intentPath), privateCompanion: companionPin, sourceClosure, evidence,
    ...captured, sourceResume: await pin(file('resume.private.json')), completedAt: new Date().toISOString() };
  await writeJsonNew(file('seed.private.json'), result);
  const releasedLockPath = file('source-lock-released.private.json');
  let terminal, releaseAttempted = false;
  const assertLock = async () => {
    const currentLock = await fs.lstat(sourceLockPath);
    need(!currentLock.isSymbolicLink() && currentLock.dev === sourceLockStat.dev && currentLock.ino === sourceLockStat.ino
      && same(await pin(sourceLockPath), sourceLock), 'SP1_SOURCE_LOCK_CHANGED');
  };
  try {
    await assertLock();
    // Only fixed phase names reach this programmatic fault seam. It has no
    // CLI/environment entry and injected results cannot be production seeds.
    await testFinalizationObserver?.('before-complete');
    const complete = { schemaVersion: 'wfc.preparer.offline-seed-complete.v2', operationId: intent.operationId,
      seed: await pin(file('seed.private.json')), productionSeed: result.productionSeed, sourceLockReleased: false,
      sourceLockRelease: { state: 'pending', source: sourceLock, archivedPath: releasedLockPath }, qualification: 'NOT_RUN' };
    // A terminal capture/restoration proof is durable before the source-wide
    // name can disappear. This marker records pending release, never success.
    await writeJsonNew(file('complete.private.json'), complete);
    need(same(JSON.parse(await fs.readFile(file('complete.private.json'), 'utf8')), complete), 'SP1_COMPLETE_READBACK_MISMATCH');
    terminal = await pin(file('complete.private.json'));
    await testFinalizationObserver?.('before-lock-release');
    await assertLock();
    need(same(await pin(terminal.path), terminal), 'SP1_COMPLETE_READBACK_MISMATCH');
    try { await fs.lstat(releasedLockPath); need(false, 'SP1_SOURCE_LOCK_RELEASE_DESTINATION_EXISTS'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    releaseAttempted = true;
    // Both paths are on the same owned filesystem. Rename archives the exact
    // immutable lock atomically; there is no unlink-then-marker-write gap.
    await fs.rename(sourceLockPath, releasedLockPath);
    await testFinalizationObserver?.('after-lock-release');
    const released = await fs.lstat(releasedLockPath), archivedLock = await pin(releasedLockPath);
    need(!released.isSymbolicLink() && released.dev === sourceLockStat.dev && released.ino === sourceLockStat.ino
      && same(archivedLock, { ...sourceLock, path: releasedLockPath }), 'SP1_SOURCE_LOCK_RELEASE_UNCONFIRMED');
    try { await fs.lstat(sourceLockPath); need(false, 'SP1_SOURCE_LOCK_RELEASE_UNCONFIRMED'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    need(same(await pin(terminal.path), terminal), 'SP1_COMPLETE_READBACK_MISMATCH');
    return { ...result, sourceLockReleased: true, sourceLockRelease: { state: 'confirmed', terminal, archivedLock } };
  } catch (error) {
    // Never reacquire/delete another lock or replay source actions on an
    // uncertain rename. Completion + the bound archived lock permit inspection.
    const failure = releaseAttempted ? Object.assign(Error('SP1_SOURCE_LOCK_RELEASE_UNCONFIRMED'), {
      code: 'SP1_SOURCE_LOCK_RELEASE_UNCONFIRMED', cause: error }) : error;
    try { await writeJsonNew(file('finalization-failure.private.json'), {
      schemaVersion: 'wfc.preparer.offline-seed-finalization-failure.v1', operationId: intent.operationId,
      status: 'FAIL', code: safeCode(failure), causeCode: safeCode(error), terminal: terminal ?? null,
      sourceLockState: releaseAttempted ? 'unconfirmed' : 'retained', archivedLockPath: releasedLockPath, at: new Date().toISOString() }); }
    catch { /* An unavailable evidence filesystem cannot justify release or retry. */ }
    throw failure;
  }
}

export async function main(args) {
  need(args.length === 7 && args[0] === 'capture' && args[1] === '--intent' && args[3] === '--intent-sha256' && args[5] === '--operation', 'SP1_ARGUMENT_INVALID');
  const result = await captureOfflineSeed({ intentPath: args[2], intentSha256: args[4], operationDirectory: args[6] });
  console.log(JSON.stringify({ status: result.status, operationId: result.operationId, qualification: 'NOT_RUN', releasableBackup: false }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => {
  console.log(JSON.stringify({ status: 'FAIL', code: safeCode(error) })); process.exitCode = 1;
});
