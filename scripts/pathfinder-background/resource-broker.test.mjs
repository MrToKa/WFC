import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagedResourceBroker, mapManagedResourcePath, RESOURCE_BROKER_LIMITS, sanitizeManagedResourceHeaders } from './resource-broker.mjs';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const identity = { projectId: uuid(1), modelVersionId: uuid(2), sessionId: uuid(3) };
const helperOrigin = 'http://127.0.0.1:12345', sourceOrigin = 'http://127.0.0.1:5191';
const prefix = `/api/projects/${identity.projectId}/model-versions/${identity.modelVersionId}/producer-sessions/${identity.sessionId}/`;
const request = (changes = {}) => ({ kind: 'resource', method: 'GET', path: prefix + 'resources/output/0/0.svf', range: null, offset: 0, length: RESOURCE_BROKER_LIMITS.chunkBytes, ...changes });
const flush = async () => { for (let index = 0; index < 50; index++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(options = {}) {
  const reads = [], auth = [], closed = [], timers = new Map(); let clock = 1000, timerId = 0;
  const broker = createManagedResourceBroker({ identity, helperOrigin, sourceOrigin,
    authorize: async (...args) => { auth.push(args); },
    readResource: async value => { reads.push(value); return { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': '3' }, totalBytes: 3, body: Buffer.from('abc'), close: async () => { closed.push(value.path); } }; },
    now: () => clock,
    setTimer: (callback, delay) => { const timer = { id: ++timerId, unref() {} }; timers.set(timer, { callback, delay, at: clock + delay }); return timer; },
    clearTimer: timer => timers.delete(timer), ...options });
  return { broker, reads, auth, closed, timers, async advance(milliseconds) { clock += milliseconds; const due = [...timers].filter(([, value]) => value.at <= clock); for (const [key, value] of due) { timers.delete(key); value.callback(); } await flush(); } };
}

test('broker maps only its exact resource family and rewrites only the matching local domain', () => {
  assert.equal(mapManagedResourcePath(prefix + 'descriptor', identity, helperOrigin, sourceOrigin), prefix + 'descriptor');
  assert.equal(mapManagedResourcePath(prefix + 'resources/output/0/0.svf?domain=' + encodeURIComponent(helperOrigin), identity, helperOrigin, sourceOrigin), prefix + 'resources/output/0/0.svf?domain=' + encodeURIComponent(sourceOrigin));
  for (const raw of ['https://example.com/a', '//127.0.0.1:5191/a', prefix.replace(identity.projectId, uuid(99)) + 'descriptor',
    prefix.replace('producer-sessions', 'viewer-sessions') + 'descriptor', prefix + 'resources/a?domain=' + encodeURIComponent(sourceOrigin),
    prefix + 'resources/a?domain=' + encodeURIComponent(helperOrigin) + '&x=1', prefix + 'descriptor?domain=' + encodeURIComponent(helperOrigin),
    prefix + 'resources/%2e%2e/private', prefix + 'resources/a%2Fb', '/viewer-runtime/7.130.0/producer-host.html']) {
    assert.throws(() => mapManagedResourcePath(raw, identity, helperOrigin, sourceOrigin));
  }
  assert.throws(() => mapManagedResourcePath(prefix + 'descriptor', identity, helperOrigin, 'http://127.0.0.1:5190'), { code: 'PRODUCER_BROKER_SOURCE_REFUSED' });
});

test('configuration requires explicit current authorization and fixed local origins', () => {
  const base = { identity, helperOrigin, sourceOrigin, authorize: async () => {}, readResource: async () => {} };
  for (const changes of [{ authorize: undefined }, { sourceOrigin: 'http://localhost:5191' }, { helperOrigin: 'http://127.0.0.1:12345/path' },
    { helperOrigin: 'http://127.0.0.1:65536' }, { helperOrigin: 'http://example.com:12345' }, { identity: { ...identity, actorId: uuid(9) } }]) {
    assert.throws(() => createManagedResourceBroker({ ...base, ...changes }));
  }
});

test('headers are canonical and limited; cookies, auth, malformed and duplicate fields are refused', () => {
  assert.deepEqual(sanitizeManagedResourceHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': '3', 'cache-control': 'private, no-store', date: 'Mon, 19 Oct 2026 00:00:00 GMT' }), { 'content-type': 'application/json; charset=utf-8', 'content-length': '3' });
  for (const headers of [{ 'set-cookie': 'private=secret' }, { authorization: 'Bearer secret' }, { 'content-type': 'text/html' },
    { 'Content-Length': '3', 'content-length': '3' }, { 'content-length': '03' }, { 'content-type': 'application/json\r\nInjected: value' }]) {
    assert.throws(() => sanitizeManagedResourceHeaders(headers), { code: 'PRODUCER_RESOURCE_HEADERS_REFUSED' });
  }
});

test('a verified response opens once, reauthorizes and closes before returning its final chunk', async () => {
  const f = fixture(); const value = await f.broker.request(uuid(10), request());
  assert.equal(Buffer.from(value.dataBase64, 'base64').toString(), 'abc'); assert.equal(value.complete, true);
  assert.equal(f.reads.length, 1); assert.equal(f.closed.length, 1); assert.equal(f.auth.length, 3);
  assert.equal(f.reads[0].path, prefix + 'resources/output/0/0.svf'); assert.equal(f.reads[0].method, 'GET');
  assert.equal(f.broker.snapshot.handles, 0); assert.equal(f.timers.size, 0);
  await assert.rejects(f.broker.request(uuid(10), request()), { code: 'PRODUCER_RESOURCE_IDENTITY_REFUSED' });
  await f.broker.dispose();
});

test('continuations retain the same verified response and exact monotonically increasing identity', async () => {
  const body = Buffer.alloc(RESOURCE_BROKER_LIMITS.chunkBytes + 3, 7), closes = [], reads = [];
  const f = fixture({ readResource: async value => { reads.push(value); return { status: 200, headers: {}, totalBytes: body.length, body, close: async () => { closes.push(true); } }; } });
  const first = await f.broker.request(uuid(10), request()); assert.equal(first.complete, false); assert.equal(f.broker.snapshot.handles, 1); assert.equal(closes.length, 0);
  assert.equal(Buffer.from(first.dataBase64, 'base64').length, RESOURCE_BROKER_LIMITS.chunkBytes);
  const last = await f.broker.request(uuid(10), request({ offset: RESOURCE_BROKER_LIMITS.chunkBytes, length: 3 })); assert.equal(last.complete, true); assert.equal(Buffer.from(last.dataBase64, 'base64').length, 3);
  assert.equal(reads.length, 1); assert.equal(closes.length, 1); assert.equal(f.broker.snapshot.bytes, body.length);
  await f.broker.dispose();
});

test('undersized non-final and oversized requests cannot weaken the production chunk bounds', async () => {
  let closes = 0;
  const size = RESOURCE_BROKER_LIMITS.chunkBytes + 3, f = fixture({ readResource: async () => ({ status: 200, headers: {}, totalBytes: size,
    body: Buffer.alloc(size), close: async () => { closes++; } }) });
  await assert.rejects(f.broker.request(uuid(10), request({ length: RESOURCE_BROKER_LIMITS.chunkBytes - 1 })), { code: 'PRODUCER_RESOURCE_REQUEST_INVALID' });
  await assert.rejects(f.broker.request(uuid(11), request({ length: RESOURCE_BROKER_LIMITS.chunkBytes + 1 })), { code: 'PRODUCER_RESOURCE_REQUEST_INVALID' });
  assert.equal(closes, 1); assert.equal(f.broker.snapshot.handles, 0); await f.broker.dispose();
});

test('a changed continuation is rejected and closes the original pinned resource', async () => {
  for (const changed of [{ offset: 1 }, { path: prefix + 'resources/other.bin' }, { range: 'bytes=0-1' }, { method: 'HEAD' }]) {
    let closed = 0;
    const size = RESOURCE_BROKER_LIMITS.chunkBytes + 1, f = fixture({ readResource: async () => ({ status: 200, headers: {}, totalBytes: size, body: Buffer.alloc(size), close: async () => { closed++; } }) });
    await f.broker.request(uuid(10), request());
    await assert.rejects(f.broker.request(uuid(10), request({ offset: RESOURCE_BROKER_LIMITS.chunkBytes, ...changed })), { code: 'PRODUCER_RESOURCE_IDENTITY_REFUSED' });
    assert.equal(closed, 1); assert.equal(f.broker.snapshot.handles, 0); await f.broker.dispose();
  }
});

test('stream input stays pinned and buffered chunks are copied before the iterator reuses memory', async () => {
  let closes = 0;
  async function* stream() { const scratch = Buffer.alloc(40000, 65); yield scratch; scratch.fill(66); yield scratch; }
  const f = fixture({ readResource: async () => ({ status: 200, headers: {}, totalBytes: 80000, body: stream(), close: async () => { closes++; } }) });
  const first = await f.broker.request(uuid(10), request()), bytes = Buffer.from(first.dataBase64, 'base64');
  assert.equal(bytes.length, RESOURCE_BROKER_LIMITS.chunkBytes); assert.equal(bytes[0], 65); assert.equal(bytes[39999], 65); assert.equal(bytes[40000], 66);
  const last = await f.broker.request(uuid(10), request({ offset: RESOURCE_BROKER_LIMITS.chunkBytes })); assert.equal(last.complete, true); assert.equal(closes, 1);
  await f.broker.dispose();
});

test('truncated, excess and oversized stream chunks are errors and release their verified handles', async () => {
  for (const [totalBytes, values] of [[4, [Buffer.from('abc')]], [2, [Buffer.from('abc')]], [1, [Buffer.alloc(RESOURCE_BROKER_LIMITS.upstreamChunkBytes + 1)]]]) {
    let closes = 0; async function* body() { yield* values; }
    const f = fixture({ readResource: async () => ({ status: 200, headers: {}, totalBytes, body: body(), close: async () => { closes++; } }) });
    await assert.rejects(f.broker.request(uuid(10), request()), { code: 'PRODUCER_RESOURCE_BODY_INVALID' }); assert.equal(closes, 1); await f.broker.dispose();
  }
});

test('authorization revoked during open or body I/O never releases that chunk', async () => {
  for (const phase of ['open', 'body', 'close']) {
    let allowed = true, closes = 0;
    async function* body() { allowed = false; yield Buffer.from('abc'); }
    const f = fixture({ authorize: async () => { if (!allowed) throw Object.assign(new Error('private authorization details'), { code: 'PRODUCER_RESOURCE_ACCESS_REVOKED' }); },
      readResource: async () => { if (phase === 'open') allowed = false; return { status: 200, headers: {}, totalBytes: 3, body: phase === 'body' ? body() : Buffer.from('abc'), close: async () => { closes++; if (phase === 'close') allowed = false; } }; } });
    await assert.rejects(f.broker.request(uuid(10), request()), { code: 'PRODUCER_RESOURCE_ACCESS_REVOKED' });
    assert.equal(closes, 1); assert.equal(f.broker.snapshot.handles, 0); await f.broker.dispose();
  }
});

test('HEAD200/304 are bodyless while 206 and 416 retain validated range facts', async () => {
  for (const status of [200, 304]) {
    const f = fixture({ readResource: async () => ({ status, headers: { 'content-length': '100' }, totalBytes: 0, body: Buffer.alloc(0) }) });
    const value = await f.broker.request(uuid(10), request({ method: 'HEAD' })); assert.equal(value.status, status); assert.equal(value.totalBytes, 0); assert.equal(value.dataBase64, ''); assert.equal(value.headers['content-length'], '100'); await f.broker.dispose();
  }
  const ranged = fixture({ readResource: async () => ({ status: 206, headers: { 'content-range': 'bytes 10-12/100', 'content-length': '3', 'accept-ranges': 'bytes' }, totalBytes: 3, body: Buffer.from('abc') }) });
  assert.equal((await ranged.broker.request(uuid(10), request({ range: 'bytes=10-12' }))).status, 206); await ranged.broker.dispose();
  const refused = fixture({ readResource: async () => ({ status: 416, headers: { 'content-range': 'bytes */100', 'content-type': 'application/json' }, totalBytes: 2, body: Buffer.from('{}') }) });
  assert.equal((await refused.broker.request(uuid(10), request({ range: 'bytes=1000-' }))).status, 416); await refused.broker.dispose();
});

test('sixteen retained handles are bounded and dispose closes each without unrelated resource access', async () => {
  const closes = [];
  const size = RESOURCE_BROKER_LIMITS.chunkBytes + 1, f = fixture({ readResource: async value => ({ status: 200, headers: {}, totalBytes: size, body: Buffer.alloc(size), close: async () => { closes.push(value.path); } }) });
  await Promise.all(Array.from({ length: 16 }, (_, index) => f.broker.request(uuid(100 + index), request())));
  assert.equal(f.broker.snapshot.handles, 16);
  await assert.rejects(f.broker.request(uuid(200), request()), { code: 'PRODUCER_RESOURCE_IDENTITY_REFUSED' });
  await f.broker.dispose(); assert.equal(closes.length, 16); assert.equal(f.broker.snapshot.handles, 0); assert.equal(f.timers.size, 0);
  await assert.rejects(f.broker.request(uuid(201), request()), { code: 'PRODUCER_RESOURCE_BUDGET' });
});

test('an abandoned resource expires after thirty seconds and its UUID cannot reopen it', async () => {
  let closes = 0;
  const size = RESOURCE_BROKER_LIMITS.chunkBytes + 1, f = fixture({ readResource: async () => ({ status: 200, headers: {}, totalBytes: size, body: Buffer.alloc(size), close: async () => { closes++; } }) });
  await f.broker.request(uuid(10), request()); await f.advance(30000);
  assert.equal(closes, 1); assert.equal(f.broker.snapshot.handles, 0);
  await assert.rejects(f.broker.request(uuid(10), request({ offset: RESOURCE_BROKER_LIMITS.chunkBytes })), { code: 'PRODUCER_RESOURCE_IDENTITY_REFUSED' }); await f.broker.dispose();
});

test('cancel during pending I/O closes the subsequently known resource instead of leaking or returning bytes', async () => {
  const opening = deferred(), f = fixture({ readResource: () => opening.promise }); let closes = 0;
  const reading = f.broker.request(uuid(10), request()); await flush(); const cancelling = f.broker.cancel(uuid(10));
  opening.resolve({ status: 200, headers: {}, totalBytes: 3, body: Buffer.from('abc'), close: async () => { closes++; } });
  await assert.rejects(reading); await cancelling; assert.equal(closes, 1); assert.equal(f.broker.snapshot.handles, 0); await f.broker.dispose();
});

test('a failed source open leaves no invented handle, while an uncertain close remains quarantined', async () => {
  const failed = fixture({ readResource: async () => { throw new Error('private upstream error'); } });
  await assert.rejects(failed.broker.request(uuid(10), request()), { code: 'PRODUCER_RESOURCE_READ_FAILED' }); assert.equal(failed.broker.snapshot.handles, 0); await failed.broker.dispose();
  const unknown = fixture({ readResource: async () => ({ status: 200, headers: {}, totalBytes: 3, body: Buffer.from('abc'), close: async () => { throw new Error('private closure details'); } }) });
  await assert.rejects(unknown.broker.request(uuid(10), request()), { code: 'PRODUCER_RESOURCE_CLOSE_UNKNOWN' });
  assert.equal(unknown.broker.snapshot.quarantined, 1); await assert.rejects(unknown.broker.dispose(), { code: 'PRODUCER_RESOURCE_CLOSE_UNKNOWN' });
});
