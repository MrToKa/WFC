import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, chmod, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createModelPreparer, createFakeProvider, createFakeCostProvider, createClosedProvider, issueFakeCostEvidence, createStore } from '../index.mjs';
import { setup, receipt, manifest, mutations, fakeClock, packageModulePath } from './helpers.mjs';

test('construct, capture, list and local read make zero provider or cost calls', async t => {
  const s = await setup(t);
  assert.deepEqual(await s.core.listJobs(), []);
  const job = await s.core.captureJob(s.spec);
  assert.equal((await s.core.readJob(job.jobId)).status, 'captured');
  assert.equal((await s.core.listJobs()).length, 1);
  assert.deepEqual(s.provider.calls, []); assert.deepEqual(s.costProvider.calls, []);
  assert.equal(job.frozen.source.sha256.length, 64);
  assert.notEqual(job.frozen.source.snapshotPath, s.sourcePath);
  assert.equal(path.basename(job.frozen.source.snapshotPath), 'fixture.nwd');
});

test('captured upload is immutable after original source path changes', async t => {
  const s = await setup(t);
  const job = await s.core.captureJob(s.spec);
  await writeFile(s.sourcePath, 'new bytes for another explicit job');
  assert.equal((await s.core.approveCost(job.jobId)).allowed, true);
  const result = await s.core.prepare(job.jobId);
  assert.equal(result.status, 'submitted');
  assert.equal(result.upload.sha256, job.frozen.source.sha256);
  assert.equal(mutations(s.provider).filter(c => c.operation === 'upload').length, 1);
});

test('corrupt captured upload bytes are rejected before provider calls', async t => {
  const s = await setup(t);
  const job = await s.core.captureJob(s.spec);
  await chmod(job.frozen.source.snapshotPath, 0o600);
  await writeFile(job.frozen.source.snapshotPath, 'corrupted immutable bytes');
  await s.core.approveCost(job.jobId);
  await assert.rejects(s.core.prepare(job.jobId), { code: 'SNAPSHOT_CHANGED' });
  assert.equal(s.provider.calls.length, 0);
});

for (const [name, change, expected] of [
  ['missing', () => null, 'COST_MISSING'],
  ['unknown', (ctx, clock) => issueFakeCostEvidence(ctx, { clock, status: 'unknown' }), 'COST_UNKNOWN'],
  ['paid', (ctx, clock) => issueFakeCostEvidence(ctx, { clock, amount: 1 }), 'COST_NONZERO'],
  ['expired', (ctx, clock) => issueFakeCostEvidence(ctx, { clock, checkedAt: new Date(clock.now() - 2000).toISOString(), expiresAt: new Date(clock.now() - 1000).toISOString() }), 'COST_EXPIRED'],
  ['quota exhausted', (ctx, clock) => issueFakeCostEvidence(ctx, { clock, quota: 0 }), 'COST_QUOTA'],
  ['wrong account', (ctx, clock) => issueFakeCostEvidence({ ...ctx, namespace: { ...ctx.namespace, account: 'other-account' } }, { clock }), 'COST_IDENTITY_MISMATCH'],
  ['wrong region', (ctx, clock) => issueFakeCostEvidence({ ...ctx, region: 'US' }, { clock }), 'COST_IDENTITY_MISMATCH'],
  ['wrong settings', (ctx, clock) => issueFakeCostEvidence({ ...ctx, conversion: { ...ctx.conversion, views: ['2d'] } }, { clock }), 'COST_IDENTITY_MISMATCH'],
  ['wrong source', (ctx, clock) => issueFakeCostEvidence({ ...ctx, source: { ...ctx.source, sha256: '0'.repeat(64) } }, { clock }), 'COST_IDENTITY_MISMATCH'],
  ['unverifiable', (ctx, clock) => ({ ...issueFakeCostEvidence(ctx, { clock }), attestation: '0'.repeat(64) }), 'COST_UNVERIFIABLE'],
]) test(`cost ${name} denies every mutation`, async t => {
  const s = await setup(t, { providerOptions: { handlers: { getStorage: async () => null } } });
  const job = await s.core.captureJob(s.spec);
  s.costProvider.setEvidence(change(job.frozen, s.clock));
  const decision = await s.core.approveCost(job.jobId);
  assert.equal(decision.allowed, false); assert.equal(decision.code, expected);
  await assert.rejects(s.core.prepare(job.jobId), { code: 'COST_BLOCKED' });
  assert.deepEqual(mutations(s.provider), []);
});

test('fake approval cannot activate the closed real adapter', async t => {
  const s = await setup(t, { provider: createClosedProvider() });
  const job = await s.core.captureJob(s.spec); await s.core.approveCost(job.jobId);
  await assert.rejects(s.core.prepare(job.jobId), { code: 'CLOUD_CLOSED' });
});

test('cost expires during upload: keep uploaded facts and resume without reupload', async t => {
  const clock = fakeClock();
  let uploaded;
  const provider = createFakeProvider({ clock, handlers: {
    getStorage: async ctx => ({ bucket: ctx.destination.bucket, namespace: ctx.namespace, region: ctx.region }),
    getObject: async () => uploaded || null,
    getManifest: async ctx => manifest(ctx),
    upload: async ctx => { uploaded = receipt(ctx); clock.advance(60001); return uploaded; },
  } });
  const s = await setup(t, { clock, provider });
  const job = await s.core.captureJob(s.spec); await s.core.approveCost(job.jobId);
  await assert.rejects(s.core.prepare(job.jobId), { code: 'COST_BLOCKED' });
  assert.equal((await s.core.readJob(job.jobId)).upload.status, 'uploaded');
  assert.equal(mutations(provider).filter(c => c.operation === 'submit').length, 0);
  s.costProvider.issue(job.frozen, { evidenceId: 'fresh-explicit-approval' });
  await s.core.approveCost(job.jobId);
  assert.equal((await s.core.prepare(job.jobId)).status, 'submitted');
  assert.equal(mutations(provider).filter(c => c.operation === 'upload').length, 1);
  assert.equal(mutations(provider).filter(c => c.operation === 'submit').length, 1);
});

test('same bytes and remote target with new job ID, label and output reuse one submission', async t => {
  const s = await setup(t);
  const first = await s.core.captureJob(s.spec);
  const second = await s.core.captureJob({ ...s.spec, label: 'Different label', output: path.join(s.root, 'other.zip') });
  assert.notEqual(first.jobId, second.jobId);
  assert.equal(first.frozen.submissionIdentity, second.frozen.submissionIdentity);
  await s.core.approveCost(first.jobId); await s.core.approveCost(second.jobId);
  await s.core.prepare(first.jobId); await s.core.prepare(second.jobId);
  assert.equal(mutations(s.provider).filter(c => c.operation === 'submit').length, 1);
  assert.equal((await s.core.readJob(second.jobId)).submission.attempts.length, 1);
});

test('two simultaneous explicit requests submit at most once', async t => {
  const s = await setup(t);
  const job = await s.core.captureJob(s.spec); await s.core.approveCost(job.jobId);
  const results = await Promise.allSettled([s.core.prepare(job.jobId), s.core.prepare(job.jobId)]);
  assert.ok(results.some(r => r.status === 'fulfilled'));
  assert.equal(mutations(s.provider).filter(c => c.operation === 'submit').length, 1);
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'LOCK_BUSY');
});

test('different source cannot overwrite a bound remote target', async t => {
  const s = await setup(t);
  const first = await s.core.captureJob(s.spec); await s.core.approveCost(first.jobId); await s.core.prepare(first.jobId);
  await writeFile(s.sourcePath, 'another source snapshot');
  const second = await s.core.captureJob({ ...s.spec, label: 'Changed source', output: path.join(s.root, 'changed.zip') });
  await s.core.approveCost(second.jobId);
  const before = mutations(s.provider).length;
  await assert.rejects(s.core.prepare(second.jobId), { code: 'IDENTITY_MISMATCH' });
  assert.equal(mutations(s.provider).length, before);
});

test('existing verified provider object and derivative reuse without cost or submission', async t => {
  const s = await setup(t, { providerOptions: { handlers: {
    getStorage: async ctx => ({ bucket: ctx.destination.bucket, namespace: ctx.namespace, region: ctx.region }),
    getObject: async ctx => receipt(ctx), getManifest: async ctx => manifest(ctx, 'success'),
  } } });
  const job = await s.core.captureJob(s.spec);
  const result = await s.core.prepare(job.jobId);
  assert.equal(result.submission.phase, 'complete'); assert.deepEqual(result.submission.attempts, []);
  assert.deepEqual(mutations(s.provider), []);
});

test('lost submit response, fresh approval, pending and missing manifests never resubmit', async t => {
  let status = 'not-found';
  const s = await setup(t, { providerOptions: { handlers: {
    getManifest: async ctx => manifest(ctx, status),
    submit: async () => { throw new Error('Bearer PRIVATE_TOKEN https://host/?signature=SECRET raw SDK response'); },
  } } });
  const job = await s.core.captureJob(s.spec); await s.core.approveCost(job.jobId);
  await assert.rejects(s.core.prepare(job.jobId), { code: 'PROVIDER_FAILURE' });
  assert.equal((await s.core.readJob(job.jobId)).status, 'submission-unknown');
  s.costProvider.issue(job.frozen, { evidenceId: 'new-approval-not-a-resubmit' }); await s.core.approveCost(job.jobId);
  for (status of ['not-found', 'pending', 'inprogress', 'not-found']) {
    const restarted = await createModelPreparer({ dataDirectory: s.dataDirectory, workDirectory: s.workDirectory, provider: s.provider, costProvider: s.costProvider, clock: s.clock, packageModulePath });
    assert.equal((await restarted.reconcile(job.jobId)).status, 'submission-unknown');
    await assert.rejects(restarted.prepare(job.jobId), { code: 'SUBMISSION_UNKNOWN' });
  }
  const result = await s.core.readJob(job.jobId);
  assert.equal(result.submission.attempts.length, 1);
  assert.equal(mutations(s.provider).filter(c => c.operation === 'submit').length, 1);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /PRIVATE_TOKEN|signature=SECRET|raw SDK|https:\/\/host/);
});

test('failed derivative never starts automatic forced conversion', async t => {
  const s = await setup(t, { providerOptions: { handlers: {
    getStorage: async ctx => ({ bucket: ctx.destination.bucket, namespace: ctx.namespace, region: ctx.region }),
    getObject: async ctx => receipt(ctx), getManifest: async ctx => manifest(ctx, 'failed'),
  } } });
  const job = await s.core.captureJob(s.spec);
  await assert.rejects(s.core.prepare(job.jobId), { code: 'DERIVATIVE_FAILED' });
  await s.core.approveCost(job.jobId);
  await assert.rejects(s.core.prepare(job.jobId), { code: 'DERIVATIVE_FAILED' });
  assert.deepEqual(mutations(s.provider), []);
});

test('provider remote object mismatch is rejected before conversion', async t => {
  const s = await setup(t, { providerOptions: { handlers: { upload: async ctx => ({ ...receipt(ctx), objectId: 'foreign-object' }) } } });
  const job = await s.core.captureJob(s.spec); await s.core.approveCost(job.jobId);
  await assert.rejects(s.core.prepare(job.jobId), { code: 'IDENTITY_MISMATCH' });
  assert.equal(mutations(s.provider).filter(c => c.operation === 'submit').length, 0);
});

test('safe read retries are bounded by attempt count and preserve zero mutations', async t => {
  let count = 0;
  const s = await setup(t, { providerOptions: { handlers: {
    getStorage: async ctx => { if (++count < 3) { const error = new Error('unsanitized SDK failure'); error.retryable = true; throw error; } return { bucket: ctx.destination.bucket, namespace: ctx.namespace, region: ctx.region }; },
    getObject: async ctx => receipt(ctx), getManifest: async ctx => manifest(ctx, 'success'),
  } } });
  const job = await s.core.captureJob(s.spec); await s.core.prepare(job.jobId);
  assert.equal(count, 3); assert.deepEqual(mutations(s.provider), []);
});

test('a never-resolving read times out without submitting', async t => {
  const s = await setup(t, { coreOptions: { readPolicy: { maxMs: 30 } }, providerOptions: { handlers: { getManifest: async () => new Promise(() => {}) } } });
  const job = await s.core.captureJob(s.spec);
  await assert.rejects(s.core.reconcile(job.jobId), { code: 'READ_LIMIT' });
  assert.deepEqual(mutations(s.provider), []);
});

test('local stop during submission keeps unknown outcome and never claims remote cancellation', async t => {
  let signalEntered;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const s = await setup(t, { providerOptions: { handlers: { submit: async (_ctx, { signal }) => { signalEntered(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('remote may still run')), { once: true })); } } } });
  const job = await s.core.captureJob(s.spec); await s.core.approveCost(job.jobId);
  const running = s.core.prepare(job.jobId); await entered;
  assert.deepEqual(s.core.stop(job.jobId), { localAbortRequested: true, remoteCancellationConfirmed: false });
  await assert.rejects(running, { code: 'LOCAL_ABORTED' });
  const stopped = await s.core.readJob(job.jobId);
  assert.equal(stopped.status, 'interrupted'); assert.equal(stopped.submission.phase, 'submission-unknown');
  assert.equal(stopped.interruption.remoteCancellationConfirmed, false);
  await assert.rejects(s.core.prepare(job.jobId), { code: 'SUBMISSION_UNKNOWN' });
});

test('state write failure before write-ahead commit makes zero submission calls', async t => {
  let failWrite = false;
  const s = await setup(t);
  const store = createStore({ dataDirectory: s.dataDirectory, workDirectory: s.workDirectory, clock: s.clock, fault: async (point, details) => { if (failWrite && point === 'beforeCommit' && details.kind === 'submission') throw new Error('disk write refused'); } });
  const core = await createModelPreparer({ dataDirectory: s.dataDirectory, workDirectory: s.workDirectory, store, provider: s.provider, costProvider: s.costProvider, clock: s.clock, packageModulePath });
  const job = await core.captureJob(s.spec); await core.approveCost(job.jobId); failWrite = true;
  await assert.rejects(core.prepare(job.jobId));
  assert.equal(mutations(s.provider).filter(c => c.operation === 'submit').length, 0);
});

test('corrupt/truncated durable job is never reset or allowed to mutate', async t => {
  const s = await setup(t);
  const job = await s.core.captureJob(s.spec); await s.core.approveCost(job.jobId);
  const directory = path.join(s.dataDirectory, 'records', 'job', job.jobId);
  const entries = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
  assert.ok(entries.length);
  const latest = path.join(directory, entries.at(-1)); await chmod(latest, 0o600); await writeFile(latest, '{"schemaVersion":');
  await assert.rejects(s.core.readJob(job.jobId), { code: 'STORE_CORRUPT' });
  await assert.rejects(s.core.prepare(job.jobId), { code: 'STORE_CORRUPT' });
  assert.deepEqual(mutations(s.provider), []);
  assert.equal(await readFile(latest, 'utf8'), '{"schemaVersion":');
});

test('explicit job specification rejects credentials, implicit paths and incompatible SVF2', async t => {
  const s = await setup(t);
  await assert.rejects(s.core.captureJob({ ...s.spec, credentials: 'secret-value' }), { code: 'INVALID_JOB' });
  await assert.rejects(s.core.captureJob({ ...s.spec, sourcePath: 'relative.nwd' }), { code: 'INVALID_JOB' });
  await assert.rejects(s.core.captureJob({ ...s.spec, conversion: { ...s.spec.conversion, format: 'svf2' } }), { code: 'UNSUPPORTED_PROFILE' });
  assert.deepEqual(s.provider.calls, []);
});

for (const [point, operation] of [['afterStorageIntent', 'createStorage'], ['afterUploadIntent', 'upload'], ['afterSubmitIntent', 'submit']]) test(`expiry at ${point} blocks the immediately following mutation`, async t => {
  const clock = fakeClock();
  const s = await setup(t, { clock, coreOptions: { fault: async event => { if (event === point) clock.advance(60001); } } });
  const job = await s.core.captureJob(s.spec); await s.core.approveCost(job.jobId);
  await assert.rejects(s.core.prepare(job.jobId), { code: 'COST_BLOCKED' });
  assert.equal(mutations(s.provider).filter(call => call.operation === operation).length, 0);
  const stopped = await s.core.readJob(job.jobId);
  assert.equal(stopped.costDecision.code, 'COST_EXPIRED');
  if (operation === 'submit') { assert.equal(stopped.upload.status, 'uploaded'); assert.equal(stopped.submission.phase, 'submission-unknown'); }
});

test('complete remote derivative never claims a local download before bytes arrive', async t => {
  const s = await setup(t, { providerOptions: { handlers: {
    getStorage: async ctx => ({ bucket: ctx.destination.bucket, namespace: ctx.namespace, region: ctx.region }),
    getObject: async ctx => receipt(ctx), getManifest: async ctx => manifest(ctx, 'success'),
  } } });
  const job = await s.core.captureJob(s.spec); await s.core.prepare(job.jobId);
  const repeated = await s.core.prepare(job.jobId);
  assert.equal(repeated.status, 'submitted'); assert.equal(repeated.download, null);
});

test('stop during polling backoff aborts the complete wait operation', async t => {
  let sleeping;
  const entered = new Promise(resolve => { sleeping = resolve; });
  const clock = { now: () => Date.now(), sleep: async (_ms, signal) => { sleeping(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('local stop')), { once: true })); } };
  const s = await setup(t, { clock });
  const job = await s.core.captureJob(s.spec);
  const waiting = s.core.waitForDerivative(job.jobId); await entered;
  assert.equal(s.core.stop(job.jobId).localAbortRequested, true);
  await assert.rejects(waiting, { code: 'LOCAL_ABORTED' });
  assert.equal(s.provider.calls.filter(call => call.operation === 'getManifest').length, 1);
  const interrupted = await s.core.readJob(job.jobId);
  assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.interruption.remoteCancellationConfirmed, false);
});

test('injected provider cannot mutate immutable capture/conversion context', async t => {
  const s = await setup(t, { providerOptions: { handlers: { getStorage: async ctx => { ctx.destination.bucket = 'other-bucket'; return null; } } } });
  const job = await s.core.captureJob(s.spec);
  await assert.rejects(s.core.prepare(job.jobId), { code: 'PROVIDER_FAILURE' });
  assert.equal((await s.core.readJob(job.jobId)).frozen.destination.bucket, s.spec.destination.bucket);
  assert.deepEqual(mutations(s.provider), []);
});

test('caller cannot change the selected specification during asynchronous capture', async t => {
  const s = await setup(t);
  const selected = { ...s.spec, conversion: { ...s.spec.conversion }, destination: { ...s.spec.destination } };
  const capturing = s.core.captureJob(selected);
  selected.conversion.format = 'svf2'; selected.destination.objectKey = 'other.nwd'; selected.region = 'US';
  const captured = await capturing;
  assert.equal(captured.frozen.conversion.format, 'svf'); assert.equal(captured.frozen.region, 'EMEA'); assert.equal(captured.frozen.destination.objectKey, 'immutable.nwd');
});

for (const kind of ['missing', 'unknown', 'unverifiable']) test(`latest ${kind} approval revokes a previous still-valid grant`, async t => {
  const s = await setup(t);
  const job = await s.core.captureJob(s.spec); assert.equal((await s.core.approveCost(job.jobId)).allowed, true);
  let evidence = kind === 'missing' ? null : issueFakeCostEvidence(job.frozen, { clock: s.clock, status: kind === 'unknown' ? 'unknown' : 'zero' });
  if (kind === 'unverifiable') evidence.attestation = '0'.repeat(64);
  s.costProvider.setEvidence(evidence);
  assert.equal((await s.core.approveCost(job.jobId)).allowed, false);
  assert.equal((await s.core.readJob(job.jobId)).costEvidence, null);
  await assert.rejects(s.core.prepare(job.jobId), { code: 'COST_BLOCKED' });
  assert.deepEqual(mutations(s.provider), []);
});
