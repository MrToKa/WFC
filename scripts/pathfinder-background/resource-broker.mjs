import { classifyManagedRequest, validateManagedRange, validateManagedResourceResponse } from './managed-runner.mjs';

export const RESOURCE_BROKER_LIMITS = Object.freeze({ handles: 16, requests: 50000, bytes: 4 * 1024 ** 3,
  chunkBytes: 65536, upstreamChunkBytes: 1024 * 1024, inactivityMilliseconds: 30000,
  operationMilliseconds: 25000, closeMilliseconds: 5000 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$(?![\s\S])/;
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key) && !Object.getOwnPropertyDescriptor(value, key)?.get && !Object.getOwnPropertyDescriptor(value, key)?.set);
const failure = code => Object.assign(new Error(code), { code });
const need = (condition, code) => { if (!condition) throw failure(code); };
const safe = (error, fallback) => typeof error?.code === 'string' && /^PRODUCER_[A-Z0-9_]{1,95}$/.test(error.code) ? error.code : fallback;
const EMPTY_ASSETS = new Map();
const allowedHeaders = new Set(['accept-ranges', 'content-type', 'content-length', 'content-range']);
const statuses = new Set([200, 206, 304, 400, 401, 403, 404, 405, 409, 410, 416, 429, 500, 502, 503, 507]);

function brokerIdentity(value) {
  const keys = ['projectId', 'modelVersionId', 'sessionId'];
  need(exact(value, keys) && keys.every(key => typeof value[key] === 'string' && UUID.test(value[key])), 'PRODUCER_BROKER_IDENTITY_INVALID');
  return Object.freeze({ ...value });
}
function helperOrigin(value) {
  need(typeof value === 'string' && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$(?![\s\S])/.test(value), 'PRODUCER_BROKER_ORIGIN_REFUSED');
  const parsed = new URL(value);
  need(parsed.origin === value && Number(parsed.port) >= 1024 && Number(parsed.port) <= 65535, 'PRODUCER_BROKER_ORIGIN_REFUSED');
  return value;
}

/** This returns a local path only. The source callback has no caller-selected URL. */
export function mapManagedResourcePath(raw, identity, localOrigin, sourceOrigin = 'http://127.0.0.1:5191') {
  need(sourceOrigin === 'http://127.0.0.1:5191', 'PRODUCER_BROKER_SOURCE_REFUSED');
  helperOrigin(localOrigin);
  const scope = brokerIdentity(identity);
  need(classifyManagedRequest(raw, scope, localOrigin, EMPTY_ASSETS).kind === 'resource', 'PRODUCER_HTTP_PATH_REFUSED');
  const query = raw.indexOf('?');
  return query < 0 ? raw : raw.slice(0, query) + '?domain=' + encodeURIComponent(sourceOrigin);
}

export function sanitizeManagedResourceHeaders(input) {
  need(plain(input) && Object.keys(input).length <= 64, 'PRODUCER_RESOURCE_HEADERS_REFUSED');
  const result = {};
  for (const key of Object.keys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key), name = key.toLowerCase();
    need(descriptor && !descriptor.get && !descriptor.set && /^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) && key.length <= 128 &&
      typeof descriptor.value === 'string' && descriptor.value.length <= 2048 && /^[\x20-\x7e]*$/.test(descriptor.value) &&
      !/(?:cookie|authorization|authenticate|credential|token|secret)/i.test(name), 'PRODUCER_RESOURCE_HEADERS_REFUSED');
    if (!allowedHeaders.has(name)) continue;
    need(!Object.hasOwn(result, name), 'PRODUCER_RESOURCE_HEADERS_REFUSED');
    const value = descriptor.value;
    need(value.length <= 256, 'PRODUCER_RESOURCE_HEADERS_REFUSED');
    if (name === 'accept-ranges') need(value === 'bytes', 'PRODUCER_RESOURCE_HEADERS_REFUSED');
    if (name === 'content-type') need(['application/octet-stream', 'application/json', 'application/json; charset=utf-8'].includes(value.toLowerCase()), 'PRODUCER_RESOURCE_HEADERS_REFUSED');
    if (name === 'content-length') need(/^(?:0|[1-9][0-9]{0,10})$/.test(value) && Number(value) <= RESOURCE_BROKER_LIMITS.bytes, 'PRODUCER_RESOURCE_HEADERS_REFUSED');
    if (name === 'content-range') need(/^bytes (?:(?:[0-9]+-[0-9]+)|\*)\/[0-9]+$/.test(value), 'PRODUCER_RESOURCE_HEADERS_REFUSED');
    result[name] = value;
  }
  return result;
}

function validateRequest(value) {
  need(exact(value, ['kind', 'method', 'path', 'range', 'offset', 'length']) && value.kind === 'resource' && ['GET', 'HEAD'].includes(value.method) &&
    typeof value.path === 'string' && Number.isSafeInteger(value.offset) && value.offset >= 0 && value.offset <= RESOURCE_BROKER_LIMITS.bytes &&
    Number.isSafeInteger(value.length) && value.length > 0 && value.length <= RESOURCE_BROKER_LIMITS.chunkBytes, 'PRODUCER_RESOURCE_REQUEST_INVALID');
  validateManagedRange(value.range); return value;
}
function responseFacts(raw, request) {
  need(plain(raw) && statuses.has(raw.status) && Number.isSafeInteger(raw.totalBytes) && raw.totalBytes >= 0 && raw.totalBytes <= RESOURCE_BROKER_LIMITS.bytes,
    'PRODUCER_RESOURCE_SOURCE_INVALID');
  const headers = sanitizeManagedResourceHeaders(raw.headers);
  need(raw.status !== 304 || request.method === 'HEAD', 'PRODUCER_RESOURCE_SOURCE_INVALID');
  need(request.method !== 'HEAD' || raw.totalBytes === 0, 'PRODUCER_RESOURCE_SOURCE_INVALID');
  if (request.method === 'GET') {
    need(headers['content-length'] === undefined || Number(headers['content-length']) === raw.totalBytes, 'PRODUCER_RESOURCE_SOURCE_INVALID');
    headers['content-length'] = String(raw.totalBytes);
  }
  if (raw.status === 206) {
    const range = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/.exec(headers['content-range'] ?? ''), values = range?.slice(1).map(Number);
    need(values && values.every(Number.isSafeInteger) && values[0] <= values[1] && values[1] < values[2] && request.range !== null &&
      (request.method === 'HEAD' ? headers['content-length'] === undefined || Number(headers['content-length']) === values[1] - values[0] + 1 : raw.totalBytes === values[1] - values[0] + 1), 'PRODUCER_RESOURCE_SOURCE_INVALID');
  } else if (raw.status === 416) {
    const range = /^bytes \*\/([0-9]+)$/.exec(headers['content-range'] ?? '');
    need(range && Number.isSafeInteger(Number(range[1])), 'PRODUCER_RESOURCE_SOURCE_INVALID');
  } else need(headers['content-range'] === undefined, 'PRODUCER_RESOURCE_SOURCE_INVALID');
  const body = raw.body ?? (request.method === 'HEAD' || raw.totalBytes === 0 ? Buffer.alloc(0) : undefined);
  need(Buffer.isBuffer(body) ? body.length === raw.totalBytes : body && typeof body[Symbol.asyncIterator] === 'function' && typeof raw.close === 'function', 'PRODUCER_RESOURCE_SOURCE_INVALID');
  need(raw.close === undefined || typeof raw.close === 'function', 'PRODUCER_RESOURCE_SOURCE_INVALID');
  return { status: raw.status, headers, totalBytes: raw.totalBytes, body, close: raw.close };
}

/** One verified source response per UUID. Authorize is mandatory and rechecked
 * after awaited I/O; a continuation never reopens or substitutes a resource. */
export function createManagedResourceBroker(options) {
  const identity = brokerIdentity(options?.identity), localOrigin = helperOrigin(options.helperOrigin), sourceOrigin = options.sourceOrigin;
  need(sourceOrigin === 'http://127.0.0.1:5191' && typeof options.readResource === 'function' && typeof options.authorize === 'function', 'PRODUCER_BROKER_CONFIGURATION_INVALID');
  const setTimer = options.setTimer ?? setTimeout, clearTimer = options.clearTimer ?? clearTimeout, now = options.now ?? Date.now;
  const entries = new Map(), used = new Set(), controller = new AbortController();
  let disposed = false, requests = 0, bytes = 0, disposal;
  const snapshot = () => Object.freeze({ disposed, handles: entries.size, requests, bytes, quarantined: [...entries.values()].filter(entry => entry.quarantine).length });
  const bounded = async (work, milliseconds, code) => {
    let timer;
    try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimer(() => reject(failure(code)), Math.max(1, milliseconds)); timer?.unref?.(); })]); }
    finally { if (timer !== undefined) clearTimer(timer); }
  };
  const within = (entry, work) => {
    need(!entry.signal.aborted, 'PRODUCER_RESOURCE_CANCELLED');
    const remaining = entry.deadline - now(); need(remaining > 0, 'PRODUCER_RESOURCE_TIMEOUT');
    return bounded(work, remaining, 'PRODUCER_RESOURCE_TIMEOUT');
  };
  const markClosed = entry => { clearTimer(entry.timer); entries.delete(entry.id); entry.closed = true; };
  const closeKnown = entry => {
    if (entry.resourceClosing) return entry.resourceClosing;
    entry.resourceClosing = (async () => {
      const source = entry.raw;
      if (!source) return;
      const tasks = [];
      if (source.body && !Buffer.isBuffer(source.body) && typeof source.close !== 'function') tasks.push(Promise.reject(failure('PRODUCER_RESOURCE_CLOSE_UNKNOWN')));
      if (entry.iterator?.return) tasks.push(Promise.resolve().then(() => entry.iterator.return()));
      if (source.body && !Buffer.isBuffer(source.body) && typeof source.body.destroy === 'function') {
        try { source.body.destroy(); } catch { tasks.push(Promise.reject(failure('PRODUCER_RESOURCE_CLOSE_UNKNOWN'))); }
      }
      if (typeof source.close === 'function') tasks.push(Promise.resolve().then(() => source.close()));
      const results = await Promise.allSettled(tasks);
      need(results.every(value => value.status === 'fulfilled'), 'PRODUCER_RESOURCE_CLOSE_UNKNOWN');
      markClosed(entry);
    })();
    return entry.resourceClosing;
  };
  const closeEntry = entry => {
    if (entry.closing) return entry.closing;
    entry.abort.abort(); clearTimer(entry.timer);
    entry.closing = (async () => {
      try {
        if (entry.opening && !entry.raw) await bounded(() => entry.opening, RESOURCE_BROKER_LIMITS.closeMilliseconds, 'PRODUCER_RESOURCE_CLOSE_UNKNOWN');
        if (entry.raw) await bounded(() => closeKnown(entry), RESOURCE_BROKER_LIMITS.closeMilliseconds, 'PRODUCER_RESOURCE_CLOSE_UNKNOWN');
        else markClosed(entry);
      } catch (error) {
        if (entry.openFailed && !entry.raw) { markClosed(entry); return; }
        entry.quarantine = true; throw failure(safe(error, 'PRODUCER_RESOURCE_CLOSE_UNKNOWN'));
      }
    })();
    void entry.closing.catch(() => undefined); return entry.closing;
  };
  const arm = entry => {
    clearTimer(entry.timer); entry.timer = setTimer(() => { void closeEntry(entry).catch(() => undefined); }, RESOURCE_BROKER_LIMITS.inactivityMilliseconds); entry.timer?.unref?.();
  };
  const dispose = () => {
    if (disposal) return disposal;
    disposed = true; controller.abort(); options.signal?.removeEventListener('abort', externalAbort);
    disposal = (async () => {
      const results = await Promise.allSettled([...entries.values()].map(closeEntry));
      need(results.every(value => value.status === 'fulfilled') && entries.size === 0, 'PRODUCER_RESOURCE_CLOSE_UNKNOWN');
      return snapshot();
    })();
    void disposal.catch(() => undefined); return disposal;
  };
  const externalAbort = () => { void dispose().catch(() => undefined); };
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  if (options.signal?.aborted) externalAbort();

  return {
    get snapshot() { return snapshot(); },
    async request(requestId, input) {
      let entry;
      try {
        need(!disposed && !controller.signal.aborted && ++requests <= RESOURCE_BROKER_LIMITS.requests, 'PRODUCER_RESOURCE_BUDGET');
        need(typeof requestId === 'string' && UUID.test(requestId), 'PRODUCER_RESOURCE_REQUEST_INVALID');
        const request = validateRequest(input), mapped = mapManagedResourcePath(request.path, identity, localOrigin, sourceOrigin);
        entry = entries.get(requestId);
        if (!entry) {
          need(!used.has(requestId) && request.offset === 0 && entries.size < RESOURCE_BROKER_LIMITS.handles, 'PRODUCER_RESOURCE_IDENTITY_REFUSED');
          used.add(requestId);
          const abort = new AbortController();
          entry = { id: requestId, request: { method: request.method, path: request.path, range: request.range }, mapped, abort,
            signal: AbortSignal.any([controller.signal, abort.signal]), offset: 0, buffer: null, cursor: 0, ended: false, busy: false, closed: false, quarantine: false };
          entries.set(requestId, entry);
        }
        need(!entry.busy && !entry.closed && !entry.signal.aborted && request.offset === entry.offset && request.method === entry.request.method && request.path === entry.request.path && request.range === entry.request.range && mapped === entry.mapped, 'PRODUCER_RESOURCE_IDENTITY_REFUSED');
        entry.busy = true; entry.deadline = now() + RESOURCE_BROKER_LIMITS.operationMilliseconds; arm(entry);
        await within(entry, () => options.authorize(identity, entry.signal));
        if (!entry.opening) {
          entry.opening = Promise.resolve().then(() => options.readResource({ path: mapped, method: request.method, range: request.range, signal: entry.signal }));
          // If cancellation preceded a late open acknowledgement, close that
          // actual handle once known; never reinterpret an unknown close as PASS.
          void entry.opening.then(raw => {
            entry.raw = raw;
            if (entry.signal.aborted) void closeKnown(entry).catch(() => { entry.quarantine = true; });
          }, () => { entry.openFailed = true; });
          entry.raw = await within(entry, () => entry.opening);
          entry.response = responseFacts(entry.raw, request);
          if (!Buffer.isBuffer(entry.response.body)) entry.iterator = entry.response.body[Symbol.asyncIterator]();
        }
        const response = entry.response;
        need(response && (request.length === RESOURCE_BROKER_LIMITS.chunkBytes || request.offset + request.length >= response.totalBytes), 'PRODUCER_RESOURCE_REQUEST_INVALID');
        const wanted = Math.min(request.length, response.totalBytes - entry.offset), parts = []; let loaded = 0;
        if (Buffer.isBuffer(response.body)) {
          parts.push(response.body.subarray(entry.offset, entry.offset + wanted)); loaded = wanted;
        } else {
          while (loaded < wanted) {
            if (!entry.buffer || entry.cursor === entry.buffer.length) {
              const next = await within(entry, () => entry.iterator.next());
              need(!next.done && next.value instanceof Uint8Array && next.value.byteLength > 0 && next.value.byteLength <= RESOURCE_BROKER_LIMITS.upstreamChunkBytes, 'PRODUCER_RESOURCE_BODY_INVALID');
              entry.buffer = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength); entry.cursor = 0;
            }
            const length = Math.min(wanted - loaded, entry.buffer.length - entry.cursor);
            parts.push(Buffer.from(entry.buffer.subarray(entry.cursor, entry.cursor + length))); entry.cursor += length; loaded += length;
          }
          if (entry.offset + loaded === response.totalBytes) {
            need(!entry.buffer || entry.cursor === entry.buffer.length, 'PRODUCER_RESOURCE_BODY_INVALID');
            const end = await within(entry, () => entry.iterator.next()); need(end.done, 'PRODUCER_RESOURCE_BODY_INVALID'); entry.ended = true;
          }
        }
        const data = Buffer.concat(parts, loaded);
        await within(entry, () => options.authorize(identity, entry.signal));
        need(!disposed && !entry.signal.aborted && bytes + loaded <= RESOURCE_BROKER_LIMITS.bytes, 'PRODUCER_RESOURCE_BUDGET');
        const payload = { status: response.status, headers: { ...response.headers }, totalBytes: response.totalBytes,
          dataBase64: data.toString('base64'), complete: entry.offset + loaded === response.totalBytes };
        validateManagedResourceResponse(payload, request);
        bytes += loaded; entry.offset += loaded;
        if (payload.complete) {
          await closeEntry(entry);
          need(!controller.signal.aborted && !disposed && entry.deadline > now(), 'PRODUCER_RESOURCE_CANCELLED');
          await bounded(() => options.authorize(identity, controller.signal), entry.deadline - now(), 'PRODUCER_RESOURCE_TIMEOUT');
          need(!controller.signal.aborted && !disposed, 'PRODUCER_RESOURCE_CANCELLED');
        } else { entry.busy = false; arm(entry); }
        return payload;
      } catch (error) {
        if (entry) { try { await closeEntry(entry); } catch (cleanup) { throw failure(safe(cleanup, 'PRODUCER_RESOURCE_CLOSE_UNKNOWN')); } }
        throw failure(safe(error, 'PRODUCER_RESOURCE_READ_FAILED'));
      }
    },
    async cancel(requestId) {
      need(typeof requestId === 'string' && UUID.test(requestId), 'PRODUCER_RESOURCE_REQUEST_INVALID');
      const entry = entries.get(requestId); if (entry) await closeEntry(entry); return snapshot();
    },
    dispose,
  };
}
