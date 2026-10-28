import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createProducerFrameDecoder, encodeProducerFrame, validateProducerMessage, PRODUCER_WIRE_VERSION } from './producer-process.mjs';
import { assertSafeBrowserArguments } from './sandbox-probe.mjs';
import { PRODUCER_LIMITS } from './container-profile.mjs';

export const MANAGED_RUNNER_LIMITS = Object.freeze({ chunkBytes: 65536, responseMilliseconds: 30000,
  pendingResources: 16, resourceRequests: 50000, resourceBytes: 4 * 1024 ** 3,
  commands: 4096, queuedCommands: 16, assetBytes: 100 * 1024 ** 2, assetFiles: 256,
  disposeMilliseconds: 5000, closeMilliseconds: 10000, joinMilliseconds: 5000 });
const SDK = '7.130.0', ROOT = '/viewer-runtime/7.130.0/';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$(?![\s\S])/;
const SHA = /^[a-f0-9]{64}$(?![\s\S])/;
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key) && !Object.getOwnPropertyDescriptor(value, key)?.get && !Object.getOwnPropertyDescriptor(value, key)?.set);
const fail = code => Object.assign(new Error(code), { code });
const need = (condition, code) => { if (!condition) throw fail(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safeCode = error => typeof error?.code === 'string' && /^PRODUCER_[A-Z0-9_]{1,95}$/.test(error.code) ? error.code : 'PRODUCER_RUNNER_FAILED';
/** The publisher includes its signed vendor manifest beside the 206 SDK files.
 * Verify that manifest separately; its bytes are not part of sdkBytes. */
export function validateManagedSdkInventory(files){
  need(Array.isArray(files),'PRODUCER_RUNTIME_INVENTORY_INVALID');
  const manifest=files.filter(file=>file.path==='sdk/vendor-manifest.json'),sdk=files.filter(file=>file.path.startsWith('sdk/')&&file.path!=='sdk/vendor-manifest.json');
  need(manifest.length===1&&manifest[0].sha256==='747540a153fb18809c428d8ed177aa8a296cff1b5175ab85445e0a2ebdb36d75'&&manifest[0].bytes===166375&&
    sdk.length===206&&sdk.every(file=>Number.isSafeInteger(file.bytes)&&file.bytes>=0)&&sdk.reduce((sum,file)=>sum+file.bytes,0)===82552768,'PRODUCER_RUNTIME_INVENTORY_INVALID');
  return{sdkFiles:sdk.length,sdkBytes:82552768};
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => undefined); return { promise, resolve, reject }; };
const bounded = async (work, milliseconds, code) => {
  let timer;
  try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimeout(() => reject(fail(code)), milliseconds); timer.unref?.(); })]); }
  finally { clearTimeout(timer); }
};
const identityKeys = ['instanceId', 'projectId', 'modelVersionId', 'loadId', 'sessionId'];

export function validateManagedIdentity(input) {
  need(exact(input, identityKeys) && identityKeys.every(key => typeof input[key] === 'string' && UUID.test(input[key])), 'PRODUCER_INITIALIZE_INVALID');
  return Object.freeze({ ...input });
}
export function validateManagedInitialize(input) {
  need(exact(input, ['kind', 'identity', 'runtimeInventorySha256']) && input.kind === 'initialize' && SHA.test(input.runtimeInventorySha256 ?? ''), 'PRODUCER_INITIALIZE_INVALID');
  return { kind: 'initialize', identity: validateManagedIdentity(input.identity), runtimeInventorySha256: input.runtimeInventorySha256 };
}

/** The raw target must remain canonical before URL parsing can normalize it. */
export function classifyManagedRequest(raw, identity, origin, assets) {
  need(typeof raw === 'string' && raw.length <= 4096 && raw.startsWith('/') && !raw.startsWith('//') && !/[#\\\u0000-\u0020\u007f]/.test(raw), 'PRODUCER_HTTP_PATH_REFUSED');
  const at = raw.indexOf('?'), pathname = at < 0 ? raw : raw.slice(0, at), query = at < 0 ? null : raw.slice(at + 1);
  let decoded;
  try { decoded = pathname.split('/').map(segment => decodeURIComponent(segment)); } catch { throw fail('PRODUCER_HTTP_PATH_REFUSED'); }
  need(!decoded.slice(1).some(segment => !segment || segment === '.' || segment === '..' || /[%/\\\u0000-\u001f\u007f]/.test(segment)) && decoded.map(segment => encodeURIComponent(segment)).join('/') === pathname, 'PRODUCER_HTTP_PATH_REFUSED');
  if (pathname.startsWith(ROOT)) {
    const relative = decoded.join('/').slice(ROOT.length);
    need(assets.has(relative), 'PRODUCER_HTTP_PATH_REFUSED');
    if (relative === 'producer.html') {
      const expected = `instanceId=${identity.instanceId}&projectId=${identity.projectId}`;
      need(query === expected, 'PRODUCER_HTTP_PATH_REFUSED');
    } else need(query === null, 'PRODUCER_HTTP_PATH_REFUSED');
    return { kind: 'asset', relative };
  }
  const prefix = `/api/projects/${identity.projectId}/model-versions/${identity.modelVersionId}/producer-sessions/${identity.sessionId}/`;
  need(pathname.startsWith(prefix), 'PRODUCER_HTTP_PATH_REFUSED');
  const suffix = pathname.slice(prefix.length), resource = suffix.startsWith('resources/') && suffix.length > 'resources/'.length;
  need(resource || ['descriptor', 'pathfinder-authorization'].includes(suffix), 'PRODUCER_HTTP_PATH_REFUSED');
  if (query !== null) {
    const params = new URLSearchParams(query);
    need(resource && params.size === 1 && params.getAll('domain').length === 1 && params.get('domain') === origin, 'PRODUCER_HTTP_PATH_REFUSED');
  }
  return { kind: 'resource', path: raw };
}

export function validateManagedRange(value) {
  need(value === null || typeof value === 'string' && value.length <= 96 && /^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$(?![\s\S])/.test(value), 'PRODUCER_HTTP_RANGE_REFUSED');
  if (value !== null) for (const number of value.slice(6).split('-').filter(Boolean)) need(Number.isSafeInteger(Number(number)), 'PRODUCER_HTTP_RANGE_REFUSED');
  return value;
}
const headerNames = new Set(['accept-ranges', 'content-type', 'content-length', 'content-range']);
export function validateManagedResourceResponse(input, request, previous = null) {
  need(exact(input, ['status', 'headers', 'totalBytes', 'dataBase64', 'complete']) && Number.isInteger(input.status) &&
    [200, 206, 304, 400, 401, 403, 404, 405, 409, 410, 416, 429, 500, 502, 503, 507].includes(input.status) && plain(input.headers) &&
    Number.isSafeInteger(input.totalBytes) && input.totalBytes >= 0 && input.totalBytes <= MANAGED_RUNNER_LIMITS.resourceBytes && typeof input.complete === 'boolean' &&
    typeof input.dataBase64 === 'string' && input.dataBase64.length <= Math.ceil(request.length / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.dataBase64), 'PRODUCER_RESOURCE_RESPONSE_INVALID');
  for (const [name, value] of Object.entries(input.headers)) {
    need(headerNames.has(name) && typeof value === 'string' && value.length <= 256 && /^[\x20-\x7e]*$/.test(value), 'PRODUCER_RESOURCE_HEADERS_REFUSED');
    if (name === 'content-length') need(/^(?:0|[1-9][0-9]{0,10})$/.test(value) && Number(value) <= MANAGED_RUNNER_LIMITS.resourceBytes, 'PRODUCER_RESOURCE_HEADERS_REFUSED');
    if (name === 'accept-ranges') need(value === 'bytes', 'PRODUCER_RESOURCE_HEADERS_REFUSED');
    if (name === 'content-type') need(['application/octet-stream', 'application/json', 'application/json; charset=utf-8'].includes(value.toLowerCase()), 'PRODUCER_RESOURCE_HEADERS_REFUSED');
    if (name === 'content-range') need(/^bytes (?:(?:[0-9]+-[0-9]+)|\*)\/[0-9]+$/.test(value), 'PRODUCER_RESOURCE_HEADERS_REFUSED');
  }
  const bytes = Buffer.from(input.dataBase64, 'base64');
  need(bytes.toString('base64') === input.dataBase64 && bytes.length <= request.length && request.offset + bytes.length <= input.totalBytes &&
    input.complete === (request.offset + bytes.length === input.totalBytes) && (input.complete || bytes.length === request.length), 'PRODUCER_RESOURCE_RESPONSE_INVALID');
  need(request.method !== 'HEAD' || input.totalBytes === 0 && bytes.length === 0 && input.complete, 'PRODUCER_RESOURCE_RESPONSE_INVALID');
  need(input.status !== 304 || input.totalBytes === 0 && bytes.length === 0 && input.complete, 'PRODUCER_RESOURCE_RESPONSE_INVALID');
  if (request.method === 'GET' && input.headers['content-length'] !== undefined) need(Number(input.headers['content-length']) === input.totalBytes, 'PRODUCER_RESOURCE_HEADERS_REFUSED');
  if (previous) need(input.status === previous.status && input.totalBytes === previous.totalBytes &&
    JSON.stringify(Object.entries(input.headers).sort()) === JSON.stringify(Object.entries(previous.headers).sort()), 'PRODUCER_RESOURCE_RESPONSE_CHANGED');
  return { status: input.status, headers: { ...input.headers }, totalBytes: input.totalBytes, complete: input.complete, bytes };
}

/** One sequential chunk stream per HTTP request. No resource body is aggregated. */
export function createManagedResourceRelay({ rpc, identity, origin, assets, signal }) {
  let active = 0, requests = 0, bytes = 0, stopped = false;
  return {
    get snapshot() { return Object.freeze({ active, requests, bytes, stopped }); },
    stop() { stopped = true; },
    async serve(req, res) {
      need(!stopped && !signal?.aborted && active < MANAGED_RUNNER_LIMITS.pendingResources, 'PRODUCER_RESOURCE_CONCURRENCY');
      need(['GET', 'HEAD'].includes(req.method), 'PRODUCER_HTTP_METHOD_REFUSED');
      need(classifyManagedRequest(req.url, identity, origin, assets).kind === 'resource', 'PRODUCER_HTTP_PATH_REFUSED');
      const range = validateManagedRange(req.headers.range ?? null), requestId = randomUUID();
      active++;
      try {
        let offset = 0, previous = null;
        do {
          need(!stopped && !signal?.aborted && !res.destroyed && ++requests <= MANAGED_RUNNER_LIMITS.resourceRequests, 'PRODUCER_RESOURCE_BUDGET');
          const request = { kind: 'resource', method: req.method, path: req.url, range, offset, length: MANAGED_RUNNER_LIMITS.chunkBytes };
          const value = validateManagedResourceResponse(await rpc(requestId, request), request, previous);
          need(bytes + value.bytes.length <= MANAGED_RUNNER_LIMITS.resourceBytes, 'PRODUCER_RESOURCE_BUDGET');
          bytes += value.bytes.length;
          if (!previous) {
            res.writeHead(value.status, { ...value.headers, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' });
          }
          if (value.bytes.length && !res.write(value.bytes)) await bounded(() => once(res, 'drain', { signal }), MANAGED_RUNNER_LIMITS.responseMilliseconds, 'PRODUCER_HTTP_DRAIN_TIMEOUT');
          previous = value; offset += value.bytes.length;
          if (value.complete) { res.end(); return; }
        } while (true);
      } finally { active--; }
    },
  };
}

async function checkedAsset(root, relative, expected) {
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    need(!stat.isSymbolicLink() && await fs.realpath(current) === current, 'PRODUCER_RUNTIME_PATH_UNSAFE');
  }
  const handle = await fs.open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    need(before.isFile() && before.nlink === 1n && before.size === BigInt(expected.bytes), 'PRODUCER_RUNTIME_INTEGRITY');
    const bytes = await handle.readFile(), after = await handle.stat({ bigint: true });
    need(bytes.length === expected.bytes && hash(bytes) === expected.sha256 && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key]), 'PRODUCER_RUNTIME_INTEGRITY');
    return bytes;
  } finally { await handle.close(); }
}

/** The root is fixed by this installed module; neither wire input nor CLI can choose it. */
export async function loadManagedRuntime(expectedSha256) {
  need(SHA.test(expectedSha256 ?? ''), 'PRODUCER_RUNTIME_PIN_REQUIRED');
  const root = fileURLToPath(new URL('./viewer-runtime/7.130.0/', import.meta.url)).replace(/[\\/]$/, '');
  need(await fs.realpath(root) === root && !(await fs.lstat(root)).isSymbolicLink(), 'PRODUCER_RUNTIME_PATH_UNSAFE');
  const inventoryPath = path.join(root, 'runtime-inventory.json'), stat = await fs.lstat(inventoryPath);
  need(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size > 0 && stat.size <= 512 * 1024, 'PRODUCER_RUNTIME_INTEGRITY');
  const raw = await checkedAsset(root, 'runtime-inventory.json', { bytes: stat.size, sha256: expectedSha256 });
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { throw fail('PRODUCER_RUNTIME_INVENTORY_INVALID'); }
  need(plain(value) && value.schemaVersion === 1 && value.sdkVersion === SDK && value.vendorManifestSha256 === '747540a153fb18809c428d8ed177aa8a296cff1b5175ab85445e0a2ebdb36d75' &&
    value.sdkFileCount === 206 && value.sdkBytes === 82552768 && Array.isArray(value.files) && value.fileCount === value.files.length && value.fileCount >= 200 && value.fileCount <= MANAGED_RUNNER_LIMITS.assetFiles &&
    Number.isSafeInteger(value.totalBytes) && value.totalBytes > 0 && value.totalBytes <= MANAGED_RUNNER_LIMITS.assetBytes, 'PRODUCER_RUNTIME_INVENTORY_INVALID');
  validateManagedSdkInventory(value.files);
  const files = new Map(); let total = 0;
  for (const item of value.files) {
    need(exact(item, ['path', 'bytes', 'sha256']) && typeof item.path === 'string' && item.path.length <= 256 && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(item.path) &&
      !item.path.split('/').some(part => part === '.' || part === '..') && !files.has(item.path) && Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= MANAGED_RUNNER_LIMITS.assetBytes && SHA.test(item.sha256 ?? ''), 'PRODUCER_RUNTIME_INVENTORY_INVALID');
    total += item.bytes; need(total <= MANAGED_RUNNER_LIMITS.assetBytes, 'PRODUCER_RUNTIME_INVENTORY_INVALID');
    files.set(item.path, { bytes: await checkedAsset(root, item.path, item), sha256: item.sha256 });
  }
  need(total === value.totalBytes && ['producer-host.html', 'producer-host.mjs', 'producer.html', 'producer-frame.mjs', 'protocol.mjs'].every(name => files.has(name)), 'PRODUCER_RUNTIME_INVENTORY_INVALID');
  const found = new Set();
  const walk = async (directory, prefix = '') => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      need(!entry.isSymbolicLink(), 'PRODUCER_RUNTIME_PATH_UNSAFE');
      if (entry.isDirectory()) { need([...files.keys()].some(name => name.startsWith(relative + '/')), 'PRODUCER_RUNTIME_UNLISTED_FILE'); await walk(path.join(directory, entry.name), relative + '/'); }
      else { need(entry.isFile() && (files.has(relative) || relative === 'runtime-inventory.json'), 'PRODUCER_RUNTIME_UNLISTED_FILE'); found.add(relative); }
    }
  };
  await walk(root); need(found.size === files.size + 1, 'PRODUCER_RUNTIME_INTEGRITY');
  const protocol = await import(pathToFileURL(path.join(root, 'protocol.mjs')).href);
  need(protocol.SDK_VERSION === SDK && typeof protocol.validateEnvelope === 'function', 'PRODUCER_RUNTIME_PROTOCOL_INVALID');
  return { files, validateEnvelope: protocol.validateEnvelope, inventorySha256: expectedSha256 };
}

async function processRows() {
  const names = (await fs.readdir('/proc')).filter(value => /^[1-9][0-9]*$/.test(value));
  need(names.length <= PRODUCER_LIMITS.pids, 'PRODUCER_BROWSER_PID_LIMIT');
  const rows = [];
  for (const name of names) {
    try {
      const [stat, argv] = await Promise.all([fs.readFile(`/proc/${name}/stat`, 'utf8'), fs.readFile(`/proc/${name}/cmdline`)]);
      need(stat.length <= 65536 && argv.length <= 65536, 'PRODUCER_BROWSER_PROC_LIMIT');
      rows.push({ pid: Number(name), start: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], argv: argv.toString('utf8').split('\0').filter(Boolean) });
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error?.code)) throw error; }
  }
  return rows;
}
const contentType = relative => relative.endsWith('.html') ? 'text/html; charset=utf-8' : /\.(?:mjs|js)$/.test(relative) ? 'application/javascript; charset=utf-8' : relative.endsWith('.css') ? 'text/css; charset=utf-8' : relative.endsWith('.json') ? 'application/json; charset=utf-8' : relative.endsWith('.svg') ? 'image/svg+xml' : relative.endsWith('.png') ? 'image/png' : relative.endsWith('.woff') ? 'font/woff' : 'application/octet-stream';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Fixed browser/HTTP implementation. Dependency injection is available only at
 * createManagedRunner's trusted source boundary, never over the wire. */
async function openManagedBrowser({ configuration, rpc, signal }) {
  const runtime = await loadManagedRuntime(configuration.runtimeInventorySha256).catch(error=>{if(safeCode(error)!=='PRODUCER_RUNNER_FAILED')throw error;throw fail('PRODUCER_RUNTIME_LOAD_FAILED');});
  need(process.platform === 'linux' && process.getuid?.() === 1000 && process.getgid?.() === 1000, 'PRODUCER_BROWSER_USER');
  const package_ = JSON.parse(await fs.readFile(fileURLToPath(new URL('./node_modules/playwright-core/package.json', import.meta.url)), 'utf8'));
  need(package_.version === '1.64.0', 'PRODUCER_BROWSER_PACKAGE_VERSION');
  const { chromium } = await import('playwright-core');
  const before = new Map((await processRows()).map(row => [row.pid, row.start]));
  let browser, context, page, relay, origin, closing, closed = false,openingStage='PRODUCER_HTTP_LISTEN_FAILED';
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 30000, headersTimeout: 10000 }, (req, res) => {
    void (async () => {
      need(!closed && !signal.aborted && ['GET', 'HEAD'].includes(req.method) && req.headers.host === new URL(origin).host &&
        !Object.keys(req.headers).some(name => /(?:cookie|authorization|proxy)/i.test(name)) && req.headers['content-length'] === undefined && req.headers['transfer-encoding'] === undefined, 'PRODUCER_HTTP_REQUEST_REFUSED');
      const target = classifyManagedRequest(req.url, configuration.identity, origin, runtime.files);
      if (target.kind === 'resource') { await relay.serve(req, res); return; }
      const file = runtime.files.get(target.relative);
      res.writeHead(200, { 'content-type': contentType(target.relative), 'content-length': file.bytes.length, 'cache-control': 'no-store',
        'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin', 'referrer-policy': 'same-origin' });
      res.end(req.method === 'HEAD' ? undefined : file.bytes);
    })().catch(() => { if (res.headersSent) res.destroy(); else { res.writeHead(502, { 'cache-control': 'no-store', 'content-length': 0 }); res.end(); } });
  });
  server.maxConnections = 32; server.keepAliveTimeout = 1000;
  server.on('upgrade', (_req, socket) => socket.destroy());
  const close = () => {
    if (closing) return closing; closed = true; relay?.stop();
    closing = (async () => {
      let cause;
      try { if (page && !page.isClosed()) await bounded(() => page.evaluate(() => window.wfcManagedPreparation.dispose()), MANAGED_RUNNER_LIMITS.disposeMilliseconds, 'PRODUCER_DISPOSE_UNKNOWN'); }
      catch (error) { cause = error; }
      if (context) void context.close().catch(() => undefined);
      try { if (browser) await bounded(() => browser.close(), MANAGED_RUNNER_LIMITS.closeMilliseconds, 'PRODUCER_BROWSER_CLOSE_UNKNOWN'); }
      catch (error) { cause ??= error; }
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      const until = Date.now() + MANAGED_RUNNER_LIMITS.joinMilliseconds;
      let remaining;
      do {
        remaining = (await processRows()).filter(row => row.pid !== process.pid && before.get(row.pid) !== row.start);
        if (!remaining.length) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (Date.now() < until);
      need(!remaining.length, 'PRODUCER_BROWSER_JOIN_UNKNOWN');
      if (cause) throw cause;
    })();
    return closing;
  };
  try {
    // Each helper has its own network-none namespace. A fixed internal port
    // pins the broker origin without accepting a caller-supplied origin.
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(41733, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
    relay = createManagedResourceRelay({ rpc, identity: configuration.identity, origin, assets: runtime.files, signal });
    openingStage='PRODUCER_BROWSER_LAUNCH_FAILED';
    browser = await chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true, timeout: 45000,
      ignoreDefaultArgs: ['--disable-dev-shm-usage'], args: ['--disable-background-networking', '--disable-quic', '--no-first-run', '--no-default-browser-check', '--lang=en-US'] });
    openingStage='PRODUCER_BROWSER_PROCESS_CHECK_FAILED';
    const owned = (await processRows()).filter(row => row.pid !== process.pid && before.get(row.pid) !== row.start);
    need(owned.length > 0 && owned.some(row => row.argv.includes('--remote-debugging-pipe')), 'PRODUCER_BROWSER_PROCESS_EVIDENCE');
    owned.forEach(row => assertSafeBrowserArguments(row.argv));
    openingStage='PRODUCER_BROWSER_CONTEXT_FAILED';
    context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', permissions: [], viewport: { width: 320, height: 240 }, deviceScaleFactor: 1 });
    await context.route('**/*', route => {
      try {
        const request = route.request(), value = new URL(request.url());
        need(value.origin === origin && ['GET', 'HEAD'].includes(request.method()), 'PRODUCER_BROWSER_REQUEST_REFUSED');
        classifyManagedRequest(value.pathname + value.search, configuration.identity, origin, runtime.files);
        return route.continue();
      } catch { return route.abort('blockedbyclient'); }
    });
    need(typeof context.routeWebSocket === 'function', 'PRODUCER_BROWSER_WEBSOCKET_GUARD');
    await context.routeWebSocket('**/*', socket => socket.close({ code: 1008, reason: 'Unavailable' }));
    context.on('page', popup => { if (page && popup !== page) void popup.close().catch(() => undefined); });
    page = await context.newPage();
    openingStage='PRODUCER_HOST_PAGE_FAILED';
    await page.goto(origin + ROOT + 'producer-host.html', { waitUntil: 'load', timeout: 45000 });
    return {
      validateEnvelope: runtime.validateEnvelope,
      initialize: async identity => {
        const result=await page.evaluate(value=>window.wfcManagedPreparation.initialize(value).catch(error=>({schemaVersion:'wfc.pf.producer-initialize-failure.v1',code:typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)?error.code:'FRAME_INITIALIZE_FAILED'})),identity);
        if(result?.schemaVersion==='wfc.pf.producer-initialize-failure.v1')throw fail('PRODUCER_FRAME_'+result.code);
        return result;
      },
      exchange: envelope => page.evaluate(value => window.wfcManagedPreparation.exchange(value), envelope),
      close,
      snapshot: () => ({ runtimeInventorySha256: runtime.inventorySha256, browserVersion: browser.version(), resources: relay.snapshot }),
    };
  } catch (error) { try { await close(); } catch (cleanup) { throw cleanup; } if(safeCode(error)==='PRODUCER_RUNNER_FAILED')throw fail(openingStage);throw error; }
}

/** All response frames are dispatched immediately. A model initialization can
 * therefore await resource RPC without blocking its own stdin responses. */
export function createManagedRunner({ attemptId, emit, open = openManagedBrowser }) {
  need(UUID.test(attemptId ?? '') && typeof emit === 'function' && typeof open === 'function', 'PRODUCER_RUNNER_CONFIGURATION');
  let incoming = 0, outgoing = 0, state = 'waiting', configuration, handle, opening, running = false, stopping, commandCount = 0;
  const controller = new AbortController(), queue = [], used = new Set(), pending = new Map(), settled = deferred();
  const send = (type, requestId, payload) => emit({ schemaVersion: PRODUCER_WIRE_VERSION, attemptId, sequence: outgoing++, type, requestId, payload });
  const rpc = (requestId, payload) => {
    need(!controller.signal.aborted && pending.size < MANAGED_RUNNER_LIMITS.pendingResources && !pending.has(requestId), 'PRODUCER_RESOURCE_CONCURRENCY');
    const result = deferred(), timer = setTimeout(() => { pending.delete(requestId); result.reject(fail('PRODUCER_RESOURCE_TIMEOUT')); }, MANAGED_RUNNER_LIMITS.responseMilliseconds);
    timer.unref?.(); pending.set(requestId, { ...result, timer });
    try { Promise.resolve(send('request', requestId, payload)).catch(error => { clearTimeout(timer); pending.delete(requestId); result.reject(error); }); }
    catch (error) { clearTimeout(timer); pending.delete(requestId); result.reject(error); }
    return result.promise;
  };
  const finish = async (error = null) => {
    if (stopping) return stopping;
    state = 'closing'; controller.abort(); queue.length = 0;
    for (const value of pending.values()) { clearTimeout(value.timer); value.reject(fail('PRODUCER_CANCELLED')); } pending.clear();
    stopping = (async () => {
      let cause = error;
      try {
        // A close arriving during Chromium launch must join that launch before
        // claiming success. Inability to establish this is a refusal.
        if (opening && !handle) handle = await bounded(() => opening, PRODUCER_LIMITS.startupMilliseconds + 15000, 'PRODUCER_BROWSER_OPEN_UNKNOWN');
        if (handle) await handle.close();
      } catch (cleanup) { cause = cleanup; }
      if (cause) { state = 'failed'; await send('error', null, { status: 'FAIL', code: safeCode(cause) }); settled.reject(fail(safeCode(cause))); }
      else { state = 'closed'; await send('done', null, { status: 'PASS', scope: 'Managed capture session closed; no Review or Apply authority.', ...(handle ? { runtime: handle.snapshot() } : {}) }); settled.resolve(); }
    })();
    void stopping.catch(error_ => { state = 'failed'; settled.reject(fail(safeCode(error_))); });
    return stopping;
  };
  const pump = async () => {
    if (running) return; running = true;
    try {
      while (queue.length && !controller.signal.aborted) {
        const message = queue.shift(), value = message.payload;
        if (value?.kind === 'initialize') {
          need(state === 'waiting', 'PRODUCER_ALREADY_INITIALIZED'); configuration = validateManagedInitialize(value); state = 'initializing';
          opening = Promise.resolve().then(() => open({ configuration, rpc, signal: controller.signal }));
          handle = await opening;
          if (controller.signal.aborted) { await handle.close(); break; }
          const initialized = await handle.initialize(configuration.identity);
          need(exact(initialized, ['schemaVersion', ...identityKeys, 'sdkVersion']) && initialized.schemaVersion === 'wfc.pf.producer-host-ready.v1' && initialized.sdkVersion === SDK && identityKeys.every(key => initialized[key] === configuration.identity[key]), 'PRODUCER_INITIALIZE_RESPONSE_INVALID');
          if (controller.signal.aborted) break;
          state = 'ready'; await send('response', message.requestId, { kind: 'initialized', value: initialized });
        } else {
          need(state === 'ready' && exact(value, ['kind', 'envelope']) && value.kind === 'exchange', 'PRODUCER_EXCHANGE_REFUSED');
          const envelope = handle.validateEnvelope(value.envelope, 'parent-to-frame');
          need(envelope && ['READ_PREPARATION_OBJECTS', 'START_MODEL_CAPTURE', 'READ_MODEL_CAPTURE'].includes(envelope.type) && ['instanceId', 'projectId', 'modelVersionId', 'loadId'].every(key => envelope[key] === configuration.identity[key]), 'PRODUCER_EXCHANGE_REFUSED');
          const response = handle.validateEnvelope(await handle.exchange(envelope), 'frame-to-parent');
          need(response && response.requestId === envelope.requestId && ['instanceId', 'projectId', 'modelVersionId', 'loadId'].every(key => response[key] === configuration.identity[key]) &&
            ['PREPARATION_OBJECTS', 'MODEL_CAPTURE_INPUT_ACK', 'MODEL_CAPTURE_EVENT', 'ERROR'].includes(response.type), 'PRODUCER_EXCHANGE_RESPONSE_INVALID');
          if (!controller.signal.aborted) await send('response', message.requestId, { kind: 'exchange', envelope: response });
        }
      }
    } catch (error) { await finish(error); }
    finally { running = false; }
  };
  return {
    get snapshot() { return Object.freeze({ state, pendingResources: pending.size, queuedCommands: queue.length, commandCount }); },
    ready: () => send('ready', null, { kind: 'managed-runner', sdkVersion: SDK, protocolVersion: PRODUCER_WIRE_VERSION }),
    receive(raw) {
      try {
        const message = validateProducerMessage(raw);
        need(message.attemptId === attemptId && message.sequence === incoming++ && !['closed', 'failed'].includes(state), 'PRODUCER_WIRE_IDENTITY');
        if (message.type === 'response') {
          const entry = pending.get(message.requestId); need(entry && message.requestId !== null, 'PRODUCER_RESOURCE_RESPONSE_UNEXPECTED');
          pending.delete(message.requestId); clearTimeout(entry.timer); entry.resolve(message.payload); return;
        }
        if (message.type === 'cancel') { void finish(fail('PRODUCER_CANCELLED')); return; }
        if (message.type === 'close') { void finish(); return; }
        need(message.type === 'start' && UUID.test(message.requestId ?? '') && !used.has(message.requestId) && ++commandCount <= MANAGED_RUNNER_LIMITS.commands && queue.length < MANAGED_RUNNER_LIMITS.queuedCommands && !controller.signal.aborted, 'PRODUCER_COMMAND_REFUSED');
        used.add(message.requestId); queue.push(message); void pump();
      } catch (error) { void finish(error); }
    },
    cancel: () => finish(fail('PRODUCER_CANCELLED')),
    closed: settled.promise,
  };
}

async function main() {
  need(process.argv.length === 2, 'PRODUCER_RUNNER_ARGUMENTS');
  let writer = Promise.resolve();
  const emit = message => {
    const bytes = encodeProducerFrame(message);
    writer = writer.then(async () => { if (!process.stdout.write(bytes)) await once(process.stdout, 'drain'); }); return writer;
  };
  const runner = createManagedRunner({ attemptId: process.env.WFC_PRODUCER_ATTEMPT_ID, emit });
  const decoder = createProducerFrameDecoder(message => runner.receive(message));
  const cancel = () => { void runner.cancel(); };
  process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  const wall = setTimeout(cancel, PRODUCER_LIMITS.wallMilliseconds); wall.unref();
  process.stdin.on('data', bytes => { try { decoder.push(bytes); } catch { cancel(); } });
  process.stdin.once('end', () => { try { decoder.finish(); } catch { /* Truncation cannot become a successful session. */ } cancel(); });
  await runner.ready();
  try { await runner.closed; }
  catch { process.exitCode = 1; }
  finally { clearTimeout(wall); process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel); process.stdin.pause(); await writer.catch(() => undefined); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch(() => { process.exitCode = 1; });
