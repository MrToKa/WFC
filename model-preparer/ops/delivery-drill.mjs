/** Final portable-operator drill against an existing OWN offline fixture. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest, fail, hashFile, parseJson, run, secureDirectory, writeExclusive } from './common.mjs';
import { backup } from './preparer-ops.mjs';
import { containerFacts, docker, readiness } from './docker.mjs';

const [container, output] = process.argv.slice(2);
if (!container || !path.isAbsolute(output ?? '')) fail('INVALID_ARGUMENTS');
const source = await containerFacts(container);
if (!/^preparer-ops-fixture-[a-f0-9]{12}$/.test(source.project) || !source.owner || !source.running) fail('OWN_RUNNING_FIXTURE_REQUIRED');
const attempt = randomUUID(), privateParent = path.join(output, 'private-backups'), scratch = path.join(output, 'drill', attempt); await secureDirectory(scratch, { create: true });
const report = { schemaVersion: 1, attempt, startedAt: new Date().toISOString(), sourceContainerId: source.id, sourceProject: source.project, sourceOwner: source.owner, imageId: source.imageId, status: 'RUNNING', events: [], originalServicesMutated: 0, cloudCalls: 0 };
const timed = async (name, action) => { const at = Date.now(), result = await action(); report.events.push({ name, ms: Date.now() - at, status: 'PASS', result }); return result; };
async function api(id, action, jobId, port = 18093) {
  const code = `import{createHash,randomUUID}from'node:crypto';const base='http://127.0.0.1:8080';const read=async p=>{const r=await fetch(base+p);if(!r.ok)throw Error('HTTP_'+r.status);return r.json()};const action=${JSON.stringify(action)},jobId=${JSON.stringify(jobId ?? null)},origin=${JSON.stringify(`http://127.0.0.1:${port}`)};let output;if(action==='jobs')output=await read('/api/jobs');else if(action==='report')output=await read('/api/artifacts/'+jobId+'/report');else if(action==='package'){const r=await fetch(base+'/api/artifacts/'+jobId+'/package');if(!r.ok)throw Error('HTTP_'+r.status);let bytes=0;const h=createHash('sha256');for await(const c of r.body){bytes+=c.length;h.update(c)}output={bytes,sha256:h.digest('hex')}}else if(action==='register'){const c=await read('/api/config'),inputs=await read('/api/imports'),input=inputs.inputs.find(x=>x.name==='aalborg-svf-stage3.zip');if(!input)throw Error('MISSING_INPUT');const r=await fetch(base+'/api/jobs/register-known',{method:'POST',headers:{origin,'content-type':'application/json','x-preparer-token':c.csrfToken,'x-request-id':randomUUID()},body:JSON.stringify({inputId:input.inputId})});if(r.status!==202)throw Error('REGISTER_'+r.status);let op=(await r.json()).operation;const deadline=Date.now()+600000;while(['queued','running'].includes(op.status)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,100));op=(await read('/api/operations/'+op.operationId)).operation}if(op.status!=='succeeded')throw Error('REGISTER_'+op.status);output={jobId:op.jobId??op.result?.jobId,status:op.status}}process.stdout.write(JSON.stringify(output));`;
  return parseJson(Buffer.from(await docker(['exec', id, 'node', '--input-type=module', '--eval', code], { timeoutMs: 900_000 })));
}
let target, marker;
try {
  const jobs = await api(source.id, 'jobs'), candidates = jobs.jobs.filter(value => value.kind === 'registered' && value.facts.package?.sha256 === '8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5');
  assert.equal(candidates.length, 1); const jobId = candidates[0].jobId; report.realJobId = jobId;
  const before = await timed('source-report-and-actual-public-profile', () => api(source.id, 'report', jobId)); assert.equal(before.verification.resourceCount, 342);
  const prior = new Set(await fs.readdir(privateParent)); let injected = false, expected;
  try { await backup({ container: source.id, destinationRoot: privateParent, stop: true, dockerCommand: async args => { const result = await docker(args); if (args[0] === 'stop' && !injected) { injected = true; fail('INJECTED_POST_STOP_TRANSPORT_ERROR'); } return result; } }); }
  catch (error) { expected = error.code; }
  assert.equal(expected, 'INJECTED_POST_STOP_TRANSPORT_ERROR');
  const failed = (await fs.readdir(privateParent)).filter(value => !prior.has(value)); assert.equal(failed.length, 1);
  const failedBundle = path.join(privateParent, failed[0]), failedReceipt = parseJson(await fs.readFile(path.join(failedBundle, 'operation.json')));
  assert.equal(failedReceipt.status, 'incomplete'); assert.equal(failedReceipt.serviceRestored, true); assert.equal((await fs.readdir(failedBundle)).includes('complete.json'), false);
  await readiness(source.id, source.mode, { requireClosed: true }); report.events.push({ name: 'real-stop-then-transport-error-finally-restarts-same-source', status: 'PASS', result: { injected, expected, failedBundle, serviceRestored: true, completeMarkerAbsent: true } });
  const saved = await timed('final-coherent-backup-and-source-state-restoration', () => backup({ container: source.id, destinationRoot: privateParent, stop: true }));
  report.backup = { bundle: saved.bundle, backupId: saved.backupId, manifestSha256: saved.manifestSha256, objectCount: saved.objectCount, uniqueBytes: saved.uniqueBytes, diskPrerequisite: saved.diskPrerequisite, captured: saved.captured, serviceRestored: saved.serviceRestored };
  const operator = path.join(saved.bundle, 'operator', 'preparer-ops.mjs');
  // Every subsequent operation is a new host process using only the delivered
  // backup modules and fixed image runtime; cwd contains no checkout/package.
  const delivered = async args => parseJson(Buffer.from(await run(process.execPath, [operator, ...args], { cwd: scratch })));
  const verified = await timed('delivered-operator-verify-outside-checkout', () => delivered(['verify', '--backup', saved.bundle])); assert.equal(verified.status, 'PASS');
  target = path.join(scratch, 'restored');
  const restored = await timed('delivered-operator-fresh-quarantine-restore', () => delivered(['restore', '--backup', saved.bundle, '--target-root', target, '--port', '18094'])); assert.equal(restored.status, 'verified-quarantine');
  marker = parseJson(await fs.readFile(path.join(target, 'target.json'))); report.target = { targetRoot: target, owner: marker.owner, project: marker.project, volumes: Object.values(marker.roots).filter(value => value.type === 'volume').map(value => value.source), containerName: marker.containerName };
  const started = await timed('delivered-operator-start-closed-original-live-namespace', () => delivered(['start', '--target', target])); assert.equal(started.readiness.mode, 'closed'); assert.equal(started.readiness.startupCloudCalls, 0); report.target.containerId = started.containerId;
  const after = await timed('restored-same-job-provenance-full-public-verification', () => api(started.containerId, 'report', jobId, 18094));
  assert.deepEqual(after.job.facts, before.job.facts); assert.equal(after.job.jobId, before.job.jobId); assert.equal(after.job.createdAt, before.job.createdAt); assert.equal(after.job.label, before.job.label);
  assert.deepEqual(after.verification, { ...before.verification, verifiedAt: after.verification.verifiedAt });
  assert.equal(after.providerMode, 'closed'); assert.equal(after.mode, 'live'); assert.equal(after.cloudActivity.requestCount, 0); assert.equal(after.cloudActivity.cloudMutations, 0); assert.equal(after.cloudActivity.startupCloudCalls, 0);
  const packageBytes = await timed('restored-actual-export-every-byte-sha256', () => api(started.containerId, 'package', jobId, 18094)); assert.deepEqual(packageBytes, { bytes: 439112829, sha256: '8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5' });
  const idempotent = await timed('running-exact-binding-idempotent-start', () => delivered(['start', '--target', target])); assert.equal(idempotent.reused, true);
  const local = await timed('legitimate-closed-local-registration-after-restore', () => api(started.containerId, 'register', null, 18094)); assert.notEqual(local.jobId, jobId);
  await timed('delivered-clean-stop', () => delivered(['stop', '--target', target]));
  const restarted = await timed('delivered-restart-valid-new-job-and-original-lineage', () => delivered(['start', '--target', target])); assert.equal(restarted.readiness.mode, 'closed');
  const persisted = await api(restarted.containerId, 'jobs'); assert.deepEqual(persisted.jobs.map(value => value.jobId).sort(), [jobId, local.jobId].sort());
  await timed('delivered-final-stop', () => delivered(['stop', '--target', target]));
  report.status = 'PASS'; report.package = { ...packageBytes, packageId: after.verification.packageId, contentFingerprint: after.verification.contentFingerprint, resourceCount: after.verification.resourceCount }; report.sameProvenance = true; report.actualCapabilitiesClosed = true; report.startupCloudCalls = 0; report.newLocalJobId = local.jobId;
} catch (error) { report.status = 'FAIL'; report.failure = { code: /^[A-Z_]+$/.test(error.code ?? '') ? error.code : 'DRILL_ASSERTION_FAILED', ...(error.name === 'AssertionError' ? { assertion: error.message } : {}), ...(error.stderr ? { childCode: /"code":"([A-Z_]+)"/.exec(error.stderr)?.[1] ?? 'CHILD_COMMAND_FAILED' } : {}) }; process.exitCode = 1; }
finally {
  report.completedAt = new Date().toISOString(); report.durationMs = Date.parse(report.completedAt) - Date.parse(report.startedAt);
  const filename = path.join(output, 'evidence', `preparer-delivery-drill-${attempt}.json`); await writeExclusive(filename, report); process.stdout.write(`${canonical({ status: report.status, report: filename, events: report.events.length, failure: report.failure ?? null })}\n`);
}
