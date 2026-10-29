import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id, H, h } from './barrier-multipart-fixture.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE as profile, barrierMultipartTransportCanonical,
  validateBarrierMultipartProducerProfile, validateBarrierMultipartFrameRequest, validateBarrierMultipartFramePayload,
  validateBarrierMultipartStart, validateBarrierMultipartIntentControl, validateBarrierMultipartStatus,
  validateBarrierMultipartSession, validateBarrierMultipartContext, validateBarrierMultipartPage, validateBarrierMultipartSeal,
  BARRIER_MULTIPART_PRODUCER_BOOKEND_PROFILE, validateBarrierMultipartProducerCompletionEvidence, validateBarrierMultipartCompleteProducerCommand,
  validateBarrierMultipartProducerCompletionReceipt, barrierMultipartProducerPartChainSeedHashInput, barrierMultipartProducerPartChainStepHashInput,
  barrierMultipartProducerPartChainFinalHashInput } from '../barrier-multipart-protocol.mjs';

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
const roots = () => Object.fromEntries(['nodes', 'fragments', 'geometry-ranges', 'plan'].map(k => [k, H]));
function completionFixture() {
  const evidence = { contextSha256: H, frameSha256: H, roots: roots(), partCount: 1, bookendProfile: BARRIER_MULTIPART_PRODUCER_BOOKEND_PROFILE };
  const command = { schemaVersion: 'wfc.pf.barrier-multipart-complete-producer.v2', intentId: id(7), expectedSessionRevision: '9', idempotencyKey: id(40), scopeSha256: H, profileSha256: H, ...evidence, partsSha256: H };
  const receipt = { schemaVersion: 'wfc.pf.barrier-multipart-producer-completion-receipt.v2', intentId: id(7), sessionRevision: '10', commandSha256: H, scopeSha256: H, profileSha256: H,
    ...evidence, partsSha256: H, recordedAt: '2026-10-22T08:00:00.000Z', duplicate: false, completionProvenance: 'protected-producer-reported', sdkSourceBytesVerified: false,
    qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' };
  const part = { schemaVersion: 'wfc.pf.barrier-multipart-stage-receipt.v2', intentId: id(7), sessionRevision: '9', commandSha256: H, scopeSha256: H, profileSha256: H,
    kind: 'part', partIndex: 0, planSealSha256: H, stored: { blobId: id(50), sha256: H, bytes: 25, durability: 'file-and-directory-fsynced' }, duplicate: false,
    qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' };
  return { evidence, command, receipt, part };
}
test('completion command and receipt remain additive strict producer-reported metadata', () => {
  const f = completionFixture(); assert.equal(validateBarrierMultipartProducerCompletionEvidence(f.evidence), true);
  assert.equal(validateBarrierMultipartCompleteProducerCommand(f.command), true); assert.equal(validateBarrierMultipartProducerCompletionReceipt(f.receipt), true);
  for (const change of [v => { v.roots.plan = null; }, v => { v.partCount = -0; }, v => { v.partCount = 1048577; }, v => { v.contextSha256 += '\n'; },
    v => { v.bookendProfile = 'arbitrary'; }, v => { v.actorId = id(8); }, v => { v.roots[Symbol('hidden')] = H; }]) {
    const e = structuredClone(f.evidence); change(e); assert.equal(validateBarrierMultipartProducerCompletionEvidence(e), false);
  }
  assert.equal(validateBarrierMultipartCompleteProducerCommand({ ...f.command, expectedSessionRevision: '9\n' }), false);
  for (const extra of [{ sdkSourceBytesVerified: true }, { authority: 'routing' }, { geometryValidation: 'VALIDATED' }, { completionProvenance: 'independent' }]) {
    assert.equal(validateBarrierMultipartProducerCompletionReceipt({ ...f.receipt, ...extra }), false);
  }
  let reads = 0; Object.defineProperty(f.evidence, 'partCount', { enumerable: true, get() { reads++; return 1; } });
  assert.equal(validateBarrierMultipartProducerCompletionEvidence(f.evidence), false); assert.equal(reads, 0);
});
test('constant-space chain matches exact frozen domains and receipt projection while ignoring duplicate replay', () => {
  const f = completionFixture(), context = { intentId: f.command.intentId, contextSha256: H, scopeSha256: H, profileSha256: H, frameSha256: H, roots: roots() };
  const D = 'wfc.pf.barrier-multipart-producer-completion.v2', seed = barrierMultipartProducerPartChainSeedHashInput(context);
  assert.deepEqual(seed, { domain: D + '/parts-seed', value: context }); const previous = h(seed);
  const projected = { intentId: f.part.intentId, scopeSha256: H, profileSha256: H, partIndex: 0, planSealSha256: H, commandSha256: H, sessionRevision: '9', stored: { blobId: id(50), sha256: H, bytes: 25 } };
  const step = barrierMultipartProducerPartChainStepHashInput(previous, f.part); assert.deepEqual(step, { domain: D + '/parts-step', value: { previous, part: projected } });
  assert.deepEqual(barrierMultipartProducerPartChainStepHashInput(previous, { ...f.part, duplicate: true }), step);
  assert.deepEqual(barrierMultipartProducerPartChainFinalHashInput(h(step), 1), { domain: D + '/parts-final', value: { previous: h(step), partCount: 1 } });
  for (const field of ['partIndex', 'sessionRevision', 'commandSha256', 'planSealSha256']) {
    const part = structuredClone(f.part); part[field] = field === 'partIndex' ? 1 : field === 'sessionRevision' ? '10' : 'b'.repeat(64);
    assert.notEqual(h(barrierMultipartProducerPartChainStepHashInput(previous, part)), h(step));
  }
  for (const change of [p => { p.stored.durability = 'memory'; }, p => { p.stored.blobId += '\n'; }, p => { p.ready = true; }, p => { p.partIndex = -0; }]) {
    const part = structuredClone(f.part); change(part); assert.throws(() => barrierMultipartProducerPartChainStepHashInput(previous, part));
  }
  const detached = barrierMultipartProducerPartChainSeedHashInput(context); context.roots.plan = 'b'.repeat(64); assert.equal(detached.value.roots.plan, H);
  assert.throws(() => barrierMultipartProducerPartChainFinalHashInput(previous, 0));
});
test('completion controls and hash inputs reject nonenumerable required fields before canonical JSON can omit them', () => {
  const hidden = (value, field) => { Object.defineProperty(value, field, { ...Object.getOwnPropertyDescriptor(value, field), enumerable: false }); return value; };
  for (const field of ['contextSha256', 'frameSha256', 'roots', 'partCount', 'bookendProfile']) {
    const f = completionFixture(); assert.equal(validateBarrierMultipartProducerCompletionEvidence(hidden(f.evidence, field)), false);
  }
  const f = completionFixture(), context = { intentId: f.command.intentId, contextSha256: H, scopeSha256: H, profileSha256: H, frameSha256: H, roots: roots() };
  assert.throws(() => barrierMultipartProducerPartChainSeedHashInput(hidden(context, 'frameSha256')));
  for (const field of ['intentId', 'expectedSessionRevision', 'contextSha256', 'partsSha256']) {
    assert.equal(validateBarrierMultipartCompleteProducerCommand(hidden(completionFixture().command, field)), false);
  }
  for (const field of ['sessionRevision', 'commandSha256', 'recordedAt', 'completionProvenance', 'sdkSourceBytesVerified']) {
    assert.equal(validateBarrierMultipartProducerCompletionReceipt(hidden(completionFixture().receipt, field)), false);
  }
  for (const target of ['root', 'part', 'stored']) {
    const f = completionFixture();
    if (target === 'root') { hidden(f.evidence.roots, 'plan'); assert.equal(validateBarrierMultipartProducerCompletionEvidence(f.evidence), false); }
    else { hidden(target === 'part' ? f.part : f.part.stored, target === 'part' ? 'sessionRevision' : 'blobId'); assert.throws(() => barrierMultipartProducerPartChainStepHashInput(H, f.part)); }
  }
});
