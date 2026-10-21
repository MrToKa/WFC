import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createWorkspaceService } from '../app/workspace-service.mjs';
import { createPreparerService } from '../app/service.mjs';
import { createFakeProvider, createFakeCostProvider } from '../index.mjs';
import { simulationResources } from '../app/simulation.mjs';
import { verifyPackage } from '../../routings-model-package/index.mjs';

const USER = '380e4cb8-32ea-4ae0-92fa-4011a5abe0a0', PROJECT = '6eb2648b-0aa6-4cc8-91c1-44759e888250', IMPORT = 'ab7f4dbb-a6bd-45da-9655-9a12e506019a', VERSION = '7841a44a-2e14-4645-966d-f8d315730992';
const credentials = { clientId: 'fixture-aps-client', clientSecret: 'PRIVATE_APS_SECRET', region: 'EMEA', bucket: 'fixture-aps-bucket' };
const hash = value => createHash('sha256').update(value).digest('hex');
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function setup(t, options = {}) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'preparer-workspace-service-'));
  const dataDirectory = path.join(root, 'data'), workDirectory = path.join(root, 'work'), outputDirectory = path.join(root, 'output'), sourceRoot = path.join(root, 'sources'), importRoot = path.join(root, 'imports');
  for (const directory of [dataDirectory, workDirectory, outputDirectory, sourceRoot, importRoot]) await fs.mkdir(directory);
  const control = { role: 'admin', projectEdit: true, apsFailure: false, importFailures: 0, imported: [], wfcCalls: [], apsCalls: [], ...options.control };
  const provider = createFakeProvider({ resources: simulationResources(), ...(options.multiRoot ? { handlers: {
    getManifest: async (context, _opts, fixture) => { const value = await fixture.default(); return value.status === 'success' ? { ...value, roots: ['root-one', 'root-two'].map(rootId => ({ rootId, format: 'svf', supportProfile: context.supportProfile })) } : value; },
    getDownloadPlan: async (context, opts, fixture) => ({ schemaVersion: 1, submissionIdentity: context.submissionIdentity, objectId: context.objectId, urn: context.urn, region: context.region, rootId: opts.rootId, supportProfile: context.supportProfile, resources: fixture.provider.transport.describeResources() }),
  } } : {}) });
  const wfcFetch = async (url, init = {}) => {
    control.wfcCalls.push({ url, method: init.method || 'GET' }); assert.equal(new URL(url).origin, 'https://wfc.example.test'); assert.equal(init.redirect, 'manual');
    const route = new URL(url).pathname;
    if (route === '/api/auth/login') { const input = JSON.parse(init.body); return input.email === 'engineer@example.test' && input.password === 'PRIVATE_WFC_PASSWORD' ? response({ token: 'PRIVATE_WFC_TOKEN', expiresInSeconds: 3600 }) : response({ error: 'Wrong login' }, 401); }
    const headers = new Headers(init.headers); assert.equal(headers.get('Authorization'), 'Bearer PRIVATE_WFC_TOKEN');
    if (route === '/api/users/me') return response({ user: { id: USER, email: 'engineer@example.test', role: control.role, isAdmin: control.role === 'admin', firstName: 'Test', lastName: 'Engineer' } });
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
    if (new URL(url).pathname === '/authentication/v2/token') { assert.equal(new Headers(init.headers).get('Authorization'), 'Basic ' + Buffer.from(credentials.clientId + ':' + credentials.clientSecret).toString('base64')); return response({ access_token: 'PRIVATE_APS_TOKEN', expires_in: 3600 }); }
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer PRIVATE_APS_TOKEN'); return response({ bucketKey: credentials.bucket, bucketOwner: credentials.clientId });
  };
  const config = { mode: 'live', wfcOrigin: 'https://wfc.example.test', host: '127.0.0.1', port: 0, publicOrigin: 'http://127.0.0.1:0', dataDirectory, workDirectory, outputDirectory, sourceRoot, importRoot, packageModulePath: fileURLToPath(new URL('../../routings-model-package/index.mjs', import.meta.url)), configuration: {}, sdkDirectory: null };
  const costProvider = createFakeCostProvider({ ttlMs: 3600000 });
  const create = () => createWorkspaceService({ config, seedAPSConfiguration: credentials, wfcFetch, apsFetch, operationPollMs: 1, importPollMs: 1, derivativePollMs: 1, createInnerService: innerOptions => createPreparerService({ ...innerOptions, configuration: { ...innerOptions.configuration, mode: 'simulation' }, simulationProvider: provider, simulationCostProvider: costProvider }) });
  const s = { root, config, control, provider, create, service: await create(), cookie: null, csrf: null }; await s.service.listen();
  s.call = async (route, { method = 'GET', input, body, requestId = randomUUID(), headers = {}, authenticated = true, raw = false } = {}) => {
    const result = await fetch(s.service.address + route, { method, redirect: 'manual', headers: { ...(authenticated && s.cookie ? { Cookie: s.cookie } : {}), ...(method !== 'GET' ? { Origin: s.service.address, 'X-Preparer-CSRF': s.csrf || '', 'X-Request-Id': requestId } : {}), ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(input !== undefined ? { body: JSON.stringify(input) } : body !== undefined ? { body } : {}) });
    if (result.headers.get('set-cookie')) s.cookie = result.headers.get('set-cookie').split(';')[0];
    const bytes = Buffer.from(await result.arrayBuffer()); let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { value = bytes.toString('utf8'); }
    return { status: result.status, value, bytes, headers: result.headers, ...(raw ? {} : {}) };
  };
  s.login = async () => { s.csrf = (await s.call('/api/session', { authenticated: false })).value.csrfToken; const result = await s.call('/api/session/login', { method: 'POST', input: { email: 'engineer@example.test', password: 'PRIVATE_WFC_PASSWORD' } }); assert.equal(result.status, 200, JSON.stringify(result.value)); return result; };
  s.ready = async () => { await s.login(); const saved = await s.call('/api/settings', { method: 'PUT', input: { freePlanConfirmed: true } }); assert.equal(saved.status, 200, JSON.stringify(saved.value)); const checked = await s.call('/api/autodesk/check', { method: 'POST', input: {} }); assert.equal(checked.status, 200, JSON.stringify(checked.value)); return checked; };
  s.upload = async () => { const value = await s.call('/api/uploads?kind=nwd', { method: 'POST', body: Buffer.from('Synthetic gateway fixture; not real NWD geometry.'), headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'fixture.nwd' } }); assert.equal(value.status, 200, JSON.stringify(value.value)); return value.value.uploadId; };
  s.start = async (extra = {}) => { const uploadId = await s.upload(); const input = { projectId: PROJECT, label: 'Synthetic gateway model', uploadId }; const result = await s.call('/api/generations', { method: 'POST', input, ...extra }); assert.equal(result.status, 202, JSON.stringify(result.value)); return { generation: result.value.generation, input }; };
  s.wait = async (id, status = null) => { let latest; for (let attempt = 0; attempt < 300; attempt++) { const list = await s.call('/api/generations'); assert.equal(list.status, 200, JSON.stringify(list.value)); latest = list.value.generations.find(row => row.id === id); if (latest && (status ? latest.status === status : latest.status !== 'running')) return latest; await pause(500); } throw new Error('Gateway fixture timed out: ' + JSON.stringify(latest)); };
  t.after(async () => { await s.service.close(); assert.equal(path.dirname(root), parent); await fs.rm(root, { recursive: true, force: true }); });
  return s;
}

test('public gateway starts Live without network; WFC login guards every legacy and package route', async t => {
  const s = await setup(t); assert.equal(s.control.wfcCalls.length, 0); assert.equal(s.control.apsCalls.length, 0);
  assert.deepEqual((await s.call('/health', { authenticated: false })).value, { status: 'ok', mode: 'live', authentication: 'wfc' });
  for (const route of ['/api/jobs', '/api/config', '/api/generations', '/api/settings', `/api/generations/${randomUUID()}/package`, '/sdk/viewer3D.min.js']) assert.equal((await s.call(route, { authenticated: false })).status, 401, route);
  const page = await s.call('/', { authenticated: false }); assert.equal(page.status, 200); assert.match(page.value, /Вход с WFC/);
  await s.login(); assert.equal((await s.call('/api/jobs')).status, 404, 'Legacy unauthenticated backend route is never forwarded');
  const session = await s.call('/api/session'); assert.equal(session.value.authenticated, true); assert.equal(session.value.settings.freePlanConfirmed, false); assert.doesNotMatch(JSON.stringify(session.value), /PRIVATE|clientSecret"|access_token/);
  const refused = await s.call('/api/autodesk/check', { method: 'POST', input: {} }); assert.equal(refused.status, 409); assert.equal(refused.value.error.code, 'AUTODESK_SETTINGS_REQUIRED');
});

test('Autodesk check verifies access while keeping quota unknown and all secrets server-only', async t => {
  const s = await setup(t); const checked = await s.ready(); assert.equal(checked.value.state, 'ready'); assert.equal(checked.value.access, true); assert.equal(checked.value.quotaKnown, false); assert.doesNotMatch(JSON.stringify(checked.value), /PRIVATE|secret|access_token/);
  s.control.role = 'engineer'; assert.equal((await s.call('/api/settings', { method: 'PUT', input: { bucket: 'other-bucket' } })).status, 403);
  const badOrigin = await s.call('/api/autodesk/check', { method: 'POST', input: {}, headers: { Origin: 'http://evil.example' } }); assert.equal(badOrigin.status, 403);
});

test('Generate runs real capture, durable pipeline, ZIP verification and WFC import once for duplicate HTTP identity', async t => {
  const s = await setup(t); await s.ready(); const identity = randomUUID(); const { generation, input } = await s.start({ requestId: identity });
  const duplicate = await s.call('/api/generations', { method: 'POST', input, requestId: identity }); assert.equal(duplicate.status, 202); assert.equal(duplicate.value.generation.id, generation.id);
  const completed = await s.wait(generation.id); assert.equal(completed.status, 'complete', JSON.stringify(completed)); assert.equal(completed.wfcVersionId, VERSION); assert.equal(completed.job.facts.package.resourceCount, 3); assert.equal(s.provider.counts.submit, 1); assert.equal(s.provider.counts.upload, 1); assert.equal(s.control.imported.length, 1);
  const archive = await s.call(`/api/generations/${generation.id}/package`); assert.equal(archive.status, 200); assert.equal(archive.headers.get('content-type'), 'application/zip'); assert.equal(hash(archive.bytes), s.control.imported[0].hash); assert.equal(hash(archive.bytes), completed.job.facts.package.sha256);
  const jobs = (await s.call('/api/generations')).value.generations; assert.equal(jobs.length, 1); assert.doesNotMatch(JSON.stringify(jobs), /PRIVATE|urn:adsk|snapshotPath|bucket|objectId/);
  await s.service.close(); s.service = await s.create(); await s.service.listen();
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
