import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PINS, LIMITS, digest, resourcePin, sessionDto, cookieFrom, descriptor, resource, validateCapsule, allowedAuthMetadata, executeAuth, boundedRequest, publicBinding, sameSource } from './auth-lib.mjs';

const now = Date.parse('2026-10-18T18:00:00.000Z'), actorId = '01111111-1111-4111-8111-111111111111', sourceOwner = '02222222-2222-4222-8222-222222222222';
const fixture = await fs.readFile(fileURLToPath(new URL('../../pathfinder-engine/.scratch/pf2-converted/package/resources/output/0/objects_attrs.json.gz', import.meta.url)));
assert.equal(fixture.length, PINS.resource.bytes); assert.equal(digest(fixture), PINS.resource.sha256);
const headers = { cacheControl: 'private, no-store', corp: 'same-origin', nosniff: 'nosniff', contentLength: null, contentEncoding: null, contentRange: null, setCookie: [] };
const response = (status, value, more = {}) => ({ status, bytes: Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)), headers: { ...headers, ...more } });
const makeSession = (loadId = randomUUID()) => ({ sessionId: randomUUID(), projectId: PINS.projectId, modelVersionId: PINS.modelVersionId, loadId, expiresAt: new Date(now + 300000).toISOString(), absoluteExpiresAt: new Date(now + 1800000).toISOString() });
const cookie = (session, secret = 'A'.repeat(43)) => `wfc_viewer_session=${secret}; Max-Age=300; Path=/api/projects/${PINS.projectId}/model-versions/${PINS.modelVersionId}/viewer-sessions/${session.sessionId}/; Expires=Sun, 18 Oct 2026 18:05:00 GMT; HttpOnly; SameSite=Strict`;
const desc = session => ({ projectId: PINS.projectId, modelVersionId: PINS.modelVersionId, loadId: session.loadId, contentFingerprint: PINS.fingerprint, supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: 'resources/output/0/0.svf', resourceCount: 342, totalBytes: '439007803' });
const targetRuntime = 'pathfinder-engine/.scratch/copied-recovery-target-04444444-4444-4444-8444-444444444444';
const binding = port => ({ origin: 'http://127.0.0.1:' + port, state: { runtime: 'fixture/source', owner: port === 5191 ? sourceOwner : '03333333-3333-4333-8333-333333333333', project: port === 5191 ? 'fixture-source' : 'fixture-target', port, restore: { backupId: '05555555-5555-4555-8555-555555555555' }, demo: { adminUserId: actorId } }, resources: { containers: ['api', 'web', 'postgres', 'minio', 'storage-ready'].map((role, i) => ({ role, id: String(port) + String(i).repeat(60), image: 'sha256:' + String(i).repeat(64), startedAt: new Date(now).toISOString() })) } });
function setup({ mode = 'prepare-source', change = () => {}, capsule, guard } = {}) {
  const events = [], checkpoints = [], calls = [], target = binding(mode === 'check-target' ? 5192 : 5191);
  let session, token;
  const io = { now: () => now, uuid: randomUUID, owner: randomUUID(), runtimeRelative: targetRuntime, signal: new AbortController().signal, guard: async () => guard ? guard(target) : target, credentials: async () => ({ email: 'fixture@example.invalid', password: 'not-a-real-password' }), append: async (type, value) => events.push({ type, value }), checkpoint: async (name, value) => checkpoints.push({ name, value }), request: async input => {
    calls.push(input); let result;
    if (input.path === '/api/auth/login') {
      token = ['fixture', Buffer.from(JSON.stringify({ sub: actorId, jti: randomUUID(), exp: Math.floor(now / 1000) + 604800 })).toString('base64url'), 'signature'].join('.');
      result = response(200, { token, user: { id: actorId, isAdmin: true }, expiresInSeconds: 604800 });
    } else if (input.path === '/api/users/me') result = response(mode === 'check-target' && input.bearer === capsule?.bearer ? 401 : 200, { user: { id: actorId, isAdmin: true } });
    else if (input.method === 'POST') { session = makeSession(input.body.loadId); result = response(201, session, { setCookie: [cookie(session, mode === 'check-target' ? 'B'.repeat(43) : 'A'.repeat(43))] }); }
    else if (mode === 'check-target' && input.cookie === capsule.cookie) result = response(410, { code: 'SESSION_REVOKED' });
    else if (input.binary) result = response(200, fixture, { contentLength: String(fixture.length) });
    else result = response(200, desc(session ?? capsule.session));
    change(input, result); return result;
  } };
  const run = () => executeAuth({ mode, binding: target, capsule, resourceProvenance: { path: 'fixture/source.json', sha256: 'a'.repeat(64), resource: PINS.resource }, io });
  return { run, events, checkpoints, calls, io, target };
}
const sourceProof = await setup().run(); const capsule = sourceProof.capsule;

test('normal seven-day login and fresh generated Viewer session prove descriptor and actual retained997B SHA', async () => {
  const s = setup(), r = await s.run(); assert.equal(r.status, 'PASS'); assert.equal(r.outcomes.length, 5); assert.equal(r.capsule.loginId.length, 36); assert.equal(r.capsule.resource.sha256, PINS.resource.sha256);
  assert.equal(s.calls[0].body.password, 'not-a-real-password'); assert.equal(JSON.stringify(s.events).includes('not-a-real-password'), false); assert.equal(JSON.stringify(s.events.filter(e => e.type === 'response' && e.value.label === 'fresh_login')).includes('signature'), false);
  assert.equal(s.checkpoints.at(-1).name, 'capsule'); assert.equal(r.renewed, false); assert.equal(r.deletedSessions, 0);
});
test('source old exact bearer/cookie remains valid after authorized same-container starttime changes', async () => {
  const s = setup({ mode: 'check-source', capsule }); s.target.resources.containers.forEach(c => { c.startedAt = new Date(now + 100).toISOString(); });
  const r = await s.run(); assert.equal(r.outcomes.length, 3); assert.ok(s.calls.every(x => x.method === 'GET')); assert.equal(s.calls[0].bearer, capsule.bearer); assert.equal(s.calls[1].cookie, capsule.cookie);
});
test('target exact old bearer401 and originalcookie410 SESSION_REVOKED precede independent fresh access', async () => {
  const s = setup({ mode: 'check-target', capsule }), r = await s.run(); assert.equal(r.status, 'PASS'); assert.equal(r.outcomes.length, 7); assert.equal(r.freshTargetSession.actorId, actorId); assert.match(r.freshTargetSession.loginId, /^[a-f0-9-]{36}$/); assert.equal(r.freshTargetSession.projectId, PINS.projectId);
  assert.ok(s.calls.every(x => x.origin === 'http://127.0.0.1:5192')); assert.equal(s.calls[1].cookie, capsule.cookie); assert.equal(s.calls[1].bearer, undefined);
  const metadata = s.checkpoints.find(c => c.name === 'allowed-auth').value;
  assert.equal(metadata.schemaVersion, 'pathfinder.copied-recovery.allowed-auth.v1'); assert.equal(metadata.secretSha256, digest('B'.repeat(43))); assert.notEqual(metadata.secretSha256, digest('wfc_viewer_session=' + 'B'.repeat(43))); assert.equal(metadata.target.runtime, targetRuntime); assert.equal(metadata.target.backupId, s.target.state.restore.backupId);
  assert.equal(JSON.stringify(metadata).includes('signature'), false); assert.equal(JSON.stringify(metadata).includes('wfc_viewer_session='), false); assert.equal(metadata.loginId, r.freshTargetSession.loginId);
});
test('allowed-auth metadata refuses source target profile or missing backup identity', async () => { const s = setup({ mode: 'check-target', capsule }); await s.run(); const fresh = s.checkpoints.find(c => c.name === 'session').value; assert.throws(() => allowedAuthMetadata(binding(5191), fresh, targetRuntime), { code: 'AUTH_ALLOWED_TARGET' }); assert.throws(() => allowedAuthMetadata({ ...binding(5192), state: { ...binding(5192).state, restore: {} } }, fresh, targetRuntime), { code: 'AUTH_ALLOWED_TARGET' }); });
test('allowed-auth contains exact server-compatible dates and only one bound normal pair', async () => { const s = setup({ mode: 'check-target', capsule }); const r = await s.run(), m = s.checkpoints.find(c => c.name === 'allowed-auth').value; assert.deepEqual(Object.keys(m).sort(), ['schemaVersion','target','actorId','loginId','sessionId','loadId','projectId','modelVersionId','loginExpiresAt','sessionExpiresAt','sessionAbsoluteExpiresAt','secretSha256'].sort()); assert.equal(m.loginExpiresAt, new Date(now + 604800000).toISOString()); assert.equal(m.sessionId, r.freshTargetSession.sessionId); assert.equal(m.sessionExpiresAt, r.freshTargetSession.expiresAt); assert.equal(m.sessionAbsoluteExpiresAt, r.freshTargetSession.absoluteExpiresAt); });
for (const [label, status, code] of [['expired', 410, 'SESSION_EXPIRED'], ['origin denied', 403, 'VIEWER_ORIGIN_DENIED'], ['unauthenticated', 401, 'AUTH_REQUIRED'], ['success', 200, undefined]]) test('target ' + label + ' cannot masquerade as persistent fencing', async () => {
  const s = setup({ mode: 'check-target', capsule, change: (i, r) => { if (i.cookie === capsule.cookie) { r.status = status; r.bytes = Buffer.from(JSON.stringify({ code })); } } });
  await assert.rejects(s.run(), { code: 'AUTH_PERSISTENT_FENCE_NOT_PROVED' }); assert.equal(s.calls.length, 2); assert.equal(s.events.at(-1).type, 'response');
});
test('old bearer200 refuses JWT rotation claim before any fresh target mutation', async () => {
  const s = setup({ mode: 'check-target', capsule, change: (i, r) => { if (i.bearer === capsule.bearer) r.status = 200; } }); await assert.rejects(s.run(), { code: 'AUTH_JWT_ROTATION_NOT_PROVED' }); assert.equal(s.calls.length, 1);
});
test('expired source bearer refuses before network and never gets silently refreshed', async () => {
  const s = setup({ mode: 'check-target', capsule: { ...capsule, loginExpiresAt: new Date(now - 1).toISOString() } }); await assert.rejects(s.run(), { code: 'AUTH_SOURCE_BEARER_EXPIRED' }); assert.equal(s.calls.length, 0);
});
test('source expiry is actual failure rather than backup revocation proof', async () => {
  const s = setup({ mode: 'check-source', capsule, change: (i, r) => { if (i.path.endsWith('/descriptor')) { r.status = 410; r.bytes = Buffer.from('{"code":"SESSION_EXPIRED"}'); } } }); await assert.rejects(s.run(), { code: 'AUTH_DESCRIPTOR_STATUS' }); assert.equal(s.events.at(-1).value.status, 410);
});
for (const [label, mutate, code] of [
  ['wrong actor', r => { const v = JSON.parse(r.bytes); v.user.id = randomUUID(); r.bytes = Buffer.from(JSON.stringify(v)); }, 'AUTH_LOGIN_IDENTITY'],
  ['wrong expires', r => { const v = JSON.parse(r.bytes); v.expiresInSeconds = 0; r.bytes = Buffer.from(JSON.stringify(v)); }, 'AUTH_LOGIN_IDENTITY'],
  ['invalid claims', r => { const v = JSON.parse(r.bytes); v.token = 'invalid.jwt.token'; r.bytes = Buffer.from(JSON.stringify(v)); }, 'AUTH_LOGIN_CLAIMS'],
  ['failed login', r => { r.status = 401; }, 'AUTH_LOGIN']
]) test(label + ' normal login refuses without session creation', async () => {
  const s = setup({ change: (i, r) => { if (i.path === '/api/auth/login') mutate(r); } }); await assert.rejects(s.run(), { code }); assert.equal(s.calls.length, 1); assert.equal(s.events.at(-1).value.loginBodyOmitted, true);
});
for (const [label, mutate] of [['fingerprint', v => { v.contentFingerprint = '0'.repeat(64); }], ['model', v => { v.modelVersionId = randomUUID(); }], ['load', v => { v.loadId = randomUUID(); }], ['count', v => { v.resourceCount--; }]]) test('wrong descriptor ' + label + ' is journaled before refusal', async () => {
  const s = setup({ change: (i, r) => { if (i.path.endsWith('/descriptor')) { const v = JSON.parse(r.bytes); mutate(v); r.bytes = Buffer.from(JSON.stringify(v)); } } }); await assert.rejects(s.run(), { code: 'AUTH_DESCRIPTOR_IDENTITY' }); assert.equal(s.events.at(-1).value.label, 'fresh_descriptor'); assert.ok(s.events.at(-1).value.bodyBase64);
});
for (const [label, mutate] of [['SHA', r => { r.bytes = Buffer.alloc(997); }], ['partial status', r => { r.status = 206; }], ['length', r => { r.headers.contentLength = '996'; }], ['encoding', r => { r.headers.contentEncoding = 'gzip'; }]]) test('resource ' + label + ' mismatch cannot pass', async () => {
  const s = setup({ change: (i, r) => { if (i.binary) mutate(r); } }); await assert.rejects(s.run(), { code: 'AUTH_RESOURCE_IDENTITY' }); assert.equal(s.events.at(-1).value.label, 'fresh_resource'); assert.equal(s.checkpoints.some(x => x.name === 'capsule'), false);
});
test('final changed binding refuses before publishing usable source capsule', async () => {
  const s = setup({ guard: target => ({ ...target, state: { ...target.state, owner: randomUUID() } }) }); await assert.rejects(s.run(), { code: 'AUTH_BINDING_CHANGED' }); assert.equal(s.checkpoints.some(x => x.name === 'capsule'), false);
});
test('cancel before dispatch produces no HTTP activity', async () => { const s = setup(); const c = new AbortController(); c.abort(); s.io.signal = c.signal; await assert.rejects(s.run(), { code: 'AUTH_CANCELLED_OR_DEADLINE' }); assert.equal(s.calls.length, 0); });
test('unknown transport error is sanitized and journaled without retry', async () => { const s = setup(); s.io.request = async () => { throw Error('secret token password'); }; await assert.rejects(s.run()); assert.equal(s.events.at(-1).value.code, 'RECOVERY_AUTH_FAILED'); assert.equal(JSON.stringify(s.events).includes('secret'), false); });
test('normal read-only source identity rejects changed container rather than accepting same project', () => { const a = publicBinding(binding(5191)), b = structuredClone(a); b.containers[0].id = 'changed'; assert.throws(() => sameSource(a, b), { code: 'AUTH_SOURCE_CHANGED' }); });
test('resource pin is actual exact manifest-linked property identity', () => { const snapshot = { model: { contentFingerprint: PINS.fingerprint, propertyResources: [PINS.resource, {}, {}, {}, {}] } }; assert.deepEqual(resourcePin(snapshot), PINS.resource); assert.throws(() => resourcePin({ model: { ...snapshot.model, contentFingerprint: 'wrong' } }), { code: 'AUTH_MANIFEST_PROVENANCE' }); });
test('capsule shape rejects absent minted login ID', () => { assert.throws(() => validateCapsule({ ...capsule, loginId: undefined }), { code: 'AUTH_CAPSULE' }); });
test('session scope and idle/absolute timings remain bounded', () => { const s = makeSession(); assert.deepEqual(sessionDto(s, s.loadId, now), s); assert.throws(() => sessionDto({ ...s, expiresAt: new Date(now - 1).toISOString() }, s.loadId, now), { code: 'AUTH_SESSION_TIMING' }); });
for (const [label, value] of [['duplicate', s => [cookie(s), cookie(s)]], ['domain', s => [cookie(s) + '; Domain=127.0.0.1']], ['wrong path', s => [cookie(s).replace(s.sessionId, randomUUID())]], ['not HttpOnly', s => [cookie(s).replace('; HttpOnly', '')]], ['wrong secret', s => [cookie(s).replace('A'.repeat(43), 'invalid')]]]) test('cookie rejects ' + label, () => { const s = makeSession(); assert.throws(() => cookieFrom({ setCookie: value(s) }, s)); });
test('HTTP transport only sends proper matching origin with cookies on protected loopback routes', async () => {
  let received; const r = await boundedRequest({ origin: 'http://127.0.0.1:5192', method: 'GET', path: '/api/users/me', bearer: 'fixture', milliseconds: 1000 }, async (url, options) => { received = { url, options }; return new Response('{"ok":true}', { headers: {} }); });
  assert.equal(r.status, 200); assert.equal(received.options.headers.Origin, 'http://127.0.0.1:5192'); assert.equal(received.options.headers['Sec-Fetch-Site'], 'same-origin'); assert.equal(received.options.redirect, 'error'); assert.equal(received.options.credentials, 'omit');
});
for (const origin of ['http://127.0.0.1:5190', 'http://127.0.0.1:5180', 'https://example.com', 'http://localhost:5191']) test('HTTP rejects unowned origin ' + origin, async () => { let calls = 0; await assert.rejects(boundedRequest({ origin, method: 'GET', path: '/api/users/me', milliseconds: 1000 }, async () => { calls++; })); assert.equal(calls, 0); });
test('HTTP enforces streamed resource limit and cancels reader', async () => { await assert.rejects(boundedRequest({ origin: 'http://127.0.0.1:5191', method: 'GET', path: '/api/resource', binary: true, milliseconds: 1000 }, async () => new Response(Buffer.alloc(LIMITS.resourceBytes + 1))), { code: 'AUTH_HTTP_RESPONSE_BOUND' }); });
test('HTTP redirect/transport failures remain sanitized', async () => { await assert.rejects(boundedRequest({ origin: 'http://127.0.0.1:5191', method: 'GET', path: '/api/users/me', milliseconds: 1000 }, async () => { throw Error('credential'); }), { code: 'AUTH_HTTP_TRANSPORT' }); });
test('descriptor requires private no-store security headers', () => { const s = makeSession(); assert.throws(() => descriptor(response(200, desc(s), { cacheControl: 'public' }), s), { code: 'AUTH_PRIVATE_HEADERS' }); });
test('fixed resource fixture is checked independently against997B raw SHA', () => assert.deepEqual(resource(response(200, fixture, { contentLength: '997' }), PINS.resource), PINS.resource));
