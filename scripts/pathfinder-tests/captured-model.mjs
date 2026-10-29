// Validate a real UI-captured snapshot with a separate host-side owned cache.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const projectId = '105913f0-7ee4-45f2-bfd8-2c01f9be9f2a';
const routeText = '/DFB018-1/DFB011/DFB012/DFB013/B002/B107-1/B107-2/B107-3/BC025/BC022-2';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const execute = (exe, args, options = {}) => {
  const result = spawnSync(exe, args, { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 125000, maxBuffer: 34 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, result.stderr || result.error?.message); return result.stdout;
};
const runtime = JSON.parse(await fs.readFile(path.join(root, 'pathfinder-engine/.scratch/pathfinder-local/runtime-state.json'), 'utf8'));
assert.equal(runtime.project, 'wfc-pathfinder-local'); assert.equal(Number(runtime.port), 5190);
const credentials = JSON.parse(await fs.readFile(path.join(root, 'pathfinder-engine/.scratch/pathfinder-local/demo.private.json'), 'utf8'));
const login = await fetch('http://127.0.0.1:5190/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
assert.equal(login.status, 200); const token = (await login.json()).token;
const response = await fetch(`http://127.0.0.1:5190/api/projects/${projectId}/pathfinder/state`, { headers: { authorization: 'Bearer ' + token } });
assert.equal(response.status, 200); const state = await response.json(), artifact = state.artifacts[0];
assert.ok(artifact && /^[a-f0-9-]{36}$/.test(artifact.id)); assert.equal(artifact.engineeringAccepted, false);
const owned = JSON.parse(execute('docker', ['inspect', 'wfc-pathfinder-local-api-1']))[0];
assert.equal(owned.Config.Labels['wfc.pathfinder.isolated'], 'true'); assert.equal(owned.Config.Labels['wfc.pathfinder.owner'], runtime.owner);
const scratch = path.join(root, 'pathfinder-engine/.scratch/captured-model-' + crypto.randomUUID());
await fs.mkdir(path.join(scratch, 'snapshots'), { recursive: true });
const input = path.join(scratch, 'snapshots', artifact.id + '.json');
execute('docker', ['cp', `${owned.Id}:/var/lib/wfc/pathfinder/snapshots/${artifact.id}.json`, input]);
const bytes = await fs.readFile(input); assert.equal(hash(bytes), artifact.snapshotSha256);
const dll = path.join(root, 'pathfinder-engine/tools/PathFinder.ModelRunner/bin/Release/net9.0/PathFinder.ModelRunner.dll');
const env = { ...process.env, PF_ROOT: scratch, DOTNET_CLI_HOME: path.join(root, 'pathfinder-engine/.dotnet-home'), DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false' };
const request = operation => ({ schemaVersion: 'pathfinder.model.runner.v1', requestId: crypto.randomUUID(), operation, projectId, modelVersionId: state.activeModel.modelVersionId,
  snapshotId: artifact.id, snapshotSha256: artifact.snapshotSha256, timeoutMilliseconds: 120000 });
const invoke = value => JSON.parse(execute('dotnet', [dll], { input: JSON.stringify(value), env }));
const prepared = invoke(request('prepare')); assert.equal(prepared.status, 'prepared'); assert.equal(prepared.engineeringAccepted, false);
const options = { connectionToleranceMeters: 1, sampleSpacingMeters: .125, secondaryDistanceMeters: 2, preferVerticalApproach: false, maxGraphNodes: 200000, maxGraphConnections: 1000000 };
const forward = invoke({ ...request('lookup'), routeText, options }), reverse = invoke({ ...request('lookup'), routeText, options, reverse: true });
assert.equal(forward.status, 'calculated'); assert.equal(reverse.status, 'calculated');
assert.equal(reverse.route.lengthMeters, forward.route.lengthMeters); assert.deepEqual(reverse.route.pathPoints, forward.route.pathPoints.toReversed());
assert.equal(forward.design, null); assert.equal(forward.route.fromDistanceMeters, 0); assert.equal(forward.route.toDistanceMeters, 0);
const result = { schemaVersion: 'pathfinder.actual-ui-capture.interop.v1', observedAtUtc: new Date().toISOString(), status: 'PASS',
  scope: 'actual-selected-converted-ui-capture-hash-strict-reader-fitter-and-ordered-lookup;not-native-parity', projectId, modelVersionId: state.activeModel.modelVersionId,
  artifactId: artifact.id, snapshotSha256: artifact.snapshotSha256, snapshotBytes: bytes.length, objectCount: artifact.objectCount, prepared: prepared.prepared,
  diagnosticOptions: options, routeText, forward, reverseExact: true, sourceSha256: hash(await fs.readFile(fileURLToPath(import.meta.url))), runnerDllSha256: hash(await fs.readFile(dll)),
  originalRuntimeAccessed: false, originalFilesChanged: false, secretsRecorded: false, isolatedCache: scratch, nativeParity: 'BLOCKED; independent native reference unavailable' };
const output = path.join(root, 'docs/pathfinder/evidence/pf7', `actual-capture-${Date.now()}.json`);
await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, status: 'PASS', objects: artifact.objectCount, segments: prepared.prepared.segmentCount, lengthMeters: forward.route.lengthMeters, readiness: prepared.prepared.readiness }));
