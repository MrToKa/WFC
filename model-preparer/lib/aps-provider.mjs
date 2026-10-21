import https from 'node:https';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { abortCheck, CoreError, digest, fail, identifier, PROFILE, validateLocalPath, validateSourceName } from './contracts.mjs';
import { brandAPSProvider } from './aps-capabilities.mjs';

const API = 'https://developer.api.autodesk.com';
const JSON_CAP = 4 * 1024 * 1024;
const RAW_CAP = 2 * 1024 ** 3;
const TOTAL_CAP = 8 * 1024 ** 3;
const TIMEOUT = 120000;
const sha = value => createHash('sha256').update(value).digest('hex');
const header = (response, name) => Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
function validHash(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }
function privateError(status) { const error = new CoreError('PROVIDER_FAILURE'); if (Number.isInteger(status)) error.httpStatus = status; return error; }
function checkedUrl(value, { apiOnly = false, upload = false } = {}) {
  let url; try { url = new URL(value); } catch { fail('PROVIDER_RESPONSE_INVALID'); }
  const hostAllowed = apiOnly ? url.hostname === 'developer.api.autodesk.com' : upload
    ? /^com-autodesk-oss-[a-z0-9-]+\.s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com$/.test(url.hostname)
    : url.hostname === 'cdn.derivative.autodesk.com' || /^com-autodesk-oss-[a-z0-9-]+\.s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com$/.test(url.hostname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || url.hash || !hostAllowed) fail('PROVIDER_RESPONSE_INVALID');
  return url;
}
function nativeRequest({ url, method, headers, body, signal, timeoutMs }) {
  abortCheck(signal);
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method, headers, signal }, response => {
      const cleanup = () => clearTimeout(timer);
      response.once('end', cleanup); response.once('close', cleanup);
      resolve({ statusCode: response.statusCode, headers: response.headers, body: response });
    });
    const timer = setTimeout(() => request.destroy(privateError()), timeoutMs);
    timer.unref?.();
    request.once('error', error => { clearTimeout(timer); reject(signal?.aborted ? new CoreError('LOCAL_ABORTED') : privateError()); });
    if (body === undefined) request.end();
    else if (Buffer.isBuffer(body) || typeof body === 'string') request.end(body);
    else request.destroy(privateError());
  });
}
async function nextBounded(iterator, signal, deadline) {
  abortCheck(signal);
  let listener, timer;
  const pending = Promise.resolve().then(() => iterator.next());
  try {
    return await Promise.race([pending, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(privateError()), Math.max(1, deadline - Date.now()));
      listener = () => reject(new CoreError('LOCAL_ABORTED'));
      signal?.addEventListener('abort', listener, { once: true }); if (signal?.aborted) listener();
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', listener); }
}
async function* boundedBody(body, maxBytes, { signal, expectedBytes } = {}) {
  const source = Buffer.isBuffer(body) || body instanceof Uint8Array ? [body] : body;
  const iterator = source?.[Symbol.asyncIterator]?.() ?? source?.[Symbol.iterator]?.();
  if (!iterator) fail('PROVIDER_RESPONSE_INVALID');
  const deadline = Date.now() + TIMEOUT;
  let bytes = 0;
  try {
    for (;;) {
      const item = await nextBounded(iterator, signal, deadline);
      if (item.done) break;
      if (!Buffer.isBuffer(item.value) && !(item.value instanceof Uint8Array)) fail('PROVIDER_RESPONSE_INVALID');
      const chunk = Buffer.from(item.value); bytes += chunk.length;
      if (bytes > maxBytes || expectedBytes !== undefined && bytes > expectedBytes) fail('PACKAGE_LIMIT_EXCEEDED');
      yield chunk;
    }
    if (expectedBytes !== undefined && bytes !== expectedBytes) fail('DOWNLOAD_INCOMPLETE');
  } finally {
    body?.destroy?.();
    const returned = iterator.return?.();
    // A foreign test iterator must not hold cancellation indefinitely.
    if (signal?.aborted) Promise.resolve(returned).catch(() => {}); else if (returned) Promise.resolve(returned).catch(() => {});
  }
}
async function bufferBody(body, maxBytes, options) {
  const chunks = []; let bytes = 0;
  for await (const chunk of boundedBody(body, maxBytes, options)) { chunks.push(chunk); bytes += chunk.length; }
  return Buffer.concat(chunks, bytes);
}
function destroy(response) { response?.body?.destroy?.(); }

/** Server-only APS adapter. Credentials, actual OSS IDs, cookies and signed
 * addresses stay in this factory closure. The constructor makes no request.
 * testTransport is a trusted test injection, never an HTTP/UI configuration. */
export function createAPSProvider({ clientId, clientSecret, region, bucket, namespace, packageApi,
  authorizeRead, clock = { now: () => Date.now() }, testTransport, reuseOnly = true,
  objectKeysBySource = {}, allowLegacyExistingSVF = true } = {}) {
  if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{8,256}$/.test(clientId) || typeof clientSecret !== 'string' || !clientSecret || /[\x00-\x20\x7f]/.test(clientSecret)
    || !['US', 'EMEA'].includes(region) || typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(bucket)
    || typeof namespace?.account !== 'string' || !/^team-[0-9a-f]{16,64}$/.test(namespace.account)
    || namespace.application !== 'app-' + sha(clientId) || typeof authorizeRead !== 'function'
    || typeof packageApi?.inspectSvfEnvelope !== 'function' || typeof clock?.now !== 'function'
    || typeof reuseOnly !== 'boolean' || typeof allowLegacyExistingSVF !== 'boolean') fail('CONFIGURATION_INVALID');
  if (testTransport !== undefined && typeof testTransport?.request !== 'function') fail('CONFIGURATION_INVALID');
  const alias = 'target-' + sha(bucket), ns = { account: namespace.account, application: namespace.application };
  const keyOverrides = new Map();
  if (!objectKeysBySource || Object.getPrototypeOf(objectKeysBySource) !== Object.prototype) fail('CONFIGURATION_INVALID');
  for (const [fingerprint, key] of Object.entries(objectKeysBySource)) {
    if (!validHash(fingerprint)) fail('CONFIGURATION_INVALID'); validateSourceName(key); keyOverrides.set(fingerprint, key);
  }
  const callNames = ['auth', 'getStorage', 'createStorage', 'getObject', 'getManifest', 'signedResource', 'rawResource', 'initiateUpload', 'uploadPart', 'completeUpload', 'submit'];
  const audit = [];
  function stamp() { const value = clock.now(); if (!Number.isSafeInteger(value)) fail('CONFIGURATION_INVALID'); return new Date(value).toISOString(); }
  function operationName(input) {
    const url = new URL(input.url), endpoint = url.pathname;
    if (endpoint === '/authentication/v2/token' && input.method === 'POST') return 'auth';
    if (url.hostname === 'developer.api.autodesk.com') {
      if (/^\/oss\/v2\/buckets\/[^/]+\/details$/.test(endpoint)) return 'getStorage';
      if (endpoint === '/oss/v2/buckets' && input.method === 'POST') return 'createStorage';
      if (endpoint.includes('/objects/') && endpoint.endsWith('/details')) return 'getObject';
      if (endpoint.endsWith('/signedcookies')) return 'signedResource';
      if (endpoint.endsWith('/signeds3upload')) return input.method === 'POST' ? 'completeUpload' : 'initiateUpload';
      if (endpoint === '/modelderivative/v2/designdata/job' && input.method === 'POST') return 'submit';
      if (endpoint.endsWith('/manifest') || endpoint.startsWith('/derivativeservice/v2/') && endpoint.includes('/manifest/')) return 'getManifest';
    }
    if (input.method === 'PUT') return 'uploadPart';
    if (input.method === 'GET') return 'rawResource';
    fail('PROVIDER_RESPONSE_INVALID');
  }
  const request = async input => {
    const operation = operationName(input);
    const entry = { operation, method: input.method, startedAt: stamp(), finishedAt: null, status: null, outcome: 'pending',
      cloudDataMutation: ['createStorage', 'initiateUpload', 'uploadPart', 'completeUpload', 'submit'].includes(operation) };
    audit.push(entry);
    try {
      const result = await (testTransport ? testTransport.request(input) : nativeRequest(input));
      entry.status = Number.isInteger(result?.statusCode) && result.statusCode >= 100 && result.statusCode <= 599 ? result.statusCode : null;
      entry.outcome = 'response'; entry.finishedAt = stamp(); return result;
    }
    catch (error) {
      entry.outcome = input.signal?.aborted ? 'interrupted' : 'failed'; entry.finishedAt = stamp();
      if (input.signal?.aborted) throw new CoreError('LOCAL_ABORTED');
      if (error instanceof CoreError) throw new CoreError(error.code);
      throw privateError();
    }
  };
  const rootsByContext = new Map(), plansByContext = new Map();
  let token, refreshingToken;
  function checkContext(context) {
    if (context?.namespace?.account !== ns.account || context?.namespace?.application !== ns.application || context.region !== region || context.destination?.bucket !== alias
      || context.supportProfile !== PROFILE || context.conversion?.format !== 'svf' || context.conversion?.xAdsForce !== false
      || JSON.stringify(context.conversion?.views) !== '["3d"]' || !positive(context.source?.bytes) || context.source.bytes > RAW_CAP || !validHash(context.source?.sha256)
      || !validHash(context.submissionIdentity) || typeof context.objectId !== 'string' || typeof context.urn !== 'string') fail('IDENTITY_MISMATCH');
    validateSourceName(context.source.name); validateSourceName(context.destination.objectKey);
    const logicalId = `urn:adsk.objects:os.object:${alias}/${context.destination.objectKey}`;
    if (context.objectId !== logicalId || context.urn !== Buffer.from(logicalId).toString('base64url')) fail('IDENTITY_MISMATCH');
    return context;
  }
  function actual(context) {
    checkContext(context);
    const key = keyOverrides.get(context.source.sha256) ?? context.destination.objectKey;
    const objectId = `urn:adsk.objects:os.object:${bucket}/${key}`;
    return { key, objectId, urn: Buffer.from(objectId).toString('base64url') };
  }
  function mutationGuard(options) {
    abortCheck(options?.signal);
    if (reuseOnly) fail('CLOUD_CLOSED');
    if (options?.retries !== 0 || typeof options.assertMutationAllowed !== 'function') fail('COST_BLOCKED');
    const value = options.assertMutationAllowed();
    if (value === false || value && typeof value.then === 'function') fail('COST_BLOCKED');
  }
  async function spendRead(context, signal, recoverDead) { abortCheck(signal); await authorizeRead(context, { signal, ...(recoverDead === true ? { recoverDead: true } : {}) }); abortCheck(signal); }
  async function accessToken(context, signal, recoverDead) {
    if (token && token.expires > clock.now() + 60000) return token.value;
    if (!refreshingToken) refreshingToken = (async () => {
      await spendRead(context, signal, recoverDead);
      const scopes = reuseOnly ? 'bucket:read data:read viewables:read' : 'data:read data:write data:create bucket:read bucket:create viewables:read';
      const body = new URLSearchParams({ grant_type: 'client_credentials', scope: scopes }).toString();
      const response = await request({ url: API + '/authentication/v2/token', method: 'POST', signal, timeoutMs: TIMEOUT,
        headers: { Authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Encoding': 'identity' }, body });
      const reply = await jsonResponse(response, signal);
      if (typeof reply.access_token !== 'string' || !reply.access_token || /[\x00-\x20\x7f]/.test(reply.access_token) || !positive(reply.expires_in)) fail('PROVIDER_RESPONSE_INVALID');
      token = { value: reply.access_token, expires: clock.now() + reply.expires_in * 1000 }; return token.value;
    })().finally(() => { refreshingToken = null; });
    const value = await refreshingToken; abortCheck(signal); return value;
  }
  async function jsonResponse(response, signal) {
    if (!Number.isInteger(response?.statusCode) || response.statusCode < 200 || response.statusCode > 299) { destroy(response); throw privateError(response?.statusCode); }
    const raw = await bufferBody(response.body, JSON_CAP, { signal });
    try {
      const bytes = String(header(response, 'content-encoding') ?? '').toLowerCase() === 'gzip' ? gunzipSync(raw, { maxOutputLength: JSON_CAP }) : raw;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), result = JSON.parse(text);
      if (!result || typeof result !== 'object' || Array.isArray(result)) fail('PROVIDER_RESPONSE_INVALID'); return result;
    } catch (error) { if (error instanceof CoreError) throw error; fail('PROVIDER_RESPONSE_INVALID'); }
  }
  async function apiResponse(context, endpoint, { signal, method = 'GET', body, mutateOptions, extraHeaders = {}, recoverDead } = {}) {
    checkContext(context); abortCheck(signal);
    if (method === 'GET' || method === 'HEAD') await spendRead(context, signal, recoverDead);
    const bearer = await accessToken(context, signal, recoverDead);
    const url = checkedUrl(API + endpoint, { apiOnly: true }).href;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = { Authorization: 'Bearer ' + bearer, region, 'Accept-Encoding': 'identity', ...extraHeaders };
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    if (mutateOptions) mutationGuard(mutateOptions);
    // Nothing is awaited between the final guard and opening the request.
    return request({ url, method, headers, body: payload, signal, timeoutMs: TIMEOUT });
  }
  async function apiJson(context, endpoint, options) { return jsonResponse(await apiResponse(context, endpoint, options), options?.signal); }
  async function hashSnapshot(context, signal) {
    const source = validateLocalPath(context.source.snapshotPath);
    if (path.basename(source) !== context.source.name) fail('IDENTITY_MISMATCH');
    const before = await fs.lstat(source);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || await fs.realpath(source) !== source) fail('UNSAFE_PATH');
    const h1 = createHash('sha1'), h256 = createHash('sha256'); let bytes = 0;
    const stream = createReadStream(source, { signal });
    try { for await (const chunk of stream) { abortCheck(signal); bytes += chunk.length; if (bytes > context.source.bytes) fail('SNAPSHOT_CHANGED'); h1.update(chunk); h256.update(chunk); } }
    finally { stream.destroy(); }
    const after = await fs.lstat(source), hash256 = h256.digest('hex');
    if (bytes !== context.source.bytes || hash256 !== context.source.sha256 || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) fail('SNAPSHOT_CHANGED');
    return { source, bytes, sha256: hash256, sha1: h1.digest('hex') };
  }
  function objectReceipt(value, context, local) {
    const target = actual(context);
    if (value.objectId !== target.objectId || value.objectKey !== target.key || value.bucketKey !== bucket || value.size !== local.bytes || !/^[0-9a-f]{40}$/.test(value.sha1 ?? '') || value.sha1 !== local.sha1) fail('IDENTITY_MISMATCH');
    return { objectId: context.objectId, bytes: local.bytes, sha256: local.sha256, identityBasis: 'aps-sha1-and-local-sha256', remoteSha1: value.sha1, localSha1: local.sha1, remoteObjectIdHash: sha(value.objectId) };
  }
  function derivativeUrn(value, context) {
    const prefix = 'urn:adsk.viewing:fs.file:' + actual(context).urn + '/';
    if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > 4096 || /[\x00-\x20\x7f?#]/.test(value)) fail('PROVIDER_RESPONSE_INVALID');
    const suffix = value.slice(prefix.length);
    if (!/^output\/[A-Za-z0-9._/-]+$/.test(suffix) || suffix.split('/').some(part => !part || part === '.' || part === '..')) fail('UNSAFE_PATH');
    return value;
  }
  function flatten(value, ancestors = [], result = []) {
    if (!value || typeof value !== 'object' || ancestors.length > 16 || result.length > 100000) fail('PROVIDER_RESPONSE_INVALID');
    result.push({ value, ancestors });
    for (const child of [...(Array.isArray(value.derivatives) ? value.derivatives : []), ...(Array.isArray(value.children) ? value.children : [])]) flatten(child, [...ancestors, value], result);
    return result;
  }
  async function manifestRecord(context, { signal, recoverDead } = {}) {
    const target = actual(context);
    let manifest;
    try { manifest = await apiJson(context, `/modelderivative/v2/designdata/${target.urn}/manifest`, { signal, recoverDead }); }
    catch (error) { if (error.httpStatus === 404) return { status: 'not-found', roots: [], records: [] }; throw error; }
    if (manifest.urn !== target.urn) fail('IDENTITY_MISMATCH');
    let records = flatten(manifest), candidates = records.filter(({ value, ancestors }) => value.mime === 'application/autodesk-svf' && typeof value.urn === 'string' && (value.role === '3d' || ancestors.some(parent => parent.role === '3d')));
    // Read an already existing Viewer SVF representation; never create SVF2 or
    // submit an additional fallback conversion. This path is explicit/configured.
    if (!candidates.length && manifest.status === 'success' && reuseOnly && allowLegacyExistingSVF) {
      const endpoint = region === 'EMEA' ? '/derivativeservice/v2/regions/eu/manifest/' : '/derivativeservice/v2/manifest/';
      const legacy = await apiJson(context, endpoint + target.urn, { signal, recoverDead });
      if (legacy.urn !== undefined && legacy.urn !== target.urn && legacy.urn !== target.objectId) fail('IDENTITY_MISMATCH');
      records = flatten(legacy);
      candidates = records.filter(({ value, ancestors }) => value.mime === 'application/autodesk-svf' && typeof value.urn === 'string' && (value.role === '3d' || ancestors.some(parent => parent.role === '3d')));
      manifest = legacy;
    }
    const status = ['pending', 'inprogress', 'success', 'failed'].includes(manifest.status) ? manifest.status : manifest.status === 'timeout' ? 'failed' : null;
    if (!status) fail('PROVIDER_RESPONSE_INVALID');
    if (candidates.length > 64) fail('PACKAGE_LIMIT_EXCEEDED');
    const roots = [], seenRootUrns = new Set();
    for (const record of candidates.filter(({ value }) => value.status === undefined || value.status === 'success')) {
      const urn = derivativeUrn(record.value.urn, context); if (!/\.svf$/i.test(urn)) fail('UNSUPPORTED_PROFILE');
      // Existing legacy manifests can expose the same SVF in several viewable
      // branches. One validated exact URN identifies one downloadable resource.
      if (seenRootUrns.has(urn)) continue;
      seenRootUrns.add(urn);
      roots.push({ rootId: 'aps-root-' + sha(urn), urn, ancestors: record.ancestors });
    }
    if (status === 'success' && roots.length === 0) fail('UNSUPPORTED_PROFILE');
    if (new Set(roots.map(root => root.rootId)).size !== roots.length) fail('PROVIDER_RESPONSE_INVALID');
    rootsByContext.set(context.submissionIdentity, { status, roots, records });
    return { status, roots, records };
  }
  async function signedResource(context, urn, signal, recoverDead) {
    derivativeUrn(urn, context);
    const response = await apiResponse(context, `/modelderivative/v2/designdata/${actual(context).urn}/manifest/${encodeURIComponent(urn)}/signedcookies`, { signal, recoverDead });
    const cookies = header(response, 'set-cookie');
    const value = await jsonResponse(response, signal);
    if (!positive(value.size) || value.size > RAW_CAP || !Number.isFinite(value.expiration) || value.expiration <= clock.now()) fail('PROVIDER_RESPONSE_INVALID');
    const url = checkedUrl(value.url).href;
    const parts = [];
    for (const item of Array.isArray(cookies) ? cookies : cookies ? [cookies] : []) {
      for (const match of String(item).matchAll(/(?:^|,\s*)(CloudFront-(?:Policy|Signature|Key-Pair-Id))=([^;\s,]+)(?:;|$)/g)) parts.push(match[1] + '=' + match[2]);
    }
    if (parts.length && (parts.length !== 3 || new Set(parts.map(part => part.split('=')[0])).size !== 3)) fail('PROVIDER_RESPONSE_INVALID');
    if (!parts.length) { const parsed = new URL(url); if (!['Policy', 'Signature', 'Key-Pair-Id'].every(key => parsed.searchParams.has(key))) fail('PROVIDER_RESPONSE_INVALID'); }
    return { url, bytes: value.size, expires: value.expiration, cookie: parts.join('; ') };
  }
  async function rawResponse(context, signed, signal, recoverDead) {
    await spendRead(context, signal, recoverDead);
    const url = checkedUrl(signed.url).href;
    const headers = { 'Accept-Encoding': 'identity' }; if (signed.cookie) headers.Cookie = signed.cookie;
    const response = await request({ url, method: 'GET', headers, signal, timeoutMs: TIMEOUT });
    // No arbitrary redirect/proxy is followed, and credentials never cross hosts.
    if (response?.statusCode !== 200) { destroy(response); throw privateError(response?.statusCode); }
    const length = header(response, 'content-length');
    if (length !== undefined && Number(length) !== signed.bytes) { destroy(response); fail('DOWNLOAD_INVALID'); }
    return response;
  }
  async function rawBytes(context, signed, signal, maxBytes, recoverDead) {
    const response = await rawResponse(context, signed, signal, recoverDead);
    return bufferBody(response.body, maxBytes, { signal, expectedBytes: signed.bytes });
  }
  const api = {
    kind: 'aps', mode: 'live',
    get calls() { return audit.map(entry => ({ ...entry })); },
    get counts() { return { ...Object.fromEntries(callNames.map(name => [name, audit.filter(entry => entry.operation === name).length])),
      totalRequests: audit.length, readRequests: audit.filter(entry => entry.method === 'GET' || entry.method === 'HEAD').length,
      cloudDataMutations: audit.filter(entry => entry.cloudDataMutation).length }; },
    async getStorage(context, { signal, recoverDead } = {}) {
      checkContext(context);
      let value; try { value = await apiJson(context, `/oss/v2/buckets/${encodeURIComponent(bucket)}/details`, { signal, recoverDead }); }
      catch (error) { if (error.httpStatus === 404) return null; throw error; }
      if (value.bucketKey !== bucket || value.bucketOwner !== clientId || !Array.isArray(value.permissions) || !value.permissions.some(item => item.authId === clientId && item.access === 'full')) fail('IDENTITY_MISMATCH');
      return { bucket: alias, namespace: { ...ns }, region };
    },
    async createStorage(context, options = {}) {
      checkContext(context); if (reuseOnly) fail('CLOUD_CLOSED');
      const value = await apiJson(context, '/oss/v2/buckets', { signal: options.signal, recoverDead: options.recoverDead, method: 'POST', body: { bucketKey: bucket, policyKey: 'persistent' }, mutateOptions: options, extraHeaders: { 'x-ads-region': region } });
      if (value.bucketKey !== bucket || value.bucketOwner !== clientId) fail('IDENTITY_MISMATCH');
      return { bucket: alias, namespace: { ...ns }, region };
    },
    async getObject(context, { signal, recoverDead } = {}) {
      const target = actual(context); let value;
      try { value = await apiJson(context, `/oss/v2/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(target.key)}/details`, { signal, recoverDead }); }
      catch (error) { if (error.httpStatus === 404) return null; throw error; }
      return objectReceipt(value, context, await hashSnapshot(context, signal));
    },
    async upload(context, options = {}) {
      const target = actual(context); if (reuseOnly) fail('CLOUD_CLOSED');
      const local = await hashSnapshot(context, options.signal), partBytes = 16 * 1024 * 1024, partCount = Math.ceil(local.bytes / partBytes);
      let uploadKey, urls = [], partNumber = 1; const h1 = createHash('sha1'), h256 = createHash('sha256'); let bytes = 0;
      while (partNumber <= partCount) {
        if (!urls.length) {
          let endpoint = `/oss/v2/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(target.key)}/signeds3upload?parts=${Math.min(25, partCount - partNumber + 1)}&firstPart=${partNumber}&minutesExpiration=10`;
          if (uploadKey) endpoint += '&uploadKey=' + encodeURIComponent(uploadKey);
          const signed = await apiJson(context, endpoint, { signal: options.signal, recoverDead: options.recoverDead, mutateOptions: options });
          if (typeof signed.uploadKey !== 'string' || !signed.uploadKey || !Array.isArray(signed.urls) || signed.urls.length !== Math.min(25, partCount - partNumber + 1) || uploadKey && signed.uploadKey !== uploadKey) fail('PROVIDER_RESPONSE_INVALID');
          uploadKey = signed.uploadKey; urls = signed.urls.map(value => checkedUrl(value, { upload: true }).href);
        }
        const start = (partNumber - 1) * partBytes, end = Math.min(local.bytes, start + partBytes) - 1;
        const chunks = []; let size = 0;
        for await (const chunk of createReadStream(local.source, { start, end, signal: options.signal })) { abortCheck(options.signal); chunks.push(chunk); size += chunk.length; }
        if (size !== end - start + 1) fail('SNAPSHOT_CHANGED');
        const part = Buffer.concat(chunks, size); bytes += size; h1.update(part); h256.update(part);
        const url = urls.shift(); mutationGuard(options);
        const response = await request({ url, method: 'PUT', headers: { 'Content-Length': String(size), 'Content-Type': 'application/octet-stream', 'Accept-Encoding': 'identity' }, body: part, signal: options.signal, timeoutMs: TIMEOUT });
        if (!Number.isInteger(response?.statusCode) || response.statusCode < 200 || response.statusCode > 299) { destroy(response); throw privateError(response?.statusCode); }
        await bufferBody(response.body ?? Buffer.alloc(0), JSON_CAP, { signal: options.signal }); partNumber++;
      }
      const sent = { bytes, sha1: h1.digest('hex'), sha256: h256.digest('hex') };
      if (sent.bytes !== local.bytes || sent.sha1 !== local.sha1 || sent.sha256 !== context.source.sha256) fail('SNAPSHOT_CHANGED');
      const value = await apiJson(context, `/oss/v2/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(target.key)}/signeds3upload`, { signal: options.signal, recoverDead: options.recoverDead, method: 'POST', body: { uploadKey }, mutateOptions: options, extraHeaders: { 'x-ads-meta-Content-Type': 'application/octet-stream' } });
      return objectReceipt(value, context, sent);
    },
    async submit(context, options = {}) {
      const target = actual(context); if (reuseOnly) fail('CLOUD_CLOSED');
      if (options.xAdsForce !== false) fail('UNSUPPORTED_PROFILE'); identifier(options.attemptId, 'INVALID_JOB');
      const body = { input: { urn: target.urn }, output: { destination: { region }, formats: [{ type: 'svf', views: ['3d'] }] } };
      const value = await apiJson(context, '/modelderivative/v2/designdata/job', { signal: options.signal, recoverDead: options.recoverDead, method: 'POST', body, mutateOptions: options, extraHeaders: { 'x-ads-force': 'false' } });
      const formats = value.acceptedJobs?.output?.formats, format = formats?.[0], destination = value.acceptedJobs?.output?.destination;
      if (!['success', 'created'].includes(value.result) || value.urn !== target.urn
        || !Array.isArray(formats) || formats.length !== 1 || !format || typeof format !== 'object' || Array.isArray(format)
        || Object.keys(format).some(key => !['type', 'views'].includes(key)) || format.type !== 'svf'
        || !Array.isArray(format.views) || format.views.length !== 1 || format.views[0] !== '3d'
        || destination !== undefined && (!destination || typeof destination !== 'object' || Array.isArray(destination) || Object.keys(destination).some(key => key !== 'region') || destination.region !== region)) fail('PROVIDER_RESPONSE_INVALID');
      return { result: value.result, objectId: context.objectId, urn: context.urn, submissionIdentity: context.submissionIdentity,
        providerReceipt: { kind: 'aps-job-response', remoteUrnHash: sha(value.urn), format: 'svf', views: ['3d'], responseSha256: sha(JSON.stringify(value)) } };
    },
    async getManifest(context, options = {}) {
      const value = await manifestRecord(context, options);
      return { status: value.status, objectId: context.objectId, urn: context.urn, submissionIdentity: context.submissionIdentity,
        roots: value.roots.map(root => ({ rootId: root.rootId, format: 'svf', supportProfile: PROFILE })) };
    },
    async getDownloadPlan(context, { rootId, signal, recoverDead } = {}) {
      const manifest = await manifestRecord(context, { signal, recoverDead }); if (manifest.status !== 'success') fail(manifest.status === 'failed' ? 'DERIVATIVE_FAILED' : 'DERIVATIVE_PENDING');
      if (rootId === undefined && manifest.roots.length !== 1) fail('DERIVATIVE_AMBIGUOUS');
      const root = rootId === undefined ? manifest.roots[0] : manifest.roots.find(item => item.rootId === rootId);
      if (!root) fail('DERIVATIVE_AMBIGUOUS');
      const directory = root.urn.slice(0, root.urn.lastIndexOf('/') + 1), signed = await signedResource(context, root.urn, signal, recoverDead);
      const cap = packageApi.DEFAULT_LIMITS?.maxNestedBytes ?? 256 * 1024 * 1024;
      if (signed.bytes > cap) fail('PACKAGE_LIMIT_EXCEEDED');
      const raw = await rawBytes(context, signed, signal, cap, recoverDead);
      let inspected;
      try { inspected = await packageApi.inspectSvfEnvelope(raw, { signal }); }
      catch (error) {
        abortCheck(signal);
        fail(error?.code === 'UNSUPPORTED_PROFILE' ? 'UNSUPPORTED_PROFILE' : error?.code === 'PACKAGE_LIMIT_EXCEEDED' ? 'PACKAGE_LIMIT_EXCEEDED' : 'DOWNLOAD_INVALID');
      }
      if (inspected.supportProfile !== PROFILE || inspected.resourceClosureVerified !== false || !Array.isArray(inspected.resources)) fail('UNSUPPORTED_PROFILE');
      const properties = manifest.records.filter(({ value }) => value.role === 'Autodesk.CloudPlatform.PropertyDatabase' && value.mime === 'application/autodesk-db' && typeof value.urn === 'string' && (value.status === undefined || value.status === 'success'));
      const nearby = properties.filter(({ value }) => value.urn.startsWith(directory));
      const candidates = [...new Map((nearby.length ? nearby : properties).map(record => [derivativeUrn(record.value.urn, context), record])).values()];
      if (candidates.length !== 1) fail(candidates.length === 0 ? 'DOWNLOAD_INCOMPLETE' : 'DERIVATIVE_AMBIGUOUS');
      const propertyUrn = derivativeUrn(candidates[0].value.urn, context);
      const privateRecords = new Map(), records = [];
      let total = 0;
      async function record(resourcePath, urn, declaredBytes, cached) {
        const sign = cached ? signed : await signedResource(context, urn, signal, recoverDead);
        if (declaredBytes !== undefined && sign.bytes !== declaredBytes) fail('DOWNLOAD_INVALID');
        total += sign.bytes; if (total > TOTAL_CAP || records.length >= 100000) fail('PACKAGE_LIMIT_EXCEEDED');
        const resourceId = 'aps-resource-' + sha(urn);
        if (privateRecords.has(resourceId) || records.some(item => item.path === resourcePath)) fail('DOWNLOAD_INVALID');
        privateRecords.set(resourceId, { urn, signed: sign, bytes: sign.bytes, ...(cached ? { cached } : {}) });
        records.push({ path: resourcePath, resourceId, bytes: sign.bytes, ...(cached ? { sha256: sha(cached) } : {}) });
      }
      await record('output/0/0.svf', root.urn, raw.length, raw);
      for (const item of inspected.resources) {
        if (!/^output\/0\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(item.path) || !positive(item.bytes)) fail('UNSUPPORTED_PROFILE');
        const urn = derivativeUrn(directory + item.path.slice('output/0/'.length), context);
        await record(item.path, urn, item.bytes);
      }
      await record('output/0/properties.db', propertyUrn);
      records.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      plansByContext.set(context.submissionIdentity, privateRecords);
      return { schemaVersion: 1, submissionIdentity: context.submissionIdentity, objectId: context.objectId, urn: context.urn,
        region, rootId: root.rootId, supportProfile: PROFILE, resources: records };
    },
    async *readResource(context, { resourceId, signal, recoverDead } = {}) {
      checkContext(context); identifier(resourceId, 'DOWNLOAD_INVALID');
      const record = plansByContext.get(context.submissionIdentity)?.get(resourceId); if (!record) fail('DOWNLOAD_INVALID');
      if (record.cached) { abortCheck(signal); yield Buffer.from(record.cached); return; }
      for (let attempt = 0; attempt < 2; attempt++) {
        if (record.signed.expires <= clock.now() + 1000 || attempt) record.signed = await signedResource(context, record.urn, signal, recoverDead);
        if (record.signed.bytes !== record.bytes) fail('DOWNLOAD_PLAN_CHANGED');
        let response;
        try { response = await rawResponse(context, record.signed, signal, recoverDead); }
        catch (error) { if (error.httpStatus === 403 && attempt === 0) continue; throw error; }
        yield* boundedBody(response.body, RAW_CAP, { signal, expectedBytes: record.bytes }); return;
      }
    },
  };
  return Object.freeze(brandAPSProvider(api));
}
