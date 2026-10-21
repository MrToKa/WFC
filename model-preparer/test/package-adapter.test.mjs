import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import * as publicPackage from '../../routings-model-package/index.mjs';
import { createPackageAdapter } from '../lib/package-adapter.mjs';
import { CoreError, contextFromSpec, clone } from '../lib/contracts.mjs';
import { tinyModel } from './fixtures/model-fixture.mjs';

const packageModulePath = fileURLToPath(new URL('../../routings-model-package/index.mjs', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const rejects = (fn, code) => assert.rejects(fn, error => error instanceof CoreError && error.code === code);

async function setup(t, options = {}) {
  const tempParent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(tempParent, 'preparer-adapter-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tempParent));
    assert.ok(path.basename(root).startsWith('preparer-adapter-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'capture')); await fs.mkdir(path.join(root, 'packages'));
  const snapshot = Buffer.from('tiny captured NWD fixture');
  const snapshotPath = path.join(root, 'capture', 'tiny.nwd');
  await fs.writeFile(snapshotPath, snapshot);
  const spec = { jobId: randomUUID(), sourcePath: snapshotPath,
    namespace: { account: 'fake-account', application: 'fake-application' }, region: 'EMEA',
    destination: { bucket: 'fake-bucket', objectKey: 'tiny.nwd' },
    conversion: { format: 'svf', views: ['3d'], xAdsForce: false }, supportProfile: 'svf-local-7.130.0-v1',
    label: 'Tiny offline fixture', output: path.join(root, 'packages', 'tiny.zip') };
  const source = { name: 'tiny.nwd', bytes: snapshot.length, sha256: hash(snapshot), snapshotPath, capturedAt: '2026-10-16T09:00:00.000Z' };
  const job = { jobId: spec.jobId, frozen: contextFromSpec(spec, source) };
  const model = tinyModel(), calls = { manifests: 0, plans: 0, resources: [] };
  const observation = { status: 'success', objectId: job.frozen.objectId, urn: job.frozen.urn,
    submissionIdentity: job.frozen.submissionIdentity,
    roots: [{ rootId: 'root-1', format: 'svf', supportProfile: job.frozen.supportProfile }] };
  const plan = { schemaVersion: 1, submissionIdentity: job.frozen.submissionIdentity,
    objectId: job.frozen.objectId, urn: job.frozen.urn, region: job.frozen.region,
    rootId: 'root-1', supportProfile: job.frozen.supportProfile, resources: clone(model.resources) };
  const provider = {
    async getManifest(context) { assert.equal(context.submissionIdentity, job.frozen.submissionIdentity); calls.manifests++; return clone(observation); },
    async getDownloadPlan(context, { rootId }) { assert.equal(context.region, job.frozen.region); calls.plans++; return { ...clone(plan), rootId }; },
    async *readResource(context, { resourceId, signal }) {
      assert.equal(context.urn, job.frozen.urn);
      const row = model.resources.find(item => item.resourceId === resourceId);
      calls.resources.push(row.path);
      const bytes = model.data.get(row.path);
      yield bytes.subarray(0, Math.ceil(bytes.length / 2));
      if (options.interrupt?.(row, calls)) throw new Error('unsanitized provider error https://signed.invalid/?access_token=never-persist');
      if (signal?.aborted) throw new Error('aborted fake stream');
      yield bytes.subarray(Math.ceil(bytes.length / 2));
    },
  };
  let persisted;
  const onCheckpoint = async value => { persisted = clone(value); };
  const clock = { now: () => Date.parse('2026-10-16T09:30:00.000Z') };
  const adapter = await createPackageAdapter({ packageModulePath, workDirectory: path.join(root, 'work'), clock });
  return { root, job, model, observation, plan, provider, calls, adapter, onCheckpoint, get previous() { return persisted; } };
}

test('explicit adapter construction performs no provider calls', async t => {
  const f = await setup(t);
  assert.deepEqual(f.calls, { manifests: 0, plans: 0, resources: [] });
  await rejects(() => createPackageAdapter({ packageModulePath: 'relative/index.mjs', workDirectory: path.join(f.root, 'other') }), 'INVALID_JOB');
  await rejects(() => createPackageAdapter({ packageModulePath, packageApi: publicPackage, workDirectory: path.join(f.root, 'other') }), 'CONFIGURATION_INVALID');
});

test('small raw model downloads, uses public packModel and independently verifies the package', async t => {
  const f = await setup(t);
  const result = await f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint });
  assert.equal(result.download.status, 'downloaded');
  const descriptor = JSON.parse(await fs.readFile(path.join(result.modelDirectory, 'model.json'), 'utf8'));
  assert.equal(descriptor.name, 'tiny.nwd'); assert.equal(descriptor.resourceCount, 3);
  const integrity = JSON.parse(await fs.readFile(path.join(result.modelDirectory, 'integrity.json'), 'utf8'));
  assert.equal(Object.keys(integrity).length, 3);
  for (const [name, bytes] of f.model.data) assert.deepEqual(await fs.readFile(path.join(result.modelDirectory, ...name.split('/'))), bytes);
  const published = await f.adapter.buildPackage(f.job, { modelDirectory: result.modelDirectory });
  assert.equal(published.status, 'PASS'); assert.equal(published.source.identityBasis, 'observed-local-file');
  assert.equal(published.source.sha256, f.job.frozen.source.sha256);
  const verified = await f.adapter.registerPackage(published.path);
  assert.equal(verified.status, 'PASS'); assert.equal(verified.manifest.packageId, published.packageId);
  assert.equal(verified.contentFingerprint, published.contentFingerprint);
  assert.equal(f.calls.resources.length, 3);
});

test('interrupted raw resource retains only durable completed checkpoints and resumes missing files', async t => {
  let interrupted = false;
  const f = await setup(t, { interrupt: row => { if (row.path.endsWith('0.svf') && !interrupted) { interrupted = true; return true; } return false; } });
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'PROVIDER_FAILURE');
  assert.deepEqual(Object.keys(f.previous.checkpoints), ['output/0/0.pf']);
  await assert.rejects(() => fs.stat(path.join(f.previous.modelDirectory, 'model.json')), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(path.join(path.dirname(f.previous.modelDirectory), 'parts')), []);
  const before = f.calls.resources.length;
  const resumed = await f.adapter.download(f.job, { provider: f.provider, previous: f.previous, onCheckpoint: f.onCheckpoint });
  assert.equal(resumed.download.status, 'downloaded');
  assert.deepEqual(f.calls.resources.slice(before), ['output/0/0.svf', 'output/0/properties.db']);
});

test('resume rehashes checkpoints and fetches only corrupt or missing files', async t => {
  const f = await setup(t);
  const result = await f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint });
  await fs.writeFile(path.join(result.modelDirectory, 'output', '0', '0.pf'), Buffer.alloc(41));
  const before = f.calls.resources.length;
  await f.adapter.download(f.job, { provider: f.provider, previous: f.previous, onCheckpoint: f.onCheckpoint });
  assert.deepEqual(f.calls.resources.slice(before), ['output/0/0.pf']);
  await fs.unlink(path.join(result.modelDirectory, 'output', '0', 'properties.db'));
  const more = f.calls.resources.length;
  await f.adapter.download(f.job, { provider: f.provider, previous: f.previous, onCheckpoint: f.onCheckpoint });
  assert.deepEqual(f.calls.resources.slice(more), ['output/0/properties.db']);
});

test('an orphan raw file without a committed checkpoint is not trusted', async t => {
  const f = await setup(t);
  await f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint });
  const previous = clone(f.previous); delete previous.checkpoints['output/0/0.pf'];
  const before = f.calls.resources.length;
  await f.adapter.download(f.job, { provider: f.provider, previous, onCheckpoint: f.onCheckpoint });
  assert.deepEqual(f.calls.resources.slice(before), ['output/0/0.pf']);
});

test('multiple roots require explicit choice without choosing the first', async t => {
  const f = await setup(t);
  f.observation.roots.push({ rootId: 'root-2', format: 'svf', supportProfile: f.job.frozen.supportProfile });
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'DERIVATIVE_AMBIGUOUS');
  assert.equal(f.calls.plans, 0); assert.equal(f.calls.resources.length, 0);
  const result = await f.adapter.download(f.job, { provider: f.provider, rootId: 'root-2', onCheckpoint: f.onCheckpoint });
  assert.equal(result.download.rootId, 'root-2');
});

test('a changed selected plan cannot reuse previous checkpoint evidence', async t => {
  const f = await setup(t);
  await f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint });
  f.plan.resources[0].sha256 = '1'.repeat(64);
  const before = f.calls.resources.length;
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, previous: f.previous, onCheckpoint: f.onCheckpoint }), 'DOWNLOAD_PLAN_CHANGED');
  assert.equal(f.calls.resources.length, before);
});

test('invalid checkpoint hashes are state corruption, not silent checkpoint resets', async t => {
  const f = await setup(t);
  await f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint });
  const previous = clone(f.previous); previous.checkpoints['output/0/0.pf'].sha256 = 'invalid';
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, previous, onCheckpoint: f.onCheckpoint }), 'STORE_CORRUPT');
});

test('missing properties.db plan is refused before any resource fetch', async t => {
  const f = await setup(t); f.plan.resources = f.plan.resources.filter(row => !row.path.endsWith('properties.db'));
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'DOWNLOAD_INCOMPLETE');
  assert.equal(f.calls.resources.length, 0);
});

test('public profile rejects a plan that omits a referenced geometry file', async t => {
  const f = await setup(t); f.plan.resources = f.plan.resources.filter(row => !row.path.endsWith('0.pf'));
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'DOWNLOAD_INCOMPLETE');
  await assert.rejects(() => fs.stat(path.join(f.previous.modelDirectory, 'model.json')), { code: 'ENOENT' });
  await assert.rejects(() => fs.stat(f.job.frozen.output), { code: 'ENOENT' });
});

for (const unsafe of ['../escape.pf', '/output/0/0.pf', 'output/0/%2e%2e.pf', 'output/0/CON.pf', 'output/0/.env']) {
  test(`unsafe resource path is rejected: ${unsafe}`, async t => {
    const f = await setup(t); f.plan.resources[0].path = unsafe;
    await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'UNSAFE_PATH');
    assert.equal(f.calls.resources.length, 0);
  });
}

test('duplicate and case-colliding plan paths are rejected', async t => {
  const f = await setup(t); f.plan.resources.push({ ...f.plan.resources[1], resourceId: 'extra' });
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'DOWNLOAD_INVALID');
  f.plan.resources.pop();
  f.plan.resources.push({ ...f.plan.resources[1], resourceId: 'extra-A', path: 'output/0/A.pf' }, { ...f.plan.resources[1], resourceId: 'extra-a', path: 'output/0/a.pf' });
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'DOWNLOAD_INVALID');
});

test('signed resource URLs cannot enter checkpoints through a normalized resource ID', async t => {
  const f = await setup(t); f.plan.resources[0].resourceId = 'https://signed.invalid/?access_token=secret';
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'DOWNLOAD_INVALID');
  assert.equal(f.previous, undefined); assert.equal(f.calls.resources.length, 0);
});

test('namespace/source/conversion identity mismatch refuses download', async t => {
  const f = await setup(t); f.observation.submissionIdentity = '2'.repeat(64);
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'IDENTITY_MISMATCH');
  assert.equal(f.calls.resources.length, 0);
});

test('pending or failed derivatives cannot be downloaded', async t => {
  const f = await setup(t); f.observation.status = 'pending';
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'DERIVATIVE_PENDING');
  f.observation.status = 'failed';
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'DERIVATIVE_FAILED');
  assert.equal(f.calls.resources.length, 0);
});

test('checkpoint commit failure prevents all subsequent reads or packaging', async t => {
  const f = await setup(t); let count = 0;
  const onCheckpoint = async value => { count++; if (count === 2) throw new CoreError('STORE_WRITE_FAILED'); await f.onCheckpoint(value); };
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint }), 'STORE_WRITE_FAILED');
  assert.deepEqual(f.calls.resources, ['output/0/0.pf']);
  assert.deepEqual(f.previous.checkpoints, {});
  await assert.rejects(() => fs.stat(f.job.frozen.output), { code: 'ENOENT' });
});

test('abort stops local download, removes its part file and retains completed checkpoint history', async t => {
  const f = await setup(t); const controller = new AbortController();
  const original = f.provider.readResource;
  f.provider.readResource = async function* (...args) { for await (const chunk of original(...args)) { yield chunk; controller.abort(); } };
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, signal: controller.signal, onCheckpoint: f.onCheckpoint }), 'LOCAL_ABORTED');
  assert.equal(f.previous.status, 'downloading');
  assert.deepEqual(await fs.readdir(path.join(path.dirname(f.previous.modelDirectory), 'parts')), []);
  await assert.rejects(() => fs.stat(path.join(f.previous.modelDirectory, 'model.json')), { code: 'ENOENT' });
});

test('provider failure never includes tokens or signed URLs in its outward error', async t => {
  const f = await setup(t, { interrupt: () => true });
  try { await f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }); assert.fail('Expected failure'); }
  catch (error) { assert.equal(error.code, 'PROVIDER_FAILURE'); assert.doesNotMatch(JSON.stringify(error), /access_token|signed\.invalid|never-persist/); }
});

test('changed captured snapshot is refused before package publication', async t => {
  const f = await setup(t); const download = await f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint });
  await fs.writeFile(f.job.frozen.source.snapshotPath, Buffer.alloc(f.job.frozen.source.bytes));
  await rejects(() => f.adapter.buildPackage(f.job, { modelDirectory: download.modelDirectory }), 'SNAPSHOT_CHANGED');
  await assert.rejects(() => fs.stat(f.job.frozen.output), { code: 'ENOENT' });
});

test('package adapter failure preserves the last verified ready ZIP', async t => {
  const f = await setup(t); const download = await f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint });
  const good = await f.adapter.buildPackage(f.job, { modelDirectory: download.modelDirectory });
  await fs.writeFile(path.join(download.modelDirectory, 'output', '0', '0.pf'), Buffer.alloc(41));
  await rejects(() => f.adapter.buildPackage(f.job, { modelDirectory: download.modelDirectory }), 'PACKAGE_ADAPTER_FAILURE');
  assert.equal(hash(await fs.readFile(good.path)), good.sha256);
  assert.equal((await f.adapter.registerPackage(good.path)).status, 'PASS');
});

test('registration of an existing package performs zero additional provider calls', async t => {
  const f = await setup(t); const download = await f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint });
  const good = await f.adapter.buildPackage(f.job, { modelDirectory: download.modelDirectory });
  const before = clone(f.calls);
  await f.adapter.registerPackage(good.path);
  assert.deepEqual(f.calls, before);
});

test('dependency path works independently of the process current directory', async t => {
  const f = await setup(t);
  const before = process.cwd(); process.chdir(f.root);
  try {
    const adapter = await createPackageAdapter({ packageModulePath, workDirectory: path.join(f.root, 'separate') });
    const download = await adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint });
    assert.equal(download.download.status, 'downloaded');
  } finally { process.chdir(before); }
});

test('frozen source/account/region/conversion mismatch is rejected before provider reads', async t => {
  const f = await setup(t);
  for (const change of [
    frozen => { frozen.source.sha256 = '3'.repeat(64); },
    frozen => { frozen.namespace.account = 'other-account'; },
    frozen => { frozen.region = 'US'; },
  ]) {
    const altered = clone(f.job); change(altered.frozen);
    await rejects(() => f.adapter.download(altered, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'IDENTITY_MISMATCH');
  }
  const altered = clone(f.job); altered.frozen.conversion.xAdsForce = true;
  await rejects(() => f.adapter.download(altered, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'UNSUPPORTED_PROFILE');
  assert.equal(f.calls.manifests, 0);
});

test('raw transport bytes must match expected SHA and cannot be silently decompressed', async t => {
  const f = await setup(t);
  f.provider.readResource = async function* (_context, { resourceId }) {
    const row = f.model.resources.find(item => item.resourceId === resourceId);
    f.calls.resources.push(row.path);
    yield row.path.endsWith('0.pf') ? Buffer.from('PackFile fixture data') : f.model.data.get(row.path);
  };
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'DOWNLOAD_INVALID');
  assert.deepEqual(f.previous.checkpoints, {});
});

test('overlong actual raw stream is stopped and its part file is removed', async t => {
  const f = await setup(t);
  f.provider.readResource = async function* () { yield Buffer.alloc(1000); };
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'PACKAGE_LIMIT_EXCEEDED');
  assert.deepEqual(await fs.readdir(path.join(path.dirname(f.previous.modelDirectory), 'parts')), []);
});

test('known plan size/count limits are refused before resource IO', async t => {
  const f = await setup(t);
  for (const DEFAULT_LIMITS of [
    { ...publicPackage.DEFAULT_LIMITS, maxFiles: 2 },
    { ...publicPackage.DEFAULT_LIMITS, maxFileBytes: 500 },
    { ...publicPackage.DEFAULT_LIMITS, maxTotalResourceBytes: 800 },
  ]) {
    const adapter = await createPackageAdapter({ packageApi: { ...publicPackage, DEFAULT_LIMITS }, workDirectory: path.join(f.root, 'bounded') });
    await rejects(() => adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'PACKAGE_LIMIT_EXCEEDED');
  }
  assert.equal(f.calls.resources.length, 0);
});

test('stalled provider read respects local abort without waiting for foreign iterator cleanup', async t => {
  const f = await setup(t); const controller = new AbortController();
  f.provider.readResource = () => ({
    [Symbol.asyncIterator]() { return this; },
    next() { controller.abort(); return new Promise(() => {}); },
    return() { return new Promise(() => {}); },
  });
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, signal: controller.signal, onCheckpoint: f.onCheckpoint }), 'LOCAL_ABORTED');
  assert.deepEqual(await fs.readdir(path.join(path.dirname(f.previous.modelDirectory), 'parts')), []);
});

test('a linked work ancestor is refused instead of escaping the configured workspace', async t => {
  const f = await setup(t);
  const actual = path.join(f.root, 'actual-work'); await fs.mkdir(actual);
  const linked = path.join(f.root, 'linked-work'); await fs.symlink(actual, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await rejects(() => createPackageAdapter({ packageModulePath, workDirectory: linked }), 'UNSAFE_PATH');
});

test('network download budget rejects unsafe overrides without changing Package limits', async t => {
  const f = await setup(t);
  for (const downloadMaxMs of [0, -1, 0.5, NaN, Infinity, '1000', 1800001, Number.MAX_SAFE_INTEGER + 1]) {
    await rejects(() => createPackageAdapter({ packageApi: publicPackage, workDirectory: path.join(f.root, 'budget'), downloadMaxMs }), 'CONFIGURATION_INVALID');
  }
  await createPackageAdapter({ packageApi: publicPackage, workDirectory: path.join(f.root, 'budget'), downloadMaxMs: 1800000 });
  assert.equal(publicPackage.DEFAULT_LIMITS.maxMs, 600000);
  assert.deepEqual(f.calls, { manifests: 0, plans: 0, resources: [] });
});

test('transport can exceed Package validation budget while both phases remain independently bounded', async t => {
  const f = await setup(t), packageMaxMs = 500;
  const adapter = await createPackageAdapter({ packageApi: {
    ...publicPackage, DEFAULT_LIMITS: { ...publicPackage.DEFAULT_LIMITS, maxMs: packageMaxMs },
    validateProfile: (provider, options) => publicPackage.validateProfile(provider, { ...options, limits: { maxMs: packageMaxMs } }),
  }, workDirectory: path.join(f.root, 'network-budget'), downloadMaxMs: 5000 });
  const original = f.provider.getDownloadPlan;
  f.provider.getDownloadPlan = async (...args) => { await delay(650, undefined, { signal: args[1].signal }); return original(...args); };
  const result = await adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint });
  assert.equal(result.download.status, 'downloaded');
  assert.equal(publicPackage.DEFAULT_LIMITS.maxMs, 600000);
});

test('expired transport budget preserves committed resources and removes the incomplete part before resume', async t => {
  const f = await setup(t), adapter = await createPackageAdapter({ packageApi: publicPackage, workDirectory: path.join(f.root, 'work'), downloadMaxMs: 250 });
  const original = f.provider.readResource;
  f.provider.readResource = async function* (context, options) {
    const row = f.model.resources.find(item => item.resourceId === options.resourceId);
    if (row.path.endsWith('0.svf')) { yield f.model.data.get(row.path).subarray(0, 1); await new Promise(() => {}); }
    else yield* original(context, options);
  };
  await rejects(() => adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'PACKAGE_LIMIT_EXCEEDED');
  assert.deepEqual(Object.keys(f.previous.checkpoints), ['output/0/0.pf']);
  assert.equal(f.previous.status, 'downloading');
  assert.deepEqual(await fs.readdir(path.join(path.dirname(f.previous.modelDirectory), 'parts')), []);
  await assert.rejects(() => fs.stat(path.join(f.previous.modelDirectory, 'model.json')), { code: 'ENOENT' });
  f.provider.readResource = original;
  const resumed = await f.adapter.download(f.job, { provider: f.provider, previous: f.previous, onCheckpoint: f.onCheckpoint });
  assert.equal(resumed.download.status, 'downloaded');
  assert.deepEqual(f.calls.resources, ['output/0/0.pf', 'output/0/0.svf', 'output/0/properties.db']);
});

test('transport timer is cleared before profile validation begins', async t => {
  const f = await setup(t), caller = new AbortController();
  const adapter = await createPackageAdapter({ packageApi: { ...publicPackage, validateProfile: async (provider, options) => {
    assert.equal(options.signal, caller.signal);
    await delay(2100, undefined, { signal: options.signal });
    return publicPackage.validateProfile(provider, options);
  } }, workDirectory: path.join(f.root, 'phase-budget'), downloadMaxMs: 2000 });
  const result = await adapter.download(f.job, { provider: f.provider, signal: caller.signal, onCheckpoint: f.onCheckpoint });
  assert.equal(result.download.status, 'downloaded');
  assert.equal(caller.signal.aborted, false);
});

test('caller cancellation still aborts profile validation after transport timer is cleared', async t => {
  const f = await setup(t), caller = new AbortController();
  let entered;
  const validationEntered = new Promise(resolve => { entered = resolve; });
  const adapter = await createPackageAdapter({ packageApi: { ...publicPackage, validateProfile: async (_provider, options) => {
    assert.equal(options.signal, caller.signal); entered();
    await delay(10000, undefined, { signal: options.signal });
  } }, workDirectory: path.join(f.root, 'profile-cancel'), downloadMaxMs: 2000 });
  const pending = adapter.download(f.job, { provider: f.provider, signal: caller.signal, onCheckpoint: f.onCheckpoint });
  await validationEntered; caller.abort();
  await rejects(() => pending, 'LOCAL_ABORTED');
  assert.equal(Object.keys(f.previous.checkpoints).length, 3);
  assert.equal(f.previous.status, 'downloading');
  await assert.rejects(() => fs.stat(path.join(f.previous.modelDirectory, 'model.json')), { code: 'ENOENT' });
});

test('unknown application/runtime files are rejected before any download', async t => {
  const f = await setup(t); f.plan.resources[0].path = 'output/0/runtime.js';
  await rejects(() => f.adapter.download(f.job, { provider: f.provider, onCheckpoint: f.onCheckpoint }), 'UNSUPPORTED_PROFILE');
  assert.equal(f.calls.resources.length, 0);
});
