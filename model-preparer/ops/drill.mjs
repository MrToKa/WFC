/** Explicit own-fixture acceptance. No source service is stopped or configured. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROOTS, canonical, fail, hashFile, noLinks, parseJson, secureDirectory, writeExclusive } from './common.mjs';
import { containerFacts, docker, imageFacts, readiness } from './docker.mjs';
import { backup, restore, start, stop, verify } from './preparer-ops.mjs';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const image = process.argv[2], outputRoot = process.argv[3], packageDirectory = process.argv[4];
if (!/^sha256:[a-f0-9]{64}$/.test(image ?? '') || !path.isAbsolute(outputRoot ?? '') || !path.isAbsolute(packageDirectory ?? '')) fail('INVALID_ARGUMENTS');
await noLinks(outputRoot, { directory: true }); await noLinks(packageDirectory, { directory: true });
const owner = randomUUID(), project = `preparer-ops-fixture-${owner.replaceAll('-', '').slice(0, 12)}`, name = `${project}-preparer`, instance = randomUUID();
const evidence = path.join(outputRoot, 'evidence'), privateRoot = path.join(outputRoot, 'private-backups'), drillRoot = path.join(outputRoot, 'drill');
for (const directory of [evidence, privateRoot, drillRoot]) { try { await fs.mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
await secureDirectory(privateRoot); await secureDirectory(drillRoot);
const privateAttempt = path.join(drillRoot, owner); await secureDirectory(privateAttempt, { create: true });
const proof = path.join(privateAttempt, 'proof'); await fs.mkdir(proof, { mode: 0o700 });
await writeExclusive(path.join(proof, 'expired-proof.json'), { schemaVersion: 1, kind: 'autodesk-account-operator-review', expiresAt: '2020-01-01T00:00:00.000Z', observations: { artifacts: [] }, fixture: true });
await writeExclusive(path.join(proof, 'unknown-proof.json'), '{"kind":"unknown","expired":true}\n');
const roots = Object.fromEntries(['data', 'work', 'outputs'].map(role => [role, { role, virtualRoot: ROOTS[role], type: 'volume', source: `${project}-${role}` }]));
roots.imports = { role: 'imports', virtualRoot: ROOTS.imports, type: 'bind', source: packageDirectory };
roots.proof = { role: 'proof', virtualRoot: ROOTS.proof, type: 'bind', source: proof };
const report = { schemaVersion: 1, owner, project, image, startedAt: new Date().toISOString(), status: 'RUNNING', originalServicesMutated: 0, cloudCalls: 0, events: [], resources: { container: name, volumes: ['data', 'work', 'outputs'].map(role => roots[role].source) } };
const timed = async (name, action) => { const at = Date.now(); const result = await action(); report.events.push({ name, status: 'PASS', ms: Date.now() - at, result }); return result; };
const helperArgs = (action, writable = true, namespaceRoots = roots) => ['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--label', `routings.preparer.ops.helper=${owner}`,
  '--mount', `type=bind,source=${path.join(sourceRoot, 'ops')},target=/ops,readonly`, '--mount', `type=bind,source=${path.join(sourceRoot, 'test')},target=/fixture,readonly`,
  ...Object.values(namespaceRoots).flatMap(root => ['--mount', `type=${root.type},source=${root.source},target=${root.virtualRoot}${root.type === 'bind' || !writable ? ',readonly' : ''}`]), '--entrypoint', 'node', image, '/fixture/ops-fixture.mjs', action];
async function api(containerId, action, jobId) {
  const code = `import{createHash,randomUUID}from'node:crypto';const base='http://127.0.0.1:8080';const read=async p=>{const r=await fetch(base+p);if(!r.ok)throw Error('HTTP_'+r.status);return r.json()};const jobId=${JSON.stringify(jobId ?? null)},action=${JSON.stringify(action)};let output;if(action==='register'){const config=await read('/api/config'),inputs=await read('/api/imports'),input=inputs.inputs.find(i=>i.name==='aalborg-svf-stage3.zip');if(!input)throw Error('MISSING_PACKAGE');const r=await fetch(base+'/api/jobs/register-known',{method:'POST',headers:{origin:'http://127.0.0.1:18093','content-type':'application/json','x-preparer-token':config.csrfToken,'x-request-id':randomUUID()},body:JSON.stringify({inputId:input.inputId})});if(r.status!==202)throw Error('REGISTER_'+r.status);let op=(await r.json()).operation;const deadline=Date.now()+600000;while(['queued','running'].includes(op.status)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,100));op=(await read('/api/operations/'+op.operationId)).operation}if(op.status!=='succeeded')throw Error('REGISTER_'+op.status);output={jobId:op.jobId??op.result?.jobId,operationId:op.operationId,status:op.status};}else if(action==='report'){output=await read('/api/artifacts/'+jobId+'/report');}else if(action==='package'){const r=await fetch(base+'/api/artifacts/'+jobId+'/package');if(!r.ok)throw Error('PACKAGE_'+r.status);const hash=createHash('sha256');let bytes=0;for await(const c of r.body){bytes+=c.length;hash.update(c)}output={bytes,sha256:hash.digest('hex')};}else if(action==='jobs')output=await read('/api/jobs');else if(action==='diagnostics')output=await read('/api/provider-diagnostics');process.stdout.write(JSON.stringify(output));`;
  return parseJson(Buffer.from(await docker(['exec', containerId, 'node', '--input-type=module', '--eval', code], { timeoutMs: 900_000 })));
}
async function createFixture() {
  for (const role of ['data', 'work', 'outputs']) await docker(['volume', 'create', '--label', `com.docker.compose.project=${project}`, '--label', `routings.preparer.ops.owner=${owner}`, roots[role].source]);
  const seeded = parseJson(Buffer.from(await docker(helperArgs('seed'))));
  const args = ['run', '--detach', '--pull', 'never', '--name', name, '--hostname', 'routings-preparer', '--init', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--restart', 'no', '--network', 'none', '--tmpfs', '/tmp:size=256m,mode=1777',
    '--label', `com.docker.compose.project=${project}`, '--label', 'com.docker.compose.service=preparer', '--label', `routings.preparer.ops.owner=${owner}`, '--label', 'routings.preparer.mode=live', '--label', `routings.preparer.instance=${instance}`,
    ...Object.values(roots).flatMap(root => ['--mount', `type=${root.type},source=${root.source},target=${root.virtualRoot}${root.type === 'bind' ? ',readonly' : ''}`])];
  const env = { PREPARER_MODE: 'live', PREPARER_HOST: '0.0.0.0', PREPARER_PORT: '8080', PREPARER_PUBLIC_ORIGIN: 'http://127.0.0.1:18093', PREPARER_INSTANCE_ID: instance, PREPARER_DATA_DIR: ROOTS.data, PREPARER_WORK_DIR: ROOTS.work, PREPARER_OUTPUT_DIR: ROOTS.outputs, PREPARER_PACKAGE_MODULE: '/opt/package/index.mjs', PREPARER_SDK_DIR: '/opt/preview/sdk', PREPARER_IMPORT_ROOT: ROOTS.imports, PREPARER_LIVE_REUSE_ONLY: 'true' };
  for (const [key, value] of Object.entries(env)) args.push('--env', `${key}=${value}`);
  args.push(image); const containerId = (await docker(args)).trim(); await readiness(containerId, 'live', { requireClosed: true }); return { seeded, containerId };
}
try {
  report.imageFacts = await imageFacts(image);
  const input = await timed('pin-real-original-package', async () => hashFile(path.join(packageDirectory, 'aalborg-svf-stage3.zip')));
  assert.deepEqual(input, { bytes: 439112829, sha256: '8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5' });
  const fixture = await timed('create-offline-own-fixture', createFixture); report.sourceContainerId = fixture.containerId;
  const registered = await timed('register-ready-real-package-through-service', () => api(fixture.containerId, 'register')); report.realJobId = registered.jobId;
  const before = await timed('source-full-public-verification-report', () => api(fixture.containerId, 'report', registered.jobId));
  assert.equal(before.verification.resourceCount, 342); assert.equal(before.cloudActivity.cloudMutations, 0); assert.equal(before.cloudActivity.requestCount, 0);
  const bytes = await timed('source-actual-package-export-hash', () => api(fixture.containerId, 'package', registered.jobId)); assert.deepEqual(bytes, input);
  const sourceFacts = await containerFacts(fixture.containerId); report.sourceBeforeBackup = { id: sourceFacts.id, startedAt: sourceFacts.startedAt, mode: sourceFacts.mode };
  const captured = await timed('clean-stop-coherent-backup-and-source-restart', () => backup({ container: fixture.containerId, destinationRoot: privateRoot, stop: true })); report.backup = { bundle: captured.bundle, backupId: captured.backupId, manifestSha256: captured.manifestSha256, uniqueBytes: captured.uniqueBytes, objectCount: captured.objectCount, diskPrerequisite: captured.diskPrerequisite, serviceRestored: captured.serviceRestored };
  assert.equal(captured.serviceRestored, true);
  const complete = await timed('verify-independent-backup-delivery', () => verify(captured.bundle)); assert.equal(complete.status, 'PASS');
  // The delivered operator is also executed directly on this host without any
  // original-checkout imports; verify does not require Docker or network.
  const { run } = await import('./common.mjs');
  const delivered = await timed('portable-operator-without-original-checkout', () => run(process.execPath, [path.join(captured.bundle, 'operator/preparer-ops.mjs'), 'verify', '--backup', captured.bundle]));
  assert.equal(parseJson(Buffer.from(delivered)).status, 'PASS');
  const targetRoot = path.join(privateAttempt, 'restored');
  const restored = await timed('fresh-quarantine-restore', () => restore({ bundle: captured.bundle, targetRoot, port: 18093 })); report.restore = restored;
  const started = await timed('start-restored-network-none-no-credentials', () => start(targetRoot)); report.restoredContainerId = started.containerId;
  const after = await timed('restored-full-public-verification-report', () => api(started.containerId, 'report', registered.jobId));
  assert.deepEqual(after.verification, { ...before.verification, verifiedAt: after.verification.verifiedAt });
  for (const field of ['jobId', 'label', 'provenance', 'package', 'kind']) if (Object.hasOwn(before.job, field)) assert.deepEqual(after.job[field], before.job[field]);
  assert.equal(after.providerMode, 'closed'); assert.equal(after.mode, 'live'); assert.equal(after.cloudActivity.startupCloudCalls, 0); assert.equal(after.cloudActivity.requestCount, 0); assert.equal(after.cloudActivity.cloudMutations, 0);
  const restoredBytes = await timed('restored-actual-package-export-hash', () => api(started.containerId, 'package', registered.jobId)); assert.deepEqual(restoredBytes, input);
  await timed('restored-clean-stop', () => stop(targetRoot));
  const restarted = await timed('restored-restart-persistence', () => start(targetRoot));
  assert.equal(restarted.containerId.slice(0, 12), started.containerId.slice(0, 12));
  const jobs = await api(restarted.containerId, 'jobs'); assert.equal(jobs.jobs.length, 1); assert.equal(jobs.jobs[0].jobId, registered.jobId);
  await timed('restored-final-clean-stop', () => stop(targetRoot));
  const target = parseJson(await fs.readFile(path.join(targetRoot, 'target.json')));
  const historical = parseJson(Buffer.from(await docker(helperArgs('retry-unknown', true, target.roots))));
  assert.equal(historical.denied, 'SUBMISSION_UNKNOWN'); assert.equal(historical.fakeSubmitCalls, 0); assert.equal(historical.attempts, 1); assert.equal(historical.jobId, fixture.seeded.history.jobId);
  report.events.push({ name: 'restored-authoritative-unknown-history-no-repeat-submit', status: 'PASS', result: historical });
  await docker(['stop', '--time', '45', fixture.containerId]);
  report.sourceAfter = await containerFacts(fixture.containerId); report.target = targetRoot;
  report.actualPackage = { ...input, resourceCount: 342, rawResourceBytes: 439007803, packageId: after.verification.packageId, contentFingerprint: after.verification.contentFingerprint, jobId: registered.jobId };
  report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.failure = { code: /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'DRILL_ASSERTION_FAILED', ...(error.name === 'AssertionError' ? { message: error.message } : {}) }; if (error.stderr) report.failure.safeChildCode = /"code":"([A-Z_]+)"/.exec(error.stderr)?.[1] ?? 'CHILD_COMMAND_FAILED'; process.exitCode = 1; }
finally {
  report.completedAt = new Date().toISOString(); report.durationMs = Date.parse(report.completedAt) - Date.parse(report.startedAt);
  const filename = path.join(evidence, `preparer-offline-drill-${owner}.json`); await writeExclusive(filename, report); process.stdout.write(`${canonical({ status: report.status, report: filename, owner, project, events: report.events.length, failure: report.failure ?? null })}\n`);
}
