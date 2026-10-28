import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { abortCheck, clone, CoreError, digest, fail, identifier, PROFILE, validateLocalPath } from './contracts.mjs';
export { createFakeCostProvider, createClosedCostProvider, isFakeCostProvider } from './cost.mjs';

const fakeProviders = new WeakSet(), fakeTransports = new WeakSet();
const METHODS = ['getStorage', 'createStorage', 'getObject', 'upload', 'submit', 'getManifest', 'getDownloadPlan', 'readResource'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function collection(value) {
  if (value === undefined) return new Map();
  if (value instanceof Map) return new Map(value);
  if (Array.isArray(value)) return new Map(value.map(item => [item.objectId ?? item.submissionIdentity ?? item.rootId, item]));
  if (value && Object.getPrototypeOf(value) === Object.prototype) return new Map(Object.entries(value));
  fail('CONFIGURATION_INVALID');
}
function fakeHandlers(value = {}) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.entries(value).some(([name, handler]) => !METHODS.includes(name) || typeof handler !== 'function')) fail('CONFIGURATION_INVALID');
  return { ...value };
}
function hashId(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null; }
function summary(method, context, options = {}) {
  const result = { operation: method, method };
  for (const key of ['submissionIdentity', 'remoteTargetIdentity']) if (hashId(context?.[key])) result[key] = context[key];
  if (['US', 'EMEA'].includes(context?.region)) result.region = context.region;
  for (const key of ['rootId', 'resourceId', 'attemptId']) {
    try { identifier(options[key], 'PROVIDER_RESPONSE_INVALID'); result[key] = options[key]; } catch { /* foreign values are never logged */ }
  }
  return result;
}
function cloneReply(value) { return value === null || value === undefined ? value : clone(value); }
function readMap(map, context) {
  for (const key of [context.remoteTargetIdentity, context.objectId, context.destination?.objectKey, `${context.destination?.bucket}/${context.destination?.objectKey}`]) if (map.has(key)) return map.get(key);
  return undefined;
}
async function withAbort(value, signal) {
  // The caller may already have started an async iterator next() while abort
  // races this boundary. Always handle that promise, including late rejection.
  const pending = Promise.resolve(value);
  if (signal?.aborted) { pending.catch(() => {}); abortCheck(signal); }
  if (!signal) return pending;
  let listener;
  try {
    return await Promise.race([pending, new Promise((resolve, reject) => {
      listener = () => reject(new CoreError('LOCAL_ABORTED'));
      signal.addEventListener('abort', listener, { once: true });
      if (signal.aborted) listener();
    })]);
  } finally { signal.removeEventListener('abort', listener); }
}

/** Raw-byte fixture transport. It has no URL resolver or networking code. */
export function createFakeTransport({ resources, chunkBytes = 65536, handlers = {} } = {}) {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 1024 * 1024) fail('CONFIGURATION_INVALID');
  const records = new Map(), calls = [];
  for (const [key, input] of collection(resources)) {
    identifier(key, 'CONFIGURATION_INVALID');
    const record = Buffer.isBuffer(input) || input instanceof Uint8Array ? { data: Buffer.from(input) } : { ...input };
    const resourceId = record.resourceId ?? key;
    identifier(resourceId, 'CONFIGURATION_INVALID');
    const localPath = record.path ?? `output/0/${key}`;
    if (!/^output\/0\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(localPath) || /\/\.{1,2}$|\/[^/]*\.$/.test(localPath)) fail('CONFIGURATION_INVALID');
    if (records.has(resourceId)) fail('CONFIGURATION_INVALID');
    if (record.data !== undefined) {
      if (!Buffer.isBuffer(record.data) && !(record.data instanceof Uint8Array)) fail('CONFIGURATION_INVALID');
      record.data = Buffer.from(record.data);
      record.bytes ??= record.data.length; record.sha256 ??= sha256(record.data);
    }
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 || (record.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(record.sha256))) fail('CONFIGURATION_INVALID');
    if (record.data === undefined && typeof record.body !== 'function') fail('CONFIGURATION_INVALID');
    records.set(resourceId, { ...record, path: localPath, resourceId });
  }
  if (Object.keys(handlers).some(name => name !== 'readResource') || (handlers.readResource !== undefined && typeof handlers.readResource !== 'function')) fail('CONFIGURATION_INVALID');
  const api = {
    kind: 'fake', mode: 'fake',
    get calls() { return clone(calls); },
    describeResources() {
      return [...records.values()].map(record => ({ path: record.path, resourceId: record.resourceId, bytes: record.bytes,
        ...(record.sha256 !== undefined ? { sha256: record.sha256 } : {}) })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    },
    async *readResource(context, { resourceId, signal } = {}) {
      abortCheck(signal); identifier(resourceId, 'DOWNLOAD_INVALID');
      calls.push(summary('readResource', context, { resourceId }));
      const record = records.get(resourceId);
      if (!record) fail('DOWNLOAD_INVALID');
      const defaultRead = async function* () {
        if (record.data !== undefined) {
          for (let offset = 0; offset < record.data.length; offset += chunkBytes) { abortCheck(signal); yield record.data.subarray(offset, offset + chunkBytes); }
        } else {
          const body = await withAbort(record.body({ signal }), signal);
          for await (const chunk of body) { abortCheck(signal); yield chunk; }
        }
      };
      const body = await withAbort(handlers.readResource ? handlers.readResource(context, { resourceId, signal }, { default: defaultRead }) : defaultRead(), signal);
      if (!body?.[Symbol.asyncIterator] && !body?.[Symbol.iterator]) fail('DOWNLOAD_INVALID');
      const iterator = body[Symbol.asyncIterator]?.() ?? body[Symbol.iterator]();
      try {
        for (;;) {
          const item = await withAbort(iterator.next(), signal);
          if (item.done) break;
          if (!Buffer.isBuffer(item.value) && !(item.value instanceof Uint8Array)) fail('DOWNLOAD_INVALID');
          yield Buffer.from(item.value);
        }
      } finally {
        const returned = iterator.return?.();
        if (signal?.aborted) Promise.resolve(returned).catch(() => {}); else await returned;
      }
    },
  };
  fakeTransports.add(api); return Object.freeze(api);
}
export function isFakeTransport(value) { return fakeTransports.has(value); }

/** The only working Stage-2 provider is an explicit in-memory simulation. */
export function createFakeProvider({ clock, objects, manifests, resources, handlers, transport, storages, plans } = {}) {
  if (clock !== undefined && typeof clock?.now !== 'function' && typeof clock !== 'function') fail('CONFIGURATION_INVALID');
  const objectRecords = collection(objects), manifestRecords = collection(manifests), planRecords = collection(plans), storageRecords = collection(storages);
  const script = fakeHandlers(handlers), calls = [];
  const byteTransport = transport ?? createFakeTransport({ resources });
  if (!isFakeTransport(byteTransport)) fail('CONFIGURATION_INVALID', 'An explicitly factory-branded fake transport is required.');
  let api;
  const storageKey = context => digest({ namespace: context.namespace, region: context.region, bucket: context.destination.bucket });
  const getObservation = context => {
    const stored = manifestRecords.get(context.submissionIdentity) ?? manifestRecords.get(context.urn);
    return stored ? { objectId: context.objectId, urn: context.urn, submissionIdentity: context.submissionIdentity, roots: [], ...cloneReply(stored) }
      : { status: 'not-found', objectId: context.objectId, urn: context.urn, submissionIdentity: context.submissionIdentity, roots: [] };
  };
  const invoke = async (method, context, options, defaultAction) => {
    abortCheck(options.signal); calls.push(summary(method, context, options));
    const result = script[method] ? script[method](context, options, { default: defaultAction, provider: api }) : defaultAction();
    const value = await withAbort(result, options.signal); abortCheck(options.signal); return cloneReply(value);
  };
  api = {
    kind: 'fake', mode: 'fake', transport: byteTransport,
    get calls() { return clone(calls); },
    get counts() { return Object.fromEntries(METHODS.map(method => [method, calls.filter(call => call.operation === method).length])); },
    getStorage(context, options = {}) {
      return invoke('getStorage', context, options, () => {
        const record = storageRecords.get(storageKey(context)) ?? storageRecords.get(context.destination.bucket);
        if (record) return record;
        // An object fixture already denotes a pre-existing storage namespace.
        if (readMap(objectRecords, context) !== undefined) return { bucket: context.destination.bucket, namespace: clone(context.namespace), region: context.region };
        return null;
      });
    },
    createStorage(context, options = {}) {
      return invoke('createStorage', context, options, () => {
        const record = { bucket: context.destination.bucket, namespace: clone(context.namespace), region: context.region };
        storageRecords.set(storageKey(context), record); return record;
      });
    },
    getObject(context, options = {}) {
      return invoke('getObject', context, options, () => {
        const record = readMap(objectRecords, context);
        if (record === undefined || record === null) return null;
        if (Buffer.isBuffer(record)) return { objectId: context.objectId, bytes: record.length, sha256: sha256(record) };
        return { objectId: context.objectId, ...record };
      });
    },
    upload(context, options = {}) {
      if (options.retries !== 0) fail('INVALID_JOB', 'Mutation retries must be explicitly disabled.');
      return invoke('upload', context, options, async () => {
        const sourcePath = validateLocalPath(options.sourcePath ?? context.source.snapshotPath, { label: 'snapshot' });
        const hash = createHash('sha256'); let bytes = 0;
        const source = createReadStream(sourcePath, { signal: options.signal });
        try {
          for await (const chunk of source) {
            abortCheck(options.signal); bytes += chunk.length;
            if (bytes > context.source.bytes) fail('SNAPSHOT_CHANGED'); hash.update(chunk);
          }
        } catch (error) { abortCheck(options.signal); throw error; }
        finally { source.destroy(); }
        const fingerprint = hash.digest('hex');
        if (bytes !== context.source.bytes || fingerprint !== context.source.sha256) fail('SNAPSHOT_CHANGED');
        const receipt = { objectId: context.objectId, bytes, sha256: fingerprint };
        objectRecords.set(context.remoteTargetIdentity, receipt); return receipt;
      });
    },
    submit(context, options = {}) {
      if (options.retries !== 0 || options.xAdsForce !== false || context.conversion.xAdsForce !== false || context.conversion.format !== 'svf') fail('UNSUPPORTED_PROFILE', 'Only explicit SVF submission without force or retry is simulated.');
      identifier(options.attemptId, 'INVALID_JOB');
      return invoke('submit', context, options, () => {
        const providerJobId = `fake-job-${digest({ submissionIdentity: context.submissionIdentity, attemptId: options.attemptId }).slice(0, 24)}`;
        const available = byteTransport.describeResources().length > 0;
        manifestRecords.set(context.submissionIdentity, { status: available ? 'success' : 'pending', objectId: context.objectId, urn: context.urn,
          submissionIdentity: context.submissionIdentity, providerJobId,
          roots: available ? [{ rootId: `fake-root-${context.submissionIdentity.slice(0, 24)}`, format: 'svf', supportProfile: PROFILE }] : [] });
        return { result: 'created', objectId: context.objectId, urn: context.urn, providerJobId, submissionIdentity: context.submissionIdentity };
      });
    },
    getManifest(context, options = {}) { return invoke('getManifest', context, options, () => getObservation(context)); },
    getDownloadPlan(context, options = {}) {
      identifier(options.rootId, 'DOWNLOAD_INVALID');
      return invoke('getDownloadPlan', context, options, () => {
        const stored = planRecords.get(options.rootId);
        if (stored) return stored;
        const observation = getObservation(context);
        if (observation.status !== 'success' || !observation.roots.some(root => root.rootId === options.rootId)) fail('DERIVATIVE_PENDING');
        return { schemaVersion: 1, submissionIdentity: context.submissionIdentity, objectId: context.objectId, urn: context.urn,
          region: context.region, rootId: options.rootId, supportProfile: context.supportProfile, resources: byteTransport.describeResources() };
      });
    },
    async *readResource(context, options = {}) {
      abortCheck(options.signal); calls.push(summary('readResource', context, options));
      const body = await withAbort(script.readResource ? script.readResource(context, options, { default: () => byteTransport.readResource(context, options), provider: api }) : byteTransport.readResource(context, options), options.signal);
      const iterator = body?.[Symbol.asyncIterator]?.() ?? body?.[Symbol.iterator]?.();
      if (!iterator) fail('DOWNLOAD_INVALID');
      try {
        for (;;) { const item = await withAbort(iterator.next(), options.signal); if (item.done) break; abortCheck(options.signal); yield item.value; }
      } finally {
        const returned = iterator.return?.();
        if (options.signal?.aborted) Promise.resolve(returned).catch(() => {}); else await returned;
      }
    },
    // Explicit local fixture controls do not represent provider/cloud calls.
    setObject(context, value) { objectRecords.set(context.remoteTargetIdentity, clone(value)); },
    setManifest(context, value) { manifestRecords.set(context.submissionIdentity, clone(value)); },
    setDownloadPlan(rootId, value) { planRecords.set(rootId, clone(value)); },
  };
  fakeProviders.add(api); return Object.freeze(api);
}
export function isFakeProvider(value) { return fakeProviders.has(value); }

/** No SDK, credentials, URL transport, pricing API or network fallback exists. */
export function createClosedProvider() {
  const closed = () => fail('CLOUD_CLOSED');
  const api = { kind: 'closed-real', mode: 'closed-real', calls: Object.freeze([]) };
  for (const method of METHODS) api[method] = closed;
  return Object.freeze(api);
}
