import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { createProjectWorker } from '../project-worker.mjs';

test('separate project instructions, replay, scope and unknown outcomes', async (t) => {
  const db = new DatabaseSync(':memory:');
  const secret = 'a'.repeat(40);
  const calls = [];
  const adapter = {
    async analyze(input) {
      calls.push(input);
      if (calls.length === 3) throw Error('Provider response unknown');
      return {
        analysis: { findings: [], answer: 'Check the location evidence on this page.' },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    },
  };
  const server = createProjectWorker({ secret, adapter, db, maxPages: 2 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  );
  const body = {
    project: 'A',
    job: '1',
    key: 'key1',
    name: 'tags.csv',
    ext: '.csv',
    data: Buffer.from('TAG01').toString('base64'),
    rules: 'Use exact tag',
    instructions: 'Check pump',
  };
  const send = async (patch = {}, token = secret) =>
    fetch('http://127.0.0.1:' + server.address().port + '/analyze', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token },
      body: JSON.stringify({ ...body, ...patch }),
    });
  assert.equal((await send({}, 'wrong')).status, 403);
  const first = await send();
  assert.equal(first.status, 200);
  assert.equal((await first.json()).pages[0].usage.totalTokens, 15);
  assert.match(JSON.stringify(calls[0].input), /Use exact tag/);
  assert.match(JSON.stringify(calls[0].input), /Check pump/);
  assert.equal((await send()).status, 200);
  assert.equal(calls.length, 1);
  assert.equal((await send({ project: 'B' })).status, 200);
  assert.equal(calls.length, 2);
  assert.equal((await send({ job: '2' })).status, 422);
  assert.equal((await send({ job: '2' })).status, 422);
  assert.equal(calls.length, 3);
  const response = await send({
    job: 'follow-up',
    instructions: 'Check the cabinet again',
    previousInstructions: 'Check all equipment',
    previousFindings: [{ page: 1, tag: 'Cabinet-1' }, { page: 2, tag: 'Other-page' }],
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).pages[0].answer, 'Check the location evidence on this page.');
  const followUp = JSON.stringify(calls[3].input);
  assert.match(followUp, /Check the cabinet again/);
  assert.match(followUp, /Check all equipment/);
  assert.match(followUp, /Cabinet-1/);
  assert.doesNotMatch(followUp, /Other-page/);
  const ask = () => fetch('http://127.0.0.1:' + server.address().port + '/answer', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + secret },
    body: JSON.stringify({ project: 'A', job: 'question', instructions: 'Why manual review?',
      context: { manualReview: 411 } }),
  });
  const answer = await ask();
  assert.equal(answer.status, 200);
  assert.match((await answer.json()).answer, /location evidence/);
  assert.match(JSON.stringify(calls[4].input), /411/);
  assert.doesNotMatch(JSON.stringify(calls[4].input), /input_image|TAG01/);
  assert.equal((await ask()).status, 200);
  assert.equal(calls.length, 5);
});
