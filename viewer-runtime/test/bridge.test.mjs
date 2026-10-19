import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRuntimeBridge } from '../bridge.mjs';
import { CHANNEL, parseRouting } from '../protocol.mjs';

const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const turn = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture(options = {}) {
  const sent = [], fetches = [], loads = [], listeners = new Set(), states = [];
  let next = 20, identity = { modelVersionId: null, loadId: null };
  const bootstrap = { instanceId: uuid(1), projectId: uuid(2) };
  // Model LAN HTTP: getRandomValues exists but randomUUID is unavailable.
  const window = { location: { origin: 'http://localhost:18085' }, crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
    parent: { postMessage(value, origin) { sent.push({ value, origin }); } },
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn); }, removeEventListener(type, fn) { if (type === 'message') listeners.delete(fn); } };
  const facts = { clears: 0, fits: 0, finishes: 0, disposed: 0, shows: [] };
  const handle = { finish() { facts.finishes++; }, prepareIndex: options.prepareIndex ?? (async () => {}),
    clearRoute() { facts.clears++; }, fitRoute() { facts.fits++; },
    showRoute: options.showRoute ?? (async raw => { facts.shows.push(raw); return { segments: parseRouting(raw).segments.map(() => ({ status: 'found', count: 1, drawable: true })), lineCount: 1, diagnostics: {} }; }) };
  const adapter = { initialize: options.initialize ?? (async () => {}), async load(value) { loads.push(value); return options.load ? options.load(value) : handle; }, dispose() { facts.disposed++; } };
  const fetchImpl = async (url, init) => {
    fetches.push({ url, init });
    if (options.fetchImpl) return options.fetchImpl(url, init);
    return Response.json({ projectId: bootstrap.projectId, ...identity, contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 342, totalBytes: 439007803 });
  };
  const bridge = createRuntimeBridge({ window, bootstrap, adapter, fetchImpl, onState: state => states.push(state) });
  const send = (type, payload, overrides = {}, eventOverrides = {}) => {
    if (type === 'LOAD_MODEL') identity = { modelVersionId: overrides.modelVersionId ?? uuid(3), loadId: overrides.loadId ?? uuid(4) };
    const value = { channel: CHANNEL, protocolVersion: 1, ...bootstrap, ...identity, requestId: uuid(next++), type, payload, ...overrides };
    for (const fn of listeners) fn({ data: value, origin: window.location.origin, source: window.parent, ...eventOverrides });
    return value;
  };
  const messages = type => sent.filter(item => item.value.type === type).map(item => item.value);
  const init = async () => { send('INIT', { locale: 'bg', expectedSdkVersion: '7.130.0' }); await turn(); };
  const loaded = async () => { await init(); const command = send('LOAD_MODEL', { sessionId: uuid(6) }); await turn(); return command; };
  return { bridge, send, sent, messages, init, loaded, facts, fetches, loads, states, listeners, window, handle };
}

test('HELLO uses exact target origin, forged origin/source/identity/direction/replays have no side effects', async () => {
  const f = fixture();
  assert.equal(f.window.crypto.randomUUID, undefined);
  assert.equal(f.messages('HELLO').length, 1); assert.equal(f.sent[0].origin, f.window.location.origin);
  assert.match(f.messages('HELLO')[0].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  f.send('INIT', { locale: 'bg', expectedSdkVersion: '7.130.0' }, {}, { origin: 'https://foreign.invalid' });
  f.send('INIT', { locale: 'bg', expectedSdkVersion: '7.130.0' }, {}, { source: {} });
  f.send('INIT', { locale: 'bg', expectedSdkVersion: '7.130.0' }, { instanceId: uuid(99) });
  f.send('HELLO', { supportedProtocolVersions: [1], sdkVersion: '7.130.0' });
  assert.equal(f.bridge.getState().phase, 'hello');
  const command = f.send('INIT', { locale: 'bg', expectedSdkVersion: '7.130.0' }); await turn();
  f.send(command.type, command.payload, command); await turn();
  assert.equal(f.messages('RUNTIME_READY').length, 1); f.bridge.dispose();
});

test('actual index promise gates MODEL_LOADED and descriptors use cookie-only fixed same-origin paths', async () => {
  const index = deferred(); const f = fixture({ prepareIndex: () => index.promise }); await f.init();
  const command = f.send('LOAD_MODEL', { sessionId: uuid(6) }); await turn();
  assert.equal(f.messages('MODEL_LOADED').length, 0);
  assert.equal(f.fetches[0].url, `http://localhost:18085/api/projects/${uuid(2)}/model-versions/${uuid(3)}/viewer-sessions/${uuid(6)}/descriptor`);
  assert.equal(f.fetches[0].init.credentials, 'same-origin'); assert.equal(f.fetches[0].init.redirect, 'error'); assert.equal(f.fetches[0].init.headers, undefined);
  assert.equal(f.loads[0].modelUrl, `http://localhost:18085/api/projects/${uuid(2)}/model-versions/${uuid(3)}/viewer-sessions/${uuid(6)}/resources/output/0/0.svf`);
  index.resolve(); await turn();
  assert.deepEqual(f.messages('MODEL_LOADED')[0], { ...command, type: 'MODEL_LOADED', payload: { sdkVersion: '7.130.0', format: 'svf', nodeIndexReady: true } }); f.bridge.dispose();
});

test('cancelling INIT suppresses late readiness and permits a fresh controlled initialization', async () => {
  const pending = deferred(); let attempts = 0;
  const f = fixture({ initialize: async () => { if (++attempts === 1) await pending.promise; } });
  const init = f.send('INIT', { locale: 'bg', expectedSdkVersion: '7.130.0' });
  f.send('CANCEL_REQUEST', { targetRequestId: init.requestId });
  pending.resolve(); await turn(); assert.equal(f.messages('RUNTIME_READY').length, 0);
  assert.equal(f.messages('REQUEST_CANCELLED')[0].payload.outcome, 'cancelled');
  await f.init(); assert.equal(f.messages('RUNTIME_READY').length, 1); f.bridge.dispose();
});

test('new load aborts old load, rejects late progress/completion and cannot reuse old loadId', async () => {
  const old = deferred(); const f = fixture({ load: value => value.signal.aborted ? Promise.reject(new Error()) : f.loads.length === 1 ? old.promise : f.handle });
  await f.init(); const first = f.send('LOAD_MODEL', { sessionId: uuid(6) }); await turn();
  const second = f.send('LOAD_MODEL', { sessionId: uuid(7) }, { loadId: uuid(8), modelVersionId: uuid(9) }); await turn();
  assert.equal(f.loads[0].signal.aborted, true);
  f.loads[0].onProgress({ phase: 'model', loaded: 99, total: 100 }); old.resolve(f.handle); await turn();
  assert.equal(f.messages('MODEL_LOADED').length, 1); assert.equal(f.messages('MODEL_LOADED')[0].requestId, second.requestId);
  assert.equal(f.messages('MODEL_PROGRESS').filter(message => message.requestId === first.requestId && message.payload.loaded === 99).length, 0);
  f.send('LOAD_MODEL', { sessionId: uuid(6) }, { loadId: first.loadId }); await turn(); assert.equal(f.loads.length, 2); f.bridge.dispose();
});

test('cancel pending load aborts transport and suppresses late model/index callbacks', async () => {
  const index = deferred(); const f = fixture({ prepareIndex: () => index.promise }); await f.init();
  const command = f.send('LOAD_MODEL', { sessionId: uuid(6) }); await turn();
  f.send('CANCEL_REQUEST', { targetRequestId: command.requestId }); index.resolve(); await turn();
  assert.equal(f.loads[0].signal.aborted, true); assert.equal(f.messages('MODEL_LOADED').length, 0);
  assert.equal(f.messages('REQUEST_CANCELLED')[0].payload.outcome, 'cancelled'); f.bridge.dispose();
});

test('empty/marker-only/invalid routing clears previous overlays without invoking geometry', async () => {
  const f = fixture(); await f.loaded();
  const shown = f.send('SHOW_ROUTE', { rawRouting: 'BC1', source: 'manual', cableId: null }); await turn();
  f.send('ZOOM_ROUTE', { routeRequestId: shown.requestId }); assert.equal(f.facts.fits, 1);
  for (const rawRouting of ['', '/SECONDARY/', 'BC1／BC2']) { f.send('SHOW_ROUTE', { rawRouting, source: 'manual', cableId: null }); await turn(); }
  assert.deepEqual(f.facts.shows, ['BC1']); assert.ok(f.facts.clears >= 4);
  assert.equal(f.messages('ROUTE_RESULT').length, 3); assert.equal(f.messages('ERROR').at(-1).payload.code, 'ROUTE_INVALID');
  f.send('ZOOM_ROUTE', { routeRequestId: shown.requestId }); assert.equal(f.messages('ERROR').at(-1).payload.code, 'NO_DRAWABLE_ROUTE'); f.bridge.dispose();
});

test('partial/missing/ambiguous/non-drawable matches remain occurrence-preserving model-only results', async () => {
  const f = fixture({ showRoute: async () => ({ segments: [{ status: 'found', count: 1, drawable: true }, { status: 'missing', count: 0, drawable: false }, { status: 'ambiguous', count: 2, drawable: false }, { status: 'found', count: 1, drawable: false }], lineCount: 2, diagnostics: { connectors: [{}] } }) });
  await f.loaded(); f.send('SHOW_ROUTE', { rawRouting: 'BC1/SECONDARY/X/Y/BC1', source: 'cable', cableId: uuid(12) }); await turn();
  const result = f.messages('ROUTE_RESULT')[0].payload;
  assert.deepEqual(result.segments.map(segment => segment.segmentIndex), [0, 2, 3, 4]);
  assert.deepEqual(result.segments.map(segment => segment.model.state), ['found', 'missing', 'ambiguous', 'found']);
  assert.equal(result.drawableCount, 1); assert.equal(result.lineCount, 2); assert.equal(Object.hasOwn(result, 'project'), false);
  assert.ok(result.warnings.some(warning => warning.code === 'UNMODELLED_CONNECTOR')); f.bridge.dispose();
});

test('clear and cancel invalidate pending route results, stale identity and unknown target cannot change active view', async () => {
  const pending = deferred(); const f = fixture({ showRoute: () => pending.promise }); await f.loaded();
  const show = f.send('SHOW_ROUTE', { rawRouting: 'BC1', source: 'manual', cableId: null });
  f.send('CANCEL_REQUEST', { targetRequestId: show.requestId });
  f.send('CLEAR_ROUTE', { reason: 'user' });
  const before = f.facts.clears;
  f.send('CLEAR_ROUTE', { reason: 'user' }, { loadId: uuid(99) });
  assert.equal(f.facts.clears, before);
  f.send('CANCEL_REQUEST', { targetRequestId: uuid(100) });
  assert.equal(f.messages('REQUEST_CANCELLED').at(-1).payload.outcome, 'unknown');
  pending.resolve({ segments: [{ status: 'found', count: 1, drawable: true }], lineCount: 1 }); await turn();
  assert.equal(f.messages('ROUTE_RESULT').length, 0); assert.equal(f.messages('ROUTE_CLEARED').length, 1); f.bridge.dispose();
});

for (const [status, code] of [[401, 'SESSION_EXPIRED'], [403, 'ACCESS_REVOKED'], [409, 'MODEL_SELECTION_CHANGED'], [410, 'SESSION_EXPIRED'], [503, 'MODEL_UNAVAILABLE']]) {
  test(`protected descriptor HTTP ${status} yields sanitized ${code} and no SDK model load`, async () => {
    const f = fixture({ fetchImpl: async () => new Response('private url and token', { status }) }); await f.loaded();
    assert.equal(f.loads.length, 0); assert.equal(f.messages('MODEL_LOADED').length, 0); assert.equal(f.messages('ERROR').at(-1).payload.code, code);
    assert.equal(JSON.stringify(f.sent).includes('private'), false); f.bridge.dispose();
  });
}

test('descriptor oversized/wrong identity/external entrypoint never reaches SDK', async () => {
  for (const response of [() => new Response('x'.repeat(32769)), () => Response.json({ entrypoint: 'https://outside.invalid' })]) {
    const f = fixture({ fetchImpl: async () => response() }); await f.loaded();
    assert.equal(f.loads.length, 0); assert.equal(f.messages('ERROR').at(-1).payload.code, 'INVALID_MESSAGE'); f.bridge.dispose();
  }
});

test('409 MODEL_UNAVAILABLE safe code is preserved without disclosing backend text', async () => {
  const f = fixture({ fetchImpl: async () => Response.json({ code: 'MODEL_UNAVAILABLE', error: 'https://private.invalid/token' }, { status: 409 }) }); await f.loaded();
  assert.equal(f.messages('ERROR').at(-1).payload.code, 'MODEL_UNAVAILABLE');
  assert.equal(JSON.stringify(f.sent).includes('private.invalid'), false); f.bridge.dispose();
});

test('worker failure rechecks protected descriptor to identify revoked session without renewal', async () => {
  let reads = 0; const f = fixture({ load: async () => { throw new Error('https://private.invalid/token'); }, fetchImpl: async () => {
    if (++reads > 1) return new Response('', { status: 410 });
    return Response.json({ projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 342, totalBytes: 439007803 });
  } }); await f.loaded();
  assert.equal(reads, 2); assert.equal(f.messages('ERROR').at(-1).payload.code, 'SESSION_EXPIRED');
  assert.equal(JSON.stringify(f.sent).includes('private.invalid'), false); f.bridge.dispose();
});

test('runtime error during indexing prevents late readiness and releases the failed model', async () => {
  const pending = deferred(); const f = fixture({ prepareIndex: () => pending.promise }); await f.init();
  f.send('LOAD_MODEL', { sessionId: uuid(6) }); await turn();
  f.loads[0].onRuntimeError({ code: 'RESOURCE_FAILED' }); pending.resolve(); await turn();
  assert.equal(f.messages('MODEL_LOADED').length, 0); assert.equal(f.messages('ERROR').at(-1).payload.code, 'RESOURCE_FAILED');
  assert.equal(f.loads[0].signal.aborted, true); assert.ok(f.facts.finishes > 0); f.bridge.dispose();
});

test('DISPOSE aborts resources, removes listeners, acknowledges exactly once and ignores all late work', async () => {
  const pending = deferred(); const f = fixture({ prepareIndex: () => pending.promise }); await f.init();
  f.send('LOAD_MODEL', { sessionId: uuid(6) }); await turn();
  const command = f.send('DISPOSE', { reason: 'unmount' });
  assert.equal(f.messages('DISPOSED')[0].requestId, command.requestId); assert.equal(f.listeners.size, 0); assert.equal(f.loads[0].signal.aborted, true);
  pending.resolve(); await turn(); assert.equal(f.messages('MODEL_LOADED').length, 0);
  f.bridge.dispose(); assert.equal(f.messages('DISPOSED').length, 1); assert.equal(f.facts.disposed, 1);
});

test('a saturated command registry still admits replay-safe CANCEL and terminal DISPOSE without growing it', async () => {
  const pending = deferred(); const f = fixture({ prepareIndex: () => pending.promise }); await f.init();
  const load = f.send('LOAD_MODEL', { sessionId: uuid(6) }); await turn();
  for (let i = f.bridge.getState().requests; i < 4096; i++) f.send('CLEAR_ROUTE', { reason: 'user' });
  assert.equal(f.bridge.getState().requests, 4096);
  const before = f.messages('ROUTE_CLEARED').length;
  f.send('CLEAR_ROUTE', { reason: 'user' }); assert.equal(f.messages('ROUTE_CLEARED').length, before);
  const cancel = f.send('CANCEL_REQUEST', { targetRequestId: load.requestId });
  assert.equal(f.messages('REQUEST_CANCELLED').at(-1).payload.outcome, 'cancelled'); assert.equal(f.loads[0].signal.aborted, true);
  f.send(cancel.type, cancel.payload, cancel); assert.equal(f.messages('REQUEST_CANCELLED').length, 1);
  // Exhausting the separate cancellation replay budget still cannot block DISPOSE.
  for (let i = 1; i < 4096; i++) f.send('CANCEL_REQUEST', { targetRequestId: uuid(999999) });
  const cancellations = f.messages('REQUEST_CANCELLED').length;
  f.send('CANCEL_REQUEST', { targetRequestId: uuid(999999) }); assert.equal(f.messages('REQUEST_CANCELLED').length, cancellations);
  f.send('DISPOSE', { reason: 'unmount' }, {}, { source: {} }); assert.equal(f.facts.disposed, 0);
  const dispose = f.send('DISPOSE', { reason: 'unmount' }); pending.resolve(); await turn();
  assert.equal(f.messages('DISPOSED')[0].requestId, dispose.requestId); assert.equal(f.messages('DISPOSED').length, 1);
  assert.equal(f.facts.disposed, 1); assert.equal(f.listeners.size, 0); assert.ok(f.facts.finishes > 0);
  assert.equal(f.messages('MODEL_LOADED').length, 0); assert.equal(f.bridge.getState().requests, 4096);
});
