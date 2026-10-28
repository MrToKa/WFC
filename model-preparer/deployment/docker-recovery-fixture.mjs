import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createModelPreparer, createStore, createFakeProvider, createFakeCostProvider } from '../index.mjs';
import { createJournal } from '../app/io.mjs';
import { digest } from '../lib/contracts.mjs';

const [action, instanceId] = process.argv.slice(2);
const root = '/var/lib/preparer/data', mode = 'simulation', dataDirectory = path.join(root, mode, 'core');
const workDirectory = '/var/lib/preparer/work/simulation/core-work';
const clock = { now: () => 1792144800000 }, emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const log = path.join(root, 'accepted.jsonl');
if (action === 'tamper') {
  const ownerFile = path.join(root, mode, 'service', 'service-owner.json');
  await fs.writeFile(path.join(root, 'owner-backup.json'), await fs.readFile(ownerFile));
  const owner = JSON.parse(await fs.readFile(ownerFile)); owner.nonce = '60000000-0000-4000-8000-000000000001';
  await fs.writeFile(ownerFile, JSON.stringify(owner)); emit({ tampered: true });
} else if (action === 'restore-owner') {
  await fs.writeFile(path.join(root, mode, 'service', 'service-owner.json'), await fs.readFile(path.join(root, 'owner-backup.json'))); emit({ restored: true });
} else if (action === 'foreign-lock') {
  const file = (await fs.readdir(path.join(dataDirectory, 'locks'))).find(name => name.endsWith('.lock'));
  const ownerFile = path.join(dataDirectory, 'locks', file), owner = JSON.parse(await fs.readFile(ownerFile));
  owner.instanceId = '70000000-0000-4000-8000-000000000001'; await fs.writeFile(ownerFile, JSON.stringify(owner)); emit({ changedForeign: true });
} else if (action === 'restore-foreign') {
  const file = (await fs.readdir(path.join(dataDirectory, 'locks'))).find(name => name.endsWith('.lock'));
  const ownerFile = path.join(dataDirectory, 'locks', file), owner = JSON.parse(await fs.readFile(ownerFile));
  owner.instanceId = instanceId; await fs.writeFile(ownerFile, JSON.stringify(owner)); emit({ restored: true });
} else {
  const journal = await createJournal(path.join(root, mode, 'service'), { instanceId });
  const provider = createFakeProvider({ clock, handlers: {
    getStorage: async ctx => ({ bucket: ctx.destination.bucket, namespace: ctx.namespace, region: ctx.region }),
    getObject: async ctx => ({ objectId: ctx.objectId, bytes: ctx.source.bytes, sha256: ctx.source.sha256 }),
    getManifest: async ctx => ({ status: 'not-found', objectId: ctx.objectId, urn: ctx.urn, submissionIdentity: ctx.submissionIdentity, roots: [] }),
    submit: async (ctx, options) => {
      await fs.appendFile(log, JSON.stringify({ submissionIdentity: ctx.submissionIdentity, attemptId: options.attemptId }) + '\n');
      return { result: 'created', objectId: ctx.objectId, urn: ctx.urn, submissionIdentity: ctx.submissionIdentity, providerJobId: 'accepted-fixture-job' };
    }
  } });
  const store = createStore({ dataDirectory, workDirectory, instanceId, clock });
  const core = await createModelPreparer({ dataDirectory, workDirectory, store, clock, provider, costProvider: createFakeCostProvider({ clock }), packageModulePath: '/opt/package/index.mjs', fault: async point => {
    if (action === 'hold-unknown' && point === 'afterSubmitResponse') {
      emit({ ready: true, jobId: JSON.parse(await fs.readFile(path.join(root, 'job-id.json'))).jobId, acceptedCount: 1, point });
      setInterval(() => {}, 1000); await new Promise(() => {});
    }
  } });
  if (action === 'hold-unknown') {
    await fs.mkdir('/source', { recursive: true }); await fs.mkdir('/result', { recursive: true });
    await fs.writeFile('/source/fixture.nwd', 'offline immutable NWD fixture');
    const job = await core.captureJob({ sourcePath: '/source/fixture.nwd', namespace: { account: 'fixture-account', application: 'fixture-app' }, region: 'EMEA', destination: { bucket: 'fixture-bucket', objectKey: 'immutable.nwd' }, conversion: { format: 'svf', views: ['3d'], xAdsForce: false }, supportProfile: 'svf-local-7.130.0-v1', label: 'Crash fixture', output: '/result/result.zip' });
    await fs.writeFile(path.join(root, 'job-id.json'), JSON.stringify({ jobId: job.jobId }));
    await core.approveCost(job.jobId); await core.prepare(job.jobId);
  } else if (action === 'resume') {
    const { jobId } = JSON.parse(await fs.readFile(path.join(root, 'job-id.json')));
    const before = await core.readJob(jobId); let failure;
    try { await core.prepare(jobId); } catch (error) { failure = error.code; }
    const after = await core.readJob(jobId), acceptedCount = (await fs.readFile(log, 'utf8')).trim().split('\n').length;
    emit({ jobId, failure, phase: after.submission.phase, acceptedCount, submitCalls: provider.counts.submit ?? 0, sameFrozen: digest(before.frozen) === digest(after.frozen) });
    await journal.close();
  } else throw new Error('Unknown fixture action.');
}
