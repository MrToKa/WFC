import { createHash } from 'node:crypto';

/** Local read adapter; no login, mutation, model search or direct database access.
 * Contracts inspected at 83bb75e:
 * shared/pathfinderModelLocationMatch.ts (modelLocationMatchContextSchema)
 * shared/pathfinderEndpointBindings.ts (endpointBindingPageSchema/readiness)
 * server/pathfinder/modelLocationMatchRoutes.ts
 * server/pathfinder/endpointBindingRoutes.ts
 * server/pathfinder/endpointBindingRepository.ts (list/liveReadiness)
 *
 * An inventory is fenced by before/after model context and registry revisions.
 * This is optimistic consistency, not a server-side cross-request transaction.
 * Detailed cable rows and 3D geometry are deliberately outside this first stage.
 */
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const REVISION = /^(?:0|[1-9][0-9]{0,18})$/;
const CODE = /^[A-Z][A-Z0-9_]{0,95}$/;
const STATUSES = ['confirmed', 'suggested', 'missing', 'ambiguous', 'stale', 'unsupported-attachment'];
const MAX_LOCATIONS = 10_000;
const PAGE_SIZE = 100;
const normalize = value => value.normalize('NFC').trim().toUpperCase();
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

export class WfcReadError extends Error {
  constructor(code) { super(code); this.name = 'WfcReadError'; this.code = code; }
}
const fail = code => { throw new WfcReadError(code); };
const valid = condition => { if (!condition) fail('WFC_INVALID_RESPONSE'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && UUID.test(value);
const hash = value => typeof value === 'string' && HASH.test(value);
const revision = value => typeof value === 'string' && REVISION.test(value) && BigInt(value) <= 9223372036854775807n;
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const point = value => Array.isArray(value) && value.length === 3 && value.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9);
const timestamp = value => typeof value === 'string' && /Z$/.test(value) && Number.isFinite(Date.parse(value));
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max
  && value === value.normalize('NFC').trim() && value.isWellFormed() && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const keys = (value, required, optional = []) => valid(object(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
function names(value, maxLength = 500, maxCount = 4096) {
  valid(Array.isArray(value) && value.length <= maxCount && value.every(name => text(name, maxLength)));
  valid(new Set(value.map(normalize)).size === value.length);
}
function current(value) {
  keys(value, ['modelVersionId', 'selectionRevision', 'contentFingerprint', 'aggregateId', 'artifactId',
    'projectionSha256', 'captureFrameId', 'geometryRevision', 'traceId']);
  valid(['modelVersionId', 'aggregateId', 'artifactId', 'captureFrameId'].every(key => uuid(value[key]))
    && (value.traceId === null || uuid(value.traceId))
    && revision(value.selectionRevision) && revision(value.geometryRevision)
    && hash(value.contentFingerprint) && hash(value.projectionSha256));
}
function context(value, projectId) {
  keys(value, ['schemaVersion', 'projectId', 'current', 'registryRevision', 'names', 'namesSha256'], ['crossModelNames']);
  valid(value.schemaVersion === 'wfc.pf.model-location-match-context.v1' && value.projectId === projectId
    && revision(value.registryRevision) && hash(value.namesSha256));
  current(value.current); names(value.names, 256);
  if (value.crossModelNames !== undefined) names(value.crossModelNames, 256);
  const expectedHash = createHash('sha256').update(canonical(value.names.map(normalize).sort())).digest('hex');
  valid(value.namesSha256 === expectedHash);
  return value;
}
function row(value) {
  keys(value, ['location', 'head', 'readiness', 'usage']);
  const location = value.location;
  keys(location, ['id', 'name', 'aliases', 'revision']);
  valid(uuid(location.id) && text(location.name, 500) && revision(location.revision));
  names(location.aliases, 500, 100);
  valid(!location.aliases.some(alias => normalize(alias) === normalize(location.name)));
  const ready = value.readiness;
  keys(ready, ['status', 'calculationReady', 'reasonCodes']);
  valid(STATUSES.includes(ready.status) && typeof ready.calculationReady === 'boolean'
    && Array.isArray(ready.reasonCodes) && ready.reasonCodes.length <= 100
    && ready.reasonCodes.every(code => typeof code === 'string' && CODE.test(code))
    && new Set(ready.reasonCodes).size === ready.reasonCodes.length);
  valid(!ready.calculationReady || ready.status === 'confirmed' && ready.reasonCodes.length === 0);
  const usage = value.usage;
  keys(usage, ['fromOccurrences', 'toOccurrences', 'distinctCables']);
  valid(Object.values(usage).every(n => integer(n, 10_000_000)));
  const head = value.head;
  if (head !== null) {
    keys(head, ['id', 'bindingRevision', 'status', 'mode', 'pointProjectMetres', 'modelVersionId',
      'aggregateId', 'captureFrameId', 'sourceObjectRevisionId', 'confirmedBy', 'confirmedAt', 'contentSha256']);
    valid(uuid(head.id) && revision(head.bindingRevision) && STATUSES.includes(head.status)
      && ['fixed-world', 'object-derived', 'object-attached'].includes(head.mode) && point(head.pointProjectMetres)
      && ['modelVersionId', 'aggregateId', 'captureFrameId'].every(key => uuid(head[key]))
      && (head.sourceObjectRevisionId === null || uuid(head.sourceObjectRevisionId))
      && (head.confirmedBy === null || uuid(head.confirmedBy))
      && (head.confirmedAt === null || timestamp(head.confirmedAt)) && hash(head.contentSha256));
  }
  valid(!ready.calculationReady || head?.status === 'confirmed');
  return value;
}
function page(value, projectId, expectedOffset, expectedRevision) {
  keys(value, ['schemaVersion', 'projectId', 'registryRevision', 'offset', 'limit', 'total', 'nextOffset', 'locations']);
  valid(value.schemaVersion === 'wfc.pf.endpoint-binding-page.v1' && value.projectId === projectId
    && revision(value.registryRevision) && integer(value.offset, 1_000_000) && value.offset === expectedOffset
    && value.limit === PAGE_SIZE && integer(value.total, 1_000_000)
    && (value.nextOffset === null || integer(value.nextOffset, 1_000_000))
    && Array.isArray(value.locations) && value.locations.length <= PAGE_SIZE);
  if (value.registryRevision !== expectedRevision) fail('WFC_SNAPSHOT_CHANGED');
  if (value.total > MAX_LOCATIONS) fail('WFC_INVENTORY_LIMIT');
  valid(value.offset + value.locations.length <= value.total);
  valid(value.nextOffset === (value.offset + value.locations.length < value.total ? value.offset + value.locations.length : null));
  // An empty nonterminal page would otherwise loop indefinitely.
  valid(value.nextOffset === null || value.nextOffset > value.offset);
  value.locations.forEach(row);
  return value;
}

function base(value) {
  let parsed;
  try { parsed = new URL(value); } catch { fail('WFC_INVALID_CONFIG'); }
  const hostAllowed = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(parsed.hostname) && parsed.port === '5181'
    || parsed.hostname === 'wfc-test-app-api-1' && parsed.port === '4000';
  if (parsed.protocol !== 'http:' || !hostAllowed || parsed.username || parsed.password || parsed.search || parsed.hash
    || parsed.pathname !== '/') fail('WFC_INVALID_CONFIG');
  return parsed.origin;
}

async function boundedJson(response, signal, maximum) {
  if (!response.headers || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) fail('WFC_INVALID_RESPONSE');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^(?:0|[1-9][0-9]*)$/.test(length) || BigInt(length) > BigInt(maximum))) fail('WFC_RESPONSE_LIMIT');
  if (!response.body?.getReader) fail('WFC_INVALID_RESPONSE');
  const reader = response.body.getReader(), chunks = [];
  const cancelReader = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancelReader, { once: true });
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) fail('WFC_RESPONSE_LIMIT');
      chunks.push(value);
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
    catch { fail('WFC_INVALID_RESPONSE'); }
  } finally {
    // Cancel, rather than waiting for an untrusted oversized/stalled response.
    signal.removeEventListener('abort', cancelReader);
    cancelReader();
    reader.releaseLock();
  }
}

export function createWfcReadClient({ baseUrl, projectId, token, fetchImpl = fetch, timeoutMs = 15_000, maxResponseBytes = 4_000_000 } = {}) {
  const origin = base(baseUrl);
  if (!uuid(projectId) || typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 16_000_000) fail('WFC_INVALID_CONFIG');
  const prefix = `${origin}/api/projects/${projectId}/pathfinder`;
  return Object.freeze({ async inventory({ signal } = {}) {
    if (typeof token !== 'string' || !token.trim()) fail('WFC_AUTH_REQUIRED');
    if (!/^[\x21-\x7e]+$/.test(token) || token.length > 8192) fail('WFC_AUTH_REQUIRED');
    const abort = new AbortController();
    let timedOut = false;
    const cancel = () => abort.abort();
    if (signal?.aborted) fail('WFC_CANCELLED');
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
    let stop;
    const stopped = new Promise((_, reject) => {
      stop = () => reject(new WfcReadError(timedOut ? 'WFC_TIMEOUT' : 'WFC_CANCELLED'));
      abort.signal.addEventListener('abort', stop, { once: true });
    });
    async function get(suffix) {
      const request = (async () => {
        const response = await fetchImpl(prefix + suffix, { method: 'GET', redirect: 'error', cache: 'no-store',
          credentials: 'omit', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: abort.signal });
        if (response.status === 401) fail('WFC_AUTH_REQUIRED');
        if (response.status === 403) fail('WFC_FORBIDDEN');
        if (response.status !== 200 || response.redirected) fail('WFC_READ_FAILED');
        return boundedJson(response, abort.signal, maxResponseBytes);
      })();
      return Promise.race([request, stopped]);
    }
    try {
      const before = context(await get('/locations/model-match/context'), projectId);
      const locations = [], ids = new Set();
      let offset = 0, total = null;
      for (let count = 0; count < MAX_LOCATIONS / PAGE_SIZE + 1; count++) {
        const portion = page(await get(`/endpoint-bindings?offset=${offset}&limit=${PAGE_SIZE}`), projectId, offset, before.registryRevision);
        if (total !== null && portion.total !== total) fail('WFC_SNAPSHOT_CHANGED');
        total = portion.total;
        for (const item of portion.locations) {
          if (ids.has(item.location.id)) fail('WFC_INVALID_RESPONSE');
          ids.add(item.location.id); locations.push(item);
        }
        if (portion.nextOffset === null) break;
        offset = portion.nextOffset;
      }
      valid(locations.length === total);
      const after = context(await get('/locations/model-match/context'), projectId);
      if (canonical(before) !== canonical(after)) fail('WFC_SNAPSHOT_CHANGED');
      const aliases = new Map();
      for (const item of locations) {
        for (const name of [item.location.name, ...item.location.aliases]) {
          const key = normalize(name);
          if (aliases.has(key)) fail('WFC_INVALID_RESPONSE');
          aliases.set(key, item);
        }
      }
      const endpoints = before.names.map(name => {
        const item = aliases.get(normalize(name));
        const status = !item || !item.head || item.readiness.status === 'missing' ? 'missing'
          : item.readiness.calculationReady ? 'ready' : item.readiness.status === 'stale' ? 'obsolete' : 'unresolved';
        return { name, locationId: item?.location.id ?? null, status,
          reasonCodes: item ? [...item.readiness.reasonCodes] : ['ENDPOINT_LOCATION_NOT_REGISTERED'] };
      });
      const counts = { endpointNames: endpoints.length, registryLocations: locations.length, ready: 0, missing: 0, obsolete: 0, unresolved: 0 };
      endpoints.forEach(endpoint => counts[endpoint.status]++);
      return { schemaVersion: 'wfc.ai.wfc-inventory.v1', projectId, current: before.current,
        registryRevision: before.registryRevision, names: before.names, namesSha256: before.namesSha256,
        locations, endpoints, counts, snapshotStable: true, writesPerformed: 0, cableDetailsAvailable: false };
    } catch (error) {
      if (timedOut) fail('WFC_TIMEOUT');
      if (abort.signal.aborted) fail('WFC_CANCELLED');
      if (error instanceof WfcReadError) throw error;
      fail('WFC_READ_FAILED');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel); abort.signal.removeEventListener('abort', stop);
      abort.abort();
    }
  } });
}
