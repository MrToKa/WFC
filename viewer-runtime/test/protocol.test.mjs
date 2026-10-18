import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL, MAX_MESSAGE_BYTES, validateEnvelope, validateBootstrap, validateDescriptor, parseRouting, normalizeRoutingKey } from '../protocol.mjs';

const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const identity = { instanceId: uuid(1), projectId: uuid(2), modelVersionId: uuid(3), loadId: uuid(4), requestId: uuid(5) };
const envelope = (type, payload, overrides = {}) => ({ channel: CHANNEL, protocolVersion: 1, ...identity, type, payload, ...overrides });
const route = (rawRouting = '/BC1/SECONDARY/BC1') => ({ rawRouting, source: 'manual', cableId: null,
  segments: parseRouting(rawRouting).segments.map(entry => ({ ...entry, model: { state: 'found', matchCount: 1, drawable: true } })),
  ignored: parseRouting(rawRouting).ignored, drawableCount: parseRouting(rawRouting).segments.length, lineCount: 1, warnings: [] });

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
