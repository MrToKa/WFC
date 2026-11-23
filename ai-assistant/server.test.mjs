import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createAgentServer } from './server.mjs';

async function withServer(run) {
  const server = createAgentServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('health distinguishes document analysis from endpoint automation', async () => {
  await withServer(async origin => {
    const response = await fetch(`${origin}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      status: 'ok', service: 'wfc-ai-agent', stage: 'document-analysis',
      integrated: false, automationReady: false,
    });
  });
});

test('capabilities expose offline extraction and the document CLI', async () => {
  await withServer(async origin => {
    const response = await fetch(`${origin}/capabilities`);
    const capabilities = await response.json();
    assert.equal(capabilities.localOnly, true);
    assert.equal(capabilities.documentExtraction, true);
    assert.equal(capabilities.documentAnalysisCLI, true);
    for (const key of ['integrated', 'modelSearch', 'endpointResolution',
      'endpointBinding', 'routingDispatch', 'externalApi', 'acceptsJobs']) {
      assert.equal(capabilities[key], false, key);
    }
    assert.equal(JSON.stringify(capabilities).includes('process.env'), false);
  });
});

test('mutation methods are refused and cannot change capabilities', async () => {
  await withServer(async origin => {
    const before = await (await fetch(`${origin}/capabilities`)).text();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of ['/jobs', '/endpoint-bindings', '/health', '/capabilities']) {
        const response = await fetch(`${origin}${path}`, { method, body: '{"execute":true}' });
        assert.equal(response.status, 405);
        assert.equal(response.headers.get('allow'), 'GET');
        assert.equal((await response.json()).acceptsJobs, false);
      }
    }
    assert.equal(await (await fetch(`${origin}/capabilities`)).text(), before);
    assert.equal((await fetch(`${origin}/jobs`)).status, 404);
  });
});
