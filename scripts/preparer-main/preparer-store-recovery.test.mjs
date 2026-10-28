import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertRestoreCleanupReceipt, assertStoreResource, capturePreparerStores, clonedPreparerConfiguration, compareAuthFenceEntries, fenceRestoredLogin, resumeOriginalPreparer, storeRecoveryNames } from './preparer-store-recovery.mjs';
import { fixtureNames, fixtureRoleConfiguration, makeFixturePrivate } from './integration-fixture.mjs';
import { hashFile } from './foundation/archives.mjs';

const id = number => number.toString(16).padStart(64, '0'), image = number => 'sha256:' + id(number), clone = value => structuredClone(value), code = expected => error => error.code === expected;
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const admission = value => hash({ id: value.Id, image: value.Image, config: value.Config, hostConfig: value.HostConfig });
const identity = value => hash({ id: value.Id, name: value.Name, image: value.Image, config: value.Config, hostConfig: value.HostConfig, mounts: value.Mounts, networks: Object.fromEntries(Object.entries(value.NetworkSettings?.Networks ?? {}).map(([name, item]) => [name, { NetworkID: item.NetworkID, Aliases: item.Aliases, IPAMConfig: item.IPAMConfig, DriverOpts: item.DriverOpts }])) });
const images = Object.fromEntries(['api', 'web', 'preparer', 'postgres', 'minio'].map((role, index) => [role, image(index + 1)]));
function sourceConfiguration() {
  const operationId = randomUUID(), names = fixtureNames(operationId), config = fixtureRoleConfiguration('preparer', { operationId, images, names, privateConfig: makeFixturePrivate(operationId), internalId: id(10), edgeId: id(11), operatorDirectory: path.resolve('owned/fixture'), edgeConfigurationPath: path.resolve('owned/edge.conf') });
  return { operationId, names, config };
}
function inspect(config, name, key, networkName = 'fixture-internal') {
  const { HostConfig, NetworkingConfig, ...Config } = clone(config);
  const networkId = HostConfig.NetworkMode;
  return { Id: key, Name: '/' + name, Image: config.Image, Config, HostConfig,
    Mounts: HostConfig.Mounts.map(item => ({ Type: item.Type, ...(item.Type === 'volume' ? { Name: item.Source } : {}), Source: item.Source, Destination: item.Target, RW: !item.ReadOnly })),
    NetworkSettings: { Networks: networkId === 'none' ? {} : { [networkName]: { NetworkID: networkId, Aliases: NetworkingConfig?.EndpointsConfig?.[networkId]?.Aliases ?? ['preparer'] } } },
    State: { Running: true, Restarting: false, Pid: 300, ExitCode: 0, OOMKilled: false } };
}
async function temporary(t) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'preparer-store-test-'));
  t.after(async () => { assert.equal(path.dirname(root), parent); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}
function goodReceipt() {
  const operationId = randomUUID(), names = storeRecoveryNames(operationId), volumes = Object.entries(names.volumes).map(([purpose, name]) => ({ purpose, name, identity: id(30) }));
  const container = { purpose: 'restored', name: names.container, id: id(31), image: image(3), admission: id(32), identity: id(33) };
  const helper = { purpose: 'helper-restore-1', name: 'wfc-preparer-store-' + operationId + '-helper-restore-1', id: id(34), removed: true };
  return { schemaVersion: 'wfc.preparer.store-restore.v1', status: 'PASS', operationId, resources: { volumes, containers: [container] }, helpers: [helper], uncertainDockerMutation: false,
    creations: [...volumes.map(row => ({ kind: 'volumes', name: row.name, id: row.name, state: 'admitted' })), ...[container, helper].map(row => ({ kind: 'containers', name: row.name, id: row.id, state: 'admitted' }))] };
}

test('recovery names are distinct, bounded and require a real operation UUID', () => {
  const first = storeRecoveryNames(randomUUID()), second = storeRecoveryNames(randomUUID());
  assert.notEqual(first.container, second.container); assert.notEqual(first.alias, second.alias); assert.equal(new Set(Object.values(first.volumes)).size, 3);
  for (const value of ['', '../source', 'owned', '000']) assert.throws(() => storeRecoveryNames(value), code('PREPARER_STORE_OWNER_INVALID'));
});

test('restored configuration preserves the original instance and private read-only config while replacing only three stores', () => {
  const f = sourceConfiguration(), source = inspect(f.config, f.names.containers.preparer, id(20)), before = clone(source), operationId = randomUUID(), names = storeRecoveryNames(operationId);
  const restored = clonedPreparerConfiguration(source, { operationId, volumes: names.volumes, networkId: id(10) });
  assert.deepEqual(source, before); assert.deepEqual(restored.Env, source.Config.Env); assert.ok(restored.Env.includes('PREPARER_INSTANCE_ID=' + f.operationId));
  assert.equal(restored.User, '1000:1000'); assert.equal(restored.Image, images.preparer); assert.deepEqual(restored.Cmd, source.Config.Cmd); assert.deepEqual(restored.HostConfig.PortBindings, {});
  assert.equal(restored.HostConfig.NetworkMode, id(10)); assert.equal(restored.HostConfig.ReadonlyRootfs, true); assert.equal(restored.HostConfig.PublishAllPorts, false);
  assert.deepEqual(restored.HostConfig.Mounts.filter(row => row.ReadOnly), source.HostConfig.Mounts.filter(row => row.ReadOnly));
  assert.deepEqual(restored.HostConfig.Mounts.filter(row => !row.ReadOnly).map(row => row.Source).sort(), Object.values(names.volumes).sort());
  assert.deepEqual(restored.NetworkingConfig.EndpointsConfig[id(10)].Aliases, [names.alias]);
  assert.ok(!restored.Env.some(value => /^APS_|CLIENT_SECRET=|CLIENT_ID=/.test(value)));
});

test('clone refuses a changed image, user, fixture command, published port or unexpected mount', () => {
  const f = sourceConfiguration(), source = inspect(f.config, f.names.containers.preparer, id(20)), operationId = randomUUID(), args = { operationId, volumes: storeRecoveryNames(operationId).volumes, networkId: id(10) };
  for (const change of [value => { value.Image = image(99); }, value => { value.Config.User = '0'; }, value => { value.Config.Cmd = ['node', 'production-entry.mjs']; }, value => { value.HostConfig.PortBindings = { '8080/tcp': [{ HostPort: '5180' }] }; }, value => { value.HostConfig.Mounts[0].ReadOnly = false; }]) {
    const value = clone(source); change(value); assert.throws(() => clonedPreparerConfiguration(value, args), code('PREPARER_STORE_SOURCE_CONFIG'));
  }
});

test('native omitted false mount flag requires the exact effective writable source, destination and type', () => {
  const f = sourceConfiguration(), source = inspect(f.config, f.names.containers.preparer, id(20)), operationId = randomUUID(), args = { operationId, volumes: storeRecoveryNames(operationId).volumes, networkId: id(10) };
  for (const row of source.HostConfig.Mounts.filter(value => value.Type === 'volume' && !value.ReadOnly)) delete row.ReadOnly;
  const restored = clonedPreparerConfiguration(source, args); assert.equal(restored.HostConfig.Mounts.filter(value => value.Target.startsWith('/var/lib/preparer/')).length, 3);
  for (const role of ['data', 'work', 'outputs']) assert.equal(restored.HostConfig.Mounts.find(value => value.Target === '/var/lib/preparer/' + role).Source, args.volumes[role]);
  const changes = [value => { value.HostConfig.Mounts.find(row => row.Target === '/var/lib/preparer/data').ReadOnly = true; }, value => { value.HostConfig.Mounts.find(row => row.Target === '/var/lib/preparer/data').ReadOnly = null; }, value => { value.HostConfig.Mounts.find(row => row.Target === '/var/lib/preparer/data').ReadOnly = 0; }, value => { value.Mounts.find(row => row.Destination === '/var/lib/preparer/data').RW = false; }, value => { value.Mounts.find(row => row.Destination === '/var/lib/preparer/data').Name = 'foreign-source'; }, value => { value.Mounts.find(row => row.Destination === '/var/lib/preparer/data').Destination = '/other-data'; }, value => { value.Mounts.find(row => row.Destination === '/var/lib/preparer/data').Type = 'bind'; }, value => { value.Mounts.push(clone(value.Mounts.find(row => row.Destination === '/var/lib/preparer/data'))); }];
  for (const change of changes) { const changed = clone(source); change(changed); assert.throws(() => clonedPreparerConfiguration(changed, args), code('PREPARER_STORE_SOURCE_CONFIG')); }
});

test('a familiar resource name cannot authorize foreign owner, purpose, synthetic label or image', () => {
  const operationId = randomUUID(), name = storeRecoveryNames(operationId).container, labels = { 'wfc.preparer.store-recovery.owner': operationId, 'wfc.preparer.store-recovery.purpose': 'restored', 'wfc.preparer.store-recovery.synthetic-only': 'true' }, value = { Name: '/' + name, Image: image(3), Config: { Labels: labels } }, expected = { operationId, purpose: 'restored', name, image: image(3) };
  assert.equal(assertStoreResource(value, expected), value);
  for (const change of [row => { row.Config.Labels['wfc.preparer.store-recovery.owner'] = randomUUID(); }, row => { row.Config.Labels['wfc.preparer.store-recovery.purpose'] = 'original'; }, row => { row.Config.Labels['wfc.preparer.store-recovery.synthetic-only'] = 'false'; }, row => { row.Image = image(4); }]) { const row = clone(value); change(row); assert.throws(() => assertStoreResource(row, expected), code('PREPARER_STORE_OWNERSHIP_LOST')); }
});

test('cleanup requires all exact resources and every independently admitted creation', () => {
  const value = goodReceipt(); assert.equal(assertRestoreCleanupReceipt(value), value);
  const changes = [row => { row.resources.volumes = []; row.resources.containers = []; row.creations = []; row.helpers = []; }, row => { row.resources.volumes.pop(); }, row => { row.resources.volumes[0].name = 'original-main-volume'; }, row => { row.resources.containers[0].id = ''; }, row => { row.creations[0].state = 'created-unverified'; }, row => { row.creations[0].id = null; }, row => { row.creations.push({ kind: 'containers', name: 'unknown-create', id: id(80), state: 'requested' }); }, row => { row.uncertainDockerMutation = true; }, row => { row.helpers[0].removed = false; }, row => { row.helpers = []; }, row => { row.creations.push(clone(row.creations[0])); }];
  for (const change of changes) { const changed = clone(value); change(changed); assert.throws(() => assertRestoreCleanupReceipt(changed), code('PREPARER_STORE_RECONCILIATION_REQUIRED')); }
});

function member(path, type = 'file') { return { path, type, mode: type === 'file' ? 0o600 : 0o700, uid: 1000, gid: 1000, mtimeNs: '1700000000000000000', ...(type === 'file' ? { bytes: 12, sha256: id(60) } : {}), offset: 100 }; }
test('auth fence permits exactly one retained encrypted auth rename with all other archive facts identical', () => {
  const operationId = randomUUID(), original = [member('', 'directory'), member('workspace-private', 'directory'), member('workspace-private/workspace-auth-v2.enc'), member('workspace-private/workspace.key'), member('owner/journal.db-wal')];
  const renamed = clone(original); renamed[2].path = 'workspace-private/workspace-auth-v2.revoked-' + operationId + '.enc'; renamed.forEach(row => { row.offset += 900; });
  assert.equal(compareAuthFenceEntries(original, renamed, operationId).onlyDeclaredAuthRename, true);
  for (const change of [rows => { rows[3].sha256 = id(61); }, rows => { rows[4].bytes++; }, rows => { rows[1].mtimeNs = '9'; }, rows => { rows[2].uid = 0; }, rows => { rows.pop(); }, rows => { rows.push(member('unexpected')); }]) { const changed = clone(renamed); change(changed); assert.throws(() => compareAuthFenceEntries(original, changed, operationId), code('PREPARER_STORE_FENCE_DELTA')); }
  assert.throws(() => compareAuthFenceEntries(original.filter(row => row.path !== 'workspace-private/workspace-auth-v2.enc'), renamed, operationId), code('PREPARER_STORE_AUTH_REQUIRED'));
});

test('filesystem auth fence keeps opaque bytes, encryption key, journal and owner files unchanged', async t => {
  const root = await temporary(t), directory = path.join(root, 'data'), privateDirectory = path.join(directory, 'workspace-private'), operationId = randomUUID(); await fs.mkdir(privateDirectory, { recursive: true });
  const auth = path.join(privateDirectory, 'workspace-auth-v2.enc'), key = path.join(privateDirectory, 'workspace.key'), journal = path.join(directory, 'journal.db-wal');
  await fs.writeFile(auth, Buffer.from([0, 255, 13, 71, 19])); await fs.writeFile(key, Buffer.alloc(32, 8)); await fs.writeFile(journal, 'opaque WAL preserved');
  const before = await hashFile(auth), keyBefore = await hashFile(key), journalBefore = await hashFile(journal); await fs.utimes(privateDirectory, 1700000000, 1700000000);
  const result = await fenceRestoredLogin({ directory, operationId }, { restoreTimestamp: async (target, ns) => { await fs.utimes(target, Number(ns / 1000000000n), Number(ns / 1000000000n)); } });
  assert.equal(result.status, 'PASS'); assert.equal(result.tokensDecoded, false); assert.equal(result.productionFence, false); assert.equal(result.parentMetadataRestored, true);
  assert.deepEqual(await hashFile(result.after.path), before); assert.deepEqual(await hashFile(key), keyBefore); assert.deepEqual(await hashFile(journal), journalBefore); await assert.rejects(fs.lstat(auth), { code: 'ENOENT' });
});

test('auth fence refuses an existing destination before changing the source', async t => {
  const root = await temporary(t), privateDirectory = path.join(root, 'workspace-private'), operationId = randomUUID(); await fs.mkdir(privateDirectory); const source = path.join(privateDirectory, 'workspace-auth-v2.enc'); await fs.writeFile(source, 'opaque source'); await fs.writeFile(path.join(privateDirectory, 'workspace-auth-v2.revoked-' + operationId + '.enc'), 'older evidence');
  await assert.rejects(fenceRestoredLogin({ directory: root, operationId }), code('PREPARER_STORE_FENCE_EXISTS')); assert.equal(await fs.readFile(source, 'utf8'), 'opaque source');
});

test('source recovery starts only the exact unchanged joined source and verifies it running', async () => {
  const f = sourceConfiguration(), source = inspect(f.config, f.names.containers.preparer, id(20)); source.State.Running = false; source.State.Pid = 0; const expectedIdentity = identity(source), calls = [];
  const request = async (method, route) => { calls.push([method, route]); if (method === 'POST') { source.State.Running = true; source.State.Pid = 300; } return clone(source); };
  assert.equal((await resumeOriginalPreparer({ sourceId: source.Id, expectedIdentity }, request)).status, 'PASS'); assert.deepEqual(calls, [['GET', '/containers/' + source.Id + '/json'], ['POST', '/containers/' + source.Id + '/start'], ['GET', '/containers/' + source.Id + '/json']]);
  calls.length = 0; await resumeOriginalPreparer({ sourceId: source.Id, expectedIdentity }, request); assert.ok(calls.every(row => row[0] === 'GET'));
  source.Config.Env.push('CHANGED=1'); await assert.rejects(resumeOriginalPreparer({ sourceId: source.Id, expectedIdentity }, request), code('PREPARER_STORE_SOURCE_CHANGED')); assert.ok(calls.every(row => row[0] === 'GET'));
});

async function captureFixture(t, controls = {}) {
  const root = await temporary(t); await fs.mkdir(path.join(root, '.preparer-work')); const f = sourceConfiguration(), source = inspect(f.config, f.names.containers.preparer, id(20)), network = { Id: id(10), Name: 'fixture-internal', Internal: true, Labels: { 'wfc.preparer.integration.owner': f.operationId, 'wfc.preparer.integration.purpose': 'network-internal', 'wfc.preparer.integration.synthetic-only': 'true' } };
  const stores = ['data', 'work', 'outputs'].map(role => ({ Name: f.names.volumes[role], Driver: 'local', Options: {}, Labels: { 'wfc.preparer.integration.owner': f.operationId, 'wfc.preparer.integration.purpose': 'volume-' + role, 'wfc.preparer.integration.synthetic-only': 'true' } }));
  const ready = { schemaVersion: 'wfc.preparer.synthetic-integration-ready.v1', status: 'PASS', operationId: f.operationId, images, realAutodeskRequests: 0, resources: { containers: [{ id: source.Id, name: f.names.containers.preparer, purpose: 'preparer', image: source.Image, admission: admission(source), identity: identity(source) }], networks: [{ id: network.Id, name: network.Name, purpose: 'internal' }], volumes: stores.map((row, index) => ({ name: row.Name, purpose: ['data', 'work', 'outputs'][index], identity: hash(row) })) } };
  const readyDirectory = path.join(root, '.preparer-work', 'sp-integration-' + f.operationId); await fs.mkdir(readyDirectory); const fixtureReadyPath = path.join(readyDirectory, 'ready.private.json'); await fs.writeFile(fixtureReadyPath, JSON.stringify(ready));
  const operationId = randomUUID(), operationDirectory = path.join(root, '.preparer-work', 'sp-preparer-store-' + operationId), calls = [], helpers = new Map(), controller = new AbortController(), foreign = clone(source); foreign.Id = id(90); foreign.Name = '/unrelated-writer'; let sequence = 100;
  const docker = { async request(method, route, body) {
    calls.push({ method, route, body: clone(body) }); if (route.startsWith('/images/')) return { Id: image(9), Os: 'linux', Architecture: 'amd64' };
    if (route === '/networks/' + network.Id) return clone(network); if (route.startsWith('/volumes/')) return clone(stores.find(row => row.Name === decodeURIComponent(route.slice(9))));
    if (route === '/containers/json?all=1') return [{ Id: source.Id }, ...(controls.foreignWriter ? [{ Id: foreign.Id }] : []), ...[...helpers.keys()].map(Id => ({ Id }))];
    if (method === 'POST' && route.startsWith('/containers/create?name=')) { const name = decodeURIComponent(route.split('=')[1]), row = inspect(body, name, id(sequence++)); row.State.Running = false; row.State.Pid = 0; helpers.set(row.Id, row); return { Id: row.Id }; }
    const match = /^\/containers\/([a-f0-9]{64})(.*)$/.exec(route); if (match) { const row = match[1] === source.Id ? source : match[1] === foreign.Id ? foreign : helpers.get(match[1]), suffix = match[2];
      if (method === 'GET' && suffix === '/json') { if (row !== source && controls.postCreateInspectFailure) throw Object.assign(Error('inspection failed after acknowledged create'), { code: 'TEST_POST_CREATE_INSPECTION' }); return clone(row); }
      if (method === 'POST' && suffix.startsWith('/stop')) { assert.equal(row, source); row.State.Running = false; row.State.Pid = 0; return null; }
      if (method === 'POST' && suffix === '/start') { if (row === source) { row.State.Running = true; row.State.Pid = 300; } else if (row.Config.Cmd[2] === 'capture') { row.State.ExitCode = 1; if (controls.abortDuringArchive) controller.abort(); } return null; }
      if (method === 'DELETE') { assert.notEqual(row, source); helpers.delete(row.Id); return null; }
    } throw Error('Unexpected fake Docker request ' + route);
  }, async command(args) { assert.equal(args[0], 'logs'); return Buffer.from(JSON.stringify({ status: 'PASS', totalBytes: 1 })); } };
  return { root, source, helpers, calls, operationDirectory, args: { operationDirectory, fixtureReadyPath, fixtureReadySha256: (await hashFile(fixtureReadyPath)).sha256, helperImage: image(9) }, options: { root, docker, signal: controller.signal, statfs: async () => ({ bavail: 100000n, bsize: 1024n ** 2n }) } };
}

test('acknowledged helper create with failed inspection remains unresolved and never stops the source', async t => {
  const f = await captureFixture(t, { postCreateInspectFailure: true }); await assert.rejects(capturePreparerStores(f.args, f.options), code('TEST_POST_CREATE_INSPECTION'));
  const failure = JSON.parse(await fs.readFile(path.join(f.operationDirectory, 'snapshot-failure.private.json'), 'utf8')); assert.equal(failure.status, 'FAIL'); assert.equal(failure.uncertainDockerMutation, true); assert.equal(failure.creations[0].state, 'created-unverified'); assert.ok(failure.creations[0].id); assert.equal(f.source.State.Running, true); assert.equal(f.helpers.size, 1);
  assert.ok(!f.calls.some(row => row.method === 'POST' && row.route.includes('/stop'))); await assert.rejects(fs.lstat(path.join(f.operationDirectory, 'snapshot-complete.private.json')), { code: 'ENOENT' });
});

test('capture cancellation after joining source still resumes the exact original through its separate allowance', async t => {
  const f = await captureFixture(t, { abortDuringArchive: true }); await assert.rejects(capturePreparerStores(f.args, f.options));
  const failure = JSON.parse(await fs.readFile(path.join(f.operationDirectory, 'snapshot-failure.private.json'), 'utf8')); assert.equal(failure.status, 'FAIL'); assert.equal(failure.originalPreparerResumed, true); assert.equal(f.source.State.Running, true);
  const sourceMutations = f.calls.filter(row => row.route.includes('/containers/' + f.source.Id) && row.method !== 'GET'); assert.deepEqual(sourceMutations.map(row => row.route.split('/').at(-1)), ['stop?t=45', 'start']);
  assert.ok(!f.calls.some(row => /prune|5180|5191|5192/.test(row.route))); await assert.rejects(fs.lstat(path.join(f.operationDirectory, 'snapshot-complete.private.json')), { code: 'ENOENT' });
});

test('an additional writable store mount blocks cold capture before stopping the original', async t => {
  const f = await captureFixture(t, { foreignWriter: true }); await assert.rejects(capturePreparerStores(f.args, f.options), code('PREPARER_STORE_FOREIGN_WRITER'));
  assert.equal(f.source.State.Running, true); assert.equal(f.helpers.size, 0); assert.ok(!f.calls.some(row => row.method === 'POST' && row.route.includes('/stop')));
  const failure = JSON.parse(await fs.readFile(path.join(f.operationDirectory, 'snapshot-failure.private.json'), 'utf8')); assert.equal(failure.status, 'FAIL'); assert.equal(failure.code, 'PREPARER_STORE_FOREIGN_WRITER');
});

test('source recovery never starts a container whose stopped/joined state is uncertain', async () => {
  const f = sourceConfiguration(), source = inspect(f.config, f.names.containers.preparer, id(20)); source.State.Running = false; source.State.Pid = 900; const calls = [], expectedIdentity = identity(source);
  await assert.rejects(resumeOriginalPreparer({ sourceId: source.Id, expectedIdentity }, async (method, route) => { calls.push([method, route]); return clone(source); }), code('PREPARER_STORE_SOURCE_RESUME_UNCONFIRMED'));
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'GET');
});
