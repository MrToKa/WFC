import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createStore } from '../lib/store.mjs';
import { createModelPreparer } from '../lib/core.mjs';
import { createEngineerCostProvider } from '../lib/engineer-cost-provider.mjs';
import { evaluateCostEvidence, createFakeCostProvider, issueFakeCostEvidence } from '../lib/cost.mjs';
import { brandAPSProvider, isAPSCostProvider } from '../lib/aps-capabilities.mjs';
import { contextFromSpec, PROFILE } from '../lib/contracts.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const code = expected => error => error?.code === expected;
const noPackage = { async download() { assert.fail('no package IO'); }, async buildPackage() { assert.fail('no package IO'); }, async registerPackage() { assert.fail('no package IO'); } };
async function fixture(t, options = {}) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'preparer-engineer-cost-'));
  t.after(async () => { assert.equal(path.dirname(root), parent); await fs.rm(root, { recursive: true, force: true }); });
  let at = Date.now();
  const clock = { now: () => at, advance: milliseconds => { at += milliseconds; } };
  let auth = { enabled: true, configurationId: 'a'.repeat(64), accountHash: hash('local-account-alias'), applicationHash: hash('test-client-id'), bucketHash: hash('test-bucket'), region: 'EMEA', freePlanConfirmedBy: 'wfc-engineer-1', freePlanConfirmedAt: new Date(at).toISOString() };
  const bytes = Buffer.from('immutable synthetic NWD; no Autodesk request');
  const sourcePath = path.join(root, 'fixture.nwd'); await fs.writeFile(sourcePath, bytes);
  const store = createStore({ dataDirectory: path.join(root, 'data'), workDirectory: path.join(root, 'work'), clock }); await store.init();
  const configuration = { store, clock, signingKeyPath: path.join(root, 'security', 'engineer.key'), getAuthorization: () => auth, ...options };
  const provider = await createEngineerCostProvider(configuration);
  const spec = { sourcePath, namespace: { account: `team-${auth.accountHash}`, application: `app-${auth.applicationHash}` }, region: auth.region, destination: { bucket: `target-${auth.bucketHash}`, objectKey: 'fixture.nwd' }, conversion: { format: 'svf', views: ['3d'], xAdsForce: false }, supportProfile: PROFILE, label: 'Fixture', output: path.join(root, 'fixture.zip') };
  const context = contextFromSpec(spec, { name: 'fixture.nwd', bytes: bytes.length, sha256: hash(bytes), snapshotPath: sourcePath, capturedAt: new Date(at).toISOString() });
  return { root, clock, spec, context, provider, configuration, store, get auth() { return auth; }, set auth(value) { auth = value; } };
}
const decision = (f, evidence, overrides = {}) => evaluateCostEvidence({ evidence, context: f.context, operation: 'submit', now: f.clock.now(), verified: f.provider.verifyEvidence(evidence, f.context), ...overrides });

test('engineer declaration is private signed local authorization and never claims Autodesk remaining quota', async t => {
  const f = await fixture(t), evidence = await f.provider.getEvidence(f.context);
  assert.equal(isAPSCostProvider(f.provider), true);
  assert.equal(evidence.kind, 'engineer-declared-free');
  assert.equal(evidence.origin.kind, 'engineer-declared-free');
  assert.match(evidence.price.basis, /engineer-declared.*quota-unknown/);
  assert.equal(evidence.price.amount, 0);
  assert.deepEqual(evidence.allowances, { storage: { count: 1, quotaRemaining: null }, upload: { count: 1, quotaRemaining: null }, submit: { count: 1, quotaRemaining: null } });
  assert.equal(decision(f, evidence).allowed, true);
  assert.match(decision(f, evidence).reason, /quota is unknown/);
  assert.equal(decision(f, evidence, { verified: false }).allowed, false);
  assert.equal(f.provider.getReadiness().state, 'engineer-declared');
  assert.equal(f.provider.getReadiness().quotaKnown, false);
  assert.ok(!JSON.stringify(evidence).includes('wfc-engineer-1'));
  assert.ok(!JSON.stringify(evidence).includes(f.configuration.signingKeyPath));
  assert.equal((await fs.stat(f.configuration.signingKeyPath)).size, 32);
  for (const altered of [{ ...evidence, attestation: '0'.repeat(64) }, { ...evidence, price: { ...evidence.price, basis: 'autodesk-verified-free-balance' } }, { ...evidence, allowances: { ...evidence.allowances, submit: { count: 9, quotaRemaining: 9 } } }]) assert.equal(f.provider.verifyEvidence(altered, f.context), false);
  assert.equal(f.provider.verifyEvidence(issueFakeCostEvidence(f.context), f.context), false);
});

test('unknown quotas remain rejected for fake and prior operator proofs', async t => {
  const f = await fixture(t), fake = issueFakeCostEvidence(f.context, { clock: f.clock });
  fake.allowances.submit.quotaRemaining = null;
  assert.equal(evaluateCostEvidence({ evidence: fake, context: f.context, operation: 'submit', now: f.clock.now(), verified: true }).allowed, false);
  const evidence = await f.provider.getEvidence(f.context);
  const changed = { ...evidence, allowances: { ...evidence.allowances, submit: { count: 2, quotaRemaining: null } } };
  assert.equal(evaluateCostEvidence({ evidence: changed, context: f.context, operation: 'submit', now: f.clock.now(), verified: true }).allowed, false);
});

test('the complete active settings revision and exact source/remote identities are required', async t => {
  const f = await fixture(t), evidence = await f.provider.getEvidence(f.context);
  for (const change of [
    { ...f.context, source: { ...f.context.source, sha256: '9'.repeat(64) } },
    { ...f.context, namespace: { ...f.context.namespace, account: `team-${'9'.repeat(64)}` } },
    { ...f.context, destination: { ...f.context.destination, bucket: `target-${'9'.repeat(64)}` } },
    { ...f.context, region: 'US' },
    { ...f.context, submissionIdentity: '9'.repeat(64) },
  ]) {
    assert.equal(f.provider.verifyEvidence(evidence, change), false);
    assert.equal(await f.provider.getEvidence(change), null);
  }
  f.auth = { ...f.auth, configurationId: 'b'.repeat(64) };
  assert.equal(f.provider.verifyEvidence(evidence, f.context), false);
  const renewed = await f.provider.getEvidence(f.context);
  assert.notEqual(renewed.evidenceId, evidence.evidenceId);
  f.auth = { ...f.auth, enabled: false };
  assert.equal(f.provider.verifyEvidence(renewed, f.context), false);
  assert.equal(await f.provider.getEvidence(f.context), null);
  assert.equal(f.provider.getReadiness().state, 'blocked');
  await assert.rejects(() => f.provider.reserveMutation(f.context, 'submit'), code('COST_UNKNOWN'));
});

test('expired internal leases renew automatically with stable ID and durable one-submit budget after restart', async t => {
  const f = await fixture(t, { leaseMs: 1000 });
  const first = await f.provider.getEvidence(f.context);
  await f.provider.reserveMutation(f.context, 'submit');
  f.clock.advance(1000);
  assert.equal(f.provider.verifyEvidence(first, f.context), false);
  const reopened = await createEngineerCostProvider(f.configuration), next = await reopened.getEvidence(f.context);
  assert.equal(next.evidenceId, first.evidenceId);
  assert.notEqual(next.checkedAt, first.checkedAt);
  assert.equal(reopened.verifyEvidence(next, f.context), true);
  assert.deepEqual(await reopened.getEvidence(f.context), next);
  await assert.rejects(() => reopened.reserveMutation(f.context, 'submit'), code('COST_QUOTA'));
  f.auth = { ...f.auth, configurationId: 'c'.repeat(64) };
  assert.ok(await reopened.getEvidence(f.context));
  await assert.rejects(() => reopened.reserveMutation(f.context, 'submit'), code('COST_QUOTA'));
  assert.equal((await f.store.list('cost')).find(row => row.kind === 'engineer-declared-local-budget').counts.submit, 1);
});

test('descriptive source renaming and multiple job outputs share the same mutation budget', async t => {
  const f = await fixture(t), first = await f.provider.getEvidence(f.context);
  const renamed = { ...f.context, source: { ...f.context.source, name: 'renamed.nwd' }, output: path.join(f.root, 'another.zip'), label: 'Another job' };
  const second = await f.provider.getEvidence(renamed);
  assert.notEqual(first.evidenceId, second.evidenceId);
  await f.provider.reserveMutation(f.context, 'upload');
  await assert.rejects(() => f.provider.reserveMutation(renamed, 'upload'), code('COST_QUOTA'));
  await f.provider.reserveMutation(renamed, 'submit');
  await assert.rejects(() => f.provider.reserveMutation(f.context, 'submit'), code('COST_QUOTA'));
});

test('read budgets are local, bounded and shared across configuration and lease renewal', async t => {
  const f = await fixture(t, { leaseMs: 1000, maxReadCalls: 2 });
  await f.provider.reserveRead(f.context);
  f.clock.advance(1000);
  f.auth = { ...f.auth, configurationId: 'd'.repeat(64) };
  const reopened = await createEngineerCostProvider(f.configuration);
  await reopened.reserveRead(f.context);
  await assert.rejects(() => reopened.reserveRead(f.context), code('READ_LIMIT'));
  assert.equal((await f.store.list('cost')).find(row => row.kind === 'engineer-declared-local-budget').reads, 2);
  await assert.rejects(() => createEngineerCostProvider({ ...f.configuration, maxReadCalls: 2001 }), code('CONFIGURATION_INVALID'));
});

test('key replacement, asynchronous settings, future confirmation and aborted calls cannot authorize', async t => {
  const f = await fixture(t), evidence = await f.provider.getEvidence(f.context);
  await fs.writeFile(f.configuration.signingKeyPath, Buffer.alloc(32));
  assert.equal(f.provider.verifyEvidence(evidence, f.context), false);
  assert.equal(await f.provider.getEvidence(f.context), null);
  const other = await fixture(t);
  const asynchronous = await createEngineerCostProvider({ ...other.configuration, getAuthorization: async () => other.auth });
  assert.equal(await asynchronous.getEvidence(other.context), null);
  other.auth = { ...other.auth, freePlanConfirmedAt: new Date(other.clock.now() + 1).toISOString() };
  assert.equal(await other.provider.getEvidence(other.context), null);
  await assert.rejects(() => other.provider.getEvidence(other.context, { signal: AbortSignal.abort() }), code('LOCAL_ABORTED'));
});

function apsFixture({ loseSubmit = false, beforeSubmit = () => {} } = {}) {
  const counts = { upload: 0, submit: 0 };
  return brandAPSProvider({
    mode: 'aps', counts,
    async getStorage(context) { return { bucket: context.destination.bucket, namespace: context.namespace, region: context.region }; },
    async getObject() { return null; },
    async getManifest(context) { return { status: 'not-found', objectId: context.objectId, urn: context.urn, submissionIdentity: context.submissionIdentity, roots: [] }; },
    async upload(context, options) { options.assertMutationAllowed(); counts.upload++; return { objectId: context.objectId, bytes: context.source.bytes, sha256: context.source.sha256, identityBasis: 'aps-sha1-and-local-sha256', remoteSha1: '1'.repeat(40), localSha1: '1'.repeat(40), remoteObjectIdHash: '2'.repeat(64) }; },
    async submit(context, options) {
      beforeSubmit(); options.assertMutationAllowed(); counts.submit++;
      if (loseSubmit) throw new Error('simulated lost response');
      return { result: 'success', objectId: context.objectId, urn: context.urn, submissionIdentity: context.submissionIdentity, providerReceipt: { kind: 'aps-job-response', remoteUrnHash: '3'.repeat(64), format: 'svf', views: ['3d'], responseSha256: '4'.repeat(64) } };
    },
  });
}
async function coreFor(f, provider, costProvider = f.provider) {
  return createModelPreparer({ store: f.store, workDirectory: path.join(f.root, 'work'), provider, costProvider, clock: f.clock, packageAdapter: noPackage });
}
test('declared provider preserves branded boundary and core idempotent WAL', async t => {
  const f = await fixture(t), aps = apsFixture(), core = await coreFor(f, aps), job = await core.captureJob(f.spec);
  assert.equal((await core.approveCost(job.jobId)).allowed, true);
  await core.prepare(job.jobId); await core.prepare(job.jobId);
  assert.equal(aps.counts.submit, 1);
  const fake = await coreFor(f, aps, createFakeCostProvider());
  await assert.rejects(() => fake.prepare(job.jobId), code('CLOUD_CLOSED'));
});
test('unknown submission outcome survives reapproval and configuration changes without a second POST', async t => {
  const f = await fixture(t), aps = apsFixture({ loseSubmit: true }), core = await coreFor(f, aps), job = await core.captureJob(f.spec);
  await core.approveCost(job.jobId);
  await assert.rejects(() => core.prepare(job.jobId), code('PROVIDER_FAILURE'));
  assert.equal((await core.readJob(job.jobId)).submission.phase, 'submission-unknown');
  f.auth = { ...f.auth, configurationId: 'e'.repeat(64) };
  await core.approveCost(job.jobId);
  await assert.rejects(() => core.prepare(job.jobId), code('SUBMISSION_UNKNOWN'));
  assert.equal(aps.counts.submit, 1);
});
test('revocation during provider await blocks final mutation and retains unknown intent', async t => {
  const f = await fixture(t), aps = apsFixture({ beforeSubmit: () => { f.auth = { ...f.auth, enabled: false }; } });
  const core = await coreFor(f, aps), job = await core.captureJob(f.spec);
  await core.approveCost(job.jobId);
  await assert.rejects(() => core.prepare(job.jobId), code('COST_BLOCKED'));
  assert.equal(aps.counts.submit, 0);
  assert.equal((await core.readJob(job.jobId)).submission.phase, 'submission-unknown');
});
