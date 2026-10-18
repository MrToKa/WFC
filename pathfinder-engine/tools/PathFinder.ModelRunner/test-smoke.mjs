import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const scratch = path.join(root, 'pathfinder-engine/.scratch/modelrunner-' + crypto.randomUUID());
fs.mkdirSync(path.join(scratch, 'snapshots'), { recursive: true });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const source = fs.readFileSync(path.join(root, 'pathfinder-engine/tests/PathFinder.Model.Tests/Program.cs'), 'utf8');
const snapshot = JSON.parse(source.match(/private static JsonObject Fixture\(\) => JsonNode\.Parse\("""\s*([\s\S]*?)\s*"""\)/)[1]);
const projectId = crypto.randomUUID(), modelVersionId = crypto.randomUUID(), snapshotId = crypto.randomUUID();
snapshot.model.projectId = projectId; snapshot.model.modelVersionId = modelVersionId;
const snapshotBytes = Buffer.from(JSON.stringify(snapshot));
const snapshotPath = path.join(scratch, 'snapshots', snapshotId + '.json');
fs.writeFileSync(snapshotPath, snapshotBytes);
const dll = path.join(root, 'pathfinder-engine/tools/PathFinder.ModelRunner/bin/Release/net9.0/PathFinder.ModelRunner.dll');
const env = { ...process.env, PF_ROOT: scratch, DOTNET_CLI_HOME: path.join(root, 'pathfinder-engine/.dotnet-home'),
  DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false' };
const settings = { revision: 'synthetic-settings-1', secondaryTrayLength: '5', endConnectionLength: '6', additionalBendingPercent: '10' };
const base = () => ({ schemaVersion: 'pathfinder.model.runner.v1', requestId: crypto.randomUUID(), operation: 'calculate', projectId, modelVersionId, snapshotId,
  snapshotSha256: hash(snapshotBytes), timeoutMilliseconds: 30000, category: 'Instrumentation', from: { x: 0, y: 0, z: .5 }, to: { x: 10, y: 0, z: .5 },
  projectSettings: settings, options: { connectionToleranceMeters: .25, sampleSpacingMeters: .125, secondaryDistanceMeters: 2, preferVerticalApproach: false, maxGraphNodes: 10000, maxGraphConnections: 30000 } });
const checks = [];
function run(request, alteredEnv) {
  const result = spawnSync('dotnet', [dll], { cwd: root, env: alteredEnv ?? env, windowsHide: true, input: typeof request === 'string' ? request : JSON.stringify(request),
    encoding: 'utf8', timeout: 130000, maxBuffer: 34 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const response = JSON.parse(result.stdout); assert.equal(response.schemaVersion, 'pathfinder.model.response.v1');
  assert.equal(response.engineeringAccepted, false); return response;
}
function test(name, action) {
  try { const details = action(); checks.push({ name, status: 'PASS', details }); }
  catch (error) { checks.push({ name, status: 'FAIL', message: error.message }); }
}
test('strict-prepare-and-private-fit-cache', () => { const r = run({ ...base(), operation: 'prepare' }); assert.equal(r.status, 'prepared'); assert.equal(r.prepared.segmentCount, 1); return r.prepared; });
test('real-core-calculation-instrumentation-maps-to-control', () => {
  const r = run(base()); assert.equal(r.status, 'calculated'); assert.equal(r.effectiveCategory, 'Control'); assert.equal(r.route.lengthMeters, 10);
  assert.equal(r.design.designLengthMeters, '18'); return { length: r.route.lengthMeters, design: r.design, engineeringAccepted: r.engineeringAccepted };
});
test('null-secondary-does-not-become-zero-when-flagged', () => {
  const r = run({ ...base(), from: { x: 0, y: 4, z: .5 }, projectSettings: { ...settings, secondaryTrayLength: null } });
  assert.equal(r.status, 'settings_required'); assert.equal(r.route.fromRequiresSecondary, true);
});
test('unknown-category-requires-resolution', () => assert.equal(run({ ...base(), category: 'Power' }).status, 'category_required'));
test('nonfinite-coordinate-rejected', () => assert.equal(run(JSON.stringify(base()).replace('"x":0', '"x":1e999')).status, 'invalid_request'));
test('cross-project-snapshot-rejected', () => assert.equal(run({ ...base(), projectId: crypto.randomUUID() }).status, 'invalid_request'));
test('snapshot-byte-integrity-rejected', () => assert.equal(run({ ...base(), snapshotSha256: '0'.repeat(64) }).status, 'invalid_request'));
test('path-injection-identity-rejected', () => assert.equal(run({ ...base(), snapshotId: '../snapshot' }).status, 'invalid_request'));
test('unexpected-proof-property-rejected', () => assert.equal(run({ ...base(), engineeringAccepted: true }).status, 'invalid_request'));
test('duplicate-json-member-rejected', () => assert.equal(run(JSON.stringify(base()).replace('{', '{"operation":"prepare",')).status, 'invalid_request'));
test('hard-worker-deadline', () => assert.equal(run({ ...base(), timeoutMilliseconds: 1 }).status, 'deadline_exceeded'));
test('exact-decimal-underflow-rejected', () => assert.equal(run({ ...base(), projectSettings: { ...settings, endConnectionLength: '1e-29' } }).status, 'invalid_request'));
test('null-setting-revision-rejected', () => assert.equal(run({ ...base(), projectSettings: { ...settings, revision: null } }).status, 'invalid_request'));
test('null-required-scalar-rejected', () => assert.equal(run({ ...base(), snapshotSha256: null }).status, 'invalid_request'));
test('missing-explicit-private-root-rejected', () => assert.equal(run({ ...base(), operation: 'prepare' }, { ...env, PF_ROOT: '' }).status, 'invalid_request'));
test('unassigned-model-category-is-not-invented', () => {
  const changed = structuredClone(snapshot); changed.objects[0].categoryAssignmentSource = 'unassigned'; changed.objects[0].allowedCategories = [];
  const bytes = Buffer.from(JSON.stringify(changed)); fs.writeFileSync(snapshotPath, bytes);
  try { assert.equal(run({ ...base(), snapshotSha256: hash(bytes) }).status, 'model_needs_review'); }
  finally { fs.writeFileSync(snapshotPath, snapshotBytes); }
});
const inputs = JSON.parse(fs.readFileSync(path.join(root, 'docs/pathfinder/fixtures/pf-core-v1.inputs.json'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(root, 'docs/pathfinder/fixtures/pf-core-v1.expected.json'), 'utf8'));
for (const item of inputs.cases.filter(value => value.kind === 'design')) test('frozen-saved-design-' + item.id, () => {
  const value = item.input.projectSettings;
  const response = run({ ...base(), operation: 'design', route: item.input.route, projectSettings: { revision: 'frozen-pf0-design',
    endConnectionLength: value.connectionSpareMeters, secondaryTrayLength: value.secondaryLengthMeters, additionalBendingPercent: value.increasePercent } });
  const reference = expected.cases.find(value => value.id === item.id).output;
  if (reference.status !== 'returned') assert.equal(response.status, 'invalid_request');
  else { assert.equal(response.status, 'calculated'); for (const key of ['lengthBeforePercentageMeters', 'unroundedLengthMeters', 'designLengthMeters']) assert.equal(response.design[key], reference[key]); }
});
const output = path.join(root, 'docs/pathfinder/evidence/pf3', 'model-runner-' + stamp + '.json'); fs.mkdirSync(path.dirname(output), { recursive: true });
const result = { schemaVersion: 'pathfinder.model.runner.tests.v1', observedAtUtc: new Date().toISOString(), scope: 'synthetic-private-model-worker-and-frozen-saved-design-controls',
  status: checks.every(value => value.status === 'PASS') ? 'PASS' : 'FAIL', passed: checks.filter(value => value.status === 'PASS').length, checks, scratch,
  sourceSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), snapshotSha256: hash(snapshotBytes), corePinsChanged: false, nativeParity: 'BLOCKED; not established by synthetic controls' };
fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, passed: result.passed, total: checks.length, output, failures: checks.filter(value => value.status === 'FAIL') }));
process.exitCode = result.status === 'PASS' ? 0 : 1;
