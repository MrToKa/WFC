import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id, H } from './barrier-multipart-fixture.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE as profile, barrierMultipartTransportCanonical,
  validateBarrierMultipartProducerProfile, validateBarrierMultipartFrameRequest, validateBarrierMultipartFramePayload,
  validateBarrierMultipartStart, validateBarrierMultipartIntentControl, validateBarrierMultipartStatus,
  validateBarrierMultipartSession, validateBarrierMultipartContext, validateBarrierMultipartPage, validateBarrierMultipartSeal } from '../barrier-multipart-protocol.mjs';

test('closed versioned producer semantics include manually selected hidden geometry and no geometry authority', () => {
  assert.equal(Object.isFrozen(profile), true); assert.equal(validateBarrierMultipartProducerProfile(profile), true);
  for (const key of Object.keys(profile)) assert.equal(validateBarrierMultipartProducerProfile({ ...profile, [key]: 'other' }), false);
  assert.equal(validateBarrierMultipartProducerProfile({ ...profile, sdkCoverageVerified: true }), false);
});
test('small control cannot carry URLs, credentials, geometry or independent authority', () => {
  const f = fixture(); assert.equal(validateBarrierMultipartStart(f.start), true);
  for (const field of ['url', 'token', 'cookie', 'page', 'blobId', 'ready']) assert.equal(validateBarrierMultipartStart({ ...f.start, [field]: 'x' }), false);
  assert.equal(validateBarrierMultipartStart({ ...f.start, expectedSessionRevision: '01' }), false);
  assert.equal(validateBarrierMultipartIntentControl({ intentId: id(7) }), true);
  assert.equal(validateBarrierMultipartIntentControl({ intentId: id(7), reason: 'extra' }), false);
});
test('frame command is a bounded exact model tuple and observed frame response retains fixed profile', () => {
  const f = fixture(), value = { projectId: id(1), modelVersionId: id(2), contentFingerprint: H };
  assert.equal(validateBarrierMultipartFrameRequest(value), true);
  assert.equal(validateBarrierMultipartFrameRequest({ ...value, loadId: id(4) }), false);
  assert.equal(validateBarrierMultipartFramePayload({ frameObservation: f.frame, producerProfile: profile }), true);
  assert.equal(validateBarrierMultipartFramePayload({ frameObservation: { ...f.frame, sdkVersion: 'other' }, producerProfile: profile }), false);
});
test('retained session/context validates scope and immutable finite deadlines without pretending freshness', () => {
  const f = fixture(); assert.equal(validateBarrierMultipartSession(f.session), true); assert.equal(validateBarrierMultipartContext(f.context), true);
  assert.equal(validateBarrierMultipartSession({ ...f.session, state: 'published' }), false);
  assert.equal(validateBarrierMultipartSession({ ...f.session, authority: 'routing' }), false);
  assert.equal(validateBarrierMultipartContext({ ...f.context, context: { ...f.context.context, effectiveDeadline: '2099-01-01T00:00:00.000Z' } }), false);
  const old = structuredClone(f.context); old.session.createdAt = '2000-01-01T00:00:00.000Z'; old.session.updatedAt = old.session.createdAt;
  old.session.jobDeadline = '2000-01-01T00:01:00.000Z'; old.context.effectiveDeadline = old.session.jobDeadline;
  assert.equal(validateBarrierMultipartContext(old), true); // live transport rejects expiration separately
});
test('page and seal local shape bounds remain compatible with B13a semantic hashes', () => {
  const f = fixture(), p = f.page(); assert.equal(validateBarrierMultipartPage(p), true); assert.equal(validateBarrierMultipartSeal(f.seal(p)), true);
  assert.equal(validateBarrierMultipartPage(f.page({ records: Array.from({ length: 513 }, (_, dbId) => ({ dbId, membershipMask: '0'.repeat(31) + '1' })) })), false);
  assert.equal(validateBarrierMultipartPage(f.page({ index: -0 })), false);
  assert.equal(validateBarrierMultipartSeal({ ...f.seal(p), pageCount: 2 }), false);
});
test('canonical metadata rejects accessors, cycles and unbounded output before publishing a JSON string', () => {
  const bad = {}; let reads = 0; Object.defineProperty(bad, 'x', { enumerable: true, get() { reads++; return 1; } });
  assert.throws(() => barrierMultipartTransportCanonical(bad)); assert.equal(reads, 0);
  const cycle = {}; cycle.self = cycle; assert.throws(() => barrierMultipartTransportCanonical(cycle));
  assert.throws(() => barrierMultipartTransportCanonical(Array.from({ length: 9000 }, () => 0)));
  assert.throws(() => barrierMultipartTransportCanonical({ value: 'x'.repeat(2048) }, 1024));
});
test('small status is always unqualified and cannot carry a capture catalog', () => {
  const f = fixture(), s = { intentId: f.session.id, sessionRevision: '0', state: 'admitted', counts: f.session.counts, roots: f.session.roots,
    qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' };
  assert.equal(validateBarrierMultipartStatus(s), true); assert.equal(validateBarrierMultipartStatus({ ...s, geometryValidation: 'VALIDATED' }), false);
  assert.equal(validateBarrierMultipartStatus({ ...s, records: [] }), false);
});
