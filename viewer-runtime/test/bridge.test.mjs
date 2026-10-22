import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeBridge } from '../bridge.mjs';
import { CHANNEL, parseRouting } from '../protocol.mjs';
import { planModelCaptureInput } from '../capture-input.mjs';
import { BARRIER_CAPTURE_ERROR_CODES, BARRIER_CAPTURE_ERROR_MESSAGES } from '../barrier-capture-errors.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE } from '../barrier-multipart-protocol.mjs';

const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const turn = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const routingBindings = (overrides = {}) => ({ schemaVersion: 'wfc.viewer.routing-bindings.v1', modelVersionId: uuid(3), contentFingerprint: 'b'.repeat(64), selectionRevision: '12', aggregateId: null, bindings: [], ...overrides });
const preparationVisibilityScope = { schemaVersion: 'wfc.pf.sdk-display-visibility.v1', basis: 'sdk-display-before-pf-appearance', contentSha256: 'a'.repeat(64) };

function fixture(options = {}) {
  const sent = [], fetches = [], loads = [], listeners = new Set(), states = [];
  let next = 20, identity = { modelVersionId: null, loadId: null };
  const bootstrap = { instanceId: uuid(1), projectId: uuid(2) };
  const window = { location: { origin: 'http://localhost:18085' }, crypto: { randomUUID: () => uuid(next++) },
    parent: { postMessage(value, origin) { sent.push({ value, origin }); } },
    addEventListener(type, fn) { if (type === 'message') listeners.add(fn); }, removeEventListener(type, fn) { if (type === 'message') listeners.delete(fn); } };
  const facts = { clears: 0, fits: 0, finishes: 0, disposed: 0, shows: [], bindingShows: [], barrierStarts: 0, barrierReads: 0 };
  const handle = { finish() { facts.finishes++; }, prepareIndex: options.prepareIndex ?? (async () => {}),
    clearRoute() { facts.clears++; return options.clearRoute?.(); }, fitRoute() { facts.fits++; },
    showComputedPath(value) { facts.computedPath = structuredClone(value); },
    pickPoint: options.pickPoint ?? (async () => ({ objectId: 23, point: [1, 2, 3], derivation: 'picked-surface-point' })),
    readModelObjects: options.readModelObjects ?? (async ({ cursor, query }) => ({ cursor, nextCursor: null, complete: true, query, coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [] })),
    readPreparationObjects: options.readPreparationObjects ?? (async request => ({schemaVersion:request.schemaVersion,mode:request.mode,names:request.names,rootObjectId:request.rootObjectId,cursor:request.cursor,matchingPolicyVersion:'wfc.pf.project-exact-candidates.v3',visibilityScope:{...preparationVisibilityScope},indexedObjectCount:1,propertyScan:null,objects:[],nextCursor:null,complete:true})),
    readSelection: options.readSelection ?? (async () => ({ coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: [] })),
    setPathTransparency: options.setPathTransparency ?? (async (percent, _signal, beforeCommit) => { await beforeCommit(); facts.transparency = percent; }),
    startModelCapture: options.startModelCapture ?? (async ({ captureId }) => ({ captureId, index: 0, done: false, eventJson: JSON.stringify({ type: 'metadata', captureId }) })),
    readModelCapture: options.readModelCapture ?? (async ({ captureId, index }) => ({ captureId, index, done: true, eventJson: JSON.stringify({ type: 'complete', captureId }) })),
    async startBarrierCapture(...args) { facts.barrierStarts++; return options.startBarrierCapture ? options.startBarrierCapture(...args) : { captureId: args[0].captureId, index: 0, done: false, eventJson: '{}' }; },
    async readBarrierCapture(...args) { facts.barrierReads++; return options.readBarrierCapture ? options.readBarrierCapture(...args) : { captureId: args[0].captureId, index: args[0].index, done: true, eventJson: '{}' }; },
    showRoute: options.showRoute ?? (async (raw, value) => { facts.shows.push(raw); facts.bindingShows.push(value.routingBindings); return { segments: parseRouting(raw).segments.map(() => ({ status: 'found', count: 1, drawable: true })), lineCount: 1, diagnostics: {} }; }) };
  const adapter = { initialize: options.initialize ?? (async () => {}), async load(value) { loads.push(value); return options.load ? options.load(value) : handle; }, dispose() { facts.disposed++; } };
  const fetchImpl = async (url, init) => {
    fetches.push({ url, init });
    if (options.fetchImpl) return options.fetchImpl(url, init);
    if (url.endsWith('/pathfinder-authorization')) return Response.json({ authorized: true, loadId: identity.loadId });
    if (url.endsWith('/routing-bindings')) {
      const value = await (typeof options.routingBindings === 'function' ? options.routingBindings() : options.routingBindings ?? routingBindings({ modelVersionId: identity.modelVersionId }));
      return value instanceof Response ? value : Response.json(value);
    }
    return Response.json({ projectId: bootstrap.projectId, ...identity, contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 342, totalBytes: 439007803 });
  };
  const bridge = createRuntimeBridge({ window, bootstrap, adapter, fetchImpl, onState: state => states.push(state), resourceMode: options.resourceMode ?? 'human' });
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

const barrierRequest = () => ({ captureId: uuid(9100), scope: { projectId: uuid(2), modelVersionId: uuid(3), contentFingerprint: 'b'.repeat(64),
  selectionRevision: '12', captureFrameId: uuid(9101), captureFrameSha256: 'd'.repeat(64), coordinateFrame: 'canonical-world-metres' }, selectedParents: [{
  selectionId: uuid(9102), kind: 'wall', objectId: 'dbid:23', dbId: 23, externalId: null, name: 'Selected wall', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }] });
const descriptorResponse = () => Response.json({ projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), contentFingerprint: 'b'.repeat(64),
  supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 1, totalBytes: 1 });

const multipartStatus = () => ({ intentId: uuid(9201), sessionRevision: '0', state: 'admitted', counts: { pages: 0, seals: 0, parts: 0 },
  roots: { nodes: null, fragments: null, 'geometry-ranges': null, plan: null }, qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' });
const multipartStart = () => ({ intentId: uuid(9201), expectedSessionRevision: '0', scopeSha256: 'a'.repeat(64), profileSha256: 'b'.repeat(64), producerProfile: BARRIER_MULTIPART_PRODUCER_PROFILE });

test('multipart start/status/cancel/reconcile are small protected controls and do not change route appearance', async () => {
  const f = fixture(); await f.loaded(); const seen = [];
  for (const method of ['startBarrierMultipart', 'statusBarrierMultipart', 'cancelBarrierMultipart', 'reconcileBarrierMultipart']) f.handle[method] = async (...args) => { seen.push([method, args]); return multipartStatus(); };
  f.send('START_BARRIER_MULTIPART', multipartStart()); await turn();
  for (const type of ['STATUS_BARRIER_MULTIPART', 'CANCEL_BARRIER_MULTIPART', 'RECONCILE_BARRIER_MULTIPART']) { f.send(type, { intentId: uuid(9201) }); await turn(); }
  assert.equal(f.messages('BARRIER_MULTIPART_STATUS').length, 4); assert.equal(seen.length, 4);
  assert.equal(typeof seen[0][1][1].open, 'function'); assert.equal(f.facts.clears, 0);
  assert.equal(f.fetches.filter(x => x.url.endsWith('/pathfinder-authorization')).length, 8);
  assert.ok(f.messages('BARRIER_MULTIPART_STATUS').every(x => x.payload.authority === 'none')); f.bridge.dispose();
});
test('multipart initial authorization refusal prevents every producer operation', async () => {
  const f = fixture({ fetchImpl: async url => url.endsWith('/pathfinder-authorization') ? new Response(null, { status: 403 }) : descriptorResponse() }); await f.loaded();
  let calls = 0; f.handle.startBarrierMultipart = async () => { calls++; return multipartStatus(); };
  f.send('START_BARRIER_MULTIPART', multipartStart()); await turn();
  assert.equal(calls, 0); assert.equal(f.messages('ERROR').at(-1).payload.code, 'ACCESS_REVOKED'); f.bridge.dispose();
});
test('multipart background failure stays recoverable but model change stays terminal', async () => {
  for (const code of ['BARRIER_MULTIPART_RECONCILE_REQUIRED', 'BARRIER_MULTIPART_GEOMETRY_UNAVAILABLE', 'MODEL_SELECTION_CHANGED']) {
    const f = fixture(); await f.loaded(); f.handle.statusBarrierMultipart = async () => { throw Object.assign(Error('private geometry'), { code }); };
    f.send('STATUS_BARRIER_MULTIPART', { intentId: uuid(9201) }); await turn();
    assert.equal(f.states.at(-1).phase, code === 'MODEL_SELECTION_CHANGED' ? 'error' : 'loaded');
    assert.equal(JSON.stringify(f.sent).includes('private geometry'), false); assert.equal(f.facts.finishes, 0); f.bridge.dispose();
  }
});
test('calculation-only producer iframe cannot acquire manual barrier authoring controls', async () => {
  const f = fixture({ resourceMode: 'producer' }); await f.loaded(); let calls = 0;
  f.handle.startBarrierMultipart = async () => { calls++; return multipartStatus(); };
  f.send('START_BARRIER_MULTIPART', multipartStart()); await turn();
  assert.equal(calls, 0); assert.equal(f.messages('BARRIER_MULTIPART_STATUS').length, 0); f.bridge.dispose();
});
test('multipart polling reserves the unchanged replay tail for cancellation and exact reconciliation', async () => {
  const f = fixture(); await f.loaded();
  f.handle.statusBarrierMultipart = f.handle.cancelBarrierMultipart = f.handle.reconcileBarrierMultipart = async () => multipartStatus();
  while (f.bridge.getState().requests < 4000) { f.send('STATUS_BARRIER_MULTIPART', { intentId: uuid(9201) }); await turn(); }
  for (let i = 0; i < 150; i++) f.send('STATUS_BARRIER_MULTIPART', { intentId: uuid(9201) });
  await turn(); assert.equal(f.bridge.getState().requests, 4000);
  assert.equal(f.messages('ERROR').at(-1).payload.code, 'BARRIER_MULTIPART_CONTROL_LIMIT');
  const before = f.messages('BARRIER_MULTIPART_STATUS').length;
  f.send('CANCEL_BARRIER_MULTIPART', { intentId: uuid(9201) }); await turn();
  f.send('RECONCILE_BARRIER_MULTIPART', { intentId: uuid(9201) }); await turn();
  assert.equal(f.messages('BARRIER_MULTIPART_STATUS').length, before + 2); assert.ok(f.bridge.getState().requests < 4096); f.bridge.dispose();
});

test('barrier capture authorizes every extracted part before and after its SDK wait', async () => {
  const f = fixture(); await f.loaded(); const input = barrierRequest();
  f.send('START_BARRIER_CAPTURE', input); await turn(); f.send('READ_BARRIER_CAPTURE', { captureId: input.captureId, index: 1 }); await turn();
  assert.equal(f.facts.barrierStarts, 1); assert.equal(f.facts.barrierReads, 1); assert.equal(f.messages('BARRIER_CAPTURE_EVENT').length, 2);
  const authorizations = f.fetches.filter(value => value.url.endsWith('/pathfinder-authorization')); assert.equal(authorizations.length, 4);
  assert.ok(authorizations.every(value => value.init.credentials === 'same-origin' && value.init.cache === 'no-store' && value.init.redirect === 'error'));
  f.bridge.dispose();
});

test('recoverable barrier diagnostics retain the loaded footer and session without transporting raw errors', async () => {
  for (const code of BARRIER_CAPTURE_ERROR_CODES.filter(value => value !== 'BARRIER_CAPTURE_MODEL_CHANGED')) {
    const f = fixture({ startBarrierCapture: async () => { throw Object.assign(Error('private model geometry'), { code }); } });
    await f.loaded(); f.send('START_BARRIER_CAPTURE', barrierRequest()); await turn();
    assert.equal(f.messages('ERROR').at(-1).payload.code, code);
    assert.equal(f.messages('ERROR').at(-1).payload.message, BARRIER_CAPTURE_ERROR_MESSAGES[code]);
    assert.equal(f.states.at(-1).phase, 'loaded'); assert.equal(f.bridge.getState().phase, 'loaded');
    assert.equal(f.facts.finishes, 0); assert.equal(f.facts.disposed, 0); assert.equal(f.messages('BARRIER_CAPTURE_EVENT').length, 0);
    assert.equal(JSON.stringify(f.sent).includes('private model geometry'), false);
    f.send('READ_SELECTION', {}); await turn(); assert.equal(f.messages('MODEL_SELECTION').length, 1); f.bridge.dispose();
  }
});
test('model, authority and resource failures during barrier capture retain their terminal footer classification', async () => {
  for (const code of ['BARRIER_CAPTURE_MODEL_CHANGED', 'MODEL_SELECTION_CHANGED', 'ACCESS_REVOKED', 'RESOURCE_FAILED']) {
    const f = fixture({ startBarrierCapture: async () => { throw Object.assign(Error('private reason'), { code }); } });
    await f.loaded(); f.send('START_BARRIER_CAPTURE', barrierRequest()); await turn();
    assert.equal(f.messages('ERROR').at(-1).payload.code, code); assert.equal(f.states.at(-1).phase, 'error');
    assert.equal(f.messages('BARRIER_CAPTURE_EVENT').length, 0); assert.equal(JSON.stringify(f.sent).includes('private reason'), false); f.bridge.dispose();
  }
});
test('barrier capture initial admin refusal prevents all SDK work', async () => {
  const f = fixture({ fetchImpl: async url => url.endsWith('/pathfinder-authorization') ? new Response(null, { status: 403 }) : descriptorResponse() });
  await f.loaded(); f.send('START_BARRIER_CAPTURE', barrierRequest()); await turn();
  assert.equal(f.facts.barrierStarts, 0); assert.equal(f.messages('BARRIER_CAPTURE_EVENT').length, 0); assert.equal(f.messages('ERROR').at(-1).payload.code, 'ACCESS_REVOKED'); f.bridge.dispose();
});
test('barrier capture role loss during SDK extraction suppresses all extracted geometry', async () => {
  const pending = deferred(); let authorization = 0;
  const f = fixture({ startBarrierCapture: () => pending.promise, fetchImpl: async url => url.endsWith('/pathfinder-authorization')
    ? ++authorization === 1 ? Response.json({ authorized: true, loadId: uuid(4) }) : new Response(null, { status: 403 }) : descriptorResponse() });
  await f.loaded(); const input = barrierRequest(); f.send('START_BARRIER_CAPTURE', input); await turn(); assert.equal(f.facts.barrierStarts, 1);
  pending.resolve({ captureId: input.captureId, index: 0, done: false, eventJson: '{"privateGeometry":"must not escape"}' }); await turn();
  assert.equal(authorization, 2); assert.equal(f.messages('BARRIER_CAPTURE_EVENT').length, 0); assert.equal(JSON.stringify(f.sent).includes('privateGeometry'), false);
  assert.equal(f.messages('ERROR').at(-1).payload.code, 'ACCESS_REVOKED'); f.bridge.dispose();
});
test('barrier fingerprint, project/model/load identity and invalid index cannot reach SDK extraction', async () => {
  const f = fixture(); await f.loaded(); const input = barrierRequest();
  f.send('START_BARRIER_CAPTURE', { ...input, scope: { ...input.scope, contentFingerprint: 'e'.repeat(64) } }); await turn();
  assert.equal(f.messages('ERROR').at(-1).payload.code, 'MODEL_SELECTION_CHANGED');
  const prior = f.bridge.getState().requests;
  f.send('START_BARRIER_CAPTURE', { ...input, scope: { ...input.scope, projectId: uuid(999) } });
  f.send('START_BARRIER_CAPTURE', { ...input, scope: { ...input.scope, modelVersionId: uuid(999) } });
  f.send('START_BARRIER_CAPTURE', input, { loadId: uuid(999) });
  f.send('READ_BARRIER_CAPTURE', { captureId: input.captureId, index: 3000 }); await turn();
  assert.equal(f.bridge.getState().requests, prior); assert.equal(f.facts.barrierStarts, 0); assert.equal(f.facts.barrierReads, 0); f.bridge.dispose();
});
test('barrier and tray capture response kinds cannot consume one another', async () => {
  for (const kind of ['barrier', 'model']) {
    const f = fixture(); await f.loaded(); const input = barrierRequest();
    if (kind === 'barrier') { f.send('START_BARRIER_CAPTURE', input); await turn(); f.send('READ_MODEL_CAPTURE', { captureId: input.captureId, index: 1 }); }
    else { f.send('START_MODEL_CAPTURE', { captureId: input.captureId, routeCodes: ['BC1'], allowedCategories: ['LV'], equipmentNames: [] }); await turn(); f.send('READ_BARRIER_CAPTURE', { captureId: input.captureId, index: 1 }); }
    await turn(); assert.equal(f.messages('ERROR').at(-1).payload.code, 'EXTRACTION_FAILED'); assert.equal(f.facts.barrierReads, 0); f.bridge.dispose();
  }
});
test('barrier capture replay is ignored and foreign capture UUID cannot consume its active scope', async () => {
  const f = fixture(); await f.loaded(); const input = barrierRequest(), start = f.send('START_BARRIER_CAPTURE', input); await turn();
  f.send(start.type, start.payload, start); await turn(); assert.equal(f.facts.barrierStarts, 1);
  f.send('READ_BARRIER_CAPTURE', { captureId: uuid(999), index: 1 }); await turn();
  assert.equal(f.facts.barrierReads, 0); assert.equal(f.messages('ERROR').at(-1).payload.code, 'EXTRACTION_FAILED'); f.bridge.dispose();
});
test('cancelling barrier extraction suppresses a late SDK geometry reply', async () => {
  const pending = deferred(); let capturedSignal;
  const f = fixture({ startBarrierCapture: (_input, signal) => { capturedSignal = signal; return pending.promise; } });
  await f.loaded(); const input = barrierRequest(), command = f.send('START_BARRIER_CAPTURE', input); await turn();
  f.send('CANCEL_REQUEST', { targetRequestId: command.requestId }); assert.equal(capturedSignal.aborted, true);
  pending.resolve({ captureId: input.captureId, index: 0, done: false, eventJson: '{}' }); await turn();
  assert.equal(f.messages('BARRIER_CAPTURE_EVENT').length, 0); assert.equal(f.messages('REQUEST_CANCELLED').at(-1).payload.outcome, 'cancelled'); f.bridge.dispose();
});
test('producer sessions categorically exclude all new barrier extraction commands', async () => {
  const f = fixture({ resourceMode: 'producer' }); await f.loaded(); const before = f.bridge.getState().requests;
  f.send('START_BARRIER_CAPTURE', barrierRequest()); f.send('READ_BARRIER_CAPTURE', { captureId: barrierRequest().captureId, index: 0 }); await turn();
  assert.equal(f.bridge.getState().requests, before); assert.equal(f.facts.barrierStarts, 0); assert.equal(f.facts.barrierReads, 0); f.bridge.dispose();
});
test('barrier extraction reserves its full response allowance and refuses a saturated starting lane', async () => {
  const f = fixture(); await f.loaded(); for (let i = f.bridge.getState().requests; i < 1091; i++) f.send('CLEAR_ROUTE', { reason: 'user' });
  f.send('START_BARRIER_CAPTURE', barrierRequest()); await turn(); assert.equal(f.facts.barrierStarts, 0);
  assert.equal(f.messages('ERROR').at(-1).payload.code, 'CAPTURE_RELOAD_REQUIRED'); f.bridge.dispose();
});
test('barrier extraction shares the unchanged two-operation capability ceiling', async () => {
  const permission = deferred(), f = fixture({ fetchImpl: async url => {
    if (url.endsWith('/pathfinder-authorization')) { await permission.promise; return Response.json({ authorized: true, loadId: uuid(4) }); }
    return descriptorResponse();
  } });
  await f.loaded(); f.send('START_BARRIER_CAPTURE', barrierRequest()); f.send('READ_MODEL_OBJECTS', { cursor: 0, limit: 1, query: '' });
  const rejected = f.send('READ_SELECTION', {}); await turn();
  assert.equal(f.messages('ERROR').find(value => value.requestId === rejected.requestId).payload.code, 'INVALID_STATE'); assert.equal(f.facts.barrierStarts, 0);
  permission.resolve(); await turn(); assert.equal(f.facts.barrierStarts, 1); f.bridge.dispose();
});
test('barrier adapter replies must echo the exact requested capture UUID and part index before emission', async () => {
  for (const mismatch of ['captureId', 'index']) {
    const f = fixture({ startBarrierCapture: async ({ captureId }) => ({ captureId: mismatch === 'captureId' ? uuid(999) : captureId,
      index: mismatch === 'index' ? 1 : 0, done: false, eventJson: '{"privateGeometry":"wrong-scope"}' }) });
    await f.loaded(); f.send('START_BARRIER_CAPTURE', barrierRequest()); await turn();
    assert.equal(f.messages('BARRIER_CAPTURE_EVENT').length, 0); assert.equal(f.messages('ERROR').at(-1).payload.code, 'EXTRACTION_FAILED');
    assert.equal(JSON.stringify(f.sent).includes('privateGeometry'), false); f.bridge.dispose();
  }
});

test('capture timing emits one bounded aggregate without identities or model values', async () => {
  const f = fixture(), observations = [];
  f.window.console = { debug: (...value) => observations.push(value) };
  await f.loaded(); const captureId = uuid(19);
  f.send('START_MODEL_CAPTURE', { captureId, routeCodes: ['PRIVATE-TRAY'], allowedCategories: ['LV'], equipmentNames: ['PRIVATE-EQUIPMENT'] }); await turn();
  assert.equal(observations.length, 0);
  f.send('READ_MODEL_CAPTURE', { captureId, index: 1 }); await turn();
  assert.equal(f.messages('MODEL_CAPTURE_EVENT').length, 2); assert.equal(observations.length, 1);
  const [label, timing] = observations[0]; assert.equal(label, 'WFC capture frame timing'); assert.equal(timing.outcome, 'completed');
  assert.equal(timing.commandCount, 2); assert.equal(timing.authorizationCalls, 4); assert.equal(timing.adapterCalls, 2);
  for (const [key, value] of Object.entries(timing)) if (typeof value === 'number') assert.ok(Number.isFinite(value) && value >= 0 && value <= 3_600_000, key);
  const encoded = JSON.stringify(observations); for (const forbidden of [captureId, uuid(1), uuid(2), 'PRIVATE-TRAY', 'PRIVATE-EQUIPMENT', 'contentFingerprint', 'cookieSecret']) assert.equal(encoded.includes(forbidden), false);
  f.bridge.dispose(); assert.equal(observations.length, 1);
});
test('capture timing logging cannot change success or stopped cleanup', async () => {
  for (const stop of [false, true]) {
    const f = fixture(); let calls = 0; f.window.console = { debug: () => { calls++; throw Error('Broken diagnostic sink'); } };
    await f.loaded(); const captureId = uuid(18);
    f.send('START_MODEL_CAPTURE', { captureId, routeCodes: ['BC1'], allowedCategories: ['LV'], equipmentNames: [] }); await turn();
    if (stop) f.bridge.dispose(); else { f.send('READ_MODEL_CAPTURE', { captureId, index: 1 }); await turn(); }
    assert.equal(calls, 1); assert.equal(f.messages('MODEL_CAPTURE_EVENT').length, stop ? 1 : 2); f.bridge.dispose(); assert.equal(calls, 1);
  }
});

test('preparation exact discovery is current-admin authorized before and after SDK work, cancellation suppresses a late page',async()=>{
 const request={schemaVersion:'wfc.pf.viewer-discovery.v1',mode:'names',names:['TRAY-001'],rootObjectId:null,cursor:0,limit:128,visibilityScope:{...preparationVisibilityScope}};
 for(const cancel of [false,true]){
  const waiting=deferred(),f=fixture({readPreparationObjects:()=>waiting.promise});await f.loaded();const command=f.send('READ_PREPARATION_OBJECTS',request);await turn();
  if(cancel)f.send('CANCEL_REQUEST',{targetRequestId:command.requestId});
  waiting.resolve({schemaVersion:request.schemaVersion,mode:'names',names:request.names,rootObjectId:null,cursor:0,matchingPolicyVersion:'wfc.pf.project-exact-candidates.v3',visibilityScope:{...preparationVisibilityScope},indexedObjectCount:1,propertyScan:null,objects:[],nextCursor:null,complete:true});await turn();
  assert.equal(f.messages('PREPARATION_OBJECTS').length,cancel?0:1);if(!cancel){assert.equal(f.messages('PREPARATION_OBJECTS')[0].payload.matchingPolicyVersion,'wfc.pf.project-exact-candidates.v3');assert.deepEqual(f.messages('PREPARATION_OBJECTS')[0].payload.visibilityScope,request.visibilityScope);}const auth=f.fetches.filter(value=>value.url.endsWith('/pathfinder-authorization'));assert.equal(auth.length,2);if(cancel)assert.equal(auth.at(-1).init.signal.aborted,true);f.bridge.dispose();
 }
});

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

test('each route reads current cookie-bound published mappings without extending the parent command', async () => {
  let reads = 0;
  const f = fixture({ routingBindings: () => routingBindings({ aggregateId: uuid(7), bindings: [{ routeName: '/A105', rootObjectIds: [`dbid:${++reads + 1}`] }] }) });
  await f.loaded();
  for (let i = 0; i < 2; i++) { f.send('SHOW_ROUTE', { rawRouting: '/A105', source: 'cable', cableId: uuid(12) }); await turn(); }
  assert.deepEqual(f.facts.bindingShows.map(value => value.bindings[0].rootObjectIds), [['dbid:2'], ['dbid:3']]);
  const fetches = f.fetches.filter(value => value.url.endsWith('/routing-bindings'));
  assert.equal(fetches.length, 2);
  for (const { url, init } of fetches) {
    assert.equal(url, `http://localhost:18085/api/projects/${uuid(2)}/model-versions/${uuid(3)}/viewer-sessions/${uuid(6)}/routing-bindings`);
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.equal(init.mode, 'same-origin'); assert.equal(init.redirect, 'error'); assert.equal(init.headers, undefined);
  }
  const count = f.facts.shows.length;
  f.send('SHOW_ROUTE', { rawRouting: '/A105', source: 'manual', cableId: null, rootObjectIds: ['dbid:99'] }); await turn();
  assert.equal(f.facts.shows.length, count); assert.equal(f.fetches.filter(value => value.url.endsWith('/routing-bindings')).length, 2); f.bridge.dispose();
});

test('multi-root project mappings remain one logical match and produce an English provenance indication', async () => {
  const f = fixture({ routingBindings: routingBindings({ aggregateId: uuid(7), bindings: [{ routeName: '/A105', rootObjectIds: ['dbid:2', 'dbid:3'] }] }),
    showRoute: async (_raw, options) => {
      assert.deepEqual(options.routingBindings.bindings[0].rootObjectIds, ['dbid:2', 'dbid:3']);
      return { segments: [{ status: 'found', count: 1, drawable: true, mapped: true }], lineCount: 1 };
    } });
  await f.loaded(); f.send('SHOW_ROUTE', { rawRouting: '/A105', source: 'cable', cableId: uuid(12) }); await turn();
  const result = f.messages('ROUTE_RESULT')[0].payload;
  assert.deepEqual(result.segments[0].model, { state: 'found', matchCount: 1, drawable: true });
  assert.deepEqual(result.warnings, [{ code: 'PUBLISHED_TRAY_ROOT_MAPPING', segmentIndex: 0, message: 'This project tray is shown through its published model-root mapping.' }]);
  assert.equal(JSON.stringify(result).includes('dbid:'), false); f.bridge.dispose();
});

test('mapping identity, revision, shape and response budgets are checked before geometry', async () => {
  for (const value of [routingBindings({ modelVersionId: uuid(99) }), routingBindings({ contentFingerprint: 'c'.repeat(64) }), routingBindings({ selectionRevision: 12 }),
    routingBindings({ extra: ['dbid:2'] }), new Response('x'.repeat(28 * 1024 + 1))]) {
    const f = fixture({ routingBindings: value }); await f.loaded(); f.send('SHOW_ROUTE', { rawRouting: 'BC1', source: 'manual', cableId: null }); await turn();
    assert.equal(f.facts.shows.length, 0); assert.equal(f.messages('ROUTE_RESULT').length, 0); assert.equal(f.messages('ERROR').at(-1).payload.code, 'INVALID_MESSAGE'); f.bridge.dispose();
  }
  let reads = 0;
  const f = fixture({ routingBindings: () => routingBindings({ selectionRevision: ++reads === 1 ? '12' : '13' }) });
  await f.loaded();
  for (let i = 0; i < 2; i++) { f.send('SHOW_ROUTE', { rawRouting: 'BC1', source: 'manual', cableId: null }); await turn(); }
  assert.equal(f.facts.shows.length, 1); assert.equal(f.messages('ERROR').at(-1).payload.code, 'INVALID_MESSAGE'); f.bridge.dispose();
});

test('protected mapping refusals preserve sanitized session and permission errors without falling back to names', async () => {
  for (const [status, code] of [[401, 'SESSION_EXPIRED'], [403, 'ACCESS_REVOKED'], [409, 'MODEL_SELECTION_CHANGED'], [410, 'SESSION_EXPIRED'], [503, 'MODEL_UNAVAILABLE']]) {
    const f = fixture({ routingBindings: () => new Response('private mapping details', { status }) }); await f.loaded();
    f.send('SHOW_ROUTE', { rawRouting: 'BC1', source: 'manual', cableId: null }); await turn();
    assert.equal(f.facts.shows.length, 0); assert.equal(f.messages('ERROR').at(-1).payload.code, code); assert.equal(JSON.stringify(f.sent).includes('private'), false); f.bridge.dispose();
  }
});

test('Clear, cancellation, replacement and disposal abort late mapping reads before SDK access', async () => {
  for (const action of ['clear', 'cancel', 'replace', 'dispose']) {
    const pending = deferred(), f = fixture({ routingBindings: () => pending.promise }); await f.loaded();
    const command = f.send('SHOW_ROUTE', { rawRouting: 'BC1', source: 'manual', cableId: null }); await turn();
    const read = f.fetches.find(value => value.url.endsWith('/routing-bindings'));
    if (action === 'clear') f.send('CLEAR_ROUTE', { reason: 'user' });
    if (action === 'cancel') f.send('CANCEL_REQUEST', { targetRequestId: command.requestId });
    if (action === 'replace') f.send('LOAD_MODEL', { sessionId: uuid(7) }, { modelVersionId: uuid(9), loadId: uuid(8) });
    if (action === 'dispose') f.bridge.dispose();
    assert.equal(read.init.signal.aborted, true);
    pending.resolve(routingBindings()); await turn(); assert.equal(f.facts.shows.length, 0); assert.equal(f.messages('ROUTE_RESULT').length, 0); f.bridge.dispose();
  }
});

test('a replacement load resets only its own mapping revision pin', async () => {
  let revision = '12'; const f = fixture({ routingBindings: () => routingBindings({ selectionRevision: revision }) });
  await f.loaded(); f.send('SHOW_ROUTE', { rawRouting: 'BC1', source: 'manual', cableId: null }); await turn();
  revision = '13'; f.send('LOAD_MODEL', { sessionId: uuid(7) }, { loadId: uuid(8) }); await turn();
  f.send('SHOW_ROUTE', { rawRouting: 'BC1', source: 'manual', cableId: null }); await turn();
  assert.deepEqual(f.facts.bindingShows.map(value => value.selectionRevision), ['12', '13']); assert.equal(f.messages('ERROR').length, 0); f.bridge.dispose();
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
