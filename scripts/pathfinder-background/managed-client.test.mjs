import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProducerProfile } from './container-profile.mjs';
import { createProducerFrameDecoder, encodeProducerFrame, PRODUCER_WIRE_VERSION } from './producer-process.mjs';
import { openManagedClient } from './managed-client.mjs';

const id = n => `ef800000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const guard = promise => { void promise.catch(() => undefined); return promise; };

/** The adapter and broker are entirely in-memory. No Docker, listener, browser,
 * filesystem, HTTP request or subprocess is created by this fixture. */
function fixture() {
  const base = JSON.stringify({ defaultAction: 'SCMP_ACT_ERRNO', syscalls: [{ names: ['read', 'write'], action: 'SCMP_ACT_ALLOW' }] });
  const profile = createProducerProfile({ owner: id(1), project: 'wfc-pathfinder-local-abcdef123456', attemptId: id(2), image: 'sha256:' + 'a'.repeat(64), mode: 'run',
    defaultSeccompBytes: base, defaultSeccompSha256: createHash('sha256').update(base).digest('hex') });
  const identity = { instanceId: id(3), projectId: id(4), modelVersionId: id(5), loadId: id(6), sessionId: id(7) };
  const actual = { Id: 'b'.repeat(64), Name: '/' + profile.name, Image: profile.image, Config: structuredClone(profile.config), HostConfig: structuredClone(profile.config.HostConfig),
    Mounts: [], NetworkSettings: { Networks: { none: {} }, Ports: {} }, State: { Running: false, Pid: 0, Restarting: false, Paused: false } };
  const calls = [], writes = [], observations = [], exit = deferred(), controller = new AbortController();
  const flags = { holdInitialize: false, holdExchange: false, holdClose: false, wrongReplyIdentity: false, requestResource: false, stopStillRunning: false };
  let callbacks, sequence = 0, resourceEnvelope;
  const emit = (type, requestId = null, payload = {}) => callbacks.stdout(encodeProducerFrame({ schemaVersion: PRODUCER_WIRE_VERSION, attemptId: profile.attemptId, sequence: sequence++, type, requestId, payload }));
  const response = envelope => ({ ...envelope, ...(flags.wrongReplyIdentity ? { loadId: id(99) } : {}), type: 'PREPARATION_OBJECTS', payload: {
    schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: 'names', names: ['/B001'], rootObjectId: null, cursor: 0, matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1',
    indexedObjectCount: 1, propertyScan: null, objects: [], nextCursor: null, complete: true } });
  const exchangeReply = envelope => emit('response', envelope.requestId, { kind: 'exchange', envelope: response(envelope) });
  const decode = createProducerFrameDecoder(frame => {
    writes.push(frame);
    if (frame.type === 'start' && frame.payload.kind === 'initialize' && !flags.holdInitialize) {
      emit('response', frame.requestId, { kind: 'initialized', value: { schemaVersion: 'wfc.pf.producer-host-ready.v1', sdkVersion: '7.130.0', ...identity } });
    } else if (frame.type === 'start' && frame.payload.kind === 'exchange' && !flags.holdExchange) {
      if (flags.requestResource) {
        resourceEnvelope = frame.payload.envelope;
        emit('request', id(90), { kind: 'resource', method: 'HEAD', path: `/api/projects/${identity.projectId}/model-versions/${identity.modelVersionId}/producer-sessions/${identity.sessionId}/descriptor`, range: null, offset: 0, length: 49152 });
      } else exchangeReply(frame.payload.envelope);
    } else if (frame.type === 'response' && resourceEnvelope) {
      const envelope = resourceEnvelope; resourceEnvelope = undefined; exchangeReply(envelope);
    } else if (frame.type === 'close' && !flags.holdClose) { emit('done', null, { status: 'PASS' }); finish(); }
  });
  const adapter = {
    async create(name, config) { calls.push('create'); assert.equal(name, profile.name); assert.equal(config, profile.config); return { Id: actual.Id }; },
    async inspect(containerId) { calls.push('inspect'); assert.equal(containerId, actual.Id); return actual; },
    async attach(containerId, value) { calls.push('attach'); assert.equal(containerId, actual.Id); callbacks = value; },
    async start(containerId) { calls.push('start'); assert.equal(containerId, actual.Id); actual.State.Running = true; actual.State.Pid = 17; emit('ready'); },
    async wait(containerId) { calls.push('wait'); assert.equal(containerId, actual.Id); return exit.promise; },
    async writeStdin(containerId, bytes) { calls.push('write'); assert.equal(containerId, actual.Id); decode.push(bytes); },
    async stop(containerId, seconds) { calls.push('stop'); assert.equal(containerId, actual.Id); assert.equal(seconds, 5); finish(0, flags.stopStillRunning); },
    async closeAttach(containerId) { calls.push('close-attach'); assert.equal(containerId, actual.Id); callbacks.closed(); },
    async remove(containerId) { calls.push('remove'); assert.equal(containerId, actual.Id); assert.equal(actual.State.Running, false); assert.equal(actual.State.Pid, 0); },
  };
  function finish(code = 0, leaveRunning = false) { if (!leaveRunning) { actual.State.Running = false; actual.State.Pid = 0; } exit.resolve({ StatusCode: code }); }
  const broker = { async request(requestId, payload) { calls.push('resource'); assert.equal(requestId, id(90)); assert.equal(payload.kind, 'resource');
    return { status: 200, headers: { 'content-length': '0' }, totalBytes: 0, dataBase64: '', complete: true }; }, async dispose() { calls.push('dispose'); } };
  const { sessionId: _sessionId, ...binding } = identity;
  const command = (requestId = id(8)) => ({ channel: 'wfc-routings-viewer', protocolVersion: 1, ...binding, requestId, type: 'READ_PREPARATION_OBJECTS',
    payload: { schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: 'names', names: ['/B001'], rootObjectId: null, cursor: 0, limit: 128 } });
  const open = () => openManagedClient({ profile, identity, runtimeInventorySha256: 'c'.repeat(64), broker, signal: controller.signal, adapter, observe: value => observations.push(value) });
  return { profile, identity, actual, calls, writes, observations, flags, adapter, broker, controller, command, open, finish, emit };
}

test('client initializes a fixed helper, exchanges exact protected envelopes, then joins and removes once', { timeout: 2000 }, async () => {
  const f = fixture(), client = await f.open();
  assert.ok(f.calls.indexOf('attach') < f.calls.indexOf('start'));
  assert.deepEqual(f.writes[0].payload, { kind: 'initialize', identity: f.identity, runtimeInventorySha256: 'c'.repeat(64) });
  assert.deepEqual(await client.exchange(f.command()), { ...f.command(), type: 'PREPARATION_OBJECTS', payload: { schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: 'names', names: ['/B001'], rootObjectId: null,
    cursor: 0, matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', indexedObjectCount: 1, propertyScan: null, objects: [], nextCursor: null, complete: true } });
  const closed = await client.close(); assert.deepEqual(closed, { joined: true, removed: true, containerId: f.actual.Id });
  await client.close(); assert.equal(f.calls.filter(value => value === 'remove').length, 1);
  assert.ok(f.calls.indexOf('close-attach') < f.calls.indexOf('remove')); assert.ok(f.calls.indexOf('dispose') < f.calls.indexOf('remove'));
});

test('resource relay uses the private host broker without putting its capabilities in helper frames', { timeout: 2000 }, async () => {
  const f = fixture(); f.flags.requestResource = true; const privateCapability = 'private-capability-never-in-helper';
  const request = f.broker.request; f.broker.request = async (...args) => { assert.ok(privateCapability); return request(...args); };
  const client = await f.open(); await client.exchange(f.command()); await client.close();
  assert.equal(f.calls.filter(value => value === 'resource').length, 1);
  assert.equal(f.writes.filter(frame => frame.type === 'response').length, 1); assert.equal(JSON.stringify(f.writes).includes(privateCapability), false);
});

for (const field of ['projectId', 'modelVersionId', 'loadId', 'instanceId']) test(`client refuses another ${field} before writing any exchange`, { timeout: 2000 }, async () => {
  const f = fixture(), client = await f.open(), count = f.writes.length;
  await assert.rejects(client.exchange({ ...f.command(), [field]: id(99) }), { code: 'PRODUCER_COMMAND_REFUSED' });
  assert.equal(f.writes.length, count); await client.close();
});

test('client refuses unsupported commands and exact request ID replay', { timeout: 2000 }, async () => {
  const f = fixture(), client = await f.open();
  await assert.rejects(client.exchange({ ...f.command(), type: 'EVALUATE', payload: {} }), { code: 'PRODUCER_COMMAND_REFUSED' });
  await client.exchange(f.command()); const count = f.writes.length;
  await assert.rejects(client.exchange(f.command()), { code: 'PRODUCER_COMMAND_REPLAY' }); assert.equal(f.writes.length, count); await client.close();
});

test('initialization cancellation rejects immediately and cleans only the confirmed owned join', { timeout: 2000 }, async () => {
  const f = fixture(); f.flags.holdInitialize = true; const opening = guard(f.open()); await flush();
  assert.equal(f.writes[0]?.payload.kind, 'initialize'); f.controller.abort();
  await assert.rejects(opening, { code: 'PRODUCER_CLIENT_CANCELLED' }); assert.equal(f.calls.filter(value => value === 'remove').length, 1);
});

test('pending exchange cancellation is promptly rejected instead of waiting for a command timeout', { timeout: 2000 }, async () => {
  const f = fixture(), client = await f.open(); f.flags.holdExchange = true;
  const exchanging = guard(client.exchange(f.command())); await flush(); f.controller.abort();
  await assert.rejects(exchanging, { code: 'PRODUCER_CLIENT_CANCELLED' }); await flush();
  await client.close(); assert.equal(f.calls.filter(value => value === 'remove').length, 1);
});

test('a mismatched response identity faults the process and promptly rejects pending data', { timeout: 2000 }, async () => {
  const f = fixture(), client = await f.open(); f.flags.wrongReplyIdentity = true;
  await assert.rejects(client.exchange(f.command()), { code: 'PRODUCER_RESPONSE_IDENTITY' }); await flush();
  await client.close(); assert.equal(f.calls.filter(value => value === 'remove').length, 1);
});

test('an early helper exit promptly rejects pending data and retains truthful process failure', { timeout: 2000 }, async () => {
  const f = fixture(), client = await f.open(); f.flags.holdExchange = true;
  const exchanging = guard(client.exchange(f.command())); await flush(); f.finish();
  await assert.rejects(exchanging, { code: 'PRODUCER_EXITED_WITHOUT_RESULT' }); await flush();
  await client.close(); assert.equal(client.snapshot.faultCode, 'PRODUCER_EXITED_WITHOUT_RESULT'); assert.equal(f.calls.filter(value => value === 'remove').length, 1);
});

test('cancellation while close awaits completion still removes a positively confirmed join', { timeout: 2000 }, async () => {
  const f = fixture(), client = await f.open(); f.flags.holdClose = true;
  const closing = guard(client.close()); await flush(); assert.equal(f.writes.at(-1).type, 'close'); f.controller.abort();
  let failure; try { await closing; assert.fail('Expected the original close failure'); } catch (error) { failure = error; }
  assert.equal(failure.code, 'PRODUCER_CANCELLED'); assert.deepEqual(failure.joinProof, { joined: true, removed: true, containerId: f.actual.Id });
  assert.equal(Object.getOwnPropertyDescriptor(failure, 'joinProof')?.enumerable, false); assert.equal(JSON.stringify(failure).includes(f.actual.Id), false);
  assert.equal(client.snapshot.state, 'joined'); assert.equal(client.snapshot.removed, true); assert.equal(f.calls.filter(value => value === 'remove').length, 1);
});

test('an unproven stop is quarantined and is never removed', { timeout: 2000 }, async () => {
  const f = fixture(), client = await f.open(); f.flags.holdClose = true; f.flags.stopStillRunning = true;
  const closing = guard(client.close()); await flush(); f.controller.abort();
  await assert.rejects(closing, { code: 'PRODUCER_JOIN_UNKNOWN' }); assert.equal(client.snapshot.state, 'quarantined'); assert.equal(f.calls.includes('remove'), false);
});
