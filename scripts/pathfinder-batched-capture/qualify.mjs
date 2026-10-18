import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { load, ownership, ROOT, contained } from '../pathfinder-local/runtime-lib.mjs';
const { values } = parseArgs({ strict: true, options: { runtime: { type: 'string' }, owner: { type: 'string' }, 'compiled-server': { type: 'string' } } });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = { schemaVersion: 'pathfinder.batched-capture.served-artifacts.v1', status: 'FAIL', recordedAt: new Date().toISOString(), checks: [] };
try {
  const state = await load(values.runtime); assert.equal(state.owner, values.owner); assert.equal(state.port, 5191); assert.notEqual(state.project, 'wfc-pathfinder-local');
  const resources = await ownership(state), api = resources.containers.find(row => row.role === 'api'), web = resources.containers.find(row => row.role === 'web');
  assert.ok(api?.running && web?.running); assert.equal(api.image, state.images.api); assert.equal(web.image, state.images.web);
  receipt.target = { owner: state.owner, project: state.project, runtime: state.runtime, port: state.port, resources };
  for (const file of ['capture-input.mjs', 'protocol.mjs', 'adapter.mjs', 'bridge.mjs', 'model-capture.mjs']) {
    const local = await fs.readFile(path.join(ROOT, 'viewer-runtime', file));
    const response = await fetch(`http://127.0.0.1:5191/viewer-runtime/7.130.0/${file}`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    assert.ok(response.ok); const served = new Uint8Array(await response.arrayBuffer()); assert.ok(served.length < 1048576);
    receipt.checks.push({ name: 'served-runtime-' + file, status: hash(local) === hash(served) ? 'PASS' : 'FAIL', expectedSha256: hash(local), actualSha256: hash(served), bytes: served.length });
  }
  const compiled = path.resolve(values['compiled-server']); assert.ok(contained(path.join(ROOT, 'pathfinder-engine/.scratch'), compiled));
  const expected = Object.fromEntries(await Promise.all(['candidateEligibilityIntegration.js', 'repository.js'].map(async file => [file, hash(await fs.readFile(path.join(compiled, 'server/pathfinder', file)))])));
  const program = `import fs from 'node:fs/promises';import{createHash}from'node:crypto';const hash=b=>createHash('sha256').update(b).digest('hex'),files=${JSON.stringify(Object.keys(expected))},compiled={};for(const file of files)compiled[file]=hash(await fs.readFile('/app/server/dist/server/pathfinder/'+file));console.log(JSON.stringify({compiled,runnerSha256:hash(await fs.readFile(process.env.PF_ENGINE_DLL)),engineMode:process.env.PF_ENGINE_MODE??'default'}));`;
  const result = await promisify(execFile)('docker', ['exec', api.id, 'node', '--input-type=module', '-e', program], { windowsHide: true, timeout: 15000, maxBuffer: 65536 });
  assert.equal(result.stderr, ''); receipt.api = JSON.parse(result.stdout);
  receipt.checks.push({ name: 'exact-repository-driver-compiled-bytes', status: JSON.stringify(receipt.api.compiled) === JSON.stringify(expected) ? 'PASS' : 'FAIL', expected });
  const health = await fetch('http://127.0.0.1:5191/health', { redirect: 'error', signal: AbortSignal.timeout(5000) });
  receipt.checks.push({ name: 'loopback-health', status: health.ok && (await health.json()).status === 'ok' ? 'PASS' : 'FAIL' });
  await ownership(state); receipt.status = receipt.checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL';
} catch (error) { receipt.error = error instanceof assert.AssertionError ? 'ASSERTION_FAILURE' : 'SERVED_ARTIFACT_CHECK_FAILED'; }
receipt.finishedAt = new Date().toISOString(); const file = path.join(ROOT, 'docs/pathfinder/evidence/batched-capture/served-artifacts-' + Date.now() + '.json');
await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: receipt.status, file: path.relative(ROOT, file).replaceAll('\\', '/'), checks: receipt.checks.length, error: receipt.error })); process.exitCode = receipt.status === 'PASS' ? 0 : 1;
