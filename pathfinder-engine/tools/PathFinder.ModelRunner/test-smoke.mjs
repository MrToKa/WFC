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
const dll = process.env.PF_MODEL_RUNNER_DLL ?? path.join(root, 'pathfinder-engine/tools/PathFinder.ModelRunner/bin/Release/net9.0/PathFinder.ModelRunner.dll');
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
test('independent-lookup-plan-needs-no-snapshot-planning-artifact-or-private-root', () => {
  const response = run({ schemaVersion: 'pathfinder.model.runner.v1', requestId: crypto.randomUUID(), operation: 'lookup-plan', projectId, modelVersionId, timeoutMilliseconds: 30000,
    routeText: '/bc001/SECONDARY/BC001/BC002/BC001' }, { ...env, PF_ROOT: '' });
  assert.equal(response.status, 'lookup_planned'); assert.deepEqual(response.routeCodes, ['/BC001', '/BC002']); assert.equal(response.design, undefined);
});
test('lookup-plan-rejects-invalid-syntax-and-inappropriate-snapshot-fields', () => {
  const request = { schemaVersion: 'pathfinder.model.runner.v1', requestId: crypto.randomUUID(), operation: 'lookup-plan', projectId, modelVersionId, timeoutMilliseconds: 30000 };
  for (const routeText of ['/SECONDARY', '/BAD CODE', '/' + 'A'.repeat(256), Array.from({ length: 101 }, (_, index) => '/A' + index).join('')]) assert.equal(run({ ...request, routeText }).status, 'invalid_request');
  assert.equal(run({ ...request, routeText: '/BC001', snapshotId }).status, 'invalid_request');
});
test('dedicated-lookup-resolves-owner-scope-and-cannot-be-promoted-to-planning', () => {
  const dedicated = structuredClone(snapshot), leaf = dedicated.objects[0];
  dedicated.capture = { adapterVersion: 'wfc.protected-lookup-capture.v1', sourceKind: 'converted', inventoryComplete: false, geometryComplete: false,
    unitsVerified: false, transformsVerified: false, planningVisibilityKnown: false, sourceLinkVerified: false, evidenceSha256: [], lookupRouteCodes: ['/BC001'] };
  leaf.name = 'FTUBE /BC001/123'; leaf.leafToRootNames = [leaf.name, '/BC001']; leaf.parentId = 'owner'; leaf.nativeHidden = null;
  leaf.categoryAssignmentSource = 'lookup-all-categories'; leaf.allowedCategories = ['MV', 'LV', 'Control']; delete leaf.routeName; delete leaf.shapeName;
  const owner = { ...structuredClone(leaf), id: 'owner', dbId: 2, parentId: null, name: '/BC001', leafToRootNames: ['/BC001'], geometryRole: 'hierarchy', fragments: [], allowedCategories: [], categoryAssignmentSource: 'unassigned' };
  dedicated.objects.push(owner); const bytes = Buffer.from(JSON.stringify(dedicated)); fs.writeFileSync(snapshotPath, bytes);
  try {
    const request = { ...base(), operation: 'lookup', snapshotSha256: hash(bytes), routeText: '/bc001/SECONDARY/BC001', projectSettings: null };
    const response = run(request); assert.equal(response.status, 'calculated'); assert.equal(response.design, null); assert.equal(response.lookupScope.resolvedLeafCount, 1); assert.equal(response.lookupScope.resolvedOwnerCount, 1); assert.equal(response.usedConnectionGapMeters, .25);
    assert.equal(run({ ...request, routeText: '/BC002' }).status, 'invalid_request');
    assert.equal(run({ ...base(), snapshotSha256: hash(bytes) }).status, 'invalid_request');
    assert.equal(run({ ...base(), operation: 'prepare', snapshotSha256: hash(bytes) }).status, 'invalid_request');
    const reversed = run({ ...request, reverse: true }); assert.deepEqual(reversed.route.pathPoints, response.route.pathPoints.toReversed());
    return { scope: response.lookupScope, usedConnectionGapMeters: response.usedConnectionGapMeters };
  } finally { fs.writeFileSync(snapshotPath, snapshotBytes); }
});
test('strict-prepare-and-private-fit-cache', () => { const r = run({ ...base(), operation: 'prepare' }); assert.equal(r.status, 'prepared'); assert.equal(r.prepared.segmentCount, 1); return r.prepared; });
test('real-core-calculation-instrumentation-maps-to-control', () => {
  const r = run(base()); assert.equal(r.status, 'calculated'); assert.equal(r.effectiveCategory, 'Control'); assert.equal(r.route.lengthMeters, 10);
  assert.equal(r.design.designLengthMeters, '18'); return { length: r.route.lengthMeters, design: r.design, engineeringAccepted: r.engineeringAccepted };
});
test('coincident-endpoints-preserve-one-exact-native-point', () => {
  const point = { x: 1, y: 0, z: .5 };
  const r = run({ ...base(), from: point, to: point });
  assert.equal(r.status, 'calculated'); assert.equal(r.route.lengthMeters, 0); assert.deepEqual(r.route.pathPoints, [point]);
  assert.equal(r.design.designLengthMeters, '7');
});
test('null-secondary-does-not-become-zero-when-flagged', () => {
  const r = run({ ...base(), from: { x: 0, y: 4, z: .5 }, projectSettings: { ...settings, secondaryTrayLength: null } });
  assert.equal(r.status, 'settings_required'); assert.equal(r.route.fromRequiresSecondary, true);
});
test('unknown-category-requires-resolution', () => assert.equal(run({ ...base(), category: 'Power' }).status, 'category_required'));
test('ordered-lookup-native-parser-without-equipment-tails-or-design', () => {
  const r = run({ ...base(), operation: 'lookup', routeText: '/SECONDARY/bc001/BC001', category: null, from: null, to: null, projectSettings: null });
  assert.equal(r.status, 'calculated'); assert.equal(r.route.routeText, '/BC001'); assert.equal(r.route.lengthMeters, 10);
  assert.equal(r.route.fromDistanceMeters, 0); assert.equal(r.route.toDistanceMeters, 0); assert.equal(r.route.fromRequiresSecondary, false);
  assert.equal(r.route.toRequiresSecondary, false); assert.equal(r.design, null); assert.equal(r.effectiveCategory, null);
});
test('reverse-lookup-is-native-exact-reversal', () => {
  const request = { ...base(), operation: 'lookup', routeText: '/BC001' };
  const forward = run(request), reverse = run({ ...request, reverse: true });
  assert.equal(reverse.status, 'calculated'); assert.equal(reverse.route.lengthMeters, forward.route.lengthMeters);
  assert.deepEqual(reverse.route.pathPoints, forward.route.pathPoints.toReversed());
  assert.deepEqual(reverse.route.segmentIds, forward.route.segmentIds.toReversed());
});
test('reverse-calculation-swaps-approaches-and-keeps-original-formula', () => {
  const request = { ...base(), from: { x: 0, y: 4, z: .5 }, to: { x: 10, y: 1, z: .5 } };
  const forward = run(request), reverse = run({ ...request, reverse: true });
  assert.equal(reverse.status, 'calculated'); assert.equal(reverse.route.fromDistanceMeters, forward.route.toDistanceMeters);
  assert.equal(reverse.route.toDistanceMeters, forward.route.fromDistanceMeters); assert.deepEqual(reverse.route.pathPoints, forward.route.pathPoints.toReversed());
  assert.equal(reverse.route.fromRequiresSecondary, forward.route.toRequiresSecondary); assert.deepEqual(reverse.design, forward.design);
});
test('lookup-missing-code-is-no-path', () => assert.equal(run({ ...base(), operation: 'lookup', routeText: '/MISSING' }).status, 'no_path'));
test('legacy-planning-lookup-retains-original-long-code-contract', () => assert.equal(run({ ...base(), operation: 'lookup', routeText: '/' + 'A'.repeat(300) }).status, 'no_path'));
test('lookup-invalid-and-secondary-only-input-rejected', () => {
  for (const routeText of ['/SECONDARY', '/BAD CODE', Array.from({ length: 101 }, (_, i) => '/A' + i).join('')]) assert.equal(run({ ...base(), operation: 'lookup', routeText }).status, 'invalid_request');
});
test('core-graph-budget-is-controlled-resource-limit', () => assert.equal(run({ ...base(), from: { x: 1, y: 0, z: .5 }, to: { x: 9, y: 0, z: .5 }, options: { ...base().options, maxGraphNodes: 2 } }).status, 'resource_limit'));
test('mode-specific-route-and-reverse-fields-rejected', () => {
  assert.equal(run({ ...base(), routeText: '/BC001' }).status, 'invalid_request');
  assert.equal(run({ ...base(), operation: 'prepare', reverse: true }).status, 'invalid_request');
});
test('nonfinite-coordinate-rejected', () => assert.equal(run(JSON.stringify(base()).replace('"x":0', '"x":1e999')).status, 'invalid_request'));
test('cross-project-snapshot-rejected', () => assert.equal(run({ ...base(), projectId: crypto.randomUUID() }).status, 'invalid_request'));
test('snapshot-byte-integrity-rejected', () => assert.equal(run({ ...base(), snapshotSha256: '0'.repeat(64) }).status, 'invalid_request'));
test('path-injection-identity-rejected', () => assert.equal(run({ ...base(), snapshotId: '../snapshot' }).status, 'invalid_request'));
test('unexpected-proof-property-rejected', () => assert.equal(run({ ...base(), engineeringAccepted: true }).status, 'invalid_request'));
test('duplicate-json-member-rejected', () => assert.equal(run(JSON.stringify(base()).replace('{', '{"operation":"prepare",')).status, 'invalid_request'));
test('hard-worker-deadline', () => assert.equal(run({ ...base(), timeoutMilliseconds: 1 }).status, 'deadline_exceeded'));
test('exact-decimal-underflow-rejected', () => assert.equal(run({ ...base(), projectSettings: { ...settings, endConnectionLength: '1e-29' } }).status, 'invalid_request'));
test('smallest-exact-decimal-is-fixed-and-not-rounded-or-exponential', () => {
  const r = run({ ...base(), operation: 'design', route: { success: true, lengthMeters: 0, fromDistanceMeters: 0, toDistanceMeters: 0, fromRequiresSecondary: false, toRequiresSecondary: false },
    projectSettings: { ...settings, endConnectionLength: '1e-28', additionalBendingPercent: '0' } });
  assert.equal(r.status, 'calculated'); assert.equal(r.design.unroundedLengthMeters, '0.0000000000000000000000000001'); assert.equal(r.design.designLengthMeters, '1');
});
test('null-setting-revision-rejected', () => assert.equal(run({ ...base(), projectSettings: { ...settings, revision: null } }).status, 'invalid_request'));
test('null-required-scalar-rejected', () => assert.equal(run({ ...base(), snapshotSha256: null }).status, 'invalid_request'));
test('missing-explicit-private-root-rejected', () => assert.equal(run({ ...base(), operation: 'prepare' }, { ...env, PF_ROOT: '' }).status, 'invalid_request'));
test('unassigned-model-category-is-not-invented', () => {
  const changed = structuredClone(snapshot); changed.objects[0].categoryAssignmentSource = 'unassigned'; changed.objects[0].allowedCategories = [];
  const bytes = Buffer.from(JSON.stringify(changed)); fs.writeFileSync(snapshotPath, bytes);
  try { assert.equal(run({ ...base(), snapshotSha256: hash(bytes) }).status, 'model_needs_review'); }
  finally { fs.writeFileSync(snapshotPath, snapshotBytes); }
});
for (const kind of ['native-hidden', 'hidden-ancestor', 'planning-rule-exclusion']) test('unassigned-' + kind + '-does-not-block-eligible-routing', () => {
  const changed = structuredClone(snapshot), hidden = structuredClone(snapshot.objects[0]);
  hidden.id = 'ignored-tray'; hidden.dbId = 2; hidden.routeName = '/IGNORED'; hidden.categoryAssignmentSource = 'unassigned'; hidden.allowedCategories = [];
  hidden.fragments.forEach((fragment, i) => { fragment.id = 'ignored-fragment-' + i; });
  if (kind === 'native-hidden') hidden.nativeHidden = true;
  if (kind === 'hidden-ancestor') {
    const ancestor = structuredClone(hidden); ancestor.id = 'hidden-parent'; ancestor.dbId = 3; ancestor.geometryRole = 'hierarchy'; ancestor.fragments = []; ancestor.routeName = null; ancestor.nativeHidden = true;
    changed.objects.push(ancestor); hidden.parentId = ancestor.id;
  }
  changed.objects.push(hidden);
  const bytes = Buffer.from(JSON.stringify(changed)); fs.writeFileSync(snapshotPath, bytes);
  try {
    const response = run({ ...base(), snapshotSha256: hash(bytes), ...(kind === 'planning-rule-exclusion' ? { rules: { excludedObjectIds: [hidden.id] } } : {}) });
    assert.equal(response.status, 'calculated'); assert.equal(response.route.lengthMeters, 10); assert.equal(response.prepared.segmentCount, 1);
  } finally { fs.writeFileSync(snapshotPath, snapshotBytes); }
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
