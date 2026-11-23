import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWfcReadClient } from '../lib/wfc-read.mjs';

// Synthetic fixtures follow the inspected WFC schemas, not real cable data.
const id = number => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
const projectId = 'da667921-1f13-4c1d-9f87-063d127b98ce';
const token = 'test-token-do-not-log';
const baseUrl = 'http://127.0.0.1:5181';
const current = {
  modelVersionId: id(1), selectionRevision: '2', contentFingerprint: 'a'.repeat(64),
  aggregateId: id(2), artifactId: id(3), projectionSha256: 'b'.repeat(64),
  captureFrameId: id(4), geometryRevision: '19', traceId: id(5),
};
function context(names = ['PUMP', 'PUMP PTC', 'VALVE OPEN', 'NO REGISTRY', 'AMBIGUOUS']) {
  const hashInput = names.map(name => name.normalize('NFC').trim().toUpperCase()).sort();
  return {
    schemaVersion: 'wfc.pf.model-location-match-context.v1', projectId, current: structuredClone(current),
    registryRevision: '12', names, namesSha256: createHash('sha256').update(JSON.stringify(hashInput)).digest('hex'),
  };
}
function location(number, name = `LOC-${number}`, status = 'confirmed') {
  return {
    location: { id: id(1000 + number), name, aliases: [], revision: '3' },
    head: status === 'missing' ? null : {
      id: id(2000 + number), bindingRevision: '2', status: status === 'stale' ? 'confirmed' : status,
      mode: 'fixed-world', pointProjectMetres: [1, 2, 3], modelVersionId: current.modelVersionId,
      aggregateId: current.aggregateId, captureFrameId: current.captureFrameId, sourceObjectRevisionId: null,
      confirmedBy: id(6), confirmedAt: '2026-11-20T19:00:00.000Z', contentSha256: 'c'.repeat(64),
    },
    readiness: { status, calculationReady: status === 'confirmed',
      reasonCodes: status === 'confirmed' ? [] : [status === 'stale' ? 'ENDPOINT_LOCATION_CHANGED'
        : status === 'missing' ? 'ENDPOINT_BINDING_REQUIRED' : 'ENDPOINT_BINDING_UNCONFIRMED'] },
    usage: { fromOccurrences: 1, toOccurrences: 2, distinctCables: 3 },
  };
}
function page(locations = [], { offset = 0, total = locations.length, nextOffset = null } = {}) {
  return { schemaVersion: 'wfc.pf.endpoint-binding-page.v1', projectId, registryRevision: '12',
    offset, limit: 100, total, nextOffset, locations };
}
const json = (value, options = {}) => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json' }, ...options,
});
function client(queue, options = {}) {
  const calls = [];
  const fetchImpl = async (url, request) => {
    calls.push({ url, request });
    assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'error');
    assert.equal(request.credentials, 'omit'); assert.equal(request.cache, 'no-store');
    assert.equal(request.headers.Authorization, `Bearer ${token}`);
    assert.equal(request.body, undefined);
    assert.match(url, new RegExp(`^http://127\\.0\\.0\\.1:5181/api/projects/${projectId}/pathfinder/`));
    assert.ok(url.endsWith('/locations/model-match/context') || /\/endpoint-bindings\?offset=\d+&limit=100$/.test(url));
    assert.ok(queue.length, 'unexpected request');
    const value = queue.shift();
    return typeof value === 'function' ? value(url, request) : value instanceof Response ? value : json(value);
  };
  return { adapter: createWfcReadClient({ baseUrl, projectId, token, fetchImpl, ...options }), calls };
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code && !error.message.includes(token));

test('inventory joins aliases without renaming; missing and obsolete use live readiness', async () => {
  const ctx = context();
  const pump = location(1, 'PUMP'); pump.location.aliases = ['PUMP PTC'];
  const valve = location(2, 'VALVE OPEN', 'stale'); // SAME model, obsolete because location revision changed.
  const ambiguous = location(3, 'AMBIGUOUS', 'ambiguous');
  const { adapter, calls } = client([ctx, page([pump, valve, ambiguous]), structuredClone(ctx)]);
  const result = await adapter.inventory();
  assert.deepEqual(result.counts, { endpointNames: 5, registryLocations: 3, ready: 2, missing: 1, obsolete: 1, unresolved: 1 });
  assert.deepEqual(result.endpoints.map(endpoint => [endpoint.name, endpoint.status]), [
    ['PUMP', 'ready'], ['PUMP PTC', 'ready'], ['VALVE OPEN', 'obsolete'], ['NO REGISTRY', 'missing'], ['AMBIGUOUS', 'unresolved'],
  ]);
  assert.equal(result.endpoints[0].locationId, result.endpoints[1].locationId);
  assert.equal(result.snapshotStable, true); assert.equal(result.writesPerformed, 0);
  assert.equal(result.cableDetailsAvailable, false); assert.equal(calls.length, 3);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('valid empty registry is not invented as ready', async () => {
  const ctx = context(['NO BINDING']);
  const { adapter } = client([ctx, page(), ctx]);
  const result = await adapter.inventory();
  assert.equal(result.counts.missing, 1); assert.equal(result.counts.ready, 0);
});

test('null binding is missing regardless of presence of a registered name', async () => {
  const ctx = context(['NO BINDING']);
  const { adapter } = client([ctx, page([location(1, 'NO BINDING', 'missing')]), ctx]);
  assert.equal((await adapter.inventory()).endpoints[0].status, 'missing');
});

test('offset pagination accepts 101 distinct locations and stable final context', async () => {
  const ctx = context(['LOC-0', 'LOC-100']);
  const first = Array.from({ length: 100 }, (_, number) => location(number));
  const { adapter, calls } = client([ctx, page(first, { total: 101, nextOffset: 100 }),
    page([location(100)], { offset: 100, total: 101 }), ctx]);
  const result = await adapter.inventory();
  assert.equal(result.locations.length, 101); assert.equal(result.counts.ready, 2);
  assert.match(calls[2].url, /offset=100&limit=100$/);
});

test('missing credential refuses before network', async () => {
  let requests = 0;
  const adapter = createWfcReadClient({ baseUrl, projectId, fetchImpl: async () => { requests++; } });
  await rejects(adapter.inventory(), 'WFC_AUTH_REQUIRED'); assert.equal(requests, 0);
});

test('only the fixed test origins are configurable; URL credentials, paths and remote hosts refused', () => {
  for (const address of ['https://127.0.0.1:5181', 'http://127.0.0.1:5180', 'http://example.org:5181',
    'http://user:pass@localhost:5181', 'http://localhost:5181/api', 'http://localhost:5181/?key=secret',
    'http://api:4000', 'http://wfc-test-app-api-1:4001', 'file:///etc/passwd']) {
    assert.throws(() => createWfcReadClient({ baseUrl: address, projectId, token }), { code: 'WFC_INVALID_CONFIG' });
  }
  for (const address of ['http://localhost:5181', 'http://[::1]:5181', 'http://wfc-test-app-api-1:4000', 'http://host.docker.internal:5181']) {
    assert.doesNotThrow(() => createWfcReadClient({ baseUrl: address, projectId, token }));
  }
  assert.throws(() => createWfcReadClient({ baseUrl, projectId: '../other-project', token }), { code: 'WFC_INVALID_CONFIG' });
});

test('401 and 403 produce safe errors without reading response errors', async () => {
  for (const [status, code] of [[401, 'WFC_AUTH_REQUIRED'], [403, 'WFC_FORBIDDEN']]) {
    const { adapter, calls } = client([json({ error: token }, { status })]);
    await rejects(adapter.inventory(), code); assert.equal(calls.length, 1);
  }
});

test('redirect refusal and raw network errors do not disclose credentials', async () => {
  const { adapter } = client([() => { throw Error(`fetch failed ${token}`); }]);
  await rejects(adapter.inventory(), 'WFC_READ_FAILED');
  const redirected = json(context()); Object.defineProperty(redirected, 'redirected', { value: true });
  await rejects(client([redirected]).adapter.inventory(), 'WFC_READ_FAILED');
  await rejects(client([new Response('', { status: 302, headers: { Location: 'https://example.org/' } })]).adapter.inventory(), 'WFC_READ_FAILED');
});

test('wrong project, invalid names hash and invalid current frame refuse inventory', async () => {
  for (const mutate of [value => { value.projectId = id(99); }, value => { value.namesSha256 = '0'.repeat(64); },
    value => { value.current.captureFrameId = 'not-a-uuid'; }]) {
    const ctx = context(); mutate(ctx);
    await rejects(client([ctx]).adapter.inventory(), 'WFC_INVALID_RESPONSE');
  }
});

test('wrong project in binding page refuses cross-project response', async () => {
  const portion = page(); portion.projectId = id(99);
  await rejects(client([context(), portion]).adapter.inventory(), 'WFC_INVALID_RESPONSE');
});

test('changed registry, model or cable names rejects mixed snapshots', async () => {
  const changedPage = page(); changedPage.registryRevision = '13';
  await rejects(client([context(), changedPage]).adapter.inventory(), 'WFC_SNAPSHOT_CHANGED');
  for (const mutate of [value => { value.registryRevision = '13'; }, value => { value.current.selectionRevision = '3'; }]) {
    const before = context(), after = context(); mutate(after);
    await rejects(client([before, page(), after]).adapter.inventory(), 'WFC_SNAPSHOT_CHANGED');
  }
  await rejects(client([context(), page(), context(['DIFFERENT'])]).adapter.inventory(), 'WFC_SNAPSHOT_CHANGED');
});

test('nonadvancing cursor, duplicate locations and conflicting alias identities are refused', async () => {
  const emptyCycle = page([], { total: 1, nextOffset: 0 });
  await rejects(client([context(), emptyCycle]).adapter.inventory(), 'WFC_INVALID_RESPONSE');
  const duplicate = location(1);
  await rejects(client([context(), page([duplicate, duplicate])]).adapter.inventory(), 'WFC_INVALID_RESPONSE');
  const a = location(1), b = location(2); b.location.aliases = [a.location.name];
  await rejects(client([context(), page([a, b]), context()]).adapter.inventory(), 'WFC_INVALID_RESPONSE');
});

test('page total, offset and readiness invariants are validated', async () => {
  for (const mutate of [value => { value.offset = 1; }, value => { value.total = 0; },
    value => { value.locations[0].readiness.reasonCodes = ['ENDPOINT_BINDING_STALE']; },
    value => { value.locations[0].head = null; },
    value => { value.locations[0].head.pointProjectMetres = [0, 0, null]; }]) {
    const portion = page([location(1)]); mutate(portion);
    await rejects(client([context(), portion]).adapter.inventory(), 'WFC_INVALID_RESPONSE');
  }
});

test('oversized registry and oversized streamed response refuse work', async () => {
  const large = page([], { total: 10_001, nextOffset: 0 });
  await rejects(client([context(), large]).adapter.inventory(), 'WFC_INVENTORY_LIMIT');
  await rejects(client([context()], { maxResponseBytes: 32 }).adapter.inventory(), 'WFC_RESPONSE_LIMIT');
  const declared = json(context()); declared.headers.set('content-length', '99999999');
  await rejects(client([declared]).adapter.inventory(), 'WFC_RESPONSE_LIMIT');
});

test('invalid JSON and response encoding are refused', async () => {
  await rejects(client([new Response('{', { headers: { 'Content-Type': 'application/json' } })]).adapter.inventory(), 'WFC_INVALID_RESPONSE');
  await rejects(client([new Response('<html>no</html>')]).adapter.inventory(), 'WFC_INVALID_RESPONSE');
  const invalidUtf8 = new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } });
  await rejects(client([invalidUtf8]).adapter.inventory(), 'WFC_INVALID_RESPONSE');
});

test('deadline bounds even a fetch implementation that ignores cancellation', async () => {
  const { adapter } = client([() => new Promise(() => {})], { timeoutMs: 10 });
  await rejects(adapter.inventory(), 'WFC_TIMEOUT');
});

test('deadline cancels a stalled response body as well as the request', async () => {
  let cancelled = false;
  const stalled = new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    headers: { 'Content-Type': 'application/json' },
  });
  await rejects(client([stalled], { timeoutMs: 10 }).adapter.inventory(), 'WFC_TIMEOUT');
  assert.equal(cancelled, true);
});

test('caller cancellation is bounded before and during the read', async () => {
  const before = new AbortController(); before.abort();
  const { adapter, calls } = client([]);
  await rejects(adapter.inventory({ signal: before.signal }), 'WFC_CANCELLED'); assert.equal(calls.length, 0);
  const during = new AbortController();
  const pending = client([() => { during.abort(); return new Promise(() => {}); }]).adapter.inventory({ signal: during.signal });
  await rejects(pending, 'WFC_CANCELLED');
});
