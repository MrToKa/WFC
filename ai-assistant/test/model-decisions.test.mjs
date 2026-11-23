import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { createProjectWorker } from '../project-worker.mjs';
import { OpenAIAdapterError } from '../lib/openai.mjs';

const secret = 'a'.repeat(40);
const request = {
  project: 'project-a',
  job: 'job-1',
  scopeHash: 'a'.repeat(64),
  items: [
    {
      id: 'loc',
      tag: 'T',
      target: 'R',
      page: 2,
      evidence: 'T is mounted on R.',
      candidates: [
        {
          objectId: 27,
          modelName: 'T_Transmitter',
          role: 'instrument',
          acceptable: true,
          reason: 'Intersects rack',
          rackName: 'R',
          rackDbId: 4,
        },
        { objectId: 32, modelName: 'T', role: 'pipe', acceptable: false, reason: 'Tapping point' },
      ],
    },
  ],
};
async function harness(t, response, ceilingUsd = 10) {
  const db = new DatabaseSync(':memory:');
  const calls = [];
  const server = createProjectWorker({
    secret,
    ceilingUsd,
    db,
    adapter: {
      async analyze(prompt) {
        calls.push(prompt);
        const result = response(prompt);
        return {
          analysis: Array.isArray(result) ? { decisions: result } : result,
          usage: { inputTokens: 4000, outputTokens: 100, totalTokens: 4100 },
        };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  return {
    calls,
    send: async (body, token = secret, url = '/model-decisions') =>
      fetch('http://127.0.0.1:' + server.address().port + url, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      }),
  };
}
const valid = () => [
  { id: 'loc', objectId: 27, reason: 'The named instrument is on its documented rack.' },
];

test('document analysis requests local WFC lookups and saved fields feed the later model choice', async (t) => {
  const expected = {
    tag: 'T',
    target: 'R',
    evidence: 'T is mounted on R.',
    relationKind: 'instrument-on-rack',
    branch: '',
    property: '',
    review: false,
  };
  const { calls, send } = await harness(t, (prompt) => {
    if (prompt.schema.properties.findings) {
      assert.match(prompt.schema.properties.findings.description, /lookup requests for WFC/);
      assert.match(prompt.input[0].content[0].text, /WFC executes these lookups locally/);
      return { findings: [expected] };
    }
    assert.deepEqual(
      JSON.parse(prompt.input[1].content[0].text)[0].candidates,
      request.items[0].candidates,
    );
    return valid();
  });
  const document = {
    project: request.project,
    job: request.job,
    key: 'asset1',
    ext: '.csv',
    data: Buffer.from(expected.evidence).toString('base64'),
    name: 'instrument.csv',
    rules: '',
    instructions: 'Find the instrument on the rack',
  };
  const pages = (await (await send(document, secret, '/analyze')).json()).pages;
  const lookup = pages[0].findings[0];
  assert.deepEqual(lookup, expected);
  const item = {
    ...request.items[0],
    tag: lookup.tag,
    target: lookup.target,
    evidence: lookup.evidence,
    page: pages[0].page,
  };
  const response = await send({ ...request, items: [item] });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).decisions, valid());
  assert.equal(calls.length, 2);
});

test('definite provider rejections release the reservation and permit an explicit retry', async (t) => {
  const statuses = [401, 403, 429];
  const { calls, send } = await harness(t, () => {
    if (statuses.length)
      throw new OpenAIAdapterError('OPENAI_REQUEST_REJECTED', {
        httpStatus: statuses.shift(),
        attempts: 1,
        outcomeUnknown: false,
      });
    return valid();
  });
  for (let i = 0; i < 3; i++) {
    const response = await send(request);
    assert.equal(response.status, 422);
    assert.deepEqual((await response.json()).usage, { tokens: 0, estimatedUsd: 0, unconfirmed: 0 });
    assert.equal(calls.length, i + 1);
  }
  assert.equal((await send(request)).status, 200);
  assert.equal(calls.length, 4);
});
test('bounded model decisions preserve evidence, replay a receipt, and meter previous job calls', async (t) => {
  const { calls, send } = await harness(t, valid, 0.36);
  assert.equal((await send(request, 'wrong')).status, 403);
  const first = await (await send(request)).json();
  assert.deepEqual(first.decisions, valid());
  assert.equal(first.usage.tokens, 4100);
  assert.match(JSON.stringify(calls[0].input), /Tapping point/);
  const repeat = {
    ...request,
    items: [{ ...request.items[0], candidates: [...request.items[0].candidates].reverse() }],
  };
  assert.deepEqual(first.requestUsage, { tokens: 4100, estimatedUsd: first.usage.estimatedUsd });
  assert.deepEqual(await (await send(repeat)).json(), {
    ...first, requestUsage: { tokens: 0, estimatedUsd: 0 },
  });
  const changed = await send({ ...request, scopeHash: 'c'.repeat(64) });
  assert.equal(changed.status, 422);
  assert.match((await changed.json()).error, /spending/);
  assert.equal(calls.length, 1);
});
test('refuses incomplete, unlisted or disallowed choices and remembers metered failures', async (t) => {
  let result = [{ id: 'loc', objectId: 32, reason: 'wrong' }];
  const { calls, send } = await harness(t, () => result);
  assert.equal((await send(request)).status, 422);
  assert.equal((await send(request)).status, 422);
  assert.equal(calls.length, 1);
  result = [{ id: 'loc', objectId: 12345, reason: 'made up' }];
  assert.equal((await send({ ...request, scopeHash: 'b'.repeat(64) })).status, 422);
  result = [];
  assert.equal((await send({ ...request, scopeHash: 'c'.repeat(64) })).status, 422);
  result = [{ id: 'loc', objectId: null, reason: 'Insufficient evidence' }];
  assert.equal((await send({ ...request, scopeHash: 'd'.repeat(64) })).status, 200);
});
test('rejects invalid input before the model and does not retry unknown provider outcomes', async (t) => {
  const { calls, send } = await harness(t, () => {
    throw Error('Unknown provider outcome');
  });
  assert.equal((await send({ ...request, items: Array(16).fill(request.items[0]) })).status, 422);
  assert.equal(
    (await send({ ...request, items: [{ ...request.items[0], evidence: 'X'.repeat(48 * 1024) }] }))
      .status,
    422,
  );
  assert.equal(calls.length, 0);
  assert.equal((await send(request)).status, 422);
  assert.equal((await send(request)).status, 422);
  assert.equal((await send({ ...request, scopeHash: 'b'.repeat(64) })).status, 422);
  assert.equal(calls.length, 1);
});
