import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDecipheriv, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createWorkspaceSecurity, WorkspaceSecurityError } from '../app/workspace-security.mjs';

const USER = '380e4cb8-32ea-4ae0-92fa-4011a5abe0a0';
const OTHER = '9b3065cb-5c12-4768-bd49-8319aa788239';
const PROJECT = '6eb2648b-0aa6-4cc8-91c1-44759e888250';
const config = { clientId: 'fixture-aps-client', clientSecret: 'PRIVATE_APS_SECRET_NOT_FOR_BROWSER', freePlanConfirmed: true };
const errorCode = (code, status) => error => error instanceof WorkspaceSecurityError && error.code === code && (status === undefined || error.status === status);
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
async function setup(t, options = {}) {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'preparer-workspace-security-'));
  const instances = [];
  t.after(async () => { for (const security of instances) security.close(); assert.equal(path.dirname(directory), parent); await fs.rm(directory, { recursive: true, force: true }); });
  const users = new Map([[USER, { role: 'admin', isAdmin: true }], [OTHER, { role: 'admin', isAdmin: true }]]);
  const control = { offline: false, projectEdit: true, validPassword: 'PRIVATE_WFC_PASSWORD', now: 1793000000000, expiresInSeconds: 3600, beforeMe: null, ...options.control };
  const calls = [];
  const user = id => ({ id, email: id === USER ? 'admin@example.test' : 'other@example.test', firstName: 'Fixture', lastName: 'Admin', ...users.get(id) });
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init }); if (control.offline) throw new Error('Private upstream detail');
    assert.equal(new URL(url).origin, 'https://wfc.example.test'); assert.equal(init.redirect, 'manual'); assert.ok(init.signal instanceof AbortSignal);
    const endpoint = new URL(url).pathname;
    if (endpoint === '/api/auth/login') { const input = JSON.parse(init.body), id = input.email === 'admin@example.test' ? USER : input.email === 'other@example.test' ? OTHER : null; return id && input.password === control.validPassword ? reply({ user: { ...user(id), role: 'admin', isAdmin: true }, token: 'PRIVATE_WFC_' + id, expiresInSeconds: control.expiresInSeconds }) : reply({ error: 'Private validation body' }, 401); }
    const token = new Headers(init.headers).get('Authorization'), id = token?.slice('Bearer PRIVATE_WFC_'.length);
    assert.equal(token, 'Bearer PRIVATE_WFC_' + id); assert.ok(users.has(id));
    if (endpoint === '/api/users/me') { const snapshot = user(id); if (control.beforeMe) await control.beforeMe(); return snapshot.revoked ? reply({ error: 'Deleted user' }, 401) : reply({ user: snapshot }); }
    if (endpoint === '/api/projects') return reply({ projects: [{ id: PROJECT, name: 'Editable', canEdit: control.projectEdit }, { id: OTHER, canEdit: false }] });
    if (endpoint === '/api/projects/' + PROJECT) return reply({ project: { id: PROJECT, name: 'Editable', canEdit: control.projectEdit } });
    if (endpoint === '/api/upload-fixture') { assert.equal(init.duplex, 'half'); assert.equal(Object.hasOwn(init, 'timeoutMs'), false); let body = ''; for await (const chunk of init.body) body += chunk; return reply({ bytes: body.length }); }
    return reply({ error: 'Not found' }, 404);
  };
  if (options.legacy) await fs.writeFile(path.join(directory, 'workspace.enc'), options.legacy);
  const create = async () => { const security = await createWorkspaceSecurity({ directory, wfcOrigin: 'https://wfc.example.test', publicOrigin: options.publicOrigin || 'https://preparer.example.test', fetch: fetchImpl, clock: { now: () => control.now }, seedAPSConfiguration: config }); instances.push(security); return security; };
  const s = { directory, control, calls, users, create, security: await create() };
  s.req = cookie => ({ headers: cookie ? { cookie } : {} });
  s.login = async (id = USER, previous = null) => { const headers = {}; const result = await s.security.login(s.req(previous), { setHeader: (name, value) => { headers[name] = value; } }, { email: user(id).email, password: control.validPassword }); return { result, cookie: headers['Set-Cookie'].split(';')[0], header: headers['Set-Cookie'] }; };
  s.auth = login => s.security.authenticate(s.req(login.cookie));
  s.open = async auth => { const dto = await s.security.openCredentialSession(auth, { ...config, pageId: randomUUID() }); return { dto, binding: s.security.credentialSession(auth, dto.leaseToken, dto.pageId) }; };
  return s;
}
async function decodedState(s) {
  const envelope = JSON.parse(await fs.readFile(path.join(s.directory, 'workspace-auth-v2.enc'), 'utf8')), key = await fs.readFile(path.join(s.directory, 'workspace.key'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64')); decipher.setAAD(Buffer.from('routings-model-preparer/workspace-security/v2/https://wfc.example.test')); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

test('startup ignores env-style seeding and leaves unclaimed legacy APS bytes untouched', async t => {
  const legacy = 'unclaimed legacy PRIVATE_APS bytes, deliberately invalid encrypted data';
  const s = await setup(t, { legacy }); assert.equal(s.calls.length, 0);
  assert.equal(await fs.readFile(path.join(s.directory, 'workspace.enc'), 'utf8'), legacy);
  assert.deepEqual((await fs.readdir(s.directory)).sort(), ['workspace.enc', 'workspace.key']);
  assert.throws(() => s.security.privateSettings(), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
  assert.equal(s.security.getSettings, undefined); assert.equal(s.security.saveSettings, undefined);
});

test('login requires the fresh explicit administrator flag; labels and login reply cannot elevate engineers', async t => {
  const s = await setup(t);
  await assert.rejects(s.security.login(s.req(), { setHeader() {} }, { email: 'admin@example.test', password: 'wrong' }), errorCode('AUTH_INVALID', 401));
  for (const role of ['basic', 'technician', 'engineer', 'admin']) { s.users.set(USER, { role, isAdmin: false }); await assert.rejects(s.login(), errorCode('ADMIN_REQUIRED', 403)); }
  s.users.set(USER, { role: 'admin', isAdmin: 'true' }); await assert.rejects(s.login(), errorCode('WFC_UNAVAILABLE', 503));
  s.users.set(USER, { role: 'engineer', isAdmin: true }); const login = await s.login(); assert.equal(login.result.user.isAdmin, true); assert.equal(Object.hasOwn(login.result, 'token'), false); assert.match(login.header, /HttpOnly; SameSite=Strict;/); assert.match(login.header, /; Secure$/);
});

test('encrypted login survives restart but page credentials, capability and free declaration do not', async t => {
  const s = await setup(t), login = await s.login(), auth = await s.auth(login), { dto, binding } = await s.open(auth);
  assert.doesNotMatch(JSON.stringify(login.result), /PRIVATE|token|password/); assert.doesNotMatch(JSON.stringify(dto), /PRIVATE|fixture-aps|clientSecret|clientId|applicationFingerprint/);
  assert.equal(s.security.privateSettings(binding).clientSecret, config.clientSecret);
  const state = await decodedState(s); assert.deepEqual(Object.keys(state).sort(), ['schemaVersion', 'sessions', 'wfcOrigin']); assert.doesNotMatch(JSON.stringify(state), /PRIVATE_APS|clientSecret|clientId|leaseToken|freePlan|PRIVATE_WFC_PASSWORD/);
  s.security.close(); s.security = await s.create(); const restartedAuth = await s.auth(login); assert.equal(restartedAuth.user.id, USER);
  assert.throws(() => s.security.credentialSession(restartedAuth, dto.leaseToken, dto.pageId), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
  assert.throws(() => s.security.privateSettings(binding), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
  const reopened = await s.open(restartedAuth); assert.notEqual(reopened.dto.configurationId, dto.configurationId);
});

test('two administrators and two tabs remain isolated even when both submit identical keys', async t => {
  const s = await setup(t), first = await s.login(USER), second = await s.login(OTHER), a = await s.auth(first), b = await s.auth(second);
  const one = await s.open(a), two = await s.open(a), other = await s.open(b);
  assert.notEqual(s.security.ownerKey(a), s.security.ownerKey(b));
  assert.equal(s.security.privateSettings(one.binding).applicationFingerprint, s.security.privateSettings(other.binding).applicationFingerprint);
  assert.notEqual(s.security.privateSettings(one.binding).bucket, s.security.privateSettings(other.binding).bucket);
  assert.notEqual(one.dto.configurationId, two.dto.configurationId);
  assert.throws(() => s.security.credentialSession(b, one.dto.leaseToken, one.dto.pageId), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
  assert.throws(() => s.security.credentialSession(a, one.dto.leaseToken, two.dto.pageId), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
  await s.security.revokeCredentialSession(a, one.dto.leaseToken, one.dto.pageId);
  assert.throws(() => s.security.assertBinding(one.binding), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
  assert.equal(s.security.assertBinding(two.binding).ownerId, USER); assert.equal(s.security.assertBinding(other.binding).ownerId, OTHER);
});

test('login replacement invalidates earlier page leases; forged auth and binding objects fail closed', async t => {
  const s = await setup(t), login = await s.login(), auth = await s.auth(login), old = await s.open(auth);
  assert.throws(() => s.security.ownerKey({ ...auth }), errorCode('AUTH_REQUIRED', 401));
  assert.throws(() => s.security.privateSettings({ ...old.binding }), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
  const replacement = await s.login(USER, login.cookie); assert.equal((await s.auth(replacement)).user.id, USER);
  assert.throws(() => s.security.assertBinding(old.binding), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
  await assert.rejects(s.auth(login), errorCode('AUTH_REQUIRED', 401));
});

test('logout aborts and revokes leases immediately, preserves the other administrator and clears the cookie', async t => {
  const s = await setup(t), first = await s.login(USER), second = await s.login(OTHER), a = await s.auth(first), b = await s.auth(second), one = await s.open(a), other = await s.open(b);
  const signal = s.security.assertBinding(one.binding).signal, events = []; s.security.onLeaseRevoked(event => events.push(event));
  const headers = {}, pending = s.security.logout(s.req(first.cookie), { setHeader: (key, value) => { headers[key] = value; } });
  assert.equal(signal.aborted, true); assert.throws(() => s.security.assertBinding(one.binding), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
  await pending; assert.match(headers['Set-Cookie'], /Max-Age=0/); assert.equal(events[0].reason, 'logout'); assert.doesNotMatch(JSON.stringify(events), /PRIVATE|clientId|clientSecret|leaseToken/);
  assert.equal(s.security.assertBinding(other.binding).ownerId, OTHER);
});

test('current demotion, deletion or changed identity revoke old bindings before protected use', async t => {
  const s = await setup(t);
  for (const mode of ['demoted', 'deleted', 'changed']) {
    s.users.set(USER, { role: 'admin', isAdmin: true }); const login = await s.login(), auth = await s.auth(login), { binding } = await s.open(auth);
    if (mode === 'demoted') s.users.set(USER, { role: 'admin', isAdmin: false });
    if (mode === 'deleted') s.users.set(USER, { role: 'admin', isAdmin: true, revoked: true });
    if (mode === 'changed') s.users.set(USER, { role: 'admin', isAdmin: true, id: OTHER });
    await assert.rejects(s.security.refreshBinding(binding), errorCode(mode === 'demoted' ? 'ADMIN_REQUIRED' : 'AUTH_REQUIRED'));
    assert.throws(() => s.security.assertBinding(binding), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
  }
});

test('WFC outage keeps login recoverable but revokes APS leases until explicit keys are entered again', async t => {
  const s = await setup(t), login = await s.login(), auth = await s.auth(login), { binding } = await s.open(auth);
  s.control.offline = true; await assert.rejects(s.security.refreshBinding(binding), error => errorCode('WFC_UNAVAILABLE', 503)(error) && !error.message.includes('Private'));
  assert.throws(() => s.security.assertBinding(binding), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
  s.control.offline = false; const recovered = await s.auth(login); assert.equal(recovered.user.id, USER); assert.equal((await s.open(recovered)).dto.configured, true);
});

test('heartbeat never revives an expired lease and cannot extend beyond the current WFC login', async t => {
  const s = await setup(t, { control: { expiresInSeconds: 150 } }), login = await s.login(), auth = await s.auth(login), { dto, binding } = await s.open(auth);
  s.control.now += 30000; const renewed = await s.security.renewCredentialSession(auth, dto.leaseToken, dto.pageId); assert.equal(renewed.expiresAt, login.result.expiresAt);
  s.control.now += 120000; assert.throws(() => s.security.assertBinding(binding), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
  await assert.rejects(s.security.renewCredentialSession(auth, dto.leaseToken, dto.pageId), errorCode('AUTH_REQUIRED', 401));
});

test('a fresh selected-project check is bound to the lease and rejects lost edit permission', async t => {
  const s = await setup(t), login = await s.login(), auth = await s.auth(login), { dto } = await s.open(auth);
  const binding = s.security.credentialSession(auth, dto.leaseToken, dto.pageId, { projectId: PROJECT });
  assert.equal((await s.security.refreshBinding(binding)).ownerId, USER); assert.deepEqual((await s.security.listProjects(auth)).map(project => project.id), [PROJECT]);
  s.control.projectEdit = false; await assert.rejects(s.security.refreshBinding(binding), errorCode('PROJECT_FORBIDDEN', 403));
  assert.throws(() => s.security.assertBinding(binding), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
});

test('logout during a delayed current-user response cannot resurrect an auth or APS lease', async t => {
  const s = await setup(t), login = await s.login(), auth = await s.auth(login), { binding } = await s.open(auth);
  let release, entered; const ready = new Promise(resolve => { entered = resolve; }); s.control.beforeMe = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const refresh = s.security.refreshBinding(binding); await ready; await s.security.logout(s.req(login.cookie), { setHeader() {} }); release();
  await assert.rejects(refresh, errorCode('AUTH_REQUIRED', 401)); assert.throws(() => s.security.privateSettings(binding), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
});

test('blank, missing or partial credentials never reuse previous values', async t => {
  const s = await setup(t), login = await s.login(), auth = await s.auth(login), { dto, binding } = await s.open(auth);
  for (const input of [{ ...config, clientSecret: '' }, { ...config, clientId: '' }, { freePlanConfirmed: true }, { ...config, bucket: '' }, { ...config, unknown: true }]) await assert.rejects(s.security.openCredentialSession(auth, { ...input, pageId: dto.pageId }), errorCode('SETTINGS_INVALID', 400));
  assert.equal(s.security.privateSettings(binding).clientSecret, config.clientSecret);
  const replacement = await s.security.openCredentialSession(auth, { ...config, freePlanConfirmed: false, pageId: dto.pageId }); assert.notEqual(replacement.configurationId, dto.configurationId); assert.equal(replacement.freePlanConfirmed, false);
  assert.throws(() => s.security.assertBinding(binding), errorCode('CREDENTIAL_SESSION_REQUIRED', 401));
});

test('local cookies remain HttpOnly and Strict; duplicate cookies and forged capabilities fail closed', async t => {
  const s = await setup(t, { publicOrigin: 'http://192.168.1.12:8083' }), login = await s.login(); assert.doesNotMatch(login.header, /Secure/);
  await assert.rejects(s.security.authenticate(s.req(login.cookie + '; ' + login.cookie)), errorCode('AUTH_REQUIRED', 401));
  await assert.rejects(s.security.authenticate(s.req('preparer_session=' + 'a'.repeat(43))), errorCode('AUTH_REQUIRED', 401));
});

test('streaming WFC upload stays on fixed origin, bounds timeout and never follows redirects', async t => {
  const s = await setup(t), login = await s.login(), auth = await s.auth(login);
  const response = await s.security.request(auth, '/api/upload-fixture', { method: 'POST', body: Readable.from(['verified ', 'zip']), timeoutMs: 900000 }); assert.deepEqual(await response.json(), { bytes: 12 });
  await assert.rejects(s.security.request(auth, 'https://evil.example/api/collect', { method: 'POST', body: 'secret' }), errorCode('INVALID_REQUEST'));
  await assert.rejects(s.security.request(auth, '/api/upload-fixture', { timeoutMs: 900001 }), errorCode('INVALID_REQUEST'));
});

test('tampered login store and changed trusted WFC origin fail closed without reading legacy APS data', async t => {
  const s = await setup(t, { legacy: 'untouched' }); await s.login();
  await assert.rejects(createWorkspaceSecurity({ directory: s.directory, wfcOrigin: 'https://another-wfc.example.test' }), errorCode('SECURITY_STORE_INVALID', 500));
  const filename = path.join(s.directory, 'workspace-auth-v2.enc'), envelope = JSON.parse(await fs.readFile(filename, 'utf8')); envelope.ciphertext = Buffer.from('tampered').toString('base64'); await fs.writeFile(filename, JSON.stringify(envelope));
  await assert.rejects(s.create(), errorCode('SECURITY_STORE_INVALID', 500)); assert.equal(await fs.readFile(path.join(s.directory, 'workspace.enc'), 'utf8'), 'untouched');
});
