import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createWorkspaceSecurity, WorkspaceSecurityError } from '../app/workspace-security.mjs';

const USER = '380e4cb8-32ea-4ae0-92fa-4011a5abe0a0';
const PROJECT = '6eb2648b-0aa6-4cc8-91c1-44759e888250';
const OTHER = '9b3065cb-5c12-4768-bd49-8319aa788239';
const config = { clientId: 'fixture-aps-client', clientSecret: 'PRIVATE_APS_SECRET_NOT_FOR_BROWSER', region: 'EMEA', bucket: 'fixture-aps-bucket' };
const errorCode = (code, status) => error => error instanceof WorkspaceSecurityError && error.code === code && (status === undefined || error.status === status);
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
async function setup(t, options = {}) {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'preparer-workspace-security-'));
  t.after(async () => { assert.equal(path.dirname(directory), parent); await fs.rm(directory, { recursive: true, force: true }); });
  const control = { role: 'engineer', revoked: false, offline: false, projectEdit: true, validPassword: 'PRIVATE_WFC_PASSWORD', now: Date.now(), expiresInSeconds: 3600, ...options.control };
  const calls = [], token = 'PRIVATE_WFC_BEARER_TOKEN';
  const user = () => ({ id: USER, email: 'engineer@example.test', role: control.role, isAdmin: control.role === 'admin', firstName: 'Test', lastName: 'Engineer' });
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init }); if (control.offline) throw new Error('Foreign failure may contain PRIVATE content');
    assert.equal(new URL(url).origin, 'https://wfc.example.test'); assert.equal(init.redirect, 'manual'); assert.ok(init.signal instanceof AbortSignal);
    const endpoint = new URL(url).pathname;
    if (endpoint === '/api/auth/login') { const input = JSON.parse(init.body); return input.email === 'engineer@example.test' && input.password === control.validPassword ? reply({ user: { ...user(), role: 'admin', isAdmin: true }, token, expiresInSeconds: control.expiresInSeconds }) : reply({ error: 'Private WFC validation body' }, 401); }
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${token}`);
    if (endpoint === '/api/users/me') return control.revoked ? reply({ error: 'Deleted user' }, 401) : reply({ user: user() });
    if (endpoint === '/api/projects') return reply({ projects: [{ id: PROJECT, name: 'Editable', projectNumber: 'P-01', canEdit: control.projectEdit }, { id: OTHER, name: 'Read only', canEdit: false }] });
    if (endpoint === '/api/projects/' + PROJECT) return reply({ project: { id: PROJECT, name: 'Editable', canEdit: control.projectEdit } });
    if (endpoint === '/api/upload-fixture') { assert.equal(init.duplex, 'half'); assert.equal(Object.hasOwn(init, 'timeoutMs'), false); let body = ''; for await (const chunk of init.body) body += chunk; return reply({ bytes: body.length }); }
    return reply({ error: 'Not found' }, 404);
  };
  const create = () => createWorkspaceSecurity({ directory, wfcOrigin: 'https://wfc.example.test', publicOrigin: options.publicOrigin || 'https://preparer.example.test', fetch: fetchImpl, clock: { now: () => control.now }, ...(options.seed ? { seedAPSConfiguration: config } : {}) });
  const s = { directory, control, calls, token, create, security: await create(), cookie: null };
  s.req = () => ({ headers: s.cookie ? { cookie: s.cookie } : {} });
  s.login = async () => { const headers = {}; const result = await s.security.login(s.req(), { setHeader: (name, value) => { headers[name] = value; } }, { email: 'engineer@example.test', password: control.validPassword }); s.cookie = headers['Set-Cookie'].split(';')[0]; return { result, cookie: headers['Set-Cookie'] }; };
  s.auth = () => s.security.authenticate(s.req());
  return s;
}

test('startup performs no WFC request; seeded APS credentials are encrypted and Free tier remains unconfirmed', async t => {
  const s = await setup(t, { seed: true }); assert.equal(s.calls.length, 0);
  const settings = s.security.privateSettings(); assert.equal(settings.clientSecret, config.clientSecret); assert.equal(settings.freePlanConfirmed, false); assert.equal(settings.freePlanConfirmedAt, null); assert.equal(settings.revision, 1); assert.match(settings.configurationId, /^[a-f0-9]{64}$/);
  const encoded = await fs.readFile(path.join(s.directory, 'workspace.enc'), 'utf8'); assert.doesNotMatch(encoded, /PRIVATE|fixture-aps|clientSecret|sessions/);
  if (process.platform !== 'win32') { assert.equal((await fs.stat(path.join(s.directory, 'workspace.key'))).mode & 0o077, 0); assert.equal((await fs.stat(path.join(s.directory, 'workspace.enc'))).mode & 0o077, 0); }
});

test('login uses current WFC database role and refuses bad credentials or nonengineer users', async t => {
  const s = await setup(t);
  await assert.rejects(s.security.login(s.req(), { setHeader() {} }, { email: 'engineer@example.test', password: 'wrong' }), errorCode('AUTH_INVALID', 401));
  s.control.role = 'basic'; await assert.rejects(s.login(), errorCode('ENGINEER_REQUIRED', 403));
  s.control.role = 'engineer'; const loggedIn = await s.login(); assert.equal(loggedIn.result.user.role, 'engineer'); assert.equal(Object.hasOwn(loggedIn.result, 'token'), false); assert.match(loggedIn.cookie, /HttpOnly; SameSite=Strict;/); assert.match(loggedIn.cookie, /; Secure$/);
});

test('opaque cookie and encrypted server session survive restart; password and token never leave safe login response', async t => {
  const s = await setup(t); const login = await s.login();
  assert.doesNotMatch(JSON.stringify(login.result), /PRIVATE|token|password/); assert.doesNotMatch(s.cookie, /PRIVATE/);
  const encoded = await fs.readFile(path.join(s.directory, 'workspace.enc'), 'utf8'); assert.doesNotMatch(encoded, /PRIVATE|password|engineer@example/);
  s.security = await s.create(); const auth = await s.auth(); assert.equal(auth.user.id, USER); assert.equal(auth.token, s.token);
  const headers = {}; await s.security.logout(s.req(), { setHeader: (name, value) => { headers[name] = value; } }); assert.match(headers['Set-Cookie'], /Max-Age=0/);
  await assert.rejects(s.auth(), errorCode('AUTH_REQUIRED', 401)); s.security = await s.create(); await assert.rejects(s.auth(), errorCode('AUTH_REQUIRED', 401));
});

test('HTTP local deployment cookie is still HttpOnly and Strict; duplicate or forged cookies fail closed', async t => {
  const s = await setup(t, { publicOrigin: 'http://192.168.1.12:8083' }); const login = await s.login(); assert.doesNotMatch(login.cookie, /Secure/);
  await assert.rejects(s.security.authenticate({ headers: { cookie: s.cookie + '; ' + s.cookie } }), errorCode('AUTH_REQUIRED', 401));
  await assert.rejects(s.security.authenticate({ headers: { cookie: 'preparer_session=' + 'a'.repeat(43) } }), errorCode('AUTH_REQUIRED', 401));
  await assert.rejects(s.security.getSettings({ user: { role: 'admin' }, token: s.token }), errorCode('AUTH_REQUIRED', 401));
});

test('session expiry, deleted WFC user and engineer demotion revoke access before protected use', async t => {
  const s = await setup(t); await s.login(); const auth = await s.auth(); s.control.role = 'technician';
  await assert.rejects(s.security.listProjects(auth), errorCode('ENGINEER_REQUIRED', 403)); s.control.role = 'engineer'; await assert.rejects(s.auth(), errorCode('AUTH_REQUIRED', 401));
  await s.login(); s.control.revoked = true; await assert.rejects(s.auth(), errorCode('AUTH_REQUIRED', 401)); s.control.revoked = false;
  await s.login(); s.control.now += 3600000; await assert.rejects(s.auth(), errorCode('AUTH_REQUIRED', 401));
});

test('admin-only settings preserve write-only secret and invalidate Free declaration after credential changes', async t => {
  const s = await setup(t, { seed: true }); await s.login(); let auth = await s.auth();
  await assert.rejects(s.security.saveSettings(auth, { freePlanConfirmed: true }), errorCode('ADMIN_REQUIRED', 403));
  s.control.role = 'admin'; const confirmed = await s.security.saveSettings(auth, { freePlanConfirmed: true }); assert.equal(confirmed.freePlanConfirmedBy, USER); assert.equal(confirmed.freePlanConfirmedAt, new Date(s.control.now).toISOString()); assert.equal(Object.hasOwn(confirmed, 'clientSecret'), false); assert.equal(confirmed.clientSecretSet, true);
  const previousId = confirmed.configurationId; const updated = await s.security.saveSettings(auth, { bucket: 'another-fixture-bucket', clientSecret: '' }); assert.equal(updated.freePlanConfirmed, false); assert.equal(updated.freePlanConfirmedBy, null); assert.notEqual(updated.configurationId, previousId); assert.equal(s.security.privateSettings().clientSecret, config.clientSecret);
  const reconfirmed = await s.security.saveSettings(auth, { region: 'US', freePlanConfirmed: true }); assert.equal(reconfirmed.freePlanConfirmed, true); assert.ok(reconfirmed.revision > confirmed.revision);
  s.security = await s.create(); auth = await s.auth(); const visible = await s.security.getSettings(auth); assert.equal(visible.configurationId, reconfirmed.configurationId); assert.doesNotMatch(JSON.stringify(visible), /PRIVATE|clientSecret"/);
  s.control.role = 'engineer'; await assert.rejects(s.security.saveSettings(auth, { bucket: 'third-fixture-bucket' }), errorCode('ADMIN_REQUIRED', 403));
});

test('editable project list and each selected project use current WFC permissions', async t => {
  const s = await setup(t); await s.login(); const auth = await s.auth(); const projects = await s.security.listProjects(auth); assert.deepEqual(projects.map(project => project.id), [PROJECT]);
  assert.equal((await s.security.requireProject(auth, PROJECT)).canEdit, true); s.control.projectEdit = false;
  await assert.rejects(s.security.requireProject(auth, PROJECT), errorCode('PROJECT_FORBIDDEN', 403)); assert.deepEqual(await s.security.listProjects(auth), []);
});

test('streaming WFC upload stays on fixed origin, bounds timeout, adds duplex and never follows redirects', async t => {
  const s = await setup(t); await s.login(); const auth = await s.auth();
  const response = await s.security.request(auth, '/api/upload-fixture', { method: 'POST', body: Readable.from(['verified ', 'zip']), timeoutMs: 900000 }); assert.deepEqual(await response.json(), { bytes: 12 });
  await assert.rejects(s.security.request(auth, 'https://evil.example/api/collect', { method: 'POST', body: 'secret' }), errorCode('INVALID_REQUEST'));
  await assert.rejects(s.security.request(auth, '/api/upload-fixture', { timeoutMs: 900001 }), errorCode('INVALID_REQUEST'));
  assert.ok(s.calls.every(call => new URL(call.url).origin === 'https://wfc.example.test'));
});

test('WFC outage returns a safe error and retains session for recovery', async t => {
  const s = await setup(t); await s.login(); s.control.offline = true;
  await assert.rejects(s.auth(), error => errorCode('WFC_UNAVAILABLE', 503)(error) && !error.message.includes('PRIVATE'));
  s.control.offline = false; assert.equal((await s.auth()).user.id, USER);
});

test('tampered encrypted settings and a changed trusted WFC origin fail closed on restart', async t => {
  const s = await setup(t, { seed: true });
  await assert.rejects(createWorkspaceSecurity({ directory: s.directory, wfcOrigin: 'https://another-wfc.example.test' }), errorCode('SECURITY_STORE_INVALID', 500));
  const filename = path.join(s.directory, 'workspace.enc'), value = JSON.parse(await fs.readFile(filename, 'utf8')); value.ciphertext = Buffer.from('tampered').toString('base64'); await fs.writeFile(filename, JSON.stringify(value));
  await assert.rejects(s.create(), errorCode('SECURITY_STORE_INVALID', 500));
});
