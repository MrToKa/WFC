// Explicit root-operated local delivery. Importing this module performs no IO.
// Database/schema writes belong only to the already-qualified API startup; this
// operator never restores data, initializes a DB, invokes APS or imports models.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDocker, writePrivateJson } from './foundation/docker.mjs';
import { assertCanonicalPath, hashFile } from './foundation/archives.mjs';
import { writeJsonNew } from './foundation/manifest.mjs';
import { withBoundedDockerExecution } from './foundation/docker-bounds.mjs';
import { canonicalSha256, networkAttachmentIdentity } from './offline-seed.mjs';
import { verifyColdSeed } from './recovery.mjs';
import { verifyUpgradeQualification } from './upgrade-preflight.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/, SHA = /^[a-f0-9]{64}$/, REVISION = /^[a-f0-9]{40}$/, IMAGE = /^sha256:[a-f0-9]{64}$/;
const ROLES = ['api', 'web', 'postgres', 'minio'], APP_NETWORK = 'wfc-app_application';
const MAIN_PREFIX = '96e63f13', PRODUCT = '543ae7a889fbf1abbf4937f5f83b2c6ee1b91ff4';
export const DEPLOYMENT_IMAGES = Object.freeze({ api: 'sha256:ec6fc3cf89dc9fea8ae201e9507655ba6534f608070b79480a81910ae89ff451', web: 'sha256:a9226e283b2bb2810bdf48484cd776d4bb6e6d92aad3706419f6c8724c6543d0', preparer: 'sha256:3e815754b56d2c4ccbd79d4708ed289cc43e709c69f478ed708b86be9d20c488' });
export const DEPLOYMENT_LIMITS = Object.freeze({ maxBackupAgeMs: 86400000, operationMs: 900000, rollbackMs: 600000, requestMs: 60000, healthMs: 120000, gitMs: 30000, maxContainers: 1024, maxEvents: 256, maxPrivateBytes: 32 * 1024 ** 2 });
const READ_BOUNDS = Object.freeze({ operationTimeoutMs: 30000, commandTimeoutMs: 15000, requestTimeoutMs: 15000, helperTimeoutMs: 15000, helperMemoryBytes: 128 * 1024 ** 2, pidsLimit: 64, nanoCpus: 1000000000, tmpBytes: 16 * 1024 ** 2, archiveOutputBytes: 1024 ** 2 });
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const need = (value, code) => { if (!value) throw Object.assign(Error(code), { code }); };
const same = (a, b) => a === undefined || b === undefined ? a === b : canonicalSha256(a) === canonicalSha256(b);
const code = error => /^[A-Z0-9_]{3,80}$/.test(error?.code ?? '') ? error.code : 'DEPLOYMENT_FAILED';
const pin = async filename => ({ path: filename, ...await hashFile(filename) });
const running = item => item?.State?.Running === true && item.State.Restarting !== true && Number.isSafeInteger(item.State.Pid) && item.State.Pid > 0;
const stopped = item => item?.State?.Running === false && item.State.Restarting !== true && item.State.Pid === 0;
const ownerLabels = (operationId, purpose) => ({ 'wfc.preparer.deployment.owner': operationId, 'wfc.preparer.deployment.purpose': purpose });
const injected = options => ['docker', 'git', 'verifySeed', 'verifyRecovery', 'verifyUpgrade', 'probePort', 'health', 'root', 'now'].some(key => Object.hasOwn(options, key));
function exact(value, fields, error) { need(plain(value) && Object.keys(value).sort().join('|') === [...fields].sort().join('|'), error); }
function filePin(value) { exact(value, ['path', 'bytes', 'sha256'], 'DEPLOY_GATE_PIN_INVALID'); need(typeof value.path === 'string' && path.isAbsolute(value.path) && Number.isSafeInteger(value.bytes) && value.bytes > 0 && SHA.test(value.sha256), 'DEPLOY_GATE_PIN_INVALID'); return value; }
async function assertPin(expected) { filePin(expected); need(same(await pin(expected.path), expected), 'DEPLOY_GATE_CHANGED'); }
async function json(filename, expected) { await assertCanonicalPath(filename); const bytes = await fs.readFile(filename); need(bytes.length > 0 && bytes.length <= DEPLOYMENT_LIMITS.maxPrivateBytes, 'DEPLOY_PRIVATE_FILE_LIMIT'); if (expected) { await assertPin(expected); need(filename === expected.path, 'DEPLOY_GATE_CHANGED'); } let result; try { result = JSON.parse(bytes); } catch { need(false, 'DEPLOY_PRIVATE_JSON_INVALID'); } need(plain(result), 'DEPLOY_PRIVATE_JSON_INVALID'); return result; }
export function validateDeploymentIntent(value) {
  exact(value, ['schemaVersion', 'operationId', 'main', 'productRevision', 'images', 'gates'], 'DEPLOY_INTENT_INVALID'); exact(value.main, ['root', 'revision'], 'DEPLOY_MAIN_SOURCE_INVALID'); exact(value.images, ['api', 'web', 'preparer'], 'DEPLOY_IMAGE_INVALID'); exact(value.gates, ['sp5', 'upgrade', 'seed', 'recovery', 'repair'], 'DEPLOY_GATE_INVALID');
  need(value.schemaVersion === 'wfc.preparer.main-deploy-intent.v1' && UUID.test(value.operationId) && path.isAbsolute(value.main.root ?? '') && REVISION.test(value.main.revision ?? '') && value.main.revision.startsWith(MAIN_PREFIX) && value.productRevision === PRODUCT && same(value.images, DEPLOYMENT_IMAGES), 'DEPLOY_INTENT_INVALID');
  for (const expected of Object.values(value.gates)) filePin(expected); return value;
}
export function deploymentNames(operationId, originals) { need(UUID.test(operationId), 'DEPLOY_OPERATION_INVALID'); const prefix = 'wfc-preparer-main-' + operationId; return { preparer: prefix, volumes: Object.fromEntries(['data', 'work', 'outputs'].map(role => [role, prefix + '-' + role])), rollback: Object.fromEntries(['api', 'web'].map(role => [role, originals[role].Name.replace(/^\//, '') + '-preparer-rollback-' + operationId])) }; }
const identity = item => ({ id: item.Id, name: item.Name, image: item.Image, config: canonicalSha256(item.Config), hostConfig: canonicalSha256(item.HostConfig), mounts: canonicalSha256(item.Mounts), networks: canonicalSha256(networkAttachmentIdentity(item, { allowUnbound: true })) });
function protectedIdentity(item) { return { ...identity(item), startedAt: item.State?.StartedAt, running: item.State?.Running, restarting: item.State?.Restarting, pid: item.State?.Pid }; }
async function inspectAll(request) { const rows = await request('GET', '/containers/json?all=1'); need(Array.isArray(rows) && rows.length <= DEPLOYMENT_LIMITS.maxContainers, 'DEPLOY_CONTAINER_LIMIT'); return Promise.all(rows.map(row => { need(SHA.test(row.Id ?? ''), 'DEPLOY_CONTAINER_INVALID'); return request('GET', '/containers/' + row.Id + '/json'); })); }
async function sourceLocks(parent, { deploy = false } = {}) { for (const name of ['main5180-offline-seed.lock', 'main5180-recovery.lock', 'main5180-upgrade-preflight.lock', ...(!deploy ? ['main5180-deploy.lock'] : [])]) { try { await fs.lstat(path.join(parent, name)); need(false, 'DEPLOY_SOURCE_OPERATION_ACTIVE'); } catch (error) { if (error.code !== 'ENOENT') throw error; } } }
function localGit(root, args) { return new Promise((resolve, reject) => { const child = spawn('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }), chunks = []; let bytes = 0, exceeded = false; const timer = setTimeout(() => child.kill(), DEPLOYMENT_LIMITS.gitMs); child.stderr.resume(); child.stdout.on('data', part => { bytes += part.length; if (bytes > 4 * 1024 ** 2) { exceeded = true; child.kill(); } else chunks.push(part); }); child.once('error', () => { clearTimeout(timer); reject(Object.assign(Error('DEPLOY_GIT_FAILED'), { code: 'DEPLOY_GIT_FAILED' })); }); child.once('close', status => { clearTimeout(timer); status === 0 && !exceeded ? resolve(Buffer.concat(chunks)) : reject(Object.assign(Error('DEPLOY_GIT_FAILED'), { code: 'DEPLOY_GIT_FAILED' })); }); }); }
async function mainWitness(main, git = localGit) { await assertCanonicalPath(main.root, { directory: true }); const revision = (await git(main.root, ['rev-parse', '--verify', 'HEAD^{commit}'])).toString().trim(), upstream = (await git(main.root, ['rev-parse', '--verify', '@{upstream}^{commit}'])).toString().trim(), status = await git(main.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no']); need(revision === main.revision && upstream === revision && status.length === 0, 'DEPLOY_MAIN_SOURCE_CHANGED'); return { revision, upstream, clean: true }; }
export function endpointConfiguration(network) { const value = {}; for (const key of ['IPAMConfig', 'Links', 'Aliases', 'DriverOpts', 'GwPriority']) if (Object.hasOwn(network, key)) value[key] = structuredClone(network[key]); return value; }
const endpointEqual = (actual, expected) => same(Object.fromEntries(['IPAMConfig', 'Links', 'Aliases', 'DriverOpts', 'GwPriority'].map(key => [key, actual[key] ?? (key === 'GwPriority' ? 0 : null)])), Object.fromEntries(['IPAMConfig', 'Links', 'Aliases', 'DriverOpts', 'GwPriority'].map(key => [key, expected[key] ?? (key === 'GwPriority' ? 0 : null)])));
export function primaryConfiguration(original, image, imageConfig, operationId, role) {
  need(['api', 'web'].includes(role) && IMAGE.test(image), 'DEPLOY_CONFIGURATION_INVALID');
  const value = structuredClone(original.Config); value.Image = image; value.Labels = { ...imageConfig.Labels, ...value.Labels, ...ownerLabels(operationId, role) };
  // Operational Compose labels belong to the running installation. Image
  // provenance belongs to the candidate; never retain a stale delivery stamp.
  for (const key of Object.keys(value.Labels)) if (key === 'org.opencontainers.image.revision' || key.startsWith('wfc.preparer.delivery.')) delete value.Labels[key];
  for (const [key, candidate] of Object.entries(imageConfig.Labels ?? {})) if (key === 'org.opencontainers.image.revision' || key.startsWith('wfc.preparer.delivery.')) value.Labels[key] = candidate;
  if (role === 'api') { need(Array.isArray(value.Env) && value.Env.every(entry => typeof entry === 'string' && entry.includes('=')), 'DEPLOY_ENVIRONMENT_INVALID'); value.Env = value.Env.filter(entry => !['WFC_PREPARER_INTERNAL_ORIGIN', 'WFC_PREPARER_PUBLIC_ORIGIN'].includes(entry.slice(0, entry.indexOf('=')))); value.Env.push('WFC_PREPARER_INTERNAL_ORIGIN=http://preparer:8080', 'WFC_PREPARER_PUBLIC_ORIGIN=http://127.0.0.1:5193'); }
  value.HostConfig = structuredClone(original.HostConfig); value.NetworkingConfig = { EndpointsConfig: { [APP_NETWORK]: endpointConfiguration(original.NetworkSettings.Networks[APP_NETWORK]) } }; return value;
}
export function preparerConfiguration(imageConfig, operationId, names, networkId) {
  need(SHA.test(networkId) && Array.isArray(imageConfig.Env) && imageConfig.Env.every(entry => typeof entry === 'string' && entry.indexOf('=') > 0 && !/^(?:APS_|AUTODESK_|PREPARER_|WFC_PREPARER_)/.test(entry)), 'DEPLOY_PREPARER_IMAGE_ENVIRONMENT');
  need(plain(imageConfig.ExposedPorts) && Object.hasOwn(imageConfig.ExposedPorts, '8080/tcp') && Object.entries(imageConfig.ExposedPorts).every(([name, metadata]) => ['4000/tcp', '8080/tcp'].includes(name) && plain(metadata) && Object.keys(metadata).length === 0), 'DEPLOY_PREPARER_IMAGE_PORT_PROFILE');
  const env = new Map(imageConfig.Env.map(entry => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]));
  for (const [key, value] of Object.entries({ NODE_ENV: 'production', PREPARER_MODE: 'live', PREPARER_INSTANCE_ID: operationId, PREPARER_HOST: '0.0.0.0', PREPARER_PORT: '8080', PREPARER_WFC_ORIGIN: 'http://api:4000', PREPARER_PUBLIC_ORIGIN: 'http://127.0.0.1:5193', PREPARER_DATA_DIR: '/var/lib/preparer/data', PREPARER_WORK_DIR: '/var/lib/preparer/work', PREPARER_OUTPUT_DIR: '/var/lib/preparer/outputs', PREPARER_PACKAGE_MODULE: '/opt/package/index.mjs' })) env.set(key, value);
  // Engine merges the pinned image's EXPOSE metadata even when a create body
  // lists fewer ports. Preserve that exact closed profile; only PortBindings
  // below publishes a host socket, and PublishAllPorts remains false.
  const result = { Image: DEPLOYMENT_IMAGES.preparer, User: 'node', Env: [...env].map(([key, value]) => key + '=' + value), WorkingDir: imageConfig.WorkingDir, Entrypoint: imageConfig.Entrypoint, Cmd: ['node', 'app/server.mjs'], Labels: { ...imageConfig.Labels, ...ownerLabels(operationId, 'preparer') }, ExposedPorts: structuredClone(imageConfig.ExposedPorts), AttachStdout: true, AttachStderr: true,
    HostConfig: { NetworkMode: APP_NETWORK, Mounts: Object.entries(names.volumes).map(([role, name]) => ({ Type: 'volume', Source: name, Target: '/var/lib/preparer/' + role, ReadOnly: false })), PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '5193' }] }, PublishAllPorts: false, RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 }, ReadonlyRootfs: true, CapDrop: ['ALL'], CapAdd: [], SecurityOpt: ['no-new-privileges:true'], Privileged: false, Memory: 1024 ** 3, MemorySwap: 1024 ** 3, NanoCpus: 1000000000, PidsLimit: 256, Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=268435456,mode=1777' } }, NetworkingConfig: { EndpointsConfig: { [APP_NETWORK]: { Aliases: ['preparer'] } } } };
  if (imageConfig.Healthcheck) result.Healthcheck = structuredClone(imageConfig.Healthcheck); return result;
}
function composeForPreparer(configuration, names) { const env = Object.fromEntries(configuration.Env.map(entry => { const at = entry.indexOf('='); return [entry.slice(0, at), entry.slice(at + 1)]; })); return { name: 'wfc-preparer-main', services: { preparer: { image: configuration.Image, container_name: names.preparer, user: configuration.User, environment: env, working_dir: configuration.WorkingDir, command: configuration.Cmd, restart: 'unless-stopped', read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], mem_limit: '1g', pids_limit: 256, tmpfs: ['/tmp:rw,noexec,nosuid,nodev,size=268435456,mode=1777'], ports: ['127.0.0.1:5193:8080'], volumes: Object.entries(names.volumes).map(([role]) => ({ type: 'volume', source: role, target: '/var/lib/preparer/' + role })), networks: { application: { aliases: ['preparer'] } }, labels: configuration.Labels } }, networks: { application: { external: true, name: APP_NETWORK } }, volumes: Object.fromEntries(Object.entries(names.volumes).map(([role, name]) => [role, { external: true, name }])) }; }
async function probePort() { await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', () => reject(Object.assign(Error('DEPLOY_PORT_5193_IN_USE'), { code: 'DEPLOY_PORT_5193_IN_USE' }))); server.listen(5193, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve())); }); }
async function health(port, signal) { const deadline = Date.now() + DEPLOYMENT_LIMITS.healthMs; while (Date.now() < deadline) { signal?.throwIfAborted(); const ok = await new Promise(resolve => { let ended = false; const done = value => { if (!ended) { ended = true; clearTimeout(timer); resolve(value); } }; const request = http.get({ host: '127.0.0.1', port, path: '/health', headers: { Host: '127.0.0.1:' + port } }, response => { let bytes = 0, chunks = []; response.on('data', part => { bytes += part.length; if (bytes > 65536) { request.destroy(); done(false); } else chunks.push(part); }); response.once('error', () => done(false)); response.once('end', () => { let valid = response.complete && response.statusCode === 200; try { valid &&= JSON.parse(Buffer.concat(chunks)).status === 'ok'; } catch { valid = false; } done(valid); }); }); const timer = setTimeout(() => { request.destroy(); done(false); }, 3000); request.once('error', () => done(false)); }); if (ok) return; await new Promise(resolve => setTimeout(resolve, 250)); } need(false, 'DEPLOY_HEALTH_FAILED'); }
export async function verifyRecoveryGate(expected, seedPin) {
  const value = await json(expected.path, expected), directory = path.dirname(expected.path);
  for (const name of ['failure.private.json', 'finalization-failure.private.json']) { try { await fs.lstat(path.join(directory, name)); need(false, 'DEPLOY_RECOVERY_FAILURE_RETAINED'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  need(value.schemaVersion === 'wfc.preparer.recovered-seed.v2' && value.status === 'PASS' && value.productionQualification === true && same(value.seed, seedPin) && value.rawPublicData === 'PASS' && value.publicGlobalSql === 'PASS' && value.clusterRoleContext === 'PASS' && value.modelAndOriginalZipAudit === 'PASS' && value.cleanup?.status === 'PASS' && value.cleanup.resourcesRetained === false, 'DEPLOY_RECOVERY_GATE_FAILED');
  need(Array.isArray(value.sourceClosure) && Array.isArray(value.evidence), 'DEPLOY_RECOVERY_GATE_FAILED'); for (const item of [...value.sourceClosure, ...value.evidence, value.dump, value.comparison]) await assertPin(item);
  const terminal = await json(path.join(directory, 'complete.private.json')); need(terminal.schemaVersion === 'wfc.preparer.recovery-complete.v1' && terminal.operationId === value.operationId && terminal.productionQualification === true && same(terminal.qualification, expected) && terminal.sourceLockRelease === 'pending', 'DEPLOY_RECOVERY_TERMINAL_INVALID');
  const released = await json(path.join(directory, 'source-lock-released.private.json')); need(released.schemaVersion === 'wfc.preparer.recovery-lock.v1' && released.operationId === value.operationId && released.seedSha256 === seedPin.sha256 && released.operationDirectory === directory, 'DEPLOY_RECOVERY_LOCK_UNCONFIRMED');
  try { await fs.lstat(path.join(path.dirname(directory), 'main5180-recovery.lock')); need(false, 'DEPLOY_SOURCE_OPERATION_ACTIVE'); } catch (error) { if (error.code !== 'ENOENT') throw error; } return value;
}
export async function verifyDeploymentGates(intent, options = {}) {
  for (const expected of Object.values(intent.gates)) await assertPin(expected);
  const verified = await (options.verifySeed ?? verifyColdSeed)(intent.gates.seed.path, intent.gates.seed.sha256), seed = verified.seed, now = (options.now ?? Date.now)(), completed = Date.parse(seed.completedAt);
  need(Number.isFinite(completed) && completed <= now && now - completed <= DEPLOYMENT_LIMITS.maxBackupAgeMs, 'DEPLOY_BACKUP_NOT_FRESH');
  const recovery = await (options.verifyRecovery ?? verifyRecoveryGate)(intent.gates.recovery, intent.gates.seed), upgrade = await (options.verifyUpgrade ?? verifyUpgradeQualification)(intent.gates.upgrade.path, intent.gates.upgrade.sha256), sp5 = await json(intent.gates.sp5.path, intent.gates.sp5), repair = await json(intent.gates.repair.path, intent.gates.repair);
  need(repair.schemaVersion === 'wfc.preparer.main-repair-reconciled.v1' && repair.status === 'PASS' && repair.nonTargetIdentityAndStateUnchanged === true, 'DEPLOY_REPAIR_GATE_FAILED');
  const difference = repair.declaredDynamicDifference; exact(difference, ['role', 'field', 'oldId', 'newId', 'oldIdNoLongerExists', 'newIdVerifiedDefaultBridge', 'configuredNetworkMode'], 'DEPLOY_REPAIR_GATE_FAILED');
  need(difference.role === 'postgres' && difference.field === 'NetworkSettings.Networks.bridge.NetworkID' && SHA.test(difference.oldId) && SHA.test(difference.newId) && difference.oldId !== difference.newId && difference.oldIdNoLongerExists === true && difference.newIdVerifiedDefaultBridge === true && difference.configuredNetworkMode === 'bridge', 'DEPLOY_REPAIR_GATE_FAILED');
  need(upgrade.status === 'PASS' && upgrade.productionQualification === true && upgrade.sourceLockReleased === true && upgrade.productRevision === intent.productRevision && upgrade.candidateApiImage === intent.images.api && upgrade.rollbackApiImage === verified.intent.source.roles.api.image && same(upgrade.seed, intent.gates.seed), 'DEPLOY_UPGRADE_GATE_FAILED');
  need(sp5.schemaVersion === 'wfc.preparer.sp5-integration-qualification.v1' && sp5.status === 'PASS' && sp5.productRevision === intent.productRevision && sp5.browserAcceptance === 'PASS' && sp5.twoAdminIsolation === 'PASS' && sp5.restartAndLocalZipRecovery === 'PASS' && sp5.noCredentialPersistence === 'PASS' && sp5.realAutodeskRequests === 0 && sp5.productionCloudAcceptance === 'NOT_RUN_BY_USER_REQUIREMENT' && sp5.cleanup === 'PASS' && sp5.resourcesRemoved === true && Number.isFinite(Date.parse(sp5.checkedAt)) && Date.parse(sp5.checkedAt) <= now, 'DEPLOY_SP5_GATE_FAILED');
  need(plain(sp5.images) && ['api', 'web', 'preparer'].every(role => sp5.images[role] === intent.images[role]) && ['postgres', 'minio'].every(role => sp5.images[role] === verified.intent.source.roles[role].image), 'DEPLOY_SP5_IMAGE_MISMATCH');
  need(recovery.status === 'PASS', 'DEPLOY_RECOVERY_GATE_FAILED'); return { ...verified, repair: difference };
}
async function assertBaseline(originals, verified, request) {
  for (const role of ROLES) {
    const expected = verified.intent.source.roles[role], actual = originals[role];
    need(actual && actual.Id === expected.id && actual.Image === expected.image && canonicalSha256(actual.Config) === expected.configSha256 && canonicalSha256(actual.HostConfig) === expected.hostConfigSha256 && canonicalSha256(actual.Mounts) === expected.mountsSha256 && running(actual), 'DEPLOY_PRIMARY_IDENTITY_CHANGED');
    const networks = networkAttachmentIdentity(actual);
    if (role === 'postgres') { need(actual.HostConfig.NetworkMode === 'bridge' && Object.keys(networks).join('|') === 'bridge' && networks.bridge.NetworkID === verified.repair.newId, 'DEPLOY_POSTGRES_REPAIR_NOT_CURRENT'); networks.bridge.NetworkID = verified.repair.oldId; }
    need(canonicalSha256(networks) === expected.networksSha256, 'DEPLOY_PRIMARY_IDENTITY_CHANGED');
  }
  // A failed inspect cannot prove absence. Enumerate successfully before
  // admitting only the one explicitly reconciled default-bridge ID change.
  const networks = await request('GET', '/networks'); need(Array.isArray(networks) && networks.length <= 1024 && networks.every(item => SHA.test(item.Id ?? '')) && !networks.some(item => item.Id === verified.repair.oldId) && networks.some(item => item.Id === verified.repair.newId), 'DEPLOY_POSTGRES_REPAIR_NOT_CURRENT');
  const current = await request('GET', '/networks/' + verified.repair.newId); need(current.Id === verified.repair.newId && current.Name === 'bridge' && current.Driver === 'bridge' && current.Internal === false, 'DEPLOY_POSTGRES_REPAIR_NOT_CURRENT');
}
function assertOriginal(actual, before, names, role) {
  need(actual?.Id === before.Id && actual.Image === before.Image && [before.Name, '/' + names.rollback[role]].includes(actual.Name) && same(actual.Config, before.Config) && same(actual.HostConfig, before.HostConfig) && same(actual.Mounts, before.Mounts), 'DEPLOY_ROLLBACK_SOURCE_CHANGED');
  const attachments = Object.keys(actual.NetworkSettings?.Networks ?? {});
  need(attachments.length === 0 || attachments.length === 1 && attachments[0] === APP_NETWORK && actual.NetworkSettings.Networks[APP_NETWORK].NetworkID === before.NetworkSettings.Networks[APP_NETWORK].NetworkID && endpointEqual(actual.NetworkSettings.Networks[APP_NETWORK], before.NetworkSettings.Networks[APP_NETWORK]), 'DEPLOY_ROLLBACK_NETWORK_CHANGED');
}
function assertCandidate(actual, configuration, operationId, role, name, before, networkId) {
  need(actual && actual.Name === '/' + name && actual.Image === configuration.Image && actual.Config?.Labels?.['wfc.preparer.deployment.owner'] === operationId && actual.Config.Labels['wfc.preparer.deployment.purpose'] === role, 'DEPLOY_CANDIDATE_OWNERSHIP_LOST');
  for (const [key, value] of Object.entries(configuration)) { if (['HostConfig', 'NetworkingConfig'].includes(key)) continue; need(same(actual.Config[key], value), 'DEPLOY_CANDIDATE_CONFIGURATION_CHANGED'); }
  for (const [key, value] of Object.entries(configuration.HostConfig)) {
    const normalize = mounts => { need(Array.isArray(mounts), 'DEPLOY_CANDIDATE_CONFIGURATION_CHANGED'); return mounts.map(item => { need(!Object.hasOwn(item, 'ReadOnly') || typeof item.ReadOnly === 'boolean', 'DEPLOY_CANDIDATE_CONFIGURATION_CHANGED'); return { ...item, ReadOnly: item.ReadOnly ?? false }; }); };
    if (key === 'Mounts') need(same(normalize(actual.HostConfig.Mounts), normalize(value)), 'DEPLOY_CANDIDATE_CONFIGURATION_CHANGED');
    else if (key === 'CapAdd' && role === 'preparer' && Array.isArray(value) && value.length === 0) need(actual.HostConfig.CapAdd === null || Array.isArray(actual.HostConfig.CapAdd) && actual.HostConfig.CapAdd.length === 0, 'DEPLOY_CANDIDATE_CONFIGURATION_CHANGED');
    else need(same(actual.HostConfig[key], value), 'DEPLOY_CANDIDATE_CONFIGURATION_CHANGED');
  }
  const network = actual.NetworkSettings?.Networks?.[APP_NETWORK];
  // Before its first start, Engine records the requested attachment but has
  // not assigned its NetworkID. That is a distinct, fully checked created
  // state; running or previously started containers must prove the real ID.
  const neverStarted = actual.State?.Status === 'created' && actual.State.Running === false && actual.State.Restarting === false && actual.State.Pid === 0 && actual.State.StartedAt === '0001-01-01T00:00:00Z';
  need(Object.keys(actual.NetworkSettings?.Networks ?? {}).length === 1 && network && (network.NetworkID === networkId || neverStarted && network.NetworkID === '') && endpointEqual(network, configuration.NetworkingConfig.EndpointsConfig[APP_NETWORK]), 'DEPLOY_CANDIDATE_NETWORK_CHANGED');
  if (role === 'preparer') need(actual.Mounts?.length === 3 && configuration.HostConfig.Mounts.every(item => actual.Mounts.some(value => value.Type === 'volume' && value.Name === item.Source && value.Destination === item.Target && value.RW === true)), 'DEPLOY_PREPARER_MOUNTS_CHANGED');
  else need(same(actual.Mounts, before.Mounts), 'DEPLOY_PRIMARY_MOUNTS_CHANGED');
}

export async function planMainDeployment({ intentPath, intentSha256 }, options = {}) {
  need(SHA.test(intentSha256 ?? ''), 'DEPLOY_INTENT_INVALID'); const intentPin = await pin(intentPath); need(intentPin.sha256 === intentSha256, 'DEPLOY_INTENT_CHANGED'); const intent = validateDeploymentIntent(await json(intentPath, intentPin));
  const root = options.root ?? ROOT, parent = await assertCanonicalPath(path.join(root, '.preparer-work'), { directory: true }), operationDirectory = path.join(parent, 'sp-deploy-' + intent.operationId); await sourceLocks(parent);
  const verified = await verifyDeploymentGates(intent, options), main = await mainWitness(intent.main, options.git), docker = options.docker ?? await withBoundedDockerExecution(READ_BOUNDS, () => createDocker()), request = (method, route, body) => docker.request(method, route, body, { timeoutMs: DEPLOYMENT_LIMITS.requestMs });
  const all = await inspectAll(request), originals = Object.fromEntries(ROLES.map(role => [role, all.find(item => item.Id === verified.intent.source.roles[role].id)])); await assertBaseline(originals, verified, request);
  for (const role of ['api', 'web']) need(originals[role].Config.Labels?.['com.docker.compose.project'] === 'wfc-app' && Object.keys(originals[role].NetworkSettings.Networks).length === 1 && originals[role].NetworkSettings.Networks[APP_NETWORK], 'DEPLOY_PRIMARY_NETWORK_UNSUPPORTED');
  const network = await request('GET', '/networks/' + encodeURIComponent(APP_NETWORK)); need(network.Name === APP_NETWORK && SHA.test(network.Id ?? '') && network.Internal === false && network.Driver === 'bridge', 'DEPLOY_APPLICATION_NETWORK_INVALID');
  need(originals.api.NetworkSettings.Networks[APP_NETWORK].NetworkID === network.Id && originals.web.NetworkSettings.Networks[APP_NETWORK].NetworkID === network.Id && originals.api.NetworkSettings.Networks[APP_NETWORK].Aliases?.includes('api'), 'DEPLOY_APPLICATION_NETWORK_INVALID');
  need(all.every(item => item.Id === originals.api.Id || !item.NetworkSettings?.Networks?.[APP_NETWORK]?.Aliases?.includes('api')) && all.every(item => !item.NetworkSettings?.Networks?.[APP_NETWORK]?.Aliases?.includes('preparer')), 'DEPLOY_APPLICATION_ALIAS_COLLISION');
  need(!all.some(item => Object.values(item.HostConfig?.PortBindings ?? {}).flat().some(entry => entry.HostPort === '5193')), 'DEPLOY_PORT_5193_IN_USE'); await (options.probePort ?? probePort)();
  const imageRecords = {}; for (const role of ['api', 'web', 'preparer']) { const value = await request('GET', '/images/' + intent.images[role] + '/json'); need(value.Id === intent.images[role] && value.Os === 'linux' && value.Architecture === 'amd64', 'DEPLOY_IMAGE_CHANGED'); imageRecords[role] = value; }
  const names = deploymentNames(intent.operationId, originals), volumes = await request('GET', '/volumes'); need(Array.isArray(volumes.Volumes) && !volumes.Volumes.some(item => Object.values(names.volumes).includes(item.Name)) && !all.some(item => [names.preparer, ...Object.values(names.rollback)].includes(item.Name.replace(/^\//, ''))), 'DEPLOY_TARGET_ALREADY_EXISTS');
  const desired = { api: primaryConfiguration(originals.api, intent.images.api, imageRecords.api.Config, intent.operationId, 'api'), web: primaryConfiguration(originals.web, intent.images.web, imageRecords.web.Config, intent.operationId, 'web'), preparer: preparerConfiguration(imageRecords.preparer.Config, intent.operationId, names, network.Id) };
  for (const role of ['api', 'web', 'preparer']) { const allowed = role === 'preparer' ? ['/var/lib/preparer/data', '/var/lib/preparer/work', '/var/lib/preparer/outputs'] : originals[role].Mounts.map(item => item.Destination); need(Object.keys(imageRecords[role].Config.Volumes ?? {}).every(name => allowed.includes(name)), 'DEPLOY_UNDECLARED_IMAGE_VOLUME'); }
  await fs.mkdir(operationDirectory, { mode: 0o700 }); const companionPath = path.join(operationDirectory, 'configuration-companion.private.json'); await writePrivateJson(companionPath, { schemaVersion: 'wfc.preparer.main-deploy-companion.v1', operationId: intent.operationId, originals, desired, network, names, protectedData: Object.fromEntries(['postgres', 'minio'].map(role => [role, protectedIdentity(originals[role])])), outside: all.filter(item => !['api', 'web'].some(role => item.Id === originals[role].Id)).map(identity) });
  const composePath = path.join(operationDirectory, 'preparer.compose.private.json'); await writePrivateJson(composePath, composeForPreparer(desired.preparer, names));
  const closure = []; for (const name of ['deploy-main.mjs', 'upgrade-preflight.mjs', 'recovery.mjs', 'model-audit.mjs', 'offline-seed.mjs', 'pg-root-archives.mjs', 'foundation/archives.mjs', 'foundation/docker.mjs', 'foundation/docker-bounds.mjs', 'foundation/manifest.mjs']) closure.push(await pin(path.join(HERE, name)));
  const plan = { schemaVersion: 'wfc.preparer.main-deploy-plan.v1', status: 'READY', operationId: intent.operationId, productionPlan: !injected(options), intent: intentPin, companion: await pin(companionPath), compose: await pin(composePath), sourceClosure: closure, main, limits: DEPLOYMENT_LIMITS, createdAt: new Date((options.now ?? Date.now)()).toISOString(), sourcePort: 5180, preparerPort: 5193, rollbackPolicy: 'Retain exact stopped originals and all data volumes. Restore images/configurations/network aliases only; never restore, delete or reverse unknown database data.', limitations: ['Runtime identities do not establish that business data has not changed since backup.', 'No real Autodesk conversion, engineering Review/Apply or real model import is performed by this operator.'] };
  const planPath = path.join(operationDirectory, 'plan.private.json'); await writeJsonNew(planPath, plan); return { status: 'READY', operationId: intent.operationId, productionPlan: plan.productionPlan, plan: await pin(planPath), operationDirectory };
}

async function loadPlan({ planPath, planSha256 }, options) {
  need(SHA.test(planSha256 ?? ''), 'DEPLOY_PLAN_INVALID'); const planPin = await pin(planPath); need(planPin.sha256 === planSha256, 'DEPLOY_PLAN_CHANGED'); const plan = await json(planPath, planPin);
  const parent = await assertCanonicalPath(path.join(options.root ?? ROOT, '.preparer-work'), { directory: true }), directory = path.join(parent, 'sp-deploy-' + plan.operationId);
  need(plan.schemaVersion === 'wfc.preparer.main-deploy-plan.v1' && plan.status === 'READY' && UUID.test(plan.operationId) && planPath === path.join(directory, 'plan.private.json') && (injected(options) || plan.productionPlan === true) && same(plan.limits, DEPLOYMENT_LIMITS), 'DEPLOY_PLAN_INVALID');
  await assertPin(plan.intent); await assertPin(plan.companion); await assertPin(plan.compose); need(Array.isArray(plan.sourceClosure) && plan.sourceClosure.length === 10, 'DEPLOY_SOURCE_CLOSURE_INVALID'); for (const expected of plan.sourceClosure) await assertPin(expected);
  const intent = validateDeploymentIntent(await json(plan.intent.path, plan.intent)), companion = await json(plan.companion.path, plan.companion);
  need(intent.operationId === plan.operationId && companion.schemaVersion === 'wfc.preparer.main-deploy-companion.v1' && companion.operationId === plan.operationId && same(companion.names, deploymentNames(plan.operationId, companion.originals)), 'DEPLOY_PLAN_SCOPE_CHANGED');
  const docker = options.docker ?? await withBoundedDockerExecution(READ_BOUNDS, () => createDocker()), deadline = Date.now() + DEPLOYMENT_LIMITS.operationMs;
  const request = (method, route, body) => { options.signal?.throwIfAborted(); need(Date.now() < deadline, 'DEPLOY_OPERATION_TIMEOUT'); return docker.request(method, route, body, { timeoutMs: DEPLOYMENT_LIMITS.requestMs }); };
  const network = await request('GET', '/networks/' + companion.network.Id); need(network.Id === companion.network.Id && network.Name === APP_NETWORK && network.Internal === false && network.Driver === 'bridge', 'DEPLOY_APPLICATION_NETWORK_CHANGED');
  for (const role of ['api', 'web', 'preparer']) { const image = await request('GET', '/images/' + intent.images[role] + '/json'); need(image.Id === intent.images[role] && image.Os === 'linux' && image.Architecture === 'amd64', 'DEPLOY_IMAGE_CHANGED'); const expected = role === 'preparer' ? preparerConfiguration(image.Config, plan.operationId, companion.names, companion.network.Id) : primaryConfiguration(companion.originals[role], intent.images[role], image.Config, plan.operationId, role); need(same(expected, companion.desired[role]), 'DEPLOY_PLAN_CONFIGURATION_CHANGED'); }
  need(same(await json(plan.compose.path, plan.compose), composeForPreparer(companion.desired.preparer, companion.names)), 'DEPLOY_PLAN_CONFIGURATION_CHANGED');
  return { plan, planPin, intent, companion, directory, parent, request, options, production: !injected(options) && plan.productionPlan === true, ledgerPath: path.join(directory, 'mutation-ledger.private.jsonl') };
}
async function ledger(context) {
  let data; try { await assertCanonicalPath(context.ledgerPath); data = await fs.readFile(context.ledgerPath, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  need(Buffer.byteLength(data) <= DEPLOYMENT_LIMITS.maxPrivateBytes && (!data || data.endsWith('\n')), 'DEPLOY_LEDGER_INVALID'); const rows = data.split('\n').filter(Boolean).map(line => JSON.parse(line)); need(rows.length <= DEPLOYMENT_LIMITS.maxEvents, 'DEPLOY_LEDGER_LIMIT'); let previous = null;
  for (const [index, entry] of rows.entries()) { const { chainSha256, ...body } = entry; need(entry.sequence === index && entry.previousSha256 === previous && canonicalSha256(body) === chainSha256, 'DEPLOY_LEDGER_CHANGED'); previous = chainSha256; } return rows;
}
async function record(context, event) {
  const before = await ledger(context); need(before.length < DEPLOYMENT_LIMITS.maxEvents, 'DEPLOY_LEDGER_LIMIT'); const body = { sequence: before.length, previousSha256: before.at(-1)?.chainSha256 ?? null, at: new Date().toISOString(), ...event }, entry = { ...body, chainSha256: canonicalSha256(body) };
  await assertCanonicalPath(context.ledgerPath, { allowMissing: true });
  const handle = await fs.open(context.ledgerPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600); try { await handle.writeFile(JSON.stringify(entry) + '\n'); await handle.sync(); } finally { await handle.close(); } return entry;
}
async function assertProtected(context) {
  for (const role of ['postgres', 'minio']) { const actual = await context.request('GET', '/containers/' + context.companion.originals[role].Id + '/json'); need(same(protectedIdentity(actual), context.companion.protectedData[role]), 'DEPLOY_PROTECTED_DATA_RUNTIME_CHANGED'); }
}
function groups(events) { const result = new Map(); for (const event of events) { need(typeof event.step === 'number' && event.step >= 0 && ['before', 'returned', 'admitted', 'unconfirmed'].includes(event.phase), 'DEPLOY_LEDGER_INVALID'); if (!result.has(event.step)) result.set(event.step, []); result.get(event.step).push(event); } return [...result.values()]; }
async function findNamed(context, name) { const all = await inspectAll(context.request), matches = all.filter(item => item.Name === '/' + name); need(matches.length <= 1, 'DEPLOY_NAME_COLLISION'); return matches[0] ?? null; }
async function observe(context, details, returned) {
  const { companion, intent, plan } = context, { action, role } = details;
  if (action === 'create-volume') { const value = await context.request('GET', '/volumes/' + encodeURIComponent(details.name)); need(value.Name === companion.names.volumes[role] && value.Driver === 'local' && Object.keys(value.Options ?? {}).length === 0 && same(value.Labels, ownerLabels(plan.operationId, 'volume-' + role)), 'DEPLOY_VOLUME_OWNERSHIP_LOST'); return { name: value.Name, identity: canonicalSha256(value) }; }
  if (action === 'create-container') { const value = returned?.id ? await context.request('GET', '/containers/' + returned.id + '/json') : await findNamed(context, details.name); assertCandidate(value, companion.desired[role], plan.operationId, role, details.name, companion.originals[role], companion.network.Id); need(SHA.test(value.Id ?? ''), 'DEPLOY_CANDIDATE_INVALID'); return { id: value.Id, name: value.Name, identity: identity(value) }; }
  if (action === 'remove') { const all = await inspectAll(context.request); need(!all.some(item => item.Id === details.id), 'DEPLOY_REMOVE_UNCONFIRMED'); return { id: details.id, removed: true }; }
  const value = await context.request('GET', '/containers/' + details.id + '/json');
  if (details.original) assertOriginal(value, companion.originals[role], companion.names, role); else assertCandidate(value, companion.desired[role], plan.operationId, role, details.name, companion.originals[role], companion.network.Id);
  if (action === 'stop') need(stopped(value), 'DEPLOY_STOP_UNCONFIRMED');
  else if (action === 'start') need(running(value), 'DEPLOY_START_UNCONFIRMED');
  else if (action === 'rename') need(value.Name === '/' + details.targetName, 'DEPLOY_RENAME_UNCONFIRMED');
  else if (action === 'disconnect') need(!value.NetworkSettings?.Networks?.[APP_NETWORK], 'DEPLOY_DISCONNECT_UNCONFIRMED');
  else if (action === 'connect') need(value.NetworkSettings?.Networks?.[APP_NETWORK]?.NetworkID === companion.network.Id && endpointEqual(value.NetworkSettings.Networks[APP_NETWORK], companion.originals[role].NetworkSettings.Networks[APP_NETWORK]), 'DEPLOY_CONNECT_UNCONFIRMED');
  else need(false, 'DEPLOY_LEDGER_ACTION_INVALID'); return { id: value.Id, name: value.Name, running: value.State.Running, networks: Object.keys(value.NetworkSettings?.Networks ?? {}) };
}
async function mutation(context, details, method, route, body) {
  await assertProtected(context);
  // Re-read the exact target immediately before every mutation. A stale earlier
  // snapshot cannot authorize stopping or deleting a concurrently changed app.
  if (details.id) { const target = await context.request('GET', '/containers/' + details.id + '/json'); if (details.original) assertOriginal(target, context.companion.originals[details.role], context.companion.names, details.role); else assertCandidate(target, context.companion.desired[details.role], context.plan.operationId, details.role, details.name, context.companion.originals[details.role], context.companion.network.Id); }
  const events = await ledger(context), step = groups(events).length; await record(context, { step, phase: 'before', details, method, route, requestSha256: canonicalSha256(body ?? null) }); let response, requestError;
  try { response = await context.request(method, route, body); await record(context, { step, phase: 'returned', ...(response?.Id ? { id: response.Id } : {}) }); } catch (error) { requestError = error; }
  try { const observed = await observe(context, details, response?.Id ? { id: response.Id } : null); await record(context, { step, phase: 'admitted', requestWasUncertain: Boolean(requestError), observed }); return observed; }
  catch (error) { await record(context, { step, phase: 'unconfirmed', code: code(requestError ?? error) }).catch(() => {}); throw Object.assign(Error('DEPLOY_RECONCILIATION_REQUIRED'), { code: 'DEPLOY_RECONCILIATION_REQUIRED' }); }
}
async function reconcile(context) {
  for (const group of groups(await ledger(context))) {
    if (group.some(event => event.phase === 'admitted')) continue;
    const before = group[0]; need(before.phase === 'before', 'DEPLOY_LEDGER_INVALID'); const returned = group.find(event => event.phase === 'returned');
    try { const observed = await observe(context, before.details, returned); await record(context, { step: before.step, phase: 'admitted', reconciled: true, observed }); }
    catch { need(false, 'DEPLOY_RECONCILIATION_REQUIRED'); }
  }
}
function createdContainers(events) { return groups(events).filter(group => group[0].details.action === 'create-container' && group.some(event => event.phase === 'admitted')).map(group => ({ ...group[0].details, ...group.findLast(event => event.phase === 'admitted').observed })); }
async function assertOutside(context, all) { for (const expected of context.companion.outside) { const actual = all.find(item => item.Id === expected.id); need(actual && same(identity(actual), expected), 'DEPLOY_FOREIGN_RUNTIME_CHANGED'); } await assertProtected(context); }
async function releaseLock(context, result) { const lock = path.join(context.parent, 'main5180-deploy.lock'), value = await json(lock); need(value.operationId === context.plan.operationId && same(value.plan, context.planPin), 'DEPLOY_LOCK_CHANGED'); const archived = path.join(context.directory, 'deployment-lock-released' + (context.releaseSuffix ?? '') + '.private.json'); try { await fs.lstat(archived); need(false, 'DEPLOY_RELEASE_WITNESS_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; } await fs.rename(lock, archived); const observed = await json(archived); need(same(observed, value), 'DEPLOY_LOCK_RELEASE_UNCONFIRMED'); return { ...result, sourceLockReleased: true }; }
async function rollback(context) {
  await assertProtected(context); await reconcile(context); const all = await inspectAll(context.request), created = createdContainers(await ledger(context));
  const own = all.filter(item => item.Config?.Labels?.['wfc.preparer.deployment.owner'] === context.plan.operationId); need(own.every(item => created.some(row => row.id === item.Id)), 'DEPLOY_UNRECORDED_OWNED_RESOURCE');
  for (const role of ['web', 'api', 'preparer']) {
    const row = created.find(item => item.role === role); if (!row) continue; const actual = all.find(item => item.Id === row.id); if (!actual) continue; const name = row.name.replace(/^\//, ''); assertCandidate(actual, context.companion.desired[role], context.plan.operationId, role, name, context.companion.originals[role], context.companion.network.Id);
    if (!stopped(actual)) await mutation(context, { action: 'stop', role, id: actual.Id, name, original: false }, 'POST', '/containers/' + actual.Id + '/stop?t=45');
    await mutation(context, { action: 'remove', role, id: actual.Id, name, original: false }, 'DELETE', '/containers/' + actual.Id + '?v=false');
  }
  for (const role of ['api', 'web']) {
    const before = context.companion.originals[role]; let actual = await context.request('GET', '/containers/' + before.Id + '/json'); assertOriginal(actual, before, context.companion.names, role);
    if (!actual.NetworkSettings?.Networks?.[APP_NETWORK]) await mutation(context, { action: 'connect', role, id: before.Id, original: true }, 'POST', '/networks/' + context.companion.network.Id + '/connect', { Container: before.Id, EndpointConfig: endpointConfiguration(before.NetworkSettings.Networks[APP_NETWORK]) });
    if (actual.Name !== before.Name) await mutation(context, { action: 'rename', role, id: before.Id, targetName: before.Name.slice(1), original: true }, 'POST', '/containers/' + before.Id + '/rename?name=' + encodeURIComponent(before.Name.slice(1)));
    actual = await context.request('GET', '/containers/' + before.Id + '/json'); if (!running(actual)) await mutation(context, { action: 'start', role, id: before.Id, original: true }, 'POST', '/containers/' + before.Id + '/start');
  }
  await (context.options.health ?? health)(5180, context.options.signal); await assertOutside(context, await inspectAll(context.request));
  const volumeList = await context.request('GET', '/volumes'); need(Array.isArray(volumeList.Volumes), 'DEPLOY_VOLUME_LIST_INVALID');
  const retained = volumeList.Volumes.filter(item => item.Labels?.['wfc.preparer.deployment.owner'] === context.plan.operationId);
  need(retained.every(item => Object.entries(context.companion.names.volumes).some(([role, name]) => item.Name === name && same(item.Labels, ownerLabels(context.plan.operationId, 'volume-' + role)))), 'DEPLOY_UNRECORDED_OWNED_RESOURCE');
  const result = { schemaVersion: 'wfc.preparer.main-deploy-rollback.v1', status: 'ROLLED_BACK', operationId: context.plan.operationId, productionDeployment: context.production, originalApiWebHealthy: true, databaseRestored: false, databaseChangesReversed: false, preparerVolumesRetained: retained.map(item => item.Name).sort(), retainedOriginalContainers: true, completedAt: new Date().toISOString() };
  await writeJsonNew(path.join(context.directory, 'rollback-complete.private.json'), result); return releaseLock(context, result);
}
export async function deployMainDeployment(args, options = {}) {
  const context = await loadPlan(args, options); await sourceLocks(context.parent); const verified = await verifyDeploymentGates(context.intent, options); await mainWitness(context.intent.main, options.git);
  const all = await inspectAll(context.request); await assertBaseline(Object.fromEntries(ROLES.map(role => [role, all.find(item => item.Id === context.companion.originals[role].Id)])), verified, context.request); await assertOutside(context, all);
  need(!all.some(item => Object.values(item.HostConfig?.PortBindings ?? {}).flat().some(entry => entry.HostPort === '5193')) && !all.some(item => item.NetworkSettings?.Networks?.[APP_NETWORK]?.Aliases?.includes('preparer')), 'DEPLOY_PORT_OR_ALIAS_IN_USE'); await (options.probePort ?? probePort)();
  for (const name of ['complete.private.json', 'failure.private.json', 'rollback-complete.private.json', 'mutation-ledger.private.jsonl']) { try { await fs.lstat(path.join(context.directory, name)); need(false, 'DEPLOY_ATTEMPT_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  await writePrivateJson(path.join(context.parent, 'main5180-deploy.lock'), { schemaVersion: 'wfc.preparer.main-deploy-lock.v1', operationId: context.plan.operationId, plan: context.planPin, operationDirectory: context.directory });
  let verifiedDeployment = false;
  try {
    for (const [role, name] of Object.entries(context.companion.names.volumes)) await mutation(context, { action: 'create-volume', role, name }, 'POST', '/volumes/create', { Name: name, Driver: 'local', Labels: ownerLabels(context.plan.operationId, 'volume-' + role) });
    const preparer = await mutation(context, { action: 'create-container', role: 'preparer', name: context.companion.names.preparer }, 'POST', '/containers/create?name=' + encodeURIComponent(context.companion.names.preparer), context.companion.desired.preparer);
    await mutation(context, { action: 'start', role: 'preparer', id: preparer.id, name: context.companion.names.preparer, original: false }, 'POST', '/containers/' + preparer.id + '/start'); await (options.health ?? health)(5193, options.signal);
    await mainWitness(context.intent.main, options.git);
    for (const role of ['web', 'api']) {
      const before = context.companion.originals[role]; await mutation(context, { action: 'stop', role, id: before.Id, original: true }, 'POST', '/containers/' + before.Id + '/stop?t=45');
      await mutation(context, { action: 'rename', role, id: before.Id, original: true, targetName: context.companion.names.rollback[role] }, 'POST', '/containers/' + before.Id + '/rename?name=' + encodeURIComponent(context.companion.names.rollback[role]));
      await mutation(context, { action: 'disconnect', role, id: before.Id, original: true }, 'POST', '/networks/' + context.companion.network.Id + '/disconnect', { Container: before.Id, Force: false });
    }
    for (const role of ['api', 'web']) { const name = context.companion.originals[role].Name.slice(1), item = await mutation(context, { action: 'create-container', role, name }, 'POST', '/containers/create?name=' + encodeURIComponent(name), context.companion.desired[role]); await mutation(context, { action: 'start', role, id: item.id, name, original: false }, 'POST', '/containers/' + item.id + '/start'); }
    await (options.health ?? health)(5180, options.signal); await (options.health ?? health)(5193, options.signal); await mainWitness(context.intent.main, options.git); const final = await inspectAll(context.request); await assertOutside(context, final);
    for (const role of ['api', 'web']) { const actual = final.find(item => item.Id === context.companion.originals[role].Id); assertOriginal(actual, context.companion.originals[role], context.companion.names, role); need(stopped(actual) && actual.Name === '/' + context.companion.names.rollback[role] && !actual.NetworkSettings.Networks[APP_NETWORK], 'DEPLOY_ROLLBACK_CONTAINER_NOT_RETAINED'); }
    const candidates = createdContainers(await ledger(context)); for (const row of candidates) { const actual = final.find(item => item.Id === row.id); assertCandidate(actual, context.companion.desired[row.role], context.plan.operationId, row.role, row.name.replace(/^\//, ''), context.companion.originals[row.role], context.companion.network.Id); need(running(actual), 'DEPLOY_CANDIDATE_NOT_RUNNING'); }
    for (const alias of ['api', 'preparer']) { const expectedRole = alias, matches = final.filter(item => item.NetworkSettings?.Networks?.[APP_NETWORK]?.Aliases?.includes(alias)); need(matches.length === 1 && matches[0].Id === candidates.find(item => item.role === expectedRole)?.id, 'DEPLOY_APPLICATION_ALIAS_COLLISION'); }
    need(groups(await ledger(context)).every(group => group.some(event => event.phase === 'admitted')) && candidates.length === 3, 'DEPLOY_RECONCILIATION_REQUIRED');
    const result = { schemaVersion: 'wfc.preparer.main-deployment.v1', status: 'PASS', operationId: context.plan.operationId, productionDeployment: context.production, plan: context.planPin, productRevision: context.intent.productRevision, images: context.intent.images, candidates: candidates.map(item => ({ role: item.role, id: item.id, name: item.name })), rollbackContainers: Object.fromEntries(['api', 'web'].map(role => [role, { id: context.companion.originals[role].Id, name: context.companion.names.rollback[role], image: context.companion.originals[role].Image }])), primaryHealth: 'PASS', preparerHealth: 'PASS', pgMinioRuntimeUnchanged: true, dataNoDriftClaim: false, realAutodeskRequestsByOperator: 0, realModelImportsByOperator: 0, productionCloudAcceptance: 'NOT_RUN_BY_USER_REQUIREMENT', browserAcceptance: 'NOT_RUN', ledger: await pin(context.ledgerPath), completedAt: new Date().toISOString() };
    verifiedDeployment = true;
    await writeJsonNew(path.join(context.directory, 'complete.private.json'), result); return await releaseLock(context, result);
  } catch (error) {
    let outcome = { status: 'UNCONFIRMED', reconciliationRequired: true, sourceLockRetained: true };
    // A terminal receipt/release IO failure does not authorize changing an
    // already verified delivery. Keep it for explicit reconciliation instead.
    if (!verifiedDeployment) try { await reconcile(context); outcome = await rollback(context); } catch (rollbackError) { outcome.code = code(rollbackError); }
    await writeJsonNew(path.join(context.directory, 'failure.private.json'), { schemaVersion: 'wfc.preparer.main-deploy-failure.v1', status: 'FAIL', operationId: context.plan.operationId, code: code(error), rollback: outcome, automaticRetry: false });
    throw Object.assign(Error(code(error)), { code: code(error), rollback: outcome });
  }
}
export async function rollbackMainDeployment(args, options = {}) {
  const context = await loadPlan(args, options); await sourceLocks(context.parent, { deploy: true }); const filename = path.join(context.parent, 'main5180-deploy.lock'); let lock;
  try { await fs.lstat(path.join(context.directory, 'deployment-lock-released.private.json')); context.releaseSuffix = '-rollback'; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { lock = await json(filename); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const complete = await json(path.join(context.directory, 'complete.private.json')), released = await json(path.join(context.directory, 'deployment-lock-released.private.json'));
    need(complete.schemaVersion === 'wfc.preparer.main-deployment.v1' && complete.status === 'PASS' && complete.operationId === context.plan.operationId && same(complete.plan, context.planPin) && complete.productRevision === context.intent.productRevision && same(complete.images, context.intent.images), 'DEPLOY_TERMINAL_INVALID'); await assertPin(complete.ledger);
    need(released.schemaVersion === 'wfc.preparer.main-deploy-lock.v1' && released.operationId === context.plan.operationId && same(released.plan, context.planPin) && released.operationDirectory === context.directory, 'DEPLOY_LOCK_RELEASE_UNCONFIRMED');
    // Explicit rollback is a new bounded operation on the same admitted IDs.
    // Retain the first release witness and use a distinct final release name.
    context.releaseSuffix = '-rollback'; await writePrivateJson(filename, released); lock = released;
  }
  need(lock.schemaVersion === 'wfc.preparer.main-deploy-lock.v1' && lock.operationId === context.plan.operationId && same(lock.plan, context.planPin) && lock.operationDirectory === context.directory, 'DEPLOY_LOCK_CHANGED');
  // Rollback never restores an old database backup or reverses migration/data.
  return rollback(context);
}
export async function main(args) {
  need(args.length === 5 && ['plan', 'deploy', 'rollback'].includes(args[0]) && args[1] === (args[0] === 'plan' ? '--intent' : '--plan') && args[3] === '--sha256', 'DEPLOY_ARGUMENT_INVALID');
  const result = args[0] === 'plan' ? await planMainDeployment({ intentPath: args[2], intentSha256: args[4] }) : args[0] === 'deploy' ? await deployMainDeployment({ planPath: args[2], planSha256: args[4] }) : await rollbackMainDeployment({ planPath: args[2], planSha256: args[4] });
  console.log(JSON.stringify({ status: result.status, operationId: result.operationId, productionDeployment: result.productionDeployment ?? null, ...(result.plan ? { plan: result.plan } : {}), ...(result.sourceLockReleased ? { sourceLockReleased: true } : {}) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { console.log(JSON.stringify({ status: 'FAIL', code: code(error), ...(error.rollback ? { rollbackStatus: error.rollback.status, sourceLockRetained: error.rollback.sourceLockRetained === true } : {}) })); process.exitCode = 1; });
