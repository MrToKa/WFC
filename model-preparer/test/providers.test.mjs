import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { contextFromSpec, safeError, validateManifestObservation, validateReceipt } from '../lib/contracts.mjs';
import { createFakeProvider, createClosedProvider, createFakeTransport, isFakeProvider, isFakeTransport } from '../lib/providers.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const DATA = Buffer.from('captured fixture bytes');
function context(snapshotPath = path.resolve('unused.nwd')) {
  return contextFromSpec({ namespace: { account: 'test-account', application: 'test-app' }, region: 'EMEA', destination: { bucket: 'test-bucket', objectKey: 'model.nwd' },
    conversion: { format: 'svf', views: ['3d'], xAdsForce: false }, supportProfile: 'svf-local-7.130.0-v1', label: 'Fake fixture', output: path.resolve('unused.zip') },
  { name: 'model.nwd', bytes: DATA.length, sha256: sha256(DATA), snapshotPath, capturedAt: '2026-10-16T09:00:00.000Z' });
}
async function temp(t) {
  const base = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(base, 'routings-provider-test-'));
  assert.equal(path.dirname(directory), base);
  t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}

test('construction and local fixture access issue no provider/transport calls', () => {
  const provider = createFakeProvider(); assert.deepEqual(provider.calls, []); assert.deepEqual(provider.transport.calls, []);
  assert.equal(isFakeProvider(provider), true); assert.equal(isFakeProvider({ mode: 'fake', kind: 'fake' }), false);
  assert.equal(isFakeTransport(provider.transport), true); assert.equal(isFakeTransport({ mode: 'fake' }), false);
  assert.throws(() => createFakeProvider({ transport: { mode: 'fake', readResource() {} } }), { code: 'CONFIGURATION_INVALID' });
});
test('storage creation and object upload use exactly captured bytes', async t => {
  const directory = await temp(t), snapshot = path.join(directory, 'snapshot.nwd'); await fs.writeFile(snapshot, DATA);
  const ctx = context(snapshot), provider = createFakeProvider();
  assert.equal(await provider.getStorage(ctx), null);
  assert.deepEqual(await provider.createStorage(ctx), { bucket: ctx.destination.bucket, namespace: ctx.namespace, region: ctx.region });
  assert.equal(await provider.getObject(ctx), null);
  const receipt = await provider.upload(ctx, { sourcePath: snapshot, retries: 0 }); validateReceipt(receipt, ctx);
  assert.deepEqual(await provider.getObject(ctx), receipt); assert.equal(provider.counts.upload, 1);
});
test('corrupt snapshots cannot produce fake upload receipts', async t => {
  const directory = await temp(t), snapshot = path.join(directory, 'snapshot.nwd'); await fs.writeFile(snapshot, Buffer.from('different'));
  await assert.rejects(createFakeProvider().upload(context(snapshot), { sourcePath: snapshot, retries: 0 }), { code: 'SNAPSHOT_CHANGED' });
});
test('upload refuses .env path before any read and requires retries zero', async () => {
  const provider = createFakeProvider();
  await assert.rejects(provider.upload(context(), { sourcePath: path.resolve('.env'), retries: 0 }), { code: 'INVALID_JOB' });
  assert.throws(() => provider.upload(context(), { sourcePath: path.resolve('x.nwd'), retries: 1 }), { code: 'INVALID_JOB' });
});
test('existing object and manifest fixtures are read-only reusable observations', async () => {
  const ctx = context(), receipt = { objectId: ctx.objectId, bytes: ctx.source.bytes, sha256: ctx.source.sha256 };
  const provider = createFakeProvider({ objects: new Map([[ctx.objectId, receipt]]), manifests: new Map([[ctx.submissionIdentity, { status: 'success', roots: [{ rootId: 'root-a', format: 'svf', supportProfile: ctx.supportProfile }] }]]) });
  assert.deepEqual(await provider.getObject(ctx), receipt); validateManifestObservation(await provider.getManifest(ctx), ctx);
  assert.equal(provider.counts.upload, 0); assert.equal(provider.counts.submit, 0);
});
test('simulation submission returns bound identities and never force/retries', async () => {
  const ctx = context(), provider = createFakeProvider();
  const receipt = await provider.submit(ctx, { attemptId: 'attempt-a', retries: 0, xAdsForce: false });
  assert.equal(receipt.result, 'created'); assert.equal(receipt.objectId, ctx.objectId); assert.equal(receipt.submissionIdentity, ctx.submissionIdentity);
  const observation = await provider.getManifest(ctx); assert.equal(observation.status, 'pending'); validateManifestObservation(observation, ctx);
  for (const options of [{ retries: 1, xAdsForce: false }, { retries: 0, xAdsForce: true }]) assert.throws(() => provider.submit(ctx, { attemptId: 'attempt-b', ...options }), { code: 'UNSUPPORTED_PROFILE' });
  const svf2 = structuredClone(ctx); svf2.conversion.format = 'svf2'; assert.throws(() => provider.submit(svf2, { attemptId: 'attempt-c', retries: 0, xAdsForce: false }), { code: 'UNSUPPORTED_PROFILE' });
});
test('acceptance-then-timeout script preserves a queryable simulated derivative', async () => {
  const ctx = context(), provider = createFakeProvider({ handlers: { submit: async (value, options, controls) => { await controls.default(); throw new Error('simulated timeout'); } } });
  await assert.rejects(provider.submit(ctx, { attemptId: 'attempt-a', retries: 0, xAdsForce: false }), /simulated timeout/);
  assert.equal((await provider.getManifest(ctx)).status, 'pending'); assert.equal(provider.counts.submit, 1);
});
test('fake transport preserves stored gzip and returns explicit root/resource identities', async () => {
  const raw = gzipSync(Buffer.from('raw retained payload')), ctx = context();
  const provider = createFakeProvider({ resources: { '0.pf': raw } });
  await provider.submit(ctx, { attemptId: 'attempt-a', retries: 0, xAdsForce: false });
  const observation = await provider.getManifest(ctx), rootId = observation.roots[0].rootId;
  const plan = await provider.getDownloadPlan(ctx, { rootId });
  assert.equal(plan.schemaVersion, 1); assert.equal(plan.rootId, rootId); assert.equal(plan.resources[0].path, 'output/0/0.pf');
  assert.equal(plan.resources[0].sha256, sha256(raw));
  const chunks = []; for await (const chunk of provider.readResource(ctx, { resourceId: plan.resources[0].resourceId })) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), raw);
  assert.equal(provider.counts.readResource, 1);
});
test('explicit unknown root/resource requests are denied', async () => {
  const ctx = context(), provider = createFakeProvider({ resources: { '0.pf': DATA } });
  await assert.rejects(provider.getDownloadPlan(ctx, { rootId: 'missing-root' }), { code: 'DERIVATIVE_PENDING' });
  await assert.rejects((async () => { for await (const chunk of provider.readResource(ctx, { resourceId: 'missing-resource' })) void chunk; })(), { code: 'DOWNLOAD_INVALID' });
});
test('fake resources do not accept URL/token identifiers or string URL bodies', () => {
  for (const resources of [{ 'https://example.test/model': DATA }, { signed_url_private: DATA }, { '0.pf': 'https://example.test/private' }]) {
    assert.throws(() => createFakeTransport({ resources }), { code: 'CONFIGURATION_INVALID' });
  }
});
test('abort stops a local pending fake call without asserting remote cancellation', async () => {
  const controller = new AbortController(), provider = createFakeProvider({ handlers: { getManifest: () => new Promise(() => {}) } });
  const pending = provider.getManifest(context(), { signal: controller.signal }); controller.abort();
  await assert.rejects(pending, { code: 'LOCAL_ABORTED' }); assert.equal(provider.counts.getManifest, 1);
});
test('abort interrupts a pending raw transport iterator', async () => {
  const controller = new AbortController();
  const transport = createFakeTransport({ resources: { item: { path: 'output/0/0.pf', bytes: 1, body: () => ({ [Symbol.asyncIterator]() { return this; }, next: () => new Promise(() => {}) }) } } });
  const body = transport.readResource(context(), { resourceId: 'item', signal: controller.signal });
  const pending = body.next(); await Promise.resolve(); controller.abort();
  await assert.rejects(pending, { code: 'LOCAL_ABORTED' });
});
test('call summaries exclude callback errors, tokens, URLs and source paths', async () => {
  const provider = createFakeProvider({ handlers: { getManifest: () => { throw new Error('Bearer privatevalue https://example.test/?signature=private'); } } });
  await assert.rejects(provider.getManifest(context()));
  const serialized = JSON.stringify(provider.calls); assert.equal(serialized.includes('privatevalue'), false); assert.equal(serialized.includes('https'), false); assert.equal(serialized.includes('snapshotPath'), false);
  assert.deepEqual(safeError(new Error('Bearer privatevalue')), { code: 'PROVIDER_FAILURE', message: 'The provider operation did not return a usable result.' });
});
test('closed real adapter cannot be enabled by a fake proof, flags or credentials', () => {
  const provider = createClosedProvider(); assert.equal(isFakeProvider(provider), false);
  for (const method of ['getStorage', 'createStorage', 'getObject', 'upload', 'submit', 'getManifest', 'getDownloadPlan', 'readResource']) {
    assert.throws(() => provider[method](context(), { approved: true, retries: 0, xAdsForce: false }), { code: 'CLOUD_CLOSED' });
  }
  assert.deepEqual(provider.calls, []);
});
