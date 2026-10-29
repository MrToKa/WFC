import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProducerProfile, PRODUCER_LIMITS } from './container-profile.mjs';
import { createProducerProcess, createProducerFrameDecoder, encodeProducerFrame, PRODUCER_WIRE_VERSION } from './producer-process.mjs';
import { assertSafeBrowserArguments, parseSandboxStatus } from './sandbox-probe.mjs';
import { MANAGED_RUNNER_LIMITS, validateManagedResourceResponse } from './managed-runner.mjs';
import { RESOURCE_BROKER_LIMITS } from './resource-broker.mjs';

const attemptId = '11223344-5566-4788-9900-aabbccddeeff';
const message = (type, sequence = 0, payload = {}, extra = {}) => ({ schemaVersion: PRODUCER_WIRE_VERSION, attemptId, sequence, type, requestId: null, payload, ...extra });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const base = JSON.stringify({ defaultAction: 'SCMP_ACT_ERRNO', syscalls: [{ names: ['read', 'write'], action: 'SCMP_ACT_ALLOW' }] });
  const profile = createProducerProfile({ owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46', project: 'wfc-pathfinder-local-0cba87606e9b',
    attemptId, image: 'sha256:' + 'a'.repeat(64), mode: 'probe', defaultSeccompBytes: base,
    defaultSeccompSha256: createHash('sha256').update(base).digest('hex') });
  const actual = { Id: 'b'.repeat(64), Name: '/' + profile.name, Image: profile.image, Config: structuredClone(profile.config),
    HostConfig: structuredClone(profile.config.HostConfig), Mounts: [], NetworkSettings: { Networks: { none: {} }, Ports: {} },
    State: { Running: false, Pid: 0, Restarting: false, Paused: false } };
  const calls = [], observations = [], received = [], writes = [], exit = deferred(), timers = new Map();
  let callbacks, timerId = 0, stopped = true;
  const setTimer = (callback, delay) => { const key = { id: ++timerId, unref() {} }; timers.set(key, { callback, delay }); return key; };
  const clearTimer = key => timers.delete(key);
  const adapter = {
    async create(name, config) { calls.push('create'); assert.equal(name, profile.name); assert.equal(config, profile.config); return { Id: actual.Id }; },
    async inspect(id) { calls.push('inspect'); assert.equal(id, actual.Id); return actual; },
    async attach(id, value) { calls.push('attach'); assert.equal(id, actual.Id); callbacks = value; },
    async start(id) { calls.push('start'); assert.equal(id, actual.Id); stopped = false; actual.State.Running = true; actual.State.Pid = 17; callbacks.stdout(encodeProducerFrame(message('ready'))); },
    async wait(id) { calls.push('wait'); assert.equal(id, actual.Id); return exit.promise; },
    async writeStdin(id, bytes) { calls.push('write'); assert.equal(id, actual.Id); writes.push(bytes); },
    async stop(id, seconds) { calls.push('stop'); assert.equal(id, actual.Id); assert.equal(seconds, 5); finish(); },
    async closeAttach(id) { calls.push('close-attach'); assert.equal(id, actual.Id); },
    async remove(id) { calls.push('remove'); assert.equal(id, actual.Id); assert.equal(stopped, true); },
  };
  function finish(code = 0) { stopped = true; actual.State.Running = false; actual.State.Pid = 0; exit.resolve({ StatusCode: code }); }
  const process = createProducerProcess(adapter, profile, { setTimer, clearTimer, onMessage: value => { received.push(value); }, observe: value => { observations.push(value); } });
  return { profile, actual, adapter, process, calls, observations, received, writes, timers, exit, finish,
    get callbacks() { return callbacks; },
    fire(delay) { const found = [...timers].find(([, value]) => value.delay === delay); assert.ok(found, 'Expected bounded timer'); timers.delete(found[0]); found[1].callback(); } };
}
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

test('framing accepts fragmented header/body without loss or a giant aggregate transport', () => {
  const values = [], decoder = createProducerFrameDecoder(value => values.push(value));
  const bytes = Buffer.concat([encodeProducerFrame(message('ready')), encodeProducerFrame(message('progress', 1, { completed: 1 }))]);
  for (let at = 0; at < bytes.length; at += 7) decoder.push(bytes.subarray(at, at + 7));
  decoder.finish(); assert.deepEqual(values, [message('ready'), message('progress', 1, { completed: 1 })]);
});

test('a full 64KiB resource response with range headers round-trips inside the unchanged 96KiB wire frame', () => {
  assert.equal(MANAGED_RUNNER_LIMITS.chunkBytes, 65536); assert.equal(RESOURCE_BROKER_LIMITS.chunkBytes, 65536); assert.equal(PRODUCER_LIMITS.frameBytes, 96 * 1024);
  const bytes = Buffer.alloc(MANAGED_RUNNER_LIMITS.chunkBytes, 255), totalBytes = MANAGED_RUNNER_LIMITS.resourceBytes;
  const request = { kind: 'resource', method: 'GET', path: '/unused-codec-only', range: 'bytes=0-', offset: 0, length: MANAGED_RUNNER_LIMITS.chunkBytes };
  const payload = { status: 206, headers: { 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream',
    'content-length': String(totalBytes), 'content-range': `bytes 0-${totalBytes - 1}/${totalBytes}` },
  totalBytes, dataBase64: bytes.toString('base64'), complete: false };
  assert.deepEqual(validateManagedResourceResponse(payload, request).bytes, bytes);
  const original = message('response', 42, payload, { requestId: '00000000-0000-4000-8000-000000000101' }), encoded = encodeProducerFrame(original);
  assert.ok(encoded.length - 4 <= PRODUCER_LIMITS.frameBytes); assert.equal(encoded.readUInt32BE(), encoded.length - 4);
  const received = [], decoder = createProducerFrameDecoder(value => received.push(value));
  for (let offset = 0; offset < encoded.length; offset += 8173) decoder.push(encoded.subarray(offset, offset + 8173));
  decoder.finish(); assert.deepEqual(received, [original]); assert.deepEqual(Buffer.from(received[0].payload.dataBase64, 'base64'), bytes);
  const tooLarge = { ...payload, dataBase64: Buffer.alloc(MANAGED_RUNNER_LIMITS.chunkBytes + 1).toString('base64') };
  assert.throws(() => validateManagedResourceResponse(tooLarge, request), { code: 'PRODUCER_RESOURCE_RESPONSE_INVALID' });
  assert.throws(() => encodeProducerFrame(message('response', 43, { ...payload, dataBase64: Buffer.alloc(PRODUCER_LIMITS.frameBytes).toString('base64') })), { code: 'PRODUCER_WIRE_LIMIT' });
});

test('framing refuses zero/over-budget lengths, bad UTF-8/JSON and truncated input', () => {
  for (const length of [0, PRODUCER_LIMITS.frameBytes + 1]) {
    const decoder = createProducerFrameDecoder(() => assert.fail('Unexpected message')), header = Buffer.alloc(4); header.writeUInt32BE(length);
    assert.throws(() => decoder.push(header), { code: 'PRODUCER_WIRE_LIMIT' });
  }
  for (const body of [Buffer.from([0xff]), Buffer.from('{')]) {
    const decoder = createProducerFrameDecoder(() => assert.fail('Unexpected message')), header = Buffer.alloc(4); header.writeUInt32BE(body.length);
    assert.throws(() => decoder.push(Buffer.concat([header, body])), { code: 'PRODUCER_WIRE_INVALID' });
  }
  const partial = createProducerFrameDecoder(() => assert.fail('Unexpected message')); partial.push(Buffer.from([0, 0]));
  assert.throws(() => partial.finish(), { code: 'PRODUCER_WIRE_TRUNCATED' });
});

test('outgoing codec refuses accessors, cycles, non-finite input and prototype-bearing payloads', () => {
  const getter = message('start'); Object.defineProperty(getter, 'payload', { enumerable: true, get() { assert.fail('Getter must not execute'); } });
  assert.throws(() => encodeProducerFrame(getter), { code: 'PRODUCER_WIRE_INVALID' });
  const cyclic = {}; cyclic.self = cyclic;
  for (const payload of [cyclic, { number: Infinity }, JSON.parse('{"__proto__":{"polluted":true}}')]) {
    assert.throws(() => encodeProducerFrame(message('start', 0, payload)), { code: 'PRODUCER_WIRE_INVALID' });
  }
});

test('outgoing JSON budgets bound strings and repeated shared graphs before serialization', () => {
  assert.throws(() => encodeProducerFrame(message('start', 0, { value: 'x'.repeat(PRODUCER_LIMITS.frameBytes + 1) })), { code: 'PRODUCER_WIRE_LIMIT' });
  const leaf = Array.from({ length: 100 }, () => 'bounded');
  const repeated = Array.from({ length: 100 }, () => leaf);
  assert.throws(() => encodeProducerFrame(message('start', 0, repeated)), { code: 'PRODUCER_WIRE_LIMIT' });
});

test('fresh startup verifies isolation and attaches before start; completion joins before explicit removal', async () => {
  const f = fixture(); await f.process.start();
  assert.ok(f.calls.indexOf('attach') < f.calls.indexOf('start')); assert.equal(f.process.snapshot.state, 'running');
  assert.equal(f.calls.filter(value => value === 'create').length, 1);
  f.callbacks.stdout(encodeProducerFrame(message('done', 1, { status: 'PASS' }))); f.finish();
  const result = await f.process.completed();
  assert.equal(result.process.state, 'joined'); assert.equal(result.process.exitCode, 0); assert.equal(result.message.payload.status, 'PASS');
  assert.equal(f.calls.includes('remove'), false); assert.equal(f.timers.size, 0);
  await f.process.remove(); assert.ok(f.calls.indexOf('close-attach') < f.calls.indexOf('remove'));
  await f.process.remove(); assert.equal(f.calls.filter(value => value === 'remove').length, 1);
});

test('concurrent start uses one fresh owner; only fixed outbound message types enter stdin', async () => {
  const f = fixture(); await Promise.all([f.process.start(), f.process.start()]);
  await f.process.send({ type: 'start', payload: { scope: 'controlled' } });
  await f.process.send({ type: 'response', requestId: '00000000-0000-4000-8000-000000000001', payload: { bytes: 'YWJj' } });
  const sent = [], decoder = createProducerFrameDecoder(value => sent.push(value)); f.writes.forEach(bytes => decoder.push(bytes)); decoder.finish();
  assert.deepEqual(sent.map(value => [value.type, value.sequence]), [['start', 0], ['response', 1]]);
  assert.equal(f.calls.filter(value => value === 'create').length, 1);
  await assert.rejects(f.process.send({ type: 'evaluate', payload: 'private code' }), { code: 'PRODUCER_SEND_REFUSED' });
  const accessor = { payload: {} }; Object.defineProperty(accessor, 'type', { enumerable: true, get() { assert.fail('Getter must not execute'); } });
  await assert.rejects(f.process.send(accessor), { code: 'PRODUCER_WIRE_INVALID' });
  await f.process.stop();
});

for (const changed of [message('request', 2), message('request', 1, {}, { attemptId: '00000000-0000-4000-8000-000000000002' }), message('start', 1)]) {
  test('foreign/reordered/wrong-direction peer message stops the owned attempt', async () => {
    const f = fixture(); await f.process.start(); f.callbacks.stdout(encodeProducerFrame(changed));
    await assert.rejects(f.process.completed(), { code: 'PRODUCER_WIRE_IDENTITY' }); await f.process.stop();
    assert.equal(f.process.snapshot.state, 'joined'); assert.equal(f.calls.filter(value => value === 'stop').length, 1);
  });
}

test('15-minute wall ceiling stops and joins the exact owned container', async () => {
  const f = fixture(); await f.process.start(); f.fire(PRODUCER_LIMITS.wallMilliseconds);
  await assert.rejects(f.process.completed(), { code: 'PRODUCER_WALL_LIMIT' }); await f.process.stop();
  assert.equal(f.process.snapshot.state, 'joined'); assert.equal(f.process.snapshot.faultCode, 'PRODUCER_WALL_LIMIT');
  assert.equal(f.calls.filter(value => value === 'stop').length, 1); assert.equal(f.timers.size, 0);
});

test('explicit stop never invents a successful completed result', async () => {
  const f = fixture(); await f.process.start(); await f.process.stop();
  await assert.rejects(f.process.completed(), { code: 'PRODUCER_CANCELLED' });
  assert.equal(f.process.snapshot.state, 'joined'); assert.equal(f.calls.includes('remove'), false);
});

test('stderr is counted and bounded without contents entering observations', async () => {
  const f = fixture(); await f.process.start();
  f.callbacks.stderr(Buffer.from('private credential contents')); f.callbacks.stderr(Buffer.alloc(PRODUCER_LIMITS.stderrBytes));
  await assert.rejects(f.process.completed(), { code: 'PRODUCER_STDERR_LIMIT' }); await f.process.stop();
  assert.equal(JSON.stringify(f.observations).includes('private credential'), false);
  assert.ok(f.process.snapshot.stderrBytes > PRODUCER_LIMITS.stderrBytes);
});

test('a failed wait quarantines rather than removing or releasing uncertain process ownership', async () => {
  const f = fixture(); await f.process.start(); f.exit.reject(new Error('Private Docker transport details.')); await flush();
  await assert.rejects(f.process.completed(), { code: 'PRODUCER_JOIN_UNKNOWN' });
  await assert.rejects(f.process.stop()); assert.equal(f.process.snapshot.state, 'quarantined');
  assert.equal(f.process.snapshot.faultCode, 'PRODUCER_WAIT_UNKNOWN');
  await assert.rejects(f.process.remove(), { code: 'PRODUCER_REMOVE_REFUSED' }); assert.equal(f.calls.includes('remove'), false);
});

test('unknown join deadline quarantines even after a stop acknowledgement', async () => {
  const f = fixture(); f.adapter.stop = async () => { f.calls.push('stop'); };
  await f.process.start(); const stopping = f.process.stop(); await flush(); f.fire(PRODUCER_LIMITS.joinMilliseconds);
  await assert.rejects(stopping, { code: 'PRODUCER_JOIN_UNKNOWN' });
  assert.equal(f.process.snapshot.state, 'quarantined'); assert.equal(f.calls.includes('remove'), false);
  assert.equal(f.process.snapshot.quarantineCode, 'PRODUCER_JOIN_UNKNOWN');
});

test('ownership drift refuses stop/removal instead of touching the now-unproven container', async () => {
  const f = fixture(); await f.process.start(); f.actual.Config.Labels['wfc.pathfinder.owner'] = '00000000-0000-4000-8000-000000000000';
  await assert.rejects(f.process.stop()); assert.equal(f.process.snapshot.state, 'quarantined');
  assert.equal(f.calls.includes('stop'), false); assert.equal(f.calls.includes('remove'), false);
});

test('done with a nonzero exit is not a PASS despite confirmed termination', async () => {
  const f = fixture(); await f.process.start(); f.callbacks.stdout(encodeProducerFrame(message('done', 1, { status: 'PASS' }))); f.finish(9);
  await assert.rejects(f.process.completed(), { code: 'PRODUCER_EXIT_FAILED' }); assert.equal(f.process.snapshot.state, 'joined');
});

test('a producer-reported error and a missing final result are refusals, not empty successful output', async () => {
  const f = fixture(); await f.process.start(); f.callbacks.stdout(encodeProducerFrame(message('error', 1, { code: 'MODEL_FAILED' })));
  await assert.rejects(f.process.completed(), { code: 'PRODUCER_REPORTED_FAILURE' }); await f.process.stop();
  const g = fixture(); await g.process.start(); g.finish(); await flush();
  await assert.rejects(g.process.completed(), { code: 'PRODUCER_EXITED_WITHOUT_RESULT' }); await g.process.stop();
});

test('sandbox proof requires namespace and BPF evidence rather than a successful Chrome launch', () => {
  assert.deepEqual(parseSandboxStatus('PID namespaces\tYes\nNetwork namespaces\tYes\nSeccomp-BPF sandbox\tYes\nSeccomp-BPF sandbox supports TSYNC\tYes'),
    { pidNamespaces: true, networkNamespaces: true, seccompBpf: true, seccompTsync: true });
  for (const text of ['PID namespaces No\nNetwork namespaces Yes\nSeccomp-BPF sandbox Yes', 'A browser launched.',
    'PID namespaces Yes\nNetwork namespaces Yes\nSeccomp-BPF sandbox Yes\nYou are not adequately sandboxed.']) {
    assert.throws(() => parseSandboxStatus(text), { code: 'PRODUCER_SANDBOX_NOT_QUALIFIED' });
  }
  for (const flag of ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu-sandbox', '--remote-debugging-port=9222']) {
    assert.throws(() => assertSafeBrowserArguments(['/ms-playwright/chrome', flag]), { code: 'PRODUCER_SANDBOX_DISABLED' });
  }
  assert.equal(assertSafeBrowserArguments(['/ms-playwright/chrome', '--remote-debugging-pipe']), true);
});
