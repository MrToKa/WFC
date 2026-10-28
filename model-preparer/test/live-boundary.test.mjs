import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createStore } from '../lib/store.mjs';
import { createModelPreparer } from '../lib/core.mjs';
import { createAPSCostProvider } from '../lib/aps-cost-provider.mjs';
import { brandAPSProvider, isAPSProvider, isAPSCostProvider } from '../lib/aps-capabilities.mjs';
import { createFakeProvider } from '../lib/providers.mjs';
import { createFakeCostProvider, evaluateCostEvidence, issueFakeCostEvidence } from '../lib/cost.mjs';
import { contextFromSpec, digest, validateReceipt } from '../lib/contracts.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const errorCode = code => error => error?.code === code;
const adapter = { download: async () => { throw new Error('unused fixture'); }, buildPackage: async () => { throw new Error('unused fixture'); }, registerPackage: async () => { throw new Error('unused fixture'); } };
async function fixture(t, { ttl = 60000, proofChange, readMax = 2 } = {}) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'preparer-live-boundary-'));
  t.after(async () => { assert.equal(path.dirname(root), parent); await fs.rm(root, { recursive: true, force: true }); });
  let at = Date.now(); const clock = { now: () => at, advance: milliseconds => { at += milliseconds; } };
  const bytes = Buffer.from('synthetic immutable NWD fixture'), sourcePath = path.join(root, 'fixture.nwd'); await fs.writeFile(sourcePath, bytes);
  const proofDirectory = path.join(root, 'proof'); await fs.mkdir(proofDirectory);
  const observation = Buffer.from('Synthetic authenticated operator-review observation fixture; no live account evidence.');
  await fs.writeFile(path.join(proofDirectory, 'observation.txt'), observation);
  const proof = { schemaVersion: 1, kind: 'autodesk-account-operator-review', reviewId: randomUUID(), checkedAt: new Date(at).toISOString(), expiresAt: new Date(at + ttl).toISOString(),
    account: { applicationHash: 'a'.repeat(64), teamHash: 'b'.repeat(64), hubHash: 'c'.repeat(64), offering: 'Free', paidFallback: false, regionHash: hash('EMEA'), bucketHash: 'd'.repeat(64) },
    operations: { storage: { zero: true, count: 1 }, upload: { zero: true, count: 1, maxBytes: 2 * 1024 ** 3 }, submit: { zero: true, count: 1, complexJobsRemaining: 10 }, read: { zero: true, maxCalls: readMax, remainingConservative: 9990 } },
    approvedSources: [{ name: 'fixture.nwd', bytes: bytes.length, sha256: hash(bytes) }], conversion: { format: 'svf', views: ['3d'], xAdsForce: false }, supportProfile: 'svf-local-7.130.0-v1',
    origins: ['https://manage.autodesk.com/'], observations: { artifacts: [{ name: 'observation.txt', bytes: observation.length, sha256: hash(observation) }], basicCallsObserved: 10, complexJobsObserved: 0, complexChargedUnitsAvailable: 5, complexJobsPerChargedUnit: 2, basicCallsPerChargedUnit: 10000, nextRefresh: '2026-11-14', readAllowanceDerivation: 'fixture allowance' },
    verifier: { method: 'authenticated-browser-review', actor: 'authorized-operator', bindingMatches: true }, authorization: { explicitUserAuthorized: true, confirmedAt: new Date(at).toISOString() } };
  if (proofChange) proofChange(proof);
  const serialized = JSON.stringify(proof, null, 2) + '\n', proofPath = path.join(proofDirectory, 'proof.json'); await fs.writeFile(proofPath, serialized);
  const store = createStore({ dataDirectory: path.join(root, 'data'), workDirectory: path.join(root, 'work'), clock }); await store.init();
  const options = { proofPath, proofSha256: hash(serialized), signingKeyPath: path.join(root, 'security', 'signing.key'), store, clock };
  const costProvider = await createAPSCostProvider(options);
  const spec = { sourcePath, namespace: { account: `team-${proof.account.teamHash}`, application: `app-${proof.account.applicationHash}` }, region: 'EMEA', destination: { bucket: `target-${proof.account.bucketHash}`, objectKey: 'fixture.nwd' }, conversion: proof.conversion, supportProfile: proof.supportProfile, label: 'Fixture', output: path.join(root, 'result.zip') };
  const context = contextFromSpec(spec, { name: 'fixture.nwd', bytes: bytes.length, sha256: hash(bytes), snapshotPath: sourcePath, capturedAt: new Date(at).toISOString() });
  return { root, sourcePath, proofPath, proofDirectory, proof, options, costProvider, store, clock, spec, context };
}
function apsFixture({ clock, submit, getObject, getManifest, upload } = {}) {
  const counts = { createStorage: 0, upload: 0, submit: 0 };
  const receipt = context => ({ objectId: context.objectId, bytes: context.source.bytes, sha256: context.source.sha256, identityBasis: 'aps-sha1-and-local-sha256', remoteSha1: '1'.repeat(40), localSha1: '1'.repeat(40), remoteObjectIdHash: '2'.repeat(64) });
  const observation = (context, status = 'not-found') => ({ status, objectId: context.objectId, urn: context.urn, submissionIdentity: context.submissionIdentity, roots: status === 'success' ? [{ rootId: 'root-one', format: 'svf', supportProfile: context.supportProfile }] : [] });
  const api = {
    mode: 'aps', counts,
    async getStorage(context) { return { bucket: context.destination.bucket, namespace: context.namespace, region: context.region }; },
    async createStorage(context, options) { options.assertMutationAllowed(); counts.createStorage++; return { bucket: context.destination.bucket, namespace: context.namespace, region: context.region }; },
    async getObject(context) { return getObject ? getObject(context, receipt) : null; },
    async getManifest(context) { return getManifest ? getManifest(context, observation) : observation(context); },
    async upload(context, options) { if (upload) return upload(context, options, counts, receipt); options.assertMutationAllowed(); counts.upload++; return receipt(context); },
    async submit(context, options) {
      if (submit) return submit(context, options, counts);
      options.assertMutationAllowed(); counts.submit++;
      return { result: 'success', objectId: context.objectId, urn: context.urn, submissionIdentity: context.submissionIdentity, providerReceipt: { kind: 'aps-job-response', remoteUrnHash: '3'.repeat(64), format: 'svf', views: ['3d'], responseSha256: '4'.repeat(64) } };
    },
    async getDownloadPlan() { throw new Error('unused fixture'); }, async readResource() { throw new Error('unused fixture'); },
  };
  brandAPSProvider(api); return api;
}
async function coreFor(f, provider, costProvider = f.costProvider) { return createModelPreparer({ store: f.store, workDirectory: path.join(f.root, 'work'), provider, costProvider, clock: f.clock, packageAdapter: adapter }); }

test('APS factories are branded; plain labelled objects and fake cost grants are not live capabilities', async t => {
  const f = await fixture(t);
  assert.equal(isAPSProvider({ mode: 'aps' }), false); assert.equal(isAPSCostProvider({ mode: 'live' }), false); assert.equal(isAPSCostProvider(f.costProvider), true);
  const provider = apsFixture(), core = await coreFor(f, provider, createFakeCostProvider({ clock: f.clock }));
  const job = await core.captureJob(f.spec);
  await assert.rejects(() => core.approveCost(job.jobId), errorCode('CLOUD_CLOSED'));
  await assert.rejects(() => core.prepare(job.jobId), errorCode('CLOUD_CLOSED'));
  assert.deepEqual(provider.counts, { createStorage: 0, upload: 0, submit: 0 });
  assert.equal(f.costProvider.verifyEvidence(issueFakeCostEvidence(f.context, { clock: f.clock }), f.context), false);
});

test('HMAC evidence is stable across approval/restart, scoped exactly, private and independently verified', async t => {
  const f = await fixture(t), evidence = await f.costProvider.getEvidence(f.context);
  assert.equal(evidence.kind, 'aps-operator'); assert.equal(f.costProvider.verifyEvidence(evidence, f.context), true);
  assert.equal(evaluateCostEvidence({ evidence, context: f.context, operation: 'submit', now: f.clock.now(), verified: false }).allowed, false);
  assert.equal(evaluateCostEvidence({ evidence, context: f.context, operation: 'submit', now: f.clock.now(), verified: true }).allowed, true);
  assert.equal(f.costProvider.verifyEvidence({ ...evidence, attestation: '0'.repeat(64) }, f.context), false);
  assert.equal(f.costProvider.verifyEvidence(evidence, { ...f.context, namespace: { ...f.context.namespace, application: 'other-app' } }), false);
  assert.equal(await f.costProvider.getEvidence({ ...f.context, source: { ...f.context.source, sha256: '0'.repeat(64) } }), null);
  const reopened = await createAPSCostProvider(f.options); assert.deepEqual(await reopened.getEvidence(f.context), evidence);
  assert.equal((await fs.stat(f.options.signingKeyPath)).size, 32);
  if (process.platform !== 'win32') assert.equal((await fs.stat(f.options.signingKeyPath)).mode & 0o077, 0);
  assert.ok(!JSON.stringify(evidence).includes(f.options.signingKeyPath));
});

test('expiry, missing or changed proof/artifact and key tampering deny current approval', async t => {
  const f = await fixture(t, { ttl: 1000 }), evidence = await f.costProvider.getEvidence(f.context);
  await fs.writeFile(path.join(f.proofDirectory, 'observation.txt'), 'tampered');
  assert.equal(f.costProvider.verifyEvidence(evidence, f.context), false); assert.equal(f.costProvider.getReadiness().state, 'blocked');
  await fs.writeFile(path.join(f.proofDirectory, 'observation.txt'), 'Synthetic authenticated operator-review observation fixture; no live account evidence.');
  f.clock.advance(1000); assert.equal(f.costProvider.getReadiness().code, 'COST_EXPIRED'); assert.equal(await f.costProvider.getEvidence(f.context), null);
  const other = await fixture(t); const grant = await other.costProvider.getEvidence(other.context);
  await fs.writeFile(other.options.signingKeyPath, Buffer.alloc(32)); assert.equal(other.costProvider.verifyEvidence(grant, other.context), false);
  await fs.unlink(other.proofPath); assert.equal(other.costProvider.getReadiness().state, 'blocked');
});

for (const [name, change] of [
  ['unknown root field', proof => { proof.unknown = true; }],
  ['paid fallback', proof => { proof.account.paidFallback = true; }],
  ['unverified operator binding', proof => { proof.verifier.bindingMatches = false; }],
  ['foreign source URL', proof => { proof.origins = ['https://example.test/']; }],
  ['invalid calendar', proof => { proof.checkedAt = '2026-02-30T00:00:00.000Z'; }],
  ['no explicit authorization', proof => { proof.authorization.explicitUserAuthorized = false; }],
  ['traversal artifact name', proof => { proof.observations.artifacts[0].name = '../observation.txt'; }],
]) test(`operator review rejects ${name}`, async t => {
  const f = await fixture(t, { proofChange: change }); assert.equal(f.costProvider.getReadiness().state, 'blocked'); assert.equal(await f.costProvider.getEvidence(f.context), null);
});

test('read reservations are durable and global; reapproval/restart cannot reset the budget', async t => {
  const f = await fixture(t); await f.costProvider.reserveRead(f.context); await f.costProvider.reserveRead(f.context);
  const reopened = await createAPSCostProvider(f.options); await reopened.getEvidence(f.context);
  await assert.rejects(() => reopened.reserveRead(f.context), errorCode('READ_LIMIT'));
  const rows = await f.store.list('cost'); assert.equal(rows.find(row => row.kind === 'aps-read-budget').used, 2);
});

test('mutation reservations are global per proof across distinct operation identities and survive restart', async t => {
  const f = await fixture(t), other = { ...f.context, destination: { ...f.context.destination, objectKey: 'other.nwd' }, submissionIdentity: '9'.repeat(64) };
  await f.costProvider.reserveMutation(f.context, 'submit');
  const reopened = await createAPSCostProvider(f.options); await reopened.getEvidence(other);
  await assert.rejects(() => reopened.reserveMutation(other, 'submit'), errorCode('COST_QUOTA'));
  assert.equal((await f.store.list('cost')).find(row => row.kind === 'aps-mutation-budget').counts.submit, 1);
});

test('APS normalized receipt proves local SHA256 plus matching remote/local SHA1 rather than a remote SHA256 claim', async t => {
  const f = await fixture(t), provider = apsFixture();
  const core = await coreFor(f, provider), job = await core.captureJob(f.spec); assert.equal((await core.approveCost(job.jobId)).allowed, true);
  const result = await core.prepare(job.jobId);
  assert.equal(result.submission.providerFamily, 'aps'); assert.equal(result.upload.identityBasis, 'aps-sha1-and-local-sha256');
  assert.equal(result.upload.remoteSha1, result.upload.localSha1); assert.equal(result.upload.sha256, f.context.source.sha256);
  assert.equal(result.submission.acknowledgements[0].providerJobId, undefined); assert.equal(result.submission.acknowledgements[0].providerReceipt.kind, 'aps-job-response');
  await core.prepare(job.jobId); assert.equal(provider.counts.submit, 1);
  assert.throws(() => validateReceipt({ objectId: f.context.objectId, bytes: f.context.source.bytes, sha256: f.context.source.sha256, identityBasis: 'aps-sha1-and-local-sha256', remoteSha1: '1'.repeat(40), localSha1: '0'.repeat(40), remoteObjectIdHash: '2'.repeat(64) }, f.context), errorCode('PROVIDER_RESPONSE_INVALID'));
});

test('final mutation callback rejects proof expiring after provider await and retains unknown intent', async t => {
  const f = await fixture(t, { ttl: 1000 }), provider = apsFixture({ submit: async (context, options, counts) => {
    await Promise.resolve(); f.clock.advance(1000); options.assertMutationAllowed(); counts.submit++; assert.fail('expired proof cannot reach a wire POST');
  } });
  const core = await coreFor(f, provider), job = await core.captureJob(f.spec); await core.approveCost(job.jobId);
  await assert.rejects(() => core.prepare(job.jobId), errorCode('COST_BLOCKED'));
  assert.equal(provider.counts.submit, 0); assert.equal((await core.readJob(job.jobId)).submission.phase, 'submission-unknown');
  await assert.rejects(() => core.prepare(job.jobId), errorCode('SUBMISSION_UNKNOWN')); assert.equal(provider.counts.submit, 0);
});

test('lost APS response preserves authoritative unknown WAL and prevents a second POST', async t => {
  const f = await fixture(t), provider = apsFixture({ submit: async (context, options, counts) => { options.assertMutationAllowed(); counts.submit++; throw new Error('foreign-secret-body-must-not-persist'); } });
  const core = await coreFor(f, provider), job = await core.captureJob(f.spec); await core.approveCost(job.jobId);
  await assert.rejects(() => core.prepare(job.jobId), errorCode('PROVIDER_FAILURE'));
  assert.equal(provider.counts.submit, 1); assert.equal((await core.readJob(job.jobId)).submission.phase, 'submission-unknown');
  assert.ok(!JSON.stringify(await core.readJob(job.jobId)).includes('foreign-secret-body'));
  await assert.rejects(() => core.prepare(job.jobId), errorCode('SUBMISSION_UNKNOWN')); assert.equal(provider.counts.submit, 1);
});

test('fake and legacy ambiguous submission ledgers never become live eligibility', async t => {
  const f = await fixture(t), fakeCore = await coreFor(f, createFakeProvider({ clock: f.clock }), createFakeCostProvider({ clock: f.clock }));
  const job = await fakeCore.captureJob(f.spec); await fakeCore.approveCost(job.jobId); await fakeCore.prepare(job.jobId);
  const provider = apsFixture(), liveCore = await coreFor(f, provider);
  await assert.rejects(() => liveCore.prepare(job.jobId), errorCode('CLOUD_CLOSED')); assert.equal(provider.counts.submit, 0);
  const key = (await fakeCore.readJob(job.jobId)).frozen.submissionIdentity;
  await f.store.withLock('submission', key, async lease => { const ledger = await f.store.read('submission', key); delete ledger.providerFamily; await f.store.write('submission', key, ledger, { lease }); });
  await assert.rejects(() => liveCore.prepare(job.jobId), errorCode('CLOUD_CLOSED'));
  assert.equal(provider.counts.submit, 0);
});

test('read-only existing APS object/derivative reuse makes no mutation or invented acknowledgement', async t => {
  const f = await fixture(t), provider = apsFixture({ getObject: (context, receipt) => receipt(context), getManifest: (context, observation) => observation(context, 'success') });
  const core = await coreFor(f, provider), job = await core.captureJob(f.spec), result = await core.prepare(job.jobId);
  assert.equal(result.submission.phase, 'complete'); assert.equal(result.upload.reused, true); assert.equal(result.submission.attempts.length, 0); assert.equal(result.submission.acknowledgements.length, 0);
  assert.deepEqual(provider.counts, { createStorage: 0, upload: 0, submit: 0 });
});
