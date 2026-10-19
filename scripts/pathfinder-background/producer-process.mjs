import { assertProducerContainer, assertProducerProfile, PRODUCER_LIMITS } from './container-profile.mjs';

export const PRODUCER_WIRE_VERSION = 'wfc.pf.producer-wire.v1';
const TYPES = new Set(['ready', 'start', 'request', 'response', 'progress', 'done', 'error', 'cancel', 'close']);
const INBOUND = new Set(['ready', 'request', 'response', 'progress', 'done', 'error']);
const OUTBOUND = new Set(['start', 'response', 'cancel', 'close']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$(?![\s\S])/;
const ID = /^[a-f0-9]{64}$(?![\s\S])/;
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const failure = code => Object.assign(new Error(code), { code });
const safeCode = (error, fallback) => typeof error?.code === 'string' && /^PRODUCER_[A-Z0-9_]{1,95}$/.test(error.code) ? error.code : fallback;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
};

function safeJson(value, depth = 0, seen = new Set(), budget = { nodes: 0, bytes: 0 }) {
  if (++budget.nodes > 8192) throw failure('PRODUCER_WIRE_LIMIT');
  if (depth > 32) throw failure('PRODUCER_WIRE_INVALID');
  if (typeof value === 'string') {
    budget.bytes += Buffer.byteLength(value);
    if (budget.bytes > PRODUCER_LIMITS.frameBytes) throw failure('PRODUCER_WIRE_LIMIT');
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if ((!plain(value) && !Array.isArray(value)) || seen.has(value)) throw failure('PRODUCER_WIRE_INVALID');
  seen.add(value);
  if (Object.keys(value).length > 4096) throw failure('PRODUCER_WIRE_INVALID');
  for (const key of Object.keys(value)) {
    if (key.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw failure('PRODUCER_WIRE_INVALID');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) throw failure('PRODUCER_WIRE_INVALID');
    budget.bytes += Buffer.byteLength(key);
    if (budget.bytes > PRODUCER_LIMITS.frameBytes) throw failure('PRODUCER_WIRE_LIMIT');
    safeJson(descriptor.value, depth + 1, seen, budget);
  }
  seen.delete(value);
}

export function validateProducerMessage(value) {
  const fields = ['schemaVersion', 'attemptId', 'sequence', 'type', 'requestId', 'payload'];
  if (!plain(value) || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) throw failure('PRODUCER_WIRE_INVALID');
  safeJson(value);
  if (value.schemaVersion !== PRODUCER_WIRE_VERSION || !UUID.test(value.attemptId ?? '') ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !TYPES.has(value.type) ||
      !(value.requestId === null || UUID.test(value.requestId))) throw failure('PRODUCER_WIRE_INVALID');
  return value;
}

/** Four-byte BE length plus strict UTF-8 JSON. Payload-specific capability/path
 * validation belongs to the broker; this transport exposes no shell or eval API. */
export function encodeProducerFrame(message) {
  validateProducerMessage(message);
  const body = Buffer.from(JSON.stringify(message));
  if (!body.length || body.length > PRODUCER_LIMITS.frameBytes) throw failure('PRODUCER_WIRE_LIMIT');
  const header = Buffer.alloc(4); header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

export function createProducerFrameDecoder(onMessage) {
  let header = Buffer.alloc(4), headerBytes = 0, body, bodyBytes = 0, failed = false;
  return {
    push(raw) {
      if (failed) throw failure('PRODUCER_WIRE_CLOSED');
      if (!Buffer.isBuffer(raw) || raw.length > PRODUCER_LIMITS.frameBytes * 2 + 8) { failed = true; throw failure('PRODUCER_WIRE_LIMIT'); }
      try {
        let offset = 0;
        while (offset < raw.length) {
          if (!body) {
            const count = Math.min(4 - headerBytes, raw.length - offset);
            raw.copy(header, headerBytes, offset, offset + count); headerBytes += count; offset += count;
            if (headerBytes !== 4) continue;
            const bytes = header.readUInt32BE();
            if (!bytes || bytes > PRODUCER_LIMITS.frameBytes) throw failure('PRODUCER_WIRE_LIMIT');
            body = Buffer.alloc(bytes); bodyBytes = 0;
          }
          const count = Math.min(body.length - bodyBytes, raw.length - offset);
          raw.copy(body, bodyBytes, offset, offset + count); bodyBytes += count; offset += count;
          if (bodyBytes !== body.length) continue;
          let message;
          try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
          catch { throw failure('PRODUCER_WIRE_INVALID'); }
          header = Buffer.alloc(4); headerBytes = 0; body = undefined; bodyBytes = 0;
          onMessage(validateProducerMessage(message));
        }
      } catch (error) { failed = true; throw error; }
    },
    finish() {
      if (failed || headerBytes || body) throw failure('PRODUCER_WIRE_TRUNCATED');
    },
  };
}

/** @typedef {{stdout:(bytes:Buffer)=>void,stderr:(bytes:Buffer)=>void,closed:()=>void}} AttachCallbacks */
/** @typedef {{
 * create:(name:string,config:object)=>Promise<{Id:string}>,
 * start:(id:string)=>Promise<void>,
 * attach:(id:string,callbacks:AttachCallbacks)=>Promise<void>,
 * writeStdin:(id:string,bytes:Buffer)=>Promise<void>,
 * closeAttach:(id:string)=>Promise<void>,
 * stop:(id:string,timeoutSeconds:number)=>Promise<void>,
 * wait:(id:string)=>Promise<{StatusCode:number}>,
 * inspect:(id:string)=>Promise<object>,
 * remove:(id:string)=>Promise<void>
 * }} ProducerDockerAdapter */

/** One factory-made profile owns one fresh container and framed stdio session.
 * Adapter callbacks MUST provide Docker-demultiplexed bytes, never docker logs.
 * Observations contain identities/counts/codes only, never frame/stderr contents.
 * @param {ProducerDockerAdapter} adapter
 */
export function createProducerProcess(adapter, profile, options = {}) {
  assertProducerProfile(profile);
  for (const name of ['create', 'start', 'attach', 'writeStdin', 'closeAttach', 'stop', 'wait', 'inspect', 'remove']) {
    if (typeof adapter?.[name] !== 'function') throw failure('PRODUCER_ADAPTER_REQUIRED');
  }
  const setTimer = options.setTimer ?? setTimeout, clearTimer = options.clearTimer ?? clearTimeout;
  const ready = deferred(), terminal = deferred();
  let state = 'idle', id = null, outgoing = 0, incoming = 0, readySeen = false, terminalSeen = false;
  let stderrBytes = 0, faultCode = null, quarantineCode = null, exit, exitResult, wallTimer, stopping, startPromise, writer = Promise.resolve();
  let pumping = false, queue = [], terminalMessage, removed = false;
  const snapshot = () => Object.freeze({ state, containerId: id, name: profile.name, image: profile.image,
    owner: profile.owner, project: profile.project, attemptId: profile.attemptId, faultCode, quarantineCode,
    exitCode: exitResult?.StatusCode ?? null, stderrBytes, removed });
  const note = type => { try { options.observe?.({ type, ...snapshot() }); } catch { /* Observation cannot authorize cleanup or suppress a quarantine. */ } };
  async function bounded(operation, milliseconds, code) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimer(() => reject(failure(code)), milliseconds); timer?.unref?.();
    })]); } finally { if (timer !== undefined) clearTimer(timer); }
  }
  function fault(code) {
    faultCode ??= code; ready.reject(failure(faultCode)); terminal.reject(failure(faultCode)); note('fault');
    if (id && !['joined', 'quarantined'].includes(state)) void stop().catch(() => undefined);
  }
  async function pump() {
    if (pumping) return; pumping = true;
    try {
      while (queue.length && !faultCode) {
        const message = queue.shift();
        await options.onMessage?.(message);
        if (message.type === 'done') terminal.resolve(message);
        if (message.type === 'error') fault(safeCode(message.payload,'PRODUCER_REPORTED_FAILURE'));
      }
    } catch (error) { fault(safeCode(error,'PRODUCER_CONSUMER_FAILED')); }
    finally { pumping = false; }
  }
  const decoder = createProducerFrameDecoder(message => {
    if (message.attemptId !== profile.attemptId || message.sequence !== incoming++ || !INBOUND.has(message.type) || terminalSeen) throw failure('PRODUCER_WIRE_IDENTITY');
    if (message.type === 'ready') {
      if (readySeen || state !== 'starting') throw failure('PRODUCER_WIRE_STATE');
      readySeen = true; ready.resolve(message);
    } else if (!readySeen) throw failure('PRODUCER_WIRE_STATE');
    if (message.type === 'done' || message.type === 'error') { terminalSeen = true; terminalMessage = message; }
    if (queue.length >= PRODUCER_LIMITS.queuedMessages) throw failure('PRODUCER_OUTPUT_QUEUE_LIMIT');
    queue.push(message); void pump();
  });
  const callbacks = {
    stdout(bytes) {
      if (['joined', 'quarantined'].includes(state)) return;
      try { decoder.push(bytes); } catch (error) { fault(safeCode(error, 'PRODUCER_WIRE_INVALID')); }
    },
    stderr(bytes) {
      if (['joined', 'quarantined'].includes(state)) return;
      if (!Buffer.isBuffer(bytes)) { fault('PRODUCER_STDERR_INVALID'); return; }
      stderrBytes += bytes.length;
      if (stderrBytes > PRODUCER_LIMITS.stderrBytes) fault('PRODUCER_STDERR_LIMIT');
    },
    closed() {
      try { decoder.finish(); } catch { fault('PRODUCER_WIRE_TRUNCATED'); return; }
      if (!terminalSeen && !['stopping', 'joined', 'quarantined'].includes(state)) fault('PRODUCER_TRANSPORT_CLOSED');
    },
  };
  async function inspectOwned() {
    const actual = await bounded(() => adapter.inspect(id), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_INSPECT_UNKNOWN');
    assertProducerContainer(profile, actual); return actual;
  }
  async function join() {
    if (state === 'joined') return snapshot();
    if (state === 'quarantined') throw failure(quarantineCode ?? faultCode ?? 'PRODUCER_JOIN_UNKNOWN');
    try {
      if (!exit) throw failure('PRODUCER_JOIN_UNKNOWN');
      exitResult = await bounded(() => exit, PRODUCER_LIMITS.joinMilliseconds, 'PRODUCER_JOIN_UNKNOWN');
      if (!Number.isInteger(exitResult?.StatusCode)) throw failure('PRODUCER_JOIN_UNKNOWN');
      const actual = await inspectOwned();
      if (actual.State?.Running !== false || actual.State?.Pid !== 0 || actual.State?.Restarting || actual.State?.Paused) throw failure('PRODUCER_JOIN_UNKNOWN');
      state = 'joined'; if (wallTimer !== undefined) clearTimer(wallTimer); options.signal?.removeEventListener('abort', aborted);
      await bounded(() => adapter.closeAttach(id), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_ATTACH_CLOSE_UNKNOWN');
      note('joined'); return snapshot();
    } catch (error) {
      state = 'quarantined'; quarantineCode = safeCode(error, 'PRODUCER_JOIN_UNKNOWN'); faultCode ??= quarantineCode;
      if (wallTimer !== undefined) clearTimer(wallTimer); ready.reject(failure(faultCode)); terminal.reject(failure(faultCode)); note('quarantined');
      throw failure(quarantineCode);
    }
  }
  async function stop() {
    if (stopping) return stopping;
    if (state === 'joined') return snapshot();
    if (state === 'quarantined') throw failure(quarantineCode ?? faultCode ?? 'PRODUCER_JOIN_UNKNOWN');
    if (!terminalSeen) {
      faultCode ??= 'PRODUCER_CANCELLED'; ready.reject(failure(faultCode)); terminal.reject(failure(faultCode));
    }
    if (!id) { state = 'joined'; return snapshot(); }
    stopping = (async () => {
      try {
        await inspectOwned(); state = 'stopping';
        // A refused stop can mean the process already exited. Only wait+inspect
        // may establish the join; a failed stop is never itself success.
        await bounded(() => adapter.stop(id, 5), PRODUCER_LIMITS.controlMilliseconds + 1000, 'PRODUCER_STOP_UNKNOWN').catch(() => undefined);
        return await join();
      } catch (error) {
        state = 'quarantined'; quarantineCode ??= safeCode(error, 'PRODUCER_JOIN_UNKNOWN'); faultCode ??= quarantineCode;
        if (wallTimer !== undefined) clearTimer(wallTimer); terminal.reject(failure(quarantineCode)); note('quarantined'); throw failure(quarantineCode);
      }
    })();
    return stopping;
  }
  const aborted = () => fault('PRODUCER_CANCELLED');
  return {
    get snapshot() { return snapshot(); },
    start() {
      if (startPromise) return startPromise;
      if (state !== 'idle') return Promise.reject(failure('PRODUCER_ALREADY_STARTED'));
      startPromise = (async () => {
        options.signal?.throwIfAborted(); state = 'creating';
        try {
          const created = await bounded(() => adapter.create(profile.name, profile.config), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_CREATE_OUTCOME_UNKNOWN');
          if (!ID.test(created?.Id ?? '')) throw failure('PRODUCER_CREATE_OUTCOME_UNKNOWN');
          id = created.Id;
          const before = await inspectOwned();
          if (before.State?.Running !== false || before.State?.Pid !== 0) throw failure('PRODUCER_FRESH_CONTAINER_REQUIRED');
          state = 'starting'; options.signal?.addEventListener('abort', aborted, { once: true }); options.signal?.throwIfAborted();
          await bounded(() => adapter.attach(id, callbacks), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_ATTACH_UNKNOWN');
          await bounded(() => adapter.start(id), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_START_OUTCOME_UNKNOWN');
          exit = Promise.resolve().then(() => adapter.wait(id));
          void exit.then(result => {
            exitResult = result;
            if (!terminalSeen && !['stopping', 'joined', 'quarantined'].includes(state)) fault('PRODUCER_EXITED_WITHOUT_RESULT');
          }, () => fault('PRODUCER_WAIT_UNKNOWN'));
          wallTimer = setTimer(() => fault('PRODUCER_WALL_LIMIT'), PRODUCER_LIMITS.wallMilliseconds); wallTimer?.unref?.();
          await bounded(() => ready.promise, PRODUCER_LIMITS.startupMilliseconds, 'PRODUCER_READY_DEADLINE');
          if (faultCode) throw failure(faultCode);
          state = 'running'; await inspectOwned(); note('ready'); return snapshot();
        } catch (error) {
          faultCode ??= safeCode(error, 'PRODUCER_START_FAILED');
          ready.reject(failure(faultCode)); terminal.reject(failure(faultCode));
          if (!id || !exit) { state = 'quarantined'; quarantineCode = faultCode; note('quarantined'); }
          else await stop().catch(() => undefined);
          throw failure(faultCode);
        }
      })();
      return startPromise;
    },
    async send(input) {
      if (state !== 'running' || faultCode || terminalSeen || !plain(input) ||
          Object.keys(input).some(key => !['type', 'requestId', 'payload'].includes(key))) throw failure('PRODUCER_SEND_REFUSED');
      safeJson(input);
      if (!OUTBOUND.has(input.type)) throw failure('PRODUCER_SEND_REFUSED');
      const frame = encodeProducerFrame({ schemaVersion: PRODUCER_WIRE_VERSION, attemptId: profile.attemptId,
        sequence: outgoing, type: input.type, requestId: input.requestId ?? null, payload: input.payload });
      outgoing++;
      writer = writer.then(() => bounded(() => adapter.writeStdin(id, frame), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_STDIN_OUTCOME_UNKNOWN'));
      try { await writer; } catch {
        fault('PRODUCER_STDIN_OUTCOME_UNKNOWN'); await stop().catch(() => undefined);
        throw failure(quarantineCode ?? 'PRODUCER_STDIN_OUTCOME_UNKNOWN');
      }
    },
    async completed() {
      try { await terminal.promise; }
      catch (error) {
        if (id && !['joined', 'quarantined'].includes(state)) await stop().catch(() => undefined);
        throw failure(quarantineCode ?? safeCode(error, 'PRODUCER_FAILED'));
      }
      const value = await join();
      if (faultCode || value.exitCode !== 0 || terminalMessage?.type !== 'done') throw failure(faultCode ?? 'PRODUCER_EXIT_FAILED');
      return { process: value, message: terminalMessage };
    },
    stop,
    async remove() {
      if (removed) return snapshot();
      if (state !== 'joined' || !id) throw failure('PRODUCER_REMOVE_REFUSED');
      const actual = await inspectOwned();
      if (actual.State?.Running !== false || actual.State?.Pid !== 0) throw failure('PRODUCER_REMOVE_REFUSED');
      await bounded(() => adapter.remove(id), PRODUCER_LIMITS.controlMilliseconds, 'PRODUCER_REMOVE_OUTCOME_UNKNOWN');
      removed = true; note('removed'); return snapshot();
    },
  };
}
