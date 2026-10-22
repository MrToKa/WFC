import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id, H, reply, h, hash, commandHash } from './barrier-multipart-fixture.mjs';
import { createBarrierMultipartTransport } from '../barrier-multipart-transport.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE as profile, barrierMultipartContextHashInput,
  barrierMultipartTransportCanonical, validateBarrierMultipartAdmitCommand, BARRIER_MULTIPART_PRODUCER_BOOKEND_PROFILE } from '../barrier-multipart-protocol.mjs';

// Transport-only scripted HTTP fixture; actual SQL/current-cookie guards are
// independently exercised by root's isolated server integration suite.
async function prepareCompletion(f, partCount = 2) {
  const writer = await f.transport().open(f.start);
  for (const kind of ['nodes', 'fragments', 'geometry-ranges', 'plan']) {
    const roots = writer.snapshot().roots, totals = kind === 'nodes' ? { nodes: 1 }
      : kind === 'fragments' ? { fragments: 1, sourceVertices: 3, sourceTriangles: partCount, unavailable: 0, nonTriangle: 0 }
        : kind === 'geometry-ranges' ? { ranges: partCount, referencedVertices: 3 * partCount, triangles: partCount }
          : { parts: partCount, ranges: partCount, referencedVertices: 3 * partCount, triangles: partCount, plannedEncodedBytesUpperBound: 65536,
            nodeSealSha256: roots.nodes, fragmentSealSha256: roots.fragments, rangeSealSha256: roots['geometry-ranges'] };
    const body = { schemaVersion: 'wfc.pf.barrier-multipart-seal.v2', kind, scopeSha256: f.session.scopeSha256, profileSha256: f.session.profileSha256,
      pageCount: 1, recordCount: ['nodes', 'fragments'].includes(kind) ? 1 : partCount, tailPageSha256: H, totals,
      ...(kind === 'plan' ? { qualification: 'NOT_MEASURED', authority: 'none' } : {}) };
    await writer.stage({ kind: 'seal', seal: { ...body, sealSha256: h({ domain: 'wfc.pf.barrier-multipart.v2/seal', value: body }) } });
  }
  return { writer, evidence: { contextSha256: f.context.context.contextSha256, frameSha256: f.frame.contentSha256, roots: writer.snapshot().roots,
    partCount, bookendProfile: BARRIER_MULTIPART_PRODUCER_BOOKEND_PROFILE },
  stagePart: index => writer.stage({ kind: 'part', partIndex: index, planSealSha256: writer.snapshot().roots.plan, bytes: new Uint8Array([index + 1, 2, 3]) }) };
}

test('direct frame admission uses exact Viewer cookie URL and never copies bearer credentials', async () => {
  const f = fixture(), transport = f.transport(); const admitted = await transport.admit(f.command, f.frame);
  assert.equal(admitted.session.id, f.session.id); assert.equal(f.calls[0].url, f.base + 'sessions');
  const o = f.calls[0].options; assert.equal(o.credentials, 'same-origin'); assert.equal(o.redirect, 'error'); assert.equal(o.mode, 'same-origin'); assert.equal(o.cache, 'no-store');
  assert.deepEqual(Object.keys(o.headers), ['Content-Type']); assert.deepEqual(JSON.parse(o.body).producerProfile, profile);
  const writer = await transport.open(f.start); assert.equal(writer.context.context.viewerSessionId, id(10)); assert.equal(Object.isFrozen(writer.context.session.command.scope), true);
  assert.equal(writer.snapshot().authority, 'none');
});
test('factory and small start refuse URL material instead of offering a general fetch capability', async () => {
  const common = { projectId: id(1), modelVersionId: id(2), sessionId: id(10), loadId: id(4), isCurrent: () => true, fetchImpl: async () => { throw Error('must not fetch'); } };
  for (const origin of ['https://example.test/path', 'https://user:pass@example.test', 'file:///tmp/x', 'https://example.test/']) assert.throws(() => createBarrierMultipartTransport({ ...common, origin }));
  const f = fixture(); await assert.rejects(f.transport().open({ ...f.start, url: 'https://example.test' })); assert.equal(f.calls.length, 0);
});
test('full admission envelope refuses a command at its own64KiB boundary before any HTTP write', async () => {
  const f = fixture(); f.command.scope.selectedParents = Array.from({ length: 128 }, (_, i) => ({ selectionId: id(200 + i), dbId: i + 3, kind: 'obstacle' }));
  f.command.selectedParentLabels = f.command.scope.selectedParents.map(p => ({ selectionId: p.selectionId, name: 'x' }));
  let remaining = 65536 - new TextEncoder().encode(barrierMultipartTransportCanonical(f.command)).byteLength;
  for (const label of f.command.selectedParentLabels) { const added = Math.min(511, remaining); label.name += 'x'.repeat(added); remaining -= added; }
  assert.equal(remaining, 0); assert.equal(validateBarrierMultipartAdmitCommand(f.command), true);
  await assert.rejects(f.transport().admit(f.command, f.frame), /BARRIER_MULTIPART_TRANSPORT_BYTES/u); assert.equal(f.calls.length, 0);
});
test('open verifies each full context hash link and exact loaded/session identity', async () => {
  for (const change of [v => v.session.scopeSha256 = 'b'.repeat(64), v => v.session.profileSha256 = 'b'.repeat(64),
    v => v.session.requestSha256 = 'b'.repeat(64), v => v.context.contextSha256 = 'b'.repeat(64),
    v => v.context.frameObservation.contentSha256 = 'b'.repeat(64), v => v.context.viewerSessionId = id(99),
    v => v.session.command.scope.modelLoadId = id(99), v => v.context.producerProfile.triangleOrder = 'raw-index-buffer' ]) {
    const f = fixture(); change(f.context); await assert.rejects(f.transport().open(f.start)); assert.equal(f.calls.filter(c => c.options.method !== 'GET').length, 0);
  }
});
test('even self-consistently rehashed wrong frame projection is not the admitted frame', async () => {
  const f = fixture(); f.context.context.frameObservation.displayToWorldMetres[12] = 1;
  const { contentSha256: _old, ...frameBody } = f.frame; f.frame.contentSha256 = h(frameBody);
  f.context.context.contextSha256 = h(barrierMultipartContextHashInput(f.context));
  await assert.rejects(f.transport().open(f.start), { code: 'BARRIER_MULTIPART_CONTEXT_HASH' });
});
test('admission rejects a plausible response with a false command digest', async () => {
  const f = fixture(); f.session.requestSha256 = 'b'.repeat(64);
  await assert.rejects(f.transport().admit(f.command, f.frame), { code: 'BARRIER_MULTIPART_RECEIPT' });
});
test('one awaited upload holds producer backpressure and detaches each page before the first await', async () => {
  const f = fixture(), writer = await f.transport().open(f.start), p = f.page(); let release, entered, pulls = 0;
  f.controls.hold = new Promise(resolve => { release = resolve; }); const started = new Promise(resolve => { entered = resolve; }); f.controls.entered = entered;
  const events = { async *[Symbol.asyncIterator]() { pulls++; yield { kind: 'page', page: p }; pulls++; yield { kind: 'seal', seal: f.seal(p) }; pulls++; } };
  const uploading = writer.upload(events); await started; assert.equal(pulls, 1);
  await assert.rejects(writer.stage({ kind: 'page', page: f.page() }), { code: 'BARRIER_MULTIPART_BACKPRESSURE' });
  assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1);
  f.controls.hold = null; release(); const status = await uploading;
  assert.equal(pulls, 3); assert.deepEqual(status.counts, { pages: 1, seals: 1, parts: 0 }); assert.equal(status.geometryValidation, 'NOT_VALIDATED');
});
test('caller mutation after stage entry cannot replace the submitted page', async () => {
  const f = fixture(), writer = await f.transport().open(f.start), p = f.page();
  const pending = writer.stage({ kind: 'page', page: p }); p.records[0].dbId = 999;
  const receipt = await pending; assert.equal(receipt.pageSha256, f.page().pageSha256);
  const sent = JSON.parse(f.calls.find(c => c.url.endsWith('/pages') && c.options.method === 'POST').options.body); assert.equal(sent.page.records[0].dbId, 3);
});
test('verified bounded page replay supplies planner inputs only from the exact stored stream', async () => {
  const f = fixture(), writer = await f.transport().open(f.start), p = f.page();
  await writer.stage({ kind: 'page', page: p }); await writer.stage({ kind: 'seal', seal: f.seal(p) });
  const pages = []; for await (const page of writer.readPages('nodes')) pages.push(page);
  assert.deepEqual(pages, [p]); assert.equal(f.calls.at(-1).url, f.base + f.session.id + '/pages/nodes/0');
  f.pages.set('nodes/0', { ...p, records: [{ dbId: 999, membershipMask: p.records[0].membershipMask }] });
  await assert.rejects(async () => { for await (const _p of writer.readPages('nodes')) {} }, { code: 'BARRIER_MULTIPART_PAGE_HASH' });
  await assert.rejects(async () => { for await (const _p of writer.readPages('../foreign')) {} });
});
test('unknown write acknowledgement retains one exact command and never resends its POST', async () => {
  const f = fixture(), writer = await f.transport().open(f.start); f.controls.afterStage = () => { throw Error('lost acknowledgement'); };
  await assert.rejects(writer.stage({ kind: 'page', page: f.page() }), /lost acknowledgement/u);
  const [pending] = writer.pending(); assert.equal(pending.command.intentId, f.session.id); assert.equal(pending.commandSha256.length, 64);
  await assert.rejects(writer.stage({ kind: 'page', page: f.page() }), { code: 'BARRIER_MULTIPART_PENDING_REQUIRED' });
  assert.equal(f.calls.filter(c => c.url.endsWith('/pages') && c.options.method === 'POST').length, 1);
  const receipt = await writer.reconcile(pending.command.idempotencyKey); assert.equal(receipt.duplicate, true); assert.equal(writer.snapshot().sessionRevision, '1'); assert.deepEqual(writer.pending(), []);
  assert.equal(f.calls.filter(c => c.url.endsWith('/pages') && c.options.method === 'POST').length, 1);
});
test('tampered receipt cannot authorize local progress and stays uncertain for exact reconciliation', async () => {
  for (const change of [r => r.commandSha256 = 'b'.repeat(64), r => r.stored.sha256 = 'b'.repeat(64), r => r.stored.bytes++,
    r => r.sessionRevision = '2', r => r.pageSha256 = 'b'.repeat(64), r => r.geometryValidation = 'VALIDATED', r => r.stored.durability = 'memory']) {
    const f = fixture(), writer = await f.transport().open(f.start); f.controls.afterStage = receipt => { change(receipt); return reply(receipt); };
    await assert.rejects(writer.stage({ kind: 'page', page: f.page() }), { code: 'BARRIER_MULTIPART_RECEIPT' });
    assert.equal(writer.snapshot().sessionRevision, '0'); assert.equal(writer.pending().length, 1);
  }
});
test('explicit cancel can preserve an earlier uncertain stage and reconcile it without rolling revision backwards', async () => {
  const f = fixture(), writer = await f.transport().open(f.start); f.controls.afterStage = () => { throw Error('lost acknowledgement'); };
  await assert.rejects(writer.stage({ kind: 'page', page: f.page() })); const pending = writer.pending()[0];
  const cancelled = await writer.cancel(); assert.equal(cancelled.session.state, 'cancelled'); assert.equal(writer.snapshot().sessionRevision, '2');
  assert.equal(writer.pending().length, 1); await writer.reconcile(pending.command.idempotencyKey);
  assert.equal(writer.snapshot().state, 'cancelled'); assert.equal(writer.snapshot().sessionRevision, '2'); assert.equal(writer.pending().length, 0);
});
test('raw future part lane uses exact bounded ASCII command header and detached opaque bytes', async () => {
  const f = fixture(); f.session.roots.plan = H; f.session.counts.seals = 1; f.session.reservation.chargedFiles = 2; f.session.reservation.chargedBytes = 2;
  const writer = await f.transport().open(f.start), bytes = new Uint8Array([1, 2, 3, 4]);
  const pending = writer.stage({ kind: 'part', partIndex: 0, planSealSha256: H, bytes }); bytes.fill(9); const receipt = await pending;
  const call = f.calls.at(-1); assert.equal(call.options.method, 'PUT'); assert.equal(call.options.headers['Content-Type'], 'application/octet-stream');
  assert.deepEqual([...call.options.body], [1, 2, 3, 4]); assert.equal(receipt.stored.sha256, hash(new Uint8Array([1, 2, 3, 4])));
  const header = call.options.headers['x-wfc-barrier-command']; assert.equal(/^[\x20-\x7e]{1,4096}$/u.test(header), true); assert.equal(Object.keys(call.options.headers).length, 2);
  await assert.rejects(writer.stage({ kind: 'part', partIndex: 1, planSealSha256: H, bytes: new Uint8Array(33554433) }), { code: 'BARRIER_MULTIPART_PART' });
});
test('part index and plan seal are detached before an asynchronous byte hasher can yield', async () => {
  const f = fixture(); f.session.roots.plan = H; f.session.counts.seals = 1; f.session.reservation.chargedFiles = 2; f.session.reservation.chargedBytes = 2;
  let release, entered, stalled = false, sent;
  const gate = new Promise(resolve => { release = resolve; }), hashing = new Promise(resolve => { entered = resolve; });
  const fetchImpl = async (url, options) => {
    if (options.method === 'GET') { assert.equal(url, f.base + f.session.id + '/context'); return reply(f.context); }
    assert.equal(url, f.base + f.session.id + '/parts'); assert.equal(options.method, 'PUT'); sent = JSON.parse(options.headers['x-wfc-barrier-command']);
    return reply({ schemaVersion: 'wfc.pf.barrier-multipart-stage-receipt.v2', intentId: f.session.id, sessionRevision: '1', commandSha256: commandHash(sent),
      scopeSha256: f.session.scopeSha256, profileSha256: f.session.profileSha256,
      stored: { blobId: id(700), sha256: hash(options.body), bytes: options.body.byteLength, durability: 'file-and-directory-fsynced' }, duplicate: false,
      qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none', kind: 'part', partIndex: sent.partIndex, planSealSha256: sent.planSealSha256 });
  };
  const transport = createBarrierMultipartTransport({ origin: 'http://127.0.0.1:5192', projectId: id(1), modelVersionId: id(2), sessionId: id(10), loadId: id(4),
    isCurrent: () => true, fetchImpl, randomUUID: () => id(701), sha256: async bytes => {
      if (bytes.byteLength === 4 && !stalled) { stalled = true; entered(); await gate; } return hash(bytes);
    } });
  const writer = await transport.open(f.start), event = { kind: 'part', partIndex: 0, planSealSha256: H, bytes: new Uint8Array([1, 2, 3, 4]) };
  const pending = writer.stage(event); await hashing; event.partIndex = 999; event.planSealSha256 = 'b'.repeat(64); release();
  const receipt = await pending; assert.equal(sent.partIndex, 0); assert.equal(sent.planSealSha256, H); assert.equal(receipt.partIndex, 0);
});
test('context loss before or after HTTP prevents acceptance and leaves uncertain mutation recoverable', async () => {
  const f = fixture(), writer = await f.transport().open(f.start); f.controls.afterStage = receipt => { f.controls.current = false; return reply(receipt); };
  await assert.rejects(writer.stage({ kind: 'page', page: f.page() }), { name: 'AbortError' }); assert.equal(writer.pending().length, 1); assert.equal(writer.snapshot().sessionRevision, '0');
  f.controls.current = true; await writer.reconcile(writer.pending()[0].command.idempotencyKey); assert.equal(writer.snapshot().sessionRevision, '1');
});
test('streamed response overrun, invalid UTF8, redirects and foreign URL never become context authority', async () => {
  for (const responder of [() => reply({ bad: 'x'.repeat(262145) }),
    () => new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }),
    () => ({ status: 200, redirected: true, url: 'https://foreign.test', headers: new Headers({ 'Content-Type': 'application/json' }) }),
    () => ({ status: 200, redirected: false, url: 'https://foreign.test', headers: new Headers({ 'Content-Type': 'application/json' }) })]) {
    const f = fixture(); f.controls.responder = responder; await assert.rejects(f.transport().open(f.start)); assert.equal(f.calls.length, 1);
  }
});
test('already aborted upload and expired immutable deadline do not renew or fetch more data', async () => {
  const f = fixture(), writer = await f.transport().open(f.start), abort = new AbortController(); abort.abort();
  const before = f.calls.length; await assert.rejects(writer.stage({ kind: 'page', page: f.page() }, { signal: abort.signal }), { name: 'AbortError' }); assert.equal(f.calls.length, before);
  const old = fixture(); old.session.createdAt = '2000-01-01T00:00:00.000Z'; old.session.updatedAt = old.session.createdAt; old.session.jobDeadline = '2000-01-01T00:01:00.000Z';
  old.context.context.effectiveDeadline = old.session.jobDeadline; old.context.context.contextSha256 = h(barrierMultipartContextHashInput(old.context));
  await assert.rejects(old.transport().open(old.start), { code: 'BARRIER_MULTIPART_DEADLINE' }); assert.equal(old.calls.length, 1);
});
test('terminal producer completion binds the independently derived ordered exact ACK receipt chain', async () => {
  const f = fixture(), p = await prepareCompletion(f); const receipts = [await p.stagePart(0), await p.stagePart(1)];
  const before = p.writer.snapshot(), D = 'wfc.pf.barrier-multipart-producer-completion.v2';
  let previous = h({ domain: D + '/parts-seed', value: { intentId: f.session.id, contextSha256: f.context.context.contextSha256, scopeSha256: f.session.scopeSha256,
    profileSha256: f.session.profileSha256, frameSha256: f.frame.contentSha256, roots: before.roots } });
  for (const receipt of receipts) { const { intentId, scopeSha256, profileSha256, partIndex, planSealSha256, commandSha256, sessionRevision, stored: { blobId, sha256, bytes } } = receipt;
    previous = h({ domain: D + '/parts-step', value: { previous, part: { intentId, scopeSha256, profileSha256, partIndex, planSealSha256, commandSha256, sessionRevision, stored: { blobId, sha256, bytes } } } }); }
  const partsSha256 = h({ domain: D + '/parts-final', value: { previous, partCount: 2 } }), receipt = await p.writer.completeProducer(p.evidence);
  assert.equal(receipt.partsSha256, partsSha256); assert.equal(receipt.sdkSourceBytesVerified, false); assert.equal(receipt.authority, 'none');
  const call = f.calls.at(-1), command = JSON.parse(call.options.body); assert.equal(call.url, f.base + f.session.id + '/producer-completion'); assert.equal(call.options.method, 'POST');
  assert.equal(command.partsSha256, partsSha256); assert.equal(receipt.commandSha256, commandHash(command)); assert.equal(p.writer.snapshot().sessionRevision, String(Number(before.sessionRevision) + 1));
  assert.deepEqual(p.writer.snapshot().counts, before.counts); assert.deepEqual(p.writer.completion(), receipt);
  await assert.rejects(p.writer.stage({ kind: 'page', page: f.page() }), { code: 'BARRIER_MULTIPART_PENDING_REQUIRED' });
  assert.equal((await p.writer.readCompletion()).commandSha256, receipt.commandSha256);
  const reopened = await f.transport().open({ ...f.start, expectedSessionRevision: f.session.sessionRevision });
  assert.equal((await reopened.readCompletion()).partsSha256, partsSha256); assert.equal(reopened.snapshot().authority, 'none');
});
test('old sessions have no completion and an opened historical writer cannot invent its part receipt chain', async () => {
  const f = fixture(), empty = await f.transport().open(f.start); assert.equal(await empty.readCompletion(), null); assert.equal(empty.completion(), null);
  const p = await prepareCompletion(f, 1); await p.stagePart(0);
  const reopened = await f.transport().open({ ...f.start, expectedSessionRevision: f.session.sessionRevision });
  await assert.rejects(reopened.completeProducer(p.evidence), { code: 'BARRIER_MULTIPART_COMPLETION' });
  assert.equal(f.calls.some(call => call.url.endsWith('/producer-completion') && call.options.method === 'POST'), false);
});
test('missing, extra, reordered parts or foreign terminal evidence refuse before a completion write', async () => {
  const f = fixture(), p = await prepareCompletion(f); await assert.rejects(p.stagePart(1), { code: 'BARRIER_MULTIPART_PART' });
  await p.stagePart(0); await assert.rejects(p.writer.completeProducer(p.evidence), { code: 'BARRIER_MULTIPART_COMPLETION' }); await p.stagePart(1);
  for (const change of [v => { v.contextSha256 = H; }, v => { v.frameSha256 = H; }, v => { v.partCount = 1; }, v => { v.roots.nodes = H; }, v => { v.sdkSourceBytesVerified = true; }]) {
    const evidence = structuredClone(p.evidence); change(evidence); await assert.rejects(p.writer.completeProducer(evidence));
  }
  await assert.rejects(p.stagePart(0), { code: 'BARRIER_MULTIPART_PART' });
  assert.equal(f.calls.some(call => call.url.endsWith('/producer-completion') && call.options.method === 'POST'), false);
});
test('unknown final part ACK does not advance the chain; exact reconciliation permits one later explicit completion', async () => {
  const f = fixture(), p = await prepareCompletion(f); await p.stagePart(0);
  f.controls.afterStage = () => { throw Error('lost final part ACK'); }; await assert.rejects(p.stagePart(1), /lost final part ACK/u);
  await assert.rejects(p.writer.completeProducer(p.evidence), { code: 'BARRIER_MULTIPART_COMPLETION' });
  const [pending] = p.writer.pending(); await p.writer.reconcile(pending.command.idempotencyKey);
  const reconcile = JSON.parse(f.calls.at(-1).options.body); assert.equal(reconcile.schemaVersion, 'wfc.pf.barrier-multipart-reconcile.v2');
  const partsWrites = f.calls.filter(call => call.url.endsWith('/parts')).length;
  await p.writer.completeProducer(p.evidence); assert.equal(f.calls.filter(call => call.url.endsWith('/parts')).length, partsWrites);
});
test('unknown completion retains its exact immutable command for explicit reconciliation without mutation replay', async () => {
  const f = fixture(), p = await prepareCompletion(f, 1); await p.stagePart(0);
  f.controls.afterCompletion = () => { throw Error('lost completion ACK'); };
  await assert.rejects(p.writer.completeProducer(p.evidence), /lost completion ACK/u); assert.equal(p.writer.completion(), null);
  const [pending] = p.writer.pending(); assert.equal(pending.command.schemaVersion, 'wfc.pf.barrier-multipart-complete-producer.v2');
  await assert.rejects(p.writer.completeProducer(p.evidence)); assert.equal(f.calls.filter(call => call.url.endsWith('/producer-completion') && call.options.method === 'POST').length, 1);
  const receipt = await p.writer.reconcile(pending.command.idempotencyKey); assert.equal(receipt.duplicate, true); assert.equal(p.writer.pending().length, 0);
  assert.equal(p.writer.completion().commandSha256, pending.commandSha256);
});
test('tampered completion receipt remains uncertain and never grants local acknowledgement', async () => {
  for (const change of [v => { v.partsSha256 = H; }, v => { v.frameSha256 = H; }, v => { v.partCount++; }, v => { v.commandSha256 = H; },
    v => { v.sessionRevision = '20'; }, v => { v.roots.plan = H; }, v => { v.sdkSourceBytesVerified = true; }, v => { v.recordedAt = '2099-01-01T00:00:00.000Z'; }]) {
    const f = fixture(), p = await prepareCompletion(f, 1); await p.stagePart(0);
    f.controls.afterCompletion = receipt => { change(receipt); return reply(receipt); };
    await assert.rejects(p.writer.completeProducer(p.evidence), { code: 'BARRIER_MULTIPART_COMPLETION_RECEIPT' }); assert.equal(p.writer.completion(), null); assert.equal(p.writer.pending().length, 1);
    const receipt = await p.writer.reconcile(p.writer.pending()[0].command.idempotencyKey); assert.equal(receipt.duplicate, true);
  }
});
test('cancellation invalidates completion while preserving historical unknown command reconciliation', async () => {
  const f = fixture(), p = await prepareCompletion(f, 1); await p.stagePart(0); f.controls.afterCompletion = () => { throw Error('lost ACK'); };
  await assert.rejects(p.writer.completeProducer(p.evidence)); const key = p.writer.pending()[0].command.idempotencyKey;
  await p.writer.cancel(); const revision = p.writer.snapshot().sessionRevision; const receipt = await p.writer.reconcile(key);
  assert.equal(receipt.duplicate, true); assert.equal(p.writer.snapshot().state, 'cancelled'); assert.equal(p.writer.snapshot().sessionRevision, revision); assert.equal(p.writer.completion(), null);
  await assert.rejects(p.writer.readCompletion(), { code: 'BARRIER_MULTIPART_CANCELLED' });
});
