import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createModelPreparer } from '../index.mjs';
import { setup, packageModulePath } from './helpers.mjs';
import { tinyModel } from './fixtures/model-fixture.mjs';

function fixtureResources() {
  const fixture = tinyModel();
  return Object.fromEntries(fixture.resources.map(row => [row.resourceId, { ...row, data: fixture.data.get(row.path) }]));
}
test('complete fake core pipeline uses the unchanged public Package A packager/verifier', async t => {
  const s = await setup(t, { providerOptions: { resources: fixtureResources() } });
  const captured = await s.core.captureJob(s.spec);
  await s.core.approveCost(captured.jobId);
  const submitted = await s.core.prepare(captured.jobId);
  assert.equal(submitted.submission.attempts[0].intent.source.sha256, captured.frozen.source.sha256);
  assert.equal(submitted.submission.acknowledgements.length, 1);
  const reconciled = await s.core.reconcile(captured.jobId); assert.equal(reconciled.submission.phase, 'complete');
  const downloaded = await s.core.download(captured.jobId); assert.equal(downloaded.download.status, 'downloaded');
  assert.equal(Object.keys(downloaded.download.checkpoints).length, 3);
  const packaged = await s.core.buildPackage(captured.jobId);
  assert.equal(packaged.status, 'packaged'); assert.equal(packaged.package.status, 'PASS');
  assert.equal(packaged.package.resourceCount, 3);
  assert.equal(packaged.package.source.identityBasis, 'observed-local-file');
  assert.equal(packaged.package.source.sha256, captured.frozen.source.sha256);
  const api = await import(pathToFileURL(packageModulePath).href);
  const report = await api.verifyPackage(s.spec.output);
  assert.equal(report.status, 'PASS'); assert.equal(report.contentFingerprint, packaged.package.contentFingerprint);
  assert.deepEqual(packaged.lastGoodPackage, packaged.package);
  const beforeCalls = s.provider.calls.length;
  const registered = await s.core.registerPackage({ packagePath: s.spec.output });
  assert.equal(registered.kind, 'registered'); assert.equal(registered.submission, null);
  assert.equal(s.provider.calls.length, beforeCalls);
});

test('core restart resumes checked downloads and only replaces corrupt or missing resources', async t => {
  let interrupted = false;
  const s = await setup(t, { providerOptions: { resources: fixtureResources(), handlers: {
    readResource: async (ctx, options, fixture) => { if (!interrupted && options.resourceId === 'resource-0') { interrupted = true; throw new Error('fake transport disconnected'); } return fixture.default(); },
  } } });
  const captured = await s.core.captureJob(s.spec); await s.core.approveCost(captured.jobId); await s.core.prepare(captured.jobId); await s.core.reconcile(captured.jobId);
  await assert.rejects(s.core.download(captured.jobId), { code: 'PROVIDER_FAILURE' });
  const partial = await s.core.readJob(captured.jobId);
  assert.equal(Object.keys(partial.download.checkpoints).length, 1);
  const firstPath = Object.keys(partial.download.checkpoints)[0];
  // Discover the adapter's fixed modelDirectory through its checkpoint's own path.
  const modelDirectory = partial.download.modelDirectory || path.join(s.workDirectory, captured.jobId, 'model');
  const corruptPath = path.join(modelDirectory, firstPath);
  await chmod(corruptPath, 0o600); await writeFile(corruptPath, 'corrupt checkpoint bytes');
  const restarted = await createModelPreparer({ dataDirectory: s.dataDirectory, workDirectory: s.workDirectory, packageModulePath, provider: s.provider, costProvider: s.costProvider, clock: s.clock });
  const result = await restarted.download(captured.jobId);
  assert.equal(result.download.status, 'downloaded');
  assert.equal(s.provider.calls.filter(c => c.operation === 'readResource' && c.resourceId === 'resource-1').length, 2);
  assert.equal(s.provider.calls.filter(c => c.operation === 'readResource' && c.resourceId === 'resource-2').length, 1);
});

test('package failure preserves the last verified core result and ZIP bytes', async t => {
  const s = await setup(t, { providerOptions: { resources: fixtureResources() } });
  const captured = await s.core.captureJob(s.spec); await s.core.approveCost(captured.jobId); await s.core.prepare(captured.jobId); await s.core.reconcile(captured.jobId); await s.core.download(captured.jobId);
  const good = await s.core.buildPackage(captured.jobId), zip = await readFile(s.spec.output);
  const target = path.join(good.download.modelDirectory, 'output', '0', '0.pf');
  await chmod(target, 0o600); await writeFile(target, 'corrupted package input');
  await assert.rejects(s.core.buildPackage(captured.jobId));
  const failed = await s.core.readJob(captured.jobId);
  assert.deepEqual(failed.lastGoodPackage, good.lastGoodPackage);
  assert.deepEqual(await readFile(s.spec.output), zip);
});
