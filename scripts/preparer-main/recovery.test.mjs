import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { validateRecoveryArguments, recoveryResourceNames, assertOwnedRecoveryResource, assertStoppedRecoveryClone, recoveryCloneWitness, assertRecoveryPostgres, verifiedPostgresDataIdentity, assertRecoveryMinio, validateModelAuditSummary, waitRecoveryMinio, verifyColdSeed, qualifyRecoveredSeed, captureCloneDatabase } from './recovery.mjs';
import { canonicalSha256 } from './offline-seed.mjs';
import { hashFile } from './foundation/archives.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const id = n => String(n).padStart(64, '0'), image = n => 'sha256:' + id(n);
const sha = value => createHash('sha256').update(value).digest('hex');
const pin = async filename => ({ path: filename, ...await hashFile(filename) });
const write = (filename, value) => fs.writeFile(filename, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
async function temporary(t) { const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'preparer-sp1-recovery-test-')); t.after(async () => { assert.equal(path.dirname(directory), parent); await fs.rm(directory, { recursive: true, force: true }); }); return directory; }
function argumentFixture() { const operationId = randomUUID(); return { seedPath: path.resolve('private-seed/seed.private.json'), seedSha256: id(1), operationDirectory: path.resolve('sp1-recovery-' + operationId), captureImage: image(2) }; }
function resourceFixture() {
  const operationId = randomUUID(), names = recoveryResourceNames(operationId), expected = { operationId, seedSha256: id(4), purpose: 'physical', name: names.physical, image: image(9), volume: names.physical, networkId: id(8) };
  const value = { Id: id(5), Name: '/' + names.physical, Image: expected.image, Config: { Labels: { 'wfc.preparer.sp1.operation': operationId, 'wfc.preparer.sp1.seed': expected.seedSha256, 'wfc.preparer.sp1.purpose': expected.purpose } }, HostConfig: { PublishAllPorts: false, PortBindings: {}, RestartPolicy: { Name: 'no' } }, Mounts: [{ Type: 'volume', Name: names.physical, Destination: '/var/lib/postgresql', RW: true }], NetworkSettings: { Networks: { [names.network]: { NetworkID: expected.networkId } } } };
  return { value, expected, names };
}

test('recovery requires exact immutable pins and a new operation namespace', () => {
  const args = argumentFixture(); assert.equal(validateRecoveryArguments(args).captureImage, args.captureImage);
  for (const mutate of [v => v.captureImage = 'postgres:latest', v => v.seedSha256 = 'unverified', v => v.operationDirectory = path.resolve('5191'), v => v.extra = true, v => v.seedPath = 'relative']) { const changed = { ...args }; mutate(changed); assert.throws(() => validateRecoveryArguments(changed)); }
});
test('verified PGDATA admits its exact non-root UID with primary GID zero, not parent ownership', () => {
  const pgdata = '/var/lib/postgresql/18/docker', entries = [
    { path: '', type: 'directory', uid: 999, gid: 999, mode: 0o1777 },
    { path: '18', type: 'directory', uid: 0, gid: 0, mode: 0o755 },
    { path: '18/docker', type: 'directory', uid: 999, gid: 0, mode: 0o700 },
    { path: '18/docker/PG_VERSION', type: 'file', uid: 999, gid: 999, mode: 0o600 },
  ];
  assert.deepEqual(verifiedPostgresDataIdentity(pgdata, entries), { pgdata, uid: 999, gid: 0, user: '999:0' });
  const ordinary = structuredClone(entries); ordinary[2].gid = 999;
  assert.equal(verifiedPostgresDataIdentity(pgdata, ordinary).user, '999:999');
});
test('PGDATA identity rejects root UID, malformed IDs, aliases and missing exact version evidence', () => {
  const pgdata = '/var/lib/postgresql/18/docker', base = [{ path: '18/docker', type: 'directory', uid: 999, gid: 0 }, { path: '18/docker/PG_VERSION', type: 'file' }];
  for (const [field, values] of [['uid', [0, -1, 0.5, '999', undefined, 0xffffffff]], ['gid', [-1, -0, 0.5, '0', undefined, 0xffffffff]]]) {
    for (const value of values) { const entries = structuredClone(base); entries[0][field] = value;
      assert.throws(() => verifiedPostgresDataIdentity(pgdata, entries), { code: 'SP1_RECOVERY_PGDATA_UNVERIFIED' }); }
  }
  for (const mutate of [v => v[0].type = 'symlink', v => v[0].path = '18', v => v.pop(), v => v[1].type = 'directory']) {
    const entries = structuredClone(base); mutate(entries); assert.throws(() => verifiedPostgresDataIdentity(pgdata, entries), { code: 'SP1_RECOVERY_PGDATA_UNVERIFIED' });
  }
});
test('fresh names partition every operation without source or published-port names', () => {
  const a = recoveryResourceNames(randomUUID()), b = recoveryResourceNames(randomUUID()); assert.equal(new Set([...Object.values(a), ...Object.values(b)]).size, 6);
  assert.throws(() => recoveryResourceNames('wfc_app'));
  assert.ok(Object.values(a).every(value => value.startsWith('wfc-preparer-sp1-') && !value.includes('5191')));
});
test('model audit is explicitly optional and never adds default fields to historical arguments or names', () => {
  const args = argumentFixture(), plain = validateRecoveryArguments(args);
  assert.equal(Object.hasOwn(plain, 'modelAudit'), false); assert.equal(Object.hasOwn(recoveryResourceNames(plain.operationId), 'minio'), false);
  const audited = validateRecoveryArguments({ ...args, modelAudit: true }); assert.equal(audited.modelAudit, true);
  const names = recoveryResourceNames(audited.operationId, { modelAudit: true }); assert.equal(new Set(Object.values(names)).size, 4);
  assert.match(names.minio, /^wfc-preparer-sp1-[a-f0-9-]{36}-minio$/);
  for (const modelAudit of ['true', 1, null, {}]) assert.throws(() => validateRecoveryArguments({ ...args, modelAudit }), { code: 'SP1_RECOVERY_ARGUMENT_INVALID' });
});
test('MinIO audit clone requires exact identity, command, owner, user, volume, private network and no ports', () => {
  const operationId = randomUUID(), names = recoveryResourceNames(operationId, { modelAudit: true });
  const expected = { id: id(70), image: image(71), volume: names.minio, networkId: id(72), operationId, seedSha256: id(73), name: names.minio, user: '1000:1000' };
  const value = { Id: expected.id, Name: '/' + names.minio, Image: expected.image,
    Config: { User: expected.user, Cmd: ['minio', 'server', '/data', '--address', ':9000', '--console-address', ':9001'], Labels: { 'wfc.preparer.sp1.operation': operationId, 'wfc.preparer.sp1.seed': expected.seedSha256, 'wfc.preparer.sp1.purpose': 'minio' } },
    HostConfig: { PublishAllPorts: false, PortBindings: {}, RestartPolicy: { Name: 'no' } }, Mounts: [{ Type: 'volume', Name: names.minio, Destination: '/data', RW: true }],
    NetworkSettings: { Networks: { [names.network]: { NetworkID: expected.networkId } } } };
  assert.equal(assertRecoveryMinio(value, expected), value);
  for (const mutate of [v => v.Id = id(99), v => v.Image = image(99), v => v.Config.User = '0', v => v.Config.Cmd = ['server', '/data'],
    v => v.HostConfig.PortBindings = { '9000/tcp': [{ HostPort: '9000' }] }, v => v.HostConfig.PublishAllPorts = true,
    v => v.Mounts[0].Name = 'source-minio', v => v.Mounts[0].RW = false, v => v.Mounts.push({ Type: 'bind', Source: 'original' }),
    v => v.NetworkSettings.Networks.extra = { NetworkID: id(99) }]) {
    const changed = structuredClone(value); mutate(changed); assert.throws(() => assertRecoveryMinio(changed, expected), { code: 'SP1_RECOVERY_MINIO_CHANGED' });
  }
});
test('audit receipt requires complete read-only PASS facts without private connection data', () => {
  const value = { status: 'PASS', readOnly: true, archivesSchema: 'ABSENT_OLD_SCHEMA', reportBytes: 100, reportSha256: id(80),
    counts: { models: 2, resources: 6, resourceBytes: 500, archives: 0, archiveBytes: 0, legacyArchiveAbsent: 2, retainedIndependentArchives: 0, unavailableDeclarations: 0 } };
  assert.equal(validateModelAuditSummary(value), value);
  for (const mutate of [v => v.status = 'FAIL', v => v.readOnly = false, v => v.reportSha256 = 'unverified', v => v.counts.models = -1,
    v => delete v.counts.archives, v => v.privateReportPath = 'private', v => v.password = 'secret']) {
    const changed = structuredClone(value); mutate(changed); assert.throws(() => validateModelAuditSummary(changed), { code: 'SP1_RECOVERY_MODEL_AUDIT_INVALID' });
  }
});
test('MinIO readiness cannot contact source/foreign hosts and uses only the owned fixed health endpoint', async () => {
  const ownerId = randomUUID(), host = recoveryResourceNames(ownerId, { modelAudit: true }).minio;
  for (const denied of ['host.docker.internal', 'localhost', 'wfc-minio', recoveryResourceNames(randomUUID(), { modelAudit: true }).minio]) {
    await assert.rejects(waitRecoveryMinio({ host: denied, ownerId }, { request() { throw Error('must not contact'); } }), { code: 'SP1_RECOVERY_MINIO_HOST_INVALID' });
  }
  let calls = 0;
  const result = await waitRecoveryMinio({ host, ownerId }, { request(options, callback) {
    calls++; assert.equal(options.hostname, host); assert.equal(options.port, 9000); assert.equal(options.path, '/minio/health/ready'); assert.equal(options.method, 'GET'); assert.equal(options.headers, undefined);
    const req = new EventEmitter(); req.destroy = () => {}; req.end = () => { queueMicrotask(() => { const res = new PassThrough(); res.statusCode = 200; callback(res); res.end(); }); }; return req;
  } });
  assert.equal(result.status, 'PASS'); assert.equal(calls, 1);
});
test('full owned resource labels are mandatory for capture and deletion', () => {
  const { value, expected } = resourceFixture(); assert.equal(assertOwnedRecoveryResource(value, expected), value);
  for (const field of ['wfc.preparer.sp1.operation', 'wfc.preparer.sp1.seed', 'wfc.preparer.sp1.purpose']) { const changed = structuredClone(value); delete changed.Config.Labels[field]; assert.throws(() => assertOwnedRecoveryResource(changed, expected), { code: 'SP1_RECOVERY_OWNERSHIP_LOST' }); }
  const changed = structuredClone(value); changed.Name = '/wfc_app'; assert.throws(() => assertOwnedRecoveryResource(changed, expected));
});
test('PostgreSQL clone admits one exact image and volume, one isolated network and no ports', () => {
  const { value, expected } = resourceFixture(); assert.equal(assertRecoveryPostgres(value, expected), value);
  const mutations = [v => v.Image = image(99), v => v.HostConfig.PublishAllPorts = true, v => v.HostConfig.PortBindings = { '5432/tcp': [{ HostPort: '5434' }] }, v => v.HostConfig.RestartPolicy.Name = 'always', v => v.Mounts[0].Name = 'original-main-volume', v => v.Mounts[0].RW = false, v => v.Mounts.push({ Type: 'bind', Source: '/source' }), v => v.NetworkSettings.Networks.extra = { NetworkID: id(99) }, v => Object.values(v.NetworkSettings.Networks)[0].NetworkID = id(99)];
  for (const mutate of mutations) { const changed = structuredClone(value); mutate(changed); assert.throws(() => assertRecoveryPostgres(changed, expected), { code: 'SP1_RECOVERY_CLONE_CHANGED' }); }
});
test('stopped PG and MinIO clones admit Engine-omitted ReadOnly or explicit false only with effective RW', () => {
  for (const purpose of ['physical', 'minio']) {
    const operationId = randomUUID(), names = recoveryResourceNames(operationId, { modelAudit: true }), name = names[purpose], destination = purpose === 'minio' ? '/data' : '/var/lib/postgresql';
    const expected = { id: id(90), image: image(91), volume: name, destination, networkId: id(92), operationId, seedSha256: id(93), purpose, name };
    const value = { Id: expected.id, Name: '/' + name, Image: expected.image,
      Config: { User: '999:0', Entrypoint: [], Labels: { 'wfc.preparer.sp1.operation': operationId, 'wfc.preparer.sp1.seed': expected.seedSha256, 'wfc.preparer.sp1.purpose': purpose } },
      State: { Status: 'created', Running: false, Restarting: false, Pid: 0 },
      HostConfig: { NetworkMode: expected.networkId, PortBindings: {}, PublishAllPorts: false, RestartPolicy: { Name: 'no' }, Mounts: [{ Type: 'volume', Source: name, Target: destination }] },
      Mounts: [{ Type: 'volume', Name: name, Destination: destination, RW: true }] };
    assert.equal(Object.hasOwn(value.HostConfig.Mounts[0], 'ReadOnly'), false);
    assert.equal(assertStoppedRecoveryClone(value, expected), value);
    const explicit = structuredClone(value); explicit.HostConfig.Mounts[0].ReadOnly = false; assert.equal(assertStoppedRecoveryClone(explicit, expected), explicit);
    const code = purpose === 'minio' ? 'SP1_RECOVERY_MINIO_CHANGED' : 'SP1_RECOVERY_CLONE_CHANGED';
    for (const invalid of [true, null, 0, 'false', undefined]) {
      const changed = structuredClone(value); changed.HostConfig.Mounts[0].ReadOnly = invalid;
      assert.throws(() => assertStoppedRecoveryClone(changed, expected), { code });
    }
    for (const mutate of [v => v.Mounts[0].RW = false, v => v.Mounts[0].Name = 'source-data', v => v.HostConfig.NetworkMode = names.network,
      v => v.HostConfig.Mounts[0].Source = 'source-data', v => v.HostConfig.PortBindings = { '5432/tcp': [{ HostPort: '5434' }] }, v => v.State.Running = true]) {
      const changed = structuredClone(value); mutate(changed); assert.throws(() => assertStoppedRecoveryClone(changed, expected), { code });
    }
  }
});
test('private clone witnesses retain omission and identity facts while excluding Env, command and foreign secrets', () => {
  const value = { Id: id(95), Name: '/owned-clone', Image: image(96),
    Config: { User: '999:0', Entrypoint: [], Env: ['MINIO_ROOT_PASSWORD=PRIVATE_ENV_SECRET'], Cmd: ['PRIVATE_COMMAND_SECRET'], Labels: { secret: 'PRIVATE_LABEL_SECRET', 'wfc.preparer.sp1.purpose': 'physical' } },
    HostConfig: { NetworkMode: id(97), Mounts: [{ Type: 'volume', Source: 'owned-volume', Target: '/var/lib/postgresql' }], LogConfig: { secret: 'PRIVATE_LOG_SECRET' } },
    Mounts: [{ Type: 'volume', Name: 'owned-volume', Destination: '/var/lib/postgresql', RW: true }],
    NetworkSettings: { Networks: { owned: { NetworkID: id(97), EndpointID: id(98) } } },
    State: { Running: false, Pid: 0, ExitCode: 0, Error: 'PRIVATE_FOREIGN_ERROR' } };
  const witness = recoveryCloneWitness(value);
  assert.doesNotMatch(JSON.stringify(witness), /PRIVATE|Env|Cmd|LogConfig/);
  assert.equal(witness.Config.User, '999:0'); assert.deepEqual(witness.Config.Entrypoint, []);
  assert.equal(witness.HostConfig.Mounts[0].readOnlyPresent, false); assert.equal(Object.hasOwn(witness.HostConfig.Mounts[0], 'ReadOnly'), false);
  assert.equal(witness.Mounts[0].RW, true); assert.equal(witness.Networks.owned.NetworkID, id(97)); assert.equal(witness.State.Pid, 0);
  value.HostConfig.Mounts[0].ReadOnly = false;
  assert.equal(recoveryCloneWitness(value).HostConfig.Mounts[0].readOnlyPresent, true);
});

async function seedFixture(t) {
  const parent = await temporary(t), directory = path.join(parent, 'seed'), operationId = randomUUID(); await fs.mkdir(directory);
  // Read only the configured immutable helper identity for fixture construction;
  // its value changes when root builds the separately reviewed PG archive fork.
  const operator = await fs.readFile(path.join(HERE, 'offline-seed.mjs'), 'utf8'), helper = operator.match(/const HELPER = '(sha256:[a-f0-9]{64})'/)?.[1]; assert.ok(helper);
  const roles = Object.fromEntries(['api', 'web', 'postgres', 'minio'].map((role, index) => [role, { id: id(index + 10), image: image(index + 20), configSha256: canonicalSha256({ fixture: role }), hostConfigSha256: id(30 + index), mountsSha256: id(40 + index), networksSha256: id(50 + index) }]));
  const intent = { schemaVersion: 'wfc.preparer.offline-seed-intent.v1', operationId, source: { port: 5180, composeProject: 'wfc-app', roles, database: { host: 'host.docker.internal', port: 5434, name: 'wfc_app' }, minio: { host: 'host.docker.internal', port: 9000 }, stagingDestination: '/var/lib/wfc/model-imports' }, helperImage: helper, privateCompanion: path.join(parent, 'companion.private.json'), excluded: { containerIds: [], volumeNames: [], bindPaths: [] } };
  const intentPath = path.join(parent, 'intent.private.json'); await write(intentPath, intent);
  await write(intent.privateCompanion, { schemaVersion: 'wfc.preparer.offline-seed-private.v1', operationId, roles: Object.fromEntries(Object.entries(roles).map(([role, row]) => [role, { id: row.id, image: row.image, config: { fixture: role } }])) });
  const archives = [], images = [];
  for (const role of ['postgres', 'minio', 'staging']) { const filename = path.join(directory, role + '.wfcops'); await fs.writeFile(filename, 'synthetic archive ' + role); archives.push({ role, file: await pin(filename), members: 2, files: 1, totalBytes: 32 }); }
  for (const role of ['api', 'web', 'postgres', 'minio', 'helper']) { const filename = path.join(directory, role + '-image.tar'); await fs.writeFile(filename, 'synthetic exported image ' + role); images.push({ role, id: role === 'helper' ? helper : roles[role].image, file: await pin(filename) }); }
  const sourceClosure = []; for (const name of ['offline-seed.mjs', 'foundation/docker.mjs', 'foundation/docker-bounds.mjs', 'foundation/archives.mjs', 'foundation/manifest.mjs', 'foundation/provenance.json']) sourceClosure.push(await pin(path.join(HERE, name)));
  const resumePath = path.join(directory, 'resume.private.json'); await write(resumePath, { status: 'PASS', originalPostgresRemainsStopped: true });
  const seed = { schemaVersion: 'wfc.preparer.offline-seed.v1', status: 'PASS', operationId, sourcePort: 5180, qualification: 'NOT_RUN', releasableBackup: false, verifierMode: 'production-default', finalizationMode: 'production-default', productionSeed: true, archives, images, sourceClosure, evidence: [], intent: await pin(intentPath), privateCompanion: await pin(intent.privateCompanion), sourceResume: await pin(resumePath) };
  const seedPath = path.join(directory, 'seed.private.json'); await write(seedPath, seed);
  const releasedPath = path.join(directory, 'source-lock-released.private.json'), sourceLockPath = path.join(parent, 'original-source-lock'); await write(releasedPath, { operationId, fixture: true });
  const sourcePin = { ...await pin(releasedPath), path: sourceLockPath };
  const complete = { schemaVersion: 'wfc.preparer.offline-seed-complete.v2', operationId, productionSeed: true, sourceLockReleased: false, seed: await pin(seedPath), sourceLockRelease: { state: 'pending', source: sourcePin, archivedPath: releasedPath } };
  const completePath = path.join(directory, 'complete.private.json'); await write(completePath, complete);
  return { parent, directory, seed, seedPath, complete, completePath, sourceLockPath, releasedPath, seedSha256: (await pin(seedPath)).sha256 };
}
test('complete production cold receipt verifies all stored and operator hashes without Docker', async t => {
  const f = await seedFixture(t), result = await verifyColdSeed(f.seedPath, f.seedSha256); assert.equal(result.seed.operationId, f.seed.operationId); assert.equal(result.seed.releasableBackup, false);
});
test('missing terminal receipt cannot become a recovery seed', async t => { const f = await seedFixture(t); await fs.unlink(f.completePath); await assert.rejects(verifyColdSeed(f.seedPath, f.seedSha256)); });
test('test-injected and incomplete seed claims are refused before any Docker operation', async t => {
  const f = await seedFixture(t); f.seed.productionSeed = false; await fs.writeFile(f.seedPath, JSON.stringify(f.seed));
  let touched = false; await assert.rejects(qualifyRecoveredSeed({ ...argumentFixture(), seedPath: f.seedPath, seedSha256: (await pin(f.seedPath)).sha256 }, { docker: { containers() { touched = true; throw Error('unexpected'); } } }), { code: 'SP1_PRODUCTION_COLD_SEED_REQUIRED' }); assert.equal(touched, false);
});
test('source lock release must have exact archived bytes and its original name must be absent', async t => {
  const f = await seedFixture(t); await fs.writeFile(f.sourceLockPath, 'foreign source operation'); await assert.rejects(verifyColdSeed(f.seedPath, f.seedSha256), { code: 'SP1_SOURCE_LOCK_BUSY' });
  await fs.unlink(f.sourceLockPath); await fs.writeFile(f.releasedPath, 'changed lock'); await assert.rejects(verifyColdSeed(f.seedPath, f.seedSha256), { code: 'SP1_SOURCE_LOCK_RELEASE_UNCONFIRMED' });
});
test('changed source archive content is not accepted on receipt name or historical PASS', async t => { const f = await seedFixture(t); await fs.writeFile(f.seed.archives[0].file.path, 'different bytes'); await assert.rejects(verifyColdSeed(f.seedPath, f.seedSha256), { code: 'SP1_RECOVERY_FILE_CHANGED' }); });
test('cold receipt cannot substitute images or put archives outside its private directory', async t => {
  const f = await seedFixture(t); f.seed.images[0].id = image(999); await fs.writeFile(f.seedPath, JSON.stringify(f.seed)); f.complete.seed = await pin(f.seedPath); await fs.writeFile(f.completePath, JSON.stringify(f.complete));
  await assert.rejects(verifyColdSeed(f.seedPath, f.complete.seed.sha256), { code: 'SP1_COLD_SEED_IMAGE_CHANGED' });
  f.seed.images[0].id = (await verifyIntent(f.seed.intent.path)).source.roles.api.image; f.seed.archives[0].file.path = path.join(f.parent, 'outside.wfcops'); await fs.writeFile(f.seedPath, JSON.stringify(f.seed)); f.complete.seed = await pin(f.seedPath); await fs.writeFile(f.completePath, JSON.stringify(f.complete));
  await assert.rejects(verifyColdSeed(f.seedPath, f.complete.seed.sha256), { code: 'SP1_COLD_SEED_SCOPE_INVALID' });
});
async function verifyIntent(filename) { return JSON.parse(await fs.readFile(filename, 'utf8')); }
test('source companion credential/config bytes and source operator closure are pinned', async t => {
  const f = await seedFixture(t); await fs.appendFile(f.seed.privateCompanion.path, ' '); await assert.rejects(verifyColdSeed(f.seedPath, f.seedSha256), { code: 'SP1_RECOVERY_FILE_CHANGED' });
});
test('a falsified source-resume claim is refused even when its own pin is refreshed', async t => {
  const f = await seedFixture(t); await fs.writeFile(f.seed.sourceResume.path, JSON.stringify({ status: 'PASS', originalPostgresRemainsStopped: false })); f.seed.sourceResume = await pin(f.seed.sourceResume.path); await fs.writeFile(f.seedPath, JSON.stringify(f.seed)); f.complete.seed = await pin(f.seedPath); await fs.writeFile(f.completePath, JSON.stringify(f.complete));
  await assert.rejects(verifyColdSeed(f.seedPath, f.complete.seed.sha256), { code: 'SP1_SOURCE_RESUME_UNCONFIRMED' });
});

async function connectionFixture(t, changes = {}) {
  const parent = await temporary(t), ownerId = randomUUID(), connectionPath = path.join(parent, 'connection.private.json'), directory = path.join(parent, 'capture');
  await write(connectionPath, { host: recoveryResourceNames(ownerId).physical, port: 5432, user: 'fixture', password: 'PRIVATE_CLONE_PASSWORD', database: 'wfc_app', ...changes });
  return { parent, ownerId, connectionPath, directory };
}
test('capture refuses a main/PF/source host or wrong owner before constructing a pool', async t => {
  for (const host of ['host.docker.internal', '127.0.0.1', 'wfc_app', recoveryResourceNames(randomUUID()).physical]) {
    const f = await connectionFixture(t, { host }); let constructed = false;
    await assert.rejects(captureCloneDatabase(f, { poolFactory() { constructed = true; throw Error('must not connect'); } }), { code: 'SP1_CAPTURE_CONNECTION_SCOPE' }); assert.equal(constructed, false);
  }
});
test('capture refuses different database/port or extra connection metadata before SQL', async t => {
  for (const changes of [{ database: 'postgres' }, { port: 5434 }, { ssl: false }, { password: '' }]) { const f = await connectionFixture(t, changes); await assert.rejects(captureCloneDatabase(f, { poolFactory() { throw Error('must not connect'); } }), { code: 'SP1_CAPTURE_CONNECTION_SCOPE' }); }
});
test('capture checks current database and zero foreign clients before inventory and closes its pool', async t => {
  for (const row of [{ name: 'wfc_app', others: '1' }, { name: 'other_database', others: '0' }]) {
    const f = await connectionFixture(t), queries = []; let closed = false;
    await assert.rejects(captureCloneDatabase(f, { poolFactory: () => ({ async query(query) { queries.push(query.text); return { rows: [row] }; }, async end() { closed = true; } }) }), { code: 'SP1_CAPTURE_FOREIGN_DATABASE_CLIENT' });
    assert.equal(closed, true); assert.equal(queries.length, 1); assert.match(queries[0], /pg_stat_activity/); assert.deepEqual(await fs.readdir(f.directory), []);
  }
});
test('an existing capture target is never emptied or overwritten and its pool closes', async t => {
  const f = await connectionFixture(t); await fs.mkdir(f.directory); await fs.writeFile(path.join(f.directory, 'retained.private.json'), 'retained'); let closed = false;
  await assert.rejects(captureCloneDatabase(f, { poolFactory: () => ({ query() { throw Error('must not run'); }, async end() { closed = true; } }) }));
  assert.equal(closed, true); assert.equal(await fs.readFile(path.join(f.directory, 'retained.private.json'), 'utf8'), 'retained');
});
test('copied inventory leaves retain exact source provenance; recipe uses supplied local image aliases', async () => {
  const provenance = JSON.parse(await fs.readFile(path.join(HERE, 'recovery-leaves/provenance.json'), 'utf8')); assert.equal(provenance.mode, 'exact-byte-copy');
  for (const item of provenance.files) assert.deepEqual(await hashFile(path.join(HERE, 'recovery-leaves', item.path)), { bytes: item.bytes, sha256: item.sha256 });
  const recipe = await fs.readFile(path.join(HERE, 'recovery.capture.Dockerfile'), 'utf8'); assert.match(recipe, /FROM \$\{WFC_API_IMAGE\} AS dependencies/); assert.match(recipe, /COPY --from=dependencies \/app\/node_modules \/app\/node_modules/); assert.doesNotMatch(recipe, /RUN|npm install|FROM postgres|latest/);
});
