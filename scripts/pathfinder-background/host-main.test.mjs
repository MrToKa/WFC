import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { ownWork, writePrivate } from '../pathfinder-tray-catalog/guard-io.mjs';
import { createProducerProfile } from './container-profile.mjs';
import { HOST_MAIN_LIMITS, parseManagedHostConfiguration, parseHostMainArguments, sanitizeManagedHostObservation, loadManagedHostConfiguration, runManagedHostMain } from './host-main.mjs';

const id = n => `eb900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const seccomp = JSON.stringify({ defaultAction: 'SCMP_ACT_ERRNO', syscalls: [{ names: ['read', 'write'], action: 'SCMP_ACT_ALLOW' }] });
const configuration = workPath => ({ key: 'a'.repeat(64), owner: id(2), project: 'wfc-pathfinder-local-abcdef123456', image: 'sha256:' + 'b'.repeat(64), runtimeInventorySha256: 'c'.repeat(64), workPath, seccompSha256: hash(seccomp) });
const identity = { instanceId: id(4), projectId: id(5), modelVersionId: id(6), loadId: id(7), sessionId: id(8) };
async function fixture(t) {
  const temporaryRoot = await fs.realpath(os.tmpdir()), root = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, 'wfc-host-main-')));
  t.after(async () => { const resolved = path.resolve(root); assert.equal(path.dirname(resolved), temporaryRoot); assert.ok(path.basename(resolved).startsWith('wfc-host-main-'));
    assert.equal(await fs.realpath(resolved), resolved); await fs.rm(resolved, { recursive: true, force: false }); });
  await fs.mkdir(path.join(root, 'pathfinder-engine/.scratch'), { recursive: true }); await fs.mkdir(path.join(root, 'docker/pathfinder-producer'), { recursive: true });
  await fs.writeFile(path.join(root, 'docker/pathfinder-producer/seccomp-default.json'), seccomp);
  const work = await ownWork({ root, id: id(1) }), config = configuration(work.relative); await writePrivate(work, 'managed-host-config', config);
  const filename = path.join(work.directory, 'managed-host-config.private.json'), argv = ['--configuration', filename];
  const profile = attemptId => createProducerProfile({ owner: config.owner, project: config.project, image: config.image, attemptId, mode: 'run', defaultSeccompBytes: seccomp, defaultSeccompSha256: config.seccompSha256 });
  const records = async suffix => {
    const names = (await fs.readdir(work.directory)).filter(name => name.startsWith('managed-host-') && name.endsWith(suffix + '.private.json')).sort();
    return Promise.all(names.map(async name => ({ name, value: JSON.parse(await fs.readFile(path.join(work.directory, name))) })));
  };
  const createJournal = async () => ({ async list() { return []; }, async retain() { assert.fail('No helper journal action expected in this fake worker'); }, async retire() { assert.fail('No helper journal action expected in this fake worker'); } });
  const run = runWorker => runManagedHostMain(argv, { root, runWorker, createJournal, listenForSignals: false });
  return { root, work, config, filename, argv, profile, records, run, createJournal };
}

test('only a single absolute configuration filename is accepted; no key, URL, program or override argv', () => {
  const absolute = path.resolve('synthetic', 'managed-host-config.private.json'); assert.deepEqual(parseHostMainArguments(['--configuration', absolute]), { configurationPath: absolute });
  for (const argv of [[], ['--configuration'], ['--configuration', 'relative/managed-host-config.private.json'], ['--key', 'a'.repeat(64)], ['--configuration', absolute, '--image', 'x'], ['--configuration', path.resolve('another.json')]]) {
    assert.throws(() => parseHostMainArguments(argv), { code: 'PRODUCER_HOST_ARGUMENTS_INVALID' });
  }
});

test('flat private configuration preserves exact strings and rejects duplicates, unknown keys and nonfinite or malformed inputs', () => {
  const valid = configuration('pathfinder-engine/.scratch/tray-catalog-' + id(1)); assert.deepEqual(parseManagedHostConfiguration(Buffer.from(JSON.stringify(valid, null, 2))), valid);
  const duplicate = JSON.stringify(valid).replace('{', '{"owner":"' + id(99) + '",');
  for (const text of [duplicate, '{"key":Infinity}', JSON.stringify({ ...valid, extra: 'unknown' }), JSON.stringify({ ...valid, key: valid.key + '\n' }), JSON.stringify({ ...valid, owner: null }), JSON.stringify(valid) + '{}', JSON.stringify(valid).replace(/}$/, ',}')]) {
    assert.throws(() => parseManagedHostConfiguration(Buffer.from(text)), { code: 'PRODUCER_HOST_CONFIGURATION_INVALID' });
  }
  assert.throws(() => parseManagedHostConfiguration(Buffer.alloc(HOST_MAIN_LIMITS.configurationBytes + 1)), { code: 'PRODUCER_HOST_CONFIGURATION_LIMIT' });
});

test('verified loading pins raw private config SHA and the fixed checked-in seccomp bytes', async t => {
  const f = await fixture(t), loaded = await loadManagedHostConfiguration(f.filename, { root: f.root });
  assert.deepEqual(loaded.configuration, f.config); assert.equal(loaded.configurationSha256, hash(await fs.readFile(f.filename))); assert.equal(loaded.seccompBytes.toString(), seccomp);
  await fs.appendFile(path.join(f.root, 'docker/pathfinder-producer/seccomp-default.json'), ' ');
  await assert.rejects(loadManagedHostConfiguration(f.filename, { root: f.root }), { code: 'PRODUCER_HOST_SECCOMP_INTEGRITY' });
});

test('configuration outside the verified work path or hard-linked config is refused before worker startup', async t => {
  const f = await fixture(t); await fs.link(f.filename, path.join(f.work.directory, 'config-hard-link.private.json'));
  await assert.rejects(loadManagedHostConfiguration(f.filename, { root: f.root }), { code: 'CATALOG_IO_TYPE' });
  await assert.rejects(loadManagedHostConfiguration(path.join(f.root, 'managed-host-config.private.json'), { root: f.root }), { code: 'CATALOG_IO_WORK_PATH' });
});

test('observation projection discards secrets, business values, arbitrary nested payloads and accessors', () => {
  const input = { type: 'joined', state: 'joined', attemptId: id(3), containerId: 'd'.repeat(64), removed: true, key: 'private-secret', payload: { coordinates: [123, 456, 789] }, cookie: 'human-cookie' };
  Object.defineProperty(input, 'faultCode', { enumerable: true, get() { assert.fail('An observation accessor must never execute'); } });
  assert.deepEqual(sanitizeManagedHostObservation(input), { type: 'joined', state: 'joined', attemptId: id(3), containerId: 'd'.repeat(64), removed: true });
  assert.equal(JSON.stringify(sanitizeManagedHostObservation(input)).includes('private-secret'), false);
});

test('main writes private PID/start metadata and a durable intent before the fake worker may create a helper', async t => {
  const f = await fixture(t); const result = await f.run(async options => {
    const started = await f.records('-started'); assert.equal(started.length, 1); assert.equal(started[0].value.pid, process.pid);
    await options.beforeStart({ attemptId: id(3), identity, profile: f.profile(id(3)) });
    const intent = JSON.parse(await fs.readFile(path.join(f.work.directory, `managed-host-attempt-${id(3)}.private.json`)));
    assert.equal(intent.attemptId, id(3)); assert.deepEqual(intent.identity, identity); assert.equal(intent.configurationSha256, hash(await fs.readFile(f.filename)));
    assert.equal(intent.profile.name, f.profile(id(3)).name); assert.equal(JSON.stringify(intent).includes(f.config.key), false);
    options.observe({ type: 'ready', state: 'running', attemptId: id(3), containerId: 'd'.repeat(64) });
    options.observe({ type: 'joined', state: 'joined', attemptId: id(3), containerId: 'd'.repeat(64) });
    options.observe({ type: 'removed', state: 'joined', attemptId: id(3), containerId: 'd'.repeat(64), removed: true });
    return { stopped: true, lastErrorCode: null };
  });
  assert.equal(result.state, 'joined'); const final = (await f.records('-final'))[0].value;
  assert.equal(final.captureQualified, false); assert.equal(final.observationCount, 3); assert.equal(final.attempts[0].removed, true);
});

test('a pre-existing intent is recovery work and can never launch another fresh helper', async t => {
  const f = await fixture(t), sentinel = { only: 'synthetic original intent' }; await writePrivate(f.work, `managed-host-attempt-${id(3)}`, sentinel);
  await assert.rejects(f.run(async options => {
    await options.beforeStart({ attemptId: id(3), identity, profile: f.profile(id(3)) }); assert.fail('A duplicate intent must not reach helper creation');
  }), { code: 'PRODUCER_HOST_RECOVERY_REQUIRED' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.work.directory, `managed-host-attempt-${id(3)}.private.json`))), sentinel);
  assert.equal((await f.records('-final'))[0].value.state, 'quarantined');
});

test('factory profile and identity scope are required before any attempt metadata or helper creation', async t => {
  const f = await fixture(t); await assert.rejects(f.run(async options => {
    await options.beforeStart({ attemptId: id(3), identity: { ...identity, extra: 'unknown' }, profile: f.profile(id(3)) });
  }));
  assert.equal((await fs.readdir(f.work.directory)).some(name => name.startsWith('managed-host-attempt-')), false);
});

test('an incomplete physical cleanup is reported as quarantine without claiming capture acceptance', async t => {
  const f = await fixture(t), result = await f.run(async options => {
    await options.beforeStart({ attemptId: id(3), identity, profile: f.profile(id(3)) }); options.observe({ type: 'quarantined', state: 'quarantined', attemptId: id(3), containerId: 'd'.repeat(64), quarantineCode: 'PRODUCER_JOIN_UNKNOWN' });
    return { stopped: true, lastErrorCode: 'PRODUCER_JOIN_UNKNOWN' };
  });
  assert.equal(result.state, 'quarantined'); assert.equal(result.operationErrorCode, 'PRODUCER_JOIN_UNKNOWN'); assert.equal((await f.records('-final'))[0].value.captureQualified, false);
});

test('a matching private stop request aborts before calling the worker and is never deleted', async t => {
  const f = await fixture(t), configurationSha256 = hash(await fs.readFile(f.filename)); await writePrivate(f.work, 'managed-host-stop', { schemaVersion: 'wfc.pf.managed-host-stop.v1', owner: f.config.owner, configurationSha256 });
  const result = await f.run(async () => assert.fail('A pre-existing valid stop must prevent helper creation'));
  assert.equal(result.stopped, true); assert.equal((await f.records('-final'))[0].value.stopReason, 'private-stop-request');
  assert.equal((await fs.stat(path.join(f.work.directory, 'managed-host-stop.private.json'))).isFile(), true);
});

test('a stop file with another owner or config SHA is refused rather than ignored or broadened', async t => {
  const f = await fixture(t); await writePrivate(f.work, 'managed-host-stop', { schemaVersion: 'wfc.pf.managed-host-stop.v1', owner: id(99), configurationSha256: 'f'.repeat(64) });
  await assert.rejects(f.run(async () => assert.fail('An invalid private stop must fail closed')), { code: 'PRODUCER_HOST_STOP_INVALID' });
});

test('sanitized observation persistence is bounded while final physical state remains current', async t => {
  const f = await fixture(t); await f.run(async options => {
    for (let n = 0; n < HOST_MAIN_LIMITS.observations + 7; n++) options.observe({ type: 'host-refused', code: 'PRODUCER_CONTROL_UNAVAILABLE', privateKey: f.config.key });
    return { stopped: true, lastErrorCode: 'PRODUCER_CONTROL_UNAVAILABLE' };
  });
  const final = (await f.records('-final'))[0].value; assert.equal(final.observationCount, HOST_MAIN_LIMITS.observations); assert.equal(final.observationsDropped, 7);
  assert.equal((await fs.readdir(f.work.directory)).filter(name => /-observation-/.test(name)).length, HOST_MAIN_LIMITS.observations);
});

test('exact recovery proof survives a fatal worker failure in a private file while the original failure remains a refusal', async t => {
  const f = await fixture(t), error = Object.assign(new Error('Synthetic failure'), { code: 'PRODUCER_JOIN_PROOF_PERSISTENCE_UNKNOWN' });
  const proof = { attemptId: id(3), proof: { joined: true, removed: true, containerId: 'd'.repeat(64) } }; Object.defineProperty(error, 'recoveryProof', { value: proof, enumerable: false });
  await assert.rejects(f.run(async options => {
    await options.beforeStart({ attemptId: id(3), identity, profile: f.profile(id(3)) });
    options.observe({ type: 'fault', attemptId: id(99) }); // Earlier failure must not mask a later exact cleanup proof.
    throw error;
  }), value => value === error);
  const saved = (await f.records('-recovery-proof'))[0].value; assert.deepEqual(saved.proof, proof.proof); assert.equal(saved.attemptId, id(3));
  assert.equal(JSON.stringify(saved).includes(f.config.key), false); assert.equal((await f.records('-final'))[0].value.preservedRecoveryProof, true);
});
