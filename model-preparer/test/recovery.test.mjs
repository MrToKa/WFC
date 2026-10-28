import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelPreparer } from '../index.mjs';
import { setup, packageModulePath } from './helpers.mjs';

const childPath = fileURLToPath(new URL('./fixtures/core-child.mjs', import.meta.url));
async function startChild(s, id, remoteLog, crashPoint = 'none') {
  const child = spawn(process.execPath, [childPath, s.dataDirectory, s.workDirectory, packageModulePath, id, remoteLog, crashPoint, String(s.clock.now())], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', part => { stdout += part; }); child.stderr.on('data', part => { stderr += part; });
  const finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr })); });
  await Promise.race([new Promise(resolve => child.once('message', message => { assert.equal(message.ready, true); resolve(); })), finished.then(result => { throw new Error(`Child exited before ready: ${result.code} ${result.stdout} ${result.stderr}`); })]);
  return { go: () => child.send({ go: true }), finished, child };
}
async function accepted(log) { try { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }

test('two actual processes with different jobs share a submission exclusion boundary', { timeout: 30000 }, async t => {
  const s = await setup(t);
  const first = await s.core.captureJob(s.spec);
  const second = await s.core.captureJob({ ...s.spec, label: 'Second independent job', output: path.join(s.root, 'second.zip') });
  await s.core.approveCost(first.jobId); await s.core.approveCost(second.jobId);
  const log = path.join(s.root, 'remote-accepted.jsonl');
  const a = await startChild(s, first.jobId, log), b = await startChild(s, second.jobId, log);
  a.go(); b.go();
  const results = await Promise.all([a.finished, b.finished]);
  assert.ok(results.some(r => r.code === 0), JSON.stringify(results));
  assert.equal((await accepted(log)).length, 1);
  for (const result of results) if (result.code !== 0) assert.equal(JSON.parse(result.stdout).error, 'LOCK_BUSY');
  const retry = await startChild(s, second.jobId, log); retry.go(); assert.equal((await retry.finished).code, 0);
  assert.equal((await accepted(log)).length, 1);
});

for (const crashPoint of ['beforeSubmitIntent', 'afterSubmitIntent', 'afterSubmitResponse']) test(`hard process crash at ${crashPoint} preserves conservative eligibility`, { timeout: 30000 }, async t => {
  const s = await setup(t);
  const job = await s.core.captureJob(s.spec); await s.core.approveCost(job.jobId);
  const log = path.join(s.root, 'remote-accepted.jsonl');
  const crashing = await startChild(s, job.jobId, log, crashPoint); crashing.go();
  assert.equal((await crashing.finished).code, 93);
  assert.equal((await accepted(log)).length, crashPoint === 'afterSubmitResponse' ? 1 : 0);
  // Explicit new approval does not delete the authoritative write-ahead ledger.
  s.costProvider.issue(job.frozen, { evidenceId: `fresh-after-${crashPoint}` });
  await s.core.approveCost(job.jobId, { recoverDead: true });
  const recovering = await startChild(s, job.jobId, log); recovering.go();
  const result = await recovering.finished;
  if (crashPoint === 'beforeSubmitIntent') {
    assert.equal(result.code, 0, JSON.stringify(result));
    assert.equal((await accepted(log)).length, 1);
  } else {
    assert.equal(JSON.parse(result.stdout).error, 'SUBMISSION_UNKNOWN');
    assert.equal((await accepted(log)).length, crashPoint === 'afterSubmitResponse' ? 1 : 0);
    for (let n = 0; n < 3; n++) {
      const restarted = await createModelPreparer({ dataDirectory: s.dataDirectory, workDirectory: s.workDirectory, packageModulePath, provider: s.provider, costProvider: s.costProvider, clock: s.clock });
      const reconciled = await restarted.reconcile(job.jobId, { recoverDead: true });
      assert.equal(reconciled.submission.phase, 'submission-unknown');
      await assert.rejects(restarted.prepare(job.jobId, { recoverDead: true }), { code: 'SUBMISSION_UNKNOWN' });
    }
    assert.equal((await accepted(log)).length, crashPoint === 'afterSubmitResponse' ? 1 : 0);
  }
});

test('two actual dead-lock recovery processes cannot resubmit a prior unknown intent', { timeout: 30000 }, async t => {
  const s = await setup(t);
  const job = await s.core.captureJob(s.spec); await s.core.approveCost(job.jobId);
  const log = path.join(s.root, 'remote-accepted.jsonl');
  const crashing = await startChild(s, job.jobId, log, 'afterSubmitResponse'); crashing.go(); assert.equal((await crashing.finished).code, 93);
  const a = await startChild(s, job.jobId, log), b = await startChild(s, job.jobId, log); a.go(); b.go();
  const results = await Promise.all([a.finished, b.finished]);
  for (const result of results) assert.ok(['SUBMISSION_UNKNOWN', 'LOCK_BUSY'].includes(JSON.parse(result.stdout).error));
  assert.equal((await accepted(log)).length, 1);
});

test('explicit dead-owner recovery also covers the cost reservation lock', { timeout: 30000 }, async t => {
  const s = await setup(t, { costOptions: { counts: { submit: 2 }, quota: { submit: 2 } } });
  const job = await s.core.captureJob(s.spec); await s.core.approveCost(job.jobId);
  const log = path.join(s.root, 'remote-accepted.jsonl');
  const crashing = await startChild(s, job.jobId, log, 'afterCostCommit'); crashing.go(); assert.equal((await crashing.finished).code, 93);
  assert.equal((await accepted(log)).length, 0);
  const restarted = await startChild(s, job.jobId, log); restarted.go();
  const result = await restarted.finished;
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal((await accepted(log)).length, 1);
});
