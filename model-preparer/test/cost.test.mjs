import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { contextFromSpec, digest } from '../lib/contracts.mjs';
import { createFakeCostProvider, createClosedCostProvider, evaluateCostEvidence, issueFakeCostEvidence, isFakeCostProvider, costIdentity } from '../lib/cost.mjs';

const START = Date.parse('2026-10-16T09:00:00.000Z');
function context() {
  return contextFromSpec({ namespace: { account: 'test-account', application: 'test-app' }, region: 'EMEA',
    destination: { bucket: 'test-bucket', objectKey: 'model.nwd' }, conversion: { format: 'svf', views: ['3d'], xAdsForce: false },
    supportProfile: 'svf-local-7.130.0-v1', label: 'First', output: path.resolve('unused-model.zip') },
  { name: 'model.nwd', bytes: 20, sha256: 'a'.repeat(64), snapshotPath: path.resolve('unused-model.nwd'), capturedAt: new Date(START).toISOString() });
}
function decide(evidence, overrides = {}) { return evaluateCostEvidence({ evidence, context: context(), operation: 'submit', now: START, verified: true, ...overrides }); }
function grant(options = {}) { return issueFakeCostEvidence(context(), { clock: { now: () => START }, ...options }); }

test('current fake evidence covers storage/upload/submission independently', () => {
  const evidence = grant();
  for (const operation of ['storage', 'upload', 'submit']) assert.equal(decide(evidence, { operation }).allowed, true);
});
test('fake proof survives canonical JSON persistence without credentials', () => {
  const evidence = JSON.parse(JSON.stringify(grant())), provider = createFakeCostProvider();
  assert.equal(provider.verifyEvidence(evidence, context()), true);
  assert.equal(decide(evidence).allowed, true);
  assert.equal(isFakeCostProvider(provider), true);
  assert.equal(isFakeCostProvider({ kind: 'fake', mode: 'fake' }), false);
});
test('label/output/job metadata do not change cost identity', () => {
  const original = context(), changed = structuredClone(original);
  changed.label = 'Another'; changed.output = path.resolve('another.zip'); changed.jobId = 'another-id'; changed.source.snapshotPath = path.resolve('another-snapshot.nwd');
  assert.equal(costIdentity(original), costIdentity(changed));
});
for (const [label, mutate] of [
  ['source digest', value => { value.source.sha256 = 'b'.repeat(64); }],
  ['source bytes', value => { value.source.bytes++; }],
  ['source name', value => { value.source.name = 'another.nwd'; }],
  ['account', value => { value.namespace.account = 'another-account'; }],
  ['application', value => { value.namespace.application = 'another-app'; }],
  ['region', value => { value.region = 'US'; }],
  ['bucket', value => { value.destination.bucket = 'another-bucket'; }],
  ['object', value => { value.destination.objectKey = 'another.nwd'; }],
  ['conversion format', value => { value.conversion.format = 'svf2'; }],
  ['views', value => { value.conversion.views = ['2d']; }],
  ['force', value => { value.conversion.xAdsForce = true; }],
  ['profile', value => { value.supportProfile = 'other-profile'; }],
  ['submission ID', value => { value.submissionIdentity = 'c'.repeat(64); }],
  ['remote target', value => { value.remoteTargetIdentity = 'd'.repeat(64); }],
]) test(`evidence rejects changed ${label}`, () => {
  const changed = context(); mutate(changed);
  assert.equal(decide(grant(), { context: changed }).code, 'COST_IDENTITY_MISMATCH');
});
for (const [label, evidence, options, code] of [
  ['missing', null, {}, 'COST_MISSING'],
  ['unknown', grant({ status: 'unknown' }), {}, 'COST_UNKNOWN'],
  ['nonzero', grant({ status: 'nonzero', amount: 1 }), {}, 'COST_NONZERO'],
  ['nonzero amount despite zero status', grant({ amount: 0.01 }), {}, 'COST_NONZERO'],
  ['exact expiry', grant({ ttlMs: 10 }), { now: START + 10 }, 'COST_EXPIRED'],
  ['future check', grant({ checkedAt: new Date(START + 1).toISOString() }), {}, 'COST_EXPIRED'],
  ['not issuer verified', grant(), { verified: false }, 'COST_UNVERIFIABLE'],
  ['exhausted quota', grant({ quota: { submit: 0 } }), {}, 'COST_QUOTA'],
  ['consumed count', grant(), { consumed: 1 }, 'COST_QUOTA'],
  ['operation not authorized', grant({ allowedOperations: ['upload'] }), {}, 'COST_QUOTA'],
  ['insufficient upload bytes', grant({ uploadBytes: 19 }), { operation: 'upload' }, 'COST_QUOTA'],
  ['unknown quota', grant({ quota: { submit: 'unknown' } }), {}, 'COST_UNKNOWN'],
]) test(`cost gate fails closed: ${label}`, () => {
  const result = decide(evidence, options); assert.equal(result.allowed, false); assert.equal(result.code, code);
});
test('quota and authorized counts are both enforced after authoritative usage', () => {
  const evidence = grant({ counts: { submit: 3 }, quota: { submit: 2 } });
  assert.equal(decide(evidence, { consumed: 1 }).allowed, true);
  assert.equal(decide(evidence, { consumed: 2 }).code, 'COST_QUOTA');
});
test('tampered or unknown-field evidence cannot be trusted even with verified flag', () => {
  for (const mutate of [value => { value.price.basis = 'changed-basis'; }, value => { value.attestation = '0'.repeat(64); }, value => { value.extra = true; }]) {
    const evidence = grant(); mutate(evidence);
    assert.equal(decide(evidence).code, 'COST_UNVERIFIABLE');
    assert.equal(createFakeCostProvider().verifyEvidence(evidence, context()), false);
  }
});
test('fake digest is explicitly domain-separated, public and simulation-only', () => {
  const evidence = grant(), { attestation, ...payload } = evidence;
  assert.equal(attestation, digest({ domain: 'MODEL_PREPARER_FAKE_COST_ATTESTATION_V1', evidence: payload }));
  assert.equal(createClosedCostProvider().verifyEvidence(evidence, context()), false);
});
test('expired evidence does not refresh implicitly; explicit new approval does', async () => {
  let time = START;
  const provider = createFakeCostProvider({ clock: { now: () => time }, ttlMs: 10 });
  assert.deepEqual(provider.calls, []);
  const first = await provider.getEvidence(context()); time += 20;
  const expired = await provider.getEvidence(context()); assert.deepEqual(expired, first);
  assert.equal(decide(expired, { now: time }).code, 'COST_EXPIRED');
  const refreshed = provider.issue(context()); assert.notEqual(refreshed.evidenceId, first.evidenceId);
  assert.equal(decide(refreshed, { now: time }).allowed, true);
});
test('fixed evidence can script missing and replacement approvals', async () => {
  const provider = createFakeCostProvider({ evidence: null }); assert.equal(await provider.getEvidence(context()), null);
  provider.setEvidence(grant()); assert.equal(provider.verifyEvidence(await provider.getEvidence(context()), context()), true);
});
test('closed production cost provider returns no evidence and never invokes credentials', async () => {
  const closed = createClosedCostProvider();
  assert.equal(closed.mode, 'closed-real'); assert.equal(await closed.getEvidence(context()), null);
  assert.equal(closed.verifyEvidence(grant(), context()), false);
});
test('cost cancellation is local and makes no evidence-provider call', async () => {
  const provider = createFakeCostProvider(), controller = new AbortController(); controller.abort();
  await assert.rejects(provider.getEvidence(context(), { signal: controller.signal }), { code: 'LOCAL_ABORTED' });
  assert.deepEqual(provider.calls, []);
});
test('secret-shaped evidence identifiers never appear in decisions or issued evidence', () => {
  const evidence = grant(); evidence.evidenceId = 'access_token_privatevalue';
  const result = decide(evidence); assert.equal(result.code, 'COST_UNVERIFIABLE'); assert.equal(result.evidenceId, undefined);
  assert.throws(() => grant({ originReference: 'signed_url_privatevalue' }), { code: 'COST_UNVERIFIABLE' });
});
test('unverified or malformed evidence never echoes an ID or foreign secret fields', () => {
  for (const evidence of [
    { ...grant(), evidenceId: 'Bearer-PRIVATE_TOKEN', authorization: 'Bearer-PRIVATE_TOKEN' },
    { ...grant(), evidenceId: 'signed-url-PRIVATE_TOKEN', signedUrl: 'https://example.test/?signature=PRIVATE_TOKEN' },
    { ...grant(), evidenceId: 'apparently-safe-id' },
  ]) {
    const decision = decide(evidence, { verified: false });
    assert.equal(decision.evidenceId, undefined);
    assert.equal(JSON.stringify(decision).includes('PRIVATE_TOKEN'), false);
    assert.equal(JSON.stringify(decision).includes('https'), false);
  }
});
