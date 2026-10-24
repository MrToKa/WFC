import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEPLOYMENT_IMAGES, DEPLOYMENT_LIMITS, validateDeploymentIntent, primaryConfiguration, preparerConfiguration, deploymentNames, verifyDeploymentGates, verifyRecoveryGate, planMainDeployment, deployMainDeployment, rollbackMainDeployment } from './deploy-main.mjs';
import { canonicalSha256, networkAttachmentIdentity } from './offline-seed.mjs';
import { hashFile } from './foundation/archives.mjs';

// These tests use an in-process Docker transport, private synthetic files and
// synthetic gate verifiers. They never invoke Docker, a network or Autodesk.
const NETWORK = 'wfc-app_application', NETWORK_ID = 'a'.repeat(64);
const OLD_BRIDGE = 'b'.repeat(64), NEW_BRIDGE = 'c'.repeat(64);
const PRODUCT = '543ae7a889fbf1abbf4937f5f83b2c6ee1b91ff4', MAIN = '96e63f13' + '0'.repeat(32);
const NOW = Date.parse('2026-10-24T10:00:00.000Z'), clone = value => structuredClone(value);
const fault = value => Object.assign(Error(value), { code: value });
const read = async filename => JSON.parse(await fs.readFile(filename, 'utf8'));
const pin = async filename => ({ path: filename, ...await hashFile(filename) });
async function save(filename, value) { await fs.writeFile(filename, JSON.stringify(value), { mode: 0o600 }); return pin(filename); }
const attachments = aliases => ({ [NETWORK]: { NetworkID: NETWORK_ID, Aliases: aliases, IPAMConfig: null, Links: null, DriverOpts: null, GwPriority: 0, EndpointID: 'd'.repeat(64), IPAddress: '172.20.0.10' } });
function original(role, digit, port) {
  const volume = 'synthetic-original-' + role, target = role === 'api' ? '/var/lib/wfc/model-imports' : '/synthetic/' + role;
  return { Id: digit.repeat(64), Name: '/wfc-app-' + role + '-1', Image: 'sha256:' + digit.repeat(64),
    Config: { Image: 'synthetic-' + role + ':baseline', Hostname: 'old-' + role, User: 'node', Env: ['NODE_ENV=production', 'JWT_SECRET=private-synthetic-jwt', 'DATABASE_URL=postgres://private-synthetic-user:private-synthetic-password@postgres/wfc_app', ...(role === 'api' ? ['WFC_PREPARER_INTERNAL_ORIGIN=http://old:9999', 'WFC_PREPARER_PUBLIC_ORIGIN=http://old:9999'] : [])], Cmd: ['node', 'server.mjs'], Entrypoint: ['docker-entrypoint.sh'], WorkingDir: '/app', AttachStdout: true, AttachStderr: true, Labels: { 'com.docker.compose.project': 'wfc-app', 'com.docker.compose.service': role, 'org.opencontainers.image.revision': 'old-image-revision', 'wfc.preparer.delivery.role': 'stale', 'wfc.preparer.delivery.stale': 'old-only', 'site.operational': 'retain' }, Volumes: { [target]: {} } },
    HostConfig: { NetworkMode: NETWORK, Mounts: [{ Type: 'volume', Source: volume, Target: target, ReadOnly: false }], PortBindings: port ? { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: String(port) }] } : {}, RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 }, ReadonlyRootfs: false, Memory: 0, Privileged: false },
    Mounts: [{ Type: 'volume', Name: volume, Source: '/var/lib/docker/volumes/' + volume + '/_data', Destination: target, Driver: 'local', Mode: '', RW: true, Propagation: '' }],
    NetworkSettings: { Networks: attachments([role, 'wfc-app-' + role + '-1']) }, State: { Status: 'running', Running: true, Restarting: false, Pid: 100 + Number(digit), StartedAt: '2026-10-24T08:00:00Z' } };
}
function fakeDocker(originals) {
  const containers = new Map(Object.values(originals).map(item => [item.Id, clone(item)])), volumes = new Map(), calls = [];
  const images = new Map(Object.entries(DEPLOYMENT_IMAGES).map(([role, id]) => [id, { Id: id, Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': PRODUCT, 'wfc.preparer.delivery.role': role, 'com.docker.compose.project': 'image-must-not-replace-operational' }, Env: ['PATH=/usr/local/bin', 'NODE_VERSION=24.22.0'], WorkingDir: '/opt/preparer', Entrypoint: ['docker-entrypoint.sh'], ...(role === 'preparer' ? { ExposedPorts: { '4000/tcp': {}, '8080/tcp': {} } } : {}) } }]));
  let sequence = 1000;
  const docker = { containers, volumes, images, calls, hook: null,
    async request(method, route, body) {
      calls.push({ method, route, body: clone(body) }); if (docker.hook) { const handled = await docker.hook({ method, route, body }, docker); if (handled?.handled) return clone(handled.value); }
      const url = new URL(route, 'http://synthetic.invalid'), parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (method === 'GET' && url.pathname === '/containers/json') return [...containers.values()].map(item => ({ Id: item.Id }));
      if (method === 'GET' && parts[0] === 'containers' && parts[2] === 'json') { const value = containers.get(parts[1]); if (!value) throw fault('DOCKER_REQUEST_FAILED'); return clone(value); }
      if (method === 'GET' && parts[0] === 'images') { const value = images.get(parts[1]); if (!value) throw fault('DOCKER_REQUEST_FAILED'); return clone(value); }
      if (method === 'GET' && url.pathname === '/networks') return [{ Name: NETWORK, Id: NETWORK_ID }, { Name: 'bridge', Id: NEW_BRIDGE }];
      if (method === 'GET' && parts[0] === 'networks') { if (parts[1] === NEW_BRIDGE) return { Name: 'bridge', Id: NEW_BRIDGE, Internal: false, Driver: 'bridge' }; if (![NETWORK, NETWORK_ID].includes(parts[1])) throw fault('DOCKER_REQUEST_FAILED'); return { Name: NETWORK, Id: NETWORK_ID, Internal: false, Driver: 'bridge' }; }
      if (method === 'GET' && url.pathname === '/volumes') return { Volumes: [...volumes.values()].map(clone) };
      if (method === 'GET' && parts[0] === 'volumes') { const value = volumes.get(parts[1]); if (!value) throw fault('DOCKER_REQUEST_FAILED'); return clone(value); }
      if (method === 'POST' && url.pathname === '/volumes/create') { if (volumes.has(body.Name)) return clone(volumes.get(body.Name)); const value = { Name: body.Name, Driver: body.Driver, Labels: clone(body.Labels), Options: null, Mountpoint: '/synthetic/' + body.Name }; volumes.set(value.Name, value); return clone(value); }
      if (method === 'POST' && url.pathname === '/containers/create') {
        const name = url.searchParams.get('name'); if ([...containers.values()].some(item => item.Name === '/' + name)) throw fault('DOCKER_REQUEST_FAILED');
        const id = (++sequence).toString(16).padStart(64, '0'), config = clone(body); delete config.HostConfig; delete config.NetworkingConfig;
        if (images.get(body.Image)?.Config.ExposedPorts || config.ExposedPorts) config.ExposedPorts = { ...clone(images.get(body.Image)?.Config.ExposedPorts ?? {}), ...config.ExposedPorts };
        const mounts = (body.HostConfig.Mounts ?? []).map(item => ({ Type: item.Type, Name: item.Source, Source: '/var/lib/docker/volumes/' + item.Source + '/_data', Destination: item.Target, Driver: 'local', Mode: '', RW: !item.ReadOnly, Propagation: '' }));
        const network = clone(body.NetworkingConfig.EndpointsConfig[NETWORK]), item = { Id: id, Name: '/' + name, Image: body.Image, Config: config, HostConfig: clone(body.HostConfig), Mounts: mounts, NetworkSettings: { Networks: { [NETWORK]: { IPAMConfig: null, Links: null, DriverOpts: null, GwPriority: 0, ...network, NetworkID: NETWORK_ID } } }, State: { Status: 'created', Running: false, Restarting: false, Pid: 0, StartedAt: '0001-01-01T00:00:00Z' } };
        // Match native Engine inspection rather than echoing JSON requests.
        for (const mount of item.HostConfig.Mounts ?? []) if (mount.ReadOnly === false) delete mount.ReadOnly;
        if (item.HostConfig.RestartPolicy) item.HostConfig.RestartPolicy.MaximumRetryCount ??= 0;
        containers.set(id, item); return { Id: id, Warnings: [] };
      }
      if (method === 'POST' && parts[0] === 'containers') {
        const item = containers.get(parts[1]); if (!item) throw fault('DOCKER_REQUEST_FAILED');
        if (parts[2] === 'stop') { item.State = { ...item.State, Status: 'exited', Running: false, Pid: 0 }; return null; }
        if (parts[2] === 'start') { item.State = { Status: 'running', Running: true, Restarting: false, Pid: 900 + sequence, StartedAt: '2026-10-24T10:00:01Z' }; return null; }
        if (parts[2] === 'rename') { const name = '/' + url.searchParams.get('name'); if ([...containers.values()].some(other => other.Id !== item.Id && other.Name === name)) throw fault('DOCKER_REQUEST_FAILED'); item.Name = name; return null; }
      }
      if (method === 'DELETE' && parts[0] === 'containers') { const item = containers.get(parts[1]); if (!item || item.State.Running || url.searchParams.get('v') !== 'false') throw fault('DOCKER_REQUEST_FAILED'); containers.delete(item.Id); return null; }
      if (method === 'POST' && parts[0] === 'networks') { const item = containers.get(body.Container); if (!item) throw fault('DOCKER_REQUEST_FAILED'); if (parts[2] === 'disconnect') { delete item.NetworkSettings.Networks[NETWORK]; return null; } if (parts[2] === 'connect') { item.NetworkSettings.Networks[NETWORK] = { ...clone(body.EndpointConfig), NetworkID: NETWORK_ID }; return null; } }
      throw fault('UNEXPECTED_FAKE_DOCKER_REQUEST');
    } };
  return docker;
}
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'wfc-deploy-fixture-'));
  t.after(async () => { assert.equal(path.dirname(root), parent); await fs.rm(root, { recursive: true, force: true }); });
  await fs.mkdir(path.join(root, '.preparer-work')); const mainRoot = path.join(root, 'canonical-main'); await fs.mkdir(mainRoot);
  const operationId = randomUUID(), originals = { api: original('api', '1'), web: original('web', '2', 5180), postgres: original('postgres', '3'), minio: original('minio', '4') };
  originals.postgres.HostConfig.NetworkMode = 'bridge'; originals.postgres.NetworkSettings.Networks = { bridge: { NetworkID: NEW_BRIDGE, Aliases: null, IPAMConfig: null, Links: null, DriverOpts: null, GwPriority: 0 } };
  const docker = fakeDocker(originals), seed = await save(path.join(root, 'seed.private.json'), { synthetic: 'seed' }), recovery = await save(path.join(root, 'recovery.private.json'), { synthetic: 'recovery' }), upgrade = await save(path.join(root, 'upgrade.private.json'), { synthetic: 'upgrade' });
  const sp5 = { schemaVersion: 'wfc.preparer.sp5-integration-qualification.v1', status: 'PASS', productRevision: PRODUCT, images: { ...DEPLOYMENT_IMAGES, postgres: originals.postgres.Image, minio: originals.minio.Image }, browserAcceptance: 'PASS', twoAdminIsolation: 'PASS', restartAndLocalZipRecovery: 'PASS', noCredentialPersistence: 'PASS', realAutodeskRequests: 0, productionCloudAcceptance: 'NOT_RUN_BY_USER_REQUIREMENT', cleanup: 'PASS', resourcesRemoved: true, checkedAt: new Date(NOW - 1000).toISOString() };
  const sp5Path = path.join(root, 'sp5.private.json'), sp5Pin = await save(sp5Path, sp5);
  const repairValue = { schemaVersion: 'wfc.preparer.main-repair-reconciled.v1', status: 'PASS', nonTargetIdentityAndStateUnchanged: true, declaredDynamicDifference: { role: 'postgres', field: 'NetworkSettings.Networks.bridge.NetworkID', oldId: OLD_BRIDGE, newId: NEW_BRIDGE, oldIdNoLongerExists: true, newIdVerifiedDefaultBridge: true, configuredNetworkMode: 'bridge' } }, repair = await save(path.join(root, 'repair.private.json'), repairValue);
  const intent = { schemaVersion: 'wfc.preparer.main-deploy-intent.v1', operationId, main: { root: mainRoot, revision: MAIN }, productRevision: PRODUCT, images: clone(DEPLOYMENT_IMAGES), gates: { seed, recovery, upgrade, repair, sp5: sp5Pin } };
  const expected = { seed: { completedAt: new Date(NOW - 60000).toISOString() }, intent: { source: { roles: Object.fromEntries(Object.entries(originals).map(([role, item]) => { const networks = networkAttachmentIdentity(item); if (role === 'postgres') networks.bridge.NetworkID = OLD_BRIDGE; return [role, { id: item.Id, image: item.Image, configSha256: canonicalSha256(item.Config), hostConfigSha256: canonicalSha256(item.HostConfig), mountsSha256: canonicalSha256(item.Mounts), networksSha256: canonicalSha256(networks) }]; })) } } };
  const qualifiedUpgrade = { status: 'PASS', productionQualification: true, sourceLockReleased: true, productRevision: PRODUCT, candidateApiImage: DEPLOYMENT_IMAGES.api, rollbackApiImage: originals.api.Image, seed };
  const options = { root, docker, now: () => NOW, git: async (_root, args) => Buffer.from(args[0] === 'status' ? '' : MAIN + '\n'), verifySeed: async () => expected, verifyRecovery: async () => ({ status: 'PASS' }), verifyUpgrade: async () => qualifiedUpgrade, probePort: async () => {}, health: async () => {} };
  const intentPath = path.join(root, 'intent.private.json'); let intentPin = await save(intentPath, intent);
  return { root, operationId, intent, originals, docker, expected, sp5, qualifiedUpgrade, options, async saveIntent() { intentPin = await save(intentPath, intent); return intentPin; }, async saveSp5() { intent.gates.sp5 = await save(sp5Path, sp5); await this.saveIntent(); }, async plan() { const item = await planMainDeployment({ intentPath, intentSha256: intentPin.sha256 }, options); return { item, args: { planPath: item.plan.path, planSha256: item.plan.sha256 } }; } };
}
const mutations = docker => docker.calls.filter(item => item.method !== 'GET');
const candidates = docker => [...docker.containers.values()].filter(item => item.Config.Labels?.['wfc.preparer.deployment.owner']);
async function absent(filename) { await assert.rejects(fs.stat(filename), { code: 'ENOENT' }); }

test('primary configurations preserve auth, ports, mounts and operational labels; image provenance is current', () => {
  const before = original('api', '1'), operationId = randomUUID(), imageConfig = { Labels: { 'org.opencontainers.image.revision': PRODUCT, 'wfc.preparer.delivery.role': 'api', 'com.docker.compose.project': 'bad-image-operational' } };
  const actual = primaryConfiguration(before, DEPLOYMENT_IMAGES.api, imageConfig, operationId, 'api');
  assert.deepEqual(actual.HostConfig, before.HostConfig); assert.deepEqual(actual.NetworkingConfig.EndpointsConfig[NETWORK].Aliases, ['api', 'wfc-app-api-1']);
  assert.deepEqual(actual.Env.filter(entry => !entry.startsWith('WFC_PREPARER_')), before.Config.Env.filter(entry => !entry.startsWith('WFC_PREPARER_')));
  assert.equal(actual.Env.filter(entry => entry.startsWith('WFC_PREPARER_INTERNAL_ORIGIN=')).length, 1); assert(actual.Env.includes('WFC_PREPARER_INTERNAL_ORIGIN=http://preparer:8080')); assert(actual.Env.includes('WFC_PREPARER_PUBLIC_ORIGIN=http://127.0.0.1:5193'));
  assert.equal(actual.Labels['com.docker.compose.project'], 'wfc-app'); assert.equal(actual.Labels['site.operational'], 'retain'); assert.equal(actual.Labels['org.opencontainers.image.revision'], PRODUCT); assert.equal(actual.Labels['wfc.preparer.delivery.role'], 'api'); assert.equal(actual.Labels['wfc.preparer.delivery.stale'], undefined);
  assert.deepEqual(before, original('api', '1')); const web = original('web', '2', 5180), webConfig = primaryConfiguration(web, DEPLOYMENT_IMAGES.web, imageConfig, operationId, 'web'); assert.deepEqual(webConfig.Env, web.Config.Env); assert.deepEqual(webConfig.HostConfig.PortBindings, web.HostConfig.PortBindings);
});

test('Preparer has three owned persistent mounts, nonroot user and only direct fixed 5193 publication', () => {
  const operationId = randomUUID(), names = deploymentNames(operationId, { api: original('api', '1'), web: original('web', '2') }), image = { Env: ['PATH=/usr/local/bin', 'NODE_VERSION=24.22.0'], WorkingDir: '/opt/preparer', Entrypoint: ['docker-entrypoint.sh'], Labels: {}, ExposedPorts: { '4000/tcp': {}, '8080/tcp': {} } };
  const actual = preparerConfiguration(image, operationId, names, NETWORK_ID); assert.equal(actual.User, 'node'); assert.equal(actual.HostConfig.ReadonlyRootfs, true); assert.deepEqual(actual.HostConfig.CapDrop, ['ALL']);
  assert.equal(actual.HostConfig.Mounts.length, 3); assert.deepEqual(actual.ExposedPorts, image.ExposedPorts); assert.deepEqual(actual.HostConfig.PortBindings, { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '5193' }] }); assert.equal(actual.HostConfig.PublishAllPorts, false); assert(actual.Env.includes('PREPARER_WFC_ORIGIN=http://api:4000')); assert(actual.Env.includes('PREPARER_PUBLIC_ORIGIN=http://127.0.0.1:5193')); assert(!actual.Env.some(item => /^(APS_|AUTODESK_)/.test(item)));
  assert.throws(() => preparerConfiguration({ ...image, Env: ['APS_CLIENT_SECRET=never-product-env'] }, operationId, names, NETWORK_ID), { code: 'DEPLOY_PREPARER_IMAGE_ENVIRONMENT' });
  for (const ExposedPorts of [{ '4000/tcp': {} }, { '8080/tcp': {}, '9999/tcp': {} }, { '8080/tcp': { unexpected: true } }]) assert.throws(() => preparerConfiguration({ ...image, ExposedPorts }, operationId, names, NETWORK_ID), { code: 'DEPLOY_PREPARER_IMAGE_PORT_PROFILE' });
});

test('intent rejects alternate ports/images, incomplete pins and non-v4 identities', async t => {
  const f = await fixture(t); assert.equal(validateDeploymentIntent(f.intent), f.intent);
  for (const update of [item => item.images.api = f.originals.api.Image, item => item.gates.seed.bytes = 0, item => item.productRevision = '0'.repeat(40), item => item.operationId = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa', item => item.extra = 1]) { const invalid = clone(f.intent); update(invalid); assert.throws(() => validateDeploymentIntent(invalid)); }
});

test('gate requires fresh backup, exact candidates, all SP5 acceptance and released upgrade lock', async t => {
  for (const [label, update, expectedCode] of [
    ['stale backup', f => f.expected.seed.completedAt = new Date(NOW - DEPLOYMENT_LIMITS.maxBackupAgeMs - 1).toISOString(), 'DEPLOY_BACKUP_NOT_FRESH'],
    ['future backup', f => f.expected.seed.completedAt = new Date(NOW + 1).toISOString(), 'DEPLOY_BACKUP_NOT_FRESH'],
    ['unreleased upgrade', f => f.qualifiedUpgrade.sourceLockReleased = false, 'DEPLOY_UPGRADE_GATE_FAILED'],
    ['wrong rollback image', f => f.qualifiedUpgrade.rollbackApiImage = DEPLOYMENT_IMAGES.api, 'DEPLOY_UPGRADE_GATE_FAILED'],
    ['missing browser acceptance', f => delete f.sp5.browserAcceptance, 'DEPLOY_SP5_GATE_FAILED'],
    ['retained fixture resources', f => f.sp5.resourcesRemoved = false, 'DEPLOY_SP5_GATE_FAILED'],
    ['wrong MinIO image', f => f.sp5.images.minio = DEPLOYMENT_IMAGES.api, 'DEPLOY_SP5_IMAGE_MISMATCH'],
    ['unexpected real APS', f => f.sp5.realAutodeskRequests = 1, 'DEPLOY_SP5_GATE_FAILED']
  ]) await t.test(label, async t => { const f = await fixture(t); update(f); await f.saveSp5(); await assert.rejects(verifyDeploymentGates(f.intent, f.options), { code: expectedCode }); assert.equal(mutations(f.docker).length, 0); });
});

test('recovery gate rejects retained failure and ambiguous-finalization markers', async t => {
  for (const marker of ['failure.private.json', 'finalization-failure.private.json']) await t.test(marker, async t => {
    const f = await fixture(t), directory = path.join(f.root, 'recovery-qualification'); await fs.mkdir(directory);
    const value = { schemaVersion: 'wfc.preparer.recovered-seed.v2', status: 'PASS', operationId: f.operationId, productionQualification: true, seed: f.intent.gates.seed, rawPublicData: 'PASS', publicGlobalSql: 'PASS', clusterRoleContext: 'PASS', modelAndOriginalZipAudit: 'PASS', cleanup: { status: 'PASS', resourcesRetained: false }, sourceClosure: [], evidence: [], dump: f.intent.gates.seed, comparison: f.intent.gates.seed };
    const expected = await save(path.join(directory, 'qualification.private.json'), value); await save(path.join(directory, 'complete.private.json'), { schemaVersion: 'wfc.preparer.recovery-complete.v1', operationId: f.operationId, productionQualification: true, qualification: expected, sourceLockRelease: 'pending' }); await save(path.join(directory, 'source-lock-released.private.json'), { schemaVersion: 'wfc.preparer.recovery-lock.v1', operationId: f.operationId, seedSha256: f.intent.gates.seed.sha256, operationDirectory: directory });
    assert.equal((await verifyRecoveryGate(expected, f.intent.gates.seed)).status, 'PASS'); await save(path.join(directory, marker), { status: 'FAIL' }); await assert.rejects(verifyRecoveryGate(expected, f.intent.gates.seed), { code: 'DEPLOY_RECOVERY_FAILURE_RETAINED' });
  });
});

test('only the hash-bound PG bridge-ID repair is admitted; another bridge change or alias is refused', async t => {
  for (const change of ['network-id', 'alias', 'config', 'mount', 'old-network-reappears']) await t.test(change, async t => {
    const f = await fixture(t), pg = f.docker.containers.get(f.originals.postgres.Id);
    if (change === 'network-id') pg.NetworkSettings.Networks.bridge.NetworkID = 'e'.repeat(64);
    if (change === 'alias') pg.NetworkSettings.Networks.bridge.Aliases = ['unapproved'];
    if (change === 'config') pg.Config.Env.push('UNAPPROVED=true');
    if (change === 'mount') pg.Mounts[0].RW = false;
    if (change === 'old-network-reappears') f.docker.hook = ({ method, route }) => method === 'GET' && route === '/networks' ? { handled: true, value: [{ Id: NETWORK_ID }, { Id: OLD_BRIDGE }, { Id: NEW_BRIDGE }] } : null;
    await assert.rejects(f.plan()); assert.equal(mutations(f.docker).length, 0);
  });
});

test('planning is read-only, pins originals privately and rejects occupied port or source drift', async t => {
  const f = await fixture(t), planned = await f.plan(), plan = await read(planned.args.planPath), companion = await read(plan.companion.path);
  assert.equal(planned.item.productionPlan, false); assert.equal(mutations(f.docker).length, 0); assert.deepEqual(companion.originals.api, f.originals.api); assert(!JSON.stringify(plan).includes('private-synthetic-password')); assert(!JSON.stringify(planned.item).includes('private-synthetic-jwt'));
  const compose = await read(plan.compose.path); assert.deepEqual(compose.services.preparer.ports, ['127.0.0.1:5193:8080']); assert.equal(Object.keys(compose.services).join(','), 'preparer'); assert.equal(compose.networks.application.external, true);
  await t.test('port collision', async t => { const f = await fixture(t); f.options.probePort = async () => { throw fault('DEPLOY_PORT_5193_IN_USE'); }; await assert.rejects(f.plan(), { code: 'DEPLOY_PORT_5193_IN_USE' }); assert.equal(mutations(f.docker).length, 0); });
  await t.test('dirty canonical main', async t => { const f = await fixture(t); f.options.git = async (_root, args) => Buffer.from(args[0] === 'status' ? ' M tracked.txt\0' : MAIN); await assert.rejects(f.plan(), { code: 'DEPLOY_MAIN_SOURCE_CHANGED' }); assert.equal(mutations(f.docker).length, 0); });
});

test('deployment replaces only API/web and adds separate Preparer, retaining exact rollback originals', async t => {
  const f = await fixture(t), { args } = await f.plan(), result = await deployMainDeployment(args, f.options);
  assert.equal(result.status, 'PASS'); assert.equal(result.productionDeployment, false); assert.equal(result.sourceLockReleased, true); assert.equal(result.dataNoDriftClaim, false); assert.equal(result.realAutodeskRequestsByOperator, 0); assert.equal(result.browserAcceptance, 'NOT_RUN'); assert.equal(candidates(f.docker).length, 3); assert.equal(f.docker.volumes.size, 3);
  for (const role of ['api', 'web']) { const old = f.docker.containers.get(f.originals[role].Id); assert.equal(old.State.Running, false); assert(old.Name.includes('-preparer-rollback-')); assert.deepEqual(old.NetworkSettings.Networks, {}); assert.deepEqual(old.Config, f.originals[role].Config); assert.deepEqual(old.Mounts, f.originals[role].Mounts); }
  for (const role of ['postgres', 'minio']) assert.deepEqual(f.docker.containers.get(f.originals[role].Id), f.originals[role]);
  assert(!mutations(f.docker).some(call => [f.originals.postgres.Id, f.originals.minio.Id].some(id => call.route.includes(id) || call.body?.Container === id)));
  await absent(path.join(f.root, '.preparer-work', 'main5180-deploy.lock'));
});

test('candidate health failure restores original applications and keeps every persistent volume', async t => {
  const f = await fixture(t), { args, item } = await f.plan(); let rejected = false;
  f.options.health = async port => { if (port === 5180 && candidates(f.docker).some(item => item.Config.Labels['wfc.preparer.deployment.purpose'] === 'web') && !rejected) { rejected = true; throw fault('DEPLOY_HEALTH_FAILED'); } };
  await assert.rejects(deployMainDeployment(args, f.options), error => error.code === 'DEPLOY_HEALTH_FAILED' && error.rollback.status === 'ROLLED_BACK' && error.rollback.sourceLockReleased === true);
  assert.equal(candidates(f.docker).length, 0); assert.equal(f.docker.volumes.size, 3); for (const role of ['api', 'web']) { const actual = f.docker.containers.get(f.originals[role].Id); assert.equal(actual.Name, f.originals[role].Name); assert.equal(actual.State.Running, true); assert.deepEqual(actual.Config, f.originals[role].Config); assert.deepEqual(actual.HostConfig, f.originals[role].HostConfig); assert.deepEqual(actual.NetworkSettings.Networks[NETWORK].Aliases, f.originals[role].NetworkSettings.Networks[NETWORK].Aliases); }
  const receipt = await read(path.join(item.operationDirectory, 'rollback-complete.private.json')); assert.equal(receipt.databaseRestored, false); assert.equal(receipt.databaseChangesReversed, false); assert.equal(receipt.preparerVolumesRetained.length, 3); assert(!mutations(f.docker).some(call => call.route.startsWith('/volumes/') && call.method === 'DELETE')); await absent(path.join(item.operationDirectory, 'complete.private.json'));
});

test('an explicit rollback after successful delivery uses retained identities and never restores DB data', async t => {
  const f = await fixture(t), { args, item } = await f.plan(); await deployMainDeployment(args, f.options); const result = await rollbackMainDeployment(args, f.options);
  assert.equal(result.status, 'ROLLED_BACK'); assert.equal(result.databaseChangesReversed, false); assert.equal(result.sourceLockReleased, true); assert.equal(candidates(f.docker).length, 0); assert.equal(f.docker.volumes.size, 3); await fs.stat(path.join(item.operationDirectory, 'deployment-lock-released.private.json')); await fs.stat(path.join(item.operationDirectory, 'deployment-lock-released-rollback.private.json')); await absent(path.join(f.root, '.preparer-work', 'main5180-deploy.lock'));
});

test('unknown create outcome stays locked until exact positive reconciliation; no blind delete or retry', async t => {
  const f = await fixture(t), { args, item } = await f.plan(); let hidden = true, hiddenId;
  f.docker.hook = ({ method, route }, docker) => {
    if (method === 'GET' && route.startsWith('/containers/') && route.endsWith('/json') && hidden) { const id = route.split('/')[2], value = docker.containers.get(id); if (value?.Config.Labels?.['wfc.preparer.deployment.purpose'] === 'preparer') { hiddenId = id; throw fault('DOCKER_REQUEST_FAILED'); } }
  };
  await assert.rejects(deployMainDeployment(args, f.options), error => error.code === 'DEPLOY_RECONCILIATION_REQUIRED' && error.rollback.status === 'UNCONFIRMED' && error.rollback.sourceLockRetained);
  assert(hiddenId); assert.equal(candidates(f.docker).length, 1); assert.equal(mutations(f.docker).filter(call => call.route.startsWith('/containers/create')).length, 1); assert(!mutations(f.docker).some(call => call.method === 'DELETE')); await fs.stat(path.join(f.root, '.preparer-work', 'main5180-deploy.lock')); await absent(path.join(item.operationDirectory, 'complete.private.json')); await absent(path.join(item.operationDirectory, 'rollback-complete.private.json'));
  hidden = false; const result = await rollbackMainDeployment(args, f.options); assert.equal(result.status, 'ROLLED_BACK'); assert.equal(candidates(f.docker).length, 0); assert.equal(f.docker.volumes.size, 3);
});

test('post-create transport uncertainty is admitted only when inspection positively proves the exact resource', async t => {
  const f = await fixture(t), { args, item } = await f.plan(); let disrupted = false;
  f.docker.hook = ({ method, route }, docker) => { if (!disrupted && method === 'GET' && route.startsWith('/volumes/') && route !== '/volumes') { disrupted = true; throw fault('DOCKER_REQUEST_FAILED'); } };
  // The first failed read aborts forward execution. Automatic reconciliation
  // can prove the created volume and safely restore unchanged originals.
  await assert.rejects(deployMainDeployment(args, f.options), error => error.rollback.status === 'ROLLED_BACK'); assert.equal(f.docker.volumes.size, 1);
  const receipt = await read(path.join(item.operationDirectory, 'rollback-complete.private.json')); assert.equal(receipt.preparerVolumesRetained.length, 1); assert.equal(candidates(f.docker).length, 0);
});

test('concurrent ownership or effective-mount changes are never stopped/deleted by rollback', async t => {
  for (const change of ['owner', 'mount']) await t.test(change, async t => {
    const f = await fixture(t), { args } = await f.plan(); await deployMainDeployment(args, f.options); const api = candidates(f.docker).find(item => item.Config.Labels['wfc.preparer.deployment.purpose'] === 'api');
    if (change === 'owner') api.Config.Labels['wfc.preparer.deployment.owner'] = randomUUID(); else api.Mounts[0].RW = false;
    const offset = f.docker.calls.length; await assert.rejects(rollbackMainDeployment(args, f.options)); const after = f.docker.calls.slice(offset).filter(call => call.method !== 'GET'); assert(!after.some(call => call.route.includes(api.Id))); assert(f.docker.containers.has(api.Id)); await fs.stat(path.join(f.root, '.preparer-work', 'main5180-deploy.lock'));
  });
});

test('native omitted writable ReadOnly is accepted; null, string and true cannot authorize admission', async t => {
  for (const invalid of [null, 'false', true]) await t.test(String(invalid), async t => {
    const f = await fixture(t), { args, item } = await f.plan();
    f.docker.hook = ({ method, route }, docker) => { if (method === 'GET' && route.startsWith('/containers/') && route.endsWith('/json')) { const value = docker.containers.get(route.split('/')[2]); if (value?.Config.Labels?.['wfc.preparer.deployment.purpose'] === 'preparer') value.HostConfig.Mounts[0].ReadOnly = invalid; } };
    await assert.rejects(deployMainDeployment(args, f.options), error => error.code === 'DEPLOY_RECONCILIATION_REQUIRED' && error.rollback.status === 'UNCONFIRMED'); assert(!mutations(f.docker).some(call => call.method === 'DELETE')); await absent(path.join(item.operationDirectory, 'complete.private.json')); await fs.stat(path.join(f.root, '.preparer-work', 'main5180-deploy.lock'));
  });
});

test('inherited image exposure is retained without accepting an additional host binding', async t => {
  const f = await fixture(t), { args, item } = await f.plan(); let altered = false;
  f.docker.hook = ({ method, route }, docker) => { if (method === 'GET' && route.startsWith('/containers/') && route.endsWith('/json')) { const value = docker.containers.get(route.split('/')[2]); if (value?.Config.Labels?.['wfc.preparer.deployment.purpose'] === 'preparer') { assert.deepEqual(value.Config.ExposedPorts, { '4000/tcp': {}, '8080/tcp': {} }); assert.equal(value.HostConfig.PublishAllPorts, false); value.HostConfig.PortBindings['4000/tcp'] = [{ HostIp: '0.0.0.0', HostPort: '4000' }]; altered = true; } } };
  await assert.rejects(deployMainDeployment(args, f.options), error => error.code === 'DEPLOY_RECONCILIATION_REQUIRED' && error.rollback.status === 'UNCONFIRMED'); assert(altered); assert(!mutations(f.docker).some(call => call.method === 'DELETE')); await absent(path.join(item.operationDirectory, 'complete.private.json')); await fs.stat(path.join(f.root, '.preparer-work', 'main5180-deploy.lock'));
});

test('a data-role restart during delivery blocks all further mutations without attempting to restart it', async t => {
  const f = await fixture(t), { args, item } = await f.plan(); f.options.health = async port => { if (port === 5193) f.docker.containers.get(f.originals.postgres.Id).State.StartedAt = '2026-10-24T10:00:03Z'; };
  await assert.rejects(deployMainDeployment(args, f.options), error => error.code === 'DEPLOY_PROTECTED_DATA_RUNTIME_CHANGED' && error.rollback.status === 'UNCONFIRMED');
  assert(!mutations(f.docker).some(call => call.route.includes(f.originals.postgres.Id) || call.body?.Container === f.originals.postgres.Id)); assert.equal(f.docker.containers.get(f.originals.api.Id).State.Running, true); await absent(path.join(item.operationDirectory, 'complete.private.json')); await fs.stat(path.join(f.root, '.preparer-work', 'main5180-deploy.lock'));
});

test('deployment rechecks gates and canonical source before any Docker mutation', async t => {
  const f = await fixture(t), { args } = await f.plan(); f.qualifiedUpgrade.sourceLockReleased = false; await assert.rejects(deployMainDeployment(args, f.options), { code: 'DEPLOY_UPGRADE_GATE_FAILED' }); assert.equal(mutations(f.docker).length, 0);
});

test('a changed main checkout after Preparer startup rolls back without touching the primary apps', async t => {
  const f = await fixture(t), { args } = await f.plan(); let changed = false; f.options.health = async port => { if (port === 5193) changed = true; }; f.options.git = async (_root, args) => Buffer.from(args[0] === 'status' ? '' : changed ? 'f'.repeat(40) : MAIN);
  await assert.rejects(deployMainDeployment(args, f.options), error => error.code === 'DEPLOY_MAIN_SOURCE_CHANGED' && error.rollback.status === 'ROLLED_BACK'); assert.equal(candidates(f.docker).length, 0); assert(!mutations(f.docker).some(call => [f.originals.api.Id, f.originals.web.Id].some(id => call.route.includes(id))));
});
