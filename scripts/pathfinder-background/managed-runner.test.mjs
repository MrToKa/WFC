import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvelope } from '../../viewer-runtime/protocol.mjs';
import { PRODUCER_WIRE_VERSION } from './producer-process.mjs';
import { classifyManagedRequest, createManagedResourceRelay, createManagedRunner, MANAGED_RUNNER_LIMITS,
  validateManagedInitialize, validateManagedRange, validateManagedResourceResponse } from './managed-runner.mjs';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const identity = { instanceId: uuid(1), projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), sessionId: uuid(5) };
const initialize = { kind: 'initialize', identity, runtimeInventorySha256: 'a'.repeat(64) };
const origin = 'http://127.0.0.1:12345';
const prefix = `/api/projects/${identity.projectId}/model-versions/${identity.modelVersionId}/producer-sessions/${identity.sessionId}/`;
const assets = new Map([['producer-host.html', {}], ['producer.html', {}], ['sdk/viewer3D.min.js', {}]]);
const resource = (changes = {}) => ({ kind: 'resource', method: 'GET', path: prefix + 'resources/output/0/0.svf', range: null,
  offset: 0, length: MANAGED_RUNNER_LIMITS.chunkBytes, ...changes });
const chunk = (text = 'abc', changes = {}) => ({ status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(Buffer.byteLength(text)) },
  totalBytes: Buffer.byteLength(text), dataBase64: Buffer.from(text).toString('base64'), complete: true, ...changes });
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function wire(type, sequence, payload, requestId = uuid(10)) { return { schemaVersion: PRODUCER_WIRE_VERSION, attemptId: uuid(9), type, sequence, payload, requestId }; }
function frame(type = 'READ_MODEL_CAPTURE', payload = { captureId: uuid(20), index: 0 }, changes = {}) {
  return { channel: 'wfc-routings-viewer', protocolVersion: 1, instanceId: identity.instanceId, projectId: identity.projectId,
    modelVersionId: identity.modelVersionId, loadId: identity.loadId, requestId: uuid(21), type, payload, ...changes };
}
function fixture(options = {}) {
  const output = [], calls = [];
  const handle = {
    validateEnvelope,
    async initialize(value) { calls.push(['initialize', value]); return { schemaVersion: 'wfc.pf.producer-host-ready.v1', ...identity, sdkVersion: '7.130.0' }; },
    async exchange(value) { calls.push(['exchange', value]); return frame('MODEL_CAPTURE_EVENT', { captureId: uuid(20), index: 0, done: true, eventJson: '{}' }); },
    async close() { calls.push(['close']); }, snapshot() { return { bounded: true }; },
  };
  const runner = createManagedRunner({ attemptId: uuid(9), emit: value => { output.push(value); }, open: async value => { calls.push(['open', value]); return handle; }, ...options });
  return { output, calls, handle, runner };
}
const request = (method = 'GET') => ({ method, url: prefix + 'resources/output/0/0.svf', headers: {} });
function response() {
  return { destroyed: false, chunks: [], ended: false, writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(bytes) { this.chunks.push(bytes); return true; }, end() { this.ended = true; } };
}

test('initialize accepts only five pinned UUID identities and an inventory digest', () => {
  assert.deepEqual(validateManagedInitialize(initialize), initialize);
  for (const value of [{ ...initialize, token: 'credential' }, { ...initialize, identity: { ...identity, actorId: uuid(6) } },
    { ...initialize, runtimeInventorySha256: 'tag' }, { ...initialize, identity: { ...identity, sessionId: '../session' } }]) {
    assert.throws(() => validateManagedInitialize(value), { code: 'PRODUCER_INITIALIZE_INVALID' });
  }
});

test('local requests permit only listed assets, exact bootstrap and one project/model/session family', () => {
  assert.deepEqual(classifyManagedRequest('/viewer-runtime/7.130.0/producer-host.html', identity, origin, assets), { kind: 'asset', relative: 'producer-host.html' });
  assert.equal(classifyManagedRequest(`/viewer-runtime/7.130.0/producer.html?instanceId=${identity.instanceId}&projectId=${identity.projectId}`, identity, origin, assets).kind, 'asset');
  assert.equal(classifyManagedRequest(prefix + 'descriptor', identity, origin, assets).kind, 'resource');
  assert.equal(classifyManagedRequest(prefix + 'resources/output/0/0.svf?domain=' + encodeURIComponent(origin), identity, origin, assets).kind, 'resource');
  for (const value of ['https://example.com/a', '//example.com/a', '/viewer-runtime/7.130.0/missing.js', '/viewer-runtime/7.130.0/producer.html',
    '/viewer-runtime/7.130.0/sdk/viewer3D.min.js?x=1', prefix + 'descriptor?domain=' + encodeURIComponent(origin),
    prefix + 'resources/a?domain=' + encodeURIComponent('http://127.0.0.1:5191'), prefix + 'resources/../secret', prefix + 'resources/%2e%2e/secret',
    prefix + 'resources/a%2Fb', prefix + 'resources/%252e%252e', prefix.replace(identity.projectId, uuid(99)) + 'descriptor', prefix + 'resources/a#fragment']) {
    assert.throws(() => classifyManagedRequest(value, identity, origin, assets), { code: 'PRODUCER_HTTP_PATH_REFUSED' });
  }
});

test('ranges reject multiple ranges, whitespace, overflow and caller headers', () => {
  for (const value of [null, 'bytes=0-', 'bytes=0-9', 'bytes=-100']) assert.equal(validateManagedRange(value), value);
  for (const value of ['bytes=0-1,3-4', ' bytes=0-1', 'bytes=-', 'bytes=9007199254740992-', ['bytes=0-1']]) assert.throws(() => validateManagedRange(value), { code: 'PRODUCER_HTTP_RANGE_REFUSED' });
});

test('resource chunks enforce canonical base64, complete/offset and finite bounded bodies', () => {
  const value = validateManagedResourceResponse(chunk(), resource()); assert.equal(value.bytes.toString(), 'abc');
  for (const changed of [chunk('abc', { dataBase64: 'YWJj\n' }), chunk('abc', { complete: false }), chunk('abc', { totalBytes: Infinity }),
    chunk('abc', { dataBase64: 'YQ==', totalBytes: 3 }), chunk('abc', { totalBytes: MANAGED_RUNNER_LIMITS.resourceBytes + 1 }),
    chunk('abc', { headers: { 'content-length': '6' }, totalBytes: 6, complete: false }), chunk(Buffer.alloc(MANAGED_RUNNER_LIMITS.chunkBytes + 1))]) {
    assert.throws(() => validateManagedResourceResponse(changed, resource()), { code: 'PRODUCER_RESOURCE_RESPONSE_INVALID' });
  }
  assert.throws(() => validateManagedResourceResponse(chunk('abc', { headers: { 'set-cookie': 'private=secret' } }), resource()), { code: 'PRODUCER_RESOURCE_HEADERS_REFUSED' });
  assert.throws(() => validateManagedResourceResponse(chunk('abc', { headers: { 'content-length': '4' } }), resource()), { code: 'PRODUCER_RESOURCE_HEADERS_REFUSED' });
  const head = validateManagedResourceResponse(chunk('', { headers: { 'content-length': '100' } }), resource({ method: 'HEAD' })); assert.equal(head.bytes.length, 0);
});

test('a continuation cannot switch status, response size or headers', () => {
  const total = MANAGED_RUNNER_LIMITS.chunkBytes + 3, headers = { 'content-length': String(total) };
  const first = validateManagedResourceResponse(chunk(Buffer.alloc(MANAGED_RUNNER_LIMITS.chunkBytes, 65), { headers, totalBytes: total, complete: false }), resource());
  assert.equal(first.bytes.length, MANAGED_RUNNER_LIMITS.chunkBytes);
  assert.equal(validateManagedResourceResponse(chunk('def', { headers, totalBytes: total }), resource({ offset: MANAGED_RUNNER_LIMITS.chunkBytes }), first).complete, true);
  assert.throws(() => validateManagedResourceResponse(chunk('def', { status: 206, headers, totalBytes: total }), resource({ offset: MANAGED_RUNNER_LIMITS.chunkBytes }), first), { code: 'PRODUCER_RESOURCE_RESPONSE_CHANGED' });
  assert.throws(() => validateManagedResourceResponse(chunk('defg', { headers: { 'content-length': String(total + 1) }, totalBytes: total + 1 }), resource({ offset: MANAGED_RUNNER_LIMITS.chunkBytes }), first), { code: 'PRODUCER_RESOURCE_RESPONSE_CHANGED' });
  assert.throws(() => validateManagedResourceResponse(chunk('def', { headers: { ...headers, 'content-type': 'application/json' }, totalBytes: total }), resource({ offset: MANAGED_RUNNER_LIMITS.chunkBytes }), first), { code: 'PRODUCER_RESOURCE_RESPONSE_CHANGED' });
});

test('relay streams chunks with one stable resource identity and monotonically increasing offsets', async () => {
  const total = MANAGED_RUNNER_LIMITS.chunkBytes + 3, first = Buffer.alloc(MANAGED_RUNNER_LIMITS.chunkBytes, 65);
  const seen = [], relay = createManagedResourceRelay({ identity, origin, assets, rpc: async (id, payload) => {
    seen.push({ id, payload }); return chunk(payload.offset === 0 ? first : 'def', { headers: { 'content-length': String(total) }, totalBytes: total, complete: payload.offset === MANAGED_RUNNER_LIMITS.chunkBytes });
  } });
  const res = response(); await relay.serve(request(), res);
  assert.deepEqual(seen.map(value => value.payload.offset), [0, MANAGED_RUNNER_LIMITS.chunkBytes]); assert.equal(seen[0].id, seen[1].id);
  assert.deepEqual(seen.map(value => value.payload.length), [MANAGED_RUNNER_LIMITS.chunkBytes, MANAGED_RUNNER_LIMITS.chunkBytes]);
  assert.deepEqual(Buffer.concat(res.chunks), Buffer.concat([first, Buffer.from('def')])); assert.equal(res.ended, true);
  assert.deepEqual(relay.snapshot, { active: 0, requests: 2, bytes: total, stopped: false });
  assert.equal(res.headers['cache-control'], 'no-store'); assert.equal(Object.keys(res.headers).includes('authorization'), false);
});

test('relay admits at most sixteen concurrent HTTP responses and refuses subsequent work after stop', async () => {
  const waiting = deferred(), relay = createManagedResourceRelay({ identity, origin, assets, rpc: async () => waiting.promise });
  const active = Array.from({ length: 16 }, () => relay.serve(request(), response()));
  await assert.rejects(relay.serve(request(), response()), { code: 'PRODUCER_RESOURCE_CONCURRENCY' });
  waiting.resolve(chunk()); await Promise.all(active); assert.equal(relay.snapshot.active, 0);
  relay.stop(); await assert.rejects(relay.serve(request(), response()), { code: 'PRODUCER_RESOURCE_CONCURRENCY' });
});

test('runner initializes through its fixed facade, exchanges only capture envelopes and joins before done', async () => {
  const f = fixture(); await f.runner.ready(); f.runner.receive(wire('start', 0, initialize)); await flush();
  assert.equal(f.output[0].type, 'ready'); assert.equal(f.output[1].payload.kind, 'initialized'); assert.equal(f.runner.snapshot.state, 'ready');
  f.runner.receive(wire('start', 1, { kind: 'exchange', envelope: frame() }, uuid(11))); await flush();
  assert.equal(f.output[2].payload.envelope.type, 'MODEL_CAPTURE_EVENT'); assert.equal(f.output[2].requestId, uuid(11));
  f.runner.receive(wire('close', 2, {})); await f.runner.closed;
  assert.equal(f.calls.at(-1)[0], 'close'); assert.equal(f.output.at(-1).type, 'done'); assert.equal(f.output.at(-1).payload.status, 'PASS');
  assert.deepEqual(f.output.map(value => value.sequence), [0, 1, 2, 3]);
});

test('resource responses bypass a pending initialization command without stdin deadlock', async () => {
  let connection;
  const f = fixture({ open: async value => {
    connection = value; return { validateEnvelope, async initialize() { await value.rpc(uuid(30), resource()); return { schemaVersion: 'wfc.pf.producer-host-ready.v1', ...identity, sdkVersion: '7.130.0' }; },
      async close() {}, snapshot() { return {}; } };
  } });
  f.runner.receive(wire('start', 0, initialize)); await flush();
  assert.ok(connection); assert.equal(f.output[0].type, 'request'); assert.equal(f.runner.snapshot.state, 'initializing');
  f.runner.receive(wire('response', 1, chunk(), uuid(30))); await flush();
  assert.equal(f.output.at(-1).payload.kind, 'initialized');
  f.runner.receive(wire('close', 2, {})); await f.runner.closed;
});

test('close during browser creation waits for the known launch and its cleanup', async () => {
  const opening = deferred(), joining = deferred(), f = fixture({ open: () => opening.promise });
  f.handle.close = () => { f.calls.push(['close']); return joining.promise; };
  f.runner.receive(wire('start', 0, initialize)); await flush(); f.runner.receive(wire('close', 1, {})); await flush();
  assert.equal(f.output.some(value => value.type === 'done'), false);
  opening.resolve(f.handle); await flush(); assert.equal(f.output.some(value => value.type === 'done'), false);
  joining.resolve(); await f.runner.closed;
  assert.ok(f.calls.some(value => value[0] === 'close')); assert.equal(f.output.at(-1).type, 'done');
});

test('non-capture and cross-project commands cannot gain normal Viewer or Apply authority', async () => {
  for (const envelope of [frame('SHOW_ROUTE', { rawRouting: '/BC1', source: 'manual', cableId: null }), frame('READ_MODEL_CAPTURE', { captureId: uuid(20), index: 0 }, { projectId: uuid(99) })]) {
    const f = fixture(); f.runner.receive(wire('start', 0, initialize)); await flush();
    f.runner.receive(wire('start', 1, { kind: 'exchange', envelope }, uuid(11)));
    await assert.rejects(f.runner.closed, { code: 'PRODUCER_EXCHANGE_REFUSED' });
    assert.equal(f.calls.some(value => value[0] === 'exchange'), false); assert.equal(f.output.at(-1).type, 'error');
  }
});

test('foreign sequence and mismatched facade initialization close the process with safe error codes', async () => {
  const f = fixture(); f.runner.receive(wire('start', 1, initialize)); await assert.rejects(f.runner.closed, { code: 'PRODUCER_WIRE_IDENTITY' });
  const g = fixture(); g.handle.initialize = async () => ({ schemaVersion: 'wfc.pf.producer-host-ready.v1', ...identity, projectId: uuid(99), sdkVersion: '7.130.0' });
  g.runner.receive(wire('start', 0, initialize)); await assert.rejects(g.runner.closed, { code: 'PRODUCER_INITIALIZE_RESPONSE_INVALID' });
  assert.equal(g.calls.at(-1)[0], 'close');
});

test('unknown browser join and cancellation never produce a successful terminal record', async () => {
  const f = fixture(); f.handle.close = async () => { throw Object.assign(new Error('private process details'), { code: 'PRODUCER_BROWSER_JOIN_UNKNOWN' }); };
  f.runner.receive(wire('start', 0, initialize)); await flush(); f.runner.receive(wire('close', 1, {}));
  await assert.rejects(f.runner.closed, { code: 'PRODUCER_BROWSER_JOIN_UNKNOWN' });
  assert.equal(JSON.stringify(f.output).includes('private process details'), false); assert.equal(f.output.some(value => value.type === 'done'), false);
  const g = fixture(); g.runner.receive(wire('cancel', 0, {})); await assert.rejects(g.runner.closed, { code: 'PRODUCER_CANCELLED' });
});
