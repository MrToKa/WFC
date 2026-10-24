import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { validateUpgradeArguments, upgradeResourceNames, upgradeResourceIntents, validateUpgradeResourceCleanup, assertUpgradeResource, assertUpgradeContainer, rewriteUpgradeEnvironment, assertArchiveContractSource,
  assertCandidateRevision, normalizeArchiveTempContract, normalizeArchiveTempDefinitions, validateArchiveAddition, projectOldTables, captureUpgradeClone, probeUpgrade, verifyUpgradeQualification } from './upgrade-preflight.mjs';
import { hashFile } from './foundation/archives.mjs';
import { currentInventoryCanonicalHash as digest, currentInventorySchemaMetadata, currentInventoryFrame, compareCurrentInventories } from './recovery-leaves/current-inventory-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const id = n => String(n).padStart(64, '0'), image = n => 'sha256:' + id(n), revision = '543ae7a889fbf1abbf4937f5f83b2c6ee1b91ff4';
const hash = bytes => createHash('sha256').update(bytes).digest('hex'), pin = async filename => ({ path: filename, ...await hashFile(filename) });
const write = (filename, value) => fs.writeFile(filename, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
async function temporary(t) { const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'preparer-upgrade-test-')); t.after(async () => { assert.equal(path.dirname(root), parent); await fs.rm(root, { recursive: true, force: true }); }); return root; }
const argumentsFixture = () => ({ operationDirectory: path.resolve('sp6-upgrade-' + randomUUID()), seedPath: path.resolve('private-seed/seed.private.json'), seedSha256: id(1), candidateApiImage: image(2), captureImage: image(3), productRevision: revision });
function cloneFixture() {
  const operationId = randomUUID(), names = upgradeResourceNames(operationId), expected = { operationId, seedSha256: id(4), purpose: 'postgres', name: names.postgres, id: id(5), image: image(6), volume: names.postgres, destination: '/var/lib/postgresql', networkId: id(7) };
  const value = { Id: expected.id, Name: '/' + expected.name, Image: expected.image, Config: { Labels: { 'wfc.preparer.upgrade.operation': operationId, 'wfc.preparer.upgrade.seed': expected.seedSha256, 'wfc.preparer.upgrade.purpose': 'postgres' } },
    State: { Running: false, Restarting: false, Pid: 0 }, HostConfig: { NetworkMode: expected.networkId, RestartPolicy: { Name: 'no' }, PortBindings: {}, PublishAllPorts: false,
      Mounts: [{ Type: 'volume', Source: expected.volume, Target: expected.destination }] }, Mounts: [{ Type: 'volume', Name: expected.volume, Destination: expected.destination, RW: true }],
    NetworkSettings: { Networks: { own: { NetworkID: expected.networkId } } } };
  return { value, expected, names };
}
test('upgrade requires exact cold/image pins, a new operation and an explicit frozen product revision', () => {
  const args = argumentsFixture(); assert.equal(validateUpgradeArguments(args).productRevision, revision);
  for (const mutate of [v => delete v.productRevision, v => v.productRevision = 'HEAD', v => v.candidateApiImage = 'latest', v => v.seedPath = 'relative', v => v.operationDirectory = path.resolve('5191'), v => v.extra = true]) {
    const changed = { ...args }; mutate(changed); assert.throws(() => validateUpgradeArguments(changed));
  }
});
test('every upgrade resource has a new own namespace and a bounded DNS label', () => {
  const a = upgradeResourceNames(randomUUID()), b = upgradeResourceNames(randomUUID());
  assert.equal(new Set([...Object.values(a), ...Object.values(b)]).size, 12);
  assert.ok(Object.values(a).every(name => name.length <= 63 && name.startsWith('wfc-preparer-sp6-')));
  assert.throws(() => upgradeResourceNames('wfc_app'));
});
test('cleanup must prove every intended resource absent even when create acknowledgement failed admission', () => {
  const operationId = randomUUID(), intents = upgradeResourceIntents(operationId);
  assert.equal(intents.length, 8); assert.equal(intents.filter(value => value.kind === 'volume').length, 3);
  assert.equal(intents.filter(value => value.kind === 'container').length, 4);
  const complete = intents.map(value => ({ ...value, state: 'confirmed-absent' }));
  assert.equal(validateUpgradeResourceCleanup(operationId, complete), true);
  const pending = structuredClone(complete), volume = pending.find(value => value.kind === 'volume' && value.role === 'staging');
  volume.state = 'acknowledged'; volume.acknowledgedName = volume.name;
  assert.throws(() => validateUpgradeResourceCleanup(operationId, pending), { code: 'UPGRADE_RESOURCE_REMOVAL_UNCONFIRMED' });
  assert.throws(() => validateUpgradeResourceCleanup(operationId, complete.filter(value => value !== complete[0])), { code: 'UPGRADE_RESOURCE_REMOVAL_UNCONFIRMED' });
  const duplicate = structuredClone(complete); duplicate[0] = duplicate[1];
  assert.throws(() => validateUpgradeResourceCleanup(operationId, duplicate), { code: 'UPGRADE_RESOURCE_REMOVAL_UNCONFIRMED' });
  assert.throws(() => validateUpgradeResourceCleanup(randomUUID(), complete), { code: 'UPGRADE_RESOURCE_REMOVAL_UNCONFIRMED' });
});
test('optional candidate image revision labels cannot contradict the pinned frozen product', () => {
  assert.doesNotThrow(() => assertCandidateRevision({ Config: {} }, revision));
  assert.doesNotThrow(() => assertCandidateRevision({ Config: { Labels: { 'wfc.preparer.product-revision': revision } } }, revision));
  assert.throws(() => assertCandidateRevision({ Config: { Labels: { 'org.opencontainers.image.revision': '0'.repeat(40) } } }, revision), { code: 'UPGRADE_PRODUCT_REVISION_MISMATCH' });
});
test('fresh clone ownership and effective mounts reject source replacement, ports and foreign networks', () => {
  const { value, expected } = cloneFixture(); assert.equal(assertUpgradeResource(value, expected), value); assert.equal(assertUpgradeContainer(value, expected, { stopped: true }), value);
  const explicit = structuredClone(value); explicit.HostConfig.Mounts[0].ReadOnly = false; assert.equal(assertUpgradeContainer(explicit, expected), explicit);
  for (const mutate of [v => v.Id = id(99), v => v.Image = image(99), v => v.Mounts[0].Name = 'source-volume', v => v.Mounts[0].RW = false,
    v => v.HostConfig.Mounts[0].ReadOnly = true, v => v.HostConfig.Mounts[0].ReadOnly = null, v => v.HostConfig.Mounts[0].ReadOnly = 'false',
    v => v.HostConfig.PortBindings = { '5432/tcp': [{ HostPort: '5434' }] }, v => v.HostConfig.NetworkMode = 'bridge']) {
    const changed = structuredClone(value); mutate(changed); assert.throws(() => assertUpgradeContainer(changed, expected), { code: 'UPGRADE_CONTAINER_CHANGED' });
  }
  const foreignNetwork = structuredClone(value); foreignNetwork.NetworkSettings.Networks.extra = { NetworkID: id(99) };
  assert.throws(() => assertUpgradeContainer(foreignNetwork, expected), { code: 'UPGRADE_CONTAINER_NETWORK_CHANGED' });
  const changed = structuredClone(value); delete changed.Config.Labels['wfc.preparer.upgrade.seed']; assert.throws(() => assertUpgradeContainer(changed, expected), { code: 'UPGRADE_RESOURCE_OWNERSHIP_LOST' });
});
test('source API environment is redirected only into its sealed clone and gets fresh login/viewer authority', () => {
  const names = upgradeResourceNames(randomUUID()), source = { Env: ['DATABASE_URL=postgresql://fixture:PRIVATE_PASSWORD@host.docker.internal:5434/wfc_app', 'JWT_SECRET=old-private-secret', 'MINIO_ENDPOINT=host.docker.internal', 'MINIO_ACCESS_KEY=fixture-access', 'MINIO_SECRET_KEY=fixture-secret', 'WFC_MODEL_BUCKET=private-model-fixture', 'MINIO_BUCKET_PROJECTS=project-file-fixture', 'APS_CLIENT_SECRET=PRIVATE_APS', 'WFC_PREPARER_INTERNAL_ORIGIN=http://source', 'UNRELATED_SETTING=unchanged'] };
  const before = structuredClone(source), env = new Map(rewriteUpgradeEnvironment(source, { names, jwtSecret: 'a'.repeat(64) }).map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
  const database = new URL(env.get('DATABASE_URL')); assert.equal(database.hostname, names.postgres); assert.equal(database.port, '5432'); assert.equal(database.pathname, '/wfc_app'); assert.equal(database.password, 'PRIVATE_PASSWORD');
  assert.equal(env.get('MINIO_ENDPOINT'), names.minio); assert.equal(env.get('MINIO_PORT'), '9000'); assert.equal(env.get('MINIO_USE_SSL'), 'false');
  assert.equal(env.get('JWT_SECRET'), 'a'.repeat(64)); assert.equal(env.get('WFC_VIEWER_ALLOWED_ORIGINS'), 'http://127.0.0.1:5180'); assert.equal(env.get('WFC_VIEWER_ALLOW_INSECURE_LAN_HTTP'), 'false');
  assert.equal(env.get('WFC_MODEL_IMPORT_ROOT'), '/var/lib/wfc/model-imports'); assert.equal(env.get('WFC_MODEL_BUCKET'), 'private-model-fixture'); assert.equal(env.get('UNRELATED_SETTING'), 'unchanged');
  assert.equal(env.has('APS_CLIENT_SECRET'), false); assert.equal(env.has('WFC_PREPARER_INTERNAL_ORIGIN'), false); assert.deepEqual(source, before);
  assert.throws(() => rewriteUpgradeEnvironment(source, { names: { ...names, postgres: 'host.docker.internal' }, jwtSecret: 'a'.repeat(64) }), { code: 'UPGRADE_ENVIRONMENT_INVALID' });
  assert.throws(() => rewriteUpgradeEnvironment({ Env: [...source.Env, 'DATABASE_URL=postgresql://fixture:private@source/wfc_app?host=source'] }, { names, jwtSecret: 'a'.repeat(64) }), { code: 'UPGRADE_CONNECTION_INVALID' });
});
test('declared archive table, index and trigger remain tied to the reviewed candidate source', async () => {
  const source = await fs.readFile(path.join(ROOT, 'server', 'modelRegistry', 'schema.ts'), 'utf8'); assert.equal(assertArchiveContractSource(source), true);
  for (const changed of [source.replace('archive_bytes BIGINT NOT NULL CHECK', 'archive_bytes INTEGER NOT NULL CHECK'), source.replace('CREATE INDEX IF NOT EXISTS model_package_archives_version', 'CREATE INDEX IF NOT EXISTS extra_archive_index'), source.replace('CREATE TRIGGER protect_package_archive_ownership', 'CREATE TRIGGER different_trigger')]) {
    assert.throws(() => assertArchiveContractSource(changed), { code: 'UPGRADE_ARCHIVE_CONTRACT_SOURCE_CHANGED' });
  }
});
function definitions() { return { constraints: [], indexes: [], triggers: [], rls: { enabled: false, forced: false, policies: [] } }; }
function metadata(name) {
  const names = name === 'users' ? ['id', 'amount'] : ['import_id', 'project_id', 'model_version_id', 'storage_prefix', 'owner_token', 'archive_sha256', 'archive_bytes', 'published', 'cleaned_at', 'created_at'];
  return { table: name, columns: names.map(column => ({ name: column, type: column === 'amount' ? 'bigint' : 'text', notNull: true, defaultSql: null, collation: null, identity: '', generated: '' })), primaryKey: [names[0]], keyMode: 'primary-key', definitions: definitions() };
}
test('TEMP contract normalizes only its known schema qualifier and temporary persistence', () => {
  const meta = metadata('model_package_archives'); meta.definitions.indexes = [{ name: 'model_package_archives_pkey', definition: 'CREATE UNIQUE INDEX model_package_archives_pkey ON pg_temp_7.model_package_archives USING btree (import_id)', valid: true, ready: true }];
  const names = ['model_package_archives', 'model_package_archives_pkey', 'model_package_archives_storage_prefix_key', 'model_package_archives_version'];
  const actual = normalizeArchiveTempContract(meta, names.map(name => ({ name, persistence: 't' })), 'pg_temp_7');
  assert.match(actual.schema.definitions.indexes[0].definition, /ON public\.model_package_archives/); assert.ok(actual.relations.every(row => row.persistence === 'p'));
  assert.match(meta.definitions.indexes[0].definition, /pg_temp_7/, 'Original expected metadata remains unchanged');
  assert.throws(() => normalizeArchiveTempContract(meta, [{ name: 'foreign', persistence: 't' }], 'pg_temp_7'), { code: 'UPGRADE_ARCHIVE_CONTRACT_INVALID' });
});
test('PostgreSQL pg_temp alias deparser indexes project to the exact declared public contract', () => {
  // Exact index deparser strings retained from the failed 553411f6 attempt.
  const temporary = [
    'CREATE UNIQUE INDEX model_package_archives_pkey ON pg_temp.model_package_archives USING btree (import_id)',
    'CREATE UNIQUE INDEX model_package_archives_storage_prefix_key ON pg_temp.model_package_archives USING btree (storage_prefix)',
    'CREATE INDEX model_package_archives_version ON pg_temp.model_package_archives USING btree (project_id, model_version_id, created_at, import_id) WHERE (published = true)',
  ];
  const expected = [
    'CREATE UNIQUE INDEX model_package_archives_pkey ON public.model_package_archives USING btree (import_id)',
    'CREATE UNIQUE INDEX model_package_archives_storage_prefix_key ON public.model_package_archives USING btree (storage_prefix)',
    'CREATE INDEX model_package_archives_version ON public.model_package_archives USING btree (project_id, model_version_id, created_at, import_id) WHERE (published = true)',
  ];
  const source = { ...definitions(), indexes: temporary.map(definition => ({ definition, valid: true, ready: true })) }, original = structuredClone(source);
  assert.deepEqual(normalizeArchiveTempDefinitions(source).indexes.map(row => row.definition), expected);
  assert.deepEqual(normalizeArchiveTempDefinitions(source, 'pg_temp_7').indexes.map(row => row.definition), expected);
  assert.deepEqual(source, original, 'Historical expected contract is retained unchanged');
  const numbered = structuredClone(source); numbered.indexes[0].definition = temporary[0].replace('pg_temp.', 'pg_temp_7.');
  assert.deepEqual(normalizeArchiveTempDefinitions(numbered, 'pg_temp_7').indexes.map(row => row.definition), expected);
  const foreign = { ...definitions(), indexes: [{ definition: 'CREATE INDEX other ON pg_temp.foreign_table USING btree (id)' }, { definition: 'CREATE INDEX extra ON pg_temp.model_package_archives_extra USING btree (id)' }] };
  assert.deepEqual(normalizeArchiveTempDefinitions(foreign), foreign);
  assert.throws(() => normalizeArchiveTempDefinitions(source, 'public'), { code: 'UPGRADE_ARCHIVE_CONTRACT_INVALID' });
});
test('only the declared empty new table and exact relation additions may be projected', () => {
  const old = metadata('users'), added = { ...metadata('model_package_archives'), rows: '0', rawBytes: '0', file: { bytes: '0', sha256: hash('') } },
    relationNames = ['model_package_archives', 'model_package_archives_pkey', 'model_package_archives_storage_prefix_key', 'model_package_archives_version'];
  const contract = { schema: currentInventorySchemaMetadata(added), relations: relationNames.map(name => ({ name, persistence: 'p' })) }, globals = { relations: [{ name: 'users' }], routines: [] }, afterGlobals = { ...globals, relations: [...contract.relations, ...globals.relations] };
  assert.deepEqual(validateArchiveAddition({ tables: [old] }, { tables: [added, old] }, contract, globals, afterGlobals), globals);
  for (const mutate of [v => v.rows = '1', v => v.file.bytes = '1', v => v.columns[0].type = 'uuid']) {
    const changed = structuredClone(added); mutate(changed); assert.throws(() => validateArchiveAddition({ tables: [old] }, { tables: [changed, old] }, contract, globals, afterGlobals), { code: 'UPGRADE_UNDECLARED_SCHEMA_ADDITION' });
  }
  assert.throws(() => validateArchiveAddition({ tables: [old] }, { tables: [added] }, contract, globals, afterGlobals), { code: 'UPGRADE_OLD_TABLE_REMOVED' });
  assert.throws(() => validateArchiveAddition({ tables: [old] }, { tables: [added, old] }, contract, globals, { ...afterGlobals, routines: [{ name: 'unreviewed' }] }), { code: 'UPGRADE_OLD_GLOBAL_SQL_CHANGED' });
});
async function captureFixture(directory, ownerId, { archives = false, amount = '9007199254740993' } = {}) {
  await fs.mkdir(directory); const tables = [];
  for (const name of archives ? ['model_package_archives', 'users'] : ['users']) {
    const meta = metadata(name), key = JSON.stringify(['380e4cb8-32ea-4ae0-92fa-4011a5abe0a0']), rowText = '{"id":"380e4cb8-32ea-4ae0-92fa-4011a5abe0a0","amount":' + amount + '}', rows = name === 'users' ? [{ key, rowText }] : [];
    const content = rows.map(row => JSON.stringify(row) + '\n').join(''), filename = 'table-' + String(tables.length).padStart(4, '0') + '.ndjson'; await fs.writeFile(path.join(directory, filename), content);
    const rowHash = createHash('sha256').update('wfc.lossless.table-rows.v1\n'), keyHash = createHash('sha256').update('wfc.lossless.table-keys.v1\n');
    for (const row of rows) { currentInventoryFrame(rowHash, row.key); currentInventoryFrame(rowHash, row.rowText); currentInventoryFrame(keyHash, row.key); }
    tables.push({ ...meta, rows: String(rows.length), rawBytes: String(rows.reduce((total, row) => total + Buffer.byteLength(row.rowText), 0)), schemaSha256: digest(meta), rowSha256: rowHash.digest('hex'), keySetSha256: keyHash.digest('hex'), file: { path: filename, bytes: String(Buffer.byteLength(content)), sha256: hash(content) }, fencing: null });
  }
  const inventoryId = randomUUID(), body = { schemaVersion: 'wfc.operations.lossless-inventory.v1', status: 'PASS', scope: 'public', projection: 'postgresql-jsonb-text.v1', ownerId, inventoryId,
    database: { name: 'wfc_app', encoding: 'UTF8', serverVersionNum: '180000' }, tables, catalogSha256: digest(tables.map(currentInventorySchemaMetadata)) };
  await write(path.join(directory, '.owner.json'), { schemaVersion: 'wfc.operations.lossless-owner.v1', ownerId, inventoryId }); await write(path.join(directory, 'manifest.json'), { ...body, contentSha256: digest(body) });
}
test('derived old-table comparison preserves original capture bytes and wide numeric business values', async t => {
  const root = await temporary(t), ownerId = randomUUID(), before = path.join(root, 'before'), after = path.join(root, 'after');
  await captureFixture(before, ownerId); await captureFixture(after, ownerId, { archives: true }); const prior = await pin(path.join(after, 'manifest.json'));
  const projected = await projectOldTables(after, path.join(root, 'projected'), ownerId);
  assert.equal((await compareCurrentInventories(before, projected.directory, { comparison: 'exact', beforeOwnerId: ownerId, afterOwnerId: ownerId })).status, 'PASS');
  assert.deepEqual(await pin(path.join(after, 'manifest.json')), prior); assert.match(await fs.readFile(path.join(projected.directory, 'table-0000.ndjson'), 'utf8'), /9007199254740993/);
  const changed = path.join(root, 'changed'); await captureFixture(changed, ownerId, { archives: true, amount: '9007199254740992' });
  const changedProjection = await projectOldTables(changed, path.join(root, 'changed-projection'), ownerId);
  const result = await compareCurrentInventories(before, changedProjection.directory, { comparison: 'exact', beforeOwnerId: ownerId, afterOwnerId: ownerId }); assert.equal(result.status, 'FAIL'); assert.ok(result.failures.some(row => row.code === 'ROW_CONTENT_CHANGED'));
});
test('capture cannot construct a source or foreign database connection', async t => {
  const root = await temporary(t), ownerId = randomUUID();
  for (const host of ['host.docker.internal', '127.0.0.1', 'wfc_app', upgradeResourceNames(randomUUID()).postgres]) {
    const connectionPath = path.join(root, randomUUID() + '.private.json'); await write(connectionPath, { host, port: 5432, user: 'fixture', password: 'PRIVATE', database: 'wfc_app' });
    let constructed = false; await assert.rejects(captureUpgradeClone({ directory: path.join(root, randomUUID()), ownerId, connectionPath }, { poolFactory() { constructed = true; throw Error('must not connect'); } }), { code: 'UPGRADE_CAPTURE_CONNECTION_SCOPE' }); assert.equal(constructed, false);
  }
});
test('health probes use only fixed owned DNS and do not carry credentials', async () => {
  const ownerId = randomUUID(), names = upgradeResourceNames(ownerId); let calls = 0;
  await assert.rejects(probeUpgrade({ ownerId, role: 'source' }, { request() { throw Error('must not contact'); } }), { code: 'UPGRADE_PROBE_ROLE_INVALID' });
  const result = await probeUpgrade({ ownerId, role: 'candidate' }, { request(options, callback) {
    calls++; assert.equal(options.hostname, names.candidate); assert.equal(options.port, 4000); assert.equal(options.path, '/health'); assert.equal(options.headers, undefined);
    const req = new EventEmitter(); req.destroy = () => {}; req.end = () => queueMicrotask(() => { const res = new PassThrough(); res.statusCode = 200; callback(res); res.end('{"status":"ok"}'); }); return req;
  } }); assert.equal(result.status, 'PASS'); assert.equal(calls, 1);
});

async function gateFixture(t) {
  const root = await temporary(t), operationId = randomUUID(), directory = path.join(root, 'sp6-upgrade-' + operationId); await fs.mkdir(directory);
  const f = name => path.join(directory, name), seed = f('seed.private.json'); await write(seed, { synthetic: true });
  const sourceClosure = []; for (let index = 0; index < 12; index++) { const name = f('source-' + index + '.json'); await write(name, { index }); sourceClosure.push(await pin(name)); }
  const evidence = []; for (const [role, selectedImage] of [['candidate', image(2)], ['rollback', image(6)]]) {
    await write(f(role + '-startup.private.json'), { image: selectedImage, id: id(role === 'candidate' ? 8 : 9), health: { status: 'PASS', operationId }, stoppedJoinedAndRemovedBeforeCapture: true, publishedPorts: false }); evidence.push(await pin(f(role + '-startup.private.json')));
  }
  for (const name of ['candidate-comparison.private.json', 'rollback-comparison.private.json']) await write(f(name), { status: 'PASS', comparison: 'exact', newEmptyTableSchema: 'PASS', oldGlobalSql: 'PASS', oldClusterContext: 'PASS' });
  await write(f('contract.private.json'), { synthetic: true });
  const value = { schemaVersion: 'wfc.preparer.api-upgrade-preflight.v1', status: 'PASS', operationId, productionQualification: true, productRevision: revision, candidateApiImage: image(2), rollbackApiImage: image(6), captureImage: image(3), seed: await pin(seed), sourceClosure, evidence,
    upgradeComparison: await pin(f('candidate-comparison.private.json')), rollbackComparison: await pin(f('rollback-comparison.private.json')), expectedContract: await pin(f('contract.private.json')),
    candidateHealth: 'PASS', oldBusinessDataAndSchema: 'PASS', oldGlobalSql: 'PASS', oldClusterContext: 'PASS', declaredNewEmptyArchiveTable: 'PASS', oldImageRollbackStartup: 'PASS', cleanup: { status: 'PASS', resourcesRetained: false, intendedResources: upgradeResourceIntents(operationId).map(value => ({ ...value, state: 'confirmed-absent' })) }, sourceRuntimeAccess: false, publishedPorts: false };
  await write(f('qualification.private.json'), value); const lock = path.join(root, 'original.lock'), archived = f('source-lock-released.private.json'); await write(archived, { operationId });
  await write(f('complete.private.json'), { schemaVersion: 'wfc.preparer.upgrade-complete.v1', status: 'PASS', operationId, qualification: await pin(f('qualification.private.json')), sourceLockRelease: { state: 'pending', source: { ...await pin(archived), path: lock }, archivedPath: archived } });
  return { directory, file: f('qualification.private.json'), sha256: (await pin(f('qualification.private.json'))).sha256, lock, archived, value };
}
test('deployment gate requires finalized pinned comparisons, startup proofs and released source lock', async t => {
  const f = await gateFixture(t); assert.equal((await verifyUpgradeQualification(f.file, f.sha256)).sourceLockReleased, true);
  await write(f.lock, { foreign: true }); await assert.rejects(verifyUpgradeQualification(f.file, f.sha256), { code: 'UPGRADE_GATE_LOCK_RELEASE_UNCONFIRMED' });
});
test('changed evidence or a retained finalization failure cannot be promoted to a deployable PASS', async t => {
  const f = await gateFixture(t); await write(path.join(f.directory, 'finalization-failure.private.json'), { status: 'FAIL' });
  await assert.rejects(verifyUpgradeQualification(f.file, f.sha256), { code: 'UPGRADE_GATE_FAILED' });
  await fs.unlink(path.join(f.directory, 'finalization-failure.private.json')); await fs.appendFile(f.archived, 'changed');
  await assert.rejects(verifyUpgradeQualification(f.file, f.sha256), { code: 'UPGRADE_GATE_LOCK_RELEASE_UNCONFIRMED' });
});
