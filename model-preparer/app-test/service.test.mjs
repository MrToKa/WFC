import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { createPreparerService } from '../app/service.mjs';
import { readConfiguration } from '../app/config.mjs';
import { simulationResources } from '../app/simulation.mjs';
import { createFakeProvider, createFakeCostProvider, CoreError } from '../index.mjs';
import { createJournal } from '../app/io.mjs';
import * as PackageAPI from '../../routings-model-package/index.mjs';
import { safeError } from '../app/errors.mjs';

const packageModulePath = fileURLToPath(new URL('../../routings-model-package/index.mjs', import.meta.url));
async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'preparer-app-test-'));
  const dataDirectory = path.join(root, 'data'), workDirectory = path.join(root, 'work'), outputDirectory = path.join(root, 'output'), importRoot = path.join(root, 'imports');
  await fs.mkdir(importRoot);
  const sourceRoot = path.join(root, 'sources'); await fs.mkdir(sourceRoot);
  let sdkDirectory = null;
  if (options.sdk) { sdkDirectory = path.join(root, 'sdk'); await fs.mkdir(sdkDirectory); await fs.writeFile(path.join(sdkDirectory, 'viewer3D.min.js'), '/* trusted test SDK marker */'); await fs.writeFile(path.join(sdkDirectory, 'style.min.css'), 'body{}'); }
  const configuration = { mode: options.mode || 'closed', port: 0, host: '127.0.0.1', publicOrigin: 'http://127.0.0.1:0', dataDirectory, workDirectory, outputDirectory, packageModulePath, importRoot, sourceRoot, sdkDirectory, configuration: {} };
  if (options.beforeCreate) await options.beforeCreate({ root, configuration });
  const serviceOptions = options.serviceOptions || {};
  let service = await createPreparerService({ configuration, ...serviceOptions }); await service.listen();
  const config = await (await fetch(service.address + '/api/config')).json();
  const s = { root, configuration, service, csrfToken: config.csrfToken };
  s.call = async (route, { method = 'GET', input, body, requestId = randomUUID(), headers = {} } = {}) => {
    const response = await fetch(s.service.address + route, { method, headers: { ...(method === 'POST' ? { Origin: s.service.address, 'X-Preparer-Token': s.csrfToken, 'X-Request-Id': requestId } : {}), ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(input !== undefined ? { body: JSON.stringify(input) } : body !== undefined ? { body } : {}) });
    const text = await response.text(); let value; try { value = JSON.parse(text); } catch { value = text; }
    return { status: response.status, value, response };
  };
  s.wait = async operation => {
    // The UI polls at 1500 ms; this remains deliberately faster without
    // flooding the durable history reader and its publication fence.
    for (let i = 0; i < 300; i++) { const result = await s.call('/api/operations/' + operation.operationId); if (!['queued', 'running'].includes(result.value.operation?.status)) return result.value.operation; await new Promise(resolve => setTimeout(resolve, 500)); }
    throw new Error('Bounded operation wait exceeded');
  };
  s.restart = async () => { await s.service.close(); s.service = await createPreparerService({ configuration, ...serviceOptions }); await s.service.listen(); s.csrfToken = (await (await fetch(s.service.address + '/api/config')).json()).csrfToken; };
  t.after(async () => { await s.service.close(); if (s.retain) { t.diagnostic('Synthetic failed fixture retained at ' + root); return; } const actual = await fs.realpath(root); assert.equal(path.dirname(actual).toLowerCase(), (await fs.realpath(os.tmpdir())).toLowerCase()); assert.match(path.basename(actual), /^preparer-app-test-/); await fs.rm(actual, { recursive: true, force: true }); });
  return s;
}
async function simulatedJob(s, label = 'Synthetic fixture') {
  const started = await s.call('/api/simulation/capture', { method: 'POST', input: { label } }); assert.equal(started.status, 202);
  const completed = await s.wait(started.value.operation); assert.equal(completed.status, 'succeeded', JSON.stringify(completed)); return completed.jobId;
}
async function action(s, id, name, extra = {}) {
  const response = await s.call(`/api/jobs/${id}/actions`, { method: 'POST', input: { action: name, ...extra } }); assert.equal(response.status, 202, JSON.stringify(response.value));
  return s.wait(response.value.operation);
}

test('closed configuration, health and local listing perform no startup cloud actions or secret disclosure', async t => {
  const s = await setup(t);
  const response = await s.call('/api/config'); assert.equal(response.value.mode, 'closed'); assert.equal(response.value.startupCloudCalls, 0); assert.equal(response.value.cost.state, 'blocked');
  assert.deepEqual(response.value.livePolicy, { reuseOnly: true });
  assert.deepEqual((await s.call('/api/jobs')).value, { jobs: [] }); assert.equal((await s.call('/health')).value.status, 'ok');
  const diagnostics = (await s.call('/api/provider-diagnostics')).value; assert.equal(diagnostics.startupCloudCalls, 0); assert.equal(diagnostics.cloudMutations, 0); assert.deepEqual(diagnostics.requests, []);
  assert.equal((await s.call('/web/app.mjs')).status, 200);
  const env = { PREPARER_DATA_DIR: s.configuration.dataDirectory, PREPARER_WORK_DIR: s.configuration.workDirectory, PREPARER_OUTPUT_DIR: s.configuration.outputDirectory, PREPARER_PACKAGE_MODULE: packageModulePath, APS_CLIENT_ID: '"fixture-client-id"', APS_CLIENT_SECRET: "'PRIVATE_DOLLAR_$SECRET'", APS_REGION: 'EMEA # region comment', APS_BUCKET: 'fixture-bucket' };
  const configuration = readConfiguration(env); assert.deepEqual(configuration.configuration.APS_CLIENT_SECRET, { present: true, valid: true }); assert.equal(configuration.configuration.APS_REGION.valid, true); assert.doesNotMatch(JSON.stringify(configuration), /PRIVATE_DOLLAR|fixture-client-id|\$SECRET/);
});

test('host, same-origin, request identity and CSRF guards reject arbitrary browser mutations', async t => {
  const s = await setup(t);
  const valid = { method: 'POST', input: { label: 'Example' } };
  assert.equal((await s.call('/api/simulation/capture', { ...valid, headers: { Origin: 'http://evil.example' } })).status, 403);
  assert.equal((await s.call('/api/simulation/capture', { ...valid, headers: { 'X-Preparer-Token': 'wrong' } })).status, 403);
  assert.equal((await s.call('/api/simulation/capture', { ...valid, requestId: 'not-a-uuid' })).status, 400);
  const hostStatus = await new Promise((resolve, reject) => { http.get(s.service.address + '/api/config', { headers: { Host: 'evil.example' } }, response => { response.resume(); response.once('end', () => resolve(response.statusCode)); }).once('error', reject); });
  assert.equal(hostStatus, 403);
  assert.equal((await s.call('/api/jobs/capture', { method: 'POST', input: { sourcePath: 'C:/arbitrary.nwd', label: 'Example' } })).status, 400);
  assert.equal((await s.call('/sdk/%252e%252e/.env')).status, 400);
  const previewPolicy = (await s.call('/preview/' + randomUUID())).response.headers.get('content-security-policy'); assert.match(previewPolicy, /font-src 'self' data:;/); assert.match(previewPolicy, /script-src 'self' 'wasm-unsafe-eval';/);
  assert.match((await s.call('/health')).response.headers.get('content-security-policy'), /font-src 'self';/);
});

test('durable request identity returns the same capture operation, refuses mismatched input and survives restart', async t => {
  const s = await setup(t, { mode: 'simulation' });
  const requestId = randomUUID(), input = { label: 'Repeated button' };
  const a = await s.call('/api/simulation/capture', { method: 'POST', requestId, input }); assert.equal(a.status, 202);
  const b = await s.call('/api/simulation/capture', { method: 'POST', requestId, input }); assert.equal(b.status, 202); assert.equal(b.value.operation.operationId, a.value.operation.operationId);
  await s.wait(a.value.operation);
  assert.equal((await s.call('/api/simulation/capture', { method: 'POST', requestId, input: { label: 'Different input' } })).status, 409);
  await s.restart();
  const recovered = await s.call('/api/requests/' + requestId); assert.equal(recovered.value.operation.operationId, a.value.operation.operationId); assert.equal(recovered.value.operation.status, 'succeeded');
  assert.equal((await s.call('/api/jobs')).value.jobs.length, 1);
});

test('raw browser input is bounded, streamed and captured without exposing paths; closed actions cannot mutate APS', async t => {
  const s = await setup(t);
  const requestId = randomUUID(), body = Buffer.from('Synthetic upload content');
  const uploaded = await s.call('/api/uploads?kind=nwd', { method: 'POST', requestId, body, headers: { 'X-File-Name': 'input.nwd' } }); assert.equal(uploaded.status, 200);
  const repeated = await s.call('/api/uploads?kind=nwd', { method: 'POST', requestId, body, headers: { 'X-File-Name': 'input.nwd' } }); assert.equal(repeated.value.uploadId, uploaded.value.uploadId);
  assert.equal((await s.call('/api/uploads?kind=nwd', { method: 'POST', requestId, body: Buffer.from('different input bytes'), headers: { 'X-File-Name': 'input.nwd' } })).status, 409);
  const start = await s.call('/api/jobs/capture', { method: 'POST', input: { uploadId: uploaded.value.uploadId, label: 'Captured input' } });
  const done = await s.wait(start.value.operation); assert.equal(done.status, 'succeeded');
  const job = (await s.call('/api/jobs/' + done.jobId)).value.job;
  assert.equal(job.facts.source.name, 'input.nwd'); assert.equal(job.facts.source.bytes, body.length); assert.doesNotMatch(JSON.stringify(job), /snapshotPath|objectId|urn:adsk|bucket|[A-Z]:\\/);
  const denied = await s.call(`/api/jobs/${done.jobId}/actions`, { method: 'POST', input: { action: 'prepare' } }); assert.equal(denied.status, 409); assert.equal(denied.value.error.code, 'CLOUD_CLOSED');
  assert.equal((await s.call('/api/uploads?kind=nwd', { method: 'POST', body, headers: { 'X-File-Name': '..%2Fbad.nwd' } })).status, 400);
});

test('interrupted/incomplete upload removes only controlled staging and is never a ready capture', async t => {
  const s = await setup(t), requestId = randomUUID();
  await new Promise(resolve => {
    const request = http.request(s.service.address + '/api/uploads?kind=nwd', { method: 'POST', headers: { Origin: s.service.address, 'X-Preparer-Token': s.csrfToken, 'X-Request-Id': requestId, 'X-File-Name': 'incomplete.nwd', 'Content-Length': '100' } });
    request.on('error', () => resolve()); request.write('short'); setTimeout(() => { request.destroy(); resolve(); }, 30);
  });
  let observed;
  for (let i = 0; i < 100; i++) { observed = await s.call('/api/requests/' + requestId); if (observed.value.request?.status === 'interrupted') break; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(observed.value.request.status, 'interrupted');
  assert.deepEqual((await s.call('/api/jobs')).value.jobs, []);
  assert.deepEqual(await fs.readdir(path.join(s.configuration.workDirectory, 'closed', 'incoming')), []);
});

test('simulation completes through unchanged public packager; preview resources are exact raw whitelist and package export retains preview', async t => {
  let blockRead = false, enterBarrier;
  const s = await setup(t, { mode: 'simulation', sdk: true, serviceOptions: { fault: async (point, details) => {
    if (point === 'storeReadFailure') t.diagnostic(JSON.stringify(details));
    if (point === 'artifactVerified' && blockRead) { enterBarrier(); await new Promise((resolve, reject) => { const stopped = () => reject(new CoreError('LOCAL_ABORTED')); details.signal.addEventListener('abort', stopped, { once: true }); if (details.signal.aborted) stopped(); }); }
  } } }); const id = await simulatedJob(s);
  for (const name of ['approve-cost', 'prepare', 'reconcile', 'download', 'package']) { const result = await action(s, id, name); if (result.error?.code === 'STORE_CORRUPT') s.retain = true; assert.equal(result.status, 'succeeded', JSON.stringify({ name, result })); }
  const preview = await action(s, id, 'preview'); assert.equal(preview.status, 'succeeded', JSON.stringify(preview)); assert.equal(preview.result.previewUrl, '/preview/' + id);
  const descriptor = await s.call(`/api/artifacts/${id}/preview`); assert.equal(descriptor.value.resourceCount, 3); assert.equal(descriptor.value.modelUrl, `/preview-resources/${id}/resources/output/0/0.svf`);
  const raw = await fetch(s.service.address + `/preview-resources/${id}/resources/output/0/0.pf`); assert.equal(raw.headers.get('content-encoding'), null); assert.deepEqual(Buffer.from(await raw.arrayBuffer()), simulationResources()['resource-1'].data);
  assert.equal((await s.call(`/preview-resources/${id}/manifest.json`)).status, 404);
  const exported = await fetch(s.service.address + `/api/artifacts/${id}/package`); assert.equal(exported.status, 200); const archive = Buffer.from(await exported.arrayBuffer()); assert.ok(archive.length > 1000);
  assert.equal((await s.call(`/api/artifacts/${id}/preview`)).status, 200);
  const observation = { jobId: id, sdkVersion: '7.130.0', geometryLoaded: false, propertiesLoaded: false, geometryCount: 0, propertyCount: 0, cspViolationCount: 1, externalRequestCount: 0, previewStatus: 'FAIL' };
  assert.equal((await s.call('/api/browser-evidence', { method: 'POST', input: observation })).status, 200);
  const report = await s.call(`/api/artifacts/${id}/report`); assert.equal(report.value.verification.status, 'PASS'); assert.doesNotMatch(JSON.stringify(report.value), /snapshotPath|objectId|signedUrl|urn:adsk|file:\/\/|[A-Z]:\\/);
  assert.equal(report.status, 200); assert.equal(report.response.headers.get('content-disposition'), `attachment; filename="${id}-report.json"`);
  assert.match(report.response.headers.get('content-type'), /^application\/json/); assert.equal(report.value.reportSchemaVersion, 1); assert.equal(report.value.job.jobId, id);
  assert.equal(report.value.browserObservation.previewStatus, 'FAIL'); assert.equal(report.value.browserObservation.basis, 'client-reported-observation');
  assert.equal(report.value.cloudActivity.requestCount, 0); assert.equal(report.value.cloudActivity.cloudMutations, 0); assert.ok(report.value.simulationActivity.callCount > 0);
  await s.restart(); assert.equal((await s.call('/api/jobs/' + id)).value.job.status, 'packaged'); assert.equal((await s.call(`/api/artifacts/${id}/preview`)).status, 200);
  const artifactFile = path.join(s.configuration.dataDirectory, 'simulation', 'service', 'artifacts', id + '.json');
  const artifact = JSON.parse(await fs.readFile(artifactFile, 'utf8')).value;
  const rawPath = path.join(artifact.previewDirectory, 'resources', 'output', '0', '0.pf'); await fs.chmod(rawPath, 0o600); await fs.writeFile(rawPath, 'corrupt resource');
  assert.equal((await s.call(`/preview-resources/${id}/resources/output/0/0.pf`)).status, 409);
  assert.equal((await action(s, id, 'preview')).status, 'succeeded');
  const committedArtifact = await fs.readFile(artifactFile);
  blockRead = true; const barrier = new Promise(resolve => { enterBarrier = resolve; });
  const exporting = fetch(s.service.address + `/api/artifacts/${id}/package`).then(response => response.status, () => null);
  await barrier; await s.service.close(); assert.notEqual(await exporting, 200);
  assert.deepEqual(await fs.readFile(artifactFile), committedArtifact, 'Shutdown must prevent the read verifier from committing after releasing ownership');
  blockRead = false; await s.restart();
  await fs.chmod(path.join(s.configuration.outputDirectory, 'simulation', `${id}.zip`), 0o600);
  await fs.writeFile(path.join(s.configuration.outputDirectory, 'simulation', `${id}.zip`), 'corrupt archive');
  assert.equal((await s.call(`/api/artifacts/${id}/package`)).status, 409);
  const invalidReport = await s.call(`/api/artifacts/${id}/report`); assert.equal(invalidReport.status, 409); assert.equal(invalidReport.value.error.code, 'ARTIFACT_INVALID');
  assert.equal(invalidReport.response.headers.get('content-disposition'), null); assert.equal(invalidReport.value.reportSchemaVersion, undefined);
  assert.equal((await s.call(`/api/artifacts/${id}/preview`)).status, 409);
  assert.equal((await s.call(`/preview-resources/${id}/resources/output/0/0.pf`)).status, 409);
});

test('allowlisted ZIP registration uses opaque IDs only; corrupt received ZIP never becomes a ready job', async t => {
  const s = await setup(t);
  await fs.writeFile(path.join(s.configuration.importRoot, 'bad.zip'), 'not a ZIP');
  const imports = (await s.call('/api/imports')).value.inputs; assert.equal(imports.length, 1); assert.equal(imports[0].inputId.length, 64);
  const start = await s.call('/api/jobs/register-known', { method: 'POST', input: { inputId: imports[0].inputId } }); const done = await s.wait(start.value.operation); assert.equal(done.status, 'failed');
  assert.deepEqual((await s.call('/api/jobs')).value.jobs, []);
  const upload = await s.call('/api/uploads?kind=package', { method: 'POST', body: Buffer.from('corrupt package'), headers: { 'X-File-Name': 'bad.zip' } });
  const registered = await s.call('/api/jobs/register', { method: 'POST', input: { uploadId: upload.value.uploadId } }); assert.equal((await s.wait(registered.value.operation)).status, 'failed');
});

test('cancel owns an operation controller across core polling backoff and never claims remote cancellation', async t => {
  const s = await setup(t, { mode: 'simulation' }), id = await simulatedJob(s);
  const waiting = await s.call(`/api/jobs/${id}/actions`, { method: 'POST', input: { action: 'wait' } });
  const cancelled = await s.call(`/api/operations/${waiting.value.operation.operationId}/cancel`, { method: 'POST', input: {} }); assert.equal(cancelled.status, 202);
  const result = await s.wait(waiting.value.operation); assert.equal(result.status, 'interrupted'); assert.equal(result.error.code, 'LOCAL_ABORTED');
  assert.equal((await s.call('/api/jobs/' + id)).value.job.status, 'interrupted');
});

test('a real service process crash retains committed request identity and restart marks it interrupted without replay', async t => {
  const s = await setup(t, { mode: 'simulation' }); await s.service.close();
  const child = spawn(process.execPath, [fileURLToPath(new URL('./service-child.mjs', import.meta.url)), JSON.stringify(s.configuration)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errorText = ''; child.stderr.on('data', chunk => { errorText += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; });
  const ready = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', () => reject(new Error(errorText))); });
  const token = (await (await fetch(ready.address + '/api/config')).json()).csrfToken;
  const requestId = randomUUID(), barrier = new Promise(resolve => child.once('message', resolve));
  const response = await fetch(ready.address + '/api/simulation/capture', { method: 'POST', headers: { Origin: ready.address, 'X-Preparer-Token': token, 'X-Request-Id': requestId, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'Crash fixture' }) });
  assert.equal(response.status, 202); const started = await response.json(); assert.equal((await barrier).barrier, true);
  child.kill('SIGKILL'); await exited;
  s.service = await createPreparerService({ configuration: s.configuration }); await s.service.listen();
  s.csrfToken = (await (await fetch(s.service.address + '/api/config')).json()).csrfToken;
  const recovered = await s.call('/api/requests/' + requestId); assert.equal(recovered.value.operation.operationId, started.operation.operationId); assert.equal(recovered.value.operation.status, 'interrupted'); assert.equal(recovered.value.operation.error.code, 'OPERATION_INTERRUPTED');
  assert.deepEqual((await s.call('/api/jobs')).value.jobs, []);
});

test('service journal missing required evidence directory fails closed instead of forgetting idempotency history', async t => {
  const s = await setup(t); await s.service.close();
  const root = path.join(s.configuration.dataDirectory, 'closed', 'service');
  await fs.rmdir(path.join(root, 'requests'));
  await assert.rejects(createPreparerService({ configuration: s.configuration }), { code: 'STORE_CORRUPT' });
});

test('bounded browser evidence stores observations only and rejects URLs/secrets or arbitrary extra fields', async t => {
  const s = await setup(t, { mode: 'simulation' }), jobId = await simulatedJob(s);
  const input = { jobId, sdkVersion: '7.130.0', geometryLoaded: false, propertiesLoaded: false, geometryCount: 0, propertyCount: 0, cspViolationCount: 0, externalRequestCount: 0 };
  const accepted = await s.call('/api/browser-evidence', { method: 'POST', input }); assert.equal(accepted.status, 200); assert.equal(accepted.value.evidence.basis, 'client-reported-observation');
  assert.equal((await s.call('/api/browser-evidence', { method: 'POST', input: { ...input, previewStatus: 'FAIL', cspViolationCount: 1 } })).value.evidence.previewStatus, 'FAIL');
  assert.equal((await s.call('/api/browser-evidence', { method: 'POST', input: { ...input, previewStatus: 'UNVERIFIED' } })).status, 400);
  assert.equal((await s.call('/api/browser-evidence', { method: 'POST', input: { ...input, url: 'https://example/?token=PRIVATE' } })).status, 400);
  assert.equal((await s.call('/api/browser-evidence', { method: 'POST', input: { ...input, geometryCount: -1 } })).status, 400);
});

test('read-only NWD source chooser captures an opaque direct-file selection and preserves the original', async t => {
  const s = await setup(t); const original = Buffer.from('explicit read-only source fixture');
  await fs.writeFile(path.join(s.configuration.sourceRoot, 'selected.nwd'), original);
  await fs.writeFile(path.join(s.configuration.sourceRoot, 'ignored.txt'), 'ignored');
  const inputs = (await s.call('/api/source-inputs')).value.inputs; assert.equal(inputs.length, 1); assert.equal(inputs[0].name, 'selected.nwd');
  const started = await s.call('/api/jobs/capture-known', { method: 'POST', input: { inputId: inputs[0].inputId, label: 'Known local source' } }); assert.equal(started.status, 202);
  const complete = await s.wait(started.value.operation); assert.equal(complete.status, 'succeeded', JSON.stringify(complete));
  assert.deepEqual(await fs.readFile(path.join(s.configuration.sourceRoot, 'selected.nwd')), original);
  const job = (await s.call('/api/jobs/' + complete.jobId)).value.job; assert.equal(job.facts.source.name, 'selected.nwd'); assert.equal(job.facts.source.bytes, original.length);
  assert.equal((await s.call('/api/jobs/capture-known', { method: 'POST', input: { inputId: '0'.repeat(64), label: 'Unknown' } })).status, 202);
});

test('a lost committed service request record is detected independently and cannot silently replay', async t => {
  const s = await setup(t, { mode: 'simulation' });
  const requestId = randomUUID(), started = await s.call('/api/simulation/capture', { method: 'POST', requestId, input: { label: 'Protected request history' } }); await s.wait(started.value.operation);
  await s.service.close();
  const record = path.join(s.configuration.dataDirectory, 'simulation', 'service', 'requests', requestId + '.json');
  await fs.unlink(record);
  await assert.rejects(createPreparerService({ configuration: s.configuration }), { code: 'STORE_CORRUPT' });
});

test('two actual service starts share one lifecycle ownership boundary without deleting the winner', async t => {
  const s = await setup(t); await s.service.close();
  const childPath = fileURLToPath(new URL('./service-child.mjs', import.meta.url));
  const launch = () => {
    const child = spawn(process.execPath, [childPath, JSON.stringify(s.configuration)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
    const ready = new Promise(resolve => { child.once('message', data => resolve({ child, data, exited })); child.once('exit', code => resolve({ child, code, stderr, exited })); });
    return { child, exited, ready };
  };
  const a = launch(), b = launch();
  t.after(async () => { for (const item of [a, b]) { if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill(); await item.exited; } });
  const results = await Promise.all([a.ready, b.ready]), winners = results.filter(item => item.data?.ready);
  assert.equal(winners.length, 1, JSON.stringify(results.map(item => ({ ready: item.data?.ready, code: item.code }))));
  const winner = winners[0]; assert.equal((await (await fetch(winner.data.address + '/health')).json()).status, 'ok');
  winner.child.send('close'); assert.equal(await winner.exited, 0);
  s.service = await createPreparerService({ configuration: s.configuration }); await s.service.listen();
});

test('explicit live mode without trusted proof stays visibly closed in its isolated live namespace', async t => {
  const s = await setup(t, { mode: 'live' });
  const config = (await s.call('/api/config')).value;
  assert.equal(config.mode, 'closed'); assert.equal(config.requestedMode, 'live'); assert.equal(config.providerMode, 'closed'); assert.equal(config.cost.state, 'blocked'); assert.equal(config.startupCloudCalls, 0);
  assert.equal((await s.call('/health')).value.requestedMode, 'live');
  assert.deepEqual((await s.call('/api/jobs')).value.jobs, []);
  assert.ok((await fs.stat(path.join(s.configuration.dataDirectory, 'live', 'core'))).isDirectory());
  await assert.rejects(fs.stat(path.join(s.configuration.dataDirectory, 'closed')), { code: 'ENOENT' });
});

test('an upload write with no disk space returns a controlled 507 and removes incomplete staging', async t => {
  const s = await setup(t, { serviceOptions: { fault: async point => { if (['uploadWrite', 'uploadFailurePersist'].includes(point)) { const error = new Error('PRIVATE filesystem path'); error.code = 'ENOSPC'; throw error; } } } });
  const requestId = randomUUID(), reply = await s.call('/api/uploads?kind=nwd', { method: 'POST', requestId, body: Buffer.from('Synthetic bytes'), headers: { 'X-File-Name': 'full.nwd' } });
  assert.equal(reply.status, 507); assert.equal(reply.value.error.code, 'NO_SPACE'); assert.doesNotMatch(JSON.stringify(reply.value), /PRIVATE|filesystem/);
  assert.equal((await s.call('/api/requests/' + requestId)).value.request.status, 'interrupted');
  assert.deepEqual((await s.call('/api/jobs')).value.jobs, []);
  assert.deepEqual(await fs.readdir(path.join(s.configuration.workDirectory, 'closed', 'incoming')), []);
});

test('HTTP unknown submission retains one intent and reconciliation never posts another conversion', async t => {
  let observed = 'not-found';
  const provider = createFakeProvider({ resources: simulationResources(), handlers: {
    submit: async (_ctx, _opts, fixture) => { await fixture.default(); throw new CoreError('PROVIDER_FAILURE'); },
    getManifest: async ctx => ({ status: observed, objectId: ctx.objectId, urn: ctx.urn, submissionIdentity: ctx.submissionIdentity, roots: observed === 'success' ? [{ rootId: 'reused-root', format: 'svf', supportProfile: ctx.supportProfile }] : [] }),
  } });
  const s = await setup(t, { mode: 'simulation', serviceOptions: { simulationProvider: provider } }), id = await simulatedJob(s);
  assert.equal((await action(s, id, 'approve-cost')).status, 'succeeded');
  const requestId = randomUUID(), started = await s.call(`/api/jobs/${id}/actions`, { method: 'POST', requestId, input: { action: 'prepare' } }); assert.equal(started.status, 202); assert.equal((await s.wait(started.value.operation)).status, 'failed');
  let job = (await s.call('/api/jobs/' + id)).value.job; assert.equal(job.facts.submission.phase, 'submission-unknown'); assert.equal(job.facts.submission.attempts, 1); assert.equal(provider.counts.submit, 1);
  assert.equal((await s.call(`/api/jobs/${id}/actions`, { method: 'POST', input: { action: 'prepare' } })).status, 409);
  const same = await s.call(`/api/jobs/${id}/actions`, { method: 'POST', requestId, input: { action: 'prepare' } }); assert.equal(same.status, 202); assert.equal(same.value.operation.operationId, started.value.operation.operationId); assert.equal(provider.counts.submit, 1);
  for (const status of ['not-found', 'pending']) { observed = status; assert.equal((await action(s, id, 'reconcile')).status, 'succeeded'); assert.equal((await s.call('/api/jobs/' + id)).value.job.facts.submission.phase, 'submission-unknown'); }
  observed = 'success'; assert.equal((await action(s, id, 'reconcile')).status, 'succeeded');
  job = (await s.call('/api/jobs/' + id)).value.job; assert.equal(job.facts.submission.phase, 'complete'); assert.equal(job.facts.submission.attempts, 1); assert.equal(provider.counts.submit, 1);
  const diagnostics = (await s.call('/api/provider-diagnostics')).value; assert.equal(diagnostics.counts.submit, 1); assert.equal(diagnostics.cloudMutations, 0); assert.doesNotMatch(JSON.stringify(diagnostics), /submissionIdentity|remoteTargetIdentity|urn:adsk|signedUrl|bucket/);
});

test('HTTP download with multiple compatible roots requires an explicit choice', async t => {
  const provider = createFakeProvider({ resources: simulationResources(), handlers: {
    getManifest: async (ctx, _opts, fixture) => { const observation = await fixture.default(); return observation.status === 'success' ? { ...observation, roots: ['root-one', 'root-two'].map(rootId => ({ rootId, format: 'svf', supportProfile: ctx.supportProfile })) } : observation; },
    getDownloadPlan: async (ctx, opts, fixture) => ({ schemaVersion: 1, submissionIdentity: ctx.submissionIdentity, objectId: ctx.objectId, urn: ctx.urn, region: ctx.region, rootId: opts.rootId, supportProfile: ctx.supportProfile, resources: fixture.provider.transport.describeResources() }),
  } });
  const s = await setup(t, { mode: 'simulation', serviceOptions: { simulationProvider: provider } }), id = await simulatedJob(s);
  for (const name of ['approve-cost', 'prepare', 'reconcile']) assert.equal((await action(s, id, name)).status, 'succeeded');
  assert.deepEqual((await s.call('/api/jobs/' + id)).value.job.roots.map(root => root.rootId), ['root-one', 'root-two']);
  const ambiguous = await action(s, id, 'download'); assert.equal(ambiguous.status, 'failed'); assert.equal(ambiguous.error.code, 'DERIVATIVE_AMBIGUOUS'); assert.equal(provider.counts.getDownloadPlan, 0);
  assert.equal((await action(s, id, 'download', { rootId: 'root-two' })).status, 'succeeded');
  assert.equal((await s.call('/api/jobs/' + id)).value.job.facts.download.completedResources, 3); assert.equal(provider.counts.submit, 1);
});

test('HTTP cancellation during a partial raw download resumes durable checkpoints without resubmitting', async t => {
  let pause = true;
  const provider = createFakeProvider({ resources: simulationResources(), handlers: {
    readResource: async (_ctx, opts, fixture) => opts.resourceId === 'resource-0' && pause ? (async function* () { for await (const chunk of fixture.default()) { yield chunk.subarray(0, 1); await new Promise(() => {}); } })() : fixture.default(),
  } });
  const s = await setup(t, { mode: 'simulation', serviceOptions: { simulationProvider: provider } }), id = await simulatedJob(s);
  for (const name of ['approve-cost', 'prepare', 'reconcile']) assert.equal((await action(s, id, name)).status, 'succeeded');
  const started = await s.call(`/api/jobs/${id}/actions`, { method: 'POST', input: { action: 'download' } }); assert.equal(started.status, 202);
  let observed;
  for (let attempt = 0; attempt < 300; attempt++) { observed = (await s.call('/api/jobs/' + id)).value.job; if (observed.facts.download?.completedResources === 1 && provider.calls.some(row => row.operation === 'readResource' && row.resourceId === 'resource-0')) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(observed.facts.download.completedResources, 1);
  assert.equal((await s.call(`/api/operations/${started.value.operation.operationId}/cancel`, { method: 'POST', input: {} })).status, 202);
  const stopped = await s.wait(started.value.operation); assert.equal(stopped.status, 'interrupted'); assert.equal(stopped.error.code, 'LOCAL_ABORTED');
  pause = false; assert.equal((await action(s, id, 'download')).status, 'succeeded');
  assert.equal((await s.call('/api/jobs/' + id)).value.job.facts.download.completedResources, 3);
  assert.equal(provider.calls.filter(row => row.operation === 'readResource' && row.resourceId === 'resource-1').length, 1); assert.equal(provider.counts.submit, 1);
});

for (const condition of ['denied', 'expired']) test(`HTTP ${condition} price evidence blocks all simulated mutations`, async t => {
  let current = Date.now(); const clock = { now: () => current };
  const provider = createFakeProvider({ resources: simulationResources() }), costProvider = createFakeCostProvider({ clock, ttlMs: 1000, ...(condition === 'denied' ? { evidence: null } : {}) });
  const s = await setup(t, { mode: 'simulation', serviceOptions: { simulationProvider: provider, simulationCostProvider: costProvider, clock } }), id = await simulatedJob(s);
  assert.equal((await action(s, id, 'approve-cost')).status, 'succeeded');
  assert.equal((await s.call('/api/jobs/' + id)).value.job.facts.cost.allowed, condition === 'expired');
  if (condition === 'expired') current += 1000;
  const blocked = await action(s, id, 'prepare'); assert.equal(blocked.status, 'failed'); assert.equal(blocked.error.code, 'COST_BLOCKED');
  assert.equal(provider.counts.createStorage, 0); assert.equal(provider.counts.upload, 0); assert.equal(provider.counts.submit, 0);
});

test('live reuse closes cloud reads on expiry while downloaded resources remain locally packageable after restart', async t => {
  const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
  const source = Buffer.from('synthetic live-adapter service fixture; no real model'), name = 'fixture.nwd';
  const credentials = { clientId: 'fixture-service-client', clientSecret: 'PRIVATE_SERVICE_SECRET', bucket: 'private-service-bucket', region: 'EMEA' };
  let current = Date.now(), calls = 0; const clock = { now: () => current };
  const actualId = `urn:adsk.objects:os.object:${credentials.bucket}/${name}`, actualUrn = Buffer.from(actualId).toString('base64url');
  const modelFiles = new Map(Object.values(simulationResources()).map(resource => [path.posix.basename(resource.path), resource.data]));
  const json = value => ({ statusCode: 200, headers: {}, body: Buffer.from(JSON.stringify(value)) });
  const apsTestTransport = { request: async input => { calls++; const endpoint = new URL(input.url).pathname;
    if (endpoint === '/authentication/v2/token') return json({ access_token: 'PRIVATE_FIXTURE_TOKEN', expires_in: 3600 });
    assert.equal(input.method, 'GET', 'The reuse fixture cannot mutate cloud data');
    if (new URL(input.url).hostname === 'cdn.derivative.autodesk.com') {
      const body = modelFiles.get(path.posix.basename(endpoint)); assert.ok(body, 'Only fixed synthetic raw resources may be fetched');
      return { statusCode: 200, headers: { 'content-length': String(body.length) }, body };
    }
    if (endpoint.endsWith('/signedcookies')) {
      const resourceName = path.posix.basename(decodeURIComponent(endpoint.split('/').at(-2))), body = modelFiles.get(resourceName);
      assert.ok(body, 'Only fixed synthetic raw resources may be signed');
      return json({ size: body.length, expiration: current + 60000, url: `https://cdn.derivative.autodesk.com/fixtures/${resourceName}?Policy=fixture&Signature=fixture&Key-Pair-Id=fixture` });
    }
    if (endpoint.includes('/objects/') && endpoint.endsWith('/details')) return json({ bucketKey: credentials.bucket, objectId: actualId, objectKey: name, size: source.length, sha1: hash(source, 'sha1') });
    if (endpoint.endsWith('/details')) return json({ bucketKey: credentials.bucket, bucketOwner: credentials.clientId, permissions: [{ authId: credentials.clientId, access: 'full' }] });
    if (endpoint.endsWith('/manifest')) return json({ urn: actualUrn, status: 'success', derivatives: [{ outputType: 'svf', status: 'success', children: [{ type: 'geometry', role: '3d', status: 'success', children: [{ mime: 'application/autodesk-svf', role: 'graphics', status: 'success', urn: `urn:adsk.viewing:fs.file:${actualUrn}/output/0/0.svf` }, { mime: 'application/autodesk-db', role: 'Autodesk.CloudPlatform.PropertyDatabase', status: 'success', urn: `urn:adsk.viewing:fs.file:${actualUrn}/output/0/properties.db` }] }] }] });
    assert.fail('Unexpected trusted fixture request');
  } };
  const s = await setup(t, { mode: 'live', serviceOptions: { clock, privateAPSConfiguration: credentials, apsTestTransport }, beforeCreate: async ({ root, configuration }) => {
    await fs.writeFile(path.join(configuration.sourceRoot, name), source);
    const proofRoot = path.join(root, 'proof'); await fs.mkdir(proofRoot);
    const observation = Buffer.from('Synthetic operator observation: NOT live account evidence.'); await fs.writeFile(path.join(proofRoot, 'observation.txt'), observation);
    const proof = { schemaVersion: 1, kind: 'autodesk-account-operator-review', reviewId: randomUUID(), checkedAt: new Date(current).toISOString(), expiresAt: new Date(current + 1000).toISOString(),
      account: { applicationHash: hash(credentials.clientId), teamHash: hash('synthetic-team'), hubHash: hash('synthetic-hub'), offering: 'Free', paidFallback: false, regionHash: hash(credentials.region), bucketHash: hash(credentials.bucket) },
      operations: { storage: { zero: true, count: 1 }, upload: { zero: true, count: 1, maxBytes: 2147483648 }, submit: { zero: true, count: 1, complexJobsRemaining: 10 }, read: { zero: true, maxCalls: 20, remainingConservative: 9990 } },
      approvedSources: [{ name, bytes: source.length, sha256: hash(source) }], conversion: { format: 'svf', views: ['3d'], xAdsForce: false }, supportProfile: 'svf-local-7.130.0-v1', origins: ['https://manage.autodesk.com/'],
      observations: { artifacts: [{ name: 'observation.txt', bytes: observation.length, sha256: hash(observation) }], basicCallsObserved: 10, complexJobsObserved: 0, complexChargedUnitsAvailable: 5, complexJobsPerChargedUnit: 2, basicCallsPerChargedUnit: 10000, nextRefresh: '2026-11-14', readAllowanceDerivation: 'synthetic fixture allowance' },
      verifier: { method: 'authenticated-browser-review', actor: 'authorized-operator', bindingMatches: true }, authorization: { explicitUserAuthorized: true, confirmedAt: new Date(current).toISOString() } };
    const content = JSON.stringify(proof); configuration.proofPath = path.join(proofRoot, 'proof.json'); configuration.proofSha256 = hash(content); configuration.signingKeyPath = path.join(root, 'private', 'signing.key'); configuration.liveReuseOnly = true; await fs.writeFile(configuration.proofPath, content);
  } });
  assert.equal(calls, 0); let config = (await s.call('/api/config')).value; assert.equal(config.mode, 'live'); assert.equal(config.cost.state, 'verified'); assert.equal(calls, 0);
  const input = (await s.call('/api/source-inputs')).value.inputs[0];
  const captured = await s.call('/api/jobs/capture-known', { method: 'POST', input: { inputId: input.inputId, label: 'Synthetic APS adapter evidence' } }); const done = await s.wait(captured.value.operation); assert.equal(done.status, 'succeeded');
  assert.equal((await action(s, done.jobId, 'approve-cost')).status, 'succeeded'); assert.equal(calls, 0);
  const prepared = await action(s, done.jobId, 'prepare'); assert.equal(prepared.status, 'succeeded', JSON.stringify({ prepared, diagnostics: (await s.call('/api/provider-diagnostics')).value }));
  const diagnostics = (await s.call('/api/provider-diagnostics')).value; assert.equal(diagnostics.cloudMutations, 0); assert.equal(diagnostics.startupCloudCalls, 0); assert.equal(diagnostics.counts.submit, 0); assert.equal(diagnostics.requests.length, calls); assert.equal(diagnostics.counts.getObject, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE|private-service-bucket|urn:adsk|Authorization|https:/);
  const job = (await s.call('/api/jobs/' + done.jobId)).value.job; assert.equal(job.providerMode, 'live'); assert.equal(job.facts.submission.attempts, 0); assert.equal(job.facts.submission.phase, 'complete'); assert.doesNotMatch(JSON.stringify(job), /PRIVATE|private-service-bucket|urn:adsk/);
  assert.ok(!job.allowedActions.includes('package'));
  const premature = await s.call(`/api/jobs/${done.jobId}/actions`, { method: 'POST', input: { action: 'package' } }); assert.equal(premature.status, 409); assert.equal(premature.value.error.code, 'ACTION_NOT_ALLOWED');
  const downloaded = await action(s, done.jobId, 'download'); assert.equal(downloaded.status, 'succeeded', JSON.stringify(downloaded));
  assert.equal((await s.call('/api/jobs/' + done.jobId)).value.job.facts.download.completedResources, 3);
  current += 1000; config = (await s.call('/api/config')).value; assert.equal(config.cost.state, 'blocked'); assert.equal(config.cost.code, 'COST_EXPIRED');
  const before = calls, denied = await action(s, done.jobId, 'reconcile'); assert.equal(denied.status, 'failed'); assert.equal(calls, before);
  assert.equal(denied.error.code, 'COST_EXPIRED'); assert.match(denied.error.message, /new current review/);
  const expiredJob = (await s.call('/api/jobs/' + done.jobId)).value.job;
  assert.equal(expiredJob.error.code, 'COST_EXPIRED'); assert.equal(expiredJob.error.message, denied.error.message);
  assert.doesNotMatch(JSON.stringify({ denied, expiredJob }), /PRIVATE|private-service-bucket|urn:adsk|Bearer|https:/);
  await s.restart(); config = (await s.call('/api/config')).value; assert.equal(config.mode, 'closed'); assert.equal(config.requestedMode, 'live'); assert.equal(config.startupCloudCalls, 0);
  const resumed = (await s.call('/api/jobs/' + done.jobId)).value.job;
  assert.equal(resumed.mode, 'live'); assert.equal(resumed.providerMode, 'closed'); assert.equal(resumed.facts.download.status, 'downloaded'); assert.ok(resumed.allowedActions.includes('package'));
  for (const cloudAction of ['prepare', 'download']) { const blocked = await s.call(`/api/jobs/${done.jobId}/actions`, { method: 'POST', input: { action: cloudAction } }); assert.equal(blocked.status, 409); assert.equal(blocked.value.error.code, 'CLOUD_CLOSED'); }
  const unknown = await s.call(`/api/jobs/${randomUUID()}/actions`, { method: 'POST', input: { action: 'package' } }); assert.equal(unknown.status, 404); assert.equal(unknown.value.error.code, 'JOB_MISSING');
  const packaged = await action(s, done.jobId, 'package'); assert.equal(packaged.status, 'succeeded', JSON.stringify(packaged));
  const ready = (await s.call('/api/jobs/' + done.jobId)).value.job; assert.equal(ready.status, 'packaged'); assert.equal(ready.facts.package.resourceCount, 3);
  const exported = await fetch(s.service.address + `/api/artifacts/${done.jobId}/package`); assert.equal(exported.status, 200);
  const exportedBytes = Buffer.from(await exported.arrayBuffer()); assert.equal(exportedBytes.length, ready.facts.package.bytes); assert.equal(hash(exportedBytes), ready.facts.package.sha256);
  const originalOutput = path.join(s.configuration.outputDirectory, 'live', `${done.jobId}.zip`);
  assert.equal((await PackageAPI.verifyPackage(originalOutput)).status, 'PASS');
  const localDiagnostics = (await s.call('/api/provider-diagnostics')).value; assert.equal(localDiagnostics.startupCloudCalls, 0); assert.equal(localDiagnostics.requests.length, 0); assert.equal(localDiagnostics.cloudMutations, 0); assert.equal(calls, before);
});

test('closed service journal rejects a late writer after releasing its owner lease', async t => {
  const s = await setup(t), root = path.join(s.root, 'journal-close-fixture');
  const journal = await createJournal(root); await journal.close();
  assert.throws(() => journal.write('requests', randomUUID(), { status: 'succeeded' }), { code: 'SHUTTING_DOWN' });
  assert.deepEqual(await fs.readdir(path.join(root, 'requests')), []);
});

test('trusted container instance identity is recorded on the service lease and never exposed to clients', async t => {
  const instanceId = randomUUID();
  const s = await setup(t, { beforeCreate: ({ configuration }) => { configuration.instanceId = instanceId; } });
  const owner = JSON.parse(await fs.readFile(path.join(s.configuration.dataDirectory, 'closed', 'service', 'service-owner.json'), 'utf8'));
  assert.equal(owner.instanceId, instanceId); assert.equal(owner.pid, process.pid); assert.equal(typeof owner.nonce, 'string');
  assert.ok(!JSON.stringify((await s.call('/api/config')).value).includes(instanceId));
  assert.ok(!JSON.stringify((await s.call('/api/provider-diagnostics')).value).includes(instanceId));
  await s.service.close();
  const marker = path.join(s.configuration.dataDirectory, 'closed', 'core', '.docker-recovery.mutex'); await fs.mkdir(marker);
  await assert.rejects(createPreparerService({ configuration: s.configuration }), { code: 'LOCK_BUSY' });
  assert.ok((await fs.stat(marker)).isDirectory(), 'Startup must preserve an ambiguous recovery marker');
});

test('package export rejects a different valid archive published after verification and serves no stale preview', async t => {
  let replace = false, archivePath, replacementPath;
  const s = await setup(t, { sdk: true, serviceOptions: { fault: async point => { if (point === 'artifactVerified' && replace) { replace = false; await fs.chmod(archivePath, 0o600); await fs.rename(replacementPath, archivePath); } } } });
  const modelDir = path.join(s.root, 'export-model'), source = path.join(s.configuration.sourceRoot, 'export-fixture.nwd');
  await fs.mkdir(path.join(modelDir, 'output', '0'), { recursive: true }); await fs.writeFile(source, 'Synthetic immutable NWD for export identity fixture');
  const modelResources = Object.values(simulationResources());
  for (const resource of modelResources) await fs.writeFile(path.join(modelDir, ...resource.path.split('/')), resource.data);
  await fs.writeFile(path.join(modelDir, 'model.json'), JSON.stringify({ name: path.basename(source), format: 'svf', entrypoint: '/model/output/0/0.svf', viewerVersion: '7.130.0', preparedAt: new Date().toISOString(), sourceBytes: (await fs.stat(source)).size, resourceCount: modelResources.length, totalBytes: modelResources.reduce((sum, resource) => sum + resource.data.length, 0) }));
  await fs.writeFile(path.join(modelDir, 'integrity.json'), JSON.stringify(Object.fromEntries(modelResources.map(resource => [resource.path, { bytes: resource.data.length, sha256: createHash('sha256').update(resource.data).digest('hex'), transport: 'raw-http-v1' }]))));
  archivePath = path.join(s.configuration.importRoot, 'original.zip'); await PackageAPI.packModel({ modelDir, source, output: archivePath, label: 'Export fixture' });
  const original = await fs.readFile(archivePath), comment = Buffer.from('second-valid-transport');
  assert.equal(original.readUInt32LE(original.length - 22), 0x06054b50); assert.equal(original.readUInt16LE(original.length - 2), 0);
  const different = Buffer.concat([original, comment]); different.writeUInt16LE(comment.length, original.length - 2);
  replacementPath = path.join(s.root, 'replacement.zip'); await fs.writeFile(replacementPath, different);
  assert.equal((await PackageAPI.verifyPackage(replacementPath)).status, 'PASS', 'Replacement must independently be a valid v1 package');
  const input = (await s.call('/api/imports')).value.inputs[0];
  const registration = await s.call('/api/jobs/register-known', { method: 'POST', input: { inputId: input.inputId } }); const ready = await s.wait(registration.value.operation); assert.equal(ready.status, 'succeeded');
  assert.equal((await action(s, ready.jobId, 'preview')).status, 'succeeded');
  const raw = await fetch(s.service.address + `/preview-resources/${ready.jobId}/resources/output/0/0.pf`); assert.equal(raw.status, 200); assert.equal(raw.headers.get('content-encoding'), null); assert.deepEqual(Buffer.from(await raw.arrayBuffer()), simulationResources()['resource-1'].data);
  const normalExport = await fetch(s.service.address + `/api/artifacts/${ready.jobId}/package`); assert.equal(normalExport.status, 200); assert.deepEqual(Buffer.from(await normalExport.arrayBuffer()), original);
  replace = true; const exported = await s.call(`/api/artifacts/${ready.jobId}/package`); assert.equal(exported.status, 409); assert.equal(exported.value.error.code, 'ARTIFACT_INVALID');
  assert.equal((await s.call(`/api/artifacts/${ready.jobId}/preview`)).status, 409);
  assert.equal((await s.call(`/preview-resources/${ready.jobId}/resources/output/0/0.pf`)).status, 409);
  assert.equal((await s.call('/api/provider-diagnostics')).value.cloudMutations, 0);
});

test('known provider/profile failures retain safe codes and never forward private messages', () => {
  for (const code of ['UNSUPPORTED_PROFILE', 'PROVIDER_RESPONSE_INVALID', 'ARTIFACT_INVALID', 'DOWNLOAD_INVALID', 'PACKAGE_LIMIT_EXCEEDED', 'COST_EXPIRED']) {
    const result = safeError(new CoreError(code, 'Bearer PRIVATE_SECRET at https://secret.example/?token=PRIVATE'));
    assert.equal(result.code, code); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|Bearer|https:/);
  }
  assert.equal(safeError(Object.assign(new Error('PRIVATE'), { code: 'UNSUPPORTED_PROFILE' })).code, 'PROVIDER_FAILURE');
  assert.equal(safeError(Object.assign(new Error('Bearer PRIVATE at https://secret.example'), { code: 'COST_EXPIRED' })).code, 'PROVIDER_FAILURE');
});

test('verified preview resources avoid job-history reads and restart priming is singleflight', async t => {
  const s = await setup(t, { mode: 'simulation', sdk: true }), id = await simulatedJob(s);
  for (const name of ['approve-cost', 'prepare', 'reconcile', 'download', 'package', 'preview']) {
    const result = await action(s, id, name); assert.equal(result.status, 'succeeded', JSON.stringify({ name, result }));
  }
  const records = path.join(s.configuration.dataDirectory, 'simulation', 'core', 'records', 'job', id);
  const files = Object.values(simulationResources());
  let historyOpens = 0;
  async function withHistoryGuard(refuse, fn) {
    const original = fs.open;
    fs.open = async function (file, ...args) {
      if (typeof file === 'string' && file.startsWith(records + path.sep)) {
        historyOpens++;
        if (refuse) throw new Error('Synthetic read barrier: history is unavailable during immutable resource serving.');
      }
      return original.call(fs, file, ...args);
    };
    syncBuiltinESMExports();
    try { return await fn(); } finally { fs.open = original; syncBuiltinESMExports(); }
  }
  async function exactResources() {
    await Promise.all(files.map(async resource => {
      const response = await fetch(s.service.address + `/preview-resources/${id}/resources/${resource.path}`);
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-encoding'), null);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), resource.data);
    }));
  }
  await withHistoryGuard(true, async () => {
    await exactResources(); assert.equal(historyOpens, 0);
    const range = await fetch(s.service.address + `/preview-resources/${id}/resources/output/0/0.pf`, { headers: { Range: 'bytes=0-1' } });
    assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), Buffer.from([0x1f, 0x8b]));
    assert.equal((await s.call(`/preview-resources/${id}/resources/output/0/unlisted.pf`)).status, 404);
    assert.equal((await s.call(`/preview-resources/${randomUUID()}/resources/output/0/0.pf`)).status, 409);
    assert.equal(historyOpens, 0, 'Verified raw resources and refusals must not reopen mutable job history');
  });
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), released = new Promise(resolve => { release = resolve; });
  const originalLstat = fs.lstat, originalZip = path.join(s.configuration.outputDirectory, 'simulation', `${id}.zip`);
  let pause = true;
  fs.lstat = async function (file, ...args) {
    if (pause && file === originalZip) { pause = false; enter(); await released; }
    return originalLstat.call(fs, file, ...args);
  };
  syncBuiltinESMExports();
  try {
    const raw = fetch(s.service.address + `/preview-resources/${id}/resources/output/0/0.pf`);
    await entered;
    const report = await s.call(`/api/artifacts/${id}/report`); assert.equal(report.status, 200); assert.equal(report.value.verification.status, 'PASS');
    release();
    const response = await raw; assert.equal(response.status, 200, 'Equivalent report verification must not invalidate an in-flight resource');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), simulationResources()['resource-1'].data);
  } finally { release(); fs.lstat = originalLstat; syncBuiltinESMExports(); }
  await s.restart(); historyOpens = 0;
  const revisions = (await fs.readdir(records)).filter(name => /^\d{16}\.json$/.test(name)).length;
  await withHistoryGuard(false, exactResources);
  assert.equal(historyOpens, revisions, 'Concurrent resources must share one fresh public job/ZIP verification after restart');
  historyOpens = 0;
  await withHistoryGuard(true, exactResources); assert.equal(historyOpens, 0);
});
