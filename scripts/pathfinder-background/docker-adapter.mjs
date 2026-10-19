import http from 'node:http';
import { command, createDocker } from '../operations/docker.mjs';
import { assertProducerContainer, assertProducerProfile, PRODUCER_LIMITS } from './container-profile.mjs';

const ID = /^[a-f0-9]{64}$(?![\s\S])/;
export const DOCKER_PRODUCER_STREAM_LIMITS = Object.freeze({ frameBytes: 1024 * 1024, chunkBytes: 64 * 1024, headerBytes: 8 });
const error = code => Object.assign(new Error(code), { code });
const refuse = code => { throw error(code); };
const callbacksValid = callbacks => callbacks && ['stdout', 'stderr', 'closed'].every(key => typeof callbacks[key] === 'function');

/** Docker framing is independent of the producer's inner length-prefixed wire.
 * Only eight header bytes are buffered; payload is delivered in bounded pieces. */
export function createDockerStdioDemultiplexer(callbacks) {
  if (!callbacksValid(callbacks)) refuse('PRODUCER_ATTACH_CALLBACKS_INVALID');
  const header = Buffer.alloc(8); let headerBytes = 0, remaining = 0, stream = 0, failed = false;
  return {
    push(bytes) {
      if (failed) refuse('PRODUCER_DOCKER_STREAM_CLOSED');
      if (!Buffer.isBuffer(bytes) || bytes.length > DOCKER_PRODUCER_STREAM_LIMITS.frameBytes + 8) { failed = true; refuse('PRODUCER_DOCKER_STREAM_LIMIT'); }
      try {
        let offset = 0;
        while (offset < bytes.length) {
          if (!remaining) {
            const count = Math.min(8 - headerBytes, bytes.length - offset);
            bytes.copy(header, headerBytes, offset, offset + count); offset += count; headerBytes += count;
            if (headerBytes !== 8) continue;
            stream = header[0]; remaining = header.readUInt32BE(4); headerBytes = 0;
            if (![1, 2].includes(stream) || header[1] || header[2] || header[3]) refuse('PRODUCER_DOCKER_STREAM_INVALID');
            if (remaining > DOCKER_PRODUCER_STREAM_LIMITS.frameBytes) refuse('PRODUCER_DOCKER_STREAM_LIMIT');
            if (!remaining) continue;
          }
          const count = Math.min(remaining, bytes.length - offset, DOCKER_PRODUCER_STREAM_LIMITS.chunkBytes);
          const chunk = bytes.subarray(offset, offset + count); remaining -= count; offset += count;
          (stream === 1 ? callbacks.stdout : callbacks.stderr)(chunk);
        }
      } catch (cause) { failed = true; throw cause; }
    },
    finish() { if (failed || headerBytes || remaining) refuse('PRODUCER_DOCKER_STREAM_TRUNCATED'); },
  };
}

/** Pure socket framing/backpressure seam: the caller has already checked its
 * exact owned Docker 101 upgrade. This function opens no socket or listener. */
export function createDockerAttachChannel(socket, callbacks, head = Buffer.alloc(0)) {
  if (!callbacksValid(callbacks) || !socket || ['on', 'once', 'removeListener', 'write', 'destroy'].some(key => typeof socket[key] !== 'function'))
    refuse('PRODUCER_ATTACH_INVALID');
  const decoder = createDockerStdioDemultiplexer(callbacks);
  let closed = false, writing = false, pendingReject, closedResolve, faultCode = null;
  const closedPromise = new Promise(resolve => { closedResolve = resolve; });
  const finish = () => {
    if (closed) return; closed = true;
    pendingReject?.(error('PRODUCER_STDIN_OUTCOME_UNKNOWN'));
    try { decoder.finish(); } catch { faultCode ??= 'PRODUCER_DOCKER_STREAM_TRUNCATED'; }
    try { callbacks.closed(); } catch { /* Cleanup cannot be suppressed by an observer. */ }
    closedResolve();
  };
  const destroy = () => { finish(); socket.destroy(); };
  const receive = bytes => { if (closed) return; try { decoder.push(bytes); } catch { faultCode = 'PRODUCER_DOCKER_STREAM_INVALID'; destroy(); } };
  socket.on('data', receive); socket.on('error', () => { if (closed) return; faultCode ??= 'PRODUCER_ATTACH_CLOSED'; destroy(); }); socket.on('end', destroy); socket.on('close', finish);
  try { decoder.push(head); } catch { faultCode = 'PRODUCER_DOCKER_STREAM_INVALID'; destroy(); refuse(faultCode); }
  return {
    get closed() { return closed; },
    get faultCode() { return faultCode; },
    async write(bytes) {
      if (closed || socket.destroyed || !socket.writable) refuse('PRODUCER_ATTACH_CLOSED');
      if (writing) refuse('PRODUCER_STDIN_BUSY');
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > PRODUCER_LIMITS.frameBytes + 4) refuse('PRODUCER_STDIN_LIMIT');
      writing = true;
      try {
        await new Promise((resolve, reject) => {
          let settled = false, returned = false, written = false, drained = false;
          const done = cause => {
            if (settled) return; settled = true; clearTimeout(timer); socket.removeListener('drain', onDrain); pendingReject = undefined;
            if (cause) reject(cause); else resolve();
          };
          const complete = () => { if (returned && written && drained) done(); };
          const onDrain = () => { drained = true; complete(); };
          const timer = setTimeout(() => { done(error('PRODUCER_STDIN_OUTCOME_UNKNOWN')); destroy(); }, PRODUCER_LIMITS.controlMilliseconds);
          timer.unref?.(); pendingReject = done; socket.once('drain', onDrain);
          try {
            const accepted = socket.write(Buffer.from(bytes), cause => {
              if (cause) { done(error('PRODUCER_STDIN_OUTCOME_UNKNOWN')); destroy(); return; }
              written = true; complete();
            });
            returned = true; if (accepted) drained = true; complete();
          } catch { done(error('PRODUCER_STDIN_OUTCOME_UNKNOWN')); destroy(); }
        });
      } finally { writing = false; }
    },
    async close() { destroy(); await closedPromise; if (faultCode) refuse(faultCode); },
  };
}

/** Context data originates only from the existing local Docker CLI context. */
export function localDockerSocketPath(context) {
  if (typeof context !== 'string' || context.length > 4096 || /[\u0000-\u001f\u007f]/u.test(context)) refuse('PRODUCER_LOCAL_DOCKER_REQUIRED');
  const pipe = 'npipe:////./pipe/';
  if (context.startsWith(pipe) && /^[a-zA-Z0-9_.-]{1,200}$(?![\s\S])/.test(context.slice(pipe.length))) return '\\\\.\\pipe\\' + context.slice(pipe.length);
  if (context.startsWith('unix:///')) {
    const path = context.slice(7);
    if (path.length > 1 && !path.startsWith('//') && !/[\\]/u.test(path) && !path.split('/').includes('..')) return path;
  }
  return refuse('PRODUCER_LOCAL_DOCKER_REQUIRED');
}
async function bounded(operation, milliseconds, code) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(error(code)), milliseconds); timer.unref?.(); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function readContext() {
  const signal = AbortSignal.timeout(PRODUCER_LIMITS.controlMilliseconds);
  try {
    const bytes = await command(['context', 'inspect', '--format', '{{(index .Endpoints "docker").Host}}'], { maxBytes: 4096, signal });
    const context = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim(); localDockerSocketPath(context); return context;
  } catch { return refuse('PRODUCER_LOCAL_DOCKER_REQUIRED'); }
}

export function assertDockerProducerUpgrade(response) {
  if (response?.statusCode !== 101 || String(response.headers?.upgrade).toLowerCase() !== 'tcp' ||
    !String(response.headers?.connection).toLowerCase().split(',').map(value => value.trim()).includes('upgrade')) refuse('PRODUCER_ATTACH_UNKNOWN');
  return true;
}

async function attach(socketPath, id, callbacks) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => { if (settled) return; settled = true; request.destroy(); reject(error('PRODUCER_ATTACH_UNKNOWN')); };
    const request = http.request({ socketPath, method: 'POST', path: `/v1.47/containers/${id}/attach?stream=1&stdin=1&stdout=1&stderr=1`,
      headers: { Connection: 'Upgrade', Upgrade: 'tcp', 'Content-Length': 0 }, timeout: PRODUCER_LIMITS.controlMilliseconds });
    request.once('response', response => { response.destroy(); fail(); }); // A 200 stream is not proof of the required bidirectional hijack.
    request.once('upgrade', (response, socket, head) => {
      if (settled) { socket.destroy(); return; }
      try {
        assertDockerProducerUpgrade(response);
        request.setTimeout(0); const channel = createDockerAttachChannel(socket, callbacks, head);
        if (channel.closed) { fail(); return; } settled = true; resolve(channel);
      } catch { socket.destroy(); fail(); }
    });
    request.once('timeout', fail); request.once('error', fail); request.end();
  });
}

/** One factory-made immutable profile, one created container, one owned attach.
 * No argv, network, socket path, alternate ID, force flag or automatic cleanup is accepted. */
export async function createDockerProducerAdapter(profile) {
  assertProducerProfile(profile);
  const context = await readContext(), socketPath = localDockerSocketPath(context);
  const docker = await bounded(() => createDocker(), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_DOCKER_UNAVAILABLE');
  const currentContext = async () => { if (await readContext() !== context) refuse('PRODUCER_DOCKER_CONTEXT_CHANGED'); };
  await currentContext();
  let id = null, createAttempted = false, attachAttempted = false, started = false, waited = false, removed = false, channel;
  const own = supplied => { assertProducerProfile(profile); if (!ID.test(supplied ?? '') || supplied !== id || removed) refuse('PRODUCER_OWNERSHIP_LOST'); };
  async function inspectOwned(supplied) {
    own(supplied); await currentContext();
    const actual = await bounded(() => docker.inspect(id), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_INSPECT_UNKNOWN');
    if (actual?.Id !== id) refuse('PRODUCER_OWNERSHIP_LOST'); assertProducerContainer(profile, actual); return actual;
  }
  return {
    async create(name, config) {
      assertProducerProfile(profile);
      if (createAttempted || name !== profile.name || config !== profile.config || !Object.isFrozen(config)) refuse('PRODUCER_CREATE_REFUSED');
      createAttempted = true; await currentContext();
      const image = await bounded(() => docker.inspectImage(profile.image), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_IMAGE_UNKNOWN');
      if (image?.Id !== profile.image) refuse('PRODUCER_IMAGE_CHANGED');
      const created = await bounded(() => docker.create(profile.name, profile.config), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_CREATE_OUTCOME_UNKNOWN');
      if (!ID.test(created?.Id ?? '')) refuse('PRODUCER_CREATE_OUTCOME_UNKNOWN');
      id = created.Id; return { Id: id };
    },
    inspect: inspectOwned,
    async attach(supplied, callbacks) {
      const actual = await inspectOwned(supplied);
      if (attachAttempted || started || actual.State?.Running !== false || actual.State?.Pid !== 0 || !callbacksValid(callbacks)) refuse('PRODUCER_ATTACH_REFUSED');
      attachAttempted = true; channel = await attach(socketPath, id, callbacks);
    },
    async start(supplied) {
      const actual = await inspectOwned(supplied);
      if (started || !channel || channel.closed || actual.State?.Running !== false || actual.State?.Pid !== 0) refuse('PRODUCER_START_REFUSED');
      started = true; await bounded(() => docker.start(id), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_START_OUTCOME_UNKNOWN');
    },
    async writeStdin(supplied, bytes) { own(supplied); if (!started || !channel) refuse('PRODUCER_STDIN_REFUSED'); await channel.write(bytes); },
    async closeAttach(supplied) { own(supplied); if (channel) await channel.close(); },
    async stop(supplied, timeoutSeconds) {
      await inspectOwned(supplied); if (timeoutSeconds !== 5) refuse('PRODUCER_STOP_REFUSED');
      await bounded(() => docker.stop(id, 5), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_STOP_UNKNOWN');
    },
    async wait(supplied) {
      await inspectOwned(supplied); if (!started) refuse('PRODUCER_WAIT_REFUSED');
      const result = await docker.wait(id);
      if (!Number.isInteger(result?.StatusCode) || result.StatusCode < 0 || result.StatusCode > 255 || result.Error) refuse('PRODUCER_WAIT_UNKNOWN');
      waited = true; return { StatusCode: result.StatusCode };
    },
    async remove(supplied) {
      const actual = await inspectOwned(supplied);
      if (!waited || !channel?.closed || actual.State?.Running !== false || actual.State?.Pid !== 0 || actual.State?.Restarting || actual.State?.Paused) refuse('PRODUCER_REMOVE_REFUSED');
      await bounded(() => docker.remove(id), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_REMOVE_OUTCOME_UNKNOWN'); removed = true;
    },
  };
}
