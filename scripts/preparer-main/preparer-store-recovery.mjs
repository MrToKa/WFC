import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDocker, writePrivateJson } from './foundation/docker.mjs';
import { withBoundedDockerExecution } from './foundation/docker-bounds.mjs';
import { assertCanonicalPath, hashFile, verifyArchive } from './foundation/archives.mjs';
import { writeJsonNew } from './foundation/manifest.mjs';
import { assertFixtureOwned } from './integration-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..'), execute = promisify(execFile);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, ID = /^[a-f0-9]{64}$/, IMAGE = /^sha256:[a-f0-9]{64}$/;
const STORES = ['data', 'work', 'outputs'], AUTH = 'workspace-private/workspace-auth-v2.enc';
const need = (value, code) => { if (!value) throw Object.assign(Error(code), { code }); };
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const same = (a, b) => hash(a) === hash(b), pin = async filename => ({ path: filename, ...await hashFile(filename) });
const safeCode = error => /^[A-Z0-9_]{3,80}$/.test(error?.code ?? '') ? error.code : 'PREPARER_STORE_RECOVERY_FAILED';
const mount = (source, target, readOnly = true, type = 'bind') => ({ Type: type, Source: source, Target: target, ReadOnly: readOnly });
const labels = (operationId, purpose) => ({ 'wfc.preparer.store-recovery.owner': operationId, 'wfc.preparer.store-recovery.purpose': purpose, 'wfc.preparer.store-recovery.synthetic-only': 'true' });
const LOG_BOUNDS = Object.freeze({ operationTimeoutMs: 30000, commandTimeoutMs: 15000, requestTimeoutMs: 15000, helperTimeoutMs: 15000, helperMemoryBytes: 128 * 1024 ** 2, pidsLimit: 64, nanoCpus: 1000000000, tmpBytes: 16 * 1024 ** 2, archiveOutputBytes: 1024 ** 2 });
export const PREPARER_STORE_BOUNDS = Object.freeze({ phaseMilliseconds: 1800000, requestMilliseconds: 90000, helperMilliseconds: 600000, minimumHostFreeBytes: 512 * 1024 ** 2 });
export function storeRecoveryNames(operationId) { need(UUID.test(operationId ?? ''), 'PREPARER_STORE_OWNER_INVALID'); return { container: 'wfc-preparer-restored-' + operationId, alias: 'restored-preparer-' + operationId, volumes: Object.fromEntries(STORES.map(role => [role, 'wfc-preparer-store-' + operationId + '-' + role])) }; }
function containerIdentity(value) { return hash({ id: value.Id, name: value.Name, image: value.Image, config: value.Config, hostConfig: value.HostConfig, mounts: value.Mounts,
  networks: Object.fromEntries(Object.entries(value.NetworkSettings?.Networks ?? {}).map(([name, item]) => [name, { NetworkID: item.NetworkID, Aliases: item.Aliases, IPAMConfig: item.IPAMConfig, DriverOpts: item.DriverOpts }])) }); }
const admissionIdentity = value => hash({ id: value.Id, image: value.Image, config: value.Config, hostConfig: value.HostConfig });
export function assertStoreResource(value, { operationId, purpose, name, image }) { const record = value?.Labels ?? value?.Config?.Labels; need((value?.Name === name || value?.Name === '/' + name) && record?.['wfc.preparer.store-recovery.owner'] === operationId && record?.['wfc.preparer.store-recovery.purpose'] === purpose && record?.['wfc.preparer.store-recovery.synthetic-only'] === 'true' && (!image || value.Image === image), 'PREPARER_STORE_OWNERSHIP_LOST'); return value; }
async function readJson(filename, expectedSha256) { await assertCanonicalPath(filename); const raw = await fs.readFile(filename); need(raw.length > 0 && raw.length <= 8 * 1024 ** 2 && (!expectedSha256 || createHash('sha256').update(raw).digest('hex') === expectedSha256), 'PREPARER_STORE_RECEIPT_CHANGED'); return JSON.parse(raw); }
async function ownedDirectory(directory, root) { const parent = await assertCanonicalPath(path.join(root, '.preparer-work'), { directory: true }), operationId = path.basename(directory).slice('sp-preparer-store-'.length); need(UUID.test(operationId) && path.resolve(directory) === path.join(parent, 'sp-preparer-store-' + operationId), 'PREPARER_STORE_OPERATION_INVALID'); return { parent, operationId }; }
export function assertRestoreCleanupReceipt(value) {
  need(value?.schemaVersion === 'wfc.preparer.store-restore.v1' && value.status === 'PASS' && UUID.test(value.operationId ?? '') && value.resources?.volumes?.length === 3 && STORES.every(role => value.resources.volumes.filter(item => item.purpose === role).length === 1)
    && value.resources.containers?.length === 1 && value.resources.containers[0].purpose === 'restored' && Array.isArray(value.creations) && value.creations.length >= 4 && value.creations.every(item => item.state === 'admitted') && value.uncertainDockerMutation === false, 'PREPARER_STORE_RECONCILIATION_REQUIRED');
  const names = storeRecoveryNames(value.operationId), container = value.resources.containers[0];
  need(container.name === names.container && ID.test(container.id ?? '') && ID.test(container.admission ?? '') && ID.test(container.identity ?? '') && IMAGE.test(container.image ?? '')
    && new Set(value.creations.map(item => item.kind + ':' + item.name)).size === value.creations.length
    && Array.isArray(value.helpers) && value.helpers.length > 0 && value.helpers.every(item => item.removed === true && ID.test(item.id ?? '') && typeof item.purpose === 'string' && item.purpose.startsWith('helper-restore-')), 'PREPARER_STORE_RECONCILIATION_REQUIRED');
  for (const row of value.resources.volumes) need(row.name === names.volumes[row.purpose] && ID.test(row.identity ?? ''), 'PREPARER_STORE_RECONCILIATION_REQUIRED');
  for (const kind of ['volumes', 'containers']) for (const row of value.resources[kind]) need(value.creations.filter(item => item.kind === kind && item.name === row.name && item.id === (kind === 'volumes' ? row.name : row.id)).length === 1, 'PREPARER_STORE_RECONCILIATION_REQUIRED');
  for (const row of value.helpers) need(value.creations.filter(item => item.kind === 'containers' && item.name === row.name && item.id === row.id).length === 1, 'PREPARER_STORE_RECONCILIATION_REQUIRED');
  need(value.creations.length === 4 + value.helpers.length, 'PREPARER_STORE_RECONCILIATION_REQUIRED'); return value;
}
export function clonedPreparerConfiguration(original, { operationId, volumes, networkId }) {
  need(UUID.test(operationId ?? '') && ID.test(networkId ?? '') && STORES.every(role => typeof volumes[role] === 'string'), 'PREPARER_STORE_CLONE_INVALID');
  const names = storeRecoveryNames(operationId), config = structuredClone(original.Config), host = structuredClone(original.HostConfig);
  need(config.Image === original.Image && IMAGE.test(original.Image ?? '') && config.User === '1000:1000' && config.Cmd?.[0] === 'node' && config.Cmd[1] === '/fixture/fixture-preparer.mjs' && config.Cmd[2] === 'serve'
    && host.Mounts?.length === 5 && host.RestartPolicy?.Name === 'no' && Object.keys(host.PortBindings ?? {}).length === 0, 'PREPARER_STORE_SOURCE_CONFIG');
  config.Hostname = names.alias; config.Labels = labels(operationId, 'restored'); host.NetworkMode = networkId; host.PortBindings = {}; host.PublishAllPorts = false;
  host.Mounts = host.Mounts.map(item => { const role = STORES.find(role => item.Target === '/var/lib/preparer/' + role); if (role) {
    const effective = original.Mounts?.filter(value => value.Destination === item.Target) ?? [];
    // Native Docker inspection omits false in HostConfig.Mounts. The effective
    // mount must independently confirm the exact writable named volume.
    need(item.Type === 'volume' && (item.ReadOnly === undefined || item.ReadOnly === false) && effective.length === 1 && effective[0].Type === 'volume' && effective[0].Name === item.Source && effective[0].Destination === item.Target && effective[0].RW === true, 'PREPARER_STORE_SOURCE_CONFIG');
    return { ...item, Source: volumes[role] };
  } need(item.ReadOnly === true && ['/fixture', '/fixture-config'].includes(item.Target), 'PREPARER_STORE_SOURCE_CONFIG'); return item; });
  need(STORES.every(role => host.Mounts.filter(item => item.Target === '/var/lib/preparer/' + role).length === 1), 'PREPARER_STORE_SOURCE_CONFIG');
  return { ...config, HostConfig: host, AttachStdout: true, AttachStderr: true, Tty: false, NetworkingConfig: { EndpointsConfig: { [networkId]: { Aliases: [names.alias] } } } };
}
function entriesWithoutOffsets(entries) { return entries.map(({ offset, ...entry }) => entry).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))); }
export function compareAuthFenceEntries(before, after, operationId) {
  need(UUID.test(operationId ?? '') && Array.isArray(before) && Array.isArray(after), 'PREPARER_STORE_FENCE_INVALID'); const renamed = 'workspace-private/workspace-auth-v2.revoked-' + operationId + '.enc';
  need(before.filter(item => item.path === AUTH && item.type === 'file').length === 1 && !before.some(item => item.path === renamed), 'PREPARER_STORE_AUTH_REQUIRED');
  const expected = before.map(item => item.path === AUTH ? { ...item, path: renamed } : item);
  need(same(entriesWithoutOffsets(expected), entriesWithoutOffsets(after)), 'PREPARER_STORE_FENCE_DELTA'); return { status: 'PASS', oldPath: AUTH, retainedPath: renamed, onlyDeclaredAuthRename: true };
}
export async function fenceRestoredLogin({ directory, operationId }, { restoreTimestamp } = {}) {
  need(path.isAbsolute(directory ?? '') && UUID.test(operationId ?? ''), 'PREPARER_STORE_FENCE_INVALID'); await assertCanonicalPath(directory, { directory: true });
  const parent = path.join(directory, 'workspace-private'); await assertCanonicalPath(parent, { directory: true }); const source = path.join(directory, AUTH), destination = path.join(parent, 'workspace-auth-v2.revoked-' + operationId + '.enc');
  const sourceStat = await fs.lstat(source); need(sourceStat.isFile() && sourceStat.nlink === 1 && sourceStat.size <= 2 * 1024 ** 2, 'PREPARER_STORE_AUTH_LIMIT');
  const before = await pin(source), parentBefore = await fs.lstat(parent, { bigint: true });
  try { await fs.lstat(destination); need(false, 'PREPARER_STORE_FENCE_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.rename(source, destination);
  if (restoreTimestamp) await restoreTimestamp(parent, parentBefore.mtimeNs);
  else { const ns = parentBefore.mtimeNs, negative = ns < 0n, absolute = negative ? -ns : ns; await execute('touch', ['--no-dereference', '--no-create', '-m', '--date=@' + (negative ? '-' : '') + absolute / 1000000000n + '.' + String(absolute % 1000000000n).padStart(9, '0'), parent], { windowsHide: true, timeout: 10000 }); }
  const parentAfter = await fs.lstat(parent, { bigint: true }), after = await pin(destination);
  need(same({ ...before, path: destination }, after) && parentBefore.mtimeNs === parentAfter.mtimeNs && parentBefore.mode === parentAfter.mode && parentBefore.uid === parentAfter.uid && parentBefore.gid === parentAfter.gid, 'PREPARER_STORE_FENCE_CHANGED');
  try { await fs.lstat(source); need(false, 'PREPARER_STORE_FENCE_CHANGED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { schemaVersion: 'wfc.preparer.restored-login-fence.v1', status: 'PASS', operationId, before, after, parentMetadataRestored: true, tokensDecoded: false, productionFence: !restoreTimestamp };
}

export async function resumeOriginalPreparer({ sourceId, expectedIdentity }, request) {
  need(ID.test(sourceId ?? '') && ID.test(expectedIdentity ?? ''), 'PREPARER_STORE_SOURCE_CHANGED');
  const current = await request('GET', '/containers/' + sourceId + '/json');
  need(current.Id === sourceId && containerIdentity(current) === expectedIdentity && !current.State?.Restarting, 'PREPARER_STORE_SOURCE_CHANGED');
  if (current.State?.Running !== true) { need(current.State?.Running === false && current.State.Pid === 0, 'PREPARER_STORE_SOURCE_RESUME_UNCONFIRMED'); await request('POST', '/containers/' + sourceId + '/start'); }
  const after = await request('GET', '/containers/' + sourceId + '/json');
  need(after.Id === sourceId && after.State?.Running === true && !after.State.Restarting && containerIdentity(after) === expectedIdentity, 'PREPARER_STORE_SOURCE_RESUME_UNCONFIRMED');
  return { sourceId, identity: expectedIdentity, status: 'PASS' };
}

async function fixtureScope(readyPath, readySha256, request) {
  need(path.isAbsolute(readyPath ?? '') && ID.test(readySha256 ?? '') && path.basename(readyPath) === 'ready.private.json', 'PREPARER_STORE_ARGUMENT_INVALID'); const ready = await readJson(readyPath, readySha256);
  need(ready.schemaVersion === 'wfc.preparer.synthetic-integration-ready.v1' && ready.status === 'PASS' && UUID.test(ready.operationId ?? '') && ready.realAutodeskRequests === 0, 'PREPARER_STORE_FIXTURE_REQUIRED');
  const row = ready.resources?.containers?.find(item => item.purpose === 'preparer'), internal = ready.resources?.networks?.find(item => item.purpose === 'internal'); need(row && internal && ID.test(row.id) && ID.test(internal.id) && row.image === ready.images.preparer, 'PREPARER_STORE_FIXTURE_REQUIRED');
  const current = await request('GET', '/containers/' + row.id + '/json'); assertFixtureOwned(current, { operationId: ready.operationId, ...row }); need(containerIdentity(current) === row.identity && admissionIdentity(current) === row.admission, 'PREPARER_STORE_SOURCE_CHANGED');
  const network = await request('GET', '/networks/' + internal.id); assertFixtureOwned(network, { operationId: ready.operationId, name: internal.name, purpose: 'network-internal' }); need(network.Internal === true, 'PREPARER_STORE_NETWORK_CHANGED');
  const stores = [];
  for (const purpose of STORES) { const target = '/var/lib/preparer/' + purpose, matches = current.Mounts.filter(item => item.Destination === target); need(matches.length === 1 && matches[0].Type === 'volume' && matches[0].RW === true, 'PREPARER_STORE_MOUNT_INVALID'); const expected = ready.resources.volumes.find(item => item.purpose === purpose); need(expected?.name === matches[0].Name, 'PREPARER_STORE_MOUNT_INVALID');
    const volume = await request('GET', '/volumes/' + encodeURIComponent(expected.name)); assertFixtureOwned(volume, { operationId: ready.operationId, name: expected.name, purpose: 'volume-' + purpose }); need(hash(volume) === expected.identity, 'PREPARER_STORE_VOLUME_CHANGED'); stores.push({ purpose, name: expected.name, identity: expected.identity }); }
  return { ready, source: current, sourceRow: row, network: internal, stores };
}
async function assertSourceStoreWriters(scope, request) {
  const clients = await request('GET', '/containers/json?all=1');
  for (const row of clients) {
    if (row.Id === scope.source.Id) continue;
    const other = await request('GET', '/containers/' + row.Id + '/json');
    need(!other.Mounts?.some(item => item.Type === 'volume' && item.RW === true && scope.stores.some(store => store.name === item.Name)), 'PREPARER_STORE_FOREIGN_WRITER');
  }
}
async function context(operationDirectory, operationId, helperImage, options, phase) {
  need(IMAGE.test(helperImage ?? ''), 'PREPARER_STORE_HELPER_IMAGE'); const docker = options.docker ?? await createDocker(), started = Date.now(), resources = { volumes: [], containers: [] }, creations = [], helpers = []; let uncertain = false;
  const request = async (method, route, body) => { options.signal?.throwIfAborted(); need(Date.now() - started < PREPARER_STORE_BOUNDS.phaseMilliseconds, 'PREPARER_STORE_PHASE_TIMEOUT'); try { return await docker.request(method, route, body, { timeoutMs: PREPARER_STORE_BOUNDS.requestMilliseconds }); } catch (error) { if (!['GET', 'HEAD'].includes(method)) uncertain = true; throw error; } };
  // This separate, three-request recovery allowance remains usable after capture
  // cancellation or its deadline. It never changes the source configuration.
  const recoveryRequest = async (method, route, body) => { try { return await docker.request(method, route, body, { timeoutMs: 15000 }); } catch (error) { if (method !== 'GET') uncertain = true; throw error; } };
  const file = name => path.join(operationDirectory, phase + '-' + name + '.private.json'), evidence = [], proof = async (name, value) => { await writeJsonNew(file(name), value); const valuePin = await pin(file(name)); evidence.push(valuePin); return valuePin; };
  const image = await request('GET', '/images/' + helperImage + '/json'); need(image.Id === helperImage && image.Os === 'linux' && image.Architecture === 'amd64', 'PREPARER_STORE_HELPER_IMAGE');
  const create = async (name, purpose, configuration, imageId = helperImage) => {
    await proof('intent-' + purpose, { name, image: imageId, configurationSha256: hash(configuration) }); const pending = { kind: 'containers', name, purpose, id: null, state: 'requested' }; creations.push(pending);
    const made = await request('POST', '/containers/create?name=' + encodeURIComponent(name), configuration); need(ID.test(made?.Id ?? ''), 'PREPARER_STORE_CREATE_UNCONFIRMED'); pending.id = made.Id; pending.state = 'created-unverified'; await proof('ack-' + purpose, pending);
    const actual = await request('GET', '/containers/' + made.Id + '/json'); assertStoreResource(actual, { operationId, purpose, name, image: imageId }); need(actual.Id === made.Id, 'PREPARER_STORE_CREATE_UNCONFIRMED');
    const row = { id: made.Id, name, purpose, image: imageId, admission: admissionIdentity(actual) }; await proof('created-' + purpose, row); pending.state = 'admitted'; return row;
  };
  const helper = async (cmd, mounts, capabilities = []) => {
    const purpose = 'helper-' + phase + '-' + (helpers.length + 1), name = 'wfc-preparer-store-' + operationId + '-' + purpose, configuration = { Image: helperImage, User: '0', Env: [], Cmd: cmd, Labels: labels(operationId, purpose), AttachStdout: true, AttachStderr: true, Tty: false,
      HostConfig: { NetworkMode: 'none', Mounts: mounts, ReadonlyRootfs: true, Memory: 512 * 1024 ** 2, MemorySwap: 512 * 1024 ** 2, NanoCpus: 1000000000, PidsLimit: 128, RestartPolicy: { Name: 'no' }, AutoRemove: false, Privileged: false, CapDrop: ['ALL'], CapAdd: capabilities, SecurityOpt: ['no-new-privileges:true'], Tmpfs: { '/tmp': 'rw,noexec,nosuid,nodev,size=67108864,mode=1777' }, PortBindings: {} } };
    const row = await create(name, purpose, configuration); helpers.push(row); await request('POST', '/containers/' + row.id + '/start'); const deadline = Date.now() + PREPARER_STORE_BOUNDS.helperMilliseconds;
    for (;;) { const actual = await request('GET', '/containers/' + row.id + '/json'); assertStoreResource(actual, { operationId, ...row }); if (actual.State?.Running === false && actual.State.Pid === 0) { need(actual.State.ExitCode === 0 && !actual.State.OOMKilled, 'PREPARER_STORE_HELPER_FAILED'); break; } need(Date.now() < deadline, 'PREPARER_STORE_HELPER_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 250)); }
    const output = await withBoundedDockerExecution(LOG_BOUNDS, () => docker.command(['logs', row.id], { maxBytes: 1024 ** 2 })); let result; try { result = JSON.parse(output.toString().trim()); } catch { need(false, 'PREPARER_STORE_HELPER_RESPONSE'); } need(result.status === 'PASS', 'PREPARER_STORE_HELPER_RESPONSE');
    await request('DELETE', '/containers/' + row.id + '?v=false'); need(!(await request('GET', '/containers/json?all=1')).some(item => item.Id === row.id), 'PREPARER_STORE_HELPER_REMOVAL_UNCONFIRMED'); row.removed = true; await proof('completed-' + purpose, result); return result;
  };
  return { request, recoveryRequest, create, helper, resources, creations, helpers, evidence, proof, uncertain: () => uncertain || creations.some(item => item.state !== 'admitted') };
}

export async function capturePreparerStores({ operationDirectory, fixtureReadyPath, fixtureReadySha256, helperImage }, options = {}) {
  const owned = await ownedDirectory(operationDirectory, options.root ?? ROOT); await fs.mkdir(operationDirectory, { mode: 0o700 });
  const ctx = await context(operationDirectory, owned.operationId, helperImage, options, 'capture'), file = name => path.join(operationDirectory, name); let scope, primary, stoppedByUs = false, resumed = false; const archives = [];
  await writeJsonNew(file('owner.private.json'), { schemaVersion: 'wfc.preparer.store-recovery-owner.v1', operationId: owned.operationId, fixtureReadyPath, fixtureReadySha256, helperImage, syntheticOnly: true });
  try {
    scope = await fixtureScope(fixtureReadyPath, fixtureReadySha256, ctx.request); need(scope.source.State?.Running === true && !scope.source.State.Restarting, 'PREPARER_STORE_SOURCE_NOT_RUNNING');
    await writePrivateJson(file('companion.private.json'), { schemaVersion: 'wfc.preparer.store-private.v1', operationId: owned.operationId, source: scope.source, sourceReady: await pin(fixtureReadyPath), network: scope.network, stores: scope.stores });
    const cold = file('cold'); await fs.mkdir(cold, { mode: 0o700 }); let sourceBytes = 0;
    for (const store of scope.stores) { const measured = await ctx.helper(['node', 'scripts/operations/archives.mjs', 'measure', '/source'], [mount(store.name, '/source', true, 'volume')], ['DAC_OVERRIDE']); need(Number.isSafeInteger(measured.totalBytes) && measured.totalBytes >= 0, 'PREPARER_STORE_MEASURE_INVALID'); sourceBytes += measured.totalBytes; }
    const required = BigInt(Math.ceil(sourceBytes * 2.5)) + BigInt(PREPARER_STORE_BOUNDS.minimumHostFreeBytes), space = await (options.statfs ?? fs.statfs)(operationDirectory, { bigint: true }); need(required > 0n && space.bavail * space.bsize >= required, 'PREPARER_STORE_SPACE_INSUFFICIENT'); await ctx.proof('space', { requiredHostBytes: String(required), availableHostBytes: String(space.bavail * space.bsize) });
    // Only the verified Preparer is stopped. SQL, storage, API and web keep running.
    await fixtureScope(fixtureReadyPath, fixtureReadySha256, ctx.request); await assertSourceStoreWriters(scope, ctx.request); stoppedByUs = true; await ctx.request('POST', '/containers/' + scope.source.Id + '/stop?t=45');
    const stopped = await ctx.request('GET', '/containers/' + scope.source.Id + '/json'); need(containerIdentity(stopped) === scope.sourceRow.identity && stopped.State?.Running === false && stopped.State.Pid === 0 && stopped.State.ExitCode === 0 && !stopped.State.OOMKilled, 'PREPARER_STORE_SOURCE_JOIN_UNCONFIRMED');
    for (const store of scope.stores) {
      const current = await ctx.request('GET', '/containers/' + scope.source.Id + '/json'); need(current.State?.Running === false && current.State.Pid === 0 && containerIdentity(current) === scope.sourceRow.identity, 'PREPARER_STORE_SOURCE_CHANGED');
      await assertSourceStoreWriters(scope, ctx.request);
      const name = store.purpose + '.wfcops', result = await ctx.helper(['node', 'scripts/operations/archives.mjs', 'capture', '/source', '/backup/' + name], [mount(store.name, '/source', true, 'volume'), mount(cold, '/backup', false)], ['DAC_OVERRIDE']);
      const report = await verifyArchive(path.join(cold, name), { expectedSha256: result.sha256, signal: options.signal }); need(result.bytes === report.bytes, 'PREPARER_STORE_ARCHIVE_CHANGED'); archives.push({ role: store.purpose, sourceVolume: store.name, file: await pin(path.join(cold, name)), members: report.members, totalBytes: report.totalBytes });
    }
    need(archives.length === 3 && !ctx.uncertain() && ctx.helpers.every(item => item.removed), 'PREPARER_STORE_SNAPSHOT_INCOMPLETE');
  } catch (error) { primary = error; }
  // Source resumption is independent of capture success and uses its exact ID.
  if (scope && stoppedByUs) {
    try { const recovery = await resumeOriginalPreparer({ sourceId: scope.source.Id, expectedIdentity: scope.sourceRow.identity }, ctx.recoveryRequest); resumed = true; await ctx.proof('source-resumed', recovery); } catch (error) { primary ??= error; }
  }
  if (primary) { await writeJsonNew(file('snapshot-failure.private.json'), { status: 'FAIL', code: safeCode(primary), originalPreparerResumed: resumed, uncertainDockerMutation: ctx.uncertain(), creations: ctx.creations, helpers: ctx.helpers }); throw primary; }
  need(resumed, 'PREPARER_STORE_SOURCE_RESUME_UNCONFIRMED'); const result = { schemaVersion: 'wfc.preparer.store-snapshot.v1', status: 'PASS', operationId: owned.operationId, fixtureReady: await pin(fixtureReadyPath), helperImage, companion: await pin(file('companion.private.json')), archives, evidence: ctx.evidence, originalPreparerResumed: true, realAutodeskRequests: 0, restoreQualification: 'NOT_RUN', logicalLoginAndZipProof: 'NOT_RUN' };
  await writeJsonNew(file('snapshot.private.json'), result); await writeJsonNew(file('snapshot-complete.private.json'), { operationId: owned.operationId, snapshot: await pin(file('snapshot.private.json')) }); return { status: 'PASS', operationDirectory, snapshotPath: file('snapshot.private.json'), snapshotSha256: (await pin(file('snapshot.private.json'))).sha256, restoreQualification: 'NOT_RUN' };
}
async function snapshotScope(snapshotPath, snapshotSha256) {
  need(path.isAbsolute(snapshotPath ?? '') && ID.test(snapshotSha256 ?? '') && path.basename(snapshotPath) === 'snapshot.private.json', 'PREPARER_STORE_ARGUMENT_INVALID'); const value = await readJson(snapshotPath, snapshotSha256), directory = path.dirname(snapshotPath), complete = await readJson(path.join(directory, 'snapshot-complete.private.json'));
  need(value.schemaVersion === 'wfc.preparer.store-snapshot.v1' && value.status === 'PASS' && value.originalPreparerResumed === true && value.archives?.length === 3 && STORES.every(role => value.archives.filter(item => item.role === role).length === 1) && same(complete.snapshot, await pin(snapshotPath)) && complete.operationId === value.operationId, 'PREPARER_STORE_SNAPSHOT_INCOMPLETE');
  const owner = await readJson(path.join(directory, 'owner.private.json'));
  need(value.companion?.path === path.join(directory, 'companion.private.json') && owner.operationId === value.operationId && owner.helperImage === value.helperImage && owner.fixtureReadyPath === value.fixtureReady.path && owner.fixtureReadySha256 === value.fixtureReady.sha256 && owner.syntheticOnly === true
    && same(value.companion, await pin(value.companion.path)) && same(value.fixtureReady, await pin(value.fixtureReady.path)), 'PREPARER_STORE_RECEIPT_CHANGED');
  for (const archive of value.archives) need(archive.file.path === path.join(directory, 'cold', archive.role + '.wfcops') && same(archive.file, await pin(archive.file.path)), 'PREPARER_STORE_ARCHIVE_CHANGED');
  for (const evidence of value.evidence ?? []) need(path.dirname(evidence.path) === directory && same(evidence, await pin(evidence.path)), 'PREPARER_STORE_RECEIPT_CHANGED');
  return { snapshot: value, directory, companion: await readJson(value.companion.path, value.companion.sha256) };
}
export async function restorePreparerStores({ snapshotPath, snapshotSha256 }, options = {}) {
  const checked = await snapshotScope(snapshotPath, snapshotSha256), { snapshot, directory, companion } = checked, owned = await ownedDirectory(directory, options.root ?? ROOT); need(owned.operationId === snapshot.operationId && companion.operationId === snapshot.operationId && companion.sourceReady.sha256 === snapshot.fixtureReady.sha256, 'PREPARER_STORE_RECEIPT_CHANGED'); await fs.mkdir(path.join(directory, 'restore'), { mode: 0o700 });
  const ctx = await context(directory, snapshot.operationId, snapshot.helperImage, options, 'restore'), names = storeRecoveryNames(snapshot.operationId); let fence;
  try {
    await fixtureScope(snapshot.fixtureReady.path, snapshot.fixtureReady.sha256, ctx.request); const existing = await ctx.request('GET', '/volumes'); need(!existing.Volumes?.some(item => Object.values(names.volumes).includes(item.Name)), 'PREPARER_STORE_TARGET_EXISTS');
    for (const role of STORES) {
      const intended = { Name: names.volumes[role], Driver: 'local', Labels: labels(snapshot.operationId, 'volume-' + role) }, pending = { kind: 'volumes', name: intended.Name, purpose: role, id: null, state: 'requested' }; ctx.creations.push(pending); await ctx.proof('intent-volume-' + role, intended);
      const made = await ctx.request('POST', '/volumes/create', intended); need(made?.Name === intended.Name, 'PREPARER_STORE_CREATE_UNCONFIRMED'); pending.id = made.Name; pending.state = 'created-unverified'; await ctx.proof('ack-volume-' + role, pending);
      const volume = await ctx.request('GET', '/volumes/' + encodeURIComponent(made.Name)); assertStoreResource(volume, { operationId: snapshot.operationId, name: made.Name, purpose: 'volume-' + role }); need(volume.Driver === 'local' && Object.keys(volume.Options ?? {}).length === 0, 'PREPARER_STORE_VOLUME_CHANGED'); const resource = { name: made.Name, purpose: role, identity: hash(volume) }; ctx.resources.volumes.push(resource); await ctx.proof('created-volume-' + role, resource); pending.state = 'admitted';
      const archive = snapshot.archives.find(item => item.role === role), output = path.join(directory, 'restore', role); await fs.mkdir(output, { mode: 0o700 });
      const restored = await ctx.helper(['node', 'scripts/operations/archives.mjs', 'restore', '/backup/' + role + '.wfcops', '/target', archive.file.sha256], [mount(path.join(directory, 'cold'), '/backup'), mount(made.Name, '/target', false, 'volume')], ['CHOWN', 'FOWNER', 'DAC_OVERRIDE']); need(restored.targetFresh === true && restored.fullOuterHashVerifiedBeforeWrites === true && restored.sha256 === archive.file.sha256, 'PREPARER_STORE_RESTORE_UNVERIFIED');
      const recaptured = await ctx.helper(['node', 'scripts/operations/archives.mjs', 'capture', '/source', '/backup/' + role + '.wfcops'], [mount(made.Name, '/source', true, 'volume'), mount(output, '/backup', false)], ['DAC_OVERRIDE']); need(recaptured.sha256 === archive.file.sha256 && same(await hashFile(path.join(output, role + '.wfcops')), { bytes: archive.file.bytes, sha256: archive.file.sha256 }), 'PREPARER_STORE_PRESTART_BYTES_CHANGED'); await ctx.proof('exact-' + role, { source: archive.file, restored: await pin(path.join(output, role + '.wfcops')), exactBeforeStartup: true });
    }
    fence = await ctx.helper(['node', '/operator/preparer-store-recovery.mjs', 'fence', '--root', '/store', '--operation', snapshot.operationId], [mount(HERE, '/operator'), mount(names.volumes.data, '/store', false, 'volume')], ['FOWNER', 'DAC_OVERRIDE']); need(fence.productionFence === true && fence.parentMetadataRestored === true, 'PREPARER_STORE_FENCE_INVALID');
    const fenced = path.join(directory, 'restore', 'fenced'); await fs.mkdir(fenced, { mode: 0o700 }); await ctx.helper(['node', 'scripts/operations/archives.mjs', 'capture', '/source', '/backup/data.wfcops'], [mount(names.volumes.data, '/source', true, 'volume'), mount(fenced, '/backup', false)], ['DAC_OVERRIDE']);
    const before = await verifyArchive(snapshot.archives.find(item => item.role === 'data').file.path), after = await verifyArchive(path.join(fenced, 'data.wfcops')); const delta = compareAuthFenceEntries(before.entries, after.entries, snapshot.operationId); await ctx.proof('auth-fence', { fence, delta, fencedArchive: await pin(path.join(fenced, 'data.wfcops')) });
    const config = clonedPreparerConfiguration(companion.source, { operationId: snapshot.operationId, volumes: names.volumes, networkId: companion.network.id }); const row = await ctx.create(names.container, 'restored', config, companion.source.Image); ctx.resources.containers.push(row); await ctx.request('POST', '/containers/' + row.id + '/start'); const running = await ctx.request('GET', '/containers/' + row.id + '/json'); assertStoreResource(running, { operationId: snapshot.operationId, ...row }); need(running.State?.Running === true && admissionIdentity(running) === row.admission && Object.keys(running.HostConfig.PortBindings ?? {}).length === 0 && Object.keys(running.NetworkSettings?.Networks ?? {}).length === 1 && Object.values(running.NetworkSettings.Networks)[0].NetworkID === companion.network.id, 'PREPARER_STORE_CLONE_CHANGED'); row.identity = containerIdentity(running);
    need(ctx.helpers.every(item => item.removed) && !ctx.uncertain(), 'PREPARER_STORE_RECONCILIATION_REQUIRED');
    const result = { schemaVersion: 'wfc.preparer.store-restore.v1', status: 'PASS', operationId: snapshot.operationId, snapshot: await pin(snapshotPath), resources: ctx.resources, creations: ctx.creations, helpers: ctx.helpers, uncertainDockerMutation: false, evidence: ctx.evidence, alias: names.alias, internalNetworkId: companion.network.id, publicOrigin: 'http://127.0.0.1:5193', originalPreparerId: companion.source.Id, originalInstanceIdPreserved: true, authFence: fence, oldCookieProof: 'NOT_RUN', freshLoginAndCompletedZipProof: 'NOT_RUN', noStartupCloudTaskProof: 'NOT_RUN', realAutodeskRequests: 0 };
    assertRestoreCleanupReceipt(result); await writeJsonNew(path.join(directory, 'restore.private.json'), result); await writeJsonNew(path.join(directory, 'restore-complete.private.json'), { operationId: snapshot.operationId, restore: await pin(path.join(directory, 'restore.private.json')) });
    return { status: 'PASS', operationDirectory: directory, restorePath: path.join(directory, 'restore.private.json'), restoreSha256: (await pin(path.join(directory, 'restore.private.json'))).sha256, containerId: row.id, alias: names.alias, internalNetworkId: companion.network.id, proof: 'root-controlled old-cookie/fresh-login/ZIP/startup checks remain NOT_RUN' };
  } catch (error) { await writeJsonNew(path.join(directory, 'restore-failure.private.json'), { status: 'FAIL', operationId: snapshot.operationId, code: safeCode(error), uncertainDockerMutation: ctx.uncertain(), creations: ctx.creations, resources: ctx.resources, helpers: ctx.helpers, automaticRetry: false }); throw error; }
}
export async function cleanupPreparerRestore({ restorePath, restoreSha256 }, options = {}) {
  need(path.isAbsolute(restorePath ?? '') && path.basename(restorePath) === 'restore.private.json' && ID.test(restoreSha256 ?? ''), 'PREPARER_STORE_ARGUMENT_INVALID'); const receipt = assertRestoreCleanupReceipt(await readJson(restorePath, restoreSha256)), directory = path.dirname(restorePath), owned = await ownedDirectory(directory, options.root ?? ROOT); need(owned.operationId === receipt.operationId, 'PREPARER_STORE_RECEIPT_CHANGED');
  const complete = await readJson(path.join(directory, 'restore-complete.private.json')); need(complete.operationId === receipt.operationId && same(complete.restore, await pin(restorePath)), 'PREPARER_STORE_RESTORE_INCOMPLETE'); await writeJsonNew(path.join(directory, 'cleanup-begin.private.json'), { operationId: receipt.operationId, at: new Date().toISOString() });
  const ctx = await context(directory, receipt.operationId, (await readJson(path.join(directory, 'owner.private.json'))).helperImage, options, 'cleanup');
  try {
    const row = receipt.resources.containers[0], actual = await ctx.request('GET', '/containers/' + row.id + '/json'); assertStoreResource(actual, { operationId: receipt.operationId, ...row }); need(containerIdentity(actual) === row.identity && admissionIdentity(actual) === row.admission, 'PREPARER_STORE_CLONE_CHANGED'); if (actual.State?.Running || actual.State?.Pid !== 0) await ctx.request('POST', '/containers/' + row.id + '/stop?t=45');
    const stopped = await ctx.request('GET', '/containers/' + row.id + '/json'); assertStoreResource(stopped, { operationId: receipt.operationId, ...row }); need(stopped.State?.Running === false && stopped.State.Pid === 0, 'PREPARER_STORE_CLONE_JOIN_UNCONFIRMED'); await ctx.request('DELETE', '/containers/' + row.id + '?v=false');
    const all = await ctx.request('GET', '/containers/json?all=1'); need(!all.some(item => item.Id === row.id), 'PREPARER_STORE_CLEANUP_UNCONFIRMED');
    for (const item of all) { const inspect = await ctx.request('GET', '/containers/' + item.Id + '/json'); need(!inspect.Mounts?.some(mount => mount.Type === 'volume' && receipt.resources.volumes.some(volume => volume.name === mount.Name)), 'PREPARER_STORE_FOREIGN_VOLUME_MOUNT'); }
    for (const volume of receipt.resources.volumes) { const current = await ctx.request('GET', '/volumes/' + encodeURIComponent(volume.name)); assertStoreResource(current, { operationId: receipt.operationId, name: volume.name, purpose: 'volume-' + volume.purpose }); need(hash(current) === volume.identity, 'PREPARER_STORE_VOLUME_CHANGED'); await ctx.request('DELETE', '/volumes/' + encodeURIComponent(volume.name)); }
    const remaining = await ctx.request('GET', '/volumes'); need(!remaining.Volumes?.some(item => receipt.resources.volumes.some(volume => volume.name === item.Name)), 'PREPARER_STORE_CLEANUP_UNCONFIRMED'); await writeJsonNew(path.join(directory, 'cleaned.private.json'), { status: 'PASS', operationId: receipt.operationId, restoredContainerAndVolumesRemoved: true, archivesRetained: true }); return { status: 'PASS', operationDirectory: directory, restoredContainerAndVolumesRemoved: true, archivesRetained: true };
  } catch (error) { await writeJsonNew(path.join(directory, 'cleanup-failure.private.json'), { status: 'FAIL', operationId: receipt.operationId, code: safeCode(error), automaticRetry: false }); throw error; }
}
export async function main(args) {
  let result;
  if (args.length === 5 && args[0] === 'fence' && args[1] === '--root' && args[2] === '/store' && args[3] === '--operation') result = await fenceRestoredLogin({ directory: args[2], operationId: args[4] });
  else if (args.length === 9 && args[0] === 'capture' && args[1] === '--operation' && args[3] === '--ready' && args[5] === '--ready-sha256' && args[7] === '--helper-image') result = await capturePreparerStores({ operationDirectory: args[2], fixtureReadyPath: args[4], fixtureReadySha256: args[6], helperImage: args[8] });
  else if (args.length === 5 && args[0] === 'restore' && args[1] === '--snapshot' && args[3] === '--sha256') result = await restorePreparerStores({ snapshotPath: args[2], snapshotSha256: args[4] });
  else if (args.length === 5 && args[0] === 'cleanup' && args[1] === '--restore' && args[3] === '--sha256') result = await cleanupPreparerRestore({ restorePath: args[2], restoreSha256: args[4] });
  else need(false, 'PREPARER_STORE_ARGUMENT_INVALID');
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { console.log(JSON.stringify({ status: 'FAIL', code: safeCode(error) })); process.exitCode = 1; });
