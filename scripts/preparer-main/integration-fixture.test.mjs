import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fixtureNames, validateFixtureImages, makeFixturePrivate, fixtureRoleConfiguration, fixtureEdgeConfiguration, assertFixtureOwned, startIntegrationFixture, stopIntegrationFixture } from './integration-fixture.mjs';
import { createSyntheticAPS, syntheticConvertedFiles, SYNTHETIC_NWD, validateFixturePrivate } from './fixture-preparer.mjs';
import { tinyModel } from '../../model-preparer/test/fixtures/model-fixture.mjs';

const id = number => number.toString(16).padStart(64, '0'), image = number => 'sha256:' + id(number), clone = value => structuredClone(value), code = value => error => error.code === value;
const images = Object.fromEntries(['api', 'web', 'preparer', 'postgres', 'minio'].map((role, index) => [role, image(index + 1)]));
const sha = value => createHash('sha256').update(value).digest('hex');
function configurations() { const operationId = randomUUID(), names = fixtureNames(operationId), privateConfig = makeFixturePrivate(operationId), context = { operationId, images, names, privateConfig, internalId: id(20), edgeId: id(21), operatorDirectory: path.resolve('owned/operator'), edgeConfigurationPath: path.resolve('owned/edge.conf') }; return { operationId, names, privateConfig, context }; }

test('fixture names and image authority are explicit, isolated and immutable IDs', () => {
  const f = configurations(); assert.equal(Object.keys(f.names.volumes).length, 7); assert.equal(new Set(Object.values(f.names.containers)).size, 5); assert.equal(validateFixtureImages(images), images);
  for (const value of [{ ...images, api: 'wfc:latest' }, { ...images, extra: image(20) }, { api: image(1) }]) assert.throws(() => validateFixtureImages(value), code('SP5_FIXTURE_IMAGE_PINS'));
});
test('all data and application roles have no published ports and only the private network', () => {
  const f = configurations(); for (const role of ['api', 'postgres', 'minio', 'preparer']) { const config = fixtureRoleConfiguration(role, f.context); assert.equal(config.HostConfig.NetworkMode, f.context.internalId); assert.deepEqual(config.HostConfig.PortBindings, {}); assert.equal(config.HostConfig.ReadonlyRootfs, true); assert.deepEqual(config.HostConfig.CapDrop, ['ALL']); assert.equal(config.HostConfig.RestartPolicy.Name, 'no'); }
  const preparer = fixtureRoleConfiguration('preparer', f.context); assert.equal(preparer.User, '1000:1000'); assert.ok(preparer.Cmd.includes('/fixture/fixture-preparer.mjs')); assert.ok(preparer.Env.includes('PREPARER_WFC_ORIGIN=http://api:4000')); assert.ok(preparer.Env.every(value => !/^APS_|ENV_FILE|PROOF_PATH/.test(value)));
});
test('fresh PostgreSQL initialization retains the image default socket with a bounded owned tmpfs', () => {
  const f = configurations(), postgres = fixtureRoleConfiguration('postgres', f.context);
  assert.ok(postgres.Env.every(value => !value.startsWith('PGHOST='))); assert.deepEqual(postgres.Cmd, ['postgres']);
  assert.equal(postgres.HostConfig.Tmpfs['/var/run/postgresql'], 'rw,noexec,nosuid,nodev,size=16777216,uid=999,gid=999,mode=3775');
  assert.equal(postgres.User, '999:999'); assert.equal(postgres.HostConfig.ReadonlyRootfs, true); assert.deepEqual(postgres.HostConfig.PortBindings, {});
});
test('edge alone publishes exact loopback fixture ports and joins both networks', () => {
  const f = configurations(), config = fixtureRoleConfiguration('web', f.context); assert.equal(config.HostConfig.NetworkMode, f.context.edgeId);
  assert.deepEqual(config.HostConfig.PortBindings, { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '5194' }], '8081/tcp': [{ HostIp: '127.0.0.1', HostPort: '5193' }] });
  assert.deepEqual(Object.keys(config.NetworkingConfig.EndpointsConfig).sort(), [f.context.internalId, f.context.edgeId].sort());
  assert.match(fixtureEdgeConfiguration, /listen 8081/); assert.match(fixtureEdgeConfiguration, /proxy_pass http:\/\/preparer:8080/); assert.match(fixtureEdgeConfiguration, /Host \$http_host/); assert.doesNotMatch(fixtureEdgeConfiguration, /proxy_pass \$|CONNECT|5191|5180/);
});
test('private synthetic accounts and keys differ across owners and operations', () => {
  const first = makeFixturePrivate(randomUUID()), second = makeFixturePrivate(randomUUID()); assert.equal(first.admins.length, 2); assert.equal(first.apsApplications.length, 2); assert.notEqual(first.jwtSecret, second.jwtSecret); assert.notEqual(first.admins[0].password, first.admins[1].password); assert.notEqual(first.apsApplications[0].clientId, first.apsApplications[1].clientId);
  const changed = clone(first); changed.database.host = 'host.docker.internal'; assert.throws(() => validateFixturePrivate(changed), code('SP5_FIXTURE_PRIVATE_INVALID'));
});
test('ownership rejects foreign labels even when the resource name looks familiar', () => {
  const f = configurations(), value = { Name: f.names.containers.api, Image: images.api, Config: { Labels: { 'wfc.preparer.integration.owner': f.operationId, 'wfc.preparer.integration.purpose': 'api', 'wfc.preparer.integration.synthetic-only': 'true' } } };
  assert.equal(assertFixtureOwned(value, { operationId: f.operationId, name: value.Name, purpose: 'api', image: images.api }), value); value.Config.Labels['wfc.preparer.integration.owner'] = randomUUID(); assert.throws(() => assertFixtureOwned(value, { operationId: f.operationId, name: value.Name, purpose: 'api' }), code('SP5_FIXTURE_OWNERSHIP_LOST'));
});

async function syntheticContext() {
  const config = makeFixturePrivate(randomUUID()), fake = createSyntheticAPS(config), app = config.apsApplications[0];
  const token = await (await fake.apsFetch('https://developer.api.autodesk.com/authentication/v2/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(app.clientId + ':' + app.clientSecret).toString('base64') } })).json();
  const headers = { Authorization: 'Bearer ' + token.access_token }, bucket = 'fixture-bucket', base = 'https://developer.api.autodesk.com', key = sha(SYNTHETIC_NWD) + '.nwd';
  const request = (route, method = 'GET', body) => fake.testTransport.request({ url: route.startsWith('https:') ? route : base + route, headers, method, ...(body !== undefined ? { body } : {}) });
  await request('/oss/v2/buckets/' + bucket + '/details'); return { config, fake, app, bucket, key, request, headers };
}
test('synthetic transport accepts only fixture credentials without native network fallback', async () => {
  const f = await syntheticContext(); const wrong = await f.fake.apsFetch('https://developer.api.autodesk.com/authentication/v2/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(f.app.clientId + ':wrong').toString('base64') } }); assert.equal(wrong.status, 401);
  await assert.rejects(f.request('https://unexpected.example/real-network'), code('SP5_UNEXPECTED_SYNTHETIC_NETWORK')); await assert.rejects(f.fake.apsFetch('http://developer.api.autodesk.com/authentication/v2/token'), code('SP5_UNEXPECTED_SYNTHETIC_NETWORK')); assert.equal(f.fake.snapshot().realAutodeskRequests, 0);
});
test('fake conversion accepts only the exact synthetic NWD and rejects duplicate submission', async () => {
  const f = await syntheticContext(), object = '/oss/v2/buckets/' + f.bucket + '/objects/' + f.key;
  assert.equal((await f.request(object + '/details')).statusCode, 404); const upload = JSON.parse((await f.request(object + '/signeds3upload')).body);
  await assert.rejects(f.request(upload.urls[0], 'PUT', Buffer.from('an actual different model')), code('SP5_SYNTHETIC_INPUT_ONLY'));
  await f.request(upload.urls[0], 'PUT', SYNTHETIC_NWD); const complete = JSON.parse((await f.request(object + '/signeds3upload', 'POST', '{}')).body), urn = Buffer.from(complete.objectId).toString('base64url');
  await f.request('/modelderivative/v2/designdata/job', 'POST', JSON.stringify({ input: { urn } })); const manifest = JSON.parse((await f.request('/modelderivative/v2/designdata/' + urn + '/manifest')).body); assert.equal(manifest.status, 'success');
  await assert.rejects(f.request('/modelderivative/v2/designdata/job', 'POST', JSON.stringify({ input: { urn } })), code('SP5_SYNTHETIC_SUBMISSION_INVALID')); assert.equal(f.fake.snapshot().syntheticSubmit, 1); assert.equal(f.fake.snapshot().realAutodeskRequests, 0);
  assert.deepEqual([...syntheticConvertedFiles().keys()], ['output/0/0.svf', 'output/0/0.pf', 'output/0/properties.db']);
});
test('unexpected real source object cannot be mistaken for a fixture', async () => { const f = await syntheticContext(); await assert.rejects(f.request('/oss/v2/buckets/' + f.bucket + '/objects/real-model.nwd/details'), code('SP5_SYNTHETIC_INPUT_ONLY')); });
test('synthetic converted resources are exact copies of the established tiny profile fixture', () => { const expected = tinyModel().data, actual = syntheticConvertedFiles(); assert.deepEqual([...actual.keys()], [...expected.keys()]); for (const [name, bytes] of expected) assert.deepEqual(actual.get(name), bytes); });

async function fakeOperation(t, controls = {}) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'sp5-fixture-operator-test-')); await fs.mkdir(path.join(root, '.preparer-work')); t.after(async () => { assert.equal(path.dirname(root), parent); await fs.rm(root, { recursive: true, force: true }); });
  const operationId = randomUUID(), operationDirectory = path.join(root, '.preparer-work', 'sp-integration-' + operationId), containers = new Map(), volumes = new Map(), networks = new Map(), calls = []; let sequence = 100, inspectionFailed = false;
  const failInspection = kind => { if (!inspectionFailed && controls.failPostCreateInspection === kind) { inspectionFailed = true; throw Object.assign(Error('Acknowledged create followed by failed inspection'), { code: 'TEST_POST_CREATE_INSPECTION' }); } };
  const docker = {
    async request(method, route, body) {
      calls.push({ method, route, body: clone(body) });
      if (method === 'GET' && route === '/containers/json?all=1') return [...containers.values()].map(row => ({ Id: row.Id }));
      if (method === 'GET' && route === '/volumes') return { Volumes: [...volumes.values()].map(clone) };
      if (method === 'GET' && route === '/networks') return [...networks.values()].map(clone);
      if (method === 'GET' && route === '/info') return { MemTotal: 32 * 1024 ** 3 };
      if (method === 'GET' && route.startsWith('/images/')) return { Id: route.slice(8, -5), Os: 'linux', Architecture: 'amd64' };
      if (method === 'POST' && route === '/networks/create') { if (controls.failNetwork) throw Object.assign(Error('uncertain'), { code: 'TEST_UNCERTAIN_CREATE' }); const row = { ...clone(body), Id: id(sequence++), Containers: {} }; networks.set(row.Id, row); return { Id: row.Id }; }
      if (route.startsWith('/networks/')) { const key = route.slice(10); if (method === 'GET') { if (networks.has(key)) failInspection('networks'); return clone(networks.get(key)); } networks.delete(key); return null; }
      if (method === 'POST' && route === '/volumes/create') { const row = { ...clone(body), Options: {}, Mountpoint: '/owned/' + body.Name }; volumes.set(row.Name, row); return clone(row); }
      if (route.startsWith('/volumes/')) { const key = decodeURIComponent(route.slice(9)); if (method === 'GET') { if (volumes.has(key)) failInspection('volumes'); return clone(volumes.get(key)); } volumes.delete(key); return null; }
      if (method === 'POST' && route.startsWith('/containers/create?name=')) {
        const name = decodeURIComponent(route.split('=')[1]), key = id(sequence++), endpoints = body.NetworkingConfig?.EndpointsConfig ?? (body.HostConfig.NetworkMode === 'none' ? {} : { [body.HostConfig.NetworkMode]: {} });
        const row = { Id: key, Name: '/' + name, Image: body.Image, Config: { Image: body.Image, User: body.User, Env: body.Env, Cmd: body.Cmd, Labels: body.Labels }, HostConfig: clone(body.HostConfig), Mounts: body.HostConfig.Mounts.map(item => ({ Type: item.Type, ...(item.Type === 'volume' ? { Name: item.Source } : {}), Source: item.Source, Destination: item.Target, RW: !item.ReadOnly })), NetworkSettings: { Networks: Object.fromEntries(Object.entries(endpoints).map(([networkId, value]) => [networks.get(networkId).Name, { NetworkID: networkId, Aliases: value.Aliases ?? [] }])) }, State: { Running: false, Restarting: false, Pid: 0, ExitCode: 0, OOMKilled: false } }; containers.set(key, row); return { Id: key };
      }
      const match = /^\/containers\/([a-f0-9]{64})(.*)$/.exec(route); if (match) {
        const row = containers.get(match[1]), suffix = match[2];
        if (method === 'GET' && suffix === '/json') { if (row) failInspection('containers'); return clone(row); }
        if (method === 'GET' && suffix.startsWith('/stats')) return { memory_stats: { usage: 0 } };
        if (method === 'POST' && suffix === '/start') { const helper = row.Config.Labels['wfc.preparer.integration.purpose'].startsWith('helper-'); row.State.Running = !helper; row.State.Pid = helper ? 0 : 500;
          if (!helper) for (const value of Object.values(row.NetworkSettings.Networks)) networks.get(value.NetworkID).Containers[row.Id] = { Name: row.Name }; return null; }
        if (method === 'POST' && suffix.startsWith('/stop')) { row.State.Running = false; row.State.Pid = 0; for (const value of Object.values(row.NetworkSettings.Networks)) delete networks.get(value.NetworkID).Containers[row.Id]; return null; }
        if (method === 'DELETE') { for (const value of Object.values(row.NetworkSettings.Networks)) delete networks.get(value.NetworkID).Containers[row.Id]; containers.delete(row.Id); return null; }
      }
      throw Error('unexpected fake Docker request ' + route);
    },
    async command(args) { assert.equal(args[0], 'logs'); const row = containers.get(args[1]), roleAt = row.Config.Cmd.indexOf('--role'); return Buffer.from(JSON.stringify({ status: 'PASS', operationId, ...(roleAt >= 0 ? { role: row.Config.Cmd[roleAt + 1] } : {}) })); },
  };
  return { root, operationId, operationDirectory, containers, volumes, networks, calls, args: { operationDirectory, images }, options: { root, docker, probePort: async () => {}, publicHealth: async () => {}, statfs: async () => ({ bavail: 100000n, bsize: 1024n ** 2n }) } };
}
test('source-only fake orchestration creates seven fresh volumes, no direct preparer ports and immutable ready proof', async t => {
  const f = await fakeOperation(t), result = await startIntegrationFixture(f.args, f.options); assert.equal(result.status, 'PASS'); assert.equal(result.actualBrowserAcceptance, 'NOT_RUN'); assert.equal(result.productionCloudAcceptance, 'NOT_RUN'); assert.equal(f.volumes.size, 7); assert.equal(f.containers.size, 5);
  const preparer = [...f.containers.values()].find(row => row.Config.Labels['wfc.preparer.integration.purpose'] === 'preparer'); assert.deepEqual(preparer.HostConfig.PortBindings, {}); assert.equal(preparer.Config.User, '1000:1000');
  const helper = f.calls.find(row => row.method === 'POST' && row.body?.Cmd?.includes('init')); assert.deepEqual(helper.body.HostConfig.CapAdd, ['CHOWN', 'FOWNER', 'DAC_OVERRIDE']); assert.equal(helper.body.HostConfig.NetworkMode, 'none');
  const ready = JSON.parse(await fs.readFile(path.join(f.operationDirectory, 'ready.private.json'), 'utf8')); assert.doesNotMatch(JSON.stringify(result), /clientSecret|password|jwtSecret/); assert.equal(ready.realAutodeskRequests, 0);
  await assert.rejects(startIntegrationFixture(f.args, f.options), { code: 'EEXIST' });
});
test('fixture stop joins exact containers then removes only its volumes and networks', async t => {
  const f = await fakeOperation(t); await startIntegrationFixture(f.args, f.options); const stopped = await stopIntegrationFixture({ operationDirectory: f.operationDirectory }, f.options); assert.equal(stopped.resourcesRemoved, true); assert.equal(f.containers.size, 0); assert.equal(f.volumes.size, 0); assert.equal(f.networks.size, 0);
  assert.ok(!f.calls.some(row => /prune|5180|5191/.test(row.route))); await assert.rejects(stopIntegrationFixture({ operationDirectory: f.operationDirectory }, f.options), code('SP5_FIXTURE_ALREADY_STOPPED'));
});
test('active source recovery blocks all fixture mutations before creating an operation', async t => {
  const f = await fakeOperation(t); await fs.writeFile(path.join(f.root, '.preparer-work/main5180-recovery.lock'), 'active source recovery'); await assert.rejects(startIntegrationFixture(f.args, f.options), code('SP5_SOURCE_OPERATION_ACTIVE')); assert.equal(f.calls.length, 0); await assert.rejects(fs.lstat(f.operationDirectory), { code: 'ENOENT' });
});
test('uncertain Docker creation leaves sticky evidence and refuses automatic cleanup', async t => {
  const f = await fakeOperation(t, { failNetwork: true }); await assert.rejects(startIntegrationFixture(f.args, f.options), code('TEST_UNCERTAIN_CREATE')); const failure = JSON.parse(await fs.readFile(path.join(f.operationDirectory, 'failure.private.json'), 'utf8')); assert.equal(failure.uncertainDockerMutation, true); await assert.rejects(stopIntegrationFixture({ operationDirectory: f.operationDirectory }, f.options), code('SP5_FIXTURE_RECONCILIATION_REQUIRED')); assert.ok(!f.calls.some(row => row.method === 'DELETE'));
});
for (const [kind, ack] of [['networks', 'network-ack-internal.private.json'], ['volumes', 'volume-ack-postgres.private.json'], ['containers', 'container-ack-helper-1.private.json']]) {
  test('acknowledged ' + kind + ' create followed by inspection failure cannot disappear from cleanup authority', async t => {
    const f = await fakeOperation(t, { failPostCreateInspection: kind });
    await assert.rejects(startIntegrationFixture(f.args, f.options), code('TEST_POST_CREATE_INSPECTION'));
    assert.ok(f[kind].size > 0, 'the successful fake Docker create leaves a real resource to account for');
    const failurePath = path.join(f.operationDirectory, 'failure.private.json'), failure = JSON.parse(await fs.readFile(failurePath, 'utf8'));
    assert.equal(failure.uncertainDockerMutation, true);
    const pending = failure.creations.find(item => item.kind === kind && item.state === 'created-unverified'); assert.ok(pending); assert.ok(pending.id);
    const acknowledged = JSON.parse(await fs.readFile(path.join(f.operationDirectory, ack), 'utf8')); assert.equal(acknowledged.id, pending.id); assert.equal(acknowledged.name, pending.name);
    assert.equal(failure.resources[kind].length, 0, 'inspection did not admit the created resource');
    const before = f.calls.length; await assert.rejects(stopIntegrationFixture({ operationDirectory: f.operationDirectory }, f.options), code('SP5_FIXTURE_RECONCILIATION_REQUIRED'));
    assert.equal(f.calls.length, before, 'stop must not send Docker cleanup requests for an unresolved creation');
    // The ledger remains an independent fence if a future caller accidentally
    // clears the coarse uncertainty boolean without reconciling the resource.
    failure.uncertainDockerMutation = false; await fs.writeFile(failurePath, JSON.stringify(failure));
    await assert.rejects(stopIntegrationFixture({ operationDirectory: f.operationDirectory }, f.options), code('SP5_FIXTURE_RECONCILIATION_REQUIRED'));
    await assert.rejects(fs.lstat(path.join(f.operationDirectory, 'stopped.private.json')), { code: 'ENOENT' });
    assert.equal(f.calls.length, before); assert.ok(f[kind].size > 0);
  });
}
test('a foreign owner label prevents stop before touching that resource', async t => {
  const f = await fakeOperation(t); await startIntegrationFixture(f.args, f.options); const web = [...f.containers.values()].find(row => row.Config.Labels['wfc.preparer.integration.purpose'] === 'web'); web.Config.Labels['wfc.preparer.integration.owner'] = randomUUID(); const before = f.calls.length; await assert.rejects(stopIntegrationFixture({ operationDirectory: f.operationDirectory }, f.options), code('SP5_FIXTURE_OWNERSHIP_LOST')); assert.ok(!f.calls.slice(before).some(row => row.method === 'POST' || row.method === 'DELETE'));
});
