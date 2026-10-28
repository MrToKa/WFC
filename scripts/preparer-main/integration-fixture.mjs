import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { constants } from 'node:fs';
import { createDocker, writePrivateJson } from './foundation/docker.mjs';
import { withBoundedDockerExecution } from './foundation/docker-bounds.mjs';
import { assertCanonicalPath, hashFile } from './foundation/archives.mjs';
import { writeJsonNew } from './foundation/manifest.mjs';
import { SYNTHETIC_NWD, validateFixturePrivate } from './fixture-preparer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, ID = /^[a-f0-9]{64}$/, IMAGE = /^sha256:[a-f0-9]{64}$/;
const ROLES = ['postgres', 'minio', 'api', 'preparer', 'web'];
const need = (value, code) => { if (!value) throw Object.assign(Error(code), { code }); };
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const codeFor = error => /^[A-Z0-9_]{3,80}$/.test(error?.code ?? '') ? error.code : 'SP5_FIXTURE_FAILED';
const pin = async filename => ({ path: filename, ...await hashFile(filename) });
const mount = (source, target, readOnly = true, type = 'bind') => ({ Type: type, Source: source, Target: target, ReadOnly: readOnly });
const LOG_BOUNDS = Object.freeze({ operationTimeoutMs: 30000, commandTimeoutMs: 15000, requestTimeoutMs: 15000, helperTimeoutMs: 15000,
  helperMemoryBytes: 128 * 1024 ** 2, pidsLimit: 64, nanoCpus: 1000000000, tmpBytes: 16 * 1024 ** 2, archiveOutputBytes: 1024 ** 2 });
export const FIXTURE_BUDGET = Object.freeze({ startMilliseconds: 900000, requestMilliseconds: 60000, healthMilliseconds: 150000,
  minimumHostFreeBytes: 2 * 1024 ** 3, minimumDockerHeadroomBytes: 4 * 1024 ** 3, totalRoleMemoryBytes: 3584 * 1024 ** 2 });
export function fixtureNames(operationId) {
  need(UUID.test(operationId ?? ''), 'SP5_FIXTURE_OPERATION_INVALID'); const prefix = 'wfc-sp-fixture-' + operationId;
  return { project: prefix, networks: { internal: prefix + '-internal', edge: prefix + '-edge' }, containers: Object.fromEntries(ROLES.map(role => [role, prefix + '-' + role])),
    volumes: Object.fromEntries(['postgres', 'minio', 'imports', 'data', 'work', 'outputs', 'config'].map(role => [role, prefix + '-' + role])) };
}
export function validateFixtureImages(images) { need(plain(images) && Object.keys(images).sort().join(',') === [...ROLES].sort().join(',') && ROLES.every(role => IMAGE.test(images[role] ?? '')), 'SP5_FIXTURE_IMAGE_PINS'); return images; }
export function makeFixturePrivate(operationId) {
  const names = fixtureNames(operationId), secret = () => randomBytes(32).toString('base64url');
  return validateFixturePrivate({ schemaVersion: 'wfc.preparer.synthetic-integration-private.v1', operationId, projectId: randomUUID(),
    database: { host: names.containers.postgres, port: 5432, name: 'sp_fixture_' + operationId.replaceAll('-', ''), user: 'sp_fixture', password: secret() }, names: { minio: names.containers.minio },
    admins: [0, 1].map(index => ({ id: randomUUID(), email: 'admin' + (index + 1) + '.' + operationId + '@fixture.invalid', password: secret() })),
    apsApplications: [0, 1].map(() => ({ clientId: 'fixture_' + randomBytes(16).toString('hex'), clientSecret: secret() })),
    minio: { user: 'fixture_' + randomBytes(6).toString('hex'), password: secret() }, jwtSecret: secret(), origins: { wfc: 'http://127.0.0.1:5194', preparer: 'http://127.0.0.1:5193' } });
}
export const fixtureEdgeConfiguration = `# Fixture-only fixed reverse proxy. Not a production configuration change.
server { listen 8081; server_name _; client_max_body_size 2147483648; client_body_timeout 900s;
 location / { proxy_pass http://preparer:8080; proxy_http_version 1.1; proxy_set_header Host $http_host;
 proxy_set_header Origin $http_origin; proxy_set_header X-Forwarded-Proto $scheme;
 proxy_request_buffering off; proxy_buffering off; proxy_read_timeout 900s; proxy_send_timeout 900s; }
}
`;
const resourceLabels = (operationId, purpose) => ({ 'wfc.preparer.integration.owner': operationId, 'wfc.preparer.integration.purpose': purpose, 'wfc.preparer.integration.synthetic-only': 'true' });
export function assertFixtureOwned(value, { operationId, name, purpose, image }) {
  const labels = value?.Labels ?? value?.Config?.Labels;
  need((value?.Name === name || value?.Name === '/' + name) && labels?.['wfc.preparer.integration.owner'] === operationId && labels?.['wfc.preparer.integration.purpose'] === purpose
    && labels?.['wfc.preparer.integration.synthetic-only'] === 'true' && (!image || value.Image === image), 'SP5_FIXTURE_OWNERSHIP_LOST'); return value;
}
function networkIdentity(value) { const clone = structuredClone(value); delete clone.Containers; delete clone.Status; return hash(clone); }
function containerIdentity(value) { return hash({ id: value.Id, name: value.Name, image: value.Image, config: value.Config, hostConfig: value.HostConfig, mounts: value.Mounts,
  networks: Object.fromEntries(Object.entries(value.NetworkSettings?.Networks ?? {}).map(([name, item]) => [name, { NetworkID: item.NetworkID, Aliases: item.Aliases, IPAMConfig: item.IPAMConfig, DriverOpts: item.DriverOpts }])) }); }
const admissionIdentity = value => hash({ id: value.Id, image: value.Image, config: value.Config, hostConfig: value.HostConfig });
function constrained(image, user, env, cmd, labels, network, mounts, memory = 512 * 1024 ** 2) {
  return { Image: image, User: user, Env: env, Cmd: cmd, Labels: labels, AttachStdout: true, AttachStderr: true, Tty: false,
    HostConfig: { NetworkMode: network, Mounts: mounts, Memory: memory, MemorySwap: memory, NanoCpus: 1000000000, PidsLimit: 256,
      ReadonlyRootfs: true, CapDrop: ['ALL'], CapAdd: [], SecurityOpt: ['no-new-privileges:true'], Privileged: false, RestartPolicy: { Name: 'no' }, AutoRemove: false,
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=268435456,mode=1777' }, PortBindings: {}, PublishAllPorts: false } };
}
export function fixtureRoleConfiguration(role, { operationId, images, privateConfig: config, names, internalId, edgeId, operatorDirectory, edgeConfigurationPath }) {
  validateFixtureImages(images); validateFixturePrivate(config); need(ROLES.includes(role) && ID.test(internalId ?? '') && ID.test(edgeId ?? ''), 'SP5_FIXTURE_ROLE_INVALID');
  const labels = resourceLabels(operationId, role), volumes = names.volumes;
  if (role === 'postgres') {
    const value = constrained(images.postgres, '999:999', ['PGDATA=/var/lib/postgresql/18/docker', 'POSTGRES_USER=' + config.database.user, 'POSTGRES_PASSWORD=' + config.database.password, 'POSTGRES_DB=' + config.database.name], ['postgres'], labels, internalId, [mount(volumes.postgres, '/var/lib/postgresql', false, 'volume')]);
    // The image entrypoint clears PGHOST for its temporary initialization psql.
    // Preserve the image's socket default and make only that directory writable.
    value.HostConfig.Tmpfs['/var/run/postgresql'] = 'rw,noexec,nosuid,nodev,size=16777216,uid=999,gid=999,mode=3775';
    return value;
  }
  if (role === 'minio') return constrained(images.minio, '0', ['MINIO_ROOT_USER=' + config.minio.user, 'MINIO_ROOT_PASSWORD=' + config.minio.password, 'HOME=/tmp'], ['server', '/data', '--address', ':9000', '--console-address', ':9001'], labels, internalId, [mount(volumes.minio, '/data', false, 'volume')], 768 * 1024 ** 2);
  if (role === 'api') return constrained(images.api, '1000:1000', ['NODE_ENV=production', 'API_HOST=0.0.0.0', 'API_PORT=4000', 'API_USE_HTTPS=false',
    'DATABASE_URL=postgresql://' + config.database.user + ':' + config.database.password + '@' + config.database.host + ':5432/' + config.database.name, 'JWT_SECRET=' + config.jwtSecret,
    'CLIENT_ORIGIN=' + config.origins.wfc, 'MINIO_ENDPOINT=' + config.names.minio, 'MINIO_PORT=9000', 'MINIO_ACCESS_KEY=' + config.minio.user, 'MINIO_SECRET_KEY=' + config.minio.password,
    'MINIO_USE_SSL=false', 'MINIO_BUCKET_PROJECTS=sp5-project-files', 'MINIO_BUCKET_TEMPLATES=sp5-template-files', 'WFC_MODEL_BUCKET=sp5-models', 'WFC_MODEL_IMPORT_ROOT=/var/lib/wfc/model-imports',
    'WFC_VIEWER_ALLOWED_ORIGINS=' + config.origins.wfc, 'WFC_VIEWER_ALLOW_HTTP_LOOPBACK=true', 'WFC_PREPARER_INTERNAL_ORIGIN=http://preparer:8080', 'WFC_PREPARER_PUBLIC_ORIGIN=' + config.origins.preparer], ['node', 'server/dist/server/index.js'], labels, internalId, [mount(volumes.imports, '/var/lib/wfc/model-imports', false, 'volume')], 1024 ** 3);
  if (role === 'preparer') return constrained(images.preparer, '1000:1000', ['NODE_ENV=production', 'PREPARER_MODE=live', 'PREPARER_INSTANCE_ID=' + operationId, 'PREPARER_HOST=0.0.0.0', 'PREPARER_PORT=8080',
    'PREPARER_WFC_ORIGIN=http://api:4000', 'PREPARER_PUBLIC_ORIGIN=' + config.origins.preparer, 'PREPARER_DATA_DIR=/var/lib/preparer/data', 'PREPARER_WORK_DIR=/var/lib/preparer/work', 'PREPARER_OUTPUT_DIR=/var/lib/preparer/outputs', 'PREPARER_PACKAGE_MODULE=/opt/package/index.mjs'],
    ['node', '/fixture/fixture-preparer.mjs', 'serve', '--config', '/fixture-config/accounts.private.json'], labels, internalId, [mount(operatorDirectory, '/fixture'), mount(volumes.config, '/fixture-config', true, 'volume'), ...['data', 'work', 'outputs'].map(name => mount(volumes[name], '/var/lib/preparer/' + name, false, 'volume'))], 1024 ** 3);
  const value = constrained(images.web, '101:101', [], ['nginx', '-g', 'daemon off;'], labels, edgeId, [mount(edgeConfigurationPath, '/etc/nginx/conf.d/preparer-fixture.conf')], 256 * 1024 ** 2);
  value.HostConfig.PortBindings = { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '5194' }], '8081/tcp': [{ HostIp: '127.0.0.1', HostPort: '5193' }] };
  value.HostConfig.Sysctls = { 'net.ipv4.ip_unprivileged_port_start': '0' };
  value.HostConfig.Tmpfs['/var/cache/nginx'] = 'rw,noexec,nosuid,nodev,size=67108864,mode=1777'; value.HostConfig.Tmpfs['/var/run'] = 'rw,noexec,nosuid,nodev,size=1048576,mode=1777';
  value.NetworkingConfig = { EndpointsConfig: { [internalId]: { Aliases: ['edge'] }, [edgeId]: {} } }; return value;
}
async function probeFreePort(port) { await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', () => reject(Object.assign(Error('SP5_FIXTURE_PORT_IN_USE'), { code: 'SP5_FIXTURE_PORT_IN_USE' }))); server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve())); }); }
async function publicHealth(port, route) { return new Promise((resolve, reject) => { const request = http.get({ host: '127.0.0.1', port, path: route, timeout: 5000, headers: { Host: '127.0.0.1:' + port } }, response => { response.resume(); response.once('end', () => response.complete && response.statusCode === 200 ? resolve() : reject(Object.assign(Error('SP5_FIXTURE_PUBLIC_HEALTH'), { code: 'SP5_FIXTURE_PUBLIC_HEALTH' }))); }); request.once('timeout', () => request.destroy()); request.once('error', reject); }); }
async function directoryFor(operationDirectory, root) { need(typeof operationDirectory === 'string' && path.isAbsolute(operationDirectory), 'SP5_FIXTURE_OPERATION_INVALID'); const parent = await assertCanonicalPath(path.join(root, '.preparer-work'), { directory: true }), operationId = path.basename(operationDirectory).slice('sp-integration-'.length);
  need(UUID.test(operationId) && path.resolve(operationDirectory) === path.join(parent, 'sp-integration-' + operationId), 'SP5_FIXTURE_OPERATION_INVALID'); return { parent, operationId }; }
async function readJson(filename) { await assertCanonicalPath(filename); const bytes = await fs.readFile(filename); need(bytes.length > 0 && bytes.length <= 8 * 1024 ** 2, 'SP5_FIXTURE_RECEIPT_LIMIT'); return JSON.parse(bytes); }
async function allContainers(request) { const rows = await request('GET', '/containers/json?all=1'); need(Array.isArray(rows) && rows.length <= 1024, 'SP5_FIXTURE_CONTAINER_LIMIT'); return Promise.all(rows.map(row => { need(ID.test(row.Id ?? ''), 'SP5_FIXTURE_CONTAINER_ID'); return request('GET', '/containers/' + row.Id + '/json'); })); }
async function assertNoSourceOperation(parent) { for (const name of ['main5180-offline-seed.lock', 'main5180-recovery.lock']) { try { await fs.lstat(path.join(parent, name)); need(false, 'SP5_SOURCE_OPERATION_ACTIVE'); } catch (error) { if (error.code !== 'ENOENT') throw error; } } }

export async function startIntegrationFixture({ operationDirectory, images }, options = {}) {
  validateFixtureImages(images); const root = options.root ?? ROOT, owned = await directoryFor(operationDirectory, root); await assertNoSourceOperation(owned.parent);
  const names = fixtureNames(owned.operationId), config = makeFixturePrivate(owned.operationId), docker = options.docker ?? await createDocker(), started = Date.now();
  const check = () => { options.signal?.throwIfAborted(); need(Date.now() - started < FIXTURE_BUDGET.startMilliseconds, 'SP5_FIXTURE_START_TIMEOUT'); };
  let uncertain = false; const request = async (method, route, body) => { check(); try { return await docker.request(method, route, body, { timeoutMs: FIXTURE_BUDGET.requestMilliseconds }); } catch (error) { if (!['GET', 'HEAD'].includes(method)) uncertain = true; throw error; } };
  await fs.mkdir(operationDirectory, { mode: 0o700 }); const file = name => path.join(operationDirectory, name), resources = { containers: [], volumes: [], networks: [] }, creations = [];
  await writeJsonNew(file('owner.private.json'), { schemaVersion: 'wfc.preparer.synthetic-integration-owner.v1', operationId: owned.operationId, names, images,
    scope: 'synthetic browser integration only; no real Autodesk conversion', executionMode: options.docker ? 'injected-test-only' : 'local-docker', budget: FIXTURE_BUDGET, createdAt: new Date().toISOString() });
  const evidence = [], proof = async (name, value) => { await writeJsonNew(file(name), value); const item = await pin(file(name)); evidence.push(item); return item; };
  const operatorDirectory = file('operator'); await fs.mkdir(operatorDirectory, { mode: 0o700 });
  try {
    const source = path.join(HERE, 'fixture-preparer.mjs'), sourcePin = await pin(source); await fs.copyFile(source, path.join(operatorDirectory, 'fixture-preparer.mjs'), constants.COPYFILE_EXCL);
    need((await hashFile(path.join(operatorDirectory, 'fixture-preparer.mjs'))).sha256 === sourcePin.sha256, 'SP5_FIXTURE_OPERATOR_CHANGED');
    await proof('source.private.json', { operator: sourcePin, fixture: await pin(path.join(HERE, 'integration-fixture.mjs')), tests: await pin(path.join(HERE, 'integration-fixture.test.mjs')) });
    await writePrivateJson(file('accounts.private.json'), config); await fs.writeFile(file('synthetic.nwd'), SYNTHETIC_NWD, { flag: 'wx', mode: 0o600 }); await fs.writeFile(file('preparer-edge.conf'), fixtureEdgeConfiguration, { flag: 'wx', mode: 0o644 });
    const initial = await allContainers(request); need(!initial.some(item => Object.values(item.HostConfig?.PortBindings ?? {}).flat().some(entry => ['5193', '5194'].includes(entry.HostPort))), 'SP5_FIXTURE_PORT_IN_USE');
    await (options.probePort ?? probeFreePort)(5193); await (options.probePort ?? probeFreePort)(5194);
    const networks = await request('GET', '/networks'), volumes = await request('GET', '/volumes'); need(Array.isArray(networks) && Array.isArray(volumes.Volumes)
      && !networks.some(item => Object.values(names.networks).includes(item.Name)) && !volumes.Volumes.some(item => Object.values(names.volumes).includes(item.Name)), 'SP5_FIXTURE_RESOURCE_EXISTS');
    const info = await request('GET', '/info'), space = await (options.statfs ?? fs.statfs)(operationDirectory, { bigint: true }); let observedContainerMemoryBytes = 0;
    for (const item of initial.filter(item => item.State?.Running || item.State?.Restarting)) { const stats = await request('GET', '/containers/' + item.Id + '/stats?stream=false&one-shot=true'); need(Number.isSafeInteger(stats.memory_stats?.usage) && stats.memory_stats.usage >= 0, 'SP5_FIXTURE_MEMORY_UNVERIFIED'); observedContainerMemoryBytes += stats.memory_stats.usage; }
    need(Number.isSafeInteger(info.MemTotal) && Number.isSafeInteger(observedContainerMemoryBytes) && info.MemTotal - observedContainerMemoryBytes >= FIXTURE_BUDGET.minimumDockerHeadroomBytes + FIXTURE_BUDGET.totalRoleMemoryBytes
      && space.bavail * space.bsize >= BigInt(FIXTURE_BUDGET.minimumHostFreeBytes), 'SP5_FIXTURE_CAPACITY');
    const allowedImageVolumes = { postgres: ['/var/lib/postgresql'], minio: ['/data'], api: ['/var/lib/wfc/model-imports'], preparer: ['/var/lib/preparer/data', '/var/lib/preparer/work', '/var/lib/preparer/outputs'], web: [] };
    for (const role of ROLES) { const image = await request('GET', '/images/' + images[role] + '/json'); need(image.Id === images[role] && image.Os === 'linux' && image.Architecture === 'amd64'
      && Object.keys(image.Config?.Volumes ?? {}).every(value => allowedImageVolumes[role].includes(value)), 'SP5_FIXTURE_IMAGE_PINS'); }
    await proof('preflight.private.json', { initialContainers: initial.map(item => ({ id: item.Id, identity: containerIdentity(item) })), hostFreeBytes: String(space.bavail * space.bsize), dockerMemoryTotal: info.MemTotal, observedContainerMemoryBytes, dockerVolumeFreeBytes: 'NOT_PROVEN; allocation failure is fatal', plannedMemoryBytes: FIXTURE_BUDGET.totalRoleMemoryBytes, ports: [5193, 5194] });
    await assertNoSourceOperation(owned.parent);
    // A successful create is not an admitted resource until its independent
    // inspection and immutable evidence have both completed. Keep that gap
    // sticky, including malformed responses or failed acknowledgement writes.
    const pendingCreate = (kind, purpose, name) => { const pending = { kind, purpose, name, id: null, state: 'requested' }; creations.push(pending); return pending; };
    for (const purpose of ['internal', 'edge']) { const intended = { Name: names.networks[purpose], Driver: 'bridge', Internal: purpose === 'internal', Attachable: false, CheckDuplicate: true, Labels: resourceLabels(owned.operationId, 'network-' + purpose), ...(purpose === 'edge' ? { Options: { 'com.docker.network.bridge.enable_ip_masquerade': 'false' } } : {}) };
      await proof('network-intent-' + purpose + '.private.json', intended); const pending = pendingCreate('networks', purpose, intended.Name), made = await request('POST', '/networks/create', intended); need(ID.test(made.Id ?? ''), 'SP5_FIXTURE_NETWORK'); pending.id = made.Id; pending.state = 'created-unverified'; await proof('network-ack-' + purpose + '.private.json', pending);
      const actual = await request('GET', '/networks/' + made.Id); assertFixtureOwned(actual, { operationId: owned.operationId, name: intended.Name, purpose: 'network-' + purpose }); need(actual.Id === made.Id && actual.Internal === intended.Internal && Object.keys(actual.Containers ?? {}).length === 0, 'SP5_FIXTURE_NETWORK'); resources.networks.push({ purpose, name: actual.Name, id: actual.Id, identity: networkIdentity(actual) }); await proof('network-created-' + purpose + '.private.json', resources.networks.at(-1)); pending.state = 'admitted'; }
    for (const purpose of Object.keys(names.volumes)) { const intended = { Name: names.volumes[purpose], Driver: 'local', Labels: resourceLabels(owned.operationId, 'volume-' + purpose) }; await proof('volume-intent-' + purpose + '.private.json', intended); const pending = pendingCreate('volumes', purpose, intended.Name), made = await request('POST', '/volumes/create', intended);
      need(made?.Name === intended.Name, 'SP5_FIXTURE_VOLUME'); pending.id = made.Name; pending.state = 'created-unverified'; await proof('volume-ack-' + purpose + '.private.json', pending);
      const actual = await request('GET', '/volumes/' + encodeURIComponent(made.Name)); assertFixtureOwned(actual, { operationId: owned.operationId, name: intended.Name, purpose: 'volume-' + purpose }); need(actual.Driver === 'local' && Object.keys(actual.Options ?? {}).length === 0, 'SP5_FIXTURE_VOLUME'); resources.volumes.push({ purpose, name: actual.Name, identity: hash(actual) }); await proof('volume-created-' + purpose + '.private.json', resources.volumes.at(-1)); pending.state = 'admitted'; }
    const internalId = resources.networks.find(item => item.purpose === 'internal').id, edgeId = resources.networks.find(item => item.purpose === 'edge').id;
    async function create(name, purpose, image, configuration) { await proof('container-intent-' + purpose + '.private.json', { name, image, configurationSha256: hash(configuration) }); const pending = pendingCreate('containers', purpose, name), made = await request('POST', '/containers/create?name=' + encodeURIComponent(name), configuration); need(ID.test(made.Id ?? ''), 'SP5_FIXTURE_CONTAINER_ID'); pending.id = made.Id; pending.state = 'created-unverified'; await proof('container-ack-' + purpose + '.private.json', pending);
      const actual = await request('GET', '/containers/' + made.Id + '/json'); assertFixtureOwned(actual, { operationId: owned.operationId, name, purpose, image }); need(actual.Id === made.Id, 'SP5_FIXTURE_CONTAINER_ID'); const row = { id: made.Id, name, purpose, image, admission: admissionIdentity(actual) }; resources.containers.push(row); await proof('container-created-' + purpose + '.private.json', row); pending.state = 'admitted'; return row; }
    let helperNumber = 0;
    async function helper(mode, role) {
      const purpose = 'helper-' + (++helperNumber), name = names.project + '-' + purpose, init = mode === 'init';
      const configuration = constrained(images.api, init ? '0' : '1000:1000', [], ['node', '/fixture/fixture-preparer.mjs', mode, '--config', init ? '/private/accounts.private.json' : '/fixture-config/accounts.private.json', ...(role ? ['--role', role] : [])], resourceLabels(owned.operationId, purpose), init ? 'none' : internalId,
        [mount(operatorDirectory, '/fixture'), ...(init ? [mount(operationDirectory, '/private'), mount(names.volumes.config, '/fixture-config', false, 'volume'), mount(names.volumes.postgres, '/fixture-postgres', false, 'volume')] : [mount(names.volumes.config, '/fixture-config', true, 'volume')])]);
      if (init) configuration.HostConfig.CapAdd = ['CHOWN', 'FOWNER', 'DAC_OVERRIDE'];
      const row = await create(name, purpose, images.api, configuration); await request('POST', '/containers/' + row.id + '/start');
      const deadline = Date.now() + FIXTURE_BUDGET.healthMilliseconds;
      for (;;) { check(); const current = await request('GET', '/containers/' + row.id + '/json'); assertFixtureOwned(current, { operationId: owned.operationId, ...row });
        if (current.State?.Running === false && current.State.Pid === 0) { need(current.State.ExitCode === 0 && !current.State.OOMKilled, 'SP5_FIXTURE_HELPER_FAILED'); break; }
        need(Date.now() < deadline, 'SP5_FIXTURE_HEALTH_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 250)); }
      const raw = await withBoundedDockerExecution(LOG_BOUNDS, () => docker.command(['logs', row.id], { maxBytes: 65536 })); let value; try { value = JSON.parse(raw.toString().trim()); } catch { need(false, 'SP5_FIXTURE_HELPER_RESPONSE'); }
      need(value.status === 'PASS' && value.operationId === owned.operationId && (!role || value.role === role), 'SP5_FIXTURE_HELPER_RESPONSE'); await request('DELETE', '/containers/' + row.id + '?v=false'); row.removed = true; await proof(purpose + '-complete.private.json', value);
    }
    await helper('init');
    for (const role of ROLES) {
      const configuration = fixtureRoleConfiguration(role, { operationId: owned.operationId, images, privateConfig: config, names, internalId, edgeId, operatorDirectory, edgeConfigurationPath: file('preparer-edge.conf') });
      if (role !== 'web') configuration.NetworkingConfig = { EndpointsConfig: { [internalId]: { Aliases: role === 'api' ? ['api'] : role === 'preparer' ? ['preparer'] : [] } } };
      const row = await create(names.containers[role], role, images[role], configuration); await request('POST', '/containers/' + row.id + '/start'); await helper('probe', role);
      if (role === 'api') await helper('seed');
    }
    await (options.publicHealth ?? publicHealth)(5194, '/health'); await (options.publicHealth ?? publicHealth)(5193, '/health');
    const current = await allContainers(request), expectedIds = resources.containers.filter(item => !item.removed).map(item => item.id);
    for (const item of resources.containers.filter(item => !item.removed)) { const actual = current.find(value => value.Id === item.id); assertFixtureOwned(actual, { operationId: owned.operationId, ...item }); need(actual.State?.Running === true, 'SP5_FIXTURE_ROLE_STOPPED'); item.identity = containerIdentity(actual);
      if (item.purpose !== 'web') need(Object.keys(actual.HostConfig?.PortBindings ?? {}).length === 0 && Object.keys(actual.NetworkSettings?.Networks ?? {}).length === 1 && Object.values(actual.NetworkSettings.Networks)[0].NetworkID === internalId, 'SP5_FIXTURE_INTERNAL_SCOPE'); }
    for (const item of resources.networks) { const actual = await request('GET', '/networks/' + item.id); need(networkIdentity(actual) === item.identity && Object.keys(actual.Containers ?? {}).every(id => expectedIds.includes(id)), 'SP5_FIXTURE_FOREIGN_NETWORK_CLIENT'); }
    for (const before of initial) { const after = current.find(item => item.Id === before.Id); need(after && containerIdentity(after) === containerIdentity(before), 'SP5_FIXTURE_FOREIGN_CONTAINER_CHANGED'); }
    need(creations.every(item => item.state === 'admitted'), 'SP5_FIXTURE_RECONCILIATION_REQUIRED');
    const ready = { schemaVersion: 'wfc.preparer.synthetic-integration-ready.v1', status: 'PASS', operationId: owned.operationId, images, resources, creations, evidence,
      browserReady: true, wfcOrigin: config.origins.wfc, preparerOrigin: config.origins.preparer, actualBrowserAcceptance: 'NOT_RUN', productionCloudAcceptance: 'NOT_RUN', realAutodeskRequests: 0,
      privateAccountsPath: file('accounts.private.json'), syntheticNwdPath: file('synthetic.nwd'), createdAt: new Date().toISOString() };
    await writeJsonNew(file('ready.private.json'), ready); return { status: 'PASS', operationDirectory, operationId: owned.operationId, wfcOrigin: ready.wfcOrigin, preparerOrigin: ready.preparerOrigin, actualBrowserAcceptance: 'NOT_RUN', productionCloudAcceptance: 'NOT_RUN' };
  } catch (error) { await writeJsonNew(file('failure.private.json'), { status: 'FAIL', operationId: owned.operationId, code: codeFor(error), uncertainDockerMutation: uncertain || creations.some(item => item.state !== 'admitted'), resources, creations, automaticRetry: false, cleanup: 'explicit stop required; uncertain outcomes require reconciliation' }); throw error; }
}

export async function stopIntegrationFixture({ operationDirectory }, options = {}) {
  const root = options.root ?? ROOT, owned = await directoryFor(operationDirectory, root), owner = await readJson(path.join(operationDirectory, 'owner.private.json'));
  need(owner.schemaVersion === 'wfc.preparer.synthetic-integration-owner.v1' && owner.operationId === owned.operationId, 'SP5_FIXTURE_OWNER_INVALID'); validateFixtureImages(owner.images);
  let receipt; try { receipt = await readJson(path.join(operationDirectory, 'ready.private.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; receipt = await readJson(path.join(operationDirectory, 'failure.private.json')); need(receipt.uncertainDockerMutation === false, 'SP5_FIXTURE_RECONCILIATION_REQUIRED'); }
  need(receipt.operationId === owned.operationId && receipt.resources, 'SP5_FIXTURE_RECEIPT_INVALID');
  need(Array.isArray(receipt.creations) && receipt.creations.every(item => item.state === 'admitted')
    && receipt.creations.length === ['containers', 'volumes', 'networks'].reduce((sum, kind) => sum + receipt.resources[kind].length, 0)
    && ['containers', 'volumes', 'networks'].every(kind => receipt.resources[kind].every(row => receipt.creations.some(item => item.kind === kind && item.purpose === row.purpose && item.name === row.name && item.id === (kind === 'volumes' ? row.name : row.id)))), 'SP5_FIXTURE_RECONCILIATION_REQUIRED');
  try { await fs.lstat(path.join(operationDirectory, 'stopped.private.json')); need(false, 'SP5_FIXTURE_ALREADY_STOPPED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeJsonNew(path.join(operationDirectory, 'stop-begin.private.json'), { schemaVersion: 'wfc.preparer.synthetic-integration-stop-attempt.v1', operationId: owned.operationId, at: new Date().toISOString() });
  try {
  const docker = options.docker ?? await createDocker(), deadline = Date.now() + FIXTURE_BUDGET.startMilliseconds, request = (method, route, body) => { options.signal?.throwIfAborted(); need(Date.now() < deadline, 'SP5_FIXTURE_STOP_TIMEOUT'); return docker.request(method, route, body, { timeoutMs: FIXTURE_BUDGET.requestMilliseconds }); }, resources = receipt.resources;
  for (const row of [...resources.containers].reverse().filter(item => !item.removed)) {
    const current = await request('GET', '/containers/' + row.id + '/json'); assertFixtureOwned(current, { operationId: owned.operationId, ...row }); need(row.admission === admissionIdentity(current) && (!row.identity || row.identity === containerIdentity(current)), 'SP5_FIXTURE_CONTAINER_CHANGED');
    if (current.State?.Running || current.State?.Restarting || current.State?.Pid !== 0) await request('POST', '/containers/' + row.id + '/stop?t=45');
    const stopped = await request('GET', '/containers/' + row.id + '/json'); assertFixtureOwned(stopped, { operationId: owned.operationId, ...row }); need(stopped.State?.Running === false && stopped.State.Pid === 0, 'SP5_FIXTURE_JOIN_UNCONFIRMED'); await request('DELETE', '/containers/' + row.id + '?v=false');
  }
  const all = await allContainers(request); need(!all.some(item => resources.containers.some(row => row.id === item.Id)), 'SP5_FIXTURE_REMOVE_UNCONFIRMED');
  need(!all.some(item => item.Mounts?.some(m => m.Type === 'volume' && resources.volumes.some(row => row.name === m.Name))), 'SP5_FIXTURE_VOLUME_FOREIGN_MOUNT');
  for (const row of [...resources.volumes].reverse()) { const current = await request('GET', '/volumes/' + encodeURIComponent(row.name)); assertFixtureOwned(current, { operationId: owned.operationId, name: row.name, purpose: 'volume-' + row.purpose }); need(hash(current) === row.identity, 'SP5_FIXTURE_VOLUME_CHANGED'); await request('DELETE', '/volumes/' + encodeURIComponent(row.name)); }
  for (const row of [...resources.networks].reverse()) { const current = await request('GET', '/networks/' + row.id); assertFixtureOwned(current, { operationId: owned.operationId, name: row.name, purpose: 'network-' + row.purpose }); need(networkIdentity(current) === row.identity && Object.keys(current.Containers ?? {}).length === 0, 'SP5_FIXTURE_NETWORK_CHANGED'); await request('DELETE', '/networks/' + row.id); }
  const volumes = await request('GET', '/volumes'), networks = await request('GET', '/networks'); need(!volumes.Volumes?.some(item => resources.volumes.some(row => row.name === item.Name)) && !networks.some(item => resources.networks.some(row => row.id === item.Id)), 'SP5_FIXTURE_REMOVE_UNCONFIRMED');
  const result = { schemaVersion: 'wfc.preparer.synthetic-integration-stopped.v1', status: 'PASS', operationId: owned.operationId, resourcesRemoved: true, privateEvidenceRetained: true }; await writeJsonNew(path.join(operationDirectory, 'stopped.private.json'), result); return { status: 'PASS', operationDirectory, operationId: owned.operationId, resourcesRemoved: true };
  } catch (error) { await writeJsonNew(path.join(operationDirectory, 'stop-failure.private.json'), { schemaVersion: 'wfc.preparer.synthetic-integration-stop-failure.v1', operationId: owned.operationId, status: 'FAIL', code: codeFor(error), cleanupUnconfirmed: true, automaticRetry: false }); throw error; }
}
export async function main(args) {
  if (args.length === 3 && args[0] === 'stop' && args[1] === '--operation') console.log(JSON.stringify(await stopIntegrationFixture({ operationDirectory: args[2] })));
  else { need(args.length === 5 && args[0] === 'start' && args[1] === '--operation' && args[3] === '--images', 'SP5_FIXTURE_ARGUMENT_INVALID'); const images = await readJson(args[4]); console.log(JSON.stringify(await startIntegrationFixture({ operationDirectory: args[2], images }))); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { console.log(JSON.stringify({ status: 'FAIL', code: codeFor(error) })); process.exitCode = 1; });
