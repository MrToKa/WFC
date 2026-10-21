// Trusted offline fixture program. It is never included in an operations backup
// or called by production launchers. All paths are fresh, owned Docker volumes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createModelPreparer, createFakeProvider, createFakeCostProvider, createStore } from '/opt/preparer/index.mjs';
import { createJournal } from '/opt/preparer/app/io.mjs';
import { ROOTS, canonical, digest, fail, parseJson, writeExclusive } from '/ops/common.mjs';

const action = process.argv[2];
const layout = mode => ({ dataDirectory: `${ROOTS.data}/${mode}/core`, workDirectory: `${ROOTS.work}/${mode}/core-work`, service: `${ROOTS.data}/${mode}/service` });
async function namespace(mode) {
  const paths = layout(mode); await fs.mkdir(paths.service, { recursive: true, mode: 0o700 });
  await fs.mkdir(paths.workDirectory, { recursive: true, mode: 0o700 });
  const store = createStore(paths); await store.init(); const journal = await createJournal(paths.service); await journal.close(); return paths;
}
async function unknown(mode, { crash = false } = {}) {
  const paths = await namespace(mode), provider = createFakeProvider({ handlers: { submit: async () => { if (crash) process.exit(73); throw new Error('Deliberate offline fixture uncertainty'); } } }), costProvider = createFakeCostProvider();
  const core = await createModelPreparer({ ...paths, packageModulePath: '/opt/package/index.mjs', provider, costProvider });
  const sourcePath = path.join(ROOTS.work, mode, 'fixture.nwd'); await writeExclusive(sourcePath, 'Synthetic offline source; not a real NWD model.\n');
  const job = await core.captureJob({ sourcePath, namespace: { account: 'offline-fixture-account', application: 'offline-fixture-application' }, region: 'EMEA', destination: { bucket: 'offline-fixture-bucket', objectKey: 'unknown.nwd' },
    conversion: { format: 'svf', views: ['3d'], xAdsForce: false }, supportProfile: 'svf-local-7.130.0-v1', label: 'Offline unknown history', output: `${ROOTS.outputs}/${mode}/unknown.zip` });
  await core.approveCost(job.jobId); try { await core.prepare(job.jobId); fail('FIXTURE_EXPECTED_FAILURE'); } catch (error) { if (error.code !== 'PROVIDER_FAILURE') throw error; }
  const saved = await core.readJob(job.jobId); if (saved.submission.phase !== 'submission-unknown' || saved.submission.attempts.length !== 1 || provider.counts.submit !== 1) fail('FIXTURE_HISTORY_FAILED');
  return { jobId: job.jobId, frozenDigest: saved.frozenDigest, sourceSha256: saved.frozen.source.sha256, phase: saved.submission.phase, attempts: saved.submission.attempts.length, fakeSubmitCalls: provider.counts.submit, cloudCalls: 0 };
}
try {
  let result;
  if (action === 'seed') {
    await namespace('closed'); await namespace('live');
    const history = await unknown('simulation');
    const directory = `${ROOTS.data}/live/security`; await fs.mkdir(directory, { mode: 0o700 }); await writeExclusive(path.join(directory, 'cost-hmac.key'), randomBytes(32));
    result = { history, namespaces: ['closed', 'simulation', 'live'], privateSigningKeyCreated: true, cloudCalls: 0 };
  } else if (action === 'retry-unknown') {
    const paths = layout('simulation'), provider = createFakeProvider(), costProvider = createFakeCostProvider();
    const core = await createModelPreparer({ ...paths, packageModulePath: '/opt/package/index.mjs', provider, costProvider });
    const jobs = await core.listJobs(); if (jobs.length !== 1) fail('FIXTURE_HISTORY_FAILED'); const before = jobs[0];
    let denied; try { await core.prepare(before.jobId); fail('FIXTURE_EXPECTED_FAILURE'); } catch (error) { denied = error.code; }
    const after = await core.readJob(before.jobId);
    if (denied !== 'SUBMISSION_UNKNOWN' || provider.counts.submit !== 0 || after.submission.attempts.length !== 1 || after.frozenDigest !== before.frozenDigest) fail('FIXTURE_HISTORY_FAILED');
    result = { jobId: after.jobId, phase: after.submission.phase, attempts: after.submission.attempts.length, denied, fakeSubmitCalls: provider.counts.submit, cloudCalls: 0 };
  } else if (action === 'crash') {
    await namespace('live'); await unknown('simulation', { crash: true }); fail('FIXTURE_EXPECTED_CRASH');
  } else if (action === 'lock-inventory') {
    const locks = await fs.readdir(`${ROOTS.data}/simulation/core/locks`), records = [];
    for (const name of locks.sort()) { const bytes = await fs.readFile(`${ROOTS.data}/simulation/core/locks/${name}`); records.push({ name, bytes: bytes.length, sha256: digest(bytes), ownerSchemaVersion: parseJson(bytes).schemaVersion }); }
    result = { locks: records, count: records.length };
  } else fail('INVALID_COMMAND');
  process.stdout.write(`${canonical(result)}\n`);
} catch (error) { process.stderr.write(`${JSON.stringify({ code: /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'FIXTURE_FAILED' })}\n`); process.exitCode = 1; }
