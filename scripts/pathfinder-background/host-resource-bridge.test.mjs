import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runManagedHostWorker } from './host-worker.mjs';
import { RESOURCE_BROKER_LIMITS } from './resource-broker.mjs';

const id = n => `ed900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORIGIN = 'http://127.0.0.1:5191', CONTROL = '/api/pathfinder-producer-control';
const failure = code => Object.assign(new Error(code), { code });
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const proof = { joined: true, removed: true, containerId: 'e'.repeat(64) };

/** Uses the actual resource broker and native Web Response/ReadableStream
 * implementations. Only the host HTTP/helper/clock seams are in-memory fakes. */
function fixture({ payload, chunks, keepOpen = false, cancelThrows = false, omitLength = false }) {
  const configuration = { key: 'a'.repeat(64), owner: id(1), project: 'wfc-pathfinder-local-abcdef123456', image: 'sha256:' + 'b'.repeat(64), runtimeInventorySha256: 'c'.repeat(64) };
  const identity = { instanceId: id(2), projectId: id(3), modelVersionId: id(4), loadId: id(5), sessionId: id(6) };
  const resources = { projectId: identity.projectId, modelVersionId: identity.modelVersionId, sessionId: identity.sessionId, capability: 'd'.repeat(43) };
  const attempt = { attemptId: id(7), identity, owner: configuration.owner, project: configuration.project, image: configuration.image, runtimeInventorySha256: configuration.runtimeInventorySha256, resources };
  const base = `/api/projects/${identity.projectId}/model-versions/${identity.modelVersionId}/producer-sessions/${identity.sessionId}/`, controller = new AbortController();
  const calls = [], records = [], observations = [], responses = [], streams = []; let cancelCount = 0, fetches = 0, authorizations = 0, broker, runClient;
  const seccompBytes = Buffer.from(JSON.stringify({ defaultAction: 'SCMP_ACT_ERRNO', syscalls: [{ names: ['read', 'write'], action: 'SCMP_ACT_ALLOW' }] }));
  const journal = {
    async list() { return [...records]; },
    async retain(input) { calls.push('retain'); const record = { ...input }; records.push(record); return record; },
    async retire(record, receipt) { assert.equal(receipt.acknowledged, true); calls.push('retire'); records.splice(records.indexOf(record), 1); },
  };
  const request = (changes = {}) => ({ kind: 'resource', method: 'GET', path: base + 'descriptor', range: null, offset: 0, length: RESOURCE_BROKER_LIMITS.chunkBytes, ...changes });
  const dependencies = {
    // Deliberately omit createBroker: this path must execute the production
    // createManagedResourceBroker and its actual cleanup/currentness guards.
    async openClient(options) {
      broker = options.broker; assert.equal(broker.snapshot.handles, 0); await runClient(options);
      return { async exchange() { assert.fail('Only resource lifecycle is under test'); }, async close() { await broker.dispose(); calls.push('client-close'); return proof; } };
    },
    async fetch(url, init) {
      assert.equal(init.redirect, 'error'); assert.equal(init.headers.Origin, ORIGIN);
      if (url.startsWith(ORIGIN + CONTROL + '/')) {
        assert.equal(init.headers['X-WFC-PF-Control-Key'], configuration.key); assert.equal(init.headers['X-WFC-PF-Producer-Capability'], undefined);
        const suffix = url.slice((ORIGIN + CONTROL).length); calls.push(suffix);
        if (suffix === '/claim') return json({ attempt });
        if (suffix === '/' + attempt.attemptId + '/next') return json({ command: { kind: 'close', requestId: id(8) }, joined: false, quarantined: false });
        if (suffix === '/' + attempt.attemptId + '/reply') return json({ acknowledged: true, duplicate: false });
        if (suffix === '/' + attempt.attemptId + '/joined') { assert.ok(records.length > 0); assert.deepEqual(JSON.parse(init.body), proof); return json({ acknowledged: true, duplicate: false }); }
        if (suffix === '/' + attempt.attemptId + '/fault') return json({ quarantined: true });
        assert.fail('Unexpected control request');
      }
      assert.ok(url.startsWith(ORIGIN + base)); assert.equal(init.headers['X-WFC-PF-Control-Key'], undefined); assert.equal(init.headers['X-WFC-PF-Producer-Capability'], resources.capability);
      assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers.Cookie, undefined);
      if (url === ORIGIN + base + 'pathfinder-authorization') { authorizations++; return json({ authorized: true, loadId: identity.loadId }); }
      assert.equal(url, ORIGIN + base + 'descriptor'); assert.equal(init.method, 'GET'); fetches++;
      const stream = new ReadableStream({
        start(streamController) { for (const chunk of chunks ?? [payload]) streamController.enqueue(Uint8Array.from(chunk)); if (!keepOpen) streamController.close(); },
        cancel() { cancelCount++; if (cancelThrows) throw failure('PRODUCER_TEST_CLOSE_REFUSED'); },
      });
      const headers = { 'content-type': 'application/json', ...(omitLength ? {} : { 'content-length': String(payload.length) }) };
      const response = new Response(stream, { status: 200, headers }); streams.push(stream); responses.push(response); return response;
    },
    async delay(milliseconds) { assert.ok([500, 1000, 10000, 200].includes(milliseconds)); controller.abort(); throw failure('PRODUCER_TEST_STOP'); },
  };
  const run = action => { runClient = action; return runManagedHostWorker({ configuration, seccompBytes, seccompSha256: createHash('sha256').update(seccompBytes).digest('hex'), journal,
    async beforeStart(input) { assert.deepEqual(input.identity, identity); calls.push('before-start'); }, signal: controller.signal, observe: value => observations.push(value) }, dependencies); };
  return { configuration, identity, controller, calls, records, observations, request, run, responses, streams,
    get broker() { return broker; }, get counts() { return { cancelCount, fetches, authorizations }; } };
}

test('a finite descriptor Response completes and releases its native reader before close without cancelling a detached reader', { timeout: 2000 }, async () => {
  const payload = Buffer.from(JSON.stringify({ supportProfile: 'svf', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'output/0/0.svf', resourceCount: 1, totalBytes: 3 }));
  const f = fixture({ payload }); const result = await f.run(async options => {
    const value = await options.broker.request(id(10), f.request()); assert.equal(value.complete, true); assert.deepEqual(Buffer.from(value.dataBase64, 'base64'), payload);
    assert.equal(options.broker.snapshot.handles, 0); assert.equal(f.responses[0].body.locked, false); assert.equal(f.streams[0].locked, false);
  });
  assert.equal(result.lastErrorCode, null); assert.equal(f.counts.fetches, 1); assert.equal(f.counts.authorizations, 3); assert.equal(f.records.length, 0);
  assert.ok(f.calls.includes('client-close')); assert.ok(f.calls.includes('retire')); assert.equal(f.broker.snapshot.quarantined, 0);
});

test('chunked continuation consumes one pinned Web Response and releases the reader only at the exact finite end', { timeout: 2000 }, async () => {
  const payload = Buffer.alloc(70003); for (let n = 0; n < payload.length; n++) payload[n] = n % 251;
  const f = fixture({ payload, chunks: [payload.subarray(0, 10007), payload.subarray(10007, 40008), payload.subarray(40008)] });
  const result = await f.run(async options => {
    const first = await options.broker.request(id(10), f.request()); assert.equal(first.complete, false); assert.equal(options.broker.snapshot.handles, 1); assert.equal(f.responses[0].body.locked, true);
    const last = await options.broker.request(id(10), f.request({ offset: RESOURCE_BROKER_LIMITS.chunkBytes })); assert.equal(last.complete, true);
    assert.deepEqual(Buffer.concat([Buffer.from(first.dataBase64, 'base64'), Buffer.from(last.dataBase64, 'base64')]), payload);
    assert.equal(options.broker.snapshot.handles, 0); assert.equal(options.broker.snapshot.bytes, payload.length); assert.equal(f.responses[0].body.locked, false);
  });
  assert.equal(result.lastErrorCode, null); assert.equal(f.counts.fetches, 1); assert.equal(f.counts.authorizations, 5); assert.equal(f.broker.snapshot.quarantined, 0);
});

test('abort between chunks closes the actual partial native stream and refuses any continuation', { timeout: 2000 }, async () => {
  const payload = Buffer.alloc(RESOURCE_BROKER_LIMITS.chunkBytes + 4096, 7), f = fixture({ payload, chunks: [payload.subarray(0, RESOURCE_BROKER_LIMITS.chunkBytes)], keepOpen: true });
  const result = await f.run(async options => {
    const first = await options.broker.request(id(10), f.request()); assert.equal(first.complete, false); assert.equal(options.broker.snapshot.handles, 1);
    assert.equal(Buffer.from(first.dataBase64, 'base64').length, RESOURCE_BROKER_LIMITS.chunkBytes); assert.equal(first.totalBytes - RESOURCE_BROKER_LIMITS.chunkBytes, 4096);
    assert.equal(f.responses[0].body.locked, true);
    f.controller.abort(); await options.broker.dispose(); assert.equal(options.broker.snapshot.handles, 0); assert.equal(f.responses[0].body.locked, false);
    let refusal; try { await options.broker.request(id(10), f.request({ offset: RESOURCE_BROKER_LIMITS.chunkBytes })); assert.fail('An aborted continuation must not return bytes'); }
    catch (error) { refusal = error; } assert.equal(refusal.code, 'PRODUCER_RESOURCE_BUDGET'); throw refusal;
  });
  assert.equal(result.lastErrorCode, 'PRODUCER_RESOURCE_BUDGET'); assert.equal(f.counts.cancelCount, 1); assert.equal(f.counts.fetches, 1);
  assert.equal(f.calls.some(value => value.endsWith('/joined')), false); assert.equal(f.records.length, 0);
});

test('a native stream cancellation failure remains unknown cleanup and never yields a joined acknowledgement', { timeout: 2000 }, async () => {
  const payload = Buffer.alloc(RESOURCE_BROKER_LIMITS.chunkBytes + 4096, 7), f = fixture({ payload, chunks: [payload.subarray(0, RESOURCE_BROKER_LIMITS.chunkBytes)], keepOpen: true, cancelThrows: true });
  const result = await f.run(async options => {
    const first = await options.broker.request(id(10), f.request()); assert.equal(first.complete, false);
    assert.equal(Buffer.from(first.dataBase64, 'base64').length, RESOURCE_BROKER_LIMITS.chunkBytes); assert.equal(options.broker.snapshot.handles, 1); assert.equal(f.responses[0].body.locked, true);
    await options.broker.dispose(); assert.fail('Unknown resource cleanup must not admit a helper as ready');
  });
  assert.equal(result.lastErrorCode, 'PRODUCER_RESOURCE_CLOSE_UNKNOWN'); assert.equal(f.counts.cancelCount, 1); assert.equal(f.broker.snapshot.quarantined, 1);
  assert.equal(f.calls.some(value => value.endsWith('/joined')), false); assert.equal(f.records.length, 0); assert.equal(f.calls.includes('client-close'), false);
});

test('a response without a finite Content-Length is cancelled before broker adoption and remains a refusal', { timeout: 2000 }, async () => {
  const payload = Buffer.from('finite synthetic body'), f = fixture({ payload, chunks: [payload], keepOpen: true, omitLength: true });
  const result = await f.run(async options => {
    await options.broker.request(id(10), f.request()); assert.fail('An unbounded source response must not produce bytes');
  });
  assert.equal(result.lastErrorCode, 'PRODUCER_RESOURCE_LENGTH_INVALID'); assert.equal(f.counts.cancelCount, 1); assert.equal(f.broker.snapshot.handles, 0);
  assert.equal(f.records.length, 0); assert.equal(f.calls.some(value => value.endsWith('/joined')), false);
});
