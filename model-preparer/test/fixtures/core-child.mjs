import { appendFile } from 'node:fs/promises';
import { createModelPreparer, createFakeProvider, createFakeCostProvider, createStore } from '../../index.mjs';

const [dataDirectory, workDirectory, packageModulePath, jobId, remoteLog, crashPoint = 'none', clockValue] = process.argv.slice(2);
const clock = { now: () => Number(clockValue) };
const provider = createFakeProvider({ clock, handlers: {
  getStorage: async ctx => ({ bucket: ctx.destination.bucket, namespace: ctx.namespace, region: ctx.region }),
  getObject: async ctx => ({ objectId: ctx.objectId, bytes: ctx.source.bytes, sha256: ctx.source.sha256 }),
  getManifest: async ctx => ({ status: 'not-found', objectId: ctx.objectId, urn: ctx.urn, submissionIdentity: ctx.submissionIdentity, roots: [] }),
  submit: async (ctx, options) => {
    await appendFile(remoteLog, JSON.stringify({ submissionIdentity: ctx.submissionIdentity, attemptId: options.attemptId }) + '\n');
    return { result: 'created', objectId: ctx.objectId, urn: ctx.urn, submissionIdentity: ctx.submissionIdentity, providerJobId: 'fake-accepted-job' };
  },
} });
try {
  const store = createStore({ dataDirectory, workDirectory, clock, fault: async (point, details) => { if (crashPoint === 'afterCostCommit' && point === 'afterCommit' && details.kind === 'cost') process.exit(93); } });
  const core = await createModelPreparer({ dataDirectory, workDirectory, packageModulePath, store, provider, clock, costProvider: createFakeCostProvider({ clock }), fault: async point => { if (point === crashPoint) process.exit(93); } });
  process.send?.({ ready: true });
  await new Promise(resolve => process.once('message', resolve));
  const job = await core.prepare(jobId, { recoverDead: true });
  process.stdout.write(JSON.stringify({ status: job.status, attempts: job.submission.attempts.length, calls: provider.counts }) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ error: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'SAFE_FAILURE', calls: provider.counts }) + '\n');
  process.exitCode = 2;
}
process.disconnect?.();
