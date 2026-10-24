import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createWorkspaceService } from '../app/workspace-service.mjs';
import { createPreparerService } from '../app/service.mjs';
import { createFakeProvider, createFakeCostProvider } from '../index.mjs';
import { simulationResources } from '../app/simulation.mjs';
import { verifyPackage } from '../../server/vendor/routings-model-package/index.mjs';

const USER = '380e4cb8-32ea-4ae0-92fa-4011a5abe0a0', SECOND_USER = '281e74d9-6540-4b82-a189-c8a0e87075d2', PROJECT = '6eb2648b-0aa6-4cc8-91c1-44759e888250', IMPORT = 'ab7f4dbb-a6bd-45da-9655-9a12e506019a', VERSION = '7841a44a-2e14-4645-966d-f8d315730992';
const credentials = { clientId: 'fixture-aps-client', clientSecret: 'PRIVATE_APS_SECRET', region: 'EMEA', bucket: 'fixture-aps-bucket' };
const hash = value => createHash('sha256').update(value).digest('hex');
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function setup(t, options = {}) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'preparer-workspace-service-'));
  const dataDirectory = path.join(root, 'data'), workDirectory = path.join(root, 'work'), outputDirectory = path.join(root, 'output'), sourceRoot = path.join(root, 'sources'), importRoot = path.join(root, 'imports');
  for (const directory of [dataDirectory, workDirectory, outputDirectory, sourceRoot, importRoot]) await fs.mkdir(directory);
  // Preserve the real package implementation and all guards. Only fixture-safe
  // error codes/lengths are exposed when its private failure would otherwise be
  // scrubbed by the public service DTO.
  const packageDirectory = path.join(root, 'package-diagnostic'); await fs.mkdir(packageDirectory);
  const packageModulePath = path.join(packageDirectory, 'index.mjs'), packageURL = new URL('../../server/vendor/routings-model-package/index.mjs', import.meta.url).href;
  await fs.writeFile(packageModulePath, `import * as api from ${JSON.stringify(packageURL)};\nexport * from ${JSON.stringify(packageURL)};\nexport const packFailures = [];\nexport async function packModel(options) { try { return await api.packModel(options); } catch (error) { const safe = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : null; packFailures.push({code:safe(error.code),cause:safe(error.details?.cause),modelPathLength:options.modelDir.length,outputPathLength:options.output.length}); throw error; } }\n`);
  const packageDiagnostics = await import(pathToFileURL(packageModulePath).href);
  const control = { role: 'admin', projectEdit: true, apsFailure: false, importFailures: 0, imported: [], wfcCalls: [], apsCalls: [], innerEvents: [], innerRoots: [], openingNow: 0, maxOpening: 0, runtimeCount: 0, maxRuntimes: 0, ...options.control };
  const provider = createFakeProvider({ resources: simulationResources(), ...(options.multiRoot ? { handlers: {
    getManifest: async (context, _opts, fixture) => { const value = await fixture.default(); return value.status === 'success' ? { ...value, roots: ['root-one', 'root-two'].map(rootId => ({ rootId, format: 'svf', supportProfile: context.supportProfile })) } : value; },
    getDownloadPlan: async (context, opts, fixture) => ({ schemaVersion: 1, submissionIdentity: context.submissionIdentity, objectId: context.objectId, urn: context.urn, region: context.region, rootId: opts.rootId, supportProfile: context.supportProfile, resources: fixture.provider.transport.describeResources() }),
  } } : {}) });
  const wfcFetch = async (url, init = {}) => {
    control.wfcCalls.push({ url, method: init.method || 'GET' }); assert.equal(new URL(url).origin, 'https://wfc.example.test'); assert.equal(init.redirect, 'manual');
    if (control.wfcUnavailable) throw new Error('Synthetic WFC outage');
    const route = new URL(url).pathname;
    if (route === '/api/auth/login') { const input = JSON.parse(init.body); return ['engineer@example.test', 'second@example.test'].includes(input.email) && input.password === 'PRIVATE_WFC_PASSWORD' ? response({ token: input.email === 'second@example.test' ? 'PRIVATE_SECOND_TOKEN' : 'PRIVATE_WFC_TOKEN', expiresInSeconds: 3600 }) : response({ error: 'Wrong login' }, 401); }
    const headers = new Headers(init.headers); assert.ok(['Bearer PRIVATE_WFC_TOKEN', 'Bearer PRIVATE_SECOND_TOKEN'].includes(headers.get('Authorization')));
    if (route === '/api/users/me') return response({ user: { id: headers.get('Authorization') === 'Bearer PRIVATE_SECOND_TOKEN' ? SECOND_USER : USER, email: 'admin@example.test', role: control.role, isAdmin: control.role === 'admin', firstName: 'Test', lastName: 'Administrator' } });
    if (route === '/api/projects') return response({ projects: [{ id: PROJECT, name: 'Fixture project', projectNumber: 'P-01', canEdit: control.projectEdit }] });
    if (route === '/api/projects/' + PROJECT) return response({ project: { id: PROJECT, name: 'Fixture project', canEdit: control.projectEdit } });
    if (route === `/api/projects/${PROJECT}/model-imports` && init.method === 'POST') {
      assert.equal(headers.get('Content-Type'), 'application/zip'); assert.equal(init.duplex, 'half');
      const chunks = []; for await (const chunk of init.body) chunks.push(Buffer.from(chunk)); const archive = Buffer.concat(chunks);
      assert.equal(headers.get('X-Package-SHA256'), hash(archive)); assert.equal(Number(headers.get('Content-Length')), archive.length); assert.match(headers.get('Idempotency-Key'), /^[a-f0-9-]{36}$/);
      const received = path.join(root, `received-${control.imported.length}.zip`); await fs.writeFile(received, archive); const verification = await verifyPackage(received); assert.equal(verification.status, 'PASS');
      control.imported.push({ archive, hash: hash(archive), key: headers.get('Idempotency-Key') });
      if (control.importFailures > 0) { control.importFailures--; return response({ error: 'Simulated WFC refusal' }, 503); }
      return response({ importId: IMPORT }, 202);
    }
    if (route === `/api/projects/${PROJECT}/model-imports/${IMPORT}`) return response({ job: { state: 'complete', modelVersionId: VERSION } });
    return response({ error: 'Not found' }, 404);
  };
  const apsFetch = async (url, init = {}) => {
    control.apsCalls.push({ url, method: init.method || 'GET' }); assert.equal(new URL(url).origin, 'https://developer.api.autodesk.com'); assert.equal(init.redirect, 'manual');
    if (control.apsFailure) return response({ error: 'Simulated APS refusal' }, 403);
    if (new URL(url).pathname === '/authentication/v2/token') { assert.equal(new Headers(init.headers).get('Authorization'), 'Basic ' + Buffer.from(credentials.clientId + ':' + credentials.clientSecret).toString('base64')); control.afterAPSToken?.(); return response({ access_token: 'PRIVATE_APS_TOKEN', expires_in: 3600 }); }
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer PRIVATE_APS_TOKEN'); return response({ bucketKey: credentials.bucket, bucketOwner: credentials.clientId });
  };
  const config = { mode: 'live', wfcOrigin: 'https://wfc.example.test', host: '127.0.0.1', port: 0, publicOrigin: 'http://127.0.0.1:0', dataDirectory, workDirectory, outputDirectory, sourceRoot, importRoot, packageModulePath, configuration: {}, sdkDirectory: null };
  const costProvider = createFakeCostProvider({ ttlMs: 3600000 });
  const create = () => createWorkspaceService({ config, seedAPSConfiguration: credentials,
    env: { APS_CLIENT_ID: 'ENV_PRIVATE_CLIENT', APS_CLIENT_SECRET: 'ENV_PRIVATE_SECRET', APS_REGION: 'US', APS_BUCKET: 'env-private-bucket' },
    wfcFetch, apsFetch, operationPollMs: 1, importPollMs: 1, derivativePollMs: 1, createInnerService: async innerOptions => {
      control.openingNow++; control.maxOpening = Math.max(control.maxOpening, control.openingNow); control.innerEvents.push('opening'); control.innerRoots.push(innerOptions.configuration.dataDirectory);
      try {
        await control.beforeInnerOpen?.();
        const inner = await createPreparerService({ ...innerOptions, configuration: { ...innerOptions.configuration, mode: 'simulation' }, simulationProvider: provider, simulationCostProvider: costProvider });
        control.runtimeCount++; control.maxRuntimes = Math.max(control.maxRuntimes, control.runtimeCount); control.innerEvents.push('opened');
        const close = inner.close.bind(inner); let closing;
        inner.close = () => closing ||= (async () => { await close(); control.runtimeCount--; control.innerEvents.push('closed'); })();
        return inner;
      } finally { control.openingNow--; }
    } });
  const s = { root, config, control, provider, create, service: await create(), cookie: null, csrf: null, credentials: null, pageId: randomUUID() }; await s.service.listen();
  s.call = async (route, { method = 'GET', input, body, requestId = randomUUID(), headers = {}, authenticated = true, raw = false } = {}) => {
    const result = await fetch(s.service.address + route, { method, redirect: 'manual', headers: { ...(authenticated && s.cookie ? { Cookie: s.cookie } : {}), ...(s.credentials ? { 'X-Preparer-Credentials': s.credentials.leaseToken, 'X-Preparer-Page': s.pageId } : {}), ...(method !== 'GET' ? { Origin: s.service.address, 'X-Preparer-CSRF': s.csrf || '', 'X-Request-Id': requestId } : {}), ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(input !== undefined ? { body: JSON.stringify(input) } : body !== undefined ? { body } : {}) });
    if (result.headers.get('set-cookie')) s.cookie = result.headers.get('set-cookie').split(';')[0];
    const bytes = Buffer.from(await result.arrayBuffer()); let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { value = bytes.toString('utf8'); }
    return { status: result.status, value, bytes, headers: result.headers, ...(raw ? {} : {}) };
  };
  s.login = async (email = 'engineer@example.test') => { s.csrf = (await s.call('/api/session', { authenticated: false })).value.csrfToken; const result = await s.call('/api/session/login', { method: 'POST', input: { email, password: 'PRIVATE_WFC_PASSWORD' } }); assert.equal(result.status, 200, JSON.stringify(result.value)); return result; };
  s.enter = async (values = credentials) => { const saved = await s.call('/api/credential-sessions', { method: 'POST', input: { ...values, pageId: s.pageId, freePlanConfirmed: true } }); assert.equal(saved.status, 200, JSON.stringify(saved.value)); s.credentials = saved.value.credentials; return saved; };
  s.ready = async () => { await s.login(); await s.enter(); const checked = await s.call('/api/autodesk/check', { method: 'POST', input: {} }); assert.equal(checked.status, 200, JSON.stringify(checked.value)); return checked; };
  s.upload = async () => { const value = await s.call('/api/uploads?kind=nwd', { method: 'POST', body: Buffer.from('Synthetic gateway fixture; not real NWD geometry.'), headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'fixture.nwd' } }); assert.equal(value.status, 200, JSON.stringify(value.value)); return value.value.uploadId; };
  s.start = async (extra = {}) => { const uploadId = await s.upload(); const input = { projectId: PROJECT, label: 'Synthetic gateway model', uploadId }; const result = await s.call('/api/generations', { method: 'POST', input, ...extra }); assert.equal(result.status, 202, JSON.stringify(result.value)); return { generation: result.value.generation, input }; };
  s.wait = async (id, status = null) => { let latest; for (let attempt = 0; attempt < 300; attempt++) { const list = await s.call('/api/generations'); assert.equal(list.status, 200, JSON.stringify(list.value)); latest = list.value.generations.find(row => row.id === id); if (latest && (status ? latest.status === status : latest.status !== 'running')) return latest; await pause(500); } throw new Error('Gateway fixture timed out: ' + JSON.stringify(latest)); };
  t.after(async () => { if (packageDiagnostics.packFailures.length) t.diagnostic('Fixture-only pack failures: ' + JSON.stringify(packageDiagnostics.packFailures)); await s.service.close(); assert.equal(path.dirname(root), parent); await fs.rm(root, { recursive: true, force: true }); });
  return s;
}

test('public gateway starts Live without network; WFC login guards every legacy and package route', async t => {
  const s = await setup(t); assert.equal(s.control.wfcCalls.length, 0); assert.equal(s.control.apsCalls.length, 0);
  assert.deepEqual((await s.call('/health', { authenticated: false })).value, { status: 'ok', mode: 'live', authentication: 'wfc' });
  for (const route of ['/api/jobs', '/api/config', '/api/generations', '/api/settings', `/api/generations/${randomUUID()}/package`, '/sdk/viewer3D.min.js']) assert.equal((await s.call(route, { authenticated: false })).status, 401, route);
  const page = await s.call('/', { authenticated: false }); assert.equal(page.status, 200); assert.match(page.value, /WFC/);
  await s.login(); assert.equal((await s.call('/api/jobs')).status, 404, 'Legacy unauthenticated backend route is never forwarded');
  const session = await s.call('/api/session'); assert.equal(session.value.authenticated, true); assert.equal(session.value.settings, undefined); assert.equal(session.value.credentials, undefined); assert.doesNotMatch(JSON.stringify(session.value), /PRIVATE|clientSecret"|access_token/);
  const refused = await s.call('/api/autodesk/check', { method: 'POST', input: {} }); assert.equal(refused.status, 401); assert.equal(refused.value.error.code, 'CREDENTIAL_SESSION_REQUIRED');
});

test('WFC handoff adopts only a current administrator and retains request guards without echoing tokens', async t => {
  const s = await setup(t); s.csrf = (await s.call('/api/session', { authenticated: false })).value.csrfToken;
  const before = s.control.wfcCalls.length;
  for (const headers of [{ Origin: 'https://foreign.example.test' }, { 'X-Preparer-CSRF': '' }]) {
    assert.equal((await s.call('/api/session/handoff', { method: 'POST', authenticated: false, input: { token: 'PRIVATE_WFC_TOKEN' }, headers })).status, 403);
  }
  // Fetch intentionally controls Host itself. Use the native local transport to
  // exercise a real hostile Host header without weakening the product guard.
  const payload = Buffer.from(JSON.stringify({ token: 'PRIVATE_WFC_TOKEN' }));
  const hostStatus = await new Promise((resolve, reject) => {
    const req = http.request(s.service.address + '/api/session/handoff', { method: 'POST', headers: {
      Host: 'foreign.example.test', Origin: s.service.address, 'X-Preparer-CSRF': s.csrf,
      'Content-Type': 'application/json', 'Content-Length': payload.length,
    } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); res.once('error', reject); });
    req.setTimeout(5000, () => req.destroy(new Error('Fixture Host check timed out'))); req.once('error', reject); req.end(payload);
  });
  assert.equal(hostStatus, 403);
  assert.equal(s.control.wfcCalls.length, before, 'Rejected request metadata cannot reach WFC');
  assert.equal((await s.call('/api/session/handoff', { method: 'POST', authenticated: false, input: { token: 'PRIVATE_WFC_TOKEN', clientSecret: 'PRIVATE_APS_SECRET' } })).status, 400);
  const adopted = await s.call('/api/session/handoff', { method: 'POST', authenticated: false, input: { token: 'PRIVATE_WFC_TOKEN' } });
  assert.equal(adopted.status, 200, JSON.stringify(adopted.value)); assert.equal(adopted.value.user.isAdmin, true);
  assert.doesNotMatch(JSON.stringify(adopted.value), /PRIVATE|token|clientId|clientSecret|credentials/);
  const session = await s.call('/api/session'); assert.equal(session.value.authenticated, true); assert.equal(session.value.user.id, USER);
  assert.equal(session.value.credentials, undefined); assert.equal((await s.call('/api/sources')).status, 401);
  assert.equal(s.control.apsCalls.length, 0, 'Adopting WFC login cannot check or start Autodesk work');
  s.cookie = null; s.control.role = 'engineer';
  const denied = await s.call('/api/session/handoff', { method: 'POST', authenticated: false, input: { token: 'PRIVATE_WFC_TOKEN' } });
  assert.equal(denied.status, 403); assert.equal(denied.value.error.code, 'ADMIN_REQUIRED'); assert.equal(s.control.apsCalls.length, 0);
});

test('explicit sign out revokes local login and page credentials during a WFC outage without network calls', async t => {
  const s = await setup(t); await s.ready(); assert.equal((await s.call('/api/sources')).status, 200);
  const previousCookie = s.cookie, before = { wfc: s.control.wfcCalls.length, aps: s.control.apsCalls.length };
  s.control.wfcUnavailable = true;
  const signedOut = await s.call('/api/session/logout', { method: 'POST', input: {} });
  assert.equal(signedOut.status, 200, JSON.stringify(signedOut.value)); assert.equal(signedOut.value.ok, true);
  assert.match(signedOut.headers.get('set-cookie'), /Max-Age=0/); assert.match(signedOut.headers.get('set-cookie'), /HttpOnly/);
  assert.deepEqual({ wfc: s.control.wfcCalls.length, aps: s.control.apsCalls.length }, before);
  for (const route of ['/api/autodesk/check', '/api/credential-sessions/renew']) {
    const refused = await s.call(route, { method: 'POST', input: {}, headers: { Cookie: previousCookie } });
    assert.equal(refused.status, 401); assert.equal(refused.value.error.code, 'AUTH_REQUIRED');
  }
  assert.deepEqual({ wfc: s.control.wfcCalls.length, aps: s.control.apsCalls.length }, before, 'Revoked page/login identities fail locally before contacting either service');
  await s.service.close(); s.service = await s.create(); await s.service.listen();
  const restored = await s.call('/api/session', { headers: { Cookie: previousCookie } });
  assert.equal(restored.value.authenticated, false); s.csrf = restored.value.csrfToken;
  assert.equal((await s.call('/api/autodesk/check', { method: 'POST', input: {}, headers: { Cookie: previousCookie } })).status, 401);
  assert.deepEqual({ wfc: s.control.wfcCalls.length, aps: s.control.apsCalls.length }, before, 'Restart cannot revive the signed-out login or credentials');
});

test('Autodesk check verifies access while keeping quota unknown and all secrets server-only', async t => {
  const s = await setup(t); const checked = await s.ready(); assert.equal(checked.value.state, 'ready'); assert.equal(checked.value.access, true); assert.equal(checked.value.quotaKnown, false); assert.doesNotMatch(JSON.stringify(checked.value), /PRIVATE|secret|access_token/);
  s.control.role = 'engineer'; assert.equal((await s.call('/api/credential-sessions', { method: 'POST', input: { ...credentials, pageId: s.pageId, freePlanConfirmed: true } })).status, 403);
  const badOrigin = await s.call('/api/autodesk/check', { method: 'POST', input: {}, headers: { Origin: 'http://evil.example' } }); assert.equal(badOrigin.status, 403);
});

test('Generate runs real capture, durable pipeline, ZIP verification and WFC import once for duplicate HTTP identity', async t => {
  const s = await setup(t); await s.ready(); const identity = randomUUID(); const { generation, input } = await s.start({ requestId: identity });
  const duplicate = await s.call('/api/generations', { method: 'POST', input, requestId: identity }); assert.equal(duplicate.status, 202); assert.equal(duplicate.value.generation.id, generation.id);
  const completed = await s.wait(generation.id); assert.equal(completed.status, 'complete', JSON.stringify(completed)); assert.equal(completed.wfcVersionId, VERSION); assert.equal(completed.job.facts.package.resourceCount, 3); assert.equal(s.provider.counts.submit, 1); assert.equal(s.provider.counts.upload, 1); assert.equal(s.control.imported.length, 1);
  const archive = await s.call(`/api/generations/${generation.id}/package`); assert.equal(archive.status, 200); assert.equal(archive.headers.get('content-type'), 'application/zip'); assert.equal(hash(archive.bytes), s.control.imported[0].hash); assert.equal(hash(archive.bytes), completed.job.facts.package.sha256);
  const jobs = (await s.call('/api/generations')).value.generations; assert.equal(jobs.length, 1); assert.doesNotMatch(JSON.stringify(jobs), /PRIVATE|urn:adsk|snapshotPath|bucket|objectId/);
  await s.service.close(); s.service = await s.create(); await s.service.listen();
  s.credentials = null;
  const restored = await s.call('/api/session'); assert.equal(restored.value.authenticated, true); s.csrf = restored.value.csrfToken;
  const afterRestart = await s.call('/api/generations', { method: 'POST', input, requestId: identity }); assert.equal(afterRestart.status, 202); assert.equal(afterRestart.value.generation.id, generation.id); assert.equal(afterRestart.value.generation.status, 'complete');
  const restoredZip = await s.call(`/api/generations/${generation.id}/package`); assert.equal(restoredZip.status, 200); assert.equal(hash(restoredZip.bytes), hash(archive.bytes)); assert.equal(s.provider.counts.submit, 1); assert.equal(s.control.imported.length, 1);
  s.control.projectEdit = false; assert.deepEqual((await s.call('/api/generations')).value.generations, []); assert.equal((await s.call(`/api/generations/${generation.id}/package`)).status, 403);
});

test('failed WFC save retains verified ZIP; resume imports the same package without another upload or conversion', async t => {
  const s = await setup(t, { control: { importFailures: 1 } }); await s.ready(); const { generation } = await s.start(); const failed = await s.wait(generation.id); assert.equal(failed.status, 'failed', JSON.stringify(failed)); assert.ok(failed.job.facts.package); assert.equal(s.control.imported.length, 1); assert.equal(s.provider.counts.submit, 1);
  const before = { submit: s.provider.counts.submit, upload: s.provider.counts.upload, read: s.provider.counts.readResource, aps: s.control.apsCalls.length };
  s.control.apsFailure = true; const resumed = await s.call(`/api/generations/${generation.id}/resume`, { method: 'POST', input: {} }); assert.equal(resumed.status, 202, JSON.stringify(resumed.value)); const completed = await s.wait(generation.id); assert.equal(completed.status, 'complete', JSON.stringify(completed));
  assert.deepEqual({ submit: s.provider.counts.submit, upload: s.provider.counts.upload, read: s.provider.counts.readResource, aps: s.control.apsCalls.length }, before); assert.equal(s.control.imported.length, 2); assert.equal(s.control.imported[0].hash, s.control.imported[1].hash); assert.equal(s.control.imported[0].key, s.control.imported[1].key);
});

test('multiple compatible 3D views pause once and resume the chosen root without another conversion', async t => {
  const s = await setup(t, { multiRoot: true }); await s.ready(); const { generation } = await s.start(); const choosing = await s.wait(generation.id); assert.equal(choosing.status, 'needs-view', JSON.stringify(choosing)); assert.deepEqual(choosing.job.roots.map(row => row.rootId), ['root-one', 'root-two']); assert.equal(s.provider.counts.getDownloadPlan, 0); assert.equal(s.control.imported.length, 0);
  assert.equal((await s.call(`/api/generations/${generation.id}/resume`, { method: 'POST', input: { rootId: 'unknown-root' } })).status, 400);
  assert.equal((await s.call(`/api/generations/${generation.id}/resume`, { method: 'POST', input: { rootId: 'root-two' } })).status, 202);
  const completed = await s.wait(generation.id); assert.equal(completed.status, 'complete', JSON.stringify(completed)); assert.equal(s.provider.counts.submit, 1); assert.equal(s.provider.calls.find(row => row.operation === 'getDownloadPlan').rootId, 'root-two');
});

test('environment and trusted legacy seed do not open a page credential session', async t => {
  const s = await setup(t); await s.login();
  const before = s.control.apsCalls.length;
  for (const route of ['/api/sources', '/api/autodesk/check']) {
    const result = await s.call(route, route.endsWith('/check') ? { method: 'POST', input: {} } : {});
    assert.equal(result.status, 401); assert.equal(result.value.error.code, 'CREDENTIAL_SESSION_REQUIRED');
  }
  assert.equal((await s.call('/api/settings')).status, 404);
  assert.equal(s.control.apsCalls.length, before);
  await s.enter(); await s.call('/api/autodesk/check', { method: 'POST', input: {} });
  const session = await s.call('/api/session');
  assert.deepEqual(Object.keys(session.value).sort(), ['authenticated', 'csrfToken', 'user']);
  const revoked = await s.call('/api/credential-sessions/current', { method: 'DELETE', input: {} }); assert.equal(revoked.status, 200);
  const count = s.control.apsCalls.length;
  assert.equal((await s.call('/api/autodesk/check', { method: 'POST', input: {} })).status, 401);
  assert.equal((await s.call('/api/credential-sessions/renew', { method: 'POST', input: {} })).status, 401);
  assert.equal(s.control.apsCalls.length, count, 'A closed page cannot obtain another OAuth token');
});

test('two pages and applications serialize runtime opening and join the prior owner store before takeover', async t => {
  const s = await setup(t); await s.ready(); const firstPage = { pageId: s.pageId, ...s.credentials };
  s.pageId = randomUUID(); await s.enter({ ...credentials, clientId: 'different-aps-client', clientSecret: 'DIFFERENT_PRIVATE_SECRET' });
  let release, entered;
  const opening = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  let attempts = 0;
  s.control.beforeInnerOpen = async () => { if (++attempts === 1) { entered(); await blocked; } };
  const first = s.call('/api/sources', { headers: { 'X-Preparer-Credentials': firstPage.leaseToken, 'X-Preparer-Page': firstPage.pageId } });
  let second;
  try {
    await Promise.race([opening, first.then(result => { throw new Error('First runtime did not reach the opening seam: ' + result.status); })]);
    second = s.call('/api/sources');
    await pause(25); assert.equal(attempts, 1, 'A different page may not open the same durable store concurrently');
  } finally { release(); }
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(result => result.status), [200, 200], JSON.stringify(results.map(result => result.value)));
  assert.equal(s.control.maxOpening, 1); assert.equal(s.control.maxRuntimes, 1);
  assert.equal(new Set(s.control.innerRoots).size, 1, 'Applications retain full job fingerprints while sharing only this owner\'s serialized durable store');
  assert.deepEqual(s.control.innerEvents, ['opening', 'opened', 'closed', 'opening', 'opened']);
});

test('an administrator demoted during OAuth cannot open the subsequent Autodesk bucket request', async t => {
  const s = await setup(t); await s.login(); await s.enter();
  s.control.afterAPSToken = () => { s.control.role = 'engineer'; };
  const check = await s.call('/api/autodesk/check', { method: 'POST', input: {} });
  assert.equal(check.status, 403); assert.equal(check.value.error.code, 'ADMIN_REQUIRED');
  assert.equal(s.control.apsCalls.length, 1); assert.match(s.control.apsCalls[0].url, /authentication\/v2\/token$/);
  assert.equal((await s.call('/api/sources')).status, 401);
});

test('two current administrators cannot list, reuse or download one another\'s jobs or credentials', async t => {
  const s = await setup(t); await s.ready(); const first = await s.start(); await s.wait(first.generation.id);
  const firstCookie = s.cookie, firstCredentials = s.credentials, firstPage = s.pageId;
  // The second login uses a different browser cookie; it does not replace the
  // first administrator's WFC login or revoke their page.
  s.cookie = null; s.credentials = null; s.pageId = randomUUID(); await s.login('second@example.test');
  assert.deepEqual((await s.call('/api/generations')).value.generations, []);
  assert.equal((await s.call('/api/generations/' + first.generation.id + '/package')).status, 404);
  assert.equal((await s.call('/api/generations/' + first.generation.id + '/resume', { method: 'POST', input: {} })).status, 404);
  const before = s.control.apsCalls.length;
  assert.equal((await s.call('/api/autodesk/check', { method: 'POST', input: {}, headers: { 'X-Preparer-Credentials': firstCredentials.leaseToken, 'X-Preparer-Page': firstPage } })).status, 401);
  assert.equal(s.control.apsCalls.length, before);
  await s.enter();
  const secondUpload = await s.upload();
  assert.equal(new Set(s.control.innerRoots).size, 2, 'Two administrators using identical Autodesk keys still have different durable roots');
  const unchecked = await s.call('/api/generations', { method: 'POST', input: { projectId: PROJECT, label: 'Second administrator own upload', uploadId: secondUpload } });
  assert.equal(unchecked.status, 409); assert.equal(unchecked.value.error.code, 'AUTODESK_CHECK_REQUIRED', 'The first administrator\'s readiness is not inherited');
  assert.equal((await s.call('/api/generations', { method: 'POST', input: { projectId: PROJECT, label: 'Other administrator', uploadId: first.input.uploadId } })).status, 404);
  s.cookie = firstCookie; s.credentials = firstCredentials; s.pageId = firstPage;
  assert.equal((await s.call('/api/generations')).value.generations[0].id, first.generation.id);
  assert.equal((await s.call('/api/generations/' + first.generation.id + '/package')).status, 200);
});

test('a paused cloud job resumes only after same-owner same-application re-entry and a fresh check', async t => {
  const s = await setup(t, { multiRoot: true }); await s.ready(); const first = await s.start(); await s.wait(first.generation.id, 'needs-view');
  await s.call('/api/credential-sessions/current', { method: 'DELETE', input: {} });
  await s.enter({ ...credentials, clientId: 'different-aps-client', clientSecret: 'DIFFERENT_PRIVATE_SECRET' });
  const input = { rootId: 'root-two' };
  const wrong = await s.call('/api/generations/' + first.generation.id + '/resume', { method: 'POST', input });
  assert.equal(wrong.status, 409); assert.equal(wrong.value.error.code, 'CONFIGURATION_CHANGED');
  await s.enter();
  const unchecked = await s.call('/api/generations/' + first.generation.id + '/resume', { method: 'POST', input });
  assert.equal(unchecked.status, 409); assert.equal(unchecked.value.error.code, 'AUTODESK_CHECK_REQUIRED');
  assert.equal((await s.call('/api/autodesk/check', { method: 'POST', input: {} })).status, 200);
  assert.equal((await s.call('/api/generations/' + first.generation.id + '/resume', { method: 'POST', input })).status, 202);
  assert.equal((await s.wait(first.generation.id)).status, 'complete'); assert.equal(s.provider.counts.submit, 1);
});

test('completed ZIP and import-only recovery survive page close without reusing any APS authority', async t => {
  const s = await setup(t, { control: { importFailures: 1 } }); await s.ready(); const first = await s.start();
  assert.equal((await s.wait(first.generation.id)).status, 'failed');
  await s.call('/api/credential-sessions/current', { method: 'DELETE', input: {} }); s.credentials = null;
  const before = s.control.apsCalls.length;
  const zip = await s.call('/api/generations/' + first.generation.id + '/package'); assert.equal(zip.status, 200);
  assert.equal((await s.call('/api/generations/' + first.generation.id + '/resume', { method: 'POST', input: {} })).status, 202);
  assert.equal((await s.wait(first.generation.id)).status, 'complete'); assert.equal(s.control.apsCalls.length, before);
  const files = await fs.readdir(s.config.dataDirectory, { recursive: true });
  for (const relative of files) {
    const filename = path.join(s.config.dataDirectory, relative); if (!(await fs.lstat(filename)).isFile()) continue;
    const bytes = await fs.readFile(filename);
    assert.equal(bytes.includes(Buffer.from(credentials.clientId)), false, relative);
    assert.equal(bytes.includes(Buffer.from(credentials.clientSecret)), false, relative);
    assert.equal(bytes.includes(Buffer.from('PRIVATE_APS_TOKEN')), false, relative);
    assert.equal(bytes.includes(Buffer.from('ENV_PRIVATE_SECRET')), false, relative);
  }
});
