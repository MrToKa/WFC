import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDocker, environment, writePrivateJson } from './foundation/docker.mjs';
import { withBoundedDockerExecution, getBoundedDockerCleanup } from './foundation/docker-bounds.mjs';
import { assertCanonicalPath, hashFile } from './foundation/archives.mjs';
import { verifyArchive as verifyPostgresArchive } from './pg-root-archives.mjs';
import { writeJsonNew } from './foundation/manifest.mjs';
import { canonicalSha256, sourceWitness, validateIntent, OFFLINE_SEED_BOUNDS } from './offline-seed.mjs';
import { compareCurrentInventories } from './recovery-leaves/current-inventory-lib.mjs';
import { capturePublicGlobals, validatePublicGlobals } from './recovery-leaves/global-sql-v2.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/, IMAGE = /^sha256:[a-f0-9]{64}$/;
const need = (value, code) => { if (!value) throw Object.assign(Error(code), { code }); };
const same = (a, b) => canonicalSha256(a) === canonicalSha256(b);
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const active = value => value?.State?.Running === true || value?.State?.Restarting === true;
const codeFor = error => /^[A-Z0-9_]{3,80}$/.test(error?.code ?? '') ? error.code : 'SP1_RECOVERY_FAILED';
const mount = (source, target, readOnly = true, type = 'bind') => ({ Type: type, Source: source, Target: target, ReadOnly: readOnly });
const pin = async filename => ({ path: filename, ...await hashFile(filename) });
export const RECOVERED_SEED_BOUNDS = Object.freeze({ ...OFFLINE_SEED_BOUNDS, archiveOwnership: undefined, helperMemoryBytes: 1024 ** 3 });
const SHORT_BOUNDS = Object.freeze({ ...RECOVERED_SEED_BOUNDS, operationTimeoutMs: 600000, commandTimeoutMs: 180000, requestTimeoutMs: 180000, helperTimeoutMs: 180000 });
const LEAVES = ['losslessInventory.ts', 'current-inventory-lib.mjs', 'global-sql-v2.mjs'];

async function readJson(filename, expectedSha256, maximum = 8 * 1024 ** 2) {
  await assertCanonicalPath(filename); const before = await fs.lstat(filename), bytes = await fs.readFile(filename);
  need(bytes.length > 0 && bytes.length <= maximum && (!expectedSha256 || createHash('sha256').update(bytes).digest('hex') === expectedSha256), 'SP1_RECOVERY_FILE_CHANGED');
  const after = await fs.lstat(filename); need(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'SP1_RECOVERY_FILE_CHANGED');
  try { const value = JSON.parse(bytes); need(record(value), 'SP1_RECOVERY_JSON_INVALID'); return value; } catch { need(false, 'SP1_RECOVERY_JSON_INVALID'); }
}
async function assertPin(value) {
  need(record(value) && typeof value.path === 'string' && path.isAbsolute(value.path) && SHA.test(value.sha256 ?? '') && Number.isSafeInteger(value.bytes) && value.bytes > 0, 'SP1_RECOVERY_PIN_INVALID');
  need(same(await pin(value.path), value), 'SP1_RECOVERY_FILE_CHANGED');
}
const contained = (root, value) => path.dirname(path.resolve(value)) === path.resolve(root);
export function validateRecoveryArguments(value) {
  need(record(value) && Object.keys(value).filter(key => key !== 'modelAudit').sort().join(',') === 'captureImage,operationDirectory,seedPath,seedSha256'
    && (!Object.hasOwn(value, 'modelAudit') || typeof value.modelAudit === 'boolean')
    && [value.seedPath, value.operationDirectory].every(item => typeof item === 'string' && path.isAbsolute(item))
    && SHA.test(value.seedSha256 ?? '') && IMAGE.test(value.captureImage ?? ''), 'SP1_RECOVERY_ARGUMENT_INVALID');
  const name = path.basename(value.operationDirectory), operationId = name.slice('sp1-recovery-'.length);
  need(name === 'sp1-recovery-' + operationId && UUID.test(operationId), 'SP1_RECOVERY_OPERATION_INVALID');
  return Object.freeze({ ...value, operationId });
}
export function recoveryResourceNames(operationId, { modelAudit = false } = {}) {
  need(UUID.test(operationId ?? ''), 'SP1_RECOVERY_OPERATION_INVALID'); const prefix = 'wfc-preparer-sp1-' + operationId;
  need(typeof modelAudit === 'boolean', 'SP1_RECOVERY_ARGUMENT_INVALID');
  return Object.freeze({ network: prefix, physical: prefix + '-physical', logical: prefix + '-logical', ...(modelAudit ? { minio: prefix + '-minio' } : {}) });
}
export function assertOwnedRecoveryResource(value, { operationId, seedSha256, purpose, name }) {
  const labels = value?.Labels ?? value?.Config?.Labels;
  need((value?.Name === name || value?.Name === '/' + name) && labels?.['wfc.preparer.sp1.operation'] === operationId
    && labels?.['wfc.preparer.sp1.seed'] === seedSha256 && labels?.['wfc.preparer.sp1.purpose'] === purpose, 'SP1_RECOVERY_OWNERSHIP_LOST');
  return value;
}
export function assertStoppedRecoveryClone(value, { id, image, volume, destination, networkId, operationId, seedSha256, purpose, name }) {
  assertOwnedRecoveryResource(value, { operationId, seedSha256, purpose, name });
  const planned = value.HostConfig?.Mounts, effective = value.Mounts;
  // Docker Engine omits the false default from HostConfig.Mounts.ReadOnly.
  // Admit exactly absence or boolean false, then check the effective RW mount.
  need(value.Id === id && SHA.test(id ?? '') && value.Image === image && !active(value) && value.HostConfig?.NetworkMode === networkId
    && Object.keys(value.HostConfig.PortBindings ?? {}).length === 0 && value.HostConfig.PublishAllPorts !== true
    && planned?.length === 1 && record(planned[0]) && planned[0].Type === 'volume' && planned[0].Source === volume && planned[0].Target === destination
    && (!Object.hasOwn(planned[0], 'ReadOnly') || planned[0].ReadOnly === false)
    && effective?.length === 1 && effective[0].Type === 'volume' && effective[0].Name === volume && effective[0].Destination === destination && effective[0].RW === true,
  purpose === 'minio' ? 'SP1_RECOVERY_MINIO_CHANGED' : 'SP1_RECOVERY_CLONE_CHANGED');
  return value;
}
/** Private diagnostics deliberately exclude Env, command arguments, foreign
 * labels and arbitrary Docker error text. Keep omitted fields distinguishable. */
export function recoveryCloneWitness(value) {
  const select = (input, keys) => Object.fromEntries(keys.filter(key => input && Object.hasOwn(input, key)).map(key => [key, input[key]]));
  const host = select(value?.HostConfig, ['NetworkMode', 'PublishAllPorts', 'PortBindings', 'RestartPolicy', 'ReadonlyRootfs', 'CapAdd', 'CapDrop', 'SecurityOpt', 'Privileged', 'Memory', 'MemorySwap', 'NanoCpus', 'PidsLimit', 'Tmpfs']);
  if (Array.isArray(value?.HostConfig?.Mounts)) host.Mounts = value.HostConfig.Mounts.map(item => ({ ...select(item, ['Type', 'Source', 'Target', 'ReadOnly']), readOnlyPresent: Boolean(item && Object.hasOwn(item, 'ReadOnly')) }));
  return { ...select(value, ['Id', 'Name', 'Image']),
    Config: { ...select(value?.Config, ['User', 'Entrypoint']), Labels: select(value?.Config?.Labels, ['wfc.preparer.sp1.operation', 'wfc.preparer.sp1.seed', 'wfc.preparer.sp1.purpose']) },
    HostConfig: host, Mounts: Array.isArray(value?.Mounts) ? value.Mounts.map(item => select(item, ['Type', 'Name', 'Source', 'Destination', 'RW', 'Propagation'])) : null,
    Networks: Object.fromEntries(Object.entries(value?.NetworkSettings?.Networks ?? {}).map(([name, network]) => [name, select(network, ['NetworkID', 'EndpointID', 'Aliases'])])),
    State: select(value?.State, ['Status', 'Running', 'Restarting', 'Pid', 'ExitCode', 'OOMKilled', 'StartedAt', 'FinishedAt']) };
}
export function assertRecoveryPostgres(value, { image, volume, networkId, operationId, seedSha256, purpose, name }) {
  assertOwnedRecoveryResource(value, { operationId, seedSha256, purpose, name });
  need(value.Image === image && SHA.test(value.Id ?? '') && value.HostConfig?.PublishAllPorts !== true
    && Object.keys(value.HostConfig?.PortBindings ?? {}).length === 0 && value.HostConfig?.RestartPolicy?.Name === 'no'
    && value.Mounts?.length === 1 && value.Mounts[0].Type === 'volume' && value.Mounts[0].Name === volume
    && value.Mounts[0].Destination === '/var/lib/postgresql' && value.Mounts[0].RW === true
    && Object.keys(value.NetworkSettings?.Networks ?? {}).length === 1
    && Object.values(value.NetworkSettings.Networks)[0].NetworkID === networkId, 'SP1_RECOVERY_CLONE_CHANGED');
  return value;
}
/** Admit only the exact archived PGDATA directory, never a parent or alias.
 * PostgreSQL must run with its verified non-root UID; primary GID zero is valid. */
export function verifiedPostgresDataIdentity(pgdata, entries) {
  need(typeof pgdata === 'string' && pgdata.startsWith('/var/lib/postgresql/') && !pgdata.split('/').includes('..') && !pgdata.includes('\0'), 'SP1_RECOVERY_PGDATA_INVALID');
  need(Array.isArray(entries), 'SP1_RECOVERY_PGDATA_UNVERIFIED');
  const relative = pgdata.slice('/var/lib/postgresql/'.length), directory = entries.find(item => item?.path === relative), version = entries.find(item => item?.path === relative + '/PG_VERSION');
  need(directory?.type === 'directory' && Number.isSafeInteger(directory.uid) && directory.uid > 0 && directory.uid <= 0xfffffffe
    && Number.isSafeInteger(directory.gid) && directory.gid >= 0 && directory.gid <= 0xfffffffe && !Object.is(directory.gid, -0)
    && version?.type === 'file', 'SP1_RECOVERY_PGDATA_UNVERIFIED');
  return Object.freeze({ pgdata, uid: directory.uid, gid: directory.gid, user: String(directory.uid) + ':' + String(directory.gid) });
}
export function assertRecoveryMinio(value, { id, image, volume, networkId, operationId, seedSha256, name, user }) {
  assertOwnedRecoveryResource(value, { operationId, seedSha256, purpose: 'minio', name });
  need(value.Id === id && SHA.test(id ?? '') && value.Image === image && value.Config?.User === user
    && same(value.Config?.Cmd, ['minio', 'server', '/data', '--address', ':9000', '--console-address', ':9001'])
    && value.HostConfig?.PublishAllPorts !== true && Object.keys(value.HostConfig?.PortBindings ?? {}).length === 0
    && value.HostConfig?.RestartPolicy?.Name === 'no' && value.Mounts?.length === 1
    && value.Mounts[0].Type === 'volume' && value.Mounts[0].Name === volume && value.Mounts[0].Destination === '/data' && value.Mounts[0].RW === true
    && Object.keys(value.NetworkSettings?.Networks ?? {}).length === 1 && Object.values(value.NetworkSettings.Networks)[0].NetworkID === networkId,
  'SP1_RECOVERY_MINIO_CHANGED');
  return value;
}
export function validateModelAuditSummary(value) {
  // The fixed auditor emits a bounded code-only failure DTO. Preserve that
  // concrete outcome after its stdout is retained privately by the caller.
  if (record(value) && Object.keys(value).sort().join(',') === 'code,status' && value.status === 'FAIL'
    && typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{2,79}$/.test(value.code)) need(false, value.code);
  const fields = ['archivesSchema', 'counts', 'readOnly', 'reportBytes', 'reportSha256', 'status'];
  const counts = ['models', 'resources', 'resourceBytes', 'archives', 'archiveBytes', 'legacyArchiveAbsent', 'retainedIndependentArchives', 'unavailableDeclarations'];
  need(record(value) && Object.keys(value).sort().join(',') === fields.sort().join(',') && value.status === 'PASS' && value.readOnly === true
    && ['PRESENT', 'ABSENT_OLD_SCHEMA'].includes(value.archivesSchema) && SHA.test(value.reportSha256 ?? '')
    && Number.isSafeInteger(value.reportBytes) && value.reportBytes > 0 && value.reportBytes <= 256 * 1024 ** 2
    && record(value.counts) && Object.keys(value.counts).sort().join(',') === counts.sort().join(',')
    && Object.values(value.counts).every(count => Number.isSafeInteger(count) && count >= 0), 'SP1_RECOVERY_MODEL_AUDIT_INVALID');
  return value;
}
/** Match createModelStorage's source-API configuration. Generic project-file
 * storage is a separate bucket and cannot supply model-resource authority. */
export function recoveryModelBucket(sourceApiEnvironment) {
  need(sourceApiEnvironment instanceof Map, 'SP1_RECOVERY_MODEL_BUCKET_INVALID');
  const bucket = sourceApiEnvironment.get('WFC_MODEL_BUCKET') ?? 'wfc-models';
  need(typeof bucket === 'string' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket), 'SP1_RECOVERY_MODEL_BUCKET_INVALID');
  return bucket;
}
async function pinPackageClosure(directory) {
  const files = []; let bytes = 0;
  const visit = async current => {
    await assertCanonicalPath(current, { directory: true });
    for (const name of (await fs.readdir(current)).sort()) {
      const filename = path.join(current, name), stat = await fs.lstat(filename);
      need(!stat.isSymbolicLink(), 'SP1_RECOVERY_PACKAGE_CLOSURE_INVALID');
      if (stat.isDirectory()) await visit(filename);
      else { need(stat.isFile() && stat.nlink === 1 && files.length < 256 && (bytes += stat.size) <= 32 * 1024 ** 2, 'SP1_RECOVERY_PACKAGE_CLOSURE_INVALID'); files.push(await pin(filename)); }
    }
  };
  await visit(directory); need(files.some(file => file.path === path.join(directory, 'index.mjs')), 'SP1_RECOVERY_PACKAGE_CLOSURE_INVALID'); return files;
}
/** Fixed health probe accepts only this operation's private clone DNS name. */
export async function waitRecoveryMinio({ host, ownerId }, { request = http.request, signal } = {}) {
  need(UUID.test(ownerId ?? '') && host === recoveryResourceNames(ownerId, { modelAudit: true }).minio, 'SP1_RECOVERY_MINIO_HOST_INVALID');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const ready = await new Promise(resolve => {
      let done = false, timer; const finish = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
      const req = request({ hostname: host, port: 9000, path: '/minio/health/ready', method: 'GET', signal,
        timeout: Math.max(1, Math.min(2000, deadline - Date.now())) }, res => {
        let bytes = 0; res.on('data', chunk => { bytes += chunk.length; if (bytes > 4096) req.destroy(); });
        res.once('end', () => finish(res.statusCode === 200 && bytes <= 4096)); res.once('error', () => finish(false)); res.resume();
      });
      req.once('error', () => finish(false)); req.once('timeout', () => { req.destroy(); finish(false); });
      if (!done) timer = setTimeout(() => { req.destroy(); finish(false); }, Math.max(1, Math.min(2000, deadline - Date.now())));
      req.end();
    });
    if (ready) return { status: 'PASS', ownerId, publishedPorts: false };
    await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(250, deadline - Date.now()))));
  }
  need(false, 'SP1_RECOVERY_MINIO_NOT_READY');
}

/** Verifies the terminal cold receipt. No Docker mutation or original DB start. */
export async function verifyColdSeed(seedPath, seedSha256) {
  need(typeof seedPath === 'string' && path.isAbsolute(seedPath) && path.basename(seedPath) === 'seed.private.json' && SHA.test(seedSha256 ?? ''), 'SP1_RECOVERY_ARGUMENT_INVALID');
  const seed = await readJson(seedPath, seedSha256), directory = path.dirname(seedPath);
  need(seed.schemaVersion === 'wfc.preparer.offline-seed.v1' && seed.status === 'PASS' && UUID.test(seed.operationId ?? '')
    && seed.sourcePort === 5180 && seed.productionSeed === true && seed.verifierMode === 'production-default'
    && seed.finalizationMode === 'production-default' && seed.qualification === 'NOT_RUN' && seed.releasableBackup === false, 'SP1_PRODUCTION_COLD_SEED_REQUIRED');
  const complete = await readJson(path.join(directory, 'complete.private.json'));
  need(complete.schemaVersion === 'wfc.preparer.offline-seed-complete.v2' && complete.operationId === seed.operationId
    && complete.productionSeed === true && complete.sourceLockReleased === false && complete.sourceLockRelease?.state === 'pending'
    && same(complete.seed, await pin(seedPath)) && complete.sourceLockRelease.archivedPath === path.join(directory, 'source-lock-released.private.json'), 'SP1_COLD_SEED_INCOMPLETE');
  const released = await pin(complete.sourceLockRelease.archivedPath);
  need(same(released, { ...complete.sourceLockRelease.source, path: complete.sourceLockRelease.archivedPath }), 'SP1_SOURCE_LOCK_RELEASE_UNCONFIRMED');
  try { await fs.lstat(complete.sourceLockRelease.source.path); need(false, 'SP1_SOURCE_LOCK_BUSY'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  need(Array.isArray(seed.archives) && seed.archives.length === 3 && ['postgres', 'minio', 'staging'].every(role => seed.archives.filter(item => item.role === role).length === 1)
    && Array.isArray(seed.images) && seed.images.length === 5 && ['postgres', 'minio', 'api', 'web', 'helper'].every(role => seed.images.filter(item => item.role === role).length === 1)
    && Array.isArray(seed.sourceClosure) && seed.sourceClosure.length >= 6 && seed.sourceClosure.length <= 16 && Array.isArray(seed.evidence) && seed.evidence.length <= 128, 'SP1_COLD_SEED_SCOPE_INVALID');
  for (const item of [...seed.archives, ...seed.images]) { need(contained(directory, item.file?.path ?? '') && item.file.path === path.join(directory, item.role + (seed.archives.includes(item) ? '.wfcops' : '-image.tar')), 'SP1_COLD_SEED_SCOPE_INVALID'); await assertPin(item.file); }
  for (const required of ['offline-seed.mjs', 'foundation/docker.mjs', 'foundation/docker-bounds.mjs', 'foundation/archives.mjs', 'foundation/manifest.mjs', 'foundation/provenance.json']) need(seed.sourceClosure.some(item => item.path === path.join(HERE, required)), 'SP1_COLD_SEED_OPERATOR_CLOSURE');
  for (const item of [...seed.sourceClosure, ...seed.evidence, seed.intent, seed.privateCompanion, seed.sourceResume]) await assertPin(item);
  const intent = validateIntent(await readJson(seed.intent.path, seed.intent.sha256)), companion = await readJson(seed.privateCompanion.path, seed.privateCompanion.sha256);
  need(intent.operationId === seed.operationId && companion.schemaVersion === 'wfc.preparer.offline-seed-private.v1' && companion.operationId === seed.operationId, 'SP1_COLD_SEED_SCOPE_INVALID');
  for (const role of ['api', 'web', 'postgres', 'minio']) need(companion.roles?.[role]?.id === intent.source.roles[role].id && companion.roles[role].image === intent.source.roles[role].image
    && canonicalSha256(companion.roles[role].config) === intent.source.roles[role].configSha256, 'SP1_PRIVATE_COMPANION_CHANGED');
  need(seed.images.find(item => item.role === 'helper').id === intent.helperImage && seed.images.every(item => item.id === (item.role === 'helper' ? intent.helperImage : intent.source.roles[item.role].image)), 'SP1_COLD_SEED_IMAGE_CHANGED');
  const resume = await readJson(seed.sourceResume.path, seed.sourceResume.sha256); need(resume.status === 'PASS' && resume.originalPostgresRemainsStopped === true, 'SP1_SOURCE_RESUME_UNCONFIRMED');
  return { seed, intent, companion, directory };
}

/** Root is the only actual executor. Adapters are fixed programmatic test seams;
 * injected capture/comparison results are never production qualification. */
export async function qualifyRecoveredSeed(argumentsValue, { docker: supplied, signal, capture: injectedCapture, compare: injectedCompare } = {}) {
  const args = validateRecoveryArguments(argumentsValue), verified = await verifyColdSeed(args.seedPath, args.seedSha256);
  const parent = await assertCanonicalPath(path.join(ROOT, '.preparer-work'), { directory: true });
  need(path.resolve(args.operationDirectory) === path.join(parent, 'sp1-recovery-' + args.operationId), 'SP1_RECOVERY_OPERATION_INVALID');
  need(injectedCapture === undefined || typeof injectedCapture === 'function', 'SP1_RECOVERY_ADAPTER_INVALID');
  need(injectedCompare === undefined || typeof injectedCompare === 'function', 'SP1_RECOVERY_ADAPTER_INVALID');
  const production = supplied === undefined && injectedCapture === undefined && injectedCompare === undefined;
  const modelAudit = args.modelAudit === true, names = recoveryResourceNames(args.operationId, { modelAudit });
  const packageDirectory = path.join(ROOT, 'server', 'vendor', 'routings-model-package');
  await fs.mkdir(args.operationDirectory, { mode: 0o700 }); const file = name => path.join(args.operationDirectory, name);
  const labels = purpose => ({ 'wfc.preparer.sp1.operation': args.operationId, 'wfc.preparer.sp1.seed': args.seedSha256, 'wfc.preparer.sp1.purpose': purpose });
  const sourceClosure = [];
  for (const name of ['recovery.mjs', 'recovery.capture.Dockerfile', 'recovery-leaves/provenance.json', ...LEAVES.map(name => 'recovery-leaves/' + name)]) sourceClosure.push(await pin(path.join(HERE, name)));
  if (modelAudit) { sourceClosure.push(await pin(path.join(HERE, 'model-audit.mjs'))); sourceClosure.push(...await pinPackageClosure(packageDirectory)); }
  const leafProvenance = await readJson(path.join(HERE, 'recovery-leaves/provenance.json'));
  need(leafProvenance.mode === 'exact-byte-copy' && leafProvenance.files?.length === LEAVES.length, 'SP1_RECOVERY_LEAF_PROVENANCE');
  for (const leaf of leafProvenance.files) need(LEAVES.includes(leaf.path) && same(await hashFile(path.join(HERE, 'recovery-leaves', leaf.path)), { bytes: leaf.bytes, sha256: leaf.sha256 }), 'SP1_RECOVERY_LEAF_CHANGED');
  const evidence = [], proof = async (name, value) => { await writeJsonNew(file(name), value); const result = await pin(file(name)); evidence.push(result); return result; };
  let cloneGuardSequence = 0;
  const recordCloneGuard = (purpose, phase, actual, expected) => proof('clone-guard-' + String(++cloneGuardSequence).padStart(3, '0') + '-' + purpose + '-' + phase + '.private.json', {
    schemaVersion: 'wfc.preparer.clone-guard-witness.v1', purpose, phase, expected, actual: recoveryCloneWitness(actual) });
  await proof('begin.private.json', { schemaVersion: 'wfc.preparer.recovery-attempt.v1', operationId: args.operationId, seed: await pin(args.seedPath), captureImage: args.captureImage, sourceClosure, production, startedAt: new Date().toISOString() });
  const lockPath = path.join(parent, 'main5180-recovery.lock');
  await writeJsonNew(lockPath, { schemaVersion: 'wfc.preparer.recovery-lock.v1', operationId: args.operationId, seedSha256: args.seedSha256, operationDirectory: args.operationDirectory });
  const lockPin = await pin(lockPath); let docker, network, physical, logical, minioVolume, minioIdentity, postgresImage, pgIdentity, baselineSource, cleanupSafe = false, primary, result;
  const check = () => signal?.throwIfAborted();
  const witness = async () => { check(); return sourceWitness(verified.intent, await docker.containers()); };
  const volumeSpec = purpose => ({ operationId: args.operationId, seedSha256: args.seedSha256, purpose, name: names[purpose] });
  try {
    await withBoundedDockerExecution(OFFLINE_SEED_BOUNDS, async () => {
      docker = supplied ?? await createDocker(); baselineSource = await witness();
      await proof('source-before.private.json', { postgres: { id: baselineSource.postgres.Id, image: baselineSource.postgres.Image, stopped: !active(baselineSource.postgres) }, sourceIntentSha256: verified.seed.intent.sha256 });
      postgresImage = verified.intent.source.roles.postgres.image;
      const image = await docker.inspectImage(postgresImage), captureImage = await docker.inspectImage(args.captureImage);
      need(image.Id === postgresImage && image.Os === 'linux' && image.Architecture === 'amd64'
        && captureImage.Id === args.captureImage && captureImage.Os === 'linux' && captureImage.Architecture === 'amd64'
        && captureImage.Config?.Labels?.['wfc.preparer.sp1.capture-node-base'] === verified.intent.helperImage
        && captureImage.Config.Labels['wfc.preparer.sp1.capture-dependency-base'] === verified.intent.source.roles.api.image, 'SP1_RECOVERY_IMAGE_INVALID');
      const sourceEnv = environment({ Config: verified.companion.roles.postgres.config }), apiEnv = environment({ Config: verified.companion.roles.api.config });
      const pgdata = sourceEnv.get('PGDATA'); need(typeof pgdata === 'string' && pgdata.startsWith('/var/lib/postgresql/') && !pgdata.split('/').includes('..') && !pgdata.includes('\0'), 'SP1_RECOVERY_PGDATA_INVALID');
      const archive = verified.seed.archives.find(item => item.role === 'postgres'), scanned = await verifyPostgresArchive(archive.file.path, { expectedSha256: archive.file.sha256, signal });
      const verifiedIdentity = verifiedPostgresDataIdentity(pgdata, scanned.entries);
      let connection; try { connection = new URL(apiEnv.get('DATABASE_URL')); } catch { need(false, 'SP1_RECOVERY_CONNECTION_INVALID'); }
      const username = decodeURIComponent(connection.username), password = decodeURIComponent(connection.password);
      need(username && password && decodeURIComponent(connection.pathname) === '/wfc_app' && (sourceEnv.get('POSTGRES_USER') || 'postgres') === username, 'SP1_RECOVERY_PRIVILEGED_CONNECTION_REQUIRED');
      pgIdentity = { pgdata, user: verifiedIdentity.user, username, password, database: 'wfc_app' };
      if (modelAudit) {
        const minioSource = verified.companion.roles.minio.config, minioEnv = environment({ Config: minioSource });
        const rootUser = minioEnv.get('MINIO_ROOT_USER') || minioEnv.get('MINIO_ACCESS_KEY'), rootPassword = minioEnv.get('MINIO_ROOT_PASSWORD') || minioEnv.get('MINIO_SECRET_KEY');
        const accessKey = apiEnv.get('MINIO_ACCESS_KEY'), secretKey = apiEnv.get('MINIO_SECRET_KEY'), bucket = recoveryModelBucket(apiEnv);
        need([rootUser, rootPassword, accessKey, secretKey].every(value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\x00-\x1f\x7f]/.test(value))
          && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket), 'SP1_RECOVERY_STORAGE_CREDENTIALS_REQUIRED');
        const minioImage = await docker.inspectImage(verified.intent.source.roles.minio.image);
        need(minioImage.Id === verified.intent.source.roles.minio.image && minioImage.Os === 'linux' && minioImage.Architecture === 'amd64', 'SP1_RECOVERY_IMAGE_INVALID');
        minioIdentity = { image: minioImage.Id, user: minioSource.User || minioImage.Config?.User || '', rootUser, rootPassword, accessKey, secretKey, bucket };
      }
      const minioArchive = modelAudit ? verified.seed.archives.find(item => item.role === 'minio') : null;
      if (modelAudit) need(Number.isSafeInteger(minioArchive?.totalBytes) && minioArchive.totalBytes >= 0, 'SP1_RECOVERY_MINIO_SEED_INVALID');
      const required = BigInt(Math.ceil(archive.totalBytes * 2.5 + (minioArchive ? minioArchive.totalBytes * 2.2 : 0) + 2 * 1024 ** 3)), available = await fs.statfs(args.operationDirectory, { bigint: true });
      need(required > 0n && available.bavail * available.bsize >= required, 'SP1_RECOVERY_SPACE_INSUFFICIENT');
      await proof('space.private.json', { requiredHostBytes: String(required), availableHostBytes: String(available.bavail * available.bsize), dockerVolumeCapacity: 'UNPROVEN; volume allocation failure remains fatal' });
      const networks = await docker.request('GET', '/networks'), volumes = await docker.request('GET', '/volumes');
      const volumeNames = [names.physical, names.logical, ...(modelAudit ? [names.minio] : [])];
      need(Array.isArray(networks) && !networks.some(item => item.Name === names.network) && Array.isArray(volumes.Volumes) && !volumes.Volumes.some(item => volumeNames.includes(item.Name)), 'SP1_RECOVERY_TARGET_EXISTS');
      await proof('resource-intents.private.json', { network: names.network, volumes: volumeNames, labels: labels('network') });
      const madeNetwork = await docker.request('POST', '/networks/create', { Name: names.network, Driver: 'bridge', Internal: true, Attachable: false, CheckDuplicate: true, Labels: labels('network') });
      need(SHA.test(madeNetwork?.Id ?? ''), 'SP1_RECOVERY_NETWORK_INVALID'); network = await docker.request('GET', '/networks/' + madeNetwork.Id);
      assertOwnedRecoveryResource(network, { operationId: args.operationId, seedSha256: args.seedSha256, purpose: 'network', name: names.network }); need(network.Internal === true && network.Driver === 'bridge' && Object.keys(network.Containers ?? {}).length === 0, 'SP1_RECOVERY_NETWORK_INVALID');
      for (const purpose of ['physical', 'logical']) {
        await witness(); const created = await docker.request('POST', '/volumes/create', { Name: names[purpose], Driver: 'local', Labels: labels(purpose) });
        assertOwnedRecoveryResource(created, volumeSpec(purpose)); need(created.Driver === 'local' && Object.keys(created.Options ?? {}).length === 0, 'SP1_RECOVERY_VOLUME_INVALID');
        if (purpose === 'physical') physical = created; else logical = created;
        const restored = await docker.run(verified.intent.helperImage, { network: 'none', labels: { 'wfc.preparer.sp1.operation': args.operationId, 'wfc.preparer.sp1.purpose': 'offline-seed-archive' }, mounts: [mount(verified.directory, '/backup'), mount(created.Name, '/target', false, 'volume')], cmd: ['node', 'scripts/operations/pg-root-archives.mjs', 'restore', '/backup/postgres.wfcops', '/target', archive.file.sha256] });
        need(restored.status === 'PASS' && restored.sha256 === archive.file.sha256 && restored.targetFresh === true && restored.fullOuterHashVerifiedBeforeWrites === true, 'SP1_RECOVERY_PHYSICAL_RESTORE_FAILED');
        const prestart = file(purpose + '-prestart'); await fs.mkdir(prestart, { mode: 0o700 });
        const recaptured = await docker.run(verified.intent.helperImage, { network: 'none', labels: { 'wfc.preparer.sp1.operation': args.operationId, 'wfc.preparer.sp1.purpose': 'offline-seed-archive' }, mounts: [mount(created.Name, '/source', true, 'volume'), mount(prestart, '/backup', false)], cmd: ['node', 'scripts/operations/pg-root-archives.mjs', 'capture', '/source', '/backup/postgres.wfcops'] });
        need(recaptured.status === 'PASS' && recaptured.sha256 === archive.file.sha256 && same(await hashFile(path.join(prestart, 'postgres.wfcops')), { bytes: archive.file.bytes, sha256: archive.file.sha256 }), 'SP1_RECOVERY_PRESTART_BYTES_CHANGED');
        await proof(purpose + '-seed-proof.private.json', { volume: created, seed: archive.file, recapture: await pin(path.join(prestart, 'postgres.wfcops')), exactBeforeStartup: true });
      }
      if (modelAudit) {
        await witness(); minioVolume = await docker.request('POST', '/volumes/create', { Name: names.minio, Driver: 'local', Labels: labels('minio') });
        assertOwnedRecoveryResource(minioVolume, volumeSpec('minio')); need(minioVolume.Driver === 'local' && Object.keys(minioVolume.Options ?? {}).length === 0, 'SP1_RECOVERY_VOLUME_INVALID');
        const restored = await docker.run(verified.intent.helperImage, { network: 'none', labels: { 'wfc.preparer.sp1.operation': args.operationId, 'wfc.preparer.sp1.purpose': 'offline-seed-archive' },
          mounts: [mount(verified.directory, '/backup'), mount(minioVolume.Name, '/target', false, 'volume')], cmd: ['node', 'scripts/operations/archives.mjs', 'restore', '/backup/minio.wfcops', '/target', minioArchive.file.sha256] });
        need(restored.status === 'PASS' && restored.sha256 === minioArchive.file.sha256 && restored.targetFresh === true && restored.fullOuterHashVerifiedBeforeWrites === true, 'SP1_RECOVERY_MINIO_RESTORE_FAILED');
        const prestart = file('minio-prestart'); await fs.mkdir(prestart, { mode: 0o700 });
        const recaptured = await docker.run(verified.intent.helperImage, { network: 'none', labels: { 'wfc.preparer.sp1.operation': args.operationId, 'wfc.preparer.sp1.purpose': 'offline-seed-archive' },
          mounts: [mount(minioVolume.Name, '/source', true, 'volume'), mount(prestart, '/backup', false)], cmd: ['node', 'scripts/operations/archives.mjs', 'capture', '/source', '/backup/minio.wfcops'] });
        need(recaptured.status === 'PASS' && recaptured.sha256 === minioArchive.file.sha256
          && same(await hashFile(path.join(prestart, 'minio.wfcops')), { bytes: minioArchive.file.bytes, sha256: minioArchive.file.sha256 }), 'SP1_RECOVERY_MINIO_PRESTART_BYTES_CHANGED');
        await proof('minio-seed-proof.private.json', { volume: minioVolume, seed: minioArchive.file, recapture: await pin(path.join(prestart, 'minio.wfcops')), exactBeforeStartup: true });
      }
      await witness(); cleanupSafe = true;
    });
    const runtimeResult = await withBoundedDockerExecution(RECOVERED_SEED_BOUNDS, async () => {
      const assertClone = async (id, purpose) => {
        const actual = await docker.inspect(id), expected = { id, image: postgresImage, volume: names[purpose], networkId: network.Id, ...volumeSpec(purpose) };
        await recordCloneGuard(purpose, 'running', actual, expected);
        need(actual.Id === id, 'SP1_RECOVERY_CLONE_CHANGED'); return assertRecoveryPostgres(actual, expected);
      };
      const clone = async purpose => {
        await witness(); const created = await docker.create(names[purpose], { Image: postgresImage, User: pgIdentity.user, Env: ['PGDATA=' + pgIdentity.pgdata], Entrypoint: [], Cmd: ['postgres', '-D', pgIdentity.pgdata, '-c', 'listen_addresses=*', '-c', 'unix_socket_directories=/tmp'], Labels: labels(purpose), HostConfig: { NetworkMode: network.Id, Mounts: [mount(names[purpose], '/var/lib/postgresql', false, 'volume')], PortBindings: {}, PublishAllPorts: false, RestartPolicy: { Name: 'no' } } });
        need(SHA.test(created?.Id ?? '') && created.Id !== verified.intent.source.roles.postgres.id, 'SP1_RECOVERY_CLONE_INVALID');
        const stopped = await docker.inspect(created.Id), expected = { id: created.Id, image: postgresImage, volume: names[purpose], destination: '/var/lib/postgresql', networkId: network.Id, ...volumeSpec(purpose) };
        await recordCloneGuard(purpose, 'stopped', stopped, expected); assertStoppedRecoveryClone(stopped, expected);
        await docker.start(created.Id); await assertClone(created.Id, purpose);
        for (let attempts = 0;; attempts++) {
          check(); try { await docker.command(['exec', created.Id, 'pg_isready', '--host=/tmp', '--username=' + pgIdentity.username, '--dbname=' + pgIdentity.database], { maxBytes: 65536, signal }); break; }
          catch (error) { if (attempts >= 59) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
        }
        return created.Id;
      };
      const physicalId = await clone('physical'), logicalId = await clone('logical');
      let minioId = null;
      const assertMinio = async () => {
        const actual = await docker.inspect(minioId), expected = { id: minioId, image: minioIdentity.image, user: minioIdentity.user,
          volume: names.minio, networkId: network.Id, operationId: args.operationId, seedSha256: args.seedSha256, name: names.minio };
        await recordCloneGuard('minio', 'running', actual, expected); return assertRecoveryMinio(actual, expected);
      };
      const assertIsolatedNetwork = async () => {
        const current = await docker.request('GET', '/networks/' + network.Id);
        assertOwnedRecoveryResource(current, { operationId: args.operationId, seedSha256: args.seedSha256, purpose: 'network', name: names.network });
        need(current.Id === network.Id && current.Internal === true && current.Driver === 'bridge'
          && same(Object.keys(current.Containers ?? {}).sort(), [physicalId, logicalId, ...(minioId ? [minioId] : [])].sort()), 'SP1_RECOVERY_FOREIGN_NETWORK_CLIENT');
      };
      await assertIsolatedNetwork();
      await proof('clones-started.private.json', { physical: await assertClone(physicalId, 'physical'), logical: await assertClone(logicalId, 'logical'), originalPostgresStarted: false });
      const capture = async (purpose, id, captureName) => {
        await witness(); await assertIsolatedNetwork(); await assertClone(id, purpose); const name = captureName ?? (purpose === 'physical' ? 'recovered' : 'logical-restored');
        const connectionPath = file((captureName ?? purpose) + '-connection.private.json'); await writePrivateJson(connectionPath, { host: names[purpose], port: 5432, user: pgIdentity.username, password: pgIdentity.password, database: pgIdentity.database });
        let observed;
        if (injectedCapture) observed = await injectedCapture({ directory: file(name), ownerId: args.operationId, connectionPath, purpose, id });
        else observed = await docker.run(args.captureImage, { network: network.Id, mounts: [mount(HERE, '/operator'), mount(args.operationDirectory, '/proof', false)], labels: labels('capture-' + purpose), cmd: ['node', '--experimental-strip-types', '/operator/recovery.mjs', 'capture', '--directory', '/proof/' + name, '--owner', args.operationId, '--connection', '/proof/' + path.basename(connectionPath)] });
        need(observed?.status === 'PASS', 'SP1_RECOVERY_CAPTURE_FAILED'); await witness(); await assertIsolatedNetwork(); await assertClone(id, purpose);
        return { directory: file(name), summary: observed };
      };
      const baseline = await capture('physical', physicalId), dump = file('database.dump');
      await assertClone(physicalId, 'physical'); await docker.command(['exec', physicalId, 'pg_dump', '--no-password', '--format=custom', '--create', '--host=/tmp', '--username=' + pgIdentity.username, '--dbname=' + pgIdentity.database], { output: dump, maxBytes: 16 * 1024 ** 3, signal });
      await assertIsolatedNetwork();
      await docker.command(['exec', '--interactive', physicalId, 'pg_restore', '--list'], { input: dump, maxBytes: 16 * 1024 ** 2, signal });
      await proof('logical-dump.private.json', { sourceCloneId: physicalId, seedSha256: args.seedSha256, dump: await pin(dump), ownerAndAclPreserved: true });
      await assertClone(logicalId, 'logical');
      await docker.command(['exec', '--interactive', logicalId, 'pg_restore', '--no-password', '--exit-on-error', '--clean', '--if-exists', '--create', '--host=/tmp', '--username=' + pgIdentity.username, '--dbname=postgres'], { input: dump, maxBytes: 16 * 1024 ** 2, signal });
      await assertIsolatedNetwork();
      const restored = await capture('logical', logicalId), compare = injectedCompare ?? compareCurrentInventories;
      const comparison = await compare(path.join(baseline.directory, 'raw'), path.join(restored.directory, 'raw'), { comparison: 'exact', beforeOwnerId: args.operationId, afterOwnerId: args.operationId, signal });
      need(comparison.status === 'PASS', 'SP1_RECOVERY_RAW_MISMATCH');
      const globalsBefore = validatePublicGlobals(await readJson(path.join(baseline.directory, 'globals.private.json'))), globalsAfter = validatePublicGlobals(await readJson(path.join(restored.directory, 'globals.private.json')));
      need(globalsBefore.unsupportedObjects.length === 0 && globalsAfter.unsupportedObjects.length === 0, 'SP1_RECOVERY_GLOBAL_UNSUPPORTED');
      need(same(globalsBefore, globalsAfter), 'SP1_RECOVERY_GLOBAL_MISMATCH');
      const clusterBefore = await readJson(path.join(baseline.directory, 'cluster.private.json')), clusterAfter = await readJson(path.join(restored.directory, 'cluster.private.json'));
      need(same(clusterBefore, clusterAfter), 'SP1_RECOVERY_CLUSTER_CONTEXT_MISMATCH');
      await proof('comparison.private.json', { ...comparison, globalSql: 'PASS', globalSqlSha256: canonicalSha256(globalsBefore), clusterContext: 'PASS', clusterContextSha256: canonicalSha256(clusterBefore), rawRolePasswords: 'private evidence only' });
      let modelAuditProof;
      if (modelAudit) {
        await witness(); await assertIsolatedNetwork();
        const created = await docker.create(names.minio, { Image: minioIdentity.image, User: minioIdentity.user, Entrypoint: [],
          Cmd: ['minio', 'server', '/data', '--address', ':9000', '--console-address', ':9001'],
          Env: ['HOME=/tmp', 'MINIO_ROOT_USER=' + minioIdentity.rootUser, 'MINIO_ROOT_PASSWORD=' + minioIdentity.rootPassword, 'MINIO_BROWSER=off', 'MINIO_UPDATE=off'], Labels: labels('minio'),
          HostConfig: { NetworkMode: network.Id, Mounts: [mount(names.minio, '/data', false, 'volume')], PortBindings: {}, PublishAllPorts: false, RestartPolicy: { Name: 'no' } } });
        need(SHA.test(created?.Id ?? '') && created.Id !== verified.intent.source.roles.minio.id, 'SP1_RECOVERY_MINIO_INVALID');
        minioId = created.Id;
        const stopped = await docker.inspect(minioId), expected = { id: minioId, image: minioIdentity.image, volume: names.minio, destination: '/data', networkId: network.Id, ...volumeSpec('minio') };
        await recordCloneGuard('minio', 'stopped', stopped, expected); assertStoppedRecoveryClone(stopped, expected);
        await docker.start(minioId); await assertMinio(); await assertIsolatedNetwork();
        const ready = await docker.run(args.captureImage, { network: network.Id, mounts: [mount(HERE, '/operator')], labels: labels('minio-ready'),
          cmd: ['node', '--experimental-strip-types', '/operator/recovery.mjs', 'wait-minio', '--host', names.minio, '--owner', args.operationId] });
        need(ready?.status === 'PASS', 'SP1_RECOVERY_MINIO_NOT_READY'); await assertMinio(); await assertIsolatedNetwork();
        await proof('minio-started.private.json', { id: minioId, image: minioIdentity.image, volume: names.minio, networkId: network.Id, publishedPorts: false, readiness: 'PASS', sourceStorageWritten: false });
        const connectionPath = file('model-audit-connection.private.json'); await writePrivateJson(connectionPath, {
          database: { host: names.logical, port: 5432, user: pgIdentity.username, password: pgIdentity.password, database: pgIdentity.database },
          storage: { host: names.minio, port: 9000, useSSL: false, accessKey: minioIdentity.accessKey, secretKey: minioIdentity.secretKey, bucket: minioIdentity.bucket }, ownerId: args.operationId });
        const auditorStdout = await docker.run(args.captureImage, { network: network.Id,
          mounts: [mount(HERE, '/operator'), mount(packageDirectory, '/package'), mount(args.operationDirectory, '/proof', false)], labels: labels('model-audit'),
          cmd: ['node', '/operator/model-audit.mjs', '--connection', '/proof/model-audit-connection.private.json', '--directory', '/proof/model-audit', '--package-module', '/package/index.mjs',
            '--postgres-host', names.logical, '--minio-host', names.minio, '--owner', args.operationId] });
        await proof('model-audit-stdout.private.json', auditorStdout);
        const observed = validateModelAuditSummary(auditorStdout);
        await witness(); await assertMinio(); await assertIsolatedNetwork(); await assertClone(logicalId, 'logical');
        const privateReport = await pin(file('model-audit/model-audit.private.json'));
        need(privateReport.sha256 === observed.reportSha256 && privateReport.bytes === observed.reportBytes, 'SP1_RECOVERY_MODEL_REPORT_CHANGED');
        evidence.push(privateReport);
        const afterAudit = await capture('logical', logicalId, 'logical-after-model-audit');
        const unchanged = await compare(path.join(restored.directory, 'raw'), path.join(afterAudit.directory, 'raw'), { comparison: 'exact', beforeOwnerId: args.operationId, afterOwnerId: args.operationId, signal });
        need(unchanged.status === 'PASS'
          && same(await readJson(path.join(afterAudit.directory, 'globals.private.json')), globalsAfter)
          && same(await readJson(path.join(afterAudit.directory, 'cluster.private.json')), clusterAfter), 'SP1_RECOVERY_MODEL_AUDIT_MUTATED_DATABASE');
        const immutable = await proof('model-audit-read-only.private.json', { ...unchanged, globalSql: 'PASS', clusterContext: 'PASS', modelAudit: observed, privateReport });
        modelAuditProof = { ...observed, privateReport, readOnlyComparison: immutable, afterAudit };
      }
      await witness(); return { baseline, restored, dump: await pin(dump), comparison: await pin(file('comparison.private.json')), ...(modelAudit ? { modelAudit: modelAuditProof } : {}) };
    });
    cleanupSafe = true;
    for (const expected of sourceClosure) need(same(await pin(expected.path), expected), 'SP1_RECOVERY_SOURCE_CHANGED');
    for (const expected of evidence) await assertPin(expected);
    await verifyColdSeed(args.seedPath, args.seedSha256);
    result = { schemaVersion: modelAudit ? 'wfc.preparer.recovered-seed.v2' : 'wfc.preparer.recovered-seed.v1', status: 'PASS', operationId: args.operationId, productionQualification: production,
      scope: 'target-database logical recovery inside physically preserved cluster-role context', allClusterLogicalInitdbRecovery: 'NOT_RUN',
      seed: await pin(args.seedPath), captureImage: args.captureImage, sourceClosure, evidence, ...runtimeResult,
      rawPublicData: 'PASS', publicGlobalSql: 'PASS', clusterRoleContext: 'PASS', originalPostgresRemainsStopped: true,
      ...(modelAudit ? { modelAuditScope: 'All ready declared model resources and all published original ZIP records; absent legacy ZIP declarations remain explicit in the audit.' } : {}),
      modelAndOriginalZipAudit: modelAudit ? 'PASS' : 'NOT_RUN', applicationStartup: 'NOT_RUN', releasableBackup: false, completedAt: new Date().toISOString() };
  } catch (error) { primary = error; cleanupSafe = getBoundedDockerCleanup(error)?.status === 'PASS'; }
  // The bounds layer must have positively removed every clone/helper first.
  // Unknown outcomes retain volumes/network and the immutable operation for reconciliation.
  let cleanup = { status: 'UNCONFIRMED', resourcesRetained: true };
  if (docker && cleanupSafe) {
    try { cleanup = await withBoundedDockerExecution(SHORT_BOUNDS, async () => {
      await witness(); const all = await docker.containers();
      need(!all.some(item => item.Mounts?.some(m => m.Type === 'volume' && [physical?.Name, logical?.Name, minioVolume?.Name].filter(Boolean).includes(m.Name))), 'SP1_RECOVERY_VOLUME_ATTACHED');
      for (const purpose of [...(modelAudit ? ['minio'] : []), 'logical', 'physical']) { const expected = purpose === 'physical' ? physical : purpose === 'logical' ? logical : minioVolume; if (!expected) continue;
        const current = await docker.request('GET', '/volumes/' + encodeURIComponent(expected.Name)); assertOwnedRecoveryResource(current, volumeSpec(purpose)); need(same(current, expected), 'SP1_RECOVERY_VOLUME_CHANGED');
        await docker.request('DELETE', '/volumes/' + encodeURIComponent(current.Name)); }
      if (network) { const current = await docker.request('GET', '/networks/' + network.Id); assertOwnedRecoveryResource(current, { operationId: args.operationId, seedSha256: args.seedSha256, purpose: 'network', name: names.network });
        need(current.Id === network.Id && current.Internal === true && Object.keys(current.Containers ?? {}).length === 0, 'SP1_RECOVERY_NETWORK_ATTACHED'); await docker.request('DELETE', '/networks/' + current.Id); }
      const remainingVolumes = await docker.request('GET', '/volumes'), remainingNetworks = await docker.request('GET', '/networks');
      need(Array.isArray(remainingVolumes?.Volumes) && !remainingVolumes.Volumes.some(item => [names.physical, names.logical, ...(modelAudit ? [names.minio] : [])].includes(item.Name))
        && Array.isArray(remainingNetworks) && !remainingNetworks.some(item => item.Id === network?.Id || item.Name === names.network), 'SP1_RECOVERY_RESOURCE_REMOVAL_UNCONFIRMED');
      await witness(); return { status: 'PASS', resourcesRetained: false, originalPostgresRemainsStopped: true };
    }); } catch (error) { primary ??= error; cleanup = { status: 'UNCONFIRMED', resourcesRetained: true, code: codeFor(error) }; }
  }
  await proof('cleanup.private.json', cleanup);
  if (primary) { await writeJsonNew(file('failure.private.json'), { schemaVersion: 'wfc.preparer.recovery-failure.v1', operationId: args.operationId, status: 'FAIL', code: codeFor(primary), cleanup, sourceLockRetained: true }); throw primary; }
  need(result && cleanup.status === 'PASS', 'SP1_RECOVERY_INCOMPLETE');
  await proof('source-after.private.json', { originalPostgresRemainsStopped: true, sourceIntentSha256: verified.seed.intent.sha256, cleanup });
  result.cleanup = cleanup; result.evidence = evidence; await writeJsonNew(file('qualification.private.json'), result);
  const terminal = await proof('complete.private.json', { schemaVersion: 'wfc.preparer.recovery-complete.v1', operationId: args.operationId, qualification: await pin(file('qualification.private.json')), productionQualification: production, releasableBackup: false, sourceLockRelease: 'pending' });
  let releaseAttempted = false;
  try {
    need(same(await pin(lockPath), lockPin), 'SP1_RECOVERY_LOCK_CHANGED');
    try { await fs.lstat(file('source-lock-released.private.json')); need(false, 'SP1_RECOVERY_LOCK_RELEASE_DESTINATION_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    releaseAttempted = true; await fs.rename(lockPath, file('source-lock-released.private.json'));
    need(same(await pin(file('source-lock-released.private.json')), { ...lockPin, path: file('source-lock-released.private.json') }), 'SP1_RECOVERY_LOCK_RELEASE_UNCONFIRMED');
    try { await fs.lstat(lockPath); need(false, 'SP1_RECOVERY_LOCK_RELEASE_UNCONFIRMED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    need(same(await pin(terminal.path), terminal), 'SP1_RECOVERY_TERMINAL_CHANGED');
    return { ...result, terminal, sourceLockReleased: true };
  } catch (error) {
    await writeJsonNew(file('finalization-failure.private.json'), { schemaVersion: 'wfc.preparer.recovery-finalization-failure.v1', operationId: args.operationId,
      status: 'FAIL', code: codeFor(error), sourceLockState: releaseAttempted ? 'UNCONFIRMED' : 'retained', terminal });
    throw error;
  }
}

const CLUSTER_SQL = Object.freeze({
  roles: `SELECT to_jsonb(r)-'oid' value FROM pg_authid r ORDER BY rolname COLLATE "C"`,
  memberships: `SELECT jsonb_build_object('role',r.rolname,'member',m.rolname,'grantor',g.rolname,'adminOption',a.admin_option,'inheritOption',a.inherit_option,'setOption',a.set_option) value FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor ORDER BY r.rolname COLLATE "C",m.rolname COLLATE "C",g.rolname COLLATE "C"`,
  database: `SELECT (to_jsonb(d)-ARRAY['oid','datdba','dattablespace','datacl','datfrozenxid','datminmxid'])||jsonb_build_object('owner',pg_get_userbyid(d.datdba),'tablespace',t.spcname,'acl',COALESCE((SELECT jsonb_agg(jsonb_build_object('grantor',g.rolname,'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE r.rolname END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY g.rolname COLLATE "C",(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE r.rolname END) COLLATE "C",x.privilege_type COLLATE "C",x.is_grantable) FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) x LEFT JOIN pg_roles g ON g.oid=x.grantor LEFT JOIN pg_roles r ON r.oid=x.grantee),'[]'::jsonb)) value FROM pg_database d JOIN pg_tablespace t ON t.oid=d.dattablespace WHERE d.datname=current_database()`,
  settings: `SELECT jsonb_build_object('database',COALESCE(d.datname,'*'),'role',COALESCE(r.rolname,'*'),'settings',s.setconfig) value FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase LEFT JOIN pg_roles r ON r.oid=s.setrole WHERE s.setdatabase=0 OR d.datname=current_database() ORDER BY COALESCE(d.datname,'*') COLLATE "C",COALESCE(r.rolname,'*') COLLATE "C"`,
});
/** Clone-only capture. Dynamic pg/TS imports occur only after explicit CLI entry;
 * no application db module, initializer, writer or APS code is imported. */
export async function captureCloneDatabase({ directory, ownerId, connectionPath }, { poolFactory } = {}) {
  need(path.isAbsolute(directory ?? '') && path.isAbsolute(connectionPath ?? '') && UUID.test(ownerId ?? ''), 'SP1_CAPTURE_ARGUMENT_INVALID');
  need(process.versions.node === '24.22.0' || poolFactory !== undefined, 'SP1_CAPTURE_NODE_VERSION');
  const connection = await readJson(connectionPath), names = recoveryResourceNames(ownerId); need(Object.keys(connection).sort().join(',') === 'database,host,password,port,user' && connection.database === 'wfc_app' && connection.port === 5432 && [names.physical, names.logical].includes(connection.host) && ['user', 'password'].every(key => typeof connection[key] === 'string' && connection[key].length > 0), 'SP1_CAPTURE_CONNECTION_SCOPE');
  need(poolFactory === undefined || typeof poolFactory === 'function', 'SP1_CAPTURE_ADAPTER_INVALID');
  const factory = poolFactory ?? (options => { const { Pool } = createRequire('/app/package.json')('pg'); return new Pool(options); });
  const pool = factory({ ...connection, max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 1000, query_timeout: 20000, application_name: 'wfc-preparer-sp1-lossless-capture' });
  const guard = async () => { const result = await pool.query({ text: `SELECT current_database() name,(SELECT count(*)::text FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()) others`, query_timeout: 10000 });
    need(result.rows.length === 1 && result.rows[0].name === 'wfc_app' && result.rows[0].others === '0', 'SP1_CAPTURE_FOREIGN_DATABASE_CLIENT'); };
  try {
    await assertCanonicalPath(path.dirname(directory), { directory: true }); await fs.mkdir(directory, { mode: 0o700 });
    await guard(); const { captureLosslessInventory } = await import('./recovery-leaves/losslessInventory.ts');
    const raw = await captureLosslessInventory(pool, { allowedRoot: directory, directory: path.join(directory, 'raw'), ownerId }); await guard();
    const globals = await capturePublicGlobals(pool); await guard(); need(globals.unsupportedObjects.length === 0, 'SP1_RECOVERY_GLOBAL_UNSUPPORTED');
    await writeJsonNew(path.join(directory, 'globals.private.json'), globals);
    const client = await pool.connect(); let begun = false, cluster;
    try { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); begun = true; await client.query("SET LOCAL statement_timeout='15000ms'"); await client.query("SET LOCAL timezone='UTC'");
      cluster = { schemaVersion: 'wfc.preparer.physical-cluster-role-context.v1' };
      for (const [kind, text] of Object.entries(CLUSTER_SQL)) { const result = await client.query({ text, query_timeout: 20000 }); need(result.rows.length <= 10000, 'SP1_CLUSTER_METADATA_LIMIT'); cluster[kind] = result.rows.map(row => row.value); }
      need(cluster.database.length === 1 && Buffer.byteLength(JSON.stringify(cluster)) <= 8 * 1024 ** 2, 'SP1_CLUSTER_METADATA_LIMIT');
      await client.query('COMMIT'); begun = false;
    } finally { if (begun) await client.query('ROLLBACK').catch(() => {}); client.release(); }
    await guard(); await writeJsonNew(path.join(directory, 'cluster.private.json'), cluster);
    const summary = { schemaVersion: 'wfc.preparer.clone-capture.v1', status: 'PASS', ownerId, rawContentSha256: raw.contentSha256, rawCatalogSha256: raw.catalogSha256,
      globalSqlSha256: canonicalSha256(globals), clusterContextSha256: canonicalSha256(cluster), tables: raw.tables.length, credentials: 'private clone-only connection', applicationStartup: false };
    await writeJsonNew(path.join(directory, 'capture.private.json'), summary); return summary;
  } finally { await pool.end(); }
}

export async function main(args) {
  let result;
  if (args.length === 7 && args[0] === 'capture' && args[1] === '--directory' && args[3] === '--owner' && args[5] === '--connection') result = await captureCloneDatabase({ directory: args[2], ownerId: args[4], connectionPath: args[6] });
  else if (args.length === 5 && args[0] === 'wait-minio' && args[1] === '--host' && args[3] === '--owner') result = await waitRecoveryMinio({ host: args[2], ownerId: args[4] });
  else if ([9, 10].includes(args.length) && args[0] === 'qualify' && args[1] === '--seed' && args[3] === '--seed-sha256' && args[5] === '--operation' && args[7] === '--capture-image'
    && (args.length === 9 || args[9] === '--audit-models')) result = await qualifyRecoveredSeed({ seedPath: args[2], seedSha256: args[4], operationDirectory: args[6], captureImage: args[8], ...(args.length === 10 ? { modelAudit: true } : {}) });
  else need(false, 'SP1_RECOVERY_ARGUMENT_INVALID');
  console.log(JSON.stringify({ status: result.status, operationId: result.operationId ?? null, releasableBackup: false, ...(result.rawContentSha256 ? { rawContentSha256: result.rawContentSha256, globalSqlSha256: result.globalSqlSha256, clusterContextSha256: result.clusterContextSha256 } : {}) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { console.log(JSON.stringify({ status: 'FAIL', code: codeFor(error) })); process.exitCode = 1; });
