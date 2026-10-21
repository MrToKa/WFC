/** Separate deliberate process-crash fixture; no cloud or working service. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ROOTS, canonical, fail, parseJson, secureDirectory, writeExclusive } from './common.mjs';
import { containerFacts, docker, helper } from './docker.mjs';
import { backup } from './preparer-ops.mjs';

const image = process.argv[2], output = process.argv[3];
if (!/^sha256:[a-f0-9]{64}$/.test(image ?? '') || !path.isAbsolute(output ?? '')) fail('INVALID_ARGUMENTS');
const owner = randomUUID(), project = `preparer-ops-fixture-${owner.replaceAll('-', '').slice(0, 12)}`, name = `${project}-preparer`, root = fileURLToPath(new URL('..', import.meta.url));
const privateRoot = path.join(output, 'private-backups'), scratch = path.join(output, 'drill', owner); await secureDirectory(scratch, { create: true });
const roots = Object.fromEntries(['data', 'work', 'outputs'].map(role => [role, { role, virtualRoot: ROOTS[role], type: 'volume', source: `${project}-${role}` }]));
const report = { schemaVersion: 1, owner, project, image, startedAt: new Date().toISOString(), status: 'RUNNING', originalServicesMutated: 0, cloudCalls: 0, resources: { container: name, volumes: Object.values(roots).map(value => value.source) } };
try {
  for (const role of ['data', 'work', 'outputs']) await docker(['volume', 'create', '--label', `com.docker.compose.project=${project}`, '--label', `routings.preparer.ops.owner=${owner}`, roots[role].source]);
  const args = ['run', '--pull', 'never', '--name', name, '--hostname', 'routings-preparer', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--user', '1000:1000', '--label', `com.docker.compose.project=${project}`, '--label', 'com.docker.compose.service=preparer', '--label', `routings.preparer.ops.owner=${owner}`, '--label', 'routings.preparer.mode=simulation', '--label', `routings.preparer.instance=${randomUUID()}`,
    '--mount', `type=bind,source=${path.join(root, 'ops')},target=/ops,readonly`, '--mount', `type=bind,source=${path.join(root, 'test')},target=/fixture,readonly`,
    ...Object.values(roots).flatMap(value => ['--mount', `type=volume,source=${value.source},target=${value.virtualRoot}`]), '--entrypoint', 'node', image, '/fixture/ops-fixture.mjs', 'crash'];
  // The two fixture-program binds are not application inputs; remove them from
  // subsequent inspection's recognized source by using a dedicated stopped app
  // shell with the exact same volumes below. The crashed process is retained.
  let crashed; try { await docker(args); fail('FIXTURE_EXPECTED_CRASH'); } catch (error) { if (error.code !== 'COMMAND_FAILED') throw error; crashed = true; }
  assert.equal(crashed, true); const exit = Number((await docker(['inspect', name, '--format', '{{.State.ExitCode}}'])).trim()); assert.equal(exit, 73);
  const inventoryCode = `import fs from'node:fs/promises';import path from'node:path';import{createHash}from'node:crypto';const out=[];async function walk(p){for(const n of(await fs.readdir(p)).sort()){const f=path.join(p,n),s=await fs.lstat(f);if(s.isDirectory())await walk(f);else{const b=await fs.readFile(f);out.push({path:f.slice('/var/lib/preparer/data/'.length),bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')})}}}await walk('/var/lib/preparer/data');process.stdout.write(JSON.stringify(out));`;
  const inspect = async () => parseJson(Buffer.from(await docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--label', `routings.preparer.ops.helper=${owner}`,
    ...Object.values(roots).flatMap(value => ['--mount', `type=volume,source=${value.source},target=${value.virtualRoot},readonly`]), '--entrypoint', 'node', image, '--input-type=module', '--eval', inventoryCode])));
  const before = await inspect(); assert.ok(before.some(value => value.path.includes('/locks/')));
  let refusal;
  try { await helper({ image, operatorRoot: path.join(root, 'ops'), bundle: scratch, roots, action: 'plan', label: owner }); fail('FIXTURE_EXPECTED_REFUSAL'); }
  catch (error) { if (error.code !== 'COMMAND_FAILED') throw error; refusal = /"code":"([A-Z_]+)"/.exec(error.stderr ?? '')?.[1]; }
  assert.equal(refusal, 'UNSAFE_LOCK_HISTORY');
  // A stopped source with extra unknown mounts is refused before any capture or
  // restart. This is deliberate: the crash helper is not a supported app source.
  let sourceRefusal; try { await backup({ container: name, destinationRoot: privateRoot }); fail('FIXTURE_EXPECTED_REFUSAL'); } catch (error) { sourceRefusal = error.code; }
  assert.equal(sourceRefusal, 'UNKNOWN_MOUNT');
  const shellName = `${project}-stopped-source`;
  await docker(['run', '--pull', 'never', '--name', shellName, '--hostname', 'routings-preparer', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--label', `com.docker.compose.project=${project}`, '--label', 'com.docker.compose.service=preparer', '--label', `routings.preparer.ops.owner=${owner}`, '--label', 'routings.preparer.mode=simulation', '--label', `routings.preparer.instance=${randomUUID()}`,
    ...Object.values(roots).flatMap(value => ['--mount', `type=volume,source=${value.source},target=${value.virtualRoot}`]), '--entrypoint', 'node', image, '--eval', 'process.exit(0)']);
  const shellBefore = await containerFacts(shellName), prior = new Set(await fs.readdir(privateRoot)); let incompleteRefusal;
  try { await backup({ container: shellName, destinationRoot: privateRoot }); fail('FIXTURE_EXPECTED_REFUSAL'); }
  catch (error) { if (error.code !== 'COMMAND_FAILED') throw error; incompleteRefusal = /"code":"([A-Z_]+)"/.exec(error.stderr ?? '')?.[1]; }
  assert.equal(incompleteRefusal, 'UNSAFE_LOCK_HISTORY');
  const newDirectories = (await fs.readdir(privateRoot)).filter(value => !prior.has(value)); assert.equal(newDirectories.length, 1);
  const incompletePath = path.join(privateRoot, newDirectories[0]);
  assert.equal((await fs.readdir(incompletePath)).includes('complete.json'), false);
  assert.equal(JSON.parse(await fs.readFile(path.join(incompletePath, 'operation.json'))).status, 'incomplete');
  const shellAfter = await containerFacts(shellName); assert.equal(shellAfter.running, false); assert.equal(shellAfter.startedAt, shellBefore.startedAt);
  const after = await inspect(); assert.deepEqual(after, before);
  const state = (await docker(['inspect', name, '--format', '{{.State.Running}}|{{.State.ExitCode}}'])).trim(); assert.equal(state, 'false|73');
  report.status = 'PASS'; report.resources.additionalContainers = [shellName]; report.crashedExitCode = exit; report.lockAuditRefusal = refusal; report.foreignMountBackupRefusal = sourceRefusal; report.incompleteCapture = { path: incompletePath, refusal: incompleteRefusal, completeMarkerAbsent: true, originallyStoppedSourcePreserved: true }; report.stateFiles = before.length; report.stateInventorySha256 = (await import('./common.mjs')).digest(before); report.stateUnchanged = true; report.locksRetained = before.filter(value => value.path.includes('/locks/')).length;
} catch (error) { report.status = 'FAIL'; report.failure = { code: error.code ?? 'DRILL_ASSERTION_FAILED', ...(error.name === 'AssertionError' ? { assertion: error.message } : {}), ...(error.stderr ? { safeChildCode: /"code":"([A-Z_]+)"/.exec(error.stderr)?.[1] ?? 'CHILD_COMMAND_FAILED' } : {}) }; process.exitCode = 1; }
finally { report.completedAt = new Date().toISOString(); const filename = path.join(output, 'evidence', `preparer-crash-drill-${owner}.json`); await writeExclusive(filename, report); process.stdout.write(`${canonical({ status: report.status, report: filename, project, failure: report.failure ?? null })}\n`); }
