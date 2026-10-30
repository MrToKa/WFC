import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL, MAX_MESSAGE_BYTES, MAX_BARRIER_SELECTION_MESSAGE_BYTES, validateEnvelope, validateBootstrap, validateDescriptor, parseRouting, normalizeRoutingKey } from '../protocol.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE } from '../barrier-multipart-protocol.mjs';

const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const identity = { instanceId: uuid(1), projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), requestId: uuid(5) };
const envelope = (type, payload, overrides = {}) => ({ channel: CHANNEL, protocolVersion: 1, ...identity, type, payload, ...overrides });
const route = (rawRouting = '/BC1/SECONDARY/BC1') => ({ rawRouting, source: 'manual', cableId: null,
  segments: parseRouting(rawRouting).segments.map(entry => ({ ...entry, model: { state: 'found', matchCount: 1, drawable: true } })),
  ignored: parseRouting(rawRouting).ignored, drawableCount: parseRouting(rawRouting).segments.length, lineCount: 1, warnings: [] });

test('appearance cleanup accepts only a boolean camera-preservation option', () => {
  for (const payload of [{ reason: 'user' }, { reason: 'user', preserveCamera: true }, { reason: 'selection', preserveCamera: false }])
    assert.ok(validateEnvelope(envelope('CLEAR_ROUTE', payload), 'parent-to-frame'));
  for (const payload of [{ reason: 'user', preserveCamera: 'true' }, { reason: 'user', preserveCamera: null }, { reason: 'user', preserveCamera: true, camera: {} }])
    assert.equal(validateEnvelope(envelope('CLEAR_ROUTE', payload), 'parent-to-frame'), null);
});

test('tray-root selection transports only 512 unique current-load IDs within the ordinary byte ceiling', () => {
  assert.ok(validateEnvelope(envelope('READ_TRAY_ROOT_SELECTION', {}), 'parent-to-frame'));
  assert.equal(validateEnvelope(envelope('READ_TRAY_ROOT_SELECTION', { objects: [] })), null);
  const objects = Array.from({ length: 512 }, (_, at) => ({ objectId: at + 1 }));
  const maximum = envelope('TRAY_ROOT_SELECTION', { objects });
  assert.ok(validateEnvelope(maximum, 'frame-to-parent'));
  assert.ok(new TextEncoder().encode(JSON.stringify(maximum)).byteLength <= MAX_MESSAGE_BYTES);
  assert.ok(validateEnvelope(envelope('TRAY_ROOT_SELECTION', { objects: [] }), 'frame-to-parent'));
  for (const value of [objects.concat({ objectId: 513 }), [{ objectId: 1 }, { objectId: 1 }], [{ objectId: 0 }],
    [{ objectId: 2147483648 }], [{ objectId: 1, name: 'Not a metadata page' }], [{ objectId: '1' }]])
    assert.equal(validateEnvelope(envelope('TRAY_ROOT_SELECTION', { objects: value })), null);
  for (const type of ['READ_TRAY_ROOT_SELECTION', 'TRAY_ROOT_SELECTION']) {
    const value = type === 'READ_TRAY_ROOT_SELECTION' ? {} : { objects };
    assert.equal(validateEnvelope(envelope(type, value, { modelVersionId: null, loadId: null })), null);
    assert.equal(validateEnvelope(envelope(type, value), type === 'READ_TRAY_ROOT_SELECTION' ? 'frame-to-parent' : 'parent-to-frame'), null);
  }
});

test('location display is a single current-load ID with an exact direction-bound acknowledgement', () => {
  for (const [type, direction] of [['SHOW_LOCATION', 'parent-to-frame'], ['LOCATION_SHOWN', 'frame-to-parent']]) {
    for (const sdkObjectId of [1, 2147483647]) assert.ok(validateEnvelope(envelope(type, { sdkObjectId }), direction));
    for (const sdkObjectId of [0, -1, 1.5, 2147483648, '2', null, [2], NaN, Infinity]) assert.equal(validateEnvelope(envelope(type, { sdkObjectId })), null);
    for (const payload of [{}, { objectId: 2 }, { sdkObjectId: 2, point: [1, 2, 3] }, { sdkObjectId: 2, token: 'secret' }, { sdkObjectId: 2, modelUrl: '/model' }])
      assert.equal(validateEnvelope(envelope(type, payload)), null);
    assert.equal(validateEnvelope(envelope(type, { sdkObjectId: 2 }, { modelVersionId: null, loadId: null })), null);
    assert.equal(validateEnvelope(envelope(type, { sdkObjectId: 2 }), direction === 'parent-to-frame' ? 'frame-to-parent' : 'parent-to-frame'), null);
  }
});

test('tray display carries one bounded unique root set with a detached exact current-load acknowledgement', () => {
  const maximum = Array.from({ length: 512 }, (_, at) => at + 1);
  for (const [type, direction] of [['SHOW_TRAY', 'parent-to-frame'], ['TRAY_SHOWN', 'frame-to-parent']]) {
    for (const sdkObjectIds of [[1], [2147483647], [23, 24], maximum]) assert.ok(validateEnvelope(envelope(type, { sdkObjectIds }), direction));
    for (const sdkObjectIds of [[], [0], [-1], [1.5], [2147483648], ['2'], [null], [NaN], [Infinity], [2, 2], Array(1), maximum.concat(513), null, 2])
      assert.equal(validateEnvelope(envelope(type, { sdkObjectIds })), null);
    for (const payload of [{}, { sdkObjectId: 2 }, { sdkObjectIds: [2], point: [1, 2, 3] }, { sdkObjectIds: [2], token: 'secret' }])
      assert.equal(validateEnvelope(envelope(type, payload)), null);
    assert.equal(validateEnvelope(envelope(type, { sdkObjectIds: [2] }, { modelVersionId: null, loadId: null })), null);
    assert.equal(validateEnvelope(envelope(type, { sdkObjectIds: [2] }), direction === 'parent-to-frame' ? 'frame-to-parent' : 'parent-to-frame'), null);
    const input = envelope(type, { sdkObjectIds: [23, 24] }), parsed = validateEnvelope(input, direction);
    input.payload.sdkObjectIds[0] = 25; assert.deepEqual(parsed.payload.sdkObjectIds, [23, 24]);
  }
});

test('multipart control preserves old ceilings and accepts no geometry, credentials, URLs or authority', () => {
  const start = { intentId: uuid(71), expectedSessionRevision: '0', scopeSha256: 'a'.repeat(64), profileSha256: 'b'.repeat(64), producerProfile: BARRIER_MULTIPART_PRODUCER_PROFILE };
  assert.ok(validateEnvelope(envelope('START_BARRIER_MULTIPART', start)));
  for (const type of ['STATUS_BARRIER_MULTIPART', 'CANCEL_BARRIER_MULTIPART', 'RECONCILE_BARRIER_MULTIPART']) {
    assert.ok(validateEnvelope(envelope(type, { intentId: uuid(71) })));
    assert.equal(validateEnvelope(envelope(type, { intentId: uuid(71), url: '/elsewhere' })), null);
    assert.equal(validateEnvelope(envelope(type, { intentId: uuid(71) }, { modelVersionId: null, loadId: null })), null);
  }
  for (const extra of [{ vertices: [] }, { token: 'secret' }, { url: '/elsewhere' }, { authority: 'ready' }]) assert.equal(validateEnvelope(envelope('START_BARRIER_MULTIPART', { ...start, ...extra })), null);
  assert.equal(MAX_MESSAGE_BYTES, 65536);
  assert.equal(validateEnvelope(envelope('BARRIER_CAPTURE_EVENT', { captureId: uuid(71), index: 0, done: false, eventJson: 'x'.repeat(24577) })), null);
  assert.equal(validateEnvelope(envelope('READ_BARRIER_CAPTURE', { captureId: uuid(71), index: 3000 })), null);
});

test('only an exact current-model barrier start may carry 2048 parents above the small envelope budget', () => {
  const parents = Array.from({ length: 2048 }, (_, at) => ({ selectionId: uuid(100 + at), kind: 'wall', objectId: 'dbid:' + (at + 1),
    dbId: at + 1, externalId: null, name: 'Original wall ' + at, identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }));
  const scope = { projectId: identity.projectId, modelVersionId: identity.modelVersionId, contentFingerprint: 'a'.repeat(64),
    selectionRevision: '1', captureFrameId: uuid(8), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' };
  const start = envelope('START_BARRIER_CAPTURE', { captureId: uuid(9), scope, selectedParents: parents });
  assert.equal(MAX_MESSAGE_BYTES, 65536); assert.equal(MAX_BARRIER_SELECTION_MESSAGE_BYTES, 4194304);
  assert.ok(new TextEncoder().encode(JSON.stringify(start)).byteLength > MAX_MESSAGE_BYTES);
  assert.deepEqual(validateEnvelope(start, 'parent-to-frame'), start);
  assert.equal(validateEnvelope(start, 'frame-to-parent'), null);
  for (const extra of [{ token: 'secret' }, { vertices: [] }, { url: '/elsewhere' }, { authority: 'ready' }])
    assert.equal(validateEnvelope({ ...start, payload: { ...start.payload, ...extra } }), null);
  assert.equal(validateEnvelope({ ...start, payload: { ...start.payload, scope: { ...scope, projectId: uuid(7777) } } }), null);
  assert.equal(validateEnvelope({ ...start, payload: { ...start.payload, selectedParents: [...parents,
    { ...parents[0], selectionId: uuid(9999), dbId: 9999, objectId: 'dbid:9999' }] } }), null);
  assert.equal(validateEnvelope({ ...start, payload: { ...start.payload,
    selectedParents: parents.map(parent => ({ ...parent, name: '界'.repeat(2048) })) } }), null);
  assert.equal(validateEnvelope(envelope('SHOW_ROUTE', { rawRouting: '/BC1', source: 'manual', cableId: null,
    unrelated: 'x'.repeat(65536) })), null);
  assert.equal(validateEnvelope({ ...start, type: 'START_MODEL_CAPTURE' }), null);
});

test('independent lookup capture is a closed bounded third union without planning rules or equipment', () => {
  const payload = { captureId: uuid(17), lookupRouteCodes: ['/BC001', '/BC002'], equipmentNames: [] };
  assert.ok(validateEnvelope(envelope('START_MODEL_CAPTURE', payload)));
  for (const bad of [{ ...payload, routeCodes: ['BC001'] }, { ...payload, routeRules: [] }, { ...payload, allowedCategories: ['MV'] }, { ...payload, equipmentNames: ['EQ1'] },
    { ...payload, lookupRouteCodes: [] }, { ...payload, lookupRouteCodes: ['/SECONDARY'] }, { ...payload, lookupRouteCodes: ['bc001'] }, { ...payload, lookupRouteCodes: Array(101).fill('/BC001') }, { ...payload, lookupRouteCodes: ['/' + 'A'.repeat(256)] }])
    assert.equal(validateEnvelope(envelope('START_MODEL_CAPTURE', bad)), null);
});

test('shared project/model normalization is the exact strict parser key operation', () => {
  for (const token of ['bc１', ' /BC1/ ', '／ＢＣ１／', 'BC001-2']) assert.equal(normalizeRoutingKey(token), parseRouting(token).segments[0].key);
  assert.equal(normalizeRoutingKey(' secondary '), 'SECONDARY');
  for (const token of ['', '／', 'BC1／BC2', 'BC\u0000X']) assert.throws(() => normalizeRoutingKey(token), { code: 'ROUTE_INVALID' });
});

test('bootstrap accepts only two unique UUID fields and rejects credentials, URLs and unknown query keys', () => {
  const search = `?instanceId=${uuid(1)}&projectId=${uuid(2)}`;
  assert.deepEqual(validateBootstrap(search), { instanceId: uuid(1), projectId: uuid(2) });
  for (const bad of [search + '&jwt=secret', search + '&projectId=' + uuid(2), '?instanceId=x&projectId=' + uuid(2), '?modelUrl=https://example.com', search.toUpperCase()]) assert.equal(validateBootstrap(bad), null);
});

test('parent and frame schemas enforce direction, exact keys and handshake null identities', () => {
  const value = envelope('INIT', { locale: 'bg', expectedSdkVersion: '7.130.0' }, { modelVersionId: null, loadId: null });
  assert.deepEqual(validateEnvelope(value, 'parent-to-frame'), value);
  assert.equal(validateEnvelope(value, 'frame-to-parent'), null);
  assert.equal(validateEnvelope({ ...value, token: 'secret' }), null);
  assert.equal(validateEnvelope({ ...value, modelVersionId: uuid(3) }), null);
  assert.equal(validateEnvelope(envelope('INIT', value.payload)), null);
  assert.equal(validateEnvelope(envelope('MODEL_LOADED', { sdkVersion: '7.130.0', format: 'svf', nodeIndexReady: false })), null);
  assert.ok(validateEnvelope(envelope('MODEL_LOADED', { sdkVersion: '7.130.0', format: 'svf', nodeIndexReady: true })));
});

test('commands have closed payloads and fixed runtime version, no model URLs or auth header input', () => {
  const good = envelope('LOAD_MODEL', { sessionId: uuid(6) });
  assert.ok(validateEnvelope(good));
  for (const payload of [{ ...good.payload, modelUrl: 'https://example.com' }, { ...good.payload, token: 'secret' }, { sessionId: '../x' }, null]) assert.equal(validateEnvelope({ ...good, payload }), null);
  assert.equal(validateEnvelope(envelope('SHOW_ROUTE', { rawRouting: 'BC1', source: 'cable', cableId: null })), null);
  assert.equal(validateEnvelope(envelope('SHOW_ROUTE', { rawRouting: 'BC1', source: 'manual', cableId: uuid(9) })), null);
});

test('only plain detached records are accepted and accessor/prototype/cyclic inputs are rejected', () => {
  const value = envelope('LOAD_MODEL', { sessionId: uuid(6) });
  const parsed = validateEnvelope(value);
  value.payload.sessionId = uuid(7);
  assert.equal(parsed.payload.sessionId, uuid(6));
  assert.equal(validateEnvelope(Object.assign(Object.create({ inherited: true }), value)), null);
  const getter = { ...value };
  Object.defineProperty(getter, 'payload', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.equal(validateEnvelope(getter), null);
  assert.equal(validateEnvelope({ ...value, payload: Object.create({ sessionId: uuid(6) }) }), null);
});

test('routing splits ASCII slash first, normalizes NFKC/case and preserves repeated occurrence indices', () => {
  assert.deepEqual(parseRouting(' // bc１ / SECONDARY // BC1 / '), {
    segments: [{ segmentIndex: 0, token: 'bc１', key: 'BC1' }, { segmentIndex: 2, token: 'BC1', key: 'BC1' }],
    ignored: [{ segmentIndex: 1, token: 'SECONDARY', reason: 'SECONDARY' }],
  });
  for (const raw of ['BC1／BC2', 'BC\u0000X', 'BC\nX', '/'.repeat(2) + 'a'.repeat(8001), Array(101).fill('BC1').join('/')]) assert.throws(() => parseRouting(raw), { code: 'ROUTE_INVALID' });
  assert.equal(parseRouting(Array(100).fill('BC1').join('/')).segments.length, 100);
  assert.deepEqual(parseRouting('/ /SECONDARY/'), { segments: [], ignored: [{ segmentIndex: 0, token: 'SECONDARY', reason: 'SECONDARY' }] });
});

test('route result describes only model occurrences and rejects DB fields and false readiness/counts', () => {
  const value = envelope('ROUTE_RESULT', route());
  assert.ok(validateEnvelope(value, 'frame-to-parent'));
  assert.equal(validateEnvelope({ ...value, payload: { ...value.payload, project: {} } }), null);
  assert.equal(validateEnvelope({ ...value, payload: { ...value.payload, drawableCount: 1 } }), null);
  const changed = structuredClone(value); changed.payload.segments[1].segmentIndex = 1;
  assert.equal(validateEnvelope(changed), null);
  for (const model of [{ state: 'missing', matchCount: 0, drawable: true }, { state: 'ambiguous', matchCount: 1, drawable: false }, { state: 'found', matchCount: 2, drawable: false }]) {
    const invalid = structuredClone(value); invalid.payload.segments[0].model = model;
    assert.equal(validateEnvelope(invalid), null);
  }
  const noGeometry = route('BC1'); noGeometry.segments[0].model.drawable = false; noGeometry.drawableCount = 0; noGeometry.lineCount = 0;
  assert.ok(validateEnvelope(envelope('ROUTE_RESULT', noGeometry)));
});

test('64 KiB boundary counts UTF-8 bytes and applies to complete serialized envelope', () => {
  const value = envelope('ROUTE_RESULT', route('BC1'));
  value.payload.warnings = Array.from({ length: 100 }, () => ({ code: 'MODEL_MISSING', segmentIndex: null, message: '' }));
  let remaining = MAX_MESSAGE_BYTES - Buffer.byteLength(JSON.stringify(value));
  for (const warning of value.payload.warnings) { const length = Math.min(remaining, 1024); warning.message = 'a'.repeat(length); remaining -= length; }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(JSON.stringify(value)), MAX_MESSAGE_BYTES);
  assert.ok(validateEnvelope(value));
  value.payload.warnings.at(-1).message += 'я';
  assert.equal(validateEnvelope(value), null);
});

test('progress rejects fabricated invalid totals and descriptor pins the complete identity/profile/path', () => {
  assert.ok(validateEnvelope(envelope('MODEL_PROGRESS', { phase: 'resources', loaded: 0, total: null })));
  for (const loaded of [NaN, Infinity, -1, 101]) assert.equal(validateEnvelope(envelope('MODEL_PROGRESS', { phase: 'model', loaded, total: 100 })), null);
  const descriptor = { projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 342, totalBytes: 439007803 };
  assert.deepEqual(validateDescriptor(descriptor, identity), descriptor);
  for (const change of [{ loadId: uuid(99) }, { entrypoint: 'https://example.com/0.svf' }, { sdkVersion: '7.131.0' }, { jwt: 'secret' }, { resourceCount: 0 }, { totalBytes: 8589934593 }]) assert.equal(validateDescriptor({ ...descriptor, ...change }, identity), null);
});
