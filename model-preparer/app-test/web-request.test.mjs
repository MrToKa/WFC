import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { randomUUID, webcrypto } from 'node:crypto';
import { createPreparerService } from '../app/service.mjs';

const source = await fs.readFile(new URL('../web/app.mjs', import.meta.url), 'utf8');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const operation = { operationId: '11111111-1111-4111-8111-111111111111', type: 'capture', status: 'succeeded' };

// Execute the complete browser script, including startup, with a minimal DOM.
// Only the browser environment and transport are supplied by the fixture.
async function browser(crypto, transport) {
  function element() {
    return {
      value: '', files: [], children: [], dataset: {}, checked: false,
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      get firstChild() { return this.children[0]; },
      addEventListener() {}, setAttribute() {}, focus() {},
      closest() { return this; }, contains() { return false; }, querySelector() { return null; },
    };
  }
  const elements = new Map(), storage = new Map(), calls = [];
  const getElement = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (transport) return transport(url, options, storage);
    const data = url === '/api/config' ? { mode: 'closed', csrfToken: 'fixture-csrf' }
      : url === '/api/jobs' ? { jobs: [] }
      : ['/api/imports', '/api/source-inputs'].includes(url) ? { inputs: [] }
      : { operation };
    return Response.json(data);
  };
  const context = vm.createContext({
    crypto, fetch, AbortController,
    document: { getElementById: getElement, createElement: element, addEventListener() {}, hidden: false },
    window: { addEventListener() {} },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout() { return 1; }, clearTimeout() {},
  });
  const app = await vm.runInContext(`(async () => {\n${source}\nreturn { post, state, uploadFile, beginOperation, recoverRequests };\n})()`, context);
  assert.equal(getElement('connection-status').textContent, 'Connected to the local application.', getElement('feedback').textContent);
  return { ...app, calls, storage };
}

test('secure browser uses native UUID with the correct receiver', async () => {
  const expected = randomUUID();
  const crypto = { randomUUID() { assert.equal(this, crypto); return expected; }, getRandomValues() { assert.fail('native UUID is available'); } };
  const app = await browser(crypto);
  await app.post('/api/jobs/capture-known', { inputId: 'fixture', label: 'Native' }, 'capture-known');
  assert.equal(app.calls.find(call => call.method === 'POST').headers['X-Request-Id'], expected);
});

test('LAN HTTP without randomUUID sends distinct UUID v4 request identities', async () => {
  const crypto = { getRandomValues(bytes) { assert.equal(this, crypto); return webcrypto.getRandomValues(bytes); } };
  const app = await browser(crypto);
  for (let i = 0; i < 64; i++) await app.post('/api/jobs/capture-known', { inputId: 'fixture', label: 'HTTP' }, 'capture-known');
  const requests = app.calls.filter(call => call.method === 'POST');
  for (const request of requests) {
    assert.match(request.headers['X-Request-Id'], UUID);
    assert.equal(request.headers['X-Preparer-Token'], 'fixture-csrf');
  }
  assert.equal(new Set(requests.map(request => request.headers['X-Request-Id'])).size, 64);
  assert.equal(app.state.requests.length, 0);
  assert.equal(app.state.inFlightRequests.size, 0);
  assert.equal(crypto.randomUUID, undefined);
});

test('missing cryptographic randomness stops before journaling or sending a request', async () => {
  for (const crypto of [undefined, {}]) {
    const app = await browser(crypto);
    await assert.rejects(() => app.post('/api/jobs/capture-known', {}, 'capture-known'), { code: 'CONFIGURATION_INVALID' });
    assert.equal(app.calls.filter(call => call.method === 'POST').length, 0);
    assert.equal(app.state.requests.length, 0);
    assert.equal(app.state.inFlightRequests.size, 0);
  }
});

test('uncertain HTTP request retains its identity and recovers without resubmitting', async () => {
  let submittedId;
  const app = await browser({ getRandomValues: bytes => webcrypto.getRandomValues(bytes) }, async (url, options, storage) => {
    if (options.method === 'POST') {
      submittedId = options.headers['X-Request-Id'];
      assert.equal(JSON.parse(storage.get('preparer.requests.v1'))[0].requestId, submittedId);
      throw new TypeError('Synthetic lost response');
    }
    if (url.startsWith('/api/requests/')) { assert.equal(url, `/api/requests/${submittedId}`); return Response.json({ operation }); }
    return Response.json(url === '/api/config' ? { mode: 'closed', csrfToken: 'fixture-csrf' } : url === '/api/jobs' ? { jobs: [] } : { inputs: [] });
  });
  await assert.rejects(() => app.post('/api/jobs/capture-known', {}, 'capture-known'), { code: 'REQUEST_UNCERTAIN' });
  assert.match(submittedId, UUID);
  assert.equal(app.state.requests[0].requestId, submittedId);
  await app.recoverRequests();
  assert.equal(app.state.requests.length, 0);
  assert.equal(app.calls.filter(call => call.method === 'POST').length, 1);
});

test('HTTP browser without randomUUID uploads and captures an NWD through the real closed service', async t => {
  const base = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(base, 'preparer-http-test-'));
  const importRoot = path.join(root, 'imports'), sourceRoot = path.join(root, 'sources');
  await fs.mkdir(importRoot); await fs.mkdir(sourceRoot);
  let service;
  t.after(async () => {
    if (service) await service.close();
    assert.equal(path.dirname(root), base);
    assert.match(path.basename(root), /^preparer-http-test-/);
    await fs.rm(root, { recursive: true, force: true });
  });
  service = await createPreparerService({ configuration: {
    mode: 'closed', port: 0, host: '127.0.0.1', publicOrigin: 'http://127.0.0.1:0',
    dataDirectory: path.join(root, 'data'), workDirectory: path.join(root, 'work'), outputDirectory: path.join(root, 'output'),
    packageModulePath: fileURLToPath(new URL('../../routings-model-package/index.mjs', import.meta.url)),
    importRoot, sourceRoot, sdkDirectory: null, configuration: {},
  } });
  await service.listen();
  const app = await browser({ getRandomValues: bytes => webcrypto.getRandomValues(bytes) }, (url, options) => fetch(service.address + url, {
    ...options, headers: { ...options.headers, ...(options.method === 'POST' ? { Origin: service.address } : {}) },
  }));
  await app.uploadFile(new File(['Synthetic NWD fixture bytes'], 'http-fixture.nwd'), 'nwd', 'LAN HTTP regression');
  const posts = app.calls.filter(call => call.method === 'POST');
  assert.deepEqual(posts.map(call => call.url), ['/api/uploads?kind=nwd', '/api/jobs/capture']);
  posts.forEach(call => assert.match(call.headers['X-Request-Id'], UUID));
  assert.notEqual(posts[0].headers['X-Request-Id'], posts[1].headers['X-Request-Id']);
  const request = await (await fetch(service.address + '/api/requests/' + posts[1].headers['X-Request-Id'])).json();
  let completed = request.operation;
  for (let i = 0; ['queued', 'running'].includes(completed.status) && i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    completed = (await (await fetch(service.address + '/api/operations/' + completed.operationId)).json()).operation;
  }
  assert.equal(completed.status, 'succeeded', JSON.stringify(completed));
  const jobs = await (await fetch(service.address + '/api/jobs')).json();
  assert.equal(jobs.jobs.length, 1);
  assert.equal(jobs.jobs[0].label, 'LAN HTTP regression');
  assert.equal(jobs.jobs[0].status, 'captured');
  const diagnostics = await (await fetch(service.address + '/api/provider-diagnostics')).json();
  assert.equal(diagnostics.cloudMutations, 0);
  assert.equal(app.state.requests.length, 0);
});
