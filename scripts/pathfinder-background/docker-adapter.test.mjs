import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { assertDockerProducerUpgrade, createDockerAttachChannel, createDockerStdioDemultiplexer, DOCKER_PRODUCER_STREAM_LIMITS, localDockerSocketPath } from './docker-adapter.mjs';

const frame = (type, body = Buffer.alloc(0)) => {
  const header = Buffer.alloc(8); header[0] = type; header.writeUInt32BE(body.length, 4); return Buffer.concat([header, body]);
};
function callbacks() {
  const stdout = [], stderr = []; let closes = 0;
  return { stdout, stderr, get closes() { return closes; }, callbacks: {
    stdout: bytes => stdout.push(Buffer.from(bytes)), stderr: bytes => stderr.push(Buffer.from(bytes)), closed: () => { closes++; },
  } };
}
/** In-memory event socket only. No listener, network, process or Docker command is opened. */
class FakeSocket extends EventEmitter {
  writable = true; destroyed = false; writes = []; callback = null; backpressure = false; writeError = null;
  write(bytes, callback) {
    if (this.writeError) throw this.writeError;
    this.writes.push(Buffer.from(bytes)); this.callback = callback; return !this.backpressure;
  }
  flush(cause) { const callback = this.callback; this.callback = null; callback?.(cause); }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.writable = false; this.emit('close'); } return this; }
}

test('only an explicit 101 bidirectional TCP upgrade passes the native attach handshake', () => {
  assert.equal(assertDockerProducerUpgrade({ statusCode: 101, headers: { upgrade: 'tcp', connection: 'Upgrade' } }), true);
  assert.equal(assertDockerProducerUpgrade({ statusCode: 101, headers: { upgrade: 'TCP', connection: 'keep-alive, Upgrade' } }), true);
});
for (const response of [
  { statusCode: 200, headers: { upgrade: 'tcp', connection: 'Upgrade' } },
  { statusCode: 403, headers: {} }, { statusCode: 500, headers: {} },
  { statusCode: 101, headers: {} }, { statusCode: 101, headers: { upgrade: 'websocket', connection: 'Upgrade' } },
  { statusCode: 101, headers: { upgrade: 'tcp', connection: 'close' } },
]) test(`refuses an unproved Docker attach handshake ${JSON.stringify(response)}`, () => {
  assert.throws(() => assertDockerProducerUpgrade(response), { code: 'PRODUCER_ATTACH_UNKNOWN' });
});

test('Docker multiplexing preserves fragmented and interleaved stdout/stderr without exposing headers', () => {
  const f = callbacks(), decoder = createDockerStdioDemultiplexer(f.callbacks);
  const bytes = Buffer.concat([frame(1, Buffer.from('first')), frame(2, Buffer.from('warning')), frame(1), frame(2), frame(1, Buffer.from('last'))]);
  for (let offset = 0; offset < bytes.length; offset += 3) decoder.push(bytes.subarray(offset, offset + 3));
  decoder.finish(); assert.equal(Buffer.concat(f.stdout).toString(), 'firstlast'); assert.equal(Buffer.concat(f.stderr).toString(), 'warning');
});

test('the largest Docker frame is delivered only in chunks at or below 64 KiB', () => {
  const f = callbacks(), decoder = createDockerStdioDemultiplexer(f.callbacks), body = Buffer.alloc(DOCKER_PRODUCER_STREAM_LIMITS.frameBytes, 41);
  decoder.push(frame(1, body)); decoder.finish(); assert.deepEqual(Buffer.concat(f.stdout), body);
  assert.equal(f.stdout.length, 16); assert.ok(f.stdout.every(chunk => chunk.length <= 64 * 1024));
});

for (const type of [0, 3, 255]) test(`Docker stream type ${type} is refused before payload delivery`, () => {
  const f = callbacks(), decoder = createDockerStdioDemultiplexer(f.callbacks);
  assert.throws(() => decoder.push(frame(type, Buffer.from('untrusted'))), { code: 'PRODUCER_DOCKER_STREAM_INVALID' });
  assert.equal(f.stdout.length + f.stderr.length, 0); assert.throws(() => decoder.push(frame(1)), { code: 'PRODUCER_DOCKER_STREAM_CLOSED' });
});

for (const index of [1, 2, 3]) test(`nonzero Docker header padding byte ${index} is refused`, () => {
  const bytes = frame(1); bytes[index] = 1; const decoder = createDockerStdioDemultiplexer(callbacks().callbacks);
  assert.throws(() => decoder.push(bytes), { code: 'PRODUCER_DOCKER_STREAM_INVALID' });
});

test('an oversized advertised frame is refused from its header without allocating a body', () => {
  const bytes = frame(1); bytes.writeUInt32BE(DOCKER_PRODUCER_STREAM_LIMITS.frameBytes + 1, 4);
  assert.throws(() => createDockerStdioDemultiplexer(callbacks().callbacks).push(bytes), { code: 'PRODUCER_DOCKER_STREAM_LIMIT' });
});

test('aggregate input and non-Buffer inputs have an independent bound', () => {
  for (const input of ['raw log text', Buffer.alloc(DOCKER_PRODUCER_STREAM_LIMITS.frameBytes + 9)])
    assert.throws(() => createDockerStdioDemultiplexer(callbacks().callbacks).push(input), { code: 'PRODUCER_DOCKER_STREAM_LIMIT' });
});

test('partial headers and partial payloads cannot be declared a clean stream end', () => {
  for (const input of [frame(1).subarray(0, 7), frame(1, Buffer.from('payload')).subarray(0, 10)]) {
    const decoder = createDockerStdioDemultiplexer(callbacks().callbacks); decoder.push(input);
    assert.throws(() => decoder.finish(), { code: 'PRODUCER_DOCKER_STREAM_TRUNCATED' });
  }
});

test('an owned upgraded channel processes its initial head and reports closure exactly once', async () => {
  const f = callbacks(), socket = new FakeSocket(), channel = createDockerAttachChannel(socket, f.callbacks, frame(1, Buffer.from('head')));
  socket.emit('data', frame(2, Buffer.from('stderr'))); socket.emit('end'); socket.emit('close'); socket.emit('error', new Error('synthetic private text'));
  await channel.close(); assert.equal(f.closes, 1); assert.equal(Buffer.concat(f.stdout).toString(), 'head'); assert.equal(Buffer.concat(f.stderr).toString(), 'stderr');
  assert.equal(channel.closed, true); assert.equal(channel.faultCode, null);
});

test('outer framing faults stay observable after inner output was already delivered', async () => {
  const f = callbacks(), socket = new FakeSocket(), channel = createDockerAttachChannel(socket, f.callbacks);
  socket.emit('data', frame(1, Buffer.from('a complete inner result'))); socket.emit('data', frame(3));
  assert.equal(channel.closed, true); assert.equal(f.closes, 1);
  await assert.rejects(channel.close(), { code: 'PRODUCER_DOCKER_STREAM_INVALID' });
  socket.emit('data', frame(1, Buffer.from('late'))); assert.equal(Buffer.concat(f.stdout).toString(), 'a complete inner result');
});

test('an incomplete outer header remains a close fault instead of a successful join', async () => {
  const f = callbacks(), socket = new FakeSocket(), channel = createDockerAttachChannel(socket, f.callbacks);
  socket.emit('data', frame(1).subarray(0, 2)); socket.emit('close');
  await assert.rejects(channel.close(), { code: 'PRODUCER_DOCKER_STREAM_TRUNCATED' }); assert.equal(f.closes, 1);
});

test('stdin waits for both the write callback and backpressure drain', async () => {
  const f = callbacks(), socket = new FakeSocket(); socket.backpressure = true;
  const channel = createDockerAttachChannel(socket, f.callbacks); let completed = false;
  const input = Buffer.from('framed input'), written = channel.write(input).then(() => { completed = true; });
  input.fill(0); socket.flush(); await Promise.resolve(); assert.equal(completed, false); assert.equal(socket.writes[0].toString(), 'framed input');
  socket.emit('drain'); await written; assert.equal(completed, true); await channel.close();
});

test('drain before the write callback cannot falsely acknowledge stdin completion', async () => {
  const socket = new FakeSocket(); socket.backpressure = true; const channel = createDockerAttachChannel(socket, callbacks().callbacks);
  let completed = false; const written = channel.write(Buffer.from('input')).then(() => { completed = true; });
  socket.emit('drain'); await Promise.resolve(); assert.equal(completed, false); socket.flush(); await written; await channel.close();
});

test('a writable socket still needs its successful write callback, and concurrent writes are refused', async () => {
  const socket = new FakeSocket(), channel = createDockerAttachChannel(socket, callbacks().callbacks);
  let completed = false; const written = channel.write(Buffer.from('input')).then(() => { completed = true; });
  await Promise.resolve(); assert.equal(completed, false); await assert.rejects(channel.write(Buffer.from('parallel')), { code: 'PRODUCER_STDIN_BUSY' });
  socket.flush(); await written; await channel.close();
});

test('stdin failure is sanitized and closes only this in-memory attach channel', async () => {
  const f = callbacks(), socket = new FakeSocket(), channel = createDockerAttachChannel(socket, f.callbacks);
  const written = channel.write(Buffer.from('input')); socket.flush(new Error('synthetic secret must not escape'));
  await assert.rejects(written, cause => cause.code === 'PRODUCER_STDIN_OUTCOME_UNKNOWN' && !cause.message.includes('secret'));
  assert.equal(socket.destroyed, true); assert.equal(f.closes, 1);
});

test('stdin drain is bounded by the controller five-second control budget', async t => {
  const timers = new Map();
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds) => { const handle = { unref() {} }; timers.set(handle, { callback, milliseconds }); return handle; });
  t.mock.method(globalThis, 'clearTimeout', handle => timers.delete(handle));
  const f = callbacks(), socket = new FakeSocket(); socket.backpressure = true;
  const channel = createDockerAttachChannel(socket, f.callbacks), written = channel.write(Buffer.from('input'));
  assert.equal(timers.size, 1); const [{ callback, milliseconds }] = [...timers.values()]; assert.equal(milliseconds, 5000); callback();
  await assert.rejects(written, { code: 'PRODUCER_STDIN_OUTCOME_UNKNOWN' }); assert.equal(socket.destroyed, true); assert.equal(f.closes, 1); assert.equal(timers.size, 0);
});

test('closing an owned socket rejects an outstanding drain without leaving a live writer', async () => {
  const f = callbacks(), socket = new FakeSocket(); socket.backpressure = true;
  const channel = createDockerAttachChannel(socket, f.callbacks), written = channel.write(Buffer.from('input'));
  await channel.close(); await assert.rejects(written, { code: 'PRODUCER_STDIN_OUTCOME_UNKNOWN' }); assert.equal(f.closes, 1);
  await assert.rejects(channel.write(Buffer.from('late')), { code: 'PRODUCER_ATTACH_CLOSED' });
});

test('stdin bytes are bounded and cannot become an unbounded transport queue', async () => {
  const socket = new FakeSocket(), channel = createDockerAttachChannel(socket, callbacks().callbacks);
  for (const input of [Buffer.alloc(0), Buffer.alloc(96 * 1024 + 5), 'raw']) await assert.rejects(channel.write(input), { code: 'PRODUCER_STDIN_LIMIT' });
  assert.equal(socket.writes.length, 0); await channel.close();
});

test('only local Unix sockets and the local Windows named-pipe form are accepted', () => {
  assert.equal(localDockerSocketPath('unix:///var/run/docker.sock'), '/var/run/docker.sock');
  assert.equal(localDockerSocketPath('unix:///run/user/1000/docker.sock'), '/run/user/1000/docker.sock');
  assert.equal(localDockerSocketPath('npipe:////./pipe/dockerDesktopLinuxEngine'), '\\\\.\\pipe\\dockerDesktopLinuxEngine');
});

for (const context of ['tcp://localhost:2375', 'ssh://host/docker', 'http://127.0.0.1:2375', 'unix://relative', 'unix:////remote/docker',
  'unix:///tmp/../docker.sock', 'npipe:////remote/pipe/docker', 'npipe:////./pipe/../remote', 'npipe:////./pipe/docker\n', '']) {
  test(`refuses an unapproved Docker endpoint form ${JSON.stringify(context)}`, () => {
    assert.throws(() => localDockerSocketPath(context), { code: 'PRODUCER_LOCAL_DOCKER_REQUIRED' });
  });
}
