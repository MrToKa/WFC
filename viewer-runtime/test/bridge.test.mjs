import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeBridge } from '../bridge.mjs';
import { CHANNEL, parseRouting } from '../protocol.mjs';
import { planModelCaptureInput } from '../capture-input.mjs';

const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const turn = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture(options = {}) {
  const sent = [], fetches = [], loads = [], listeners = new Set(), states = [];
  let next = 20, identity = { modelVersionId: null, loadId: null };
  const bootstrap = { instanceId: uuid(1), projectId: uuid(2) };
  const window = { location: { origin: 'http://localhost:18085' }, crypto: { randomUUID: () => uuid(next++) },
    parent: { postMessage(value, origin) { sent.push({ value, origin }); } },
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn); }, removeEventListener(type, fn) { if (type === 'message') listeners.delete(fn); } };
  const facts = { clears: 0, fits: 0, finishes: 0, disposed: 0, shows: [] };
  const handle = { finish() { facts.finishes++; }, prepareIndex: options.prepareIndex ?? (async () => {}),
    clearRoute() { facts.clears++; return options.clearRoute?.(); }, fitRoute() { facts.fits++; },
    showComputedPath(value) { facts.computedPath = structuredClone(value); },
    pickPoint: options.pickPoint ?? (async () => ({ objectId: 23, point: [1, 2, 3], derivation: 'picked-surface-point' })),
    readModelObjects: options.readModelObjects ?? (async ({ cursor, query }) => ({ cursor, nextCursor: null, complete: true, query, coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [] })),
    readSelection: options.readSelection ?? (async () => ({ coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [] })),
    setPathTransparency: options.setPathTransparency ?? (async (percent, _signal, beforeCommit) => { await beforeCommit(); facts.transparency = percent; }),
    startModelCapture: options.startModelCapture ?? (async ({ captureId }) => ({ captureId, index: 0, done: false, eventJson: JSON.stringify({ type: 'metadata', captureId }) })),
    readModelCapture: options.readModelCapture ?? (async ({ captureId, index }) => ({ captureId, index, done: true, eventJson: JSON.stringify({ type: 'complete', captureId }) })),
    showRoute: options.showRoute ?? (async raw => { facts.shows.push(raw); return { segments: parseRouting(raw).segments.map(() => ({ status: 'found', count: 1, drawable: true })), lineCount: 1, diagnostics: {} }; }) };
  const adapter = { initialize: options.initialize ?? (async () => {}), async load(value) { loads.push(value); return options.load ? options.load(value) : handle; }, dispose() { facts.disposed++; } };
  const fetchImpl = async (url, init) => {
    fetches.push({ url, init });
    if (options.fetchImpl) return options.fetchImpl(url, init);
    if (url.endsWith('/pathfinder-authorization')) return Response.json({ authorized: true, loadId: identity.loadId });
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

test('independent lookup empty-visible scope sends only an allowlisted actionable message', async () => {
  const f = fixture({ startModelCapture: async () => { throw Object.assign(new Error('SDK private object details must never escape'), { code: 'LOOKUP_GEOMETRY_NOT_FOUND' }); } });
  await f.loaded(); f.send('START_MODEL_CAPTURE', { captureId: uuid(17), lookupRouteCodes: ['/BC001'], equipmentNames: [] }); await turn();
  const error = f.messages('ERROR').at(-1).payload;
  assert.equal(error.code, 'LOOKUP_GEOMETRY_NOT_FOUND'); assert.equal(error.retryable, false);
  assert.equal(error.message, 'No display-visible route geometry matches the lookup. Check the route names and model visibility.');
  assert.equal(JSON.stringify(f.sent).includes('private object'), false); f.bridge.dispose();
});

test('HELLO uses exact target origin, forged origin/source/identity/direction/replays have no side effects', async () => {
  const f = fixture();
  assert.equal(f.messages('HELLO').length, 1); assert.equal(f.sent[0].origin, f.window.location.origin);
  f.send('INIT', { locale: 'bg', expectedSdkVersion: '7.130.0' }, {}, { origin: 'https://foreign.invalid' });
  f.send('INIT', { locale: 'bg', expectedSdkVersion: '7.130.0' }, {}, { source: {} });
  f.send('INIT', { locale: 'bg', expectedSdkVersion: '7.130.0' }, { instanceId: uuid(99) });
  f.send('HELLO', { supportedProtocolVersions: [1], sdkVersion: '7.130.0' });
  assert.equal(f.bridge.getState().phase, 'hello');
  const command = f.send('INIT', { locale: 'bg', expectedSdkVersion: '7.130.0' }); await turn();
  f.send(command.type, command.payload, command); await turn();
  assert.equal(f.messages('RUNTIME_READY').length, 1); f.bridge.dispose();
});

test('computed path requires ordered complete bounded chunks and current cookie-bound admin permission', async () => {
  const f = fixture(); await f.loaded(); const pathId = uuid(17);
  f.send('BEGIN_COMPUTED_PATH', { pathId, pointCount: 3, objectIds: [23] }); await turn();
  f.send('APPEND_COMPUTED_PATH', { pathId, offset: 0, points: [[10, 20, 30], [11, 22, 33]] }); await turn();
  assert.equal(f.facts.computedPath, undefined);
  f.send('APPEND_COMPUTED_PATH', { pathId, offset: 2, points: [[14, 25, 36]] }); await turn();
  const commit = f.send('COMMIT_COMPUTED_PATH', { pathId }); await turn();
  assert.deepEqual(f.facts.computedPath, { objectIds: [23], points: [[10, 20, 30], [11, 22, 33], [14, 25, 36]] });
  f.send('ZOOM_ROUTE', { routeRequestId: commit.requestId }); assert.equal(f.facts.fits, 1);
  assert.equal(f.messages('COMPUTED_PATH_UPDATED').at(-1).payload.phase, 'displayed');
  const authorizations = f.fetches.filter(item => item.url.endsWith('/pathfinder-authorization'));
  assert.equal(authorizations.length, 4);
  assert.ok(authorizations.every(item => item.init.credentials === 'same-origin' && item.init.redirect === 'error' && item.init.headers === undefined));
  f.bridge.dispose();
});

test('a successful zero-length engine result transports its one exact point without adding a second', async () => {
  const f = fixture(); await f.loaded(); const pathId = uuid(17), points = [[1, 0, 0.5]];
  f.send('BEGIN_COMPUTED_PATH', { pathId, pointCount: 1, objectIds: [] }); await turn();
  f.send('APPEND_COMPUTED_PATH', { pathId, offset: 0, points }); await turn();
  f.send('COMMIT_COMPUTED_PATH', { pathId }); await turn();
  assert.deepEqual(f.facts.computedPath, { points, objectIds: [] }); assert.deepEqual(f.messages('COMPUTED_PATH_UPDATED').map(value => value.payload.received), [0, 1, 1]); f.bridge.dispose();
});

test('out-of-order/incomplete computed paths fail closed; Clear cancels a pending authorization', async () => {
  const f = fixture(); await f.loaded(); const pathId = uuid(17);
  f.send('BEGIN_COMPUTED_PATH', { pathId, pointCount: 3, objectIds: [23] }); await turn();
  f.send('APPEND_COMPUTED_PATH', { pathId, offset: 1, points: [[1, 2, 3]] }); await turn();
  f.send('COMMIT_COMPUTED_PATH', { pathId }); await turn();
  assert.equal(f.facts.computedPath, undefined); assert.equal(f.messages('ERROR').at(-1).payload.code, 'PATH_INVALID'); f.bridge.dispose();
  const permission = deferred();
  const g = fixture({ fetchImpl: async url => url.endsWith('/pathfinder-authorization') ? permission.promise : Response.json({ projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 1, totalBytes: 1 }) });
  await g.loaded(); g.send('BEGIN_COMPUTED_PATH', { pathId, pointCount: 2, objectIds: [] });
  g.send('CLEAR_ROUTE', { reason: 'user' }); permission.resolve(Response.json({ authorized: true, loadId: uuid(4) })); await turn();
  assert.equal(g.messages('COMPUTED_PATH_UPDATED').length, 0); g.bridge.dispose();
});

test('picking and metadata reauthorize after SDK work; cancellation and revoked admin suppress results', async () => {
  const point = deferred(); let authorizationCount = 0;
  const f = fixture({ pickPoint: () => point.promise, fetchImpl: async url => {
    if (url.endsWith('/pathfinder-authorization')) return ++authorizationCount === 1 ? Response.json({ authorized: true, loadId: uuid(4) }) : new Response(null, { status: 403 });
    return Response.json({ projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 1, totalBytes: 1 });
  } });
  await f.loaded(); f.send('PICK_POINT', {}); await turn(); point.resolve({ objectId: 23, point: [1, 2, 3], derivation: 'picked-surface-point' }); await turn();
  assert.equal(f.messages('POINT_PICKED').length, 0); assert.equal(f.messages('ERROR').at(-1).payload.code, 'ACCESS_REVOKED'); f.bridge.dispose();
  const metadata = deferred(), g = fixture({ readModelObjects: () => metadata.promise }); await g.loaded();
  const request = g.send('READ_MODEL_OBJECTS', { cursor: 0, limit: 16, query: 'CAB' }); await turn();
  g.send('CANCEL_REQUEST', { targetRequestId: request.requestId });
  metadata.resolve({ cursor: 0, nextCursor: null, complete: true, query: 'CAB', coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [] }); await turn();
  assert.equal(g.messages('MODEL_OBJECTS').length, 0); g.bridge.dispose();
});

test('selection is cookie-bound admin authorized before and after SDK work, and Clear suppresses late selection', async () => {
  const selected = deferred(); let checks = 0;
  const f = fixture({ readSelection: () => selected.promise, fetchImpl: async url => url.endsWith('/pathfinder-authorization') ? ++checks === 1 ? Response.json({ authorized: true, loadId: uuid(4) }) : new Response(null, { status: 403 }) : Response.json({ projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 1, totalBytes: 1 }) });
  await f.loaded(); f.send('READ_SELECTION', {}); await turn(); selected.resolve({ coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [] }); await turn();
  assert.equal(f.messages('MODEL_SELECTION').length, 0); assert.equal(f.messages('ERROR').at(-1).payload.code, 'ACCESS_REVOKED'); f.bridge.dispose();
  const late = deferred(), g = fixture({ readSelection: () => late.promise }); await g.loaded(); g.send('READ_SELECTION', {}); await turn(); g.send('CLEAR_ROUTE', { reason: 'user' });
  late.resolve({ coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [] }); await turn(); assert.equal(g.messages('MODEL_SELECTION').length, 0); g.bridge.dispose();
});

test('transparency is bounded to the current committed path and delayed authorization cannot change a replacement', async () => {
  const f = fixture(); await f.loaded();
  const display = async pathId => { f.send('BEGIN_COMPUTED_PATH', { pathId, pointCount: 1, objectIds: [] }); await turn(); f.send('APPEND_COMPUTED_PATH', { pathId, offset: 0, points: [[1, 2, 3]] }); await turn(); const committed = f.send('COMMIT_COMPUTED_PATH', { pathId }); await turn(); return committed; };
  const first = await display(uuid(90)); f.send('SET_PATH_TRANSPARENCY', { routeRequestId: first.requestId, percent: 40 }); await turn(); assert.equal(f.facts.transparency, 40);
  const second = await display(uuid(91)); f.send('SET_PATH_TRANSPARENCY', { routeRequestId: first.requestId, percent: 90 }); await turn(); assert.equal(f.facts.transparency, 40); assert.equal(f.messages('ERROR').at(-1).payload.code, 'NO_DRAWABLE_ROUTE');
  f.send('SET_PATH_TRANSPARENCY', { routeRequestId: second.requestId, percent: 100 }); f.send('CLEAR_ROUTE', { reason: 'user' }); await turn(); assert.equal(f.facts.transparency, 40); assert.equal(f.messages('PATH_TRANSPARENCY_UPDATED').length, 1); f.bridge.dispose();
});

async function displayComputedForTransparency(f, pathId) {
  f.send('BEGIN_COMPUTED_PATH', { pathId, pointCount: 1, objectIds: [] }); await turn();
  f.send('APPEND_COMPUTED_PATH', { pathId, offset: 0, points: [[1, 2, 3]] }); await turn();
  const committed = f.send('COMMIT_COMPUTED_PATH', { pathId }); await turn(); return committed;
}

test('transparency reauthorizes after material preflight and makes no change after role revocation', async () => {
  const prepared = deferred(); let authorized = true;
  const f = fixture({
    setPathTransparency: async (percent, _signal, beforeCommit) => { await prepared.promise; await beforeCommit(); f.facts.transparency = percent; },
    fetchImpl: async url => url.endsWith('/pathfinder-authorization')
      ? authorized ? Response.json({ authorized: true, loadId: uuid(4) }) : new Response(null, { status: 403 })
      : Response.json({ projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 1, totalBytes: 1 }),
  });
  await f.loaded(); const shown = await displayComputedForTransparency(f, uuid(110));
  f.send('SET_PATH_TRANSPARENCY', { routeRequestId: shown.requestId, percent: 75 }); await turn();
  authorized = false; prepared.resolve(); await turn();
  assert.equal(f.facts.transparency, undefined); assert.equal(f.messages('PATH_TRANSPARENCY_UPDATED').length, 0);
  assert.equal(f.messages('ERROR').at(-1).payload.code, 'ACCESS_REVOKED'); f.bridge.dispose();
});

test('Clear, cancellation, replacement and disposal cannot publish late preflighted transparency', async () => {
  for (const action of ['clear', 'cancel', 'replace', 'dispose']) {
    const prepared = deferred();
    const f = fixture({ setPathTransparency: async (percent, _signal, beforeCommit) => { await prepared.promise; await beforeCommit(); f.facts.transparency = percent; } });
    await f.loaded(); const shown = await displayComputedForTransparency(f, uuid(111));
    const pending = f.send('SET_PATH_TRANSPARENCY', { routeRequestId: shown.requestId, percent: 75 }); await turn();
    if (action === 'clear') f.send('CLEAR_ROUTE', { reason: 'user' });
    if (action === 'cancel') f.send('CANCEL_REQUEST', { targetRequestId: pending.requestId });
    if (action === 'replace') await displayComputedForTransparency(f, uuid(112));
    if (action === 'dispose') f.send('DISPOSE', { reason: 'unmount' });
    prepared.resolve(); await turn();
    assert.equal(f.facts.transparency, undefined, action); assert.equal(f.messages('PATH_TRANSPARENCY_UPDATED').length, 0, action); f.bridge.dispose();
  }
});

test('late final transparency authorization cannot mutate a cleared path', async () => {
  const permission = deferred(); let reads = 0;
  const f = fixture({ fetchImpl: async url => url.endsWith('/pathfinder-authorization')
    ? ++reads === 5 ? permission.promise : Response.json({ authorized: true, loadId: uuid(4) })
    : Response.json({ projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 1, totalBytes: 1 }) });
  await f.loaded(); const shown = await displayComputedForTransparency(f, uuid(113));
  f.send('SET_PATH_TRANSPARENCY', { routeRequestId: shown.requestId, percent: 75 }); await turn(); assert.equal(reads, 5);
  f.send('CLEAR_ROUTE', { reason: 'user' }); permission.resolve(Response.json({ authorized: true, loadId: uuid(4) })); await turn();
  assert.equal(f.facts.transparency, undefined); assert.equal(f.messages('PATH_TRANSPARENCY_UPDATED').length, 0); f.bridge.dispose();
});

test('partial appearance restoration errors are sanitized and leave Clear available for retry', async () => {
  for (const type of ['CLEAR_ROUTE', 'SHOW_ROUTE', 'START_MODEL_CAPTURE', 'BEGIN_COMPUTED_PATH']) {
    let broken = false;
    const f = fixture({ clearRoute: () => { if (broken) throw Object.assign(new Error('private://material-token'), { code: 'APPEARANCE_RESTORE_FAILED' }); } });
    await f.loaded(); await displayComputedForTransparency(f, uuid(114)); broken = true;
    const payload = type === 'CLEAR_ROUTE' ? { reason: 'user' } : type === 'SHOW_ROUTE' ? { rawRouting: 'BC1', source: 'manual', cableId: null }
      : type === 'BEGIN_COMPUTED_PATH' ? { pathId: uuid(115), pointCount: 1, objectIds: [] }
        : { captureId: uuid(116), routeCodes: ['BC1'], allowedCategories: ['Control'], equipmentNames: [] };
    f.send(type, payload); await turn();
    const result = f.messages('ERROR').at(-1); assert.equal(result.payload.code, 'APPEARANCE_RESTORE_FAILED', type);
    assert.equal(result.payload.retryable, true); assert.match(result.payload.message, /Press Clear again/);
    assert.equal(JSON.stringify(f.sent).includes('material-token'), false); assert.equal(f.messages('ROUTE_CLEARED').length, 0);
    broken = false; f.send('CLEAR_ROUTE', { reason: 'user' }); await turn();
    assert.equal(f.messages('ROUTE_CLEARED').length, 1, type); f.bridge.dispose();
  }
});

test('model capture transport is request-bound, reauthorizes each part and reserves the replay budget', async () => {
  const f = fixture(); await f.loaded(); const captureId = uuid(17);
  const start = f.send('START_MODEL_CAPTURE', { captureId, routeCodes: ['BC1'], allowedCategories: ['Control'], equipmentNames: ['EQ-001'] }); await turn();
  f.send('READ_MODEL_CAPTURE', { captureId, index: 1 }); await turn();
  assert.deepEqual(f.messages('MODEL_CAPTURE_EVENT').map(value => [value.payload.index, value.payload.done]), [[0, false], [1, true]]);
  assert.equal(f.messages('MODEL_CAPTURE_EVENT')[0].requestId, start.requestId);
  assert.equal(f.fetches.filter(value => value.url.endsWith('/pathfinder-authorization')).length, 4); f.bridge.dispose();
  const g = fixture(); await g.loaded();
  for (let i = 0; i < 1090; i++) g.send('CANCEL_REQUEST', { targetRequestId: uuid(8000 + i) });
  g.send('START_MODEL_CAPTURE', { captureId, routeCodes: ['BC1'], allowedCategories: ['LV'], equipmentNames: [] }); await turn();
  assert.equal(g.messages('MODEL_CAPTURE_EVENT').length, 0); assert.equal(g.messages('ERROR').at(-1).payload.code, 'CAPTURE_RELOAD_REQUIRED'); g.bridge.dispose();
});
test('the overall capture deadline starts before initial authorization and refuses a delayed start', async t => {
  let now = 1000000, started = 0; t.mock.method(Date, 'now', () => now); const permission = deferred();
  const f = fixture({ startModelCapture: async ({ captureId }) => { started++; return { captureId, index: 0, done: false, eventJson: '{}' }; }, fetchImpl: async url => url.endsWith('/pathfinder-authorization') ? permission.promise : Response.json({ projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 1, totalBytes: 1 }) });
  t.after(() => f.bridge.dispose()); await f.loaded(); f.send('START_MODEL_CAPTURE', { captureId: uuid(119), routeCodes: ['BC1'], allowedCategories: ['LV'], equipmentNames: [] }); await turn();
  now += 300001; permission.resolve(Response.json({ authorized: true, loadId: uuid(4) })); await turn();
  assert.equal(started, 0); assert.equal(f.messages('MODEL_CAPTURE_EVENT').length, 0); assert.equal(f.messages('ERROR').at(-1).payload.code, 'EXTRACTION_FAILED');
});
test('a final capture response cannot publish after delayed postauthorization exceeds the shared deadline', async t => {
  let now = 2000000, authorizations = 0; t.mock.method(Date, 'now', () => now); const permission = deferred();
  const f = fixture({ fetchImpl: async url => url.endsWith('/pathfinder-authorization') ? ++authorizations === 4 ? permission.promise : Response.json({ authorized: true, loadId: uuid(4) }) : Response.json({ projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 1, totalBytes: 1 }) });
  t.after(() => f.bridge.dispose()); await f.loaded(); const captureId = uuid(120);
  f.send('START_MODEL_CAPTURE', { captureId, routeCodes: ['BC1'], allowedCategories: ['LV'], equipmentNames: [] }); await turn();
  f.send('READ_MODEL_CAPTURE', { captureId, index: 1 }); await turn(); assert.equal(authorizations, 4);
  now += 300001; permission.resolve(Response.json({ authorized: true, loadId: uuid(4) })); await turn();
  assert.equal(f.messages('MODEL_CAPTURE_EVENT').length, 1); assert.equal(f.messages('ERROR').at(-1).payload.code, 'EXTRACTION_FAILED');
});
test('staged input ACKs and first output stay separately typed and reauthorize every round', async () => {
  let p;
  const f = fixture({ startModelCapture: async ({ captureId }) => ({ captureId, phase: 'receiving', receivedNameCount: 0, scopeSha256: null, equipmentNamesSha256: null }), readModelCapture: async value => Object.hasOwn(value, 'equipmentOffset') ? ({ captureId: value.captureId, phase: 'ready', receivedNameCount: 1, scopeSha256: p.descriptor.scopeSha256, equipmentNamesSha256: p.descriptor.equipmentNamesSha256 }) : ({ captureId: value.captureId, index: 0, done: false, eventJson: '{}' }) });
  await f.loaded();
  p = await planModelCaptureInput({ routeCodes: ['BC1'], allowedCategories: ['LV'], equipmentNames: ['EQ-1'] }, { captureId: uuid(117), envelopeIdentity: { instanceId: uuid(1), projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4) } });
  f.send('START_MODEL_CAPTURE', p.startPayload); await turn(); f.send('READ_MODEL_CAPTURE', p.chunks[0]); await turn(); f.send('READ_MODEL_CAPTURE', { captureId: uuid(117), index: 0 }); await turn();
  assert.equal(f.messages('MODEL_CAPTURE_INPUT_ACK').length, 2); assert.equal(f.messages('MODEL_CAPTURE_EVENT').length, 1); assert.equal(f.fetches.filter(r => r.url.endsWith('/pathfinder-authorization')).length, 6); f.bridge.dispose();
});
test('Clear or revoked authority after a staged append cannot publish a late input ACK', async () => {
  for (const revoke of [false, true]) {
    const gate = deferred(); let blocked = false;
    const p = await planModelCaptureInput({ routeCodes: ['BC1'], allowedCategories: ['LV'], equipmentNames: ['EQ-1'] }, { captureId: uuid(118), envelopeIdentity: { instanceId: uuid(1), projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4) } });
    const f = fixture({ startModelCapture: async ({ captureId }) => ({ captureId, phase: 'receiving', receivedNameCount: 0, scopeSha256: null, equipmentNamesSha256: null }), readModelCapture: async ({ captureId }) => { await gate.promise; return { captureId, phase: 'ready', receivedNameCount: 1, scopeSha256: p.descriptor.scopeSha256, equipmentNamesSha256: p.descriptor.equipmentNamesSha256 }; }, fetchImpl: async url => url.endsWith('/pathfinder-authorization') ? blocked ? new Response('', { status: 403 }) : Response.json({ authorized: true, loadId: uuid(4) }) : Response.json({ projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 342, totalBytes: 439007803 }) });
    await f.loaded(); f.send('START_MODEL_CAPTURE', p.startPayload); await turn(); assert.equal(f.messages('MODEL_CAPTURE_INPUT_ACK').length, 1);
    f.send('READ_MODEL_CAPTURE', p.chunks[0]); await turn(); if (revoke) blocked = true; else f.send('CLEAR_ROUTE', { reason: 'user' }); gate.resolve(); await turn(); assert.equal(f.messages('MODEL_CAPTURE_INPUT_ACK').length, 1); if (revoke) assert.equal(f.messages('ERROR').at(-1).payload.code, 'ACCESS_REVOKED'); f.bridge.dispose();
  }
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
