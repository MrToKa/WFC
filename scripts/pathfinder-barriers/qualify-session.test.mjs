import test from 'node:test';
import assert from 'node:assert/strict';
import { relativePath, validateManifest, latencySummary, semanticDigest, expectedOutcome, parseCli } from './qualify-session.mjs';

const hash = 'a'.repeat(64);
function manifest() {
  const requests = Array.from({ length: 65 }, (_, index) => ({ index,
    id: `b6200000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, label: `case-${index}`,
    requestPath: `requests/${index}.json`, requestSha256: hash, contextSha256: hash,
    population: 'retirement', geometryKey: 'raw', expectedStatus: 'calculated', expectedStatuses: ['calculated'],
    expectedBarrierStatus: 'clear', expectedBarrierStatuses: ['clear'], equivalenceGroup: null }));
  return { schemaVersion: 'wfc.pf.barrier-session-workload.v1', sourceKind: 'synthetic', engineeringAccepted: false,
    nativeParity: 'not-performed', trayCount: 64, maximumRouteCodes: 64,
    geometry: { raw: { context: {}, manifestPath: 'barriers/raw.json', capturePath: 'barriers/capture.json' } }, requests,
    retirementPopulationIndices: requests.map(row => row.index), oneShotIndices: [0, 1, 15, 64],
    files: [...requests.map(row => ({ path: row.requestPath, sha256: hash, bytes: 100 })),
      { path: 'barriers/raw.json', sha256: hash, bytes: 100 }, { path: 'barriers/capture.json', sha256: hash, bytes: 100 }] };
}
test('bounded complete 65-entry retirement contract is accepted', () => assert.equal(validateManifest(manifest()).requests.length, 65));
for (const [name, mutate] of [
  ['short population', value => value.retirementPopulationIndices.pop()],
  ['skipped retirement slot', value => value.retirementPopulationIndices[0] = 1],
  ['duplicate id', value => value.requests[1].id = value.requests[0].id],
  ['unfrozen request', value => value.files.shift()],
  ['changed request digest', value => value.requests[0].requestSha256 = 'b'.repeat(64)],
  ['duplicate inventory', value => value.files.push(value.files[0])],
  ['unbounded frozen bytes', value => value.files.forEach(row => row.bytes = 32 * 1024 ** 2)],
  ['deadline expected as success', value => value.requests[0].expectedStatuses = ['deadline_exceeded']],
  ['claimed engineering approval', value => value.engineeringAccepted = true],
  ['missing capture inventory', value => value.geometry.raw.capturePath = 'barriers/other.json'],
]) test(`manifest refuses ${name}`, () => { const value = manifest(); mutate(value); assert.throws(() => validateManifest(value)); });

for (const value of ['../x', '/tmp/x', 'a\\b', 'a//b', 'a/./b', 'a/../b', 'C:/x', 'a\0b'])
  test(`immutable path refuses ${JSON.stringify(value)}`, () => assert.throws(() => relativePath(value)));
test('immutable paths retain exact relative case', () => assert.equal(relativePath('barriers/ABC/capture.json'), 'barriers/ABC/capture.json'));

test('declared median and nearest-rank p95 include all durations', () => {
  assert.deepEqual(latencySummary([10, 1, 7, 3]), { count: 4, medianMilliseconds: 5, p95Milliseconds: 10, maximumMilliseconds: 10 });
  assert.equal(latencySummary(Array.from({ length: 100 }, (_, index) => index + 1)).p95Milliseconds, 95);
  assert.equal(latencySummary([]).medianMilliseconds, null);
  assert.throws(() => latencySummary([NaN]));
});

function response() { return { schemaVersion: 'pathfinder.model.response.v3', requestId: 'a', effectiveCategory: 'Control', status: 'calculated',
  message: 'actual', engineeringAccepted: false, prepared: { loadedFromDisk: false, key: 'immutable' },
  route: { success: true, pathPoints: [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }], routeCodes: ['A', 'B'], connectionGapCount: 1 },
  design: { designLengthMeters: '9' }, lengthLedger: { unroundedMeters: '8.8' },
  barriers: { context: { policy: false }, diagnostics: { status: 'clear', work: 4 }, proof: { routeSha256: hash }, directSecondary: { mode: 'tray-network' } } }; }
test('comparison excludes only request id and fitted disk-reuse flag', () => {
  const a = response(), b = response(); b.requestId = 'b'; b.prepared.loadedFromDisk = true;
  assert.equal(semanticDigest(a), semanticDigest(b)); assert.equal(a.prepared.loadedFromDisk, false);
});
for (const [name, mutate] of [
  ['point precision', value => value.route.pathPoints[0].x += Number.EPSILON],
  ['point order', value => value.route.pathPoints.reverse()],
  ['route code order', value => value.route.routeCodes.reverse()],
  ['barrier scope', value => value.barriers.context.policy = true],
  ['raw proof', value => value.barriers.proof.routeSha256 = 'b'.repeat(64)],
  ['diagnostic counters', value => value.barriers.diagnostics.work++],
  ['length ledger', value => value.lengthLedger.unroundedMeters = '8.9'],
  ['design exact decimal', value => value.design.designLengthMeters = '9.0'],
  ['effective category', value => value.effectiveCategory = 'LV'],
  ['prepared key', value => value.prepared.key = 'changed'],
]) test(`comparison retains ${name}`, () => { const a = response(), b = response(); mutate(b); assert.notEqual(semanticDigest(a), semanticDigest(b)); });

test('expected typed refusal cannot convert a timeout or successful path to PASS', () => {
  const descriptor = { expectedStatus: 'refused', expectedStatuses: ['no_path', 'resource_limit'], expectedBarrierStatuses: ['blocked', 'indeterminate'] };
  const value = response(); value.status = 'no_path'; value.route.success = false; value.barriers.diagnostics.status = 'blocked';
  assert.equal(expectedOutcome(descriptor, value), true);
  value.status = 'deadline_exceeded'; assert.equal(expectedOutcome(descriptor, value), false);
  value.status = 'no_path'; value.route.success = true; assert.equal(expectedOutcome(descriptor, value), false);
});
test('CLI requires explicit absolute paths and bounded outer deadline', () => {
  const args = ['--manifest', '/work/fixture/manifest.json', '--output', '/work/output', '--built-root', '/app/server/dist'];
  assert.equal(parseCli(args).deadline, 480000);
  assert.throws(() => parseCli([...args, '--deadline-ms', '600001']));
  assert.throws(() => parseCli([...args, '--built-root', '/other']));
  assert.throws(() => parseCli(['--manifest', 'relative', '--output', '/work/output', '--built-root', '/app/server/dist']));
});
