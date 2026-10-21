import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createWorkspaceService } from '../app/workspace-service.mjs';
import { tinyModel } from '../test/fixtures/model-fixture.mjs';
import * as PackageAPI from '../../routings-model-package/index.mjs';

const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const json = (value, statusCode = 200, headers = {}) => ({ statusCode, headers, body: Buffer.from(JSON.stringify(value)) });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('real live composition automatically prepares, verifies and imports one exact ZIP without browser proof files', async t => {
  const base = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(base, 'preparer-workspace-live-'));
  const source = Buffer.from('synthetic immutable live transport NWD'), sourceRoot = path.join(root, 'sources'); await fs.mkdir(sourceRoot);
  await fs.writeFile(path.join(sourceRoot, 'model.nwd'), source);
  const clientId = 'fixture-client-123456', clientSecret = 'fixture-client-secret', bucket = 'fixture-live-bucket';
  const objectKey = hash(source) + '.nwd', objectId = `urn:adsk.objects:os.object:${bucket}/${objectKey}`, urn = Buffer.from(objectId).toString('base64url');
  const derivative = name => `urn:adsk.viewing:fs.file:${urn}/output/0/${name}`;
  const files = tinyModel().data, calls = [], userId = randomUUID(), projectId = randomUUID(), importId = randomUUID(), versionId = randomUUID();
  let uploaded = false, submitted = false, imported = null, importHeaders, wfcDown = false;
  const user = { id: userId, email: 'admin@example.test', role: 'admin', isAdmin: true }, project = { id: projectId, name: 'Synthetic project', canEdit: true };
  const receipt = () => ({ bucketKey: bucket, objectKey, objectId, size: source.length, sha1: hash(source, 'sha1') });
  const wfcFetch = async (url, options = {}) => {
    const route = new URL(url).pathname;
    if (route === '/api/auth/login') return response({ user, token: 'private-wfc-token', expiresInSeconds: 28800 });
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer private-wfc-token');
    if (route === '/api/users/me') return response({ user });
    if (route === '/api/projects') return response({ projects: [project] });
    if (route === '/api/projects/' + projectId) return response({ project });
    if (route.endsWith('/model-imports') && options.method === 'POST') {
      if (wfcDown) throw new Error('Synthetic WFC outage');
      const parts = []; for await (const part of options.body) parts.push(Buffer.from(part)); imported = Buffer.concat(parts); importHeaders = new Headers(options.headers);
      assert.equal(importHeaders.get('x-package-sha256'), hash(imported)); assert.equal(Number(importHeaders.get('content-length')), imported.length);
      return response({ importId, job: { id: importId, state: 'complete', modelVersionId: versionId } }, 202);
    }
    if (route.endsWith('/model-imports/' + importId)) return response({ job: { id: importId, state: 'complete', modelVersionId: versionId } });
    assert.fail('Unexpected WFC fixture endpoint ' + route);
  };
  const apsFetch = async url => new URL(url).pathname.endsWith('/token') ? response({ access_token: 'private-check-token', expires_in: 3600 }) : response({ bucketKey: bucket, bucketOwner: clientId });
  const testTransport = { request: async input => {
    const url = new URL(input.url); calls.push({ method: input.method, route: url.pathname });
    if (url.pathname.endsWith('/token')) return json({ access_token: 'private-live-token', expires_in: 3600 });
    if (url.pathname.includes('/objects/') && url.pathname.endsWith('/details')) return uploaded ? json(receipt()) : json({}, 404);
    if (url.pathname.endsWith('/details')) return json({ bucketKey: bucket, bucketOwner: clientId, permissions: [{ authId: clientId, access: 'full' }] });
    if (url.pathname.endsWith('/signeds3upload') && input.method === 'GET') return json({ uploadKey: 'fixture-upload', urls: ['https://com-autodesk-oss-direct-upload.s3-accelerate.amazonaws.com/fixture-part'] });
    if (url.hostname.includes('.s3-accelerate.amazonaws.com') && input.method === 'PUT') return json({});
    if (url.pathname.endsWith('/signeds3upload') && input.method === 'POST') { uploaded = true; return json(receipt()); }
    if (url.pathname === '/modelderivative/v2/designdata/job') {
      submitted = true; return json({ result: 'success', urn, acceptedJobs: { output: { destination: { region: 'EMEA' }, formats: [{ type: 'svf', views: ['3d'] }] } } });
    }
    if (url.pathname.endsWith('/signedcookies')) {
      const rawUrn = decodeURIComponent(url.pathname.split('/manifest/')[1].slice(0, -'/signedcookies'.length)), name = path.posix.basename(rawUrn), raw = files.get('output/0/' + name);
      assert.ok(raw); return json({ url: `https://cdn.derivative.autodesk.com/${urn}/output/0/${name}`, size: raw.length, etag: 'fixture', expiration: Date.now() + 300000 }, 200,
        { 'set-cookie': ['CloudFront-Policy=fixture; Path=/', 'CloudFront-Signature=fixture; Path=/', 'CloudFront-Key-Pair-Id=fixture; Path=/'] });
    }
    if (url.hostname === 'cdn.derivative.autodesk.com') { const raw = files.get('output/0/' + path.posix.basename(url.pathname)); assert.ok(raw); return { statusCode: 200, headers: { 'content-length': String(raw.length) }, body: raw }; }
    if (url.pathname.endsWith('/manifest')) return submitted ? json({ urn, status: 'success', derivatives: [{ outputType: 'svf', status: 'success', children: [{ type: 'geometry', role: '3d', status: 'success', children: [
      { mime: 'application/autodesk-svf', role: 'graphics', status: 'success', urn: derivative('0.svf') }, { mime: 'application/autodesk-db', role: 'Autodesk.CloudPlatform.PropertyDatabase', status: 'success', urn: derivative('properties.db') },
    ] }] }] }) : json({}, 404);
    assert.fail('Unexpected APS fixture endpoint ' + input.method + ' ' + url.pathname);
  } };
  const config = { mode: 'live', wfcOrigin: 'http://wfc.example.test', host: '127.0.0.1', port: 0, publicOrigin: 'http://127.0.0.1:0',
    dataDirectory: path.join(root, 'data'), workDirectory: path.join(root, 'work'), outputDirectory: path.join(root, 'output'),
    packageModulePath: fileURLToPath(new URL('../../routings-model-package/index.mjs', import.meta.url)), sourceRoot, sdkDirectory: null, configuration: {} };
  let service = await createWorkspaceService({ config, wfcFetch, apsFetch, apsTestTransport: testTransport, operationPollMs: 200, derivativePollMs: 200, importPollMs: 100 });
  await service.listen();
  t.after(async () => { await service.close(); assert.equal(path.dirname(root), base); await fs.rm(root, { recursive: true, force: true }); });
  let cookie = '', csrf = (await (await fetch(service.address + '/api/session')).json()).csrfToken;
  const call = async (route, method = 'GET', input, requestId = randomUUID()) => {
    const r = await fetch(service.address + route, { method, headers: { Cookie: cookie, ...(method !== 'GET' ? { Origin: service.address, 'X-Preparer-CSRF': csrf, 'X-Request-Id': requestId, 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    const value = await r.json(); return { status: r.status, value };
  };
  assert.equal(calls.length, 0);
  assert.equal((await call('/api/session/login', 'POST', { email: user.email, password: 'synthetic-password' })).status, 200);
  assert.equal((await call('/api/settings', 'PUT', { clientId, clientSecret, region: 'EMEA', bucket, enabled: true, freePlanConfirmed: true })).status, 200);
  const check = await call('/api/autodesk/check', 'POST', {}); assert.equal(check.value.access, true); assert.equal(check.value.quotaKnown, false);
  const sourceReply = await call('/api/sources'); assert.equal(sourceReply.status, 200, JSON.stringify(sourceReply));
  const inputs = sourceReply.value.inputs; assert.equal(inputs.length, 1); assert.equal(calls.length, 0, 'Local source chooser must not call Autodesk');
  const input = { inputId: inputs[0].inputId, projectId, label: 'Synthetic true live composition' }, requestId = randomUUID();
  // Prove a failed WFC write can resume entirely locally, even after cloud disable.
  wfcDown = true;
  const start = await call('/api/generations', 'POST', input, requestId); assert.equal(start.status, 202);
  const repeated = await call('/api/generations', 'POST', input, requestId); assert.equal(repeated.value.generation.id, start.value.generation.id);
  let generation;
  for (let attempt = 0; attempt < 600; attempt++) { generation = (await call('/api/generations')).value.generations[0]; if (generation.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 500)); }
  assert.equal(generation.status, 'failed', JSON.stringify(generation)); assert.ok(generation.job.facts.package, JSON.stringify(generation));
  assert.equal(calls.filter(call => call.route === '/modelderivative/v2/designdata/job' && call.method === 'POST').length, 1);
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
  assert.ok(calls.some(call => call.route.includes('/' + objectKey + '/details')), 'Content-addressed source target');
  assert.doesNotMatch(JSON.stringify(generation), /private-|CloudFront|urn:adsk|fixture-client-secret/);
  await call('/api/settings', 'PUT', { enabled: false, freePlanConfirmed: false });
  const beforeRetry = calls.length;
  const zipResponse = await fetch(service.address + '/api/generations/' + generation.id + '/package', { headers: { Cookie: cookie } });
  assert.equal(zipResponse.status, 200); const zip = Buffer.from(await zipResponse.arrayBuffer());
  const zipPath = path.join(root, 'result.zip'); await fs.writeFile(zipPath, zip); assert.equal((await PackageAPI.verifyPackage(zipPath)).status, 'PASS');
  wfcDown = false;
  assert.equal((await call('/api/generations/' + generation.id + '/resume', 'POST', {})).status, 202);
  for (let attempt = 0; attempt < 100; attempt++) { generation = (await call('/api/generations')).value.generations[0]; if (generation.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.equal(generation.status, 'complete', JSON.stringify(generation)); assert.equal(generation.wfcVersionId, versionId); assert.deepEqual(imported, zip);
  assert.equal(calls.length, beforeRetry, 'Import-only retry and artifact download must not call Autodesk');
  await service.close();
  service = await createWorkspaceService({ config, wfcFetch, apsFetch, apsTestTransport: testTransport }); await service.listen();
  csrf = (await (await fetch(service.address + '/api/session')).json()).csrfToken;
  const afterRestart = await call('/api/generations'); assert.equal(afterRestart.value.generations[0].status, 'complete');
  const persisted = await fetch(service.address + '/api/generations/' + generation.id + '/package', { headers: { Cookie: cookie } });
  assert.equal(persisted.status, 200); assert.deepEqual(Buffer.from(await persisted.arrayBuffer()), zip); assert.equal(calls.length, beforeRetry);
});
